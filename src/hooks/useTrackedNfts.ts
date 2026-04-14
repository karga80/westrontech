// React hook for the tracked-NFT list with automatic re-renders when the
// underlying localStorage record changes (triggered by favorite toggles on
// the collection detail page, bulk updates, etc.).

'use client';

import { useEffect, useState } from 'react';
import { loadTrackedNfts, subscribeTrackedNfts, type TrackedNft } from '@/lib/trackedNftStore';

export function useTrackedNfts(): TrackedNft[] {
  const [nfts, setNfts] = useState<TrackedNft[]>(() => loadTrackedNfts());

  useEffect(() => {
    setNfts(loadTrackedNfts());
    const unsubscribe = subscribeTrackedNfts(() => setNfts(loadTrackedNfts()));
    // Cross-tab sync (unlikely in a Tauri desktop app but harmless): listen
    // for storage events so two windows stay coherent.
    const onStorage = (e: StorageEvent) => {
      if (e.key === 'westron_tracked_nfts') setNfts(loadTrackedNfts());
    };
    window.addEventListener('storage', onStorage);
    return () => {
      unsubscribe();
      window.removeEventListener('storage', onStorage);
    };
  }, []);

  return nfts;
}
