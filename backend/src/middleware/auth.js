import jwt from 'jsonwebtoken';

const JWT_SECRET = process.env.JWT_SECRET || 'please_change_me_locally';

export default async function authMiddleware(req, res, next) {
  try {
    const token = req.cookies && req.cookies.token || req.headers.authorization && req.headers.authorization.split(' ')[1];
    if (!token) return res.status(401).json({ error: 'unauthenticated' });
    const decoded = jwt.verify(token, JWT_SECRET);
    req.user = decoded;
    return next();
  } catch (err) {
    return res.status(401).json({ error: 'unauthenticated' });
  }
}
