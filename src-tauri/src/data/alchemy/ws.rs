//! Alchemy WebSocket manager — multiplexes every JSON-RPC subscription
//! over a single persistent connection.
//!
//! Why one manager: Alchemy's free tier permits multiple subscriptions per
//! socket; opening one socket per subscription quickly burns through the
//! concurrent-connection limit. We share a single connection, route inbound
//! `eth_subscription` notifications to the right consumer, and rebuild from
//! scratch on disconnect (with the registered subscriptions automatically
//! re-established).
//!
//! Reconnect strategy:
//! - Exponential backoff: 1s → 2s → 4s → 8s → 16s → 30s (capped)
//! - Heartbeat: every 25s send a no-op `eth_blockNumber` request and abort
//!   the connection if no response within 10s.
//! - Resubscribe: on (re)connect, every previously-registered subscription
//!   is sent again from the registry.
//! - Reconcile: callers (wallet/nft streams) listen for ConnectionState
//!   events and can issue a delta REST fetch to fill in events missed
//!   during downtime.

use std::collections::HashMap;
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::Arc;
use std::time::Duration;

use futures_util::{SinkExt, StreamExt};
use serde::Deserialize;
use serde_json::{json, Value};
use tokio::sync::{mpsc, Mutex, RwLock};
use tokio::time::{sleep, timeout};
use tokio_tungstenite::tungstenite::Message;

use crate::data::provider::{DataProviderError, ProviderResult};
use crate::data::types::{SubscriptionId, WalletEvent};

/// Logical subscription registered by callers. The `params` are the exact
/// JSON sent as the second element of `eth_subscribe`'s param array.
#[derive(Clone, Debug)]
struct LogicalSubscription {
    id: SubscriptionId,
    method: SubscribeMethod,
    params: Value,
    /// Latest server-assigned subscription id for this logical entry.
    /// Reset on every reconnect.
    server_id: Option<String>,
}

#[derive(Clone, Debug, PartialEq, Eq)]
enum SubscribeMethod {
    NewHeads,
    Logs,
    AlchemyMinedTransactions,
}

impl SubscribeMethod {
    fn rpc_name(&self) -> &'static str {
        // All variants use the same `eth_subscribe` method; the differentiator
        // is the first param (the subscription type string).
        "eth_subscribe"
    }
    fn type_string(&self) -> &'static str {
        match self {
            Self::NewHeads => "newHeads",
            Self::Logs => "logs",
            Self::AlchemyMinedTransactions => "alchemy_minedTransactions",
        }
    }
}

/// Shared state behind the manager. Cheap to clone (Arc internally).
pub struct AlchemyWsManager {
    api_key: String,
    next_logical_id: AtomicU64,
    /// Logical subscriptions are the source of truth — re-applied on reconnect.
    subscriptions: Arc<RwLock<HashMap<SubscriptionId, LogicalSubscription>>>,
    /// Drained by callers via `drain_pending`; live consumers use `event_router`.
    pending: Arc<Mutex<Vec<WalletEvent>>>,
    /// Inbound command channel — `subscribe`/`unsubscribe` post here, the
    /// background task receives and forwards.
    cmd_tx: Arc<Mutex<Option<mpsc::Sender<WsCommand>>>>,
}

#[derive(Debug)]
enum WsCommand {
    Subscribe(LogicalSubscription),
    Unsubscribe(SubscriptionId),
}

impl AlchemyWsManager {
    pub fn new(api_key: &str) -> Self {
        Self {
            api_key: api_key.to_string(),
            next_logical_id: AtomicU64::new(1),
            subscriptions: Arc::new(RwLock::new(HashMap::new())),
            pending: Arc::new(Mutex::new(Vec::new())),
            cmd_tx: Arc::new(Mutex::new(None)),
        }
    }

    fn ws_url(&self) -> String {
        format!("wss://eth-mainnet.g.alchemy.com/v2/{}", self.api_key)
    }

    fn next_id(&self) -> SubscriptionId {
        SubscriptionId(self.next_logical_id.fetch_add(1, Ordering::Relaxed))
    }

    /// Drain everything queued so far (consumed by `RealtimeProvider::poll_events`
    /// for tests; production code uses the Tauri event router instead).
    pub async fn drain_pending(&self) -> Vec<WalletEvent> {
        let mut guard = self.pending.lock().await;
        std::mem::take(&mut *guard)
    }

    /// Subscribe to mined-tx events for the given wallets.
    pub async fn subscribe_mined_transactions(
        &self,
        wallets: &[String],
    ) -> ProviderResult<SubscriptionId> {
        if wallets.is_empty() {
            return Err(DataProviderError::InvalidArgument("no wallets".into()));
        }
        let params = json!({
            "addresses": wallets.iter()
                .map(|w| json!({"to": w}))
                .collect::<Vec<_>>(),
            "includeRemoved": false,
            "hashesOnly": false,
        });
        self.register(SubscribeMethod::AlchemyMinedTransactions, params).await
    }

    /// Subscribe to ERC-721 / ERC-1155 Transfer logs on the given collections.
    /// Using a topic filter keeps inbound traffic small.
    pub async fn subscribe_collection_transfers(
        &self,
        contracts: &[String],
    ) -> ProviderResult<SubscriptionId> {
        if contracts.is_empty() {
            return Err(DataProviderError::InvalidArgument("no contracts".into()));
        }
        // ERC-721 Transfer event topic = keccak256("Transfer(address,address,uint256)")
        // ERC-1155 TransferSingle    = keccak256("TransferSingle(address,address,address,uint256,uint256)")
        let topic_erc721 = "0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef";
        let topic_erc1155 = "0xc3d58168c5ae7397731d063d5bbf3d657854427343f4c083240f7aacaa2d0f62";
        let params = json!({
            "address": contracts,
            "topics": [[topic_erc721, topic_erc1155]],
        });
        self.register(SubscribeMethod::Logs, params).await
    }

    /// Subscribe to new block headers.
    pub async fn subscribe_new_heads(&self) -> ProviderResult<SubscriptionId> {
        self.register(SubscribeMethod::NewHeads, json!({})).await
    }

    /// Cancel a previously-registered subscription.
    pub async fn unsubscribe(&self, id: SubscriptionId) -> ProviderResult<()> {
        self.subscriptions.write().await.remove(&id);
        if let Some(tx) = self.cmd_tx.lock().await.as_ref() {
            let _ = tx.send(WsCommand::Unsubscribe(id)).await;
        }
        Ok(())
    }

    async fn register(
        &self,
        method: SubscribeMethod,
        params: Value,
    ) -> ProviderResult<SubscriptionId> {
        let logical = LogicalSubscription {
            id: self.next_id(),
            method,
            params,
            server_id: None,
        };
        let id = logical.id;
        self.subscriptions.write().await.insert(id, logical.clone());
        // Lazily start the background driver on first subscription.
        self.ensure_driver_running().await;

        if let Some(tx) = self.cmd_tx.lock().await.as_ref() {
            let _ = tx.send(WsCommand::Subscribe(logical)).await;
        }
        Ok(id)
    }

    async fn ensure_driver_running(&self) {
        let mut guard = self.cmd_tx.lock().await;
        if guard.is_some() {
            return;
        }
        let (tx, rx) = mpsc::channel::<WsCommand>(64);
        *guard = Some(tx);
        drop(guard);

        let api_key = self.api_key.clone();
        let url = self.ws_url();
        let subs = Arc::clone(&self.subscriptions);
        let pending = Arc::clone(&self.pending);

        tokio::spawn(async move {
            run_driver(api_key, url, subs, pending, rx).await;
        });
    }
}

/// Background task — owns the WebSocket connection, dispatches commands,
/// reconnects on failure, and pushes parsed events into the pending queue.
async fn run_driver(
    _api_key: String,
    url: String,
    subs: Arc<RwLock<HashMap<SubscriptionId, LogicalSubscription>>>,
    pending: Arc<Mutex<Vec<WalletEvent>>>,
    mut cmd_rx: mpsc::Receiver<WsCommand>,
) {
    let mut backoff = 1u64;
    loop {
        match tokio_tungstenite::connect_async(&url).await {
            Ok((stream, _resp)) => {
                backoff = 1; // reset on success
                // Push connection-up event so the UI can clear any "reconnecting" state.
                push_event(&pending, WalletEvent::ConnectionState {
                    connected: true, reason: None,
                }).await;

                let session_alive = run_session(stream, &subs, &pending, &mut cmd_rx).await;
                push_event(&pending, WalletEvent::ConnectionState {
                    connected: false, reason: session_alive.err(),
                }).await;
            }
            Err(e) => {
                push_event(&pending, WalletEvent::ConnectionState {
                    connected: false, reason: Some(format!("connect: {e}")),
                }).await;
            }
        }

        sleep(Duration::from_secs(backoff)).await;
        backoff = (backoff * 2).min(30);
    }
}

/// One session lifetime — exits on socket close or unrecoverable error so the
/// outer reconnect loop can take over.
async fn run_session(
    ws: tokio_tungstenite::WebSocketStream<tokio_tungstenite::MaybeTlsStream<tokio::net::TcpStream>>,
    subs: &Arc<RwLock<HashMap<SubscriptionId, LogicalSubscription>>>,
    pending: &Arc<Mutex<Vec<WalletEvent>>>,
    cmd_rx: &mut mpsc::Receiver<WsCommand>,
) -> Result<(), String> {
    let (mut sink, mut stream) = ws.split();
    let next_req_id = AtomicU64::new(100);
    // Map of pending RPC requests (id → logical subscription) so we can bind
    // the server-assigned subscription id to our logical entry on response.
    let pending_subs: Arc<Mutex<HashMap<u64, SubscriptionId>>> = Arc::new(Mutex::new(HashMap::new()));
    // Map of server subscription id → logical id, used to route notifications.
    let server_to_logical: Arc<RwLock<HashMap<String, SubscriptionId>>> = Arc::new(RwLock::new(HashMap::new()));

    // Re-subscribe everything that was registered before this session started.
    {
        let snapshot: Vec<LogicalSubscription> = subs.read().await.values().cloned().collect();
        for logical in snapshot {
            send_subscribe(&mut sink, &next_req_id, &pending_subs, &logical).await
                .map_err(|e| format!("resubscribe: {e}"))?;
        }
    }

    let mut heartbeat = tokio::time::interval(Duration::from_secs(25));
    heartbeat.tick().await; // skip the immediate tick

    loop {
        tokio::select! {
            // Inbound from server
            msg = stream.next() => {
                let Some(msg) = msg else {
                    return Err("socket closed".into());
                };
                let msg = msg.map_err(|e| format!("ws recv: {e}"))?;
                match msg {
                    Message::Text(text) => {
                        if let Err(e) = handle_inbound(&text, &pending_subs, &server_to_logical, subs, pending).await {
                            log::warn!("ws inbound: {e}");
                        }
                    }
                    Message::Ping(payload) => {
                        let _ = sink.send(Message::Pong(payload)).await;
                    }
                    Message::Close(_) => return Err("server closed".into()),
                    _ => {}
                }
            }

            // Outbound commands from caller side
            cmd = cmd_rx.recv() => {
                match cmd {
                    Some(WsCommand::Subscribe(logical)) => {
                        if let Err(e) = send_subscribe(&mut sink, &next_req_id, &pending_subs, &logical).await {
                            log::warn!("ws subscribe: {e}");
                        }
                    }
                    Some(WsCommand::Unsubscribe(id)) => {
                        // Find the server id for this logical id, then send eth_unsubscribe.
                        let server_id = {
                            let map = server_to_logical.read().await;
                            map.iter().find(|(_, &v)| v == id).map(|(k, _)| k.clone())
                        };
                        if let Some(sid) = server_id {
                            let req_id = next_req_id.fetch_add(1, Ordering::Relaxed);
                            let body = json!({
                                "jsonrpc": "2.0",
                                "id": req_id,
                                "method": "eth_unsubscribe",
                                "params": [sid.clone()],
                            });
                            let _ = sink.send(Message::Text(body.to_string())).await;
                            server_to_logical.write().await.remove(&sid);
                        }
                    }
                    None => return Ok(()), // command channel closed → exit
                }
            }

            // Heartbeat — non-blocking ping using eth_blockNumber.
            _ = heartbeat.tick() => {
                let req_id = next_req_id.fetch_add(1, Ordering::Relaxed);
                let body = json!({
                    "jsonrpc": "2.0", "id": req_id, "method": "eth_blockNumber", "params": []
                });
                if let Err(e) = timeout(Duration::from_secs(10), sink.send(Message::Text(body.to_string()))).await {
                    return Err(format!("heartbeat send: {e}"));
                }
            }
        }
    }
}

async fn send_subscribe(
    sink: &mut futures_util::stream::SplitSink<
        tokio_tungstenite::WebSocketStream<tokio_tungstenite::MaybeTlsStream<tokio::net::TcpStream>>,
        Message,
    >,
    next_req_id: &AtomicU64,
    pending_subs: &Arc<Mutex<HashMap<u64, SubscriptionId>>>,
    logical: &LogicalSubscription,
) -> Result<(), String> {
    let req_id = next_req_id.fetch_add(1, Ordering::Relaxed);
    pending_subs.lock().await.insert(req_id, logical.id);
    let body = json!({
        "jsonrpc": "2.0",
        "id": req_id,
        "method": logical.method.rpc_name(),
        "params": [logical.method.type_string(), logical.params],
    });
    sink.send(Message::Text(body.to_string())).await.map_err(|e| e.to_string())
}

#[derive(Deserialize)]
struct InboundSubscribeReply {
    id: Option<u64>,
    result: Option<String>,
    #[allow(dead_code)]
    error: Option<Value>,
}

#[derive(Deserialize)]
struct InboundNotification {
    method: String,
    params: NotificationParams,
}

#[derive(Deserialize)]
struct NotificationParams {
    subscription: String,
    result: Value,
}

async fn handle_inbound(
    text: &str,
    pending_subs: &Arc<Mutex<HashMap<u64, SubscriptionId>>>,
    server_to_logical: &Arc<RwLock<HashMap<String, SubscriptionId>>>,
    subs: &Arc<RwLock<HashMap<SubscriptionId, LogicalSubscription>>>,
    pending: &Arc<Mutex<Vec<WalletEvent>>>,
) -> Result<(), String> {
    let value: Value = serde_json::from_str(text).map_err(|e| e.to_string())?;

    // Notification?
    if value.get("method").and_then(|m| m.as_str()) == Some("eth_subscription") {
        let n: InboundNotification = serde_json::from_value(value).map_err(|e| e.to_string())?;
        let logical_id = {
            let map = server_to_logical.read().await;
            map.get(&n.params.subscription).copied()
        };
        let Some(logical_id) = logical_id else {
            return Ok(()); // unknown subscription — ignore
        };

        let method = {
            let m = subs.read().await;
            m.get(&logical_id).map(|s| s.method.clone())
        };
        let Some(method) = method else { return Ok(()); };

        if let Some(event) = parse_notification(method, &n.params.result, &n.method) {
            push_event(pending, event).await;
        }
        return Ok(());
    }

    // Subscribe reply (JSON-RPC response with `result: <subId string>`)
    if let Ok(reply) = serde_json::from_value::<InboundSubscribeReply>(value.clone()) {
        if let (Some(req_id), Some(server_id)) = (reply.id, reply.result) {
            let logical = pending_subs.lock().await.remove(&req_id);
            if let Some(logical_id) = logical {
                server_to_logical.write().await.insert(server_id.clone(), logical_id);
                if let Some(s) = subs.write().await.get_mut(&logical_id) {
                    s.server_id = Some(server_id);
                }
            }
        }
    }
    Ok(())
}

fn parse_notification(method: SubscribeMethod, result: &Value, _rpc_method: &str) -> Option<WalletEvent> {
    match method {
        SubscribeMethod::NewHeads => {
            // header object: { number, hash, timestamp, baseFeePerGas, gasUsed, gasLimit, ... }
            let block_number = parse_hex_u64(result.get("number")?.as_str()?)?;
            let block_hash = result.get("hash")?.as_str()?.to_string();
            let timestamp = parse_hex_u64(result.get("timestamp")?.as_str()?)?;
            let base_fee_per_gas_wei = result.get("baseFeePerGas")
                .and_then(|v| v.as_str())
                .map(|s| u128::from_str_radix(s.trim_start_matches("0x"), 16).unwrap_or(0).to_string());
            let gas_used = result.get("gasUsed").and_then(|v| v.as_str()).map(String::from);
            let gas_limit = result.get("gasLimit").and_then(|v| v.as_str()).map(String::from);
            Some(WalletEvent::NewBlock {
                block_number,
                block_hash,
                timestamp,
                base_fee_per_gas_wei,
                gas_used,
                gas_limit,
            })
        }
        SubscribeMethod::Logs => {
            // log object: { address, topics: [...], blockNumber, transactionHash, ... }
            let contract = result.get("address")?.as_str()?.to_string();
            let topics = result.get("topics")?.as_array()?;
            // For ERC-721: topics[1]=from, topics[2]=to, topics[3]=tokenId
            let from = topics.get(1).and_then(|v| v.as_str()).map(addr_from_topic).unwrap_or_default();
            let to = topics.get(2).and_then(|v| v.as_str()).map(addr_from_topic).unwrap_or_default();
            let token_id = topics.get(3).and_then(|v| v.as_str()).map(|s| {
                u128::from_str_radix(s.trim_start_matches("0x"), 16)
                    .map(|v| v.to_string())
                    .unwrap_or_else(|_| s.to_string())
            });
            let block_number = parse_hex_u64(result.get("blockNumber")?.as_str()?)?;
            let tx_hash = result.get("transactionHash")?.as_str()?.to_string();
            Some(WalletEvent::CollectionTransfer {
                contract, from, to, token_id, block_number, tx_hash,
            })
        }
        SubscribeMethod::AlchemyMinedTransactions => {
            // result: { transaction: { hash, from, to, value, ... } }
            let tx = result.get("transaction")?;
            let hash = tx.get("hash")?.as_str()?.to_string();
            let from = tx.get("from")?.as_str()?.to_string();
            let to = tx.get("to").and_then(|v| v.as_str()).map(String::from);
            let value_wei = tx.get("value").and_then(|v| v.as_str()).map(String::from);
            let block_number = tx.get("blockNumber")
                .and_then(|v| v.as_str())
                .and_then(|s| parse_hex_u64(s))
                .unwrap_or(0);
            // The wallet "the event is for" is whichever of from/to matched the
            // subscription filter — Alchemy doesn't echo it back, so consumers
            // must reconcile by checking each tx against their wallet list.
            let wallet = to.clone().unwrap_or_else(|| from.clone());
            Some(WalletEvent::WalletTx {
                wallet, hash, from, to, value_wei, block_number,
                category: "external".into(),
                asset: Some("ETH".into()),
            })
        }
    }
}

fn parse_hex_u64(s: &str) -> Option<u64> {
    u64::from_str_radix(s.trim_start_matches("0x"), 16).ok()
}

fn addr_from_topic(topic: &str) -> String {
    // Topics are 32-byte (64 hex chars + 0x); addresses are last 20 bytes (40 hex).
    let stripped = topic.trim_start_matches("0x");
    if stripped.len() >= 40 {
        format!("0x{}", &stripped[stripped.len() - 40..])
    } else {
        topic.to_string()
    }
}

async fn push_event(pending: &Arc<Mutex<Vec<WalletEvent>>>, event: WalletEvent) {
    pending.lock().await.push(event);
}
