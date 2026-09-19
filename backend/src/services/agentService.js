/**
 * agentService.js — task execution orchestration with a resilient lifecycle.
 *
 * Shared by the BullMQ worker and the inline (no-Redis) runner so a task can
 * never be double-executed or left RUNNING forever.
 *
 * Lifecycle (lower-cased in DB, canonical in taskLifecycle):
 *   queued -> running -> (retrying) -> completed | failed | timed_out | cancelled
 *
 * Safety guarantees:
 *   - Only transient failures (rate limit / provider unavailable / timeout)
 *     are retried; auth/config/invalid-request errors are never retried.
 *   - Retries are bounded with exponential backoff.
 *   - A global task timeout terminates the task as timed_out.
 *   - A task already in a terminal state is never re-executed.
 *   - Earnings eligibility is decided here AFTER the completion payload is
 *     persisted (see earningsService).
 */
import prisma from '../prismaClient.js';
import runAgent, { delay, retryWithBackoff, isTransientError } from '../agents/agentRunner.js';
import { summariseTaskResult } from './payoutService.js';
import {
  TASK_STATUS,
  isTerminalStatus,
  isIncomeEligible,
  canTransition,
  getGlobalTaskTimeoutMs,
  getTaskRetryPolicy,
} from './taskLifecycle.js';
import { toNormalizedError } from '../providers/normalizedError.js';
import logger from '../utils/logger.js';

const publish = async (connection, channel, payload) => {
  if (!connection?.publish) return;
  try {
    await connection.publish(channel, JSON.stringify(payload));
  } catch (error) {
    logger.warn(`agentService publish failed: ${error.message}`);
  }
};

async function updateTask(taskId, data) {
  return prisma.task.update({ where: { id: taskId }, data });
}

async function loadUserWallet(userId) {
  if (!userId) return null;
  try {
    const user = await prisma.user.findUnique({ where: { id: userId } });
    const profiles = user?.walletProfiles && typeof user.walletProfiles === 'object' ? user.walletProfiles : {};
    return profiles?.[user?.preferredNetwork || 'ethereum'] || user?.walletAddress || null;
  } catch {
    return null;
  }
}

function safeErrorPayload(error) {
  const normalized = error?.category ? error : toNormalizedError(error, error?.provider || '');
  return {
    category: normalized.category,
    message: normalized.message,
    retryable: normalized.retryable,
    provider: normalized.provider || null,
    technical: undefined,
  };
}

function resultJson({ output, provider, agentType, model, status, partial }) {
  return JSON.stringify({
    output,
    summary: summariseTaskResult(output).slice(0, 1200) || '',
    provider,
    agentType,
    model: model || null,
    status: status || 'completed',
    partial: partial || false,
  });
}

/**
 * Execute a task with full lifecycle management.
 */
export async function executeTask({ taskId, action, userId, agentType, redis }) {
  const trace = { taskId, action: String(action || '').slice(0, 60) };
  logger.info(`task-created id=${taskId}`);

  const existing = await prisma.task.findUnique({ where: { id: taskId } }).catch(() => null);
  if (!existing) {
    logger.warn(`task-execution aborted id=${taskId} reason=not-found`);
    return { outcome: 'not_found', incomeEligible: false };
  }
  if (isTerminalStatus(existing.status)) {
    logger.warn(`task-execution skipped id=${taskId} status=${existing.status} reason=already-terminal`);
    return { outcome: `already_${existing.status}`, incomeEligible: isIncomeEligible(existing) };
  }

  const walletAddress = await loadUserWallet(userId);

  await updateTask(taskId, { status: TASK_STATUS.RUNNING, startedAt: new Date() });
  await publish(redis, 'agentfi:tasks', {
    type: 'task:running',
    data: { id: taskId, status: TASK_STATUS.RUNNING, agentType },
    correlationId: taskId,
  });
  logger.info(`task-running id=${taskId} agentType=${agentType}`);

  const startedAt = Date.now();
  const policy = getTaskRetryPolicy();
  const attempt = async () => {
    const result = await runAgent({ action, agentType, walletAddress });
    return result;
  };

  // Outer timeout for the whole execution lifecycle.
  const globalTimeout = getGlobalTaskTimeoutMs();
  let timedOut = false;
  const timedAttempt = () => Promise.race([
    attempt(),
    delay(globalTimeout).then(() => {
      timedOut = true;
      throw new Error('global task timeout');
    }),
  ]);

  try {
    const result = await retryWithBackoff(timedAttempt, {
      maxAttempts: 1 + policy.maxRetries,
      baseDelayMs: policy.baseDelayMs,
      shouldRetry: (error) => {
        if (timedOut) return false;
        return isTransientError(error);
      },
    });

    // Persist the completion payload BEFORE declaring the task completed so
    // earnings eligibility always has a persisted result to point at.
    const completedAt = new Date();
    const updated = await updateTask(taskId, {
      status: TASK_STATUS.COMPLETED,
      completedAt,
      duration: Math.round((completedAt.getTime() - startedAt) / 1000),
      result: resultJson({
        output: result.output,
        provider: result.provider,
        agentType: result.agentType || agentType,
        model: result.model,
        status: result.status || 'completed',
        partial: result.status === 'partial',
      }),
    });

    const incomeEligible = isIncomeEligible(updated);
    await publish(redis, 'agentfi:tasks', {
      type: 'task:completed',
      data: { id: taskId, status: TASK_STATUS.COMPLETED, provider: result.provider, model: result.model || null, partial: result.status === 'partial', incomeEligible },
      correlationId: taskId,
    });
    logger.info(`task-completed id=${taskId} provider=${result.provider} incomeEligible=${incomeEligible} durationMs=${Date.now() - startedAt}`);

    return { outcome: 'completed', incomeEligible, partial: result.status === 'partial' };
  } catch (error) {
    if (timedOut) {
      await updateTask(taskId, {
        status: TASK_STATUS.TIMED_OUT,
        completedAt: new Date(),
        duration: Math.round((Date.now() - startedAt) / 1000),
        result: JSON.stringify({ error: 'Task timed out.', category: 'timeout' }),
      }).catch(() => {});
      await publish(redis, 'agentfi:tasks', {
        type: 'task:failed',
        data: { id: taskId, status: TASK_STATUS.TIMED_OUT, category: 'timeout' },
        correlationId: taskId,
      });
      logger.warn(`task-timed-out id=${taskId} durationMs=${Date.now() - startedAt}`);
      return { outcome: 'timed_out', incomeEligible: false };
    }

    const payload = safeErrorPayload(error);
    await updateTask(taskId, {
      status: TASK_STATUS.FAILED,
      completedAt: new Date(),
      duration: Math.round((Date.now() - startedAt) / 1000),
      result: JSON.stringify({ error: payload.message, category: payload.category }),
    }).catch(() => {});
    await publish(redis, 'agentfi:tasks', {
      type: 'task:failed',
      data: { id: taskId, status: TASK_STATUS.FAILED, ...payload },
      correlationId: taskId,
    });
    logger.warn(`task-failed id=${taskId} error-category=${payload.category}`);
    return { outcome: 'failed', incomeEligible: false, category: payload.category };
  }
}

export { TASK_STATUS, canTransition, isIncomeEligible };