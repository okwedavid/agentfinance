import http from 'http';
import { execSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import express from 'express';
import cors from 'cors';
import cookieParser from 'cookie-parser';
import jwt from 'jsonwebtoken';
import bcrypt from 'bcryptjs';
import IORedis from 'ioredis';
import { Queue } from 'bullmq';
import { WebSocketServer } from 'ws';
import { v4 as uuidv4 } from 'uuid';
import prisma from './prismaClient.js';
import analyticsRouter from './routes/analytics.js';
import dispatchFactory from './routes/dispatch.js';
import sessionsFactory from './routes/sessions.js';
import replayRouter from './routes/replay.js';
import walletRouter from './routes/wallet.js';
import { authMiddleware, createSessionForUser, requireAdmin, requireRole } from './middleware/auth.js';
import {
  ROLE_ADMIN,
  ROLE_SUPER_ADMIN,
  defaultRole,
  isSuperAdminRole,
  normalizeRole,
  serializeUser,
  validateEmail,
  validatePassword,
  validateUsername,
} from './utils/security.js';
import oauthRouter from './routes/oauth.js';
import rateLimit from './middleware/rateLimit.js';
import errorHandler from './middleware/errorHandler.js';
import logger from './utils/logger.js';
import runAgent from './agents/agentRunner.js';
import {
  approvePayout,
  listPayouts,
  listPayoutsForAdmin,
  payoutRuntimeSnapshot,
  preparePayoutPlan,
  refreshPayoutStatus,
  rejectPayout,
  summariseTaskResult,
  normalizeNetwork,
  isValidAddressForNetwork,
} from './services/payoutService.js';
import './workers/agentWorker.js';

const JWT_SECRET = process.env.JWT_SECRET;

if (!JWT_SECRET) {
  logger.error('FATAL: JWT_SECRET env var is not set.');
  process.exit(1);
}

const prismaSchemaPath = fileURLToPath(new URL('../prisma/schema.prisma', import.meta.url));
const prismaBinPath = fileURLToPath(new URL('../node_modules/.bin/prisma', import.meta.url));

function syncDatabaseSchema() {
  logger.info('Syncing database schema (prisma db push)...');
  try {
    execSync(`"${prismaBinPath}" db push --schema="${prismaSchemaPath}" --accept-data-loss`, {
      stdio: 'inherit',
    });
  } catch (error) {
    logger.error('prisma db push failed', error);
    process.exit(1);
  }
}

// Ensure the schema is applied before serving traffic, independent of how the
// process is started (helper/start script overrides may bypass npm scripts).
syncDatabaseSchema();

const app = express();
const server = http.createServer(app);
const wss = new WebSocketServer({ server });

const configuredOrigins = (process.env.ALLOWED_ORIGINS || process.env.FRONTEND_URLS || '')
  .split(',')
  .map((origin) => origin.trim())
  .filter(Boolean);

const ALLOWED_ORIGINS = [
  'https://agentfinance.onrender.com',
  'http://localhost:3000',
  'http://localhost:4000',
  ...configuredOrigins,
];

app.use(cors({
  origin: (origin, callback) => {
    // Non-browser clients (curl, healthchecks, servers) send no Origin header.
    if (!origin) return callback(null, true);
    return callback(null, ALLOWED_ORIGINS.includes(origin));
  },
  credentials: true,
}));
app.use(rateLimit);
app.use(express.json());
app.use(cookieParser());

const REDIS_URL = process.env.REDIS_URL;
const redis = REDIS_URL && !REDIS_URL.includes('{{')
  ? new IORedis(REDIS_URL, { maxRetriesPerRequest: null })
  : null;
const taskQueue = redis ? new Queue('agent-tasks', { connection: redis }) : null;

if (!redis) {
  logger.warn('No REDIS_URL configured. BullMQ queue disabled; tasks will run inline.');
}

function signToken(payload) {
  return jwt.sign(payload, JWT_SECRET, { expiresIn: '7d' });
}

async function bootstrapAdmins() {
  const names = (process.env.ADMIN_USERNAMES || '')
    .split(',')
    .map((value) => value.trim())
    .filter(Boolean);

  if (names.length === 0) return;

  const result = await prisma.user.updateMany({
    where: { username: { in: names } },
    data: { role: 'ADMIN' },
  });

  if (result.count > 0) {
    logger.info(`Bootstrapped ${result.count} account(s) to ADMIN role from ADMIN_USERNAMES.`);
  }
}

// Enforce a single SUPER_ADMIN. The owner is set via SUPER_ADMIN_USERNAME
// (defaults to the okwedavid owner account). Extra SUPER_ADMIN accounts are
// demoted to ADMIN. Account creation itself is never automated.
async function ensureSuperAdmin() {
  try {
    const ownerUsername = process.env.SUPER_ADMIN_USERNAME || 'okwedavid';
    const owner = await prisma.user.findUnique({ where: { username: ownerUsername } });
    if (owner && owner.role !== ROLE_SUPER_ADMIN) {
      await prisma.user.update({
        where: { id: owner.id },
        data: { role: ROLE_SUPER_ADMIN },
      });
      logger.info(`Promoted ${ownerUsername} to SUPER_ADMIN.`);
    }

    const superAdmins = await prisma.user.findMany({ where: { role: ROLE_SUPER_ADMIN } });
    for (const admin of superAdmins) {
      if (admin.username !== ownerUsername) {
        await prisma.user.update({
          where: { id: admin.id },
          data: { role: ROLE_ADMIN },
        });
        logger.info(`Demoted ${admin.username} to ADMIN (only ${ownerUsername} may be super admin).`);
      }
    }
  } catch (error) {
    logger.warn('ensureSuperAdmin skipped', error.message);
  }
}

async function bootstrapRun() {
  try {
    await bootstrapAdmins();
    await ensureSuperAdmin();
  } catch (error) {
    logger.warn('role bootstrap skipped', error.message);
  }
}

function parseTaskResult(value) {
  if (!value) return null;
  if (typeof value !== 'string') return value;
  try {
    return JSON.parse(value);
  } catch {
    return value;
  }
}

async function publish(channel, payload) {
  if (!redis) return;
  await redis.publish(channel, JSON.stringify(payload));
}

function classifyAgent(action = '') {
  const text = action.toLowerCase();
  if (/(trade|arbitrage|swap|buy|sell)/.test(text)) return 'trading';
  if (/(write|newsletter|article|thread|content|youtube|tweet)/.test(text)) return 'content';
  if (/(send|transfer|route|sweep|wallet|balance|gas)/.test(text)) return 'execution';
  if (/(research|find|analyse|analyze|best|top|yield|market)/.test(text)) return 'research';
  return 'coordinator';
}

function sanitizeTask(task) {
  const parsedResult = parseTaskResult(task.result);
  const summary = summariseTaskResult(parsedResult);
  return {
    ...task,
    result: parsedResult,
    summary,
  };
}

async function runTaskInline(task) {
  await prisma.task.update({
    where: { id: task.id },
    data: { status: 'running', startedAt: new Date() },
  });
  await publish('agentfi:tasks', {
    type: 'task:running',
    data: { id: task.id, status: 'running', agentType: classifyAgent(task.action) },
  });

  const user = task.userId
    ? await prisma.user.findUnique({ where: { id: task.userId } }).catch(() => null)
    : null;
  const profiles = user?.walletProfiles && typeof user.walletProfiles === 'object' ? user.walletProfiles : {};
  const activeWallet = profiles?.[user?.preferredNetwork || 'ethereum'] || user?.walletAddress || null;

  try {
    const result = await runAgent({
      action: task.action,
      agentType: classifyAgent(task.action),
      walletAddress: activeWallet,
    });

    const updated = await prisma.task.update({
      where: { id: task.id },
      data: {
        status: 'completed',
        completedAt: new Date(),
        result: JSON.stringify({
          output: result.output,
          summary: summariseTaskResult(result.output).slice(0, 1200) || '',
          provider: result.provider,
          agentType: result.agentType,
        }),
      },
    });

    await publish('agentfi:tasks', { type: 'task:completed', data: sanitizeTask(updated) });
  } catch (error) {
    const updated = await prisma.task.update({
      where: { id: task.id },
      data: {
        status: 'failed',
        completedAt: new Date(),
        result: JSON.stringify({ error: error.message }),
      },
    });
    await publish('agentfi:tasks', { type: 'task:failed', data: sanitizeTask(updated) });
  }
}

app.get('/health', async (req, res) => {
  let db = 'unknown';
  try {
    await prisma.$queryRaw`SELECT 1`;
    db = 'ok';
  } catch {
    db = 'error';
  }

  res.json({
    status: 'ok',
    time: Date.now(),
    db,
    redis: redis ? 'configured' : 'disabled',
    agentsConfigured: (process.env.AGENTS || '')
      .split(',')
      .map((value) => value.trim())
      .filter(Boolean).length,
  });
});

app.get('/system/runtime', authMiddleware, async (req, res) => {
  const providerFlags = {
    GROQ_API_KEY: !!process.env.GROQ_API_KEY,
    GOOGLE_AI_API_KEY: !!process.env.GOOGLE_AI_API_KEY,
    OPENROUTER_API_KEY: !!process.env.OPENROUTER_API_KEY,
    ANTHROPIC_API_KEY: !!process.env.ANTHROPIC_API_KEY,
    TOGETHER_API_KEY: !!process.env.TOGETHER_API_KEY,
    MISTRAL_API_KEY: !!process.env.MISTRAL_API_KEY,
    CEREBRAS_API_KEY: !!process.env.CEREBRAS_API_KEY,
    ALCHEMY_API_KEY: !!process.env.ALCHEMY_API_KEY,
    COINGECKO_API_KEY: !!process.env.COINGECKO_API_KEY,
    CMC_API_KEY: !!process.env.CMC_API_KEY,
    TAVILY_API_KEY: !!process.env.TAVILY_API_KEY,
    SERPER_API_KEY: !!process.env.SERPER_API_KEY,
  };

  const fleet = (process.env.AGENTS || process.env.NEXT_PUBLIC_AGENTS || '')
    .split(',')
    .map((name) => name.trim())
    .filter(Boolean)
    .map((name, index) => ({
      id: name,
      label: name,
      status: index < 8 ? 'online' : 'standby',
    }));

  const user = await prisma.user.findUnique({ where: { id: req.user.sub } }).catch(() => null);
  const payoutRuntime = payoutRuntimeSnapshot();

  res.json({
    providers: providerFlags,
    providerCount: Object.values(providerFlags).filter(Boolean).length,
    redis: !!redis,
    queueEnabled: !!taskQueue,
    fleet,
    walletAddress: user?.walletAddress || null,
    walletProfiles: user?.walletProfiles || {},
    preferredNetwork: user?.preferredNetwork || 'ethereum',
    payoutRuntime,
  });
});

app.post('/auth/register', async (req, res) => {
  try {
    const { username, password } = req.body;
    const email = typeof req.body.email === 'string' && req.body.email.trim() ? req.body.email.trim().toLowerCase() : null;

    const usernameError = validateUsername(username);
    if (usernameError) return res.status(400).json({ error: usernameError });

    const emailError = validateEmail(email);
    if (emailError) return res.status(400).json({ error: emailError });

    const passwordError = validatePassword(password);
    if (passwordError) return res.status(400).json({ error: passwordError });

    const existingUsername = await prisma.user.findUnique({ where: { username } });
    if (existingUsername) return res.status(400).json({ error: 'Username is already taken.' });

    if (email) {
      const existingEmail = await prisma.user.findUnique({ where: { email } });
      if (existingEmail) return res.status(400).json({ error: 'Email is already registered.' });
    }

    const trimmed = username.trim();
    if (trimmed.length < 3 || trimmed.length > 30) {
      return res.status(400).json({ error: 'username must be 3-30 characters' });
    }
    if (password.length < 6) {
      return res.status(400).json({ error: 'password must be at least 6 characters' });
    }

    const existing = await prisma.user.findUnique({ where: { username: trimmed } });
    if (existing) return res.status(400).json({ error: 'username taken' });

    const passwordHash = await bcrypt.hash(password, 10);
    const ownerUsername = process.env.SUPER_ADMIN_USERNAME || 'okwedavid';
    const role = trimmed === ownerUsername ? ROLE_SUPER_ADMIN : defaultRole();
    const user = await prisma.user.create({
      data: { username: trimmed, passwordHash, role },
    });
    const session = await createSessionForUser(user.id);
    const token = signToken({ sub: user.id, username: user.username, role: user.role, sid: session.id });

    res.json({
      ...serializeUser(user, { isNewUser: true }),
      token,
    });
  } catch (error) {
    if (error.code === 'P2002') {
      return res.status(400).json({ error: 'username taken' });
    }
    logger.error('register error', error);
    res.status(500).json({ error: 'registration failed' });
  }
});

app.post('/auth/login', async (req, res) => {
  try {
    const { username, password } = req.body;
    if (!username || !password) {
      return res.status(400).json({ error: 'username and password required' });
    }
    const user = await prisma.user.findUnique({ where: { username } });
    if (!user) return res.status(401).json({ error: 'invalid credentials' });

    const ok = await bcrypt.compare(password, user.passwordHash);
    if (!ok) return res.status(401).json({ error: 'invalid credentials' });

    const session = await createSessionForUser(user.id);
    const token = signToken({ sub: user.id, username: user.username, role: user.role, sid: session.id });

    res.json({
      ...serializeUser(user, { isNewUser: false }),
      token,
    });
  } catch (error) {
    logger.error('login error', error);
    res.status(500).json({ error: 'failed' });
  }
});

app.get('/auth/me', authMiddleware, async (req, res) => {
  try {
    const user = await prisma.user.findUnique({ where: { id: req.user.sub } });
    if (!user) return res.status(404).json({ error: 'user not found' });
    res.json(serializeUser(user));
  } catch {
    res.status(500).json({ error: 'failed' });
  }
});

app.patch('/auth/me', authMiddleware, async (req, res) => {
  try {
    const current = await prisma.user.findUnique({ where: { id: req.user.sub } });
    if (!current) return res.status(404).json({ error: 'user not found' });

    const data = {};
    if (typeof req.body.displayName === 'string') data.displayName = req.body.displayName.trim().slice(0, 80) || null;
    if (typeof req.body.bio === 'string') data.bio = req.body.bio.trim().slice(0, 280) || null;
    if (typeof req.body.preferredNetwork === 'string') data.preferredNetwork = normalizeNetwork(req.body.preferredNetwork).id;

    const updated = await prisma.user.update({
      where: { id: req.user.sub },
      data,
    });

    res.json(serializeUser(updated));
  } catch (error) {
    logger.error('profile update error', error);
    res.status(500).json({ error: 'failed' });
  }
});

app.post('/auth/logout', authMiddleware, async (req, res) => {
  try {
    if (req.sid) {
      await prisma.authSession.updateMany({
        where: { id: req.sid, userId: req.user.sub },
        data: { revoked: true },
      });
    }
    res.json({ ok: true });
  } catch (error) {
    logger.error('logout error', error);
    res.status(500).json({ error: 'failed' });
  }
});

app.delete('/auth/me', authMiddleware, async (req, res) => {
  try {
    const user = await prisma.user.findUnique({ where: { id: req.user.sub } });
    if (!user) return res.status(404).json({ error: 'user not found' });
    if (isSuperAdminRole(normalizeRole(user.role))) {
      return res.status(400).json({ error: 'The owner/super admin account cannot be deleted.' });
    }

    const taskRows = await prisma.task.findMany({ where: { userId: user.id }, select: { id: true } });
    const taskIds = taskRows.map((task) => task.id);

    await prisma.$transaction([
      prisma.authSession.updateMany({ where: { userId: user.id }, data: { revoked: true } }),
      prisma.message.deleteMany({ where: { taskId: { in: taskIds } } }),
      prisma.task.deleteMany({ where: { userId: user.id } }),
      prisma.payout.deleteMany({ where: { userId: user.id } }),
      prisma.digitalProduct.deleteMany({ where: { userId: user.id } }),
      prisma.factoryRun.deleteMany({ where: { userId: user.id } }),
      prisma.user.delete({ where: { id: user.id } }),
    ]);

    res.json({ ok: true });
  } catch (error) {
    logger.error('delete account error', error);
    res.status(500).json({ error: 'failed' });
  }
});

app.post('/auth/promote', authMiddleware, requireRole([ROLE_SUPER_ADMIN]), async (req, res) => {
  try {
    const targetUsername = typeof req.body.username === 'string' ? req.body.username.trim() : '';
    if (!targetUsername) return res.status(400).json({ error: 'username required' });

    const target = await prisma.user.findUnique({ where: { username: targetUsername } });
    if (!target) return res.status(404).json({ error: 'user not found' });
    if (isSuperAdminRole(normalizeRole(target.role))) {
      return res.status(400).json({ error: 'The super admin account cannot be changed.' });
    }

    const updated = await prisma.user.update({
      where: { id: target.id },
      data: { role: ROLE_ADMIN },
    });

    res.json({ ok: true, user: updated });
  } catch (error) {
    logger.error('promote error', error);
    res.status(500).json({ error: 'failed' });
  }
});

app.post('/auth/demote', authMiddleware, requireRole([ROLE_SUPER_ADMIN]), async (req, res) => {
  try {
    const targetUsername = typeof req.body.username === 'string' ? req.body.username.trim() : '';
    if (!targetUsername) return res.status(400).json({ error: 'username required' });

    const target = await prisma.user.findUnique({ where: { username: targetUsername } });
    if (!target) return res.status(404).json({ error: 'user not found' });
    if (isSuperAdminRole(normalizeRole(target.role))) {
      return res.status(400).json({ error: 'The super admin account cannot be changed.' });
    }

    const updated = await prisma.user.update({
      where: { id: target.id },
      data: { role: defaultRole() },
    });

    res.json({ ok: true, user: updated });
  } catch (error) {
    logger.error('demote error', error);
    res.status(500).json({ error: 'failed' });
  }
});

app.post('/auth/wallet', authMiddleware, async (req, res) => {
  try {
    const { walletAddress } = req.body;
    const network = normalizeNetwork(req.body.network).id;
    const user = await prisma.user.findUnique({ where: { id: req.user.sub } });
    if (!user) return res.status(404).json({ error: 'user not found' });

    if (walletAddress !== null && walletAddress !== undefined) {
      if (typeof walletAddress !== 'string' || !isValidAddressForNetwork(walletAddress, normalizeNetwork(network))) {
        return res.status(400).json({ error: 'Invalid wallet address' });
      }
    }

    const profiles = user.walletProfiles && typeof user.walletProfiles === 'object'
      ? { ...user.walletProfiles }
      : {};

    if (walletAddress) {
      profiles[network] = walletAddress;
    } else {
      delete profiles[network];
    }

    const updated = await prisma.user.update({
      where: { id: req.user.sub },
      data: {
        walletAddress: walletAddress || null,
        walletProfiles: profiles,
        preferredNetwork: network,
      },
    });

    res.json({
      ok: true,
      walletAddress: updated.walletAddress,
      walletProfiles: updated.walletProfiles || {},
      preferredNetwork: updated.preferredNetwork || 'ethereum',
    });
  } catch (error) {
    logger.error('wallet save error', error);
    res.status(500).json({ error: 'failed' });
  }
});

app.post('/tasks', authMiddleware, async (req, res) => {
  try {
    const { action, agentId } = req.body;
    if (!action || typeof action !== 'string') {
      return res.status(400).json({ error: 'action is required' });
    }

    const task = await prisma.task.create({
      data: {
        id: uuidv4(),
        action,
        status: 'pending',
        userId: req.user.sub,
        agentId: agentId || null,
      },
    });

    await publish('agentfi:tasks', { type: 'task:created', data: sanitizeTask(task) });

    if (taskQueue) {
      await taskQueue.add(
        'processTask',
        { taskId: task.id, action, userId: req.user.sub, agentId: agentId || null },
        {
          attempts: 3,
          backoff: { type: 'exponential', delay: 2000 },
          removeOnComplete: { count: 100 },
          removeOnFail: { count: 50 },
        },
      );
    } else {
      void runTaskInline(task);
    }

    res.json(sanitizeTask(task));
  } catch (error) {
    logger.error('task create error', error);
    res.status(500).json({ error: 'failed' });
  }
});

app.get('/tasks', authMiddleware, async (req, res) => {
  try {
    const tasks = await prisma.task.findMany({
      where: { userId: req.user.sub, archived: false },
      orderBy: { createdAt: 'desc' },
      take: 100,
    });
    res.json(tasks.map(sanitizeTask));
  } catch {
    res.status(500).json({ error: 'failed' });
  }
});

app.get('/tasks/:id', authMiddleware, async (req, res) => {
  try {
    const task = await prisma.task.findFirst({
      where: { id: req.params.id, userId: req.user.sub },
      include: { messages: { orderBy: { createdAt: 'asc' } } },
    });
    if (!task) return res.status(404).json({ error: 'not found' });
    res.json(sanitizeTask(task));
  } catch {
    res.status(500).json({ error: 'failed' });
  }
});

app.patch('/tasks/:id', authMiddleware, async (req, res) => {
  try {
    const fields = {};
    const { status, result, archived } = req.body;
    if (status) fields.status = status;
    if (result !== undefined) fields.result = typeof result === 'string' ? result : JSON.stringify(result);
    if (typeof archived === 'boolean') fields.archived = archived;

    const existing = await prisma.task.findFirst({
      where: { id: req.params.id, userId: req.user.sub },
    });
    if (!existing) return res.status(404).json({ error: 'not found' });

    const task = await prisma.task.update({
      where: { id: req.params.id },
      data: fields,
    });
    await publish('agentfi:tasks', { type: 'task:updated', data: sanitizeTask(task) });
    res.json(sanitizeTask(task));
  } catch {
    res.status(500).json({ error: 'failed' });
  }
});

app.delete('/tasks/:id', authMiddleware, async (req, res) => {
  try {
    const existing = await prisma.task.findFirst({
      where: { id: req.params.id, userId: req.user.sub },
    });
    if (!existing) return res.status(404).json({ error: 'not found' });

    const task = await prisma.task.update({
      where: { id: req.params.id },
      data: { archived: true },
    });
    await publish('agentfi:tasks', { type: 'task:deleted', data: { id: task.id } });
    res.json({ ok: true, id: task.id });
  } catch {
    res.status(500).json({ error: 'failed' });
  }
});

app.delete('/tasks/all', authMiddleware, async (req, res) => {
  try {
    const result = await prisma.task.updateMany({
      where: { userId: req.user.sub, archived: false },
      data: { archived: true },
    });
    await publish('agentfi:tasks', { type: 'task:cleared', data: { deleted: result.count, userId: req.user.sub } });
    res.json({ deleted: result.count, ok: true });
  } catch (error) {
    logger.error('bulk delete error', error);
    res.status(500).json({ error: 'failed' });
  }
});

app.post('/payouts/prepare', authMiddleware, async (req, res) => {
  try {
    const network = normalizeNetwork(req.body.network).id;
    const amount = req.body.amount;
    const recipientAddress = req.body.recipientAddress || null;
    const sourceAction = typeof req.body.action === 'string' && req.body.action.trim()
      ? req.body.action.trim()
      : `Prepare routing plan for ${amount} on ${network}.`;

    const task = await prisma.task.create({
      data: {
        id: uuidv4(),
        action: sourceAction,
        status: 'running',
        userId: req.user.sub,
      },
    });

    await publish('agentfi:tasks', { type: 'task:created', data: sanitizeTask(task) });
    await publish('agentfi:tasks', { type: 'task:running', data: sanitizeTask(task) });

    const payout = await preparePayoutPlan({
      userId: req.user.sub,
      taskId: task.id,
      network,
      amount,
      recipientAddress,
    });

    const completedTask = await prisma.task.update({
      where: { id: task.id },
      data: {
        status: payout.status === 'blocked' ? 'failed' : 'completed',
        completedAt: new Date(),
        result: JSON.stringify({
          summary: payout.summary,
          payoutId: payout.id,
          network: payout.network,
          payoutStatus: payout.status,
        }),
      },
    });

    await publish('agentfi:tasks', {
      type: payout.status === 'blocked' ? 'task:failed' : 'task:completed',
      data: sanitizeTask(completedTask),
    });

    res.json({
      payout,
      task: sanitizeTask(completedTask),
    });
  } catch (error) {
    logger.error('prepare payout error', error);
    res.status(400).json({ error: error.message || 'Could not prepare payout.' });
  }
});

app.get('/payouts', authMiddleware, async (req, res) => {
  try {
    const payouts = await listPayouts(req.user.sub);
    res.json(payouts);
  } catch (error) {
    logger.error('list payouts error', error);
    res.status(500).json({ error: 'failed' });
  }
});

app.get('/payouts/:id/status', authMiddleware, async (req, res) => {
  try {
    const payout = await refreshPayoutStatus({ payoutId: req.params.id, userId: req.user.sub });
    res.json(payout);
  } catch (error) {
    logger.error('refresh payout status error', error);
    res.status(400).json({ error: error.message || 'Could not refresh payout status.' });
  }
});

app.get('/payouts/admin/queue', authMiddleware, requireAdmin, async (req, res) => {
  try {
    const queue = await listPayoutsForAdmin();
    res.json(queue);
  } catch (error) {
    logger.error('admin payout queue error', error);
    res.status(500).json({ error: 'Could not load the payout queue.' });
  }
});

app.post('/payouts/:id/approve', authMiddleware, requireAdmin, async (req, res) => {
  try {
    const payout = await approvePayout({
      payoutId: req.params.id,
      userId: req.user.sub,
      approvalToken: req.body?.approvalToken,
      actorRole: req.userRole,
    });
    res.json(payout);
  } catch (error) {
    logger.error('approve payout error', error);
    const message = typeof error?._raw === 'string' ? `The transaction could not be broadcast: ${error.message}` : (error.message || 'Could not approve payout.');
    const status = error.status || 400;
    res.status(status).json({ error: message });
  }
});

app.post('/payouts/:id/reject', authMiddleware, requireAdmin, async (req, res) => {
  try {
    const payout = await rejectPayout({
      payoutId: req.params.id,
      userId: req.user.sub,
      actorRole: req.userRole,
      reason: req.body?.reason,
    });
    res.json(payout);
  } catch (error) {
    logger.error('reject payout error', error);
    const status = error.status || 400;
    res.status(status).json({ error: error.message || 'Could not reject payout.' });
  }
});

app.use('/analytics', analyticsRouter);
app.use('/api/analytics', analyticsRouter);
app.use('/wallet', walletRouter);
app.use('/api/tasks/replay', replayRouter);
app.use('/auth/oauth', oauthRouter);

try {
  const factoryRouter = (await import('./routes/factory.js')).default;
  app.use('/api/factory', factoryRouter);
  app.use('/factory', factoryRouter);
  logger.info('Factory router mounted at /api/factory');
} catch (error) {
  logger.warn(`Factory router not found: ${error.message}`);
}

try {
  const coordinatorRouter = (await import('./routes/coordinator.js')).default;
  app.use('/api/coord', coordinatorRouter);
} catch (error) {
  logger.warn(`Coordinator router not found: ${error.message}`);
}

try {
  const agentsRouter = (await import('./routes/agents.js')).default;
  app.use('/agents', agentsRouter);
} catch (error) {
  logger.warn(`Agents router not found: ${error.message}`);
}

try {
  const dispatchRouter = typeof dispatchFactory === 'function'
    ? dispatchFactory({ redis })
    : (dispatchFactory.default || dispatchFactory);
  if (dispatchRouter) app.use('/api/dispatch', dispatchRouter);
} catch (error) {
  logger.warn(`Dispatch router failed: ${error.message}`);
}

try {
  const sessionsRouter = typeof sessionsFactory === 'function'
    ? sessionsFactory({ redis })
    : (sessionsFactory.default || sessionsFactory);
  if (sessionsRouter) app.use('/api/sessions', sessionsRouter);
} catch (error) {
  logger.warn(`Sessions router failed: ${error.message}`);
}

app.use(errorHandler);

if (redis) {
  const subscriber = new IORedis(REDIS_URL, { maxRetriesPerRequest: null });

  subscriber.subscribe('agentfi:tasks', 'agentfi:agents', (error, count) => {
    if (error) logger.error(`Redis subscribe error: ${error.message}`);
    else logger.info(`Subscribed to ${count} Redis channels`);
  });

  subscriber.on('message', (channel, message) => {
    wss.clients.forEach((client) => {
      if (client.readyState === 1) client.send(message);
    });
  });
}

wss.on('connection', (ws, req) => {
  logger.info(`WebSocket client connected from ${req.socket.remoteAddress}`);
  ws.on('error', (error) => logger.error(`WS error: ${error.message}`));
  ws.on('close', () => logger.info('WebSocket client disconnected'));
});

const PORT = process.env.PORT || 4000;

// Bootstrap admin role from server-side env config (never from the client).
bootstrapRun().catch((error) => logger.error(`Admin bootstrap failed: ${error.message}`));

server.listen(PORT, '0.0.0.0', () => {
  logger.info(`Server running on port ${PORT}`);
  logger.info(`Redis: ${redis ? 'connected' : 'disabled'}`);
  logger.info(`Queue: ${taskQueue ? 'enabled' : 'inline mode'}`);
});
