//! Alchemy Prices API — REST under `https://api.g.alchemy.com/prices/v1`.
//!
//! Replaces the previous CoinGecko dependency. Single price source for ETH
//! and any ERC-20 we care about. Bearer auth via `Authorization` header.

use serde::{Deserialize, Serialize};

use crate::data::alchemy::AlchemyHttpClient;
use crate::data::provider::{DataProviderError, ProviderResult};
use crate::data::types::TokenPrice;

#[derive(Debug, Deserialize)]
struct PricesEnvelope<T> {
    data: Vec<T>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct SymbolPriceItem {
    symbol: String,
    prices: Option<Vec<PriceQuote>>,
    error: Option<serde_json::Value>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct AddressPriceItem {
    network: Option<String>,
    address: Option<String>,
    prices: Option<Vec<PriceQuote>>,
    error: Option<serde_json::Value>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct PriceQuote {
    currency: String,
    value: String,        // string-encoded decimal
    last_updated_at: Option<String>,
}

/// GET /prices/v1/tokens/by-symbol?symbols=ETH&symbols=USDC
pub async fn get_prices_by_symbol(
    http: &AlchemyHttpClient,
    symbols: &[&str],
) -> ProviderResult<Vec<TokenPrice>> {
    if symbols.is_empty() {
        return Ok(vec![]);
    }
    // reqwest's query serializer repeats each `symbols=` for every entry.
    let query: Vec<(&str, &str)> = symbols.iter().map(|s| ("symbols", *s)).collect();
    let env: PricesEnvelope<SymbolPriceItem> = http.prices_get("tokens/by-symbol", &query).await?;

    Ok(env.data.into_iter().filter_map(|item| {
        if item.error.is_some() && item.prices.as_ref().map_or(true, |p| p.is_empty()) {
            return None;
        }
        let usd = item.prices.as_ref()
            .and_then(|qs| qs.iter().find(|q| q.currency.eq_ignore_ascii_case("usd")))
            .and_then(|q| q.value.parse::<f64>().ok());
        let last_updated_at = item.prices.as_ref()
            .and_then(|qs| qs.iter().find(|q| q.currency.eq_ignore_ascii_case("usd")))
            .and_then(|q| q.last_updated_at.clone());
        Some(TokenPrice {
            symbol: item.symbol,
            address: None,
            network: None,
            usd,
            last_updated_at,
        })
    }).collect())
}

/// POST /prices/v1/tokens/by-address (single network: eth-mainnet).
pub async fn get_prices_by_address(
    http: &AlchemyHttpClient,
    addresses: &[&str],
) -> ProviderResult<Vec<TokenPrice>> {
    if addresses.is_empty() {
        return Ok(vec![]);
    }

    #[derive(Serialize)]
    struct Body<'a> {
        addresses: Vec<AddrEntry<'a>>,
    }
    #[derive(Serialize)]
    #[serde(rename_all = "camelCase")]
    struct AddrEntry<'a> {
        network: &'a str,
        address: &'a str,
    }

    let body = Body {
        addresses: addresses.iter().map(|a| AddrEntry {
            network: "eth-mainnet",
            address: *a,
        }).collect(),
    };

    let env: PricesEnvelope<AddressPriceItem> = http.prices_post("tokens/by-address", &body).await?;

    Ok(env.data.into_iter().filter_map(|item| {
        let address = item.address.clone()?;
        let usd = item.prices.as_ref()
            .and_then(|qs| qs.iter().find(|q| q.currency.eq_ignore_ascii_case("usd")))
            .and_then(|q| q.value.parse::<f64>().ok());
        let last_updated_at = item.prices.as_ref()
            .and_then(|qs| qs.iter().find(|q| q.currency.eq_ignore_ascii_case("usd")))
            .and_then(|q| q.last_updated_at.clone());
        Some(TokenPrice {
            symbol: String::new(), // not returned by by-address endpoint
            address: Some(address),
            network: item.network,
            usd,
            last_updated_at,
        })
    }).collect())
}

/// Convenience: ETH/USD only — used by analytics + portfolio snapshot.
pub async fn get_eth_price_usd(http: &AlchemyHttpClient) -> ProviderResult<f64> {
    let prices = get_prices_by_symbol(http, &["ETH"]).await?;
    prices
        .into_iter()
        .find(|p| p.symbol.eq_ignore_ascii_case("ETH"))
        .and_then(|p| p.usd)
        .ok_or_else(|| DataProviderError::Upstream {
            status: None,
            message: "ETH price not present in Alchemy response".into(),
        })
}
