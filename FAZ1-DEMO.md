# Faz 1 — çalıştırma ve demo (Emir için)

Bu, Westron × Claude entegrasyonunun Faz 1'ini Mac'inde çalışır halde görmek
için gereken tam liste. Sniping hâlâ **simülasyon** — gerçek alım yok (Faz 2).

---

## ⚠️ ÖNCE OKU — bu kopyadaki üç sahte ikon

Bu çalışma kopyasında `src-tauri/icons/` klasörü yoktu; `cargo check`,
`tauri::generate_context!` aşamasında "failed to open icon
src-tauri/icons/32x32.png" diye patlıyordu. Derlemeyi doğrulayabilmek için üç
dosya **yer tutucu olarak üretildi** (düz renk PNG'ler):

```
src-tauri/icons/32x32.png
src-tauri/icons/128x128.png
src-tauri/icons/128x128@2x.png
```

**Bunları gerçek repoya kopyalama.** Sendeki gerçek ikonların üzerine yazarlar.
Sadece bu sandbox'ta derleme yapılabilsin diye varlar; başka hiçbir işlevleri
yok. Dosyaları geri alırken bu üç yolu hariç tut (PM zaten hariç tutuyor, ama
kopyalamayı elle yaparsan dikkat).

---

## 0. Mac'siz kanıt (30 saniye)

MCP yüzeyinin çalıştığını Rust derlemesi beklemeden görmek istersen:

```bash
cd tools/westron-mcp
npm install
node smoke.mjs
```

Sahte bir kontrol sunucusu ayağa kalkar, MCP shim gerçek bir alt süreç olarak
başlatılır ve 15 tool'un hepsi uçtan uca çalıştırılır. Her satır `PASS`
olmalı, sonda `28 passed, 0 failed`.

---

## 1. Uygulamayı çalıştır

```bash
npm install                 # repo kökünde, frontend bağımlılıkları
npm run dev:tauri           # ya da: cargo tauri dev
```

Uygulama açılınca **kontrol sunucusu** başlar: `http://127.0.0.1:7777`, sadece
loopback. Port değiştirmek istersen `WESTRON_CONTROL_PORT=7788 npm run
dev:tauri`.

**Scheduler başlamaz.** Bu bilerek böyle — aşağıda 3. adımda açıyoruz.

### Token nereye düşüyor

```
~/Library/Application Support/Westron/control-token
```

İlk açılışta üretilir, 64 karakter hex (32 byte). Dosya **doğrudan 0600 ile
yaratılır** (önce yaratıp sonra chmod değil), yani token hiçbir an
dünya-okunabilir olmuyor:

```bash
ls -l ~/Library/Application\ Support/Westron/control-token
# -rw-------  1 emir  staff  64 ...
```

Token'sız hiçbir uç nokta cevap vermez:

```bash
curl -s -o /dev/null -w "%{http_code}\n" http://127.0.0.1:7777/status
# 401

TOKEN=$(cat ~/Library/Application\ Support/Westron/control-token)
curl -s -H "Authorization: Bearer $TOKEN" http://127.0.0.1:7777/status | jq
```

Dışarıya bind edilmediğini de gör:

```bash
lsof -nP -iTCP:7777 -sTCP:LISTEN
# ... TCP 127.0.0.1:7777 (LISTEN)   ← 0.0.0.0 GÖRÜNMEMELİ
```

---

## 2. Claude desktop'a MCP sunucusunu tanıt

```bash
cd tools/westron-mcp
npm install
```

`~/Library/Application Support/Claude/claude_desktop_config.json`:

```json
{
  "mcpServers": {
    "westron": {
      "command": "node",
      "args": ["/Users/emir/Developer/westron/tools/westron-mcp/index.js"]
    }
  }
}
```

Yolu kendi repo yoluna göre düzelt — **mutlak** olmak zorunda. Sonra Claude
desktop'u tamamen kapat (⌘Q) ve yeniden aç. Tools menüsünde `westron_*`
araçları görünmeli.

---

## 3. İLK KONTROL: scheduler kapalı, bilerek aç

**Bunu ilk yap.** Otomatik snipe döngüsü her açılışta **KAPALI** başlıyor.

Neden: Alchemy ücretsiz katmandasın ve yoğun eşzamanlı çağrıların HTTP 429
döndürüp cüzdan verisini uygulama genelinde boşalttığı gerçek bir vaka zaten
kayıtlı. Sürekli açık 15 saniyelik bir floor poll'ü, çıktısı şu an sadece
simüle bir tx hash olan bir özellik için o kotayı ilk açılıştan itibaren
harcar. Ürün sıralaması da "önce izleme, sonra işlem, en son otomasyon".

Claude'a sor:

> Westron'un durumunu göster. Scheduler açık mı?

`westron_status` cevabında göreceğin şey:

```json
"scheduler": { "enabled": false, "interval_secs": 15, "last_check_at": null },
"scheduler_hint": "The snipe scheduler is OFF. Rules are stored but NOT checked
 automatically — nothing will ever fire on its own. Turn it on with
 westron_scheduler {\"enabled\": true}, or run a single check by hand with
 westron_snipe_check_now."
```

Açmak için:

> Scheduler'ı aç.

Claude `westron_scheduler {enabled: true}` çağırır, cevapta
`"enabled": true` ve "checking active rules every 15 seconds" gelir. Kapatmak
istediğinde aynı tool `enabled: false` ile.

Bunu atlarsan kural oluşturur, kurulu sanır, hiçbir şey tetiklenmez —
`POST /rules` cevabı da `scheduler_enabled: false` + aynı uyarıyı döndürüyor
ki bu sessizce olmasın.

---

## 4. Claude'dan denenecek üç prompt

### Prompt 1 — "Westron ne durumda?"

> Westron'un durumunu kontrol et. Envelope var mı, scheduler çalışıyor mu, kaç
> aktif kural var?

**Görmen gereken:** `westron_status`. Cevapta `app_version`, `envelope: null`
(henüz envelope yoksa), `kill_switch: false`, `scheduler.enabled` ve
`scheduler_hint`, `active_rule_count: 0`, `alchemy_key_configured`.

Döngü açıkken iş yapmadıysa `last_cycle.skipped_reason` nedenini açıkça
söyler: `"no active rules"`, `"no Alchemy API key configured…"`,
`"kill switch active"`.

### Prompt 2 — "Envelope kur ve bir kural yaz"

> Şu cüzdan için 1 ETH per-tx tavanı ve 2 ETH toplam limitle bir envelope aç:
> 0x… . Sonra Bored Ape kontratı
> 0xbc4ca0eda7647a8ab7c2061c2e118a18a936f13d için floor 10 ETH'in altına
> düşerse tetiklenecek bir kural oluştur, 24 saat geçerli olsun ve toplam 10
> ETH'i geçmesin. Ardından durumu tekrar göster.

**Görmen gereken:** `westron_create_envelope` → `westron_create_rule` →
`westron_status`.

* Envelope cevabı `ttl_hours_applied: 24`, `ttl_hours_defaulted: true` ve
  `expires_at_rfc3339` döndürür — `ttl_hours` vermediysen envelope'un 24 saat
  sonra öleceğini orada öğrenirsin, sonradan sürprizle değil. Tavan 168 saat.
* Kural cevabında `expires_at`, `max_total_spend_eth: 10.0`, `spent_eth: 0.0`
  dolu; ayrıca scheduler kapalıysa `scheduler_enabled: false` + uyarı.
* Scheduler açıksa 15 saniye içinde `last_cycle.results` içinde o kural için
  gerçek floor fiyatı görünür.

Kontrat adresi yerine slug verirsen floor `null` döner ve kural hiç
tetiklenmez — tool açıklamaları ısrarla "contract address, slug değil" diyor.

### Prompt 3 — "Şimdi kontrol et, sonra her şeyi durdur"

> Beklemeden hemen bir snipe kontrolü çalıştır, ne gördüğünü söyle. Sonra kill
> switch'i aç.

**Görmen gereken:** `westron_snipe_check_now` — scheduler kapalı olsa bile
çalışır. Her aktif kural için `floor_price_eth` ve `triggered`. Floor hedefin
altındaysa `triggered: true` ve `tx_hash: "0xSIMULATED_snipe_…"` —
**simülasyon**, gerçek işlem yok. Uygulama penceresinde `snipe-triggered`
event'i düşer; alert'te Discord webhook'u tanımlıysa mesaj gider.

Ardından `westron_kill_switch {active: true}`. Bundan sonra:
* scheduler döngüsü `skipped_reason: "kill switch active"` yazar ve hiç deneme
  yapmaz;
* envelope her işlemi reddeder.

`westron_kill_switch {active: false}` ile geri açılır — envelope silinmez.
Envelope'u tamamen iptal etmek için `westron_revoke_envelope`.

---

## 5. Kuralların kendiliğinden kapanması

Bir kural iki durumda motor tarafından pasife çekilir ve nedeni kural
satırında `deactivated_reason` alanında görünür:

| `deactivated_reason` | Anlamı |
| --- | --- |
| `"expired"` | `expires_at` geçti (varsayılan 48 saat, tavan 168) |
| `"spend_cap_reached"` | `max_total_spend_eth` doldu — bir daha asla tetiklenemeyeceği için kapatılır, her döngüde boşuna floor sorgusu yakmasın diye |
| `null` | Motor kapatmadı; ya aktif ya da **sen** elle durdurdun |

Elle `westron_set_rule_active` ile tekrar açtığında `deactivated_reason`
temizlenir — o andan sonra kuralın durumu senin kararın.

Döngü özetinde de ayrı ayrı sayılır: `expired_deactivated` ve
`spend_capped_deactivated`.

---

## 6. Telefondan

Mac uyanık kalsın (`caffeinate -dims` ya da Enerji ayarı), Westron + Claude
desktop açık olsun. Cowork köprüsü üzerinden aynı prompt'lar telefondan da
çalışır — MCP sunucusu Mac'te, komutlar oradan geçiyor. Scheduler'ın açık
olduğundan emin ol (bkz. 3. adım), yoksa telefondan kurduğun kural
kendiliğinden hiç çalışmaz.

---

## 7. Bilerek yapılmayanlar (Faz 2)

* Gerçek Seaport fulfillment / alım. Şu an `0xSIMULATED_…`, kasten.
* Envelope persistence — uygulama kapanınca envelope kaybolur (in-memory).
* Mint sniping (kontrat state poll).
