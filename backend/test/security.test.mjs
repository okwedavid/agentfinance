import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  ROLE_USER,
  ROLE_ADMIN,
  normalizeRole,
  isAdminRole,
  defaultRole,
  sanitizeRoleFromRecord,
  validateUsername,
  validateEmail,
  validatePassword,
  serializeUser,
  getMaxPayoutAmount,
  validatePayoutAmount,
  welcomeGreeting,
} from '../src/utils/security.js';

test('normalizeRole maps unknown values to USER and never to a fake role', () => {
  assert.equal(normalizeRole('ADMIN'), ROLE_ADMIN);
  assert.equal(normalizeRole('USER'), ROLE_USER);
  assert.equal(normalizeRole('admin'), ROLE_USER);
  assert.equal(normalizeRole('OWNER'), ROLE_USER);
  assert.equal(normalizeRole(''), ROLE_USER);
  assert.equal(normalizeRole(undefined), ROLE_USER);
  assert.equal(normalizeRole(null), ROLE_USER);
  assert.equal(defaultRole(), ROLE_USER);
});

test('isAdminRole only accepts the exact ADMIN constant', () => {
  assert.equal(isAdminRole(ROLE_ADMIN), true);
  assert.equal(isAdminRole('admin'), false);
  assert.equal(isAdminRole(ROLE_USER), false);
  assert.equal(isAdminRole(undefined), false);
});

test('sanitizeRoleFromRecord never promotes untrusted roles', () => {
  assert.equal(sanitizeRoleFromRecord({ role: 'ADMIN' }), ROLE_ADMIN);
  assert.equal(sanitizeRoleFromRecord({ role: 'OWNER' }), ROLE_USER);
  assert.equal(sanitizeRoleFromRecord({}), ROLE_USER);
  assert.equal(sanitizeRoleFromRecord({ role: 'admin' }), ROLE_USER);
});

test('validateUsername accepts valid usernames and rejects everything else', () => {
  assert.equal(validateUsername('okwedavid'), null);
  assert.equal(validateUsername('a1_b2_c3'), null);
  assert.equal(validateUsername('ab'), 'Username must be 3-32 characters using letters, numbers and underscores.');
  assert.equal(validateUsername('x'.repeat(33)), 'Username must be 3-32 characters using letters, numbers and underscores.');
  assert.equal(validateUsername('has space'), 'Username must be 3-32 characters using letters, numbers and underscores.');
  assert.equal(validateUsername('email@user.com'), 'Username must be 3-32 characters using letters, numbers and underscores.');
  assert.equal(validateUsername(undefined), 'Username must be 3-32 characters using letters, numbers and underscores.');
});

test('validateEmail accepts a valid email and rejects invalid ones, but stays optional', () => {
  assert.equal(validateEmail('user@example.com'), null);
  assert.equal(validateEmail('') , 'Enter a valid email address.'); // empty string != missing
  assert.equal(validateEmail(undefined), null);
  assert.equal(validateEmail(null), null);
  assert.equal(validateEmail('not-an-email'), 'Enter a valid email address.');
  assert.equal(validateEmail('user@@example.com'), 'Enter a valid email address.');
});

test('validatePassword enforces a minimum length of 8', () => {
  assert.equal(validatePassword('12345678'), null);
  assert.equal(validatePassword('password'), null);
  assert.equal(validatePassword('1234567'), 'Password must be at least 8 characters long.');
  assert.equal(validatePassword(undefined), 'Password must be at least 8 characters long.');
});

test('serializeUser exposes role, isAdmin and isNewUser without internal fields', () => {
  const user = {
    id: 'u1',
    username: 'bob',
    email: 'bob@example.com',
    role: ROLE_ADMIN,
    passwordHash: 'should-not-leak',
  };
  const serialized = serializeUser(user, { isNewUser: true });
  assert.equal(serialized.id, 'u1');
  assert.equal(serialized.username, 'bob');
  assert.equal(serialized.role, ROLE_ADMIN);
  assert.equal(serialized.isAdmin, true);
  assert.equal(serialized.isNewUser, true);
  assert.equal('passwordHash' in serialized, false);

  const normal = serializeUser({ id: 'u2', username: 'carol', role: ROLE_USER }, { isNewUser: false });
  assert.equal(normal.role, ROLE_USER);
  assert.equal(normal.isAdmin, false);
  assert.equal(normal.isNewUser, false);
});

test('validatePayoutAmount enforces a positive amount capped at MAX_PAYOUT_AMOUNT (default 100)', () => {
  const cap = getMaxPayoutAmount();
  assert.equal(cap, 100);

  assert.deepEqual(validatePayoutAmount(50), { ok: true, amount: 50 });
  assert.deepEqual(validatePayoutAmount('12.5'), { ok: true, amount: 12.5 });
  assert.equal(validatePayoutAmount(0).ok, false);
  assert.equal(validatePayoutAmount(-5).ok, false);
  assert.equal(validatePayoutAmount('abc').ok, false);
  assert.equal(validatePayoutAmount(101).ok, false);
  assert.equal(validatePayoutAmount(100).ok, true);
  assert.equal(validatePayoutAmount(undefined).ok, false);
});

test('welcomeGreeting branches on isNewUser and falls back to a safe name', () => {
  assert.equal(welcomeGreeting({ isNewUser: true, name: 'bob' }), 'Welcome bob');
  assert.equal(welcomeGreeting({ isNewUser: false, name: 'bob' }), 'Welcome back bob');
  assert.equal(welcomeGreeting({ isNewUser: true, name: '' }), 'Welcome operator');
});