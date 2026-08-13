//! T19 cutover — cüzdan private key'lerinin hangi depoda yaşadığına karar
//! veren saf mantık.
//!
//! `wallet::keychain` iki depoyu birden görüyor:
//!
//! - **keystore** (`keystore::*`, service `"com.westron.wallet"`): Secure
//!   Enclave ile sarmalanmış, biyometri ACL'li yeni ev. Bundan sonra her yeni
//!   anahtar buraya yazılır.
//! - **legacy** (`wallet::keychain`'in kendi `"Westron"` service'i): eski
//!   sürümlerin yazdığı düz Keychain girdisi. Yalnız okunur ve **ancak
//!   keystore kopyası geri okunup bayt bayt doğrulandıktan sonra** silinir.
//!
//! Bu dosya `security_framework`'e ya da gerçek Keychain'e hiç dokunmaz —
//! bütün depo erişimi çağırandan closure olarak gelir. Sebep: kural
//! ihlallerinin (doğrulanmamış kopyayı silmek, reddedilen Touch ID'den sonra
//! sessizce legacy kopyaya düşmek) gerçek donanım olmadan, düz `cargo test`
//! ile kanıtlanabilmesi. Gerçek adaptörler `wallet::keychain`'de.
//!
//! ## Bu dosyanın koruduğu iki kural
//!
//! 1. **Doğrulanmamış kopya silinmez.** Legacy girdi, yeni kopya keystore'dan
//!    geri okunup aynı baytlar olduğu görülmeden asla silinmez.
//! 2. **Reddedilen prompt legacy'ye düşmez.** keystore "kayıt yok" derse
//!    legacy'ye bakılır; keystore "çözülemedi / kullanıcı reddetti" derse
//!    hata olduğu gibi döner. Aksi hâlde kullanıcının "Hayır" demesi,
//!    uygulamanın biyometrisiz kopyayla imzalamasına yol açardı — yani
//!    biyometri kapısının sessizce devre dışı kalmasına.

/// Depo erişimi. Üretimde `wallet::keychain`'in adaptörleri, testte sahte
/// kayıtlar. `&dyn Fn` — bu modülün hiçbir gerçek bağımlılığı olmasın diye.
pub(crate) struct Stores<'a> {
    /// keystore'a yaz (Touch ID istemez — SE public key ile şifreleme).
    pub keystore_store: &'a dyn Fn(&str, &str) -> Result<(), String>,
    /// keystore'dan oku. **Touch ID promptu buradan çıkar** (SE decrypt).
    pub keystore_fetch: &'a dyn Fn(&str) -> Result<String, String>,
    /// Eski `"Westron"` service'inden oku.
    pub legacy_fetch: &'a dyn Fn(&str) -> Result<String, String>,
    /// Eski `"Westron"` service'inden sil.
    pub legacy_delete: &'a dyn Fn(&str) -> Result<(), String>,
}

/// Bir cüzdanın iki olası legacy hesap adı: küçük harfli (3ffe580 sonrası) ve
/// ham yazım (öncesi). Aynı adresin iki geçerli yazımı olduğu için ikisi de
/// aranır — bkz. `wallet::keychain::key_account` yorumu.
pub(crate) struct Accounts<'a> {
    pub account: &'a str,
    pub legacy_account: &'a str,
}

/// Yeni anahtarı keystore'a yazar; **yalnızca** aynı cüzdanın eski bir legacy
/// kopyası varsa geri okuyup doğrular ve doğrulanırsa legacy'yi siler.
///
/// Legacy kopya yoksa geri okuma yapılmaz: bu, import anında gereksiz bir
/// Touch ID promptu çıkarmamak için bilinçli bir karar. Geri okuma yalnız
/// *başka bir kopyayı silme* yetkisini kazanmak için yapılır — silinecek bir
/// şey yoksa doğrulamanın da bedeli ödenmez.
pub(crate) fn store_and_retire_legacy(
    accounts: &Accounts<'_>,
    value: &str,
    stores: &Stores<'_>,
) -> Result<(), String> {
    (stores.keystore_store)(accounts.account, value)?;

    let has_legacy = (stores.legacy_fetch)(accounts.account).is_ok()
        || (stores.legacy_fetch)(accounts.legacy_account).is_ok();
    if !has_legacy {
        return Ok(());
    }

    retire_legacy_after_verified_readback(accounts, value, stores);
    // Çağıranın istediği şey ("anahtarı sakla") oldu; legacy temizliği
    // başarısızsa bu bir sızıntı uyarısıdır, import'u geri almanın gerekçesi
    // değil — hata logda, anahtar yerinde.
    Ok(())
}

/// keystore'dan oku; kayıt yoksa legacy'ye düş ve bulduğunu **arka planda
/// değil, hemen** keystore'a taşı (yaz → geri oku → karşılaştır → sil).
///
/// Dönen değer her hâlükârda çağıranın imzalayabileceği anahtardır: taşıma
/// yarıda kalsa bile (ör. kullanıcı taşıma sırasındaki promptu reddetti)
/// legacy kopya hâlâ geçerlidir ve kullanıcı işlemsiz bırakılmaz. Taşıma bir
/// sonraki okumada yeniden denenir.
pub(crate) fn fetch_or_promote(
    accounts: &Accounts<'_>,
    stores: &Stores<'_>,
) -> Result<String, String> {
    let miss = match (stores.keystore_fetch)(accounts.account) {
        Ok(value) => return Ok(value),
        // Kayıt var ama açılamadı / reddedildi → legacy'ye ASLA düşme.
        Err(e) if !crate::keystore::is_not_found(&e) => return Err(e),
        Err(miss) => miss,
    };

    let legacy = match (stores.legacy_fetch)(accounts.account) {
        Ok(value) => value,
        Err(_) => (stores.legacy_fetch)(accounts.legacy_account).map_err(|_| miss)?,
    };

    if (stores.keystore_store)(accounts.account, &legacy).is_ok() {
        retire_legacy_after_verified_readback(accounts, &legacy, stores);
    } else {
        log::error!(
            "wallet key could not be promoted into the hardware-backed keystore — \
             continuing with the legacy Keychain copy"
        );
    }

    Ok(legacy)
}

/// Ortak son adım: keystore kopyasını geri oku, `value` ile bayt bayt
/// karşılaştır, ancak eşleşirse legacy girdileri sil.
///
/// Hiçbir dalda `Err` döndürmez — çağıranın işi (sakla / getir) bu noktada
/// zaten başarılı. Ama hiçbir dal da sessiz değildir: doğrulanamayan her
/// durum, düz metin kopyanın **silinmediğini** söyleyen bir log satırı bırakır.
fn retire_legacy_after_verified_readback(
    accounts: &Accounts<'_>,
    value: &str,
    stores: &Stores<'_>,
) {
    match (stores.keystore_fetch)(accounts.account) {
        Ok(ref back) if back == value => {
            for account in [accounts.account, accounts.legacy_account] {
                if let Err(e) = (stores.legacy_delete)(account) {
                    log::error!(
                        "wallet key is in the keystore but its legacy Keychain copy \
                         could not be removed: {e}"
                    );
                }
            }
            log::info!("wallet key moved into the hardware-backed keystore");
        }
        Ok(_) => log::error!(
            "wallet key read back from the keystore did not match — \
             the legacy Keychain copy was NOT deleted"
        ),
        Err(e) => log::error!(
            "wallet key could not be read back from the keystore ({e}) — \
             the legacy Keychain copy was NOT deleted"
        ),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::cell::RefCell;
    use std::collections::HashMap;

    const ACCOUNT: &str = "wallet_0xabc";
    const LEGACY_ACCOUNT: &str = "wallet_0xAbC";
    const KEY: &str = "0011223344556677889900112233445566778899001122334455667788990011";

    fn accounts() -> Accounts<'static> {
        Accounts { account: ACCOUNT, legacy_account: LEGACY_ACCOUNT }
    }

    #[derive(Default)]
    struct Fake {
        keystore: RefCell<HashMap<String, String>>,
        legacy: RefCell<HashMap<String, String>>,
        /// keystore okumaları için sıraya konmuş yanıtlar (FIFO). Boşsa
        /// gerçek sahte-depo okunur. Sıra önemli: bir okuma "kayıt yok",
        /// bir sonraki "kullanıcı reddetti" olabilir — tek bir override ile
        /// bu ayrım modellenemezdi.
        fetch_script: RefCell<Vec<Result<String, String>>>,
        store_fails: RefCell<bool>,
        delete_fails: RefCell<bool>,
    }

    impl Fake {
        fn with_legacy(value: &str) -> Self {
            let fake = Self::default();
            fake.legacy.borrow_mut().insert(ACCOUNT.to_string(), value.to_string());
            fake
        }

        fn keystore_store(&self, account: &str, value: &str) -> Result<(), String> {
            if *self.store_fails.borrow() {
                return Err("simulated keystore write failure".to_string());
            }
            self.keystore.borrow_mut().insert(account.to_string(), value.to_string());
            Ok(())
        }

        fn script(&self, responses: Vec<Result<String, String>>) {
            *self.fetch_script.borrow_mut() = responses;
        }

        fn script_is_exhausted(&self) -> bool {
            self.fetch_script.borrow().is_empty()
        }

        fn keystore_fetch(&self, account: &str) -> Result<String, String> {
            let scripted = {
                let mut script = self.fetch_script.borrow_mut();
                if script.is_empty() { None } else { Some(script.remove(0)) }
            };
            if let Some(response) = scripted {
                return response;
            }
            self.keystore
                .borrow()
                .get(account)
                .cloned()
                .ok_or_else(|| crate::keystore::NOT_FOUND.to_string())
        }

        fn legacy_fetch(&self, account: &str) -> Result<String, String> {
            self.legacy
                .borrow()
                .get(account)
                .cloned()
                .ok_or_else(|| crate::keystore::NOT_FOUND.to_string())
        }

        fn legacy_delete(&self, account: &str) -> Result<(), String> {
            if *self.delete_fails.borrow() {
                return Err("simulated Keychain delete failure".to_string());
            }
            self.legacy.borrow_mut().remove(account);
            Ok(())
        }

        /// Callback style rather than `-> Stores<'_>`: the four closures are
        /// temporaries, and only a `let` binding inside a live scope keeps
        /// them alive long enough to be borrowed by `Stores`.
        fn with_stores<R>(&self, body: impl FnOnce(&Stores<'_>) -> R) -> R {
            let stores = Stores {
                keystore_store: &|a, v| self.keystore_store(a, v),
                keystore_fetch: &|a| self.keystore_fetch(a),
                legacy_fetch: &|a| self.legacy_fetch(a),
                legacy_delete: &|a| self.legacy_delete(a),
            };
            body(&stores)
        }

        fn store(&self, value: &str) -> Result<(), String> {
            self.with_stores(|stores| store_and_retire_legacy(&accounts(), value, stores))
        }

        fn fetch(&self) -> Result<String, String> {
            self.with_stores(|stores| fetch_or_promote(&accounts(), stores))
        }
    }

    // ── store ────────────────────────────────────────────────────────────────

    #[test]
    fn a_fresh_import_goes_straight_to_the_keystore_without_a_readback() {
        let fake = Fake::default();
        // Sıradaki yanıt tüketilmemiş kalmalı: legacy kopya yokken geri okuma
        // (yani Touch ID promptu) hiç yapılmaz.
        fake.script(vec![Err("readback must not happen on a fresh import".to_string())]);

        fake.store(KEY).unwrap();

        assert!(!fake.script_is_exhausted(), "import must not trigger a keystore read");
        assert_eq!(fake.keystore.borrow().get(ACCOUNT).map(String::as_str), Some(KEY));
    }

    #[test]
    fn storing_over_a_legacy_copy_retires_it_after_verification() {
        let fake = Fake::with_legacy("old-key");
        fake.legacy.borrow_mut().insert(LEGACY_ACCOUNT.to_string(), "old-key".to_string());

        fake.store(KEY).unwrap();

        assert_eq!(fake.keystore_fetch(ACCOUNT).unwrap(), KEY);
        assert!(fake.legacy.borrow().is_empty(), "both legacy spellings must be gone");
    }

    #[test]
    fn a_failed_readback_leaves_the_legacy_copy_in_place() {
        let fake = Fake::with_legacy("old-key");
        fake.script(vec![Ok("something-else".to_string())]);

        fake.store(KEY).unwrap();

        assert_eq!(
            fake.legacy.borrow().get(ACCOUNT).map(String::as_str),
            Some("old-key"),
            "an unverified copy must never be deleted"
        );
    }

    #[test]
    fn a_failed_keystore_write_is_reported_and_deletes_nothing() {
        let fake = Fake::with_legacy("old-key");
        *fake.store_fails.borrow_mut() = true;

        let err = fake.store(KEY).unwrap_err();

        assert!(err.contains("keystore write failure"));
        assert_eq!(fake.legacy.borrow().get(ACCOUNT).map(String::as_str), Some("old-key"));
    }

    #[test]
    fn a_failed_legacy_delete_does_not_fail_the_store() {
        let fake = Fake::with_legacy("old-key");
        *fake.delete_fails.borrow_mut() = true;

        fake.store(KEY).unwrap();

        assert_eq!(fake.keystore_fetch(ACCOUNT).unwrap(), KEY);
    }

    // ── fetch ────────────────────────────────────────────────────────────────

    #[test]
    fn a_key_already_in_the_keystore_is_returned_without_touching_legacy() {
        let fake = Fake::default();
        fake.keystore_store(ACCOUNT, KEY).unwrap();
        fake.legacy.borrow_mut().insert(ACCOUNT.to_string(), "stale".to_string());

        assert_eq!(fake.fetch().unwrap(), KEY);
        assert_eq!(
            fake.legacy.borrow().get(ACCOUNT).map(String::as_str),
            Some("stale"),
            "fetch must not touch legacy when the keystore already answered"
        );
    }

    #[test]
    fn a_legacy_key_is_returned_and_promoted_on_first_use() {
        let fake = Fake::with_legacy(KEY);

        assert_eq!(fake.fetch().unwrap(), KEY);

        assert_eq!(fake.keystore_fetch(ACCOUNT).unwrap(), KEY, "must be promoted");
        assert!(fake.legacy.borrow().is_empty(), "verified legacy copy must be gone");
    }

    #[test]
    fn a_legacy_key_under_the_old_mixed_case_spelling_is_still_found() {
        let fake = Fake::default();
        fake.legacy.borrow_mut().insert(LEGACY_ACCOUNT.to_string(), KEY.to_string());

        assert_eq!(fake.fetch().unwrap(), KEY);
        assert_eq!(fake.keystore_fetch(ACCOUNT).unwrap(), KEY);
    }

    /// Bu testin koruduğu şey bir kolaylık değil, biyometri kapısının kendisi.
    #[test]
    fn a_declined_touch_id_prompt_never_falls_back_to_the_legacy_copy() {
        let fake = Fake::with_legacy(KEY);
        fake.keystore.borrow_mut().insert(ACCOUNT.to_string(), KEY.to_string());
        fake.script(vec![Err(
            "Secure Enclave decryption failed or was declined: -128".to_string(),
        )]);

        let err = fake.fetch().unwrap_err();

        assert!(err.contains("declined"), "the decline must be surfaced, not swallowed: {err}");
        assert_eq!(
            fake.legacy.borrow().get(ACCOUNT).map(String::as_str),
            Some(KEY),
            "a declined prompt must not cause the legacy copy to be consumed or deleted"
        );
    }

    #[test]
    fn a_declined_prompt_during_promotion_still_returns_the_key_and_keeps_the_legacy_copy() {
        let fake = Fake::with_legacy(KEY);
        // İlk okuma: kayıt yok (legacy yoluna düşülür). İkinci okuma: taşıma
        // sonrası doğrulama promptu reddedilir.
        fake.script(vec![
            Err(crate::keystore::NOT_FOUND.to_string()),
            Err("Secure Enclave decryption failed or was declined: -128".to_string()),
        ]);

        let value = fake.fetch().unwrap();

        assert_eq!(value, KEY, "the user must not be locked out mid-migration");
        assert_eq!(
            fake.legacy.borrow().get(ACCOUNT).map(String::as_str),
            Some(KEY),
            "promotion could not be verified, so the legacy copy stays"
        );
    }

    #[test]
    fn a_key_that_exists_nowhere_reports_the_keystore_miss() {
        let fake = Fake::default();
        let err = fake.fetch().unwrap_err();
        assert!(crate::keystore::is_not_found(&err), "unexpected error text: {err}");
    }
}
