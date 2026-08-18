/// Seaport 1.6 EIP-712 order building and signing.
///
/// Implements the full Seaport typed-data hash computation as specified in
/// https://github.com/ProjectOpenSea/seaport/blob/main/docs/SeaportDocumentation.md
use alloy::primitives::{keccak256, U256};
use alloy::signers::{local::PrivateKeySigner, SignerSync};
use serde::{Deserialize, Serialize};
use std::time::{SystemTime, UNIX_EPOCH};

// ── Seaport 1.6 constants ─────────────────────────────────────────────────────

/// Seaport 1.6 contract on Ethereum mainnet
pub const SEAPORT_1_6: &str = "0x0000000000000068F116a894984e2DB1123eB395";
/// OpenSea conduit key (routes payments through OpenSea's conduit)
pub const OPENSEA_CONDUIT_KEY: &str =
    "0x0000007b02230091a7ed01230072f7006a004d60a8d4e71d599b8104250f0000";
/// OpenSea protocol fee recipient
pub const OPENSEA_FEE_RECIPIENT: &str = "0x0000a26b00c1F0DF003000390027140000fAa719";
/// OpenSea protocol fee in basis points (2.5%)
pub const OPENSEA_FEE_BPS: u128 = 250;

/// WETH on Ethereum mainnet
pub const WETH_ADDRESS: &str = "0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2";

// Item type constants (Seaport ItemType enum)
pub const ITEM_ETH: u8 = 0;
pub const ITEM_ERC20: u8 = 1;
pub const ITEM_ERC721: u8 = 2;
pub const ITEM_ERC721_CRITERIA: u8 = 4; // collection/trait bid

// Order type constants (Seaport OrderType enum)
pub const ORDER_FULL_OPEN: u8 = 0;

// ── EIP-712 type strings ──────────────────────────────────────────────────────

const DOMAIN_TYPE_STR: &str =
    "EIP712Domain(string name,string version,uint256 chainId,address verifyingContract)";

const OFFER_ITEM_TYPE_STR: &str =
    "OfferItem(uint8 itemType,address token,uint256 identifierOrCriteria,uint256 startAmount,uint256 endAmount)";

const CONSIDERATION_ITEM_TYPE_STR: &str =
    "ConsiderationItem(uint8 itemType,address token,uint256 identifierOrCriteria,uint256 startAmount,uint256 endAmount,address recipient)";

/// Full OrderComponents type string including referenced struct types (sorted per EIP-712 spec)
const ORDER_COMPONENTS_TYPE_STR: &str =
    "OrderComponents(address offerer,address zone,OfferItem[] offer,ConsiderationItem[] consideration,uint8 orderType,uint256 startTime,uint256 endTime,bytes32 zoneHash,uint256 salt,bytes32 conduitKey,uint256 counter)\
ConsiderationItem(uint8 itemType,address token,uint256 identifierOrCriteria,uint256 startAmount,uint256 endAmount,address recipient)\
OfferItem(uint8 itemType,address token,uint256 identifierOrCriteria,uint256 startAmount,uint256 endAmount)";

// ── JSON-serialisable order structs (used for OpenSea API payload) ────────────

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct OfferItemRaw {
    #[serde(rename = "itemType")]
    pub item_type: u8,
    pub token: String,
    #[serde(rename = "identifierOrCriteria")]
    pub identifier_or_criteria: String,
    #[serde(rename = "startAmount")]
    pub start_amount: String,
    #[serde(rename = "endAmount")]
    pub end_amount: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ConsiderationItemRaw {
    #[serde(rename = "itemType")]
    pub item_type: u8,
    pub token: String,
    #[serde(rename = "identifierOrCriteria")]
    pub identifier_or_criteria: String,
    #[serde(rename = "startAmount")]
    pub start_amount: String,
    #[serde(rename = "endAmount")]
    pub end_amount: String,
    pub recipient: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct OrderParametersRaw {
    pub offerer: String,
    pub zone: String,
    pub offer: Vec<OfferItemRaw>,
    pub consideration: Vec<ConsiderationItemRaw>,
    #[serde(rename = "orderType")]
    pub order_type: u8,
    #[serde(rename = "startTime")]
    pub start_time: String,
    #[serde(rename = "endTime")]
    pub end_time: String,
    #[serde(rename = "zoneHash")]
    pub zone_hash: String,
    pub salt: String,
    #[serde(rename = "conduitKey")]
    pub conduit_key: String,
    #[serde(rename = "totalOriginalConsiderationItems")]
    pub total_original_consideration_items: usize,
    pub counter: String,
}

/// A fully signed Seaport order ready to POST to OpenSea.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SignedOrder {
    pub parameters: OrderParametersRaw,
    pub signature: String,
}

// ── ABI encoding helpers ──────────────────────────────────────────────────────

/// Parse hex address string ("0x...") → padded 32-byte ABI word (left-zeroed).
fn addr_word(s: &str) -> Result<[u8; 32], String> {
    let hex = s.strip_prefix("0x").unwrap_or(s);
    let bytes = hex::decode(hex).map_err(|e| format!("bad address '{}': {}", s, e))?;
    if bytes.len() != 20 {
        return Err(format!("address must be 20 bytes, got {}", bytes.len()));
    }
    let mut word = [0u8; 32];
    word[12..].copy_from_slice(&bytes);
    Ok(word)
}

/// Parse decimal string → big-endian 32-byte ABI word.
fn u256_word(s: &str) -> [u8; 32] {
    let val: U256 = s.parse().unwrap_or(U256::ZERO);
    val.to_be_bytes::<32>()
}

/// Parse hex bytes32 string ("0x...") → 32-byte word.
fn b256_word(s: &str) -> [u8; 32] {
    let hex = s.strip_prefix("0x").unwrap_or(s);
    let bytes = hex::decode(hex).unwrap_or_default();
    let mut word = [0u8; 32];
    let copy_len = bytes.len().min(32);
    word[32 - copy_len..].copy_from_slice(&bytes[..copy_len]);
    word
}

/// Encode u8 as 32-byte ABI word (left-zeroed).
fn u8_word(v: u8) -> [u8; 32] {
    let mut word = [0u8; 32];
    word[31] = v;
    word
}

// ── EIP-712 struct hashing ────────────────────────────────────────────────────

fn hash_offer_item(item: &OfferItemRaw) -> Result<[u8; 32], String> {
    let type_hash = *keccak256(OFFER_ITEM_TYPE_STR.as_bytes());
    let token = addr_word(&item.token)?;
    let mut buf = Vec::with_capacity(5 * 32);
    buf.extend_from_slice(&type_hash);
    buf.extend_from_slice(&u8_word(item.item_type));
    buf.extend_from_slice(&token);
    buf.extend_from_slice(&u256_word(&item.identifier_or_criteria));
    buf.extend_from_slice(&u256_word(&item.start_amount));
    buf.extend_from_slice(&u256_word(&item.end_amount));
    Ok(*keccak256(&buf))
}

fn hash_consideration_item(item: &ConsiderationItemRaw) -> Result<[u8; 32], String> {
    let type_hash = *keccak256(CONSIDERATION_ITEM_TYPE_STR.as_bytes());
    let token = addr_word(&item.token)?;
    let recipient = addr_word(&item.recipient)?;
    let mut buf = Vec::with_capacity(6 * 32);
    buf.extend_from_slice(&type_hash);
    buf.extend_from_slice(&u8_word(item.item_type));
    buf.extend_from_slice(&token);
    buf.extend_from_slice(&u256_word(&item.identifier_or_criteria));
    buf.extend_from_slice(&u256_word(&item.start_amount));
    buf.extend_from_slice(&u256_word(&item.end_amount));
    buf.extend_from_slice(&recipient);
    Ok(*keccak256(&buf))
}

/// Hash an array of structs per EIP-712: keccak256(hash0 || hash1 || ...)
fn hash_item_array<T, F>(items: &[T], hash_fn: F) -> Result<[u8; 32], String>
where
    F: Fn(&T) -> Result<[u8; 32], String>,
{
    let mut packed = Vec::with_capacity(items.len() * 32);
    for item in items {
        packed.extend_from_slice(&hash_fn(item)?);
    }
    Ok(*keccak256(&packed))
}

fn hash_order_components(params: &OrderParametersRaw) -> Result<[u8; 32], String> {
    let type_hash = *keccak256(ORDER_COMPONENTS_TYPE_STR.as_bytes());
    let offerer = addr_word(&params.offerer)?;
    let zone = addr_word(&params.zone)?;
    let offer_hash = hash_item_array(&params.offer, hash_offer_item)?;
    let consideration_hash = hash_item_array(&params.consideration, hash_consideration_item)?;
    let zone_hash = b256_word(&params.zone_hash);
    let conduit_key = b256_word(&params.conduit_key);

    let mut buf = Vec::with_capacity(13 * 32);
    buf.extend_from_slice(&type_hash);
    buf.extend_from_slice(&offerer);
    buf.extend_from_slice(&zone);
    buf.extend_from_slice(&offer_hash);
    buf.extend_from_slice(&consideration_hash);
    buf.extend_from_slice(&u8_word(params.order_type));
    buf.extend_from_slice(&u256_word(&params.start_time));
    buf.extend_from_slice(&u256_word(&params.end_time));
    buf.extend_from_slice(&zone_hash);
    buf.extend_from_slice(&u256_word(&params.salt));
    buf.extend_from_slice(&conduit_key);
    buf.extend_from_slice(&u256_word(&params.counter));
    Ok(*keccak256(&buf))
}

/// Compute the final EIP-712 signing hash for a Seaport 1.6 order.
pub fn eip712_signing_hash(params: &OrderParametersRaw) -> Result<[u8; 32], String> {
    // Domain separator
    let domain_type_hash = *keccak256(DOMAIN_TYPE_STR.as_bytes());
    let name_hash = *keccak256("Seaport".as_bytes());
    let version_hash = *keccak256("1.6".as_bytes());
    let chain_id_word = u256_word("1"); // mainnet
    let contract_word = addr_word(SEAPORT_1_6)?;

    let mut domain_buf = Vec::with_capacity(5 * 32);
    domain_buf.extend_from_slice(&domain_type_hash);
    domain_buf.extend_from_slice(&name_hash);
    domain_buf.extend_from_slice(&version_hash);
    domain_buf.extend_from_slice(&chain_id_word);
    domain_buf.extend_from_slice(&contract_word);
    let domain_separator = *keccak256(&domain_buf);

    let struct_hash = hash_order_components(params)?;

    // EIP-712 prefix: 0x19 0x01 || domainSeparator || structHash
    let mut digest_input = Vec::with_capacity(66);
    digest_input.push(0x19);
    digest_input.push(0x01);
    digest_input.extend_from_slice(&domain_separator);
    digest_input.extend_from_slice(&struct_hash);
    Ok(*keccak256(&digest_input))
}

/// Sign a Seaport order with the wallet's private key.
/// Returns the 65-byte signature as a hex string ("0x...").
pub fn sign_order(params: &OrderParametersRaw, private_key_hex: &str) -> Result<String, String> {
    let key_bytes = hex::decode(private_key_hex)
        .map_err(|e| format!("invalid private key hex: {}", e))?;
    let signer = PrivateKeySigner::from_slice(&key_bytes)
        .map_err(|e| format!("invalid private key: {}", e))?;

    let hash_bytes = eip712_signing_hash(params)?;
    let hash = alloy::primitives::B256::from(hash_bytes);
    let signature = signer
        .sign_hash_sync(&hash)
        .map_err(|e| format!("signing failed: {}", e))?;

    // alloy returns v as 0 or 1; Ethereum legacy expects 27 or 28
    let mut sig_bytes = signature.as_bytes();
    if sig_bytes[64] < 27 {
        sig_bytes[64] += 27;
    }
    Ok(format!("0x{}", hex::encode(sig_bytes)))
}

// ── Order builders ────────────────────────────────────────────────────────────

pub struct ListingParams<'a> {
    pub offerer: &'a str,
    pub contract_address: &'a str,
    pub token_id: &'a str,
    pub price_eth: f64,
    pub expiry_hours: u64,
    pub counter: u64,
}

/// Build and sign a fixed-price ETH listing for an ERC-721 NFT.
pub fn build_listing_order(p: &ListingParams<'_>, private_key_hex: &str) -> Result<SignedOrder, String> {
    let now = unix_now()?;
    let end_time = now + p.expiry_hours * 3600;
    let price_wei = eth_to_wei(p.price_eth)?;
    let fee_wei = (price_wei * OPENSEA_FEE_BPS) / 10_000;
    let seller_wei = price_wei - fee_wei;
    let salt = random_salt();
    let zero_addr = "0x0000000000000000000000000000000000000000";

    let params = OrderParametersRaw {
        offerer: p.offerer.to_string(),
        zone: zero_addr.to_string(),
        offer: vec![OfferItemRaw {
            item_type: ITEM_ERC721,
            token: p.contract_address.to_string(),
            identifier_or_criteria: p.token_id.to_string(),
            start_amount: "1".to_string(),
            end_amount: "1".to_string(),
        }],
        consideration: vec![
            ConsiderationItemRaw {
                item_type: ITEM_ETH,
                token: zero_addr.to_string(),
                identifier_or_criteria: "0".to_string(),
                start_amount: seller_wei.to_string(),
                end_amount: seller_wei.to_string(),
                recipient: p.offerer.to_string(),
            },
            ConsiderationItemRaw {
                item_type: ITEM_ETH,
                token: zero_addr.to_string(),
                identifier_or_criteria: "0".to_string(),
                start_amount: fee_wei.to_string(),
                end_amount: fee_wei.to_string(),
                recipient: OPENSEA_FEE_RECIPIENT.to_string(),
            },
        ],
        order_type: ORDER_FULL_OPEN,
        start_time: now.to_string(),
        end_time: end_time.to_string(),
        zone_hash: "0x0000000000000000000000000000000000000000000000000000000000000000".to_string(),
        salt: salt.to_string(),
        conduit_key: OPENSEA_CONDUIT_KEY.to_string(),
        total_original_consideration_items: 2,
        counter: p.counter.to_string(),
    };

    let signature = sign_order(&params, private_key_hex)?;
    Ok(SignedOrder { parameters: params, signature })
}

pub struct OfferParams<'a> {
    pub offerer: &'a str,
    pub contract_address: &'a str, // collection contract
    pub price_eth: f64,            // per-item bid price
    pub quantity: u32,
    pub expiry_hours: u64,
    pub counter: u64,
}

/// Build and sign a WETH collection-level offer (bid).
pub fn build_offer_order(p: &OfferParams<'_>, private_key_hex: &str) -> Result<SignedOrder, String> {
    let now = unix_now()?;
    let end_time = now + p.expiry_hours * 3600;
    let per_item_wei = eth_to_wei(p.price_eth)?;
    let fee_wei = (per_item_wei * OPENSEA_FEE_BPS) / 10_000;
    // WETH offered = total item value (seller receives) + fee
    let weth_offer_wei = per_item_wei + fee_wei;
    let salt = random_salt();
    let zero_addr = "0x0000000000000000000000000000000000000000";

    let params = OrderParametersRaw {
        offerer: p.offerer.to_string(),
        zone: zero_addr.to_string(),
        offer: vec![OfferItemRaw {
            item_type: ITEM_ERC20,
            token: WETH_ADDRESS.to_string(),
            identifier_or_criteria: "0".to_string(),
            start_amount: weth_offer_wei.to_string(),
            end_amount: weth_offer_wei.to_string(),
        }],
        consideration: vec![
            ConsiderationItemRaw {
                // criteria-based NFT (collection bid: any token from the collection)
                item_type: ITEM_ERC721_CRITERIA,
                token: p.contract_address.to_string(),
                identifier_or_criteria: "0".to_string(), // criteria hash = 0 = any token
                start_amount: p.quantity.to_string(),
                end_amount: p.quantity.to_string(),
                recipient: p.offerer.to_string(),
            },
            ConsiderationItemRaw {
                item_type: ITEM_ERC20,
                token: WETH_ADDRESS.to_string(),
                identifier_or_criteria: "0".to_string(),
                start_amount: fee_wei.to_string(),
                end_amount: fee_wei.to_string(),
                recipient: OPENSEA_FEE_RECIPIENT.to_string(),
            },
        ],
        order_type: ORDER_FULL_OPEN,
        start_time: now.to_string(),
        end_time: end_time.to_string(),
        zone_hash: "0x0000000000000000000000000000000000000000000000000000000000000000".to_string(),
        salt: salt.to_string(),
        conduit_key: OPENSEA_CONDUIT_KEY.to_string(),
        total_original_consideration_items: 2,
        counter: p.counter.to_string(),
    };

    let signature = sign_order(&params, private_key_hex)?;
    Ok(SignedOrder { parameters: params, signature })
}

// ── Internal helpers ──────────────────────────────────────────────────────────

fn unix_now() -> Result<u64, String> {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_secs())
        .map_err(|e| e.to_string())
}

// `pub(crate)`: this is the one place ETH-as-f64 becomes wei-as-u128 for
// order construction. `marketplace/client.rs`'s new envelope/autonomy gates
// need the exact same conversion before a listing/bid price enters an
// `ActionProposal` — reusing this function instead of writing a second
// `eth * 1e18` keeps that arithmetic in exactly one place.
/// Convert an ETH amount to wei, rejecting non-finite, negative, or absurdly
/// large values.
///
/// Güvenlik denetimi #3 (2026-08-18): eski `(eth * 1e18) as u128` NaN'ı sessizce
/// 0'a çeviriyordu (`NaN as u128 == 0`) — yani 0-wei / bedava listeleme riski —
/// ve taşmada saturasyona gidiyordu. Artık non-finite / negatif / aralık-dışı
/// değerler hata döner ve çağıran (`build_*_order`, `Result` dönüyor) `?` ile
/// yayar.
///
/// NOT: f64 hâlâ ~0.009 ETH (2^53 wei) üstünde kesin DEĞİL. Tam kesinlik için
/// fiyatın komut sınırına decimal string / wei-string olarak gelip `U256`'ya
/// parse edilmesi gerekir — bu Kapı-3 takip işi. Bu fonksiyon yalnız
/// para-kaybettiren uç durumları (NaN→0, taşma) kapatır; dust seviyesi
/// yuvarlama hatası bilinçli olarak açık bırakılmıştır.
pub(crate) fn eth_to_wei(eth: f64) -> Result<u128, String> {
    if !eth.is_finite() || eth < 0.0 {
        return Err(format!("invalid ETH amount: {eth}"));
    }
    let wei = eth * 1e18;
    // 1e30 wei = 1e12 ETH — absürt bir üst sınır; ayrıca fee çarpımının
    // (`* OPENSEA_FEE_BPS`, ×250) u128'de taşmamasını garanti eder.
    if !wei.is_finite() || wei >= 1e30 {
        return Err("ETH amount out of range".to_string());
    }
    Ok(wei as u128)
}

/// Generate a random u64 salt using UUID v4 bytes.
fn random_salt() -> u64 {
    let bytes = uuid::Uuid::new_v4().as_bytes().to_owned();
    u64::from_le_bytes(bytes[..8].try_into().unwrap_or([0u8; 8]))
}

#[cfg(test)]
mod eth_to_wei_tests {
    use super::eth_to_wei;

    #[test]
    fn accepts_normal_amounts() {
        assert_eq!(eth_to_wei(0.0).unwrap(), 0);
        assert_eq!(eth_to_wei(1.0).unwrap(), 1_000_000_000_000_000_000);
    }

    #[test]
    fn rejects_nan_so_it_can_never_become_a_zero_wei_free_listing() {
        // Güvenlik denetimi #3: eski `(eth*1e18) as u128` NaN'ı 0'a çeviriyordu.
        assert!(eth_to_wei(f64::NAN).is_err());
    }

    #[test]
    fn rejects_infinite_and_negative_and_out_of_range() {
        assert!(eth_to_wei(f64::INFINITY).is_err());
        assert!(eth_to_wei(f64::NEG_INFINITY).is_err());
        assert!(eth_to_wei(-1.0).is_err());
        assert!(eth_to_wei(1e13).is_err()); // 1e13 ETH — aralık dışı
    }
}
