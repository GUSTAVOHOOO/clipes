use super::*;
use pgp::{
    composed::{Deserializable, SignedPublicKey},
    types::KeyDetails,
};
use std::{thread, time::Duration};

const FINGERPRINT: &str = "AC0CBBE6848D6A873464AF4E57CF65933B5A7581";
const KEY: &str = include_str!("../../assets/yt-dlp-public.key");
const ORIGIN: &str = "SHA2-256SUMS assinado por yt-dlp";

#[derive(Serialize, Deserialize)]
struct Installed {
    version: String,
    sha256: String,
    origin: String,
}
fn state_path(exe: &Path) -> PathBuf {
    exe.with_file_name("yt-dlp.state.json")
}
fn checksum(path: &Path, flag: &AtomicBool) -> Result<String, CoreError> {
    let mut file = File::open(path)
        .map_err(|_| error("update_io", "Não foi possível verificar o Componente"))?;
    let mut sha = Sha256::new();
    let mut buf = [0u8; 65536];
    loop {
        if flag.load(Ordering::Relaxed) {
            return Err(error("cancelled", "Atualização cancelada"));
        }
        let n = file
            .read(&mut buf)
            .map_err(|_| error("update_io", "Não foi possível verificar o Componente"))?;
        if n == 0 {
            break;
        }
        sha.update(&buf[..n]);
    }
    Ok(format!("{:x}", sha.finalize()))
}
fn version_tuple(v: &str) -> Option<Vec<u32>> {
    v.split('.').map(|s| s.parse().ok()).collect()
}
pub(super) fn installed(exe: &Path) -> Result<String, CoreError> {
    let item = manifest()
        .into_iter()
        .find(|c| c.id == "yt-dlp")
        .ok_or_else(|| error("component_missing", "Componente yt-dlp indisponível"))?;
    let hash = checksum(exe, &AtomicBool::new(false))
        .map_err(|_| error("component_missing", "Instale o Componente yt-dlp"))?;
    if hash == item.sha256 {
        return Ok(item.version.into());
    }
    let state: Installed = fs::read(state_path(exe))
        .ok()
        .and_then(|b| serde_json::from_slice(&b).ok())
        .ok_or_else(|| {
            error(
                "component_integrity",
                "Integridade do yt-dlp não confere; reinstale o Componente",
            )
        })?;
    if state.origin != ORIGIN
        || state.sha256 != hash
        || version_tuple(&state.version)
            .zip(version_tuple(item.version))
            .is_none_or(|(a, b)| a < b)
    {
        return Err(error(
            "component_integrity",
            "Integridade do yt-dlp não confere; reinstale o Componente",
        ));
    }
    Ok(state.version)
}
fn pinned_key() -> Result<SignedPublicKey, CoreError> {
    let (key, _) = SignedPublicKey::from_string(KEY)
        .map_err(|_| error("update_key", "Chave de atualização inválida"))?;
    let fingerprint = key
        .primary_key
        .fingerprint()
        .as_bytes()
        .iter()
        .map(|b| format!("{b:02X}"))
        .collect::<String>();
    if fingerprint != FINGERPRINT {
        return Err(error("update_key", "Chave de atualização inválida"));
    }
    Ok(key)
}
fn component_path() -> Result<PathBuf, CoreError> {
    let dir = load_settings()
        .map_err(|_| error("settings", "Não foi possível ler as configurações"))?
        .data_dir
        .join("components");
    Ok(dir.join(if cfg!(windows) {
        "yt-dlp.exe"
    } else {
        "yt-dlp"
    }))
}
fn status(_: Value, _: &mut EventSink<'_>) -> CommandResult {
    let exe = component_path()?;
    if !exe.exists() {
        return Ok(json!({"installed":false}));
    }
    Ok(json!({"installed":true,"version":installed(&exe)?}))
}
fn request(
    client: &reqwest::blocking::Client,
    url: &str,
) -> Result<reqwest::blocking::Response, CoreError> {
    client
        .get(url)
        .send()
        .and_then(|r| r.error_for_status())
        .map_err(|_| error("update_network", "Não foi possível consultar a atualização"))
}
fn limited(
    mut response: reqwest::blocking::Response,
    max: u64,
    flag: &AtomicBool,
) -> Result<Vec<u8>, CoreError> {
    let mut bytes = Vec::new();
    let mut chunk = [0; 8192];
    loop {
        if flag.load(Ordering::Relaxed) {
            return Err(error("cancelled", "Atualização cancelada"));
        }
        let n = response
            .read(&mut chunk)
            .map_err(|_| error("update_network", "Não foi possível baixar a atualização"))?;
        if n == 0 {
            break;
        }
        if bytes.len() as u64 + n as u64 > max {
            return Err(error("update_network", "Resposta de atualização inválida"));
        }
        bytes.extend_from_slice(&chunk[..n]);
    }
    Ok(bytes)
}
fn update(v: Value, events: &mut EventSink<'_>) -> CommandResult {
    if v["confirmed"] != true {
        return Err(error(
            "confirmation_required",
            "Confirme a atualização antes de iniciar",
        ));
    }
    let flag = Arc::new(AtomicBool::new(false));
    {
        let mut map = jobs().lock().unwrap();
        if map.contains_key("yt-dlp") {
            return Err(error(
                "already_downloading",
                "Operação do yt-dlp em andamento",
            ));
        }
        map.insert("yt-dlp".into(), flag.clone());
    }
    let result = update_inner(&flag, events);
    jobs().lock().unwrap().remove("yt-dlp");
    result
}
fn update_inner(flag: &AtomicBool, events: &mut EventSink<'_>) -> CommandResult {
    let exe = component_path()?;
    let current = installed(&exe)?;
    let key = pinned_key()?;
    let client = reqwest::blocking::Client::builder()
        .user_agent("Clipes-yt-dlp-update")
        .timeout(Duration::from_secs(30))
        .build()
        .map_err(|_| error("update_network", "Não foi possível consultar a atualização"))?;
    let api = "https://api.github.com/repos/yt-dlp/yt-dlp-nightly-builds/releases/latest";
    let data = limited(request(&client, api)?, 1_000_000, flag)?;
    let release: Value = serde_json::from_slice(&data)
        .map_err(|_| error("update_network", "Resposta de atualização inválida"))?;
    let tag = release["tag_name"]
        .as_str()
        .filter(|s| version_tuple(s).is_some() && !s.is_empty())
        .ok_or_else(|| error("update_network", "Versão de atualização inválida"))?;
    if version_tuple(tag) <= version_tuple(&current) {
        return Ok(json!({"version":current,"up_to_date":true}));
    }
    let asset = if cfg!(windows) {
        "yt-dlp.exe"
    } else {
        "yt-dlp_linux"
    };
    let base = format!("https://github.com/yt-dlp/yt-dlp-nightly-builds/releases/download/{tag}");
    let sums = limited(
        request(&client, &format!("{base}/SHA2-256SUMS"))?,
        1_000_000,
        flag,
    )?;
    let sig = limited(
        request(&client, &format!("{base}/SHA2-256SUMS.sig"))?,
        1_000_000,
        flag,
    )?;
    let hash = verified_checksum(&key.primary_key, &sums, &sig, asset)?;
    let mut response = request(&client, &format!("{base}/{asset}"))?;
    let size = response.content_length();
    let temp = exe.with_file_name("yt-dlp.update.part");
    let result = (|| {
        let mut file = File::create(&temp)
            .map_err(|_| error("update_io", "Não foi possível preparar a atualização"))?;
        let mut count = 0u64;
        let mut buf = [0; 65536];
        loop {
            if flag.load(Ordering::Relaxed) {
                return Err(error("cancelled", "Atualização cancelada"));
            }
            let n = response
                .read(&mut buf)
                .map_err(|_| error("update_network", "Não foi possível baixar a atualização"))?;
            if n == 0 {
                break;
            }
            file.write_all(&buf[..n])
                .map_err(|_| error("update_io", "Não foi possível preparar a atualização"))?;
            count += n as u64;
            events(ProgressEvent {
                project: None,
                job: "yt-dlp".into(),
                stage: "update".into(),
                percentage: size
                    .filter(|s| *s > 0)
                    .map_or(0, |s| (count.saturating_mul(100) / s).min(99) as u8),
                message: "Atualizando yt-dlp".into(),
                error: None,
            });
        }
        file.flush()
            .map_err(|_| error("update_io", "Não foi possível preparar a atualização"))?;
        drop(file);
        install_update(&exe, &temp, tag, &hash, flag)?;
        events(ProgressEvent {
            project: None,
            job: "yt-dlp".into(),
            stage: "complete".into(),
            percentage: 100,
            message: "yt-dlp atualizado".into(),
            error: None,
        });
        Ok(json!({"version":tag}))
    })();
    let _ = fs::remove_file(temp);
    result
}
fn install_update(
    exe: &Path,
    temp: &Path,
    version: &str,
    expected: &str,
    flag: &AtomicBool,
) -> Result<(), CoreError> {
    if checksum(temp, flag)? != expected {
        return Err(error("hash_mismatch", "O hash da atualização não confere"));
    }
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        fs::set_permissions(temp, fs::Permissions::from_mode(0o755))
            .map_err(|_| error("update_io", "Não foi possível preparar a atualização"))?;
    }
    let backup = exe.with_file_name("yt-dlp.update.backup");
    fs::copy(exe, &backup)
        .map_err(|_| error("update_io", "Não foi possível preservar o Componente"))?;
    let fail = || error("update_failed", "Não foi possível instalar a atualização");
    let mut removed = false;
    let result = (|| {
        if flag.load(Ordering::Relaxed) {
            return Err(error("cancelled", "Atualização cancelada"));
        }
        fs::remove_file(exe).map_err(|_| fail())?;
        removed = true;
        fs::rename(temp, exe).map_err(|_| fail())?;
        let mut child = crate::process::spawn(exe, ["--version"], None).map_err(|_| fail())?;
        let stdout = child.stdout.take().ok_or_else(fail)?;
        let stderr = child.stderr.take().ok_or_else(fail)?;
        let reader = thread::spawn(move || {
            let mut text = String::new();
            let _ = std::io::Read::take(stdout, 1024).read_to_string(&mut text);
            text
        });
        let errors = thread::spawn(move || {
            let _ = std::io::copy(&mut std::io::Read::take(stderr, 4096), &mut std::io::sink());
        });
        let status = loop {
            if flag.load(Ordering::Relaxed) {
                let _ = child.kill();
                let _ = child.wait();
                break Err(error("cancelled", "Atualização cancelada"));
            }
            match child.try_wait() {
                Ok(Some(s)) => break Ok(s),
                Ok(None) => thread::sleep(Duration::from_millis(50)),
                Err(_) => {
                    let _ = child.kill();
                    let _ = child.wait();
                    break Err(fail());
                }
            }
        };
        let printed = reader.join().unwrap_or_default();
        let _ = errors.join();
        if !status?.success() || printed.trim() != version {
            return Err(fail());
        }
        if flag.load(Ordering::Relaxed) {
            return Err(error("cancelled", "Atualização cancelada"));
        }
        let state = Installed {
            version: version.into(),
            sha256: expected.into(),
            origin: ORIGIN.into(),
        };
        let state_path = state_path(exe);
        let pending = exe.with_file_name("yt-dlp.state.pending");
        let previous = exe.with_file_name("yt-dlp.state.backup");
        if fs::write(&pending, serde_json::to_vec(&state).unwrap()).is_err() {
            let _ = fs::remove_file(&pending);
            return Err(fail());
        }
        let had_state = state_path.exists();
        if had_state {
            if fs::rename(&state_path, &previous).is_err() {
                let _ = fs::remove_file(&pending);
                return Err(fail());
            }
        }
        if fs::rename(&pending, &state_path).is_err() {
            if had_state {
                let _ = fs::rename(&previous, &state_path);
            }
            let _ = fs::remove_file(&pending);
            return Err(fail());
        }
        if had_state {
            let _ = fs::remove_file(previous);
        }
        Ok(())
    })();
    if result.is_err() && removed {
        if exe.exists() {
            let _ = fs::remove_file(exe);
        }
        if fs::rename(&backup, exe).is_err() {
            return Err(error(
                "update_restore",
                "Não foi possível restaurar o yt-dlp anterior",
            ));
        }
    } else {
        let _ = fs::remove_file(&backup);
    }
    result
}
inventory::submit! { CommandRegistration { name:"components.ytdlp.status", execute:status } }
inventory::submit! { CommandRegistration { name:"components.ytdlp.update", execute:update } }

#[cfg(test)]
mod tests {
    use super::*;
    use std::{
        process::Command,
        time::{SystemTime, UNIX_EPOCH},
    };
    #[test]
    fn official_key_matches_pinned_fingerprint() {
        pinned_key().unwrap();
    }
    #[test]
    fn verified_update_persists_hash_and_restores_on_failures_and_cancellation() {
        let root = std::env::temp_dir().join(format!(
            "clipes-update-test-{}-{}",
            std::process::id(),
            SystemTime::now()
                .duration_since(UNIX_EPOCH)
                .unwrap()
                .as_nanos()
        ));
        fs::create_dir_all(&root).unwrap();
        let exe = root.join(if cfg!(windows) {
            "yt-dlp.exe"
        } else {
            "yt-dlp"
        });
        let temp = root.join("new");
        let rustc = PathBuf::from(env!("CARGO")).with_file_name(if cfg!(windows) {
            "rustc.exe"
        } else {
            "rustc"
        });
        assert!(Command::new(rustc)
            .arg(Path::new(env!("CARGO_MANIFEST_DIR")).join("tests/fixtures/fake_ytdlp.rs"))
            .arg("-o")
            .arg(&exe)
            .status()
            .unwrap()
            .success());
        let original = fs::read(&exe).unwrap();
        fs::copy(&exe, &temp).unwrap();
        let flag = AtomicBool::new(false);
        let hash = checksum(&temp, &flag).unwrap();
        assert_eq!(
            install_update(&exe, &temp, "2027.01.01.000000", &"0".repeat(64), &flag)
                .unwrap_err()
                .code,
            "hash_mismatch"
        );
        assert_eq!(fs::read(&exe).unwrap(), original);
        fs::write(&temp, b"broken executable").unwrap();
        let bad = checksum(&temp, &flag).unwrap();
        assert_eq!(
            install_update(&exe, &temp, "2027.01.01.000000", &bad, &flag)
                .unwrap_err()
                .code,
            "update_failed"
        );
        assert_eq!(fs::read(&exe).unwrap(), original);
        fs::copy(&exe, &temp).unwrap();
        fs::write(root.join("version-hang"), b"").unwrap();
        thread::scope(|scope| {
            scope.spawn(|| {
                thread::sleep(Duration::from_millis(300));
                flag.store(true, Ordering::Relaxed);
            });
            assert_eq!(
                install_update(&exe, &temp, "2027.01.01.000000", &hash, &flag)
                    .unwrap_err()
                    .code,
                "cancelled"
            );
        });
        assert_eq!(fs::read(&exe).unwrap(), original);
        fs::remove_file(root.join("version-hang")).unwrap();
        fs::copy(&exe, &temp).unwrap();
        flag.store(false, Ordering::Relaxed);
        install_update(&exe, &temp, "2027.01.01.000000", &hash, &flag).unwrap();
        let saved: Installed =
            serde_json::from_slice(&fs::read(state_path(&exe)).unwrap()).unwrap();
        assert_eq!(saved.version, "2027.01.01.000000");
        assert_eq!(saved.sha256, hash);
        assert_eq!(installed(&exe).unwrap(), saved.version);
        let previous_state = fs::read(state_path(&exe)).unwrap();
        fs::write(&temp, b"broken again").unwrap();
        let bad = checksum(&temp, &flag).unwrap();
        assert_eq!(
            install_update(&exe, &temp, "2028.01.01.000000", &bad, &flag)
                .unwrap_err()
                .code,
            "update_failed"
        );
        assert_eq!(fs::read(state_path(&exe)).unwrap(), previous_state);
        assert_eq!(installed(&exe).unwrap(), saved.version);

        fs::write(&exe, b"tampered").unwrap();
        assert_eq!(installed(&exe).unwrap_err().code, "component_integrity");
        fs::remove_dir_all(root).unwrap();
    }
}
