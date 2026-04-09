use rusqlite::{Connection, params};
use std::path::PathBuf;
use uuid::Uuid;
use chrono::Utc;

use super::types::{AlertRule, AlertRuleInput};

fn open_connection(db_path: &PathBuf) -> Result<Connection, String> {
    let conn = Connection::open(db_path).map_err(|e| e.to_string())?;
    conn.execute_batch("PRAGMA journal_mode=WAL;").map_err(|e| e.to_string())?;
    Ok(conn)
}

pub fn init_db(db_path: &PathBuf) -> Result<(), String> {
    let conn = open_connection(db_path)?;
    conn.execute_batch(
        "CREATE TABLE IF NOT EXISTS alert_rules (
            id                TEXT PRIMARY KEY,
            alert_type        TEXT NOT NULL,
            wallet_address    TEXT NOT NULL,
            collection_slug   TEXT,
            threshold_eth     REAL NOT NULL,
            condition         TEXT NOT NULL,
            discord_webhook   TEXT,
            active            INTEGER NOT NULL DEFAULT 1,
            created_at        TEXT NOT NULL,
            last_triggered_at TEXT
        );",
    )
    .map_err(|e| e.to_string())?;
    Ok(())
}

pub fn create_alert(db_path: &PathBuf, input: &AlertRuleInput) -> Result<String, String> {
    let conn = open_connection(db_path)?;
    let id = Uuid::new_v4().to_string();
    let created_at = Utc::now().to_rfc3339();
    conn.execute(
        "INSERT INTO alert_rules
            (id, alert_type, wallet_address, collection_slug, threshold_eth, condition, discord_webhook, active, created_at, last_triggered_at)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, 1, ?8, NULL)",
        params![
            id,
            input.alert_type,
            input.wallet_address,
            input.collection_slug,
            input.threshold_eth,
            input.condition,
            input.discord_webhook,
            created_at,
        ],
    )
    .map_err(|e| e.to_string())?;
    Ok(id)
}

pub fn list_alerts(db_path: &PathBuf, wallet_address: &str) -> Result<Vec<AlertRule>, String> {
    let conn = open_connection(db_path)?;
    let mut stmt = conn
        .prepare(
            "SELECT id, alert_type, wallet_address, collection_slug, threshold_eth, condition,
                    discord_webhook, active, created_at, last_triggered_at
             FROM alert_rules
             WHERE wallet_address = ?1
             ORDER BY created_at DESC",
        )
        .map_err(|e| e.to_string())?;

    let rows = stmt
        .query_map(params![wallet_address], |row| {
            Ok(AlertRule {
                id: row.get(0)?,
                alert_type: row.get(1)?,
                wallet_address: row.get(2)?,
                collection_slug: row.get(3)?,
                threshold_eth: row.get(4)?,
                condition: row.get(5)?,
                discord_webhook: row.get(6)?,
                active: row.get::<_, i64>(7)? != 0,
                created_at: row.get(8)?,
                last_triggered_at: row.get(9)?,
            })
        })
        .map_err(|e| e.to_string())?;

    let mut results = Vec::new();
    for row in rows {
        results.push(row.map_err(|e| e.to_string())?);
    }
    Ok(results)
}

pub fn list_active_alerts_for_wallet(
    db_path: &PathBuf,
    wallet_address: &str,
    alert_type: &str,
) -> Result<Vec<AlertRule>, String> {
    let conn = open_connection(db_path)?;
    let mut stmt = conn
        .prepare(
            "SELECT id, alert_type, wallet_address, collection_slug, threshold_eth, condition,
                    discord_webhook, active, created_at, last_triggered_at
             FROM alert_rules
             WHERE wallet_address = ?1 AND alert_type = ?2 AND active = 1",
        )
        .map_err(|e| e.to_string())?;

    let rows = stmt
        .query_map(params![wallet_address, alert_type], |row| {
            Ok(AlertRule {
                id: row.get(0)?,
                alert_type: row.get(1)?,
                wallet_address: row.get(2)?,
                collection_slug: row.get(3)?,
                threshold_eth: row.get(4)?,
                condition: row.get(5)?,
                discord_webhook: row.get(6)?,
                active: row.get::<_, i64>(7)? != 0,
                created_at: row.get(8)?,
                last_triggered_at: row.get(9)?,
            })
        })
        .map_err(|e| e.to_string())?;

    let mut results = Vec::new();
    for row in rows {
        results.push(row.map_err(|e| e.to_string())?);
    }
    Ok(results)
}

#[allow(dead_code)]
pub fn list_active_floor_alerts(
    db_path: &PathBuf,
    collection_slug: &str,
) -> Result<Vec<AlertRule>, String> {
    let conn = open_connection(db_path)?;
    let mut stmt = conn
        .prepare(
            "SELECT id, alert_type, wallet_address, collection_slug, threshold_eth, condition,
                    discord_webhook, active, created_at, last_triggered_at
             FROM alert_rules
             WHERE collection_slug = ?1 AND alert_type = 'floor_price' AND active = 1",
        )
        .map_err(|e| e.to_string())?;

    let rows = stmt
        .query_map(params![collection_slug], |row| {
            Ok(AlertRule {
                id: row.get(0)?,
                alert_type: row.get(1)?,
                wallet_address: row.get(2)?,
                collection_slug: row.get(3)?,
                threshold_eth: row.get(4)?,
                condition: row.get(5)?,
                discord_webhook: row.get(6)?,
                active: row.get::<_, i64>(7)? != 0,
                created_at: row.get(8)?,
                last_triggered_at: row.get(9)?,
            })
        })
        .map_err(|e| e.to_string())?;

    let mut results = Vec::new();
    for row in rows {
        results.push(row.map_err(|e| e.to_string())?);
    }
    Ok(results)
}

pub fn delete_alert(db_path: &PathBuf, id: &str) -> Result<(), String> {
    let conn = open_connection(db_path)?;
    conn.execute("DELETE FROM alert_rules WHERE id = ?1", params![id])
        .map_err(|e| e.to_string())?;
    Ok(())
}

pub fn set_alert_active(db_path: &PathBuf, id: &str, active: bool) -> Result<(), String> {
    let conn = open_connection(db_path)?;
    let active_int: i64 = if active { 1 } else { 0 };
    conn.execute(
        "UPDATE alert_rules SET active = ?1 WHERE id = ?2",
        params![active_int, id],
    )
    .map_err(|e| e.to_string())?;
    Ok(())
}

pub fn update_last_triggered(db_path: &PathBuf, id: &str) -> Result<(), String> {
    let conn = open_connection(db_path)?;
    let now = Utc::now().to_rfc3339();
    conn.execute(
        "UPDATE alert_rules SET last_triggered_at = ?1 WHERE id = ?2",
        params![now, id],
    )
    .map_err(|e| e.to_string())?;
    Ok(())
}
