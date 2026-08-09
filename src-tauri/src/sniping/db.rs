use rusqlite::{Connection, params};
use std::path::PathBuf;
use uuid::Uuid;
use chrono::Utc;

use super::types::{SnipeRule, SnipeRuleInput};

/// Default rule time-to-live when the caller does not specify one.
pub const DEFAULT_TTL_HOURS: u64 = 48;
/// Hard ceiling for rule time-to-live (7 days).
pub const MAX_TTL_HOURS: u64 = 168;

/// Reason codes written to `deactivated_reason` when the engine — not the user —
/// switches a rule off. A user-disabled rule keeps `deactivated_reason = NULL`,
/// so the three cases stay distinguishable.
pub const DEACTIVATED_EXPIRED: &str = "expired";
pub const DEACTIVATED_SPEND_CAP: &str = "spend_cap_reached";

fn open_connection(db_path: &PathBuf) -> Result<Connection, String> {
    let conn = Connection::open(db_path).map_err(|e| e.to_string())?;
    conn.execute_batch("PRAGMA journal_mode=WAL;").map_err(|e| e.to_string())?;
    Ok(conn)
}

fn column_exists(conn: &Connection, table: &str, column: &str) -> Result<bool, String> {
    let mut stmt = conn
        .prepare(&format!("PRAGMA table_info({table})"))
        .map_err(|e| e.to_string())?;
    let names = stmt
        .query_map([], |row| row.get::<_, String>(1))
        .map_err(|e| e.to_string())?;
    for name in names {
        if name.map_err(|e| e.to_string())? == column {
            return Ok(true);
        }
    }
    Ok(false)
}

pub fn init_db(db_path: &PathBuf) -> Result<(), String> {
    let conn = open_connection(db_path)?;
    conn.execute_batch(
        "CREATE TABLE IF NOT EXISTS snipe_rules (
            id                  TEXT PRIMARY KEY,
            collection_slug     TEXT NOT NULL,
            target_price_eth    REAL NOT NULL,
            max_quantity        INTEGER NOT NULL,
            wallet_address      TEXT NOT NULL,
            active              INTEGER NOT NULL DEFAULT 1,
            created_at          TEXT NOT NULL,
            triggered_count     INTEGER NOT NULL DEFAULT 0,
            expires_at          TEXT NOT NULL DEFAULT '',
            max_total_spend_eth REAL,
            spent_eth           REAL NOT NULL DEFAULT 0,
            deactivated_reason  TEXT
        );",
    )
    .map_err(|e| e.to_string())?;

    // In-place migration for DBs created before the guardrail columns existed.
    if !column_exists(&conn, "snipe_rules", "expires_at")? {
        conn.execute_batch("ALTER TABLE snipe_rules ADD COLUMN expires_at TEXT NOT NULL DEFAULT '';")
            .map_err(|e| e.to_string())?;
        // Backfill legacy rows with the default TTL from now.
        let default_expiry = (Utc::now() + chrono::Duration::hours(DEFAULT_TTL_HOURS as i64)).to_rfc3339();
        conn.execute(
            "UPDATE snipe_rules SET expires_at = ?1 WHERE expires_at = ''",
            params![default_expiry],
        )
        .map_err(|e| e.to_string())?;
    }
    if !column_exists(&conn, "snipe_rules", "max_total_spend_eth")? {
        conn.execute_batch("ALTER TABLE snipe_rules ADD COLUMN max_total_spend_eth REAL;")
            .map_err(|e| e.to_string())?;
    }
    if !column_exists(&conn, "snipe_rules", "spent_eth")? {
        conn.execute_batch("ALTER TABLE snipe_rules ADD COLUMN spent_eth REAL NOT NULL DEFAULT 0;")
            .map_err(|e| e.to_string())?;
    }
    if !column_exists(&conn, "snipe_rules", "deactivated_reason")? {
        conn.execute_batch("ALTER TABLE snipe_rules ADD COLUMN deactivated_reason TEXT;")
            .map_err(|e| e.to_string())?;
    }
    Ok(())
}

const RULE_COLUMNS: &str = "id, collection_slug, target_price_eth, max_quantity, wallet_address, \
                            active, created_at, triggered_count, expires_at, max_total_spend_eth, \
                            spent_eth, deactivated_reason";

fn rule_from_row(row: &rusqlite::Row) -> rusqlite::Result<SnipeRule> {
    Ok(SnipeRule {
        id: row.get(0)?,
        collection_slug: row.get(1)?,
        target_price_eth: row.get(2)?,
        max_quantity: row.get::<_, u32>(3)?,
        wallet_address: row.get(4)?,
        active: row.get::<_, i64>(5)? != 0,
        created_at: row.get(6)?,
        triggered_count: row.get::<_, u32>(7)?,
        expires_at: row.get(8)?,
        max_total_spend_eth: row.get(9)?,
        spent_eth: row.get(10)?,
        deactivated_reason: row.get(11)?,
    })
}

pub fn create_rule(db_path: &PathBuf, input: &SnipeRuleInput) -> Result<String, String> {
    let conn = open_connection(db_path)?;
    let id = Uuid::new_v4().to_string();
    let now = Utc::now();
    let created_at = now.to_rfc3339();
    let ttl = input
        .ttl_hours
        .unwrap_or(DEFAULT_TTL_HOURS)
        .clamp(1, MAX_TTL_HOURS);
    let expires_at = (now + chrono::Duration::hours(ttl as i64)).to_rfc3339();
    conn.execute(
        "INSERT INTO snipe_rules
            (id, collection_slug, target_price_eth, max_quantity, wallet_address,
             active, created_at, triggered_count, expires_at, max_total_spend_eth, spent_eth,
             deactivated_reason)
         VALUES (?1, ?2, ?3, ?4, ?5, 1, ?6, 0, ?7, ?8, 0, NULL)",
        params![
            id,
            input.collection_slug,
            input.target_price_eth,
            input.max_quantity,
            input.wallet_address,
            created_at,
            expires_at,
            input.max_total_spend_eth,
        ],
    )
    .map_err(|e| e.to_string())?;
    Ok(id)
}

pub fn list_rules(db_path: &PathBuf, wallet_address: &str) -> Result<Vec<SnipeRule>, String> {
    let conn = open_connection(db_path)?;
    let mut stmt = conn
        .prepare(&format!(
            "SELECT {RULE_COLUMNS}
             FROM snipe_rules
             WHERE wallet_address = ?1
             ORDER BY created_at DESC"
        ))
        .map_err(|e| e.to_string())?;

    let rows = stmt
        .query_map(params![wallet_address], rule_from_row)
        .map_err(|e| e.to_string())?;

    let mut results = Vec::new();
    for row in rows {
        results.push(row.map_err(|e| e.to_string())?);
    }
    Ok(results)
}

pub fn list_all_rules(db_path: &PathBuf) -> Result<Vec<SnipeRule>, String> {
    let conn = open_connection(db_path)?;
    let mut stmt = conn
        .prepare(&format!(
            "SELECT {RULE_COLUMNS}
             FROM snipe_rules
             ORDER BY created_at DESC"
        ))
        .map_err(|e| e.to_string())?;

    let rows = stmt.query_map([], rule_from_row).map_err(|e| e.to_string())?;

    let mut results = Vec::new();
    for row in rows {
        results.push(row.map_err(|e| e.to_string())?);
    }
    Ok(results)
}

pub fn list_active_rules(db_path: &PathBuf) -> Result<Vec<SnipeRule>, String> {
    let conn = open_connection(db_path)?;
    let mut stmt = conn
        .prepare(&format!(
            "SELECT {RULE_COLUMNS}
             FROM snipe_rules
             WHERE active = 1
             ORDER BY created_at DESC"
        ))
        .map_err(|e| e.to_string())?;

    let rows = stmt.query_map([], rule_from_row).map_err(|e| e.to_string())?;

    let mut results = Vec::new();
    for row in rows {
        results.push(row.map_err(|e| e.to_string())?);
    }
    Ok(results)
}

pub fn count_active_rules(db_path: &PathBuf) -> Result<u32, String> {
    let conn = open_connection(db_path)?;
    conn.query_row(
        "SELECT COUNT(*) FROM snipe_rules WHERE active = 1",
        [],
        |row| row.get::<_, u32>(0),
    )
    .map_err(|e| e.to_string())
}

/// Deactivate every active rule whose `expires_at` is in the past.
/// Returns the number of rules deactivated. RFC3339 UTC timestamps produced by
/// `Utc::now().to_rfc3339()` compare correctly as strings.
pub fn deactivate_expired_rules(db_path: &PathBuf) -> Result<u32, String> {
    let conn = open_connection(db_path)?;
    let now = Utc::now().to_rfc3339();
    let changed = conn
        .execute(
            "UPDATE snipe_rules SET active = 0, deactivated_reason = ?2
             WHERE active = 1 AND expires_at != '' AND expires_at <= ?1",
            params![now, DEACTIVATED_EXPIRED],
        )
        .map_err(|e| e.to_string())?;
    Ok(changed as u32)
}

/// Switch a rule off and record why the engine did it (as opposed to the user).
pub fn deactivate_with_reason(db_path: &PathBuf, id: &str, reason: &str) -> Result<(), String> {
    let conn = open_connection(db_path)?;
    conn.execute(
        "UPDATE snipe_rules SET active = 0, deactivated_reason = ?1 WHERE id = ?2",
        params![reason, id],
    )
    .map_err(|e| e.to_string())?;
    Ok(())
}

pub fn delete_rule(db_path: &PathBuf, id: &str) -> Result<(), String> {
    let conn = open_connection(db_path)?;
    conn.execute("DELETE FROM snipe_rules WHERE id = ?1", params![id])
        .map_err(|e| e.to_string())?;
    Ok(())
}

pub fn set_rule_active(db_path: &PathBuf, id: &str, active: bool) -> Result<(), String> {
    let conn = open_connection(db_path)?;
    let active_int: i64 = if active { 1 } else { 0 };
    // Clearing `deactivated_reason` is deliberate: once the user toggles a rule
    // by hand, its state is a user decision and no longer an engine verdict.
    conn.execute(
        "UPDATE snipe_rules SET active = ?1, deactivated_reason = NULL WHERE id = ?2",
        params![active_int, id],
    )
    .map_err(|e| e.to_string())?;
    Ok(())
}

pub fn increment_triggered(db_path: &PathBuf, id: &str) -> Result<(), String> {
    let conn = open_connection(db_path)?;
    conn.execute(
        "UPDATE snipe_rules SET triggered_count = triggered_count + 1 WHERE id = ?1",
        params![id],
    )
    .map_err(|e| e.to_string())?;
    Ok(())
}

/// Accumulate (simulated) spend for a rule, in ETH.
pub fn add_spent(db_path: &PathBuf, id: &str, amount_eth: f64) -> Result<(), String> {
    let conn = open_connection(db_path)?;
    conn.execute(
        "UPDATE snipe_rules SET spent_eth = spent_eth + ?1 WHERE id = ?2",
        params![amount_eth, id],
    )
    .map_err(|e| e.to_string())?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn temp_db() -> PathBuf {
        let dir = std::env::temp_dir().join(format!("westron-sniping-test-{}", Uuid::new_v4()));
        std::fs::create_dir_all(&dir).unwrap();
        dir.join("sniping.db")
    }

    fn input(cap: Option<f64>) -> SnipeRuleInput {
        SnipeRuleInput {
            collection_slug: "0xbc4ca0eda7647a8ab7c2061c2e118a18a936f13d".to_string(),
            target_price_eth: 10.0,
            max_quantity: 1,
            wallet_address: "0xwallet".to_string(),
            ttl_hours: None,
            max_total_spend_eth: cap,
        }
    }

    /// A DB written by a build that predates every guardrail column must migrate
    /// in place, keep its rows, and get a non-empty expiry backfilled.
    #[test]
    fn migrates_a_legacy_database_in_place() {
        let path = temp_db();
        {
            let conn = Connection::open(&path).unwrap();
            conn.execute_batch(
                "CREATE TABLE snipe_rules (
                    id TEXT PRIMARY KEY, collection_slug TEXT NOT NULL,
                    target_price_eth REAL NOT NULL, max_quantity INTEGER NOT NULL,
                    wallet_address TEXT NOT NULL, active INTEGER NOT NULL DEFAULT 1,
                    created_at TEXT NOT NULL, triggered_count INTEGER NOT NULL DEFAULT 0
                );",
            )
            .unwrap();
            conn.execute(
                "INSERT INTO snipe_rules VALUES ('legacy', '0xabc', 1.0, 1, '0xwallet', 1, '2026-01-01T00:00:00+00:00', 3)",
                [],
            )
            .unwrap();
        }

        init_db(&path).unwrap();

        let rules = list_rules(&path, "0xwallet").unwrap();
        assert_eq!(rules.len(), 1);
        let r = &rules[0];
        assert_eq!(r.id, "legacy");
        assert_eq!(r.triggered_count, 3, "legacy data must survive the migration");
        assert!(!r.expires_at.is_empty(), "expires_at must be backfilled");
        assert!(r.max_total_spend_eth.is_none());
        assert_eq!(r.spent_eth, 0.0);
        assert!(r.deactivated_reason.is_none());

        // Running init_db again must be a no-op, not a double-ALTER failure.
        init_db(&path).unwrap();
        assert_eq!(list_rules(&path, "0xwallet").unwrap().len(), 1);
    }

    #[test]
    fn ttl_defaults_to_48h_and_is_capped_at_168h() {
        let path = temp_db();
        init_db(&path).unwrap();

        let default_id = create_rule(&path, &input(None)).unwrap();
        let mut over = input(None);
        over.ttl_hours = Some(1_000);
        let capped_id = create_rule(&path, &over).unwrap();

        let rules = list_rules(&path, "0xwallet").unwrap();
        let expiry_of = |id: &str| {
            let r = rules.iter().find(|r| r.id == id).unwrap();
            chrono::DateTime::parse_from_rfc3339(&r.expires_at).unwrap()
        };
        let hours_out = |id: &str| (expiry_of(id).timestamp() - Utc::now().timestamp()) as f64 / 3600.0;

        assert!((hours_out(&default_id) - DEFAULT_TTL_HOURS as f64).abs() < 1.0);
        assert!((hours_out(&capped_id) - MAX_TTL_HOURS as f64).abs() < 1.0);
    }

    /// Expiry, spend cap and a user pause must all stay distinguishable.
    #[test]
    fn deactivation_reasons_are_distinguishable() {
        let path = temp_db();
        init_db(&path).unwrap();

        let expired_id = create_rule(&path, &input(None)).unwrap();
        let capped_id = create_rule(&path, &input(Some(1.0))).unwrap();
        let paused_id = create_rule(&path, &input(None)).unwrap();

        // Force the first rule into the past, then run the sweep.
        {
            let conn = Connection::open(&path).unwrap();
            conn.execute(
                "UPDATE snipe_rules SET expires_at = ?1 WHERE id = ?2",
                params![(Utc::now() - chrono::Duration::hours(1)).to_rfc3339(), expired_id],
            )
            .unwrap();
        }
        assert_eq!(deactivate_expired_rules(&path).unwrap(), 1);
        deactivate_with_reason(&path, &capped_id, DEACTIVATED_SPEND_CAP).unwrap();
        set_rule_active(&path, &paused_id, false).unwrap();

        let rules = list_rules(&path, "0xwallet").unwrap();
        let reason = |id: &str| {
            rules
                .iter()
                .find(|r| r.id == id)
                .unwrap()
                .deactivated_reason
                .clone()
        };
        assert!(rules.iter().all(|r| !r.active));
        assert_eq!(reason(&expired_id).as_deref(), Some(DEACTIVATED_EXPIRED));
        assert_eq!(reason(&capped_id).as_deref(), Some(DEACTIVATED_SPEND_CAP));
        assert_eq!(reason(&paused_id), None, "a user pause is not an engine verdict");
        assert_eq!(count_active_rules(&path).unwrap(), 0);

        // Re-enabling by hand clears the engine's verdict.
        set_rule_active(&path, &capped_id, true).unwrap();
        let rules = list_rules(&path, "0xwallet").unwrap();
        let revived = rules.iter().find(|r| r.id == capped_id).unwrap();
        assert!(revived.active);
        assert!(revived.deactivated_reason.is_none());
    }

    #[test]
    fn add_spent_accumulates() {
        let path = temp_db();
        init_db(&path).unwrap();
        let id = create_rule(&path, &input(Some(5.0))).unwrap();
        add_spent(&path, &id, 1.5).unwrap();
        add_spent(&path, &id, 2.0).unwrap();
        let rules = list_rules(&path, "0xwallet").unwrap();
        assert!((rules[0].spent_eth - 3.5).abs() < 1e-9);
    }
}
