// Pure regex extractors — no LLM, deterministic

const CASHTAG_RE = /(?<!\w)\$([A-Z]{2,10})(?!\w)/g;
const EVM_CONTRACT_RE = /0x[a-fA-F0-9]{40}/g;
// Solana base58: 32-44 chars, not all-numeric, not a common English word
const SOL_BASE58_CHARS = "[1-9A-HJ-NP-Za-km-z]";
const SOL_CONTRACT_RE = new RegExp(`(?<![/\\w])${SOL_BASE58_CHARS}{32,44}(?![/\\w])`, "g");
const OPENSEA_SLUG_RE = /opensea\.io\/(?:collection|assets\/ethereum)\/([a-z0-9-]+)/gi;
const BLUR_SLUG_RE = /blur\.io\/collection\/([a-z0-9-]+)/gi;
const MAGIC_EDEN_SLUG_RE = /magiceden\.io\/(?:marketplace|collections?)\/([a-z0-9_-]+)/gi;
const PUMP_FUN_RE = /pump\.fun\/(?:coin\/)?([1-9A-HJ-NP-Za-km-z]{32,44})/gi;

const MINT_KEYWORDS = [
  /just minted/i,
  /WL claim/i,
  /stealth drop/i,
  /mint (?:is )?live/i,
  /minting now/i,
  /allowlist claim/i,
  /public mint/i,
  /free mint/i,
];

const PFP_KEYWORDS = [
  /pfp['']?d/i,
  /new pfp/i,
  /changed (?:my )?pfp/i,
  /switched (?:my )?pfp/i,
  /updated (?:my )?pfp/i,
  /new profile pic/i,
];

const SWEEP_KEYWORDS = [
  /swept the floor/i,
  /floor sweep/i,
  /\d+(?:\.\d+)? ETH (?:bid|offer|sweep)/i,
  /bid'?d? (?:on|the) floor/i,
  /bulk buy/i,
];

// Solana addresses are base58 but we need to filter false positives:
// - known English words that happen to be base58 (rare but possible)
// - strings that look like timestamps or IDs
const SOL_MIN_ENTROPY_RATIO = 0.5; // at least 50% unique chars

function hasSufficientEntropy(s: string): boolean {
  const unique = new Set(s.split("")).size;
  return unique / s.length >= SOL_MIN_ENTROPY_RATIO;
}

function allNumeric(s: string): boolean {
  return /^\d+$/.test(s);
}

export function extractCashtags(text: string): string[] {
  const matches = [...text.matchAll(CASHTAG_RE)];
  return [...new Set(matches.map((m) => `$${m[1]}`))];
}

export function extractEvmContracts(text: string): string[] {
  const matches = text.match(EVM_CONTRACT_RE) ?? [];
  return [...new Set(matches)];
}

export function extractSolanaContracts(text: string): string[] {
  const matches = text.match(SOL_CONTRACT_RE) ?? [];
  return [
    ...new Set(
      matches.filter((m) => !allNumeric(m) && hasSufficientEntropy(m) && m.length >= 32),
    ),
  ];
}

export function extractOpenseaSlugs(text: string): string[] {
  const matches = [...text.matchAll(OPENSEA_SLUG_RE)];
  return [...new Set(matches.map((m) => m[1]).filter(Boolean) as string[])];
}

export function extractBlurSlugs(text: string): string[] {
  const matches = [...text.matchAll(BLUR_SLUG_RE)];
  return [...new Set(matches.map((m) => m[1]).filter(Boolean) as string[])];
}

export function extractMagicEdenSlugs(text: string): string[] {
  const matches = [...text.matchAll(MAGIC_EDEN_SLUG_RE)];
  return [...new Set(matches.map((m) => m[1]).filter(Boolean) as string[])];
}

export function extractPumpFunLinks(text: string): string[] {
  const matches = [...text.matchAll(PUMP_FUN_RE)];
  return [...new Set(matches.map((m) => m[1]).filter(Boolean) as string[])];
}

export function detectMintKeywords(text: string): boolean {
  return MINT_KEYWORDS.some((re) => re.test(text));
}

export function detectPfpKeywords(text: string): boolean {
  return PFP_KEYWORDS.some((re) => re.test(text));
}

export function detectSweepKeywords(text: string): boolean {
  return SWEEP_KEYWORDS.some((re) => re.test(text));
}

export function isCryptoCandiate(text: string): boolean {
  return /\$[A-Z]{2,}|0x[a-fA-F0-9]{10}|mint|drop|ape|fade|send it|moon|pump|nft|floor|sweep|degen|solana|ethereum/i.test(
    text,
  );
}
