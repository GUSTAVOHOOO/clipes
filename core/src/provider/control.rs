//! Cancellation token and per-kind timeouts shared by the Provider adapters.
use super::*;
use std::sync::{
    atomic::{AtomicBool, Ordering},
    Arc,
};

/// Asks a running Provider call to stop. Clones share the same flag, so the AI job
/// executor (#121) can hand one clone to `Provider::structured_with` and keep the other
/// to cancel it. The default token is never cancelled.
#[derive(Clone, Default)]
pub struct CancelToken(Arc<AtomicBool>);

impl CancelToken {
    pub fn new() -> Self {
        Self::default()
    }
    pub fn cancel(&self) {
        self.0.store(true, Ordering::SeqCst);
    }
    pub fn is_cancelled(&self) -> bool {
        self.0.load(Ordering::SeqCst)
    }
}

pub(crate) const CANCEL_POLL: Duration = Duration::from_millis(25);

pub(crate) fn cancelled() -> CoreError {
    error("cancelled", "Provider call cancelled")
}

/// Sleeps in short slices so a cancellation is seen within `CANCEL_POLL`.
pub(crate) fn sleep(total: Duration, cancel: &CancelToken) -> Result<(), CoreError> {
    let deadline = std::time::Instant::now() + total;
    loop {
        if cancel.is_cancelled() {
            return Err(cancelled());
        }
        let left = deadline.saturating_duration_since(std::time::Instant::now());
        if left.is_zero() {
            return Ok(());
        }
        std::thread::sleep(left.min(CANCEL_POLL));
    }
}

pub const DEFAULT_REMOTE_TIMEOUT_SECS: u64 = 60;
pub const DEFAULT_LOCAL_TIMEOUT_SECS: u64 = 300;
pub const DEFAULT_CLI_TIMEOUT_SECS: u64 = 300;
const MAX_TIMEOUT_SECS: u64 = 3600;

/// Optional overrides, in seconds, of the timeout per Provider kind: `remote` (API over
/// the network), `local` (loopback endpoint) and `cli` (Codex or Claude Code).
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Timeouts {
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub remote: Option<u64>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub local: Option<u64>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub cli: Option<u64>,
}

impl Timeouts {
    /// Reads `{remote?, local?, cli?}` (seconds, 1 to 3600; null keeps the default).
    pub fn parse(value: &Value) -> Result<Self, CoreError> {
        let invalid = || error("invalid_settings", "Invalid timeout");
        let object = value.as_object().ok_or_else(invalid)?;
        let mut timeouts = Self::default();
        for (key, seconds) in object {
            let slot = match key.as_str() {
                "remote" => &mut timeouts.remote,
                "local" => &mut timeouts.local,
                "cli" => &mut timeouts.cli,
                _ => return Err(invalid()),
            };
            *slot = match seconds {
                Value::Null => None,
                v => Some(
                    v.as_u64()
                        .filter(|n| (1..=MAX_TIMEOUT_SECS).contains(n))
                        .ok_or_else(invalid)?,
                ),
            };
        }
        Ok(timeouts)
    }
    pub fn endpoint(&self, local: bool) -> Duration {
        Duration::from_secs(if local {
            self.local.unwrap_or(DEFAULT_LOCAL_TIMEOUT_SECS)
        } else {
            self.remote.unwrap_or(DEFAULT_REMOTE_TIMEOUT_SECS)
        })
    }
    pub fn cli(&self) -> Duration {
        Duration::from_secs(self.cli.unwrap_or(DEFAULT_CLI_TIMEOUT_SECS))
    }
    /// The values in force, for `provider.status`.
    pub fn effective(&self) -> Value {
        json!({"remote":self.endpoint(false).as_secs(),"local":self.endpoint(true).as_secs(),"cli":self.cli().as_secs()})
    }
}
