use super::*;
use std::io::{Read, Write};
use std::net::TcpListener;

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

/// Cliente da API de transcrição. Não registra chave, áudio nem respostas.
fn request(
    endpoint: &str,
    key: &str,
    audio: &[u8],
    cancel: &crate::provider::CancelToken,
    timeout: Duration,
) -> Result<Vec<Word>, CoreError> {
    use std::sync::mpsc;
    if cancel.is_cancelled() {
        return Err(error("cancelled", "Transcrição cancelada."));
    }
    if audio.len() > 24_000_000 {
        return Err(error(
            "audio_too_large",
            "O bloco de áudio excede o limite do Groq.",
        ));
    }
    let boundary = "clipes-transcription-boundary";
    let mut body = Vec::with_capacity(audio.len() + 1024);
    for (name, value) in [
        ("model", "whisper-large-v3-turbo"),
        ("response_format", "verbose_json"),
        ("timestamp_granularities[]", "word"),
    ] {
        body.extend_from_slice(format!("--{boundary}\r\nContent-Disposition: form-data; name=\"{name}\"\r\n\r\n{value}\r\n").as_bytes());
    }
    body.extend_from_slice(format!("--{boundary}\r\nContent-Disposition: form-data; name=\"file\"; filename=\"audio.flac\"\r\nContent-Type: audio/flac\r\n\r\n").as_bytes());
    body.extend_from_slice(audio);
    body.extend_from_slice(format!("\r\n--{boundary}--\r\n").as_bytes());
    let client = reqwest::blocking::Client::builder()
        .timeout(timeout)
        .redirect(reqwest::redirect::Policy::none())
        .no_proxy()
        .build()
        .map_err(|_| error("network", "Não foi possível iniciar a conexão."))?;
    for attempt in 0..3 {
        if cancel.is_cancelled() {
            return Err(error("cancelled", "Transcrição cancelada."));
        }
        let call = client
            .post(endpoint)
            .bearer_auth(key)
            .header(
                reqwest::header::CONTENT_TYPE,
                format!("multipart/form-data; boundary={boundary}"),
            )
            .body(body.clone());
        let (tx, rx) = mpsc::channel();
        std::thread::spawn(move || {
            let result = call.send().and_then(|response| {
                let status = response.status().as_u16();
                let retry = response
                    .headers()
                    .get(reqwest::header::RETRY_AFTER)
                    .and_then(|v| v.to_str().ok())
                    .map(str::to_owned);
                response.bytes().map(|bytes| (status, retry, bytes))
            });
            let _ = tx.send(result);
        });
        let reply = loop {
            match rx.recv_timeout(Duration::from_millis(25)) {
                Ok(result) => {
                    break result.map_err(|_| {
                        error(
                            "timeout_uncertain",
                            "O resultado da chamada ao Groq é incerto.",
                        )
                    })?
                }
                Err(mpsc::RecvTimeoutError::Timeout) if cancel.is_cancelled() => {
                    return Err(error(
                        "timeout_uncertain",
                        "O resultado da chamada ao Groq é incerto.",
                    ))
                }
                Err(mpsc::RecvTimeoutError::Timeout) => {}
                Err(_) => {
                    return Err(error(
                        "timeout_uncertain",
                        "O resultado da chamada ao Groq é incerto.",
                    ))
                }
            }
        };
        match reply.0 {
            401 => return Err(error("groq_key", "Chave do Groq inválida.")),
            413 => {
                return Err(error(
                    "audio_too_large",
                    "O bloco de áudio excede o limite do Groq.",
                ))
            }
            429 if attempt < 2 => {
                let secs = reply
                    .1
                    .as_deref()
                    .and_then(|s| s.parse::<u64>().ok())
                    .ok_or_else(|| error("rate_limit", "O Groq limitou as chamadas."))?;
                let end = std::time::Instant::now() + Duration::from_secs(secs);
                while std::time::Instant::now() < end {
                    if cancel.is_cancelled() {
                        return Err(error("cancelled", "Transcrição cancelada."));
                    }
                    std::thread::sleep(
                        end.saturating_duration_since(std::time::Instant::now())
                            .min(Duration::from_millis(25)),
                    );
                }
            }
            429 => return Err(error("rate_limit", "O Groq limitou as chamadas.")),
            200..=299 => {
                let value: Value = serde_json::from_slice(&reply.2).map_err(|_| {
                    error("invalid_response", "O Groq retornou uma resposta inválida.")
                })?;
                let words = value["words"].as_array().ok_or_else(|| {
                    error("invalid_response", "O Groq retornou uma resposta inválida.")
                })?;
                return words
                    .iter()
                    .map(|word| {
                        let time = |name: &str| {
                            word[name]
                                .as_f64()
                                .filter(|v| {
                                    v.is_finite()
                                        && *v >= 0.0
                                        && *v < (i64::MAX as f64 / 1_000_000.0)
                                })
                                .map(|v| (v * 1_000_000.0).round() as i64)
                                .ok_or_else(|| {
                                    error(
                                        "invalid_response",
                                        "O Groq retornou uma resposta inválida.",
                                    )
                                })
                        };
                        let start_us = time("start")?;
                        let end_us = time("end")?;
                        if end_us < start_us {
                            return Err(error(
                                "invalid_response",
                                "O Groq retornou uma resposta inválida.",
                            ));
                        }
                        Ok(Word {
                            text: word["word"]
                                .as_str()
                                .ok_or_else(|| {
                                    error(
                                        "invalid_response",
                                        "O Groq retornou uma resposta inválida.",
                                    )
                                })?
                                .trim()
                                .into(),
                            start_us,
                            end_us,
                            language: value["language"].as_str().map(str::to_owned),
                        })
                    })
                    .collect();
            }
            _ => return Err(error("groq_http", "O Groq recusou a chamada.")),
        }
    }
    unreachable!()
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
