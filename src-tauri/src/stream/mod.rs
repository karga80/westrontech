pub mod client;
pub mod types;

pub use types::StreamEvent;

use std::sync::Mutex;
use tauri::AppHandle;
use tokio::sync::watch;

pub struct StreamManager {
    stop_tx: Mutex<Option<watch::Sender<bool>>>,
    subscribed: Mutex<Vec<String>>,
}

impl StreamManager {
    pub fn new() -> Self {
        StreamManager {
            stop_tx: Mutex::new(None),
            subscribed: Mutex::new(Vec::new()),
        }
    }

    /// Start (or restart) the stream for the given collections.
    pub fn start(&self, api_key: String, collections: Vec<String>, app: AppHandle) {
        let mut tx_guard = self.stop_tx.lock().unwrap();
        // Stop any existing task first
        if let Some(tx) = tx_guard.take() {
            tx.send(true).ok();
        }

        *self.subscribed.lock().unwrap() = collections.clone();

        let (tx, rx) = watch::channel(false);
        *tx_guard = Some(tx);
        drop(tx_guard);

        tokio::spawn(client::run(api_key, collections, app, rx));
    }

    pub fn stop(&self) {
        if let Some(tx) = self.stop_tx.lock().unwrap().take() {
            tx.send(true).ok();
        }
        self.subscribed.lock().unwrap().clear();
    }

    pub fn is_running(&self) -> bool {
        self.stop_tx.lock().unwrap().is_some()
    }

    pub fn subscribed_collections(&self) -> Vec<String> {
        self.subscribed.lock().unwrap().clone()
    }
}
