//! "Refazer com o forte" manual (#126), headless e sem rede: dois Perfis de Provedor (um local, um
//! remoto) e o Provedor falso injetado na fila, que atende os dois sem abrir socket. A Transcrição
//! é gravada direto no Projeto e os dados ficam isolados em CLIPES_DATA_DIR. Um corpo de teste só:
//! o Projeto aberto, o Provedor injetado e a rota são do processo.
use clipes_core::{
    dispatch, jobs,
    projects::with_writer,
    provider::{CancelToken, Provider, StructuredRequest},
    CoreError,
};
use serde_json::{json, Value};
use std::{
    collections::HashMap,
    sync::{Arc, Mutex},
    time::{Duration, Instant},
};

fn call(name: &str, args: Value) -> Value {
    dispatch(name, args, &mut |_| {}).unwrap()
}

fn fail(name: &str, args: Value) -> CoreError {
    dispatch(name, args, &mut |_| {}).unwrap_err()
}

const SENTENCES: i64 = 240;
const REMOTE: &str = "https://192.0.2.10/v1";
const LOCAL: &str = "http://127.0.0.1:9/v1";

fn seed() -> i64 {
    with_writer(|c| {
        c.execute("INSERT INTO sources(path,size,duration_us,partial_hash,metadata,permission,audio_track) VALUES ('C:/videos/live.mp4',1,2400000000,'h','{}','{}',0)", [])?;
        let source = c.last_insert_rowid();
        c.execute("INSERT INTO transcripts(source_id,audio_track,engine,model,revision,compute_type,state,resume_us,duration_us) VALUES (?1,0,'local','m','r','c','complete',2400000000,2400000000)", [source])?;
        let transcript = c.last_insert_rowid();
        for position in 0..SENTENCES * 10 {
            let text = if position % 10 == 9 {
                " palavra."
            } else {
                " palavra"
            };
            c.execute("INSERT INTO transcript_words(transcript_id,position,kind,text,start_us,end_us,language) VALUES (?1,?2,'word',?3,?4,?5,'pt')", (transcript, position, text, position * 1_000_000, (position + 1) * 1_000_000))?;
        }
        Ok(source)
    })
    .unwrap()
}

fn cand(start: i64, end: i64, score: i64) -> Value {
    let mut c = json!({"startId": start, "endId": end, "title": ""});
    for key in ["hook", "selfContained", "energy", "value", "closing"] {
        c[key] = json!({"score": score, "why": "motivo curto"});
    }
    c
}

fn first_id(transcript: &str) -> i64 {
    transcript
        .lines()
        .find(|l| !l.starts_with('#'))
        .and_then(|l| l.split(' ').next())
        .and_then(|id| id.parse().ok())
        .expect("a window starts with a sentence id")
}

/// Provedor falso: devolve os candidatos da "rodada" para a Janela (pelo ID da primeira Frase) e
/// pode falhar a próxima chamada. Conta as chamadas por Janela.
#[derive(Default)]
struct Fake {
    answers: Mutex<HashMap<i64, Vec<Value>>>,
    fail_next: Mutex<Option<&'static str>>,
    calls: Mutex<Vec<i64>>,
}

impl Fake {
    fn answer(&self, first: i64, candidates: Vec<Value>) {
        self.answers.lock().unwrap().insert(first, candidates);
    }
    fn total(&self) -> usize {
        self.calls.lock().unwrap().len()
    }
}

impl Provider for Fake {
    fn structured(&self, _: &StructuredRequest) -> Result<Value, CoreError> {
        unreachable!("the executor must use structured_with")
    }
    fn structured_with(
        &self,
        request: &StructuredRequest,
        _: &CancelToken,
    ) -> Result<Value, CoreError> {
        let first = first_id(&request.transcript);
        self.calls.lock().unwrap().push(first);
        if let Some(code) = self.fail_next.lock().unwrap().take() {
            return Err(CoreError {
                code: code.into(),
                message: "fixed".into(),
                usage: None,
            });
        }
        let list = self
            .answers
            .lock()
            .unwrap()
            .get(&first)
            .cloned()
            .unwrap_or_default();
        Ok(
            json!({"data": {"schemaVersion": 1, "candidates": list}, "usage": {"inputTokens": 10, "outputTokens": 5}, "calls": 1}),
        )
    }
}

fn wait(run: i64, what: &str, done: impl Fn(&Value) -> bool) -> Value {
    let deadline = Instant::now() + Duration::from_secs(60);
    loop {
        let value = call("selection.get", json!({"run": run}));
        if done(&value) {
            return value;
        }
        assert!(Instant::now() < deadline, "run {run} never {what}: {value}");
        std::thread::sleep(Duration::from_millis(25));
    }
}

fn settled(run: i64, revision: i64) -> Value {
    wait(run, "settled", |v| {
        v["run"]["state"] != "running" && v["run"]["revision"] == revision
    })
}

fn profile_of_job(job: i64) -> Value {
    call("jobs.list", json!({}))
        .as_array()
        .unwrap()
        .iter()
        .find(|j| j["id"] == job)
        .unwrap()["profile"]
        .clone()
}

fn job_count() -> usize {
    call("jobs.list", json!({})).as_array().unwrap().len()
}

fn decisions(run: i64) -> i64 {
    with_writer(|c| {
        c.query_row(
            "SELECT COUNT(*) FROM selection_decisions WHERE run_id=?1",
            [run],
            |r| r.get(0),
        )
    })
    .unwrap()
}

#[test]
fn redo_with_another_profile_confirms_vetoes_records_and_never_switches_by_itself() {
    let root = tempfile::tempdir().unwrap();
    std::env::set_var("CLIPES_DATA_DIR", root.path().join("data"));
    call(
        "projects.create",
        json!({"parent": root.path(), "name": "Canal"}),
    );
    // Este teste exercita quatro janelas em 40 min (sobreposição de 3 min).
    call("channel_profile.set", json!({"maxUs": 180_000_000}));
    let source = seed();
    call("transcription.segment", json!({"source_id": source}));

    // Padrão do app: o endpoint antigo (local). Dois perfis a mais: um local e um remoto.
    call(
        "provider.configure",
        json!({"endpoint": LOCAL, "kind": "openai", "model": "default-model", "context": 32768}),
    );
    call(
        "provider.configure",
        json!({"profileId": "weak", "label": "Fraco local", "kind": "openai", "endpoint": "http://127.0.0.1:10/v1", "model": "weak-model"}),
    );
    call(
        "provider.configure",
        json!({"profileId": "strong", "label": "Forte remoto", "kind": "openai", "endpoint": REMOTE, "model": "strong-model"}),
    );
    // PreÃ§o do modelo forte: sem preÃ§o o custo Ã© desconhecido e o lote pausa (ADR-0009).
    call(
        "provider.prices.set",
        json!({"provider": "openai", "model": "strong-model", "inputPerMillion": 100.0, "outputPerMillion": 200.0}),
    );
    let defaults = call("assistant.status", json!({}));

    let fake = Arc::new(Fake::default());
    jobs::set_ai_provider(Some(fake.clone()));
    let planned = call("selection.estimate", json!({"source_id": source}))["plan"]["windows"]
        .as_array()
        .unwrap()
        .clone();
    let firsts: Vec<i64> = planned
        .iter()
        .map(|w| w["firstId"].as_i64().unwrap())
        .collect();
    assert!(planned.len() >= 4);
    fake.answer(firsts[0], vec![cand(10, 11, 6)]);
    fake.answer(firsts[1], vec![cand(firsts[1] + 3, firsts[1] + 4, 5)]);

    // ---- Execução padrão: revisão 1, todos os resultados do perfil padrão.
    let started = call("selection.start", json!({"source_id": source}));
    let run = started["run"].as_i64().unwrap();
    let first = settled(run, 1);
    assert_eq!(first["run"]["profile"], "legacy");
    assert_eq!(first["run"]["revisions"], json!([1]));
    let old_candidates = first["candidates"].as_array().unwrap().clone();
    assert_eq!(old_candidates.len(), 2);
    assert!(old_candidates.iter().all(|c| c["profile"] == "legacy"));
    assert!(first["windows"]
        .as_array()
        .unwrap()
        .iter()
        .all(|w| w["profile"] == "legacy"));
    let calls_before = fake.total();

    // O usuário já decidiu um candidato (#55): a decisão não pode sumir.
    let decided = old_candidates[0]["id"].as_i64().unwrap();
    call(
        "selection.decide",
        json!({"candidate": decided, "decision": "approved"}),
    );
    assert_eq!(decisions(run), 1);

    // ---- Perfil remoto: mostra perfil, custo e saída da máquina; exige confirmação.
    let ask = |extra: Value| {
        let mut args = json!({"run": run, "windows": [0], "profileId": "strong"});
        args.as_object_mut()
            .unwrap()
            .extend(extra.as_object().unwrap().clone());
        args
    };
    let preview = call("selection.estimate", ask(json!({})));
    assert_eq!(preview["profile"]["id"], "strong");
    assert_eq!(preview["profile"]["label"], "Forte remoto");
    assert_eq!(preview["profile"]["model"], "strong-model");
    assert_eq!(preview["paid"], true);
    assert_eq!(preview["leavesMachine"], true);
    assert_eq!(preview["windows"], json!([0]));
    assert!(preview["estimate"]["kind"].is_string());
    assert!(
        preview["profile"].get("endpoint").is_none(),
        "no endpoint in the preview"
    );
    let local_preview = call(
        "selection.estimate",
        json!({"run": run, "windows": [0], "profileId": "weak"}),
    );
    assert_eq!(local_preview["leavesMachine"], false);
    assert_eq!(local_preview["estimate"]["kind"], "zero");

    let needs = fail("selection.redo", ask(json!({})));
    assert_eq!(needs.code, "confirmation_required");
    let usage = needs.usage.unwrap();
    assert_eq!(usage["profile"]["id"], "strong");
    assert_eq!(usage["leavesMachine"], true);
    assert!(usage["estimate"]["kind"].is_string());
    assert_eq!(fake.total(), calls_before, "nothing was sent");

    // ---- Pedidos inválidos: nada é enviado.
    assert_eq!(
        fail(
            "selection.redo",
            json!({"run": run, "profileId": "strong", "confirmed": true})
        )
        .code,
        "windows_required"
    );
    assert_eq!(
        fail(
            "selection.redo",
            json!({"run": run, "windows": [99], "profileId": "strong", "confirmed": true})
        )
        .code,
        "window_not_found"
    );
    assert_eq!(
        fail(
            "selection.redo",
            json!({"run": run, "windows": [0], "profileId": "ghost", "confirmed": true})
        )
        .code,
        "invalid_settings"
    );

    // ---- "Somente local": por tarefa e por Projeto, recusa o perfil remoto antes da rede.
    call(
        "assistant.local_only.set",
        json!({"task": "selection", "enabled": true}),
    );
    let by_task = fail("selection.redo", ask(json!({"confirmed": true})));
    assert_eq!(by_task.code, "local_only_violation");
    assert_eq!(
        fail("selection.estimate", ask(json!({}))).code,
        "local_only_violation"
    );
    call(
        "assistant.local_only.set",
        json!({"task": "selection", "enabled": false}),
    );
    call("projects.local_only.set", json!({"enabled": true}));
    let by_project = fail("selection.redo", ask(json!({"confirmed": true})));
    assert_eq!(by_project.code, "local_only_violation");
    call("projects.local_only.set", json!({"enabled": false}));
    assert_eq!(fake.total(), calls_before, "the veto came before any call");
    assert_eq!(settled(run, 1)["run"]["state"], "completed");

    // ---- Refazer com o forte: nova revisão, perfil registrado, decisões e padrão intactos.
    fake.answer(firsts[0], vec![cand(12, 13, 9)]);
    let redone = call("selection.redo", ask(json!({"confirmed": true})));
    assert_eq!(redone["profile"]["id"], "strong");
    let second = settled(run, 2);
    assert_eq!(fake.total(), calls_before + 1, "only window 0 was redone");
    assert_eq!(second["run"]["profile"], "legacy", "the run keeps its own");
    assert_eq!(second["run"]["revisions"], json!([1, 2]));
    let windows = second["windows"].as_array().unwrap();
    assert_eq!(windows[0]["profile"], "strong");
    assert_eq!(windows[1]["profile"], "legacy");
    let new_candidates = second["candidates"].as_array().unwrap();
    assert_eq!(new_candidates.len(), 2);
    assert!(new_candidates.iter().all(|c| c["revision"] == 2));
    let of_window = |w: i64| {
        new_candidates
            .iter()
            .find(|c| c["windows"].as_array().unwrap().contains(&json!(w)))
            .unwrap()
    };
    assert_eq!(of_window(0)["profile"], "strong");
    assert_eq!(of_window(1)["profile"], "legacy");
    assert_eq!(of_window(0)["startId"], 12);
    let job0 = windows[0]["jobId"].as_i64().unwrap();
    assert_eq!(profile_of_job(job0), "strong", "the cost row names it");
    assert_eq!(
        call("selection.get", json!({"run": run, "revision": 1}))["candidates"],
        json!(old_candidates),
        "the first revision stays readable and unchanged"
    );
    assert_eq!(decisions(run), 1, "the #55 decision was not deleted");
    assert_eq!(
        call("assistant.status", json!({})),
        defaults,
        "no default changed"
    );

    // ---- Falha do perfil: nada de troca automática; o resultado anterior fica.
    *fake.fail_next.lock().unwrap() = Some("network");
    let jobs_before = job_count();
    let calls_now = fake.total();
    call(
        "selection.redo",
        json!({"run": run, "windows": [1], "profileId": "strong", "confirmed": true}),
    );
    let after_failure = settled(run, 2);
    assert_eq!(fake.total(), calls_now + 1, "one attempt, no fallback call");
    assert_eq!(job_count(), jobs_before + 1, "no other job was created");
    let w1 = &after_failure["windows"].as_array().unwrap()[1];
    assert_eq!(w1["redoFailed"], "network");
    assert_eq!(w1["profile"], "legacy", "the kept result is the old one");
    assert_eq!(after_failure["run"]["state"], "completed");
    assert_eq!(after_failure["candidates"].as_array().unwrap().len(), 2);
    assert_eq!(
        after_failure["run"]["summary"]["redoFailed"][0]["code"],
        "network"
    );
    assert_eq!(
        call("assistant.status", json!({})),
        defaults,
        "a failure does not move the default"
    );

    // ---- Comando genérico (Roteiro #73): qualquer unidade de IA, aqui com o perfil local.
    let generic_preview = call(
        "jobs.redo.estimate",
        json!({"id": job0, "profileId": "weak"}),
    );
    assert_eq!(generic_preview["leavesMachine"], false);
    let generic = call("jobs.redo", json!({"id": job0, "profileId": "weak"}));
    let new_job = generic["job"].as_i64().unwrap();
    assert_ne!(new_job, job0);
    let deadline = Instant::now() + Duration::from_secs(30);
    while profile_of_job(new_job).is_null() {
        assert!(Instant::now() < deadline, "generic redo never ran");
        std::thread::sleep(Duration::from_millis(25));
    }
    assert_eq!(profile_of_job(new_job), "weak");
    assert_eq!(
        fail("jobs.redo", json!({"id": job0, "profileId": "strong"})).code,
        "confirmation_required"
    );

    // ---- Janela com job `uncertain`: indisponível, com erro tipado.
    let job2 = windows[2]["jobId"].as_i64().unwrap();
    with_writer(|c| {
        c.execute(
            "UPDATE jobs SET state='uncertain',result='{\"outcome\":\"uncertain\",\"code\":\"timeout_uncertain\",\"cost\":\"unknown\"}' WHERE id=?1",
            [job2],
        )?;
        Ok(())
    })
    .unwrap();
    let calls_now = fake.total();
    let uncertain = fail(
        "selection.redo",
        json!({"run": run, "windows": [2], "profileId": "weak", "confirmed": true}),
    );
    assert_eq!(uncertain.code, "window_uncertain");
    assert_eq!(
        fail("jobs.redo", json!({"id": job2, "profileId": "weak"})).code,
        "job_uncertain"
    );
    assert_eq!(
        fail(
            "selection.estimate",
            json!({"run": run, "windows": [2], "profileId": "weak"})
        )
        .code,
        "window_uncertain"
    );
    assert_eq!(fake.total(), calls_now, "nothing was sent");

    // ---- Teto do lote: pausa antes de enviar.
    call(
        "jobs.budget.set",
        json!({"scope": "batch", "key": started["batch"], "maxTokens": 0}),
    );
    let calls_now = fake.total();
    call(
        "selection.redo",
        json!({"run": run, "windows": [3], "profileId": "strong", "confirmed": true}),
    );
    let paused = wait(run, "paused", |v| !v["run"]["budgetPause"].is_null());
    assert_eq!(paused["run"]["budgetPause"], "budget_tokens");
    assert_eq!(paused["run"]["state"], "running");
    assert_eq!(fake.total(), calls_now, "the ceiling stopped the call");
    call("selection.cancel", json!({"run": run}));
    assert_eq!(
        call("assistant.status", json!({})),
        defaults,
        "still no default changed"
    );
}
