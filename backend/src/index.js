import http from 'http';
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
import rateLimit from './middleware/rateLimit.js';
import errorHandler from './middleware/errorHandler.js';
import logger from './utils/logger.js';
import runAgent from './agents/agentRunner.js';
import {
  approvePayout,
  listPayouts,
  payoutRuntimeSnapshot,
  preparePayoutPlan,
  refreshPayoutStatus,
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

const app = express();
const server = http.createServer(app);
const wss = new WebSocketServer({ server });

const configuredOrigins = (process.env.ALLOWED_ORIGINS || process.env.FRONTEND_URLS || '')
  .split(',')
  .map((origin) => origin.trim())
  .filter(Boolean);

const ALLOWED_ORIGINS = [
  'https://agentfinance-production.up.railway.app',
  'https://agentfinance-production.up.railway.com',
  'https://serene-magic-production-6d0c.up.railway.app',
  'http://localhost:3000',
  'http://localhost:4000',
  ...configuredOrigins,
];

app.use(cors({
  origin: (origin, callback) => {
    if (!origin) return callback(null, true);
    const allowed = ALLOWED_ORIGINS.includes(origin);
    return callback(allowed ? null : new Error('CORS blocked'), allowed);
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

function getTokenFromRequest(req) {
  const authHeader = req.headers.authorization;
  if (authHeader?.startsWith('Bearer ')) return authHeader.slice(7);
  return req.cookies?.token || null;
}

function authMiddleware(req, res, next) {
  try {
    const token = getTokenFromRequest(req);
    if (!token) return res.status(401).json({ error: 'unauthenticated' });
    req.user = jwt.verify(token, JWT_SECRET);
    return next();
  } catch {
    return res.status(401).json({ error: 'unauthenticated' });
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
    if (!username || !password) {
      return res.status(400).json({ error: 'username and password required' });
    }
    const existing = await prisma.user.findUnique({ where: { username } });
    if (existing) return res.status(400).json({ error: 'username taken' });

    const passwordHash = await bcrypt.hash(password, 10);
    const user = await prisma.user.create({
      data: { username, passwordHash },
    });
    const token = signToken({ sub: user.id, username: user.username });

    res.cookie('token', token, { httpOnly: true, maxAge: 7 * 24 * 60 * 60 * 1000 });
    res.json({
      id: user.id,
      username: user.username,
      displayName: user.displayName,
      bio: user.bio,
      walletAddress: user.walletAddress,
      walletProfiles: user.walletProfiles || {},
      preferredNetwork: user.preferredNetwork || 'ethereum',
      token,
      isAdmin: user.username === 'okwedavid',
    });
  } catch (error) {
    logger.error('register error', error);
    res.status(500).json({ error: 'failed' });
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

    const token = signToken({ sub: user.id, username: user.username });
    res.cookie('token', token, { httpOnly: true, maxAge: 7 * 24 * 60 * 60 * 1000 });
    res.json({
      id: user.id,
      username: user.username,
      displayName: user.displayName,
      bio: user.bio,
      token,
      walletAddress: user.walletAddress,
      walletProfiles: user.walletProfiles || {},
      preferredNetwork: user.preferredNetwork || 'ethereum',
      isAdmin: user.username === 'okwedavid',
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
    res.json({
      id: user.id,
      username: user.username,
      displayName: user.displayName,
      bio: user.bio,
      walletAddress: user.walletAddress,
      walletProfiles: user.walletProfiles || {},
      preferredNetwork: user.preferredNetwork || 'ethereum',
      isAdmin: user.username === 'okwedavid',
    });
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

    res.json({
      id: updated.id,
      username: updated.username,
      displayName: updated.displayName,
      bio: updated.bio,
      walletAddress: updated.walletAddress,
      walletProfiles: updated.walletProfiles || {},
      preferredNetwork: updated.preferredNetwork || 'ethereum',
      isAdmin: updated.username === 'okwedavid',
    });
  } catch (error) {
    logger.error('profile update error', error);
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

app.post('/payouts/:id/approve', authMiddleware, async (req, res) => {
  try {
    const payout = await approvePayout({ payoutId: req.params.id, userId: req.user.sub });
    res.json(payout);
  } catch (error) {
    logger.error('approve payout error', error);
    res.status(400).json({ error: error.message || 'Could not approve payout.' });
  }
});

app.use('/analytics', analyticsRouter);
app.use('/api/analytics', analyticsRouter);
app.use('/wallet', walletRouter);
app.use('/api/tasks/replay', replayRouter);

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
server.listen(PORT, '0.0.0.0', () => {
  logger.info(`Server running on port ${PORT}`);
  logger.info(`Redis: ${redis ? 'connected' : 'disabled'}`);
  logger.info(`Queue: ${taskQueue ? 'enabled' : 'inline mode'}`);
});
