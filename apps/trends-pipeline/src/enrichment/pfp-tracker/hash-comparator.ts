import { imageHash } from "image-hash";
import axios from "axios";
import { createLogger } from "@/shared/logger";

const log = createLogger("hash-comparator");

const SAME_THRESHOLD = 8;     // distance < 8 = same image
const DIFF_THRESHOLD = 12;    // distance > 12 = different image (8-12 = recheck)

export async function hashImage(url: string): Promise<string | null> {
  try {
    // Download image to buffer
    const res = await axios.get<ArrayBuffer>(url, { responseType: "arraybuffer", timeout: 10_000 });
    const buffer = Buffer.from(res.data);

    return new Promise((resolve, reject) => {
      imageHash({ data: buffer }, 16, true, (err: Error | null, hash: string) => {
        if (err) {
          log.warn({ url, err: err.message }, "Image hash failed");
          reject(err);
        } else {
          resolve(hash);
        }
      });
    });
  } catch (err) {
    log.warn({ url, err }, "Failed to download image for hashing");
    return null;
  }
}

export function hammingDistance(hash1: string, hash2: string): number {
  if (hash1.length !== hash2.length) {
    throw new Error(`Hash length mismatch: ${hash1.length} vs ${hash2.length}`);
  }
  let distance = 0;
  for (let i = 0; i < hash1.length; i++) {
    if (hash1[i] !== hash2[i]) distance++;
  }
  return distance;
}

export type ImageComparison = "same" | "different" | "uncertain";

export function compareHashes(hash1: string, hash2: string): ImageComparison {
  const dist = hammingDistance(hash1, hash2);
  if (dist < SAME_THRESHOLD) return "same";
  if (dist > DIFF_THRESHOLD) return "different";
  return "uncertain";
}
