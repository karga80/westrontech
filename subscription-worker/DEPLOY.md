# Westron Abonelik Sistemi — Kurulum (yazılımcı olmayanlar için)

Bu sistem, kullanıcıların **sadece kripto (ETH) göndererek** abone olmasını sağlar.
Kredi kartı, hesap, üçüncü taraf ödeme sağlayıcısı yok. Nasıl çalışır, üç adımda:

1. Kullanıcı, senin **ödeme cüzdanına** ETH gönderir (aylık ya da yıllık tutar).
2. Küçük bir Cloudflare "worker" (sunucu), bu ödemeyi Alchemy webhook'u ile fark eder
   ve o cüzdan için aboneliği bitiş tarihiyle kaydeder.
3. Uygulama worker'dan **imzalı bir lisans** alır. Bu lisans kullanıcının
   bilgisayarında saklanır ve uygulama onu **internetsiz** doğrulayabilir.

## Neden "imzalı lisans"? (senin sorduğun offline kilitleme)

- Lisans, worker'ın **özel imza anahtarıyla** imzalanır. Uygulama içine gömülü
  **açık anahtarla** doğrular. Kullanıcı lisans dosyasını açıp süreyi uzatmaya
  çalışırsa **imza bozulur** ve geçersiz olur.
- Uygulama, gördüğü en son zamanı saklar. Kullanıcı bilgisayarın saatini geri
  alsa bile süre uzamaz (saat-geri-alma koruması).
- İnternet olmadan da çalışır: bir kez bağlanıp lisansı aldıktan sonra offline
  doğrulanır.

Özel anahtar **hiçbir zaman** uygulamaya veya kullanıcının bilgisayarına gitmez.

---

## Kurulum adımları

### 0. Gerekenler
- Bir Cloudflare hesabı (ücretsiz) — https://dash.cloudflare.com
- Terminalde `npm` kurulu olması.

### 1. İmza anahtarı
Aşağıdaki **hazır anahtar çifti** geliştirme/ilk kurulum için üretildi:

```
UYGULAMAYA GÖMÜLÜ AÇIK ANAHTAR (zaten kodda):
  src-tauri/src/subscription/mod.rs → LICENSE_PUBLIC_KEY_B64 =
  EQFxzxkeDSAeEoq9908geKlTC/lok9eb8o2t3rdAkHI=

WORKER'A SECRET OLARAK GİRİLECEK ÖZEL ANAHTAR (PKCS8, base64):
  MC4CAQAwBQYDK2VwBCIEIIxTG74w9TXpfq1T6R28r4pbbkMiPHb+MOgoFTz3aBuJ
```

> **Canlıya çıkmadan önce (production):** Güvenlik için kendi anahtar çiftini
> üret ve yukarıdakileri değiştir. Tek satır (Terminal, Node kurulu ise):
> ```
> node -e 'const c=require("crypto");const{publicKey,privateKey}=c.generateKeyPairSync("ed25519");console.log("PUBLIC:",Buffer.from(publicKey.export({format:"jwk"}).x,"base64url").toString("base64"));console.log("PRIVATE_PKCS8:",privateKey.export({type:"pkcs8",format:"der"}).toString("base64"))'
> ```
> Çıkan PUBLIC değerini `mod.rs`'teki `LICENSE_PUBLIC_KEY_B64`'e yapıştır,
> PRIVATE_PKCS8 değerini aşağıdaki 4. adımda secret olarak gir.

### 2. Ödeme cüzdanı
Sadece abonelik ödemelerini alacak **ayrı bir ETH cüzdanı** oluştur (ana
cüzdanınla karıştırma). Adresini not et.

### 3. Worker'ı deploy et
`subscription-worker/` klasöründe Terminalde:
```
npm install
npx wrangler login          # tarayıcıda Cloudflare'e giriş
npx wrangler kv namespace create SUBS    # abonelik kayıtları için depo
```
Son komut sana bir `id = "...."` verir. Onu `wrangler.toml` içinde
`[[kv_namespaces]]` altındaki `id` alanına yaz.

Ayarları `wrangler.toml`'da doldur:
```
[vars]
PAYMENT_WALLET   = "0xSENIN_ODEME_CUZDANIN"   # küçük harf
MONTHLY_PRICE_ETH = "0.01"
ANNUAL_PRICE_ETH  = "0.09"
PRICE_TOLERANCE   = "0.20"
```
Sonra deploy:
```
npx wrangler deploy
```
Deploy sonunda sana bir adres verir, örn:
`https://westron-subscription.SENIN-SUBDOMAIN.workers.dev`

### 4. Secret'ları gir
```
npx wrangler secret put LICENSE_SIGNING_KEY
# yukarıdaki PRIVATE_PKCS8 base64 değerini yapıştır

npx wrangler secret put ALCHEMY_WEBHOOK_SECRET
# (5. adımdaki Alchemy webhook signing key'i buraya)
```

### 5. Alchemy webhook (ödeme algılama)
1. Alchemy dashboard → **Webhooks** → **Address Activity** oluştur.
2. İzlenecek adres: senin **ödeme cüzdanın**. Ağ: Ethereum Mainnet.
3. Webhook URL: `https://…workers.dev/webhook/alchemy`
4. Alchemy'nin verdiği **Signing Key**'i 4. adımdaki `ALCHEMY_WEBHOOK_SECRET`'e gir.

### 6. Uygulamadaki worker adresini güncelle
`src-tauri/src/subscription/mod.rs` içinde:
```
pub const WORKER_URL: &str = "https://westron-subscription.YOUR_SUBDOMAIN.workers.dev";
```
`YOUR_SUBDOMAIN`'i 3. adımdaki gerçek adresinle değiştir. (Bu tek satırlık
değişikliği ben ya da Claude Code senin için yapabilir.)

---

## Test
1. Worker deploy edildikten sonra ödeme cüzdanına küçük bir test ETH'i gönder
   (aylık tutar kadar).
2. Alchemy webhook birkaç saniye içinde worker'ı tetikler, abonelik kaydolur.
3. Uygulamada ilgili cüzdanla giriş yap → PRO görünmeli.
4. İnterneti kapat, uygulamayı yeniden aç → hâlâ PRO olmalı (offline lisans).

## Uç noktalar (özet)
- `POST /license  {wallet}` → aktifse `{active:true, payload, sig}` (imzalı lisans)
- `POST /validate {wallet}` → hızlı online kontrol `{active, plan, expires_at}`
- `POST /webhook/alchemy`   → Alchemy ödeme bildirimi (imza doğrulamalı)
