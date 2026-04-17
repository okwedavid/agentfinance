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
let agentTasksRouter = null;

// JWT secret
const JWT_SECRET = process.env.JWT_SECRET;

const app = express();
const server = http.createServer(app); // One server to rule them all

app.get('/health', (req, res) => {
  res.status(200).json({ status: 'ok' });
});

const wss = new WebSocketServer({ server }); 


const ALLOWED_ORIGINS = [
  'https://serene-magic-production-6d0c.up.railway.app',
  'http://localhost:4000',
];


app.use(cors({
  origin: (origin, callback) => {
    if (!origin) return callback(null, true); // server-to-server
    const allowed = ALLOWED_ORIGINS.some(o =>
      typeof o === 'string' ? o === origin : o.test(origin)
    );
    callback(allowed ? null : new Error('CORS blocked'), allowed);
  },
  credentials: true,
}));

// apply rate limiter globally
app.use(rateLimit);
app.use(express.json());
app.use(cookieParser()); 

const REDIS_URL = process.env.REDIS_URL;
// Only initialize if the URL exists
const redis = REDIS_URL 
  ? new IORedis(REDIS_URL, { maxRetriesPerRequest: null }) 
  : null;

if (!redis) {
  console.warn("⚠️ Redis URL not found. Caching/Queues will be disabled.");
}

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

app.get('/auth/me', authMiddleware, async (req, res) => {
  try {
    const u = await prisma.user.findUnique({ where: { id: req.user.sub } });
    if (!u) return res.status(404).json({ error: 'user not found' });
    res.json({ id: u.id, username: u.username });
  } catch (e) {
    res.status(500).json({ error: 'failed' });
  }
});

// legacy task create (protected)
app.post('/tasks', authMiddleware, async (req, res) => {
  try {
    const { action, payload, agentId } = req.body;
    // basic validation
    if (!action || typeof action !== 'string') return res.status(400).json({ error: 'invalid action' });

    const id = uuidv4();
    const t = await prisma.task.create({
      data: {
        id,
        action,
        status: 'pending',
        ...(agentId ? { agentId } : {}),
      },
    });

    // enqueue job
    if (taskQueue) {
      await taskQueue.add('runTask', { taskId: t.id }, { attempts: 3, backoff: { type: 'exponential', delay: 1000 } });
    }

    // publish initial creation event for UI
    if (redis) {
      await redis.publish('agentfi:tasks', JSON.stringify({ type: 'task:created', data: t }));
    }
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
    const tasks = await prisma.task.findMany({ orderBy: { createdAt: 'desc' }, take: 50 });
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
    const existing = await prisma.user.findUnique({ where: { username } });
    if (existing) return res.status(400).json({ error: 'username taken' });
    const hash = await bcrypt.hash(password, 10);
    const u = await prisma.user.create({ data: { username, passwordHash: hash } });
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
    const u = await prisma.user.findUnique({ where: { username } });
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
      // Use the instance we imported at the top
      await prisma.$connect(); 
      await prisma.$queryRaw`SELECT 1`;
      console.log('✅ Database connection established');
      return;
    } catch (err) {
      console.log(`⏳ Waiting for database... (${i + 1}/${maxRetries})`);
      // Log the actual error to Railway so you can see if it's a password/URL issue
      console.error('Connection error details:', err.message); 
      await new Promise(r => setTimeout(r, delayMs));
    }
  }
  throw new Error('Database not ready after multiple retries');
}

// app.get('/auth/me', authMiddleware, async (req, res) => {
//   try {
//     const u = await prisma.user.findUnique({ where: { id: req.user.sub } });
//     if (!u) return res.status(404).json({ error: 'not found' });
//     res.json({ id: u.id, username: u.username });
//   } catch (e) {
//     res.status(500).json({ error: 'failed' });
//   }
// });

const PORT = process.env.PORT || 4000;
server.listen(PORT, '0.0.0.0', () => {
  console.log(`🚀 Server running on port ${PORT}`);
});
