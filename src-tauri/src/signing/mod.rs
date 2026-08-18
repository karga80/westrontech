pub mod nonce;

use alloy::consensus::{SignableTransaction, TxEip1559, TxEnvelope};
use alloy::eips::eip2718::Encodable2718;
use alloy::network::TxSignerSync;
use alloy::primitives::{Address, Bytes, TxKind, U256};
use alloy::signers::local::PrivateKeySigner;
use serde::{Deserialize, Serialize};

use crate::autonomy::audit::AuditRecordKind;
use crate::autonomy::engine::AutonomyEngine;
use crate::autonomy::pending::{PendingActionPayload, PendingActionProposal, PendingStatus};
use crate::autonomy::types::{ActionProposal, ActionType, AutonomyDecision};
use crate::rpc::types::{RpcRequest, RpcResponse};

// `pub(crate)`: `marketplace`'s new envelope/autonomy gates (`lib.rs`) build
// `ActionProposal`s for the same chain and must not hardcode a second `1`.
pub(crate) const CHAIN_ID: u64 = 1; // Ethereum Mainnet

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

/// Read the account's next nonce **including** anything already in the mempool.
///
/// `"pending"`, never `"latest"`: `latest` counts only mined transactions, so a
/// transfer broadcast seconds ago is invisible to it and the next send picks the
/// same nonce and replaces it.
async fn fetch_pending_nonce(
    http: &reqwest::Client,
    url: &str,
    address: &str,
) -> Result<u64, String> {
    let nonce_hex: String = rpc_call(
        http,
        url,
        "eth_getTransactionCount",
        serde_json::json!([address, "pending"]),
    )
    .await?;
    u64::from_str_radix(nonce_hex.trim_start_matches("0x"), 16)
        .map_err(|e| format!("Nonce parse error: {e}"))
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
        // 1. Private key'i Keychain'den al — ve çağıranın verdiği adresin
        //    gerçekten bu key'e ait olduğunu doğrula. `marketplace::client`
        //    ile paylaşılan aynı kontrol: adres asla çağırandan güvenilmez,
        //    key'den türetilip karşılaştırılır. Bu satır olmadan, Keychain'de
        //    yanlış adres altında duran (veya legacy şema altında bulunan) bir
        //    key sessizce başka bir cüzdan adına imza atabilirdi.
        let pk_hex = crate::wallet::keychain::fetch_and_verify_key(wallet_address)?;
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

        // 5. Nonce: serialise every send from this address behind one lock and
        //    hold it across read → sign → broadcast.
        //
        //    Reading `pending` is necessary but not sufficient: two sends can
        //    both read it before either has broadcast, and even a serialised
        //    second read can come back stale because the node has not counted
        //    the transaction we sent a moment ago. The lock removes the race and
        //    `AddressNonce` remembers what we used, so consecutive sends
        //    increment instead of replacing one another.
        let slot = nonce::slot_for(wallet_address);
        let mut nonce_guard = slot.lock().await;

        let chain_pending = fetch_pending_nonce(&http, &url, wallet_address).await?;
        let cached_next = nonce_guard.peek();
        let nonce = nonce_guard.allocate(chain_pending);
        if nonce != chain_pending {
            // The condition that used to produce a silent replacement. Worth a
            // line, because it is otherwise invisible when it goes right.
            log::debug!(
                "nonce {nonce} for {wallet_address} came from the in-process record \
                 (cached next {cached_next:?}); the node still reports pending {chain_pending}"
            );
        }

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
                    Some(wallet_address),
                    &tx_request.to,
                    &tx_request.value_wei,
                    tx_request.data.as_deref(),
                )
                .await?
            }
        };

        // Kapı-2: mutlak gas-ücreti güvenlik tavanı. Fee oracle'ının (eth_gasPrice)
        // sıçraması, zehirlenmesi ya da bir hesap bug'ı bu tek gönderiyi
        // beklenmedik biçimde pahalı hale getirse bile, yakabileceği toplam gas
        // ücretini mutlak bir tavanla sınırla. Bu kullanıcının fee tercihi DEĞİL —
        // bir güvenlik backstop'u; normal gönderiler bunun 100-1000 kat altında
        // (basit transfer ~21k gas × birkaç gwei). Tavanı aşarsa hiçbir şey
        // imzalanmaz/yayınlanmaz; nonce commit edilmediği için tüketilmez ve
        // çağıran katman envelope rezervasyonunu geri alır.
        const MAX_TX_GAS_FEE_WEI: u128 = 100_000_000_000_000_000; // 0.1 ETH
        let worst_case_gas_fee = max_fee.saturating_mul(gas_limit as u128);
        if worst_case_gas_fee > MAX_TX_GAS_FEE_WEI {
            return Err(format!(
                "Gönderi güvenlik tavanını aştı: bu işlem en kötü ihtimalle {worst_case_gas_fee} wei \
                 gas ücreti yakabilir (maxFee {max_fee} × gasLimit {gas_limit}), tavan \
                 {MAX_TX_GAS_FEE_WEI} wei (0.1 ETH). Ağ ücretleri şu an anormal yüksek olabilir — \
                 birazdan tekrar dene ya da işlemi ertele. Hiçbir şey gönderilmedi."
            ));
        }

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
        let sent: Result<String, String> = rpc_call(
            &http,
            &url,
            "eth_sendRawTransaction",
            serde_json::json!([raw_tx_hex]),
        )
        .await;

        match sent {
            Ok(tx_hash) => {
                // Only a confirmed broadcast advances our record.
                nonce_guard.commit(nonce);
                Ok(tx_hash)
            }
            Err(msg) => {
                // Any failure invalidates the cached nonce: a transport error
                // or timeout can hide a transaction that did reach the mempool,
                // and re-reading `pending` is always the safe direction.
                nonce_guard.invalidate();

                match nonce::classify_send_error(&msg) {
                    Some(fault) => {
                        // Re-read the chain so the message states where the
                        // account actually is, instead of retrying blind and
                        // possibly replacing a transaction the user still wants.
                        let chain_now = fetch_pending_nonce(&http, &url, wallet_address)
                            .await
                            .ok();
                        log::warn!(
                            "send from {wallet_address} refused by the node ({:?}) at nonce {nonce}",
                            fault
                        );
                        Err(nonce::describe_fault(fault, nonce, chain_now, &msg))
                    }
                    None => Err(msg),
                }
            }
        }
    }
}

/// Gas estimate yardımcı fonksiyonu — dahili ve Tauri command'ı için paylaşımlı.
///
/// `from` matters for anything beyond a plain value transfer: a contract call
/// like `transferFrom` reverts unless the node evaluates it as sent by the
/// actual owner/approved account, and `eth_estimateGas` defaults `from` to
/// the zero address when it is omitted. Plain ETH sends do not depend on it,
/// which is why every existing caller kept working when this parameter was
/// added — but NFT transfer calldata does, so it must be threaded through.
pub async fn estimate_gas_inner(
    client: &reqwest::Client,
    url: &str,
    from: Option<&str>,
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
    if let Some(f) = from {
        call_obj["from"] = serde_json::Value::String(f.to_string());
    }
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

/// Result of [`authorize_or_queue`]: either the caller may sign and send
/// right now, or the action was queued and someone must call
/// `approve_action_proposal`/`reject_action_proposal` (`lib.rs`) later.
pub(crate) enum AuthorizationOutcome {
    Proceed,
    Queued { proposal_id: String, reason: String },
}

/// Run `proposal` through this wallet's autonomy policy, record the outcome
/// in the hash-chained audit log — every decision, not only an `Allow`,
/// mirroring how `EnvelopeEngine::check_and_authorize` audits both its
/// accept and reject paths rather than only the successful one — and, on
/// `RequiresApproval`, persist a [`PendingActionProposal`] so the request is
/// never simply lost.
///
/// This is an *additional* gate layered on top of whatever envelope check
/// the caller already ran; it never replaces it, and it never runs before
/// the envelope check. `Ok(Proceed)` means the caller may sign now.
/// `Ok(Queued { .. })` means it must not sign now — the caller is
/// responsible for rolling back whatever the envelope check just reserved,
/// exactly like it already does for `Err`. `Err` is a hard `Deny`, or a
/// failure to even persist the queued proposal (see the note on
/// `pending::add` — that failure is never silently swallowed, because a
/// "queued" proposal that in fact was not saved would be exactly the kind of
/// fake success this project's rules forbid).
///
/// `ensure_policy_loaded` populates the engine from
/// `autonomy::store::load_or_default` on first access for this wallet, per
/// the standing bootstrapping convention — it is a no-op for a wallet
/// already resident in memory, so it never resets that wallet's spend/rate
/// counters on a call that isn't the first.
pub(crate) fn authorize_or_queue(
    autonomy_engine: &AutonomyEngine,
    proposal: &ActionProposal,
    kill_switch_active: bool,
    payload: PendingActionPayload,
) -> Result<AuthorizationOutcome, String> {
    autonomy_engine.ensure_policy_loaded(&proposal.wallet_address);

    let now = chrono::Utc::now().timestamp();
    let decision = autonomy_engine
        .check_and_authorize(proposal, kill_switch_active, /* watch_only */ false, now)
        .map_err(|e| format!("Autonomy policy check failed: {e:?}"))?;

    // Best-effort, loud on failure — same tradeoff `EnvelopeEngine::persist`
    // makes for its own disk writes: losing the audit line must not block a
    // transaction the policy engine already decided on, but it must never be
    // swallowed silently either.
    if let Err(e) = crate::autonomy::audit::append(
        &proposal.wallet_address,
        AuditRecordKind::Decision { outcome: decision.clone(), matched_rule_index: None },
        now,
    ) {
        log::error!(
            "could not append autonomy audit record for {}: {e}",
            proposal.wallet_address
        );
    }

    match decision {
        AutonomyDecision::Allow { .. } => Ok(AuthorizationOutcome::Proceed),
        AutonomyDecision::Deny { reason } => {
            Err(format!("Autonomy policy denied this action: {reason}"))
        }
        AutonomyDecision::RequiresApproval { reason } => {
            let id = uuid::Uuid::new_v4().to_string();
            let item = PendingActionProposal {
                id: id.clone(),
                wallet_address: proposal.wallet_address.clone(),
                proposal: proposal.clone(),
                reason: reason.clone(),
                payload,
                created_at: now,
                status: PendingStatus::Pending,
            };
            // Not best-effort: if this can't be saved, the request must not
            // be reported as queued — see the doc comment above.
            crate::autonomy::pending::add(item)?;

            if let Err(e) = crate::autonomy::audit::append(
                &proposal.wallet_address,
                AuditRecordKind::LeaseCreated {
                    lease_id: id.clone(),
                    expires_at: now + crate::autonomy::pending::PENDING_TTL_SECONDS,
                },
                now,
            ) {
                log::error!(
                    "could not append autonomy lease-created audit record for {}: {e}",
                    proposal.wallet_address
                );
            }

            Ok(AuthorizationOutcome::Queued { proposal_id: id, reason })
        }
    }
}

/// What a signing command actually did: either it sent and got a real tx
/// hash back, or the autonomy policy queued it for a human to approve later
/// — never a bare error for the second case, since "queued" is not a
/// failure, and never a fabricated tx hash either.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "outcome", rename_all = "snake_case")]
pub enum SigningOutcome {
    Sent { tx_hash: String },
    PendingApproval { proposal_id: String, reason: String },
}

/// Tauri command: ETH gönder (Envelope + autonomy kontrolü dahil)
#[tauri::command]
pub async fn send_eth(
    wallet_address: String,
    to: String,
    value_wei: String,
    api_key: String,
    envelope_engine: tauri::State<'_, std::sync::Arc<crate::envelope::engine::EnvelopeEngine>>,
    autonomy_engine: tauri::State<'_, std::sync::Arc<AutonomyEngine>>,
) -> Result<SigningOutcome, String> {
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

    // Autonomy kontrolü — envelope'un üzerine eklenen ikinci bir kapı, onun
    // yerine geçmez. Aynı kill switch'i paylaşır: envelope ve autonomy farklı
    // "her şeyi durdur" anlamına gelmemeli.
    let kill_switch_active =
        envelope_engine.get_status().map(|s| s.kill_switch).unwrap_or(false);
    let proposal = ActionProposal {
        action_type: ActionType::TransferNative,
        wallet_address: wallet_address.clone(),
        target_contract: Some(to.clone()),
        calldata: None,
        value_wei: value_u128,
        chain_id: CHAIN_ID,
    };
    let payload = PendingActionPayload::SendEth { to: to.clone(), value_wei: value_wei.clone() };
    match authorize_or_queue(&autonomy_engine, &proposal, kill_switch_active, payload) {
        Ok(AuthorizationOutcome::Queued { proposal_id, reason }) => {
            // Not executing now — the envelope reservation above must be
            // reversed exactly like every other path that doesn't end in a
            // real broadcast.
            envelope_engine.rollback_authorization(&tx_req_envelope);
            return Ok(SigningOutcome::PendingApproval { proposal_id, reason });
        }
        Err(e) => {
            envelope_engine.rollback_authorization(&tx_req_envelope);
            return Err(e);
        }
        Ok(AuthorizationOutcome::Proceed) => {}
    }

    // İmzala ve gönder. `check_and_authorize` already consumed the spend cap
    // above — it has to run before signing, so an unauthorised transaction is
    // never even built. But that means a failure anywhere below (signing,
    // nonce, RPC, broadcast) has already been paid for out of the user's
    // budget without a single wei moving. Roll the consumed spend back for
    // every path that is not "the chain accepted the raw transaction", so a
    // dropped/failed send never eats into the cap the user sees next time.
    let request = TxRequest {
        to,
        value_wei,
        data: None,
        gas_limit: None,
    };
    match LocalSigner::sign_and_send(&wallet_address, request, &api_key).await {
        Ok(tx_hash) => Ok(SigningOutcome::Sent { tx_hash }),
        Err(e) => {
            envelope_engine.rollback_authorization(&tx_req_envelope);
            Err(e)
        }
    }
}

/// Tauri command: direkt cüzdandan cüzdana NFT transferi (ERC-721/1155).
///
/// A marketplace sale is a different code path (Bulk Actions / Seaport) —
/// this is a bare `safeTransferFrom`. Per the T9 decision
/// (`docs/DECISIONS-PENDING.md` D2) this reuses the exact same envelope
/// `evaluate()` an ETH send goes through, called with `value_wei = 0`: the
/// kill switch, expiry, and scope guards all apply for free, and no new
/// cap/allowlist is introduced. The cost of that reuse is explicit: `to`
/// must already be in the wallet's ETH scope, or this is refused with
/// `out_of_scope` exactly like an ETH send to an unlisted address would be.
///
/// `token_id` and `amount` are decimal strings, not JS numbers — an ERC-721
/// token id or an ERC-1155 amount can exceed what an f64 represents exactly.
#[tauri::command]
pub async fn transfer_nft(
    wallet_address: String,
    contract_address: String,
    token_id: String,
    to: String,
    token_standard: crate::nft::TokenStandard,
    amount: Option<String>,
    api_key: String,
    envelope_engine: tauri::State<'_, std::sync::Arc<crate::envelope::engine::EnvelopeEngine>>,
    autonomy_engine: tauri::State<'_, std::sync::Arc<AutonomyEngine>>,
) -> Result<SigningOutcome, String> {
    // Envelope kontrolü: value_wei = 0, `to` = NFT'nin gideceği adres (kontrat
    // adresi değil) — zarfın scope listesi alıcıyı, yani gerçek insan
    // hedefini kontrol eder.
    let tx_req_envelope = crate::envelope::types::TransactionRequest {
        to: to.clone(),
        value_wei: 0,
        calldata: String::new(),
    };
    envelope_engine
        .check_and_authorize(&tx_req_envelope)
        .map_err(|e| format!("Envelope rejected: {e:?}"))?;

    // Autonomy kontrolü — envelope'un üzerine eklenen ikinci kapı.
    let kill_switch_active =
        envelope_engine.get_status().map(|s| s.kill_switch).unwrap_or(false);
    let action_type = match token_standard {
        crate::nft::TokenStandard::Erc721 => ActionType::TransferErc721,
        crate::nft::TokenStandard::Erc1155 => ActionType::TransferErc1155,
    };
    let proposal = ActionProposal {
        action_type,
        wallet_address: wallet_address.clone(),
        target_contract: Some(contract_address.clone()),
        calldata: None,
        value_wei: 0,
        chain_id: CHAIN_ID,
    };
    let payload = PendingActionPayload::TransferNft {
        contract_address: contract_address.clone(),
        token_id: token_id.clone(),
        to: to.clone(),
        token_standard,
        amount: amount.clone(),
    };
    match authorize_or_queue(&autonomy_engine, &proposal, kill_switch_active, payload) {
        Ok(AuthorizationOutcome::Queued { proposal_id, reason }) => {
            envelope_engine.rollback_authorization(&tx_req_envelope);
            return Ok(SigningOutcome::PendingApproval { proposal_id, reason });
        }
        Err(e) => {
            envelope_engine.rollback_authorization(&tx_req_envelope);
            return Err(e);
        }
        Ok(AuthorizationOutcome::Proceed) => {}
    }

    // Envelope + autonomy kabul etti; artık başarısız her adım (adres/parse
    // hatası, imzalama, yayın) `send_eth` ile aynı sebepten geri alınmalı —
    // aksi halde yayınlanmamış bir NFT transferi için harcama kaydı kalıcı
    // olur.
    let result = build_and_send_nft_transfer(
        &wallet_address,
        &contract_address,
        &token_id,
        &to,
        token_standard,
        amount.as_deref(),
        &api_key,
    )
    .await;

    if result.is_err() {
        envelope_engine.rollback_authorization(&tx_req_envelope);
    }
    result.map(|tx_hash| SigningOutcome::Sent { tx_hash })
}

/// `transfer_nft`'in imzalama/yayın kısmı — envelope kontrolünden bağımsız,
/// böylece rollback her hata yolunu tek bir yerden kapsar. `pub(crate)`:
/// `approve_action_proposal` (`lib.rs`) reuses this exact function to execute
/// a `TransferNft` payload later, so an approved NFT transfer builds its
/// calldata through the identical path an immediate one does — never a
/// second, hand-rolled copy.
pub(crate) async fn build_and_send_nft_transfer(
    wallet_address: &str,
    contract_address: &str,
    token_id: &str,
    to: &str,
    token_standard: crate::nft::TokenStandard,
    amount: Option<&str>,
    api_key: &str,
) -> Result<String, String> {
    use alloy::primitives::{Address, U256};

    let from_addr: Address = wallet_address
        .parse()
        .map_err(|e| format!("Invalid wallet address: {e}"))?;
    let to_addr: Address = to.parse().map_err(|e| format!("Invalid `to` address: {e}"))?;
    let token_id_u256: U256 = token_id
        .parse()
        .map_err(|e| format!("Invalid token_id: {e}"))?;
    let amount_u256: U256 = match amount {
        Some(a) => a.parse().map_err(|e| format!("Invalid amount: {e}"))?,
        None => U256::from(1u64),
    };

    let calldata = crate::nft::encode_transfer(
        token_standard,
        from_addr,
        to_addr,
        token_id_u256,
        amount_u256,
    );
    let calldata_hex = format!("0x{}", hex::encode(&calldata));

    let request = TxRequest {
        to: contract_address.to_string(),
        value_wei: "0".to_string(),
        data: Some(calldata_hex),
        gas_limit: None,
    };
    LocalSigner::sign_and_send(wallet_address, request, api_key).await
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
    estimate_gas_inner(&http, &url, None, &to, &value_wei, data.as_deref()).await
}
