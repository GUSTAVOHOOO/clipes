use crate::{projects, CommandRegistration, CommandResult, EventSink};
use serde_json::{json, Value};
mod ai;
mod budget;
pub(crate) mod preview;
pub mod redo;
pub use ai::{
    enqueue_ai, enqueue_ai_in_batch, enqueue_ai_with_profile, set_ai_provider, set_ai_route,
};
pub(crate) use budget::{audio_precheck, pause as pause_scope};

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
            "UPDATE jobs SET state='running',attempts=attempts+1,result=NULL WHERE id=?1 AND state='queued'",
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
    // Código fixo do erro (nunca texto): o lote de Fontes (#56) lê daqui por que a Fonte parou.
    let code = result.as_ref().err().map(|e| e.code.clone());
    let state = match result {
        Ok(()) => "completed",
        Err(ref e) if e.code == "timeout_uncertain" => "uncertain",
        Err(ref e) if e.code == "cancelled" => "cancelled",
        Err(_) => "failed",
    };
    projects::with_writer(|c| {
        c.execute(
            "UPDATE jobs SET state=?2, progress=CASE WHEN ?2='completed' THEN 100 ELSE progress END, result=COALESCE(result, CASE WHEN ?3 IS NULL THEN NULL ELSE json_object('outcome',?2,'code',?3) END) WHERE id=?1 AND state='running'",
            (id, state, code),
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
        usage: None,
    })?;
    projects::with_writer(|c| {
        c.execute("UPDATE jobs SET state=CASE WHEN state='queued' THEN 'cancelled' ELSE state END, cancel_requested=1 WHERE id=?1 AND state IN ('queued','running')", [id])?;
        Ok(())
    })?;
    Ok(Value::Null)
}
inventory::submit! { CommandRegistration { name: "jobs.cancel", execute: cancel } }

fn uncertain_action(v: Value, repeat: bool) -> CommandResult {
    let id = v["id"].as_i64().ok_or_else(|| crate::CoreError {
        code: "invalid_job".into(),
        message: "Tarefa inválida.".into(),
        usage: None,
    })?;
    // Repetir um modelo local (custo zero) não pede confirmação; o resto, sim (ADR-0005).
    let local = projects::with_reader(|c| {
        c.query_row("SELECT safety FROM jobs WHERE id=?1", [id], |r| {
            r.get::<_, String>(0)
        })
    })
    .is_ok_and(|safety| safety == "local");
    if repeat && !local && v["confirmed"] != true {
        return Err(crate::CoreError {
            code: "confirmation_required".into(),
            message: "Confirme que repetir pode gerar nova cobrança.".into(),
            usage: Some(json!({"estimate": ai::estimate(id)})),
        });
    }
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
            usage: None,
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
        c.execute("UPDATE transcription_calls SET state='uncertain' WHERE state='pending' AND job_id IN (SELECT id FROM jobs WHERE state='running' AND safety='paid')", [])?;
        c.execute("UPDATE jobs SET result='{\"outcome\":\"uncertain\",\"code\":\"interrupted\",\"cost\":\"unknown\"}' WHERE state='running' AND safety='paid' AND kind LIKE 'ai:%'", [])?;
        c.execute("UPDATE jobs SET state=CASE safety WHEN 'local' THEN 'queued' ELSE 'uncertain' END WHERE state='running'", [])?;
        Ok(())
    })
}

/// Cada job traz o lote, o perfil que o serviu e o custo acumulado da sua Tarefa (`taskCost`),
/// do perfil (`profileCost`) e do lote (`batchCost`): `{calls, inputTokens, outputTokens,
/// microUsd, unknownCostCalls, planQuotaCalls, durationMs, costLabel}`. `microUsd` soma só o
/// que tem preço; `costLabel` diz "custo desconhecido" ou "consome a cota do plano" (CLI).
fn list(_: Value, _: &mut EventSink<'_>) -> CommandResult {
    use crate::provider::cost::totals_by;
    let (by_task, by_profile, by_batch) = (
        totals_by("task")?,
        totals_by("profile")?,
        totals_by("batch")?,
    );
    projects::with_reader(|c| {
        let mut s = c.prepare("SELECT id,kind,safety,state,attempts,checkpoint,progress,(SELECT id FROM queue_project_identity),json_extract(result,'$.outcome'),json_extract(result,'$.cost'),batch,(SELECT profile FROM provider_costs WHERE job_id=jobs.id ORDER BY id DESC LIMIT 1),(SELECT reason FROM ai_pauses p WHERE jobs.state='queued' AND ((p.scope='task' AND jobs.kind='ai:'||p.key) OR (p.scope='batch' AND jobs.batch=p.key)) ORDER BY p.scope DESC LIMIT 1) FROM jobs ORDER BY id")?;
        let rows = s.query_map([], |r| {
            let kind = r.get::<_, String>(1)?;
            let batch = r.get::<_, Option<String>>(10)?;
            let profile = r.get::<_, Option<String>>(11)?;
            let pick = |map: &std::collections::HashMap<String, Value>, key: Option<&str>| {
                key.and_then(|k| map.get(k)).cloned().unwrap_or(Value::Null)
            };
            Ok(json!({"id":r.get::<_,i64>(0)?,"kind":kind,"safety":r.get::<_,String>(2)?,"state":r.get::<_,String>(3)?,"attempts":r.get::<_,i64>(4)?,"checkpoint":r.get::<_,Option<String>>(5)?,"progress":r.get::<_,i64>(6)?,"project":r.get::<_,String>(7)?,"outcome":r.get::<_,Option<String>>(8)?,"cost":r.get::<_,Option<String>>(9)?,
                "batch":batch,"profile":profile,"budgetPause":r.get::<_,Option<String>>(12)?,
                "taskCost":pick(&by_task, kind.strip_prefix("ai:")),
                "profileCost":pick(&by_profile, profile.as_deref()),
                "batchCost":pick(&by_batch, batch.as_deref())}))
        })?;
        rows.collect::<rusqlite::Result<Vec<_>>>()
    }).map(|v| json!(v))
}
inventory::submit! { CommandRegistration { name: "jobs.list", execute: list } }
