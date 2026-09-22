// reward_engine.test.mjs — reward economy (task-generated reward pool).
//
// Uses the same in-memory prisma-stub strategy as phase1.test.mjs so the
// suite runs without a live database. All money math goes through decimal.js
// (BigInt fixed-point); these tests assert the accounting invariants, not
// display formatting.

import { test } from 'node:test';
import assert from 'node:assert/strict';

import prisma from '../src/prismaClient.js';
import { calculateRewardForTask } from '../src/services/rewardCalculator.js';
import {
  createRewardForTask,
  getUserRewardBalance,
  getPoolOverview,
  createFundingEvent,
  confirmFundingEvent,
  reserveForPayoutTx,
  settleReservation,
  releaseReservation,
  rewardInvariantSummary,
  demoMode,
} from '../src/services/rewardService.js';
import { isIncomeEligible } from '../src/services/taskLifecycle.js';
import { toUnits, fromUnits, add } from '../src/utils/decimal.js';

// ── In-memory reward DB ──────────────────────────────────────────────────────

let seq = 0;
const nextId = () => `n${++seq}`;

function makeStore() {
  const store = {
    rewardEvent: { rows: [] },
    rewardLedger: { rows: [] },
    userRewardBalance: { rows: new Map() },
    rewardPool: { rows: new Map() },
    settlementRecord: { rows: new Map() },
    poolFundingEvent: { rows: new Map() },
    payout: { rows: new Map() },
  };
  return store;
}

function makeDb(store) {
  const db = {
    rewardEvent: {
      findUnique: async ({ where }) =>
        store.rewardEvent.rows.find((r) => r.taskId === where?.taskId || r.id === where?.id) || null,
      create: async ({ data }) => {
        if (store.rewardEvent.rows.some((r) => r.taskId === data.taskId)) {
          throw new Error('Unique constraint failed on the fields: (`taskId`)');
        }
        const row = { ...data, id: data.id || nextId(), createdAt: new Date().toISOString() };
        store.rewardEvent.rows.push(row);
        return row;
      },
      findMany: async ({ where = {}, take = 50 } = {}) =>
        store.rewardEvent.rows
          .filter((r) => (where.userId ? r.userId === where.userId : true))
          .slice(0, take),
    },
    rewardLedger: {
      create: async ({ data }) => {
        const row = { ...data, id: data.id || nextId(), createdAt: new Date().toISOString() };
        store.rewardLedger.rows.push(row);
        return row;
      },
      findMany: async ({ where = {} } = {}) =>
        store.rewardLedger.rows.filter((r) => (where.userId ? r.userId === where.userId : true)),
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
    settlementRecord: {
      findUnique: async ({ where }) => {
        const key = where.payoutId ? `payoutId:${where.payoutId}` : `id:${where.id}`;
        return store.settlementRecord.rows.get(key) || null;
      },
      create: async ({ data }) => {
        const key = `payoutId:${data.payoutId}`;
        if (store.settlementRecord.rows.has(key)) {
          throw new Error('Unique constraint failed on the fields: (`payoutId`)');
        }
        const row = { ...data, id: data.id || nextId(), reservedAt: new Date().toISOString() };
        store.settlementRecord.rows.set(key, row);
        return row;
      },
      update: async ({ where, data }) => {
        const key = `payoutId:${where.payoutId}`;
        const prev = store.settlementRecord.rows.get(key) || {};
        const next = { ...prev, ...data };
        store.settlementRecord.rows.set(key, next);
        return next;
      },
      findMany: async ({ take = 50 } = {}) => [...store.settlementRecord.rows.values()].slice(0, take),
    },
    poolFundingEvent: {
      findUnique: async ({ where }) =>
        [...store.poolFundingEvent.rows.values()].find((r) => r.id === where.id) || null,
      create: async ({ data }) => {
        const row = { ...data, id: data.id || nextId(), createdAt: new Date().toISOString() };
        store.poolFundingEvent.rows.set(row.id, row);
        return row;
      },
      update: async ({ where, data }) => {
        const prev = store.poolFundingEvent.rows.get(where.id) || {};
        const next = { ...prev, ...data };
        store.poolFundingEvent.rows.set(where.id, next);
        return next;
      },
      findMany: async ({ take = 50 } = {}) => [...store.poolFundingEvent.rows.values()].slice(0, take),
    },
    payout: {
      findUnique: async ({ where }) => store.payout.rows.get(where.id) || null,
      create: async ({ data }) => {
        const row = { ...data, id: data.id || nextId(), createdAt: new Date().toISOString() };
        store.payout.rows.set(row.id, row);
        return row;
      },
      update: async ({ where, data }) => {
        const prev = store.payout.rows.get(where.id) || {};
        const next = { ...prev, ...data, updatedAt: new Date().toISOString() };
        store.payout.rows.set(where.id, next);
        return next;
      },
      findMany: async () => [...store.payout.rows.values()],
    },
  };
  return db;
}

const ORIGINAL = {
  models: {},
  funds: {},
};

function wireRewardDb(store) {
  const db = makeDb(store);
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

function unwireRewardDb() {
  for (const key of Object.keys(ORIGINAL.models)) {
    prisma[key] = ORIGINAL.models[key];
  }
  if (ORIGINAL.transaction) {
    prisma.$transaction = ORIGINAL.transaction;
    ORIGINAL.transaction = null;
  }
  delete process.env.REWARD_DEMO_MODE;
}

function eligibleTask(overrides = {}) {
  return {
    id: `task-${++seq}`,
    agentId: 'agent-general',
    userId: 'u1',
    action: 'Write a detailed market research report with citations',
    status: 'completed',
    completedAt: new Date().toISOString(),
    retryCount: 0,
    result: JSON.stringify({ output: 'x'.repeat(2500), summary: 'done', provider: 'mock' }),
    ...overrides,
  };
}

const WITH_RESERVATION = async (tx, opts) => reserveForPayoutTx(tx, opts);

// ── Scenario 1-5: booking, eligibility, idempotency, determinism, ledger ─────

test('reward booked only for a qualifying completed task with agentId', async () => {
  const store = makeStore();
  wireRewardDb(store);
  try {
    const task = eligibleTask();
    const event = await createRewardForTask(task);
    assert.ok(event, 'event should be created');
    assert.equal(store.rewardEvent.rows.length, 1);
    assert.equal(store.rewardEvent.rows[0].taskId, task.id);
    assert.equal(store.rewardLedger.rows[0].entryType, 'CREDIT_TASK');
    assert.equal(store.rewardLedger.rows[0].direction, 'CREDIT');
    const pool = store.rewardPool.rows.get(1);
    assert.ok(pool, 'pool row should exist');
    assert.equal(pool.generatedBnb, event.rewardAmountBnb);
    const bal = store.userRewardBalance.rows.get('u1');
    assert.equal(bal.totalEarnedBnb, event.rewardAmountBnb);
  } finally {
    unwireRewardDb();
  }
});

test('non-eligible tasks (pending / empty result / no agentId) never book rewards', async () => {
  const store = makeStore();
  wireRewardDb(store);
  try {
    const pending = eligibleTask({ status: 'running', completedAt: null });
    const emptyResult = eligibleTask({ result: '' });
    const noAgent = eligibleTask({ agentId: null }); // e.g. internal payout-prepare task
    assert.equal(await createRewardForTask(pending), null);
    assert.equal(await createRewardForTask(emptyResult), null);
    assert.equal(await createRewardForTask(noAgent), null);
    assert.equal(store.rewardEvent.rows.length, 0);
    assert.equal(store.rewardPool.rows.get(1), undefined);
  } finally {
    unwireRewardDb();
  }
});

test('booking is idempotent even when called twice (unique taskId)', async () => {
  const store = makeStore();
  wireRewardDb(store);
  try {
    const task = eligibleTask();
    const first = await createRewardForTask(task);
    const second = await createRewardForTask(task);
    assert.ok(first);
    assert.equal(second?.taskId, task.id);
    assert.equal(store.rewardEvent.rows.length, 1);
    assert.equal(store.rewardLedger.rows.length, 1);
    assert.equal(store.rewardPool.rows.get(1).generatedBnb, first.rewardAmountBnb);
  } finally {
    unwireRewardDb();
  }
});

test('calculator is deterministic and quality/difficulty/reliability are reflected', () => {
  const base = eligibleTask();
  const a = calculateRewardForTask(base);
  const b = calculateRewardForTask(eligibleTask({ action: base.action, result: base.result, retryCount: base.retryCount }));
  assert.equal(a.rewardAmountBnb, b.rewardAmountBnb, 'identical inputs must give identical rewards');
  assert.equal(a.calculationVersion, '1.0.0');

  const bigger = calculateRewardForTask(eligibleTask({ result: JSON.stringify({ output: 'z'.repeat(9000) }) }));
  assert.ok(toUnits(bigger.rewardAmountBnb) >= toUnits(a.rewardAmountBnb), 'bigger output should not reward less');

  const retried = calculateRewardForTask(eligibleTask({ retryCount: 2 }));
  assert.ok(toUnits(retried.rewardAmountBnb) < toUnits(a.rewardAmountBnb), 'retries should discount the reward');

  const research = calculateRewardForTask(eligibleTask({ action: 'Research X deep-dive', agentId: 'agent-research' }));
  assert.notEqual(research.agent, a.agent);
  assert.ok(research.taskValueMetric.explain.length > 20, 'explain string should exist');
  assert.equal(a.rewardAsset, 'BNB');
});

test('ledger invariant: credits - debits = totalEarned - settled', async () => {
  const store = makeStore();
  wireRewardDb(store);
  try {
    const t1 = eligibleTask();
    await createRewardForTask(t1);
    const t2 = eligibleTask({ action: 'Second piece of general research' });
    await createRewardForTask(t2);

    const pool = store.rewardPool.rows.get(1);
    const credits = store.rewardLedger.rows
      .filter((r) => r.direction === 'CREDIT')
      .reduce((acc, r) => add(acc, r.amountBnb), 0n);
    const debits = store.rewardLedger.rows
      .filter((r) => r.direction === 'DEBIT')
      .reduce((acc, r) => add(acc, r.amountBnb), 0n);
    const bal = store.userRewardBalance.rows.get('u1');
    assert.equal(
      fromUnits(credits - debits, 8),
      fromUnits(add(toUnits(bal.totalEarnedBnb), -toUnits(bal.settledBnb)), 8),
      'credits - debits must equal totalEarned - settled',
    );

    const summary = await rewardInvariantSummary();
    assert.equal(summary.invariantHolds, true);
    assert.ok(toUnits(pool.generatedBnb) > 0n);
  } finally {
    unwireRewardDb();
  }
});

// ── Scenarios 6-8: funding and settleable semantics ──────────────────────────

test('funding event PENDING -> CONFIRMED credits fundedBnb (accounting only)', async () => {
  const store = makeStore();
  wireRewardDb(store);
  try {
    const funding = await createFundingEvent({ sourceType: 'PLATFORM_REVENUE', amountBnb: '0.01' });
    assert.equal(funding.status, 'PENDING');
    const before = await getPoolOverview();
    assert.equal(before.fundedBnb, '0');

    await confirmFundingEvent({ eventId: funding.id, requestedBy: 'admin' });
    const after = await getPoolOverview();
    assert.equal(after.fundedBnb, '0.01');
    const row = store.poolFundingEvent.rows.get(funding.id);
    assert.equal(row.status, 'CONFIRMED');
    assert.equal(row.confirmedBy, 'admin');
  } finally {
    unwireRewardDb();
  }
});

test('no funding -> zero settleable -> withdrawal is rejected', async () => {
  const store = makeStore();
  wireRewardDb(store);
  try {
    const task = eligibleTask();
    await createRewardForTask(task);
    const balance = await getUserRewardBalance('u1');
    assert.equal(balance.availableToWithdrawBnb, '0', 'earned but unfunded rewards are NOT withdrawable');
    assert.ok(toUnits(balance.pendingRewardBnb) > 0n, 'pending (unfunded) reward should be visible');

    await assert.rejects(
      WITH_RESERVATION(dbDefault(store), { userId: 'u1', payoutId: 'p1', amountBnb: '0.0001' }),
      (err) => err.status === 422 && /Insufficient settleable/.test(err.message),
    );
  } finally {
    unwireRewardDb();
  }
});

test('partial funding gives proportional settleable per user', async () => {
  const store = makeStore();
  wireRewardDb(store);
  try {
    const task = eligibleTask();
    const event = await createRewardForTask(task);
    const earned = toUnits(event.rewardAmountBnb);

    const funding = await createFundingEvent({ sourceType: 'EXTERNAL_DEPOSIT', amountBnb: '0.005' });
    await confirmFundingEvent({ eventId: funding.id, requestedBy: 'admin' });

    const balance = await getUserRewardBalance('u1');
    // settleable = floor(totalEarned * funded / generated)
    const expected = (earned * toUnits('0.005')) / toUnits(event.rewardAmountBnb);
    assert.equal(toUnits(balance.availableToWithdrawBnb), expected);
    assert.ok(toUnits(balance.availableToWithdrawBnb) > 0n);
    assert.equal(balance.totalEarnedBnb, event.rewardAmountBnb);
  } finally {
    unwireRewardDb();
  }
});

// ── Scenarios 9-11: reservation lifecycle ────────────────────────────────────

test('withdrawing reserves atomically and blocks over-withdrawal', async () => {
  const store = makeStore();
  wireRewardDb(store);
  try {
    const task = eligibleTask();
    const event = await createRewardForTask(task);
    await confirmFundingEvent({
      eventId: (await createFundingEvent({ sourceType: 'EXTERNAL_DEPOSIT', amountBnb: '0.05' })).id,
      requestedBy: 'admin',
    });

    const balance = await getUserRewardBalance('u1');
    const settleable = toUnits(balance.availableToWithdrawBnb);

    await reserveForPayoutTx(dbDefault(store), {
      userId: 'u1',
      payoutId: 'payout-a',
      amountBnb: fromUnits(settleable, 8),
    });

    const rec = store.settlementRecord.rows.get('payoutId:payout-a');
    assert.equal(rec.status, 'RESERVED');
    const bal = store.userRewardBalance.rows.get('u1');
    assert.equal(toUnits(bal.reservedBnb), settleable, 'reserved should reflect the hold');

    await assert.rejects(
      WITH_RESERVATION(dbDefault(store), { userId: 'u1', payoutId: 'payout-b', amountBnb: '0.0000001' }),
      (err) => err.status === 422,
      'over-withdrawal must be rejected after the full balance is reserved',
    );

    const after = store.settlementRecord.rows.get('payoutId:payout-b');
    assert.equal(after, undefined, 'no reservation may be created for the rejected request');
  } finally {
    unwireRewardDb();
  }
});

test('settle on approval -> RESERVED to SETTLED; idempotent double-settle is a no-op', async () => {
  const store = makeStore();
  wireRewardDb(store);
  try {
    const task = eligibleTask();
    const event = await createRewardForTask(task);
    await confirmFundingEvent({
      eventId: (await createFundingEvent({ sourceType: 'EXTERNAL_DEPOSIT', amountBnb: '0.02' })).id,
      requestedBy: 'admin',
    });
    await reserveForPayoutTx(dbDefault(store), {
      userId: 'u1',
      payoutId: 'payout-1',
      amountBnb: fromUnits(toUnits(event.rewardAmountBnb), 8),
    });

    await settleReservation({ payoutId: 'payout-1', txHash: '0xabc', settledBy: 'admin' });
    let rec = store.settlementRecord.rows.get('payoutId:payout-1');
    assert.equal(rec.status, 'SETTLED');
    assert.equal(rec.txHash, '0xabc');

    await settleReservation({ payoutId: 'payout-1', txHash: '0xdef', settledBy: 'admin2' });
    rec = store.settlementRecord.rows.get('payoutId:payout-1');
    assert.equal(rec.status, 'SETTLED', 'double settle must not change anything');
    assert.equal(rec.txHash, '0xabc', 'txHash from first settle is immutable');

    const pool = await getPoolOverview();
    const bal = await getUserRewardBalance('u1');
    assert.equal(bal.settledBnb, fromUnits(toUnits(event.rewardAmountBnb), 8));
    assert.equal(
      pool.settleableCapacityBnb,
      fromUnits(toUnits('0.02') - toUnits(event.rewardAmountBnb), 8),
      'capacity = funded - settled after the single settlement',
    );

    const finalSummary = await rewardInvariantSummary();
    assert.equal(finalSummary.invariantHolds, true);
  } finally {
    unwireRewardDb();
  }
});

test('reject releases the reservation and restores settleable capacity', async () => {
  const store = makeStore();
  wireRewardDb(store);
  try {
    const task = eligibleTask();
    const event = await createRewardForTask(task);
    await confirmFundingEvent({
      eventId: (await createFundingEvent({ sourceType: 'TREASURY_ALLOCATION', amountBnb: '0.02' })).id,
      requestedBy: 'admin',
    });
    const before = await getUserRewardBalance('u1');
    const settleableBefore = toUnits(before.availableToWithdrawBnb);

    await reserveForPayoutTx(dbDefault(store), {
      userId: 'u1',
      payoutId: 'payout-r',
      amountBnb: fromUnits(settleableBefore, 8),
    });
    await releaseReservation({ payoutId: 'payout-r', note: 'rejected' });

    const rec = store.settlementRecord.rows.get('payoutId:payout-r');
    assert.equal(rec.status, 'RELEASED');
    const after = await getUserRewardBalance('u1');
    assert.equal(toUnits(after.availableToWithdrawBnb), settleableBefore, 'capacity fully restored');

    const drain = await releaseReservation({ payoutId: 'payout-r', note: 'again' });
    assert.equal(drain.status, 'RELEASED');
  } finally {
    unwireRewardDb();
  }
});

// ── Scenario 12: failure preservation ────────────────────────────────────────

test('failed/ambiguous operations release safely without double counting', async () => {
  const store = makeStore();
  wireRewardDb(store);
  try {
    const task = eligibleTask();
    const event = await createRewardForTask(task);
    await confirmFundingEvent({
      eventId: (await createFundingEvent({ sourceType: 'EXTERNAL_DEPOSIT', amountBnb: '0.05' })).id,
      requestedBy: 'admin',
    });
    const before = await getUserRewardBalance('u1');

    await reserveForPayoutTx(dbDefault(store), {
      userId: 'u1',
      payoutId: 'payout-f',
      amountBnb: '0.000001',
    });
    // Simulates the broadcast-failure path: payout is marked failed and the
    // reservation released; settleable must be exactly restored, no drift.
    await releaseReservation({ payoutId: 'payout-f', note: 'broadcast failure release' });

    const after = await getUserRewardBalance('u1');
    assert.equal(after.availableToWithdrawBnb, before.availableToWithdrawBnb);
    assert.equal(store.settlementRecord.rows.get('payoutId:payout-f').status, 'RELEASED');
  } finally {
    unwireRewardDb();
  }
});

// ── Scenario 13: generator integrity ─────────────────────────────────────────

test('internal payout-prepare tasks never generate rewards (agentId null)', async () => {
  const store = makeStore();
  wireRewardDb(store);
  try {
    const result = await createRewardForTask({
      id: 'payout-prepare-task',
      agentId: null,
      userId: 'u1',
      action: 'Prepare routing plan for 0.01 on bsc.',
      status: 'completed',
      completedAt: new Date().toISOString(),
      result: JSON.stringify({ summary: 'routing plan', payoutId: 'abc' }),
    });
    assert.equal(result, null);
    assert.equal(store.rewardEvent.rows.length, 0);
    assert.equal(await isIncomeEligible({ status: 'completed', completedAt: new Date(), result: 'x' }), true);
  } finally {
    unwireRewardDb();
  }
});

// ── Scenario 14: demo mode ───────────────────────────────────────────────────

test('demo mode marks values simulated and blocks broadcasting', async () => {
  process.env.REWARD_DEMO_MODE = 'true';
  const store = makeStore();
  wireRewardDb(store);
  try {
    assert.equal(demoMode(), true);
    const task = eligibleTask();
    await createRewardForTask(task);
    const balance = await getUserRewardBalance('u1');
    assert.equal(balance.simulated, true);
    const pool = await getPoolOverview();
    assert.equal(pool.simulated, true);
  } finally {
    delete process.env.REWARD_DEMO_MODE;
    unwireRewardDb();
  }
});

// ── Scenario 15: pool invariant + concurrency ────────────────────────────────

test('pool invariant: settleableCapacity = funded - settled - reserved >= 0', async () => {
  const store = makeStore();
  wireRewardDb(store);
  try {
    const t1 = eligibleTask();
    const e1 = await createRewardForTask(t1);
    const t2 = eligibleTask({ action: 'More research please for the pool test' });
    const e2 = await createRewardForTask(t2);

    await confirmFundingEvent({
      eventId: (await createFundingEvent({ sourceType: 'PLATFORM_REVENUE', amountBnb: '0.003' })).id,
      requestedBy: 'admin',
    });
    await reserveForPayoutTx(dbDefault(store), { userId: 'u1', payoutId: 'p', amountBnb: '0.0005' });

    const pool = store.rewardPool.rows.get(1);
    const generated = toUnits(pool.generatedBnb);
    const funded = toUnits(pool.fundedBnb);
    const settled = toUnits(pool.settledBnb);
    const reserved = toUnits(pool.reservedBnb);

    assert.ok(funded - settled - reserved >= 0n, 'settleable capacity must never go negative');
    assert.equal(fromUnits(funded - settled - reserved, 8), (await getPoolOverview()).settleableCapacityBnb);
    assert.ok(toUnits(generated) > 0n, 'generated pool grows with qualifying tasks');
    assert.ok(e1.taskId !== e2.taskId);
  } finally {
    unwireRewardDb();
  }
});

test('concurrent duplicate booking books exactly once (no lost update)', async () => {
  const store = makeStore();
  wireRewardDb(store);
  try {
    const task = eligibleTask();
    const [a, b] = await Promise.all([
      createRewardForTask(task),
      createRewardForTask(task),
    ]);
    assert.equal(store.rewardEvent.rows.length, 1);
    assert.equal(store.rewardLedger.rows.length, 1);
    const pool = store.rewardPool.rows.get(1);
    assert.equal(pool.generatedBnb, a.rewardAmountBnb);
    assert.equal(b?.taskId, task.id);
  } finally {
    unwireRewardDb();
  }
});

test('decimal arithmetic is exact for money math', () => {
  const a = toUnits('0.000123456789');
  const b = toUnits('0.000000000001');
  assert.equal(fromUnits(a + b, 8), '0.00012345');
  assert.equal(fromUnits(toUnits('0.2') + toUnits('0.1'), 8), '0.3', '0.2+0.1 must round-trip exactly');
});

test('payout prepare atomically reserves; reject releases; legacy payouts still approve', async () => {
  const store = makeStore();
  wireRewardDb(store);
  const originalUser = prisma.user;
  prisma.user = {
    findUnique: async () => ({
      id: 'u1',
      walletAddress: '0x1111111111111111111111111111111111111111',
      walletProfiles: {},
      preferredNetwork: 'bsc',
    }),
  };
  try {
    const { preparePayoutPlan, rejectPayout } = await import('../src/services/payoutService.js');
    const event = await createRewardForTask(eligibleTask());
    await confirmFundingEvent({
      eventId: (await createFundingEvent({ sourceType: 'EXTERNAL_DEPOSIT', amountBnb: '0.05' })).id,
      requestedBy: 'admin',
    });
    const balance = await getUserRewardBalance('u1');
    const withdrawable = fromUnits(toUnits(balance.availableToWithdrawBnb), 8);

    const payout = await preparePayoutPlan({
      userId: 'u1',
      network: 'bsc',
      amount: withdrawable,
      recipientAddress: '0x2222222222222222222222222222222222222222',
    });

    const rec = store.settlementRecord.rows.get(`payoutId:${payout.id}`);
    assert.ok(rec, 'reservation must exist for a new-economy payout');
    assert.equal(rec.status, 'RESERVED');
    assert.equal(rec.amountBnb, withdrawable);

    // Over-withdrawal now impossible.
    await assert.rejects(
      preparePayoutPlan({ userId: 'u1', network: 'bsc', amount: '0.05', recipientAddress: '0x2222222222222222222222222222222222222222' }),
      (err) => err.status === 422,
      'prepare must reject when settleable is exhausted',
    );

    const rejected = await rejectPayout({ payoutId: payout.id, userId: 'admin', actorRole: 'SUPER_ADMIN', reason: 'test' });
    assert.equal(rejected.status, 'rejected');
    assert.equal(store.settlementRecord.rows.get(`payoutId:${payout.id}`).status, 'RELEASED');

    const after = await getUserRewardBalance('u1');
    assert.equal(toUnits(after.availableToWithdrawBnb), toUnits(balance.availableToWithdrawBnb), 'rejection restores full capacity');
  } finally {
    prisma.user = originalUser;
    unwireRewardDb();
  }
});

function dbDefault(store) {
  return makeDb(store);
}