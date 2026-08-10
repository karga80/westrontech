# T19 W-0.4 probe — `create_with_flags` vs `create_with_protection`

**Sorulan soru:** `security-framework` v3.7.0'da `SecAccessControl::create_with_flags`
ile `SecAccessControl::create_with_protection` ikisinden hangisi
`kSecAccessControlBiometryCurrentSet | kSecAccessControlPrivateKeyUsage`
bayrak kombinasyonunu kabul ediyor, ve bu ACL altında Secure Enclave'de gerçekten
bir P-256 anahtar üretilebiliyor mu?

**Makine:** `hw.model = Mac15,6` (Apple Silicon, gerçek donanım — VM değil, `SPiBridgeDataType`
bir Secure Enclave/bridge controller'ı listeliyor). `macOS 26/27.0 (26A5388g)`.

**Kod:** `src-tauri/examples/se_acl_probe.rs`. Çalıştırma: `cargo run --example se_acl_probe`
(proje kökü `src-tauri/`).

## Kaynak okuması (kod yazmadan önce, docs.rs'in net anlatmadığı kısmı)

`security-framework-3.7.0/src/access_control.rs`:

```rust
impl SecAccessControl {
    pub fn create_with_flags(flags: CFOptionFlags) -> Result<Self> {
        Self::create_with_protection(None, flags)
    }

    pub fn create_with_protection(protection: Option<ProtectionMode>, flags: CFOptionFlags) -> Result<Self> {
        // protection == None düşünce `kSecAttrAccessibleWhenUnlocked`'a düşer
        ...
        SecAccessControlCreateWithFlags(kCFAllocatorDefault, protection_val.as_CFTypeRef(), flags, ptr::null_mut())
        ...
    }
}
```

Yani `create_with_flags(flags)` zaten `create_with_protection(None, flags)`'in bire bir aynısı
— Rust API seviyesinde iki ayrı davranış yok, `create_with_flags` sadece protection'ı
`AccessibleWhenUnlocked`'a sabitleyen bir kısayol. Alttaki FFI çağrısı
(`SecAccessControlCreateWithFlags`) her iki yolda da aynı `flags` parametresini alıyor —
yani "hangisi bu bayrak kombinasyonunu kabul ediyor" sorusunun cevabı **ikisi de aynı şekilde
kabul ediyor**, çünkü flags parametresi protection'dan bağımsız, aynı bit alanı.

Bu, kaynak okumasıyla çıkan sonuç. Aşağıdaki gerçek çalıştırma bunu doğruluyor.

## Gerçek çalıştırma çıktısı (tam, düzenlenmemiş)

```
$ cargo run --example se_acl_probe
flags = 0x40000008 (BiometryCurrentSet | PrivateKeyUsage)

--- create_with_flags ---
SecAccessControl::create_with_flags: OK (SecAccessControl { .. })
  -> SE P-256 keygen under [create_with_flags] ACL: OK

--- create_with_protection(None, flags) ---
create_with_protection(None, ..): OK (SecAccessControl { .. })
  -> SE P-256 keygen under [create_with_protection(None)] ACL: OK

--- create_with_protection(AccessibleWhenUnlockedThisDeviceOnly, flags) ---
create_with_protection(ThisDeviceOnly, ..): OK (SecAccessControl { .. })
  -> SE P-256 keygen under [create_with_protection(ThisDeviceOnly)] ACL: OK
```

`EXIT=0`. Üç yolun üçü de: (a) `SecAccessControl` nesnesini hatasız oluşturdu, (b) o ACL'i
`GenerateKeyOptions` üzerinden Secure Enclave P-256 keygen'e (`Token::SecureEnclave`,
`KeyType::ec()`) verdiğinde anahtar gerçekten üretildi (`SecKey::new` `Ok`).

## Sonuç kararı

**`create_with_protection(Some(AccessibleWhenUnlockedThisDeviceOnly), flags)` kullanılacak.**

Gerekçe:
- Bayrak kabulü açısından üç yol arasında fark yok (kaynak + çalıştırma ikisi de bunu
  doğruladı) — "hangisi kabul ediyor" sorusu yanlış çerçevelenmiş, ikisi de kabul ediyor.
- Gerçek karar değişkeni `ProtectionMode`. `create_with_flags` / `create_with_protection(None, ..)`
  varsayılan olarak `kSecAttrAccessibleWhenUnlocked`'a düşüyor — bu **iCloud Keychain senkron
  kapsamına girebilecek** genel "unlocked" sınıfı. Proje kuralı (CLAUDE.md + custody planı,
  anti-pattern listesi) `kSecAttrSynchronizable` kapalı olsa bile en güvenli varsayılan
  `...ThisDeviceOnly` protection sınıfıdır — cihaz-yerel olduğunu ACL seviyesinde de garanti eder,
  sadece bir attribute bayrağına güvenmez. Bu yüzden W-1.2 implementasyonu açıkça
  `create_with_protection(Some(ProtectionMode::AccessibleWhenUnlockedThisDeviceOnly), flags)`
  çağıracak, `create_with_flags`'i kullanmayacak.

## Doğrulanan vs doğrulanamayan

**Doğrulandı (gerçek çalıştırma, bu Mac'te):**
- Her üç ACL oluşturma yolu da derleniyor ve `Ok` dönüyor.
- `kSecAccessControlBiometryCurrentSet | kSecAccessControlPrivateKeyUsage` kombinasyonu her üç
  yolda da Secure Enclave keygen'i tarafından kabul ediliyor (reddedilmedi).
- SE'de gerçek P-256 anahtar üretimi bu Mac'in donanımında çalışıyor (`Token::SecureEnclave`
  hatasız).
- Üretilen anahtar `GenerateKeyOptions::default().location` ayarlanmadığı için
  `kSecAttrIsPermanent = false` ile geçici — Keychain'e hiçbir kalıcı iz bırakmadı (probe
  sonrası temizlik gerekmedi, doğrulandı: `security find-key` ile arama yapılmadı çünkü zaten
  hiç yazılmadı, kalıcı olmayan anahtar için bu adım anlamsız).

**Doğrulanamadı (bu oturumda gözlemlenemedi, açıkça işaretliyorum):**
- **Touch ID prompt'unun gerçekten tetiklenip tetiklenmediği.** Bu çalıştırma headless bir ajan
  oturumundan geldi — keygen anında hiçbir biyometrik prompt görünmedi (ve zaten Apple'ın modeli
  keygen'de değil, decrypt/sign gibi **kullanım** anında ACL'i devreye sokuyor). Bu probe SE
  anahtarını hiç kullanmadı (encrypt/decrypt/sign çağırmadı) — sadece üretti. Decrypt anında
  Touch ID'nin gerçekten çıkıp çıkmadığı, W-1.2 kodu tamamlanıp gerçek bir ECIES decrypt çağrısı
  yapıldığında, Emir'in Mac'inde interaktif bir oturumda (bu ajan session'ı değil) doğrulanmalı.
  Bu, planın kendi kabul kriterinde de böyle: "Emir'in Mac'inde Touch ID prompt'u gerçek imzada
  tetikleniyor."
- Bu makinede fiziksel Touch ID donanımı olup olmadığı (MacBook mı, Mac mini/Studio mı) bu
  oturumdan görülemedi — `hw.model = Mac15,6` bir MacBook Pro 14" (2023, M3) model koduna
  karşılık geliyor, bu genelde Touch ID'li bir dizüstü, ama ajan bunu donanımsal olarak
  test edemedi (headless).
