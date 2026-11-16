use serde::{Deserialize, Serialize};
use serde_json::Value;

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct CoreError {
    pub code: String,
    pub message: String,
    #[serde(skip_serializing_if = "Option::is_none", default)]
    pub usage: Option<serde_json::Value>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct ProgressEvent {
    pub job: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub project: Option<String>,
    pub stage: String,
    pub percentage: u8,
    pub message: String,
    pub error: Option<CoreError>,
}

type SharedEmitter = std::sync::Arc<dyn Fn(ProgressEvent) + Send + Sync>;
static EVENT_EMITTER: std::sync::OnceLock<SharedEmitter> = std::sync::OnceLock::new();

/// Installs the event receiver for background jobs once, at application startup.
pub fn set_event_emitter(emitter: SharedEmitter) -> Result<(), SharedEmitter> {
    EVENT_EMITTER.set(emitter)
}

pub(crate) fn emit_background(event: ProgressEvent) {
    if let Some(emitter) = EVENT_EMITTER.get() {
        emitter(event);
    }
}

pub type EventSink<'a> = dyn FnMut(ProgressEvent) + 'a;
pub type CommandResult = Result<Value, CoreError>;
pub struct CommandRegistration {
    pub name: &'static str,
    pub execute: fn(Value, &mut EventSink<'_>) -> CommandResult,
}
inventory::collect!(CommandRegistration);

pub fn dispatch(name: &str, arguments: Value, events: &mut EventSink<'_>) -> CommandResult {
    match inventory::iter::<CommandRegistration>
        .into_iter()
        .find(|command| command.name == name)
    {
        Some(command) => (command.execute)(arguments, events),
        None => Err(CoreError {
            code: "unknown_command".into(),
            message: format!("Unknown command: {name}"),
            usage: None,
        }),
    }
}

pub mod ai_task;
mod assistant;
mod audit;
mod components;
mod context_notice;
pub mod corrections;
pub mod editor;
pub mod energy;
pub mod export;
pub mod jobs;
pub mod media;
pub mod packaging;
pub mod process;
pub mod projects;
pub mod provider;
mod provider_cli;
mod proxy;
pub mod reframe;
pub mod selection;
pub mod selection_windows;
pub mod sentences;
mod source_batches;
mod sources;
pub mod thumbnail;
pub mod transcription;
mod url_import;
mod version;
pub mod worker;

pub mod diagnostic;

/// Serializes the unit tests that set or read `CLIPES_DATA_DIR` (#188): a test that points the
/// variable at its temporary directory must not leak it to another test that reads it.
#[cfg(test)]
pub(crate) mod test_env {
    use std::{
        ffi::OsString,
        path::Path,
        sync::{Mutex, MutexGuard},
    };

    static LOCK: Mutex<()> = Mutex::new(());

    /// Takes the lock for a test that reads `CLIPES_DATA_DIR` without changing it.
    pub(crate) fn lock() -> MutexGuard<'static, ()> {
        LOCK.lock().unwrap_or_else(|e| e.into_inner())
    }

    /// Points `CLIPES_DATA_DIR` at `dir` until the guard is dropped, then restores the previous value.
    pub(crate) fn set_data_dir(dir: &Path) -> DataDirGuard {
        let lock = lock();
        let previous = std::env::var_os("CLIPES_DATA_DIR");
        std::env::set_var("CLIPES_DATA_DIR", dir);
        DataDirGuard {
            _lock: lock,
            previous,
        }
    }

    /// Holds the lock and restores `CLIPES_DATA_DIR` on drop, including during a panic.
    pub(crate) struct DataDirGuard {
        _lock: MutexGuard<'static, ()>,
        previous: Option<OsString>,
    }

    impl Drop for DataDirGuard {
        fn drop(&mut self) {
            match self.previous.take() {
                Some(value) => std::env::set_var("CLIPES_DATA_DIR", value),
                None => std::env::remove_var("CLIPES_DATA_DIR"),
            }
        }
    }
}
