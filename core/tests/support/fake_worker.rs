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
    let scenario = args
        .iter()
        .position(|a| a == "--scenario")
        .map(|i| args[i + 1].as_str())
        .unwrap_or("handshake");
    worker(scenario);
}
