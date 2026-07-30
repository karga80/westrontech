//! Sister-wallet finder.
//!
//! Given one Ethereum address, discovers likely "side" wallets belonging to the
//! same person, using ONLY public Etherscan (v2, Ethereum mainnet) data.
//!
//! Heuristics (all on-chain, no off-chain data leaves the machine):
//!   1. Common funder     — the wallet that first funded the target, and every
//!                          other wallet that same funder also seeded. Strongest
//!                          signal for "same owner", UNLESS the funder is an
//!                          exchange/contract (filtered out — see is_probable_hub).
//!   2. Direct transfers  — wallets that exchanged ETH directly with the target,
//!                          especially round-trips (in AND out).
//!   3. Downstream funding— wallets the target itself first-funded.
//!
//! Each candidate is returned with the reasons it matched and a confidence score
//! so the UI can rank and explain results. Nothing here is definitive proof of
//! common ownership; it is a lead-generation tool.

pub mod types;

use std::collections::HashMap;
use std::time::Duration;

use reqwest::Client;
use types::*;

const ETHERSCAN_V2: &str = "https://api.etherscan.io/v2/api";
const CHAIN_ID: &str = "1"; // Ethereum mainnet only — Westron is single-chain v1.

/// If a funder has seeded more than this many distinct wallets in the scanned
/// window, we treat it as an exchange / bridge / disperser hub, not a person,
/// and drop the "common funder" signal for it.
const HUB_FUNDING_THRESHOLD: usize = 40;

/// How many normal txs to pull per address (Etherscan returns newest/oldest first
/// depending on sort; we use asc to find the earliest funding tx cheaply).
const TX_PAGE_SIZE: usize = 1000;

struct EtherscanClient {
    http: Client,
    api_key: String,
}

impl EtherscanClient {
    fn new(api_key: &str) -> Self {
        let http = Client::builder()
            .timeout(Duration::from_secs(30))
            .user_agent("westron-desktop/0.2")
            .build()
            .expect("reqwest client build");
        Self { http, api_key: api_key.to_string() }
    }

    /// Fetch normal (external) transactions for `address`, ascending by block.
    async fn txlist(&self, address: &str) -> Result<Vec<EtherscanTx>, String> {
        let url = format!(
            "{ETHERSCAN_V2}?chainid={CHAIN_ID}&module=account&action=txlist\
             &address={address}&startblock=0&endblock=99999999\
             &page=1&offset={TX_PAGE_SIZE}&sort=asc&apikey={key}",
            key = self.api_key
        );

        let resp = self
            .http
            .get(&url)
            .send()
            .await
            .map_err(|e| format!("Etherscan request failed: {e}"))?;

        if resp.status().as_u16() == 429 {
            return Err("Etherscan rate limit reached — wait a moment and retry".to_string());
        }

        let body: EtherscanResp = resp
            .json()
            .await
            .map_err(|e| format!("Etherscan returned an unreadable response: {e}"))?;

        // status "0" with "No transactions found" is a valid empty result, not an error.
        if body.status == "0" {
            let msg = body.message.to_lowercase();
            if msg.contains("no transactions") || msg.contains("no records") {
                return Ok(vec![]);
            }
            // Rate-limit / invalid-key style messages come back as status 0 too.
            let detail = body
                .result_message()
                .unwrap_or_else(|| body.message.clone());
            return Err(format!("Etherscan: {detail}"));
        }

        Ok(body.txs())
    }
}

fn norm(addr: &str) -> String {
    addr.trim().to_lowercase()
}

/// Is this a real ETH-value external transfer (not a 0-value contract call)?
fn is_value_transfer(tx: &EtherscanTx) -> bool {
    tx.is_error != "1" && tx.value.as_deref().map(|v| v != "0").unwrap_or(false)
}

/// Public entry point.
pub async fn find_sisters(target: &str, api_key: &str) -> Result<SisterReport, String> {
    if api_key.trim().is_empty() {
        return Err("Etherscan API key not set — add it in Settings first.".to_string());
    }
    let target = norm(target);
    if !(target.starts_with("0x") && target.len() == 42) {
        return Err("Please enter a valid Ethereum address (0x… , 42 characters).".to_string());
    }

    let client = EtherscanClient::new(api_key);

    // 1) Pull the target's own tx history.
    let target_txs = client.txlist(&target).await?;
    if target_txs.is_empty() {
        return Ok(SisterReport {
            target: target.clone(),
            funder: None,
            candidates: vec![],
            note: Some("No mainnet transactions found for this address.".to_string()),
        });
    }

    // Accumulator: candidate address -> evidence.
    let mut cand: HashMap<String, Candidate> = HashMap::new();

    // --- Heuristic 2 & 3: direct counterparties -------------------------------
    // Track ETH sent-to and received-from, per counterparty.
    let mut sent_to: HashMap<String, u32> = HashMap::new();
    let mut recv_from: HashMap<String, u32> = HashMap::new();
    let mut first_seen: HashMap<String, u64> = HashMap::new();
    let mut last_seen: HashMap<String, u64> = HashMap::new();

    for tx in &target_txs {
        if !is_value_transfer(tx) {
            continue;
        }
        let from = norm(&tx.from);
        let to = tx.to.as_deref().map(norm).unwrap_or_default();
        let ts = tx.timestamp();

        if from == target && !to.is_empty() && to != target {
            *sent_to.entry(to.clone()).or_default() += 1;
            touch(&mut first_seen, &mut last_seen, &to, ts);
        } else if to == target && from != target {
            *recv_from.entry(from.clone()).or_default() += 1;
            touch(&mut first_seen, &mut last_seen, &from, ts);
        }
    }

    // --- Heuristic 1: the funder (first inbound value transfer) ----------------
    let funder = target_txs
        .iter()
        .filter(|t| is_value_transfer(t))
        .find(|t| t.to.as_deref().map(norm).as_deref() == Some(target.as_str()) && norm(&t.from) != target)
        .map(|t| norm(&t.from));

    // Record direct counterparties as candidates.
    for (addr, n) in &sent_to {
        let c = cand.entry(addr.clone()).or_insert_with(|| Candidate::new(addr));
        c.direct_out = *n;
        c.add_reason(Reason::TargetFunded);
    }
    for (addr, n) in &recv_from {
        let c = cand.entry(addr.clone()).or_insert_with(|| Candidate::new(addr));
        c.direct_in = *n;
        c.add_reason(Reason::FundedTarget);
    }
    // Round-trip flag (both directions) is the strongest direct signal.
    for c in cand.values_mut() {
        if c.direct_in > 0 && c.direct_out > 0 {
            c.add_reason(Reason::RoundTrip);
        }
        if let Some(f) = first_seen.get(&c.address) {
            c.first_interaction = Some(*f);
        }
        if let Some(l) = last_seen.get(&c.address) {
            c.last_interaction = Some(*l);
        }
    }

    // --- Heuristic 1 continued: siblings via common funder ---------------------
    let mut funder_is_hub = false;
    if let Some(funder_addr) = &funder {
        let funder_txs = client.txlist(funder_addr).await?;
        // Everyone this funder sent ETH to (its "seed" recipients).
        let mut seeded: HashMap<String, u64> = HashMap::new();
        for tx in &funder_txs {
            if !is_value_transfer(tx) {
                continue;
            }
            if norm(&tx.from) == *funder_addr {
                if let Some(to) = tx.to.as_deref().map(norm) {
                    if to != *funder_addr && to != target {
                        seeded.entry(to).or_insert_with(|| tx.timestamp());
                    }
                }
            }
        }

        if seeded.len() > HUB_FUNDING_THRESHOLD {
            // Funder looks like an exchange/bridge/disperser — drop this signal.
            funder_is_hub = true;
        } else {
            for (addr, ts) in seeded {
                let c = cand.entry(addr.clone()).or_insert_with(|| Candidate::new(&addr));
                c.add_reason(Reason::CommonFunder);
                c.first_interaction.get_or_insert(ts);
            }
        }
    }

    // --- Score & rank ----------------------------------------------------------
    let mut candidates: Vec<Candidate> = cand.into_values().collect();
    for c in &mut candidates {
        c.score = c.compute_score();
    }
    // Drop the funder itself and the target from the candidate list; the funder is
    // reported separately.
    candidates.retain(|c| {
        Some(&c.address) != funder.as_ref() && c.address != target && c.score > 0
    });
    candidates.sort_by(|a, b| b.score.cmp(&a.score).then(b.direct_in.cmp(&a.direct_in)));
    candidates.truncate(50);

    let note = if funder_is_hub {
        Some(
            "The wallet that first funded this address looks like an exchange or bridge, \
             so 'same funder' matches were skipped to avoid false positives. Results below \
             are based on direct transfers only."
                .to_string(),
        )
    } else {
        None
    };

    Ok(SisterReport {
        target,
        funder,
        candidates,
        note,
    })
}

fn touch(
    first: &mut HashMap<String, u64>,
    last: &mut HashMap<String, u64>,
    addr: &str,
    ts: u64,
) {
    first
        .entry(addr.to_string())
        .and_modify(|v| {
            if ts < *v {
                *v = ts;
            }
        })
        .or_insert(ts);
    last.entry(addr.to_string())
        .and_modify(|v| {
            if ts > *v {
                *v = ts;
            }
        })
        .or_insert(ts);
}
