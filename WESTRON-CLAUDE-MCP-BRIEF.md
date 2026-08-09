# Westron × Claude Entegrasyonu — Geliştirme Brief'i
*Hazırlayan: Cowork oturumu, 08.08.2026 · Kaynak: repo incelemesi (`src-tauri/src`)*

## Hedef
Westron Mac'te çalışırken Claude'un (desktop + köprü üzerinden telefon) Westron'u
yönetebilmesi: koşullu emir oluştur/izle/iptal, portfolio sorgula, kill switch.
Cloud server YOK — her şey lokalde, key'ler Keychain'de kalır.

## Mimari (3 parça)

```
Claude (telefon) ──bulut oturumu──► Claude desktop (Mac)
                                        │ stdio
                                   [2] westron-mcp shim (Node, ~200 satır)
                                        │ HTTP 127.0.0.1:7777 (Bearer token)
                                   [1] Tauri app içi kontrol sunucusu (axum)
                                        │ doğrudan modül çağrıları
                                   Westron Rust çekirdeği + [3] scheduler döngüsü
```

Neden in-app sunucu (ayrı daemon değil): `EnvelopeEngine` ve `StreamManager`
in-memory state — ayrı process'te state kopyalanır, kill switch anlamını yitirir.
SQLite DB'ler (alerts, sniping, pnl) zaten dosya bazlı, sorun değil; ama tek
yazar süreç kalması daha güvenli.

## İş 1 — App içi kontrol sunucusu (Rust, axum)
- `src-tauri/src/control/` yeni modül. `run()` içinde tokio task olarak başlat.
- Sadece `127.0.0.1` dinle. Auth: ilk açılışta üretilen token
  `~/Library/Application Support/westron/control-token` (chmod 600).
- Endpoint'ler mevcut fonksiyonları sarar (Tauri command'ların gövdesini ortak
  fonksiyonlara çıkar, iki yerden çağır):
  - `GET /status` — app versiyonu, envelope durumu, scheduler durumu, aktif kural sayısı
  - `GET /portfolio/:address` — snapshot (mevcut `get_portfolio_snapshot`)
  - `GET /floor/:contract` — floor fiyatı
  - `GET|POST|DELETE /rules` + `POST /rules/:id/active` — snipe rule CRUD
  - `GET|POST|DELETE /alerts` — alert CRUD
  - `POST /envelope` / `DELETE /envelope` / `POST /kill-switch`
  - `POST /snipe-check` — döngüyü beklemeden anlık kontrol
- API key'ler Keychain'den okunur (mevcut `wallet::keychain`), HTTP katmanına
  asla parametre olarak girmez, response'larda asla yer almaz.

## İş 2 — MCP shim (`westron-mcp`, TypeScript, stdio)
- Ayrı klasör: `tools/westron-mcp/`. `@modelcontextprotocol/sdk` ile stdio server.
- Her endpoint'e karşılık bir tool: `westron_status`, `westron_portfolio`,
  `westron_floor_price`, `westron_list_rules`, `westron_create_rule`,
  `westron_cancel_rule`, `westron_create_envelope`, `westron_kill_switch`,
  `westron_snipe_check_now`, `westron_list_alerts`, `westron_create_alert`.
- Token'ı dosyadan okur. App kapalıysa anlaşılır hata döner ("Westron çalışmıyor").
- Claude desktop config'ine kayıt (`claude_desktop_config.json`) — kurulum
  adımı README'ye yazılacak.
- Tool açıklamaları emir formatını netleştirsin: fiyatlar ETH, kontrat adresi
  zorunlu (slug değil — mevcut floor lookup kontrat adresi bekliyor).

## İş 3 — Scheduler (app içi otomatik döngü)
- `start_background_polling` bugün sadece portfolio alert'i kontrol ediyor (30 sn).
  Aynı desende ikinci bir döngü: aktif snipe rule varsa `check_snipe_rules`
  her N saniyede (varsayılan 15 sn, ayarlanabilir) çalışsın.
- Döngü durumu `/status`'ta görünsün (son kontrol zamanı, son floor değerleri).
- Tetiklenen kural: macOS bildirimi + mevcut Discord/Telegram webhook'ları +
  `snipe-triggered` event'i (mevcut). Simülasyon modunda kalır (Faz 2'ye dek).

## İş 4 — Guardrail alanları (şema genişletme)
`SnipeRule`'a eklenecek: `expires_at` (zorunlu, varsayılan 48 saat),
`max_total_spend_eth` (kural bazlı tavan). Scheduler süresi dolan kuralı
otomatik pasife çeker. DB migration: sniping tablosuna 2 kolon.

## Kapsam DIŞI (Faz 2 — ayrı brief)
- Seaport **fulfillment/buy** implementasyonu (şu an yok; list/bid/cancel var).
  Gerçek alım ancak bununla mümkün. Feature flag + envelope zorunlu + ucuz
  koleksiyonda küçük tutarlı ilk test.
- Envelope persistence (restart'ta kaybolmasın).
- Mint sniping (kontrat state poll) — ayrı watcher.

## Kabul kriterleri
1. `cargo test` + mevcut 12 test geçiyor; `npm run dev:tauri` çalışıyor.
2. Claude desktop'tan: kural oluştur → `/status`'ta görün → floor koşulu
   sağlanınca (simülasyon) tetiklenip Discord'a bildirim düşüyor.
3. Telefondan (Cowork köprüsü ile) aynı akış çalışıyor — Mac uyanık +
   Claude desktop açıkken.
4. Token olmadan hiçbir endpoint cevap vermiyor; `0.0.0.0`'a bind yok.
5. Kill switch MCP'den tetiklenince scheduler işlem denemesini durduruyor.

## Çalışma zamanı gereksinimleri (Emir)
- Mac uyumasın: `caffeinate -dims` ya da Enerji ayarı; Westron + Claude desktop açık.
- Telefondan kullanım Cowork oturumu üzerinden (desktop köprüsü aktifken).
