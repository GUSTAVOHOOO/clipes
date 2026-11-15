//! #145: a local server that cuts the prompt in silence. Fake HTTP servers only (loopback, and
//! one on a non-loopback interface address for the "remote" case); isolated data; no network.
use clipes_core::provider::cost::{self, Target};
use clipes_core::{dispatch, CoreError};
use serde_json::{json, Value};
use std::{
    io::{Read, Write},
    net::{IpAddr, TcpListener, UdpSocket},
    sync::{Arc, Mutex},
    thread,
};

static ENV: Mutex<()> = Mutex::new(());
type Bodies = Arc<Mutex<Vec<Value>>>;

fn run(name: &str, args: Value) -> Result<Value, CoreError> {
    dispatch(name, args, &mut |_| {})
}
fn isolated(name: &str) -> tempfile::TempDir {
    let dir = tempfile::Builder::new().prefix(name).tempdir().unwrap();
    std::env::set_var("CLIPES_DATA_DIR", dir.path());
    dir
}

/// Answers one reply per connection after reading the whole request, and records the bodies.
fn serve(ip: &str, replies: Vec<Value>) -> (String, Bodies, thread::JoinHandle<()>) {
    let listener = TcpListener::bind((ip, 0)).unwrap();
    let endpoint = format!("http://{}", listener.local_addr().unwrap());
    let bodies: Bodies = Arc::default();
    let seen = bodies.clone();
    let handle = thread::spawn(move || {
        for reply in replies {
            let (mut stream, _) = listener.accept().unwrap();
            stream.set_nonblocking(false).unwrap();
            stream
                .set_read_timeout(Some(std::time::Duration::from_secs(5)))
                .unwrap();
            let mut bytes = Vec::new();
            loop {
                let mut chunk = [0; 8192];
                let n = stream.read(&mut chunk).unwrap();
                assert!(n > 0);
                bytes.extend_from_slice(&chunk[..n]);
                if let Some(pos) = bytes.windows(4).position(|v| v == b"\r\n\r\n") {
                    let length: usize = String::from_utf8_lossy(&bytes[..pos])
                        .lines()
                        .find_map(|l| {
                            l.split_once(':')
                                .filter(|(n, _)| n.eq_ignore_ascii_case("content-length"))
                                .map(|(_, v)| v.trim().parse().unwrap())
                        })
                        .unwrap();
                    if bytes.len() >= pos + 4 + length {
                        seen.lock().unwrap().push(
                            serde_json::from_slice(&bytes[pos + 4..pos + 4 + length]).unwrap(),
                        );
                        break;
                    }
                }
            }
            let body = reply.to_string();
            write!(
                stream,
                "HTTP/1.1 200 OK\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{}",
                body.len(),
                body
            )
            .unwrap();
        }
    });
    (endpoint, bodies, handle)
}

fn ollama(input: u64) -> Value {
    json!({"message":{"content":"{\"schemaVersion\":1}"},"done":true,"prompt_eval_count":input,"eval_count":5})
}
fn openai(input: u64, extra: Value) -> Value {
    let mut v = json!({"choices":[{"message":{"content":"{\"schemaVersion\":1}"},"finish_reason":"stop"}],"usage":{"prompt_tokens":input,"completion_tokens":5}});
    for (k, x) in extra.as_object().into_iter().flatten() {
        v[k] = x.clone();
    }
    v
}
fn configure(endpoint: &str, kind: &str, context: Option<u64>) {
    let mut args = json!({"profileId":"local","label":"Local","endpoint":endpoint,"kind":kind,"model":"model"});
    if let Some(c) = context {
        args["context"] = json!(c);
    }
    run("provider.configure", args).unwrap();
}
fn schema() -> Value {
    json!({"type":"object","required":["schemaVersion"],"properties":{"schemaVersion":{"const":1}}})
}
fn structured(transcript: &str) -> Result<Value, CoreError> {
    run(
        "provider.structured",
        json!({"profileId":"local","instruction":"Return data","transcript":transcript,"schema":schema(),"nativeSchema":true}),
    )
}

#[test]
fn pinned_before_calibration_is_suspected_and_keeps_usage() {
    let _env = ENV.lock().unwrap_or_else(|e| e.into_inner());
    let _dir = isolated("trunc-pinned");
    let (url, bodies, server) = serve("127.0.0.1", vec![ollama(1000)]);
    configure(&url, "ollama", Some(1000));
    let err = structured("untrusted").unwrap_err();
    assert_eq!(err.code, "context_truncated");
    assert!(err.message.contains("increase the context"));
    assert_eq!(
        err.usage.unwrap()["usage"],
        json!({"inputTokens":1000,"outputTokens":5})
    );
    server.join().unwrap();
    // No repair, no second call.
    assert_eq!(bodies.lock().unwrap().len(), 1);
}

#[test]
fn a_normal_reply_is_accepted() {
    let _env = ENV.lock().unwrap_or_else(|e| e.into_inner());
    let _dir = isolated("trunc-normal");
    let (url, _, server) = serve("127.0.0.1", vec![ollama(200)]);
    configure(&url, "ollama", Some(1000));
    assert_eq!(structured("untrusted").unwrap()["data"]["schemaVersion"], 1);
    server.join().unwrap();
}

fn target() -> Target {
    Target::Api {
        provider: "ollama".into(),
        model: "model".into(),
        local: true,
    }
}
fn costed(transcript: &str) -> Result<Value, CoreError> {
    cost::run_costed_for(Some("local"), &target(), "selection", None, || {
        structured(transcript)
    })
}
fn request(chars: usize) -> clipes_core::provider::StructuredRequest {
    clipes_core::provider::StructuredRequest {
        estimate_hint: Default::default(),
        instruction: "Return data".into(),
        transcript: "a".repeat(chars),
        schema: schema(),
        native_schema: true,
        max_output_tokens: None,
    }
}

#[test]
fn after_calibration_it_needs_pinned_and_below_the_estimate() {
    let _env = ENV.lock().unwrap_or_else(|e| e.into_inner());
    let _dir = isolated("trunc-calibrated");
    let big = request(20_000);
    let chars = cost::input_characters(&big);
    for _ in 0..3 {
        cost::observe_tokens("local", "model", &big, chars / 3, "ok").unwrap();
    }
    // 20 000 characters in a context of 1000 tokens: since #147 the high estimate leaves no
    // room for an answer, so the call is refused before any send (no connection is made).
    let (url, bodies, server) = serve("127.0.0.1", vec![]);
    configure(&url, "ollama", Some(1000));
    assert_eq!(
        costed(&big.transcript).unwrap_err().code,
        "output_space_insufficient"
    );
    server.join().unwrap();
    assert!(bodies.lock().unwrap().is_empty());
    // The suspect call did not calibrate.
    let estimate = cost::estimate_for(&target(), "local", &big).unwrap();
    assert_eq!(estimate["calibrationSamples"], 3);

    // Pinned too, but not below the low end of a small request: accepted.
    let small = request(300);
    for _ in 0..3 {
        cost::observe_tokens("local", "model", &small, 90, "ok").unwrap();
    }
    let (url, _, server) = serve("127.0.0.1", vec![ollama(1000)]);
    configure(&url, "ollama", Some(1000));
    assert_eq!(
        costed(&small.transcript).unwrap()["data"]["schemaVersion"],
        1
    );
    server.join().unwrap();
}

#[test]
fn an_explicit_signal_always_counts() {
    let _env = ENV.lock().unwrap_or_else(|e| e.into_inner());
    let _dir = isolated("trunc-explicit");
    // llama.cpp style `truncated`, no context known (the heuristic has nothing to compare).
    let (url, _, server) = serve("127.0.0.1", vec![openai(50, json!({"truncated":true}))]);
    configure(&format!("{url}/v1"), "openai", None);
    assert_eq!(
        structured("untrusted").unwrap_err().code,
        "context_truncated"
    );
    server.join().unwrap();
    // `tokens_evaluated` below what the estimate says was sent.
    let (url, _, server) = serve(
        "127.0.0.1",
        vec![openai(900, json!({"tokens_evaluated":10}))],
    );
    configure(&format!("{url}/v1"), "openai", None);
    let err = structured("untrusted").unwrap_err();
    assert_eq!(err.code, "context_truncated");
    assert_eq!(err.usage.unwrap()["usage"]["inputTokens"], 900);
    server.join().unwrap();
    // Without a discovered context an OpenAI-compatible server is not pinned against a guess.
    let (url, _, server) = serve("127.0.0.1", vec![openai(8192, json!({}))]);
    configure(&format!("{url}/v1"), "openai", None);
    assert!(structured("untrusted").is_ok());
    server.join().unwrap();
    // With a context typed by the user, pinned counts for any local server.
    let (url, _, server) = serve("127.0.0.1", vec![openai(4096, json!({}))]);
    configure(&format!("{url}/v1"), "openai", Some(4096));
    assert_eq!(
        structured("untrusted").unwrap_err().code,
        "context_truncated"
    );
    server.join().unwrap();
}

/// An address of this machine that is not loopback, or `None` when there is none.
fn lan_ip() -> Option<String> {
    let socket = UdpSocket::bind("0.0.0.0:0").ok()?;
    socket.connect("192.0.2.1:9").ok()?;
    let ip: IpAddr = socket.local_addr().ok()?.ip();
    (!ip.is_loopback() && !ip.is_unspecified()).then(|| ip.to_string())
}

#[test]
fn a_remote_profile_is_not_discarded_by_the_heuristic() {
    let _env = ENV.lock().unwrap_or_else(|e| e.into_inner());
    let _dir = isolated("trunc-remote");
    let Some(ip) = lan_ip() else {
        eprintln!("no non-loopback interface: remote case skipped");
        return;
    };
    // Pinned at the typed context, but the server is not loopback: never dropped.
    let (url, _, server) = serve(
        &ip,
        vec![
            openai(1000, json!({})),
            openai(5, json!({"truncated":true})),
        ],
    );
    configure(&format!("{url}/v1"), "openai", Some(1000));
    run(
        "provider.confirm",
        json!({"profileId":"local","endpoint":format!("{url}/v1")}),
    )
    .unwrap();
    assert!(structured("untrusted").is_ok());
    // An explicit signal from the server counts anywhere.
    assert_eq!(
        structured("untrusted").unwrap_err().code,
        "context_truncated"
    );
    server.join().unwrap();
}

fn probe() -> Result<Value, CoreError> {
    run(
        "provider.test",
        json!({"profileId":"local","probeContext":true}),
    )
}

#[test]
fn the_probe_measures_the_context_with_synthetic_text_and_saves_it() {
    let _env = ENV.lock().unwrap_or_else(|e| e.into_inner());
    let _dir = isolated("trunc-probe");
    // Ollama without a typed context sends 4096: 20 480 characters; the fake keeps 2048 tokens.
    let (url, bodies, server) = serve("127.0.0.1", vec![ollama(2048)]);
    configure(&url, "ollama", None);
    let result = probe().unwrap();
    server.join().unwrap();
    assert_eq!(result["truncated"], true);
    assert_eq!(result["measured"], 2048);
    assert_eq!(result["contextSent"], 4096);
    let body = bodies.lock().unwrap()[0].clone();
    assert_eq!(body["options"]["num_predict"], 1);
    assert_eq!(body["options"]["num_ctx"], 4096);
    assert!(body.get("format").is_none());
    let text = body["messages"][0]["content"].as_str().unwrap();
    assert_eq!(text.len(), 4096 * 5);
    assert!(text.starts_with("Synthetic filler line 1:"));
    // The measured value reaches the context cache with origin `measured`.
    let ctx = run("provider.context.get", json!({"profileId":"local"})).unwrap();
    assert_eq!(ctx["value"], 2048);
    assert_eq!(ctx["source"], "measured");
    assert_eq!(ctx["measured"], true);
}

#[test]
fn the_probe_reports_a_whole_text_and_refuses_a_non_loopback_server() {
    let _env = ENV.lock().unwrap_or_else(|e| e.into_inner());
    let _dir = isolated("trunc-probe-whole");
    let (url, _, server) = serve("127.0.0.1", vec![ollama(5000)]);
    configure(&url, "ollama", None);
    let result = probe().unwrap();
    server.join().unwrap();
    assert_eq!(result["truncated"], false);
    assert_eq!(result["measured"], Value::Null);
    // Not loopback: refused before any connection (nothing listens there).
    configure("http://192.0.2.10:11434", "ollama", None);
    assert_eq!(probe().unwrap_err().code, "probe_not_local");
}
