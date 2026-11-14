use clipes_core::provider::{AnthropicProvider, GeminiProvider, Provider, StructuredRequest};
use serde_json::{json, Value};
use std::{
    io::{Read, Write},
    net::TcpListener,
    thread,
};

fn run(kind: &str) {
    let listener = TcpListener::bind("127.0.0.1:0").unwrap();
    let endpoint = format!("http://{}/v1", listener.local_addr().unwrap());
    let provider_kind = kind;
    let kind = kind.to_owned();
    let server = thread::spawn(move || {
        let (mut stream, _) = listener.accept().unwrap();
        stream
            .set_read_timeout(Some(std::time::Duration::from_secs(3)))
            .unwrap();
        let mut bytes = Vec::new();
        loop {
            let mut buffer = [0; 4096];
            let n = stream.read(&mut buffer).unwrap();
            assert!(n > 0);
            bytes.extend_from_slice(&buffer[..n]);
            if let Some(pos) = bytes.windows(4).position(|x| x == b"\r\n\r\n") {
                let headers = String::from_utf8_lossy(&bytes[..pos]).to_lowercase();
                let len: usize = headers
                    .lines()
                    .find_map(|l| l.strip_prefix("content-length:"))
                    .unwrap()
                    .trim()
                    .parse()
                    .unwrap();
                if bytes.len() >= pos + 4 + len {
                    let body: Value =
                        serde_json::from_slice(&bytes[pos + 4..pos + 4 + len]).unwrap();
                    if kind == "anthropic" {
                        assert!(headers.starts_with("post /v1/messages "));
                        assert!(headers.contains("x-api-key: fixture-key"));
                        assert_eq!(body["output_config"]["format"]["type"], "json_schema");
                    } else {
                        assert!(headers.starts_with("post /v1/models/model:generatecontent "));
                        assert!(headers.contains("x-goog-api-key: fixture-key"));
                        assert_eq!(
                            body["generationConfig"]["responseMimeType"],
                            "application/json"
                        );
                        assert!(body["generationConfig"]["responseJsonSchema"].is_object());
                    }
                    assert!(body.to_string().contains("untrustedTranscript"));
                    break;
                }
            }
        }
        let reply = if kind == "anthropic" { json!({"content":[{"type":"text","text":"{\"schemaVersion\":1}"}],"usage":{"input_tokens":11,"output_tokens":7}}) } else { json!({"candidates":[{"content":{"parts":[{"text":"{\"schemaVersion\":1}"}]}}],"usageMetadata":{"promptTokenCount":11,"candidatesTokenCount":7}}) }.to_string();
        write!(
            stream,
            "HTTP/1.1 200 OK\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{}",
            reply.len(),
            reply
        )
        .unwrap();
    });
    let request = StructuredRequest {
        instruction: "Return JSON".into(),
        transcript: "untrusted".into(),
        schema: json!({"type":"object","required":["schemaVersion"],"properties":{"schemaVersion":{"const":1}}}),
        native_schema: true,
        max_output_tokens: None,
    };
    let result = if provider_kind == "anthropic" {
        AnthropicProvider::new(endpoint, "model".into(), Some("fixture-key".into()))
            .unwrap()
            .structured(&request)
    } else {
        GeminiProvider::new(endpoint, "model".into(), Some("fixture-key".into()))
            .unwrap()
            .structured(&request)
    }
    .unwrap();
    assert_eq!(
        result,
        json!({"data":{"schemaVersion":1},"usage":{"inputTokens":11,"outputTokens":7},"calls":1})
    );
    server.join().unwrap();
}
#[test]
fn anthropic_native() {
    run("anthropic");
}
#[test]
fn gemini_native() {
    run("gemini");
}

#[test]
fn anthropic_truncation_preserves_usage_without_repair() {
    let listener = TcpListener::bind("127.0.0.1:0").unwrap();
    let endpoint = format!("http://{}/v1", listener.local_addr().unwrap());
    let server = thread::spawn(move || {
        let (mut stream, _) = listener.accept().unwrap();
        stream
            .set_read_timeout(Some(std::time::Duration::from_secs(3)))
            .unwrap();
        let mut bytes = Vec::new();
        loop {
            let mut chunk = [0; 4096];
            let n = stream.read(&mut chunk).unwrap();
            assert!(n > 0);
            bytes.extend_from_slice(&chunk[..n]);
            if let Some(pos) = bytes.windows(4).position(|x| x == b"\r\n\r\n") {
                let headers = String::from_utf8_lossy(&bytes[..pos]).to_lowercase();
                let len: usize = headers
                    .lines()
                    .find_map(|l| l.strip_prefix("content-length:"))
                    .unwrap()
                    .trim()
                    .parse()
                    .unwrap();
                if bytes.len() >= pos + 4 + len {
                    let body: Value =
                        serde_json::from_slice(&bytes[pos + 4..pos + 4 + len]).unwrap();
                    assert_eq!(body["max_tokens"], 37);
                    break;
                }
            }
        }
        let reply = json!({"stop_reason":"max_tokens","content":[{"type":"text","text":"{"}],"usage":{"input_tokens":12,"output_tokens":37}}).to_string();
        write!(
            stream,
            "HTTP/1.1 200 OK\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{}",
            reply.len(),
            reply
        )
        .unwrap();
    });
    let request = StructuredRequest {
        instruction: "Return JSON".into(),
        transcript: "".into(),
        schema: json!({"type":"object"}),
        native_schema: false,
        max_output_tokens: Some(37),
    };
    let error = AnthropicProvider::new(endpoint, "model".into(), None)
        .unwrap()
        .structured(&request)
        .unwrap_err();
    assert_eq!(error.code, "output_truncated");
    assert_eq!(
        error.usage,
        Some(json!({"usage":{"inputTokens":12,"outputTokens":37},"calls":1}))
    );
    server.join().unwrap();
}

fn repair_with_usage(kind: &str) {
    let listener = TcpListener::bind("127.0.0.1:0").unwrap();
    let endpoint = format!("http://{}/v1", listener.local_addr().unwrap());
    let mode = kind.to_string();
    let server = thread::spawn(move || {
        for text in ["invalid", "{\"schemaVersion\":1}"] {
            let (mut stream, _) = listener.accept().unwrap();
            stream
                .set_read_timeout(Some(std::time::Duration::from_secs(3)))
                .unwrap();
            let mut bytes = Vec::new();
            loop {
                let mut chunk = [0; 4096];
                let n = stream.read(&mut chunk).unwrap();
                assert!(n > 0);
                bytes.extend_from_slice(&chunk[..n]);
                if let Some(pos) = bytes.windows(4).position(|x| x == b"\r\n\r\n") {
                    let headers = String::from_utf8_lossy(&bytes[..pos]).to_lowercase();
                    let len: usize = headers
                        .lines()
                        .find_map(|l| l.strip_prefix("content-length:"))
                        .unwrap()
                        .trim()
                        .parse()
                        .unwrap();
                    if bytes.len() >= pos + 4 + len {
                        break;
                    }
                }
            }
            let reply = if mode == "anthropic" { json!({"content":[{"type":"text","text":text}],"usage":{"input_tokens":10,"output_tokens":5}}) } else { json!({"candidates":[{"content":{"parts":[{"text":text}]}}],"usageMetadata":{"promptTokenCount":10,"candidatesTokenCount":5}}) }.to_string();
            write!(
                stream,
                "HTTP/1.1 200 OK\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{}",
                reply.len(),
                reply
            )
            .unwrap();
        }
    });
    let request = StructuredRequest {
        instruction: "Return JSON".into(),
        transcript: "".into(),
        schema: json!({"type":"object"}),
        native_schema: false,
        max_output_tokens: None,
    };
    let result = if kind == "anthropic" {
        AnthropicProvider::new(endpoint, "model".into(), None)
            .unwrap()
            .structured(&request)
    } else {
        GeminiProvider::new(endpoint, "model".into(), None)
            .unwrap()
            .structured(&request)
    }
    .unwrap();
    assert_eq!(
        result,
        json!({"data":{"schemaVersion":1},"usage":{"inputTokens":20,"outputTokens":10},"calls":2})
    );
    server.join().unwrap();
}
#[test]
fn anthropic_repairs_and_sums_usage() {
    repair_with_usage("anthropic");
}
#[test]
fn gemini_repairs_and_sums_usage() {
    repair_with_usage("gemini");
}
