//! Regressão #293: `narration.record_block` não emite `ProgressEvent` residual com `job == "0"`,
//! mantendo apenas o evento via `EventSink` (`job == "narration_record"`, `stage == "done"`, `percentage == 100`).

use clipes_core::{dispatch, projects::with_writer, set_event_emitter, ProgressEvent};
use serde_json::{json, Value};
use sha2::{Digest, Sha256};
use std::{
    fs,
    path::Path,
    sync::{Arc, Mutex},
};

fn call(name: &str, args: Value) -> Value {
    dispatch(name, args, &mut |_| {}).unwrap()
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

fn seed_approved_block(media_path: &Path) -> (i64, i64) {
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
        c.execute(
            "INSERT INTO script_blocks(generation_id,position,title,intent,refs) VALUES (?1,1,'Bloco 1','Intencao','[1]')",
            [gen_id],
        )?;
        let block_id = c.last_insert_rowid();
        c.execute(
            "INSERT INTO script_block_versions(block_id,kind,title,narration,refs,angle_revision) VALUES (?1,'generated','Bloco 1','Texto para gravar.','[1]',0)",
            [block_id],
        )?;
        let ver_id = c.last_insert_rowid();
        c.execute(
            "INSERT INTO script_approvals(block_id,version_id,angle_revision) VALUES (?1,?2,0)",
            (block_id, ver_id),
        )?;
        Ok((candidate, block_id))
    })
    .unwrap()
}

#[test]
fn narration_record_block_emits_only_narration_record_done_without_job_zero() {
    let root = tempfile::tempdir().unwrap();
    let data_dir = root.path().join("data");
    std::env::set_var("CLIPES_DATA_DIR", &data_dir);

    let background_events: Arc<Mutex<Vec<ProgressEvent>>> = Arc::new(Mutex::new(Vec::new()));
    let captured_bg = background_events.clone();
    assert!(
        set_event_emitter(Arc::new(move |ev| {
            captured_bg.lock().unwrap().push(ev);
        }))
        .is_ok(),
        "event emitter must be installed once per test binary"
    );

    call(
        "projects.create",
        json!({"parent": root.path(), "name": "TesteEventosGravacao"}),
    );

    let media = root.path().join("fonte.mp4");
    let (candidate, block_id) = seed_approved_block(&media);
    let wav_b64 = encode_base64(&make_pcm_wav(24_000, 1, 1_000));

    let mut sink_events: Vec<ProgressEvent> = Vec::new();
    let res = dispatch(
        "narration.record_block",
        json!({
            "candidate": candidate,
            "block": block_id,
            "audioBase64": wav_b64,
            "mimeType": "audio/wav"
        }),
        &mut |ev| sink_events.push(ev),
    )
    .unwrap();
    assert_eq!(res["blockId"], block_id);

    let bg_events = background_events.lock().unwrap();
    assert!(
        !sink_events.iter().any(|ev| ev.job == "0") && !bg_events.iter().any(|ev| ev.job == "0"),
        "narration.record_block não deve emitir ProgressEvent com job == \"0\"; sink={:?}, bg={:?}",
        sink_events,
        *bg_events
    );
    assert!(
        sink_events
            .iter()
            .any(|ev| ev.job == "narration_record" && ev.stage == "done" && ev.percentage == 100),
        "narration.record_block deve emitir job == \"narration_record\" com stage == \"done\" e percentage == 100; sink={:?}",
        sink_events
    );
}
