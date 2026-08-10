// Under `cfg(test)` the dispatcher in `mod.rs` always selects the mock
// backend (see `keystore::backend()`) so nothing here is reachable from a
// test run — that is intentional (no real Keychain in CI), not dead code in
// the production build. Silence the resulting warnings only for `cfg(test)`.
#![cfg_attr(test, allow(dead_code))]

//! W-1.2 (Secure Enclave sarmalayıcı) + W-1.3 (fallback zinciri).
//!
//! Desen — probe sonucuna göre (`probes/se-acl-probe-t19.md`):
//!
//! 1. Her `account` (= normalize edilmiş cüzdan adresi) için ayrı, kalıcı bir
//!    Secure Enclave **P-256** anahtar çifti üretilir (`Token::SecureEnclave`,
//!    yalnız `KeyType::ec()` — probe'un doğruladığı gibi SE secp256k1
//!    desteklemiyor, bu yüzden P-256 yalnızca şifreleme için kullanılıyor,
//!    imza için asla).
//! 2. secp256k1 private key baytları bu SE anahtarının **public** yarısıyla
//!    ECIES şifrelenir (`SecKey::encrypt_data`), şifreli blob normal bir
//!    Keychain generic-password item'ı olarak [`super::KEYSTORE_SERVICE`]
//!    altında saklanır. Blob'un ilk baytı hangi [`super::CustodyMode`] ile
//!    yazıldığını taşır — okuma anında SE'ye hiç gitmeden karar verilebilsin
//!    diye (ACL'i introspect etmeye çalışmak yerine, yazıldığı anda kaydedip
//!    okurken güvenilir kaynak olarak kullanmak — iki yerin ayrışma riski
//!    yok, tek yazar tek okuyucu aynı baytı kullanıyor).
//! 3. Decrypt (`load`) SE private key'i private ACL'i tetikler — Touch ID/
//!    parola promptu macOS'un kendisi tarafından, bu kod hiçbir ek tetikleme
//!    yapmadan, otomatik gösterilir.
//!
//! **ANTI-PATTERN KORUMASI:** bu dosyada `KeyType::ec()` dışında bir anahtar
//! tipiyle `Token::SecureEnclave` birlikte KULLANILMAZ. secp256k1 baytları SE
//! private key olarak asla üretilmez/import edilmez — yalnız düz bayt olarak
//! şifrelenir/çözülür, işlem sonunda çağıranın sorumluluğunda zeroize edilir
//! (`Zeroizing` — bkz. `mod.rs::load_key`).

use core_foundation::base::CFOptionFlags;
use zeroize::Zeroizing;

use security_framework::access_control::{ProtectionMode, SecAccessControl};
use security_framework::item::{
    ItemClass, ItemSearchOptions, KeyClass, Limit, Location as KeyLocation, Reference, SearchResult,
};
use security_framework::key::{Algorithm, GenerateKeyOptions, KeyType, SecKey, Token};
use security_framework::passwords::{
    delete_generic_password, generic_password, set_generic_password, PasswordOptions,
};
use security_framework_sys::access_control::{
    kSecAccessControlBiometryCurrentSet, kSecAccessControlPrivateKeyUsage,
    kSecAccessControlUserPresence,
};

use super::{Backend, CustodyMode, KEYSTORE_SERVICE};

/// `errSecItemNotFound` — same constant `wallet::keychain::mac` uses.
const ERR_SEC_ITEM_NOT_FOUND: i32 = -25300;

/// ECIES variant used for every SE-backed encrypt/decrypt in this module.
/// Chosen from the 18 variants W-0.4 confirmed exist in `security-framework`
/// v3.7.0 — cofactor + SHA-256 + AES-GCM is Apple's documented modern
/// recommendation for `SecKeyAlgorithm` EC encryption.
const ECIES_ALGO: Algorithm = Algorithm::ECIESEncryptionCofactorX963SHA256AESGCM;

/// Leading byte of every stored blob — which custody tier produced it.
const MODE_TAG_SE_BIOMETRY: u8 = 0;
const MODE_TAG_SE_PRESENCE: u8 = 1;
const MODE_TAG_KEYCHAIN_ONLY: u8 = 2;

fn se_key_label(account: &str) -> String {
    format!("com.westron.keystore.se.{account}")
}

fn build_acl(flags: CFOptionFlags) -> Result<SecAccessControl, String> {
    // Device-local protection class explicitly, not the `create_with_flags`
    // default (`AccessibleWhenUnlocked`) — see probes/se-acl-probe-t19.md for
    // why: both accept the same flags, the protection class is the actual
    // decision, and this project's rule is device-local by construction, not
    // by relying only on `kSecAttrSynchronizable` staying off.
    SecAccessControl::create_with_protection(
        Some(ProtectionMode::AccessibleWhenUnlockedThisDeviceOnly),
        flags,
    )
    .map_err(|e| format!("access control creation failed: {e}"))
}

fn generate_se_key(account: &str, flags: CFOptionFlags) -> Result<SecKey, String> {
    let acl = build_acl(flags)?;
    let mut opts = GenerateKeyOptions::default();
    opts.set_key_type(KeyType::ec());
    opts.set_token(Token::SecureEnclave);
    opts.set_access_control(acl);
    opts.set_label(se_key_label(account));
    // SE keys must live in the data protection keychain (crate docs, matches
    // W-0.4). This also makes the key persistent across process restarts —
    // required, since `load_key` can run in a later app launch.
    opts.set_location(KeyLocation::DataProtectionKeychain);
    SecKey::new(&opts).map_err(|e| format!("Secure Enclave key generation failed: {e}"))
}

fn find_se_private_key(account: &str) -> Result<Option<SecKey>, String> {
    let label = se_key_label(account);
    let result = ItemSearchOptions::new()
        .class(ItemClass::key())
        .key_class(KeyClass::private())
        .label(&label)
        .load_refs(true)
        .limit(1)
        .search();
    match result {
        Ok(items) => Ok(items.into_iter().find_map(|item| match item {
            SearchResult::Ref(Reference::Key(k)) => Some(k),
            _ => None,
        })),
        Err(e) if e.code() == ERR_SEC_ITEM_NOT_FOUND => Ok(None),
        Err(e) => Err(format!("Secure Enclave key lookup failed: {e}")),
    }
}

/// Best-effort removal of a previously generated SE key for `account`.
/// Called before regenerating on overwrite so a re-`store_key` call does not
/// orphan a hardware-resident key with no blob pointing at it.
fn delete_se_key(account: &str) -> Result<(), String> {
    let label = se_key_label(account);
    match ItemSearchOptions::new()
        .class(ItemClass::key())
        .key_class(KeyClass::private())
        .label(&label)
        .delete()
    {
        Ok(()) => Ok(()),
        Err(e) if e.code() == ERR_SEC_ITEM_NOT_FOUND => Ok(()),
        Err(e) => Err(format!("could not remove previous Secure Enclave key: {e}")),
    }
}

/// W-1.3 fallback chain: biometry ACL, then user-presence ACL, then (if this
/// machine has no Secure Enclave at all) plain Keychain storage with an
/// explicit mode tag — never a silent downgrade.
enum Prepared {
    SecureEnclave { key: SecKey, mode: CustodyMode },
    KeychainOnly,
}

fn prepare_custody(account: &str) -> Result<Prepared, String> {
    let biometry_flags: CFOptionFlags = kSecAccessControlBiometryCurrentSet | kSecAccessControlPrivateKeyUsage;
    match generate_se_key(account, biometry_flags) {
        Ok(key) => return Ok(Prepared::SecureEnclave { key, mode: CustodyMode::SecureEnclaveBiometry }),
        Err(e) => eprintln!(
            "keystore: Secure Enclave anahtar üretimi (biyometri ACL) başarısız, presence ACL deneniyor: {e}"
        ),
    }

    let presence_flags: CFOptionFlags = kSecAccessControlUserPresence | kSecAccessControlPrivateKeyUsage;
    match generate_se_key(account, presence_flags) {
        Ok(key) => return Ok(Prepared::SecureEnclave { key, mode: CustodyMode::SecureEnclaveUserPresence }),
        Err(e) => eprintln!(
            "keystore: Secure Enclave anahtar üretimi (presence ACL) de başarısız, düz Keychain'e (biyometrisiz) düşülüyor: {e}"
        ),
    }

    // Neither ACL policy produced a working Secure Enclave key — this
    // machine has no SE (or the SE keygen path is unavailable for another
    // reason). The two eprintln! calls above carry the real reason instead
    // of swallowing it — a silent fallback here would be exactly the
    // "silent catch" failure mode this project's rules forbid. The mode tag
    // on the stored blob also records this so `custody_mode()` can tell the
    // user plainly instead of pretending they have hardware protection.
    Ok(Prepared::KeychainOnly)
}

/// Capture-then-write-then-delete ordering that fixes the CRITICAL data-loss
/// bug in the T19 hardening review (Finding 1): the previous `store()` order
/// was delete-old → generate-new → encrypt → write, so a keygen or Keychain
/// write failure *after* the old SE key had already been deleted left the
/// *previous* blob (still sitting in Keychain, untouched) permanently
/// undecryptable — it pointed at a key that no longer existed. The only safe
/// order is: capture the old key (do not delete it yet) → generate the new
/// key and durably write the new blob → only then delete the old key.
///
/// Extracted generic over `K` (and free of any `security_framework` type) so
/// this ordering invariant can be exercised by a real, headless
/// `cargo test` with fakes — see `store_ordering_tests` below.
/// `SecureEnclaveBackend::store()` itself cannot be: `cfg(test)` always
/// routes the public `keystore::store_key`/`load_key` functions to
/// `mock.rs` (see `keystore::backend()`), so this file's real Keychain/
/// Secure Enclave calls are never reachable from `cargo test` — not on this
/// project's CI, and not in this session either. That real-hardware path
/// remains verified only by manual review plus the existing SE ACL probe
/// (`probes/se-acl-probe-t19.md`), not by an automated test.
fn store_preserving_old_key_until_write_succeeds<K>(
    find_previous: impl FnOnce() -> Result<Option<K>, String>,
    write_new_blob: impl FnOnce() -> Result<(), String>,
    delete_previous: impl FnOnce(K) -> Result<(), String>,
) -> Result<(), String> {
    let previous = find_previous()?;
    write_new_blob()?;
    if let Some(previous) = previous {
        delete_previous(previous)?;
    }
    Ok(())
}

pub(super) struct SecureEnclaveBackend;

impl Backend for SecureEnclaveBackend {
    fn store(&self, account: &str, secret: &[u8]) -> Result<(), String> {
        store_preserving_old_key_until_write_succeeds(
            || find_se_private_key(account),
            || {
                // `Zeroizing` here (not a plain `Vec<u8>`): in the
                // `KeychainOnly` fallback this buffer holds the *raw*
                // unencrypted secret, not just ciphertext (Finding 2, HIGH —
                // raw key material must not sit in an unzeroized buffer).
                let mut blob: Zeroizing<Vec<u8>> = Zeroizing::new(Vec::with_capacity(secret.len() + 1));
                match prepare_custody(account)? {
                    Prepared::SecureEnclave { key, mode } => {
                        let public = key
                            .public_key()
                            .ok_or_else(|| "Secure Enclave key has no public half".to_string())?;
                        let ciphertext = public
                            .encrypt_data(ECIES_ALGO, secret)
                            .map_err(|e| format!("Secure Enclave encryption failed: {e}"))?;
                        blob.push(match mode {
                            CustodyMode::SecureEnclaveBiometry => MODE_TAG_SE_BIOMETRY,
                            CustodyMode::SecureEnclaveUserPresence => MODE_TAG_SE_PRESENCE,
                            CustodyMode::KeychainOnly => unreachable!("prepare_custody only returns this via the KeychainOnly arm"),
                        });
                        blob.extend_from_slice(&ciphertext);
                    }
                    Prepared::KeychainOnly => {
                        blob.push(MODE_TAG_KEYCHAIN_ONLY);
                        blob.extend_from_slice(secret);
                    }
                }

                set_generic_password(KEYSTORE_SERVICE, account, &blob)
                    .map_err(|e| format!("Keychain write failed: {e}"))
            },
            |previous_key: SecKey| {
                // `prepare_custody` (called inside `write_new_blob` above)
                // labels the *new* SE key with the same `se_key_label(account)`
                // the old one has, so for this brief window two SE keys share
                // a label. That is safe to delete through: unlike
                // `kSecAttrAccount`/`kSecAttrService` on generic-password
                // items, `kSecAttrLabel` is not a uniqueness constraint for
                // `kSecClassKey` items — confirmed by reading
                // security-framework 3.7.0's `key.rs`/`item.rs` (Apple keys
                // identify a key item by class + application-label/public-key
                // hash + key type + access group, never by the display
                // label; this crate's own label-based searches, e.g.
                // `find_se_private_key`, only ever use the label as a filter,
                // never as an implied-unique lookup). So we do NOT delete by
                // a fresh label search here (that could just as easily match
                // the brand new key instead of the old one) — we delete the
                // *specific* `SecKey` reference captured before the new key
                // was generated, via `SecKey::delete`, whose `SecItemDelete`
                // query matches on `kSecValueRef` (the exact key object), not
                // on label.
                previous_key
                    .delete()
                    .map_err(|e| format!("could not remove previous Secure Enclave key: {e}"))
            },
        )
    }

    fn load(&self, account: &str) -> Result<Vec<u8>, String> {
        // `Zeroizing`: in the `KeychainOnly` case this buffer holds the raw
        // unencrypted secret end-to-end (Finding 2, HIGH). The final
        // `rest.to_vec()` copy below is unavoidable — `Backend::load` must
        // return a plain `Vec<u8>` (the zeroizing wrapper is applied one
        // layer up, at `mod.rs::load_key`) — but `blob` itself is wiped on
        // drop when this function returns.
        let blob: Zeroizing<Vec<u8>> = Zeroizing::new(
            match generic_password(PasswordOptions::new_generic_password(KEYSTORE_SERVICE, account)) {
                Ok(bytes) => bytes,
                Err(e) if e.code() == ERR_SEC_ITEM_NOT_FOUND => {
                    return Err("No matching entry found in secure storage".to_string())
                }
                Err(e) => return Err(format!("Keychain read failed: {e}")),
            },
        );

        let (&tag, rest) = blob
            .split_first()
            .ok_or_else(|| "stored entry is corrupt (empty)".to_string())?;

        match tag {
            MODE_TAG_KEYCHAIN_ONLY => Ok(rest.to_vec()),
            MODE_TAG_SE_BIOMETRY | MODE_TAG_SE_PRESENCE => {
                let key = find_se_private_key(account)?.ok_or_else(|| {
                    "stored entry expects a Secure Enclave key that is no longer present \
                     on this machine — the secret cannot be recovered here"
                        .to_string()
                })?;
                // Triggers the OS Touch ID / passcode prompt automatically —
                // no code in this module invokes LocalAuthentication itself.
                // `decrypt_data`'s returned `Vec<u8>` *is* this function's
                // raw-secret return value directly — no separate buffer of
                // ours sits behind it, so there is nothing extra to zeroize
                // in this arm.
                key.decrypt_data(ECIES_ALGO, rest)
                    .map_err(|e| format!("Secure Enclave decryption failed or was declined: {e}"))
            }
            other => Err(format!("stored entry has unknown custody tag {other}")),
        }
    }

    fn delete(&self, account: &str) -> Result<(), String> {
        delete_se_key(account)?;
        match delete_generic_password(KEYSTORE_SERVICE, account) {
            Ok(()) => Ok(()),
            Err(e) if e.code() == ERR_SEC_ITEM_NOT_FOUND => Ok(()),
            Err(e) => Err(format!("Keychain delete failed: {e}")),
        }
    }

    fn list_ids(&self) -> Result<Vec<String>, String> {
        let result = ItemSearchOptions::new()
            .class(ItemClass::generic_password())
            .service(KEYSTORE_SERVICE)
            .load_attributes(true)
            .limit(Limit::All)
            .search();

        match result {
            Ok(items) => Ok(items
                .into_iter()
                .filter_map(|item| match item {
                    SearchResult::Dict(_) => item.simplify_dict(),
                    _ => None,
                })
                .filter_map(|attrs| attrs.get("acct").cloned())
                .collect()),
            Err(e) if e.code() == ERR_SEC_ITEM_NOT_FOUND => Ok(Vec::new()),
            Err(e) => Err(format!("Keychain list failed: {e}")),
        }
    }
}

/// Current custody mode for `account`, without touching the secret itself.
/// Reads only the blob's mode tag — no decrypt, no Touch ID prompt. `None`
/// if nothing is stored for this account yet.
///
/// Not wired into a Tauri command by this task (Settings UI is forge's job,
/// W-1.3's UI half) — exposed here so that wiring is a small follow-up, not
/// a re-implementation.
#[allow(dead_code)]
pub(super) fn custody_mode(account: &str) -> Result<Option<CustodyMode>, String> {
    let blob = match generic_password(PasswordOptions::new_generic_password(KEYSTORE_SERVICE, account)) {
        Ok(bytes) => bytes,
        Err(e) if e.code() == ERR_SEC_ITEM_NOT_FOUND => return Ok(None),
        Err(e) => return Err(format!("Keychain read failed: {e}")),
    };
    Ok(match blob.first() {
        Some(&MODE_TAG_SE_BIOMETRY) => Some(CustodyMode::SecureEnclaveBiometry),
        Some(&MODE_TAG_SE_PRESENCE) => Some(CustodyMode::SecureEnclaveUserPresence),
        Some(&MODE_TAG_KEYCHAIN_ONLY) => Some(CustodyMode::KeychainOnly),
        _ => None,
    })
}

#[cfg(test)]
mod store_ordering_tests {
    //! Proves the Finding 1 (CRITICAL) invariant on
    //! `store_preserving_old_key_until_write_succeeds` — the pure ordering
    //! logic `SecureEnclaveBackend::store()` is built on. Deliberately free
    //! of any `security_framework`/Keychain/Secure Enclave type so it runs
    //! in a normal headless `cargo test` (no real Keychain, no Touch ID
    //! prompt, no signed-binary entitlements needed).
    //!
    //! What this does NOT prove: `SecureEnclaveBackend::store()` itself is
    //! never exercised by any `cargo test` run — `cfg(test)` always routes
    //! the public `keystore::store_key`/`load_key` functions to `mock.rs`
    //! (see `keystore::backend()`). The wiring from `store()` into this
    //! helper is a two-line, read-it-and-see call (no branching, no
    //! security-framework-specific logic in the wiring itself), so the
    //! authors consider that gap closed by code review rather than by an
    //! automated test — see the task report for the explicit "verified vs.
    //! reasoned about" breakdown.
    use super::*;

    #[test]
    fn deletes_previous_key_only_after_a_successful_write() {
        let mut deleted_with: Option<&'static str> = None;
        let result = store_preserving_old_key_until_write_succeeds(
            || Ok(Some("old-key")),
            || Ok(()),
            |previous| {
                deleted_with = Some(previous);
                Ok(())
            },
        );
        assert!(result.is_ok());
        assert_eq!(deleted_with, Some("old-key"));
    }

    #[test]
    fn never_deletes_previous_key_when_the_write_fails() {
        // This is Finding 1 itself: the bug was deleting the old key before
        // confirming the new blob was written. If this assertion ever
        // fails, the CRITICAL data-loss bug is back.
        let mut delete_was_called = false;
        let result = store_preserving_old_key_until_write_succeeds(
            || Ok(Some("old-key")),
            || Err("simulated keygen/encrypt/keychain-write failure".to_string()),
            |_previous| {
                delete_was_called = true;
                Ok(())
            },
        );
        assert!(result.is_err());
        assert!(
            !delete_was_called,
            "the old key must survive a failed write — this is exactly Finding 1"
        );
    }

    #[test]
    fn does_not_call_delete_when_there_was_no_previous_key() {
        let mut delete_was_called = false;
        let result = store_preserving_old_key_until_write_succeeds(
            || Ok(None::<&'static str>),
            || Ok(()),
            |_previous| {
                delete_was_called = true;
                Ok(())
            },
        );
        assert!(result.is_ok());
        assert!(!delete_was_called);
    }

    #[test]
    fn propagates_find_previous_failure_without_writing_or_deleting() {
        let mut write_was_called = false;
        let mut delete_was_called = false;
        let result = store_preserving_old_key_until_write_succeeds(
            || Err::<Option<&'static str>, _>("lookup failed".to_string()),
            || {
                write_was_called = true;
                Ok(())
            },
            |_previous| {
                delete_was_called = true;
                Ok(())
            },
        );
        assert!(result.is_err());
        assert!(!write_was_called);
        assert!(!delete_was_called);
    }

    #[test]
    fn surfaces_delete_failure_even_though_the_new_write_already_succeeded() {
        // Judgment call (documented in the task report): failing to retire
        // the old key after a successful write does not lose data — the new
        // blob is already valid and loadable — but the failure is still
        // surfaced rather than swallowed, per this project's "no silent
        // failure" rule, so an orphaned SE key doesn't go unnoticed.
        let result = store_preserving_old_key_until_write_succeeds(
            || Ok(Some("old-key")),
            || Ok(()),
            |_previous| Err("could not remove previous Secure Enclave key: simulated".to_string()),
        );
        assert!(result.is_err());
    }
}
