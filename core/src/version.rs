use crate::{CommandRegistration, CommandResult, EventSink, ProgressEvent};
use serde_json::{json, Value};

fn version(_: Value, events: &mut EventSink<'_>) -> CommandResult {
    events(ProgressEvent {
        project: None,
        clip_id: None,
        job: "app.version".into(),
        stage: "complete".into(),
        percentage: 100,
        message: "Version loaded".into(),
        error: None,
    });
    Ok(json!({ "version": env!("CARGO_PKG_VERSION") }))
}

fn platform(_: Value, _: &mut EventSink<'_>) -> CommandResult {
    Ok(json!({ "os": std::env::consts::OS }))
}

inventory::submit! { CommandRegistration { name: "app.version", execute: version } }
inventory::submit! { CommandRegistration { name: "app.platform", execute: platform } }
