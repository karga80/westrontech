//! Data types for the sister-wallet finder.

use serde::{Deserialize, Serialize};

// ── Etherscan wire types ──────────────────────────────────────────────────────

#[derive(Debug, Deserialize)]
pub struct EtherscanResp {
    pub status: String,
    pub message: String,
    #[serde(default)]
    pub result: serde_json::Value,
}

impl EtherscanResp {
    /// When `result` is a plain string (error/ratelimit messages), return it.
    pub fn result_message(&self) -> Option<String> {
        self.result.as_str().map(|s| s.to_string())
    }

    /// Parse `result` into the tx array, tolerating the string-error shape.
    pub fn txs(self) -> Vec<EtherscanTx> {
        serde_json::from_value(self.result).unwrap_or_default()
    }
}

#[derive(Debug, Deserialize)]
pub struct EtherscanTx {
    pub from: String,
    #[serde(default)]
    pub to: Option<String>,
    #[serde(default)]
    pub value: Option<String>,
    #[serde(default, rename = "isError")]
    pub is_error: String,
    #[serde(default, rename = "timeStamp")]
    pub time_stamp: String,
}

impl EtherscanTx {
    pub fn timestamp(&self) -> u64 {
        self.time_stamp.parse().unwrap_or(0)
    }
}

// ── Report types (sent to the frontend) ───────────────────────────────────────

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum Reason {
    /// Seeded by the same funding wallet as the target.
    CommonFunder,
    /// This wallet sent ETH to the target (funded it).
    FundedTarget,
    /// The target sent ETH to this wallet.
    TargetFunded,
    /// ETH flowed both ways between this wallet and the target.
    RoundTrip,
}

#[derive(Debug, Clone, Serialize)]
pub struct Candidate {
    pub address: String,
    pub reasons: Vec<Reason>,
    /// # of direct value transfers target → candidate.
    pub direct_out: u32,
    /// # of direct value transfers candidate → target.
    pub direct_in: u32,
    /// Unix seconds of earliest interaction/seed we observed.
    pub first_interaction: Option<u64>,
    /// Unix seconds of latest direct interaction.
    pub last_interaction: Option<u64>,
    /// 0–100 confidence heuristic (higher = stronger link).
    pub score: u32,
}

impl Candidate {
    pub fn new(address: &str) -> Self {
        Self {
            address: address.to_string(),
            reasons: vec![],
            direct_out: 0,
            direct_in: 0,
            first_interaction: None,
            last_interaction: None,
            score: 0,
        }
    }

    pub fn add_reason(&mut self, r: Reason) {
        if !self.reasons.contains(&r) {
            self.reasons.push(r);
        }
    }

    /// Weighted confidence. Round-trip + common-funder is the strongest combo.
    pub fn compute_score(&self) -> u32 {
        let mut s = 0i32;
        for r in &self.reasons {
            s += match r {
                Reason::CommonFunder => 45,
                Reason::RoundTrip => 35,
                Reason::FundedTarget => 20,
                Reason::TargetFunded => 15,
            };
        }
        // Repeated direct interaction adds a little, capped.
        s += ((self.direct_in + self.direct_out).min(10) as i32) * 2;
        s.clamp(0, 100) as u32
    }
}

#[derive(Debug, Clone, Serialize)]
pub struct SisterReport {
    pub target: String,
    /// The wallet that first funded the target, if identifiable.
    pub funder: Option<String>,
    pub candidates: Vec<Candidate>,
    /// Optional human-readable caveat (e.g. funder was an exchange).
    pub note: Option<String>,
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn common_funder_plus_roundtrip_scores_high() {
        let mut c = Candidate::new("0xabc");
        c.direct_in = 3;
        c.direct_out = 2;
        c.add_reason(Reason::CommonFunder);
        c.add_reason(Reason::RoundTrip);
        c.add_reason(Reason::FundedTarget);
        c.add_reason(Reason::TargetFunded);
        // 45 + 35 + 20 + 15 = 115, + min(5,10)*2=10 -> clamps to 100
        assert_eq!(c.compute_score(), 100);
    }

    #[test]
    fn single_weak_signal_scores_low() {
        let mut c = Candidate::new("0xdef");
        c.direct_out = 1;
        c.add_reason(Reason::TargetFunded);
        // 15 + min(1,10)*2 = 17
        assert_eq!(c.compute_score(), 17);
    }

    #[test]
    fn add_reason_dedupes() {
        let mut c = Candidate::new("0x1");
        c.add_reason(Reason::CommonFunder);
        c.add_reason(Reason::CommonFunder);
        assert_eq!(c.reasons.len(), 1);
    }
}
