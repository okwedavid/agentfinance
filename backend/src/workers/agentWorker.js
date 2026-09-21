/**
 * agentWorker.js
 * BullMQ worker that processes tasks through the reliable agent pipeline.
 *
 * The worker delegates the whole task lifecycle (running/completed/failed,
 * timeout, safe errors, real-time events) to agentService.executeAgentTask so
 * the BullMQ path and the inline path behave identically.
 *
 * Add/keep in backend/src/index.js:
 *   import './workers/agentWorker.js';
 */
import { Worker } from 'bullmq';
import IORedis from 'ioredis';
import { executeAgentTask } from '../services/agentService.js';

const REDIS_URL = process.env.REDIS_URL;

if (!REDIS_URL || REDIS_URL.includes('{{')) {
  console.warn('[Worker] REDIS_URL not configured — agent worker disabled. Tasks run inline.');
} else {
  const connection = new IORedis(REDIS_URL, { maxRetriesPerRequest: null });

  const publish = (type, data) =>
    connection.publish('agentfi:tasks', JSON.stringify({ type, data }));

  const worker = new Worker('agent-tasks', async (job) => {
    const { taskId, action, userId } = job.data;
    logger.info(`work-start id=${taskId} job=${job.id}`);

    // executeAgentTask drives the task to a terminal state and emits the
    // real-time events. It is intentionally NOT rethrown here: provider-level
    // retries plus the fallback provider already run inside runAgent while the
    // task had a pending lifecycle, and rethrowing would trigger a second,
    // duplicated execution of the same task (a retry storm).
    const outcome = await executeAgentTask({
      taskId,
      action,
      userId,
      agentId,
      walletAddress: null,
      publish,
    });

    console.log(`[Worker] Task ${taskId} → ${outcome.status}`);
  }, {
    connection,
    concurrency: 3,
    limiter: { max: 10, duration: 60_000 },
  });

  worker.on('completed', job => console.log(`[Worker] Job ${job.id} processed`));
  worker.on('failed', (job, err) => console.error(`[Worker] Job ${job?.id} failed:`, err.message));

  console.log('[Worker] 🤖 Agent worker started, listening for tasks…');
}
