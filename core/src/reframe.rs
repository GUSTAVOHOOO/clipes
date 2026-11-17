//! Sugestão local de reenquadramento dos Cortes escolhidos (#60).
//! Nenhum Provedor é chamado; o veto somente local é preservado por construção.
use crate::{
    components,
    jobs::{self, preview},
    projects,
    provider::CancelToken,
    worker::WorkerEvent,
    CommandRegistration, CommandResult, CoreError, EventSink,
};
use rusqlite::OptionalExtension;
use serde_json::{json, Value};
use std::{
    path::Path,
    sync::atomic::{AtomicBool, Ordering},
    time::Duration,
};

mod timeline;

inventory::submit! { projects::Migration { id: "0060_001_reframe", sql: "
CREATE TABLE reframe_suggestions (
  id INTEGER PRIMARY KEY,
  job_id INTEGER NOT NULL UNIQUE REFERENCES jobs(id),
  source_id INTEGER NOT NULL REFERENCES sources(id),
  candidate_id INTEGER,
  start_us INTEGER NOT NULL CHECK(start_us >= 0),
  end_us INTEGER NOT NULL CHECK(end_us > start_us),
  timeline TEXT,
  error_code TEXT,
  UNIQUE(source_id,start_us,end_us)
);
" } }

inventory::submit! { projects::Migration { id: "0078_001_reframe_layout", sql: "
ALTER TABLE reframe_suggestions ADD COLUMN layout TEXT NOT NULL DEFAULT 'face';
ALTER TABLE reframe_suggestions ADD COLUMN split_ratio REAL;
ALTER TABLE reframe_suggestions ADD COLUMN secondary_timeline TEXT;
" } }

fn error(code: &str, message: &str) -> CoreError {
    CoreError {
        code: code.into(),
        message: message.into(),
        usage: None,
    }
}
fn invalid() -> CoreError {
    error("invalid_reframe", "Intervalo de análise inválido.")
}
fn not_chosen() -> CoreError {
    error(
        "reframe_not_chosen",
        "Escolha o Corte antes de analisar o enquadramento.",
    )
}
fn protocol() -> CoreError {
    error(
        "worker_protocol",
        "O worker enviou uma mensagem fora do protocolo.",
    )
}

/// Reutiliza a revisão atual do #55, inclusive as bordas ajustadas por Frase.
fn approved(candidate: i64) -> Result<(i64, i64, i64), CoreError> {
    let row = projects::with_reader(|c| c.query_row(
        "SELECT c.run_id,t.source_id FROM selection_candidates c JOIN selection_runs r ON r.id=c.run_id JOIN transcripts t ON t.id=r.transcript_id WHERE c.id=?1",
        [candidate], |r| Ok((r.get::<_,i64>(0)?, r.get::<_,i64>(1)?))).optional())?
        .ok_or_else(not_chosen)?;
    let review = crate::dispatch("selection.review", json!({"run":row.0}), &mut |_| {})?;
    let item = review["items"]
        .as_array()
        .and_then(|items| items.iter().find(|i| i["candidate"] == candidate))
        .filter(|i| i["status"] == "approved")
        .ok_or_else(not_chosen)?;
    Ok((
        row.1,
        item["startUs"].as_i64().ok_or_else(invalid)?,
        item["endUs"].as_i64().ok_or_else(invalid)?,
    ))
}

fn start(v: Value, _: &mut EventSink<'_>) -> CommandResult {
    let _guard = projects::start_job()?;
    let candidate = v
        .get("candidate")
        .map(|v| v.as_i64().ok_or_else(invalid))
        .transpose()?;
    let (source, start, end) = if let Some(id) = candidate {
        if v.get("source").is_some() || v.get("startUs").is_some() || v.get("endUs").is_some() {
            return Err(invalid());
        }
        approved(id)?
    } else {
        if v["requested"] != true {
            return Err(not_chosen());
        }
        (
            v["source"].as_i64().ok_or_else(invalid)?,
            v["startUs"].as_i64().ok_or_else(invalid)?,
            v["endUs"].as_i64().ok_or_else(invalid)?,
        )
    };
    let duration = projects::with_reader(|c| {
        c.query_row(
            "SELECT duration_us FROM sources WHERE id=?1",
            [source],
            |r| r.get::<_, i64>(0),
        )
        .optional()
    })?
    .ok_or_else(invalid)?;
    if start < 0 || end <= start || end > duration {
        return Err(invalid());
    }
    let force = v["force"].as_bool().unwrap_or(false);
    let layout = match v.get("layout").and_then(Value::as_str) {
        None => "face",
        Some(l @ ("face" | "gameplay_webcam" | "two_people")) => l,
        Some(_) => return Err(invalid()),
    };
    let split_ratio = match v.get("splitRatio").or_else(|| v.get("split_ratio")) {
        None | Some(Value::Null) => None,
        Some(raw) => {
            let ratio = raw.as_f64().ok_or_else(invalid)?;
            if !ratio.is_finite() {
                return Err(invalid());
            }
            match layout {
                "gameplay_webcam" if (0.20..=0.50).contains(&ratio) => Some(ratio),
                "two_people" if (0.30..=0.70).contains(&ratio) => Some(ratio),
                _ => return Err(invalid()),
            }
        }
    };
    let id = projects::with_writer(|c| {
        let tx = c.transaction()?;
        if let Some((id, job, state, prev_layout, prev_ratio)) = tx.query_row(
            "SELECT r.id,r.job_id,j.state,r.layout,r.split_ratio FROM reframe_suggestions r JOIN jobs j ON j.id=r.job_id WHERE r.source_id=?1 AND r.start_us=?2 AND r.end_us=?3",
            (source,start,end), |r| Ok((r.get::<_,i64>(0)?,r.get::<_,i64>(1)?,r.get::<_,String>(2)?,r.get::<_,String>(3)?,r.get::<_,Option<f64>>(4)?))).optional()? {
            let layout_changed = prev_layout != layout
                || prev_ratio.zip(split_ratio).is_some_and(|(a, b)| (a - b).abs() > 1e-6)
                || (prev_ratio.is_some() != split_ratio.is_some());
            if matches!(state.as_str(), "failed"|"cancelled") || ((force || layout_changed) && state == "completed") {
                tx.execute("UPDATE jobs SET state='queued',cancel_requested=0,progress=0,checkpoint=NULL WHERE id=?1", [job])?;
                tx.execute("UPDATE reframe_suggestions SET layout=?2,split_ratio=?3,timeline=NULL,secondary_timeline=NULL,error_code=NULL WHERE id=?1", (id, layout, split_ratio))?;
            }
            tx.commit()?;
            return Ok(id);
        }
        tx.execute(
            "INSERT INTO jobs(kind,safety,state,source_id) VALUES ('reframe','local','queued',?1)",
            [source],
        )?;
        let job = tx.last_insert_rowid();
        tx.execute("INSERT INTO reframe_suggestions(job_id,source_id,candidate_id,start_us,end_us,layout,split_ratio) VALUES (?1,?2,?3,?4,?5,?6,?7)", (job,source,candidate,start,end,layout,split_ratio))?;
        let id = tx.last_insert_rowid();
        tx.commit()?;
        Ok(id)
    })?;
    status(json!({"id":id}), &mut |_| {})
}

fn status(v: Value, _: &mut EventSink<'_>) -> CommandResult {
    let id = v["id"].as_i64().ok_or_else(invalid)?;
    let row = projects::with_reader(|c| c.query_row(
        "SELECT r.job_id,r.source_id,r.start_us,r.end_us,r.timeline,r.error_code,j.state,j.progress,r.layout,r.split_ratio,r.secondary_timeline FROM reframe_suggestions r JOIN jobs j ON j.id=r.job_id WHERE r.id=?1",
        [id], |r| Ok((r.get::<_,i64>(0)?,r.get::<_,i64>(1)?,r.get::<_,i64>(2)?,r.get::<_,i64>(3)?,r.get::<_,Option<String>>(4)?,r.get::<_,Option<String>>(5)?,r.get::<_,String>(6)?,r.get::<_,i64>(7)?,r.get::<_,String>(8)?,r.get::<_,Option<f64>>(9)?,r.get::<_,Option<String>>(10)?))).optional())?
        .ok_or_else(|| error("reframe_not_found", "Análise de enquadramento não encontrada."))?;
    let timeline = row
        .4
        .map(|s| serde_json::from_str::<Value>(&s))
        .transpose()
        .map_err(|_| protocol())?;
    let secondary_timeline = row
        .10
        .map(|s| serde_json::from_str::<Value>(&s))
        .transpose()
        .map_err(|_| protocol())?;
    // Nunca devolve texto de exceção nem código livre vindo de um Projeto compartilhado.
    let failure = row.5.map(|code| {
        error(
            if code == "worker_protocol" {
                "worker_protocol"
            } else if code == "cancelled" {
                "cancelled"
            } else {
                "reframe_failed"
            },
            "A análise de enquadramento foi interrompida.",
        )
    });
    Ok(
        json!({"id":id,"job":row.0,"source":row.1,"startUs":row.2,"endUs":row.3,"layout":row.8,"splitRatio":row.9,"timeline":timeline,"secondaryTimeline":secondary_timeline,"error":failure,"state":row.6,"progress":row.7}),
    )
}

pub(crate) fn run(job: i64, project: &Path, stop: &AtomicBool) -> Result<(), CoreError> {
    let outcome = analyze(job, project, stop);
    if let Err(ref err) = outcome {
        projects::with_writer(|c| {
            c.execute(
                "UPDATE reframe_suggestions SET error_code=?2 WHERE job_id=?1",
                (job, &err.code),
            )?;
            Ok(())
        })?;
    }
    outcome
}

fn analyze(job: i64, project: &Path, stop: &AtomicBool) -> Result<(), CoreError> {
    preview::check(job, stop)?;
    let (source, start, end, done, layout, split_ratio) = projects::with_reader(|c| {
        c.query_row(
        "SELECT source_id,start_us,end_us,timeline IS NOT NULL,layout,split_ratio FROM reframe_suggestions WHERE job_id=?1", [job],
        |r| Ok((r.get::<_,i64>(0)?,r.get::<_,i64>(1)?,r.get::<_,i64>(2)?,r.get::<_,bool>(3)?,r.get::<_,String>(4)?,r.get::<_,Option<f64>>(5)?)))
    })?;
    if done {
        return Ok(());
    } // crash depois do commit: não repete o worker.
    let (source_path, _, _, duration, _) = preview::source(source, project)?;
    if start < 0 || end <= start || end > duration {
        return Err(invalid());
    }
    let (_, _, ffmpeg) = components::cache_settings()?;
    let ffmpeg =
        ffmpeg.ok_or_else(|| error("component_missing", "Instale o Componente FFmpeg."))?;
    let (model, device) = components::models::reframe_model()?;
    let mut client = components::worker::start_worker()?;
    let token = CancelToken::new();
    let finished = AtomicBool::new(false);
    let result = std::thread::scope(|scope| {
        let cancel = token.clone();
        let finished_ref = &finished;
        scope.spawn(move || {
            while !finished_ref.load(Ordering::SeqCst) {
                if preview::check(job, stop).is_err() {
                    cancel.cancel();
                    break;
                }
                std::thread::sleep(Duration::from_millis(50));
            }
        });
        let mut req = json!({"source":source_path,"ffmpeg":ffmpeg,"start_us":start,"end_us":end,"layout":layout,"model":{"path":model,"device":device}});
        if let Some(ratio) = split_ratio {
            req["split_ratio"] = json!(ratio);
        }
        let result = client.run("reframe", req, token.flag(), &mut |event| {
            if let WorkerEvent::Progress {
                stage, percentage, ..
            } = event
            {
                let stage = match stage.as_str() {
                    "reframe_proxy" => "reframe_proxy",
                    "reframe_scenes" => "reframe_scenes",
                    _ => "reframe_faces",
                };
                let _ = jobs::progress(
                    job,
                    stage,
                    percentage.min(99),
                    "Analisando enquadramento do Corte",
                );
            }
        });
        finished.store(true, Ordering::SeqCst);
        result
    });
    preview::check(job, stop)?;
    let (document, secondary_doc) = timeline::validate(result?, start, end, &layout)?;
    let text = serde_json::to_string(&document).map_err(|_| protocol())?;
    let secondary_text = secondary_doc
        .as_ref()
        .map(serde_json::to_string)
        .transpose()
        .map_err(|_| protocol())?;
    let committed = projects::with_writer(|c| {
        let tx = c.transaction()?;
        // O cancelamento e o commit são serializados pelo mesmo escritor.
        let cancel: bool = tx.query_row(
            "SELECT cancel_requested FROM jobs WHERE id=?1",
            [job],
            |r| r.get(0),
        )?;
        if !cancel {
            tx.execute(
                "UPDATE reframe_suggestions SET timeline=?2,secondary_timeline=?3,error_code=NULL WHERE job_id=?1",
                (job, &text, secondary_text.as_deref()),
            )?;
            tx.execute("UPDATE jobs SET checkpoint='timeline:1',state='completed',progress=100 WHERE id=?1", [job])?;
        }
        tx.commit()?;
        Ok(!cancel)
    })?;
    if committed {
        Ok(())
    } else {
        Err(error("cancelled", "Tarefa cancelada."))
    }
}

inventory::submit! { CommandRegistration { name: "reframe.start", execute: start } }
inventory::submit! { CommandRegistration { name: "reframe.status", execute: status } }
