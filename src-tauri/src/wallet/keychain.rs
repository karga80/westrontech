use std::path::PathBuf;

fn data_dir() -> Result<PathBuf, String> {
    let base = dirs_next::data_dir()
        .ok_or_else(|| "Could not determine data directory".to_string())?;
    let dir = base.join("Westron").join("keys");
    std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    Ok(dir)
}

fn key_path(name: &str) -> Result<PathBuf, String> {
    Ok(data_dir()?.join(format!("{name}.key")))
}

fn write_key(name: &str, value: &str) -> Result<(), String> {
    std::fs::write(key_path(name)?, value).map_err(|e| e.to_string())
}

fn read_key(name: &str) -> Result<String, String> {
    let path = key_path(name)?;
    if !path.exists() {
        return Err("No matching entry found in secure storage".to_string());
    }
    std::fs::read_to_string(&path).map_err(|e| e.to_string())
}

fn delete_key_file(name: &str) -> Result<(), String> {
    let path = key_path(name)?;
    if path.exists() {
        std::fs::remove_file(&path).map_err(|e| e.to_string())?;
    }
    Ok(())
}

// ── Wallet private keys ───────────────────────────────────────────────────────

pub fn store_key(address: &str, private_key_hex: &str) -> Result<(), String> {
    write_key(&format!("wallet_{address}"), private_key_hex)
}

pub fn fetch_key(address: &str) -> Result<String, String> {
    read_key(&format!("wallet_{address}"))
}

#[allow(dead_code)]
pub fn delete_key(address: &str) -> Result<(), String> {
    delete_key_file(&format!("wallet_{address}"))
}

// ── Alchemy API key ───────────────────────────────────────────────────────────

pub fn store_alchemy_key(api_key: &str) -> Result<(), String> {
    write_key("alchemy", api_key)
}

pub fn fetch_alchemy_key() -> Result<String, String> {
    read_key("alchemy")
}

pub fn delete_alchemy_key() -> Result<(), String> {
    delete_key_file("alchemy")
}

// ── OpenSea API key ───────────────────────────────────────────────────────────

pub fn store_opensea_key(api_key: &str) -> Result<(), String> {
    write_key("opensea", api_key)
}

pub fn fetch_opensea_key() -> Result<String, String> {
    read_key("opensea")
}

pub fn delete_opensea_key() -> Result<(), String> {
    delete_key_file("opensea")
}

// ── Etherscan API key ─────────────────────────────────────────────────────────

pub fn store_etherscan_key(api_key: &str) -> Result<(), String> {
    write_key("etherscan", api_key)
}

pub fn fetch_etherscan_key() -> Result<String, String> {
    read_key("etherscan")
}

pub fn delete_etherscan_key() -> Result<(), String> {
    delete_key_file("etherscan")
}
