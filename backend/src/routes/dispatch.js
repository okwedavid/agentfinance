import express from 'express';
import prisma from '../prismaClient.js';
import agentQueue from '../utils/agentQueue.js';
import { retryAsync } from '../middleware/retry.js';
import { authMiddleware } from '../middleware/auth.js';

export default function makeDispatchRouter({ redis }) {
  const router = express.Router();

  // POST /api/dispatch
  // body: { taskId: string, agents?: string[] }
  // Authenticated and ownership-checked: a caller may only dispatch their OWN
  // task. An anonymous caller cannot push work into the agent queues and an
  // authenticated caller cannot hijack another user's task.
  router.post('/', authMiddleware, retryAsync(async (req, res) => {
    const { taskId, agents } = req.body || {};
    if (!taskId || typeof taskId !== 'string') return res.status(400).json({ error: 'taskId required' });

    const task = await prisma.task.findFirst({
      where: { id: taskId, userId: req.user.sub },
      select: { id: true },
    });
    if (!task) return res.status(404).json({ error: 'Task not found.' });

    const candidates = Array.isArray(agents) && agents.length ? agents : (process.env.AGENTS || 'alpha,beta,gamma').split(',');
    const chosen = await agentQueue.chooseAgents(redis, candidates, Math.min(2, candidates.length));

    const payload = { taskId, timestamp: Date.now() };
    const pushed = [];
    for (const a of chosen) {
      await agentQueue.pushTask(redis, a, payload);
      pushed.push(a);
    }

    if (redis) await redis.publish('agent:dispatch', JSON.stringify({ taskId, agents: pushed }));

    res.json({ ok: true, dispatchedTo: pushed });
  }, { attempts: 3 }));

  return router;
}