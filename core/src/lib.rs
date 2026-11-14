use serde::{Deserialize, Serialize};
use serde_json::Value;

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct CoreError {
    pub code: String,
    pub message: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct ProgressEvent {
    pub job: String,
    pub stage: String,
    pub percentage: u8,
    pub message: String,
    pub error: Option<CoreError>,
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
        }),
    }
}

mod components;
pub mod jobs;
pub mod process;
pub mod projects;
pub mod provider;
mod sources;
mod url_import;
mod version;
