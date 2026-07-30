# Westron — Test Rehberi

İki tür test var: (1) otomatik testler (kod seviyesinde, `cargo test`), ve
(2) canlı ekran testleri (uygulamayı açıp elle kontrol). Yazılımcı olmayan
biri için asıl işe yarayan (2). Her ekranın **gerçek API'den beslenip
beslenmediğini** nasıl anlayacağın burada.

---

## 1. Otomatik testler (kod)

Rust backend testleri — Terminal'de `src-tauri/` içinde:
```
cargo test
```
Beklenen: hepsi `ok`. Şu an kapsananlar:
- **Envelope (harcama limiti) motoru** — 6 test: limit aşımı reddi, kapsam-dışı
  adres reddi, hard-cap → otomatik kill-switch, süresi dolmuş envelope reddi,
  kill-switch her şeyi bloke eder, limit içinde onay + harcama takibi.
- **Sister wallet finder** — 3 test: skorlama, zayıf sinyal, tekrar eleme.
- **Subscription (imzalı lisans)** — 3 test: sahte lisans reddi, açık anahtar
  geçerliliği, saat-geri-alma koruması.

> Bu testler mantığı doğrular. Ekranların gerçek veri gösterdiğini kanıtlamaz —
> onun için aşağıdaki canlı testler gerekli.

---

## 2. Canlı ekran testleri (uygulama)

### Hazırlık
1. `npm run dev:tauri` ile uygulamayı aç (ilk derleme birkaç dakika sürebilir).
2. Settings → Security → **Alchemy**, **OpenSea**, **Etherscan** anahtarlarını gir.
3. Settings → Security → o an kayıtlı **sahte cüzdanları sil** (0x1234…7890 gibi),
   **kendi gerçek adresini** ekle (watch-only yeterli).

> Kritik: Gerçek rakamlar ancak gerçek, bakiyesi olan bir adres + Alchemy
> anahtarı ile gelir. Sahte adres girersen $0 görürsün — bu bir hata değil.

### Her ekran için "gerçek mi?" kontrolü

Genel kural: Aynı değer birden fazla cüzdanda **birebir aynıysa** (örn. hepsi
"6 NFT · 7 Token · $154,383"), o mock'tur. Gerçek veri cüzdandan cüzdana değişir.

| # | Ekran | Ne yap | Gerçekse ne görürsün | Bozuksa/mock ise |
|---|-------|--------|----------------------|-------------------|
| 1 | **Dashboard** | Aç | Üst toplam = alttaki cüzdanların gerçek toplamı; sahte adreslerde $0 | Üst toplam büyük bir sayı ama cüzdanlar $0 → tutarsız |
| 2 | **Wallets** | Gerçek adres ekle | Bakiye, token, NFT sayısı gerçek | Tüm cüzdanlar aynı sayı |
| 3 | **Sister Wallet Finder** (Wallets sayfasında) | Bir adres yapıştır → "Find sisters" | Skorlu aday liste veya "no linked wallets"; funder satırı | "desktop app gerekli" (tarayıcıda) ya da Etherscan key hatası |
| 4 | **Wallet detail** (bir cüzdana tıkla) | Aç | NFT'ler gerçek (galeri). **Token tablosu ve analitik bloğu şu an hâlâ mock** — bkz. aşağıda | Token listesi/analitik her cüzdanda aynı |
| 5 | **Gallery** | Aç | Gerçek adresin NFT'leri, görselleriyle | Boşsa ve adres gerçekse: NFT yok demektir |
| 6 | **Portfolio** (holdings/analytics/transactions) | Aç | Gerçek bakiye/işlem/PnL | Sabit rakamlar |
| 7 | **Analytics** | Aç | PnL, trade sayıları gerçek | Sabit rakamlar |
| 8 | **Monitor → NFT Collections** | Bir koleksiyon izle | **Gerçek** OpenSea floor/hacim/satış (LIVE) | — (bu zaten çalışıyor) |
| 9 | **Monitor → Wallet Monitor** | Aç | Cüzdan başına farklı değerler | Hepsi aynı → mock |
| 10 | **Alerts** (page/rules/history/feed) | Bir alert oluştur | Liste gerçek (oluşturduğun kural görünür) | Sabit örnek alert'ler |
| 11 | **Bulk → List/Bid/Cancel** | Ucuz bir NFT ile dene | OpenSea'e gerçek imzalı order gider | Hata / işlem yok |
| 12 | **Bulk → Distribute** | Aç | **Şu an hâlâ mock cüzdan listesi** — bkz. aşağıda | Sahte cüzdanlar |
| 13 | **Sniping** | Kural oluştur | Kural kaydolur; floor gerçek; işlem **simüle** (`0xSIMULATED_`) | — (bu fazda simüle beklenir) |
| 14 | **Settings** | Aç | Anahtarlar kayıtlı; profil/limitler senin girdiğin | Profil "john@example.com", limitler $1.85 → mock |

### Bulk işlem (para hareketi) testi — dikkatli
Bulk list/bid/cancel gerçek OpenSea order'ı imzalar. Test ederken:
1. Önce **Sniping** ekranından envelope (harcama limiti) oluştur, limiti düşük tut.
2. Ucuz, önemsiz bir NFT ile dene.
3. Kill-switch'in çalıştığını doğrula (limit aşınca işlem durmalı).

---

## Bilinen kalan mock (bu fazda gerçek veriye bağlanacak)

Aşağıdaki 3 ekran hâlâ yerel mock veri gösteriyor. Bunları canlı build sırasında
gerçek veriye bağlayıp doğrulayacağız (kör bağlamak yerine ekranda gerçek verinin
aktığını görerek):

1. **Wallet detail** — token tablosu (`TOKEN_DATA`) ve analitik bloğu
   (`syntheticConfig`: bestPerformer, winRate, avgHoldTime…). NFT galerisi gerçek.
2. **Bulk → Distribute** — cüzdan listesi (`MOCK_WALLETS`). Gerçek cüzdan
   store'una bağlanacak.
3. **Monitor → Collection detail** — trait listesi (`MOCK_TRAITS`) ve örnek NFT
   satırları. Koleksiyon istatistikleri (floor/hacim) zaten gerçek.

---

## Güvenlik notu (senin denetleyeceğin — madde 11)

Uygulama şu an private key'leri ve API anahtarlarını macOS Keychain'de değil,
`~/Library/Application Support/Westron/keys/` altında **düz metin dosyalar**
olarak saklıyor. Bu, ürünün "key'ler şifreli/Keychain'de" vaadiyle çelişiyor.
Canlıya çıkmadan önce Keychain'e taşınmalı ve bağımsız güvenlik denetimi yapılmalı.
