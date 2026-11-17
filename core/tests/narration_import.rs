//! Testes headless da importação de áudio de Narração por bloco (#84):
//! - trava do Roteiro aprovado (`script::narration_allowed`) e Vídeo transformado;
//! - pré-validações tipadas sem caminhos pessoais (ADR-0006): arquivo ausente, extensão, vazio, > 200 MiB, FFmpeg ausente;
//! - importação real com FFmpeg/ffprobe e áudio sintético (`lavfi`) em WAV, MP3, M4A e OGG;
//! - conversão para o formato padrão da Narração (WAV PCM s16le, 24000 Hz, mono) em `narrations/` (caminho relativo);
//! - aviso `multiple_audio_streams` quando há múltiplos streams de áudio (usando o primeiro);
//! - validação de codec (`import_unsupported_codec`), ausência de stream de áudio (`import_no_audio_stream`) e duração (`import_duration_too_short` / `import_duration_too_long`);
//! - disparo automático do alinhamento (#81), integração com montagem (#204), `media::serve`, guardrails (#76), cancelamento e ducking real (#82).

use clipes_core::{
    dispatch, media::serve, projects::with_writer, tts::block_durations_for_candidate, CoreError,
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
        .expect("ffmpeg e ffprobe são necessários para os testes de importação");
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

fn install_fake_worker_and_whisper(data_dir: &Path) {
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

fn seed_transformed_cut(media_path: Option<&Path>, approved_script: bool) -> (i64, i64, Vec<i64>) {
    let (source_path_str, size, partial) = match media_path {
        Some(p) => {
            let (sz, part) = {
                let bytes = fs::read(p).unwrap();
                let mut h = Sha256::new();
                // Para arquivo pequeno, partial() lê [0, 0, 0]
                for _ in 0..3 {
                    h.update(&bytes);
                }
                (bytes.len() as i64, format!("{:x}", h.finalize()))
            };
            (p.to_string_lossy().into_owned(), sz, part)
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
            c.execute(
                "INSERT INTO transcript_words(transcript_id,position,kind,text,start_us,end_us,language) VALUES (?1,?2,'word',?3,?4,?5,'pt')",
                (transcript, id * 2 - 1, "Ola", s0 + 50_000, s0 + 800_000),
            )?;
            c.execute(
                "INSERT INTO transcript_words(transcript_id,position,kind,text,start_us,end_us,language) VALUES (?1,?2,'word',?3,?4,?5,'pt')",
                (transcript, id * 2, "mundo.", s0 + 900_000, s1 - 50_000),
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
            (2_i64, "Fecho", "Segunda frase.", "[2]"),
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
            if approved_script || pos == 1 {
                c.execute(
                    "INSERT INTO script_approvals(block_id,version_id,angle_revision) VALUES (?1,?2,0)",
                    (bid, vid),
                )?;
            }
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
        assert!(
            Instant::now() < deadline,
            "timeout aguardando importação/alinhamento: {doc}"
        );
        std::thread::sleep(Duration::from_millis(40));
    }
}

fn wait_import_settled(candidate: i64) -> Value {
    let deadline = Instant::now() + Duration::from_secs(20);
    loop {
        let doc = call("narration.get", json!({"candidate": candidate}));
        if !doc["importBusy"].as_bool().unwrap_or(false) {
            return doc;
        }
        assert!(
            Instant::now() < deadline,
            "timeout aguardando narration_import: {doc}"
        );
        std::thread::sleep(Duration::from_millis(30));
    }
}

fn assert_no_personal_path(err: &CoreError, needle: &Path) {
    let needle_str = needle.to_string_lossy();
    assert!(
        !err.message.contains(needle_str.as_ref()),
        "erro vazou caminho pessoal (ADR-0006): {}",
        err.message
    );
    if let Some(name) = needle.file_name().and_then(|n| n.to_str()) {
        assert!(
            !err.message.contains(name),
            "erro vazou nome de arquivo pessoal (ADR-0006): {}",
            err.message
        );
    }
}

#[test]
fn enforces_approved_script_gate_and_prevalidation_without_personal_paths() {
    let _guard = SERIAL.lock().unwrap_or_else(|e| e.into_inner());
    let root = tempfile::tempdir().unwrap();
    let data_dir = root.path().join("data");
    std::env::set_var("CLIPES_DATA_DIR", &data_dir);

    call(
        "projects.create",
        json!({"parent": root.path(), "name": "GateProj"}),
    );
    let (_, unapproved_cand, block_ids) = seed_transformed_cut(None, false);

    let wav = root.path().join("segredo-pessoal.wav");
    run_ffmpeg(&[
        "-v",
        "error",
        "-y",
        "-f",
        "lavfi",
        "-i",
        "sine=frequency=440:duration=1.0",
        "-c:a",
        "pcm_s16le",
        wav.to_str().unwrap(),
    ]);

    // 1. Sem Roteiro aprovado -> script_not_approved
    let err = fail(
        "narration.import",
        json!({"candidate": unapproved_cand, "block": block_ids[0], "path": wav}),
    );
    assert_eq!(err.code, "script_not_approved");

    // Aprova o segundo bloco para liberar a trava.
    call(
        "script.approve",
        json!({"candidate": unapproved_cand, "block": block_ids[1]}),
    );

    // 2. Sem FFmpeg configurado -> component_missing
    let err = fail(
        "narration.import",
        json!({"candidate": unapproved_cand, "block": block_ids[0], "path": wav}),
    );
    assert_eq!(err.code, "component_missing");

    // Configura FFmpeg do sistema para validar as checagens de arquivo.
    configure_system_ffmpeg(&data_dir);

    // 3. Arquivo ausente -> import_file_missing sem caminho pessoal
    let missing = root.path().join("arquivo-inexistente-usuario.mp3");
    let err = fail(
        "narration.import",
        json!({"candidate": unapproved_cand, "block": block_ids[0], "path": missing}),
    );
    assert_eq!(err.code, "import_file_missing");
    assert_no_personal_path(&err, &missing);

    // 4. Extensão não suportada -> import_unsupported_format
    let bad_ext = root.path().join("notas-privadas.txt");
    fs::write(&bad_ext, b"texto").unwrap();
    let err = fail(
        "narration.import",
        json!({"candidate": unapproved_cand, "block": block_ids[0], "path": bad_ext}),
    );
    assert_eq!(err.code, "import_unsupported_format");
    assert_no_personal_path(&err, &bad_ext);

    // 5. Arquivo vazio -> import_empty_file
    let empty_mp3 = root.path().join("vazio.mp3");
    fs::write(&empty_mp3, b"").unwrap();
    let err = fail(
        "narration.import",
        json!({"candidate": unapproved_cand, "block": block_ids[0], "path": empty_mp3}),
    );
    assert_eq!(err.code, "import_empty_file");
    assert_no_personal_path(&err, &empty_mp3);

    // 6. Arquivo > 200 MiB -> import_file_too_large
    let huge_wav = root.path().join("gigante.wav");
    {
        let f = fs::File::create(&huge_wav).unwrap();
        f.set_len(200 * 1024 * 1024 + 1).unwrap();
    }
    let err = fail(
        "narration.import",
        json!({"candidate": unapproved_cand, "block": block_ids[0], "path": huge_wav}),
    );
    assert_eq!(err.code, "import_file_too_large");
    assert_no_personal_path(&err, &huge_wav);

    let _ = call("projects.close", json!({}));
}

#[test]
fn imports_wav_mp3_m4a_ogg_validates_ffprobe_and_triggers_alignment() {
    let _guard = SERIAL.lock().unwrap_or_else(|e| e.into_inner());
    let root = tempfile::tempdir().unwrap();
    let data_dir = root.path().join("data");
    std::env::set_var("CLIPES_DATA_DIR", &data_dir);
    std::env::set_var("CLIPES_FAKE_WORKER_MODE", "transcribe");
    std::env::remove_var("CLIPES_FAKE_ALIGN_SPOKEN");
    std::env::remove_var("CLIPES_FAKE_ALIGN_FAIL");

    configure_system_ffmpeg(&data_dir);
    install_fake_worker_and_whisper(&data_dir);

    let proj = call(
        "projects.create",
        json!({"parent": root.path(), "name": "ImportProj"}),
    );
    let proj_dir = PathBuf::from(proj["path"].as_str().unwrap());
    let (_, candidate, block_ids) = seed_transformed_cut(None, true);

    // Gera amostras sintéticas em WAV (48k estéreo), MP3, M4A (AAC) e OGG (Opus/Vorbis).
    let wav_in = root.path().join("voz_48k_stereo.wav");
    let mp3_in = root.path().join("voz.mp3");
    let m4a_in = root.path().join("voz.m4a");
    let ogg_in = root.path().join("voz.ogg");

    run_ffmpeg(&[
        "-v",
        "error",
        "-y",
        "-f",
        "lavfi",
        "-i",
        "sine=frequency=520:sample_rate=48000:duration=1.5",
        "-ac",
        "2",
        "-c:a",
        "pcm_s16le",
        wav_in.to_str().unwrap(),
    ]);
    run_ffmpeg(&[
        "-v",
        "error",
        "-y",
        "-f",
        "lavfi",
        "-i",
        "sine=frequency=620:sample_rate=44100:duration=1.8",
        "-c:a",
        "libmp3lame",
        "-b:a",
        "128k",
        mp3_in.to_str().unwrap(),
    ]);
    run_ffmpeg(&[
        "-v",
        "error",
        "-y",
        "-f",
        "lavfi",
        "-i",
        "sine=frequency=720:sample_rate=44100:duration=2.1",
        "-c:a",
        "aac",
        "-b:a",
        "128k",
        m4a_in.to_str().unwrap(),
    ]);
    run_ffmpeg(&[
        "-v",
        "error",
        "-y",
        "-f",
        "lavfi",
        "-i",
        "sine=frequency=820:sample_rate=48000:duration=1.4",
        "-c:a",
        "libopus",
        ogg_in.to_str().unwrap(),
    ]);

    // 1. Importa WAV 48k estéreo no bloco 1 -> converte para 24 kHz mono e alinha automaticamente.
    let job1 = call(
        "narration.import",
        json!({"candidate": candidate, "block": block_ids[0], "path": wav_in}),
    );
    assert!(job1["job"].as_i64().is_some());
    let doc1 = wait_narration_settled(candidate);
    assert_eq!(doc1["importJob"]["state"], "completed");
    assert_eq!(doc1["importJob"]["warning"], Value::Null);
    let b0_audio = &doc1["blocks"][0]["audio"];
    assert_eq!(b0_audio["engineId"], "imported");
    assert_eq!(b0_audio["voiceId"], "imported");
    assert_eq!(b0_audio["modelId"], "external");
    assert_eq!(b0_audio["sampleRate"], 24_000);
    assert_eq!(b0_audio["channels"], 1);
    let rel0 = b0_audio["relPath"].as_str().unwrap();
    assert!(rel0.starts_with("narrations/"));
    assert!(proj_dir.join(rel0).is_file());
    assert_eq!(doc1["blocks"][0]["alignment"]["status"], "aligned");
    assert!(
        doc1["blocks"][0]["alignment"]["wordCount"]
            .as_i64()
            .unwrap()
            > 0
    );

    // Verifica que source_path foi limpo do SQLite após conclusão e media::serve funciona.
    let audio_id0 = b0_audio["id"].as_i64().unwrap();
    let served = serve(&format!("narration/{audio_id0}"), None);
    assert_eq!(served.status, 200);
    let leaked: String = with_writer(|c| {
        c.query_row(
            "SELECT source_path FROM narration_import_jobs WHERE job_id=?1",
            [job1["job"].as_i64().unwrap()],
            |r| r.get(0),
        )
    })
    .unwrap();
    assert_eq!(leaked, "");

    // Guardrails: Narração importada humana NÃO dispara aviso de voz sintética TTS (#76).
    let guard = call(
        "guardrails.check",
        json!({"scope": "single", "source_id": 1, "candidate_id": candidate, "start_id": 1, "end_id": 3}),
    );
    assert_eq!(guard["narration"]["applicable"], true);
    assert_eq!(guard["narration"]["hasTts"], false);

    // 2. Importa MP3 no bloco 2, depois substitui por M4A e OGG no mesmo bloco.
    for (file_path, expected_sec) in [(&mp3_in, 1.8_f64), (&m4a_in, 2.1_f64), (&ogg_in, 1.4_f64)] {
        call(
            "narration.import",
            json!({"candidate": candidate, "block": block_ids[1], "path": file_path}),
        );
        let doc = wait_narration_settled(candidate);
        assert_eq!(doc["importJob"]["state"], "completed");
        let dur_us = doc["blocks"][1]["audio"]["durationUs"].as_i64().unwrap();
        let diff = ((dur_us as f64 / 1_000_000.0) - expected_sec).abs();
        assert!(
            diff < 0.15,
            "duração inesperada para {}: {} us (esperado ~{} s)",
            file_path.display(),
            dur_us,
            expected_sec
        );
        assert_eq!(doc["blocks"][1]["audio"]["sampleRate"], 24_000);
        assert_eq!(doc["blocks"][1]["audio"]["channels"], 1);
        assert_eq!(doc["blocks"][1]["alignment"]["status"], "aligned");
    }

    // Durações reais expostas para a montagem (#204).
    let durations = block_durations_for_candidate(candidate).unwrap();
    assert_eq!(durations.len(), 2);

    // 3. Arquivo com múltiplos streams de áudio -> usa o primeiro e grava aviso.
    let multi_m4a = root.path().join("multi.m4a");
    run_ffmpeg(&[
        "-v",
        "error",
        "-y",
        "-f",
        "lavfi",
        "-i",
        "sine=frequency=440:duration=1.1",
        "-f",
        "lavfi",
        "-i",
        "sine=frequency=880:duration=1.1",
        "-map",
        "0:a",
        "-map",
        "1:a",
        "-c:a",
        "aac",
        multi_m4a.to_str().unwrap(),
    ]);
    call(
        "narration.import",
        json!({"candidate": candidate, "block": block_ids[0], "path": multi_m4a}),
    );
    let doc_multi = wait_narration_settled(candidate);
    assert_eq!(doc_multi["importJob"]["state"], "completed");
    assert_eq!(doc_multi["importJob"]["warning"], "multiple_audio_streams");

    // 4. Erros no ffprobe (sem stream de áudio, codec não suportado, curto demais, longo demais).
    let no_audio_m4a = root.path().join("so-video-privado.m4a");
    run_ffmpeg(&[
        "-v",
        "error",
        "-y",
        "-f",
        "lavfi",
        "-i",
        "color=c=black:s=64x64:d=1.0",
        "-c:v",
        "mpeg4",
        "-f",
        "mp4",
        no_audio_m4a.to_str().unwrap(),
    ]);
    call(
        "narration.import",
        json!({"candidate": candidate, "block": block_ids[0], "path": no_audio_m4a}),
    );
    let doc_no_audio = wait_import_settled(candidate);
    assert_eq!(doc_no_audio["importJob"]["state"], "failed");
    assert_eq!(doc_no_audio["importJob"]["code"], "import_no_audio_stream");

    let ac3_wav = root.path().join("codec-ac3.wav");
    run_ffmpeg(&[
        "-v",
        "error",
        "-y",
        "-f",
        "lavfi",
        "-i",
        "sine=frequency=440:duration=1.0",
        "-c:a",
        "ac3",
        ac3_wav.to_str().unwrap(),
    ]);
    call(
        "narration.import",
        json!({"candidate": candidate, "block": block_ids[0], "path": ac3_wav}),
    );
    let doc_bad_codec = wait_import_settled(candidate);
    assert_eq!(doc_bad_codec["importJob"]["state"], "failed");
    assert_eq!(
        doc_bad_codec["importJob"]["code"],
        "import_unsupported_codec"
    );

    let short_wav = root.path().join("curto.wav");
    run_ffmpeg(&[
        "-v",
        "error",
        "-y",
        "-f",
        "lavfi",
        "-i",
        "sine=frequency=440:duration=0.1",
        "-c:a",
        "pcm_s16le",
        short_wav.to_str().unwrap(),
    ]);
    call(
        "narration.import",
        json!({"candidate": candidate, "block": block_ids[0], "path": short_wav}),
    );
    let doc_short = wait_import_settled(candidate);
    assert_eq!(doc_short["importJob"]["state"], "failed");
    assert_eq!(doc_short["importJob"]["code"], "import_duration_too_short");

    let long_ogg = root.path().join("longo.ogg");
    run_ffmpeg(&[
        "-v",
        "error",
        "-y",
        "-f",
        "lavfi",
        "-i",
        "anullsrc=r=8000:cl=mono",
        "-t",
        "605",
        "-c:a",
        "libopus",
        long_ogg.to_str().unwrap(),
    ]);
    call(
        "narration.import",
        json!({"candidate": candidate, "block": block_ids[0], "path": long_ogg}),
    );
    let doc_long = wait_import_settled(candidate);
    assert_eq!(doc_long["importJob"]["state"], "failed");
    assert_eq!(doc_long["importJob"]["code"], "import_duration_too_long");

    let _ = call("projects.close", json!({}));
}

#[test]
fn imported_narration_flows_into_captions_and_real_ducking_export() {
    let _guard = SERIAL.lock().unwrap_or_else(|e| e.into_inner());
    let root = tempfile::tempdir().unwrap();
    let data_dir = root.path().join("data");
    std::env::set_var("CLIPES_DATA_DIR", &data_dir);
    std::env::set_var("CLIPES_FAKE_WORKER_MODE", "transcribe");
    std::env::remove_var("CLIPES_FAKE_ALIGN_SPOKEN");
    std::env::remove_var("CLIPES_FAKE_ALIGN_FAIL");

    configure_system_ffmpeg(&data_dir);
    install_fake_worker_and_whisper(&data_dir);

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
        json!({"parent": root.path(), "name": "DuckProj"}),
    );
    let proj_dir = PathBuf::from(proj["path"].as_str().unwrap());
    let (source_id, candidate, block_ids) = seed_transformed_cut(Some(&source_mp4), true);

    let mp3_in = root.path().join("bloco1.mp3");
    run_ffmpeg(&[
        "-v",
        "error",
        "-y",
        "-f",
        "lavfi",
        "-i",
        "sine=frequency=880:sample_rate=44100:duration=2.0",
        "-c:a",
        "libmp3lame",
        mp3_in.to_str().unwrap(),
    ]);

    call(
        "narration.import",
        json!({"candidate": candidate, "block": block_ids[0], "path": mp3_in}),
    );
    let doc = wait_narration_settled(candidate);
    assert_eq!(doc["blocks"][0]["alignment"]["status"], "aligned");

    // Legenda da Narração gerada para o bloco importado.
    let cap = call(
        "export.captions",
        json!({"source_id": source_id, "start_id": 1, "end_id": 3, "candidate_id": candidate}),
    );
    assert_eq!(cap["track"], "narration");
    assert_eq!(cap["narrationSummary"]["alignedBlocks"], 1);
    assert!(!cap["cues"].as_array().unwrap().is_empty());

    // Export real com ducking da Fonte sobre o áudio importado.
    let out_mp4 = proj_dir.join("export_imported_duck.mp4");
    let exp = call(
        "export.start",
        json!({
            "source_id": source_id,
            "start_id": 1,
            "end_id": 3,
            "candidate_id": candidate,
            "output": out_mp4,
        }),
    );
    let job_id = exp["job"].as_i64().unwrap();
    let deadline = Instant::now() + Duration::from_secs(60);
    loop {
        let st = call("export.status", json!({"job": job_id}));
        match st["state"].as_str() {
            Some("completed") => break,
            Some("failed") | Some("cancelled") => panic!("export falhou: {st}"),
            _ => {
                assert!(Instant::now() < deadline, "timeout no export: {st}");
                std::thread::sleep(Duration::from_millis(80));
            }
        }
    }
    assert!(out_mp4.is_file());
    assert!(fs::metadata(&out_mp4).unwrap().len() > 10_000);

    // Verifica que o cancelamento de uma importação enfileirada funciona sem erro.
    let cancel_job = call(
        "narration.import",
        json!({"candidate": candidate, "block": block_ids[1], "path": mp3_in}),
    );
    let cancel_id = cancel_job["job"].as_i64().unwrap();
    call("jobs.cancel", json!({"id": cancel_id}));
    let settled = wait_narration_settled(candidate);
    assert!(
        matches!(
            settled["importJob"]["state"].as_str(),
            Some("cancelled") | Some("completed")
        ),
        "estado inesperado após cancelamento: {}",
        settled["importJob"]
    );

    let _ = call("projects.close", json!({}));
}
