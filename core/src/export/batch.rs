//! Export em lote (#64): enfileira N exports individuais (#59/#62/#63/#65/#70) e agrega o progresso.
use super::{error, ExportRequest, StartRequest};
use crate::{projects, CommandRegistration, CommandResult, CoreError, EventSink};
use rusqlite::{params, OptionalExtension};
use serde_json::{json, Value};
use std::{
    collections::{HashMap, HashSet},
    path::{Path, PathBuf},
};
use unicode_normalization::UnicodeNormalization;

inventory::submit! { projects::Migration { id: "0064_001_export_batches", sql: "
CREATE TABLE export_batches (
  id INTEGER PRIMARY KEY,
  scope TEXT NOT NULL CHECK(scope IN ('source','project')),
  source_id INTEGER REFERENCES sources(id),
  output_dir TEXT NOT NULL,
  state TEXT NOT NULL DEFAULT 'running' CHECK(state IN ('running','completed','cancelled')),
  created_at INTEGER NOT NULL DEFAULT (CAST(strftime('%s','now') AS INTEGER) * 1000000)
);
CREATE TABLE export_batch_items (
  batch_id INTEGER NOT NULL REFERENCES export_batches(id) ON DELETE CASCADE,
  position INTEGER NOT NULL,
  source_id INTEGER NOT NULL REFERENCES sources(id),
  run_id INTEGER NOT NULL,
  candidate_id INTEGER NOT NULL,
  clip_id INTEGER,
  job_id INTEGER REFERENCES jobs(id),
  title TEXT NOT NULL DEFAULT '',
  filename TEXT NOT NULL,
  output TEXT NOT NULL,
  duration_us INTEGER NOT NULL,
  state TEXT NOT NULL DEFAULT 'queued' CHECK(state IN ('queued','running','completed','failed','cancelled')),
  error_code TEXT,
  error_message TEXT,
  PRIMARY KEY(batch_id, position)
);
" } }

const MAX_STEM_CHARS: usize = 60;

pub(crate) struct PlannedCut {
    pub(crate) source_id: i64,
    pub(crate) source_path: String,
    pub(crate) run_id: i64,
    pub(crate) candidate_id: i64,
    pub(crate) clip_id: Option<i64>,
    pub(crate) start_id: i64,
    pub(crate) end_id: i64,
    pub(crate) start_us: i64,
    pub(crate) duration_us: i64,
    pub(crate) title: String,
    pub(crate) initial_error: Option<CoreError>,
}

enum PreparedItem {
    Queued(Box<StartRequest>, i64),
    Failed(CoreError, i64),
}

struct BatchHeader {
    id: i64,
    scope: String,
    source_id: Option<i64>,
    output_dir: String,
    state: String,
}

struct BatchItemRow {
    position: i64,
    source_id: i64,
    run_id: i64,
    candidate_id: i64,
    clip_id: Option<i64>,
    job_id: Option<i64>,
    title: String,
    filename: String,
    output: String,
    duration_us: i64,
    item_state: String,
    item_error_code: Option<String>,
    item_error_message: Option<String>,
    job_state: Option<String>,
    job_progress: Option<i64>,
    export_error_code: Option<String>,
    export_error_message: Option<String>,
    encoder: Option<String>,
    fallback_from: Option<String>,
    fallback_reason: Option<String>,
}

fn is_reserved_windows_name(stem: &str) -> bool {
    let head = stem.split('.').next().unwrap_or(stem);
    let upper = head.to_ascii_uppercase();
    matches!(
        upper.as_str(),
        "CON"
            | "PRN"
            | "AUX"
            | "NUL"
            | "COM1"
            | "COM2"
            | "COM3"
            | "COM4"
            | "COM5"
            | "COM6"
            | "COM7"
            | "COM8"
            | "COM9"
            | "LPT1"
            | "LPT2"
            | "LPT3"
            | "LPT4"
            | "LPT5"
            | "LPT6"
            | "LPT7"
            | "LPT8"
            | "LPT9"
    )
}

pub(crate) fn sanitize_stem(source_path: &str, source_id: i64) -> String {
    let raw = Path::new(source_path)
        .file_stem()
        .and_then(|s| s.to_str())
        .unwrap_or("");
    let cleaned: String = raw
        .nfc()
        .map(|ch| {
            if matches!(ch, '<' | '>' | ':' | '"' | '/' | '\\' | '|' | '?' | '*') || ch.is_control()
            {
                '-'
            } else {
                ch
            }
        })
        .collect();
    let trimmed = cleaned.trim().trim_end_matches(['.', ' ']);
    let truncated: String = trimmed.chars().take(MAX_STEM_CHARS).collect();
    let stem = truncated.trim().trim_end_matches(['.', ' ']);
    if stem.is_empty() || is_reserved_windows_name(stem) {
        format!("fonte-{source_id}")
    } else {
        stem.to_owned()
    }
}

pub(crate) fn format_start(us: i64) -> String {
    let secs = (us.max(0) / 1_000_000) as u64;
    let h = secs / 3600;
    let m = (secs % 3600) / 60;
    let s = secs % 60;
    if h > 0 {
        format!("{h:02}h{m:02}m{s:02}s")
    } else {
        format!("{m:02}m{s:02}s")
    }
}

fn build_filenames(cuts: &[PlannedCut]) -> Vec<String> {
    let width = cuts.len().to_string().len().max(2);
    let mut used = HashSet::with_capacity(cuts.len());
    let mut names = Vec::with_capacity(cuts.len());
    for (idx, cut) in cuts.iter().enumerate() {
        let stem = sanitize_stem(&cut.source_path, cut.source_id);
        let nn = format!("{:0width$}", idx + 1);
        let start = format_start(cut.start_us);
        let base = format!("{stem}-{nn}-{start}");
        let mut candidate = format!("{base}.mp4");
        let mut suffix = 2usize;
        while !used.insert(candidate.to_ascii_lowercase()) {
            candidate = format!("{base}-{suffix}.mp4");
            suffix += 1;
        }
        names.push(candidate);
    }
    names
}

pub(crate) fn weighted_progress(items: &[(i64, &str, u8)]) -> u8 {
    let total: i128 = items.iter().map(|(d, _, _)| i128::from((*d).max(1))).sum();
    if total <= 0 {
        return 0;
    }
    let done: i128 = items
        .iter()
        .map(|(d, state, progress)| {
            let pct = match *state {
                "completed" | "failed" => 100,
                "running" => i128::from((*progress).min(100)),
                _ => 0,
            };
            i128::from((*d).max(1)) * pct
        })
        .sum();
    (done / total).clamp(0, 100) as u8
}

pub(crate) fn collect_cuts(scope_source: Option<i64>) -> Result<Vec<PlannedCut>, CoreError> {
    let sources: Vec<(i64, String)> = projects::with_reader(|c| {
        if let Some(sid) = scope_source {
            let found = c
                .query_row("SELECT id,path FROM sources WHERE id=?1", [sid], |r| {
                    Ok((r.get::<_, i64>(0)?, r.get::<_, String>(1)?))
                })
                .optional()?;
            Ok(found.into_iter().collect())
        } else {
            let mut q = c.prepare("SELECT id,path FROM sources ORDER BY id ASC")?;
            let rows = q.query_map([], |r| Ok((r.get(0)?, r.get(1)?)))?;
            rows.collect::<rusqlite::Result<Vec<_>>>()
        }
    })?;
    if scope_source.is_some() && sources.is_empty() {
        return Err(error("source_missing", "Fonte não encontrada."));
    }

    let mut cuts = Vec::new();
    for (source_id, source_path) in sources {
        let transcript: Option<i64> = projects::with_reader(|c| {
            c.query_row(
                "SELECT t.id FROM transcripts t JOIN sources s ON s.id=t.source_id AND s.audio_track=t.audio_track WHERE s.id=?1 AND t.state='complete'",
                [source_id],
                |r| r.get(0),
            )
            .optional()
        })?;
        let Some(transcript) = transcript else {
            continue;
        };
        let runs: Vec<i64> = projects::with_reader(|c| {
            let mut q =
                c.prepare("SELECT id FROM selection_runs WHERE transcript_id=?1 ORDER BY id ASC")?;
            let rows = q.query_map([transcript], |r| r.get(0))?;
            rows.collect::<rusqlite::Result<Vec<_>>>()
        })?;
        let mut sentence_times: Option<HashMap<i64, (i64, i64)>> = None;
        for run_id in runs {
            let borders = crate::selection::approved_borders_for_run(run_id)?;
            if borders.is_empty() {
                continue;
            }
            let times = match &sentence_times {
                Some(map) => map,
                None => {
                    let loaded: HashMap<i64, (i64, i64)> = crate::sentences::load_for(transcript)?
                        .into_iter()
                        .map(|s| (s.id, (s.start_us, s.end_us)))
                        .collect();
                    sentence_times.insert(loaded)
                }
            };
            let candidates: Vec<(i64, String)> = projects::with_reader(|c| {
                let mut q = c.prepare(
                    "SELECT id,title FROM selection_candidates WHERE run_id=?1 AND revision=(SELECT revision FROM selection_runs WHERE id=?1) ORDER BY rank ASC",
                )?;
                let rows = q.query_map([run_id], |r| {
                    Ok((r.get::<_, i64>(0)?, r.get::<_, String>(1)?))
                })?;
                rows.collect::<rusqlite::Result<Vec<_>>>()
            })?;
            for (candidate_id, title) in candidates {
                let Some(&(rev_start_id, rev_end_id)) = borders.get(&candidate_id) else {
                    continue;
                };
                let (Some(&(rev_start_us, _)), Some(&(_, rev_end_us))) =
                    (times.get(&rev_start_id), times.get(&rev_end_id))
                else {
                    continue;
                };
                let edited_id = crate::editor::edits::clip_id_for_candidate(candidate_id)?;
                if let Some(cid) = edited_id {
                    match crate::editor::edits::document(cid) {
                        Ok(doc) => cuts.push(PlannedCut {
                            source_id,
                            source_path: source_path.clone(),
                            run_id,
                            candidate_id,
                            clip_id: Some(cid),
                            start_id: doc.range.start_id,
                            end_id: doc.range.end_id,
                            start_us: doc.range.start_us,
                            duration_us: (doc.range.end_us - doc.range.start_us).max(1),
                            title,
                            initial_error: None,
                        }),
                        Err(e) => cuts.push(PlannedCut {
                            source_id,
                            source_path: source_path.clone(),
                            run_id,
                            candidate_id,
                            clip_id: Some(cid),
                            start_id: rev_start_id,
                            end_id: rev_end_id,
                            start_us: rev_start_us,
                            duration_us: (rev_end_us - rev_start_us).max(1),
                            title,
                            initial_error: Some(e),
                        }),
                    }
                } else {
                    cuts.push(PlannedCut {
                        source_id,
                        source_path: source_path.clone(),
                        run_id,
                        candidate_id,
                        clip_id: None,
                        start_id: rev_start_id,
                        end_id: rev_end_id,
                        start_us: rev_start_us,
                        duration_us: (rev_end_us - rev_start_us).max(1),
                        title,
                        initial_error: None,
                    });
                }
            }
        }
    }
    if cuts.is_empty() {
        return Err(error(
            "export_batch_empty",
            "Nenhum Corte aprovado para exportar.",
        ));
    }
    Ok(cuts)
}

fn read_header(id: i64) -> Result<BatchHeader, CoreError> {
    projects::with_reader(|c| {
        c.query_row(
            "SELECT id,scope,source_id,output_dir,state FROM export_batches WHERE id=?1",
            [id],
            |r| {
                Ok(BatchHeader {
                    id: r.get(0)?,
                    scope: r.get(1)?,
                    source_id: r.get(2)?,
                    output_dir: r.get(3)?,
                    state: r.get(4)?,
                })
            },
        )
    })
    .map_err(|_| error("batch_not_found", "Lote de export não encontrado."))
}

fn read_rows(batch_id: i64) -> Result<Vec<BatchItemRow>, CoreError> {
    projects::with_reader(|c| {
        let mut q = c.prepare(
            "SELECT i.position,i.source_id,i.run_id,i.candidate_id,i.clip_id,i.job_id,i.title,i.filename,i.output,i.duration_us,i.state,i.error_code,i.error_message,j.state,j.progress,e.error_code,e.error_message,e.encoder,e.fallback_from,e.fallback_reason
             FROM export_batch_items i
             LEFT JOIN jobs j ON j.id=i.job_id
             LEFT JOIN exports e ON e.job_id=i.job_id
             WHERE i.batch_id=?1
             ORDER BY i.position ASC",
        )?;
        let rows = q.query_map([batch_id], |r| {
            Ok(BatchItemRow {
                position: r.get(0)?,
                source_id: r.get(1)?,
                run_id: r.get(2)?,
                candidate_id: r.get(3)?,
                clip_id: r.get(4)?,
                job_id: r.get(5)?,
                title: r.get(6)?,
                filename: r.get(7)?,
                output: r.get(8)?,
                duration_us: r.get(9)?,
                item_state: r.get(10)?,
                item_error_code: r.get(11)?,
                item_error_message: r.get(12)?,
                job_state: r.get(13)?,
                job_progress: r.get(14)?,
                export_error_code: r.get(15)?,
                export_error_message: r.get(16)?,
                encoder: r.get(17)?,
                fallback_from: r.get(18)?,
                fallback_reason: r.get(19)?,
            })
        })?;
        rows.collect::<rusqlite::Result<Vec<_>>>()
    })
}

fn effective_item_state(row: &BatchItemRow) -> &'static str {
    let raw = row.job_state.as_deref().unwrap_or(row.item_state.as_str());
    match raw {
        "queued" => "queued",
        "running" => "running",
        "completed" => "completed",
        "cancelled" => "cancelled",
        _ => "failed",
    }
}

fn effective_item_progress(row: &BatchItemRow, state: &str) -> u8 {
    match state {
        "completed" => 100,
        "running" => row.job_progress.unwrap_or(0).clamp(0, 100) as u8,
        _ => 0,
    }
}

fn view(id: i64) -> Result<Value, CoreError> {
    let header = read_header(id)?;
    let rows = read_rows(id)?;
    let mut weights = Vec::with_capacity(rows.len());
    let mut counts = (0usize, 0usize, 0usize, 0usize, 0usize); // queued, running, completed, failed, cancelled
    let mut items_json = Vec::with_capacity(rows.len());

    for row in &rows {
        let state = effective_item_state(row);
        let progress = effective_item_progress(row, state);
        weights.push((row.duration_us, state, progress));
        match state {
            "queued" => counts.0 += 1,
            "running" => counts.1 += 1,
            "completed" => counts.2 += 1,
            "failed" => counts.3 += 1,
            "cancelled" => counts.4 += 1,
            _ => counts.3 += 1,
        }
        let err_code = row
            .export_error_code
            .as_deref()
            .or(row.item_error_code.as_deref());
        let err_msg = row
            .export_error_message
            .as_deref()
            .or(row.item_error_message.as_deref());
        let err = if state == "failed" {
            err_code.map(|code| json!({"code": code, "message": err_msg}))
        } else {
            None
        };
        let fallback = super::encoder::fallback_view(
            row.fallback_from.as_deref(),
            row.fallback_reason.as_deref(),
        );
        items_json.push(json!({
            "position": row.position,
            "sourceId": row.source_id,
            "runId": row.run_id,
            "candidateId": row.candidate_id,
            "clipId": row.clip_id,
            "jobId": row.job_id,
            "title": row.title,
            "filename": row.filename,
            "output": row.output,
            "durationUs": row.duration_us,
            "state": state,
            "progress": progress,
            "error": err,
            "encoder": row.encoder,
            "encoderFallback": fallback,
        }));
    }

    let progress = weighted_progress(&weights);
    let total = rows.len();
    let status = if header.state == "cancelled" {
        "cancelled"
    } else if counts.0 > 0 || counts.1 > 0 {
        "running"
    } else if counts.2 == total {
        "completed"
    } else if counts.2 > 0 {
        "partial"
    } else {
        "failed"
    };

    Ok(json!({
        "id": header.id,
        "scope": header.scope,
        "sourceId": header.source_id,
        "outputDir": header.output_dir,
        "state": header.state,
        "status": status,
        "progress": progress,
        "counts": {
            "total": total,
            "queued": counts.0,
            "running": counts.1,
            "completed": counts.2,
            "failed": counts.3,
            "cancelled": counts.4,
        },
        "items": items_json,
    }))
}

fn emit_batch_event(batch_id: i64, stage: &str, percentage: u8, message: &str) {
    let project = projects::with_reader(|c| {
        c.query_row("SELECT id FROM queue_project_identity", [], |r| {
            r.get::<_, String>(0)
        })
    })
    .ok();
    crate::emit_background(crate::ProgressEvent {
        job: format!("export-batch-{batch_id}"),
        project,
        stage: stage.into(),
        percentage: percentage.min(100),
        message: message.into(),
        error: None,
    });
}

fn batch_id_for_job(job_id: i64) -> Option<i64> {
    projects::with_reader(|c| {
        c.query_row(
            "SELECT batch_id FROM export_batch_items WHERE job_id=?1",
            [job_id],
            |r| r.get::<_, i64>(0),
        )
        .optional()
    })
    .ok()
    .flatten()
}

/// Chamado por `export::run` a cada avanço percentual de um job de export individual.
pub(crate) fn on_job_progress(job_id: i64) {
    let Some(batch_id) = batch_id_for_job(job_id) else {
        return;
    };
    if let Ok(v) = view(batch_id) {
        let pct = v["progress"].as_u64().unwrap_or(0).min(100) as u8;
        emit_batch_event(batch_id, "export_batch", pct, "Exportando lote de Cortes");
    }
}

/// Chamado pela fila (#44) logo após `finish(job_id, result)` de um job `export`.
pub(crate) fn on_job_settled(job_id: i64) {
    let Some(batch_id) = batch_id_for_job(job_id) else {
        return;
    };
    let _ = projects::with_writer(|c| {
        let row: Option<(String, Option<String>, Option<String>)> = c
            .query_row(
                "SELECT j.state,e.error_code,e.error_message FROM jobs j LEFT JOIN exports e ON e.job_id=j.id WHERE j.id=?1",
                [job_id],
                |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?)),
            )
            .optional()?;
        if let Some((job_state, err_code, err_msg)) = row {
            let item_state = match job_state.as_str() {
                "completed" => "completed",
                "cancelled" => "cancelled",
                "queued" | "running" => "queued",
                _ => "failed",
            };
            c.execute(
                "UPDATE export_batch_items SET state=?2,error_code=?3,error_message=?4 WHERE job_id=?1",
                params![job_id, item_state, err_code, err_msg],
            )?;
        }
        let active: i64 = c.query_row(
            "SELECT COUNT(*) FROM export_batch_items i LEFT JOIN jobs j ON j.id=i.job_id WHERE i.batch_id=?1 AND COALESCE(j.state,i.state) IN ('queued','running')",
            [batch_id],
            |r| r.get(0),
        )?;
        if active == 0 {
            c.execute(
                "UPDATE export_batches SET state='completed' WHERE id=?1 AND state='running'",
                [batch_id],
            )?;
        }
        Ok(())
    });
    if let Ok(v) = view(batch_id) {
        let pct = v["progress"].as_u64().unwrap_or(0).min(100) as u8;
        let status = v["status"].as_str().unwrap_or("running");
        let (stage, msg) = match status {
            "cancelled" => ("export_batch_cancelled", "Lote de export cancelado"),
            "running" => ("export_batch", "Exportando lote de Cortes"),
            _ => ("export_batch_complete", "Lote de export concluído"),
        };
        emit_batch_event(batch_id, stage, pct, msg);
    }
}

fn cmd_start(v: Value, _: &mut EventSink<'_>) -> CommandResult {
    let _guard = projects::start_job()?;
    let project = super::current_path()?;
    if let Some(requested_project) = v["project"].as_str() {
        if Path::new(requested_project) != project {
            return Err(error("invalid_project", "O Projeto não está aberto."));
        }
    }
    let scope_source = match v.get("source_id") {
        None | Some(Value::Null) => None,
        Some(val) => Some(
            val.as_i64()
                .ok_or_else(|| error("source_missing", "Fonte não encontrada."))?,
        ),
    };
    let output_dir_str = v["output_dir"]
        .as_str()
        .filter(|s| !s.is_empty())
        .ok_or_else(|| error("export_destination", "Escolha uma pasta existente."))?;
    let output_dir = PathBuf::from(output_dir_str);
    if !output_dir.is_absolute() || !output_dir.is_dir() {
        return Err(error("export_destination", "Escolha uma pasta existente."));
    }
    if crate::components::cache_settings()?.2.is_none() {
        return Err(error("component_missing", "Instale o Componente FFmpeg."));
    }
    let confirmed = v["confirmed"] == true;
    let cuts = collect_cuts(scope_source)?;
    let filenames = build_filenames(&cuts);

    // Antes de renderizar, compara os nomes planejados com a pasta; sem paths pessoais (ADR-0006).
    let conflicts: Vec<String> = filenames
        .iter()
        .filter(|name| output_dir.join(name).exists())
        .cloned()
        .collect();
    if !conflicts.is_empty() && !confirmed {
        return Err(CoreError {
            code: "confirmation_required".into(),
            message: "Alguns arquivos já existem na pasta de saída. Confirme para sobrescrever."
                .into(),
            usage: Some(json!({ "conflicts": conflicts })),
        });
    }

    let mut prepared = Vec::with_capacity(cuts.len());
    for (cut, filename) in cuts.iter().zip(filenames.iter()) {
        if let Some(err) = &cut.initial_error {
            prepared.push(PreparedItem::Failed(err.clone(), cut.duration_us));
            continue;
        }
        let output = output_dir.join(filename);
        let req = StartRequest {
            cut: ExportRequest {
                source_id: cut.source_id,
                start_id: cut.start_id,
                end_id: cut.end_id,
                candidate_id: Some(cut.candidate_id),
                clip_id: cut.clip_id,
            },
            output,
            resolved_bounds: None,
            resolved_silences: None,
            resolved_crop: None,
            resolved_crop_plan: None,
            resolved_captions: None,
            resolved_output_captions: None,
            resolved_narration_starts: None,
            resolved_soundtrack: None,
            resolved_sfx: None,
            overwrite: confirmed,
        };
        match super::prepare_start_request(req, &project) {
            Ok((resolved, dur)) => {
                prepared.push(PreparedItem::Queued(Box::new(resolved), dur.max(1)))
            }
            Err(err) => prepared.push(PreparedItem::Failed(err, cut.duration_us)),
        }
    }

    let any_queued = prepared
        .iter()
        .any(|p| matches!(p, PreparedItem::Queued(..)));
    let initial_state = if any_queued { "running" } else { "completed" };
    let scope = if scope_source.is_some() {
        "source"
    } else {
        "project"
    };
    let output_dir_text = output_dir.to_string_lossy().into_owned();

    let batch_id = projects::with_writer(|c| {
        let tx = c.transaction()?;
        tx.execute(
            "INSERT INTO export_batches(scope,source_id,output_dir,state) VALUES (?1,?2,?3,?4)",
            params![scope, scope_source, output_dir_text, initial_state],
        )?;
        let batch_id = tx.last_insert_rowid();
        let batch_key = format!("exports-{batch_id}");
        for (pos, ((cut, filename), prep)) in cuts
            .iter()
            .zip(filenames.iter())
            .zip(prepared.iter())
            .enumerate()
        {
            let output_str = output_dir.join(filename).to_string_lossy().into_owned();
            match prep {
                PreparedItem::Queued(req, dur) => {
                    let job_id = super::enqueue_tx(&tx, req, Some(&batch_key))?;
                    tx.execute(
                        "INSERT INTO export_batch_items(batch_id,position,source_id,run_id,candidate_id,clip_id,job_id,title,filename,output,duration_us,state) VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9,?10,?11,'queued')",
                        params![
                            batch_id,
                            pos as i64,
                            cut.source_id,
                            cut.run_id,
                            cut.candidate_id,
                            cut.clip_id,
                            job_id,
                            cut.title,
                            filename,
                            output_str,
                            dur,
                        ],
                    )?;
                }
                PreparedItem::Failed(err, dur) => {
                    tx.execute(
                        "INSERT INTO export_batch_items(batch_id,position,source_id,run_id,candidate_id,clip_id,job_id,title,filename,output,duration_us,state,error_code,error_message) VALUES (?1,?2,?3,?4,?5,?6,NULL,?7,?8,?9,?10,'failed',?11,?12)",
                        params![
                            batch_id,
                            pos as i64,
                            cut.source_id,
                            cut.run_id,
                            cut.candidate_id,
                            cut.clip_id,
                            cut.title,
                            filename,
                            output_str,
                            dur,
                            err.code,
                            err.message,
                        ],
                    )?;
                }
            }
        }
        tx.commit()?;
        Ok(batch_id)
    })?;

    let _ = super::save_directory(&output_dir);
    let result = view(batch_id)?;
    let pct = result["progress"].as_u64().unwrap_or(0).min(100) as u8;
    let stage = if any_queued {
        "export_batch"
    } else {
        "export_batch_complete"
    };
    emit_batch_event(batch_id, stage, pct, "Lote de export iniciado");
    Ok(result)
}

fn batch_id_arg(v: &Value) -> Result<i64, CoreError> {
    v["id"]
        .as_i64()
        .ok_or_else(|| error("batch_not_found", "Lote de export não encontrado."))
}

fn cmd_status(v: Value, _: &mut EventSink<'_>) -> CommandResult {
    view(batch_id_arg(&v)?)
}

fn cmd_list(v: Value, _: &mut EventSink<'_>) -> CommandResult {
    let source_id = v["source_id"].as_i64();
    let ids: Vec<i64> = projects::with_reader(|c| {
        if let Some(sid) = source_id {
            let mut q = c.prepare(
                "SELECT id FROM export_batches WHERE scope='source' AND source_id=?1 ORDER BY id DESC",
            )?;
            let rows = q.query_map([sid], |r| r.get(0))?;
            rows.collect::<rusqlite::Result<Vec<_>>>()
        } else {
            let mut q = c.prepare("SELECT id FROM export_batches ORDER BY id DESC")?;
            let rows = q.query_map([], |r| r.get(0))?;
            rows.collect::<rusqlite::Result<Vec<_>>>()
        }
    })?;
    ids.into_iter()
        .map(view)
        .collect::<Result<Vec<_>, _>>()
        .map(Value::Array)
}

fn cmd_cancel(v: Value, _: &mut EventSink<'_>) -> CommandResult {
    let _guard = projects::start_job()?;
    let id = batch_id_arg(&v)?;
    let _ = read_header(id)?;
    projects::with_writer(|c| {
        let tx = c.transaction()?;
        tx.execute(
            "UPDATE export_batches SET state='cancelled' WHERE id=?1 AND state='running'",
            [id],
        )?;
        tx.execute(
            "UPDATE jobs SET state=CASE WHEN state='queued' THEN 'cancelled' ELSE state END, cancel_requested=1 WHERE id IN (SELECT job_id FROM export_batch_items WHERE batch_id=?1 AND job_id IS NOT NULL) AND state IN ('queued','running')",
            [id],
        )?;
        tx.execute(
            "UPDATE export_batch_items SET state='cancelled' WHERE batch_id=?1 AND state='queued' AND (job_id IS NULL OR job_id IN (SELECT id FROM jobs WHERE state='cancelled'))",
            [id],
        )?;
        tx.commit()?;
        Ok(())
    })?;
    let result = view(id)?;
    let pct = result["progress"].as_u64().unwrap_or(0).min(100) as u8;
    emit_batch_event(
        id,
        "export_batch_cancelled",
        pct,
        "Lote de export cancelado",
    );
    Ok(result)
}

inventory::submit! { CommandRegistration { name: "export.batch.start", execute: cmd_start } }
inventory::submit! { CommandRegistration { name: "export.batch.status", execute: cmd_status } }
inventory::submit! { CommandRegistration { name: "export.batch.list", execute: cmd_list } }
inventory::submit! { CommandRegistration { name: "export.batch.cancel", execute: cmd_cancel } }

#[cfg(test)]
mod tests {
    use super::*;

    fn cut(source_id: i64, source_path: &str, start_us: i64) -> PlannedCut {
        PlannedCut {
            source_id,
            source_path: source_path.into(),
            run_id: 1,
            candidate_id: 1,
            clip_id: None,
            start_id: 1,
            end_id: 2,
            start_us,
            duration_us: 2_000_000,
            title: String::new(),
            initial_error: None,
        }
    }

    #[test]
    fn sanitizes_stems_and_generates_stable_non_colliding_filenames() {
        assert_eq!(
            sanitize_stem("D:/lives/Live: Ep #1?.mp4", 3),
            "Live- Ep #1-"
        );
        assert_eq!(sanitize_stem("D:/lives/CON.mp4", 7), "fonte-7");
        assert_eq!(sanitize_stem("D:/lives/   .mp4", 9), "fonte-9");
        assert_eq!(format_start(12_500_000), "00m12s");
        assert_eq!(format_start(3_665_000_000), "01h01m05s");

        let cuts = vec![
            cut(1, "/a/live.mp4", 0),
            cut(1, "/a/live.mp4", 10_000_000),
            cut(2, "/b/live.mp4", 0),
        ];
        assert_eq!(
            build_filenames(&cuts),
            vec![
                "live-01-00m00s.mp4",
                "live-02-00m10s.mp4",
                "live-03-00m00s.mp4",
            ]
        );
    }

    #[test]
    fn weighted_progress_aggregates_by_duration() {
        assert_eq!(
            weighted_progress(&[(2_000_000, "running", 50), (6_000_000, "queued", 0),]),
            12
        );
        assert_eq!(
            weighted_progress(&[(2_000_000, "completed", 100), (6_000_000, "running", 50),]),
            62
        );
        assert_eq!(
            weighted_progress(&[(2_000_000, "failed", 0), (6_000_000, "completed", 100),]),
            100
        );
        assert_eq!(
            weighted_progress(&[(2_000_000, "completed", 100), (6_000_000, "cancelled", 0),]),
            25
        );
    }
}
