// earningsService.js — server-authoritative task activity ledger.
//
// ── J1.6 TRUTH CORRECTION ────────────────────────────────────────────────────
// This service was named and shaped as an "earnings" ledger while measuring
// nothing of the kind. It multiplies a server-side constant (0.0035) by the
// count of completed tasks. No ETH is received, none is transferred, and the
// figure is disconnected from the BNB-denominated reward economy in
// rewardService.js — the platform's only settlement path. Presenting it as ETH
// earnings therefore asserted an asset that does not exist, in a currency the
// platform never pays out, backed by no external revenue.
//
// The arithmetic is unchanged and remains server-authoritative: a client still
// cannot write status/result (see restricted PATCH /tasks/:id), so the count
// cannot be inflated from the browser. Only the naming and interpretation
// change. The canonical field is now `totalActivityUnits` in TASK_UNITS; the old
// ETH-denominated fields are kept only under explicitly deprecated names, and
// `deprecatedAliases` lists them so a client can drop them.

import prisma from '../prismaClient.js';
import logger from '../utils/logger.js';

function envNumber(name, fallback) {
  const raw = Number(process.env[name]);
  return Number.isFinite(raw) && raw > 0 ? raw : fallback;
}

/** Display weight of one completed task. Not a currency. */
export function taskUnitRate() {
  return envNumber('EARNING_RATE_ETH', 0.0035);
}

/** @deprecated Use {@link taskUnitRate}. Kept for internal callers only. */
export function earningRateEth() {
  return taskUnitRate();
}

export function isEligibleTask(task) {
  return Boolean(
    task &&
      task.status === 'completed' &&
      task.completedAt &&
      typeof task.result === 'string' &&
      task.result.trim().length > 0,
  );
}

export function computeEarningsFromTasks(tasks, unitRate) {
  const rate = Number.isFinite(unitRate) && unitRate > 0 ? unitRate : taskUnitRate();
  const eligible = (Array.isArray(tasks) ? tasks : []).filter(isEligibleTask);

  let latestMs = null;
  for (const task of eligible) {
    const ms = new Date(task.completedAt).getTime();
    if (!Number.isNaN(ms) && (latestMs === null || ms > latestMs)) latestMs = ms;
  }

  const totalActivityUnits = eligible.length * rate;
  return {
    completedCount: eligible.length,
    eligibleCount: eligible.length,
    // Canonical, honest fields.
    unit: 'TASK_UNITS',
    isMoney: false,
    valueTier: 'ACCOUNTING_VALUE',
    activityUnitsPerTask: rate,
    totalActivityUnits,
    lastEligibleAt: latestMs === null ? null : new Date(latestMs).toISOString(),
    // The platform's only settlement path is BNB, and only for revenue-backed
    // rewards. Stated so this counter is never read as a balance.
    rewardAsset: 'BNB',
    note:
      'Server-side count of completed tasks with non-empty results, times a fixed display rate. '
      + 'This is a task counter, not ETH and not income. No ETH is received or paid out, and it is '
      + 'separate from the BNB reward economy that governs actual withdrawals.',
    // Legacy ETH-denominated fields. Retained only so an un-updated client does
    // not crash, and listed here so they are visibly deprecated.
    deprecatedAliases: {
      rateEth: rate,
      totalEth: totalActivityUnits,
      totalWei: Math.round(totalActivityUnits * 1e18),
    },
    noteDeprecated:
      'rateEth/totalEth/totalWei are deprecated aliases of the TASK_UNITS fields above. They are '
      + 'not an ETH balance and must never be presented as earnings or as withdrawable value.',
  };
}

export async function computeUserEarnings(userId) {
  try {
    const tasks = await prisma.task.findMany({
      where: { userId, archived: false },
      select: { id: true, status: true, completedAt: true, result: true },
    });
    return computeEarningsFromTasks(tasks, taskUnitRate());
  } catch (error) {
    logger.warn('[earnings] computeUserEarnings failed', error.message);
    return computeEarningsFromTasks([], taskUnitRate());
  }
}