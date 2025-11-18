import IORedis from 'ioredis';

const REDIS_URL = process.env.REDIS_URL || 'redis://redis:6379';
const redis = new IORedis(REDIS_URL, { maxRetriesPerRequest: null });

export default redis;
