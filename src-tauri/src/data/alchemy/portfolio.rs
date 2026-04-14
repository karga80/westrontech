//! Alchemy Portfolio API — `https://api.g.alchemy.com/data/v1/{key}/...`.
//!
//! `tokens/by-address` returns native + ERC-20 balances, metadata, and USD
//! prices in a single call — replacing three separate round-trips
//! (eth_getBalance + alchemy_getTokenBalances + per-token price lookup).

use serde::{Deserialize, Serialize};

use crate::data::alchemy::AlchemyHttpClient;
use crate::data::provider::ProviderResult;
use crate::data::types::{WalletPortfolio, WalletToken};

/// Single network for v1 — Westron is ETH-mainnet only.
const NETWORK: &str = "eth-mainnet";

#[derive(Serialize)]
struct TokensByAddressBody<'a> {
    addresses: Vec<AddrEntry<'a>>,
    #[serde(rename = "withMetadata")]
    with_metadata: bool,
    #[serde(rename = "withPrices")]
    with_prices: bool,
    #[serde(rename = "includeNativeTokens")]
    include_native_tokens: bool,
    #[serde(rename = "includeErc20Tokens")]
    include_erc20_tokens: bool,
}

#[derive(Serialize)]
struct AddrEntry<'a> {
    address: &'a str,
    networks: [&'a str; 1],
}

#[derive(Debug, Deserialize)]
struct TokensEnvelope {
    data: TokensData,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct TokensData {
    tokens: Vec<TokenRow>,
    #[serde(default)]
    page_key: Option<String>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct TokenRow {
    address: String,
    network: String,
    token_address: Option<String>,
    token_balance: Option<String>,
    token_metadata: Option<TokenMetadataRow>,
    token_prices: Option<Vec<PriceQuote>>,
}

#[derive(Debug, Deserialize)]
struct TokenMetadataRow {
    name: Option<String>,
    symbol: Option<String>,
    decimals: Option<u8>,
    logo: Option<String>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct PriceQuote {
    currency: String,
    value: String,
    last_updated_at: Option<String>,
}

/// `tokens/by-address` request — returns native + ERC-20 balances/prices/metadata.
pub async fn get_wallet_tokens(
    http: &AlchemyHttpClient,
    wallet: &str,
) -> ProviderResult<Vec<WalletToken>> {
    let body = TokensByAddressBody {
        addresses: vec![AddrEntry { address: wallet, networks: [NETWORK] }],
        with_metadata: true,
        with_prices: true,
        include_native_tokens: true,
        include_erc20_tokens: true,
    };
    let env: TokensEnvelope = http.data_post("assets/tokens/by-address", &body).await?;

    Ok(env.data.tokens.into_iter().map(|row| token_row_to_wallet_token(row)).collect())
}

/// Aggregated portfolio snapshot (single network) — derived purely from the
/// Portfolio API tokens response.
pub async fn get_wallet_portfolio(
    http: &AlchemyHttpClient,
    wallet: &str,
) -> ProviderResult<WalletPortfolio> {
    let tokens = get_wallet_tokens(http, wallet).await?;

    let eth_balance = tokens
        .iter()
        .find(|t| t.is_native)
        .and_then(|t| t.balance)
        .unwrap_or(0.0);

    let eth_price_usd = tokens.iter().find(|t| t.is_native).and_then(|t| t.usd_price);
    let total_usd: f64 = tokens.iter().filter_map(|t| t.usd_value).sum();

    Ok(WalletPortfolio {
        wallet: wallet.to_string(),
        eth_balance,
        eth_price_usd,
        total_usd,
        tokens,
    })
}

fn token_row_to_wallet_token(row: TokenRow) -> WalletToken {
    let is_native = row.token_address.is_none();

    // Decimals: native ETH → 18, otherwise from metadata.
    let decimals = if is_native { Some(18u8) } else {
        row.token_metadata.as_ref().and_then(|m| m.decimals)
    };

    // tokenBalance comes back as a 0x-prefixed hex string for ERC-20s and a
    // hex/decimal string for native; parse both.
    let balance_raw = row.token_balance.clone();
    let balance = balance_raw.as_ref().and_then(|raw| {
        let trimmed = raw.trim_start_matches("0x");
        let parsed_u128 = u128::from_str_radix(trimmed, 16).ok();
        parsed_u128.map(|wei| {
            let d = decimals.unwrap_or(18) as i32;
            (wei as f64) / 10f64.powi(d)
        })
    });

    let usd_price = row.token_prices.as_ref()
        .and_then(|qs| qs.iter().find(|q| q.currency.eq_ignore_ascii_case("usd")))
        .and_then(|q| q.value.parse::<f64>().ok());
    let price_last_updated_at = row.token_prices.as_ref()
        .and_then(|qs| qs.iter().find(|q| q.currency.eq_ignore_ascii_case("usd")))
        .and_then(|q| q.last_updated_at.clone());

    let usd_value = match (balance, usd_price) {
        (Some(b), Some(p)) => Some(b * p),
        _ => None,
    };

    let symbol = if is_native {
        Some("ETH".to_string())
    } else {
        row.token_metadata.as_ref().and_then(|m| m.symbol.clone())
    };
    let name = if is_native {
        Some("Ethereum".to_string())
    } else {
        row.token_metadata.as_ref().and_then(|m| m.name.clone())
    };
    let logo = row.token_metadata.as_ref().and_then(|m| m.logo.clone());

    WalletToken {
        address: row.address,
        network: row.network,
        token_address: row.token_address,
        symbol,
        name,
        decimals,
        logo,
        balance_raw,
        balance,
        usd_value,
        usd_price,
        price_last_updated_at,
        is_native,
    }
}
