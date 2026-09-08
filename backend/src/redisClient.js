import IORedis from 'ioredis';

const REDIS_URL = process.env.REDIS_URL;

// Only connect to Redis when REDIS_URL is provided. Without it (e.g. Render
// with no Redis add-on) the server keeps running and publish() becomes a safe
// no-op instead of retrying a bogus docker-compose hostname forever.
const redis =
  REDIS_URL && !REDIS_URL.includes('{{')
    ? new IORedis(REDIS_URL, { maxRetriesPerRequest: null })
    : null;

const noopRedis = {
  publish: async () => 0,
  hset: async () => 0,
  hgetall: async () => ({}),
  set: async () => 'OK',
  get: async () => null,
  del: async () => 0,
  exists: async () => 0,
  expire: async () => 0,
  incr: async () => 1,
  pipeline: () => [],
  on: () => noopRedis,
  connect: async () => {},
  subscribe: async () => 0,
  disconnect: () => {},
  quit: async () => 'OK',
};

export default redis ?? noopRedis;