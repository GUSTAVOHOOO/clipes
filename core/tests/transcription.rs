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
        let guard = SERIAL.lock().unwrap_or_else(|e| e.into_inner());
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
    assert_eq!(
        job[job.as_array().unwrap().len() - 1]["checkpoint"],
        json!(json!({"resume_us": 8_000_000}).to_string())
    );
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
