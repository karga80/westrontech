# Westron — CLAUDE.md
# Syndicate Proje Anayasası
# ─────────────────────────────────────────────────────────────────────────

## Proje Özeti

Westron, Ethereum yatırımcıları ve NFT trader'ları için geliştirilmekte olan native macOS uygulamasıdır. Portfolio takibi, NFT galerisi, bulk trading, analytics/PnL, gerçek zamanlı alert'ler ve sniping/otomasyon özelliklerini tek bir masaüstü deneyiminde birleştirir. Rakiplerinden temel farkı: wallet private key'leri kullanıcının makinesinde şifreli olarak saklanır, hiçbir zaman sunucuya iletilmez. Subscription tabanlı dağıtım modeli — NFT pass veya whitelist yok.

## Mevcut Durum

**Phase 1 — Build & Test (aktif)**
- Core app mimarisi ve macOS wrapper
- Wallet import ve local key storage
- Portfolio tracking ve NFT gallery (read-only)
- Analytics & PnL engine
- Internal testing

**Phase 2 (sıradaki):** Bulk actions, alerts, sniping, subscription billing, public beta

## Kullanıcı Tipleri

| Tip | Tanım |
|-----|-------|
| Active NFT Traders | OpenSea, Blur, MagicEden'de alım/satım yapanlar |
| Portfolio Investors | Çoklu wallet takip eden ETH yatırımcıları |
| Alpha Hunters | Gerçek zamanlı floor data ve snipe ihtiyacı olanlar |
| Collectors | NFT koleksiyonunu organize görüntülemek isteyenler |

## Stack

| Katman | Teknoloji |
|--------|-----------|
| Frontend | Next.js (React) |
| Runtime | **Tauri** (karar verildi ve uygulandı — Rust backend + Next.js static export) |
| Package Manager | npm |
| Blockchain Data | ETH RPC — Alchemy / Infura + indexing API'leri |
| Local Storage | Encrypted local DB + macOS Keychain (key material için) |
| Dev Environment | macOS — localhost:3000 |
| Chain Scope | Ethereum Mainnet exclusively (v1) |
| Marketplace | OpenSea, Blur, MagicEden |

## Core Features (v1)

1. **Portfolio & Wallet Tracking** — çoklu wallet, ETH + ERC-20 bakiyeler, history
2. **NFT Gallery** — ERC-721/1155, metadata, floor/PnL görünümü
3. **Bulk Actions** — list, cancel, sweep, bid — local signing
4. **Analytics & PnL** — realized/unrealized PnL, gas tracking, heatmap
5. **Alerts & Monitoring** — floor, wallet activity, portfolio value — macOS notif + Discord webhook
6. **Sniping & Automation** — floor/trait sniper, scheduled sweeps, automation rules engine

## Çözülmüş Teknik Kararlar

**Transaction signing / confirmation — ÇÖZÜLDÜ: harcama zarfı (envelope) modeli.**
Her işlem için kullanıcı onayı istemek sniping ve zamanlanmış görevlerde imkânsızdı.
Çözüm: kullanıcı önceden bir zarf tanımlar — tek işlem tavanı, toplam harcama sınırı,
izinli adres kapsamı ve süre. Zarf içinde kalan işlemler onay istemeden imzalanır;
dışına çıkan reddedilir. Kill switch her şeyi anında durdurur. Tüm kararlar
`audit/*.jsonl` dosyasına yazılır.

Uygulama: `src-tauri/src/envelope/`. Saf `evaluate()` fonksiyonu hem yan etkisiz
`preview_transaction`'ı hem de harcamayı işleyen `check_and_authorize`'ı besler —
kural ayrışması yapısal olarak imkânsız.

**Electron vs Tauri — ÇÖZÜLDÜ: Tauri.**

## Güvenlik Kuralları (Değiştirilemez)

- Private key'ler hiçbir zaman sunucuya iletilmez
- macOS Keychain veya encrypted local storage kullanılır
- Tüm transaction'lar local olarak sign edilip broadcast edilir
- Wallet adresleri dışında hiçbir kullanıcı verisi dışarıya çıkmaz
- Her finansal veya irreversible aksiyon için guard mekanizması zorunludur
- Spend cap ve safety limit'ler default olarak uygulanır
- **Adres asla çağırandan alınmaz.** Cüzdan kimliği private key'den türetilir
  (`import_wallet` → `PrivateKeySigner`). Frontend'den gelen adres yalnızca bir
  iddiadır ve eşleşmezse işlem reddedilir. Gerekçe: 09.08.2026'da dashboard'daki
  Add Wallet modalı private key'i adres alanına yazıyordu; key düz metin
  localStorage'a gidiyor ve Alchemy'ye adres parametresi olarak gönderiliyordu.
- **Private key hiçbir ekranda, logda veya adres alanında görünmez.**
  `walletStore.loadWallets()` adres alanı 64-hex olan kaydı okurken siler ve uyarır.

## Dürüstlük Kuralları (Değiştirilemez — 09.08.2026'da kanla yazıldı)

Bu kurallar bir stil tercihi değil. İhlal edildiklerinde kullanıcı parasını
kaybeder ya da kaybettiğini sanır.

1. **Ekran, olmayan veriyi uydurmaz.** Veri yoksa `—` yazılır, boş durum gösterilir.
   Placeholder rakam (`$12,847.32`, `+%28.4`), sahte floor fiyatı, örnek cüzdan
   listesi yasaktır. Demo görüntüsü gerekiyorsa açıkça "örnek veri" etiketlenir.

2. **Hiçbir ekran gerçekleşmemiş bir işlemi gerçekleşmiş gibi göstermez.**
   "Confirmed", "Broadcast", "Sent" yazıları yalnızca gerçek bir zincir yanıtından
   gelir. `setTimeout` ile ilerleyen sahte durum göstergesi yasaktır. Bir özellik
   henüz bağlanmadıysa ekran bunu açıkça söyler ("Not sent — bu sürümde etkin değil").

3. **Sessiz başarısızlık yasak.** Bir düğme çalışmıyorsa nedenini söyler.
   Koşul sağlanmadığı için `return` eden bir handler, kullanıcıya hangi koşulun
   eksik olduğunu göstermek zorundadır.

4. **"Hata" ile "kayıt yok" aynı şey değildir.** Boş sonuç `Ok(vec![])` döner,
   `Err` değil. Kullanıcıya "yüklenemedi" demek, aslında gösterilecek bir şey
   olmadığında yanlış bilgidir.

## Kod Kuralları (Westron'a özel)

**Rust — `src-tauri/`**
- Cüzdan kimliği private key'den türetilir (`PrivateKeySigner` → `address()`).
  Çağırandan gelen adres yalnızca bir iddiadır; eşleşmezse işlem reddedilir.
- Private key loglanmaz, komuttan dönmez, dosyaya yazılmaz, hata mesajına girmez.
- Keychain hesapları küçük harfle anahtarlanır. Adresin iki geçerli yazımı var ve
  birebir eşleşme yanlış yazımda imzalama anında "key not found" ile patlar.
- Para hareket eden her yol zarftan geçer. `evaluate()` hem yan etkisiz
  `preview_transaction`'ı hem de bütçe düşen `check_and_authorize`'ı besleyen tek
  saf fonksiyondur — ikisinin ayrışmasına asla izin verilmez.
- Aynı adresten gönderimler **sıralıdır**. Eşzamanlı iki gönderim aynı nonce'u okur
  ve ikincisi birincinin yerine geçer; kullanıcı iki transfer sanır, biri hiç olmaz.
- Boş sonuç `Ok(vec![])` döner, `Err` değil.

**Frontend — `src/`**
- `src/lib/tauri.ts` Rust'a tek köprüdür; `invoke` başka yerde çağrılmaz.
- Adres `import_wallet`'tan geri gelir; kullanıcı yazmaz, key alanından alınmaz.
  Tek doğruluk kaynağı `src/lib/walletImport.ts`.
- Tutarlar BigInt ile hesaplanır. `parseFloat('0.1') * 1e18` doğru sonuç vermez —
  `parseEthToWei` (`src/lib/distribute.ts`) kullanılır.
- Hata mesajları kullanıcının anlayacağı dilde yazılır. `explainSendError` istenen
  tonu gösteriyor: "out_of_scope" değil, "bu adres zarfın kapsamında değil".
- Yeni bir ekran yazmadan önce aynı işi yapan başka ekran var mı diye bakılır.
  Bu repo defalarca aynı akışın iki üç sürümünü büyütüp birbirinden ayırdı.

## Doğrulama Zorunluluğu

**Testlerin geçmesi ekranın çalıştığı anlamına gelmez.** 09.08.2026'da 86/86 test
geçerken iki kritik hata canlıydı: private key'in adres sanılması (form alanlarının
bağlanmasındaydı) ve Distribute ekranının sahte "Confirmed" göstermesi (bir
`setTimeout`'taydı). Hiçbir test bu ikisine bakmıyordu.

Bir iş "bitti" sayılmadan önce:
- `cargo test` + `cargo check` + `tsc --noEmit` temiz olmalı (gerekli ama yeterli değil)
- Para veya key'e dokunan her değişiklik **çalışan uygulamada** denenmeli
- İddia edilen her davranışın gözlemlenebilir bir kanıtı olmalı: tx hash, audit log
  kaydı, `spent_wei` değişimi, Keychain kaydı. "Kod doğru görünüyor" kanıt değildir.
- Doğrulanamayan şeyler **doğrulanmadı diye açıkça yazılır**. Sessizce "tamam"
  denmez.

## Rekabet Bağlamı

| Rakip | Tipi | Westron Farkı |
|-------|------|---------------|
| Tokun | Web app, NFT pass | Browser-based, NFT pass zorunlu, native değil |
| Blur | Web marketplace | Sadece marketplace, portfolio/analytics yok |
| Zapper | Web portfolio | Read-only, trading yok |
| NFTNerds | Web analytics | Sadece analytics, automation yok |

## Subscription Modeli

- **Monthly:** Rolling abonelik, tüm v1 özellikler
- **Annual:** İndirimli yıllık
- **Trial:** TBD — free trial veya limited read-only
- **Enterprise:** Gelecek faz

Fiyatlandırma TBD — launch öncesi netleşecek.

## Agent Rolleri (Bu Projede)

- **Nova:** Orkestratör — brief alır, dağıtır, Task Ledger'ı yönetir
- **Orion:** Product — user story, PRD, feature önceliklendirme
- **Iris:** Design Lead — Pixel ve Sage koordinasyonu, design system
- **Atlas:** Dev Lead — macOS wrapper kararı, mimari, Forge/Vault/Shift koordinasyonu
- **Pixel:** UI/UX — Penpot design'larından component'lere
- **Forge:** Frontend — Next.js/React implementasyonu
- **Vault:** Backend — ETH API entegrasyonu, local DB, Keychain
- **Vera:** QA — hem design hem code test
- **Scout:** Research — ETH API provider karşılaştırması, marketplace API araştırması
- **Shift:** Mobile — v1 scope dışı, Phase 4'te değerlendirilecek
- **Rex / Echo / Sage:** Phase 2 launch öncesi devreye girecek

## Başarı Kriterleri (Phase 1)

- [ ] macOS wrapper seçimi ve temel app mimarisi tamamlandı
- [ ] Wallet import + local key storage güvenli çalışıyor
- [ ] Portfolio tracking ve NFT gallery read-only render ediyor
- [ ] Analytics & PnL engine hesaplamaları doğru
- [ ] Internal test geçildi, kritik bug yok
- [ ] Transaction signing / confirmation mimarisi kararlaştırıldı

## Kısıtlar

- **Chain:** Sadece Ethereum Mainnet — Solana ve diğer chain'ler v1 dışı
- **Platform:** Sadece macOS — web veya mobile v1 dışı
- **Güvenlik:** Private key'lerin dışarı çıkması kabul edilemez, mimari bunu engellemeye göre kurulur
- **Kalite:** Native macOS kalite standardı — web-app estetiği veya yavaş performans kabul edilemez

## Özel Notlar

- Tasarımlar `westron.pen` (Penpot) formatında Desktop'ta mevcut — Pixel handoff için Penpot'tan export gerekecek
- Transaction onay mimarisi (sniping için) açık ve kritik bir teknik karar — Atlas önce bunu çözmeli
- "ETH-first, deep over wide" prensibi — multi-chain için feature eklenmeyecek
- Kullanıcı her zaman kendi key'inin kontrolünde olmalı

## Zorunlu Kurallar (Fleet Geneli)

- `.env` dosyasını asla okuma veya değiştirme
- Production'a Emir onayı olmadan deploy etme
- Task-ID olmadan teslim bildirimi gönderme
- Devir notu olmadan göreve başlama
- Her önemli kararı gerekçesiyle birlikte sun

# ─────────────────────────────────────────────────────────────────────────
# Task Ledger: .claude/memory/tasks/westron.md
# Client Profile: .claude/memory/client-profiles/ (TBD)
# Bu dosya Nova tarafından oluşturulmuş, Emir tarafından onaylanmıştır.
