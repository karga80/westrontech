//! W-1.4 — migrate legacy plaintext `*.key` files into the keystore.
//!
//! Same source directory `wallet::keychain::migrate_key_files` already
//! drains (`~/Library/Application Support/Westron/keys/`). If that module's
//! own migration ran first and already emptied the directory, this is a
//! correct, silent no-op — nothing left to move, `MigrationOutcome::default()`
//! is not an error. See `keystore/mod.rs` module doc for why these two
//! migration paths exist side by side in this task and are not merged here.
//!
//! **Rule that matters most, restated:** doğrulama geçmeden asla silme.
//! A file is deleted only after it has been written into the keystore *and*
//! read back and byte-for-byte compared against the original. Any failure at
//! any step leaves the plaintext file exactly where it was.
//!
//! **Not wired into app startup by this task.** `migrate_key_files` is fully
//! implemented and tested against a fake directory + fake store/fetch below,
//! but nothing in `lib.rs` calls it automatically yet, and this session does
//! not run it against the real
//! `~/Library/Application Support/Westron/keys/` directory. Wiring an
//! automatic run at app startup is a follow-up decision, not made here (see
//! task boundary in the session's brief).

use std::path::{Path, PathBuf};

#[derive(Debug, Clone, Default, PartialEq)]
pub struct MigrationOutcome {
    pub migrated: u32,
    pub pending: u32,
    pub last_error: Option<String>,
}

/// The legacy plaintext key directory. Not created here — callers that only
/// want to read or migrate must not bring a fresh install's directory into
/// existence.
#[allow(dead_code)]
pub fn legacy_keys_dir() -> Result<PathBuf, String> {
    let base = dirs_next::data_dir().ok_or_else(|| "Could not determine data directory".to_string())?;
    Ok(base.join("Westron").join("keys"))
}

/// Move every `*.key` file in `dir` into the keystore via `store`/`fetch`.
///
/// Generic over the store/fetch pair — same shape decision
/// `wallet::keychain::migrate_key_files` already made — so this logic is
/// exercised by tests with an injectable fake, and so failure at each step
/// (store fails, read-back mismatches, read-back errors) can be reproduced
/// deterministically instead of only being reachable through real Keychain
/// error conditions.
pub fn migrate_key_files(
    dir: &Path,
    store: &dyn Fn(&str, &[u8]) -> Result<(), String>,
    fetch: &dyn Fn(&str) -> Result<Vec<u8>, String>,
) -> MigrationOutcome {
    let mut out = MigrationOutcome::default();

    let entries = match std::fs::read_dir(dir) {
        Ok(e) => e,
        // No legacy directory at all is the normal case — nothing to do.
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
    names.sort_by(|a, b| a.0.cmp(&b.0));

    for (name, path) in names {
        let contents = match std::fs::read(&path) {
            Ok(c) => c,
            Err(e) => {
                out.pending += 1;
                out.last_error = Some(format!("could not read key file for '{name}': {e}"));
                continue;
            }
        };
        // An all-whitespace file holds no secret; nothing to migrate, nothing
        // to lose by leaving it — don't invent a failure for it.
        if contents.iter().all(u8::is_ascii_whitespace) {
            continue;
        }

        if let Err(e) = store(&name, &contents) {
            out.pending += 1;
            out.last_error = Some(format!("could not store '{name}': {e}"));
            continue;
        }

        match fetch(&name) {
            Ok(back) if back == contents => match zero_and_remove(&path, contents.len()) {
                Ok(()) => out.migrated += 1,
                Err(e) => {
                    // Stored and verified, but the plaintext copy survives —
                    // still a leak, so report it as pending, not migrated.
                    out.pending += 1;
                    out.last_error = Some(format!(
                        "'{name}' is in the keystore but the plaintext file could not be removed: {e}"
                    ));
                }
            },
            Ok(_) => {
                out.pending += 1;
                out.last_error = Some(format!(
                    "'{name}' read back from the keystore did not match the file — \
                     the plaintext file was NOT deleted"
                ));
            }
            Err(e) => {
                out.pending += 1;
                out.last_error = Some(format!(
                    "'{name}' could not be read back from the keystore ({e}) — \
                     the plaintext file was NOT deleted"
                ));
            }
        }
    }

    out
}

/// Overwrite the file's bytes with zeros, flush, then unlink.
///
/// APFS is copy-on-write; overwriting a file's logical content is
/// best-effort here, not a cryptographic erase guarantee — old blocks may
/// still exist on disk until the filesystem reclaims them. Noted explicitly
/// so this is never mistaken for secure wipe, which does not exist at the
/// plain-file-write layer on APFS. `plan` documents this same caveat.
fn zero_and_remove(path: &Path, original_len: usize) -> Result<(), String> {
    let zeros = vec![0u8; original_len];
    std::fs::write(path, &zeros).map_err(|e| e.to_string())?;
    std::fs::remove_file(path).map_err(|e| e.to_string())
}

/// Production entry point: migrates `dir` using the real keystore. Not
/// called automatically anywhere in this codebase yet — see module doc.
#[allow(dead_code)]
pub fn migrate_into_keystore(dir: &Path) -> MigrationOutcome {
    migrate_key_files(
        dir,
        &|id, secret| super::store_key(id, secret),
        &|id| super::load_key(id).map(|z| z.to_vec()),
    )
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::collections::HashMap;
    use std::sync::Mutex as StdMutex;

    fn tmp_dir(tag: &str) -> PathBuf {
        let dir = std::env::temp_dir().join(format!("westron-keystore-migrate-{tag}-{}", uuid::Uuid::new_v4()));
        std::fs::create_dir_all(&dir).unwrap();
        dir
    }

    fn seed(dir: &Path, name: &str, value: &[u8]) {
        std::fs::write(dir.join(format!("{name}.key")), value).unwrap();
    }

    #[derive(Default)]
    struct FakeStore {
        items: StdMutex<HashMap<String, Vec<u8>>>,
    }

    impl FakeStore {
        fn store(&self, name: &str, value: &[u8]) -> Result<(), String> {
            self.items.lock().unwrap().insert(name.to_string(), value.to_vec());
            Ok(())
        }
        fn fetch(&self, name: &str) -> Result<Vec<u8>, String> {
            self.items
                .lock()
                .unwrap()
                .get(name)
                .cloned()
                .ok_or_else(|| "No matching entry found in secure storage".to_string())
        }
    }

    #[test]
    fn migrates_every_key_and_removes_the_plaintext_file() {
        let dir = tmp_dir("ok");
        seed(&dir, "wallet_0xabc", b"0xprivatekey");
        seed(&dir, "alchemy", b"alch-key");
        std::fs::write(dir.join("README.txt"), b"not a key").unwrap();

        let fake = FakeStore::default();
        let out = migrate_key_files(&dir, &|n, v| fake.store(n, v), &|n| fake.fetch(n));

        assert_eq!(out.migrated, 2);
        assert_eq!(out.pending, 0);
        assert!(out.last_error.is_none(), "unexpected error: {:?}", out.last_error);
        assert_eq!(fake.fetch("wallet_0xabc").unwrap(), b"0xprivatekey");
        assert!(!dir.join("wallet_0xabc.key").exists(), "plaintext key survived");
        assert!(dir.join("README.txt").exists(), "non-key file was touched");

        std::fs::remove_dir_all(&dir).ok();
    }

    /// The rule that matters most: never delete a key you have not confirmed
    /// is safely stored elsewhere.
    #[test]
    fn failed_verify_does_not_delete_the_source() {
        let dir = tmp_dir("badverify");
        seed(&dir, "wallet_0xabc", b"0xprivatekey");

        let fake = FakeStore::default();
        let out = migrate_key_files(
            &dir,
            &|n, v| fake.store(n, v),
            &|_n| Ok(b"something-else".to_vec()),
        );

        assert_eq!(out.migrated, 0);
        assert_eq!(out.pending, 1);
        assert!(out.last_error.unwrap().contains("NOT deleted"));
        let path = dir.join("wallet_0xabc.key");
        assert!(path.exists(), "an unverified key must never be deleted");
        assert_eq!(std::fs::read(&path).unwrap(), b"0xprivatekey");

        std::fs::remove_dir_all(&dir).ok();
    }

    #[test]
    fn failed_store_does_not_delete_the_source() {
        let dir = tmp_dir("badstore");
        seed(&dir, "wallet_0xabc", b"0xprivatekey");

        let out = migrate_key_files(
            &dir,
            &|_n, _v| Err("Keychain write failed: user denied access".to_string()),
            &|_n| Err("No matching entry found in secure storage".to_string()),
        );

        assert_eq!(out.migrated, 0);
        assert_eq!(out.pending, 1);
        assert!(out.last_error.unwrap().contains("could not store"));
        assert!(dir.join("wallet_0xabc.key").exists());

        std::fs::remove_dir_all(&dir).ok();
    }

    #[test]
    fn failed_readback_does_not_delete_the_source() {
        let dir = tmp_dir("badread");
        seed(&dir, "wallet_0xabc", b"0xprivatekey");

        let out = migrate_key_files(
            &dir,
            &|_n, _v| Ok(()),
            &|_n| Err("Keychain read failed: interaction not allowed".to_string()),
        );

        assert_eq!(out.migrated, 0);
        assert_eq!(out.pending, 1);
        assert!(out.last_error.unwrap().contains("NOT deleted"));
        assert!(dir.join("wallet_0xabc.key").exists());

        std::fs::remove_dir_all(&dir).ok();
    }

    /// Partial success: one key migrates, one fails verification — the
    /// failure must not roll back or block the success, and both must be
    /// reported accurately.
    #[test]
    fn partial_success_migrates_what_it_can_and_leaves_the_rest() {
        let dir = tmp_dir("partial");
        seed(&dir, "wallet_0xaaa", b"good-key");
        seed(&dir, "wallet_0xbbb", b"bad-key");

        let fake = FakeStore::default();
        let out = migrate_key_files(
            &dir,
            &|n, v| fake.store(n, v),
            &|n| {
                if n == "wallet_0xbbb" {
                    Err("simulated read-back failure".to_string())
                } else {
                    fake.fetch(n)
                }
            },
        );

        assert_eq!(out.migrated, 1);
        assert_eq!(out.pending, 1);
        assert!(!dir.join("wallet_0xaaa.key").exists());
        assert!(dir.join("wallet_0xbbb.key").exists());

        std::fs::remove_dir_all(&dir).ok();
    }

    #[test]
    fn missing_directory_is_not_an_error() {
        let dir = tmp_dir("missing");
        std::fs::remove_dir_all(&dir).ok();
        let out = migrate_key_files(&dir, &|_n, _v| Ok(()), &|_n| Ok(Vec::new()));
        assert_eq!(out, MigrationOutcome::default());
    }

    #[test]
    fn empty_key_files_are_left_alone_and_not_counted() {
        let dir = tmp_dir("empty");
        seed(&dir, "alchemy", b"   \n");

        let fake = FakeStore::default();
        let out = migrate_key_files(&dir, &|n, v| fake.store(n, v), &|n| fake.fetch(n));

        assert_eq!(out, MigrationOutcome::default());
        assert!(dir.join("alchemy.key").exists(), "an empty file is left in place, not deleted");

        std::fs::remove_dir_all(&dir).ok();
    }

    /// This test exercises `migrate_into_keystore`, i.e. the real
    /// `store_key`/`load_key` dispatch — which under `cfg(test)` resolves to
    /// the in-memory mock backend (see `keystore::backend()`), never the
    /// real macOS Keychain. This is the one test in this file that proves
    /// the *production* wiring (`migrate_into_keystore`), not just the
    /// injectable-closure logic above.
    #[test]
    fn migrate_into_keystore_uses_the_real_store_key_load_key_pair() {
        crate::keystore::mock::MockBackend::reset();
        let dir = tmp_dir("prod-wiring");
        seed(&dir, "wallet_0xccc", b"real-wiring-secret");

        let out = migrate_into_keystore(&dir);

        assert_eq!(out.migrated, 1);
        assert_eq!(out.pending, 0);
        let loaded = super::super::load_key("wallet_0xccc").unwrap();
        assert_eq!(&loaded[..], b"real-wiring-secret");
        assert!(!dir.join("wallet_0xccc.key").exists());

        std::fs::remove_dir_all(&dir).ok();
    }
}
