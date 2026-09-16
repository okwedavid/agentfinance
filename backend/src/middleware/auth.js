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
    const payload = jwt.verify(token, JWT_SECRET);
    if (!payload?.sid) return res.status(401).json({ error: 'session_expired' });

    const session = await prisma.authSession.findUnique({ where: { id: payload.sid } });
    if (!session || session.revoked || session.userId !== payload.sub) {
      return res.status(401).json({ error: 'session_expired' });
    }

    req.user = payload;
    req.sid = payload.sid;
    return next();
  } catch (error) {
    if (error?.name === 'TokenExpiredError') {
      return res.status(401).json({ error: 'session_expired' });
    }
    return res.status(401).json({ error: 'unauthenticated' });
  }
}

export function optionalAuth(req, _res, next) {
  try {
    const token = getTokenFromRequest(req);
    if (token) req.user = jwt.verify(token, JWT_SECRET);
  } catch {
    req.user = null;
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