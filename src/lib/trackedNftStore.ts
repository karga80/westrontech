// Tracked NFT store — localStorage-backed favoriting of individual NFTs.
//
// Each tracked entry is identified by `${contract.toLowerCase()}:${tokenId}`
// so casing differences between APIs and user input don't create duplicates.
// Subscribers can attach with `subscribe()` to react to changes (used by the
// Monitor page "Tracked NFTs" section to stay in sync with the collection
// detail page's star toggles).

export interface TrackedNftNotifications {
  /** Fire when the NFT (re-)lists for sale on any marketplace. */
  onListed: boolean;
  /** Fire when listing price drops below this threshold (ETH). null = disabled. */
  onListedBelow: number | null;
  /** Fire when the NFT sells on-chain. */
  onSold: boolean;
  /** Fire when the NFT transfers without a sale (airdrop, move). */
  onTransferred: boolean;
}

export interface TrackedNft {
  id: string;                 // `${contract_lower}:${tokenId}`
  contract: string;
  tokenId: string;
  name: string;
  collectionSlug: string;
  collectionName: string;
  imageUrl: string | null;
  rarity: number | null;
  lastSaleEth: number | null;
  floorEth: number | null;
  /** Lowest listing for NFTs sharing this one's rarest trait (if known). */
  traitFloorEth: number | null;
  addedAt: number;
  notifications: TrackedNftNotifications;
}

const STORAGE_KEY = 'westron_tracked_nfts';

// In-memory cache — invalidated on every store write.
// Avoids JSON.parse on every isTracked() call (called per NFT card render).
let _cache: Set<string> | null = null;

function getCache(): Set<string> {
  if (_cache === null) {
    _cache = new Set(loadTrackedNfts().map(n => n.id));
  }
  return _cache;
}

function invalidateCache(): void {
  _cache = null;
}

/** @internal Exposed for unit tests only — resets the in-memory cache. */
export function _resetCacheForTesting(): void {
  _cache = null;
}

export const DEFAULT_NOTIFICATIONS: TrackedNftNotifications = {
  onListed: true,
  onListedBelow: null,
  onSold: true,
  onTransferred: false,
};

/** Deterministic id — case-insensitive contract, tokenId preserved. */
export function trackedNftId(contract: string, tokenId: string): string {
  return `${contract.toLowerCase()}:${tokenId}`;
}

export function loadTrackedNfts(): TrackedNft[] {
  try {
    if (typeof window === 'undefined') return [];
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as TrackedNft[];
    if (!Array.isArray(parsed)) return [];
    return parsed;
  } catch {
    return [];
  }
}

function saveTrackedNfts(list: TrackedNft[]): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(list));
  } catch {
    // Storage full / quota exceeded — fail silently; the UI still reflects state
    // via the in-memory subscribers.
  }
  // Rebuild cache directly from the saved list — avoids a re-read on next isTracked().
  _cache = new Set(list.map(n => n.id));
  notify();
}

export function isTracked(contract: string, tokenId: string): boolean {
  const id = trackedNftId(contract, tokenId);
  return getCache().has(id);
}

export function addTrackedNft(
  nft: Omit<TrackedNft, 'id' | 'addedAt' | 'notifications'> & {
    notifications?: Partial<TrackedNftNotifications>;
  },
): TrackedNft {
  const id = trackedNftId(nft.contract, nft.tokenId);
  const existing = loadTrackedNfts();
  const prior = existing.find(n => n.id === id);
  const entry: TrackedNft = {
    id,
    contract: nft.contract,
    tokenId: nft.tokenId,
    name: nft.name,
    collectionSlug: nft.collectionSlug,
    collectionName: nft.collectionName,
    imageUrl: nft.imageUrl,
    rarity: nft.rarity,
    lastSaleEth: nft.lastSaleEth,
    floorEth: nft.floorEth,
    traitFloorEth: nft.traitFloorEth ?? null,
    addedAt: prior?.addedAt ?? Date.now(),
    notifications: { ...DEFAULT_NOTIFICATIONS, ...(prior?.notifications ?? {}), ...(nft.notifications ?? {}) },
  };
  const next = prior
    ? existing.map(n => (n.id === id ? entry : n))
    : [entry, ...existing];
  saveTrackedNfts(next);
  return entry;
}

export function removeTrackedNft(contract: string, tokenId: string): void {
  const id = trackedNftId(contract, tokenId);
  saveTrackedNfts(loadTrackedNfts().filter(n => n.id !== id));
}

export function toggleTrackedNft(
  nft: Omit<TrackedNft, 'id' | 'addedAt' | 'notifications'>,
): boolean {
  if (isTracked(nft.contract, nft.tokenId)) {
    removeTrackedNft(nft.contract, nft.tokenId);
    return false;
  }
  addTrackedNft(nft);
  return true;
}

/** Apply a notification config to an existing tracked NFT (by contract+tokenId). */
export function updateTrackedNftNotifications(
  contract: string,
  tokenId: string,
  patch: Partial<TrackedNftNotifications>,
): void {
  const id = trackedNftId(contract, tokenId);
  const next = loadTrackedNfts().map(n =>
    n.id === id ? { ...n, notifications: { ...n.notifications, ...patch } } : n,
  );
  saveTrackedNfts(next);
}

/** Apply the same notification config to multiple tracked NFTs at once. */
export function bulkUpdateNotifications(
  ids: string[],
  patch: Partial<TrackedNftNotifications>,
): void {
  const set = new Set(ids);
  const next = loadTrackedNfts().map(n =>
    set.has(n.id) ? { ...n, notifications: { ...n.notifications, ...patch } } : n,
  );
  saveTrackedNfts(next);
}

// ── Subscription so React components stay in sync without prop drilling ────

type Listener = () => void;
const listeners = new Set<Listener>();

function notify(): void {
  listeners.forEach(l => { try { l(); } catch { /* swallow */ } });
  if (typeof window !== 'undefined') {
    window.dispatchEvent(new CustomEvent('westron:tracked-nfts-changed'));
  }
}

export function subscribeTrackedNfts(listener: Listener): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}
