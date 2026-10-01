// sessionCookie.js — the single place a session is written to or cleared from
// the browser.
//
// WHY A COOKIE AT ALL
// The session used to be a JWT handed to the browser and parked in
// sessionStorage, which the frontend then replayed as an Authorization header.
// That had three consequences:
//   1. The token was readable by any script on the page (no HttpOnly), so one
//      XSS was a full account takeover.
//   2. sessionStorage is per-tab and dies with the tab, so a refresh, a new tab,
//      or ordinary navigation dropped the login.
//   3. Two parallel mechanisms had to stay in sync (set a header AND clear
//      storage), and logout could half-succeed.
// A cookie fixes all three at once and makes the server the single authority.
//
// DEPLOYMENT SHAPE
// The frontend and backend are DIFFERENT sites on Render
// (agentfinance.onrender.com / agentfinance-backend-zgjj.onrender.com), so the
// cookie is cross-site and must be SameSite=None; Secure. Browsers reject
// SameSite=None without Secure, so Secure is mandatory in this topology rather
// than merely a hardening nicety.
//
// NO `Domain` IS SET, deliberately. An omitted Domain scopes the cookie to the
// exact host that set it (the backend), which is the tightest correct scope. A
// broad Domain such as `.onrender.com` would expose the session cookie to every
// other Render app the operator owns — including any app an attacker could get
// deployed there.

export const SESSION_COOKIE_NAME = 'af_session';

// A second, deliberately script-readable cookie that carries NO authority. It
// exists so the frontend can answer "might there be a session?" without reading
// the HttpOnly cookie, which is what stops an auth guard from redirecting a
// signed-in user to /login on every hard refresh. It proves nothing: the server
// still validates the HttpOnly session cookie on every authenticated request, and
// this cookie can be forged by any script without granting access.
export const SESSION_MARKER_COOKIE = 'af_session_present';

// 7 days, matching the JWT lifetime so the cookie and the token agree.
export const SESSION_MAX_AGE_SECONDS = 7 * 24 * 60 * 60;

function isProduction() {
  return process.env.NODE_ENV === 'production';
}

/**
 * Cookie attributes for the session.
 *
 * Exported (rather than inlined at the call site) so tests can assert the exact
 * production shape rather than a guess.
 */
export function sessionCookieOptions() {
  return {
    httpOnly: true,
    // Required for SameSite=None to be accepted at all in a cross-site setup.
    secure: true,
    // The frontend is a different site, so the cookie must be sent cross-site.
    sameSite: 'none',
    // Deliberately omitted: no `domain`. Scoped to the backend host only.
    path: '/',
    maxAge: SESSION_MAX_AGE_SECONDS,
  };
}

/**
 * Serialize the session cookie for a Set-Cookie header.
 *
 * Built by hand rather than via a dependency so the attribute set is explicit
 * and auditable in one place.
 */
export function buildSessionCookie(token) {
  const o = sessionCookieOptions();
  const parts = [
    `${SESSION_COOKIE_NAME}=${token}`,
    'Path=/',
    `Max-Age=${o.maxAge}`,
    'HttpOnly',
  ];
  if (o.secure) parts.push('Secure');
  parts.push(`SameSite=${sameSiteValue(o.sameSite)}`);
  return parts.join('; ');
}

function sameSiteValue(value) {
  if (value === 'none') return 'None';
  if (value === 'lax') return 'Lax';
  return 'Strict';
}

/**
 * The non-authoritative marker cookie. Readable by script by design; see
 * SESSION_MARKER_COOKIE.
 */
export function buildSessionMarkerCookie(isProduction = isProduction()) {
  const base = `${SESSION_MARKER_COOKIE}=1; Path=/; Max-Age=${SESSION_MAX_AGE_SECONDS}`;
  // No HttpOnly: the whole point is that the page can see it.
  return isProduction ? `${base}; Secure; SameSite=None` : `${base}; SameSite=Lax`;
}

/**
 * A Set-Cookie value that deletes the cookie. The attributes MUST match those
 * used when setting it, or the browser treats it as a different cookie and the
 * original survives.
 */
export function clearSessionCookie() {
  return [
    `${SESSION_COOKIE_NAME}=`,
    'Path=/',
    'Max-Age=0',
    'HttpOnly',
    'Secure',
    'SameSite=None',
  ].join('; ');
}

export function clearSessionMarkerCookie() {
  return `${SESSION_MARKER_COOKIE}=; Path=/; Max-Age=0; Secure; SameSite=None`;
}

/**
 * Parse the session cookie out of a Cookie header.
 *
 * Deliberately tolerant of whitespace and of a missing value, and returns null
 * rather than throwing: a malformed cookie is an anonymous request, not a 500.
 */
export function readSessionCookie(cookieHeader) {
  if (typeof cookieHeader !== 'string' || !cookieHeader) return null;
  for (const part of cookieHeader.split(';')) {
    const eq = part.indexOf('=');
    if (eq === -1) continue;
    const name = part.slice(0, eq).trim();
    if (name !== SESSION_COOKIE_NAME) continue;
    const value = part.slice(eq + 1).trim();
    return value ? decodeURIComponent(value) : null;
  }
  return null;
}

/**
 * Attach the session cookie to a response.
 *
 * Returns the response so call sites read as `return setSessionCookie(res, token)`.
 * In non-production the Secure/SameSite=None pair is dropped, because a local
 * http:// origin cannot set SameSite=None and the cookie would be silently
 * discarded — which would make local testing impossible without also teaching
 * the code to lie about production.
 */
export function setSessionCookie(res, token) {
  const prod = isProduction();
  appendSetCookie(res, prod ? buildSessionCookie(token) : buildDevSessionCookie(token));
  appendSetCookie(res, buildSessionMarkerCookie(prod));
  return res;
}

function buildDevSessionCookie(token) {
  // A cross-site SameSite=None cookie is rejected outright on an http://
  // origin, which would make local development impossible. Development uses
  // SameSite=Lax on a same-site http origin, which browsers accept.
  return `${SESSION_COOKIE_NAME}=${token}; Path=/; Max-Age=${SESSION_MAX_AGE_SECONDS}; HttpOnly; SameSite=Lax`;
}

export function clearSessionCookieHeader(res) {
  const prod = isProduction();
  appendSetCookie(
    res,
    prod ? clearSessionCookie() : `${SESSION_COOKIE_NAME}=; Path=/; Max-Age=0; HttpOnly; SameSite=Lax`,
  );
  appendSetCookie(
    res,
    prod ? clearSessionMarkerCookie() : `${SESSION_MARKER_COOKIE}=; Path=/; Max-Age=0; SameSite=Lax`,
  );
  return res;
}

/**
 * Append without clobbering.
 *
 * Logout already sets a clearing cookie, and an error path may set another.
 * Assigning `res.setHeader` would drop the earlier value, so values accumulate.
 */
function appendSetCookie(res, value) {
  const existing = res.getHeader('Set-Cookie');
  if (!existing) {
    res.setHeader('Set-Cookie', [value]);
    return;
  }
  const list = Array.isArray(existing) ? existing : [String(existing)];
  list.push(value);
  res.setHeader('Set-Cookie', list);
}
