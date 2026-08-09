use std::fs::{self, OpenOptions};
use std::io::Write;
use std::path::PathBuf;
use chrono::Utc;
use crate::envelope::types::AuditEntry;

pub struct AuditLog {
    pub log_dir: PathBuf,
}

impl AuditLog {
    pub fn new() -> Self {
        let home = dirs_next::home_dir().expect("Cannot find home directory");
        let log_dir = home
            .join("Library")
            .join("Application Support")
            .join("Westron")
            .join("audit");
        fs::create_dir_all(&log_dir).expect("Cannot create audit log directory");
        AuditLog { log_dir }
    }

    pub fn write_entry(&self, entry: &AuditEntry) -> std::io::Result<()> {
        let date = Utc::now().format("%Y-%m-%d").to_string();
        let log_file = self.log_dir.join(format!("audit-{}.jsonl", date));
        // The audit trail holds no key material, but it does hold the user's
        // addresses and transaction values. Create it 0600 rather than letting
        // the umask decide — same rule as every other file this app writes.
        let mut options = OpenOptions::new();
        options.create(true).append(true);
        #[cfg(unix)]
        {
            use std::os::unix::fs::OpenOptionsExt;
            options.mode(0o600);
        }
        let mut file = options.open(&log_file)?;
        let line = serde_json::to_string(entry)
            .map_err(|e| std::io::Error::new(std::io::ErrorKind::Other, e))?;
        writeln!(file, "{}", line)?;
        file.sync_all()?;
        Ok(())
    }
}
