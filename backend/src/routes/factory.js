import express from 'express';
import prisma from '../prismaClient.js';
import { requireRole } from '../middleware/auth.js';
import { fullFactoryRun, generateIdeaService, evaluateIdeaService, generatePublishingService } from '../services/factoryService.js';
import logger from '../utils/logger.js';

const router = express.Router();

// Every factory endpoint requires an authenticated user; the role is resolved
// server-side so user-scoped routes know whether the caller is an admin.
router.use(requireRole(['USER', 'ADMIN']));

function isAdmin(req) {
  return req.userRole === 'ADMIN';
}

// Generate single idea only
router.post('/idea', async (req, res) => {
  try {
    const { niche } = req.body;
    const idea = await generateIdeaService(niche || null);
    res.json(idea);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// Evaluate idea
router.post('/evaluate', async (req, res) => {
  try {
    const idea = req.body;
    if (!idea.title) return res.status(400).json({ error: 'title required' });
    const evaluation = await evaluateIdeaService(idea);
    res.json(evaluation);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// Full run (idea -> eval -> content -> publishing).
// Ownership always comes from the authenticated session; a client-supplied
// userId is never trusted.
router.post('/generate', async (req, res) => {
  try {
    const { niche, batch } = req.body;
    const batchSize = Math.min(parseInt(batch, 10) || 1, 10);
    const userId = req.user.sub;

    if (batchSize === 1) {
      const result = await fullFactoryRun({ nicheHint: niche || null, userId, persist: true });
      return res.json(result);
    }

    // batch mode
    const run = await prisma.factoryRun.create({
      data: {
        userId,
        batchSize,
        status: 'running',
        products: [],
      },
    });

    const results = [];
    for (let i = 0; i < batchSize; i++) {
      try {
        const r = await fullFactoryRun({ nicheHint: niche || null, userId, persist: true });
        results.push(r.manifest);
      } catch (e) {
        results.push({ error: e.message, index: i });
      }
    }

    const approvedCount = results.filter((r) => !r.error && r.overall >= 7).length;

    const completed = await prisma.factoryRun.update({
      where: { id: run.id },
      data: {
        status: 'completed',
        approvedCount,
        rejectedCount: batchSize - approvedCount,
        products: results,
        completedAt: new Date(),
      },
    });

    return res.json({ run: completed, products: results });
  } catch (e) {
    logger.error('factory generate error', e);
    res.status(500).json({ error: e.message });
  }
});

// List own products (admins may list all).
router.get('/products', async (req, res) => {
  try {
    const { status, take = 20 } = req.query;
    const where = { ...(status ? { status } : {}) };
    if (!isAdmin(req)) where.userId = req.user.sub;
    const products = await prisma.digitalProduct.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      take: Math.min(parseInt(take, 10), 100),
    });
    res.json(products);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// Get single product with full assets
router.get('/products/:slug', async (req, res) => {
  try {
    const where = { slug: req.params.slug };
    if (!isAdmin(req)) where.userId = req.user.sub;
    const product = await prisma.digitalProduct.findUnique({ where });
    if (!product) return res.status(404).json({ error: 'not found' });
    res.json(product);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// Get publishing assets for a product
router.get('/products/:slug/publishing', async (req, res) => {
  try {
    const where = { slug: req.params.slug };
    if (!isAdmin(req)) where.userId = req.user.sub;
    const product = await prisma.digitalProduct.findUnique({ where });
    if (!product) return res.status(404).json({ error: 'not found' });
    res.json(product.publishingAssets);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// Factory runs history (own runs; admins may see all).
router.get('/runs', async (req, res) => {
  try {
    const where = isAdmin(req) ? {} : { userId: req.user.sub };
    const runs = await prisma.factoryRun.findMany({ where, orderBy: { createdAt: 'desc' }, take: 20 });
    res.json(runs);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// Delete product (owner only; admin may delete any).
router.delete('/products/:slug', async (req, res) => {
  try {
    const where = { slug: req.params.slug };
    if (!isAdmin(req)) where.userId = req.user.sub;
    const product = await prisma.digitalProduct.findUnique({ where });
    if (!product) return res.status(404).json({ error: 'not found' });
    await prisma.digitalProduct.delete({ where: { slug: req.params.slug } });
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

export default router;