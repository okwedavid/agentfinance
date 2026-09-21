import express from 'express';
import { authMiddleware } from '../middleware/auth.js';

export default function makeSessionsRouter({ redis }) {
  const router = express.Router();

  // POST /api/sessions/join { sessionId }
  // Authenticated. Identity is always derived from the server session (the JWT),
  // never from a client-supplied `user` field.
  router.post('/join', authMiddleware, async (req, res) => {
    try {
      const { sessionId } = req.body || {};
      if (!sessionId) return res.status(400).json({ error: 'sessionId required' });
      const user = req.user?.username || 'anonymous';
      const payload = { type: 'join', user, ts: Date.now() };
      if (redis && typeof redis.xadd === 'function') {
        await redis.xadd(`collab:stream:${sessionId}`, '*', 'data', JSON.stringify(payload));
      }
      if (redis) await redis.publish(`collab:channel:${sessionId}`, JSON.stringify({ type: 'participants', count: 1 }));
      res.json({ ok: true });
    } catch (e) {
      console.error('session join failed', e);
      res.status(500).json({ error: 'failed' });
    }
  });

  return router;
}