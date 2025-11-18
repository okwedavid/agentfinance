const { PrismaClient } = require('@prisma/client');
const { createRedisClient } = require('../shared/redisClient.js');

const prisma = new PrismaClient();
const redis = createRedisClient();

async function main() {
  console.log('[SubtaskWorker] Service started');
  while (true) {
    const subtaskRaw = await redis.rpop('agentfi:subtasks');
    if (!subtaskRaw) {
      await new Promise(r => setTimeout(r, 2000));
      continue;
    }
    const subtaskMsg = JSON.parse(subtaskRaw);
    // Find a pending subtask in DB
    const subtask = await prisma.subTask.findFirst({ where: { coordinatorId: subtaskMsg.coordinatorId, status: 'pending' } });
    if (!subtask) continue;
    await prisma.subTask.update({ where: { id: subtask.id }, data: { status: 'running' } });
    await redis.publish('agentfi:tasks', JSON.stringify({ type: 'subtask:started', data: { id: subtask.id } }));
    // Dummy work
    await new Promise(r => setTimeout(r, 2000));
    await prisma.subTask.update({ where: { id: subtask.id }, data: { status: 'completed', result: { ok: true } } });
    await redis.publish('agentfi:tasks', JSON.stringify({ type: 'subtask:completed', data: { id: subtask.id } }));
    console.log(`[SubtaskWorker] Completed subtask ${subtask.id}`);
  }
}

main().catch(e => { console.error(e); process.exit(1); });
