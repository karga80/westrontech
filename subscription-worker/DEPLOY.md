# Westron Backend — Kurulum (Faz 1: hesaplar + abonelik + API-key proxy)

Bu Worker artık tek kapı: **hesap (email/şifre) + abonelik + kripto ödeme takibi +
API anahtarı proxy'si**. Kullanıcılar önce web'de üye olur (7 günlük ücretsiz
deneme başlar), uygulamaya email/şifre ile girer, süre bitince kripto ile öder.
API anahtarları (Alchemy/OpenSea/Etherscan) **sunucuda** durur, kullanıcıya hiç inmez.

Güvenlik sınırı: private key'ler **asla** buraya gelmez. Sunucuda sadece email +
abonelik durumu tutulur.

---

## Gerekenler
- Ücretsiz Cloudflare hesabı — https://dash.cloudflare.com
- Terminalde `npm` kurulu.
- Üç API anahtarın hazır (senin — super-admin): Alchemy, OpenSea, Etherscan.

## 1. Bağımlılıklar
`subscription-worker/` klasöründe:
```
npm install
npx wrangler login          # tarayıcıda Cloudflare'e giriş
```

## 2. Veritabanı (D1) oluştur ve şemayı uygula
```
npx wrangler d1 create westron-db
```
Bu komut sana bir `database_id = "…"` verir. Onu `wrangler.toml` içindeki
`[[d1_databases]]` altındaki `database_id` alanına yapıştır. Sonra tabloları kur:
```
npx wrangler d1 execute westron-db --remote --file=./schema.sql
```

## 3. Ödeme cüzdanı + fiyatlar
`wrangler.toml` → `[vars]`:
```
PAYMENT_WALLET    = "0xSENIN_ODEME_CUZDANIN"   # küçük harf, ayrı bir cüzdan
MONTHLY_PRICE_ETH = "0.01"
ANNUAL_PRICE_ETH  = "0.09"
TRIAL_DAYS        = "7"
```

## 4. İmza anahtarı (offline lisans için)
Uygulamaya gömülü **açık anahtar** lisansı doğrular; Worker **özel anahtarla**
imzalar. Özel anahtar hiçbir zaman uygulamaya gitmez. Yeni bir çift üret:
```
node -e 'const c=require("crypto");const{publicKey,privateKey}=c.generateKeyPairSync("ed25519");console.log("PUBLIC:",Buffer.from(publicKey.export({format:"jwk"}).x,"base64url").toString("base64"));console.log("PRIVATE_PKCS8:",privateKey.export({type:"pkcs8",format:"der"}).toString("base64"))'
```
PUBLIC değerini uygulamadaki `src-tauri/src/subscription/mod.rs` →
`LICENSE_PUBLIC_KEY_B64`'e yapıştır (Faz 2'de birlikte yapacağız). PRIVATE_PKCS8'i
bir sonraki adımda secret olarak gir.

## 5. Secret'ları gir (hiçbiri koda yazılmaz)
```
npx wrangler secret put LICENSE_SIGNING_KEY     # 4. adımdaki PRIVATE_PKCS8
npx wrangler secret put ALCHEMY_WEBHOOK_SECRET  # 7. adımdaki Alchemy signing key
npx wrangler secret put ALCHEMY_KEY             # app-wide Alchemy key
npx wrangler secret put OPENSEA_KEY             # app-wide OpenSea key
npx wrangler secret put ETHERSCAN_KEY           # app-wide Etherscan key
```

## 6. Deploy
```
npx wrangler deploy
```
Sana bir adres verir, örn: `https://westron-subscription.SENIN-SUBDOMAIN.workers.dev`.
Bu adres Faz 2'de uygulamaya ve Faz 3'te web sitesine yazılacak.

## 7. Alchemy webhook (ödeme algılama)
1. Alchemy dashboard → **Webhooks** → **Address Activity**.
2. İzlenecek adres: **ödeme cüzdanın**. Ağ: Ethereum Mainnet.
3. Webhook URL: `https://…workers.dev/webhook/alchemy`
4. Alchemy'nin verdiği **Signing Key**'i 5. adımdaki `ALCHEMY_WEBHOOK_SECRET`'e gir.

---

## Kripto ödeme nasıl hesaba bağlanıyor?
ETH transferinde "kim" bilgisi yoktur. Bu yüzden kullanıcı, billing sayfasında
**ödeyeceği cüzdanı kaydeder** (`POST /billing/register-wallet`). Worker, o
cüzdandan ödeme adresine gelen ödemeyi görünce ilgili **hesabı** aktif eder.
Kayıtlı olmayan bir cüzdandan gelen ödeme kimliklendirilemez ve yok sayılır.

## Uç noktalar (özet)
Hesap/abonelik:
- `POST /signup {email,password}` → hesap + 7g trial, `{token, access, license}`
- `POST /login  {email,password}` → `{token, access, license}`
- `GET  /me` (Bearer) → hesap + erişim + kayıtlı cüzdanlar
- `GET  /subscription/status` (Bearer) → `{active, reason, plan, expires_at}`
- `POST /license` (Bearer) → güncel imzalı lisans
- `POST /logout` (Bearer)

Billing:
- `GET  /billing/quote` → ödeme adresi + aylık/yıllık ETH
- `POST /billing/register-wallet {wallet}` (Bearer) → ödeyeceği cüzdanı bağla
- `POST /webhook/alchemy` → Alchemy ödeme bildirimi (HMAC doğrulamalı)

Veri proxy (Bearer + aktif abonelik şart; key sunucuda enjekte edilir):
- `/proxy/alchemy/rpc` (POST, JSON-RPC)
- `/proxy/alchemy/nft/<path>`
- `/proxy/alchemy/prices/<path>` · `/proxy/alchemy/data/<path>`
- `/proxy/opensea/<path>`
- `/proxy/etherscan/<path>`

## Hızlı test (deploy sonrası)
```
# sağlık
curl https://…workers.dev/health

# üyelik (trial ile döner)
curl -X POST https://…workers.dev/signup -H 'content-type: application/json' \
  -d '{"email":"test@example.com","password":"test1234"}'
```
`access.active=true, reason:"trial"` görürsen backend ayakta.

## Notlar
- Email doğrulama e-postası ve şifre sıfırlama Faz 1'de yok (email sağlayıcısı
  gerektirir) — Faz 3'te web sitesiyle eklenir.
- Eski cüzdan-bazlı `/validate` ve `/license {wallet}` kaldırıldı; yerini
  hesap-bazlı uçlar aldı.
