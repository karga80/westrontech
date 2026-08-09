import { env } from "@/config/env";

console.log("SCRAPECREATORS_API_KEY set:", !!env.SCRAPECREATORS_API_KEY);
if (!env.SCRAPECREATORS_API_KEY) {
  console.error("Key not found in env — check .env file");
  process.exit(1);
}
console.log("Key prefix:", env.SCRAPECREATORS_API_KEY.slice(0, 10) + "...");

const res = await fetch("https://api.scrapecreators.com/v1/tiktok/hashtag/videos?hashtag=memecoin&count=5", {
  headers: { "x-api-key": env.SCRAPECREATORS_API_KEY },
});

console.log("HTTP status:", res.status);
const data = await res.json() as { data?: unknown[]; message?: string };
if (!res.ok) {
  console.error("API error:", data);
} else {
  console.log(`Videos returned: ${data.data?.length ?? 0}`);
  console.log("First video:", JSON.stringify(data.data?.[0]).slice(0, 200));
}
