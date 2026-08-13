//! In-memory keystore backend — never used for a real app build. Exists
//! because CI has no macOS Keychain and no way to answer a Touch ID prompt;
//! W-1.8(a) requires this exact escape hatch.
//!
//! Thread-local, not process-wide. `cargo test`'s default test harness runs
//! tests in parallel on multiple OS threads; a process-wide `static` store
//! meant one test's `MockBackend::reset()` could race with and wipe another
//! *concurrently-running* test's data — confirmed flaky (~1-in-4 runs) under
//! default parallelism, reliable only with `--test-threads=1`. A single OS
//! thread only ever executes one test's code at a time (that's true whether
//! the harness spawns a fresh thread per test or reuses a small pool
//! sequentially — either way, two tests never run concurrently on the same
//! thread), so keying the store by thread eliminates the race: two tests
//! racing each other are, by construction, on two different threads and
//! therefore two different maps. `reset()` is still called at the start of
//! every test (unchanged) as a defence against a thread being reused for a
//! *later, non-concurrent* test. Within one test, every call still sees the
//! same store (the property callers rely on — code under test that calls
//! the public `keystore::store_key`/`load_key` functions through several
//! call sites still sees the same data, matching how the real Keychain
//! backend behaves, keyed by service+account rather than by any handle the
//! caller holds), because a test's own code all runs on its own thread.

use std::cell::RefCell;
use std::collections::HashMap;

use super::Backend;

thread_local! {
    static STORE: RefCell<HashMap<String, Vec<u8>>> = RefCell::new(HashMap::new());
}

pub struct MockBackend;

impl MockBackend {
    pub fn shared() -> Self {
        Self
    }

    /// Clear all entries on the *current thread's* store. Tests call this
    /// first so they don't see leftovers from an earlier test that happens
    /// to run on the same thread (not simultaneously — `cargo test` never
    /// reuses a thread across concurrently-running tests, but a single
    /// thread does run its assigned tests one after another).
    pub fn reset() {
        STORE.with(|s| s.borrow_mut().clear());
    }
}

impl Backend for MockBackend {
    fn store(&self, account: &str, secret: &[u8]) -> Result<(), String> {
        STORE.with(|s| {
            s.borrow_mut().insert(account.to_string(), secret.to_vec());
        });
        Ok(())
    }

    fn load(&self, account: &str) -> Result<Vec<u8>, String> {
        STORE.with(|s| {
            s.borrow()
                .get(account)
                .cloned()
                .ok_or_else(|| super::NOT_FOUND.to_string())
        })
    }

    fn delete(&self, account: &str) -> Result<(), String> {
        STORE.with(|s| {
            s.borrow_mut().remove(account);
        });
        Ok(())
    }

    fn list_ids(&self) -> Result<Vec<String>, String> {
        STORE.with(|s| {
            let mut ids: Vec<String> = s.borrow().keys().cloned().collect();
            ids.sort();
            Ok(ids)
        })
    }
}
