//! Local persistence for NFT cost basis (acquisition price).
//!
//! The whole point: an NFT's buy price is recorded ONCE, the first time we see
//! it, and then read from here forever. We never re-query the marketplace for a
//! token we already have a row for. `INSERT OR IGNORE` guarantees we never
//! overwrite a recorded basis (including a manual one).

use std::path::PathBuf;
use rusqlite::{params, Connection};

#[derive(Debug, Clone)]
pub struct CostBasis {
    pub price_eth: Option<f64>, // None = acquisition price unknown (mint/airdrop/transfer)
    pub acquired_at: Option<String>,
    pub source: String, // "marketplace_sale" | "manual" | "unknown"
}

fn open(db_path: &PathBuf) -> Result<Connection, String> {
    let conn = Connection::open(db_path).map_err(|e| e.to_string())?;
    conn.execute_batch("PRAGMA journal_mode=WAL;").map_err(|e| e.to_string())?;
    Ok(conn)
}

pub fn init_db(db_path: &PathBuf) -> Result<(), String> {
    let conn = open(db_path)?;
    conn.execute_batch(
        "CREATE TABLE IF NOT EXISTS nft_cost_basis (
            wallet      TEXT NOT NULL,
            contract    TEXT NOT NULL,
            token_id    TEXT NOT NULL,
            price_eth   REAL,
            acquired_at TEXT,
            source      TEXT NOT NULL,
            recorded_at TEXT NOT NULL,
            PRIMARY KEY (wallet, contract, token_id)
        );",
    )
    .map_err(|e| e.to_string())?;
    Ok(())
}

/// True if we already have a row for this token (so we must NOT re-query the API).
pub fn exists(db_path: &PathBuf, wallet: &str, contract: &str, token_id: &str) -> Result<bool, String> {
    let conn = open(db_path)?;
    let n: i64 = conn
        .query_row(
            "SELECT COUNT(1) FROM nft_cost_basis WHERE wallet=?1 AND contract=?2 AND token_id=?3",
            params![wallet.to_lowercase(), contract.to_lowercase(), token_id],
            |r| r.get(0),
        )
        .map_err(|e| e.to_string())?;
    Ok(n > 0)
}

/// Insert a cost-basis row only if one does not already exist. Never overwrites.
pub fn upsert_if_absent(
    db_path: &PathBuf,
    wallet: &str,
    contract: &str,
    token_id: &str,
    price_eth: Option<f64>,
    acquired_at: Option<&str>,
    source: &str,
    recorded_at: &str,
) -> Result<bool, String> {
    let conn = open(db_path)?;
    let changed = conn
        .execute(
            "INSERT OR IGNORE INTO nft_cost_basis
                (wallet, contract, token_id, price_eth, acquired_at, source, recorded_at)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)",
            params![
                wallet.to_lowercase(),
                contract.to_lowercase(),
                token_id,
                price_eth,
                acquired_at,
                source,
                recorded_at
            ],
        )
        .map_err(|e| e.to_string())?;
    Ok(changed > 0)
}

/// Manual override — the user sets/corrects the basis (e.g. for mints/gifts).
/// This one DOES replace, since it is an explicit user action.
pub fn set_manual(
    db_path: &PathBuf,
    wallet: &str,
    contract: &str,
    token_id: &str,
    price_eth: f64,
    recorded_at: &str,
) -> Result<(), String> {
    let conn = open(db_path)?;
    conn.execute(
        "INSERT INTO nft_cost_basis (wallet, contract, token_id, price_eth, acquired_at, source, recorded_at)
         VALUES (?1, ?2, ?3, ?4, NULL, 'manual', ?5)
         ON CONFLICT(wallet, contract, token_id)
         DO UPDATE SET price_eth=excluded.price_eth, source='manual', recorded_at=excluded.recorded_at",
        params![wallet.to_lowercase(), contract.to_lowercase(), token_id, price_eth, recorded_at],
    )
    .map_err(|e| e.to_string())?;
    Ok(())
}

pub fn get(db_path: &PathBuf, wallet: &str, contract: &str, token_id: &str) -> Result<Option<CostBasis>, String> {
    let conn = open(db_path)?;
    let mut stmt = conn
        .prepare("SELECT price_eth, acquired_at, source FROM nft_cost_basis WHERE wallet=?1 AND contract=?2 AND token_id=?3")
        .map_err(|e| e.to_string())?;
    let mut rows = stmt
        .query(params![wallet.to_lowercase(), contract.to_lowercase(), token_id])
        .map_err(|e| e.to_string())?;
    if let Some(row) = rows.next().map_err(|e| e.to_string())? {
        Ok(Some(CostBasis {
            price_eth: row.get(0).map_err(|e| e.to_string())?,
            acquired_at: row.get(1).map_err(|e| e.to_string())?,
            source: row.get(2).map_err(|e| e.to_string())?,
        }))
    } else {
        Ok(None)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn tmp(name: &str) -> PathBuf {
        // Per-test file name so parallel tests don't share a SQLite DB.
        let mut p = std::env::temp_dir();
        p.push(format!("westron_cost_basis_{name}.db"));
        let _ = std::fs::remove_file(&p);
        p
    }

    #[test]
    fn insert_if_absent_never_overwrites() {
        let db = tmp("insert");
        init_db(&db).unwrap();
        // First record: a real marketplace price.
        let first = upsert_if_absent(&db, "0xWALLET", "0xC0", "1", Some(2.5), Some("2024"), "marketplace_sale", "now").unwrap();
        assert!(first);
        // Second attempt for the same token must be ignored (no re-fetch/overwrite).
        let second = upsert_if_absent(&db, "0xwallet", "0xc0", "1", Some(9.9), None, "marketplace_sale", "now").unwrap();
        assert!(!second, "existing basis must not be overwritten");
        let got = get(&db, "0xWALLET", "0xC0", "1").unwrap().unwrap();
        assert_eq!(got.price_eth, Some(2.5));
        assert!(exists(&db, "0xWALLET", "0xC0", "1").unwrap());
        let _ = std::fs::remove_file(&db);
    }

    #[test]
    fn manual_override_replaces() {
        let db = tmp("manual");
        init_db(&db).unwrap();
        upsert_if_absent(&db, "0xW", "0xC", "7", None, None, "unknown", "now").unwrap();
        set_manual(&db, "0xW", "0xC", "7", 1.25, "now").unwrap();
        let got = get(&db, "0xW", "0xC", "7").unwrap().unwrap();
        assert_eq!(got.price_eth, Some(1.25));
        assert_eq!(got.source, "manual");
        let _ = std::fs::remove_file(&db);
    }
}
