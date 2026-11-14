use crate::CoreError;
use reqwest::Url;
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::{
    net::{SocketAddr, ToSocketAddrs},
    time::Duration,
};

fn error(code: &str, message: &str) -> CoreError {
    CoreError {
        code: code.into(),
        message: message.into(),
        usage: None,
    }
}

fn resolve(endpoint: &str) -> Result<(Url, Vec<SocketAddr>), CoreError> {
    let url =
        Url::parse(endpoint).map_err(|_| error("invalid_endpoint", "Invalid provider endpoint"))?;
    if !matches!(url.scheme(), "http" | "https")
        || !url.username().is_empty()
        || url.password().is_some()
        || url.query().is_some()
        || url.fragment().is_some()
    {
        return Err(error(
            "invalid_endpoint",
            "Endpoint must be an HTTP(S) URL without credentials, query or fragment",
        ));
    }
    let host = url
        .host_str()
        .ok_or_else(|| error("invalid_endpoint", "Endpoint has no host"))?
        .trim_matches(['[', ']']);
    let port = url
        .port_or_known_default()
        .ok_or_else(|| error("invalid_endpoint", "Endpoint has no port"))?;
    let addresses: Vec<_> = (host, port)
        .to_socket_addrs()
        .map_err(|_| error("network", "Could not resolve provider host"))?
        .collect();
    if addresses.is_empty() {
        return Err(error("network", "Could not resolve provider host"));
    }
    Ok((url, addresses))
}

pub fn is_local_endpoint(endpoint: &str) -> Result<bool, CoreError> {
    let (_, addresses) = resolve(endpoint)?;
    Ok(addresses.iter().all(|address| address.ip().is_loopback()))
}

#[derive(Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct StructuredRequest {
    pub instruction: String,
    pub transcript: String,
    pub schema: Value,
    pub native_schema: bool,
    #[serde(default)]
    pub max_output_tokens: Option<u64>,
}

pub trait Provider {
    fn structured(&self, request: &StructuredRequest) -> Result<Value, CoreError>;
}

mod adapters;
pub use adapters::{AnthropicProvider, GeminiProvider, OpenAiProvider};

mod settings {
    use super::*;
    use crate::{CommandRegistration, CommandResult, EventSink};
    use std::{fs, path::PathBuf, sync::Mutex};
    static LOCK: Mutex<()> = Mutex::new(());

    #[derive(Clone, Default, Serialize, Deserialize)]
    #[serde(rename_all = "camelCase")]
    struct Settings {
        endpoint: String,
        model: String,
        #[serde(default = "default_kind")]
        kind: String,
        native_schema: bool,
        #[serde(default)]
        providers: std::collections::HashMap<String, Metadata>,
    }
    fn default_kind() -> String {
        "openai".into()
    }
    #[derive(Clone, Default, Serialize, Deserialize)]
    #[serde(rename_all = "camelCase")]
    struct Metadata {
        confirmed: bool,
        key_last_four: Option<String>,
    }
    #[cfg(test)]
    fn path() -> Result<PathBuf, CoreError> {
        Ok(std::env::temp_dir().join(format!("clipes-provider-test-{}.json", std::process::id())))
    }
    #[cfg(not(test))]
    fn path() -> Result<PathBuf, CoreError> {
        directories::ProjectDirs::from("io", "github.gustavohooo", "clipes")
            .map(|p| p.config_dir().join("provider.json"))
            .ok_or_else(|| error("settings", "Could not locate settings directory"))
    }
    fn read() -> Result<Settings, CoreError> {
        match fs::read(path()?) {
            Ok(bytes) => serde_json::from_slice(&bytes)
                .map_err(|_| error("settings", "Could not read provider settings")),
            Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(Settings::default()),
            Err(_) => Err(error("settings", "Could not read provider settings")),
        }
    }
    fn write(settings: &Settings) -> Result<(), CoreError> {
        let path = path()?;
        fs::create_dir_all(path.parent().unwrap())
            .map_err(|_| error("settings", "Could not save provider settings"))?;
        let bytes = serde_json::to_vec(settings)
            .map_err(|_| error("settings", "Could not save provider settings"))?;
        fs::write(path, bytes).map_err(|_| error("settings", "Could not save provider settings"))
    }
    #[cfg(not(test))]
    fn vault_set(endpoint: &str, key: &str) -> Result<(), CoreError> {
        keyring::Entry::new("io.github.gustavohooo.clipes.provider", endpoint)
            .and_then(|e| e.set_password(key))
            .map_err(|_| error("vault", "Could not save key in system vault"))
    }
    #[cfg(not(test))]
    fn vault_get(endpoint: &str) -> Result<String, CoreError> {
        keyring::Entry::new("io.github.gustavohooo.clipes.provider", endpoint)
            .and_then(|e| e.get_password())
            .map_err(|_| error("vault", "Could not read key from system vault"))
    }
    #[cfg(not(test))]
    fn vault_remove(endpoint: &str) -> Result<(), CoreError> {
        match keyring::Entry::new("io.github.gustavohooo.clipes.provider", endpoint)
            .and_then(|e| e.delete_credential())
        {
            Ok(()) | Err(keyring::Error::NoEntry) => Ok(()),
            Err(_) => Err(error("vault", "Could not remove key from system vault")),
        }
    }
    #[cfg(test)]
    static FAKE_VAULT: std::sync::LazyLock<Mutex<std::collections::HashMap<String, String>>> =
        std::sync::LazyLock::new(|| Mutex::new(std::collections::HashMap::new()));
    #[cfg(test)]
    fn vault_set(endpoint: &str, key: &str) -> Result<(), CoreError> {
        FAKE_VAULT
            .lock()
            .unwrap()
            .insert(endpoint.into(), key.into());
        Ok(())
    }
    #[cfg(test)]
    fn vault_get(endpoint: &str) -> Result<String, CoreError> {
        FAKE_VAULT
            .lock()
            .unwrap()
            .get(endpoint)
            .cloned()
            .ok_or_else(|| error("vault", "Could not read key from system vault"))
    }
    #[cfg(test)]
    fn vault_remove(endpoint: &str) -> Result<(), CoreError> {
        FAKE_VAULT.lock().unwrap().remove(endpoint);
        Ok(())
    }
    fn locked() -> Result<std::sync::MutexGuard<'static, ()>, CoreError> {
        LOCK.lock()
            .map_err(|_| error("settings", "Could not access provider settings"))
    }
    fn status(_: Value, _: &mut EventSink<'_>) -> CommandResult {
        let _guard = locked()?;
        let settings = read()?;
        let remote = if settings.endpoint.is_empty() {
            false
        } else {
            !is_local_endpoint(&settings.endpoint).unwrap_or(false)
        };
        let metadata = settings
            .providers
            .get(&settings.endpoint)
            .cloned()
            .unwrap_or_default();
        Ok(
            json!({"endpoint":settings.endpoint, "model":settings.model, "kind":if settings.kind.is_empty() { "openai" } else { &settings.kind }, "nativeSchema":settings.native_schema, "keyLastFour":metadata.key_last_four, "remote":remote, "confirmed":metadata.confirmed}),
        )
    }
    fn configure(args: Value, _: &mut EventSink<'_>) -> CommandResult {
        let endpoint = args
            .get("endpoint")
            .and_then(Value::as_str)
            .ok_or_else(|| error("invalid_settings", "Endpoint is required"))?
            .trim()
            .trim_end_matches('/')
            .to_owned();
        let model = args
            .get("model")
            .and_then(Value::as_str)
            .ok_or_else(|| error("invalid_settings", "Model is required"))?
            .trim()
            .to_owned();
        if model.is_empty() {
            return Err(error("invalid_settings", "Model is required"));
        }
        resolve(&endpoint)?;
        let _guard = locked()?;
        let old = read()?;
        let kind = args.get("kind").and_then(Value::as_str).unwrap_or("openai");
        if !matches!(kind, "openai" | "anthropic" | "gemini") {
            return Err(error("invalid_settings", "Invalid provider type"));
        }
        let settings = Settings {
            endpoint,
            model,
            kind: kind.into(),
            native_schema: args
                .get("nativeSchema")
                .and_then(Value::as_bool)
                .unwrap_or(false),
            providers: old.providers,
        };
        write(&settings)?;
        Ok(json!({}))
    }
    fn key_set(args: Value, _: &mut EventSink<'_>) -> CommandResult {
        let key = args
            .get("key")
            .and_then(Value::as_str)
            .filter(|s| !s.is_empty())
            .ok_or_else(|| error("invalid_key", "Enter a key"))?;
        let _guard = locked()?;
        let mut settings = read()?;
        if settings.endpoint.is_empty() {
            return Err(error("invalid_settings", "Configure the provider first"));
        }
        vault_set(&settings.endpoint, key)?;
        settings
            .providers
            .entry(settings.endpoint.clone())
            .or_default()
            .key_last_four = Some(
            key.chars()
                .rev()
                .take(4)
                .collect::<String>()
                .chars()
                .rev()
                .collect(),
        );
        write(&settings)?;
        Ok(json!({}))
    }
    fn key_remove(_: Value, _: &mut EventSink<'_>) -> CommandResult {
        let _guard = locked()?;
        let mut settings = read()?;
        vault_remove(&settings.endpoint)?;
        settings
            .providers
            .entry(settings.endpoint.clone())
            .or_default()
            .key_last_four = None;
        write(&settings)?;
        Ok(json!({}))
    }
    fn confirm(args: Value, _: &mut EventSink<'_>) -> CommandResult {
        let _guard = locked()?;
        let mut settings = read()?;
        if args.get("endpoint").and_then(Value::as_str) != Some(settings.endpoint.as_str())
            || settings.endpoint.is_empty()
        {
            return Err(error(
                "invalid_settings",
                "Provider endpoint changed; review it again",
            ));
        }
        settings
            .providers
            .entry(settings.endpoint.clone())
            .or_default()
            .confirmed = true;
        write(&settings)?;
        Ok(json!({}))
    }
    fn call_inner(args: Value) -> CommandResult {
        let settings = {
            let _guard = locked()?;
            read()?
        };
        if settings.endpoint.is_empty() {
            return Err(error("invalid_settings", "Configure the provider first"));
        }
        let metadata = settings
            .providers
            .get(&settings.endpoint)
            .cloned()
            .unwrap_or_default();
        if !metadata.confirmed && !is_local_endpoint(&settings.endpoint)? {
            return Err(error(
                "confirmation_required",
                "Confirm sending text to this provider first",
            ));
        }
        let key = if metadata.key_last_four.is_some() {
            Some(vault_get(&settings.endpoint)?)
        } else {
            None
        };
        let mut request: StructuredRequest = serde_json::from_value(args)
            .map_err(|_| error("invalid_request", "Invalid structured request"))?;
        request.native_schema = settings.native_schema;
        match settings.kind.as_str() {
            "" | "openai" => {
                let mut p = OpenAiProvider::new(settings.endpoint, settings.model, key)?;
                p.confirm(metadata.confirmed);
                p.structured(&request)
            }
            "anthropic" => {
                let mut p = AnthropicProvider::new(settings.endpoint, settings.model, key)?;
                p.confirm(metadata.confirmed);
                p.structured(&request)
            }
            "gemini" => {
                let mut p = GeminiProvider::new(settings.endpoint, settings.model, key)?;
                p.confirm(metadata.confirmed);
                p.structured(&request)
            }
            _ => Err(error("invalid_settings", "Invalid provider type")),
        }
    }
    fn call(args: Value, events: &mut EventSink<'_>) -> CommandResult {
        events(crate::ProgressEvent {
            job: "provider.structured".into(),
            stage: "starting".into(),
            percentage: 0,
            message: "Preparing provider request".into(),
            error: None,
        });
        let result = call_inner(args);
        events(crate::ProgressEvent {
            job: "provider.structured".into(),
            stage: if result.is_ok() { "complete" } else { "failed" }.into(),
            percentage: 100,
            message: if result.is_ok() {
                "Provider response validated"
            } else {
                "Provider request failed"
            }
            .into(),
            error: result.as_ref().err().cloned(),
        });
        result
    }
    fn test(_: Value, events: &mut EventSink<'_>) -> CommandResult {
        let native = {
            let _guard = locked()?;
            read()?.native_schema
        };
        call(
            json!({"instruction":"Respond with schemaVersion 1.","transcript":"","schema":{"type":"object","properties":{"schemaVersion":{"type":"integer","const":1}},"required":["schemaVersion"],"additionalProperties":false},"nativeSchema":native}),
            events,
        )
    }
    inventory::submit! { CommandRegistration { name: "provider.status", execute: status } }
    inventory::submit! { CommandRegistration { name: "provider.configure", execute: configure } }
    inventory::submit! { CommandRegistration { name: "provider.key.set", execute: key_set } }
    inventory::submit! { CommandRegistration { name: "provider.key.remove", execute: key_remove } }
    inventory::submit! { CommandRegistration { name: "provider.confirm", execute: confirm } }
    inventory::submit! { CommandRegistration { name: "provider.test", execute: test } }
    inventory::submit! { CommandRegistration { name: "provider.structured", execute: call } }
    #[cfg(test)]
    mod tests {
        use super::*;
        use std::{
            io::{Read, Write},
            net::TcpListener,
            thread,
        };
        #[test]
        fn legacy_settings_default_to_openai() {
            let settings: Settings = serde_json::from_value(
                json!({"endpoint":"http://localhost:1/v1", "model":"old", "nativeSchema":false}),
            )
            .unwrap();
            assert_eq!(settings.kind, "openai");
        }
        #[test]
        fn headless_dispatch_uses_fake_vault_and_never_returns_key() {
            let _ = fs::remove_file(path().unwrap());
            FAKE_VAULT.lock().unwrap().clear();
            let listener = TcpListener::bind("127.0.0.1:0").unwrap();
            let endpoint = format!("http://{}/v1", listener.local_addr().unwrap());
            let server = thread::spawn(move || {
                let (mut stream, _) = listener.accept().unwrap();
                stream
                    .set_read_timeout(Some(Duration::from_secs(3)))
                    .unwrap();
                let mut bytes = Vec::new();
                loop {
                    let mut chunk = [0; 4096];
                    let n = stream.read(&mut chunk).unwrap();
                    bytes.extend_from_slice(&chunk[..n]);
                    if let Some(pos) = bytes.windows(4).position(|x| x == b"\r\n\r\n") {
                        let headers = String::from_utf8_lossy(&bytes[..pos]).to_lowercase();
                        let length: usize = headers
                            .lines()
                            .find_map(|line| line.strip_prefix("content-length:"))
                            .unwrap()
                            .trim()
                            .parse()
                            .unwrap();
                        if bytes.len() >= pos + 4 + length {
                            break;
                        }
                    }
                }
                let wire = String::from_utf8(bytes).unwrap();
                assert!(wire
                    .to_lowercase()
                    .contains("authorization: bearer fixture-value-1234"));
                let body = r#"{"choices":[{"message":{"content":"{\"schemaVersion\":1}"}}]}"#;
                write!(
                    stream,
                    "HTTP/1.1 200 OK\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{}",
                    body.len(),
                    body
                )
                .unwrap();
            });
            let mut events = Vec::new();
            let mut dispatch =
                |name, args| crate::dispatch(name, args, &mut |event| events.push(event));
            dispatch(
                "provider.configure",
                json!({"endpoint":endpoint,"model":"example","nativeSchema":false}),
            )
            .unwrap();
            dispatch("provider.key.set", json!({"key":"fixture-value-1234"})).unwrap();
            let status = dispatch("provider.status", json!({})).unwrap();
            assert_eq!(status["keyLastFour"], "1234");
            assert!(!status.to_string().contains("fixture-value"));
            let output = dispatch("provider.test", json!({})).unwrap();
            assert_eq!(
                output,
                json!({"data":{"schemaVersion":1},"usage":null,"calls":1})
            );
            dispatch("provider.key.remove", json!({})).unwrap();
            assert_eq!(
                dispatch("provider.status", json!({})).unwrap()["keyLastFour"],
                Value::Null
            );
            assert!(!fs::read_to_string(path().unwrap())
                .unwrap()
                .contains("fixture-value"));
            server.join().unwrap();
            for kind in ["anthropic", "gemini"] {
                let listener = TcpListener::bind("127.0.0.1:0").unwrap();
                let endpoint = format!("http://{}/v1", listener.local_addr().unwrap());
                let server = thread::spawn(move || {
                    let (mut stream, _) = listener.accept().unwrap();
                    let _ = super::super::test_http::read_request(&mut stream);
                    let body = if kind == "anthropic" { json!({"content":[{"type":"text","text":"{\"schemaVersion\":1}"}],"usage":{"input_tokens":2,"output_tokens":3}}) } else { json!({"candidates":[{"content":{"parts":[{"text":"{\"schemaVersion\":1}"}]}}],"usageMetadata":{"promptTokenCount":2,"candidatesTokenCount":3}}) }.to_string();
                    write!(
                        stream,
                        "HTTP/1.1 200 OK\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{}",
                        body.len(),
                        body
                    )
                    .unwrap();
                });
                dispatch(
                    "provider.configure",
                    json!({"endpoint":endpoint,"model":"example","kind":kind,"nativeSchema":true}),
                )
                .unwrap();
                assert_eq!(
                    dispatch("provider.test", json!({})).unwrap(),
                    json!({"data":{"schemaVersion":1},"usage":{"inputTokens":2,"outputTokens":3},"calls":1})
                );
                server.join().unwrap();
            }
            drop(dispatch);
            assert!(!serde_json::to_string(&events)
                .unwrap()
                .contains("fixture-value"));
            fs::remove_file(path().unwrap()).unwrap();
        }
    }
}

#[cfg(test)]
mod test_http {
    pub(super) fn read_request(stream: &mut std::net::TcpStream) -> Vec<u8> {
        stream.set_nonblocking(false).unwrap();
        stream
            .set_read_timeout(Some(std::time::Duration::from_secs(3)))
            .unwrap();
        let mut bytes = Vec::new();
        loop {
            let mut chunk = [0; 4096];
            let n = std::io::Read::read(stream, &mut chunk).unwrap();
            assert!(n > 0, "request ended before its body");
            bytes.extend_from_slice(&chunk[..n]);
            if let Some(pos) = bytes.windows(4).position(|x| x == b"\r\n\r\n") {
                let headers = String::from_utf8_lossy(&bytes[..pos]);
                let length: usize = headers
                    .lines()
                    .find_map(|line| {
                        line.split_once(':')
                            .filter(|(name, _)| name.eq_ignore_ascii_case("content-length"))
                            .map(|(_, value)| value.trim().parse().unwrap())
                    })
                    .expect("missing Content-Length");
                if bytes.len() >= pos + 4 + length {
                    return bytes;
                }
            }
        }
    }
}

#[cfg(test)]
mod security_tests {
    use super::*;
    use std::{net::TcpListener, thread, time::Instant};

    fn input() -> StructuredRequest {
        StructuredRequest {
            instruction: "Return JSON".into(),
            transcript: String::new(),
            schema: json!({"type":"object"}),
            native_schema: false,
            max_output_tokens: None,
        }
    }

    #[test]
    fn timeout_after_request_does_not_retry() {
        let listener = TcpListener::bind("127.0.0.1:0").unwrap();
        let endpoint = format!("http://{}/v1", listener.local_addr().unwrap());
        listener.set_nonblocking(true).unwrap();
        let server = thread::spawn(move || {
            let deadline = Instant::now() + Duration::from_secs(2);
            let mut connections = Vec::new();
            while Instant::now() < deadline {
                if let Ok((mut stream, _)) = listener.accept() {
                    stream
                        .set_read_timeout(Some(Duration::from_secs(1)))
                        .unwrap();
                    let _ = super::test_http::read_request(&mut stream);
                    connections.push(stream);
                }
                thread::sleep(Duration::from_millis(5));
            }
            connections.len()
        });
        let mut provider = OpenAiProvider::new(endpoint, "model".into(), None).unwrap();
        provider.0.timeout = Duration::from_millis(100);
        assert_eq!(
            provider.structured(&input()).unwrap_err().code,
            "timeout_uncertain"
        );
        assert_eq!(server.join().unwrap(), 1);
    }

    #[test]
    fn remote_plain_http_with_key_is_rejected_before_connecting() {
        let mut provider = OpenAiProvider::new(
            "http://0.0.0.0:1/v1".into(),
            "model".into(),
            Some("fixture-value-1234".into()),
        )
        .unwrap();
        provider.0.remote_confirmed = true;
        assert_eq!(
            provider.structured(&input()).unwrap_err().code,
            "insecure_endpoint"
        );
        provider.0.key = None;
        assert_ne!(
            provider.structured(&input()).unwrap_err().code,
            "insecure_endpoint"
        );
    }
}
