/**
 * Westron Subscription Worker
 * Handles on-chain ETH payment detection (via Alchemy webhook) and subscription validation.
 *
 * Deploy: `wrangler deploy`
 * Local:  `wrangler dev`
 */

export interface Env {
  SUBS: KVNamespace;
  // Set these via `wrangler secret put` or in the Cloudflare dashboard
  ALCHEMY_WEBHOOK_SECRET: string; // from Alchemy webhook signing key
  LICENSE_SIGNING_KEY: string;    // base64 PKCS8 DER of the ED25519 private key (see DEPLOY.md)
  // Set these in wrangler.toml [vars] or dashboard environment variables
  PAYMENT_WALLET: string;         // your ETH address that receives payments (lowercase)
  MONTHLY_PRICE_ETH: string;      // e.g. "0.01"
  ANNUAL_PRICE_ETH: string;       // e.g. "0.09"
  PRICE_TOLERANCE: string;        // fractional tolerance e.g. "0.20" = ±20%
}

interface SubRecord {
  plan: 'monthly' | 'annual';
  expires_at: number;   // unix seconds
  tx_hash: string;
  activated_at: number; // unix seconds
}

interface ValidateResponse {
  active: boolean;
  plan: string | null;
  expires_at: string | null; // ISO date string
}

// ── CORS headers ──────────────────────────────────────────────────────────────

function corsHeaders(): Record<string, string> {
  return {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
  };
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json', ...corsHeaders() },
  });
}

// ── Alchemy signature verification ────────────────────────────────────────────

async function verifyAlchemySignature(
  rawBody: string,
  signature: string,
  secret: string
): Promise<boolean> {
  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey(
    'raw', enc.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['verify']
  );
  const sigBytes = hexToBytes(signature);
  return crypto.subtle.verify('HMAC', key, sigBytes, enc.encode(rawBody));
}

function hexToBytes(hex: string): Uint8Array {
  const clean = hex.startsWith('0x') ? hex.slice(2) : hex;
  const bytes = new Uint8Array(clean.length / 2);
  for (let i = 0; i < bytes.length; i++) {
    bytes[i] = parseInt(clean.slice(i * 2, i * 2 + 2), 16);
  }
  return bytes;
}

// ── Price matching ────────────────────────────────────────────────────────────

function matchesTier(
  value: number,
  target: number,
  tolerance: number
): boolean {
  return value >= target * (1 - tolerance) && value <= target * (1 + tolerance);
}

// ── Routes ────────────────────────────────────────────────────────────────────

async function handleValidate(request: Request, env: Env): Promise<Response> {
  let body: { wallet?: string };
  try {
    body = await request.json();
  } catch {
    return json({ error: 'Invalid JSON' }, 400);
  }

  const wallet = body.wallet?.toLowerCase();
  if (!wallet || !/^0x[0-9a-f]{40}$/.test(wallet)) {
    return json({ active: false, plan: null, expires_at: null });
  }

  const record = await env.SUBS.get<SubRecord>(`sub:${wallet}`, 'json');
  if (!record) {
    return json({ active: false, plan: null, expires_at: null });
  }

  const nowSec = Math.floor(Date.now() / 1000);
  const active = record.expires_at > nowSec;

  const response: ValidateResponse = {
    active,
    plan: active ? record.plan : null,
    expires_at: active ? new Date(record.expires_at * 1000).toISOString() : null,
  };
  return json(response);
}

// ── Signed license issuance ───────────────────────────────────────────────────

function base64ToBytes(b64: string): Uint8Array {
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

function bytesToBase64(bytes: Uint8Array): string {
  let bin = '';
  for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
  return btoa(bin);
}

/**
 * Issue a signed license for a wallet with an active subscription.
 * The app verifies the signature offline with the embedded public key.
 */
async function handleLicense(request: Request, env: Env): Promise<Response> {
  let body: { wallet?: string };
  try {
    body = await request.json();
  } catch {
    return json({ error: 'Invalid JSON' }, 400);
  }

  const wallet = body.wallet?.toLowerCase();
  if (!wallet || !/^0x[0-9a-f]{40}$/.test(wallet)) {
    return json({ active: false });
  }

  const record = await env.SUBS.get<SubRecord>(`sub:${wallet}`, 'json');
  const nowSec = Math.floor(Date.now() / 1000);
  if (!record || record.expires_at <= nowSec) {
    return json({ active: false });
  }

  // Canonical payload string — signed verbatim and returned as-is.
  const payload = JSON.stringify({
    wallet,
    plan: record.plan,
    expires_at: record.expires_at,
    issued_at: nowSec,
  });

  const key = await crypto.subtle.importKey(
    'pkcs8',
    base64ToBytes(env.LICENSE_SIGNING_KEY),
    { name: 'Ed25519' },
    false,
    ['sign'],
  );
  const sigBuf = await crypto.subtle.sign('Ed25519', key, new TextEncoder().encode(payload));
  const sig = bytesToBase64(new Uint8Array(sigBuf));

  return json({ active: true, payload, sig });
}

async function handleAlchemyWebhook(request: Request, env: Env): Promise<Response> {
  const rawBody = await request.text();

  // Verify Alchemy signature
  const sig = request.headers.get('x-alchemy-signature') ?? '';
  const valid = await verifyAlchemySignature(rawBody, sig, env.ALCHEMY_WEBHOOK_SECRET);
  if (!valid) {
    return new Response('Unauthorized', { status: 401 });
  }

  let payload: {
    type?: string;
    event?: {
      activity?: Array<{
        fromAddress?: string;
        toAddress?: string;
        value?: number;
        asset?: string;
        category?: string;
        hash?: string;
      }>;
    };
  };

  try {
    payload = JSON.parse(rawBody);
  } catch {
    return new Response('Bad Request', { status: 400 });
  }

  if (payload.type !== 'ADDRESS_ACTIVITY') {
    return new Response('OK', { status: 200 });
  }

  const paymentWallet = env.PAYMENT_WALLET.toLowerCase();
  const monthlyPrice = parseFloat(env.MONTHLY_PRICE_ETH);
  const annualPrice  = parseFloat(env.ANNUAL_PRICE_ETH);
  const tolerance    = parseFloat(env.PRICE_TOLERANCE ?? '0.20');
  const nowSec       = Math.floor(Date.now() / 1000);

  const activity = payload.event?.activity ?? [];

  for (const tx of activity) {
    // Only process incoming ETH to our payment wallet
    if (tx.toAddress?.toLowerCase() !== paymentWallet) continue;
    if (tx.asset !== 'ETH' || tx.category !== 'external') continue;

    const from = tx.fromAddress?.toLowerCase();
    if (!from || !/^0x[0-9a-f]{40}$/.test(from)) continue;

    const value = tx.value ?? 0;

    let plan: 'monthly' | 'annual' | null = null;
    let durationDays = 0;

    if (matchesTier(value, annualPrice, tolerance)) {
      plan = 'annual';
      durationDays = 365;
    } else if (matchesTier(value, monthlyPrice, tolerance)) {
      plan = 'monthly';
      durationDays = 30;
    }

    if (!plan) continue;

    // Check if there's already an active subscription — extend it
    const existing = await env.SUBS.get<SubRecord>(`sub:${from}`, 'json');
    const baseTime = existing && existing.expires_at > nowSec
      ? existing.expires_at
      : nowSec;

    const record: SubRecord = {
      plan,
      expires_at: baseTime + durationDays * 86400,
      tx_hash: tx.hash ?? '',
      activated_at: nowSec,
    };

    await env.SUBS.put(`sub:${from}`, JSON.stringify(record));
  }

  return new Response('OK', { status: 200 });
}

// ── Main handler ──────────────────────────────────────────────────────────────

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);

    if (request.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: corsHeaders() });
    }

    if (request.method === 'POST') {
      if (url.pathname === '/validate') {
        return handleValidate(request, env);
      }
      if (url.pathname === '/license') {
        return handleLicense(request, env);
      }
      if (url.pathname === '/webhook/alchemy') {
        return handleAlchemyWebhook(request, env);
      }
    }

    return new Response('Not found', { status: 404 });
  },
};
