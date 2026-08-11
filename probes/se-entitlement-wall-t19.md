# T19 probe — kalıcı Secure Enclave anahtarının gerçek engeli (entitlement duvarı)

**Tarih:** 2026-08-11
**Makine:** Apple Silicon (Mac15,6), macOS 26/27, gerçek donanım — Touch ID mevcut.
**Kod:** `src-tauri/examples/se_filekeychain_probe.rs`
**Statü:** üç deney de gerçekten çalıştırıldı, çıktılar aşağıda düzenlenmemiş hâliyle.

## Sorulan soru

`keystore/mac.rs`'in `-34018 errSecMissingEntitlement` ile duvara toslamasının nedeni ne?
Önceki oturumun varsayımı: "Data Protection Keychain'e yazmak imzasız binary'den yapılamıyor,
gerçek imzalı Tauri bundle'ı bu sorunu yaşamayabilir." Bu **varsayım test edilmemişti.**

## Önce kaynak okuması — iki probe'un neden farklı davrandığı

`se_acl_probe` (T19'un ilk probe'u) SE keygen'i **BAŞARIYLA** yapmıştı, `mac.rs` ise
başarısız oluyordu. Fark `security-framework` v3.7.0 kaynağında:

```rust
// src/key.rs:417
let is_permanent = CFBoolean::from(self.location.is_some());
```

`se_acl_probe` hiç `set_location` çağırmıyor → `is_permanent = false` → anahtar **hiç
saklanmıyor** (geçici, process ölünce kayboluyor) → entitlement gerekmiyor, o yüzden geçti.
`mac.rs:93` ise `set_location(DataProtectionKeychain)` → `is_permanent = true` → keychain'e
yazma denemesi → entitlement kontrolü → `-34018`.

Yani ilk probe'un "SE çalışıyor" sonucu doğruydu ama **kalıcılığı hiç test etmemişti.**
T19'un ihtiyacı olan şey tam olarak kalıcılık (sonraki app açılışında aynı anahtarla decrypt).

## Deney 1 — kalıcı SE anahtarı, dosya keychain'i (imzasız)

Hipotez: engel Data Protection Keychain'e özgüyse, `Location::DefaultFileKeychain`
(`is_permanent = true` ama `kSecUseDataProtectionKeychain` bayrağı yok) çalışmalı.

```
=== ADIM 1: kalıcı SE anahtarı, DefaultFileKeychain (H1) ===
  SONUÇ: BAŞARISIZ — OSStatus error -34018 - failed to add key to keychain
```

**Hipotez çürütüldü.** Her iki keychain de aynı hatayı veriyor. Engel keychain seçimi değil,
**kalıcı SE anahtarının kendisi.**

## Deney 2 — imzalı `.app` bundle, yalnız `app-sandbox` entitlement'ı

Hipotez: kısıtlı (`restricted`) `keychain-access-groups` yerine sandbox tek başına bir keychain
erişim grubu sağlıyorsa provisioning profile'a gerek kalmaz.

Kurulum: minimal `Probe.app` bundle'ı (`CFBundleIdentifier = com.westron.app`), gerçek
`Apple Development: ebaltepe@gmail.com` kimliğiyle imzalandı, entitlement olarak yalnız
`com.apple.security.app-sandbox`.

```
--- SIGNED ---
=== ADIM 1: kalıcı SE anahtarı, DefaultFileKeychain (H1) ===
  SONUÇ: BAŞARISIZ — OSStatus error -34018 - failed to add key to keychain
```

**Hipotez çürütüldü.** Sandbox tek başına erişim grubu sağlamıyor.

(Not: aynı entitlement'ı **çıplak CLI binary'sine** uygulamak `SIGTRAP`/exit 133 veriyor —
sandbox bir bundle/container gerektiriyor. Bu yüzden tüm testler `.app` bundle'ı içinde
yapıldı.)

## Deney 3 — imzalı `.app` bundle, gerçek `keychain-access-groups` (profile YOK)

Entitlement: `keychain-access-groups = ["ZWAS3MG895.com.westron.app"]` (literal Team ID
öneki — `$(AppIdentifierPrefix)` değişkeni profile olmadan zaten çözülmüyor).

```
--- SIGNED (literal team-prefixed keychain-access-group) ---
EXIT=137
```

`137 = 128 + 9 = SIGKILL`. Kendi kodumuz hiç çalışmadı; process AMFI tarafından açılışta
öldürüldü. **`keychain-access-groups` Apple'ın "restricted" entitlement'larından biri: geçerli
sayılması için binary'nin içinde gömülü bir provisioning profile gerekiyor.** Bu makinede hiç
provisioning profile yok (`~/Library/MobileDevice/Provisioning Profiles/` dizini mevcut değil).

## Sonuç (üç deneyin ortak sonucu)

**Kalıcı Secure Enclave anahtarı ⇒ keychain erişim grubu entitlement'ı ⇒ gömülü provisioning
profile.** Keychain seçimiyle, sandbox'la veya elle `codesign` ile aşılamıyor. Bu bir kod hatası
değil; Apple'ın platform kuralı.

Doğrulanan imzalama kimliği:

```
subject= /UID=5FT87CPN2U/CN=Apple Development: ebaltepe@gmail.com (66AKR5F8YX)
         /OU=ZWAS3MG895/O=EMİR BALTEPE/C=US
```

Team ID = `ZWAS3MG895` (sertifikanın OU alanı; CN parantezindeki `66AKR5F8YX` Team ID DEĞİL —
önceki oturumun notu bu noktada doğruydu).

## T19'a etkisi

T19'un "Touch ID gerçek imzada tetikleniyor" kabul kriteri **kod tarafında değil, hesap/imzalama
kurulumu tarafında bloke.** `keystore/mac.rs`'in mantığı bu duvarın arkasında test edilemiyor.
Karar Emir'e ait (proje kuralı: hesap kurulumu Emir'in işi) — seçenekler ve maliyetleri
`STATUS.md`'nin bu tarihli güncellemesinde.

**Bu probe hiçbir gerçek cüzdan verisine dokunmadı**; atılabilir etiket
(`com.westron.keystore.probe.filekeychain`) ve sahte secret kullandı, çıkışta temizliyor.
Zaten hiçbir adımda anahtar üretilemediği için keychain'de kalıntı da oluşmadı.

---

## ÇÖZÜLDÜ (2026-08-12, aynı gün)

Duvar aşıldı ve **ücretsiz Apple hesabıyla**. Eksik olan tek parça gömülü provisioning
profile'dı; `xcodebuild -allowProvisioningUpdates` ile (atılabilir bir Xcode projesi üzerinden,
GUI/sudo olmadan) gerçek bir "Mac Team Provisioning Profile: com.westron.app" üretildi
(`keychain-access-groups = ["ZWAS3MG895.*"]`). Profile `Probe.app/Contents/embedded.provisionprofile`
olarak gömülüp bundle imzalandığında:

- kalıcı SE anahtarı **DataProtectionKeychain'de** (üretim yolunun aynısı) başarıyla üretildi,
- etiketle tekrar bulundu (gerçekten kalıcı),
- decrypt sırasında **Touch ID istemi geldi ve Emir parmağını okutarak onayladı**.

Yani `keystore/mac.rs`'in `DataProtectionKeychain` seçimi baştan doğruymuş — kodda değişiklik
gerekmiyor. Tam kayıt ve sıradaki adımlar: `STATUS.md`, 2026-08-12 güncellemeleri.

**Bu dosyadaki üç deney yine de geçerli ve silinmemeli:** profile'ın neden zorunlu olduğunu,
dosya keychain'i / sandbox / elle codesign yollarının neden çalışmadığını kanıtlıyorlar.
