//! Adapter capabilities are data (ADR-0008). Limits stay in the model catalog (#141)
//! and effective server discovery (#143), never copied into this registry.
use super::*;
use std::{collections::BTreeMap, sync::OnceLock};

#[derive(Clone, Copy, Debug, Deserialize, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum NativeSchema {
    ResponseFormat,
    OutputConfig,
    GenerationConfig,
    OllamaFormat,
    CliSchema,
    Prompt,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
pub struct Usage {
    pub input: String,
    pub output: String,
    pub thinking: Option<String>,
}

/// JSON pointers into the reply: a boolean `truncated` and the count of tokens the server
/// evaluated (llama.cpp `truncated` and `tokens_evaluated`).
#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct InputTruncationSignal {
    pub truncated: Option<String>,
    pub evaluated: Option<String>,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Capabilities {
    pub native_schema: NativeSchema,
    /// Availability varies by model/server. A protocol accepting a field is not proof
    /// that every model enforces it; the manual matrix records that distinction.
    pub native_schema_support: String,
    pub usage: Option<Usage>,
    pub refusal_pointer: Option<String>,
    pub truncation_pointer: Option<String>,
    pub truncation_values: Vec<String>,
    pub repair_native: bool,
    pub schema_always: bool,
    pub context_sources: Vec<String>,
    /// Where a server reports, on its own, that it cut the input (#145). Absent: the usage
    /// heuristic is the only defence.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub input_truncation_signal: Option<InputTruncationSignal>,
    #[serde(default, skip_serializing_if = "BTreeMap::is_empty")]
    pub models: BTreeMap<String, ModelObservation>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub observation: Option<ModelObservation>,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ModelObservation {
    pub native_schema_support: String,
    pub service: String,
    pub observed_at: String,
}

pub fn registry() -> &'static BTreeMap<String, Capabilities> {
    static REGISTRY: OnceLock<BTreeMap<String, Capabilities>> = OnceLock::new();
    REGISTRY.get_or_init(|| {
        serde_json::from_str(include_str!("capabilities.json"))
            .expect("Embedded adapter capabilities must be valid")
    })
}

pub fn lookup(kind: &str) -> Option<&'static Capabilities> {
    registry().get(kind)
}

/// A measured observation annotates availability; it never silently changes the
/// schema requested by a profile or substitutes a different model/provider.
pub fn for_model(kind: &str, model: &str) -> Option<Capabilities> {
    let mut capabilities = lookup(kind)?.clone();
    if let Some(observation) = capabilities.models.get(model).cloned() {
        capabilities.native_schema_support = observation.native_schema_support.clone();
        capabilities.observation = Some(observation);
    }
    capabilities.models.clear();
    Some(capabilities)
}

impl Capabilities {
    pub(super) fn usage_of(&self, response: &Value) -> (Option<u64>, Option<u64>) {
        let Some(usage) = &self.usage else {
            return (None, None);
        };
        let input = response.pointer(&usage.input).and_then(Value::as_u64);
        let mut output = response.pointer(&usage.output).and_then(Value::as_u64);
        if let Some(thinking) = usage
            .thinking
            .as_ref()
            .and_then(|p| response.pointer(p))
            .and_then(Value::as_u64)
        {
            output = output.and_then(|n| n.checked_add(thinking));
        }
        (input, output)
    }
    pub(crate) fn truncated(&self, response: &Value) -> bool {
        self.truncation_pointer
            .as_ref()
            .and_then(|p| response.pointer(p))
            .and_then(Value::as_str)
            .is_some_and(|reason| self.truncation_values.iter().any(|v| v == reason))
    }
    pub(super) fn input_truncation(&self, response: &Value) -> truncation::Explicit {
        let Some(signal) = &self.input_truncation_signal else {
            return truncation::Explicit::default();
        };
        let read = |p: &Option<String>| p.as_ref().and_then(|p| response.pointer(p));
        truncation::Explicit {
            truncated: read(&signal.truncated).and_then(Value::as_bool) == Some(true),
            evaluated: read(&signal.evaluated).and_then(Value::as_u64),
        }
    }
    pub(super) fn refused(&self, response: &Value) -> bool {
        self.refusal_pointer
            .as_ref()
            .and_then(|p| response.pointer(p))
            .and_then(Value::as_str)
            .is_some_and(|text| !text.is_empty())
    }
    pub(super) fn apply_schema(&self, body: &mut Value, schema: &Value) {
        match self.native_schema {
            NativeSchema::ResponseFormat => {
                body["response_format"] = json!({"type":"json_schema","json_schema":{"name":"clipes_response","strict":true,"schema":schema}})
            }
            NativeSchema::OutputConfig => {
                body["output_config"]["format"] = json!({"type":"json_schema","schema":schema})
            }
            NativeSchema::GenerationConfig => {
                body["generationConfig"]["responseMimeType"] = json!("application/json");
                body["generationConfig"]["responseJsonSchema"] = schema.clone();
            }
            NativeSchema::OllamaFormat => body["format"] = schema.clone(),
            NativeSchema::CliSchema | NativeSchema::Prompt => {}
        }
    }
}

fn list(args: Value, _: &mut crate::EventSink<'_>) -> crate::CommandResult {
    let value = if let Some(kind) = args.get("kind") {
        let kind = kind
            .as_str()
            .ok_or_else(|| error("invalid_settings", "Invalid provider type"))?;
        serde_json::to_value(
            for_model(kind, args["model"].as_str().unwrap_or(""))
                .ok_or_else(|| error("invalid_settings", "Invalid provider type"))?,
        )
    } else {
        serde_json::to_value(registry())
    };
    Ok(value.expect("Adapter capabilities are serializable"))
}
inventory::submit! { crate::CommandRegistration { name: "provider.capabilities", execute: list } }

#[cfg(test)]
mod tests {
    use super::*;
    use std::{io::Write, net::TcpListener, thread};

    #[test]
    fn call_metadata_records_only_sanitized_rate_limit_delay() {
        let listener = TcpListener::bind("127.0.0.1:0").unwrap();
        let endpoint = format!("http://{}", listener.local_addr().unwrap());
        let server = thread::spawn(move || {
            let (mut stream, _) = listener.accept().unwrap();
            super::super::test_http::read_request(&mut stream);
            write!(stream, "HTTP/1.1 429 Too Many Requests\r\nRetry-After: 120\r\nContent-Length: 2\r\nConnection: close\r\n\r\n{{}}").unwrap();
        });
        let provider = OpenAiProvider::new(endpoint, "fixture".into(), None).unwrap();
        let request = StructuredRequest {
            estimate_hint: Default::default(),
            instruction: "Synthetic".into(),
            transcript: "Synthetic".into(),
            schema: json!({"type":"object"}),
            native_schema: false,
            max_output_tokens: None,
        };
        let (reply, log) =
            control::with_call_scope(Some(1), None, || provider.structured(&request));
        assert_eq!(reply.unwrap_err().code, "rate_limit");
        assert_eq!(log[0]["retryAfterPresent"], true);
        assert_eq!(log[0]["retryAfterSeconds"], 120);
        assert_eq!(log[0]["httpStatus"], 429);
        server.join().unwrap();
    }

    #[test]
    fn fake_server_exercises_each_http_capability_record() {
        for kind in ["openai", "anthropic", "gemini", "ollama"] {
            for truncated in [false, true] {
                let listener = TcpListener::bind("127.0.0.1:0").unwrap();
                let endpoint = format!("http://{}", listener.local_addr().unwrap());
                let server = thread::spawn(move || {
                    let (mut stream, _) = listener.accept().unwrap();
                    let bytes = super::super::test_http::read_request(&mut stream);
                    let start = bytes.windows(4).position(|v| v == b"\r\n\r\n").unwrap() + 4;
                    let wire: Value = serde_json::from_slice(&bytes[start..]).unwrap();
                    let schema_pointer = match kind {
                        "openai" => "/response_format/json_schema/schema",
                        "anthropic" => "/output_config/format/schema",
                        "gemini" => "/generationConfig/responseJsonSchema",
                        _ => "/format",
                    };
                    assert_eq!(
                        wire.pointer(schema_pointer).unwrap(),
                        &json!({"type":"object","properties":{"schemaVersion":{"enum":[1]}},"required":["schemaVersion"],"additionalProperties":false})
                    );
                    if kind == "openai" {
                        assert_eq!(wire["response_format"]["json_schema"]["strict"], true);
                    }
                    let text = "{\"schemaVersion\":1}";
                    let body = match kind {
                        "openai" => json!({"choices":[{"message":{"content":text},"finish_reason":if truncated {"length"} else {"stop"}}],"usage":{"prompt_tokens":2,"completion_tokens":3}}),
                        "anthropic" => json!({"content":[{"type":"text","text":text}],"stop_reason":if truncated {"max_tokens"} else {"end_turn"},"usage":{"input_tokens":2,"output_tokens":3}}),
                        "gemini" => json!({"candidates":[{"content":{"parts":[{"text":text}]},"finishReason":if truncated {"MAX_TOKENS"} else {"STOP"}}],"usageMetadata":{"promptTokenCount":2,"candidatesTokenCount":2,"thoughtsTokenCount":1}}),
                        _ => json!({"message":{"content":text},"done_reason":if truncated {"length"} else {"stop"},"prompt_eval_count":2,"eval_count":3}),
                    }.to_string();
                    write!(
                        stream,
                        "HTTP/1.1 200 OK\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{}",
                        body.len(),
                        body
                    )
                    .unwrap();
                });
                let provider: Box<dyn Provider> = match kind {
                    "openai" => {
                        Box::new(OpenAiProvider::new(endpoint, "fixture".into(), None).unwrap())
                    }
                    "anthropic" => {
                        Box::new(AnthropicProvider::new(endpoint, "fixture".into(), None).unwrap())
                    }
                    "gemini" => {
                        Box::new(GeminiProvider::new(endpoint, "fixture".into(), None).unwrap())
                    }
                    _ => Box::new(OllamaProvider::new(endpoint, "fixture".into(), None).unwrap()),
                };
                let request = StructuredRequest {
                    estimate_hint: Default::default(),
                    instruction: "Synthetic".into(),
                    transcript: "Synthetic".into(),
                    schema: json!({"type":"object","properties":{"schemaVersion":{"enum":[1]}},"required":["schemaVersion"],"additionalProperties":false}),
                    native_schema: true,
                    max_output_tokens: None,
                };
                let reply = provider.structured(&request);
                let usage = if truncated {
                    let error = reply.unwrap_err();
                    assert_eq!(error.code, "output_truncated");
                    error.usage.unwrap()["usage"].clone()
                } else {
                    reply.unwrap()["usage"].clone()
                };
                assert_eq!(usage, json!({"inputTokens":2,"outputTokens":3}));
                server.join().unwrap();
            }
        }
    }
}
