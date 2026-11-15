//! #147: limites de saída e timeout por Perfil de Provedor. Servidores falsos em loopback, dados
//! isolados e nenhuma rede.
#[path = "support/ai_fake.rs"]
mod ai_fake;
use ai_fake::*;
use clipes_core::{
    dispatch,
    jobs::{self, Safety},
    provider::{cost::Target, CancelToken, Provider, StructuredRequest},
    CoreError,
};
use serde_json::{json, Value};
use std::{
    io::{Read, Write},
    net::TcpListener,
    sync::{
        atomic::{AtomicBool, Ordering},
        Arc, Mutex,
    },
    thread,
    time::{Duration, Instant},
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

/// One scripted reply: waits `delay`, then answers.
#[derive(Clone)]
struct Reply {
    delay: Duration,
    status: u16,
    headers: Vec<(&'static str, &'static str)>,
    body: Value,
}
fn ok(body: Value) -> Reply {
    Reply {
        delay: Duration::ZERO,
        status: 200,
        headers: vec![],
        body,
    }
}
fn slow(delay: Duration, body: Value) -> Reply {
    Reply { delay, ..ok(body) }
}

struct Server {
    endpoint: String,
    bodies: Arc<Mutex<Vec<Value>>>,
    stop: Arc<AtomicBool>,
    handle: Option<thread::JoinHandle<()>>,
}
impl Server {
    fn requests(&self) -> Vec<Value> {
        self.bodies.lock().unwrap().clone()
    }
}
impl Drop for Server {
    fn drop(&mut self) {
        self.stop.store(true, Ordering::SeqCst);
        if let Some(handle) = self.handle.take() {
            let _ = handle.join();
        }
    }
}

/// Answers the n-th connection with the n-th reply (the last one repeats), each on its own
/// thread so a stalled reply does not block the next. The whole request is read before
/// answering (see docs/agents/impedimentos.md, "Servidor HTTP falso falha no Windows").
fn serve(replies: Vec<Reply>) -> Server {
    let listener = TcpListener::bind("127.0.0.1:0").unwrap();
    listener.set_nonblocking(true).unwrap();
    let endpoint = format!("http://{}", listener.local_addr().unwrap());
    let bodies: Arc<Mutex<Vec<Value>>> = Arc::default();
    let stop = Arc::new(AtomicBool::new(false));
    let (seen, halt) = (bodies.clone(), stop.clone());
    let handle = thread::spawn(move || {
        let mut index = 0;
        let mut workers = Vec::new();
        while !halt.load(Ordering::SeqCst) {
            let Ok((mut stream, _)) = listener.accept() else {
                thread::sleep(Duration::from_millis(5));
                continue;
            };
            let reply = replies[index.min(replies.len() - 1)].clone();
            index += 1;
            let seen = seen.clone();
            workers.push(thread::spawn(move || {
                stream.set_nonblocking(false).unwrap();
                stream
                    .set_read_timeout(Some(Duration::from_secs(5)))
                    .unwrap();
                let mut bytes = Vec::new();
                loop {
                    let mut chunk = [0; 8192];
                    let Ok(n) = stream.read(&mut chunk) else {
                        return;
                    };
                    if n == 0 {
                        return;
                    }
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
                thread::sleep(reply.delay);
                let body = reply.body.to_string();
                let extra: String = reply
                    .headers
                    .iter()
                    .map(|(k, v)| format!("{k}: {v}\r\n"))
                    .collect();
                let _ = write!(
                    stream,
                    "HTTP/1.1 {} X\r\n{extra}Content-Length: {}\r\nConnection: close\r\n\r\n{}",
                    reply.status,
                    body.len(),
                    body
                );
            }));
        }
        for worker in workers {
            let _ = worker.join();
        }
    });
    Server {
        endpoint,
        bodies,
        stop,
        handle: Some(handle),
    }
}

/// A Provider of the executor that sends through the "local" Profile.
struct ToProfile;
impl Provider for ToProfile {
    fn structured(&self, request: &StructuredRequest) -> Result<Value, CoreError> {
        self.structured_with(request, &CancelToken::new())
    }
    fn structured_with(
        &self,
        request: &StructuredRequest,
        cancel: &CancelToken,
    ) -> Result<Value, CoreError> {
        let mut args = serde_json::to_value(request).unwrap();
        args["profileId"] = json!("local");
        clipes_core::provider::run_structured(args, cancel)
    }
}

fn openai_reply() -> Value {
    json!({"choices":[{"message":{"content":"{\"schemaVersion\":1}"},"finish_reason":"stop"}],
        "usage":{"prompt_tokens":20,"completion_tokens":5}})
}
fn anthropic_reply() -> Value {
    json!({"content":[{"type":"text","text":"{\"schemaVersion\":1}"}],"stop_reason":"end_turn",
        "usage":{"input_tokens":20,"output_tokens":5}})
}
fn task_reply() -> Value {
    let text = good().to_string();
    json!({"choices":[{"message":{"content":text},"finish_reason":"stop"}],
        "usage":{"prompt_tokens":20,"completion_tokens":5}})
}

fn configure(endpoint: &str, kind: &str, model: &str, extra: Value) {
    let endpoint = if kind == "openai" {
        format!("{endpoint}/v1")
    } else {
        endpoint.to_owned()
    };
    let mut args =
        json!({"profileId":"local","label":"Local","endpoint":endpoint,"kind":kind,"model":model});
    for (k, v) in extra.as_object().into_iter().flatten() {
        args[k] = v.clone();
    }
    run("provider.configure", args).unwrap();
}
fn schema() -> Value {
    json!({"type":"object","required":["schemaVersion"],"properties":{"schemaVersion":{"const":1}}})
}
fn call_args(transcript: &str, ask: Option<u64>) -> Value {
    let mut args = json!({"profileId":"local","instruction":"Return data","transcript":transcript,"schema":schema(),"nativeSchema":false});
    if let Some(ask) = ask {
        args["maxOutputTokens"] = json!(ask);
    }
    args
}
fn structured(transcript: &str, ask: Option<u64>) -> Result<Value, CoreError> {
    run("provider.structured", call_args(transcript, ask))
}
fn sent_max(server: &Server, field: &str) -> Value {
    server.requests().last().unwrap()[field].clone()
}

#[test]
fn output_ceiling_is_the_smallest_of_request_profile_catalog_and_free_space() {
    let _env = ENV.lock().unwrap_or_else(|e| e.into_inner());
    let _dir = isolated("limits-wire");

    // Catalog model (128000 of output): a request above it is cut, one below it is kept.
    let server = serve(vec![ok(openai_reply())]);
    configure(
        &server.endpoint,
        "openai",
        "gpt-6-luna",
        json!({"context": 1_000_000}),
    );
    structured("untrusted", Some(500_000)).unwrap();
    assert_eq!(sent_max(&server, "max_tokens"), 128_000);
    structured("untrusted", Some(256)).unwrap();
    assert_eq!(sent_max(&server, "max_tokens"), 256);
    drop(server);

    // Unknown catalog: an explicit conservative fallback, never the request or a blind 8192.
    let server = serve(vec![ok(openai_reply())]);
    configure(
        &server.endpoint,
        "openai",
        "mystery",
        json!({"context": 100_000}),
    );
    structured("untrusted", Some(8192)).unwrap();
    assert_eq!(sent_max(&server, "max_tokens"), 4096);
    structured("untrusted", Some(100)).unwrap();
    assert_eq!(sent_max(&server, "max_tokens"), 100);
    // No request and no limit: nothing is sent, as before.
    structured("untrusted", None).unwrap();
    assert!(server
        .requests()
        .last()
        .unwrap()
        .get("max_tokens")
        .is_none());

    // The Profile's own limit; editing other fields keeps it, null clears it.
    configure(
        &server.endpoint,
        "openai",
        "mystery",
        json!({"context": 100_000, "maxOutput": 2000}),
    );
    structured("untrusted", Some(9000)).unwrap();
    assert_eq!(sent_max(&server, "max_tokens"), 2000);
    structured("untrusted", None).unwrap();
    assert_eq!(sent_max(&server, "max_tokens"), 2000);
    configure(
        &server.endpoint,
        "openai",
        "mystery",
        json!({"context": 100_000}),
    );
    structured("untrusted", Some(9000)).unwrap();
    assert_eq!(
        sent_max(&server, "max_tokens"),
        2000,
        "an absent field keeps the limit"
    );
    configure(
        &server.endpoint,
        "openai",
        "mystery",
        json!({"context": 100_000, "maxOutput": null}),
    );
    structured("untrusted", Some(9000)).unwrap();
    assert_eq!(sent_max(&server, "max_tokens"), 4096);
    let profile = run("provider.status", json!({"profileId":"local"})).unwrap();
    assert!(profile["maxOutput"].is_null());
    assert_eq!(profile["limits"]["maxOutput"]["source"], "fallback");
    assert_eq!(profile["limits"]["maxOutput"]["value"], 4096);
    assert!(run(
        "provider.configure",
        json!({"profileId":"local","endpoint":server.endpoint,"model":"mystery","maxOutput":0})
    )
    .is_err());

    // Free space: context 3000 minus the input leaves less than the 4096 asked.
    configure(
        &server.endpoint,
        "openai",
        "mystery",
        json!({"context": 3000}),
    );
    structured("untrusted", Some(4096)).unwrap();
    let cut = sent_max(&server, "max_tokens").as_u64().unwrap();
    assert!(
        (2500..3000).contains(&cut),
        "cut to the free context: {cut}"
    );
}

#[test]
fn anthropic_no_longer_inherits_a_blind_8192() {
    let _env = ENV.lock().unwrap_or_else(|e| e.into_inner());
    let _dir = isolated("limits-anthropic");
    let server = serve(vec![ok(anthropic_reply())]);
    configure(
        &server.endpoint,
        "anthropic",
        "claude-unknown",
        json!({"context": 100_000}),
    );
    structured("untrusted", None).unwrap();
    assert_eq!(sent_max(&server, "max_tokens"), 4096);
    structured("untrusted", Some(300)).unwrap();
    assert_eq!(sent_max(&server, "max_tokens"), 300);
    // A profile limit applies to Anthropic too.
    configure(
        &server.endpoint,
        "anthropic",
        "claude-unknown",
        json!({"context": 100_000, "maxOutput": 1500}),
    );
    structured("untrusted", Some(4000)).unwrap();
    assert_eq!(sent_max(&server, "max_tokens"), 1500);
}

#[test]
fn no_room_for_an_answer_is_refused_before_any_call() {
    let _env = ENV.lock().unwrap_or_else(|e| e.into_inner());
    let _dir = isolated("limits-refuse");
    let big = "palavra ".repeat(2500);
    for (kind, model, reply) in [
        ("openai", "mystery", openai_reply()),
        ("anthropic", "claude-unknown", anthropic_reply()),
    ] {
        let server = serve(vec![ok(reply)]);
        configure(&server.endpoint, kind, model, json!({"context": 2000}));
        let err = structured(&big, Some(1000)).unwrap_err();
        assert_eq!(err.code, "output_space_insufficient");
        assert_eq!(
            err.message,
            "There is not enough free context left for an answer; nothing was sent"
        );
        assert!(err.usage.is_none());
        // Nothing reached the server, and a roomier context lets the same input through.
        assert!(server.requests().is_empty());
        configure(&server.endpoint, kind, model, json!({"context": 20_000}));
        structured(&big, Some(1000)).unwrap();
        assert_eq!(server.requests().len(), 1);
    }
}

#[test]
fn a_cancel_during_the_retry_after_wait_stops_every_provider_kind() {
    let _env = ENV.lock().unwrap_or_else(|e| e.into_inner());
    let _dir = isolated("limits-cancel");
    for (kind, model) in [("openai", "mystery"), ("anthropic", "claude-unknown")] {
        let server = serve(vec![Reply {
            delay: Duration::ZERO,
            status: 429,
            headers: vec![("Retry-After", "10")],
            body: json!({}),
        }]);
        configure(&server.endpoint, kind, model, json!({"context": 100_000}));
        let token = CancelToken::new();
        let waiting = token.clone();
        let started = Instant::now();
        let call = thread::spawn(move || {
            clipes_core::provider::run_structured(call_args("untrusted", None), &waiting)
        });
        while server.requests().is_empty() {
            assert!(started.elapsed() < Duration::from_secs(5));
            thread::sleep(Duration::from_millis(10));
        }
        thread::sleep(Duration::from_millis(200));
        token.cancel();
        let err = call.join().unwrap().unwrap_err();
        assert_eq!(err.code, "cancelled");
        assert!(
            started.elapsed() < Duration::from_secs(5),
            "did not wait the 10 s"
        );
        assert_eq!(server.requests().len(), 1, "no retry after the cancel");
    }
}

#[test]
fn profile_timeout_applies_and_the_executor_keeps_its_retry_policy() {
    let _env = ENV.lock().unwrap_or_else(|e| e.into_inner());
    let _dir = isolated("limits-timeout");
    let root = std::env::temp_dir().join(format!("clipes-limits-{}", std::process::id()));
    std::fs::create_dir_all(&root).unwrap();
    run("projects.create", json!({"parent": root, "name": "Canal"})).unwrap();
    // The first call of each job stalls past the Profile's 1 s timeout; the next one answers.
    let stall = slow(Duration::from_secs(4), task_reply());
    let server = serve(vec![
        stall.clone(),
        ok(task_reply()),
        stall,
        ok(task_reply()),
    ]);
    configure(
        &server.endpoint,
        "openai",
        "mystery",
        json!({"context": 100_000, "timeoutSecs": 1}),
    );
    let status = run("provider.status", json!({"profileId":"local"})).unwrap();
    assert_eq!(status["timeoutSecs"], 1);
    assert_eq!(status["limits"]["timeout"]["seconds"], 1);
    assert_eq!(status["limits"]["timeout"]["source"], "profile");
    // The executor calls the real adapter of the "local" Profile through its public entry
    // point; only the choice of Provider (the app settings) is replaced.
    jobs::set_ai_provider(Some(Arc::new(ToProfile)));
    jobs::set_ai_route(Some((
        Target::Api {
            provider: "openai".into(),
            model: "mystery".into(),
            local: true,
        },
        "local".into(),
    )));
    let enqueue =
        |safety| jobs::enqueue_ai("example", &input("selecione os cortes"), safety).unwrap();

    // Local, zero cost: the timeout is uncertain, but the retry needs no confirmation.
    let started = Instant::now();
    let local = enqueue(Safety::Local);
    let job = wait_state(local, "uncertain");
    assert!(
        started.elapsed() < Duration::from_secs(4),
        "the profile timeout, not the stall"
    );
    assert_eq!(job["cost"], "zero");
    assert_eq!(result(local)["code"], "timeout_uncertain");
    run("jobs.retry", json!({"id": local})).unwrap();
    assert_eq!(wait_state(local, "completed")["attempts"], 2);

    // Paid: also uncertain with unknown cost, never repeated without a confirmation.
    let paid = enqueue(Safety::Paid);
    let job = wait_state(paid, "uncertain");
    assert_eq!(job["cost"], "unknown");
    let calls = server.requests().len();
    let err = run("jobs.retry", json!({"id": paid})).unwrap_err();
    assert_eq!(err.code, "confirmation_required");
    assert!(err.usage.unwrap()["estimate"]["kind"].is_string());
    assert_eq!(
        server.requests().len(),
        calls,
        "nothing was sent by the refusal"
    );

    // A call with no room for an answer fails before sending and leaves no cost or audit row.
    let audited = run("provider.audit.list", json!({})).unwrap();
    let rows = audited.as_array().map_or(0, Vec::len);
    configure(
        &server.endpoint,
        "openai",
        "mystery",
        json!({"context": 2500}),
    );
    let starved =
        jobs::enqueue_ai("example", &input(&"palavra ".repeat(1000)), Safety::Paid).unwrap();
    wait_state(starved, "failed");
    assert_eq!(result(starved)["code"], "output_space_insufficient");
    assert_eq!(server.requests().len(), calls);
    let audited = run("provider.audit.list", json!({})).unwrap();
    assert_eq!(audited.as_array().map_or(0, Vec::len), rows);
}

#[test]
fn truncated_output_keeps_its_usage_and_is_never_repaired() {
    let _env = ENV.lock().unwrap_or_else(|e| e.into_inner());
    let _dir = isolated("limits-truncated");
    let cut = json!({"choices":[{"message":{"content":"{\"schemaVersion\":"},"finish_reason":"length"}],
        "usage":{"prompt_tokens":30,"completion_tokens":100}});
    let server = serve(vec![ok(cut)]);
    configure(
        &server.endpoint,
        "openai",
        "mystery",
        json!({"context": 100_000}),
    );
    let err = structured("untrusted", Some(100)).unwrap_err();
    assert_eq!(err.code, "output_truncated");
    assert_eq!(
        err.usage.unwrap(),
        json!({"usage":{"inputTokens":30,"outputTokens":100},"calls":1})
    );
    assert_eq!(
        server.requests().len(),
        1,
        "no automatic repair that bills another call"
    );
}
