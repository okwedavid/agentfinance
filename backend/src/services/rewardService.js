// rewardService.js — task-generated reward pool accounting.
//
// The reward economy distinguishes four numbers that must never be conflated:
//   generatedBnb - deterministic rewards booked for qualifying completed tasks
//                    (accounting value of delivered work; NOT a claim that this
//                    BNB exists on-chain).
//   fundedBnb    - confirmed funding events (PLATFORM_REVENUE / EXTERNAL_DEPOSIT /
//                    TREASURY_ALLOCATION ...) that provide real backing.
//   settleable   - BNB a user may actually withdraw today:
//                    floor(totalEarned * funded/generated) - reserved - settled
//   on-chain     - actual treasury balance (read-only, owned by the operator).
//
// Ledger invariant (per user): sum(CREDIT entries) - sum(DEBIT entries) =
// totalEarnedBnb - settledBnb. Reservations are value-neutral holds. Pool
// invariant: fundedBnb - settledBnb - reservedBnb = settleableCapacity >= 0.
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
  FUNDING: 'FUNDING',
  CORRECTION: 'CORRECTION',
});

export const SETTLEMENT_STATUS = Object.freeze({
  RESERVED: 'RESERVED',
  SETTLED: 'SETTLED',
  RELEASED: 'RELEASED',
  FAILED: 'FAILED',
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

  const pool = await getPoolInTx(tx);
  const event = await tx.poolFundingEvent.create({
    data: {
      sourceType: 'COMPUTE_REVENUE',
      amountBnb: fromUnits(amountWei, 8),
      reference: reference ? String(reference).slice(0, 200) : null,
      status: 'CONFIRMED',
      simulated,
      confirmedBy: confirmedBy || null,
      confirmedAt: new Date(),
      note: note ? String(note).slice(0, 500) : 'Revenue-backed compute funding (COMPUTE_REVENUE).',
      meta: { automatic: true, revenueEventId: reference },
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
      note: 'Revenue-backed pool funding confirmed from compute revenue.',
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
 * Settle a payout's reservation once broadcast (the treasury actually paid).
 * Idempotent: an already-SETTLED record is returned unchanged, so a double
 * call after ambiguous network behaviour can never double-count.
 */
export async function settleReservation({ payoutId, txHash, settledBy, note = null }) {
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
        note: note || 'Withdrawal settled on-chain.',
      },
    });

    return { ...rec, status: SETTLEMENT_STATUS.SETTLED, txHash };
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
  const [bal, pool] = await Promise.all([
    prisma.userRewardBalance.findUnique({ where: { userId } }),
    getPool(),
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
    semanticsNote:
      'availableToWithdraw is generated rewards backed by confirmed funding, minus reservations and settled payouts. Pending rewards need the pool to be funded before withdrawal.',
  };
}

// ── Pool overview (Phase 4/5) ────────────────────────────────────────────────

export async function getPoolOverview() {
  const pool = await getPool();
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
    semanticsNote:
      'generated is the task reward accounting value; funded is real confirmed backing; settleableCapacity = funded - settled - reserved; onChain is the actual treasury balance.',
  };
}

// ── Funding events (Phase 5) ─────────────────────────────────────────────────

export async function createFundingEvent({ sourceType, amountBnb, reference = null, note = null }) {
  const type = String(sourceType || '').toUpperCase().trim();
  if (!SOURCE_TYPES.includes(type)) {
    throw Object.assign(new Error(`sourceType must be one of: ${SOURCE_TYPES.join(', ')}.`), { status: 422 });
  }
  const amountWei = toUnits(amountBnb);
  if (amountWei <= 0n) {
    throw Object.assign(new Error('Funding amount must be greater than zero.'), { status: 422 });
  }

  return prisma.poolFundingEvent.create({
    data: {
      sourceType: type,
      amountBnb: fromUnits(amountWei, 8),
      reference: reference ? String(reference).slice(0, 200) : null,
      status: 'PENDING',
      simulated: demoMode(),
      note: note ? String(note).slice(0, 500) : null,
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
        note: 'Pool funding confirmed.',
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