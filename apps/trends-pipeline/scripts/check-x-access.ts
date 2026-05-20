/**
 * Checks X API token scope and accessible endpoints.
 * Usage: bun run scripts/check-x-access.ts
 */
import { TwitterApi } from "twitter-api-v2";
import { env } from "@/config/env";

async function test(label: string, fn: () => Promise<unknown>) {
  try {
    const result = await fn();
    console.log(`✓ ${label}:`, JSON.stringify(result).slice(0, 120));
  } catch (err: unknown) {
    const e = err as { code?: number; data?: { title?: string; reason?: string; detail?: string } };
    console.log(`✗ ${label}: [${e.code ?? "?"}] ${e.data?.title ?? ""} — ${e.data?.reason ?? e.data?.detail ?? String(err).slice(0, 100)}`);
  }
}

// ── App-only (bearer token) ───────────────────────────────────────────────────
const appClient = new TwitterApi(env.X_BEARER_TOKEN);
console.log("── App-only (bearer token) ──");
await test("tweets/counts/recent", () => appClient.v2.tweetCountRecent("$BTC", { granularity: "hour" }));
await test("tweets/search/recent", () => appClient.v2.search("$BTC", { max_results: 10 }));
await test("users/by/username",    () => appClient.v2.userByUsername("zachxbt"));

// ── OAuth2 user context ───────────────────────────────────────────────────────
if (!env.X_OAUTH2_ACCESS_TOKEN) {
  console.log("\n── OAuth2 user context: NOT configured (X_OAUTH2_ACCESS_TOKEN missing) ──");
} else {
  const userClient = new TwitterApi(env.X_OAUTH2_ACCESS_TOKEN);
  console.log("\n── OAuth2 user context ──");
  await test("users/me",             () => userClient.v2.me());
  await test("users/by/username",    () => userClient.v2.userByUsername("zachxbt"));
  await test("tweets/search/recent", () => userClient.v2.search("$BTC", { max_results: 10 }));
  await test("users/:id/tweets",     async () => {
    const me = await userClient.v2.me();
    return userClient.v2.userTimeline(me.data.id, { max_results: 5, "tweet.fields": ["text"] });
  });
}
