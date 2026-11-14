//! Contrato do núcleo contra o worker falso, que reproduz as mensagens de
//! exemplo compartilhadas com o worker Python (worker/protocol/examples).
//! Nenhum teste acessa a rede; os dados ficam isolados em CLIPES_DATA_DIR.

use clipes_core::worker::{WorkerClient, WorkerEvent};
use clipes_core::{dispatch, ProgressEvent};
use serde_json::{json, Value};
use std::{
    fs,
    path::{Path, PathBuf},
    sync::{atomic::AtomicBool, Mutex},
    time::{Duration, Instant},
};

const FAKE: &str = env!("CARGO_BIN_EXE_fake-worker");
// CLIPES_DATA_DIR é global ao processo: os testes de dispatch rodam um por vez.
static ENV: Mutex<()> = Mutex::new(());

fn client(scenario: &str) -> WorkerClient {
    WorkerClient::start(FAKE, ["--scenario", scenario], |_| {}).unwrap()
}
fn idle() -> AtomicBool {
    AtomicBool::new(false)
}

#[test]
fn handshake_reports_versions() {
    let client = client("handshake");
    let h = client.handshake();
    assert_eq!(h.protocol, 1);
    assert_eq!(h.worker, "fake");
    assert_eq!(h.libs["faster-whisper"].as_deref(), Some("fake"));
    client.shutdown();
}

#[test]
fn run_returns_result_with_progress_and_model_events() {
    let mut client = client("run-ok");
    let mut events = Vec::new();
    let data = client
        .run(
            "transcribe",
            json!({"audio":"fonte.wav"}),
            &idle(),
            &mut |e| events.push(e),
        )
        .unwrap();
    assert_eq!(data, json!({"text":"olá mundo"}));
    assert_eq!(
        events,
        vec![
            WorkerEvent::Model {
                event: "model_loaded".into(),
                model: "fake-whisper".into()
            },
            WorkerEvent::Progress {
                stage: "transcribing".into(),
                percentage: 50,
                message: "Transcrevendo".into()
            },
        ]
    );
    client.shutdown();
}

#[test]
fn second_model_is_announced_after_the_first_is_released() {
    let mut client = client("model-swap");
    let mut events = Vec::new();
    client
        .run("transcribe", json!({}), &idle(), &mut |e| events.push(e))
        .unwrap();
    client
        .run("reframe", json!({}), &idle(), &mut |e| events.push(e))
        .unwrap();
    let models: Vec<_> = events
        .iter()
        .filter_map(|e| match e {
            WorkerEvent::Model { event, model } => Some(format!("{event}:{model}")),
            _ => None,
        })
        .collect();
    assert_eq!(
        models,
        [
            "model_loaded:fake-whisper",
            "model_released:fake-whisper",
            "model_loaded:fake-yunet"
        ]
    );
    client.shutdown();
}

#[test]
fn cancel_message_is_sent_and_typed_error_returned() {
    let mut client = client("cancel");
    let cancel = AtomicBool::new(false);
    let error = client
        .run(
            "transcribe",
            json!({"wait_for_cancel":true}),
            &cancel,
            &mut |e| {
                if matches!(e, WorkerEvent::Progress { .. }) {
                    cancel.store(true, std::sync::atomic::Ordering::SeqCst);
                }
            },
        )
        .unwrap_err();
    assert_eq!(error.code, "cancelled");
    client.shutdown();
}

#[test]
fn worker_errors_become_fixed_typed_errors() {
    let mut client = client("error");
    let missing = client
        .run("tts", json!({}), &idle(), &mut |_| {})
        .unwrap_err();
    assert_eq!(
        (missing.code.as_str(), missing.message.as_str()),
        ("model_missing", "O modelo necessário não está instalado.")
    );
    let unknown = client
        .run("inexistente", json!({}), &idle(), &mut |_| {})
        .unwrap_err();
    assert_eq!(unknown.code, "unknown_task");
    client.shutdown();
}

#[test]
fn contract_violation_by_the_core_makes_the_fake_fail() {
    // O worker falso exige exatamente as mensagens do exemplo: uma tarefa fora
    // do roteiro derruba a conversa, o que o cliente relata como worker_crashed.
    let mut client = client("run-ok");
    let error = client
        .run("reframe", json!({}), &idle(), &mut |_| {})
        .unwrap_err();
    assert_eq!(error.code, "worker_crashed");
}

#[test]
fn missing_executable_is_a_typed_error_without_paths() {
    let error = WorkerClient::start("/nao/existe/worker", ["x"], |_| {})
        .err()
        .unwrap();
    assert_eq!(error.code, "worker_start");
    assert!(!error.message.contains("existe"));
}

#[test]
fn every_example_line_is_a_core_or_worker_protocol_v1_message() {
    let dir = Path::new(env!("CARGO_MANIFEST_DIR")).join("../worker/protocol/examples");
    let mut seen = 0;
    for entry in fs::read_dir(dir).unwrap() {
        let path = entry.unwrap().path();
        for line in fs::read_to_string(&path)
            .unwrap()
            .lines()
            .filter(|l| !l.is_empty())
        {
            let value: Value = serde_json::from_str(line).unwrap();
            assert!(
                matches!(value["from"].as_str(), Some("core" | "worker")),
                "{path:?}"
            );
            assert_eq!(value["message"]["v"], 1, "{path:?}");
            assert!(value["message"]["type"].is_string());
            seen += 1;
        }
    }
    assert!(seen > 20);
}

// ----- instalação e status (uv e worker falsos, sem rede) -----

struct Data {
    _guard: std::sync::MutexGuard<'static, ()>,
    root: tempfile::TempDir,
}
impl Data {
    fn new() -> Data {
        let guard = ENV.lock().unwrap_or_else(|e| e.into_inner());
        let root = tempfile::tempdir().unwrap();
        std::env::set_var("CLIPES_DATA_DIR", root.path());
        Data {
            _guard: guard,
            root,
        }
    }
    fn worker(&self) -> PathBuf {
        self.root.path().join("worker")
    }
    fn exe(name: &str) -> String {
        if cfg!(windows) {
            format!("{name}.exe")
        } else {
            name.into()
        }
    }
    /// Instala o uv falso como se o Componente já tivesse sido baixado.
    fn fake_uv(&self) {
        let manifest = dispatch("components.manifest", json!({}), &mut |_| {}).unwrap();
        let version = manifest
            .as_array()
            .unwrap()
            .iter()
            .find(|c| c["id"] == "uv")
            .unwrap()["version"]
            .as_str()
            .unwrap()
            .to_owned();
        let dir = self.root.path().join("components");
        fs::create_dir_all(&dir).unwrap();
        fs::copy(FAKE, dir.join(Self::exe("uv"))).unwrap();
        fs::write(dir.join("uv.version"), version).unwrap();
    }
}

fn install(events: &mut Vec<ProgressEvent>) -> Result<Value, clipes_core::CoreError> {
    dispatch(
        "components.worker.install",
        json!({"confirmed":true}),
        &mut |e| events.push(e),
    )
}

#[test]
fn uv_is_a_pinned_licensed_component() {
    let manifest = dispatch("components.manifest", json!({}), &mut |_| {}).unwrap();
    let uv = manifest
        .as_array()
        .unwrap()
        .iter()
        .find(|c| c["id"] == "uv")
        .unwrap();
    assert!(uv["url"].as_str().unwrap().contains("/0.13.8/"));
    assert_eq!(uv["sha256"].as_str().unwrap().len(), 64);
    assert_eq!(uv["license"], "Apache-2.0");
    assert!(uv["source_url"]
        .as_str()
        .unwrap()
        .starts_with("https://github.com/astral-sh/uv"));
}

#[test]
fn install_requires_confirmation() {
    let _data = Data::new();
    let error = dispatch("components.worker.install", json!({}), &mut |_| {}).unwrap_err();
    assert_eq!(error.code, "confirmation_required");
}

#[test]
fn status_without_install_says_not_installed() {
    let _data = Data::new();
    let status = dispatch("components.worker.status", json!({}), &mut |_| {}).unwrap();
    assert_eq!(status, json!({"installed": false}));
}

#[test]
fn install_uses_only_managed_python_and_status_reports_handshake_versions() {
    let data = Data::new();
    data.fake_uv();
    let mut events = Vec::new();
    let result = install(&mut events).unwrap();
    assert_eq!(result["handshake"]["protocol"], 1);

    // O uv foi chamado só com Python gerenciado, sem tocar no do sistema.
    let log = fs::read_to_string(data.worker().join("uv-calls.log")).unwrap();
    assert!(
        log.contains("ENV UV_PYTHON_PREFERENCE=only-managed"),
        "{log}"
    );
    for call in log.lines().filter(|l| l.starts_with("ARGS")) {
        assert!(call.contains("--python-preference only-managed"), "{call}");
    }
    assert!(log.contains("ARGS python install 3.12"));
    assert!(
        log.contains("--frozen"),
        "dependências travadas pelo lockfile"
    );
    let root = data.root.path().to_string_lossy().replace('\\', "/");
    for line in log.lines().filter(|l| {
        l.starts_with("ENV UV_PYTHON_INSTALL_DIR")
            || l.starts_with("ENV UV_PROJECT_ENVIRONMENT")
            || l.starts_with("ENV UV_CACHE_DIR")
    }) {
        assert!(line.replace('\\', "/").contains(&root), "{line}");
    }

    let stages: Vec<_> = events
        .iter()
        .map(|e| (e.stage.as_str(), e.percentage))
        .collect();
    assert!(stages.contains(&("worker", 25)) && stages.contains(&("worker", 95)));
    assert_eq!(*stages.last().unwrap(), ("complete", 100));

    let status = dispatch("components.worker.status", json!({}), &mut |_| {}).unwrap();
    assert_eq!(status["installed"], true);
    assert_eq!(status["outdated"], false);
    assert_eq!(status["handshake"]["worker"], "fake");
    assert_eq!(status["handshake"]["python"], "fake");
    assert_eq!(status["handshake"]["libs"]["onnxruntime"], "fake");
    assert!(
        !status.to_string().contains(&root),
        "o status não expõe caminhos"
    );
}

#[test]
fn cancelling_stops_uv_and_removes_the_partial_environment() {
    let data = Data::new();
    data.fake_uv();
    fs::create_dir_all(data.worker()).unwrap();
    fs::write(data.worker().join("fake-hang"), b"1").unwrap();
    let started = data.worker().join("sync-started");
    let canceller = std::thread::spawn({
        let started = started.clone();
        move || {
            let deadline = Instant::now() + Duration::from_secs(30);
            while !started.exists() && Instant::now() < deadline {
                std::thread::sleep(Duration::from_millis(20));
            }
            dispatch("components.cancel", json!({"id":"worker"}), &mut |_| {}).unwrap();
        }
    });
    let begin = Instant::now();
    let error = install(&mut Vec::new()).unwrap_err();
    canceller.join().unwrap();
    assert_eq!(error.code, "cancelled");
    assert!(
        begin.elapsed() < Duration::from_secs(60),
        "o uv deveria ter sido encerrado"
    );
    assert!(!data.worker().join("venv").exists());
    assert!(!data.worker().join("python").exists());
    let status = dispatch("components.worker.status", json!({}), &mut |_| {}).unwrap();
    assert_eq!(status["installed"], false);
    // Pode instalar de novo depois de cancelar.
    fs::remove_file(data.worker().join("fake-hang")).unwrap();
    install(&mut Vec::new()).unwrap();
}

#[test]
fn a_second_install_while_one_runs_is_refused() {
    let data = Data::new();
    data.fake_uv();
    fs::create_dir_all(data.worker()).unwrap();
    fs::write(data.worker().join("fake-hang"), b"1").unwrap();
    let background = std::thread::spawn(|| install(&mut Vec::new()));
    let started = data.worker().join("sync-started");
    let deadline = Instant::now() + Duration::from_secs(30);
    while !started.exists() && Instant::now() < deadline {
        std::thread::sleep(Duration::from_millis(20));
    }
    let error = install(&mut Vec::new()).unwrap_err();
    assert_eq!(error.code, "already_downloading");
    dispatch("components.cancel", json!({"id":"worker"}), &mut |_| {}).unwrap();
    assert_eq!(background.join().unwrap().unwrap_err().code, "cancelled");
}

/// Instalação real (rede e centenas de MB): `CLIPES_REAL_UV=<caminho do uv fixado>
/// cargo test -p clipes-core --test worker -- --ignored real_install`.
#[test]
#[ignore]
fn real_install_with_the_pinned_uv_reaches_the_python_worker() {
    let uv = std::env::var_os("CLIPES_REAL_UV").expect("CLIPES_REAL_UV");
    let data = Data::new();
    let dir = data.root.path().join("components");
    fs::create_dir_all(&dir).unwrap();
    fs::copy(uv, dir.join(Data::exe("uv"))).unwrap();
    let result = install(&mut Vec::new()).unwrap();
    assert_eq!(result["handshake"]["protocol"], 1);
    let status = dispatch("components.worker.status", json!({}), &mut |_| {}).unwrap();
    assert!(status["handshake"]["python"]
        .as_str()
        .unwrap()
        .starts_with("3.12."));
    assert!(status["handshake"]["libs"]["faster-whisper"].is_string());
    let mut client = clipes_core::worker::WorkerClient::start(
        data.worker().join("venv/Scripts/python.exe"),
        ["-m", "clipes_worker"],
        |c| {
            c.env("PYTHONPATH", data.worker().join("project/src"));
        },
    )
    .unwrap();
    let error = client
        .run("tts", json!({}), &idle(), &mut |_| {})
        .unwrap_err();
    assert_eq!(error.code, "model_missing");
}
