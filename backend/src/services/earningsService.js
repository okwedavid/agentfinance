/**
 * earningsService.js — SERVER-AUTHORITATIVE earnings calculation.
 *
 * Earnings are derived ONLY from authoritative CompletedTask records: a task
 * is financially eligible only when status === 'completed' AND its result was
 * persisted. Failed, timed-out, cancelled, retrying, running and queued tasks
 * contribute zero. Retries and duplicate completion events can never create
 * duplicate earnings because value is computed from the set of distinct task
 * records, not from execution attempts.
 */
import prisma from '../prismaClient.js';
import { isIncomeEligible, TASK_STATUS } from './taskLifecycle.js';

/** Per-completed-task earning rate (ETH), server-side only. */
export function getEarningRateEth() {
  const raw = Number(process.env.EARNING_RATE_ETH);
  return Number.isFinite(raw) && raw > 0 ? raw : 0.0035;
}

const INCOME_EXCLUDED = new Set([
  TASK_STATUS.FAILED,
  TASK_STATUS.TIMED_OUT,
  TASK_STATUS.CANCELLED,
  TASK_STATUS.RETRYING,
  TASK_STATUS.RUNNING,
  TASK_STATUS.QUEUED,
]);

export function isStatusIncomeExcluded(status) {
  return INCOME_EXCLUDED.has(status);
}

/**
 * Pure earnings core: given the set of a user's task records, derive earnings
 * from distinct authoritative completed records. Failed, timed-out, cancelled,
 * running and queued records contribute zero — retries and duplicate events can
 * never inflate the total because value comes from distinct records, not
 * execution attempts. Exported separately so the rule itself is unit-testable
 * without a database.
 */
export function computeEarningsFromTasks(tasks, rate) {
  const safe = Array.isArray(tasks) ? tasks : [];
  const eligible = safe.filter((task) => isIncomeEligible(task));
  const total = Number((eligible.length * rate).toFixed(8));
  return {
    completedCount: eligible.length,
    perTaskEth: rate,
    totalEth: total,
    incomeEligible: eligible.length > 0,
  };
}

/**
 * Count distinct authoritative completed tasks for a user and compute total
 * earnings. Uses SQL-level filters so the count can never be inflated by
 * client-supplied values or duplicated WebSocket events.
 */
export async function computeUserEarnings(userId) {
  const rate = getEarningRateEth();

  const completedTasks = await prisma.task.findMany({
    where: {
      userId,
      status: TASK_STATUS.COMPLETED,
      completedAt: { not: null },
      archived: false,
    },
    select: { id: true, completedAt: true, result: true, status: true },
    orderBy: { completedAt: 'asc' },
  });

  return computeEarningsFromTasks(completedTasks, rate);
}

/** Single-task helper used by tests. */
export function taskIncomeEligibility(task) {
  return {
    eligible: isIncomeEligible(task),
    status: task?.status || null,
  };
}