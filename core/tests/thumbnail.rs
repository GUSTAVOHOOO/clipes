//! Ideia de thumbnail e capa (#74), headless e sem rede: Provedor falso na fila, Transcrição
//! gravada no Projeto, vídeo sintético gerado por lavfi e dados isolados em CLIPES_DATA_DIR.
use clipes_core::{
    ai_task::{self, TaskInput},
    dispatch, jobs,
    projects::with_writer,
    provider::{cost::Target, CancelToken, Provider, StructuredRequest},
    CoreError,
};
use serde_json::{json, Value};
use std::{
    fs,
    path::Path,
    process::Command,
    sync::{Arc, Mutex},
    time::{Duration, Instant},
};

struct Direct(Value);
impl Provider for Direct {
    fn structured(&self, _: &StructuredRequest) -> Result<Value, CoreError> {
        Ok(json!({"data": self.0, "calls": 1}))
    }
}

fn run_task(data: Value) -> Result<ai_task::TaskOutput, ai_task::TaskError> {
    let task = ai_task::find("thumbnail").expect("thumbnail task registered");
    ai_task::run(
        task,
        &TaskInput {
            context: json!({"sentenceIds": [10, 11]}),
            ..Default::default()
        },
        &Direct(data),
        &CancelToken::new(),
    )
}

fn codes(data: Value) -> Vec<&'static str> {
    run_task(data)
        .expect_err("must fail")
        .violations
        .iter()
        .map(|v| v.code)
        .collect()
}

#[test]
fn verifiers_reject_ids_outside_the_cut_and_bad_reasons() {
    let ok = json!({"schemaVersion":1,"sentenceId":10,"why":"Momento de maior impacto."});
    assert!(run_task(ok.clone()).is_ok());
    let mut d = ok.clone();
    d["sentenceId"] = json!(99);
    assert_eq!(codes(d), vec!["sentence_outside_cut"]);
    let mut d = ok.clone();
    d["why"] = json!("");
    assert!(codes(d).contains(&"why_empty"));
    let mut d = ok.clone();
    d["why"] = json!("x".repeat(201));
    assert!(codes(d).contains(&"why_too_long"));
    let mut d = ok;
    d["why"] = json!("veja https://exemplo.com");
    assert!(codes(d).contains(&"invented_url"));
}

fn call(name: &str, args: Value) -> Value {
    dispatch(name, args, &mut |_| {}).unwrap()
}
fn fail(name: &str, args: Value) -> CoreError {
    dispatch(name, args, &mut |_| {}).unwrap_err()
}

fn synthetic(path: &Path, seconds: u32) {
    assert!(Command::new("ffmpeg")
        .args(["-v", "error", "-f", "lavfi", "-i"])
        .arg(format!("testsrc=s=320x180:r=5:d={seconds}"))
        .args(["-f", "lavfi", "-i"])
        .arg(format!("sine=duration={seconds}"))
        .args(["-c:v", "mpeg4", "-c:a", "pcm_s16le", "-ac", "2", "-y"])
        .arg(path)
        .status()
        .unwrap()
        .success());
}

fn candidate() -> Value {
    let mut c = json!({"startId": 10, "endId": 11, "title": ""});
    for key in ["hook", "selfContained", "energy", "value", "closing"] {
        c[key] = json!({"score": 9, "why": "motivo curto"});
    }
    c
}

/// Seleção: um candidato fixo. Capa: a próxima saída da fila, e os pedidos vistos.
struct Fake {
    next: Mutex<Value>,
    seen: Mutex<Vec<StructuredRequest>>,
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
        let usage = json!({"inputTokens": 10, "outputTokens": 5});
        if request.transcript.starts_with("#CAPA") {
            self.seen.lock().unwrap().push(request.clone());
            return Ok(
                json!({"data": self.next.lock().unwrap().clone(), "usage": usage, "calls": 1}),
            );
        }
        let first: i64 = request
            .transcript
            .lines()
            .find(|l| !l.starts_with('#'))
            .and_then(|l| l.split(' ').next())
            .and_then(|id| id.parse().ok())
            .unwrap();
        let list = if first == 1 {
            vec![candidate()]
        } else {
            vec![]
        };
        Ok(json!({"data": {"schemaVersion": 1, "candidates": list}, "usage": usage, "calls": 1}))
    }
}

fn wait_job(candidate: i64, id: i64) -> Value {
    let deadline = Instant::now() + Duration::from_secs(60);
    loop {
        let doc = call("thumbnail.get", json!({"candidate": candidate}));
        let job = &doc["job"];
        if job["id"] == id && !matches!(job["state"].as_str(), Some("queued" | "running")) {
            return doc;
        }
        assert!(Instant::now() < deadline, "job {id} never settled: {doc}");
        std::thread::sleep(Duration::from_millis(25));
    }
}

fn suggest(candidate: i64) -> Value {
    let job = call("thumbnail.suggest", json!({"candidate": candidate}))["job"]
        .as_i64()
        .unwrap();
    wait_job(candidate, job)
}

fn png_size(path: &Path) -> (u32, u32) {
    let bytes = fs::read(path).unwrap();
    assert_eq!(
        &bytes[..8],
        &[0x89, b'P', b'N', b'G', 0x0D, 0x0A, 0x1A, 0x0A]
    );
    let n = |i: usize| u32::from_be_bytes(bytes[i..i + 4].try_into().unwrap());
    (n(16), n(20))
}

#[test]
fn thumbnail_flow_suggestion_choice_history_and_png_export() {
    let ffmpeg_ok = Command::new("ffmpeg").arg("-version").output().is_ok()
        && Command::new("ffprobe").arg("-version").output().is_ok();
    if !ffmpeg_ok {
        eprintln!("ffmpeg/ffprobe ausentes: teste ignorado");
        return;
    }
    let root = tempfile::tempdir().unwrap();
    std::env::set_var("CLIPES_DATA_DIR", root.path().join("data"));
    std::env::set_var("CLIPES_FFPROBE", "ffprobe");
    call(
        "components.settings.set",
        json!({"data_dir":root.path().join("data"),"cache_dir":root.path().join("cache"),"cache_limit_bytes":1_000_000_000u64,"ffmpeg_path":"ffmpeg"}),
    );
    let video = root.path().join("live.mkv");
    synthetic(&video, 130);
    let project = call(
        "projects.create",
        json!({"parent": root.path(), "name": "Canal"}),
    );
    let source = call(
        "sources.import",
        json!({"project":project["path"],"path":video,"permission":{"status":"none"},"audio_track":1}),
    )["id"]
        .as_i64()
        .unwrap();
    // Transcrição: 240 Frases de 10 palavras de 1 s (a Frase n começa em (n-1)*10 s).
    with_writer(|c| {
        c.execute("INSERT INTO transcripts(source_id,audio_track,engine,model,revision,compute_type,state,resume_us,duration_us) VALUES (?1,1,'local','m','r','c','complete',130000000,130000000)", [source])?;
        let transcript = c.last_insert_rowid();
        for position in 0..240i64 * 10 {
            let text = if position % 10 == 9 { " palavra." } else { " palavra" };
            c.execute("INSERT INTO transcript_words(transcript_id,position,kind,text,start_us,end_us,language) VALUES (?1,?2,'word',?3,?4,?5,'pt')", (transcript, position, text, position * 1_000_000, (position + 1) * 1_000_000))?;
        }
        Ok(())
    })
    .unwrap();
    call("transcription.segment", json!({"source_id": source}));
    call(
        "provider.configure",
        json!({"endpoint": "http://127.0.0.1:9/v1", "kind": "openai", "model": "fake-model", "context": 32768}),
    );
    let fake = Arc::new(Fake {
        next: Mutex::new(
            json!({"schemaVersion":1,"sentenceId":10,"why":"O momento de maior impacto."}),
        ),
        seen: Mutex::new(vec![]),
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
    let run = call("selection.start", json!({"source_id": source}))["run"]
        .as_i64()
        .unwrap();
    let deadline = Instant::now() + Duration::from_secs(60);
    let cand = loop {
        let got = call("selection.get", json!({"run": run}));
        if got["run"]["state"] == "completed" {
            break got["candidates"][0]["id"].as_i64().unwrap();
        }
        assert!(Instant::now() < deadline, "selection never completed");
        std::thread::sleep(Duration::from_millis(25));
    };

    // Só candidato aprovado tem capa.
    assert_eq!(
        fail("thumbnail.suggest", json!({"candidate": cand})).code,
        "not_approved"
    );
    call(
        "selection.decide",
        json!({"candidate": cand, "decision": "approved"}),
    );
    let estimate = call("thumbnail.estimate", json!({"candidate": cand}));
    assert_eq!(estimate["paid"], false);
    let before = call("thumbnail.get", json!({"candidate": cand}));
    assert_eq!(before["current"], Value::Null);
    let (cut_start, cut_end) = (
        before["cut"]["startUs"].as_i64().unwrap(),
        before["cut"]["endUs"].as_i64().unwrap(),
    );

    // 1. Sugestão: o Provedor só recebe texto; o núcleo converte o ID da Frase num instante.
    let doc = suggest(cand);
    assert_eq!(doc["job"]["state"], "completed");
    let current = &doc["current"];
    assert_eq!(current["origin"], "provider");
    assert_eq!(current["why"], "O momento de maior impacto.");
    let instant = current["instantUs"].as_i64().unwrap();
    assert!((cut_start..=cut_end).contains(&instant));
    assert_eq!(doc["suggestions"][0]["sentenceId"], 10);
    assert_eq!(doc["suggestions"][0]["taskVersion"], 1);
    assert_eq!(
        doc["suggestions"][0]["promptSha256"]
            .as_str()
            .unwrap()
            .len(),
        64
    );
    {
        let seen = fake.seen.lock().unwrap();
        let request = &seen[0];
        assert!(request.transcript.starts_with("#CAPA\n"));
        assert!(request.transcript.lines().any(|l| l.starts_with("10 ")));
        for secret in ["live.mkv", "Canal"] {
            assert!(!request.transcript.contains(secret));
            assert!(!request.instruction.contains(secret));
        }
    }

    // 2. ID fora do Corte: rejeitado pelo verificador, a escolha atual não muda.
    *fake.next.lock().unwrap() = json!({"schemaVersion":1,"sentenceId":200,"why":"Fora do Corte."});
    let rejected = suggest(cand);
    assert_eq!(rejected["job"]["state"], "failed");
    assert_eq!(rejected["job"]["code"], "verification_failed");
    assert!(rejected["job"]["violations"]
        .as_array()
        .unwrap()
        .contains(&json!("sentence_outside_cut")));
    assert_eq!(rejected["current"]["instantUs"], instant);
    assert_eq!(rejected["suggestions"].as_array().unwrap().len(), 1);

    // 3. O usuário escolhe outro quadro; fora do Corte é recusado; o histórico se mantém.
    assert_eq!(
        fail(
            "thumbnail.choose",
            json!({"candidate": cand, "instant_us": cut_end + 1_000_000})
        )
        .code,
        "instant_out_of_cut"
    );
    let own = cut_start + 2_000_000;
    let chosen = call(
        "thumbnail.choose",
        json!({"candidate": cand, "instant_us": own}),
    );
    assert_eq!(chosen["current"]["origin"], "user");
    assert_eq!(chosen["current"]["instantUs"], own);
    assert_eq!(chosen["choices"].as_array().unwrap().len(), 2);
    let again = call(
        "thumbnail.choose",
        json!({"candidate": cand, "instant_us": own}),
    );
    assert_eq!(again["choices"].as_array().unwrap().len(), 2);

    // 4. Exporta o quadro em PNG, no tamanho nativo da Fonte (320x180), sem sobrescrever.
    let out = root.path().join("capa.png");
    let exported = call(
        "thumbnail.export",
        json!({"candidate": cand, "output": out}),
    );
    assert_eq!(exported["instantUs"], own);
    assert_eq!(png_size(&out), (320, 180));
    assert_eq!(
        fail(
            "thumbnail.export",
            json!({"candidate": cand, "output": out})
        )
        .code,
        "thumbnail_exists"
    );
    assert_eq!(
        fail(
            "thumbnail.export",
            json!({"candidate": cand, "output": root.path().join("capa.jpg")})
        )
        .code,
        "thumbnail_destination"
    );
    // Um instante explícito diferente gera outro quadro; fora do Corte é recusado.
    let second = root.path().join("capa2.png");
    call(
        "thumbnail.export",
        json!({"candidate": cand, "output": second, "instant_us": instant}),
    );
    assert_ne!(fs::read(&out).unwrap(), fs::read(&second).unwrap());
    assert_eq!(
        fail(
            "thumbnail.export",
            json!({"candidate": cand, "output": root.path().join("x.png"), "instant_us": cut_end + 1})
        )
        .code,
        "instant_out_of_cut"
    );
    let leftovers: Vec<_> = fs::read_dir(root.path())
        .unwrap()
        .filter_map(|e| e.ok())
        .filter(|e| e.file_name().to_string_lossy().starts_with(".clipes-capa"))
        .collect();
    assert!(leftovers.is_empty());

    // 5. Fonte offline: erro tipado, sem arquivo parcial.
    let moved = root.path().join("live-moved.mkv");
    fs::rename(&video, &moved).unwrap();
    let offline = fail(
        "thumbnail.export",
        json!({"candidate": cand, "output": root.path().join("off.png")}),
    );
    assert_eq!(offline.code, "source_offline");
    assert!(!offline.message.contains(root.path().to_str().unwrap()));
    assert!(!root.path().join("off.png").exists());
}
