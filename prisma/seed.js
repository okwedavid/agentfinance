const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function main() {
  const agents = ['alpha', 'beta', 'gamma', 'delta', 'epsilon'];

  // ensure agents exist
  const agentRecords = {};
  for (const name of agents) {
    let a = await prisma.agent.findUnique({ where: { name } });
    if (!a) {
      a = await prisma.agent.create({ data: { name } });
    }
    agentRecords[name] = a;
  }

  const statuses = ['completed', 'running', 'pending', 'failed'];

  for (let i = 1; i <= 156; i++) {
    const agent = agents[Math.floor(Math.random() * agents.length)];
    const status = statuses[Math.floor(Math.random() * statuses.length)];
    const duration = Math.floor(Math.random() * 5000) + 500;
    await prisma.task.create({ data: {
      id: `task-${i.toString().padStart(3,'0')}`,
      action: `Analyze Q${(i%4)+1} financials for ${agent}`,
      status,
      agentId: agentRecords[agent].id,
      createdAt: new Date(Date.now() - Math.floor(Math.random()*1000*60*60*24*7)),
      updatedAt: new Date()
    }});
  }

  console.log('✅ SEED COMPLETE: 156 tasks across 5 agents');
}

main()
  .catch(e => { console.error(e); process.exit(1); })
  .finally(() => prisma.$disconnect());
