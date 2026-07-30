# Westron

**Native macOS wallet manager for Ethereum investors and NFT traders.**

Westron brings portfolio tracking, an NFT gallery, bulk marketplace actions,
analytics/PnL, real-time alerts, and sniping into one desktop app. Its defining
principle: **your wallet keys stay on your machine and never touch a server.**
Every transaction is signed locally.

> Status: Phase 1–2. Ethereum mainnet only. macOS only.

---

## What makes Westron different

| | Westron | Typical alternatives |
|---|---|---|
| Runs | Native macOS app | Browser web apps |
| Keys | Local only, never sent to a server | Often custodial or web-based |
| Access | Subscription (crypto payment) | NFT pass / whitelist |
| Scope | Portfolio **and** trading **and** analytics | Usually just one of these |

---

## Core features (v1)

- **Portfolio & wallet tracking** — multiple wallets, ETH + ERC-20 balances, history
- **NFT gallery** — ERC-721/1155 with metadata and floor/PnL view
- **Sister Wallet Finder** — from one address, surface likely side-wallets of the
  same owner using on-chain funding + transfer patterns (Etherscan)
- **Bulk actions** — list, bid, cancel on OpenSea, signed locally
- **Analytics & PnL** — realized/unrealized PnL, trade stats
- **Alerts & monitoring** — floor price, wallet activity, portfolio value →
  macOS notifications + Discord/Telegram webhooks
- **Sniping & automation** — floor sniper rules, guarded by the spend-cap engine
- **Subscription** — crypto-only payment, offline-verifiable signed license

---

## Architecture

| Layer | Tech |
|---|---|
| Frontend | Next.js (React) |
| Native shell | **Tauri** (Rust) — decision locked |
| Blockchain data | Alchemy (RPC + NFT + Portfolio + Prices APIs) |
| Marketplace | OpenSea (Seaport 1.6, local signing) |
| Wallet analysis | Etherscan (sister-wallet finder) |
| Key storage | Local, on the user's machine (see Security) |
| Subscription | Cloudflare Worker + Ed25519 signed licenses |

The Rust backend (`src-tauri/`) owns all sensitive work — key storage, transaction
signing, the spend-cap "envelope" engine, data fetching, and license verification.
The React frontend calls into it through Tauri commands (`src/lib/tauri.ts`).

---

## Getting started (development)

Prerequisites: macOS, Node + npm, and the Rust toolchain (`rustup`), plus Xcode
command-line tools.

```bash
npm install
npm run dev:tauri     # builds the Rust backend and opens the desktop app
```

The first build compiles the whole Rust project and can take several minutes.
Web-only preview (no native features): `npm run dev`.

### Required API keys

Open **Settings → Security** in the app and paste:

| Key | Used for | Where to get it |
|---|---|---|
| **Alchemy** | Balances, tokens, prices, NFTs | https://alchemy.com (free tier is plenty) |
| **OpenSea** | NFT floor/collection data, listing/bidding | https://docs.opensea.io |
| **Etherscan** | Sister Wallet Finder | https://etherscan.io/apis (free tier: 5 req/s) |

Keys are stored locally on your machine and used directly from the app.

### Add your wallets

Settings → Security → **Import** (to sign transactions) or add a **watch-only**
address on the Wallets page. Real balances appear once a real, funded address is
added and the Alchemy key is set.

---

## Subscription setup

The subscription system accepts **crypto (ETH) payments only** and issues an
offline-verifiable signed license. Full non-developer walkthrough:
[`subscription-worker/DEPLOY.md`](subscription-worker/DEPLOY.md).

---

## Security model

- Private keys never leave the machine and are never sent to any server.
- All transactions are signed locally and broadcast from the app.
- Every financial or irreversible action passes the spend-cap **envelope** engine
  (per-transaction ceiling, hard cap, scope whitelist, TTL, kill switch, audit log).
- The subscription license is signed by the worker's private key and verified in
  the app with an embedded public key; the private key never ships.

> **Note for maintainers:** key material is currently written to files under the
> app data directory. Before public launch, move this to the macOS Keychain and
> run an independent security review. Tracked as an open hardening item.

---

## Repository layout

```
src/                 Next.js frontend (pages, components, lib)
src-tauri/           Rust backend
  src/wallet/        local key storage
  src/signing/       transaction signing
  src/envelope/      spend-cap / kill-switch engine
  src/data/          Alchemy data layer
  src/marketplace/   OpenSea Seaport integration
  src/sister/        sister-wallet finder (Etherscan)
  src/subscription/  signed-license verification
subscription-worker/ Cloudflare Worker (payment detection + license signing)
_deferred/           modules parked for a later phase (see _deferred/README.md)
```

## Scope & non-goals (v1)

- Ethereum mainnet only — no multi-chain.
- macOS only — no web or mobile.
- Deferred to later phases: Blur, Uniswap swap, the X/TikTok trends pipeline,
  and the omni/tasks screens (all under `_deferred/`).
- Sniping executes in **simulation** for this phase; real on-chain execution is a
  later, separately-gated step.
