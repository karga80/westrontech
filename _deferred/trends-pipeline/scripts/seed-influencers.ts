import { influencerWeights } from "@/scoring/influencer-weights";
import { createLogger } from "@/shared/logger";
import alphaCallersData from "../seeds/alpha-callers.json" with { type: "json" };
import type { AlphaCaller } from "@/shared/types";

const log = createLogger("seed-influencers");

async function main() {
  const callers: AlphaCaller[] = alphaCallersData.callers as AlphaCaller[];

  if (callers.length === 0) {
    log.warn("No callers in seeds/alpha-callers.json — nothing to seed");
    return;
  }

  await influencerWeights.bulkSet(
    callers.map((c) => ({ handle: c.handle, weight: c.weight })),
  );

  log.info({ count: callers.length }, "Influencer weights seeded");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
