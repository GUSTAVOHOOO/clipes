//! Cobertura de integração para emissão real de `core-console` via `set_console_emitter`
//! em Tarefas de IA (`jobs/ai.rs`, `selection.rs`, `source_batches.rs`, `provider_cli.rs`).
#[path = "support/batch_fake.rs"]
mod batch_fake;
use batch_fake::*;
use clipes_core::{
    dispatch, jobs, projects::with_writer, provider::cost::Target, set_console_emitter,
    ConsoleEvent, ConsoleLevel,
};
use serde_json::json;
use std::{
    path::PathBuf,
    sync::{Arc, Mutex},
    time::{Duration, Instant},
};

#[test]
fn console_emitter_receives_ai_selection_batch_and_cli_events_without_leaking_content() {
    let root = tempfile::tempdir().expect("tempdir");
    std::env::set_var("CLIPES_DATA_DIR", root.path().join("data"));

    let captured: Arc<Mutex<Vec<ConsoleEvent>>> = Arc::default();
    let sink = Arc::clone(&captured);
    assert!(
        set_console_emitter(Arc::new(move |ev| sink.lock().unwrap().push(ev))).is_ok(),
        "set_console_emitter must succeed in isolated integration binary"
    );

    call(
        "projects.create",
        json!({"parent": root.path(), "name": "AiConsoleInt"}),
    );
    configure("https://192.0.2.10/v1", 32768);
    call(
        "provider.prices.set",
        json!({
            "provider": "openai",
            "model": "fake-model",
            "inputPerMillion": 100.0,
            "outputPerMillion": 200.0
        }),
    );

    let fake = Arc::new(Fake::default());
    jobs::set_ai_provider(Some(fake.clone()));
    jobs::set_ai_route(Some((
        Target::Api {
            provider: "openai".into(),
            model: "fake-model".into(),
            local: false,
        },
        "legacy".into(),
    )));

    let source_id = seed(1);
    let started = call(
        "selection.start",
        json!({"source_id": source_id, "confirmed": true}),
    );
    let run = started["run"].as_i64().unwrap();

    let deadline = Instant::now() + Duration::from_secs(30);
    loop {
        let view = call("selection.get", json!({"run": run}));
        if view["run"]["state"] == "completed" {
            break;
        }
        assert!(
            Instant::now() < deadline,
            "selection run {run} never completed"
        );
        std::thread::sleep(Duration::from_millis(25));
    }

    // Lote de Fontes (criação, pausa, retomada, cancelamento).
    let source2 = seed(2);
    with_writer(|c| {
        c.execute(
            "INSERT INTO ai_pauses(scope,key,reason) VALUES ('task','selection','user')",
            [],
        )?;
        Ok(())
    })
    .unwrap();
    let batch_created = call(
        "batches.create",
        json!({"sourceIds": [source2], "confirmed": true}),
    );
    let batch_id = batch_created["id"].as_i64().unwrap();
    call("batches.pause", json!({"id": batch_id}));
    call("batches.resume", json!({"id": batch_id}));
    call("batches.cancel", json!({"id": batch_id}));

    // CLI de assinatura (codex falso).
    let rustc = PathBuf::from(env!("CARGO")).with_file_name(if cfg!(windows) {
        "rustc.exe"
    } else {
        "rustc"
    });
    let codex_bin = root
        .path()
        .join(if cfg!(windows) { "codex.exe" } else { "codex" });
    assert!(std::process::Command::new(&rustc)
        .arg(PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("tests/fixtures/fake_provider_cli.rs"),)
        .arg("-o")
        .arg(&codex_bin)
        .status()
        .unwrap()
        .success());
    let prev_path = std::env::var_os("PATH");
    std::env::set_var(
        "PATH",
        std::env::join_paths(
            std::iter::once(root.path().to_path_buf())
                .chain(prev_path.iter().flat_map(std::env::split_paths)),
        )
        .unwrap(),
    );
    std::env::set_var("FAKE_LOG", root.path().join("fake-cli.log"));
    call("provider.cli.configure", json!({"kind": "codex"}));
    call("provider.cli.confirm", json!({"kind": "codex"}));
    let secret_prompt = "INSTRUCAO_SECRETA_INTEGRACAO_555";
    let secret_transcript = "TRANSCRICAO_SECRETA_INTEGRACAO_666";
    let reply = call(
        "provider.structured",
        json!({
            "instruction": secret_prompt,
            "transcript": secret_transcript,
            "schema": {
                "type": "object",
                "properties": {"schemaVersion": {"const": 1}},
                "required": ["schemaVersion"],
                "additionalProperties": false
            },
            "nativeSchema": true
        }),
    );
    assert_eq!(reply["data"]["schemaVersion"], 1);
    if let Some(p) = prev_path {
        std::env::set_var("PATH", p);
    }

    let events = captured.lock().unwrap().clone();
    let serialized = serde_json::to_string(&events).unwrap();

    // Seleção + job de IA (tokens, custo, duração, Janela N de M, modelo)
    assert!(
        events.iter().any(|e| e.job == format!("selection-{run}")
            && e.origin == "ai"
            && e.simple.contains("Seleção de Cortes")
            && e.simple.contains("concluída")),
        "missing selection console events: {serialized}"
    );
    assert!(
        events.iter().any(|e| e.origin == "ai"
            && e.simple.contains("Janela 1 de")
            && e.simple.contains("tokens")
            && e.simple.contains("US$")),
        "missing AI job metrics in console: {serialized}"
    );

    // Lote de Fontes
    assert!(
        events.iter().any(|e| e.job == format!("batch-{batch_id}")
            && e.level == ConsoleLevel::Warn
            && e.simple.contains("pausado")),
        "missing batch pause event: {serialized}"
    );

    // CLI
    assert!(
        events.iter().any(|e| e.job == "cli:codex"
            && e.origin == "ai"
            && e.simple.contains("Codex CLI respondeu em")),
        "missing CLI console event: {serialized}"
    );

    // Privacidade estrita (ADR-0006 e ADR-0009)
    assert!(!serialized.contains("tok1"), "leaked transcript token!");
    assert!(!serialized.contains(secret_prompt), "leaked CLI prompt!");
    assert!(
        !serialized.contains(secret_transcript),
        "leaked CLI transcript!"
    );
    assert!(!serialized.contains("live1.mp4"), "leaked source filename!");

    jobs::set_ai_provider(None);
    jobs::set_ai_route(None);
    let _ = dispatch("projects.close", json!({}), &mut |_| {});
}
