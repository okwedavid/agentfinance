/**
 * Simple agent queue utilities using Redis lists for per-agent queues.
 * - chooseAgents(redis, agents[], count) -> returns array of agent names with shortest queues
 * - pushTask(redis, agent, payload) -> LPUSH to agent queue list
 */
export default {
  async chooseAgents(redis, agents, count = 1) {
    // get queue lengths in parallel
    const keys = agents.map(a => `agent:queue:${a}`);
    const pipeline = redis.pipeline();
    keys.forEach(k => pipeline.llen(k));
    const results = await pipeline.exec();
    // results is array of [err, value]
    const pairs = agents.map((a, i) => ({ agent: a, len: (results[i] && results[i][1]) || 0 }));
    pairs.sort((x, y) => x.len - y.len);
    return pairs.slice(0, count).map(p => p.agent);
  },

  async pushTask(redis, agent, payload) {
    const key = `agent:queue:${agent}`;
    // push to right (RPUSH) so workers can LPOP
    await redis.rpush(key, JSON.stringify(payload));
    // set a short TTL to clean empty queues eventually
    await redis.expire(key, 60 * 60 * 24);
    return true;
  }
};
