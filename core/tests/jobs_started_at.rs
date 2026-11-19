//! Contrato de `startedAtMs` e `targetLabel` em `jobs.list` (#303), headless e sem rede.
use clipes_core::{
    dispatch,
    jobs::{self, Safety},
    projects::{with_reader, with_writer, Migration},
};
use rusqlite::Connection;
use serde_json::{json, Value};
use std::{
    ffi::OsString,
    fs,
    path::{Path, PathBuf},
    sync::{Mutex, MutexGuard},
    time::{SystemTime, UNIX_EPOCH},
};

static TEST_LOCK: Mutex<()> = Mutex::new(());
const V1_FIXTURE: &[u8] = include_bytes!("fixtures/project-pre-0104.sqlite");

struct SessionGuard {
    _lock: MutexGuard<'static, ()>,
    prev_data_dir: Option<OsString>,
    _tmp: tempfile::TempDir,
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
        }
    }

    fn root(&self) -> &Path {
        self._tmp.path()
    }

    fn create_project(&self, name: &str) -> PathBuf {
        let created = call(
            "projects.create",
            json!({ "parent": self.root(), "name": name }),
        );
        PathBuf::from(created["path"].as_str().unwrap())
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

fn now_ms() -> i64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap()
        .as_millis() as i64
}

fn find_job(list: &Value, id: i64) -> &Value {
    list.as_array()
        .unwrap()
        .iter()
        .find(|item| item["id"].as_i64() == Some(id))
        .unwrap_or_else(|| panic!("job {id} não encontrado em jobs.list: {list}"))
}

#[test]
fn queued_job_has_null_started_at_and_running_job_exposes_coherent_started_at_ms() {
    let guard = SessionGuard::new();
    guard.create_project("JobsStartedAt");

    let job_id = jobs::enqueue("test", Safety::Local).unwrap();
    let queued_list = call("jobs.list", json!({}));
    let queued_job = find_job(&queued_list, job_id);
    assert_eq!(queued_job["state"], "queued");
    assert_eq!(queued_job["startedAtMs"], Value::Null);
    assert_eq!(queued_job["targetLabel"], Value::Null);

    let before = now_ms();
    assert!(jobs::begin(job_id).unwrap());
    let after = now_ms();

    let running_list = call("jobs.list", json!({}));
    let running_job = find_job(&running_list, job_id);
    assert_eq!(running_job["state"], "running");
    let started_at_ms = running_job["startedAtMs"]
        .as_i64()
        .expect("startedAtMs deve estar preenchido enquanto o job está running");
    assert!(
        started_at_ms >= before && started_at_ms <= after,
        "startedAtMs ({started_at_ms}) fora da janela esperada [{before}, {after}]"
    );

    // Job pago que vai para uncertain e é reenfileirado via jobs.retry volta a ter startedAtMs = null.
    let paid_id = jobs::enqueue("provider", Safety::Paid).unwrap();
    assert!(jobs::begin(paid_id).unwrap());
    jobs::finish(
        paid_id,
        Err(clipes_core::CoreError {
            code: "timeout_uncertain".into(),
            message: "incerto".into(),
            usage: None,
        }),
    )
    .unwrap();
    let uncertain_list = call("jobs.list", json!({}));
    let uncertain_job = find_job(&uncertain_list, paid_id);
    assert_eq!(uncertain_job["state"], "uncertain");
    assert!(uncertain_job["startedAtMs"].as_i64().is_some());

    call("jobs.retry", json!({ "id": paid_id, "confirmed": true }));
    let retried_list = call("jobs.list", json!({}));
    let retried_job = find_job(&retried_list, paid_id);
    assert_eq!(retried_job["state"], "queued");
    assert_eq!(retried_job["startedAtMs"], Value::Null);
}

#[test]
fn jobs_list_exposes_target_label_for_source_and_cut_jobs() {
    let guard = SessionGuard::new();
    guard.create_project("JobsTargetLabel");

    let (
        source_job_id,
        selection_job_id,
        script_job_id,
        packaging_job_id,
        narration_job_id,
        export_job_id,
        generic_job_id,
    ) = with_writer(|c| {
        c.execute(
            "INSERT INTO sources(path,size,duration_us,partial_hash,metadata,permission,audio_track)
             VALUES ('C:/videos/live_sabado.mp4',100,60000000,'h1','{}','{}',0)",
            [],
        )?;
        let source_id = c.last_insert_rowid();

        c.execute(
            "INSERT INTO transcripts(source_id,audio_track,engine,model,revision,compute_type,state,resume_us,duration_us)
             VALUES (?1,0,'local','m','r','c','complete',60000000,60000000)",
            [source_id],
        )?;
        let transcript_id = c.last_insert_rowid();

        c.execute(
            "INSERT INTO sentences(transcript_id,id,first_position,last_position,start_us,end_us,language,text)
             VALUES (?1,1,0,1,0,20000000,'pt','Fala do corte um.'),
                    (?1,2,2,3,20000000,40000000,'pt','Fala do corte dois.')",
            [transcript_id],
        )?;

        c.execute(
            "INSERT INTO selection_runs(transcript_id,task_version,prompt_sha256,profile,state,batch,min_us,max_us,weights,plan_state,windows_total,video_kind)
             VALUES (?1,3,'h','legacy','completed','selection-1',15000000,60000000,'[]','full',1,'transformed')",
            [transcript_id],
        )?;
        let run_id = c.last_insert_rowid();

        c.execute(
            "INSERT INTO selection_candidates(run_id,rank,start_id,end_id,start_us,end_us,axes,total_centi,title,windows)
             VALUES (?1,0,1,1,0,20000000,'{}',900,'Momento épico da live','[0]')",
            [run_id],
        )?;
        let cand1_id = c.last_insert_rowid();

        c.execute(
            "INSERT INTO selection_candidates(run_id,rank,start_id,end_id,start_us,end_us,axes,total_centi,title,windows)
             VALUES (?1,1,2,2,20000000,40000000,'{}',850,'Título inicial','[0]')",
            [run_id],
        )?;
        let cand2_id = c.last_insert_rowid();

        // 1. Job de Fonte (transcription concluída com source_id)
        c.execute(
            "INSERT INTO jobs(kind,safety,state,source_id,progress) VALUES ('transcription','local','completed',?1,100)",
            [source_id],
        )?;
        let source_job_id = c.last_insert_rowid();

        // 2. Job de seleção (ai:selection ligado a selection_windows -> Fonte)
        c.execute(
            "INSERT INTO jobs(kind,safety,state,progress) VALUES ('ai:selection','paid','completed',100)",
            [],
        )?;
        let selection_job_id = c.last_insert_rowid();
        c.execute(
            "INSERT INTO selection_windows(run_id,idx,first_id,last_id,start_us,end_us,job_id) VALUES (?1,0,1,2,0,40000000,?2)",
            (run_id, selection_job_id),
        )?;

        // 3. Job de Corte (ai:script ligado a script_generations -> título do candidato)
        c.execute(
            "INSERT INTO jobs(kind,safety,state,progress) VALUES ('ai:script','paid','completed',100)",
            [],
        )?;
        let script_job_id = c.last_insert_rowid();
        c.execute(
            "INSERT INTO script_generations(job_id,run_id,cand_start_id,cand_end_id,language,task_version,prompt_sha256,safety)
             VALUES (?1,?2,1,1,'pt-BR',1,'h','paid')",
            (script_job_id, run_id),
        )?;

        // 4. Job de Corte com título editado no empacotamento (packaging_edits sobrescreve candidate.title)
        c.execute(
            "INSERT INTO jobs(kind,safety,state,progress) VALUES ('ai:packaging','paid','completed',100)",
            [],
        )?;
        let packaging_job_id = c.last_insert_rowid();
        c.execute(
            "INSERT INTO packaging_generations(job_id,run_id,cand_start_id,cand_end_id,language,task_version,prompt_sha256,generated)
             VALUES (?1,?2,2,2,'pt-BR',1,'h','{\"title\":\"Título gerado\",\"description\":\"d\",\"tags\":[],\"hashtags\":[]}')",
            (packaging_job_id, run_id),
        )?;
        let pkg_gen_id = c.last_insert_rowid();
        c.execute(
            "INSERT INTO packaging_edits(generation_id,fields)
             VALUES (?1,'{\"title\":\"Título final empacotado\",\"description\":\"d\",\"tags\":[],\"hashtags\":[]}')",
            [pkg_gen_id],
        )?;

        // 5. Job de Narração (narration_jobs ligado a candidate_id)
        c.execute(
            "INSERT INTO jobs(kind,safety,state,progress) VALUES ('narration','local','completed',100)",
            [],
        )?;
        let narration_job_id = c.last_insert_rowid();
        c.execute(
            "INSERT INTO narration_jobs(job_id,candidate_id,block_id,voice_id,model_id)
             VALUES (?1,?2,NULL,'v1','m1')",
            (narration_job_id, cand1_id),
        )?;

        // 6. Job de Exportação (exports com candidate_id no request JSON)
        c.execute(
            "INSERT INTO jobs(kind,safety,state,source_id,progress) VALUES ('export','local','completed',?1,100)",
            [source_id],
        )?;
        let export_job_id = c.last_insert_rowid();
        let req_json = json!({
            "source_id": source_id,
            "start_id": 2,
            "end_id": 2,
            "candidate_id": cand2_id,
            "output": "C:/out/corte2.mp4"
        })
        .to_string();
        c.execute(
            "INSERT INTO exports(job_id,request) VALUES (?1,?2)",
            (export_job_id, req_json),
        )?;

        // 7. Job genérico sem alvo
        c.execute(
            "INSERT INTO jobs(kind,safety,state) VALUES ('test','local','queued')",
            [],
        )?;
        let generic_job_id = c.last_insert_rowid();

        Ok((
            source_job_id,
            selection_job_id,
            script_job_id,
            packaging_job_id,
            narration_job_id,
            export_job_id,
            generic_job_id,
        ))
    })
    .unwrap();

    let list = call("jobs.list", json!({}));
    assert_eq!(
        find_job(&list, source_job_id)["targetLabel"],
        "live_sabado.mp4"
    );
    assert_eq!(
        find_job(&list, selection_job_id)["targetLabel"],
        "live_sabado.mp4"
    );
    assert_eq!(
        find_job(&list, script_job_id)["targetLabel"],
        "Momento épico da live"
    );
    assert_eq!(
        find_job(&list, packaging_job_id)["targetLabel"],
        "Título final empacotado"
    );
    assert_eq!(
        find_job(&list, narration_job_id)["targetLabel"],
        "Momento épico da live"
    );
    assert_eq!(
        find_job(&list, export_job_id)["targetLabel"],
        "Título final empacotado"
    );
    assert_eq!(find_job(&list, generic_job_id)["targetLabel"], Value::Null);
}

#[test]
fn v1_project_without_started_at_column_opens_and_lists_with_null() {
    let guard = SessionGuard::new();

    // 1. Fixture real V1 pré-0104 abre e lista jobs sem erro.
    let fixture_dir = guard.root().join("FixtureV1.clipes");
    fs::create_dir_all(&fixture_dir).unwrap();
    fs::write(fixture_dir.join("project.sqlite"), V1_FIXTURE).unwrap();
    call("projects.open", json!({ "path": fixture_dir }));
    let fixture_jobs = call("jobs.list", json!({}));
    assert!(fixture_jobs.is_array());
    call("projects.close", json!({}));

    // 2. Projeto V1 construído exatamente antes da migração `0303_001_jobs_started_at`.
    let legacy_dir = guard.root().join("LegadoJobs.clipes");
    fs::create_dir_all(&legacy_dir).unwrap();
    let conn = Connection::open(legacy_dir.join("project.sqlite")).unwrap();
    conn.execute_batch("CREATE TABLE schema_migrations(id TEXT PRIMARY KEY NOT NULL)")
        .unwrap();
    let mut migrations: Vec<_> = inventory::iter::<Migration>
        .into_iter()
        .filter(|m| m.id != "0303_001_jobs_started_at")
        .collect();
    migrations.sort_by_key(|m| m.id);
    for migration in migrations {
        conn.execute_batch(migration.sql).unwrap();
        conn.execute("INSERT INTO schema_migrations VALUES (?1)", [migration.id])
            .unwrap();
    }
    conn.execute_batch(
        r#"
INSERT INTO project(name) VALUES ('LegadoJobs');
INSERT INTO sources(id,path,size,duration_us,partial_hash,metadata,permission,audio_track)
 VALUES (1,'/media/live_v1.mp4',1,60000000,'h','{}','{}',0);
INSERT INTO jobs(id,kind,safety,state,attempts,progress,source_id)
 VALUES (1,'transcription','local','completed',1,100,1);
INSERT INTO jobs(id,kind,safety,state,attempts,progress,source_id)
 VALUES (2,'test','local','queued',0,0,NULL);
"#,
    )
    .unwrap();
    drop(conn);

    call("projects.open", json!({ "path": legacy_dir }));

    let migration_count: i64 = with_reader(|c| {
        c.query_row(
            "SELECT COUNT(*) FROM schema_migrations WHERE id='0303_001_jobs_started_at'",
            [],
            |r| r.get(0),
        )
    })
    .unwrap();
    assert_eq!(migration_count, 1);

    let list = call("jobs.list", json!({}));
    let old_completed = find_job(&list, 1);
    assert_eq!(old_completed["startedAtMs"], Value::Null);
    assert_eq!(old_completed["targetLabel"], "live_v1.mp4");

    let old_queued = find_job(&list, 2);
    assert_eq!(old_queued["startedAtMs"], Value::Null);
    assert_eq!(old_queued["targetLabel"], Value::Null);

    // Novo job iniciado após migração preenche startedAtMs normalmente.
    let new_id = jobs::enqueue("test", Safety::Local).unwrap();
    assert!(jobs::begin(new_id).unwrap());
    let updated = call("jobs.list", json!({}));
    assert!(find_job(&updated, new_id)["startedAtMs"].as_i64().is_some());
}

#[test]
fn reframe_requeue_clears_started_at_ms_in_db_and_jobs_list() {
    let guard = SessionGuard::new();
    guard.create_project("ReframeRequeue");

    let (source_id, job_id) = with_writer(|c| {
        c.execute(
            "INSERT INTO sources(path,size,duration_us,partial_hash,metadata,permission,audio_track)
             VALUES ('C:/videos/reframe.mp4',100,60000000,'h1','{}','{}',0)",
            [],
        )?;
        let source_id = c.last_insert_rowid();
        // safety='paid' evita disputa com o worker em background após reframe.start reenfileirar o job.
        c.execute(
            "INSERT INTO jobs(kind,safety,state,source_id) VALUES ('reframe','paid','queued',?1)",
            [source_id],
        )?;
        let job_id = c.last_insert_rowid();
        c.execute(
            "INSERT INTO reframe_suggestions(job_id,source_id,candidate_id,start_us,end_us,layout,split_ratio)
             VALUES (?1,?2,NULL,0,10000000,'face',NULL)",
            (job_id, source_id),
        )?;
        Ok((source_id, job_id))
    })
    .unwrap();

    assert!(jobs::begin(job_id).unwrap());
    let running_list = call("jobs.list", json!({}));
    let running_job = find_job(&running_list, job_id);
    assert_eq!(running_job["state"], "running");
    assert!(running_job["startedAtMs"].as_i64().is_some());

    jobs::finish(
        job_id,
        Err(clipes_core::CoreError {
            code: "reframe_failed".into(),
            message: "falha simulada".into(),
            usage: None,
        }),
    )
    .unwrap();

    let status = call(
        "reframe.start",
        json!({
            "requested": true,
            "source": source_id,
            "startUs": 0,
            "endUs": 10_000_000
        }),
    );
    assert_eq!(status["state"], "queued");

    let requeued_list = call("jobs.list", json!({}));
    let requeued_job = find_job(&requeued_list, job_id);
    assert_eq!(requeued_job["state"], "queued");
    assert_eq!(requeued_job["startedAtMs"], Value::Null);

    let db_started_at: Option<i64> = with_reader(|c| {
        c.query_row(
            "SELECT started_at_ms FROM jobs WHERE id=?1",
            [job_id],
            |r| r.get(0),
        )
    })
    .unwrap();
    assert_eq!(
        db_started_at, None,
        "reframe.rs deve limpar started_at_ms no banco ao retornar o job para queued"
    );
}
