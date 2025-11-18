import express from 'express';
import agentQueue from '../utils/agentQueue.js';
import { retryAsync } from '../middleware/retry.js';

export default function makeDispatchRouter({ redis }) {
  const router = express.Router();

  // POST /api/dispatch
  // body: { taskId: string, agents?: string[] }
  router.post('/', retryAsync(async (req, res) => {
    const { taskId, agents } = req.body || {};
    if (!taskId || typeof taskId !== 'string') return res.status(400).json({ error: 'taskId required' });

    // pick agents: either provided by client or choose 2 shortest queues from AGENTS env
    const candidates = Array.isArray(agents) && agents.length ? agents : (process.env.AGENTS || 'alpha,beta,gamma').split(',');
    // choose two agents by load-balancing shortest queues
    const chosen = await agentQueue.chooseAgents(redis, candidates, Math.min(2, candidates.length));

    const payload = { taskId, timestamp: Date.now() };
    const pushed = [];
    for (const a of chosen) {
      await agentQueue.pushTask(redis, a, payload);
      pushed.push(a);
    }

    // publish dispatch event
    if (redis) await redis.publish('agent:dispatch', JSON.stringify({ taskId, agents: pushed }));

    res.json({ ok: true, dispatchedTo: pushed });
  }, { attempts: 3 }));

  return router;
}
