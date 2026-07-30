// Wallet persistence — localStorage-backed. Real wallets only; no seeded mock data.

export interface StoredWallet {
  id: string;
  name: string;
  address: string;
}

const STORAGE_KEY = 'westron_wallets';

// Kept as an empty export for backward-compat with any importer. Westron seeds
// NO fake wallets — the app starts empty and shows only wallets the user adds.
export const DEFAULT_WALLETS: StoredWallet[] = [];

export function loadWallets(): StoredWallet[] {
  try {
    if (typeof window === 'undefined') return [];
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw) as StoredWallet[];
      if (Array.isArray(parsed)) return parsed;
    }
  } catch {}
  return [];
}

export function saveWallets(wallets: StoredWallet[]): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(wallets));
  } catch {}
}

export function addWallet(wallet: StoredWallet): void {
  const wallets = loadWallets();
  // Prevent duplicates by address
  if (wallets.some(w => w.address.toLowerCase() === wallet.address.toLowerCase())) return;
  wallets.push(wallet);
  saveWallets(wallets);
}

export function removeWallet(id: string): void {
  saveWallets(loadWallets().filter(w => w.id !== id));
}

export function updateWallet(id: string, patch: Partial<Pick<StoredWallet, 'name' | 'address'>>): void {
  saveWallets(loadWallets().map(w => w.id === id ? { ...w, ...patch } : w));
}

