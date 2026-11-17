use std::{
    fs::File,
    io::{Read, Write},
    net::{IpAddr, Ipv4Addr, SocketAddr, TcpListener, TcpStream},
    sync::{
        atomic::{AtomicBool, Ordering},
        Arc,
    },
    time::Duration,
};

const MAX_HEADER_BYTES: usize = 16 * 1024;
const STREAM_CHUNK_BYTES: usize = 64 * 1024;

/// Origens da UI do Tauri autorizadas a fazer requisições CORS ao servidor de mídia.
pub(crate) fn is_allowed_origin(origin: &str) -> bool {
    matches!(
        origin,
        "tauri://localhost" | "http://tauri.localhost" | "https://tauri.localhost"
    ) || (cfg!(debug_assertions)
        && matches!(origin, "http://localhost:1420" | "http://127.0.0.1:1420"))
}

fn generate_session_token() -> std::io::Result<String> {
    let mut bytes = [0u8; 32];
    getrandom::getrandom(&mut bytes).map_err(|e| std::io::Error::other(e.to_string()))?;
    let mut hex = String::with_capacity(64);
    for b in bytes {
        use std::fmt::Write;
        let _ = write!(&mut hex, "{b:02x}");
    }
    Ok(hex)
}

fn constant_time_eq(a: &[u8], b: &[u8]) -> bool {
    if a.len() != b.len() {
        return false;
    }
    let mut diff = 0u8;
    for (&x, &y) in a.iter().zip(b.iter()) {
        diff |= x ^ y;
    }
    diff == 0
}

/// Servidor HTTP loopback em processo para mídia do WebKitGTK no Linux (#246).
/// Escuta apenas em `127.0.0.1:<porta aleatória>` e exige um token aleatório de sessão na URL.
pub struct MediaServer {
    addr: SocketAddr,
    token: String,
    shutdown: Arc<AtomicBool>,
    accept_thread: Option<std::thread::JoinHandle<()>>,
}

impl MediaServer {
    pub fn start() -> std::io::Result<Self> {
        let listener = TcpListener::bind((IpAddr::V4(Ipv4Addr::LOCALHOST), 0))?;
        let addr = listener.local_addr()?;
        listener.set_nonblocking(true)?;
        let token = generate_session_token()?;
        let shutdown = Arc::new(AtomicBool::new(false));
        let stop_flag = Arc::clone(&shutdown);
        let thread_token = token.clone();

        let accept_thread = std::thread::Builder::new()
            .name("clipes-media-http".into())
            .spawn(move || accept_loop(listener, thread_token, stop_flag))?;

        Ok(Self {
            addr,
            token,
            shutdown,
            accept_thread: Some(accept_thread),
        })
    }

    pub fn base_url(&self) -> String {
        format!("http://{}/{}", self.addr, self.token)
    }

    #[cfg(test)]
    pub fn local_addr(&self) -> SocketAddr {
        self.addr
    }
}

impl Drop for MediaServer {
    fn drop(&mut self) {
        self.shutdown.store(true, Ordering::Relaxed);
        if let Some(handle) = self.accept_thread.take() {
            let _ = handle.join();
        }
    }
}

fn accept_loop(listener: TcpListener, token: String, shutdown: Arc<AtomicBool>) {
    while !shutdown.load(Ordering::Relaxed) {
        match listener.accept() {
            Ok((stream, _)) => {
                let conn_token = token.clone();
                let _ = std::thread::Builder::new()
                    .name("clipes-media-conn".into())
                    .spawn(move || handle_connection(stream, &conn_token));
            }
            Err(e) if e.kind() == std::io::ErrorKind::WouldBlock => {
                std::thread::sleep(Duration::from_millis(15));
            }
            Err(_) => {
                if shutdown.load(Ordering::Relaxed) {
                    break;
                }
                std::thread::sleep(Duration::from_millis(25));
            }
        }
    }
}

struct ParsedRequest<'a> {
    method: &'a str,
    target: &'a str,
    origin: Option<&'a str>,
    invalid_origin: bool,
    range: Option<&'a str>,
    close: bool,
}

fn find_header_end(buf: &[u8]) -> Option<usize> {
    buf.windows(4)
        .position(|w| w == b"\r\n\r\n")
        .map(|pos| pos + 4)
}

fn parse_request(raw: &[u8]) -> Option<ParsedRequest<'_>> {
    let text = std::str::from_utf8(raw).ok()?;
    let mut lines = text.split("\r\n");
    let request_line = lines.next()?;
    let mut parts = request_line.split(' ');
    let method = parts.next()?;
    let target = parts.next()?;
    let version = parts.next()?;
    if parts.next().is_some() || !version.starts_with("HTTP/1.") {
        return None;
    }

    let mut origin = None;
    let mut invalid_origin = false;
    let mut range = None;
    let mut close = version == "HTTP/1.0";

    for line in lines {
        if line.is_empty() {
            break;
        }
        let (name, value) = line.split_once(':')?;
        let val = value.trim();
        if name.eq_ignore_ascii_case("origin") {
            if origin.is_some() {
                invalid_origin = true;
            } else {
                origin = Some(val);
            }
        } else if name.eq_ignore_ascii_case("range") {
            range = Some(val);
        } else if name.eq_ignore_ascii_case("connection") {
            if val.eq_ignore_ascii_case("close") {
                close = true;
            } else if version == "HTTP/1.0" && val.eq_ignore_ascii_case("keep-alive") {
                close = false;
            }
        }
    }

    Some(ParsedRequest {
        method,
        target,
        origin,
        invalid_origin,
        range,
        close,
    })
}

fn status_reason(status: u16) -> &'static str {
    match status {
        200 => "OK",
        204 => "No Content",
        206 => "Partial Content",
        400 => "Bad Request",
        403 => "Forbidden",
        404 => "Not Found",
        405 => "Method Not Allowed",
        416 => "Range Not Satisfiable",
        431 => "Request Header Fields Too Large",
        _ => "Internal Server Error",
    }
}

fn write_simple_response(
    stream: &mut TcpStream,
    status: u16,
    extra_headers: &[(&str, &str)],
    allowed_origin: Option<&str>,
    close: bool,
) -> std::io::Result<()> {
    let mut out = format!(
        "HTTP/1.1 {status} {}\r\nCache-Control: no-store\r\nX-Content-Type-Options: nosniff\r\n",
        status_reason(status)
    );
    if status != 204 {
        out.push_str("Content-Length: 0\r\n");
    }
    for (k, v) in extra_headers {
        out.push_str(k);
        out.push_str(": ");
        out.push_str(v);
        out.push_str("\r\n");
    }
    if let Some(origin) = allowed_origin {
        out.push_str("Access-Control-Allow-Origin: ");
        out.push_str(origin);
        out.push_str("\r\nVary: Origin\r\nAccess-Control-Allow-Methods: GET, HEAD, OPTIONS\r\nAccess-Control-Allow-Headers: Range\r\n");
    }
    if close {
        out.push_str("Connection: close\r\n");
    }
    out.push_str("\r\n");
    stream.write_all(out.as_bytes())?;
    stream.flush()
}

fn write_media_response(
    stream: &mut TcpStream,
    resp: &clipes_core::media::MediaResponse,
    head: bool,
    allowed_origin: Option<&str>,
    close: bool,
) -> std::io::Result<()> {
    let mut out = format!(
        "HTTP/1.1 {} {}\r\n",
        resp.status,
        status_reason(resp.status)
    );
    for (k, v) in &resp.headers {
        out.push_str(k);
        out.push_str(": ");
        out.push_str(v);
        out.push_str("\r\n");
    }
    if let Some(origin) = allowed_origin {
        out.push_str("Access-Control-Allow-Origin: ");
        out.push_str(origin);
        out.push_str("\r\nVary: Origin\r\nAccess-Control-Allow-Methods: GET, HEAD, OPTIONS\r\nAccess-Control-Allow-Headers: Range\r\n");
    }
    if close {
        out.push_str("Connection: close\r\n");
    }
    out.push_str("\r\n");
    stream.write_all(out.as_bytes())?;
    if !head && !resp.body.is_empty() {
        stream.write_all(&resp.body)?;
    }
    stream.flush()
}

fn stream_whole_file(
    stream: &mut TcpStream,
    resolved: &clipes_core::media::ResolvedMedia,
    head: bool,
    allowed_origin: Option<&str>,
    close: bool,
) -> std::io::Result<()> {
    let Ok(mut file) = File::open(&resolved.path) else {
        return write_simple_response(stream, 404, &[], allowed_origin, close);
    };
    let mut out = format!(
        "HTTP/1.1 200 OK\r\nContent-Type: {}\r\nAccept-Ranges: bytes\r\nContent-Length: {}\r\nCache-Control: no-store\r\nX-Content-Type-Options: nosniff\r\n",
        resolved.content_type, resolved.len
    );
    if let Some(origin) = allowed_origin {
        out.push_str("Access-Control-Allow-Origin: ");
        out.push_str(origin);
        out.push_str("\r\nVary: Origin\r\nAccess-Control-Allow-Methods: GET, HEAD, OPTIONS\r\nAccess-Control-Allow-Headers: Range\r\n");
    }
    if close {
        out.push_str("Connection: close\r\n");
    }
    out.push_str("\r\n");
    stream.write_all(out.as_bytes())?;

    if !head {
        let mut remaining = resolved.len;
        let mut buf = vec![0u8; STREAM_CHUNK_BYTES];
        while remaining > 0 {
            let to_read = (remaining as usize).min(buf.len());
            let n = file.read(&mut buf[..to_read])?;
            if n == 0 {
                break;
            }
            stream.write_all(&buf[..n])?;
            remaining -= n as u64;
        }
    }
    resolved.mark_used();
    stream.flush()
}

fn handle_connection(mut stream: TcpStream, token: &str) {
    // No Windows, um socket aceito de listener non-blocking pode herdar modo não bloqueante.
    if stream.set_nonblocking(false).is_err() {
        return;
    }
    let _ = stream.set_read_timeout(Some(Duration::from_secs(10)));
    let _ = stream.set_write_timeout(Some(Duration::from_secs(30)));

    let mut pending = Vec::with_capacity(2048);
    let mut tmp = [0u8; 4096];

    loop {
        let hdr_end = loop {
            if let Some(end) = find_header_end(&pending) {
                break end;
            }
            if pending.len() >= MAX_HEADER_BYTES {
                let _ = write_simple_response(&mut stream, 431, &[], None, true);
                return;
            }
            match stream.read(&mut tmp) {
                Ok(0) => return,
                Ok(n) => pending.extend_from_slice(&tmp[..n]),
                Err(_) => return,
            }
        };

        let header_bytes = &pending[..hdr_end];
        let Some(req) = parse_request(header_bytes) else {
            let _ = write_simple_response(&mut stream, 400, &[], None, true);
            return;
        };

        let close = req.close;
        let Some(without_slash) = req.target.strip_prefix('/') else {
            let _ = write_simple_response(&mut stream, 403, &[], None, true);
            return;
        };
        let (candidate_token, resource) =
            without_slash.split_once('/').unwrap_or((without_slash, ""));

        if !constant_time_eq(candidate_token.as_bytes(), token.as_bytes()) {
            let _ = write_simple_response(&mut stream, 403, &[], None, true);
            return;
        }

        if req.invalid_origin {
            let _ = write_simple_response(&mut stream, 403, &[], None, true);
            return;
        }
        let allowed_origin = match req.origin {
            Some(origin) if is_allowed_origin(origin) => Some(origin),
            Some(_) => {
                let _ = write_simple_response(&mut stream, 403, &[], None, true);
                return;
            }
            None => None,
        };

        let io_res = match req.method {
            "OPTIONS" => write_simple_response(&mut stream, 204, &[], allowed_origin, close),
            "GET" | "HEAD" => {
                let head = req.method == "HEAD";
                if resource.is_empty() {
                    write_simple_response(&mut stream, 404, &[], allowed_origin, close)
                } else if let Some(range) = req.range {
                    let served = clipes_core::media::serve(resource, Some(range));
                    write_media_response(&mut stream, &served, head, allowed_origin, close)
                } else if let Some(resolved) = clipes_core::media::resolve(resource) {
                    stream_whole_file(&mut stream, &resolved, head, allowed_origin, close)
                } else {
                    write_simple_response(&mut stream, 404, &[], allowed_origin, close)
                }
            }
            _ => write_simple_response(
                &mut stream,
                405,
                &[("Allow", "GET, HEAD, OPTIONS")],
                allowed_origin,
                close,
            ),
        };

        if io_res.is_err() || close {
            return;
        }
        pending.drain(..hdr_end);
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;
    use std::{
        ffi::OsString,
        fs,
        path::Path,
        sync::{Mutex, MutexGuard},
    };

    static ENV_LOCK: Mutex<()> = Mutex::new(());

    struct DataDirGuard {
        _lock: MutexGuard<'static, ()>,
        previous: Option<OsString>,
    }

    impl DataDirGuard {
        fn set(dir: &Path) -> Self {
            let lock = ENV_LOCK.lock().unwrap_or_else(|e| e.into_inner());
            let previous = std::env::var_os("CLIPES_DATA_DIR");
            std::env::set_var("CLIPES_DATA_DIR", dir);
            Self {
                _lock: lock,
                previous,
            }
        }
    }

    impl Drop for DataDirGuard {
        fn drop(&mut self) {
            match self.previous.take() {
                Some(v) => std::env::set_var("CLIPES_DATA_DIR", v),
                None => std::env::remove_var("CLIPES_DATA_DIR"),
            }
        }
    }

    struct RawHttpResponse {
        status: u16,
        headers: Vec<(String, String)>,
        body: Vec<u8>,
    }

    impl RawHttpResponse {
        fn header(&self, name: &str) -> Option<&str> {
            self.headers
                .iter()
                .find(|(k, _)| k.eq_ignore_ascii_case(name))
                .map(|(_, v)| v.as_str())
        }
    }

    fn send_raw(addr: SocketAddr, request: &str) -> RawHttpResponse {
        let mut stream = TcpStream::connect(addr).unwrap();
        stream
            .set_read_timeout(Some(Duration::from_secs(5)))
            .unwrap();
        stream.write_all(request.as_bytes()).unwrap();
        stream.flush().unwrap();

        let mut buf = Vec::new();
        let mut tmp = [0u8; 4096];
        let hdr_end = loop {
            if let Some(end) = find_header_end(&buf) {
                break end;
            }
            let n = stream.read(&mut tmp).unwrap();
            assert!(n > 0, "EOF before headers");
            buf.extend_from_slice(&tmp[..n]);
        };
        let hdr_text = std::str::from_utf8(&buf[..hdr_end]).unwrap();
        let mut lines = hdr_text.split("\r\n");
        let status_line = lines.next().unwrap();
        let status: u16 = status_line.split(' ').nth(1).unwrap().parse().unwrap();
        let mut headers = Vec::new();
        let mut content_length = 0usize;
        for line in lines {
            if line.is_empty() {
                break;
            }
            if let Some((k, v)) = line.split_once(':') {
                if k.trim().eq_ignore_ascii_case("content-length") {
                    content_length = v.trim().parse().unwrap();
                }
                headers.push((k.trim().to_owned(), v.trim().to_owned()));
            }
        }
        let mut body = buf[hdr_end..].to_vec();
        if !request.starts_with("HEAD ") {
            while body.len() < content_length {
                let n = stream.read(&mut tmp).unwrap();
                assert!(n > 0, "EOF before body complete");
                body.extend_from_slice(&tmp[..n]);
            }
            body.truncate(content_length);
        } else {
            body.clear();
        }
        RawHttpResponse {
            status,
            headers,
            body,
        }
    }

    #[test]
    fn binds_only_loopback_with_ephemeral_port_and_random_token() {
        let s1 = MediaServer::start().unwrap();
        let s2 = MediaServer::start().unwrap();
        assert_eq!(s1.local_addr().ip(), IpAddr::V4(Ipv4Addr::LOCALHOST));
        assert!(s1.local_addr().port() > 0);
        assert!(s1.base_url().starts_with("http://127.0.0.1:"));
        assert_ne!(s1.token, s2.token);
        assert_eq!(s1.token.len(), 64);
    }

    #[test]
    fn enforces_token_cors_traversal_listing_and_range_security() {
        let tmp = tempfile::tempdir().unwrap();
        let _guard = DataDirGuard::set(tmp.path());

        let cache = tmp.path().join("cache");
        let key = "ab".repeat(32);
        let proxy_dir = cache.join("proxies").join(&key);
        fs::create_dir_all(&proxy_dir).unwrap();
        let payload: Vec<u8> = (0..10_240u32).map(|i| (i % 251) as u8).collect();
        fs::write(proxy_dir.join("proxy.mp4"), &payload).unwrap();
        fs::write(tmp.path().join("secret.txt"), b"segredo").unwrap();

        clipes_core::dispatch(
            "components.settings.set",
            json!({
                "data_dir": tmp.path(),
                "cache_dir": cache,
                "cache_limit_bytes": 1_000_000_000u64,
            }),
            &mut |_| {},
        )
        .unwrap();

        // Projeto isolado com arquivo fora da pasta do Projeto não registrado como mídia.
        let project = clipes_core::dispatch(
            "projects.create",
            json!({"parent": tmp.path(), "name": "SecProj"}),
            &mut |_| {},
        )
        .unwrap();
        let project_dir = Path::new(project["path"].as_str().unwrap()).to_path_buf();
        fs::write(project_dir.join("notes.txt"), b"nao-e-midia").unwrap();

        let srv = MediaServer::start().unwrap();
        let addr = srv.local_addr();
        let token = &srv.token;

        // 1. Sem token ou token errado -> 403, sem CORS aberto.
        for req in [
            "GET / HTTP/1.1\r\nHost: 127.0.0.1\r\nConnection: close\r\n\r\n".to_string(),
            format!("GET /proxy/{key} HTTP/1.1\r\nHost: 127.0.0.1\r\nConnection: close\r\n\r\n"),
            format!(
                "GET /{}/proxy/{key} HTTP/1.1\r\nHost: 127.0.0.1\r\nConnection: close\r\n\r\n",
                "00".repeat(32)
            ),
            format!(
                "GET /{}/proxy/{key} HTTP/1.1\r\nHost: 127.0.0.1\r\nOrigin: tauri://localhost\r\nConnection: close\r\n\r\n",
                "ff".repeat(32)
            ),
        ] {
            let res = send_raw(addr, &req);
            assert_eq!(res.status, 403, "{req}");
            assert_eq!(res.header("access-control-allow-origin"), None, "{req}");
        }

        // 2. Path traversal, listagem e arquivos fora do Projeto/cache -> 404.
        for path in [
            String::new(),
            "/".to_string(),
            "proxy".to_string(),
            "proxy/".to_string(),
            "../secret.txt".to_string(),
            "proxy/../../secret.txt".to_string(),
            format!("proxy/{key}/../../../secret.txt"),
            "%2e%2e/secret.txt".to_string(),
            "notes.txt".to_string(),
            "source/1".to_string(),
            "narration/1".to_string(),
        ] {
            let req = format!(
                "GET /{token}/{path} HTTP/1.1\r\nHost: 127.0.0.1\r\nConnection: close\r\n\r\n"
            );
            let res = send_raw(addr, &req);
            assert_eq!(res.status, 404, "{path}");
            assert!(res.body.is_empty(), "{path}");
        }

        // 3. CORS restrito à origem do app (nunca '*').
        let no_origin = send_raw(
            addr,
            &format!(
                "GET /{token}/proxy/{key} HTTP/1.1\r\nHost: 127.0.0.1\r\nConnection: close\r\n\r\n"
            ),
        );
        assert_eq!(no_origin.status, 200);
        assert_eq!(no_origin.body, payload);
        assert_eq!(no_origin.header("access-control-allow-origin"), None);

        for evil in ["https://evil.example", "http://127.0.0.1:9999", "null"] {
            let blocked = send_raw(
                addr,
                &format!("GET /{token}/proxy/{key} HTTP/1.1\r\nHost: 127.0.0.1\r\nOrigin: {evil}\r\nConnection: close\r\n\r\n"),
            );
            assert_eq!(blocked.status, 403, "{evil}");
            assert_eq!(
                blocked.header("access-control-allow-origin"),
                None,
                "{evil}"
            );
        }

        let allowed = send_raw(
            addr,
            &format!("GET /{token}/proxy/{key} HTTP/1.1\r\nHost: 127.0.0.1\r\nOrigin: tauri://localhost\r\nConnection: close\r\n\r\n"),
        );
        assert_eq!(allowed.status, 200);
        assert_eq!(
            allowed.header("access-control-allow-origin"),
            Some("tauri://localhost")
        );
        assert_eq!(allowed.header("vary"), Some("Origin"));

        let preflight = send_raw(
            addr,
            &format!("OPTIONS /{token}/proxy/{key} HTTP/1.1\r\nHost: 127.0.0.1\r\nOrigin: tauri://localhost\r\nConnection: close\r\n\r\n"),
        );
        assert_eq!(preflight.status, 204);
        assert_eq!(
            preflight.header("access-control-allow-origin"),
            Some("tauri://localhost")
        );

        // 4. Suporte a Range (206), Range inválido (416), HEAD e keep-alive.
        let mut keepalive_stream = TcpStream::connect(addr).unwrap();
        keepalive_stream
            .set_read_timeout(Some(Duration::from_secs(5)))
            .unwrap();
        keepalive_stream
            .write_all(
                format!(
                    "GET /{token}/proxy/{key} HTTP/1.1\r\nHost: 127.0.0.1\r\nRange: bytes=100-199\r\n\r\n"
                )
                .as_bytes(),
            )
            .unwrap();
        let mut buf = [0u8; 4096];
        let n = keepalive_stream.read(&mut buf).unwrap();
        let resp_str = String::from_utf8_lossy(&buf[..n]);
        assert!(resp_str.starts_with("HTTP/1.1 206 Partial Content\r\n"));
        assert!(resp_str.contains("Content-Range: bytes 100-199/10240\r\n"));

        let bad_range = send_raw(
            addr,
            &format!("GET /{token}/proxy/{key} HTTP/1.1\r\nHost: 127.0.0.1\r\nRange: bytes=20000-\r\nConnection: close\r\n\r\n"),
        );
        assert_eq!(bad_range.status, 416);

        let head_res = send_raw(
            addr,
            &format!("HEAD /{token}/proxy/{key} HTTP/1.1\r\nHost: 127.0.0.1\r\nConnection: close\r\n\r\n"),
        );
        assert_eq!(head_res.status, 200);
        assert_eq!(head_res.header("content-length"), Some("10240"));
        assert!(head_res.body.is_empty());

        clipes_core::dispatch("projects.close", json!({}), &mut |_| {}).unwrap();
    }
}
