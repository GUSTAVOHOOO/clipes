//! Sonda de hardware, escolha de precisão e estimativa de tempo (#50), headless e sem rede:
//! o worker falso responde `probe`, o `nvidia-smi` falso informa a GPU e a RAM é simulada.
//! Os dados ficam isolados em CLIPES_DATA_DIR.

use clipes_core::dispatch;
use serde_json::{json, Value};
use std::{
    fs,
    path::{Path, PathBuf},
    process::Command,
    sync::Mutex,
    time::Duration,
};

const FAKE_WORKER: &str = env!("CARGO_BIN_EXE_fake-worker");
static SERIAL: Mutex<()> = Mutex::new(());
const GIB: u64 = 1024 * 1024 * 1024;
const GPU: &str = "NVIDIA GeForce RTX 3050 Laptop GPU, 616.92, 4096, 3962";

fn run(name: &str, args: Value) -> Result<Value, clipes_core::CoreError> {
    dispatch(name, args, &mut |_| {})
}

fn exe(name: &str) -> String {
    if cfg!(windows) {
        format!("{name}.exe")
    } else {
        name.into()
    }
}

struct Env {
    _guard: std::sync::MutexGuard<'static, ()>,
    root: tempfile::TempDir,
}

impl Env {
    /// `gpu`: saída do `nvidia-smi` falso ("nome, driver, total, livre"); `None` é um PC sem NVIDIA.
    fn new(gpu: Option<&str>, install_models: bool) -> Env {
        let guard = SERIAL.lock().unwrap_or_else(|e| e.into_inner());
        let root = tempfile::tempdir().unwrap();
        let data = root.path().join("data");
        std::env::set_var("CLIPES_DATA_DIR", &data);
        for key in [
            "CLIPES_FAKE_PROBE_FAIL",
            "CLIPES_PROBE_TIMEOUT_SECONDS",
            "CLIPES_FAKE_RAM",
            "CLIPES_FAKE_CUDA_TYPES",
            "CLIPES_FAKE_PROBE_RATE",
        ] {
            std::env::remove_var(key);
        }
        std::env::set_var("CLIPES_FAKE_WORKER_MODE", "transcribe");
        std::env::set_var("CLIPES_FAKE_PROBE_LOG", root.path().join("probe.log"));
        fs::create_dir_all(data.join("components")).unwrap();
        let smi = root.path().join(exe("nvidia-smi"));
        fs::copy(FAKE_WORKER, &smi).unwrap();
        std::env::set_var("CLIPES_NVIDIA_SMI", &smi);
        match gpu {
            Some(gpu) => std::env::set_var("CLIPES_FAKE_GPU", gpu),
            None => std::env::remove_var("CLIPES_FAKE_GPU"),
        }
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
        fs::copy(FAKE_WORKER, data.join("components").join(exe("uv"))).unwrap();
        fs::write(data.join("components/uv.version"), version).unwrap();
        run("components.worker.install", json!({"confirmed":true})).unwrap();
        let env = Env {
            _guard: guard,
            root,
        };
        if install_models {
            env.install_models(&["whisper-turbo", "whisper-small"]);
        }
        env
    }

    fn install_models(&self, ids: &[&str]) {
        let models = run("components.models.manifest", json!({})).unwrap();
        for model in models.as_array().unwrap() {
            let id = model["id"].as_str().unwrap();
            if !ids.contains(&id) {
                continue;
            }
            let dir = self.root.path().join("data/models").join(id);
            fs::create_dir_all(&dir).unwrap();
            fs::write(
                dir.join("model.state.json"),
                json!({"revision": model["revision"]}).to_string(),
            )
            .unwrap();
        }
    }

    fn log(&self) -> Vec<Vec<String>> {
        fs::read_to_string(self.root.path().join("probe.log"))
            .unwrap_or_default()
            .lines()
            .map(|l| l.split(' ').map(str::to_owned).collect())
            .collect()
    }

    fn import_source(&self, seconds: u32) -> i64 {
        let dir = self.root.path();
        let fake = dir.join(exe("fake-ffmpeg"));
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
        fs::write(dir.join("continue"), b"go").unwrap();
        std::env::set_var("CLIPES_FAKE_FFMPEG_STATE", dir);
        std::env::set_var("CLIPES_FFPROBE", &fake);
        std::env::set_var("CLIPES_FAKE_DURATION", seconds.to_string());
        run(
            "components.settings.set",
            json!({"data_dir":dir.join("data"),"cache_dir":dir.join("cache"),"cache_limit_bytes":1_000_000,"ffmpeg_path":fake}),
        )
        .unwrap();
        let project = run("projects.create", json!({"parent":dir,"name":"Canal"})).unwrap();
        let project = project["path"].as_str().unwrap().to_owned();
        fs::write(dir.join("project-path"), &project).unwrap();
        let media = dir.join("source.mp4");
        fs::write(&media, b"media").unwrap();
        let source = run(
            "sources.import",
            json!({"project":project,"path":media,"permission":{"status":"none"},"audio_track":0}),
        )
        .unwrap();
        source["id"].as_i64().unwrap()
    }

    fn project(&self) -> String {
        fs::read_to_string(self.root.path().join("project-path")).unwrap()
    }

    fn start(&self, source: i64) -> Result<Value, clipes_core::CoreError> {
        run(
            "transcription.start",
            json!({"project":self.project(),"source_id":source,"engine":"local"}),
        )
    }

    fn estimate(&self, source: i64, remeasure: bool) -> Result<Value, clipes_core::CoreError> {
        run(
            "transcription.estimate",
            json!({"project":self.project(),"source_id":source,"remeasure":remeasure}),
        )
    }
}

#[test]
fn chain_picks_int8_float16_first_and_isolates_every_attempt() {
    let env = Env::new(Some(GPU), true);
    let result = run("transcription.hardware.probe", json!({})).unwrap();
    assert_eq!(result["chosen"]["compute_type"], "int8_float16");
    assert_eq!(result["chosen"]["device"], "cuda");
    assert_eq!(result["verified"], true);
    let log = env.log();
    // info + int8_float16 (lote 1) + escada de lotes 1, 2, 4, 8.
    let modes: Vec<_> = log.iter().map(|l| (l[1].as_str(), l[4].as_str())).collect();
    assert_eq!(
        modes,
        [
            ("info", "1"),
            ("clip", "1"),
            ("clip", "1"),
            ("clip", "2"),
            ("clip", "4"),
            ("clip", "8")
        ]
    );
    let mut pids: Vec<_> = log.iter().map(|l| l[0].clone()).collect();
    pids.sort();
    pids.dedup();
    assert_eq!(
        pids.len(),
        log.len(),
        "cada tentativa roda num processo próprio"
    );
    let status = run("transcription.hardware.status", json!({})).unwrap();
    assert_eq!(status["effective"]["compute_type"], "int8_float16");
    assert_eq!(status["no_compatible_gpu"], false);
    assert_eq!(status["gpu"]["free_mib"], 3962);
    // A MEDIÇÃO do lote fica só no diagnóstico, com origem e data; a UI não a recebe.
    assert!(!status.to_string().contains("max_safe"));
    let diagnostic = run("transcription.hardware.diagnostic", json!({})).unwrap();
    assert_eq!(diagnostic["batch"]["max_safe"], 8);
    assert_eq!(diagnostic["batch"]["origin"], "probe");
    assert!(diagnostic["batch"]["measured_at"].as_u64().unwrap() > 0);
    assert_eq!(diagnostic["key"]["ct2_version"], "4.9.0");
    assert_eq!(diagnostic["key"]["driver"], "616.92");
    assert_eq!(
        diagnostic["key"]["gpu"],
        "NVIDIA GeForce RTX 3050 Laptop GPU"
    );
    assert!(diagnostic["key"]["app_version"].is_string());
    assert_eq!(diagnostic["key"]["model"], "whisper-turbo");
    let text = run("diagnostic.get", json!({})).unwrap()["text"]
        .as_str()
        .unwrap()
        .to_owned();
    assert!(
        text.contains("3962 MiB livres") && text.contains("lote seguro medido 8"),
        "{text}"
    );
    // O cache fica nos dados do app, não no Projeto.
    assert!(env
        .root
        .path()
        .join("data/transcription-hardware.json")
        .is_file());
}

#[test]
fn falls_back_to_float16_then_int8_then_cpu() {
    let _env = Env::new(Some(GPU), true);
    std::env::set_var("CLIPES_FAKE_PROBE_FAIL", "fail:int8_float16");
    let result = run("transcription.hardware.probe", json!({})).unwrap();
    assert_eq!(result["chosen"]["compute_type"], "float16");
    std::env::set_var("CLIPES_FAKE_PROBE_FAIL", "fail:int8_float16,fail:float16");
    let result = run("transcription.hardware.probe", json!({})).unwrap();
    assert_eq!(result["chosen"]["compute_type"], "int8");
    assert_eq!(result["chosen"]["device"], "cuda");
    std::env::set_var(
        "CLIPES_FAKE_PROBE_FAIL",
        "fail:int8_float16,fail:float16,fail:int8",
    );
    let result = run("transcription.hardware.probe", json!({})).unwrap();
    assert_eq!(result["chosen"]["device"], "cpu");
    assert_eq!(result["chosen"]["model"], "whisper-small");
    assert_eq!(result["verified"], true);
    let status = run("transcription.hardware.status", json!({})).unwrap();
    assert_eq!(status["no_compatible_gpu"], true);
}

#[test]
fn only_precisions_the_ct2_build_supports_are_attempted() {
    let env = Env::new(Some(GPU), true);
    std::env::set_var("CLIPES_FAKE_CUDA_TYPES", "int8,float32");
    let result = run("transcription.hardware.probe", json!({})).unwrap();
    assert_eq!(result["chosen"]["compute_type"], "int8");
    let tried: Vec<_> = env
        .log()
        .iter()
        .filter(|l| l[1] == "clip" && l[4] == "1")
        .map(|l| l[3].clone())
        .collect();
    assert_eq!(tried[0], "int8");
}

#[test]
fn batch_ladder_stops_at_the_first_failure_and_stays_diagnostic_only() {
    let env = Env::new(Some(GPU), true);
    std::env::set_var("CLIPES_FAKE_PROBE_FAIL", "oom:4");
    run("transcription.hardware.probe", json!({})).unwrap();
    let diagnostic = run("transcription.hardware.diagnostic", json!({})).unwrap();
    assert_eq!(diagnostic["batch"]["max_safe"], 2);
    assert_eq!(
        diagnostic["batch"]["tested"],
        json!([[1, true], [2, true], [4, false]])
    );
    // Parou no 4: o lote 8 nem foi tentado.
    assert!(!env.log().iter().any(|l| l[1] == "clip" && l[4] == "8"));
}

#[test]
fn a_hung_attempt_times_out_and_the_chain_moves_on() {
    let _env = Env::new(Some(GPU), true);
    std::env::set_var("CLIPES_FAKE_PROBE_FAIL", "hang:int8_float16");
    std::env::set_var("CLIPES_PROBE_TIMEOUT_SECONDS", "1");
    let result = run("transcription.hardware.probe", json!({})).unwrap();
    assert_eq!(result["chosen"]["compute_type"], "float16");
    let diagnostic = run("transcription.hardware.diagnostic", json!({})).unwrap();
    assert_eq!(diagnostic["attempts"][0]["error"], "probe_timeout");
}

#[test]
fn probe_is_cancellable() {
    let _env = Env::new(Some(GPU), true);
    std::env::set_var("CLIPES_FAKE_PROBE_FAIL", "hang:int8_float16");
    let canceller = std::thread::spawn(|| {
        std::thread::sleep(Duration::from_millis(1500));
        run("components.cancel", json!({"id":"hardware-probe"})).unwrap();
    });
    let error = run("transcription.hardware.probe", json!({})).unwrap_err();
    canceller.join().unwrap();
    assert_eq!(error.code, "cancelled");
}

#[test]
fn without_nvidia_the_choice_is_cpu_and_the_warning_applies() {
    let _env = Env::new(None, true);
    let status = run("transcription.hardware.status", json!({})).unwrap();
    assert!(status["gpu"].is_null());
    assert_eq!(status["no_compatible_gpu"], true);
    assert_eq!(status["effective"]["model"], "whisper-small");
    assert_eq!(status["effective"]["device"], "cpu");
    let result = run("transcription.hardware.probe", json!({})).unwrap();
    assert_eq!(result["chosen"]["device"], "cpu");
    assert_eq!(result["verified"], true);
}

#[test]
fn probe_needs_the_turbo_model_on_a_gpu_and_never_downloads() {
    let _env = Env::new(Some(GPU), false);
    let error = run("transcription.hardware.probe", json!({})).unwrap_err();
    assert_eq!(error.code, "model_missing");
}

#[test]
fn manual_choice_replaces_the_automatic_one_and_can_be_reset() {
    let _env = Env::new(Some(GPU), true);
    run("transcription.hardware.probe", json!({})).unwrap();
    let status = run(
        "transcription.hardware.choose",
        json!({"model":"whisper-turbo","device":"cuda","compute_type":"float16"}),
    )
    .unwrap();
    assert_eq!(status["effective"]["compute_type"], "float16");
    assert_eq!(status["manual"], true);
    let status = run("transcription.hardware.choose", json!({"reset":true})).unwrap();
    assert_eq!(status["effective"]["compute_type"], "int8_float16");
    assert_eq!(status["manual"], false);
    let error = run(
        "transcription.hardware.choose",
        json!({"model":"whisper-turbo","device":"cuda","compute_type":"float32"}),
    )
    .unwrap_err();
    assert_eq!(error.code, "invalid_choice");
}

#[test]
fn turbo_on_cpu_is_manual_only_and_disabled_below_8_gib_total_ram() {
    let _env = Env::new(None, true);
    let turbo_cpu = json!({"model":"whisper-turbo","device":"cpu","compute_type":"int8"});
    std::env::set_var("CLIPES_FAKE_RAM", format!("{},{}", 4 * GIB, 3 * GIB));
    let error = run("transcription.hardware.choose", turbo_cpu.clone()).unwrap_err();
    assert_eq!(error.code, "ram_insufficient");
    let status = run("transcription.hardware.status", json!({})).unwrap();
    let option = status["options"]
        .as_array()
        .unwrap()
        .iter()
        .find(|o| o["model"] == "whisper-turbo" && o["device"] == "cpu")
        .unwrap();
    assert_eq!(option["enabled"], false);
    assert_eq!(option["reason"], "ram_insufficient");
    // O padrão em CPU continua o small, sem acrescentar modelo ao catálogo.
    assert_eq!(status["effective"]["model"], "whisper-small");
    let manifest = run("components.models.manifest", json!({})).unwrap();
    assert_eq!(
        manifest
            .as_array()
            .unwrap()
            .iter()
            .filter(|m| m["id"]
                .as_str()
                .is_some_and(|id| id.starts_with("whisper-")))
            .count(),
        2
    );
    std::env::set_var("CLIPES_FAKE_RAM", format!("{},{}", 16 * GIB, 12 * GIB));
    let status = run("transcription.hardware.choose", turbo_cpu).unwrap();
    assert_eq!(status["effective"]["model"], "whisper-turbo");
    assert_eq!(status["effective"]["device"], "cpu");
}

#[test]
fn turbo_on_cpu_warns_without_blocking_on_low_or_unknown_available_ram() {
    let env = Env::new(None, true);
    let source = env.import_source(120);
    let turbo_cpu = json!({"model":"whisper-turbo","device":"cpu","compute_type":"int8"});
    std::env::set_var("CLIPES_FAKE_RAM", format!("{},{}", 16 * GIB, 12 * GIB));
    run("transcription.hardware.choose", turbo_cpu).unwrap();
    let started = env.start(source).unwrap();
    assert_eq!(started["warnings"], json!([]));
    for (ram, warning) in [
        (format!("{},{}", 16 * GIB, 2 * GIB), "low_ram"),
        ("fail".to_string(), "ram_unknown"),
    ] {
        std::env::set_var("CLIPES_FAKE_RAM", ram);
        let started = env.start(source).unwrap();
        assert_eq!(started["warnings"], json!([warning]));
    }
}

#[test]
fn estimate_measures_a_sample_from_the_source_and_reuses_the_rate() {
    let env = Env::new(None, true);
    let source = env.import_source(3600);
    let first = env.estimate(source, false).unwrap();
    // 10 s de carregamento + 0,5 s por segundo de áudio × 3600 s.
    assert_eq!(first["estimate_s"], 1810.0);
    assert_eq!(first["low_s"], 1810.0 * 0.7);
    assert_eq!(first["high_s"], 1810.0 * 1.5);
    assert_eq!(first["sample_start_us"], 900_000_000i64);
    assert_eq!(first["sample_us"], 30_000_000i64);
    assert_eq!(first["cached"], false);
    assert_eq!(first["cpu"], true);
    assert_eq!(env.log().iter().filter(|l| l[1] == "audio").count(), 1);
    let second = env.estimate(source, false).unwrap();
    assert_eq!(second["cached"], true);
    assert_eq!(second["estimate_s"], 1810.0);
    assert_eq!(env.log().iter().filter(|l| l[1] == "audio").count(), 1);
    std::env::set_var("CLIPES_FAKE_PROBE_RATE", "2.0");
    let third = env.estimate(source, true).unwrap();
    assert_eq!(third["cached"], false);
    assert_eq!(third["estimate_s"], 10.0 + 2.0 * 3600.0);
    // A medição nunca grava na Transcrição.
    let status = run("transcription.status", json!({"source_id": source})).unwrap();
    assert!(status["transcript"].is_null());
}
