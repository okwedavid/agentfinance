import rateLimit from 'express-rate-limit';

// Keep app-level protection, but avoid throttling normal dashboard polling and task workflows.
const limiter = rateLimit({
  windowMs: 60 * 1000,
  max: 600,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'rate_limit_exceeded' },
  skip: (req) => req.path === '/health',
});

export default limiter;
