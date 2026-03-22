# Agency Decisions — Westron
# Format: [TARİH] Karar: ... Gerekçe: ...

---

## [2026-03-22] T01 — macOS Wrapper: Tauri v2
**Karar:** Electron yerine Tauri v2 kullanılacak.
**Gerekçe:** Private key izolasyonu için Rust allowlist modeli yapısal güvence sağlar. WKWebView ile native macOS performansı. Bundle size ~10x küçük. SSR kaybı bu projede anlamsız — veri zaten Rust/API katmanından geliyor.
**Onaylayan:** Emir — 2026-03-22
**Uygulayan:** Atlas → Forge

---

## [2026-03-22] T02 — Transaction Signing: Authorization Envelope (Hybrid)
**Karar:** Sniping ve scheduler için Authorization Envelope modeli. Bulk action'lar dialog'lu kalır.
**Detaylar:**
- Envelope içeriği: max ETH/tx · max ETH/toplam (hard cap) · scope (kontrat adresleri) · TTL (default 24h, max 7 gün)
- Rust backend her automation işlemini Envelope'a karşı check eder
- İhlalde: işlem drop + macOS bildirim + audit log
- Zorunlu guard'lar: G1 Hard Cap · G2 Per-tx Ceiling · G3 Scope · G4 TTL · G5 Audit Log · G6 Kill Switch · G7 Bulk Dialog
- E1 (ephemeral key): Önce Keychain performansı ölçülecek, sonra karar
- E2 (max TTL): 7 gün
- E3 (v1 scope): Sniping + Scheduler Envelope'lu, Bulk Action dialog'lu
**Onaylayan:** Emir — 2026-03-22
**Uygulayan:** Atlas → Vault

---

## [2026-03-22] Sprint 1 — Çalışma Süreci Kararları (Nova Onayı)

- **ETH API Provider:** Alchemy primary (RPC + NFT API + WebSocket)
- **Keychain crate:** `keyring` ile başlanır, performans testinden sonra gözden geçirilir
- **Crash recovery:** SQLite/WAL — spent_wei ACID güvenceli saklanır
- **Marketplace scope whitelist:** Bilinen kontrat adresleri gömülü, kullanıcı seçer + manuel giriş açık
- **Audit log:** Şifrelenmez, macOS ACL koruması yeterli
- **Wallet import:** Native macOS dialog — private key JS'e hiç geçmez
- **Floor fiyat:** En düşük floor gösterilir, kaynak etiketlenir
- **Scheduled sweep:** Tray'de aktifken çalışır; uygulama tamamen kapalıyken çalışmaz

---

## [2026-03-22] E4 — Hard Cap Sonrası Davranış
**Karar:** Seçenek B — Otomatik kill switch. Spend cap dolduğunda tüm otomasyon kilitlenir, kullanıcı manuel olarak deaktive etmeden hiçbir şey çalışmaz.
**Onaylayan:** Emir — 2026-03-22
**Uygulayan:** Vault

## [2026-03-22] E5 — Trial Modeli
**Karar:** Full trial — süreli tam özellik erişimi. (Süre TBD — launch öncesi netleşecek.)
**Onaylayan:** Emir — 2026-03-22
**Uygulayan:** Orion (PRD güncellemesi)

## [2026-03-22] E6 — Sweep Limiti
**Karar:** Subscription tier'a göre değişir. (Tier başına limit TBD — fiyatlandırma netleşince belirlenecek.)
**Onaylayan:** Emir — 2026-03-22
**Uygulayan:** Orion (PRD güncellemesi)
