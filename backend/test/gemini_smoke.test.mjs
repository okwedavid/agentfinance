// gemini_smoke.test.mjs — minimal, bounded, secret-safe Gemini smoke test.
//
// Succeeds only when a real Gemini (gemini-2.5-flash) round-trip completes:
//   request sent -> response received -> parsed -> content verified.
// When the Gemini key is not present the test is skipped (no false failures in
// CI). The key is read from a local file (never printed) so this test can run
// locally without committing any secret.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs';
import { callProvider, getProviderSpec } from '../src/services/llmProvider.js';

const PROMPT = 'Return exactly: GEMINI_SMOKE_TEST_OK';
const KEY_FILE = process.env.SMOKE_KEY_DIR || path.join(os.tmpdir(), 'opencode', 'gemini_key_aq.txt');

function loadKey() {
  try {
    return fs.readFileSync(KEY_FILE, 'utf8').trim() || null;
  } catch {
    return null;
  }
}

test(
  'Gemini smoke: gemini-2.5-flash round-trip returns GEMINI_SMOKE_TEST_OK within bound',
  { timeout: 60_000 },
  async (t) => {
    const key = loadKey();
    if (!key) {
      process.env.GEMINI_API_KEY = process.env.GEMINI_API_KEY || '';
      t.skip(`Gemini key file not found (${KEY_FILE}); skipping Gemini smoke test.`);
      return;
    }
    const hadKey = process.env.GEMINI_API_KEY;
    process.env.GEMINI_API_KEY = key;
    try {
      const spec = getProviderSpec('gemini');
      assert.equal(spec.defaultModel, 'gemini-2.5-flash');
      const startedAt = Date.now();
      const { content, provider, model } = await callProvider(
        spec,
        [{ role: 'user', content: PROMPT }],
        { useTools: false, timeoutMs: 30_000 },
      );
      const durationMs = Date.now() - startedAt;

      assert.equal(typeof content, 'string', 'response content must be a string');
      assert.match(content, /GEMINI_SMOKE_TEST_OK/, `expected marker in response, got: ${String(content).slice(0, 200)}`);
      assert.equal(provider, 'Gemini');
      console.log(`[GeminiSmoke] ok provider=${provider} model=${model} duration=${durationMs}ms`);
    } finally {
      if (hadKey) process.env.GEMINI_API_KEY = hadKey; else delete process.env.GEMINI_API_KEY;
    }
  },
);