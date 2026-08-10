//! T19 — does `keystore::mac`'s Secure Enclave backend actually trigger the
//! real macOS Touch ID / passcode prompt when decrypting a stored secret on
//! real hardware, and does the round-trip return the exact bytes that were
//! stored?
//!
//! `probes/se-acl-probe-t19.md` already confirmed SE P-256 keygen succeeds
//! under the chosen ACL, but that probe never called `store_key`/`load_key`
//! and never exercised encrypt/decrypt — so it could not observe a Touch ID
//! prompt. This probe closes that gap.
//!
//! This is a THROWAWAY manual probe, not an automated test:
//! - It writes one real, clearly-synthetic entry to the real macOS Keychain
//!   under `keystore::KEYSTORE_SERVICE` ("com.westron.wallet").
//! - It WILL block waiting for a human to approve a Touch ID / passcode
//!   prompt. A headless agent/CI run cannot answer that prompt — do not run
//!   this from an automated context.
//! - It always attempts to delete the entry afterward, on both the success
//!   and failure paths, so nothing is left behind in the real Keychain.
//!
//! Run: `cargo run --example keystore_touchid_probe` from `src-tauri/`.
//! A human must be physically at this Mac to approve the Touch ID / passcode
//! prompt when it appears.
//!
//! macOS only — the SE-backed `keystore::mac` backend only compiles on
//! `target_os = "macos"` (see `src/keystore/mod.rs`), so this example does
//! not build elsewhere.

#[cfg(target_os = "macos")]
fn main() {
    use app_lib::keystore::{CustodyMode, custody_mode, delete_key, load_key, store_key};

    // Clearly synthetic — never anything resembling a real wallet address or
    // real key material. This id/secret pair exists only for this probe.
    const ACCOUNT: &str = "touchid-probe-do-not-use";
    const SECRET: &[u8] = b"touch-id-probe-throwaway-secret-not-a-real-key";

    println!("=== T19 Touch ID / Secure Enclave round-trip probe ===");
    println!("Bu bir test aracıdır, gerçek bir cüzdan işlemi değildir.\n");

    println!("Secure Enclave anahtarı üretiliyor ve test verisi şifreleniyor...");
    match store_key(ACCOUNT, SECRET) {
        Ok(()) => println!("Yazma tamamlandı."),
        Err(e) => {
            println!("HATA: store_key başarısız oldu: {e}");
            println!("\nSONUÇ: BAŞARISIZ — anahtar hiç yazılamadı, Touch ID adımına ulaşılmadı.");
            // Nothing was necessarily written, but attempt cleanup anyway in
            // case a partial entry was left by the failed store.
            cleanup(ACCOUNT);
            std::process::exit(1);
        }
    }

    let mode = match custody_mode(ACCOUNT) {
        Ok(Some(mode)) => {
            println!("Kullanılan custody modu: {mode}");
            Some(mode)
        }
        Ok(None) => {
            println!("UYARI: Kayıt bulunamadı (custody_mode None döndü) — store_key sonrası beklenmiyordu.");
            None
        }
        Err(e) => {
            println!("UYARI: custody_mode okunamadı: {e}");
            None
        }
    };

    let expects_touch_id = matches!(
        mode,
        Some(CustodyMode::SecureEnclaveBiometry) | Some(CustodyMode::SecureEnclaveUserPresence)
    );

    if expects_touch_id {
        println!("\n>>> ŞİMDİ TOUCH ID (veya parola) İSTEMİ GELECEK — LÜTFEN ONAYLAYIN <<<\n");
    } else {
        println!(
            "\n>>> Bu kayıt Secure Enclave'e değil düz Keychain'e yazıldı — Touch ID istemi GELMEYECEK. \
             stderr'deki 'keystore:' satırlarına bakın, gerçek nedeni orada. <<<\n"
        );
    }

    let load_result = load_key(ACCOUNT);

    let verdict = match &load_result {
        Ok(bytes) if bytes.as_slice() == SECRET => {
            println!("Geri okunan veri orijinal test verisiyle bayt bayt eşleşiyor: PASS");
            true
        }
        Ok(bytes) => {
            println!(
                "Geri okunan veri orijinalinden FARKLI: PASS değil (uzunluk: beklenen {}, gelen {})",
                SECRET.len(),
                bytes.len()
            );
            false
        }
        Err(e) => {
            println!("load_key başarısız oldu: {e}");
            false
        }
    };

    cleanup(ACCOUNT);

    if verdict && expects_touch_id {
        println!("\nSONUÇ: BAŞARILI — Touch ID gerçek donanımda tetiklendi ve round-trip doğru.");
    } else if verdict {
        println!(
            "\nSONUÇ: KISMEN — round-trip doğru AMA Touch ID hiç denenmedi (custody modu: {}). \
             Bu, Secure Enclave korumasının bu çalıştırmada devre dışı olduğu anlamına gelir; \
             bu, Touch ID'nin doğrulandığı anlamına GELMEZ. Kök nedeni stderr'deki 'keystore:' \
             satırlarında.",
            mode.map(|m| m.to_string()).unwrap_or_else(|| "bilinmiyor".to_string())
        );
        std::process::exit(1);
    } else {
        println!(
            "\nSONUÇ: BAŞARISIZ — ya Touch ID istemi gelmedi/onaylanmadı ya da geri okunan veri yanlıştı. Yukarıdaki satırlara bakın."
        );
        std::process::exit(1);
    }

    fn cleanup(account: &str) {
        match delete_key(account) {
            Ok(()) => println!("Temizlik tamamlandı: test girdisi Keychain'den silindi."),
            Err(e) => println!(
                "UYARI: Temizlik başarısız oldu, Keychain'de artık kalmış olabilir: {e}"
            ),
        }
    }
}

#[cfg(not(target_os = "macos"))]
fn main() {
    println!("keystore_touchid_probe is macOS-only; nothing to probe on this platform.");
}
