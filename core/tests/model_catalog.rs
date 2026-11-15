//! Model catalog and request-wide tiers, through the headless seam. No network.
use clipes_core::{
    dispatch,
    provider::{
        cost::{self, Cost, Target},
        Provider, StructuredRequest,
    },
    CoreError,
};
use serde_json::{json, Value};

struct Fake(Value);
impl Provider for Fake {
    fn structured(&self, _: &StructuredRequest) -> Result<Value, CoreError> {
        Ok(self.0.clone())
    }
}
fn call(name: &str, args: Value) -> Value {
    dispatch(name, args, &mut |_| {}).unwrap()
}
fn target(provider: &str, model: &str) -> Target {
    Target::Api {
        provider: provider.into(),
        model: model.into(),
        local: false,
    }
}
fn request() -> StructuredRequest {
    StructuredRequest {
        estimate_hint: Default::default(),
        instruction: String::new(),
        transcript: "a".repeat(280_000),
        schema: json!({}),
        native_schema: false,
        max_output_tokens: Some(1000),
    }
}

#[test]
fn catalog_tiers_and_legacy_overrides() {
    let root = std::env::temp_dir().join(format!("clipes-model-catalog-{}", std::process::id()));
    std::fs::create_dir_all(&root).unwrap();
    std::env::set_var("CLIPES_DATA_DIR", &root);
    let cases = [
        ("anthropic", "claude-haiku-5-5", 100_000, 0.1, 0.5, 0.5, 2.5),
        ("openai", "gpt-6-astra", 272_000, 10.0, 50.0, 20.0, 75.0),
        ("openai", "gpt-6.1-sol", 272_000, 2.0, 10.0, 4.0, 15.0),
        ("openai", "gpt-6.1-terra", 272_000, 1.0, 5.0, 2.0, 7.5),
        ("openai", "gpt-6-luna", 272_000, 0.1, 0.5, 0.2, 0.75),
        ("openai", "gpt-6-sol", 272_000, 2.0, 10.0, 4.0, 15.0),
        ("openai", "gpt-5.6-terra", 272_000, 2.0, 12.0, 4.0, 18.0),
        ("openai", "gpt-5.6-luna", 272_000, 0.2, 1.2, 0.4, 1.8),
        ("openai", "gpt-5.5", 272_000, 5.0, 30.0, 10.0, 45.0),
        ("openai", "gpt-5.4", 272_000, 2.5, 15.0, 5.0, 22.5),
        ("openai", "gpt-5.4-pro", 272_000, 30.0, 180.0, 60.0, 270.0),
        (
            "gemini",
            "gemini-3.1-pro-preview",
            200_000,
            2.0,
            12.0,
            4.0,
            18.0,
        ),
    ];
    for (provider, model, threshold, base_i, base_o, high_i, high_o) in cases {
        let target = target(provider, model);
        for input in [threshold - 1, threshold, threshold + 1] {
            let (i, o) = if input > threshold {
                (high_i, high_o)
            } else {
                (base_i, base_o)
            };
            let expected = (input as f64 * i).round() as u64 + (1000.0_f64 * o).round() as u64;
            let result = cost::run_costed(&target, "selection", None, || {
                Fake(json!({"data":{},"usage":{"inputTokens":input,"outputTokens":1000},"calls":1}))
                    .structured(&request())
            })
            .unwrap();
            assert_eq!(result["cost"]["microUsd"], expected, "{model} at {input}");
        }
        for usage in [
            Value::Null,
            json!({"inputTokens":threshold+1}),
            json!({"outputTokens":1000}),
            json!({"inputTokens":threshold+1,"outputTokens":null}),
        ] {
            assert_eq!(cost::actual(&target, &usage).unwrap(), Cost::Unknown);
        }
        let mut crossing = request();
        crossing.transcript = "a".repeat((threshold * 3 - 2) as usize);
        let e = cost::estimate(&target, &crossing).unwrap();
        let max = e["inputTokensRange"]["max"].as_u64().unwrap();
        assert!(e["inputTokensRange"]["min"].as_u64().unwrap() <= threshold);
        assert!(max > threshold);
        assert_eq!(e["tier"]["aboveInputTokens"], threshold);
        assert_eq!(e["tier"]["crossesThreshold"], true);
        assert_eq!(
            e["maxMicroUsd"],
            (max as f64 * high_i).round() as u64 + (1000.0 * high_o).round() as u64
        );
    }
    let view = call("provider.prices.get", json!({}));
    let haiku = view["prices"]
        .as_array()
        .unwrap()
        .iter()
        .find(|p| p["model"] == "claude-haiku-5-5")
        .unwrap();
    assert_eq!(haiku["contextWindow"], 1_000_000);
    assert_eq!(haiku["maxOutput"], 128_000);
    assert_eq!(haiku["updatedAt"], "2026-11-15");
    assert!(haiku["source"]
        .as_str()
        .unwrap()
        .starts_with("https://platform.claude.com/"));
    let estimate = cost::estimate(&target("anthropic", "claude-haiku-5-5"), &request()).unwrap();
    assert!(estimate["inputTokensRange"]["min"].as_u64().unwrap() <= 100_000);
    let max = estimate["inputTokensRange"]["max"].as_u64().unwrap();
    assert!(max > 100_000);
    assert_eq!(estimate["tier"]["aboveInputTokens"], 100_000);
    assert_eq!(estimate["tier"]["crossesThreshold"], true);
    assert_eq!(
        estimate["maxMicroUsd"],
        (max as f64 * 0.5).round() as u64 + 2500
    );
    // The old file remains readable without rewriting; its flat rate replaces all tiers.
    let old = r#"{"prices":[{"provider":"anthropic","model":"claude-haiku-5-5","inputPerMillion":3,"outputPerMillion":4}]}"#;
    std::fs::write(root.join("provider-prices.json"), old).unwrap();
    assert_eq!(
        cost::actual(
            &target("anthropic", "claude-haiku-5-5"),
            &json!({"inputTokens":100_001,"outputTokens":1000})
        )
        .unwrap(),
        Cost::Usd {
            micro_usd: 304_003,
            source: "override"
        }
    );
    assert_eq!(
        std::fs::read_to_string(root.join("provider-prices.json")).unwrap(),
        old
    );
    let e = cost::estimate(&target("anthropic", "claude-haiku-5-5"), &request()).unwrap();
    assert!(e["tier"].is_null());
    assert_eq!(e["priceSource"], "override");
    let (price, _) = cost::price_for("anthropic", "claude-haiku-5-5")
        .unwrap()
        .unwrap();
    assert_eq!(price.context_window, Some(1_000_000));
    assert_eq!(price.max_output, Some(128_000));
    // Updating the local catalog is explicit, and metadata/tiers survive reading.
    let custom = json!({"provider":"custom","model":"custom-model","inputPerMillion":1,"outputPerMillion":2,"contextWindow":12345,"maxOutput":1000,"source":"https://example.com/models","updatedAt":"2026-11-15","tiers":[{"aboveInputTokens":100,"inputPerMillion":3,"outputPerMillion":4}]});
    call("provider.prices.set", custom.clone());
    let persisted = call("provider.prices.get", json!({}));
    let saved = persisted["overrides"]
        .as_array()
        .unwrap()
        .iter()
        .find(|p| p["model"] == "custom-model")
        .unwrap();
    assert_eq!(saved["contextWindow"], custom["contextWindow"]);
    assert_eq!(saved["maxOutput"], custom["maxOutput"]);
    assert_eq!(saved["source"], custom["source"]);
    assert_eq!(saved["updatedAt"], custom["updatedAt"]);
    assert_eq!(saved["tiers"][0]["aboveInputTokens"], 100);
    assert_eq!(saved["tiers"][0]["inputPerMillion"].as_f64(), Some(3.0));
    assert_eq!(
        cost::actual(
            &target("custom", "custom-model"),
            &json!({"inputTokens":101,"outputTokens":10})
        )
        .unwrap(),
        Cost::Usd {
            micro_usd: 343,
            source: "override"
        }
    );
    for tiers in [
        json!([{"aboveInputTokens":0,"inputPerMillion":2,"outputPerMillion":3}]),
        json!([{"aboveInputTokens":100,"inputPerMillion":2,"outputPerMillion":3},{"aboveInputTokens":100,"inputPerMillion":3,"outputPerMillion":4}]),
    ] {
        let mut invalid = custom.clone();
        invalid["tiers"] = tiers;
        assert_eq!(
            dispatch("provider.prices.set", invalid, &mut |_| {})
                .unwrap_err()
                .code,
            "invalid_price"
        );
    }
    let unknown = cost::estimate(&target("custom", "unknown"), &request()).unwrap();
    assert_eq!(unknown["kind"], "unknown");
    assert!(unknown["maxMicroUsd"].is_null());
}
