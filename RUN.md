# Westron — RUN

Nasıl çalıştırılır ve her özellik nasıl doğrulanır. Türkçe, komut + beklenen sonuç.

## Uygulamayı çalıştır (geliştirme)

```
npm install
npm run dev:tauri
```

İlk build birkaç dakika sürer (Rust derlemesi). Sadece web önizleme için: `npm run dev`.

## Abonelik worker'ı doğrula

Worker canlı adresi: `https://westron-subscription.ebaltepe.workers.dev`

**1. Worker ayakta mı, hesap açılıyor mu:**
```
curl -s -X POST https://westron-subscription.ebaltepe.workers.dev/signup \
  -H "Content-Type: application/json" \
  -d '{"email":"test@example.com","password":"TestPass123!"}'
```
Beklenen: HTTP 201, `token`, `account`, `access` (7 günlük trial) ve imzalı bir `license` alanı
içeren bir JSON. (Test hesabını silmeyi unutma — aşağıdaki komutla.)

**2. Veritabanı tabloları yerinde mi:**
```
cd subscription-worker
npx wrangler d1 execute westron-db --remote --command "SELECT name FROM sqlite_master WHERE type='table'"
```
Beklenen: `users`, `subscriptions`, `payer_wallets`, `sessions` (+ Cloudflare'in kendi `_cf_KV`'si).

**3. Test hesabını temizle (curl ile signup denedikten sonra):**
```
npx wrangler d1 execute westron-db --remote --command "DELETE FROM users WHERE email='test@example.com'"
```

## Henüz doğrulanamayan (secret eksik)

Ödeme webhook'u ve API-key proxy — 4 secret girilene kadar test edilemez.
Bkz. `STATUS.md` → "Blocked" bölümü ve `subscription-worker/DEPLOY.md`.
