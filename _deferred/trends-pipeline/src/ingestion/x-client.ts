import { TwitterApi, type TweetV2, type UserV2 } from "twitter-api-v2";
import pRetry, { AbortError, type RetryContext } from "p-retry";
import { env } from "@/config/env";
import { createLogger } from "@/shared/logger";
import { RateLimitError } from "@/shared/errors";
import { rateBudget } from "./x-rate-budget";
import { getRedis } from "@/storage/redis-client";

const log = createLogger("x-client");

const REDIS_ACCESS_TOKEN_KEY = "x:oauth2:access_token";
const REDIS_REFRESH_TOKEN_KEY = "x:oauth2:refresh_token";

export interface TweetCountResult {
  start: string;
  end: string;
  tweetCount: number;
}

export interface TrendResult {
  name: string;
  query: string;
  tweetVolume: number | null;
}

let instance: XClient | null = null;

export class XClient {
  private readonly appClient: TwitterApi;
  private userAccessToken: string | null;
  private userRefreshToken: string | null;

  private constructor() {
    this.appClient = new TwitterApi(env.X_BEARER_TOKEN);
    this.userAccessToken = env.X_OAUTH2_ACCESS_TOKEN ?? null;
    this.userRefreshToken = env.X_OAUTH2_REFRESH_TOKEN ?? null;
  }

  static getInstance(): XClient {
    if (!instance) instance = new XClient();
    return instance;
  }

  // Load tokens from Redis (overrides env if present — persists refreshed tokens)
  async loadTokensFromRedis(): Promise<void> {
    if (!env.X_OAUTH2_ACCESS_TOKEN) return;
    const redis = getRedis();
    const [access, refresh] = await Promise.all([
      redis.get(REDIS_ACCESS_TOKEN_KEY),
      redis.get(REDIS_REFRESH_TOKEN_KEY),
    ]);
    if (access) this.userAccessToken = access;
    if (refresh) this.userRefreshToken = refresh;
    log.info("OAuth2 tokens loaded");
  }

  private getUserClient(): TwitterApi | null {
    if (!this.userAccessToken) return null;
    return new TwitterApi(this.userAccessToken);
  }

  private async refreshAndRetry(): Promise<TwitterApi | null> {
    if (!env.X_OAUTH2_CLIENT_ID || !env.X_OAUTH2_CLIENT_SECRET || !this.userRefreshToken) {
      return null;
    }
    try {
      const refreshClient = new TwitterApi({
        clientId: env.X_OAUTH2_CLIENT_ID,
        clientSecret: env.X_OAUTH2_CLIENT_SECRET,
      });
      const { accessToken, refreshToken } = await refreshClient.refreshOAuth2Token(
        this.userRefreshToken,
      );
      this.userAccessToken = accessToken;
      if (refreshToken) this.userRefreshToken = refreshToken;

      // Persist refreshed tokens to Redis so restarts don't lose them
      const redis = getRedis();
      await redis.set(REDIS_ACCESS_TOKEN_KEY, accessToken, "EX", 7 * 24 * 3600);
      if (refreshToken) await redis.set(REDIS_REFRESH_TOKEN_KEY, refreshToken, "EX", 30 * 24 * 3600);

      log.info("OAuth2 token refreshed and stored");
      return new TwitterApi(accessToken);
    } catch (err) {
      log.error({ err }, "OAuth2 token refresh failed");
      return null;
    }
  }

  // Returns user-context client, refreshing if necessary
  private async getUserClientWithRefresh(): Promise<TwitterApi | null> {
    let client = this.getUserClient();
    if (!client) return null;
    return client;
  }

  async searchRecent(query: string, sinceId?: string, maxResults = 100): Promise<TweetV2[]> {
    return pRetry(
      async () => {
        if (!(await rateBudget.canCall("searchRecent"))) {
          throw new AbortError("Rate budget exhausted for searchRecent");
        }
        await rateBudget.recordCall("searchRecent");

        const client = (await this.getUserClientWithRefresh()) ?? this.appClient;
        const res = await client.v2.search(query, {
          max_results: Math.min(maxResults, 100) as 10 | 100,
          ...(sinceId !== undefined ? { since_id: sinceId } : {}),
          "tweet.fields": ["created_at", "author_id", "public_metrics", "text"],
          "user.fields": ["username", "public_metrics"],
          expansions: ["author_id"],
        });

        const tweets = res.data.data ?? [];
        log.debug({ query, count: tweets.length }, "searchRecent complete");
        return tweets;
      },
      {
        retries: 3,
        minTimeout: 1000,
        maxTimeout: 8000,
        onFailedAttempt: async (ctx: RetryContext) => {
          const msg = ctx.error.message;
          if (msg.includes("401") && ctx.attemptNumber === 1) {
            log.warn("Access token expired — refreshing");
            await this.refreshAndRetry();
          } else if (msg.includes("429")) {
            const resetHeader = (ctx.error as Error & { headers?: Record<string, string> }).headers?.[
              "x-rate-limit-reset"
            ];
            const resetAt = resetHeader ? new Date(parseInt(resetHeader, 10) * 1000) : new Date(Date.now() + 60_000);
            throw new RateLimitError("searchRecent", resetAt);
          }
          log.warn({ attempt: ctx.attemptNumber, err: msg }, "searchRecent retry");
        },
      },
    );
  }

  async getPostsCounts(query: string, granularity: "minute" | "hour" = "minute"): Promise<TweetCountResult[]> {
    return pRetry(
      async () => {
        if (!(await rateBudget.canCall("getPostsCounts"))) {
          throw new AbortError("Rate budget exhausted for getPostsCounts");
        }
        await rateBudget.recordCall("getPostsCounts");

        const res = await this.appClient.v2.tweetCountRecent(query, { granularity });
        const data = res.data ?? [];
        log.debug({ query, buckets: data.length }, "getPostsCounts complete");
        return data.map((d) => ({
          start: d.start,
          end: d.end,
          tweetCount: d.tweet_count,
        }));
      },
      {
        retries: 3,
        minTimeout: 1000,
        onFailedAttempt: (ctx: RetryContext) => {
          log.warn({ attempt: ctx.attemptNumber, err: ctx.error.message }, "getPostsCounts retry");
        },
      },
    );
  }

  async getUserPosts(userId: string, sinceId?: string, maxResults = 20): Promise<TweetV2[]> {
    return pRetry(
      async () => {
        if (!(await rateBudget.canCall("getUserPosts"))) {
          throw new AbortError("Rate budget exhausted for getUserPosts");
        }
        await rateBudget.recordCall("getUserPosts");

        const client = await this.getUserClientWithRefresh();
        if (!client) {
          throw new AbortError("No OAuth2 user client — set X_OAUTH2_ACCESS_TOKEN");
        }

        const res = await client.v2.userTimeline(userId, {
          max_results: Math.min(maxResults, 100) as 5 | 100,
          ...(sinceId !== undefined ? { since_id: sinceId } : {}),
          "tweet.fields": ["created_at", "public_metrics", "text"],
        });

        const tweets = res.data.data ?? [];
        log.debug({ userId, count: tweets.length }, "getUserPosts complete");
        return tweets;
      },
      {
        retries: 3,
        minTimeout: 1000,
        onFailedAttempt: async (ctx: RetryContext) => {
          if (ctx.error.message.includes("401") && ctx.attemptNumber === 1) {
            log.warn("Access token expired on getUserPosts — refreshing");
            await this.refreshAndRetry();
          }
          log.warn({ attempt: ctx.attemptNumber, err: ctx.error.message }, "getUserPosts retry");
        },
      },
    );
  }

  async resolveHandle(username: string): Promise<UserV2 | null> {
    return pRetry(
      async () => {
        if (!(await rateBudget.canCall("resolveHandle"))) {
          throw new AbortError("Rate budget exhausted for resolveHandle");
        }
        await rateBudget.recordCall("resolveHandle");

        const client = (await this.getUserClientWithRefresh()) ?? this.appClient;
        try {
          const res = await client.v2.userByUsername(username, {
            "user.fields": ["profile_image_url", "public_metrics", "id"],
          });
          return res.data ?? null;
        } catch (err: unknown) {
          if (err instanceof Error && err.message.includes("404")) return null;
          throw err;
        }
      },
      {
        retries: 2,
        minTimeout: 500,
        onFailedAttempt: async (ctx: RetryContext) => {
          if (ctx.error.message.includes("401") && ctx.attemptNumber === 1) {
            await this.refreshAndRetry();
          }
          log.warn({ username, attempt: ctx.attemptNumber }, "resolveHandle retry");
        },
      },
    );
  }
}

export const xClient = XClient.getInstance();
