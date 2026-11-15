use clipes_core::dispatch;
use serde_json::{json, Value};
use std::{
    io::{Read, Write},
    net::TcpListener,
    thread,
};

#[test]
fn ollama_sends_native_chat_with_context_and_schema() {
    let root = std::env::temp_dir().join(format!("clipes-ollama-{}", std::process::id()));
    std::fs::create_dir_all(&root).unwrap();
    std::env::set_var("CLIPES_DATA_DIR", &root);
    let listener = TcpListener::bind("127.0.0.1:0").unwrap();
    let endpoint = format!("http://{}", listener.local_addr().unwrap());
    let server = thread::spawn(move || {
        let (mut stream, _) = listener.accept().unwrap();
        stream
            .set_read_timeout(Some(std::time::Duration::from_secs(5)))
            .unwrap();
        let mut bytes = Vec::new();
        loop {
            let mut chunk = [0; 4096];
            let n = stream.read(&mut chunk).unwrap();
            assert!(n > 0);
            bytes.extend_from_slice(&chunk[..n]);
            if let Some(pos) = bytes.windows(4).position(|v| v == b"\r\n\r\n") {
                let headers = String::from_utf8_lossy(&bytes[..pos]);
                let length: usize = headers
                    .lines()
                    .find_map(|line| {
                        line.split_once(':')
                            .filter(|(n, _)| n.eq_ignore_ascii_case("content-length"))
                            .map(|(_, v)| v.trim().parse().unwrap())
                    })
                    .unwrap();
                if bytes.len() >= pos + 4 + length {
                    assert!(headers.starts_with("POST /api/chat "));
                    let body: Value =
                        serde_json::from_slice(&bytes[pos + 4..pos + 4 + length]).unwrap();
                    assert_eq!(body["model"], "qwen");
                    assert_eq!(body["options"]["num_ctx"], 8192);
                    assert_eq!(body["stream"], false);
                    assert_eq!(body["format"]["type"], "object");
                    assert_eq!(body["messages"][0]["role"], "system");
                    assert_eq!(body["messages"][1]["role"], "user");
                    break;
                }
            }
        }
        let body = json!({"message":{"content":"{\"schemaVersion\":1}"},"done":true,"prompt_eval_count":10,"eval_count":5}).to_string();
        write!(
            stream,
            "HTTP/1.1 200 OK\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{}",
            body.len(),
            body
        )
        .unwrap();
    });
    let run = |name, args| dispatch(name, args, &mut |_| {});
    run("provider.configure", json!({"profileId":"ollama","kind":"ollama","endpoint":endpoint,"model":"qwen","context":8192})).unwrap();
    let result = run("provider.structured", json!({"profileId":"ollama","instruction":"test","transcript":"untrusted","schema":{"type":"object","required":["schemaVersion"],"properties":{"schemaVersion":{"type":"integer"}}},"nativeSchema":true})).unwrap();
    assert_eq!(result["data"]["schemaVersion"], 1);
    assert_eq!(result["usage"], json!({"inputTokens":10,"outputTokens":5}));
    server.join().unwrap();
    std::fs::remove_dir_all(root).unwrap();
}

fn fake_replies(replies: Vec<&'static str>) -> (String, thread::JoinHandle<()>) {
    let listener = TcpListener::bind("127.0.0.1:0").unwrap();
    let endpoint = format!("http://{}", listener.local_addr().unwrap());
    let server = thread::spawn(move || {
        for reply in replies {
            let (mut stream, _) = listener.accept().unwrap();
            stream
                .set_read_timeout(Some(std::time::Duration::from_secs(5)))
                .unwrap();
            let mut bytes = Vec::new();
            loop {
                let mut chunk = [0; 4096];
                let n = stream.read(&mut chunk).unwrap();
                assert!(n > 0);
                bytes.extend_from_slice(&chunk[..n]);
                if let Some(pos) = bytes.windows(4).position(|v| v == b"\r\n\r\n") {
                    let headers = String::from_utf8_lossy(&bytes[..pos]);
                    let length: usize = headers
                        .lines()
                        .find_map(|line| {
                            line.split_once(':')
                                .filter(|(n, _)| n.eq_ignore_ascii_case("content-length"))
                                .map(|(_, v)| v.trim().parse().unwrap())
                        })
                        .unwrap();
                    if bytes.len() >= pos + 4 + length {
                        break;
                    }
                }
            }
            write!(
                stream,
                "HTTP/1.1 200 OK\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{}",
                reply.len(),
                reply
            )
            .unwrap();
        }
    });
    (endpoint, server)
}

fn request() -> clipes_core::provider::StructuredRequest {
    clipes_core::provider::StructuredRequest {
        instruction: "Return data".into(),
        transcript: "untrusted".into(),
        schema: json!({"type":"object","required":["schemaVersion"],"properties":{"schemaVersion":{"const":1}}}),
        native_schema: true,
        max_output_tokens: None,
    }
}

#[test]
fn truncated_output_keeps_usage() {
    use clipes_core::provider::{OllamaProvider, Provider};
    let (url, server) = fake_replies(vec![
        r#"{"done_reason":"length","prompt_eval_count":11,"eval_count":7}"#,
    ]);
    let err = OllamaProvider::new(url, "model".into(), None)
        .unwrap()
        .structured(&request())
        .unwrap_err();
    assert_eq!(err.code, "output_truncated");
    assert_eq!(
        err.usage.unwrap()["usage"],
        json!({"inputTokens":11,"outputTokens":7})
    );
    server.join().unwrap();
}

#[test]
fn invalid_json_is_repaired_once_with_native_schema() {
    use clipes_core::provider::{OllamaProvider, Provider};
    let (url, server) = fake_replies(vec![
        r#"{"message":{"content":"bad"},"prompt_eval_count":2,"eval_count":3}"#,
        r#"{"message":{"content":"{\"schemaVersion\":1}"},"prompt_eval_count":4,"eval_count":5}"#,
    ]);
    let reply = OllamaProvider::new(url, "model".into(), None)
        .unwrap()
        .structured(&request())
        .unwrap();
    assert_eq!(reply["usage"], json!({"inputTokens":6,"outputTokens":8}));
    assert_eq!(reply["calls"], 2);
    server.join().unwrap();
}

#[test]
fn cancellation_prevents_request() {
    use clipes_core::provider::{CancelToken, OllamaProvider, Provider};
    let provider = OllamaProvider::new("http://127.0.0.1:1".into(), "model".into(), None).unwrap();
    let token = CancelToken::new();
    token.cancel();
    assert_eq!(
        provider
            .structured_with(&request(), &token)
            .unwrap_err()
            .code,
        "cancelled"
    );
}
