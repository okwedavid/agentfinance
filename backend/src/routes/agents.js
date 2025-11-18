import express from 'express';
import prisma from '../prismaClient.js';

const router = express.Router();

// GET all agents
router.get('/', async (req, res) => {
  try {
    const agents = await prisma.agent.findMany({ orderBy: { createdAt: 'desc' } });
    res.json(agents);
  } catch (e) { res.status(500).json({ error: 'failed' }); }
});

// POST create agent
router.post('/', async (req, res) => {
  try {
    const { name, role, prompt } = req.body;
    if(!name) return res.status(400).json({ error: 'name required' });
    const a = await prisma.agent.create({ data: { name, role: role||'agent', prompt: prompt||'' } });
    res.json(a);
  } catch (e) { console.error(e); res.status(500).json({ error: 'failed' }); }
});

// PUT update
router.put('/:id', async (req, res)=>{
  try{ const id = req.params.id; const data = req.body; const a = await prisma.agent.update({ where:{ id }, data }); res.json(a); }catch(e){ res.status(500).json({ error: 'failed' }); }
});

// DELETE
router.delete('/:id', async (req, res)=>{
  try{ const id = req.params.id; await prisma.agent.delete({ where:{ id } }); res.json({ ok:true }); }catch(e){ res.status(500).json({ error: 'failed' }); }
});

export default router;
