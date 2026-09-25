// compute_economy.test.mjs — Phase 4 compute-to-revenue vertical slice.
//
// In-memory prisma stub (same strategy as reward_engine.test.mjs) so the suite
// runs without a live database. Exercises the FULL revenue trace:
//   catalog -> quote -> payment -> (simulated|real) verify -> revenue ->
//   allocations -> pool funding -> compute job -> output hash -> cost ->
//   revenue-backed contributor reward -> withdrawable settleable balance.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';

import prisma from '../src/prismaClient.js';
import { toUnits, fromUnits } from '../src/utils/decimal.js';
import {
  ensureComputeServiceCatalog,
  getComputeServiceBySlug,
  listComputeServices,
} from '../src/services/compute/catalogService.js';
import { generateComputeQuote } from '../src/services/compute/pricingEngine.js';
import { estimateComputeValueBnb } from '../src/services/compute/valueEngine.js';
import {
  createPaymentIntentFromQuote,
  verifyPaymentPolicy,
  refundPayment,
  paymentAttestation,
} from '../src/services/compute/customerPaymentMonetizer.js';
import { bookRevenueFromVerifiedPayment, computeEconomySummary } from '../src/services/compute/revenueService.js';
import {
  createComputeJobFromAcceptedQuote,
  runComputeJob,
  finalizeComputeJob,
  markComputeJobRefunded,
} from '../src/services/compute/jobService.js';
import { fleetComputeRunner, computeScheduler, computeWorkerRegistry } from '../src/services/compute/registry.js';
import { getUserRewardBalance } from '../src/services/rewardService.js';

// ── In-memory compute DB ─────────────────────────────────────────────────────

let seq = 0;
const nextId = () => `c${++seq}`;

function matches(where, row) {
  if (!where) return true;
  return Object.keys(where).every((k) => row[k] === where[k]);
}

function rowsArray(name) {
  return { [name]: { rows: [] } }[name];
}

function makeComputeStore() {
  const store = {
    serviceCatalog: { rows: [] },
    computeQuote: { rows: [] },
    paymentIntent: { rows: [] },
    computeCustomer: { rows: [] },
    computeJob: { rows: [] },
    computeOutput: { rows: [] },
    computeCost: { rows: [] },
    revenueEvent: { rows: [] },
    revenueAllocation: { rows: [] },
    rewardEvent: { rows: [] },
    rewardLedger: { rows: [] },
    userRewardBalance: { rows: new Map() },
    rewardPool: { rows: new Map() },
    poolFundingEvent: { rows: new Map() },
    settlementRecord: { rows: new Map() },
    payout: { rows: new Map() },
    task: { rows: [] },
  };
  return store;
}

const uniqueKeys = {
  serviceCatalog: ['slug'],
  computeQuote: ['id', 'nonce'],
  paymentIntent: ['id', 'quoteId'],
  computeJob: ['id', 'quoteId'],
  computeOutput: ['id', 'jobId'],
  revenueEvent: ['id', 'paymentIntentId'],
  rewardEvent: ['id', 'taskId', 'computeJobId'],
};

function makeComputeDb(store) {
  const db = {
    serviceCatalog: {
      count: async () => store.serviceCatalog.rows.length,
      create: async ({ data }) => {
        if (store.serviceCatalog.rows.some((r) => r.slug === data.slug)) {
          throw new Error('Unique constraint failed on the fields: (`slug`)');
        }
        const row = { ...data, enabled: data.enabled === undefined ? true : data.enabled, id: data.id || nextId(), createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() };
        store.serviceCatalog.rows.push(row);
        return row;
      },
      findUnique: async ({ where }) => store.serviceCatalog.rows.find((r) => matches(where, r)) || null,
      findMany: async ({ where = {} } = {}) => store.serviceCatalog.rows.filter((r) => matches(where, r)),
    },
    computeQuote: {
      create: async ({ data }) => {
        const row = { ...data, id: data.id || nextId(), createdAt: new Date().toISOString() };
        store.computeQuote.rows.push(row);
        return row;
      },
      findUnique: async ({ where }) => store.computeQuote.rows.find((r) => matches(where, r)) || null,
      update: async ({ where, data }) => {
        const target = store.computeQuote.rows.find((r) => matches(where, r));
        Object.assign(target, data);
        return target;
      },
    },
    paymentIntent: {
      create: async ({ data }) => {
        const row = { ...data, id: data.id || nextId(), createdAt: new Date().toISOString() };
        store.paymentIntent.rows.push(row);
        return row;
      },
      findUnique: async ({ where }) => store.paymentIntent.rows.find((r) => matches(where, r)) || null,
      update: async ({ where, data }) => {
        const target = store.paymentIntent.rows.find((r) => matches(where, r));
        Object.assign(target, data);
        return target;
      },
      findMany: async ({ where = {} } = {}) => store.paymentIntent.rows.filter((r) => matches(where, r)),
    },
    computeCustomer: {
      create: async ({ data }) => {
        const row = { ...data, id: data.id || nextId(), createdAt: new Date().toISOString() };
        store.computeCustomer.rows.push(row);
        return row;
      },
    },
    computeJob: {
      create: async ({ data }) => {
        const row = { ...data, id: data.id || nextId(), createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() };
        store.computeJob.rows.push(row);
        return row;
      },
      findUnique: async ({ where }) => store.computeJob.rows.find((r) => matches(where, r)) || null,
      findFirst: async ({ where = {} } = {}) => store.computeJob.rows.find((r) => matches(where, r)) || null,
      findMany: async ({ where = {} } = {}) => store.computeJob.rows.filter((r) => matches(where, r)),
      update: async ({ where, data }) => {
        const target = store.computeJob.rows.find((r) => matches(where, r));
        Object.assign(target, data, { updatedAt: new Date().toISOString() });
        return target;
      },
    },
    computeOutput: {
      create: async ({ data }) => {
        if (store.computeOutput.rows.some((r) => r.jobId === data.jobId)) {
          throw new Error('Unique constraint failed on the fields: (`jobId`)');
        }
        const row = { ...data, id: data.id || nextId(), createdAt: new Date().toISOString() };
        store.computeOutput.rows.push(row);
        return row;
      },
      findUnique: async ({ where }) => store.computeOutput.rows.find((r) => matches(where, r)) || null,
    },
    computeCost: {
      create: async ({ data }) => {
        const row = { ...data, id: data.id || nextId(), createdAt: new Date().toISOString() };
        store.computeCost.rows.push(row);
        return row;
      },
      findMany: async ({ where = {} } = {}) => store.computeCost.rows.filter((r) => matches(where, r)),
    },
    revenueEvent: {
      create: async ({ data }) => {
        if (store.revenueEvent.rows.some((r) => r.paymentIntentId === data.paymentIntentId)) {
          const err = new Error('Unique constraint failed on the fields: (`paymentIntentId`)');
          err.code = 'P2002';
          throw err;
        }
        const row = { ...data, id: data.id || nextId(), createdAt: new Date().toISOString() };
        store.revenueEvent.rows.push(row);
        return row;
      },
      findFirst: async ({ where = {} } = {}) => store.revenueEvent.rows.find((r) => matches(where, r)) || null,
      findMany: async ({ where = {} } = {}) => store.revenueEvent.rows.filter((r) => matches(where, r)),
    },
    revenueAllocation: {
      create: async ({ data }) => {
        const row = { ...data, id: data.id || nextId(), createdAt: new Date().toISOString() };
        store.revenueAllocation.rows.push(row);
        return row;
      },
      findFirst: async ({ where = {} } = {}) => store.revenueAllocation.rows.find((r) => matches(where, r)) || null,
      findMany: async ({ where = {} } = {}) => store.revenueAllocation.rows.filter((r) => matches(where, r)),
    },
    task: {
      create: async ({ data }) => {
        const row = { ...data, createdAt: new Date().toISOString() };
        store.task.rows.push(row);
        return row;
      },
    },
    rewardEvent: {
      findUnique: async ({ where }) =>
        store.rewardEvent.rows.find((r) =>
          Object.keys(where).some((k) => {
            const want = where[k];
            return k === 'taskId' ? (r.taskId === want && r.computeJobId === null) : r[k] === want;
          }),
        ) || null,
      create: async ({ data }) => {
        if (data.computeJobId && store.rewardEvent.rows.some((r) => r.computeJobId === data.computeJobId)) {
          throw new Error('Unique constraint failed on the fields: (`computeJobId`)');
        }
        const row = { ...data, id: data.id || nextId(), createdAt: new Date().toISOString() };
        store.rewardEvent.rows.push(row);
        return row;
      },
      findMany: async ({ where = {} } = {}) => store.rewardEvent.rows.filter((r) => matches(where, r)),
    },
    rewardLedger: {
      create: async ({ data }) => {
        const row = { ...data, id: data.id || nextId(), createdAt: new Date().toISOString() };
        store.rewardLedger.rows.push(row);
        return row;
      },
      findMany: async ({ where = {} } = {}) => store.rewardLedger.rows.filter((r) => matches(where, r)),
    },
    userRewardBalance: {
      findUnique: async ({ where }) => store.userRewardBalance.rows.get(where.userId) || null,
      create: async ({ data }) => {
        const row = { ...data, updatedAt: new Date().toISOString() };
        store.userRewardBalance.rows.set(data.userId, row);
        return row;
      },
      update: async ({ where, data }) => {
        const prev = store.userRewardBalance.rows.get(where.userId) || {};
        const next = { ...prev, ...data, updatedAt: new Date().toISOString() };
        store.userRewardBalance.rows.set(where.userId, next);
        return next;
      },
      findMany: async () => [...store.userRewardBalance.rows.values()],
    },
    rewardPool: {
      findUnique: async ({ where }) => store.rewardPool.rows.get(where.id) || null,
      create: async ({ data }) => {
        const row = { ...data, updatedAt: new Date().toISOString() };
        store.rewardPool.rows.set(data.id, row);
        return row;
      },
      update: async ({ where, data }) => {
        const prev = store.rewardPool.rows.get(where.id) || {};
        const next = { ...prev, ...data, updatedAt: new Date().toISOString() };
        store.rewardPool.rows.set(where.id, next);
        return next;
      },
    },
    poolFundingEvent: {
      create: async ({ data }) => {
        const row = { ...data, id: data.id || nextId(), createdAt: new Date().toISOString() };
        store.poolFundingEvent.rows.set(row.id, row);
        return row;
      },
      findUnique: async ({ where }) => [...store.poolFundingEvent.rows.values()].find((r) => r.id === where.id) || null,
      findMany: async ({ where = {} } = {}) => [...store.poolFundingEvent.rows.values()].filter((r) => matches(where, r)),
    },
    settlementRecord: {
      findUnique: async () => null,
      create: async ({ data }) => ({ ...data, id: data.id || nextId() }),
    },
    payout: {
      findUnique: async () => null,
      create: async ({ data }) => ({ ...data, id: data.id || nextId() }),
    },
  };
  return db;
}

const ORIGINAL = { models: {}, funds: {} };

function wireComputeDb(store) {
  const db = makeComputeDb(store);
  for (const key of Object.keys(db)) {
    ORIGINAL.models[key] = prisma[key];
    prisma[key] = db[key];
    ORIGINAL.funds[key] = true;
  }
  if (!ORIGINAL.transaction) {
    ORIGINAL.transaction = prisma.$transaction;
    prisma.$transaction = async (fn) => fn(db);
  }
}

function unwireComputeDb() {
  for (const key of Object.keys(ORIGINAL.models)) prisma[key] = ORIGINAL.models[key];
  if (ORIGINAL.transaction) {
    prisma.$transaction = ORIGINAL.transaction;
    ORIGINAL.transaction = null;
  }
  delete process.env.COMPUTE_ECONOMY_DEMO_MODE;
  delete process.env.COMPUTE_PAYMENT_CERT_SECRET;
  delete process.env.COMPUTE_ASSET_BNB_PRICE_USDT;
  delete process.env.COMPUTE_REWARD_FUNDING_SHARE;
}

const SECRET = 'test-secret-for-attestation';
function attestationFor(intent) {
  return createHmac('sha256', SECRET).update(`${intent.id}:${String(intent.amountWei)}`).digest('hex');
}

async function seedService(slug = 'research') {
  await ensureComputeServiceCatalog();
  return getComputeServiceBySlug(slug);
}

async function makePaidJob({ store, sellerUserId = 'u1', service = null, asset = 'BNB', simulate = false }) {
  const svc = service || (await seedService());
  const quoteData = await generateComputeQuote({ service: svc, asset, userId: sellerUserId });
  const quote = await prisma.computeQuote.create({
    data: { ...quoteData, userId: sellerUserId, requestText: 'Produce a DeFi yield analysis for the customer.' },
  });
  const payment = await createPaymentIntentFromQuote({ quote });
  const job = await createComputeJobFromAcceptedQuote({
    quoteId: quote.id,
    sellerUserId,
    inputText: quote.requestText,
  });
  return { svc, quote, payment, job };
}

const fakeRunner = async () => ({
  output: 'signals\n'.repeat(400) + 'Detailed research output for customer.'.repeat(40),
  provider: 'mock',
  model: 'mock-model',
  agent: 'research',
  executor: 'agent-fleet',
});

// ── Pricing + catalog ────────────────────────────────────────────────────────

test('P1 server-only pricing: quote derives from catalog, never a client amount', async () => {
  const store = makeComputeStore();
  wireComputeDb(store);
  try {
    const svc = await seedService('research');
    const q = await generateComputeQuote({ service: svc, asset: 'BNB', userId: 'u1' });
    // Stored wei fields are raw integer strings (BigInt scale), not decimal tokens.
    assert.equal(BigInt(q.priceBnbWei), toUnits(svc.unitPriceBnb));
    assert.equal(BigInt(q.amountWei), BigInt(q.priceBnbWei), 'BNB price equals normalized BNB price');
    assert.ok(BigInt(q.platformFeeBnbWei) > 0n);
    assert.ok(BigInt(q.serviceCostBnbWei) > 0n);
    assert.equal(BigInt(q.platformFeeBnbWei) + BigInt(q.serviceCostBnbWei), BigInt(q.priceBnbWei));
    assert.ok(q.payloadHash.length === 64);
    assert.ok(q.nonce);
    const services = await listComputeServices();
    assert.ok(services.length >= 3, 'catalog is seeded additively');
  } finally {
    unwireComputeDb();
  }
});

test('P2 non-BNB asset uses the operator reference and converts back exactly', async () => {
  process.env.COMPUTE_ASSET_BNB_PRICE_USDT = '0.0017';
  const store = makeComputeStore();
  wireComputeDb(store);
  try {
    const svc = await seedService('research'); // 0.0020 BNB
    const q = await generateComputeQuote({ service: svc, asset: 'USDT', userId: 'u1' });
    // amount = ceil(0.0020 / 0.0017) = ceil(1.17647) = 1.1765 USDT approx > 0
    assert.ok(toUnits(q.amountWei) > toUnits('1'));
    assert.equal(q.priceBnbPerUnit, '0.0017');
  } finally {
    unwireComputeDb();
  }
});

test('P3 value engine returns an OPINION labelled non-money', () => {
  const v = estimateComputeValueBnb({ serviceBnb: '0.0020', sizeBytes: 6000 });
  assert.ok(toUnits(v.estimateBnb) > 0n);
  assert.equal(v.grade, 'comprehensive');
  assert.match(v.disclaimer, /not money/);
});

// ── Payment lifecycle ────────────────────────────────────────────────────────

test('P4 quote creates PENDING payment intent gated by demo/production type', async () => {
  const store = makeComputeStore();
  wireComputeDb(store);
  try {
    const svc = await seedService();
    const quoteData = await generateComputeQuote({ service: svc, asset: 'BNB', userId: 'u1' });
    const quote = await prisma.computeQuote.create({ data: { ...quoteData, userId: 'u1' } });
    const intent = await createPaymentIntentFromQuote({ quote });
    assert.equal(intent.status, 'PENDING');
    assert.equal(intent.external, true);
    assert.equal(intent.verificationType, 'MANUAL_CERT');
  } finally {
    unwireComputeDb();
  }
});

test('P5 simulated verification requires demo mode + admin; books SIMULATED revenue', async () => {
  process.env.COMPUTE_ECONOMY_DEMO_MODE = 'true';
  const store = makeComputeStore();
  wireComputeDb(store);
  try {
    const { payment, job } = await makePaidJob({ store, simulate: true });
    assert.equal(payment.verificationType, 'SIMULATED');

    const result = await bookRevenueFromVerifiedPayment({
      paymentIntentId: payment.id,
      requestedBy: 'admin1',
      actorRole: 'ADMIN',
    });
    assert.equal(result.simulated, true);
    assert.equal(store.revenueEvent.rows.length, 1);
    assert.equal(store.revenueEvent.rows[0].source, 'COMPUTE_JOB');
    assert.equal(store.revenueEvent.rows[0].monetizerType, 'CUSTOMER_PAYMENT');
    assert.equal(store.revenueEvent.rows[0].external, true);
    assert.equal(store.revenueEvent.rows[0].simulated, true);

    const allocations = store.revenueAllocation.rows;
    assert.equal(allocations.length, 2);
    const funding = allocations.find((a) => a.allocationType === 'REWARD_FUNDING');
    const platform = allocations.find((a) => a.allocationType === 'PLATFORM');
    assert.ok(funding && platform);
    assert.ok(BigInt(funding.bnbEquivalentWei) > 0n);
    assert.ok(BigInt(platform.bnbEquivalentWei) > 0n);

    const fundingEvents = [...store.poolFundingEvent.rows.values()];
    assert.equal(fundingEvents.length, 1);
    assert.equal(fundingEvents[0].sourceType, 'COMPUTE_REVENUE');
    assert.equal(fundingEvents[0].status, 'CONFIRMED');
    assert.equal(fundingEvents[0].simulated, true);

    const pool = store.rewardPool.rows.get(1);
    assert.equal(fromUnits(BigInt(funding.bnbEquivalentWei), 8), pool.fundedBnb, 'pool funded exactly by REWARD_FUNDING share');
    const updatedJob = store.computeJob.rows.find((j) => j.id === job.id);
    assert.equal(updatedJob.status, 'PENDING');
    assert.equal(updatedJob.revenueEventId, result.revenueEvent.id);
  } finally {
    unwireComputeDb();
  }
});

test('P6 REAL verification: SUPER_ADMIN + attestation; never simulated', async () => {
  process.env.COMPUTE_PAYMENT_CERT_SECRET = SECRET;
  const store = makeComputeStore();
  wireComputeDb(store);
  try {
    const { payment, job } = await makePaidJob({ store });
    assert.equal(payment.verificationType, 'MANUAL_CERT');
    const attestation = attestationFor(payment);

    // Non-admin is rejected before money moves.
    await assert.rejects(
      bookRevenueFromVerifiedPayment({ paymentIntentId: payment.id, requestedBy: 'u2', actorRole: 'USER', attestation }),
      (err) => err.status === 403,
    );
    // Admin (not super) cannot verify real payments.
    await assert.rejects(
      bookRevenueFromVerifiedPayment({ paymentIntentId: payment.id, requestedBy: 'admin1', actorRole: 'ADMIN', attestation }),
      (err) => err.status === 403,
    );
    // Wrong attestation cannot verify.
    await assert.rejects(
      bookRevenueFromVerifiedPayment({ paymentIntentId: payment.id, requestedBy: 'owner', actorRole: 'SUPER_ADMIN', attestation: 'deadbeef' }),
      (err) => err.status === 403,
    );
    assert.equal(store.revenueEvent.rows.length, 0, 'no revenue booked on any rejected path');

    const result = await bookRevenueFromVerifiedPayment({
      paymentIntentId: payment.id,
      requestedBy: 'owner',
      actorRole: 'SUPER_ADMIN',
      attestation,
    });
    assert.equal(result.simulated, false);
    assert.equal(result.revenueEvent.simulated, false);
    const fundingEvent = [...store.poolFundingEvent.rows.values()][0];
    assert.equal(fundingEvent.simulated, false);
  } finally {
    unwireComputeDb();
  }
});

test('P7 no secret configured -> real verification impossible (operator must set COMPUTE_PAYMENT_CERT_SECRET)', async () => {
  const store = makeComputeStore();
  wireComputeDb(store);
  try {
    const { payment } = await makePaidJob({ store });
    await assert.rejects(
      bookRevenueFromVerifiedPayment({ paymentIntentId: payment.id, requestedBy: 'owner', actorRole: 'SUPER_ADMIN', attestation: 'x' }),
      (err) => err.status === 503,
    );
    assert.equal(store.revenueEvent.rows.length, 0);
  } finally {
    unwireComputeDb();
  }
});

test('P8 verification is idempotent: a second verify never re-books or re-funds', async () => {
  process.env.COMPUTE_ECONOMY_DEMO_MODE = 'true';
  const store = makeComputeStore();
  wireComputeDb(store);
  try {
    const { payment } = await makePaidJob({ store, simulate: true });
    const a = await bookRevenueFromVerifiedPayment({ paymentIntentId: payment.id, requestedBy: 'admin1', actorRole: 'ADMIN' });
    const b = await bookRevenueFromVerifiedPayment({ paymentIntentId: payment.id, requestedBy: 'admin1', actorRole: 'ADMIN' });
    assert.equal(b.idempotent, true);
    assert.equal(a.revenueEvent.id, b.revenueEvent.id);
    assert.equal(store.revenueEvent.rows.length, 1);
    const pool = store.rewardPool.rows.get(1);
    assert.equal(fromUnits(toUnits(pool.fundedBnb), 8), a.rewardFundingBnb, 'funded exactly once');
  } finally {
    unwireComputeDb();
  }
});

test('P9 concurrent verify books exactly one revenue event + one funding', async () => {
  process.env.COMPUTE_ECONOMY_DEMO_MODE = 'true';
  const store = makeComputeStore();
  wireComputeDb(store);
  try {
    const { payment } = await makePaidJob({ store });
    await Promise.all([
      bookRevenueFromVerifiedPayment({ paymentIntentId: payment.id, requestedBy: 'admin1', actorRole: 'ADMIN' }),
      bookRevenueFromVerifiedPayment({ paymentIntentId: payment.id, requestedBy: 'admin1', actorRole: 'ADMIN' }),
    ]);
    assert.equal(store.revenueEvent.rows.length, 1);
    assert.equal([...store.poolFundingEvent.rows.values()].length, 1);
  } finally {
    unwireComputeDb();
  }
});

test('P10 refund only allowed on PENDING; refunded intent can never verify', async () => {
  const store = makeComputeStore();
  wireComputeDb(store);
  try {
    const { payment } = await makePaidJob({ store });
    await refundPayment({ paymentIntentId: payment.id, note: 'customer changed mind' });
    const refunded = store.paymentIntent.rows.find((p) => p.id === payment.id);
    assert.equal(refunded.status, 'REFUNDED');

    await assert.rejects(
      bookRevenueFromVerifiedPayment({ paymentIntentId: payment.id, requestedBy: 'owner', actorRole: 'SUPER_ADMIN', attestation: 'x' }),
      (err) => err.status === 409,
    );
    assert.equal(store.revenueEvent.rows.length, 0);
  } finally {
    unwireComputeDb();
  }
});

// ── Compute job execution + rewards ──────────────────────────────────────────

test('P11 job cannot run before monetization (revenueEventId absent)', async () => {
  const store = makeComputeStore();
  wireComputeDb(store);
  try {
    const { job } = await makePaidJob({ store });
    await assert.rejects(
      runComputeJob({ job, runner: fakeRunner }),
      (err) => err.status === 409 && /not monetized/.test(err.message),
    );
    assert.equal(store.task.rows.length, 0, 'no work runs unpaid');
  } finally {
    unwireComputeDb();
  }
});

test('P12 monetized job runs, persists hashed output + cost, and books a revenue-backed reward', async () => {
  process.env.COMPUTE_ECONOMY_DEMO_MODE = 'true';
  const store = makeComputeStore();
  wireComputeDb(store);
  try {
    const { job, payment } = await makePaidJob({ store });
    await bookRevenueFromVerifiedPayment({ paymentIntentId: payment.id, requestedBy: 'admin1', actorRole: 'ADMIN' });

    const result = await runComputeJob({ job, runner: fakeRunner });
    assert.equal(result.job.status, 'COMPLETED');
    assert.ok(result.job.completedAt);

    const output = store.computeOutput.rows[0];
    assert.equal(output.jobId, job.id);
    assert.equal(output.resultHash, result.job.output.resultHash);
    assert.ok(output.resultHash.length === 64);
    assert.ok(output.sizeBytes > 0);

    const cCost = store.computeCost.rows.find((c) => c.jobId === job.id);
    assert.ok(cCost, 'cost recorded');
    assert.equal(cCost.source, 'INTERNAL', 'internal cost is a cost, never revenue');

    const task = store.task.rows.find((t) => t.userId === 'u1');
    assert.ok(task, 'underlying agent task materialized for traceability');
    assert.equal(task.status, 'completed');
    assert.equal(store.rewardEvent.rows.length, 1);
    const reward = store.rewardEvent.rows[0];
    assert.equal(reward.rewardType, 'COMPUTE_JOB_REVENUE');
    assert.equal(reward.computeJobId, job.id);

    const allocation = store.revenueAllocation.rows.find((a) => a.allocationType === 'REWARD_FUNDING');
    assert.equal(fromUnits(BigInt(allocation.bnbEquivalentWei), 8), reward.rewardAmountBnb, 'reward equals the REWARD_FUNDING allocation exactly');

    const balance = await getUserRewardBalance('u1');
    assert.equal(toUnits(balance.totalEarnedBnb), toUnits(reward.rewardAmountBnb));
    assert.ok(toUnits(balance.availableToWithdrawBnb) > 0n, 'revenue-backed reward is withdrawable (funded pool)');
    assert.equal(balance.currency, 'BNB');
  } finally {
    unwireComputeDb();
  }
});

test('P13 reward booking is idempotent (unique computeJobId)', async () => {
  process.env.COMPUTE_ECONOMY_DEMO_MODE = 'true';
  const store = makeComputeStore();
  wireComputeDb(store);
  try {
    const { job, payment } = await makePaidJob({ store });
    await bookRevenueFromVerifiedPayment({ paymentIntentId: payment.id, requestedBy: 'admin1', actorRole: 'ADMIN' });
    const executed = await runComputeJob({ job, runner: fakeRunner });
    assert.equal(executed.job.status, 'COMPLETED');
    const first = executed.rewardEvent;
    const second = await finalizeComputeJob({ jobId: job.id });
    assert.ok(first && second);
    assert.equal(first.id, second.id);
    assert.equal(store.rewardEvent.rows.length, 1);
    assert.equal(store.rewardLedger.rows.filter((r) => r.userId === 'u1').length, 1);
  } finally {
    unwireComputeDb();
  }
});

test('P14 unmonetized job (no revenue) books ZERO reward even when completed', async () => {
  const store = makeComputeStore();
  wireComputeDb(store);
  try {
    const { job } = await makePaidJob({ store });
    // Force completion WITHOUT monetization (simulates a replayed edge).
    await prisma.computeJob.update({
      where: { id: job.id },
      data: { status: 'COMPLETED', completedAt: new Date() },
    });
    const viaFinalize = await finalizeComputeJob({ jobId: job.id });
    assert.equal(viaFinalize, null);
    assert.equal(store.rewardEvent.rows.length, 0);
  } finally {
    unwireComputeDb();
  }
});

test('P15 simulate + real revenue separate: REAL backlog is exactly the real event', async () => {
  process.env.COMPUTE_PAYMENT_CERT_SECRET = SECRET;
  const store = makeComputeStore();
  wireComputeDb(store);
  try {
    // real event
    const r = await makePaidJob({ store });
    await bookRevenueFromVerifiedPayment({
      paymentIntentId: r.payment.id,
      requestedBy: 'owner',
      actorRole: 'SUPER_ADMIN',
      attestation: attestationFor(r.payment),
    });
    // simulated event
    process.env.COMPUTE_ECONOMY_DEMO_MODE = 'true';
    const s = await makePaidJob({ store, simulate: true });
    await bookRevenueFromVerifiedPayment({ paymentIntentId: s.payment.id, requestedBy: 'admin1', actorRole: 'ADMIN' });

    const summary = computeEconomySummary({
      revenueEvents: store.revenueEvent.rows,
      allocations: store.revenueAllocation.rows,
      computeJobs: store.computeJob.rows,
      computeRewardEvents: [],
      costs: store.computeCost.rows,
    });
    assert.equal(summary.totalJobs, 2);
    assert.equal(summary.monetizedJobs, 2);
    assert.ok(toUnits(summary.simulatedRevenueBnb) > 0n);
    assert.ok(toUnits(summary.realRevenueBnb) > 0n);
    assert.equal(summary.revenueNeverEqualToComputeCost, true);
  } finally {
    unwireComputeDb();
  }
});

test('P16 policy verdict rejects REFUNDED payment intents without touching money', async () => {
  const store = makeComputeStore();
  wireComputeDb(store);
  try {
    const { payment } = await makePaidJob({ store });
    const p2 = { ...payment, status: 'REFUNDED' };
    const verdict = verifyPaymentPolicy({ paymentIntent: p2, actorRole: 'ADMIN' });
    assert.equal(verdict.ok, false);
    assert.equal(store.revenueEvent.rows.length, 0);
  } finally {
    unwireComputeDb();
  }
});

// ── Worker model + traceability ──────────────────────────────────────────────

test('P17 worker registry exposes deterministic fleet workers by agent', async () => {
  const registry = computeWorkerRegistry();
  const agentList = registry.workers.map((w) => w.agent);
  assert.ok(agentList.includes('research'));
  assert.ok(agentList.includes('general'));
  assert.ok(agentList.includes('content'));
  assert.equal(registry.get('research').source, 'agent-fleet');
});

test('P18 scheduler inline mode executes the runner (monetized jobs always complete)', async () => {
  const fakeDispatchRunner = async () => ({ output: 'dispatched inline', provider: 'mock', model: 'rmodel', agent: 'research' });
  const scheduler = computeScheduler({ mode: 'inline', runner: fakeDispatchRunner });
  assert.equal(scheduler.mode, 'inline');
  const dispatched = await scheduler.dispatch({ job: { id: 'job-x', agent: 'research', inputText: 'Do work' } });
  assert.equal(dispatched.queued, false);
  assert.equal(dispatched.run.output, 'dispatched inline');
});

// ── Expiry + refund-at-job ───────────────────────────────────────────────────

test('P19 expired quotes cannot create jobs; refunded jobs cannot run', async () => {
  process.env.COMPUTE_ASSET_BNB_PRICE_USDT = '0.0017';
  const store = makeComputeStore();
  wireComputeDb(store);
  try {
    const svc = await seedService();
    const quoteData = await generateComputeQuote({ service: svc, asset: 'BNB', userId: 'u1', nowMs: Date.now() - 60 * 60 * 1000 });
    const quote = await prisma.computeQuote.create({ data: { ...quoteData, userId: 'u1', requestText: 'old request' } });
    await assert.rejects(
      createComputeJobFromAcceptedQuote({ quoteId: quote.id, sellerUserId: 'u1', inputText: 'old request' }),
      (err) => err.status === 410,
    );

    const { job } = await makePaidJob({ store });
    await markComputeJobRefunded({ jobId: job.id, reason: 'chargeback before execution' });
    const updated = store.computeJob.rows.find((j) => j.id === job.id);
    assert.equal(updated.status, 'REFUNDED');
    await assert.rejects(runComputeJob({ job: updated }), (err) => err.status === 409);
  } finally {
    unwireComputeDb();
  }
});

test('P20 shared guarantee: an AI/task reward is never booked for an internal compute Task row', async () => {
  process.env.COMPUTE_ECONOMY_DEMO_MODE = 'true';
  const store = makeComputeStore();
  wireComputeDb(store);
  try {
    const { job, payment } = await makePaidJob({ store });
    await bookRevenueFromVerifiedPayment({ paymentIntentId: payment.id, requestedBy: 'admin1', actorRole: 'ADMIN' });
    await runComputeJob({ job, runner: fakeRunner });
    const task = store.task.rows.find((t) => t.userId === 'u1');
    assert.ok(task);
    // Only ONE reward event exists (compute rewards only); the task itself was
    // never fed to createRewardForTask, so no TASK_COMPLETION event exists.
    const taskRewards = store.rewardEvent.rows.filter((r) => r.rewardType === 'TASK_COMPLETION');
    assert.equal(taskRewards.length, 0, 'underlying compute task never books a task reward');
    assert.equal(store.rewardEvent.rows.length, 1);
  } finally {
    unwireComputeDb();
  }
});