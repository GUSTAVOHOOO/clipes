//! Rede de regressão pela interface pública (`clipes_core::dispatch`) para o contexto de
//! Corte aprovado e o vínculo `clip_edits` (`#436`), cobrindo Projeto V1, `export.start`,
//! `export.batch.start`, `guardrails.check`, `angles.get`, `script.get`, `packaging.get` /
//! `packaging.refresh_chapters` (capítulos), `captions.track.set` e `sources.delete`.
use clipes_core::{
    dispatch,
    projects::{with_reader, with_writer, Migration},
    CoreError,
};
use rusqlite::Connection;
use serde_json::{json, Value};
use sha2::{Digest, Sha256};
use std::{
    ffi::OsString,
    fs,
    path::{Path, PathBuf},
    sync::{Mutex, MutexGuard},
    time::{Duration, Instant},
};

static TEST_LOCK: Mutex<()> = Mutex::new(());

struct SessionGuard {
    _lock: MutexGuard<'static, ()>,
    prev_data_dir: Option<OsString>,
    tmp: tempfile::TempDir,
}

impl SessionGuard {
    fn new() -> Self {
        let lock = TEST_LOCK.lock().unwrap_or_else(|e| e.into_inner());
        let tmp = tempfile::tempdir().unwrap();
        let prev_data_dir = std::env::var_os("CLIPES_DATA_DIR");
        std::env::set_var("CLIPES_DATA_DIR", tmp.path().join("data"));
        Self {
            _lock: lock,
            prev_data_dir,
            tmp,
        }
    }

    fn root(&self) -> &Path {
        self.tmp.path()
    }

    fn data_dir(&self) -> PathBuf {
        self.tmp.path().join("data")
    }

    fn configure_fake_export(&self) {
        let data = self.data_dir();
        fs::create_dir_all(&data).unwrap();
        fs::write(
            data.join("component-settings.json"),
            json!({
                "data_dir": data,
                "cache_dir": data.join("cache"),
                "cache_limit_bytes": 1_000_000,
                "ffmpeg_path": env!("CARGO_BIN_EXE_fake-export")
            })
            .to_string(),
        )
        .unwrap();
    }
}

impl Drop for SessionGuard {
    fn drop(&mut self) {
        let _ = dispatch("projects.close", json!({}), &mut |_| {});
        match self.prev_data_dir.take() {
            Some(v) => std::env::set_var("CLIPES_DATA_DIR", v),
            None => std::env::remove_var("CLIPES_DATA_DIR"),
        }
    }
}

fn call(name: &str, args: Value) -> Value {
    dispatch(name, args, &mut |_| {}).unwrap()
}

fn fail(name: &str, args: Value) -> CoreError {
    dispatch(name, args, &mut |_| {}).unwrap_err()
}

fn wait_export(job: i64) -> Value {
    let deadline = Instant::now() + Duration::from_secs(15);
    loop {
        let st = call("export.status", json!({ "job": job }));
        if matches!(
            st["state"].as_str(),
            Some("completed" | "cancelled" | "failed")
        ) {
            return st;
        }
        assert!(Instant::now() < deadline, "export timeout: {st}");
        std::thread::sleep(Duration::from_millis(15));
    }
}

fn wait_batch(id: i64) -> Value {
    let deadline = Instant::now() + Duration::from_secs(20);
    loop {
        let view = call("export.batch.status", json!({ "id": id }));
        if matches!(view["status"].as_str(), Some("completed" | "cancelled")) {
            return view;
        }
        assert!(Instant::now() < deadline, "batch timeout: {view}");
        std::thread::sleep(Duration::from_millis(20));
    }
}

fn partial_hash_small(bytes: &[u8]) -> String {
    let mut hash = Sha256::new();
    for _ in 0..3 {
        hash.update(bytes);
    }
    format!("{:x}", hash.finalize())
}

fn create_v1_project_dir(root: &Path, name: &str, media: &Path, hash: &str) -> PathBuf {
    let legacy_dir = root.join(format!("{name}.clipes"));
    fs::create_dir_all(&legacy_dir).unwrap();
    let conn = Connection::open(legacy_dir.join("project.sqlite")).unwrap();
    conn.execute_batch("CREATE TABLE schema_migrations(id TEXT PRIMARY KEY NOT NULL)")
        .unwrap();
    let mut migrations: Vec<_> = inventory::iter::<Migration>
        .into_iter()
        .filter(|m| m.id != "0292_001_candidate_video_kind")
        .collect();
    migrations.sort_by_key(|m| m.id);
    for m in migrations {
        conn.execute_batch(m.sql).unwrap();
        conn.execute("INSERT INTO schema_migrations VALUES (?1)", [m.id])
            .unwrap();
    }
    let media_str = media.to_str().unwrap().replace('\'', "''");
    conn.execute_batch(&format!(
        r#"
INSERT INTO project(name) VALUES ('{name}');
INSERT INTO sources(id,path,size,duration_us,partial_hash,metadata,permission,audio_track)
 VALUES (1,'{media_str}',8,80000000,'{hash}','{{}}','{{}}',1);
INSERT INTO transcripts(id,source_id,audio_track,engine,model,revision,compute_type,state,resume_us,duration_us)
 VALUES (1,1,1,'local','m','r','c','complete',80000000,80000000);
INSERT INTO transcript_words(transcript_id,position,kind,text,start_us,end_us,language)
 VALUES
  (1,0,'word',' primeira.',0,10000000,'pt'),
  (1,1,'word',' segunda.',10000000,20000000,'pt'),
  (1,2,'word',' terceira.',20000000,30000000,'pt'),
  (1,3,'word',' quarta.',30000000,70000000,'pt'),
  (1,4,'word',' quinta.',70000000,80000000,'pt');
INSERT INTO sentences(transcript_id,id,first_position,last_position,start_us,end_us,language,text)
 VALUES
  (1,1,0,0,0,10000000,'pt','primeira.'),
  (1,2,1,1,10000000,20000000,'pt','segunda.'),
  (1,3,2,2,20000000,30000000,'pt','terceira.'),
  (1,4,3,3,30000000,70000000,'pt','quarta.'),
  (1,5,4,4,70000000,80000000,'pt','quinta.');
INSERT INTO selection_runs(id,transcript_id,task_version,prompt_sha256,profile,state,batch,min_us,max_us,weights,plan_state,windows_total,video_kind)
 VALUES (1,1,3,'h','legacy','completed','selection-1',10000000,80000000,'[]','full',1,'direct');
INSERT INTO selection_candidates(id,run_id,rank,start_id,end_id,start_us,end_us,axes,total_centi,title,windows)
 VALUES
  (1,1,0,1,2,0,20000000,'{{}}',900,'Corte Sem Edicao','[0]'),
  (2,1,1,3,4,20000000,70000000,'{{}}',800,'Corte Editado','[0]'),
  (3,1,2,4,5,30000000,80000000,'{{}}',700,'Corte Pendente','[0]');
INSERT INTO selection_decisions(run_id,cand_start_id,cand_end_id,decision,before_start_id,before_end_id,after_start_id,after_end_id)
 VALUES
  (1,1,2,'approved',1,2,1,2),
  (1,3,4,'approved',3,4,3,4);
"#
    ))
    .unwrap();
    drop(conn);
    legacy_dir
}

#[test]
fn v1_project_export_start_batch_and_guardrails_preserve_unapproved_and_edited_clip_edits() {
    let guard = SessionGuard::new();
    guard.configure_fake_export();

    let media = guard.root().join("v1-live.mp4");
    fs::write(&media, b"original").unwrap();
    let hash = partial_hash_small(b"original");
    let project_dir = create_v1_project_dir(guard.root(), "LegadoExport", &media, &hash);
    let opened_project = call("projects.open", json!({ "path": project_dir }));

    // Ajustar o candidato 2 no editor (encurtando de 50s para 10s via Frase 3..3) sem passar clip_id no export.
    let opened = call(
        "editor.open",
        json!({ "source_id": 1, "start_id": 3, "end_id": 4, "candidate_id": 2 }),
    );
    let clip_2 = opened["clipId"].as_i64().unwrap();
    call(
        "editor.adjust",
        json!({ "clip_id": clip_2, "edge": "end", "sentence_id": 3 }),
    );
    call("editor.flush", json!({}));

    // guardrails.check: candidato 1 (sem clip_edits, 20s), candidato 2 (com clip_edits ajustado para 10s) e escopo projeto.
    let g1 = call(
        "guardrails.check",
        json!({ "source_id": 1, "candidate_id": 1 }),
    );
    assert_eq!(g1["videoKind"], "direct");
    assert_eq!(g1["durationUs"], 20_000_000);
    assert_eq!(g1["over60s"], false);

    let g2 = call(
        "guardrails.check",
        json!({ "source_id": 1, "candidate_id": 2, "clip_id": clip_2 }),
    );
    assert_eq!(g2["videoKind"], "direct");
    assert_eq!(g2["durationUs"], 10_000_000);

    let g_proj = call("guardrails.check", json!({ "scope": "project" }));
    assert_eq!(g_proj["totalCuts"], 2);
    assert_eq!(g_proj["durationUs"], 20_000_000);
    assert_eq!(g_proj["over60s"], false);

    // export.start: candidato pendente e bordas divergentes falham com export_candidate; bordas inválidas -> export_bounds.
    let out_err = guard.root().join("err.mp4");
    assert_eq!(
        fail(
            "export.start",
            json!({ "source_id": 1, "start_id": 4, "end_id": 5, "candidate_id": 3, "output": out_err }),
        )
        .code,
        "export_candidate"
    );
    assert_eq!(
        fail(
            "export.start",
            json!({ "source_id": 1, "start_id": 1, "end_id": 1, "candidate_id": 1, "output": out_err }),
        )
        .code,
        "export_candidate"
    );
    assert_eq!(
        fail(
            "export.start",
            json!({ "source_id": 1, "start_id": 0, "end_id": 2, "output": out_err }),
        )
        .code,
        "export_bounds"
    );

    // export.start para candidato 1 (aprovado sem clip_edits).
    let out1 = guard.root().join("cand1.mp4");
    let job1 = call(
        "export.start",
        json!({ "source_id": 1, "start_id": 1, "end_id": 2, "candidate_id": 1, "output": out1 }),
    )["job"]
        .as_i64()
        .unwrap();
    assert_eq!(wait_export(job1)["state"], "completed");
    let frozen1: Value = serde_json::from_str(
        &with_reader(|c| {
            c.query_row("SELECT request FROM exports WHERE job_id=?1", [job1], |r| {
                r.get::<_, String>(0)
            })
        })
        .unwrap(),
    )
    .unwrap();
    assert!(frozen1["clip_id"].is_null());

    // export.start para candidato 2 sem enviar clip_id resolve clip_edits e usa bordas editadas (20s..30s).
    let out2 = guard.root().join("cand2.mp4");
    let job2 = call(
        "export.start",
        json!({ "source_id": 1, "start_id": 3, "end_id": 4, "candidate_id": 2, "output": out2 }),
    )["job"]
        .as_i64()
        .unwrap();
    assert_eq!(wait_export(job2)["state"], "completed");
    let frozen2: Value = serde_json::from_str(
        &with_reader(|c| {
            c.query_row("SELECT request FROM exports WHERE job_id=?1", [job2], |r| {
                r.get::<_, String>(0)
            })
        })
        .unwrap(),
    )
    .unwrap();
    assert_eq!(frozen2["clip_id"], clip_2);
    assert_eq!(frozen2["resolved_bounds"], json!([20_000_000, 30_000_000]));

    // export.batch.start planeja apenas os 2 candidatos aprovados (1 sem clip_id, 2 com clip_2 e 10s).
    let batch_dir = guard.root().join("batch-out");
    fs::create_dir_all(&batch_dir).unwrap();
    let started = call(
        "export.batch.start",
        json!({ "project": opened_project["path"], "output_dir": batch_dir }),
    );
    let batch_id = started["id"].as_i64().unwrap();
    let settled = wait_batch(batch_id);
    assert_eq!(settled["status"], "completed");
    let items = settled["items"].as_array().unwrap();
    assert_eq!(items.len(), 2);
    assert_eq!(items[0]["candidateId"], 1);
    assert!(items[0]["clipId"].is_null());
    assert_eq!(items[0]["durationUs"], 20_000_000);
    assert_eq!(items[1]["candidateId"], 2);
    assert_eq!(items[1]["clipId"], clip_2);
    assert_eq!(items[1]["durationUs"], 10_000_000);
}

#[test]
fn direct_vs_converted_transformed_candidate_enforces_not_approved_and_transformed_gates() {
    let guard = SessionGuard::new();
    call(
        "projects.create",
        json!({ "parent": guard.root(), "name": "RegressaoKind" }),
    );

    let source = with_writer(|c| {
        c.execute(
            "INSERT INTO sources(path,size,duration_us,partial_hash,metadata,permission,audio_track)
             VALUES ('C:/videos/live.mp4',1,90000000,'h1','{}','{}',0)",
            [],
        )?;
        let source = c.last_insert_rowid();
        c.execute(
            "INSERT INTO transcripts(source_id,audio_track,engine,model,revision,compute_type,state,resume_us,duration_us)
             VALUES (?1,0,'local','m','r','c','complete',90000000,90000000)",
            [source],
        )?;
        let transcript = c.last_insert_rowid();
        for s in 1..=6_i64 {
            let p0 = (s - 1) * 2;
            let s0 = (s - 1) * 10_000_000;
            c.execute(
                "INSERT INTO transcript_words(transcript_id,position,kind,text,start_us,end_us,language)
                 VALUES (?1,?2,'word',' palavra',?3,?4,'pt')",
                (transcript, p0, s0, s0 + 4_000_000),
            )?;
            c.execute(
                "INSERT INTO transcript_words(transcript_id,position,kind,text,start_us,end_us,language)
                 VALUES (?1,?2,'word',' fim.',?3,?4,'pt')",
                (transcript, p0 + 1, s0 + 4_500_000, s * 10_000_000),
            )?;
        }
        Ok(source)
    })
    .unwrap();
    call("transcription.segment", json!({ "source_id": source }));

    let (cand_pending, cand_direct, cand_conv) = with_writer(|c| {
        let transcript: i64 = c.query_row(
            "SELECT id FROM transcripts WHERE source_id=?1",
            [source],
            |r| r.get(0),
        )?;
        c.execute(
            "INSERT INTO selection_runs(transcript_id,task_version,prompt_sha256,profile,state,batch,min_us,max_us,weights,plan_state,windows_total,video_kind)
             VALUES (?1,3,'h','legacy','completed','',10000000,90000000,'[]','full',1,'direct')",
            [transcript],
        )?;
        let run = c.last_insert_rowid();
        c.execute(
            "INSERT INTO selection_candidates(run_id,rank,start_id,end_id,start_us,end_us,axes,total_centi,title,windows)
             VALUES (?1,0,1,2,0,20000000,'{}',900,'Pendente','[0]')",
            [run],
        )?;
        let p = c.last_insert_rowid();
        c.execute(
            "INSERT INTO selection_candidates(run_id,rank,start_id,end_id,start_us,end_us,axes,total_centi,title,windows)
             VALUES (?1,1,3,4,20000000,40000000,'{}',800,'Direto','[0]')",
            [run],
        )?;
        let d = c.last_insert_rowid();
        c.execute(
            "INSERT INTO selection_candidates(run_id,rank,start_id,end_id,start_us,end_us,axes,total_centi,title,windows)
             VALUES (?1,2,5,6,40000000,60000000,'{}',700,'Convertido','[0]')",
            [run],
        )?;
        let t = c.last_insert_rowid();
        Ok((p, d, t))
    })
    .unwrap();
    call(
        "selection.decide",
        json!({ "candidate": cand_direct, "decision": "approved" }),
    );
    call(
        "selection.decide",
        json!({ "candidate": cand_conv, "decision": "approved" }),
    );
    call(
        "selection.candidate.set_kind",
        json!({ "candidate": cand_conv, "videoKind": "transformed" }),
    );

    // 1. Candidato não aprovado -> not_approved em todos os módulos dependentes (e export_candidate no export).
    for cmd in ["angles.get", "script.get", "packaging.get", "thumbnail.get", "narration.get"] {
        assert_eq!(
            fail(cmd, json!({ "candidate": cand_pending })).code,
            "not_approved",
            "{cmd} em candidato pendente"
        );
    }
    assert_eq!(
        fail(
            "captions.track.set",
            json!({ "candidate_id": cand_pending, "track": "narration" }),
        )
        .code,
        "not_approved"
    );
    assert_eq!(
        fail(
            "export.start",
            json!({
                "source_id": source,
                "start_id": 1,
                "end_id": 2,
                "candidate_id": cand_pending,
                "output": guard.root().join("pending.mp4")
            }),
        )
        .code,
        "export_candidate"
    );

    // 2. Candidato aprovado direto -> script_requires_transformed em angles/script/narration/captions.track.set; chapters.applicable=false.
    for cmd in ["angles.get", "script.get", "narration.get"] {
        assert_eq!(
            fail(cmd, json!({ "candidate": cand_direct })).code,
            "script_requires_transformed",
            "{cmd} em candidato direct"
        );
    }
    assert_eq!(
        fail(
            "captions.track.set",
            json!({ "candidate_id": cand_direct, "track": "narration" }),
        )
        .code,
        "script_requires_transformed"
    );
    let pkg_direct = call("packaging.get", json!({ "candidate": cand_direct }));
    assert_eq!(pkg_direct["chapters"]["applicable"], false);
    assert_eq!(pkg_direct["chapters"]["status"], "not_transformed");

    // 3. Candidato convertido para transformed -> angles.get, script.get, narration.get, chapters e captions.track.set funcionam.
    assert!(call("angles.get", json!({ "candidate": cand_conv })).is_object());
    assert!(call("script.get", json!({ "candidate": cand_conv })).is_object());
    assert!(call("narration.get", json!({ "candidate": cand_conv })).is_object());
    let pkg_conv = call("packaging.get", json!({ "candidate": cand_conv }));
    assert_eq!(pkg_conv["chapters"]["applicable"], true);
    assert_eq!(pkg_conv["chapters"]["status"], "script_not_approved");

    // Abrir no editor e alternar faixa via clip_id apenas (exercita candidate_id_for_clip).
    let clip_conv = call(
        "editor.open",
        json!({ "source_id": source, "start_id": 5, "end_id": 6, "candidate_id": cand_conv }),
    )["clipId"]
        .as_i64()
        .unwrap();
    let track_res = call(
        "captions.track.set",
        json!({ "clip_id": clip_conv, "track": "narration" }),
    );
    assert_eq!(track_res["candidateId"], cand_conv);
    assert_eq!(track_res["track"], "narration");
}

#[test]
fn sources_delete_cleans_candidate_and_manual_clip_edits_without_touching_other_source() {
    let guard = SessionGuard::new();
    call(
        "projects.create",
        json!({ "parent": guard.root(), "name": "DeleteClean" }),
    );

    let (src_a, cand_a, src_b, cand_b) = with_writer(|c| {
        let mut ids = Vec::new();
        for idx in 1..=2_i64 {
            c.execute(
                "INSERT INTO sources(path,size,duration_us,partial_hash,metadata,permission,audio_track)
                 VALUES (?1,1,40000000,?2,'{}','{}',0)",
                (format!("C:/videos/src{idx}.mp4"), format!("h{idx}")),
            )?;
            let src = c.last_insert_rowid();
            c.execute(
                "INSERT INTO transcripts(source_id,audio_track,engine,model,revision,compute_type,state,resume_us,duration_us)
                 VALUES (?1,0,'local','m','r','c','complete',40000000,40000000)",
                [src],
            )?;
            let tr = c.last_insert_rowid();
            c.execute(
                "INSERT INTO sentences(transcript_id,id,first_position,last_position,start_us,end_us,language,text)
                 VALUES (?1,1,0,0,0,20000000,'pt','Um.'), (?1,2,1,1,20000000,40000000,'pt','Dois.')",
                [tr],
            )?;
            c.execute(
                "INSERT INTO selection_runs(transcript_id,task_version,prompt_sha256,profile,state,batch,min_us,max_us,weights,plan_state,windows_total,video_kind)
                 VALUES (?1,3,'h','legacy','completed','',5000000,40000000,'[]','full',1,'direct')",
                [tr],
            )?;
            let run = c.last_insert_rowid();
            c.execute(
                "INSERT INTO selection_candidates(run_id,rank,start_id,end_id,start_us,end_us,axes,total_centi,title,windows)
                 VALUES (?1,0,1,2,0,40000000,'{}',900,'Corte','[0]')",
                [run],
            )?;
            let cand = c.last_insert_rowid();
            c.execute(
                "INSERT INTO selection_decisions(run_id,cand_start_id,cand_end_id,decision,before_start_id,before_end_id,after_start_id,after_end_id)
                 VALUES (?1,1,2,'approved',1,2,1,2)",
                [run],
            )?;
            ids.push((src, cand));
        }
        Ok((ids[0].0, ids[0].1, ids[1].0, ids[1].1))
    })
    .unwrap();

    let clip_a = call(
        "editor.open",
        json!({ "source_id": src_a, "start_id": 1, "end_id": 2, "candidate_id": cand_a }),
    )["clipId"]
        .as_i64()
        .unwrap();
    let manual_a = call(
        "editor.open",
        json!({ "source_id": src_a, "start_id": 1, "end_id": 1 }),
    )["clipId"]
        .as_i64()
        .unwrap();
    let clip_b = call(
        "editor.open",
        json!({ "source_id": src_b, "start_id": 1, "end_id": 2, "candidate_id": cand_b }),
    )["clipId"]
        .as_i64()
        .unwrap();
    call("editor.flush", json!({}));

    let deleted = call("sources.delete", json!({ "id": src_a, "confirmed": true }));
    assert_eq!(deleted["clip_edits"], 2);

    let remaining_a: i64 = with_reader(|c| {
        c.query_row(
            "SELECT COUNT(*) FROM clip_edits WHERE id IN (?1, ?2)",
            (clip_a, manual_a),
            |r| r.get(0),
        )
    })
    .unwrap();
    assert_eq!(remaining_a, 0);

    let remaining_b: i64 = with_reader(|c| {
        c.query_row("SELECT COUNT(*) FROM clip_edits WHERE id=?1", [clip_b], |r| {
            r.get(0)
        })
    })
    .unwrap();
    assert_eq!(remaining_b, 1);

    // O vínculo de B continua íntegro nos guardrails.
    let g_b = call(
        "guardrails.check",
        json!({ "source_id": src_b, "candidate_id": cand_b }),
    );
    assert_eq!(g_b["durationUs"], 40_000_000);
}
