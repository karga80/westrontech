//! Shared HTTP client for all Alchemy REST + JSON-RPC traffic.
//!
//! One `reqwest::Client` (connection-pooled) is reused for every call so we
//! don't pay TLS handshake cost per request. JSON-RPC errors are surfaced as
//! `DataProviderError::Upstream`.

use reqwest::Client;
use serde::{de::DeserializeOwned, Serialize};
use std::time::Duration;

use crate::data::provider::{DataProviderError, ProviderResult};

/// Three host families:
/// - Mainnet RPC + NFT v3:    `https://eth-mainnet.g.alchemy.com/{...}`
/// - Data API (Portfolio):    `https://api.g.alchemy.com/data/v1/{key}/...`
/// - Prices API:              `https://api.g.alchemy.com/prices/v1/...` (Bearer auth)
pub struct AlchemyHttpClient {
    http: Client,
    api_key: String,
}

impl AlchemyHttpClient {
    pub fn new(api_key: &str) -> Self {
        let http = Client::builder()
            .timeout(Duration::from_secs(30))
            .pool_max_idle_per_host(8)
            .user_agent("westron-desktop/0.2")
            .build()
            .expect("reqwest client build");
        Self { http, api_key: api_key.to_string() }
    }

    pub fn api_key(&self) -> &str { &self.api_key }

    /// JSON-RPC v2 endpoint (Ethereum mainnet only — Westron is single-chain v1).
    pub fn rpc_url(&self) -> String {
        format!("https://eth-mainnet.g.alchemy.com/v2/{}", self.api_key)
    }

    /// NFT API v3 base.
    pub fn nft_v3_base(&self) -> String {
        format!("https://eth-mainnet.g.alchemy.com/nft/v3/{}", self.api_key)
    }

    /// Data API base (Portfolio).
    pub fn data_v1_base(&self) -> String {
        format!("https://api.g.alchemy.com/data/v1/{}", self.api_key)
    }

    /// Prices API base (Bearer auth — key passed via header, not URL).
    pub fn prices_v1_base(&self) -> &'static str {
        "https://api.g.alchemy.com/prices/v1"
    }

    pub fn ws_url(&self) -> String {
        format!("wss://eth-mainnet.g.alchemy.com/v2/{}", self.api_key)
    }

    /// Internal: dispatch a JSON-RPC v2 call.
    pub async fn rpc_call<T: DeserializeOwned>(
        &self,
        method: &str,
        params: serde_json::Value,
    ) -> ProviderResult<T> {
        let body = serde_json::json!({
            "jsonrpc": "2.0",
            "id": 1,
            "method": method,
            "params": params,
        });

        let resp = with_429_retry(|| async {
            self.http.post(self.rpc_url())
                .json(&body)
                .send()
                .await
                .map_err(|e| super::map_reqwest(e, &format!("rpc {method}")))
        }).await?;

        if !resp.status().is_success() {
            let status = resp.status().as_u16();
            let text = resp.text().await.unwrap_or_default();
            return Err(DataProviderError::Upstream { status: Some(status), message: text });
        }

        #[derive(serde::Deserialize)]
        struct RpcResp<T> {
            result: Option<T>,
            error: Option<RpcErr>,
        }
        #[derive(serde::Deserialize)]
        struct RpcErr { code: i64, message: String }

        let parsed: RpcResp<T> = resp.json().await
            .map_err(|e| DataProviderError::Decode(e.to_string()))?;

        if let Some(e) = parsed.error {
            return Err(DataProviderError::Upstream {
                status: None,
                message: format!("rpc {method} ({}): {}", e.code, e.message),
            });
        }
        parsed.result.ok_or_else(||
            DataProviderError::Upstream { status: None, message: format!("rpc {method}: empty result") })
    }

    /// REST GET on the NFT v3 endpoint.
    pub async fn nft_get<T: DeserializeOwned, Q: Serialize>(
        &self,
        path: &str,
        query: &Q,
    ) -> ProviderResult<T> {
        let url = format!("{}/{}", self.nft_v3_base().trim_end_matches('/'), path.trim_start_matches('/'));
        self.rest_get(&url, query, /* bearer */ None).await
    }

    /// REST POST on the Data API (Portfolio) endpoints.
    pub async fn data_post<T: DeserializeOwned, B: Serialize>(
        &self,
        path: &str,
        body: &B,
    ) -> ProviderResult<T> {
        let url = format!("{}/{}", self.data_v1_base().trim_end_matches('/'), path.trim_start_matches('/'));
        self.rest_post(&url, body, /* bearer */ None).await
    }

    /// REST GET on the Prices API (Bearer auth).
    pub async fn prices_get<T: DeserializeOwned, Q: Serialize>(
        &self,
        path: &str,
        query: &Q,
    ) -> ProviderResult<T> {
        let url = format!("{}/{}", self.prices_v1_base().trim_end_matches('/'), path.trim_start_matches('/'));
        self.rest_get(&url, query, Some(&self.api_key)).await
    }

    /// REST POST on the Prices API (Bearer auth).
    pub async fn prices_post<T: DeserializeOwned, B: Serialize>(
        &self,
        path: &str,
        body: &B,
    ) -> ProviderResult<T> {
        let url = format!("{}/{}", self.prices_v1_base().trim_end_matches('/'), path.trim_start_matches('/'));
        self.rest_post(&url, body, Some(&self.api_key)).await
    }

    async fn rest_get<T: DeserializeOwned, Q: Serialize>(
        &self,
        url: &str,
        query: &Q,
        bearer: Option<&str>,
    ) -> ProviderResult<T> {
        let resp = with_429_retry(|| async {
            let mut req = self.http.get(url).query(query);
            if let Some(token) = bearer {
                req = req.bearer_auth(token);
            }
            req.send().await.map_err(|e| super::map_reqwest(e, "GET"))
        }).await?;
        Self::handle_rest_response(resp).await
    }

    async fn rest_post<T: DeserializeOwned, B: Serialize>(
        &self,
        url: &str,
        body: &B,
        bearer: Option<&str>,
    ) -> ProviderResult<T> {
        let resp = with_429_retry(|| async {
            let mut req = self.http.post(url).json(body);
            if let Some(token) = bearer {
                req = req.bearer_auth(token);
            }
            req.send().await.map_err(|e| super::map_reqwest(e, "POST"))
        }).await?;
        Self::handle_rest_response(resp).await
    }

    async fn handle_rest_response<T: DeserializeOwned>(
        resp: reqwest::Response,
    ) -> ProviderResult<T> {
        let status = resp.status();
        if !status.is_success() {
            let body = resp.text().await.unwrap_or_default();
            return Err(DataProviderError::Upstream {
                status: Some(status.as_u16()),
                message: body,
            });
        }
        resp.json::<T>().await.map_err(|e| DataProviderError::Decode(e.to_string()))
    }
}

/// Send a request up to 3 times, backing off (200ms, 600ms) whenever Alchemy
/// answers with HTTP 429. Adding wallets fires a burst of concurrent requests
/// (balance + tokens + NFTs + price per wallet) that easily trips the free-tier
/// rate limit; without this, one 429'd call fails that wallet's entire
/// snapshot for the whole fetch cycle with no second attempt.
async fn with_429_retry<F, Fut>(mut send: F) -> ProviderResult<reqwest::Response>
where
    F: FnMut() -> Fut,
    Fut: std::future::Future<Output = ProviderResult<reqwest::Response>>,
{
    const BACKOFFS_MS: [u64; 2] = [200, 600];
    let mut attempt = 0;
    loop {
        let resp = send().await?;
        if resp.status().as_u16() != 429 {
            return Ok(resp);
        }
        if attempt >= BACKOFFS_MS.len() {
            return Err(DataProviderError::RateLimited);
        }
        tokio::time::sleep(Duration::from_millis(BACKOFFS_MS[attempt])).await;
        attempt += 1;
    }
}
