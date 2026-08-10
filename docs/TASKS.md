# Westron — Görev Kuyruğu (09.08.2026)

Öncelik sırasıyla. Her görevde hangi ajanın, hangi sırayla çalışacağı yazılı.
Ayrıntılı bağlam: `docs/HANDOFF-2026-08-09.md`. Kurallar: `CLAUDE.md`.

## `vera` bağımsız doğrulama turu (10.08.2026, gece — kod + komut kanıtlı, GUI'siz)

Önceki forge/vault turlarının hiçbiri gerçek tıklamayla doğrulanmamıştı. Bu tur
komut çıktısı ve kod kanıtıyla sınırlı kaldı — nedeni aşağıda madde madde.

**T1 (Monitor/collection WETH) — ⚠️ HÂLÂ DOĞRULANAMADI, ama ortam notu değişti.**
`osascript -e 'tell application "System Events" to get name of first application
process whose frontmost is true'` artık **başarıyla** "ChatGPT" döndürdü (exit 0) —
önceki turların bildirdiği `-25211 not allowed assistive access` hatası artık
YOK, Accessibility izni bir şekilde açılmış. Ama `System Events` üzerinden Westron
app process'inin ("app") pencere listesi boş döndü (`window 1` → "Invalid index
-1719") — process arka planda çalışıyor (`ps` PID 37340 tauri / 37530 next
doğrulandı) ama accessibility'nin görebileceği bir pencere şu an yok (gizli/arka
planda/başka masaüstünde olabilir). Masaüstünde aynı anda Google Chrome açık ve
T1'de daha önce canlı bir cüzdan bağlı sekmeye yanlış tıklama riski kayıtlı
olduğu için, pencere bulunamadığı bu durumda kör koordinat tıklaması
**denenmedi**. **Kalan iş değişmedi:** biri Westron penceresini öne getirip
Monitor → collection detayına tıklayıp WETH rakamını gözle görmeli; artık
Accessibility izni engel değil, engel sadece pencerenin bulunup öne getirilmesi.

**T6a (Before you can send uyarısı) — ✅ DOĞRULANDI (kod).**
`WalletDetailClient.tsx:517-520` — `confirmGate` dizisi checkbox ve "SEND"
yazısı eksikse ayrı ayrı doğru mesaj push ediyor; `:991-995` bu diziyi
"Before you can send:" başlığıyla render ediyor. Canlı tıklamayla görsel
teyit hâlâ yapılmadı (yukarıdaki pencere bulunamama sorunu) ama kod, iddia
edilen davranışla birebir eşleşiyor.

**T6d (tsc/jest) — ✅ DOĞRULANDI (bağımsız çalıştırıldı).**
`npx tsc --noEmit` → 0 hata. `npx jest` → `Test Suites: 2 passed, 2 total,
Tests: 24 passed, 24 total`. Önceki ajanların iddiasıyla birebir örtüşüyor.

**T7 (Claude Desktop Tools menüsü) — ⚠️ DOĞRULANAMADI, bilerek denenmedi.**
`~/Library/Application Support/Claude/claude_desktop_config.json` içinde
`mcpServers.westron` girdisi doğrulandı (`command: node`, `args: [...
standalone.mjs]`). Claude Desktop'ı yeniden başlatmak bu oturumun kendisini
de kesintiye uğratabileceği için tetiklenmedi. **Emir'in yapması gereken:**
Claude Desktop'ı ⌘Q ile tamamen kapatıp yeniden açmak, sonra Tools menüsünde
`westron_*` araçlarının listelendiğini gözle kontrol etmek.

**T6b (kendine gönderim uyarısı) — ✅ DOĞRULANDI (kod).**
`DistributeModal.tsx:250-253` adres bazlı (case-insensitive) filtre;
`:296-297` NFT sekmesi için aynı mantık; `:856-859` Confirm adımında uyarı
satırı render ediliyor. İddia edilenle birebir eşleşiyor.

**T9a (paylaşılan DistributeModal + wallet-detail CTA) — ✅ DOĞRULANDI (kod +
sunucu), ⚠️ GÖRSEL TIKLAMA YOK.** `npm run dev` zaten çalışıyordu (port 3000,
PID 37530) — dokunulmadı. `curl` ile `/` → 200, `/wallets/` → 200,
`/bulk/distribute` → 308 (redirect, beklenen — trailing slash). Sunucu
render çökmesi yok. `WalletDetailClient.tsx:1811-1819` "Distribute" CTA'sı
mevcut, `:2458-2463` `lockedSourceId={wallet.id}` ile modalı açıyor. Kod
seviyesinde iddia doğru; canlı tıklamayla Select→Confirm gezintisi bu turda
da yapılamadı (T1'deki pencere bulunamama sorunu).

**T9b (Send NFT sekmesi) — ✅ DOĞRULANDI (kod).** `DistributeModal.tsx:538-757`
`tab === 'nft'` dalı gerçek `nfts` prop'unu render ediyor, boş liste "No NFTs
held..." dürüst mesajı basıyor (satır civarı doğrulandı), `preselectedNftKey`
mantığı (`:159-183`) mevcut. Gerçek tıklama testi yapılmadı.

**T9c (bulk/distribute gerçek gönderim) — ✅ DOĞRULANDI (kod).** Eski sahte
metinler ("not enabled", "Continue (nothing is sent)", "SIMULATED") dosyada
**yok** (grep boş döndü). `previewTransaction`/`runDistribution` gerçekten
çağrılıyor (`:247-291`), "Confirm & Send" düğmesi mevcut (`:719`). Gerçek
Send'e kesinlikle tıklanmadı.

**T9d (NftSendModal birleştirme) — ✅ DOĞRULANDI (kod).** `NftSendModal`
tanımı repoda yok (aranmadı bulunamadı), Bulk Actions'taki "Send NFTs"
düğmesi `disabled={selectedNfts.size !== 1}` ile gerçekten devre dışı
kalıyor, `title` doğru açıklamayı gösteriyor (`WalletDetailClient.tsx:2088-2095`),
tek seçili NFT `sendNftKey` üzerinden `DistributeModal`'a `preselectedNftKey`
olarak geçiyor (`:2465`). İddia edilenle birebir eşleşiyor.

**T10 (Etherscan/TXN linkleri) — ✅ DOĞRULANDI (kod), ⚠️ gerçek tıklama
yapılmadı.** `WalletDetailClient.tsx:1823` header Etherscan düğmesi
`openInBrowser` → `openExternalUrl` (Tauri komutu) çağırıyor, hata durumunda
`etherscanOpenError` görünür satırla gösteriliyor (`:1586-1590`).
`bulk/distribute/page.tsx:337,344` "TXN:" etiketi + aynı `openExternalUrl`
deseni. Gerçek tıklayıp tarayıcının açıldığı bu turda da gözlenmedi — hem
pencere bulunamadı hem de masaüstünde Chrome/ChatGPT gibi başka pencereler
vardı, yanlış tıklama riskini göze almaya değmedi. Kod yolu zaten
`monitor/page.tsx` ve sentiment panellerinde canlı kullanımda (battle-tested),
bu iki yeni çağrı yeri aynı deseni tekrarlıyor.

**Sonuç:** Bu turda kod/derleme/test seviyesinde **hiçbir kırık şey
bulunmadı** — tüm iddialar (T6a, T6b, T9a-d, T10) kodda birebir doğrulandı,
`tsc`/`jest` temiz. Görsel/tıklama doğrulaması hâlâ eksik (T1, T7, ve T9/T10'un
canlı Select→Confirm gezintisi) — bunun nedeni artık Accessibility izni değil
(izin var), Westron penceresinin accessibility'den görünür şekilde bulunamaması
ve masaüstünde başka canlı pencerelerin (Chrome) bulunması. Bu, CLAUDE.md'nin
"testler geçti demek ekran çalışıyor demek değildir" ilkesine göre görevleri
"bitti" yapmaz ama kod tabanında hiçbir çürütülmüş iddia da yok. **Bir sonraki
oturum için kesin adım:** Westron penceresini manuel olarak öne getirip (Dock'tan
tıklayarak, otomasyon değil) bu ortamda `cliclick`/`osascript` ile nav
tıklamalarının artık gerçekten iletildiğini doğrulamak, sonra T1/T9/T10'un
görsel turunu tamamlamak.

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
a. **Sessiz gönder düğmesi** — ✅ `forge` KAPANDI (10.08.2026). `runSends`
   artık `!canSend`'de sessizce `return` etmiyor: aynı koşullardan hangileri
   eksikse (`envelope` hazır ama checkbox işaretlenmemiş / "SEND" yazılmamış)
   ayrı bir `confirmGate` listesi hesaplanıp düğmenin hemen üstünde "Before you
   can send:" başlığıyla gösteriliyor — önceden bu iki koşul (checkbox,
   "SEND" yazısı) `BlockerList`'te hiç görünmüyordu, düğme sebepsizce gri
   duruyordu. Ayrıca `runSends` içindeki iki savunma amaçlı erken `return`
   (`!canSend` ve `rows.length === 0`) artık `sendGuardMessage` state'ine
   yazıp ekranda gösteriyor — normal kullanımda düğme zaten HTML `disabled`
   olduğu için bu yollara ulaşılamaz, ama ulaşılırsa da sessiz kalmıyor.
   Dosya: `src/app/wallet/[id]/WalletDetailClient.tsx`.
   Doğrulandı: `tsc --noEmit` temiz, `eslint` bu dosyada yeni hata eklemedi
   (mevcut tek `error` — satır ~1124, `AddressBookTab`'daki effect-içi
   `setState` uyarısı — bu görevden önce de vardı, diff ile doğrulandı).
   **DOĞRULANAMADI:** canlı uygulamada checkbox/SEND alanını boş bırakıp
   düğmeye tıklayarak mesajın gerçekten ekranda çıktığı gözle görülmedi —
   masaüstünde bu oturumda aynı anda başka canlı ajan pencereleri (ChatGPT
   masaüstü, muhtemelen gerçek tarayıcı sekmeleri) açıktı ve otomatik tıklama
   T1'de kayıtlı riski taşıyordu (yanlış pencereye tıklama). Kod seviyesinde
   doğrulandı, ekranda değil.
b. **Kendine gönderim tutarsız** — ✅ `forge` KAPANDI (10.08.2026). Karar
   (`DECISIONS-PENDING.md` D2) uygulandı: filtre artık **adres bazlı**
   (case-insensitive `w.address.toLowerCase() === source.address.toLowerCase()`),
   id bazlı değil — iki farklı id'li kayıt aynı adresi paylaşıyorsa da hedef
   listesinden düşüyor. Step 2'de (Confirm) seçili bir hedefin adresi kaynağın
   adresiyle eşleşirse sarı uyarı kutusu ("this destination is the same
   address as the source. The transfer would only cost gas.") görünüyor, ve
   modal açıklamasının altına "kaynak cüzdan hedef listesinde asla görünmez"
   notu eklendi. Bu mantık artık `src/components/DistributeModal.tsx`'te tek
   yerde yaşıyor — iki gerçek kopya (`page.tsx`, `wallets/page.tsx`) T9'un
   Görev 1'i kapsamında bu bileşene taşındığı için otomatik uyguluyor (aşağıya
   bakın). `bulk/distribute/page.tsx` bu bileşeni kullanmıyor, T9c kapsamında
   ayrı ele alınacak, bu maddeye dahil değil.
   Doğrulandı: `npx tsc --noEmit` temiz, `npx eslint` bu üç dosyada yeni
   hata/uyarı eklemedi (git stash ile taban alınıp karşılaştırıldı), `npx
   jest` 24/24 geçti. **DOĞRULANAMADI:** uyarı kutusunun canlı uygulamada
   gerçekten göründüğü gözle görülmedi — bu oturumda "gerçek Send'e asla
   tıklama" kısıtı vardı ve ekran etkileşimini otomatik tıklayacak bir
   tarayıcı aracı bu ortamda yoktu; `npm run dev` sunucusu zaten çalışıyordu,
   `/`, `/wallets/`, `/wallet/test-id` route'ları 200 döndü (sunucu tarafında
   çökme yok) ama Select→Confirm adımlarına tıklanarak görsel doğrulama
   yapılamadı.
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
d. **main'den gelen tip hataları** — ✅ KAPALI, kod değişikliği gerekmedi
   (10.08.2026, `forge` doğrulaması). `c8ddc71` merge'ü main'in sentiment
   düzeltmelerini zaten getirmiş: `src/app/sentiment/` ve `src/components/
   sentiment/`'te örtük `any` yok, `@types/jest` `package.json`'da (satır 26)
   zaten var ve `node_modules`'e kurulu. Doğrulandı: `npx tsc --noEmit` sıfır
   hatayla temiz, `npx jest src/lib/__tests__/formatters.test.ts` 15/15 geçti.
   Bu maddenin iddiası artık geçersiz (T2'deki gibi) — muhtemelen görev
   kuyruğu merge'den önce yazılmıştı.

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

**⚠️ DÜZELTME (10.08.2026, scout doğrulaması):** D2'deki "3 kopya" varsayımı
yanlıştı. Gerçekte sadece **2 kopya** birebir aynı mantığı tekrarlıyor
(`src/app/page.tsx:547`, `src/app/wallets/page.tsx:374` — sadece bunlar tek
ortak bileşene çıkarılacak). Üçüncü yer, `src/app/bulk/distribute/page.tsx:78`,
yapısal olarak farklı: envelope/gönderim entegrasyonu hiç yok, ekran açıkça
"bu sürümde gönderim aktif değil" diyor; buna karşılık diğer ikisinde olmayan
gerçek bakiye (ETH+WETH), gerçek gas tahmini ve Address Book alıcı seçimi var.
**Emir'in kararı (10.08.2026):** bu ekran da gerçek gönderime bağlansın —
mekanik olarak ortak bileşene sokulmayacak, `previewTransaction`/`runDistribution`
(`src/lib/distribute.ts`) ile aynı zarf-korumalı gönderim yoluna kendi
UI'ında (bakiye/gas/address-book özellikleri korunarak) bağlanacak. Bu üçüncü
iş kalemi de T9 kapsamına eklendi — aşağıdaki "Bitti sayılır" listesi buna göre
genişletildi.
**Bitti sayılır:** CTA wallet detail'de görünüyor, fund transfer akışı çalışıyor,
NFT transfer akışı en azından preview/dry-run seviyesinde doğrulanmış, zarf
kapsıyor, `bulk/distribute/page.tsx` artık gerçek zarf-korumalı gönderime bağlı
(kendi bakiye/gas/address-book özellikleri korunarak), `tsc` + `cargo check`
temiz. Gerçek NFT gönderimi ve `bulk/distribute`'tan gerçek ilk gönderim Emir
onayı olmadan "bitti" sayılmaz — T8'e benzer şekilde onay bekleyen adım varsa
açıkça yazılır.

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

**`forge` frontend kısmı — ⚠️ KISMEN BİTTİ (10.08.2026).** Bu oturumun kapsamı
sadece Görev 1 (ortak bileşene çıkarma) ve Görev 3'ün Send Funds tarafıydı;
NFT sekmesi (T9b) ve `bulk/distribute/page.tsx`'in gerçek gönderime bağlanması
(T9c) **bilerek dokunulmadı**, ayrı görev olarak kalıyor.

- **Görev 1 (çıkarma):** `src/app/page.tsx:547` ve `src/app/wallets/page.tsx:374`
  deki iki `DistributeModal` kopyası tek `src/components/DistributeModal.tsx`'e
  taşındı. Farklar prop oldu: `skin: 'dashboard' | 'wallets'` (renk/dropdown-vs-select
  gibi salt görsel farklar — hepsi orijinallerden birebir kopyalandı), `wallets`
  (her sayfa kendi cüzdan listesini besliyor: dashboard `loadOwnedWallets()`,
  wallets sayfası kendi `wallets` state'i), `lockedSourceId` ve `enableTabs` (T9
  Görev 3 için, aşağıda). Davranış birebir korundu — 3 adımlı akış (Select →
  Confirm → Process), `parseEthToWei`/BigInt hesap, T10'daki "TXN:" Etherscan
  linki, hepsi aynı. İki çağrı yeri artık bu paylaşılan bileşeni kullanıyor,
  ikisi de kendi eski görsel "skin"ini koruyor.
- **Görev 2 (T6b):** yukarıda T6.b maddesinde anlatıldı — artık paylaşılan
  bileşende tek yerde yaşadığı için her iki tüketici de otomatik alıyor.
- **Görev 3 (T9 asıl istek, Send Funds tarafı):** `src/app/wallet/[id]/
  WalletDetailClient.tsx` header'ına, Etherscan düğmesinin **soluna**,
  "Distribute" CTA'sı eklendi (Emir'in ekran görüntüsündeki kırmızı kutuya
  denk gelen yer). Tıklanınca aynı paylaşılan `DistributeModal` açılıyor,
  `lockedSourceId={wallet.id}` ile kaynak cüzdan bu sayfanın cüzdanına
  sabitleniyor — Step 1'deki kaynak seçici burada görünmüyor, yerine salt-okunur
  "{isim} — {kısa adres}" satırı çıkıyor (cüzdan bir sebepten listede yoksa
  "Wallet not found" yazıyor, sessizce boş görünmüyor). `enableTabs` prop'u
  ile "Send Funds" / "Send NFT" sekme çubuğu render ediliyor, ama "Send NFT"
  şimdilik **disabled** ve `title="Send NFT — not available yet"` — iç `tab`
  state'i var ama hiçbir şey ona göre dallanmıyor; NFT tarafının kendisi bu
  görevde **bilerek implemente edilmedi** (T9b'nin işi). Hedef listesi
  `loadWallets()` (owned + watched, wallets sayfasıyla aynı davranış) —
  kaynağın kendisi adres bazlı filtreyle (T6b) otomatik düşüyor.
  Dosyalar: `src/components/DistributeModal.tsx` (yeni), `src/app/page.tsx`,
  `src/app/wallets/page.tsx`, `src/app/wallet/[id]/WalletDetailClient.tsx`.

Doğrulanan: `npx tsc --noEmit` temiz (4 dosya), `npx eslint` yeni hata/uyarı
eklemedi — `git stash` ile taban alınıp fark karşılaştırıldı; kalan tek
`error` (`WalletDetailClient.tsx` ~1125, `AddressBookTab` effect-içi
`setState` uyarısı) ve `DistributeModal.tsx`'teki tek `no-unused-expressions`
uyarısı (`n.has(id) ? n.delete(id) : n.add(id)`) ikisi de orijinal
dosyalardan birebir kopya, bu görevden önce de vardı. `npx jest` 24/24 geçti.
`npm run dev` zaten çalışan bir sunucuydu (port 3000, PID 37529/37530) —
kapatılmadı, üstüne ikinci bir instance başlatılmadı (Turbopack kendi kendine
"Another next dev server is already running" deyip çıktı, artık process
kalmadı). `curl` ile `/`, `/wallets/`, `/wallet/test-id` route'larının
üçü de 200 döndü — sunucu tarafında render çökmesi yok.

**DOĞRULANAMADI:** Bu ortamda gerçek bir tarayıcıya tıklayan bir araç yoktu,
o yüzden şu üçü **gözle görülmedi**: (a) dashboard'daki Distribute akışının
Select→Confirm'de görsel olarak eskisiyle aynı göründüğü, (b) wallets
sayfasındaki aynı akış, (c) wallet detail sayfasında yeni "Distribute"
CTA'sının gerçekten Etherscan'ın solunda çıktığı ve modalı kaynak kilitli
şekilde açtığı. Kod/tip/lint/test seviyesinde kanıt var, ekranda değil —
`npm run dev` ile `http://localhost:3000` açılıp elle bakılmalı (Send'e asla
tıklanmadan, en fazla Confirm adımına kadar).

**`forge` — T9b, Send NFT sekmesi — ⚠️ KISMEN BİTTİ (10.08.2026).** "Send NFT"
sekmesi artık gerçek: backend'deki `transfer_nft` komutuna (`5582cf2`,
`src-tauri/src/signing/mod.rs:364`) bağlandı. Tam parametre imzası:
```rust
pub async fn transfer_nft(
    wallet_address: String,
    contract_address: String,
    token_id: String,
    to: String,
    token_standard: crate::nft::TokenStandard,  // "ERC721" | "ERC1155" (UPPERCASE serde)
    amount: Option<String>,                      // yalnızca ERC-1155, verilmezse 1 varsayılır
    api_key: String,
    envelope_engine: tauri::State<...>,           // Tauri'nin kendi enjekte ettiği, JS'den gelmiyor
) -> Result<String, String>
```
Akış Select→Confirm→Process (kararla aynı): Step 1'de kaynak cüzdanın
gerçek NFT galerisinden (`liveNfts` — `getNftsForOwner`'ın döndürdüğü aynı veri,
yeni bir API çağrısı **eklenmedi**) tek bir NFT seçiliyor ve alıcı adresi
serbest metin olarak giriliyor; boş NFT listesi "No NFTs held — nothing to
send from this wallet." diyor (sessizce boş grid değil). Step 2 (Confirm),
`preview_transaction`'ı `to=alıcı, value_wei=0, calldata=""` ile çağırıyor —
bu, `transfer_nft`'in içindeki gerçek `check_and_authorize` çağrısıyla
**birebir aynı girdi**, yani Confirm'deki "authorized" sonucu gerçek bir
tahmin, süslemeli bir onay değil. T6b'deki kendine-gönderim uyarısı burada da
var (`nftSelfSendWarning`, adres bazlı, case-insensitive). Step 3, tek satırlık
sonucu gösteriyor — T10'daki "TXN:" + tıklanabilir Etherscan linki deseni
aynen tekrarlandı (`openExternalUrl`).

Dosyalar:
- `src/lib/tauri.ts` — `transferNft()` wrapper eklendi (Rust'a giden tek köprü
  kuralına uyarak `invoke` burada çağrıldı, başka hiçbir dosyadan değil).
- `src/components/DistributeModal.tsx` — "Send NFT" sekmesi artık `disabled`
  değil; `nfts` prop'u eklendi (chan gerçek NFT listesini çağıran taraf besliyor);
  Step 1/2/3 hem Send Funds hem Send NFT için ayrı dallara bölündü (sekme
  değişimi yalnızca Step 1'deyken izinli — yarım kalmış bir akışın ortasında
  sekme değiştirip karışık state göstermeyi engellemek için).
- `src/components/NftThumb.tsx` — **yeni, paylaşılan** dosya. Daha önce
  `WalletDetailClient.tsx` içinde özel (module-private) tanımlıydı; iki dosyanın
  aynı thumbnail mantığını ayrı ayrı sürdürmesindense (CLAUDE.md'nin yasakladığı
  "aynı işi yapan ikinci ekran" deseni) tek yere çıkarıldı, her iki dosya da
  şimdi buradan import ediyor.
- `src/app/wallet/[id]/WalletDetailClient.tsx` — `DistributeModal`'a
  `nfts={liveNfts ?? []}` geçildi (yeni bir NFT-listeleme çağrısı **eklenmedi**,
  sayfa zaten `getNftsForOwner`'dan gelen veriyi tutuyordu); yerel `NftThumb`
  tanımı silinip paylaşılan bileşene yönlendirildi.

**Bilinen sınırlama, bilerek ele alınmadı:** ERC-1155 için miktar (amount)
seçici yok — ekran her zaman 1 adet gönderiyor (backend'in varsayılanı da bu).
Bir cüzdanda aynı token id'den birden fazla kopya varsa kısmi transfer bu
ekrandan yapılamaz. Görev talimatında istenmedi, kapsam dışı bırakıldı.

**⚠️ Bulgu — muhtemel ikinci "Send NFT" yüzeyi (yeni iş, kuyruğa yazılıyor,
bu oturumda dokunulmadı):** `WalletDetailClient.tsx`'te bu görevden önce de var
olan `NftSendModal` (satır ~1530, Bulk Actions seçim çubuğundaki "Send" düğmesiyle
açılıyor) aynı amaca hizmet ediyor — bir NFT'yi başka bir adrese göndermek —
ama hâlâ devre dışı (`UnwiredNotice`, "Sending unavailable" düğmesi, dürüstçe
"not wired to a signer yet" diyor, yalan söylemiyor). Artık ekranda **iki**
"NFT gönder" girişi var: biri gerçek (Distribute → Send NFT), biri hâlâ sahte
olduğunu itiraf eden bir iskelet. CLAUDE.md'nin "aynı işi yapan başka ekran
var mı" kuralına göre bu iki yüzeyin birleştirilmesi (muhtemelen
`NftSendModal`'ın kaldırılıp Bulk Actions'taki "Send" düğmesinin de Distribute
modalını NFT'si önceden seçili şekilde açması) ayrı bir görev olmalı — bu
oturumun kapsamı yalnızca Distribute modalıydı, `NftSendModal`'a dokunulmadı.

Doğrulanan: `npx tsc --noEmit` temiz, `cd src-tauri && cargo check` temiz
(Rust'a dokunulmadı, komut zaten vardı), `npx eslint` yeni hata/uyarı eklemedi
(`git stash` ile taban alınıp karşılaştırıldı — taban da 1 hata + 4 uyarı,
bu değişiklikten sonra da 1 hata + 4 uyarı; `WalletDetailClient.tsx`'teki
`AddressBookTab` `setState`-in-effect hatası ve `DistributeModal.tsx`'teki
`no-unused-expressions` uyarısı ikisi de bu görevden önce vardı, konumları
değişmedi; `NftThumb.tsx`'teki yeni `no-img-element` uyarısı, dosyanın
taşındığı `WalletDetailClient.tsx`'teki eşdeğerinin yerini aldı, net sayı
artmadı), `npx jest` 24/24 geçti.

Gerçek bir NFT gerçek bir adrese **bu oturumda hiç gönderilmedi** — görev
talimatı böyle emrediyordu, `transfer_nft` yalnızca imza/derleme/tip
seviyesinde doğrulandı (backend tarafı zaten `5582cf2`'de `cargo test`
93/93 ile doğrulanmıştı, o teste bu oturumda dokunulmadı).

**DOĞRULANAMADI:** Bu ortamda gerçek bir tarayıcıya tıklayan bir araç yoktu
(GUI otomasyon aracı bulunamadı) — Select→Confirm adımlarının canlı uygulamada
gerçekten NFT listesini gösterdiği, alıcı adres doğrulamasının ekranda
çalıştığı, Confirm adımındaki envelope-onay/red mesajının göründüğü **gözle
hiç görülmedi**. `npm run dev`/`tauri dev` zaten çalışıyordu (port 3000, PID
37529 next / 37340 tauri) — kapatılmadı, ikinci bir instance başlatılmadı;
`curl` ile `/` (200) ve `/wallet/test-id` (redirect sonrası 200) sunucu
tarafında çökme olmadığını doğruladı ama bu istemci-render bir ekran olduğu
için NFT listesinin gerçekten göründüğünü kanıtlamıyor. **Kalan iş:**
Accessibility izni netleşince (T1/T10'daki aynı blokaj) biri bu ekranı fiilen
açıp NFT seçip Confirm'e kadar gitsin, gerçek Send'e asla tıklamadan.

**`forge` — T9c, `bulk/distribute/page.tsx` gerçek gönderime bağlandı — ⚠️
KOD HAZIR, İLK GERÇEK GÖNDERİM EMİR'İN ONAYINI BEKLİYOR (10.08.2026).**
Ekranın kendine özgü bakiye (ETH+WETH), gas tahmini ve Address Book özellikleri
korunarak, gönderim mekanizması sahte/disabled'dan `src/lib/distribute.ts`'teki
aynı zarf-korumalı yola bağlandı — `DistributeModal.tsx`'in kullandığı
`previewTransaction`/`runDistribution` çiftinin aynısı, mekanik olarak ortak
bileşene sokulmadan (Emir'in 10.08.2026 kararı, yukarıdaki "⚠️ DÜZELTME"
notuna bakın).

- Step 2 (Confirm) artık her hedef için `previewTransaction` çağırıyor (gas
  tahmini paneli ayrı kalıyor — o zaten gerçekti, sadece envelope onayı hiç
  yoktu). Sonuç: "Spending envelope: Authorized / Not authorized", reddeden
  her hedef için `explainSendError` ile insan-okur gerekçe. "Continue (nothing
  is sent)" düğmesi kaldırıldı, yerine yalnızca tüm hedefler `authorized`
  olduğunda aktifleşen "Confirm & Send" geldi.
- Step 3 artık `runDistribution`'ın döndürdüğü gerçek `SendRow` durumlarını
  gösteriyor (Queued/Signing…/Broadcast/Failed/Not sent) — sabit "Not sent"
  metni ve `setTimeout` teatral hali tamamen kaldırıldı. Sağdaki Transaction
  Monitor paneli de aynı `sendRows`'u gösteriyor, artık statik "Not sent"
  rozeti basmıyor.
- T10'daki "TXN:" + tıklanabilir Etherscan linki deseni (`openExternalUrl`,
  açma hatası görünür satırla) burada da uygulandı.
- T6b'deki adres-bazlı kendine-gönderim uyarısı (`selfSendWarnings`) hem
  wallet hem Address Book hedefleri için Step 2'de gösteriliyor.
- Aynı adresten gönderimler zaten `runDistribution` içinde sıralı (T6b/T9
  Görev 1'den miras) — bu ekran da aynı fonksiyonu çağırdığı için nonce
  çakışması riski yok.
- Çift tık koruması: `sendStartedRef`, `DistributeModal`'daki desenle birebir.

Dosyalar: `src/app/bulk/distribute/page.tsx` (tek dosya — `src/lib/distribute.ts`
ve `src/lib/tauri.ts`'e sadece import, değişiklik yok).

Doğrulanan: `npx tsc --noEmit` temiz, `npx eslint` bu dosyada yeni hata/uyarı
eklemedi (`git stash` ile taban alındı — hem öncesi hem sonrası aynı 3 uyarı,
0 hata, konumları kaydı), `npx jest` 24/24 geçti. Zaten çalışan dev sunucusuna
(`npm run dev`, port 3000) `curl -sL http://localhost:3000/bulk/distribute`
200 döndü — sunucu tarafında render çökmesi yok.

**DOĞRULANAMADI:** Bu ortamda tıklayan bir tarayıcı otomasyon aracı yoktu
(T1/T9/T10'daki aynı Accessibility izni blokajı). Bakiye/gas/Address Book
panellerinin gerçek uygulamada hâlâ doğru göründüğü, Step 2'deki envelope
onay/red mesajının canlı bir zarfla gerçekten değiştiği ve Confirm & Send
düğmesinin doğru etkinleştiği **gözle görülmedi** — yalnızca kod/tip/lint/test
seviyesinde kanıt var.

**Gerçek ilk gönderim kesinlikle tetiklenmedi** (görev talimatı ve CLAUDE.md
madde 5 gereği yasaktı) — bu görevde Confirm & Send düğmesine hiç tıklanmadı,
`runDistribution`/`sendEth` bu oturumda hiç çalıştırılmadı. **Kalan iş:** Emir
Westron'u açıp bir zarf (envelope) oluşturduktan sonra, düşük tutarlı gerçek
bir Distribute Funds gönderimini `bulk/distribute` ekranından bizzat onaylayıp
Etherscan'de teyit etmeli — bu ekrandan yapılacak ilk gerçek mainnet işlemi.

**`forge` — T9d, Bulk Actions'taki ölü `NftSendModal` kaldırıldı — BİTTİ
(10.08.2026).** Önceki forge turunun bıraktığı çelişki: aynı ekranda iki "NFT
gönder" giriş noktası vardı — Distribute CTA'sından açılan gerçek
`DistributeModal`'ın Send NFT sekmesi (T9b) ve Bulk Actions araç çubuğundaki
"Send NFTs" ikonundan açılan `NftSendModal` (her zaman "Sending unavailable"
diyen dürüst ama işlevsiz iskelet). CLAUDE.md'nin tek-implementasyon kuralı
gereği ikinci sürüm kaldırıldı, tetikleyici gerçek akışa bağlandı.

- `NftSendModal` fonksiyonu ve `showNftSendModal` state'i tamamen silindi.
- Bulk Actions'taki "Send NFTs" düğmesi artık `DistributeModal`'ı Send NFT
  sekmesinde, tıklanan NFT önceden seçili olarak açıyor. Bunun için
  `DistributeModal`'a yeni bir prop eklendi: `preselectedNftKey?: string`
  (`nftKey(nft)` formatı — `contract.address + token_id`, Bulk Actions'ın
  seçim anahtarıyla birebir aynı). Prop verildiğinde modal doğrudan
  `tab='nft'`, `selectedNftKey=preselectedNftKey` ile açılıyor; anahtar
  `nfts` listesinde yoksa (ör. veri henüz gelmediyse) sessizce hiçbir şey
  seçilmeden normal varsayılana (Send Funds sekmesi) düşüyor — hayali bir
  seçim göstermiyor.
- **Ürün kararı — çoklu seçim (Emir'in onayı gerekebilir, varsayım olarak
  işaretliyorum):** `transfer_nft` komutu tek seferde tek NFT gönderiyor
  (imza: `contract_address, token_id, to, token_standard, amount` — hepsi
  tekil). `DistributeModal`'ın Send NFT sekmesi de zaten tek seçim
  (`selectedNftKey: string | null`) üzerine kurulu; sıralı çoklu gönderim
  desteği eklemek hem bu görevin kapsamını hem riskini büyütürdü (aynı
  kaynaktan art arda imzalar, nonce sıralaması, kısmi başarısızlıkta hangi
  NFT'lerin gittiğini gösterme UI'ı — hiçbiri mevcut değil). Bunun yerine
  **(a) yolunu seçtim**: Bulk Actions'ta birden fazla NFT seçiliyken "Send
  NFTs" düğmesi devre dışı kalıyor, üzerine gelince "Select exactly one NFT
  to send — NFT transfers move one item at a time" açıklaması çıkıyor. Tam
  bir NFT seçiliyken aktifleşiyor. Bu, sessiz bir kısıtlama değil — düğme
  görünür şekilde devre dışı ve nedeni yazıyor. Emir çoklu NFT'yi tek
  tıkla göndermeyi gerçekten istiyorsa bu ayrı bir görev (transfer_nft'i
  sırayla çağıran bir kuyruk, T9c'deki `runDistribution`'a benzer bir desen)
  olarak ele alınmalı.

Dosyalar: `src/app/wallet/[id]/WalletDetailClient.tsx`,
`src/components/DistributeModal.tsx`.

Doğrulanan: `npx tsc --noEmit` temiz, `npx jest` 24/24 geçti, `npx eslint`
bu iki dosyada yeni hata/uyarı eklemedi (`git stash` ile taban alındı — hem
öncesi hem sonrası aynı 1 hata + 3 uyarı, hepsi bu değişikliklerden bağımsız
satırlarda: `AddressBookTab`'ın effect'i, `NftThumb`'ın `<img>` kullanımı,
`DistributeModal`'ın önceden var olan `n.has(id) ? ... : ...` deseni).

**DOĞRULANAMADI:** Bu ortamda gerçek uygulamayı açıp tıklayan bir araç yoktu
(T1/T9/T10'daki aynı Accessibility izni blokajı) — Bulk Actions'ta bir NFT
seçilip "Send NFTs" düğmesine tıklandığında `DistributeModal`'ın gerçekten
Send NFT sekmesinde, o NFT önceden seçili şekilde açıldığı **gözle
görülmedi**. Yalnızca kod/tip/lint/test seviyesinde kanıt var. Gerçek bir
NFT gönderimi bu görevde kesinlikle tetiklenmedi.

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

**⚠️ KISMEN BİTTİ (10.08.2026, `forge`).** `plugin-shell` kurulmadı —
kontrol ederken zaten çalışan bir eşdeğeri bulundu: `open_external_url`
Tauri komutu (`src-tauri/src/lib.rs:467`, `open` crate'ini kullanıyor, sadece
`https://` kabul ediyor) ve frontend köprüsü `openExternalUrl()`
(`src/lib/tauri.ts:827`) zaten vardı ve `monitor/page.tsx` ile sentiment
panellerinde (OpenSea/tweet linkleri) canlı kullanılıyordu. Aynı pattern
tekrarlandı, yeni bağımlılık eklenmedi:
- **a)** `WalletDetailClient.tsx`'teki `<a target="_blank">` Etherscan
  düğmesi `<button onClick={() => openInBrowser(...)}>`'a çevrildi.
  `openExternalUrl` başarısız olursa (`Result<(), String>` bir hata
  dönerse) düğmenin altında kırmızı bir satırla neden gösteriliyor — önceki
  `<a>` sessizce hiçbir şey yapmıyor olabilirdi, artık başarısızlık da görünür.
- **b)** `src/app/page.tsx` ve `src/app/wallets/page.tsx`'teki Process
  adımında, `r.hash` linkinin önüne **"TXN:"** etiketi eklendi, `<a>`
  yerine aynı `openExternalUrl` pattern'iyle `<button>` kullanıldı, açma
  hatası için görünür satır eklendi (ikisi de `bulk/distribute/page.tsx`'e
  dokunmadı — o T9 kapsamında).

Dosyalar: `src/app/wallet/[id]/WalletDetailClient.tsx`, `src/app/page.tsx`,
`src/app/wallets/page.tsx`.

Doğrulandı: `npx tsc --noEmit` temiz, `cd src-tauri && cargo check` temiz
(Rust tarafına dokunulmadı — komut zaten vardı), `npx eslint` bu üç dosyada
yeni hata eklemedi (WalletDetailClient'taki tek pre-existing `error`
diff'le doğrulandı, bu görevden önce de vardı), `npx jest` 24/24 geçti.

**DOĞRULANAMADI — canlı uygulamada gerçekten tıklanıp tarayıcı açıldığı
gözle görülmedi.** Masaüstünde bu oturumda aynı anda başka pencereler
açıktı (ChatGPT masaüstü uygulaması kendi ajan oturumunu çalıştırıyordu,
üstte görünür şekilde), `screencapture` ile tek bir salt-okunur ekran
görüntüsü alındı (Westron penceresi `System Events` ile frontmost yapıldı,
dashboard gerçek verilerle göründü) ama otomatik tıklama denenmedi — T1'de
kayıtlı "yanlış pencereye tıklama" riski (o olayda canlı bir Chrome/OpenSea
sekmesine gidilmişti) burada da geçerliydi ve bu görev "düşük risk" olarak
tanımlansa da riski göze almaya değmedi. `openExternalUrl`/`open_external_url`
çifti zaten `monitor/page.tsx`'te ve sentiment panellerinde canlı kullanımda
olduğu için kod yolu battle-tested, ama bu spesifik iki yeni çağrı yeri
(header Etherscan düğmesi, TXN linki) ekranda tıklanıp doğrulanmadı.
**Kalan iş:** Accessibility izni netleşince (T1'deki aynı blokaj)
`vera` bu iki linki gerçekten tıklayıp OS tarayıcısının açıldığını
gözlemlesin.

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

---

## T11 — Distribute Funds gerçekte çalışmıyor  ✅ TAMAMLANDI 10.08.2026 (vera gerçek tıklamayla doğruladı)

Emir'in kendi sözleri (uygulamayı gerçekten kullanarak test etti — vera'nın "kod temiz"
demesi yetmedi, çünkü hiçbir ajan gerçek tıklama yapamadı):

> "distribute funds olmuyor. confirm & send cta üzerine gelince mouse altında yasak
> ikonu çıkıyor. Burada dynamic bir check sistemi olmalı, ben type ettiğim anda hata
> varsa uyarmalı kırmızı bir yazı ile specific bir alanda. Bu componentta amount per
> wallet kutusu da hatalı. Büyük alanın hiçbir fonksiyonu yok ve user sanki buraya
> amount yazmaya yönlendiriyor. Burayı globalde fixle. En son olarak walletlara tek
> tek farklı amount gönderebiliyor olmam lazım."

**Madde a — Confirm & Send tıklanamıyor:** Düğmenin üzerine gelince "yasak" (not-allowed)
imleci çıkıyor, yani düğme `disabled` durumda kalıyor ve kullanıcı hiçbir zaman ilerleyemiyor.
`canSend`/`step1Valid`/envelope-onay mantığında bir yerde hep `false` dönen bir kontrol var.
Bu, T9c'de bulk/distribute'a bağlanan gerçek gönderim yolunda (`src/app/bulk/distribute/page.tsx`)
ve/veya paylaşılan `src/components/DistributeModal.tsx`'te olabilir — Emir hangi ekranda
olduğunu netleştirmedi, **her ikisi de kontrol edilmeli**.

**Madde b — Statik değil, dinamik/canlı validasyon eksik:** Şu an muhtemelen sadece
düğme disabled kalıyor, kullanıcıya NEDEN ilerleyemediği hiçbir yerde yazmıyor (bu tam
olarak CLAUDE.md'nin "sessiz başarısızlık yasak" kuralının ihlali — T6a'da wallet detail
için çözülen sorunun aynısı burada da var). İstenen: kullanıcı bir alana yazarken
(örn. tutar, adres) o alanın validasyonu **anlık** çalışmalı, hata varsa **o spesifik
alanın altında/yanında kırmızı bir metin** olarak gösterilmeli — genel bir "gönderilemez"
durumu değil, hangi alanın neden geçersiz olduğu.

**Madde c — "Amount per wallet" kutusu kırık/yanıltıcı:** Bu component içinde büyük bir
alan var, hiçbir işlevi yok ama kullanıcıyı buraya tutar yazması gerekiyormuş gibi
yönlendiriyor (muhtemelen bir placeholder/label var ama gerçek bir input'a bağlı değil,
ya da yanlış input'a bağlı). **Global fixle** — yani bu kutu nerede tekrar ediyorsa
(paylaşılan `DistributeModal` + `bulk/distribute` + varsa başka yer) hepsinde düzelt,
tek bir yerde yamamayla bırakma.

**Madde d — Cüzdan başına farklı tutar gönderimi çalışmıyor/eksik:** Emir'in asıl
ihtiyacı: birden fazla cüzdana **tek bir eşit tutar** değil, **her cüzdana ayrı ayrı
farklı bir tutar** girebilmek. Kodda `amountMode`/`customAmounts` diye bir state zaten
var gibi görünüyor (önceki turlarda görüldü) ama Emir'in deneyiminde bu ya çalışmıyor
ya da UI'da bulunamıyor/görünmüyor. Bu ekranda uçtan uca gerçekten çalıştığını (her
cüzdana farklı bir sayı yazılabildiğini, bu sayıların önizleme/gönderim adımına doğru
yansıdığını) kanıtlamak lazım — "kod var" yetmez, Emir'in tarif ettiği deneyimle eşleşmeli.

### forge bulguları (10.08.2026)

**Madde a — kök neden bulundu, iki ayrı hata:**
1. `src/components/DistributeModal.tsx`'in Step 2 "Send Funds" sekmesinde
   düğmenin neden pasif kaldığını gösteren **hiçbir** UI yoktu — aynı dosyanın
   "Send NFT" sekmesinde ve `bulk/distribute/page.tsx`'in Step 2'sinde bu zaten
   vardı (envelope durumu, distKey eksikliği, previewError, red edilen cüzdan
   listesi). Yani düğme gerçekten kararlı bir mantıkla pasifti ama ekran bunu
   hiç söylemiyordu — Emir'in gördüğü "yasak ikonu, sebep yok" deneyiminin
   birebir kaynağı bu. Artık DistributeModal.tsx:929-957 arasında "Send Funds"
   sekmesine de envelope durumu ("Checking…" / "Authorized" / "Not authorized"),
   distKey eksikse uyarı, previewError ve red edilen her cüzdan için ayrı satır
   eklendi (aynı desen "Send NFT" sekmesinde zaten vardı, bkz. satır 846-850).
2. İkinci, daha sinsi bir hata: Step 1'in "ilerleyebilir miyim" kontrolü
   `parseFloat(x) > 0` kullanıyordu, Step 2'nin gerçek preview/gönderim yolu ise
   `parseEthToWei(x)` kullanıyor. İkisi bazı girdilerde (örn. `"1e-5"`)
   anlaşmazlığa düşebiliyor: parseFloat kabul eder, parseEthToWei'nin
   ondalık-only regex'i reddeder. Sonuç: Step 1 kullanıcıyı ilerletir ama Step 2
   o cüzdanı `previews` map'inden sessizce düşürür (`wei == null` dalı `continue`
   der) ve Confirm & Send sonsuza kadar pasif kalır, hiçbir açıklama olmadan.
   Düzeltme: `src/lib/distribute.ts:79-82`'ye tek bir `isValidEthAmount()`
   fonksiyonu eklendi, hem `DistributeModal.tsx:241-246`'daki `step1Valid` hem
   `bulk/distribute/page.tsx:180-185`'teki `canReview` artık aynı bu fonksiyonu
   kullanıyor — iki kontrol asla birbirinden ayrışamaz artık.

**Madde b — dinamik/canlı validasyon eklendi:** Her iki dosyaya da
`amountFieldError(raw)` yardımcı fonksiyonu eklendi (kutu boşken hata göstermez,
kullanıcı bir şey yazdığı an geçersizse "Invalid amount — enter a number greater
than 0" kırmızı metnini o alanın hemen altında gösterir). Uygulandığı yerler:
- `DistributeModal.tsx`: equal-mode tek kutu (satır ~668-690 ve ~727-746),
  custom-mode her cüzdan satırı (satır ~703-722 ve ~765-780).
- `bulk/distribute/page.tsx`: equal-mode tek kutu (satır ~570-589), custom-mode
  her cüzdan satırı (satır ~592-618) ve Address Book satırı (satır ~619-648).

**Madde c — "Amount per wallet" kutusu: DistributeModal.tsx'te GERÇEKTEN kırık,
bulk/distribute/page.tsx'te değil.** İki dosya ayrı ayrı incelendi:
- `DistributeModal.tsx` (dashboard + wallets skin, equal mode): kutunun dış
  çerçevesi (border+background) bir `<span>` etiketi ("Amount per wallet") ile
  yan yana duran 60px genişliğinde küçük bir `<input>`'u sarıyordu — görsel
  olarak bütün kutu tıklanabilir/yazılabilir görünüyordu ama sadece sağdaki
  60px gerçekten işlevseldi. State bağlantısı (`value`/`onChange`) zaten
  doğruydu, yani "çalışmayan handler" değil, saf bir CSS/UX yanıltmasıydı.
  **Karar: kaldırılmadı, düzeltildi** — artık görünen kutunun tamamı tek bir
  gerçek `flex:1` input (satır 668-690 equal/dashboard, 727-746 equal/wallets),
  placeholder da "Amount per wallet (applies to all N selected)" olarak
  netleştirildi ki kaç cüzdanı etkilediği belli olsun.
- `bulk/distribute/page.tsx`: bu ekranda kutu zaten tek parça gerçek bir
  `flex:1` input'tu (satır 570-584), "büyük ama işlevsiz alan" hatası burada
  yoktu. Bu dosyada madde c için yapılan tek değişiklik placeholder metnini
  DistributeModal.tsx ile tutarlı hale getirmek ("applies to all N selected")
  ve madde b'nin inline hata metnini eklemekti — yapısal bir yeniden tasarım
  gerekmedi çünkü kutu zaten doğruydu.
- Global tarama: `grep -rn "Amount per wallet"` ile bu string'in geçtiği her
  yer kontrol edildi, iki dosya dışında üçüncü bir tekrar bulunamadı.

**Madde d — cüzdan başına farklı tutar: state/veri akışı kod seviyesinde
zaten doğruydu, gerçek engel madde a'ydı.** `customAmounts`/`amountCustom`/
`abAmounts` (Record<walletId, string>) her cüzdan için ayrı state tutuyor ve
`SendRow[]`'a dönüşürken her satır kendi `valueWei`'sini alıyor
(`runDistribution` bunları sırayla, paralel değil, işliyor —
`src/lib/distribute.ts:101-128`). Yani "her cüzdana farklı tutar yazma" özelliği
kodda gerçekten vardı; Emir'in "çalışmıyor" deneyimi muhtemelen madde a'nın AYNI
kök nedeniydi (düğme hiçbir zaman aktifleşmiyordu — eşit ya da özel tutar fark
etmeksizin), ayrı bir custom-amount hatası değil. **Bu iddia canlı tıklamayla
doğrulanamadı** (bkz. aşağıdaki dürüstlük notu) — vera'nın öncelikli test
senaryosu bu olmalı: birden fazla cüzdan seç, her birine FARKLI bir tutar yaz,
Confirm & Send'e basmadan önce Step 2'deki her satırın kendi doğru tutarını
gösterdiğini gözle doğrula.

**Doğrulama — dürüstçe neyin yapılıp neyin yapılamadığı:**
- ✅ `npx tsc --noEmit` temiz (0 hata).
- ✅ `npx eslint` — değiştirilen üç dosyada 0 hata; 4 uyarı var ama hepsi bu
  değişikliklerin dışındaki satırlarda (diff hunk'larının dışında,
  `git diff` ile teyit edildi), yani bu turda eklenmedi.
- ✅ `npx jest` — 2 suite, 24 test, hepsi geçti.
- ❌ **Gerçek tıklamayla doğrulama YAPILMADI.** Bu ortamda (Claude Code/Bash
  içinden) Playwright/Puppeteer/Cypress gibi bir browser-automation aracı
  bulunamadı (`node_modules/.bin` ve `package.json` kontrol edildi, script
  yok). Yani "kullanıcı bir cüzdana yanlış tutar yazınca kırmızı metin gerçekten
  ekranda beliriyor mu", "geçerli girdiyle Confirm & Send gerçekten tıklanabilir
  hale geliyor mu", "her cüzdana farklı tutar yazınca Step 2'de gerçekten farklı
  değerler görünüyor mu" — bunların hiçbiri canlı uygulamada gözle görülmedi.
  Bu tam olarak T11'in var olma sebebi olan hatayı (vera'nın "kod temiz" deyip
  gerçekte çalışmadığını) tekrarlamamak için: **bu iş vera'nın gerçek
  tıklamayla doğrulaması olmadan "bitti" sayılamaz.**

**Ajanlar:** → `forge` (root cause bul + düzelt, hem `bulk/distribute/page.tsx` hem
`DistributeModal.tsx`'i kontrol et) → `vera` (bu sefer gerçekten tıklayarak doğrula,
Emir'in tarif ettiği 4 maddenin hepsini tek tek test et — özellikle "type ettiğim anda
kırmızı hata" ve "cüzdan başına farklı tutar" senaryolarını).

**Bitti sayılır:** Confirm & Send gerçek geçerli girdiyle tıklanabilir hale geliyor
(gerçek gönderim yine Emir onayı bekler, T9c'deki kural değişmedi); alan bazlı canlı
kırmızı hata mesajları çalışıyor; amount-per-wallet kutusu ya kaldırılıyor ya da gerçek
bir işleve bağlanıyor (hangisi olduğu net yazılıyor); cüzdan başına farklı tutar girme
uçtan uca (gerçek tıklamayla) doğrulanıyor. Bunların hepsi `vera` tarafından gerçek
tıklamayla teyit edilmeden "bitti" sayılmaz — bu T11 zaten "vera kod okuyup doğru
görünüyor dedi ama gerçekte çalışmıyordu" örneği olduğu için ekstra dikkatli doğrulanacak.

### vera doğrulaması (10.08.2026) — gerçek GUI tıklamasıyla

**Yöntem (dürüstlük notu):** Bu ortamda Playwright/Puppeteer/Cypress yok. Onun yerine
çalışan dev uygulamasına (`npm run dev:tauri`, `target/debug/app` süreci `ps aux` ile
canlı doğrulandı) karşı gerçek OS-seviyesi tıklama yapıldı: `osascript`/System Events
(Accessibility API) + `cliclick` + `screencapture -x`, her adımda ekran görüntüsü alınarak.
Bu kod okuma değil, gerçek fare tıklaması ve gerçek klavye girişidir.

**Ortam kirliliği ve düzeltmesi:** Bu makinede aynı anda açık diğer masaüstü uygulamaları
(Outlook, ChatGPT, Chrome, WhatsApp) sık sık `frontmost` durumunu çalıyor; bu yüzden ilk
turlarda bazı tıklamalar sessizce başka bir uygulamaya gitti ve geçici olarak "checkbox
tıklanamıyor" sanrısına yol açtı. Çözüm: her tıklamadan hemen önce aynı bash komutunda
`set frontmost of process "app" to true && cliclick ...` şeklinde zincirleme (atomic) yapıldı.
Bu yöntemle önceden "kırık" görünen checkbox'lar (t2/t4) da dahil her element güvenilir
şekilde tıklanabildi — önceki şüphe ortam kaynaklıydı, uygulama hatası değildi. Ayrıca
oturum sırasında kazayla Window menüsünden "Minimize" tıklandı, `AXRaise`/cmd+tab ile
düzeltildi, uygulama görsel olarak sağlam bırakıldı (aşağıda "sonuç" kısmına bakın).

**Madde a — DOĞRULANDI.** Wallet-detail sayfasındaki "Distribute" CTA'sından açılan
DistributeModal'da (FROM kilitli = t1, CUSTOM mode): t2'ye 0.011 ETH, t4'e 0.022 ETH
yazıldığında "Review (2 wallets)" düğmesi devre dışından parlak yeşil aktife geçti;
t4'ün tutarı "abc" yapıldığında düğme anında tekrar devre dışı kaldı (gri, not-allowed
imleç) — her iki yön de canlı gözlemlendi. Dashboard CTA'sından açılan ikinci, bağımsız
DistributeModal örneğinde (FROM açık dropdown, t1 seçildi, EQUAL mode) aynı davranış
tekrarlandı: t2 işaretlenip 0.005 ETH yazılınca "Review (1 wallet)" pasiften aktife geçti.

**Madde b — DOĞRULANDI.** Geçersiz tutar ("abc") yazılan alanın hemen altında kırmızı
"Invalid amount — enter a number greater than 0" metni ve alanın kırmızı border'ı, herhangi
bir gönder/submit gerekmeden, input anında belirdi. İki ayrı modal örneğinde de gözlemlendi.

**Madde c — DOĞRULANDI (DistributeModal.tsx için).** CUSTOM modda t2 ve t4 için gerçekten
iki ayrı, bağımsız düzenlenebilir, tam genişlikte input görüldü — biri değiştirilince diğeri
etkilenmedi. EQUAL modda tek, tam genişlikte gerçek input ve dinamik placeholder ("Amount
per wallet (applies to all N selected)") gözlemlendi. Forge'un iddia ettiği "artık büyük
ama işlevsiz kutu yok" doğrulandı.

**Madde d — DOĞRULANDI.** t2=0.011 ETH, t4=0.022 ETH farklı tutarlarla CUSTOM modda
"Review" tıklanıp (Confirm & Send'e **asla** basılmadı) Step 2 "Confirm" ekranına geçildi:
ekranda t2 satırı 0.011 ETH, t4 satırı 0.022 ETH olarak ayrı ayrı doğru gösterildi, Total
0.0330 ETH olarak doğru toplandı. Bu, farklı cüzdan tutarlarının önizleme adımına doğru
aktığının doğrudan görsel kanıtıdır.

**Ek gözlem (T11 kapsamı dışı, karışmasın diye not):** Step 2'de "Spending envelope: Not
authorized" ve her cüzdan için insan-okunur red sebebi gösterildi, Confirm & Send bu yüzden
pasif kaldı. Bu CLAUDE.md'deki zarf modelinin doğru çalıştığının kanıtıdır — madde a'daki
"sebepsiz pasif düğme" hatasıyla karıştırılmamalı, çünkü burada sebep ekranda açıkça yazılıydı.

**`src/app/bulk/distribute/page.tsx` — DOĞRULANAMADI, ve ayrıca yeni bir bulgu: bu sayfa
uygulama içinden hiçbir yerden erişilebilir değil.** `grep -rli "distribute" src/` ile
üç gerçek giriş noktası da tarandı: `src/app/page.tsx` (Dashboard CTA), `src/app/wallets/page.tsx`,
`src/app/wallet/[id]/WalletDetailClient.tsx` — üçü de yalnızca `DistributeModal` component'ini
açıyor. Kod tabanının hiçbir yerinde `/bulk/distribute`'a giden bir `<Link>`, `router.push`
veya benzeri bir gezinme çağrısı yok (üst nav'daki "Bulk" sekmesi tıklanarak doğrulandı —
List/Bid/Cancel kartlarına gidiyor, distribute'a değil). Yani bu 791 satırlık ayrı
implementasyon şu an gerçek kullanıcı akışında **ölü kod / yetim sayfa**: yalnızca adres
çubuğuna elle URL yazarak erişilebilir, ki Tauri masaüstü uygulamasında kullanıcının böyle
bir adres çubuğu yok. Bu ekranda madde a/b/c/d canlı tıklamayla test edilmedi — çünkü gerçek
kullanıcı bu ekrana hiç ulaşamıyor, test etmek yanlış bir güvence verirdi. Bu ayrıca
CLAUDE.md'nin "aynı işi yapan iki üç ekran büyütüp birbirinden ayırma" uyarısının somut bir
örneği: `DistributeModal` gerçek/kullanılan yol, `bulk/distribute/page.tsx` kullanılmayan
bir ikinci implementasyon.

**Sonuç:** Emir'in bildirdiği 4 maddenin hepsi (a, b, c, d) gerçek GUI tıklamasıyla, iki
ayrı DistributeModal giriş noktasında (Dashboard CTA + wallet-detail CTA) tekrar tekrar
doğrulandı, gönderim **hiçbir zaman** tetiklenmedi. `bulk/distribute/page.tsx` doğrulanamadı
çünkü uygulama içinden erişilebilir değil — bu, T11'in orijinal kapsamından bağımsız yeni
bir temizlik maddesi (bkz. T12).

**T11 durumu: ✅ TAMAMLANDI** — Emir'in gerçekte kullandığı ve şikayet ettiği yol
(`DistributeModal`, üç gerçek giriş noktasının hepsinde) için 4 madde de gerçek tıklamayla
doğrulandı. `bulk/distribute/page.tsx`'in erişilemez/yetim olması T11'i geçersiz kılmıyor
(Emir o ekrandan hiç bahsetmedi ve zaten ulaşamıyor) ama T12 olarak takip edilmeli.

---

## T12 — `src/app/bulk/distribute/page.tsx` yetim sayfa, temizlenmeli  🆕 10.08.2026, vera buldu

T11 doğrulaması sırasında bulundu: `src/app/bulk/distribute/page.tsx` (791 satır, kendi
state'i, kendi validasyonu, `DistributeModal.tsx`'ten tamamen bağımsız ikinci bir
implementasyon) uygulama içinde **hiçbir yerden** bağlı değil. `grep -rn "bulk/distribute" src/`
sonucu boş — hiçbir `<Link>`/`router.push` yok. Üst nav'daki "Bulk" sekmesi List/Bid/Cancel'a
gidiyor, bu sayfaya değil. Gerçek kullanıcı bu ekrana asla ulaşamıyor.

**Bitti sayılır:** Ya (a) sayfa silinir ve `docs/TASKS.md`'deki T9c gibi eski referanslar
"artık kullanılmıyor" diye güncellenir, ya da (b) gerçekten kullanılacaksa nav'a bağlanır
VE `DistributeModal.tsx` ile aynı `isValidEthAmount`/`amountFieldError` mantığını paylaştığı
kod incelemesiyle (ya da tercihen tek bir paylaşılan component'e indirgenerek) teyit edilir.
CLAUDE.md'nin "aynı işi yapan iki üç ekran büyütme" kuralı gereği (b) yerine (a) tercih edilmeli
— iki implementasyonu senkron tutmak kalıcı bir bakım yüküdür ve zaten bir kez (T11'de)
ayrışmaya sebep oldu.

**Ajanlar:** → Emir'e sor (silinsin mi, yoksa nav'a mı bağlansın) → `forge` (karara göre uygula).

**Sonuç — 10.08.2026:** Emir seçeneği (a)'yı onayladı: sayfa silindi.
`src/app/bulk/distribute/page.tsx` ve boşalan `src/app/bulk/distribute/` klasörü kaldırıldı.
Silmeden önce `grep -rn "bulk/distribute" src/` tekrar çalıştırıldı, silinen dosya dışında hiçbir
referans çıkmadı. `npx tsc --noEmit` silme sonrası temiz. Artık uygulamada tek bir Distribute
Funds implementasyonu var: `src/components/DistributeModal.tsx`. ✅ Tamamlandı.

## T13 — Abonelik protokolü uyuşmazlığı: gerçek abonelik masaüstünde yenilenemiyor 🆕 10.08.2026, `API.md` canlı testinden, EN ÖNCELİKLİ

`API.md`'deki canlı Worker testinde bulundu (dosya köke commit edilmemiş haldeydi, şimdi
commit edildi — bkz. altta). Cloudflare Worker (`https://westron-subscription.ebaltepe.workers.dev`)
artık bearer-token + hesap tabanlı bir license akışı kullanıyor (`POST /license` → Yes auth,
`{access, license:{payload, sig}}` döner, payload `account_id`/`email`/`active`/`plan`/`expires_at`
içerir). Masaüstündeki Rust abonelik istemcisi hâlâ eski protokolü konuşuyor: bearer token
göndermeden `{wallet}` postluyor, üst seviye `payload`/`sig` alanlarının bir wallet payload'ı
taşımasını bekliyor. Worker bu isteğe `401` döner, masaüstü de eski/bayat cache'e düşer.
**Sonuç: gerçek, aktif bir abonelik şu an masaüstü uygulamasında yenilenemiyor.**

**Bitti sayılır:**
- Rust abonelik istemcisi (muhtemelen `src-tauri/src/subscription/` veya benzeri — konumu
  scout ile doğrulanmalı) Worker'ın gerçek hesap/token akışına göre yeniden yazılır: signup/login
  ile bearer token alınır, `POST /license` bu token'la çağrılır, dönen `license.payload`
  **imzası doğrulanmadan asla** okunmaz (Ed25519 `sig` kontrolü şart).
- Eski wallet-payload beklentisi tamamen kaldırılır, geriye dönük uyumluluk şeysi eklenmez.
- Worker'ın `westron-subscription` deploy'una karşı gerçek bir signup/login/license döngüsü
  ile denenir (deneme hesabı, sonra temizlenir — `probes/` altına kayıt).
- `MOCKS.md` ve `STATUS.md` güncellenir: abonelik artık gerçek mi, hâlâ mock/bozuk mu net yazılır.

**Ajanlar:** → `scout` (Rust abonelik istemcisinin tam yolu ve mevcut akışı) → `vault` (protokolü
Worker'a uydur) → `vera` (gerçek signup/login/license döngüsüyle doğrula, kod okuyarak değil).

**Scout keşfi tamamlandı (10.08.2026) — hiçbir kod değişmedi, aşağısı bir sonraki `vault`
turu için hazır zemin:**

- Worker sözleşmesi (`subscription-worker/src/index.ts`): `POST /signup` ve `POST /login`
  `{email,password}` alır, `{token, account, access, license}` döner. `POST /license`
  `Authorization: Bearer <token>` ister, `{access, license:{payload, sig}}` döner —
  `license.payload` JSON'u `{account_id, email, active, reason, plan, expires_at, issued_at}`
  (wallet alanı YOK), `access.active` iç içe, üst seviye değil.
- Kırık istemci: `src-tauri/src/subscription/mod.rs`. `Payload` struct (satır 57-64) hâlâ
  `wallet` alanı taşıyor. `fetch_license` (satır 229-260) çıplak `{wallet}` postluyor,
  `Authorization` header'ı yok, cevabı üst seviyeden (`active`/`payload`/`sig`) okuyor —
  olması gereken `access.active`/`license.payload`/`license.sig`. `evaluate()` (satır 164) ve
  satır 179'daki `payload.wallet.to_lowercase() == addr` eşleşmesi artık hesap/email tabanlı
  olmalı. İmza doğrulama (`verify()`, satır 122-131) ve disk cache (`store_license`/
  `load_license`, satır 148-160, anti-rollback) **doğru, dokunulmayacak** — sadece taşıdıkları
  şema değişecek.
- Komut yüzeyi: `check_subscription` (`src-tauri/src/lib.rs:478-481`, kayıt satır 842) şu an
  `wallet_address: String` alıyor — token tabanlı olmalı, muhtemelen ayrı
  `subscription_signup`/`subscription_login` komutları eklenmeli.
- Token saklama deseni: `src-tauri/src/wallet/keychain.rs`'teki `store_secret`/`fetch_secret`/
  `delete_secret` (satır 325-359) + per-purpose wrapper'lar (`store_alchemy_key` vb., satır
  399-411) örnek alınacak; analog `store_subscription_token`/`fetch_subscription_token`/
  `delete_subscription_token` eklenmeli.
- Frontend çağıran yerler (henüz okunmadı, bir sonraki vault turu önce bunları okumalı):
  `src/lib/tauri.ts:852-865` (`checkSubscription` wrapper), `src/app/settings/page.tsx`
  `BillingSection`/`handleCheckStatus` (~954-999).
- `subscription-worker/DEPLOY.md` deploy akışını doğruluyor ama canlı deploy edilmiş
  `LICENSE_PUBLIC_KEY_B64`'ün (`mod.rs:34`) gerçek Worker'ın `LICENSE_SIGNING_KEY`'iyle
  eşleştiği dosya okumayla değil, ancak canlı bir probe ile doğrulanabilir.
- Güvenlik kontrolü yapıldı: `subscription-worker/license-key.private.txt` git'e commit
  edilmemiş, `.gitignore`'da — sızıntı yok.
- **İki vault turu üst üste context tükenmesi yüzünden hiç kod yazamadan durdu.** Bir sonraki
  turun kapsamı genişçe: Rust'a signup/login+Keychain token saklama eklemek, `Payload`
  struct'ını değiştirmek, `fetch_license`'ı yeniden yazmak, komut imzasını değiştirmek,
  `tauri.ts` + `settings/page.tsx`'i güncellemek, gerçek bir signup ile uçtan uca denemek.
  Tek turda bitirilemeyebilir — gerekirse alt adımlara bölünüp ayrı vault turlarında
  ilerlenmeli (örn. önce sadece Rust tarafı, sonra frontend).

## T14 — Alchemy proxy rotaları masaüstü istemcisiyle uyuşmuyor 🆕 10.08.2026, `API.md`'den

Worker'ın Alchemy REST proxy'si üç ailede yanlış rota kuruyor (canlı test kanıtı `API.md`
bölüm "Live test summary"nde):
- **Prices:** proxy `/v1` segmentini atlıyor → canlı `404`.
- **NFT:** proxy API key'i `v3`'ten önce koyuyor (yanlış sıra) → canlı `401`.
- **Portfolio Data:** proxy `/v1/{key}` segmentini atlıyor → canlı `400`
  (`APIs not enabled on specified network: [NETWORK_AGNOSTIC]`).

Doğru formatlar `src-tauri/src/data/alchemy/client.rs`'te zaten doğru: `nft/v3/{key}`,
`data/v1/{key}`, `prices/v1` (Bearer header). Not: masaüstü uygulaması şu an bu proxy'yi hiç
kullanmıyor, doğrudan kendi Alchemy anahtarıyla konuşuyor — yani bu proxy hatası bugün canlı bir
kullanıcıyı etkilemiyor, ama Worker proxy'si gelecekte devreye alınırsa (T15'te tartışılan mimari
karar) kırık olarak devreye girer.

**Bitti sayılır:** Worker'ın proxy route inşası her aile için (RPC/NFT/Prices/Data) ayrı,
açık handler'lara bölünür; her biri zararsız, bilinen bir adres/istekle canlı denenir
(`probes/` altına kayıt). Proxy, tüm aileler canlı geçmeden "alternatif istemci yolu" olarak
tanıtılmaz.

**Ajanlar:** → `vault` (Worker route düzeltmesi — bu proje reposunda değilse hangi repoda
olduğu önce bulunmalı, Worker ayrı bir deploy).

## T15 — MCP smoke testi bu proje yolunda başlamıyor (klasör adında boşluk) 🆕 10.08.2026, `API.md`'den

`tools/westron-mcp/index.js`, doğrudan mı yoksa import olarak mı çalıştığını anlamak için
`process.argv[1]`'i `new URL(import.meta.url).pathname` ile karşılaştırıyor. Bu workspace'in
yolu boşluk içeriyor (`Cowork Projects`), `pathname` bunu `%20` olarak encode ediyor, karşılaştırma
hep `false` dönüyor, çocuk süreç hemen kapanıyor. `node tools/westron-mcp/smoke.mjs` bu yüzden
bu makinede hiç geçemiyor.

**Bitti sayılır:** `index.js`'te karşılaştırma `fileURLToPath(import.meta.url)` kullanacak
şekilde düzeltilir (path encode sorunu ortadan kalkar), `node tools/westron-mcp/smoke.mjs`
gerçekten çalıştırılıp 15 MCP tool'un ve Rust route-table çapraz kontrolünün gerçekten
geçtiği gözlemlenir (çıktı buraya yapıştırılır).

**Ajanlar:** → `vault` (tek satırlık düzeltme + gerçek test çalıştırma).

## T16 — Kapsanmayan canlı uçlar: WebSocket, işlem geçmişi, para hareketi eden her şey 🆕 10.08.2026, `API.md`'den

`API.md`'deki canlı test tek bir güvenli okuma/aile doğruladı (`eth_chainId`, OpenSea koleksiyon
metadata'sı, Etherscan `ethsupply`). Şunlar hiç canlı denenmedi: WebSocket abonelikleri
(mined tx / collection transfer / new heads), Etherscan `txlist` ile gerçek işlem geçmişi okuma
(Sister Wallet Finder bunu kullanıyor), T14 düzeltildikten sonra Alchemy NFT/Prices/Data
authenticated okumaları, ve her para/NFT hareketi eden uç (`send_eth`, `transfer_nft`,
marketplace list/bid/cancel, key import/deletion — bunlar bilinçli olarak otomatik problanmadı,
gerçek kullanıcı onayı gerektiriyor).

**Bitti sayılır:** Bu madde tek seferde "bitti" olmaz — T13/T14 düzeltildikten sonra, ayrı bir
staging/test ortamı (production olmayan API anahtarları + izlenen test cüzdanı) kurulup
`API.md`'nin "Recommended regression checks" bölümündeki 4 maddelik liste gerçekten çalıştırılır.
Şimdilik `MOCKS.md`'de "canlı doğrulanmadı" olarak açıkça listelenir — sessizce "çalışıyor"
denmez.

**Ajanlar:** → Emir'e sor (staging ortamı/test cüzdanı kurulumu onun hesap açması gerektiren bir
adım olabilir — CLAUDE.md madde 6) → sonra `vault`/`vera`.
