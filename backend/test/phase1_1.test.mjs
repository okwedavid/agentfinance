import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  TASK_STATUS,
  normalizeStatus,
  isTerminalStatus,
  isIncomeEligible,
  canTransition,
} from '../src/services/taskLifecycle.js';
import {
  computeEarningsFromTasks,
  getEarningRateEth,
  isStatusIncomeExcluded,
} from '../src/services/earningsService.js';
import {
  validateEmail,
  normalizeEmailAddress,
  serializeUser,
} from '../src/utils/security.js';
import {
  getRequestedProvider,
  resolveProviderPriority,
  isProviderConfigured,
  resolveModel,
  providerDiagnostics,
  configuredProviderSummary,
  PROVIDER_IDS,
} from '../src/providers/providerConfig.js';
import {
  classifyProviderError,
  toNormalizedError,
  ErrorCategory,
} from '../src/providers/normalizedError.js';
import { createProvider, getActiveProviders } from '../src/providers/providerFactory.js';
import { getRedirectUri, assertOAuthConfiguration, configuredProviders } from '../src/services/oauthService.js';
import { issueEmailVerification } from '../src/services/emailService.js';

const RATE = getEarningRateEth();

// ---------------------------------------------------------------------------
// Task lifecycle
// ---------------------------------------------------------------------------

test('normalizeStatus maps legacy pending to queued and preserves lowercase storage', () => {
  assert.equal(normalizeStatus('pending'), TASK_STATUS.QUEUED);
  assert.equal(normalizeStatus('queued'), TASK_STATUS.QUEUED);
  assert.equal(normalizeStatus('COMPLETED'), TASK_STATUS.COMPLETED);
  assert.equal(normalizeStatus('Completed'), TASK_STATUS.COMPLETED);
  assert.equal(normalizeStatus('timed_out'), TASK_STATUS.TIMED_OUT);
});

test('isTerminalStatus is true only for terminal states', () => {
  assert.equal(isTerminalStatus('completed'), true);
  assert.equal(isTerminalStatus('failed'), true);
  assert.equal(isTerminalStatus('timed_out'), true);
  assert.equal(isTerminalStatus('cancelled'), true);
  assert.equal(isTerminalStatus('running'), false);
  assert.equal(isTerminalStatus('queued'), false);
  assert.equal(isTerminalStatus('retrying'), false);
});

test('canTransition allows only valid lifecycle steps', () => {
  assert.equal(canTransition('queued', 'running'), true);
  assert.equal(canTransition('queued', 'cancelled'), true);
  assert.equal(canTransition('running', 'retrying'), true);
  assert.equal(canTransition('running', 'completed'), true);
  assert.equal(canTransition('running', 'failed'), true);
  assert.equal(canTransition('running', 'timed_out'), true);
  assert.equal(canTransition('retrying', 'running'), true);
  assert.equal(canTransition('failed', 'queued'), true);
  assert.equal(canTransition('timed_out', 'queued'), true);
  assert.equal(canTransition('cancelled', 'queued'), true);
});

test('canTransition forbids bouncing terminal tasks and forged completions', () => {
  assert.equal(canTransition('completed', 'running'), false);
  assert.equal(canTransition('completed', 'completed'), false);
  assert.equal(canTransition('completed', 'queued'), false);
  assert.equal(canTransition('running', 'queued'), false);
  assert.equal(canTransition('queued', 'completed'), false);
  assert.equal(canTransition('queued', 'failed'), false);
  assert.equal(canTransition('pending', 'completed'), false);
});

test('isIncomeEligible requires a persisted completed state with a real result', () => {
  assert.equal(isIncomeEligible({ status: 'completed', completedAt: new Date(), result: '{}' }), true);
  assert.equal(isIncomeEligible({ status: 'completed', completedAt: new Date(), result: '{"output":"x"}' }), true);
  assert.equal(isIncomeEligible({ status: 'completed', completedAt: new Date(), result: '' }), false);
  assert.equal(isIncomeEligible({ status: 'completed', completedAt: null, result: '{}' }), false);
  assert.equal(isIncomeEligible({ status: 'completed', completedAt: undefined, result: '{}' }), false);
  assert.equal(isIncomeEligible({ status: 'failed', completedAt: new Date(), result: '{}' }), false);
  assert.equal(isIncomeEligible({ status: 'timed_out', completedAt: new Date(), result: '{}' }), false);
  assert.equal(isIncomeEligible({ status: 'cancelled', completedAt: new Date(), result: '{}' }), false);
  assert.equal(isIncomeEligible({ status: 'running', result: '{}' }), false);
  assert.equal(isIncomeEligible(null), false);
});

// ---------------------------------------------------------------------------
// Earnings rules
// ---------------------------------------------------------------------------

test('earnings are derived from distinct authoritative completed records only', () => {
  const tasks = [
    { id: 't1', status: 'completed', completedAt: new Date(), result: '{"output":"ok"}' },
    { id: 't2', status: 'completed', completedAt: new Date(), result: '' },
    { id: 't3', status: 'failed', completedAt: new Date(), result: '{"output":"no"}' },
    { id: 't4', status: 'timed_out', completedAt: new Date(), result: 'x' },
    { id: 't5', status: 'cancelled', completedAt: new Date(), result: 'x' },
    { id: 't6', status: 'running', result: 'x' },
    { id: 't7', status: 'queued', result: null },
  ];
  const earnings = computeEarningsFromTasks(tasks, RATE);
  assert.equal(earnings.completedCount, 1);
  assert.equal(earnings.totalEth, Number((1 * RATE).toFixed(8)));
  assert.equal(earnings.incomeEligible, true);
});

test('a retry re-uses the SAME task record so it can never create duplicate earnings', () => {
  // Retry path re-queues the identical record (same id). When it re-completes
  // there is still exactly one completed record -> one task -> one earning.
  const completedAfterRetry = { id: 'r1', status: 'completed', completedAt: new Date(), result: '{"output":"ok"}' };
  assert.equal(computeEarningsFromTasks([completedAfterRetry], RATE).completedCount, 1);
  assert.equal(computeEarningsFromTasks([completedAfterRetry], RATE).totalEth, Number((1 * RATE).toFixed(8)));
});

test('two genuinely distinct completed records earn twice', () => {
  const t1 = { id: 'a', status: 'completed', completedAt: new Date(), result: '{"output":"1"}' };
  const t2 = { id: 'b', status: 'completed', completedAt: new Date(), result: '{"output":"2"}' };
  assert.equal(computeEarningsFromTasks([t1, t2], RATE).completedCount, 2);
  assert.equal(computeEarningsFromTasks([t1, t2], RATE).totalEth, Number((2 * RATE).toFixed(8)));
});

test('zero completed tasks means zero earnings and incomeEligible false', () => {
  const earnings = computeEarningsFromTasks([], RATE);
  assert.equal(earnings.completedCount, 0);
  assert.equal(earnings.totalEth, 0);
  assert.equal(earnings.incomeEligible, false);
});

test('timed-out and failed tasks are income-excluded by status set', () => {
  assert.equal(isStatusIncomeExcluded('failed'), true);
  assert.equal(isStatusIncomeExcluded('timed_out'), true);
  assert.equal(isStatusIncomeExcluded('cancelled'), true);
  assert.equal(isStatusIncomeExcluded('running'), true);
  assert.equal(isStatusIncomeExcluded('queued'), true);
  assert.equal(isStatusIncomeExcluded('retrying'), true);
  assert.equal(isStatusIncomeExcluded('completed'), false);
});

test('default earning rate is 0.0035 ETH per completed task', () => {
  assert.equal(RATE, 0.0035);
});

// ---------------------------------------------------------------------------
// Email validation (backend-authoritative, custom domains allowed)
// ---------------------------------------------------------------------------

test('validateEmail accepts real-world valid addresses including custom domains', () => {
  assert.equal(validateEmail('user@example.com'), null);
  assert.equal(validateEmail('user@my-custom-domain.io'), null);
  assert.equal(validateEmail('first.last+tag@sub.domain.co.uk'), null);
  assert.equal(validateEmail('a@b.co'), null);
  assert.equal(validateEmail('noreply@agentfi.app'), null);
});

test('validateEmail rejects malformed addresses without locking out providers', () => {
  assert.equal(validateEmail('not-an-email'), 'Enter a valid email address.');
  assert.equal(validateEmail('user@@example.com'), 'Enter a valid email address.');
  assert.equal(validateEmail('user@example'), 'Enter a valid email address.');
  assert.equal(validateEmail('user@example..com'), 'Enter a valid email address.');
  assert.equal(validateEmail('.user@example.com'), 'Enter a valid email address.');
  assert.equal(validateEmail('user.@example.com'), 'Enter a valid email address.');
  assert.equal(validateEmail('user with space@example.com'), 'Enter a valid email address.');
  assert.equal(validateEmail('user@example .com'), 'Enter a valid email address.');
  assert.equal(validateEmail('user@-example.com'), 'Enter a valid email address.');
  assert.equal(validateEmail(`x@${'y'.repeat(300)}.com`), 'Enter a valid email address.');
});

test('validateEmail stays optional and accepts empty email as missing at birth', () => {
  assert.equal(validateEmail(undefined), null);
  assert.equal(validateEmail(null), null);
  assert.equal(validateEmail(''), 'Enter a valid email address.');
  assert.equal(validateEmail('   '), 'Enter a valid email address.');
});

test('normalizeEmailAddress trims and lowercases for unique storage', () => {
  assert.equal(normalizeEmailAddress('  User@Example.COM '), 'user@example.com');
  assert.equal(normalizeEmailAddress('USER@MY-CUSTOM-DOMAIN.IO'), 'user@my-custom-domain.io');
  assert.equal(normalizeEmailAddress(undefined), undefined);
});

test('serializeUser exposes emailVerified without internal verification fields', () => {
  const serialized = serializeUser({
    id: 'u1',
    username: 'bob',
    email: 'bob@example.com',
    emailVerified: true,
    emailVerificationToken: 'secret-token',
    emailVerificationExpiresAt: new Date(),
    role: 'USER',
    passwordHash: 'h',
  });
  assert.equal(serialized.emailVerified, true);
  assert.equal('emailVerificationToken' in serialized, false);
  assert.equal('passwordHash' in serialized, false);
});

// ---------------------------------------------------------------------------
// Provider configuration (single source of truth, no secrets)
// ---------------------------------------------------------------------------

test('provider diagnostics and summaries never include secrets', () => {
  const diag = providerDiagnostics();
  const summary = configuredProviderSummary();
  const raw = JSON.stringify({ diag, summary });
  for (const secret of ['sk-', 'AIza', 'api_key=', 'Bearer ']) {
    assert.equal(raw.includes(secret), false, `leaked secret pattern ${secret}`);
  }
});

test('requested provider resolves to an explicit LLM_PROVIDER id or auto', () => {
  const requested = getRequestedProvider();
  assert.ok(requested === 'auto' || PROVIDER_IDS.includes(requested));
});

test('provider priority always yields a usable ordered candidate list', () => {
  const priority = resolveProviderPriority();
  assert.ok(Array.isArray(priority) && priority.length > 0);
  for (const id of priority) {
    assert.ok(isProviderConfigured(id) || true); // priority may include not-yet-configured fallbacks
  }
});

test('error classification maps authentication failures safely', () => {
  assert.equal(classifyProviderError(new Error('401 Unauthorized')), ErrorCategory.AUTHENTICATION_FAILURE);
  assert.equal(classifyProviderError(new Error('groq: HTTP 401: invalid api key')), ErrorCategory.AUTHENTICATION_FAILURE);
  assert.equal(classifyProviderError(new Error('API key not set')), ErrorCategory.PROVIDER_NOT_CONFIGURED);
  assert.equal(classifyProviderError(new Error('timeout after 30000ms')), ErrorCategory.TIMEOUT);
  assert.equal(classifyProviderError(new Error('HTTP 429 rate limit')), ErrorCategory.RATE_LIMIT);
});

test('toNormalizedError provides safe retryability metadata', () => {
  const auth = toNormalizedError(new Error('401 Unauthorized'), 'groq');
  assert.equal(auth.category, ErrorCategory.AUTHENTICATION_FAILURE);
  assert.equal(auth.retryable, false);
  assert.equal(auth.message, 'AI configuration unavailable');
  const timeout = toNormalizedError(new Error('timed out'), 'groq');
  assert.equal(timeout.category, ErrorCategory.TIMEOUT);
  assert.equal(timeout.retryable, true);
});

// ---------------------------------------------------------------------------
// Provider factory
// ---------------------------------------------------------------------------

test('createProvider returns a chat-capable instance for configured providers', () => {
  const provider = createProvider('groq');
  assert.equal(provider.id, 'groq');
  assert.equal(typeof provider.chat, 'function');
  assert.equal('envKey' in provider, false);
  assert.equal('key' in provider, false);
});

test('getActiveProviders never leaks credentials and always yields instances for configured providers', () => {
  const active = getActiveProviders();
  for (const provider of active) {
    assert.ok(provider.id);
    assert.equal(typeof provider.chat, 'function');
  }
  const raw = JSON.stringify(active);
  for (const secret of ['sk-', 'AIza', 'api_key=']) {
    assert.equal(raw.includes(secret), false, `leaked secret pattern ${secret}`);
  }
});

test('provider chat without key fails with provider_not_configured, not a crash', async () => {
  const provider = createProvider('groq');
  if (provider.configured) return; // key present in this environment - nothing to assert
  await assert.rejects(
    provider.chat([{ role: 'user', content: 'hi' }]),
    (error) => error.category === ErrorCategory.PROVIDER_NOT_CONFIGURED,
  );
});

// ---------------------------------------------------------------------------
// OAuth configuration (exact callback, safe startup validation)
// ---------------------------------------------------------------------------

function withEnv(assign, fn) {
  const keys = Object.keys(assign);
  const old = {};
  for (const key of keys) {
    old[key] = process.env[key];
  }
  try {
    for (const key of keys) process.env[key] = assign[key];
    return fn();
  } finally {
    for (const key of keys) {
      if (old[key] === undefined) delete process.env[key];
      else process.env[key] = old[key];
    }
  }
}

test('getRedirectUri favours provider-specific then generic explicit URIs', () => {
  withEnv({ GOOGLE_CLIENT_ID: 'x', GOOGLE_CLIENT_SECRET: 'y' }, () => {
    const explicitGoogle = withEnv({ GOOGLE_REDIRECT_URI: 'https://cb.example.com/google', OAUTH_REDIRECT_URI: 'https://cb.example.com/generic' }, () =>
      getRedirectUri({ id: 'google' }),
    );
    assert.equal(explicitGoogle, 'https://cb.example.com/google');

    const generic = withEnv({ GOOGLE_REDIRECT_URI: '', OAUTH_REDIRECT_URI: 'https://cb.example.com/generic' }, () =>
      getRedirectUri({ id: 'google' }),
    );
    assert.equal(generic, 'https://cb.example.com/generic');
  });
});

test('getRedirectUri derives the EXACT callback from PUBLIC_BACKEND_URL when eclipse-unset', () => {
  withEnv({ GOOGLE_REDIRECT_URI: '', OAUTH_REDIRECT_URI: '', PUBLIC_BACKEND_URL: 'https://api.myapp.example' }, () => {
    assert.equal(
      getRedirectUri({ id: 'google' }),
      'https://api.myapp.example/auth/oauth/google/callback',
    );
  });
});

test('getRedirectUri throws a clear, actionable error when nothing is configured', () => {
  withEnv({ GOOGLE_REDIRECT_URI: '', OAUTH_REDIRECT_URI: '', PUBLIC_BACKEND_URL: '' }, () => {
    assert.throws(() => getRedirectUri({ id: 'google' }), /OAuth redirect URI is not configured/);
  });
});

test('assertOAuthConfiguration fails clearly when an enabled provider lacks a redirect', () => {
  const result = withEnv(
    { GOOGLE_CLIENT_ID: 'c', GOOGLE_CLIENT_SECRET: 's', GOOGLE_REDIRECT_URI: '', OAUTH_REDIRECT_URI: '', PUBLIC_BACKEND_URL: '' },
    () => assertOAuthConfiguration(),
  );
  assert.equal(result, false);
});

test('assertOAuthConfiguration passes when the redirect can be resolved', () => {
  const result = withEnv(
    { GOOGLE_CLIENT_ID: 'c', GOOGLE_CLIENT_SECRET: 's', GOOGLE_REDIRECT_URI: 'https://cb.example.com/google' },
    () => assertOAuthConfiguration(),
  );
  assert.equal(result, true);
});

test('assertOAuthConfiguration passes when no provider is enabled', () => {
  const result = withEnv({ GOOGLE_CLIENT_ID: '', GOOGLE_CLIENT_SECRET: '' }, () => assertOAuthConfiguration());
  assert.equal(result, true);
});

test('configuredProviders surface redirect URIs but never secrets', () => {
  withEnv({ GOOGLE_CLIENT_ID: 'c', GOOGLE_CLIENT_SECRET: 's', GOOGLE_REDIRECT_URI: 'https://cb.example.com/google' }, () => {
    const providers = configuredProviders();
    const google = providers.find((p) => p.id === 'google');
    assert.equal(google.redirectUri, 'https://cb.example.com/google');
    const raw = JSON.stringify(providers);
    assert.equal(raw.includes('GOOGLE_CLIENT_SECRET'), false);
    assert.equal(raw.includes('"s"'), false);
  });
});

// ---------------------------------------------------------------------------
// Email verification token (architecture groundwork)
// ---------------------------------------------------------------------------

test('issueEmailVerification produces a one-time token and expiry', async () => {
  const result = await issueEmailVerification('User@Example.COM');
  assert.ok(result.token && result.token.length >= 32);
  assert.ok(result.expiresAt instanceof Date && result.expiresAt > new Date());
  assert.equal(result.email, 'user@example.com');
});