import jwt from 'jsonwebtoken';
import prisma from '../prismaClient.js';
import {
  normalizeRole,
  isAdminRole,
  ROLE_ADMIN,
  ROLE_SUPER_ADMIN,
} from '../utils/security.js';
import { readSessionCookie } from '../services/sessionCookie.js';

const JWT_SECRET = process.env.JWT_SECRET;

// Session lifetime. Kept in one place so the cookie Max-Age, the JWT expiry and
// the AuthSession.expiresAt column cannot drift apart.
export const SESSION_TTL_DAYS = 7;
export const SESSION_TTL_MS = SESSION_TTL_DAYS * 24 * 60 * 60 * 1000;

/**
 * Extract the session token from a request.
 *
 * The session cookie is authoritative. The Authorization header is still
 * accepted because the WebSocket handshake has no cookie jar available to it and
 * must authenticate from an explicit first frame.
 */
export function getTokenFromRequest(req) {
  const fromCookie = readSessionCookie(req.headers?.cookie);
  if (fromCookie) return fromCookie;

  const authHeader = req.headers?.authorization;
  if (authHeader?.startsWith('Bearer ')) return authHeader.slice(7);
  return null;
}

// Verify a JWT and confirm its session is still live and unrevoked. Shared by
// the HTTP authMiddleware and the WebSocket authentication handshake so both
// transport layers enforce the identical session policy.
export async function resolveUserFromToken(token) {
  if (!token || !JWT_SECRET) return null;
  let payload;
  try {
    payload = jwt.verify(token, JWT_SECRET);
  } catch {
    return null;
  }
  if (!payload?.sid || !payload?.sub) return null;
  const session = await prisma.authSession.findUnique({ where: { id: payload.sid } });
  if (!session || session.revoked || session.userId !== payload.sub) return null;
  // A session past its own expiry is dead even if the JWT signature still
  // verifies. Revoking a session marks it immediately; expiry catches the
  // sessions nobody ever logged out of.
  if (session.expiresAt && new Date(session.expiresAt).getTime() <= Date.now()) return null;
  return { user: payload, sid: payload.sid };
}

// One active device per account: revoke every prior session, then issue one new
// session for the user. Used on login, register, and OAuth completion.
export async function createSessionForUser(userId) {
  await prisma.authSession.updateMany({ where: { userId }, data: { revoked: true } });
  const session = await prisma.authSession.create({
    data: {
      userId,
      expiresAt: new Date(Date.now() + SESSION_TTL_MS),
    },
  });
  return session;
}

/** Sign the session JWT for a freshly created session row. */
export function signSessionToken(user, session, { expiresIn = `${SESSION_TTL_DAYS}d` } = {}) {
  return jwt.sign(
    { sub: user.id, username: user.username, role: user.role, sid: session.id },
    JWT_SECRET,
    { expiresIn },
  );
}

/**
 * Revoke the caller's current session.
 *
 * The authoritative logout. Clearing the browser copy without revoking here
 * would leave a still-valid credential usable by anyone who captured it, so
 * logout must always do both.
 */
export async function revokeSession(sid) {
  if (!sid) return null;
  return prisma.authSession.updateMany({ where: { id: sid }, data: { revoked: true } });
}

/** Revoke every session for a user (account deletion). */
export async function revokeAllSessionsForUser(userId) {
  return prisma.authSession.updateMany({ where: { userId }, data: { revoked: true } });
}

// Session-bound auth. The session cookie (HttpOnly) is the primary credential;
// an Authorization header remains accepted for the WebSocket handshake, which
// cannot read cookies. Both paths resolve through the identical session check,
// so a cookie and a header grant exactly the same authority.
export async function authMiddleware(req, res, next) {
  try {
    const token = getTokenFromRequest(req);
    if (!token) return res.status(401).json({ error: 'unauthenticated' });
    const resolved = await resolveUserFromToken(token);
    if (!resolved) return res.status(401).json({ error: 'session_expired' });
    req.user = resolved.user;
    req.sid = resolved.sid;
    return next();
  } catch {
    return res.status(401).json({ error: 'unauthenticated' });
  }
}

export function optionalAuth(req, _res, next) {
  const token = getTokenFromRequest(req);
  if (token) {
    resolveUserFromToken(token).then((resolved) => {
      if (resolved) req.user = resolved.user;
      return next();
    }).catch(() => next());
    return;
  }
  return next();
}

// Server-authoritative role check. The role is always read from the database
// for the authenticated user id — never from the client, the JWT, or the body.
export function requireRole(allowedRoles) {
  const roles = Array.isArray(allowedRoles) ? allowedRoles : [allowedRoles];
  return async (req, res, next) => {
    try {
      if (!req.user?.sub) return res.status(401).json({ error: 'unauthenticated' });
      const user = await prisma.user.findUnique({ where: { id: req.user.sub } });
      const role = normalizeRole(user?.role);
      if (!roles.includes(role)) {
        return res.status(403).json({ error: 'forbidden' });
      }
      req.userRole = role;
      req.userRecord = user;
      return next();
    } catch {
      return res.status(500).json({ error: 'failed' });
    }
  };
}

export function requireAdmin(req, res, next) {
  return requireRole([ROLE_ADMIN, ROLE_SUPER_ADMIN])(req, res, next);
}

export { isAdminRole, ROLE_ADMIN, ROLE_SUPER_ADMIN, JWT_SECRET };

export default authMiddleware;