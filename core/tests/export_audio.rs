//! Harness real de trilha sonora e efeitos sonoros no export (#154):
//! - confere ducking da trilha por automação de volume com rampa (~ -12 dB) nos intervalos de fala
//!   (vindos das Frases da Transcrição e do alinhamento da Narração) e recuperação sem fala;
//! - confere repetição (`loop_to_fit`) e corte da trilha com `afade` de entrada e saída;
//! - confere posição exata dos efeitos sonoros ancorados em momento ou palavra;
//! - confere loudness final (-14 LUFS / <= -1 dBTP) e fluxo headless completo (`export.start`)
//!   com `CLIPES_DATA_DIR` isolado, sem rede nem mídia de terceiros.

use clipes_core::{
    audio::SpeechInterval,
    dispatch,
    export::{
        captions::CaptionWord,
        render::{
            render_with_audio, AudioMixRenderInput, RenderInput, SfxRenderInput,
            SoundtrackRenderInput,
        },
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
        .expect("instale FFmpeg com libass para o harness de áudio")
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

fn measure_band_mean_db(path: &Path, freq_hz: u32, start_s: f64, end_s: f64) -> f64 {
    // 3 estágios de bandpass estreito (~ -55 dB fora da banda) para que a fala em outra frequência não vaze na medida.
    let bp = format!("bandpass=frequency={freq_hz}:width_type=h:width=40");
    let filter = format!(
        "atrim=start={start_s:.3}:end={end_s:.3},asetpts=PTS-STARTPTS,{bp},{bp},{bp},volumedetect"
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

fn make_sine_wav(path: &Path, freq_hz: u32, duration_s: f64, volume: f64) {
    ffmpeg(&[
        "-v",
        "error",
        "-f",
        "lavfi",
        "-i",
        &format!(
            "sine=frequency={freq_hz}:sample_rate=48000:duration={duration_s:.3},volume={volume}"
        ),
        "-c:a",
        "pcm_s16le",
        "-y",
        path.to_str().unwrap(),
    ]);
}

#[test]
fn real_ffmpeg_soundtrack_ducks_on_speech_loops_fades_and_places_sfx() {
    let _guard = SERIAL.lock().unwrap_or_else(|e| e.into_inner());
    let root = tempfile::tempdir().unwrap();
    std::env::set_var("CLIPES_DATA_DIR", root.path().join("data"));

    // Fonte de 8 s com tom de 440 Hz apenas durante a fala (1..3 s e 5.5..7.5 s), e silêncio nos demais trechos.
    let source = root.path().join("source.mp4");
    ffmpeg(&[
        "-v",
        "error",
        "-f",
        "lavfi",
        "-i",
        "testsrc2=size=320x180:rate=25:duration=8",
        "-f",
        "lavfi",
        "-i",
        "sine=frequency=440:sample_rate=48000:duration=8,volume='if(between(t,1.0,3.0)+between(t,5.5,7.5),0.8,0.0)':eval=frame",
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

    // Trilha sonora curta de 2.0 s em 220 Hz (será repetida com loop_to_fit para preencher os 8.0 s).
    let music_wav = root.path().join("music.wav");
    make_sine_wav(&music_wav, 220, 2.0, 0.8);

    // Efeito sonoro de 0.5 s em 1760 Hz posicionado em t = 4.0 s.
    let sfx_wav = root.path().join("sfx.wav");
    make_sine_wav(&sfx_wav, 1760, 0.5, 0.9);

    let output = root.path().join("audio-mix-export.mp4");
    let input = RenderInput {
        source,
        output: output.clone(),
        start_us: 0,
        end_us: 8_000_000,
        audio_track: 1,
        words: vec![CaptionWord {
            text: "Teste".into(),
            start_us: 1_000_000,
            end_us: 2_500_000,
        }],
        crop: vec![],
    };

    let audio = AudioMixRenderInput {
        soundtrack: Some(SoundtrackRenderInput {
            path: music_wav,
            asset_duration_us: 2_000_000,
            start_us: 0,
            play_duration_us: 8_000_000,
            volume: 0.4,
            fade_in_us: 300_000,
            fade_out_us: 400_000,
            loop_to_fit: true,
        }),
        sfx: vec![SfxRenderInput {
            path: sfx_wav,
            start_us: 4_000_000,
            play_duration_us: 500_000,
            volume: 0.9,
            fade_in_us: 20_000,
            fade_out_us: 50_000,
        }],
        speech_intervals: vec![
            SpeechInterval {
                start_us: 1_000_000,
                end_us: 3_000_000,
            },
            SpeechInterval {
                start_us: 5_500_000,
                end_us: 7_500_000,
            },
        ],
        clip_duration_us: 8_000_000,
        total_duration_us: 8_000_000,
    };

    let mut progress = Vec::new();
    render_with_audio(
        Path::new(&ffmpeg_program()),
        &input,
        &[],
        None,
        Some(&audio),
        "libx264",
        &CancelToken::new(),
        &mut |p| progress.push(p),
    )
    .unwrap();
    assert_eq!(progress.last(), Some(&100));

    let info = probe(&output);
    let dur: f64 = info["format"]["duration"]
        .as_str()
        .unwrap()
        .parse()
        .unwrap();
    assert!((dur - 8.0).abs() <= 0.15, "dur={dur}");

    // 1. Nível da trilha (220 Hz) sem fala vs com fala (~ -12 dB de redução com rampa) e repetição até o fim.
    let music_no_speech_early = measure_band_mean_db(&output, 220, 0.4, 0.9);
    let music_during_speech_1 = measure_band_mean_db(&output, 220, 1.3, 2.7);
    let music_gap = measure_band_mean_db(&output, 220, 3.6, 5.1);
    let music_during_speech_2 = measure_band_mean_db(&output, 220, 5.8, 7.2);

    let drop1 = music_no_speech_early - music_during_speech_1;
    let drop2 = music_gap - music_during_speech_2;
    assert!(
        (9.0..=15.0).contains(&drop1),
        "ducking da trilha na fala 1 fora da faixa (~12 dB): drop={drop1:.2} dB (early={music_no_speech_early:.2}, speech1={music_during_speech_1:.2})"
    );
    assert!(
        (9.0..=15.0).contains(&drop2),
        "ducking da trilha na fala 2 (após repetição) fora da faixa (~12 dB): drop={drop2:.2} dB (gap={music_gap:.2}, speech2={music_during_speech_2:.2})"
    );
    assert!(
        (music_no_speech_early - music_gap).abs() <= 1.5,
        "trilha não recuperou o nível no intervalo sem fala: early={music_no_speech_early:.2}, gap={music_gap:.2}"
    );

    // 2. Fades de entrada e saída da trilha.
    let fade_in_head = measure_band_mean_db(&output, 220, 0.0, 0.12);
    let fade_out_tail = measure_band_mean_db(&output, 220, 7.85, 7.98);
    assert!(
        fade_in_head < music_no_speech_early - 4.0,
        "fade-in não atenuou o início: head={fade_in_head:.2}, steady={music_no_speech_early:.2}"
    );
    assert!(
        fade_out_tail < music_gap - 4.0,
        "fade-out não atenuou o fim: tail={fade_out_tail:.2}, steady={music_gap:.2}"
    );

    // 3. Posição do efeito sonoro (1760 Hz em 4.0..4.5 s).
    let sfx_before = measure_band_mean_db(&output, 1760, 2.0, 3.5);
    let sfx_at = measure_band_mean_db(&output, 1760, 4.05, 4.40);
    let sfx_after = measure_band_mean_db(&output, 1760, 5.0, 6.5);
    assert!(
        sfx_at > sfx_before + 15.0 && sfx_at > sfx_after + 15.0,
        "efeito não apareceu na posição esperada: before={sfx_before:.2}, at={sfx_at:.2}, after={sfx_after:.2}"
    );

    // 4. Loudness final dentro do alvo -14 LUFS (±1 LU) e <= -1 dBTP (+0.1).
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
fn headless_export_with_sentence_speech_word_anchored_sfx_and_narration() {
    let _guard = SERIAL.lock().unwrap_or_else(|e| e.into_inner());
    let root = tempfile::tempdir().unwrap();
    let data_dir = root.path().join("data");
    std::env::set_var("CLIPES_DATA_DIR", &data_dir);

    let ffmpeg_bin = ffmpeg_program();
    let ffmpeg_path = if Path::new(&ffmpeg_bin).is_absolute() {
        PathBuf::from(&ffmpeg_bin)
    } else {
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

    // Fonte de 7 s: fala de 440 Hz apenas na Frase 1 (0..2.0 s); silêncio de 2.0..5.0 s; Frase 2 (5.0..7.0 s) com Narração (880 Hz).
    let source_path = root.path().join("fonte.mp4");
    ffmpeg(&[
        "-v",
        "error",
        "-f",
        "lavfi",
        "-i",
        "testsrc2=size=320x180:rate=25:duration=7",
        "-f",
        "lavfi",
        "-i",
        "sine=frequency=440:sample_rate=48000:duration=7,volume='if(between(t,0.0,2.0),0.8,0.0)':eval=frame",
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
        json!({"parent": root.path(), "name": "AudioExportHeadless"}),
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

    // Narração (880 Hz, 2.0 s) ancorada na Frase 2 (5.0..7.0 s).
    let nar_dir = project_dir.join("narrations").join("c1");
    fs::create_dir_all(&nar_dir).unwrap();
    let nar_wav = nar_dir.join("b1-v1.wav");
    make_sine_wav(&nar_wav, 880, 2.0, 0.8);
    let nar_bytes = fs::read(&nar_wav).unwrap().len() as i64;

    let music_wav = root.path().join("trilha-longa.wav");
    let sfx_wav = root.path().join("efeito.wav");
    make_sine_wav(&music_wav, 220, 12.0, 0.8); // 12 s > 7 s -> cortada para 7 s!
    make_sine_wav(&sfx_wav, 1760, 0.5, 0.9);

    let music_id = dispatch(
        "audio.import",
        json!({"path": music_wav, "kind": "music", "license_kind": "youtube_audio_library"}),
        &mut |_| {},
    )
    .unwrap()["id"]
        .as_i64()
        .unwrap();
    let sfx_id = dispatch(
        "audio.import",
        json!({"path": sfx_wav, "kind": "sfx", "license_kind": "original"}),
        &mut |_| {},
    )
    .unwrap()["id"]
        .as_i64()
        .unwrap();

    let candidate_id = with_writer(|c| {
        c.execute(
            "INSERT INTO transcripts(source_id,audio_track,engine,model,revision,compute_type,state,resume_us,duration_us) VALUES (?1,?2,'local','m','r','c','complete',7000000,7000000)",
            (source_id, audio_track),
        )?;
        let tid = c.last_insert_rowid();
        c.execute(
            "INSERT INTO transcript_words(transcript_id,position,kind,text,start_us,end_us,language) VALUES (?1,0,'word','Inicio',0,2000000,'pt')",
            [tid],
        )?;
        c.execute(
            "INSERT INTO transcript_words(transcript_id,position,kind,text,start_us,end_us,language) VALUES (?1,1,'word','Impacto',3000000,3500000,'pt')",
            [tid],
        )?;
        c.execute(
            "INSERT INTO transcript_words(transcript_id,position,kind,text,start_us,end_us,language) VALUES (?1,2,'word','Fim.',5000000,7000000,'pt')",
            [tid],
        )?;
        c.execute(
            "INSERT INTO sentences(transcript_id,id,first_position,last_position,start_us,end_us,text) VALUES (?1,1,0,0,0,2000000,'Inicio')",
            [tid],
        )?;
        c.execute(
            "INSERT INTO sentences(transcript_id,id,first_position,last_position,start_us,end_us,text) VALUES (?1,2,2,2,5000000,7000000,'Fim.')",
            [tid],
        )?;
        c.execute(
            "INSERT INTO selection_runs(transcript_id,task_version,prompt_sha256,profile,state,batch,min_us,max_us,weights,plan_state,windows_total,video_kind) VALUES (?1,1,'h','p','completed','',5000000,180000000,'[]','full',1,'transformed')",
            [tid],
        )?;
        let run_id = c.last_insert_rowid();
        c.execute(
            "INSERT INTO selection_candidates(run_id,rank,start_id,end_id,start_us,end_us,axes,total_centi,title,windows,adjust) VALUES (?1,1,1,2,0,7000000,'{}',900,'AudioTeste','[0]',NULL)",
            [run_id],
        )?;
        let cand_id = c.last_insert_rowid();
        c.execute(
            "INSERT INTO selection_decisions(run_id,cand_start_id,cand_end_id,decision,before_start_id,before_end_id,after_start_id,after_end_id) VALUES (?1,1,2,'approved',1,2,1,2)",
            [run_id],
        )?;
        c.execute(
            "INSERT INTO script_generations(job_id,run_id,cand_start_id,cand_end_id,language,task_version,prompt_sha256,profile,safety,outline,angle) VALUES (9511,?1,1,2,'pt-BR',1,'h','p','local','{}','{}')",
            [run_id],
        )?;
        let gen_id = c.last_insert_rowid();
        c.execute(
            "INSERT INTO script_blocks(generation_id,position,title,intent,refs) VALUES (?1,1,'Fecho','i','[2]')",
            [gen_id],
        )?;
        let bid = c.last_insert_rowid();
        c.execute(
            "INSERT INTO script_block_versions(block_id,kind,title,narration,refs,angle_revision) VALUES (?1,'generated','Fecho','Comenta','[2]',0)",
            [bid],
        )?;
        let vid = c.last_insert_rowid();
        c.execute(
            "INSERT INTO script_approvals(block_id,version_id,angle_revision) VALUES (?1,?2,0)",
            (bid, vid),
        )?;
        c.execute(
            "INSERT INTO narration_blocks(block_id,version_id,voice_id,model_id,engine_id,audio_rel_path,duration_us,sample_rate,channels,bytes,sha256) VALUES (?1,?2,'alba','m','pocket-tts','narrations/c1/b1-v1.wav',2000000,48000,1,?3,'h154')",
            (bid, vid, nar_bytes),
        )?;
        Ok(cand_id)
    })
    .unwrap();

    let opened = dispatch(
        "editor.open",
        json!({"source_id": source_id, "start_id": 1, "end_id": 2, "candidate_id": candidate_id}),
        &mut |_| {},
    )
    .unwrap();
    let clip_id = opened["clipId"].as_i64().unwrap();

    dispatch(
        "editor.audio.soundtrack.set",
        json!({
            "clip_id": clip_id,
            "asset_id": music_id,
            "start_us": 0,
            "volume": 0.4,
            "fade_in_us": 200_000,
            "fade_out_us": 300_000,
            "loop_to_fit": false
        }),
        &mut |_| {},
    )
    .unwrap();
    dispatch(
        "editor.audio.sfx.add",
        json!({
            "clip_id": clip_id,
            "asset_id": sfx_id,
            "anchor": {"kind": "word", "track": "original", "position": 1, "offset_us": 0},
            "volume": 0.9
        }),
        &mut |_| {},
    )
    .unwrap();
    dispatch("editor.flush", json!({}), &mut |_| {}).unwrap();

    let export_out = root.path().join("headless-audio-out.mp4");
    let started = dispatch(
        "export.start",
        json!({
            "source_id": source_id,
            "start_id": 1,
            "end_id": 2,
            "candidate_id": candidate_id,
            "clip_id": clip_id,
            "output": export_out,
        }),
        &mut |_| {},
    )
    .unwrap();
    let job_id = started["job"].as_i64().unwrap();

    let deadline = Instant::now() + Duration::from_secs(45);
    loop {
        let st = dispatch("export.status", json!({"job": job_id}), &mut |_| {}).unwrap();
        match st["state"].as_str().unwrap() {
            "completed" => break,
            "failed" | "cancelled" => panic!("export falhou: {st}"),
            _ if Instant::now() > deadline => panic!("timeout esperando export: {st}"),
            _ => std::thread::sleep(Duration::from_millis(100)),
        }
    }

    // Trilha (220 Hz) cai durante Frase 1 (0..2 s) e Narração (5..7 s), e sobe no intervalo (2.5..4.7 s).
    let music_speech_1 = measure_band_mean_db(&export_out, 220, 0.4, 1.8);
    let music_gap = measure_band_mean_db(&export_out, 220, 2.6, 4.6);
    let music_narration = measure_band_mean_db(&export_out, 220, 5.3, 6.6);
    assert!(
        music_gap - music_speech_1 >= 8.0,
        "trilha não abaixou na Frase 1: gap={music_gap:.2}, speech1={music_speech_1:.2}"
    );
    assert!(
        music_gap - music_narration >= 8.0,
        "trilha não abaixou na Narração: gap={music_gap:.2}, nar={music_narration:.2}"
    );

    // Efeito sonoro ancorado na palavra "Impacto" (3.0..3.5 s).
    let sfx_before = measure_band_mean_db(&export_out, 1760, 1.0, 2.5);
    let sfx_at = measure_band_mean_db(&export_out, 1760, 3.05, 3.40);
    assert!(
        sfx_at > sfx_before + 15.0,
        "efeito ancorado em palavra não apareceu em 3.0 s: before={sfx_before:.2}, at={sfx_at:.2}"
    );

    dispatch("projects.close", json!({}), &mut |_| {}).unwrap();
}
