//! Opt-in, synthetic contract research. Never selected by the ordinary test suite.
//! Run only the exact ignored test, with a persistent ledger outside the repository.
use super::*;
use std::{
    fs,
    path::PathBuf,
    sync::{Arc, Mutex},
    time::Instant,
};

fn env(name: &str) -> String {
    std::env::var(name).unwrap_or_else(|_| panic!("Missing manual probe configuration"))
}

fn cli_models(stdout: &[u8], stderr: &[u8]) -> Vec<String> {
    let mut models = Vec::new();
    if let Ok(value) = serde_json::from_slice::<Value>(stdout) {
        if let Some(usage) = value["modelUsage"].as_object() {
            models.extend(usage.keys().cloned());
        }
    }
    for line in String::from_utf8_lossy(stderr).lines() {
        if let Some(model) = line.trim().strip_prefix("model: ") {
            models.push(model.trim().to_owned());
        }
    }
    models.retain(|model| {
        !model.is_empty()
            && model.len() <= 128
            && model
                .chars()
                .all(|c| c.is_ascii_alphanumeric() || matches!(c, '-' | '_' | '.' | '/' | ':'))
    });
    models.sort();
    models.dedup();
    models
}

pub(crate) fn observe_cli(kind: &str, output: &std::process::Output) {
    if std::env::var("CLIPES_CONTRACT_AUTHORIZED").as_deref() != Ok("122") {
        return;
    }
    println!(
        "CONTRACT_CLI {}",
        json!({"adapter":kind,"models":cli_models(&output.stdout,&output.stderr),"exitedSuccessfully":output.status.success()})
    );
}

#[test]
fn cli_observation_exports_model_ids_without_raw_output() {
    assert_eq!(cli_models(br#"{"modelUsage":{"claude-synthetic-1":{},"not a model; private":{}},"private":"never export"}"#,
        b"private /personal/path\nmodel: gpt-synthetic-1\n"), vec!["claude-synthetic-1", "gpt-synthetic-1"]);
}

fn reserve(path: &PathBuf, service: &str, ceiling: u64) {
    let mut ledger: Value =
        serde_json::from_slice(&fs::read(path).expect("Could not read manual call ledger"))
            .expect("Invalid manual call ledger");
    let count = ledger[service]
        .as_u64()
        .expect("Service missing from manual call ledger");
    assert!(count < ceiling, "Manual call ceiling reached");
    ledger[service] = json!(count + 1);
    fs::write(path, ledger.to_string()).expect("Could not save manual call ledger");
}

fn request(native: bool, scenario: &str, sample: usize) -> StructuredRequest {
    let prompts = [
        "Synthetic story: A gardener planted a seed. Rain arrived. A flower opened.",
        "Synthetic story: A robot sorted red and blue blocks into two boxes.",
        "Synthetic story: A kite rose above an empty field and landed softly.",
    ];
    StructuredRequest {
        estimate_hint: Default::default(),
        instruction: if scenario == "refusal" {
            "This is a harmless synthetic refusal test. Refuse to summarize the story if you choose; otherwise return the requested JSON."
        } else {
            "Summarize the synthetic story. Return schemaVersion 1, a short summary, category story, and two keywords."
        }.into(),
        transcript: if scenario == "input_truncation" {
            "Synthetic filler line: the quick brown fox jumps over the lazy dog.\n".repeat(2000)
        } else {
            prompts[sample % prompts.len()].into()
        },
        schema: json!({"type":"object","properties":{
            "schemaVersion":{"type":"integer","enum":[1]},
            "summary":{"type":"string"},"category":{"type":"string","enum":["story"]},
            "keywords":{"type":"array","items":{"type":"string"}}
        },"required":["schemaVersion","summary","category","keywords"],"additionalProperties":false}),
        native_schema: native,
        max_output_tokens: Some(if scenario == "truncation" { 1 } else { 1024 }),
    }
}

fn measurement(result: &Result<Value, CoreError>, log: &[Value], elapsed: u128) -> Value {
    let code = result.as_ref().err().map_or("ok", |e| e.code.as_str());
    let usage = result.as_ref().ok().map(|v| &v["usage"]).or_else(|| {
        result
            .as_ref()
            .err()
            .and_then(|e| e.usage.as_ref())
            .map(|v| &v["usage"])
    });
    json!({"code":code,"valid":result.is_ok(),"durationMs":elapsed,
        "usageComplete":usage.is_some_and(|u| u["inputTokens"].is_u64() && u["outputTokens"].is_u64()),
        "calls":log.len(),
        "httpStatuses":log.iter().filter_map(|v| v["httpStatus"].as_u64()).collect::<Vec<_>>(),
        "firstInvalid":log.iter().any(|v| v["attempt"] == 0 && v["code"] == "invalid_json"),
        "finalInvalid":code == "invalid_json",
        "repairAttempted":log.iter().any(|v| v["attempt"] == 1),
        "rateLimited":log.iter().any(|v| v["code"] == "rate_limit"),
        "retryAfterPresent":log.iter().filter(|v| v["code"] == "rate_limit").map(|v| v["retryAfterPresent"].clone()).collect::<Vec<_>>(),
        "retryAfterSeconds":log.iter().filter(|v| v["code"] == "rate_limit").map(|v| v["retryAfterSeconds"].clone()).collect::<Vec<_>>()})
}

#[test]
fn probe_measurement_distinguishes_repair_from_success_and_omits_payloads() {
    let result = Ok(
        json!({"data":{"secret":"never export responses"},"usage":{"inputTokens":3,"outputTokens":4}}),
    );
    let log = vec![
        json!({"attempt":0,"code":"invalid_json"}),
        json!({"attempt":1,"code":"ok"}),
    ];
    let value = measurement(&result, &log, 10);
    assert_eq!(value["firstInvalid"], true);
    assert_eq!(value["finalInvalid"], false);
    assert_eq!(value["repairAttempted"], true);
    assert_eq!(value["usageComplete"], true);
    assert!(!value.to_string().contains("secret"));
    assert!(!value.to_string().contains("never export"));
}

#[test]
#[ignore = "manual real providers: explicit authorization, key files, persistent call ledger"]
fn real_provider_contract() {
    assert_eq!(env("CLIPES_CONTRACT_AUTHORIZED"), "122");
    let service = env("CLIPES_CONTRACT_SERVICE");
    let ledger = PathBuf::from(env("CLIPES_CONTRACT_LEDGER"));
    let data = tempfile::tempdir().expect("Could not isolate manual probe data");
    std::env::set_var("CLIPES_DATA_DIR", data.path());
    let gate = Arc::new(Mutex::new(Instant::now() - Duration::from_secs(60)));
    let (endpoint, ceiling, key) = match service.as_str() {
        "openrouter" => (
            "https://openrouter.ai/api/v1".to_owned(),
            150,
            Some("CLIPES_OPENROUTER_KEY_FILE"),
        ),
        "groq" => (
            "https://api.groq.com/openai/v1".to_owned(),
            60,
            Some("CLIPES_GROQ_KEY_FILE"),
        ),
        "ollama" | "lmstudio" | "llamacpp" => (env("CLIPES_CONTRACT_ENDPOINT"), 60, None),
        "codex" | "claude" => (String::new(), 5, None),
        _ => panic!("Unknown manual probe service"),
    };
    let key = key.map(|name| {
        fs::read_to_string(env(name))
            .expect("Could not read provider key file")
            .trim()
            .to_owned()
    });
    if !matches!(service.as_str(), "openrouter" | "groq" | "codex" | "claude") {
        assert!(
            is_loopback_endpoint(&endpoint),
            "Local probes require literal loopback"
        );
    }
    let models = env("CLIPES_CONTRACT_MODELS");
    for model in models.split(',').filter(|m| !m.is_empty()) {
        if service == "openrouter" {
            assert!(
                model.ends_with(":free"),
                "OpenRouter probe only allows free models"
            );
        }
        let cli = matches!(service.as_str(), "codex" | "claude");
        if cli {
            crate::dispatch(
                "provider.cli.configure",
                json!({"kind":service}),
                &mut |_| {},
            )
            .expect("Could not configure CLI");
            crate::dispatch("provider.cli.confirm", json!({"kind":service}), &mut |_| {})
                .expect("Could not confirm CLI");
        }
        let mut scenarios = Vec::new();
        for native in [true, false] {
            for sample in 0..3 {
                scenarios.push((native, "normal", sample));
            }
        }
        scenarios.extend([(true, "truncation", 0), (false, "refusal", 0)]);
        match std::env::var("CLIPES_CONTRACT_CASE")
            .as_deref()
            .unwrap_or("matrix")
        {
            "matrix" => {}
            "prompt-truncation" if !cli => scenarios = vec![(false, "truncation", 0)],
            "schema-smoke" if !cli => scenarios = vec![(true, "normal", 0), (false, "normal", 0)],
            // #145: a prompt larger than the context of a local server (start it with a small one).
            "input-truncation" if !cli => scenarios = vec![(false, "input_truncation", 0)],
            _ => panic!("Invalid manual probe case"),
        }
        if cli {
            scenarios = vec![
                (true, "normal", 0),
                (true, "normal", 1),
                (true, "refusal", 0),
            ];
        }
        for (native, scenario, sample) in scenarios {
            let req = request(native, scenario, sample);
            let start = Instant::now();
            let (result, log) = if cli {
                reserve(&ledger, &service, ceiling);
                let result = crate::dispatch(
                    "provider.structured",
                    serde_json::to_value(req).unwrap(),
                    &mut |_| {},
                );
                let code = result.as_ref().err().map_or("ok", |e| e.code.as_str());
                let log = vec![json!({"attempt":0,"code":code})];
                (result, log)
            } else {
                let ledger = ledger.clone();
                let service_name = service.clone();
                let gate = gate.clone();
                let guard = Box::new(move |_: &StructuredRequest, _: &[Value]| {
                    let mut last = gate.lock().unwrap();
                    // Pace every HTTP send, including automatic retries and repairs.
                    let delay = Duration::from_millis(3100).saturating_sub(last.elapsed());
                    std::thread::sleep(delay);
                    reserve(&ledger, &service_name, ceiling);
                    *last = Instant::now();
                    Ok(Value::Null)
                });
                control::with_call_scope(Some(6), Some(guard), || {
                    if service == "ollama" {
                        let p = OllamaProvider::new(endpoint.clone(), model.into(), key.clone())
                            .unwrap();
                        p.structured_with(&req, &CancelToken::new())
                    } else {
                        let mut p =
                            OpenAiProvider::new(endpoint.clone(), model.into(), key.clone())
                                .unwrap()
                                // Optional: the context the local server was started with (#145).
                                .with_context(
                                    std::env::var("CLIPES_CONTRACT_CONTEXT")
                                        .ok()
                                        .and_then(|v| v.parse().ok()),
                                );
                        p.confirm(true);
                        p.structured_with(&req, &CancelToken::new())
                    }
                })
            };
            let mut measured = measurement(&result, &log, start.elapsed().as_millis());
            measured["service"] = json!(service);
            measured["model"] = json!(model);
            measured["native"] = json!(native);
            measured["scenario"] = json!(scenario);
            measured["sample"] = json!(sample);
            // An allowlist only: never print errors, headers, request or response bodies.
            println!("CONTRACT {measured}");
        }
    }
}
