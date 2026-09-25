// catalogService.js — server-managed compute service catalog.
//
// The catalog is the ONLY source of service pricing. Prices are seeded
// additively at boot (never a delete) and can never be written by a client.
// A service is individually enable/disable-able through the DB by the owner.

import prisma from '../../prismaClient.js';
import logger from '../../utils/logger.js';
import { envDecimal } from '../rewardConfig.js';
import { computeEconomyEnabled } from './config.js';

// Default catalog seed. unitPriceBnb is the server-authoritative base price a
// customer pays for one job of this service (BNB-normalized).
const DEFAULT_CATALOG = Object.freeze([
  {
    slug: 'research',
    name: 'Market & DeFi research',
    description: 'Deep research brief with sources, risks and expected returns.',
    agent: 'research',
    category: 'compute',
    envKey: 'COMPUTE_PRICE_RESEARCH',
    defaultPrice: '0.0020',
  },
  {
    slug: 'content',
    name: 'Content generation',
    description: 'Concise, structured content (threads, posts, briefs).',
    agent: 'content',
    category: 'compute',
    envKey: 'COMPUTE_PRICE_CONTENT',
    defaultPrice: '0.0012',
  },
  {
    slug: 'analysis',
    name: 'General analysis',
    description: 'Structured analysis and decision briefs.',
    agent: 'general',
    category: 'compute',
    envKey: 'COMPUTE_PRICE_ANALYSIS',
    defaultPrice: '0.0015',
  },
]);

export async function ensureComputeServiceCatalog() {
  if (!computeEconomyEnabled()) return { seeded: 0, total: 0 };
  try {
    const count = await prisma.serviceCatalog.count();
    if (count > 0) {
      return { seeded: 0, total: count };
    }
    let seeded = 0;
    for (const item of DEFAULT_CATALOG) {
      await prisma.serviceCatalog.create({
        data: {
          slug: item.slug,
          name: item.name,
          description: item.description,
          agent: item.agent,
          category: item.category,
          unitPriceBnb: envDecimal(item.envKey, item.defaultPrice),
          meta: { seeded: true },
        },
      });
      seeded += 1;
    }
    logger.info(`[compute] seeded ${seeded} catalog services`);
    return { seeded, total: seeded };
  } catch (error) {
    // A concurrent boot may seed first; never fail startup over a seed race.
    logger.warn('[compute] catalog seed skipped', error.message);
    const total = await prisma.serviceCatalog.count().catch(() => 0);
    return { seeded: 0, total };
  }
}

export async function listComputeServices() {
  return prisma.serviceCatalog.findMany({
    where: { enabled: true },
    orderBy: { createdAt: 'asc' },
  });
}

export async function getComputeServiceBySlug(slug) {
  if (typeof slug !== 'string' || !slug.trim()) return null;
  return prisma.serviceCatalog.findUnique({ where: { slug: slug.trim() } });
}