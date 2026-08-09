# Emir'i bekleyen kararlar

Bir ajan, kendi yetkisinde olmayan bir kararla karşılaştığında buraya yazar ve
işin geri kalanına devam eder. Tahmin edip ilerlemek yasaktır.

Format: ne soruluyor, neden ajan karar veremiyor, seçenekler ve her birinin bedeli,
ajanın önerisi, ve karar verilene kadar ne bloke.

---

## D1 — Kural süresi dolmadan uyarı ne zaman ve nasıl gösterilmeli?

**Bağlam:** T4 kapsamında kural TTL üst sınırı 168 → 720 saate çıkıyor. Emir bu
artışı **bildirim koşuluyla** onayladı: kalan süre listede görünecek ve süre
dolmadan uyarı çıkacak. Uyarının zamanlaması ve biçimi kararlaştırılmadı.

**Neden ajan veremez:** Bu bir risk iştahı sorusu. Çok erken uyarı gürültü yapar ve
kullanıcı uyarıları görmezden gelmeye başlar; çok geç uyarı korumayı işlevsiz kılar.
Dengeyi ürünün sahibi seçer.

**Seçenekler:**
- Kalan sürenin %10'unda — süreye orantılı, ama 1 saatlik kuralda 6 dakika kalır.
- Son 24 saatte — uzun kurallar için anlamlı, 1-6 saatlik kurallarda hiç çıkmaz.
- İkisinin büyüğü — her iki uçta da makul, uygulaması biraz daha karmaşık.

**Biçim:** yalnızca liste rozeti mi, yoksa uygulama içi bildirim de mi?

**Orion önerisi:** ikisinin büyüğü + liste rozeti. Bildirim yalnızca kural
gerçekten süresi dolduğu için devre dışı kaldığında çıksın — o an kullanıcının
bilmesi gereken bir şey oldu demektir.

**Bloke ettiği:** T4'ün uyarı kısmı. Zamanlama ve dropdown'lar bundan bağımsız
ilerleyebilir.

---

## D2 — T6b/T9/T10 kararları (orion, 10.08.2026)

### T6b — Kendine gönderim uyarısı

İncelendi: üç `DistributeModal` kopyası da (`src/app/page.tsx`, `src/app/wallets/page.tsx`,
`src/app/bulk/distribute/page.tsx`) hedef listesini `allWallets.filter(w => w.id !== sourceId)`
ile kurup kaynağı **id bazında** listeden çıkarıyor. Yani "normal" senaryoda
kendine gönderim zaten yapısal olarak imkânsız — `WalletDetailClient`'taki serbest
metin adres alanının aksine burada seçim, kayıtlı cüzdanlarla sınırlı.

Gerçek boşluk başka yerde: filtre **id**'ye bakıyor, **adrese** değil. Aynı adres
iki ayrı wallet kaydı olarak import edilmişse (walletStore'da mümkün), ikinci
kayıt hedef listesinde görünür ve kaynakla aynı adrese göndermeyi hiçbir uyarı
olmadan onaylatır — sadece gaz yakılır, kullanıcı "dağıtım yaptım" sanır.

**Karar:** Tam bir uyarı bandosu eklemek gereksiz (çoğu durumda zaten engelli).
Bunun yerine: (1) hedef listesi filtresi ve step-2 önizleme, adres karşılaştırmasını
**adres bazlı** (case-insensitive) yapsın, id bazlı değil; adres eşleşirse
`WalletDetailClient:419`'daki ifadeyle aynı üslupta bir uyarı satırı çıksın
("X: bu hedef kaynakla aynı adres. Yalnızca gaz harcanır."). (2) Modalın açıklama
satırının altına tek satır not eklensin: "Kaynak cüzdan hedef listesinde görünmez."
Üç kopyanın hepsine ve T9'da eklenecek dördüncü kullanım noktasına uygulanır.

### T9 — Wallet detail: Distribute CTA + NFT transferi

**Önce mimari not:** `DistributeModal`'ın üç neredeyse birebir kopyası zaten var.
Dördüncüsünü wallet detail'e eklemek CLAUDE.md'nin açıkça yasakladığı deseni
tekrarlar. **Karar: forge kod yazmadan önce ortak bir `DistributeFundsModal`
bileşenine çıkarsın** (`wallets`, `initialSourceId?`, `lockSource?: boolean`,
`onClose` prop'larıyla), üç mevcut kullanım da ona geçsin, sonra wallet detail
eklensin. Bu T9'un parçası, ayrı görev değil.

**CTA:** Tek düğme, "Distribute", header'da Etherscan düğmesinin solundaki boşlukta
(ekran görüntüsündeki kırmızı kutu tek bir alanı işaretliyor). Açılan modalda iki
sekme: "Send Funds" (mevcut akış, kaynak bu cüzdana kilitli — dropdown yok) ve
"Send NFT" (yeni). Varsayılan sekme: Send Funds.

**NFT transferi ve zarf:** Yeni alan/cap eklemeye gerek yok. NFT gönderimi mevcut
`evaluate()`'i **`value_wei = 0`** ile çağırsın — kill switch, expiry ve scope
kontrolünü bedelsiz devralır; hard cap/per-tx ceiling 0 wei'yi zaten geçirir.
Bedeli açık: NFT hedefi, o cüzdanın ETH scope listesinde olmalı — kullanıcı hiç ETH
göndermeyi düşünmediği bir adrese NFT hediye etmek için önce o adresi scope'a
eklemek zorunda kalır. Bunu kabul ediyorum çünkü alternatifi (ayrı bir NFT-adres
listesi) onaylanmamış bir adrese geri dönüşü olmayan bir transferi mümkün kılar —
CLAUDE.md'nin "her irreversible aksiyon guard'lı olmalı" kuralına aykırı. Ayrı bir
NFT allowlist isteği gelirse bu Emir'in kapsam kararıdır, ajan genişletmez.

**Akış:** NFT + hedef seç → **Confirm adımı zorunlu** (gaz tahmini + "X NFT'sini
Y adresine gönderiyorsun" cümlesi) → imzala/yayınla. Mevcut Send Funds'ın
3 adımlı desenini (Select→Confirm→Process) birebir izler, tek onaylı kısayol yok —
yeni ve geri dönüşsüz bir yetenek için ekstra dikkat maliyeti düşük, hata maliyeti
yüksek. Gerçek gönderim bu oturumda yapılmaz; yalnızca preview/dry-run.

### T10 — Etherscan linkleri

Ürün kararı gerekmiyor, teyit edildi — forge doğrudan yapabilir. Bir incelik var:
`WalletDetailClient.tsx:1823`'teki mevcut düğme zaten düz `<a target="_blank" href="https://etherscan.io/...">`
kullanıyor, `window.open` değil. Tauri'nin WKWebView'inde `target="_blank"` bir
pencere delege'i olmadan sessizce hiçbir şey yapmayabilir — forge paketlenmiş
uygulamada bunun gerçekten OS tarayıcısını açıp açmadığını **önce ölçsün**;
açmıyorsa hem (a) hem (b) `@tauri-apps/plugin-shell`'in `open()`'ına geçsin.
Network belirsizliği yok: proje anayasası Ethereum Mainnet'e kilitli, testnet
ihtimali yok — her zaman `etherscan.io`.
