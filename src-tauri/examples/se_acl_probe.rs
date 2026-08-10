//! T19 W-0.4 probe: does `SecAccessControl::create_with_flags` vs
//! `create_with_protection` change whether
//! `kSecAccessControlBiometryCurrentSet | kSecAccessControlPrivateKeyUsage`
//! is accepted, and does a Secure Enclave P-256 key actually generate under
//! that ACL?
//!
//! Run: `cargo run --example se_acl_probe` from `src-tauri/`.
//! Output is also saved verbatim into `probes/se-acl-probe-t19.md`.
//!
//! macOS only — this crate only pulls in `security-framework` on
//! `target_os = "macos"` (see `Cargo.toml`), so this example does not build
//! elsewhere.

#[cfg(target_os = "macos")]
fn main() {
    use core_foundation::base::CFOptionFlags;
    use security_framework::access_control::SecAccessControl;
    use security_framework::key::{GenerateKeyOptions, KeyType, SecKey, Token};
    use security_framework_sys::access_control::{
        kSecAccessControlBiometryCurrentSet, kSecAccessControlPrivateKeyUsage,
    };

    let flags: CFOptionFlags = kSecAccessControlBiometryCurrentSet | kSecAccessControlPrivateKeyUsage;
    println!("flags = {:#x} (BiometryCurrentSet | PrivateKeyUsage)", flags);

    // ── Attempt 1: create_with_flags ────────────────────────────────────
    println!("\n--- create_with_flags ---");
    match SecAccessControl::create_with_flags(flags) {
        Ok(acl) => {
            println!("SecAccessControl::create_with_flags: OK ({acl:?})");
            try_generate_se_key("create_with_flags", acl);
        }
        Err(e) => println!("SecAccessControl::create_with_flags: ERR {e:?}"),
    }

    // ── Attempt 2: create_with_protection(None, flags) ──────────────────
    // Reading security-framework 3.7.0 source (access_control.rs) shows
    // `create_with_flags(flags)` is literally implemented as
    // `create_with_protection(None, flags)` — so at the Rust API level these
    // two calls are identical when protection is None. The only way
    // `create_with_protection` differs is when an explicit `ProtectionMode`
    // is passed instead of the default `AccessibleWhenUnlocked`. We probe
    // both the None case (should be identical to attempt 1) and an explicit
    // `AccessibleWhenUnlockedThisDeviceOnly` case, which is the mode this
    // project actually wants for wallet keys (device-local, no iCloud sync).
    println!("\n--- create_with_protection(None, flags) ---");
    match SecAccessControl::create_with_protection(None, flags) {
        Ok(acl) => {
            println!("create_with_protection(None, ..): OK ({acl:?})");
            try_generate_se_key("create_with_protection(None)", acl);
        }
        Err(e) => println!("create_with_protection(None, ..): ERR {e:?}"),
    }

    println!("\n--- create_with_protection(AccessibleWhenUnlockedThisDeviceOnly, flags) ---");
    match SecAccessControl::create_with_protection(
        Some(security_framework::access_control::ProtectionMode::AccessibleWhenUnlockedThisDeviceOnly),
        flags,
    ) {
        Ok(acl) => {
            println!("create_with_protection(ThisDeviceOnly, ..): OK ({acl:?})");
            try_generate_se_key("create_with_protection(ThisDeviceOnly)", acl);
        }
        Err(e) => println!("create_with_protection(ThisDeviceOnly, ..): ERR {e:?}"),
    }

    fn try_generate_se_key(label: &str, acl: SecAccessControl) {
        let mut opts = GenerateKeyOptions::default();
        opts.set_key_type(KeyType::ec());
        opts.set_token(Token::SecureEnclave);
        opts.set_access_control(acl);
        opts.set_label(format!("westron-t19-probe-{label}"));

        match SecKey::new(&opts) {
            Ok(_key) => println!("  -> SE P-256 keygen under [{label}] ACL: OK"),
            Err(e) => println!("  -> SE P-256 keygen under [{label}] ACL: ERR {e:?}"),
        }
    }
}

#[cfg(not(target_os = "macos"))]
fn main() {
    println!("se_acl_probe is macOS-only; nothing to probe on this platform.");
}
