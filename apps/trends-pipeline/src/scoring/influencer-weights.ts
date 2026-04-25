import { getRedis } from "@/storage/redis-client";

const WEIGHTS_KEY = "influencer:weights";

const DEFAULT_WEIGHT = 1.0;

export class InfluencerWeights {
  async getWeight(handle: string): Promise<number> {
    const redis = getRedis();
    const raw = await redis.hget(WEIGHTS_KEY, handle.toLowerCase());
    return raw !== null ? parseFloat(raw) : DEFAULT_WEIGHT;
  }

  async updateWeight(handle: string, weight: number): Promise<void> {
    const redis = getRedis();
    await redis.hset(WEIGHTS_KEY, handle.toLowerCase(), weight.toString());
  }

  async getTopCallers(n: number): Promise<Array<{ handle: string; weight: number }>> {
    const redis = getRedis();
    const all = await redis.hgetall(WEIGHTS_KEY);
    return Object.entries(all)
      .map(([handle, w]) => ({ handle, weight: parseFloat(w) }))
      .sort((a, b) => b.weight - a.weight)
      .slice(0, n);
  }

  async blacklist(handle: string): Promise<void> {
    await this.updateWeight(handle, 0);
  }

  async bulkSet(entries: Array<{ handle: string; weight: number }>): Promise<void> {
    const redis = getRedis();
    const args: string[] = [];
    for (const { handle, weight } of entries) {
      args.push(handle.toLowerCase(), weight.toString());
    }
    if (args.length > 0) await redis.hset(WEIGHTS_KEY, ...args);
  }
}

export const influencerWeights = new InfluencerWeights();
