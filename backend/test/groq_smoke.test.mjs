// groq_smoke.test.mjs — minimal, bounded, secret-safe Groq smoke test.
//
// Succeeds only when a real Groq provider round-trip completes:
//   request sent -> response received -> parsed -> content verified.
// When GROQ_API_KEY is not set the test is skipped (no false failures in CI).
// The key is never printed, and the prompt is a fixed harmless string.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { callProvider, getProviderSpec } from '../src/services/llmProvider.js';

const PROMPT = 'Return exactly: GROQ_SMOKE_TEST_OK';

test(
  'Groq smoke: provider round-trip returns GROQ_SMOKE_TEST_OK within bound',
  { timeout: 35_000 },
  async (t) => {
    const spec = getProviderSpec('groq');
    if (!process.env.GROQ_API_KEY) {
      t.skip('GROQ_API_KEY not set; skipping Groq smoke test.');
      return;
    }
    const startedAt = Date.now();
    const { content, provider, model } = await callProvider(
      spec,
      [{ role: 'user', content: PROMPT }],
      { useTools: false, timeoutMs: 30_000 },
    );
    const durationMs = Date.now() - startedAt;

    assert.equal(typeof content, 'string', 'response content must be a string');
    assert.match(content, /GROQ_SMOKE_TEST_OK/, `expected marker in response, got: ${String(content).slice(0, 200)}`);
    assert.equal(provider, 'Groq');
    console.log(`[GroqSmoke] ok provider=${provider} model=${model} duration=${durationMs}ms`);
  },
);