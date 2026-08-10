//! Secret storage for wallet private keys and third-party API keys.
//!
//! On macOS every secret lives in the login Keychain as a generic-password
//! item under service `Westron`, with the existing key name as the account.
//! Nothing sensitive is written to disk by this module on that platform.
//!
//! Until this change the module was named "keychain" but wrote
//! `~/Library/Application Support/Westron/keys/<name>.key` with
//! `std::fs::write` — i.e. under the process umask, typically 0644,
//! world-readable — and `wallet_<address>.key` held a **raw private key in
//! plaintext**. Both the product's positioning ("your keys stay on your
//! machine") and CLAUDE.md's immutable rules require the Keychain. Existing
//! files are migrated automatically on first run; see `migrate_key_files`.
//!
//! Non-macOS builds keep a file backend so the crate compiles and tests
//! everywhere, but files are created with mode 0600 *at creation time*
//! (`create_new` + `mode`), never `write`-then-chmod, so the secret never
//! exists on disk with looser permissions.

use std::path::{Path, PathBuf};
use std::sync::{Mutex, OnceLock};

use serde::{Deserialize, Serialize};

/// Keychain service name for every Westron generic-password item.
/// Also the `-s` argument to `security find-generic-password` — see
/// `probes/alchemy-prices-probe.sh`.
#[cfg_attr(not(target_os = "macos"), allow(dead_code))]
pub const KEYCHAIN_SERVICE: &str = "Westron";

// ── Status ────────────────────────────────────────────────────────────────────

/// What the secret store is doing right now — surfaced on the control server's
/// `GET /status` and via the `get_keychain_status` Tauri command so the UI can
/// tell the user if a plaintext key file is still sitting on their disk.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct KeychainStatus {
    /// `"keychain"` on macOS, `"file"` on every other platform.
    pub backend: String,
    /// Plaintext key files successfully moved into the Keychain and deleted.
    pub migrated: u32,
    /// Plaintext key files still on disk because the move could not be verified.
    pub pending: u32,
    /// Last migration failure, if any. Never contains key material.
    pub last_error: Option<String>,
}

/// Result of one migration sweep.
#[derive(Debug, Clone, Default, PartialEq)]
#[cfg_attr(not(target_os = "macos"), allow(dead_code))]
pub struct MigrationOutcome {
    pub migrated: u32,
    pub pending: u32,
    pub last_error: Option<String>,
}

fn status_cell() -> &'static Mutex<KeychainStatus> {
    static CELL: OnceLock<Mutex<KeychainStatus>> = OnceLock::new();
    CELL.get_or_init(|| {
        Mutex::new(KeychainStatus {
            backend: backend_name().to_string(),
            migrated: 0,
            pending: 0,
            last_error: None,
        })
    })
}

const fn backend_name() -> &'static str {
    #[cfg(target_os = "macos")]
    {
        "keychain"
    }
    #[cfg(not(target_os = "macos"))]
    {
        "file"
    }
}

/// Current backend and one-time-migration progress.
///
/// Safe and cheap to call from anywhere: it runs the migration once (on macOS)
/// and thereafter just reads the recorded counters.
pub fn keychain_status() -> KeychainStatus {
    ensure_migrated();
    status_cell().lock().unwrap().clone()
}

// ── File backend (non-macOS, and the source of the macOS migration) ───────────

/// The legacy plaintext key directory. Not created by this function — callers
/// that only want to *read* or migrate must not bring it into existence.
fn keys_dir_path() -> Result<PathBuf, String> {
    let base = dirs_next::data_dir()
        .ok_or_else(|| "Could not determine data directory".to_string())?;
    Ok(base.join("Westron").join("keys"))
}

#[cfg(not(target_os = "macos"))]
fn keys_dir_ensure() -> Result<PathBuf, String> {
    let dir = keys_dir_path()?;
    std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    Ok(dir)
}

#[allow(dead_code)]
fn key_file(dir: &Path, name: &str) -> PathBuf {
    dir.join(format!("{name}.key"))
}

/// Write a secret to `dir/<name>.key` with mode 0600 at creation time.
#[allow(dead_code)]
fn file_store_in(dir: &Path, name: &str, value: &str) -> Result<(), String> {
    crate::persist::write_private_atomic(&key_file(dir, name), value.as_bytes())
}

#[allow(dead_code)]
fn file_fetch_in(dir: &Path, name: &str) -> Result<String, String> {
    let path = key_file(dir, name);
    if !path.exists() {
        return Err("No matching entry found in secure storage".to_string());
    }
    std::fs::read_to_string(&path).map_err(|e| e.to_string())
}

#[allow(dead_code)]
fn file_delete_in(dir: &Path, name: &str) -> Result<(), String> {
    let path = key_file(dir, name);
    if path.exists() {
        std::fs::remove_file(&path).map_err(|e| e.to_string())?;
    }
    Ok(())
}

#[cfg(not(target_os = "macos"))]
fn file_store(name: &str, value: &str) -> Result<(), String> {
    file_store_in(&keys_dir_ensure()?, name, value)
}

#[cfg(not(target_os = "macos"))]
fn file_fetch(name: &str) -> Result<String, String> {
    file_fetch_in(&keys_dir_path()?, name)
}

#[cfg(not(target_os = "macos"))]
fn file_delete(name: &str) -> Result<(), String> {
    file_delete_in(&keys_dir_path()?, name)
}

// ── macOS Keychain backend ───────────────────────────────────────────────────

#[cfg(target_os = "macos")]
mod mac {
    use security_framework::passwords::{
        delete_generic_password, generic_password, set_generic_password, PasswordOptions,
    };

    /// `errSecItemNotFound` — the item simply is not in the Keychain.
    const ERR_SEC_ITEM_NOT_FOUND: i32 = -25300;

    pub fn store(name: &str, value: &str) -> Result<(), String> {
        set_generic_password(super::KEYCHAIN_SERVICE, name, value.as_bytes())
            .map_err(|e| format!("Keychain write failed: {e}"))
    }

    pub fn fetch(name: &str) -> Result<String, String> {
        match generic_password(PasswordOptions::new_generic_password(
            super::KEYCHAIN_SERVICE,
            name,
        )) {
            Ok(bytes) => String::from_utf8(bytes)
                .map_err(|_| "Keychain entry is not valid UTF-8".to_string()),
            Err(e) if e.code() == ERR_SEC_ITEM_NOT_FOUND => {
                Err("No matching entry found in secure storage".to_string())
            }
            Err(e) => Err(format!("Keychain read failed: {e}")),
        }
    }

    /// Deleting something that is not there is success — callers use this to
    /// clear a key they may never have set.
    pub fn delete(name: &str) -> Result<(), String> {
        match delete_generic_password(super::KEYCHAIN_SERVICE, name) {
            Ok(()) => Ok(()),
            Err(e) if e.code() == ERR_SEC_ITEM_NOT_FOUND => Ok(()),
            Err(e) => Err(format!("Keychain delete failed: {e}")),
        }
    }
}

// ── One-time migration: plaintext files → Keychain ───────────────────────────

/// Move every `*.key` file in `dir` into the secret store.
///
/// The ordering is the point: write, **read back and compare**, and only then
/// unlink the plaintext file. A key that cannot be confirmed present in its new
/// home is left exactly where it was and counted as `pending` — deleting it
/// would destroy the user's wallet.
///
/// Generic over the store/fetch pair so the logic is exercised by tests on
/// platforms with no Keychain (see the tests at the bottom of this file).
#[cfg_attr(not(target_os = "macos"), allow(dead_code))]
pub(crate) fn migrate_key_files(
    dir: &Path,
    store: &dyn Fn(&str, &str) -> Result<(), String>,
    fetch: &dyn Fn(&str) -> Result<String, String>,
) -> MigrationOutcome {
    let mut out = MigrationOutcome::default();

    let entries = match std::fs::read_dir(dir) {
        Ok(e) => e,
        // No legacy directory at all is the normal case on a fresh install.
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => return out,
        Err(e) => {
            out.last_error = Some(format!("could not read {}: {e}", dir.display()));
            return out;
        }
    };

    let mut names: Vec<(String, PathBuf)> = Vec::new();
    for entry in entries.flatten() {
        let path = entry.path();
        if path.extension().and_then(|e| e.to_str()) != Some("key") {
            continue;
        }
        if let Some(stem) = path.file_stem().and_then(|s| s.to_str()) {
            names.push((stem.to_string(), path));
        }
    }
    // Deterministic order so logs and test assertions are stable.
    names.sort_by(|a, b| a.0.cmp(&b.0));

    for (name, path) in names {
        let contents = match std::fs::read_to_string(&path) {
            Ok(c) => c,
            Err(e) => {
                out.pending += 1;
                out.last_error = Some(format!("could not read key file for '{name}': {e}"));
                continue;
            }
        };
        // An empty file holds no secret; there is nothing to migrate and
        // nothing to lose. Leave it alone rather than inventing a failure.
        if contents.trim().is_empty() {
            continue;
        }

        if let Err(e) = store(&name, &contents) {
            out.pending += 1;
            out.last_error = Some(format!("could not store '{name}': {e}"));
            continue;
        }
        match fetch(&name) {
            Ok(ref back) if back == &contents => {
                if let Err(e) = std::fs::remove_file(&path) {
                    // Stored and verified, but the plaintext copy survives.
                    // That is still a leak, so report it as pending.
                    out.pending += 1;
                    out.last_error = Some(format!(
                        "'{name}' is in secure storage but the plaintext file could not be removed: {e}"
                    ));
                    continue;
                }
                out.migrated += 1;
            }
            Ok(_) => {
                out.pending += 1;
                out.last_error = Some(format!(
                    "'{name}' read back from secure storage did not match the file — \
                     the plaintext file was NOT deleted"
                ));
            }
            Err(e) => {
                out.pending += 1;
                out.last_error = Some(format!(
                    "'{name}' could not be read back from secure storage ({e}) — \
                     the plaintext file was NOT deleted"
                ));
            }
        }
    }

    out
}

/// Run the migration at most once per process, recording the outcome for
/// `keychain_status()`. A no-op on platforms with no Keychain.
fn ensure_migrated() {
    static ONCE: OnceLock<()> = OnceLock::new();
    ONCE.get_or_init(|| {
        #[cfg(target_os = "macos")]
        {
            let dir = match keys_dir_path() {
                Ok(d) => d,
                Err(e) => {
                    let mut st = status_cell().lock().unwrap();
                    st.last_error = Some(e);
                    return;
                }
            };
            let out = migrate_key_files(&dir, &mac::store, &mac::fetch);

            // Counts only — never key material, never file contents.
            if out.migrated > 0 || out.pending > 0 {
                log::info!(
                    "keychain migration: {} key(s) moved into the macOS Keychain, {} left on disk",
                    out.migrated,
                    out.pending
                );
            }
            if let Some(err) = out.last_error.as_deref() {
                log::error!("keychain migration incomplete — plaintext key file(s) remain: {err}");
            }

            let mut st = status_cell().lock().unwrap();
            st.migrated = out.migrated;
            st.pending = out.pending;
            st.last_error = out.last_error;
        }
    });
}

// ── Backend dispatch ─────────────────────────────────────────────────────────

fn store_secret(name: &str, value: &str) -> Result<(), String> {
    ensure_migrated();
    #[cfg(target_os = "macos")]
    {
        mac::store(name, value)
    }
    #[cfg(not(target_os = "macos"))]
    {
        file_store(name, value)
    }
}

fn fetch_secret(name: &str) -> Result<String, String> {
    ensure_migrated();
    #[cfg(target_os = "macos")]
    {
        mac::fetch(name)
    }
    #[cfg(not(target_os = "macos"))]
    {
        file_fetch(name)
    }
}

fn delete_secret(name: &str) -> Result<(), String> {
    ensure_migrated();
    #[cfg(target_os = "macos")]
    {
        mac::delete(name)
    }
    #[cfg(not(target_os = "macos"))]
    {
        file_delete(name)
    }
}

// ── Wallet private keys ───────────────────────────────────────────────────────

/// Keychain accounts are exact-match strings, but an Ethereum address has two
/// equally valid spellings (checksummed and lowercase). Keying on the raw
/// spelling meant a wallet stored as `0x9Ec1…` could not be found when looked
/// up as `0x9ec1…`, and signing would fail with "key not found" at transfer
/// time. All new entries are keyed lowercase; reads fall back to the raw
/// spelling so entries written by older builds still resolve.
fn key_account(address: &str) -> String {
    format!("wallet_{}", address.trim().to_lowercase())
}

fn legacy_key_account(address: &str) -> String {
    format!("wallet_{}", address.trim())
}

pub fn store_key(address: &str, private_key_hex: &str) -> Result<(), String> {
    store_secret(&key_account(address), private_key_hex)
}

pub fn fetch_key(address: &str) -> Result<String, String> {
    match fetch_secret(&key_account(address)) {
        Ok(k) => Ok(k),
        Err(e) => fetch_secret(&legacy_key_account(address)).map_err(|_| e),
    }
}

#[allow(dead_code)]
pub fn delete_key(address: &str) -> Result<(), String> {
    let primary = delete_secret(&key_account(address));
    // A legacy entry may exist under the original spelling; remove it too so a
    // deleted wallet cannot leave a key behind.
    let _ = delete_secret(&legacy_key_account(address));
    primary
}

// ── Alchemy API key ───────────────────────────────────────────────────────────

pub fn store_alchemy_key(api_key: &str) -> Result<(), String> {
    store_secret("alchemy", &super::api_key::normalize_api_key(api_key))
}

/// Normalised on read as well as on write, so a key stored as a full endpoint
/// URL by an older build starts working without the user re-entering it.
pub fn fetch_alchemy_key() -> Result<String, String> {
    fetch_secret("alchemy").map(|k| super::api_key::normalize_api_key(&k))
}

pub fn delete_alchemy_key() -> Result<(), String> {
    delete_secret("alchemy")
}

// ── OpenSea API key ───────────────────────────────────────────────────────────

pub fn store_opensea_key(api_key: &str) -> Result<(), String> {
    store_secret("opensea", &super::api_key::normalize_api_key(api_key))
}

pub fn fetch_opensea_key() -> Result<String, String> {
    fetch_secret("opensea").map(|k| super::api_key::normalize_api_key(&k))
}

pub fn delete_opensea_key() -> Result<(), String> {
    delete_secret("opensea")
}

// ── Etherscan API key ─────────────────────────────────────────────────────────

pub fn store_etherscan_key(api_key: &str) -> Result<(), String> {
    store_secret("etherscan", &super::api_key::normalize_api_key(api_key))
}

pub fn fetch_etherscan_key() -> Result<String, String> {
    fetch_secret("etherscan").map(|k| super::api_key::normalize_api_key(&k))
}

pub fn delete_etherscan_key() -> Result<(), String> {
    delete_secret("etherscan")
}

// ── Subscription session token ────────────────────────────────────────────────
// Holds the subscription module's own JSON-encoded `{token, account_id,
// email}` bundle. This module doesn't know or care about that shape — it only
// stores and returns a string, same as every other secret here.

pub fn store_subscription_token(session_json: &str) -> Result<(), String> {
    store_secret("subscription_token", session_json)
}

pub fn fetch_subscription_token() -> Result<String, String> {
    fetch_secret("subscription_token")
}

pub fn delete_subscription_token() -> Result<(), String> {
    delete_secret("subscription_token")
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::collections::HashMap;
    use std::sync::Mutex as StdMutex;

    fn tmp_dir(tag: &str) -> PathBuf {
        let dir = std::env::temp_dir().join(format!("westron-{tag}-{}", uuid::Uuid::new_v4()));
        std::fs::create_dir_all(&dir).unwrap();
        dir
    }

    fn seed(dir: &Path, name: &str, value: &str) {
        std::fs::write(key_file(dir, name), value).unwrap();
    }

    /// In-memory stand-in for the Keychain, so the migration logic is exercised
    /// on platforms that have none.
    #[derive(Default)]
    struct FakeStore {
        items: StdMutex<HashMap<String, String>>,
    }

    impl FakeStore {
        fn store(&self, name: &str, value: &str) -> Result<(), String> {
            self.items
                .lock()
                .unwrap()
                .insert(name.to_string(), value.to_string());
            Ok(())
        }
        fn fetch(&self, name: &str) -> Result<String, String> {
            self.items
                .lock()
                .unwrap()
                .get(name)
                .cloned()
                .ok_or_else(|| "No matching entry found in secure storage".to_string())
        }
    }

    // ── File backend behaviour (the non-macOS path, and the migration source) ──

    #[test]
    fn file_backend_round_trips_and_deletes() {
        let dir = tmp_dir("keys-roundtrip");
        assert!(file_fetch_in(&dir, "alchemy").is_err(), "missing key must error");

        file_store_in(&dir, "alchemy", "abc123").unwrap();
        assert_eq!(file_fetch_in(&dir, "alchemy").unwrap(), "abc123");

        // Overwrite must work — settings can be re-saved.
        file_store_in(&dir, "alchemy", "def456").unwrap();
        assert_eq!(file_fetch_in(&dir, "alchemy").unwrap(), "def456");

        file_delete_in(&dir, "alchemy").unwrap();
        assert!(file_fetch_in(&dir, "alchemy").is_err());
        // Deleting a key that is not there is not an error.
        file_delete_in(&dir, "alchemy").unwrap();

        std::fs::remove_dir_all(&dir).ok();
    }

    /// The regression this whole change exists for: a key file must never sit
    /// on disk world-readable, not even for the instant between create and
    /// chmod. Asserted immediately after creation, with no chmod in between.
    #[cfg(unix)]
    #[test]
    fn key_file_is_created_with_mode_0600() {
        use std::os::unix::fs::PermissionsExt;

        let dir = tmp_dir("keys-mode");
        file_store_in(&dir, "wallet_0xabc", "0xdeadbeef").unwrap();

        let mode = std::fs::metadata(key_file(&dir, "wallet_0xabc"))
            .unwrap()
            .permissions()
            .mode()
            & 0o777;
        assert_eq!(mode, 0o600, "key file mode was {mode:o}, expected 600");

        // Re-saving the same key must not widen it either.
        file_store_in(&dir, "wallet_0xabc", "0xfeedface").unwrap();
        let mode = std::fs::metadata(key_file(&dir, "wallet_0xabc"))
            .unwrap()
            .permissions()
            .mode()
            & 0o777;
        assert_eq!(mode, 0o600, "after rewrite the mode was {mode:o}, expected 600");

        std::fs::remove_dir_all(&dir).ok();
    }

    // ── Migration ─────────────────────────────────────────────────────────────

    #[test]
    fn migration_moves_every_key_and_removes_the_plaintext() {
        let dir = tmp_dir("keys-migrate");
        seed(&dir, "wallet_0xabc", "0xprivatekey");
        seed(&dir, "alchemy", "alch-key");
        seed(&dir, "opensea", "os-key");
        // Unrelated files must be ignored entirely.
        std::fs::write(dir.join("README.txt"), "not a key").unwrap();

        let fake = FakeStore::default();
        let out = migrate_key_files(
            &dir,
            &|n, v| fake.store(n, v),
            &|n| fake.fetch(n),
        );

        assert_eq!(out.migrated, 3);
        assert_eq!(out.pending, 0);
        assert!(out.last_error.is_none(), "unexpected error: {:?}", out.last_error);

        assert_eq!(fake.fetch("wallet_0xabc").unwrap(), "0xprivatekey");
        assert!(!key_file(&dir, "wallet_0xabc").exists(), "plaintext key survived");
        assert!(!key_file(&dir, "alchemy").exists());
        assert!(dir.join("README.txt").exists(), "non-key file was touched");

        std::fs::remove_dir_all(&dir).ok();
    }

    /// The rule that matters most: never delete a private key you have not
    /// confirmed is stored elsewhere.
    #[test]
    fn failed_verify_does_not_delete_the_source() {
        let dir = tmp_dir("keys-badverify");
        seed(&dir, "wallet_0xabc", "0xprivatekey");

        let fake = FakeStore::default();
        // Store succeeds, but read-back returns something else.
        let out = migrate_key_files(
            &dir,
            &|n, v| fake.store(n, v),
            &|_n| Ok("something-else".to_string()),
        );

        assert_eq!(out.migrated, 0);
        assert_eq!(out.pending, 1);
        assert!(out.last_error.unwrap().contains("NOT deleted"));
        assert!(
            key_file(&dir, "wallet_0xabc").exists(),
            "an unverified key must never be deleted"
        );
        assert_eq!(
            std::fs::read_to_string(key_file(&dir, "wallet_0xabc")).unwrap(),
            "0xprivatekey"
        );

        std::fs::remove_dir_all(&dir).ok();
    }

    #[test]
    fn failed_store_does_not_delete_the_source() {
        let dir = tmp_dir("keys-badstore");
        seed(&dir, "wallet_0xabc", "0xprivatekey");

        let out = migrate_key_files(
            &dir,
            &|_n, _v| Err("Keychain write failed: user denied access".to_string()),
            &|_n| Err("No matching entry found in secure storage".to_string()),
        );

        assert_eq!(out.migrated, 0);
        assert_eq!(out.pending, 1);
        assert!(out.last_error.unwrap().contains("could not store"));
        assert!(key_file(&dir, "wallet_0xabc").exists());

        std::fs::remove_dir_all(&dir).ok();
    }

    #[test]
    fn failed_readback_does_not_delete_the_source() {
        let dir = tmp_dir("keys-badread");
        seed(&dir, "wallet_0xabc", "0xprivatekey");

        let out = migrate_key_files(
            &dir,
            &|_n, _v| Ok(()),
            &|_n| Err("Keychain read failed: interaction not allowed".to_string()),
        );

        assert_eq!(out.migrated, 0);
        assert_eq!(out.pending, 1);
        assert!(out.last_error.unwrap().contains("NOT deleted"));
        assert!(key_file(&dir, "wallet_0xabc").exists());

        std::fs::remove_dir_all(&dir).ok();
    }

    #[test]
    fn migration_is_idempotent_and_a_missing_directory_is_not_an_error() {
        let dir = tmp_dir("keys-idempotent");
        seed(&dir, "alchemy", "alch-key");

        let fake = FakeStore::default();
        let first = migrate_key_files(&dir, &|n, v| fake.store(n, v), &|n| fake.fetch(n));
        assert_eq!(first.migrated, 1);

        let second = migrate_key_files(&dir, &|n, v| fake.store(n, v), &|n| fake.fetch(n));
        assert_eq!(second, MigrationOutcome::default(), "second sweep must be a no-op");

        std::fs::remove_dir_all(&dir).ok();
        let gone = migrate_key_files(&dir, &|n, v| fake.store(n, v), &|n| fake.fetch(n));
        assert_eq!(gone, MigrationOutcome::default());
    }

    #[test]
    fn empty_key_files_are_left_alone_and_not_counted() {
        let dir = tmp_dir("keys-empty");
        seed(&dir, "alchemy", "   \n");

        let fake = FakeStore::default();
        let out = migrate_key_files(&dir, &|n, v| fake.store(n, v), &|n| fake.fetch(n));

        assert_eq!(out, MigrationOutcome::default());
        assert!(fake.fetch("alchemy").is_err(), "an empty file is not a secret");

        std::fs::remove_dir_all(&dir).ok();
    }

    #[test]
    fn status_reports_the_backend_for_this_platform() {
        let st = keychain_status();
        #[cfg(target_os = "macos")]
        assert_eq!(st.backend, "keychain");
        #[cfg(not(target_os = "macos"))]
        assert_eq!(st.backend, "file", "non-macOS builds keep the 0600 file backend");
    }
}
