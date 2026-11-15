//! Custo por chamada e orçamento de tarefa e de lote (#124; ADR-0009). Provedor falso, sem rede.
//! Um corpo de teste só: o Projeto aberto, o preço e o Provedor injetado são do processo.
#[path = "support/ai_fake.rs"]
mod ai_fake;
use ai_fake::*;
use clipes_core::{
    dispatch,
    jobs::{self, Safety},
    provider::cost::Target,
};
use serde_json::{json, Value};
use std::{
    sync::Arc,
    time::{Duration, Instant},
};

fn call(name: &str, args: Value) -> Value {
    dispatch(name, args, &mut |_| {}).unwrap()
}

fn api(model: &str) -> Target {
    Target::Api {
        provider: "openai".into(),
        model: model.into(),
        local: false,
    }
}

fn rows(job: i64) -> Vec<Value> {
    call("provider.cost.list", json!({"job": job}))
        .as_array()
        .unwrap()
        .clone()
}

fn budget(scope: &str, key: &str) -> Value {
    call("jobs.budget.get", json!({}))["budgets"]
        .as_array()
        .unwrap()
        .iter()
        .find(|b| b["scope"] == scope && b["key"] == key)
        .unwrap()
        .clone()
}

fn wait_paused(scope: &str, key: &str) -> String {
    let deadline = Instant::now() + Duration::from_secs(30);
    loop {
        if let Some(reason) = budget(scope, key)["paused"].as_str() {
            return reason.into();
        }
        assert!(Instant::now() < deadline, "{scope} {key} never paused");
        std::thread::sleep(Duration::from_millis(20));
    }
}

fn job(id: i64) -> Value {
    let jobs = call("jobs.list", json!({}));
    jobs.as_array()
        .unwrap()
        .iter()
        .find(|j| j["id"] == id)
        .unwrap()
        .clone()
}

#[test]
fn per_call_cost_rows_and_budgets() {
    let root = std::env::temp_dir().join(format!("clipes-ai-budget-{}", std::process::id()));
    std::fs::create_dir_all(&root).unwrap();
    std::env::set_var("CLIPES_DATA_DIR", root.join("data"));
    // Banco anterior ao #124, com a linha agregada do #40 e todas as demais migrações.
    let project = root.join("Canal.clipes");
    std::fs::create_dir_all(&project).unwrap();
    let conn = rusqlite::Connection::open(project.join("project.sqlite")).unwrap();
    conn.execute_batch("CREATE TABLE schema_migrations(id TEXT PRIMARY KEY NOT NULL)")
        .unwrap();
    let mut migrations: Vec<_> = inventory::iter::<clipes_core::projects::Migration>
        .into_iter()
        .filter(|m| !m.id.starts_with("0124_"))
        .collect();
    migrations.sort_by_key(|m| m.id);
    for migration in migrations {
        conn.execute_batch(migration.sql).unwrap();
        conn.execute("INSERT INTO schema_migrations VALUES (?1)", [migration.id])
            .unwrap();
    }
    conn.execute("INSERT INTO project(name) VALUES ('Canal')", [])
        .unwrap();
    conn.execute("INSERT INTO provider_costs(task,provider,model,input_tokens,output_tokens,calls,cost_kind,cost_micro_usd,table_updated_at) VALUES ('legacy-task','local','q',1,1,1,'zero',0,'legacy')", []).unwrap();
    drop(conn);
    call("projects.open", json!({"path":project}));
    assert!(project.join("project.pre-migration.sqlite").exists());
    let fake = Arc::new(Fake::default());
    jobs::set_ai_provider(Some(fake.clone()));
    // US$100 por milhão de entrada e US$200 por milhão de saída: 10 + 5 tokens custam 2000 µUS$.
    call(
        "provider.prices.set",
        json!({"provider":"openai","model":"m","inputPerMillion":100.0,"outputPerMillion":200.0}),
    );
    jobs::set_ai_route(Some((api("m"), "p1".into())));
    let enqueue = |text: &str, batch: &str| {
        jobs::enqueue_ai_in_batch("example", &input(text), Safety::Paid, Some(batch)).unwrap()
    };

    // Uma tabela antiga continua legível: linha do #40 sem job, resultado nem tentativa.
    let legacy = call("provider.cost.list", json!({}));
    assert_eq!(legacy[0]["task"], "legacy-task");
    assert!(legacy[0]["jobId"].is_null() && legacy[0]["outcome"].is_null());

    // Chamada ok: uma linha com job, tarefa, versão, perfil, modelo, tentativa, tokens,
    // resultado e custo estimado e real.
    call(
        "jobs.budget.set",
        json!({"scope":"batch","key":"b1","maxCostMicroUsd":1_000_000_000}),
    );
    let first = enqueue("ok: 1", "b1");
    wait_state(first, "completed");
    let r = &rows(first)[0];
    assert_eq!(r["jobId"], first);
    assert_eq!(r["task"], "example");
    assert_eq!(r["taskVersion"], 1);
    assert_eq!(r["profile"], "p1");
    assert_eq!(r["model"], "m");
    assert_eq!(r["batch"], "b1");
    assert_eq!(r["attempt"], 0);
    assert_eq!(
        (r["inputTokens"].as_i64(), r["outputTokens"].as_i64()),
        (Some(10), Some(5))
    );
    assert_eq!(r["outcome"], "ok");
    assert_eq!(r["costKind"], "usd");
    assert_eq!(r["microUsd"], 2000);
    let est = r["estimateMicroUsd"].as_i64().unwrap();
    assert!(est > 2000);

    // Teto atingido ANTES da chamada: acumulado (2000) + estimativa (est) passa do teto por 1.
    call(
        "jobs.budget.set",
        json!({"scope":"batch","key":"b1","maxCostMicroUsd":2000 + est - 1}),
    );
    let blocked = enqueue("ok: 2", "b1");
    assert_eq!(wait_paused("batch", "b1"), "budget_cost");
    assert_eq!(
        fake.count("ok: 2"),
        0,
        "nenhuma chamada começa acima do teto"
    );
    assert_eq!(job(blocked)["state"], "queued");
    assert_eq!(job(blocked)["budgetPause"], "budget_cost");
    assert_eq!(job(blocked)["attempts"], 0);
    assert!(rows(blocked).is_empty());
    // Só aquela fila pausa: outro lote segue, e o resultado parcial do lote pausado fica.
    let other = enqueue("ok: 9", "b2");
    wait_state(other, "completed");
    assert_eq!(job(first)["state"], "completed");
    assert_eq!(job(blocked)["state"], "queued");

    // Continuar com o teto exato (acumulado + estimativa == teto) deixa a chamada sair.
    call(
        "jobs.budget.continue",
        json!({"scope":"batch","key":"b1","maxCostMicroUsd":2000 + est}),
    );
    wait_state(blocked, "completed");
    assert!(job(blocked)["budgetPause"].is_null());
    assert_eq!(fake.count("ok: 2"), 1);
    // O acumulado agora é 4000: o próximo job pausa de novo sem enviar.
    let again = enqueue("ok: 3", "b1");
    assert_eq!(wait_paused("batch", "b1"), "budget_cost");
    assert_eq!(fake.count("ok: 3"), 0);
    assert_eq!(budget("batch", "b1")["usage"]["microUsd"], 4000);
    dispatch("jobs.cancel", json!({"id": again}), &mut |_| {}).unwrap();
    wait_state(again, "cancelled");

    // Erro no meio do lote: o job inválido falha COBRADO, o lote segue e soma tudo.
    let (a, bad, c) = (
        enqueue("ok: a", "b3"),
        enqueue("invalid: x", "b3"),
        enqueue("ok: c", "b3"),
    );
    wait_state(a, "completed");
    wait_state(bad, "failed");
    wait_state(c, "completed");
    let charged = &rows(bad)[0];
    assert_eq!(charged["outcome"], "invalid_json");
    assert_eq!(charged["code"], "invalid_json");
    assert_eq!(charged["costKind"], "usd");
    assert_eq!(charged["microUsd"], 2000);
    assert_eq!(charged["calls"], 2);
    let listed = job(c);
    assert_eq!(listed["batch"], "b3");
    assert_eq!(listed["profile"], "p1");
    assert_eq!(listed["batchCost"]["microUsd"], 6000);
    assert_eq!(listed["batchCost"]["calls"], 4);
    assert_eq!(listed["profileCost"]["microUsd"], 4000 + 6000 + 2000);
    assert_eq!(listed["taskCost"]["unknownCostCalls"], 0);

    // Timeout e cancelamento de chamada paga: linha com resultado próprio e custo desconhecido.
    let timeout = enqueue("timeout: x", "b6");
    wait_state(timeout, "uncertain");
    let r = &rows(timeout)[0];
    assert_eq!(r["outcome"], "timeout_uncertain");
    assert_eq!(r["costKind"], "unknown");
    assert!(r["microUsd"].is_null());
    let held = enqueue("block: pago", "b6");
    fake.wait_entered();
    dispatch("jobs.cancel", json!({"id": held}), &mut |_| {}).unwrap();
    wait_state(held, "uncertain");
    let r = &rows(held)[0];
    assert_eq!(r["outcome"], "cancelled");
    assert_eq!(r["costKind"], "unknown");
    assert!(r["microUsd"].is_null());
    assert_eq!(job(held)["batchCost"]["unknownCostCalls"], 2);
    assert_eq!(job(held)["batchCost"]["costLabel"], "custo desconhecido");

    // Entrada maior que o limite da Tarefa: falha com budget_input_tokens, sem enviar e sem pausar.
    let huge = jobs::enqueue_ai_in_batch(
        "example",
        &input(&format!("ok: {}", "palavra ".repeat(3000))),
        Safety::Paid,
        Some("b7"),
    )
    .unwrap();
    wait_state(huge, "failed");
    assert_eq!(result(huge)["code"], "budget_input_tokens");
    assert_eq!(fake.count("ok: palavra"), 0);
    assert!(rows(huge).is_empty());

    // O teto de tokens e o de tempo são acumulados; a chamada em voo respeita o tempo restante.
    call(
        "jobs.budget.set",
        json!({"scope":"batch","key":"tokens","maxTokens":0}),
    );
    let tokens = enqueue("ok: tokens", "tokens");
    assert_eq!(wait_paused("batch", "tokens"), "budget_tokens");
    assert_eq!(fake.count("ok: tokens"), 0);
    call("jobs.cancel", json!({"id":tokens}));
    call(
        "jobs.budget.set",
        json!({"scope":"batch","key":"time","maxWallMs":50}),
    );
    let timed = enqueue("block: time", "time");
    wait_state(timed, "uncertain");
    assert_eq!(result(timed)["code"], "timeout_uncertain");
    assert_eq!(rows(timed)[0]["costKind"], "unknown");
    let after_time = enqueue("ok: after time", "time");
    assert_eq!(wait_paused("batch", "time"), "budget_time");
    assert_eq!(fake.count("ok: after time"), 0);
    call("jobs.cancel", json!({"id":after_time}));

    // CLI: conta só por chamadas ("consome a cota do plano"); o teto de custo não vale.
    jobs::set_ai_route(Some((
        Target::Cli {
            name: "codex".into(),
        },
        "codex".into(),
    )));
    call(
        "jobs.budget.set",
        json!({"scope":"batch","key":"cli","maxCalls":2,"maxCostMicroUsd":1,"maxTokens":0,"maxWallMs":0}),
    );
    let (c1, c2) = (
        enqueue(&format!("ok: c1 {}", "x".repeat(20000)), "cli"),
        enqueue("ok: c2", "cli"),
    );
    wait_state(c1, "completed");
    wait_state(c2, "completed");
    let r = &rows(c1)[0];
    assert_eq!(r["costKind"], "plan_quota");
    assert!(r["microUsd"].is_null());
    assert!(r["inputTokens"].is_null() && r["outputTokens"].is_null());
    assert_eq!(job(c2)["batchCost"]["costLabel"], "consome a cota do plano");
    let c3 = enqueue("ok: c3", "cli");
    assert_eq!(wait_paused("batch", "cli"), "budget_calls");
    assert_eq!(fake.count("ok: c3"), 0);
    dispatch("jobs.cancel", json!({"id": c3}), &mut |_| {}).unwrap();

    // Perfil sem preço: "custo desconhecido", fora do teto por custo, e o lote pede confirmação.
    jobs::set_ai_route(Some((api("sem-preco"), "p2".into())));
    call(
        "jobs.budget.set",
        json!({"scope":"batch","key":"free","maxCostMicroUsd":1_000_000}),
    );
    let u1 = enqueue("ok: u1", "free");
    assert_eq!(wait_paused("batch", "free"), "cost_unknown");
    assert_eq!(fake.count("ok: u1"), 0);
    let err = dispatch(
        "jobs.budget.continue",
        json!({"scope":"batch","key":"free"}),
        &mut |_| {},
    )
    .unwrap_err();
    assert_eq!(err.code, "confirmation_required");
    call(
        "jobs.budget.continue",
        json!({"scope":"batch","key":"free","confirmed":true}),
    );
    wait_state(u1, "completed");
    let r = &rows(u1)[0];
    assert_eq!(r["costKind"], "unknown");
    assert!(r["microUsd"].is_null());
    assert_eq!(job(u1)["batchCost"]["costLabel"], "custo desconhecido");
    // Na Tarefa, o mesmo perfil sem preço não entra no teto de custo e não pede confirmação.
    call(
        "jobs.budget.set",
        json!({"scope":"task","key":"example","maxCostMicroUsd":1}),
    );
    let u2 = enqueue("ok: u2", "free");
    wait_state(u2, "completed");

    // Também exige confirmação se o lote não tem um teto monetário configurado.
    let no_cap = enqueue("ok: no cap", "unknown-no-cap");
    assert_eq!(wait_paused("batch", "unknown-no-cap"), "cost_unknown");
    assert_eq!(job(no_cap)["budgetPause"], "cost_unknown");
    assert_eq!(fake.count("ok: no cap"), 0);
    call(
        "jobs.budget.continue",
        json!({"scope":"batch","key":"unknown-no-cap","confirmed":true}),
    );
    wait_state(no_cap, "completed");

    // O orçamento da Tarefa pausa seus lotes e persiste ao reabrir o Projeto.
    jobs::set_ai_route(Some((api("m"), "p1".into())));
    call(
        "jobs.budget.set",
        json!({"scope":"task","key":"example","maxCalls":0,"maxCostMicroUsd":null,"resetUsage":true}),
    );
    let stopped = enqueue("ok: task cap", "task-cap");
    assert_eq!(wait_paused("task", "example"), "budget_calls");
    assert_eq!(fake.count("ok: task cap"), 0);
    call("projects.close", json!({}));
    call("projects.open", json!({"path":project}));
    assert_eq!(budget("task", "example")["paused"], "budget_calls");
    call(
        "jobs.budget.continue",
        json!({"scope":"task","key":"example","maxCalls":1}),
    );
    wait_state(stopped, "completed");
    assert_eq!(fake.count("ok: task cap"), 1);

    jobs::set_ai_provider(None);
    jobs::set_ai_route(None);
    dispatch("projects.close", json!({}), &mut |_| {}).unwrap();
    let _ = std::fs::remove_dir_all(root);
}
