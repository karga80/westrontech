# Westron — Görev Kuyruğu (09.08.2026)

Öncelik sırasıyla. Her görevde hangi ajanın, hangi sırayla çalışacağı yazılı.
Ayrıntılı bağlam: `docs/HANDOFF-2026-08-09.md`. Kurallar: `CLAUDE.md`.

---

## T1 — Birleşik sürüm hiç çalıştırılmadı  ⚠️ KISMEN DOĞRULANDI (10.08.2026)
`c8ddc71` merge'ünden sonra uygulama `orion` tarafından fiilen çalıştırıldı
(`npm run dev:tauri`, `cargo build` 604/604 temiz). Doğrulanan ekranlar:

- ✅ Dashboard — gerçek cüzdan/bakiye/gas verisi, konsol temiz
- ✅ Sentiment sekmesi — açılıyor, veri yoksa `—` yazıyor (uydurma yok); token
  bölümü kaydırılıp görülemedi
- ✅ Wallet detail — gerçek veri + kaynağı belirten dürüst boş durumlar
  ("Alchemy returned no owned NFTs..."), NaN koruması gözle görüldü
- ✅ Monitor (liste) — gerçek floor/hacim verisi, dürüst boş durumlar
- ⚠️ **Monitor/collection detay — ekranda hâlâ DOĞRULANAMADI**, `vera`'nın
  10.08.2026 turundan sonra da. Kod düzeyinde doğrulandı, ekranda değil.
- Gezilmeyen (kapsam dışı bırakıldı, düşük risk): settings, alerts/rules,
  gallery, bulk, sniping, login

**Ortam notu:** bu masaüstünde Accessibility izni yok, pencereler kararsız
öne geliyor. `orion` ekran otomasyonu sırasında bir tıklama yanlışlıkla
arka plandaki **gerçek** bir Chrome/OpenSea sekmesine gitti (canlı cüzdan
bağlı, bakiye görünür) ve sayfada navigasyon yaptı — hiçbir buton
tetiklenmedi, hiçbir işlem yapılmadı, `orion` riski görüp GUI tıklamayı
kendiliğinden durdurdu. Bir sonraki ekran-yürüme turunda: ya Accessibility
izni verilsin ya da test öncesi cüzdan bağlı diğer tarayıcı sekmeleri kapatılsın.

**`vera` 10.08.2026 denemesi (DOĞRULANAMADI):**
- Güvenlik: `ps`/`lsof` ile Chrome/tarayıcı süreçleri kontrol edildi; canlı
  cüzdan bağlı bir sekme ekranda **görünür/frontmost değildi** (screencapture
  ile pasif tam ekran görüntüsü — hiçbir Chrome/OpenSea penceresi yoktu).
  Bu turda hiçbir para hareket ettiren düğmeye ("Buy/List/Approve/Confirm/Send")
  tıklanmadı, tıklanan tek şey nav bar'daki metin sekmeleriydi (Monitor).
- Yol 1 — `curl http://localhost:3000/monitor/collection`: sadece boş bir
  redirect gövdesi (`/monitor/collection/`) döndü. Sebep: sayfa tamamen
  client-render — WETH rakamı Tauri IPC (`invoke`) üzerinden Rust backend'den
  gelip webview içinde hydrate ediliyor; düz `curl` bu veriyi göremez. Bu yol
  yapısal olarak WETH doğrulaması için kullanılamaz.
- Yol 2 — GUI tıklama (`cliclick`, `osascript`): `osascript`'in System Events
  erişimi yok (`-25211 execution error: not allowed assistive access`).
  `cliclick` exit 0 döndürdü ama nav sekmesine (Monitor) art arda 3 tıklama
  ekranı Dashboard'da bıraktı — hiç geçiş olmadı. Sonuç: bu ortamda sentetik
  tıklamalar hedef pencereye ulaşmıyor (Accessibility izni yok), bu yüzden
  hem güvenli hem etkisiz — riskli bir yanlış tıklama da olmadı ama ekran da
  açılamadı.
- Ekstra gözlem: uygulama penceresi otomasyon sırasında bir kez kendiliğinden
  yeniden başladı (PID değişti, `cargo`/`tauri dev` dosya izleyicisi kaynaklı
  görünüyor, tıklamayla ilişkisi kanıtlanamadı) — veri kaybı yok, Dashboard
  rakamları canlı güncellenmeye devam etti (`$13.41` → `$13.42`).

**Kalan iş (kapanmadı):** monitor/collection ekranını fiilen açıp WETH
rakamını gözle doğrulamak. Bunu kapatacak kesin adım: bu makineye
**Accessibility izni** verilmesi (System Settings → Privacy & Security →
Accessibility → Terminal/ilgili process'e izin), ondan sonra nav
tıklamalarının gerçekten iletildiği doğrulanır. İzin verilene kadar bu madde
kod-düzeyinde doğrulandı, ekranda doğrulanamadı olarak kalır.

---

## T2 — Merge borcu: taşınmayan iş  ✅ KAPANDI (10.08.2026, kod düzeyinde doğrulandı)
Bu maddenin iddiası artık geçersiz. `git diff HEAD origin/main -- WalletDetailClient.tsx
monitor/collection/page.tsx` **boş** — iki dosya da main ile birebir aynı.
- `NftAcceptOfferModal`: tanım `WalletDetailClient.tsx:1442`, kullanım `:2455` — mevcut.
- WETH BigInt hassasiyet düzeltmesi: `monitor/collection/page.tsx:595` — mevcut.

Ekranda fiilen açılıp gözlenmedi (bkz. T1'deki ortam kısıtı notu) — kod kanıtı var,
görsel kanıt henüz yok. Kritik değil, T1'in kalan işiyle birlikte kapanacak.

---

## T3 — `main` dalı geride
`cowork-merge` main'in her şeyini içeriyor artı fazlası. Repoya bakan eski kodu
görüyor.

**Ajan yok** — ana oturum: `git checkout main && git merge cowork-merge --ff-only && git push origin main`
**Bitti sayılır:** GitHub'da main açılınca güncel kod görünüyor.

---

## T4 — Kural bazlı zamanlama (spec hazır, kod yok)
Kural formuna üç kontrol: otomatik çalışma switch'i, kontrol aralığı dropdown'ı
(15sn/1dk/5dk/15dk/1sa/6sa/günlük, varsayılan 5dk), geçerlilik süresi dropdown'ı
(1/6/12/24/48 saat, 1 hafta, 1 ay).

TTL üst sınırı 168 → 720 saat çıkacak **ama koşullu**: kural listesinde kalan süre
görünecek ve süre dolmadan uyarı gösterilecek. Bildirimsiz sınır kaldırılmayacak.

Teknik: scheduler tik'i 15sn kalır; her kurala `check_interval_secs` ve
`last_checked_at` eklenir, döngü yalnızca süresi dolmuş kuralları kontrol eder.
Kural başına thread açılmaz.

**Ajanlar:** `orion` (uyarı ne zaman/nasıl — açık soru) → `scout` (dokunulacak
yerler) → `vault` (struct + döngü + TTL cap + migrasyon) ve `forge` (form + liste +
kalan süre göstergesi) → `vera` → `orion` (yürü)
**Bitti sayılır:** iki farklı aralıklı kural aynı anda doğru sıklıkta çalışıyor,
restart sonrası sıra bozulmuyor, süresi dolan kural uyarı veriyor.

---

## T5 — Scheduler açık başlıyor
Doküman "kapalı başlıyor" diyordu, gerçekte açık ve 30 cycle çalışmış. Aktif kural
0 olduğu için şu an zararsız. **T4 tamamlanırsa kendiliğinden çözülür** (global
switch acil fren olur, varsayılanı kural belirler). T4'ten önce ele alma.

---

## T6 — Dört küçük kusur
a. **Sessiz gönder düğmesi** — `WalletDetailClient.runSends`, `canSend` sağlanmazsa
   geri bildirimsiz `return` ediyor. Hangi koşulun eksik olduğu ekranda yazmalı. → `forge`
b. **Kendine gönderim tutarsız** — ✅ `orion` karar verdi (10.08.2026, bkz.
   `DECISIONS-PENDING.md` D2). Filtre adres bazlı olsun (id değil) + step-2'de
   adres eşleşirse uyarı satırı + modalda "kaynak hedef listesinde görünmez" notu.
   Üç `DistributeModal` kopyasının hepsine uygulanır. → `forge`
c. **Zarf ön-düşümü** — ✅ `vault` KAPANDI (10.08.2026). `check_and_authorize`
   hâlâ imzalamadan önce çalışıyor (yetkisiz bir işlem hiç imzalanmasın diye),
   ama artık `LocalSigner::sign_and_send` (imzalama/nonce/RPC/yayın) başarısız
   olan her yolda `EnvelopeEngine::rollback_authorization` ile düşülen harcama
   geri alınıyor. `evaluate()` dokunulmadı — `preview_transaction` ve
   `check_and_authorize` hâlâ aynı saf fonksiyonu besliyor. Doğrulandı:
   `cargo check` temiz, `cargo test` 88/88 (2 yeni test: rollback harcamayı
   geri alıyor, rollback sıfırın altına inmiyor). Gerçek bir başarısız
   broadcast senaryosu canlı uygulamada denenmedi — bu senaryo yalnızca birim
   testiyle doğrulandı, ekranda değil. Commit: `f77bb3f`.
d. **main'den gelen tip hataları** — `src/app/sentiment/*` örtük `any`,
   `formatters.test.ts` için `@types/jest` eksik. → `forge`

---

## T7 — MCP kaydı ve telefondan deneme  ⚠️ KISMEN BİTTİ (10.08.2026, `vault`)
`standalone.mjs` doğrulandı: bağımsız süreç olarak başlatılıp stdio üzerinden
gerçek JSON-RPC (`initialize` → `tools/list` → `tools/call westron_status`)
gönderildi; **gerçek çalışan Westron kontrol sunucusuna** (127.0.0.1:7777)
ulaştı ve gerçek `/status` cevabını döndürdü (15 tool listelendi, cevapta
`app_version`, `scheduler`, `keychain` alanları doluydu). Bu salt-okunur bir
çağrıydı (`GET /status`) — `DECISIONS-PENDING.md`'deki "mainnet'e okuma
serbest" kuralına giriyor, para/anahtar/imza tetiklemedi.

`~/Library/Application Support/Claude/claude_desktop_config.json` bulundu
(boş değildi — Cowork masaüstü uygulamasının kendi `preferences` ayarlarını
tutuyordu) ve **sadece ekleme** yapıldı: `mcpServers.westron` anahtarı
eklendi (`command: node`, `args: [".../tools/westron-mcp/standalone.mjs"]`),
mevcut hiçbir alan silinmedi/değiştirilmedi (diff ile doğrulandı,
`preferences` birebir aynı kaldı). Orijinalin yedeği oturumun scratchpad
dizininde duruyor.

**index.js değil standalone.mjs kaydedildi** — görev talimatı böyleydi;
ama `FAZ1-DEMO.md` ve `README.md` hâlâ `index.js`'i (npm bağımlılığı
`@modelcontextprotocol/sdk` gerektiren sürüm) örnek veriyor. İki dosya da
çalışıyor (`npm install` bu ortamda sorunsuz kuruldu, `node --check` ikisi
için de temiz) — hangisinin kalıcı standart olacağı ürün/altyapı kararı,
burada seçilmedi, sadece görevde istenen kaydedildi.

**DOĞRULANAMADI (kapsam dışı bırakıldı):** Claude Desktop'un Tools menüsünde
`westron_*` araçlarının gerçekten göründüğü — bunun için uygulamanın
tamamen kapatılıp (⌘Q) yeniden açılması gerekiyor, bu oturumdan
tetiklenmedi (kullanıcının aktif masaüstü oturumunu kesintiye uğratabilir).
**Kalan iş:** `vera` uygulamayı yeniden başlatıp Tools menüsünü gözle
doğrulasın.

---

## NOT (10.08.2026, gece) — forge T9'a başlamadı, context'i yetmedi
`forge` T6a/T6d/T9/T10'u tek seferde almaya çalıştı, keşif sırasında context kritik
seviyeye geldi ve GÜVENLİ ŞEKİLDE hiçbir dosyayı değiştirmeden durdu — repo temiz/
çalışır durumda. İki bulgu bir sonraki oturuma devrediliyor:
1. Orion'un D2'deki "3 `DistributeModal` kopyası" iddiası doğrulanmadı — forge sadece
   ikisini buldu (`src/app/page.tsx:547`, `src/app/wallets/page.tsx:374`),
   `bulk/distribute/page.tsx`'te bu isimde bir fonksiyon yok. Ortak bileşene çıkarmadan
   önce gerçek kopya sayısı netleştirilmeli.
2. Repoda çok sayıda takip dışı " 2" son ekli dosya bulundu (`FAZ1-DEMO 2.md`,
   `src/lib/distribute 2.ts`, `src-tauri/src/persist 2.rs` vb.) — CLAUDE.md'nin
   yasakladığı "package 2.json" deseni. `scout` bunları inceliyor, sonucu ayrı not
   düşülecek.

**Öneri:** T6a, T6d, T10 küçük ve bağımsız — ayrı ayrı taze context'li ajanlara
verilsin. T9 (paylaşılan bileşen + CTA + NFT sekmesi) en büyük iş, tek başına bir
oturum/agent hak ediyor, kopya-sayısı netleştikten sonra başlanmalı.

---

## T9 — Wallet detail: Distribute CTA + NFT transferi  🆕 10.08.2026, Emir'den ekran görüntüsüyle geldi, ÖNCELİKLİ
Dashboard'da olan "Distribute" (fund transfer) CTA'sı tekil cüzdan detay sayfasında
(`/wallet/[id]`) yok. Emir'in isteği (ekran görüntüsü — kırmızı kutu, Etherscan
düğmesinin solunda boş alan):
1. Wallet detail sayfasına da bir Distribute CTA eklenmeli — dashboard'daki
   fund-transfer akışının aynısı (aynı `DistributeFundsModal`, muhtemelen tek
   fark: kaynak cüzdan burada zaten sabit).
2. Aynı CTA'dan (veya ayrı bir CTA'dan — orion karar verir) **NFT transferi**
   yapılabilmeli: bir NFT'yi doğrudan başka bir adrese göndermek. Bu yeni bir
   yetenek — mevcut Bulk Actions (list/cancel/bid) marketplace işlemi, bu ise
   doğrudan cüzdandan cüzdana transfer (satış değil).

**Para/işlem sınırı:** NFT transferi de zarftan (envelope) geçmeli — ETH
transferiyle aynı güvenlik modeli (spend cap kapsamına NFT transferi giriyorsa
`evaluate()` genişletilmeli; girmiyorsa neden girmediği açıkça gerekçelendirilmeli).
Gerçek bir NFT'yi gerçek bir adrese **test sırasında fiilen göndermek yasak** —
sadece preview/dry-run ile doğrulanır, gerçek gönderim Emir'in onayını bekler.

**Ajanlar:** ✅ `orion` karar verdi (10.08.2026, bkz. `DECISIONS-PENDING.md` D2):
tek "Distribute" CTA'sı, header'da Etherscan'ın solunda; modal iki sekmeli
(Send Funds / Send NFT); önce üç `DistributeModal` kopyası tek ortak bileşene
çıkarılacak (dördüncü kopya açılmayacak); NFT transferi mevcut `evaluate()`'i
`value_wei=0` ile çağırıp scope/kill-switch/expiry'yi bedelsiz devralacak, yeni
cap/allowlist eklenmeyecek; Confirm adımı zorunlu (Select→Confirm→Process).
→ `vault` (NFT transferi için Tauri komutu, zarf çağrısı) → `forge` (ortak bileşene
çıkarma + UI) → `vera`
**Bitti sayılır:** CTA wallet detail'de görünüyor, fund transfer akışı çalışıyor,
NFT transfer akışı en azından preview/dry-run seviyesinde doğrulanmış, zarf
kapsıyor, `tsc` + `cargo check` temiz. Gerçek NFT gönderimi Emir onayı olmadan
"bitti" sayılmaz — T8'e benzer şekilde onay bekleyen adım varsa açıkça yazılır.

**`vault` backend kısmı — ⚠️ KISMEN BİTTİ (10.08.2026).** Yeni Tauri komutu
`transfer_nft` (`src-tauri/src/signing/mod.rs`) + calldata encoder
`src-tauri/src/nft/mod.rs`: kontrat adresi + token id + hedef adres + standart
(ERC-721/1155) alır, `safeTransferFrom` calldata'sını elle ABI-encode eder
(selector çalışma zamanında `keccak256(imza)`'dan hesaplanıyor, hardcode
değil), `check_and_authorize`'ı `value_wei=0` ve `to=alıcı` (kontrat değil)
ile çağırır — D2 kararındaki gibi. Başarısız her adımda (adres parse,
imzalama, RPC, yayın) T6c'deki aynı `rollback_authorization` deseniyle
harcama geri alınır. `estimate_gas_inner` artık opsiyonel `from` alıyor —
`transferFrom` gibi bir kontrat çağrısı `from` olmadan `eth_estimateGas`'ta
revert eder; mevcut çağıranlar (`send_eth`, `estimate_gas` komutu)
bozulmadı.

Doğrulanan: `cargo check` temiz, `cargo test` 93/93 (5 yeni `nft::` testi —
her iki selector yayınlanmış 4-byte değerlerle eşleşiyor, ERC-721/1155
calldata'nın tam word düzeni, boş `bytes` kuyruğu, standart bazlı dispatch).
**Doğrulanmadı (bilerek):** `check_and_authorize`/imzalama/yayın gerçek bir
cüzdana veya kontrata karşı hiç çalıştırılmadı — görev talimatı gereği
yasaktı, sadece derleme + tip + birim testi seviyesinde kanıt var. Frontend
tarafı (`forge`) henüz bu komutu çağırmıyor. Commit: `5582cf2`.

---

## T10 — Etherscan link'leri eksik  🆕 10.08.2026, Emir'den ekran görüntüsüyle geldi
İki yer (ekran görüntüleriyle işaretlendi):
a. Wallet detail sayfasındaki "Etherscan" düğmesi — tıklanınca işletim sisteminin
   varsayılan tarayıcısında o cüzdanın Etherscan adres sayfasını açmalı
   (`https://etherscan.io/address/{adres}`). Şu an muhtemelen hiçbir şey yapmıyor
   veya bağlı değil — doğrulanacak.
b. Distribute Funds modalının son adımında ("Process", işlem tamamlandığında)
   gösterilen tx hash'in yanına **"TXN:"** etiketi eklenmeli ve hash'e
   tıklanınca o işlemin Etherscan sayfası (`https://etherscan.io/tx/{hash}`)
   varsayılan tarayıcıda açılmalı.

Teknik: Tauri'de dış link açmak için `@tauri-apps/plugin-shell`'in `open()`'ı
(veya proje zaten başka bir yerde kullanıyorsa aynı pattern) kullanılır —
`window.open` çalışmaz/güvenli değildir masaüstü uygulamasında.

**Ajan:** ✅ `orion` teyit etti (10.08.2026, bkz. `DECISIONS-PENDING.md` D2) —
ürün kararı gerekmiyor, network belirsizliği yok (mainnet'e kilitli). Tek incelik:
mevcut `<a target="_blank">` (WalletDetailClient.tsx:1823) paketlenmiş uygulamada
gerçekten OS tarayıcısını açıyor mu, önce ölçülsün; açmıyorsa `plugin-shell`'e
geçilsin. → `forge` (mekanik UI değişikliği) → `vera`
**Bitti sayılır:** her iki link de gerçek Etherscan sayfasını varsayılan
tarayıcıda açıyor (localhost'a değil), doğru adres/hash'e gidiyor.

---

## T8 — Emir kararı/hesabı gerekiyor (ajan yapamaz)
Apple Developer imzalama + notarization · Faz 2 Seaport gerçek alım · bağımsız
güvenlik denetimi.

---

## Not
`cargo test` + `tsc` temiz olması bir görevi bitmiş yapmaz. Paraya, anahtara veya
ekrana dokunan hiçbir iş, çalışan uygulamada denenmeden kapatılmaz — 09.08.2026'da
86/86 test geçerken iki kritik hata canlıydı.

---

# Emir yokken — karar sınırları

Emir bu döngüde yok. Yerini **kısmen** Orion alır: ürün yargısı Orion'undur —
bir ekranın ne demesi gerektiği, hangi bulgunun daha pahalı olduğu, bir akışın
kullanıcıyı yanıltıp yanıltmadığı. Ölçüt bellidir: kullanıcının maliyeti.

Orion'un **veremeyeceği** kararlar aşağıdadır. Bunlarla karşılaşan ajan tahmin
etmez, ilerlemez, `docs/DECISIONS-PENDING.md` dosyasına yazar ve işin geri kalanına
devam eder.

## Emir'e saklanacak kararlar

- **Fon transferi.** Zinciri değiştiren hiçbir işlem Emir olmadan yapılmaz.
  Sınır imzalamadır, yayınlamak değil: imzalanmış bir işlem başkası tarafından da
  yayınlanabilir, o yüzden "imzaladım ama göndermedim" de yasak sayılır.
  Kapsam: ETH/token transferi, NFT alım-satımı, teklif verme veya kabul etme,
  onay (approve) verme, sözleşme çağrısı, sniping kuralının gerçek tetiklenmesi.

  **Mainnet'e okuma serbesttir ve Emir'i beklemez.** Alchemy/Etherscan sorguları,
  bakiye, token, NFT, fiyat ve transfer geçmişi çekme, `eth_estimateGas`,
  `preview_transaction`, kontrol sunucusundan `GET /status`, doğrulama ve API
  davranışı testleri — hepsi zinciri değiştirmez, hepsi serbest.

  Şüphedeysen tek soru: bu çağrı bir işlem imzalıyor mu? Hayırsa yap, evetse yazma
  ve `DECISIONS-PENDING.md`'ye not düş.
- **Bir güvenlik kuralının gevşetilmesi.** `CLAUDE.md` içindeki değiştirilemez
  kurallar ajan kararıyla esnetilmez. Kural yanlışsa gerekçesi yazılır, uygulanmaz.
- **Geri alınamaz işlemler.** Dal silme, force push, geçmiş yeniden yazma, kullanıcı
  verisi silme, dışarıya yayın.
- **Risk iştahı soruları.** "Sınır ne kadar olmalı", "varsayılan açık mı kapalı mı",
  "bu özellik eksik çıkabilir mi" — bunlar ürün değil sahip kararıdır.
- **Kapsam genişletme.** Görev kuyruğunda olmayan bir işe başlamak. Fark edilen
  yeni iş kuyruğa yazılır, o oturumda yapılmaz.
- **Para veya abonelik modeline dokunan her şey.**
- **Üçüncü taraf hesabı gerektiren her şey** (Apple imzalama, yeni API sağlayıcı).

## Sen yokken de geçerli olan kapı

Vera'nın kararı bağlayıcıdır. DOĞRULANAMADI raporlanmış bir iş "bitti" sayılmaz ve
üstüne yeni iş yığılmaz. Ajan kendi işini kendisi doğrulanmış ilan edemez.

## Oturum sonunda

Yapılanların listesi, açık kalanlar ve `DECISIONS-PENDING.md`'ye eklenen her karar,
Emir döndüğünde tek ekranda görülecek şekilde özetlenir.
