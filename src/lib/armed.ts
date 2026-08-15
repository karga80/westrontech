/**
 * Arm-at-creation helpers — the display side of `wallet::armed` in Rust.
 *
 * A scheduled rule can only sign while its wallet is armed: the key sits in
 * memory for a window the user approved once with Touch ID, and quitting the
 * app ends that window. Every screen that shows an armed wallet has to be able
 * to say how long is left and what happens when it runs out, so that logic
 * lives here rather than being retyped per screen.
 */

import type { ArmedStatus } from './tauri';

/** Same ceiling as `wallet::armed::MAX_TTL_HOURS` — keep the two in step. */
export const MAX_ARM_TTL_HOURS = 168;
/** Same default as `wallet::armed::DEFAULT_TTL_HOURS`. */
export const DEFAULT_ARM_TTL_HOURS = 48;

/**
 * Whether the window is still open *right now*. The backend also drops an
 * expired session on read; this is the same check done locally so the screen
 * stops claiming "armed" the second the clock runs out, without waiting for a
 * poll to come back.
 */
export function isArmedAt(status: ArmedStatus | undefined, nowSec: number): boolean {
  if (!status || !status.armed || status.expires_at === null) return false;
  return status.expires_at > nowSec;
}

/** `2d 5h`, `4h 12m`, `13m 05s`, or `expired`. */
export function formatRemaining(expiresAtSec: number, nowSec: number): string {
  const left = expiresAtSec - nowSec;
  if (left <= 0) return 'expired';
  const days = Math.floor(left / 86400);
  const hours = Math.floor((left % 86400) / 3600);
  const minutes = Math.floor((left % 3600) / 60);
  const seconds = left % 60;
  if (days > 0) return `${days}d ${hours}h`;
  if (hours > 0) return `${hours}h ${minutes}m`;
  return `${minutes}m ${String(seconds).padStart(2, '0')}s`;
}

/** Absolute end of the window, in the user's own locale and timezone. */
export function formatExpiryClock(expiresAtSec: number): string {
  return new Date(expiresAtSec * 1000).toLocaleString();
}

/**
 * Turns an arm failure into something a user can act on. A cancelled Touch ID
 * prompt is the common case and it is *not* an error the user needs decoding —
 * but it must still be said out loud, because the rule was not created.
 */
export function explainArmError(raw: string): string {
  const e = raw.toLowerCase();
  if (e.includes('cancel') || e.includes('-128')) {
    return 'Touch ID was cancelled — the rule was not created. Your entries are still here; press Arm & Create to try again.';
  }
  // `no matching entry` is the one that actually fires: the keystore's
  // NOT_FOUND text is "No matching entry found in secure storage", which
  // `fetch_and_verify_key` wraps as "wallet key unavailable: ...". None of the
  // other spellings below appear in it — they are kept for the legacy Keychain
  // paths that phrase the same condition differently.
  if (
    e.includes('no matching entry') ||
    e.includes('not found') ||
    e.includes('no such') ||
    e.includes('keychain')
  ) {
    return 'No stored key was found for this wallet. Import the wallet first — a scheduled rule needs a key it can sign with.';
  }
  if (e.includes('empty')) {
    return 'The stored key for this wallet is empty. Re-import the wallet before arming it.';
  }
  if (e.includes('poisoned')) {
    return 'The arming session store is in a bad state. Quit and reopen Westron, then arm again.';
  }
  return raw;
}

/** Normalises an address the way Rust does before it keys a session. */
export function armKey(address: string): string {
  return address.trim().toLowerCase();
}
