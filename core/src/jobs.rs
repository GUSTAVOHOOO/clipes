use crate::{projects, CommandRegistration, CommandResult, EventSink};
use rusqlite::{Connection, OptionalExtension};
use serde_json::{json, Value};
mod ai;
mod budget;
pub(crate) use ai::confirmation_error;
pub(crate) mod preview;
pub mod redo;
pub use ai::{
    enqueue_ai, enqueue_ai_in_batch, enqueue_ai_with_profile, enqueue_checked, estimate_units,
    outcome_codes, resolve_route, set_ai_provider, set_ai_route, AiRoute, EnqueueAiRequest,
    JobOutcomeCodes, ProfileSummary,
};
pub(crate) use budget::{audio_precheck, pause as pause_scope};

fn now_epoch_ms() -> i64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| i64::try_from(d.as_millis()).unwrap_or(i64::MAX))
        .unwrap_or(0)
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
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
    let started_at_ms = now_epoch_ms();
    projects::with_writer(|c| {
        Ok(c.execute(
            "UPDATE jobs SET state='running',attempts=attempts+1,result=NULL,started_at_ms=?2 WHERE id=?1 AND state='queued'",
            (id, started_at_ms),
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
inventory::submit! { projects::Migration { id: "0303_001_jobs_started_at", sql: "ALTER TABLE jobs ADD COLUMN started_at_ms INTEGER;" } }

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
            "UPDATE jobs SET state=?2, cancel_requested=0, started_at_ms=CASE WHEN ?2='queued' THEN NULL ELSE started_at_ms END WHERE id=?1 AND state='uncertain'",
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
        c.execute("UPDATE jobs SET state=CASE safety WHEN 'local' THEN 'queued' ELSE 'uncertain' END, started_at_ms=CASE safety WHEN 'local' THEN NULL ELSE started_at_ms END WHERE state='running'", [])?;
        Ok(())
    })
}

fn non_empty_trimmed(value: Option<String>) -> Option<String> {
    value.map(|s| s.trim().to_owned()).filter(|s| !s.is_empty())
}

fn basename(path: &str) -> Option<String> {
    path.rsplit(['/', '\\'])
        .map(str::trim)
        .find(|s| !s.is_empty())
        .map(str::to_owned)
}

fn source_label(c: &Connection, source_id: i64) -> Option<String> {
    let path: Option<String> = c
        .query_row("SELECT path FROM sources WHERE id=?1", [source_id], |r| {
            r.get(0)
        })
        .optional()
        .ok()
        .flatten();
    path.as_deref().and_then(basename)
}

fn source_label_for_run(c: &Connection, run_id: i64) -> Option<String> {
    let path: Option<String> = c
        .query_row(
            "SELECT s.path
             FROM selection_runs r
             JOIN transcripts t ON t.id = r.transcript_id
             JOIN sources s ON s.id = t.source_id
             WHERE r.id = ?1",
            [run_id],
            |r| r.get(0),
        )
        .optional()
        .ok()
        .flatten();
    path.as_deref().and_then(basename)
}

fn packaging_title_for_cut(
    c: &Connection,
    run_id: i64,
    start_id: i64,
    end_id: i64,
) -> Option<String> {
    let title: Option<String> = c
        .query_row(
            "SELECT COALESCE(
                NULLIF(TRIM((SELECT json_extract(pe.fields, '$.title')
                             FROM packaging_edits pe
                             WHERE pe.generation_id = pg.id
                             ORDER BY pe.id DESC LIMIT 1)), ''),
                NULLIF(TRIM(json_extract(pg.generated, '$.title')), ''),
                CASE WHEN j.state = 'completed'
                     THEN NULLIF(TRIM(json_extract(j.result, '$.data.title')), '')
                     ELSE NULL END
            )
            FROM packaging_generations pg
            LEFT JOIN jobs j ON j.id = pg.job_id
            WHERE pg.run_id = ?1 AND pg.cand_start_id = ?2 AND pg.cand_end_id = ?3
              AND (pg.generated IS NOT NULL OR j.state = 'completed')
            ORDER BY pg.id DESC LIMIT 1",
            (run_id, start_id, end_id),
            |r| r.get(0),
        )
        .optional()
        .ok()
        .flatten();
    non_empty_trimmed(title)
}

fn cut_label_by_run_identity(
    c: &Connection,
    run_id: i64,
    start_id: i64,
    end_id: i64,
) -> Option<String> {
    if let Some(title) = packaging_title_for_cut(c, run_id, start_id, end_id) {
        return Some(title);
    }
    let cand_title: Option<String> = c
        .query_row(
            "SELECT NULLIF(TRIM(sc.title), '')
             FROM selection_candidates sc
             JOIN selection_runs sr ON sr.id = sc.run_id
             WHERE sc.run_id = ?1 AND sc.start_id = ?2 AND sc.end_id = ?3
             ORDER BY (sc.revision = sr.revision) DESC, sc.id DESC
             LIMIT 1",
            (run_id, start_id, end_id),
            |r| r.get(0),
        )
        .optional()
        .ok()
        .flatten();
    non_empty_trimmed(cand_title).or_else(|| source_label_for_run(c, run_id))
}

fn cut_label_by_candidate(c: &Connection, candidate_id: i64) -> Option<String> {
    let row: Option<(i64, i64, i64, String)> = c
        .query_row(
            "SELECT run_id, start_id, end_id, title FROM selection_candidates WHERE id=?1",
            [candidate_id],
            |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?, r.get(3)?)),
        )
        .optional()
        .ok()
        .flatten();
    let (run_id, start_id, end_id, title) = row?;
    packaging_title_for_cut(c, run_id, start_id, end_id)
        .or_else(|| non_empty_trimmed(Some(title)))
        .or_else(|| source_label_for_run(c, run_id))
}

fn cut_label_by_clip(c: &Connection, clip_id: i64) -> Option<String> {
    let identity: Option<String> = c
        .query_row(
            "SELECT identity FROM clip_edits WHERE id=?1",
            [clip_id],
            |r| r.get(0),
        )
        .optional()
        .ok()
        .flatten();
    let identity = identity?;
    if let Some(cand_id) = identity
        .strip_prefix("candidate:")
        .and_then(|s| s.parse::<i64>().ok())
    {
        return cut_label_by_candidate(c, cand_id);
    }
    if let Some(src_id) = identity
        .strip_prefix("source:")
        .and_then(|s| s.split(':').next())
        .and_then(|s| s.parse::<i64>().ok())
    {
        return source_label(c, src_id);
    }
    None
}

fn run_identity_pair(c: &Connection, sql: &str, job_id: i64) -> Option<(i64, i64, i64)> {
    c.query_row(sql, [job_id], |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?)))
        .optional()
        .ok()
        .flatten()
}

fn single_i64(c: &Connection, sql: &str, job_id: i64) -> Option<i64> {
    c.query_row(sql, [job_id], |r| r.get(0))
        .optional()
        .ok()
        .flatten()
}

fn target_label(c: &Connection, job_id: i64, kind: &str, source_id: Option<i64>) -> Option<String> {
    let resolved = match kind {
        "export" => {
            let req_raw: Option<String> = c
                .query_row(
                    "SELECT request FROM exports WHERE job_id=?1",
                    [job_id],
                    |r| r.get(0),
                )
                .optional()
                .ok()
                .flatten();
            let req = req_raw
                .as_deref()
                .and_then(|raw| serde_json::from_str::<Value>(raw).ok());
            let from_candidate = req
                .as_ref()
                .and_then(|v| v["candidate_id"].as_i64())
                .and_then(|cid| cut_label_by_candidate(c, cid));
            let from_clip = || {
                req.as_ref()
                    .and_then(|v| v["clip_id"].as_i64())
                    .and_then(|cid| cut_label_by_clip(c, cid))
            };
            let from_batch_item = || {
                let title: Option<String> = c
                    .query_row(
                        "SELECT title FROM export_batch_items WHERE job_id=?1 LIMIT 1",
                        [job_id],
                        |r| r.get(0),
                    )
                    .optional()
                    .ok()
                    .flatten();
                non_empty_trimmed(title)
            };
            let from_req_source = || {
                req.as_ref()
                    .and_then(|v| v["source_id"].as_i64())
                    .and_then(|sid| source_label(c, sid))
            };
            from_candidate
                .or_else(from_clip)
                .or_else(from_batch_item)
                .or_else(from_req_source)
        }
        "ai:angles" => run_identity_pair(
            c,
            "SELECT run_id, cand_start_id, cand_end_id FROM angle_generations WHERE job_id=?1",
            job_id,
        )
        .and_then(|(r, s, e)| cut_label_by_run_identity(c, r, s, e)),
        "ai:script" => run_identity_pair(
            c,
            "SELECT run_id, cand_start_id, cand_end_id FROM script_generations WHERE job_id=?1",
            job_id,
        )
        .and_then(|(r, s, e)| cut_label_by_run_identity(c, r, s, e)),
        "ai:script_block" => run_identity_pair(
            c,
            "SELECT g.run_id, g.cand_start_id, g.cand_end_id
             FROM script_block_versions v
             JOIN script_blocks b ON b.id = v.block_id
             JOIN script_generations g ON g.id = b.generation_id
             WHERE v.job_id = ?1",
            job_id,
        )
        .and_then(|(r, s, e)| cut_label_by_run_identity(c, r, s, e)),
        "ai:packaging" => run_identity_pair(
            c,
            "SELECT run_id, cand_start_id, cand_end_id FROM packaging_generations WHERE job_id=?1",
            job_id,
        )
        .and_then(|(r, s, e)| cut_label_by_run_identity(c, r, s, e)),
        "ai:thumbnail" => run_identity_pair(
            c,
            "SELECT run_id, cand_start_id, cand_end_id FROM thumbnail_suggestions WHERE job_id=?1",
            job_id,
        )
        .and_then(|(r, s, e)| cut_label_by_run_identity(c, r, s, e)),
        "ai:translation" => single_i64(
            c,
            "SELECT r.clip_id
             FROM translation_run_jobs j
             JOIN translation_runs r ON r.id = j.run_id
             WHERE j.job_id = ?1",
            job_id,
        )
        .and_then(|clip_id| cut_label_by_clip(c, clip_id)),
        "ai:selection" | "ai:selection_transformed" => {
            let path: Option<String> = c
                .query_row(
                    "SELECT s.path
                     FROM selection_windows w
                     JOIN selection_runs r ON r.id = w.run_id
                     JOIN transcripts t ON t.id = r.transcript_id
                     JOIN sources s ON s.id = t.source_id
                     WHERE w.job_id = ?1 OR w.prev_job_id = ?1
                     LIMIT 1",
                    [job_id],
                    |r| r.get(0),
                )
                .optional()
                .ok()
                .flatten();
            path.as_deref().and_then(basename)
        }
        "narration" => single_i64(
            c,
            "SELECT candidate_id FROM narration_jobs WHERE job_id=?1",
            job_id,
        )
        .and_then(|cid| cut_label_by_candidate(c, cid)),
        "narration_align" => single_i64(
            c,
            "SELECT candidate_id FROM narration_align_jobs WHERE job_id=?1",
            job_id,
        )
        .and_then(|cid| cut_label_by_candidate(c, cid)),
        "narration_import" => single_i64(
            c,
            "SELECT candidate_id FROM narration_import_jobs WHERE job_id=?1",
            job_id,
        )
        .and_then(|cid| cut_label_by_candidate(c, cid)),
        "reframe" => {
            let row: Option<(Option<i64>, i64)> = c
                .query_row(
                    "SELECT candidate_id, source_id FROM reframe_suggestions WHERE job_id=?1",
                    [job_id],
                    |r| Ok((r.get(0)?, r.get(1)?)),
                )
                .optional()
                .ok()
                .flatten();
            row.and_then(|(cand_id, src_id)| {
                cand_id
                    .and_then(|cid| cut_label_by_candidate(c, cid))
                    .or_else(|| source_label(c, src_id))
            })
        }
        _ => None,
    };
    resolved.or_else(|| source_id.and_then(|sid| source_label(c, sid)))
}

struct JobRow {
    id: i64,
    kind: String,
    safety: String,
    state: String,
    attempts: i64,
    checkpoint: Option<String>,
    progress: i64,
    project: String,
    outcome: Option<String>,
    cost: Option<String>,
    batch: Option<String>,
    profile: Option<String>,
    budget_pause: Option<String>,
    started_at_ms: Option<i64>,
    source_id: Option<i64>,
}

/// Cada job traz o lote, o perfil que o serviu, o início da execução (`startedAtMs`), o rótulo
/// legível do alvo (`targetLabel`) e o custo acumulado da sua Tarefa (`taskCost`), do perfil
/// (`profileCost`) e do lote (`batchCost`): `{calls, inputTokens, outputTokens, microUsd,
/// unknownCostCalls, planQuotaCalls, durationMs, costLabel}`. `microUsd` soma só o que tem preço;
/// `costLabel` diz "custo desconhecido" ou "consome a cota do plano" (CLI).
fn list(_: Value, _: &mut EventSink<'_>) -> CommandResult {
    use crate::provider::cost::totals_by;
    let (by_task, by_profile, by_batch) = (
        totals_by("task")?,
        totals_by("profile")?,
        totals_by("batch")?,
    );
    projects::with_reader(|c| {
        let mut s = c.prepare("SELECT id,kind,safety,state,attempts,checkpoint,progress,(SELECT id FROM queue_project_identity),json_extract(result,'$.outcome'),json_extract(result,'$.cost'),batch,(SELECT profile FROM provider_costs WHERE job_id=jobs.id ORDER BY id DESC LIMIT 1),(SELECT reason FROM ai_pauses p WHERE jobs.state='queued' AND ((p.scope='task' AND jobs.kind='ai:'||p.key) OR (p.scope='batch' AND jobs.batch=p.key)) ORDER BY p.scope DESC LIMIT 1),CASE WHEN state='queued' THEN NULL ELSE started_at_ms END,source_id FROM jobs ORDER BY id")?;
        let rows = s
            .query_map([], |r| {
                Ok(JobRow {
                    id: r.get(0)?,
                    kind: r.get(1)?,
                    safety: r.get(2)?,
                    state: r.get(3)?,
                    attempts: r.get(4)?,
                    checkpoint: r.get(5)?,
                    progress: r.get(6)?,
                    project: r.get(7)?,
                    outcome: r.get(8)?,
                    cost: r.get(9)?,
                    batch: r.get(10)?,
                    profile: r.get(11)?,
                    budget_pause: r.get(12)?,
                    started_at_ms: r.get(13)?,
                    source_id: r.get(14)?,
                })
            })?
            .collect::<rusqlite::Result<Vec<_>>>()?;
        let pick = |map: &std::collections::HashMap<String, Value>, key: Option<&str>| {
            key.and_then(|k| map.get(k)).cloned().unwrap_or(Value::Null)
        };
        Ok(rows
            .into_iter()
            .map(|row| {
                let target_label = target_label(c, row.id, &row.kind, row.source_id);
                json!({
                    "id": row.id,
                    "kind": row.kind,
                    "safety": row.safety,
                    "state": row.state,
                    "attempts": row.attempts,
                    "checkpoint": row.checkpoint,
                    "progress": row.progress,
                    "project": row.project,
                    "outcome": row.outcome,
                    "cost": row.cost,
                    "batch": row.batch,
                    "profile": row.profile,
                    "budgetPause": row.budget_pause,
                    "startedAtMs": row.started_at_ms,
                    "targetLabel": target_label,
                    "taskCost": pick(&by_task, row.kind.strip_prefix("ai:")),
                    "profileCost": pick(&by_profile, row.profile.as_deref()),
                    "batchCost": pick(&by_batch, row.batch.as_deref()),
                })
            })
            .collect::<Vec<_>>())
    }).map(|v| json!(v))
}
inventory::submit! { CommandRegistration { name: "jobs.list", execute: list } }
