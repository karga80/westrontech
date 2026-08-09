//! Small JSON state store for things that must survive an app restart.
//!
//! Two pieces of state are safety-relevant and were previously in-memory only:
//! the spend envelope (per-tx ceiling, hard cap, **accumulated spend**, kill
//! switch) and the snipe scheduler's armed flag. Losing either on restart is
//! not a cosmetic bug — a restart silently reset a hard cap back to zero spent.
//!
//! Files live next to the app's SQLite databases in
//! `~/Library/Application Support/Westron/`. They are written atomically
//! (temp file created with 0600, then renamed over the target) so a crash
//! mid-write cannot leave a half-parsed guardrail on disk, and so the file
//! never exists with looser permissions than intended.

use std::io::Write;
use std::path::{Path, PathBuf};

use serde::de::DeserializeOwned;
use serde::Serialize;

/// `~/Library/Application Support/Westron/<name>` on macOS, the platform data
/// dir equivalent elsewhere. Creates the directory if it does not exist.
pub fn app_file(name: &str) -> Result<PathBuf, String> {
    let base = dirs_next::data_dir()
        .ok_or_else(|| "Could not determine data directory".to_string())?;
    let dir = base.join("Westron");
    std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    Ok(dir.join(name))
}

/// Create `path` with mode 0600 *at creation time* and write `bytes` to it.
///
/// `std::fs::write` would create the file under the process umask — typically
/// 0644 — leaving a window during which the contents are world-readable. A
/// chmod afterwards does not close that window. This is the only creation path
/// used for any file Westron writes that could contain a secret.
pub fn create_private_file(path: &Path, bytes: &[u8]) -> std::io::Result<()> {
    let mut options = std::fs::OpenOptions::new();
    options.write(true).create_new(true);
    #[cfg(unix)]
    {
        use std::os::unix::fs::OpenOptionsExt;
        options.mode(0o600);
    }
    let mut file = options.open(path)?;
    file.write_all(bytes)?;
    file.sync_all()?;
    #[cfg(not(unix))]
    {
        // No mode on OpenOptions here; tighten as far as the platform allows.
        let mut perms = std::fs::metadata(path)?.permissions();
        perms.set_readonly(false);
        let _ = std::fs::set_permissions(path, perms);
    }
    Ok(())
}

/// Atomically replace `path` with `bytes`, never leaving a partial file and
/// never widening permissions. The temp file carries a UUID so two writers
/// cannot collide on it.
pub fn write_private_atomic(path: &Path, bytes: &[u8]) -> Result<(), String> {
    let parent = path
        .parent()
        .ok_or_else(|| format!("{} has no parent directory", path.display()))?;
    std::fs::create_dir_all(parent).map_err(|e| e.to_string())?;

    let tmp = parent.join(format!(
        ".{}.{}.tmp",
        path.file_name().and_then(|n| n.to_str()).unwrap_or("state"),
        uuid::Uuid::new_v4()
    ));

    create_private_file(&tmp, bytes).map_err(|e| e.to_string())?;
    match std::fs::rename(&tmp, path) {
        Ok(()) => Ok(()),
        Err(e) => {
            let _ = std::fs::remove_file(&tmp);
            Err(e.to_string())
        }
    }
}

/// Serialise `value` as pretty JSON and store it atomically at `path`.
pub fn write_json<T: Serialize>(path: &Path, value: &T) -> Result<(), String> {
    let body = serde_json::to_vec_pretty(value).map_err(|e| e.to_string())?;
    write_private_atomic(path, &body)
}

/// Read JSON from `path`. A missing file is `Ok(None)`; a corrupt file is an
/// error, so callers can log it instead of silently starting from scratch.
pub fn read_json<T: DeserializeOwned>(path: &Path) -> Result<Option<T>, String> {
    match std::fs::read(path) {
        Ok(bytes) if bytes.is_empty() => Ok(None),
        Ok(bytes) => serde_json::from_slice(&bytes)
            .map(Some)
            .map_err(|e| format!("{} is not valid JSON: {e}", path.display())),
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(None),
        Err(e) => Err(e.to_string()),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn tmp_dir(tag: &str) -> PathBuf {
        let dir = std::env::temp_dir().join(format!("westron-{tag}-{}", uuid::Uuid::new_v4()));
        std::fs::create_dir_all(&dir).unwrap();
        dir
    }

    #[test]
    fn json_round_trips_and_missing_file_is_none() {
        let dir = tmp_dir("persist");
        let path = dir.join("state.json");

        assert!(read_json::<serde_json::Value>(&path).unwrap().is_none());

        write_json(&path, &serde_json::json!({ "a": 1 })).unwrap();
        let back: serde_json::Value = read_json(&path).unwrap().unwrap();
        assert_eq!(back["a"], 1);

        // Overwrite must succeed even though the target already exists.
        write_json(&path, &serde_json::json!({ "a": 2 })).unwrap();
        let back: serde_json::Value = read_json(&path).unwrap().unwrap();
        assert_eq!(back["a"], 2);

        std::fs::remove_dir_all(&dir).ok();
    }

    #[test]
    fn corrupt_json_is_an_error_not_a_silent_reset() {
        let dir = tmp_dir("persist-corrupt");
        let path = dir.join("state.json");
        std::fs::write(&path, b"{not json").unwrap();
        assert!(read_json::<serde_json::Value>(&path).is_err());
        std::fs::remove_dir_all(&dir).ok();
    }

    /// The file must never exist with looser permissions, not even briefly —
    /// asserted immediately after creation with no intervening chmod.
    #[cfg(unix)]
    #[test]
    fn state_file_is_created_with_mode_0600() {
        use std::os::unix::fs::PermissionsExt;

        let dir = tmp_dir("persist-mode");
        let path = dir.join("state.json");
        write_json(&path, &serde_json::json!({ "secretish": true })).unwrap();

        let mode = std::fs::metadata(&path).unwrap().permissions().mode() & 0o777;
        assert_eq!(mode, 0o600, "state file mode was {mode:o}, expected 600");

        // The atomic rewrite path must not widen it either.
        write_json(&path, &serde_json::json!({ "secretish": false })).unwrap();
        let mode = std::fs::metadata(&path).unwrap().permissions().mode() & 0o777;
        assert_eq!(mode, 0o600, "after rewrite the mode was {mode:o}, expected 600");

        // No temp files left behind.
        let leftovers: Vec<_> = std::fs::read_dir(&dir)
            .unwrap()
            .filter_map(|e| e.ok())
            .filter(|e| e.file_name().to_string_lossy().ends_with(".tmp"))
            .collect();
        assert!(leftovers.is_empty(), "atomic write left a temp file behind");

        std::fs::remove_dir_all(&dir).ok();
    }

    #[cfg(unix)]
    #[test]
    fn create_private_file_refuses_to_clobber() {
        let dir = tmp_dir("persist-clobber");
        let path = dir.join("once");
        create_private_file(&path, b"first").unwrap();
        let err = create_private_file(&path, b"second").unwrap_err();
        assert_eq!(err.kind(), std::io::ErrorKind::AlreadyExists);
        assert_eq!(std::fs::read(&path).unwrap(), b"first");
        std::fs::remove_dir_all(&dir).ok();
    }
}
