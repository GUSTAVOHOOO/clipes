use clipes_core::{
    dispatch,
    projects::{with_reader, with_writer},
};
use rusqlite::Connection;
use serde_json::{json, Value};
use std::{
    ffi::OsString,
    fs,
    path::{Path, PathBuf},
    sync::{Mutex, MutexGuard},
};

static TEST_LOCK: Mutex<()> = Mutex::new(());
const V1_FIXTURE: &[u8] = include_bytes!("fixtures/project-pre-0104.sqlite");

struct SessionGuard {
    _lock: MutexGuard<'static, ()>,
    prev_data_dir: Option<OsString>,
    _tmp: tempfile::TempDir,
    project_path: Option<PathBuf>,
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
            _tmp: tmp,
            project_path: None,
        }
    }

    fn root(&self) -> &Path {
        self._tmp.path()
    }

    fn create_project(&mut self, name: &str) -> PathBuf {
        let created = dispatch(
            "projects.create",
            json!({ "parent": self.root(), "name": name }),
            &mut |_| {},
        )
        .unwrap();
        let path = PathBuf::from(created["path"].as_str().unwrap());
        self.project_path = Some(path.clone());
        path
    }

    fn open_v1_fixture(&mut self, name: &str) -> PathBuf {
        let dir = self.root().join(format!("{name}.clipes"));
        fs::create_dir_all(&dir).unwrap();
        fs::write(dir.join("project.sqlite"), V1_FIXTURE).unwrap();
        let opened = dispatch("projects.open", json!({ "path": dir }), &mut |_| {}).unwrap();
        let canonical = PathBuf::from(opened["path"].as_str().unwrap());
        self.project_path = Some(canonical.clone());
        canonical
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

fn run(name: &str, args: Value) -> Result<Value, clipes_core::CoreError> {
    dispatch(name, args, &mut |_| {})
}

fn count_rows(table: &str, where_clause: &str, id: i64) -> i64 {
    with_reader(|c| {
        c.query_row(
            &format!("SELECT COUNT(*) FROM {table} WHERE {where_clause}"),
            [id],
            |r| r.get(0),
        )
    })
    .unwrap()
}

fn assert_foreign_keys_clean() {
    with_reader(|c| {
        let mut stmt = c.prepare("PRAGMA foreign_key_check")?;
        let mut rows = stmt.query([])?;
        assert!(
            rows.next()?.is_none(),
            "PRAGMA foreign_key_check retornou violações de integridade referencial"
        );
        Ok(())
    })
    .unwrap();
}

struct SeededSource {
    source_id: i64,
    transcript_id: i64,
    run_id: i64,
    candidate_id: i64,
    clip_id: i64,
    manual_clip_id: i64,
    direct_job_id: i64,
    ai_job_id: i64,
    narration_job_id: i64,
    translation_job_id: i64,
    export_batch_source_id: i64,
}

fn seed_full_source(media_path: &Path, tag: &str) -> SeededSource {
    let media_str = media_path.to_string_lossy().to_string();
    with_writer(|c| {
        c.execute(
            "INSERT INTO sources(path,size,duration_us,partial_hash,metadata,permission,audio_track,origin_url)
             VALUES (?1,128,30000000,?2,'{}','{\"status\":\"none\"}',0,'https://example.invalid/v')",
            (&media_str, format!("hash-{tag}")),
        )?;
        let source_id = c.last_insert_rowid();

        c.execute(
            "INSERT INTO transcripts(source_id,audio_track,engine,model,revision,compute_type,state,resume_us,duration_us)
             VALUES (?1,0,'groq','whisper-large-v3','r1','remote','complete',30000000,30000000)",
            [source_id],
        )?;
        let transcript_id = c.last_insert_rowid();

        c.execute(
            "INSERT INTO transcript_words(transcript_id,position,kind,text,start_us,end_us,language,corrected_text)
             VALUES (?1,0,'word',?2,0,2000000,'pt',?3)",
            (transcript_id, format!("palavra{tag}"), format!("corrigida{tag}")),
        )?;
        c.execute(
            "INSERT INTO transcript_corrections(transcript_id,position,before_text,after_text,undone)
             VALUES (?1,0,?2,?3,0)",
            (transcript_id, format!("palavra{tag}"), format!("corrigida{tag}")),
        )?;
        c.execute(
            "INSERT INTO sentences(transcript_id,id,first_position,last_position,start_us,end_us,language,text)
             VALUES (?1,1,0,0,0,2000000,'pt',?2)",
            (transcript_id, format!("fraseunica{tag}")),
        )?;
        c.execute(
            "INSERT INTO transcription_blocks(transcript_id,start_us,end_us) VALUES (?1,0,2000000)",
            [transcript_id],
        )?;
        c.execute(
            "INSERT INTO transcription_block_config(transcript_id,start_us,device,compute_type) VALUES (?1,0,'cpu','int8')",
            [transcript_id],
        )?;
        c.execute(
            "INSERT INTO energy_measurements(transcript_id,method,sentences) VALUES (?1,1,1)",
            [transcript_id],
        )?;
        c.execute(
            "INSERT INTO sentence_energy(transcript_id,sentence_id,loudness_centi) VALUES (?1,1,-1200)",
            [transcript_id],
        )?;
        c.execute(
            "INSERT INTO chat_replays(source_id,state,method,interval_us,intervals,messages) VALUES (?1,'available',1,1000000,1,2)",
            [source_id],
        )?;
        c.execute(
            "INSERT INTO chat_series(source_id,idx,people,messages,paid,laugh,surprise,clip) VALUES (?1,0,1,2,0,0,0,0)",
            [source_id],
        )?;

        c.execute(
            "INSERT INTO jobs(kind,safety,state,source_id) VALUES ('transcription','paid','completed',?1)",
            [source_id],
        )?;
        let direct_job_id = c.last_insert_rowid();
        c.execute(
            "INSERT INTO transcription_calls(transcript_id,job_id,start_us,end_us,state,estimated_usd) VALUES (?1,?2,0,2000000,'completed',0.01)",
            (transcript_id, direct_job_id),
        )?;
        let tcall_id = c.last_insert_rowid();
        c.execute(
            "INSERT INTO call_audit(transcription_call_id,provider_kind,host,model) VALUES (?1,'transcription','api.groq.com','whisper-large-v3')",
            [tcall_id],
        )?;

        c.execute(
            "INSERT INTO jobs(kind,safety,state,source_id) VALUES ('proxy','local','completed',?1)",
            [source_id],
        )?;
        let proxy_job_id = c.last_insert_rowid();
        c.execute(
            "INSERT INTO proxy_jobs(job_id,source_id,key,start_us,end_us) VALUES (?1,?2,?3,0,2000000)",
            (proxy_job_id, source_id, format!("proxy-{tag}")),
        )?;

        c.execute(
            "INSERT INTO jobs(kind,safety,state,source_id) VALUES ('timeline','local','completed',?1)",
            [source_id],
        )?;
        let timeline_job_id = c.last_insert_rowid();
        c.execute(
            "INSERT INTO timeline_jobs(job_id,source_id,key,start_us,end_us) VALUES (?1,?2,?3,0,2000000)",
            (timeline_job_id, source_id, format!("timeline-{tag}")),
        )?;

        c.execute(
            "INSERT INTO jobs(kind,safety,state,source_id) VALUES ('reframe','local','completed',?1)",
            [source_id],
        )?;
        let reframe_job_id = c.last_insert_rowid();
        c.execute(
            "INSERT INTO reframe_suggestions(job_id,source_id,candidate_id,start_us,end_us) VALUES (?1,?2,NULL,0,2000000)",
            (reframe_job_id, source_id),
        )?;

        c.execute(
            "INSERT INTO selection_runs(transcript_id,task_version,prompt_sha256,profile,state,batch,min_us,max_us,weights,plan_state,windows_total,video_kind)
             VALUES (?1,1,'h','p','completed','',20000000,180000000,'[]','full',1,'transformed')",
            [transcript_id],
        )?;
        let run_id = c.last_insert_rowid();

        c.execute("INSERT INTO jobs(kind,safety,state) VALUES ('ai:selection','local','completed')", [])?;
        let ai_job_id = c.last_insert_rowid();
        c.execute(
            "INSERT INTO selection_windows(run_id,idx,first_id,last_id,start_us,end_us,job_id,attempts) VALUES (?1,0,1,1,0,2000000,?2,1)",
            (run_id, ai_job_id),
        )?;
        c.execute(
            "INSERT INTO selection_candidates(run_id,rank,start_id,end_id,start_us,end_us,axes,total_centi,title,windows)
             VALUES (?1,1,1,1,0,2000000,'{}',800,?2,'[0]')",
            (run_id, format!("Corte {tag}")),
        )?;
        let candidate_id = c.last_insert_rowid();
        c.execute(
            "INSERT INTO selection_decisions(run_id,cand_start_id,cand_end_id,decision,before_start_id,before_end_id,after_start_id,after_end_id)
             VALUES (?1,1,1,'approved',1,1,1,1)",
            [run_id],
        )?;

        c.execute("INSERT INTO jobs(kind,safety,state) VALUES ('ai:angles','local','completed')", [])?;
        let angle_job_id = c.last_insert_rowid();
        c.execute(
            "INSERT INTO angle_generations(job_id,run_id,cand_start_id,cand_end_id) VALUES (?1,?2,1,1)",
            (angle_job_id, run_id),
        )?;
        let angle_gen_id = c.last_insert_rowid();
        c.execute(
            "INSERT INTO script_angles(run_id,cand_start_id,cand_end_id,angle,generation_id) VALUES (?1,1,1,'{}',?2)",
            (run_id, angle_gen_id),
        )?;

        c.execute("INSERT INTO jobs(kind,safety,state) VALUES ('ai:packaging','local','completed')", [])?;
        let pack_job_id = c.last_insert_rowid();
        c.execute(
            "INSERT INTO packaging_generations(job_id,run_id,cand_start_id,cand_end_id,language,task_version,prompt_sha256)
             VALUES (?1,?2,1,1,'pt-BR',1,'h')",
            (pack_job_id, run_id),
        )?;
        let pack_gen_id = c.last_insert_rowid();
        c.execute(
            "INSERT INTO packaging_edits(generation_id,fields) VALUES (?1,'{}')",
            [pack_gen_id],
        )?;

        c.execute("INSERT INTO jobs(kind,safety,state) VALUES ('ai:thumbnail','local','completed')", [])?;
        let thumb_job_id = c.last_insert_rowid();
        c.execute(
            "INSERT INTO thumbnail_suggestions(job_id,run_id,cand_start_id,cand_end_id,task_version,prompt_sha256)
             VALUES (?1,?2,1,1,1,'h')",
            (thumb_job_id, run_id),
        )?;
        let thumb_sug_id = c.last_insert_rowid();
        c.execute(
            "INSERT INTO thumbnail_choices(run_id,cand_start_id,cand_end_id,instant_us,origin,suggestion_id)
             VALUES (?1,1,1,500000,'provider',?2)",
            (run_id, thumb_sug_id),
        )?;

        c.execute("INSERT INTO jobs(kind,safety,state) VALUES ('ai:script','local','completed')", [])?;
        let script_job_id = c.last_insert_rowid();
        c.execute(
            "INSERT INTO script_generations(job_id,run_id,cand_start_id,cand_end_id,language,task_version,prompt_sha256,safety)
             VALUES (?1,?2,1,1,'pt-BR',1,'h','local')",
            (script_job_id, run_id),
        )?;
        let script_gen_id = c.last_insert_rowid();
        c.execute(
            "INSERT INTO script_blocks(generation_id,position,title,intent,refs) VALUES (?1,0,'B','I','[]')",
            [script_gen_id],
        )?;
        let block_id = c.last_insert_rowid();
        c.execute("INSERT INTO jobs(kind,safety,state) VALUES ('ai:script_block','local','completed')", [])?;
        let block_ver_job_id = c.last_insert_rowid();
        c.execute(
            "INSERT INTO script_block_versions(block_id,kind,job_id,title,narration) VALUES (?1,'generated',?2,'T','N')",
            (block_id, block_ver_job_id),
        )?;
        let version_id = c.last_insert_rowid();
        c.execute(
            "INSERT INTO script_approvals(block_id,version_id) VALUES (?1,?2)",
            (block_id, version_id),
        )?;
        c.execute(
            "INSERT INTO narration_blocks(block_id,version_id,voice_id,model_id,audio_rel_path,duration_us,sample_rate,channels,bytes,sha256)
             VALUES (?1,?2,'v','m','narrations/x.wav',1000000,24000,1,100,'abc')",
            (block_id, version_id),
        )?;
        let narration_id = c.last_insert_rowid();
        c.execute(
            "INSERT INTO narration_alignments(narration_id,block_id,version_id,audio_sha256,language,model_id,status)
             VALUES (?1,?2,?3,'abc','pt','m','aligned')",
            (narration_id, block_id, version_id),
        )?;
        c.execute(
            "INSERT INTO narration_aligned_words(narration_id,track,position,sentence_idx,text,start_us,end_us)
             VALUES (?1,'script',0,0,'oi',0,500000)",
            [narration_id],
        )?;
        c.execute(
            "INSERT INTO narration_cleanups(narration_id,source_sha256) VALUES (?1,'abc')",
            [narration_id],
        )?;
        c.execute(
            "INSERT INTO narration_recordings(narration_id) VALUES (?1)",
            [narration_id],
        )?;

        c.execute("INSERT INTO jobs(kind,safety,state) VALUES ('narration','local','completed')", [])?;
        let narration_job_id = c.last_insert_rowid();
        c.execute(
            "INSERT INTO narration_jobs(job_id,candidate_id,block_id,voice_id,model_id) VALUES (?1,?2,?3,'v','m')",
            (narration_job_id, candidate_id, block_id),
        )?;
        c.execute("INSERT INTO jobs(kind,safety,state) VALUES ('narration_align','local','completed')", [])?;
        let align_job_id = c.last_insert_rowid();
        c.execute(
            "INSERT INTO narration_align_jobs(job_id,candidate_id,block_id) VALUES (?1,?2,?3)",
            (align_job_id, candidate_id, block_id),
        )?;
        c.execute("INSERT INTO jobs(kind,safety,state) VALUES ('narration_import','local','completed')", [])?;
        let import_job_id = c.last_insert_rowid();
        c.execute(
            "INSERT INTO narration_import_jobs(job_id,candidate_id,block_id,source_path) VALUES (?1,?2,?3,'a.wav')",
            (import_job_id, candidate_id, block_id),
        )?;
        c.execute(
            "INSERT INTO narration_caption_tracks(candidate_id,track) VALUES (?1,'auto')",
            [candidate_id],
        )?;

        let doc = json!({
            "schemaVersion": 2,
            "revision": 0,
            "original": { "source_id": source_id, "start_id": 1, "end_id": 1, "candidate_id": candidate_id },
            "range": { "startId": 1, "endId": 1, "startUs": 0, "endUs": 2000000 },
            "undo": [],
            "redo": [],
            "crop": {}
        })
        .to_string();
        c.execute(
            "INSERT INTO clip_edits(identity,document) VALUES (?1,?2)",
            (format!("candidate:{candidate_id}"), &doc),
        )?;
        let clip_id = c.last_insert_rowid();
        c.execute(
            "INSERT INTO clip_snapshots(clip_id,document) VALUES (?1,?2)",
            (clip_id, &doc),
        )?;
        c.execute(
            "INSERT INTO caption_styles(clip_id,document) VALUES (?1,'{}')",
            [clip_id],
        )?;
        c.execute(
            "INSERT INTO caption_word_overrides(transcript_id,position,document) VALUES (?1,0,'{}')",
            [transcript_id],
        )?;
        c.execute(
            "INSERT INTO caption_remap_pending(source_id,audio_track,position,normalized,start_us,document) VALUES (?1,0,0,'x',0,'{}')",
            [source_id],
        )?;
        c.execute(
            "INSERT INTO caption_remap_notices(source_id,audio_track,discarded) VALUES (?1,0,1)",
            [source_id],
        )?;

        let manual_doc = json!({
            "schemaVersion": 2,
            "revision": 0,
            "original": { "source_id": source_id, "start_id": 1, "end_id": 1 },
            "range": { "startId": 1, "endId": 1, "startUs": 0, "endUs": 2000000 },
            "undo": [],
            "redo": [],
            "crop": {}
        })
        .to_string();
        c.execute(
            "INSERT INTO clip_edits(identity,document) VALUES (?1,?2)",
            (format!("source:{source_id}:1:1"), &manual_doc),
        )?;
        let manual_clip_id = c.last_insert_rowid();

        c.execute(
            "INSERT INTO translation_runs(clip_id,source_language,target_language,task_version,prompt_sha256,state)
             VALUES (?1,'pt-BR','en',1,'h','completed')",
            [clip_id],
        )?;
        let trans_run_id = c.last_insert_rowid();
        c.execute("INSERT INTO jobs(kind,safety,state) VALUES ('ai:translation','local','completed')", [])?;
        let translation_job_id = c.last_insert_rowid();
        c.execute(
            "INSERT INTO translation_run_jobs(run_id,job_id,batch_index,first_sentence_id,last_sentence_id,sentence_ids)
             VALUES (?1,?2,0,1,1,'[1]')",
            (trans_run_id, translation_job_id),
        )?;
        c.execute(
            "INSERT INTO clip_caption_tracks(clip_id,active_track,target_language) VALUES (?1,'translated','en')",
            [clip_id],
        )?;
        c.execute(
            "INSERT INTO clip_translated_sentences(clip_id,language,sentence_id,translated_text,generated_text,run_id)
             VALUES (?1,'en',1,'hi','hi',?2)",
            (clip_id, trans_run_id),
        )?;

        c.execute(
            "INSERT INTO jobs(kind,safety,state,source_id) VALUES ('export','local','completed',?1)",
            [source_id],
        )?;
        let export_job_id = c.last_insert_rowid();
        c.execute(
            "INSERT INTO exports(job_id,request) VALUES (?1,?2)",
            (export_job_id, json!({"source_id": source_id}).to_string()),
        )?;
        c.execute(
            "INSERT INTO export_batches(scope,source_id,output_dir,state) VALUES ('source',?1,'C:/out','completed')",
            [source_id],
        )?;
        let export_batch_source_id = c.last_insert_rowid();
        c.execute(
            "INSERT INTO export_batch_items(batch_id,position,source_id,run_id,candidate_id,clip_id,job_id,filename,output,duration_us,state)
             VALUES (?1,0,?2,?3,?4,?5,?6,'out.mp4','C:/out/out.mp4',2000000,'completed')",
            (export_batch_source_id, source_id, run_id, candidate_id, clip_id, export_job_id),
        )?;

        Ok(SeededSource {
            source_id,
            transcript_id,
            run_id,
            candidate_id,
            clip_id,
            manual_clip_id,
            direct_job_id,
            ai_job_id,
            narration_job_id,
            translation_job_id,
            export_batch_source_id,
        })
    })
    .unwrap()
}

#[test]
fn deletes_source_and_all_dependents_preserving_media_and_other_sources() {
    let mut guard = SessionGuard::new();
    let project = guard.create_project("Canal");
    let media_a = guard.root().join("media_a.mp4");
    let media_b = guard.root().join("media_b.mp4");
    fs::write(&media_a, b"video-a-bytes").unwrap();
    fs::write(&media_b, b"video-b-bytes").unwrap();

    let a = seed_full_source(&media_a, "alpha");
    let b = seed_full_source(&media_b, "beta");

    // Lote compartilhado entre Fonte A e Fonte B (source_batches e export_batches scope='project').
    with_writer(|c| {
        c.execute(
            "INSERT INTO source_batches(key,state,engine) VALUES ('sources-1','completed','local')",
            [],
        )?;
        let sb_id = c.last_insert_rowid();
        c.execute(
            "INSERT INTO source_batch_items(batch_id,position,source_id,state,transcription_job,selection_run)
             VALUES (?1,0,?2,'completed',?3,?4)",
            (sb_id, a.source_id, a.direct_job_id, a.run_id),
        )?;
        c.execute(
            "INSERT INTO source_batch_items(batch_id,position,source_id,state,transcription_job,selection_run)
             VALUES (?1,1,?2,'completed',?3,?4)",
            (sb_id, b.source_id, b.direct_job_id, b.run_id),
        )?;

        c.execute(
            "INSERT INTO export_batches(scope,source_id,output_dir,state) VALUES ('project',NULL,'C:/out','completed')",
            [],
        )?;
        let eb_proj = c.last_insert_rowid();
        c.execute(
            "INSERT INTO export_batch_items(batch_id,position,source_id,run_id,candidate_id,clip_id,filename,output,duration_us,state)
             VALUES (?1,0,?2,?3,?4,?5,'a.mp4','C:/out/a.mp4',2000000,'completed')",
            (eb_proj, a.source_id, a.run_id, a.candidate_id, a.clip_id),
        )?;
        c.execute(
            "INSERT INTO export_batch_items(batch_id,position,source_id,run_id,candidate_id,clip_id,filename,output,duration_us,state)
             VALUES (?1,1,?2,?3,?4,?5,'b.mp4','C:/out/b.mp4',2000000,'completed')",
            (eb_proj, b.source_id, b.run_id, b.candidate_id, b.clip_id),
        )?;

        // Garante que foreign_keys=ON esteja ativo na conexão para provar exclusão folhas→raiz.
        c.execute_batch("PRAGMA foreign_keys = ON;")?;
        Ok(())
    })
    .unwrap();

    let res = run(
        "sources.delete",
        json!({ "project": project, "id": a.source_id }),
    )
    .unwrap();

    assert_eq!(res["deleted"], true);
    assert_eq!(res["id"], a.source_id);
    assert_eq!(res["transcripts"], 1);
    assert_eq!(res["cuts"], 2); // 1 candidato + 1 clip_edits manual
    assert_eq!(res["selection_runs"], 1);
    assert_eq!(res["clip_edits"], 2);
    assert_eq!(res["batch_items"], 3); // 1 source_batch_item + 2 export_batch_items
    assert_eq!(res["jobs"], 15);

    assert_foreign_keys_clean();

    // Fonte A e todos os seus dependentes sumiram.
    assert_eq!(count_rows("sources", "id=?1", a.source_id), 0);
    assert_eq!(count_rows("transcripts", "id=?1", a.transcript_id), 0);
    assert_eq!(
        count_rows("transcript_words", "transcript_id=?1", a.transcript_id),
        0
    );
    assert_eq!(
        count_rows(
            "transcript_corrections",
            "transcript_id=?1",
            a.transcript_id
        ),
        0
    );
    assert_eq!(
        count_rows("sentences", "transcript_id=?1", a.transcript_id),
        0
    );
    assert_eq!(
        count_rows("transcription_blocks", "transcript_id=?1", a.transcript_id),
        0
    );
    assert_eq!(
        count_rows(
            "transcription_block_config",
            "transcript_id=?1",
            a.transcript_id
        ),
        0
    );
    assert_eq!(
        count_rows("transcription_calls", "transcript_id=?1", a.transcript_id),
        0
    );
    assert_eq!(
        count_rows("energy_measurements", "transcript_id=?1", a.transcript_id),
        0
    );
    assert_eq!(
        count_rows("sentence_energy", "transcript_id=?1", a.transcript_id),
        0
    );
    assert_eq!(
        count_rows(
            "caption_word_overrides",
            "transcript_id=?1",
            a.transcript_id
        ),
        0
    );
    assert_eq!(
        count_rows("caption_remap_pending", "source_id=?1", a.source_id),
        0
    );
    assert_eq!(
        count_rows("caption_remap_notices", "source_id=?1", a.source_id),
        0
    );
    assert_eq!(count_rows("selection_runs", "id=?1", a.run_id), 0);
    assert_eq!(count_rows("selection_windows", "run_id=?1", a.run_id), 0);
    assert_eq!(
        count_rows("selection_candidates", "id=?1", a.candidate_id),
        0
    );
    assert_eq!(count_rows("selection_decisions", "run_id=?1", a.run_id), 0);
    assert_eq!(count_rows("angle_generations", "run_id=?1", a.run_id), 0);
    assert_eq!(count_rows("script_angles", "run_id=?1", a.run_id), 0);
    assert_eq!(
        count_rows("packaging_generations", "run_id=?1", a.run_id),
        0
    );
    assert_eq!(
        count_rows("thumbnail_suggestions", "run_id=?1", a.run_id),
        0
    );
    assert_eq!(count_rows("thumbnail_choices", "run_id=?1", a.run_id), 0);
    assert_eq!(count_rows("script_generations", "run_id=?1", a.run_id), 0);
    assert_eq!(
        count_rows("narration_jobs", "candidate_id=?1", a.candidate_id),
        0
    );
    assert_eq!(
        count_rows("narration_align_jobs", "candidate_id=?1", a.candidate_id),
        0
    );
    assert_eq!(
        count_rows("narration_import_jobs", "candidate_id=?1", a.candidate_id),
        0
    );
    assert_eq!(
        count_rows(
            "narration_caption_tracks",
            "candidate_id=?1",
            a.candidate_id
        ),
        0
    );
    assert_eq!(count_rows("clip_edits", "id=?1", a.clip_id), 0);
    assert_eq!(count_rows("clip_edits", "id=?1", a.manual_clip_id), 0);
    assert_eq!(count_rows("clip_snapshots", "clip_id=?1", a.clip_id), 0);
    assert_eq!(count_rows("caption_styles", "clip_id=?1", a.clip_id), 0);
    assert_eq!(count_rows("translation_runs", "clip_id=?1", a.clip_id), 0);
    assert_eq!(
        count_rows("clip_caption_tracks", "clip_id=?1", a.clip_id),
        0
    );
    assert_eq!(
        count_rows("clip_translated_sentences", "clip_id=?1", a.clip_id),
        0
    );
    assert_eq!(
        count_rows("source_batch_items", "source_id=?1", a.source_id),
        0
    );
    assert_eq!(
        count_rows("export_batch_items", "source_id=?1", a.source_id),
        0
    );
    assert_eq!(
        count_rows("export_batches", "id=?1", a.export_batch_source_id),
        0
    );
    assert_eq!(count_rows("chat_replays", "source_id=?1", a.source_id), 0);
    assert_eq!(count_rows("chat_series", "source_id=?1", a.source_id), 0);
    assert_eq!(
        count_rows("reframe_suggestions", "source_id=?1", a.source_id),
        0
    );
    assert_eq!(count_rows("proxy_jobs", "source_id=?1", a.source_id), 0);
    assert_eq!(count_rows("timeline_jobs", "source_id=?1", a.source_id), 0);
    assert_eq!(count_rows("jobs", "id=?1", a.direct_job_id), 0);
    assert_eq!(count_rows("jobs", "id=?1", a.ai_job_id), 0);
    assert_eq!(count_rows("jobs", "id=?1", a.narration_job_id), 0);
    assert_eq!(count_rows("jobs", "id=?1", a.translation_job_id), 0);
    assert_eq!(count_rows("call_audit", "1=1 OR id=?1", 0), 1); // apenas a da Fonte B
    assert_eq!(count_rows("narration_blocks", "1=1 OR id=?1", 0), 1);
    assert_eq!(count_rows("packaging_edits", "1=1 OR id=?1", 0), 1);
    assert_eq!(count_rows("exports", "1=1 OR job_id=?1", 0), 1);

    // Busca FTS5 não encontra mais a frase da Fonte A, mas continua encontrando a da Fonte B.
    let search_a = run(
        "transcription.search",
        json!({ "query": "fraseunicaalpha" }),
    )
    .unwrap();
    assert_eq!(search_a.as_array().unwrap().len(), 0);
    let search_b = run("transcription.search", json!({ "query": "fraseunicabeta" })).unwrap();
    assert_eq!(search_b.as_array().unwrap().len(), 1);
    let total_fts: i64 =
        with_reader(|c| c.query_row("SELECT COUNT(*) FROM sentence_search", [], |r| r.get(0)))
            .unwrap();
    assert_eq!(total_fts, 1);

    // Arquivo de mídia original permanece intacto no disco.
    assert_eq!(fs::read(&media_a).unwrap(), b"video-a-bytes");

    // Fonte B e seus dependentes continuam intactos.
    assert_eq!(count_rows("sources", "id=?1", b.source_id), 1);
    assert_eq!(count_rows("transcripts", "id=?1", b.transcript_id), 1);
    assert_eq!(
        count_rows("selection_candidates", "id=?1", b.candidate_id),
        1
    );
    assert_eq!(count_rows("clip_edits", "id=?1", b.clip_id), 1);
    assert_eq!(count_rows("clip_snapshots", "clip_id=?1", b.clip_id), 1);
    assert_eq!(
        count_rows("source_batch_items", "source_id=?1", b.source_id),
        1
    );
    assert_eq!(
        count_rows("export_batch_items", "source_id=?1", b.source_id),
        2
    );
}

#[test]
fn refuses_delete_when_active_or_uncertain_job_exists_for_source() {
    let mut guard = SessionGuard::new();
    guard.create_project("CanalBusy");
    let media = guard.root().join("busy.mp4");
    let media_other = guard.root().join("other.mp4");
    fs::write(&media, b"video").unwrap();
    fs::write(&media_other, b"video2").unwrap();
    let seeded = seed_full_source(&media, "busy");
    let other = seed_full_source(&media_other, "other");

    // Job ativo em outra Fonte não deve bloquear a exclusão desta Fonte.
    with_writer(|c| {
        c.execute(
            "UPDATE jobs SET state='running' WHERE id=?1",
            [other.direct_job_id],
        )?;
        Ok(())
    })
    .unwrap();

    // Testa job direto e job indireto (AI/seleção sem source_id em `jobs`) nos estados ativos.
    for state in ["queued", "running", "uncertain"] {
        with_writer(|c| {
            c.execute(
                "UPDATE jobs SET state=?2 WHERE id=?1",
                (seeded.direct_job_id, state),
            )?;
            Ok(())
        })
        .unwrap();

        let err = run("sources.delete", json!({ "id": seeded.source_id })).unwrap_err();
        assert_eq!(
            err.code, "source_busy",
            "falhou para job direto state={state}"
        );
        assert_eq!(count_rows("sources", "id=?1", seeded.source_id), 1);
        assert_eq!(count_rows("transcripts", "id=?1", seeded.transcript_id), 1);

        with_writer(|c| {
            c.execute(
                "UPDATE jobs SET state='completed' WHERE id=?1",
                [seeded.direct_job_id],
            )?;
            c.execute(
                "UPDATE jobs SET state=?2 WHERE id=?1",
                (seeded.ai_job_id, state),
            )?;
            Ok(())
        })
        .unwrap();

        let err = run("sources.delete", json!({ "id": seeded.source_id })).unwrap_err();
        assert_eq!(
            err.code, "source_busy",
            "falhou para job indireto state={state}"
        );
        assert_eq!(count_rows("sources", "id=?1", seeded.source_id), 1);

        with_writer(|c| {
            c.execute(
                "UPDATE jobs SET state='completed' WHERE id=?1",
                [seeded.ai_job_id],
            )?;
            Ok(())
        })
        .unwrap();
    }

    // Agora que todos os jobs desta Fonte são terminais (outra Fonte segue running), a exclusão deve passar.
    let ok = run("sources.delete", json!({ "id": seeded.source_id })).unwrap();
    assert_eq!(ok["deleted"], true);
    assert_eq!(count_rows("sources", "id=?1", other.source_id), 1);
    assert_foreign_keys_clean();
}

#[test]
fn refuses_missing_source_and_closed_or_wrong_project() {
    let mut guard = SessionGuard::new();
    assert_eq!(
        run("sources.delete", json!({ "id": 1 })).unwrap_err().code,
        "project_not_open"
    );

    let project = guard.create_project("CanalErr");
    assert_eq!(
        run(
            "sources.delete",
            json!({ "project": guard.root().join("Outro.clipes"), "id": 1 })
        )
        .unwrap_err()
        .code,
        "invalid_project"
    );
    assert_eq!(
        run(
            "sources.delete",
            json!({ "project": project, "id": 999999 })
        )
        .unwrap_err()
        .code,
        "source_missing"
    );
}

#[test]
fn v1_fixture_opens_and_supports_source_delete() {
    let mut guard = SessionGuard::new();
    let dir = guard.open_v1_fixture("Antigo");

    let sources = run("sources.list", json!({ "project": dir })).unwrap();
    let first_id = sources.as_array().unwrap()[0]["id"].as_i64().unwrap();

    // Na fixture V1 há um job `queued` ligado à Fonte 1: deve recusar enquanto ativo.
    let busy = run("sources.delete", json!({ "id": first_id })).unwrap_err();
    assert_eq!(busy.code, "source_busy");

    // Após concluir/cancelar o job da Fonte, a exclusão deve funcionar e manter integridade.
    with_writer(|c| {
        c.execute(
            "UPDATE jobs SET state='cancelled' WHERE source_id=?1",
            [first_id],
        )?;
        c.execute_batch("PRAGMA foreign_keys = ON;")?;
        Ok(())
    })
    .unwrap();

    let deleted = run("sources.delete", json!({ "id": first_id })).unwrap();
    assert_eq!(deleted["deleted"], true);
    assert_eq!(deleted["id"], first_id);
    assert_eq!(count_rows("sources", "id=?1", first_id), 0);
    assert_foreign_keys_clean();

    run("projects.close", json!({})).unwrap();
    let conn = Connection::open(dir.join("project.sqlite")).unwrap();
    let integrity: String = conn
        .query_row("PRAGMA integrity_check", [], |r| r.get(0))
        .unwrap();
    assert_eq!(integrity, "ok");
}
