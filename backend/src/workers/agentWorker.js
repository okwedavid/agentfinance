/**
 * agentWorker.js
 * BullMQ worker that processes tasks using the multi-provider agentRunner.
 *
 * Add to backend/src/index.js:
 *   import './workers/agentWorker.js';
 */
import { Worker } from 'bullmq';
import IORedis from 'ioredis';
import prisma from '../prismaClient.js';
import runAgent from '../agents/agentRunner.js';

const REDIS_URL = process.env.REDIS_URL;

if (!REDIS_URL || REDIS_URL.includes('{{')) {
  console.warn('[Worker] REDIS_URL not configured — agent worker disabled. Fix: Redis.REDIS_URL in Railway variables');
} else {
  const connection = new IORedis(REDIS_URL, { maxRetriesPerRequest: null });

  const worker = new Worker('agent-tasks', async (job) => {
    const { taskId, action, agentId, userId } = job.data;
    console.log(`[Worker] Processing task ${taskId}: ${action?.slice(0, 60)}`);

    // Mark as running
    await prisma.task.update({
      where: { id: taskId },
      data: { status: 'running', startedAt: new Date() },
    }).catch(e => console.error('[Worker] DB update running:', e.message));

    // Publish WS event
    const publish = (type, extra = {}) =>
      connection.publish('agentfi:tasks', JSON.stringify({ type, taskId, action, ...extra }));
    await publish('task:running');

    // Classify agent type from action text
    function classifyAgent(text) {
      const t = text.toLowerCase();
      if (t.includes('trade') || t.includes('arbitrage') || t.includes('swap') || t.includes('buy') || t.includes('sell')) return 'trading';
      if (t.includes('write') || t.includes('newsletter') || t.includes('article') || t.includes('thread') || t.includes('content')) return 'content';
      if (t.includes('send') || t.includes('transfer') || t.includes('route') || t.includes('sweep') || t.includes('wallet')) return 'execution';
      if (t.includes('research') || t.includes('find') || t.includes('analyse') || t.includes('best') || t.includes('top') || t.includes('yield')) return 'research';
      return 'coordinator';
    }

    const agentType = classifyAgent(action || '');

    // Get user wallet from DB (for execution agent)
    let walletAddress = null;
    try {
      const task = await prisma.task.findUnique({ where: { id: taskId } });
      const ownerId = task?.userId || userId;
      if (ownerId) {
        const user = await prisma.user.findUnique({ where: { id: ownerId } });
        walletAddress = user?.walletAddress || null;
      }
    } catch {}

    try {
      const result = await runAgent({ action, agentType, walletAddress });

      // Save result
      await prisma.task.update({
        where: { id: taskId },
        data: {
          status: 'completed',
          completedAt: new Date(),
          result: JSON.stringify({
            output: result.output,
            summary: result.output?.slice(0, 300),
            provider: result.provider,
            agentType: result.agentType,
          }),
        },
      });

      await publish('task:completed', { provider: result.provider });
      console.log(`[Worker] ✅ Task ${taskId} completed via ${result.provider}`);

    } catch (err) {
      console.error(`[Worker] ❌ Task ${taskId} failed:`, err.message);
      await prisma.task.update({
        where: { id: taskId },
        data: {
          status: 'failed',
          completedAt: new Date(),
          result: JSON.stringify({ error: err.message }),
        },
      }).catch(() => {});

      await publish('task:failed', { error: err.message });
      throw err; // BullMQ will retry based on job config
    }
  }, {
    connection,
    concurrency: 3,
    limiter: { max: 10, duration: 60_000 }, // 10 tasks/minute max
  });

  worker.on('completed', job => console.log(`[Worker] Job ${job.id} completed`));
  worker.on('failed', (job, err) => console.error(`[Worker] Job ${job?.id} failed:`, err.message));

  console.log('[Worker] 🤖 Agent worker started, listening for tasks…');
}
