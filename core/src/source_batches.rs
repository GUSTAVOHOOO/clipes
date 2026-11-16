//! Lote de Fontes (#56): várias Fontes do Projeto processadas uma depois da outra,
//! transcrição (#48/#51) e seleção de Cortes (#53).
//!
//! O lote é só orquestração sobre a fila de jobs (#44): cada Fonte é um item que passa por
//! `pending` → `transcribing` → `selecting` → `completed`. O avanço é **uma função do banco**
//! (`tick`, chamada pelo thread da fila a cada volta): o estado de cada item é recalculado a
//! partir dos jobs, das Transcrições e das execuções de seleção, nunca só do que o item guarda.
//! Por isso fechar o app, cair no meio de uma chamada ou outro comando mexer na fila não duplicam
//! Fonte nem Janela: antes de iniciar algo, `tick` procura o que já existe.
//!
//! * Uma Fonte por vez está ativa. Uma Fonte que para (erro não transitório do Provedor,
//!   Transcrição que falha, chamada paga incerta) fica `paused` com um código fixo e as outras
//!   seguem. Erro transitório segue a política do executor (#121); aqui só chega o resultado final.
//! * O teto de custo é o do #124, escopo `batch`, chave `sources-<id>`: as Janelas de todas as
//!   Fontes usam essa chave, e o áudio pago do Groq entra na mesma soma (`totals_since`).
//! * Nada é repetido às cegas (ADR-0005): `tick` nunca confirma a repetição de chamada paga
//!   incerta. Retomar uma Fonte que parou por incerteza pede confirmação com o custo.
use crate::{jobs, projects, CommandRegistration, CommandResult, CoreError, EventSink};
use rusqlite::OptionalExtension;
use serde_json::{json, Value};

inventory::submit! { projects::Migration { id: "0056_001_source_batches", sql: "
CREATE TABLE source_batches (
  id INTEGER PRIMARY KEY,
  key TEXT NOT NULL UNIQUE,
  state TEXT NOT NULL DEFAULT 'running' CHECK(state IN ('running','paused','completed','cancelled')),
  engine TEXT NOT NULL DEFAULT 'local' CHECK(engine IN ('local','groq')),
  min_us INTEGER,
  max_us INTEGER,
  created_at INTEGER NOT NULL DEFAULT (CAST(strftime('%s','now') AS INTEGER) * 1000000)
);
CREATE TABLE source_batch_items (
  batch_id INTEGER NOT NULL REFERENCES source_batches(id) ON DELETE CASCADE,
  position INTEGER NOT NULL,
  source_id INTEGER NOT NULL REFERENCES sources(id),
  state TEXT NOT NULL DEFAULT 'pending' CHECK(state IN ('pending','transcribing','selecting','completed','paused','cancelled')),
  error_code TEXT,
  transcription_job INTEGER,
  selection_run INTEGER,
  PRIMARY KEY(batch_id, position)
);
ALTER TABLE transcription_calls ADD COLUMN created_at INTEGER NOT NULL DEFAULT 0;
CREATE TRIGGER transcription_calls_stamp AFTER INSERT ON transcription_calls WHEN NEW.created_at=0 BEGIN UPDATE transcription_calls SET created_at=CAST(strftime('%s','now') AS INTEGER) * 1000000 WHERE id=NEW.id; END;
" } }

const MAX_SOURCES: usize = 500;

fn error(code: &str, message: &str) -> CoreError {
    CoreError {
        code: code.into(),
        message: message.into(),
        usage: None,
    }
}

fn batch_key(id: i64) -> String {
    format!("sources-{id}")
}

// ---------------------------------------------------------------- leitura

struct Batch {
    id: i64,
    key: String,
    state: String,
    engine: String,
    min_us: Option<i64>,
    max_us: Option<i64>,
    /// Tipo de vídeo escolhido na criação (#67); cada Fonte do lote herda.
    video_kind: String,
}

#[derive(Clone)]
struct Item {
    position: i64,
    source_id: i64,
    state: String,
    error: Option<String>,
    job: Option<i64>,
    run: Option<i64>,
}

fn read_batch(id: i64) -> Result<Batch, CoreError> {
    projects::with_reader(|c| {
        c.query_row(
            "SELECT id,key,state,engine,min_us,max_us,video_kind FROM source_batches WHERE id=?1",
            [id],
            |r| {
                Ok(Batch {
                    id: r.get(0)?,
                    key: r.get(1)?,
                    state: r.get(2)?,
                    engine: r.get(3)?,
                    min_us: r.get(4)?,
                    max_us: r.get(5)?,
                    video_kind: r.get(6)?,
                })
            },
        )
    })
    .map_err(|_| error("batch_not_found", "Lote de Fontes não encontrado."))
}

fn read_items(batch: i64) -> Result<Vec<Item>, CoreError> {
    projects::with_reader(|c| {
        let mut q = c.prepare("SELECT position,source_id,state,error_code,transcription_job,selection_run FROM source_batch_items WHERE batch_id=?1 ORDER BY position")?;
        let rows = q.query_map([batch], |r| {
            Ok(Item {
                position: r.get(0)?,
                source_id: r.get(1)?,
                state: r.get(2)?,
                error: r.get(3)?,
                job: r.get(4)?,
                run: r.get(5)?,
            })
        })?;
        rows.collect::<rusqlite::Result<Vec<_>>>()
    })
}

/// Motivo da pausa do lote em `ai_pauses` (`user`, `budget_*` ou `cost_unknown`).
fn pause_reason(key: &str) -> Result<Option<String>, CoreError> {
    projects::with_reader(|c| {
        c.query_row(
            "SELECT reason FROM ai_pauses WHERE scope='batch' AND key=?1",
            [key],
            |r| r.get(0),
        )
        .optional()
    })
}

fn emit(batch: i64, step: &str, message: &str, error: Option<CoreError>) {
    let project = projects::with_reader(|c| {
        c.query_row("SELECT id FROM queue_project_identity", [], |r| {
            r.get::<_, String>(0)
        })
    })
    .ok();
    crate::emit_background(crate::ProgressEvent {
        job: format!("batch-{batch}"),
        project,
        stage: format!("batch:{step}"),
        percentage: 0,
        message: message.into(),
        error,
    });
}

// ---------------------------------------------------------------- classificação

/// Falhas que são só daquela Janela (resposta ruim, orçamento): as outras Janelas da Fonte
/// seguem. Qualquer outro código é do Provedor ou da chamada e para as Janelas ainda na fila.
fn window_specific(code: &str) -> bool {
    matches!(
        code,
        "verification_failed"
            | "output_invalid"
            | "invalid_json"
            | "context_truncated"
            | "output_truncated"
            | "cancelled"
    ) || code.starts_with("budget_")
}

/// Código fixo e curto; qualquer outra coisa vira o `fallback` (nunca texto do modelo).
fn fixed_code(raw: Option<&str>, fallback: &str) -> String {
    raw.filter(|c| {
        !c.is_empty()
            && c.len() <= 48
            && c.chars()
                .all(|ch| ch.is_ascii_lowercase() || ch == '_' || ch.is_ascii_digit())
    })
    .unwrap_or(fallback)
    .to_owned()
}

enum Derived {
    /// O item continua como está.
    Same,
    Set(&'static str, Option<String>),
    /// A Transcrição está completa e a seleção ainda não começou.
    ReadyToSelect,
}

fn job_row(id: i64) -> Option<(String, Option<String>)> {
    projects::with_reader(|c| {
        c.query_row(
            "SELECT state,json_extract(result,'$.code') FROM jobs WHERE id=?1",
            [id],
            |r| Ok((r.get(0)?, r.get(1)?)),
        )
        .optional()
    })
    .ok()
    .flatten()
}

fn transcript_complete(source: i64) -> bool {
    projects::with_reader(|c| {
        c.query_row(
            "SELECT 1 FROM transcripts t JOIN sources s ON s.id=t.source_id AND s.audio_track=t.audio_track WHERE t.source_id=?1 AND t.state='complete'",
            [source],
            |_| Ok(()),
        )
        .optional()
    })
    .ok()
    .flatten()
    .is_some()
}

/// Execução de seleção do lote para a Transcrição da Fonte (a mais recente), se já existe.
fn existing_run(key: &str, source: i64) -> Option<i64> {
    projects::with_reader(|c| {
        c.query_row(
            "SELECT r.id FROM selection_runs r JOIN transcripts t ON t.id=r.transcript_id WHERE r.batch=?1 AND t.source_id=?2 ORDER BY r.id DESC LIMIT 1",
            (key, source),
            |r| r.get(0),
        )
        .optional()
    })
    .ok()
    .flatten()
}

/// Estado de uma execução: o código do primeiro job que falhou e se o Provedor falhou.
struct RunFacts {
    state: String,
    first_failure: Option<String>,
    provider_failure: bool,
}

fn run_facts(run: i64) -> Option<RunFacts> {
    projects::with_reader(|c| {
        let state: String =
            c.query_row("SELECT state FROM selection_runs WHERE id=?1", [run], |r| {
                r.get(0)
            })?;
        let mut q = c.prepare("SELECT j.state,json_extract(j.result,'$.code') FROM selection_windows w LEFT JOIN jobs j ON j.id=w.job_id WHERE w.run_id=?1 ORDER BY w.idx")?;
        let rows = q.query_map([run], |r| {
            Ok((r.get::<_, Option<String>>(0)?, r.get::<_, Option<String>>(1)?))
        })?;
        let mut first_failure = None;
        let mut provider_failure = false;
        for row in rows {
            let (job_state, code) = row?;
            let code = match job_state.as_deref() {
                Some("failed") => fixed_code(code.as_deref(), "failed"),
                Some("uncertain") => fixed_code(code.as_deref(), "timeout_uncertain"),
                Some("cancelled") => "cancelled".into(),
                None => "not_started".into(),
                _ => continue,
            };
            provider_failure |= !window_specific(&code) && code != "not_started";
            first_failure.get_or_insert(code);
        }
        Ok(RunFacts {
            state,
            first_failure,
            provider_failure,
        })
    })
    .ok()
}

/// Cancela as Janelas ainda na fila de uma Fonte cujo Provedor falhou, para não gastar chamadas
/// que vão falhar do mesmo jeito. Só as Janelas daquela execução; as outras Fontes não mudam.
fn stop_queued_windows(run: i64) {
    let _ = projects::with_writer(|c| {
        c.execute(
            "UPDATE jobs SET state='cancelled' WHERE state='queued' AND id IN (SELECT job_id FROM selection_windows WHERE run_id=?1 AND job_id IS NOT NULL)",
            [run],
        )?;
        Ok(())
    });
    // `selection.get` fecha a execução (parcial) quando nenhuma Janela está pendente.
    let _ = crate::dispatch("selection.get", json!({"run": run}), &mut |_| {});
}

/// O estado verdadeiro do item, lido dos jobs e das execuções.
fn derive(item: &Item) -> Derived {
    if matches!(item.state.as_str(), "completed" | "cancelled") {
        return Derived::Same;
    }
    if let Some(run) = item.run {
        let Some(mut facts) = run_facts(run) else {
            return Derived::Same;
        };
        if facts.state == "running" && facts.provider_failure {
            stop_queued_windows(run);
            if let Some(next) = run_facts(run) {
                facts = next;
            }
        }
        return match facts.state.as_str() {
            "completed" => Derived::Set("completed", None),
            "partial" => Derived::Set(
                "paused",
                Some(
                    facts
                        .first_failure
                        .unwrap_or_else(|| "selection_windows_failed".into()),
                ),
            ),
            _ => Derived::Set("selecting", None),
        };
    }
    if transcript_complete(item.source_id) {
        // Uma Fonte pausada sem execução (a seleção foi recusada) espera o usuário.
        return if item.state == "paused" {
            Derived::Same
        } else {
            Derived::ReadyToSelect
        };
    }
    let Some(job) = item.job else {
        return Derived::Same;
    };
    match job_row(job) {
        Some((state, code)) => match state.as_str() {
            "queued" | "running" => Derived::Set("transcribing", None),
            "failed" => Derived::Set(
                "paused",
                Some(fixed_code(code.as_deref(), "transcription_failed")),
            ),
            "uncertain" => Derived::Set(
                "paused",
                Some(fixed_code(code.as_deref(), "timeout_uncertain")),
            ),
            "cancelled" => Derived::Set("paused", Some("cancelled".into())),
            _ => Derived::Set("paused", Some("transcription_incomplete".into())),
        },
        None => Derived::Same,
    }
}

// ---------------------------------------------------------------- escrita do item

fn set_item(
    batch: i64,
    position: i64,
    from: &str,
    state: &str,
    error: Option<&str>,
    job: Option<i64>,
    run: Option<i64>,
) -> bool {
    projects::with_writer(|c| {
        Ok(c.execute(
            "UPDATE source_batch_items SET state=?4,error_code=?5,transcription_job=COALESCE(?6,transcription_job),selection_run=COALESCE(?7,selection_run) WHERE batch_id=?1 AND position=?2 AND state=?3",
            rusqlite::params![batch, position, from, state, error, job, run],
        )? == 1)
    })
    .unwrap_or(false)
}

/// Começa uma Fonte `pending` ou retomada. `user_confirmed` só vem de um comando do usuário
/// (nunca do `tick`) e libera a repetição de uma chamada de Transcrição incerta.
fn start_item(batch: &Batch, item: &Item, user_confirmed: bool) -> Result<(), CoreError> {
    let from = item.state.as_str();
    if transcript_complete(item.source_id) {
        // Uma Transcrição completa não passa por `transcription.start`: a Fonte pode até estar
        // offline, e a seleção só lê as Frases do Projeto.
        let run = match existing_run(&batch.key, item.source_id) {
            Some(run) => run,
            None => {
                let mut args = json!({"source_id": item.source_id, "confirmed": true, "batch": batch.key, "videoKind": batch.video_kind});
                if let Some(min) = batch.min_us {
                    args["minUs"] = json!(min);
                }
                if let Some(max) = batch.max_us {
                    args["maxUs"] = json!(max);
                }
                let started = crate::dispatch("selection.start", args, &mut |_| {})?;
                started["run"]
                    .as_i64()
                    .ok_or_else(|| error("selection_failed", "A seleção não começou."))?
            }
        };
        set_item(
            batch.id,
            item.position,
            from,
            "selecting",
            None,
            None,
            Some(run),
        );
        return Ok(());
    }
    let current = crate::dispatch("projects.current", json!({}), &mut |_| {})?;
    let project = current["path"]
        .as_str()
        .ok_or_else(|| error("project_not_open", "Nenhum Projeto aberto."))?
        .to_owned();
    let existing_engine: Option<String> = projects::with_reader(|c| {
        c.query_row(
            "SELECT engine FROM transcripts WHERE source_id=?1 LIMIT 1",
            [item.source_id],
            |r| r.get(0),
        )
        .optional()
    })?;
    let engine = existing_engine.unwrap_or_else(|| batch.engine.clone());
    let mut args = json!({"project": project, "source_id": item.source_id, "engine": engine, "batch": batch.key});
    if user_confirmed {
        args["retry_confirmed"] = json!(true);
    }
    let started = crate::dispatch("transcription.start", args, &mut |_| {})?;
    let job = started["job_id"].as_i64();
    set_item(
        batch.id,
        item.position,
        from,
        "transcribing",
        None,
        job,
        None,
    );
    Ok(())
}

/// Códigos que pedem uma confirmação do usuário: a Fonte espera por ele, nunca é repetida às cegas.
fn pause_with(batch: &Batch, item: &Item, e: &CoreError) {
    set_item(
        batch.id,
        item.position,
        &item.state,
        "paused",
        Some(&fixed_code(Some(&e.code), "failed")),
        None,
        None,
    );
    emit(
        batch.id,
        "item-paused",
        "Fonte do lote pausada",
        Some(e.clone()),
    );
}

// ---------------------------------------------------------------- o avanço

/// Chamado pelo thread da fila a cada volta: reconcilia todos os lotes ativos.
pub(crate) fn tick() {
    let Ok(_job) = projects::start_job() else {
        return;
    };
    let ids: Vec<i64> = projects::with_reader(|c| {
        let mut q = c.prepare(
            "SELECT id FROM source_batches WHERE state IN ('running','paused') ORDER BY id",
        )?;
        let rows = q.query_map([], |r| r.get(0))?;
        rows.collect::<rusqlite::Result<Vec<_>>>()
    })
    .unwrap_or_default();
    for id in ids {
        let _ = step(id);
    }
}

fn step(id: i64) -> Result<(), CoreError> {
    let batch = read_batch(id)?;
    let mut items = read_items(id)?;
    for item in &mut items {
        let derived = derive(item);
        match derived {
            Derived::Same => {}
            Derived::Set(state, code) => {
                if (state, code.as_deref()) != (item.state.as_str(), item.error.as_deref())
                    && set_item(
                        id,
                        item.position,
                        &item.state,
                        state,
                        code.as_deref(),
                        None,
                        None,
                    )
                {
                    emit(id, "item", "Fonte do lote atualizada", None);
                    item.state = state.into();
                    item.error = code;
                }
            }
            Derived::ReadyToSelect => {
                // A Transcrição já está pronta; a seleção começa abaixo (ou espera a vez).
                if item.state == "transcribing" {
                    set_item(id, item.position, &item.state, "pending", None, None, None);
                    item.state = "pending".into();
                    item.error = None;
                }
            }
        }
    }
    if items
        .iter()
        .all(|i| matches!(i.state.as_str(), "completed" | "cancelled"))
    {
        projects::with_writer(|c| {
            c.execute("UPDATE source_batches SET state='completed' WHERE id=?1 AND state IN ('running','paused')", [id])?;
            c.execute(
                "DELETE FROM ai_pauses WHERE scope='batch' AND key=?1 AND reason='user'",
                [&batch.key],
            )?;
            Ok(())
        })?;
        emit(id, "completed", "Lote de Fontes concluído", None);
        return Ok(());
    }
    if batch.state != "running" || pause_reason(&batch.key)?.is_some() {
        return Ok(());
    }
    if items
        .iter()
        .any(|i| matches!(i.state.as_str(), "transcribing" | "selecting"))
    {
        return Ok(());
    }
    // Só uma Fonte por vez: a primeira que ainda não começou.
    if let Some(item) = items.iter().find(|i| i.state == "pending") {
        if let Err(e) = start_item(&batch, item, false) {
            pause_with(&batch, item, &e);
        }
    }
    Ok(())
}

// ---------------------------------------------------------------- comandos

fn batch_id(v: &Value) -> Result<i64, CoreError> {
    v["id"]
        .as_i64()
        .ok_or_else(|| error("batch_not_found", "Lote de Fontes não encontrado."))
}

fn item_json(batch: &Batch, item: &Item) -> Value {
    let name = projects::with_reader(|c| {
        c.query_row(
            "SELECT path FROM sources WHERE id=?1",
            [item.source_id],
            |r| r.get::<_, String>(0),
        )
    })
    .ok()
    .and_then(|p| {
        std::path::Path::new(&p)
            .file_name()
            .map(|n| n.to_string_lossy().into_owned())
    });
    let progress = match (item.state.as_str(), item.job, item.run) {
        ("transcribing", Some(job), _) => projects::with_reader(|c| {
            c.query_row("SELECT progress FROM jobs WHERE id=?1", [job], |r| {
                r.get::<_, i64>(0)
            })
        })
        .ok(),
        ("selecting", _, Some(run)) => projects::with_reader(|c| {
            c.query_row(
                "SELECT CASE WHEN windows_total=0 THEN 0 ELSE windows_completed*100/windows_total END FROM selection_runs WHERE id=?1",
                [run],
                |r| r.get::<_, i64>(0),
            )
        })
        .ok(),
        _ => None,
    };
    json!({
        "position": item.position, "sourceId": item.source_id, "name": name,
        "state": item.state, "error": item.error, "transcriptionJob": item.job,
        "selectionRun": item.run, "progress": progress, "engine": batch.engine,
    })
}

fn view(id: i64) -> Result<Value, CoreError> {
    let batch = read_batch(id)?;
    let items = read_items(id)?;
    let pause = pause_reason(&batch.key)?;
    let budget = crate::dispatch("jobs.budget.get", json!({}), &mut |_| {})?["budgets"]
        .as_array()
        .and_then(|list| {
            list.iter()
                .find(|b| b["scope"] == "batch" && b["key"] == batch.key.as_str())
                .cloned()
        })
        .unwrap_or(Value::Null);
    let count = |states: &[&str]| {
        items
            .iter()
            .filter(|i| states.contains(&i.state.as_str()))
            .count()
    };
    let (done, paused, active, pending, cancelled) = (
        count(&["completed"]),
        count(&["paused"]),
        count(&["transcribing", "selecting"]),
        count(&["pending"]),
        count(&["cancelled"]),
    );
    let status = if batch.state == "cancelled" {
        "cancelled"
    } else if batch.state == "completed" || done + cancelled == items.len() {
        "completed"
    } else if batch.state == "paused" || pause.as_deref() == Some("user") {
        "paused"
    } else if pause.is_some() {
        "budget_paused"
    } else if active + pending == 0 {
        "attention"
    } else {
        "running"
    };
    Ok(json!({
        "id": batch.id, "key": batch.key, "state": batch.state, "status": status,
        "engine": batch.engine, "minUs": batch.min_us, "maxUs": batch.max_us, "videoKind": batch.video_kind,
        "pause": pause, "budget": budget,
        "counts": {"total": items.len(), "completed": done, "paused": paused, "active": active, "pending": pending, "cancelled": cancelled},
        "items": items.iter().map(|i| item_json(&batch, i)).collect::<Vec<_>>(),
    }))
}

/// `batches.create {sourceIds, engine?, videoKind?, minUs?, maxUs?, maxCostMicroUsd?, confirmed?}`.
///
/// Recusa antes de criar qualquer coisa se o veto "somente local" ou a rota da seleção barram o
/// lote. Com seleção paga (ou áudio pago no Groq) exige `confirmed: true`: a confirmação vale
/// para o lote inteiro, dentro do teto e das checagens por chamada do #124 (as estimativas por
/// Fonte só existem depois da Transcrição).
fn cmd_create(v: Value, _: &mut EventSink<'_>) -> CommandResult {
    let ids: Vec<i64> = v["sourceIds"]
        .as_array()
        .map(|a| a.iter().filter_map(Value::as_i64).collect())
        .unwrap_or_default();
    let mut unique = Vec::new();
    for id in ids {
        if !unique.contains(&id) {
            unique.push(id);
        }
    }
    if unique.is_empty() || unique.len() > MAX_SOURCES {
        return Err(error("invalid_batch", "Escolha de 1 a 500 Fontes."));
    }
    let engine = match v["engine"].as_str() {
        None | Some("local") => "local",
        Some("groq") => "groq",
        _ => return Err(error("invalid_engine", "Motor de transcrição inválido.")),
    };
    let known = projects::with_reader(|c| {
        let mut count = 0i64;
        for id in &unique {
            count += c.query_row("SELECT COUNT(*) FROM sources WHERE id=?1", [id], |r| {
                r.get::<_, i64>(0)
            })?;
        }
        Ok(count)
    })?;
    if known != unique.len() as i64 {
        return Err(error("source_missing", "Fonte não encontrada"));
    }
    let cap = match v.get("maxCostMicroUsd") {
        None | Some(Value::Null) => None,
        Some(n) => Some(
            n.as_i64()
                .filter(|n| *n >= 0)
                .ok_or_else(|| error("invalid_budget", "Orçamento inválido."))?,
        ),
    };
    let range = |name: &str| -> Result<Option<i64>, CoreError> {
        match v.get(name) {
            None | Some(Value::Null) => Ok(None),
            Some(n) => n
                .as_i64()
                .filter(|n| *n > 0)
                .map(Some)
                .ok_or_else(|| error("invalid_batch", "Faixa de Corte inválida.")),
        }
    };
    let (min_us, max_us) = (range("minUs")?, range("maxUs")?);
    let kind = crate::selection::parse_kind(&v)?;
    let (profile, safety) = crate::selection::route_safety()?;
    if engine == "groq" && projects::project_local_only()? {
        return Err(crate::provider::local_only_violation());
    }
    let paid = matches!(safety, jobs::Safety::Paid) || engine == "groq";
    if paid && v["confirmed"] != true {
        let mut audio_estimate = Some(0i64);
        if engine == "groq" {
            for source in &unique {
                if !transcript_complete(*source) {
                    let estimate = crate::dispatch(
                        "transcription.groq.estimate",
                        json!({"source_id":source}),
                        &mut |_| {},
                    )?;
                    audio_estimate = audio_estimate
                        .zip(estimate["maxMicroUsd"].as_i64())
                        .map(|(total, next)| total.saturating_add(next));
                }
            }
        }
        return Err(CoreError {
            code: "confirmation_required".into(),
            message: "Este lote usa um serviço pago: confirme antes de começar.".into(),
            usage: Some(json!({
                "selectionPaid": matches!(safety, jobs::Safety::Paid),
                "transcriptionPaid": engine == "groq",
                "audioEstimateMicroUsd": audio_estimate,
                "profile": profile,
                "maxCostMicroUsd": cap,
                "sources": unique.len(),
            })),
        });
    }
    let id = projects::with_writer(|c| {
        let tx = c.transaction()?;
        tx.execute(
            "INSERT INTO source_batches(key,engine,min_us,max_us,video_kind) VALUES ('',?1,?2,?3,?4)",
            (engine, min_us, max_us, kind.as_str()),
        )?;
        let id = tx.last_insert_rowid();
        tx.execute(
            "UPDATE source_batches SET key=?2 WHERE id=?1",
            (id, batch_key(id)),
        )?;
        for (position, source) in unique.iter().enumerate() {
            tx.execute(
                "INSERT INTO source_batch_items(batch_id,position,source_id) VALUES (?1,?2,?3)",
                (id, position as i64, source),
            )?;
        }
        if let Some(cap) = cap {
            tx.execute(
                "INSERT INTO ai_budgets(scope,key,max_cost_micro_usd,since) VALUES ('batch',?1,?2,?3)",
                (batch_key(id), cap, crate::provider::cost::now_micros()),
            )?;
        }
        tx.commit()?;
        Ok(id)
    })?;
    emit(id, "created", "Lote de Fontes criado", None);
    view(id)
}

fn cmd_get(v: Value, _: &mut EventSink<'_>) -> CommandResult {
    view(batch_id(&v)?)
}

fn cmd_list(_: Value, _: &mut EventSink<'_>) -> CommandResult {
    let ids: Vec<i64> = projects::with_reader(|c| {
        let mut q = c.prepare("SELECT id FROM source_batches ORDER BY id DESC")?;
        let rows = q.query_map([], |r| r.get(0))?;
        rows.collect::<rusqlite::Result<Vec<_>>>()
    })?;
    let mut out = Vec::new();
    for id in ids {
        out.push(view(id)?);
    }
    Ok(json!(out))
}

/// `batches.pause {id}`: nenhuma Fonte nova começa e nenhum job do lote sai da fila; o que já
/// está em execução termina (uma chamada paga em voo não é cortada).
fn cmd_pause(v: Value, _: &mut EventSink<'_>) -> CommandResult {
    let batch = read_batch(batch_id(&v)?)?;
    if batch.state == "cancelled" {
        return Err(error("invalid_batch_state", "O lote foi cancelado."));
    }
    projects::with_writer(|c| {
        c.execute(
            "UPDATE source_batches SET state='paused' WHERE id=?1",
            [batch.id],
        )?;
        c.execute(
            "INSERT INTO ai_pauses(scope,key,reason) VALUES ('batch',?1,'user') ON CONFLICT(scope,key) DO NOTHING",
            [&batch.key],
        )?;
        Ok(())
    })?;
    emit(batch.id, "paused", "Lote pausado", None);
    view(batch.id)
}

/// `batches.resume {id}`: tira a pausa do usuário. Pausa por teto ou por custo desconhecido
/// continua com `jobs.budget.continue` (que aceita o novo teto e a confirmação).
fn cmd_resume(v: Value, _: &mut EventSink<'_>) -> CommandResult {
    let batch = read_batch(batch_id(&v)?)?;
    if batch.state == "cancelled" {
        return Err(error("invalid_batch_state", "O lote foi cancelado."));
    }
    projects::with_writer(|c| {
        c.execute(
            "UPDATE source_batches SET state='running' WHERE id=?1",
            [batch.id],
        )?;
        c.execute(
            "DELETE FROM ai_pauses WHERE scope='batch' AND key=?1 AND reason='user'",
            [&batch.key],
        )?;
        Ok(())
    })?;
    emit(batch.id, "resumed", "Lote retomado", None);
    view(batch.id)
}

/// `batches.cancel {id}`: cancela o que ainda não terminou; resultados já gravados ficam.
fn cmd_cancel(v: Value, _: &mut EventSink<'_>) -> CommandResult {
    let batch = read_batch(batch_id(&v)?)?;
    let items = read_items(batch.id)?;
    projects::with_writer(|c| {
        c.execute(
            "UPDATE source_batches SET state='cancelled' WHERE id=?1",
            [batch.id],
        )?;
        c.execute(
            "DELETE FROM ai_pauses WHERE scope='batch' AND key=?1 AND reason='user'",
            [&batch.key],
        )?;
        for item in &items {
            if let Some(job) = item.job {
                c.execute("UPDATE jobs SET state=CASE WHEN state='queued' THEN 'cancelled' ELSE state END, cancel_requested=1 WHERE id=?1 AND state IN ('queued','running')", [job])?;
            }
        }
        Ok(())
    })?;
    for item in &items {
        if let Some(run) = item.run {
            let _ = crate::dispatch("selection.cancel", json!({"run": run}), &mut |_| {});
        }
    }
    projects::with_writer(|c| {
        c.execute(
            "UPDATE source_batch_items SET state='cancelled' WHERE batch_id=?1 AND state NOT IN ('completed')",
            [batch.id],
        )?;
        Ok(())
    })?;
    emit(batch.id, "cancelled", "Lote cancelado", None);
    view(batch.id)
}

/// `batches.item.resume {id, sourceId, confirmed?}`: retoma uma Fonte pausada, depois de o
/// usuário trocar o perfil ou corrigir o problema. Nunca repete uma chamada paga incerta: com um
/// job `uncertain` o erro é `uncertain_job` (resolva na lista de tarefas, com o custo). A
/// repetição de uma Janela ou de uma Transcrição paga pede `confirmed: true` depois de mostrar o
/// custo (`confirmation_required` com `usage.estimate`).
fn cmd_item_resume(v: Value, _: &mut EventSink<'_>) -> CommandResult {
    let batch = read_batch(batch_id(&v)?)?;
    if batch.state == "cancelled" {
        return Err(error("invalid_batch_state", "O lote foi cancelado."));
    }
    let source = v["sourceId"]
        .as_i64()
        .ok_or_else(|| error("source_missing", "Fonte não encontrada"))?;
    let item = read_items(batch.id)?
        .into_iter()
        .find(|i| i.source_id == source)
        .ok_or_else(|| error("source_missing", "Fonte não encontrada"))?;
    if item.state != "paused" {
        return Err(error(
            "invalid_item_state",
            "A Fonte do lote não está pausada.",
        ));
    }
    let confirmed = v["confirmed"] == true;
    if let Some(run) = item.run {
        let mut args = json!({"run": run});
        if confirmed {
            args["confirmed"] = json!(true);
        }
        crate::dispatch("selection.resume", args, &mut |_| {})?;
        set_item(
            batch.id,
            item.position,
            "paused",
            "selecting",
            None,
            None,
            None,
        );
    } else {
        if let Some(job) = item.job {
            if job_row(job).is_some_and(|(state, _)| state == "uncertain") {
                return Err(error(
                    "uncertain_job",
                    "O resultado da chamada é incerto. Repetir pode gerar nova cobrança: resolva na lista de tarefas.",
                ));
            }
        }
        if let Err(e) = start_item(&batch, &item, confirmed) {
            let confirmation = matches!(
                e.code.as_str(),
                "transcription_retry_confirmation" | "confirmation_required"
            );
            if !confirmation {
                set_item(
                    batch.id,
                    item.position,
                    "paused",
                    "paused",
                    Some(&fixed_code(Some(&e.code), "failed")),
                    None,
                    None,
                );
            }
            return Err(e);
        }
    }
    view(batch.id)
}

inventory::submit! { CommandRegistration { name: "batches.create", execute: cmd_create } }
inventory::submit! { CommandRegistration { name: "batches.get", execute: cmd_get } }
inventory::submit! { CommandRegistration { name: "batches.list", execute: cmd_list } }
inventory::submit! { CommandRegistration { name: "batches.pause", execute: cmd_pause } }
inventory::submit! { CommandRegistration { name: "batches.resume", execute: cmd_resume } }
inventory::submit! { CommandRegistration { name: "batches.cancel", execute: cmd_cancel } }
inventory::submit! { CommandRegistration { name: "batches.item.resume", execute: cmd_item_resume } }
