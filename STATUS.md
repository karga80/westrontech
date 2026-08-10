# Westron — STATUS

Live truth. Disk and git win over this file if they disagree — fix this file, not your assumptions.
Full feature/architecture overview: `README.md`. This file tracks what's proven vs mock vs blocked.

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
