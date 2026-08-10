# Westron — STATUS

Live truth. Disk and git win over this file if they disagree — fix this file, not your assumptions.
Full feature/architecture overview: `README.md`. This file tracks what's proven vs mock vs blocked.

## Update (2026-08-10): T17 — Wallet-level autonomy policies, done, security-reviewed, real click-through

**What it is:** a wallet-level autonomy gate in front of every real signing/marketplace path
(ETH sends, NFT transfers, marketplace list/bid/cancel). Each wallet is `manual` / `assisted` /
`autonomous`; `autonomous` mode only ever lets `Mint` auto-execute, and only within an active,
unexpired rule (contract allowlist, per-tx cap, total budget cap, rate limit) — every other
action type always requires manual approval, no matter the mode. Global kill switch overrides
everything. Full spec: `docs/WALLET_AUTONOMY_POLICY_BRIEF.md`.

**Real, not mock:** real Rust engine (`src-tauri/src/autonomy/engine.rs`, a pure `evaluate()`
backing both the read-only preview and the budget-consuming `check_and_authorize`, same pattern
as the envelope engine), real per-wallet JSON persistence (`autonomy/store.rs`), real
hash-chained tamper-evident audit log (`autonomy/audit.rs`, keccak256-linked JSONL, verified by
real tamper tests), real pending-approval queue (`autonomy/pending.rs` +
`list/approve/reject_action_proposal` Tauri commands), real UI
(`src/app/settings/AutonomySection.tsx`). Sniping stays simulation-mode — unchanged, out of
scope for T17, already correctly documented in `MOCKS.md`.

**Build order (5 phases):** (a) pure policy engine + rule precedence chain, (b) persistent
per-wallet policy store, (c) hash-chained audit log, (d) wiring into the real signing/
marketplace commands, (e) pending-approval queue + settings UI (mode selector, rule create/
delete, audit log view, kill-switch link).

**Security review found 2 CRITICAL + 1 MEDIUM, all fixed and tested this session:**
1. **CRITICAL** — `LocalSigner::sign_and_send` never verified the caller-supplied
   `wallet_address` against the key it actually signed with. Fixed by sharing
   `wallet::keychain::fetch_and_verify_key` (derives the address from the key itself, rejects
   on mismatch) between `marketplace/client.rs` and `signing/mod.rs` — one implementation, not
   two that could drift apart.
2. **CRITICAL** — `approve_action_proposal` had no atomic claim step: two concurrent calls for
   the same pending proposal (double-click, retried IPC call) could both execute — a real
   double-send or double-order-submit. Fixed with an in-memory `Mutex<HashSet<String>>` claim,
   tested with genuinely concurrent OS threads and `tokio` tasks confirming only one execution
   ever gets through.
3. **MEDIUM** — the audit log's `verify_chain` existed and was tested but was never called
   before allowing execution — a tampered/corrupted chain would not have stopped anything.
   Now runs at the top of `check_and_authorize`; a broken chain fails closed (`Deny`) for that
   wallet. Tested by corrupting a real audit file on disk and confirming the next check denies.

**Verified:** `cargo check --lib` clean, `cargo test --lib` 164/164 (161 baseline + 3 new
tests for the findings above — all actually run, not estimated). `npx tsc --noEmit` clean. UI
click-verified against the real running app: mode selector, confirmation gate, rule create/
delete, cross-wallet isolation, kill-switch link, audit log persistence.

**Open item — FIRST thing next session should look at:** an unlabeled, masked input field was
noticed next to the wallet-address input on the Sniping & Automation page during this final
verification pass. Not yet investigated — what it is, what it's bound to, and where its value
goes (localStorage? component state? a Tauri command payload?) is unknown. This needs to be
treated with real care, not a quick glance: it visually matches the shape of the 09.08.2026
incident already documented in this project's `CLAUDE.md` (a private key being written into an
address-shaped field, going to plaintext `localStorage`, and being sent to Alchemy as an
address parameter). Do not assume it's benign until traced end to end.

## Update (2026-08-10): T13 — Log In fix re-verified by real clicking, T13 done, pushed

Two fresh `vera` re-verification dispatches failed to even start (hit critical-low context
after 2-4 tool calls, before touching the app). `orion` was dispatched instead and ran the
real flow against the live worker: Sign Up → Log Out → Log In ×4 (2 typed, 2 pasted with a
deliberately injected leading/trailing space + trailing newline — the exact defect shape the
trim fix targets). **4/4 Log In attempts succeeded, zero retries needed.** The suspected
mechanism (untrimmed password) is confirmed closed; a first-attempt human typo in the
original report can't be ruled out with certainty (unfalsifiable), but the fix demonstrably
holds under the worst-case whitespace scenario. Test account
(`t13-verify-4471@example.com`) deleted from the live D1 database afterward, deletion
confirmed with a follow-up `SELECT`. A stray local-only session artifact from an earlier
stalled `vera` attempt (`vera-t13-probe@westron.local`) was also logged out of — it was never
actually persisted server-side, so no D1 cleanup was needed for it.

**T13 is done:** real protocol end-to-end (Rust + frontend), real signup/login/logout/check-
status all clicked through against the live deployed worker, no fake success values, no
mocks. Commits `3c69033`, `036f7f0`, `05a8b60` pushed to `origin/cowork-merge`.

## Update (2026-08-10, superseded above): T13 — Log In flakiness (vera's click-through), fix + open question

vera clicked through the whole flow for real: Sign Up, Check Status, Log Out, D1 cleanup all
verified correctly. **Log In was inconsistent**: the first attempt with the same email/password
came back with a real server `401 invalid_credentials` ("Incorrect email or password."); clearing
the fields (Cmd+A + delete) and retyping the same-looking credentials then succeeded. Not marked
done; not pushed.

**Root cause NOT proven** — this session has no click/GUI-automation tool, only file read/edit and
shell, so the flow could not be reproduced by clicking. From code review, the strongest suspect:
neither `src/app/settings/page.tsx`'s `handleAuth` nor `subscription-worker/src/index.ts` trimmed
the **password** (only the email was `.trim().toLowerCase()`'d). A password pasted from a notes
app/password manager commonly carries an invisible trailing newline/space; the worker hashes the
password byte-for-byte, so that produces a different hash than the same text typed by hand —
matching the observed "looks identical, server says wrong" symptom. Human typo on the first
attempt is an equally plausible, unfalsifiable alternative explanation.

**Fix applied (frontend only — the worker is already deployed; changing its password handling
risks invalidating already-hashed accounts, out of scope for this pass):** `handleAuth` now
`.trim()`s both email and password symmetrically for both signup and login, so whatever looks
like "the same password" to the user is sent byte-identical both times. `handleLogout` now also
resets `authEmail`/`authPassword`/`authError` so no stale form state survives a logout.

**Verified:** `cargo check`, `cargo test --lib subscription::` (9/9 pass), `npx tsc --noEmit` —
all clean. **NOT verified:** whether this actually fixes the Log In flake — nobody has clicked
through it since this change. Next `vera` pass should retry Log In several times, including once
via pasting the password (not just typing), to confirm or rule this out. If it still reproduces,
the root cause is elsewhere and this note should be updated rather than re-guessed.

## Update (2026-08-10): T13 — frontend now wired to the new account protocol

Second half of T13 (the Rust-side rewrite below was already committed and verified live).

- `src/lib/tauri.ts`: `checkSubscription()` is now zero-arg, matching the Rust command exactly.
  Added `subscriptionSignup(email, password)`, `subscriptionLogin(email, password)`,
  `subscriptionLogout()`, `subscriptionCurrentAccount()` — thin wrappers, one `invoke` call each,
  no logic duplicated from the Rust side.
- `src/app/settings/page.tsx` `BillingSection`: added a plain (unstyled-is-fine, per task scope)
  email+password Account block — shows the logged-in email + a Log out button when a session
  exists, or a sign-up/log-in form when it doesn't. `handleCheckStatus` no longer reads a wallet
  address at all; it calls `checkSubscription()` for whoever is currently logged in and refuses
  to call it if nobody is (shows "No account logged in..." instead of silently doing nothing).
  Dev/browser mode (no Tauri) still shows an explicit "requires the desktop app" message rather
  than pretending to work.
- `src/components/ProGate.tsx` and `src/lib/useSubscription.ts` were **not touched**, per the
  task's explicit scope boundary — they still read the same `subscriptionStore` localStorage
  cache (`plan`/`expiresAt`), which `BillingSection` continues to populate via `saveSubscription`,
  so their contract with the rest of the app is unchanged.

**Verified this half:** `npx tsc --noEmit` clean. `npx eslint src/app/settings/page.tsx` shows
the same 4 pre-existing problems (3 errors, 1 warning) that exist on the committed baseline
*before* this change too (confirmed by stashing and re-running) — none of them are in
`BillingSection` or introduced by this edit. `cargo check` / `cargo test` re-run and still
clean/99-99 (Rust side untouched this half, just re-confirmed).

**NOT verified — reasoned about, not observed:** nobody has run the actual Tauri desktop app and
clicked Sign Up / Log In / Check Status. The email/password form, the account-email display, the
logout flow, and "Check Status" showing a real active/inactive result on screen are all new code
paths that have only been typechecked, never exercised end-to-end in the real webview. That
click-through is the next concrete step before this can be called fully done — see `vera`.

## Update (2026-08-10): T13 — subscription protocol rewrite, Rust side only

`docs/TASKS.md` T13: the deployed Cloudflare Worker moved to an account + bearer-token
protocol (`POST /signup`/`POST /login` → `{token, account, access, license}`,
`POST /license` requires `Authorization: Bearer <token>` → `{access, license:{payload, sig}}`,
`license.payload` is `{account_id, email, active, reason, plan, expires_at, issued_at}`), but
`src-tauri/src/subscription/mod.rs` still spoke the old wallet-based protocol
(`POST /license {wallet}`, no auth header, top-level `{active, payload, sig}`). Every real
subscription check from the desktop app was silently getting a `401` and falling back to a
stale/no cache — **no real subscription could be confirmed on desktop.**

**Rust side — done, verified against the live worker, committed:**
- `src-tauri/src/subscription/mod.rs` fully rewritten: `signup()`, `login()`, `logout()`,
  `current_account_email()`, and a token-based `evaluate()` (no `wallet` argument anymore).
  `Payload` now matches the worker's account-shaped JSON exactly — the old wallet shape is
  **structurally rejected** (fails to deserialize), not bridged. Signature verification
  (`verify()`) and the anti-rollback disk cache (`store_license`/`load_license`,
  `last_seen`/`effective_now`) are unchanged in mechanism, just applied to the new payload shape.
  A `401` from `/license` (bad/expired token) is treated as "log in again", distinct from a
  network failure (which still falls back to the offline cache) — these were conflated before.
- `src-tauri/src/wallet/keychain.rs`: added `store_subscription_token`/`fetch_subscription_token`/
  `delete_subscription_token`, same dispatch pattern as `store_alchemy_key` etc.
- `src-tauri/src/lib.rs`: `check_subscription` no longer takes `wallet_address`; added
  `subscription_signup`, `subscription_login`, `subscription_logout`,
  `subscription_current_account` Tauri commands, all registered in `invoke_handler`.
- **Verified live** (not just read/reasoned about): real signup, real bearer-authenticated
  `/license` fetch, real `401` on a garbage token, real login, and the returned Ed25519 signature
  verified against the embedded `LICENSE_PUBLIC_KEY_B64` using the actual `verify()` function.
  Probe account created and **deleted from the live D1 database** afterward. Full request/response
  record: `probes/subscription-worker-account-protocol-t13.md`.
- `cargo check` clean, `cargo test` 99/99 (6 new subscription tests, including one asserting the
  old wallet-shaped payload no longer deserializes).

**NOT done yet — frontend is still on the old protocol, app will not build against the new Rust
commands until this lands:**
- `src/lib/tauri.ts`: `checkSubscription(walletAddress)` needs to become a zero-arg call, and
  `subscriptionSignup`/`subscriptionLogin`/`subscriptionLogout`/`subscriptionCurrentAccount`
  wrappers need adding.
- `src/app/settings/page.tsx` `BillingSection`/`handleCheckStatus`: currently checks a status by
  wallet address; needs a simple email+password signup/login form (no wallet involved) before
  "Check Status" means anything.
- No screen has ever called `subscription_signup`/`subscription_login` through the real Tauri
  webview — that first click-through is still owed, plus `tsc --noEmit` has not been re-run
  since this Rust change (the frontend `checkSubscription(addr)` call site will not type-check
  against the new zero-arg Rust command until `tauri.ts` is updated).
- **Kalan iş, kesin adım:** bir sonraki oturum `tauri.ts` + `settings/page.tsx`'i günceller,
  `npx tsc --noEmit` temizler, sonra gerçek uygulamada signup/login formunu deneyip "Check
  Status"ın gerçek aktif/pasif durumu gösterdiğini gözle doğrular.

## Update (2026-08-10): T11 — Distribute Funds validation fixes (Emir'in gerçek bug raporu)

Full findings per madde (a/b/c/d): `docs/TASKS.md` T11 → "forge bulguları" bölümü.
Değişen dosyalar: `src/lib/distribute.ts`, `src/components/DistributeModal.tsx`,
`src/app/bulk/distribute/page.tsx`. Kod-seviyesi doğrulama temiz (tsc/eslint/jest),
**gerçek tıklamayla doğrulanmadı** — bu ortamda browser automation aracı yok, `vera`
gerçek tıklamayla test etmeden bu iş "bitti" sayılamaz.

Kısaca ne değişti:
- Confirm & Send'in sebepsiz pasif kalması: `DistributeModal.tsx`'in "Send Funds"
  sekmesine (Send NFT sekmesinde zaten olan) envelope durumu/red sebebi UI'ı eklendi;
  ayrıca Step 1/Step 2 arasındaki tutar-geçerliliği kontrolü tekilleştirildi
  (`isValidEthAmount`, `src/lib/distribute.ts`).
- Her tutar kutusuna anlık kırmızı hata metni eklendi (`amountFieldError`).
- `DistributeModal.tsx`'teki "Amount per wallet" kutusu — görsel olarak tamamı
  tıklanabilir görünüp sadece küçük bir input'u işlevsel olan hata — tek gerçek
  `flex:1` input olacak şekilde düzeltildi. `bulk/distribute/page.tsx`'teki aynı kutu
  zaten doğruydu, sadece placeholder/hata metni eklendi.
- Cüzdan başına farklı tutar (custom mode): state/veri akışı kod seviyesinde zaten
  doğruydu; asıl engel muhtemelen aynı "düğme hiç aktifleşmiyor" hatasıydı. Ayrı
  gerçek tıklamayla teyit gerekiyor.

## Update (2026-08-10): T6/T9/T10 batch — wallet-detail Distribute CTA, NFT transfer, bulk/distribute reconnect

Full task list and per-item verification detail: `docs/TASKS.md`. Pushed to `cowork-merge` (`aa03590`).

**Real and code-verified (tsc/eslint/jest/cargo clean, not yet clicked through in a live GUI):**
- Envelope pre-deduction rollback bug fixed (`f77bb3f`) — failed sends no longer eat spend-cap budget.
- NFT transfer: real `transfer_nft` Tauri command (ERC-721/1155 `safeTransferFrom`, envelope-gated
  via `value_wei=0`), wired end-to-end into a real "Send NFT" tab in the UI (`5582cf2`, `d62a4e4`).
- Shared `DistributeModal` component replaces 2 duplicate copies (`page.tsx`, `wallets/page.tsx`);
  wallet-detail page (`/wallet/[id]`) got a real "Distribute" CTA opening it (`39ac33c`).
  Address-based self-send warning applied everywhere the modal is used.
- `bulk/distribute` page — previously a fully disabled "nothing is sent" screen — is now wired to
  the same real envelope-gated send path, balance/gas/Address Book UI preserved (`68cd73c`).
  **This is the first screen where a real send from this build has never been triggered — the code
  is ready but no one has clicked "Confirm & Send" yet. That first click is Emir's, per CLAUDE.md §5.**
- Duplicate dead "Send NFT" modal (`NftSendModal`, always said "Sending unavailable") retired,
  Bulk Actions now opens the real modal (`1aedd2c`).
- Etherscan links: wallet address button + "TXN:" tx-hash links across all 3 distribute screens,
  using the existing `open_external_url` Tauri command (`6f9f9fe`).
- Silent-failure fix on wallet detail's send button — now shows which precondition is missing.

**Blocked — Emir'in yapması gerekenler:**
1. `bulk/distribute`'tan **ilk gerçek gönderim** — düşük tutarlı bir zarf oluşturup bizzat
   "Confirm & Send"e tıklaman ve Etherscan'de teyit etmen gerekiyor. Hiçbir ajan bunu tetiklemedi.
2. Gerçek bir NFT'yi gerçek bir adrese gönderme de aynı şekilde hiç tetiklenmedi — ilk deneme senin.
3. Claude Desktop'ı ⌘Q ile kapatıp yeniden aç, Tools menüsünde `westron_*` araçlarının göründüğünü
   kontrol et (T7 — config eklendi ama uygulama yeniden başlatılmadığı için doğrulanamadı).
4. Bu oturumda hiçbir ekran gerçek tıklamayla gözle doğrulanmadı (Accessibility izni artık açık
   ama Westron'un pencere handle'ı bulunamadı — muhtemelen basitçe Dock'tan öne getirilmesi
   yeterli). Uygulamayı aç, Distribute/NFT akışlarını Confirm adımına kadar gez, Etherscan
   linklerine tıkla, bulk/distribute'un bakiye/gas/Address Book panellerinin doğru göründüğünü
   kontrol et — Send'e sen basmadan önce.

## Subscription backend (Cloudflare Worker) — this session, verified

- **Deployed and live:** `https://westron-subscription.ebaltepe.workers.dev`
- **D1 database (`westron-db`) is real and confirmed:** 4 tables present (`users`,
  `subscriptions`, `payer_wallets`, `sessions`) — verified with
  `wrangler d1 execute ... SELECT name FROM sqlite_master`.
- **Account signup + Ed25519 license issuance is real, not mocked.** Proven with a live
  `POST /signup` call, real HTTP 201, real signed license. See `probes/subscription-worker-signup.md`.
- **`WORKER_URL` in `src-tauri/src/subscription/mod.rs` now points at the deployed worker**
  (was a `YOUR_SUBDOMAIN` placeholder). `cargo check` passes after the change.
- Not yet verified end-to-end: full app flow (Tauri UI → worker → license stored/used).
  This session only proved the worker itself via curl, not the app calling it.

## Update (2026-08-02): all 5 secrets set, proxy verified live

All Worker secrets are now set (`LICENSE_SIGNING_KEY`, `ALCHEMY_WEBHOOK_SECRET`, `ALCHEMY_KEY`,
`OPENSEA_KEY`, `ETHERSCAN_KEY`) and the Alchemy address-activity webhook is registered.
API-key proxy verified live for all 3 providers — see `probes/subscription-worker-proxy.md`.

One mid-session error caught and fixed: the Etherscan key was first entered as the *secret name*
instead of its value (`npx wrangler secret put <the-key-itself>` instead of
`npx wrangler secret put ETHERSCAN_KEY`), which briefly exposed it in `wrangler secret list`
output. Deleted the bad entry and rotated the Etherscan key before re-entering it correctly.

## Blocked — Emir'in yapması gerekenler

1. App'i yeniden derleyip (`npm run dev:tauri` veya release build) yeni `WORKER_URL` ile gerçek bir signup/login denemesi yap.
2. Ödeme webhook'u henüz gerçek bir ödemeyle test edilmedi — ilk gerçek (veya testnet) ödeme geçtiğinde `/webhook/alchemy`'nin hesabı doğru aktif ettiğini doğrula.

## Everything else (sniping, portfolio, marketplace, etc.)

Not touched or re-verified this session. Per `README.md` and prior `MEMORY.md` notes: sniping
executes in simulation by design (explicitly gated, not claimed as done), key storage uses
local files + a Keychain module (`src-tauri/src/wallet/keychain.rs` exists, not re-audited here).
Treat those notes as **not re-verified** until a session actually checks them again.

## Update (2026-08-02, later): dashboard mock-data cleanup

Emir: "dashboard is full of mock / wrong datas." Confirmed and fixed — 11 files across the app
had hardcoded fixture data (fake wallets, balances, transactions, collection stats, PnL) that
displayed as if real whenever live data was empty. All replaced with `'—'` / honest empty states.
`npx tsc --noEmit` passes clean. **Changes are NOT committed** — review then ask to commit.
Full list and 2 flagged-but-not-fixed items (Monitor Wallet's PnL/Trades/Related-Wallets tabs
have no real backend at all; `WalletDetailClient`'s transfer confirm fakes a tx hash — financial,
needs explicit approval) are in `MOCKS.md`.

Recommended verification for Emir: run the app (`npm run dev:tauri`), open the dashboard with a
wallet that has zero transactions — it should show "No transactions yet." instead of 15 fake rows.

## Update (2026-08-03): two real bugs fixed — wallet refresh + transaction history

Both fixed, both compile clean, **neither committed** — review then ask to commit.

**1. Dashboard didn't show a newly added wallet until reload** (`src/app/page.tsx`)
The dashboard's own `AddWalletModal` wrote the wallet to `localStorage` but never told the
dashboard to re-read it, so the new card only appeared after a page reload. `/wallets` already
did this correctly via an `onAdded` callback — applied the same pattern to the dashboard.

**2. Wallet detail showed stale/incomplete transaction history**
(`src-tauri/src/rpc/client.rs`, `get_asset_transfers` — feeds both the dashboard tx table and
the wallet-detail Transactions tab). Two defects in the Alchemy call:
- Only `toAddress` was queried, so **sent transactions never appeared** — incoming only.
- No `order` param with `fromBlock: 0x0` + `maxCount: 100`. Alchemy defaults to *ascending*,
  so any wallet with >100 transfers got its **oldest 100 transfers since genesis**, never recent
  activity. That is the "not up to date" symptom.

Fix: queries incoming + outgoing in parallel with `"order": "desc"`, merges, dedupes by tx hash
(self-transfers appear in both), sorts by block descending, keeps the 100 most recent.
`cargo check` passes — no new warnings.

**Not verified in the running app yet.** Emir should open a wallet with real history →
Transactions tab → confirm recent activity appears, including sent txs, not just received.

## Update (2026-08-03, later): dashboard "2nd/3rd wallet doesn't appear" bug — fixed

Emir: "dashboarda yeni cuzdan ekleyince 2 veya 3. sira icin, ilk basta dashboardda gozukmuyor."
Root cause was **not** the earlier `onAdded` refresh bug (that one was already fixed and correct
for its own symptom) — it was Alchemy rate-limiting (HTTP 429) with zero retry anywhere in the
app. Adding a wallet fires a burst of concurrent requests (balance + tokens + NFTs + price ×
however many wallets are on the dashboard); on the free tier this easily trips the rate limit.

Two real defects found and fixed:
1. **`src-tauri/src/rpc/client.rs` (`AlchemyClient`)** — the client actually used for
   `get_eth_balance`, `get_token_balances`, `get_nfts_for_owner` inside `get_portfolio_snapshot`
   (the bulk of a wallet's data) had **zero** 429/rate-limit handling — a single 429 on any one
   of those three failed the wallet's *entire* snapshot instantly via `tokio::try_join!`, no
   retry. Added a `with_429_retry` helper: retries up to 3 times with 200ms/600ms backoff.
   (A separate, less-traveled client — `src-tauri/src/data/alchemy/client.rs`, used for ETH
   price — already had this same protection from an earlier fix this session; it did not fully
   cover the bug since it's not the client that touches balance/tokens/NFTs.)
2. **`src/app/page.tsx`** — the snapshot-fetch effect *replaced* the whole snapshots map every
   cycle instead of merging. So even if a wallet succeeded on the previous cycle, one 429'd
   request in the current cycle wiped its last-known-good data back to blank/zero. Now merges:
   `setSnapshots(prev => ({ ...prev, ...newSnaps }))`.

Both fixes verified with `cargo check` (Rust, clean) and `npx tsc --noEmit` (TypeScript, clean).
**Not committed yet** — review then ask to commit. **Not verified in the running app** (no
running Tauri session available this turn) — Emir should add a 2nd/3rd wallet and confirm its
balance/NFTs load without needing a reload. If several wallets are added in a fast burst, a brief
extra delay (up to ~0.8s per retried call) is expected and fine — that's the retry working.

## NEXT SESSION STARTS HERE — price poller is broken

The Tauri log shows this failing continuously, every run, for both providers' symbols:

```
[app_lib::data::realtime::price_poller][WARN] price_poller: transport error:
error sending request for url (https://api.g.alchemy.com/prices/v1/tokens/by-symbol?symbols=USDC&...)
```

That URL has **no API key segment** — Alchemy's prices endpoint is
`https://api.g.alchemy.com/prices/v1/{apiKey}/tokens/by-symbol`. Strong hypothesis, **not yet
probed**: ETH/USDC/USDT/WETH prices never load, which would make portfolio USD values wrong
or zero app-wide.

Per the operating manual, do this before touching app code: **probe the endpoint with curl
first** (real key, real response, saved to `probes/`), confirm the correct URL shape, then fix
`src-tauri/src/data/realtime/price_poller.rs`. Do not assume the docs — call it once for real.

## Housekeeping done this session

- Fixed `.gitignore`: `/node_modules` was root-anchored only, so `subscription-worker/node_modules`
  wasn't ignored. Added `**/node_modules`.
- Deleted the probe test account (`probe-test@westron.local`) from the live D1 `users` table after
  verifying the signup flow.
- `_arch.tar.gz`, `_faz1.tar.gz` (leftover pre-refactor backup archives, fully superseded by
  committed work, no unique content) — confirmed with Emir and deleted.
- `subscription-worker/schema.sql` and `package-lock.json` are untracked in git — should be
  committed (schema.sql is required to reproduce the D1 tables; package-lock.json pins deps).
  Not committed automatically per workflow rules — do this in the next commit.

## Update (2026-08-09): "son nokta" turu — Claude/MCP kontrolü, Keychain, gerçek transfer

Cowork oturumu, build→feedback döngüsüyle 4 paralel ajan. `cargo test` **86/86**,
`cargo check` 0 hata (23 uyarı, hepsi önceden var olan, byte-identical baseline).

### GÜVENLİK — en kritik bulgu
`wallet/keychain.rs` adı "keychain" olmasına rağmen Keychain KULLANMIYORDU: private
key'ler `~/Library/Application Support/Westron/keys/wallet_<addr>.key` dosyasında,
`fs::write` ile, yani umask (tipik 0644) izinleriyle DÜZ METİN duruyordu. CLAUDE.md'nin
değiştirilemez kuralına ve ürünün ana pazarlama iddiasına aykırı.
→ macOS Keychain'e taşındı (`security-framework`, generic password, service "Westron").
→ Migrasyon güvenli: oku → Keychain'e yaz → **geri oku ve karşılaştır** → ancak o zaman
   düz metin dosyayı sil. Herhangi bir hata dosyayı bırakır, `pending` sayar.
→ macOS dışı fallback: dosya, ama `create_new + mode(0o600)` ile atomik.
→ `get_keychain_status` komutu + kontrol sunucusu `/status` üzerinde görünür.

### İki gerçek para hatası bulundu ve düzeltildi
1. **`check_transaction` read-only DEĞİLDİ** — `check_and_authorize` çağırıyor, yani
   `spent_wei`'yi artırıyor ve (artık kalıcı olduğu için) diske yazıyor. Pre-flight
   olarak kullanılırsa limiti iki kez düşürür; kalan limitin yarısından büyük her tutarda
   tek bir wei hareket etmeden auto kill switch'i tetikler.
   → `preview_transaction` eklendi: aynı guard'lar, sıfır yan etki. Ortak `evaluate()`
     saf fonksiyonu ikisini de besliyor, ayrışma yapısal olarak imkânsız.
   → `get_envelope_status` artık `per_tx_ceiling_wei` de döndürüyor (hiç yoktu).
   → `check_transaction` davranışı AYNEN korundu, doc comment'i artık tüketimi söylüyor.
2. **Nonce tekrar kullanımı** — `sign_and_send` nonce'u `"latest"` ile okuyordu; ilk işlem
   madenlenmeden ikinci gönderim aynı nonce'u alıp birincinin YERİNE geçiyordu. Kullanıcı
   iki transfer gitti sanıyor, biri sessizce hiç olmuyor.
   → `"pending"` + from-adres başına mutex + süreç içi son-nonce kaydı. `nonce too low` /
     `replacement underpriced` / `already known` ayrı sınıflandırılıyor.

### Kalıcılık
Envelope (spent_wei ve kill switch dahil) ve scheduler durumu artık restart'ı atlatıyor.
Süresi dolmuş envelope aktif olarak geri yüklenmez. Kill switch açıksa açık kalır (fail closed).

### Frontend — mock temizliği tamamlandı
- `monitor/wallet`: P&L / Recent Trades / Related-Wallets tamamen uyduruktu → `get_trade_history`,
  `get_pnl_summary`, `get_nft_pnl`, `find_sister_wallets`.
- `wallet/[id]`: **sahte tx hash kaldırıldı**, gerçek `send_eth`'e bağlandı (Emir onayıyla).
- `bulk/distribute` + `monitor/collection`: MOCK_WALLETS, ALERTS, sahte işlem sonuçları temizlendi.

### DOĞRULANMAYAN (dürüst boşluk)
Hiçbir ekran ÇALIŞTIRILMADI. Kontrol sunucusu hiç soket açmadı. macOS Keychain yolu
Linux'ta derlenebilir ama çalıştırılamaz (cross-compile ile doğrulandı, runtime değil).
Nonce düzeltmesinin ağ yarısı test edilmedi. **Hiç gerçek transfer yapılmadı.**
Mac'teki ilk çalıştırma gerçek testtir.

## 2026-08-10 — maskeli alan takibi kapandı (T17 sonrası açık kalan soru)

T17 kapanışında flag'lenen "Sniping & Automation ekranındaki etiketsiz maskeli alan"
(`scout` ile, salt-okunur) incelendi. Sonuç: **güvenli**. `src/app/sniping/page.tsx:686-692`
— Alchemy API key alanı (`type="password"`, state `apiKey`), Keychain'de tamamen ayrı bir
hesap adı altında (`"alchemy"`, `fetch_alchemy_key()`) tutuluyor; cüzdan private key
depolamasıyla (`key_account(address)`, adres bazlı) hiçbir ilişkisi yok. 09.08.2026'daki
private-key-adres-alanına-sızması olayının tekrarı DEĞİL. Tek bulgu kozmetik: `<label>`
yok, sadece `placeholder` var — güvenlik açığı değil, istenmedi, düzeltilmedi.

**Sıradaki oturum için açık maddeler (öncelik sırasıyla değil, hiçbiri bu oturumda
onaylanmış öncelik değil):**
- T14 — Alchemy proxy route uyuşmazlıkları (task #13), T17 Phase (c) aynı marketplace
  kod alanına dokunduğu için tekrar alakalı olabilir.
- T15 — MCP smoke test path hatası (task #14).
- T16 — canlıda kapsanmayan endpoint'ler, Emir'in staging ortamı kararını bekliyor (task #15).
- Kozmetik, istenmedi: sniping sayfasındaki API key alanına `<label>` eklenmesi.

Bu oturum context limiti nedeniyle burada durdu; T17 ve maskeli alan sorusu tamamen
kapalı, commit'lenmiş ve push'lanmış durumda. Yeni oturum temiz bir noktadan başlayabilir.

## Update (2026-08-10): T14 — Alchemy proxy rotaları düzeltildi, canlı doğrulandı

Worker'ın (`subscription-worker/src/index.ts`, `handleProxy()`) Alchemy NFT/Prices/Portfolio-Data
proxy rotaları yanlış URL kuruyordu (`v3`/`v1` segmenti eksik, key yanlış yerde) — canlıda
401/404/400. `src-tauri/src/data/alchemy/client.rs`'teki doğru formatlarla eşleştirildi.

Emir'in onayıyla production Worker'a deploy edildi (`wrangler deploy`), gerçek bir test hesabıyla
üç rota da canlı Alchemy API'sine karşı denendi — üçü de gerçek veriyle HTTP 200 döndü. Test
hesabı canlı D1'den silindi. Kanıt: `probes/subscription-worker-alchemy-proxy-routes-t14.md`.
`npx tsc --noEmit` temiz. Masaüstü uygulaması bu proxy'yi hâlâ kullanmıyor, yani bugün canlı
kullanıcıya etkisi yok — düzeltme ileride proxy mimarisi devreye alınırsa iş görecek.

**Sıradaki açık maddeler (öncelik sırası değil):**
- T15 — MCP smoke test path hatası (task #14, `tools/westron-mcp/index.js`).
- T16 — Emir'in staging ortamı kararını bekliyor (task #15).

## BAŞLANMADI (2026-08-10, context limiti nedeniyle): T18 — Custody sertleştirme planı

Emir bir plan dosyası verdi: `/Users/byronic/Desktop/westron-custody-uygulama-plani.md` (proje
klasörünün DIŞINDA, henüz git'te değil). 5 fazlı (Faz 0 Keşif → Faz 1 Keychain/Secure Enclave
taşıması [launch-blocker] → Faz 2 Envelope sertleştirme → Faz 3 Vault/Agent ayrımı → Faz 4 Uçtan
uca doğrulama), ~33 alt görev (W-0.1...W-4.4), bağımlılık zinciri 1→2→3→4.

**İstenen ve HENÜZ YAPILMAYAN:**
1. Bu planı `docs/TASKS.md`'ye (bu projenin T-numaralı görev defteri konvansiyonuna uyarak,
   muhtemelen T18-T22 olarak, her faz kendi W-ID'leriyle) task task işle. Plan dosyasını da
   muhtemelen `docs/` altına kopyalamak (kalıcılık için, şu an sadece Desktop'ta) gerekiyor.
2. `orion` agent'ını (bu projenin gerçek, tanımlı subagent tipi — ürün/deneyim perspektifi)
   göreve sokup planı ona verip, hangi task'ların paralel koşabileceğine ve (vault/forge/vera/
   scout/atlas gibi mevcut agent rollerinden) kimin hangi task'ı üstleneceğine karar vermesini
   iste. Bu bir ATAMA KARARI çıktısı olmalı — henüz gerçek kod/implementasyon başlatılmadı,
   güvenlik-kritik (private key/Keychain/Secure Enclave) olduğu için Emir'e onaylatmadan
   implementasyon fazlarını gerçekten başlatma.

Hiçbir kod değişikliği yapılmadı bu madde için. Yeni oturum plan dosyasını okuyup buradan devam
edebilir — dosya yolu ve adım adım ne yapılacağı yukarıda.

## Update (2026-08-11): T18-T22 task ledger'a işlendi + orion atama kararı verdi

Plan dosyası repoya taşındı: `docs/CUSTODY-HARDENING-PLAN.md` (önceden sadece Desktop'ta,
git dışıydı). `docs/TASKS.md`'ye planın 5 fazı T18 (Faz 0 Keşif, hemen başlanabilir) → T19
(Faz 1 Keychain/SE, LAUNCH-BLOCKER) → T20 (Faz 2 Envelope) → T21 (Faz 3 Vault/Agent) → T22
(Faz 4 Doğrulama) olarak eklendi, bağımlılık zinciri katı (1→2→3→4).

`orion` alt görev atamasını yaptı (`docs/TASKS.md` sonu, "orion ATAMA KARARI — 11.08.2026"):
T18'in 6 alt görevi tamamen paralel (`scout` × 5, `architect` × 1 — W-0.4 crate/Secure Enclave
doğrulaması bir mimari karar, tarama değil). T19-T22 için `vault`/`forge`/`vera`/`architect`
arasında dağıtım yapıldı; aynı dosyaya (`gateway.rs`) yazan alt görevler bilerek sıralı
bırakıldı (dosya çakışma riski), UI işleri backend'in ilgili komutunu bekliyor.

**Bu oturumda hiçbir implementasyon kodu yazılmadı — sadece planlama/atama.** Sıradaki adım:
T18 (Faz 0 keşif) çalıştırılabilir, salt okunur, kod değişikliği yok, Emir onayı gerektirmiyor.
**T19'dan itibaren (gerçek private key/Keychain taşıması) Emir'in açık onayı olmadan tek satır
kod yazılmayacak** — bu CLAUDE.md'nin hard-stop maddesi kapsamına giriyor.

## Update (2026-08-11, devam): T18 (Faz 0 keşif) tamamlandı

Üç paralel ajan (`scout` × 1 iş, `general-purpose` × 2 iş — W-0.4 ve W-0.6 web erişimi
gerektirdiği için `scout`/`architect` yerine kullanıldı) T18'in 6 alt görevini işledi. Tam
rapor: `docs/T18-DISCOVERY-REPORT.md`. Kod değişikliği yok — tamamı salt okunur keşif.

**En önemli bulgu:** T19'un yazılı kapsamı ("diskte hiçbir anahtar düz metin kalmasın")
**güncel değildi** — `wallet/keychain.rs` zaten gerçek macOS Keychain'e yazıyor, sıfırdan
taşıma değil, mevcut yolun Secure Enclave ile sertleştirilmesi gerekiyor. T19'un görev metni
buna göre güncellenmedi henüz, sadece T18 sonuç notunda düzeltme olarak işlendi
(`docs/TASKS.md`, T18 "Sonuç" bölümü) — **T19 başlamadan önce görev metninin kendisi de
gözden geçirilmeli.**

**İkinci önemli bulgu (plan dışı):** private-key→adres türetme mantığı frontend'de üç ayrı
yerde kopyalı (`src/lib/walletImport.ts`, `src/app/page.tsx:484-487`,
`src/app/login/page.tsx:137-139`) — CLAUDE.md'nin "tek doğruluk kaynağı" kuralını ihlal
ediyor. Ham key sızıntısı olup olmadığı doğrulanmadı, sadece kopyalanma doğrulandı.

**Tamamlanan:** W-0.1 (anahtar dokunuş envanteri), W-0.4 (Secure Enclave crate doğrulaması —
native `security-framework` yeterli, FFI gerekmiyor), W-0.6 (Seaport 1.6 adresi kodda doğru,
OpenSea Conduit'in gerçek adresi kodda eksik — sadece conduit key var).

**Yarım kalan (T19 öncesi kapatılmalı, ajanların kendi context sınırı nedeniyle):** W-0.2
(sniping engine + control server imza zincirleri bakılmadı), W-0.3 (70+ Tauri komutunun tam
sınıflandırması bitmedi), W-0.5 (`sniping/db.rs` tam kolon şeması okunmadı). Bunlar "temiz"
diye işaretlenmedi — açıkça "bakılmadı" olarak `docs/T18-DISCOVERY-REPORT.md`'de duruyor.

**Sıradaki adım:** yeni bir oturum önce yukarıdaki yarım kalan 3 maddeyi kapatmalı, sonra
T19'un görev metnini W-0.1 bulgusuna göre güncellemeli, ancak **T19'un ilk kod satırı Emir'in
açık onayı olmadan yazılmayacak** (private key/Keychain kökten değişiyor, CLAUDE.md hard-stop).
Bu oturum burada temiz kapanıyor — implementasyon başlatılmadı.

## Update (2026-08-11, devam 2): T18'in yarım kalan 4 maddesi de kapatıldı — T18 tamamen bitti

Dört ek `scout` ajanı paralel çalıştı, yukarıda "yarım kalan 3 madde" diye bırakılan
W-0.2/W-0.3/W-0.5 ve plan dışı adres-türetme bulgusu artık tam kapsamlı. Tam güncel rapor:
`docs/T18-DISCOVERY-REPORT.md`. Kod değişikliği yok — bu da salt okunur keşifti.

- **Sniping engine + control server imza zincirleri (W-0.2):** ikisi de envelope/spend-cap
  gate'inden geçiyor, atlama yok. Ama sniping hâlâ hiçbir gerçek signer'a ulaşmıyor —
  `0xSIMULATED_` hash üretiyor, `MOCKS.md`'nin zaten belirttiği durum artık kod seviyesinde
  doğrulandı. **T19/T20 planlaması sniping'i "sertleştirilecek mevcut yol" değil "henüz
  inşa edilmemiş özellik" olarak ele almalı.**
- **87 Tauri komutunun tamamı (W-0.3):** anahtar malzemesi alan/döndüren tek komut
  `import_wallet` (key içeri girer, sadece adres dışarı çıkar) — IPC sınırında sızıntı yok.
- **`sniping/db.rs` tam şeması (W-0.5):** tek tablo, 12 kolon, hiçbir kolon private key/
  mnemonic tutmuyor. DB plaintext SQLite (SQLCipher değil) ama içerik hassas değil.
- **Üçlü adres-türetme kopyası — SAFE:** ham key materyali üç konumun hiçbirinde loglanmıyor,
  meşru `import_wallet` invoke'u dışında ağa çıkmıyor, storage'a yazılmıyor. Backend her zaman
  key'den yeniden türetip uyuşmazlıkta reddediyor — 09.08.2026 türü bir olay yapısal olarak
  engellenmiş durumda. Kalan risk sadece kod tekrarı (teknik borç), acil güvenlik açığı değil.

**T18 artık tamamen kapalı — W-0.1 ile W-0.6 arası hiçbir madde "kısmi" değil.** Geriye kalan
tek boşluk (`create_with_flags` vs `create_with_protection` probe scripti) keşifle değil gerçek
kodla kapatılacak — T19 Faz 1'in ilk alt görevi olarak işaretlendi, T18 kapsamında değil.

**Bu oturumda da hiçbir implementasyon kodu yazılmadı.** T19'un ilk kod satırı hâlâ Emir'in
açık onayını bekliyor. Sıradaki oturum doğrudan T19'un görev metnini (W-0.1 bulgusuna göre
daraltılmış kapsamla) güncelleyip Emir'e onay için sunabilir.

## Update (2026-08-11, devam 3): Emir T19'a onay verdi ("go-ahead") — implementasyon henüz başlamadı

**Onay `docs/TASKS.md`'nin T19 bölümüne işlendi** ("✅ Emir'in onayı alındı"). Ama bu oturum
context sınırına (%75) ulaştığı için hiçbir T19 kodu yazılmadı — güvenlik-kritik (private key/
Keychain) bir işe yarım kalmış context'le başlamamak için bilerek durduruldu.

**Sıradaki oturumun ilk işi:** `docs/T18-DISCOVERY-REPORT.md`'nin belirttiği tek gerçek T19
ön-adımı — `create_with_flags` vs `create_with_protection` probe scripti (hangisi
`kSecAccessControlBiometryCurrentSet | kSecAccessControlPrivateKeyUsage` kombinasyonunu doğru
kabul ediyor, `probes/` altına). Bunu bir `vault` ajanına ver, gerçek Mac'te çalıştır, sonucu
kaydet — sonra `docs/TASKS.md`'deki orion ATAMA KARARI'nın W-1.1→W-1.4 sıralı zincirine geç.
Onay zaten alındı, tekrar Emir'e sorulmasına gerek yok — sadece implementasyona başla.

## Update (2026-08-11): T19 Faz 1 — probe + W-1.1→W-1.4 yazıldı, security review CRITICAL bulgu buldu, HİÇBİR ŞEY COMMIT/CUTOVER EDİLMEDİ

**Probe (gerçek bu Mac'te, gerçek Secure Enclave) — tamamlandı.** `create_with_flags` ile
`create_with_protection` arasında bayrak kabulünde fark yok (`create_with_flags` zaten
`create_with_protection(None, flags)`'in aynısı) — asıl karar değişkeni `ProtectionMode`
imiş. Üç ACL yolu da gerçek SE P-256 keygen'i başarıyla tetikledi.
`kSecAccessControlBiometryCurrentSet | kSecAccessControlPrivateKeyUsage` +
`AccessibleWhenUnlockedThisDeviceOnly` (cihaz-yerel, iCloud senkron dışı) seçildi. Tam kayıt:
`probes/se-acl-probe-t19.md`. **Doğrulanamadı:** decrypt anındaki gerçek Touch ID prompt'u —
bu ajan headless çalıştı, SE anahtarı kalıcı üretilmedi/kullanılmadı. Emir'in Mac'inde
interaktif oturumda ayrıca doğrulanmalı (planın kendi kabul kriteri zaten bunu istiyor).

**W-1.1 – W-1.4 yazıldı** (`vault` ajanı): `src-tauri/src/keystore/{mod.rs,mac.rs,mock.rs,
migration.rs}`, `lib.rs`'e `mod keystore;` eklendi (hiçbir imzalama yoluna bağlanmadı),
`Cargo.toml`'a `security-framework`/`security-framework-sys`/`core-foundation` + `mock-keystore`
feature. `cargo check` temiz, `cargo test --lib` 178/178 (14 yeni test). **Hiçbir commit
yapılmadı.** Gerçek migrasyon gerçek `~/Library/Application Support/Westron/keys/` dizinine
veya gerçek Keychain'e karşı **tetiklenmedi** — kontrol edildi, iz yok.

**Bilinen mimari açık nokta (henüz karar verilmedi):** yeni `keystore` modülü mevcut
`wallet/keychain.rs`'in **yerine geçmiyor**, ayrı bir Keychain service adı (`com.westron.wallet`
vs `Westron`) altında paralel duruyor. Hangi noktada cutover yapılacağı (imzalama kodu ne zaman
`wallet::keychain`'den `keystore`'a geçecek) henüz kararlaştırılmadı — bilerek sessizce
çözülmedi, `keystore/mod.rs` doküman yorumunda işaretli.

**Security review (`security-reviewer` ajanı) — 1 CRITICAL, 1 HIGH, 1 MEDIUM, 4 LOW/INFO buldu:**

1. **CRITICAL — `SecureEnclaveBackend::store()` (`keystore/mac.rs:161-192`) veri kaybı riski.**
   Var olan bir key üzerine yazarken eski SE anahtarı **yeni anahtar üretilmeden/yazılmadan
   önce** siliniyor. Aradaki adımlardan biri (keygen veya Keychain yazımı) başarısız olursa,
   eski şifreli blob artık var olmayan bir SE anahtarına işaret ediyor — **kalıcı olarak
   decrypt edilemez hale geliyor**, fonksiyon hata döndürse bile yan etki geri alınamıyor. Aynı
   PR'daki `migration.rs`'in kendi "doğrula-sonra-sil" kuralının bir katman aşağıda ihlali.
   **Henüz gerçek bir zarara yol açmadı** (hiçbir çağıran `store_key`'i var olan bir hesap
   üzerine henüz çağırmıyor) ama gerçek imzalama yoluna bağlanmadan önce kesinlikle
   düzeltilmeli: yeni blob'u önce yaz-ve-doğrula, eski SE anahtarını ancak ondan sonra sil.
2. **HIGH — `KeychainOnly` fallback'inde (SE donanımı yok) ham private key baytları
   `Zeroizing` DEĞİL düz `Vec<u8>`'a kopyalanıyor** (`mac.rs:168, 186-187, 195-208`) — sıfırlanmadan
   drop ediliyor. `mod.rs` sınırında `Zeroizing` doğru kullanılıyor ama `mac.rs` içinde yok,
   tam da donanım korumasının en zayıf olduğu katmanda.
3. **MEDIUM — flaky test.** `mock.rs`'teki `MockBackend` tek bir process-wide `static
   HashMap` kullanıyor; paralel test çalıştırmada (`cargo test` varsayılanı) bir testin
   `reset()`'i başka bir testin verisini siliyor. Gerçek `store_key`/`load_key` kablolamasını
   test eden asıl test ~4 çalıştırmada 1 başarısız oluyor (doğrulandı,
   `--test-threads=1` ile hep geçiyor).
4. **LOW/INFO (bloklamıyor, düzeltilmeli):** fallback zincirinin ara hata sebepleri hiç
   loglanmıyor (silent-not-lied-about ama teşhis edilemez) · `keystore::normalize_id` ve
   `keystore::migration`'ın hedef dizini `wallet/keychain.rs`'in aynı mantığını ayrı kopyalıyor
   (bugün çakışma yok, iki backend cutover'dan önce birleştirilmeli) · probe script'i
   (`examples/se_acl_probe.rs`) her çalıştırmada gerçek Keychain'de 3 SE anahtarı bırakıyor,
   temizlenmiyor · `kSecAttrSynchronizable=false` hiç explicit set edilmiyor/test edilmiyor,
   crate default'una güveniliyor.

**Reviewer kararı: CRITICAL düzeltilmeden bu modül commit edilmemeli veya gerçek imzalama
yoluna bağlanmamalı.** HIGH ve MEDIUM de Emir'e gitmeden önce kapatılmalı.

**Sıradaki oturumun ilk işi:** (1) CRITICAL'i düzelt (`store()`'da yaz-doğrula-sonra-sil sırası),
(2) HIGH'ı düzelt (`mac.rs`'te `Zeroizing`), (3) MEDIUM'u düzelt (mock test state izolasyonu),
`cargo test --lib` tekrar temiz olsun. Sonra `keystore` vs `wallet/keychain.rs` cutover kararı
verilmeli (henüz verilmedi) — ancak ondan sonra W-1.5+ (API key taşıma, IPC kapatma) mantıklı.
Gerçek Touch ID prompt'u hâlâ Emir'in Mac'inde manuel doğrulanmamış. **Bu oturumda hiçbir şey
commit edilmedi, git working tree hâlâ değişiklikleri taşıyor (staged değil).**

## Update (2026-08-11, devam 4): CRITICAL/HIGH/MEDIUM düzeltildi + doğrulandı, cutover kararı verildi, Touch ID hâlâ bekliyor

**Üç bulgu da düzeltildi** (bir `vault` ajanına devredildi, sonra bu oturumda bağımsız olarak
tekrar doğrulandı — sadece ajan raporuna güvenilmedi):

1. **CRITICAL (`mac.rs`):** `store()`'daki sıra düzeltildi — artık eski SE anahtarı, yeni blob
   Keychain'e başarıyla yazılana kadar silinmiyor. Sıralama mantığı `security_framework`
   tiplerinden bağımsız, saf bir yardımcıya (`store_preserving_old_key_until_write_succeeds`)
   çıkarıldı ve 5 testle (`store_ordering_tests`) kapatıldı — biri tam olarak bu bulguyu kanıtlıyor
   (`never_deletes_previous_key_when_the_write_fails`). Aynı-etiket çakışması sorunu
   `SecKey::delete()`'in `kSecValueRef` (spesifik anahtar referansı) üzerinden sildiği, `kSecAttrLabel`
   üzerinden değil, doğrulanarak (crate kaynağı okunarak) çözüldü — taze bir etiket araması yerine
   yeni anahtar üretilmeden ÖNCE yakalanan eski anahtar referansı silinir.
2. **HIGH (`mac.rs`):** `KeychainOnly` yolundaki ham secret baytları taşıyan `blob` değişkenleri
   (`store()` ve `load()`'da) artık `Zeroizing<Vec<u8>>`.
3. **MEDIUM (`mock.rs`):** paylaşılan `static OnceLock<Mutex<HashMap>>` yerine `thread_local!` —
   her test thread'i kendi store'unu görüyor, `cargo test`'in paralel varsayılanı artık flake
   üretmiyor.

**Bağımsız doğrulama (bu oturumda, ajan raporuna ek olarak):** `cargo check` temiz (keystore'dan
sıfır uyarı). `cargo test --lib keystore` 3 kere + `cargo test --lib` (tam suite, 183 test) 1 kere
çalıştırıldı, varsayılan paralellikle, hepsi yeşil, sıfır flake.

**Cutover kararı verildi (Emir onayladı):** yeni `keystore` gerçek imzalama yoluna bağlandığında,
`wallet/keychain.rs`'te (eski servis `"Westron"`) hâlâ duran mevcut cüzdanlar **bir sonraki app
açılışında otomatik taşınacak** — her cüzdan eski servisten okunup yeni `keystore`'a
(servis `"com.westron.wallet"`) yazılacak, **yazma doğrulanmadan eski kopya silinmeyecek**
(zaten `migration.rs`'te düz-metin dosyalar için kullanılan aynı yaz-doğrula-sonra-sil deseni).
Alternatifler (kullanım anında tembel taşıma, sadece yeni cüzdanlar) Emir'e sunuldu, o bunu
seçti — hepsi Touch ID cüzdanları için anında koruma istediği için.

**Henüz YAPILMADI (bilerek — gerçek para custody'sine dokunan kod, context sınırına yakın bir
oturumda acele yazılmayacak):**
- Bu migrasyonun gerçek kodu (wallet::keychain'i tarayıp keystore'a taşıyan mantık) yazılmadı.
- `keystore`'un gerçek imzalama yoluna (`signing/mod.rs`, `marketplace/client.rs`) bağlanması
  yapılmadı.
- **Gerçek Touch ID prompt'u hâlâ Emir'in Mac'inde gözlemlenmedi.** Bunun için atılan adım: bir
  `vault` ajanına, sadece bunu doğrulamak için sahte/atılabilir bir hesap id + sahte secret ile
  gerçek Secure Enclave'e karşı store→load yapan, sonra temizlenen bir örnek (`examples/
  keystore_touchid_probe.rs`) hazırlatıldı (ajan bunu SADECE derledi, ÇALIŞTIRMADI — Touch ID
  canlı bir insan gerektirir). Ajan tamamlandığında sıradaki oturumun/adımın ilk işi:
  `cd src-tauri && cargo run --example keystore_touchid_probe` komutunu Emir'in Mac'inde
  çalıştırıp Touch ID isteminin gerçekten geldiğini gözlemlemek.

**Sıradaki oturumun sırası:** (1) `keystore_touchid_probe` örneğini çalıştır, Touch ID'yi gerçekten
gözlemle ve doğrula, (2) yalnız o başarılıysa migrasyon kodunu (yukarıdaki karara göre, otomatik
app-açılış migrasyonu) yaz + test et, (3) `keystore`'u gerçek imzalama yoluna bağla, (4) tüm bunlar
gerçek Mac'te manuel doğrulanana kadar commit YOK. **Bu oturumda hâlâ hiçbir şey commit edilmedi.**

## Update (2026-08-10, devam 5): Touch ID probe çalıştı — BAŞARISIZ, kök neden bulundu

**Emir'in gerçek Mac'inde `cargo run --example keystore_touchid_probe` çalıştırıldı. Sonuç: Touch
ID isteği HİÇ gelmedi.** İlk çalıştırmada mod görünmüyordu; probe'a `keystore::custody_mode()`
(zaten `mac.rs`'te vardı ama hiçbir yere bağlı değildi) okuyup basan bir satır eklendi — o da
`Kullanılan custody modu: keychain_only` gösterdi, yani Secure Enclave hiç devreye girmemiş, düz
Keychain'e (biyometrisiz) düşülmüş. `mac.rs`'teki `prepare_custody()`'nin gerçek SE hatasını
sessizce yuttuğu (`if let Ok(key) = ...` — `Err` hiç görünmüyordu) fark edildi ve düzeltildi: artık
her başarısız denemede gerçek hatayı `stderr`'e basıyor (bu da CLAUDE.md'nin "sessiz yutma yasak"
kuralına bir düzeltme, sadece teşhis amaçlı değil).

**Kök neden, ikinci çalıştırmada net görüldü:**
```
Secure Enclave key generation failed: OSStatus error -34018 — errSecMissingEntitlement
(failed to add key to keychain)
```
Hem biyometri ACL'i hem presence ACL'i denemesi aynı hatayla başarısız oldu. **-34018 = "gerekli
entitlement yok."** `mac.rs`'in SE anahtarını `KeyLocation::DataProtectionKeychain`'e yazdığı yer
(W-0.4 gereği zorunlu), ve Data Protection Keychain'e yazmak imzasız/entitlement'sız bir ikiliden
(`cargo run` ile üretilen çıplak dev binary'si) yapılamıyor — macOS bunu reddediyor. Bu, Emir'in
Mac'inde Secure Enclave donanımı olmadığı anlamına GELMİYOR (Touch ID'si var, donanım kesin var);
sadece bu probe'un çalıştığı imzasız komut satırı ikilisinin gereken keychain-access-group /
entitlement'a sahip olmadığı anlamına geliyor. Gerçek, imzalı Tauri app bundle'ı (kendi entitlements
dosyasıyla) bu sorunu yaşamayabilir — ama bu HENÜZ DOĞRULANMADI, varsayım.

**Bu nedenle T19 Faz 1'in "Touch ID gerçek imzada tetikleniyor" kabul kriteri HÂLÂ karşılanmadı.**
Round-trip'in kendisi doğru çalıştı (yazılan veri doğru okunuyor), ama hiçbir hardware/biyometrik
koruma olmadan — bu "başarılı" değil, "SE bu ortamda devre dışı" demek. Probe'un kendi doğruluk
mantığı da düzeltildi: artık mod `SecureEnclaveBiometry`/`SecureEnclaveUserPresence` değilse asla
"Touch ID tetiklendi" demiyor, dürüstçe "KISMEN" diyor.

**Sıradaki oturumun ilk işi (bunu değiştirir):** Ya (a) probe binary'sini gerekli entitlement'larla
(`keychain-access-groups`, `application-identifier`) ad-hoc code-sign edip tekrar dene, ya da (b)
gerçek imzalı Tauri app bundle'ı içinden tetiklenen geçici bir test yolu kur. Codesign / entitlement
konusu bu oturumda araştırılmadı — context sınırına yakın, güvenli/temiz bırakmak için erteledi.
`keystore::custody_mode()` artık `pub` ve `examples/keystore_touchid_probe.rs`'in doğruluk mantığı
düzeltildi; bu iki değişiklik kalıcı, doğru ve testlerle uyumlu (`cargo test --lib`: 183/183 yeşil).
Hâlâ commit yok.

## Update (2026-08-10, devam 6): Gerçek engel bulundu — bu makinede code-signing kimliği yok, Emir'in yapması gereken bir şey

Bir `vault` ajanı entitlement/codesign yolunu araştırdı. Sonuç, kodda değil, **makine kurulumunda**
bir engel:

```
$ security find-identity -v -p codesigning
0 valid identities found
```

Bu Mac'te hiçbir code-signing kimliği (ne ücretsiz Apple Development sertifikası, ne Developer ID)
yok. `src-tauri/entitlements.plist` zaten doğru şeyi istiyor (`keychain-access-groups:
["$(AppIdentifierPrefix)com.westron.app"]`), ama `$(AppIdentifierPrefix)` yalnızca gerçek bir Team
ID ile imzalanmış bir binary'de anlamlı bir değere dönüşüyor — ad-hoc imza (Team ID'siz) bunu
çözemez, muhtemelen aynı `errSecMissingEntitlement` hatasını verir. Yani "probe'u ad-hoc imzala"
fikri muhtemelen çalışmayacak; asıl ihtiyaç gerçek bir imzalama kimliği.

**Bu, Emir'in CLAUDE.md'sindeki "hesap kurulumu Emir'in işi" kuralına giren bir adım — kod yazarak
çözülemez.** En olası çözüm: bu Mac'te Xcode kurulu ve bir Apple ID ile giriş yapılmış olması
(bu, ücretsiz bir "Personal Team" Development sertifikası verir, App Store'a yayın gerektirmez).
Bu HENÜZ doğrulanmadı — sadece en olası yol. Ayrıca gerçek `npm run tauri dev` uygulamasının
şu an nasıl imzalandığı da kontrol edilmedi (o da imzasız/ad-hoc olabilir, aynı duvara çarpabilir).

**Sıradaki oturumun ilk işi (önceki maddenin yerine geçer):**
1. Emir'e sor: bu Mac'te Xcode kurulu mu, Apple ID ile giriş yapılmış mı? (Ayarlar → Xcode →
   Accounts, ya da Xcode hiç yoksa App Store'dan kurulmalı.)
2. Değilse, Emir'in yapması gereken: Xcode'u kur (App Store, ücretsiz), aç, bir Apple ID ile giriş
   yap (ücretsiz kişisel hesap yeterli, ücretli Developer Program'a gerek yok).
3. Bir kimlik oluştuktan sonra: probe binary'sini o kimlikle imzala (`codesign --sign
   "Apple Development: ..." --entitlements src-tauri/entitlements.plist --force
   target/debug/examples/keystore_touchid_probe`), tekrar çalıştır, Touch ID'yi gözlemle.
4. Paralel olarak kontrol et: gerçek `npm run tauri dev` build'i şu an nasıl imzalanıyor — eğer o
   da imzasızsa, gerçek uygulama da bu sorunu aynen yaşayacak demektir ve bu daha büyük, ayrı bir
   proje kurulumu konusu (Xcode + imzalama, sadece bu probe için değil, tüm uygulama için gerekli).

Hâlâ hiçbir şey commit edilmedi. `cargo test --lib`: 183/183 yeşil (bu turda kod değişmedi, sadece
araştırma yapıldı).

## 2026-08-10 (devam) — Sertifika zinciri düzeltildi, ama probe hâlâ Touch ID'ye ulaşamıyor

Yukarıdaki "0 valid identities found" sorunu çözüldü ama kök neden tahmin edilenden farklıydı:
Xcode'da geçerli bir "Apple Development: ebaltepe@gmail.com" sertifikası zaten vardı, ama Mac'in
Sistem (System) keychain'inde Apple'ın ara sertifikası ("Apple Worldwide Developer Relations
Certification Authority") **2023'te süresi dolmuş eski bir kopyaydı** — zincir doğrulaması bu
yüzden `CSSMERR_TP_NOT_TRUSTED` ile reddediyordu. Emir'in kendi Terminal'inde çalıştırdığı iki
komutla düzeltildi:
```
sudo security delete-certificate -Z FF6797793A3CD798DC5B2ABEF56F73EDC9F83A64 /Library/Keychains/System.keychain
sudo security add-certificates -k /Library/Keychains/System.keychain /tmp/AppleWWDRCAG3.cer
```
Doğrulama: `security find-identity -v -p codesigning` → artık **1 valid identities found**.

**Ama `keystore_touchid_probe` hâlâ çalışmıyor — farklı bir duvara çarptı.** Probe binary'sini
gerçek kimlikle + `entitlements.plist` ile elle `codesign` ettim (Team ID: `ZWAS3MG895`,
`66AKR5F8YX` cert CN'indeki farklı bir alan, Team ID değil — bu ayrım bir sonraki oturum için not
edilsin). Sonuç: `zsh: killed`, hiçbir çıktı basılmadan (kendi kodumuz hiç çalışmadan) anında
öldürülüyor. `codesign --verify` imzayı geçerli buluyor, ama `spctl -a` "rejected" diyor.

**Kök neden (yüksek güvenle, ama doğrulanmadı):** `keychain-access-groups` Apple'ın "restricted"
entitlement'larından biri — bunun geçerli sayılması için binary'nin içine gömülü bir
**provisioning profile** gerekiyor. Xcode normal bir app target build ederken bunu otomatik
oluşturup gömüyor; komut satırından çıplak `codesign --entitlements ...` ile bunu taklit etmek
mümkün değil. Yani "probe'u elle imzala" yaklaşımı burada tıkandı — bu bir imzalama hatası değil,
eksik bir provisioning profile sorunu.

**Sıradaki oturumun ilk işi:** Touch ID'yi `cargo run --example` yerine **gerçek Westron.app**
üzerinden test et (`cargo tauri dev` veya `cargo tauri build` — bu zaten `tauri.conf.json` üzerinden
`entitlements.plist`'i referans alıyor ve Tauri/Xcode'un kendi build pipeline'ı provisioning
profile'ı doğru şekilde halledebilir). Henüz doğrulanmadı: gerçek uygulama build'i şu an bu sorunu
yaşıyor mu, yoksa Tauri'nin imzalama adımı bunu zaten doğru mu yapıyor. `probes/se-acl-probe-t19.md`
ve `docs/CUSTODY-HARDENING-PLAN.md` W-1.x bu bulguyla güncellenmeli.
