use serde::{Deserialize, Serialize};
use uuid::Uuid;

mod u128_as_string {
    use serde::{Deserialize, Deserializer, Serializer};
    pub fn serialize<S: Serializer>(v: &u128, s: S) -> Result<S::Ok, S::Error> {
        s.serialize_str(&v.to_string())
    }
    pub fn deserialize<'de, D: Deserializer<'de>>(d: D) -> Result<u128, D::Error> {
        let s = String::deserialize(d)?;
        s.parse().map_err(serde::de::Error::custom)
    }
}

mod option_u128_as_string {
    use serde::{Deserialize, Deserializer, Serializer};
    pub fn serialize<S: Serializer>(v: &Option<u128>, s: S) -> Result<S::Ok, S::Error> {
        match v {
            Some(n) => s.serialize_some(&n.to_string()),
            None => s.serialize_none(),
        }
    }
    pub fn deserialize<'de, D: Deserializer<'de>>(d: D) -> Result<Option<u128>, D::Error> {
        let opt = Option::<String>::deserialize(d)?;
        match opt {
            Some(s) => s.parse().map(Some).map_err(serde::de::Error::custom),
            None => Ok(None),
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Envelope {
    pub id: Uuid,
    pub created_at: i64,
    pub expires_at: i64,
    #[serde(with = "u128_as_string")]
    pub per_tx_ceiling_wei: u128,
    #[serde(with = "u128_as_string")]
    pub hard_cap_wei: u128,
    #[serde(with = "u128_as_string")]
    pub spent_wei: u128,
    pub scope: Vec<String>,
    pub kill_switch_active: bool,
}

#[derive(Debug, Serialize, Deserialize)]
pub enum EnvelopeError {
    KillSwitchActive,
    EnvelopeExpired { expired_at: i64 },
    NoScopeDefined,
    AddressOutOfScope { requested: String },
    PerTxCeilingExceeded {
        #[serde(with = "u128_as_string")]
        requested_wei: u128,
        #[serde(with = "u128_as_string")]
        ceiling_wei: u128,
    },
    HardCapExceeded {
        #[serde(with = "u128_as_string")]
        remaining_wei: u128,
        #[serde(with = "u128_as_string")]
        requested_wei: u128,
    },
    KeychainError { reason: String },
    SigningError { reason: String },
}

impl std::fmt::Display for EnvelopeError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        write!(f, "{:?}", self)
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub enum AuditEvent {
    EnvelopeCreated,
    EnvelopeExpired,
    EnvelopeRevoked,
    TxAuthorized,
    KillSwitchBlocked,
    KillSwitchActivated,
    KillSwitchDeactivated,
    ScopeViolation,
    PerTxCeilingViolation,
    HardCapViolation,
    /// A prior `TxAuthorized` spend was reversed because the transaction it
    /// authorised never reached the chain (broadcast failed after the budget
    /// was consumed). See `EnvelopeEngine::rollback_authorization`.
    TxAuthorizationRolledBack,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AuditEntry {
    pub id: Uuid,
    pub timestamp: i64,
    pub envelope_id: Uuid,
    pub event_type: AuditEvent,
    pub tx_to: Option<String>,
    #[serde(with = "option_u128_as_string")]
    pub value_wei: Option<u128>,
    pub reject_reason: Option<String>,
    #[serde(with = "u128_as_string")]
    pub spent_wei_snapshot: u128,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TransactionRequest {
    pub to: String,
    #[serde(with = "u128_as_string")]
    pub value_wei: u128,
    pub calldata: String,
}
