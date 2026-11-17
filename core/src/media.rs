//! Protocolo de mídia do preview (#58): serve arquivos de proxy do cache e da Fonte registrada,
//! com `Range`, sem Tauri. O adaptador (`src-tauri`) só traduz a requisição HTTP.
//!
//! O recurso é um identificador opaco, nunca um caminho: `proxy/<chave hex de 64>` ou
//! `source/<id da Fonte>`. Qualquer outra forma responde 404 antes de tocar o disco.
use crate::projects;
use std::{
    fs::{self, File},
    io::{Read, Seek, SeekFrom},
    path::{Path, PathBuf},
    time::SystemTime,
};

/// Teto de bytes por resposta. O WebView aceita 206 menor que o pedido e volta a pedir; assim
/// `bytes=0-` numa Fonte de várias horas nunca carrega o arquivo inteiro na memória.
pub const MAX_RESPONSE_BYTES: u64 = 8 * 1024 * 1024;

/// Resposta já pronta para o adaptador HTTP.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct MediaResponse {
    pub status: u16,
    pub headers: Vec<(&'static str, String)>,
    pub body: Vec<u8>,
}

/// Recurso pedido, depois de validar o formato do identificador.
#[derive(Debug, PartialEq, Eq)]
pub(crate) enum Resource {
    Proxy(String),
    /// Sprite de miniaturas da timeline (#61), na pasta do proxy.
    Thumbs(String),
    Source(i64),
    /// Áudio WAV da Narração por bloco (#79), dentro da pasta do Projeto.
    Narration(i64),
    /// Trilha sonora ou efeito sonoro importado pelo usuário (#154), dentro da pasta `audio/` do Projeto.
    Audio(i64),
}

/// Aceita só `proxy/<64 hex minúsculo>`, `thumbs/<64 hex>`, `source/<dígitos>`,
/// `narration/<dígitos>` e `audio/<dígitos>`; `%2F` (como o WebView codifica a barra com `convertFileSrc`) vale como `/`.
pub(crate) fn parse_resource(raw: &str) -> Option<Resource> {
    let raw = raw.strip_prefix('/').unwrap_or(raw);
    let decoded = raw.replace("%2F", "/").replace("%2f", "/");
    let (kind, id) = decoded.split_once('/')?;
    match kind {
        "proxy" if id.len() == 64 && id.bytes().all(|b| matches!(b, b'0'..=b'9' | b'a'..=b'f')) => {
            Some(Resource::Proxy(id.to_owned()))
        }
        "thumbs"
            if id.len() == 64 && id.bytes().all(|b| matches!(b, b'0'..=b'9' | b'a'..=b'f')) =>
        {
            Some(Resource::Thumbs(id.to_owned()))
        }
        "source" if !id.is_empty() && id.len() <= 18 && id.bytes().all(|b| b.is_ascii_digit()) => {
            id.parse().ok().map(Resource::Source)
        }
        "narration"
            if !id.is_empty() && id.len() <= 18 && id.bytes().all(|b| b.is_ascii_digit()) =>
        {
            id.parse().ok().map(Resource::Narration)
        }
        "audio" if !id.is_empty() && id.len() <= 18 && id.bytes().all(|b| b.is_ascii_digit()) => {
            id.parse().ok().map(Resource::Audio)
        }
        _ => None,
    }
}

/// Resultado da leitura do cabeçalho `Range`.
#[derive(Debug, PartialEq, Eq)]
pub(crate) enum ByteRange {
    /// Sem cabeçalho: o arquivo (limitado ao teto).
    Whole,
    /// Intervalo inclusivo, já dentro do arquivo.
    Bytes(u64, u64),
    /// Malformado, múltiplo ou fora do arquivo.
    Unsatisfiable,
}

pub(crate) fn parse_range(header: Option<&str>, len: u64) -> ByteRange {
    let Some(header) = header else {
        return ByteRange::Whole;
    };
    let Some(spec) = header.trim().strip_prefix("bytes=") else {
        return ByteRange::Unsatisfiable;
    };
    if spec.contains(',') || len == 0 {
        return ByteRange::Unsatisfiable;
    }
    let Some((first, last)) = spec.trim().split_once('-') else {
        return ByteRange::Unsatisfiable;
    };
    let number = |s: &str| {
        (!s.is_empty() && s.bytes().all(|b| b.is_ascii_digit()))
            .then(|| s.parse::<u64>().ok())
            .flatten()
    };
    match (first.trim(), last.trim()) {
        ("", suffix) => match number(suffix) {
            Some(n) if n > 0 => ByteRange::Bytes(len - n.min(len), len - 1),
            _ => ByteRange::Unsatisfiable,
        },
        (first, "") => match number(first) {
            Some(start) if start < len => ByteRange::Bytes(start, len - 1),
            _ => ByteRange::Unsatisfiable,
        },
        (first, last) => match (number(first), number(last)) {
            (Some(start), Some(end)) if start <= end && start < len => {
                ByteRange::Bytes(start, end.min(len - 1))
            }
            _ => ByteRange::Unsatisfiable,
        },
    }
}

fn respond(status: u16, mut headers: Vec<(&'static str, String)>, body: Vec<u8>) -> MediaResponse {
    headers.push(("Cache-Control", "no-store".into()));
    headers.push(("X-Content-Type-Options", "nosniff".into()));
    MediaResponse {
        status,
        headers,
        body,
    }
}
fn not_found() -> MediaResponse {
    respond(404, vec![("Content-Length", "0".into())], Vec::new())
}

fn content_type(path: &Path) -> &'static str {
    match path
        .extension()
        .and_then(|e| e.to_str())
        .map(str::to_ascii_lowercase)
        .as_deref()
    {
        Some("mp4" | "m4v") => "video/mp4",
        Some("webm") => "video/webm",
        Some("jpg") => "image/jpeg",
        Some("mkv") => "video/x-matroska",
        Some("mov") => "video/quicktime",
        Some("wav") => "audio/wav",
        Some("mp3") => "audio/mpeg",
        Some("m4a" | "aac") => "audio/mp4",
        Some("ogg" | "opus") => "audio/ogg",
        Some("flac") => "audio/flac",
        _ => "application/octet-stream",
    }
}

/// Arquivo de um proxy pronto, dentro do cache. A chave hex já impede `..`; a checagem do
/// caminho canônico é a segunda barreira.
pub(crate) fn proxy_path(key: &str) -> Option<PathBuf> {
    let (cache, _, _) = crate::components::cache_settings().ok()?;
    let root = cache.join("proxies").canonicalize().ok()?;
    let file = root
        .join(key)
        .join(crate::proxy::FILE_NAME)
        .canonicalize()
        .ok()?;
    (file.starts_with(&root) && file.is_file()).then_some(file)
}

/// Sprite de miniaturas pronto de um proxy, dentro do cache.
pub(crate) fn thumbs_path(key: &str) -> Option<PathBuf> {
    let (cache, _, _) = crate::components::cache_settings().ok()?;
    let root = cache.join("proxies").canonicalize().ok()?;
    let file = root
        .join(key)
        .join(crate::editor::assets::THUMBS_FILE)
        .canonicalize()
        .ok()?;
    (file.starts_with(&root) && file.is_file()).then_some(file)
}

fn source_path(id: i64) -> Option<PathBuf> {
    let project = crate::dispatch("projects.current", serde_json::json!({}), &mut |_| {}).ok()?;
    let project = PathBuf::from(project["path"].as_str()?);
    let stored: String = projects::with_reader(|c| {
        c.query_row("SELECT path FROM sources WHERE id=?1", [id], |r| r.get(0))
    })
    .ok()?;
    let stored = PathBuf::from(stored);
    let is_relative = stored.is_relative();
    let path = if is_relative {
        project.join(stored)
    } else {
        stored
    };
    let canonical = path.canonicalize().ok()?;
    if is_relative {
        let root = project.canonicalize().ok()?;
        if !canonical.starts_with(&root) {
            return None;
        }
    }
    canonical.is_file().then_some(canonical)
}

pub(crate) fn touch(path: &Path) {
    if let Ok(file) = fs::OpenOptions::new().write(true).open(path) {
        let _ = file.set_times(fs::FileTimes::new().set_modified(SystemTime::now()));
    }
}

/// Metadados de um recurso de mídia já validado e resolvido para caminho canônico no disco.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ResolvedMedia {
    pub path: PathBuf,
    pub len: u64,
    pub content_type: &'static str,
    pub cached: bool,
}

impl ResolvedMedia {
    /// Atualiza o mtime para o LRU do cache quando o recurso vem da pasta de proxies.
    pub fn mark_used(&self) {
        if self.cached {
            touch(&self.path);
        }
    }
}

/// Valida o identificador opaco e resolve o caminho canônico do arquivo no Projeto aberto ou cache.
pub fn resolve(resource: &str) -> Option<ResolvedMedia> {
    let (path, cached) = match parse_resource(resource) {
        Some(Resource::Proxy(key)) => (proxy_path(&key), true),
        Some(Resource::Thumbs(key)) => (thumbs_path(&key), true),
        Some(Resource::Source(id)) => (source_path(id), false),
        Some(Resource::Narration(id)) => (crate::tts::narration::media_audio_path(id), false),
        Some(Resource::Audio(id)) => (crate::audio::media_audio_path(id), false),
        None => (None, false),
    };
    let path = path?;
    let len = fs::metadata(&path).ok()?.len();
    Some(ResolvedMedia {
        content_type: content_type(&path),
        path,
        len,
        cached,
    })
}

/// Serve `resource` com o cabeçalho `Range` opcional.
pub fn serve(resource: &str, range: Option<&str>) -> MediaResponse {
    let Some(resolved) = resolve(resource) else {
        return not_found();
    };
    let Ok(mut file) = File::open(&resolved.path) else {
        return not_found();
    };
    let len = resolved.len;
    let kind = resolved.content_type;
    let (status, start, end) = match parse_range(range, len) {
        ByteRange::Unsatisfiable => {
            return respond(
                416,
                vec![
                    ("Content-Range", format!("bytes */{len}")),
                    ("Accept-Ranges", "bytes".into()),
                    ("Content-Length", "0".into()),
                ],
                Vec::new(),
            )
        }
        ByteRange::Whole if len <= MAX_RESPONSE_BYTES => (200, 0, len.saturating_sub(1)),
        ByteRange::Whole => (206, 0, MAX_RESPONSE_BYTES - 1),
        ByteRange::Bytes(start, end) => (206, start, end.min(start + MAX_RESPONSE_BYTES - 1)),
    };
    let count = if len == 0 { 0 } else { end - start + 1 };
    let mut body = vec![0u8; count as usize];
    if file.seek(SeekFrom::Start(start)).is_err() || file.read_exact(&mut body).is_err() {
        return not_found();
    }
    if resolved.cached {
        // Uso recente para o LRU, inclusive ao buscar no meio. Nunca altera a Fonte.
        resolved.mark_used();
    }
    let mut headers = vec![
        ("Content-Type", kind.to_owned()),
        ("Accept-Ranges", "bytes".into()),
        ("Content-Length", count.to_string()),
    ];
    if status == 206 {
        headers.push(("Content-Range", format!("bytes {start}-{end}/{len}")));
    }
    respond(status, headers, body)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn resource_accepts_only_opaque_ids() {
        let key = "a".repeat(64);
        assert_eq!(
            parse_resource(&format!("proxy/{key}")),
            Some(Resource::Proxy(key.clone()))
        );
        assert_eq!(
            parse_resource(&format!("/proxy%2F{key}")),
            Some(Resource::Proxy(key.clone()))
        );
        assert_eq!(parse_resource("source/12"), Some(Resource::Source(12)));
        for bad in [
            "",
            "proxy/",
            "proxy/..",
            "proxy/../../secret",
            "source/../1",
            "source/-1",
            "source/1/extra",
            "source/1.mp4",
            "source/",
            "..%2F..%2Fetc%2Fpasswd",
            "%2e%2e/secret",
            "proxy/%2e%2e%2f%2e%2e%2fsecret",
            "C:/Windows/win.ini",
            "C:\\Windows\\win.ini",
            "/etc/passwd",
            "proxy\\..\\x",
            "file/1",
        ] {
            assert_eq!(parse_resource(bad), None, "{bad}");
        }
        assert_eq!(parse_resource(&format!("proxy/{}", "A".repeat(64))), None);
        assert_eq!(parse_resource(&format!("proxy/{}/x", key)), None);
        assert_eq!(parse_resource(&format!("proxy/{}", "a".repeat(63))), None);
        assert_eq!(parse_resource(&format!("proxy/{}", "a".repeat(65))), None);
        assert_eq!(parse_resource("source/99999999999999999999"), None);
    }

    #[test]
    fn range_forms_and_limits() {
        assert_eq!(parse_range(None, 100), ByteRange::Whole);
        assert_eq!(parse_range(Some("bytes=0-9"), 100), ByteRange::Bytes(0, 9));
        assert_eq!(
            parse_range(Some("bytes=10-"), 100),
            ByteRange::Bytes(10, 99)
        );
        assert_eq!(
            parse_range(Some("bytes=-10"), 100),
            ByteRange::Bytes(90, 99)
        );
        assert_eq!(
            parse_range(Some("bytes=-500"), 100),
            ByteRange::Bytes(0, 99)
        );
        assert_eq!(
            parse_range(Some("bytes=90-500"), 100),
            ByteRange::Bytes(90, 99)
        );
        assert_eq!(
            parse_range(Some("bytes=99-99"), 100),
            ByteRange::Bytes(99, 99)
        );
        for bad in [
            "bytes=100-",
            "bytes=200-300",
            "bytes=9-0",
            "bytes=-0",
            "bytes=-",
            "bytes=a-b",
            "bytes=0-1,5-6",
            "items=0-1",
            "0-1",
            "bytes=",
            "bytes=1",
            "bytes=-1-2",
        ] {
            assert_eq!(
                parse_range(Some(bad), 100),
                ByteRange::Unsatisfiable,
                "{bad}"
            );
        }
        assert_eq!(parse_range(Some("bytes=0-"), 0), ByteRange::Unsatisfiable);
    }

    #[test]
    fn source_rejects_relative_escape_symlinks_and_closed_project() {
        let tmp = tempfile::tempdir().unwrap();
        let _guard = crate::test_env::set_data_dir(tmp.path());

        let project = crate::dispatch(
            "projects.create",
            serde_json::json!({"parent": tmp.path(), "name": "MidiaProj"}),
            &mut |_| {},
        )
        .unwrap();
        let proj_dir = PathBuf::from(project["path"].as_str().unwrap());
        fs::create_dir_all(proj_dir.join("media")).unwrap();
        fs::write(proj_dir.join("media/ok.mp4"), b"mp4bytes").unwrap();
        fs::write(tmp.path().join("outside.mp4"), b"secreto").unwrap();

        projects::with_writer(|c| {
            c.execute(
                "INSERT INTO sources (id, path, size, duration_us, partial_hash, metadata, permission, audio_track) VALUES (1, 'media/ok.mp4', 8, 1000, 'h', '{}', '{}', 1)",
                [],
            )?;
            c.execute(
                "INSERT INTO sources (id, path, size, duration_us, partial_hash, metadata, permission, audio_track) VALUES (2, '../outside.mp4', 7, 1000, 'h', '{}', '{}', 1)",
                [],
            )?;
            Ok(())
        })
        .unwrap();

        assert_eq!(serve("source/1", None).status, 200);
        assert_eq!(serve("source/2", None).status, 404);

        #[cfg(unix)]
        {
            std::os::unix::fs::symlink(
                tmp.path().join("outside.mp4"),
                proj_dir.join("media/escape.mp4"),
            )
            .unwrap();
            projects::with_writer(|c| {
                c.execute(
                    "INSERT INTO sources (id, path, size, duration_us, partial_hash, metadata, permission, audio_track) VALUES (3, 'media/escape.mp4', 7, 1000, 'h', '{}', '{}', 1)",
                    [],
                )?;
                Ok(())
            })
            .unwrap();
            assert_eq!(serve("source/3", None).status, 404);
        }

        crate::dispatch("projects.close", serde_json::json!({}), &mut |_| {}).unwrap();
        assert_eq!(serve("source/1", None).status, 404);
    }
}
