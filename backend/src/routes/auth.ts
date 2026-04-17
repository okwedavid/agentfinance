import { Router } from 'express';
import bcrypt from 'bcryptjs';
import { signJwt } from '../utils/jwt.js';
import { PrismaClient } from '@prisma/client';
const prismaClient = new PrismaClient();

const router = Router();

// Register with name + apiKey (apiKey used as password)
router.post('/register', async (req, res) => {
  try {
    const { name, apiKey } = req.body;
    if (!name || !apiKey) return res.status(400).json({ error: 'name and apiKey required' });
    // create or upsert agent as user table might be 'agent' in this schema
    // try agent table first
    const existingAgent = await prismaClient.agent.findFirst({ where: { name } });
    if (existingAgent) return res.status(400).json({ error: 'agent name taken' });
    const hash = await bcrypt.hash(apiKey, 10);
    const data: any = { name, apiKeyHash: hash };
    const a = await prismaClient.agent.create({ data });
    const token = signJwt({ sub: a.id, name: a.name });
    res.json({ token, agentId: a.id });
  } catch (e) {
    console.error('register error', e);
    res.status(500).json({ error: 'failed' });
  }
});

router.post('/login', async (req, res) => {
  try {
    const { name, apiKey } = req.body;
    if (!name || !apiKey) return res.status(400).json({ error: 'name and apiKey required' });
    const a = await prismaClient.agent.findFirst({ where: { name } });
    if (!a) return res.status(401).json({ error: 'invalid' });
    const ok = await bcrypt.compare(apiKey, a.apiKeyHash || '');
    if (!ok) return res.status(401).json({ error: 'invalid' });
    const token = signJwt({ sub: a.id, name: a.name });
    res.json({ token, agentId: a.id });
  } catch (e) {
    console.error('login error', e);
    res.status(500).json({ error: 'failed' });
  }
});

export default router;
