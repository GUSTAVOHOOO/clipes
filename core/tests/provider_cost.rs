use clipes_core::{
    dispatch,
    provider::{
        cost::{self, Cost, Target},
        Provider, StructuredRequest,
    },
    CoreError,
};
use serde_json::{json, Value};

/// Fake provider: returns a fixed `{data, usage, calls}` or a fixed error. Never touches the network.
struct Fake(Result<Value, CoreError>);
impl Provider for Fake {
    fn structured(&self, _: &StructuredRequest) -> Result<Value, CoreError> {
        self.0.clone()
    }
}

fn request(transcript: &str, max: Option<u64>) -> StructuredRequest {
    StructuredRequest {
        instruction: "x".repeat(40),
        transcript: transcript.into(),
        schema: json!({"type":"object"}),
        native_schema: false,
        max_output_tokens: max,
    }
}
fn api(provider: &str, model: &str, local: bool) -> Target {
    Target::Api {
        provider: provider.into(),
        model: model.into(),
        local,
    }
}
fn call(name: &str, args: Value) -> Result<Value, CoreError> {
    dispatch(name, args, &mut |_| {})
}

// One test body: the price overrides file and the open Project are process-wide.
#[test]
fn estimate_actual_and_project_record() {
    let root = std::env::temp_dir().join(format!("clipes-cost-{}", std::process::id()));
    std::fs::create_dir_all(&root).unwrap();
    std::env::set_var("CLIPES_DATA_DIR", root.join("data"));

    // Estimate: input from chars/4 (40 + 400 + `{"type":"object"}` = 17 chars -> 457 -> 115),
    // output capped by maxOutputTokens. gpt-5: $1.25 in / $10 out per million.
    let r = request(&"a".repeat(400), Some(1000));
    assert_eq!(cost::estimate_input_tokens(&r), 115);
    let e = cost::estimate(&api("openai", "gpt-5", false), &r).unwrap();
    assert_eq!(e["kind"], "usd");
    assert_eq!(e["minMicroUsd"], 144); // 115 * 1.25 = 143.75
    assert_eq!(e["maxMicroUsd"], 10240); // conservative input range + 1000 * 10
    assert_eq!(e["priceSource"], "table");
    assert!(e["tableUpdatedAt"].is_string());
    // Without a ceiling there is no maximum (OpenAI sends no limit); Anthropic assumes 8192.
    let e = cost::estimate(&api("openai", "gpt-5", false), &request("", None)).unwrap();
    assert!(e["maxMicroUsd"].is_null() && e["minMicroUsd"].is_u64());
    let e = cost::estimate(
        &api("anthropic", "claude-haiku-4-5", false),
        &request("", None),
    )
    .unwrap();
    assert_eq!(e["maxOutputTokens"], 8192);
    // Unknown model: "unknown", never zero. Local: zero. CLI: plan quota, no money.
    let e = cost::estimate(&api("openai", "mystery", false), &r).unwrap();
    assert_eq!(
        (e["kind"].as_str(), e["minMicroUsd"].is_null()),
        (Some("unknown"), true)
    );
    let e = cost::estimate(&api("openai", "mystery", true), &r).unwrap();
    assert_eq!(
        (e["kind"].as_str(), e["maxMicroUsd"].as_u64()),
        (Some("zero"), Some(0))
    );
    let e = cost::estimate(
        &Target::Cli {
            name: "codex".into(),
        },
        &r,
    )
    .unwrap();
    assert!(e["kind"] == "plan_quota" && e["maxMicroUsd"].is_null());

    // Actual cost from usage; null usage on a paid API is unknown, not zero.
    let usage = json!({"inputTokens":2000,"outputTokens":500});
    assert_eq!(
        cost::actual(&api("openai", "gpt-5", false), &usage).unwrap(),
        Cost::Usd {
            micro_usd: 2500 + 5000,
            source: "table"
        }
    );
    assert_eq!(
        cost::actual(&api("openai", "gpt-5", false), &Value::Null).unwrap(),
        Cost::Unknown
    );
    assert_eq!(
        cost::actual(
            &api("openai", "gpt-5", false),
            &json!({"inputTokens":5,"outputTokens":null})
        )
        .unwrap(),
        Cost::Unknown
    );
    assert_eq!(
        cost::actual(&api("openai", "gpt-5", true), &usage).unwrap(),
        Cost::Zero
    );
    assert_eq!(
        cost::actual(
            &Target::Cli {
                name: "claude".into()
            },
            &Value::Null
        )
        .unwrap(),
        Cost::PlanQuota
    );

    // Override wins over the embedded table, and can be removed.
    let view = call(
        "provider.prices.set",
        json!({"provider":"openai","model":"gpt-5","inputPerMillion":2.0,"outputPerMillion":4.0}),
    )
    .unwrap();
    assert_eq!(view["overrides"].as_array().unwrap().len(), 1);
    assert!(view["updatedAt"].is_string());
    assert_eq!(
        cost::actual(&api("openai", "gpt-5", false), &usage).unwrap(),
        Cost::Usd {
            micro_usd: 4000 + 2000,
            source: "override"
        }
    );
    assert!(call(
        "provider.prices.set",
        json!({"provider":"openai","model":"","inputPerMillion":1,"outputPerMillion":1})
    )
    .is_err());
    assert_eq!(call("provider.prices.set", json!({"provider":"openai","model":"mystery","inputPerMillion":1.0,"outputPerMillion":1.0})).unwrap()["overrides"].as_array().unwrap().len(), 2);
    call(
        "provider.prices.clear",
        json!({"provider":"openai","model":"mystery"}),
    )
    .unwrap();
    call(
        "provider.prices.clear",
        json!({"provider":"openai","model":"gpt-5"}),
    )
    .unwrap();
    assert!(call("provider.prices.get", json!({})).unwrap()["overrides"]
        .as_array()
        .unwrap()
        .is_empty());

    // Without an open Project the cost is returned but not recorded.
    let paid = api("openai", "gpt-5", false);
    let ok = json!({"data":{"schemaVersion":1},"usage":{"inputTokens":1000,"outputTokens":100},"calls":2});
    let out = cost::run_costed(&paid, "score", None, || {
        Fake(Ok(ok.clone())).structured(&request("", None))
    })
    .unwrap();
    assert_eq!(out["cost"]["recorded"], false);
    assert_eq!(out["cost"]["microUsd"], 1250 + 1000);

    call("projects.create", json!({"parent":root,"name":"Canal"})).unwrap();
    assert_eq!(call("provider.cost.list", json!({})).unwrap(), json!([]));

    // Records per task, with a nullable batch; CLI has no money; unknown usage is never zero.
    let out = cost::run_costed(&paid, "score", None, || {
        Fake(Ok(ok.clone())).structured(&request("", None))
    })
    .unwrap();
    assert_eq!(out["cost"]["recorded"], true);
    cost::run_costed(&paid, "package", Some("lote-1"), || {
        Fake(Ok(ok.clone())).structured(&request("", None))
    })
    .unwrap();
    let cli = Target::Cli {
        name: "codex".into(),
    };
    let cli_ok = json!({"data":{"schemaVersion":1},"usage":null,"calls":1});
    let out = cost::run_costed(&cli, "script", None, || {
        Fake(Ok(cli_ok.clone())).structured(&request("", None))
    })
    .unwrap();
    assert_eq!(out["cost"]["kind"], "plan_quota");
    assert!(out["cost"]["microUsd"].is_null());
    let none = json!({"data":{"schemaVersion":1},"usage":null,"calls":1});
    let out = cost::run_costed(&paid, "translate", None, || {
        Fake(Ok(none.clone())).structured(&request("", None))
    })
    .unwrap();
    assert_eq!(out["cost"]["kind"], "unknown");
    // Truncated output was paid for: recorded with usage, and the error stays typed.
    let truncated = CoreError {
        code: "output_truncated".into(),
        message: "Provider output was truncated".into(),
        usage: Some(json!({"usage":{"inputTokens":10,"outputTokens":20},"calls":1})),
    };
    let err = cost::run_costed(&paid, "score", None, || {
        Fake(Err(truncated.clone())).structured(&request("", None))
    })
    .unwrap_err();
    assert_eq!(err.code, "output_truncated");
    assert_eq!(err.usage.unwrap()["cost"]["microUsd"], 13 + 200);
    // Invalid JSON after repair was billed too; a timeout is recorded as unknown, never zero.
    let invalid = CoreError {
        code: "invalid_json".into(),
        message: "Provider response failed validation after repair".into(),
        usage: Some(json!({"usage":{"inputTokens":1000,"outputTokens":0},"calls":2})),
    };
    let err = cost::run_costed(&paid, "script", None, || {
        Fake(Err(invalid.clone())).structured(&request("", None))
    })
    .unwrap_err();
    assert_eq!(err.usage.unwrap()["cost"]["microUsd"], 1250);
    let timeout = CoreError {
        code: "timeout_uncertain".into(),
        message: "Provider timed out".into(),
        usage: None,
    };
    assert!(
        cost::run_costed(&paid, "script", None, || Fake(Err(timeout.clone()))
            .structured(&request("", None)))
        .is_err()
    );
    // Other failures record nothing.
    let down = CoreError {
        code: "network".into(),
        message: "Could not reach provider".into(),
        usage: None,
    };
    assert!(
        cost::run_costed(&paid, "score", None, || Fake(Err(down.clone()))
            .structured(&request("", None)))
        .is_err()
    );

    let rows = call("provider.cost.list", json!({})).unwrap();
    let rows = rows.as_array().unwrap();
    assert_eq!(rows.len(), 7);
    assert_eq!(rows[0]["task"], "score");
    assert!(rows[0]["batch"].is_null());
    assert_eq!(rows[0]["calls"], 2);
    assert_eq!(rows[1]["batch"], "lote-1");
    assert_eq!(
        (rows[2]["provider"].as_str(), rows[2]["costKind"].as_str()),
        (Some("cli:codex"), Some("plan_quota"))
    );
    assert!(rows[2]["microUsd"].is_null());
    assert_eq!(rows[3]["costKind"], "unknown");
    assert!(rows[3]["microUsd"].is_null());
    assert_eq!(rows[4]["outputTokens"], 20);
    assert_eq!(
        (rows[5]["costKind"].as_str(), rows[5]["calls"].as_i64()),
        (Some("usd"), Some(2))
    );
    assert_eq!(rows[6]["costKind"], "unknown");
    assert!(rows[6]["microUsd"].is_null());
    let batch = call("provider.cost.list", json!({"batch":"lote-1"})).unwrap();
    assert_eq!(batch.as_array().unwrap().len(), 1);
    assert!(!serde_json::to_string(&rows)
        .unwrap()
        .contains(root.to_str().unwrap()));
    let _ = call("projects.close", json!({}));
}
