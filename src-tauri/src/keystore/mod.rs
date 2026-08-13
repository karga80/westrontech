//! T19 Faz 1 (W-1.1 – W-1.4) — sertleştirilmiş anahtar deposu.
//!
//! Bu modül `wallet::keychain`'in yerini almaz (bkz. o dosyanın kendi güvenlik
//! notu — zaten gerçek Keychain kullanıyor). Bu modül onun **üzerine** inşa
//! edilen, Secure Enclave ile sarmalanmış yeni bir depo: aynı service adı
//! altında değil (`"com.westron.wallet"` — `wallet::keychain`'in kullandığı
//! `"Westron"` service'inden ayrı), çünkü ikisi farklı şeyler saklıyor —
//! biri düz Keychain girdisi, biri SE-şifreli blob. Bu iki yolun ne zaman ve
//! nasıl birleştirileceği (cutover) bu görevin kapsamı dışında; bkz. bu
//! modülün üstündeki görev raporu / `docs/CUSTODY-HARDENING-PLAN.md` W-1.5+.
//!
//! ## Genel API
//!
//! - [`store_key`] / [`load_key`] / [`delete_key`] / [`list_key_ids`] — genel
//!   `id` (örn. cüzdan adresi) → gizli bayt dizisi sözleşmesi.
//! - `load_key` `Zeroizing<Vec<u8>>` döner: çağıran belleği bırakınca içerik
//!   otomatik sıfırlanır (bkz. W-1.6'nın önden kapsadığı kısım — tam bellek
//!   hijyeni denetimi W-1.6'nın kendisinde, ama bu tip burada zaten doğru
//!   davranışla başlıyor).
//!
//! ## Backend seçimi
//!
//! - macOS, normal çalışma: [`mac`] — Secure Enclave P-256 anahtarıyla ECIES
//!   şifreleme + biyometri/parola ACL fallback zinciri (W-1.2, W-1.3).
//! - macOS, `cfg(test)` veya `--features mock-keystore`: [`mock`] — bellek içi
//!   sahte depo. Gerçek Keychain'e CI'da erişim yok; gerçek backend'in
//!   davranışı bu modülde test edilmez, Emir'in Mac'inde manuel doğrulanır
//!   (bkz. görev raporu, "Doğrulanamadı" bölümü).
//! - Non-macOS (yalnızca derlemenin geçmesi için — bu ürün yalnız macOS'ta
//!   dağıtılıyor, CLAUDE.md "Platform: Sadece macOS"): 0600 modunda düz dosya,
//!   `wallet::keychain`'in non-mac fallback'ıyla aynı desen, SE yok.
//!
//! ## Anti-pattern korumaları (uygulandı)
//!
//! - SE'de secp256k1 imzalama YOK — SE burada yalnız bir ECIES anahtar
//!   çiftini barındırıyor (P-256), secp256k1 private key material SE'nin asla
//!   görmediği düz baytlar olarak şifrelenip Keychain'e yazılıyor.
//! - `kSecAttrSynchronizable` hiçbir yerde `true` set edilmiyor (varsayılan
//!   `false` — item iCloud Keychain'e senkronlanmaz).
//! - Agent/API-key ACL'i yok — bu modül yalnız cüzdan anahtarları için;
//!   W-1.5 (API key taşıması) kapsam dışı, biyometrisiz ayrı service'te kalır.

use zeroize::Zeroizing;

pub mod migration;

#[cfg(target_os = "macos")]
mod mac;

#[cfg(any(test, feature = "mock-keystore"))]
pub mod mock;

/// Keychain service name for every item this module writes. Deliberately
/// distinct from `wallet::keychain::KEYCHAIN_SERVICE` ("Westron") — see the
/// module doc comment for why the two are not merged in this task.
pub const KEYSTORE_SERVICE: &str = "com.westron.wallet";

/// The one error text every backend returns when `id` simply is not stored
/// here. It has a name because callers must be able to tell "nothing stored"
/// apart from "stored, but the decrypt failed or the user declined Touch ID"
/// — see [`is_not_found`].
pub const NOT_FOUND: &str = "No matching entry found in secure storage";

/// True only for the "nothing is stored under this id" error.
///
/// `wallet::keychain::fetch_key` uses this to decide whether it may fall back
/// to the legacy plaintext-Keychain copy of a wallet key. Falling back on
/// *any* error would turn a declined Touch ID prompt into a silent bypass of
/// the biometric gate: the user says no, and the app quietly signs with the
/// un-gated copy instead. Only a genuine miss is allowed to fall through.
pub fn is_not_found(err: &str) -> bool {
    err == NOT_FOUND
}

/// Which custody mode a given key ended up under. Surfaced so a future
/// Settings screen (forge's job, not this task's) can tell the user whether
/// they have Secure Enclave + biometry protection or a reduced fallback.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum CustodyMode {
    /// Secure Enclave P-256 key, ACL requires current biometry enrollment
    /// (`kSecAccessControlBiometryCurrentSet | kSecAccessControlPrivateKeyUsage`).
    SecureEnclaveBiometry,
    /// Secure Enclave P-256 key, ACL requires device presence (passcode or
    /// biometry) instead of biometry specifically
    /// (`kSecAccessControlUserPresence | kSecAccessControlPrivateKeyUsage`).
    SecureEnclaveUserPresence,
    /// No Secure Enclave available on this machine at all (or SE keygen
    /// failed for both ACL policies) — secret stored as a plain Keychain
    /// generic-password item, no hardware-backed encryption, no biometric
    /// gate. Explicit, not silent: callers should surface this to the user.
    KeychainOnly,
}

impl std::fmt::Display for CustodyMode {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.write_str(match self {
            Self::SecureEnclaveBiometry => "secure_enclave_biometry",
            Self::SecureEnclaveUserPresence => "secure_enclave_user_presence",
            Self::KeychainOnly => "keychain_only",
        })
    }
}

/// Storage backend contract. `account` is already normalised (lowercase,
/// trimmed) by the public functions in this module — implementations must
/// not re-derive it differently, or the "two spellings" bug documented in
/// `wallet::keychain` recurs in a second module.
pub(crate) trait Backend: Send + Sync {
    fn store(&self, account: &str, secret: &[u8]) -> Result<(), String>;
    fn load(&self, account: &str) -> Result<Vec<u8>, String>;
    fn delete(&self, account: &str) -> Result<(), String>;
    fn list_ids(&self) -> Result<Vec<String>, String>;
}

/// Same normalisation rule as `wallet::keychain::key_account` — an id has
/// two equally valid spellings (an address in particular) and this module
/// must not reintroduce the bug that rule was written to close.
fn normalize_id(id: &str) -> String {
    id.trim().to_lowercase()
}

// ── Non-macOS fallback backend (compile-target only; not a supported ship
// platform for this product — CLAUDE.md restricts distribution to macOS) ──

#[cfg(not(target_os = "macos"))]
struct FileBackend;

#[cfg(not(target_os = "macos"))]
impl FileBackend {
    fn dir() -> Result<std::path::PathBuf, String> {
        let dir = crate::persist::app_file("keystore")?;
        // app_file returns a *file* path template; keystore wants a
        // directory of one file per account, so re-derive the directory.
        let dir = dir
            .parent()
            .map(|p| p.join("keystore"))
            .ok_or_else(|| "could not determine keystore directory".to_string())?;
        std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
        Ok(dir)
    }

    fn path(account: &str) -> Result<std::path::PathBuf, String> {
        Ok(Self::dir()?.join(format!("{account}.key")))
    }
}

#[cfg(not(target_os = "macos"))]
impl Backend for FileBackend {
    fn store(&self, account: &str, secret: &[u8]) -> Result<(), String> {
        crate::persist::write_private_atomic(&Self::path(account)?, secret)
    }

    fn load(&self, account: &str) -> Result<Vec<u8>, String> {
        let path = Self::path(account)?;
        std::fs::read(&path).map_err(|_| NOT_FOUND.to_string())
    }

    fn delete(&self, account: &str) -> Result<(), String> {
        let path = Self::path(account)?;
        if path.exists() {
            std::fs::remove_file(&path).map_err(|e| e.to_string())?;
        }
        Ok(())
    }

    fn list_ids(&self) -> Result<Vec<String>, String> {
        let dir = Self::dir()?;
        let mut out = Vec::new();
        for entry in std::fs::read_dir(&dir).map_err(|e| e.to_string())?.flatten() {
            let path = entry.path();
            if path.extension().and_then(|e| e.to_str()) == Some("key") {
                if let Some(stem) = path.file_stem().and_then(|s| s.to_str()) {
                    out.push(stem.to_string());
                }
            }
        }
        Ok(out)
    }
}

/// Select the backend for the current process. Test builds and the
/// `mock-keystore` feature always get the in-memory mock — a test run must
/// never touch the real Keychain (no CI Keychain, and a real run would block
/// on Touch ID with nothing there to answer it).
fn backend() -> Box<dyn Backend> {
    #[cfg(any(test, feature = "mock-keystore"))]
    {
        Box::new(mock::MockBackend::shared())
    }
    #[cfg(not(any(test, feature = "mock-keystore")))]
    {
        #[cfg(target_os = "macos")]
        {
            Box::new(mac::SecureEnclaveBackend)
        }
        #[cfg(not(target_os = "macos"))]
        {
            Box::new(FileBackend)
        }
    }
}

/// Store `secret` under `id`. Overwrites any existing entry for the same id.
pub fn store_key(id: &str, secret: &[u8]) -> Result<(), String> {
    backend().store(&normalize_id(id), secret)
}

/// Load the secret stored under `id`. The returned buffer zeroizes itself
/// when dropped — callers must not `.to_vec()` it into a non-zeroizing type
/// and hold that copy longer than needed.
pub fn load_key(id: &str) -> Result<Zeroizing<Vec<u8>>, String> {
    backend().load(&normalize_id(id)).map(Zeroizing::new)
}

/// Delete the entry for `id`. Deleting something that was never stored is
/// success, same convention as `wallet::keychain::delete_key`.
#[allow(dead_code)]
pub fn delete_key(id: &str) -> Result<(), String> {
    backend().delete(&normalize_id(id))
}

/// List every id currently stored. Empty store is `Ok(vec![])`, never `Err`
/// — "no rows" is not an error (CLAUDE.md, Dürüstlük Kuralları #4).
#[allow(dead_code)]
pub fn list_key_ids() -> Result<Vec<String>, String> {
    backend().list_ids()
}

/// Which custody tier `id`'s stored entry actually landed on (Secure Enclave
/// + biometry, Secure Enclave + presence, or the plain-Keychain fallback).
/// Reads only the stored mode tag — does not decrypt, does not trigger a
/// Touch ID prompt. `Ok(None)` if nothing is stored for `id` yet.
///
/// macOS-only because the mode tag is a `mac`-backend concept; the mock and
/// non-macOS file backends have no fallback chain to distinguish.
#[cfg(target_os = "macos")]
pub fn custody_mode(id: &str) -> Result<Option<CustodyMode>, String> {
    mac::custody_mode(&normalize_id(id))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn roundtrips_store_load_delete() {
        mock::MockBackend::reset();
        store_key("0xAbC123", b"super-secret-key-bytes").unwrap();
        let loaded = load_key("0xabc123").unwrap();
        assert_eq!(&loaded[..], b"super-secret-key-bytes");

        delete_key("0xABC123").unwrap();
        assert!(load_key("0xabc123").is_err());
    }

    #[test]
    fn two_spellings_of_the_same_address_resolve_to_one_entry() {
        mock::MockBackend::reset();
        store_key("0xDEF456", b"v1").unwrap();
        store_key("0xdef456", b"v2").unwrap();
        assert_eq!(&load_key("0xDEF456").unwrap()[..], b"v2");
        assert_eq!(list_key_ids().unwrap(), vec!["0xdef456".to_string()]);
    }

    #[test]
    fn missing_id_is_an_explicit_error_not_a_panic() {
        mock::MockBackend::reset();
        let err = load_key("0xnope").unwrap_err();
        assert!(!err.is_empty());
    }

    #[test]
    fn deleting_a_missing_id_is_not_an_error() {
        mock::MockBackend::reset();
        delete_key("0xnever-stored").unwrap();
    }

    #[test]
    fn empty_store_lists_as_empty_ok_not_err() {
        mock::MockBackend::reset();
        assert_eq!(list_key_ids().unwrap(), Vec::<String>::new());
    }

    #[test]
    fn debug_and_display_of_custody_mode_never_names_a_secret() {
        // Not a very interesting assertion by itself, but it pins the
        // contract: CustodyMode carries no key material, only a mode label.
        assert_eq!(CustodyMode::SecureEnclaveBiometry.to_string(), "secure_enclave_biometry");
        assert_eq!(format!("{:?}", CustodyMode::KeychainOnly), "KeychainOnly");
    }
}
