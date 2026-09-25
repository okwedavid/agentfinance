// registry.js — compute worker model.
//
// computeWorkerRegistry  maps a service agent -> { source, run, idleCapacity }.
// computeScheduler        dispatch abstraction: inline execution for this slice
//                         (works with or without Redis). A BullMQ-backed path
//                         is provided for scale-out but the slice always runs
//                         inline so monetized jobs complete deterministically.

import { routeTask, executeWithAgent } from '../../agents/agentRegistry.js';
import { DEFAULT_TASK_TIMEOUT_MS } from '../../agents/agentRunner.js';

function envInt(name, fallback) {
  const parsed = Number.parseInt(process.env[name], 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

/**
 * Default fleet runner: routes the request through the existing agent fleet
 * (research/general/content) exactly like a normal AgentFinance task, but without
 * the task-reward path (compute job rewards are revenue-backed instead).
 */
export async function fleetComputeRunner({ inputText, jobId }) {
  const prompt = String(inputText || '').trim();
  const routing = routeTask(prompt);
  const agentType = routing.agent || 'general';
  const executorId = routing.executor || 'agent-fleet';

  const timeoutMs = envInt('AGENT_TASK_TIMEOUT_MS', DEFAULT_TASK_TIMEOUT_MS);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  const startedAtMs = Date.now();
  try {
    const result = await executeWithAgent({
      action: prompt,
      agentType,
      signal: controller.signal,
      timeoutMs,
      taskId: jobId,
    });
    return {
      output: result.output,
      provider: result.provider,
      model: result.model || null,
      agent: result.agent || agentType,
      executor: result.executor || executorId,
      durationMs: Date.now() - startedAtMs,
    };
  } finally {
    clearTimeout(timer);
  }
}

const DEFAULT_WORKER = {
  source: 'agent-fleet',
  run: fleetComputeRunner,
  idleCapacity: 1,
};

const WORKERS = new Map([
  ['research', DEFAULT_WORKER],
  ['general', DEFAULT_WORKER],
  ['content', DEFAULT_WORKER],
]);

export function getComputeWorker(agent) {
  const key = String(agent || 'general').toLowerCase();
  return WORKERS.get(key) || DEFAULT_WORKER;
}

export function computeWorkerRegistry() {
  return {
    workers: [...WORKERS.entries()].map(([agent, w]) => ({
      agent,
      source: w.source,
      idleCapacity: w.idleCapacity,
      registered: true,
    })),
    get(agent) {
      return getComputeWorker(agent);
    },
  };
}

/**
 * Scheduler. mode='inline' (default) executes synchronously via the worker so
 * a monetized job always completes; mode='queue' enqueues onto BullMQ for a
 * future consuming process (architecture-only scale-out path).
 */
export function computeScheduler({ queue = null, mode = 'inline', runner = null } = {}) {
  return {
    mode,
    async dispatch({ job }) {
      if (mode === 'queue' && queue) {
        await queue.add(
          'executeComputeJob',
          { jobId: job.id },
          { jobId: `compute-${job.id}`, attempts: 1, removeOnComplete: { count: 100 }, removeOnFail: { count: 50 } },
        );
        return { queued: true, run: null };
      }
      const fn = runner || getComputeWorker(job.agent).run;
      const run = await fn({ inputText: job.inputText, jobId: job.id });
      return { queued: false, run };
    },
  };
}