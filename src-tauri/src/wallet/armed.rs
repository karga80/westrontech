//! Arm-at-creation — zamanlanmış görevlerin imza yetkisi.
//!
//! Karar (14.08.2026, Emir): bir kural yaratılırken **bir kez** Touch ID
//! istenir; anahtar o oturum boyunca bellekte tutulur ve kural tetiklendiğinde
//! yeniden istem çıkmaz. Uygulama kapandığında bellek gider, yani kural
//! kendiliğinden disarm olur ve kullanıcı yeniden silahlandırmak zorundadır.
//!
//! Neden diğer iki seçenek değil:
//! - Her tetiklemede Touch ID istemek gece çalışan bir sniper'ı imkânsız kılar.
//! - Anahtarın biyometrisiz bir "otomasyon kopyası"nı saklamak, T19'da tam da
//!   kapattığımız kapıyı geri açar: Mac'i açık bulan biri imzalayabilir.
//!
//! Bunun bedeli açıktır ve saklanmaz: **özel anahtar saatlerce RAM'de durur.**
//! Bu yüzden burada tutulan her şey `Zeroizing` ile sarılır (drop anında
//! sıfırlanır), asla loglanmaz, asla IPC'den dönmez — `ArmedStatus` anahtarı
//! taşımaz, yalnız "silahlı mı, ne zamana kadar" bilgisini taşır.
//!
//! Süre iki uçtan sınırlıdır: kuralın kendi TTL'i ve buradaki üst sınır
//! (`MAX_TTL_HOURS`). Süre dolduğunda anahtar ilk erişimde düşürülür — bekleyen
//! bir zamanlayıcıya güvenmeyiz, çünkü uygulama uyku sonrası uyanabilir.

use std::collections::HashMap;
use std::fmt;
use std::sync::{Mutex, MutexGuard, OnceLock};
use std::time::Instant;

use serde::Serialize;
use zeroize::Zeroizing;

/// Bir silahlandırmanın yaşayabileceği en uzun süre. Kural TTL'iyle aynı tavan
/// (7 gün) — daha uzunu, anahtarın haftalarca bellekte kalması demek olurdu.
pub const MAX_TTL_HOURS: u64 = 168;

/// Varsayılan süre: kural yaratılırken TTL verilmezse bu kullanılır.
pub const DEFAULT_TTL_HOURS: u64 = 48;

struct Armed {
    /// Drop anında sıfırlanır. Bu alan asla loglanmaz ve asla dışarı sızmaz.
    key: Zeroizing<String>,
    armed_at: i64,
    expires_at: i64,
    /// Duvar saatinden bağımsız ikinci bir tavan. `expires_at` tek başına
    /// yeterli değil: saat NTP düzeltmesiyle ya da kullanıcı Sistem
    /// Ayarları'ndan geri alarak geriye giderse `expires_at > now` gerçekten
    /// geçen süreden daha uzun süre doğru kalır — yani Touch ID'nin onayladığı
    /// pencere sessizce uzar. Monotonik saat geri gitmez, o yüzden iki kontrol
    /// birlikte uygulanır ve pencereyi hep **kısa olan** kapatır.
    started: Instant,
    /// `started`'dan itibaren kaç saniye geçerli. Pencere uzatıldığında bu da
    /// yeniden hesaplanır, yoksa uzatma yalnız duvar saatinde olur.
    budget_secs: u64,
}

/// Elle yazıldı: `Zeroizing<T>`'in `Debug`'ı sarmaladığı türe devreder, yani
/// türetilmiş bir `Debug` ham private key'i basardı. Modül dokümanındaki "asla
/// loglanmaz" sözünün yorum değil, tip düzeyinde bir garanti olması için burada
/// duruyor.
impl fmt::Debug for Armed {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.debug_struct("Armed")
            .field("key", &"[REDACTED]")
            .field("armed_at", &self.armed_at)
            .field("expires_at", &self.expires_at)
            .field("budget_secs", &self.budget_secs)
            .finish()
    }
}

/// Kullanıcıya ve frontend'e dönen durum. Anahtar **yok** — kasıtlı.
#[derive(Debug, Clone, PartialEq, Serialize)]
pub struct ArmedStatus {
    pub address: String,
    pub armed: bool,
    /// Unix saniye. `armed` false ise `None`.
    pub armed_at: Option<i64>,
    pub expires_at: Option<i64>,
}

impl ArmedStatus {
    fn disarmed(address: &str) -> Self {
        ArmedStatus {
            address: address.to_string(),
            armed: false,
            armed_at: None,
            expires_at: None,
        }
    }
}

fn sessions() -> &'static Mutex<HashMap<String, Armed>> {
    static SESSIONS: OnceLock<Mutex<HashMap<String, Armed>>> = OnceLock::new();
    SESSIONS.get_or_init(|| Mutex::new(HashMap::new()))
}

/// Keychain hesapları küçük harfle anahtarlanır; burada da aynı normalizasyon
/// yapılır, yoksa aynı cüzdanın iki yazımı iki ayrı oturum sanılır.
fn norm(address: &str) -> String {
    address.trim().to_lowercase()
}

/// TTL'i tavana çeker. 0 saat "hemen dolmuş" demek olurdu; en az 1 saat.
fn clamp_ttl(ttl_hours: Option<u64>) -> u64 {
    ttl_hours
        .unwrap_or(DEFAULT_TTL_HOURS)
        .clamp(1, MAX_TTL_HOURS)
}

fn now_secs() -> i64 {
    chrono::Utc::now().timestamp()
}

/// Cüzdanı silahlandırır. `load_key` **her çağrıda** çalıştırılır — yani her
/// kural yaratımı gerçek bir Touch ID istemi demektir. Zaten silahlı bir
/// cüzdanı sessizce uzatmayız; uzatma da ancak yeni bir onayla olur.
///
/// Süre uzatılırken mevcut bitişten geriye gidilmez: iki kuraldan uzun olanı
/// kazanır.
pub fn arm_with(
    address: &str,
    ttl_hours: Option<u64>,
    now: i64,
    load_key: &dyn Fn(&str) -> Result<String, String>,
) -> Result<ArmedStatus, String> {
    let key = load_key(address)?;
    if key.trim().is_empty() {
        return Err("wallet key is empty — cannot arm".to_string());
    }

    let id = norm(address);
    let candidate_expiry = now + (clamp_ttl(ttl_hours) as i64) * 3600;

    let mut map = sessions().lock().map_err(|_| lock_err())?;
    let expires_at = match map.get(&id) {
        Some(existing) if existing.expires_at > candidate_expiry => existing.expires_at,
        _ => candidate_expiry,
    };
    map.insert(
        id.clone(),
        Armed {
            key: Zeroizing::new(key),
            armed_at: now,
            expires_at,
            // Monotonik bütçe her zaman **şu andan** itibaren ölçülür. Uzatmada
            // da yeniden hesaplanır: yoksa ikinci silahlandırma duvar saatini
            // uzatır ama monotonik tavan ilk pencerede kalır ve anahtar
            // kullanıcının onayladığı süreden erken düşerdi.
            started: Instant::now(),
            budget_secs: (expires_at - now).max(0) as u64,
        },
    );

    Ok(ArmedStatus {
        address: id,
        armed: true,
        armed_at: Some(now),
        expires_at: Some(expires_at),
    })
}

/// Üretim girişi: anahtarı Keychain/keystore'dan okur (Touch ID istemi buradan
/// çıkar) ve saatin kendisini alır.
pub fn arm(address: &str, ttl_hours: Option<u64>) -> Result<ArmedStatus, String> {
    arm_with(address, ttl_hours, now_secs(), &|addr| {
        super::keychain::fetch_and_verify_key(addr)
    })
}

/// Pencere gerçekten açık mı. İki tavan da geçerli olmak zorundadır: duvar
/// saati (kullanıcıya gösterdiğimiz bitiş) ve monotonik bütçe (saatin geri
/// alınmasıyla uzatılamayan gerçek geçen süre). Hangisi önce dolarsa pencere
/// o an kapanır.
fn still_live(armed: &Armed, now: i64) -> bool {
    armed.expires_at > now && armed.started.elapsed().as_secs() < armed.budget_secs
}

/// Silahlı anahtarı verir. Süresi dolmuşsa **düşürür** ve `None` döner —
/// süresi geçmiş bir yetkiyle imza atılmasın diye kontrol okuma anındadır.
///
/// Yalnız gerçekten imza atacak olan çağırır. "Silahlı mı" sorusunun cevabı
/// için `is_armed` vardır; bu fonksiyon anahtarı kopyalar ve her kopya, sırrın
/// heap'te bir kez daha bulunması demektir.
pub fn key_for_at(address: &str, now: i64) -> Option<Zeroizing<String>> {
    let id = norm(address);
    let mut map = sessions().lock().ok()?;
    match map.get(&id) {
        Some(armed) if still_live(armed, now) => Some(armed.key.clone()),
        Some(_) => {
            map.remove(&id); // süresi doldu → anahtar burada sıfırlanır
            None
        }
        None => None,
    }
}

pub fn key_for(address: &str) -> Option<Zeroizing<String>> {
    key_for_at(address, now_secs())
}

/// Anahtara **dokunmayan** silahlılık kontrolü. Zamanlayıcı her turda her kural
/// için bunu çağırır; `key_for` çağırsaydı ham private key, pencere boyunca
/// saniyede bir heap'e kopyalanırdı — hiçbir karşılığı olmayan bir maruz kalma.
pub fn is_armed_at(address: &str, now: i64) -> bool {
    status_at(address, now).armed
}

pub fn is_armed(address: &str) -> bool {
    is_armed_at(address, now_secs())
}

pub fn status_at(address: &str, now: i64) -> ArmedStatus {
    let id = norm(address);
    let mut map = match sessions().lock() {
        Ok(m) => m,
        Err(_) => return ArmedStatus::disarmed(&id),
    };
    match map.get(&id) {
        Some(armed) if still_live(armed, now) => ArmedStatus {
            address: id.clone(),
            armed: true,
            armed_at: Some(armed.armed_at),
            expires_at: Some(armed.expires_at),
        },
        Some(_) => {
            map.remove(&id);
            ArmedStatus::disarmed(&id)
        }
        None => ArmedStatus::disarmed(&id),
    }
}

pub fn status(address: &str) -> ArmedStatus {
    status_at(address, now_secs())
}

/// Tek cüzdanı disarm eder. Zaten silahlı değilse de hata değildir — kullanıcı
/// açısından sonuç aynı: o cüzdan artık imza atamaz.
pub fn disarm(address: &str) {
    lock_or_recover().remove(&norm(address));
}

/// Her şeyi disarm eder. Kill switch bunu çağırır: "her şeyi durdur" demek,
/// bellekte bekleyen imza yetkisinin de düşmesi demektir.
pub fn disarm_all() {
    lock_or_recover().clear();
}

/// Disarm yolları zehirlenmiş kilitte de temizlemek **zorunda**. Okuma yolları
/// zehirlenmede fail-closed davranır (anahtar dağıtmaz), ama sessizce vazgeçen
/// bir `disarm_all` baytları süreç sonuna kadar bellekte bırakırdı — oysa ekran
/// kullanıcıya "bellekteki anahtarlar düşürüldü" diye söz veriyor. Zehirlenme
/// yalnız "kilidi tutan bir thread panikledi" demek; tablonun kendisi okunabilir
/// durumda, o yüzden guard'ı geri alıp yine de temizliyoruz.
fn lock_or_recover() -> MutexGuard<'static, HashMap<String, Armed>> {
    sessions().lock().unwrap_or_else(|e| e.into_inner())
}

fn lock_err() -> String {
    "armed-session store is poisoned — restart the app and arm again".to_string()
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::cell::Cell;

    /// Oturum tablosu süreç geneli olmak **zorunda** — kuralı yaratan komut
    /// thread'i ile onu tetikleyen zamanlayıcı thread'i aynı tabloyu görmeli.
    /// Bu yüzden testler thread_local bir kaçış yoluna sahip değil ve
    /// `disarm_all` paralel koşan başka bir testin oturumunu silebilirdi.
    /// Çözüm: testler bu kilidi alıp sırayla koşar.
    fn serial() -> std::sync::MutexGuard<'static, ()> {
        static LOCK: OnceLock<Mutex<()>> = OnceLock::new();
        LOCK.get_or_init(|| Mutex::new(()))
            .lock()
            .unwrap_or_else(|e| e.into_inner())
    }

    fn addr(tag: &str) -> String {
        format!("0xArMeD{tag}")
    }

    fn loader(key: &'static str) -> impl Fn(&str) -> Result<String, String> {
        move |_| Ok(key.to_string())
    }

    #[test]
    fn is_armed_answers_without_ever_touching_the_key() {
        let _g = serial();
        let a = addr("nokey");
        assert!(!is_armed_at(&a, 1_000));

        arm_with(&a, Some(2), 1_000, &loader("0xkey")).unwrap();
        assert!(is_armed_at(&a, 1_000));
        // Süresi dolmuş pencere için de anahtar okumadan doğru cevap verir.
        assert!(!is_armed_at(&a, 1_000 + 3 * 3600));
        disarm(&a);
    }

    #[test]
    fn the_debug_impl_never_prints_the_key() {
        let armed = Armed {
            key: Zeroizing::new("0xdeadbeefsecret".to_string()),
            armed_at: 1_000,
            expires_at: 2_000,
            started: Instant::now(),
            budget_secs: 1_000,
        };
        let printed = format!("{armed:?}");
        assert!(
            !printed.contains("deadbeefsecret"),
            "Debug leaked the key: {printed}"
        );
        assert!(printed.contains("[REDACTED]"));
    }

    #[test]
    fn the_monotonic_ceiling_survives_the_wall_clock_going_backwards() {
        let _g = serial();
        let a = addr("clock");
        // 1 saatlik pencere, duvar saatine göre t=1000'de açıldı.
        arm_with(&a, Some(1), 1_000, &loader("0xkey")).unwrap();

        // Kullanıcı saati bir gün geriye aldı. Duvar saati kontrolü tek başına
        // olsaydı `expires_at > now` doğru kalır ve pencere onaylanandan çok
        // daha uzun sürerdi. Monotonik bütçe hâlâ 1 saat, o yüzden pencere
        // yalnız gerçekten geçen süre kadar açık.
        assert!(
            is_armed_at(&a, 1_000 - 86_400),
            "gerçek süre daha dolmadı — pencere açık kalmalı"
        );

        // Bütçeyi tüketilmiş göstermek için oturumu elle geriye alıyoruz:
        // `Instant`'ı ileri saramayız, ama başlangıcı geriye çekmek aynı şey.
        {
            let mut map = lock_or_recover();
            let s = map.get_mut(&norm(&a)).unwrap();
            s.started = Instant::now() - std::time::Duration::from_secs(3_601);
        }
        assert!(
            !is_armed_at(&a, 1_000 - 86_400),
            "monotonik bütçe dolduysa duvar saati ne derse desin pencere kapalı"
        );
        assert!(key_for_at(&a, 1_000 - 86_400).is_none());
        disarm(&a);
    }

    #[test]
    fn extending_the_window_also_extends_the_monotonic_budget() {
        let _g = serial();
        let a = addr("extend");
        arm_with(&a, Some(1), 1_000, &loader("0xkey")).unwrap();
        // İkinci, daha uzun silahlandırma (yeni Touch ID). Monotonik bütçe de
        // yeniden hesaplanmalı — yoksa duvar saati 5 saat derken anahtar 1
        // saatte düşer ve kullanıcı sebebini anlayamaz.
        let st = arm_with(&a, Some(5), 1_000, &loader("0xkey")).unwrap();
        assert_eq!(st.expires_at, Some(1_000 + 5 * 3600));
        {
            let map = lock_or_recover();
            assert_eq!(map.get(&norm(&a)).unwrap().budget_secs, 5 * 3600);
        }
        disarm(&a);
    }

    #[test]
    fn the_kill_switch_still_clears_a_poisoned_store() {
        let _g = serial();
        let a = addr("poison");
        arm_with(&a, Some(2), now_secs(), &loader("0xkey")).unwrap();

        // Kilidi tutarken panikleyen bir thread mutex'i zehirler.
        let _ = std::thread::spawn(|| {
            let _held = sessions().lock().unwrap();
            panic!("deliberate panic while holding the session lock");
        })
        .join();
        assert!(sessions().lock().is_err(), "kilit zehirlenmiş olmalı");

        // Ekran kullanıcıya "bellekteki anahtarlar düşürüldü" diyor; zehirlenmiş
        // kilitte sessizce vazgeçmek bu sözü yalan yapardı.
        disarm_all();
        assert!(lock_or_recover().is_empty());

        // Zehirlenme süreç geneli ve kalıcı: temizlenmezse bundan sonraki her
        // test `arm_with`'in fail-closed dalına düşer. Test kendi kirini
        // toplar, `is_armed` kontrolü de ancak bundan sonra anlamlı olur.
        sessions().clear_poison();
        assert!(!is_armed(&a));
    }

    #[test]
    fn arming_stores_the_key_and_reports_the_window() {
        let _g = serial();
        let a = addr("aaa");
        let status = arm_with(&a, Some(2), 1_000, &loader("0xabc")).unwrap();
        assert!(status.armed);
        assert_eq!(status.armed_at, Some(1_000));
        assert_eq!(status.expires_at, Some(1_000 + 2 * 3600));
        // Adres küçük harfe normalize edilir — Keychain ile aynı kural.
        assert_eq!(status.address, a.to_lowercase());
        assert_eq!(
            key_for_at(&a, 1_100).as_deref().map(|s| s.to_string()),
            Some("0xabc".to_string())
        );
        disarm(&a);
    }

    #[test]
    fn the_status_never_carries_the_key() {
        let _g = serial();
        let a = addr("bbb");
        arm_with(&a, Some(1), 0, &loader("0xsecret")).unwrap();
        let json = serde_json::to_string(&status_at(&a, 10)).unwrap();
        assert!(!json.contains("0xsecret"), "status leaked the key: {json}");
        disarm(&a);
    }

    #[test]
    fn arming_always_asks_again_it_never_extends_silently() {
        let _g = serial();
        let a = addr("ccc");
        let calls = Cell::new(0);
        let counting = |_: &str| {
            calls.set(calls.get() + 1);
            Ok("0xabc".to_string())
        };
        arm_with(&a, Some(1), 0, &counting).unwrap();
        arm_with(&a, Some(1), 0, &counting).unwrap();
        assert_eq!(calls.get(), 2, "second arm must re-prompt, not reuse");
        disarm(&a);
    }

    #[test]
    fn a_longer_window_wins_and_a_shorter_one_does_not_shrink_it() {
        let _g = serial();
        let a = addr("ddd");
        arm_with(&a, Some(10), 0, &loader("0xabc")).unwrap();
        let second = arm_with(&a, Some(2), 0, &loader("0xabc")).unwrap();
        assert_eq!(second.expires_at, Some(10 * 3600));
        disarm(&a);
    }

    #[test]
    fn an_expired_session_yields_no_key_and_is_dropped() {
        let _g = serial();
        let a = addr("eee");
        arm_with(&a, Some(1), 0, &loader("0xabc")).unwrap();
        assert!(
            key_for_at(&a, 3_601).is_none(),
            "expired key must not be handed out"
        );
        assert!(!status_at(&a, 3_601).armed);
        // Düşürülmüş olmalı: süre geri sarılsa bile geri gelmez.
        assert!(key_for_at(&a, 10).is_none());
    }

    #[test]
    fn a_failed_unlock_does_not_arm() {
        let _g = serial();
        let a = addr("fff");
        let err = arm_with(&a, Some(1), 0, &|_| {
            Err("User canceled the operation".into())
        });
        assert!(err.is_err());
        assert!(!status_at(&a, 1).armed);
    }

    #[test]
    fn an_empty_key_is_refused() {
        let _g = serial();
        let a = addr("ggg");
        assert!(arm_with(&a, Some(1), 0, &loader("   ")).is_err());
        assert!(!status_at(&a, 1).armed);
    }

    #[test]
    fn ttl_is_clamped_at_both_ends() {
        let _g = serial();
        let a = addr("hhh");
        let zero = arm_with(&a, Some(0), 0, &loader("0xabc")).unwrap();
        assert_eq!(zero.expires_at, Some(3600), "0 hours would arm nothing");
        disarm(&a);
        let huge = arm_with(&a, Some(10_000), 0, &loader("0xabc")).unwrap();
        assert_eq!(huge.expires_at, Some(MAX_TTL_HOURS as i64 * 3600));
        disarm(&a);
    }

    #[test]
    fn disarm_all_clears_every_wallet() {
        let _g = serial();
        let a = addr("iii");
        let b = addr("jjj");
        arm_with(&a, Some(5), 0, &loader("0xabc")).unwrap();
        arm_with(&b, Some(5), 0, &loader("0xdef")).unwrap();
        disarm_all();
        assert!(key_for_at(&a, 10).is_none());
        assert!(key_for_at(&b, 10).is_none());
    }

    #[test]
    fn a_wallet_that_was_never_armed_reports_disarmed() {
        let _g = serial();
        let s = status_at(&addr("kkk"), 0);
        assert!(!s.armed);
        assert_eq!(s.armed_at, None);
        assert_eq!(s.expires_at, None);
    }
}
