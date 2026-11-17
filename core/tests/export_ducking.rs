//! Harness real de ducking da Narração (#82):
//! - confere redução da Fonte durante a Narração (~ -12 dB) via `sidechaincompress` e recuperação nos intervalos;
//! - confere que a Narração não é abaixada na mixagem (`amix normalize=0`);
//! - confere congelamento do último quadro (`tpad`) só na sobra final e loudness final (-14 LUFS / <= -1 dBTP);
//! - testa o fluxo headless completo (`projects.create` -> `narration_blocks` -> `editor.open` -> `export.start`)
//!   com `CLIPES_DATA_DIR` isolado, sem rede nem mídia de terceiros.

use clipes_core::{
    dispatch,
    export::{
        captions::CaptionWord,
        render::{render_with_narration, NarrationRenderInput, NarrationTrackInput, RenderInput},
    },
    projects::with_writer,
    provider::CancelToken,
};
use serde_json::{json, Value};
use std::{
    fs,
    path::{Path, PathBuf},
    process::Output,
    sync::Mutex,
    time::{Duration, Instant},
};

static SERIAL: Mutex<()> = Mutex::new(());

fn ffmpeg_program() -> String {
    std::env::var("CLIPES_TEST_FFMPEG").unwrap_or_else(|_| "ffmpeg".into())
}

fn ffprobe_program() -> String {
    std::env::var("CLIPES_TEST_FFPROBE").unwrap_or_else(|_| "ffprobe".into())
}

fn ffmpeg(args: &[&str]) -> Output {
    let output = clipes_core::process::spawn(ffmpeg_program(), args, None)
        .expect("instale FFmpeg com libass para o harness de ducking")
        .wait_with_output()
        .unwrap();
    assert!(
        output.status.success(),
        "ffmpeg falhou: {}",
        String::from_utf8_lossy(&output.stderr)
    );
    output
}

fn probe(path: &Path) -> Value {
    let output = clipes_core::process::spawn(
        ffprobe_program(),
        [
            "-v",
            "error",
            "-show_streams",
            "-show_format",
            "-of",
            "json",
            path.to_str().unwrap(),
        ],
        None,
    )
    .unwrap()
    .wait_with_output()
    .unwrap();
    assert!(output.status.success());
    serde_json::from_slice(&output.stdout).unwrap()
}

/// Mede `mean_volume` em dB de uma faixa de frequência (via `bandpass`) num intervalo `[start_s, end_s]`.
fn measure_band_mean_db(path: &Path, freq_hz: u32, start_s: f64, end_s: f64) -> f64 {
    let filter = format!(
        "atrim=start={start_s:.3}:end={end_s:.3},asetpts=PTS-STARTPTS,bandpass=frequency={freq_hz}:width_type=h:width=80,volumedetect"
    );
    let output = ffmpeg(&[
        "-hide_banner",
        "-nostats",
        "-i",
        path.to_str().unwrap(),
        "-map",
        "0:a:0",
        "-af",
        &filter,
        "-f",
        "null",
        "-",
    ]);
    let text = String::from_utf8_lossy(&output.stderr);
    let line = text
        .lines()
        .find(|l| l.contains("mean_volume:"))
        .unwrap_or_else(|| panic!("volumedetect sem mean_volume em {start_s}..{end_s}: {text}"));
    let rest = line.split("mean_volume:").nth(1).unwrap().trim();
    rest.split(" dB").next().unwrap().trim().parse().unwrap()
}

/// Lê `I:` (LUFS) e `Peak:` (dBFS) do resumo do `ebur128=peak=true`.
fn measure_ebur128(path: &Path) -> (f64, f64) {
    let output = ffmpeg(&[
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
    let text = String::from_utf8_lossy(&output.stderr);
    let summary = text.rsplit("Summary:").next().unwrap();
    let value = |label: &str, unit: &str| -> f64 {
        let rest = summary
            .split(label)
            .nth(1)
            .unwrap_or_else(|| panic!("ebur128 sem {label}"));
        let rest = rest.trim_start().split(unit).next().unwrap();
        rest.trim().parse().unwrap()
    };
    (value("I:", "LUFS"), value("Peak:", "dBFS"))
}

fn frame_rgb(path: &Path, time_s: f64) -> Vec<u8> {
    ffmpeg(&[
        "-v",
        "error",
        "-ss",
        &format!("{time_s:.3}"),
        "-i",
        path.to_str().unwrap(),
        "-vf",
        "scale=135:240",
        "-frames:v",
        "1",
        "-pix_fmt",
        "rgb24",
        "-f",
        "rawvideo",
        "pipe:1",
    ])
    .stdout
}

fn mean_rgb_diff(a: &[u8], b: &[u8]) -> f64 {
    assert_eq!(a.len(), b.len());
    let sum: u64 = a
        .iter()
        .zip(b)
        .map(|(x, y)| u64::from(x.abs_diff(*y)))
        .sum();
    sum as f64 / a.len() as f64
}

fn make_sine_wav(path: &Path, freq_hz: u32, duration_s: f64, volume: f64) {
    ffmpeg(&[
        "-v",
        "error",
        "-f",
        "lavfi",
        "-i",
        &format!(
            "sine=frequency={freq_hz}:sample_rate=24000:duration={duration_s:.3},volume={volume}"
        ),
        "-c:a",
        "pcm_s16le",
        "-y",
        path.to_str().unwrap(),
    ]);
}

#[test]
fn real_ffmpeg_ducking_attenuates_source_keeps_narration_freezes_tail_and_hits_loudness() {
    let _guard = SERIAL.lock().unwrap_or_else(|e| e.into_inner());
    let root = tempfile::tempdir().unwrap();
    std::env::set_var("CLIPES_DATA_DIR", root.path().join("data"));

    // Fonte sintética de 6 s com tom contínuo de 440 Hz (-18 dB RMS).
    let source = root.path().join("source.mp4");
    ffmpeg(&[
        "-v",
        "error",
        "-f",
        "lavfi",
        "-i",
        "testsrc2=size=320x180:rate=25:duration=6",
        "-f",
        "lavfi",
        "-i",
        "sine=frequency=440:sample_rate=48000:duration=6,volume=2.0",
        "-c:v",
        "libx264",
        "-preset",
        "ultrafast",
        "-pix_fmt",
        "yuv420p",
        "-c:a",
        "aac",
        "-y",
        source.to_str().unwrap(),
    ]);

    // Dois WAVs de Narração 24 kHz mono (880 Hz), no nível típico do Pocket TTS (-26..-21 dB RMS).
    let wav1 = root.path().join("nar1.wav");
    let wav2 = root.path().join("nar2.wav");
    make_sine_wav(&wav1, 880, 1.5, 0.7);
    make_sine_wav(&wav2, 880, 2.0, 0.7);

    let output = root.path().join("ducked-export.mp4");
    let input = RenderInput {
        source,
        output: output.clone(),
        start_us: 0,
        end_us: 6_000_000,
        audio_track: 1,
        words: vec![CaptionWord {
            text: "Teste".into(),
            start_us: 100_000,
            end_us: 800_000,
        }],
        crop: vec![],
    };
    // Bloco 1 em 1.5..3.0 s; Bloco 2 em 5.0..7.0 s -> sobra final de 1.0 s (`tpad`).
    let narration = NarrationRenderInput {
        tracks: vec![
            NarrationTrackInput {
                path: wav1,
                start_us: 1_500_000,
                duration_us: 1_500_000,
            },
            NarrationTrackInput {
                path: wav2,
                start_us: 5_000_000,
                duration_us: 2_000_000,
            },
        ],
        clip_duration_us: 6_000_000,
        freeze_tail_us: 1_000_000,
        total_duration_us: 7_000_000,
    };

    let mut progress = Vec::new();
    render_with_narration(
        Path::new(&ffmpeg_program()),
        &input,
        &[],
        Some(&narration),
        "libx264",
        &CancelToken::new(),
        &mut |p| progress.push(p),
    )
    .unwrap();
    assert_eq!(progress.last(), Some(&100));
    assert!(progress.windows(2).all(|w| w[0] <= w[1]));

    // 1. Duração total = 6.0 s do Corte + 1.0 s do `tpad` = 7.0 s; dimensões 1080x1920.
    let info = probe(&output);
    let dur: f64 = info["format"]["duration"]
        .as_str()
        .unwrap()
        .parse()
        .unwrap();
    assert!(
        (dur - 7.0).abs() <= 0.15,
        "duração esperada ~7.0 s (6 s + 1 s tpad), obtida {dur:.3} s"
    );
    let v_stream = info["streams"]
        .as_array()
        .unwrap()
        .iter()
        .find(|s| s["codec_type"] == "video")
        .unwrap();
    assert_eq!(v_stream["width"], 1080);
    assert_eq!(v_stream["height"], 1920);

    // 2. Nível da Fonte (440 Hz): cai ~12 dB durante a Narração e recupera no intervalo.
    let src_before = measure_band_mean_db(&output, 440, 0.2, 1.2);
    let src_during_b1 = measure_band_mean_db(&output, 440, 1.8, 2.8);
    let src_gap = measure_band_mean_db(&output, 440, 3.6, 4.7);
    let src_during_b2 = measure_band_mean_db(&output, 440, 5.3, 5.9);
    let duck_drop_b1 = src_before - src_during_b1;
    let duck_drop_b2 = src_before - src_during_b2;
    assert!(
        (8.0..=18.0).contains(&duck_drop_b1),
        "ducking no bloco 1 fora da faixa esperada (~12 dB): drop={duck_drop_b1:.2} dB (before={src_before:.2}, during={src_during_b1:.2})"
    );
    assert!(
        (8.0..=18.0).contains(&duck_drop_b2),
        "ducking no bloco 2 fora da faixa esperada (~12 dB): drop={duck_drop_b2:.2} dB"
    );
    assert!(
        (src_before - src_gap).abs() <= 1.5,
        "Fonte não recuperou o nível no intervalo: before={src_before:.2}, gap={src_gap:.2}"
    );

    // 3. Nível da Narração (880 Hz): não é abaixado junto e domina a Fonte durante o ducking.
    let nar_b1 = measure_band_mean_db(&output, 880, 1.8, 2.8);
    let nar_b2_tail = measure_band_mean_db(&output, 880, 6.1, 6.9);
    assert!(
        (nar_b1 - nar_b2_tail).abs() <= 1.5,
        "Narração oscilou entre o trecho com Fonte e a sobra final: b1={nar_b1:.2}, tail={nar_b2_tail:.2}"
    );
    assert!(
        nar_b1 > src_during_b1 + 2.0,
        "Narração ({nar_b1:.2} dB) deveria ficar acima da Fonte abaixada ({src_during_b1:.2} dB)"
    );

    // 4. `tpad` congela o último quadro durante a sobra final (6.0..7.0 s).
    let moving_before = frame_rgb(&output, 5.40);
    let tail_early = frame_rgb(&output, 6.20);
    let tail_late = frame_rgb(&output, 6.80);
    assert!(
        mean_rgb_diff(&moving_before, &tail_early) > 2.0,
        "vídeo deveria variar antes do fim do Corte"
    );
    let tail_diff = mean_rgb_diff(&tail_early, &tail_late);
    assert!(
        tail_diff < 0.5,
        "último quadro não congelou durante o tpad (diff={tail_diff:.2})"
    );

    // 5. Loudness final após mixagem continua dentro de -14 LUFS (±1 LU) e <= -1 dBTP (+0.1).
    let (lufs, peak) = measure_ebur128(&output);
    assert!(
        (lufs - -14.0).abs() <= 1.0,
        "loudness integrado {lufs:.2} LUFS fora de -14 ± 1"
    );
    assert!(
        peak <= -1.0 + 0.1,
        "true peak {peak:.2} dBTP acima de -1 (+0.1)"
    );
}

#[test]
fn headless_export_with_narration_and_silences_resolves_montage_mixes_and_ducks() {
    let _guard = SERIAL.lock().unwrap_or_else(|e| e.into_inner());
    let root = tempfile::tempdir().unwrap();
    let data_dir = root.path().join("data");
    std::env::set_var("CLIPES_DATA_DIR", &data_dir);

    // Registra o FFmpeg do ambiente no settings do `CLIPES_DATA_DIR` isolado.
    let ffmpeg_bin = ffmpeg_program();
    let ffmpeg_path = if Path::new(&ffmpeg_bin).is_absolute() {
        PathBuf::from(&ffmpeg_bin)
    } else {
        // Resolve o executável no PATH para `components::cache_settings`.
        let out = std::process::Command::new(if cfg!(windows) { "where" } else { "which" })
            .arg(&ffmpeg_bin)
            .output()
            .unwrap();
        let first = String::from_utf8_lossy(&out.stdout)
            .lines()
            .next()
            .unwrap()
            .trim()
            .to_owned();
        PathBuf::from(first)
    };
    fs::create_dir_all(&data_dir).unwrap();
    fs::write(
        data_dir.join("component-settings.json"),
        serde_json::to_vec(&json!({
            "data_dir": data_dir,
            "cache_dir": data_dir.join("cache"),
            "cache_limit_bytes": 100_000_000_u64,
            "ffmpeg_path": ffmpeg_path,
        }))
        .unwrap(),
    )
    .unwrap();

    let source_path = root.path().join("fonte.mp4");
    // 6 s de vídeo, 440 Hz contínuo exceto silêncio de 1.5 s em 2.5..4.0 s.
    ffmpeg(&[
        "-v",
        "error",
        "-f",
        "lavfi",
        "-i",
        "testsrc2=size=320x180:rate=25:duration=6",
        "-f",
        "lavfi",
        "-i",
        "sine=frequency=440:sample_rate=48000:duration=6,volume='if(between(t,2.5,4.0),0.0,2.0)':eval=frame",
        "-c:v",
        "libx264",
        "-preset",
        "ultrafast",
        "-pix_fmt",
        "yuv420p",
        "-c:a",
        "aac",
        "-y",
        source_path.to_str().unwrap(),
    ]);

    let project = dispatch(
        "projects.create",
        json!({"parent": root.path(), "name": "DuckExport"}),
        &mut |_| {},
    )
    .unwrap();
    let project_path = project["path"].as_str().unwrap().to_owned();
    let project_dir = PathBuf::from(&project_path);

    let insp = dispatch("sources.inspect", json!({"path": source_path}), &mut |_| {}).unwrap();
    let audio_track = insp["streams"]
        .as_array()
        .unwrap()
        .iter()
        .find(|s| s["codec_type"] == "audio")
        .unwrap()["index"]
        .as_i64()
        .unwrap();
    let source_id = dispatch(
        "sources.import",
        json!({
            "project": project_path,
            "path": source_path,
            "audio_track": audio_track,
            "copy": false,
            "permission": {"status": "none"},
        }),
        &mut |_| {},
    )
    .unwrap()["id"]
        .as_i64()
        .unwrap();

    // Prepara WAV real dentro de `<project>/narrations/c1/b1-v1.wav` (2.5 s em 880 Hz).
    let nar_dir = project_dir.join("narrations").join("c1");
    fs::create_dir_all(&nar_dir).unwrap();
    let wav_path = nar_dir.join("b1-v1.wav");
    make_sine_wav(&wav_path, 880, 2.5, 0.7);
    let wav_bytes = fs::read(&wav_path).unwrap().len() as i64;

    let candidate_id = with_writer(|c| {
        c.execute(
            "INSERT INTO transcripts(source_id,audio_track,engine,model,revision,compute_type,state,resume_us,duration_us) VALUES (?1,?2,'local','m','r','c','complete',6000000,6000000)",
            (source_id, audio_track),
        )?;
        let transcript_id = c.last_insert_rowid();
        // Frase 1 (0..2.5s) e Frase 2 (4.0..6.0s), deixando silêncio de 1.5s em 2.5..4.0s.
        c.execute(
            "INSERT INTO sentences(transcript_id,id,first_position,last_position,start_us,end_us,text) VALUES (?1,1,1,1,0,2500000,'Ola')",
            [transcript_id],
        )?;
        c.execute(
            "INSERT INTO sentences(transcript_id,id,first_position,last_position,start_us,end_us,text) VALUES (?1,2,2,2,4000000,6000000,'mundo')",
            [transcript_id],
        )?;
        c.execute(
            "INSERT INTO transcript_words(transcript_id,position,kind,text,start_us,end_us,language) VALUES (?1,1,'word','Ola',100000,2400000,'pt')",
            [transcript_id],
        )?;
        c.execute(
            "INSERT INTO transcript_words(transcript_id,position,kind,text,start_us,end_us,language) VALUES (?1,2,'word','mundo',4100000,5900000,'pt')",
            [transcript_id],
        )?;
        c.execute(
            "INSERT INTO selection_runs(transcript_id,task_version,prompt_sha256,profile,state,min_us,max_us,weights,plan_state,windows_total,video_kind) VALUES (?1,1,'h','legacy','completed',2000000,180000000,'{}','[]',1,'transformed')",
            [transcript_id],
        )?;
        let run_id = c.last_insert_rowid();
        c.execute(
            "INSERT INTO selection_candidates(run_id,rank,start_id,end_id,start_us,end_us,axes,total_centi,title,windows) VALUES (?1,1,1,2,0,6000000,'{}',900,'Corte','[0]')",
            [run_id],
        )?;
        let candidate_id = c.last_insert_rowid();
        c.execute(
            "INSERT INTO selection_decisions(run_id,cand_start_id,cand_end_id,decision,before_start_id,before_end_id,after_start_id,after_end_id) VALUES (?1,1,2,'approved',1,2,1,2)",
            [run_id],
        )?;
        c.execute(
            "INSERT INTO jobs(kind,safety,state,progress) VALUES ('ai:script','local','completed',100)",
            [],
        )?;
        let gen_job = c.last_insert_rowid();
        c.execute(
            "INSERT INTO script_generations(job_id,run_id,cand_start_id,cand_end_id,language,task_version,prompt_sha256,profile,safety,outline,angle) VALUES (?1,?2,1,2,'pt-BR',2,'h','legacy','local','[]','{\"name\":\"A\",\"promise\":\"P\"}')",
            (gen_job, run_id),
        )?;
        let gen_id = c.last_insert_rowid();
        c.execute(
            "INSERT INTO script_blocks(generation_id,position,title,intent,refs) VALUES (?1,1,'Bloco 1','I','[2]')",
            [gen_id],
        )?;
        let block_id = c.last_insert_rowid();
        c.execute(
            "INSERT INTO script_block_versions(block_id,kind,title,narration,refs,angle_revision) VALUES (?1,'generated','Bloco 1','Narracao de teste','[2]',0)",
            [block_id],
        )?;
        let ver_id = c.last_insert_rowid();
        c.execute(
            "INSERT INTO script_approvals(block_id,version_id,angle_revision) VALUES (?1,?2,0)",
            (block_id, ver_id),
        )?;
        c.execute(
            "INSERT INTO narration_blocks(block_id,version_id,voice_id,model_id,engine_id,audio_rel_path,duration_us,sample_rate,channels,bytes,sha256) VALUES (?1,?2,'13063','portuguese_24l','pocket-tts','narrations/c1/b1-v1.wav',2500000,24000,1,?3,'00')",
            (block_id, ver_id, wav_bytes),
        )?;
        Ok(candidate_id)
    })
    .unwrap();

    // Abre no editor (silêncio 2.5..4.0 s -> corta ~1.3 s, deixando ~4.7 s; Bloco 1 ancora em Frase 2 -> ~2.7 s + 2.5 s = 5.2 s -> ~0.5 s de tpad).
    let opened = dispatch(
        "editor.open",
        json!({"source_id": source_id, "start_id": 1, "end_id": 2, "candidate_id": candidate_id}),
        &mut |_| {},
    )
    .unwrap();
    let clip_id = opened["clipId"].as_i64().unwrap();
    assert!(opened["montage"]["blocks"][0]["audioId"].as_i64().is_some());

    let with_sil = dispatch(
        "editor.silences.detect",
        json!({"clip_id": clip_id, "threshold_us": 600_000}),
        &mut |_| {},
    )
    .unwrap();
    let freeze_tail_us = with_sil["montage"]["freezeTailUs"].as_i64().unwrap();
    let expected_total_us = with_sil["montage"]["totalDurationUs"].as_i64().unwrap();
    assert!(freeze_tail_us > 0, "esperava sobra final com tpad");
    dispatch("editor.flush", json!({}), &mut |_| {}).unwrap();

    let out_mp4 = root.path().join("headless-ducked.mp4");
    let started = dispatch(
        "export.start",
        json!({
            "source_id": source_id,
            "start_id": 1,
            "end_id": 2,
            "candidate_id": candidate_id,
            "clip_id": clip_id,
            "output": out_mp4,
        }),
        &mut |_| {},
    )
    .unwrap();
    let job_id = started["job"].as_i64().unwrap();

    let deadline = Instant::now() + Duration::from_secs(60);
    loop {
        let st = dispatch("export.status", json!({"job": job_id}), &mut |_| {}).unwrap();
        if st["state"] == "completed" {
            break;
        }
        assert_ne!(st["state"], "failed", "export falhou: {st}");
        assert!(Instant::now() < deadline, "export timeout: {st}");
        std::thread::sleep(Duration::from_millis(50));
    }

    let info = probe(&out_mp4);
    let actual_dur: f64 = info["format"]["duration"]
        .as_str()
        .unwrap()
        .parse()
        .unwrap();
    let expected_dur = expected_total_us as f64 / 1_000_000.0;
    assert!(
        (actual_dur - expected_dur).abs() <= 0.2,
        "duração esperada {expected_dur:.3} s, obtida {actual_dur:.3} s"
    );

    // Fonte (440 Hz) antes da Narração (~0.2..2.0 s) vs durante a Narração (~3.0..4.3 s).
    let nar_start_s = with_sil["montage"]["blocks"][0]["startUs"]
        .as_i64()
        .unwrap() as f64
        / 1_000_000.0;
    let src_before = measure_band_mean_db(&out_mp4, 440, 0.2, (nar_start_s - 0.3).max(0.4));
    let src_during = measure_band_mean_db(
        &out_mp4,
        440,
        nar_start_s + 0.3,
        (nar_start_s + 1.4).min(expected_dur - freeze_tail_us as f64 / 1_000_000.0 - 0.1),
    );
    assert!(
        src_before - src_during >= 7.0,
        "ducking headless insuficiente: before={src_before:.2}, during={src_during:.2}"
    );
}
