// auth_session.test.mjs — session cookie, cookie-aware auth, and lifecycle.
//
// The regression these lock down: production ran with the FRONTEND origin set as
// the OAuth redirect URI, so Google delivered the authorization code to a page
// with no callback handler. No session was created, and the dashboard bounced
// the user to /login. The second-order failures were that the session lived in
// sessionStorage (script-readable, per-tab, lost on refresh) and that logout
// revoked the session without clearing the cookie.
//
// No live database and no real provider are required: prisma is stubbed and
// fetch is intercepted.

import { test, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';

const ORIGINAL_ENV = { ...process.env };
const ORIGINAL_FETCH = global.fetch;

// JWT_SECRET must exist before auth.js is imported (it is read at module load).
process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-secret-auth-session';
process.env.NODE_ENV = 'test';

const prisma = (await import('../src/prismaClient.js')).default;
const {
  getTokenFromRequest,
  resolveUserFromToken,
  createSessionForUser,
  signSessionToken,
  revokeSession,
  revokeAllSessionsForUser,
  authMiddleware,
  optionalAuth,
  SESSION_TTL_MS,
} = await import('../src/middleware/auth.js');
const cookie = await import('../src/services/sessionCookie.js');

// ── Prisma stub ───────────────────────────────────────────────────────────────

let users = [];
let sessions = [];
let identities = [];
let oauthStates = [];
let seq = 0;
const nextId = () => `id${++seq}`;

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
        identities.push({
          id: nextId(),
          userId: row.id,
          ...data.identities.create,
          createdAt: row.createdAt,
        });
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
      const before = users.length;
      users = users.filter((u) => !matches(u, where));
      return { count: before - users.length };
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
      for (const row of sessions) {
        if (matches(row, where)) { Object.assign(row, data); count += 1; }
      }
      return { count };
    },
    deleteMany: async ({ where = {} }) => {
      const before = sessions.length;
      sessions = sessions.filter((s) => !matches(s, where));
      return { count: before - sessions.length };
    },
  };

  prisma.authIdentity = {
    findUnique: async ({ where }) => {
      const composite = where?.provider_providerUserId;
      if (composite) {
        return identities.find((i) => i.provider === composite.provider && i.providerUserId === composite.providerUserId) || null;
      }
      if (where?.id) return identities.find((i) => i.id === where.id) || null;
      return null;
    },
    findMany: async ({ where = {} } = {}) => identities.filter((i) => matches(i, where)),
    create: async ({ data }) => {
      // Enforce the unique index: this is the guarantee that stops one provider
      // account being attached to two users.
      const clash = identities.find((i) => i.provider === data.provider && i.providerUserId === data.providerUserId);
      if (clash) {
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
      const before = identities.length;
      identities = identities.filter((i) => !matches(i, where));
      return { count: before - identities.length };
    },
  };

  prisma.oAuthState = {
    create: async ({ data }) => {
      if (oauthStates.some((s) => s.state === data.state)) {
        const err = new Error('duplicate state');
        err.code = 'P2002';
        throw err;
      }
      oauthStates.push({ ...data });
      return data;
    },
    deleteMany: async ({ where = {} }) => {
      const before = oauthStates.length;
      oauthStates = oauthStates.filter((s) => !matches(s, where));
      return { count: before - oauthStates.length };
    },
  };
}

function matches(row, where) {
  return Object.entries(where).every(([k, v]) => row[k] === v);
}

function resetStore() {
  users = [];
  sessions = [];
  identities = [];
  oauthStates = [];
  seq = 0;
}

function makeUser(overrides = {}) {
  const row = {
    id: nextId(),
    username: `user${Math.random().toString(36).slice(2, 8)}`,
    email: null,
    role: 'USER',
    passwordHash: 'x',
    createdAt: new Date().toISOString(),
    ...overrides,
  };
  users.push(row);
  return row;
}

/** Minimal response double that records Set-Cookie headers. */
function makeRes() {
  const cookies = [];
  return {
    cookies,
    statusCode: null,
    body: null,
    getHeader(name) {
      if (String(name).toLowerCase() === 'set-cookie') return cookies.length ? cookies : undefined;
      return undefined;
    },
    setHeader(name, value) {
      if (String(name).toLowerCase() === 'set-cookie') cookies.push(...(Array.isArray(value) ? value : [value]));
    },
    status(code) { this.statusCode = code; return this; },
    json(payload) { this.body = payload; return this; },
    send(payload) { this.body = payload; return this; },
    type() { return this; },
    redirect(url) { this.body = { redirectedTo: url }; this.statusCode = 302; return this; },
    cookieValues() {
      return cookies.map((c) => c.split(';')[0].split('=')[0]);
    },
    /** Find the Set-Cookie entry for a given cookie name. */
    raw(name) {
      return cookies.find((c) => c.startsWith(`${name}=`));
    },
  };
}

before(() => installPrisma());
after(() => {
  process.env = { ...ORIGINAL_ENV };
  global.fetch = ORIGINAL_FETCH;
});
beforeEach(resetStore);

// ─────────────────────────────────────────────────────────────────────────────
// PART 3 / 4: cookie shape and CORS-correctness
// ─────────────────────────────────────────────────────────────────────────────

test('session cookie attributes are the secure cross-site shape', () => {
  const raw = cookie.buildSessionCookie('a-token-value');
  assert.match(raw, /^af_session=a-token-value/);
  assert.match(raw, /HttpOnly/, 'the token must be unreadable by scripts');
  assert.match(raw, /Secure/, 'required for SameSite=None to be accepted');
  assert.match(raw, /SameSite=None/, 'frontend and backend are different sites on Render');
  assert.match(raw, /Path=\//);
  assert.match(raw, /Max-Age=\d+/);
});

test('no Domain attribute is set on the session cookie', () => {
  // A broad Domain such as .onrender.com would expose the session cookie to every
  // other app the operator owns on that platform.
  assert.doesNotMatch(cookie.buildSessionCookie('t'), /Domain=/i);
});

test('the session cookie Max-Age matches the session lifetime', () => {
  const raw = cookie.buildSessionCookie('t');
  const maxAge = Number(raw.match(/Max-Age=(\d+)/)[1]);
  assert.equal(maxAge * 1000, cookie.SESSION_MAX_AGE_SECONDS * 1000);
});

test('clearing the cookie matches the set attributes so deletion works', () => {
  const set = cookie.buildSessionCookie('t');
  const clear = cookie.clearSessionCookie();
  for (const attr of ['Path=/', 'HttpOnly', 'Secure', 'SameSite=None']) {
    assert.ok(set.includes(attr), `set cookie has ${attr}`);
    assert.ok(clear.includes(attr), `clear cookie must repeat ${attr} or deletion fails`);
  }
  assert.match(clear, /Max-Age=0/);
});

test('only one cookie is ever set: the session cookie', () => {
  // A second, script-readable "marker" cookie was removed. It could not work: it
  // is set on the BACKEND host with no Domain attribute, so it is host-scoped
  // and a frontend page can never see it. The frontend guard read false on every
  // load, skipped /auth/me, and logged the user out on every navigation.
  const res = makeRes();
  cookie.setSessionCookie(res, 'tok');
  assert.deepEqual(res.cookieValues(), ['af_session']);
});

test('setSessionCookie writes the session cookie as HttpOnly', () => {
  const res = makeRes();
  cookie.setSessionCookie(res, 'tok');
  assert.deepEqual(res.cookieValues(), ['af_session']);
  assert.match(res.raw('af_session'), /HttpOnly/);
});

test('clearSessionCookieHeader sets exactly one clearing cookie', () => {
  const res = makeRes();
  cookie.clearSessionCookieHeader(res);
  assert.deepEqual(res.cookieValues(), ['af_session']);
  assert.match(res.raw('af_session'), /Max-Age=0/);
});

test('logout clears the cookie without discarding an unrelated Set-Cookie', () => {
  // A second Set-Cookie must append. Assigning would drop the first value, and a
  // dropped clearing-cookie leaves a live session in the browser.
  const res = makeRes();
  res.setHeader('Set-Cookie', ['some_other=value; Path=/']);
  cookie.clearSessionCookieHeader(res);
  assert.ok(res.cookies.some((c) => c.startsWith('some_other=')), 'unrelated cookie preserved');
  assert.ok(res.cookies.some((c) => c.startsWith('af_session=;')), 'session cookie cleared');
});

test('readSessionCookie parses the cookie and tolerates malformed headers', () => {
  assert.equal(cookie.readSessionCookie('af_session=abc123'), 'abc123');
  assert.equal(cookie.readSessionCookie('other=1; af_session=abc123; more=2'), 'abc123');
  assert.equal(cookie.readSessionCookie('af_session='), null);
  assert.equal(cookie.readSessionCookie(''), null);
  assert.equal(cookie.readSessionCookie(undefined), null);
  assert.equal(cookie.readSessionCookie('nonsense'), null);
});

// ─────────────────────────────────────────────────────────────────────────────
// PART 4: cookie is accepted by auth, and Bearer still works for the WS handshake
// ─────────────────────────────────────────────────────────────────────────────

test('authMiddleware accepts the session cookie', async () => {
  const user = makeUser();
  const session = await createSessionForUser(user.id);
  const token = signSessionToken(user, session);

  const req = { headers: { cookie: `af_session=${token}` } };
  const res = makeRes();
  let passed = false;
  await authMiddleware(req, res, () => { passed = true; });

  assert.equal(passed, true, 'a valid cookie authenticates');
  assert.equal(req.user.sub, user.id);
  assert.equal(req.sid, session.id);
});

test('authMiddleware still accepts a Bearer token for the WebSocket handshake', async () => {
  const user = makeUser();
  const session = await createSessionForUser(user.id);
  const token = signSessionToken(user, session);

  const req = { headers: { authorization: `Bearer ${token}` } };
  const res = makeRes();
  let passed = false;
  await authMiddleware(req, res, () => { passed = true; });
  assert.equal(passed, true);
});

test('a cookie and a header grant identical authority', async () => {
  const user = makeUser();
  const session = await createSessionForUser(user.id);
  const token = signSessionToken(user, session);

  const byCookie = { headers: { cookie: `af_session=${token}` } };
  const byHeader = { headers: { authorization: `Bearer ${token}` } };
  await authMiddleware(byCookie, makeRes(), () => {});
  await authMiddleware(byHeader, makeRes(), () => {});
  assert.equal(byCookie.user.sub, byHeader.user.sub);
  assert.equal(byCookie.sid, byHeader.sid);
});

test('no credential at all is 401 unauthenticated', async () => {
  const res = makeRes();
  let passed = false;
  await authMiddleware({ headers: {} }, res, () => { passed = true; });
  assert.equal(passed, false);
  assert.equal(res.statusCode, 401);
  assert.equal(res.body.error, 'unauthenticated');
});

test('a tampered cookie signature is rejected', async () => {
  const res = makeRes();
  let passed = false;
  await authMiddleware({ headers: { cookie: 'af_session=not.a.jwt' } }, res, () => { passed = true; });
  assert.equal(passed, false);
  assert.equal(res.statusCode, 401);
});

// ─────────────────────────────────────────────────────────────────────────────
// PART 4: session lifecycle — survives, refreshes, expires, revokes
// ─────────────────────────────────────────────────────────────────────────────

test('a session survives repeated requests (refresh and navigation)', async () => {
  const user = makeUser();
  const session = await createSessionForUser(user.id);
  const token = signSessionToken(user, session);

  // Five sequential authenticated calls, as a page refresh and route changes
  // would produce.
  for (let i = 0; i < 5; i += 1) {
    const req = { headers: { cookie: `af_session=${token}` } };
    let passed = false;
    await authMiddleware(req, makeRes(), () => { passed = true; });
    assert.equal(passed, true, `request ${i + 1} must stay authenticated`);
  }
});

test('/auth/me recognises the session established by a cookie login', async () => {
  const user = makeUser({ username: 'alice' });
  const session = await createSessionForUser(user.id);
  const token = signSessionToken(user, session);

  const resolved = await resolveUserFromToken(token);
  assert.ok(resolved, '/auth/me resolves the cookie session');
  assert.equal(resolved.user.sub, user.id);
});

test('logout revokes the session so the cookie stops working', async () => {
  const user = makeUser();
  const session = await createSessionForUser(user.id);
  const token = signSessionToken(user, session);

  // Authenticated before logout.
  assert.ok(await resolveUserFromToken(token));

  await revokeSession(session.id);

  // The cookie is still presented by the browser; the server must now refuse it.
  assert.equal(await resolveUserFromToken(token), null);
  const res = makeRes();
  let passed = false;
  await authMiddleware({ headers: { cookie: `af_session=${token}` } }, res, () => { passed = true; });
  assert.equal(passed, false);
  assert.equal(res.statusCode, 401);
});

test('logout rejects with session_expired, never a bare unauthenticated', async () => {
  const user = makeUser();
  const session = await createSessionForUser(user.id);
  const token = signSessionToken(user, session);
  await revokeSession(session.id);

  const res = makeRes();
  await authMiddleware({ headers: { cookie: `af_session=${token}` } }, res, () => {});
  assert.equal(res.body.error, 'session_expired');
});

test('a new login revokes the previous session (one active device)', async () => {
  const user = makeUser();
  const first = await createSessionForUser(user.id);
  const firstToken = signSessionToken(user, first);
  assert.ok(await resolveUserFromToken(firstToken));

  const second = await createSessionForUser(user.id);
  const secondToken = signSessionToken(user, second);

  assert.ok(await resolveUserFromToken(secondToken), 'the new session works');
  assert.equal(await resolveUserFromToken(firstToken), null, 'the old session is dead');
});

test('a session past its own expiry is refused even though the JWT still verifies', async () => {
  const user = makeUser();
  const session = await createSessionForUser(user.id);
  const token = signSessionToken(user, session);

  assert.ok(await resolveUserFromToken(token), 'valid to begin with');

  // Simulate the passage of time rather than waiting seven days.
  const row = sessions.find((s) => s.id === session.id);
  row.expiresAt = new Date(Date.now() - 1000).toISOString();

  assert.equal(await resolveUserFromToken(token), null, 'an expired session must not authenticate');
});

test('createSessionForUser stamps an explicit expiry consistent with the TTL', async () => {
  const user = makeUser();
  const session = await createSessionForUser(user.id);
  const ttl = new Date(session.expiresAt).getTime() - new Date(session.createdAt).getTime();
  assert.ok(Math.abs(ttl - SESSION_TTL_MS) < 2000, 'expiry matches the declared session lifetime');
});

test('account deletion revokes EVERY session, not just the current one', async () => {
  const user = makeUser();
  const s1 = await createSessionForUser(user.id);
  const t1 = signSessionToken(user, s1);
  // A second tab's session. createSessionForUser would revoke it, so make it
  // directly to model the pre-existing state at deletion time.
  const s2 = { id: nextId(), userId: user.id, revoked: false, createdAt: new Date().toISOString(), expiresAt: new Date(Date.now() + SESSION_TTL_MS).toISOString() };
  sessions.push(s2);
  const t2 = signSessionToken(user, s2);

  assert.ok(await resolveUserFromToken(t1));
  assert.ok(await resolveUserFromToken(t2));

  await revokeAllSessionsForUser(user.id);

  assert.equal(await resolveUserFromToken(t1), null);
  assert.equal(await resolveUserFromToken(t2), null, 'a second tab must not stay signed in');
});

test('a session belonging to another user is rejected (no cross-user reuse)', async () => {
  const alice = makeUser();
  const bob = makeUser();
  const aliceSession = await createSessionForUser(alice.id);
  // Forge a token whose sid is Alice's session but whose sub is Bob.
  const { default: jwt } = await import('jsonwebtoken');
  const forged = jwt.sign(
    { sub: bob.id, username: bob.username, role: bob.role, sid: aliceSession.id },
    process.env.JWT_SECRET,
    { expiresIn: '7d' },
  );
  assert.equal(await resolveUserFromToken(forged), null, 'session/user mismatch must fail');
});

test('optionalAuth does not fail an anonymous request', async () => {
  const req = { headers: {} };
  let passed = false;
  optionalAuth(req, makeRes(), () => { passed = true; });
  await new Promise((r) => setImmediate(r));
  assert.equal(passed, true);
  assert.equal(req.user, undefined);
});
