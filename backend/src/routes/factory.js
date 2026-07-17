import express from 'express';
import prisma from '../prismaClient.js';
import { fullFactoryRun, generateIdeaService, evaluateIdeaService, generatePublishingService } from '../services/factoryService.js';

const router = express.Router();

// Middleware to get user if logged in optional
function optionalAuth(req, res, next) {
  next(); // factory is open for now; can plug JWT later
}

// Generate single idea only
router.post('/idea', optionalAuth, async (req, res) => {
  try {
    const { niche } = req.body;
    const idea = await generateIdeaService(niche || null);
    res.json(idea);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// Evaluate idea
router.post('/evaluate', optionalAuth, async (req, res) => {
  try {
    const idea = req.body;
    if (!idea.title) return res.status(400).json({ error: 'title required' });
    const evaluation = await evaluateIdeaService(idea);
    res.json(evaluation);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// Full run (idea -> eval -> content -> publishing)
router.post('/generate', optionalAuth, async (req, res) => {
  try {
    const { niche, userId, batch } = req.body;
    const batchSize = Math.min(parseInt(batch,10) || 1, 10);

    if (batchSize === 1) {
      const result = await fullFactoryRun({ nicheHint: niche || null, userId: userId || null, persist: true });
      return res.json(result);
    } else {
      // batch mode
      const run = await prisma.factoryRun.create({
        data: {
          batchSize,
          status: 'running',
          products: []
        }
      });

      const results = [];
      for (let i=0; i<batchSize; i++) {
        try {
          const r = await fullFactoryRun({ nicheHint: niche || null, userId: userId || null, persist: true });
          results.push(r.manifest);
        } catch (e) {
          results.push({ error: e.message, index: i });
        }
      }

      const approvedCount = results.filter(r=>!r.error && r.overall>=7).length;

      const completed = await prisma.factoryRun.update({
        where: { id: run.id },
        data: {
          status: 'completed',
          approvedCount,
          rejectedCount: batchSize - approvedCount,
          products: results,
          completedAt: new Date()
        }
      });

      return res.json({ run: completed, products: results });
    }
  } catch (e) {
    console.error('factory generate error', e);
    res.status(500).json({ error: e.message });
  }
});

// List products
router.get('/products', async (req, res) => {
  try {
    const { status, take = 20 } = req.query;
    const where = status ? { status } : {};
    const products = await prisma.digitalProduct.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      take: Math.min(parseInt(take,10), 100)
    });
    res.json(products);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// Get single product with full assets
router.get('/products/:slug', async (req, res) => {
  try {
    const product = await prisma.digitalProduct.findUnique({ where: { slug: req.params.slug } });
    if (!product) return res.status(404).json({ error: 'not found' });
    res.json(product);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// Get publishing assets for a product
router.get('/products/:slug/publishing', async (req, res) => {
  try {
    const product = await prisma.digitalProduct.findUnique({ where: { slug: req.params.slug } });
    if (!product) return res.status(404).json({ error: 'not found' });
    res.json(product.publishingAssets);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// Factory runs history
router.get('/runs', async (req, res) => {
  try {
    const runs = await prisma.factoryRun.findMany({ orderBy: { createdAt: 'desc' }, take: 20 });
    res.json(runs);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// Delete product
router.delete('/products/:slug', async (req, res) => {
  try {
    await prisma.digitalProduct.delete({ where: { slug: req.params.slug } });
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

export default router;
