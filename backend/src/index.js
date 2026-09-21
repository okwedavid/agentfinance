import http from 'http';
import { execSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import express from 'express';
import cors from 'cors';
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
import walletRouter from './routes/wallet.js';
import { authMiddleware, createSessionForUser, requireAdmin, requireRole, resolveUserFromToken } from './middleware/auth.js';
import {
  ROLE_ADMIN,
  ROLE_SUPER_ADMIN,
  defaultRole,
  isSuperAdminRole,
  normalizeEmailAddress,
  normalizeRole,
  serializeUser,
  validateEmail,
  validatePassword,
  validateUsername,
} from './utils/security.js';
import oauthRouter from './routes/oauth.js';
import { assertOAuthConfiguration } from './services/oauthService.js';
import rateLimit, {
  loginLimiter,
  registerLimiter,
  verifyLimiter,
  taskCreateLimiter,
  payoutLimiter,
  factoryLimiter,
  dispatchLimiter,
} from './middleware/rateLimit.js';
import securityHeaders from './middleware/securityHeaders.js';
import errorHandler from './middleware/errorHandler.js';
import logger from './utils/logger.js';
import { executeAgentTask } from './services/agentService.js';
import { fallbackProvider, primaryProvider, providerModel } from './services/llmProvider.js';
import { computeUserEarnings, earningRateEth } from './services/earningsService.js';
import {
  getEmailProviderStatus,
  issueEmailVerificationToken,
  sendVerificationEmail,
  verifyEmailByToken,
} from './services/emailService.js';
import {
  DEFAULT_TASK_TIMEOUT_MS as DEFAULT_TIMEOUT_MS,
} from './agents/agentRunner.js';
import { classifyAgent } from './agents/taskClassifier.js';
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

// OAuth startup validation: if a provider is enabled but its redirect URI is
// unresolvable, fail clearly instead of shipping a broken callback. In
// production this blocks boot; in development it logs a clear warning.
const oauthValid = assertOAuthConfiguration();
if (!oauthValid && process.env.NODE_ENV === 'production') {
  logger.error('FATAL: OAuth configuration is invalid. Fix the redirect URI configuration and redeploy.');
  process.exit(1);
}

const prismaSchemaPath = fileURLToPath(new URL('../prisma/schema.prisma', import.meta.url));
const prismaBinPath = fileURLToPath(new URL('../node_modules/.bin/prisma', import.meta.url));

function syncDatabaseSchema() {
  logger.info('Applying database migrations (prisma migrate deploy)...');
  try {
    execSync(`"${prismaBinPath}" migrate deploy --schema="${prismaSchemaPath}"`, {
      stdio: 'inherit',
    });
  } catch (error) {
    logger.error('prisma migrate deploy failed', error);
    process.exit(1);
  }
}

// Ensure migrations are applied before serving traffic. Uses the non-destructive
// `prisma migrate deploy`: it applies only pending migration files and never
// runs sequence-requiring / data-loss commands like `db push --accept-data-loss`.
syncDatabaseSchema();

const app = express();
app.disable('x-powered-by');
// Render terminates TLS in front of the app; trusting the first proxy hop keeps
// req.ip correct for IP-keyed rate limiters.
app.set('trust proxy', 1);
const server = http.createServer(app);
const wss = new WebSocketServer({ server, maxPayload: 8 * 1024 });

const isProduction = process.env.NODE_ENV === 'production';

const configuredOrigins = (process.env.ALLOWED_ORIGINS || process.env.FRONTEND_URLS || '')
  .split(',')
  .map((origin) => origin.trim())
  .filter(Boolean);

// CORS: the production frontend is always allowed. Localhost origins are only
// enabled outside production — stale local/Railway origins must never be
// trusted against the live API.
const ALLOWED_ORIGINS = isProduction
  ? ['https://agentfinance.onrender.com', ...configuredOrigins]
  : ['https://agentfinance.onrender.com', 'http://localhost:3000', 'http://localhost:4000', ...configuredOrigins];

app.use(cors({
  origin: (origin, callback) => {
    // Non-browser clients (curl, healthchecks, servers) send no Origin header.
    if (!origin) return callback(null, true);
    return callback(null, ALLOWED_ORIGINS.includes(origin));
  },
  credentials: true,
}));
app.use(rateLimit);
app.use(securityHeaders);
app.use(express.json({ limit: '256kb' }));

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

function sanitizeTask(task) {
  const parsedResult = parseTaskResult(task.result);
  const summary = summariseTaskResult(parsedResult);
  return {
    ...task,
    result: parsedResult,
    summary,
  };
}

function envInt(name, fallback) {
  const parsed = Number.parseInt(process.env[name], 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function configuredAgentIds() {
  return (process.env.AGENTS || '')
    .split(',')
    .map((value) => value.trim())
    .filter(Boolean);
}

// Abuse protection for expensive AI jobs: bounded action size, an allowlisted
// agent target (never an arbitrary client-supplied name) and per-user active /
// concurrent task caps so a caller cannot flood unlimited work into the queue.
const MAX_TASK_ACTION_LENGTH = envInt('MAX_TASK_ACTION_LENGTH', 2000);
const MAX_ACTIVE_TASKS = envInt('MAX_ACTIVE_TASKS', 25);
const MAX_CONCURRENT_TASKS = envInt('MAX_CONCURRENT_TASKS', 3);
const MAX_TASK_RETRIES = envInt('MAX_TASK_RETRIES', 3);

function taskCapacityError(status, message) {
  const error = new Error(message);
  error.status = status;
  return error;
}

async function assertTaskCapacity(userId, { checkConcurrent = true } = {}) {
  const ACTIVE = ['pending', 'queued', 'running', 'retrying'];
  const rows = await prisma.task.findMany({
    where: { userId, archived: false, status: { in: ACTIVE } },
    select: { status: true },
  });
  if (rows.length >= MAX_ACTIVE_TASKS) {
    throw taskCapacityError(429, 'Too many active tasks. Archive or cancel a task before creating more.');
  }
  if (checkConcurrent) {
    const busy = rows.filter((row) => row.status !== 'pending' && row.status !== 'retrying').length;
    if (busy >= MAX_CONCURRENT_TASKS) {
      throw taskCapacityError(429, 'Too many tasks are running concurrently. Wait for one to finish.');
    }
  }
}

function normalizeAgentTarget(agentId) {
  if (typeof agentId !== 'string') return null;
  const value = agentId.trim();
  if (!value) return null;
  const agents = configuredAgentIds();
  if (agents.length === 0 || agents.includes(value)) return value;
  return null;
}

function llmRuntimeStatus() {
  let primary = null;
  let fallback = null;
  try {
    const p = primaryProvider();
    primary = p ? { id: p.id, model: providerModel(p) } : null;
  } catch (error) {
    primary = { error: error.message };
  }
  try {
    const f = fallbackProvider(primary?.id ? { id: primary.id } : null);
    fallback = f ? { id: f.id, model: providerModel(f) } : null;
  } catch (error) {
    fallback = { error: error.message };
  }
  return { primary, fallback, timeoutMs: process.env.AGENT_TASK_TIMEOUT_MS || DEFAULT_TIMEOUT_MS };
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
    llm: llmRuntimeStatus(),
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

  // Fleet status comes from agent heartbeats registered in Redis via
  // /api/coord/agents/register — never fabricated by index position. Agents
  // configured but not yet registered are reported as "configured".
  let registered = [];
  try {
    const raw = redis ? await redis.hgetall('agentfi:agents') : {};
    registered = Object.values(raw || {}).map((entry) => {
      try {
        return JSON.parse(entry);
      } catch {
        return null;
      }
    }).filter(Boolean);
  } catch {
    registered = [];
  }

  const configured = (process.env.AGENTS || process.env.NEXT_PUBLIC_AGENTS || '')
    .split(',')
    .map((name) => name.trim())
    .filter(Boolean);

  const seen = new Set();
  const fleet = configured.map((name) => {
    const registration = registered.find((r) => r.agentId === name || r.name === name);
    seen.add(name);
    return {
      id: name,
      label: name,
      status: registration ? registration.status || 'online' : 'configured',
      registered: !!registration,
      registeredAt: registration?.registeredAt || null,
    };
  });
  for (const r of registered) {
    if (seen.has(r.agentId) || seen.has(r.name)) continue;
    seen.add(r.agentId);
    fleet.push({
      id: r.agentId,
      label: r.name || r.agentId,
      status: r.status || 'online',
      registered: true,
      registeredAt: r.registeredAt || null,
    });
  }

  const user = await prisma.user.findUnique({ where: { id: req.user.sub } }).catch(() => null);
  const payoutRuntime = payoutRuntimeSnapshot();
  const earnings = await computeUserEarnings(req.user.sub);

  res.json({
    providers: providerFlags,
    providerCount: Object.values(providerFlags).filter(Boolean).length,
    llm: llmRuntimeStatus(),
    redis: !!redis,
    queueEnabled: !!taskQueue,
    fleet,
    walletAddress: user?.walletAddress || null,
    walletProfiles: user?.walletProfiles || {},
    preferredNetwork: user?.preferredNetwork || 'ethereum',
    earnings,
    payoutRuntime,
    earnings,
    earningsRateEth: earningRateEth(),
  });
});

app.get('/system/diagnostics', authMiddleware, async (req, res) => {
  let db = 'unknown';
  try {
    await prisma.$queryRaw`SELECT 1`;
    db = 'ok';
  } catch {
    // Never surface raw database driver errors to clients.
    db = 'error';
  }

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

  res.json({
    ok: true,
    time: Date.now(),
    db,
    redis: !!redis,
    queueEnabled: !!taskQueue,
    llm: llmRuntimeStatus(),
    providers: providerFlags,
    providerCount: Object.values(providerFlags).filter(Boolean).length,
    earningsRateEth: earningRateEth(),
    // Safe flags only; never API keys or other secrets.
    env: {
      NODE_ENV: process.env.NODE_ENV || 'development',
      PUBLISHER: typeof process.env.RENDER === 'string' ? 'render' : 'self-hosted',
      hasJwtSecret: !!process.env.JWT_SECRET,
      hasDatabaseUrl: !!process.env.DATABASE_URL,
      hasRedisUrl: !!process.env.REDIS_URL,
    },
  });
});

app.post('/auth/register', registerLimiter, async (req, res) => {
  try {
    const { password } = req.body;
    const trimmed = typeof req.body.username === 'string' ? req.body.username.trim() : '';
    const email = typeof req.body.email === 'string' && req.body.email.trim() ? req.body.email.trim().toLowerCase() : null;

    const usernameError = validateUsername(trimmed);
    if (usernameError) return res.status(400).json({ error: usernameError });

    const emailError = validateEmail(email);
    if (emailError) return res.status(400).json({ error: emailError });

    const passwordError = validatePassword(password);
    if (passwordError) return res.status(400).json({ error: passwordError });

    const existingUsername = await prisma.user.findUnique({ where: { username: trimmed } });
    if (existingUsername) return res.status(400).json({ error: 'Username is already taken.' });

    if (email) {
      const existingEmail = await prisma.user.findUnique({ where: { email } });
      if (existingEmail) return res.status(400).json({ error: 'Email is already registered.' });
    }

    const passwordHash = await bcrypt.hash(password, 10);
    const ownerUsername = process.env.SUPER_ADMIN_USERNAME || 'okwedavid';
    const role = trimmed === ownerUsername ? ROLE_SUPER_ADMIN : defaultRole();

    const normalizedEmail = normalizeEmailAddress(email);
    const data = {
      username: trimmed,
      passwordHash,
      role,
    };
    if (normalizedEmail) {
      const verificationToken = issueEmailVerificationToken();
      data.email = normalizedEmail;
      data.emailVerified = false;
      data.emailVerificationToken = verificationToken;
      data.emailVerificationExpiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000);
    }
    const user = await prisma.user.create({ data });
    const session = await createSessionForUser(user.id);
    const token = signToken({ sub: user.id, username: user.username, role: user.role, sid: session.id });

    if (normalizedEmail) {
      const frontendBase = process.env.FRONTEND_BASE_URL
        || (process.env.FRONTEND_URLS ? process.env.FRONTEND_URLS.split(',')[0].trim() : '')
        || 'https://agentfinance.onrender.com';
      void sendVerificationEmail({
        email: normalizedEmail,
        username: user.username,
        token: user.emailVerificationToken,
        baseUrl: frontendBase,
      }).catch(() => {});
    }

    res.json({
      ...serializeUser(user, { isNewUser: true }),
      token,
    });
  } catch (error) {
    if (error.code === 'P2002') {
      return res.status(400).json({ error: 'That username or email is already in use.' });
    }
    logger.error('register error', error);
    res.status(500).json({ error: 'registration failed' });
  }
});

app.post('/auth/login', loginLimiter, async (req, res) => {
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

app.post('/auth/verify', verifyLimiter, async (req, res) => {
  try {
    const token = typeof req.body?.token === 'string' ? req.body.token.trim() : '';
    const result = await verifyEmailByToken(token);
    if (!result.ok) return res.status(400).json({ error: result.error });
    res.json({ ok: true, email: result.email });
  } catch (error) {
    logger.error('email verify error', error);
    res.status(500).json({ error: 'failed' });
  }
});

app.get('/auth/verify', verifyLimiter, async (req, res) => {
  try {
    const token = typeof req.query?.token === 'string' ? req.query.token.trim() : '';
    const result = await verifyEmailByToken(token);
    if (!result.ok) return res.status(400).json({ error: result.error });
    res.json({ ok: true, email: result.email });
  } catch (error) {
    logger.error('email verify error', error);
    res.status(500).json({ error: 'failed' });
  }
});

app.get('/auth/email/provider', async (req, res) => {
  res.json(getEmailProviderStatus());
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

    res.json({ ok: true, redirect: '/login' });
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

app.post('/tasks', authMiddleware, taskCreateLimiter, async (req, res) => {
  try {
    const { action } = req.body;
    const agentId = normalizeAgentTarget(req.body.agentId);
    if (!action || typeof action !== 'string') {
      return res.status(400).json({ error: 'action is required' });
    }
    if (action.length > MAX_TASK_ACTION_LENGTH) {
      return res.status(400).json({ error: `Action is too long (max ${MAX_TASK_ACTION_LENGTH} characters).` });
    }

    await assertTaskCapacity(req.user.sub);

    const agentType = classifyAgent(action);
    const task = await prisma.task.create({
      data: {
        id: uuidv4(),
        action,
        status: 'queued',
        userId: req.user.sub,
        agentId,
      },
    });

    await publish('agentfi:tasks', {
      type: 'task:created',
      data: { id: task.id, status: 'queued', agentType },
      correlationId: task.id,
    });

    if (taskQueue) {
      await taskQueue.remove(task.id).catch(() => {});
      await taskQueue.add(
        'processTask',
        { taskId: task.id, action, userId: req.user.sub, agentId },
        {
          jobId: task.id,
          attempts: 1,
          removeOnComplete: { count: 100 },
          removeOnFail: { count: 50 },
        },
      );
    } else {
      void executeAgentTask({
        taskId: task.id,
        action,
        userId: req.user.sub,
        agentId,
        publish: (type, data) => publish('agentfi:tasks', { type, data }),
      });
    }

    res.json(sanitizeTask(task));
  } catch (error) {
    if (error?.status) return res.status(error.status).json({ error: error.message });
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
    // Server-authoritative task lifecycle. The client may only archive a task
    // or cancel it while it is still waiting/running. It can NEVER write
    // status to completed/failed, nor write a result/completedAt — those are
    // produced exclusively by executeAgentTask on the server.
    const existing = await prisma.task.findFirst({
      where: { id: req.params.id, userId: req.user.sub },
    });
    if (!existing) return res.status(404).json({ error: 'not found' });

    const fields = {};
    if (typeof req.body.archived === 'boolean') fields.archived = req.body.archived;

    const requestedStatus = req.body.status;
    if (requestedStatus !== undefined) {
      const next = String(requestedStatus).toLowerCase();
      if (next !== 'cancelled') {
        return res.status(403).json({ error: 'Task status can only be changed to "cancelled" by the client.' });
      }
      const ACTIVE = new Set(['queued', 'pending', 'running', 'retrying']);
      if (!ACTIVE.has(existing.status)) {
        return res.status(409).json({ error: `A ${existing.status} task cannot be cancelled.` });
      }
      fields.status = 'cancelled';
      fields.completedAt = new Date();
    }

    if (
      req.body.result !== undefined ||
      req.body.completedAt !== undefined ||
      req.body.startedAt !== undefined ||
      req.body.duration !== undefined
    ) {
      return res.status(403).json({ error: 'Task results are written by the server only.' });
    }

    if (Object.keys(fields).length === 0) {
      return res.status(400).json({ error: 'Nothing to update.' });
    }

    // Cancel/archive are persisted exactly as requested. They NEVER re-dispatch
    // a job: cancelling stops execution and archiving hides a task; retries go
    // through the explicit POST /tasks/:id/retry endpoint.
    const task = await prisma.task.update({
      where: { id: req.params.id },
      data: fields,
    });

    await publish('agentfi:tasks', { type: 'task:updated', data: sanitizeTask(task) });

    res.json(sanitizeTask(task));
  } catch (error) {
    logger.error('task patch error', error);
    res.status(500).json({ error: 'failed' });
  }
});

app.post('/tasks/:id/retry', authMiddleware, taskCreateLimiter, async (req, res) => {
  try {
    const existing = await prisma.task.findFirst({
      where: { id: req.params.id, userId: req.user.sub },
    });
    if (!existing) return res.status(404).json({ error: 'not found' });

    const RETRYABLE = new Set(['failed', 'cancelled', 'timed_out']);
    if (!RETRYABLE.has(existing.status)) {
      return res.status(409).json({ error: `Only failed or cancelled tasks can be retried (current: ${existing.status}).` });
    }

    if ((existing.retryCount || 0) >= MAX_TASK_RETRIES) {
      return res.status(429).json({ error: `This task has reached its retry limit (${MAX_TASK_RETRIES}).` });
    }

    await assertTaskCapacity(req.user.sub);

    // Re-queue the SAME task row: the id, earnings history and result are
    // preserved/cleared in place — never a duplicate execution record.
    const task = await prisma.task.update({
      where: { id: existing.id },
      data: {
        status: 'pending',
        startedAt: null,
        completedAt: null,
        duration: null,
        result: null,
        archived: false,
        retryCount: { increment: 1 },
      },
    });

    await publish('agentfi:tasks', { type: 'task:updated', data: sanitizeTask(task) });

    const jobData = {
      taskId: task.id,
      action: task.action,
      userId: task.userId,
      agentId: task.agentId || null,
    };

    if (taskQueue) {
      // jobId === task.id: a single idempotent job per task row, so the worker
      // recovery sweep can inspect the exact job responsible for this task.
      // The previous job (if any) is removed first so retries re-enqueue rather
      // than being swallowed by BullMQ's jobId unicity rule.
      await taskQueue.remove(task.id).catch(() => {});
      await taskQueue.add('processTask', jobData, {
        jobId: task.id,
        attempts: 1,
        removeOnComplete: { count: 100 },
        removeOnFail: { count: 50 },
      });
      await publish('agentfi:tasks', { type: 'task:queued', data: sanitizeTask(task) });
    } else {
      void executeAgentTask({
        ...jobData,
        publish: (type, data) => publish('agentfi:tasks', { type, data }),
      });
    }

    res.json(sanitizeTask(task));
  } catch (error) {
    logger.error('task retry error', error);
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

app.post('/payouts/prepare', authMiddleware, payoutLimiter, async (req, res) => {
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
app.use('/auth/oauth', oauthRouter);

try {
  const factoryRouter = (await import('./routes/factory.js')).default;
  app.use('/api/factory', factoryLimiter, factoryRouter);
  app.use('/factory', factoryLimiter, factoryRouter);
  logger.info('Factory router mounted at /api/factory');
} catch (error) {
  logger.warn(`Factory router not found: ${error.message}`);
}

try {
  const coordinatorRouter = (await import('./routes/coordinator.js')).default;
  app.use('/api/coord', factoryLimiter, coordinatorRouter);
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
  // authMiddleware runs first so the limiter can key on the resolved user id.
  if (dispatchRouter) app.use('/api/dispatch', authMiddleware, dispatchLimiter, dispatchRouter);
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

let subscriber = null;

if (REDIS_URL) {
  subscriber = new IORedis(REDIS_URL, { maxRetriesPerRequest: null });

  subscriber.subscribe('agentfi:tasks', 'agentfi:agents', (error, count) => {
    if (error) logger.error(`Redis subscribe error: ${error.message}`);
    else logger.info(`Subscribed to ${count} Redis channels`);
  });

  subscriber.on('message', (channel, message) => {
    // Deliver task events ONLY to sockets authenticated as the owning user;
    // fleet/factories events are broadcast to authenticated sockets.
    let scope = null;
    try {
      const parsed = JSON.parse(message);
      if (channel === 'agentfi:tasks') {
        scope = parsed?.data?.userId || null;
      }
    } catch {
      return;
    }
    wss.clients.forEach((client) => {
      if (client.readyState !== 1 || !client.userId) return;
      if (scope && client.userId !== scope) return;
      try {
        client.send(message);
      } catch {
        /* socket is closing; ignore */
      }
    });
  });
}

const WS_AUTH_TIMEOUT_MS = 10000;
const WS_HEARTBEAT_INTERVAL_MS = 30000;
const MAX_WS_PER_USER = 3;

wss.on('connection', (ws, req) => {
  logger.info(`WebSocket client connected from ${req.socket.remoteAddress}`);

  // Unauthenticated sockets get a short window to present a session JWT in
  // their FIRST message ({ type: 'auth', token }). The token never travels in
  // the query string.
  ws.isAuthenticated = false;
  ws.isAlive = true;
  ws.userId = null;

  const authTimer = setTimeout(() => {
    if (!ws.isAuthenticated) ws.close(4001, 'Authentication required');
  }, WS_AUTH_TIMEOUT_MS);

  ws.on('pong', () => { ws.isAlive = true; });

  ws.on('message', (buffer) => {
    let parsed;
    try {
      parsed = JSON.parse(buffer.toString());
    } catch {
      return;
    }
    if (!ws.isAuthenticated) {
      if (parsed?.type === 'auth' && typeof parsed.token === 'string') {
        resolveUserFromToken(parsed.token)
          .then((user) => {
            if (!user) return ws.close(4001, 'Authentication failed');
            let count = 0;
            for (const client of wss.clients) {
              if (client.userId === user.id) count += 1;
            }
            if (count >= MAX_WS_PER_USER) {
              return ws.close(4002, 'Too many connections');
            }
            ws.userId = user.id;
            ws.isAuthenticated = true;
            clearTimeout(authTimer);
            ws.send(JSON.stringify({ type: 'auth:ok' }));
          })
          .catch(() => ws.close(4001, 'Authentication failed'));
      }
      return;
    }
    // Authenticated clients may send ping/pong keepalives; other messages are
    // ignored (control plane is server-driven).
    if (parsed?.type === 'pong') ws.isAlive = true;
  });

  ws.on('error', (error) => logger.error(`WS error: ${error.message}`));
  ws.on('close', () => logger.info('WebSocket client disconnected'));
});

const heartbeatInterval = setInterval(() => {
  wss.clients.forEach((client) => {
    if (client.isAlive === false) return client.terminate();
    client.isAlive = false;
    try {
      client.ping();
    } catch {
      /* socket is closing; ignore */
    }
  });
}, WS_HEARTBEAT_INTERVAL_MS);
heartbeatInterval.unref?.();

const PORT = process.env.PORT || 4000;

// Bootstrap admin role from server-side env config (never from the client).
bootstrapRun().catch((error) => logger.error(`Admin bootstrap failed: ${error.message}`));

server.listen(PORT, '0.0.0.0', () => {
  logger.info(`Server running on port ${PORT}`);
  logger.info(`Redis: ${redis ? 'connected' : 'disabled'}`);
  logger.info(`Queue: ${taskQueue ? 'enabled' : 'inline mode'}`);
});

// Graceful shutdown: stop accepting connections, drain the HTTP server, close
// WebSocket clients, then release Redis / BullMQ / Prisma resources.
function shutdown(signal) {
  logger.info(`Received ${signal}; shutting down gracefully`);
  clearInterval(heartbeatInterval);

  const forceExit = setTimeout(() => {
    logger.warn('Graceful shutdown timed out; forcing exit');
    process.exit(1);
  }, 15000);
  forceExit.unref();

  server.close(() => {
    (async () => {
      wss.clients.forEach((client) => client.terminate());
      try { if (subscriber) await subscriber.quit(); } catch { /* noop */ }
      try { if (redis && typeof redis.quit === 'function') await redis.quit(); } catch { /* noop */ }
      try { if (taskQueue && typeof taskQueue.close === 'function') await taskQueue.close(); } catch { /* noop */ }
      try { await prisma.$disconnect(); } catch { /* noop */ }
      logger.info('Shutdown complete');
      process.exit(0);
    })();
  });

  // Do not let keep-alive HTTP connections stall shutdown.
  if (typeof server.closeIdleConnections === 'function') server.closeIdleConnections();
}
process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));
