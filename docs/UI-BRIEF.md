# Westron — UI Tasarım Brief'i

**Tarih:** 14.08.2026
**Kapsam:** Canlıya çıkış için gereken bütün ekran işleri.
**Bu belge kendi kendine yeter** — temiz bir oturumda yalnız bunu okuyup işe başlanabilir.
Kod referansları `dosya:satır` biçimindedir ve 14.08.2026 tarihli `main` (`71533ee` + armed
oturum çalışması) durumuna göredir.

---

## 0. Bu brief'in çıkış noktası

Emir'in 13–14.08 oturumundaki talebi: **"Artık fake veya dummy hiçbir şey kullanmak
istemiyorum. Her şey canlıya çıkacak gibi olsun."**

Yapılan denetimde bulunan sahtelikler bu belgenin 3. bölümünde listelendi. Tasarım işinin
amacı yeni ekran üretmek değil; **var olan ekranların söylediği şeyi gerçekten yapar hâle
getirmek** ve yapamadığı şeyi dürüstçe söylemesini sağlamak.

Yeni ekran yazmadan önce aynı işi yapan başka ekran var mı diye bakılır. Bu repo defalarca
aynı akışın iki üç sürümünü büyüttü.

---

## 1. Değiştirilemez kurallar (tasarım kısıtı olarak)

Bunlar stil tercihi değil. İhlal edildiklerinde kullanıcı parasını kaybeder ya da
kaybettiğini sanır.

1. **Ekran olmayan veriyi uydurmaz.** Veri yoksa `—` yazılır veya boş durum gösterilir.
   Placeholder rakam, sahte floor fiyatı, örnek cüzdan listesi yasak.
2. **Gerçekleşmemiş işlem gerçekleşmiş gibi gösterilmez.** "Confirmed", "Broadcast",
   "Sent" yalnız gerçek bir zincir/API yanıtından gelir. `setTimeout` ile ilerleyen sahte
   durum göstergesi yasak.
3. **Sessiz başarısızlık yasak.** Çalışmayan düğme nedenini söyler. Koşul sağlanmadığı
   için `return` eden handler, hangi koşulun eksik olduğunu göstermek zorundadır.
4. **"Hata" ile "kayıt yok" aynı şey değildir.** Boş sonuç boş durumdur, hata değil.
5. **Adres kullanıcıdan alınmaz.** Cüzdan adresi `import_wallet`'tan geri döner. Private
   key hiçbir alanda, logda, ekranda görünmez.
6. **Tutarlar BigInt ile hesaplanır.** `parseFloat('0.1') * 1e18` yanlış sonuç verir —
   `parseEthToWei` (`src/lib/distribute.ts`) kullanılır.
7. **`src/lib/tauri.ts` Rust'a tek köprüdür.** `invoke` başka yerde çağrılmaz.

---

## 2. 14.08.2026'da verilen ürün kararları

| # | Karar | Sonucu |
|---|-------|--------|
| 1 | **v1'de yalnız OpenSea.** | Blur ve MagicEden bütün ekranlardan **kaldırılacak**. "Yakında" yazan düğme bırakılmayacak. |
| 2 | **Arm-at-creation.** Zamanlanmış görev yaratılırken bir kez Touch ID alınır; anahtar o pencere boyunca bellekte tutulur, tetiklemede yeniden istem çıkmaz. | Ekranın "armed / disarmed" durumunu göstermesi ve uygulama kapanınca disarm olduğunu söylemesi **zorunlu**. |
| 3 | **Abonelik tahsilatı yalnız on-chain.** Para cüzdana gelince, ödeyenin adresinden abonelik statüsü değişir. | Parametreler henüz belirsiz — bkz. §10. |

---

## 3. Bugünkü sahtelikler — temizlenecek liste

| # | Yer | Sorun |
|---|-----|-------|
| S1 | `src/app/bulk/cancel/page.tsx:60,125` | Satırlar `fakeHash()` ile başlatılıyor. Gerçek sonuçta hash yoksa **sahte hash "Confirmed" etiketiyle ekranda kalıyor.** |
| S2 | `src/app/bulk/bulk-bid/page.tsx:64,141` | Aynı sorun, daha kötüsü: gerçek sonucun hash'i satıra **hiç yazılmıyor**. Sahte hash sonuna kadar kalıyor. |
| S3 | `bulk/cancel` ve `bulk/bulk-bid` | "Broadcasting → 400ms `setTimeout` → Confirmed". Zincirden makbuz beklenmiyor. Üstelik OpenSea listeleme/teklifi **off-chain** — orada "Confirmed" kelimesi baştan yanlış. |
| S4 | `src/app/bulk/cancel/page.tsx:39` | `const ORDERS: Order[] = []` — açık emirleri çeken çağrı yok, ekran sonsuza kadar boş. |
| S5 | `src/app/bulk/list/page.tsx:135,238` | Tarayıcı modunda sahte ilerleme ve mock NFT'ler. Tauri dışında kaldığı için kritik değil ama **ayrılmalı**: mock veri yolu üretim bileşenine karışmamalı. |
| S6 | `src/app/gallery/page.tsx:50,248` | "Transaction signing coming soon" — bağlanmamış aksiyon. |
| S7 | `src/app/monitor/collection/page.tsx:419,703,838` | Buy ve Offer devre dışı. Dürüst yazılmış (fake "Purchase Complete" yok) ama canlı değil. |
| S8 | `src/app/settings/page.tsx:1264` | Abonelik ödeme adresi yok. |

**Backend tarafındaki karşılığı (tasarımı ilgilendirdiği kadarıyla):**
- Snipe motoru zincire dokunmuyor: `src-tauri/src/sniping/engine.rs:203` sahte hash üretir,
  `engine.rs:180`'de işlemin `to` alanı placeholder olarak cüzdanın kendisidir.
  → **Sniper ekranı bugün gerçek alım yapmaz.** Ekran bunu söylemeden "armed" göstermemeli.
- **Approval (yetki) akışı hiç yok.** Seaport emirleri OpenSea conduit ile imzalanıyor
  (`src-tauri/src/marketplace/seaport.rs:15,317,380`) ama `setApprovalForAll` /
  WETH `approve` işlemi kodun hiçbir yerinde yok. Yani listeleme ve teklif **imzalanır,
  OpenSea kabul eder, ama doldurulamaz.** Bu, tasarımı doğrudan ilgilendirir: §7.

---

## 4. Durum sözlüğü — tek kaynak

Bugün her ekran kendi durum adlarını uyduruyor. Tek bir sözlük olacak ve **her ekran
bunu kullanacak**. `Confirmed` yalnız zincir makbuzu olan işlemler içindir.

| Durum | Ne zaman | Görsel | Hangi akışta |
|-------|----------|--------|--------------|
| `Idle` | Henüz başlamadı | nötr | hepsi |
| `Signing` | Anahtar okundu, imza atılıyor (Touch ID çıkabilir) | uyarı | hepsi |
| `Submitted` | OpenSea emri kabul etti (**off-chain, zincirde işlem yok**) | bilgi | listeleme, teklif |
| `Broadcasting` | Zincire gönderildi, makbuz bekleniyor (tx hash var) | bilgi | approval, cancel, transfer |
| `Confirmed` | **Zincir makbuzu geldi** (`status: 0x1`) | başarı | yalnız zincir işlemleri |
| `Reverted` | Makbuz geldi ama `status: 0x0` | hata | yalnız zincir işlemleri |
| `PendingApproval` | Otonomi politikası kuyruğa aldı — gönderilmedi, **hata değil** | uyarı | hepsi |
| `Failed` | Gerçek bir hata döndü — mesajı gösterilir | hata | hepsi |
| `Disarmed` | Cüzdan silahlı değil, kural tetiklenemez | uyarı | zamanlanmış görevler |

**Kural:** `Submitted` ile `Confirmed` asla karıştırılmaz. OpenSea listelemesi hiçbir zaman
`Confirmed` olmaz — dolduğunda ayrı bir olaydır ("Sold" / "Filled") ve ancak emir durumu
API'den okunduğunda gösterilir.

Sahte hash yok: hash alanı gerçek hash gelene kadar **boş** (`—`) durur.

---

## 5. Ekran: Zamanlanmış görevler / Sniper (EN ÖNCELİKLİ)

Backend hazır, **UI hiç bağlanmadı**. Bugün kural yaratmayı denersen backend hata döner ve
ekran bunu düzgün göstermez.

### Yeni komutlar (`src/lib/tauri.ts`'e eklenecek)

```ts
arm_wallet_for_tasks({ walletAddress, ttlHours? }) -> ArmedStatus   // Touch ID istemi BURADA çıkar
disarm_wallet_for_tasks({ walletAddress })         -> ArmedStatus
wallet_armed_status({ walletAddress })             -> ArmedStatus

type ArmedStatus = {
  address: string;
  armed: boolean;
  armed_at: number | null;   // unix saniye
  expires_at: number | null; // unix saniye
};
```
`create_snipe_rule` artık silahsız cüzdanda hata döner:
`"wallet is not armed — approve with Touch ID before creating the rule"`.

### Akış

1. Kullanıcı kural formunu doldurur → **"Arm & Create"** düğmesi.
2. `arm_wallet_for_tasks` çağrılır → **gerçek Touch ID istemi çıkar**.
   - İptal edilirse: kural **yaratılmaz**, form korunur, mesaj: "Touch ID iptal edildi —
     kural oluşturulmadı." (sessiz başarısızlık yasak)
3. Başarılıysa `create_snipe_rule` çağrılır.
4. Kural listesinde cüzdanın armed rozeti ve **kalan süre geri sayımı** görünür.

### Gösterilmesi zorunlu durumlar

- **Armed:** "Bu cüzdan {tarih saat}'e kadar silahlı." Yanında **Disarm** düğmesi.
- **Disarmed:** kural satırı gri, rozet "Disarmed", tek tık **Re-arm** (yine Touch ID).
- **Uygulama kapanınca disarm olur.** Bu cümle kural yaratma ekranında **açıkça yazılı
  olacak** — kullanıcı gece bilgisayarı kapatırsa kuralın çalışmayacağını önceden bilmeli.
- **Scheduler kapalı** (`control/scheduler.rs` varsayılanı): kural kaydedilir ama hiç
  kontrol edilmez. Ekran bunu "Zamanlayıcı kapalı — hiçbir kural kendiliğinden
  çalışmayacak" diye söyler ve açma düğmesi sunar.
- **Kill switch:** aktifleştirilince bütün cüzdanlar disarm olur. Ekran bunu anında
  yansıtmalı.
- **Her silahlandırma yeniden Touch ID ister.** İkinci kural = ikinci istem. Bu bilinçli;
  arayüz "zaten silahlıydı, sormadan uzattık" izlenimi vermemeli.

### Ve en önemlisi

**Sniper bugün gerçek alım yapmıyor.** Gerçek Seaport fulfilment bağlanana kadar ekran
tetiklemeyi "satın alındı" gibi gösteremez. Kural kartında kalıcı bir uyarı şeridi:
*"Simülasyon: kural tetiklendiğinde gerçek alım yapılmaz."* Bu şerit, fulfilment
bağlandığında kaldırılacak — o güne kadar kaldırılması yasak.

---

## 6. Ekranlar: Bulk List / Cancel / Bid

### Yapılacaklar
1. `fakeHash()` **tamamen silinecek** (`cancel/page.tsx:60`, `bulk-bid/page.tsx:64`).
   Hash alanı gerçek hash gelene kadar `—`.
2. `setTimeout` ile ilerleyen durum **silinecek**. Durum yalnız gerçek yanıtla değişir.
3. §4'teki sözlük kullanılacak. OpenSea listeleme/teklif → `Submitted`, `Confirmed` değil.
4. Tarayıcı modundaki sahte ilerleme (`bulk/list/page.tsx:135`) üretim bileşeninden
   ayrılacak: mock veri yolu ayrı bir modülde kalacak ve Tauri içinde asla çalışmayacak.
5. Blur/MagicEden seçenekleri kaldırılacak.
6. Hata mesajları kullanıcının anlayacağı dilde olacak. Bugün `envelope blocked: {:?}`
   gibi Debug formatı ekrana gidiyor — bu ham hâliyle gösterilmeyecek.
   Ton örneği: `explainSendError` (`src/lib/`).

### Sonuç ekranı
Her satır şunu gösterir: ne oldu, ne zaman, kanıtı ne (emir hash'i veya tx hash'i, ikisi
farklı şeydir), başarısızsa neden.

---

## 7. Yeni akış: Approval (yetki verme) — **canlıya çıkışın ön şartı**

Bugün eksik olan en kritik parça. Onay olmadan hiçbir OpenSea emri gerçekten dolamaz.

- **NFT satmak için:** koleksiyon sözleşmesinde OpenSea conduit'ine `setApprovalForAll`.
- **Teklif vermek için:** WETH sözleşmesinde conduit'e `approve`.
- İkisi de **gerçek, gas harcayan zincir işlemidir** — zarf ve otonomi kapısından geçer
  (`SetApprovalForAll` otonomi eylem türü olarak zaten tanımlı).

### Tasarım gereksinimi
1. Listeleme/teklif akışının başında **ön kontrol**: yetki var mı? Yoksa akış durur ve
   kullanıcıya *önce* bu adım gösterilir. Yetkisiz emir imzalatıp "Submitted" demek yasak —
   dolmayacak bir emir yaratmış oluruz.
2. Yetki adımı ayrı ve anlaşılır: "OpenSea'nin bu koleksiyondaki NFT'lerini senin adına
   transfer etmesine izin veriyorsun. Bu bir zincir işlemi, gas harcar. Tek seferlik."
3. Tahmini gas gösterilir. `Broadcasting` → makbuz → `Confirmed`.
4. Koleksiyon başına bir kez; verilmiş yetkiler Settings'te listelenir ve **geri alınabilir**
   (revoke — o da bir zincir işlemi).
5. WETH yetkisi ayrı: tutar sınırlı mı sınırsız mı, kullanıcıya sorulur. Varsayılan
   **sınırlı** olmalı (teklif tutarı kadar), "sınırsız" bilinçli bir seçim olsun.

---

## 8. Ekran: Açık emirler (Cancel ekranının veri kaynağı)

`ORDERS` bugün boş dizi. Gerekli: OpenSea'den cüzdanın açık emirlerini çeken bir çağrı
(backend'de henüz yok, yazılacak).

- Sütunlar: NFT / koleksiyon, tür (listeleme mi teklif mi), fiyat, bitiş zamanı, durum.
- Durumlar: `Active`, `Expiring Soon` (< 24 s), `Expired`, `Filled`, `Cancelled`.
- **Boş durum ile hata durumu ayrı gösterilir.** "Açık emrin yok" ≠ "emirler yüklenemedi".
- Cancel bir zincir işlemidir (Seaport counter artırma veya emir iptali) → `Broadcasting` →
  `Confirmed`.

---

## 9. Ekranlar: Gallery & Collection Monitor

- `gallery/page.tsx:50,248` — "Transaction signing coming soon" toast'ı kaldırılacak.
  Aksiyon ya gerçekten bağlanır ya da düğme **devre dışı** olur ve nedenini söyler.
  Yalancı "yakında" bırakılmaz.
- `monitor/collection/page.tsx` — Buy/Offer bugün dürüstçe devre dışı. Approval ve
  fulfilment bağlanınca açılacak. O güne kadar devre dışı kalması **doğru davranış**,
  değiştirilmeyecek.

---

## 10. Ekran: Abonelik (on-chain) — parametreler bekliyor

Karar: tahsilat yalnız on-chain; para gelince ödeyenin adresinden statü değişir.

**Tasarım başlamadan Emir'den gereken:**
1. Tahsilat adresi (Ethereum mainnet).
2. Para birimi (ETH mi USDC mi) ve fiyat — aylık / yıllık.
3. Kaç blok onay bekleyip statü çevrilecek (öneri: 3).
4. Süre: ödemeden sonra kaç gün? Yenilemede ek süre mi, sıfırdan mı?
5. Eksik/fazla ödeme ne olur?
6. Mevcut e-posta/şifre girişi kalıyor mu, yoksa cüzdan = kimlik mi?

**Şimdiden bilinen tasarım riski:** "ödeyenin adresinden statü değişir" modeli, ödemenin
**uygulamada import edilmiş bir cüzdandan** yapılmasını zorunlu kılar. Kullanıcı Binance'ten
çekim yaparsa `from` borsanın hot wallet'ı olur ve abonelik yanlış adrese yazılır. Ödeme
ekranı bunu büyük ve net söylemeli: *"Ödemeyi bu cüzdandan gönder. Borsadan gönderilen ödeme
hesabına işlenmez."* Yanlış adresten gelen ödeme için bir kurtarma yolu tasarlanmalı.

---

## 11. Ekran: Settings

- API anahtarları (Alchemy, OpenSea, Etherscan) Keychain'de **tanımlı**. Ekran anahtarın
  varlığını gösterir, değerini asla göstermez. Anahtarın **çalıştığını** doğrulayan bir
  "Test et" düğmesi eklenecek — bugün tanımlı olması çalıştığı anlamına gelmiyor.
- Silahlı cüzdanlar listesi + kalan süre + tek tık disarm.
- Kill switch: "her şeyi durdur" — bunun silahlı cüzdanları da düşürdüğü yazılacak.
- Verilmiş approval'lar ve revoke (§7.4).

---

## 12. Tasarım sistemi notu

Tasarımlar `westron.pen` (Penpot) formatında. Native macOS kalite standardı; web-app
estetiği ve yavaş performans kabul edilmez. Mevcut bileşenler (`Tag`, `TagVariant` vb.)
korunacak — §4'teki sözlük bunların üstüne oturur, yeni bir rozet sistemi kurulmayacak.

---

## 13. Öncelik sırası

1. **Sniper armed/disarmed UI** (backend hazır, ekran yok — en büyük boşluk).
2. **Sahte hash + sahte "Confirmed" temizliği** (aktif yalan).
3. **Approval akışı** (canlıya çıkışın ön şartı).
4. **Açık emirler listesi** (cancel ekranı bugün işlevsiz).
5. **Blur/MagicEden kaldırma** (mekanik, hızlı).
6. **Abonelik ekranı** (parametreler gelince).

---

## 14. Emir'e açık sorular

1. Abonelik parametreleri (§10, 6 madde).
2. Test cüzdanı hâlâ yok: sistemde **hiç** cüzdan tanımlı değil
   (`~/Library/Application Support/Westron/keys` boş, keystore boş). Touch ID de bu yüzden
   henüz gözle doğrulanmadı. Ayrı bir test cüzdanı + ~0.1 ETH + ~0.01 WETH + ucuz 1 NFT
   gerekiyor.
3. Alchemy planı hangisi? Scheduler'ın açılabilmesi buna bağlı (free tier'da 429 alıyoruz).
4. Uygulama kapalıyken hiçbir görev çalışmaz. Kabul mü, yoksa arka planda çalışan bir
   login-item mi istiyorsun?

---

## 15. Bir iş "bitti" sayılmadan önce

- `cargo test --lib` + `tsc --noEmit` temiz (gerekli ama **yeterli değil**).
- Para veya anahtara dokunan her değişiklik **çalışan uygulamada** denenir.
- İddia edilen her davranışın gözlemlenebilir kanıtı olur: tx hash, emir hash'i, audit log
  kaydı, `spent_wei` değişimi, Keychain kaydı. "Kod doğru görünüyor" kanıt değildir.
- Doğrulanamayan şey **doğrulanmadı diye açıkça yazılır.**
