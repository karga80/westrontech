/// Marketplace HTTP client — OpenSea Seaport v2 API + Blur stub.
///
/// Phase 3: real EIP-712 order signing and OpenSea API submission.
/// Blur support is stubbed — different protocol, planned for v2.
use super::seaport::{self, ListingParams, OfferParams};
use super::types::{BidInput, CancelInput, CollectionEvent, CollectionHolder, CollectionInfo, CollectionOffer, CollectionStats, CollectionTrait, ListingInput, Marketplace, NftAsset, NftPage, NftTrait, OrderResult, OrderStatus, TraitValue};
use crate::wallet::keychain::fetch_key;

const OPENSEA_API_BASE: &str = "https://api.opensea.io/api/v2";
/// Alchemy mainnet RPC base (append api key)
const ALCHEMY_RPC_BASE: &str = "https://eth-mainnet.g.alchemy.com/v2/";

pub struct MarketplaceClient {
    /// Alchemy API key — used for eth_call (counter fetch)
    alchemy_key: String,
    /// OpenSea API key — used for order submission
    opensea_key: String,
    http: reqwest::Client,
}

impl MarketplaceClient {
    pub fn new(alchemy_key: &str, opensea_key: &str) -> Self {
        MarketplaceClient {
            alchemy_key: alchemy_key.to_string(),
            opensea_key: opensea_key.to_string(),
            http: reqwest::Client::new(),
        }
    }

    // ── Public commands ───────────────────────────────────────────────────────

    /// Create a fixed-price ETH listing for an ERC-721 NFT on OpenSea.
    pub async fn list_nft(&self, input: &ListingInput) -> Result<OrderResult, String> {
        if input.price_eth <= 0.0 {
            return Err("listing price must be greater than 0".to_string());
        }
        if input.expiry_hours == 0 || input.expiry_hours > 720 {
            return Err("expiry_hours must be between 1 and 720".to_string());
        }

        match input.marketplace {
            Marketplace::Blur => {
                return Err("Blur listing not yet supported — use OpenSea for Phase 3".to_string())
            }
            Marketplace::Opensea => {}
        }

        let private_key = fetch_key(&input.wallet_address)
            .map_err(|e| format!("wallet key unavailable: {}", e))?;

        let counter = self
            .get_seaport_counter(&input.wallet_address)
            .await
            .unwrap_or(0); // safe default for wallets that have never cancelled

        let params = ListingParams {
            offerer: &input.wallet_address,
            contract_address: &input.contract_address,
            token_id: &input.token_id,
            price_eth: input.price_eth,
            expiry_hours: input.expiry_hours,
            counter,
        };
        let signed_order = seaport::build_listing_order(&params, &private_key)?;

        // POST to OpenSea
        let url = format!("{}/orders/ethereum/seaport/listings", OPENSEA_API_BASE);
        let resp = self
            .http
            .post(&url)
            .header("x-api-key", &self.opensea_key)
            .header("content-type", "application/json")
            .json(&signed_order)
            .send()
            .await
            .map_err(|e| format!("OpenSea request failed: {}", e))?;

        let status = resp.status();
        let body: serde_json::Value = resp
            .json()
            .await
            .unwrap_or_else(|_| serde_json::json!({}));

        if !status.is_success() {
            let msg = body
                .get("errors")
                .and_then(|e| e.as_array())
                .and_then(|a| a.first())
                .and_then(|v| v.as_str())
                .unwrap_or("unknown error");
            return Ok(OrderResult {
                order_hash: String::new(),
                action: "list".to_string(),
                marketplace: "opensea".to_string(),
                status: OrderStatus::Failed,
                tx_hash: None,
                error: Some(format!("OpenSea {} — {}", status.as_u16(), msg)),
            });
        }

        let order_hash = body
            .get("order")
            .and_then(|o| o.get("order_hash"))
            .and_then(|h| h.as_str())
            .unwrap_or("")
            .to_string();

        Ok(OrderResult {
            order_hash,
            action: "list".to_string(),
            marketplace: "opensea".to_string(),
            status: OrderStatus::Submitted,
            tx_hash: None,
            error: None,
        })
    }

    /// Place a WETH collection-level offer (bid) on OpenSea.
    pub async fn place_bid(&self, input: &BidInput) -> Result<OrderResult, String> {
        if input.price_eth <= 0.0 {
            return Err("bid price must be greater than 0".to_string());
        }
        if input.quantity == 0 {
            return Err("quantity must be at least 1".to_string());
        }
        if input.expiry_hours == 0 || input.expiry_hours > 720 {
            return Err("expiry_hours must be between 1 and 720".to_string());
        }
        if input.marketplace == Marketplace::Blur {
            return Err("Blur bidding not yet supported — use OpenSea for Phase 3".to_string());
        }

        let private_key = fetch_key(&input.wallet_address)
            .map_err(|e| format!("wallet key unavailable: {}", e))?;

        let counter = self
            .get_seaport_counter(&input.wallet_address)
            .await
            .unwrap_or(0);

        let params = OfferParams {
            offerer: &input.wallet_address,
            contract_address: &input.contract_address,
            price_eth: input.price_eth,
            quantity: input.quantity,
            expiry_hours: input.expiry_hours,
            counter,
        };
        let signed_order = seaport::build_offer_order(&params, &private_key)?;

        let url = format!("{}/orders/ethereum/seaport/offers", OPENSEA_API_BASE);
        let resp = self
            .http
            .post(&url)
            .header("x-api-key", &self.opensea_key)
            .header("content-type", "application/json")
            .json(&signed_order)
            .send()
            .await
            .map_err(|e| format!("OpenSea request failed: {}", e))?;

        let status = resp.status();
        let body: serde_json::Value = resp
            .json()
            .await
            .unwrap_or_else(|_| serde_json::json!({}));

        if !status.is_success() {
            let msg = body
                .get("errors")
                .and_then(|e| e.as_array())
                .and_then(|a| a.first())
                .and_then(|v| v.as_str())
                .unwrap_or("unknown error");
            return Ok(OrderResult {
                order_hash: String::new(),
                action: "bid".to_string(),
                marketplace: "opensea".to_string(),
                status: OrderStatus::Failed,
                tx_hash: None,
                error: Some(format!("OpenSea {} — {}", status.as_u16(), msg)),
            });
        }

        let order_hash = body
            .get("order")
            .and_then(|o| o.get("order_hash"))
            .and_then(|h| h.as_str())
            .unwrap_or("")
            .to_string();

        Ok(OrderResult {
            order_hash,
            action: "bid".to_string(),
            marketplace: "opensea".to_string(),
            status: OrderStatus::Submitted,
            tx_hash: None,
            error: None,
        })
    }

    /// Cancel an order off-chain via OpenSea API.
    /// For on-chain cancellation (incrementNonce), use the envelope engine + direct RPC.
    pub async fn cancel_order(&self, input: &CancelInput) -> Result<OrderResult, String> {
        if input.order_hash.is_empty() {
            return Err("order_hash must not be empty".to_string());
        }
        if input.marketplace == Marketplace::Blur {
            return Err("Blur cancellation not yet supported".to_string());
        }

        // OpenSea off-chain cancel: DELETE /v2/orders/{chain}/{protocol}/{order_hash}
        // Requires the order creator's signature over the cancellation message.
        let private_key = fetch_key(&input.wallet_address)
            .map_err(|e| format!("wallet key unavailable: {}", e))?;

        // Build a minimal cancellation signature: sign the order hash directly
        use alloy::primitives::B256;
        use alloy::signers::{local::PrivateKeySigner, SignerSync};
        let key_bytes = hex::decode(&private_key)
            .map_err(|e| format!("invalid key hex: {}", e))?;
        let signer = PrivateKeySigner::from_slice(&key_bytes)
            .map_err(|e| format!("invalid key: {}", e))?;
        let hash_bytes = hex::decode(
            input.order_hash.strip_prefix("0x").unwrap_or(&input.order_hash),
        )
        .map_err(|e| format!("invalid order hash: {}", e))?;
        let mut hash_arr = [0u8; 32];
        let copy = hash_bytes.len().min(32);
        hash_arr[32 - copy..].copy_from_slice(&hash_bytes[..copy]);
        let hash = B256::from(hash_arr);
        let sig = signer
            .sign_hash_sync(&hash)
            .map_err(|e| format!("sign failed: {}", e))?;
        let mut sig_bytes = sig.as_bytes();
        if sig_bytes[64] < 27 { sig_bytes[64] += 27; }
        let signature_hex = format!("0x{}", hex::encode(sig_bytes));

        let url = format!(
            "{}/orders/chain/ethereum/protocol/{}/{}",
            OPENSEA_API_BASE,
            seaport::SEAPORT_1_6,
            input.order_hash
        );
        let resp = self
            .http
            .delete(&url)
            .header("x-api-key", &self.opensea_key)
            .header("content-type", "application/json")
            .json(&serde_json::json!({ "signature": signature_hex }))
            .send()
            .await
            .map_err(|e| format!("OpenSea cancel request failed: {}", e))?;

        let status = resp.status();
        if !status.is_success() {
            let body: serde_json::Value = resp
                .json()
                .await
                .unwrap_or_else(|_| serde_json::json!({}));
            let msg = body
                .get("errors")
                .and_then(|e| e.as_array())
                .and_then(|a| a.first())
                .and_then(|v| v.as_str())
                .unwrap_or("unknown error");
            return Ok(OrderResult {
                order_hash: input.order_hash.clone(),
                action: "cancel".to_string(),
                marketplace: "opensea".to_string(),
                status: OrderStatus::Failed,
                tx_hash: None,
                error: Some(format!("OpenSea {} — {}", status.as_u16(), msg)),
            });
        }

        Ok(OrderResult {
            order_hash: input.order_hash.clone(),
            action: "cancel".to_string(),
            marketplace: "opensea".to_string(),
            status: OrderStatus::Submitted,
            tx_hash: None,
            error: None,
        })
    }

    /// Fetch listed NFTs from a collection sorted by price ascending.
    /// Uses GET /api/v2/listings/collection/{slug}/best — matches OpenSea Items tab default view.
    pub async fn fetch_collection_nfts(&self, collection_slug: &str, limit: u32) -> Result<Vec<NftAsset>, String> {
        let url = format!(
            "{}/listings/collection/{}/best?limit={}",
            OPENSEA_API_BASE, collection_slug, limit.min(100)
        );
        let resp = self
            .http
            .get(&url)
            .header("x-api-key", &self.opensea_key)
            .header("accept", "application/json")
            .send()
            .await
            .map_err(|e| format!("OpenSea request failed: {}", e))?;

        let status = resp.status();
        let body: serde_json::Value = resp
            .json()
            .await
            .unwrap_or_else(|_| serde_json::json!({}));

        if !status.is_success() {
            let msg = body
                .get("errors")
                .and_then(|e| e.as_array())
                .and_then(|a| a.first())
                .and_then(|v| v.as_str())
                .unwrap_or("unknown error");
            return Err(format!("OpenSea {} — {}", status.as_u16(), msg));
        }

        let ipfs_to_https = |u: &str| -> String {
            if u.starts_with("ipfs://") { format!("https://ipfs.io/ipfs/{}", &u[7..]) } else { u.to_string() }
        };

        // Response: { "listings": [ { "order_hash", "price": { "current": { "value", "decimals" } }, "nft": { ... } } ] }
        let nfts = body
            .get("listings")
            .and_then(|l| l.as_array())
            .map(|arr| {
                arr.iter().filter_map(|listing| {
                    let nft = listing.get("nft")?;

                    // Price: value / 10^decimals
                    let price_eth = listing
                        .get("price")
                        .and_then(|p| p.get("current"))
                        .and_then(|c| {
                            let value = c.get("value").and_then(|v| v.as_str())
                                .and_then(|s| s.parse::<f64>().ok())?;
                            let decimals = c.get("decimals").and_then(|d| d.as_u64()).unwrap_or(18);
                            Some(value / 10f64.powi(decimals as i32))
                        });

                    let order_hash = listing.get("order_hash").and_then(|v| v.as_str()).map(|s| s.to_string());

                    let raw_img = {
                        let disp = nft.get("display_image_url").and_then(|v| v.as_str()).filter(|s| !s.is_empty());
                        let img  = nft.get("image_url").and_then(|v| v.as_str()).filter(|s| !s.is_empty());
                        disp.or(img).map(|s| ipfs_to_https(s))
                    };

                    Some(NftAsset {
                        identifier: nft.get("identifier").and_then(|v| v.as_str()).unwrap_or("").to_string(),
                        name: nft.get("name").and_then(|v| v.as_str()).map(|s| s.to_string()),
                        image_url: nft.get("image_url").and_then(|v| v.as_str()).filter(|s| !s.is_empty()).map(|s| ipfs_to_https(s)),
                        display_image_url: raw_img,
                        opensea_url: nft.get("opensea_url").and_then(|v| v.as_str()).map(|s| s.to_string()),
                        price_eth,
                        last_sale_eth: None,
                        order_hash,
                        rarity_rank: None,
                        traits: vec![],
                    })
                }).collect()
            })
            .unwrap_or_default();

        Ok(nfts)
    }

    /// Fetch NFTs with status filter, sort, and cursor pagination.
    /// status: "all" | "listed" | "unlisted" | "owned"
    /// sort:   "Price ↑" | "Price ↓" | "Rank ↑"
    pub async fn fetch_nfts_by_collection(
        &self,
        slug: &str,
        status: &str,
        wallet_address: Option<&str>,
        cursor: Option<&str>,
        sort: &str,
        limit: u32,
    ) -> Result<NftPage, String> {
        let lim = limit.min(100);
        let ipfs_to_https = |u: &str| -> String {
            if u.starts_with("ipfs://") { format!("https://ipfs.io/ipfs/{}", &u[7..]) } else { u.to_string() }
        };

        match status {
            "listed" => {
                let (order_by, order_dir) = match sort {
                    "Price high to low" => ("eth_price", "desc"),
                    "Recently listed"   => ("created_date", "desc"),
                    _                   => ("eth_price", "asc"),
                };
                let mut url = format!(
                    "{}/listings/collection/{}/best?limit={}&order_by={}&order_direction={}",
                    OPENSEA_API_BASE, slug, lim, order_by, order_dir
                );
                if let Some(c) = cursor { url.push_str(&format!("&next={}", urlencoding(c))); }

                let body = self.get_json(&url).await?;
                let next = body.get("next").and_then(|v| v.as_str()).filter(|s| !s.is_empty()).map(|s| s.to_string());
                let items = body.get("listings").and_then(|l| l.as_array()).map(|arr| {
                    arr.iter().filter_map(|listing| {
                        let nft = listing.get("nft")?;
                        let price_eth = listing.get("price").and_then(|p| p.get("current")).and_then(|c| {
                            let v = c.get("value").and_then(|v| v.as_str()).and_then(|s| s.parse::<f64>().ok())?;
                            let d = c.get("decimals").and_then(|d| d.as_u64()).unwrap_or(18);
                            Some(v / 10f64.powi(d as i32))
                        });
                        let order_hash = listing.get("order_hash").and_then(|v| v.as_str()).map(|s| s.to_string());
                        let raw_img = nft.get("display_image_url").and_then(|v| v.as_str()).filter(|s| !s.is_empty())
                            .or_else(|| nft.get("image_url").and_then(|v| v.as_str()).filter(|s| !s.is_empty()))
                            .map(|s| ipfs_to_https(s));
                        Some(NftAsset {
                            identifier: nft.get("identifier").and_then(|v| v.as_str()).unwrap_or("").to_string(),
                            name: nft.get("name").and_then(|v| v.as_str()).map(|s| s.to_string()),
                            image_url: nft.get("image_url").and_then(|v| v.as_str()).filter(|s| !s.is_empty()).map(|s| ipfs_to_https(s)),
                            display_image_url: raw_img,
                            opensea_url: nft.get("opensea_url").and_then(|v| v.as_str()).map(|s| s.to_string()),
                            price_eth,
                            last_sale_eth: None,
                            order_hash,
                            rarity_rank: nft.get("rarity").and_then(|r| r.get("rank")).and_then(|r| r.as_u64()),
                            traits: traits_from_nft(nft),
                        })
                    }).collect()
                }).unwrap_or_default();
                Ok(NftPage { items, next })
            }

            "owned" => {
                let wallet = wallet_address.ok_or_else(|| "wallet_address required for 'owned' filter".to_string())?;
                let mut url = format!(
                    "{}/chain/ethereum/account/{}/nfts?collection={}&limit={}",
                    OPENSEA_API_BASE, wallet, slug, lim
                );
                if let Some(c) = cursor { url.push_str(&format!("&next={}", urlencoding(c))); }

                let body = self.get_json(&url).await?;
                let next = body.get("next").and_then(|v| v.as_str()).filter(|s| !s.is_empty()).map(|s| s.to_string());
                let items = nfts_from_array(body.get("nfts").and_then(|v| v.as_array()), &ipfs_to_https);
                Ok(NftPage { items, next })
            }

            _ => {
                // "all" or "unlisted" — fetch from /collection/{slug}/nfts
                let mut url = format!("{}/collection/{}/nfts?limit={}", OPENSEA_API_BASE, slug, lim);
                if let Some(c) = cursor { url.push_str(&format!("&next={}", urlencoding(c))); }

                let body = self.get_json(&url).await?;
                let next = body.get("next").and_then(|v| v.as_str()).filter(|s| !s.is_empty()).map(|s| s.to_string());
                let mut items: Vec<NftAsset> = nfts_from_array(body.get("nfts").and_then(|v| v.as_array()), &ipfs_to_https);

                match sort {
                    "Most rare"          => items.sort_by_key(|a| a.rarity_rank.unwrap_or(u64::MAX)),
                    "Least rare"         => items.sort_by(|a, b| b.rarity_rank.unwrap_or(0).cmp(&a.rarity_rank.unwrap_or(0))),
                    "Price low to high"  => items.sort_by(|a, b| a.price_eth.unwrap_or(f64::MAX).partial_cmp(&b.price_eth.unwrap_or(f64::MAX)).unwrap_or(std::cmp::Ordering::Equal)),
                    "Price high to low"  => items.sort_by(|a, b| b.price_eth.unwrap_or(0.0).partial_cmp(&a.price_eth.unwrap_or(0.0)).unwrap_or(std::cmp::Ordering::Equal)),
                    "Highest last sale"  => items.sort_by(|a, b| b.last_sale_eth.unwrap_or(0.0).partial_cmp(&a.last_sale_eth.unwrap_or(0.0)).unwrap_or(std::cmp::Ordering::Equal)),
                    "Lowest last sale"   => items.sort_by(|a, b| a.last_sale_eth.unwrap_or(f64::MAX).partial_cmp(&b.last_sale_eth.unwrap_or(f64::MAX)).unwrap_or(std::cmp::Ordering::Equal)),
                    _ => {}
                }
                Ok(NftPage { items, next })
            }
        }
    }

    /// Resolve a contract address → OpenSea collection slug, then fetch full stats.
    pub async fn fetch_collection_by_contract(&self, contract_address: &str) -> Result<CollectionInfo, String> {
        // Step 1: contract address → slug
        let addr = contract_address.trim().to_lowercase();
        let contract_url = format!("{}/chain/ethereum/contract/{}", OPENSEA_API_BASE, addr);
        let resp = self.http
            .get(&contract_url)
            .header("x-api-key", &self.opensea_key)
            .header("accept", "application/json")
            .send()
            .await
            .map_err(|e| format!("OpenSea request failed: {}", e))?;

        if !resp.status().is_success() {
            let code = resp.status().as_u16();
            let body: serde_json::Value = resp.json().await.unwrap_or_default();
            let msg = body.get("errors")
                .and_then(|e| e.as_array()).and_then(|a| a.first()).and_then(|v| v.as_str())
                .unwrap_or("unknown error");
            return Err(format!("OpenSea {} — {}", code, msg));
        }

        let contract_body: serde_json::Value = resp.json().await
            .map_err(|e| format!("parse error: {}", e))?;

        let slug = contract_body.get("collection")
            .and_then(|v| v.as_str())
            .ok_or_else(|| "No collection slug in response".to_string())?
            .to_string();

        // Step 2: slug → full collection stats
        let col_url = format!("{}/collections/{}", OPENSEA_API_BASE, slug);
        let resp2 = self.http
            .get(&col_url)
            .header("x-api-key", &self.opensea_key)
            .header("accept", "application/json")
            .send()
            .await
            .map_err(|e| format!("OpenSea request failed: {}", e))?;

        if !resp2.status().is_success() {
            let code = resp2.status().as_u16();
            let body: serde_json::Value = resp2.json().await.unwrap_or_default();
            let msg = body.get("errors")
                .and_then(|e| e.as_array()).and_then(|a| a.first()).and_then(|v| v.as_str())
                .unwrap_or("unknown error");
            return Err(format!("OpenSea {} — {}", code, msg));
        }

        let col: serde_json::Value = resp2.json().await
            .map_err(|e| format!("parse error: {}", e))?;

        let get_f64 = |path: &[&str]| -> Option<f64> {
            let mut v = &col;
            for key in path { v = v.get(key)?; }
            v.as_f64()
        };
        let get_u64 = |path: &[&str]| -> Option<u64> {
            let mut v = &col;
            for key in path { v = v.get(key)?; }
            v.as_u64()
        };
        let get_str = |path: &[&str]| -> Option<String> {
            let mut v = &col;
            for key in path { v = v.get(key)?; }
            v.as_str().map(|s| s.to_string())
        };

        // Step 3: fetch stats from the dedicated stats endpoint
        let stats_url = format!("{}/collections/{}/stats", OPENSEA_API_BASE, slug);
        let stats_resp = self.http
            .get(&stats_url)
            .header("x-api-key", &self.opensea_key)
            .header("accept", "application/json")
            .send()
            .await
            .ok();

        let (floor_price_eth, vol_24h_eth, vol_7d_eth, sales_7d, num_owners) =
            if let Some(r) = stats_resp.filter(|r| r.status().is_success()) {
                let s: serde_json::Value = r.json().await.unwrap_or_default();
                let floor = s.get("total").and_then(|t| t.get("floor_price")).and_then(|v| v.as_f64());
                let owners = s.get("total").and_then(|t| t.get("num_owners")).and_then(|v| v.as_u64());
                let vol24 = s.get("intervals").and_then(|i| i.as_array()).and_then(|arr| {
                    arr.iter().find(|x| x.get("interval").and_then(|v| v.as_str()) == Some("one_day"))
                }).and_then(|d| d.get("volume")).and_then(|v| v.as_f64());
                let vol7 = s.get("intervals").and_then(|i| i.as_array()).and_then(|arr| {
                    arr.iter().find(|x| x.get("interval").and_then(|v| v.as_str()) == Some("seven_day"))
                }).and_then(|d| d.get("volume")).and_then(|v| v.as_f64());
                let sales7 = s.get("intervals").and_then(|i| i.as_array()).and_then(|arr| {
                    arr.iter().find(|x| x.get("interval").and_then(|v| v.as_str()) == Some("seven_day"))
                }).and_then(|d| d.get("sales")).and_then(|v| v.as_u64());
                (floor, vol24, vol7, sales7, owners)
            } else {
                (None, None, None, None, None)
            };

        Ok(CollectionInfo {
            slug: slug.clone(),
            name: get_str(&["name"]).unwrap_or_else(|| slug.clone()),
            contract_address: addr,
            symbol: None,
            total_supply: get_u64(&["total_supply"]),
            floor_price_eth,
            vol_24h_eth,
            vol_7d_eth,
            sales_7d,
            num_owners,
            image_url: get_str(&["image_url"]),
            description: get_str(&["description"]),
        })
    }

    /// Fetch collection stats from OpenSea /api/v2/collections/{slug}/stats
    pub async fn fetch_collection_stats(&self, slug: &str) -> Result<CollectionStats, String> {
        let url = format!("{}/collections/{}/stats", OPENSEA_API_BASE, slug);
        let resp = self.http
            .get(&url)
            .header("x-api-key", &self.opensea_key)
            .header("accept", "application/json")
            .send()
            .await
            .map_err(|e| format!("OpenSea request failed: {}", e))?;

        if !resp.status().is_success() {
            let code = resp.status().as_u16();
            let body: serde_json::Value = resp.json().await.unwrap_or_default();
            let msg = body.get("errors").and_then(|e| e.as_array())
                .and_then(|a| a.first()).and_then(|v| v.as_str()).unwrap_or("unknown");
            return Err(format!("OpenSea {} — {}", code, msg));
        }

        let s: serde_json::Value = resp.json().await.map_err(|e| e.to_string())?;

        let find_interval = |interval_name: &str| -> Option<&serde_json::Value> {
            s.get("intervals")?.as_array()?.iter()
                .find(|x| x.get("interval").and_then(|v| v.as_str()) == Some(interval_name))
        };

        let total = s.get("total");
        let day1 = find_interval("one_day");
        let day7 = find_interval("seven_day");
        let day30 = find_interval("thirty_day");

        Ok(CollectionStats {
            floor_price_eth: total.and_then(|t| t.get("floor_price")).and_then(|v| v.as_f64()),
            num_owners: total.and_then(|t| t.get("num_owners")).and_then(|v| v.as_u64()),
            total_supply: total.and_then(|t| t.get("total_supply")).and_then(|v| v.as_u64()),
            market_cap_eth: total.and_then(|t| t.get("market_cap")).and_then(|v| v.as_f64()),
            total_volume_eth: total.and_then(|t| t.get("volume")).and_then(|v| v.as_f64()),
            vol_1d_eth: day1.and_then(|d| d.get("volume")).and_then(|v| v.as_f64()),
            vol_1d_change: day1.and_then(|d| d.get("volume_change")).and_then(|v| v.as_f64()),
            sales_1d: day1.and_then(|d| d.get("sales")).and_then(|v| v.as_u64()),
            avg_price_1d_eth: day1.and_then(|d| d.get("average_price")).and_then(|v| v.as_f64()),
            vol_7d_eth: day7.and_then(|d| d.get("volume")).and_then(|v| v.as_f64()),
            vol_7d_change: day7.and_then(|d| d.get("volume_change")).and_then(|v| v.as_f64()),
            sales_7d: day7.and_then(|d| d.get("sales")).and_then(|v| v.as_u64()),
            vol_30d_eth: day30.and_then(|d| d.get("volume")).and_then(|v| v.as_f64()),
            vol_30d_change: day30.and_then(|d| d.get("volume_change")).and_then(|v| v.as_f64()),
            sales_30d: day30.and_then(|d| d.get("sales")).and_then(|v| v.as_u64()),
        })
    }

    /// Fetch collection activity events from OpenSea /api/v2/events/collection/{slug}
    /// event_type: "sale" | "listing" | "offer" | "transfer" | "cancel" | "" (all)
    pub async fn fetch_collection_events(&self, slug: &str, event_type: &str, limit: u32) -> Result<Vec<CollectionEvent>, String> {
        let mut url = format!("{}/events/collection/{}?limit={}", OPENSEA_API_BASE, slug, limit.min(50));
        if !event_type.is_empty() {
            url.push_str(&format!("&event_type={}", event_type));
        }

        let resp = self.http
            .get(&url)
            .header("x-api-key", &self.opensea_key)
            .header("accept", "application/json")
            .send()
            .await
            .map_err(|e| format!("OpenSea request failed: {}", e))?;

        if !resp.status().is_success() {
            let code = resp.status().as_u16();
            let body: serde_json::Value = resp.json().await.unwrap_or_default();
            let msg = body.get("errors").and_then(|e| e.as_array())
                .and_then(|a| a.first()).and_then(|v| v.as_str()).unwrap_or("unknown");
            return Err(format!("OpenSea {} — {}", code, msg));
        }

        let body: serde_json::Value = resp.json().await.map_err(|e| e.to_string())?;
        let events = body.get("asset_events").and_then(|e| e.as_array())
            .map(|arr| arr.iter().map(|ev| {
                let nft = ev.get("nft");
                let payment = ev.get("payment");
                let price_eth = payment.and_then(|p| p.get("quantity")).and_then(|q| q.as_str())
                    .and_then(|q| q.parse::<f64>().ok())
                    .map(|wei| wei / 1e18);
                // OpenSea v2 uses event_type="order" for listings, offers, collection offers,
                // and trait offers. The order_type field distinguishes them.
                let raw_type = ev.get("event_type").and_then(|v| v.as_str()).unwrap_or("").to_string();
                let normalized_type = if raw_type == "order" {
                    ev.get("order_type").and_then(|v| v.as_str())
                        .map(|s| s.to_string())
                        .unwrap_or(raw_type)
                } else {
                    raw_type
                };

                // For order events, maker is the FROM address (seller/offerer)
                let maker_addr = ev.get("maker").and_then(|m| m.get("address")).and_then(|v| v.as_str()).map(|s| s.to_string());

                // Image: try display_image_url → image_url, convert ipfs:// to https gateway
                let raw_img = nft.and_then(|n| {
                    // prefer non-null display_image_url, fall back to image_url
                    let disp = n.get("display_image_url").and_then(|v| v.as_str());
                    let img  = n.get("image_url").and_then(|v| v.as_str());
                    disp.filter(|s| !s.is_empty()).or(img.filter(|s| !s.is_empty()))
                }).map(|s| s.to_string());
                let nft_image_url = raw_img.map(|url| {
                    if url.starts_with("ipfs://") {
                        format!("https://ipfs.io/ipfs/{}", &url[7..])
                    } else {
                        url
                    }
                });

                // Timestamp: event_timestamp is the primary field in v2 events
                let timestamp = ev.get("event_timestamp")
                    .or_else(|| ev.get("closing_date"))
                    .or_else(|| ev.get("start_date"))
                    .and_then(|v| v.as_i64());

                CollectionEvent {
                    event_type: normalized_type,
                    token_id: nft.and_then(|n| n.get("identifier")).and_then(|v| v.as_str()).map(|s| s.to_string()),
                    nft_name: nft.and_then(|n| n.get("name")).and_then(|v| v.as_str()).map(|s| s.to_string()),
                    nft_image_url,
                    opensea_url: nft.and_then(|n| n.get("opensea_url")).and_then(|v| v.as_str()).map(|s| s.to_string()),
                    price_eth,
                    payment_symbol: payment.and_then(|p| p.get("symbol")).and_then(|v| v.as_str()).map(|s| s.to_string()),
                    seller: ev.get("seller").and_then(|s| s.get("address")).and_then(|v| v.as_str()).map(|s| s.to_string())
                        .or(maker_addr.clone()),
                    buyer: ev.get("buyer").and_then(|b| b.get("address")).and_then(|v| v.as_str()).map(|s| s.to_string()),
                    from_address: ev.get("from_address").and_then(|v| v.as_str()).map(|s| s.to_string())
                        .or(maker_addr),
                    to_address: ev.get("to_address").and_then(|v| v.as_str()).map(|s| s.to_string()),
                    timestamp,
                    transaction: ev.get("transaction").and_then(|v| v.as_str()).map(|s| s.to_string()),
                }
            }).collect())
            .unwrap_or_default();

        Ok(events)
    }

    /// Fetch top holders for a collection using Alchemy alchemy_getOwnersForContract
    pub async fn fetch_collection_holders(&self, contract_address: &str, alchemy_key: &str, limit: usize) -> Result<Vec<CollectionHolder>, String> {
        let rpc_url = format!("{}{}", ALCHEMY_RPC_BASE, alchemy_key);
        let payload = serde_json::json!({
            "jsonrpc": "2.0",
            "id": 1,
            "method": "alchemy_getOwnersForContract",
            "params": [{ "contractAddress": contract_address, "withTokenBalances": true }]
        });

        let resp: serde_json::Value = self.http
            .post(&rpc_url)
            .json(&payload)
            .send()
            .await
            .map_err(|e| format!("Alchemy request failed: {}", e))?
            .json()
            .await
            .map_err(|e| format!("Alchemy parse failed: {}", e))?;

        if let Some(err) = resp.get("error") {
            return Err(format!("Alchemy error: {}", err));
        }

        let owners = resp.get("result").and_then(|r| r.get("owners")).and_then(|o| o.as_array())
            .map(|arr| {
                let mut holders: Vec<CollectionHolder> = arr.iter()
                    .filter_map(|o| {
                        let addr = o.get("ownerAddress")?.as_str()?.to_string();
                        let count = o.get("tokenBalances")?.as_array()?.iter()
                            .filter_map(|tb| tb.get("balance")?.as_str()?.parse::<u64>().ok())
                            .sum();
                        Some(CollectionHolder { owner_address: addr, token_count: count })
                    })
                    .collect();
                holders.sort_by(|a, b| b.token_count.cmp(&a.token_count));
                holders.truncate(limit);
                holders
            })
            .unwrap_or_default();

        Ok(owners)
    }

    /// Fetch active collection offers from OpenSea /api/v2/orders/ethereum/seaport/offers
    /// Returns orders sorted by price descending (best offers first).
    /// Note: OpenSea only supports `order_by=eth_price` for single-token queries, so we
    /// fetch by created_date and sort client-side to keep "best offers first" semantics.
    pub async fn fetch_collection_offers(&self, slug: &str, limit: u32) -> Result<Vec<CollectionOffer>, String> {
        let url = format!(
            "{}/orders/ethereum/seaport/offers?collection_slug={}&order_by=created_date&order_direction=desc&limit={}",
            OPENSEA_API_BASE, slug, limit.min(50)
        );

        let resp = self.http
            .get(&url)
            .header("x-api-key", &self.opensea_key)
            .header("accept", "application/json")
            .send()
            .await
            .map_err(|e| format!("OpenSea request failed: {}", e))?;

        if !resp.status().is_success() {
            let code = resp.status().as_u16();
            let body: serde_json::Value = resp.json().await.unwrap_or_default();
            let msg = body.get("errors").and_then(|e| e.as_array())
                .and_then(|a| a.first()).and_then(|v| v.as_str()).unwrap_or("unknown");
            return Err(format!("OpenSea {} — {}", code, msg));
        }

        let body: serde_json::Value = resp.json().await.map_err(|e| e.to_string())?;
        let offers = body.get("orders").and_then(|o| o.as_array())
            .map(|arr| arr.iter().filter_map(|order| {
                let price_wei = order.get("current_price").and_then(|v| v.as_str())
                    .and_then(|s| s.parse::<f64>().ok())
                    .unwrap_or(0.0);
                let price_eth = price_wei / 1e18;
                if price_eth <= 0.0 { return None; }

                // Collection/item offers are always paid in WETH on OpenSea
                let payment_symbol = "WETH".to_string();

                let maker = order.get("maker");
                let maker_address = maker.and_then(|m| m.get("address")).and_then(|v| v.as_str())
                    .unwrap_or("").to_string();
                let maker_username = maker.and_then(|m| m.get("user")).and_then(|u| u.get("username")).and_then(|v| v.as_str()).map(|s| s.to_string());
                let maker_image_url = maker.and_then(|m| m.get("profile_img_url")).and_then(|v| v.as_str()).map(|s| s.to_string());

                let expiration = order.get("expiration_time").and_then(|v| v.as_i64());
                let order_hash = order.get("order_hash").and_then(|v| v.as_str()).unwrap_or("").to_string();
                let quantity = order.get("remaining_quantity").and_then(|v| v.as_u64()).unwrap_or(1);

                Some(CollectionOffer {
                    price_eth,
                    payment_symbol,
                    quantity,
                    maker_address,
                    maker_username,
                    maker_image_url,
                    expiration,
                    order_hash,
                })
            }).collect::<Vec<CollectionOffer>>())
            .unwrap_or_default();

        let mut offers = offers;
        offers.sort_by(|a, b| b.price_eth.partial_cmp(&a.price_eth).unwrap_or(std::cmp::Ordering::Equal));

        Ok(offers)
    }

    /// Fetch collection traits from OpenSea /api/v2/traits/{slug}
    pub async fn fetch_collection_traits(&self, slug: &str, total_supply: u64) -> Result<Vec<CollectionTrait>, String> {
        let url = format!("{}/traits/{}", OPENSEA_API_BASE, slug);
        let resp = self.http
            .get(&url)
            .header("x-api-key", &self.opensea_key)
            .header("accept", "application/json")
            .send()
            .await
            .map_err(|e| format!("OpenSea request failed: {}", e))?;

        if !resp.status().is_success() {
            let code = resp.status().as_u16();
            let body: serde_json::Value = resp.json().await.unwrap_or_default();
            let msg = body.get("errors").and_then(|e| e.as_array())
                .and_then(|a| a.first()).and_then(|v| v.as_str()).unwrap_or("unknown");
            return Err(format!("OpenSea {} — {}", code, msg));
        }

        let body: serde_json::Value = resp.json().await.map_err(|e| e.to_string())?;
        let supply = if total_supply > 0 { total_supply as f64 } else { 10000.0 };

        // API response structure:
        //   body.categories: { trait_name → "string" | "number" }
        //   body.counts:     { trait_name → { value → count } }  (string traits)
        //                OR  { trait_name → { "min": n, "max": n } } (numeric traits)
        let categories = body.get("categories").and_then(|c| c.as_object());
        let counts_map  = body.get("counts").and_then(|c| c.as_object());

        let traits = match (categories, counts_map) {
            (Some(cats), Some(cnts)) => {
                let mut result: Vec<CollectionTrait> = cats.iter()
                    .filter_map(|(cat_name, cat_type)| {
                        let is_numeric = cat_type.as_str() == Some("number");
                        let value_counts = cnts.get(cat_name)?.as_object()?;

                        if is_numeric {
                            // Represent numeric range as a single entry
                            let min = value_counts.get("min").and_then(|v| v.as_f64());
                            let max = value_counts.get("max").and_then(|v| v.as_f64());
                            let label = match (min, max) {
                                (Some(lo), Some(hi)) => format!("{} – {}", lo, hi),
                                (Some(lo), None) => format!("≥ {}", lo),
                                _ => return None,
                            };
                            return Some(CollectionTrait {
                                category: cat_name.clone(),
                                values: vec![TraitValue { value: label, count: 0, supply_percent: 0.0 }],
                            });
                        }

                        // String trait — iterate value → count pairs
                        // OpenSea may return counts as floats (e.g. 1374.0); handle both.
                        let mut vals: Vec<TraitValue> = value_counts.iter()
                            .filter_map(|(val, count)| {
                                let n = count.as_u64()
                                    .or_else(|| count.as_f64().map(|f| f as u64))
                                    .unwrap_or(0);
                                if n == 0 { return None; }
                                Some(TraitValue {
                                    value: val.clone(),
                                    count: n,
                                    supply_percent: (n as f64 / supply) * 100.0,
                                })
                            })
                            .collect();
                        if vals.is_empty() { return None; }
                        vals.sort_by(|a, b| b.count.cmp(&a.count));
                        Some(CollectionTrait { category: cat_name.clone(), values: vals })
                    })
                    .collect();
                result.sort_by(|a, b| a.category.cmp(&b.category));
                result
            }
            _ => vec![],
        };

        Ok(traits)
    }

    // ── Internal helpers ──────────────────────────────────────────────────────

    /// GET a URL with the OpenSea API key and return the parsed JSON body.
    /// Returns `Err` on network failure or non-2xx HTTP status.
    async fn get_json(&self, url: &str) -> Result<serde_json::Value, String> {
        let resp = self
            .http
            .get(url)
            .header("x-api-key", &self.opensea_key)
            .header("accept", "application/json")
            .send()
            .await
            .map_err(|e| format!("OpenSea request failed: {}", e))?;

        let status = resp.status();
        let body: serde_json::Value = resp
            .json()
            .await
            .unwrap_or_else(|_| serde_json::json!({}));

        if !status.is_success() {
            let msg = body
                .get("errors")
                .and_then(|e| e.as_array())
                .and_then(|a| a.first())
                .and_then(|v| v.as_str())
                .unwrap_or("unknown error");
            return Err(format!("OpenSea {} — {}", status.as_u16(), msg));
        }

        Ok(body)
    }

    /// Fetch the Seaport counter for an address via eth_call.
    /// This counter increments when the user calls `incrementCounter()` to mass-cancel.
    async fn get_seaport_counter(&self, wallet_address: &str) -> Result<u64, String> {
        use alloy::primitives::keccak256;

        // Function selector for getCounter(address)
        let selector = &keccak256("getCounter(address)".as_bytes())[..4];
        // ABI-encode the address argument (12 zero bytes + 20 address bytes)
        let addr_hex = wallet_address.strip_prefix("0x").unwrap_or(wallet_address);
        let addr_bytes = hex::decode(addr_hex).map_err(|e| e.to_string())?;
        if addr_bytes.len() != 20 {
            return Err("invalid wallet address length".to_string());
        }
        let mut calldata = Vec::with_capacity(4 + 32);
        calldata.extend_from_slice(selector);
        calldata.extend_from_slice(&[0u8; 12]);
        calldata.extend_from_slice(&addr_bytes);

        let rpc_url = format!("{}{}", ALCHEMY_RPC_BASE, self.alchemy_key);
        let payload = serde_json::json!({
            "jsonrpc": "2.0",
            "id": 1,
            "method": "eth_call",
            "params": [
                {
                    "to": seaport::SEAPORT_1_6,
                    "data": format!("0x{}", hex::encode(&calldata))
                },
                "latest"
            ]
        });

        let resp: serde_json::Value = self
            .http
            .post(&rpc_url)
            .json(&payload)
            .send()
            .await
            .map_err(|e| format!("RPC call failed: {}", e))?
            .json()
            .await
            .map_err(|e| format!("RPC parse failed: {}", e))?;

        let hex_result = resp
            .get("result")
            .and_then(|r| r.as_str())
            .unwrap_or("0x0");

        // Decode uint256 result → u64 (counter never realistically exceeds u64)
        let trimmed = hex_result.strip_prefix("0x").unwrap_or(hex_result);
        let counter = u64::from_str_radix(&trimmed[trimmed.len().saturating_sub(16)..], 16)
            .unwrap_or(0);
        Ok(counter)
    }
}

/// Extract traits from a single NFT JSON value.
fn traits_from_nft(nft: &serde_json::Value) -> Vec<NftTrait> {
    nft.get("traits")
        .and_then(|t| t.as_array())
        .map(|arr| {
            arr.iter()
                .filter_map(|t| {
                    let trait_type = t.get("trait_type").and_then(|v| v.as_str())?.to_string();
                    // value can be a string or a number
                    let value = t.get("value").and_then(|v| {
                        if let Some(s) = v.as_str() { Some(s.to_string()) }
                        else if let Some(n) = v.as_f64() { Some(n.to_string()) }
                        else { None }
                    })?;
                    Some(NftTrait { trait_type, value })
                })
                .collect()
        })
        .unwrap_or_default()
}

/// Map a `nfts` JSON array from /collection/{slug}/nfts or /account/{addr}/nfts
/// into a `Vec<NftAsset>`.
fn nfts_from_array(
    arr: Option<&Vec<serde_json::Value>>,
    ipfs_to_https: &impl Fn(&str) -> String,
) -> Vec<NftAsset> {
    arr.map(|items| {
        items
            .iter()
            .filter_map(|nft| {
                let identifier = nft.get("identifier").and_then(|v| v.as_str())?.to_string();
                let raw_img = nft
                    .get("display_image_url")
                    .and_then(|v| v.as_str())
                    .filter(|s| !s.is_empty())
                    .or_else(|| {
                        nft.get("image_url")
                            .and_then(|v| v.as_str())
                            .filter(|s| !s.is_empty())
                    })
                    .map(|s| ipfs_to_https(s));
                Some(NftAsset {
                    identifier,
                    name: nft.get("name").and_then(|v| v.as_str()).map(|s| s.to_string()),
                    image_url: nft
                        .get("image_url")
                        .and_then(|v| v.as_str())
                        .filter(|s| !s.is_empty())
                        .map(|s| ipfs_to_https(s)),
                    display_image_url: raw_img,
                    opensea_url: nft
                        .get("opensea_url")
                        .and_then(|v| v.as_str())
                        .map(|s| s.to_string()),
                    price_eth: None,
                    last_sale_eth: None,
                    order_hash: None,
                    rarity_rank: nft
                        .get("rarity")
                        .and_then(|r| r.get("rank"))
                        .and_then(|r| r.as_u64()),
                    traits: traits_from_nft(nft),
                })
            })
            .collect()
    })
    .unwrap_or_default()
}

/// Percent-encode a cursor string so it is safe as a URL query-string value.
fn urlencoding(s: &str) -> String {
    let mut out = String::with_capacity(s.len());
    for b in s.bytes() {
        match b {
            b'A'..=b'Z' | b'a'..=b'z' | b'0'..=b'9' | b'-' | b'_' | b'.' | b'~' => {
                out.push(b as char);
            }
            _ => out.push_str(&format!("%{:02X}", b)),
        }
    }
    out
}
