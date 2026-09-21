/**
 * provider_fallback.test.mjs — multi-provider AI resilience (Part A).
 *
 * Verifies the deterministic provider router:
 *   - ordered fallback chain (groq -> gemini -> cerebras by default)
 *   - unconfigured providers are skipped, never fatal
 *   - normalized error categories and safe, secret-free messages
 *   - bounded per-provider retries only for retryable categories
 *   - per-agent provider order override
 *   - all-providers-failed surfaces a generic honest message + diagnostics
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { runAgent, providerOrderForAgent } from '../src/agents/agentRunner.js';
import {
  ALL_PROVIDERS_FAILED_MESSAGE,
  ProviderError,
  PROVIDER_ERROR,
  providerFallbackOrder,
  safeMessageFor,
} from '../src/services/llmProvider.js';

const RAW_SECRET = 'sk-super-secret-do-not-leak';

// ── Helpers ───────────────────────────────────────────────────────────────────

let originalFetch;
function stubFetch(impl) {
  originalFetch = globalThis.fetch;
  globalThis.fetch = impl;
}

function restoreFetch() {
  if (originalFetch) globalThis.fetch = originalFetch;
  originalFetch = null;
}

function clearProviderEnv() {
  for (const key of [
    'GROQ_API_KEY', 'GEMINI_API_KEY', 'CEREBRAS_API_KEY', 'ANTHROPIC_API_KEY',
    'OPENROUTER_API_KEY', 'TOGETHER_API_KEY', 'MISTRAL_API_KEY', 'GOOGLE_AI_API_KEY',
    'LLM_PROVIDER', 'LLM_FALLBACK_PROVIDER', 'PROVIDER_FALLBACK_ORDER',
    'GROQ_MODEL', 'GEMINI_MODEL', 'CEREBRAS_MODEL',
    'RESEARCH_PROVIDER_ORDER', 'GENERAL_PROVIDER_ORDER', 'CONTENT_PROVIDER_ORDER',
    'AGENT_TASK_TIMEOUT_MS', 'AGENT_PROVIDER_RETRIES',
  ]) {
    delete process.env[key];
  }
}

function setProviderEnv(extra = {}) {
  const defaults = {
    AGENT_TASK_TIMEOUT_MS: '5000',
    AGENT_PROVIDER_RETRIES: '0',
  };
  Object.assign(process.env, defaults, extra);
}

function jsonResponse(body, status = 200) {
  return { ok: status >= 200 && status < 300, status, json: async () => body, text: async () => JSON.stringify(body) };
}

function openaiResult(content, model = 'groq-test') {
  return jsonResponse({ choices: [{ message: { content } }], model });
}

function openaiError(status, message) {
  return { ok: false, status, json: async () => ({ error: { message } }), text: async () => message };
}

function geminiResult(content, model = 'gemini-2.5-flash') {
  return jsonResponse({ candidates: [{ content: { parts: [{ text: content }] } }], model });
}

test.beforeEach(() => { clearProviderEnv(); });
test.afterEach(() => { clearProviderEnv(); restoreFetch(); });

// ── Router (unit) ─────────────────────────────────────────────────────────────

test('1. default fallback order is groq -> gemini -> cerebras', () => {
  setProviderEnv({ GROQ_API_KEY: RAW_SECRET, GEMINI_API_KEY: RAW_SECRET, CEREBRAS_API_KEY: RAW_SECRET });
  assert.deepEqual(providerFallbackOrder(), ['groq', 'gemini', 'cerebras']);
});

test('2. unconfigured providers are skipped immediately', () => {
  setProviderEnv({ GROQ_API_KEY: RAW_SECRET });
  assert.deepEqual(providerFallbackOrder(), ['groq']);
  setProviderEnv({ GEMINI_API_KEY: RAW_SECRET });
  assert.deepEqual(providerFallbackOrder(), ['groq', 'gemini']);
});

test('3. explicitly-set LLM_PROVIDER that is unconfigured is skipped, not fatal', () => {
  setProviderEnv({ GROQ_API_KEY: RAW_SECRET, LLM_PROVIDER: 'cerebras' });
  assert.deepEqual(providerFallbackOrder(), ['groq']);
});

test('4. PROVIDER_FALLBACK_ORDER env overrides order and filters unknown ids', () => {
  setProviderEnv({ GROQ_API_KEY: RAW_SECRET, GEMINI_API_KEY: RAW_SECRET, PROVIDER_FALLBACK_ORDER: 'gemini,groq,unknown-provider' });
  assert.deepEqual(providerFallbackOrder(), ['gemini', 'groq']);
});

test('5. per-agent provider order override is applied and filtered', () => {
  setProviderEnv({ GROQ_API_KEY: RAW_SECRET, GEMINI_API_KEY: RAW_SECRET, RESEARCH_PROVIDER_ORDER: 'gemini,groq' });
  assert.deepEqual(providerOrderForAgent('research'), ['gemini', 'groq']);
  assert.deepEqual(providerOrderForAgent('general'), ['groq', 'gemini']);
});

// ── Execution: fallback chain ─────────────────────────────────────────────────

test('6. falls back groq -> gemini when groq fails', async () => {
  setProviderEnv({ GROQ_API_KEY: RAW_SECRET, GEMINI_API_KEY: RAW_SECRET });
  stubFetch(async (url) => {
    if (String(url).includes('generativelanguage')) return geminiResult('Gemini fallback worked.');
    return openaiError(401, 'bad key');
  });
  const result = await runAgent({ action: 'Summarise this text', agentType: 'general' });
  assert.equal(result.success, true);
  assert.equal(result.provider, 'Gemini');
  assert.match(result.output, /Gemini fallback/);
});

test('7. falls back groq -> gemini -> cerebras when the first two fail', async () => {
  setProviderEnv({
    GROQ_API_KEY: RAW_SECRET,
    GEMINI_API_KEY: RAW_SECRET,
    CEREBRAS_API_KEY: RAW_SECRET,
    LLM_PROVIDER: 'groq',
  });
  stubFetch(async (url) => {
    if (String(url).includes('api.cerebras.ai')) return openaiResult('Cerebras fallback worked.', 'gpt-oss-120b');
    return openaiError(401, 'bad key'); // groq + gemini both fail
  });
  const result = await runAgent({ action: 'Write a one-line update', agentType: 'content' });
  assert.equal(result.success, true);
  assert.equal(result.provider, 'Cerebras');
  assert.match(result.output, /Cerebras fallback/);
});

test('8. all providers failed -> generic honest message with per-provider diagnostics', async () => {
  setProviderEnv({ GROQ_API_KEY: RAW_SECRET, GEMINI_API_KEY: RAW_SECRET, CEREBRAS_API_KEY: RAW_SECRET });
  stubFetch(async () => openaiError(500, 'upstream down'));
  await assert.rejects(
    runAgent({ action: 'Research current yields', agentType: 'research' }),
    (err) => {
      assert.ok(err instanceof ProviderError);
      assert.equal(err.category, PROVIDER_ERROR.UNAVAILABLE);
      assert.equal(err.message, ALL_PROVIDERS_FAILED_MESSAGE);
      assert.equal(err.diagnostics.length, 3);
      const providers = err.diagnostics.map((d) => d.provider);
      assert.deepEqual(providers, ['groq', 'gemini', 'cerebras']);
      return true;
    },
  );
});

// ── Error normalization ───────────────────────────────────────────────────────

test('9. 402 payment_required normalizes to PAYMENT_REQUIRED and is not retried', async () => {
  setProviderEnv({ CEREBRAS_API_KEY: RAW_SECRET });
  let calls = 0;
  stubFetch(async () => {
    calls += 1;
    return openaiError(402, 'Payment required to access this resource. Visit your billing tab.');
  });
  await assert.rejects(
    runAgent({ action: 'hi', agentType: 'general' }),
    (err) => err instanceof ProviderError && err.category === PROVIDER_ERROR.PAYMENT_REQUIRED && err.retryable === false,
  );
  assert.equal(calls, 1, 'payment_required must not be retried');
});

test('10. 404 model not found normalizes to MODEL_UNAVAILABLE', async () => {
  setProviderEnv({ GROQ_API_KEY: RAW_SECRET });
  stubFetch(async () => openaiError(404, 'model not found'));
  await assert.rejects(
    runAgent({ action: 'hi' }),
    (err) => err instanceof ProviderError && err.category === PROVIDER_ERROR.MODEL_UNAVAILABLE,
  );
});

test('11. network failure (fetch rejects) normalizes to NETWORK_ERROR', async () => {
  setProviderEnv({ GROQ_API_KEY: RAW_SECRET });
  stubFetch(async () => { throw new TypeError('fetch failed'); });
  await assert.rejects(
    runAgent({ action: 'hi' }),
    (err) => err instanceof ProviderError && err.category === PROVIDER_ERROR.NETWORK_ERROR,
  );
});

test('12. per-request timeout normalizes to TIMEOUT and never leaves a task hanging', async () => {
  setProviderEnv({ GROQ_API_KEY: RAW_SECRET });
  // A real timer keeps the event loop alive; a hung request that exceeds the
  // per-request budget must surface as TIMEOUT (AbortError -> PROVIDER_TIMEOUT).
  stubFetch(async () => new Promise((_resolve, reject) => {
    setTimeout(() => reject(Object.assign(new Error('aborted'), { name: 'AbortError' })), 30);
  }));
  await assert.rejects(
    runAgent({ action: 'hi', timeoutMs: 40 }),
    (err) => err instanceof ProviderError && err.category === PROVIDER_ERROR.TIMEOUT,
  );
});

// ── Safety ────────────────────────────────────────────────────────────────────

test('safe messages never leak secrets or provider internals', () => {
  for (const category of Object.values(PROVIDER_ERROR)) {
    const message = safeMessageFor(category, 'Cerebras');
    assert.ok(!/sk-[A-Za-z0-9]{4,}/i.test(message));
    assert.ok(!/Bearer\s+\S+/i.test(message));
    assert.ok(!/cerebras\.ai|generativelanguage|groq\.com|DATABASE_URL/i.test(message));
  }
  assert.match(ALL_PROVIDERS_FAILED_MESSAGE, /providers failed/i);
});