//! #143: all dispatches use isolated data and fake loopback HTTP, never real APIs.
use clipes_core::{dispatch, CoreError};
use serde_json::{json, Value};
use std::{
    collections::HashMap,
    io::{Read, Write},
    net::TcpListener,
    sync::{
        atomic::{AtomicBool, Ordering},
        Arc, Mutex,
    },
    thread,
    time::Duration,
};

static ENV: Mutex<()> = Mutex::new(());
fn run(name: &str, args: Value) -> Result<Value, CoreError> {
    dispatch(name, args, &mut |_| {})
}
fn isolated(name: &str) -> tempfile::TempDir {
    let dir = tempfile::Builder::new().prefix(name).tempdir().unwrap();
    std::env::set_var("CLIPES_DATA_DIR", dir.path());
    dir
}
struct Server {
    endpoint: String,
    calls: Arc<Mutex<Vec<(String, Value)>>>,
    stop: Arc<AtomicBool>,
    thread: Option<thread::JoinHandle<()>>,
}
impl Server {
    fn new(routes: &[(&str, Value)]) -> Self {
        let listener = TcpListener::bind("127.0.0.1:0").unwrap();
        listener.set_nonblocking(true).unwrap();
        let endpoint = format!("http://{}", listener.local_addr().unwrap());
        let routes: HashMap<String, Value> = routes
            .iter()
            .map(|(p, v)| (p.to_string(), v.clone()))
            .collect();
        let calls = Arc::new(Mutex::new(Vec::new()));
        let stop = Arc::new(AtomicBool::new(false));
        let (thread_calls, thread_stop) = (calls.clone(), stop.clone());
        let thread = thread::spawn(move || {
            while !thread_stop.load(Ordering::SeqCst) {
                let (mut stream, _) = match listener.accept() {
                    Ok(v) => v,
                    Err(e) if e.kind() == std::io::ErrorKind::WouldBlock => {
                        thread::sleep(Duration::from_millis(5));
                        continue;
                    }
                    Err(e) => panic!("{e}"),
                };
                stream.set_nonblocking(false).unwrap();
                stream
                    .set_read_timeout(Some(Duration::from_secs(5)))
                    .unwrap();
                let mut bytes = Vec::new();
                let (path, body) = loop {
                    let mut buf = [0; 4096];
                    let n = stream.read(&mut buf).unwrap();
                    assert!(n > 0);
                    bytes.extend_from_slice(&buf[..n]);
                    if let Some(pos) = bytes.windows(4).position(|w| w == b"\r\n\r\n") {
                        let headers = String::from_utf8_lossy(&bytes[..pos]);
                        let len = headers
                            .lines()
                            .find_map(|l| {
                                l.to_lowercase()
                                    .strip_prefix("content-length:")
                                    .map(|s| s.trim().parse::<usize>().unwrap())
                            })
                            .unwrap_or(0);
                        if bytes.len() >= pos + 4 + len {
                            break (
                                headers
                                    .lines()
                                    .next()
                                    .unwrap()
                                    .split_whitespace()
                                    .nth(1)
                                    .unwrap()
                                    .to_string(),
                                if len == 0 {
                                    Value::Null
                                } else {
                                    serde_json::from_slice(&bytes[pos + 4..pos + 4 + len]).unwrap()
                                },
                            );
                        }
                    }
                };
                thread_calls.lock().unwrap().push((path.clone(), body));
                let (status, reply) = routes
                    .get(&path)
                    .map_or((404, json!({})), |v| (200, v.clone()));
                let body = reply.to_string();
                let _ = write!(stream, "HTTP/1.1 {status} OK\r\nContent-Type: application/json\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{body}", body.len());
            }
        });
        Self {
            endpoint,
            calls,
            stop,
            thread: Some(thread),
        }
    }
    fn configure(&self, kind: &str, context: Option<u64>) {
        run("provider.configure", json!({"profileId":"test","label":"Test","endpoint":format!("{}{}", self.endpoint, if kind == "openai" { "/v1" } else { "" }),"kind":kind,"model":"model","context":context})).unwrap();
    }
}
impl Drop for Server {
    fn drop(&mut self) {
        self.stop.store(true, Ordering::SeqCst);
        self.thread.take().unwrap().join().unwrap();
    }
}

#[test]
fn catalog_fallback_override_and_unconsented_remote_do_not_touch_the_network() {
    let _guard = ENV.lock().unwrap();
    let root = isolated("clipes-context-offline");
    run("provider.configure", json!({"profileId":"test","label":"Test","endpoint":"https://192.0.2.10/v1","kind":"openai","model":"unknown"})).unwrap();
    let before = std::fs::read(root.path().join("provider.json")).unwrap();
    let get = || {
        run(
            "provider.context.get",
            json!({"profileId":"test","refresh":true}),
        )
        .unwrap()
    };
    let fallback = get();
    assert_eq!(fallback["value"], 8192);
    assert_eq!(fallback["source"], "fallback");
    assert_eq!(fallback["warning"], "consent_required");
    assert_eq!(
        before,
        std::fs::read(root.path().join("provider.json")).unwrap()
    );
    run("provider.configure", json!({"profileId":"test","label":"Test","endpoint":"https://192.0.2.10/v1","kind":"openai","model":"gpt-6.1-sol"})).unwrap();
    assert_eq!(get()["source"], "catalog");
    run("provider.configure", json!({"profileId":"test","label":"Test","endpoint":"https://192.0.2.10/v1","kind":"openai","model":"gpt-6.1-sol","context":2000000})).unwrap();
    let capped = get();
    assert_eq!(capped["value"], 1050000);
    assert_eq!(capped["source"], "catalog");
    assert_eq!(capped["capped"], true);
    assert_eq!(capped["maxOutput"]["value"], 128000);
    run(
        "assistant.local_only.set",
        json!({"task":"selection","enabled":true}),
    )
    .unwrap();
    assert_eq!(
        run(
            "provider.context.get",
            json!({"profileId":"test","task":"selection","refresh":true})
        )
        .unwrap()["warning"],
        "local_only"
    );
    let cli = run("provider.context.get", json!({"profileId":"codex"})).unwrap();
    assert_eq!(cli["measured"], false);
    assert!(cli.get("usage").is_none());
}

#[test]
fn ollama_loaded_context_caps_override_and_preload_requires_explicit_refresh() {
    let _guard = ENV.lock().unwrap();
    let root = isolated("clipes-context-ollama");
    // Official formats: https://docs.ollama.com/api-reference/show-model-details.md
    // https://docs.ollama.com/api/ps.md and https://docs.ollama.com/api/chat.md
    let server = Server::new(&[
        (
            "/api/show",
            json!({"model_info":{"general.architecture":"llama","llama.context_length":131072}}),
        ),
        (
            "/api/ps",
            json!({"models":[{"name":"other","context_length":128},{"name":"model:latest","model":"model:latest","context_length":4096}]}),
        ),
        (
            "/api/chat",
            json!({"done":true,"message":{"role":"assistant","content":""}}),
        ),
    ]);
    server.configure("ollama", Some(32768));
    let before = std::fs::read(root.path().join("provider.json")).unwrap();
    let passive = run("provider.context.get", json!({"profileId":"test"})).unwrap();
    assert_eq!(passive["value"], 32768);
    assert_eq!(passive["source"], "user");
    assert_eq!(passive["maxContext"]["value"], 131072);
    assert_eq!(passive["capped"], false);
    assert_eq!(passive["loaded"]["value"], 4096);
    assert!(!server
        .calls
        .lock()
        .unwrap()
        .iter()
        .any(|(p, _)| p == "/api/chat"));
    let refreshed = run(
        "provider.context.get",
        json!({"profileId":"test","refresh":true}),
    )
    .unwrap();
    assert_eq!(refreshed["value"], 32768);
    let calls = server.calls.lock().unwrap();
    let preload = calls.iter().find(|(p, _)| p == "/api/chat").unwrap();
    assert_eq!(preload.1["options"]["num_ctx"], 32768);
    assert_eq!(preload.1["options"]["num_predict"], 1);
    assert_eq!(preload.1["messages"], json!([]));
    drop(calls);
    assert_eq!(
        before,
        std::fs::read(root.path().join("provider.json")).unwrap()
    );
    assert!(root.path().join("provider-context.json").exists());
    let count = server.calls.lock().unwrap().len();
    run("provider.context.get", json!({"profileId":"test"})).unwrap();
    assert_eq!(
        server.calls.lock().unwrap().len(),
        count,
        "cache avoids probing"
    );
}

#[test]
fn local_metadata_recognizes_loaded_instance_and_ignores_other_models() {
    let _guard = ENV.lock().unwrap();
    let _root = isolated("clipes-context-local");
    // https://lmstudio.ai/docs/developer/rest/list
    let server = Server::new(&[(
        "/api/v1/models",
        json!({"models":[{"key":"other","max_context_length":7},
        {"key":"model","max_context_length":131072,"loaded_instances":[{"id":"model","config":{"context_length":16384}}]}]}),
    )]);
    server.configure("openai", Some(32768));
    let result = run(
        "provider.context.get",
        json!({"profileId":"test","refresh":true}),
    )
    .unwrap();
    assert_eq!(result["value"], 16384);
    assert_eq!(result["source"], "loaded");
    assert_eq!(result["detail"], "lmstudio");
    assert_eq!(server.calls.lock().unwrap().len(), 1);
    server.configure("openai", Some(8192));
    let result = run("provider.context.get", json!({"profileId":"test"})).unwrap();
    assert_eq!(result["source"], "user");
    assert_eq!(result["value"], 8192);
    assert_eq!(
        server.calls.lock().unwrap().len(),
        2,
        "configuration invalidates cache"
    );
}

#[test]
fn llama_cpp_and_native_paid_metadata_use_documented_fields_without_generation() {
    let _guard = ENV.lock().unwrap();
    let _root = isolated("clipes-context-metadata");
    // https://github.com/ggml-org/llama.cpp/blob/master/tools/server/README.md
    let llama = Server::new(&[
        (
            "/props",
            json!({"model_alias":"model","default_generation_settings":{"n_ctx":8192}}),
        ),
        (
            "/v1/models",
            json!({"data":[{"id":"model","meta":{"n_ctx_train":131072}}]}),
        ),
    ]);
    llama.configure("openai", None);
    let result = run("provider.context.get", json!({"profileId":"test"})).unwrap();
    assert_eq!(result["source"], "loaded");
    assert_eq!(result["value"], 8192);
    assert_eq!(result["maxContext"]["value"], 131072);
    // https://platform.claude.com/docs/en/api/models/retrieve
    let anthropic = Server::new(&[(
        "/models/model",
        json!({"id":"model","max_input_tokens":200000,"max_tokens":64000}),
    )]);
    anthropic.configure("anthropic", None);
    let result = run(
        "provider.context.get",
        json!({"profileId":"test","refresh":true}),
    )
    .unwrap();
    assert_eq!(result["source"], "server");
    assert_eq!(result["value"], 200000);
    assert_eq!(result["maxOutput"]["value"], 64000);
    // https://ai.google.dev/api/models#method:-models.get
    let gemini = Server::new(&[(
        "/models/model",
        json!({"name":"models/model","inputTokenLimit":1048576,"outputTokenLimit":65536}),
    )]);
    gemini.configure("gemini", None);
    let result = run("provider.context.get", json!({"profileId":"test"})).unwrap();
    assert_eq!(result["value"], 1048576);
    assert_eq!(result["maxOutput"]["value"], 65536);
}

#[test]
fn compatible_models_metadata_missing_limits_and_unavailable_server_fall_back() {
    let _guard = ENV.lock().unwrap();
    let root = isolated("clipes-context-compatible");
    // OpenRouter: https://openrouter.ai/docs/api/api-reference/models/list-all-models-and-their-properties
    let router = Server::new(&[(
        "/v1/models",
        json!({"data":[{"id":"model","context_length":131072,
        "top_provider":{"context_length":65536,"max_completion_tokens":8192}}]}),
    )]);
    router.configure("openai", None);
    let result = run("provider.context.get", json!({"profileId":"test"})).unwrap();
    assert_eq!(result["value"], 65536);
    assert_eq!(result["maxOutput"]["value"], 8192);
    let missing = Server::new(&[(
        "/api/v1/models",
        json!({"models":[{"key":"model","max_context_length":null,"loaded_instances":[]}]}),
    )]);
    missing.configure("openai", None);
    assert_eq!(
        run("provider.context.get", json!({"profileId":"test"})).unwrap()["source"],
        "fallback"
    );
    let endpoint = missing.endpoint.clone();
    drop(missing);
    run("provider.configure", json!({"profileId":"test","label":"Test","endpoint":endpoint,"model":"model","kind":"ollama"})).unwrap();
    let result = run(
        "provider.context.get",
        json!({"profileId":"test","refresh":true}),
    )
    .unwrap();
    assert_eq!(result["value"], 4096);
    assert_eq!(result["warning"], "unavailable");
    // Automatically saved cache contains no endpoint, model, free text, or response body.
    if let Ok(cache) = std::fs::read_to_string(root.path().join("provider-context.json")) {
        assert!(!cache.contains(&endpoint));
        assert!(!cache.contains("top_provider"));
    }
    run("provider.profiles.remove", json!({"profileId":"test"})).unwrap();
    assert!(run("provider.context.get", json!({"profileId":"test"})).is_err());
}

fn chat_num_ctx(server: &Server) -> Value {
    run("provider.structured", json!({"profileId":"test","instruction":"x","transcript":"y","nativeSchema":false,
        "schema":{"type":"object","properties":{"schemaVersion":{"type":"integer"}},"required":["schemaVersion"]}})).unwrap();
    let calls = server.calls.lock().unwrap();
    let chat = calls.iter().rev().find(|(p, _)| p == "/api/chat").unwrap();
    chat.1["options"]["num_ctx"].clone()
}

#[test]
fn ollama_num_ctx_sent_is_the_effective_context_reported() {
    let _guard = ENV.lock().unwrap();
    let _root = isolated("clipes-context-numctx");
    let chat = (
        "/api/chat",
        json!({"done":true,"message":{"role":"assistant","content":"{\"schemaVersion\":1}"}}),
    );
    // Loaded 32k, no user value: the call asks for exactly what get reports.
    let loaded = Server::new(&[
        (
            "/api/show",
            json!({"model_info":{"llama.context_length":131072}}),
        ),
        (
            "/api/ps",
            json!({"models":[{"name":"model:latest","context_length":32768}]}),
        ),
        chat.clone(),
    ]);
    loaded.configure("ollama", None);
    let got = run("provider.context.get", json!({"profileId":"test"})).unwrap();
    assert_eq!(
        (got["value"].clone(), got["source"].clone()),
        (json!(32768), json!("loaded"))
    );
    assert_eq!(chat_num_ctx(&loaded), json!(32768));
    drop(loaded);
    // Advertised maximum 128k and nothing loaded: never the maximum.
    let idle = Server::new(&[
        (
            "/api/show",
            json!({"model_info":{"llama.context_length":131072}}),
        ),
        ("/api/ps", json!({"models":[]})),
        chat,
    ]);
    idle.configure("ollama", None);
    let got = run("provider.context.get", json!({"profileId":"test"})).unwrap();
    assert_eq!(got["value"], 4096);
    assert_eq!(got["maxContext"]["value"], 131072);
    assert_eq!(chat_num_ctx(&idle), json!(4096));
}
