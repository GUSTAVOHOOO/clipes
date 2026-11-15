//! Energia do áudio na seleção (#54), headless e sem rede: Provedor falso na fila, Transcrição e
//! série de energia gravadas direto no Projeto, dados isolados em CLIPES_DATA_DIR. Um corpo de
//! teste só: o Projeto aberto, o Provedor injetado e a rota são do processo.
use clipes_core::{
    dispatch, jobs,
    projects::with_writer,
    provider::{cost::Target, CancelToken, Provider, StructuredRequest},
    CoreError,
};
use serde_json::{json, Value};
use std::{
    sync::{Arc, Mutex},
    time::{Duration, Instant},
};

fn call(name: &str, args: Value) -> Value {
    dispatch(name, args, &mut |_| {}).unwrap()
}

/// Uma Frase de 10 s por ID.
const SENTENCES: i64 = 240;

fn seed() -> (i64, i64) {
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
        Ok((source, transcript))
    })
    .unwrap()
}

/// Série medida: base -30 dB, Frases 15 e 100 com grito (+20 dB) e 50, 60, 70 e 80 fortes (+5 dB).
fn measure(transcript: i64) {
    with_writer(|c| {
        for id in 1..=SENTENCES {
            let centi: i64 = match id {
                15 | 100 => -1_000,
                50 | 60 | 70 | 80 => -2_500,
                _ => -3_000,
            };
            c.execute(
                "INSERT INTO sentence_energy(transcript_id,sentence_id,loudness_centi) VALUES (?1,?2,?3)",
                (transcript, id, centi),
            )?;
        }
        c.execute(
            "INSERT INTO energy_measurements(transcript_id,method,sentences) VALUES (?1,1,?2)",
            (transcript, SENTENCES),
        )?;
        Ok(())
    })
    .unwrap();
}

/// Provedor falso: devolve lista vazia, exceto a Janela configurada para falhar, e guarda o
/// texto enviado.
#[derive(Default)]
struct Fake {
    sent: Mutex<Vec<String>>,
    fail_first_id: Mutex<Option<i64>>,
}

fn first_id(transcript: &str) -> i64 {
    transcript
        .lines()
        .find(|l| !l.starts_with('#'))
        .and_then(|l| l.split(' ').next())
        .and_then(|id| id.parse().ok())
        .unwrap()
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
        self.sent.lock().unwrap().push(request.transcript.clone());
        if *self.fail_first_id.lock().unwrap() == Some(first_id(&request.transcript)) {
            return Err(CoreError {
                code: "provider_http".into(),
                message: "fixed".into(),
                usage: None,
            });
        }
        Ok(
            json!({"data": {"schemaVersion": 1, "candidates": []}, "usage": {"inputTokens": 10, "outputTokens": 5}, "calls": 1}),
        )
    }
}

fn wait(run: i64, state: &str) -> Value {
    let deadline = Instant::now() + Duration::from_secs(60);
    loop {
        let value = call("selection.get", json!({"run": run}));
        if value["run"]["state"] == state {
            return value;
        }
        assert!(
            Instant::now() < deadline,
            "run {run} never {state}: {value}"
        );
        std::thread::sleep(Duration::from_millis(25));
    }
}

fn marked_lines(texts: &[String], mark: &str) -> usize {
    texts
        .iter()
        .flat_map(|t| t.lines())
        .filter(|l| l.contains(mark))
        .count()
}

#[test]
fn marks_reach_the_provider_and_the_plan_only_when_the_energy_was_measured() {
    let root = tempfile::tempdir().unwrap();
    std::env::set_var("CLIPES_DATA_DIR", root.path().join("data"));
    call(
        "projects.create",
        json!({"parent": root.path(), "name": "Canal"}),
    );
    let (source, transcript) = seed();
    call("transcription.segment", json!({"source_id": source}));
    call(
        "provider.configure",
        json!({"endpoint": "http://127.0.0.1:9/v1", "kind": "openai", "model": "fake-model", "context": 32768}),
    );
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

    // Sem energia medida: nenhuma marca, a estimativa diz isso e a execução também.
    let before = call("selection.estimate", json!({"source_id": source}));
    assert_eq!(before["energy"], json!({"measured": false}));
    assert_eq!(
        call("energy.status", json!({"source_id": source}))["measured"],
        false
    );
    let windows = before["plan"]["windows"].as_array().unwrap().clone();
    let second_first = windows[1]["firstId"].as_i64().unwrap();
    *fake.fail_first_id.lock().unwrap() = Some(second_first);
    let run1 = call("selection.start", json!({"source_id": source}))["run"]
        .as_i64()
        .unwrap();
    let partial = wait(run1, "partial");
    assert_eq!(
        partial["run"]["summary"]["energy"],
        json!({"measured": false})
    );
    assert_eq!(marked_lines(&fake.sent.lock().unwrap(), "[energia"), 0);

    // A energia fica pronta depois: o plano e a estimativa passam a enxergar as marcas...
    measure(transcript);
    let status = call("energy.status", json!({"source_id": source}));
    assert_eq!(status["measured"], true);
    assert_eq!(status["marks"], json!({"high": 4, "peak": 2}));
    let after = call("selection.estimate", json!({"source_id": source}));
    assert_eq!(
        after["energy"],
        json!({"measured": true, "high": 4, "peak": 2})
    );
    assert!(
        after["estimate"]["inputTokens"].as_u64().unwrap()
            > before["estimate"]["inputTokens"].as_u64().unwrap(),
        "as marcas são texto enviado e entram na estimativa de tokens"
    );

    // ... mas refazer a Janela da execução sem energia continua sem marcas (decisão no início).
    *fake.fail_first_id.lock().unwrap() = None;
    fake.sent.lock().unwrap().clear();
    call("selection.redo", json!({"run": run1}));
    let redone = wait(run1, "completed");
    assert_eq!(
        redone["run"]["summary"]["energy"],
        json!({"measured": false})
    );
    assert_eq!(marked_lines(&fake.sent.lock().unwrap(), "[energia"), 0);

    // Uma execução nova usa as marcas, só nas Frases certas, com o formato do #140.
    fake.sent.lock().unwrap().clear();
    let run2 = call("selection.start", json!({"source_id": source}))["run"]
        .as_i64()
        .unwrap();
    let done = wait(run2, "completed");
    assert_eq!(
        done["run"]["summary"]["energy"],
        json!({"measured": true, "high": 4, "peak": 2})
    );
    let sent = fake.sent.lock().unwrap().clone();
    let all: Vec<&str> = sent.iter().flat_map(|t| t.lines()).collect();
    let body = "palavra palavra palavra palavra palavra palavra palavra palavra palavra palavra.";
    for (id, mark) in [
        (15, "[energia pico]"),
        (100, "[energia pico]"),
        (50, "[energia alta]"),
    ] {
        assert!(
            all.contains(&format!("{id} {mark} {body}").as_str()),
            "frase {id} sem a marca {mark}"
        );
    }
    // As Janelas se sobrepõem: cada Frase marcada aparece pelo menos uma vez, e nenhuma outra.
    assert!(marked_lines(&sent, "[energia pico]") >= 2);
    assert!(marked_lines(&sent, "[energia alta]") >= 4);
    assert!(!all
        .iter()
        .any(|l| l.starts_with("14 [") || l.starts_with("16 [")));
    // Nenhum número de loudness nem tempo vazou para o texto.
    assert!(!sent.iter().any(|t| t.contains("dB") || t.contains("-30")));
}
