import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  computeEarningsFromTasks,
  earningRateEth,
  isEligibleTask,
} from '../src/services/earningsService.js';
import { normalizeEmailAddress, serializeUser } from '../src/utils/security.js';
import {
  getEmailProviderStatus,
  issueEmailVerificationToken,
  verifyEmailByToken,
} from '../src/services/emailService.js';

// ── earningsService (pure, no DB) ─────────────────────────────────────────────

test('isEligibleTask requires completed + completedAt + non-empty persisted result', () => {
  assert.equal(isEligibleTask({ status: 'completed', completedAt: new Date(), result: '{"output":"x"}' }), true);
  assert.equal(isEligibleTask({ status: 'completed', completedAt: new Date(), result: '{}' }), true, 'JSON object is a non-empty string');
  assert.equal(isEligibleTask({ status: 'completed', completedAt: new Date(), result: '' }), false);
  assert.equal(isEligibleTask({ status: 'completed', completedAt: new Date(), result: '   ' }), false);
  assert.equal(isEligibleTask({ status: 'completed', completedAt: null, result: '{"output":"x"}' }), false);
  assert.equal(isEligibleTask({ status: 'completed', completedAt: undefined, result: '{"output":"x"}' }), false);
  assert.equal(isEligibleTask({ status: 'failed', completedAt: new Date(), result: '{"error":"boom"}' }), false, 'failed never earns');
  assert.equal(isEligibleTask({ status: 'pending', completedAt: new Date(), result: '{"output":"x"}' }), false);
  assert.equal(isEligibleTask({ status: 'cancelled', completedAt: new Date(), result: '{"output":"x"}' }), false);
  assert.equal(isEligibleTask(null), false);
  assert.equal(isEligibleTask(undefined), false);
});

test('computeEarningsFromTasks counts only eligible completed tasks and computes the ETH total', () => {
  const tasks = [
    { status: 'completed', completedAt: new Date('2026-01-01T00:00:00Z'), result: '{"output":"a"}' },
    { status: 'completed', completedAt: new Date('2026-01-03T00:00:00Z'), result: '{"output":"b"}' },
    { status: 'failed', completedAt: new Date('2026-01-02T00:00:00Z'), result: '{"error":"boom"}' },
    { status: 'completed', completedAt: new Date('2026-01-04T00:00:00Z'), result: '' },
  ];
  const result = computeEarningsFromTasks(tasks, 0.0035);
  assert.equal(result.completedCount, 2);
  assert.equal(result.eligibleCount, 2);
  assert.equal(result.rateEth, 0.0035);
  assert.equal(result.totalEth, 0.007);
  assert.equal(result.totalWei, 7000000000000000);
  assert.equal(result.lastEligibleAt, '2026-01-03T00:00:00.000Z', 'latest eligible completedAt wins');
});

test('computeEarningsFromTasks honours the EARNING_RATE_ETH override and the passed rate', () => {
  const before = process.env.EARNING_RATE_ETH;
  try {
    process.env.EARNING_RATE_ETH = '0.001';
    assert.equal(earningRateEth(), 0.001);
    const tasks = [{ status: 'completed', completedAt: new Date(), result: '{"output":"x"}' }];
    assert.equal(computeEarningsFromTasks(tasks).totalEth, 0.001, 'defaults to env rate');
    assert.equal(computeEarningsFromTasks(tasks, 0.5).totalEth, 0.5, 'explicit rate wins over env');
  } finally {
    if (before === undefined) delete process.env.EARNING_RATE_ETH;
    else process.env.EARNING_RATE_ETH = before;
  }
});

test('computeEarningsFromTasks is safe on empty/unknown input', () => {
  assert.equal(computeEarningsFromTasks(undefined, 0.0035).completedCount, 0);
  assert.equal(computeEarningsFromTasks(null, 0.0035).completedCount, 0);
  assert.equal(computeEarningsFromTasks([], 0.0035).completedCount, 0);
  assert.equal(computeEarningsFromTasks([{ status: 'completed' }], 0.0035).completedCount, 0, 'no completedAt -> ineligible');
});

// ── email: normalize + serializeUser ──────────────────────────────────────────

test('normalizeEmailAddress lowercases and trims, and rejects junk', () => {
  assert.equal(normalizeEmailAddress('  Bob@Example.COM '), 'bob@example.com');
  assert.equal(normalizeEmailAddress('user@custom-domain.io'), 'user@custom-domain.io');
  assert.equal(normalizeEmailAddress(''), null);
  assert.equal(normalizeEmailAddress('   '), null);
  assert.equal(normalizeEmailAddress(undefined), null);
  assert.equal(normalizeEmailAddress(null), null);
  assert.equal(normalizeEmailAddress(42), null);
  assert.equal(normalizeEmailAddress('x'.repeat(400) + '@example.com'), null, 'over-length is refused');
});

test('serializeUser exposes emailVerified and never leaks verification internals', () => {
  const serialized = serializeUser({ id: 'u1', username: 'bob', email: 'bob@example.com', role: 'USER' });
  assert.equal(serialized.emailVerified, false);
  assert.equal(serialized.email, 'bob@example.com');

  const verified = serializeUser({ id: 'u2', username: 'carol', email: 'c@example.com', role: 'USER', emailVerified: true });
  assert.equal(verified.emailVerified, true);
  assert.equal('emailVerificationToken' in verified, false);
  assert.equal('emailVerificationExpiresAt' in verified, false);
});

// ── emailService (no SMTP path) ───────────────────────────────────────────────

test('issueEmailVerificationToken returns a fresh opaque token', () => {
  const a = issueEmailVerificationToken();
  const b = issueEmailVerificationToken();
  assert.equal(a.length, 64);
  assert.notEqual(a, b);
});

test('verifyEmailByToken rejects an empty/missing token without touching the DB', async () => {
  assert.equal((await verifyEmailByToken(undefined)).ok, false);
  assert.equal((await verifyEmailByToken('')).ok, false);
  assert.equal((await verifyEmailByToken('   ')).ok, false);
});

test('getEmailProviderStatus is safe and reflects environment config', () => {
  const before = { host: process.env.SMTP_HOST, user: process.env.SMTP_USER, pass: process.env.SMTP_PASS, from: process.env.SMTP_FROM };
  try {
    delete process.env.SMTP_HOST;
    delete process.env.SMTP_USER;
    delete process.env.SMTP_PASS;
    delete process.env.SMTP_FROM;
    const status = getEmailProviderStatus();
    assert.equal(status.configured, false);
    assert.equal(status.provider, null);
    assert.equal(status.verificationSupported, process.env.NODE_ENV !== 'production');
  } finally {
    if (before.host !== undefined) process.env.SMTP_HOST = before.host;
    if (before.user !== undefined) process.env.SMTP_USER = before.user;
    if (before.pass !== undefined) process.env.SMTP_PASS = before.pass;
    if (before.from !== undefined) process.env.SMTP_FROM = before.from;
  }
});