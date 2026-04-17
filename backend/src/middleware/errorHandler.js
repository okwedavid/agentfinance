import logger from '../utils/logger.js';

// Express error-handling middleware
export default function errorHandler(err, req, res, next) {
  const status = err.status || 500;
  const body = {
    error: err.message || 'internal_error',
  };

  // log full error for ops
  logger.error(`${req.method} ${req.originalUrl} ${status} - ${err.stack || err}`);

  if (process.env.NODE_ENV === 'production') {
    res.status(status).json(body);
  } else {
    res.status(status).json({ ...body, stack: err.stack });
  }
}
