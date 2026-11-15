//! Worker (e `uv`) falso para os testes do núcleo. O comportamento depende do
//! nome do executável: `uv` simula o instalador; qualquer outro nome simula o
//! worker, reproduzindo uma conversa de worker/protocol/examples/*.jsonl.

use serde_json::Value;
use std::{
    fs,
    io::{BufRead, Write},
    path::PathBuf,
};

const EXAMPLES: &[(&str, &str)] = &[
    (
        "handshake",
        include_str!("../../../worker/protocol/examples/handshake.jsonl"),
    ),
    (
        "run-ok",
        include_str!("../../../worker/protocol/examples/run-ok.jsonl"),
    ),
    (
        "cancel",
        include_str!("../../../worker/protocol/examples/cancel.jsonl"),
    ),
    (
        "error",
        include_str!("../../../worker/protocol/examples/error.jsonl"),
    ),
    (
        "transcribe-block",
        include_str!("../../../worker/protocol/examples/transcribe-block.jsonl"),
    ),
    (
        "vad-block",
        include_str!("../../../worker/protocol/examples/vad-block.jsonl"),
    ),
    (
        "model-swap",
        include_str!("../../../worker/protocol/examples/model-swap.jsonl"),
    ),
];

fn matches(expected: &Value, actual: &Value) -> bool {
    match (expected, actual) {
        (Value::String(s), _) if s == "*" => true,
        (Value::Object(e), Value::Object(a)) => {
            e.len() == a.len()
                && e.iter()
                    .all(|(k, v)| a.get(k).is_some_and(|x| matches(v, x)))
        }
        _ => expected == actual,
    }
}
fn fill(value: &mut Value) {
    match value {
        Value::String(s) if s == "*" => *s = "fake".into(),
        Value::Object(map) => map.values_mut().for_each(fill),
        _ => {}
    }
}

fn worker(scenario: &str) {
    let text = EXAMPLES
        .iter()
        .find(|(n, _)| *n == scenario)
        .expect("cenário")
        .1;
    let stdin = std::io::stdin();
    let mut input = stdin.lock().lines();
    let mut out = std::io::stdout().lock();
    for line in text.lines().filter(|l| !l.trim().is_empty()) {
        let entry: Value = serde_json::from_str(line).unwrap();
        let mut message = entry["message"].clone();
        if entry["from"] == "worker" {
            fill(&mut message);
            writeln!(out, "{message}").unwrap();
            out.flush().unwrap();
        } else {
            let Some(Ok(received)) = input.next() else {
                std::process::exit(0)
            };
            let actual: Value = serde_json::from_str(&received).unwrap_or(Value::Null);
            if !matches(&message, &actual) {
                eprintln!("esperado {message}, recebido {actual}");
                std::process::exit(3);
            }
        }
    }
}

/// Modo `transcribe` (CLIPES_FAKE_WORKER_MODE=transcribe): fala o protocolo de verdade e
/// deriva as palavras do pedido, uma por segundo coberto (início em k+0,1 s). O áudio falso
/// do ffmpeg falso guarda só a duração do bloco em segundos. Se CLIPES_FAKE_WORKER_CRASH
/// apontar para um arquivo existente, o worker o apaga e morre no segundo pedido do processo;
/// enquanto CLIPES_FAKE_WORKER_HOLD existir, segura o pedido (atendendo `cancel`).
fn transcribe_worker() {
    use std::sync::mpsc;
    let (tx, rx) = mpsc::channel::<Value>();
    std::thread::spawn(move || {
        for line in std::io::stdin().lock().lines() {
            let Ok(line) = line else { break };
            if let Ok(value) = serde_json::from_str::<Value>(&line) {
                if tx.send(value).is_err() {
                    break;
                }
            }
        }
    });
    let mut out = std::io::stdout().lock();
    let mut requests = 0;
    let send = |out: &mut std::io::StdoutLock<'_>, value: Value| {
        writeln!(out, "{value}").unwrap();
        out.flush().unwrap();
    };
    while let Ok(message) = rx.recv() {
        match message["type"].as_str() {
            Some("hello") => send(
                &mut out,
                serde_json::json!({"v":1,"type":"handshake","protocol":1,"worker":"fake","python":"fake","libs":{"faster-whisper":"fake"}}),
            ),
            Some("shutdown") => return,
            Some("request") => {
                requests += 1;
                let id = message["id"].clone();
                if requests == 2 {
                    if let Some(flag) = std::env::var_os("CLIPES_FAKE_WORKER_CRASH") {
                        let flag = PathBuf::from(flag);
                        if flag.exists() {
                            fs::remove_file(flag).unwrap();
                            std::process::exit(1);
                        }
                    }
                }
                let hold = std::env::var_os("CLIPES_FAKE_WORKER_HOLD").map(PathBuf::from);
                let mut cancelled = false;
                while hold.as_ref().is_some_and(|h| h.exists()) {
                    if let Ok(m) = rx.recv_timeout(std::time::Duration::from_millis(20)) {
                        cancelled |= m["type"] == "cancel";
                    }
                    if cancelled {
                        break;
                    }
                }
                if cancelled {
                    send(
                        &mut out,
                        serde_json::json!({"v":1,"type":"error","id":id,"code":"cancelled","message":"Tarefa cancelada."}),
                    );
                    continue;
                }
                let params = &message["params"];
                let seconds: f64 = params["audio"]
                    .as_str()
                    .and_then(|p| fs::read_to_string(p).ok())
                    .and_then(|t| t.trim().parse().ok())
                    .unwrap_or(-1.0);
                if seconds < 0.0 || !matches!(message["task"].as_str(), Some("transcribe" | "vad"))
                {
                    send(
                        &mut out,
                        serde_json::json!({"v":1,"type":"error","id":id,"code":"internal","message":"Erro interno do worker."}),
                    );
                    continue;
                }
                let covered = if params["final"] == true {
                    seconds
                } else {
                    (seconds - 2.0).max(1.0)
                };
                if message["task"] == "vad" {
                    let covered_us = (covered * 1e6) as i64;
                    send(
                        &mut out,
                        serde_json::json!({"v":1,"type":"result","id":id,"data":{"covered_us":covered_us,"spans":[{"start_us":0,"end_us":covered_us}],"silences":[]}}),
                    );
                    continue;
                }
                send(
                    &mut out,
                    serde_json::json!({"v":1,"type":"progress","id":id,"stage":"transcribing","percentage":50,"message":"Transcrevendo"}),
                );
                let words: Vec<Value> = (0..covered.floor() as i64)
                    .map(|k| serde_json::json!({"text":"palavra","start_us":k * 1_000_000 + 100_000,"end_us":k * 1_000_000 + 500_000,"language":"pt"}))
                    .collect();
                let silences: Vec<Value> = (0..covered.floor() as i64)
                    .flat_map(|k| {
                        [
                            serde_json::json!({"start_us":k * 1_000_000,"end_us":k * 1_000_000 + 100_000}),
                            serde_json::json!({"start_us":k * 1_000_000 + 500_000,"end_us":(k + 1) * 1_000_000}),
                        ]
                    })
                    .collect();
                send(
                    &mut out,
                    serde_json::json!({"v":1,"type":"result","id":id,"data":{"covered_us":(covered * 1e6) as i64,"words":words,"silences":silences}}),
                );
            }
            _ => {}
        }
    }
}

fn uv(args: &[String]) {
    let exe = std::env::current_exe().unwrap();
    let dir = exe.parent().unwrap();
    if args.first().map(String::as_str) == Some("--version") {
        let version = fs::read_to_string(dir.join("uv.version")).unwrap();
        println!("uv {} (fake)", version.trim());
        return;
    }
    let env = |k: &str| std::env::var_os(k).map(PathBuf::from);
    let worker_dir = env("UV_PYTHON_INSTALL_DIR")
        .unwrap()
        .parent()
        .unwrap()
        .to_path_buf();
    let mut log = fs::OpenOptions::new()
        .create(true)
        .append(true)
        .open(worker_dir.join("uv-calls.log"))
        .unwrap();
    writeln!(log, "ARGS {}", args.join(" ")).unwrap();
    for (key, value) in std::env::vars().filter(|(k, _)| k.starts_with("UV_")) {
        writeln!(log, "ENV {key}={value}").unwrap();
    }
    if args.first().map(String::as_str) == Some("sync") {
        fs::write(worker_dir.join("sync-started"), b"1").unwrap();
        if worker_dir.join("fake-hang").exists() {
            std::thread::sleep(std::time::Duration::from_secs(120));
        }
        let venv = env("UV_PROJECT_ENVIRONMENT").unwrap();
        let python = if cfg!(windows) {
            venv.join("Scripts").join("python.exe")
        } else {
            venv.join("bin").join("python")
        };
        fs::create_dir_all(python.parent().unwrap()).unwrap();
        fs::copy(&exe, python).unwrap();
    }
}

fn main() {
    let args: Vec<String> = std::env::args().skip(1).collect();
    let exe = std::env::current_exe().unwrap();
    if exe.file_stem().is_some_and(|s| s == "uv") {
        return uv(&args);
    }
    if std::env::var("CLIPES_FAKE_WORKER_MODE").as_deref() == Ok("transcribe") {
        return transcribe_worker();
    }
    let scenario = args
        .iter()
        .position(|a| a == "--scenario")
        .map(|i| args[i + 1].as_str())
        .unwrap_or("handshake");
    worker(scenario);
}
