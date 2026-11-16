use crate::{CommandRegistration, CommandResult, CoreError, EventSink};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::{fs, path::PathBuf};

fn error(code: &str, message: &str) -> CoreError {
    CoreError {
        code: code.into(),
        message: message.into(),
        usage: None,
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
    collections::{HashMap, VecDeque},
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
    precheck_age(&exe, url, &flag)?;
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
// Only fixed identifiers leave this module; stderr can contain arbitrary private data.
fn stderr_pattern(line: &[u8]) -> &'static str {
    let text = String::from_utf8_lossy(line).to_lowercase();
    // ERROR: Sign in to confirm your age
    if text.contains("sign in to confirm your age") {
        "yt_dlp.sign_in_age"
    }
    // ERROR: Sorry, this content is age-restricted
    else if text.contains("age-restricted") || text.contains("age restricted") {
        "yt_dlp.age_restricted"
    }
    // ERROR: Sign in to confirm you're not a bot
    else if text.contains("sign in") || text.contains("login required") {
        "yt_dlp.login_required"
    }
    // WARNING: No supported JavaScript runtime could be found
    else if text.contains("no supported javascript runtime could be found")
        || text.contains("n challenge solving failed")
    {
        "yt_dlp.no_js_runtime"
    }
    // WARNING: YouTube may have enabled the SABR-only streaming experiment
    else if text.contains("sabr") {
        "yt_dlp.sabr_unavailable"
    }
    // ERROR: HTTP Error 403: Forbidden
    else if text.contains("http error 403") {
        "yt_dlp.http_403"
    } else {
        "yt_dlp.unrecognized"
    }
}

fn read_stderr(mut input: impl Read) -> (Vec<&'static str>, u8) {
    let mut lines = VecDeque::new();
    let mut line = Vec::with_capacity(300);
    let mut flags = 0u8;
    let mut buffer = [0u8; 8192];
    let mut finish = |line: &mut Vec<u8>| {
        let pattern = stderr_pattern(line);
        flags |= match pattern {
            "yt_dlp.sign_in_age" | "yt_dlp.age_restricted" => 1,
            "yt_dlp.login_required" => 2,
            "yt_dlp.no_js_runtime" => 4,
            "yt_dlp.sabr_unavailable" => 8,
            _ => 0,
        };
        if lines.len() == 50 {
            lines.pop_front();
        }
        lines.push_back(pattern);
        line.clear();
    };
    loop {
        let count = match input.read(&mut buffer) {
            Ok(0) | Err(_) => break,
            Ok(n) => n,
        };
        for &byte in &buffer[..count] {
            if byte == b'\n' {
                finish(&mut line);
            } else if line.len() < 300 {
                line.push(byte);
            }
        }
    }
    if !line.is_empty() {
        finish(&mut line);
    }
    (lines.into_iter().collect(), flags)
}

fn classified_error(flags: u8) -> CoreError {
    if flags & 1 != 0 {
        error(
            "age_restricted",
            "Este vídeo tem restrição de idade. Baixe por conta própria e importe o arquivo local.",
        )
    } else if flags & 2 != 0 {
        error("login_required", "Este vídeo exige login para ser baixado.")
    } else if flags & 4 != 0 {
        error(
            "js_runtime_missing",
            "Um ambiente JavaScript é necessário para baixar este vídeo.",
        )
    } else if flags & 8 != 0 {
        error(
            "sabr_unavailable",
            "Os formatos SABR deste vídeo estão indisponíveis.",
        )
    } else {
        error("download_failed", "Não foi possível baixar a Fonte")
    }
}

/// Detecção prévia (#201): só os campos que decidem o bloqueio.
#[derive(Debug, PartialEq)]
struct Probe {
    age_limit: Option<u32>,
    availability: String,
}
// Saída inesperada nunca bloqueia: devolve None e o download segue como antes.
fn parse_probe(stdout: &str) -> Option<Probe> {
    let line = stdout.lines().find(|l| !l.trim().is_empty())?;
    let fields: Vec<&str> = line.trim().split('|').collect();
    if fields.len() != 5 || fields[0].is_empty() {
        return None;
    }
    let age_limit = match fields[1] {
        "NA" | "" => None,
        n => Some(n.parse::<u32>().ok()?),
    };
    Some(Probe {
        age_limit,
        availability: fields[2].to_string(),
    })
}
fn is_age_restricted(probe: &Probe) -> bool {
    probe.age_limit.is_some_and(|a| a >= 18) && probe.availability == "needs_auth"
}
fn probe_args(url: &str) -> Vec<OsString> {
    [
        "--ignore-config",
        "--no-playlist",
        "--skip-download",
        "--ignore-no-formats-error",
        "--color",
        "never",
        "--print",
        "%(id)s|%(age_limit)s|%(availability)s|%(live_status)s|%(duration)s",
        "--",
    ]
    .iter()
    .map(OsString::from)
    .chain([OsString::from(url)])
    .collect()
}
const PROBE_TIMEOUT: Duration = Duration::from_secs(60);
fn probe(exe: &Path, url: &str, flag: &AtomicBool) -> Result<Option<Probe>, CoreError> {
    // Qualquer falha aqui vira None: a detecção nunca bloqueia o download.
    let Ok((mut child, group)) = crate::process::spawn_managed(exe, probe_args(url)) else {
        return Ok(None);
    };
    let stdout = child.stdout.take();
    let stderr = child.stderr.take();
    let out = thread::spawn(move || {
        let mut text = String::new();
        if let Some(s) = stdout {
            let _ = s.take(4096).read_to_string(&mut text);
        }
        text
    });
    let err = thread::spawn(move || {
        if let Some(mut s) = stderr {
            let _ = std::io::copy(&mut s, &mut std::io::sink());
        }
    });
    let started = std::time::Instant::now();
    let status = loop {
        if flag.load(Ordering::Relaxed) {
            group.terminate();
            let _ = child.kill();
            let _ = child.wait();
            return Err(error("cancelled", "Download cancelado"));
        }
        match child.try_wait() {
            Ok(Some(status)) => break Some(status),
            Ok(None) if started.elapsed() < PROBE_TIMEOUT => {
                thread::sleep(Duration::from_millis(50))
            }
            _ => {
                group.terminate();
                let _ = child.kill();
                let _ = child.wait();
                break None;
            }
        }
    };
    drop(group);
    let text = out.join().unwrap_or_default();
    let _ = err.join();
    Ok(status
        .filter(|s| s.success())
        .and_then(|_| parse_probe(&text)))
}
fn precheck_age(exe: &Path, url: &str, flag: &AtomicBool) -> Result<(), CoreError> {
    match probe(exe, url, flag)? {
        Some(p) if is_age_restricted(&p) => {
            let result = classified_error(1);
            crate::diagnostic::record_ytdlp(
                &result.code,
                &["yt_dlp.age_limit_needs_auth"],
                None,
                &crate::components::ytdlp_version(exe),
            );
            Err(result)
        }
        _ => Ok(()),
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
    let error_reader = thread::spawn(move || read_stderr(stderr));
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
    let (patterns, flags) = error_reader.join().unwrap_or_default();
    for line in rx.try_iter() {
        handle_line(&line, job, events, &mut filename);
    }
    let status = status?;
    if !status.success() {
        let result = classified_error(flags);
        crate::diagnostic::record_ytdlp(
            &result.code,
            &patterns,
            status.code(),
            &crate::components::ytdlp_version(exe),
        );
        return Err(result);
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
    fn probe_parsing_blocks_only_age_limit_with_needs_auth() {
        let p = |s| parse_probe(s).unwrap();
        assert!(is_age_restricted(&p("abc|18|needs_auth|not_live|120")));
        assert!(!is_age_restricted(&p("abc|0|public|not_live|120")));
        assert!(!is_age_restricted(&p("abc|18|public|not_live|120")));
        assert!(!is_age_restricted(&p("abc|NA|needs_auth|NA|NA")));
        assert!(parse_probe("").is_none());
        assert!(parse_probe("lixo sem campos").is_none());
        assert!(parse_probe("a|x|needs_auth|b|c").is_none());
        assert!(parse_probe("a|18|needs_auth|b").is_none());
    }
    #[test]
    fn stderr_is_bounded_and_classification_survives_history_truncation() {
        let stderr = format!(
            "ERROR: Sign in to confirm your age\n{}",
            "unknown secret https://googlevideo.com/?sig=secret\n".repeat(70)
        );
        let (patterns, flags) = read_stderr(stderr.as_bytes());
        assert_eq!(patterns.len(), 50);
        assert!(patterns.iter().all(|p| *p == "yt_dlp.unrecognized"));
        assert_eq!(classified_error(flags).code, "age_restricted");
        assert_eq!(classified_error(0).code, "download_failed");
        let long = format!(
            "{}\nERROR: HTTP Error 403: Forbidden",
            "x".repeat(1_000_000)
        );
        assert_eq!(
            read_stderr(long.as_bytes()).0,
            vec!["yt_dlp.unrecognized", "yt_dlp.http_403"]
        );
    }
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
