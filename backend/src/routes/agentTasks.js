import express from 'express';
import { body, validationResult } from 'express-validator';
import redisClient from '../redisClient.js';
import prisma from '../prismaClient.js';

const router = express.Router();

function publishEvent(type, data) {
  return redisClient.publish('agent:events', JSON.stringify({ type, ...data }));
}

router.post(
  '/init',
  [body('taskId').isString(), body('payload').exists(), body('agentName').isString()],
  async (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) return res.status(400).json({ status: 'error', errors: errors.array() });
    const { taskId, payload, agentName } = req.body;
    await publishEvent('init', { taskId, payload, agentName });
    res.json({ status: 'ok', message: 'Event broadcasted', event: 'init' });
  }
);

router.post(
  '/assign',
  [body('taskId').isString(), body('agentId').isString(), body('agentName').isString()],
  async (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) return res.status(400).json({ status: 'error', errors: errors.array() });
    const { taskId, agentId, agentName } = req.body;
    await publishEvent('assign', { taskId, agentId, agentName });
    res.json({ status: 'ok', message: 'Event broadcasted', event: 'assign' });
  }
);

router.post(
  '/update',
  [body('taskId').isString(), body('agentId').isString(), body('status').isString(), body('progress').optional()],
  async (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) return res.status(400).json({ status: 'error', errors: errors.array() });
    const { taskId, agentId, status, progress } = req.body;
    await publishEvent('update', { taskId, agentId, status, progress });
    res.json({ status: 'ok', message: 'Event broadcasted', event: 'update' });
  }
);

router.post(
  '/complete',
  [body('taskId').isString(), body('agentId').isString(), body('result').exists()],
  async (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) return res.status(400).json({ status: 'error', errors: errors.array() });
    const { taskId, agentId, result } = req.body;
    await publishEvent('complete', { taskId, agentId, result });
    res.json({ status: 'ok', message: 'Event broadcasted', event: 'complete' });
  }
);

// GET /tasks - return agentTask rows for analytics/ UI
// GET /tasks - return agentTask rows for analytics/ UI
router.get('/tasks', async (req, res) => {
  try {
    const rows = await prisma.$queryRaw`SELECT id, task_id AS "taskId", agent_name AS "agentName", status, input, output, duration, completed_at AS "completedAt", created_at AS "createdAt" FROM agent_tasks ORDER BY created_at DESC LIMIT 500`;
    res.json(rows || []);
  } catch (e) {
    console.error('fetch tasks error', e);
    res.status(500).json({ error: 'failed' });
  }
});

export default router;
