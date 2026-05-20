/**
 * Formatting and parsing utilities for block numbers and percentages.
 * All functions are pure and safe against undefined/null/NaN inputs.
 */

/**
 * Parse a display block number string into a numeric value for sorting.
 * The em-dash sentinel ('—'), empty string, and undefined all sort last
 * by returning Number.MAX_SAFE_INTEGER.
 */
export function formatBlockNum(raw: string | undefined): number {
  if (raw === undefined || raw === '' || raw === '—') {
    return Number.MAX_SAFE_INTEGER;
  }
  const n = parseInt(raw.replace(/,/g, ''), 10);
  return isNaN(n) ? Number.MAX_SAFE_INTEGER : n;
}

/**
 * Parse a hex block number string (e.g. '0xc3500') into a decimal number.
 * Returns 0 for undefined, empty string, or any malformed input.
 */
export function parseHexBlock(hex: string | undefined): number {
  if (!hex) return 0;
  const n = parseInt(hex, 16);
  return isNaN(n) ? 0 : n;
}

/**
 * Format a change percentage number as a signed display string.
 * Returns '—' for null, undefined, NaN, or non-finite values.
 * Examples: 1.5 → '+1.50%', -2.3 → '-2.30%'
 */
export function formatChangePct(pct: number | null | undefined): string {
  if (pct === null || pct === undefined || !isFinite(pct) || isNaN(pct)) {
    return '—';
  }
  const sign = pct >= 0 ? '+' : '';
  return `${sign}${pct.toFixed(2)}%`;
}
