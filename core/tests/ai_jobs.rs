//! Executor de jobs de IA na fila (#121): estados, custo incerto, cancelamento e eventos.
#[path = "support/ai_fake.rs"]
mod ai_fake;
use ai_fake::*;
use clipes_core::{
    dispatch,
    jobs::{self, Safety},
    ProgressEvent,
};
use serde_json::json;
use std::sync::{Arc, Mutex};

#[test]
fn ai_jobs_follow_the_cost_and_cancellation_rules() {
    let root = std::env::temp_dir().join(format!("clipes-ai-jobs-{}", std::process::id()));
    std::fs::create_dir_all(&root).unwrap();
    std::env::set_var("CLIPES_DATA_DIR", root.join("data"));
    let events: Arc<Mutex<Vec<ProgressEvent>>> = Arc::default();
    let captured = events.clone();
    assert!(
        clipes_core::set_event_emitter(Arc::new(move |e| captured.lock().unwrap().push(e))).is_ok()
    );
    dispatch(
        "projects.create",
        json!({"parent": root, "name": "Canal"}),
        &mut |_| {},
    )
    .unwrap();
    let fake = Arc::new(Fake::default());
    jobs::set_ai_provider(Some(fake.clone()));
    let enqueue = |text: &str, safety| jobs::enqueue_ai("example", &input(text), safety).unwrap();

    // Resposta validada: completed, resultado gravado, eventos ai:example:* sem conteúdo.
    let ok = enqueue("ok: segredo-da-transcricao", Safety::Paid);
    let job = wait_state(ok, "completed");
    assert_eq!(job["kind"], "ai:example");
    assert_eq!(job["checkpoint"], "validated");
    assert_eq!(job["outcome"], "ok");
    let done = result(ok);
    assert_eq!(done["data"], good());
    assert_eq!(done["usage"]["inputTokens"], 10);
    assert_eq!(done["cost"], "usage");
    {
        let events = events.lock().unwrap();
        let mine: Vec<_> = events.iter().filter(|e| e.job == ok.to_string()).collect();
        let stages: Vec<_> = mine.iter().map(|e| e.stage.as_str()).collect();
        assert_eq!(
            stages,
            [
                "ai:example:prepare",
                "ai:example:call",
                "ai:example:verify",
                "ai:example:done"
            ]
        );
        assert!(mine
            .iter()
            .all(|e| !serde_json::to_string(e).unwrap().contains("segredo")));
    }

    // Metadata from old data must never prevent a queued AI call.
    for language in ["haw", "private-invalid-value"] {
        let mut data = input("ok: metadata");
        data.estimate_hint.language = language.into();
        let id = jobs::enqueue_ai("example", &data, Safety::Paid).unwrap();
        assert_eq!(wait_state(id, "completed")["outcome"], "ok");
    }

    // invalid_json com resposta recebida: failed (não uncertain), usage preservado.
    let bad = enqueue("invalid: x", Safety::Paid);
    let job = wait_state(bad, "failed");
    assert_eq!(job["cost"], "usage");
    let failed = result(bad);
    assert_eq!(failed["code"], "invalid_json");
    assert_eq!(failed["usage"]["usage"]["inputTokens"], 10);
    assert_eq!(failed["usage"]["calls"], 2);

    // Timeout de modelo local: uncertain, repete sem confirmação e conclui.
    let local = enqueue("flaky: x", Safety::Local);
    let job = wait_state(local, "uncertain");
    assert_eq!(job["cost"], "zero");
    dispatch("jobs.retry", json!({"id": local}), &mut |_| {}).unwrap();
    let job = wait_state(local, "completed");
    assert_eq!(job["attempts"], 2);
    assert_eq!(fake.count("flaky:"), 2);

    // Timeout de chamada paga: uncertain, custo desconhecido, nunca repetido às cegas.
    let paid = enqueue("timeout: x", Safety::Paid);
    let job = wait_state(paid, "uncertain");
    assert_eq!(job["cost"], "unknown");
    assert!(result(paid)["usage"].is_null());
    let err = dispatch("jobs.retry", json!({"id": paid}), &mut |_| {}).unwrap_err();
    assert_eq!(err.code, "confirmation_required");
    assert!(err.usage.unwrap()["estimate"]["kind"].is_string());
    let estimate = dispatch("jobs.estimate", json!({"id": paid}), &mut |_| {}).unwrap();
    assert_eq!(estimate["safety"], "paid");
    assert_eq!(fake.count("timeout:"), 1);
    dispatch("jobs.discard", json!({"id": paid}), &mut |_| {}).unwrap();
    wait_state(paid, "cancelled");

    // Cancelar uma chamada paga em voo: uncertain com custo desconhecido, nunca cancelled.
    let blocked = enqueue("block: pago", Safety::Paid);
    fake.wait_entered();
    dispatch("jobs.cancel", json!({"id": blocked}), &mut |_| {}).unwrap();
    let job = wait_state(blocked, "uncertain");
    assert_eq!(job["cost"], "unknown");
    assert_eq!(result(blocked)["outcome"], "uncertain");
    assert_eq!(result(blocked)["code"], "cancelled");

    // Cancelar um modelo local em voo: cancelled normal, custo zero.
    let blocked_local = enqueue("block: local", Safety::Local);
    fake.wait_entered();
    dispatch("jobs.cancel", json!({"id": blocked_local}), &mut |_| {}).unwrap();
    let job = wait_state(blocked_local, "cancelled");
    assert_eq!(job["cost"], "zero");

    // Cancelar antes de enviar: o job na fila vira cancelled e o Provedor nunca é chamado.
    let holder = enqueue("block: segura a fila", Safety::Local);
    fake.wait_entered();
    let waiting = enqueue("ok: nunca enviado", Safety::Paid);
    dispatch("jobs.cancel", json!({"id": waiting}), &mut |_| {}).unwrap();
    wait_state(waiting, "cancelled");
    dispatch("jobs.cancel", json!({"id": holder}), &mut |_| {}).unwrap();
    wait_state(holder, "cancelled");
    assert_eq!(fake.count("ok: nunca"), 0);

    // Tarefa desconhecida é recusada no enfileiramento.
    assert_eq!(
        jobs::enqueue_ai("nope", &input("x"), Safety::Paid)
            .unwrap_err()
            .code,
        "unknown_task"
    );

    jobs::set_ai_provider(None);
    dispatch("projects.close", json!({}), &mut |_| {}).unwrap();
    let _ = std::fs::remove_dir_all(root);
}
