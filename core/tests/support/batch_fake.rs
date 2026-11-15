//! Fontes semeadas e Provedor falso dos testes do lote de Fontes (#56). Sem rede: o Provedor
//! falso é injetado na fila e a Transcrição é gravada direto no Projeto. O comportamento vem
//! do marcador `tokN` que cada Fonte põe no próprio texto.
#![allow(dead_code)]
use clipes_core::{
    dispatch,
    projects::with_writer,
    provider::{CancelToken, Provider, StructuredRequest},
    CoreError,
};
use serde_json::{json, Value};
use std::{
    collections::HashMap,
    sync::{
        atomic::{AtomicBool, Ordering},
        Mutex,
    },
    time::{Duration, Instant},
};

pub fn call(name: &str, args: Value) -> Value {
    dispatch(name, args, &mut |_| {}).unwrap()
}
pub fn fail(name: &str, args: Value) -> CoreError {
    dispatch(name, args, &mut |_| {}).unwrap_err()
}

pub const SENTENCES: i64 = 240;

/// Fonte de 40 min com Transcrição completa; o texto leva o marcador `tok<n>`.
pub fn seed(n: i64) -> i64 {
    with_writer(|c| {
        c.execute("INSERT INTO sources(path,size,duration_us,partial_hash,metadata,permission,audio_track) VALUES (?1,1,2400000000,?2,'{}','{}',0)", (format!("C:/videos/live{n}.mp4"), format!("h{n}")))?;
        let source = c.last_insert_rowid();
        c.execute("INSERT INTO transcripts(source_id,audio_track,engine,model,revision,compute_type,state,resume_us,duration_us) VALUES (?1,0,'local','m','r','c','complete',2400000000,2400000000)", [source])?;
        let transcript = c.last_insert_rowid();
        for position in 0..SENTENCES * 10 {
            let text = if position % 10 == 9 {
                format!(" tok{n}.")
            } else {
                format!(" tok{n}")
            };
            c.execute("INSERT INTO transcript_words(transcript_id,position,kind,text,start_us,end_us,language) VALUES (?1,?2,'word',?3,?4,?5,'pt')", (transcript, position, text, position * 1_000_000, (position + 1) * 1_000_000))?;
        }
        Ok(source)
    })
    .unwrap()
}

#[derive(Clone)]
pub enum Behavior {
    Ok,
    Error(&'static str),
    /// Só volta quando o processo morre (teste de queda) ou a chamada é cancelada.
    Hang,
}

#[derive(Default)]
pub struct Fake {
    plan: Mutex<HashMap<i64, Behavior>>,
    calls: Mutex<Vec<i64>>,
    pub entered: AtomicBool,
    pub on_enter: Mutex<Option<Box<dyn Fn() + Send>>>,
}

fn token_of(text: &str) -> i64 {
    let at = text.find("tok").expect("a window carries its source token") + 3;
    text[at..]
        .chars()
        .take_while(char::is_ascii_digit)
        .collect::<String>()
        .parse()
        .unwrap()
}

impl Fake {
    pub fn set(&self, n: i64, behavior: Behavior) {
        self.plan.lock().unwrap().insert(n, behavior);
    }
    pub fn calls_of(&self, n: i64) -> usize {
        self.calls
            .lock()
            .unwrap()
            .iter()
            .filter(|c| **c == n)
            .count()
    }
    pub fn total(&self) -> usize {
        self.calls.lock().unwrap().len()
    }
    pub fn wait_entered(&self) {
        let deadline = Instant::now() + Duration::from_secs(60);
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
        let n = token_of(&request.transcript);
        self.calls.lock().unwrap().push(n);
        let behavior = self.plan.lock().unwrap().get(&n).cloned();
        match behavior.unwrap_or(Behavior::Ok) {
            Behavior::Ok => Ok(
                json!({"data": {"schemaVersion": 1, "candidates": []}, "usage": {"inputTokens": 3000, "outputTokens": 500}, "calls": 1}),
            ),
            Behavior::Error(code) => Err(CoreError {
                code: code.into(),
                message: "fixed".into(),
                usage: None,
            }),
            Behavior::Hang => {
                self.entered.store(true, Ordering::SeqCst);
                if let Some(hook) = self.on_enter.lock().unwrap().as_ref() {
                    hook();
                }
                loop {
                    if cancel.is_cancelled() {
                        return Err(CoreError {
                            code: "cancelled".into(),
                            message: "fixed".into(),
                            usage: None,
                        });
                    }
                    std::thread::sleep(Duration::from_millis(10));
                }
            }
        }
    }
}

pub fn configure(endpoint: &str, context: u64) {
    call(
        "provider.configure",
        json!({"endpoint": endpoint, "kind": "openai", "model": "fake-model", "context": context}),
    );
}

pub fn batch(id: i64) -> Value {
    call("batches.get", json!({"id": id}))
}

pub fn wait_batch(id: i64, what: &str, done: impl Fn(&Value) -> bool) -> Value {
    let deadline = Instant::now() + Duration::from_secs(90);
    loop {
        let value = batch(id);
        if done(&value) {
            return value;
        }
        assert!(
            Instant::now() < deadline,
            "batch {id} never {what}: {value}"
        );
        std::thread::sleep(Duration::from_millis(25));
    }
}

pub fn item_state(b: &Value, source: i64) -> String {
    b["items"]
        .as_array()
        .unwrap()
        .iter()
        .find(|i| i["sourceId"] == source)
        .unwrap()["state"]
        .as_str()
        .unwrap()
        .into()
}
