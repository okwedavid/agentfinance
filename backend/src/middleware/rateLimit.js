import rateLimit from 'express-rate-limit';

// App-level protection (all routes). Generous so normal dashboard polling and
// task workflows are never throttled; the focused per-route limiters below do
// the real abuse protection (brute force, signup spam, expensive AI jobs).
const limiter = rateLimit({
  windowMs: 60 * 1000,
  max: 600,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'rate_limit_exceeded' },
  skip: (req) => req.path === '/health',
});

function keyByIp(req) {
  return String(req.ip || req.socket?.remoteAddress || 'unknown');
}

function userKey(req) {
  return req.user?.sub ? `user:${req.user.sub}` : keyByIp(req);
}

// Login is protected per account AND per source IP so a leaked session can
// not be brute forced from any single origin. The response stays identical to
// a normal failure so the limiter cannot be used to enumerate accounts.
const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 20,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'invalid credentials' },
  keyGenerator: (req) => {
    const account = typeof req.body?.username === 'string' ? req.body.username.trim().toLowerCase() : '';
    return `login:${account}:${keyByIp(req)}`;
  },
});

const registerLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  max: 8,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'too many accounts created' },
  keyGenerator: (req) => `register:${keyByIp(req)}`,
});

const verifyLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 30,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'rate_limit_exceeded' },
  keyGenerator: (req) => `verify:${keyByIp(req)}`,
});

// Expensive AI task creation: bounded per authenticated user (falls back to IP
// for unauthenticated callers, which fail auth anyway).
const taskCreateLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 12,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'task_rate_limit_exceeded' },
  keyGenerator: userKey,
});

const payoutLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 6,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'rate_limit_exceeded' },
  keyGenerator: userKey,
});

const factoryLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 20,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'rate_limit_exceeded' },
  keyGenerator: userKey,
});

const dispatchLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 10,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'rate_limit_exceeded' },
  keyGenerator: userKey,
});

export {
  limiter as default,
  loginLimiter,
  registerLimiter,
  verifyLimiter,
  taskCreateLimiter,
  payoutLimiter,
  factoryLimiter,
  dispatchLimiter,
};