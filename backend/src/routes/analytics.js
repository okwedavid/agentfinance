import express from 'express';
import prisma from '../prismaClient.js';

const router = express.Router();

function parseTaskResult(value) {
  if (!value) return null;
  if (typeof value !== 'string') return value;
  try {
    return JSON.parse(value);
  } catch {
    return value;
  }
}

router.get('/summary', async (req, res) => {
  try {
    const tasks = await prisma.task.findMany({
      where: { archived: false },
      orderBy: { createdAt: 'desc' },
      take: 500,
    });

    const totalTasks = tasks.length;
    const completed = tasks.filter((task) => task.status === 'completed').length;
    const failed = tasks.filter((task) => task.status === 'failed').length;
    const running = tasks.filter((task) => task.status === 'running').length;

    const successRate = totalTasks ? Math.round((completed / totalTasks) * 100) : 0;

    const agentMap = new Map();
    tasks.forEach((task) => {
      const parsed = parseTaskResult(task.result);
      const name = parsed?.agentType || task.agentId || 'coordinator';
      agentMap.set(name, (agentMap.get(name) || 0) + 1);
    });

    const agents = [...agentMap.entries()]
      .map(([agent, count]) => ({ agent, tasks: count }))
      .sort((a, b) => b.tasks - a.tasks);

    const trends = Array.from({ length: 7 }, (_, index) => {
      const date = new Date();
      date.setDate(date.getDate() - (6 - index));
      const dayKey = date.toISOString().slice(0, 10);
      const dayTasks = tasks.filter((task) => task.createdAt.toISOString().slice(0, 10) === dayKey);
      return {
        date: dayKey,
        tasks: dayTasks.length,
        completed: dayTasks.filter((task) => task.status === 'completed').length,
        failed: dayTasks.filter((task) => task.status === 'failed').length,
      };
    });

    res.json({
      summary: {
        totalTasks,
        completed,
        failed,
        running,
        successRate,
        agents: agents.length,
      },
      agents,
      trends,
    });
  } catch (error) {
    console.error('analytics summary error', error);
    res.status(500).json({ error: 'failed' });
  }
});

router.get('/history', async (req, res) => {
  try {
    const take = parseInt(req.query.limit, 10) || 50;
    const skip = parseInt(req.query.offset ?? req.query.skip, 10) || 0;
    const rows = await prisma.task.findMany({
      where: { archived: false },
      orderBy: { createdAt: 'desc' },
      take,
      skip,
    });
    res.json(rows.map((row) => ({
      ...row,
      result: parseTaskResult(row.result),
    })));
  } catch (error) {
    console.error('analytics history error', error);
    res.status(500).json({ error: 'failed' });
  }
});

router.delete('/clear', async (req, res) => {
  try {
    const result = await prisma.task.updateMany({
      where: { archived: false },
      data: { archived: true },
    });
    res.json({ ok: true, cleared: result.count });
  } catch (error) {
    console.error('analytics clear error', error);
    res.status(500).json({ error: 'failed' });
  }
});

export default router;
