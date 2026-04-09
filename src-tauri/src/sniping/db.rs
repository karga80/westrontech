use rusqlite::{Connection, params};
use std::path::PathBuf;
use uuid::Uuid;
use chrono::Utc;

use super::types::{SnipeRule, SnipeRuleInput};

fn open_connection(db_path: &PathBuf) -> Result<Connection, String> {
    let conn = Connection::open(db_path).map_err(|e| e.to_string())?;
    conn.execute_batch("PRAGMA journal_mode=WAL;").map_err(|e| e.to_string())?;
    Ok(conn)
}

pub fn init_db(db_path: &PathBuf) -> Result<(), String> {
    let conn = open_connection(db_path)?;
    conn.execute_batch(
        "CREATE TABLE IF NOT EXISTS snipe_rules (
            id                TEXT PRIMARY KEY,
            collection_slug   TEXT NOT NULL,
            target_price_eth  REAL NOT NULL,
            max_quantity      INTEGER NOT NULL,
            wallet_address    TEXT NOT NULL,
            active            INTEGER NOT NULL DEFAULT 1,
            created_at        TEXT NOT NULL,
            triggered_count   INTEGER NOT NULL DEFAULT 0
        );",
    )
    .map_err(|e| e.to_string())?;
    Ok(())
}

pub fn create_rule(db_path: &PathBuf, input: &SnipeRuleInput) -> Result<String, String> {
    let conn = open_connection(db_path)?;
    let id = Uuid::new_v4().to_string();
    let created_at = Utc::now().to_rfc3339();
    conn.execute(
        "INSERT INTO snipe_rules
            (id, collection_slug, target_price_eth, max_quantity, wallet_address, active, created_at, triggered_count)
         VALUES (?1, ?2, ?3, ?4, ?5, 1, ?6, 0)",
        params![
            id,
            input.collection_slug,
            input.target_price_eth,
            input.max_quantity,
            input.wallet_address,
            created_at,
        ],
    )
    .map_err(|e| e.to_string())?;
    Ok(id)
}

pub fn list_rules(db_path: &PathBuf, wallet_address: &str) -> Result<Vec<SnipeRule>, String> {
    let conn = open_connection(db_path)?;
    let mut stmt = conn
        .prepare(
            "SELECT id, collection_slug, target_price_eth, max_quantity, wallet_address,
                    active, created_at, triggered_count
             FROM snipe_rules
             WHERE wallet_address = ?1
             ORDER BY created_at DESC",
        )
        .map_err(|e| e.to_string())?;

    let rows = stmt
        .query_map(params![wallet_address], |row| {
            Ok(SnipeRule {
                id: row.get(0)?,
                collection_slug: row.get(1)?,
                target_price_eth: row.get(2)?,
                max_quantity: row.get::<_, u32>(3)?,
                wallet_address: row.get(4)?,
                active: row.get::<_, i64>(5)? != 0,
                created_at: row.get(6)?,
                triggered_count: row.get::<_, u32>(7)?,
            })
        })
        .map_err(|e| e.to_string())?;

    let mut results = Vec::new();
    for row in rows {
        results.push(row.map_err(|e| e.to_string())?);
    }
    Ok(results)
}

pub fn list_active_rules(db_path: &PathBuf) -> Result<Vec<SnipeRule>, String> {
    let conn = open_connection(db_path)?;
    let mut stmt = conn
        .prepare(
            "SELECT id, collection_slug, target_price_eth, max_quantity, wallet_address,
                    active, created_at, triggered_count
             FROM snipe_rules
             WHERE active = 1
             ORDER BY created_at DESC",
        )
        .map_err(|e| e.to_string())?;

    let rows = stmt
        .query_map([], |row| {
            Ok(SnipeRule {
                id: row.get(0)?,
                collection_slug: row.get(1)?,
                target_price_eth: row.get(2)?,
                max_quantity: row.get::<_, u32>(3)?,
                wallet_address: row.get(4)?,
                active: row.get::<_, i64>(5)? != 0,
                created_at: row.get(6)?,
                triggered_count: row.get::<_, u32>(7)?,
            })
        })
        .map_err(|e| e.to_string())?;

    let mut results = Vec::new();
    for row in rows {
        results.push(row.map_err(|e| e.to_string())?);
    }
    Ok(results)
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
    conn.execute(
        "UPDATE snipe_rules SET active = ?1 WHERE id = ?2",
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
