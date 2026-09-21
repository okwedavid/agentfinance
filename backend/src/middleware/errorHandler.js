import logger from '../utils/logger.js';

// Express error-handling middleware. Production never leaks stack traces,
// database errors, provider messages or internal paths: 5xx responses are
// generic. 4xx errors may carry a curated message (err.expose). Full detail is
// retained in the server logs for debugging.
export default function errorHandler(err, req, res, next) {
  const status = Number(err.status) || 500;
  // A message is only ever shown to clients when the throwing code explicitly
  // opted in via err.expose — status-code alone never grants it.
  const expose = err.expose === true;

  logger.error(`${req.method} ${req.originalUrl} ${status} - ${err.stack || err}`);

  if (process.env.NODE_ENV === 'production') {
    if (expose && typeof err.message === 'string' && err.message.length <= 500) {
      return res.status(status).json({ error: err.message });
    }
    return res.status(status).json({ error: status < 500 ? 'request_failed' : 'internal_error' });
  }

  res.status(status).json({ ...(expose ? { error: err.message } : { error: 'internal_error' }), stack: err.stack });
}