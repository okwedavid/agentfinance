import { Router } from "express";
import { body, validationResult } from "express-validator";
import redisClient from "../../../shared/redisClient.js";
import prismaClient from '../prismaClient.js';

const router = Router();

function publishEvent(type: string, data: any) {
  return redisClient.publish("agent:events", JSON.stringify({ type, ...data }));
}

router.post(
  "/init",
  [body("taskId").isString(), body("payload").exists(), body("agentName").isString()],
  async (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty())
      return res.status(400).json({ status: "error", errors: errors.array() });
    const { taskId, payload, agentName } = req.body;
    await publishEvent("init", { taskId, payload, agentName });
    res.json({ status: "ok", message: "Event broadcasted", event: "init" });
  }
);

router.post(
  "/assign",
  [body("taskId").isString(), body("agentId").isString(), body("agentName").isString()],
  async (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty())
      return res.status(400).json({ status: "error", errors: errors.array() });
    const { taskId, agentId, agentName } = req.body;
    await publishEvent("assign", { taskId, agentId, agentName });
    res.json({ status: "ok", message: "Event broadcasted", event: "assign" });
  }
);

router.post(
  "/update",
  [body("taskId").isString(), body("agentId").isString(), body("status").isString(), body("progress").optional()],
  async (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty())
      return res.status(400).json({ status: "error", errors: errors.array() });
    const { taskId, agentId, status, progress } = req.body;
    await publishEvent("update", { taskId, agentId, status, progress });
    res.json({ status: "ok", message: "Event broadcasted", event: "update" });
  }
);

router.post(
  "/complete",
  [body("taskId").isString(), body("agentId").isString(), body("result").exists()],
  async (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty())
      return res.status(400).json({ status: "error", errors: errors.array() });
    const { taskId, agentId, result } = req.body;
    await publishEvent("complete", { taskId, agentId, result });
    res.json({ status: "ok", message: "Event broadcasted", event: "complete" });
  }
);

export default router;

// Add simple GET /tasks for analytics consumption
router.get('/tasks', async (req, res) => {
  try {
    const tasks = await prismaClient.task.findMany({ orderBy: { createdAt: 'desc' }, take: 200 });
    res.json({ total: tasks.length, tasks });
  } catch (e) {
    console.error('fetch tasks error', e);
    res.status(500).json({ error: 'failed' });
  }
});
