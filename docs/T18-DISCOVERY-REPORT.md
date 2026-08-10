# T18 — Faz 0 Keşif Raporu

**Tarih:** 11.08.2026 (ilk tur) + 11.08.2026 devam (boşluk kapatma turu)
**Durum:** Tamamlandı — kod değişikliği yok, sadece keşif. **Tüm alt görevler (W-0.1 — W-0.6)
artık tam kapsamlı, hiçbir madde "kısmi"/"bakılmadı" durumunda kalmadı.**
**Kaynak:** ilk turda üç paralel ajan (`scout` → W-0.1/0.2/0.3/0.5, `general-purpose`/
architect-rolü → W-0.4, `general-purpose` → W-0.6); ikinci turda dört ek `scout` ajanı ilk
turun bıraktığı boşlukları (imza zincirleri, tam IPC sınıflandırması, DB şeması, adres-türetme
sızıntı kontrolü) kapattı. Atama kararı `docs/TASKS.md`'deki orion ATAMA KARARI bölümündeki
gibi uygulandı.

Bu rapor T19'un (Keychain/Secure Enclave taşıması) başlangıç noktasıdır. Aşağıdaki her madde
ya doğrulanmış bir bulgu ya da açıkça işaretlenmiş bir boşluktur — "muhtemelen temiz" diye
sessizce geçilen hiçbir alan yok.

---

## W-0.1 — Anahtar dokunuş envanteri

**Durum: tamamlandı.**

`src-tauri/src/wallet/keychain.rs` zaten gerçek macOS Keychain kullanıyor — planın "anahtarlar
hâlâ düz metin `.key` dosyasına yazılıyor" varsayımı **güncel değil**. Bu, T19'un kapsamını
daraltıyor: sıfırdan bir Keychain taşıması değil, mevcut Keychain kod yolunun sertleştirilmesi
(Secure Enclave sarmalayıcı, biyometri ACL, migrasyon temizliği) gerekiyor. T19 metni bu
bulguya göre gözden geçirilmeli — bkz. aşağıdaki "T19'a etkisi".

## W-0.2 — İmza yolları haritası

**Durum: tamamlandı** (ikinci turda kapatıldı). Seaport list/bid/cancel ve genel tx imzalama
yolları ilk turda doğrulanmıştı. Kalan iki alan da artık tam izlendi:

- **Sniping engine:** `control/scheduler.rs:266-267` / `control/routes.rs:346-348`
  (`POST /snipe-check`) / `lib.rs:461-462` (`run_snipe_check` komutu) → hepsi
  `SniperEngine::check_snipe_rules` (`sniping/engine.rs:65-146`) → `execute_snipe`
  (`engine.rs:149-234`) çağırıyor. `execute_snipe` gerçekten **envelope gate'inden geçiyor**
  (`envelope_engine.check_and_authorize`, `engine.rs:189`) — atlama yok. Ama gate'ten sonra
  hiçbir signer'a ulaşılmıyor: `engine.rs:203-207` doğrudan
  `format!("0xSIMULATED_snipe_{}_{}", ...)` ile sahte hash üretiyor. `grep` doğrulaması:
  `sniping/` altında `Signer|private_key|sign(` sıfır eşleşme. **Sonuç: sniping hâlâ
  tamamen simülasyon — `MOCKS.md`'nin zaten belirttiği durumla tutarlı, ama şimdi kod
  seviyesinde doğrulandı.** CLAUDE.md'nin adını verdiği "simulated hash" deseni burada hâlâ
  canlı, henüz kırılmamış (kasıtlı olarak, README'ye göre).
- **Control server:** `src-tauri/src/control/{mod.rs,routes.rs,scheduler.rs,token.rs}` —
  loopback-only (127.0.0.1), Bearer-token korumalı Axum sunucusu. Rotaların hiçbiri
  (`/status`, `/portfolio`, `/floor`, `/rules*`, `/alerts*`, `/envelope`, `/kill-switch`,
  `/preview-transaction`, `/snipe-check`, `/scheduler`) doğrudan bir signer'a çağrı yapmıyor
  (grep doğrulaması: sıfır eşleşme). Para/imza ile teması olan tek iki rota:
  `/preview-transaction` (salt-okunur, harcama kaydetmiyor) ve `/snipe-check` (yukarıdaki
  sniping simülasyon duvarına giriyor). **Sonuç: control server'da envelope'u atlayan ayrı
  bir imzalama yolu yok — çünkü atlayacak bir imzalama eylemi zaten mevcut değil.**

## W-0.3 — IPC sınır denetimi

**Durum: tamamlandı** (ikinci turda kapatıldı). Tüm 87 `#[tauri::command]` (81 `lib.rs`, 3
`signing/mod.rs`, 3 `analytics/engine.rs`) tek tek okunup sınıflandırıldı:

- **Anahtar malzemesi alan/döndüren tek komut: `import_wallet`** (`lib.rs:142`) — raw
  `private_key_hex` alıyor, Keychain'e yazıyor, sadece türetilmiş **adresi** döndürüyor
  (key asla geri dönmüyor). Bu, IPC sınırından anahtar malzemesinin geçtiği tek ve doğru yön
  (içeri, dışarı değil).
- Anahtarı Keychain'den geri okuyan iki fonksiyon (`wallet::keychain::fetch_key`,
  `fetch_and_verify_key`) **hiçbiri `#[tauri::command]` değil** — sadece iç imzalama kodundan
  (`signing/mod.rs`, `marketplace/client.rs`) çağrılıyor, IPC'ye hiç çıkmıyor.
- Diğer 86 komutun hiçbirinin parametre/dönüş tipinde private key/mnemonic/seed/signing-key
  alanı yok (`grep -rniE "private_key|priv_key|mnemonic|seed_phrase|signing_key|secret_key"`
  → sadece `import_wallet`'ın iki satırı).
- `send_eth`/`transfer_nft` gibi imzalayan komutlar bile `wallet_address` + `api_key` alıyor,
  key'i asla parametre olarak almıyor — anahtar Keychain'den in-process olarak çekiliyor.
- Sınıra sadece not düşülen, ama private key kategorisinde OLMAYAN bir madde:
  `load_alchemy_key`/`load_opensea_key`/`load_etherscan_key` üçüncü-parti API key'lerini IPC
  üzerinden döndürüyor — bu önceki bir oturumda (`ba8dba7`) ayrı incelenip güvenli/kasıtlı
  bulunmuştu (Ayarlar ekranı kayıtlı key'i göstermek zorunda), burada tekrar açılmadı.

**Sonuç: IPC sınırında sızıntı yok, tek giriş noktası (`import_wallet`) doğru yönde
çalışıyor.**

## W-0.4 — `security-framework` crate yetenek doğrulaması

**Durum: tamamlandı.** Kontrol edilen sürüm: `security-framework` v3.7.0 (crates.io + docs.rs
üzerinden canlı doğrulandı).

Planın 4 gereksinimi de native crate API'sinde mevcut:

1. `SecAccessControl::create_with_flags` / `create_with_protection` — ACL oluşturma.
2. `security_framework::key::Token::SecureEnclave` — Secure Enclave'de EC anahtar üretimi
   (`GenerateKeyOptions::set_token`), sadece `KeyType::ec()` ile uyumlu (plan zaten
   secp256k1'i SE'de imzalamayacak şekilde tasarlanmış, bu doğru varsayımla örtüşüyor).
3. `SecKey::encrypt_data` / `decrypt_data` + `Algorithm` enum'ında 18 ECIES varyantı
   (`ECIESEncryptionStandardX963SHA256AESGCM` dahil) — Apple'ın `SecKeyAlgorithm`
   isimlendirmesiyle birebir.
4. Biyometri/user-presence ACL bayrakları (`kSecAccessControlBiometryCurrentSet`,
   `kSecAccessControlUserPresence`, `kSecAccessControlDevicePasscode`) —
   `security-framework-sys::access_control`'de, aynı crate ailesinde (ek bağımlılık yok).

**Tavsiye: native `security-framework` ile ilerlenmeli, FFI fallback (`objc2` + ham
`Security.framework` bağlama) gerekmiyor.** `keyring` crate'i burada yetersiz — Secure Enclave
key generation'ı desteklemiyor, sadece Keychain item saklama yapıyor.

**Risk notu (crate raporundan):** `create_with_flags` ile `create_with_protection`'dan hangisi
`kSecAccessControlBiometryCurrentSet | kSecAccessControlPrivateKeyUsage` kombinasyonunu doğru
kabul ediyor, docs.rs sayfası bunu net anlatmıyor. **T19 Faz 1'e başlarken bu ikisi arasındaki
seçim gerçek bir 20 satırlık probe scriptiyle (`probes/`) doğrulanmalı** — CLAUDE.md'nin "probe
before build" kuralı burada da geçerli, docs.rs okumak yeterli değil.

## W-0.5 — DB envanteri

**Durum: tamamlandı** (ikinci turda kapatıldı). `src-tauri/src/sniping/db.rs`: tek tablo
(`snipe_rules`), 12 kolon, tam şema doğrulandı (`id`, `collection_slug`, `target_price_eth`,
`max_quantity`, `wallet_address`, `active`, `created_at`, `triggered_count`, `expires_at`,
`max_total_spend_eth`, `spent_eth`, `deactivated_reason`). **Hiçbir kolon private key/mnemonic/
secret tutmuyor** — tek kimlik-benzeri alan `wallet_address` (public adres, zaten on-chain
görünür). DB dosyası `~/Library/Application Support/Westron/sniping.db`, düz `rusqlite` +
`bundled` (SQLCipher değil) — **plaintext SQLite at rest**, ama içinde saklanan verinin
hassaslık seviyesi düşük olduğu için bu W-0.5 kapsamında kritik değil (yine de genel "disk
üzerinde şifresiz veri" notu olarak T20+ için akılda tutulmalı).

## W-0.6 — Seaport 1.6 / OpenSea Conduit adres doğrulaması

**Durum: tamamlandı**, resmî kaynaklardan (Etherscan doğrulanmış kontrat sayfaları +
ProjectOpenSea/seaport GitHub discussion #580).

| Adres | Doğrulanan değer | Koddaki durum |
|---|---|---|
| Seaport 1.6 | `0x0000000000000068F116a894984e2DB1123eB395` | ✅ `seaport.rs:13`'teki `SEAPORT_1_6` sabitiyle eşleşiyor |
| OpenSea Conduit (20-byte adres) | `0x1E0049783F008A0085193E00003D00cd54003c71` | ❌ **kodda yok** — sadece `OPENSEA_CONDUIT_KEY` (32-byte conduit key) var, gerçek conduit adresi hiçbir sabitte tutulmuyor |

**T19/T20'ye etkisi:** allowlist/spend-cap seed'ine `OPENSEA_CONDUIT_ADDRESS` sabiti olarak
eklenmesi gerekiyor — kullanıcının `setApprovalForAll` verdiği asıl adres bu, conduit key değil.
Doğrulama kapsamı dışında ama not düşülen diğer sabitler (doğrulanmadı):
`OPENSEA_FEE_RECIPIENT`, `WETH_ADDRESS`.

---

## Beklenmeyen bulgu — üçlü adres türetme kopyası (plan dışı, scout tarafından bulundu, ikinci
turda kapatıldı)

W-0.1 taraması sırasında plan kapsamının dışında ama CLAUDE.md'nin kendi "tek doğruluk kaynağı"
kuralını ihlal eden bir durum ortaya çıktı: private-key→adres türetme mantığı **üç ayrı yerde**
kopyalanmış:

1. `src/lib/walletImport.ts` — asıl kaynak, kanonik `deriveAddress()`.
2. `src/app/page.tsx:484-487` — inline, viem'in `privateKeyToAddress()`'ini kullanıyor
   (kanonikten farklı fonksiyon ama kriptografik olarak eşdeğer sonuç veriyor), daha zayıf
   format doğrulaması.
3. `src/app/login/page.tsx:137-139` — inline, `privateKeyToAccount().address` kullanıyor
   (kanonikle birebir aynı çağrı), ama backend'in döndürdüğü otoriter adresi kullanmıyor,
   client-türetilmiş adresi kullanıyor.

**İkinci turda kapatıldı — sonuç: SAFE, sızıntı yok.** Üç konumun hepsi uçtan uca izlendi:
ham key materyali hiçbir yerde console'a loglanmıyor, `import_wallet`'ın meşru Tauri invoke'u
dışında hiçbir network çağrısına girmiyor, localStorage/sessionStorage'a yazılmıyor, ve
adres/görüntü alanına karışmıyor. **Kritik güvenlik ağı:** `lib.rs:143-168`'deki
`import_wallet` çağırandan gelen adrese asla güvenmiyor — private key'den her zaman yeniden
türetiyor, uyuşmazlıkta importu tamamen reddediyor (`Err("Address mismatch...")`) — bu, üç
farklı türetme kopyasının aynı fikirde olmadığı bir senaryoda bile yanlış adresin sessizce
kalıcılaşmasını yapısal olarak engelliyor.

**Hâlâ geçerli olan risk: kod tekrarı kendisi.** Üç kopya birbirinin byte-for-byte aynısı
değil — bugün kriptografik olarak eşdeğer sonuç veriyorlar ama yapısal olarak buna zorlanmış
değiller, sadece "şimdilik hemfikirler." T19 kapsamına konsolidasyon (`walletImport.ts`'e
indirgeme) eklenmeye devam ediyor — artık "acil güvenlik açığı" değil, "teknik borç / gelecekte
sapma riski" olarak.

---

## T19'a etkisi — plan güncellemesi gerekiyor

`docs/TASKS.md`'deki T19 metni "diskte hiçbir anahtar düz metin kalmasın" cümlesiyle bir
sıfırdan-taşıma senaryosu varsayıyordu. W-0.1 bunun artık doğru olmadığını gösterdi — birincil
yol zaten Keychain'de. T19'un gerçek kapsamı:

- Mevcut Keychain kod yolunun üzerine Secure Enclave sarmalayıcı eklemek (W-0.4'ün doğruladığı
  native API ile).
- Varsa kalıntı düz-metin `.key` dosyalarının doğrula-sonra-sil migrasyonu (plan zaten bunu
  öngörüyordu, hâlâ geçerli — sadece "tüm anahtarlar" değil "kalıntılar" için).
- Yeni bulunan üçlü adres-türetme kopyasının konsolidasyonu (teknik borç, güvenlik açığı değil
  — yukarıdaki bölüm).
- **Yeni kapsam notu (W-0.2'den):** sniping engine'in şu an hiçbir gerçek signer'a
  ulaşmadığı doğrulandı — tamamen `0xSIMULATED_` hash üreten bir iskelet. T19/T20/T21
  planlaması sniping'i "custody sertleştirilecek mevcut bir imzalama yolu" olarak değil,
  "henüz inşa edilmemiş özellik" olarak ele almalı; Keychain/Secure Enclave sertleştirmesi
  şu an gerçek para hareketi olan Seaport list/bid/cancel ve `send_eth`/`transfer_nft` yolları
  için anlamlı, sniping için henüz değil.

## Açık kalan boşluklar

Tüm keşif boşlukları kapatıldı. Geriye sadece T19 Faz 1'in kendi implementasyon adımı olan,
keşifle değil gerçek kodla kapatılabilecek tek madde kalıyor:

- [ ] `create_with_flags` vs `create_with_protection` — hangisi
      `kSecAccessControlBiometryCurrentSet | kSecAccessControlPrivateKeyUsage`
      kombinasyonunu doğru kabul ediyor, gerçek bir 20 satırlık probe scriptiyle
      (`probes/`) doğrulanmalı (W-0.4 risk notu). Bu bir kod-yazma adımı olduğu için T19
      Faz 1'in ilk alt görevi olarak ele alınmalı, T18 kapsamında değil.

T18'in kendisi artık tamamen kapalı — W-0.1 ile W-0.6 arası hiçbir madde "kısmi"/"bakılmadı"
durumunda değil.
