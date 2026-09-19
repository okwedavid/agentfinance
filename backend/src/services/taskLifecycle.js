/**
 * taskLifecycle.js — canonical task lifecycle for AgentFinance.
 *
 * Conceptual lifecycle (canonical, uppercase):
 *   QUEUED -> RUNNING -> RETRYING -> COMPLETED
 *   QUEUED -> RUNNING -> FAILED
 *   QUEUED -> RUNNING -> TIMED_OUT
 *   QUEUED -> CANCELLED
 *
 * The database stores lower-case status strings for backward compatibility
 * with existing frontend filters. Use the helpers here — never hand-write
 * status strings across the app.
 */

export const TASK_STATUS = Object.freeze({
  QUEUED: 'queued',
  PENDING: 'pending', // legacy alias of queued
  RUNNING: 'running',
  RETRYING: 'retrying',
  COMPLETED: 'completed',
  FAILED: 'failed',
  TIMED_OUT: 'timed_out',
  CANCELLED: 'cancelled',
});

const TERMINAL = new Set([
  TASK_STATUS.COMPLETED,
  TASK_STATUS.FAILED,
  TASK_STATUS.TIMED_OUT,
  TASK_STATUS.CANCELLED,
]);

export function isTerminalStatus(status) {
  return TERMINAL.has(normalizeStatus(status));
}

export function normalizeStatus(status) {
  const value = String(status || '').toLowerCase();
  if (value === 'pending') return TASK_STATUS.QUEUED;
  if (value === TASK_STATUS.QUEUED) return TASK_STATUS.QUEUED;
  if (TERMINAL.has(value)) return value;
  if (value === TASK_STATUS.RUNNING || value === TASK_STATUS.RETRYING) return value;
  return value;
}

/**
 * A task is financially eligible ONLY when it reached the COMPLETED terminal
 * state AND its result was persisted (result + completedAt non-null).
 */
export function isIncomeEligible(task) {
  if (!task) return false;
  if (normalizeStatus(task.status) !== TASK_STATUS.COMPLETED) return false;
  if (!task.completedAt) return false;
  if (!task.result || String(task.result).trim().length === 0) return false;
  return true;
}

/**
 * Safe task-level progression. Returns true when the transition is allowed.
 * Guards against a client/worker bouncing a task out of a terminal state or
 * racing a task back to COMPLETED a second time.
 */
export function canTransition(fromStatus, toStatus) {
  const from = normalizeStatus(fromStatus);
  const to = normalizeStatus(toStatus);
  if (from === to) return false;
  if (isTerminalStatus(from)) {
    // Only re-queueing an explicitly retried terminal task is allowed.
    if (to === TASK_STATUS.QUEUED) {
      return [TASK_STATUS.FAILED, TASK_STATUS.TIMED_OUT, TASK_STATUS.CANCELLED].includes(from);
    }
    return false;
  }
  const allowed = {
    [TASK_STATUS.QUEUED]: [TASK_STATUS.RUNNING, TASK_STATUS.CANCELLED],
    [TASK_STATUS.RUNNING]: [TASK_STATUS.RETRYING, TASK_STATUS.COMPLETED, TASK_STATUS.FAILED, TASK_STATUS.TIMED_OUT, TASK_STATUS.CANCELLED],
    [TASK_STATUS.RETRYING]: [TASK_STATUS.RUNNING, TASK_STATUS.CANCELLED],
  };
  return (allowed[from] || []).includes(to);
}

export const TASK_GLOBAL_TIMEOUT_DEFAULT_MS = 150_000;

export function getGlobalTaskTimeoutMs() {
  const raw = Number(process.env.TASK_GLOBAL_TIMEOUT_MS);
  return Number.isFinite(raw) && raw > 0 ? raw : TASK_GLOBAL_TIMEOUT_DEFAULT_MS;
}

export function getTaskRetryPolicy() {
  const raw = Number(process.env.TASK_MAX_RETRIES);
  const maxRetries = Number.isFinite(raw) && raw >= 0 ? raw : 2;
  const rawDelay = Number(process.env.TASK_RETRY_BASE_DELAY_MS);
  const baseDelayMs = Number.isFinite(rawDelay) && rawDelay > 0 ? rawDelay : 3000;
  return { maxRetries, baseDelayMs };
}