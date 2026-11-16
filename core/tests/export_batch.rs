//! Testes headless do export em lote (#64) com FFmpeg real (lavfi), falha isolada,
//! sobrescrita com confirmação, bordas editadas (#70) e cancelamento no meio (#117).
use clipes_core::{dispatch, projects::with_writer, set_event_emitter, ProgressEvent};
use serde_json::{json, Value};
use sha2::{Digest, Sha256};
use std::{
    fs,
    path::{Path, PathBuf},
    sync::{Arc, Mutex},
    time::{Duration, Instant},
};

fn call(name: &str, args: Value) -> Value {
    dispatch(name, args, &mut |_| {}).unwrap()
}

fn fail(name: &str, args: Value, code: &str) -> clipes_core::CoreError {
    let err = dispatch(name, args, &mut |_| {}).unwrap_err();
    assert_eq!(err.code, code, "{err:?}");
    err
}

fn ffmpeg_program() -> String {
    std::env::var("CLIPES_TEST_FFMPEG").unwrap_or_else(|_| "ffmpeg".into())
}

fn ffprobe_program() -> String {
    std::env::var("CLIPES_TEST_FFPROBE").unwrap_or_else(|_| "ffprobe".into())
}

fn make_lavfi_mp4(path: &Path, duration_s: u32) {
    let dur = duration_s.to_string();
    let out = clipes_core::process::spawn(
        ffmpeg_program(),
        [
            "-v",
            "error",
            "-f",
            "lavfi",
            "-i",
            &format!("testsrc2=size=320x180:rate=15:duration={dur}"),
            "-f",
            "lavfi",
            "-i",
            &format!("sine=frequency=440:duration={dur}"),
            "-map",
            "0:v",
            "-map",
            "1:a",
            "-c:v",
            "libx264",
            "-threads",
            "2",
            "-pix_fmt",
            "yuv420p",
            "-c:a",
            "aac",
            "-y",
            path.to_str().unwrap(),
        ],
        None,
    )
    .expect("instale FFmpeg com libass para os testes de lote")
    .wait_with_output()
    .unwrap();
    assert!(
        out.status.success(),
        "{}",
        String::from_utf8_lossy(&out.stderr)
    );
}

fn probe(path: &Path) -> Value {
    let out = clipes_core::process::spawn(
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
    assert!(out.status.success());
    serde_json::from_slice(&out.stdout).unwrap()
}

fn partial_hash_small(bytes: &[u8]) -> String {
    let mut hash = Sha256::new();
    for _ in 0..3 {
        hash.update(bytes);
    }
    format!("{:x}", hash.finalize())
}

fn seed_source_with_runs(
    media: &Path,
    duration_us: i64,
    hash_hex: &str,
    size: i64,
    audio_track: i64,
    words: &[(i64, &str, i64, i64)],
) -> i64 {
    let metadata = json!({
        "streams": [
            {"index": 0, "codec_type": "video"},
            {"index": audio_track, "codec_type": "audio", "channels": 1}
        ],
        "format": {"duration": format!("{:.3}", duration_us as f64 / 1_000_000.0)}
    })
    .to_string();
    let source = with_writer(|c| {
        c.execute(
            "INSERT INTO sources(path,size,duration_us,partial_hash,metadata,permission,audio_track) VALUES (?1,?2,?3,?4,?5,'{}',?6)",
            (
                media.to_str().unwrap(),
                size,
                duration_us,
                hash_hex,
                metadata,
                audio_track,
            ),
        )?;
        let source = c.last_insert_rowid();
        c.execute(
            "INSERT INTO transcripts(source_id,audio_track,engine,model,revision,compute_type,state,duration_us) VALUES (?1,?2,'local','m','r','c','complete',?3)",
            (source, audio_track, duration_us),
        )?;
        let transcript = c.last_insert_rowid();
        for (pos, text, start, end) in words {
            c.execute(
                "INSERT INTO transcript_words(transcript_id,position,kind,text,start_us,end_us,language) VALUES (?1,?2,'word',?3,?4,?5,'pt')",
                (transcript, pos, text, start, end),
            )?;
        }
        Ok(source)
    })
    .unwrap();
    call("transcription.segment", json!({"source_id": source}));
    source
}

fn add_candidate(source_id: i64, start_id: i64, end_id: i64, title: &str) -> (i64, i64) {
    with_writer(|c| {
        let (transcript, start_us, end_us): (i64, i64, i64) = c.query_row(
            "SELECT t.id, a.start_us, b.end_us
             FROM transcripts t
             JOIN sources s ON s.id=t.source_id AND s.audio_track=t.audio_track
             JOIN sentences a ON a.transcript_id=t.id AND a.id=?2
             JOIN sentences b ON b.transcript_id=t.id AND b.id=?3
             WHERE s.id=?1",
            (source_id, start_id, end_id),
            |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?)),
        )?;
        c.execute(
            "INSERT INTO selection_runs(transcript_id,task_version,prompt_sha256,state,min_us,max_us,weights,plan_state,windows_total) VALUES (?1,1,'h','completed',500000,9999999,'[]','ready',0)",
            [transcript],
        )?;
        let run = c.last_insert_rowid();
        c.execute(
            "INSERT INTO selection_candidates(run_id,rank,start_id,end_id,start_us,end_us,axes,total_centi,title,windows) VALUES (?1,1,?2,?3,?4,?5,'{}',800,?6,'[]')",
            (run, start_id, end_id, start_us, end_us, title),
        )?;
        Ok((run, c.last_insert_rowid()))
    })
    .unwrap()
}

fn wait_batch(id: i64, done: impl Fn(&Value) -> bool) -> Value {
    let deadline = Instant::now() + Duration::from_secs(90);
    loop {
        let view = call("export.batch.status", json!({"id": id}));
        if done(&view) {
            return view;
        }
        assert!(Instant::now() < deadline, "timeout waiting batch: {view}");
        std::thread::sleep(Duration::from_millis(50));
    }
}

#[test]
fn real_ffmpeg_batch_exports_source_and_project_isolates_failure_overwrites_with_confirmation_and_cancels(
) {
    let root = tempfile::tempdir().unwrap();
    let data = root.path().join("data");
    fs::create_dir_all(&data).unwrap();
    std::env::set_var("CLIPES_DATA_DIR", &data);

    let events: Arc<Mutex<Vec<ProgressEvent>>> = Arc::new(Mutex::new(Vec::new()));
    let captured = events.clone();
    let _ = set_event_emitter(Arc::new(move |ev| {
        captured.lock().unwrap().push(ev);
    }));

    let project = call(
        "projects.create",
        json!({"parent": root.path(), "name": "Lote"}),
    );
    let project_path = project["path"].as_str().unwrap().to_owned();

    // Configurar FFmpeg real via component-settings.json (sem PATH implícito).
    let ffmpeg_bin = which_or_env(&ffmpeg_program());
    fs::write(
        data.join("component-settings.json"),
        json!({
            "data_dir": data,
            "cache_dir": data.join("cache"),
            "cache_limit_bytes": 10_000_000,
            "ffmpeg_path": ffmpeg_bin
        })
        .to_string(),
    )
    .unwrap();

    // Sem Cortes aprovados: recusa antes de criar qualquer lote.
    let dir_source = root.path().join("out-source");
    fs::create_dir_all(&dir_source).unwrap();
    fail(
        "export.batch.start",
        json!({"project": project_path, "output_dir": dir_source}),
        "export_batch_empty",
    );

    // 1) Fonte A (4s reais lavfi) com 2 execuções na Transcrição ativa + 1 Transcrição inativa.
    let media_a = root.path().join("live-a.mp4");
    make_lavfi_mp4(&media_a, 4);
    let insp_a = call("sources.inspect", json!({"path": media_a}));
    let audio_a = insp_a["streams"]
        .as_array()
        .unwrap()
        .iter()
        .find(|s| s["codec_type"] == "audio")
        .unwrap()["index"]
        .as_i64()
        .unwrap();
    let src_a = call(
        "sources.import",
        json!({"project": project_path, "path": media_a, "audio_track": audio_a, "copy": false, "permission": {"status": "none"}}),
    )["id"]
        .as_i64()
        .unwrap();
    with_writer(|c| {
        c.execute(
            "INSERT INTO transcripts(source_id,audio_track,engine,model,revision,compute_type,state,duration_us) VALUES (?1,?2,'local','m','r','c','complete',4000000)",
            (src_a, audio_a),
        )?;
        let t_a = c.last_insert_rowid();
        for (pos, text, start, end) in [
            (0, " primeiro", 0, 900_000),
            (1, " corte.", 1_000_000, 1_900_000),
            (2, " segundo", 2_000_000, 2_900_000),
            (3, " corte.", 3_000_000, 3_900_000),
        ] {
            c.execute(
                "INSERT INTO transcript_words(transcript_id,position,kind,text,start_us,end_us,language) VALUES (?1,?2,'word',?3,?4,?5,'pt')",
                (t_a, pos, text, start, end),
            )?;
        }
        // Transcrição inativa noutra faixa de áudio (nunca deve entrar no lote).
        c.execute(
            "INSERT INTO transcripts(source_id,audio_track,engine,model,revision,compute_type,state,duration_us) VALUES (?1,99,'local','m','r','c','complete',4000000)",
            [src_a],
        )?;
        let t_inactive = c.last_insert_rowid();
        c.execute(
            "INSERT INTO transcript_words(transcript_id,position,kind,text,start_us,end_us,language) VALUES (?1,0,'word',' inativa.',0,1500000,'pt')",
            [t_inactive],
        )?;
        Ok(())
    })
    .unwrap();
    call("transcription.segment", json!({"source_id": src_a}));

    let sentences_a: Vec<i64> = clipes_core::projects::with_reader(|c| {
        let mut q = c.prepare("SELECT s.id FROM sentences s JOIN transcripts t ON t.id=s.transcript_id WHERE t.source_id=?1 AND t.audio_track=?2 ORDER BY s.id")?;
        let rows = q.query_map((src_a, audio_a), |r| r.get(0))?;
        rows.collect::<rusqlite::Result<Vec<_>>>()
    })
    .unwrap();
    assert_eq!(sentences_a.len(), 2);

    // Run 1: Cand 1 aprovado (Frase 1), Cand 2 rejeitado (Frase 2).
    let (_, cand_a1) = add_candidate(src_a, sentences_a[0], sentences_a[0], "Corte A1");
    let (_, cand_a_rej) = add_candidate(src_a, sentences_a[1], sentences_a[1], "Rejeitado");
    call(
        "selection.decide",
        json!({"candidate": cand_a1, "decision": "approved"}),
    );
    call(
        "selection.decide",
        json!({"candidate": cand_a_rej, "decision": "rejected"}),
    );

    // Run 2 (na mesma Transcrição ativa): Cand 3 aprovado (Frase 2) + editado via #70 para 1.5s!
    let (_, cand_a2) = add_candidate(src_a, sentences_a[1], sentences_a[1], "Corte A2 editado");
    call(
        "selection.decide",
        json!({"candidate": cand_a2, "decision": "approved"}),
    );
    let clip_a2 = call(
        "editor.open",
        json!({"source_id": src_a, "start_id": sentences_a[1], "end_id": sentences_a[1], "candidate_id": cand_a2}),
    )["clipId"]
        .as_i64()
        .unwrap();
    call(
        "editor.adjust",
        json!({"clip_id": clip_a2, "edge": "end", "time_us": 3_500_000, "free": true}),
    );

    // Candidato aprovado na Transcrição inativa (deve ficar fora).
    with_writer(|c| {
        let t_in: i64 = c.query_row(
            "SELECT id FROM transcripts WHERE source_id=?1 AND audio_track=99",
            [src_a],
            |r| r.get(0),
        )?;
        c.execute(
            "INSERT INTO sentences(transcript_id,id,first_position,last_position,start_us,end_us,text) VALUES (?1,1,0,0,0,1500000,'inativa.')",
            [t_in],
        )?;
        let sid = 1i64;
        c.execute(
            "INSERT INTO selection_runs(transcript_id,task_version,prompt_sha256,state,min_us,max_us,weights,plan_state,windows_total) VALUES (?1,1,'h','completed',500000,9999999,'[]','ready',0)",
            [t_in],
        )?;
        let r = c.last_insert_rowid();
        c.execute(
            "INSERT INTO selection_candidates(run_id,rank,start_id,end_id,start_us,end_us,axes,total_centi,title,windows) VALUES (?1,1,?2,?2,0,1500000,'{}',900,'Inativa','[]')",
            (r, sid),
        )?;
        let cid = c.last_insert_rowid();
        c.execute(
            "INSERT INTO selection_decisions(run_id,cand_start_id,cand_end_id,decision,before_start_id,before_end_id,after_start_id,after_end_id) VALUES (?1,?2,?2,'approved',?2,?2,?2,?2)",
            (r, sid),
        )?;
        assert!(cid > 0);
        Ok(())
    })
    .unwrap();

    // ---- Teste A: Export em lote da Fonte A (2 Cortes aprovados: 1 normal + 1 editado #70).
    let b_src = call(
        "export.batch.start",
        json!({"source_id": src_a, "output_dir": dir_source}),
    );
    let b_src_id = b_src["id"].as_i64().unwrap();
    assert_eq!(b_src["scope"], "source");
    assert_eq!(b_src["counts"]["total"], 2);
    let done_src = wait_batch(b_src_id, |v| v["state"] != "running");
    assert_eq!(done_src["status"], "completed", "{done_src}");
    assert_eq!(done_src["progress"], 100);
    assert_eq!(done_src["counts"]["completed"], 2);

    let items_src = done_src["items"].as_array().unwrap();
    assert_eq!(items_src[0]["filename"], "live-a-01-00m00s.mp4");
    assert_eq!(items_src[1]["filename"], "live-a-02-00m02s.mp4");
    assert_eq!(items_src[1]["clipId"], clip_a2);

    let out0 = dir_source.join("live-a-01-00m00s.mp4");
    let out1 = dir_source.join("live-a-02-00m02s.mp4");
    assert!(out0.is_file() && out1.is_file());
    let p0 = probe(&out0);
    let p1 = probe(&out1);
    assert_eq!(p0["streams"][0]["width"], 1080);
    assert_eq!(p0["streams"][0]["height"], 1920);
    let d0: f64 = p0["format"]["duration"].as_str().unwrap().parse().unwrap();
    let d1: f64 = p1["format"]["duration"].as_str().unwrap().parse().unwrap();
    assert!((d0 - 1.9).abs() < 0.35, "d0={d0}");
    assert!((d1 - 1.5).abs() < 0.35, "d1={d1} (borda editada no #70)");

    // ---- Teste B: Conflito na mesma pasta exige confirmação (só basenames, sem caminhos).
    let conflict = fail(
        "export.batch.start",
        json!({"source_id": src_a, "output_dir": dir_source}),
        "confirmation_required",
    );
    let conflicts = conflict.usage.unwrap()["conflicts"]
        .as_array()
        .unwrap()
        .clone();
    assert_eq!(
        conflicts,
        vec![json!("live-a-01-00m00s.mp4"), json!("live-a-02-00m02s.mp4")]
    );
    let mtime_before = fs::metadata(&out0).unwrap().modified().unwrap();
    std::thread::sleep(Duration::from_millis(20));
    let overwrite_batch = call(
        "export.batch.start",
        json!({"source_id": src_a, "output_dir": dir_source, "confirmed": true}),
    );
    let overwrite_done = wait_batch(overwrite_batch["id"].as_i64().unwrap(), |v| {
        v["state"] != "running"
    });
    assert_eq!(overwrite_done["status"], "completed");
    assert!(fs::metadata(&out0).unwrap().modified().unwrap() >= mtime_before);

    // ---- Teste C: Lote do Projeto inteiro com uma Fonte corrompida (falha proposital no FFmpeg).
    let broken_path = root.path().join("broken.mp4");
    let broken_bytes = b"not a valid mp4 container at all - fail ffmpeg";
    fs::write(&broken_path, broken_bytes).unwrap();
    let src_broken = seed_source_with_runs(
        &broken_path,
        2_000_000,
        &partial_hash_small(broken_bytes),
        broken_bytes.len() as i64,
        1,
        &[(0, " falha.", 0, 1_900_000)],
    );
    let (_, cand_broken) = add_candidate(src_broken, 1, 1, "Vai falhar");
    call(
        "selection.decide",
        json!({"candidate": cand_broken, "decision": "approved"}),
    );

    let media_b = root.path().join("live-b.mp4");
    make_lavfi_mp4(&media_b, 2);
    let insp_b = call("sources.inspect", json!({"path": media_b}));
    let audio_b = insp_b["streams"]
        .as_array()
        .unwrap()
        .iter()
        .find(|s| s["codec_type"] == "audio")
        .unwrap()["index"]
        .as_i64()
        .unwrap();
    let src_b = call(
        "sources.import",
        json!({"project": project_path, "path": media_b, "audio_track": audio_b, "copy": false, "permission": {"status": "none"}}),
    )["id"]
        .as_i64()
        .unwrap();
    with_writer(|c| {
        c.execute(
            "INSERT INTO transcripts(source_id,audio_track,engine,model,revision,compute_type,state,duration_us) VALUES (?1,?2,'local','m','r','c','complete',2000000)",
            (src_b, audio_b),
        )?;
        let t_b = c.last_insert_rowid();
        c.execute(
            "INSERT INTO transcript_words(transcript_id,position,kind,text,start_us,end_us,language) VALUES (?1,0,'word',' terceiro.',0,1900000,'pt')",
            [t_b],
        )?;
        Ok(())
    })
    .unwrap();
    call("transcription.segment", json!({"source_id": src_b}));
    let sent_b: i64 = clipes_core::projects::with_reader(|c| {
        c.query_row(
            "SELECT s.id FROM sentences s JOIN transcripts t ON t.id=s.transcript_id WHERE t.source_id=?1 AND t.audio_track=?2 LIMIT 1",
            (src_b, audio_b),
            |r| r.get(0),
        )
    })
    .unwrap();
    let (_, cand_b) = add_candidate(src_b, sent_b, sent_b, "Corte B");
    call(
        "selection.decide",
        json!({"candidate": cand_b, "decision": "approved"}),
    );

    let dir_project = root.path().join("out-project");
    fs::create_dir_all(&dir_project).unwrap();
    let b_proj = call(
        "export.batch.start",
        json!({"project": project_path, "output_dir": dir_project}),
    );
    let b_proj_id = b_proj["id"].as_i64().unwrap();
    assert_eq!(b_proj["scope"], "project");
    assert_eq!(b_proj["counts"]["total"], 4);

    let done_proj = wait_batch(b_proj_id, |v| v["state"] != "running");
    assert_eq!(done_proj["status"], "partial", "{done_proj}");
    assert_eq!(done_proj["progress"], 100);
    assert_eq!(done_proj["counts"]["completed"], 3);
    assert_eq!(done_proj["counts"]["failed"], 1);
    let proj_items = done_proj["items"].as_array().unwrap();
    let failed_item = proj_items
        .iter()
        .find(|i| i["sourceId"] == src_broken)
        .unwrap();
    assert_eq!(failed_item["state"], "failed");
    assert_eq!(failed_item["error"]["code"], "export_failed");
    assert!(!dir_project
        .join(failed_item["filename"].as_str().unwrap())
        .exists());
    let ok_item_b = proj_items.iter().find(|i| i["sourceId"] == src_b).unwrap();
    assert_eq!(ok_item_b["state"], "completed");
    assert!(dir_project
        .join(ok_item_b["filename"].as_str().unwrap())
        .is_file());

    // Eventos agregados foram emitidos para o lote.
    assert!(events.lock().unwrap().iter().any(
        |e| e.job == format!("export-batch-{b_proj_id}") && e.stage == "export_batch_complete"
    ));

    // ---- Teste D: Cancelamento no meio do lote cancela o job atual (CancelToken) e os pendentes.
    let dir_cancel = root.path().join("out-cancel");
    fs::create_dir_all(&dir_cancel).unwrap();
    let b_cancel = call(
        "export.batch.start",
        json!({"project": project_path, "output_dir": dir_cancel}),
    );
    let b_cancel_id = b_cancel["id"].as_i64().unwrap();
    // Aguarda um item entrar em execução (ou avanço) e cancela no meio.
    let deadline = Instant::now() + Duration::from_secs(30);
    loop {
        let cur = call("export.batch.status", json!({"id": b_cancel_id}));
        if cur["counts"]["running"].as_i64().unwrap_or(0) > 0
            || cur["counts"]["completed"].as_i64().unwrap_or(0) > 0
        {
            break;
        }
        assert!(Instant::now() < deadline);
        std::thread::sleep(Duration::from_millis(15));
    }
    let cancelled = call("export.batch.cancel", json!({"id": b_cancel_id}));
    assert_eq!(cancelled["status"], "cancelled");
    // Aguarda o job que estava em execução encerrar via CancelToken.
    let settled_cancel = wait_batch(b_cancel_id, |v| {
        v["counts"]["running"] == 0 && v["counts"]["queued"] == 0
    });
    assert_eq!(settled_cancel["status"], "cancelled", "{settled_cancel}");
    assert!(
        settled_cancel["counts"]["cancelled"].as_i64().unwrap() >= 1,
        "{settled_cancel}"
    );
    // Sem temporários residuais na pasta de saída.
    assert!(!fs::read_dir(&dir_cancel).unwrap().any(|e| {
        let name = e.unwrap().file_name().to_string_lossy().into_owned();
        name.starts_with(".clipes-export-") || name.ends_with(".part")
    }));

    call("projects.close", json!({}));
}

fn which_or_env(program: &str) -> PathBuf {
    let p = PathBuf::from(program);
    if p.is_file() {
        return p;
    }
    if let Some(paths) = std::env::var_os("PATH") {
        for dir in std::env::split_paths(&paths) {
            let candidate = dir.join(program);
            if candidate.is_file() {
                return candidate;
            }
            #[cfg(windows)]
            {
                let exe = dir.join(format!("{program}.exe"));
                if exe.is_file() {
                    return exe;
                }
            }
        }
    }
    p
}
