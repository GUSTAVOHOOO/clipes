//! Tipo de vídeo da seleção (#67), headless e sem rede: Provedor falso na fila, Transcrição
//! gravada direto no Projeto e dados isolados em CLIPES_DATA_DIR. Um corpo de teste só: o
//! Projeto aberto, o Provedor injetado e a rota são do processo.
use clipes_core::{
    dispatch, jobs,
    projects::{with_reader, with_writer},
    provider::{cost::Target, CancelToken, Provider, StructuredRequest},
    CoreError,
};
use serde_json::{json, Value};
use std::{
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

fn seed(n: i64) -> i64 {
    with_writer(|c| {
        c.execute("INSERT INTO sources(path,size,duration_us,partial_hash,metadata,permission,audio_track) VALUES (?1,1,2400000000,?2,'{}','{}',0)", (format!("C:/videos/live{n}.mp4"), format!("h{n}")))?;
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

fn axis(score: i64) -> Value {
    json!({"score": score, "why": "motivo curto"})
}

/// Candidato de 30 s (Frases 10 a 12). `commentary` só entra quando pedido.
fn candidate(commentary: Option<i64>) -> Value {
    let mut c = json!({
        "startId": 10, "endId": 12, "title": "",
        "hook": axis(8), "selfContained": axis(5), "energy": axis(7), "value": axis(6), "closing": axis(4),
    });
    if let Some(score) = commentary {
        c["commentary"] = axis(score);
    }
    c
}

/// Provedor falso: devolve um candidato com os eixos que o schema pedido tem; com `omit_sixth`,
/// esquece o 6º eixo mesmo quando o schema o exige (resposta inválida).
#[derive(Default)]
struct Fake {
    omit_sixth: AtomicBool,
    schemas: Mutex<Vec<bool>>,
    instructions: Mutex<Vec<String>>,
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
        let wants_sixth = request.schema.to_string().contains("commentary");
        self.schemas.lock().unwrap().push(wants_sixth);
        self.instructions
            .lock()
            .unwrap()
            .push(request.instruction.clone());
        let first = request
            .transcript
            .lines()
            .find(|l| !l.starts_with('#'))
            .and_then(|l| l.split(' ').next())
            .and_then(|id| id.parse::<i64>().ok())
            .unwrap();
        // Só a Janela que contém as Frases 10 a 12 propõe o candidato.
        let candidates = if first <= 10 {
            let sixth = (wants_sixth && !self.omit_sixth.load(Ordering::SeqCst)).then_some(9);
            vec![candidate(sixth)]
        } else {
            vec![]
        };
        Ok(
            json!({"data": {"schemaVersion": 1, "candidates": candidates}, "usage": {"inputTokens": 10, "outputTokens": 5}, "calls": 1}),
        )
    }
}

fn finished(run: i64, state: &str) -> Value {
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

fn configure(endpoint: &str) {
    call(
        "provider.configure",
        json!({"endpoint": endpoint, "kind": "openai", "model": "fake-model", "context": 32768}),
    );
}

fn weights(value: &Value) -> Vec<(String, f64)> {
    value
        .as_array()
        .unwrap()
        .iter()
        .map(|w| {
            (
                w["key"].as_str().unwrap().to_owned(),
                w["weight"].as_f64().unwrap(),
            )
        })
        .collect()
}

fn keys(value: &Value) -> Vec<String> {
    let mut keys: Vec<String> = value.as_object().unwrap().keys().cloned().collect();
    keys.sort();
    keys
}

#[test]
fn video_kind_picks_the_six_axis_task_and_leaves_the_direct_cut_unchanged() {
    let root = tempfile::tempdir().unwrap();
    std::env::set_var("CLIPES_DATA_DIR", root.path().join("data"));
    call(
        "projects.create",
        json!({"parent": root.path(), "name": "Canal"}),
    );
    let source = seed(1);
    call("transcription.segment", json!({"source_id": source}));

    // Tipo inválido: recusado antes de qualquer coisa, sem execução criada.
    configure("http://127.0.0.1:9/v1");
    for bad in [json!("dark"), json!(7)] {
        let args = json!({"source_id": source, "videoKind": bad});
        assert_eq!(
            fail("selection.start", args.clone()).code,
            "invalid_video_kind"
        );
        assert_eq!(fail("selection.estimate", args).code, "invalid_video_kind");
    }
    assert!(call("selection.list", json!({"source_id": source}))
        .as_array()
        .unwrap()
        .is_empty());

    // O veto "somente local" da seleção vale para o Vídeo transformado (mesma rota).
    configure("https://192.0.2.10/v1");
    call(
        "assistant.local_only.set",
        json!({"task": "selection", "enabled": true}),
    );
    let vetoed = fail(
        "selection.start",
        json!({"source_id": source, "videoKind": "transformed", "confirmed": true}),
    );
    assert_eq!(vetoed.code, "local_only_violation");
    call(
        "assistant.local_only.set",
        json!({"task": "selection", "enabled": false}),
    );
    // Provedor pago: a confirmação também vale para o tipo transformado.
    let paid = fail(
        "selection.start",
        json!({"source_id": source, "videoKind": "transformed"}),
    );
    assert_eq!(paid.code, "confirmation_required");

    configure("http://127.0.0.1:9/v1");
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

    // ---- Estimativa: cada tipo mostra a própria tabela de pesos, na ordem.
    let direct_estimate = call("selection.estimate", json!({"source_id": source}));
    assert_eq!(direct_estimate["videoKind"], "direct");
    assert_eq!(
        weights(&direct_estimate["weights"]),
        [
            ("hook".to_owned(), 0.30),
            ("selfContained".to_owned(), 0.20),
            ("energy".to_owned(), 0.20),
            ("value".to_owned(), 0.15),
            ("closing".to_owned(), 0.15)
        ]
    );
    let transformed_estimate = call(
        "selection.estimate",
        json!({"source_id": source, "videoKind": "transformed"}),
    );
    assert_eq!(transformed_estimate["videoKind"], "transformed");
    assert_eq!(
        weights(&transformed_estimate["weights"]),
        [
            ("commentary".to_owned(), 0.30),
            ("hook".to_owned(), 0.20),
            ("energy".to_owned(), 0.15),
            ("value".to_owned(), 0.15),
            ("selfContained".to_owned(), 0.10),
            ("closing".to_owned(), 0.10)
        ]
    );

    // ---- Corte direto (sem `videoKind`): 5 eixos, pesos antigos, prompt v2 sem comentário.
    let run_direct = call("selection.start", json!({"source_id": source}))["run"]
        .as_i64()
        .unwrap();
    let direct = finished(run_direct, "completed");
    assert_eq!(direct["run"]["videoKind"], "direct");
    assert_eq!(direct["run"]["taskVersion"], 2);
    assert_eq!(direct["run"]["summary"]["videoKind"], "direct");
    let c = &direct["candidates"][0];
    assert_eq!(
        keys(&c["axes"]),
        ["closing", "energy", "hook", "selfContained", "value"]
    );
    // 0,30×8 + 0,20×5 + 0,20×7 + 0,15×6 + 0,15×4 = 2,4 + 1,0 + 1,4 + 0,9 + 0,6 = 6,30
    assert_eq!(c["totalCenti"], 630);
    assert_eq!(direct["run"]["weights"], direct_estimate["weights"]);

    // ---- Vídeo transformado: 6 eixos, tarefa e prompt próprios, total com os pesos novos.
    let started = call(
        "selection.start",
        json!({"source_id": source, "videoKind": "transformed"}),
    );
    assert_eq!(started["videoKind"], "transformed");
    let run_transformed = started["run"].as_i64().unwrap();
    let transformed = finished(run_transformed, "completed");
    assert_eq!(transformed["run"]["videoKind"], "transformed");
    assert_eq!(transformed["run"]["taskVersion"], 1);
    assert_ne!(
        transformed["run"]["promptSha256"],
        direct["run"]["promptSha256"]
    );
    let c = &transformed["candidates"][0];
    assert_eq!(
        keys(&c["axes"]),
        [
            "closing",
            "commentary",
            "energy",
            "hook",
            "selfContained",
            "value"
        ]
    );
    // 0,30×9 + 0,20×8 + 0,15×7 + 0,15×6 + 0,10×5 + 0,10×4 = 2,70 + 1,60 + 1,05 + 0,90 + 0,50 + 0,40
    assert_eq!(c["totalCenti"], 715);
    assert_eq!(c["total"], 7.15);
    assert_eq!(
        weights(&transformed["run"]["weights"]),
        weights(&transformed_estimate["weights"])
    );
    // Cada tipo enviou a própria instrução e o próprio schema.
    let schemas = fake.schemas.lock().unwrap().clone();
    assert!(schemas.contains(&true) && schemas.contains(&false));
    let instructions = fake.instructions.lock().unwrap().clone();
    assert!(instructions.iter().any(|i| i.contains("commentary")));
    assert!(instructions.iter().any(|i| !i.contains("commentary")));
    let kinds: Vec<String> = with_reader(|c| {
        let mut q = c.prepare("SELECT DISTINCT kind FROM jobs ORDER BY kind")?;
        let rows = q.query_map([], |r| r.get(0))?;
        rows.collect::<rusqlite::Result<Vec<String>>>()
    })
    .unwrap();
    assert_eq!(kinds, ["ai:selection", "ai:selection_transformed"]);

    // ---- Transformado sem o 6º eixo: a Janela falha com código fixo, sem candidato.
    fake.omit_sixth.store(true, Ordering::SeqCst);
    let run_bad = call(
        "selection.start",
        json!({"source_id": source, "videoKind": "transformed"}),
    )["run"]
        .as_i64()
        .unwrap();
    let bad = finished(run_bad, "partial");
    assert!(bad["candidates"].as_array().unwrap().is_empty());
    let failed: Vec<&Value> = bad["windows"]
        .as_array()
        .unwrap()
        .iter()
        .filter(|w| !w["code"].is_null())
        .collect();
    assert!(!failed.is_empty());
    for w in failed {
        let code = w["code"].as_str().unwrap();
        assert!(
            matches!(code, "output_invalid" | "verification_failed"),
            "{code}"
        );
    }
    fake.omit_sixth.store(false, Ordering::SeqCst);

    // ---- Refazer ou retomar mantém o tipo da execução (a tarefa de cada Janela segue o tipo).
    let resumed = call("selection.resume", json!({"run": run_bad}));
    assert!(!resumed["windows"].as_array().unwrap().is_empty());
    let after = finished(run_bad, "completed");
    assert_eq!(after["run"]["videoKind"], "transformed");
    assert_eq!(after["candidates"][0]["totalCenti"], 715);

    // ---- A lista mostra o tipo de cada execução.
    let listed = call("selection.list", json!({"source_id": source}));
    let by_id = |id: i64| {
        listed
            .as_array()
            .unwrap()
            .iter()
            .find(|r| r["id"] == id)
            .unwrap()["videoKind"]
            .clone()
    };
    assert_eq!(by_id(run_direct), "direct");
    assert_eq!(by_id(run_transformed), "transformed");

    // ---- Execução ou lote antigo (sem tipo gravado) vale como Corte direto: é o DEFAULT.
    for table in ["selection_runs", "source_batches"] {
        let default: String = with_reader(|c| {
            c.query_row(
                "SELECT dflt_value FROM pragma_table_info(?1) WHERE name='video_kind'",
                [table],
                |r| r.get(0),
            )
        })
        .unwrap();
        assert_eq!(default, "'direct'", "{table}");
    }

    // ---- Lote de Fontes: o tipo escolhido na criação vai para a seleção de cada Fonte.
    let s2 = seed(2);
    let created = call(
        "batches.create",
        json!({"sourceIds": [s2], "videoKind": "transformed"}),
    );
    assert_eq!(created["videoKind"], "transformed");
    assert_eq!(
        fail(
            "batches.create",
            json!({"sourceIds": [source], "videoKind": "x"})
        )
        .code,
        "invalid_video_kind"
    );
    let id = created["id"].as_i64().unwrap();
    let deadline = Instant::now() + Duration::from_secs(60);
    let run = loop {
        let batch = call("batches.get", json!({"id": id}));
        if let Some(run) = batch["items"][0]["selectionRun"].as_i64() {
            break run;
        }
        assert!(Instant::now() < deadline, "batch never selected: {batch}");
        std::thread::sleep(Duration::from_millis(25));
    };
    let from_batch = finished(run, "completed");
    assert_eq!(from_batch["run"]["videoKind"], "transformed");
    assert_eq!(from_batch["candidates"][0]["totalCenti"], 715);
    // Um lote sem tipo é Corte direto.
    let plain = call("batches.create", json!({"sourceIds": [seed(3)]}));
    assert_eq!(plain["videoKind"], "direct");
}
