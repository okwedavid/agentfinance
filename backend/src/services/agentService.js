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
import runAgent, { DEFAULT_TASK_TIMEOUT_MS } from '../agents/agentRunner.js';
import { classifyTask } from '../agents/taskClassifier.js';
import { summariseTaskResult } from '../services/payoutService.js';
import { ProviderError, safeMessageFor } from '../services/llmProvider.js';

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
  const existing = await prisma.task.findUnique({ where: { id: taskId } }).catch(() => null);
  if (!existing) {
    logger.warn(`[Agent] Task ${taskId} not found; skipping.`);
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

  const taskTimeoutMs = timeoutMs || envInt('AGENT_TASK_TIMEOUT_MS', DEFAULT_TASK_TIMEOUT_MS);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), taskTimeoutMs);

  const running = await prisma.task.update({
    where: { id: taskId },
    data: { status: 'running', startedAt: new Date() },
  }).catch((error) => {
    logger.error(`[Agent] Failed to mark task ${taskId} running: ${error.message}`);
    return { ...existing, status: 'running' };
  });

  await publish('task:running', {
    id: running.id,
    status: 'running',
    action: running.action || action,
    userId: running.userId || existing.userId || userId,
  });

  const activeWallet = walletAddress || (await resolveActiveWallet(userId || existing.userId));
  const agentType = classifyTask(action || '').type;

  try {
    const result = await runAgent({ action, agentType, walletAddress: activeWallet, signal: controller.signal, timeoutMs: taskTimeoutMs });

    const resultPayload = {
      output: result.output,
      summary: summariseTaskResult(result.output).slice(0, 1200) || '',
      provider: result.provider,
      model: result.model || null,
      agentType: result.agentType,
    };

    const updated = await prisma.task.update({
      where: { id: taskId },
      data: {
        status: 'completed',
        completedAt: new Date(),
        duration: Date.now() - running.startedAt?.getTime?.() || undefined,
        result: JSON.stringify(resultPayload),
      },
    });

    await publish('task:completed', {
      id: updated.id,
      status: 'completed',
      action: updated.action,
      result: resultPayload,
      summary: resultPayload.summary,
      provider: result.provider,
      userId: userId || existing.userId || updated.userId,
    });
    logger.info(`[Agent] Task ${taskId} completed via ${result.provider}.`);
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

    await publish('task:failed', {
      id: updated.id || taskId,
      status: 'failed',
      action: action,
      error: safeMessage,
      failureType,
      userId: userId || existing.userId,
    });

    return { status: 'failed' };
  } finally {
    clearTimeout(timer);
  }
}

export { parseResult };
