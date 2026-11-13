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
    let assets = [("ffmpeg", "N-128889-g88c46fce27", "https://github.com/FFmpeg-Builds/FFmpeg-Builds/releases/download/autobuild-2026-11-13-12-43/ffmpeg-N-128889-g88c46fce27-win64-gpl.zip", "35fa1c17eeead1f572072b134458788caf71c4a7fbce9e0bb2f3c41032959531", 201952396), ("yt-dlp", "2026.11.04.232659", "https://github.com/yt-dlp/yt-dlp-nightly-builds/releases/download/2026.11.04.232659/yt-dlp.exe", "85c8d440422108bee7ecd11e584d56cc04fb3bd1a0b3200bdc8a66d5c5a985fc", 23587638)];
    #[cfg(all(target_os = "linux", target_arch = "x86_64"))]
    let assets = [("ffmpeg", "N-128889-g88c46fce27", "https://github.com/FFmpeg-Builds/FFmpeg-Builds/releases/download/autobuild-2026-11-13-12-43/ffmpeg-N-128889-g88c46fce27-linux64-gpl.tar.xz", "efa8f93583e84d5a1036e7e08e19db9f03ca637d7620ed58b0ecca39e9e34323", 157401784), ("yt-dlp", "2026.11.04.232659", "https://github.com/yt-dlp/yt-dlp-nightly-builds/releases/download/2026.11.04.232659/yt-dlp_linux", "16e96c02ffefd0bd1fe8ae6cc943b16c96e575c29eed7038d15213034437bc34", 41179568)];
    #[cfg(not(any(
        all(target_os = "windows", target_arch = "x86_64"),
        all(target_os = "linux", target_arch = "x86_64")
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
            license: if id == "ffmpeg" {
                "GPL-3.0-or-later"
            } else {
                "Unlicense"
            },
            build_source_url: if id == "ffmpeg" { Some("https://github.com/FFmpeg-Builds/FFmpeg-Builds/tree/autobuild-2026-11-13-12-43") } else { None },
            source_url: if id == "ffmpeg" {
                "https://github.com/FFmpeg/FFmpeg/tree/88c46fce27"
            } else {
                "https://github.com/yt-dlp/yt-dlp-nightly-builds/tree/2026.11.04.232659"
            },
        })
        .collect()
}
fn error(code: &str, message: impl ToString) -> CoreError {
    CoreError {
        code: code.into(),
        message: message.to_string(),
    }
}
fn manifest_command(_: Value, _: &mut EventSink<'_>) -> CommandResult {
    Ok(json!(manifest()))
}

#[derive(Serialize, Deserialize)]
struct Settings {
    data_dir: PathBuf,
    cache_dir: PathBuf,
    cache_limit_bytes: u64,
    ffmpeg_path: Option<PathBuf>,
}
fn settings_path() -> Result<PathBuf, CoreError> {
    Ok(dirs::config_local_dir()
        .ok_or_else(|| error("settings", "Diretório local indisponível"))?
        .join("Clipes")
        .join("settings.json"))
}
fn default_settings() -> Result<Settings, CoreError> {
    let dir = dirs::data_local_dir()
        .ok_or_else(|| error("settings", "Diretório local indisponível"))?
        .join("Clipes");
    Ok(Settings {
        cache_dir: dir.join("cache"),
        data_dir: dir,
        cache_limit_bytes: 10_000_000_000,
        ffmpeg_path: None,
    })
}
fn load_settings() -> Result<Settings, CoreError> {
    let p = settings_path()?;
    match fs::read(p) {
        Ok(data) => serde_json::from_slice(&data).map_err(|e| error("settings", e)),
        Err(e) if e.kind() == io::ErrorKind::NotFound => default_settings(),
        Err(e) => Err(error("settings", e)),
    }
}
pub(crate) fn configured_ffmpeg() -> Option<PathBuf> {
    load_settings().ok().and_then(|s| s.ffmpeg_path)
}
fn save_settings(s: &Settings) -> Result<(), CoreError> {
    let p = settings_path()?;
    fs::create_dir_all(p.parent().unwrap()).map_err(|e| error("settings", e))?;
    fs::write(p, serde_json::to_vec_pretty(s).unwrap()).map_err(|e| error("settings", e))
}
fn settings_get(_: Value, _: &mut EventSink<'_>) -> CommandResult {
    Ok(json!(load_settings()?))
}
fn settings_set(v: Value, _: &mut EventSink<'_>) -> CommandResult {
    let s: Settings = serde_json::from_value(v).map_err(|e| error("invalid_settings", e))?;
    if !s.data_dir.is_absolute() || !s.cache_dir.is_absolute() || s.cache_limit_bytes == 0 {
        return Err(error(
            "invalid_settings",
            "Caminhos absolutos e limite positivo são obrigatórios",
        ));
    }
    save_settings(&s)?;
    Ok(json!(s))
}
fn ffmpeg_system(v: Value, _: &mut EventSink<'_>) -> CommandResult {
    let path = v.get("path").and_then(Value::as_str).unwrap_or("ffmpeg");
    let output = crate::process::spawn(path, ["-version"])
        .and_then(|child| child.wait_with_output())
        .map_err(|e| error("invalid_ffmpeg", e))?;
    let version = String::from_utf8_lossy(&output.stdout)
        .lines()
        .next()
        .unwrap_or("")
        .to_owned();
    if !output.status.success() || !version.starts_with("ffmpeg version ") {
        return Err(error("invalid_ffmpeg", "FFmpeg inválido"));
    }
    let mut s = load_settings()?;
    s.ffmpeg_path = Some(path.into());
    save_settings(&s)?;
    Ok(json!({"version": version, "path": path}))
}

static JOBS: OnceLock<Mutex<HashMap<String, Arc<AtomicBool>>>> = OnceLock::new();
fn jobs() -> &'static Mutex<HashMap<String, Arc<AtomicBool>>> {
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
    let result = (|| {
        let settings = load_settings()?;
        let dir = settings.data_dir.join("components");
        fs::create_dir_all(&dir).map_err(|e| error("download", e))?;
        let part = dir.join(format!("{}-{}.part", item.id, item.version));
        fetch(
            &item.url,
            item.sha256,
            item.size,
            &part,
            &flag,
            |percentage| {
                events(ProgressEvent {
                    job: id.into(),
                    stage: "download".into(),
                    percentage,
                    message: "Baixando componente".into(),
                    error: None,
                })
            },
        )?;
        let exe = dir.join(if cfg!(windows) {
            format!("{}.exe", item.id)
        } else {
            item.id.to_string()
        });
        install(&item, &part, &exe)?;
        if item.id == "ffmpeg" {
            let mut settings = load_settings()?;
            settings.ffmpeg_path = Some(exe.clone());
            save_settings(&settings)?;
        }
        fs::remove_file(part).map_err(|e| error("install", e))?;
        events(ProgressEvent {
            job: id.into(),
            stage: "complete".into(),
            percentage: 100,
            message: "Componente instalado".into(),
            error: None,
        });
        Ok(json!({"path": exe}))
    })();
    jobs().lock().unwrap().remove(id);
    result
}
fn fetch(
    url: &str,
    sha: &str,
    size: u64,
    path: &Path,
    cancelled: &AtomicBool,
    mut progress: impl FnMut(u8),
) -> Result<(), CoreError> {
    let client = reqwest::blocking::Client::builder()
        .build()
        .map_err(|e| error("download", e))?;
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
        progress(((offset.saturating_mul(100) / size.max(1)).min(99)) as u8);
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
    let tmp = exe.with_extension("installing");
    if item.id == "yt-dlp" {
        fs::copy(part, &tmp).map_err(|e| error("install", e))?;
    } else if cfg!(windows) {
        let mut zip = zip::ZipArchive::new(File::open(part).map_err(|e| error("install", e))?)
            .map_err(|e| error("install", e))?;
        let idx = (0..zip.len())
            .find(|i| {
                zip.by_index(*i)
                    .map(|f| f.name().ends_with("/bin/ffmpeg.exe"))
                    .unwrap_or(false)
            })
            .ok_or_else(|| error("install", "Executável FFmpeg ausente"))?;
        let mut src = zip.by_index(idx).map_err(|e| error("install", e))?;
        io::copy(
            &mut src,
            &mut File::create(&tmp).map_err(|e| error("install", e))?,
        )
        .map_err(|e| error("install", e))?;
    } else {
        let decoder = xz2::read::XzDecoder::new(File::open(part).map_err(|e| error("install", e))?);
        let mut archive = tar::Archive::new(decoder);
        let mut found = false;
        for entry in archive.entries().map_err(|e| error("install", e))? {
            let mut entry = entry.map_err(|e| error("install", e))?;
            if entry
                .path()
                .map_err(|e| error("install", e))?
                .to_string_lossy()
                .ends_with("/bin/ffmpeg")
                && entry.header().entry_type().is_file()
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
        if !found {
            return Err(error("install", "Executável FFmpeg ausente"));
        }
    }
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        fs::set_permissions(&tmp, fs::Permissions::from_mode(0o755))
            .map_err(|e| error("install", e))?;
    }
    if exe.exists() {
        fs::remove_file(exe).map_err(|e| error("install", e))?;
    }
    fs::rename(tmp, exe).map_err(|e| error("install", e))?;
    Ok(())
}
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
    fn server(response: &'static [u8]) -> (String, thread::JoinHandle<String>) {
        let listener = TcpListener::bind("127.0.0.1:0").unwrap();
        let addr = listener.local_addr().unwrap();
        let handle = thread::spawn(move || {
            let (mut s, _) = listener.accept().unwrap();
            let mut request = [0; 4096];
            let n = s.read(&mut request).unwrap();
            let request = String::from_utf8_lossy(&request[..n]).to_string();
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
        let (url, handle) =
            server(b"HTTP/1.1 200 OK\r\nContent-Length: 6\r\nConnection: close\r\n\r\nyes");
        let cancel = AtomicBool::new(false);
        assert_eq!(
            fetch(&url, &hash(b"yesyes"), 6, &p, &cancel, |_| cancel
                .store(true, Ordering::Relaxed))
            .unwrap_err()
            .code,
            "cancelled"
        );
        assert_eq!(fs::read(&p).unwrap(), b"yes");
        handle.join().unwrap();
        fs::remove_file(p).unwrap();
    }
}
