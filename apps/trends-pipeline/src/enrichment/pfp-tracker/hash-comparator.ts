import Jimp from "jimp";
import { createLogger } from "@/shared/logger";

const log = createLogger("hash-comparator");

const SAME_THRESHOLD = 8;
const DIFF_THRESHOLD = 12;
const HASH_SIZE = 16; // 16x16 = 256-bit hash

export async function hashImage(url: string): Promise<string | null> {
  try {
    const image = await Jimp.read(url);
    image.resize(HASH_SIZE, HASH_SIZE).grayscale();

    const pixels: number[] = [];
    image.scan(0, 0, HASH_SIZE, HASH_SIZE, (_x, _y, idx) => {
      pixels.push(image.bitmap.data[idx] as number);
    });

    const avg = pixels.reduce((a, b) => a + b, 0) / pixels.length;
    const hash = pixels.map((p) => (p >= avg ? "1" : "0")).join("");

    // Convert binary string to hex
    const hex = [];
    for (let i = 0; i < hash.length; i += 4) {
      hex.push(parseInt(hash.slice(i, i + 4), 2).toString(16));
    }
    return hex.join("");
  } catch (err) {
    log.warn({ url, err }, "Image hash failed");
    return null;
  }
}

export function hammingDistance(hash1: string, hash2: string): number {
  if (hash1.length !== hash2.length) {
    throw new Error(`Hash length mismatch: ${hash1.length} vs ${hash2.length}`);
  }
  let distance = 0;
  for (let i = 0; i < hash1.length; i++) {
    const b1 = parseInt(hash1[i]!, 16).toString(2).padStart(4, "0");
    const b2 = parseInt(hash2[i]!, 16).toString(2).padStart(4, "0");
    for (let j = 0; j < 4; j++) {
      if (b1[j] !== b2[j]) distance++;
    }
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
