//! Tarefa de exemplo e Provedor falso compartilhados pelos testes do executor de IA (#121).
//! Nenhum teste acessa a rede. O comportamento do Provedor falso vem do prefixo da Transcrição.
#![allow(dead_code)]
use clipes_core::{
    ai_task::{AiTask, Budget, TaskInput, Violation},
    dispatch,
    provider::{CancelToken, Provider, StructuredRequest},
    CoreError,
};
use serde_json::{json, Value};
use std::{
    sync::{
        atomic::{AtomicBool, Ordering},
        Mutex,
    },
    time::{Duration, Instant},
};

const PROMPT: &str = include_str!("../../src/ai_task/example_prompt.md");
const WIRE: &str = r#"{"type":"object","properties":{"schemaVersion":{"type":"integer","enum":[1]},"picks":{"type":"array","items":{"type":"object","properties":{"id":{"type":"integer"},"note":{"type":"integer"}},"required":["id","note"],"additionalProperties":false}}},"required":["schemaVersion","picks"],"additionalProperties":false}"#;
const FULL: &str = r#"{"type":"object","properties":{"schemaVersion":{"const":1},"picks":{"type":"array","maxItems":3,"items":{"type":"object","properties":{"id":{"type":"integer","minimum":0},"note":{"type":"integer","minimum":0,"maximum":10}},"required":["id","note"],"additionalProperties":false}}},"required":["schemaVersion","picks"],"additionalProperties":false}"#;

fn ids_exist(input: &TaskInput, output: &Value) -> Vec<Violation> {
    let known: Vec<i64> = input.context["ids"]
        .as_array()
        .map(|a| a.iter().filter_map(Value::as_i64).collect())
        .unwrap_or_default();
    output["picks"]
        .as_array()
        .into_iter()
        .flatten()
        .enumerate()
        .filter(|(_, p)| !known.contains(&p["id"].as_i64().unwrap_or(-1)))
        .map(|(i, _)| {
            Violation::new(
                "unknown_sentence_id",
                format!("/picks/{i}/id"),
                "Sentence id is not in the window",
            )
        })
        .collect()
}

inventory::submit! {
    AiTask {
        id: "example",
        version: 1,
        prompt: PROMPT,
        prompt_sha256: "9b4e7b18b09bbdc1aa0e17f38f2af8e045c679b6c7e6f86068201ab399e8b1ae",
        wire_schema: WIRE,
        full_schema: FULL,
        verifiers: &[ids_exist],
        budget: Budget {
            max_calls: 2,
            max_input_tokens: 4000,
            max_output_tokens: 256,
            max_wall_clock_secs: 60,
            max_cost_micro_cents: None,
        },
    }
}

pub fn input(transcript: &str) -> TaskInput {
    TaskInput {
        transcript: transcript.into(),
        context: json!({"ids": [1, 2, 3]}),
        native_schema: false,
    }
}

pub fn good() -> Value {
    json!({"schemaVersion": 1, "picks": [{"id": 1, "note": 5}]})
}

/// `ok:` responde; `invalid:` falha com `invalid_json` e usage; `timeout:` estoura; `flaky:`
/// estoura na primeira chamada e responde nas seguintes; `block:` espera o cancelamento;
/// `hang:` nunca volta (o teste de queda mata o processo).
#[derive(Default)]
pub struct Fake {
    pub calls: Mutex<Vec<String>>,
    pub entered: AtomicBool,
    pub on_enter: Mutex<Option<Box<dyn Fn() + Send>>>,
}

impl Fake {
    pub fn count(&self, prefix: &str) -> usize {
        self.calls
            .lock()
            .unwrap()
            .iter()
            .filter(|t| t.starts_with(prefix))
            .count()
    }
    pub fn wait_entered(&self) {
        let deadline = Instant::now() + Duration::from_secs(20);
        while !self.entered.swap(false, Ordering::SeqCst) {
            assert!(Instant::now() < deadline, "provider call never started");
            std::thread::sleep(Duration::from_millis(10));
        }
    }
}

impl Provider for Fake {
    fn structured(&self, _: &StructuredRequest) -> Result<Value, CoreError> {
        unreachable!("the executor must use structured_with")
    }
    fn structured_with(
        &self,
        request: &StructuredRequest,
        cancel: &CancelToken,
    ) -> Result<Value, CoreError> {
        let text = request.transcript.clone();
        let seen = {
            let mut calls = self.calls.lock().unwrap();
            calls.push(text.clone());
            calls.iter().filter(|t| **t == text).count()
        };
        let reply = || {
            Ok(json!({"data": good(), "usage": {"inputTokens": 10, "outputTokens": 5}, "calls": 1}))
        };
        let error = |code: &str, usage: Option<Value>| CoreError {
            code: code.into(),
            message: "fixed".into(),
            usage,
        };
        if text.starts_with("ok:") {
            reply()
        } else if text.starts_with("invalid:") {
            Err(error(
                "invalid_json",
                Some(json!({"usage": {"inputTokens": 10, "outputTokens": 5}, "calls": 2})),
            ))
        } else if text.starts_with("timeout:") || (text.starts_with("flaky:") && seen == 1) {
            Err(error("timeout_uncertain", None))
        } else if text.starts_with("flaky:") {
            reply()
        } else {
            // block: / hang:
            self.entered.store(true, Ordering::SeqCst);
            if let Some(hook) = self.on_enter.lock().unwrap().as_ref() {
                hook();
            }
            loop {
                if text.starts_with("block:") && cancel.is_cancelled() {
                    return Err(error("cancelled", None));
                }
                std::thread::sleep(Duration::from_millis(10));
            }
        }
    }
}

pub fn wait_state(id: i64, state: &str) -> Value {
    let deadline = Instant::now() + Duration::from_secs(30);
    loop {
        let jobs = dispatch("jobs.list", json!({}), &mut |_| {}).unwrap();
        let job = jobs
            .as_array()
            .unwrap()
            .iter()
            .find(|j| j["id"] == id)
            .unwrap()
            .clone();
        if job["state"] == state {
            return job;
        }
        assert!(
            Instant::now() < deadline,
            "job {id} is {} not {state}",
            job["state"]
        );
        std::thread::sleep(Duration::from_millis(20));
    }
}

pub fn result(id: i64) -> Value {
    dispatch("jobs.result", json!({"id": id}), &mut |_| {}).unwrap()
}
