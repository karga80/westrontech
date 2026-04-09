'use client';

import { useEffect } from 'react';
import { useRouter, usePathname } from 'next/navigation';
import { loadWallets } from '@/lib/walletStore';
import { loadAlchemyKey, startBackgroundPolling } from '@/lib/tauri';
import { loadSubscription, saveSubscription } from '@/lib/subscriptionStore';

const isTauri = typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window;

// Request Web Notification permission once on first call.
async function requestNotificationPermission(): Promise<boolean> {
  if (!('Notification' in window)) return false;
  if (Notification.permission === 'granted') return true;
  if (Notification.permission === 'denied') return false;
  const result = await Notification.requestPermission();
  return result === 'granted';
}

function showNotification(title: string, body: string) {
  if (!('Notification' in window) || Notification.permission !== 'granted') return;
  new Notification(title, { body, silent: false });
}

// Returns true only when the user has explicitly saved wallets to localStorage.
// If STORAGE_KEY is absent, loadWallets() returns DEFAULT_WALLETS (mock data).
function hasConfiguredWallets(): boolean {
  try {
    return !!localStorage.getItem('westron_wallets');
  } catch {
    return false;
  }
}

// Fired once on app mount:
// 1. Redirect to /login on first run (no configured wallets)
// 2. Start background alert polling when Alchemy key + wallet are present
export default function AppInit() {
  const router = useRouter();
  const pathname = usePathname();

  useEffect(() => {
    // Skip if already on login page
    if (pathname === '/login') return;

    // Force Pro subscription (internal build — billing not yet live)
    const sub = loadSubscription();
    if (sub.plan === 'free') {
      saveSubscription({
        plan: 'annual',
        activatedAt: new Date().toISOString(),
        expiresAt: new Date(Date.now() + 365 * 24 * 60 * 60 * 1000).toISOString(),
        lastChecked: new Date().toISOString(),
      });
    }

    // First-run check — redirect to onboarding
    if (!hasConfiguredWallets()) {
      router.push('/login');
      return;
    }

    // Background polling + alert notifications (Tauri only)
    if (!isTauri) return;

    let unlisten: (() => void) | undefined;

    (async () => {
      try {
        const apiKey = await loadAlchemyKey();
        if (!apiKey) return;

        const wallets = loadWallets();
        if (!wallets.length) return;

        const addresses = wallets.map(w => w.address);
        await startBackgroundPolling(addresses, apiKey);

        // Request notification permission once wallets are confirmed
        await requestNotificationPermission();

        // Listen for alert-fired events from the Rust engine
        const { listen } = await import('@tauri-apps/api/event');
        unlisten = await listen<{ message: string; alert_type: string }>(
          'alert-fired',
          ({ payload }) => {
            const title = payload.alert_type === 'floor_price'
              ? 'Floor Price Alert'
              : payload.alert_type === 'wallet_activity'
              ? 'Wallet Activity'
              : 'Portfolio Alert';
            showNotification(title, payload.message);
          }
        );
      } catch {
        // Key or wallet not configured yet — silently skip
      }
    })();

    return () => { unlisten?.(); };
  }, [pathname]);

  return null;
}
