// rewardService.js — task-generated reward pool accounting.
//
// ECONOMIC TRUTH (phase 0) — read this before touching any number here.
//
// The four legacy numbers and what they actually mean:
//
//   generatedBnb - deterministic rewards booked for qualifying completed tasks.
//                  ACCOUNTING VALUE. It is NOT a claim that BNB exists. A
//                  completed task does not create money.
//   fundedBnb    - whatever sources the operator declared via PoolFundingEvent.
//                  It is only as trustworthy as its fundingClass. Because an
//                  operator may type a number, fundedBnb may consist entirely
//                  of OPERATOR_FUNDING, which is the operator's own money and
//                  was NOT earned by any agent. fundedBnb is therefore NOT
//                  evidence of external revenue.
//   settleable   - BNB a user may request a withdrawal for today:
//                  floor(totalEarned * funded/generated) - reserved - settled
//                  Still an INTERNAL ENTITLEMENT. No asset exists until a
//                  payout is settled against a confirmed chain receipt.
//   on-chain     - actual treasury balance (read-only, owned by the operator).
//                  Real assets, but operator assets.
//
// Ledger invariant (per user): sum(CREDIT entries) - sum(DEBIT entries) =
// totalEarnedBnb - settledBnb. Reservations are value-neutral holds. Pool
// invariant: fundedBnb - settledBnb - reservedBnb = settleableCapacity >= 0.
//
// Settlement invariant (phase 0 fix): a withdrawal is SETTLED only after an
// on-chain receipt with status 1. Submission is not settlement. A reverted
// transaction is reversed through reverseSettlement().
//
// All writes inside a reward transaction run at SERIALIZABLE isolation so
// concurrent task completions / withdrawals can never lose an update.

import { Prisma } from '@prisma/client';
import prisma from '../prismaClient.js';
import logger from '../utils/logger.js';
import {
  toUnits,
  fromUnits,
  add,
  sub,
  max,
  clampNonNegative,
} from '../utils/decimal.js';
import { calculateRewardForTask } from './rewardCalculator.js';
import {
  calculationVersion,
  demoMode,
  REWARD_ASSET,
  rewardEconomyEnabled,
} from './rewardConfig.js';
import {
  FUNDING_CLASS,
  normaliseFundingClass,
  describeUserValue,
  describePoolValue,
} from './moneySemantics.js';
import { isIncomeEligible } from './taskLifecycle.js';

const POOL_ID = 1;

export const SOURCE_TYPES = Object.freeze([
  'PLATFORM_REVENUE',
  'EXTERNAL_DEPOSIT',
  'TREASURY_ALLOCATION',
  'APPROVED_LOAD',
  'COMPUTE_REVENUE',
  'OTHER',
]);

export const LEDGER_ENTRY = Object.freeze({
  CREDIT_TASK: 'CREDIT_TASK',
  CREDIT_COMPUTE_JOB: 'CREDIT_COMPUTE_JOB',
  RESERVATION: 'RESERVATION',
  RELEASE_RESERVATION: 'RELEASE_RESERVATION',
  SETTLEMENT: 'SETTLEMENT',
  // Phase 0: restores settleable capacity when a settled withdrawal is proven
  // to have reverted on-chain. Previously impossible (releaseReservation no-ops
  // on SETTLED), which silently debited users for transfers that never paid.
  SETTLEMENT_REVERSAL: 'SETTLEMENT_REVERSAL',
  FUNDING: 'FUNDING',
  CORRECTION: 'CORRECTION',
});

export const SETTLEMENT_STATUS = Object.freeze({
  RESERVED: 'RESERVED',
  SETTLED: 'SETTLED',
  RELEASED: 'RELEASED',
  FAILED: 'FAILED',
  // Phase 0: a SETTLED payout whose on-chain transaction reverted. Distinct from
  // RELEASED so the audit trail shows the value moved and was then given back.
  REVERSED: 'REVERSED',
});

const TX_OPTIONS = {
  isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
  maxWait: 8000,
  timeout: 12000,
};

// ── Transaction runners ──────────────────────────────────────────────────────

function runRewardTx(fn) {
  return prisma.$transaction(fn, TX_OPTIONS);
}

// ── Aggregate helpers ────────────────────────────────────────────────────────

export async function getPool() {
  try {
    const pool = await prisma.rewardPool.findUnique({ where: { id: POOL_ID } });
    if (pool) return pool;
    return prisma.rewardPool.create({ data: { id: POOL_ID } });
  } catch (error) {
    // Concurrent first-create race: the row already exists.
    const pool = await prisma.rewardPool.findUnique({ where: { id: POOL_ID } });
    if (pool) return pool;
    throw error;
  }
}

async function getPoolInTx(tx) {
  try {
    const pool = await tx.rewardPool.findUnique({ where: { id: POOL_ID } });
    if (pool) return pool;
    return tx.rewardPool.create({ data: { id: POOL_ID } });
  } catch (error) {
    const pool = await tx.rewardPool.findUnique({ where: { id: POOL_ID } });
    if (pool) return pool;
    throw error;
  }
}

function computeFundedCapacityWei(totalEarnedWei, fundedWei, generatedWei) {
  if (generatedWei <= 0n || fundedWei <= 0n) return 0n;
  return (totalEarnedWei * fundedWei) / generatedWei;
}

function computeSettleableWei(bal, pool) {
  const total = toUnits(bal?.totalEarnedBnb || '0');
  const settled = toUnits(bal?.settledBnb || '0');
  const reserved = toUnits(bal?.reservedBnb || '0');
  const funded = toUnits(pool?.fundedBnb || '0');
  const generated = toUnits(pool?.generatedBnb || '0');
  const capacity = computeFundedCapacityWei(total, funded, generated);
  return clampNonNegative(capacity - reserved - settled);
}

function runningBalanceWei(bal) {
  return toUnits(bal?.totalEarnedBnb || '0') - toUnits(bal?.settledBnb || '0');
}

/**
 * Sum CONFIRMED funding events by funding class.
 *
 * This is the honest answer to "what is the pool's fundedBnb made of?".
 * Because an operator can type any number into the admin funding form,
 * `fundedBnb` alone proves nothing. The composition is what makes the figure
 * interpretable: a pool funded entirely by OPERATOR_FUNDING has no
 * agent-attributable external revenue behind it, and the report says so
 * instead of implying otherwise.
 *
 * Note the asymmetry with RewardPool.fundedBnb: the pool is only incremented
 * on confirmation, so summing CONFIRMED events must equal fundedBnb. Any
 * divergence is surfaced via `reconcilesWithPoolFunded` rather than hidden.
 */
export async function poolFundingComposition(client = prisma) {
  const rows = await client.poolFundingEvent.findMany({
    where: { status: 'CONFIRMED' },
    select: { amountBnb: true, fundingClass: true, status: true },
  });

  const byClass = Object.fromEntries(Object.values(FUNDING_CLASS).map((c) => [c, 0n]));
  let totalWei = 0n;
  for (const row of rows) {
    // Filter again in JS: keeps the invariant that only confirmed funding counts
    // regardless of how the caller/client applies the where clause.
    if (row.status && row.status !== 'CONFIRMED') continue;
    const wei = toUnits(row.amountBnb || '0');
    const key = Object.prototype.hasOwnProperty.call(byClass, row.fundingClass)
      ? row.fundingClass
      : FUNDING_CLASS.UNCLASSIFIED;
    byClass[key] = add(byClass[key], wei);
    totalWei = add(totalWei, wei);
  }

  return {
    totalBnb: fromUnits(totalWei, 8),
    byClassBnb: Object.fromEntries(Object.entries(byClass).map(([k, v]) => [k, fromUnits(v, 8)])),
    // The headline that must never be implied rather than stated: how much of
    // the pool is backed by real, independently verified external revenue.
    externalRevenueBackedBnb: fromUnits(byClass[FUNDING_CLASS.EXTERNAL_REVENUE], 8),
    operatorSubsidisedBnb: fromUnits(byClass[FUNDING_CLASS.OPERATOR_FUNDING], 8),
    testFundingBnb: fromUnits(byClass[FUNDING_CLASS.TEST_FUNDING], 8),
    unclassifiedBnb: fromUnits(byClass[FUNDING_CLASS.UNCLASSIFIED], 8),
    externalRevenueShare: totalWei > 0n ? Number(fromUnits(byClass[FUNDING_CLASS.EXTERNAL_REVENUE], 18)) / Number(fromUnits(totalWei, 18)) : 0,
    note:
      'Composition of confirmed pool funding by declared source. External revenue is only ever ' +
      'recorded by a verified external payment; operator funding is the operator’s own money and ' +
      'was not earned by any agent.',
  };
}

// ── Booking a task reward (Phase 3/4) ────────────────────────────────────────

/**
 * Book one deterministic reward for a qualifying completed task.
 * Idempotent by taskId: a task can never earn twice, even if completion is
 * processed concurrently or the worker retried. Returns the RewardEvent, or
 * null when the task does not qualify (not completed, no persisted result, or
 * an internal task without agentId such as payout-prepare records).
 */
export async function createRewardForTask(task, { userIdOverride = null } = {}) {
  if (!rewardEconomyEnabled()) return null;
  if (!task || typeof task !== 'object' || !task.id) return null;
  if (!isIncomeEligible(task)) return null;
  if (!task.agentId) return null;

  const existing = await prisma.rewardEvent.findUnique({ where: { taskId: task.id } }).catch(() => null);
  if (existing) return existing;

  const computed = calculateRewardForTask(task);
  if (!computed.rewardAmountWei || computed.rewardAmountWei <= 0n) return null;

  const userId = userIdOverride || task.userId;
  if (!userId) return null;

  try {
    return await runRewardTx(async (tx) => {
      const [bal, pool] = await Promise.all([
        tx.userRewardBalance.findUnique({ where: { userId } }),
        getPoolInTx(tx),
      ]);

      const amountWei = computed.rewardAmountWei;
      const newTotalWei = add(toUnits(bal?.totalEarnedBnb || '0'), amountWei);
      const running = runningBalanceWei({ ...bal, totalEarnedBnb: fromUnits(newTotalWei) });

      const event = {
        taskId: task.id,
        userId,
        agent: computed.agent,
        rewardType: 'TASK_COMPLETION',
        rewardAmountBnb: fromUnits(amountWei, 8),
        rewardAsset: REWARD_ASSET,
        calculationVersion: computed.calculationVersion,
        taskValueMetric: computed.taskValueMetric,
        status: 'CREDITED',
      };

      const createdEvent = await tx.rewardEvent.create({ data: event });
      await tx.rewardLedger.create({
        data: {
          userId,
          entryType: LEDGER_ENTRY.CREDIT_TASK,
          direction: 'CREDIT',
          amountBnb: fromUnits(amountWei, 8),
          runningBalanceBnb: fromUnits(running, 8),
          referenceId: task.id,
          note: 'Task completion reward.',
          meta: { taskId: task.id, agent: computed.agent, version: computed.calculationVersion },
        },
      });
      if (bal) {
        await tx.userRewardBalance.update({
          where: { userId },
          data: { totalEarnedBnb: fromUnits(newTotalWei) },
        });
      } else {
        await tx.userRewardBalance.create({
          data: { userId, totalEarnedBnb: fromUnits(newTotalWei) },
        });
      }
      await tx.rewardPool.update({
        where: { id: POOL_ID },
        data: { generatedBnb: fromUnits(add(pool.generatedBnb, amountWei)) },
      });

      return createdEvent;
    });
  } catch (error) {
    const msg = String(error?.message || '');
    if (/Unique constraint/.test(msg) || /RewardEvent_taskId_key/.test(msg)) {
      // Concurrent identical booking: the first writer won, reuse its event.
      return prisma.rewardEvent.findUnique({ where: { taskId: task.id } }).catch(() => null);
    }
    logger.error('[rewards] createRewardForTask failed', { taskId: task.id, error: error.message });
    // A bookkeeping failure must never fail the task itself.
    return null;
  }
}

// ── Revenue-backed funding + compute job rewards (Phase 4) ───────────────────

/**
 * Credit the reward pool with verified external compute revenue. MUST run
 * INSIDE the revenue-booking transaction (revenueService) so the RevenueEvent,
 * its allocations and the pool funding are atomic. Idempotency is guaranteed by
 * the caller's RevenueEvent uniqueness check (one funding per revenue event).
 */
export async function fundPoolFromRevenueTx(tx, { amountBnb, reference, simulated = false, confirmedBy = null, note = null }) {
  const amountWei = toUnits(amountBnb);
  if (amountWei <= 0n) return null;

  // ECONOMIC TRUTH: revenue booked by an operator-submitted payment intent is
  // NOT externally verified revenue, so it can never be recorded as
  // EXTERNAL_REVENUE. It is either the operator's own declaration
  // (OPERATOR_FUNDING) or synthetic demo value (TEST_FUNDING).
  // The only writer of EXTERNAL_REVENUE would be a payment path verified
  // outside this platform, which does not exist in this deployment.
  const fundingClass = simulated ? FUNDING_CLASS.TEST_FUNDING : FUNDING_CLASS.OPERATOR_FUNDING;

  const pool = await getPoolInTx(tx);
  const event = await tx.poolFundingEvent.create({
    data: {
      sourceType: 'COMPUTE_REVENUE',
      fundingClass,
      amountBnb: fromUnits(amountWei, 8),
      reference: reference ? String(reference).slice(0, 200) : null,
      status: 'CONFIRMED',
      simulated,
      confirmedBy: confirmedBy || null,
      confirmedAt: new Date(),
      note: note ? String(note).slice(0, 500) : 'Compute revenue funding declared by an operator. Not externally verified.',
      meta: {
        automatic: true,
        revenueEventId: reference,
        verificationMethod: simulated ? 'SIMULATED' : 'OPERATOR_ASSERTED',
      },
    },
  });

  const fundedNext = add(toUnits(pool.fundedBnb || '0'), amountWei);
  await tx.rewardPool.update({
    where: { id: POOL_ID },
    data: { fundedBnb: fromUnits(fundedNext) },
  });

  await tx.rewardLedger.create({
    data: {
      userId: '__pool__',
      entryType: LEDGER_ENTRY.FUNDING,
      direction: 'CREDIT',
      amountBnb: fromUnits(amountWei, 8),
      runningBalanceBnb: fromUnits(fundedNext, 8),
      referenceId: reference || event.id,
      note: 'Pool funding from a compute payment intent declared by an operator (not externally verified).',
    },
  });

  return event;
}

/**
 * Book one deterministic, revenue-backed reward for a monetized compute job.
 * Idempotent by computeJobId: a compute job can never earn twice. The amount is
 * the job's REWARD_FUNDING allocation (verified external revenue already in the
 * pool) — it is never fabricated independently of revenue.
 */
export async function createRewardForComputeJob({ job, rewardAmountBnb, meta = null }) {
  if (!rewardEconomyEnabled()) return null;
  if (!job || typeof job !== 'object' || !job.id) return null;
  if (job.status !== 'COMPLETED' || !job.completedAt) return null;

  const amountWei = toUnits(rewardAmountBnb);
  if (amountWei <= 0n) return null;

  const userId = job.sellerUserId;
  if (!userId) return null;

  const existing = await prisma.rewardEvent.findUnique({ where: { computeJobId: job.id } }).catch(() => null);
  if (existing) return existing;

  try {
    return await runRewardTx(async (tx) => {
      const [bal, pool] = await Promise.all([
        tx.userRewardBalance.findUnique({ where: { userId } }),
        getPoolInTx(tx),
      ]);

      const newTotalWei = add(toUnits(bal?.totalEarnedBnb || '0'), amountWei);
      const running = runningBalanceWei({ ...bal, totalEarnedBnb: fromUnits(newTotalWei) });

      const createdEvent = await tx.rewardEvent.create({
        data: {
          computeJobId: job.id,
          userId,
          agent: job.agent || 'general',
          rewardType: 'COMPUTE_JOB_REVENUE',
          rewardAmountBnb: fromUnits(amountWei, 8),
          rewardAsset: REWARD_ASSET,
          calculationVersion: String(process.env.COMPUTE_CALC_VERSION || '1.0.0'),
          taskValueMetric: { jobId: job.id, monetizedRevenueBnb: fromUnits(amountWei, 8), meta },
          status: 'CREDITED',
        },
      });
      await tx.rewardLedger.create({
        data: {
          userId,
          entryType: LEDGER_ENTRY.CREDIT_COMPUTE_JOB,
          direction: 'CREDIT',
          amountBnb: fromUnits(amountWei, 8),
          runningBalanceBnb: fromUnits(running, 8),
          referenceId: job.id,
          note: 'Revenue-backed compute job reward.',
          meta: { jobId: job.id, agent: job.agent || 'general', version: String(process.env.COMPUTE_CALC_VERSION || '1.0.0') },
        },
      });
      if (bal) {
        await tx.userRewardBalance.update({
          where: { userId },
          data: { totalEarnedBnb: fromUnits(newTotalWei) },
        });
      } else {
        await tx.userRewardBalance.create({
          data: { userId, totalEarnedBnb: fromUnits(newTotalWei) },
        });
      }
      await tx.rewardPool.update({
        where: { id: POOL_ID },
        data: { generatedBnb: fromUnits(add(toUnits(pool.generatedBnb), amountWei)) },
      });

      return createdEvent;
    });
  } catch (error) {
    const msg = String(error?.message || '');
    if (/Unique constraint/.test(msg) || /RewardEvent_computeJobId_key/.test(msg)) {
      return prisma.rewardEvent.findUnique({ where: { computeJobId: job.id } }).catch(() => null);
    }
    logger.error('[rewards] createRewardForComputeJob failed', { jobId: job.id, error: error.message });
    return null;
  }
}

// ── Reservation / settlement lifecycle (Phase 7/8) ───────────────────────────

/**
 * Must run INSIDE the payout-creation transaction (payoutService) so the
 * payout row and its reservation are atomic. Rejects when the requested amount
 * exceeds the user's settleable balance.
 */
export async function reserveForPayoutTx(tx, { userId, payoutId, amountBnb, note = null }) {
  const amountWei = toUnits(amountBnb);
  if (amountWei <= 0n) {
    throw Object.assign(new Error('Payout amount must be greater than zero.'), { status: 422 });
  }

  const [bal, pool] = await Promise.all([
    tx.userRewardBalance.findUnique({ where: { userId } }),
    getPoolInTx(tx),
  ]);
  const settleableWei = computeSettleableWei(bal, pool);
  if (amountWei > settleableWei) {
    throw Object.assign(
      new Error(
        `Insufficient settleable balance. Requested ${fromUnits(amountWei, 8)} BNB but only ` +
          `${fromUnits(settleableWei, 8)} BNB is available to withdraw.`,
      ),
      {
        status: 422,
        payload: {
          availableToWithdrawBnb: fromUnits(settleableWei, 8),
          requestedBnb: fromUnits(amountWei, 8),
        },
      },
    );
  }

  await tx.settlementRecord.create({
    data: { payoutId, userId, amountBnb: fromUnits(amountWei, 8), status: SETTLEMENT_STATUS.RESERVED },
  });

  const newReservedWei = add(toUnits(bal?.reservedBnb || '0'), amountWei);
  if (bal) {
    await tx.userRewardBalance.update({
      where: { userId },
      data: { reservedBnb: fromUnits(newReservedWei) },
    });
  } else {
    await tx.userRewardBalance.create({
      data: { userId, totalEarnedBnb: '0', settledBnb: '0', reservedBnb: fromUnits(newReservedWei) },
    });
  }

  const poolReservedNext = add(toUnits(pool.reservedBnb || '0'), amountWei);
  await tx.rewardPool.update({
    where: { id: POOL_ID },
    data: { reservedBnb: fromUnits(poolReservedNext) },
  });

  await tx.rewardLedger.create({
    data: {
      userId,
      entryType: LEDGER_ENTRY.RESERVATION,
      direction: 'HOLD',
      amountBnb: fromUnits(amountWei, 8),
      runningBalanceBnb: fromUnits(runningBalanceWei(bal), 8),
      referenceId: payoutId,
      note: note || 'Withdrawal reserved pending settlement.',
    },
  });

  return { payoutId, amountBnb: fromUnits(amountWei, 8), settleableBnb: fromUnits(settleableWei - amountWei, 8) };
}

/**
 * Settle a payout's reservation. THIS IS ONLY CORRECT ONCE AN ON-CHAIN RECEIPT
 * WITH status 1 EXISTS.
 *
 * Phase 0 fix: settlement used to be called at broadcast time, which made
 * "submitted" indistinguishable from "paid" — an ambiguous or dropped
 * transaction left the ledger permanently debited. The invariant is now
 * enforced here as well as at the call site: settlement requires a transaction
 * hash, and callers must confirm the receipt first.
 *
 * Idempotent: an already-SETTLED record is returned unchanged, so a double
 * call after ambiguous network behaviour can never double-count.
 */
export async function settleReservation({ payoutId, txHash, settledBy, note = null }) {
  // A settlement without a transaction hash would be an unverifiable claim that
  // a transfer happened. Refuse it rather than record fiction.
  if (!txHash || typeof txHash !== 'string' || txHash.trim() === '') {
    throw Object.assign(
      new Error(
        'Settlement requires a transaction hash. A withdrawal is only settled after an on-chain ' +
          'receipt is confirmed, never at broadcast time.',
      ),
      { status: 422 },
    );
  }

  return runRewardTx(async (tx) => {
    const rec = await tx.settlementRecord.findUnique({ where: { payoutId } });
    if (!rec) return null;
    if (rec.status === SETTLEMENT_STATUS.SETTLED) return rec;

    if (rec.status !== SETTLEMENT_STATUS.RESERVED && rec.status !== SETTLEMENT_STATUS.FAILED) {
      return rec;
    }

    const amountWei = toUnits(rec.amountBnb);
    const bal = await tx.userRewardBalance.findUnique({ where: { userId: rec.userId } });
    const pool = await getPoolInTx(tx);

    await tx.settlementRecord.update({
      where: { payoutId },
      data: { status: SETTLEMENT_STATUS.SETTLED, settledAt: new Date(), settledBy, txHash },
    });

    if (bal) {
      await tx.userRewardBalance.update({
        where: { userId: rec.userId },
        data: {
          reservedBnb: fromUnits(clampNonNegative(sub(toUnits(bal.reservedBnb || '0'), amountWei))),
          settledBnb: fromUnits(add(toUnits(bal.settledBnb || '0'), amountWei)),
        },
      });
    }

    await tx.rewardPool.update({
      where: { id: POOL_ID },
      data: {
        reservedBnb: fromUnits(clampNonNegative(sub(toUnits(pool.reservedBnb || '0'), amountWei))),
        settledBnb: fromUnits(add(toUnits(pool.settledBnb || '0'), amountWei)),
      },
    });

    await tx.rewardLedger.create({
      data: {
        userId: rec.userId,
        entryType: LEDGER_ENTRY.SETTLEMENT,
        direction: 'DEBIT',
        amountBnb: fromUnits(amountWei, 8),
        runningBalanceBnb: fromUnits(runningBalanceWei(bal) - amountWei),
        referenceId: payoutId,
        note: note || 'Withdrawal settled after a confirmed on-chain receipt (status 1).',
      },
    });

    return { ...rec, status: SETTLEMENT_STATUS.SETTLED, txHash };
  });
}

/**
 * Reverse a settlement whose on-chain transaction turned out to be REVERTED.
 *
 * Phase 0 fix: payoutService previously called releaseReservation() for failed
 * payouts, but releaseReservation() returns early for a SETTLED record. Once a
 * payout was wrongly settled at broadcast time, a later failed status could
 * never undo it, so the user was debited for a transfer that never happened.
 * This function restores the user's settleable capacity and the pool invariant
 * while preserving the audit trail.
 *
 * Idempotent: reversing an already-REVERSED record is a no-op.
 */
export async function reverseSettlement({ payoutId, txHash = null, reason = null, reversedBy = null }) {
  return runRewardTx(async (tx) => {
    const rec = await tx.settlementRecord.findUnique({ where: { payoutId } });
    if (!rec) return null;
    if (rec.status === SETTLEMENT_STATUS.REVERSED) return rec;
    if (rec.status !== SETTLEMENT_STATUS.SETTLED) return rec;

    const amountWei = toUnits(rec.amountBnb);
    const bal = await tx.userRewardBalance.findUnique({ where: { userId: rec.userId } });

    await tx.settlementRecord.update({
      where: { payoutId },
      data: {
        status: SETTLEMENT_STATUS.REVERSED,
        reversedAt: new Date(),
        reversedBy: reversedBy || null,
        note: reason ? String(reason).slice(0, 500) : 'Settlement reversed: on-chain transaction reverted.',
      },
    });

    if (bal) {
      await tx.userRewardBalance.update({
        where: { userId: rec.userId },
        data: { settledBnb: fromUnits(clampNonNegative(sub(toUnits(bal.settledBnb || '0'), amountWei))) },
      });
    }

    const pool = await getPoolInTx(tx);
    await tx.rewardPool.update({
      where: { id: POOL_ID },
      data: { settledBnb: fromUnits(clampNonNegative(sub(toUnits(pool.settledBnb || '0'), amountWei))) },
    });

    await tx.rewardLedger.create({
      data: {
        userId: rec.userId,
        entryType: LEDGER_ENTRY.SETTLEMENT_REVERSAL,
        direction: 'CREDIT',
        amountBnb: fromUnits(amountWei, 8),
        runningBalanceBnb: fromUnits(
          runningBalanceWei(bal ? { ...bal, settledBnb: fromUnits(clampNonNegative(sub(toUnits(bal.settledBnb || '0'), amountWei))) } : bal),
          8,
        ),
        referenceId: payoutId,
        note: reason
          ? `Settlement reversed (${txHash || 'no tx hash'}): ${String(reason).slice(0, 300)}`
          : 'Settlement reversed: on-chain transaction reverted; settleable capacity restored.',
        meta: { txHash },
      },
    });

    return { ...rec, status: SETTLEMENT_STATUS.REVERSED };
  });
}

/**
 * Release a reservation (payout rejected, or broadcast definitively failed
 * before/without settlement). Restores the settleable capacity and preserves
 * the audit trail. Idempotent.
 */
export async function releaseReservation({ payoutId, note = null }) {
  return runRewardTx(async (tx) => {
    const rec = await tx.settlementRecord.findUnique({ where: { payoutId } });
    if (!rec) return null;
    if (rec.status === SETTLEMENT_STATUS.RELEASED) return rec;
    if (rec.status === SETTLEMENT_STATUS.SETTLED) return rec;

    const amountWei = toUnits(rec.amountBnb);
    const bal = await tx.userRewardBalance.findUnique({ where: { userId: rec.userId } });

    await tx.settlementRecord.update({
      where: { payoutId },
      data: { status: SETTLEMENT_STATUS.RELEASED, releasedAt: new Date(), note: note || 'Reservation released.' },
    });

    if (bal) {
      await tx.userRewardBalance.update({
        where: { userId: rec.userId },
        data: { reservedBnb: fromUnits(clampNonNegative(sub(toUnits(bal.reservedBnb || '0'), amountWei))) },
      });
    }

    const pool = await getPoolInTx(tx);
    await tx.rewardPool.update({
      where: { id: POOL_ID },
      data: { reservedBnb: fromUnits(clampNonNegative(sub(toUnits(pool.reservedBnb || '0'), amountWei))) },
    });

    await tx.rewardLedger.create({
      data: {
        userId: rec.userId,
        entryType: LEDGER_ENTRY.RELEASE_RESERVATION,
        direction: 'HOLD',
        amountBnb: fromUnits(amountWei, 8),
        runningBalanceBnb: fromUnits(runningBalanceWei(bal)),
        referenceId: payoutId,
        note: note || 'Reservation released (rejected / not settled).',
      },
    });

    return { ...rec, status: SETTLEMENT_STATUS.RELEASED };
  });
}

// ── User balance semantics (Phase 6) ─────────────────────────────────────────

export async function getUserRewardBalance(userId) {
  const [bal, pool, fundingComposition] = await Promise.all([
    prisma.userRewardBalance.findUnique({ where: { userId } }),
    getPool(),
    poolFundingComposition(),
  ]);

  const totalWei = toUnits(bal?.totalEarnedBnb || '0');
  const settledWei = toUnits(bal?.settledBnb || '0');
  const reservedWei = toUnits(bal?.reservedBnb || '0');
  const fundedWei = toUnits(pool?.fundedBnb || '0');
  const generatedWei = toUnits(pool?.generatedBnb || '0');

  const fundedCapacityWei = computeFundedCapacityWei(totalWei, fundedWei, generatedWei);
  const settleableWei = clampNonNegative(fundedCapacityWei - reservedWei - settledWei);
  const pendingRewardWei = clampNonNegative(totalWei - fundedCapacityWei);
  const fundingRatio = generatedWei > 0n ? Number(fromUnits(fundedWei, 18)) / Number(fromUnits(generatedWei, 18)) : 0;

  return {
    simulated: demoMode(),
    currency: 'BNB',
    totalEarnedBnb: fromUnits(totalWei, 8),
    pendingRewardBnb: fromUnits(pendingRewardWei, 8),
    availableToWithdrawBnb: fromUnits(settleableWei, 8),
    reservedBnb: fromUnits(reservedWei, 8),
    settledBnb: fromUnits(settledWei, 8),
    fundingRatio,
    pool: {
      generatedBnb: fromUnits(generatedWei, 8),
      fundedBnb: fromUnits(fundedWei, 8),
    },
    // Economic-state metadata. Clients can render the truth without having to
    // re-derive it, and no client can read these numbers as "income".
    value: describeUserValue({
      totalEarnedBnb: fromUnits(totalWei, 8),
      pendingRewardBnb: fromUnits(pendingRewardWei, 8),
      availableToWithdrawBnb: fromUnits(settleableWei, 8),
      reservedBnb: fromUnits(reservedWei, 8),
      settledBnb: fromUnits(settledWei, 8),
      fundingRatio,
      pool: {
        generatedBnb: fromUnits(generatedWei, 8),
        fundedBnb: fromUnits(fundedWei, 8),
      },
      simulated: demoMode(),
    }),
    poolFundingComposition: fundingComposition,
    semanticsNote:
      'availableToWithdraw is generated rewards backed by confirmed funding, minus reservations and ' +
      'settled payouts. Pending rewards need the pool to be funded before withdrawal. It is an ' +
      'entitlement to request a withdrawal, not money in hand: only settled amounts are real ' +
      'on-chain assets, and they are paid from the operator treasury.',
  };
}

// ── Pool overview (Phase 4/5) ────────────────────────────────────────────────

export async function getPoolOverview() {
  const [pool, fundingComposition] = await Promise.all([getPool(), poolFundingComposition()]);
  const generatedWei = toUnits(pool?.generatedBnb || '0');
  const fundedWei = toUnits(pool?.fundedBnb || '0');
  const settledWei = toUnits(pool?.settledBnb || '0');
  const reservedWei = toUnits(pool?.reservedBnb || '0');

  return {
    simulated: demoMode(),
    currency: 'BNB',
    generatedBnb: fromUnits(generatedWei, 8),
    fundedBnb: fromUnits(fundedWei, 8),
    settledBnb: fromUnits(settledWei, 8),
    reservedBnb: fromUnits(reservedWei, 8),
    settleableCapacityBnb: fromUnits(clampNonNegative(fundedWei - settledWei - reservedWei), 8),
    unfundedBnb: fromUnits(clampNonNegative(generatedWei - fundedWei), 8),
    fundingRatio: generatedWei > 0n ? Number(fromUnits(fundedWei, 18)) / Number(fromUnits(generatedWei, 18)) : 0,
    onChainTreasuryBalanceBnb: null,
    // J1.3: fundedBnb is only as meaningful as its composition. Reporting the
    // total alone would let operator-typed numbers read as earned revenue.
    fundingComposition,
    externalRevenueBackedBnb: fundingComposition.externalRevenueBackedBnb,
    operatorSubsidisedBnb: fundingComposition.operatorSubsidisedBnb,
    value: describePoolValue({
      generatedBnb: fromUnits(generatedWei, 8),
      fundedBnb: fromUnits(fundedWei, 8),
      settledBnb: fromUnits(settledWei, 8),
      reservedBnb: fromUnits(reservedWei, 8),
      simulated: demoMode(),
    }),
    semanticsNote:
      'generated is the task reward accounting value — it is not a claim that BNB exists. funded ' +
      'reflects whatever sources the operator declared, so read it together with ' +
      'fundingComposition: a pool funded by operator money has no agent-attributable external ' +
      'revenue behind it. settleableCapacity = funded - settled - reserved.',
  };
}

// ── Funding events (Phase 5) ─────────────────────────────────────────────────

/**
 * Declare a funding event. `fundingClass` records the economic truth about
 * where the money came from and cannot be self-declared as EXTERNAL_REVENUE
 * (see normaliseFundingClass): an operator asserting that they are paying in
 * external revenue is precisely the false claim this phase exists to prevent.
 */
export async function createFundingEvent({ sourceType, amountBnb, reference = null, note = null, fundingClass = null }) {
  const type = String(sourceType || '').toUpperCase().trim();
  if (!SOURCE_TYPES.includes(type)) {
    throw Object.assign(new Error(`sourceType must be one of: ${SOURCE_TYPES.join(', ')}.`), { status: 422 });
  }
  const amountWei = toUnits(amountBnb);
  if (amountWei <= 0n) {
    throw Object.assign(new Error('Funding amount must be greater than zero.'), { status: 422 });
  }
  const resolvedClass = normaliseFundingClass(fundingClass, { simulated: demoMode() });

  return prisma.poolFundingEvent.create({
    data: {
      sourceType: type,
      fundingClass: resolvedClass,
      amountBnb: fromUnits(amountWei, 8),
      reference: reference ? String(reference).slice(0, 200) : null,
      status: 'PENDING',
      simulated: demoMode(),
      note: note ? String(note).slice(0, 500) : null,
      meta: { declaredByOperator: true },
    },
  });
}

export async function confirmFundingEvent({ eventId, requestedBy }) {
  return runRewardTx(async (tx) => {
    const evt = await tx.poolFundingEvent.findUnique({ where: { id: eventId } });
    if (!evt) throw Object.assign(new Error('Funding event not found.'), { status: 404 });
    if (evt.status === 'CONFIRMED') return evt;

    const amountWei = toUnits(evt.amountBnb);
    const pool = await getPoolInTx(tx);
    await tx.rewardPool.update({
      where: { id: POOL_ID },
      data: { fundedBnb: fromUnits(add(toUnits(pool.fundedBnb || '0'), amountWei)) },
    });
    await tx.poolFundingEvent.update({
      where: { id: eventId },
      data: { status: 'CONFIRMED', confirmedAt: new Date(), confirmedBy: requestedBy || null },
    });
    await tx.rewardLedger.create({
      data: {
        userId: '__pool__',
        entryType: LEDGER_ENTRY.FUNDING,
        direction: 'CREDIT',
        amountBnb: fromUnits(amountWei, 8),
        runningBalanceBnb: fromUnits(add(toUnits(pool.fundedBnb || '0'), amountWei), 8),
        referenceId: eventId,
        // The ledger records WHICH kind of money arrived, so the audit trail can
        // never be read as "revenue was earned".
        note: `Pool funding confirmed (${evt.fundingClass || FUNDING_CLASS.UNCLASSIFIED}). Operator-declared; not externally verified.`,
        meta: { fundingClass: evt.fundingClass || FUNDING_CLASS.UNCLASSIFIED, confirmedBy: requestedBy || null },
      },
    });

    return { ...evt, status: 'CONFIRMED' };
  });
}

// ── History / audit (Phase 11) ───────────────────────────────────────────────

export async function listRewardEvents(userId, take = 50) {
  return prisma.rewardEvent.findMany({
    where: { userId },
    orderBy: { createdAt: 'desc' },
    take: Math.min(Number(take) || 50, 200),
  });
}

export async function listRewardLedger(userId, take = 50) {
  return prisma.rewardLedger.findMany({
    where: { userId },
    orderBy: { createdAt: 'desc' },
    take: Math.min(Number(take) || 50, 200),
  });
}

export async function listFundingEvents(take = 100) {
  return prisma.poolFundingEvent.findMany({
    orderBy: { createdAt: 'desc' },
    take: Math.min(Number(take) || 100, 300),
  });
}

export async function listSettlementRecords(take = 100) {
  return prisma.settlementRecord.findMany({
    orderBy: { reservedAt: 'desc' },
    take: Math.min(Number(take) || 100, 300),
  });
}

export async function findReservationByPayoutId(payoutId) {
  return prisma.settlementRecord.findUnique({ where: { payoutId } }).catch(() => null);
}

export async function rewardInvariantSummary() {
  const [pool, ledgerRows, userRows] = await Promise.all([
    getPool(),
    prisma.rewardLedger.findMany({ select: { userId: true, entryType: true, direction: true, amountBnb: true } }),
    prisma.userRewardBalance.findMany(),
  ]);

  const byUser = {};
  for (const row of ledgerRows) {
    const credit = row.direction === 'CREDIT';
    const debit = row.direction === 'DEBIT';
    if (credit) byUser[row.userId] = add(byUser[row.userId] || '0', row.amountBnb);
    if (debit) byUser[row.userId] = sub(byUser[row.userId] || '0', row.amountBnb);
  }

  const mismatches = userRows
    .filter((u) => sub(toUnits(u.totalEarnedBnb), toUnits(u.settledBnb)) !== (byUser[u.userId] || 0n))
    .map((u) => u.userId);

  return {
    pool: await getPoolOverview(),
    ledgerNetByUser: Object.fromEntries(Object.entries(byUser).map(([k, v]) => [k, fromUnits(v, 8)])),
    userRows: userRows.map((u) => ({
      userId: u.userId,
      totalEarnedBnb: u.totalEarnedBnb,
      settledBnb: u.settledBnb,
      reservedBnb: u.reservedBnb,
      ledgerInvariantHolds: (byUser[u.userId] || 0n) === sub(toUnits(u.totalEarnedBnb), toUnits(u.settledBnb)),
    })),
    invariantHolds: mismatches.length === 0,
    mismatchUserIds: mismatches,
    calculationVersion: calculationVersion(),
  };
}

// ── Demo / economy flags (Phase 10) ──────────────────────────────────────────

export { demoMode, rewardEconomyEnabled };

export async function ensureRewardPool() {
  const pool = await getPool();
  return pool && !pool.generatedBnb && !pool.fundedBnb && !pool.reservedBnb && !pool.settledBnb;
}