import { test } from 'node:test';
import assert from 'node:assert/strict';

import prisma from '../src/prismaClient.js';
import { runAgent } from '../src/agents/agentRunner.js';
import { executeAgentTask } from '../src/services/agentService.js';
import { ProviderError, PROVIDER_ERROR, safeMessageFor } from '../src/services/llmProvider.js';

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

function setProviderEnv(extra = {}) {
  const defaults = {
    GROQ_API_KEY: RAW_SECRET,
    ANTHROPIC_API_KEY: RAW_SECRET,
    OPENROUTER_API_KEY: RAW_SECRET,
    AGENT_TASK_TIMEOUT_MS: '5000',
    AGENT_PROVIDER_RETRIES: '2',
  };
  Object.assign(process.env, defaults, extra);
}

function clearProviderEnv() {
  for (const key of [
    'GROQ_API_KEY', 'ANTHROPIC_API_KEY', 'OPENROUTER_API_KEY', 'TOGETHER_API_KEY',
    'MISTRAL_API_KEY', 'CEREBRAS_API_KEY', 'GOOGLE_AI_API_KEY',
    'LLM_PROVIDER', 'LLM_FALLBACK_PROVIDER', 'LLM_MODEL', 'LLM_FALLBACK_MODEL',
    'AGENT_TASK_TIMEOUT_MS', 'AGENT_PROVIDER_RETRIES',
    'GROQ_MODEL', 'ANTHROPIC_MODEL', 'GOOGLE_AI_MODEL',
  ]) {
    delete process.env[key];
  }
}

function jsonResponse(body, status = 200) {
  return { ok: status >= 200 && status < 300, status, json: async () => body, text: async () => JSON.stringify(body) };
}

function openaiResult(content) {
  return jsonResponse({ choices: [{ message: { content } }], model: 'groq-test' });
}

function openaiError(status, message) {
  return { ok: false, status, json: async () => ({ error: { message } }), text: async () => message };
}

function anthropicResult(content) {
  return jsonResponse({ content: [{ text: content }], model: 'claude-test' });
}

// ── Prisma stubs ──────────────────────────────────────────────────────────────

function stashPrisma() {
  return { task: prisma.task, user: prisma.user, authSession: prisma.authSession };
}

function restorePrisma(stash) {
  prisma.task = stash.task;
  prisma.user = stash.user;
  prisma.authSession = stash.authSession;
}

function mockTaskDb({ status = 'pending' } = {}) {
  const updates = [];
  prisma.task = {
    findUnique: async () => ({ id: 't1', action: 'Test action', status, userId: 'u1' }),
    update: async ({ where, data }) => {
      const updated = { id: where.id, action: 'Test action', status: data.status, startedAt: new Date(), ...data };
      updates.push(updated);
      return updated;
    },
    findMany: async () => [],
  };
  prisma.user = { findUnique: async () => ({ id: 'u1', preferredNetwork: 'ethereum', walletProfiles: {}, walletAddress: null }) };
  return updates;
}

function makePublisher() {
  const events = [];
  const publish = (type, data) => events.push({ type, data });
  return { publish, events };
}

test.beforeEach(() => {
  clearProviderEnv();
});

test.afterEach(() => {
  clearProviderEnv();
  restoreFetch();
});

// ── PROVIDER ─────────────────────────────────────────────────────────────────

test('1. primary provider successful request returns normalized output', async () => {
  setProviderEnv({ LLM_PROVIDER: 'groq' });
  stubFetch(async () => openaiResult('BTC demand is currently strong.'));
  const result = await runAgent({ action: 'Research Bitcoin', agentType: 'research' });
  assert.equal(result.success, true);
  assert.match(result.output, /BTC demand/);
  assert.equal(result.provider, 'Groq');
});

test('2. invalid credentials produce a normalized AUTH error without raw secrets', async () => {
  setProviderEnv({ LLM_PROVIDER: 'groq', AGENT_PROVIDER_RETRIES: '3' });
  stubFetch(async () => openaiError(401, 'invalid api key'));
  await assert.rejects(
    runAgent({ action: 'hi', agentType: 'coordinator' }),
    (err) => {
      assert.ok(err instanceof ProviderError);
      assert.equal(err.category, PROVIDER_ERROR.AUTH);
      assert.equal(err.retryable, false);
      assert.match(err.message, /could not authenticate/);
      assert.ok(!err.message.includes(RAW_SECRET));
      assert.ok(!err.message.includes('invalid api key'));
      return true;
    },
  );
});

test('3. unsupported model produces a CONFIGURATION error', async () => {
  setProviderEnv({ LLM_PROVIDER: 'groq', GROQ_MODEL: 'model-does-not-exist' });
  stubFetch(async () => openaiError(404, 'model not found'));
  await assert.rejects(
    runAgent({ action: 'hi' }),
    (err) => err instanceof ProviderError && err.category === PROVIDER_ERROR.CONFIGURATION,
  );
});

test('4. transient provider failure (429) is retried and then succeeds', async () => {
  setProviderEnv({ LLM_PROVIDER: 'groq' });
  let calls = 0;
  stubFetch(async () => {
    calls += 1;
    return calls === 1 ? openaiError(429, 'rate limit exceeded') : openaiResult('Retried and succeeded.');
  });
  const result = await runAgent({ action: 'hi' });
  assert.equal(result.success, true);
  assert.match(result.output, /Retried and succeeded/);
  assert.ok(calls >= 2, `expected >=2 fetch calls, got ${calls}`);
});

test('5. permanent provider failure (401) is NOT retried endlessly', async () => {
  setProviderEnv({ LLM_PROVIDER: 'groq', AGENT_PROVIDER_RETRIES: '3' });
  let calls = 0;
  stubFetch(async () => {
    calls += 1;
    return openaiError(401, 'nope');
  });
  await assert.rejects(runAgent({ action: 'hi' }), (err) => err.category === PROVIDER_ERROR.AUTH);
  assert.equal(calls, 1, 'auth errors must not be retried');
});

test('6. fallback provider is attempted when the primary fails', async () => {
  setProviderEnv({ LLM_PROVIDER: 'groq', LLM_FALLBACK_PROVIDER: 'anthropic', AGENT_PROVIDER_RETRIES: '1' });
  stubFetch(async (url) => {
    if (String(url).includes('api.anthropic.com')) return anthropicResult('Anthropic fallback worked.');
    return openaiError(429, 'groq rate limited');
  });
  const result = await runAgent({ action: 'hi' });
  assert.equal(result.success, true);
  assert.equal(result.provider, 'Anthropic');
  assert.match(result.output, /Anthropic fallback/);
});

test('no provider configured fails fast with a safe configuration message', async () => {
  clearProviderEnv();
  await assert.rejects(
    runAgent({ action: 'hi' }),
    (err) => err instanceof ProviderError && err.category === PROVIDER_ERROR.CONFIGURATION && /No AI provider is configured/.test(err.message),
  );
});

// ── TIMEOUT ──────────────────────────────────────────────────────────────────

test('7/8. hanging provider request times out and never leaves the task RUNNING', async () => {
  setProviderEnv({ LLM_PROVIDER: 'groq' });
  const signals = [];
  stubFetch(async (_url, opts = {}) => new Promise((_resolve, reject) => {
    signals.push(opts.signal);
    opts.signal?.addEventListener('abort', () => reject(Object.assign(new Error('aborted'), { name: 'AbortError' })));
  }));

  const stash = stashPrisma();
  let updates;
  try {
    updates = mockTaskDb();
    const { publish, events } = makePublisher();
    const outcome = await executeAgentTask({ taskId: 't1', action: 'Research Bitcoin', userId: 'u1', timeoutMs: 40, publish });

    assert.equal(outcome.status, 'failed');
    const final = updates[updates.length - 1];
    assert.equal(final.status, 'failed', 'task must reach a terminal state');
    assert.notEqual(final.status, 'running');
    const result = JSON.parse(final.result);
    assert.equal(result.failureType, PROVIDER_ERROR.TIMEOUT);
    assert.match(result.error, /timed out/);
    assert.ok(events.some((e) => e.type === 'task:failed'), 'task:failed must be emitted');
    assert.ok(signals.length && signals[0]?.aborted === true, 'provider request must be aborted on timeout');
  } finally {
    restorePrisma(stash);
  }
});

// ── TASK ─────────────────────────────────────────────────────────────────────

test('11/14. successful AI task becomes COMPLETED and its result is persisted', async () => {
  setProviderEnv({ LLM_PROVIDER: 'groq' });
  stubFetch(async () => openaiResult('Bitcoin key factors: adoption, halving, macro rates.'));

  const stash = stashPrisma();
  try {
    const updates = mockTaskDb();
    const { publish, events } = makePublisher();
    const outcome = await executeAgentTask({ taskId: 't1', action: 'Research Bitcoin', userId: 'u1', publish });
    assert.equal(outcome.status, 'completed');

    const final = updates[updates.length - 1];
    assert.equal(final.status, 'completed');
    const result = JSON.parse(final.result);
    assert.match(result.output, /Bitcoin key factors/);
    assert.equal(result.provider, 'Groq');
    assert.ok(result.summary, 'summary should be persisted');

    const types = events.map((e) => e.type);
    const runningIdx = types.indexOf('task:running');
    const completedIdx = types.indexOf('task:completed');
    assert.ok(runningIdx !== -1 && completedIdx !== -1);
    assert.ok(runningIdx < completedIdx, 'running must precede completed');
    assert.equal(events[completedIdx].data.result.output.split(' ')[0], 'Bitcoin');
  } finally {
    restorePrisma(stash);
  }
});

test('12/13/20. failed AI task becomes FAILED with a safe, provider error surfaced to frontend', async () => {
  setProviderEnv({ LLM_PROVIDER: 'groq' });
  stubFetch(async () => openaiError(401, 'invalid api key sk_live_hunter2'));

  const stash = stashPrisma();
  try {
    const updates = mockTaskDb();
    const { publish, events } = makePublisher();
    const outcome = await executeAgentTask({ taskId: 't1', action: 'Analyze Ethereum', userId: 'u1', publish });
    assert.equal(outcome.status, 'failed');

    const final = updates[updates.length - 1];
    const result = JSON.parse(final.result);
    assert.equal(result.failureType, PROVIDER_ERROR.AUTH);
    assert.match(result.error, /could not authenticate/);
    assert.ok(!result.error.includes('sk_live'), 'raw key material must never surface');
    assert.ok(!result.error.includes('invalid api key'));

    const failEvent = events.find((e) => e.type === 'task:failed');
    assert.ok(failEvent, 'task:failed must reach the frontend');
    assert.match(failEvent.data.error, /could not authenticate/);
  } finally {
    restorePrisma(stash);
  }
});

test('safeMessageFor never leaks provider internals', () => {
  for (const category of Object.values(PROVIDER_ERROR)) {
    const message = safeMessageFor(category, 'Groq');
    assert.ok(typeof message === 'string' && message.length > 0);
    assert.ok(!/sk-[A-Za-z0-9]{4,}/i.test(message));
    assert.ok(!/Bearer\s+\S+/i.test(message));
    assert.ok(!/DATABASE_URL|REDIS_URL/i.test(message));
    assert.ok(!/googleapis|api\.groq\.com|api\.anthropic\.com/i.test(message));
  }
});

// ── COORDINATOR ──────────────────────────────────────────────────────────────

test('15. multi-agent (coordinator) task completes via the reliable pipeline', async () => {
  setProviderEnv({ LLM_PROVIDER: 'groq' });
  stubFetch(async () => openaiResult('Coordinated report: combine research agents, then finalize.'));

  const stash = stashPrisma();
  try {
    const updates = mockTaskDb();
    const outcome = await executeAgentTask({
      taskId: 't1',
      action: 'Coordinate the available agents to research BTC and produce a concise report.',
      userId: 'u1',
    });
    assert.equal(outcome.status, 'completed');
    assert.equal(updates[updates.length - 1].status, 'completed');
  } finally {
    restorePrisma(stash);
  }
});

test('16. a failing sub-agent/provider does not permanently block the coordinator', async () => {
  setProviderEnv({ LLM_PROVIDER: 'groq', AGENT_PROVIDER_RETRIES: '1' });
  stubFetch(async () => openaiError(503, 'upstream down'));

  const stash = stashPrisma();
  try {
    const updates = mockTaskDb();
    const outcome = await executeAgentTask({
      taskId: 't1',
      action: 'Coordinate the available agents to research BTC and produce a concise report.',
      userId: 'u1',
    });
    assert.equal(outcome.status, 'failed');
    assert.equal(updates[updates.length - 1].status, 'failed', 'coordinator task must not stay stuck');
  } finally {
    restorePrisma(stash);
  }
});

test('17. coordinator task timeout is handled', async () => {
  setProviderEnv({ LLM_PROVIDER: 'groq', AGENT_PROVIDER_RETRIES: '1' });
  stubFetch(async (_url, opts = {}) => new Promise((_resolve, reject) => {
    opts.signal?.addEventListener('abort', () => reject(Object.assign(new Error('aborted'), { name: 'AbortError' })));
  }));

  const stash = stashPrisma();
  try {
    const updates = mockTaskDb();
    const outcome = await executeAgentTask({
      taskId: 't1',
      action: 'Coordinate the available agents to research BTC and produce a concise report.',
      userId: 'u1',
      timeoutMs: 30,
    });
    assert.equal(outcome.status, 'failed');
    const result = JSON.parse(updates[updates.length - 1].result);
    assert.equal(result.failureType, PROVIDER_ERROR.TIMEOUT);
  } finally {
    restorePrisma(stash);
  }
});

// ── REAL-TIME ────────────────────────────────────────────────────────────────

test('18/19. running → completed state changes are emitted with result data', async () => {
  setProviderEnv({ LLM_PROVIDER: 'groq' });
  stubFetch(async () => openaiResult('Market overview complete.'));

  const stash = stashPrisma();
  try {
    mockTaskDb();
    const { publish, events } = makePublisher();
    await executeAgentTask({ taskId: 't1', action: 'Research Ethereum', userId: 'u1', publish });

    const map = Object.fromEntries(events.map((e) => [e.type, e.data]));
    assert.equal(map['task:running'].status, 'running');
    assert.equal(map['task:completed'].status, 'completed');
    assert.match(map['task:completed'].result.output, /Market overview/);
  } finally {
    restorePrisma(stash);
  }
});

test('already-terminal tasks are not re-executed', async () => {
  setProviderEnv({ LLM_PROVIDER: 'groq' });
  const stash = stashPrisma();
  try {
    mockTaskDb({ status: 'completed' });
    const events = [];
    const outcome = await executeAgentTask({ taskId: 't1', action: 'x', userId: 'u1', publish: (_t, d) => events.push(d) });
    assert.equal(outcome.status, 'completed');
    assert.equal(events.length, 0);
  } finally {
    restorePrisma(stash);
  }
});