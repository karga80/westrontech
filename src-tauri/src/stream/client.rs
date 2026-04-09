use std::time::Duration;

use futures_util::{SinkExt, StreamExt};
use serde_json::{json, Value};
use tauri::{AppHandle, Emitter};
use tokio::sync::watch;
use tokio_tungstenite::{connect_async, tungstenite::Message};

use crate::alerts;
use crate::alerts::engine::AlertEngine;
use crate::sniping;
use crate::sniping::db as snipe_db;

use super::types::{
    CollectionOfferPayload, ItemCancelledPayload, ItemListedPayload,
    ItemMetadataUpdatedPayload, ItemReceivedBidPayload, ItemSoldPayload,
    ItemTransferredPayload, OrderInvalidatePayload, OrderRevalidatePayload,
    StreamEvent, TraitOfferPayload,
};

const ENDPOINT: &str = "wss://stream.openseabeta.com/socket/websocket";

pub async fn run(
    api_key: String,
    collections: Vec<String>,
    app: AppHandle,
    mut stop_rx: watch::Receiver<bool>,
) {
    let mut ref_id: u64 = 1;

    'outer: loop {
        if *stop_rx.borrow_and_update() {
            break;
        }

        let url = format!("{}?token={}&vsn=2.0.0", ENDPOINT, api_key);

        app.emit(
            "stream-status",
            json!({ "connected": false, "reconnecting": false, "subscribed_collections": &collections }),
        )
        .ok();

        let connect_result = tokio::select! {
            r = connect_async(&url) => r,
            _ = stop_rx.changed() => break 'outer,
        };

        let ws_stream = match connect_result {
            Err(e) => {
                log::error!("Stream: connect failed: {}", e);
                app.emit(
                    "stream-status",
                    json!({ "connected": false, "error": e.to_string(), "reconnecting": true, "subscribed_collections": [] }),
                )
                .ok();
                tokio::select! {
                    _ = tokio::time::sleep(Duration::from_secs(5)) => {}
                    _ = stop_rx.changed() => break 'outer,
                }
                continue;
            }
            Ok((stream, _)) => stream,
        };

        let (mut write, mut read) = ws_stream.split();

        // Join a Phoenix channel for each collection
        for slug in &collections {
            let topic = format!("collection:{}", slug);
            let join_ref = ref_id.to_string();
            ref_id += 1;
            let msg = json!([join_ref, join_ref, topic, "phx_join", {}]);
            if write.send(Message::Text(msg.to_string())).await.is_err() {
                continue 'outer;
            }
        }

        app.emit(
            "stream-status",
            json!({ "connected": true, "reconnecting": false, "subscribed_collections": &collections }),
        )
        .ok();

        let mut heartbeat = tokio::time::interval(Duration::from_secs(30));
        heartbeat.tick().await; // skip immediate first tick

        loop {
            tokio::select! {
                _ = stop_rx.changed() => {
                    write.send(Message::Close(None)).await.ok();
                    break 'outer;
                }
                _ = heartbeat.tick() => {
                    let r = ref_id.to_string();
                    ref_id += 1;
                    let hb = json!([null, r, "phoenix", "heartbeat", {}]);
                    if write.send(Message::Text(hb.to_string())).await.is_err() {
                        break; // will reconnect in outer loop
                    }
                }
                item = read.next() => {
                    match item {
                        None | Some(Err(_)) => break, // connection dropped, reconnect
                        Some(Ok(Message::Text(text))) => {
                            handle_message(text.as_str(), &app).await;
                        }
                        Some(Ok(Message::Ping(data))) => {
                            write.send(Message::Pong(data)).await.ok();
                        }
                        _ => {}
                    }
                }
            }
        }

        app.emit(
            "stream-status",
            json!({ "connected": false, "reconnecting": true, "subscribed_collections": &collections }),
        )
        .ok();

        tokio::select! {
            _ = tokio::time::sleep(Duration::from_secs(3)) => {}
            _ = stop_rx.changed() => break 'outer,
        }
    }

    app.emit(
        "stream-status",
        json!({ "connected": false, "reconnecting": false, "subscribed_collections": [] }),
    )
    .ok();
}

async fn handle_message(text: &str, app: &AppHandle) {
    let msg: Value = match serde_json::from_str(text) {
        Ok(v) => v,
        Err(_) => return,
    };

    let arr = match msg.as_array() {
        Some(a) if a.len() >= 5 => a,
        _ => return,
    };

    let topic = arr[2].as_str().unwrap_or("");
    let event = arr[3].as_str().unwrap_or("");
    let payload = &arr[4];

    // Ignore Phoenix internal events (heartbeat replies, join acks, errors)
    if event.starts_with("phx_") || topic == "phoenix" {
        return;
    }

    let slug = topic.strip_prefix("collection:").unwrap_or(topic);

    // Emit every event to the frontend for real-time monitoring feed
    let stream_event = StreamEvent {
        collection_slug: slug.to_string(),
        event_type: event.to_string(),
        payload: payload.clone(),
        received_at: chrono::Utc::now().to_rfc3339(),
    };
    app.emit("stream-event", &stream_event).ok();

    match event {
        "item_listed"           => on_item_listed(slug, payload, app).await,
        "item_sold"             => on_item_sold(slug, payload, app).await,
        "item_transferred"      => on_item_transferred(slug, payload, app).await,
        "item_metadata_updated" => on_item_metadata_updated(slug, payload, app).await,
        "item_cancelled"        => on_item_cancelled(slug, payload, app).await,
        "item_received_bid"     => on_item_received_bid(slug, payload, app).await,
        "collection_offer"      => on_collection_offer(slug, payload, app).await,
        "trait_offer"           => on_trait_offer(slug, payload, app).await,
        "order_invalidate"      => on_order_invalidate(slug, payload, app).await,
        "order_revalidate"      => on_order_revalidate(slug, payload, app).await,
        _ => {}
    }
}

async fn on_item_listed(slug: &str, payload: &Value, app: &AppHandle) {
    let listed: ItemListedPayload = match serde_json::from_value(payload.clone()) {
        Ok(v) => v,
        Err(_) => return,
    };

    let price_eth = match listed.price_eth() {
        Some(p) => p,
        None => return,
    };

    // --- Floor price alerts ---
    if let Ok(db) = alerts::ensure_db() {
        let engine = AlertEngine::new(db);
        if let Ok(triggered) = engine.check_floor_price_alerts(slug, price_eth) {
            for (rule, message) in triggered {
                engine.fire_alert(&rule, &message, app).await.ok();
            }
        }
    }

    // --- Sniping rules (run on blocking thread to avoid holding async executor) ---
    let slug_owned = slug.to_string();
    let snipe_check = tokio::task::spawn_blocking(move || -> Vec<crate::sniping::types::SnipeRule> {
        let db = match sniping::ensure_db() {
            Ok(p) => p,
            Err(_) => return vec![],
        };
        match snipe_db::list_active_rules(&db) {
            Ok(rules) => rules.into_iter().filter(|r| r.collection_slug == slug_owned).collect(),
            Err(_) => vec![],
        }
    })
    .await;

    if let Ok(matching_rules) = snipe_check {
        for rule in matching_rules {
            if price_eth <= rule.target_price_eth {
                app.emit(
                    "snipe-opportunity",
                    json!({
                        "rule_id": rule.id,
                        "collection_slug": slug,
                        "listing_price_eth": price_eth,
                        "target_price_eth": rule.target_price_eth,
                        "order_hash": listed.order_hash,
                        "maker": listed.maker,
                        "item": listed.item,
                    }),
                )
                .ok();
            }
        }
    }
}

async fn on_item_sold(slug: &str, payload: &Value, app: &AppHandle) {
    let sold: ItemSoldPayload = match serde_json::from_value(payload.clone()) {
        Ok(v) => v,
        Err(_) => return,
    };
    app.emit("stream-sale", json!({ "collection_slug": slug, "payload": sold })).ok();
}

async fn on_item_transferred(slug: &str, payload: &Value, app: &AppHandle) {
    let transferred: ItemTransferredPayload = match serde_json::from_value(payload.clone()) {
        Ok(v) => v,
        Err(_) => return,
    };
    app.emit("stream-transfer", json!({ "collection_slug": slug, "payload": transferred })).ok();
}

async fn on_item_metadata_updated(slug: &str, payload: &Value, app: &AppHandle) {
    let updated: ItemMetadataUpdatedPayload = match serde_json::from_value(payload.clone()) {
        Ok(v) => v,
        Err(_) => return,
    };
    app.emit("stream-metadata-updated", json!({ "collection_slug": slug, "payload": updated })).ok();
}

async fn on_item_cancelled(slug: &str, payload: &Value, app: &AppHandle) {
    let cancelled: ItemCancelledPayload = match serde_json::from_value(payload.clone()) {
        Ok(v) => v,
        Err(_) => return,
    };
    app.emit("stream-cancelled", json!({ "collection_slug": slug, "payload": cancelled })).ok();
}

async fn on_item_received_bid(slug: &str, payload: &Value, app: &AppHandle) {
    let bid: ItemReceivedBidPayload = match serde_json::from_value(payload.clone()) {
        Ok(v) => v,
        Err(_) => return,
    };

    // Check floor price alerts on bid price
    if let Some(price_eth) = bid.price_eth() {
        if let Ok(db) = alerts::ensure_db() {
            let engine = alerts::engine::AlertEngine::new(db);
            if let Ok(triggered) = engine.check_floor_price_alerts(slug, price_eth) {
                for (rule, message) in triggered {
                    engine.fire_alert(&rule, &message, app).await.ok();
                }
            }
        }
    }

    app.emit("stream-bid", json!({ "collection_slug": slug, "payload": bid })).ok();
}

async fn on_collection_offer(slug: &str, payload: &Value, app: &AppHandle) {
    let offer: CollectionOfferPayload = match serde_json::from_value(payload.clone()) {
        Ok(v) => v,
        Err(_) => return,
    };
    app.emit("stream-collection-offer", json!({ "collection_slug": slug, "payload": offer })).ok();
}

async fn on_trait_offer(slug: &str, payload: &Value, app: &AppHandle) {
    let offer: TraitOfferPayload = match serde_json::from_value(payload.clone()) {
        Ok(v) => v,
        Err(_) => return,
    };
    app.emit("stream-trait-offer", json!({ "collection_slug": slug, "payload": offer })).ok();
}

async fn on_order_invalidate(slug: &str, payload: &Value, app: &AppHandle) {
    let invalidate: OrderInvalidatePayload = match serde_json::from_value(payload.clone()) {
        Ok(v) => v,
        Err(_) => return,
    };
    app.emit("stream-order-invalidate", json!({ "collection_slug": slug, "payload": invalidate })).ok();
}

async fn on_order_revalidate(slug: &str, payload: &Value, app: &AppHandle) {
    let revalidate: OrderRevalidatePayload = match serde_json::from_value(payload.clone()) {
        Ok(v) => v,
        Err(_) => return,
    };
    app.emit("stream-order-revalidate", json!({ "collection_slug": slug, "payload": revalidate })).ok();
}
