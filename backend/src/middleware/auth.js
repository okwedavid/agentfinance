import jwt from 'jsonwebtoken';
import prisma from '../prismaClient.js';
import { normalizeRole, isAdminRole } from '../utils/security.js';

const JWT_SECRET = process.env.JWT_SECRET;

export function getTokenFromRequest(req) {
  const authHeader = req.headers.authorization;
  if (authHeader?.startsWith('Bearer ')) return authHeader.slice(7);
  return req.cookies?.token || null;
}

export function authMiddleware(req, res, next) {
  try {
    const token = getTokenFromRequest(req);
    if (!token) return res.status(401).json({ error: 'unauthenticated' });
    req.user = jwt.verify(token, JWT_SECRET);
    return next();
  } catch {
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
  return requireRole(['ADMIN'])(req, res, next);
}

export { isAdminRole };

export default authMiddleware;