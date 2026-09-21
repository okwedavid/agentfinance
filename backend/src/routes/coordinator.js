import express from 'express';
import prisma from '../prismaClient.js';
import redis from '../redisClient.js';
import logger from '../utils/logger.js';
import { authMiddleware, requireAdmin, requireRole, ROLE_ADMIN, ROLE_SUPER_ADMIN } from '../middleware/auth.js';

const router = express.Router();

// Full session authentication on every coordinator endpoint, with the resolved
// role attached for every caller. Reads are scoped to the authenticated user;
// mutations (agent registration / dispatch) are additionally restricted to
// administrators so an anonymous caller cannot write to Redis or impersonate
// an agent.
router.use(authMiddleware, requireRole(['USER', ROLE_ADMIN, ROLE_SUPER_ADMIN]));

function isAdmin(req) {
  return req.userRole === ROLE_ADMIN || req.userRole === ROLE_SUPER_ADMIN;
}

function safeFail(res, error) {
  logger.error(`coordinator error: ${error.stack || error.message || error}`);
  return res.status(500).json({ error: 'Coordinator request failed.' });
}

// GET /api/coord/agents — fleet registration state (any authenticated user).
router.get('/agents', async (req, res) => {
  try {
    const agents = await redis.hgetall('agentfi:agents');
    const list = Object.values(agents || {})
      .map((raw) => {
        try {
          return JSON.parse(raw);
        } catch {
          return null;
        }
      })
      .filter(Boolean);
    res.json(list);
  } catch (err) {
    return safeFail(res, err);
  }
});

// POST /api/coord/agents/register — agent heartbeat / registration (admin).
router.post('/agents/register', requireAdmin, async (req, res) => {
  try {
    const { agentId, name, status } = req.body;
    if (!agentId || !name) return res.status(400).json({ error: 'missing fields' });
    await redis.hset('agentfi:agents', agentId, JSON.stringify({ agentId, name, status, registeredAt: Date.now() }));
    await redis.publish('agentfi:agents', JSON.stringify({ type: 'agent:update', agentId, payload: { name, status } }));
    res.json({ ok: true });
  } catch (err) {
    return safeFail(res, err);
  }
});

// POST /api/coord/dispatch — instruct a registered agent (admin).
router.post('/dispatch', requireAdmin, async (req, res) => {
  try {
    const { agentId, action, payload } = req.body;
    if (!agentId || !action) return res.status(400).json({ error: 'missing fields' });
    await redis.publish('agentfi:coord', JSON.stringify({ type: 'perform:subtask', agentId, payload: { action, ...payload } }));
    res.json({ ok: true });
  } catch (err) {
    return safeFail(res, err);
  }
});

// GET /api/coord/summary — fleet + own task state. Admins may view all tasks.
router.get('/summary', async (req, res) => {
  try {
    const agents = await redis.hgetall('agentfi:agents');
    const tasks = await prisma.task.findMany({
      where: isAdmin(req) ? {} : { userId: req.user.sub },
      orderBy: { createdAt: 'desc' },
      take: 50,
    });
    res.json({
      agents: Object.values(agents || {}).map((a) => {
        try {
          return JSON.parse(a);
        } catch {
          return null;
        }
      }).filter(Boolean),
      tasks,
    });
  } catch (err) {
    return safeFail(res, err);
  }
});

export default router;