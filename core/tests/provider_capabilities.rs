//! The capability registry is available through the same headless seam as the UI.
use clipes_core::dispatch;
use serde_json::json;

#[test]
fn registry_is_headless_data_and_context_limits_are_references() {
    let registry = dispatch("provider.capabilities", json!({}), &mut |_| {}).unwrap();
    for kind in [
        "openai",
        "anthropic",
        "gemini",
        "ollama",
        "codex",
        "claude",
        "opencode",
    ] {
        let entry = &registry[kind];
        assert!(entry.is_object(), "missing {kind}");
        assert!(entry["nativeSchema"].is_string());
        assert!(entry["contextSources"]
            .as_array()
            .unwrap()
            .iter()
            .any(|v| v == "model_catalog"));
        assert!(entry.get("maxContextTokens").is_none());
        assert!(entry.get("maxOutputTokens").is_none());
    }
    assert_eq!(
        registry["openai"]["refusalPointer"],
        "/choices/0/message/refusal"
    );
    assert_eq!(registry["ollama"]["nativeSchema"], "ollama_format");
    assert_eq!(registry["codex"]["usage"], serde_json::Value::Null);
    assert_eq!(registry["opencode"]["truncationPointer"], "/part/reason");
}

#[test]
fn model_observations_do_not_invent_context_or_disable_explicit_schema() {
    let measured = dispatch(
        "provider.capabilities",
        json!({"kind":"openai","model":"nvidia/nemotron-3.5-lightning:free"}),
        &mut |_| {},
    )
    .unwrap();
    assert_eq!(measured["nativeSchemaSupport"], "accepted_and_validated");
    assert_eq!(measured["nativeSchema"], "response_format");
    let unknown = dispatch(
        "provider.capabilities",
        json!({"kind":"openai","model":"future-model"}),
        &mut |_| {},
    )
    .unwrap();
    assert_eq!(unknown["nativeSchemaSupport"], "model_dependent");
    assert!(unknown.get("maxContextTokens").is_none());
    assert_eq!(
        dispatch(
            "provider.capabilities",
            json!({"kind":"missing"}),
            &mut |_| {}
        )
        .unwrap_err()
        .code,
        "invalid_settings"
    );
}
