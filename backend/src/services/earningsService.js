// earningsService.js — server-authoritative earnings ledger.
//
// Earnings are computed ONLY from tasks that the server persisted as
// 'completed' with a non-empty result. A client can never write status/result
// (see restricted PATCH /tasks/:id), so this ledger cannot be inflated from
// the browser. Default rate: EARNING_RATE_ETH (0.0035 ETH per completed task).

import prisma from '../prismaClient.js';
import logger from '../utils/logger.js';

function envNumber(name, fallback) {
  const raw = Number(process.env[name]);
  return Number.isFinite(raw) && raw > 0 ? raw : fallback;
}

export function earningRateEth() {
  return envNumber('EARNING_RATE_ETH', 0.0035);
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

export function computeEarningsFromTasks(tasks, rateEth) {
  const rate = Number.isFinite(rateEth) && rateEth > 0 ? rateEth : earningRateEth();
  const eligible = (Array.isArray(tasks) ? tasks : []).filter(isEligibleTask);

  let latestMs = null;
  for (const task of eligible) {
    const ms = new Date(task.completedAt).getTime();
    if (!Number.isNaN(ms) && (latestMs === null || ms > latestMs)) latestMs = ms;
  }

  const totalEth = eligible.length * rate;
  return {
    completedCount: eligible.length,
    eligibleCount: eligible.length,
    rateEth: rate,
    totalEth,
    totalWei: Math.round(totalEth * 1e18),
    lastEligibleAt: latestMs === null ? null : new Date(latestMs).toISOString(),
    note: 'Server ledger from persisted completed tasks with non-empty results.',
  };
}

export async function computeUserEarnings(userId) {
  try {
    const tasks = await prisma.task.findMany({
      where: { userId, archived: false },
      select: { id: true, status: true, completedAt: true, result: true },
    });
    return computeEarningsFromTasks(tasks, earningRateEth());
  } catch (error) {
    logger.warn('[earnings] computeUserEarnings failed', error.message);
    return computeEarningsFromTasks([], earningRateEth());
  }
}