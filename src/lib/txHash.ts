/**
 * Transaction hash honesty helpers.
 *
 * The sniping engine does not fulfil anything yet — it returns a placeholder
 * shaped like `0xSIMULATED_snipe_<rule>_<n>` (see `sniping/engine.rs`). That
 * string is not a transaction: nothing was signed and nothing was broadcast.
 * Any screen that shows a hash has to be able to tell the two apart, because
 * rendering a placeholder as a real hash — worse, as an Etherscan link — makes
 * the app claim a trade that never happened.
 */

/** Prefix the Rust engine uses for its placeholder hashes. */
export const SIMULATED_HASH_PREFIX = '0xSIMULATED';

/** True when the hash is a placeholder, i.e. nothing was actually sent. */
export function isSimulatedHash(hash: string | null | undefined): boolean {
  if (!hash) return false;
  // Both sides uppercased: `toUpperCase()` also turns the `0x` into `0X`, so
  // comparing against the mixed-case prefix would never match.
  return hash.toUpperCase().startsWith(SIMULATED_HASH_PREFIX.toUpperCase());
}

/** A real 32-byte transaction hash — the only kind worth linking to a chain explorer. */
export function isRealTxHash(hash: string | null | undefined): boolean {
  if (!hash) return false;
  return /^0x[0-9a-fA-F]{64}$/.test(hash);
}
