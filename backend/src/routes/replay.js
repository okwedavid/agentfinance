import express from 'express';
import { PrismaClient } from '@prisma/client';
import redis from '../redisClient.js';
import logger from '../utils/logger.js';

const router = express.Router();
const prisma = new PrismaClient();

// GET / -> replay events for a sessionId query param
router.get('/', async (req, res) => {
  try {
    const sessionId = req.query.sessionId;
    if (!sessionId) return res.status(400).json({ error: 'sessionId required' });
    let count = 0;
    try {
      const events = await prisma.$queryRaw`
        SELECT id, task_id AS "taskId", agent_name AS "agentName", type, payload, created_at
        FROM agent_events
        WHERE session_id = ${sessionId}
        ORDER BY created_at ASC
      `;

      if (events && events.length) {
        for (const ev of events) {
          await redis.publish('agent:replay', JSON.stringify(ev));
          count++;
        }
        return res.json({ replayed: count });
      }
    } catch (err) {
      // If the DB doesn't have session_id (older schema), fall through to synthesize demo events
      logger.warn('replay: primary query failed, falling back to demo events - ' + (err.message || err));
    }

    // fallback to session_logs if table exists
    try {
      const fallback = await prisma.$queryRaw`
        SELECT id, session_id AS "sessionId", event_type AS "type", payload, created_at
        FROM session_logs
        WHERE session_id = ${sessionId}
        ORDER BY created_at ASC
      `;
      if (fallback && fallback.length) {
        for (const e of fallback) {
          await redis.publish('agent:replay', JSON.stringify(e));
          count++;
        }
        return res.json({ replayed: count });
      }
    } catch (e) {
      logger.warn('replay: session_logs not present or query failed');
    }

    // As a last resort, synthesize demo events so replay always works for demos
    const demoAgents = ['alpha', 'beta', 'gamma', 'delta', 'epsilon'];
    const now = Date.now();
    for (let i = 0; i < 5; i++) {
      const ev = {
        id: `demo-${Date.now()}-${i}`,
        taskId: `demo-task-${i + 1}`,
        agentName: demoAgents[i % demoAgents.length],
        type: 'demo:event',
        payload: { demo: true, index: i + 1 },
        created_at: new Date(now + i * 1000).toISOString(),
      };
      await redis.publish('agent:replay', JSON.stringify(ev));
      count++;
    }
    return res.json({ replayed: count, demo: true });
  } catch (err) {
    logger.error(`replay error: ${err.stack || err}`);
    res.status(500).json({ error: 'failed' });
  }
});

export default router;
