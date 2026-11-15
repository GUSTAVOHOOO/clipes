use clipes_core::provider::{cost, StructuredRequest};
use serde_json::json;
fn request(transcript: &str, max: Option<u64>) -> StructuredRequest {
    StructuredRequest {
        instruction: "x".repeat(40),
        transcript: transcript.into(),
        schema: json!({"type":"object"}),
        native_schema: false,
        max_output_tokens: max,
        estimate_hint: Default::default(),
    }
}

#[test]
fn token_estimates_have_conservative_ranges_and_are_profile_specific() {
    let root = std::env::temp_dir().join(format!("clipes-estimator-{}", std::process::id()));
    std::fs::create_dir_all(&root).unwrap();
    std::env::set_var("CLIPES_DATA_DIR", &root);
    let legacy = br#"{"endpoint":"http://localhost","model":"legacy"}"#;
    std::fs::write(root.join("provider.json"), legacy).unwrap();
    let r = request(&"a".repeat(1000), Some(100));
    let before = cost::token_range("first", "model", &r).unwrap();
    assert!(before.low < before.high);
    cost::observe_tokens("first", "model", &r, 600, "ok").unwrap();
    assert_eq!(std::fs::read(root.join("provider.json")).unwrap(), legacy);
    let after = cost::token_range("first", "model", &r).unwrap();
    assert!(after.high > before.high);
    assert_eq!(cost::token_range("second", "model", &r).unwrap(), before);
    cost::observe_tokens("first", "model", &r, 1, "output_truncated").unwrap();
    assert_eq!(cost::token_range("first", "model", &r).unwrap(), after);

    // Exercise retention and isolation in the same process-global settings test.
    let root = std::env::temp_dir().join(format!("clipes-calibration-{}", std::process::id()));
    std::fs::create_dir_all(&root).unwrap();
    std::env::set_var("CLIPES_DATA_DIR", &root);
    let mut r = request(&"z".repeat(1000), None);
    let chars = cost::input_characters(&r);
    for _ in 0..21 {
        cost::observe_tokens("p", "m", &r, chars / 2, "ok").unwrap();
    }
    let before = cost::token_range("p", "m", &r).unwrap();
    let priced = cost::Target::Api {
        provider: "anthropic".into(),
        model: "claude-haiku-5-5".into(),
        local: false,
    };
    for _ in 0..3 {
        cost::observe_tokens("p", "claude-haiku-5-5", &r, chars / 2, "ok").unwrap();
    }
    let calibrated = cost::token_range("p", "claude-haiku-5-5", &r).unwrap();
    let estimate = cost::estimate_for(&priced, "p", &r).unwrap();
    assert_eq!(estimate["inputTokensRange"]["min"], calibrated.low);
    assert_eq!(estimate["inputTokensRange"]["max"], calibrated.high);
    assert_eq!(estimate["inputTokens"], calibrated.high);

    cost::observe_tokens("p", "m", &r, 1, "ok").unwrap();
    cost::observe_tokens("p", "m", &r, chars, "output_truncated").unwrap();
    assert_eq!(cost::token_range("p", "m", &r).unwrap(), before);
    assert_ne!(cost::token_range("p", "other", &r).unwrap(), before);
    r.estimate_hint.language = "en".into();
    assert_ne!(cost::token_range("p", "m", &r).unwrap(), before);
    let settings: serde_json::Value =
        serde_json::from_slice(&std::fs::read(root.join("token-calibration.json")).unwrap())
            .unwrap();
    assert_eq!(settings["version"], 1);
    assert_eq!(
        settings["entries"][0]["samples"].as_array().unwrap().len(),
        20
    );
    // Bad internal metadata must use the uncalibrated generic range, never learn or leak.
    let snapshot = std::fs::read(root.join("token-calibration.json")).unwrap();
    for bad in ["haw", "private-invalid-value"] {
        let mut invalid = r.clone();
        invalid.estimate_hint.language = bad.into();
        let mut generic = invalid.clone();
        generic.estimate_hint = Default::default();
        let expected = cost::token_range("unobserved", "m", &generic).unwrap();
        assert_eq!(cost::token_range("p", "m", &invalid).unwrap(), expected);
        cost::observe_tokens("p", "m", &invalid, chars / 2, "ok").unwrap();
        let target = cost::Target::Api {
            provider: "openai".into(),
            model: "m".into(),
            local: true,
        };
        let estimate = cost::estimate_for(&target, "p", &invalid).unwrap();
        cost::observe_entry(
            "p",
            &target,
            &json!({"code":"ok","usage":{"inputTokens":chars / 2},"estimate":estimate}),
        )
        .unwrap();
        assert_eq!(
            std::fs::read(root.join("token-calibration.json")).unwrap(),
            snapshot
        );
    }
    let diagnostic = clipes_core::dispatch("diagnostic.get", json!({}), &mut |_| {})
        .unwrap()
        .to_string();
    assert!(diagnostic.contains("Metadados de estimativa inválidos"));
    assert!(!diagnostic.contains("private-invalid-value"));
    let path = root.join("token-calibration.json");
    std::fs::write(&path, b"invalid").unwrap();
    let no_calibration = cost::token_range("p", "m", &r).unwrap();
    cost::observe_tokens("p", "m", &r, chars / 2, "ok").unwrap();
    assert_eq!(std::fs::read(&path).unwrap(), b"invalid");
    assert_eq!(cost::token_range("p", "m", &r).unwrap(), no_calibration);
    let invalid_numbers = json!({"version":1,"entries":[{"profile":"p","model":"m","format":"generic","language":"en","samples":[[u64::MAX,1],[1,1]]}]}).to_string();
    std::fs::write(&path, &invalid_numbers).unwrap();
    assert_eq!(cost::token_range("p", "m", &r).unwrap(), no_calibration);
    cost::observe_tokens("p", "m", &r, chars / 2, "ok").unwrap();
    assert_eq!(std::fs::read_to_string(&path).unwrap(), invalid_numbers);
}
