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
  return {
    ...task,
    result: parseTaskResult(task.result),
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

  try {
    const result = await runAgent({
      action: task.action,
      agentType: classifyAgent(task.action),
      walletAddress: user?.walletAddress || null,
    });

    const updated = await prisma.task.update({
      where: { id: task.id },
      data: {
        status: 'completed',
        completedAt: new Date(),
        result: JSON.stringify({
          output: result.output,
          summary: result.output?.slice(0, 280) || '',
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

  res.json({
    providers: providerFlags,
    providerCount: Object.values(providerFlags).filter(Boolean).length,
    redis: !!redis,
    queueEnabled: !!taskQueue,
    fleet,
    walletAddress: user?.walletAddress || null,
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
    res.json({ id: user.id, username: user.username, token, isAdmin: user.username === 'okwedavid' });
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
    res.json({ id: user.id, username: user.username, token, walletAddress: user.walletAddress, isAdmin: user.username === 'okwedavid' });
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
      walletAddress: user.walletAddress,
      isAdmin: user.username === 'okwedavid',
    });
  } catch {
    res.status(500).json({ error: 'failed' });
  }
});

app.post('/auth/wallet', authMiddleware, async (req, res) => {
  try {
    const { walletAddress } = req.body;
    if (walletAddress !== null && walletAddress !== undefined) {
      if (typeof walletAddress !== 'string' || !walletAddress.startsWith('0x') || walletAddress.length !== 42) {
        return res.status(400).json({ error: 'Invalid wallet address' });
      }
    }

    const user = await prisma.user.update({
      where: { id: req.user.sub },
      data: { walletAddress: walletAddress || null },
    });

    res.json({ ok: true, walletAddress: user.walletAddress });
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
