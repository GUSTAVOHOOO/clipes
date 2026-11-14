use crate::{CommandRegistration, CommandResult, CoreError, EventSink};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::{fs, path::PathBuf};

fn error(code: &str, message: &str) -> CoreError {
    CoreError {
        code: code.into(),
        message: message.into(),
    }
}
#[derive(Serialize, Deserialize)]
struct Settings {
    terms_accepted: bool,
    download_dir: PathBuf,
}
fn settings_path() -> Result<PathBuf, CoreError> {
    let root = std::env::var_os("CLIPES_DATA_DIR")
        .map(PathBuf::from)
        .or_else(|| dirs::data_local_dir().map(|p| p.join("Clipes")))
        .ok_or_else(|| error("settings", "Diretório de dados indisponível"))?;
    Ok(root.join("url-import.json"))
}
fn load() -> Result<Settings, CoreError> {
    match fs::read(settings_path()?) {
        Ok(data) => {
            serde_json::from_slice(&data).map_err(|_| error("settings", "Configurações inválidas"))
        }
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => {
            let base = dirs::video_dir()
                .filter(|p| p.is_dir())
                .or_else(dirs::download_dir)
                .or_else(|| dirs::home_dir().map(|p| p.join("Downloads")))
                .ok_or_else(|| error("settings", "Pasta de downloads indisponível"))?;
            Ok(Settings {
                terms_accepted: false,
                download_dir: base.join("Clipes"),
            })
        }
        Err(_) => Err(error("settings", "Não foi possível ler as configurações")),
    }
}
fn get(_: Value, _: &mut EventSink<'_>) -> CommandResult {
    Ok(json!(load()?))
}
fn set(v: Value, _: &mut EventSink<'_>) -> CommandResult {
    let mut settings: Settings =
        serde_json::from_value(v).map_err(|_| error("settings", "Configurações inválidas"))?;
    if !settings.download_dir.is_absolute() {
        return Err(error("settings", "Selecione uma pasta absoluta"));
    }
    settings.terms_accepted |= load()?.terms_accepted;
    let p = settings_path()?;
    fs::create_dir_all(p.parent().unwrap())
        .map_err(|_| error("settings", "Não foi possível salvar as configurações"))?;
    fs::write(p, serde_json::to_vec(&settings).unwrap())
        .map_err(|_| error("settings", "Não foi possível salvar as configurações"))?;
    Ok(json!(settings))
}
inventory::submit! { CommandRegistration { name: "sources.url.settings.get", execute: get } }
inventory::submit! { CommandRegistration { name: "sources.url.settings.set", execute: set } }

use crate::{projects, ProgressEvent};
use std::{
    collections::HashMap,
    ffi::OsString,
    io::{BufRead, BufReader, Read, Write},
    path::Path,
    sync::{
        atomic::{AtomicBool, Ordering},
        mpsc, Arc, Mutex, OnceLock,
    },
    thread,
    time::{Duration, SystemTime, UNIX_EPOCH},
};

fn jobs() -> &'static Mutex<HashMap<String, Arc<AtomicBool>>> {
    static JOBS: OnceLock<Mutex<HashMap<String, Arc<AtomicBool>>>> = OnceLock::new();
    JOBS.get_or_init(|| Mutex::new(HashMap::new()))
}
struct JobFlag(String);
impl Drop for JobFlag {
    fn drop(&mut self) {
        jobs().lock().unwrap().remove(&self.0);
    }
}
struct TempDir(PathBuf);
impl Drop for TempDir {
    fn drop(&mut self) {
        let _ = fs::remove_dir_all(&self.0);
    }
}
pub(crate) fn validate_url(v: &str) -> Result<(), CoreError> {
    match reqwest::Url::parse(v) {
        Ok(u) if matches!(u.scheme(), "http" | "https") && u.host_str().is_some() => Ok(()),
        _ => Err(error("invalid_url", "Informe uma URL HTTP ou HTTPS válida")),
    }
}
fn cancel(v: Value, _: &mut EventSink<'_>) -> CommandResult {
    if let Some(flag) = jobs().lock().unwrap().get(v["job"].as_str().unwrap_or("")) {
        flag.store(true, Ordering::Relaxed);
    }
    Ok(json!({}))
}
fn download(v: Value, events: &mut EventSink<'_>) -> CommandResult {
    let url = v["url"].as_str().unwrap_or("");
    validate_url(url)?;
    let _project = projects::start_job()?;
    let current = crate::dispatch("projects.current", json!({}), &mut |_| {})?;
    if current["path"].as_str() != v["project"].as_str() || v["project"].as_str().is_none() {
        return Err(error("invalid_project", "O Projeto não está aberto"));
    }
    let settings = load()?;
    if !settings.terms_accepted {
        return Err(error(
            "terms_required",
            "Confirme o aviso dos Termos antes de importar",
        ));
    }
    let job = v["job"]
        .as_str()
        .filter(|s| !s.is_empty())
        .ok_or_else(|| error("invalid_job", "Identificador de tarefa obrigatório"))?;
    let flag = Arc::new(AtomicBool::new(false));
    {
        let mut map = jobs().lock().unwrap();
        if map.contains_key(job) {
            return Err(error("job_running", "Download em andamento"));
        }
        map.insert(job.to_string(), flag.clone());
    }
    let _guard = JobFlag(job.to_string());
    let exe = crate::components::ytdlp_executable()?;
    let path = run_download(&exe, &settings.download_dir, url, job, &flag, events)?;
    Ok(json!({"path":path, "url":url}))
}
fn handle_line(line: &str, job: &str, events: &mut EventSink<'_>, filename: &mut Option<PathBuf>) {
    if let Some(p) = line.strip_prefix("clipes-progress:") {
        if let Ok(pct) = p.trim().trim_end_matches('%').parse::<f64>() {
            if pct.is_finite() {
                events(ProgressEvent {
                    project: None,
                    job: job.into(),
                    stage: "download".into(),
                    percentage: pct.clamp(0.0, 100.0) as u8,
                    message: "Baixando Fonte".into(),
                    error: None,
                });
            }
        }
    }
    if let Some(p) = line.strip_prefix("clipes-file:") {
        *filename = Some(PathBuf::from(p));
    }
}
fn run_download(
    exe: &Path,
    destination: &Path,
    url: &str,
    job: &str,
    flag: &AtomicBool,
    events: &mut EventSink<'_>,
) -> Result<PathBuf, CoreError> {
    let failure = || error("download_failed", "Não foi possível baixar a Fonte");
    fs::create_dir_all(destination)
        .map_err(|_| error("download_directory", "Pasta de downloads indisponível"))?;
    let temp = (0..100)
        .find_map(|n| {
            let nonce = SystemTime::now()
                .duration_since(UNIX_EPOCH)
                .ok()?
                .as_nanos();
            let p = destination.join(format!(".clipes-{}-{nonce}-{n}", std::process::id()));
            fs::create_dir(&p).ok().map(|_| TempDir(p))
        })
        .ok_or_else(|| error("download_directory", "Pasta de downloads indisponível"))?;
    let template = temp.0.join("%(id)s.%(ext)s");
    let mut args: Vec<OsString> = [
        "--ignore-config",
        "--no-playlist",
        "--match-filters",
        "live_status !=? is_live & live_status !=? is_upcoming & live_status !=? post_live",
        "--newline",
        "--progress",
        "--color",
        "never",
        "--no-simulate",
        "--restrict-filenames",
        "--progress-template",
        "download:clipes-progress:%(progress._percent_str)s",
        "--print",
        "after_move:clipes-file:%(filepath)s",
        "-o",
    ]
    .iter()
    .map(OsString::from)
    .chain([template.into_os_string()])
    .collect();
    if let Some(ffmpeg) = crate::components::configured_ffmpeg() {
        args.push("--ffmpeg-location".into());
        args.push(ffmpeg.into_os_string());
    }
    args.push("--".into());
    args.push(url.into());
    let (mut child, group) = crate::process::spawn_managed(exe, args).map_err(|_| failure())?;
    let stdout = child.stdout.take().ok_or_else(failure)?;
    let stderr = child.stderr.take().ok_or_else(failure)?;
    let (tx, rx) = mpsc::channel();
    let output_reader = thread::spawn(move || {
        for line in BufReader::new(stdout).lines().map_while(Result::ok) {
            if tx.send(line).is_err() {
                break;
            }
        }
    });
    let error_reader = thread::spawn(move || {
        let _ = std::io::copy(&mut BufReader::new(stderr), &mut std::io::sink());
    });
    let mut filename = None;
    let status = loop {
        while let Ok(line) = rx.try_recv() {
            handle_line(&line, job, events, &mut filename);
        }
        if flag.load(Ordering::Relaxed) {
            group.terminate();
            let _ = child.kill();
            let _ = child.wait();
            break Err(error("cancelled", "Download cancelado"));
        }
        match child.try_wait() {
            Ok(Some(status)) => break Ok(status),
            Ok(None) => thread::sleep(Duration::from_millis(50)),
            Err(_) => {
                group.terminate();
                let _ = child.kill();
                let _ = child.wait();
                break Err(failure());
            }
        }
    };
    drop(group);
    let _ = output_reader.join();
    let _ = error_reader.join();
    for line in rx.try_iter() {
        handle_line(&line, job, events, &mut filename);
    }
    if !status?.success() {
        return Err(failure());
    }
    if flag.load(Ordering::Relaxed) {
        return Err(error("cancelled", "Download cancelado"));
    }
    let file = filename.ok_or_else(failure)?;
    let canonical_dir = temp.0.canonicalize().map_err(|_| failure())?;
    let canonical = file.canonicalize().map_err(|_| failure())?;
    if canonical.parent() != Some(canonical_dir.as_path()) || !canonical.is_file() {
        return Err(failure());
    }
    let name = file
        .file_name()
        .and_then(|s| s.to_str())
        .ok_or_else(failure)?;
    if !name
        .bytes()
        .all(|b| b.is_ascii_alphanumeric() || b"-_.".contains(&b))
        || name.starts_with('.')
    {
        return Err(failure());
    }
    let stem = file
        .file_stem()
        .and_then(|s| s.to_str())
        .ok_or_else(failure)?;
    let ext = file
        .extension()
        .and_then(|s| s.to_str())
        .ok_or_else(failure)?;
    for suffix in 0..10000 {
        let target = destination.join(if suffix == 0 {
            name.to_string()
        } else {
            format!("{stem}-{suffix}.{ext}")
        });
        match fs::hard_link(&canonical, &target) {
            Ok(()) => {
                if flag.load(Ordering::Relaxed) {
                    let _ = fs::remove_file(&target);
                    return Err(error("cancelled", "Download cancelado"));
                }
                return Ok(target);
            }
            Err(e) if e.kind() == std::io::ErrorKind::AlreadyExists => continue,
            Err(_) => {
                let mut target_file = match fs::OpenOptions::new()
                    .write(true)
                    .create_new(true)
                    .open(&target)
                {
                    Ok(file) => file,
                    Err(e) if e.kind() == std::io::ErrorKind::AlreadyExists => continue,
                    Err(_) => {
                        return Err(error(
                            "download_directory",
                            "Pasta de downloads indisponível",
                        ))
                    }
                };
                let copied = (|| {
                    let mut source = fs::File::open(&canonical).map_err(|_| failure())?;
                    let mut block = [0; 65536];
                    loop {
                        if flag.load(Ordering::Relaxed) {
                            return Err(error("cancelled", "Download cancelado"));
                        }
                        let n = source.read(&mut block).map_err(|_| failure())?;
                        if n == 0 {
                            break;
                        }
                        target_file.write_all(&block[..n]).map_err(|_| failure())?;
                    }
                    target_file.flush().map_err(|_| failure())?;
                    Ok(())
                })();
                drop(target_file);
                if let Err(e) = copied {
                    let _ = fs::remove_file(&target);
                    return Err(e);
                }
                if flag.load(Ordering::Relaxed) {
                    let _ = fs::remove_file(&target);
                    return Err(error("cancelled", "Download cancelado"));
                }
                return Ok(target);
            }
        }
    }
    Err(failure())
}
inventory::submit! { CommandRegistration { name: "sources.url.download", execute: download } }
inventory::submit! { CommandRegistration { name: "sources.url.cancel", execute: cancel } }

#[cfg(test)]
mod download_tests {
    use super::*;
    use std::process::Command;
    #[test]
    fn fake_downloader_reports_progress_cleans_failures_and_cancellation() {
        let root = std::env::temp_dir().join(format!(
            "clipes-fake-{}-{}",
            std::process::id(),
            SystemTime::now()
                .duration_since(UNIX_EPOCH)
                .unwrap()
                .as_nanos()
        ));
        fs::create_dir_all(&root).unwrap();
        let fake = root.join(if cfg!(windows) { "fake.exe" } else { "fake" });
        let rustc = PathBuf::from(env!("CARGO")).with_file_name(if cfg!(windows) {
            "rustc.exe"
        } else {
            "rustc"
        });
        assert!(Command::new(rustc)
            .arg(Path::new(env!("CARGO_MANIFEST_DIR")).join("tests/fixtures/fake_ytdlp.rs"))
            .arg("-o")
            .arg(&fake)
            .status()
            .unwrap()
            .success());
        let output = root.join("output");
        let flag = AtomicBool::new(false);
        let mut seen = Vec::new();
        let result = run_download(
            &fake,
            &output,
            "https://example.com/success",
            "job",
            &flag,
            &mut |e| seen.push(e.percentage),
        )
        .unwrap();
        assert_eq!(result.file_name().unwrap(), "video123.mp4");
        assert_eq!(fs::read(&result).unwrap(), b"media");
        assert!(seen.contains(&42));
        let second = run_download(
            &fake,
            &output,
            "https://example.com/success",
            "job",
            &flag,
            &mut |_| {},
        )
        .unwrap();
        assert_eq!(second.file_name().unwrap(), "video123-1.mp4");
        let err = run_download(
            &fake,
            &output,
            "https://example.com/fail",
            "job",
            &flag,
            &mut |_| {},
        )
        .unwrap_err();
        assert_eq!(err.code, "download_failed");
        assert!(!err.message.contains("secret"));
        let err = run_download(
            &fake,
            &output,
            "https://example.com/hang",
            "job",
            &flag,
            &mut |_| flag.store(true, Ordering::Relaxed),
        )
        .unwrap_err();
        assert_eq!(err.code, "cancelled");
        flag.store(false, Ordering::Relaxed);
        let err = run_download(
            &fake,
            &output,
            "https://example.com/hang-child",
            "job",
            &flag,
            &mut |_| flag.store(true, Ordering::Relaxed),
        )
        .unwrap_err();
        assert_eq!(err.code, "cancelled");
        assert!(!output.join("child-survived").exists());
        assert_eq!(fs::read_dir(&output).unwrap().count(), 2);
        fs::remove_dir_all(root).unwrap();
    }
}
