//! Limites da definição da Tarefa falham antes de enviar; CLI conta só chamadas.
#[path = "support/ai_fake.rs"]
mod ai_fake;
use ai_fake::*;
use clipes_core::{
    ai_task::{AiTask, Budget},
    dispatch,
    jobs::{self, Safety},
    provider::cost::Target,
};
use serde_json::json;
use std::sync::Arc;

const SCHEMA: &str = r#"{"type":"object","properties":{"schemaVersion":{"type":"integer","enum":[1]},"picks":{"type":"array","items":{"type":"object","properties":{"id":{"type":"integer"},"note":{"type":"integer"}},"required":["id","note"],"additionalProperties":false}}},"required":["schemaVersion","picks"],"additionalProperties":false}"#;
macro_rules! task {
    ($id:literal, $calls:expr, $tokens:expr, $time:expr, $cost:expr) => {
        inventory::submit! { AiTask {
            id: $id, version: 1,
            prompt: include_str!("../src/ai_task/example_prompt.md"),
            prompt_sha256: "9b4e7b18b09bbdc1aa0e17f38f2af8e045c679b6c7e6f86068201ab399e8b1ae",
            wire_schema: SCHEMA, full_schema: SCHEMA, verifiers: &[],
            budget: Budget { max_calls: $calls, max_input_tokens: $tokens, max_output_tokens: 256,
                max_wall_clock_secs: $time, max_cost_micro_cents: $cost },
        } }
    };
}
task!("no-calls", 0, 4000, 60, None);
task!("no-tokens", 2, 0, 60, None);
task!("no-time", 2, 4000, 0, None);
task!("no-cost", 2, 4000, 60, Some(0));
task!("cli-only-calls", 1, 0, 0, Some(0));
task!("selection", 2, 4000, 60, None);

#[test]
fn definition_limits_fail_without_charging_and_cli_ignores_non_call_limits() {
    let root = std::env::temp_dir().join(format!("clipes-ai-job-limits-{}", std::process::id()));
    std::fs::create_dir_all(&root).unwrap();
    std::env::set_var("CLIPES_DATA_DIR", root.join("data"));
    dispatch(
        "projects.create",
        json!({"parent":root,"name":"Canal"}),
        &mut |_| {},
    )
    .unwrap();
    dispatch(
        "provider.prices.set",
        json!({"provider":"openai","model":"m","inputPerMillion":100.0,"outputPerMillion":200.0}),
        &mut |_| {},
    )
    .unwrap();
    let fake = Arc::new(Fake::default());
    jobs::set_ai_provider(Some(fake.clone()));
    jobs::set_ai_route(Some((
        Target::Api {
            provider: "openai".into(),
            model: "m".into(),
            local: false,
        },
        "p".into(),
    )));
    for (task, code) in [
        ("no-calls", "budget_calls"),
        ("no-tokens", "budget_input_tokens"),
        ("no-time", "budget_time"),
        ("no-cost", "budget_cost"),
    ] {
        let job = jobs::enqueue_ai(task, &input(&format!("ok: {task}")), Safety::Paid).unwrap();
        wait_state(job, "failed");
        assert_eq!(result(job)["code"], code);
        assert_eq!(fake.count(&format!("ok: {task}")), 0);
        assert!(
            dispatch("provider.cost.list", json!({"job":job}), &mut |_| {})
                .unwrap()
                .as_array()
                .unwrap()
                .is_empty()
        );
    }
    jobs::set_ai_route(Some((
        Target::Cli {
            name: "codex".into(),
        },
        "codex".into(),
    )));
    let cli = jobs::enqueue_ai("cli-only-calls", &input("ok: cli"), Safety::Paid).unwrap();
    wait_state(cli, "completed");
    assert_eq!(fake.count("ok: cli"), 1);
    jobs::set_ai_route(Some((
        Target::OpenCode {
            model: "opencode/big-pickle".into(),
        },
        "opencode".into(),
    )));
    let opencode =
        jobs::enqueue_ai("cli-only-calls", &input("ok: opencode"), Safety::Paid).unwrap();
    wait_state(opencode, "completed");
    assert_eq!(fake.count("ok: opencode"), 1);
    // O veto do Projeto prevalece sobre qualquer pausa por custo desconhecido, sem enviar.
    jobs::set_ai_route(None);
    dispatch(
        "provider.configure",
        json!({"kind":"openai","endpoint":"https://192.0.2.10/v1","model":"m"}),
        &mut |_| {},
    )
    .unwrap();
    dispatch(
        "projects.local_only.set",
        json!({"enabled":true}),
        &mut |_| {},
    )
    .unwrap();
    let private = jobs::enqueue_ai_in_batch(
        "selection",
        &input("ok: private"),
        Safety::Paid,
        Some("private"),
    )
    .unwrap();
    wait_state(private, "failed");
    assert_eq!(result(private)["code"], "local_only_violation");
    assert_eq!(fake.count("ok: private"), 0);
    jobs::set_ai_provider(None);
    jobs::set_ai_route(None);
    dispatch("projects.close", json!({}), &mut |_| {}).unwrap();
    std::fs::remove_dir_all(root).unwrap();
}
