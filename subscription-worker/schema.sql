-- Westron account + subscription schema (Cloudflare D1 / SQLite)
-- Apply:  wrangler d1 execute westron-db --file=./schema.sql
-- Identity is the ACCOUNT (email). Wallets attach to an account for payment.
-- Private keys are NEVER stored server-side — only email + billing state live here.

CREATE TABLE IF NOT EXISTS users (
  id                TEXT PRIMARY KEY,           -- uuid v4
  email             TEXT UNIQUE NOT NULL,       -- lowercased
  password_hash     TEXT NOT NULL,              -- pbkdf2 "iterations:salt_b64:hash_b64"
  created_at        INTEGER NOT NULL,           -- unix seconds
  trial_expires_at  INTEGER NOT NULL,           -- unix seconds (signup + 7d)
  email_verified    INTEGER NOT NULL DEFAULT 0  -- 0/1 (verification wired later)
);

CREATE TABLE IF NOT EXISTS subscriptions (
  user_id       TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  plan          TEXT,        -- 'monthly' | 'annual' | NULL (never paid)
  activated_at  INTEGER,     -- unix seconds
  expires_at    INTEGER,     -- unix seconds; NULL = no paid period
  last_tx_hash  TEXT
);

-- A user registers the wallet they will PAY FROM. The on-chain payment watcher
-- maps an incoming payment back to the account through this table.
CREATE TABLE IF NOT EXISTS payer_wallets (
  wallet        TEXT PRIMARY KEY,               -- lowercased 0x… address
  user_id       TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  registered_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_payer_wallets_user ON payer_wallets(user_id);

-- Opaque bearer tokens for the app / website session (used by /me, /proxy, etc.)
CREATE TABLE IF NOT EXISTS sessions (
  token       TEXT PRIMARY KEY,                 -- random 32-byte base64url
  user_id     TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at  INTEGER NOT NULL,
  expires_at  INTEGER NOT NULL                  -- unix seconds
);
CREATE INDEX IF NOT EXISTS idx_sessions_user ON sessions(user_id);
