import { Request, Response, NextFunction } from 'express';
import { verifyJwt } from '../utils/jwt.js';

export interface AuthRequest extends Request {
  user?: any;
}

export function jwtMiddleware(req: AuthRequest, res: Response, next: NextFunction) {
  const header = req.headers.authorization || '';
  const token = header.replace('Bearer ', '') || (req.cookies && req.cookies.token) || req.query.token;
  if (!token) return res.status(401).json({ error: 'missing_token' });
  const payload = verifyJwt(token as string);
  if (!payload) return res.status(401).json({ error: 'invalid_token' });
  req.user = payload;
  next();
}

export default jwtMiddleware;
