// Subscription state — localStorage-backed
// Subscription is identified by the user's wallet address.
// A Cloudflare Worker validates on-chain ETH payments and returns status.

export type PlanType = 'free' | 'monthly' | 'annual';

export interface SubscriptionState {
  plan: PlanType;
  activatedAt: string | null;  // ISO date string
  expiresAt: string | null;    // ISO date string, null = active but unknown expiry
  lastChecked: string | null;  // ISO date string — used for cache invalidation
}

const STORAGE_KEY = 'westron_subscription';
const CACHE_TTL_MS = 24 * 60 * 60 * 1000; // recheck every 24h

// Exported so components can seed useState with the SAME value the server
// produces (hydration-stable), then load the real one in an effect.
export const DEFAULT_SUBSCRIPTION: SubscriptionState = {
  plan: 'free',
  activatedAt: null,
  expiresAt: null,
  lastChecked: null,
};
const DEFAULT_STATE = DEFAULT_SUBSCRIPTION;

export function loadSubscription(): SubscriptionState {
  try {
    if (typeof window === 'undefined') return DEFAULT_STATE;
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) return JSON.parse(raw) as SubscriptionState;
  } catch {}
  return DEFAULT_STATE;
}

export function saveSubscription(state: SubscriptionState): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  } catch {}
}

export function isSubscriptionActive(state: SubscriptionState): boolean {
  if (state.plan === 'free') return false;
  if (!state.expiresAt) return false;
  return new Date(state.expiresAt) > new Date();
}

export function isCacheStale(state: SubscriptionState): boolean {
  if (!state.lastChecked) return true;
  return Date.now() - new Date(state.lastChecked).getTime() > CACHE_TTL_MS;
}

export function planLabel(plan: PlanType): string {
  return plan === 'free' ? 'Free' : plan === 'monthly' ? 'Pro Monthly' : 'Pro Annual';
}
