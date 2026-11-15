//! Job de energia do áudio (#54), headless e sem rede: FFmpeg falso que entrega PCM sintético
//! (tom com trechos altos e baixos) e, se houver `ffmpeg`/`ffprobe` no PATH, o FFmpeg de
//! verdade sobre áudio sintético gerado por ele. Dados isolados em CLIPES_DATA_DIR. Um corpo de
//! teste só: o Projeto aberto é do processo.
use clipes_core::{dispatch, projects::with_writer, CoreError};
use serde_json::{json, Value};
use std::{
    fs,
    path::{Path, PathBuf},
    process::Command,
    time::{Duration, Instant},
};

const RATE: usize = 16_000;
const SECONDS: usize = 200;

fn call(name: &str, args: Value) -> Value {
    dispatch(name, args, &mut |_| {}).unwrap()
}

fn fail(name: &str, args: Value) -> CoreError {
    dispatch(name, args, &mut |_| {}).unwrap_err()
}

fn exe(name: &str) -> String {
    format!("{name}{}", std::env::consts::EXE_SUFFIX)
}

/// 40 Frases de 5 s: som baixo, a 20 mais alta (amplitude 6) e as 10 e 30 com grito (amplitude 20).
fn amplitude(second: usize) -> f64 {
    match second / 5 + 1 {
        10 | 30 => 20_000.0,
        20 => 6_000.0,
        _ => 1_000.0,
    }
}

fn pcm() -> Vec<u8> {
    let mut out = Vec::with_capacity(SECONDS * RATE * 2);
    for n in 0..SECONDS * RATE {
        let t = n as f64 / RATE as f64;
        let sample =
            (amplitude(n / RATE) * (2.0 * std::f64::consts::PI * 440.0 * t).sin()).round() as i16;
        out.extend_from_slice(&sample.to_le_bytes());
    }
    out
}

/// Importa a Fonte, grava uma Transcrição completa (40 Frases de 5 s) e devolve o ID da Fonte.
fn import_with_transcript(root: &Path, media: &Path) -> i64 {
    let project = call("projects.create", json!({"parent": root, "name": "Canal"}));
    let source = call(
        "sources.import",
        json!({"project": project["path"], "path": media, "permission": {"status": "none"}, "audio_track": 0}),
    )["id"]
        .as_i64()
        .unwrap();
    with_writer(|c| {
        c.execute("INSERT INTO transcripts(source_id,audio_track,engine,model,revision,compute_type,state,resume_us,duration_us) VALUES (?1,0,'local','m','r','c','complete',200000000,200000000)", [source])?;
        let transcript = c.last_insert_rowid();
        for position in 0..200_i64 {
            let text = if position % 5 == 4 {
                " palavra."
            } else {
                " palavra"
            };
            c.execute("INSERT INTO transcript_words(transcript_id,position,kind,text,start_us,end_us,language) VALUES (?1,?2,'word',?3,?4,?5,'pt')", (transcript, position, text, position * 1_000_000, (position + 1) * 1_000_000))?;
        }
        Ok(())
    })
    .unwrap();
    call("transcription.segment", json!({"source_id": source}));
    source
}

fn wait_job(kind: &str) -> Value {
    let deadline = Instant::now() + Duration::from_secs(120);
    loop {
        let jobs = call("jobs.list", json!({}));
        if let Some(job) = jobs.as_array().unwrap().iter().find(|j| {
            j["kind"] == kind
                && matches!(
                    j["state"].as_str(),
                    Some("completed" | "failed" | "cancelled")
                )
        }) {
            return job.clone();
        }
        assert!(
            Instant::now() < deadline,
            "job {kind} never settled: {jobs}"
        );
        std::thread::sleep(Duration::from_millis(50));
    }
}

/// `exact`: o FFmpeg falso entrega o PCM exato; o de verdade muda o volume por quadro (23 ms),
/// então o início da Frase seguinte a um grito pode vazar um pouco e ganhar `high`.
fn check_measurement(source: i64, exact: bool) {
    // Antes de rodar o job não há medida.
    let status = call("energy.status", json!({"source_id": source}));
    assert_eq!(status["measured"], false);
    let started = call("energy.start", json!({"source_id": source}));
    assert_eq!(started["state"], "queued");
    // Idempotente enquanto está na fila ou rodando.
    let again = call("energy.start", json!({"source_id": source}));
    assert!(again["state"] == "queued" || again["state"] == "measured");
    let job = wait_job("energy");
    assert_eq!(job["state"], "completed", "{job}");
    assert_eq!(job["safety"], "local");
    let status = call("energy.status", json!({"source_id": source}));
    assert_eq!(status["measured"], true);
    let loudness: Vec<i64> = with_writer(|c| {
        let mut q = c.prepare("SELECT loudness_centi FROM sentence_energy ORDER BY sentence_id")?;
        let rows = q.query_map([], |r| r.get(0))?;
        rows.collect::<rusqlite::Result<Vec<_>>>()
    })
    .unwrap();
    assert_eq!(loudness.len(), 40);
    let base = loudness[0];
    assert!(
        loudness[9] - base > 1_800 && loudness[29] - base > 1_800,
        "{loudness:?}"
    );
    assert!(loudness[19] - base > 400, "{loudness:?}");
    assert_eq!(status["marks"]["peak"], 2, "{loudness:?}");
    if exact {
        assert_eq!(status["marks"]["high"], 1, "{loudness:?}");
    } else {
        assert!(
            status["marks"]["high"].as_u64().unwrap() >= 1,
            "{loudness:?}"
        );
    }
    assert_eq!(
        call("energy.start", json!({"source_id": source}))["state"],
        "measured"
    );
    // Só a série por Frase fica no Projeto: 40 linhas de número, nenhum áudio.
    let rows: i64 =
        with_writer(|c| c.query_row("SELECT COUNT(*) FROM sentence_energy", [], |r| r.get(0)))
            .unwrap();
    assert_eq!(rows, 40);
}

#[test]
fn the_energy_job_measures_synthetic_audio_with_a_fake_and_the_real_ffmpeg() {
    let root = tempfile::tempdir().unwrap();
    let data = root.path().join("data");
    std::env::set_var("CLIPES_DATA_DIR", &data);

    // ---- FFmpeg falso, PCM sintético.
    let fake = root.path().join(exe("fake-ffmpeg-pcm"));
    let compiler = std::env::var_os("RUSTC")
        .map(PathBuf::from)
        .unwrap_or_else(|| {
            PathBuf::from(
                std::env::var_os(if cfg!(windows) { "USERPROFILE" } else { "HOME" }).unwrap(),
            )
            .join(".cargo/bin")
            .join(exe("rustc"))
        });
    assert!(Command::new(compiler)
        .arg(Path::new(env!("CARGO_MANIFEST_DIR")).join("tests/fixtures/fake_ffmpeg_pcm.rs"))
        .arg("-o")
        .arg(&fake)
        .status()
        .unwrap()
        .success());
    let pcm_file = root.path().join("audio.pcm");
    fs::write(&pcm_file, pcm()).unwrap();
    std::env::set_var("CLIPES_FAKE_PCM", &pcm_file);
    std::env::set_var("CLIPES_FAKE_DURATION", SECONDS.to_string());
    std::env::set_var("CLIPES_FFPROBE", &fake);
    call(
        "components.settings.set",
        json!({"data_dir": data, "cache_dir": root.path().join("cache"), "cache_limit_bytes": 10_000_000, "ffmpeg_path": fake}),
    );
    let media = root.path().join("fake-source.mkv");
    fs::write(&media, b"not really a video").unwrap();
    let fake_root = root.path().join("fake");
    fs::create_dir_all(&fake_root).unwrap();
    let source = import_with_transcript(&fake_root, &media);

    // Transcrição incompleta: erro tipado, sem job.
    with_writer(|c| {
        c.execute("UPDATE transcripts SET state='running'", [])
            .map(|_| ())
    })
    .unwrap();
    assert_eq!(
        fail("energy.start", json!({"source_id": source})).code,
        "transcript_incomplete"
    );
    with_writer(|c| {
        c.execute("UPDATE transcripts SET state='complete'", [])
            .map(|_| ())
    })
    .unwrap();
    check_measurement(source, true);

    // ---- FFmpeg de verdade (se instalado): o mesmo áudio sintético, gerado por ele.
    if Command::new("ffmpeg").arg("-version").output().is_err()
        || Command::new("ffprobe").arg("-version").output().is_err()
    {
        return;
    }
    let real_media = root.path().join("real-source.mkv");
    assert!(Command::new("ffmpeg")
        .args(["-v", "error", "-f", "lavfi", "-i"])
        .arg(format!("sine=frequency=440:duration={SECONDS}"))
        .args(["-af", "volume='if(between(t,45,50)+between(t,145,150),1,if(between(t,95,100),0.18,0.1))':eval=frame"])
        .args(["-c:a", "pcm_s16le", "-ac", "2", "-y"])
        .arg(&real_media)
        .status()
        .unwrap()
        .success());
    std::env::remove_var("CLIPES_FAKE_PCM");
    std::env::set_var("CLIPES_FFPROBE", "ffprobe");
    call(
        "components.settings.set",
        json!({"data_dir": data, "cache_dir": root.path().join("cache2"), "cache_limit_bytes": 10_000_000, "ffmpeg_path": "ffmpeg"}),
    );
    let real_root = root.path().join("real");
    fs::create_dir_all(&real_root).unwrap();
    // Projeto novo: a fila e as séries do anterior ficam para trás.
    let source = import_with_transcript(&real_root, &real_media);
    check_measurement(source, false);
}
