use std::path::PathBuf;

/// Directory that holds the control token, alongside the app's SQLite DBs.
/// On macOS `dirs_next::data_dir()` is `~/Library/Application Support`, so the
/// token lands at `~/Library/Application Support/Westron/control-token`.
/// (macOS volumes are case-insensitive by default, so the brief's lowercase
/// `westron/control-token` resolves to the same file.)
fn token_dir() -> Result<PathBuf, String> {
    let base = dirs_next::data_dir()
        .ok_or_else(|| "Could not determine data directory".to_string())?;
    let dir = base.join("Westron");
    std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    Ok(dir)
}

pub fn token_path() -> Result<PathBuf, String> {
    Ok(token_dir()?.join("control-token"))
}

/// 32 random bytes, hex encoded (64 chars). Built from two v4 UUIDs so we do
/// not add a new RNG dependency — `uuid::new_v4` is already backed by the OS
/// CSPRNG and is used elsewhere in the codebase.
fn generate_token() -> String {
    let a = *uuid::Uuid::new_v4().as_bytes();
    let b = *uuid::Uuid::new_v4().as_bytes();
    let mut bytes = [0u8; 32];
    bytes[..16].copy_from_slice(&a);
    bytes[16..].copy_from_slice(&b);
    hex::encode(bytes)
}

#[cfg(unix)]
fn harden_permissions(path: &PathBuf) -> Result<(), String> {
    use std::os::unix::fs::PermissionsExt;
    std::fs::set_permissions(path, std::fs::Permissions::from_mode(0o600))
        .map_err(|e| e.to_string())
}

#[cfg(not(unix))]
fn harden_permissions(_path: &PathBuf) -> Result<(), String> {
    Ok(())
}

/// Create the token file with 0600 *at creation time*.
///
/// `std::fs::write` would create the file under the process umask — typically
/// 0644 — leaving a window in which the token that authorises every control
/// endpoint is world-readable. `create_new` + `mode` closes that window: the
/// file never exists with looser permissions, and `create_new` also means two
/// app instances racing cannot clobber each other's token.
fn create_token_file(path: &std::path::Path, token: &str) -> std::io::Result<()> {
    use std::io::Write;
    let mut options = std::fs::OpenOptions::new();
    options.write(true).create_new(true);
    #[cfg(unix)]
    {
        use std::os::unix::fs::OpenOptionsExt;
        options.mode(0o600);
    }
    let mut file = options.open(path)?;
    file.write_all(token.as_bytes())?;
    file.sync_all()?;
    // Non-unix has no mode on OpenOptions; tighten after the fact where we can.
    #[cfg(not(unix))]
    {
        let _ = harden_permissions(&path.to_path_buf());
    }
    Ok(())
}

/// Read the control token, generating and persisting one on first start.
/// The token is never logged and never returned over HTTP.
pub fn ensure_token() -> Result<String, String> {
    let path = token_path()?;
    if path.exists() {
        let existing = std::fs::read_to_string(&path).map_err(|e| e.to_string())?;
        let trimmed = existing.trim().to_string();
        if !trimmed.is_empty() {
            // Re-assert 0600: older builds wrote this file under the umask.
            harden_permissions(&path)?;
            return Ok(trimmed);
        }
        // Present but empty — unusable, and `create_new` would refuse it.
        std::fs::remove_file(&path).map_err(|e| e.to_string())?;
    }

    let token = generate_token();
    match create_token_file(&path, &token) {
        Ok(()) => Ok(token),
        // Another instance won the race between our check and our create.
        Err(e) if e.kind() == std::io::ErrorKind::AlreadyExists => {
            let existing = std::fs::read_to_string(&path).map_err(|e| e.to_string())?;
            let trimmed = existing.trim().to_string();
            if trimmed.is_empty() {
                return Err("control token file exists but is empty".to_string());
            }
            harden_permissions(&path)?;
            Ok(trimmed)
        }
        Err(e) => Err(e.to_string()),
    }
}

/// Length-independent, early-exit-free comparison. Not hardware-constant-time,
/// but it does not leak the matching prefix length the way `==` on `String` can.
pub fn constant_time_eq(a: &str, b: &str) -> bool {
    let (a, b) = (a.as_bytes(), b.as_bytes());
    let mut diff = (a.len() ^ b.len()) as u8;
    let n = a.len().max(b.len());
    for i in 0..n {
        let x = *a.get(i).unwrap_or(&0);
        let y = *b.get(i).unwrap_or(&0);
        diff |= x ^ y;
    }
    diff == 0
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn generated_token_is_64_hex_chars() {
        let t = generate_token();
        assert_eq!(t.len(), 64);
        assert!(t.chars().all(|c| c.is_ascii_hexdigit()));
        assert_ne!(t, generate_token());
    }

    /// The token must never exist on disk with looser permissions, not even
    /// briefly — this asserts the mode immediately after creation, with no
    /// intervening chmod.
    #[cfg(unix)]
    #[test]
    fn token_file_is_created_with_mode_0600() {
        use std::os::unix::fs::PermissionsExt;

        let dir = std::env::temp_dir().join(format!("westron-token-test-{}", uuid::Uuid::new_v4()));
        std::fs::create_dir_all(&dir).unwrap();
        let path = dir.join("control-token");
        let token = generate_token();

        create_token_file(&path, &token).unwrap();

        let mode = std::fs::metadata(&path).unwrap().permissions().mode() & 0o777;
        assert_eq!(mode, 0o600, "token file mode was {mode:o}, expected 600");
        assert_eq!(std::fs::read_to_string(&path).unwrap(), token);

        // Second create must refuse rather than overwrite a live token.
        let err = create_token_file(&path, "other").unwrap_err();
        assert_eq!(err.kind(), std::io::ErrorKind::AlreadyExists);

        std::fs::remove_dir_all(&dir).ok();
    }

    #[test]
    fn constant_time_eq_matches_semantics_of_eq() {
        assert!(constant_time_eq("abc", "abc"));
        assert!(!constant_time_eq("abc", "abd"));
        assert!(!constant_time_eq("abc", "abcd"));
        assert!(!constant_time_eq("", "a"));
        assert!(constant_time_eq("", ""));
    }
}
