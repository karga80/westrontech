// Wallet persistence — localStorage-backed, with sensible defaults for browser mode

export interface StoredWallet {
  id: string;
  name: string;
  address: string;
}

const STORAGE_KEY = 'westron_wallets';

// Default wallets used in browser/mock mode
export const DEFAULT_WALLETS: StoredWallet[] = [
  { id: '0', name: 'Main Wallet',   address: '0x3f4a6b2d8e1c9f7a5b3e4d6c2a1f8b3d4e5c6a91c' },
  { id: '1', name: 'DeFi Wallet',   address: '0x1234abcd5678ef901234abcd5678ef901234567890' },
  { id: '2', name: 'Cold Storage',  address: '0xabcdef1234567890abcdef1234567890abcdef12'   },
];

export function loadWallets(): StoredWallet[] {
  try {
    if (typeof window === 'undefined') return DEFAULT_WALLETS;
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw) as StoredWallet[];
      if (Array.isArray(parsed) && parsed.length > 0) return parsed;
    }
  } catch {}
  return DEFAULT_WALLETS;
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

