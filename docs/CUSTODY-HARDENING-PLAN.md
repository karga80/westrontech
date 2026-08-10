# Westron — Custody Sertleştirme Uygulama Planı

*10 Ağustos 2026 · Girdi: `westron-custody-karari-2026-08.md` · Hedef repo: github.com/karga80/westrontech (birleşik dal, merge commit `c8ddc71` sonrası)*
*Format: her faz kendi başına yeni bir oturumda/background agent'ta çalıştırılabilir. Repo kuralı: kod Claude yazar, commit'i Emir atar.*

---

## Yol haritası özeti

| Faz | Ne | Neden bu sırada | Büyüklük |
|---|---|---|---|
| **0** | Keşif ve doğrulama | Plan dokümanları koddan sapmış olabilir; adresler/API'ler doğrulanmalı | S |
| **1** | Keychain taşıması + bellek hijyeni | **Launch-blocker.** Bitmeden gerçek anahtarla beta yok | M |
| **2** | Envelope sertleştirme (kalıcılık + allowlist + rolling limit) | Mevcut Faz 2 borcuyla (envelope persistence) birleşiyor | M |
| **3** | Vault/Agent ayrımı + batch imza oturumu | Sniping feature flag'i açılmadan **önce** bitmeli | L |
| **4** | Uçtan uca doğrulama + audit hazırlığı | Denetçi mimariyi değil implementasyonu denetlesin | S |

Bağımlılık: 1 → 2 → 3 → 4. Faz 2 ve 3'ün bazı taskleri paralelleştirilebilir (aşağıda işaretli).

---

## FAZ 0 — Keşif ve Doğrulama (her şeyden önce)

Amaç: plan koda değil, kod plana uydurulmasın. Bu fazın çıktısı bir keşif raporu; kod değişikliği YOK.

- [ ] **W-0.1 — Anahtar dokunuş envanteri.** `rg` ile tara: `keys/`, `fs::write`, `.key`, `private_key`, `secret` geçen tüm noktalar (`src-tauri/src/` tamamı). Her bulgu için: dosya:satır, ne okunuyor/yazılıyor, hangi fonksiyon çağırıyor. Özellikle `wallet/keychain.rs`'in gerçek API yüzeyini (fonksiyon imzaları) çıkar — sonraki fazlar bu imzaları koruyarak içini değiştirecek.
- [ ] **W-0.2 — İmza yolları haritası.** Private key ile imza atan HER yol: Seaport list/bid/cancel (opensea modülü), tx imzalama, sniping engine, control server endpoint'leri. Subscription'ın Ed25519 lisans anahtarı AYRI — bu plana dahil değil, karıştırma.
- [ ] **W-0.3 — IPC sınır denetimi.** Tüm `#[tauri::command]` fonksiyonlarını tara: hangileri anahtar/mnemonic **döndürüyor** veya frontend'den **alıyor**? Import akışı dışında key taşıyan command varsa listele (bunlar Faz 1'de kapatılacak). Dal birleştirme dokümanındaki "viem ile frontend'de türetme" olayının kalıntısı var mı kontrol et.
- [ ] **W-0.4 — Crate yetenek doğrulaması.** `security-framework` crate'inin güncel sürümünde şunlar VAR MI, docs.rs'ten doğrula: `SecAccessControl` oluşturma, `kSecAttrTokenIDSecureEnclave` ile anahtar üretimi, `SecKeyCreateEncryptedData`/`DecryptedData` (ECIES). Eksikse alternatif belirle (objc2 + raw FFI, veya `keyring` crate'i sadece basit saklama için + ayrı SE sarmalayıcı). **Bu task'in çıktısı Faz 1'in teknik seçimini belirler — varsayma, doğrula.**
- [ ] **W-0.5 — DB envanteri.** Mevcut SQLite dosyaları ve şemaları (alerts, sniping, pnl). Envelope ve allowlist tablolarının hangisine ekleneceğine ya da yeni `security.db` açılacağına karar ver (öneri: sniping DB'si zaten guardrail kolonları taşıyor — oraya değil, ayrı `security.db`).
- [ ] **W-0.6 — Adres doğrulaması.** Seaport 1.6 kontrat adresi ve OpenSea conduit adresini **resmî OpenSea/Seaport dokümantasyonundan** çek (Faz 2 allowlist seed'i için). Hafızadan/eski nottan adres alma.

**Doğrulama:** Keşif raporu; W-0.1'de sıfır bulgu çıkarsa (imkânsız — plaintext dosyalar biliniyor) arama deseni yanlıştır, tekrar tara.

---

## FAZ 1 — Keychain Taşıması (LAUNCH-BLOCKER)

Amaç: diskte hiçbir anahtar düz metin kalmasın; kök anahtar erişimi Touch ID'ye bağlansın; anahtar asla webview'a geçmesin.

### Çekirdek

- [ ] **W-1.1 — `keystore` modülü.** `src-tauri/src/keystore/mod.rs` yeni modül. API: `store_key(id, secret) / load_key(id) -> Zeroizing<Vec<u8>> / delete_key(id) / list_key_ids()`. Altta macOS Keychain (`kSecClassGenericPassword`, service `"com.westron.wallet"`, account = cüzdan adresi). `kSecAttrSynchronizable` KAPALI (anahtar iCloud'a senkronlanmaz — cihaz-yerel).
- [ ] **W-1.2 — Secure Enclave sarmalayıcı.** SE'de P-256 anahtar üret (`kSecAttrTokenIDSecureEnclave` + `kSecAccessControlBiometryCurrentSet` ACL). secp256k1 anahtar blob'unu bu SE anahtarıyla ECIES şifrele (`SecKeyCreateEncryptedData`), Keychain'e **şifreli** blob yaz. Decrypt anında macOS Touch ID prompt'unu otomatik tetikler. **SE'de secp256k1 İMZALAMAYA ÇALIŞMA — SE sadece P-256 destekler; desen "SE ile şifrele, bellekte imzala"dır.**
- [ ] **W-1.3 — Fallback zinciri.** Touch ID yoksa (harici klavye/clamshell, eski Mac): `BiometryCurrentSet` başarısızsa `kSecAccessControlUserPresence` (parola) ile ikinci deneme. Hiçbiri yoksa: kullanıcıya açık uyarı + yalnız-Keychain modu (şifreli ama biyometrisiz). Hangi modda çalışıldığı Settings'te görünür.
- [ ] **W-1.4 — Migrasyon.** İlk açılışta: `~/Library/Application Support/Westron/keys/*.key` dosyalarını oku → keystore'a import et → **her import'u geri-okuma ile doğrula** → doğrulanan dosyanın içeriğini sıfırla (overwrite) ve sil → migration marker yaz. Kural: **doğrulama geçmeden asla silme.** Kısmi başarıda kalan dosyaları bırak, kullanıcıya söyle. (APFS'te overwrite'ın best-effort olduğunu kod yorumuna not düş.)
- [ ] **W-1.5 — API anahtarları da Keychain'e.** Alchemy/OpenSea/Etherscan/Discord/Telegram anahtarları: aynı keystore, ayrı service (`"com.westron.apikeys"`), **biyometri ACL'siz** (her API çağrısında Touch ID istenmez). Aynı migrasyon deseni.

### Hijyen

- [ ] **W-1.6 — Bellek hijyeni.** `zeroize` crate: anahtar taşıyan tüm tipler `Zeroizing<>`; imza fonksiyonları çıkışta sıfırlar. Key tiplerine `Debug`/`Display` maskesi (`"0x****"`). Log denetimi: `rg` ile key değişkenlerinin log makrolarına girdiği yer sıfır olmalı.
- [ ] **W-1.7 — IPC kuralı kalıcılaştırma.** W-0.3'te bulunan key döndüren command'lar kapatılır. Import command'ı yazma-yalnız kalır (frontend'den alır, asla geri vermez). Adres türetme backend'de (mevcut davranış korunur). `CLAUDE.md`/`TESTING.md`'ye kural olarak yazılır: *"Anahtar malzemesi IPC sınırını yalnızca import yönünde geçer."*

### Test

- [ ] **W-1.8 — Testler.** (a) keystore roundtrip (CI'da gerçek Keychain yok → `MockKeystore` feature flag'i; gerçek Keychain testi Emir'in Mac'inde manuel), (b) migrasyon: sahte `keys/` dizini → import → doğrula → dosyalar silinmiş, (c) migrasyon yarıda kesilme: doğrulanmamış dosya silinmemiş, (d) Debug çıktısında ham anahtar yok.

**Faz kabul kriteri:** `~/Library/Application Support/Westron/keys/` dizini migrasyondan sonra boş; `rg "fs::write"` key path'lerinde sıfır sonuç; 38 mevcut test + yeni testler geçiyor; Emir'in Mac'inde Touch ID prompt'u gerçek imzada tetikleniyor.

---

## FAZ 2 — Envelope Sertleştirme

Amaç: envelope tek boyutlu tutar limitinden, kalıcı ve çok boyutlu bir politika motoruna. (W-2.1 mevcut "envelope persistence Faz 2 borcu" ile aynı iş.)

- [ ] **W-2.1 — Kalıcılık.** `security.db` (yeni SQLite): `envelopes` tablosu (id, cap, spent, ttl, created_at, killed). Restart'ta yükle; TTL ve harcanan tutar korunur. Kill switch durumu da persist (`killed` flag).
- [ ] **W-2.2 — İmza kapısı (signing gateway).** TEK zorunlu geçiş noktası: `src-tauri/src/keystore/gateway.rs`. Her imza isteği buradan geçer → envelope kontrolü + (W-2.3) allowlist + (W-2.4) rolling limit + (W-2.5) eşik kontrolü. **Politika kontrolü UI'da veya çağıran modülde DEĞİL, sadece burada.** W-0.2'deki tüm imza yolları bu kapıya yönlendirilir — kapıyı bypass eden imza fonksiyonu `pub` olmaktan çıkarılır.
- [ ] **W-2.3 — Allowlist'ler.** `allowed_contracts` (seed: W-0.6'daki doğrulanmış Seaport + conduit adresleri) ve `allowed_recipients` tabloları. Kural: agent imzaları yalnız allowlist'teki kontratlara call yapabilir; transfer alıcısı yalnız `allowed_recipients`'ta olabilir (varsayılan: sadece kullanıcının vault adresleri). Allowlist'e ekleme = Touch ID'li işlem.
- [ ] **W-2.4 — Rolling 24h çıkış limiti.** `outflows` tablosu (ts, amount_wei, tx_hash). Gateway her imza öncesi son 24 saatin toplamını hesaplar; `daily_outflow_cap` aşılıyorsa red + `deactivated_reason` desenine uygun kayıt.
- [ ] **W-2.5 — Eşik üstü Touch ID.** Envelope'a `touchid_threshold_wei` alanı: üstündeki tek işlem, agent yolu bile olsa vault-tarzı biyometrik onay ister (macOS bildirimi + app'te onay ekranı; onaysız timeout = red).
- [ ] **W-2.6 — Kontrol sunucusu + MCP yüzeyi.** `/envelope` endpoint'leri ve `westron_create_envelope` tool'u yeni alanları (daily cap, threshold, allowlist özeti) döndürür/kabul eder. Tool açıklamaları güncellenir.
- [ ] **W-2.7 — Testler.** Her guardrail için: geçen istek, reddedilen istek, **bypass denemesi** (gateway dışı imza fonksiyonu çağrısı derlenmemeli/erişilememeli), restart sonrası state korunumu, 24h pencere sınır durumları (23:59 vs 24:01).

**Faz kabul kriteri:** App restart → envelope + kill switch + harcanan tutar aynen duruyor; allowlist dışı kontrata imza isteği gateway'de reddediliyor ve audit log'a düşüyor.

---

## FAZ 3 — Vault/Agent Ayrımı

Amaç: otomasyon kök anahtarla değil, izole ve limitli bir çalışma cüzdanıyla imzalar. Kök anahtar yalnız Touch ID'li oturumlarda kullanılır.

### Model

- [ ] **W-3.1 — Şema.** Cüzdan kaydına `role` alanı: `vault` | `agent` | `watch` (mevcut watch-only korunur). Migrasyon: mevcut tüm import'lu cüzdanlar → `vault`. (Cüzdan listesi bugün `localStorage`'ta — role bilgisi backend'de otoriter tutulacak şekilde `security.db`'ye taşınır; frontend cache olarak kalabilir.)
- [ ] **W-3.2 — Agent cüzdan üretimi.** Rust'ta keygen → keystore'a **biyometrisiz** kayıt (agent'ın amacı gözetimsiz imza) ama **envelope'a zorunlu bağlı**: envelope'suz agent cüzdanı imzalayamaz (gateway kuralı). UI: Wallets ekranına "Create agent wallet" + rolün ne olduğu açıklaması ("harcanabilir çalışma sermayesi — kasa değil").
- [ ] **W-3.3 — Fonlama akışı.** UI'da vault → agent transfer (Touch ID'li vault imzası). Agent bakiyesi Dashboard/Wallets'ta ayrı gösterilir; "agent'ta ne varsa risktedir" metni.
- [ ] **W-3.4 — Rol zorlaması (gateway'de).** Sniping engine, scheduler ve control server'ın imza gerektiren TÜM endpoint'leri gateway'e `role: agent` kısıtıyla gider. Vault anahtarıyla otomasyon imzası **kod seviyesinde imkânsız** (config değil: gateway fonksiyon imzası `sign_as_agent(...)` / `sign_as_vault_session(...)` ayrımıyla).
- [ ] **W-3.5 — Vault batch imza oturumu.** Tek Touch ID → kısa süreli unlock oturumu (öneri: 120 sn VE maks N imza, ikisi de ayarlanabilir) → bu pencerede Seaport bulk list/cancel imzaları → süre/adet dolunca anahtar zeroize. Bulk ekranları (`bulk/list`, gallery çoklu seçim) bu oturumu kullanır. UX: "50 listing için 1 dokunuş" — süre sayacı görünür.
- [ ] **W-3.6 — Agent yedeği.** Agent key export akışı (Touch ID'li, tek seferlik gösterim, panoya kopyalama uyarısı) + onboarding metni: agent = working capital.
- [ ] **W-3.7 — MCP shim güncellemesi.** `tools/westron-mcp`: tool açıklamalarına "agent cüzdanıyla çalışır, vault'a erişemez" ibaresi; `westron_status` role ve agent bakiye bilgisi döndürür; vault gerektiren bir istek gelirse anlaşılır hata ("Bu işlem kasa onayı gerektirir — uygulamadan Touch ID ile yapın").
- [ ] **W-3.8 — Testler.** (a) agent tool'u vault anahtarıyla imza isteyemiyor (derleme/tip seviyesinde), (b) envelope'suz agent → red, (c) batch oturumu süre aşımında zeroize + sonraki imza reddi, (d) migrasyon: mevcut cüzdanlar vault oldu, davranış değişmedi.

**Faz kabul kriteri:** Sniping simülasyonu yalnız agent cüzdanıyla tetikleniyor; vault imzası yalnız Touch ID oturumunda mümkün; MCP'den vault'a dokunan hiçbir yol yok. **Sniping feature flag'i bu faz bitmeden AÇILMAZ.**

---

## FAZ 4 — Uçtan Uca Doğrulama + Audit Hazırlığı

- [ ] **W-4.1 — "Malware testi" otomasyonu.** Test: app data dizininin tamamını tara — bilinen test anahtarının ham/hex/base64 hali HİÇBİR dosyada geçmiyor (localStorage, SQLite, log dosyaları dahil). CI'a eklenir; her PR'da koşar.
- [ ] **W-4.2 — Tam regresyon.** `cargo test` (mevcut 38 + tüm yeni testler) + `npm run dev:tauri` derleme + MCP smoke testi (mevcut 28'lik desen yeni tool imzalarıyla güncellenir).
- [ ] **W-4.3 — Threat model dokümanı.** "Mac'e malware girdi" senaryosu üç durumda (bugün / Faz 1 sonrası / Faz 3 sonrası) yazılı hale getirilir; audit firmasına verilecek kapsam brief'i buradan çıkar (kapsam: keystore, gateway, envelope, batch oturumu, MCP yüzeyi).
- [ ] **W-4.4 — TESTING.md + manuel QA listesi.** Emir'in Mac'inde koşulacak Touch ID akışları: import, ilk migrasyon, batch listing oturumu, agent oluşturma/fonlama, kill switch, eşik üstü onay, fallback modu (Touch ID kapalıyken).

**Emir'in işleri (kod dışı):** her faz sonunda commit; W-1.8/W-4.4 manuel Touch ID testleri gerçek Mac'te; audit firması seçimi ve W-4.3 brief'iyle anlaşma; launch öncesi audit bulgularının kapatılması.

---

## Anti-pattern korumaları (her fazın yürütücüsü için)

- ❌ **SE'de secp256k1 imzalamaya çalışma.** Secure Enclave yalnız P-256. Desen: SE ile şifrele, bellekte imzala, zeroize et.
- ❌ **`security-framework` API'sini varsayma.** W-0.4 doğrulamadan Faz 1'e başlama. Eksikse FFI planına geç.
- ❌ **Kontrat adresini hafızadan yazma.** Seaport/conduit adresleri yalnız W-0.6'daki resmî kaynaktan.
- ❌ **Migrasyonda doğrulamadan silme.** Geri-okuma doğrulaması geçmeyen dosya asla silinmez.
- ❌ **`kSecAttrSynchronizable` açma.** Anahtar iCloud Keychain'e senkronlanmaz — cihaz-yerel kalır.
- ❌ **Politika kontrolünü gateway dışına yazma.** UI'da, çağıran modülde, MCP shim'de envelope/allowlist kontrolü YAPILMAZ — tek nokta gateway.
- ❌ **Agent'a biyometri ACL koyma.** Agent'ın varlık sebebi gözetimsiz imza; güvenliği ACL değil envelope + allowlist + izolasyon.
- ❌ **API key'lere biyometri ACL koyma.** Her Alchemy çağrısında Touch ID = kullanılamaz ürün.
- ❌ **Subscription'ın Ed25519 anahtarını bu kapsama katma.** O lisans doğrulama anahtarı, cüzdan anahtarı değil.
- ❌ **Sniping flag'ini Faz 3'ten önce açma.**

---

## Sıradaki adım

Faz 0'ı başlat: repo'ya erişimi olan bir oturuma (background agent veya Mac'te Claude Code) bu dokümanın FAZ 0 bölümünü brief olarak ver. Çıktı keşif raporu → Faz 1 brief'i o rapora göre kesinleşir.
