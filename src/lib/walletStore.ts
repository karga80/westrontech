// walletStore — localStorage-backed wallet registry.
//
// `kind` separates owned wallets (private key imported, can sign) from
// watched wallets (read-only, monitoring only). Existing entries without a
// `kind` field are treated as 'owned' for backward compatibility.
//
// Usage:
//   loadOwnedWallets()   — dashboard, bulk actions, signing flows
//   loadWatchedWallets() — monitor page wallet watchlist
//   loadWallets()        — all wallets (alerts, generic queries)

export interface StoredWallet {
  id: string;
  name: string;
  address: string;
  /** 'owned' = private key imported (can sign). 'watched' = read-only monitor. */
  kind: 'owned' | 'watched';
  /** User-assigned labels for watched wallets (e.g. 'Whale', 'Trader'). */
  tags?: string[];
}

const STORAGE_KEY = 'westron_wallets';

const VALID_ADDRESS = /^0x[0-9a-fA-F]{40}$/;

/** Migrate legacy entries that predate the `kind` field — default to 'owned'. */
function ensureKind(w: StoredWallet): StoredWallet {
  if (!w.kind) return { ...w, kind: 'owned' };
  return w;
}

/** All wallets (owned + watched). Use specific loaders where possible. */
export function loadWallets(): StoredWallet[] {
  try {
    if (typeof window === 'undefined') return [];
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw) as StoredWallet[];
      if (Array.isArray(parsed)) {
        const valid = parsed
          .filter(w => VALID_ADDRESS.test(w.address))
          .map(ensureKind);
        // Persist migration if any entry lacked a kind field.
        if (valid.some((w, i) => !('kind' in (parsed[i] ?? {})))) saveWallets(valid);
        return valid;
      }
    }
  } catch {}
  return [];
}

/** Wallets with imported private keys — use in dashboard, bulk, signing flows. */
export function loadOwnedWallets(): StoredWallet[] {
  return loadWallets().filter(w => w.kind === 'owned');
}

/** Watch-only wallets — use in the Monitor page wallet watchlist. */
export function loadWatchedWallets(): StoredWallet[] {
  return loadWallets().filter(w => w.kind === 'watched');
}

export function saveWallets(wallets: StoredWallet[]): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(wallets));
  } catch {}
}

export function addWallet(wallet: StoredWallet): void {
  const wallets = loadWallets();
  if (wallets.some(w => w.address.toLowerCase() === wallet.address.toLowerCase())) return;
  wallets.push(wallet);
  saveWallets(wallets);
}

export function removeWallet(id: string): void {
  saveWallets(loadWallets().filter(w => w.id !== id));
}

export function updateWallet(
  id: string,
  patch: Partial<Pick<StoredWallet, 'name' | 'address' | 'tags'>>,
): void {
  saveWallets(loadWallets().map(w => w.id === id ? { ...w, ...patch } : w));
}
