import express from 'express';
import { task as taskModel } from '../prismaClient.js';
import { v4 as uuidv4 } from 'uuid';

export default function makeTasksRouter({ redis, taskQueue, authMiddleware }){
  const router = express.Router();

  // robust POST /tasks endpoint (protected)
  router.post('/', authMiddleware, async (req, res) => {
    console.log('[backend] Received POST /tasks');
    let taskObj = null;
    try {
      const { action, agentId } = req.body;
      if (!action || typeof action !== 'string') {
        console.error('[backend] Invalid action');
        return res.status(400).json({ error: 'invalid action' });
      }
      console.log('[backend] Creating DB task');
      taskObj = await taskModel.create({
        data: {
          action,
          agentId,
          status: 'pending',
        },
      });
      console.log('[backend] Created task:', taskObj.id);
      console.log('[backend] Adding to queue agentfi:tasks');
      await taskQueue.add('newTask', { taskId: taskObj.id, action, agentId });
      if (redis) await redis.publish('agentfi:tasks', JSON.stringify({ type: 'task:created', data: taskObj }));
      console.log('[backend] Success');
      res.json({ ok: true, taskId: taskObj.id });
    } catch (err) {
      console.error('[backend] Task creation failed:', err);
      if (err && err.stack) console.error(err.stack);
      res.status(500).json({ error: 'failed', reason: err.message });
    }
  });

  // list tasks
  router.get('/', authMiddleware, async (req, res)=>{
    try{ const tasks = await taskModel.findMany({ orderBy: { createdAt: 'desc' }, take: 200 }); res.json(tasks); }
    catch(e){ console.error(e); res.status(500).json({ error: 'failed' }); }
  });

  // get task with messages
  router.get('/:id', authMiddleware, async (req, res)=>{
    try{
      const t = await taskModel.findUnique({ where: { id: req.params.id }, include: { messages: { orderBy: { createdAt: 'asc' } } } });
      if(!t) return res.status(404).json({ error: 'not found' });
      res.json(t);
    }catch(e){ console.error(e); res.status(500).json({ error: 'failed' }); }
  });

  // patch task
  router.patch('/:id', authMiddleware, async (req, res)=>{
    try{
      const fields = {};
      const { status, result, archived, startedAt, completedAt } = req.body;
      if(status) fields.status = status;
      if(result) fields.result = result;
      if(typeof archived === 'boolean') fields.archived = archived;
      if(startedAt) fields.startedAt = new Date(startedAt);
      if(completedAt) fields.completedAt = new Date(completedAt);
      const t = await taskModel.update({ where: { id: req.params.id }, data: { ...fields } });
      if(redis) await redis.publish('agentfi:tasks', JSON.stringify({ type: 'task:updated', data: t }));
      res.json(t);
    }catch(e){ console.error(e); res.status(500).json({ error: 'failed' }); }
  });

  // delete/archive
  router.delete('/:id', authMiddleware, async (req, res)=>{
    try{ const t = await taskModel.update({ where: { id: req.params.id }, data: { archived: true } }); if(redis) await redis.publish('agentfi:tasks', JSON.stringify({ type: 'task:deleted', data: { id: t.id } })); res.json({ ok: true }); }
    catch(e){ console.error(e); res.status(500).json({ error: 'failed' }); }
  });

  return router;
}
