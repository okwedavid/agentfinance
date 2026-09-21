import express from 'express';
import prisma from '../prismaClient.js';
import { authMiddleware, requireRole, ROLE_ADMIN, ROLE_SUPER_ADMIN } from '../middleware/auth.js';
import { fullFactoryRun, generateIdeaService, evaluateIdeaService } from '../services/factoryService.js';
import logger from '../utils/logger.js';

const router = express.Router();

// Authentication is enforced BEFORE the role check. requireRole() only
// resolves the role after authMiddleware completes, so both middlewares must
// run in order — mounting requireRole alone would reject every request.
router.use(authMiddleware, requireRole(['USER', ROLE_ADMIN, ROLE_SUPER_ADMIN]));

function isAdmin(req) {
  return req.userRole === ROLE_ADMIN || req.userRole === ROLE_SUPER_ADMIN;
}

function safeFail(res, error) {
  logger.error(`factory error: ${error.stack || error.message || error}`);
  return res.status(500).json({ error: 'The factory request could not be completed.' });
}

// Generate single idea only
router.post('/idea', async (req, res) => {
  try {
    const { niche } = req.body;
    const idea = await generateIdeaService(niche || null);
    res.json(idea);
  } catch (e) {
    return safeFail(res, e);
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
    return safeFail(res, e);
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
        results.push({ error: 'Item failed during processing.', index: i });
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
    return safeFail(res, e);
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
    return safeFail(res, e);
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
    return safeFail(res, e);
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
    return safeFail(res, e);
  }
});

// Factory runs history (own runs; admins may see all).
router.get('/runs', async (req, res) => {
  try {
    const where = isAdmin(req) ? {} : { userId: req.user.sub };
    const runs = await prisma.factoryRun.findMany({ where, orderBy: { createdAt: 'desc' }, take: 20 });
    res.json(runs);
  } catch (e) {
    return safeFail(res, e);
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
    return safeFail(res, e);
  }
});

export default router;