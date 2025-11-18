
import IORedis from 'ioredis';
const url = process.env.REDIS_URL || 'redis://localhost:6379';
const redisClient = new IORedis(url);

export default redisClient;
