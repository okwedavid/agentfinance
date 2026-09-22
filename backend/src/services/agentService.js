/**
 * agentService.js — single, reliable task execution lifecycle.
 *
 * Used by both the BullMQ worker and the inline (no-Redis) path so the task
 * state machine is identical everywhere:
 *
 *   pending -> running -> completed | failed
 *
 * Guarantees:
 * - A task can never remain running forever (global timeout aborts the request).
 * - Provider errors are normalized into safe user messages.
 * - real-time events are emitted with a stable, frontend-friendly shape.
 */
import prisma from '../prismaClient.js';
import logger from '../utils/logger.js';
import { DEFAULT_TASK_TIMEOUT_MS } from '../agents/agentRunner.js';
import { executeWithAgent, routeTask } from '../agents/agentRegistry.js';
import { summariseTaskResult } from '../services/payoutService.js';
import { ProviderError, safeMessageFor } from '../services/llmProvider.js';
import { createRewardForTask } from '../services/rewardService.js';

const GENERIC_ERROR_MESSAGE = 'Agent could not complete this task. Please try again.';

function envInt(name, fallback) {
  const parsed = Number.parseInt(process.env[name], 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function parseResult(value) {
  if (!value) return null;
  if (typeof value !== 'string') return value;
  try {
    return JSON.parse(value);
  } catch {
    return value;
  }
}

export async function resolveActiveWallet(userId) {
  if (!userId) return null;
  const user = await prisma.user.findUnique({ where: { id: userId } }).catch(() => null);
  if (!user) return null;
  const profiles = user.walletProfiles && typeof user.walletProfiles === 'object' ? user.walletProfiles : {};
  return profiles?.[user.preferredNetwork || 'ethereum'] || user?.walletAddress || null;
}

/**
 * Execute a single agent task to a terminal state.
 *
 * @param {object} opts
 * @param {string} opts.taskId
 * @param {string} opts.action the user's prompt
 * @param {string|null} [opts.userId] task owner
 * @param {string|null} [opts.agentId]
 * @param {string|null} [opts.walletAddress] resolved wallet override
 * @param {Function} [opts.publish] (type, payload) => void  - emits real-time events
 * @param {number|null} [opts.timeoutMs] overall task budget
 */
export async function executeAgentTask({ taskId, action, userId = null, agentId = null, walletAddress = null, publish = async () => {}, timeoutMs = null }) {
  // Real-time events are strictly best-effort: the database is the source of
  // truth, so a Redis/WebSocket failure must never strand a task in a
  // non-terminal state nor flip a persisted COMPLETED back to FAILED.
  const emit = async (type, payload) => {
    try {
      await publish(type, payload);
    } catch (error) {
      logger.warn(`[TASK ${taskId}] event publish failed (${type}): ${error.message}`);
    }
  };

  const existing = await prisma.task.findUnique({ where: { id: taskId } }).catch(() => null);
  if (!existing) {
    logger.warn(`[Task] Task ${taskId} not found; skipping.`);
    return { status: 'missing' };
  }
  if (existing.status === 'completed' || existing.status === 'failed') {
    return { status: existing.status };
  }
  // A client may cancel a task while it is waiting/running (restricted PATCH).
  // Respect that terminal state so a stale worker job cannot resurrect it.
  if (existing.status === 'cancelled') {
    return { status: 'cancelled' };
  }

  const startedAtMs = Date.now();
  const taskTimeoutMs = timeoutMs || envInt('AGENT_TASK_TIMEOUT_MS', DEFAULT_TASK_TIMEOUT_MS);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), taskTimeoutMs);

  const running = await prisma.task.update({
    where: { id: taskId },
    data: { status: 'running', startedAt: new Date() },
  }).catch((error) => {
    logger.error(`[TASK ${taskId}] failed to mark running: ${error.message}`);
    return { ...existing, status: 'running', action: existing.action || action, userId: existing.userId || userId };
  });

  const activeWallet = walletAddress || (await resolveActiveWallet(userId || existing.userId));
  const routing = routeTask(action || existing.action || '');
  const agentType = routing.agent;
  const executorId = routing.executor;
  logger.info(`[TASK ${taskId}] route agent=${agentType}`);
  logger.info(`[TASK ${taskId}] executor=${executorId}`);
  logger.info(`[TASK ${taskId}] queued -> running executor=${executorId}`);

  await emit('task:running', {
    id: running.id || taskId,
    status: 'running',
    action: running.action || action,
    userId: running.userId || existing.userId || userId,
  });

  try {
    const result = await executeWithAgent({
      action,
      agentType,
      walletAddress: activeWallet,
      signal: controller.signal,
      timeoutMs: taskTimeoutMs,
      taskId,
    });
    const providerDurationMs = Date.now() - startedAtMs;
    logger.info(`[TASK ${taskId}] provider_response_received provider=${result.provider} model=${result.model || 'unknown'} duration=${providerDurationMs}ms`);

    const resultPayload = {
      output: result.output,
      summary: summariseTaskResult(result.output).slice(0, 1200) || '',
      provider: result.provider,
      model: result.model || null,
      agent: result.agent || agentType,
      executor: result.executor || executorId,
      agentType: result.agent || agentType,
    };

    const updated = await prisma.task.update({
      where: { id: taskId },
      data: {
        status: 'completed',
        completedAt: new Date(),
        duration: Date.now() - (running.startedAt?.getTime?.() || startedAtMs),
        result: JSON.stringify(resultPayload),
      },
    });

    await emit('task:completed', {
      id: updated.id,
      status: 'completed',
      action: updated.action,
      result: resultPayload,
      summary: resultPayload.summary,
      provider: result.provider,
      userId: userId || existing.userId || updated.userId,
    });
    logger.info(`[TASK ${taskId}] result_persisted status=completed duration=${Date.now() - startedAtMs}ms provider=${result.provider}`);

    // Reward economy: book the deterministic task reward. Best-effort and
    // idempotent by taskId — a booking failure must never fail the task, and
    // the same task can never earn twice.
    if (updated.agentId) {
      createRewardForTask(updated)
        .then((event) => {
          if (event) logger.info(`[TASK ${taskId}] reward_booked amount=${event.rewardAmountBnb} BNB version=${event.calculationVersion}`);
        })
        .catch((error) => logger.warn(`[TASK ${taskId}] reward booking skipped: ${error.message}`));
    }

    return { status: 'completed' };
  } catch (error) {
    let safeMessage = GENERIC_ERROR_MESSAGE;
    let failureType = 'unknown';

    if (error instanceof ProviderError) {
      safeMessage = safeMessageFor(error.category, error.provider);
      failureType = error.category;
      const diagnostics = Array.isArray(error.diagnostics) && error.diagnostics.length
        ? error.diagnostics.map((d) => `${d.provider}:${d.category}`).join(', ')
        : error.category;
      logger.error(`[Agent] Task ${taskId} failed (${failureType}). ${diagnostics}`);
    } else {
      logger.error(`[Agent] Task ${taskId} failed unexpectedly: ${error.message}`);
    }

    const updated = await prisma.task.update({
      where: { id: taskId },
      data: {
        status: 'failed',
        completedAt: new Date(),
        result: JSON.stringify({ error: safeMessage, failureType }),
      },
    }).catch(() => running);

    await emit('task:failed', {
      id: updated.id || taskId,
      status: 'failed',
      action: action,
      error: safeMessage,
      failureType,
      userId: userId || existing.userId,
    });
    logger.error(`[TASK ${taskId}] failed stage=agent_execution duration=${Date.now() - startedAtMs}ms type=${failureType}`);

    return { status: 'failed' };
  } finally {
    clearTimeout(timer);
  }
}

export { parseResult };
