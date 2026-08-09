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
- ⚠️ **Monitor/collection detay — ekranda AÇILAMADI/görülemedi**, ortam kısıtı
  yüzünden (bkz. not aşağıda). Kod düzeyinde doğrulandı, ekranda değil.
- Gezilmeyen (kapsam dışı bırakıldı, düşük risk): settings, alerts/rules,
  gallery, bulk, sniping, login

**Ortam notu:** bu masaüstünde Accessibility izni yok, pencereler kararsız
öne geliyor. `orion` ekran otomasyonu sırasında bir tıklama yanlışlıkla
arka plandaki **gerçek** bir Chrome/OpenSea sekmesine gitti (canlı cüzdan
bağlı, bakiye görünür) ve sayfada navigasyon yaptı — hiçbir buton
tetiklenmedi, hiçbir işlem yapılmadı, `orion` riski görüp GUI tıklamayı
kendiliğinden durdurdu. Bir sonraki ekran-yürüme turunda: ya Accessibility
izni verilsin ya da test öncesi cüzdan bağlı diğer tarayıcı sekmeleri kapatılsın.

**Kalan iş:** monitor/collection ekranını fiilen açıp WETH rakamını gözle
doğrulamak. **Ajan:** `vera` (daha güvenli/hedefli bir yöntemle, örn. doğrudan
URL navigasyonu).

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
b. **Kendine gönderim tutarsız** — cüzdan detayında uyarı, Distribute modalında
   hedef listesi kaynağı hiç göstermiyor. → `orion` (ne olmalı) → `forge`
c. **Zarf ön-düşümü** — `send_eth` önce limiti düşürüp sonra yayınlıyor; yayın
   başarısız olursa limit düşmüş ama işlem olmamış olur. → `vault`
d. **main'den gelen tip hataları** — `src/app/sentiment/*` örtük `any`,
   `formatters.test.ts` için `@types/jest` eksik. → `forge`

---

## T7 — MCP kaydı ve telefondan deneme
`tools/westron-mcp/standalone.mjs` commit'lendi ama Claude desktop'a kaydedilmedi.
Yönerge: `FAZ1-DEMO.md`.

**Ajanlar:** `vault` (shim'i doğrula, kayıt adımlarını çalıştır) → `vera`

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
