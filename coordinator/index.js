const { PrismaClient } = require('@prisma/client');
const { createRedisClient } = require('../shared/redisClient.js');
const { v4: uuidv4 } = require('uuid');

const prisma = new PrismaClient();
const redis = createRedisClient();

async function main() {
  console.log('[Coordinator] Service started');
  while (true) {
    // Poll for pending CoordinatorTasks
    const pending = await prisma.coordinatorTask.findMany({ where: { status: 'pending' } });
    for (const task of pending) {
      // Plan: create subtasks (dummy logic)
      const plan = [{ type: 'llm:call', payload: { prompt: 'Summarize data' } }];
      await prisma.coordinatorTask.update({ where: { id: task.id }, data: { plan, status: 'planning' } });
      // Create SubTasks
      for (const sub of plan) {
        await prisma.subTask.create({ data: { coordinatorId: task.id, type: sub.type, payload: sub.payload } });
      }
      await prisma.coordinatorTask.update({ where: { id: task.id }, data: { status: 'executing' } });
      await prisma.auditLog.create({ data: { kind: 'coordinator.plan', payload: { taskId: task.id, plan } } });
      // Publish to Redis for subtask workers
      await redis.lpush('agentfi:subtasks', JSON.stringify({ coordinatorId: task.id, plan }));
      await redis.publish('agentfi:tasks', JSON.stringify({ type: 'coordinator:planned', data: { id: task.id, plan } }));
      console.log(`[Coordinator] Planned and dispatched subtasks for ${task.id}`);
    }
    await new Promise(r => setTimeout(r, 3000));
  }
}

main().catch(e => { console.error(e); process.exit(1); });
