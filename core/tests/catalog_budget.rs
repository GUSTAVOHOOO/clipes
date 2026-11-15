//! A crossed input tier must stop the existing queue budget before the Provider is called.
use clipes_core::{
    ai_task::{AiTask, Budget, TaskInput},
    dispatch,
    jobs::{self, Safety},
    provider::{cost::Target, Provider, StructuredRequest},
    CoreError,
};
use serde_json::{json, Value};
use std::sync::{
    atomic::{AtomicUsize, Ordering},
    Arc,
};
use std::time::{Duration, Instant};

const SCHEMA: &str = r#"{"type":"object","properties":{"schemaVersion":{"type":"integer","enum":[1]}},"required":["schemaVersion"],"additionalProperties":false}"#;
inventory::submit! { AiTask { id: "catalog-budget", version: 1, prompt: "", prompt_sha256: "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855", wire_schema: SCHEMA, full_schema: SCHEMA, verifiers: &[], budget: Budget { max_calls:1, max_input_tokens:1_000_000, max_output_tokens:1000, max_wall_clock_secs:60, max_cost_micro_cents:None } } }
struct Fake(AtomicUsize);
impl Provider for Fake {
    fn structured(&self, _: &StructuredRequest) -> Result<Value, CoreError> {
        self.0.fetch_add(1, Ordering::SeqCst);
        Ok(
            json!({"data":{"schemaVersion":1},"usage":{"inputTokens":70_000,"outputTokens":100},"calls":1}),
        )
    }
}
fn call(name: &str, args: Value) -> Value {
    dispatch(name, args, &mut |_| {}).unwrap()
}
#[test]
fn crossed_tier_pauses_queue_without_sending() {
    let root = std::env::temp_dir().join(format!("clipes-tier-budget-{}", std::process::id()));
    std::fs::create_dir_all(&root).unwrap();
    std::env::set_var("CLIPES_DATA_DIR", root.join("data"));
    call("projects.create", json!({"parent":root,"name":"Tier"}));
    let fake = Arc::new(Fake(AtomicUsize::new(0)));
    jobs::set_ai_provider(Some(fake.clone()));
    jobs::set_ai_route(Some((
        Target::Api {
            provider: "anthropic".into(),
            model: "claude-haiku-5-5".into(),
            local: false,
        },
        "p1".into(),
    )));
    call(
        "jobs.budget.set",
        json!({"scope":"batch","key":"tier","maxCostMicroUsd":30_000}),
    );
    let id = jobs::enqueue_ai_in_batch(
        "catalog-budget",
        &TaskInput {
            transcript: "a".repeat(280_000),
            ..Default::default()
        },
        Safety::Paid,
        Some("tier"),
    )
    .unwrap();
    let deadline = Instant::now() + Duration::from_secs(30);
    loop {
        let view = call("jobs.list", json!({}));
        let job = view
            .as_array()
            .unwrap()
            .iter()
            .find(|j| j["id"] == id)
            .unwrap();
        if job["budgetPause"] == "budget_cost" {
            assert_eq!(job["attempts"], 0);
            break;
        }
        assert!(Instant::now() < deadline, "queue did not pause: {job}");
        std::thread::sleep(Duration::from_millis(20));
    }
    assert_eq!(fake.0.load(Ordering::SeqCst), 0);
    assert_eq!(call("provider.cost.list", json!({"job":id})), json!([]));
    call(
        "jobs.budget.continue",
        json!({"scope":"batch","key":"tier","maxCostMicroUsd":1_000_000}),
    );
    loop {
        let view = call("jobs.list", json!({}));
        let job = view
            .as_array()
            .unwrap()
            .iter()
            .find(|j| j["id"] == id)
            .unwrap();
        if job["state"] == "completed" {
            break;
        }
        assert!(Instant::now() < deadline, "job did not complete: {job}");
        std::thread::sleep(Duration::from_millis(20));
    }
    assert_eq!(fake.0.load(Ordering::SeqCst), 1);
    let rows = call("provider.cost.list", json!({"job":id}));
    assert_eq!(rows[0]["microUsd"], 7050);
    assert!(rows[0]["estimateMicroUsd"].as_u64().unwrap() > 30_000);
    jobs::set_ai_provider(None);
    jobs::set_ai_route(None);
    call("projects.close", json!({}));
}
