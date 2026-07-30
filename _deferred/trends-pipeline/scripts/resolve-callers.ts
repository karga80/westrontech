/**
 * Resolves Twitter user IDs for all alpha callers with empty userId fields.
 * Uses GET /2/users/by?usernames=... (batch, 100 per request).
 * Updates seeds/alpha-callers.json in-place.
 *
 * Usage: bun run scripts/resolve-callers.ts
 */
import { readFileSync, writeFileSync } from "fs";
import { dirname, join } from "path";
import { fileURLToPath } from "url";
import { TwitterApi } from "twitter-api-v2";
import { env } from "@/config/env";

const __dirname = dirname(fileURLToPath(import.meta.url));
const SEED_PATH = join(__dirname, "../seeds/alpha-callers.json");

interface Caller {
  handle: string;
  userId: string;
  weight: number;
  tier: number;
  category: string;
  notes?: string;
}

async function main() {
  const data = JSON.parse(readFileSync(SEED_PATH, "utf-8")) as { callers: Caller[] };
  const unresolved = data.callers.filter((c) => !c.userId);

  if (unresolved.length === 0) {
    console.log("All callers already have userIds.");
    return;
  }

  console.log(`Resolving ${unresolved.length} handles...`);

  const client = new TwitterApi(env.X_BEARER_TOKEN);
  const BATCH = 100;
  let resolved = 0;
  let failed: string[] = [];

  for (let i = 0; i < unresolved.length; i += BATCH) {
    const batch = unresolved.slice(i, i + BATCH);
    const usernames = batch.map((c) => c.handle.replace(/^@/, ""));

    try {
      const res = await client.v2.usersByUsernames(usernames, { "user.fields": ["id", "name"] });
      const users = res.data ?? [];

      for (const user of users) {
        const caller = data.callers.find(
          (c) => c.handle.toLowerCase() === user.username.toLowerCase(),
        );
        if (caller) {
          caller.userId = user.id;
          resolved++;
          console.log(`  ✓ @${user.username} → ${user.id}`);
        }
      }

      // Track which ones the API didn't return (suspended/not found)
      const returnedNames = new Set(users.map((u) => u.username.toLowerCase()));
      for (const c of batch) {
        if (!returnedNames.has(c.handle.toLowerCase())) {
          failed.push(c.handle);
          console.log(`  ✗ @${c.handle} — not found`);
        }
      }
    } catch (err) {
      console.error(`Batch ${i}-${i + BATCH} failed:`, err);
    }

    // Small delay between batches to avoid rate limit
    if (i + BATCH < unresolved.length) await new Promise((r) => setTimeout(r, 1000));
  }

  // Remove callers that couldn't be resolved
  if (failed.length > 0) {
    data.callers = data.callers.filter(
      (c) => c.userId || !failed.includes(c.handle),
    );
    console.log(`\nRemoved ${failed.length} unresolvable: ${failed.join(", ")}`);
  }

  writeFileSync(SEED_PATH, JSON.stringify(data, null, 2));
  console.log(`\nDone. Resolved ${resolved}/${unresolved.length} handles.`);
  console.log(`seeds/alpha-callers.json updated.`);
}

main().catch(console.error);
