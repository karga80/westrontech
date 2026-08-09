use reqwest::Client;
use std::time::Duration;
use crate::rpc::types::*;

pub struct AlchemyClient {
    client: Client,
    base_url: String,
}

impl AlchemyClient {
    pub fn new(api_key: &str) -> Self {
        AlchemyClient {
            client: Client::new(),
            base_url: format!("https://eth-mainnet.g.alchemy.com/v2/{}", api_key),
        }
    }

    async fn call<T: for<'de> serde::Deserialize<'de>>(
        &self,
        request: &RpcRequest,
    ) -> Result<T, String> {
        let response = with_429_retry(|| {
            self.client
                .post(&self.base_url)
                .json(request)
                .send()
        }).await?;

        let rpc_response: RpcResponse<T> = response
            .json()
            .await
            .map_err(|e| e.to_string())?;

        if let Some(error) = rpc_response.error {
            return Err(format!("RPC error {}: {}", error.code, error.message));
        }

        rpc_response.result.ok_or_else(|| "Empty result".to_string())
    }

    /// ETH bakiyesi al (hex → ETH çevrimi dahil)
    pub async fn get_eth_balance(&self, address: &str) -> Result<EthBalance, String> {
        let req = RpcRequest::new(
            "eth_getBalance",
            serde_json::json!([address, "latest"]),
        );
        let hex: String = self.call(&req).await?;
        let wei = u128::from_str_radix(hex.trim_start_matches("0x"), 16)
            .map_err(|e| e.to_string())?;
        let eth = wei as f64 / 1e18;
        Ok(EthBalance {
            address: address.to_string(),
            wei: wei.to_string(),
            eth,
        })
    }

    /// ERC-20 token bakiyeleri (Alchemy enhanced API)
    pub async fn get_token_balances(
        &self,
        address: &str,
    ) -> Result<Vec<TokenBalance>, String> {
        let req = RpcRequest::new(
            "alchemy_getTokenBalances",
            serde_json::json!([address, "erc20"]),
        );

        #[derive(serde::Deserialize)]
        struct TokenBalanceResult {
            #[serde(rename = "tokenBalances")]
            token_balances: Vec<TokenBalance>,
        }

        let result: TokenBalanceResult = self.call(&req).await?;
        Ok(result.token_balances)
    }

    /// Transaction history — incoming (toAddress) and outgoing (fromAddress) are
    /// fetched in parallel, merged, deduplicated by hash and sorted newest-first.
    ///
    /// `order: desc` is load-bearing: without it Alchemy defaults to ascending
    /// and returns the OLDEST 100 transfers from block 0, so a wallet's recent
    /// history never appeared at all.
    ///
    /// An empty result is Ok(vec![]), not an error — a wallet with no transfers
    /// is a normal state, and returning Err made the UI say "failed to load"
    /// when there was simply nothing to show.
    pub async fn get_asset_transfers(
        &self,
        address: &str,
        from_block: &str,
    ) -> Result<Vec<AssetTransfer>, String> {
        let req_in = RpcRequest::new(
            "alchemy_getAssetTransfers",
            serde_json::json!([{
                "fromBlock": from_block,
                "toAddress": address,
                "category": ["external", "erc20", "erc721", "erc1155"],
                "withMetadata": true,
                "excludeZeroValue": false,
                "order": "desc",
                "maxCount": "0x64",
                "maxCount": "0x64"
            }]),
        );
        let req_out = RpcRequest::new(
            "alchemy_getAssetTransfers",
            serde_json::json!([{
                "fromBlock": from_block,
                "fromAddress": address,
                "category": ["external", "erc20", "erc721", "erc1155"],
                "withMetadata": true,
                "excludeZeroValue": false,
                "maxCount": "0x64"
            }]),
        );

        #[derive(serde::Deserialize)]
        struct TransferResult {
            transfers: Vec<AssetTransfer>,
        }

        let (res_in, res_out) = tokio::join!(
            self.call::<TransferResult>(&req_in),
            self.call::<TransferResult>(&req_out),
        );

        let mut all: Vec<AssetTransfer> = res_in.map(|r| r.transfers).unwrap_or_default();
        let outgoing: Vec<AssetTransfer> = res_out.map(|r| r.transfers).unwrap_or_default();

        // Deduplicate by hash (self-transfers appear on both sides)
        let mut seen: std::collections::HashSet<String> =
            all.iter().map(|t| t.hash.clone()).collect();
        for tx in outgoing {
            if seen.insert(tx.hash.clone()) {
                all.push(tx);
            }
        }

        // Sort newest-first by block number
        all.sort_by(|a, b| {
            let a_n = u64::from_str_radix(a.block_num.trim_start_matches("0x"), 16).unwrap_or(0);
            let b_n = u64::from_str_radix(b.block_num.trim_start_matches("0x"), 16).unwrap_or(0);
            b_n.cmp(&a_n)
        });
        all.truncate(100);

        Ok(all)
    }

    /// Outgoing NFT transfer geçmişi (fromAddress bazlı)
    pub async fn get_asset_transfers_from(
        &self,
        address: &str,
        from_block: &str,
    ) -> Result<Vec<AssetTransfer>, String> {
        let req = RpcRequest::new(
            "alchemy_getAssetTransfers",
            serde_json::json!([{
                "fromBlock": from_block,
                "fromAddress": address,
                "category": ["erc721", "erc1155"],
                "withMetadata": true,
                "excludeZeroValue": false,
                "maxCount": "0x64"
            }]),
        );

        #[derive(serde::Deserialize)]
        struct TransferResult {
            transfers: Vec<AssetTransfer>,
        }

        let result: TransferResult = self.call(&req).await?;
        Ok(result.transfers)
    }

    /// Incoming NFT transfer geçmişi (toAddress bazlı, sadece NFT kategorileri)
    pub async fn get_nft_transfers_to(
        &self,
        address: &str,
        from_block: &str,
    ) -> Result<Vec<AssetTransfer>, String> {
        let req = RpcRequest::new(
            "alchemy_getAssetTransfers",
            serde_json::json!([{
                "fromBlock": from_block,
                "toAddress": address,
                "category": ["erc721", "erc1155"],
                "withMetadata": true,
                "excludeZeroValue": false,
                "maxCount": "0x64"
            }]),
        );

        #[derive(serde::Deserialize)]
        struct TransferResult {
            transfers: Vec<AssetTransfer>,
        }

        let result: TransferResult = self.call(&req).await?;
        Ok(result.transfers)
    }

    pub async fn get_token_metadata(&self, contract_address: &str) -> Result<TokenMetadata, String> {
        let req = RpcRequest::new(
            "alchemy_getTokenMetadata",
            serde_json::json!([contract_address]),
        );
        #[derive(serde::Deserialize)]
        struct MetaResult {
            name: Option<String>,
            symbol: Option<String>,
            decimals: Option<u8>,
            logo: Option<String>,
        }
        let result: MetaResult = self.call(&req).await?;
        Ok(TokenMetadata {
            contract_address: contract_address.to_string(),
            name: result.name,
            symbol: result.symbol,
            decimals: result.decimals,
            logo: result.logo,
        })
    }

    pub fn nft_base_url(&self) -> String {
        // NFT API v3 endpoint
        format!("https://eth-mainnet.g.alchemy.com/nft/v3/{}",
            self.base_url.split('/').last().unwrap_or(""))
    }

    /// Wallet'a ait tüm NFT'leri getir (Alchemy NFT API v3)
    pub async fn get_nfts_for_owner(
        &self,
        owner_address: &str,
        page_key: Option<&str>,
    ) -> Result<NftsForOwnerResponse, String> {
        let nft_url = self.nft_base_url();
        let mut query = vec![
            ("owner", owner_address.to_string()),
            ("withMetadata", "true".to_string()),
            ("pageSize", "50".to_string()),
        ];
        if let Some(key) = page_key {
            query.push(("pageKey", key.to_string()));
        }

        let response = with_429_retry(|| {
            self.client
                .get(format!("{}/getNFTsForOwner", nft_url))
                .query(&query)
                .send()
        }).await?;

        #[derive(serde::Deserialize)]
        #[serde(rename_all = "camelCase")]
        struct AlchemyNftResponse {
            owned_nfts: Vec<AlchemyNft>,
            total_count: u64,
            page_key: Option<String>,
        }

        #[derive(serde::Deserialize)]
        #[serde(rename_all = "camelCase")]
        struct AlchemyNft {
            contract: AlchemyContract,
            token_id: String,
            name: Option<String>,
            description: Option<String>,
            image: Option<AlchemyImage>,
            raw: Option<AlchemyRaw>,
            balance: Option<String>,
        }

        #[derive(serde::Deserialize)]
        #[serde(rename_all = "camelCase")]
        struct AlchemyContract {
            address: String,
            name: Option<String>,
            symbol: Option<String>,
            token_type: Option<String>,
            #[serde(rename = "openSea")]
            open_sea: Option<AlchemyOpenSea>,
        }

        #[derive(serde::Deserialize)]
        #[serde(rename_all = "camelCase")]
        struct AlchemyOpenSea {
            floor_price: Option<f64>,
            collection_name: Option<String>,
        }

        #[derive(serde::Deserialize)]
        #[serde(rename_all = "camelCase")]
        struct AlchemyImage {
            cached_url: Option<String>,
            original_url: Option<String>,
            thumbnail_url: Option<String>,
        }

        #[derive(serde::Deserialize)]
        struct AlchemyRaw {
            metadata: Option<serde_json::Value>,
        }

        let data: AlchemyNftResponse = response.json().await.map_err(|e| e.to_string())?;

        let owned_nfts = data.owned_nfts.into_iter().map(|nft| {
            let attributes = nft.raw.as_ref()
                .and_then(|r| r.metadata.as_ref())
                .and_then(|m| m.get("attributes"))
                .and_then(|a| serde_json::from_value::<Vec<NftAttribute>>(a.clone()).ok());

            OwnedNft {
                contract: NftContract {
                    address: nft.contract.address,
                    name: nft.contract.name,
                    symbol: nft.contract.symbol,
                    token_type: nft.contract.token_type,
                    opensea_floor_price: nft.contract.open_sea.as_ref().and_then(|o| o.floor_price),
                    opensea_collection_name: nft.contract.open_sea.as_ref().and_then(|o| o.collection_name.clone()),
                },
                token_id: nft.token_id,
                name: nft.name,
                description: nft.description,
                image: nft.image.map(|img| NftImage {
                    cached_url: img.cached_url,
                    original_url: img.original_url,
                    thumbnail_url: img.thumbnail_url,
                }),
                raw_metadata: nft.raw.and_then(|r| r.metadata),
                attributes,
                balance: nft.balance,
            }
        }).collect();

        Ok(NftsForOwnerResponse {
            owned_nfts,
            total_count: data.total_count,
            page_key: data.page_key,
        })
    }

    /// Koleksiyon floor fiyatı (Alchemy NFT API)
    pub async fn get_floor_price(&self, contract_address: &str) -> Result<NftFloorPrice, String> {
        let nft_url = self.nft_base_url();
        let response = with_429_retry(|| {
            self.client
                .get(format!("{}/getFloorPrice", nft_url))
                .query(&[("contractAddress", contract_address)])
                .send()
        }).await?;

        #[derive(serde::Deserialize)]
        struct FloorResponse {
            #[serde(rename = "openSea")]
            open_sea: Option<MarketplaceFloor>,
            #[serde(rename = "looksRare")]
            looks_rare: Option<MarketplaceFloor>,
        }

        #[derive(serde::Deserialize)]
        #[serde(rename_all = "camelCase")]
        struct MarketplaceFloor {
            floor_price: Option<f64>,
            retrieved_at_timestamp: Option<String>,
        }

        let data: FloorResponse = response.json().await.map_err(|e| e.to_string())?;

        let floor = data.open_sea.as_ref()
            .and_then(|os| os.floor_price)
            .or_else(|| data.looks_rare.as_ref().and_then(|lr| lr.floor_price));

        Ok(NftFloorPrice {
            contract_address: contract_address.to_string(),
            floor_price: floor,
            price_currency: Some("ETH".to_string()),
            marketplace: Some("openSea".to_string()),
            retrieved_at: data.open_sea.as_ref().and_then(|os| os.retrieved_at_timestamp.clone()),
        })
    }

    /// **Removed** — ETH price now comes exclusively from `crate::data::alchemy::prices`
    /// (Alchemy Prices API). CoinGecko has been retired as a wallet-data source.
    /// This stub remains so callers that still hold an `AlchemyClient` get a clear
    /// compile-time pointer to the new layer; remove once all callers migrate.
    #[deprecated(note = "Use crate::data::PriceProvider::get_eth_price_usd via crate::data::default_provider")]
    #[allow(dead_code)]
    pub async fn get_eth_price_usd(&self) -> Result<f64, String> {
        Err("get_eth_price_usd moved to crate::data::alchemy::prices — use the data layer".to_string())
    }
}

/// Send a request up to 3 times, backing off (200ms, 600ms) whenever Alchemy answers
/// with HTTP 429. `get_portfolio_snapshot` joins `get_eth_balance` + `get_token_balances`
/// + `get_nfts_for_owner` with `tokio::try_join!`, so a single 429 on any one of them
/// (easy to trip when adding a wallet fires a burst of concurrent per-wallet requests)
/// used to fail that wallet's entire snapshot for the whole fetch cycle with no retry.
async fn with_429_retry<F, Fut>(mut build_and_send: F) -> Result<reqwest::Response, String>
where
    F: FnMut() -> Fut,
    Fut: std::future::Future<Output = Result<reqwest::Response, reqwest::Error>>,
{
    const BACKOFFS_MS: [u64; 2] = [200, 600];
    let mut attempt = 0;
    loop {
        let resp = build_and_send().await.map_err(|e| e.to_string())?;
        if resp.status().as_u16() != 429 {
            return Ok(resp);
        }
        if attempt >= BACKOFFS_MS.len() {
            return Err("rate limited (429) after retries".to_string());
        }
        tokio::time::sleep(Duration::from_millis(BACKOFFS_MS[attempt])).await;
        attempt += 1;
    }
}
