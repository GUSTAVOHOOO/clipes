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

thread_local! {
    static CALL_LIMIT: std::cell::Cell<Option<u64>> = const { std::cell::Cell::new(None) };
}

/// Runs `f` with a ceiling of HTTP calls for the structured request it makes on this thread
/// (the AI job executor sets it, #124). The adapter skips the paid repair call once the
/// calls made reach it. There is no limit outside this scope.
pub(crate) fn with_call_limit<T>(limit: Option<u64>, f: impl FnOnce() -> T) -> T {
    let previous = CALL_LIMIT.replace(limit);
    let result = f();
    CALL_LIMIT.set(previous);
    result
}

pub(crate) fn call_limit() -> Option<u64> {
    CALL_LIMIT.get()
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

/// A configured timeout in seconds: 1 to 3600, or null for the default.
pub(crate) fn parse_seconds(value: &Value) -> Result<Option<u64>, CoreError> {
    match value {
        Value::Null => Ok(None),
        v => v
            .as_u64()
            .filter(|n| (1..=MAX_TIMEOUT_SECS).contains(n))
            .map(Some)
            .ok_or_else(|| error("invalid_settings", "Invalid timeout")),
    }
}

/// The timeout of a subscription CLI (Codex or Claude Code), kept in `provider-cli.json`.
pub(crate) fn cli_timeout(seconds: Option<u64>) -> Duration {
    Duration::from_secs(seconds.unwrap_or(DEFAULT_CLI_TIMEOUT_SECS))
}

/// Optional overrides, in seconds, of the timeout of an API Provider: `remote` for an
/// endpoint over the network, `local` for a loopback endpoint (a local model can be slow).
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Timeouts {
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub remote: Option<u64>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub local: Option<u64>,
}

impl Timeouts {
    /// Reads `{remote?, local?}`; a null or missing field keeps the default.
    pub fn parse(value: &Value) -> Result<Self, CoreError> {
        let object = value
            .as_object()
            .ok_or_else(|| error("invalid_settings", "Invalid timeout"))?;
        let mut timeouts = Self::default();
        for (key, seconds) in object {
            match key.as_str() {
                "remote" => timeouts.remote = parse_seconds(seconds)?,
                "local" => timeouts.local = parse_seconds(seconds)?,
                _ => return Err(error("invalid_settings", "Invalid timeout")),
            }
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
    /// The values in force, for `provider.status`.
    pub fn effective(&self) -> Value {
        json!({"remote":self.endpoint(false).as_secs(),"local":self.endpoint(true).as_secs()})
    }
}
