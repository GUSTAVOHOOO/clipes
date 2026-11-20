pub(crate) mod catalog;
pub(crate) mod hardware;
pub(crate) mod models;
mod update;
pub(crate) mod worker;
use crate::{CommandRegistration, CommandResult, CoreError, EventSink, ProgressEvent};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use sha2::{Digest, Sha256};
use std::{
    collections::HashMap,
    fs::{self, File, OpenOptions},
    io::{self, Read, Write},
    path::{Path, PathBuf},
    sync::{
        atomic::{AtomicBool, Ordering},
        Arc, Mutex, OnceLock,
    },
};

#[derive(Clone, Serialize)]
struct Component {
    id: &'static str,
    version: &'static str,
    url: &'static str,
    sha256: &'static str,
    size: u64,
    license: &'static str,
    source_url: &'static str,
    build_source_url: Option<&'static str>,
}

fn manifest() -> Vec<Component> {
    #[cfg(all(target_os = "windows", target_arch = "x86_64"))]
    let assets = [
        ("ffmpeg", "N-128889-g88c46fce27", "https://github.com/FFmpeg-Builds/FFmpeg-Builds/releases/download/autobuild-2026-11-13-12-43/ffmpeg-N-128889-g88c46fce27-win64-gpl.zip", "35fa1c17eeead1f572072b134458788caf71c4a7fbce9e0bb2f3c41032959531", 201952396),
        ("yt-dlp", "2026.11.04.232659", "https://github.com/yt-dlp/yt-dlp-nightly-builds/releases/download/2026.11.04.232659/yt-dlp.exe", "85c8d440422108bee7ecd11e584d56cc04fb3bd1a0b3200bdc8a66d5c5a985fc", 23587638),
        ("uv", "0.13.8", "https://github.com/astral-sh/uv/releases/download/0.13.8/uv-x86_64-pc-windows-msvc.zip", "529e78a9cec6cd7e3e014f7ecd8bda0c113969d4ed0f2efeedb85c30943325b8", 15529884),
        ("deno", "2.9.8", "https://github.com/denoland/deno/releases/download/v2.9.8/deno-x86_64-pc-windows-msvc.zip", "cba84b26e0df5ae7f74fc66b86a95b866872a86292ebd84fa1e959927edd93bf", 42917472),
        ("pocket-tts", "3.3.0", "https://github.com/kyutai-labs/pocket-tts/releases/download/v4.0.1/pocket-tts-3.3.0-x86_64-pc-windows-msvc.zip", "98753041f2e65744b989776f87bccb93f1f574a08afe1890c5427ec94cd6309c", 7914990),
    ];
    #[cfg(all(target_os = "linux", target_arch = "x86_64"))]
    let assets = [
        ("ffmpeg", "N-128889-g88c46fce27", "https://github.com/FFmpeg-Builds/FFmpeg-Builds/releases/download/autobuild-2026-11-13-12-43/ffmpeg-N-128889-g88c46fce27-linux64-gpl.tar.xz", "efa8f93583e84d5a1036e7e08e19db9f03ca637d7620ed58b0ecca39e9e34323", 157401784),
        ("yt-dlp", "2026.11.04.232659", "https://github.com/yt-dlp/yt-dlp-nightly-builds/releases/download/2026.11.04.232659/yt-dlp_linux", "16e96c02ffefd0bd1fe8ae6cc943b16c96e575c29eed7038d15213034437bc34", 41179568),
        ("uv", "0.13.8", "https://github.com/astral-sh/uv/releases/download/0.13.8/uv-x86_64-unknown-linux-gnu.tar.gz", "5acfd9177cfecf0bf87578f059728215ccc884388988f55f7a65041b57387d91", 16855069),
        ("deno", "2.9.8", "https://github.com/denoland/deno/releases/download/v2.9.8/deno-x86_64-unknown-linux-gnu.zip", "e890975bc2549807bbcc0b584ffafda72cc7c93349dd99c80483dd784f6c4609", 41963064),
        ("pocket-tts", "3.3.0", "https://github.com/kyutai-labs/pocket-tts/releases/download/v4.0.1/pocket-tts-3.3.0-x86_64-unknown-linux-gnu.tar.gz", "9abff0aa138a804e44052952d8c3bdaae247fb267ca8f4b83fe178897d1a0559", 8641335),
    ];
    #[cfg(all(target_os = "macos", target_arch = "aarch64"))]
    let assets = [
        ("deno", "2.9.8", "https://github.com/denoland/deno/releases/download/v2.9.8/deno-aarch64-apple-darwin.zip", "9f0bf660393da2eaff044cdc7444cb08c73f235849b61d224d825a194ce7c98e", 38770795),
        ("pocket-tts", "3.3.0", "https://github.com/kyutai-labs/pocket-tts/releases/download/v4.0.1/pocket-tts-3.3.0-aarch64-apple-darwin.tar.gz", "ee9ca6c7c000ee72c5846e3a8ba01d08f56636d94a614d2259c3f12b8fd69afa", 7696220),
    ];
    #[cfg(all(target_os = "macos", target_arch = "x86_64"))]
    let assets = [
        ("deno", "2.9.8", "https://github.com/denoland/deno/releases/download/v2.9.8/deno-x86_64-apple-darwin.zip", "4b2f5edd2639b7470f034238b321d7002d8dfb4726d8558f52c17afac370eb2c", 42797031),
        ("pocket-tts", "3.3.0", "https://github.com/kyutai-labs/pocket-tts/releases/download/v4.0.1/pocket-tts-3.3.0-x86_64-apple-darwin.tar.gz", "f04baa94d4fc47a689cc9f11ca2b0ba869dc002f9e78e15d387c6ecaeb1d654b", 8376592),
    ];
    #[cfg(not(any(
        all(target_os = "windows", target_arch = "x86_64"),
        all(target_os = "linux", target_arch = "x86_64"),
        all(target_os = "macos", target_arch = "aarch64"),
        all(target_os = "macos", target_arch = "x86_64")
    )))]
    let assets: [(&str, &str, &str, &str, u64); 0] = [];
    assets
        .into_iter()
        .map(|(id, version, url, sha256, size)| Component {
            id,
            version,
            url,
            sha256,
            size,
            license: match id {
                "ffmpeg" => "GPL-3.0-or-later",
                // Licença dupla "Apache-2.0 OR MIT"; adotamos a Apache-2.0 do projeto.
                "uv" => "Apache-2.0",
                "deno" | "pocket-tts" => "MIT",
                _ => "Unlicense",
            },
            build_source_url: if id == "ffmpeg" { Some("https://github.com/FFmpeg-Builds/FFmpeg-Builds/tree/autobuild-2026-11-13-12-43") } else { None },
            source_url: match id {
                "ffmpeg" => "https://github.com/FFmpeg/FFmpeg/tree/88c46fce27",
                "uv" => "https://github.com/astral-sh/uv/tree/0.13.8",
                "deno" => "https://github.com/denoland/deno/tree/v2.9.8",
                "pocket-tts" => "https://github.com/kyutai-labs/pocket-tts/tree/v4.0.1",
                _ => "https://github.com/yt-dlp/yt-dlp-nightly-builds/tree/2026.11.04.232659",
            },
        })
        .collect()
}
fn error(code: &str, message: impl ToString) -> CoreError {
    CoreError {
        code: code.into(),
        message: message.to_string(),
        usage: None,
    }
}
fn manifest_command(_: Value, _: &mut EventSink<'_>) -> CommandResult {
    Ok(json!(manifest()))
}

#[derive(Clone, Serialize, Deserialize)]
pub(crate) struct Settings {
    pub(crate) data_dir: PathBuf,
    cache_dir: PathBuf,
    cache_limit_bytes: u64,
    ffmpeg_path: Option<PathBuf>,
}
fn settings_path() -> Result<PathBuf, CoreError> {
    crate::paths::component_settings_file()
}
fn default_settings() -> Result<Settings, CoreError> {
    let dirs = crate::paths::app_dirs()?;
    Ok(Settings {
        cache_dir: dirs.cache_dir,
        data_dir: dirs.data_dir,
        cache_limit_bytes: 10_000_000_000,
        ffmpeg_path: None,
    })
}
pub(crate) fn load_settings() -> Result<Settings, CoreError> {
    let p = settings_path()?;
    match fs::read(p) {
        Ok(data) => serde_json::from_slice(&data).map_err(|e| error("settings", e)),
        Err(e) if e.kind() == io::ErrorKind::NotFound => default_settings(),
        Err(e) => Err(error("settings", e)),
    }
}
pub(crate) fn cache_settings() -> Result<(PathBuf, u64, Option<PathBuf>), CoreError> {
    let settings =
        load_settings().map_err(|_| error("settings", "Não foi possível ler as configurações."))?;
    Ok((
        settings.cache_dir,
        settings.cache_limit_bytes,
        settings.ffmpeg_path,
    ))
}
pub(crate) fn ytdlp_executable() -> Result<PathBuf, CoreError> {
    let settings = load_settings()
        .map_err(|_| error("component_missing", "Componente yt-dlp indisponível"))?;
    let executable = settings.data_dir.join("components").join(if cfg!(windows) {
        "yt-dlp.exe"
    } else {
        "yt-dlp"
    });
    if !executable.is_file() {
        return Err(error("component_missing", "Instale o Componente yt-dlp"));
    }
    update::installed(&executable)?;
    Ok(executable)
}
fn deno_file(settings: &Settings) -> PathBuf {
    settings
        .data_dir
        .join("components")
        .join(if cfg!(windows) { "deno.exe" } else { "deno" })
}
/// Versão do `deno` que o executável informa (`deno 2.9.8 (...)`), sem caminhos.
fn deno_version(exe: &Path) -> Option<String> {
    let output = crate::process::spawn(exe, ["--version"], None)
        .and_then(|child| child.wait_with_output())
        .ok()?;
    let text = String::from_utf8_lossy(&output.stdout);
    let version = text.strip_prefix("deno ")?.split_whitespace().next()?;
    (output.status.success()
        && !version.is_empty()
        && version.bytes().all(|b| b.is_ascii_digit() || b == b'.'))
    .then(|| version.to_owned())
}
/// Caminho absoluto do deno instalado como Componente, se existir (#203).
pub(crate) fn deno_executable() -> Option<PathBuf> {
    let file = deno_file(&load_settings().ok()?);
    if !file.is_file() {
        return None;
    }
    std::path::absolute(file).ok()
}
fn deno_status(_: Value, _: &mut EventSink<'_>) -> CommandResult {
    let pinned = manifest()
        .into_iter()
        .find(|c| c.id == "deno")
        .map(|c| c.version);
    let file = deno_file(&load_settings()?);
    let version = file.is_file().then(|| deno_version(&file)).flatten();
    let outdated = version.is_some() && version.as_deref() != pinned;
    Ok(
        json!({"installed": version.is_some(), "version": version, "pinned": pinned, "outdated": outdated}),
    )
}
pub(crate) fn pocket_tts_file(settings: &Settings) -> PathBuf {
    settings.data_dir.join("components").join(if cfg!(windows) {
        "pocket-tts.exe"
    } else {
        "pocket-tts"
    })
}
/// Versão do `pocket-tts` que o executável informa (`pocket-tts 3.3.0`), sem caminhos.
pub(crate) fn pocket_tts_version(exe: &Path) -> Option<String> {
    let output = crate::process::spawn(exe, ["--version"], None)
        .and_then(|child| child.wait_with_output())
        .ok()?;
    let text = String::from_utf8_lossy(&output.stdout);
    let version = text
        .strip_prefix("pocket-tts ")?
        .split_whitespace()
        .next()?;
    (output.status.success()
        && !version.is_empty()
        && version.bytes().all(|b| b.is_ascii_digit() || b == b'.'))
    .then(|| version.to_owned())
}
/// Caminho absoluto do `pocket-tts` instalado como Componente (#79).
pub(crate) fn pocket_tts_executable() -> Result<PathBuf, CoreError> {
    let settings = load_settings()
        .map_err(|_| error("component_missing", "Componente pocket-tts indisponível"))?;
    let file = pocket_tts_file(&settings);
    if !file.is_file() {
        return Err(error(
            "component_missing",
            "Instale o Componente pocket-tts em Componentes.",
        ));
    }
    std::path::absolute(file)
        .map_err(|_| error("component_missing", "Componente pocket-tts indisponível"))
}
fn pocket_tts_status(_: Value, _: &mut EventSink<'_>) -> CommandResult {
    let pinned = manifest()
        .into_iter()
        .find(|c| c.id == "pocket-tts")
        .map(|c| c.version);
    let file = pocket_tts_file(&load_settings()?);
    let version = file.is_file().then(|| pocket_tts_version(&file)).flatten();
    let outdated = version.is_some() && version.as_deref() != pinned;
    Ok(
        json!({"installed": version.is_some(), "version": version, "pinned": pinned, "outdated": outdated}),
    )
}
pub(crate) fn ytdlp_version(exe: &Path) -> String {
    update::installed(exe).unwrap_or_else(|_| "indisponível".into())
}
pub(crate) fn configured_ffmpeg() -> Option<PathBuf> {
    load_settings().ok().and_then(|s| s.ffmpeg_path)
}

fn diagnostic_components_for(settings: &Settings) -> String {
    manifest()
        .into_iter()
        .map(|item| {
            let value = match item.id {
                "ffmpeg" => match &settings.ffmpeg_path {
                    None => "não instalado".to_string(),
                    Some(path) => {
                        let managed = managed_ffmpeg(&settings.data_dir);
                        if path == &managed {
                            if managed_incomplete(settings) {
                                "não instalado".into()
                            } else {
                                item.version.into()
                            }
                        } else {
                            "FFmpeg do sistema".into()
                        }
                    }
                },
                "yt-dlp" => {
                    let exe = settings.data_dir.join("components").join(if cfg!(windows) {
                        "yt-dlp.exe"
                    } else {
                        "yt-dlp"
                    });
                    if !exe.is_file() {
                        "não instalado".into()
                    } else {
                        update::installed(&exe).unwrap_or_else(|_| "indisponível".into())
                    }
                }
                "uv" => worker::uv_version_for(settings).unwrap_or_else(|| "não instalado".into()),
                "deno" => Some(deno_file(settings))
                    .filter(|exe| exe.is_file())
                    .and_then(|exe| deno_version(&exe))
                    .unwrap_or_else(|| "não instalado".into()),
                "pocket-tts" => Some(pocket_tts_file(settings))
                    .filter(|exe| exe.is_file())
                    .and_then(|exe| pocket_tts_version(&exe))
                    .unwrap_or_else(|| "não instalado".into()),
                _ => "indisponível".into(),
            };
            format!("{}: {}", item.id, value)
        })
        .collect::<Vec<_>>()
        .join(", ")
}
fn diagnostic_components() -> String {
    load_settings()
        .map(|s| diagnostic_components_for(&s))
        .unwrap_or_else(|_| "indisponível".into())
}
inventory::submit! { crate::diagnostic::DiagnosticField { kind: crate::diagnostic::DiagnosticKind::Components, value: diagnostic_components } }

fn ffmpeg_name() -> &'static str {
    if cfg!(windows) {
        "ffmpeg.exe"
    } else {
        "ffmpeg"
    }
}
fn managed_ffmpeg(data_dir: &Path) -> PathBuf {
    data_dir.join("components").join(ffmpeg_name())
}
fn probe_name() -> &'static str {
    if cfg!(windows) {
        "ffprobe.exe"
    } else {
        "ffprobe"
    }
}
fn managed_incomplete(settings: &Settings) -> bool {
    let Some(path) = &settings.ffmpeg_path else {
        return false;
    };
    let managed = managed_ffmpeg(&settings.data_dir);
    path == &managed && (!path.is_file() || !path.with_file_name(probe_name()).is_file())
}
pub(crate) fn ffprobe_executable(ffmpeg: Option<&Path>) -> Result<PathBuf, CoreError> {
    let settings = load_settings()
        .map_err(|_| error("ffprobe_missing", "Não foi possível verificar o ffprobe"))?;
    if managed_incomplete(&settings) && ffmpeg == settings.ffmpeg_path.as_deref() {
        return Err(error(
            "ffprobe_missing",
            "Componente FFmpeg incompleto; reinstale-o",
        ));
    }
    let sibling = ffmpeg
        .map(|p| p.with_file_name(probe_name()))
        .filter(|p| p.is_file());
    let managed = settings.ffmpeg_path.as_deref() == ffmpeg
        && ffmpeg == Some(managed_ffmpeg(&settings.data_dir).as_path());
    let mut candidates = Vec::new();
    if let Some(path) = sibling {
        candidates.push(path);
    }
    if !managed {
        candidates.push(PathBuf::from(probe_name()));
    }
    for executable in candidates {
        let valid = crate::process::spawn(&executable, ["-version"], None)
            .and_then(|child| child.wait_with_output())
            .is_ok_and(|o| {
                o.status.success()
                    && String::from_utf8_lossy(&o.stdout).starts_with("ffprobe version ")
            });
        if valid {
            return Ok(executable);
        }
    }
    Err(error(
        "ffprobe_missing",
        "ffprobe indisponível; verifique os Componentes",
    ))
}
fn ffmpeg_status(_: Value, _: &mut EventSink<'_>) -> CommandResult {
    let settings = load_settings()?;
    let incomplete = managed_incomplete(&settings);
    let installed = !incomplete
        && settings.ffmpeg_path.as_ref().is_some_and(|p| {
            if p.is_absolute() || p.components().count() > 1 {
                p.is_file()
            } else {
                true
            }
        });
    Ok(json!({"incomplete": incomplete, "installed": installed}))
}
fn save_settings(s: &Settings) -> Result<(), CoreError> {
    let p = settings_path()?;
    fs::create_dir_all(p.parent().unwrap()).map_err(|e| error("settings", e))?;
    fs::write(p, serde_json::to_vec_pretty(s).unwrap()).map_err(|e| error("settings", e))
}
fn settings_get(_: Value, _: &mut EventSink<'_>) -> CommandResult {
    Ok(json!(load_settings()?))
}
fn revalidate_ffmpeg_on_data_dir_change(
    next: &mut Settings,
    previous: Option<&Settings>,
    default_data_dir: Option<&Path>,
) {
    let was_managed = next.ffmpeg_path.as_deref().is_some_and(|path| {
        previous
            .filter(|prev| prev.data_dir != next.data_dir)
            .is_some_and(|prev| path == managed_ffmpeg(&prev.data_dir))
            || default_data_dir
                .filter(|dir| *dir != next.data_dir)
                .is_some_and(|dir| path == managed_ffmpeg(dir))
    });
    if !was_managed {
        return;
    }
    let candidate = managed_ffmpeg(&next.data_dir);
    next.ffmpeg_path = candidate.is_file().then_some(candidate);
}
fn settings_set(v: Value, _: &mut EventSink<'_>) -> CommandResult {
    let mut s: Settings = serde_json::from_value(v).map_err(|e| error("invalid_settings", e))?;
    if !s.data_dir.is_absolute() || !s.cache_dir.is_absolute() || s.cache_limit_bytes == 0 {
        return Err(error(
            "invalid_settings",
            "Caminhos absolutos e limite positivo são obrigatórios",
        ));
    }
    let previous = load_settings().ok();
    let default_data_dir = crate::paths::data_dir().ok();
    revalidate_ffmpeg_on_data_dir_change(&mut s, previous.as_ref(), default_data_dir.as_deref());
    save_settings(&s)?;
    Ok(json!(s))
}
fn ffmpeg_system(v: Value, _: &mut EventSink<'_>) -> CommandResult {
    let path = v.get("path").and_then(Value::as_str).unwrap_or("ffmpeg");
    crate::console::emit_console(crate::console::ConsoleDraft {
        job: "ffmpeg",
        project: None,
        origin: "ffmpeg",
        level: crate::console::ConsoleLevel::Info,
        kind: crate::console::ConsoleKind::Milestone,
        simple: "Validando FFmpeg e FFprobe do sistema…",
        technical: Some(&format!("ffmpeg -version path={path}")),
    });
    let output = crate::process::spawn(path, ["-version"], None)
        .and_then(|child| child.wait_with_output())
        .map_err(|e| {
            crate::console::emit_console(crate::console::ConsoleDraft {
                job: "ffmpeg",
                project: None,
                origin: "ffmpeg",
                level: crate::console::ConsoleLevel::Error,
                kind: crate::console::ConsoleKind::Milestone,
                simple: "Não foi possível executar o FFmpeg informado.",
                technical: None,
            });
            error("invalid_ffmpeg", e)
        })?;
    let version = String::from_utf8_lossy(&output.stdout)
        .lines()
        .next()
        .unwrap_or("")
        .to_owned();
    if !output.status.success() || !version.starts_with("ffmpeg version ") {
        crate::console::emit_console(crate::console::ConsoleDraft {
            job: "ffmpeg",
            project: None,
            origin: "ffmpeg",
            level: crate::console::ConsoleLevel::Error,
            kind: crate::console::ConsoleKind::Milestone,
            simple: "Executável informado não respondeu como FFmpeg válido.",
            technical: None,
        });
        return Err(error("invalid_ffmpeg", "FFmpeg inválido"));
    }
    ffprobe_executable(Some(Path::new(path)))?;
    let mut s = load_settings()?;
    s.ffmpeg_path = Some(path.into());
    save_settings(&s)?;
    crate::console::emit_console(crate::console::ConsoleDraft {
        job: "ffmpeg",
        project: None,
        origin: "ffmpeg",
        level: crate::console::ConsoleLevel::Info,
        kind: crate::console::ConsoleKind::Milestone,
        simple: "FFmpeg do sistema validado e pronto para uso.",
        technical: Some(&version),
    });
    Ok(json!({"version": version, "path": path}))
}

static JOBS: OnceLock<Mutex<HashMap<String, Arc<AtomicBool>>>> = OnceLock::new();
pub(crate) fn jobs() -> &'static Mutex<HashMap<String, Arc<AtomicBool>>> {
    JOBS.get_or_init(|| Mutex::new(HashMap::new()))
}
fn cancel(v: Value, _: &mut EventSink<'_>) -> CommandResult {
    let id = v["id"].as_str().unwrap_or("");
    if let Some(flag) = jobs().lock().unwrap().get(id) {
        flag.store(true, Ordering::Relaxed);
    }
    Ok(json!({}))
}
fn download(v: Value, events: &mut EventSink<'_>) -> CommandResult {
    if v["confirmed"] != true {
        return Err(error(
            "confirmation_required",
            "Confirme o download antes de iniciar",
        ));
    }
    let id = v["id"].as_str().unwrap_or("");
    let item = manifest()
        .into_iter()
        .find(|c| c.id == id)
        .ok_or_else(|| error("unknown_component", "Componente indisponível"))?;
    let flag = Arc::new(AtomicBool::new(false));
    {
        let mut map = jobs().lock().unwrap();
        if map.contains_key(id) {
            return Err(error("already_downloading", "Download em andamento"));
        }
        map.insert(id.into(), flag.clone());
    }
    let result = download_item(&item, &flag, id, events);
    if result.is_err() {
        crate::diagnostic::record(crate::diagnostic::DiagnosticEvent::ComponentFailure);
    }
    jobs().lock().unwrap().remove(id);
    result
}
pub(crate) fn url_host(url: &str) -> String {
    reqwest::Url::parse(url)
        .ok()
        .and_then(|u| u.host_str().map(str::to_owned))
        .unwrap_or_else(|| "remoto".into())
}

pub(crate) fn format_bytes_pt(bytes: u64) -> String {
    const KB: f64 = 1024.0;
    const MB: f64 = 1024.0 * 1024.0;
    const GB: f64 = 1024.0 * 1024.0 * 1024.0;
    let b = bytes as f64;
    if b >= GB {
        format!("{:.2} GB", b / GB).replace('.', ",")
    } else if b >= MB {
        format!("{:.1} MB", b / MB).replace('.', ",")
    } else if b >= KB {
        format!("{:.0} KB", b / KB)
    } else {
        format!("{bytes} B")
    }
}

pub(crate) fn emit_download_console_progress(
    job: &str,
    origin: &str,
    label: &str,
    host: &str,
    offset: u64,
    total: u64,
) {
    let pct = ((offset.saturating_mul(100) / total.max(1)).min(99)) as u8;
    crate::console::emit_console(crate::console::ConsoleDraft {
        job,
        project: None,
        origin,
        level: crate::console::ConsoleLevel::Info,
        kind: crate::console::ConsoleKind::Continuous("download"),
        simple: &format!("Baixando {label} · {pct}%"),
        technical: Some(&format!(
            "download host={host} bytes={offset}/{total} pct={pct}%"
        )),
    });
}

fn download_item(
    item: &Component,
    flag: &AtomicBool,
    id: &str,
    events: &mut EventSink<'_>,
) -> CommandResult {
    let settings = load_settings()?;
    let dir = settings.data_dir.join("components");
    fs::create_dir_all(&dir).map_err(|e| error("download", e))?;
    let part = dir.join(format!("{}-{}.part", item.id, item.version));
    let host = url_host(item.url);
    crate::console::emit_console(crate::console::ConsoleDraft {
        job: id,
        project: None,
        origin: "component",
        level: crate::console::ConsoleLevel::Info,
        kind: crate::console::ConsoleKind::Milestone,
        simple: &format!("Baixando {} ({})…", item.id, format_bytes_pt(item.size)),
        technical: Some(&format!(
            "download id={} version={} host={} bytes=0/{}",
            item.id, item.version, host, item.size
        )),
    });
    let client = reqwest::blocking::Client::builder()
        .build()
        .map_err(|e| error("download", e))?;
    if let Err(err) = fetch_with_bytes(
        &client,
        item.url,
        item.sha256,
        item.size,
        &part,
        flag,
        |offset, total| {
            let percentage = ((offset.saturating_mul(100) / total.max(1)).min(99)) as u8;
            emit_download_console_progress(id, "component", item.id, &host, offset, total);
            events(ProgressEvent {
                project: None,
                clip_id: None,
                job: id.into(),
                stage: "download".into(),
                percentage,
                message: "Baixando componente".into(),
                error: None,
            })
        },
    ) {
        crate::console::emit_console(crate::console::ConsoleDraft {
            job: id,
            project: None,
            origin: "component",
            level: if err.code == "cancelled" {
                crate::console::ConsoleLevel::Warn
            } else {
                crate::console::ConsoleLevel::Error
            },
            kind: crate::console::ConsoleKind::Milestone,
            simple: &err.message,
            technical: Some(&format!("download_failed id={} code={}", item.id, err.code)),
        });
        return Err(err);
    }
    crate::console::emit_console(crate::console::ConsoleDraft {
        job: id,
        project: None,
        origin: "component",
        level: crate::console::ConsoleLevel::Info,
        kind: crate::console::ConsoleKind::Milestone,
        simple: &format!(
            "Conferindo integridade (SHA-256) e instalando {}…",
            item.id
        ),
        technical: Some(&format!("sha256 ok id={} extracting", item.id)),
    });
    let exe = dir.join(if cfg!(windows) {
        format!("{}.exe", item.id)
    } else {
        item.id.to_string()
    });
    install(item, &part, &exe)?;
    if item.id == "ffmpeg" {
        let mut settings = load_settings()?;
        settings.ffmpeg_path = Some(exe.clone());
        save_settings(&settings)?;
    }
    fs::remove_file(part).map_err(|e| error("install", e))?;
    crate::console::emit_console(crate::console::ConsoleDraft {
        job: id,
        project: None,
        origin: "component",
        level: crate::console::ConsoleLevel::Info,
        kind: crate::console::ConsoleKind::Milestone,
        simple: &format!("{} instalado e pronto para uso.", item.id),
        technical: Some(&format!("installed id={} path={}", item.id, exe.display())),
    });
    events(ProgressEvent {
        project: None,
        clip_id: None,
        job: id.into(),
        stage: "complete".into(),
        percentage: 100,
        message: "Componente instalado".into(),
        error: None,
    });
    Ok(json!({"path": exe}))
}
#[cfg(test)]
fn fetch(
    url: &str,
    sha: &str,
    size: u64,
    path: &Path,
    cancelled: &AtomicBool,
    progress: impl FnMut(u8),
) -> Result<(), CoreError> {
    let client = reqwest::blocking::Client::builder()
        .build()
        .map_err(|e| error("download", e))?;
    fetch_with(&client, url, sha, size, path, cancelled, progress)
}
#[cfg(test)]
pub(crate) fn fetch_with(
    client: &reqwest::blocking::Client,
    url: &str,
    sha: &str,
    size: u64,
    path: &Path,
    cancelled: &AtomicBool,
    mut progress: impl FnMut(u8),
) -> Result<(), CoreError> {
    fetch_with_bytes(client, url, sha, size, path, cancelled, |offset, total| {
        progress(((offset.saturating_mul(100) / total.max(1)).min(99)) as u8);
    })
}
pub(crate) fn fetch_with_bytes(
    client: &reqwest::blocking::Client,
    url: &str,
    sha: &str,
    size: u64,
    path: &Path,
    cancelled: &AtomicBool,
    mut on_bytes: impl FnMut(u64, u64),
) -> Result<(), CoreError> {
    let mut offset = fs::metadata(path).map(|m| m.len()).unwrap_or(0);
    if offset > size {
        fs::remove_file(path).map_err(|e| error("download", e))?;
        offset = 0;
    }
    if offset == size {
        let mut f = File::open(path).map_err(|e| error("download", e))?;
        let mut hash = Sha256::new();
        io::copy(&mut f, &mut hash).map_err(|e| error("download", e))?;
        drop(f);
        if format!("{:x}", hash.finalize()) == sha {
            return Ok(());
        }
        fs::remove_file(path).map_err(|e| error("download", e))?;
        return Err(error(
            "hash_mismatch",
            "A integridade do arquivo não confere; o download foi descartado",
        ));
    }
    let mut request = client.get(url);
    if offset > 0 {
        request = request.header(reqwest::header::RANGE, format!("bytes={offset}-"));
    }
    let mut response = request
        .send()
        .and_then(|r| r.error_for_status())
        .map_err(|e| error("download", e))?;
    if offset > 0 && response.status() != reqwest::StatusCode::PARTIAL_CONTENT {
        offset = 0;
    }
    if offset > 0
        && !response
            .headers()
            .get(reqwest::header::CONTENT_RANGE)
            .and_then(|h| h.to_str().ok())
            .is_some_and(|h| h.starts_with(&format!("bytes {offset}-")))
    {
        return Err(error("download", "Resposta de retomada inválida"));
    }
    let mut file = OpenOptions::new()
        .create(true)
        .write(true)
        .append(offset > 0)
        .truncate(offset == 0)
        .open(path)
        .map_err(|e| error("download", e))?;
    let mut buffer = [0u8; 65536];
    loop {
        if cancelled.load(Ordering::Relaxed) {
            return Err(error("cancelled", "Download cancelado"));
        }
        let n = response
            .read(&mut buffer)
            .map_err(|e| error("download", e))?;
        if n == 0 {
            break;
        }
        file.write_all(&buffer[..n])
            .map_err(|e| error("download", e))?;
        offset += n as u64;
        on_bytes(offset, size);
    }
    drop(file);
    let mut file = File::open(path).map_err(|e| error("download", e))?;
    let mut hash = Sha256::new();
    io::copy(&mut file, &mut hash).map_err(|e| error("download", e))?;
    drop(file);
    if offset != size || format!("{:x}", hash.finalize()) != sha {
        fs::remove_file(path).map_err(|e| error("download", e))?;
        return Err(error(
            "hash_mismatch",
            "A integridade do arquivo não confere; o download foi descartado",
        ));
    }
    Ok(())
}
fn install(item: &Component, part: &Path, exe: &Path) -> Result<(), CoreError> {
    if item.id == "yt-dlp" {
        let tmp = exe.with_extension("installing");
        fs::copy(part, &tmp).map_err(|e| error("install", e))?;
        return promote(&tmp, exe);
    }
    if item.id == "uv" {
        return install_uv(part, exe);
    }
    if item.id == "deno" {
        return install_deno(part, exe);
    }
    if item.id == "pocket-tts" {
        return install_pocket_tts(part, exe);
    }
    let probe = exe.with_file_name(probe_name());
    let tmp_exe = exe.with_extension("installing");
    let tmp_probe = probe.with_extension("installing");
    let result = (|| {
        let mut found = [false; 2];
        if cfg!(windows) {
            let mut zip = zip::ZipArchive::new(File::open(part).map_err(|e| error("install", e))?)
                .map_err(|e| error("install", e))?;
            for (index, name) in ["/bin/ffmpeg.exe", "/bin/ffprobe.exe"].iter().enumerate() {
                let idx = (0..zip.len())
                    .find(|i| {
                        zip.by_index(*i)
                            .map(|f| f.name().is_ok_and(|path| path.ends_with(name)))
                            .unwrap_or(false)
                    })
                    .ok_or_else(|| error("install", "Executável FFmpeg ou ffprobe ausente"))?;
                let mut src = zip.by_index(idx).map_err(|e| error("install", e))?;
                let target = if index == 0 { &tmp_exe } else { &tmp_probe };
                io::copy(
                    &mut src,
                    &mut File::create(target).map_err(|e| error("install", e))?,
                )
                .map_err(|e| error("install", e))?;
                found[index] = true;
            }
        } else {
            let decoder =
                xz2::read::XzDecoder::new(File::open(part).map_err(|e| error("install", e))?);
            let mut archive = tar::Archive::new(decoder);
            for entry in archive.entries().map_err(|e| error("install", e))? {
                let mut entry = entry.map_err(|e| error("install", e))?;
                let path = entry
                    .path()
                    .map_err(|e| error("install", e))?
                    .to_string_lossy()
                    .into_owned();
                let index = if path.ends_with("/bin/ffmpeg") {
                    Some(0)
                } else if path.ends_with("/bin/ffprobe") {
                    Some(1)
                } else {
                    None
                };
                if let Some(index) = index {
                    if !entry.header().entry_type().is_file() || found[index] {
                        continue;
                    }
                    let target = if index == 0 { &tmp_exe } else { &tmp_probe };
                    io::copy(
                        &mut entry,
                        &mut File::create(target).map_err(|e| error("install", e))?,
                    )
                    .map_err(|e| error("install", e))?;
                    found[index] = true;
                }
            }
        }
        if !found.into_iter().all(|f| f) {
            return Err(error("install", "Executável FFmpeg ou ffprobe ausente"));
        }
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            for tmp in [&tmp_exe, &tmp_probe] {
                fs::set_permissions(tmp, fs::Permissions::from_mode(0o755))
                    .map_err(|e| error("install", e))?;
            }
        }
        promote(&tmp_probe, &probe)?;
        promote(&tmp_exe, exe)?;
        Ok(())
    })();
    if result.is_err() {
        let _ = fs::remove_file(&tmp_exe);
        let _ = fs::remove_file(&tmp_probe);
    }
    result
}
/// Extrai só o executável `uv` do arquivo oficial (zip no Windows, tar.gz no Linux).
fn install_uv(part: &Path, exe: &Path) -> Result<(), CoreError> {
    let tmp = exe.with_extension("installing");
    let name = if cfg!(windows) { "uv.exe" } else { "uv" };
    let result = (|| {
        let mut found = false;
        if cfg!(windows) {
            let mut zip = zip::ZipArchive::new(File::open(part).map_err(|e| error("install", e))?)
                .map_err(|e| error("install", e))?;
            let index = (0..zip.len())
                .find(|i| {
                    zip.by_index(*i)
                        .map(|f| {
                            f.name()
                                .is_ok_and(|p| p == name || p.ends_with(&format!("/{name}")))
                        })
                        .unwrap_or(false)
                })
                .ok_or_else(|| error("install", "Executável uv ausente"))?;
            let mut src = zip.by_index(index).map_err(|e| error("install", e))?;
            io::copy(
                &mut src,
                &mut File::create(&tmp).map_err(|e| error("install", e))?,
            )
            .map_err(|e| error("install", e))?;
            found = true;
        } else {
            let decoder =
                flate2::read::GzDecoder::new(File::open(part).map_err(|e| error("install", e))?);
            let mut archive = tar::Archive::new(decoder);
            for entry in archive.entries().map_err(|e| error("install", e))? {
                let mut entry = entry.map_err(|e| error("install", e))?;
                let path = entry
                    .path()
                    .map_err(|e| error("install", e))?
                    .to_string_lossy()
                    .into_owned();
                if entry.header().entry_type().is_file()
                    && (path == name || path.ends_with(&format!("/{name}")))
                {
                    io::copy(
                        &mut entry,
                        &mut File::create(&tmp).map_err(|e| error("install", e))?,
                    )
                    .map_err(|e| error("install", e))?;
                    found = true;
                    break;
                }
            }
        }
        if !found {
            return Err(error("install", "Executável uv ausente"));
        }
        promote(&tmp, exe)
    })();
    if result.is_err() {
        let _ = fs::remove_file(&tmp);
    }
    result
}
/// Extrai só o executável `deno` do .zip oficial (o mesmo formato nas três plataformas).
fn install_deno(part: &Path, exe: &Path) -> Result<(), CoreError> {
    let tmp = exe.with_extension("installing");
    let name = if cfg!(windows) { "deno.exe" } else { "deno" };
    let result = (|| {
        let mut zip = zip::ZipArchive::new(File::open(part).map_err(|e| error("install", e))?)
            .map_err(|e| error("install", e))?;
        let index = (0..zip.len())
            .find(|i| {
                zip.by_index(*i)
                    .map(|f| f.name().is_ok_and(|p| p == name))
                    .unwrap_or(false)
            })
            .ok_or_else(|| error("install", "Executável deno ausente"))?;
        let mut src = zip.by_index(index).map_err(|e| error("install", e))?;
        io::copy(
            &mut src,
            &mut File::create(&tmp).map_err(|e| error("install", e))?,
        )
        .map_err(|e| error("install", e))?;
        promote(&tmp, exe)
    })();
    if result.is_err() {
        let _ = fs::remove_file(&tmp);
    }
    result
}
/// Extrai só o executável `pocket-tts` do arquivo oficial (zip no Windows, tar.gz no Linux/macOS).
fn install_pocket_tts(part: &Path, exe: &Path) -> Result<(), CoreError> {
    let tmp = exe.with_extension("installing");
    let name = if cfg!(windows) {
        "pocket-tts.exe"
    } else {
        "pocket-tts"
    };
    let result = (|| {
        let mut found = false;
        if cfg!(windows) {
            let mut zip = zip::ZipArchive::new(File::open(part).map_err(|e| error("install", e))?)
                .map_err(|e| error("install", e))?;
            let index = (0..zip.len())
                .find(|i| {
                    zip.by_index(*i)
                        .map(|f| {
                            f.name()
                                .is_ok_and(|p| p == name || p.ends_with(&format!("/{name}")))
                        })
                        .unwrap_or(false)
                })
                .ok_or_else(|| error("install", "Executável pocket-tts ausente"))?;
            let mut src = zip.by_index(index).map_err(|e| error("install", e))?;
            io::copy(
                &mut src,
                &mut File::create(&tmp).map_err(|e| error("install", e))?,
            )
            .map_err(|e| error("install", e))?;
            found = true;
        } else {
            let decoder =
                flate2::read::GzDecoder::new(File::open(part).map_err(|e| error("install", e))?);
            let mut archive = tar::Archive::new(decoder);
            for entry in archive.entries().map_err(|e| error("install", e))? {
                let mut entry = entry.map_err(|e| error("install", e))?;
                let path = entry
                    .path()
                    .map_err(|e| error("install", e))?
                    .to_string_lossy()
                    .into_owned();
                if entry.header().entry_type().is_file()
                    && (path == name || path.ends_with(&format!("/{name}")))
                {
                    io::copy(
                        &mut entry,
                        &mut File::create(&tmp).map_err(|e| error("install", e))?,
                    )
                    .map_err(|e| error("install", e))?;
                    found = true;
                    break;
                }
            }
        }
        if !found {
            return Err(error("install", "Executável pocket-tts ausente"));
        }
        promote(&tmp, exe)
    })();
    if result.is_err() {
        let _ = fs::remove_file(&tmp);
    }
    result
}
fn promote(tmp: &Path, exe: &Path) -> Result<(), CoreError> {
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        fs::set_permissions(tmp, fs::Permissions::from_mode(0o755))
            .map_err(|e| error("install", e))?;
    }
    if exe.exists() {
        fs::remove_file(exe).map_err(|e| error("install", e))?;
    }
    fs::rename(tmp, exe).map_err(|e| error("install", e))
}

inventory::submit! { CommandRegistration { name: "components.deno.status", execute: deno_status } }
inventory::submit! { CommandRegistration { name: "components.pocket_tts.status", execute: pocket_tts_status } }
inventory::submit! { CommandRegistration { name: "components.ffmpeg.status", execute: ffmpeg_status } }
inventory::submit! { CommandRegistration { name: "components.manifest", execute: manifest_command } }
inventory::submit! { CommandRegistration { name: "components.download", execute: download } }
inventory::submit! { CommandRegistration { name: "components.cancel", execute: cancel } }
inventory::submit! { CommandRegistration { name: "components.settings.get", execute: settings_get } }
inventory::submit! { CommandRegistration { name: "components.settings.set", execute: settings_set } }
inventory::submit! { CommandRegistration { name: "components.ffmpeg.system", execute: ffmpeg_system } }

#[cfg(test)]
mod tests {
    use super::*;
    use std::{
        net::TcpListener,
        thread,
        time::{SystemTime, UNIX_EPOCH},
    };
    fn path() -> PathBuf {
        std::env::temp_dir().join(format!(
            "clipes-component-test-{}-{}",
            std::process::id(),
            SystemTime::now()
                .duration_since(UNIX_EPOCH)
                .unwrap()
                .as_nanos()
        ))
    }
    fn read_headers(stream: &mut std::net::TcpStream) -> String {
        stream.set_nonblocking(false).unwrap();
        stream
            .set_read_timeout(Some(std::time::Duration::from_secs(3)))
            .unwrap();
        let mut request = Vec::new();
        while !request.ends_with(b"\r\n\r\n") {
            let mut byte = [0u8; 1];
            stream.read_exact(&mut byte).unwrap();
            request.push(byte[0]);
        }
        String::from_utf8(request).unwrap()
    }
    fn server(response: &'static [u8]) -> (String, thread::JoinHandle<String>) {
        let listener = TcpListener::bind("127.0.0.1:0").unwrap();
        let addr = listener.local_addr().unwrap();
        let handle = thread::spawn(move || {
            let (mut s, _) = listener.accept().unwrap();
            let request = read_headers(&mut s);
            let _ = s.write_all(response);
            request
        });
        (format!("http://{addr}/file"), handle)
    }
    fn hash(bytes: &[u8]) -> String {
        format!("{:x}", Sha256::digest(bytes))
    }
    #[test]
    fn resumes_with_range_and_checks_full_hash() {
        let p = path();
        fs::write(&p, b"hello ").unwrap();
        let (url, handle) = server(b"HTTP/1.1 206 Partial Content\r\nContent-Length: 5\r\nContent-Range: bytes 6-10/11\r\nConnection: close\r\n\r\nworld");
        fetch(
            &url,
            &hash(b"hello world"),
            11,
            &p,
            &AtomicBool::new(false),
            |_| {},
        )
        .unwrap();
        assert_eq!(fs::read(&p).unwrap(), b"hello world");
        assert!(handle
            .join()
            .unwrap()
            .to_lowercase()
            .contains("range: bytes=6-"));
        fs::remove_file(p).unwrap();
    }
    #[test]
    fn hash_mismatch_deletes_download() {
        let p = path();
        let (url, handle) =
            server(b"HTTP/1.1 200 OK\r\nContent-Length: 3\r\nConnection: close\r\n\r\nbad");
        assert_eq!(
            fetch(&url, &hash(b"yes"), 3, &p, &AtomicBool::new(false), |_| {})
                .unwrap_err()
                .code,
            "hash_mismatch"
        );
        assert!(!p.exists());
        handle.join().unwrap();
    }
    #[test]
    fn cancelled_download_keeps_partial_data_for_resume() {
        let p = path();
        let listener = TcpListener::bind("127.0.0.1:0").unwrap();
        let addr = listener.local_addr().unwrap();
        let (send, received) = std::sync::mpsc::channel();
        let handle = thread::spawn(move || {
            let (mut stream, _) = listener.accept().unwrap();
            read_headers(&mut stream);
            stream
                .write_all(b"HTTP/1.1 200 OK\r\nContent-Length: 6\r\nConnection: close\r\n\r\nyes")
                .unwrap();
            received
                .recv_timeout(std::time::Duration::from_secs(3))
                .unwrap();
            let _ = stream.write_all(b"yes");
        });
        let url = format!("http://{addr}/file");
        let cancel = AtomicBool::new(false);
        assert_eq!(
            fetch(&url, &hash(b"yesyes"), 6, &p, &cancel, |_| {
                cancel.store(true, Ordering::Relaxed);
                let _ = send.send(());
            })
            .unwrap_err()
            .code,
            "cancelled"
        );
        assert_eq!(fs::read(&p).unwrap(), b"yes");
        handle.join().unwrap();
        fs::remove_file(p).unwrap();
    }
    fn archive(path: &Path, include_probe: bool) {
        if cfg!(windows) {
            let mut zip = zip::ZipWriter::new(File::create(path).unwrap());
            let options = zip::write::SimpleFileOptions::default();
            zip.start_file("package/bin/ffmpeg.exe", options).unwrap();
            zip.write_all(b"ffmpeg").unwrap();
            if include_probe {
                zip.start_file("package/bin/ffprobe.exe", options).unwrap();
                zip.write_all(b"ffprobe").unwrap();
            }
            zip.finish().unwrap();
        } else {
            let encoder = xz2::write::XzEncoder::new(File::create(path).unwrap(), 6);
            let mut archive = tar::Builder::new(encoder);
            for (name, contents) in [
                ("package/bin/ffmpeg", b"ffmpeg".as_slice()),
                ("package/bin/ffprobe", b"ffprobe".as_slice()),
            ] {
                if !include_probe && name.ends_with("ffprobe") {
                    continue;
                }
                let mut header = tar::Header::new_gnu();
                header.set_size(contents.len() as u64);
                header.set_mode(0o755);
                header.set_cksum();
                archive.append_data(&mut header, name, contents).unwrap();
            }
            archive.into_inner().unwrap().finish().unwrap();
        }
    }
    #[test]
    fn install_ffmpeg_also_installs_ffprobe_and_preserves_old_files_if_missing() {
        let dir = path();
        fs::create_dir_all(&dir).unwrap();
        let package = dir.join("package");
        let exe = dir.join(if cfg!(windows) {
            "ffmpeg.exe"
        } else {
            "ffmpeg"
        });
        let probe = exe.with_file_name(if cfg!(windows) {
            "ffprobe.exe"
        } else {
            "ffprobe"
        });
        let item = manifest().into_iter().find(|c| c.id == "ffmpeg").unwrap();
        archive(&package, true);
        install(&item, &package, &exe).unwrap();
        assert_eq!(fs::read(&exe).unwrap(), b"ffmpeg");
        assert_eq!(fs::read(&probe).unwrap(), b"ffprobe");
        archive(&package, false);
        assert!(install(&item, &package, &exe).is_err());
        assert_eq!(fs::read(&exe).unwrap(), b"ffmpeg");
        assert_eq!(fs::read(&probe).unwrap(), b"ffprobe");
        fs::remove_dir_all(dir).unwrap();
    }
    #[test]
    fn older_managed_install_is_incomplete_until_probe_exists() {
        let root = path();
        let dir = root.join("components");
        fs::create_dir_all(&dir).unwrap();
        let ffmpeg = dir.join(if cfg!(windows) {
            "ffmpeg.exe"
        } else {
            "ffmpeg"
        });
        fs::write(&ffmpeg, b"ffmpeg").unwrap();
        let settings = Settings {
            data_dir: root.clone(),
            cache_dir: root.join("cache"),
            cache_limit_bytes: 1,
            ffmpeg_path: Some(ffmpeg.clone()),
        };
        assert!(managed_incomplete(&settings));
        fs::write(ffmpeg.with_file_name(probe_name()), b"ffprobe").unwrap();
        assert!(!managed_incomplete(&settings));
        fs::remove_dir_all(root).unwrap();
    }
}

fn verified_checksum(
    key: &impl pgp::types::VerifyingKey,
    sums: &[u8],
    signature: &[u8],
    asset: &str,
) -> Result<String, CoreError> {
    use pgp::composed::{Deserializable, DetachedSignature};
    let invalid = || error("update_signature", "Assinatura da atualização inválida");
    let sig = DetachedSignature::from_bytes(signature).map_err(|_| invalid())?;
    sig.verify(key, sums).map_err(|_| invalid())?;
    let text = std::str::from_utf8(sums)
        .map_err(|_| error("update_checksum", "Lista de hashes inválida"))?;
    let mut matches = text.lines().filter_map(|line| {
        let (hash, filename) = line.split_once(' ')?;
        let filename = filename
            .strip_prefix(' ')
            .or_else(|| filename.strip_prefix('*'))?;
        (filename == asset && hash.len() == 64 && hash.bytes().all(|b| b.is_ascii_hexdigit()))
            .then(|| hash.to_ascii_lowercase())
    });
    let hash = matches
        .next()
        .ok_or_else(|| error("update_checksum", "Hash da atualização ausente"))?;
    if matches.next().is_some() {
        return Err(error("update_checksum", "Lista de hashes inválida"));
    }
    Ok(hash)
}

#[cfg(test)]
mod signature_tests {
    use pgp::{
        composed::{DetachedSignature, KeyType, SecretKeyParamsBuilder},
        crypto::hash::HashAlgorithm,
        ser::Serialize,
        types::Password,
    };
    #[test]
    fn verifies_signed_sums_and_rejects_tampering_or_missing_asset() {
        let key = SecretKeyParamsBuilder::default()
            .key_type(KeyType::Ed25519)
            .can_sign(true)
            .primary_user_id("test".into())
            .build()
            .unwrap()
            .generate(rand::thread_rng())
            .unwrap();
        let sums = format!("{}  yt-dlp.exe\n", "a".repeat(64));
        let sig = DetachedSignature::sign_binary_data(
            rand::thread_rng(),
            &key.primary_key,
            &Password::empty(),
            HashAlgorithm::Sha256,
            sums.as_bytes(),
        )
        .unwrap();
        let bytes = sig.to_bytes().unwrap();
        assert_eq!(
            super::verified_checksum(key.public_key(), sums.as_bytes(), &bytes, "yt-dlp.exe")
                .unwrap(),
            "a".repeat(64)
        );
        assert!(
            super::verified_checksum(key.public_key(), b"tampered", &bytes, "yt-dlp.exe").is_err()
        );
        assert!(super::verified_checksum(
            key.public_key(),
            sums.as_bytes(),
            &bytes,
            "yt-dlp_linux"
        )
        .is_err());
    }
}

#[cfg(test)]
mod diagnostic_tests {
    use super::*;
    #[test]
    fn reports_component_versions_without_paths() {
        let root =
            std::env::temp_dir().join(format!("clipes-private-diagnostic-{}", std::process::id()));
        let dir = root.join("components");
        fs::create_dir_all(&dir).unwrap();
        let mut settings = Settings {
            data_dir: root.clone(),
            cache_dir: root.join("cache"),
            cache_limit_bytes: 1,
            ffmpeg_path: None,
        };
        let initial = diagnostic_components_for(&settings);
        assert!(initial.contains("ffmpeg: não instalado"));
        assert!(initial.contains("yt-dlp: não instalado"));
        settings.ffmpeg_path = Some(root.join("secret-system-ffmpeg"));
        let system = diagnostic_components_for(&settings);
        assert!(system.contains("FFmpeg do sistema"));
        assert!(!system.contains("secret"));
        let ffmpeg = dir.join(if cfg!(windows) {
            "ffmpeg.exe"
        } else {
            "ffmpeg"
        });
        fs::write(&ffmpeg, b"ffmpeg").unwrap();
        fs::write(ffmpeg.with_file_name(probe_name()), b"ffprobe").unwrap();
        settings.ffmpeg_path = Some(ffmpeg);
        let exe = dir.join(if cfg!(windows) {
            "yt-dlp.exe"
        } else {
            "yt-dlp"
        });
        fs::write(&exe, b"updated").unwrap();
        fs::write(dir.join("yt-dlp.state.json"), serde_json::to_vec(&json!({"version":"2027.01.01.000000", "sha256":format!("{:x}", Sha256::digest(b"updated")), "origin":"SHA2-256SUMS assinado por yt-dlp"})).unwrap()).unwrap();
        let result = diagnostic_components_for(&settings);
        let version = manifest()
            .into_iter()
            .find(|c| c.id == "ffmpeg")
            .unwrap()
            .version;
        assert!(result.contains(&format!("ffmpeg: {version}")));
        assert!(result.contains("yt-dlp: 2027.01.01.000000"));
        assert!(!result.contains(root.to_str().unwrap()));

        // Troca de data_dir revalida ffmpeg_path gerenciado em vez de rotulá-lo como sistema.
        let other = root.join("other-data");
        let mut moved = settings.clone();
        moved.data_dir = other.clone();
        revalidate_ffmpeg_on_data_dir_change(&mut moved, Some(&settings), Some(root.as_path()));
        assert!(moved.ffmpeg_path.is_none());
        assert!(diagnostic_components_for(&moved).contains("ffmpeg: não instalado"));

        let moved_ffmpeg = managed_ffmpeg(&other);
        fs::create_dir_all(moved_ffmpeg.parent().unwrap()).unwrap();
        fs::write(&moved_ffmpeg, b"ffmpeg").unwrap();
        fs::write(moved_ffmpeg.with_file_name(probe_name()), b"ffprobe").unwrap();
        let mut moved_ready = settings.clone();
        moved_ready.data_dir = other;
        revalidate_ffmpeg_on_data_dir_change(
            &mut moved_ready,
            Some(&settings),
            Some(root.as_path()),
        );
        assert_eq!(moved_ready.ffmpeg_path.as_ref(), Some(&moved_ffmpeg));
        assert!(diagnostic_components_for(&moved_ready).contains(&format!("ffmpeg: {version}")));

        fs::remove_dir_all(root).unwrap();
    }
}

#[cfg(test)]
mod deno_tests {
    use super::*;
    fn root() -> PathBuf {
        std::env::temp_dir().join(format!(
            "clipes-203-deno-{}-{}",
            std::process::id(),
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap()
                .as_nanos()
        ))
    }
    fn build_fake(root: &Path) -> PathBuf {
        let fake = root.join(if cfg!(windows) {
            "fake-deno.exe"
        } else {
            "fake-deno"
        });
        let rustc = PathBuf::from(env!("CARGO")).with_file_name(if cfg!(windows) {
            "rustc.exe"
        } else {
            "rustc"
        });
        assert!(std::process::Command::new(rustc)
            .arg(Path::new(env!("CARGO_MANIFEST_DIR")).join("tests/fixtures/fake_deno.rs"))
            .arg("-o")
            .arg(&fake)
            .status()
            .unwrap()
            .success());
        fake
    }
    fn zip_with(path: &Path, name: &str, contents: &[u8]) {
        let mut zip = zip::ZipWriter::new(File::create(path).unwrap());
        zip.start_file(name, zip::write::SimpleFileOptions::default())
            .unwrap();
        zip.write_all(contents).unwrap();
        zip.finish().unwrap();
    }
    #[test]
    fn manifest_pins_deno_with_mit_license_per_platform() {
        let deno = manifest().into_iter().find(|c| c.id == "deno").unwrap();
        assert_eq!(deno.license, "MIT");
        assert!(deno
            .url
            .starts_with("https://github.com/denoland/deno/releases/download/v"));
        assert!(deno.url.contains(deno.version) && deno.url.ends_with(".zip"));
        assert_eq!(deno.sha256.len(), 64);
        assert!(deno.sha256.bytes().all(|b| b.is_ascii_hexdigit()));
        assert!(deno.source_url.contains(deno.version));
    }
    #[test]
    fn fake_deno_component_installs_reports_version_and_hides_paths() {
        let root = root();
        let dir = root.join("components");
        fs::create_dir_all(&dir).unwrap();
        let fake = build_fake(&root);
        let settings = Settings {
            data_dir: root.clone(),
            cache_dir: root.join("cache"),
            cache_limit_bytes: 1,
            ffmpeg_path: None,
        };
        assert!(diagnostic_components_for(&settings).contains("deno: não instalado"));
        let exe = deno_file(&settings);
        assert!(!exe.is_file());
        let name = if cfg!(windows) { "deno.exe" } else { "deno" };
        // Arquivo sem o executável: erro tipado e nada instalado.
        let bad = dir.join("bad.zip");
        zip_with(&bad, "LICENSE", b"x");
        assert_eq!(install_deno(&bad, &exe).unwrap_err().code, "install");
        assert!(!exe.is_file() && !exe.with_extension("installing").exists());
        // Arquivo oficial: o .zip traz só o executável na raiz.
        let good = dir.join("good.zip");
        zip_with(&good, name, &fs::read(&fake).unwrap());
        install_deno(&good, &exe).unwrap();
        assert_eq!(deno_version(&exe).as_deref(), Some("2.9.8"));
        let report = diagnostic_components_for(&settings);
        assert!(report.contains("deno: 2.9.8"));
        assert!(!report.contains(root.to_str().unwrap()));
        // Reinstalar (atualização) substitui o executável anterior.
        install_deno(&good, &exe).unwrap();
        assert_eq!(deno_version(&exe).as_deref(), Some("2.9.8"));
        fs::remove_dir_all(root).unwrap();
    }
}

#[cfg(test)]
mod pocket_tts_tests {
    use super::*;

    fn root() -> PathBuf {
        std::env::temp_dir().join(format!(
            "clipes-79-ptts-{}-{}",
            std::process::id(),
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap()
                .as_nanos()
        ))
    }

    fn build_fake(root: &Path) -> PathBuf {
        let fake = root.join(if cfg!(windows) {
            "fake-pocket-tts.exe"
        } else {
            "fake-pocket-tts"
        });
        let rustc = PathBuf::from(env!("CARGO")).with_file_name(if cfg!(windows) {
            "rustc.exe"
        } else {
            "rustc"
        });
        assert!(std::process::Command::new(rustc)
            .arg(Path::new(env!("CARGO_MANIFEST_DIR")).join("tests/fixtures/fake_pocket_tts.rs"))
            .arg("-o")
            .arg(&fake)
            .status()
            .unwrap()
            .success());
        fake
    }

    fn archive_with(path: &Path, entry_name: &str, contents: &[u8]) {
        if cfg!(windows) {
            let mut zip = zip::ZipWriter::new(File::create(path).unwrap());
            zip.start_file(entry_name, zip::write::SimpleFileOptions::default())
                .unwrap();
            zip.write_all(contents).unwrap();
            zip.finish().unwrap();
        } else {
            let encoder = flate2::write::GzEncoder::new(
                File::create(path).unwrap(),
                flate2::Compression::default(),
            );
            let mut archive = tar::Builder::new(encoder);
            let mut header = tar::Header::new_gnu();
            header.set_size(contents.len() as u64);
            header.set_mode(0o755);
            header.set_cksum();
            archive
                .append_data(&mut header, entry_name, contents)
                .unwrap();
            archive.into_inner().unwrap().finish().unwrap();
        }
    }

    #[test]
    fn manifest_pins_pocket_tts_with_mit_license_per_platform() {
        let item = manifest()
            .into_iter()
            .find(|c| c.id == "pocket-tts")
            .unwrap();
        assert_eq!(item.license, "MIT");
        assert_eq!(item.version, "3.3.0");
        assert!(item
            .url
            .starts_with("https://github.com/kyutai-labs/pocket-tts/releases/download/v4.0.1/"));
        assert_eq!(item.sha256.len(), 64);
        assert!(item.sha256.bytes().all(|b| b.is_ascii_hexdigit()));
        assert_eq!(
            item.source_url,
            "https://github.com/kyutai-labs/pocket-tts/tree/v4.0.1"
        );
    }

    #[test]
    fn fake_pocket_tts_installs_reports_version_and_hides_paths() {
        let root = root();
        let dir = root.join("components");
        fs::create_dir_all(&dir).unwrap();
        let fake = build_fake(&root);
        let settings = Settings {
            data_dir: root.clone(),
            cache_dir: root.join("cache"),
            cache_limit_bytes: 1,
            ffmpeg_path: None,
        };
        assert!(diagnostic_components_for(&settings).contains("pocket-tts: não instalado"));
        let exe = pocket_tts_file(&settings);
        assert!(!exe.is_file());
        let name = if cfg!(windows) {
            "pocket-tts-3.3.0-x86_64-pc-windows-msvc/pocket-tts.exe"
        } else {
            "pocket-tts-3.3.0-x86_64-unknown-linux-gnu/pocket-tts"
        };
        let bad = dir.join("bad-archive");
        archive_with(&bad, "LICENSE", b"MIT");
        assert_eq!(install_pocket_tts(&bad, &exe).unwrap_err().code, "install");
        assert!(!exe.is_file() && !exe.with_extension("installing").exists());

        let good = dir.join("good-archive");
        archive_with(&good, name, &fs::read(&fake).unwrap());
        install_pocket_tts(&good, &exe).unwrap();
        assert_eq!(pocket_tts_version(&exe).as_deref(), Some("3.3.0"));
        let report = diagnostic_components_for(&settings);
        assert!(report.contains("pocket-tts: 3.3.0"));
        assert!(!report.contains(root.to_str().unwrap()));
        fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn download_item_emits_sanitized_console_events_without_tokens_or_personal_paths() {
        use std::io::{BufRead, BufReader};
        use std::net::TcpListener;

        let dir = tempfile::tempdir().unwrap();
        let _guard = crate::test_env::set_data_dir(dir.path());

        let payload = b"fake-yt-dlp-binary-payload".to_vec();
        let mut hasher = Sha256::new();
        hasher.update(&payload);
        let sha = format!("{:x}", hasher.finalize());

        let listener = TcpListener::bind("127.0.0.1:0").unwrap();
        let addr = listener.local_addr().unwrap();
        let body = payload.clone();
        let server = std::thread::spawn(move || {
            if let Ok((mut stream, _)) = listener.accept() {
                stream.set_nonblocking(false).unwrap();
                let mut reader = BufReader::new(stream.try_clone().unwrap());
                let mut line = String::new();
                while reader.read_line(&mut line).unwrap_or(0) > 0 {
                    if line == "\r\n" || line == "\n" {
                        break;
                    }
                    line.clear();
                }
                let header = format!(
                    "HTTP/1.1 200 OK\r\nContent-Length: {}\r\nConnection: close\r\n\r\n",
                    body.len()
                );
                let _ = stream.write_all(header.as_bytes());
                let _ = stream.write_all(&body);
                let _ = stream.flush();
            }
        });

        let url = format!("http://{addr}/yt-dlp?token=supersecret123&sig=abc999");
        let item = Component {
            id: "yt-dlp",
            version: "2026.11.01",
            license: "Unlicense",
            source_url: "https://example.com",
            build_source_url: None,
            url: Box::leak(url.into_boxed_str()),
            sha256: Box::leak(sha.into_boxed_str()),
            size: payload.len() as u64,
        };

        let flag = AtomicBool::new(false);
        let res = download_item(&item, &flag, "yt-dlp-console-test", &mut |_| {});
        let _ = server.join();
        assert!(res.is_ok(), "download_item failed: {res:?}");

        let hist = crate::dispatch("console.history", json!({}), &mut |_| {}).unwrap();
        let events: Vec<_> = hist["items"]
            .as_array()
            .unwrap()
            .iter()
            .filter(|e| e["job"] == "yt-dlp-console-test")
            .collect();
        assert!(events.len() >= 3);
        assert!(events.iter().all(|e| e["origin"] == "component"));
        let joined = serde_json::to_string(&events).unwrap();
        assert!(!joined.contains("supersecret123"));
        assert!(!joined.contains("abc999"));
        assert!(!joined.contains("?token="));
    }
}
