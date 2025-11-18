
const WebSocket = require('ws');
const Redis = require('ioredis');
const jwt = require('jsonwebtoken');

const PORT = process.env.PORT_WS || 5000;
const REDIS_URL = process.env.REDIS_URL || 'redis://redis:6379';
const JWT_SECRET = process.env.JWT_SECRET || 'please_change_me_locally';

const wss = new WebSocket.Server({ port: PORT });
console.log(`WebSocket server started on ws://0.0.0.0:${PORT}`);

const sub = new Redis(REDIS_URL);
const pub = new Redis(REDIS_URL);

// Presence aggregator state
const onlineAgents = new Set();

function broadcastPresenceUpdate() {
  const agents = Array.from(onlineAgents);
  const payload = { type: 'presence:update', count: agents.length, agents };
  try { pub.publish('agent:presence:update', JSON.stringify(payload)); } catch (e) {}
  // also broadcast to connected websocket clients
  wss.clients.forEach(client => {
    if (client.readyState === WebSocket.OPEN && client.isAuthed) client.send(JSON.stringify(payload));
  });
}

// publish periodic updates every 5s
setInterval(broadcastPresenceUpdate, 5000);

function broadcast(payload) {
  const msg = typeof payload === 'string' ? payload : JSON.stringify(payload);
  wss.clients.forEach(client => {
    if (client.readyState === WebSocket.OPEN && client.isAuthed) client.send(msg);
  });
}


sub.subscribe('agentfi:tasks', (err) => {
  if (err) console.error('Redis subscribe error', err);
  else console.log('Subscribed to agentfi:tasks');
});

sub.subscribe('agentfi:agents', (err) => {
  if (err) console.error('Redis subscribe error', err);
  else console.log('Subscribed to agentfi:agents');
});

sub.subscribe('agentfi:coord', (err) => {
  if (err) console.error('Redis subscribe error', err);
  else console.log('Subscribed to agentfi:coord');
});


sub.on('message', (channel, message) => {
  try {
    const parsed = JSON.parse(message);
    // Only broadcast relevant event types for agentfi:coord
    if (channel === 'agentfi:coord' && ['agent:update','task:progress','worker:result'].includes(parsed.type)) {
      broadcast(parsed);
    } else if (channel === 'agentfi:tasks' || channel === 'agentfi:agents') {
      broadcast(parsed);
    }
  } catch (e) {
    broadcast({ type: 'raw', data: message });
  }
});

// rooms: sessionId -> Set of ws
const rooms = new Map();

// subscribe to collab channels pattern
sub.psubscribe('collab:channel:*', (err) => {
  if (err) console.error('Redis psubscribe error', err);
  else console.log('Subscribed to collab:channel:*');
});

// pattern message handler (for psubscribe)
sub.on('pmessage', (pattern, channel, message) => {
  try {
    // channel format: collab:channel:<sessionId>
    if (channel && channel.startsWith('collab:channel:')) {
      const sessionId = channel.split(':')[2];
      const room = rooms.get(sessionId);
      if (room) {
        room.forEach(client => {
          if (client.readyState === WebSocket.OPEN && client.isAuthed) client.send(message);
        });
      }
    }
  } catch (e) { console.warn('pmessage handler error', e); }
});

// Periodically XREAD new entries from collab streams and forward to rooms
setInterval(async () => {
  try {
    const keys = await sub.keys('collab:stream:*');
    for (const k of keys) {
      try {
        // read latest 10 entries
        const entries = await sub.xread('COUNT', 10, 'STREAMS', k, '0');
        if (!entries) continue;
        const sessionId = k.split(':')[2];
        const room = rooms.get(sessionId);
        if (!room) continue;
        // entries is [[streamKey, [[id, [field, value, ...]], ...]]]
        for (const [, msgs] of entries) {
          for (const [id, fields] of msgs) {
            // fields is an array [field, value,...]
            const obj = {};
            for (let i = 0; i < fields.length; i += 2) obj[fields[i]] = fields[i+1];
            const payload = JSON.stringify({ type: 'stream', id, data: obj });
            room.forEach(client => { if (client.readyState === WebSocket.OPEN && client.isAuthed) client.send(payload); });
          }
        }
      } catch (e) { /* ignore per-stream errors */ }
    }
  } catch (e) { /* ignore */ }
}, 1500);

wss.on('connection', (socket, req) => {
  // JWT handshake: expect ?token= in query
  const url = req.url || '';
  const params = new URLSearchParams(url.split('?')[1] || '');
  const token = params.get('token');
  if (!token) {
    socket.send(JSON.stringify({ type: 'error', message: 'Missing JWT token' }));
    socket.close();
    return;
  }
  try {
    const decoded = jwt.verify(token, JWT_SECRET);
    socket.isAuthed = true;
    socket.user = decoded;
    socket.send(JSON.stringify({ type: 'welcome', message: 'Authenticated', user: decoded }));
    console.log('WS client authed:', decoded.username || decoded.id);
    // publish presence online and track
    try {
      const agentId = decoded.sub || decoded.id;
      onlineAgents.add(agentId);
      pub.publish('agent:presence', JSON.stringify({ type: 'connect', agentId, at: Date.now() }));
    } catch (e) { console.warn('presence publish failed', e); }
  } catch (err) {
    socket.send(JSON.stringify({ type: 'error', message: 'Invalid JWT token' }));
    socket.close();
    return;
  }

  socket.on('message', async (raw) => {
    let msg = raw.toString();
    try { msg = JSON.parse(raw); } catch (e) {}
    // handle join session messages from client: { type: 'join', sessionId }
    if (msg && msg.type === 'join' && msg.sessionId) {
      const sid = msg.sessionId;
      if (!rooms.has(sid)) rooms.set(sid, new Set());
      rooms.get(sid).add(socket);
      // notify participant count
      const count = rooms.get(sid).size;
      const notice = JSON.stringify({ type: 'participants', count });
      // publish to channel so others (and Redis subscribers) are aware
      try { pub.publish(`collab:channel:${sid}`, notice); } catch (e) {}
      socket.send(notice);
    }
    if (msg && msg.type === 'task:create') {
      await pub.publish('agentfi:tasks', JSON.stringify(msg));
    }
    const echo = { type: 'echo', data: msg, timestamp: Date.now() };
    socket.send(JSON.stringify(echo));
  });

  socket.on('close', () => {
    try {
      if (socket.user) {
        const agentId = socket.user.sub || socket.user.id;
        onlineAgents.delete(agentId);
        pub.publish('agent:presence', JSON.stringify({ type: 'disconnect', agentId, at: Date.now() }));
      }
      // remove from any rooms
      for (const [sid, set] of rooms.entries()) {
        if (set.has(socket)) {
          set.delete(socket);
          // publish updated count
          const cnt = set.size;
          pub.publish(`collab:channel:${sid}`, JSON.stringify({ type: 'participants', count: cnt }));
          if (set.size === 0) rooms.delete(sid);
        }
      }
    } catch (e) {}
    console.log('WS client disconnected');
  });
  socket.on('error', (err) => console.error('WS client error', err));
});
