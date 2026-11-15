//! Lote de Fontes (#56), headless e sem rede: Provedor falso na fila, Transcrições gravadas no
//! Projeto, dados isolados em CLIPES_DATA_DIR. Um corpo de teste só: o Projeto aberto, o
//! Provedor injetado e a rota são do processo.
#[path = "support/batch_fake.rs"]
mod batch_fake;
use batch_fake::*;
use clipes_core::{jobs, projects::with_writer, provider::cost::Target};
use serde_json::json;
use std::sync::Arc;

fn route(local: bool) {
    jobs::set_ai_route(Some((
        Target::Api {
            provider: "openai".into(),
            model: "fake-model".into(),
            local,
        },
        "legacy".into(),
    )));
}

#[test]
fn batch_runs_sources_in_order_isolates_errors_and_respects_the_cap() {
    let root = tempfile::tempdir().unwrap();
    std::env::set_var("CLIPES_DATA_DIR", root.path().join("data"));
    call(
        "projects.create",
        json!({"parent": root.path(), "name": "Canal"}),
    );
    let (s1, s2, s3) = (seed(1), seed(2), seed(3));
    configure("http://127.0.0.1:9/v1", 32768);
    let fake = Arc::new(Fake::default());
    jobs::set_ai_provider(Some(fake.clone()));
    route(true);

    // ---- Erro não transitório no meio do lote: só a Fonte 2 pausa; 1 e 3 terminam.
    fake.set(2, Behavior::Error("provider_http"));
    let created = call("batches.create", json!({"sourceIds": [s1, s2, s3]}));
    let id = created["id"].as_i64().unwrap();
    assert_eq!(created["key"], format!("sources-{id}"));
    let b = wait_batch(id, "isolated the failing Source", |b| {
        item_state(b, s1) == "completed"
            && item_state(b, s2) == "paused"
            && item_state(b, s3) == "completed"
    });
    assert_eq!(b["status"], "attention");
    assert_eq!(b["items"][1]["error"], "provider_http");
    assert_eq!(
        fake.calls_of(2),
        1,
        "the queued windows of the failing Source were cancelled"
    );
    let (c1, c3) = (fake.calls_of(1), fake.calls_of(3));
    assert!(c1 > 1 && c3 > 1);

    // Troca manual (o Provedor volta a responder) e retomada: nada concluído se repete.
    fake.set(2, Behavior::Ok);
    call("batches.item.resume", json!({"id": id, "sourceId": s2}));
    let b = wait_batch(id, "finished", |b| b["status"] == "completed");
    assert_eq!(item_state(&b, s2), "completed");
    assert_eq!((fake.calls_of(1), fake.calls_of(3)), (c1, c3));
    assert!(fake.calls_of(2) > 1);

    // ---- Pausar e retomar: nada sai da fila enquanto o lote está pausado.
    let s4 = seed(4);
    let created = call("batches.create", json!({"sourceIds": [s4]}));
    let pid = created["id"].as_i64().unwrap();
    call("batches.pause", json!({"id": pid}));
    let before = fake.calls_of(4);
    std::thread::sleep(std::time::Duration::from_millis(600));
    assert_eq!(batch(pid)["status"], "paused");
    assert!(
        fake.calls_of(4) <= before + 1,
        "at most the job already running"
    );
    call("batches.resume", json!({"id": pid}));
    wait_batch(pid, "finished", |b| b["status"] == "completed");

    // ---- Teto de custo: Provedor pago com preço; a Fonte 5 cabe, a 6 pausa o lote inteiro.
    configure("https://192.0.2.10/v1", 32768);
    call(
        "provider.prices.set",
        json!({"provider":"openai","model":"fake-model","inputPerMillion":100.0,"outputPerMillion":200.0}),
    );
    route(false);
    let (s5, s6) = (seed(5), seed(6));
    let needs = fail("batches.create", json!({"sourceIds": [s5, s6]}));
    assert_eq!(needs.code, "confirmation_required");
    assert_eq!(needs.usage.unwrap()["selectionPaid"], true);
    let one = call("selection.estimate", json!({"source_id": s5}));
    let windows = one["plan"]["windows"].as_array().unwrap().len() as i64;
    // Cada chamada gasta 400_000 µUS$ de fato (3000 de entrada a US$ 100/M mais 500 de saída a
    // US$ 200/M) e é conferida pela estimativa (~740_000) antes de sair: o teto deixa a Fonte 5
    // inteira e barra a primeira chamada da 6.
    const SPENT: i64 = 400_000;
    let each = one["estimate"]["maxMicroUsd"].as_i64().unwrap() / windows;
    let cap = SPENT * (windows - 1) + each + SPENT / 2;
    let capped = call(
        "batches.create",
        json!({"sourceIds": [s5, s6], "confirmed": true, "maxCostMicroUsd": cap}),
    );
    let cid = capped["id"].as_i64().unwrap();
    let b = wait_batch(cid, "hit the cap", |b| b["status"] == "budget_paused");
    assert_eq!(b["pause"], "budget_cost");
    assert_eq!(item_state(&b, s5), "completed");
    assert_ne!(item_state(&b, s6), "completed");
    let spent = b["budget"]["usage"]["microUsd"].as_i64().unwrap();
    assert!(spent <= cap, "the cap is a real ceiling: {spent} > {cap}");
    // Continuar com outro teto libera a fila.
    let calls_before = fake.calls_of(6);
    call(
        "jobs.budget.continue",
        json!({"scope":"batch","key":b["key"],"maxCostMicroUsd": cap * 10}),
    );
    wait_batch(cid, "finished", |b| b["status"] == "completed");
    assert!(fake.calls_of(6) > calls_before);

    // ---- Áudio pago no mesmo teto, arredondado para cima; resetUsage zera a janela dele.
    let key = format!("sources-{cid}");
    with_writer(|c| {
        c.execute("INSERT INTO jobs(kind,safety,state,source_id,batch) VALUES ('transcription','paid','completed',?1,?2)", (s5, &key))?;
        let job = c.last_insert_rowid();
        c.execute("INSERT INTO transcription_calls(job_id,start_us,end_us,state,estimated_usd) VALUES (?1,0,1,'pending',0.0000011),(?1,1,2,'uncertain',0.0000021),(?1,2,3,'failed',5.0)", [job])?;
        Ok(())
    })
    .unwrap();
    let audio = |b: &serde_json::Value| b["budget"]["usage"]["audioMicroUsd"].as_i64().unwrap();
    let b = batch(cid);
    assert_eq!(
        audio(&b),
        2 + 3,
        "1.1 and 2.1 µUS$ round up; failed calls are not counted"
    );
    assert!(b["budget"]["usage"]["microUsd"].as_i64().unwrap() >= 5);
    std::thread::sleep(std::time::Duration::from_millis(5));
    call(
        "jobs.budget.set",
        json!({"scope":"batch","key":key,"resetUsage":true}),
    );
    assert_eq!(
        audio(&batch(cid)),
        0,
        "resetUsage also resets the audio window"
    );

    // ---- Veto "somente local" do Projeto: o lote nem é criado.
    call("projects.local_only.set", json!({"enabled": true}));
    let vetoed = fail(
        "batches.create",
        json!({"sourceIds": [s1], "confirmed": true}),
    );
    assert_eq!(vetoed.code, "local_only_violation");
    call("projects.local_only.set", json!({"enabled": false}));

    // ---- Cancelar: o que não terminou fica cancelado.
    configure("http://127.0.0.1:9/v1", 32768);
    route(true);
    fake.set(7, Behavior::Hang);
    let s7 = seed(7);
    let cancelling = call("batches.create", json!({"sourceIds": [s7]}));
    let xid = cancelling["id"].as_i64().unwrap();
    fake.wait_entered();
    call("batches.cancel", json!({"id": xid}));
    let b = wait_batch(xid, "cancelled", |b| b["status"] == "cancelled");
    assert_eq!(item_state(&b, s7), "cancelled");
    call("projects.close", json!({}));
    jobs::set_ai_provider(None);
}
