use super::groq::{language_code, request};
use super::*;
use std::io::{Read, Write};
use std::net::TcpListener;

#[test]
fn estimate_accounts_for_minimum_billing_and_unknown_models() {
    let estimate = super::groq::estimate_cost("whisper-large-v3-turbo", 1_000_000);
    assert!((estimate["usd"].as_f64().unwrap() - 0.04 / 360.0).abs() < 1e-10);
    assert_eq!(
        super::groq::estimate_cost("unknown", 10_000_000)["kind"],
        "unknown"
    );
}

fn server_reply(
    status: u16,
    headers: &str,
    delay: Duration,
) -> (String, std::thread::JoinHandle<()>) {
    let listener = TcpListener::bind("127.0.0.1:0").unwrap();
    let url = format!("http://{}", listener.local_addr().unwrap());
    let headers = headers.to_owned();
    let thread = std::thread::spawn(move || {
        let (mut socket, _) = listener.accept().unwrap();
        socket.set_nonblocking(false).unwrap();
        socket
            .set_read_timeout(Some(Duration::from_secs(5)))
            .unwrap();
        let mut request = Vec::new();
        let mut buffer = [0; 4096];
        loop {
            let n = socket.read(&mut buffer).unwrap();
            assert!(n > 0);
            request.extend_from_slice(&buffer[..n]);
            if let Some(end) = request.windows(4).position(|w| w == b"\r\n\r\n") {
                let len = String::from_utf8_lossy(&request[..end])
                    .lines()
                    .find_map(|l| {
                        l.to_lowercase()
                            .strip_prefix("content-length: ")
                            .and_then(|s| s.parse::<usize>().ok())
                    })
                    .unwrap();
                if request.len() >= end + 4 + len {
                    break;
                }
            }
        }
        std::thread::sleep(delay);
        let _ = write!(socket,"HTTP/1.1 {status} Status\r\n{headers}Content-Length: 2\r\nConnection: close\r\n\r\n{{}}");
    });
    (url, thread)
}

#[test]
fn http_errors_are_typed_and_never_echo_responses() {
    for (status, code) in [
        (401, "groq_key"),
        (413, "audio_too_large"),
        (429, "rate_limit"),
        (500, "groq_http"),
    ] {
        let (url, thread) = server_reply(status, "", Duration::ZERO);
        let e = request(
            &url,
            "fake",
            b"audio",
            &crate::provider::CancelToken::new(),
            Duration::from_secs(2),
        )
        .unwrap_err();
        assert_eq!(e.code, code);
        assert!(!e.message.contains(&url));
        thread.join().unwrap();
    }
}

#[test]
fn paid_timeout_is_uncertain_and_is_not_retried() {
    let (url, thread) = server_reply(200, "", Duration::from_millis(200));
    let e = request(
        &url,
        "fake",
        b"audio",
        &crate::provider::CancelToken::new(),
        Duration::from_millis(40),
    )
    .unwrap_err();
    assert_eq!(e.code, "timeout_uncertain");
    thread.join().unwrap();
}

#[test]
fn retry_after_wait_can_be_cancelled_without_another_call() {
    let (url, thread) = server_reply(429, "Retry-After: 30\r\n", Duration::ZERO);
    let token = crate::provider::CancelToken::new();
    let other = token.clone();
    let canceller = std::thread::spawn(move || {
        std::thread::sleep(Duration::from_millis(100));
        other.cancel();
    });
    let start = std::time::Instant::now();
    let e = request(&url, "fake", b"audio", &token, Duration::from_secs(2)).unwrap_err();
    assert_eq!(e.code, "cancelled");
    assert!(start.elapsed() < Duration::from_secs(2));
    thread.join().unwrap();
    canceller.join().unwrap();
}

#[test]
fn parses_words_from_official_format_and_submits_word_timestamps() {
    let server = TcpListener::bind("127.0.0.1:0").unwrap();
    let url = format!("http://{}", server.local_addr().unwrap());
    let thread = std::thread::spawn(move || {
        let (mut socket, _) = server.accept().unwrap();
        socket
            .set_read_timeout(Some(Duration::from_secs(10)))
            .unwrap();
        let mut request = Vec::new();
        let mut buffer = [0u8; 4096];
        loop {
            let n = socket.read(&mut buffer).unwrap();
            request.extend_from_slice(&buffer[..n]);
            if let Some(end) = request.windows(4).position(|w| w == b"\r\n\r\n") {
                let headers = String::from_utf8_lossy(&request[..end]);
                let len: usize = headers
                    .lines()
                    .find_map(|line| {
                        line.to_ascii_lowercase()
                            .strip_prefix("content-length: ")
                            .and_then(|v| v.parse().ok())
                    })
                    .unwrap();
                if request.len() >= end + 4 + len {
                    break;
                }
            }
        }
        let request = String::from_utf8_lossy(&request);
        assert!(request.contains("timestamp_granularities[]"));
        assert!(request.contains("verbose_json"));
        assert!(request.contains("whisper-large-v3-turbo"));
        let body = r#"{"language":"portuguese","words":[{"word":"olá","start":0.1,"end":0.5}]}"#;
        write!(
            socket,
            "HTTP/1.1 200 OK\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{}",
            body.len(),
            body
        )
        .unwrap();
    });
    let result = request(
        &url,
        "fake-key",
        b"audio",
        &crate::provider::CancelToken::new(),
        Duration::from_secs(5),
    )
    .unwrap();
    assert_eq!(result[0].text, "olá");
    assert_eq!((result[0].start_us, result[0].end_us), (100_000, 500_000));
    thread.join().unwrap();
}

#[test]
#[ignore = "Uma chamada paga real ao Groq, executada manualmente"]
fn groq_real_audio() {
    let key_path = std::env::var_os("CLIPES_GROQ_KEY_FILE").expect("CLIPES_GROQ_KEY_FILE");
    let audio_path = std::env::var_os("CLIPES_GROQ_TEST_AUDIO").expect("CLIPES_GROQ_TEST_AUDIO");
    let key = std::fs::read_to_string(key_path).expect("ler chave");
    let audio = std::fs::read(audio_path).expect("ler áudio");
    let words = request(
        "https://api.groq.com/openai/v1/audio/transcriptions",
        key.trim(),
        &audio,
        &crate::provider::CancelToken::new(),
        Duration::from_secs(120),
    )
    .expect("transcrição real");
    assert!(!words.is_empty());
    assert!(words.iter().all(|w| w.end_us >= w.start_us));
    assert!(words.windows(2).all(|w| w[0].start_us <= w[1].start_us));
    println!(
        "modelo=whisper-large-v3-turbo palavras={} tempos válidos=sim",
        words.len()
    );
}

#[test]
fn groq_key_commands_never_return_the_secret() {
    let secret = "not-a-real-key";
    let result = crate::dispatch(
        "transcription.groq.key.set",
        json!({"key":secret}),
        &mut |_| {},
    )
    .unwrap();
    assert!(!result.to_string().contains(secret));
    let status = crate::dispatch("transcription.groq.key.status", json!({}), &mut |_| {}).unwrap();
    assert_eq!(status["configured"], true);
    assert!(!status.to_string().contains(secret));
    crate::dispatch("transcription.groq.key.remove", json!({}), &mut |_| {}).unwrap();
    let status = crate::dispatch("transcription.groq.key.status", json!({}), &mut |_| {}).unwrap();
    assert_eq!(status["configured"], false);
}

#[test]
fn groq_test_key_lists_models_without_audio() {
    let server = TcpListener::bind("127.0.0.1:0").unwrap();
    let address = server.local_addr().unwrap();
    let worker = std::thread::spawn(move || {
        let (mut stream, _) = server.accept().unwrap();
        stream
            .set_read_timeout(Some(Duration::from_secs(5)))
            .unwrap();
        let mut bytes = [0u8; 2048];
        let n = stream.read(&mut bytes).unwrap();
        let request = String::from_utf8_lossy(&bytes[..n]);
        assert!(request.starts_with("GET /openai/v1/models "));
        let body = r#"{"data":[{"id":"whisper-large-v3-turbo"}]}"#;
        write!(
            stream,
            "HTTP/1.1 200 OK\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{}",
            body.len(),
            body
        )
        .unwrap();
    });
    assert!(
        super::groq::test_endpoint(&format!("http://{address}/openai/v1/models"), "dummy").is_ok()
    );
    worker.join().unwrap();
}

#[test]
fn whisper_languages_are_normalized_to_iso_codes() {
    assert_eq!(language_code("english"), Some("en"));
    assert_eq!(language_code("PORTUGUESE"), Some("pt"));
    assert_eq!(language_code("FR"), Some("fr"));
    assert_eq!(language_code("made-up"), None);
}

#[test]
fn oversized_or_cancelled_audio_never_connects() {
    let token = crate::provider::CancelToken::new();
    token.cancel();
    assert_eq!(
        request(
            "http://127.0.0.1:1",
            "fake",
            b"a",
            &token,
            Duration::from_secs(1)
        )
        .unwrap_err()
        .code,
        "cancelled"
    );
    assert_eq!(
        request(
            "http://127.0.0.1:1",
            "fake",
            &vec![0; 24_000_001],
            &crate::provider::CancelToken::new(),
            Duration::from_secs(1)
        )
        .unwrap_err()
        .code,
        "audio_too_large"
    );
}
