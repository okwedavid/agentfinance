/**
 * BullMQ Agent Worker
 *
 * Listens to the 'agent-tasks' queue and processes each task by:
 *   1. Loading the task from Postgres
 *   2. Classifying the prompt → agent type
 *   3. Running the agentic loop via agentRunner
 *   4. Streaming live events to frontend via Redis pub/sub → WebSocket
 *   5. Writing the final result back to Postgres
 *   6. If earnings detected → recording in analytics ledger
 *
 * Start this worker alongside the Express server.
 * In Railway: add this to the start command or run as a separate service.
 */

import { Worker, QueueEvents } from 'bullmq';
import IORedis from 'ioredis';
import { PrismaClient } from '@prisma/client';
import { classifyTask } from '../agents/taskClassifier.js';
import { runAgent } from '../agents/agentRunner.js';
import logger from '../utils/logger.js';

const prisma = new PrismaClient();

const REDIS_URL = process.env.REDIS_URL || 'redis://localhost:6379';
const QUEUE_NAME = 'agent-tasks';

// Separate Redis connection for the worker (BullMQ requires maxRetriesPerRequest: null)
const workerRedis = new IORedis(REDIS_URL, {
  maxRetriesPerRequest: null,
  enableReadyCheck: false,
});

// Publisher for live frontend events (separate connection — don't block the worker)
const pubRedis = new IORedis(REDIS_URL, {
  maxRetriesPerRequest: null,
  enableReadyCheck: false,
});

// ─── Event publisher ──────────────────────────────────────────────────────────

async function publishEvent(channel, payload) {
  try {
    await pubRedis.publish(channel, JSON.stringify(payload));
  } catch (err) {
    logger.error(`Failed to publish event to ${channel}: ${err.message}`);
  }
}

// ─── Worker ───────────────────────────────────────────────────────────────────

const worker = new Worker(
  QUEUE_NAME,
  async (job) => {
    const { taskId, action, agentId, userId } = job.data;
    logger.info(`Worker picked up job ${job.id} — taskId: ${taskId}, action: ${action}`);

    // 1. Load task from DB
    let task;
    try {
      task = await prisma.task.findUnique({
        where: { id: taskId },
        include: { Agent: true },
      });
    } catch (err) {
      logger.error(`DB error loading task ${taskId}: ${err.message}`);
      throw err;
    }

    if (!task) {
      logger.warn(`Task ${taskId} not found in DB — skipping`);
      return { skipped: true };
    }

    // 2. Mark task as running
    await prisma.task.update({
      where: { id: taskId },
      data: { status: 'running', startedAt: new Date() },
    });

    await publishEvent('agentfi:tasks', {
      type: 'task:updated',
      data: { id: taskId, status: 'running', startedAt: new Date() },
    });

    // 3. Classify the prompt → get agent type + system prompt
    const prompt = task.action || action || 'Analyse the best crypto opportunity right now';
    const agentConfig = classifyTask(prompt);

    logger.info(`Task ${taskId} classified as: ${agentConfig.type} (${agentConfig.label})`);

    await publishEvent('agentfi:tasks', {
      type: 'task:classified',
      data: {
        id: taskId,
        agentType: agentConfig.type,
        agentLabel: agentConfig.label,
      },
    });

    // 4. Get user's wallet address if available
    let walletAddress = null;
    if (userId) {
      try {
        const user = await prisma.user.findUnique({ where: { id: userId } });
        walletAddress = user?.walletAddress || null;
      } catch (e) {
        logger.warn(`Could not load wallet for user ${userId}`);
      }
    }

    // 5. Build the onEvent callback — streams every step to frontend
    const onEvent = (event) => {
      publishEvent('agentfi:tasks', {
        type: event.type,
        data: {
          taskId,
          ...event,
        },
      });
      // Also log token usage events for analytics
      if (event.type === 'agent:tool_call') {
        logger.info(`[TOOL] ${event.tool} called for task ${taskId}`);
      }
    };

    // 6. Run the agent
    let agentResult;
    try {
      agentResult = await runAgent({
        taskId,
        agentType: agentConfig.type,
        systemPrompt: agentConfig.systemPrompt,
        userPrompt: prompt,
        walletAddress,
        onEvent,
      });
    } catch (err) {
      logger.error(`Agent failed for task ${taskId}: ${err.message}`);

      await prisma.task.update({
        where: { id: taskId },
        data: {
          status: 'failed',
          result: JSON.stringify({ error: err.message }),
          completedAt: new Date(),
        },
      });

      await publishEvent('agentfi:tasks', {
        type: 'task:updated',
        data: { id: taskId, status: 'failed', error: err.message },
      });

      throw err; // Let BullMQ handle retry
    }

    // 7. Write result to DB
    const completedTask = await prisma.task.update({
      where: { id: taskId },
      data: {
        status: 'completed',
        result: JSON.stringify({
          output: agentResult.result,
          toolsUsed: agentResult.toolsUsed,
          iterations: agentResult.iterations,
          agentType: agentConfig.type,
          completedAt: new Date().toISOString(),
        }),
        completedAt: new Date(),
        duration: task.startedAt
          ? Math.round((Date.now() - new Date(task.startedAt).getTime()))
          : null,
      },
    });

    // 8. Log to analytics
    try {
      await prisma.taskAnalytics.create({
        data: {
          taskId,
          action: prompt.slice(0, 200),
          status: 'completed',
          durationMs: completedTask.duration,
          result: {
            agentType: agentConfig.type,
            toolsUsed: agentResult.toolsUsed,
            iterations: agentResult.iterations,
            outputLength: agentResult.result.length,
          },
        },
      });
    } catch (e) {
      logger.warn(`Analytics write failed for task ${taskId}: ${e.message}`);
    }

    // 9. Publish final completed event
    await publishEvent('agentfi:tasks', {
      type: 'task:completed',
      data: {
        id: taskId,
        status: 'completed',
        result: agentResult.result,
        toolsUsed: agentResult.toolsUsed,
        agentType: agentConfig.type,
        completedAt: new Date(),
      },
    });

    logger.info(`Task ${taskId} completed successfully — ${agentResult.toolsUsed.length} tools used, ${agentResult.iterations} iterations`);

    return {
      taskId,
      agentType: agentConfig.type,
      toolsUsed: agentResult.toolsUsed,
      iterations: agentResult.iterations,
    };
  },
  {
    connection: workerRedis,
    concurrency: 3, // Process up to 3 tasks simultaneously
    limiter: {
      max: 10,      // Max 10 jobs per duration
      duration: 60000, // Per minute — respects Anthropic rate limits
    },
  }
);

// ─── Worker event handlers ─────────────────────────────────────────────────────

worker.on('completed', (job, result) => {
  logger.info(`Job ${job.id} completed: ${JSON.stringify(result)}`);
});

worker.on('failed', (job, err) => {
  logger.error(`Job ${job.id} failed: ${err.message}`);
});

worker.on('stalled', (jobId) => {
  logger.warn(`Job ${jobId} stalled — will be retried`);
});

worker.on('error', (err) => {
  logger.error(`Worker error: ${err.message}`);
});

// ─── Graceful shutdown ────────────────────────────────────────────────────────

async function shutdown() {
  logger.info('Worker shutting down gracefully...');
  await worker.close();
  await workerRedis.quit();
  await pubRedis.quit();
  await prisma.$disconnect();
  process.exit(0);
}

process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);

logger.info(`Agent worker started — listening to queue: ${QUEUE_NAME}`);
logger.info(`Concurrency: 3 | Rate limit: 10 jobs/min`);

export default worker;