export function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

/**
 * retryAsync wraps an async express handler with retry attempts on thrown errors.
 * usage: router.post('/', retryAsync(async (req,res)=>{...}, { attempts:3 }))
 */
export function retryAsync(fn, opts = {}) {
  const attempts = opts.attempts || 3;
  return async function (req, res, next) {
    let attempt = 0;
    let lastErr = null;
    while (attempt < attempts) {
      try {
        return await fn(req, res, next);
      } catch (err) {
        lastErr = err;
        attempt++;
        const backoff = 1000 * Math.pow(2, attempt - 1);
        console.warn(`retryAsync: attempt ${attempt} failed, backing off ${backoff}ms`);
        await sleep(backoff);
      }
    }
    // all attempts failed
    console.error('retryAsync: all attempts failed', lastErr);
    res.status(500).json({ error: 'failed_after_retries' });
  };
}
