import { xClient } from "@/ingestion/x-client";
import { createLogger } from "@/shared/logger";
import {
  extractOpenseaSlugs,
  extractBlurSlugs,
  extractMagicEdenSlugs,
} from "@/extraction/regex-extractor";

const log = createLogger("collection-resolver");

export interface CollectionResolution {
  collection_slug: string | null;
  confidence: number;
  method: "marketplace_link" | "post_mention" | "unknown";
}

export async function resolveCollection(
  handle: string,
  _imageUrl: string,
): Promise<CollectionResolution> {
  // Method 1: Check user's recent X posts for collection links
  const user = await xClient.resolveHandle(handle);
  if (user?.id) {
    const posts = await xClient.getUserPosts(user.id, undefined, 20);
    for (const post of posts) {
      const opensea = extractOpenseaSlugs(post.text);
      const blur = extractBlurSlugs(post.text);
      const magicEden = extractMagicEdenSlugs(post.text);
      const allSlugs = [...opensea, ...blur, ...magicEden];

      if (allSlugs.length > 0) {
        const slug = allSlugs[0]!;
        log.debug({ handle, slug }, "Collection resolved via post mention");
        return { collection_slug: slug, confidence: 0.7, method: "post_mention" };
      }
    }
  }

  // Method 2: Reservoir image search (when available)
  // Currently no direct image search API — log as unresolved
  log.debug({ handle }, "Collection unresolved — no marketplace links in recent posts");
  return { collection_slug: null, confidence: 0, method: "unknown" };
}
