//! Chave do Motor Groq: um item próprio no cofre global do sistema.
use super::*;
pub(super) const ENDPOINT: &str = "https://api.groq.com/openai/v1/audio/transcriptions";
pub(super) const MODEL: &str = "whisper-large-v3-turbo";

pub(super) fn estimate_cost(model: &str, duration_us: i64) -> Value {
    let prices: Value =
        serde_json::from_str(include_str!("groq-prices.json")).expect("embedded prices");
    match prices["models"][model].as_f64() {
        Some(hourly) => {
            let usd = (duration_us.max(10_000_000) as f64 / 3_600_000_000.0) * hourly;
            json!({"kind":"usd","usd":usd,"minMicroUsd":(usd*1e6).floor() as u64,"maxMicroUsd":(usd*1e6).ceil() as u64,"audio_us":duration_us,"hourly_usd":hourly,"source":prices["source"],"checked":prices["checked"]})
        }
        None => json!({"kind":"unknown"}),
    }
}

/// Motor remoto: VAD local compartilhado, FLAC sem perda, uma chamada por bloco.
pub struct GroqEngine {
    client: WorkerClient,
    endpoint: String,
    key: String,
    ffmpeg: std::path::PathBuf,
    context: (i64, i64, i64),
    timeout: Duration,
}

impl GroqEngine {
    pub(super) fn start() -> Result<Self, CoreError> {
        remote::guard()?;
        let key =
            get_key()?.ok_or_else(|| error("groq_key_missing", "Configure a chave do Groq."))?;
        let (_, _, ffmpeg) = crate::components::cache_settings()?;
        Ok(Self::with_worker(
            start_worker()?,
            key,
            ENDPOINT.into(),
            ffmpeg.ok_or_else(|| error("component_missing", "Instale o Componente FFmpeg."))?,
            Duration::from_secs(120),
        ))
    }

    /// Seam headless: worker e servidor falsos; a UI não aceita endpoint nem chave.
    pub fn with_worker(
        client: WorkerClient,
        key: String,
        endpoint: String,
        ffmpeg: std::path::PathBuf,
        timeout: Duration,
    ) -> Self {
        Self {
            client,
            key,
            endpoint,
            ffmpeg,
            context: (0, 0, 0),
            timeout,
        }
    }
}

impl TranscriptionEngine for GroqEngine {
    fn prepare(&mut self, job: i64, transcript: i64, resume_us: i64) {
        self.context = (job, transcript, resume_us);
    }

    fn transcribe_block(
        &mut self,
        input: &BlockRequest<'_>,
        cancel: &AtomicBool,
        progress: &mut dyn FnMut(u8),
    ) -> Result<BlockResult, CoreError> {
        remote::guard()?;
        let vad = self.client.run(
            "vad",
            json!({"audio":input.audio,"final":input.final_block}),
            cancel,
            &mut |_| {},
        )?;
        let covered = micros(&vad["covered_us"])?;
        if covered == 0 {
            return Err(bad_result());
        }
        let spans = vad["spans"].as_array().ok_or_else(bad_result)?;
        let mut block_data = vad.clone();
        block_data["words"] = json!([]);
        let mut block = parse_block(&block_data)?;
        if spans.is_empty() {
            return Ok(block);
        }
        let flac = input.audio.with_extension("flac");
        let (job, transcript, resume) = self.context;
        extract(
            &self.ffmpeg,
            &Slice {
                source: input.audio,
                track: 0,
                start_us: 0,
                len_us: covered,
            },
            &flac,
            job,
            cancel,
        )?;
        let audio = fs::read(&flac).map_err(|_| audio_failed());
        let _ = fs::remove_file(&flac);
        let audio = audio?;
        if audio.len() > 24_000_000 {
            return Err(error(
                "audio_too_large",
                "O bloco de áudio excede o limite do Groq.",
            ));
        }
        if cancel.load(Ordering::SeqCst) {
            return Err(error("cancelled", "Transcrição cancelada."));
        }
        let token = crate::provider::CancelToken::new();
        let finished = AtomicBool::new(false);
        let mut response_sha256 = None;
        let call = remote::begin(job, transcript, resume, covered, &self.endpoint, &audio)?;
        progress(0);
        let result = std::thread::scope(|scope| {
            scope.spawn(|| {
                while !finished.load(Ordering::SeqCst) {
                    if cancel.load(Ordering::SeqCst) {
                        token.cancel();
                        break;
                    }
                    std::thread::sleep(Duration::from_millis(20));
                }
            });
            let result = request_audited(
                &self.endpoint,
                &self.key,
                &audio,
                &token,
                self.timeout,
                &mut response_sha256,
            );
            finished.store(true, Ordering::SeqCst);
            result
        });
        remote::audit_response(call, response_sha256);
        match result {
            Ok(words) => {
                // Nunca aceitar tempos fora do bloco ou fora de ordem.
                if words.iter().any(|w| w.end_us > covered)
                    || words.windows(2).any(|w| w[0].start_us > w[1].start_us)
                {
                    remote::failed(call, true)?;
                    return Err(error(
                        "timeout_uncertain",
                        "O resultado da chamada ao Groq é incerto.",
                    ));
                }
                block.words = words;
                progress(100);
                Ok(block)
            }
            Err(e) => {
                // Uma resposta 2xx inválida já pode ter sido cobrada: preservar a
                // chamada e exigir a mesma confirmação de uma resposta perdida.
                let uncertain = matches!(e.code.as_str(), "timeout_uncertain" | "invalid_response");
                remote::failed(call, uncertain)?;
                if e.code == "invalid_response" {
                    Err(error(
                        "timeout_uncertain",
                        "O resultado da chamada ao Groq é incerto.",
                    ))
                } else {
                    Err(e)
                }
            }
        }
    }
}

#[cfg(test)]
static KEY: std::sync::Mutex<Option<String>> = std::sync::Mutex::new(None);

#[cfg(not(test))]
fn entry() -> Result<keyring::Entry, CoreError> {
    keyring::Entry::new("io.github.gustavohooo.clipes.transcription", "groq")
        .map_err(|_| error("vault", "Não foi possível acessar o cofre do sistema."))
}
#[cfg(not(test))]
pub(super) fn get_key() -> Result<Option<String>, CoreError> {
    match entry()?.get_password() {
        Ok(key) => Ok(Some(key)),
        Err(keyring::Error::NoEntry) => Ok(None),
        Err(_) => Err(error(
            "vault",
            "Não foi possível acessar o cofre do sistema.",
        )),
    }
}
#[cfg(test)]
pub(super) fn get_key() -> Result<Option<String>, CoreError> {
    Ok(KEY.lock().unwrap().clone())
}

fn status(_: Value, _: &mut EventSink<'_>) -> CommandResult {
    Ok(json!({"configured": get_key()?.is_some()}))
}
fn set(v: Value, _: &mut EventSink<'_>) -> CommandResult {
    let key = v["key"]
        .as_str()
        .map(str::trim)
        .filter(|s| !s.is_empty())
        .ok_or_else(|| error("invalid_key", "Informe a chave do Groq."))?;
    #[cfg(not(test))]
    entry()?
        .set_password(key)
        .map_err(|_| error("vault", "Não foi possível salvar a chave no cofre."))?;
    #[cfg(test)]
    {
        *KEY.lock().unwrap() = Some(key.to_owned());
    }
    Ok(json!({"configured": true}))
}
fn remove(_: Value, _: &mut EventSink<'_>) -> CommandResult {
    #[cfg(not(test))]
    match entry()?.delete_credential() {
        Ok(()) | Err(keyring::Error::NoEntry) => (),
        Err(_) => return Err(error("vault", "Não foi possível remover a chave do cofre.")),
    }
    #[cfg(test)]
    {
        *KEY.lock().unwrap() = None;
    }
    Ok(json!({"configured": false}))
}
inventory::submit! { CommandRegistration { name: "transcription.groq.key.status", execute: status } }
inventory::submit! { CommandRegistration { name: "transcription.groq.key.set", execute: set } }
inventory::submit! { CommandRegistration { name: "transcription.groq.key.remove", execute: remove } }

pub(super) fn test_endpoint(url: &str, key: &str) -> Result<(), CoreError> {
    let response = reqwest::blocking::Client::builder()
        .timeout(Duration::from_secs(15))
        .redirect(reqwest::redirect::Policy::none())
        .no_proxy()
        .build()
        .map_err(|_| error("network", "Não foi possível iniciar a conexão."))?
        .get(url)
        .bearer_auth(key)
        .send()
        .map_err(|_| error("network", "Não foi possível acessar o Groq."))?;
    match response.status().as_u16() {
        200..=299 => Ok(()),
        401 => Err(error("groq_key", "Chave do Groq inválida.")),
        _ => Err(error("groq_http", "O Groq recusou a chamada.")),
    }
}
fn test_key(_: Value, _: &mut EventSink<'_>) -> CommandResult {
    if projects::project_local_only()? {
        return Err(crate::provider::local_only_violation());
    }
    let key = get_key()?.ok_or_else(|| error("groq_key_missing", "Configure a chave do Groq."))?;
    test_endpoint("https://api.groq.com/openai/v1/models", &key)?;
    Ok(json!({"ok": true}))
}
inventory::submit! { CommandRegistration { name: "transcription.groq.key.test", execute: test_key } }

const BOUNDARY: &str = "clipes-transcription-boundary";

/// O corpo multipart exato enviado ao Groq (a trilha de auditoria, #125, conta seus bytes).
pub(super) fn multipart_body(audio: &[u8]) -> Vec<u8> {
    let boundary = BOUNDARY;
    let mut body = Vec::with_capacity(audio.len() + 1024);
    for (name, value) in [
        ("model", "whisper-large-v3-turbo"),
        ("response_format", "verbose_json"),
        ("timestamp_granularities[]", "word"),
    ] {
        body.extend_from_slice(
            format!(
                "--{boundary}
Content-Disposition: form-data; name=\"{name}\"

{value}
"
            )
            .as_bytes(),
        );
    }
    body.extend_from_slice(
        format!(
            "--{boundary}
Content-Disposition: form-data; name=\"file\"; filename=\"audio.flac\"
Content-Type: audio/flac

"
        )
        .as_bytes(),
    );
    body.extend_from_slice(audio);
    body.extend_from_slice(
        format!(
            "
--{boundary}--
"
        )
        .as_bytes(),
    );
    body
}

/// Só o host do endpoint (sem esquema, caminho, consulta, porta nem credenciais).
pub(super) fn host_of(endpoint: &str) -> Option<String> {
    reqwest::Url::parse(endpoint)
        .ok()?
        .host_str()
        .map(|h| h.trim_matches(['[', ']']).to_owned())
}

/// Cliente da API de transcrição. Não registra chave, áudio nem respostas.
#[cfg(test)]
pub(super) fn request(
    endpoint: &str,
    key: &str,
    audio: &[u8],
    cancel: &crate::provider::CancelToken,
    timeout: Duration,
) -> Result<Vec<Word>, CoreError> {
    request_audited(endpoint, key, audio, cancel, timeout, &mut None)
}

/// Como `request`, e guarda em `response_sha256` o SHA-256 do último corpo de resposta
/// recebido (qualquer status), para a trilha de auditoria (#125).
pub(super) fn request_audited(
    endpoint: &str,
    key: &str,
    audio: &[u8],
    cancel: &crate::provider::CancelToken,
    timeout: Duration,
    response_sha256: &mut Option<String>,
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
    let boundary = BOUNDARY;
    let body = multipart_body(audio);
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
        *response_sha256 = Some(crate::provider::cost::sha256_hex(&reply.2));
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
                    .and_then(|s| {
                        s.parse::<u64>().ok().or_else(|| {
                            httpdate::parse_http_date(s).ok().map(|date| {
                                date.duration_since(std::time::SystemTime::now())
                                    .unwrap_or_default()
                                    .as_secs()
                                    .saturating_add(1)
                            })
                        })
                    })
                    .ok_or_else(|| error("rate_limit", "O Groq limitou as chamadas."))?;
                let end = std::time::Instant::now()
                    .checked_add(Duration::from_secs(secs))
                    .ok_or_else(|| error("rate_limit", "O Groq limitou as chamadas."))?;
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
                            language: value["language"]
                                .as_str()
                                .and_then(language_code)
                                .map(str::to_owned),
                        })
                    })
                    .collect();
            }
            _ => return Err(error("groq_http", "O Groq recusou a chamada.")),
        }
    }
    unreachable!()
}

// Whisper tokenizer LANGUAGES, excluding the three-letter `yue`, which is not ISO-639-1.
// https://github.com/openai/whisper/blob/main/whisper/tokenizer.py
const LANGUAGES: &[(&str, &str)] = &[
    ("en", "english"),
    ("zh", "chinese"),
    ("de", "german"),
    ("es", "spanish"),
    ("ru", "russian"),
    ("ko", "korean"),
    ("fr", "french"),
    ("ja", "japanese"),
    ("pt", "portuguese"),
    ("tr", "turkish"),
    ("pl", "polish"),
    ("ca", "catalan"),
    ("nl", "dutch"),
    ("ar", "arabic"),
    ("sv", "swedish"),
    ("it", "italian"),
    ("id", "indonesian"),
    ("hi", "hindi"),
    ("fi", "finnish"),
    ("vi", "vietnamese"),
    ("he", "hebrew"),
    ("uk", "ukrainian"),
    ("el", "greek"),
    ("ms", "malay"),
    ("cs", "czech"),
    ("ro", "romanian"),
    ("da", "danish"),
    ("hu", "hungarian"),
    ("ta", "tamil"),
    ("no", "norwegian"),
    ("th", "thai"),
    ("ur", "urdu"),
    ("hr", "croatian"),
    ("bg", "bulgarian"),
    ("lt", "lithuanian"),
    ("la", "latin"),
    ("mi", "maori"),
    ("ml", "malayalam"),
    ("cy", "welsh"),
    ("sk", "slovak"),
    ("te", "telugu"),
    ("fa", "persian"),
    ("lv", "latvian"),
    ("bn", "bengali"),
    ("sr", "serbian"),
    ("az", "azerbaijani"),
    ("sl", "slovenian"),
    ("kn", "kannada"),
    ("et", "estonian"),
    ("mk", "macedonian"),
    ("br", "breton"),
    ("eu", "basque"),
    ("is", "icelandic"),
    ("hy", "armenian"),
    ("ne", "nepali"),
    ("mn", "mongolian"),
    ("bs", "bosnian"),
    ("kk", "kazakh"),
    ("sq", "albanian"),
    ("sw", "swahili"),
    ("gl", "galician"),
    ("mr", "marathi"),
    ("pa", "punjabi"),
    ("si", "sinhala"),
    ("km", "khmer"),
    ("sn", "shona"),
    ("yo", "yoruba"),
    ("so", "somali"),
    ("af", "afrikaans"),
    ("oc", "occitan"),
    ("ka", "georgian"),
    ("be", "belarusian"),
    ("tg", "tajik"),
    ("sd", "sindhi"),
    ("gu", "gujarati"),
    ("am", "amharic"),
    ("yi", "yiddish"),
    ("lo", "lao"),
    ("uz", "uzbek"),
    ("fo", "faroese"),
    ("ht", "haitian creole"),
    ("ps", "pashto"),
    ("tk", "turkmen"),
    ("nn", "nynorsk"),
    ("mt", "maltese"),
    ("sa", "sanskrit"),
    ("lb", "luxembourgish"),
    ("my", "myanmar"),
    ("bo", "tibetan"),
    ("tl", "tagalog"),
    ("mg", "malagasy"),
    ("as", "assamese"),
    ("tt", "tatar"),
    ("ln", "lingala"),
    ("ha", "hausa"),
    ("ba", "bashkir"),
    ("jw", "javanese"),
    ("su", "sundanese"),
];

pub(super) fn language_code(input: &str) -> Option<&'static str> {
    LANGUAGES
        .iter()
        .find(|(code, name)| input.eq_ignore_ascii_case(code) || input.eq_ignore_ascii_case(name))
        .map(|(code, _)| *code)
}
