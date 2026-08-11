//! T19 probe — kalıcı Secure Enclave anahtarı, Data Protection Keychain OLMADAN.
//!
//! **Test edilen tek hipotez (H1):** `keystore/mac.rs`'in `-34018
//! errSecMissingEntitlement` ile duvara toslamasının nedeni Secure Enclave'in
//! kendisi değil, anahtarın **Data Protection Keychain'e** yazılması. Aynı SE
//! anahtarı `Location::DefaultFileKeychain` ile (yani `kSecAttrIsPermanent =
//! true` ama `kSecUseDataProtectionKeychain` bayrağı YOK) kalıcı olarak
//! üretilebiliyor mu, ve o anahtarla decrypt gerçek Touch ID promptu tetikliyor
//! mu?
//!
//! Neden bu ayrım anlamlı: `security-framework` v3.7.0'da
//! `GenerateKeyOptions::set_location` yalnızca `is_permanent = location.is_some()`
//! yapıyor (src/key.rs:417). Daha önce BAŞARILI olan `se_acl_probe` hiç
//! `set_location` çağırmıyordu — yani anahtar hiç saklanmıyordu (geçici),
//! bu yüzden entitlement gerekmiyordu. `mac.rs:93` ise
//! `DataProtectionKeychain` kullanıyor, o da crate'in kendi dokümanına göre
//! (`item.rs:1057`) imzalı binary + `keychain-access-groups` entitlement
//! istiyor. Arada hiç denenmemiş üçüncü bir kombinasyon var: kalıcı + dosya
//! keychain'i. Bu probe tam olarak onu ölçüyor.
//!
//! Çalıştırma (proje kökü `src-tauri/`):
//!   cargo run --example se_filekeychain_probe
//!
//! Bu probe atılabilir bir test hesabı ve sahte bir secret kullanır; gerçek
//! cüzdan verisine dokunmaz ve çıkarken ürettiği anahtarı siler.

#[cfg(not(target_os = "macos"))]
fn main() {
    eprintln!("Bu probe yalnız macOS içindir.");
    std::process::exit(1);
}

#[cfg(target_os = "macos")]
fn main() {
    use core_foundation::base::CFOptionFlags;
    use security_framework::access_control::{ProtectionMode, SecAccessControl};
    use security_framework::item::{
        ItemClass, ItemSearchOptions, KeyClass, Limit, Location, Reference, SearchResult,
    };
    use security_framework::key::{Algorithm, GenerateKeyOptions, KeyType, SecKey, Token};
    use security_framework_sys::access_control::{
        kSecAccessControlBiometryCurrentSet, kSecAccessControlPrivateKeyUsage,
    };

    const ECIES_ALGO: Algorithm = Algorithm::ECIESEncryptionCofactorX963SHA256AESGCM;
    const LABEL: &str = "com.westron.keystore.probe.filekeychain";
    const ERR_SEC_ITEM_NOT_FOUND: i32 = -25300;

    fn find_key(label: &str) -> Result<Option<SecKey>, String> {
        match ItemSearchOptions::new()
            .class(ItemClass::key())
            .key_class(KeyClass::private())
            .label(label)
            .load_refs(true)
            .limit(Limit::Max(1))
            .search()
        {
            Ok(items) => Ok(items.into_iter().find_map(|item| match item {
                SearchResult::Ref(Reference::Key(k)) => Some(k),
                _ => None,
            })),
            Err(e) if e.code() == ERR_SEC_ITEM_NOT_FOUND => Ok(None),
            Err(e) => Err(format!("arama başarısız: {e}")),
        }
    }

    fn delete_key(label: &str) -> Result<(), String> {
        match ItemSearchOptions::new()
            .class(ItemClass::key())
            .key_class(KeyClass::private())
            .label(label)
            .delete()
        {
            Ok(()) => Ok(()),
            Err(e) if e.code() == ERR_SEC_ITEM_NOT_FOUND => Ok(()),
            Err(e) => Err(format!("silme başarısız: {e}")),
        }
    }

    let flags: CFOptionFlags = kSecAccessControlBiometryCurrentSet | kSecAccessControlPrivateKeyUsage;
    let acl = match SecAccessControl::create_with_protection(
        Some(ProtectionMode::AccessibleWhenUnlockedThisDeviceOnly),
        flags,
    ) {
        Ok(acl) => acl,
        Err(e) => {
            eprintln!("ACL üretilemedi: {e}");
            std::process::exit(1);
        }
    };

    // Önceki bir çalıştırmadan kalıntı varsa temiz başla.
    if let Err(e) = delete_key(LABEL) {
        eprintln!("[uyarı] ön temizlik: {e}");
    }

    // Üretim kodu (`keystore/mac.rs:93`) DataProtectionKeychain kullanıyor —
    // profile gömüldükten sonraki test tam olarak o yolu ölçmeli, yaklaşığını
    // değil. `WESTRON_PROBE_FILE_KEYCHAIN=1` ile eski (dosya keychain'i)
    // varyantına geçilebilir; ikisi de entitlement olmadan -34018 veriyordu.
    let use_file_keychain = std::env::var_os("WESTRON_PROBE_FILE_KEYCHAIN").is_some();
    let location = if use_file_keychain {
        Location::DefaultFileKeychain
    } else {
        Location::DataProtectionKeychain
    };
    println!(
        "=== ADIM 1: kalıcı SE anahtarı, {} ===",
        if use_file_keychain { "DefaultFileKeychain" } else { "DataProtectionKeychain (üretim yolu)" }
    );
    let mut opts = GenerateKeyOptions::default();
    opts.set_key_type(KeyType::ec());
    opts.set_token(Token::SecureEnclave);
    opts.set_access_control(acl);
    opts.set_label(LABEL.to_string());
    opts.set_location(location);

    let key = match SecKey::new(&opts) {
        Ok(key) => {
            println!("  SONUÇ: BAŞARILI — kalıcı SE anahtarı entitlement olmadan üretildi.");
            key
        }
        Err(e) => {
            println!("  SONUÇ: BAŞARISIZ — {e}");
            println!();
            println!("=== H1 ÇÜRÜTÜLDÜ ===");
            println!("Kalıcı Secure Enclave anahtarı dosya keychain'ine de yazılamıyor.");
            println!("Bu, engelin gerçekten Data Protection Keychain'e özgü olmadığını, genel");
            println!("olarak 'kalıcı SE anahtarı = imzalı binary + provisioning profile' kuralı");
            println!("olduğunu gösterir. Kodla çözülemez — hesap/imzalama kurulumu gerekir.");
            std::process::exit(2);
        }
    };

    println!();
    println!("=== ADIM 2: anahtar keychain'de gerçekten aranabiliyor mu ===");
    match find_key(LABEL) {
        Ok(Some(_)) => println!("  SONUÇ: BAŞARILI — anahtar etikete göre bulundu (kalıcı)."),
        Ok(None) => {
            println!("  SONUÇ: BAŞARISIZ — anahtar üretildi ama aramada bulunamadı.");
            println!("  Bu, 'kalıcı' görünen anahtarın aslında process'e bağlı geçici bir");
            println!("  referans olduğu anlamına gelir; sonraki app açılışında kullanılamaz.");
        }
        Err(e) => println!("  SONUÇ: arama hata verdi — {e}"),
    }

    println!();
    println!("=== ADIM 3: encrypt → decrypt (Touch ID BURADA beklenir) ===");
    let secret = b"westron-probe-not-a-real-key-0123456789abcdef";
    let public = match key.public_key() {
        Some(p) => p,
        None => {
            eprintln!("  SE anahtarının public yarısı alınamadı; temizleyip çıkılıyor.");
            let _ = delete_key(LABEL);
            std::process::exit(3);
        }
    };
    let ciphertext = match public.encrypt_data(ECIES_ALGO, secret) {
        Ok(c) => {
            println!("  encrypt: OK ({} bayt)", c.len());
            c
        }
        Err(e) => {
            eprintln!("  encrypt başarısız: {e}");
            let _ = delete_key(LABEL);
            std::process::exit(3);
        }
    };

    println!("  Şimdi decrypt çağrılıyor — ekranda Touch ID istemi ÇIKMALI.");
    match key.decrypt_data(ECIES_ALGO, &ciphertext) {
        Ok(plain) if plain == secret => {
            println!("  decrypt: OK, round-trip doğru.");
            println!();
            println!("=== ROUND-TRIP DOĞRU (Touch ID'yi SİZ gözlemlediyseniz) ===");
            println!("Bu probe promptun gelip gelmediğini göremez — yalnız insan doğrulayabilir.");
            println!("Prompt GELDİYSE: kalıcı SE anahtarı + biyometrik ACL gerçekten çalışıyor.");
            println!("Prompt GELMEDİYSE: anahtar kalıcı oldu ama ACL uygulanmıyor — bu 'başarılı'");
            println!("sayılmaz, ayrıca incelenmeli. Sessizce 'oldu' diye raporlanmamalı.");
        }
        Ok(_) => println!("  decrypt: çalıştı ama round-trip UYUŞMADI — bozuk."),
        Err(e) => println!("  decrypt: BAŞARISIZ — {e}"),
    }

    println!();
    println!("=== TEMİZLİK ===");
    match delete_key(LABEL) {
        Ok(()) => println!("  probe anahtarı silindi."),
        Err(e) => println!("  [uyarı] probe anahtarı silinemedi: {e}"),
    }
}
