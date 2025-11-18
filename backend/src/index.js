import express from 'express';
import cors from 'cors';
import cookieParser from 'cookie-parser';
import { task, agent, user } from './prismaClient.js';
import IORedis from 'ioredis';
import { PrismaClient } from '@prisma/client';
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
let agentTasksRouter = null;

// JWT secret
const JWT_SECRET = process.env.JWT_SECRET || 'please_change_me_locally';

const prisma = new PrismaClient();
const app = express();

app.use(cors({ origin: true, credentials: true }));
// apply rate limiter globally
app.use(rateLimit);
app.use(express.json());
app.use(cookieParser());

const REDIS_URL = process.env.REDIS_URL || 'redis://redis:6379';
const redis = new IORedis(REDIS_URL, { maxRetriesPerRequest: null });

// BullMQ queue for tasks (reuse ioredis client)
const taskQueue = new Queue('agent-tasks', { connection: redis });

// --- Auth helpers ---
function signToken(payload) {
  return jwt.sign(payload, JWT_SECRET, { expiresIn: '7d' });
}

async function authMiddleware(req, res, next) {
  try {
    const token = req.cookies && req.cookies.token || req.headers.authorization && req.headers.authorization.split(' ')[1];
    if (!token) return res.status(401).json({ error: 'unauthenticated' });
    const decoded = jwt.verify(token, JWT_SECRET);
    req.user = decoded;
    next();
  } catch (err) {
    return res.status(401).json({ error: 'unauthenticated' });
  }
}

// route modules will be loaded if present
let agentsRouter = null;
let tasksRouter = null;

try { 
  const mod = await import('./routes/agents.js'); 
  agentsRouter = mod.default || mod; 
} catch(e) { 
  console.log('agents router not found at startup'); 
}
try { 
  const mod = await import('./routes/tasks.js'); 
  const factory = mod.default || mod; 
  tasksRouter = (typeof factory === 'function') ? factory({ redis, taskQueue, authMiddleware }) : factory; 
} catch(e) { 
  console.log('tasks router not found at startup'); 
}
try {
  const mod = await import('./routes/agentTasks.ts');
  agentTasksRouter = mod.default || mod;
} catch(e) {
  try {
    const modJs = await import('./routes/agentTasks.js');
    agentTasksRouter = modJs.default || modJs;
  } catch(e2) {
    console.log('agentTasks router not found at startup');
  }
}

app.get('/health', (req, res) => res.json({ status: 'ok', time: Date.now() }));

// legacy task create (protected)
app.post('/tasks', authMiddleware, async (req, res) => {
  try {
    const { action, payload, agentId } = req.body;
    // basic validation
    if (!action || typeof action !== 'string') return res.status(400).json({ error: 'invalid action' });

    const id = uuidv4();
    const t = await task.create({
      data: {
        id,
        action,
        status: 'pending',
        ...(agentId ? { agentId } : {}),
      },
    });

    // enqueue job
    await taskQueue.add('runTask', { taskId: t.id }, { attempts: 3, backoff: { type: 'exponential', delay: 1000 } });

    // publish initial creation event for UI
    await redis.publish('agentfi:tasks', JSON.stringify({ type: 'task:created', data: t }));
    res.json(t);
  } catch (e) {
    console.error('❌ Error creating task', e);
    if (e instanceof Error) {
      console.error('Error details:', e.message, e.stack);
      if (e.meta) console.error('Prisma meta:', e.meta);
    } else {
      console.error('Unknown error:', e);
    }
    res.status(500).json({ error: 'failed' });
  }
});

// List tasks (simple paginated endpoint)
app.get('/tasks', authMiddleware, async (req, res) => {
  try {
    const tasks = await task.findMany({ orderBy: { createdAt: 'desc' }, take: 50 });
    res.json(tasks);
  } catch (e) {
    console.error('❌ Error fetching tasks', e);
    res.status(500).json({ error: 'failed' });
  }
});

// --- Auth routes ---
app.post('/auth/register', async (req, res) => {
  try {
    const { username, password } = req.body;
    if (!username || !password) return res.status(400).json({ error: 'username and password required' });
    const existing = await user.findUnique({ where: { username } });
    if (existing) return res.status(400).json({ error: 'username taken' });
    const hash = await bcrypt.hash(password, 10);
    const u = await user.create({ data: { username, passwordHash: hash } });
  const token = signToken({ sub: u.id, username: u.username });
  res.cookie('token', token, { httpOnly: true, maxAge: 7 * 24 * 60 * 60 * 1000 });
  res.json({ id: u.id, username: u.username, token });
  } catch (err) {
    console.error('register error', err);
    res.status(500).json({ error: 'failed' });
  }
});

app.post('/auth/login', async (req, res) => {
  try {
    const { username, password } = req.body;
    if (!username || !password) return res.status(400).json({ error: 'username and password required' });
    const u = await user.findUnique({ where: { username } });
    if (!u) return res.status(401).json({ error: 'invalid' });
    const ok = await bcrypt.compare(password, u.passwordHash);
    if (!ok) return res.status(401).json({ error: 'invalid' });
  const token = signToken({ sub: u.id, username: u.username });
  res.cookie('token', token, { httpOnly: true, maxAge: 7 * 24 * 60 * 60 * 1000 });
  res.json({ id: u.id, username: u.username, token });
  } catch (err) {
    console.error('login error', err);
    res.status(500).json({ error: 'failed' });
  }
});


// mount routers
if(agentsRouter) app.use('/agents', agentsRouter);
if(tasksRouter) app.use('/tasks', tasksRouter);
// mount dispatch under /api/dispatch
try {
  const dispatchRouter = (typeof dispatchFactory === 'function') ? dispatchFactory({ redis }) : (dispatchFactory.default || dispatchFactory);
  if (dispatchRouter) app.use('/api/dispatch', dispatchRouter);
} catch (e) {
  console.warn('dispatch router failed to mount:', e.message || e);
}
// mount replay endpoint under /api/tasks/replay
app.use('/api/tasks/replay', replayRouter);
app.use('/analytics', analyticsRouter);
// also expose analytics under /api/analytics for frontend compatibility
app.use('/api/analytics', analyticsRouter);
if(agentTasksRouter) app.use('/api/agent', agentTasksRouter);
// global error handler (should be last middleware)
app.use(errorHandler);
try {
  const coordinatorRouter = (await import('./routes/coordinator.js')).default;
  app.use('/api/coord', coordinatorRouter);
  console.log('Coordinator router mounted at /api/coord');
} catch (e) {
  console.warn('Coordinator router not found:', e.message);
}

// mount sessions
try {
  const sessionsRouter = (typeof sessionsFactory === 'function') ? sessionsFactory({ redis }) : (sessionsFactory.default || sessionsFactory);
  if (sessionsRouter) app.use('/api/sessions', sessionsRouter);
} catch (e) {
  console.warn('sessions router failed to mount:', e.message || e);
}

// --- 🧠 Helper: Wait for DB connection before proceeding ---
async function waitForDb(maxRetries = 10, delayMs = 3000) {
  for (let i = 0; i < maxRetries; i++) {
    try {
      await prisma.$queryRaw`SELECT 1`;
      console.log('✅ Database connection established');
      return;
    } catch (err) {
      console.log(`⏳ Waiting for database... (${i + 1}/${maxRetries})`);
      await new Promise(r => setTimeout(r, delayMs));
    }
  }
  throw new Error('Database not ready after multiple retries');
}

const port = process.env.PORT_BACKEND || 4000;

app.listen(port, async () => {
  console.log(`🚀 Backend listening on ${port}`);

  try {
    await waitForDb();

    if (process.env.SEED_ON_START === 'true') {
      console.log('🌱 Seeding database...');
      try {
        // Import dynamically so Docker won't crash if seed has issues
        const seed = await import('../prisma/seed.js');
        if (seed.default) await seed.default();
        console.log('✅ Seed completed');
      } catch (e) {
        console.warn('⚠️ Seed failed:', e.message);
      }
    }
  } catch (err) {
    console.error('❌ Database initialization failed:', err.message);
  }
});
