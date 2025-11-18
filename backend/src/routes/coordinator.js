import express from 'express';
import { PrismaClient } from '@prisma/client';
import IORedis from 'ioredis';

const prisma = new PrismaClient();
const router = express.Router();
const redis = new IORedis(process.env.REDIS_URL || 'redis://redis:6379');

// GET /api/coord/agents
router.get('/agents', async (req, res) => {
  try {
    const agents = await redis.hgetall('agentfi:agents');
    res.json(Object.values(agents).map(a => JSON.parse(a)));
  } catch (err) {
    res.status(500).json({ error: 'failed', reason: err.message });
  }
});

// POST /api/coord/agents/register
router.post('/agents/register', async (req, res) => {
  try {
    const { agentId, name, status } = req.body;
    if (!agentId || !name) return res.status(400).json({ error: 'missing fields' });
    await redis.hset('agentfi:agents', agentId, JSON.stringify({ agentId, name, status, registeredAt: Date.now() }));
    await redis.publish('agentfi:agents', JSON.stringify({ type: 'agent:update', agentId, payload: { name, status } }));
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: 'failed', reason: err.message });
  }
});

// POST /api/coord/dispatch
router.post('/dispatch', async (req, res) => {
  try {
    const { agentId, action, payload } = req.body;
    if (!agentId || !action) return res.status(400).json({ error: 'missing fields' });
    await redis.publish('agentfi:coord', JSON.stringify({ type: 'perform:subtask', agentId, payload: { action, ...payload } }));
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: 'failed', reason: err.message });
  }
});

// GET /api/coord/summary
router.get('/summary', async (req, res) => {
  try {
    const agents = await redis.hgetall('agentfi:agents');
    const tasks = await prisma.task.findMany({ orderBy: { createdAt: 'desc' }, take: 100 });
    res.json({ agents: Object.values(agents).map(a => JSON.parse(a)), tasks });
  } catch (err) {
    res.status(500).json({ error: 'failed', reason: err.message });
  }
});

export default router;
