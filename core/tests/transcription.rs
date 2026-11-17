//! Transcrição local em blocos, headless, contra um worker falso (sem rede, sem modelo real):
//! blocos com checkpoint, retomada depois de crash do worker e do app, cancelamento e faixa
//! de microfone. Os dados ficam isolados em CLIPES_DATA_DIR.

use clipes_core::dispatch;
use serde_json::{json, Value};
use std::{
    fs,
    path::{Path, PathBuf},
    process::Command,
    sync::Mutex,
    time::{Duration, Instant},
};

const FAKE_WORKER: &str = env!("CARGO_BIN_EXE_fake-worker");
// Variáveis de ambiente e a sessão de Projeto são globais ao processo: um teste por vez.
static SERIAL: Mutex<()> = Mutex::new(());

struct Env {
    _guard: std::sync::MutexGuard<'static, ()>,
    root: tempfile::TempDir,
    project: String,
    _smi: Option<tempfile::TempDir>,
}

fn run(name: &str, args: Value) -> Result<Value, clipes_core::CoreError> {
    dispatch(name, args, &mut |_| {})
}

fn wait(what: &str, mut condition: impl FnMut() -> bool) {
    let deadline = Instant::now() + Duration::from_secs(60);
    while !condition() {
        assert!(Instant::now() < deadline, "tempo esgotado: {what}");
        std::thread::sleep(Duration::from_millis(20));
    }
}

fn exe(name: &str) -> String {
    if cfg!(windows) {
        format!("{name}.exe")
    } else {
        name.into()
    }
}

impl Env {
    /// Projeto aberto, FFmpeg falso, uv/worker falsos instalados e os dois modelos marcados
    /// como instalados. `seconds` é a duração que o ffprobe falso informa.
    fn new(seconds: u32) -> Env {
        Env::build(seconds, None)
    }

    /// Com o hardware simulado (`nvidia-smi` falso ou ausente) antes de instalar o worker.
    fn with_gpu(seconds: u32, gpu: Option<&str>) -> Env {
        Env::build(seconds, Some(gpu))
    }

    fn build(seconds: u32, gpu: Option<Option<&str>>) -> Env {
        let guard = SERIAL.lock().unwrap_or_else(|e| e.into_inner());
        let smi = gpu.map(gpu_env);
        let root = tempfile::tempdir().unwrap();
        let data = root.path().join("data");
        let fake = root.path().join(exe("fake-ffmpeg"));
        let compiler = std::env::var_os("RUSTC")
            .map(PathBuf::from)
            .unwrap_or_else(|| {
                PathBuf::from(
                    std::env::var_os(if cfg!(windows) { "USERPROFILE" } else { "HOME" }).unwrap(),
                )
                .join(".cargo/bin")
                .join(exe("rustc"))
            });
        assert!(Command::new(compiler)
            .arg(Path::new(env!("CARGO_MANIFEST_DIR")).join("tests/fixtures/fake_ffmpeg.rs"))
            .arg("-o")
            .arg(&fake)
            .status()
            .unwrap()
            .success());
        fs::write(root.path().join("continue"), b"go").unwrap();
        std::env::set_var("CLIPES_FAKE_FFMPEG_STATE", root.path());
        std::env::set_var("CLIPES_FFPROBE", &fake);
        std::env::set_var("CLIPES_DATA_DIR", &data);
        std::env::set_var("CLIPES_FAKE_DURATION", seconds.to_string());
        std::env::set_var("CLIPES_TRANSCRIBE_BLOCK_SECONDS", "10");
        std::env::set_var("CLIPES_FAKE_WORKER_MODE", "transcribe");
        std::env::remove_var("CLIPES_FAKE_WORKER_CRASH");
        std::env::remove_var("CLIPES_FAKE_WORKER_HOLD");
        std::env::remove_var("CLIPES_FAKE_WORKER_HELD");
        std::env::remove_var("CLIPES_FAKE_TRANSCRIBE_LOG");
        std::env::remove_var("CLIPES_FAKE_LANGUAGE_LOG");
        std::env::remove_var("CLIPES_FAKE_SILENT_BLOCKS");
        std::env::remove_var("CLIPES_FAKE_GROUP_OOM");
        run("components.settings.set", json!({"data_dir":data,"cache_dir":root.path().join("cache"),"cache_limit_bytes":1_000_000,"ffmpeg_path":fake})).unwrap();

        // uv falso, como se o Componente já tivesse sido baixado, e worker falso instalado por ele.
        let manifest = run("components.manifest", json!({})).unwrap();
        let version = manifest
            .as_array()
            .unwrap()
            .iter()
            .find(|c| c["id"] == "uv")
            .unwrap()["version"]
            .as_str()
            .unwrap()
            .to_owned();
        fs::create_dir_all(data.join("components")).unwrap();
        fs::copy(FAKE_WORKER, data.join("components").join(exe("uv"))).unwrap();
        fs::write(data.join("components/uv.version"), version).unwrap();
        run("components.worker.install", json!({"confirmed":true})).unwrap();

        let project = run(
            "projects.create",
            json!({"parent":root.path(),"name":"Canal"}),
        )
        .unwrap();
        let project = project["path"].as_str().unwrap().to_owned();
        Env {
            _guard: guard,
            root,
            project,
            _smi: smi,
        }
    }

    fn install_models(&self) {
        let models = run("components.models.manifest", json!({})).unwrap();
        for model in models.as_array().unwrap() {
            let dir = self
                .root
                .path()
                .join("data/models")
                .join(model["id"].as_str().unwrap());
            fs::create_dir_all(&dir).unwrap();
            fs::write(
                dir.join("model.state.json"),
                json!({"revision": model["revision"]}).to_string(),
            )
            .unwrap();
        }
    }

    fn import(&self, track: i64) -> i64 {
        let media = self.root.path().join("source.mp4");
        fs::write(&media, b"media").unwrap();
        let source = run(
            "sources.import",
            json!({"project":self.project,"path":media,"permission":{"status":"none"},"audio_track":track}),
        )
        .unwrap();
        source["id"].as_i64().unwrap()
    }

    fn start(&self, source: i64) -> Result<Value, clipes_core::CoreError> {
        run(
            "transcription.start",
            json!({"project":self.project,"source_id":source}),
        )
    }

    fn job_state(&self, kind: &str) -> Option<(String, i64)> {
        run("jobs.list", json!({}))
            .unwrap()
            .as_array()
            .unwrap()
            .iter()
            .rev()
            .find(|j| j["kind"] == kind)
            .map(|j| {
                (
                    j["state"].as_str().unwrap().into(),
                    j["attempts"].as_i64().unwrap(),
                )
            })
    }

    fn wait_transcribe(&self, state: &str) {
        wait(&format!("job transcription {state}"), || {
            self.job_state("transcription").is_some_and(|(s, _)| {
                assert!(s != "failed" || state == "failed", "o job falhou");
                s == state
            })
        });
    }

    fn rows(&self, source: i64) -> Vec<Value> {
        run("transcription.words", json!({"source_id":source}))
            .unwrap()
            .as_array()
            .unwrap()
            .clone()
    }

    fn status(&self, source: i64) -> Value {
        run("transcription.status", json!({"source_id":source})).unwrap()
    }

    fn paid_job(&self, source: i64) -> i64 {
        wait("prévia", || {
            self.job_state("preview")
                .is_some_and(|(s, _)| s == "completed")
        });
        let job=clipes_core::projects::with_writer(|c| {
            c.execute("INSERT INTO transcripts(source_id,audio_track,engine,model,revision,compute_type,duration_us) SELECT id,audio_track,'groq','whisper-large-v3-turbo','','remote',duration_us FROM sources WHERE id=?1",[source])?;
            c.execute("INSERT INTO jobs(kind,safety,state,source_id) VALUES ('transcription','paid','running',?1)",[source])?;
            Ok(c.last_insert_rowid())
        }).unwrap();
        run("transcription.groq.confirm",json!({"endpoint":"https://api.groq.com/openai/v1/audio/transcriptions","confirmed":true})).unwrap();
        job
    }
}

impl Drop for Env {
    fn drop(&mut self) {
        let _ = run("projects.close", json!({}));
    }
}

/// O que a Fonte de 25 s deve ter: uma palavra por segundo (k+0,1 s a k+0,5 s) entre silêncios
/// explícitos e contíguos, sem lacunas nem repetições, mesmo atravessando as costuras de bloco.
fn assert_complete_transcript(rows: &[Value]) {
    let words: Vec<_> = rows.iter().filter(|r| r["kind"] == "word").collect();
    assert_eq!(words.len(), 25, "uma palavra por segundo, sem duplicar");
    for (k, w) in words.iter().enumerate() {
        assert_eq!(w["start_us"], json!(k as i64 * 1_000_000 + 100_000));
        assert_eq!(w["end_us"], json!(k as i64 * 1_000_000 + 500_000));
        assert_eq!(w["language"], "pt");
        assert_eq!(w["text"], "palavra");
    }
    // Posições 0..n em ordem, sem buracos; o falante é reservado (nulo).
    for (i, r) in rows.iter().enumerate() {
        assert_eq!(r["position"], json!(i), "índice por ordem contíguo");
        assert!(r["speaker"].is_null());
    }
    // As linhas cobrem 0..25 s sem lacuna nem sobreposição.
    let mut cursor = 0;
    for r in rows {
        let (start, end) = (
            r["start_us"].as_i64().unwrap(),
            r["end_us"].as_i64().unwrap(),
        );
        if r["kind"] == "silence" {
            assert_eq!(r["text"], "");
            assert!(start >= cursor && end > start);
        } else {
            assert!(start >= cursor);
        }
        cursor = end;
    }
    assert_eq!(cursor, 25_000_000);
    let silences = rows.iter().filter(|r| r["kind"] == "silence").count();
    assert_eq!(
        silences, 26,
        "silêncios vizinhos (inclusive entre blocos) viram um segmento"
    );
}

#[test]
fn transcribes_in_blocks_and_stores_words_with_orders_and_silences() {
    let env = Env::new(25);
    env.install_models();
    let source = env.import(0);
    let started = env.start(source).unwrap();
    assert_eq!(started["state"], "running");
    env.wait_transcribe("completed");
    assert_complete_transcript(&env.rows(source));
    // A energia do áudio (#54) é enfileirada sozinha quando a Transcrição fica completa.
    assert!(
        env.job_state("energy").is_some(),
        "job de energia enfileirado"
    );
    let status = env.status(source);
    assert_eq!(status["transcript"]["state"], "complete");
    assert_eq!(status["transcript"]["resume_us"], 25_000_000);
    assert_eq!(status["transcript"]["words"], 25);
    // Concluída: pedir de novo devolve a existente, sem novo job (retranscrever é outro ticket).
    let again = env.start(source).unwrap();
    assert_eq!(again["state"], "complete");
    assert!(again["job_id"].is_null());
    assert_eq!(env.rows(source).len(), 51);
}

#[test]
fn killing_the_worker_mid_transcription_resumes_from_the_last_block_without_duplicates() {
    let env = Env::new(25);
    env.install_models();
    let source = env.import(0);
    let crash = env.root.path().join("crash");
    fs::write(&crash, b"1").unwrap();
    std::env::set_var("CLIPES_FAKE_WORKER_CRASH", &crash);
    env.start(source).unwrap();
    env.wait_transcribe("failed");
    // O primeiro bloco (0-8 s) estava gravado; o segundo morreu antes de entregar.
    let status = env.status(source);
    assert_eq!(status["transcript"]["state"], "running");
    assert_eq!(status["transcript"]["resume_us"], 8_000_000);
    assert_eq!(status["transcript"]["words"], 8);
    assert!(!crash.exists());
    let job = run("jobs.list", json!({})).unwrap();
    // O checkpoint leva também o dispositivo e a precisão do bloco (#50).
    let checkpoint: Value = serde_json::from_str(
        job[job.as_array().unwrap().len() - 1]["checkpoint"]
            .as_str()
            .unwrap(),
    )
    .unwrap();
    assert_eq!(checkpoint["resume_us"], 8_000_000);
    assert!(checkpoint["device"].is_string() && checkpoint["compute_type"].is_string());
    // Retomar: um novo job continua do último bloco concluído.
    env.start(source).unwrap();
    wait("segundo job concluído", || {
        env.status(source)["transcript"]["state"] == "complete"
    });
    assert_complete_transcript(&env.rows(source));
}

#[test]
fn closing_the_app_mid_transcription_requeues_and_resumes() {
    let env = Env::new(25);
    env.install_models();
    let source = env.import(0);
    let hold = env.root.path().join("hold");
    fs::write(&hold, b"1").unwrap();
    std::env::set_var("CLIPES_FAKE_WORKER_HOLD", &hold);
    env.start(source).unwrap();
    wait("transcrição em andamento", || {
        env.job_state("transcription")
            .is_some_and(|(s, _)| s == "running")
    });
    run("projects.close", json!({})).unwrap();
    fs::remove_file(&hold).unwrap();
    run("projects.open", json!({"path":env.project})).unwrap();
    env.wait_transcribe("completed");
    assert_eq!(
        env.job_state("transcription").unwrap().1,
        2,
        "reiniciou uma vez"
    );
    assert_complete_transcript(&env.rows(source));
}

#[test]
fn cancelling_stops_the_job_and_a_new_start_continues() {
    let env = Env::new(25);
    env.install_models();
    let source = env.import(0);
    let hold = env.root.path().join("hold");
    fs::write(&hold, b"1").unwrap();
    std::env::set_var("CLIPES_FAKE_WORKER_HOLD", &hold);
    let started = env.start(source).unwrap();
    wait("transcrição em andamento", || {
        env.job_state("transcription")
            .is_some_and(|(s, _)| s == "running")
    });
    run("jobs.cancel", json!({"id":started["job_id"]})).unwrap();
    env.wait_transcribe("cancelled");
    assert_eq!(env.status(source)["transcript"]["state"], "running");
    fs::remove_file(&hold).unwrap();
    env.start(source).unwrap();
    wait("transcrição completa", || {
        env.status(source)["transcript"]["state"] == "complete"
    });
    assert_complete_transcript(&env.rows(source));
}

#[test]
fn only_the_chosen_microphone_track_is_extracted() {
    let env = Env::new(25);
    env.install_models();
    let source = env.import(1);
    env.start(source).unwrap();
    env.wait_transcribe("completed");
    let log = fs::read_to_string(env.root.path().join("extract-args.log")).unwrap();
    assert!(!log.is_empty());
    for call in log.lines() {
        assert!(call.contains("-map 0:1 "), "{call}");
        assert!(call.contains("-ac 1 -ar 16000"), "{call}");
        assert!(!call.contains("-map 0:0"), "{call}");
    }
}

#[test]
fn missing_model_is_a_typed_error_before_any_job() {
    let env = Env::new(25);
    let source = env.import(0);
    let error = env.start(source).unwrap_err();
    assert_eq!(error.code, "model_missing");
    assert!(env.job_state("transcription").is_none());
}

#[test]
fn start_requires_the_open_project() {
    let env = Env::new(25);
    env.install_models();
    let source = env.import(0);
    let error = run(
        "transcription.start",
        json!({"project":"outro.clipes","source_id":source}),
    )
    .unwrap_err();
    assert_eq!(error.code, "invalid_project");
}

#[test]
fn sentences_are_created_and_stable_after_reopening_and_resegmenting() {
    let env = Env::new(25);
    env.install_models();
    let source = env.import(0);
    env.start(source).unwrap();
    env.wait_transcribe("completed");
    let before = run("transcription.sentences", json!({"source_id":source})).unwrap();
    assert!(!before.as_array().unwrap().is_empty());
    assert_eq!(before[0]["id"], 1);
    assert_eq!(before[0]["language"], "pt");
    let timeline = run("transcription.timeline", json!({"source_id":source})).unwrap();
    assert_eq!(
        timeline["items"]
            .as_array()
            .unwrap()
            .iter()
            .filter(|item| item["type"] == "silence")
            .count(),
        26
    );
    run("projects.close", json!({})).unwrap();
    run("projects.open", json!({"path":env.project})).unwrap();
    let result = run("transcription.segment", json!({"source_id":source})).unwrap();
    assert_eq!(result["changed"], false);
    assert_eq!(
        before,
        run("transcription.sentences", json!({"source_id":source})).unwrap()
    );
}

#[test]
fn engine_choice_is_preserved_and_switching_complete_transcripts_is_refused() {
    let env = Env::new(5);
    env.install_models();
    let source = env.import(0);
    env.start(source).unwrap();
    env.wait_transcribe("completed");
    let error = run(
        "transcription.start",
        json!({"project":env.project,"source_id":source,"engine":"groq","replace_confirmed":true}),
    )
    .unwrap_err();
    assert_eq!(error.code, "transcript_complete");
    assert_eq!(env.status(source)["transcript"]["engine"], "local");
}

#[test]
fn remote_start_is_vetoed_before_consent_and_key_access() {
    let env = Env::new(5);
    let source = env.import(0);
    run("projects.local_only.set", json!({"enabled":true})).unwrap();
    let error = run(
        "transcription.start",
        json!({"project":env.project,"source_id":source,"engine":"groq"}),
    )
    .unwrap_err();
    assert_eq!(error.code, "local_only_violation");
    assert!(env.status(source)["transcript"].is_null());
    run("projects.local_only.set", json!({"enabled":false})).unwrap();
    let e = run(
        "transcription.start",
        json!({"project":env.project,"source_id":source,"engine":"groq"}),
    )
    .unwrap_err();
    assert_eq!(e.code, "confirmation_required");
    let e = run(
        "transcription.groq.confirm",
        json!({"endpoint":"https://other.invalid","confirmed":true}),
    )
    .unwrap_err();
    assert_eq!(e.code, "confirmation_required");
}

#[test]
fn switching_partial_requires_loss_review_and_erases_words_without_losing_charges() {
    let env = Env::new(25);
    env.install_models();
    let source = env.import(0);
    wait("prévia", || {
        env.job_state("preview")
            .is_some_and(|(s, _)| s == "completed")
    });
    clipes_core::projects::with_writer(|c| {
        c.execute("INSERT INTO transcripts(id,source_id,audio_track,engine,model,revision,compute_type,duration_us,resume_us) VALUES (1,?1,0,'groq','whisper-large-v3-turbo','','remote',25000000,8000000)",[source])?;
        c.execute("INSERT INTO jobs(id,kind,safety,state,source_id) VALUES (100,'transcription','paid','cancelled',?1)",[source])?;
        c.execute("INSERT INTO transcript_words(transcript_id,position,kind,text,start_us,end_us) VALUES (1,0,'word','REMOTA',0,500000)",[])?;
        c.execute("INSERT INTO transcription_blocks VALUES (1,0,8000000)",[])?;
        c.execute("INSERT INTO transcription_calls(transcript_id,job_id,start_us,end_us,state,estimated_usd) VALUES (1,100,0,8000000,'completed',0.00012)",[])?;
        Ok(())
    }).unwrap();
    // Sem escolha explícita, continua sendo Groq; nunca cai no Motor local.
    let e = env.start(source).unwrap_err();
    assert_eq!(e.code, "confirmation_required");
    let e = run(
        "transcription.start",
        json!({"project":env.project,"source_id":source,"engine":"local"}),
    )
    .unwrap_err();
    assert_eq!(e.code, "engine_change_confirmation");
    let loss = e.usage.unwrap();
    assert_eq!(loss["blocks"], 1);
    assert_eq!(loss["paid_audio_us"], 8_000_000);
    assert_eq!(env.rows(source)[0]["text"], "REMOTA");
    // Uma parcial anterior ao #51 não tem histórico de blocos: não inventar uma contagem.
    clipes_core::projects::with_writer(|c| {
        c.execute("DELETE FROM transcription_blocks", [])?;
        Ok(())
    })
    .unwrap();
    let legacy = run(
        "transcription.start",
        json!({"project":env.project,"source_id":source,"engine":"local"}),
    )
    .unwrap_err();
    assert!(legacy.usage.unwrap()["blocks"].is_null());
    run(
        "transcription.start",
        json!({"project":env.project,"source_id":source,"engine":"local","replace_confirmed":true}),
    )
    .unwrap();
    env.wait_transcribe("completed");
    assert_eq!(env.status(source)["transcript"]["engine"], "local");
    assert_complete_transcript(&env.rows(source));
    let retained=clipes_core::projects::with_reader(|c|c.query_row("SELECT COUNT(*) FROM transcription_calls WHERE transcript_id IS NULL AND state='completed'",[],|r|r.get::<_,i64>(0))).unwrap();
    assert_eq!(retained, 1);
}

#[test]
fn an_unknown_saved_engine_never_falls_back_to_local() {
    let env = Env::new(5);
    let source = env.import(0);
    clipes_core::projects::with_writer(|c| {
        c.execute("INSERT INTO transcripts(source_id,audio_track,engine,model,revision,compute_type,duration_us) VALUES (?1,0,'unsupported','model','','remote',5000000)",[source])?;
        Ok(())
    }).unwrap();
    assert_eq!(env.start(source).unwrap_err().code, "invalid_engine");
    assert!(env.job_state("transcription").is_none());
}

#[test]
fn groq_uses_vad_checkpoints_absolute_times_and_one_paid_call_per_block() {
    use std::{
        io::{Read, Write},
        net::TcpListener,
        sync::atomic::AtomicBool,
    };
    let env = Env::new(25);
    let source = env.import(0);
    wait("prévia", || {
        env.job_state("preview")
            .is_some_and(|(s, _)| s == "completed")
    });
    let listener = TcpListener::bind("127.0.0.1:0").unwrap();
    let endpoint = format!(
        "http://{}/audio/transcriptions",
        listener.local_addr().unwrap()
    );
    let server = std::thread::spawn(move || {
        for _ in 0..3 {
            let (mut socket, _) = listener.accept().unwrap();
            socket.set_nonblocking(false).unwrap();
            socket
                .set_read_timeout(Some(Duration::from_secs(5)))
                .unwrap();
            let mut bytes = Vec::new();
            let mut buf = [0; 4096];
            loop {
                let n = socket.read(&mut buf).unwrap();
                assert!(n > 0);
                bytes.extend_from_slice(&buf[..n]);
                if let Some(end) = bytes.windows(4).position(|w| w == b"\r\n\r\n") {
                    let len = String::from_utf8_lossy(&bytes[..end])
                        .lines()
                        .find_map(|l| {
                            l.to_lowercase()
                                .strip_prefix("content-length: ")
                                .and_then(|s| s.parse::<usize>().ok())
                        })
                        .unwrap();
                    if bytes.len() >= end + 4 + len {
                        break;
                    }
                }
            }
            let request = String::from_utf8_lossy(&bytes);
            assert!(request.contains("audio/flac"));
            let calls = clipes_core::projects::with_reader(|c| {
                c.query_row(
                    "SELECT COUNT(*) FROM transcription_calls WHERE state='pending'",
                    [],
                    |r| r.get::<_, i64>(0),
                )
            })
            .unwrap();
            assert_eq!(calls, 1, "checkpoint persistido antes da rede");
            let body = include_str!("fixtures/groq-words.json");
            write!(
                socket,
                "HTTP/1.1 200 OK\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{}",
                body.len(),
                body
            )
            .unwrap();
        }
    });
    let job = env.paid_job(source);
    let client =
        clipes_core::worker::WorkerClient::start(FAKE_WORKER, ["--scenario", "unused"], |_| {})
            .unwrap();
    let mut engine = clipes_core::transcription::GroqEngine::with_worker(
        client,
        "fake-key".into(),
        endpoint,
        env.root.path().join(exe("fake-ffmpeg")),
        Duration::from_secs(5),
    );
    clipes_core::transcription::run_with(
        &mut engine,
        job,
        source,
        Path::new(&env.project),
        &AtomicBool::new(false),
    )
    .unwrap();
    server.join().unwrap();
    let rows = env.rows(source);
    assert_eq!(
        rows.iter()
            .map(|w| w["start_us"].as_i64().unwrap())
            .collect::<Vec<_>>(),
        [100_000, 8_100_000, 16_100_000]
    );
    assert_eq!(env.status(source)["transcript"]["state"], "complete");
    let count = clipes_core::projects::with_reader(|c| {
        c.query_row(
            "SELECT COUNT(*) FROM transcription_calls WHERE state='completed'",
            [],
            |r| r.get::<_, i64>(0),
        )
    })
    .unwrap();
    assert_eq!(count, 3);
    // Trilha de auditoria (#125): uma linha por chamada paga, só com hashes e metadados.
    let audit = dispatch("provider.audit.list", json!({}), &mut |_| {}).unwrap();
    let audit = audit.as_array().unwrap();
    assert_eq!(audit.len(), 3);
    let response = include_str!("fixtures/groq-words.json");
    for row in audit {
        assert_eq!(row["providerKind"], "transcription");
        assert_eq!(row["host"], "127.0.0.1");
        assert_eq!(row["model"], "whisper-large-v3-turbo");
        assert!(row["promptSha256"].is_null() && row["costId"].is_null());
        assert!(row["transcriptionCallId"].is_i64());
        assert_eq!(row["outcome"], "completed");
        assert_eq!(row["inputSha256"].as_str().unwrap().len(), 64);
        assert!(row["sentBytes"].as_i64().unwrap() > 0);
        assert_eq!(
            row["responseSha256"],
            format!(
                "{:x}",
                <sha2::Sha256 as sha2::Digest>::digest(response.as_bytes())
            )
        );
    }
}

#[test]
fn groq_timeout_preserves_partial_and_requires_confirmation_to_retry_after_reopening() {
    assert_paid_uncertain(
        include_str!("fixtures/groq-words.json"),
        Duration::from_millis(1000),
    );
}

#[test]
fn groq_paid_invalid_response_preserves_charge_and_requires_confirmation() {
    assert_paid_uncertain(r#"{"words":"invalid"}"#, Duration::ZERO);
}

fn assert_paid_uncertain(second_response: &'static str, second_delay: Duration) {
    use std::{
        io::{Read, Write},
        net::TcpListener,
        sync::atomic::AtomicBool,
    };
    let env = Env::new(25);
    let source = env.import(0);
    let job = env.paid_job(source);
    let listener = TcpListener::bind("127.0.0.1:0").unwrap();
    let endpoint = format!("http://{}", listener.local_addr().unwrap());
    let server = std::thread::spawn(move || {
        for index in 0..2 {
            let (mut socket, _) = listener.accept().unwrap();
            socket.set_nonblocking(false).unwrap();
            socket
                .set_read_timeout(Some(Duration::from_secs(5)))
                .unwrap();
            let mut bytes = Vec::new();
            let mut buffer = [0; 4096];
            loop {
                let n = socket.read(&mut buffer).unwrap();
                assert!(n > 0);
                bytes.extend_from_slice(&buffer[..n]);
                if let Some(end) = bytes.windows(4).position(|w| w == b"\r\n\r\n") {
                    let len = String::from_utf8_lossy(&bytes[..end])
                        .lines()
                        .find_map(|l| {
                            l.to_lowercase()
                                .strip_prefix("content-length: ")
                                .and_then(|s| s.parse::<usize>().ok())
                        })
                        .unwrap();
                    if bytes.len() >= end + 4 + len {
                        break;
                    }
                }
            }
            if index == 1 {
                std::thread::sleep(second_delay);
            }
            let body = if index == 1 {
                second_response
            } else {
                include_str!("fixtures/groq-words.json")
            };
            let _ = write!(
                socket,
                "HTTP/1.1 200 OK\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{}",
                body.len(),
                body
            );
        }
    });
    let client =
        clipes_core::worker::WorkerClient::start(FAKE_WORKER, ["--scenario", "unused"], |_| {})
            .unwrap();
    let mut engine = clipes_core::transcription::GroqEngine::with_worker(
        client,
        "fake".into(),
        endpoint,
        env.root.path().join(exe("fake-ffmpeg")),
        Duration::from_millis(500),
    );
    let e = clipes_core::transcription::run_with(
        &mut engine,
        job,
        source,
        Path::new(&env.project),
        &AtomicBool::new(false),
    )
    .unwrap_err();
    assert_eq!(e.code, "timeout_uncertain");
    let (call_state,cost)=clipes_core::projects::with_reader(|c|c.query_row("SELECT state,estimated_usd FROM transcription_calls WHERE job_id=?1 ORDER BY id DESC LIMIT 1",[job],|r|Ok((r.get::<_,String>(0)?,r.get::<_,f64>(1)?)))).unwrap();
    assert_eq!(call_state, "uncertain");
    assert!(cost > 0.0);
    clipes_core::jobs::finish(job, Err(e)).unwrap();
    server.join().unwrap();
    assert_eq!(env.status(source)["transcript"]["resume_us"], 8_000_000);
    assert_eq!(env.rows(source).len(), 1);
    assert_eq!(
        env.start(source).unwrap_err().code,
        "transcription_uncertain"
    );
    let e = run("jobs.retry", json!({"id":job})).unwrap_err();
    assert_eq!(e.code, "confirmation_required");
    assert_eq!(e.usage.unwrap()["estimate"]["kind"], "usd");
    // Simula queda durante a segunda chamada: reconciliação não a repete.
    clipes_core::projects::with_writer(|c| {
        c.execute("UPDATE jobs SET state='running' WHERE id=?1", [job])?;
        c.execute(
            "UPDATE transcription_calls SET state='pending' WHERE job_id=?1 AND state='uncertain'",
            [job],
        )?;
        Ok(())
    })
    .unwrap();
    run("projects.close", json!({})).unwrap();
    run("projects.open", json!({"path":env.project})).unwrap();
    assert_eq!(env.status(source)["job"]["state"], "uncertain");
    assert_eq!(env.rows(source).len(), 1);
    // Até uma repetição autorizada precisa passar de novo pelo veto, sem rede.
    run("projects.local_only.set", json!({"enabled":true})).unwrap();
    run("jobs.retry", json!({"id":job,"confirmed":true})).unwrap();
    env.wait_transcribe("failed");
    assert_eq!(env.status(source)["transcript"]["engine"], "groq");
    assert_eq!(env.status(source)["transcript"]["resume_us"], 8_000_000);
    // Encerrar o job não autoriza uma repetição paga pelo botão Retomar.
    run("projects.local_only.set", json!({"enabled":false})).unwrap();
    // Mesmo com chave real no cofre da máquina, esta regressão nunca enfileira rede.
    run("components.settings.set",json!({"data_dir":env.root.path().join("data"),"cache_dir":env.root.path().join("cache"),"cache_limit_bytes":1_000_000,"ffmpeg_path":null})).unwrap();
    let e = env.start(source).unwrap_err();
    assert_eq!(e.code, "transcription_retry_confirmation");
    assert_eq!(e.usage.unwrap()["estimate"]["kind"], "usd");
}

// ---- modelo fixo por Transcrição, precisão e dispositivo por bloco (#50) ----

const FAKE_GPU: &str = "NVIDIA GeForce RTX 3050 Laptop GPU, 616.92, 4096, 3962";
const GIB: u64 = 1024 * 1024 * 1024;

/// Sem NVIDIA (padrão: `small` em CPU) ou com um `nvidia-smi` falso (turbo na GPU), antes de instalar o worker.
fn gpu_env(gpu: Option<&str>) -> tempfile::TempDir {
    let dir = tempfile::tempdir().unwrap();
    let smi = dir.path().join(exe("nvidia-smi"));
    fs::copy(FAKE_WORKER, &smi).unwrap();
    std::env::set_var("CLIPES_NVIDIA_SMI", &smi);
    match gpu {
        Some(gpu) => std::env::set_var("CLIPES_FAKE_GPU", gpu),
        None => std::env::remove_var("CLIPES_FAKE_GPU"),
    }
    std::env::set_var("CLIPES_FAKE_RAM", format!("{},{}", 16 * GIB, 12 * GIB));
    dir
}

fn choose(model: &str, device: &str, compute_type: &str) {
    run(
        "transcription.hardware.choose",
        json!({"model":model,"device":device,"compute_type":compute_type}),
    )
    .unwrap();
}

fn crash_after_first_block(env: &Env, source: i64) {
    let crash = env.root.path().join("crash");
    fs::write(&crash, b"1").unwrap();
    std::env::set_var("CLIPES_FAKE_WORKER_CRASH", &crash);
    env.start(source).unwrap();
    env.wait_transcribe("failed");
    assert_eq!(env.status(source)["transcript"]["resume_us"], 8_000_000);
}

fn transcribe_log(env: &Env) -> Vec<String> {
    fs::read_to_string(env.root.path().join("transcribe.log"))
        .unwrap_or_default()
        .lines()
        .map(str::to_owned)
        .collect()
}

#[test]
fn resuming_keeps_the_model_even_when_another_configuration_is_saved() {
    let env = Env::with_gpu(25, None);
    env.install_models();
    std::env::set_var(
        "CLIPES_FAKE_TRANSCRIBE_LOG",
        env.root.path().join("transcribe.log"),
    );
    let source = env.import(0);
    crash_after_first_block(&env, source);
    assert_eq!(env.status(source)["transcript"]["model"], "whisper-small");
    // Uma sonda posterior escolheu o turbo em CPU para este hardware: não vale para esta Transcrição.
    fs::write(
        env.root.path().join("data/transcription-hardware.json"),
        json!({"probes":[{"key":{"gpu":"cpu","driver":"","ct2_version":"4.9.0","model":"whisper-turbo","app_version":env!("CARGO_PKG_VERSION")},"chosen":{"model":"whisper-turbo","device":"cpu","compute_type":"int8"},"verified":true,"attempts":[],"batch":null,"vram_free_mib":null,"measured_at":1}]}).to_string(),
    )
    .unwrap();
    let status = run("transcription.hardware.status", json!({})).unwrap();
    assert_eq!(status["effective"]["model"], "whisper-turbo");
    env.start(source).unwrap();
    wait("retomada concluída", || {
        env.status(source)["transcript"]["state"] == "complete"
    });
    assert_eq!(env.status(source)["transcript"]["model"], "whisper-small");
    let log = transcribe_log(&env);
    assert!(
        log.len() >= 3 && log.iter().all(|l| l.starts_with("whisper-small ")),
        "{log:?}"
    );
    assert_complete_transcript(&env.rows(source));
}

#[test]
fn precision_and_device_of_each_block_are_recorded_and_may_change_between_blocks() {
    let env = Env::with_gpu(25, Some(FAKE_GPU));
    env.install_models();
    let source = env.import(0);
    choose("whisper-turbo", "cuda", "int8_float16");
    crash_after_first_block(&env, source);
    // Mesmo modelo, outra precisão (queda da cadeia ou nova sonda): sem confirmação, sem recomeçar.
    choose("whisper-turbo", "cuda", "float16");
    env.start(source).unwrap();
    wait("retomada concluída", || {
        env.status(source)["transcript"]["state"] == "complete"
    });
    let blocks = run("transcription.blocks", json!({"source_id":source})).unwrap();
    let blocks = blocks.as_array().unwrap();
    assert_eq!(blocks.len(), 3);
    assert_eq!(blocks[0]["compute_type"], "int8_float16");
    assert_eq!(blocks[0]["device"], "cuda");
    assert!(blocks[1..].iter().all(|b| b["compute_type"] == "float16"));
    assert_eq!(env.status(source)["transcript"]["model"], "whisper-turbo");
    assert_complete_transcript(&env.rows(source));
}

#[test]
fn manually_switching_the_model_of_a_partial_transcript_asks_before_discarding_it() {
    let env = Env::with_gpu(25, None);
    env.install_models();
    let source = env.import(0);
    crash_after_first_block(&env, source);
    choose("whisper-turbo", "cpu", "int8");
    let error = env.start(source).unwrap_err();
    assert_eq!(error.code, "engine_change_confirmation");
    assert_eq!(error.usage.unwrap()["blocks"], 1);
    // Nada foi apagado e o modelo continua o mesmo até confirmar.
    assert_eq!(env.status(source)["transcript"]["model"], "whisper-small");
    assert_eq!(env.status(source)["transcript"]["words"], 8);
    run(
        "transcription.start",
        json!({"project":env.project,"source_id":source,"replace_confirmed":true}),
    )
    .unwrap();
    wait("transcrição nova concluída", || {
        env.status(source)["transcript"]["state"] == "complete"
    });
    assert_eq!(env.status(source)["transcript"]["model"], "whisper-turbo");
    assert_complete_transcript(&env.rows(source));
    // Completa: trocar o modelo só vale para uma retranscrição futura e não mexe na atual.
    choose("whisper-small", "cpu", "int8");
    let kept = env.start(source).unwrap();
    assert_eq!(kept["state"], "complete");
    assert_eq!(env.status(source)["transcript"]["model"], "whisper-turbo");
}

#[test]
fn resuming_a_partial_transcript_never_overwrites_corrections() {
    let env = Env::new(25);
    env.install_models();
    let source = env.import(0);
    let crash = env.root.path().join("crash");
    fs::write(&crash, b"1").unwrap();
    std::env::set_var("CLIPES_FAKE_WORKER_CRASH", &crash);
    env.start(source).unwrap();
    env.wait_transcribe("failed");
    // Transcrição parcial (sem Frases ainda): corrige a primeira palavra gravada.
    let first = env
        .rows(source)
        .into_iter()
        .find(|r| r["kind"] == "word")
        .unwrap();
    let position = first["position"].as_i64().unwrap();
    let original = first["text"].as_str().unwrap().to_owned();
    run(
        "transcription.correct",
        json!({"source_id":source,"position":position,"text":"CORRIGIDA"}),
    )
    .unwrap();
    env.start(source).unwrap();
    wait("transcrição completa", || {
        env.status(source)["transcript"]["state"] == "complete"
    });
    let rows = env.rows(source);
    let word = rows.iter().find(|r| r["position"] == position).unwrap();
    assert_eq!(word["text"].as_str().unwrap().trim(), "CORRIGIDA");
    assert_eq!(word["original_text"], original);
    assert_eq!(word["corrected"], true);
    // Blocos novos acrescentaram palavras sem repetir nem mexer nas anteriores.
    assert_eq!(rows.iter().filter(|r| r["corrected"] == true).count(), 1);
    // Frase e busca já nascem com o texto corrigido.
    let sentences = run("transcription.sentences", json!({"source_id":source})).unwrap();
    assert!(sentences[0]["text"].as_str().unwrap().contains("CORRIGIDA"));
    let hits = run("transcription.search", json!({"query":"corrigida"})).unwrap();
    assert_eq!(hits.as_array().unwrap().len(), 1);
}

// ---- Agrupar trechos de VAD (#162) ----

/// Grava uma sonda com lote seguro medido `safe` para a GPU falsa e escolhe o turbo em `int8_float16`.
fn gpu_with_measured_batch(env: &Env, safe: u32) {
    choose("whisper-turbo", "cuda", "int8_float16");
    let store = env.root.path().join("data/transcription-hardware.json");
    let mut value: Value = serde_json::from_slice(&fs::read(&store).unwrap()).unwrap();
    value["probes"] = json!([{
        "key": {"gpu":"NVIDIA GeForce RTX 3050 Laptop GPU","driver":"616.92","ct2_version":"4.9.0","model":"whisper-turbo","app_version":env!("CARGO_PKG_VERSION")},
        "chosen": {"model":"whisper-turbo","device":"cuda","compute_type":"int8_float16"},
        "verified": true, "attempts": [], "vram_free_mib": 3962, "measured_at": 1,
        "batch": {"compute_type":"int8_float16","tested":[[1,true],[2,true],[4,true],[8,false]],"max_safe":safe,"origin":"probe","measured_at":1}
    }]);
    fs::write(&store, value.to_string()).unwrap();
}

fn groups(env: &Env) -> Vec<String> {
    transcribe_log(env)
        .iter()
        .map(|l| l.rsplit(' ').next().unwrap().to_owned())
        .collect()
}

fn transcribe_to_the_end(env: &Env) -> i64 {
    std::env::set_var(
        "CLIPES_FAKE_TRANSCRIBE_LOG",
        env.root.path().join("transcribe.log"),
    );
    let source = env.import(0);
    env.start(source).unwrap();
    wait("transcrição completa", || {
        env.status(source)["transcript"]["state"] == "complete"
    });
    assert_complete_transcript(&env.rows(source));
    source
}

#[test]
fn grouping_is_off_by_default_and_one_span_is_sent_per_call() {
    let env = Env::with_gpu(25, Some(FAKE_GPU));
    env.install_models();
    gpu_with_measured_batch(&env, 4);
    let state = run("transcription.grouping", json!({})).unwrap();
    assert_eq!(state, json!({"enabled": false, "size": 1}));
    transcribe_to_the_end(&env);
    assert!(groups(&env).iter().all(|g| g == "1"), "{:?}", groups(&env));
}

#[test]
fn enabled_grouping_uses_the_measured_safe_batch_and_keeps_blocks_unchanged() {
    let env = Env::with_gpu(25, Some(FAKE_GPU));
    env.install_models();
    gpu_with_measured_batch(&env, 4);
    let state = run("transcription.grouping", json!({"enabled": true})).unwrap();
    assert_eq!(state, json!({"enabled": true, "size": 4}));
    let source = transcribe_to_the_end(&env);
    assert!(groups(&env).iter().all(|g| g == "4"), "{:?}", groups(&env));
    // Mesmo formato de bloco e checkpoint: um bloco por 8 s de Fonte, como sem agrupar.
    assert_eq!(env.status(source)["transcript"]["resume_us"], 25_000_000);
    assert!(run("transcription.grouping", json!({"enabled": "sim"})).is_err());
}

#[test]
fn grouping_without_a_measured_batch_stays_at_one() {
    let env = Env::with_gpu(25, Some(FAKE_GPU));
    env.install_models();
    choose("whisper-turbo", "cuda", "int8_float16");
    let state = run("transcription.grouping", json!({"enabled": true})).unwrap();
    assert_eq!(state["size"], 1);
}

#[test]
fn out_of_memory_halves_the_group_redoes_only_the_block_and_updates_the_measurement() {
    let env = Env::with_gpu(25, Some(FAKE_GPU));
    env.install_models();
    gpu_with_measured_batch(&env, 8);
    run("transcription.grouping", json!({"enabled": true})).unwrap();
    std::env::set_var("CLIPES_FAKE_GROUP_OOM", "3");
    transcribe_to_the_end(&env);
    // O primeiro bloco tenta 8, depois 4, depois 2 e passa; os seguintes já começam em 2.
    let log = groups(&env);
    assert_eq!(&log[..3], ["8", "4", "2"], "{log:?}");
    assert!(log[3..].iter().all(|g| g == "2"), "{log:?}");
    let store: Value = serde_json::from_slice(
        &fs::read(env.root.path().join("data/transcription-hardware.json")).unwrap(),
    )
    .unwrap();
    let batch = &store["probes"][0]["batch"];
    assert_eq!(batch["max_safe"], 2);
    assert_eq!(batch["origin"], "oom");
    assert!(batch["tested"]
        .as_array()
        .unwrap()
        .contains(&json!([4, false])));
    assert_eq!(run("transcription.grouping", json!({})).unwrap()["size"], 2);
}

#[test]
fn out_of_memory_with_a_group_of_one_is_still_a_typed_failure() {
    let env = Env::with_gpu(25, Some(FAKE_GPU));
    env.install_models();
    gpu_with_measured_batch(&env, 2);
    run("transcription.grouping", json!({"enabled": true})).unwrap();
    std::env::set_var("CLIPES_FAKE_GROUP_OOM", "1");
    std::env::set_var(
        "CLIPES_FAKE_TRANSCRIBE_LOG",
        env.root.path().join("transcribe.log"),
    );
    let source = env.import(0);
    env.start(source).unwrap();
    env.wait_transcribe("failed");
    assert_eq!(groups(&env), ["2", "1"]);
}

// ---- Idioma fixo por Fonte (#195) ----

#[test]
fn fixed_source_language_is_sent_to_every_block_across_crash_and_resume() {
    let env = Env::new(25);
    env.install_models();
    let lang_log = env.root.path().join("language.log");
    std::env::set_var("CLIPES_FAKE_LANGUAGE_LOG", &lang_log);
    let media = env.root.path().join("source-en.mp4");
    fs::write(&media, b"media").unwrap();
    let imported = run(
        "sources.import",
        json!({"project":env.project,"path":media,"permission":{"status":"none"},"audio_track":0,"language":"en"}),
    )
    .unwrap();
    assert_eq!(imported["language"], "en");
    let source = imported["id"].as_i64().unwrap();
    assert_eq!(env.status(source)["language"], "en");

    let crash = env.root.path().join("crash");
    fs::write(&crash, b"1").unwrap();
    std::env::set_var("CLIPES_FAKE_WORKER_CRASH", &crash);
    env.start(source).unwrap();
    env.wait_transcribe("failed");
    assert_eq!(env.status(source)["transcript"]["resume_us"], 8_000_000);

    env.start(source).unwrap();
    env.wait_transcribe("completed");

    let sent: Vec<String> = fs::read_to_string(&lang_log)
        .unwrap()
        .lines()
        .map(str::to_owned)
        .collect();
    assert!(sent.len() >= 3, "{sent:?}");
    assert!(sent.iter().all(|l| l == "en"), "{sent:?}");

    let rows = env.rows(source);
    let words: Vec<_> = rows.iter().filter(|r| r["kind"] == "word").collect();
    assert_eq!(words.len(), 25);
    assert!(words.iter().all(|w| w["language"] == "en"));
    let sentences = run("transcription.sentences", json!({"source_id":source})).unwrap();
    assert!(sentences
        .as_array()
        .unwrap()
        .iter()
        .all(|s| s["language"] == "en"));
}

#[test]
fn silence_only_first_block_keeps_fixed_language_on_subsequent_blocks() {
    let env = Env::new(20);
    env.install_models();
    let lang_log = env.root.path().join("language-silent.log");
    std::env::set_var("CLIPES_FAKE_LANGUAGE_LOG", &lang_log);
    std::env::set_var("CLIPES_FAKE_SILENT_BLOCKS", "1");
    let media = env.root.path().join("source-es.mp4");
    fs::write(&media, b"media").unwrap();
    let source = run(
        "sources.import",
        json!({"project":env.project,"path":media,"permission":{"status":"none"},"audio_track":0,"language":"es"}),
    )
    .unwrap()["id"]
        .as_i64()
        .unwrap();
    env.start(source).unwrap();
    env.wait_transcribe("completed");

    let sent: Vec<String> = fs::read_to_string(&lang_log)
        .unwrap()
        .lines()
        .map(str::to_owned)
        .collect();
    assert_eq!(sent, ["es", "es"]);
    let rows = env.rows(source);
    assert_eq!(rows[0]["kind"], "silence");
    assert_eq!(rows[0]["start_us"], 0);
    // Bloco 1 (0..10 s só silêncio) se funde com o silêncio inicial do bloco 2 (10..10,1 s).
    assert_eq!(rows[0]["end_us"], 10_100_000);
    let words: Vec<_> = rows.iter().filter(|r| r["kind"] == "word").collect();
    assert_eq!(words.len(), 10);
    assert!(words.iter().all(|w| w["language"] == "es"));
}

#[test]
fn source_language_is_editable_before_start_and_locked_after_progress() {
    let env = Env::new(25);
    env.install_models();
    let source = env.import(0);
    assert_eq!(env.status(source)["language"], "pt");

    assert_eq!(
        run(
            "sources.language.set",
            json!({"project":env.project,"id":source,"language":"invalid-code"}),
        )
        .unwrap_err()
        .code,
        "invalid_language"
    );

    let updated = run(
        "sources.language.set",
        json!({"project":env.project,"id":source,"language":"fr"}),
    )
    .unwrap();
    assert_eq!(updated["language"], "fr");
    assert_eq!(env.status(source)["language"], "fr");

    let hold = env.root.path().join("hold");
    let held = env.root.path().join("held");
    fs::write(&hold, b"1").unwrap();
    std::env::set_var("CLIPES_FAKE_WORKER_HOLD", &hold);
    std::env::set_var("CLIPES_FAKE_WORKER_HELD", &held);
    let started = run(
        "transcription.start",
        json!({"project":env.project,"source_id":source,"language":"de"}),
    )
    .unwrap();
    assert_eq!(env.status(source)["language"], "de");
    wait("worker falso segurou a transcrição", || {
        held.exists()
            && env
                .job_state("transcription")
                .is_some_and(|(s, _)| s == "running")
    });
    assert_eq!(
        run(
            "sources.language.set",
            json!({"project":env.project,"id":source,"language":"it"}),
        )
        .unwrap_err()
        .code,
        "transcription_busy"
    );
    run("jobs.cancel", json!({"id":started["job_id"]})).unwrap();
    // Só solta o worker depois de confirmar o cancelamento, para não concluir o 1º bloco antes do sinal chegar.
    env.wait_transcribe("cancelled");
    fs::remove_file(&hold).unwrap();
    let _ = fs::remove_file(&held);
    std::env::remove_var("CLIPES_FAKE_WORKER_HOLD");
    std::env::remove_var("CLIPES_FAKE_WORKER_HELD");

    // 0 blocos gravados: ainda permite editar antes de retomar com blocos.
    assert_eq!(env.status(source)["transcript"]["resume_us"], 0);
    run(
        "sources.language.set",
        json!({"project":env.project,"id":source,"language":"it"}),
    )
    .unwrap();
    assert_eq!(env.status(source)["language"], "it");

    // Após gravar o 1º bloco, trava o idioma como fixo da Fonte.
    let crash = env.root.path().join("crash");
    fs::write(&crash, b"1").unwrap();
    std::env::set_var("CLIPES_FAKE_WORKER_CRASH", &crash);
    env.start(source).unwrap();
    env.wait_transcribe("failed");
    assert_eq!(env.status(source)["transcript"]["resume_us"], 8_000_000);
    assert_eq!(
        run(
            "sources.language.set",
            json!({"project":env.project,"id":source,"language":"es"}),
        )
        .unwrap_err()
        .code,
        "transcript_partial"
    );

    env.start(source).unwrap();
    env.wait_transcribe("completed");
    assert_eq!(
        run(
            "sources.language.set",
            json!({"project":env.project,"id":source,"language":"es"}),
        )
        .unwrap_err()
        .code,
        "transcript_complete"
    );
    assert!(env
        .rows(source)
        .iter()
        .filter(|r| r["kind"] == "word")
        .all(|w| w["language"] == "it"));
}

#[test]
fn groq_engine_sends_fixed_source_language_in_every_block() {
    use std::{
        io::{Read, Write},
        net::TcpListener,
        sync::atomic::AtomicBool,
    };
    let env = Env::new(25);
    let media = env.root.path().join("source-groq-en.mp4");
    fs::write(&media, b"media").unwrap();
    let source = run(
        "sources.import",
        json!({"project":env.project,"path":media,"permission":{"status":"none"},"audio_track":0,"language":"en"}),
    )
    .unwrap()["id"]
        .as_i64()
        .unwrap();
    let listener = TcpListener::bind("127.0.0.1:0").unwrap();
    let endpoint = format!(
        "http://{}/audio/transcriptions",
        listener.local_addr().unwrap()
    );
    let server = std::thread::spawn(move || {
        for _ in 0..3 {
            let (mut socket, _) = listener.accept().unwrap();
            socket.set_nonblocking(false).unwrap();
            socket
                .set_read_timeout(Some(Duration::from_secs(5)))
                .unwrap();
            let mut bytes = Vec::new();
            let mut buf = [0; 4096];
            loop {
                let n = socket.read(&mut buf).unwrap();
                assert!(n > 0);
                bytes.extend_from_slice(&buf[..n]);
                if let Some(end) = bytes.windows(4).position(|w| w == b"\r\n\r\n") {
                    let len = String::from_utf8_lossy(&bytes[..end])
                        .lines()
                        .find_map(|l| {
                            l.to_lowercase()
                                .strip_prefix("content-length: ")
                                .and_then(|s| s.parse::<usize>().ok())
                        })
                        .unwrap();
                    if bytes.len() >= end + 4 + len {
                        break;
                    }
                }
            }
            let request = String::from_utf8_lossy(&bytes);
            assert!(
                request.contains("name=\"language\"\r\n\r\nen\r\n")
                    || request.contains("name=\"language\"\n\nen\n"),
                "campo language=en ausente no multipart"
            );
            let body = r#"{"language":"english","words":[{"word":"hello","start":0.1,"end":0.5}]}"#;
            write!(
                socket,
                "HTTP/1.1 200 OK\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{}",
                body.len(),
                body
            )
            .unwrap();
        }
    });
    let job = env.paid_job(source);
    let client =
        clipes_core::worker::WorkerClient::start(FAKE_WORKER, ["--scenario", "unused"], |_| {})
            .unwrap();
    let mut engine = clipes_core::transcription::GroqEngine::with_worker(
        client,
        "fake-key".into(),
        endpoint,
        env.root.path().join(exe("fake-ffmpeg")),
        Duration::from_secs(5),
    );
    clipes_core::transcription::run_with(
        &mut engine,
        job,
        source,
        Path::new(&env.project),
        &AtomicBool::new(false),
    )
    .unwrap();
    server.join().unwrap();
    let words: Vec<_> = env
        .rows(source)
        .into_iter()
        .filter(|r| r["kind"] == "word")
        .collect();
    assert_eq!(words.len(), 3);
    assert!(words.iter().all(|w| w["language"] == "en"));
}
