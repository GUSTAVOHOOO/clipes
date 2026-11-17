//! Testes headless da gravação da Narração com aparo por Silero VAD (#83):
//! - trava do Roteiro aprovado (#73);
//! - gravação sem worker: salva WAV 24 kHz mono sem aparo + aviso `vad_unavailable` e
//!   libera `narration.trim_block` quando o worker passa a existir;
//! - gravação com worker: converte 48 kHz estéreo -> 24 kHz mono, envia 16 kHz mono ao
//!   Silero VAD, apara início/fim pelos spans, expõe duração real (#204), serve via
//!   `media::serve` e dispara o alinhamento automático (#81);
//! - `no_speech_detected`: recusa sem sobrescrever o bloco anterior, preserva rascunho
//!   temporário e limpa em `narration.discard_draft`;
//! - Narração gravada (`engine_id='recorded'`) não dispara "Narração por TTS" nos guarda-corpos (#76).

use clipes_core::{
    dispatch, media::serve, montage, projects::with_writer, tts::block_durations_for_candidate,
    CoreError,
};
use serde_json::{json, Value};
use sha2::{Digest, Sha256};
use std::{
    fs,
    path::Path,
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

fn encode_base64(data: &[u8]) -> String {
    const TABLE: &[u8; 64] = b"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
    let mut out = String::with_capacity((data.len() + 2) / 3 * 4);
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

fn make_pcm_wav(sample_rate: u32, channels: u16, duration_ms: u32) -> Vec<u8> {
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
    for i in 0..frames {
        let val = ((i % 200) as i16).wrapping_mul(50);
        for _ in 0..channels {
            buf.extend_from_slice(&val.to_le_bytes());
        }
    }
    buf
}

fn install_fake_worker(data_dir: &Path, with_whisper: bool) {
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

fn seed_transformed_cut(media_path: &Path, approved_script: bool) -> (i64, i64, Vec<i64>) {
    fs::write(media_path, b"original").unwrap();
    let mut hash = Sha256::new();
    for _ in 0..3 {
        hash.update(b"original");
    }
    let partial = format!("{:x}", hash.finalize());

    with_writer(|c| {
        c.execute(
            "INSERT INTO sources(path,size,duration_us,partial_hash,metadata,permission,audio_track) VALUES (?1,8,120000000,?2,'{}','{\"status\":\"granted\",\"who\":\"Criador\",\"where\":\"Live\"}',0)",
            (media_path.to_string_lossy().as_ref(), &partial),
        )?;
        let source = c.last_insert_rowid();
        c.execute(
            "INSERT INTO transcripts(source_id,audio_track,engine,model,revision,compute_type,state,resume_us,duration_us) VALUES (?1,0,'local','m','r','c','complete',120000000,120000000)",
            [source],
        )?;
        let transcript = c.last_insert_rowid();
        for id in 1..=3_i64 {
            let s0 = (id - 1) * 10_000_000;
            let s1 = id * 10_000_000;
            c.execute(
                "INSERT INTO sentences(transcript_id,id,first_position,last_position,start_us,end_us,text) VALUES (?1,?2,?3,?4,?5,?6,'Frase.')",
                (transcript, id, id * 2 - 1, id * 2, s0, s1),
            )?;
        }
        c.execute(
            "INSERT INTO selection_runs(transcript_id,task_version,prompt_sha256,profile,state,min_us,max_us,weights,plan_state,windows_total,video_kind) VALUES (?1,1,'h','legacy','completed',20000000,180000000,'[]','full',1,'transformed')",
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

        let texts = [
            "Primeiro bloco para leitura no teleprompter.",
            "Segundo bloco explicando o contexto completo.",
        ];
        let mut block_ids = Vec::new();
        for (idx, text) in texts.iter().enumerate() {
            let pos = idx as i64 + 1;
            c.execute(
                "INSERT INTO script_blocks(generation_id,position,title,intent,refs) VALUES (?1,?2,?3,'Intencao','[1]')",
                (gen_id, pos, format!("Bloco {pos}")),
            )?;
            let block_id = c.last_insert_rowid();
            c.execute(
                "INSERT INTO script_block_versions(block_id,kind,title,narration,refs,angle_revision) VALUES (?1,'generated',?2,?3,'[1]',0)",
                (block_id, format!("Bloco {pos}"), *text),
            )?;
            let ver_id = c.last_insert_rowid();
            if approved_script || pos == 1 {
                c.execute(
                    "INSERT INTO script_approvals(block_id,version_id,angle_revision) VALUES (?1,?2,0)",
                    (block_id, ver_id),
                )?;
            }
            block_ids.push(block_id);
        }
        Ok((source, candidate, block_ids))
    })
    .unwrap()
}

fn wait_align_settled(candidate: i64) -> Value {
    let deadline = Instant::now() + Duration::from_secs(30);
    loop {
        let doc = call("narration.get", json!({"candidate": candidate}));
        if doc["alignBusy"] == false && doc["alignJob"].is_object() {
            return doc;
        }
        assert!(Instant::now() < deadline, "alignment did not settle: {doc}");
        std::thread::sleep(Duration::from_millis(30));
    }
}

#[test]
fn headless_recording_gate_untrimmed_fallback_vad_trim_draft_align_and_guardrails() {
    let _guard = SERIAL.lock().unwrap_or_else(|e| e.into_inner());
    let root = tempfile::tempdir().unwrap();
    let data_dir = root.path().join("data");
    std::env::set_var("CLIPES_DATA_DIR", &data_dir);
    std::env::set_var("CLIPES_FAKE_WORKER_MODE", "transcribe");
    std::env::remove_var("CLIPES_FAKE_VAD_EMPTY");
    std::env::remove_var("CLIPES_FAKE_VAD_TRIM_US");
    std::env::remove_var("CLIPES_FAKE_VAD_LOG");
    std::env::remove_var("CLIPES_FAKE_ALIGN_SPOKEN");
    std::env::remove_var("CLIPES_FAKE_ALIGN_FAIL");

    call(
        "projects.create",
        json!({"parent": root.path(), "name": "TesteGravacao"}),
    );

    // 1. Trava do Roteiro aprovado (#73): não grava enquanto houver bloco pendente.
    let media = root.path().join("fonte.mp4");
    let (source_id, candidate, blocks) = seed_transformed_cut(&media, false);
    let wav_b64 = encode_base64(&make_pcm_wav(48_000, 2, 4_000));
    assert_eq!(
        fail(
            "narration.record_block",
            json!({"candidate": candidate, "block": blocks[0], "audioBase64": wav_b64})
        )
        .code,
        "script_not_approved"
    );

    // Aprova o segundo bloco pela UI/comando do Roteiro.
    call(
        "script.approve",
        json!({"candidate": candidate, "block": blocks[1]}),
    );

    // 2. Sem worker instalado: grava WAV 24 kHz mono SEM aparo, com aviso e marca `trimmed=false`.
    let untrimmed_res = call(
        "narration.record_block",
        json!({
            "candidate": candidate,
            "block": blocks[0],
            "audioBase64": wav_b64,
            "mimeType": "audio/wav"
        }),
    );
    assert_eq!(untrimmed_res["trimmed"], false);
    assert_eq!(untrimmed_res["warningCode"], "vad_unavailable");
    assert_eq!(untrimmed_res["engineId"], "recorded");
    assert_eq!(untrimmed_res["voiceId"], "recorded");
    assert_eq!(untrimmed_res["sampleRate"], 24_000);
    assert_eq!(untrimmed_res["channels"], 1);
    assert_eq!(untrimmed_res["durationUs"], 4_000_000);

    let doc_untrimmed = call("narration.get", json!({"candidate": candidate}));
    assert_eq!(doc_untrimmed["vadReady"], false);
    assert_eq!(doc_untrimmed["blocks"][0]["audio"]["trimmed"], false);
    assert_eq!(doc_untrimmed["blocks"][0]["audio"]["engineId"], "recorded");

    // `narration.trim_block` sem worker recusa com `worker_missing`.
    assert_eq!(
        fail(
            "narration.trim_block",
            json!({"candidate": candidate, "block": blocks[0]})
        )
        .code,
        "worker_missing"
    );

    // Narração humana NÃO dispara o item "Narração por TTS" no checklist de guarda-corpos (#76).
    let guard = call(
        "guardrails.check",
        json!({"scope": "single", "source_id": source_id, "candidate_id": candidate}),
    );
    assert_eq!(guard["narration"]["applicable"], true);
    assert_eq!(guard["narration"]["hasTts"], false);
    assert_eq!(guard["narration"]["generatedBlocks"], 0);

    // 3. Instala o worker (ainda sem Whisper) e executa "Aparar agora" no bloco 0.
    install_fake_worker(&data_dir, false);
    let vad_log = root.path().join("vad.log");
    std::env::set_var("CLIPES_FAKE_VAD_LOG", &vad_log);
    std::env::set_var("CLIPES_FAKE_VAD_TRIM_US", "500000,2500000");

    let doc_vad_ready = call("narration.get", json!({"candidate": candidate}));
    assert_eq!(doc_vad_ready["vadReady"], true);

    let trimmed_res = call(
        "narration.trim_block",
        json!({"candidate": candidate, "block": blocks[0]}),
    );
    assert_eq!(trimmed_res["trimmed"], true);
    assert_eq!(trimmed_res["sampleRate"], 24_000);
    assert_eq!(trimmed_res["channels"], 1);
    assert_eq!(trimmed_res["durationUs"], 2_000_000);
    let log_text = fs::read_to_string(&vad_log).unwrap();
    assert!(
        log_text.contains("16000 1 "),
        "VAD deve receber 16 kHz mono: {log_text}"
    );

    // 4. Instala Whisper, grava o bloco 2 (4 s -> aparado para [700ms, 3100ms] = 2.4 s) e valida alinhamento automático!
    install_fake_worker(&data_dir, true);
    std::env::set_var("CLIPES_FAKE_VAD_TRIM_US", "700000,3100000");
    let rec2 = call(
        "narration.record_block",
        json!({
            "candidate": candidate,
            "block": blocks[1],
            "audioBase64": wav_b64,
            "mimeType": "audio/wav"
        }),
    );
    assert_eq!(rec2["trimmed"], true);
    assert_eq!(rec2["durationUs"], 2_400_000);

    let doc_aligned = wait_align_settled(candidate);
    assert_eq!(doc_aligned["blocks"][1]["alignment"]["status"], "aligned");
    assert_eq!(doc_aligned["blocks"][1]["audio"]["trimmed"], true);

    // Durações reais alimentam a montagem (#204) e `media::serve` entrega o WAV gravado.
    let durations = block_durations_for_candidate(candidate).unwrap();
    assert_eq!(durations.get(&blocks[0]), Some(&2_000_000));
    assert_eq!(durations.get(&blocks[1]), Some(&2_400_000));
    let dur_pairs: Vec<(i64, i64)> = durations.iter().map(|(&k, &v)| (k, v)).collect();
    let montage_plan = montage::plan_for_clip(None, candidate, &dur_pairs)
        .unwrap()
        .unwrap();
    assert_eq!(montage_plan.blocks[0].duration_us, 2_000_000);
    assert_eq!(montage_plan.blocks[1].duration_us, 2_400_000);

    let audio_id = doc_aligned["blocks"][1]["audio"]["id"].as_i64().unwrap();
    let resp = serve(&format!("/narration/{audio_id}"), None);
    assert_eq!(resp.status, 200);
    assert!(resp
        .headers
        .iter()
        .any(|(k, v)| *k == "Content-Type" && v == "audio/wav"));

    // 5. `no_speech_detected`: NÃO sobrescreve o bloco anterior e guarda rascunho temporário até `discard_draft`.
    std::env::set_var("CLIPES_FAKE_VAD_EMPTY", "1");
    let no_speech = fail(
        "narration.record_block",
        json!({
            "candidate": candidate,
            "block": blocks[1],
            "audioBase64": wav_b64,
        }),
    );
    assert_eq!(no_speech.code, "no_speech_detected");
    assert_eq!(no_speech.usage.unwrap()["hasDraft"], true);

    let draft_file = data_dir
        .join("cache/narration-record")
        .join(format!("draft-c{candidate}-b{}.wav", blocks[1]));
    assert!(draft_file.is_file(), "rascunho temporário deve existir");

    // Bloco 1 mantém sua duração de 2.4 s e alinhamento intacto!
    let doc_after_empty = call("narration.get", json!({"candidate": candidate}));
    assert_eq!(
        doc_after_empty["blocks"][1]["audio"]["durationUs"],
        2_400_000
    );
    assert_eq!(
        doc_after_empty["blocks"][1]["alignment"]["status"],
        "aligned"
    );

    let discarded = call(
        "narration.discard_draft",
        json!({"candidate": candidate, "block": blocks[1]}),
    );
    assert_eq!(discarded["discarded"], true);
    assert!(!draft_file.exists());

    // 6. Editar o Roteiro invalida a gravação anterior (`stale = true`).
    std::env::remove_var("CLIPES_FAKE_VAD_EMPTY");
    call(
        "script.edit",
        json!({"candidate": candidate, "block": blocks[0], "narration": "Texto editado do bloco 1."}),
    );
    let doc_stale = call("narration.get", json!({"candidate": candidate}));
    assert_eq!(doc_stale["blocks"][0]["audio"]["stale"], true);
    assert!(block_durations_for_candidate(candidate)
        .unwrap()
        .get(&blocks[0])
        .is_none());

    std::env::remove_var("CLIPES_FAKE_VAD_TRIM_US");
    std::env::remove_var("CLIPES_FAKE_VAD_LOG");
    std::env::remove_var("CLIPES_FAKE_WORKER_MODE");
}
