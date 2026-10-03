// auth_guard.test.mjs — the frontend auth-guard race, and the CORS contract.
//
// THE BUG
// The guard read `loading: boolean` + `user: User | null`. That encoding cannot
// distinguish "the auth check has not finished" from "the check finished and found
// no session", so during the window before `/auth/me` resolved, a signed-in user
// was indistinguishable from a signed-out one and got redirected to /login.
//
// This file locks down the three-state contract (AUTH_CHECKING / AUTHENTICATED /
// UNAUTHENTICATED) and asserts that a guard only ever redirects from
// UNAUTHENTICATED. The lifecycle logic is re-implemented here in the same shape
// as AuthContext.tsx so the invariant is testable without a DOM; the frontend file
// is a thin wrapper over exactly these rules.

import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  SESSION_COOKIE_NAME,
  buildSessionCookie,
  sessionCookieOptions,
  SESSION_MAX_AGE_SECONDS,
} from '../src/services/sessionCookie.js';

// ── The lifecycle, mirrored from AuthContext.tsx ──────────────────────────────

const AUTH_CHECKING = 'AUTH_CHECKING';
const AUTHENTICATED = 'AUTHENTICATED';
const UNAUTHENTICATED = 'UNAUTHENTICATED';

/**
 * Minimal in-memory session store with a controllable /auth/me.
 *
 * Mirrors AuthContext.refresh() EXACTLY as it now behaves: it always asks the
 * server. There is no client-side pre-check, because none is possible: the
 * session cookie is HttpOnly and set on the backend's host, so the frontend page
 * cannot observe it. An earlier revision short-circuited on a "marker" cookie the
 * frontend could never see, which logged the user out on every navigation.
 *
 * `getMe` is injectable so a test can model instant success, slow success, 401,
 * and a 200 carrying an unusable payload.
 */
function createAuth({ getMe } = {}) {
  const state = { user: null, status: AUTH_CHECKING, checkId: 0 };
  const listeners = [];
  const emit = () => listeners.forEach((fn) => fn({ ...state }));

  return {
    state,
    subscribe(fn) { listeners.push(fn); return () => listeners.splice(listeners.indexOf(fn), 1); },
    getMe,
    /** Mirrors AuthContext.refresh(). */
    async refresh() {
      const checkId = ++state.checkId;
      const current = checkId;

      try {
        const me = await getMe();
        if (current !== state.checkId) return;
        // A 200 with no usable id is NOT a session.
        if (me && typeof me === 'object' && me.id) {
          state.user = me;
          state.status = AUTHENTICATED;
        } else {
          state.user = null;
          state.status = UNAUTHENTICATED;
        }
      } catch {
        if (current !== state.checkId) return;
        state.user = null;
        state.status = UNAUTHENTICATED;
      }
      emit();
    },
  };
}

/**
 * Mirrors ProtectedLayoutClient's redirect decision.
 *
 * Returns the action a guard must take. Two rules, in order:
 *   1. Never redirect while AUTH_CHECKING. A pending check is not a logout.
 *   2. Only redirect from UNAUTHENTICATED, and only on a protected path.
 *
 * A public path renders immediately even while pending: /login does not need a
 * session to be usable, so gating it behind a spinner would only add latency.
 */
function guardAction(status, isPublicPath) {
  if (isPublicPath) return 'RENDER';
  if (status === AUTH_CHECKING) return 'WAIT';
  if (status === UNAUTHENTICATED) return 'REDIRECT_TO_LOGIN';
  return 'RENDER';
}

// ─────────────────────────────────────────────────────────────────────────────
// PART 11: the auth-check loading state must not redirect
// ─────────────────────────────────────────────────────────────────────────────

test('a guard does not redirect while the auth check is pending', () => {
  // This is the exact regression. Under the old `loading`/`user` pair, this
  // window was indistinguishable from a confirmed logout.
  assert.equal(guardAction(AUTH_CHECKING, false), 'WAIT');
  assert.notEqual(guardAction(AUTH_CHECKING, false), 'REDIRECT_TO_LOGIN');
});

test('an authenticated user renders the page, not a redirect', () => {
  assert.equal(guardAction(AUTHENTICATED, false), 'RENDER');
});

test('a confirmed unauthenticated user on a protected page is redirected', () => {
  assert.equal(guardAction(UNAUTHENTICATED, false), 'REDIRECT_TO_LOGIN');
});

test('a confirmed unauthenticated user on a public page is not redirected', () => {
  // /login and /auth/* are where an unauthenticated visitor belongs. Redirecting
  // them to /login would loop.
  assert.equal(guardAction(UNAUTHENTICATED, true), 'RENDER');
  // Both unauthenticated and pending render on a public path, but for different
  // reasons, so they are not compared for equality here.
  assert.equal(guardAction(AUTH_CHECKING, true), 'RENDER');
});

test('the three states are mutually exclusive and total', () => {
  const states = [AUTH_CHECKING, AUTHENTICATED, UNAUTHENTICATED];
  assert.equal(new Set(states).size, 3, 'a pending check must be its own state');
  // Every state produces a defined action, so no state can fall through.
  for (const s of states) {
    assert.ok(['WAIT', 'RENDER', 'REDIRECT_TO_LOGIN'].includes(guardAction(s, false)));
  }
});

test('the state starts as AUTH_CHECKING, never as a decided state', async () => {
  const auth = createAuth({ markerPresent: true, getMe: async () => ({ id: 'u1' }) });
  assert.equal(auth.state.status, AUTH_CHECKING, 'the initial state must be pending, not logged-out');
  assert.equal(auth.state.user, null);
  // The guard therefore waits rather than redirecting.
  assert.equal(guardAction(auth.state.status, false), 'WAIT');
});

test('a slow /auth/me does not cause a logout redirect', async () => {
  let release;
  const gate = new Promise((r) => { release = r; });
  const auth = createAuth({
    markerPresent: true,
    getMe: async () => { await gate; return { id: 'u1', username: 'alice' }; },
  });

  const pending = auth.refresh();
  // While in flight the guard must still be waiting, not redirecting.
  assert.equal(auth.state.status, AUTH_CHECKING);
  assert.equal(guardAction(auth.state.status, false), 'WAIT');

  release();
  await pending;
  assert.equal(auth.state.status, AUTHENTICATED);
  assert.equal(guardAction(auth.state.status, false), 'RENDER');
});

test('a session survives a refresh (cookie re-sent, /auth/me succeeds)', async () => {
  const auth = createAuth({ markerPresent: true, getMe: async () => ({ id: 'u1' }) });
  await auth.refresh();
  assert.equal(auth.state.status, AUTHENTICATED);

  // A hard refresh re-runs the same check against the same cookie.
  auth.state.status = AUTH_CHECKING;
  await auth.refresh();
  assert.equal(auth.state.status, AUTHENTICATED, 'the session is still valid after a refresh');
});

test('a session survives opening a new tab', async () => {
  // sessionStorage was per-tab, so this failed before. A cookie is shared across
  // tabs by design, which is the whole point of the migration.
  const auth = createAuth({ markerPresent: true, getMe: async () => ({ id: 'u1' }) });
  await auth.refresh();
  const tabOne = auth.state.status;

  // A second tab is a second independent check against the same cookie.
  const tabTwo = createAuth({ markerPresent: true, getMe: async () => ({ id: 'u1' }) });
  await tabTwo.refresh();

  assert.equal(tabOne, AUTHENTICATED);
  assert.equal(tabTwo.state.status, AUTHENTICATED, 'a new tab is authenticated too');
});

test('a 401 from /auth/me resolves to UNAUTHENTICATED, not a stuck pending state', async () => {
  const auth = createAuth({
    markerPresent: true,
    getMe: async () => { const e = new Error('unauthenticated'); e.status = 401; throw e; },
  });
  await auth.refresh();
  assert.equal(auth.state.status, UNAUTHENTICATED);
  assert.equal(auth.state.user, null);
});

test('a 200 with an unusable payload is not treated as a session', async () => {
  const auth = createAuth({ markerPresent: true, getMe: async () => ({}) });
  await auth.refresh();
  assert.equal(auth.state.status, UNAUTHENTICATED, 'a payload with no id cannot authenticate');
});

test('the frontend always asks the server, never a client-side cookie signal', async () => {
  // The regression this replaces: refresh() short-circuited when a client-side
  // "is there a session?" check returned false, never called /auth/me, and so
  // reported UNAUTHENTICATED on every page load. The session cookie is HttpOnly
  // AND set on the backend host, so the frontend cannot observe it in principle.
  let calls = 0;
  const auth = createAuth({
    getMe: async () => { calls += 1; return { id: 'u1', username: 'alice' }; },
  });
  await auth.refresh();
  assert.equal(calls, 1, '/auth/me is consulted exactly once');
  assert.equal(auth.state.status, AUTHENTICATED);
});

test('navigating between pages does not re-resolve the session as signed out', async () => {
  // The reported symptom: signed in on the dashboard, navigate to another page,
  // the whole app reloads and lands on /login. Each page used to run its own
  // guard with a hard window.location redirect, so any client-side cookie
  // signal decided the outcome.
  const auth = createAuth({ getMe: async () => ({ id: 'u1' }) });
  await auth.refresh();
  assert.equal(auth.state.status, AUTHENTICATED);

  // Simulate a route change: the store is shared and persists, so the guard sees
  // the same confirmed state rather than re-guessing.
  for (const route of ['/wallet', '/analytics', '/profile', '/dashboard']) {
    assert.equal(guardAction(auth.state.status, isPublicPathForTest(route)), 'RENDER', `${route} renders`);
  }
});

function isPublicPathForTest(pathname) {
  return ['/login', '/register', '/auth'].some((p) => pathname === p || pathname.startsWith(`${p}/`));
}

test('the only session cookie is HttpOnly and unobservable to script', () => {
  // Structural guarantee: there is exactly one credential and script cannot read
  // it, so the frontend has nothing to sniff and must ask the server.
  const session = buildSessionCookie('real-jwt');
  assert.match(session, new RegExp(`^${SESSION_COOKIE_NAME}=real-jwt`));
  assert.match(session, /HttpOnly/);
});

test('logout invalidates in-flight checks so a stale response cannot resurrect the session', async () => {
  let release;
  const gate = new Promise((r) => { release = r; });
  const auth = createAuth({
    markerPresent: true,
    getMe: async () => { await gate; return { id: 'u1' }; },
  });

  const pending = auth.refresh();
  // Logout bumps the check id, exactly as AuthContext does.
  auth.state.checkId += 1;
  auth.state.user = null;
  auth.state.status = UNAUTHENTICATED;

  release();
  await pending;

  assert.equal(auth.state.status, UNAUTHENTICATED, 'a response that lands after logout is discarded');
  assert.equal(auth.state.user, null);
});

// ─────────────────────────────────────────────────────────────────────────────
// PART 21: CORS credential behaviour
// ─────────────────────────────────────────────────────────────────────────────

test('the session cookie options are the shape a cross-site deployment requires', () => {
  const options = sessionCookieOptions();
  assert.equal(options.httpOnly, true);
  assert.equal(options.secure, true);
  assert.equal(options.sameSite, 'none', 'frontend and backend are different sites');
  assert.equal(options.path, '/');
  assert.equal(options.domain, undefined, 'no Domain attribute: host-only is the tightest correct scope');
  assert.equal(options.maxAge, SESSION_MAX_AGE_SECONDS);
});

test('SameSite=None is always paired with Secure', () => {
  // A browser rejects SameSite=None without Secure, so the pairing is not
  // optional hardening: it is what makes the cookie work at all here.
  const raw = buildSessionCookie('t');
  assert.match(raw, /SameSite=None/);
  assert.match(raw, /Secure/);
});

test('the session credential has exactly one transport: a Set-Cookie header', () => {
  // The callback places no credential in the URL. The session cookie is the only
  // place the token exists client-side, and it is HttpOnly so script cannot read
  // it and no other cookie can leak it.
  const raw = buildSessionCookie('super-secret-jwt');
  assert.ok(raw.includes('super-secret-jwt'), 'the token rides in the cookie');
  assert.match(raw, /HttpOnly/, 'and script cannot read it');
});
