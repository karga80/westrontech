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
| Runtime | macOS native wrapper — Electron veya Tauri (karar bekleniyor) |
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

## Açık Teknik Kararlar (çözüm bekliyor)

**Transaction signing / confirmation sorunu:**
Dokümanda not düşülmüş: her transaction için kullanıcı onayı istemek sniping ve scheduled task'larda imkânsız. Atlas bu konuda bir mimari öneri geliştirmeli — spend cap + pre-authorization modeli veya session-level signing yetkilendirmesi gibi seçenekler değerlendirilmeli. Bu karar Emir onayına sunulacak.

**Electron vs Tauri:**
macOS wrapper seçimi henüz kesinleşmemiş. Atlas tradeoff analizi yapacak.

## Güvenlik Kuralları (Değiştirilemez)

- Private key'ler hiçbir zaman sunucuya iletilmez
- macOS Keychain veya encrypted local storage kullanılır
- Tüm transaction'lar local olarak sign edilip broadcast edilir
- Wallet adresleri dışında hiçbir kullanıcı verisi dışarıya çıkmaz
- Her finansal veya irreversible aksiyon için guard mekanizması zorunludur
- Spend cap ve safety limit'ler default olarak uygulanır

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
