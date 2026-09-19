/**
 * agentWorker.js — BullMQ worker for the resilient task lifecycle.
 *
 * Delegates all execution to agentService.executeTask so the inline and
 * queued paths behave identically (same retries, timeout, terminal states).
 * A task that is already terminal is never re-executed, preventing duplicate
 * completion events and duplicate earnings.
 */
import { Worker } from 'bullmq';
import IORedis from 'ioredis';
import { executeTask, TASK_STATUS } from '../services/agentService.js';
import { isTerminalStatus } from '../services/taskLifecycle.js';
import { classifyAgent } from '../agents/taskClassifier.js';
import prisma from '../prismaClient.js';
import logger from '../utils/logger.js';

const REDIS_URL = process.env.REDIS_URL;

if (!REDIS_URL || REDIS_URL.includes('{{')) {
  logger.warn('[Worker] REDIS_URL not configured - agent worker disabled. Set REDIS_URL in the backend environment');
} else {
  const connection = new IORedis(REDIS_URL, { maxRetriesPerRequest: null });

  const worker = new Worker('agent-tasks', async (job) => {
    const { taskId, action, userId } = job.data;
    logger.info(`work-start id=${taskId} job=${job.id}`);

    const existing = await prisma.task.findUnique({ where: { id: taskId } }).catch(() => null);
    if (!existing) {
      logger.warn(`work-skip id=${taskId} reason=not-found`);
      return;
    }
    if (isTerminalStatus(existing.status)) {
      logger.warn(`work-skip id=${taskId} reason=terminal status=${existing.status}`);
      return;
    }

    const agentType = classifyAgent(action || '');
    const { outcome, incomeEligible } = await executeTask({ taskId, action, userId, agentType, redis: connection });

    if (outcome === 'completed') {
      logger.info(`work-done id=${taskId} outcome=completed incomeEligible=${incomeEligible}`);
      return;
    }
    // Failed / timed_out / already-terminal are handled inside executeTask.
    logger.warn(`work-done id=${taskId} outcome=${outcome}`);
  }, {
    connection,
    concurrency: 3,
    limiter: { max: 10, duration: 60_000 },
  });

  worker.on('completed', (job) => logger.info(`job-completed id=${job.id}`));
  worker.on('failed', (job, err) => logger.warn(`job-failed id=${job?.id} error=${err?.message}`));

  logger.info('[Worker] Agent worker started.');
}

export { TASK_STATUS };
export default null;