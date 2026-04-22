/**
 * Backend entry point.
 * Starts Express + WebSocket server AND the BullMQ agent worker.
 * The worker runs in the same process — for high scale, split into a separate Railway service.
 */
import walletRouter from './routes/wallet.js';
import IORedis from 'ioredis';
import http from 'http';
import { WebSocketServer } from 'ws';
import express from 'express';
import cors from 'cors';
import cookieParser from 'cookie-parser';
import prisma from './prismaClient.js';
import { Queue } from 'bullmq';
import { v4 as uuidv4 } from 'uuid';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import analyticsRouter from './routes/analytics.js';
import dispatchFactory from './routes/dispatch.js';
import sessionsFactory from './routes/sessions.js';
import rateLimit from './middleware/rateLimit.js';
import errorHandler from './middleware/errorHandler.js';
import replayRouter from './routes/replay.js';
import logger from './utils/logger.js';
import walletRouter from './routes/wallet.js';   

// ── Boot agent worker (non-blocking import) ──────────────────────────────────
import './workers/agentWorker.js';
logger.info('Agent worker module loaded');

const JWT_SECRET = process.env.JWT_SECRET;
if (!JWT_SECRET) {
  logger.error('FATAL: JWT_SECRET env var is not set. Set it in Railway environment variables.');
  process.exit(1);
}

const app = express();
const server = http.createServer(app);
const wss = new WebSocketServer({ server });

// ── CORS ─────────────────────────────────────────────────────────────────────

const configuredOrigins = (process.env.ALLOWED_ORIGINS || process.env.FRONTEND_URLS || '')
  .split(',').map(o => o.trim()).filter(Boolean);

const ALLOWED_ORIGINS = [
  'https://agentfinance-production.up.railway.app',
  'https://serene-magic-production-6d0c.up.railway.app',
  'http://localhost:3000',
  'http://localhost:4000',
  ...configuredOrigins,
];

app.use(cors({
  origin: (origin, callback) => {
    if (!origin) return callback(null, true);
    const allowed = ALLOWED_ORIGINS.some(o => o === origin);
    callback(allowed ? null : new Error('CORS blocked'), allowed);
  },
  credentials: true,
}));

app.use(rateLimit);
app.use(express.json());
app.use(cookieParser());

// ── Redis ─────────────────────────────────────────────────────────────────────

const REDIS_URL = process.env.REDIS_URL;
const redis = REDIS_URL
  ? new IORedis(REDIS_URL, { maxRetriesPerRequest: null })
  : null;

if (!redis) logger.warn('No REDIS_URL — queuing and real-time events disabled');

const taskQueue = redis ? new Queue('agent-tasks', { connection: redis }) : null;

// ── Auth helpers ──────────────────────────────────────────────────────────────

function signToken(payload) {
  return jwt.sign(payload, JWT_SECRET, { expiresIn: '7d' });
}

async function authMiddleware(req, res, next) {
  try {
    const token = (req.cookies && req.cookies.token) ||
                  (req.headers.authorization && req.headers.authorization.split(' ')[1]);
    if (!token) return res.status(401).json({ error: 'unauthenticated' });
    const decoded = jwt.verify(token, JWT_SECRET);
    req.user = decoded;
    next();
  } catch {
    return res.status(401).json({ error: 'unauthenticated' });
  }
}

// ── Routes ────────────────────────────────────────────────────────────────────

app.get('/health', (req, res) => res.json({ status: 'ok', time: Date.now() }));

// Auth
app.post('/auth/register', async (req, res) => {
  try {
    const { username, password } = req.body;
    if (!username || !password) return res.status(400).json({ error: 'username and password required' });
    const existing = await prisma.user.findUnique({ where: { username } });
    if (existing) return res.status(400).json({ error: 'username taken' });
    const hash = await bcrypt.hash(password, 10);
    const u = await prisma.user.create({ data: { username, passwordHash: hash } });
    const token = signToken({ sub: u.id, username: u.username });
    res.cookie('token', token, { httpOnly: true, maxAge: 7 * 24 * 60 * 60 * 1000 });
    res.json({ id: u.id, username: u.username, token });
  } catch (err) {
    logger.error('register error', err);
    res.status(500).json({ error: 'failed' });
  }
});

app.post('/auth/login', async (req, res) => {
  try {
    const { username, password } = req.body;
    if (!username || !password) return res.status(400).json({ error: 'username and password required' });
    const u = await prisma.user.findUnique({ where: { username } });
    if (!u) return res.status(401).json({ error: 'invalid credentials' });
    const ok = await bcrypt.compare(password, u.passwordHash);
    if (!ok) return res.status(401).json({ error: 'invalid credentials' });
    const token = signToken({ sub: u.id, username: u.username });
    res.cookie('token', token, { httpOnly: true, maxAge: 7 * 24 * 60 * 60 * 1000 });
    res.json({ id: u.id, username: u.username, token });
  } catch (err) {
    logger.error('login error', err);
    res.status(500).json({ error: 'failed' });
  }
});

app.get('/auth/me', authMiddleware, async (req, res) => {
  try {
    const u = await prisma.user.findUnique({ where: { id: req.user.sub } });
    if (!u) return res.status(404).json({ error: 'user not found' });
    res.json({ id: u.id, username: u.username, walletAddress: u.walletAddress });
  } catch {
    res.status(500).json({ error: 'failed' });
  }
});

app.post('/auth/wallet', authMiddleware, async (req, res) => {
  try {
    const { walletAddress } = req.body;
    // Store in User model if it has walletAddress field
    // Otherwise just return success (frontend uses localStorage)
    try {
      await prisma.user.update({
        where: { id: req.user.sub },
        data: { walletAddress: walletAddress || null },
      });
    } catch {
      // walletAddress field may not exist in schema yet — that's OK
    }
    res.json({ ok: true, walletAddress });
  } catch (e) {
    res.status(500).json({ error: 'failed' });
  }
});

// Save wallet address for the logged-in user
app.post('/auth/wallet', authMiddleware, async (req, res) => {
  try {
    const { walletAddress } = req.body;
    if (!walletAddress || !walletAddress.startsWith('0x')) {
      return res.status(400).json({ error: 'Invalid wallet address' });
    }
    const u = await prisma.user.update({
      where: { id: req.user.sub },
      data: { walletAddress },
    });
    logger.info(`Wallet saved for user ${req.user.sub}: ${walletAddress}`);
    res.json({ ok: true, walletAddress: u.walletAddress });
  } catch (err) {
    logger.error('wallet save error', err);
    res.status(500).json({ error: 'failed' });
  }
});

// Create task — now includes userId for agent context
app.post('/tasks', authMiddleware, async (req, res) => {
  try {
    const { action, agentId } = req.body;
    if (!action || typeof action !== 'string') {
      return res.status(400).json({ error: 'action is required' });
    }

    const t = await prisma.task.create({
      data: {
        id: uuidv4(),
        action,
        status: 'pending',
        userId: req.user.sub,
        ...(agentId ? { agentId } : {}),
      },
    });

    // Enqueue for the agent worker
    if (taskQueue) {
      await taskQueue.add(
        'processTask',
        { taskId: t.id, action, userId: req.user.sub, agentId },
        {
          attempts: 3,
          backoff: { type: 'exponential', delay: 2000 },
          removeOnComplete: { count: 100 },
          removeOnFail: { count: 50 },
        }
      );
      logger.info(`Task ${t.id} enqueued for agent processing`);
    } else {
      logger.warn(`Task ${t.id} created but not queued — Redis unavailable`);
    }

    if (!redis) {
  // No Redis/BullMQ — run agent directly
  import('./agents/agentRunner.js').then(({ runAgent }) => {
    runAgent({ action, agentType: 'coordinator' })
      .then(result => prisma.task.update({
        where: { id: t.id },
        data: { status: 'completed', result: JSON.stringify(result), completedAt: new Date() }
      }))
      .catch(err => prisma.task.update({
        where: { id: t.id },
        data: { status: 'failed', result: JSON.stringify({ error: err.message }), completedAt: new Date() }
      }));
  }).catch(() => {});
}

    if (redis) {
      await redis.publish('agentfi:tasks', JSON.stringify({ type: 'task:created', data: t }));
    }

    res.json(t);
  } catch (err) {
    logger.error('task create error', err);
    res.status(500).json({ error: 'failed' });
  }
});

// List tasks for the logged-in user
app.get('/tasks', authMiddleware, async (req, res) => {
  try {
    const tasks = await prisma.task.findMany({
      where: { userId: req.user.sub, archived: false },
      orderBy: { createdAt: 'desc' },
      take: 50,
    });
    res.json(tasks);
  } catch {
    res.status(500).json({ error: 'failed' });
  }
});

app.get('/tasks/:id', authMiddleware, async (req, res) => {
  try {
    const t = await prisma.task.findUnique({
      where: { id: req.params.id },
      include: { messages: { orderBy: { createdAt: 'asc' } } },
    });
    if (!t) return res.status(404).json({ error: 'not found' });
    res.json(t);
  } catch {
    res.status(500).json({ error: 'failed' });
  }
});

app.delete('/tasks/all', authMiddleware, async (req, res) => {
  try {
    const result = await prisma.task.deleteMany({});
    res.json({ deleted: result.count, ok: true });
  } catch (e) {
    console.error('bulk delete error', e);
    res.status(500).json({ error: 'failed' });
  }
});

app.patch('/tasks/:id', authMiddleware, async (req, res) => {
  try {
    const fields = {};
    const { status, result, archived } = req.body;
    if (status) fields.status = status;
    if (result) fields.result = result;
    if (typeof archived === 'boolean') fields.archived = archived;
    const t = await prisma.task.update({ where: { id: req.params.id }, data: fields });
    if (redis) await redis.publish('agentfi:tasks', JSON.stringify({ type: 'task:updated', data: t }));
    res.json(t);
  } catch {
    res.status(500).json({ error: 'failed' });
  }
});

// Mount route modules
app.use('/analytics', analyticsRouter);
app.use('/api/analytics', analyticsRouter);
app.use('/wallet', walletRouter);  
app.use('/api/tasks/replay', replayRouter);

try {
  const coordinatorRouter = (await import('./routes/coordinator.js')).default;
  app.use('/api/coord', coordinatorRouter);
} catch (e) {
  logger.warn('Coordinator router not found:', e.message);
}

try {
  const agentsRouter = (await import('./routes/agents.js')).default;
  app.use('/agents', agentsRouter);
} catch (e) {
  logger.warn('Agents router not found:', e.message);
}

try {
  const dispatchRouter = (typeof dispatchFactory === 'function')
    ? dispatchFactory({ redis })
    : (dispatchFactory.default || dispatchFactory);
  if (dispatchRouter) app.use('/api/dispatch', dispatchRouter);
} catch (e) {
  logger.warn('Dispatch router failed:', e.message);
}

try {
  const sessionsRouter = (typeof sessionsFactory === 'function')
    ? sessionsFactory({ redis })
    : (sessionsFactory.default || sessionsFactory);
  if (sessionsRouter) app.use('/api/sessions', sessionsRouter);
} catch (e) {
  logger.warn('Sessions router failed:', e.message);
}

app.use(errorHandler);

// ── WebSocket — subscribe to Redis and fan out to all WS clients ─────────────

if (redis) {
  const subscriber = new IORedis(REDIS_URL, { maxRetriesPerRequest: null });

  subscriber.subscribe('agentfi:tasks', 'agentfi:agents', (err, count) => {
    if (err) logger.error('Redis subscribe error:', err.message);
    else logger.info(`Subscribed to ${count} Redis channels`);
  });

  subscriber.on('message', (channel, message) => {
    wss.clients.forEach(client => {
      if (client.readyState === 1) { // OPEN
        client.send(message);
      }
    });
  });
}

wss.on('connection', (ws, req) => {
  logger.info(`WebSocket client connected from ${req.socket.remoteAddress}`);
  ws.on('error', (err) => logger.error('WS error:', err.message));
  ws.on('close', () => logger.info('WebSocket client disconnected'));
});

// ── Start ─────────────────────────────────────────────────────────────────────

const PORT = process.env.PORT || 4000;
server.listen(PORT, '0.0.0.0', () => {
  logger.info(`Server running on port ${PORT}`);
  logger.info(`Agent worker: active`);
  logger.info(`Redis: ${redis ? 'connected' : 'not available'}`);
});