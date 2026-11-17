//! Testes headless do alinhamento por palavra e legendas da Narração (#81):
//! - disparo automático pós-TTS quando worker + Whisper estão instalados;
//! - conclusão normal do TTS em 'pending' quando worker/Whisper estão ausentes;
//! - comandos explícitos `narration.align` / `narration.align_block` (cobrindo TTS e #83/#84);
//! - regra de desvio (>=2 inserções seguidas ou >=3 substituições): bloqueia legenda até revisão
//!   (`narration.review` com escolha 'script' ou 'spoken' persistida por versão);
//! - respeito às bordas de Frase nas legendas da Narração;
//! - deslocamento pelos inícios resolvidos da montagem (#204), faixa 'narration' com Fonte original
//!   fora dos intervalos da Narração, exclusão de bloco desatualizado e alternância via `captions.track.set`;
//! - paridade com `export.start` (congelamento e execução local via `fake-export`).

use clipes_core::{dispatch, projects::with_writer, CoreError};
use serde_json::{json, Value};
use sha2::{Digest, Sha256};
use std::{
    fs,
    path::{Path, PathBuf},
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

fn build_fake_pocket_tts(dir: &Path) -> PathBuf {
    let fake = dir.join(exe("pocket-tts"));
    let rustc = std::env::var_os("RUSTC")
        .map(PathBuf::from)
        .unwrap_or_else(|| {
            PathBuf::from(
                std::env::var_os(if cfg!(windows) { "USERPROFILE" } else { "HOME" }).unwrap(),
            )
            .join(".cargo/bin")
            .join(exe("rustc"))
        });
    assert!(std::process::Command::new(rustc)
        .arg(Path::new(env!("CARGO_MANIFEST_DIR")).join("tests/fixtures/fake_pocket_tts.rs"))
        .arg("-o")
        .arg(&fake)
        .status()
        .unwrap()
        .success());
    fake
}

fn install_fake_tts_model(
    data_dir: &Path,
    model_id: &str,
    voice_files: &[&str],
    terms_version: &str,
) {
    let dir = data_dir
        .join("tts-models")
        .join("pocket-tts")
        .join(model_id);
    fs::create_dir_all(dir.join("voices")).unwrap();
    fs::write(dir.join("model.safetensors"), b"fake-weights").unwrap();
    fs::write(dir.join("tokenizer.json"), b"{}").unwrap();
    fs::write(
        dir.join("config.yaml"),
        "weights_path: 'model.safetensors'\n",
    )
    .unwrap();
    for vf in voice_files {
        fs::write(dir.join("voices").join(vf), b"fake-voice-safetensors").unwrap();
    }
    fs::write(
        dir.join("model.state.json"),
        serde_json::to_vec_pretty(&json!({
            "engine": "pocket-tts",
            "id": model_id,
            "repo": "kyutai/pocket-tts-without-voice-cloning",
            "revision": "a7056f505a4a8ca72d8b5fb1440071d6f1a35739",
            "terms_version": terms_version,
        }))
        .unwrap(),
    )
    .unwrap();
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

fn write_pcm_wav(path: &Path, sample_rate: u32, channels: u16, duration_ms: u32) -> String {
    let frames = (sample_rate * duration_ms) / 1000;
    let data_bytes = frames * u32::from(channels) * 2;
    let byte_rate = sample_rate * u32::from(channels) * 2;
    let block_align = channels * 2;
    let mut buf = Vec::with_capacity(44 + data_bytes as usize);
    buf.extend_from_slice(b"RIFF");
    buf.extend_from_slice(&(36 + data_bytes).to_le_bytes());
    buf.extend_from_slice(b"WAVEfmt ");
    buf.extend_from_slice(&16u32.to_le_bytes());
    buf.extend_from_slice(&1u16.to_le_bytes());
    buf.extend_from_slice(&channels.to_le_bytes());
    buf.extend_from_slice(&sample_rate.to_le_bytes());
    buf.extend_from_slice(&byte_rate.to_le_bytes());
    buf.extend_from_slice(&block_align.to_le_bytes());
    buf.extend_from_slice(&16u16.to_le_bytes());
    buf.extend_from_slice(b"data");
    buf.extend_from_slice(&data_bytes.to_le_bytes());
    buf.resize(buf.len() + data_bytes as usize, 0);
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent).unwrap();
    }
    fs::write(path, &buf).unwrap();
    format!("{:x}", Sha256::digest(&buf))
}

fn seed_transformed_cut_with_words(media_path: &Path) -> (i64, i64, Vec<i64>) {
    fs::write(media_path, b"original").unwrap();
    let mut hash = Sha256::new();
    for _ in 0..3 {
        hash.update(b"original");
    }
    let partial = format!("{:x}", hash.finalize());

    with_writer(|c| {
        c.execute(
            "INSERT INTO sources(path,size,duration_us,partial_hash,metadata,permission,audio_track) VALUES (?1,8,40000000,?2,'{\"streams\":[{\"index\":0,\"codec_type\":\"audio\",\"channels\":1},{\"codec_type\":\"video\",\"avg_frame_rate\":\"30/1\"}]}','{\"status\":\"granted\",\"who\":\"Criador\",\"where\":\"Live\"}',0)",
            (media_path.to_str().unwrap(), partial),
        )?;
        let source = c.last_insert_rowid();
        c.execute(
            "INSERT INTO transcripts(source_id,audio_track,engine,model,revision,compute_type,state,resume_us,duration_us) VALUES (?1,0,'local','m','r','c','complete',40000000,40000000)",
            [source],
        )?;
        let transcript = c.last_insert_rowid();
        // 3 Frases de 10 s cada (0..30s), cada uma com 2 palavras no início e fim da Frase.
        let sentences = [
            (1_i64, "Fonte", "um.", 0_i64, 10_000_000_i64),
            (2_i64, "Fonte", "dois.", 10_000_000_i64, 20_000_000_i64),
            (3_i64, "Fonte", "tres.", 20_000_000_i64, 30_000_000_i64),
        ];
        for (sid, w1, w2, s0, s1) in sentences {
            let p1 = sid * 2 - 1;
            let p2 = sid * 2;
            c.execute(
                "INSERT INTO transcript_words(transcript_id,position,kind,text,start_us,end_us,language) VALUES (?1,?2,'word',?3,?4,?5,'pt')",
                (transcript, p1, w1, s0 + 100_000, s0 + 350_000),
            )?;
            c.execute(
                "INSERT INTO transcript_words(transcript_id,position,kind,text,start_us,end_us,language) VALUES (?1,?2,'word',?3,?4,?5,'pt')",
                (transcript, p2, w2, s0 + 400_000, s0 + 700_000),
            )?;
            c.execute(
                "INSERT INTO sentences(transcript_id,id,first_position,last_position,start_us,end_us,language,text) VALUES (?1,?2,?3,?4,?5,?6,'pt',?7)",
                (transcript, sid, p1, p2, s0, s1, format!("{w1} {w2}")),
            )?;
        }
        c.execute(
            "INSERT INTO selection_runs(transcript_id,task_version,prompt_sha256,profile,state,min_us,max_us,weights,plan_state,windows_total,video_kind) VALUES (?1,1,'h','legacy','completed',10000000,180000000,'[]','full',1,'transformed')",
            [transcript],
        )?;
        let run = c.last_insert_rowid();
        c.execute(
            "INSERT INTO selection_candidates(run_id,rank,start_id,end_id,start_us,end_us,axes,total_centi,title,windows) VALUES (?1,1,1,3,0,30000000,'{}',900,'Corte','[0]')",
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

        // Bloco 1 ancorado na Frase 1 (0s), duas frases curtas no texto do Roteiro.
        // Bloco 2 ancorado na Frase 3 (20s), deixando a Frase 2 (10s..20s) livre com fala da Fonte!
        let specs = [
            (1_i64, "[1]", "Primeira frase. Segunda frase."),
            (2_i64, "[3]", "Terceiro bloco final."),
        ];
        let mut block_ids = Vec::new();
        for (pos, refs, text) in specs {
            c.execute(
                "INSERT INTO script_blocks(generation_id,position,title,intent,refs) VALUES (?1,?2,?3,'Intencao',?4)",
                (gen_id, pos, format!("Bloco {pos}"), refs),
            )?;
            let block_id = c.last_insert_rowid();
            c.execute(
                "INSERT INTO script_block_versions(block_id,kind,title,narration,refs,angle_revision) VALUES (?1,'generated',?2,?3,?4,0)",
                (block_id, format!("Bloco {pos}"), text, refs),
            )?;
            let ver_id = c.last_insert_rowid();
            c.execute(
                "INSERT INTO script_approvals(block_id,version_id,angle_revision) VALUES (?1,?2,0)",
                (block_id, ver_id),
            )?;
            block_ids.push(block_id);
        }
        Ok((source, candidate, block_ids))
    })
    .unwrap()
}

fn wait_narration_settled(candidate: i64, align_too: bool) -> Value {
    let deadline = Instant::now() + Duration::from_secs(30);
    loop {
        let doc = call("narration.get", json!({"candidate": candidate}));
        let tts_done = doc["busy"] == false && doc["job"].is_object();
        let align_done = !align_too || (doc["alignBusy"] == false && doc["alignJob"].is_object());
        if tts_done && align_done {
            return doc;
        }
        assert!(Instant::now() < deadline, "narration/align timeout: {doc}");
        std::thread::sleep(Duration::from_millis(30));
    }
}

fn wait_align_settled(candidate: i64) -> Value {
    let deadline = Instant::now() + Duration::from_secs(30);
    loop {
        let doc = call("narration.get", json!({"candidate": candidate}));
        if doc["alignBusy"] == false && doc["alignJob"].is_object() {
            return doc;
        }
        assert!(Instant::now() < deadline, "align timeout: {doc}");
        std::thread::sleep(Duration::from_millis(30));
    }
}

#[test]
fn headless_narration_alignment_sentence_cues_montage_shift_and_export() {
    let _guard = SERIAL.lock().unwrap_or_else(|e| e.into_inner());
    let root = tempfile::tempdir().unwrap();
    let data_dir = root.path().join("data");
    std::env::set_var("CLIPES_DATA_DIR", &data_dir);
    std::env::set_var("CLIPES_FAKE_WORKER_MODE", "transcribe");
    std::env::remove_var("CLIPES_FAKE_ALIGN_SPOKEN");
    std::env::remove_var("CLIPES_FAKE_ALIGN_FAIL");
    std::env::remove_var("CLIPES_FAKE_TTS_SLEEP_MS");
    std::env::remove_var("CLIPES_FAKE_TTS_FAIL");

    let align_log = root.path().join("align.log");
    std::env::set_var("CLIPES_FAKE_ALIGN_LOG", &align_log);

    // 1. Sem worker/Whisper instalados: TTS conclui normalmente e blocos ficam com alinhamento pendente.
    let comp_dir = data_dir.join("components");
    fs::create_dir_all(&comp_dir).unwrap();
    build_fake_pocket_tts(&comp_dir);
    let cat = call("tts.catalog", json!({}));
    let terms_version = cat["engines"][0]["prohibitedUse"]["version"]
        .as_str()
        .unwrap()
        .to_owned();
    install_fake_tts_model(
        &data_dir,
        "portuguese_24l",
        &["13063-pt-24l.safetensors"],
        &terms_version,
    );

    call(
        "projects.create",
        json!({"parent": root.path(), "name": "CanalAlign"}),
    );
    let media = root.path().join("source.mp4");
    let (source_id, candidate, block_ids) = seed_transformed_cut_with_words(&media);

    call("narration.generate", json!({"candidate": candidate}));
    let after_tts_no_worker = wait_narration_settled(candidate, false);
    assert_eq!(after_tts_no_worker["job"]["state"], "completed");
    assert_eq!(after_tts_no_worker["alignPrerequisitesReady"], false);
    assert_eq!(
        after_tts_no_worker["blocks"][0]["alignment"]["status"],
        "pending"
    );
    assert_eq!(
        after_tts_no_worker["blocks"][1]["alignment"]["status"],
        "pending"
    );

    // Sem worker, `narration.align` falha tipado com `worker_missing`.
    assert_eq!(
        fail("narration.align", json!({"candidate": candidate})).code,
        "worker_missing"
    );

    // 2. Instala worker + Whisper falsos e dispara `narration.align`:
    //    converte WAV 24 kHz do Pocket TTS para 16 kHz mono e alinha por palavra.
    install_fake_worker_and_whisper(&data_dir);
    call("narration.align", json!({"candidate": candidate}));
    let aligned_doc = wait_align_settled(candidate);
    assert_eq!(aligned_doc["alignJob"]["state"], "completed");
    assert_eq!(aligned_doc["alignPrerequisitesReady"], true);
    assert_eq!(aligned_doc["blocks"][0]["alignment"]["status"], "aligned");
    assert_eq!(
        aligned_doc["blocks"][0]["alignment"]["activeTrack"],
        "script"
    );
    assert_eq!(aligned_doc["blocks"][0]["alignment"]["wordCount"], 4);
    assert_eq!(aligned_doc["blocks"][1]["alignment"]["status"], "aligned");

    let log_text = fs::read_to_string(&align_log).unwrap();
    assert!(log_text.contains("pt 1 16000 Primeira frase. Segunda frase."));
    assert!(log_text.contains("pt 1 16000 Terceiro bloco final."));

    // 3. `export.captions` usa track 'narration' por padrão, respeita bordas de Frase e mantém
    //    a legenda original da Fonte apenas fora dos intervalos da Narração (Frase 2 em 10s..20s).
    let captions = call(
        "export.captions",
        json!({"source_id": source_id, "start_id": 1, "end_id": 3, "candidate_id": candidate}),
    );
    assert_eq!(captions["track"], "narration");
    assert_eq!(
        captions["availableTracks"],
        json!(["narration", "original"])
    );
    let cues = captions["cues"].as_array().unwrap();
    let cue_texts: Vec<String> = cues
        .iter()
        .map(|c| {
            c["lines"][0]
                .as_array()
                .unwrap()
                .iter()
                .map(|w| w["text"].as_str().unwrap())
                .collect::<Vec<_>>()
                .join(" ")
        })
        .collect();
    // Bloco 1 ("Primeira frase." e "Segunda frase.") nunca cruza borda de Frase numa mesma cue!
    assert!(cue_texts.iter().any(|t| t == "Primeira frase."));
    assert!(cue_texts.iter().any(|t| t == "Segunda frase."));
    assert!(!cue_texts.iter().any(|t| t.contains("frase. Segunda")));
    // Frase 2 da Fonte ("Fonte dois.") fica fora dos blocos (10s..20s) e aparece!
    assert!(cue_texts.iter().any(|t| t == "Fonte dois."));
    // Frase 1 e Frase 3 da Fonte estão sob os blocos 1 e 2 e NÃO aparecem na faixa 'narration'!
    assert!(!cue_texts.iter().any(|t| t.contains("um.")));
    assert!(!cue_texts.iter().any(|t| t.contains("tres.")));

    // 4. Arrastar um bloco na montagem (#204) desloca as legendas da Narração sem realinhar.
    let opened = call(
        "editor.open",
        json!({"source_id": source_id, "start_id": 1, "end_id": 3, "candidate_id": candidate}),
    );
    let clip_id = opened["clipId"].as_i64().unwrap();
    call(
        "editor.montage.set_start",
        json!({"clip_id": clip_id, "block_id": block_ids[1], "time_us": 25_000_000, "free": true}),
    );
    let shifted = call(
        "export.captions",
        json!({"source_id": source_id, "start_id": 1, "end_id": 3, "candidate_id": candidate, "clip_id": clip_id}),
    );
    let shifted_word = shifted["words"]
        .as_array()
        .unwrap()
        .iter()
        .find(|w| w["text"].as_str().is_some_and(|t| t.contains("Terceiro")))
        .unwrap();
    // Bloco 2 movido para 25s -> primeira palavra do bloco começa em 25s + 100ms = 25_100_000.
    assert_eq!(shifted_word["startUs"], 25_100_000);

    // 5. Alternar faixa para 'original' mostra a Transcrição original completa da Fonte.
    call(
        "captions.track.set",
        json!({"candidate_id": candidate, "clip_id": clip_id, "track": "original"}),
    );
    let orig = call(
        "export.captions",
        json!({"source_id": source_id, "start_id": 1, "end_id": 3, "candidate_id": candidate, "clip_id": clip_id}),
    );
    assert_eq!(orig["track"], "original");
    assert!(orig["ass"].as_str().unwrap().contains("um."));

    call(
        "captions.track.set",
        json!({"candidate_id": candidate, "clip_id": clip_id, "track": "narration"}),
    );

    // 6. Export com fake-export congela e conclui usando a faixa 'narration'.
    call(
        "components.settings.set",
        json!({
            "data_dir": data_dir,
            "cache_dir": root.path().join("cache"),
            "cache_limit_bytes": 1_000_000,
            "ffmpeg_path": env!("CARGO_BIN_EXE_fake-export"),
        }),
    );
    let out_mp4 = root.path().join("export-narracao.mp4");
    let exp = call(
        "export.start",
        json!({"source_id": source_id, "start_id": 1, "end_id": 3, "candidate_id": candidate, "clip_id": clip_id, "output": out_mp4}),
    );
    let job_id = exp["job"].as_i64().unwrap();
    let deadline = Instant::now() + Duration::from_secs(15);
    loop {
        let st = call("export.status", json!({"job": job_id}));
        if st["state"] == "completed" {
            break;
        }
        assert!(st["state"] != "failed", "export failed: {st}");
        assert!(Instant::now() < deadline, "export timeout: {st}");
        std::thread::sleep(Duration::from_millis(20));
    }
    assert!(out_mp4.is_file());

    // 7. Editar um bloco do Roteiro invalida a Narração daquele bloco (`stale`), que deixa de
    //    gerar legenda naquele intervalo enquanto o outro bloco continua normal.
    call(
        "script.edit",
        json!({"candidate": candidate, "block": block_ids[0], "narration": "Texto alterado do bloco um."}),
    );
    let after_edit = call("narration.get", json!({"candidate": candidate}));
    assert_eq!(after_edit["blocks"][0]["audio"]["stale"], true);
    assert_eq!(after_edit["blocks"][1]["audio"]["stale"], false);

    let after_edit_cap = call(
        "export.captions",
        json!({"source_id": source_id, "start_id": 1, "end_id": 3, "candidate_id": candidate, "clip_id": clip_id}),
    );
    let ass_after_edit = after_edit_cap["ass"].as_str().unwrap();
    assert!(!ass_after_edit.contains("Primeira"));
    assert!(ass_after_edit.contains("Terceiro"));
    // Intervalo do bloco 1 (desatualizado) fica sem legenda da Fonte também.
    assert!(!ass_after_edit.contains("um."));

    std::env::remove_var("CLIPES_FAKE_ALIGN_LOG");
}

#[test]
fn headless_deviation_rule_blocks_captions_until_user_reviews_and_supports_custom_wav() {
    let _guard = SERIAL.lock().unwrap_or_else(|e| e.into_inner());
    let root = tempfile::tempdir().unwrap();
    let data_dir = root.path().join("data");
    std::env::set_var("CLIPES_DATA_DIR", &data_dir);
    std::env::set_var("CLIPES_FAKE_WORKER_MODE", "transcribe");
    std::env::remove_var("CLIPES_FAKE_ALIGN_FAIL");

    install_fake_worker_and_whisper(&data_dir);

    let proj = call(
        "projects.create",
        json!({"parent": root.path(), "name": "CanalReview"}),
    );
    let proj_path = PathBuf::from(proj["path"].as_str().unwrap());
    let media = root.path().join("source.mp4");
    let (source_id, candidate, block_ids) = seed_transformed_cut_with_words(&media);

    // Simula Narração gravada/importada (#83/#84): WAV 48 kHz estéreo gravado direto em `narrations/`
    // e registrado em `narration_blocks`.
    let wav1_rel = format!("narrations/c{candidate}/b{}-rec.wav", block_ids[0]);
    let wav2_rel = format!("narrations/c{candidate}/b{}-rec.wav", block_ids[1]);
    let sha1 = write_pcm_wav(&proj_path.join(&wav1_rel), 48_000, 2, 2_000);
    let sha2 = write_pcm_wav(&proj_path.join(&wav2_rel), 16_000, 1, 2_000);

    with_writer(|c| {
        for (bid, rel, sr, ch, sha) in [
            (block_ids[0], &wav1_rel, 48_000_i64, 2_i64, &sha1),
            (block_ids[1], &wav2_rel, 16_000_i64, 1_i64, &sha2),
        ] {
            let ver_id: i64 = c.query_row(
                "SELECT MAX(id) FROM script_block_versions WHERE block_id=?1",
                [bid],
                |r| r.get(0),
            )?;
            c.execute(
                "INSERT INTO narration_blocks(block_id, version_id, voice_id, model_id, engine_id, audio_rel_path, duration_us, sample_rate, channels, bytes, sha256)
                 VALUES (?1, ?2, 'recorded', 'mic', 'recorded', ?3, 2000000, ?4, ?5, 1000, ?6)",
                (bid, ver_id, rel, sr, ch, sha),
            )?;
        }
        Ok(())
    })
    .unwrap();

    // Bloco 1: 2 inserções seguidas ("agora mesmo" improvisado) -> marca `needs_review`!
    std::env::set_var(
        "CLIPES_FAKE_ALIGN_SPOKEN",
        "Primeira frase agora mesmo. Segunda frase.",
    );
    call(
        "narration.align_block",
        json!({"candidate": candidate, "block": block_ids[0]}),
    );
    let doc1 = wait_align_settled(candidate);
    assert_eq!(doc1["blocks"][0]["alignment"]["status"], "needs_review");
    assert_eq!(
        doc1["blocks"][0]["alignment"]["maxConsecutiveInsertions"],
        2
    );
    assert!(doc1["blocks"][0]["alignment"]["spokenText"]
        .as_str()
        .unwrap()
        .contains("agora mesmo"));

    // Bloco 2: sem desvio -> `aligned`.
    std::env::remove_var("CLIPES_FAKE_ALIGN_SPOKEN");
    call(
        "narration.align_block",
        json!({"candidate": candidate, "block": block_ids[1]}),
    );
    let doc2 = wait_align_settled(candidate);
    assert_eq!(doc2["blocks"][1]["alignment"]["status"], "aligned");

    // Enquanto Bloco 1 estiver `needs_review`, NÃO gera legenda nem no preview nem no export!
    let cap_pending = call(
        "export.captions",
        json!({"source_id": source_id, "start_id": 1, "end_id": 3, "candidate_id": candidate}),
    );
    assert_eq!(cap_pending["track"], "narration");
    assert_eq!(cap_pending["narrationSummary"]["needsReviewBlocks"], 1);
    let ass_pending = cap_pending["ass"].as_str().unwrap();
    assert!(!ass_pending.contains("Primeira"));
    assert!(!ass_pending.contains("agora"));
    assert!(!ass_pending.contains("um."));
    assert!(ass_pending.contains("Terceiro"));

    // Usuário escolhe "Usar texto falado" -> legenda sai com o texto falado e persiste ao reabrir!
    let rev_spoken = call(
        "narration.review",
        json!({"candidate": candidate, "block": block_ids[0], "choice": "spoken"}),
    );
    assert_eq!(rev_spoken["alignment"]["status"], "approved");
    assert_eq!(rev_spoken["alignment"]["choice"], "spoken");

    let cap_spoken = call(
        "export.captions",
        json!({"source_id": source_id, "start_id": 1, "end_id": 3, "candidate_id": candidate}),
    );
    assert!(cap_spoken["ass"].as_str().unwrap().contains("agora"));

    // Fecha e reabre o Projeto: escolha continua gravada; pode trocar para "Usar texto do Roteiro".
    call("projects.close", json!({}));
    call("projects.open", json!({"path": proj["path"]}));
    let reopened = call("narration.get", json!({"candidate": candidate}));
    assert_eq!(reopened["blocks"][0]["alignment"]["status"], "approved");
    assert_eq!(reopened["blocks"][0]["alignment"]["choice"], "spoken");

    call(
        "narration.review",
        json!({"candidate": candidate, "block": block_ids[0], "choice": "script"}),
    );
    let cap_script = call(
        "export.captions",
        json!({"source_id": source_id, "start_id": 1, "end_id": 3, "candidate_id": candidate}),
    );
    let ass_script = cap_script["ass"].as_str().unwrap();
    assert!(ass_script.contains("Primeira"));
    assert!(!ass_script.contains("agora"));

    // Também testa >= 3 substituições no Bloco 2 -> `needs_review`.
    std::env::set_var("CLIPES_FAKE_ALIGN_SPOKEN", "Outro texto diferente.");
    call(
        "narration.align_block",
        json!({"candidate": candidate, "block": block_ids[1]}),
    );
    let doc3 = wait_align_settled(candidate);
    std::env::remove_var("CLIPES_FAKE_ALIGN_SPOKEN");
    assert_eq!(doc3["blocks"][1]["alignment"]["status"], "needs_review");
    assert!(
        doc3["blocks"][1]["alignment"]["substitutions"]
            .as_i64()
            .unwrap()
            >= 3
    );
}
