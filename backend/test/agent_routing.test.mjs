/**
 * agent_routing.test.mjs — agent-first task routing (Part B).
 *
 * Verifies:
 *   - task -> agent -> executor routing (research / general / content)
 *   - router and classifier agree (single source of truth)
 *   - executor registry resolves for every active agent
 *   - agent status is derived from real configuration (ACTIVE/DEGRADED/UNAVAILABLE)
 *   - a failing provider does NOT trigger a blind fallback to a wrong agent
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { classifyTask } from '../src/agents/taskClassifier.js';
import { routeTask, getAgentStatus, executeWithAgent, getAgentRuntimeStatus } from '../src/agents/agentRegistry.js';
import { ProviderError } from '../src/services/llmProvider.js';

const RAW_SECRET = 'sk-super-secret-do-not-leak';

function clearRouterEnv() {
  for (const key of [
    'GROQ_API_KEY', 'GEMINI_API_KEY', 'CEREBRAS_API_KEY', 'GOOGLE_AI_API_KEY',
    'LLM_PROVIDER', 'PROVIDER_FALLBACK_ORDER', 'TAVILY_API_KEY', 'SERPER_API_KEY',
    'AGENT_TASK_TIMEOUT_MS', 'AGENT_PROVIDER_RETRIES',
  ]) {
    delete process.env[key];
  }
}

function setProviders() {
  process.env.GROQ_API_KEY = RAW_SECRET;
  process.env.GEMINI_API_KEY = RAW_SECRET;
  process.env.CEREBRAS_API_KEY = RAW_SECRET;
}

test.beforeEach(() => clearRouterEnv());
test.afterEach(() => clearRouterEnv());

// ── Routing: task -> agent -> executor ────────────────────────────────────────

test('1. DeFi/yield research task routes to the RESEARCH agent + its executor', () => {
  const routing = routeTask('Research today\'s best DeFi yield opportunities with risks and expected returns.');
  assert.equal(routing.agent, 'research');
  assert.equal(routing.executor, 'research-agent');
  assert.equal(routing.executorId, 'research-agent');
  assert.match(routing.reason, /research/);
});

test('2. explanation task routes to the GENERAL agent + its executor', () => {
  const routing = routeTask('Explain how Ethereum staking works step by step for a beginner.');
  assert.equal(routing.agent, 'general');
  assert.equal(routing.executor, 'general-agent');
});

test('3. writing task routes to the CONTENT agent + its executor', () => {
  const routing = routeTask('Write a 3-post X thread about Bitcoin ETFs for an audience of beginners.');
  assert.equal(routing.agent, 'content');
  assert.equal(routing.executor, 'content-agent');
});

test('4. router and classifier agree: classifyTask === routeTask for the active trio', () => {
  const cases = [
    'Research today\'s top stablecoin yields across Aave and Compound.',
    'Explain the difference between proof of work and proof of stake.',
    'Write a newsletter article about tokenising real-world assets.',
  ];
  for (const prompt of cases) {
    const viaClassify = classifyTask(prompt).type;
    const viaRoute = routeTask(prompt).agent;
    assert.equal(viaRoute, viaClassify, `routeTask and classifyTask disagree for: ${prompt}`);
  }
});

test('5. status derivation + NO blind fallback to a wrong agent', async () => {
  // Status derived from reality.
  clearRouterEnv();
  const noConfig = getAgentStatus('general');
  assert.equal(noConfig.status, 'UNAVAILABLE');
  assert.ok(/provider unavailable/i.test(noConfig.reason));

  setProviders();
  process.env.AGENT_PROVIDER_RETRIES = '0';

  const degradedResearch = getAgentStatus('research');
  assert.equal(degradedResearch.status, 'DEGRADED');
  assert.ok(/no live data source/i.test(degradedResearch.reason));

  process.env.TAVILY_API_KEY = 'tvly-test-not-secret';

  const research = getAgentStatus('research');
  assert.equal(research.status, 'ACTIVE');
  assert.equal(research.executorRegistered, true);
  assert.deepEqual(research.providers, ['groq', 'gemini', 'cerebras']);

  const runtime = getAgentRuntimeStatus();
  assert.equal(runtime.activeCount, 3);

  // No blind fallback: even though all providers fail, a research task must NOT
  // be silently re-routed to the general agent — it fails terminally instead.
  let originalFetch = globalThis.fetch && typeof globalThis.fetch === 'function' ? globalThis.fetch : null;
  globalThis.fetch = async () => ({ ok: false, status: 500, json: async () => ({}), text: async () => 'upstream down' });
  try {
    await assert.rejects(
      executeWithAgent({ action: 'Research current DeFi yields.', agentType: 'research', timeoutMs: 4000 }),
      (err) => err instanceof ProviderError && err.diagnostics && err.diagnostics.length === 3,
    );
  } finally {
    if (originalFetch) globalThis.fetch = originalFetch; else delete globalThis.fetch;
  }
});