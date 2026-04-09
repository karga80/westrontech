pub mod db;
pub mod engine;
pub mod types;

pub use types::{AlertRule, AlertRuleInput};

use std::path::PathBuf;

pub fn get_db_path() -> Result<PathBuf, String> {
    let base = dirs_next::data_dir()
        .ok_or_else(|| "Could not determine data directory".to_string())?;
    let dir = base.join("Westron");
    std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    Ok(dir.join("alerts.db"))
}

pub fn ensure_db() -> Result<PathBuf, String> {
    let path = get_db_path()?;
    db::init_db(&path)?;
    Ok(path)
}
