// One-stop hook for the dashboard / wallet pages: gives you the current
// portfolio (REST snapshot) plus a live-updating stream of new transactions
// for the same wallet (WebSocket).
//
// Strategy:
// 1. On mount, initialize the realtime backend (idempotent).
// 2. Push our wallet/collection/symbol set to the Rust manager.
// 3. Pull a one-time REST snapshot.
// 4. Listen for wallet:tx events; on each event, refresh the snapshot
//    (debounced 500ms) so balances stay in sync with on-chain reality.
// 5. On reconnect (connection event with connected=true after a drop),
//    refresh once more so we don't display stale state from before the drop.

'use client';

import { useEffect, useRef, useState } from 'react';
import {
  getWalletPortfolio,
  realtimeInit,
  realtimeSetWatchSet,
  type WalletPortfolio,
  type WatchSet,
} from '@/lib/tauri';
import {
  useConnectionState,
  useWalletTxStream,
  type WalletTxEvent,
} from './useRealtime';

interface UseRealtimeWalletOpts {
  wallet: string;
  apiKey: string;
  /** Extra collection contract addresses to watch for NFT transfers. */
  collections?: string[];
  /** Token symbols to keep priced live. ETH is always included. */
  priceSymbols?: string[];
  /** Subscribe to newHeads for gas/block info. Default true. */
  subscribeBlocks?: boolean;
}

export interface UseRealtimeWalletResult {
  portfolio: WalletPortfolio | null;
  loading: boolean;
  error: string | null;
  /** Live wallet tx events (most recent first, capped at 200). */
  liveTxs: WalletTxEvent[];
  /** True once we've successfully fetched at least one snapshot. */
  ready: boolean;
  /** WebSocket connection state. */
  connected: boolean | null;
  /** Force a fresh snapshot. */
  refresh: () => void;
}

const isTauri = (): boolean =>
  typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window;

export function useRealtimeWallet(opts: UseRealtimeWalletOpts): UseRealtimeWalletResult {
  const { wallet, apiKey, collections = [], priceSymbols = [], subscribeBlocks = true } = opts;

  const [portfolio, setPortfolio] = useState<WalletPortfolio | null>(null);
  const [loading, setLoading]     = useState<boolean>(true);
  const [error, setError]         = useState<string | null>(null);
  const [ready, setReady]         = useState<boolean>(false);

  const liveTxs = useWalletTxStream();
  const conn    = useConnectionState();

  const refreshTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const prevConnected = useRef<boolean | null>(null);

  // Pull a fresh snapshot (debounced).
  const scheduleRefresh = (delayMs = 500) => {
    if (refreshTimer.current) clearTimeout(refreshTimer.current);
    refreshTimer.current = setTimeout(() => { void doRefresh(); }, delayMs);
  };

  const doRefresh = async () => {
    if (!isTauri() || !apiKey || !wallet) {
      setLoading(false);
      return;
    }
    try {
      const snap = await getWalletPortfolio(wallet, apiKey);
      setPortfolio(snap);
      setError(null);
      setReady(true);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  };

  // Bootstrap: initialize realtime backend + push watch set + first snapshot.
  useEffect(() => {
    if (!isTauri() || !apiKey || !wallet) {
      setLoading(false);
      return;
    }
    let cancelled = false;
    (async () => {
      try {
        await realtimeInit(apiKey);
        const set: WatchSet = {
          wallets: [wallet],
          collections,
          priceSymbols: Array.from(new Set(['ETH', ...priceSymbols])),
          subscribeBlocks,
        };
        await realtimeSetWatchSet(set);
      } catch (e) {
        // Realtime init failure is non-fatal — REST still works.
        // Surface it via console only.
        // eslint-disable-next-line no-console
        console.warn('realtime init failed:', e);
      }
      if (!cancelled) await doRefresh();
    })();
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [wallet, apiKey, JSON.stringify(collections), JSON.stringify(priceSymbols), subscribeBlocks]);

  // On every new wallet tx event matching this wallet, debounce a refresh.
  useEffect(() => {
    if (liveTxs.length === 0) return;
    const head = liveTxs[0];
    if (!head) return;
    const involves =
      head.wallet?.toLowerCase() === wallet.toLowerCase() ||
      head.from?.toLowerCase()   === wallet.toLowerCase() ||
      head.to?.toLowerCase?.()   === wallet.toLowerCase();
    if (involves) scheduleRefresh(500);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [liveTxs[0]?.hash]);

  // On reconnect after a drop, do a reconcile fetch.
  useEffect(() => {
    if (!conn) return;
    const wasDown = prevConnected.current === false;
    prevConnected.current = conn.connected;
    if (wasDown && conn.connected) scheduleRefresh(0);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [conn?.connected]);

  return {
    portfolio,
    loading,
    error,
    liveTxs: liveTxs.filter(
      (e) =>
        e.wallet?.toLowerCase() === wallet.toLowerCase() ||
        e.from?.toLowerCase()   === wallet.toLowerCase() ||
        e.to?.toLowerCase?.()   === wallet.toLowerCase(),
    ),
    ready,
    connected: conn?.connected ?? null,
    refresh: () => scheduleRefresh(0),
  };
}
