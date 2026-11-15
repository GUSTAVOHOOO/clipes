//! Instalação e status do worker de ML (ADR-0004), como Componente global:
//! o `uv` (Componente fixado) instala um Python standalone e as dependências
//! travadas do worker num ambiente isolado dentro do diretório de dados.
//! O Python do sistema nunca é usado.

use super::*;
use crate::worker::WorkerClient;
use std::{
    ffi::OsString,
    process::{Command, Stdio},
    time::Duration,
};

const PYTHON: &str = "3.12";
const JOB: &str = "worker";

/// Código do worker, travas e testes de contrato ficam em `worker/`; o núcleo
/// leva uma cópia para instalar sem depender de arquivos ao lado do executável.
const FILES: &[(&str, &[u8])] = &[
    (
        "pyproject.toml",
        include_bytes!("../../../worker/pyproject.toml"),
    ),
    ("uv.lock", include_bytes!("../../../worker/uv.lock")),
    (
        "src/clipes_worker/__init__.py",
        include_bytes!("../../../worker/src/clipes_worker/__init__.py"),
    ),
    (
        "src/clipes_worker/__main__.py",
        include_bytes!("../../../worker/src/clipes_worker/__main__.py"),
    ),
    (
        "src/clipes_worker/hardware_probe.py",
        include_bytes!("../../../worker/src/clipes_worker/hardware_probe.py"),
    ),
    (
        "src/clipes_worker/data/probe-pt.wav",
        include_bytes!("../../../worker/src/clipes_worker/data/probe-pt.wav"),
    ),
    (
        "src/clipes_worker/data/probe-en.wav",
        include_bytes!("../../../worker/src/clipes_worker/data/probe-en.wav"),
    ),
    (
        "src/clipes_worker/models.py",
        include_bytes!("../../../worker/src/clipes_worker/models.py"),
    ),
    (
        "src/clipes_worker/protocol.py",
        include_bytes!("../../../worker/src/clipes_worker/protocol.py"),
    ),
    (
        "src/clipes_worker/server.py",
        include_bytes!("../../../worker/src/clipes_worker/server.py"),
    ),
    (
        "src/clipes_worker/tasks.py",
        include_bytes!("../../../worker/src/clipes_worker/tasks.py"),
    ),
    (
        "src/clipes_worker/reframe.py",
        include_bytes!("../../../worker/src/clipes_worker/reframe.py"),
    ),
    (
        "src/clipes_worker/reframe_camera.py",
        include_bytes!("../../../worker/src/clipes_worker/reframe_camera.py"),
    ),
    (
        "src/clipes_worker/transcribe.py",
        include_bytes!("../../../worker/src/clipes_worker/transcribe.py"),
    ),
];

fn worker_dir(settings: &Settings) -> PathBuf {
    settings.data_dir.join("worker")
}
fn venv_python(worker: &Path) -> PathBuf {
    if cfg!(windows) {
        worker.join("venv").join("Scripts").join("python.exe")
    } else {
        worker.join("venv").join("bin").join("python")
    }
}
fn uv_path(settings: &Settings) -> PathBuf {
    settings
        .data_dir
        .join("components")
        .join(if cfg!(windows) { "uv.exe" } else { "uv" })
}
fn state_path(worker: &Path) -> PathBuf {
    worker.join("worker.state.json")
}
fn lock_sha256() -> String {
    let lock = FILES.iter().find(|(name, _)| *name == "uv.lock").unwrap().1;
    // O lock é fixado com LF (.gitattributes); normaliza para o hash não depender do checkout.
    let normalized: Vec<u8> = lock.iter().copied().filter(|b| *b != b'\r').collect();
    format!("{:x}", Sha256::digest(normalized))
}
/// Hash de todos os arquivos embutidos (código do worker incluso): um worker instalado por uma
/// versão anterior do app, com outro `tasks.py`, aparece como desatualizado mesmo com o mesmo lock.
fn files_sha256() -> String {
    let mut hash = Sha256::new();
    for (name, bytes) in FILES {
        hash.update(name.as_bytes());
        let normalized: Vec<u8> = bytes.iter().copied().filter(|b| *b != b'\r').collect();
        hash.update(Sha256::digest(normalized));
    }
    format!("{:x}", hash.finalize())
}
fn manifest_uv_version() -> Option<&'static str> {
    manifest()
        .into_iter()
        .find(|c| c.id == "uv")
        .map(|c| c.version)
}

/// Versão do `uv` instalado, se for exatamente a fixada no manifesto.
pub(super) fn uv_version_for(settings: &Settings) -> Option<String> {
    let exe = uv_path(settings);
    if !exe.is_file() {
        return None;
    }
    let output = crate::process::spawn(&exe, ["--version"], None)
        .and_then(|child| child.wait_with_output())
        .ok()?;
    let text = String::from_utf8_lossy(&output.stdout);
    let version = text
        .strip_prefix("uv ")?
        .split_whitespace()
        .next()?
        .to_owned();
    (output.status.success() && Some(version.as_str()) == manifest_uv_version()).then_some(version)
}

/// O worker está instalado (ambiente criado e estado gravado)?
pub(super) fn installed(settings: &Settings) -> bool {
    let worker = worker_dir(settings);
    state_path(&worker).is_file() && venv_python(&worker).is_file()
}

/// O worker foi instalado com as bibliotecas CUDA (GPU NVIDIA na instalação)?
pub(super) fn cuda_installed(settings: &Settings) -> bool {
    fs::read(state_path(&worker_dir(settings)))
        .ok()
        .and_then(|bytes| serde_json::from_slice::<Value>(&bytes).ok())
        .is_some_and(|state| state["cuda"] == true)
}

/// Há GPU NVIDIA? Sem ela, o worker usa só a variante CPU (sem libs CUDA).
fn has_nvidia_gpu() -> bool {
    crate::process::spawn(
        std::env::var_os("CLIPES_NVIDIA_SMI").unwrap_or_else(|| "nvidia-smi".into()),
        ["-L"],
        None,
    )
    .and_then(|child| child.wait_with_output())
    .is_ok_and(|o| o.status.success() && String::from_utf8_lossy(&o.stdout).contains("GPU "))
}

/// Variáveis que mantêm o `uv` no ambiente do Clipes e fora do Python do sistema.
fn uv_environment(worker: &Path) -> Vec<(&'static str, OsString)> {
    vec![
        ("UV_PYTHON_PREFERENCE", "only-managed".into()),
        ("UV_PYTHON_DOWNLOADS", "automatic".into()),
        ("UV_PYTHON_INSTALL_DIR", worker.join("python").into()),
        ("UV_PROJECT_ENVIRONMENT", worker.join("venv").into()),
        ("UV_CACHE_DIR", worker.join("uv-cache").into()),
        ("UV_PYTHON_INSTALL_BIN", "0".into()),
        ("UV_PYTHON_INSTALL_REGISTRY", "0".into()),
        ("UV_NO_CONFIG", "1".into()),
    ]
}
/// Variáveis herdadas do usuário que apontariam o `uv` para outro Python.
const UV_REMOVED: &[&str] = &[
    "UV_PYTHON",
    "UV_SYSTEM_PYTHON",
    "UV_NO_MANAGED_PYTHON",
    "UV_PYTHON_INSTALL_MIRROR",
    "VIRTUAL_ENV",
    "CONDA_PREFIX",
    "PYTHONHOME",
    "PYTHONPATH",
];

fn python_install_args() -> Vec<OsString> {
    [
        "python",
        "install",
        PYTHON,
        "--python-preference",
        "only-managed",
        "--no-bin",
        "--no-registry",
        "--no-progress",
        "--color",
        "never",
    ]
    .map(Into::into)
    .to_vec()
}
fn sync_args(project: &Path, cuda: bool) -> Vec<OsString> {
    let mut args: Vec<OsString> = [
        "sync",
        "--frozen",
        "--no-dev",
        "--python",
        PYTHON,
        "--python-preference",
        "only-managed",
        "--no-progress",
        "--color",
        "never",
        "--project",
    ]
    .map(Into::into)
    .to_vec();
    args.push(project.into());
    args.extend(["--extra", if cuda { "cuda" } else { "cpu" }].map(OsString::from));
    // faster-whisper requires the CPU distribution by name. Both distributions
    // own `onnxruntime/`; installing both makes the selected provider depend on
    // extraction order. Keep it resolved in the lock, install only the GPU wheel.
    if cuda {
        args.extend(["--no-install-package", "onnxruntime"].map(OsString::from));
    }
    args
}

fn install_failed() -> CoreError {
    error(
        "worker_install",
        "Não foi possível instalar o worker de ML.",
    )
}
fn cancelled() -> CoreError {
    error("cancelled", "Instalação cancelada.")
}

/// Roda o `uv`, sem shell, consultando o cancelamento; ao cancelar, encerra o
/// processo (e filhos) antes de voltar.
fn run_uv(
    uv: &Path,
    args: &[OsString],
    worker: &Path,
    cancel: &AtomicBool,
) -> Result<(), CoreError> {
    let (mut child, group) = crate::process::spawn_managed_with(uv, args, |c| {
        c.stdin(Stdio::null());
        for (key, value) in uv_environment(worker) {
            c.env(key, value);
        }
        for key in UV_REMOVED {
            c.env_remove(key);
        }
    })
    .map_err(|_| install_failed())?;
    let drains: Vec<_> = [
        child
            .stdout
            .take()
            .map(|s| Box::new(s) as Box<dyn Read + Send>),
        child
            .stderr
            .take()
            .map(|s| Box::new(s) as Box<dyn Read + Send>),
    ]
    .into_iter()
    .flatten()
    .map(|mut stream| std::thread::spawn(move || drop(io::copy(&mut stream, &mut io::sink()))))
    .collect();
    let result = loop {
        if cancel.load(Ordering::SeqCst) {
            group.terminate();
            let _ = child.wait();
            break Err(cancelled());
        }
        match child.try_wait() {
            Ok(Some(status)) if status.success() => break Ok(()),
            Ok(Some(_)) | Err(_) => break Err(install_failed()),
            Ok(None) => std::thread::sleep(Duration::from_millis(50)),
        }
    };
    for drain in drains {
        let _ = drain.join();
    }
    result
}

fn emit(events: &mut EventSink<'_>, percentage: u8, message: &str) {
    events(ProgressEvent {
        project: None,
        job: JOB.into(),
        stage: "worker".into(),
        percentage,
        message: message.into(),
        error: None,
    });
}

fn remove_environment(worker: &Path) {
    for part in ["venv", "python"] {
        let _ = fs::remove_dir_all(worker.join(part));
    }
    let _ = fs::remove_file(state_path(worker));
}

fn write_project(worker: &Path) -> Result<PathBuf, CoreError> {
    let project = worker.join("project");
    let _ = fs::remove_dir_all(&project);
    for (name, bytes) in FILES {
        let target = project.join(name);
        fs::create_dir_all(target.parent().unwrap()).map_err(|_| install_failed())?;
        fs::write(target, bytes).map_err(|_| install_failed())?;
    }
    Ok(project)
}

/// Inicia o worker instalado (handshake feito). Usado pelo status e pelas
/// etapas de ML que o núcleo orquestra.
pub(crate) fn start_worker() -> Result<WorkerClient, CoreError> {
    let settings = load_settings()?;
    let worker = worker_dir(&settings);
    let python = venv_python(&worker);
    if !state_path(&worker).is_file() || !python.is_file() {
        return Err(error(
            "worker_missing",
            "O worker de ML não está instalado; instale-o em Componentes.",
        ));
    }
    let src = worker.join("project").join("src");
    let venv = worker.join("venv");
    WorkerClient::start(python, ["-m", "clipes_worker"], |c: &mut Command| {
        for key in ["PYTHONHOME", "VIRTUAL_ENV", "CONDA_PREFIX"] {
            c.env_remove(key);
        }
        c.env("PYTHONPATH", &src)
            .env("PYTHONNOUSERSITE", "1")
            .env("PYTHONUTF8", "1")
            .env("PYTHONUNBUFFERED", "1");
        // No Windows, as DLLs de CUDA ficam dentro do ambiente (docs/agents/impedimentos.md).
        let nvidia: Vec<PathBuf> = ["cublas", "cudnn"]
            .iter()
            .map(|lib| venv.join("Lib/site-packages/nvidia").join(lib).join("bin"))
            .filter(|p| p.is_dir())
            .collect();
        if !nvidia.is_empty() {
            let mut paths = nvidia;
            paths.extend(std::env::split_paths(
                &std::env::var_os("PATH").unwrap_or_default(),
            ));
            if let Ok(joined) = std::env::join_paths(paths) {
                c.env("PATH", joined);
            }
        }
    })
}

fn install_worker(v: Value, events: &mut EventSink<'_>) -> CommandResult {
    if v["confirmed"] != true {
        return Err(error(
            "confirmation_required",
            "Confirme a instalação antes de iniciar",
        ));
    }
    let flag = Arc::new(AtomicBool::new(false));
    {
        let mut map = jobs().lock().unwrap();
        if map.contains_key(JOB) {
            return Err(error("already_downloading", "Instalação em andamento"));
        }
        map.insert(JOB.into(), flag.clone());
    }
    let result = install_inner(&flag, events);
    if let Err(e) = &result {
        if let Ok(settings) = load_settings() {
            remove_environment(&worker_dir(&settings));
        }
        if e.code != "cancelled" {
            crate::diagnostic::record(crate::diagnostic::DiagnosticEvent::ComponentFailure);
        }
    }
    jobs().lock().unwrap().remove(JOB);
    result
}

fn install_inner(cancel: &AtomicBool, events: &mut EventSink<'_>) -> CommandResult {
    let settings = load_settings()?;
    let worker = worker_dir(&settings);
    fs::create_dir_all(&worker).map_err(|_| install_failed())?;
    // Enquanto instala, o worker conta como não instalado.
    remove_environment(&worker);
    let uv = uv_path(&settings);
    if uv_version_for(&settings).is_none() {
        let item = manifest()
            .into_iter()
            .find(|c| c.id == "uv")
            .ok_or_else(|| error("unknown_component", "Componente indisponível"))?;
        // O download do uv ocupa o primeiro quarto da barra.
        download_item(&item, cancel, JOB, &mut |e: ProgressEvent| {
            if e.stage == "download" {
                events(ProgressEvent {
                    percentage: e.percentage / 4,
                    ..e
                });
            }
        })?;
    }
    let project = write_project(&worker)?;
    let cuda = has_nvidia_gpu();
    emit(events, 25, "Instalando o Python gerenciado");
    run_uv(&uv, &python_install_args(), &worker, cancel)?;
    emit(
        events,
        45,
        if cuda {
            "Instalando as dependências do worker (CUDA)"
        } else {
            "Instalando as dependências do worker (CPU)"
        },
    );
    run_uv(&uv, &sync_args(&project, cuda), &worker, cancel)?;
    emit(events, 95, "Verificando o worker");
    if cancel.load(Ordering::SeqCst) {
        return Err(cancelled());
    }
    fs::write(
        state_path(&worker),
        serde_json::to_vec_pretty(&json!({
            "uv": manifest_uv_version(),
            "cuda": cuda,
            "lock_sha256": lock_sha256(),
            "files_sha256": files_sha256(),
        }))
        .unwrap(),
    )
    .map_err(|_| install_failed())?;
    let client = start_worker().map_err(|_| {
        error(
            "worker_verify",
            "O worker foi instalado, mas não respondeu à verificação.",
        )
    })?;
    let handshake = client.handshake().clone();
    client.shutdown();
    events(ProgressEvent {
        project: None,
        job: JOB.into(),
        stage: "complete".into(),
        percentage: 100,
        message: "Worker instalado".into(),
        error: None,
    });
    Ok(json!({"handshake": handshake, "cuda": cuda}))
}

fn status(_: Value, _: &mut EventSink<'_>) -> CommandResult {
    let settings = load_settings()?;
    let worker = worker_dir(&settings);
    let state: Option<Value> = fs::read(state_path(&worker))
        .ok()
        .and_then(|bytes| serde_json::from_slice(&bytes).ok());
    let Some(state) = state.filter(|_| venv_python(&worker).is_file()) else {
        return Ok(json!({"installed": false, "gpu": has_nvidia_gpu()}));
    };
    let outdated = state["lock_sha256"] != json!(lock_sha256())
        || state["files_sha256"] != json!(files_sha256());
    Ok(match start_worker() {
        Ok(client) => {
            let handshake = client.handshake().clone();
            client.shutdown();
            json!({"installed": true, "outdated": outdated, "cuda": state["cuda"], "gpu": has_nvidia_gpu(), "uv": state["uv"], "handshake": handshake})
        }
        Err(e) => {
            json!({"installed": true, "outdated": outdated, "cuda": state["cuda"], "gpu": has_nvidia_gpu(), "uv": state["uv"], "error": {"code": e.code, "message": e.message}})
        }
    })
}

inventory::submit! { CommandRegistration { name: "components.worker.install", execute: install_worker } }
inventory::submit! { CommandRegistration { name: "components.worker.status", execute: status } }

#[cfg(test)]
mod tests {
    use super::*;

    fn lossy(args: Vec<OsString>) -> Vec<String> {
        args.into_iter()
            .map(|a| a.to_string_lossy().into_owned())
            .collect()
    }

    #[test]
    fn uv_never_falls_back_to_the_system_python() {
        let env = uv_environment(Path::new("/dados/worker"));
        let get = |key: &str| env.iter().find(|(k, _)| *k == key).map(|(_, v)| v.clone());
        assert_eq!(get("UV_PYTHON_PREFERENCE"), Some("only-managed".into()));
        assert_eq!(get("UV_NO_CONFIG"), Some("1".into()));
        assert_eq!(get("UV_PYTHON_INSTALL_BIN"), Some("0".into()));
        assert_eq!(get("UV_PYTHON_INSTALL_REGISTRY"), Some("0".into()));
        for key in [
            "UV_PYTHON_INSTALL_DIR",
            "UV_PROJECT_ENVIRONMENT",
            "UV_CACHE_DIR",
        ] {
            assert!(
                Path::new(&get(key).unwrap()).starts_with("/dados/worker"),
                "{key}"
            );
        }
        for key in [
            "UV_PYTHON",
            "UV_SYSTEM_PYTHON",
            "UV_NO_MANAGED_PYTHON",
            "VIRTUAL_ENV",
        ] {
            assert!(
                UV_REMOVED.contains(&key),
                "{key} deve ser removida do ambiente do uv"
            );
        }
        for args in [python_install_args(), sync_args(Path::new("/p"), false)] {
            let args = lossy(args);
            assert!(args
                .windows(2)
                .any(|w| w == ["--python-preference", "only-managed"]));
            assert!(!args.contains(&"--system".to_string()));
        }
    }

    #[test]
    fn cuda_extra_only_with_an_nvidia_gpu() {
        let cpu = lossy(sync_args(Path::new("/p"), false));
        let gpu = lossy(sync_args(Path::new("/p"), true));
        assert!(!cpu.contains(&"cuda".to_string()));
        assert!(gpu.windows(2).any(|w| w == ["--extra", "cuda"]));
        assert!(
            cpu.contains(&"--frozen".to_string()),
            "versões travadas pelo lockfile"
        );
        assert!(cpu.windows(2).any(|w| w == ["--extra", "cpu"]));
        assert!(gpu
            .windows(2)
            .any(|w| w == ["--no-install-package", "onnxruntime"]));
        assert_eq!(&gpu[..gpu.len() - 4], &cpu[..cpu.len() - 2]);
    }

    #[test]
    fn embedded_files_cover_every_worker_module() {
        let src = Path::new(env!("CARGO_MANIFEST_DIR")).join("../worker/src/clipes_worker");
        for entry in fs::read_dir(src).unwrap() {
            let name = entry.unwrap().file_name().to_string_lossy().into_owned();
            if name.ends_with(".py") {
                let key = format!("src/clipes_worker/{name}");
                assert!(
                    FILES.iter().any(|(n, _)| *n == key),
                    "{key} ausente de FILES"
                );
            }
        }
    }

    #[test]
    fn embedded_files_cover_the_probe_clip() {
        let data = Path::new(env!("CARGO_MANIFEST_DIR")).join("../worker/src/clipes_worker/data");
        for entry in fs::read_dir(data).unwrap() {
            let name = entry.unwrap().file_name().to_string_lossy().into_owned();
            let key = format!("src/clipes_worker/data/{name}");
            let embedded = FILES.iter().find(|(n, _)| *n == key);
            assert!(embedded.is_some(), "{key} ausente de FILES");
            assert_eq!(&embedded.unwrap().1[..4], b"RIFF", "{key} corrompido");
        }
    }

    #[test]
    fn project_is_written_under_the_worker_directory_only() {
        let root = tempfile::tempdir().unwrap();
        let project = write_project(root.path()).unwrap();
        assert!(project.starts_with(root.path()));
        assert!(project.join("uv.lock").is_file());
        assert!(project.join("src/clipes_worker/server.py").is_file());
    }
}
