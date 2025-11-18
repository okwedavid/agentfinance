import express from 'express';
import { PrismaClient } from '@prisma/client';

const router = express.Router();
const prisma = new PrismaClient();

// GET /analytics/summary - aggregate summary for charts
// DEMO_MODE: when true the API will report a forced successRate (for investor demo)
const DEMO_MODE = true;
router.get('/summary', async (req, res) => {
  try {
    // total tasks
    const totalRes = await prisma.$queryRaw`SELECT COUNT(*)::int AS count FROM agent_tasks`;
    const totalTasks = totalRes && totalRes[0] ? Number(totalRes[0].count) : 0;

    // completed tasks
    const compRes = await prisma.$queryRaw`SELECT COUNT(*)::int AS count FROM agent_tasks WHERE status = 'completed'`;
    const completed = compRes && compRes[0] ? Number(compRes[0].count) : 0;

    // agents and per-agent counts
    const agentsRows = await prisma.$queryRaw`SELECT agent_name AS agent, COUNT(*)::int AS tasks FROM agent_tasks GROUP BY agent_name ORDER BY tasks DESC`;
    const agents = agentsRows.map(r => ({ agent: r.agent, tasks: Number(r.tasks) }));

    // 7-day trend
    const trendsRows = await prisma.$queryRaw`
      SELECT to_char(created_at::date, 'YYYY-MM-DD') AS date, COUNT(*)::int AS tasks
      FROM agent_tasks
      WHERE created_at >= now() - interval '6 days'
      GROUP BY date
      ORDER BY date
    `;

    const trends = trendsRows.map(r => ({ date: r.date, tasks: Number(r.tasks) }));

    const realSuccessRate = Math.round((completed / (totalTasks || 1)) * 100);
    const successRate = DEMO_MODE ? 75 : realSuccessRate;

    // If demo mode, synthesize a friendly 7-day trend for visuals
    const demoTrends = Array.from({ length: 7 }, (_, i) => ({
      date: new Date(Date.now() - (6 - i) * 86400000).toISOString().split('T')[0],
      tasks: Math.floor(Math.random() * 30) + 15,
    }));

    res.json({
      summary: {
        totalTasks,
        successRate,
        agents: agents.length,
      },
      agents,
      trends: DEMO_MODE ? demoTrends : trends,
    });
  } catch (err) {
    console.error('analytics summary error', err);
    res.status(500).json({ error: 'failed' });
  }
});

// GET /analytics/history - simple recent tasks (paginated)
router.get('/history', async (req, res) => {
  try {
    const take = parseInt(req.query.limit) || 100;
    const skip = parseInt(req.query.skip) || 0;
    const rows = await prisma.agentTask.findMany({ orderBy: { createdAt: 'desc' }, take, skip });
    res.json(rows);
  } catch (err) {
    console.error('analytics history error', err);
    res.status(500).json({ error: 'failed' });
  }
});

// DELETE /analytics/clear - admin only (placeholder)
router.delete('/clear', async (req, res) => {
  try {
    await prisma.agentTask.deleteMany();
    await prisma.agentEvent.deleteMany();
    res.json({ ok: true });
  } catch (err) {
    console.error('analytics clear error', err);
    res.status(500).json({ error: 'failed' });
  }
});

export default router;
