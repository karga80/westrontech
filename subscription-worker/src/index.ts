/**
 * Westron backend Worker — accounts + subscription + on-chain payment + API-key proxy.
 *
 * One Worker is the single gate:
 *   • Auth:         POST /signup, POST /login, GET /me, POST /logout
 *   • Subscription: GET /subscription/status, POST /license
 *   • Billing:      GET /billing/quote, POST /billing/register-wallet, POST /webhook/alchemy
 *   • Data proxy:   /proxy/alchemy/*, /proxy/opensea/*, /proxy/etherscan/*  (keys stay server-side)
 *
 * Identity is the ACCOUNT (email). Private keys never touch this Worker.
 * Deploy: see DEPLOY.md.
 */

export interface Env {
  DB: D1Database;
  // Secrets (wrangler secret put …):
  LICENSE_SIGNING_KEY: string;   // base64 PKCS8 DER Ed25519 private key
  ALCHEMY_WEBHOOK_SECRET: string;
  ALCHEMY_KEY: string;           // super-admin app-wide key (never sent to clients)
  OPENSEA_KEY: string;
  ETHERSCAN_KEY: string;
  // Vars (wrangler.toml [vars]):
  PAYMENT_WALLET: string;        // lowercased ETH address that receives payments
  MONTHLY_PRICE_ETH: string;
  ANNUAL_PRICE_ETH: string;
  PRICE_TOLERANCE: string;       // e.g. "0.20"
  TRIAL_DAYS: string;            // e.g. "7"
  SESSION_DAYS: string;          // e.g. "30"
}

// ── tiny helpers ────────────────────────────────────────────────────────────
function corsHeaders(): Record<string, string> {
  return {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
  };
}
function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status, headers: { 'Content-Type': 'application/json', ...corsHeaders() },
  });
}
const nowSec = () => Math.floor(Date.now() / 1000);

function b64(bytes: Uint8Array): string {
  let s = ''; for (const b of bytes) s += String.fromCharCode(b); return btoa(s);
}
function b64url(bytes: Uint8Array): string {
  return b64(bytes).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
function fromB64(s: string): Uint8Array {
  const bin = atob(s); const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i); return out;
}
function randBytes(n: number): Uint8Array { return crypto.getRandomValues(new Uint8Array(n)); }
function uuid(): string { return crypto.randomUUID(); }

// ── password hashing (PBKDF2-SHA256 via Web Crypto) ───────────────────────────
const PBKDF2_ITERS = 100_000;
async function hashPassword(password: string): Promise<string> {
  const salt = randBytes(16);
  const bits = await pbkdf2(password, salt, PBKDF2_ITERS);
  return `${PBKDF2_ITERS}:${b64(salt)}:${b64(new Uint8Array(bits))}`;
}
async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const [itersStr, saltB64, hashB64] = stored.split(':');
  const iters = parseInt(itersStr, 10);
  if (!iters || !saltB64 || !hashB64) return false;
  const bits = await pbkdf2(password, fromB64(saltB64), iters);
  const a = new Uint8Array(bits); const b = fromB64(hashB64);
  if (a.length !== b.length) return false;
  let diff = 0; for (let i = 0; i < a.length; i++) diff |= a[i] ^ b[i]; // constant-time
  return diff === 0;
}
async function pbkdf2(password: string, salt: Uint8Array, iters: number): Promise<ArrayBuffer> {
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(password), 'PBKDF2', false, ['deriveBits']);
  return crypto.subtle.deriveBits({ name: 'PBKDF2', salt, iterations: iters, hash: 'SHA-256' }, key, 256);
}

// ── domain types ──────────────────────────────────────────────────────────────
interface UserRow { id: string; email: string; password_hash: string; created_at: number; trial_expires_at: number; email_verified: number; }
interface SubRow { user_id: string; plan: string | null; activated_at: number | null; expires_at: number | null; last_tx_hash: string | null; }

interface Access { active: boolean; reason: 'paid' | 'trial' | 'none'; plan: string | null; expires_at: number | null; }
function effectiveAccess(user: UserRow, sub: SubRow | null): Access {
  const t = nowSec();
  if (sub?.expires_at && sub.expires_at > t) return { active: true, reason: 'paid', plan: sub.plan, expires_at: sub.expires_at };
  if (user.trial_expires_at > t) return { active: true, reason: 'trial', plan: 'trial', expires_at: user.trial_expires_at };
  return { active: false, reason: 'none', plan: null, expires_at: sub?.expires_at ?? null };
}

// ── session / auth ────────────────────────────────────────────────────────────
async function createSession(env: Env, userId: string): Promise<string> {
  const token = b64url(randBytes(32));
  const created = nowSec();
  const expires = created + parseInt(env.SESSION_DAYS || '30', 10) * 86400;
  await env.DB.prepare('INSERT INTO sessions (token, user_id, created_at, expires_at) VALUES (?, ?, ?, ?)')
    .bind(token, userId, created, expires).run();
  return token;
}
async function userFromRequest(env: Env, request: Request): Promise<UserRow | null> {
  const auth = request.headers.get('Authorization') || '';
  const token = auth.startsWith('Bearer ') ? auth.slice(7) : '';
  if (!token) return null;
  const sess = await env.DB.prepare('SELECT user_id, expires_at FROM sessions WHERE token = ?').bind(token).first<{ user_id: string; expires_at: number }>();
  if (!sess || sess.expires_at <= nowSec()) return null;
  return env.DB.prepare('SELECT * FROM users WHERE id = ?').bind(sess.user_id).first<UserRow>();
}
async function loadSub(env: Env, userId: string): Promise<SubRow | null> {
  return env.DB.prepare('SELECT * FROM subscriptions WHERE user_id = ?').bind(userId).first<SubRow>();
}

// ── Ed25519 account license (offline-verifiable by the app) ───────────────────
async function issueLicense(env: Env, user: UserRow, access: Access): Promise<{ payload: string; sig: string }> {
  const payload = JSON.stringify({
    account_id: user.id,
    email: user.email,
    active: access.active,
    reason: access.reason,
    plan: access.plan,
    expires_at: access.expires_at,
    issued_at: nowSec(),
  });
  const key = await crypto.subtle.importKey('pkcs8', fromB64(env.LICENSE_SIGNING_KEY), { name: 'Ed25519' }, false, ['sign']);
  const sigBuf = await crypto.subtle.sign('Ed25519', key, new TextEncoder().encode(payload));
  return { payload, sig: b64(new Uint8Array(sigBuf)) };
}

// ── auth routes ───────────────────────────────────────────────────────────────
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

async function handleSignup(request: Request, env: Env): Promise<Response> {
  let body: { email?: string; password?: string };
  try { body = await request.json(); } catch { return json({ error: 'invalid_json' }, 400); }
  const email = body.email?.trim().toLowerCase() || '';
  const password = body.password || '';
  if (!EMAIL_RE.test(email)) return json({ error: 'invalid_email' }, 400);
  if (password.length < 8) return json({ error: 'weak_password', message: 'Password must be at least 8 characters.' }, 400);

  const existing = await env.DB.prepare('SELECT id FROM users WHERE email = ?').bind(email).first();
  if (existing) return json({ error: 'email_taken' }, 409);

  const id = uuid();
  const created = nowSec();
  const trialExpires = created + parseInt(env.TRIAL_DAYS || '7', 10) * 86400;
  const pwHash = await hashPassword(password);

  await env.DB.batch([
    env.DB.prepare('INSERT INTO users (id, email, password_hash, created_at, trial_expires_at, email_verified) VALUES (?, ?, ?, ?, ?, 0)')
      .bind(id, email, pwHash, created, trialExpires),
    env.DB.prepare('INSERT INTO subscriptions (user_id, plan, activated_at, expires_at, last_tx_hash) VALUES (?, NULL, NULL, NULL, NULL)')
      .bind(id),
  ]);

  const user: UserRow = { id, email, password_hash: pwHash, created_at: created, trial_expires_at: trialExpires, email_verified: 0 };
  const access = effectiveAccess(user, null);
  const token = await createSession(env, id);
  const license = await issueLicense(env, user, access);
  return json({ token, account: { id, email, trial_expires_at: trialExpires }, access, license }, 201);
}

async function handleLogin(request: Request, env: Env): Promise<Response> {
  let body: { email?: string; password?: string };
  try { body = await request.json(); } catch { return json({ error: 'invalid_json' }, 400); }
  const email = body.email?.trim().toLowerCase() || '';
  const password = body.password || '';
  const user = await env.DB.prepare('SELECT * FROM users WHERE email = ?').bind(email).first<UserRow>();
  if (!user || !(await verifyPassword(password, user.password_hash))) return json({ error: 'invalid_credentials' }, 401);
  const sub = await loadSub(env, user.id);
  const access = effectiveAccess(user, sub);
  const token = await createSession(env, user.id);
  const license = await issueLicense(env, user, access);
  return json({ token, account: { id: user.id, email: user.email, trial_expires_at: user.trial_expires_at }, access, license });
}

async function handleLogout(request: Request, env: Env): Promise<Response> {
  const auth = request.headers.get('Authorization') || '';
  const token = auth.startsWith('Bearer ') ? auth.slice(7) : '';
  if (token) await env.DB.prepare('DELETE FROM sessions WHERE token = ?').bind(token).run();
  return json({ ok: true });
}

async function handleMe(request: Request, env: Env): Promise<Response> {
  const user = await userFromRequest(env, request);
  if (!user) return json({ error: 'unauthorized' }, 401);
  const sub = await loadSub(env, user.id);
  const access = effectiveAccess(user, sub);
  const payer = await env.DB.prepare('SELECT wallet FROM payer_wallets WHERE user_id = ?').bind(user.id).all<{ wallet: string }>();
  return json({
    account: { id: user.id, email: user.email, email_verified: !!user.email_verified, trial_expires_at: user.trial_expires_at },
    access,
    payer_wallets: (payer.results ?? []).map(r => r.wallet),
  });
}

async function handleSubStatus(request: Request, env: Env): Promise<Response> {
  const user = await userFromRequest(env, request);
  if (!user) return json({ error: 'unauthorized' }, 401);
  const sub = await loadSub(env, user.id);
  return json(effectiveAccess(user, sub));
}

async function handleLicense(request: Request, env: Env): Promise<Response> {
  const user = await userFromRequest(env, request);
  if (!user) return json({ error: 'unauthorized' }, 401);
  const sub = await loadSub(env, user.id);
  const access = effectiveAccess(user, sub);
  const license = await issueLicense(env, user, access);
  return json({ access, license });
}

// ── billing ───────────────────────────────────────────────────────────────────
function handleQuote(env: Env): Response {
  return json({
    payment_wallet: env.PAYMENT_WALLET.toLowerCase(),
    monthly_eth: parseFloat(env.MONTHLY_PRICE_ETH),
    annual_eth: parseFloat(env.ANNUAL_PRICE_ETH),
  });
}

async function handleRegisterWallet(request: Request, env: Env): Promise<Response> {
  const user = await userFromRequest(env, request);
  if (!user) return json({ error: 'unauthorized' }, 401);
  let body: { wallet?: string };
  try { body = await request.json(); } catch { return json({ error: 'invalid_json' }, 400); }
  const wallet = body.wallet?.trim().toLowerCase() || '';
  if (!/^0x[0-9a-f]{40}$/.test(wallet)) return json({ error: 'invalid_wallet' }, 400);
  // A payer wallet maps to exactly one account.
  const owner = await env.DB.prepare('SELECT user_id FROM payer_wallets WHERE wallet = ?').bind(wallet).first<{ user_id: string }>();
  if (owner && owner.user_id !== user.id) return json({ error: 'wallet_in_use' }, 409);
  await env.DB.prepare('INSERT OR IGNORE INTO payer_wallets (wallet, user_id, registered_at) VALUES (?, ?, ?)')
    .bind(wallet, user.id, nowSec()).run();
  return json({ ok: true, wallet });
}

function matchesTier(value: number, target: number, tol: number): boolean {
  return value >= target * (1 - tol) && value <= target * (1 + tol);
}

// HMAC verify for Alchemy webhook
async function verifyAlchemySignature(rawBody: string, signature: string, secret: string): Promise<boolean> {
  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey('raw', enc.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['verify']);
  const sig = fromHex(signature);
  return crypto.subtle.verify('HMAC', key, sig, enc.encode(rawBody));
}
function fromHex(hex: string): Uint8Array {
  const clean = hex.startsWith('0x') ? hex.slice(2) : hex;
  const out = new Uint8Array(clean.length / 2);
  for (let i = 0; i < out.length; i++) out[i] = parseInt(clean.slice(i * 2, i * 2 + 2), 16);
  return out;
}

async function handleAlchemyWebhook(request: Request, env: Env): Promise<Response> {
  const rawBody = await request.text();
  const sig = request.headers.get('x-alchemy-signature') ?? '';
  if (!(await verifyAlchemySignature(rawBody, sig, env.ALCHEMY_WEBHOOK_SECRET))) return new Response('Unauthorized', { status: 401 });

  let payload: { type?: string; event?: { activity?: Array<{ fromAddress?: string; toAddress?: string; value?: number; asset?: string; category?: string; hash?: string }> } };
  try { payload = JSON.parse(rawBody); } catch { return new Response('Bad Request', { status: 400 }); }
  if (payload.type !== 'ADDRESS_ACTIVITY') return new Response('OK', { status: 200 });

  const paymentWallet = env.PAYMENT_WALLET.toLowerCase();
  const monthly = parseFloat(env.MONTHLY_PRICE_ETH);
  const annual = parseFloat(env.ANNUAL_PRICE_ETH);
  const tol = parseFloat(env.PRICE_TOLERANCE ?? '0.20');
  const t = nowSec();

  for (const tx of payload.event?.activity ?? []) {
    if (tx.toAddress?.toLowerCase() !== paymentWallet) continue;
    if (tx.asset !== 'ETH' || tx.category !== 'external') continue;
    const from = tx.fromAddress?.toLowerCase();
    if (!from || !/^0x[0-9a-f]{40}$/.test(from)) continue;

    // Map the paying wallet → account.
    const payer = await env.DB.prepare('SELECT user_id FROM payer_wallets WHERE wallet = ?').bind(from).first<{ user_id: string }>();
    if (!payer) continue; // payment from an unregistered wallet — ignored (can't attribute)

    const value = tx.value ?? 0;
    let plan: 'monthly' | 'annual' | null = null; let days = 0;
    if (matchesTier(value, annual, tol)) { plan = 'annual'; days = 365; }
    else if (matchesTier(value, monthly, tol)) { plan = 'monthly'; days = 30; }
    if (!plan) continue;

    const sub = await loadSub(env, payer.user_id);
    const base = sub?.expires_at && sub.expires_at > t ? sub.expires_at : t;
    await env.DB.prepare('UPDATE subscriptions SET plan = ?, activated_at = ?, expires_at = ?, last_tx_hash = ? WHERE user_id = ?')
      .bind(plan, t, base + days * 86400, tx.hash ?? '', payer.user_id).run();
  }
  return new Response('OK', { status: 200 });
}

// ── API-key proxy (keys stay server-side; access-gated) ───────────────────────
// The app calls these instead of Alchemy/OpenSea/Etherscan directly, with its
// session token. The Worker injects the real key and refuses if access is off.
async function handleProxy(request: Request, env: Env, url: URL): Promise<Response> {
  const user = await userFromRequest(env, request);
  if (!user) return json({ error: 'unauthorized' }, 401);
  const access = effectiveAccess(user, await loadSub(env, user.id));
  if (!access.active) return json({ error: 'subscription_inactive' }, 402);

  const parts = url.pathname.split('/').filter(Boolean); // ['proxy', provider, ...rest]
  const provider = parts[1];
  const rest = parts.slice(2).join('/');
  const search = url.search; // forwarded query (never contains a key)

  let upstream: string;
  const headers: Record<string, string> = {};
  const init: RequestInit = { method: request.method, headers };

  if (provider === 'alchemy') {
    // /proxy/alchemy/rpc            → JSON-RPC (POST)   eth-mainnet.g.alchemy.com/v2/KEY
    // /proxy/alchemy/nft/<path>     → api.g.alchemy.com/nft/<path>?…&  (key in path segment)
    // /proxy/alchemy/prices/<path>  → api.g.alchemy.com/prices/v1/<path>  (Bearer KEY)
    // /proxy/alchemy/data/<path>    → api.g.alchemy.com/data/<path>   (Bearer KEY)
    if (rest === 'rpc' || rest === '') {
      upstream = `https://eth-mainnet.g.alchemy.com/v2/${env.ALCHEMY_KEY}`;
      init.body = request.body; headers['Content-Type'] = 'application/json';
    } else if (rest.startsWith('nft/')) {
      upstream = `https://eth-mainnet.g.alchemy.com/nft/${env.ALCHEMY_KEY}/${rest.slice(4)}${search}`;
    } else if (rest.startsWith('prices/') || rest.startsWith('data/')) {
      upstream = `https://api.g.alchemy.com/${rest}${search}`;
      headers['Authorization'] = `Bearer ${env.ALCHEMY_KEY}`;
      if (request.method === 'POST') { init.body = request.body; headers['Content-Type'] = 'application/json'; }
    } else {
      return json({ error: 'unknown_alchemy_route' }, 400);
    }
  } else if (provider === 'opensea') {
    upstream = `https://api.opensea.io/${rest}${search}`;
    headers['X-API-KEY'] = env.OPENSEA_KEY;
    if (request.method === 'POST') { init.body = request.body; headers['Content-Type'] = 'application/json'; }
  } else if (provider === 'etherscan') {
    // Etherscan v2 takes the key as a query param — append it server-side.
    const sep = search ? '&' : '?';
    upstream = `https://api.etherscan.io/v2/${rest}${search}${sep}apikey=${env.ETHERSCAN_KEY}`;
  } else {
    return json({ error: 'unknown_provider' }, 404);
  }

  const upstreamRes = await fetch(upstream, init);
  const resHeaders = new Headers(upstreamRes.headers);
  for (const [k, v] of Object.entries(corsHeaders())) resHeaders.set(k, v);
  return new Response(upstreamRes.body, { status: upstreamRes.status, headers: resHeaders });
}

// ── router ────────────────────────────────────────────────────────────────────
export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: corsHeaders() });

    try {
      const p = url.pathname;
      if (p.startsWith('/proxy/')) return await handleProxy(request, env, url);

      if (request.method === 'POST') {
        if (p === '/signup') return await handleSignup(request, env);
        if (p === '/login') return await handleLogin(request, env);
        if (p === '/logout') return await handleLogout(request, env);
        if (p === '/license') return await handleLicense(request, env);
        if (p === '/billing/register-wallet') return await handleRegisterWallet(request, env);
        if (p === '/webhook/alchemy') return await handleAlchemyWebhook(request, env);
      }
      if (request.method === 'GET') {
        if (p === '/me') return await handleMe(request, env);
        if (p === '/subscription/status') return await handleSubStatus(request, env);
        if (p === '/billing/quote') return handleQuote(env);
        if (p === '/health') return json({ ok: true });
      }
    } catch (e) {
      return json({ error: 'server_error', message: e instanceof Error ? e.message : String(e) }, 500);
    }
    return json({ error: 'not_found' }, 404);
  },
};
