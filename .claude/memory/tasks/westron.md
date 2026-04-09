# Task Ledger — Westron
Son güncelleme: 2026-04-06
Proje başlangıcı: 2026-03-22

---

## Aktif Tasklar

| ID  | Görev | Atanan | Durum |
|-----|-------|--------|-------|
| T23 | QA — Tüm sayfa pixel-perfect design uyumu + functionality | Nova/Forge | ✅ TAMAMLANDI |
| T24 | Sub-page implementasyonu (alerts, portfolio, build, settings sections) | Forge | ✅ TAMAMLANDI |
| T25 | Tauri wrapper seçimi → Tauri v2 kararlaştırıldı | Atlas | ✅ TAMAMLANDI |
| T26 | Frontend → Tauri invoke() bağlantısı doğrulandı (src/lib/tauri.ts + tüm sayfalar) | Forge | ✅ TAMAMLANDI |
| T27 | Transaction signing mimarisi — Envelope sistemi (send_eth + sniping engine) tamamlandı | Atlas | ✅ TAMAMLANDI |
| T28 | Tauri dev build canlı test — `npm run dev:tauri` macOS'ta çalışıyor | Forge | ✅ TAMAMLANDI |
| T29 | Tag library — app genelinde badge sistemi, night/day kontrast garantili | Forge | ✅ TAMAMLANDI |
| T30 | UI fix pass — SPIN kaldırma, sort, dead button temizliği, kontrast düzeltmeleri | Forge | ✅ TAMAMLANDI |
| T31 | Phase 2A — Background polling AppInit auto-start (layout.tsx mount) | Forge | ✅ TAMAMLANDI |
| T32 | Phase 2B — Marketplace Rust module (list_nft/place_bid/cancel_order) + frontend wiring | Atlas/Forge | ✅ TAMAMLANDI |
| T33 | Wallet import modal in Settings > Security (importWallet Tauri + walletStore persistence) | Forge | ✅ TAMAMLANDI |
| T34 | Public beta packaging — tauri.conf.json v0.2.0, DMG target, category/copyright, entitlements Keychain | Atlas | ✅ TAMAMLANDI |
| T35 | Login page rewrite — Import Wallet / Watch Address onboarding flow (removed MetaMask/WalletConnect) | Forge | ✅ TAMAMLANDI |
| T36 | Subscription billing — subscriptionStore.ts, check_license_key + open_external_url Tauri commands, BillingSection wired | Atlas/Forge | ✅ TAMAMLANDI |
| T37 | Phase 3 — Real marketplace execution: Seaport 1.6 EIP-712 signing, OpenSea API (list/bid/cancel), counter fetch via eth_call | Atlas/Forge | ✅ TAMAMLANDI |
| T38 | Phase 3 — OpenSea API key: keychain storage, Tauri commands, Settings UI | Atlas/Forge | ✅ TAMAMLANDI |
| T39 | Phase 3 — License key HTTP validation: async check_license_key with offline fallback | Atlas | ✅ TAMAMLANDI |

---

## Tamamlanan Tasklar

| ID  | Görev | Atanan | Çıktı Lokasyonu | Kapanış |
|-----|-------|--------|-----------------|---------|
| T00 | Proje klasörü kurulumu ve CLAUDE.md | Nova | westron/CLAUDE.md | 2026-03-22 |
| T00b | westron.pen tasarım dosyası incelendi | Nova | Desktop/westron.pen | 2026-03-22 |
| T01 | Electron vs Tauri tradeoff analizi | Atlas | agency-decisions.md | 2026-03-22 |
| T02 | Transaction signing mimarisi öneri | Atlas | agency-decisions.md | 2026-03-22 |
| T07 | u128→BigInt serialization fix | Atlas | src-tauri/src/envelope/types.rs | 2026-03-22 |
| T08 | ETH RPC + Alchemy entegrasyonu | Vault | src-tauri/src/rpc/client.rs | 2026-03-22 |
| T09 | Portfolio tracking UI | Forge | src/app/page.tsx | 2026-03-22 |
| T10 | Token metadata (getTokenMetadata) | Vault | src-tauri/src/rpc/client.rs | 2026-03-22 |
| T11 | ETH/USD fiyat feed (CoinGecko) | Vault | src-tauri/src/rpc/client.rs | 2026-03-22 |
| T12 | Transfer history UI | Forge | src/app/page.tsx | 2026-03-22 |
| T13 | API key → Keychain | Vault | src-tauri/src/wallet/keychain.rs | 2026-03-22 |
| T14 | Wallet validasyonu | Forge | src/app/page.tsx | 2026-03-22 |
| T15 | NFT API entegrasyonu (getNftsForOwner + getFloorPrice) | Vault | src-tauri/src/rpc/client.rs | 2026-03-22 |
| T16 | NFT Gallery UI | Forge | src/app/gallery/page.tsx | 2026-03-22 |
| T17 | Alerts backend (SQLite + engine + Discord webhook) | Vault | src-tauri/src/alerts/ | 2026-03-23 |
| T18 | Alerts UI | Forge | src/app/alerts/page.tsx | 2026-03-23 |
| T19 | Transaction signing engine (alloy 1.x + EIP-1559) | Vault | src-tauri/src/signing/ | 2026-03-23 |
| T20 | Bulk Actions UI (multi-select + action bar) | Forge | src/app/gallery/page.tsx | 2026-03-23 |
| T21 | Sniping engine (SnipeRule DB + Envelope guard) | Vault | src-tauri/src/sniping/ | 2026-03-23 |
| T22 | Sniping & Automation UI + Envelope panel | Forge | src/app/sniping/page.tsx | 2026-03-23 |

---

## Blocker Geçmişi

| Task-ID | Blocker | Çözüm | Süre |
|---------|---------|-------|------|
| T08/T09 | Agent Bash/Edit/Write izni yoktu | settings.json'a eklendi | - |
| T08 | keyring delete_credential() API hatası | delete_password() olarak düzeltildi | - |
| T07 | u128 JS BigInt precision | u128_as_string serde helper yazıldı | - |

---

## Notlar

Nova bu dosyayı her session başında okur, her görev geçişinde günceller.
Durum kodları: 🟡 DEVAM · 🔴 BLOCKER · ⏸ BEKLEMEDE · ✅ TAMAMLANDI · ❌ İPTAL
