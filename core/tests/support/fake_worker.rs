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
/// enquanto CLIPES_FAKE_WORKER_HOLD existir, segura o pedido (atendendo `cancel`) e,
/// se CLIPES_FAKE_WORKER_HELD estiver definido, cria esse arquivo ao entrar na espera.
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
                if hold.as_ref().is_some_and(|h| h.exists()) {
                    if let Some(held) = std::env::var_os("CLIPES_FAKE_WORKER_HELD") {
                        let _ = fs::write(held, b"1");
                    }
                }
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
                if message["task"] == "reframe" {
                    if let Some(log) = std::env::var_os("CLIPES_FAKE_REFRAME_LOG") {
                        fs::write(log, params.to_string()).unwrap();
                    }
                    let start = params["start_us"].as_i64().unwrap();
                    let end = params["end_us"].as_i64().unwrap();
                    let layout = params["layout"].as_str().unwrap_or("face");
                    let x = if std::env::var_os("CLIPES_FAKE_REFRAME_INVALID").is_some() {
                        5.0
                    } else {
                        0.25
                    };
                    send(
                        &mut out,
                        serde_json::json!({"v":1,"type":"progress","id":id,"stage":"reframe_faces","percentage":50,"message":"Analisando"}),
                    );
                    let mut data = serde_json::json!({
                        "schemaVersion":1,"revision":1,"status":"suggestion",
                        "segments":[{"startUs":start,"endUs":end,"reason":"start","keyframes":[{"timeUs":start,"x":x,"y":0.0,"width":0.31640625,"height":1.0,"confidence":0.9}]}],
                        "metrics":{"device":"cpu","frames":1,"elapsedMs":1}
                    });
                    if matches!(layout, "gameplay_webcam" | "two_people") {
                        data["segments"][0]["keyframes"][0]["confidence"] = serde_json::json!(0.45);
                        data["secondarySegments"] = serde_json::json!([
                            {"startUs":start,"endUs":end,"reason":"start","keyframes":[{"timeUs":start,"x":0.40,"y":0.0,"width":0.45,"height":1.0,"confidence":0.5}]}
                        ]);
                        if layout == "gameplay_webcam" {
                            data["metrics"]["webcamDetected"] = serde_json::json!(true);
                            data["metrics"]["webcamConfidence"] = serde_json::json!(0.45);
                        }
                    }
                    send(
                        &mut out,
                        serde_json::json!({"v":1,"type":"result","id":id,"data":data}),
                    );
                    continue;
                }
                if let Some(log) = std::env::var_os("CLIPES_FAKE_LANGUAGE_LOG") {
                    if message["task"] == "transcribe" {
                        let mut file = fs::OpenOptions::new()
                            .create(true)
                            .append(true)
                            .open(log)
                            .unwrap();
                        writeln!(file, "{}", params["language"].as_str().unwrap_or("")).unwrap();
                    }
                }
                if let Some(log) = std::env::var_os("CLIPES_FAKE_TRANSCRIBE_LOG") {
                    if message["task"] == "transcribe" {
                        let mut file = fs::OpenOptions::new()
                            .create(true)
                            .append(true)
                            .open(log)
                            .unwrap();
                        writeln!(
                            file,
                            "{} {} {} {}",
                            params["model"]["id"].as_str().unwrap_or(""),
                            params["model"]["device"].as_str().unwrap_or(""),
                            params["model"]["compute_type"].as_str().unwrap_or(""),
                            params["group_size"].as_u64().unwrap_or(1)
                        )
                        .unwrap();
                    }
                }
                // CLIPES_FAKE_GROUP_OOM=n: falta de memória em `transcribe` com `group_size` >= n (#162).
                if message["task"] == "transcribe"
                    && params["group_size"].as_u64().unwrap_or(1)
                        >= std::env::var("CLIPES_FAKE_GROUP_OOM")
                            .ok()
                            .and_then(|n| n.parse().ok())
                            .unwrap_or(u64::MAX)
                {
                    send(
                        &mut out,
                        serde_json::json!({"v":1,"type":"error","id":id,"code":"out_of_memory","message":"x"}),
                    );
                    continue;
                }
                if message["task"] == "probe" {
                    probe_reply(&mut out, &id, params);
                    continue;
                }
                if message["task"] == "align" {
                    align_reply(&mut out, &id, params);
                    continue;
                }
                if message["task"] == "vad" {
                    if let Some(wav_seconds) = params["audio"]
                        .as_str()
                        .and_then(|p| fs::read(p).ok())
                        .and_then(|b| wav_duration_info(&b))
                    {
                        let (sr, ch, dur_us) = wav_seconds;
                        if let Some(log) = std::env::var_os("CLIPES_FAKE_VAD_LOG") {
                            let mut file = fs::OpenOptions::new()
                                .create(true)
                                .append(true)
                                .open(log)
                                .unwrap();
                            writeln!(file, "{sr} {ch} {dur_us}").unwrap();
                        }
                        if std::env::var("CLIPES_FAKE_VAD_EMPTY").as_deref() == Ok("1") {
                            send(
                                &mut out,
                                serde_json::json!({"v":1,"type":"result","id":id,"data":{"covered_us":dur_us,"spans":[],"silences":[{"start_us":0,"end_us":dur_us}]}}),
                            );
                            continue;
                        }
                        if let Ok(trim) = std::env::var("CLIPES_FAKE_VAD_TRIM_US") {
                            if let Some((a, b)) = trim.split_once(',') {
                                if let (Ok(s_us), Ok(e_us)) =
                                    (a.trim().parse::<i64>(), b.trim().parse::<i64>())
                                {
                                    let mut silences = Vec::new();
                                    if s_us > 0 {
                                        silences.push(serde_json::json!({"start_us":0,"end_us":s_us.min(dur_us)}));
                                    }
                                    if e_us < dur_us {
                                        silences.push(serde_json::json!({"start_us":e_us.max(0),"end_us":dur_us}));
                                    }
                                    send(
                                        &mut out,
                                        serde_json::json!({"v":1,"type":"result","id":id,"data":{"covered_us":dur_us,"spans":[{"start_us":s_us,"end_us":e_us}],"silences":silences}}),
                                    );
                                    continue;
                                }
                            }
                        }
                        send(
                            &mut out,
                            serde_json::json!({"v":1,"type":"result","id":id,"data":{"covered_us":dur_us,"spans":[{"start_us":0,"end_us":dur_us}],"silences":[]}}),
                        );
                        continue;
                    }
                }
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
                let silent_blocks = std::env::var("CLIPES_FAKE_SILENT_BLOCKS")
                    .ok()
                    .and_then(|n| n.parse::<usize>().ok())
                    .unwrap_or(0);
                let covered = if params["final"] == true {
                    seconds
                } else if requests <= silent_blocks {
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
                let lang = params["language"].as_str().unwrap_or("pt");
                let (words, silences) = if requests <= silent_blocks {
                    (
                        Vec::new(),
                        vec![serde_json::json!({"start_us": 0, "end_us": (covered * 1e6) as i64})],
                    )
                } else {
                    let words: Vec<Value> = (0..covered.floor() as i64)
                        .map(|k| serde_json::json!({"text":"palavra","start_us":k * 1_000_000 + 100_000,"end_us":k * 1_000_000 + 500_000,"language":lang}))
                        .collect();
                    let silences: Vec<Value> = (0..covered.floor() as i64)
                        .flat_map(|k| {
                            [
                                serde_json::json!({"start_us":k * 1_000_000,"end_us":k * 1_000_000 + 100_000}),
                                serde_json::json!({"start_us":k * 1_000_000 + 500_000,"end_us":(k + 1) * 1_000_000}),
                            ]
                        })
                        .collect();
                    (words, silences)
                };
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
    if exe.file_stem().is_some_and(|s| s == "nvidia-smi") {
        return nvidia_smi(&args);
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

fn wav_duration_info(bytes: &[u8]) -> Option<(u32, u16, i64)> {
    if bytes.len() < 44 || &bytes[0..4] != b"RIFF" || &bytes[8..12] != b"WAVE" {
        return None;
    }
    let channels = u16::from_le_bytes([bytes[22], bytes[23]]);
    let sample_rate = u32::from_le_bytes([bytes[24], bytes[25], bytes[26], bytes[27]]);
    let byte_rate = u32::from_le_bytes([bytes[28], bytes[29], bytes[30], bytes[31]]);
    if channels == 0 || sample_rate == 0 || byte_rate == 0 {
        return None;
    }
    let mut pos = 12usize;
    while pos + 8 <= bytes.len() {
        let id = &bytes[pos..pos + 4];
        let size = u32::from_le_bytes(bytes[pos + 4..pos + 8].try_into().ok()?) as usize;
        if id == b"data" {
            let dur_us = ((u128::from(size as u32) * 1_000_000) / u128::from(byte_rate)) as i64;
            return Some((sample_rate, channels, dur_us.max(1)));
        }
        pos = pos + 8 + size + (size & 1);
    }
    None
}

/// Tarefa `align` (#81): valida que recebeu WAV 16 kHz mono e devolve `spoken_words` + `script_words`.
fn align_reply(out: &mut std::io::StdoutLock<'_>, id: &Value, params: &Value) {
    let send = |out: &mut std::io::StdoutLock<'_>, value: Value| {
        writeln!(out, "{value}").unwrap();
        out.flush().unwrap();
    };
    if let Ok(code) = std::env::var("CLIPES_FAKE_ALIGN_FAIL") {
        if !code.is_empty() {
            send(
                out,
                serde_json::json!({"v":1,"type":"error","id":id,"code":code,"message":"x"}),
            );
            return;
        }
    }
    let Some(audio_path) = params["audio"].as_str() else {
        send(
            out,
            serde_json::json!({"v":1,"type":"error","id":id,"code":"invalid_message","message":"x"}),
        );
        return;
    };
    let Ok(bytes) = fs::read(audio_path) else {
        send(
            out,
            serde_json::json!({"v":1,"type":"error","id":id,"code":"internal","message":"x"}),
        );
        return;
    };
    if bytes.len() < 44 || &bytes[0..4] != b"RIFF" || &bytes[8..12] != b"WAVE" {
        send(
            out,
            serde_json::json!({"v":1,"type":"error","id":id,"code":"invalid_message","message":"x"}),
        );
        return;
    }
    let channels = u16::from_le_bytes([bytes[22], bytes[23]]);
    let sample_rate = u32::from_le_bytes([bytes[24], bytes[25], bytes[26], bytes[27]]);
    if channels != 1 || sample_rate != 16_000 {
        send(
            out,
            serde_json::json!({"v":1,"type":"error","id":id,"code":"invalid_message","message":"x"}),
        );
        return;
    }
    if let Some(log) = std::env::var_os("CLIPES_FAKE_ALIGN_LOG") {
        let mut file = fs::OpenOptions::new()
            .create(true)
            .append(true)
            .open(log)
            .unwrap();
        writeln!(
            file,
            "{} {} {} {}",
            params["language"].as_str().unwrap_or(""),
            channels,
            sample_rate,
            params["text"].as_str().unwrap_or("")
        )
        .unwrap();
    }
    let text = params["text"].as_str().unwrap_or("");
    let script_words: Vec<Value> = text
        .split_whitespace()
        .enumerate()
        .map(|(i, w)| {
            let s = 100_000 + i as i64 * 250_000;
            serde_json::json!({"text":w,"start_us":s,"end_us":s+200_000,"probability":0.95})
        })
        .collect();
    let spoken_src = std::env::var("CLIPES_FAKE_ALIGN_SPOKEN").ok();
    let spoken_text = spoken_src
        .as_deref()
        .filter(|s| !s.trim().is_empty())
        .unwrap_or(text);
    let spoken_words: Vec<Value> = spoken_text
        .split_whitespace()
        .enumerate()
        .map(|(i, w)| {
            let s = 110_000 + i as i64 * 240_000;
            serde_json::json!({"text":w,"start_us":s,"end_us":s+190_000})
        })
        .collect();
    send(
        out,
        serde_json::json!({"v":1,"type":"progress","id":id,"stage":"aligning","percentage":50,"message":"Alinhando"}),
    );
    send(
        out,
        serde_json::json!({"v":1,"type":"result","id":id,"data":{"spoken_words":spoken_words,"script_words":script_words,"silences":[]}}),
    );
}

/// Tarefa `probe` do Motor local (#50). `CLIPES_FAKE_PROBE_FAIL` é uma lista separada por vírgulas:
/// `fail:<precisão>` (erro interno na GPU), `oom:<lote>` (falta de memória na GPU de lote >= n) e
/// `hang:<precisão>` (nunca responde). `CLIPES_FAKE_PROBE_LOG` recebe uma linha por pedido, com o pid.
fn probe_reply(out: &mut std::io::StdoutLock<'_>, id: &Value, params: &Value) {
    let send = |out: &mut std::io::StdoutLock<'_>, value: Value| {
        writeln!(out, "{value}").unwrap();
        out.flush().unwrap();
    };
    let mode = params["mode"].as_str().unwrap_or("");
    let device = params["model"]["device"].as_str().unwrap_or("");
    let compute = params["model"]["compute_type"].as_str().unwrap_or("");
    let batch = params["batch_size"].as_u64().unwrap_or(1);
    if let Some(log) = std::env::var_os("CLIPES_FAKE_PROBE_LOG") {
        let mut file = fs::OpenOptions::new()
            .create(true)
            .append(true)
            .open(log)
            .unwrap();
        writeln!(
            file,
            "{} {mode} {device} {compute} {batch}",
            std::process::id()
        )
        .unwrap();
    }
    let rules = std::env::var("CLIPES_FAKE_PROBE_FAIL").unwrap_or_default();
    let has = |rule: String| rules.split(',').any(|r| r == rule);
    let error = |out: &mut std::io::StdoutLock<'_>, code: &str| {
        send(
            out,
            serde_json::json!({"v":1,"type":"error","id":id,"code":code,"message":"x"}),
        )
    };
    if mode == "info" && has("fail:info".into()) {
        return error(out, "internal");
    }
    if device == "cuda" && has(format!("hang:{compute}")) {
        loop {
            std::thread::sleep(std::time::Duration::from_secs(1));
        }
    }
    if device == "cuda" && has(format!("fail:{compute}")) {
        return error(out, "internal");
    }
    if device == "cuda" && (1..=8).any(|n| batch >= n && has(format!("oom:{n}"))) {
        return error(out, "out_of_memory");
    }
    let data = match mode {
        "info" => {
            let types = std::env::var("CLIPES_FAKE_CUDA_TYPES")
                .unwrap_or_else(|_| "float16,int8,int8_float16".into());
            serde_json::json!({"ct2_version":"4.9.0","cuda_compute_types":types.split(',').collect::<Vec<_>>()})
        }
        "clip" => {
            let words = if batch == 1 {
                serde_json::json!({"pt":9,"en":9})
            } else {
                serde_json::json!({"pt":72})
            };
            serde_json::json!({"load_s":1.5,"run_s":2.0,"audio_s":18.0,"words":words})
        }
        _ => {
            let seconds: f64 = params["audio"]
                .as_str()
                .and_then(|p| fs::read_to_string(p).ok())
                .and_then(|t| t.trim().parse().ok())
                .unwrap_or(-1.0);
            if seconds < 0.0 {
                return error(out, "internal");
            }
            send(
                out,
                serde_json::json!({"v":1,"type":"progress","id":id,"stage":"transcribing","percentage":50,"message":"Transcrevendo"}),
            );
            let rate: f64 = std::env::var("CLIPES_FAKE_PROBE_RATE")
                .ok()
                .and_then(|r| r.parse().ok())
                .unwrap_or(0.5);
            serde_json::json!({"load_s":10.0,"run_s":seconds*rate,"audio_s":seconds,"words":seconds as u64})
        }
    };
    send(
        out,
        serde_json::json!({"v":1,"type":"result","id":id,"data":data}),
    );
}

/// `nvidia-smi` falso: `-L` e a consulta de VRAM, a partir de CLIPES_FAKE_GPU
/// ("nome, driver, total, livre"); sem a variável, falha como um PC sem NVIDIA.
fn nvidia_smi(args: &[String]) {
    let Ok(gpu) = std::env::var("CLIPES_FAKE_GPU") else {
        std::process::exit(9);
    };
    if args.iter().any(|a| a == "-L") {
        println!("GPU 0: {}", gpu.split(',').next().unwrap());
    } else {
        println!("{gpu}");
    }
}
