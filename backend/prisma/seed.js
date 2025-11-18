const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function main() {
  await prisma.agentEvent.deleteMany();
  await prisma.agentTask.deleteMany();

  const agents = ['alpha', 'beta', 'gamma', 'delta', 'epsilon'];
  const statuses = ['completed', 'running', 'pending', 'failed'];

  console.log('🌱 Seeding 156 tasks...');

  for (let i = 1; i <= 156; i++) {
    const agent = agents[Math.floor(Math.random() * agents.length)];
    const status = statuses[Math.floor(Math.random() * statuses.length)];
    const duration = Math.floor(Math.random() * 5000) + 500;

    const task = await prisma.agentTask.create({
      data: {
        taskId: `task-${i.toString().padStart(3, '0')}`,
        agentName: agent,
        status,
        input: { prompt: `Analyze Q${i%4+1} financials for ${agent}` },
        output: status === 'completed' ? { result: `Processed in ${duration}ms` } : null,
        duration: status === 'completed' ? duration : null,
        completedAt: status === 'completed' ? new Date(Date.now() - duration) : null
      }
    });

    await prisma.agentEvent.createMany({
      data: [
        { taskId: task.taskId, agentName: agent, type: 'init', payload: { input: task.input } },
        { taskId: task.taskId, agentName: agent, type: 'assign', payload: {} },
        { taskId: task.taskId, agentName: agent, type: 'complete', payload: { output: task.output }, status, duration }
      ]
    });
  }

  const count = await prisma.agentTask.count();
  console.log(`✅ SEED COMPLETE: ${count} tasks + ${count * 3} events`);
}

main()
  .catch(e => console.error('SEED ERROR:', e))
  .finally(() => prisma.$disconnect());
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

export default async function seed() {
  try {
    console.log('Seeding DB...');
    await prisma.agent.createMany({
      data: [
        { name: 'Research Assistant', role: 'assistant', prompt: 'You are a helpful research assistant.' },
        { name: 'Crypto Monitor', role: 'monitor', prompt: 'You monitor crypto markets and report anomalies.' },
      ],
      skipDuplicates: true,
    });
    await prisma.task.createMany({
      data: [{ action: 'seed:initial', input: 'initializing', status: 'completed', result: 'ok' }],
    });
    console.log('Seed complete');
  } finally {
    await prisma.$disconnect();
  }
}
