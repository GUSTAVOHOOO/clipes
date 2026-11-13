use clipes_core::{dispatch, ProgressEvent};
use serde_json::json;

#[test]
fn version_command_uses_shared_dispatch_and_emits_progress() {
    let mut events: Vec<ProgressEvent> = Vec::new();
    let result = dispatch("app.version", json!({}), &mut |event| events.push(event)).unwrap();
    assert_eq!(result, json!({"version": env!("CARGO_PKG_VERSION")}));
    assert_eq!(events.len(), 1);
    assert_eq!(events[0].stage, "complete");
    assert_eq!(events[0].percentage, 100);
}

#[test]
fn unknown_command_returns_a_typed_error() {
    let error = dispatch("missing", json!({}), &mut |_| {}).unwrap_err();
    assert_eq!(error.code, "unknown_command");
}
