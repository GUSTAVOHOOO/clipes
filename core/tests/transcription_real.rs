//! Transcrição real, rodada à mão (`#[ignore]`): usa o worker Python de verdade, um modelo
//! faster-whisper já baixado e uma mídia real. Não roda no CI e acessa nenhuma rede.
//!
//! ```powershell
//! $env:CLIPES_REAL_PYTHON = "<venv>\Scripts\python.exe"   # com faster-whisper (e CUDA, se for o caso)
//! $env:CLIPES_REAL_MODEL_DIR = "<pasta do modelo com model.bin>"
//! $env:CLIPES_REAL_MEDIA = "<video.webm>"
//! $env:CLIPES_REAL_FFMPEG = "<ffmpeg.exe>"                # o ffprobe fica ao lado
//! $env:CLIPES_REAL_DEVICE = "cuda"                        # ou cpu (padrão: cuda)
//! cargo test -p clipes-core --test transcription_real -- --ignored --nocapture
//! ```
//!
//! No Windows com GPU NVIDIA, as DLLs de CUDA do ambiente entram no PATH como em
//! docs/agents/impedimentos.md.

use clipes_core::{
    projects,
    transcription::{run_with, LocalEngine},
    worker::WorkerClient,
};
use serde_json::{json, Value};
use std::{path::PathBuf, process::Command, sync::atomic::AtomicBool};

fn var(name: &str) -> String {
    std::env::var(name).unwrap_or_else(|_| panic!("defina {name}"))
}

#[test]
#[ignore = "usa modelo e GPU reais; rode à mão com --ignored"]
fn real_worker_transcribes_a_real_source_in_blocks() {
    let python = PathBuf::from(var("CLIPES_REAL_PYTHON"));
    let model_dir = var("CLIPES_REAL_MODEL_DIR");
    let media = var("CLIPES_REAL_MEDIA");
    let ffmpeg = PathBuf::from(var("CLIPES_REAL_FFMPEG"));
    let device = std::env::var("CLIPES_REAL_DEVICE").unwrap_or_else(|_| "cuda".into());
    let (compute_type, batch) = if device == "cuda" {
        ("int8_float16", 1)
    } else {
        ("int8", 8)
    };

    let root = tempfile::tempdir().unwrap();
    std::env::set_var("CLIPES_DATA_DIR", root.path().join("data"));
    std::env::set_var(
        "CLIPES_FFPROBE",
        ffmpeg.with_file_name(if cfg!(windows) {
            "ffprobe.exe"
        } else {
            "ffprobe"
        }),
    );
    std::env::set_var("CLIPES_TRANSCRIBE_BLOCK_SECONDS", "60");
    let run = |name: &str, args: Value| clipes_core::dispatch(name, args, &mut |_| {}).unwrap();
    run(
        "components.settings.set",
        json!({"data_dir":root.path().join("data"),"cache_dir":root.path().join("cache"),"cache_limit_bytes":1_000_000_000,"ffmpeg_path":ffmpeg}),
    );
    let project = run(
        "projects.create",
        json!({"parent":root.path(),"name":"Real"}),
    );
    let path = project["path"].as_str().unwrap().to_owned();
    let inspected = run("sources.inspect", json!({"path":media}));
    let track = inspected["streams"]
        .as_array()
        .unwrap()
        .iter()
        .find(|s| s["codec_type"] == "audio")
        .expect("a mídia precisa de uma faixa de áudio")["index"]
        .as_i64()
        .unwrap();
    let source = run(
        "sources.import",
        json!({"project":path,"path":media,"permission":{"status":"none"},"audio_track":track}),
    )["id"]
        .as_i64()
        .unwrap();
    // O job e a Transcrição são criados à mão (kind diferente de `transcribe`, para a fila
    // do Projeto não os pegar): este teste dispensa a instalação do worker e dos modelos.
    let (job, duration) = projects::with_writer(|c| {
        let duration: i64 = c.query_row("SELECT duration_us FROM sources WHERE id=?1", [source], |r| r.get(0))?;
        c.execute(
            "INSERT INTO transcripts(source_id,audio_track,engine,model,revision,compute_type,duration_us) VALUES (?1,?2,'local','real','real',?3,?4)",
            (source, track, compute_type, duration),
        )?;
        c.execute("INSERT INTO jobs(kind,safety,state,source_id) VALUES ('transcribe-manual','local','running',?1)", [source])?;
        Ok((c.last_insert_rowid(), duration))
    })
    .unwrap();

    let venv = python.parent().unwrap().parent().unwrap().to_owned();
    let worker_src = PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../worker/src");
    let client = WorkerClient::start(&python, ["-m", "clipes_worker"], |c: &mut Command| {
        c.env("PYTHONPATH", &worker_src)
            .env("PYTHONNOUSERSITE", "1")
            .env("PYTHONUTF8", "1");
        let nvidia: Vec<PathBuf> = ["cublas", "cudnn"]
            .iter()
            .map(|lib| venv.join("Lib/site-packages/nvidia").join(lib).join("bin"))
            .filter(|p| p.is_dir())
            .collect();
        let mut paths = nvidia;
        paths.extend(std::env::split_paths(
            &std::env::var_os("PATH").unwrap_or_default(),
        ));
        c.env("PATH", std::env::join_paths(paths).unwrap());
    })
    .expect("worker real");
    let mut engine = LocalEngine::with_worker(
        client,
        json!({"id":"real","dir":model_dir,"device":device,"compute_type":compute_type}),
        batch,
    );
    let started = std::time::Instant::now();
    run_with(
        &mut engine,
        job,
        source,
        std::path::Path::new(&path),
        &AtomicBool::new(false),
    )
    .unwrap();
    println!(
        "RTF {:.3}",
        started.elapsed().as_secs_f64() / (duration as f64 / 1e6)
    );

    let rows = run(
        "transcription.words",
        json!({"source_id":source, "limit": 100000}),
    );
    let rows = rows.as_array().unwrap();
    let words: Vec<_> = rows.iter().filter(|r| r["kind"] == "word").collect();
    println!(
        "{} palavras, {} linhas; primeiras: {}",
        words.len(),
        rows.len(),
        words
            .iter()
            .take(12)
            .map(|w| w["text"].as_str().unwrap())
            .collect::<Vec<_>>()
            .join(" ")
    );
    assert!(words.len() > 10, "a mídia deveria ter fala");
    let mut cursor = 0;
    for (i, r) in rows.iter().enumerate() {
        assert_eq!(r["position"], json!(i));
        let (s, e) = (
            r["start_us"].as_i64().unwrap(),
            r["end_us"].as_i64().unwrap(),
        );
        assert!(
            e >= s && s >= cursor - 500_000,
            "tempos em ordem (linha {i})"
        );
        assert!(e <= duration + 1_000_000);
        if r["kind"] == "word" {
            assert!(r["language"].is_string(), "idioma por trecho de VAD");
        }
        cursor = cursor.max(s);
    }
    let status = run("transcription.status", json!({"source_id":source}));
    assert_eq!(status["transcript"]["state"], "complete");
    let _ = run("projects.close", json!({}));
}
