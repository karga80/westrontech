import type { WatchlistItem } from './types';
import { fetchTwitterData } from './twitter';
import { fetchOnChainData } from './helius';
import { fetchPriceData }   from './birdeye';
import { fetchOpenSeaData } from './opensea';
import { fetchWhaleData }   from './whale';
import { calculateTokenScore, calculateNFTScore, checkScoreAlert, checkFloorAlert } from './scoring';
import type { OpenSeaData, ScoreSnapshot } from './types';

// ─── Interval map ─────────────────────────────────────────────────────────────

const INTERVAL_MS: Record<string, number> = {
  '15m':    15 * 60 * 1000,
  '1h':     60 * 60 * 1000,
  '4h':  4 * 60 * 60 * 1000,
  'manual': 0,   // no auto-schedule
};

// ─── Job registry ─────────────────────────────────────────────────────────────

const jobs = new Map<string, ReturnType<typeof setInterval>>();

export interface SchedulerCallbacks {
  onScoreUpdate: (watchlistId: string, snapshot: ScoreSnapshot) => void;
  onScoreAlert:  (watchlistId: string, prev: ScoreSnapshot, next: ScoreSnapshot) => void;
  onFloorAlert:  (watchlistId: string, next: OpenSeaData) => void;
  onKolAlert:    (watchlistId: string, kolHandle: string) => void;
  onLoading:     (watchlistId: string, val: boolean) => void;
  getKolHandles: () => string[];
  getPrevScore:  (watchlistId: string) => ScoreSnapshot | undefined;
  getPrevFloor:  (watchlistId: string) => OpenSeaData | undefined;
}

// ─── Fetch + score one item ───────────────────────────────────────────────────

async function runItem(item: WatchlistItem, cbs: SchedulerCallbacks): Promise<void> {
  cbs.onLoading(item.id, true);

  try {
    const kolHandles = cbs.getKolHandles();
    const prevScore  = cbs.getPrevScore(item.id);

    if (item.type === 'token') {
      const [twitter, onchain, price] = await Promise.allSettled([
        fetchTwitterData(item.contractAddress, item.twitterUrl, kolHandles, item.analysisDays),
        fetchOnChainData(item.contractAddress),
        fetchPriceData(item.contractAddress),
      ]);

      const result = {
        watchlistId: item.id,
        twitter: twitter.status === 'fulfilled' ? twitter.value : undefined,
        onchain: onchain.status === 'fulfilled' ? onchain.value : undefined,
        price:   price.status === 'fulfilled'   ? price.value   : undefined,
      };

      const snapshot = calculateTokenScore(result);
      cbs.onScoreUpdate(item.id, snapshot);

      // KOL alert
      if (result.twitter) {
        for (const kol of result.twitter.kolMentions) {
          cbs.onKolAlert(item.id, kol.handle);
        }
      }

      // Score change alert
      if (checkScoreAlert(prevScore, snapshot)) {
        cbs.onScoreAlert(item.id, prevScore!, snapshot);
      }
    } else {
      const prevFloor = cbs.getPrevFloor(item.id);

      const [twitter, openSea, whale] = await Promise.allSettled([
        fetchTwitterData(item.contractAddress, item.twitterUrl, kolHandles, item.analysisDays),
        fetchOpenSeaData(item.contractAddress, item.openSeaUrl ?? ''),
        fetchWhaleData(item.contractAddress),
      ]);

      const result = {
        watchlistId: item.id,
        twitter: twitter.status === 'fulfilled' ? twitter.value   : undefined,
        openSea: openSea.status === 'fulfilled' ? openSea.value   : undefined,
        whale:   whale.status === 'fulfilled'   ? whale.value     : undefined,
      };

      const snapshot = calculateNFTScore(result);
      cbs.onScoreUpdate(item.id, snapshot);

      // Floor alert
      if (result.openSea && checkFloorAlert(prevFloor, result.openSea)) {
        cbs.onFloorAlert(item.id, result.openSea);
      }

      // KOL alert
      if (result.twitter) {
        for (const kol of result.twitter.kolMentions) {
          cbs.onKolAlert(item.id, kol.handle);
        }
      }

      // Score alert
      if (checkScoreAlert(prevScore, snapshot)) {
        cbs.onScoreAlert(item.id, prevScore!, snapshot);
      }
    }
  } finally {
    cbs.onLoading(item.id, false);
  }
}

// ─── Public API ───────────────────────────────────────────────────────────────

/** Manually trigger a single item fetch (also used for 'manual' interval) */
export async function triggerItem(item: WatchlistItem, cbs: SchedulerCallbacks): Promise<void> {
  return runItem(item, cbs);
}

/** Schedule a watchlist item for periodic auto-update */
export function scheduleItem(item: WatchlistItem, cbs: SchedulerCallbacks): void {
  if (item.updateInterval === 'manual') return;
  const ms = INTERVAL_MS[item.updateInterval];
  if (!ms) return;

  unscheduleItem(item.id);

  // Run immediately on first schedule
  void runItem(item, cbs);

  const handle = setInterval(() => void runItem(item, cbs), ms);
  jobs.set(item.id, handle);
}

/** Cancel an item's scheduled job */
export function unscheduleItem(id: string): void {
  const existing = jobs.get(id);
  if (existing !== undefined) {
    clearInterval(existing);
    jobs.delete(id);
  }
}

/** Re-schedule all items (called on app init / watchlist load) */
export function rescheduleAll(items: WatchlistItem[], cbs: SchedulerCallbacks): void {
  // Cancel all
  for (const id of jobs.keys()) unscheduleItem(id);
  // Schedule non-manual
  for (const item of items) scheduleItem(item, cbs);
}

/** Cancel all scheduled jobs (cleanup) */
export function clearAllJobs(): void {
  for (const id of jobs.keys()) unscheduleItem(id);
}
