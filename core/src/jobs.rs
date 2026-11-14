use crate::{projects, CommandRegistration, CommandResult, EventSink};
use serde_json::{json, Value};
mod preview;

#[derive(Clone, Copy)]
pub enum Safety {
    Local,
    Paid,
}

pub fn enqueue(kind: &str, safety: Safety) -> Result<i64, crate::CoreError> {
    let safety = match safety {
        Safety::Local => "local",
        Safety::Paid => "paid",
    };
    projects::with_writer(|c| {
        c.execute(
            "INSERT INTO jobs(kind,safety,state) VALUES (?1,?2,'queued')",
            (kind, safety),
        )?;
        Ok(c.last_insert_rowid())
    })
}

pub fn begin(id: i64) -> Result<bool, crate::CoreError> {
    projects::with_writer(|c| {
        Ok(c.execute(
            "UPDATE jobs SET state='running',attempts=attempts+1 WHERE id=?1 AND state='queued'",
            [id],
        )? == 1)
    })
}

pub fn checkpoint(id: i64, checkpoint: &str) -> Result<(), crate::CoreError> {
    projects::with_writer(|c| {
        c.execute(
            "UPDATE jobs SET checkpoint=?2 WHERE id=?1 AND state='running'",
            (id, checkpoint),
        )?;
        Ok(())
    })
}

/// Records an execution result; a provider timeout may have incurred a charge.
pub fn finish(id: i64, result: Result<(), crate::CoreError>) -> Result<(), crate::CoreError> {
    let state = match result {
        Ok(()) => "completed",
        Err(ref e) if e.code == "timeout_uncertain" => "uncertain",
        Err(ref e) if e.code == "cancelled" => "cancelled",
        Err(_) => "failed",
    };
    projects::with_writer(|c| {
        c.execute(
            "UPDATE jobs SET state=?2, progress=CASE WHEN ?2='completed' THEN 100 ELSE progress END WHERE id=?1 AND state='running'",
            (id, state),
        )?;
        Ok(())
    })
}

inventory::submit! { projects::Migration { id: "0044_001_jobs", sql: "CREATE TABLE jobs (id INTEGER PRIMARY KEY, kind TEXT NOT NULL, safety TEXT NOT NULL CHECK(safety IN ('local','paid')), state TEXT NOT NULL CHECK(state IN ('queued','running','uncertain','completed','cancelled','failed')), attempts INTEGER NOT NULL DEFAULT 0, checkpoint TEXT, progress INTEGER NOT NULL DEFAULT 0, cancel_requested INTEGER NOT NULL DEFAULT 0, source_id INTEGER); CREATE TABLE queue_project_identity (id TEXT NOT NULL); INSERT INTO queue_project_identity VALUES (lower(hex(randomblob(16))));" } }

struct Worker {
    stop: std::sync::Arc<std::sync::atomic::AtomicBool>,
    thread: std::thread::JoinHandle<()>,
}
fn worker() -> &'static std::sync::Mutex<Option<Worker>> {
    static WORKER: std::sync::OnceLock<std::sync::Mutex<Option<Worker>>> =
        std::sync::OnceLock::new();
    WORKER.get_or_init(|| std::sync::Mutex::new(None))
}
pub(crate) fn stop_worker() {
    if let Ok(mut guard) = worker().lock() {
        if let Some(worker) = guard.take() {
            worker.stop.store(true, std::sync::atomic::Ordering::SeqCst);
            let _ = worker.thread.join();
        }
    }
}
pub(crate) fn start_worker(project: std::path::PathBuf) {
    let mut guard = worker().lock().unwrap();
    if guard.is_some() {
        return;
    }
    let stop = std::sync::Arc::new(std::sync::atomic::AtomicBool::new(false));
    let thread_stop = stop.clone();
    let thread = std::thread::spawn(move || preview::run_queue(project, thread_stop));
    *guard = Some(Worker { stop, thread });
}

pub fn progress(
    id: i64,
    stage: &str,
    percentage: u8,
    message: &str,
) -> Result<(), crate::CoreError> {
    let project = projects::with_writer(|c| {
        c.execute(
            "UPDATE jobs SET progress=?2 WHERE id=?1 AND state='running'",
            (id, percentage.min(100)),
        )?;
        c.query_row("SELECT id FROM queue_project_identity", [], |r| {
            r.get::<_, String>(0)
        })
    })?;
    crate::emit_background(crate::ProgressEvent {
        job: id.to_string(),
        project: Some(project),
        stage: stage.into(),
        percentage: percentage.min(100),
        message: message.into(),
        error: None,
    });
    Ok(())
}

fn cancel(v: Value, _: &mut EventSink<'_>) -> CommandResult {
    let id = v["id"].as_i64().ok_or_else(|| crate::CoreError {
        code: "invalid_job".into(),
        message: "Tarefa inválida.".into(),
    })?;
    projects::with_writer(|c| {
        c.execute("UPDATE jobs SET state=CASE WHEN state='queued' THEN 'cancelled' ELSE state END, cancel_requested=1 WHERE id=?1 AND state IN ('queued','running')", [id])?;
        Ok(())
    })?;
    Ok(Value::Null)
}
inventory::submit! { CommandRegistration { name: "jobs.cancel", execute: cancel } }

fn uncertain_action(v: Value, repeat: bool) -> CommandResult {
    if repeat && v["confirmed"] != true {
        return Err(crate::CoreError {
            code: "confirmation_required".into(),
            message: "Confirme que repetir pode gerar nova cobrança.".into(),
        });
    }
    let id = v["id"].as_i64().ok_or_else(|| crate::CoreError {
        code: "invalid_job".into(),
        message: "Tarefa inválida.".into(),
    })?;
    let changed = projects::with_writer(|c| {
        c.execute(
            "UPDATE jobs SET state=?2, cancel_requested=0 WHERE id=?1 AND state='uncertain'",
            (id, if repeat { "queued" } else { "cancelled" }),
        )
    })?;
    if changed != 1 {
        return Err(crate::CoreError {
            code: "invalid_job_state".into(),
            message: "A tarefa não está em estado incerto.".into(),
        });
    }
    Ok(Value::Null)
}
fn retry(v: Value, _: &mut EventSink<'_>) -> CommandResult {
    uncertain_action(v, true)
}
fn discard(v: Value, _: &mut EventSink<'_>) -> CommandResult {
    uncertain_action(v, false)
}
inventory::submit! { CommandRegistration { name: "jobs.retry", execute: retry } }
inventory::submit! { CommandRegistration { name: "jobs.discard", execute: discard } }

pub(crate) fn reconcile() -> Result<(), crate::CoreError> {
    projects::with_writer(|c| {
        c.execute("UPDATE jobs SET state=CASE safety WHEN 'local' THEN 'queued' ELSE 'uncertain' END WHERE state='running'", [])?;
        Ok(())
    })
}

fn list(_: Value, _: &mut EventSink<'_>) -> CommandResult {
    projects::with_reader(|c| {
        let mut s = c.prepare("SELECT id,kind,safety,state,attempts,checkpoint,progress,(SELECT id FROM queue_project_identity) FROM jobs ORDER BY id")?;
        let rows = s.query_map([], |r| Ok(json!({"id":r.get::<_,i64>(0)?,"kind":r.get::<_,String>(1)?,"safety":r.get::<_,String>(2)?,"state":r.get::<_,String>(3)?,"attempts":r.get::<_,i64>(4)?,"checkpoint":r.get::<_,Option<String>>(5)?,"progress":r.get::<_,i64>(6)?,"project":r.get::<_,String>(7)?})))?;
        rows.collect::<rusqlite::Result<Vec<_>>>()
    }).map(|v| json!(v))
}
inventory::submit! { CommandRegistration { name: "jobs.list", execute: list } }
