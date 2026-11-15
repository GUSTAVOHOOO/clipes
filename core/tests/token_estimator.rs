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
    let r = request(&"a".repeat(1000), Some(100));
    let before = cost::token_range("first", "model", &r).unwrap();
    assert!(before.low < before.high);
    cost::observe_tokens("first", "model", &r, 600, "ok").unwrap();
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
    cost::observe_tokens("p", "m", &r, 1, "ok").unwrap();
    cost::observe_tokens("p", "m", &r, chars, "output_truncated").unwrap();
    assert_eq!(cost::token_range("p", "m", &r).unwrap(), before);
    assert_ne!(cost::token_range("p", "other", &r).unwrap(), before);
    r.estimate_hint.language = "en".into();
    assert_ne!(cost::token_range("p", "m", &r).unwrap(), before);
    let settings: serde_json::Value =
        serde_json::from_slice(&std::fs::read(root.join("provider.json")).unwrap()).unwrap();
    assert_eq!(
        settings["tokenCalibration"][0]["samples"]
            .as_array()
            .unwrap()
            .len(),
        20
    );
}
