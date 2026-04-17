import express from 'express';

export default function makeSessionsRouter({ redis }) {
  const router = express.Router();

  // POST /api/sessions/join { sessionId, user }
  router.post('/join', async (req, res) => {
    try {
      const { sessionId, user } = req.body || {};
      if (!sessionId) return res.status(400).json({ error: 'sessionId required' });
      const payload = { type: 'join', user: user || 'anonymous', ts: Date.now() };
      // add to Redis stream
      if (redis && typeof redis.xadd === 'function') {
        await redis.xadd(`collab:stream:${sessionId}`, '*', 'data', JSON.stringify(payload));
      }
      // publish notification
      if (redis) await redis.publish(`collab:channel:${sessionId}`, JSON.stringify({ type: 'participants', count: 1 }));
      res.json({ ok: true });
    } catch (e) {
      console.error('session join failed', e);
      res.status(500).json({ error: 'failed' });
    }
  });

  return router;
}
