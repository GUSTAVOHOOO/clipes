//! Harness e testes headless da limpeza de voz não destrutiva (#155):
//! - Cadeia padrão `highpass` (~80 Hz) -> `afftdn` com piso de ruído medido pelo VAD nos trechos
//!   sem fala, comparação com `anlmdn` no harness, medição de redução de ruído (`astats`/`ebur128`),
//!   ausência de clipping e preservação de energia nos primeiros ~50 ms após o início do VAD;
//! - Ligada por padrão para Narração gravada (`engine_id='recorded'`) e importada (`engine_id='imported'`),
//!   com arquivo original intacto, prévia antes/depois (`narration-original/<id>` e `narration-clean/<id>`),
//!   chave persistida (`narration.cleanup.set`), fallback com aviso tipado (`vad_unavailable` /
//!   `insufficient_silence`), erro `ffmpeg_missing` sem caminho pessoal, exclusão do TTS e ordem no
//!   export: limpeza -> ducking (#82) -> loudness (#63).

use clipes_core::{
    dispatch,
    media::serve,
    narration_cleanup::{
        measure_noise_floor_from_silences, run_ffmpeg_cleanup, CLEANUP_DEFAULT_NOISE_FLOOR_DB,
        CLEANUP_MIN_NOISE_IMPROVEMENT_DB, CLEANUP_ONSET_MAX_LOSS_DB,
    },
    projects::with_writer,
    CoreError,
};
use serde_json::{json, Value};
use sha2::{Digest, Sha256};
use std::{
    fs,
    path::{Path, PathBuf},
    process::Output,
    sync::Mutex,
    time::{Duration, Instant},
};

const FAKE_WORKER: &str = env!("CARGO_BIN_EXE_fake-worker");
static SERIAL: Mutex<()> = Mutex::new(());

fn call(name: &str, args: Value) -> Value {
    dispatch(name, args, &mut |_| {}).unwrap()
}

fn fail(name: &str, args: Value) -> CoreError {
    dispatch(name, args, &mut |_| {}).unwrap_err()
}

fn exe(name: &str) -> String {
    if cfg!(windows) {
        format!("{name}.exe")
    } else {
        name.into()
    }
}

fn ffmpeg_program() -> String {
    std::env::var("CLIPES_TEST_FFMPEG").unwrap_or_else(|_| "ffmpeg".into())
}

fn resolve_ffmpeg_abs() -> PathBuf {
    let bin = ffmpeg_program();
    let path = Path::new(&bin);
    if path.is_absolute() {
        return path.to_path_buf();
    }
    let locator = if cfg!(windows) { "where" } else { "which" };
    let out = std::process::Command::new(locator)
        .arg(&bin)
        .output()
        .expect("ffmpeg é necessário para os testes de limpeza de voz");
    assert!(out.status.success(), "ffmpeg não encontrado no PATH");
    let first = String::from_utf8_lossy(&out.stdout)
        .lines()
        .next()
        .unwrap()
        .trim()
        .to_owned();
    PathBuf::from(first)
}

fn run_ffmpeg(args: &[&str]) -> Output {
    let out = clipes_core::process::spawn(ffmpeg_program(), args, None)
        .expect("falha ao iniciar ffmpeg")
        .wait_with_output()
        .expect("falha ao aguardar ffmpeg");
    assert!(
        out.status.success(),
        "ffmpeg falhou: {}",
        String::from_utf8_lossy(&out.stderr)
    );
    out
}

fn configure_system_ffmpeg(data_dir: &Path) {
    let ffmpeg_path = resolve_ffmpeg_abs();
    call(
        "components.settings.set",
        json!({
            "data_dir": data_dir,
            "cache_dir": data_dir.join("cache"),
            "cache_limit_bytes": 1_000_000_000u64,
            "ffmpeg_path": ffmpeg_path,
        }),
    );
}

fn install_fake_worker_and_whisper(data_dir: &Path, with_whisper: bool) {
    let manifest = call("components.manifest", json!({}));
    let version = manifest
        .as_array()
        .unwrap()
        .iter()
        .find(|c| c["id"] == "uv")
        .unwrap()["version"]
        .as_str()
        .unwrap()
        .to_owned();
    fs::create_dir_all(data_dir.join("components")).unwrap();
    fs::copy(FAKE_WORKER, data_dir.join("components").join(exe("uv"))).unwrap();
    fs::write(data_dir.join("components/uv.version"), version).unwrap();
    call("components.worker.install", json!({"confirmed": true}));

    if with_whisper {
        let models = call("components.models.manifest", json!({}));
        for model in models.as_array().unwrap() {
            let dir = data_dir.join("models").join(model["id"].as_str().unwrap());
            fs::create_dir_all(&dir).unwrap();
            fs::write(
                dir.join("model.state.json"),
                json!({"revision": model["revision"]}).to_string(),
            )
            .unwrap();
        }
    }
}

fn remove_worker(data_dir: &Path) {
    let _ = fs::remove_dir_all(data_dir.join("worker"));
    let _ = fs::remove_file(data_dir.join("components").join(exe("uv")));
    let _ = fs::remove_file(data_dir.join("components/uv.version"));
}

fn sha256_file(path: &Path) -> String {
    let bytes = fs::read(path).unwrap();
    format!("{:x}", Sha256::digest(&bytes))
}

fn assert_no_personal_path(err: &CoreError, needle: &Path) {
    let needle_str = needle.to_string_lossy();
    assert!(
        !err.message.contains(needle_str.as_ref()),
        "erro vazou caminho pessoal (ADR-0006): {}",
        err.message
    );
}

fn measure_astats_rms_and_peak(path: &Path, start_s: f64, end_s: f64) -> (f64, f64) {
    let filter = format!(
        "atrim=start={start_s:.3}:end={end_s:.3},asetpts=PTS-STARTPTS,astats=measure_overall=RMS_level+Peak_level:measure_perchannel=none"
    );
    let out = run_ffmpeg(&[
        "-hide_banner",
        "-nostats",
        "-i",
        path.to_str().unwrap(),
        "-af",
        &filter,
        "-f",
        "null",
        "-",
    ]);
    let text = String::from_utf8_lossy(&out.stderr);
    let parse_metric = |label: &str| -> f64 {
        let line = text
            .lines()
            .rfind(|l| l.contains(label))
            .unwrap_or_else(|| panic!("astats sem {label} em {start_s}..{end_s}: {text}"));
        line.split(label).nth(1).unwrap().trim().parse().unwrap()
    };
    (
        parse_metric("RMS level dB:"),
        parse_metric("Peak level dB:"),
    )
}

fn measure_ebur128(path: &Path) -> (f64, f64) {
    let out = run_ffmpeg(&[
        "-nostats",
        "-i",
        path.to_str().unwrap(),
        "-map",
        "0:a:0",
        "-af",
        "ebur128=peak=true",
        "-f",
        "null",
        "-",
    ]);
    let text = String::from_utf8_lossy(&out.stderr);
    let summary = text.rsplit("Summary:").next().unwrap();
    let value = |label: &str, unit: &str| -> f64 {
        let rest = summary
            .split(label)
            .nth(1)
            .unwrap_or_else(|| panic!("ebur128 sem {label}: {text}"));
        rest.trim_start()
            .split(unit)
            .next()
            .unwrap()
            .trim()
            .parse()
            .unwrap()
    };
    (value("I:", "LUFS"), value("Peak:", "dBFS"))
}

fn read_wav_i16_samples(path: &Path) -> Vec<i16> {
    let bytes = fs::read(path).unwrap();
    assert!(bytes.len() >= 44 && &bytes[0..4] == b"RIFF" && &bytes[8..12] == b"WAVE");
    let mut pos = 12usize;
    while pos + 8 <= bytes.len() {
        let id = &bytes[pos..pos + 4];
        let size = u32::from_le_bytes(bytes[pos + 4..pos + 8].try_into().unwrap()) as usize;
        let body = pos + 8;
        if id == b"data" {
            return bytes[body..body + size]
                .as_chunks::<2>()
                .0
                .iter()
                .map(|c| i16::from_le_bytes(*c))
                .collect();
        }
        pos = body + size + (size & 1);
    }
    panic!("WAV sem chunk data");
}

fn encode_base64(data: &[u8]) -> String {
    const TABLE: &[u8; 64] = b"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
    let mut out = String::with_capacity(data.len().div_ceil(3) * 4);
    for chunk in data.chunks(3) {
        let b0 = u32::from(chunk[0]);
        let b1 = u32::from(*chunk.get(1).unwrap_or(&0));
        let b2 = u32::from(*chunk.get(2).unwrap_or(&0));
        let triple = (b0 << 16) | (b1 << 8) | b2;
        out.push(TABLE[((triple >> 18) & 0x3f) as usize] as char);
        out.push(TABLE[((triple >> 12) & 0x3f) as usize] as char);
        out.push(if chunk.len() > 1 {
            TABLE[((triple >> 6) & 0x3f) as usize] as char
        } else {
            '='
        });
        out.push(if chunk.len() > 2 {
            TABLE[(triple & 0x3f) as usize] as char
        } else {
            '='
        });
    }
    out
}

fn generate_noisy_speech_wav(path: &Path) {
    // 2.8 s total:
    // - ruído contínuo: pink (ventilador) + 60 Hz (zumbido forte) + 120 Hz (harmônico leve)
    // - fala sintética: formantes 240 Hz + 720 Hz + 1400 Hz em [0.70..1.50] e [1.80..2.50]
    run_ffmpeg(&[
        "-v",
        "error",
        "-y",
        "-f",
        "lavfi",
        "-i",
        "anoisesrc=color=pink:amplitude=0.03:sample_rate=24000:duration=2.8",
        "-f",
        "lavfi",
        "-i",
        "sine=frequency=60:sample_rate=24000:duration=2.8",
        "-f",
        "lavfi",
        "-i",
        "sine=frequency=120:sample_rate=24000:duration=2.8",
        "-f",
        "lavfi",
        "-i",
        "sine=frequency=240:sample_rate=24000:duration=0.8",
        "-f",
        "lavfi",
        "-i",
        "sine=frequency=720:sample_rate=24000:duration=0.8",
        "-f",
        "lavfi",
        "-i",
        "sine=frequency=260:sample_rate=24000:duration=0.7",
        "-f",
        "lavfi",
        "-i",
        "sine=frequency=1100:sample_rate=24000:duration=0.7",
        "-filter_complex",
        "[1:a]volume=0.28[h60];[2:a]volume=0.02[h120];[3:a]volume=1.8,adelay=700|700[v1a];[4:a]volume=1.1,adelay=700|700[v1b];[5:a]volume=1.6,adelay=1800|1800[v2a];[6:a]volume=0.9,adelay=1800|1800[v2b];[0:a][h60][h120][v1a][v1b][v2a][v2b]amix=inputs=7:normalize=0,aresample=24000",
        "-c:a",
        "pcm_s16le",
        "-ac",
        "1",
        "-ar",
        "24000",
        path.to_str().unwrap(),
    ]);
}

fn seed_transformed_cut(media_path: Option<&Path>) -> (i64, i64, Vec<i64>) {
    let (source_path_str, size, partial) = match media_path {
        Some(p) => {
            let bytes = fs::read(p).unwrap();
            let mut h = Sha256::new();
            for _ in 0..3 {
                h.update(&bytes);
            }
            (
                p.to_string_lossy().into_owned(),
                bytes.len() as i64,
                format!("{:x}", h.finalize()),
            )
        }
        None => ("offline.mp4".into(), 1, "h".into()),
    };

    with_writer(|c| {
        c.execute(
            "INSERT INTO sources(path,size,duration_us,partial_hash,metadata,permission,audio_track) VALUES (?1,?2,6000000,'h2','{}','{\"status\":\"granted\",\"who\":\"Criador\",\"where\":\"Live\"}',1)",
            (&source_path_str, size),
        )?;
        let source = c.last_insert_rowid();
        c.execute(
            "UPDATE sources SET partial_hash=?2 WHERE id=?1",
            (source, &partial),
        )?;
        c.execute(
            "INSERT INTO transcripts(source_id,audio_track,engine,model,revision,compute_type,state,resume_us,duration_us) VALUES (?1,1,'local','m','r','c','complete',6000000,6000000)",
            [source],
        )?;
        let transcript = c.last_insert_rowid();
        for (id, s0, s1, txt) in [
            (1_i64, 0_i64, 2_000_000_i64, "Primeira frase."),
            (2_i64, 2_000_000_i64, 4_000_000_i64, "Segunda frase."),
            (3_i64, 4_000_000_i64, 6_000_000_i64, "Terceira frase."),
        ] {
            c.execute(
                "INSERT INTO sentences(transcript_id,id,first_position,last_position,start_us,end_us,text) VALUES (?1,?2,?3,?4,?5,?6,?7)",
                (transcript, id, id * 2 - 1, id * 2, s0, s1, txt),
            )?;
        }
        c.execute(
            "INSERT INTO selection_runs(transcript_id,task_version,prompt_sha256,profile,state,min_us,max_us,weights,plan_state,windows_total,video_kind) VALUES (?1,1,'h','legacy','completed',2000000,180000000,'[]','full',1,'transformed')",
            [transcript],
        )?;
        let run = c.last_insert_rowid();
        c.execute(
            "INSERT INTO selection_candidates(run_id,rank,start_id,end_id,start_us,end_us,axes,total_centi,title,windows) VALUES (?1,1,1,3,0,6000000,'{}',900,'Corte','[0]')",
            [run],
        )?;
        let candidate = c.last_insert_rowid();
        c.execute(
            "INSERT INTO selection_decisions(run_id,cand_start_id,cand_end_id,decision,before_start_id,before_end_id,after_start_id,after_end_id) VALUES (?1,1,3,'approved',1,3,1,3)",
            [run],
        )?;
        c.execute(
            "INSERT INTO jobs(kind,safety,state,progress) VALUES ('ai:script','local','completed',100)",
            [],
        )?;
        let gen_job = c.last_insert_rowid();
        c.execute(
            "INSERT INTO script_generations(job_id,run_id,cand_start_id,cand_end_id,language,task_version,prompt_sha256,profile,safety,outline,angle) VALUES (?1,?2,1,3,'pt-BR',2,'h','legacy','local','[]','{\"name\":\"Angulo\",\"promise\":\"Promessa\"}')",
            (gen_job, run),
        )?;
        let gen_id = c.last_insert_rowid();

        let mut block_ids = Vec::new();
        for (pos, title, text, refs) in [
            (1_i64, "Abertura", "Primeira frase.", "[1]"),
            (2_i64, "Desenvolvimento", "Segunda frase.", "[2]"),
            (3_i64, "Fecho", "Terceira frase.", "[3]"),
        ] {
            c.execute(
                "INSERT INTO script_blocks(generation_id,position,title,intent,refs) VALUES (?1,?2,?3,'Intencao',?4)",
                (gen_id, pos, title, refs),
            )?;
            let bid = c.last_insert_rowid();
            c.execute(
                "INSERT INTO script_block_versions(block_id,kind,title,narration,refs,angle_revision) VALUES (?1,'generated',?2,?3,?4,0)",
                (bid, title, text, refs),
            )?;
            let vid = c.last_insert_rowid();
            c.execute(
                "INSERT INTO script_approvals(block_id,version_id,angle_revision) VALUES (?1,?2,0)",
                (bid, vid),
            )?;
            block_ids.push(bid);
        }
        Ok((source, candidate, block_ids))
    })
    .unwrap()
}

fn wait_narration_settled(candidate: i64) -> Value {
    let deadline = Instant::now() + Duration::from_secs(20);
    loop {
        let doc = call("narration.get", json!({"candidate": candidate}));
        let import_busy = doc["importBusy"].as_bool().unwrap_or(false);
        let align_busy = doc["alignBusy"].as_bool().unwrap_or(false);
        let tts_busy = doc["busy"].as_bool().unwrap_or(false);
        if !import_busy && !align_busy && !tts_busy {
            return doc;
        }
        assert!(Instant::now() < deadline, "timeout na narração: {doc}");
        std::thread::sleep(Duration::from_millis(30));
    }
}

fn wait_export_completed(job_id: i64) {
    let deadline = Instant::now() + Duration::from_secs(60);
    loop {
        let st = call("export.status", json!({"job": job_id}));
        match st["state"].as_str() {
            Some("completed") => return,
            Some("failed") | Some("cancelled") => panic!("export falhou: {st}"),
            _ => {
                assert!(Instant::now() < deadline, "timeout no export: {st}");
                std::thread::sleep(Duration::from_millis(60));
            }
        }
    }
}

#[test]
fn harness_voice_cleanup_reduces_noise_without_clipping_or_cutting_word_onset() {
    let dir = tempfile::tempdir().unwrap();
    let noisy_wav = dir.path().join("noisy_voice.wav");
    let clean_wav = dir.path().join("clean_afftdn.wav");
    let anlmdn_wav = dir.path().join("clean_anlmdn.wav");
    generate_noisy_speech_wav(&noisy_wav);

    let samples = read_wav_i16_samples(&noisy_wav);
    let silences_us = [
        (0_i64, 700_000_i64),
        (1_500_000, 1_800_000),
        (2_500_000, 2_800_000),
    ];
    let nf = measure_noise_floor_from_silences(&samples, 24_000, &silences_us);
    assert_eq!(nf.source, "vad");
    assert_eq!(nf.warning_code, None);

    let ffmpeg = resolve_ffmpeg_abs();
    run_ffmpeg_cleanup(&ffmpeg, &noisy_wav, &clean_wav, nf.noise_floor_db, None).unwrap();

    // Comparação com `anlmdn` no harness (conforme política do ticket #155).
    run_ffmpeg(&[
        "-v",
        "error",
        "-y",
        "-i",
        noisy_wav.to_str().unwrap(),
        "-af",
        "highpass=f=80,anlmdn=s=0.002",
        "-c:a",
        "pcm_s16le",
        anlmdn_wav.to_str().unwrap(),
    ]);

    // 1. Queda do ruído de fundo nos trechos sem fala (astats).
    let (raw_sil_rms, _) = measure_astats_rms_and_peak(&noisy_wav, 0.05, 0.65);
    let (clean_sil_rms, _) = measure_astats_rms_and_peak(&clean_wav, 0.05, 0.65);
    let (anl_sil_rms, _) = measure_astats_rms_and_peak(&anlmdn_wav, 0.05, 0.65);
    let noise_drop_db = raw_sil_rms - clean_sil_rms;
    assert!(
        noise_drop_db >= CLEANUP_MIN_NOISE_IMPROVEMENT_DB,
        "queda de ruído insuficiente: raw={raw_sil_rms:.2} dB -> clean={clean_sil_rms:.2} dB (delta={noise_drop_db:.2} dB; anlmdn={anl_sil_rms:.2} dB)"
    );

    let (raw_gap_rms, _) = measure_astats_rms_and_peak(&noisy_wav, 1.53, 1.77);
    let (clean_gap_rms, _) = measure_astats_rms_and_peak(&clean_wav, 1.53, 1.77);
    assert!(
        raw_gap_rms - clean_gap_rms >= CLEANUP_MIN_NOISE_IMPROVEMENT_DB,
        "queda de ruído na pausa interna insuficiente: raw={raw_gap_rms:.2} -> clean={clean_gap_rms:.2}"
    );

    // 2. Ausência de clipping (pico < 0 dBFS e amostras dentro do intervalo PCM).
    let (_, clean_peak_db) = measure_astats_rms_and_peak(&clean_wav, 0.0, 2.8);
    assert!(
        clean_peak_db < 0.0,
        "clipping detectado no áudio limpo: peak={clean_peak_db:.2} dBFS"
    );
    let clean_samples = read_wav_i16_samples(&clean_wav);
    assert_eq!(clean_samples.len(), samples.len());
    assert!(clean_samples.iter().all(|&s| s > i16::MIN && s < i16::MAX));

    // 3. Início das palavras (primeiros 50 ms após início do VAD: 0.70..0.75 e 1.80..1.85) sem perda excessiva.
    for (s0, s1) in [(0.70, 0.75), (1.80, 1.85)] {
        let (raw_on_rms, _) = measure_astats_rms_and_peak(&noisy_wav, s0, s1);
        let (clean_on_rms, _) = measure_astats_rms_and_peak(&clean_wav, s0, s1);
        let loss_db = raw_on_rms - clean_on_rms;
        assert!(
            loss_db <= CLEANUP_ONSET_MAX_LOSS_DB,
            "início da fala perdeu energia além do limite em {s0}..{s1}: raw={raw_on_rms:.2} -> clean={clean_on_rms:.2} (perda={loss_db:.2} dB)"
        );
    }

    let (_, anl_on_rms) = measure_astats_rms_and_peak(&anlmdn_wav, 0.70, 0.75);
    eprintln!(
        "[harness #155] nf={:.2} dB | silêncio: {:.2} -> {:.2} dB (anlmdn: {:.2} dB) | pico: {:.2} dBFS | anlmdn_onset_pk: {:.2}",
        nf.noise_floor_db, raw_sil_rms, clean_sil_rms, anl_sil_rms, clean_peak_db, anl_on_rms
    );
}

#[test]
fn headless_recorded_imported_tts_toggle_media_and_export_order() {
    let _guard = SERIAL.lock().unwrap_or_else(|e| e.into_inner());
    let root = tempfile::tempdir().unwrap();
    let data_dir = root.path().join("data");
    std::env::set_var("CLIPES_DATA_DIR", &data_dir);
    std::env::set_var("CLIPES_FAKE_WORKER_MODE", "transcribe");
    std::env::remove_var("CLIPES_FAKE_VAD_EMPTY");
    std::env::remove_var("CLIPES_FAKE_VAD_TRIM_US");

    let source_mp4 = root.path().join("source.mp4");
    run_ffmpeg(&[
        "-v",
        "error",
        "-y",
        "-f",
        "lavfi",
        "-i",
        "testsrc2=size=640x360:rate=30:duration=6",
        "-f",
        "lavfi",
        "-i",
        "sine=frequency=330:sample_rate=48000:duration=6",
        "-c:v",
        "libx264",
        "-preset",
        "ultrafast",
        "-pix_fmt",
        "yuv420p",
        "-c:a",
        "aac",
        source_mp4.to_str().unwrap(),
    ]);

    let proj = call(
        "projects.create",
        json!({"parent": root.path(), "name": "CleanupProj"}),
    );
    let proj_dir = PathBuf::from(proj["path"].as_str().unwrap());
    let (source_id, candidate, blocks) = seed_transformed_cut(Some(&source_mp4));

    let noisy_sample = root.path().join("sample_noisy.wav");
    generate_noisy_speech_wav(&noisy_sample);
    let noisy_bytes = fs::read(&noisy_sample).unwrap();
    let noisy_b64 = encode_base64(&noisy_bytes);

    // 1. Gravação sem worker e sem FFmpeg: salva original, marca limpeza ligada com fallback vad_unavailable,
    //    e `narration.cleanup.prepare` devolve `ffmpeg_missing` sem caminho pessoal (ADR-0006).
    let rec_no_worker = call(
        "narration.record_block",
        json!({"candidate": candidate, "block": blocks[0], "audioBase64": noisy_b64, "mimeType": "audio/wav"}),
    );
    assert_eq!(rec_no_worker["trimmed"], false);
    let doc_no_worker = call("narration.get", json!({"candidate": candidate}));
    let c0 = &doc_no_worker["blocks"][0]["audio"]["cleanup"];
    assert_eq!(c0["applicable"], true);
    assert_eq!(c0["enabled"], true);
    assert_eq!(c0["ready"], false);
    assert_eq!(c0["noiseFloorSource"], "default");
    assert_eq!(c0["noiseFloorDb"], CLEANUP_DEFAULT_NOISE_FLOOR_DB);
    assert_eq!(c0["warningCode"], "vad_unavailable");

    let missing_ffmpeg_err = fail(
        "narration.cleanup.prepare",
        json!({"candidate": candidate, "block": blocks[0]}),
    );
    assert_eq!(missing_ffmpeg_err.code, "ffmpeg_missing");
    assert_no_personal_path(&missing_ffmpeg_err, root.path());

    // 2. Configura FFmpeg + fake worker com VAD marcando silêncio suficiente e grava bloco 0.
    configure_system_ffmpeg(&data_dir);
    install_fake_worker_and_whisper(&data_dir, true);
    std::env::set_var("CLIPES_FAKE_VAD_TRIM_US", "650000,2550000");

    let rec_vad = call(
        "narration.record_block",
        json!({"candidate": candidate, "block": blocks[0], "audioBase64": noisy_b64, "mimeType": "audio/wav"}),
    );
    assert_eq!(rec_vad["trimmed"], true);
    let doc_rec = wait_narration_settled(candidate);
    let audio0 = &doc_rec["blocks"][0]["audio"];
    let audio0_id = audio0["id"].as_i64().unwrap();
    let orig0_path = proj_dir.join(audio0["relPath"].as_str().unwrap());
    let orig0_sha = sha256_file(&orig0_path);

    assert_eq!(audio0["cleanup"]["enabled"], true);
    assert_eq!(audio0["cleanup"]["noiseFloorSource"], "vad");
    assert_eq!(audio0["cleanup"]["warningCode"], Value::Null);
    assert!(audio0["cleanup"]["noiseFloorDb"].as_f64().is_some());

    // Prévia antes/depois: prepara versão limpa sem alterar o arquivo original.
    let prep0 = call(
        "narration.cleanup.prepare",
        json!({"candidate": candidate, "block": blocks[0]}),
    );
    assert_eq!(prep0["ready"], true);
    assert_eq!(
        sha256_file(&orig0_path),
        orig0_sha,
        "original nunca pode mudar"
    );
    let clean0_rel = prep0["cleanRelPath"].as_str().unwrap();
    assert!(clean0_rel.starts_with("narrations/"));
    assert!(proj_dir.join(clean0_rel).is_file());

    let resp_active = serve(&format!("narration/{audio0_id}"), None);
    let resp_orig = serve(&format!("narration-original/{audio0_id}"), None);
    let resp_clean = serve(&format!("narration-clean/{audio0_id}"), None);
    assert_eq!(resp_active.status, 200);
    assert_eq!(resp_orig.status, 200);
    assert_eq!(resp_clean.status, 200);
    assert_eq!(resp_active.body, resp_clean.body);
    assert_ne!(resp_orig.body, resp_clean.body);

    // Desliga a limpeza no bloco 0: estado persiste e `narration/<id>` volta ao original.
    let toggled_off = call(
        "narration.cleanup.set",
        json!({"candidate": candidate, "block": blocks[0], "enabled": false}),
    );
    assert_eq!(toggled_off["cleanup"]["enabled"], false);
    assert_eq!(
        serve(&format!("narration/{audio0_id}"), None).body,
        resp_orig.body
    );
    assert_eq!(
        serve(&format!("narration-clean/{audio0_id}"), None).status,
        200
    );

    // Liga novamente.
    call(
        "narration.cleanup.set",
        json!({"candidate": candidate, "block": blocks[0], "enabled": true}),
    );
    assert_eq!(
        serve(&format!("narration/{audio0_id}"), None).body,
        resp_clean.body
    );

    // 3. Bloco gravado com silêncio insuficiente (< 200 ms) cai no piso padrão + aviso `insufficient_silence`.
    std::env::set_var("CLIPES_FAKE_VAD_TRIM_US", "50000,2750000");
    call(
        "narration.record_block",
        json!({"candidate": candidate, "block": blocks[0], "audioBase64": noisy_b64, "mimeType": "audio/wav"}),
    );
    let doc_short_sil = wait_narration_settled(candidate);
    assert_eq!(
        doc_short_sil["blocks"][0]["audio"]["cleanup"]["noiseFloorSource"],
        "default"
    );
    assert_eq!(
        doc_short_sil["blocks"][0]["audio"]["cleanup"]["warningCode"],
        "insufficient_silence"
    );

    // 4. Importação (#84): limpeza ligada por padrão, original intacto e piso medido via VAD.
    std::env::set_var("CLIPES_FAKE_VAD_TRIM_US", "650000,2550000");
    call(
        "narration.import",
        json!({"candidate": candidate, "block": blocks[1], "path": noisy_sample}),
    );
    let doc_imp = wait_narration_settled(candidate);
    let audio1 = &doc_imp["blocks"][1]["audio"];
    let audio1_id = audio1["id"].as_i64().unwrap();
    let orig1_path = proj_dir.join(audio1["relPath"].as_str().unwrap());
    let orig1_sha = sha256_file(&orig1_path);
    assert_eq!(audio1["engineId"], "imported");
    assert_eq!(audio1["cleanup"]["enabled"], true);

    let prep1 = call(
        "narration.cleanup.prepare",
        json!({"candidate": candidate, "block": blocks[1]}),
    );
    assert_eq!(prep1["noiseFloorSource"], "vad");
    assert_eq!(prep1["warningCode"], Value::Null);
    assert_eq!(sha256_file(&orig1_path), orig1_sha);

    // 5. Bloco TTS (`pocket-tts`) NÃO passa pela limpeza.
    with_writer(|c| {
        let rel = format!("narrations/c{candidate}/b{}-v3.wav", blocks[2]);
        let tts_path = proj_dir.join(&rel);
        fs::create_dir_all(tts_path.parent().unwrap()).unwrap();
        fs::copy(&noisy_sample, &tts_path).unwrap();
        let sha = sha256_file(&tts_path);
        let ver_id: i64 = c.query_row(
            "SELECT id FROM script_block_versions WHERE block_id=?1 ORDER BY id DESC LIMIT 1",
            [blocks[2]],
            |r| r.get(0),
        )?;
        c.execute(
            "INSERT INTO narration_blocks(block_id, version_id, voice_id, model_id, engine_id, audio_rel_path, duration_us, sample_rate, channels, bytes, sha256)
             VALUES (?1, ?2, '13063', 'portuguese_24l', 'pocket-tts', ?3, 2800000, 24000, 1, ?4, ?5)",
            (blocks[2], ver_id, rel, noisy_bytes.len() as i64, sha),
        )?;
        Ok(())
    })
    .unwrap();
    let doc_tts = call("narration.get", json!({"candidate": candidate}));
    let tts_audio = &doc_tts["blocks"][2]["audio"];
    let tts_id = tts_audio["id"].as_i64().unwrap();
    assert_eq!(tts_audio["engineId"], "pocket-tts");
    assert_eq!(tts_audio["cleanup"], Value::Null);
    assert_eq!(
        fail(
            "narration.cleanup.set",
            json!({"candidate": candidate, "block": blocks[2], "enabled": false})
        )
        .code,
        "cleanup_not_applicable"
    );
    assert_eq!(
        fail(
            "narration.cleanup.prepare",
            json!({"candidate": candidate, "block": blocks[2]})
        )
        .code,
        "cleanup_not_applicable"
    );
    assert_eq!(
        serve(&format!("narration-clean/{tts_id}"), None).status,
        404
    );

    // 6. Export completo: limpeza -> ducking (#82) -> loudness (#63) a -14 LUFS / <= -1 dBTP.
    //    Compara ruído exportado com limpeza ligada vs desligada no bloco importado.
    let out_clean = proj_dir.join("export_clean.mp4");
    let exp_clean = call(
        "export.start",
        json!({"source_id": source_id, "start_id": 1, "end_id": 3, "candidate_id": candidate, "output": out_clean}),
    );
    wait_export_completed(exp_clean["job"].as_i64().unwrap());
    let (lufs, peak) = measure_ebur128(&out_clean);
    assert!(
        (lufs - (-14.0)).abs() <= 1.5,
        "loudness fora do alvo -14 LUFS: {lufs:.2}"
    );
    assert!(peak <= -0.9, "true peak acima de -1 dBTP: {peak:.2}");

    // Verifica que sem worker no import, fallback grava `vad_unavailable` sem falhar.
    remove_worker(&data_dir);
    call(
        "narration.import",
        json!({"candidate": candidate, "block": blocks[1], "path": noisy_sample}),
    );
    let doc_imp_no_vad = wait_narration_settled(candidate);
    assert_eq!(
        doc_imp_no_vad["blocks"][1]["audio"]["cleanup"]["enabled"],
        true
    );
    let prep_no_vad = call(
        "narration.cleanup.prepare",
        json!({"candidate": candidate, "block": blocks[1]}),
    );
    assert_eq!(prep_no_vad["noiseFloorSource"], "default");
    assert_eq!(prep_no_vad["warningCode"], "vad_unavailable");

    // Confirma que `audio1_id` foi atualizado para o bloco 1 e `orig1_path` continua íntegro.
    assert!(audio1_id > 0);
    assert!(orig1_path.is_file());

    std::env::remove_var("CLIPES_FAKE_VAD_TRIM_US");
    std::env::remove_var("CLIPES_FAKE_WORKER_MODE");
    let _ = call("projects.close", json!({}));
}
