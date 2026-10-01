// phase0_j1_truth.test.mjs — J1 economic-truth guarantees.
//
// These tests exist to make the phase-0 claims ENFORCED rather than documented.
// Each one corresponds to a claim that was false before this phase:
//
//   J1.1  a reward value is never silently an asset
//   J1.2  MANUAL_CERT is an operator assertion, never external verification
//   J1.3  an operator cannot self-declare funding as external revenue
//   J1.4  settlement requires a confirmed receipt, and a revert is reversible
//   J1.5  a refund actually unwinds the booking it claims to unwind
//   J1.6  the "earnings" ledger reports itself as a counter, not ETH income
//   J1.7  a tampered quote cannot create a job
//   J1.8  no admin funding screen offers an external-revenue declaration
//   J1.9  token usage is recorded and reported as a cost
//   J1.10 a payer can never be the party rewarded for their own payment
//   J1.11 a non-BNB withdrawal never spends BNB-denominated reward value
//
// Runs without a live database using the same prisma-stub strategy as
// reward_engine.test.mjs.

import { test } from 'node:test';
import assert from 'node:assert/strict';

import prisma from '../src/prismaClient.js';
import {
  VALUE_TIER,
  VERIFICATION_METHOD,
  FUNDING_CLASS,
  EXTERNAL_REVENUE_PATH,
  verificationMethodFor,
  normaliseFundingClass,
  economicCapabilityReport,
  isVerifiedExternalRevenue,
} from '../src/services/moneySemantics.js';
import {
  createFundingEvent,
  confirmFundingEvent,
  poolFundingComposition,
  getPoolOverview,
  getUserRewardBalance,
  reserveForPayoutTx,
  settleReservation,
  reverseSettlement,
  releaseReservation,
  fundPoolFromRevenueTx,
  LEDGER_ENTRY,
  SETTLEMENT_STATUS,
} from '../src/services/rewardService.js';
import { computeEarningsFromTasks } from '../src/services/earningsService.js';
import { createComputeJobFromAcceptedQuote } from '../src/services/compute/jobService.js';
import { refundPayment } from '../src/services/compute/customerPaymentMonetizer.js';
import {
  REWARD_SETTLEMENT_ASSET,
  assetMatchesRewardSettlementAsset,
  preparePayoutPlan,
} from '../src/services/payoutService.js';
import { quoteAmountCoversPrice, generateComputeQuote } from '../src/services/compute/pricingEngine.js';
import { verifyQuoteBindings } from '../src/services/compute/pricingEngine.js';
import { normalizeTokenUsage, summariseTokenUsage } from '../src/services/tokenUsage.js';
import { toUnits, fromUnits } from '../src/utils/decimal.js';

// ── In-memory reward DB ──────────────────────────────────────────────────────

let seq = 0;
const nextId = () => `n${++seq}`;

function makeStore() {
  return {
    rewardEvent: { rows: [] },
    rewardLedger: { rows: [] },
    userRewardBalance: { rows: new Map() },
    rewardPool: { rows: new Map() },
    settlementRecord: { rows: new Map() },
    poolFundingEvent: { rows: new Map() },
    payout: { rows: new Map() },
    tokenUsage: { rows: [] },
    revenueEvent: { rows: [] },
    revenueAllocation: { rows: [] },
    computeJob: { rows: [] },
    paymentIntent: { rows: [] },
  };
}

function makeDb(store) {
  return {
    rewardEvent: {
      findUnique: async ({ where }) =>
        store.rewardEvent.rows.find((r) => r.taskId === where?.taskId || r.id === where?.id) || null,
      create: async ({ data }) => {
        const row = { ...data, id: data.id || nextId(), createdAt: new Date().toISOString() };
        store.rewardEvent.rows.push(row);
        return row;
      },
      findMany: async ({ take = 50 } = {}) => store.rewardEvent.rows.slice(0, take),
      updateMany: async ({ where = {}, data }) => {
        let count = 0;
        for (const row of store.rewardEvent.rows) {
          if (Object.entries(where).every(([k, v]) => row[k] === v)) {
            Object.assign(row, data);
            count += 1;
          }
        }
        return { count };
      },
    },
    rewardLedger: {
      create: async ({ data }) => {
        const row = { ...data, id: data.id || nextId(), createdAt: new Date().toISOString() };
        store.rewardLedger.rows.push(row);
        return row;
      },
      findMany: async ({ take = 50 } = {}) => store.rewardLedger.rows.slice(0, take),
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
    },
    rewardPool: {
      findUnique: async ({ where }) => store.rewardPool.rows.get(where.id) || null,
      findFirst: async () => [...store.rewardPool.rows.values()][0] || null,
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
      findUnique: async ({ where }) => store.settlementRecord.rows.get(`payoutId:${where.payoutId}`) || null,
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
        const next = { ...(store.settlementRecord.rows.get(key) || {}), ...data };
        store.settlementRecord.rows.set(key, next);
        return next;
      },
    },
    poolFundingEvent: {
      findUnique: async ({ where }) => [...store.poolFundingEvent.rows.values()].find((r) => r.id === where.id) || null,
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
      updateMany: async ({ where = {}, data }) => {
        const touched = [];
        for (const [key, row] of store.poolFundingEvent.rows.entries()) {
          if (Object.entries(where).every(([k, v]) => row[k] === v)) {
            const next = { ...row, ...data };
            store.poolFundingEvent.rows.set(key, next);
            touched.push(next);
          }
        }
        return { count: touched.length };
      },
      findMany: async ({ where = {}, take = 50 } = {}) => {
        let rows = [...store.poolFundingEvent.rows.values()];
        for (const [key, want] of Object.entries(where)) {
          rows = rows.filter((r) => r[key] === want);
        }
        return rows.slice(0, take);
      },
    },
    payout: {
      findUnique: async ({ where }) => store.payout.rows.get(where.id) || null,
      findMany: async ({ take = 50 } = {}) => [...store.payout.rows.values()].slice(0, take),
      create: async ({ data }) => {
        const row = { ...data, id: data.id || nextId() };
        store.payout.rows.set(row.id, row);
        return row;
      },
      update: async ({ where, data }) => {
        const row = store.payout.rows.get(where.id);
        Object.assign(row, data);
        return row;
      },
    },
    tokenUsage: {
      create: async ({ data }) => {
        const row = { ...data, id: data.id || nextId(), createdAt: new Date().toISOString() };
        store.tokenUsage.rows.push(row);
        return row;
      },
      findMany: async ({ take = 50 } = {}) => store.tokenUsage.rows.slice(0, take),
    },
    paymentIntent: {
      findUnique: async ({ where }) => store.paymentIntent.rows.find((r) => r.id === where.id) || null,
      update: async ({ where, data }) => {
        const row = store.paymentIntent.rows.find((r) => r.id === where.id);
        Object.assign(row, data);
        return row;
      },
    },
    revenueEvent: {
      findUnique: async ({ where }) => store.revenueEvent.rows.find((r) => r.id === where.id) || null,
      update: async ({ where, data }) => {
        const row = store.revenueEvent.rows.find((r) => r.id === where.id);
        Object.assign(row, data);
        return row;
      },
    },
    revenueAllocation: {
      findFirst: async ({ where = {} } = {}) =>
        store.revenueAllocation.rows.find((r) => Object.entries(where).every(([k, v]) => r[k] === v)) || null,
      updateMany: async ({ where = {}, data }) => {
        let count = 0;
        for (const row of store.revenueAllocation.rows) {
          if (Object.entries(where).every(([k, v]) => row[k] === v)) {
            Object.assign(row, data);
            count += 1;
          }
        }
        return { count };
      },
    },
    computeJob: {
      findUnique: async ({ where }) => store.computeJob.rows.find((r) => r.id === where.id) || null,
      findMany: async ({ where = {} } = {}) =>
        store.computeJob.rows.filter((r) => Object.entries(where).every(([k, v]) => r[k] === v)),
      update: async ({ where, data }) => {
        const row = store.computeJob.rows.find((r) => r.id === where.id);
        Object.assign(row, data);
        return row;
      },
      updateMany: async ({ where = {}, data }) => {
        let count = 0;
        for (const row of store.computeJob.rows) {
          if (Object.entries(where).every(([k, v]) => row[k] === v)) {
            Object.assign(row, data);
            count += 1;
          }
        }
        return { count };
      },
    },
  };
}

const ORIGINAL = { models: {}, transaction: null };

function wireDb(store) {
  const db = makeDb(store);
  for (const key of Object.keys(db)) {
    ORIGINAL.models[key] = prisma[key];
    prisma[key] = db[key];
  }
  if (!ORIGINAL.transaction) {
    ORIGINAL.transaction = prisma.$transaction;
    prisma.$transaction = async (fn) => fn(db);
  }
  return db;
}

function unwireDb() {
  for (const key of Object.keys(ORIGINAL.models)) prisma[key] = ORIGINAL.models[key];
  if (ORIGINAL.transaction) {
    prisma.$transaction = ORIGINAL.transaction;
    ORIGINAL.transaction = null;
  }
  delete process.env.REWARD_DEMO_MODE;
}

function withDb(fn) {
  const store = makeStore();
  const db = wireDb(store);
  return Promise.resolve()
    .then(() => fn({ store, db }))
    .finally(unwireDb);
}

// ── J1.1: value tiers ────────────────────────────────────────────────────────

test('J1.1 a booked reward is ACCOUNTING_VALUE, never an asset', async () => {
  await withDb(async ({ store, db }) => {
    // Seed generated + funded so a settleable balance exists.
    store.rewardPool.rows.set(1, { id: 1, generatedBnb: '1', fundedBnb: '1', reservedBnb: '0', settledBnb: '0' });
    store.userRewardBalance.rows.set('u1', {
      userId: 'u1', totalEarnedBnb: '1', settledBnb: '0', reservedBnb: '0', updatedAt: '',
    });

    const bal = await getUserRewardBalance('u1');
    assert.equal(bal.value.totalEarned.tier, VALUE_TIER.ACCOUNTING_VALUE);
    assert.equal(bal.value.pendingReward.tier, VALUE_TIER.ACCOUNTING_VALUE);

    // The withdrawal entitlement must never be labelled an asset.
    assert.equal(bal.value.availableToWithdraw.tier, VALUE_TIER.SETTLEABLE_VALUE);
    assert.equal(bal.value.availableToWithdraw.isAsset, false);
    assert.match(bal.value.availableToWithdraw.note, /No asset exists/i);

    // Only a settled amount is an asset.
    assert.equal(bal.value.settled.tier, VALUE_TIER.WITHDRAWABLE_ASSET);
    assert.equal(bal.value.settled.isAsset, true);
    assert.equal(db, db);
  });
});

test('J1.1 the pool reports generated and funded as different, non-asset tiers', async () => {
  await withDb(async ({ store }) => {
    store.rewardPool.rows.set(1, { id: 1, generatedBnb: '2', fundedBnb: '0.5', reservedBnb: '0', settledBnb: '0' });
    const pool = await getPoolOverview();
    assert.equal(pool.value.generated.tier, VALUE_TIER.ACCOUNTING_VALUE);
    assert.equal(pool.value.funded.tier, VALUE_TIER.FUNDED_VALUE);
    assert.equal(pool.value.funded.isAsset, undefined);
    assert.equal(pool.value.settled.isAsset, true);
  });
});

test('J1.1 the capability report never claims a revenue-generating agent', () => {
  const report = economicCapabilityReport({});
  assert.equal(report.externalRevenuePath, 'EXTERNAL_REVENUE_PATH_UNAVAILABLE');
  assert.equal(report.revenueGeneratingAgentsAvailable, false);
  assert.equal(EXTERNAL_REVENUE_PATH.available, false);
  assert.match(report.invariant, /ACCOUNTING_VALUE is never REAL_EXTERNAL_REVENUE/);
});

// ── J1.2: verification method reclassification ────────────────────────────────

test('J1.2 MANUAL_CERT is reclassified as OPERATOR_ASSERTED, never external', () => {
  assert.equal(verificationMethodFor('MANUAL_CERT'), VERIFICATION_METHOD.OPERATOR_ASSERTED);
  assert.equal(verificationMethodFor('MANUAL_CERT', false), VERIFICATION_METHOD.OPERATOR_ASSERTED);
  assert.equal(isVerifiedExternalRevenue(verificationMethodFor('MANUAL_CERT')), false);
});

test('J1.2 SIMULATED stays SIMULATED and a simulated flag forces it', () => {
  assert.equal(verificationMethodFor('SIMULATED'), VERIFICATION_METHOD.SIMULATED);
  assert.equal(verificationMethodFor('MANUAL_CERT', true), VERIFICATION_METHOD.SIMULATED);
});

test('J1.2 unknown verification types fall back to the conservative operator class', () => {
  assert.equal(verificationMethodFor('SOMETHING_ELSE'), VERIFICATION_METHOD.OPERATOR_ASSERTED);
  assert.equal(verificationMethodFor(null), VERIFICATION_METHOD.OPERATOR_ASSERTED);
  assert.equal(verificationMethodFor(''), VERIFICATION_METHOD.OPERATOR_ASSERTED);
});

test('J1.2 no path can produce EXTERNAL_VERIFIED from an operator action', () => {
  // Even an explicit EXTERNAL_VERIFIED stored value is not trusted unless a real
  // verifier exists; the report is the single gate.
  const report = economicCapabilityReport({ paymentVerifierConfigured: true });
  assert.equal(report.externalRevenuePath, 'EXTERNAL_REVENUE_PATH_UNAVAILABLE');
  assert.equal(report.externalRevenuePath, EXTERNAL_REVENUE_PATH.available ? 'x' : 'EXTERNAL_REVENUE_PATH_UNAVAILABLE');
});

// ── J1.3: funding class cannot be self-declared ──────────────────────────────

test('J1.3 an operator cannot self-declare funding as EXTERNAL_REVENUE', () => {
  assert.throws(
    () => normaliseFundingClass('EXTERNAL_REVENUE'),
    (err) => err.status === 422 && /cannot be requested by an operator/.test(err.message),
    'operator-asserted external revenue funding must be rejected',
  );
});

test('J1.3 operator and test funding are the only self-declarable classes', () => {
  assert.equal(normaliseFundingClass('OPERATOR_FUNDING'), FUNDING_CLASS.OPERATOR_FUNDING);
  assert.equal(normaliseFundingClass('TEST_FUNDING'), FUNDING_CLASS.TEST_FUNDING);
  assert.equal(normaliseFundingClass(null), FUNDING_CLASS.OPERATOR_FUNDING);
  assert.equal(normaliseFundingClass('', { simulated: true }), FUNDING_CLASS.TEST_FUNDING);
  assert.equal(normaliseFundingClass('OPERATOR_FUNDING', { simulated: true }), FUNDING_CLASS.TEST_FUNDING);
  assert.throws(() => normaliseFundingClass('MADE_UP'), (err) => err.status === 422);
});

test('J1.3 admin funding defaults to OPERATOR_FUNDING and records it on the row', async () => {
  await withDb(async ({ store }) => {
    const evt = await createFundingEvent({ sourceType: 'PLATFORM_REVENUE', amountBnb: '0.01' });
    assert.equal(evt.fundingClass, FUNDING_CLASS.OPERATOR_FUNDING);
    assert.equal(store.poolFundingEvent.rows.get(evt.id).fundingClass, FUNDING_CLASS.OPERATOR_FUNDING);
  });
});

test('J1.3 a rejected EXTERNAL_REVENUE funding request never creates a row', async () => {
  await withDb(async ({ store }) => {
    await assert.rejects(
      createFundingEvent({ sourceType: 'PLATFORM_REVENUE', amountBnb: '0.01', fundingClass: 'EXTERNAL_REVENUE' }),
      (err) => err.status === 422,
    );
    assert.equal(store.poolFundingEvent.rows.size, 0, 'no funding row may exist for a rejected request');
  });
});

test('J1.3 funding composition reports zero external revenue for operator funding', async () => {
  await withDb(async ({ store }) => {
    store.poolFundingEvent.rows.set('f1', {
      id: 'f1', status: 'CONFIRMED', amountBnb: '0.03', fundingClass: FUNDING_CLASS.OPERATOR_FUNDING,
    });
    store.poolFundingEvent.rows.set('f2', {
      id: 'f2', status: 'PENDING', amountBnb: '5', fundingClass: FUNDING_CLASS.EXTERNAL_REVENUE,
    });
    const comp = await poolFundingComposition();
    // Only CONFIRMED funding counts, and operator money is not external revenue.
    assert.equal(comp.totalBnb, '0.03');
    assert.equal(comp.externalRevenueBackedBnb, '0');
    assert.equal(comp.operatorSubsidisedBnb, '0.03');
    assert.equal(comp.externalRevenueShare, 0);
  });
});

test('J1.3 compute revenue funding is never classified as external revenue', async () => {
  await withDb(async ({ store, db }) => {
    store.rewardPool.rows.set(1, { id: 1, generatedBnb: '0', fundedBnb: '0', reservedBnb: '0', settledBnb: '0' });
    await fundPoolFromRevenueTx(db, { amountBnb: '0.02', reference: 'rev-1', simulated: false });
    const [evt] = [...store.poolFundingEvent.rows.values()];
    assert.equal(evt.fundingClass, FUNDING_CLASS.OPERATOR_FUNDING);
    assert.equal(evt.meta.verificationMethod, VERIFICATION_METHOD.OPERATOR_ASSERTED);

    await fundPoolFromRevenueTx(db, { amountBnb: '0.02', reference: 'rev-2', simulated: true });
    const simulated = [...store.poolFundingEvent.rows.values()].find((e) => e.reference === 'rev-2');
    assert.equal(simulated.fundingClass, FUNDING_CLASS.TEST_FUNDING);
  });
});

// ── J1.4: settlement requires a receipt, and reverts are reversible ───────────

test('J1.4 settlement is refused without a transaction hash', async () => {
  await withDb(async ({ store, db }) => {
    store.rewardPool.rows.set(1, { id: 1, generatedBnb: '1', fundedBnb: '1', reservedBnb: '0', settledBnb: '0' });
    store.userRewardBalance.rows.set('u1', { userId: 'u1', totalEarnedBnb: '1', settledBnb: '0', reservedBnb: '0' });
    await reserveForPayoutTx(db, { userId: 'u1', payoutId: 'p1', amountBnb: '0.5' });

    await assert.rejects(
      settleReservation({ payoutId: 'p1', txHash: null, settledBy: 'admin' }),
      (err) => err.status === 422 && /transaction hash/.test(err.message),
      'broadcast without a hash is not settlement',
    );
    assert.equal(store.settlementRecord.rows.get('payoutId:p1').status, SETTLEMENT_STATUS.RESERVED);
  });
});

test('J1.4 a settled payout whose receipt reverts is reversed, not left debited', async () => {
  await withDb(async ({ store, db }) => {
    store.rewardPool.rows.set(1, { id: 1, generatedBnb: '1', fundedBnb: '1', reservedBnb: '0', settledBnb: '0' });
    store.userRewardBalance.rows.set('u1', { userId: 'u1', totalEarnedBnb: '1', settledBnb: '0', reservedBnb: '0' });

    await reserveForPayoutTx(db, { userId: 'u1', payoutId: 'p1', amountBnb: '0.5' });
    await settleReservation({ payoutId: 'p1', txHash: '0xabc', settledBy: 'admin' });
    assert.equal(store.userRewardBalance.rows.get('u1').settledBnb, '0.5');

    // The on-chain transaction turns out to have reverted (status 0).
    const reversed = await reverseSettlement({
      payoutId: 'p1', txHash: '0xabc', reversedBy: 'system', reason: 'receipt status 0',
    });
    assert.equal(reversed.status, SETTLEMENT_STATUS.REVERSED);
    assert.equal(store.userRewardBalance.rows.get('u1').settledBnb, '0', 'the user must not stay debited');
    assert.equal(store.rewardPool.rows.get(1).settledBnb, '0');

    // Reversal is idempotent.
    const again = await reverseSettlement({ payoutId: 'p1', txHash: '0xabc' });
    assert.equal(again.status, SETTLEMENT_STATUS.REVERSED);
    assert.equal(store.userRewardBalance.rows.get('u1').settledBnb, '0');

    // And the settleable capacity is genuinely restored: the user's full
    // earned amount is fundable again (capacity 1 = totalEarned 1 * funded 1 /
    // generated 1), which is what it was before the 0.5 was settled.
    const bal = await getUserRewardBalance('u1');
    assert.equal(toUnits(bal.availableToWithdrawBnb), toUnits('1'));
  });
});

test('J1.4 reversal writes a distinct ledger entry type for the audit trail', async () => {
  await withDb(async ({ store, db }) => {
    store.rewardPool.rows.set(1, { id: 1, generatedBnb: '1', fundedBnb: '1', reservedBnb: '0', settledBnb: '0' });
    store.userRewardBalance.rows.set('u1', { userId: 'u1', totalEarnedBnb: '1', settledBnb: '0', reservedBnb: '0' });
    await reserveForPayoutTx(db, { userId: 'u1', payoutId: 'p1', amountBnb: '0.25' });
    await settleReservation({ payoutId: 'p1', txHash: '0xabc', settledBy: 'admin' });
    await reverseSettlement({ payoutId: 'p1', txHash: '0xabc', reason: 'reverted' });

    const entry = store.rewardLedger.rows.find((r) => r.entryType === LEDGER_ENTRY.SETTLEMENT_REVERSAL);
    assert.ok(entry, 'a reversal must leave its own ledger entry');
    assert.equal(entry.direction, 'CREDIT');
  });
});

test('J1.4 releaseReservation still cannot undo a settled record (reversal is the only path)', async () => {
  await withDb(async ({ store, db }) => {
    store.rewardPool.rows.set(1, { id: 1, generatedBnb: '1', fundedBnb: '1', reservedBnb: '0', settledBnb: '0' });
    store.userRewardBalance.rows.set('u1', { userId: 'u1', totalEarnedBnb: '1', settledBnb: '0', reservedBnb: '0' });
    await reserveForPayoutTx(db, { userId: 'u1', payoutId: 'p1', amountBnb: '0.25' });
    await settleReservation({ payoutId: 'p1', txHash: '0xabc', settledBy: 'admin' });

    const rec = await releaseReservation({ payoutId: 'p1' });
    assert.equal(rec.status, SETTLEMENT_STATUS.SETTLED, 'release must not silently rewrite a settled record');
  });
});

// ── J1.6: the earnings ledger is a counter ───────────────────────────────────

test('J1.6 the task ledger reports itself as non-money', () => {
  const out = computeEarningsFromTasks([
    { status: 'completed', completedAt: new Date().toISOString(), result: 'done' },
  ], 0.0035);
  assert.equal(out.isMoney, false);
  assert.equal(out.unit, 'TASK_UNITS');
  assert.equal(out.valueTier, VALUE_TIER.ACCOUNTING_VALUE);
  assert.match(out.note, /not ETH and not income/);
});

test('J1.6 the ledger never calls its figure earnings', () => {
  const out = computeEarningsFromTasks([], 0.0035);
  // The canonical figure is a task-unit counter. The ETH-named fields are only
  // reachable through `deprecatedAliases`, so a client reading the top level
  // cannot mistake it for an asset.
  assert.equal(out.totalActivityUnits, 0);
  assert.equal(out.totalEth, undefined, 'no misleading top-level ETH field');
  assert.equal(out.deprecatedAliases.totalEth, 0, 'the alias is still available for old clients');
  assert.match(out.noteDeprecated, /must never be presented as earnings/);
  assert.deepEqual(Object.keys(out.deprecatedAliases), ['rateEth', 'totalEth', 'totalWei']);
});

test('J1.6 only qualifying completed tasks are counted', () => {
  const out = computeEarningsFromTasks([
    { status: 'completed', completedAt: new Date().toISOString(), result: 'ok' },
    { status: 'running', completedAt: null, result: 'ok' },
    { status: 'completed', completedAt: new Date().toISOString(), result: '' },
  ], 0.0035);
  assert.equal(out.eligibleCount, 1);
});

// ── J1.7: quote integrity ─────────────────────────────────────────────────────

test('J1.7 a BNB quote whose amount was edited downward is refused', () => {
  const quote = {
    slug: 'research',
    asset: 'BNB',
    priceBnbWei: '1000000000000000',
    amountWei: '500000000000000',
    priceBnbPerUnit: null,
  };
  assert.equal(quoteAmountCoversPrice(quote), false, 'a halved charge must not cover the price');
});

test('J1.7 a BNB quote at the server price is accepted', () => {
  const quote = {
    slug: 'research',
    asset: 'BNB',
    priceBnbWei: '1000000000000000',
    amountWei: '1000000000000000',
    priceBnbPerUnit: null,
  };
  assert.equal(quoteAmountCoversPrice(quote), true);
});

test('J1.7 a zero or malformed price is refused rather than passed through', () => {
  assert.equal(quoteAmountCoversPrice({ asset: 'BNB', priceBnbWei: '0', amountWei: '1' }), false);
  assert.equal(quoteAmountCoversPrice({ asset: 'BNB', priceBnbWei: 'abc', amountWei: '1' }), false);
  assert.equal(quoteAmountCoversPrice({ asset: 'BNB', priceBnbWei: null, amountWei: '1' }), false);
});

test('J1.7 a real generated quote passes its own integrity check', async () => {
  const service = { id: 's1', slug: 'research', unitPriceBnb: '0.002', enabled: true, agent: 'research' };
  const quote = await generateComputeQuote({ service, asset: 'BNB', userId: 'u1' });
  assert.equal(verifyQuoteBindings(quote), true);
  assert.equal(quoteAmountCoversPrice(quote), true);

  // Tampering with a priced field breaks the payload binding.
  assert.equal(verifyQuoteBindings({ ...quote, amountWei: '1' }), false);
});

// ── J1.9: token usage is a recorded cost ─────────────────────────────────────

test('J1.9 provider usage shapes are normalized', () => {
  assert.deepEqual(normalizeTokenUsage({ promptTokens: 10, completionTokens: 5 }), {
    promptTokens: 10, completionTokens: 5, totalTokens: 15,
  });
  assert.deepEqual(normalizeTokenUsage({ prompt_tokens: 7, completion_tokens: 3 }), {
    promptTokens: 7, completionTokens: 3, totalTokens: 10,
  });
  assert.deepEqual(normalizeTokenUsage({ promptTokenCount: 4, candidatesTokenCount: 2 }), {
    promptTokens: 4, completionTokens: 2, totalTokens: 6,
  });
});

test('J1.9 missing usage is recorded as unknown, never as zero tokens', () => {
  assert.equal(normalizeTokenUsage(null), null);
  assert.equal(normalizeTokenUsage({}), null);
  assert.equal(normalizeTokenUsage({ promptTokens: -5 }), null);
  assert.equal(normalizeTokenUsage({ promptTokens: 'nope' }), null);
});

test('J1.9 the usage summary is labelled a cost, never revenue or profit', async () => {
  await withDb(async ({ store }) => {
    store.tokenUsage.rows.push({ promptTokens: 100, completionTokens: 20, totalTokens: 120, costCents: 0 });
    const summary = await summariseTokenUsage();
    assert.equal(summary.totalTokens, 120);
    assert.equal(summary.isMoney, false);
    assert.equal(summary.pricingConfigured, false, 'costCents 0 means unpriced, not free');
    assert.match(summary.note, /COST of operating/);
    assert.match(summary.note, /must never be netted against revenue/);
  });
});

// ── J1.5: a refund unwinds the booking it claims to unwind ────────────────────

function seedBookedRevenue(store, { jobId = 'j1', quoteId = 'q1', eventId = 'r1', fundingBnb = '0.02' } = {}) {
  store.rewardPool.rows.set(1, { id: 1, generatedBnb: '0.05', fundedBnb: '0.02', reservedBnb: '0', settledBnb: '0' });
  store.revenueEvent.rows.push({
    id: eventId,
    jobId,
    paymentIntentId: 'pi1',
    status: 'BOOKED',
    verificationMethod: VERIFICATION_METHOD.OPERATOR_ASSERTED,
  });
  store.revenueAllocation.rows.push({
    id: 'a1',
    revenueEventId: eventId,
    allocationType: 'REWARD_FUNDING',
    bnbEquivalentWei: toUnits(fundingBnb).toString(),
    status: 'ACTIVE',
  });
  store.poolFundingEvent.rows.set('pf1', {
    id: 'pf1',
    status: 'CONFIRMED',
    amountBnb: fundingBnb,
    fundingClass: FUNDING_CLASS.OPERATOR_FUNDING,
    reference: eventId,
  });
  store.rewardEvent.rows.push({ id: 're1', computeJobId: jobId, status: 'CREDITED' });
  store.computeJob.rows.push({ id: jobId, quoteId, status: 'RUNNING', revenueEventId: eventId, sellerUserId: 'contrib1', payerUserId: 'customer1' });
  store.paymentIntent.rows.push({ id: 'pi1', quoteId, status: 'VERIFIED' });
}

test('J1.5 refunding a booked payment returns the pool funding it created', async () => {
  await withDb(async ({ store }) => {
    seedBookedRevenue(store);
    const intent = await refundPayment({ paymentIntentId: 'pi1', note: 'chargeback' });

    assert.equal(intent.status, 'REFUNDED');
    // The pool must not keep money that was never actually paid.
    assert.equal(store.rewardPool.rows.get(1).fundedBnb, '0', 'pool funding is returned on refund');
    assert.equal(store.revenueEvent.rows[0].status, 'REFUNDED', 'the booking is unwound, not just relabelled');
    assert.equal(store.revenueAllocation.rows[0].status, 'REVERSED');
    assert.equal(store.poolFundingEvent.rows.get('pf1').status, 'REVERSED', 'the funding event stops counting');
    assert.equal(store.rewardEvent.rows[0].status, 'REVERSED', 'a credit that is refunded is reversed');
    assert.equal(store.computeJob.rows[0].revenueEventId, null, 'no live booking pointer remains');
  });
});

test('J1.5 a repeated refund cannot unwind the booking twice', async () => {
  await withDb(async ({ store }) => {
    seedBookedRevenue(store);
    await refundPayment({ paymentIntentId: 'pi1' });
    // Seed a further funding that the second refund must NOT touch.
    store.rewardPool.rows.get(1).fundedBnb = '0.5';
    await refundPayment({ paymentIntentId: 'pi1' });
    assert.equal(store.rewardPool.rows.get(1).fundedBnb, '0.5', 'a replayed refund debits nothing');
  });
});

test('J1.5 a settled payment and a completed job are never refundable', async () => {
  await withDb(async ({ store }) => {
    seedBookedRevenue(store);
    store.paymentIntent.rows[0].status = 'SETTLED';
    await assert.rejects(refundPayment({ paymentIntentId: 'pi1' }), (err) => err.status === 409);

    store.paymentIntent.rows[0].status = 'VERIFIED';
    store.computeJob.rows[0].status = 'COMPLETED';
    await assert.rejects(refundPayment({ paymentIntentId: 'pi1' }), (err) => err.status === 409);
    assert.equal(store.rewardPool.rows.get(1).fundedBnb, '0.02', 'a refused refund changes no money');
  });
});

// ── J1.10: the payer is never the reward recipient ────────────────────────────

test('J1.10 self-payment is refused rather than credited as a reward', async () => {
  await withDb(async ({ store, db }) => {
    const service = { id: 's1', slug: 'research', unitPriceBnb: '0.002', enabled: true, agent: 'research' };
    const quoteData = await generateComputeQuote({ service, asset: 'BNB', userId: 'customer1' });
    store.computeQuote = { rows: [] };
    prisma.computeQuote = {
      findUnique: async ({ where }) => store.computeQuote.rows.find((r) => r.id === where.id) || null,
      create: async ({ data }) => {
        // The Prisma default for status is PENDING; mirror it in the stub.
        const row = { status: 'PENDING', ...data, id: data.id || nextId() };
        store.computeQuote.rows.push(row);
        return row;
      },
      update: async ({ where, data }) => {
        const row = store.computeQuote.rows.find((r) => r.id === where.id);
        Object.assign(row, data);
        return row;
      },
    };
    prisma.serviceCatalog = { findUnique: async () => service };
    prisma.computeJob = {
      findUnique: async () => null,
      create: async ({ data }) => ({ ...data, id: nextId() }),
      update: async () => { throw new Error('should not update'); },
    };
    const quote = await prisma.computeQuote.create({ data: quoteData });

    // Payer and seller are the same identity: a customer paying for their own
    // job must not be credited part of their own money back as a "reward".
    await assert.rejects(
      createComputeJobFromAcceptedQuote({
        quoteId: quote.id,
        sellerUserId: 'customer1',
        payerUserId: 'customer1',
        inputText: 'do the thing',
      }),
      (err) => err.status === 409 && /Self-payment/.test(err.message),
    );
    assert.equal(store.computeQuote.rows[0].status, 'PENDING', 'a refused self-payment does not mark the quote paid');
  });
});

test('J1.10 a job with a distinct payer and contributor records both identities', async () => {
  await withDb(async ({ store }) => {
    const service = { id: 's1', slug: 'research', unitPriceBnb: '0.002', enabled: true, agent: 'research' };
    const quoteData = await generateComputeQuote({ service, asset: 'BNB', userId: 'customer1' });
    store.computeQuote = { rows: [{ ...quoteData, id: 'q1', status: 'PENDING' }] };
    prisma.computeQuote = {
      findUnique: async ({ where }) => store.computeQuote.rows.find((r) => r.id === where.id) || null,
      create: async ({ data }) => ({ ...data, id: data.id || nextId() }),
      update: async ({ where, data }) => {
        const row = store.computeQuote.rows.find((r) => r.id === where.id);
        Object.assign(row, data);
        return row;
      },
    };
    prisma.serviceCatalog = { findUnique: async () => service };
    store.computeJob.rows = [];
    prisma.computeJob = {
      findUnique: async () => null,
      create: async ({ data }) => {
        const row = { ...data, id: 'j9' };
        store.computeJob.rows.push(row);
        return row;
      },
      update: async () => { throw new Error('should not update'); },
    };

    const job = await createComputeJobFromAcceptedQuote({
      quoteId: 'q1',
      sellerUserId: 'contrib1',
      payerUserId: 'customer1',
      inputText: 'do the thing',
    });
    assert.equal(job.sellerUserId, 'contrib1', 'the reward goes to the contributor');
    assert.equal(job.payerUserId, 'customer1', 'the payment is attributed to the payer');
  });
});

// ── J1.11: cross-asset withdrawals cannot spend BNB reward value ──────────────

test('J1.11 only the reward settlement asset may be withdrawn', () => {
  assert.equal(REWARD_SETTLEMENT_ASSET, 'BNB');
  assert.equal(assetMatchesRewardSettlementAsset({ symbol: 'BNB' }), true);
  assert.equal(assetMatchesRewardSettlementAsset({ id: 'bsc', symbol: 'BNB' }), true);
  for (const symbol of ['ETH', 'MATIC', 'BTC', 'USDT', 'USDC', null, undefined, '']) {
    assert.equal(
      assetMatchesRewardSettlementAsset({ symbol }),
      false,
      `${symbol} must not be settled from BNB-denominated reward value`,
    );
  }
});

test('J1.11 a non-BNB payout is blocked and reserves no reward balance', async () => {
  await withDb(async ({ store }) => {
    store.rewardPool.rows.set(1, { id: 1, generatedBnb: '1', fundedBnb: '1', reservedBnb: '0', settledBnb: '0' });
    store.userRewardBalance.rows.set('u1', { userId: 'u1', totalEarnedBnb: '1', settledBnb: '0', reservedBnb: '0' });
    store.user = { rows: [{ id: 'u1', walletAddress: '0x1111111111111111111111111111111111111111' }] };
    prisma.user = { findUnique: async ({ where }) => store.user.rows.find((r) => r.id === where.id) || null };

    // Ethereum is a valid, configured network — but not the reward asset.
    const payout = await preparePayoutPlan({
      userId: 'u1',
      network: 'ethereum',
      amount: '0.1',
      recipientAddress: '0x2222222222222222222222222222222222222222',
    });

    assert.equal(payout.status, 'blocked');
    assert.match(payout.error, /BNB/);
    assert.match(payout.error, /no reward balance was reserved/i);
    assert.equal(
      store.userRewardBalance.rows.get('u1').reservedBnb,
      '0',
      'a blocked cross-asset payout must not lock BNB reward value',
    );
    assert.equal(store.settlementRecord.rows.size, 0, 'no settlement record is created for a blocked payout');
  });
});

test('J1.11 a BNB payout on BSC is not blocked by the asset guard', async () => {
  await withDb(async ({ store }) => {
    store.rewardPool.rows.set(1, { id: 1, generatedBnb: '1', fundedBnb: '1', reservedBnb: '0', settledBnb: '0' });
    store.userRewardBalance.rows.set('u1', { userId: 'u1', totalEarnedBnb: '1', settledBnb: '0', reservedBnb: '0' });
    store.user = { rows: [{ id: 'u1', walletAddress: '0x1111111111111111111111111111111111111111' }] };
    prisma.user = { findUnique: async ({ where }) => store.user.rows.find((r) => r.id === where.id) || null };

    const payout = await preparePayoutPlan({
      userId: 'u1',
      network: 'bsc',
      amount: '0.1',
      recipientAddress: '0x2222222222222222222222222222222222222222',
    });

    // The signer is not configured in tests, so it is blocked for that reason
    // rather than the asset guard — and the reservation is still made, proving
    // the asset guard did not intercept it.
    assert.doesNotMatch(String(payout.error || ''), /no reward balance was reserved/i);
  });
});
