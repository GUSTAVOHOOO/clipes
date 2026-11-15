//! Revisão dos Cortes candidatos (#55), headless e sem rede: Provedor falso na fila, Transcrição
//! gravada no Projeto e dados isolados em CLIPES_DATA_DIR. Um corpo de teste só (o Projeto aberto
//! e o Provedor injetado são do processo).
use clipes_core::{
    dispatch, jobs,
    projects::with_writer,
    provider::{cost::Target, CancelToken, Provider, StructuredRequest},
    CoreError,
};
use serde_json::{json, Value};
use std::{
    sync::{
        atomic::{AtomicI64, Ordering},
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
            let text = if position % 10 == 9 { " palavra." } else { " palavra" };
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

/// Provedor falso: os candidatos fixos saem só na primeira Janela; a Janela cujo primeiro ID é
/// `failing` falha enquanto o valor não for zerado.
struct Fake {
    candidates: Vec<Value>,
    failing: AtomicI64,
    _guard: Mutex<()>,
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
        let first: i64 = request
            .transcript
            .lines()
            .find(|l| !l.starts_with('#'))
            .and_then(|l| l.split(' ').next())
            .and_then(|id| id.parse().ok())
            .unwrap();
        if first == self.failing.load(Ordering::SeqCst) {
            return Err(CoreError {
                code: "verification_failed".into(),
                message: "fixed".into(),
                usage: None,
            });
        }
        let list = if first == 1 {
            self.candidates.clone()
        } else {
            vec![]
        };
        Ok(
            json!({"data": {"schemaVersion": 1, "candidates": list}, "usage": {"inputTokens": 10, "outputTokens": 5}, "calls": 1}),
        )
    }
}

fn settled(run: i64, state: &str) -> Value {
    let deadline = Instant::now() + Duration::from_secs(60);
    loop {
        let value = call("selection.get", json!({"run": run}));
        if value["run"]["state"] == state {
            return value;
        }
        assert!(
            Instant::now() < deadline,
            "run {run} never reached {state}: {value}"
        );
        std::thread::sleep(Duration::from_millis(25));
    }
}

fn item(review: &Value, candidate: i64) -> Value {
    review["items"]
        .as_array()
        .unwrap()
        .iter()
        .find(|i| i["candidate"] == candidate)
        .unwrap()
        .clone()
}

fn by_start(review: &Value, start: i64) -> Value {
    review["items"]
        .as_array()
        .unwrap()
        .iter()
        .find(|i| i["startId"] == start)
        .unwrap()
        .clone()
}

#[test]
fn review_decides_adjusts_undoes_and_survives_new_runs_redo_and_reopening() {
    let root = tempfile::tempdir().unwrap();
    std::env::set_var("CLIPES_DATA_DIR", root.path().join("data"));
    call(
        "projects.create",
        json!({"parent": root.path(), "name": "Canal"}),
    );
    let source = seed();
    call("transcription.segment", json!({"source_id": source}));
    call(
        "provider.configure",
        json!({"endpoint": "http://127.0.0.1:9/v1", "kind": "openai", "model": "fake-model", "context": 32768}),
    );
    let fake = Arc::new(Fake {
        candidates: vec![cand(10, 11, 9), cand(20, 22, 8), cand(60, 63, 7)],
        failing: AtomicI64::new(0),
        _guard: Mutex::new(()),
    });
    jobs::set_ai_provider(Some(fake.clone()));
    jobs::set_ai_route(Some((
        Target::Api {
            provider: "openai".into(),
            model: "fake-model".into(),
            local: true,
        },
        "legacy".into(),
    )));

    let run1 = call("selection.start", json!({"source_id": source}))["run"]
        .as_i64()
        .unwrap();
    let done = settled(run1, "completed");
    let ids: Vec<i64> = done["candidates"]
        .as_array()
        .unwrap()
        .iter()
        .map(|c| c["id"].as_i64().unwrap())
        .collect();
    assert_eq!(ids.len(), 3);
    let (best, middle, last) = (ids[0], ids[1], ids[2]);

    // Sem decisões: tudo pendente, com bordas, trechos e movimentos possíveis.
    let review = call("selection.review", json!({"run": run1}));
    assert_eq!(review["canUndo"], false);
    let first = item(&review, best);
    assert_eq!(first["status"], "pending");
    assert_eq!(
        (first["startId"].as_i64(), first["endId"].as_i64()),
        (Some(10), Some(11))
    );
    assert_eq!(
        (first["startUs"].as_i64(), first["endUs"].as_i64()),
        (Some(90_000_000), Some(110_000_000))
    );
    assert!(first["startText"].as_str().unwrap().contains("palavra"));
    // No mínimo de 20 s: não encurta, só estende.
    assert_eq!(
        first["moves"],
        json!({"startEarlier": true, "startLater": false, "endEarlier": false, "endLater": true})
    );

    // Aprovar e rejeitar; repetir a decisão não grava de novo, trocar grava.
    let approved = call(
        "selection.decide",
        json!({"candidate": best, "decision": "approved"}),
    );
    assert_eq!(approved["item"]["status"], "approved");
    assert_eq!(approved["canUndo"], true);
    call(
        "selection.decide",
        json!({"candidate": best, "decision": "approved"}),
    );
    call(
        "selection.decide",
        json!({"candidate": last, "decision": "rejected"}),
    );
    assert_eq!(
        fail(
            "selection.decide",
            json!({"candidate": best, "decision": "maybe"})
        )
        .code,
        "invalid_decision"
    );
    assert_eq!(
        fail(
            "selection.decide",
            json!({"candidate": 99_999, "decision": "approved"})
        )
        .code,
        "candidate_not_found"
    );

    // Ajustar: estender o fim e o início por Frase inteira; tempos derivados no núcleo.
    let widened = call(
        "selection.adjust",
        json!({"candidate": best, "edge": "end", "delta": 1}),
    );
    assert_eq!(widened["item"]["endId"], 12);
    assert_eq!(widened["item"]["endUs"], 120_000_000);
    assert_eq!(widened["item"]["adjusted"], true);
    assert_eq!(
        widened["item"]["status"], "approved",
        "ajustar não muda a situação"
    );
    let earlier = call(
        "selection.adjust",
        json!({"candidate": best, "edge": "start", "delta": -1}),
    );
    assert_eq!(
        (
            earlier["item"]["startId"].as_i64(),
            earlier["item"]["startUs"].as_i64()
        ),
        (Some(9), Some(80_000_000))
    );
    // Encurtar o início de volta; depois, com 30 s, encurtar o fim ainda cabe, mas não com 20 s.
    call(
        "selection.adjust",
        json!({"candidate": best, "edge": "start", "delta": 1}),
    );
    call(
        "selection.adjust",
        json!({"candidate": best, "edge": "end", "delta": -1}),
    );
    assert_eq!(
        fail(
            "selection.adjust",
            json!({"candidate": best, "edge": "end", "delta": -1})
        )
        .code,
        "adjust_too_short"
    );
    // O ajuste que sobrou volta ao original, sem marca de ajustado.
    assert_eq!(
        item(&call("selection.review", json!({"run": run1})), best)["adjusted"],
        false
    );

    // Limites: máximo (3 min) e bordas da Transcrição; nada é gravado nos erros.
    let before = call("selection.review", json!({"run": run1}));
    assert_eq!(
        fail(
            "selection.adjust",
            json!({"candidate": best, "edge": "end", "delta": 50})
        )
        .code,
        "adjust_too_long"
    );
    assert_eq!(
        fail(
            "selection.adjust",
            json!({"candidate": best, "edge": "start", "delta": -50})
        )
        .code,
        "adjust_out_of_transcript"
    );
    assert_eq!(
        fail(
            "selection.adjust",
            json!({"candidate": best, "edge": "start", "delta": 0})
        )
        .code,
        "invalid_delta"
    );
    assert_eq!(
        fail(
            "selection.adjust",
            json!({"candidate": best, "edge": "middle", "delta": 1})
        )
        .code,
        "invalid_edge"
    );
    assert_eq!(
        fail(
            "selection.adjust",
            json!({"candidate": best, "edge": "start", "delta": 5})
        )
        .code,
        "adjust_empty"
    );
    assert_eq!(
        call("selection.review", json!({"run": run1})),
        before,
        "erros não gravam"
    );
    // Desfazer retira a última decisão, uma de cada vez, até acabar.
    let undone = call("selection.undo", json!({"run": run1}));
    assert_eq!(undone["item"]["candidate"], best);
    assert_eq!(
        undone["item"]["endId"], 12,
        "a anterior (fim estendido) volta a valer"
    );
    let mut guard = 0;
    while call("selection.review", json!({"run": run1}))["canUndo"] == true {
        call("selection.undo", json!({"run": run1}));
        guard += 1;
        assert!(guard < 20);
    }
    assert_eq!(
        fail("selection.undo", json!({"run": run1})).code,
        "nothing_to_undo"
    );
    assert_eq!(
        item(&call("selection.review", json!({"run": run1})), best)["status"],
        "pending"
    );

    // Persistência: decide de novo, fecha e reabre o Projeto.
    call(
        "selection.decide",
        json!({"candidate": best, "decision": "approved"}),
    );
    call(
        "selection.adjust",
        json!({"candidate": middle, "edge": "end", "delta": 1}),
    );
    call(
        "selection.decide",
        json!({"candidate": last, "decision": "rejected"}),
    );
    let path = call("projects.current", json!({}))["path"].clone();
    let saved = call("selection.review", json!({"run": run1}));
    call("projects.close", json!({}));
    call("projects.open", json!({"path": path}));
    let reopened = call("selection.review", json!({"run": run1}));
    assert_eq!(reopened, saved);
    assert_eq!(item(&reopened, best)["status"], "approved");
    assert_eq!(item(&reopened, middle)["endId"], 23);
    assert_eq!(item(&reopened, last)["status"], "rejected");

    // Os registros guardam candidato, decisão, bordas antes e depois e data.
    type Row = (i64, i64, String, i64, i64, i64, i64, String);
    let rows: Vec<Row> = clipes_core::projects::with_reader(|c| {
        let mut q = c.prepare("SELECT cand_start_id,cand_end_id,decision,before_start_id,before_end_id,after_start_id,after_end_id,decided_at FROM selection_decisions WHERE run_id=?1 ORDER BY id")?;
        let rows = q.query_map([run1], |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?, r.get(3)?, r.get(4)?, r.get(5)?, r.get(6)?, r.get(7)?)))?;
        rows.collect()
    })
    .unwrap();
    assert_eq!(rows.len(), 3);
    assert_eq!(
        (rows[1].0, rows[1].1, rows[1].2.as_str()),
        (20, 22, "adjusted")
    );
    assert_eq!(
        (rows[1].3, rows[1].4, rows[1].5, rows[1].6),
        (20, 22, 20, 23)
    );
    assert!(rows[1].7.starts_with("20"));

    // Nova execução (#53): outra run, decisões da primeira intactas e a nova começa pendente.
    let run2 = call("selection.start", json!({"source_id": source}))["run"]
        .as_i64()
        .unwrap();
    assert_ne!(run1, run2);
    let second = settled(run2, "completed");
    let new_best = second["candidates"][0]["id"].as_i64().unwrap();
    let fresh = call("selection.review", json!({"run": run2}));
    assert_eq!(item(&fresh, new_best)["status"], "pending");
    assert_eq!(fresh["canUndo"], false);
    call(
        "selection.decide",
        json!({"candidate": new_best, "decision": "rejected"}),
    );
    assert_eq!(
        call("selection.review", json!({"run": run1})),
        saved,
        "execução anterior intacta"
    );
    call("selection.undo", json!({"run": run2}));
    assert_eq!(
        call("selection.review", json!({"run": run1})),
        saved,
        "desfazer só atinge a própria execução"
    );

    // Refazer uma Janela da mesma execução regrava os candidatos; as decisões seguem as bordas.
    let plan = call("selection.estimate", json!({"source_id": source}));
    let second_first = plan["plan"]["windows"][1]["firstId"].as_i64().unwrap();
    fake.failing.store(second_first, Ordering::SeqCst);
    let run3 = call("selection.start", json!({"source_id": source}))["run"]
        .as_i64()
        .unwrap();
    let partial = settled(run3, "partial");
    let c3 = partial["candidates"][0]["id"].as_i64().unwrap();
    call(
        "selection.decide",
        json!({"candidate": c3, "decision": "approved"}),
    );
    let c3_start = partial["candidates"][0]["startId"].as_i64().unwrap();
    fake.failing.store(0, Ordering::SeqCst);
    call("selection.redo", json!({"run": run3, "windows": [1]}));
    settled(run3, "completed");
    let after = call("selection.review", json!({"run": run3}));
    assert_eq!(
        by_start(&after, c3_start)["status"],
        "approved",
        "a decisão seguiu o candidato regravado"
    );
    assert_eq!(after["canUndo"], true);
    call("projects.close", json!({}));
}
