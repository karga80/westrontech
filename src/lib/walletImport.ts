// Single source of truth for turning a private key into a wallet identity.
//
// History: the dashboard's Add Wallet modal used the private key itself as the
// wallet address. That wrote the key to localStorage in plaintext and sent it
// to Alchemy as an address query parameter. Every import path must go through
// deriveAddress() so a key can never again be mistaken for an address.

export const PRIVATE_KEY_RE = /^(0x)?[0-9a-fA-F]{64}$/;
export const ETH_ADDRESS_RE = /^0x[0-9a-fA-F]{40}$/;

export function isValidPrivateKey(s: string): boolean {
  return PRIVATE_KEY_RE.test(s.trim());
}

export function isValidAddress(s: string): boolean {
  return ETH_ADDRESS_RE.test(s.trim());
}

/** Strips an optional 0x prefix. Never log or persist the result. */
export function normalizeKey(s: string): string {
  const t = s.trim();
  return t.startsWith('0x') ? t.slice(2) : t;
}

/**
 * Derives the checksummed address for a private key.
 * Throws if the key is malformed — callers should surface the message.
 */
export async function deriveAddress(privateKey: string): Promise<string> {
  if (!isValidPrivateKey(privateKey)) {
    throw new Error('Invalid private key — must be 64 hex characters, optionally 0x prefixed.');
  }
  const { privateKeyToAccount } = await import('viem/accounts');
  const normalized = ('0x' + normalizeKey(privateKey)) as `0x${string}`;
  return privateKeyToAccount(normalized).address;
}

/**
 * Guards against persisting a private key in an address field.
 * A 64-hex string is never a valid address, so treat it as a key that leaked
 * into the wrong slot.
 */
export function looksLikePrivateKey(value: string): boolean {
  return PRIVATE_KEY_RE.test(value.trim());
}
