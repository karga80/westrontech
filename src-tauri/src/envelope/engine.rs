use std::sync::Mutex;
use chrono::Utc;
use uuid::Uuid;
use serde::{Deserialize, Serialize};
use crate::envelope::types::*;
use crate::envelope::audit::AuditLog;

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

pub struct EnvelopeEngine {
    pub envelope: Mutex<Option<Envelope>>,
    pub audit: AuditLog,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct EnvelopeStatus {
    pub active: bool,
    pub kill_switch: bool,
    #[serde(with = "u128_as_string")]
    pub spent_wei: u128,
    #[serde(with = "u128_as_string")]
    pub hard_cap_wei: u128,
    pub expires_at: i64,
}

impl EnvelopeEngine {
    pub fn new() -> Self {
        EnvelopeEngine {
            envelope: Mutex::new(None),
            audit: AuditLog::new(),
        }
    }

    pub fn create_envelope(&self, env: Envelope) {
        let entry = AuditEntry {
            id: Uuid::new_v4(),
            timestamp: Utc::now().timestamp_millis(),
            envelope_id: env.id,
            event_type: AuditEvent::EnvelopeCreated,
            tx_to: None,
            value_wei: None,
            reject_reason: None,
            spent_wei_snapshot: 0,
        };
        let _ = self.audit.write_entry(&entry);
        *self.envelope.lock().unwrap() = Some(env);
    }

    pub fn check_and_authorize(&self, request: &TransactionRequest) -> Result<(), EnvelopeError> {
        let mut guard = self.envelope.lock().unwrap();
        let env = guard.as_mut().ok_or(EnvelopeError::NoScopeDefined)?;

        let now = Utc::now().timestamp();

        if env.kill_switch_active {
            self.log_reject(env, AuditEvent::KillSwitchBlocked, request, "kill_switch");
            return Err(EnvelopeError::KillSwitchActive);
        }

        if now >= env.expires_at {
            self.log_reject(env, AuditEvent::EnvelopeExpired, request, "expired");
            return Err(EnvelopeError::EnvelopeExpired { expired_at: env.expires_at });
        }

        if env.scope.is_empty() {
            return Err(EnvelopeError::NoScopeDefined);
        }

        let to_lower = request.to.to_lowercase();
        if !env.scope.iter().any(|a| a.to_lowercase() == to_lower) {
            self.log_reject(env, AuditEvent::ScopeViolation, request, "out_of_scope");
            return Err(EnvelopeError::AddressOutOfScope { requested: request.to.clone() });
        }

        if request.value_wei > env.per_tx_ceiling_wei {
            self.log_reject(env, AuditEvent::PerTxCeilingViolation, request, "per_tx_ceiling");
            return Err(EnvelopeError::PerTxCeilingExceeded {
                requested_wei: request.value_wei,
                ceiling_wei: env.per_tx_ceiling_wei,
            });
        }

        let new_spent = env.spent_wei.checked_add(request.value_wei).unwrap_or(u128::MAX);
        if new_spent > env.hard_cap_wei {
            // E4-B: Otomatik kill switch
            env.kill_switch_active = true;
            self.log_reject(env, AuditEvent::HardCapViolation, request, "hard_cap");
            let kill_entry = AuditEntry {
                id: Uuid::new_v4(),
                timestamp: Utc::now().timestamp_millis(),
                envelope_id: env.id,
                event_type: AuditEvent::KillSwitchActivated,
                tx_to: None, value_wei: None, reject_reason: None,
                spent_wei_snapshot: env.spent_wei,
            };
            let _ = self.audit.write_entry(&kill_entry);
            return Err(EnvelopeError::HardCapExceeded {
                remaining_wei: env.hard_cap_wei.saturating_sub(env.spent_wei),
                requested_wei: request.value_wei,
            });
        }

        env.spent_wei = new_spent;
        let entry = AuditEntry {
            id: Uuid::new_v4(),
            timestamp: Utc::now().timestamp_millis(),
            envelope_id: env.id,
            event_type: AuditEvent::TxAuthorized,
            tx_to: Some(request.to.clone()),
            value_wei: Some(request.value_wei),
            reject_reason: None,
            spent_wei_snapshot: env.spent_wei,
        };
        let _ = self.audit.write_entry(&entry);
        Ok(())
    }

    pub fn activate_kill_switch(&self) {
        let mut guard = self.envelope.lock().unwrap();
        if let Some(env) = guard.as_mut() {
            env.kill_switch_active = true;
            let entry = AuditEntry {
                id: Uuid::new_v4(),
                timestamp: Utc::now().timestamp_millis(),
                envelope_id: env.id,
                event_type: AuditEvent::KillSwitchActivated,
                tx_to: None, value_wei: None, reject_reason: None,
                spent_wei_snapshot: env.spent_wei,
            };
            let _ = self.audit.write_entry(&entry);
        }
    }

    pub fn deactivate_kill_switch(&self) {
        let mut guard = self.envelope.lock().unwrap();
        if let Some(env) = guard.as_mut() {
            env.kill_switch_active = false;
            let entry = AuditEntry {
                id: Uuid::new_v4(),
                timestamp: Utc::now().timestamp_millis(),
                envelope_id: env.id,
                event_type: AuditEvent::KillSwitchDeactivated,
                tx_to: None, value_wei: None, reject_reason: None,
                spent_wei_snapshot: env.spent_wei,
            };
            let _ = self.audit.write_entry(&entry);
        }
    }

    pub fn revoke(&self) {
        let mut guard = self.envelope.lock().unwrap();
        if let Some(env) = guard.as_ref() {
            let entry = AuditEntry {
                id: Uuid::new_v4(),
                timestamp: Utc::now().timestamp_millis(),
                envelope_id: env.id,
                event_type: AuditEvent::EnvelopeRevoked,
                tx_to: None, value_wei: None, reject_reason: None,
                spent_wei_snapshot: env.spent_wei,
            };
            let _ = self.audit.write_entry(&entry);
        }
        *guard = None;
    }

    pub fn get_status(&self) -> Option<EnvelopeStatus> {
        let guard = self.envelope.lock().unwrap();
        guard.as_ref().map(|env| EnvelopeStatus {
            active: true,
            kill_switch: env.kill_switch_active,
            spent_wei: env.spent_wei,
            hard_cap_wei: env.hard_cap_wei,
            expires_at: env.expires_at,
        })
    }

    fn log_reject(&self, env: &Envelope, event: AuditEvent, req: &TransactionRequest, reason: &str) {
        let entry = AuditEntry {
            id: Uuid::new_v4(),
            timestamp: Utc::now().timestamp_millis(),
            envelope_id: env.id,
            event_type: event,
            tx_to: Some(req.to.clone()),
            value_wei: Some(req.value_wei),
            reject_reason: Some(reason.to_string()),
            spent_wei_snapshot: env.spent_wei,
        };
        let _ = self.audit.write_entry(&entry);
    }
}
