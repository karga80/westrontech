use alloy::consensus::{SignableTransaction, TxEip1559, TxEnvelope};
use alloy::eips::eip2718::Encodable2718;
use alloy::network::TxSignerSync;
use alloy::primitives::{Address, Bytes, TxKind, U256};
use alloy::signers::local::PrivateKeySigner;
use serde::{Deserialize, Serialize};

use crate::rpc::types::{RpcRequest, RpcResponse};

const CHAIN_ID: u64 = 1; // Ethereum Mainnet

/// İstemciden gelen transaction parametreleri.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TxRequest {
    /// Alıcı adresi: "0x..."
    pub to: String,
    /// Değer (wei cinsinden, string olarak): "1000000000000000000"
    pub value_wei: String,
    /// ABI-encoded calldata (opsiyonel): "0x..."
    pub data: Option<String>,
    /// Gas limit (opsiyonel — belirtilmezse estimate kullanılır)
    pub gas_limit: Option<u64>,
}

/// Düşük seviyeli JSON-RPC yardımcısı — mevcut AlchemyClient'ın bağımsız kopyası,
/// ancak signing modülünün bağımsız çalışabilmesi için burada tekrarlanmıştır.
async fn rpc_call<T: for<'de> serde::Deserialize<'de>>(
    client: &reqwest::Client,
    url: &str,
    method: &str,
    params: serde_json::Value,
) -> Result<T, String> {
    let req = RpcRequest::new(method, params);
    let resp = client
        .post(url)
        .json(&req)
        .send()
        .await
        .map_err(|e| format!("HTTP error: {e}"))?;

    let rpc_resp: RpcResponse<T> = resp
        .json()
        .await
        .map_err(|e| format!("JSON parse error: {e}"))?;

    if let Some(err) = rpc_resp.error {
        return Err(format!("RPC error {}: {}", err.code, err.message));
    }

    rpc_resp.result.ok_or_else(|| "Empty RPC result".to_string())
}

/// Alchemy RPC URL'sini api_key'den oluşturur.
fn alchemy_url(api_key: &str) -> String {
    format!("https://eth-mainnet.g.alchemy.com/v2/{api_key}")
}

pub struct LocalSigner;

impl LocalSigner {
    /// Keychain'den private key çeker, EIP-1559 transaction oluşturur,
    /// imzalar ve Alchemy RPC üzerinden broadcast eder.
    ///
    /// # Parametreler
    /// - `wallet_address` : imzalayıcı adres (Keychain lookup için)
    /// - `tx_request`     : to, value_wei, data, gas_limit
    /// - `api_key`        : Alchemy API key
    ///
    /// # Dönüş
    /// `Ok(tx_hash_hex)` veya `Err(açıklama)`
    pub async fn sign_and_send(
        wallet_address: &str,
        tx_request: TxRequest,
        api_key: &str,
    ) -> Result<String, String> {
        // 1. Private key'i Keychain'den al
        let pk_hex = crate::wallet::keychain::fetch_key(wallet_address)?;
        let pk_hex = pk_hex.trim_start_matches("0x");

        // 2. alloy PrivateKeySigner oluştur
        let signer: PrivateKeySigner = pk_hex
            .parse()
            .map_err(|e| format!("Invalid private key: {e}"))?;

        // 3. Değerleri parse et
        let to_addr: Address = tx_request
            .to
            .parse()
            .map_err(|e| format!("Invalid `to` address: {e}"))?;

        let value: U256 = tx_request
            .value_wei
            .parse::<u128>()
            .map(U256::from)
            .map_err(|e| format!("Invalid value_wei: {e}"))?;

        let input_bytes: Bytes = match &tx_request.data {
            Some(hex_str) => {
                let stripped = hex_str.trim_start_matches("0x");
                Bytes::from(
                    hex::decode(stripped)
                        .map_err(|e| format!("Invalid calldata hex: {e}"))?,
                )
            }
            None => Bytes::new(),
        };

        // 4. RPC client
        let http = reqwest::Client::new();
        let url = alchemy_url(api_key);

        // 5. Nonce al: eth_getTransactionCount
        let nonce_hex: String = rpc_call(
            &http,
            &url,
            "eth_getTransactionCount",
            serde_json::json!([wallet_address, "latest"]),
        )
        .await?;
        let nonce =
            u64::from_str_radix(nonce_hex.trim_start_matches("0x"), 16)
                .map_err(|e| format!("Nonce parse error: {e}"))?;

        // 6. Gas price al: eth_gasPrice (base fee proxy olarak kullanılır)
        let gas_price_hex: String = rpc_call(
            &http,
            &url,
            "eth_gasPrice",
            serde_json::json!([]),
        )
        .await?;
        let gas_price_wei =
            u128::from_str_radix(gas_price_hex.trim_start_matches("0x"), 16)
                .map_err(|e| format!("Gas price parse error: {e}"))?;

        // EIP-1559: max_priority_fee = 1.5 gwei, max_fee = gas_price * 2
        let max_priority_fee: u128 = 1_500_000_000; // 1.5 gwei
        let max_fee: u128 = gas_price_wei.saturating_mul(2).max(max_priority_fee);

        // 7. Gas limit: kullanıcı sağlamışsa kullan, yoksa estimate et
        let gas_limit: u64 = match tx_request.gas_limit {
            Some(g) => g,
            None => {
                estimate_gas_inner(
                    &http,
                    &url,
                    &tx_request.to,
                    &tx_request.value_wei,
                    tx_request.data.as_deref(),
                )
                .await?
            }
        };

        // 8. EIP-1559 tx oluştur
        let mut tx = TxEip1559 {
            chain_id: CHAIN_ID,
            nonce,
            gas_limit,
            max_fee_per_gas: max_fee,
            max_priority_fee_per_gas: max_priority_fee,
            to: TxKind::Call(to_addr),
            value,
            input: input_bytes,
            access_list: Default::default(),
        };

        // 9. İmzala → TxEnvelope
        let signature = signer
            .sign_transaction_sync(&mut tx)
            .map_err(|e| format!("Signing error: {e}"))?;
        let signed_envelope = TxEnvelope::Eip1559(tx.into_signed(signature));

        // 10. RLP encode
        let mut encoded = Vec::new();
        signed_envelope.encode_2718(&mut encoded);
        let raw_tx_hex = format!("0x{}", hex::encode(&encoded));

        // 11. eth_sendRawTransaction ile broadcast et
        let tx_hash: String = rpc_call(
            &http,
            &url,
            "eth_sendRawTransaction",
            serde_json::json!([raw_tx_hex]),
        )
        .await?;

        Ok(tx_hash)
    }
}

/// Gas estimate yardımcı fonksiyonu — dahili ve Tauri command'ı için paylaşımlı.
pub async fn estimate_gas_inner(
    client: &reqwest::Client,
    url: &str,
    to: &str,
    value_wei: &str,
    data: Option<&str>,
) -> Result<u64, String> {
    let value_u128: u128 = value_wei
        .parse()
        .map_err(|e| format!("Invalid value_wei: {e}"))?;
    let value_hex = format!("0x{:x}", value_u128);

    let mut call_obj = serde_json::json!({
        "to": to,
        "value": value_hex,
    });
    if let Some(d) = data {
        call_obj["data"] = serde_json::Value::String(d.to_string());
    }

    let estimate_hex: String = rpc_call(
        client,
        url,
        "eth_estimateGas",
        serde_json::json!([call_obj]),
    )
    .await?;

    let gas = u64::from_str_radix(estimate_hex.trim_start_matches("0x"), 16)
        .map_err(|e| format!("Gas estimate parse error: {e}"))?;

    // %20 güvenlik tamponu ekle
    Ok((gas as f64 * 1.2) as u64)
}

/// Tauri command: ETH gönder (Envelope kontrolü dahil)
#[tauri::command]
pub async fn send_eth(
    wallet_address: String,
    to: String,
    value_wei: String,
    api_key: String,
    envelope_engine: tauri::State<'_, std::sync::Arc<crate::envelope::engine::EnvelopeEngine>>,
) -> Result<String, String> {
    // Envelope kontrolü
    let calldata = String::new();
    let value_u128: u128 = value_wei
        .parse()
        .map_err(|e| format!("Invalid value_wei: {e}"))?;

    let tx_req_envelope = crate::envelope::types::TransactionRequest {
        to: to.clone(),
        value_wei: value_u128,
        calldata,
    };
    envelope_engine
        .check_and_authorize(&tx_req_envelope)
        .map_err(|e| format!("Envelope rejected: {e:?}"))?;

    // İmzala ve gönder
    let request = TxRequest {
        to,
        value_wei,
        data: None,
        gas_limit: None,
    };
    LocalSigner::sign_and_send(&wallet_address, request, &api_key).await
}

/// Tauri command: Gas tahmini
#[tauri::command]
pub async fn estimate_gas(
    to: String,
    value_wei: String,
    data: Option<String>,
    api_key: String,
) -> Result<u64, String> {
    let http = reqwest::Client::new();
    let url = alchemy_url(&api_key);
    estimate_gas_inner(&http, &url, &to, &value_wei, data.as_deref()).await
}
