import jwt from 'jsonwebtoken';
import prisma from '../prismaClient.js';
import {
  normalizeRole,
  isAdminRole,
  ROLE_ADMIN,
  ROLE_SUPER_ADMIN,
} from '../utils/security.js';

const JWT_SECRET = process.env.JWT_SECRET;

export function getTokenFromRequest(req) {
  const authHeader = req.headers.authorization;
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
  return { user: payload, sid: payload.sid };
}

// One active device per account: revoke every prior session, then issue one new
// session for the user. Used on login, register, and OAuth completion.
export async function createSessionForUser(userId) {
  await prisma.authSession.updateMany({ where: { userId }, data: { revoked: true } });
  const session = await prisma.authSession.create({ data: { userId } });
  return session;
}

// Session-bound auth. Tokens issued without a sid (pre-session builds) are now
// rejected, which forces a clean re-login once and stops background auto-login:
// the httpOnly cookie path is gone, so a browser restart cannot resurrect a login.
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

export { isAdminRole, ROLE_ADMIN, ROLE_SUPER_ADMIN };

export default authMiddleware;