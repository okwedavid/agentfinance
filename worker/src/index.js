import dotenv from 'dotenv';
dotenv.config();
import { Worker } from 'bullmq';
import IORedis from 'ioredis';
import { PrismaClient } from '@prisma/client';
import OpenAI from 'openai';

const REDIS_URL = process.env.REDIS_URL || 'redis://redis:6379';
const OPENAI_API_KEY = process.env.OPENAI_API_KEY;
const MOCK_OPENAI = process.env.MOCK_OPENAI === 'true' || false;
const redis = new IORedis(REDIS_URL, { maxRetriesPerRequest: null });

// Listen for coordination commands
redis.subscribe('agentfi:coord', (err) => {
  if (err) console.error('[worker] Redis coord subscribe error', err);
  else console.log('[worker] Subscribed to agentfi:coord');
});

redis.on('message', async (channel, message) => {
  if (channel !== 'agentfi:coord') return;
  let cmd;
  try { cmd = JSON.parse(message); } catch (e) { console.error('[worker] Invalid coord message', message); return; }
  if (cmd.type === 'perform:subtask') {
    console.log('[worker] Received perform:subtask', cmd);
    // Simulate subtask execution
    let result = null, error = null;
    for (let attempt = 1; attempt <= 3; attempt++) {
      try {
        // Simulate work (replace with real logic)
        result = { agentId: cmd.agentId, output: `Subtask done: ${cmd.payload.action}`, attempt };
        break;
      } catch (err) {
        error = err;
        console.error(`[worker] Subtask attempt ${attempt} failed`, err);
        await new Promise(r => setTimeout(r, 500 * attempt));
      }
    }
    await redis.publish('agentfi:coord', JSON.stringify({ type: 'worker:result', agentId: cmd.agentId, payload: { result, error } }));
  }
});
const prisma = new PrismaClient();
const openai = new OpenAI({ apiKey: OPENAI_API_KEY });

console.log('Worker starting, connecting to BullMQ and OpenAI...');

const worker = new Worker('agentfi:tasks', async (job) => {
  console.log('[worker] Processing job:', job.data);
  const { taskId, action, agentId } = job.data;


  // mark running and record start time
  const startedAt = new Date();
  await prisma.task.update({ where: { id: taskId }, data: { status: 'running', startedAt } });
  await redis.publish('agentfi:tasks', JSON.stringify({ type: 'task:updated', data: { id: taskId, status: 'running' } }));

  try {
    // If MOCK_OPENAI is enabled, return a simulated result immediately
    let t = await prisma.task.findUnique({ where: { id: taskId } });
    if (!t) throw new Error('task not found');
    let text = null;
    let status = 'completed';
    let resultObj = null;
    let completedAt = new Date();
    let durationMs = null;

    if (MOCK_OPENAI) {
      text = `MOCKED: Completed action for task ${taskId} (action=${taskId})`;
    } else if (OPENAI_API_KEY) {
      // Prepare OpenAI messages using Agent prompt if available
      let systemMsg = 'You are a helpful assistant.';
      if (t.agentId) {
        const agent = await prisma.agent.findUnique({ where: { id: t.agentId } });
        if (agent && agent.prompt) systemMsg = agent.prompt;
      }
      const userContent = t.input || `Perform action: ${t.action}`;
      try {
        const resp = await openai.chat.completions.create({
          model: 'gpt-4o-mini',
          messages: [
            { role: 'system', content: systemMsg },
            { role: 'user', content: userContent }
          ],
          max_tokens: 800,
        });
        text = resp?.choices?.[0]?.message?.content || JSON.stringify(resp);
        resultObj = resp;
      } catch (oaErr) {
        console.error('OpenAI call failed', oaErr);
        text = `OpenAI error: ${oaErr.message}`;
        status = 'failed';
        resultObj = { error: oaErr.message };
      }
    } else {
      text = `Simulated result for action: ${t.action}`;
    }

    completedAt = new Date();
    durationMs = startedAt ? completedAt - startedAt : null;

    // update DB with output and completion time
    await prisma.task.update({ where: { id: taskId }, data: { status, output: text, completedAt, duration: durationMs } });
    await redis.publish('agentfi:tasks', JSON.stringify({ type: 'task:updated', data: { id: taskId, status, output: text } }));

    // Persist TaskAnalytics
    await prisma.taskAnalytics.create({
      data: {
        taskId: t.id,
        action: t.action,
        status,
        durationMs,
        result: resultObj || text,
        createdAt: completedAt
      }
    });

    return { output: text };
    if (MOCK_OPENAI) {
      text = `MOCKED: Completed action for task ${taskId} (action=${t.action})`;
    } else if (OPENAI_API_KEY) {
      try {
        const resp = await openai.chat.completions.create({
          model: 'gpt-4o-mini',
          messages: [
            { role: 'system', content: systemMsg },
            { role: 'user', content: userContent }
          ],
          max_tokens: 800,
        });
        text = resp?.choices?.[0]?.message?.content || JSON.stringify(resp);
      } catch (oaErr) {
        console.error('OpenAI call failed', oaErr);
        text = `OpenAI error: ${oaErr.message}`;
      }
    } else {
      text = `Simulated result for action: ${t.action}`;
    }

  // update DB with output
  await prisma.task.update({ where: { id: taskId }, data: { status: 'completed', output: text } });
    await redis.publish('agentfi:tasks', JSON.stringify({ type: 'task:updated', data: { id: taskId, status: 'completed', output: text } }));

    return { output: text };
  } catch (err) {
    console.error('Worker error', err);
    let failedAt = new Date();
    let failDuration = startedAt ? failedAt - startedAt : null;
    await prisma.task.update({ where: { id: taskId }, data: { status: 'failed', completedAt: failedAt, duration: failDuration } });
    await redis.publish('agentfi:tasks', JSON.stringify({ type: 'task:updated', data: { id: taskId, status: 'failed' } }));
    // Persist failed TaskAnalytics
    let t = await prisma.task.findUnique({ where: { id: taskId } });
    await prisma.taskAnalytics.create({
      data: {
        taskId: taskId,
        action: t?.action || '',
        status: 'failed',
        durationMs: failDuration,
        result: { error: err.message },
        createdAt: failedAt
      }
    });
    throw err;
  }
}, { connection: redis });

worker.on('completed', (job) => console.log('Job completed', job.id));
worker.on('failed', (job, err) => console.error('Job failed', job.id, err));

process.on('SIGINT', async () => { console.log('Shutting down worker'); await worker.close(); await prisma.$disconnect(); process.exit(0); });
