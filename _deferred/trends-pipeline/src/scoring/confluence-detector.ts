import { createLogger } from "@/shared/logger";
import type { FinalAlert, AlertTier } from "@/shared/types";

const log = createLogger("confluence-detector");

const CONFLUENCE_WINDOW_MS = 15 * 60 * 1000; // 15 minutes
const CONFLUENCE_BOOST = 1.5;
const MIN_SOURCES_FOR_BOOST = 3;

const TIER_THRESHOLDS: Record<AlertTier, number> = {
  yellow: 3.0,
  orange: 6.0,
  red: 10.0,
};

interface SourceEntry {
  source: string;
  ts: number;
}

// In-memory map: identifier → recent sources
const confluenceMap = new Map<string, SourceEntry[]>();

function cleanOldEntries(entries: SourceEntry[]): SourceEntry[] {
  const cutoff = Date.now() - CONFLUENCE_WINDOW_MS;
  return entries.filter((e) => e.ts > cutoff);
}

function getTier(score: number): AlertTier {
  if (score >= TIER_THRESHOLDS.red) return "red";
  if (score >= TIER_THRESHOLDS.orange) return "orange";
  return "yellow";
}

export function recordSignalSource(identifier: string, source: string): void {
  const existing = confluenceMap.get(identifier) ?? [];
  const cleaned = cleanOldEntries(existing);
  cleaned.push({ source, ts: Date.now() });
  confluenceMap.set(identifier, cleaned);
}

export function applyConfluenceBoost(alert: FinalAlert, newSource: string): FinalAlert {
  recordSignalSource(alert.identifier, newSource);

  const entries = confluenceMap.get(alert.identifier) ?? [];
  const uniqueSources = [...new Set(entries.map((e) => e.source))];

  if (uniqueSources.length < MIN_SOURCES_FOR_BOOST) {
    return { ...alert, confluenceCount: uniqueSources.length, confluenceSources: uniqueSources };
  }

  const boostedScore = alert.score * CONFLUENCE_BOOST;
  const tier = getTier(boostedScore);

  log.info(
    { identifier: alert.identifier, sources: uniqueSources, originalScore: alert.score, boostedScore },
    "Confluence boost applied",
  );

  return {
    ...alert,
    score: parseFloat(boostedScore.toFixed(2)),
    tier,
    confluenceCount: uniqueSources.length,
    confluenceSources: uniqueSources,
  };
}

// Cleanup stale entries periodically
export function pruneConfluenceMap(): void {
  for (const [key, entries] of confluenceMap.entries()) {
    const cleaned = cleanOldEntries(entries);
    if (cleaned.length === 0) {
      confluenceMap.delete(key);
    } else {
      confluenceMap.set(key, cleaned);
    }
  }
}
