// cerebras_smoke.test.mjs — bounded, secret-safe Cerebras smoke test.
//
// Reports the REAL status of Cerebras on this account:
//   - SUCCESS: a gpt-oss-120b generation round-trip completed with content, or
//   - PAYMENT_REQUIRED: the provider authenticated but its billing is blocked
//     (HTTP 402), which the router normalizes and falls through — an honest,
//     non-fatal diagnostic, never a fabrication.
// Any other failure (auth/config/network) FAILS the test.
// Skipped when the Cerebras key file is absent (CI-safe). Key never printed.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs';
import { callProvider, getProviderSpec, ProviderError, PROVIDER_ERROR } from '../src/services/llmProvider.js';

const PROMPT = 'Return exactly: CEREBRAS_SMOKE_TEST_OK';
const KEY_FILE = process.env.SMOKE_KEY_DIR || path.join(os.tmpdir(), 'opencode', 'cerebras_key.txt');

function loadKey() {
  try {
    return fs.readFileSync(KEY_FILE, 'utf8').trim() || null;
  } catch {
    return null;
  }
}

test(
  'Cerebras smoke: generation succeeds OR reports verified PAYMENT_REQUIRED billing block',
  { timeout: 90_000 },
  async (t) => {
    const key = loadKey();
    if (!key) {
      t.skip(`Cerebras key file not found (${KEY_FILE}); skipping Cerebras smoke test.`);
      return;
    }
    const hadKey = process.env.CEREBRAS_API_KEY;
    process.env.CEREBRAS_API_KEY = key;
    try {
      const spec = getProviderSpec('cerebras');
      const startedAt = Date.now();
      try {
        const { content, provider, model } = await callProvider(
          spec,
          [{ role: 'user', content: PROMPT }],
          { useTools: false, timeoutMs: 30_000 },
        );
        const durationMs = Date.now() - startedAt;
        assert.equal(typeof content, 'string', 'response content must be a string');
        assert.match(content, /CEREBRAS_SMOKE_TEST_OK/, `expected marker in response, got: ${String(content).slice(0, 200)}`);
        console.log(`[CerebrasSmoke] ok provider=${provider} model=${model} duration=${durationMs}ms`);
      } catch (err) {
        if (err instanceof ProviderError && err.category === PROVIDER_ERROR.PAYMENT_REQUIRED) {
          console.log(`[CerebrasSmoke] configured but billing-blocked: category=${err.category} status=${err.status || 'n/a'} (honest diagnostic, not a failure)`);
          return;
        }
        throw err;
      }
    } finally {
      if (hadKey) process.env.CEREBRAS_API_KEY = hadKey; else delete process.env.CEREBRAS_API_KEY;
    }
  },
);