//! Export local de Cortes (#59), independente do Tauri e de Provedores.
pub mod captions;
pub mod pipeline;
pub mod render;

use crate::{projects, CommandRegistration, CommandResult, CoreError, EventSink};
use captions::CaptionWord;
use rusqlite::OptionalExtension;
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::{
    fs,
    path::{Path, PathBuf},
    sync::atomic::{AtomicBool, Ordering},
    time::Duration,
};

pub const JOB_KIND: &str = "export";

/// O futuro documento Corte só precisa produzir este contrato; o pipeline não lê UI.
#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct ExportRequest {
    pub source_id: i64,
    pub start_id: i64,
    pub end_id: i64,
    #[serde(default)]
    pub candidate_id: Option<i64>,
    #[serde(default)]
    pub output: PathBuf,
}

inventory::submit! { projects::Migration { id:"0059_001_exports", sql:"
CREATE TABLE exports (
  job_id INTEGER PRIMARY KEY REFERENCES jobs(id),
  request TEXT NOT NULL,
  error_code TEXT,
  error_message TEXT
);
" } }

struct Target {
    start_us: i64,
    end_us: i64,
    words: Vec<CaptionWord>,
}
fn bounds() -> CoreError {
    error(
        "export_bounds",
        "As bordas do Corte devem coincidir com Frases da Transcrição completa.",
    )
}
fn candidate_error() -> CoreError {
    error(
        "export_candidate",
        "Aprove o candidato e use as bordas atuais da revisão.",
    )
}

fn parse(v: Value) -> Result<ExportRequest, CoreError> {
    serde_json::from_value(v).map_err(|_| bounds())
}

fn target(request: &ExportRequest) -> Result<Target, CoreError> {
    if request.start_id <= 0 || request.end_id < request.start_id {
        return Err(bounds());
    }
    let transcript: Option<i64> = projects::with_reader(|c| {
        c.query_row("SELECT t.id FROM transcripts t JOIN sources s ON s.id=t.source_id AND s.audio_track=t.audio_track WHERE s.id=?1 AND t.state='complete'",[request.source_id],|r|r.get(0)).optional()
    })?;
    let transcript = transcript.ok_or_else(bounds)?;
    if let Some(candidate) = request.candidate_id {
        let run=projects::with_reader(|c| c.query_row("SELECT c.run_id FROM selection_candidates c JOIN selection_runs r ON r.id=c.run_id WHERE c.id=?1 AND r.transcript_id=?2",(candidate,transcript),|r|r.get::<_,i64>(0)).optional())?.ok_or_else(candidate_error)?;
        let review = crate::dispatch("selection.review", json!({"run":run}), &mut |_| {})?;
        let valid = review["items"].as_array().is_some_and(|items| {
            items.iter().any(|item| {
                item["candidate"] == candidate
                    && item["status"] == "approved"
                    && item["startId"] == request.start_id
                    && item["endId"] == request.end_id
            })
        });
        if !valid {
            return Err(candidate_error());
        }
    }
    projects::with_reader(|c| {
        let border:Option<(i64,i64,i64,i64)>=c.query_row("SELECT a.start_us,b.end_us,a.first_position,b.last_position FROM sentences a JOIN sentences b ON a.transcript_id=b.transcript_id JOIN transcripts t ON t.id=a.transcript_id WHERE a.transcript_id=?1 AND a.id=?2 AND b.id=?3 AND b.end_us<=t.duration_us",(transcript,request.start_id,request.end_id),|r|Ok((r.get(0)?,r.get(1)?,r.get(2)?,r.get(3)?))).optional()?;
        let Some((start_us, end_us, first, last)) = border else {
            return Ok(Err(bounds()));
        };
        if start_us < 0 || end_us <= start_us || last < first {
            return Ok(Err(bounds()));
        }
        let mut q=c.prepare(&format!("SELECT {},start_us,end_us FROM transcript_words WHERE transcript_id=?1 AND kind='word' AND position BETWEEN ?2 AND ?3 ORDER BY position",crate::corrections::EFFECTIVE_TEXT))?;
        let words = q
            .query_map((transcript, first, last), |r| {
                Ok(CaptionWord {
                    text: r.get(0)?,
                    start_us: r.get::<_, i64>(1)? - start_us,
                    end_us: r.get::<_, i64>(2)? - start_us,
                })
            })?
            .collect::<rusqlite::Result<Vec<_>>>()?;
        Ok(Ok(Target {
            start_us,
            end_us,
            words,
        }))
    })?
}

fn current_path() -> Result<PathBuf, CoreError> {
    let current = crate::dispatch("projects.current", json!({}), &mut |_| {})?;
    current["path"]
        .as_str()
        .map(PathBuf::from)
        .ok_or_else(|| error("invalid_project", "Abra um Projeto para exportar."))
}

fn cmd_captions(v: Value, _: &mut EventSink<'_>) -> CommandResult {
    let request = parse(v)?;
    let target = target(&request)?;
    let words = captions::sanitize(&target.words)?;
    Ok(
        json!({"ass":captions::ass(&words,target.end_us-target.start_us)?,"lines":captions::layout(&words),"start_us":target.start_us,"end_us":target.end_us}),
    )
}

fn cmd_start(v: Value, _: &mut EventSink<'_>) -> CommandResult {
    let _guard = projects::start_job()?;
    let request = parse(v)?;
    let _ = target(&request)?;
    render::validate_output(&request.output)?;
    let project = current_path()?;
    let _ = crate::jobs::preview::source(request.source_id, &project)?;
    if crate::components::cache_settings()?.2.is_none() {
        return Err(error("component_missing", "Instale o Componente FFmpeg."));
    }
    let encoded = serde_json::to_string(&request).map_err(|_| failed())?;
    let id = projects::with_writer(|c| {
        let tx = c.transaction()?;
        tx.execute(
            "INSERT INTO jobs(kind,safety,state,source_id) VALUES ('export','local','queued',?1)",
            [request.source_id],
        )?;
        let id = tx.last_insert_rowid();
        tx.execute(
            "INSERT INTO exports(job_id,request) VALUES (?1,?2)",
            (id, encoded),
        )?;
        tx.commit()?;
        Ok(id)
    })?;
    // Preferência local, fora do Projeto portátil. Uma falha de preferência não perde o job.
    let _ = save_directory(request.output.parent().unwrap());
    Ok(json!({"job":id,"state":"queued"}))
}

fn cmd_status(v: Value, _: &mut EventSink<'_>) -> CommandResult {
    let id = v["job"]
        .as_i64()
        .ok_or_else(|| error("invalid_job", "Tarefa inválida."))?;
    projects::with_reader(|c| {
        c.query_row("SELECT j.state,j.progress,e.request,e.error_code,e.error_message FROM exports e JOIN jobs j ON j.id=e.job_id WHERE j.id=?1",[id],|r| {
        let request:String=r.get(2)?;
        let request:Value=serde_json::from_str(&request).unwrap_or(Value::Null);
        let code:Option<String>=r.get(3)?;
        let message:Option<String>=r.get(4)?;
        Ok(json!({"job":id,"state":r.get::<_,String>(0)?,"progress":r.get::<_,i64>(1)?,"output":request["output"],"error":code.map(|code|json!({"code":code,"message":message}))}))
    })
    })
}

fn settings_path() -> Result<PathBuf, CoreError> {
    std::env::var_os("CLIPES_DATA_DIR")
        .map(PathBuf::from)
        .or_else(|| dirs::data_local_dir().map(|p| p.join("Clipes")))
        .map(|p| p.join("export-settings.json"))
        .ok_or_else(failed)
}
fn save_directory(path: &Path) -> Result<(), CoreError> {
    let target = settings_path()?;
    fs::create_dir_all(target.parent().unwrap()).map_err(|_| failed())?;
    fs::write(target, json!({"last_directory":path}).to_string()).map_err(|_| failed())
}
fn cmd_settings(_: Value, _: &mut EventSink<'_>) -> CommandResult {
    let saved = fs::read(settings_path()?)
        .ok()
        .and_then(|bytes| serde_json::from_slice::<Value>(&bytes).ok());
    let directory = saved
        .as_ref()
        .and_then(|v| v["last_directory"].as_str())
        .filter(|p| Path::new(p).is_absolute() && Path::new(p).is_dir());
    Ok(json!({"last_directory":directory}))
}

pub(crate) fn run(
    id: i64,
    _source: i64,
    project: &Path,
    stop: &AtomicBool,
) -> Result<(), CoreError> {
    let result = (|| {
        crate::jobs::preview::check(id, stop)?;
        let request: String = projects::with_reader(|c| {
            c.query_row("SELECT request FROM exports WHERE job_id=?1", [id], |r| {
                r.get(0)
            })
        })?;
        let request: ExportRequest = serde_json::from_str(&request).map_err(|_| failed())?;
        let target = target(&request)?;
        let (source, _, audio, _, _) = crate::jobs::preview::source(request.source_id, project)?;
        let ffmpeg = crate::components::cache_settings()?
            .2
            .ok_or_else(|| error("component_missing", "Instale o Componente FFmpeg."))?;
        let input = render::RenderInput {
            source,
            output: request.output,
            start_us: target.start_us,
            end_us: target.end_us,
            audio_track: audio,
            words: target.words,
        };
        let cancel = crate::provider::CancelToken::new();
        let finished = AtomicBool::new(false);
        crate::jobs::progress(id, "export", 1, "Exportando Corte")?;
        let result = std::thread::scope(|scope| {
            scope.spawn(|| {
                while !finished.load(Ordering::SeqCst) {
                    if stop.load(Ordering::SeqCst) || crate::jobs::preview::is_cancelled(id) {
                        cancel.cancel();
                        break;
                    }
                    std::thread::sleep(Duration::from_millis(25));
                }
            });
            let mut last = 0;
            let result = render::render(&ffmpeg, &input, &cancel, &mut |percentage| {
                if percentage > last {
                    let _ = crate::jobs::progress(id, "export", percentage, "Exportando Corte");
                    last = percentage;
                }
            });
            finished.store(true, Ordering::SeqCst);
            result
        });
        if stop.load(Ordering::SeqCst) && result.as_ref().is_err_and(|e| e.code == "cancelled") {
            return Err(error("interrupted", "O export foi interrompido."));
        }
        result
    })();
    projects::with_writer(|c| {
        c.execute(
            "UPDATE exports SET error_code=?2,error_message=?3 WHERE job_id=?1",
            (
                id,
                result.as_ref().err().map(|e| &e.code),
                result.as_ref().err().map(|e| &e.message),
            ),
        )?;
        Ok(())
    })?;
    result
}

inventory::submit! { CommandRegistration {name:"export.start",execute:cmd_start} }
inventory::submit! { CommandRegistration {name:"export.captions",execute:cmd_captions} }
inventory::submit! { CommandRegistration {name:"export.status",execute:cmd_status} }
inventory::submit! { CommandRegistration {name:"export.settings",execute:cmd_settings} }

pub(crate) fn error(code: &str, message: &str) -> crate::CoreError {
    crate::CoreError {
        code: code.into(),
        message: message.into(),
        usage: None,
    }
}
pub(crate) fn failed() -> crate::CoreError {
    error("export_failed", "Não foi possível exportar o Corte.")
}
