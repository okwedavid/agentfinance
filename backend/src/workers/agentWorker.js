/**
 * agentWorker.js
 * BullMQ worker that processes tasks through the reliable agent pipeline.
 *
 * The worker delegates the whole task lifecycle (running/completed/failed,
 * timeout, safe errors, real-time events) to agentService.executeAgentTask so
 * the BullMQ path and the inline path behave identically.
 *
 * The queue is the dispatch mechanism ONLY — execution is event/result driven
 * inside executeAgentTask. There is deliberately no artificial delay anywhere
 * in this pipeline: a job is claimed and the provider is called immediately.
 *
 * Includes a bounded stale-task recovery sweep so a task can never remain in
 * queued/pending/running forever (e.g. a job whose producer died mid-frame).
 */
import { Worker, Queue } from 'bullmq';
import IORedis from 'ioredis';
import prisma from '../prismaClient.js';
import logger from '../utils/logger.js';
import { executeAgentTask } from '../services/agentService.js';

const REDIS_URL = process.env.REDIS_URL;

// Age thresholds for stale-task recovery. These are deliberately larger than
// any legitimate provider timeout so live jobs are never touched:
//   - AGENT_TASK_TIMEOUT_MS default = 120s (provider run budget)
//   - queued grace: a task whose job did not start in 3 minutes is orphaned
//   - running grace: a task stuck 'running' beyond 5 minutes is a dead process
const QUEUED_GRACE_MS = 3 * 60_000;
const RUNNING_GRACE_MS = 5 * 60_000;
const RECOVERY_INTERVAL_MS = 5 * 60_000;

if (!REDIS_URL || REDIS_URL.includes('{{')) {
  console.warn('[Worker] REDIS_URL not configured — agent worker disabled. Tasks run inline.');
} else {
  const connection = new IORedis(REDIS_URL, { maxRetriesPerRequest: null });
  const taskQueue = new Queue('agent-tasks', { connection });

  const publish = (type, data) =>
    connection.publish('agentfi:tasks', JSON.stringify({ type, data }));

  // Terminate a task safely when the worker itself fails outside of
  // executeAgentTask. The database is the source of truth; events are best-effort.
  async function markTaskFailed(taskId, safeMessage) {
    try {
      await prisma.task.update({
        where: { id: taskId },
        data: {
          status: 'failed',
          completedAt: new Date(),
          result: JSON.stringify({ error: safeMessage, failureType: 'worker_error' }),
        },
      });
      logger.error(`[TASK ${taskId}] marked failed by worker (stage=worker_fallback)`);
    } catch (error) {
      logger.error(`[TASK ${taskId}] failed to persist worker-fallback failure: ${error.message}`);
      return;
    }
    await publish('task:failed', {
      id: taskId,
      status: 'failed',
      action: null,
      error: safeMessage,
      failureType: 'worker_error',
    }).catch(() => {});
  }

  const worker = new Worker('agent-tasks', async (job) => {
    const { taskId, action, userId, agentId } = job.data || {};
    logger.info(`[TASK ${taskId}] work-claimed job=${job.id}`);

    // executeAgentTask drives the task to a terminal state and emits the
    // real-time events. It is intentionally NOT rethrown here: provider-level
    // retries plus the fallback provider already run inside runAgent while the
    // task had a pending lifecycle, and rethrowing would trigger a second,
    // duplicated execution of the same task (a retry storm).
    try {
      const outcome = await executeAgentTask({
        taskId,
        action,
        userId,
        agentId,
        walletAddress: null,
        publish,
      });
      console.log(`[Worker] Task ${taskId} → ${outcome.status}`);
    } catch (error) {
      // Never let a task sit in a non-terminal state because this handler threw.
      logger.error(`[TASK ${taskId}] worker execution error: ${error.message}`);
      await markTaskFailed(taskId, 'The agent worker could not execute this task. Please try again.');
    }
  }, {
    connection,
    concurrency: 3,
    limiter: { max: 10, duration: 60_000 },
  });

  worker.on('completed', (job) => console.log(`[Worker] Job ${job.id} processed`));
  worker.on('failed', (job, err) => console.error(`[Worker] Job ${job?.id} failed:`, err.message));

  console.log('[Worker] Agent worker started, listening for tasks…');

  // ── Stale-task recovery ─────────────────────────────────────────────────────
  // Re-dispatches tasks that a crashed process left behind. A queued task whose
  // BullMQ job is absent/failed is re-queued (exactly once); a running task with
  // no live job is marked FAILED. Never re-queues tasks that the queue is still
  // tracking, so live work is never duplicated.
  async function recoverStaleTasks() {
    const queuedCutoff = new Date(Date.now() - QUEUED_GRACE_MS);
    const runningCutoff = new Date(Date.now() - RUNNING_GRACE_MS);

    let stale = [];
    try {
      stale = await prisma.task.findMany({
        where: {
          OR: [
            { archived: false, status: { in: ['queued', 'pending'] }, createdAt: { lt: queuedCutoff } },
            { status: 'running', startedAt: { lt: runningCutoff } },
          ],
        },
        select: { id: true, action: true, userId: true, agentId: true, status: true, archived: true },
      });
    } catch (error) {
      logger.error(`[Recovery] stale-task query failed: ${error.message}`);
      return;
    }
    if (stale.length === 0) return;

    for (const task of stale) {
      let state = null;
      try {
        const job = await taskQueue.getJob(task.id);
        state = job ? await job.getState() : null;
      } catch (error) {
        logger.warn(`[TASK ${task.id}] recovery skipped (redis unavailable): ${error.message}`);
        continue;
      }
      // A live job is still responsible for this task.
      if (state === 'waiting' || state === 'delayed' || state === 'active' || state === 'paused') continue;

      if (task.status === 'running') {
        try {
          await prisma.task.update({
            where: { id: task.id },
            data: { status: 'failed', completedAt: new Date(), result: JSON.stringify({ error: 'The worker processing this task stopped unexpectedly. Please retry.', failureType: 'stale_recovery' }) },
          });
          await publish('task:failed', {
            id: task.id,
            status: 'failed',
            action: task.action,
            error: 'The worker processing this task stopped unexpectedly. Please retry.',
            failureType: 'stale_recovery',
          }).catch(() => {});
          logger.warn(`[TASK ${task.id}] recovered stale running -> failed (job state ${state || 'none'})`);
        } catch (error) {
          logger.error(`[TASK ${task.id}] recovery-fail update error: ${error.message}`);
        }
      } else {
        try {
          await taskQueue.remove(task.id).catch(() => {});
          await taskQueue.add(
            'processTask',
            { taskId: task.id, action: task.action, userId: task.userId, agentId: task.agentId || null },
            {
              jobId: task.id,
              attempts: 1,
              removeOnComplete: { count: 100 },
              removeOnFail: { count: 50 },
            },
          );
          logger.info(`[TASK ${task.id}] recovered stale queued -> requeued (job state ${state || 'none'})`);
        } catch (error) {
          logger.error(`[TASK ${task.id}] recovery-requeue error: ${error.message}`);
        }
      }
    }
  }

  // Run shortly after boot, then keep sweeping on an interval so a transient
  // Redis/DB failure can never permanently strand a task.
  setTimeout(() => recoverStaleTasks().catch((err) => logger.error(`[Recovery] sweep failed: ${err.message}`)), 5000);
  const recoveryInterval = setInterval(() => recoverStaleTasks().catch((err) => logger.error(`[Recovery] sweep failed: ${err.message}`)), RECOVERY_INTERVAL_MS);
  recoveryInterval.unref?.();
}