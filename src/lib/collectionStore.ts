// NFT Collection watchlist — localStorage-backed
import type { CollectionInfo } from './tauri';

export type WatchedCollection = CollectionInfo & { addedAt: number };

const KEY = 'wr_watched_collections';

export function loadCollections(): WatchedCollection[] {
  if (typeof window === 'undefined') return [];
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) {
      const parsed = JSON.parse(raw) as WatchedCollection[];
      if (Array.isArray(parsed)) return parsed;
    }
  } catch {}
  return [];
}

export function saveCollection(info: CollectionInfo): WatchedCollection {
  const entry: WatchedCollection = { ...info, addedAt: Date.now() };
  const existing = loadCollections();
  const updated = existing.find(c => c.slug === info.slug)
    ? existing.map(c => c.slug === info.slug ? entry : c)
    : [...existing, entry];
  localStorage.setItem(KEY, JSON.stringify(updated));
  return entry;
}

export function removeCollection(slug: string): void {
  localStorage.setItem(KEY, JSON.stringify(loadCollections().filter(c => c.slug !== slug)));
}
