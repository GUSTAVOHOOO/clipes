use crate::{CommandRegistration, CommandResult, EventSink, ProgressEvent};
use serde_json::{json, Value};

fn version(_: Value, events: &mut EventSink<'_>) -> CommandResult {
    events(ProgressEvent {
        job: "app.version".into(),
        stage: "complete".into(),
        percentage: 100,
        message: "Version loaded".into(),
        error: None,
    });
    Ok(json!({ "version": env!("CARGO_PKG_VERSION") }))
}

inventory::submit! { CommandRegistration { name: "app.version", execute: version } }
