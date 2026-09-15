import express from 'express';
import prisma from '../prismaClient.js';
import { authMiddleware, requireAdmin } from '../middleware/auth.js';
import logger from '../utils/logger.js';

const router = express.Router();

// GET all agents - any authenticated user may view the configured fleet.
router.get('/', authMiddleware, async (req, res) => {
  try {
    const agents = await prisma.agent.findMany({ orderBy: { createdAt: 'desc' } });
    res.json(agents);
  } catch (e) { logger.error('agents list error', e); res.status(500).json({ error: 'failed' }); }
});

// POST create agent - administrative operation.
router.post('/', authMiddleware, requireAdmin, async (req, res) => {
  try {
    const { name, role, prompt } = req.body;
    if (!name) return res.status(400).json({ error: 'name required' });
    const a = await prisma.agent.create({ data: { name, role: role || 'agent', prompt: prompt || '' } });
    res.json(a);
  } catch (e) { logger.error('agent create error', e); res.status(500).json({ error: 'failed' }); }
});

// PUT update - administrative operation.
router.put('/:id', authMiddleware, requireAdmin, async (req, res) => {
  try {
    const id = req.params.id;
    const data = req.body;
    const a = await prisma.agent.update({ where: { id }, data });
    res.json(a);
  } catch (e) { logger.error('agent update error', e); res.status(500).json({ error: 'failed' }); }
});

// DELETE - administrative operation.
router.delete('/:id', authMiddleware, requireAdmin, async (req, res) => {
  try {
    const id = req.params.id;
    await prisma.agent.delete({ where: { id } });
    res.json({ ok: true });
  } catch (e) { logger.error('agent delete error', e); res.status(500).json({ error: 'failed' }); }
});

export default router;