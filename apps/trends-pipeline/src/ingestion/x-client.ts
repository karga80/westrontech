import { TwitterApi, type TweetV2, type UserV2 } from "twitter-api-v2";
import pRetry, { AbortError, type RetryContext } from "p-retry";
import { env } from "@/config/env";
import { createLogger } from "@/shared/logger";
import { RateLimitError } from "@/shared/errors";
import { rateBudget } from "./x-rate-budget";

const log = createLogger("x-client");

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
  private readonly api: TwitterApi;

  private constructor() {
    this.api = new TwitterApi(env.X_BEARER_TOKEN);
  }

  static getInstance(): XClient {
    if (!instance) instance = new XClient();
    return instance;
  }

  async searchRecent(query: string, sinceId?: string, maxResults = 100): Promise<TweetV2[]> {
    return pRetry(
      async () => {
        if (!(await rateBudget.canCall("searchRecent"))) {
          throw new AbortError("Rate budget exhausted for searchRecent");
        }
        await rateBudget.recordCall("searchRecent");

        const res = await this.api.v2.search(query, {
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
        onFailedAttempt: (ctx: RetryContext) => {
          if (ctx.error.message.includes("429")) {
            const resetHeader = (ctx.error as Error & { headers?: Record<string, string> }).headers?.[
              "x-rate-limit-reset"
            ];
            const resetAt = resetHeader ? new Date(parseInt(resetHeader, 10) * 1000) : new Date(Date.now() + 60_000);
            throw new RateLimitError("searchRecent", resetAt);
          }
          log.warn({ attempt: ctx.attemptNumber, err: ctx.error.message }, "searchRecent retry");
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

        const res = await this.api.v2.tweetCountRecent(query, { granularity });
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

        const res = await this.api.v2.userTimeline(userId, {
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
        onFailedAttempt: (ctx: RetryContext) => {
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

        try {
          const res = await this.api.v2.userByUsername(username, {
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
        onFailedAttempt: (ctx: RetryContext) => {
          log.warn({ username, attempt: ctx.attemptNumber }, "resolveHandle retry");
        },
      },
    );
  }
}

export const xClient = XClient.getInstance();
