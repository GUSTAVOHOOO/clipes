//! Bloqueio explícito de Janela `uncertain` em `selection.resume` (#290), compatibilidade de
//! execuções V1 e não-regressão de `selection.redo` com `profileId`.
use clipes_core::{
    dispatch, jobs,
    projects::{with_writer, Migration},
    provider::{CancelToken, Provider, StructuredRequest},
    CoreError,
};
use rusqlite::Connection;
use serde_json::{json, Value};
use std::{
    collections::HashMap,
    sync::{Arc, Mutex},
    time::{Duration, Instant},
};

fn call(name: &str, args: Value) -> Value {
    dispatch(name, args, &mut |_| {}).unwrap()
}

fn fail(name: &str, args: Value) -> CoreError {
    dispatch(name, args, &mut |_| {}).unwrap_err()
}

const SENTENCES: i64 = 240;
const REMOTE: &str = "https://192.0.2.10/v1";
const LOCAL: &str = "http://127.0.0.1:10/v1";

fn seed() -> i64 {
    with_writer(|c| {
        c.execute("INSERT INTO sources(path,size,duration_us,partial_hash,metadata,permission,audio_track) VALUES ('C:/videos/live.mp4',1,2400000000,'h','{}','{}',0)", [])?;
        let source = c.last_insert_rowid();
        c.execute("INSERT INTO transcripts(source_id,audio_track,engine,model,revision,compute_type,state,resume_us,duration_us) VALUES (?1,0,'local','m','r','c','complete',2400000000,2400000000)", [source])?;
        let transcript = c.last_insert_rowid();
        for position in 0..SENTENCES * 10 {
            let text = if position % 10 == 9 {
                " palavra."
            } else {
                " palavra"
            };
            c.execute("INSERT INTO transcript_words(transcript_id,position,kind,text,start_us,end_us,language) VALUES (?1,?2,'word',?3,?4,?5,'pt')", (transcript, position, text, position * 1_000_000, (position + 1) * 1_000_000))?;
        }
        Ok(source)
    })
    .unwrap()
}

fn cand(start: i64, end: i64, score: i64) -> Value {
    let mut c = json!({"startId": start, "endId": end, "title": ""});
    for key in ["hook", "selfContained", "energy", "value", "closing"] {
        c[key] = json!({"score": score, "why": "motivo curto"});
    }
    c
}

fn first_id(transcript: &str) -> i64 {
    transcript
        .lines()
        .find(|l| !l.starts_with('#'))
        .and_then(|l| l.split(' ').next())
        .and_then(|id| id.parse().ok())
        .expect("a window starts with a sentence id")
}

#[derive(Clone)]
enum Answer {
    Candidates(Vec<Value>),
    Error(&'static str),
}

#[derive(Default)]
struct Fake {
    plan: Mutex<HashMap<i64, Answer>>,
    calls: Mutex<Vec<i64>>,
}

impl Fake {
    fn set(&self, plan: Vec<(i64, Answer)>) {
        *self.plan.lock().unwrap() = plan.into_iter().collect();
        self.calls.lock().unwrap().clear();
    }
    fn total(&self) -> usize {
        self.calls.lock().unwrap().len()
    }
    fn calls_of(&self, first: i64) -> usize {
        self.calls
            .lock()
            .unwrap()
            .iter()
            .filter(|id| **id == first)
            .count()
    }
}

impl Provider for Fake {
    fn structured(&self, _: &StructuredRequest) -> Result<Value, CoreError> {
        unreachable!("the executor must use structured_with")
    }
    fn structured_with(
        &self,
        request: &StructuredRequest,
        _: &CancelToken,
    ) -> Result<Value, CoreError> {
        let first = first_id(&request.transcript);
        self.calls.lock().unwrap().push(first);
        match self.plan.lock().unwrap().get(&first).cloned() {
            Some(Answer::Error(code)) => Err(CoreError {
                code: code.into(),
                message: "fixed".into(),
                usage: None,
            }),
            Some(Answer::Candidates(list)) => Ok(
                json!({"data": {"schemaVersion": 1, "candidates": list}, "usage": {"inputTokens": 10, "outputTokens": 5}, "calls": 1}),
            ),
            None => Ok(
                json!({"data": {"schemaVersion": 1, "candidates": []}, "usage": {"inputTokens": 10, "outputTokens": 5}, "calls": 1}),
            ),
        }
    }
}

fn wait(run: i64, what: &str, done: impl Fn(&Value) -> bool) -> Value {
    let deadline = Instant::now() + Duration::from_secs(60);
    loop {
        let value = call("selection.get", json!({"run": run}));
        if done(&value) {
            return value;
        }
        assert!(Instant::now() < deadline, "run {run} never {what}: {value}");
        std::thread::sleep(Duration::from_millis(25));
    }
}

fn job_count() -> usize {
    call("jobs.list", json!({})).as_array().unwrap().len()
}

#[test]
fn selection_resume_blocks_uncertain_resumes_eligible_only_and_keeps_v1_compatible() {
    let root = tempfile::tempdir().unwrap();
    std::env::set_var("CLIPES_DATA_DIR", root.path().join("data"));
    call(
        "projects.create",
        json!({"parent": root.path(), "name": "Canal"}),
    );
    call("channel_profile.set", json!({"maxUs": 180_000_000}));
    let source = seed();
    call("transcription.segment", json!({"source_id": source}));

    call(
        "provider.configure",
        json!({"profileId": "paid", "label": "Pago", "kind": "openai", "endpoint": REMOTE, "model": "paid-model", "context": 32768}),
    );
    call(
        "provider.prices.set",
        json!({"provider": "openai", "model": "paid-model", "inputPerMillion": 100.0, "outputPerMillion": 200.0}),
    );
    call(
        "provider.configure",
        json!({"profileId": "local", "label": "Local", "kind": "openai", "endpoint": LOCAL, "model": "local-model", "context": 32768}),
    );
    call(
        "assistant.task.set",
        json!({"task": "selection", "choice": "profile:paid"}),
    );

    let fake = Arc::new(Fake::default());
    jobs::set_ai_provider(Some(fake.clone()));

    let planned = call("selection.estimate", json!({"source_id": source}))["plan"]["windows"]
        .as_array()
        .unwrap()
        .clone();
    let firsts: Vec<i64> = planned
        .iter()
        .map(|w| w["firstId"].as_i64().unwrap())
        .collect();
    let n = planned.len();
    assert!(n >= 4, "40 min need at least four windows");

    // ---- Caso 1: execução com janela `uncertain` (e outra falha) -> `selection.resume { run }`
    // recusa com `window_uncertain`, mesmo sem `profileId` e sem `confirmed`, sem reenfileirar nada.
    let mut plan: Vec<(i64, Answer)> = firsts
        .iter()
        .map(|&f| (f, Answer::Candidates(vec![])))
        .collect();
    plan[0].1 = Answer::Candidates(vec![cand(10, 11, 8)]);
    plan[1].1 = Answer::Error("invalid_json");
    plan[2].1 = Answer::Error("timeout_uncertain");
    fake.set(plan.clone());

    let run = call(
        "selection.start",
        json!({"source_id": source, "confirmed": true}),
    )["run"]
        .as_i64()
        .unwrap();
    let partial = wait(run, "partial", |v| v["run"]["state"] == "partial");
    let windows = partial["windows"].as_array().unwrap();
    assert_eq!(windows[0]["state"], "completed");
    assert_eq!(windows[1]["state"], "failed");
    assert_eq!(windows[2]["state"], "uncertain");

    let jobs_before = job_count();
    let calls_before = fake.total();

    let err = fail("selection.resume", json!({"run": run}));
    assert_eq!(err.code, "window_uncertain");
    assert_eq!(
        job_count(),
        jobs_before,
        "selection.resume must not enqueue any window (not even failed ones) when uncertain exists"
    );
    assert_eq!(
        fake.total(),
        calls_before,
        "nothing must be sent to provider"
    );

    // ---- Não regressão: `selection.redo` com `profileId` continua recusando `uncertain`.
    let redo_err = fail(
        "selection.redo",
        json!({"run": run, "windows": [2], "profileId": "local", "confirmed": true}),
    );
    assert_eq!(redo_err.code, "window_uncertain");
    assert_eq!(job_count(), jobs_before);
    assert_eq!(fake.total(), calls_before);

    // ---- Caso 2: depois de descartar a incerteza (`jobs.discard` -> cancelled), não há mais
    // `uncertain`; `selection.resume` retoma só as elegíveis (falha + cancelada) sem repetir concluída.
    let job2 = windows[2]["jobId"].as_i64().unwrap();
    call("jobs.discard", json!({"id": job2}));

    plan[1].1 = Answer::Candidates(vec![cand(firsts[1], firsts[1] + 1, 7)]);
    plan[2].1 = Answer::Candidates(vec![]);
    fake.set(plan.clone());

    let resumed = call("selection.resume", json!({"run": run, "confirmed": true}));
    let resumed_windows = resumed["windows"].as_array().unwrap();
    assert_eq!(resumed_windows, &[json!(1), json!(2)]);
    let completed = wait(run, "completed", |v| v["run"]["state"] == "completed");
    assert_eq!(
        fake.calls_of(firsts[0]),
        0,
        "completed window 0 must not be repeated"
    );
    assert_eq!(
        fake.calls_of(firsts[3]),
        0,
        "completed window 3 must not be repeated"
    );
    assert_eq!(fake.calls_of(firsts[1]), 1);
    assert_eq!(fake.calls_of(firsts[2]), 1);
    assert_eq!(completed["candidates"].as_array().unwrap().len(), 2);

    // ---- Caso 3: redo com perfil sobre janela concluída que fica `uncertain` também bloqueia `selection.resume`.
    plan[0].1 = Answer::Error("timeout_uncertain");
    fake.set(plan);
    call(
        "selection.redo",
        json!({"run": run, "windows": [0], "profileId": "paid", "confirmed": true}),
    );
    let after_redo = wait(run, "settled after uncertain redo", |v| {
        v["run"]["state"] != "running"
    });
    assert_eq!(after_redo["windows"][0]["state"], "uncertain");
    let jobs_before = job_count();
    let calls_before = fake.total();
    assert_eq!(
        fail("selection.resume", json!({"run": run})).code,
        "window_uncertain"
    );
    assert_eq!(job_count(), jobs_before);
    assert_eq!(fake.total(), calls_before);

    // ---- Caso 4: compatibilidade V1 — Projeto sem migração `0126_001_selection_redo_profile`
    // abre, carrega `selection.list` / `selection.get` e funciona com `selection.resume`.
    let v1_path = root.path().join("projeto-v1.clipes");
    std::fs::create_dir(&v1_path).unwrap();
    let conn = Connection::open(v1_path.join("project.sqlite")).unwrap();
    conn.execute_batch("CREATE TABLE schema_migrations(id TEXT PRIMARY KEY NOT NULL)")
        .unwrap();
    let mut migrations: Vec<_> = inventory::iter::<Migration>
        .into_iter()
        .filter(|m| m.id != "0126_001_selection_redo_profile")
        .collect();
    migrations.sort_by_key(|m| m.id);
    for migration in migrations {
        conn.execute_batch(migration.sql).unwrap();
        conn.execute("INSERT INTO schema_migrations VALUES (?1)", [migration.id])
            .unwrap();
    }
    conn.execute_batch(
        r#"
INSERT INTO project(name) VALUES ('V1');
INSERT INTO sources(id,path,size,duration_us,partial_hash,metadata,permission,audio_track)
 VALUES (1,'C:/videos/v1.mp4',1,60000000,'h','{}','{}',0);
INSERT INTO transcripts(id,source_id,audio_track,engine,model,revision,compute_type,state,resume_us,duration_us)
 VALUES (1,1,0,'local','m','r','c','complete',60000000,60000000);
INSERT INTO sentences(transcript_id,id,first_position,last_position,start_us,end_us,language,text)
 VALUES
  (1,1,0,9,0,15000000,'pt','Primeira fala v1.'),
  (1,2,10,19,15000000,30000000,'pt','Segunda fala v1.'),
  (1,3,20,29,30000000,45000000,'pt','Terceira fala v1.'),
  (1,4,30,39,45000000,60000000,'pt','Quarta fala v1.');
INSERT INTO jobs(id,kind,safety,state,attempts,progress,cancel_requested,source_id,result)
 VALUES
  (10,'ai:selection','local','completed',1,100,0,1,'{"outcome":"ok","data":{"schemaVersion":1,"candidates":[]}}'),
  (11,'ai:selection','local','failed',1,100,0,1,'{"outcome":"failed","code":"invalid_json"}');
INSERT INTO selection_runs(id,transcript_id,task_version,prompt_sha256,profile,state,batch,min_us,max_us,weights,plan_state,windows_total,windows_completed,windows_failed)
 VALUES (1,1,3,'h','legacy','partial','selection-1',10000000,60000000,'[]','full',2,1,1);
INSERT INTO selection_windows(run_id,idx,first_id,last_id,start_us,end_us,job_id,attempts)
 VALUES
  (1,0,1,2,0,30000000,10,1),
  (1,1,3,4,30000000,60000000,11,1);
"#,
    )
    .unwrap();
    drop(conn);

    call("projects.open", json!({"path": v1_path}));
    let v1_list = call("selection.list", json!({"source_id": 1}));
    assert_eq!(v1_list.as_array().unwrap().len(), 1);
    let v1_run = call("selection.get", json!({"run": 1}));
    assert_eq!(v1_run["run"]["state"], "partial");
    assert_eq!(v1_run["run"]["revision"], 1);
    assert_eq!(v1_run["windows"][1]["state"], "failed");

    call(
        "assistant.task.set",
        json!({"task": "selection", "choice": "profile:local"}),
    );
    fake.set(vec![(3, Answer::Candidates(vec![cand(3, 4, 8)]))]);
    let v1_resumed = call("selection.resume", json!({"run": 1}));
    assert_eq!(v1_resumed["windows"], json!([1]));
    let v1_done = wait(1, "v1 completed", |v| v["run"]["state"] == "completed");
    assert_eq!(v1_done["candidates"].as_array().unwrap().len(), 1);
}
