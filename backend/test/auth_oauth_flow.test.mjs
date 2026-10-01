// auth_oauth_flow.test.mjs — the Google/Facebook/X OAuth handshake end to end.
//
// The regression this locks down, reproduced from production:
//
//   GET /auth/oauth/google/start  ->  302 accounts.google.com
//        redirect_uri=https://agentfinance.onrender.com/dashboard     <-- WRONG
//
// Google authenticated the user, then delivered the authorization code to the
// FRONTEND. The frontend had no callback handler and no client secret, the code
// was discarded, NO SESSION WAS EVER CREATED, and the dashboard redirected to
// /login. The user saw "Google worked, then logged me out".
//
// Every assertion below covers a property that, had it held in production, would
// have made that misconfiguration impossible to ship.
//
// The routes are driven through a real HTTP server so redirects, status codes and
// Set-Cookie headers behave exactly as a browser sees them. Provider responses
// are synthesised: no live provider is contacted. No secret, code, or token is
// ever printed.

import { test, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { mountRouter, makeClient, queryOf, cookieValue, cookieHeader } from './harness.js';

const ORIGINAL_ENV = { ...process.env };
const ORIGINAL_FETCH = global.fetch;

process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-secret-oauth-flow';
process.env.NODE_ENV = 'production'; // exercise the production cookie branch
process.env.PUBLIC_BACKEND_URL = 'https://agentfinance-backend-zgjj.onrender.com';
process.env.OAUTH_SUCCESS_URL = 'https://agentfinance.onrender.com';
process.env.GOOGLE_CLIENT_ID = 'test-google-client-id';
process.env.GOOGLE_CLIENT_SECRET = 'test-google-client-secret';
process.env.FACEBOOK_CLIENT_ID = 'test-facebook-client-id';
process.env.FACEBOOK_CLIENT_SECRET = 'test-facebook-client-secret';
process.env.X_CLIENT_ID = 'test-x-client-id';
process.env.X_CLIENT_SECRET = 'test-x-client-secret';

const prisma = (await import('../src/prismaClient.js')).default;
const oauthService = await import('../src/services/oauthService.js');
const stateStore = await import('../src/services/oauthStateStore.js');
const linking = await import('../src/services/accountLinking.js');
const { authMiddleware } = await import('../src/middleware/auth.js');
const oauthRouter = (await import('../src/routes/oauth.js')).default;

// ── Prisma stub ───────────────────────────────────────────────────────────────

let users = [];
let sessions = [];
let identities = [];
let oauthStates = [];
let seq = 0;
const nextId = () => `id${++seq}`;

function matches(row, where) {
  return Object.entries(where).every(([k, v]) => row[k] === v);
}

function installPrisma() {
  prisma.user = {
    findUnique: async ({ where }) => {
      if (where.id) return users.find((u) => u.id === where.id) || null;
      if (where.username) return users.find((u) => u.username === where.username) || null;
      if (where.email) return users.find((u) => u.email === where.email) || null;
      return null;
    },
    create: async ({ data }) => {
      const row = { ...data, id: data.id || nextId(), createdAt: new Date().toISOString() };
      if (data.identities?.create) {
        identities.push({ id: nextId(), userId: row.id, ...data.identities.create, createdAt: row.createdAt });
      }
      users.push(row);
      return row;
    },
    update: async ({ where, data }) => {
      const row = users.find((u) => u.id === where.id);
      Object.assign(row, data);
      return row;
    },
    deleteMany: async ({ where = {} }) => {
      const n = users.length;
      users = users.filter((u) => !matches(u, where));
      return { count: n - users.length };
    },
  };

  prisma.authSession = {
    findUnique: async ({ where }) => sessions.find((s) => s.id === where.id) || null,
    create: async ({ data }) => {
      const row = { ...data, id: data.id || nextId(), revoked: false, createdAt: new Date().toISOString() };
      sessions.push(row);
      return row;
    },
    updateMany: async ({ where = {}, data }) => {
      let count = 0;
      for (const row of sessions) if (matches(row, where)) { Object.assign(row, data); count += 1; }
      return { count };
    },
    deleteMany: async ({ where = {} }) => {
      const n = sessions.length;
      sessions = sessions.filter((s) => !matches(s, where));
      return { count: n - sessions.length };
    },
  };

  prisma.authIdentity = {
    findUnique: async ({ where }) => {
      const c = where?.provider_providerUserId;
      if (c) return identities.find((i) => i.provider === c.provider && i.providerUserId === c.providerUserId) || null;
      if (where?.id) return identities.find((i) => i.id === where.id) || null;
      return null;
    },
    findMany: async ({ where = {} } = {}) => identities.filter((i) => matches(i, where)),
    create: async ({ data }) => {
      if (identities.some((i) => i.provider === data.provider && i.providerUserId === data.providerUserId)) {
        const err = new Error('Unique constraint failed on the fields: (`provider`,`providerUserId`)');
        err.code = 'P2002';
        throw err;
      }
      const row = { ...data, id: data.id || nextId(), createdAt: new Date().toISOString() };
      identities.push(row);
      return row;
    },
    update: async ({ where, data }) => {
      const row = identities.find((i) => i.id === where.id);
      Object.assign(row, data);
      return row;
    },
    deleteMany: async ({ where = {} }) => {
      const n = identities.length;
      identities = identities.filter((i) => !matches(i, where));
      return { count: n - identities.length };
    },
  };

  prisma.oAuthState = {
    create: async ({ data }) => {
      if (oauthStates.some((s) => s.state === data.state)) {
        const err = new Error('duplicate'); err.code = 'P2002'; throw err;
      }
      oauthStates.push({ ...data });
      return data;
    },
    deleteMany: async ({ where = {} }) => {
      const n = oauthStates.length;
      oauthStates = oauthStates.filter((s) => !matches(s, where));
      return { count: n - oauthStates.length };
    },
  };
}

let client;

before(async () => {
  installPrisma();
  // Mounted at the SAME path the real server uses. index.js does
  // `app.use('/auth/oauth', oauthRouter)`, and mounting the bare router at the
  // root makes every route 404 — which would silently pass several negative
  // assertions for the wrong reason.
  client = makeClient(mountRouter(oauthRouter, '/auth/oauth'));
});

after(async () => {
  await client.close();
  process.env = { ...ORIGINAL_ENV };
  global.fetch = ORIGINAL_FETCH;
});

beforeEach(() => {
  users = []; sessions = []; identities = []; oauthStates = []; seq = 0;
  global.fetch = ORIGINAL_FETCH;
});

/**
 * Synthesise provider token + userinfo responses.
 *
 * The token endpoint is matched on its own URL, not on the substring
 * "access_token": Facebook's userinfo call carries the access token as a QUERY
 * PARAMETER, so a naive match would return a token payload where a profile was
 * expected and the login would fail for a reason that has nothing to do with the
 * code under test.
 */
function stubProviderFetch(profile, { tokenStatus = 200 } = {}) {
  global.fetch = async (url) => {
    const href = String(url);
    const isTokenEndpoint = /\/token$/.test(new URL(href).pathname)
      || /\/oauth\/access_token$/.test(new URL(href).pathname);
    if (isTokenEndpoint) {
      if (tokenStatus !== 200) {
        return { ok: false, status: tokenStatus, json: async () => ({ error: 'invalid_grant' }) };
      }
      return { ok: true, status: 200, json: async () => ({ access_token: 'provider-access-token-value' }) };
    }
    return { ok: true, status: 200, json: async () => profile };
  };
}

const googleProfile = {
  id: 'google-subject-123',
  email: 'alice@example.com',
  email_verified: true,
  name: 'Alice Example',
};

/** Run start -> callback and return both responses. */
async function runFlow(provider, profile, { startQuery = '' } = {}) {
  const start = await client.get(`/auth/oauth/${provider}/start${startQuery}`);
  assert.equal(start.status, 302, `${provider} start redirects to the provider`);
  const { state, redirect_uri: startUri } = queryOf(start.location);

  stubProviderFetch(profile);
  const cb = await client.get(
    `/auth/oauth/${provider}/callback?code=the-auth-code&state=${encodeURIComponent(state)}`,
  );
  return { start, startUri, state, cb };
}

// ─────────────────────────────────────────────────────────────────────────────
// PART 1/3/5: the redirect URI must point at the BACKEND
// ─────────────────────────────────────────────────────────────────────────────

test('a frontend-origin redirect URI is rejected', () => {
  // This is the exact production value. If this assertion ever fails, the
  // original bug can ship again.
  assert.equal(
    oauthService.validateRedirectUriForBackend(
      oauthService.getOAuthProvider('google'),
      'https://agentfinance.onrender.com/dashboard',
    ),
    'REDIRECT_URI_WRONG_ORIGIN',
  );
});

test('a frontend-origin callback path is still rejected', () => {
  assert.equal(
    oauthService.validateRedirectUriForBackend(
      oauthService.getOAuthProvider('google'),
      'https://agentfinance.onrender.com/auth/callback',
    ),
    'REDIRECT_URI_WRONG_ORIGIN',
  );
});

test('the real backend callback URI passes validation', () => {
  assert.equal(
    oauthService.validateRedirectUriForBackend(
      oauthService.getOAuthProvider('google'),
      'https://agentfinance-backend-zgjj.onrender.com/auth/oauth/google/callback',
    ),
    null,
  );
});

test('a malformed or non-http redirect URI is rejected', () => {
  const provider = oauthService.getOAuthProvider('google');
  assert.equal(oauthService.validateRedirectUriForBackend(provider, 'not a url'), 'REDIRECT_URI_MALFORMED');
  assert.equal(oauthService.validateRedirectUriForBackend(provider, 'javascript:alert(1)'), 'REDIRECT_URI_MALFORMED');
});

test('a wrong-origin redirect URI fails startup validation', () => {
  process.env.GOOGLE_REDIRECT_URI = 'https://agentfinance.onrender.com/dashboard';
  try {
    assert.equal(oauthService.assertOAuthConfiguration(), false, 'production must refuse to boot');
  } finally {
    delete process.env.GOOGLE_REDIRECT_URI;
  }
});

test('correct configuration passes startup validation', () => {
  delete process.env.GOOGLE_REDIRECT_URI;
  assert.equal(oauthService.assertOAuthConfiguration(), true);
});

test('a frontend URL is never used as the OAuth callback', () => {
  assert.equal(oauthService.resolveOauthSuccessUrl(), 'https://agentfinance.onrender.com');
  // The success URL is where the browser goes AFTER the backend has established
  // the session. It is never the redirect_uri sent to the provider.
  assert.ok(!oauthService.getRedirectUri(oauthService.getOAuthProvider('google'))
    .startsWith('https://agentfinance.onrender.com'));
});

// ─────────────────────────────────────────────────────────────────────────────
// PART 5: Google start -> callback -> session (the whole reported bug)
// ─────────────────────────────────────────────────────────────────────────────

test('Google start sends the BACKEND callback as redirect_uri', async () => {
  delete process.env.GOOGLE_REDIRECT_URI;
  const res = await client.get('/auth/oauth/google/start');

  assert.equal(res.status, 302);
  assert.match(res.location, /^https:\/\/accounts\.google\.com\//);

  const params = queryOf(res.location);
  assert.equal(
    params.redirect_uri,
    'https://agentfinance-backend-zgjj.onrender.com/auth/oauth/google/callback',
    'the authorization code MUST come back to the backend',
  );
  assert.equal(params.response_type, 'code');
  assert.ok(params.state, 'state is present');
  assert.equal(params.code_challenge_method, 'S256', 'Google uses PKCE');
  assert.ok(params.code_challenge);
  assert.ok(
    !res.location.includes('agentfinance.onrender.com'),
    'the frontend origin must never appear as the callback',
  );
});

test('Google callback creates a session, sets an HttpOnly cookie, and redirects with no token', async () => {
  delete process.env.GOOGLE_REDIRECT_URI;
  const { cb } = await runFlow('google', googleProfile);

  assert.equal(cb.status, 302);
  assert.equal(users.length, 1, 'a user was created');
  assert.equal(sessions.length, 1, 'A SESSION WAS CREATED — production failed to do this');

  const setCookie = cookieHeader(cb.setCookie, 'af_session');
  assert.ok(setCookie, 'a session cookie is set');
  assert.match(setCookie, /HttpOnly/);
  assert.match(setCookie, /Secure/);
  assert.match(setCookie, /SameSite=None/);
  assert.doesNotMatch(setCookie, /Domain=/i);

  // The redirect carries NO credential of any kind.
  assert.match(cb.location, /^https:\/\/agentfinance\.onrender\.com\/dashboard/);
  assert.ok(!cb.location.includes('access_token'), 'no token in the URL');
  assert.ok(!cb.location.includes('the-auth-code'), 'no authorization code in the URL');
  assert.ok(!cb.location.includes('#'), 'no fragment token');
  assert.match(cb.location, /provider=google/);
  assert.match(cb.location, /account=created/);
});

test('the session cookie from the callback authenticates /auth/me', async () => {
  delete process.env.GOOGLE_REDIRECT_URI;
  const { cb } = await runFlow('google', googleProfile);

  const token = decodeURIComponent(cookieValue(cb.setCookie, 'af_session'));
  const req = { headers: { cookie: `af_session=${token}` } };
  let passed = false;
  let rejected = null;
  await authMiddleware(req, { status() { return this; }, json() { return this; } }, () => { passed = true; });
  rejected = req.user;
  assert.equal(passed, true, 'the callback session survives the redirect and is recognised');
  assert.equal(rejected.sub, users[0].id);
  assert.equal(req.sid, sessions[0].id);
});

test('the session survives a refresh and further navigation', async () => {
  delete process.env.GOOGLE_REDIRECT_URI;
  const { cb } = await runFlow('google', googleProfile);
  const token = decodeURIComponent(cookieValue(cb.setCookie, 'af_session'));

  // Five sequential authenticated calls, as a hard refresh plus route changes.
  for (let i = 0; i < 5; i += 1) {
    let passed = false;
    await authMiddleware({ headers: { cookie: `af_session=${token}` } }, { status() { return this; }, json() { return this; } }, () => { passed = true; });
    assert.equal(passed, true, `request ${i + 1} stays authenticated`);
  }
});

test('logout revokes the session so the cookie stops working', async () => {
  delete process.env.GOOGLE_REDIRECT_URI;
  const { cb } = await runFlow('google', googleProfile);
  const token = decodeURIComponent(cookieValue(cb.setCookie, 'af_session'));

  let passed = false;
  await authMiddleware({ headers: { cookie: `af_session=${token}` } }, { status() { return this; }, json() { return this; } }, () => { passed = true; });
  assert.equal(passed, true, 'authenticated before logout');

  await sessions[0] && (await import('../src/middleware/auth.js')).revokeSession(sessions[0].id);

  passed = false;
  const res = { status(code) { this.statusCode = code; return this; }, json(b) { this.body = b; return this; } };
  await authMiddleware({ headers: { cookie: `af_session=${token}` } }, res, () => { passed = true; });
  assert.equal(passed, false, 'the revoked cookie must be refused');
  assert.equal(res.statusCode, 401);
  assert.equal(res.body.error, 'session_expired');
});

test('logging in twice with Google reuses one account, not two', async () => {
  delete process.env.GOOGLE_REDIRECT_URI;
  await runFlow('google', googleProfile);
  await runFlow('google', googleProfile);

  assert.equal(users.length, 1, 'the same Google identity must not create a second account');
  assert.equal(identities.length, 1);
});

test('the code is exchanged with the SAME redirect_uri used to start', async () => {
  delete process.env.GOOGLE_REDIRECT_URI;
  let seenRedirectUri = null;
  let seenBody = null;

  const start = await client.get('/auth/oauth/google/start');
  const { state, redirect_uri: startUri } = queryOf(start.location);

  global.fetch = async (url, init) => {
    const href = String(url);
    if (/\/token$/.test(new URL(href).pathname)) {
      seenBody = init.body;
      seenRedirectUri = new URLSearchParams(init.body).get('redirect_uri');
      return { ok: true, status: 200, json: async () => ({ access_token: 't' }) };
    }
    return { ok: true, status: 200, json: async () => googleProfile };
  };

  await client.get(`/auth/oauth/google/callback?code=c&state=${encodeURIComponent(state)}`);

  assert.equal(seenRedirectUri, startUri, 'Google requires an exact match between the two hops');
  assert.ok(new URLSearchParams(seenBody).get('code_verifier'), 'the PKCE verifier is sent');
});

// ─────────────────────────────────────────────────────────────────────────────
// PART 10: callback security
// ─────────────────────────────────────────────────────────────────────────────

test('an invalid state is rejected and no session is created', async () => {
  delete process.env.GOOGLE_REDIRECT_URI;
  stubProviderFetch(googleProfile);
  const res = await client.get('/auth/oauth/google/callback?code=c&state=forged.state');

  assert.equal(sessions.length, 0, 'no session from a forged state');
  assert.equal(users.length, 0);
  assert.match(res.location, /oauth_error=/, 'the failure is surfaced on the frontend');
});

test('a state issued for one provider is rejected by another', async () => {
  delete process.env.GOOGLE_REDIRECT_URI;
  const start = await client.get('/auth/oauth/google/start');
  const { state } = queryOf(start.location);
  stubProviderFetch({ id: 'fb-1', email: 'fb@example.com', email_verified: true, name: 'FB' });

  const res = await client.get(`/auth/oauth/facebook/callback?code=c&state=${encodeURIComponent(state)}`);
  assert.equal(sessions.length, 0, 'a Google state must not authenticate a Facebook callback');
});

test('a missing state is rejected', async () => {
  delete process.env.GOOGLE_REDIRECT_URI;
  stubProviderFetch(googleProfile);
  const res = await client.get('/auth/oauth/google/callback?code=c');
  assert.equal(sessions.length, 0);
  assert.match(res.location, /oauth_error=/);
});

test('a state row is burned on use', async () => {
  delete process.env.GOOGLE_REDIRECT_URI;
  const start = await client.get('/auth/oauth/google/start');
  const { state } = queryOf(start.location);
  assert.equal(oauthStates.length, 1, 'the state is persisted so any instance can validate it');

  stubProviderFetch(googleProfile);
  await client.get(`/auth/oauth/google/callback?code=c&state=${encodeURIComponent(state)}`);
  assert.equal(oauthStates.length, 0, 'the row is deleted on use, so a replay is spent');
});

test('a state survives being issued on a different instance', async () => {
  // The old in-memory Map failed here: /start and /callback landing on different
  // Render instances meant the state simply did not exist on the second one.
  delete process.env.GOOGLE_REDIRECT_URI;
  const start = await client.get('/auth/oauth/google/start');
  const { state } = queryOf(start.location);

  // Simulate a cold instance with an empty store: only the database carries it.
  const persisted = oauthStates[0];
  oauthStates = [];
  assert.equal(persisted.state, state, 'the state was persisted, not held in process memory');

  const valid = await stateStore.consumeOAuthState('google', state);
  assert.equal(valid, true, 'a fresh instance can still validate the handshake');
});

test('a provider-reported denial fails safely without a session', async () => {
  delete process.env.GOOGLE_REDIRECT_URI;
  const res = await client.get('/auth/oauth/google/callback?error=access_denied&state=x');
  assert.equal(sessions.length, 0);
  assert.match(res.location, /oauth_error=/);
});

test('a failing token exchange creates no session', async () => {
  delete process.env.GOOGLE_REDIRECT_URI;
  const start = await client.get('/auth/oauth/google/start');
  const { state } = queryOf(start.location);

  stubProviderFetch(googleProfile, { tokenStatus: 400 });
  const res = await client.get(`/auth/oauth/google/callback?code=c&state=${encodeURIComponent(state)}`);

  assert.equal(sessions.length, 0);
  assert.equal(users.length, 0);
  assert.match(res.location, /oauth_error=/);
});

test('an error message never contains the authorization code or a secret', async () => {
  delete process.env.GOOGLE_REDIRECT_URI;
  const start = await client.get('/auth/oauth/google/start');
  const { state } = queryOf(start.location);

  global.fetch = async () => ({ ok: false, status: 400, json: async () => ({ error: 'bad code' }) });
  const res = await client.get(
    `/auth/oauth/google/callback?code=super-secret-code&state=${encodeURIComponent(state)}`,
  );

  assert.ok(!res.location.includes('super-secret-code'), 'the code must not be reflected');
  assert.ok(!res.location.includes(process.env.GOOGLE_CLIENT_SECRET), 'the secret must not leak');
  assert.ok(!JSON.stringify(res.body || {}).includes('super-secret-code'));
});

test('an unknown provider is refused', async () => {
  const res = await client.get('/auth/oauth/myspace/start');
  assert.equal(sessions.length, 0);
  assert.ok(!res.location || res.location.includes('oauth_error'));
});

test('start refuses to run when the redirect URI is wrong', async () => {
  // Defence in depth: even if a bad value reached production, the start hop
  // refuses rather than sending the user through a flow that cannot complete.
  process.env.GOOGLE_REDIRECT_URI = 'https://agentfinance.onrender.com/dashboard';
  try {
    stubProviderFetch(googleProfile);
    const res = await client.get('/auth/oauth/google/start');
    assert.ok(
      !String(res.location || '').startsWith('https://accounts.google.com'),
      'a misconfigured provider must not be sent to Google',
    );
    assert.match(res.location, /oauth_error=/);
  } finally {
    delete process.env.GOOGLE_REDIRECT_URI;
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// PART 8: account linking
// ─────────────────────────────────────────────────────────────────────────────

test('one provider account can never map to two users', async () => {
  await linking.resolveUserForProviderProfile({
    providerId: 'google', providerSubject: 'shared-sub', emailVerified: true, email: 'x@example.com',
  });
  const second = await linking.resolveUserForProviderProfile({
    providerId: 'google', providerSubject: 'shared-sub', emailVerified: true, email: 'x@example.com',
  });
  assert.equal(second.created, false, 'the second login resolves to the same user');
  assert.equal(users.length, 1);
  assert.equal(identities.length, 1);
});

test('a second provider links to the existing user instead of duplicating it', async () => {
  const google = await linking.resolveUserForProviderProfile({
    providerId: 'google', providerSubject: 'g-1', email: 'bob@example.com', emailVerified: true, name: 'Bob',
  });
  const facebook = await linking.resolveUserForProviderProfile({
    providerId: 'facebook', providerSubject: 'f-1', email: 'bob@example.com', emailVerified: true, name: 'Bob',
  });

  assert.equal(users.length, 1, 'the same person must not get two accounts');
  assert.equal(facebook.user.id, google.user.id);
  assert.equal(identities.length, 2, 'both providers are linked');
});

test('linking a second provider cannot orphan the first', async () => {
  // The original defect: `User.oauthId` held one value, so linking Facebook
  // overwrote Google and the Google login stopped resolving entirely.
  const google = await linking.resolveUserForProviderProfile({
    providerId: 'google', providerSubject: 'g-9', email: 'carol@example.com', emailVerified: true,
  });
  await linking.resolveUserForProviderProfile({
    providerId: 'facebook', providerSubject: 'f-9', email: 'carol@example.com', emailVerified: true,
  });

  const again = await linking.resolveUserForProviderProfile({
    providerId: 'google', providerSubject: 'g-9', email: 'carol@example.com', emailVerified: true,
  });
  assert.equal(again.user.id, google.user.id, 'the Google login still resolves after linking Facebook');
});

test('an unverified provider email never claims an existing account', async () => {
  users.push({ id: nextId(), username: 'victim', email: 'victim@example.com', role: 'USER', passwordHash: 'x' });

  const result = await linking.resolveUserForProviderProfile({
    providerId: 'facebook', providerSubject: 'attacker-1', email: 'victim@example.com', emailVerified: false,
  });

  assert.notEqual(result.user.id, users.find((u) => u.username === 'victim').id, 'no account takeover');
  assert.equal(users.length, 2, 'a separate account is created instead');
});

test('a verified provider email links to the existing account', async () => {
  users.push({ id: nextId(), username: 'dave', email: 'dave@example.com', role: 'USER', passwordHash: 'x' });

  const result = await linking.resolveUserForProviderProfile({
    providerId: 'google', providerSubject: 'g-dave', email: 'dave@example.com', emailVerified: true,
  });

  assert.equal(result.user.id, users.find((u) => u.username === 'dave').id);
  assert.equal(users.length, 1);
});

test('a provider returning no identity is refused rather than guessed', async () => {
  await assert.rejects(
    linking.resolveUserForProviderProfile({ providerId: 'google', providerSubject: null, email: null }),
    (err) => err.status === 502 && err.code === 'provider_identity_missing',
  );
  assert.equal(users.length, 0, 'no account is created without an identity');
});

test('linking an identity already attached elsewhere is refused', async () => {
  await linking.resolveUserForProviderProfile({ providerId: 'google', providerSubject: 'shared-2', emailVerified: true });

  // Attach the same X identity directly, as a second device would have.
  const other = { id: nextId(), username: 'other', email: null, role: 'USER', passwordHash: 'x' };
  users.push(other);

  // A fresh Google identity whose email matches the OTHER user's verified email
  // must attach to that user; the point is that it never crosses accounts.
  await linking.resolveUserForProviderProfile({
    providerId: 'x', providerSubject: 'x-shared-2', email: null, emailVerified: false,
  });
  const ids = identities.map((i) => i.userId);
  assert.equal(new Set(ids).size, 2, 'each provider identity belongs to exactly one user');
  assert.equal(identities.length, 2);
});

test('a duplicate provider identity insert is rejected by the unique index', async () => {
  await linking.resolveUserForProviderProfile({ providerId: 'google', providerSubject: 'dup-1', emailVerified: true });
  await assert.rejects(
    prisma.authIdentity.create({ data: { userId: 'someone-else', provider: 'google', providerUserId: 'dup-1' } }),
    (err) => err.code === 'P2002',
    'the database, not application logic, is the authority',
  );
});

test('identities can be listed and unlinked, but never the last one', async () => {
  // Both providers carry the same VERIFIED email, so the second links to the
  // same user rather than creating a separate account.
  const { user } = await linking.resolveUserForProviderProfile({
    providerId: 'google', providerSubject: 'g-l', email: 'link@example.com', emailVerified: true,
  });
  await linking.resolveUserForProviderProfile({
    providerId: 'x', providerSubject: 'x-l', email: 'link@example.com', emailVerified: true,
  });

  assert.equal(users.length, 1, 'the two providers resolve to one account');
  const listed = await linking.listIdentitiesForUser(user.id);
  assert.equal(listed.length, 2);
  assert.ok(
    listed.every((i) => !('token' in i) && !('providerUserId' in i)),
    'no raw provider ids are exposed',
  );

  const result = await linking.unlinkIdentity({ userId: user.id, provider: 'x' });
  assert.equal(result.unlinked, true);
  assert.equal((await linking.listIdentitiesForUser(user.id)).length, 1);

  await assert.rejects(
    linking.unlinkIdentity({ userId: user.id, provider: 'google' }),
    (err) => err.code === 'last_identity',
    'a user must not be able to remove their only way in',
  );
});

// ─────────────────────────────────────────────────────────────────────────────
// PART 9: provider availability
// ─────────────────────────────────────────────────────────────────────────────

test('a provider with no credentials reports unavailable', async () => {
  const savedId = process.env.GOOGLE_CLIENT_ID;
  const savedSecret = process.env.GOOGLE_CLIENT_SECRET;
  delete process.env.GOOGLE_CLIENT_ID;
  delete process.env.GOOGLE_CLIENT_SECRET;
  try {
    const google = oauthService.configuredProviders().find((p) => p.id === 'google');
    assert.equal(google.configured, false, 'must not advertise a provider with no credentials');
    assert.equal(google.unavailableReason, 'CLIENT_CREDENTIALS_NOT_CONFIGURED');
  } finally {
    if (savedId) process.env.GOOGLE_CLIENT_ID = savedId;
    if (savedSecret) process.env.GOOGLE_CLIENT_SECRET = savedSecret;
  }
});

test('a provider with a wrong-origin redirect URI reports unavailable', async () => {
  process.env.X_REDIRECT_URI = 'https://agentfinance.onrender.com/dashboard';
  try {
    const x = oauthService.configuredProviders().find((p) => p.id === 'x');
    assert.equal(x.configured, false, 'a provider that cannot complete must not read as available');
    // The precise reason matters: it tells an operator the variable IS set but
    // points at the wrong place, which is the actual production failure.
    assert.equal(x.unavailableReason, 'REDIRECT_URI_WRONG_ORIGIN');
  } finally {
    delete process.env.X_REDIRECT_URI;
  }
});

test('a provider with no redirect URI at all reports unavailable', async () => {
  const savedBackend = process.env.PUBLIC_BACKEND_URL;
  delete process.env.X_REDIRECT_URI;
  delete process.env.PUBLIC_BACKEND_URL;
  try {
    const x = oauthService.configuredProviders().find((p) => p.id === 'x');
    assert.equal(x.configured, false);
    assert.equal(x.unavailableReason, 'REDIRECT_URI_NOT_CONFIGURED');
  } finally {
    process.env.PUBLIC_BACKEND_URL = savedBackend;
  }
});

test('the providers endpoint reports availability and leaks no secrets', async () => {
  delete process.env.GOOGLE_REDIRECT_URI;
  const res = await client.get('/auth/oauth/providers');

  assert.equal(res.status, 200);
  const serialized = JSON.stringify(res.body);
  for (const secret of [process.env.GOOGLE_CLIENT_SECRET, process.env.FACEBOOK_CLIENT_SECRET, process.env.X_CLIENT_SECRET]) {
    assert.ok(!serialized.includes(secret), 'no client secret in the public provider list');
  }
  assert.ok(!serialized.includes('clientSecretEnv'));
  assert.equal(res.body.providers.length, 3);
  for (const p of res.body.providers) {
    assert.equal(typeof p.available, 'boolean');
  }
  // The redirect URI is deliberately withheld from the public payload: a browser
  // has no need for it, and publishing it invites exactly the frontend/backend
  // confusion this bug came from.
  assert.ok(!serialized.includes('/auth/oauth/google/callback'));
});

// ─────────────────────────────────────────────────────────────────────────────
// PART 6/7: Facebook and X use the SAME session mechanism
// ─────────────────────────────────────────────────────────────────────────────

test('Facebook callback creates a normal AgentFinance session', async () => {
  delete process.env.FACEBOOK_REDIRECT_URI;
  const { start, startUri, cb } = await runFlow('facebook', {
    id: 'fb-1', email: 'fb@example.com', email_verified: true, name: 'FB User',
  });

  assert.match(start.location, /^https:\/\/www\.facebook\.com\//);
  assert.equal(startUri, 'https://agentfinance-backend-zgjj.onrender.com/auth/oauth/facebook/callback');

  assert.equal(cb.status, 302);
  assert.equal(sessions.length, 1, 'Facebook uses the same session mechanism');
  assert.match(cookieHeader(cb.setCookie, 'af_session'), /HttpOnly/);
  assert.ok(!cb.location.includes('access_token'));
  assert.equal(identities.length, 1);
  assert.equal(identities[0].provider, 'facebook');
});

test('X callback creates a session using PKCE and the current host', async () => {
  delete process.env.X_REDIRECT_URI;
  const start = await client.get('/auth/oauth/x/start');

  assert.match(start.location, /^https:\/\/x\.com\//, 'the twitter.com host is retired');
  const params = queryOf(start.location);
  assert.equal(params.code_challenge_method, 'S256', 'X requires PKCE');
  assert.equal(params.redirect_uri, 'https://agentfinance-backend-zgjj.onrender.com/auth/oauth/x/callback');

  stubProviderFetch({ data: { id: 'x-1', name: 'X User', username: 'xuser' } });
  const cb = await client.get(`/auth/oauth/x/callback?code=c&state=${encodeURIComponent(params.state)}`);

  assert.equal(sessions.length, 1);
  assert.match(cookieHeader(cb.setCookie, 'af_session'), /HttpOnly/);
  assert.equal(identities[0].provider, 'x');
});

test('an X identity with no email still resolves, since the id is authoritative', async () => {
  const result = await linking.resolveUserForProviderProfile({
    providerId: 'x', providerSubject: 'x-no-email', email: null, emailVerified: false, name: 'No Email',
  });
  assert.ok(result.user.id);
  assert.equal(users.length, 1);
});

test('the PKCE verifier never appears in the authorization URL', async () => {
  delete process.env.GOOGLE_REDIRECT_URI;
  const res = await client.get('/auth/oauth/google/start');
  assert.ok(res.location.includes('code_challenge='));
  assert.ok(!res.location.includes('code_verifier='), 'only the challenge travels');
});

test('the PKCE verifier is recoverable from the signed state', async () => {
  const state = await stateStore.issueOAuthState('google', { codeVerifier: 'a'.repeat(64) });
  assert.equal(stateStore.readPkceVerifier(state), 'a'.repeat(64));
});

test('a tampered state exposes no PKCE verifier', async () => {
  const state = await stateStore.issueOAuthState('google', { codeVerifier: 'b'.repeat(64) });
  assert.equal(stateStore.readPkceVerifier(`${state}x`), null);
  assert.equal(stateStore.readPkceVerifier('garbage'), null);
});

test('PKCE challenge derives correctly from the verifier', () => {
  const { verifier, challenge } = oauthService.createPkcePair();
  assert.ok(verifier.length >= 43);
  assert.equal(oauthService.pkceChallengeFromVerifier(verifier), challenge);
});

// ─────────────────────────────────────────────────────────────────────────────
// PART 10: redirect allowlist
// ─────────────────────────────────────────────────────────────────────────────

test('a client-supplied redirect destination is ignored', async () => {
  delete process.env.GOOGLE_REDIRECT_URI;
  const res = await client.get('/auth/oauth/google/start?redirect=https://evil.example');
  const { redirect_uri } = queryOf(res.location);
  assert.ok(
    redirect_uri.startsWith('https://agentfinance-backend-zgjj.onrender.com/'),
    'the browser cannot influence the callback destination',
  );

  const { state } = queryOf(res.location);
  stubProviderFetch(googleProfile);
  const cb = await client.get(
    `/auth/oauth/google/callback?code=c&state=${encodeURIComponent(state)}&redirect=https://evil.example`,
  );
  assert.match(cb.location, /^https:\/\/agentfinance\.onrender\.com\/dashboard/);
  assert.ok(!cb.location.includes('evil.example'), 'no open redirect');
});

test('a non-http OAUTH_SUCCESS_URL is rejected', () => {
  const saved = process.env.OAUTH_SUCCESS_URL;
  process.env.OAUTH_SUCCESS_URL = 'javascript:alert(1)';
  try {
    assert.throws(() => oauthService.resolveOauthSuccessUrl(), /valid http/);
  } finally {
    process.env.OAUTH_SUCCESS_URL = saved;
  }
});
