/**
 * agentRegistry.js — single source of truth for AgentFinance's active agents.
 *
 * Extends the existing classifyTask/runAgent execution path (it does NOT create
 * a competing provider system): agents select WHAT to do, executors run it, and
 * the provider router in agentRunner decides HOW the LLM step executes.
 *
 * Active operational agents for this phase: research, general, content.
 * Trading/execution/coordinator remain registered for the prompts they already
 * handled, but are not part of the active trio's availability reporting set.
 *
 * Agent status is DERIVED from reality, never fabricated:
 *   ACTIVE      executor registered + provider configured (+ data deps for research)
 *   DEGRADED    executor + provider, but a required dependency is missing
 *   UNAVAILABLE executor or provider configuration is missing
 *   DISABLED    explicitly disabled
 *
 * The executor contract is:
 *   run(taskCtx) -> { success, output, provider, model }
 * Executors must never leave a task hanging — they resolve or throw, and the
 * caller (agentService.executeAgentTask) converts every outcome to a terminal
 * task state.
 */
import { getProviderSpec, providerIsConfigured } from '../services/llmProvider.js';
import logger from '../utils/logger.js';
import { runAgent } from './agentRunner.js';
import { classifyTask } from './taskClassifier.js';

// ── Registry ─────────────────────────────────────────────────────────────────

export const ACTIVE_AGENTS = {
  research: {
    id: 'research',
    name: 'Research Agent',
    executorId: 'research-agent',
    capabilities: ['research', 'web_research', 'information_synthesis', 'comparative_analysis', 'risk_benefit_analysis', 'defi_research'],
    providers: ['groq', 'gemini', 'cerebras'],
    enabled: true,
  },
  general: {
    id: 'general',
    name: 'General AI / Analysis Agent',
    executorId: 'general-agent',
    capabilities: ['reasoning', 'explanation', 'summarisation', 'question_answering', 'analysis', 'classification'],
    providers: ['groq', 'gemini', 'cerebras'],
    enabled: true,
  },
  content: {
    id: 'content',
    name: 'Content Engine Agent',
    executorId: 'content-agent',
    capabilities: ['content_generation', 'copywriting', 'social_content', 'article_drafting', 'rewriting'],
    providers: ['groq', 'gemini', 'cerebras'],
    enabled: true,
  },
};

/** Providers that are configured on this server (key env present). Order preserved. */
function configuredProvidersFor(agent) {
  return (agent.providers || []).filter((id) => providerIsConfigured(getProviderSpec(id)));
}

function researchDataSource() {
  if (process.env.TAVILY_API_KEY) return 'web-search+tools';
  if (process.env.SERPER_API_KEY) return 'web-search+tools';
  return null;
}

// ── Executor registration ────────────────────────────────────────────────────

const EXECUTORS = {
  'research-agent': {
    id: 'research-agent',
    run: async (ctx) => {
      const result = await runAgent({ ...ctx, agentType: 'research' });
      // Honesty guard: live current-data retrieval only happens on the Groq
      // tool path (tools are only wired there today). If a different provider
      // produced the answer, label it as analysis, never as live research.
      if (String(result.provider || '').toLowerCase() !== 'groq') {
        const note = `\n\n[Capability notice] Live current-data retrieval was unavailable for this run (provider: ${result.provider}). This is model analysis, not live research — verify current figures independently.`;
        return { ...result, output: `${result.output}${note}` };
      }
      return result;
    },
  },
  'general-agent': {
    id: 'general-agent',
    run: async (ctx) => runAgent({ ...ctx, agentType: 'general' }),
  },
  'content-agent': {
    id: 'content-agent',
    run: async (ctx) => runAgent({ ...ctx, agentType: 'content' }),
  },
  // Legacy executors so existing agent types continue to function.
  'coordinator-agent': { id: 'coordinator-agent', run: async (ctx) => runAgent({ ...ctx, agentType: 'coordinator' }) },
  'trading-agent': { id: 'trading-agent', run: async (ctx) => runAgent({ ...ctx, agentType: 'trading' }) },
  'execution-agent': { id: 'execution-agent', run: async (ctx) => runAgent({ ...ctx, agentType: 'execution' }) },
};

export function getExecutor(executorId) {
  return EXECUTORS[executorId] || null;
}

export function agentExecutorIdFor(agentType) {
  const agent = ACTIVE_AGENTS[agentType];
  if (agent) return agent.executorId;
  switch (agentType) {
    case 'coordinator': return 'coordinator-agent';
    case 'trading': return 'trading-agent';
    case 'execution': return 'execution-agent';
    default: return 'general-agent';
  }
}

// ── Router: TASK -> AGENT -> EXECUTOR ────────────────────────────────────────
// Deterministic on top of classifyTask. Routing is fast (no LLM round-trip) and
// capability-first: it returns BOTH the suitable agent and the executor.
export function routeTask(action = '') {
  const classified = classifyTask(action).type;
  const agent = ACTIVE_AGENTS[classified] || { id: classified, name: actionTypeLabel(classified), executorId: agentExecutorIdFor(classified), providers: [] };
  return {
    agent: agent.id,
    agentName: agent.name,
    executor: agent.executorId,
    executorId: agent.executorId,
    reason: `${agent.id} agent selected for the task capabilities`,
    providers: configuredProvidersFor(agent),
  };
}

function actionTypeLabel(type) {
  switch (type) {
    case 'coordinator': return 'AI Coordinator';
    case 'trading': return 'Trading Agent';
    case 'execution': return 'Execution Agent';
    default: return 'General AI / Analysis Agent';
  }
}

/**
 * Execute a task through the registered executor with explicit routing metadata.
 * Compatible with agentService.executeAgentTask — persists nothing itself.
 */
export async function executeWithAgent({ action, agentType = null, walletAddress = null, signal = null, timeoutMs = null, taskId = null }) {
  const resolvedType = agentType || routeTask(action).agent;
  const executorId = agentExecutorIdFor(resolvedType);
  const executor = getExecutor(executorId);
  if (!executor) {
    throw new Error(`No executor registered for agent "${resolvedType}".`);
  }

  logger.info(`[TASK ${taskId || '?'}] route agent=${resolvedType}`);
  logger.info(`[TASK ${taskId || '?'}] executor=${executorId}`);

  const result = await executor.run({ action, walletAddress, signal, timeoutMs, taskId });

  // Agent-level fallback: never force an unsuitable agent. If the selected
  // executor produced a provider-level failure, that failure is terminal for
  // this run (provider fallback already happened inside runAgent).
  return {
    ...result,
    agent: resolvedType,
    executor: executorId,
  };
}

// ── Availability (derived from reality) ──────────────────────────────────────

export function getAgentStatus(agentId) {
  const agent = ACTIVE_AGENTS[agentId];
  if (!agent) {
    return { id: agentId, name: actionTypeLabel(agentId), status: 'UNAVAILABLE', reason: 'Agent is not registered as an active agent.', executorRegistered: false, providers: [] };
  }
  if (!agent.enabled) {
    return { id: agent.id, name: agent.name, status: 'DISABLED', reason: 'Agent is disabled.', executorRegistered: true, providers: [] };
  }

  const executor = getExecutor(agent.executorId);
  const providers = configuredProvidersFor(agent);

  const base = { id: agent.id, name: agent.name, executorRegistered: Boolean(executor), providers };
  if (!executor) {
    return { ...base, status: 'UNAVAILABLE', reason: 'Executor is not registered.' };
  }
  if (providers.length === 0) {
    return { ...base, status: 'UNAVAILABLE', reason: 'Required provider unavailable.' };
  }

  if (agent.id === 'research') {
    const dataSource = researchDataSource();
    if (!dataSource) {
      return {
        ...base,
        status: 'DEGRADED',
        reason: 'No live data source configured; analysis-only execution is still available.',
        dataSource: null,
      };
    }
    return { ...base, status: 'ACTIVE', reason: 'Executor registered, provider available, live data source configured.', dataSource };
  }

  return { ...base, status: 'ACTIVE', reason: 'Executor registered and provider available.' };
}

export function getAgentRuntimeStatus() {
  const required = ['research', 'general', 'content'];
  const statuses = {};
  for (const id of required) statuses[id] = getAgentStatus(id);
  return {
    agents: statuses,
    activeCount: Object.values(statuses).filter((s) => s.status === 'ACTIVE').length,
  };
}

export function getProviderRuntimeStatus() {
  const ids = ['groq', 'gemini', 'cerebras'];
  const out = {};
  for (const id of ids) {
    const spec = getProviderSpec(id);
    out[id] = providerIsConfigured(spec) ? 'configured' : 'unavailable';
  }
  return out;
}