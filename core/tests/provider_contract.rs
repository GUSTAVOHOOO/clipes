//! Contract of the Provider adapters (#117): typed refusal, usage on 429 and HTTP errors,
//! cancellation of the 429 wait and of a request in flight, and timeouts by kind.
//! Fake servers read the whole request before answering (docs/agents/impedimentos.md).
use clipes_core::provider::{
    AnthropicProvider, CancelToken, OpenAiProvider, Provider, StructuredRequest, Timeouts,
};
use serde_json::{json, Value};
use std::{
    io::{Read, Write},
    net::TcpListener,
    sync::{
        atomic::{AtomicBool, Ordering},
        Arc,
    },
    thread,
    time::{Duration, Instant},
};

fn read_request(stream: &mut std::net::TcpStream) {
    stream.set_nonblocking(false).unwrap();
    stream
        .set_read_timeout(Some(Duration::from_secs(3)))
        .unwrap();
    let mut bytes = Vec::new();
    loop {
        let mut chunk = [0; 4096];
        let n = stream.read(&mut chunk).unwrap();
        assert!(n > 0, "request ended before its body");
        bytes.extend_from_slice(&chunk[..n]);
        if let Some(pos) = bytes.windows(4).position(|x| x == b"\r\n\r\n") {
            let length: usize = String::from_utf8_lossy(&bytes[..pos])
                .lines()
                .find_map(|line| {
                    line.split_once(':')
                        .filter(|(name, _)| name.eq_ignore_ascii_case("content-length"))
                        .map(|(_, value)| value.trim().parse().unwrap())
                })
                .expect("missing Content-Length");
            if bytes.len() >= pos + 4 + length {
                return;
            }
        }
    }
}

fn http(status: &str, headers: &str, body: &Value) -> String {
    let body = body.to_string();
    format!(
        "HTTP/1.1 {status}\r\nContent-Length: {}\r\n{headers}Connection: close\r\n\r\n{body}",
        body.len()
    )
}

/// Answers each request in turn; `None` reads the request and then holds the connection
/// open (until `release` is set) without answering.
fn serve(replies: Vec<Option<String>>) -> (String, Arc<AtomicBool>, thread::JoinHandle<usize>) {
    let listener = TcpListener::bind("127.0.0.1:0").unwrap();
    let endpoint = format!("http://{}/v1", listener.local_addr().unwrap());
    let release = Arc::new(AtomicBool::new(false));
    let flag = release.clone();
    let handle = thread::spawn(move || {
        let mut served = 0;
        for reply in replies {
            let (mut stream, _) = listener.accept().unwrap();
            read_request(&mut stream);
            served += 1;
            match reply {
                Some(text) => stream.write_all(text.as_bytes()).unwrap(),
                None => {
                    let deadline = Instant::now() + Duration::from_secs(10);
                    while !flag.load(Ordering::SeqCst) && Instant::now() < deadline {
                        thread::sleep(Duration::from_millis(10));
                    }
                }
            }
        }
        served
    });
    (endpoint, release, handle)
}

fn request() -> StructuredRequest {
    StructuredRequest {
        estimate_hint: Default::default(),
        instruction: "Return data".into(),
        transcript: "text".into(),
        schema: json!({"type":"object","required":["schemaVersion"],"properties":{"schemaVersion":{"const":1}}}),
        native_schema: false,
        max_output_tokens: None,
    }
}

fn openai(endpoint: String) -> OpenAiProvider {
    OpenAiProvider::new(endpoint, "model".into(), None).unwrap()
}

#[test]
fn openai_refusal_is_typed_with_usage_and_never_repaired() {
    let (endpoint, _, server) = serve(vec![Some(http(
        "200 OK",
        "",
        &json!({"choices":[{"finish_reason":"stop","message":{"content":null,"refusal":"I cannot help with that."}}],"usage":{"prompt_tokens":9,"completion_tokens":4}}),
    ))]);
    let error = openai(endpoint).structured(&request()).unwrap_err();
    assert_eq!(error.code, "refusal");
    assert!(!error.message.contains("cannot help"));
    assert_eq!(
        error.usage.unwrap(),
        json!({"usage":{"inputTokens":9,"outputTokens":4},"calls":1})
    );
    // A repair would need a second request, which this fake server never accepts.
    assert_eq!(server.join().unwrap(), 1);
}

#[test]
fn rate_limit_without_a_usable_delay_carries_usage_from_the_body() {
    let body = json!({"error":"slow down","usage":{"prompt_tokens":7,"completion_tokens":0}});
    for headers in ["", "Retry-After: 99\r\n"] {
        let (endpoint, _, server) =
            serve(vec![Some(http("429 Too Many Requests", headers, &body))]);
        let error = openai(endpoint).structured(&request()).unwrap_err();
        assert_eq!(error.code, "rate_limit");
        assert_eq!(
            error.usage.unwrap(),
            json!({"usage":{"inputTokens":7,"outputTokens":0},"calls":1})
        );
        server.join().unwrap();
    }
}

#[test]
fn final_rate_limit_after_retries_counts_every_http_call() {
    let limited = || {
        Some(http(
            "429 Too Many Requests",
            "Retry-After: 0\r\n",
            &json!({"usage":{"prompt_tokens":5,"completion_tokens":1}}),
        ))
    };
    let (endpoint, _, server) = serve(vec![limited(), limited(), limited(), limited()]);
    let error = openai(endpoint).structured(&request()).unwrap_err();
    assert_eq!(error.code, "rate_limit");
    assert_eq!(error.usage.unwrap()["calls"], 4);
    assert_eq!(server.join().unwrap(), 4);
}

#[test]
fn provider_http_carries_usage_only_when_the_body_has_it() {
    let (endpoint, _, server) = serve(vec![Some(http(
        "500 Internal Server Error",
        "",
        &json!({"type":"error","usage":{"input_tokens":12,"output_tokens":3}}),
    ))]);
    let provider = AnthropicProvider::new(endpoint, "model".into(), None).unwrap();
    let error = provider.structured(&request()).unwrap_err();
    assert_eq!(error.code, "provider_http");
    assert_eq!(
        error.usage.unwrap(),
        json!({"usage":{"inputTokens":12,"outputTokens":3},"calls":1})
    );
    server.join().unwrap();

    // No usage in the body (or no JSON object at all): nothing was proven billed.
    for body in [json!({"error":"bad key"}), json!("plain")] {
        let (endpoint, _, server) = serve(vec![Some(http("401 Unauthorized", "", &body))]);
        let error = openai(endpoint).structured(&request()).unwrap_err();
        assert_eq!(error.code, "provider_http");
        assert!(error.usage.is_none());
        server.join().unwrap();
    }
}

#[test]
fn http_failure_after_a_repair_adds_up_both_calls() {
    let first = http(
        "200 OK",
        "",
        &json!({"choices":[{"finish_reason":"stop","message":{"content":"not json"}}],"usage":{"prompt_tokens":10,"completion_tokens":2}}),
    );
    let second = http(
        "503 Service Unavailable",
        "",
        &json!({"usage":{"prompt_tokens":14,"completion_tokens":1}}),
    );
    let (endpoint, _, server) = serve(vec![Some(first), Some(second)]);
    let error = openai(endpoint).structured(&request()).unwrap_err();
    assert_eq!(error.code, "provider_http");
    assert_eq!(
        error.usage.unwrap(),
        json!({"usage":{"inputTokens":24,"outputTokens":3},"calls":2})
    );
    server.join().unwrap();
}

fn cancel_after(token: &CancelToken, delay: Duration) {
    let token = token.clone();
    thread::spawn(move || {
        thread::sleep(delay);
        token.cancel();
    });
}

#[test]
fn cancelling_during_the_retry_after_wait_stops_without_another_request() {
    let (endpoint, _, server) = serve(vec![Some(http(
        "429 Too Many Requests",
        "Retry-After: 20\r\n",
        &json!({}),
    ))]);
    let token = CancelToken::new();
    cancel_after(&token, Duration::from_millis(400));
    let started = Instant::now();
    let error = openai(endpoint)
        .structured_with(&request(), &token)
        .unwrap_err();
    assert_eq!(error.code, "cancelled");
    assert!(started.elapsed() < Duration::from_secs(5));
    assert_eq!(server.join().unwrap(), 1);
}

#[test]
fn cancelling_a_request_in_flight_returns_without_waiting_for_the_timeout() {
    let (endpoint, release, server) = serve(vec![None]);
    let token = CancelToken::new();
    cancel_after(&token, Duration::from_millis(300));
    let started = Instant::now();
    let error = openai(endpoint)
        .with_timeouts(Timeouts {
            local: Some(60),
            remote: None,
        })
        .structured_with(&request(), &token)
        .unwrap_err();
    assert_eq!(error.code, "cancelled");
    assert!(started.elapsed() < Duration::from_secs(5));
    release.store(true, Ordering::SeqCst);
    server.join().unwrap();
}

#[test]
fn an_already_cancelled_token_sends_nothing() {
    let token = CancelToken::new();
    token.cancel();
    // Nothing listens on this port: a request would fail with `network`, not `cancelled`.
    let provider = openai("http://127.0.0.1:9/v1".into());
    assert_eq!(
        provider
            .structured_with(&request(), &token)
            .unwrap_err()
            .code,
        "cancelled"
    );
}

#[test]
fn a_local_endpoint_uses_the_local_timeout_not_the_remote_one() {
    let (endpoint, release, server) = serve(vec![None]);
    let started = Instant::now();
    let error = openai(endpoint)
        .with_timeouts(Timeouts {
            remote: Some(60),
            local: Some(1),
        })
        .structured(&request())
        .unwrap_err();
    assert_eq!(error.code, "timeout_uncertain");
    assert!(started.elapsed() < Duration::from_secs(10));
    release.store(true, Ordering::SeqCst);
    server.join().unwrap();
}

#[test]
fn timeouts_have_documented_defaults_and_validate_overrides() {
    let defaults = Timeouts::default();
    assert_eq!(defaults.endpoint(false), Duration::from_secs(60));
    assert_eq!(defaults.endpoint(true), Duration::from_secs(300));
    assert_eq!(
        Timeouts::parse(&json!({"local":900,"remote":null})).unwrap(),
        Timeouts {
            local: Some(900),
            remote: None
        }
    );
    for invalid in [
        json!({"local":0}),
        json!({"remote":3601}),
        json!({"local":"10"}),
        json!({"cli":5}),
        json!(5),
    ] {
        assert_eq!(
            Timeouts::parse(&invalid).unwrap_err().code,
            "invalid_settings"
        );
    }
}

#[test]
fn retries_413_and_429_with_reset_headers_and_rejects_413_without_reset() {
    let ok = http(
        "200 OK",
        "",
        &json!({"choices":[{"message":{"content":"{\"schemaVersion\":1}"}}],"usage":{"prompt_tokens":10,"completion_tokens":2}}),
    );
    // 413 with Retry-After retries and succeeds.
    let (endpoint, _, server) = serve(vec![
        Some(http(
            "413 Payload Too Large",
            "Retry-After: 0\r\n",
            &json!({}),
        )),
        Some(ok.clone()),
    ]);
    let reply = openai(endpoint).structured(&request()).unwrap();
    assert_eq!(reply["data"]["schemaVersion"], 1);
    assert_eq!(reply["calls"], 2);
    assert_eq!(server.join().unwrap(), 2);

    // 429 with x-ratelimit-reset-tokens: 50ms (even if x-ratelimit-reset-requests is 12h while
    // remaining-requests > 0) waits briefly and succeeds.
    let (endpoint, _, server) = serve(vec![
        Some(http(
            "429 Too Many Requests",
            "x-ratelimit-remaining-tokens: 0\r\nx-ratelimit-reset-tokens: 50ms\r\nx-ratelimit-remaining-requests: 100\r\nx-ratelimit-reset-requests: 12h\r\n",
            &json!({}),
        )),
        Some(ok),
    ]);
    let reply = openai(endpoint).structured(&request()).unwrap();
    assert_eq!(reply["calls"], 2);
    assert_eq!(server.join().unwrap(), 2);

    // 429 with x-ratelimit-reset-tokens: 2m59.56s (> 90 s cap, <= 10 min) fails as rate_limit without sleeping.
    let (endpoint, _, server) = serve(vec![Some(http(
        "429 Too Many Requests",
        "x-ratelimit-reset-tokens: 2m59.56s\r\n",
        &json!({}),
    ))]);
    let started = Instant::now();
    let error = openai(endpoint).structured(&request()).unwrap_err();
    assert_eq!(error.code, "rate_limit");
    assert!(started.elapsed() < Duration::from_secs(2));
    assert_eq!(server.join().unwrap(), 1);

    // 413 without any reset header does NOT retry and returns request_too_large.
    let (endpoint, _, server) = serve(vec![Some(http("413 Payload Too Large", "", &json!({})))]);
    let error = openai(endpoint).structured(&request()).unwrap_err();
    assert_eq!(error.code, "request_too_large");
    assert_eq!(server.join().unwrap(), 1);
}

#[test]
fn daily_limit_returns_provider_daily_limit_without_retrying() {
    // Groq-style TPD error body + reset header.
    let (endpoint, _, server) = serve(vec![Some(http(
        "429 Too Many Requests",
        "x-ratelimit-remaining-requests: 0\r\nx-ratelimit-reset-requests: 1h30m\r\n",
        &json!({"error":{"message":"Rate limit reached on tokens per day (TPD): Limit 200000, Used 200000","code":"rate_limit_exceeded"}}),
    ))]);
    let error = openai(endpoint).structured(&request()).unwrap_err();
    assert_eq!(error.code, "provider_daily_limit");
    assert!(error.usage.unwrap()["resetAtMs"].as_u64().is_some());
    assert_eq!(server.join().unwrap(), 1);

    // Reset > 10 min triggers provider_daily_limit even without body hint.
    let (endpoint, _, server) = serve(vec![Some(http(
        "429 Too Many Requests",
        "x-ratelimit-reset-requests: 15m\r\n",
        &json!({}),
    ))]);
    let error = openai(endpoint).structured(&request()).unwrap_err();
    assert_eq!(error.code, "provider_daily_limit");
    assert!(error.usage.unwrap()["resetAtMs"].as_u64().is_some());
    assert_eq!(server.join().unwrap(), 1);
}
