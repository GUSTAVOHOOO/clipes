//! Seleção de Cortes (#53), headless e sem rede: Provedor falso injetado na fila, Transcrição
//! gravada direto no Projeto e dados isolados em CLIPES_DATA_DIR. Um corpo de teste só: o
//! Projeto aberto, o Provedor injetado e a rota são do processo.
use clipes_core::{
    dispatch, jobs,
    projects::with_writer,
    provider::{cost::Target, CancelToken, Provider, StructuredRequest},
    CoreError,
};
use serde_json::{json, Value};
use std::{
    collections::HashMap,
    sync::{
        atomic::{AtomicBool, Ordering},
        Arc, Mutex,
    },
    time::{Duration, Instant},
};

fn call(name: &str, args: Value) -> Value {
    dispatch(name, args, &mut |_| {}).unwrap()
}

fn fail(name: &str, args: Value) -> CoreError {
    dispatch(name, args, &mut |_| {}).unwrap_err()
}

/// Uma Frase de 10 s por ID: a Frase k vai de 10(k-1) s a 10k s, sem pausas.
const SENTENCES: i64 = 240;

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

fn axes(scores: [i64; 5]) -> Value {
    let mut out = json!({});
    for (key, score) in ["hook", "selfContained", "energy", "value", "closing"]
        .iter()
        .zip(scores)
    {
        out[*key] = json!({"score": score, "why": "motivo curto"});
    }
    out
}

fn cand(start: i64, end: i64, scores: [i64; 5]) -> Value {
    let mut c = axes(scores);
    c["startId"] = json!(start);
    c["endId"] = json!(end);
    c["title"] = json!("");
    c
}

#[derive(Clone)]
enum Behavior {
    Candidates(Vec<Value>),
    /// Sai com IDs que não existem na Janela.
    OutsideIds,
    /// Violação do schema completo (nota 11).
    BadScore,
    Error(&'static str),
    /// Espera o cancelamento.
    Block,
}

/// Provedor falso: o comportamento vem do ID da primeira Frase da Janela.
#[derive(Default)]
struct Fake {
    plan: Mutex<HashMap<i64, Behavior>>,
    calls: Mutex<Vec<i64>>,
    entered: AtomicBool,
    transcripts: Mutex<Vec<String>>,
}

impl Fake {
    fn set(&self, plan: Vec<(i64, Behavior)>) {
        *self.plan.lock().unwrap() = plan.into_iter().collect();
        self.calls.lock().unwrap().clear();
    }
    fn calls_of(&self, first: i64) -> usize {
        self.calls
            .lock()
            .unwrap()
            .iter()
            .filter(|c| **c == first)
            .count()
    }
    fn total(&self) -> usize {
        self.calls.lock().unwrap().len()
    }
}

fn first_id(transcript: &str) -> i64 {
    transcript
        .lines()
        .find(|l| !l.starts_with('#'))
        .and_then(|l| l.split(' ').next())
        .and_then(|id| id.parse().ok())
        .expect("a window starts with a sentence id")
}

impl Provider for Fake {
    fn structured(&self, _: &StructuredRequest) -> Result<Value, CoreError> {
        unreachable!("the executor must use structured_with")
    }
    fn structured_with(
        &self,
        request: &StructuredRequest,
        cancel: &CancelToken,
    ) -> Result<Value, CoreError> {
        assert!(request.transcript.starts_with("#JANELA max_candidatos="));
        self.transcripts
            .lock()
            .unwrap()
            .push(request.transcript.clone());
        let first = first_id(&request.transcript);
        self.calls.lock().unwrap().push(first);
        let behavior = self.plan.lock().unwrap().get(&first).cloned();
        let reply = |candidates: Vec<Value>| {
            Ok(
                json!({"data": {"schemaVersion": 1, "candidates": candidates}, "usage": {"inputTokens": 10, "outputTokens": 5}, "calls": 1}),
            )
        };
        let error = |code: &str| CoreError {
            code: code.into(),
            message: "fixed".into(),
            usage: None,
        };
        match behavior.unwrap_or(Behavior::Candidates(vec![])) {
            Behavior::Candidates(list) => reply(list),
            Behavior::OutsideIds => reply(vec![cand(99_998, 99_999, [5; 5])]),
            Behavior::BadScore => reply(vec![cand(first, first, [11, 5, 5, 5, 5])]),
            Behavior::Error(code) => Err(error(code)),
            Behavior::Block => {
                self.entered.store(true, Ordering::SeqCst);
                loop {
                    if cancel.is_cancelled() {
                        return Err(error("cancelled"));
                    }
                    std::thread::sleep(Duration::from_millis(10));
                }
            }
        }
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

fn finished(run: i64, state: &str) -> Value {
    wait(run, state, |v| v["run"]["state"] == state)
}

fn configure(endpoint: &str, context: u64) {
    call(
        "provider.configure",
        json!({"endpoint": endpoint, "kind": "openai", "model": "fake-model", "context": context}),
    );
}

#[test]
fn selection_runs_windows_adjusts_borders_and_resumes_without_repeating() {
    let root = tempfile::tempdir().unwrap();
    std::env::set_var("CLIPES_DATA_DIR", root.path().join("data"));
    call(
        "projects.create",
        json!({"parent": root.path(), "name": "Canal"}),
    );
    let source = seed();
    call("transcription.segment", json!({"source_id": source}));
    let boundaries: Vec<(i64, i64)> = call(
        "transcription.sentences",
        json!({"source_id": source, "limit": 1000}),
    )
    .as_array()
    .unwrap()
    .iter()
    .map(|s| {
        (
            s["start_us"].as_i64().unwrap(),
            s["end_us"].as_i64().unwrap(),
        )
    })
    .collect();
    assert_eq!(boundaries.len() as i64, SENTENCES);

    // Contexto pequeno demais: bloqueada, com a mensagem tipada do planejador (#144).
    configure("http://127.0.0.1:9/v1", 4096);
    let blocked = fail("selection.start", json!({"source_id": source}));
    assert_eq!(blocked.code, "context_too_small");
    assert!(blocked.message.contains("4096"));
    let too_long = {
        configure("http://127.0.0.1:9/v1", 32768);
        fail(
            "selection.estimate",
            json!({"source_id": source, "maxUs": 400_000_000}),
        )
    };
    assert_eq!(too_long.code, "max_cut_too_long");

    // Provedor pago: pede confirmação com a estimativa; o veto "somente local" vem antes de tudo.
    configure("https://192.0.2.10/v1", 32768);
    let paid = fail("selection.start", json!({"source_id": source}));
    assert_eq!(paid.code, "confirmation_required");
    assert!(paid.usage.unwrap()["estimate"]["windows"].as_u64().unwrap() >= 4);
    call(
        "assistant.local_only.set",
        json!({"task": "selection", "enabled": true}),
    );
    let vetoed = fail(
        "selection.start",
        json!({"source_id": source, "confirmed": true}),
    );
    assert_eq!(vetoed.code, "local_only_violation");
    call(
        "assistant.local_only.set",
        json!({"task": "selection", "enabled": false}),
    );
    assert!(call("selection.list", json!({"source_id": source}))
        .as_array()
        .unwrap()
        .is_empty());

    // A partir daqui: modelo local (loopback) com o Provedor falso injetado.
    configure("http://127.0.0.1:9/v1", 32768);
    let fake = Arc::new(Fake::default());
    jobs::set_ai_provider(Some(fake.clone()));
    jobs::set_ai_route(Some((
        Target::Api {
            provider: "openai".into(),
            model: "fake-model".into(),
            local: true,
        },
        "legacy".into(),
    )));
    let estimate = call("selection.estimate", json!({"source_id": source}));
    assert_eq!(estimate["paid"], false);
    let planned = estimate["plan"]["windows"].as_array().unwrap().clone();
    assert!(planned.len() >= 4, "40 min need at least four windows");
    assert_eq!(estimate["estimate"]["kind"], "zero");
    let weights: Vec<f64> = estimate["weights"]
        .as_array()
        .unwrap()
        .iter()
        .map(|w| w["weight"].as_f64().unwrap())
        .collect();
    assert_eq!(weights, [0.30, 0.20, 0.20, 0.15, 0.15]);
    let firsts: Vec<i64> = planned
        .iter()
        .map(|w| w["firstId"].as_i64().unwrap())
        .collect();
    let lasts: Vec<i64> = planned
        .iter()
        .map(|w| w["lastId"].as_i64().unwrap())
        .collect();
    let n = planned.len();

    // ---- Execução 1: bordas, duplicatas, ordem e Janela sem candidatos.
    let mut plan = vec![
        (
            firsts[0],
            Behavior::Candidates(vec![
                cand(10, 11, [8, 6, 7, 9, 5]),
                cand(20, 20, [5; 5]),
                cand(30, 60, [4; 5]),
                cand(lasts[0] - 4, lasts[0] - 2, [9; 5]),
            ]),
        ),
        (
            firsts[1],
            Behavior::Candidates(vec![cand(lasts[0] - 4, lasts[0] - 1, [7; 5])]),
        ),
        (firsts[2], Behavior::Candidates(vec![])),
        (
            firsts[n - 1],
            Behavior::Candidates(vec![cand(lasts[n - 1], lasts[n - 1], [6; 5])]),
        ),
    ];
    for i in 3..n - 1 {
        plan.push((firsts[i], Behavior::Candidates(vec![])));
    }
    fake.set(plan);
    let started = call("selection.start", json!({"source_id": source}));
    let run1 = started["run"].as_i64().unwrap();
    assert_eq!(started["windows"].as_u64().unwrap() as usize, n);
    let done = finished(run1, "completed");
    assert_eq!(fake.total(), n);
    let head = &done["run"];
    assert_eq!(head["taskVersion"], 1);
    assert_eq!(head["promptSha256"].as_str().unwrap().len(), 64);
    assert_eq!(head["profile"], "legacy");
    assert_eq!(head["counts"]["windows"], n);
    assert_eq!(head["summary"]["candidates"]["proposed"], 6);
    assert_eq!(head["summary"]["candidates"]["merged"], 1);
    assert_eq!(head["summary"]["candidates"]["adjusted"], 3);
    assert_eq!(head["summary"]["candidates"]["kept"], 5);
    let list = done["candidates"].as_array().unwrap();
    let totals: Vec<i64> = list
        .iter()
        .map(|c| c["totalCenti"].as_i64().unwrap())
        .collect();
    assert_eq!(
        totals,
        [900, 710, 600, 500, 400],
        "ordered by total, best first"
    );
    assert_eq!(list[1]["total"], 7.10);
    // Nenhuma borda no meio de Frase e todos os Cortes dentro da faixa de 20 s a 3 min.
    for c in list {
        let (start, end) = (c["startUs"].as_i64().unwrap(), c["endUs"].as_i64().unwrap());
        assert!(
            boundaries.iter().any(|b| b.0 == start),
            "start is a sentence start"
        );
        assert!(
            boundaries.iter().any(|b| b.1 == end),
            "end is a sentence end"
        );
        assert!((20_000_000..=180_000_000).contains(&(end - start)));
        assert_eq!(c["axes"]["hook"]["why"], "motivo curto");
    }
    // O duplicado ficou com a Nota maior e lembra as duas Janelas.
    assert_eq!(list[0]["windows"], json!([0, 1]));
    assert_eq!(list[0]["adjusted"], false);
    // Curto estendido para a frente; último da Fonte estendido para trás; longo encurtado.
    let by_start = |id: i64| list.iter().find(|c| c["startId"] == id).unwrap();
    assert_eq!(by_start(20)["endId"], 21);
    assert_eq!(by_start(20)["adjust"]["extendedAfter"], 1);
    let tail = by_start(lasts[n - 1] - 1);
    assert_eq!(tail["endId"], lasts[n - 1]);
    assert_eq!(tail["adjust"]["extendedBefore"], 1);
    assert_eq!(by_start(30)["endId"], 47);
    assert_eq!(by_start(30)["adjust"]["trimmedEnd"], 13);
    assert_eq!(done["windows"].as_array().unwrap().len(), n);

    // ---- Execução 2: saída inválida e truncamento derrubam só a própria Janela.
    let mut plan: Vec<(i64, Behavior)> = (0..n)
        .map(|i| (firsts[i], Behavior::Candidates(vec![])))
        .collect();
    plan[0].1 = Behavior::OutsideIds;
    plan[1].1 = Behavior::Candidates(vec![cand(lasts[0] - 4, lasts[0] - 1, [7; 5])]);
    plan[2].1 = Behavior::Error("context_truncated");
    plan[3].1 = Behavior::BadScore;
    fake.set(plan.clone());
    let run2 = call("selection.start", json!({"source_id": source}))["run"]
        .as_i64()
        .unwrap();
    let partial = finished(run2, "partial");
    let failures = partial["run"]["summary"]["windows"]["failed"]
        .as_array()
        .unwrap()
        .clone();
    assert_eq!(
        failures,
        [
            json!({"window": 0, "code": "verification_failed"}),
            json!({"window": 2, "code": "context_truncated"}),
            json!({"window": 3, "code": "output_invalid"}),
        ]
    );
    assert_eq!(partial["run"]["counts"]["completed"], n - 3);
    // Só a Janela 1 contribuiu; a truncada não é aceita, nem a inválida.
    let kept = partial["candidates"].as_array().unwrap();
    assert_eq!(kept.len(), 1);
    assert_eq!(kept[0]["windows"], json!([1]));
    // O erro não carrega texto do modelo nem da Transcrição.
    assert!(!partial.to_string().contains("palavra"));
    assert!(!partial.to_string().contains("99999"));
    // Janela concluída não se refaz; a que falhou, sim, e só ela.
    assert_eq!(
        fail("selection.redo", json!({"run": run2, "windows": [1]})).code,
        "window_not_redoable"
    );
    plan[0].1 = Behavior::Candidates(vec![cand(10, 11, [8; 5])]);
    fake.set(plan.clone());
    call("selection.redo", json!({"run": run2, "windows": [0]}));
    assert_eq!(
        wait(run2, "recovered window 0", |v| v["run"]["counts"]
            ["completed"]
            == (n - 2) as i64)["run"]["state"],
        "partial"
    );
    plan[2].1 = Behavior::Candidates(vec![]);
    plan[3].1 = Behavior::Candidates(vec![]);
    fake.set(plan);
    call("selection.resume", json!({"run": run2}));
    let healed = finished(run2, "completed");
    assert_eq!(
        fake.calls_of(firsts[1]),
        0,
        "completed windows are never repeated"
    );
    assert_eq!(fake.calls_of(firsts[0]), 0);
    assert_eq!(fake.total(), 2);
    assert_eq!(healed["candidates"].as_array().unwrap().len(), 2);
    assert_eq!(
        fail("selection.resume", json!({"run": run2})).code,
        "nothing_to_redo"
    );
    // Reexecutar cria uma execução nova e não apaga a anterior.
    assert_eq!(
        call("selection.list", json!({"source_id": source}))
            .as_array()
            .unwrap()
            .len(),
        2
    );
    assert_eq!(
        call("selection.get", json!({"run": run1}))["candidates"]
            .as_array()
            .unwrap()
            .len(),
        5
    );

    // ---- Execução 3: o orçamento do lote pausa a seleção; continuar completa sem repetir.
    let run3 = run2 + 1;
    call(
        "jobs.budget.set",
        json!({"scope": "batch", "key": format!("selection-{run3}"), "maxCalls": 2}),
    );
    fake.set(
        (0..n)
            .map(|i| (firsts[i], Behavior::Candidates(vec![])))
            .collect(),
    );
    assert_eq!(
        call("selection.start", json!({"source_id": source}))["run"],
        run3
    );
    let paused = wait(run3, "paused", |v| v["run"]["budgetPause"].is_string());
    assert_eq!(paused["run"]["budgetPause"], "budget_calls");
    assert_eq!(paused["run"]["state"], "running");
    assert_eq!(paused["run"]["counts"]["completed"], 2);
    assert_eq!(fake.total(), 2);
    call(
        "jobs.budget.continue",
        json!({"scope": "batch", "key": format!("selection-{run3}"), "maxCalls": 100}),
    );
    let resumed = finished(run3, "completed");
    assert_eq!(resumed["run"]["counts"]["completed"], n);
    assert_eq!(
        fake.total(),
        n,
        "paused windows run once, finished ones are not repeated"
    );
    assert_eq!(
        resumed["candidates"].as_array().unwrap().len(),
        0,
        "an empty answer is valid"
    );

    // ---- Execução 4: cancelar no meio e retomar só o que falta.
    let mut plan: Vec<(i64, Behavior)> = (0..n)
        .map(|i| (firsts[i], Behavior::Candidates(vec![])))
        .collect();
    plan[1].1 = Behavior::Block;
    fake.set(plan.clone());
    fake.entered.store(false, Ordering::SeqCst);
    let run4 = call("selection.start", json!({"source_id": source}))["run"]
        .as_i64()
        .unwrap();
    let deadline = Instant::now() + Duration::from_secs(30);
    while !fake.entered.load(Ordering::SeqCst) {
        assert!(Instant::now() < deadline, "window 1 never started");
        std::thread::sleep(Duration::from_millis(10));
    }
    call("selection.cancel", json!({"run": run4}));
    let cancelled = finished(run4, "partial");
    let windows = cancelled["windows"].as_array().unwrap();
    assert_eq!(windows[0]["state"], "completed");
    assert!(windows[1..].iter().all(|w| w["code"] == "cancelled"));
    plan[1].1 = Behavior::Candidates(vec![]);
    fake.set(plan);
    call("selection.resume", json!({"run": run4}));
    finished(run4, "completed");
    assert_eq!(
        fake.calls_of(firsts[0]),
        0,
        "the window completed before the cancel is not repeated"
    );
    assert_eq!(fake.total(), n - 1);

    // ---- Execução 5: faixa curta demais para as Frases: candidatos impossíveis são descartados.
    let range = json!({"source_id": source, "minUs": 5_000_000, "maxUs": 8_000_000});
    let small = call("selection.estimate", range.clone());
    let small_windows = small["plan"]["windows"].as_array().unwrap().clone();
    fake.set(
        small_windows
            .iter()
            .map(|w| {
                let first = w["firstId"].as_i64().unwrap();
                (
                    first,
                    Behavior::Candidates(vec![cand(first, first, [9; 5])]),
                )
            })
            .collect(),
    );
    let run5 = call("selection.start", range)["run"].as_i64().unwrap();
    let impossible = finished(run5, "completed");
    assert_eq!(
        impossible["run"]["summary"]["candidates"]["discarded"]["tooLong"],
        small_windows.len()
    );
    assert_eq!(impossible["run"]["counts"]["kept"], 0);
    assert_eq!(
        impossible["run"]["counts"]["discarded"],
        small_windows.len()
    );
    assert_eq!(
        fail(
            "selection.start",
            json!({"source_id": source, "minUs": 9, "maxUs": 5})
        )
        .code,
        "invalid_cut_range"
    );
}
