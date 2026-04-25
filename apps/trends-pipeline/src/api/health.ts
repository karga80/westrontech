import type { FastifyInstance } from "fastify";
import { rateBudget } from "@/ingestion/x-rate-budget";
import { getConnectedClients } from "@/alerting/websocket-server";
import { getRedis } from "@/storage/redis-client";

export async function registerHealthRoutes(app: FastifyInstance): Promise<void> {
  app.get("/health", async () => {
    const redis = getRedis();
    let redisOk = false;
    try {
      await redis.ping();
      redisOk = true;
    } catch {
      redisOk = false;
    }

    const xBudget = await rateBudget.getUsage("getPostsCounts");
    const xBudgetSearch = await rateBudget.getUsage("searchRecent");

    return {
      status: "ok",
      ts: new Date().toISOString(),
      redis: redisOk ? "ok" : "error",
      wsClients: getConnectedClients(),
      rateBudget: {
        counts: xBudget,
        search: xBudgetSearch,
      },
    };
  });
}
