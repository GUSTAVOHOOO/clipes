//! Ideia de thumbnail e capa (#74): uma Tarefa de IA sugere um momento do Corte para a capa; o
//! Provedor recebe só texto (Frases com IDs) e devolve o ID de uma Frase e uma justificativa
//! curta. O NÚCLEO converte esse ID num instante dentro do Corte; um ID fora do Corte é rejeitado
//! por verificador. O quadro é extraído localmente com FFmpeg, no tamanho nativo da Fonte, sem
//! recorte e sem texto por cima. Veja `docs/contribuindo/capa.md`.
//!
//! O instante escolhido (do Provedor ou do usuário) fica no Projeto por candidato, com o histórico
//! de sugestões (migração `0074_001_thumbnail`). A rota e o veto "somente local" são os do
//! empacotamento (`ai_task::routing_id`).
use crate::{
    ai_task::{self, AiTask, Budget, TaskInput, Violation},
    jobs::{self, Safety},
    projects, provider,
    sentences::{self, Sentence},
    CommandRegistration, CommandResult, CoreError, EventSink,
};
use serde_json::{json, Value};
use std::{
    ffi::OsString,
    io::Read,
    path::{Path, PathBuf},
    time::{Duration, Instant},
};

pub const TASK_ID: &str = "thumbnail";
pub const JOB_KIND: &str = "ai:thumbnail";
/// Tamanho máximo da justificativa, em caracteres.
pub const MAX_WHY_CHARS: usize = 200;
/// Tempo máximo para extrair um quadro.
const EXTRACT_TIMEOUT: Duration = Duration::from_secs(60);

const PROMPT: &str = include_str!("thumbnail/prompt.md");
const WIRE: &str = include_str!("thumbnail/wire.json");
const FULL: &str = include_str!("thumbnail/full.json");

fn error(code: &str, message: &str) -> CoreError {
    CoreError {
        code: code.into(),
        message: message.into(),
        usage: None,
    }
}

fn v(code: &'static str, path: &str, message: &'static str) -> Violation {
    Violation::new(code, path, message)
}

// ---------------------------------------------------------------- verificadores

/// O ID tem de ser de uma Frase do Corte (o núcleo guarda a lista no contexto, nunca no prompt).
fn sentence_in_cut(input: &TaskInput, output: &Value) -> Vec<Violation> {
    let Some(id) = output["sentenceId"].as_i64() else {
        return vec![v("schema", "/sentenceId", "Sentence ID is not an integer")];
    };
    let known = input.context["sentenceIds"]
        .as_array()
        .is_some_and(|ids| ids.iter().any(|x| x.as_i64() == Some(id)));
    if known {
        Vec::new()
    } else {
        vec![v(
            "sentence_outside_cut",
            "/sentenceId",
            "Sentence is not part of the Cut",
        )]
    }
}

fn why_valid(_: &TaskInput, output: &Value) -> Vec<Violation> {
    let why = output["why"].as_str().unwrap_or("").trim();
    let lower = why.to_lowercase();
    let mut out = Vec::new();
    if why.is_empty() {
        out.push(v("why_empty", "/why", "Reason is empty"));
    } else if why.chars().count() > MAX_WHY_CHARS {
        out.push(v("why_too_long", "/why", "Reason is too long"));
    }
    if why.contains(['<', '>']) {
        out.push(v(
            "forbidden_character",
            "/why",
            "Text contains a forbidden character",
        ));
    }
    if ["http://", "https://", "://", "www."]
        .iter()
        .any(|m| lower.contains(m))
    {
        out.push(v("invented_url", "/why", "Text contains a URL"));
    }
    out
}

inventory::submit! {
    AiTask {
        id: TASK_ID,
        version: 1,
        prompt: PROMPT,
        prompt_sha256: "f7c54202c96bf601c6b0bd3bbbcb7913638aa3219b2428e8980bcb6f33ae0766",
        wire_schema: WIRE,
        full_schema: FULL,
        verifiers: &[sentence_in_cut, why_valid],
        budget: Budget {
            max_calls: 2,
            max_input_tokens: 30_000,
            max_output_tokens: 300,
            max_wall_clock_secs: 300,
            max_cost_micro_cents: None,
        },
    }
}

fn task() -> &'static AiTask {
    ai_task::find(TASK_ID).expect("thumbnail task is registered")
}

// ---------------------------------------------------------------- persistência

inventory::submit! { projects::Migration { id: "0074_001_thumbnail", sql: "
CREATE TABLE thumbnail_suggestions (
  id INTEGER PRIMARY KEY,
  job_id INTEGER NOT NULL UNIQUE,
  run_id INTEGER NOT NULL REFERENCES selection_runs(id) ON DELETE CASCADE,
  cand_start_id INTEGER NOT NULL,
  cand_end_id INTEGER NOT NULL,
  task_version INTEGER NOT NULL,
  prompt_sha256 TEXT NOT NULL,
  profile TEXT NOT NULL DEFAULT '',
  sentence_id INTEGER,
  instant_us INTEGER,
  why TEXT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE INDEX thumbnail_suggestions_cut ON thumbnail_suggestions(run_id, cand_start_id, cand_end_id, id);
CREATE TABLE thumbnail_choices (
  id INTEGER PRIMARY KEY,
  run_id INTEGER NOT NULL REFERENCES selection_runs(id) ON DELETE CASCADE,
  cand_start_id INTEGER NOT NULL,
  cand_end_id INTEGER NOT NULL,
  instant_us INTEGER NOT NULL,
  origin TEXT NOT NULL CHECK(origin IN ('provider','user')),
  suggestion_id INTEGER REFERENCES thumbnail_suggestions(id) ON DELETE SET NULL,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE INDEX thumbnail_choices_cut ON thumbnail_choices(run_id, cand_start_id, cand_end_id, id);
" } }

struct Context {
    cut: crate::selection::ApprovedCut,
    source: i64,
    /// Limites do Corte (µs): início da primeira e fim da última Frase.
    start_us: i64,
    end_us: i64,
}

fn context(candidate: i64) -> Result<Context, CoreError> {
    let cut = crate::selection::approved_cut(candidate)?;
    let source: i64 = projects::with_reader(|c| {
        c.query_row(
            "SELECT source_id FROM transcripts WHERE id=?1",
            [cut.transcript],
            |r| r.get(0),
        )
    })
    .map_err(|_| error("source_missing", "Fonte não encontrada"))?;
    let (Some(first), Some(last)) = (cut.sentences.first(), cut.sentences.last()) else {
        return Err(error("candidate_not_found", "Candidato não encontrado."));
    };
    let (start_us, end_us) = (first.start_us, last.end_us);
    Ok(Context {
        cut,
        source,
        start_us,
        end_us,
    })
}

fn candidate_arg(v: &Value) -> Result<i64, CoreError> {
    v["candidate"]
        .as_i64()
        .ok_or_else(|| error("candidate_not_found", "Candidato não encontrado."))
}

/// O instante de uma Frase: o meio dela, sempre dentro do Corte.
pub fn instant_of(sentence: &Sentence) -> i64 {
    sentence.start_us + (sentence.end_us - sentence.start_us).max(0) / 2
}

fn build_input(frases: &[Sentence]) -> TaskInput {
    let compact = sentences::compact_with_hint(frases);
    let ids: Vec<i64> = frases.iter().map(|s| s.id).collect();
    TaskInput {
        transcript: format!("#CAPA\n{}", compact.text),
        estimate_hint: compact.hint,
        context: json!({ "sentenceIds": ids }),
        native_schema: false,
    }
}

fn route_safety() -> Result<(String, Safety), CoreError> {
    Ok(match provider::routed(Some(TASK_ID), None)? {
        provider::Routed::Cli(name) => (name, Safety::Paid),
        provider::Routed::Api { profile, local } => {
            (profile.id, if local { Safety::Local } else { Safety::Paid })
        }
    })
}

fn estimate_of(input: &TaskInput, safety: Safety) -> Value {
    let paid = matches!(safety, Safety::Paid);
    let unknown = json!({"kind": "unknown", "minMicroUsd": null, "maxMicroUsd": null});
    let Ok((target, profile)) = jobs::route_of_profile(TASK_ID, paid, None) else {
        return unknown;
    };
    let Ok((wire, _)) = ai_task::check_definition(task()) else {
        return unknown;
    };
    let request = provider::StructuredRequest {
        estimate_hint: input.estimate_hint.clone(),
        instruction: ai_task::normalized_prompt(PROMPT),
        transcript: input.transcript.clone(),
        schema: wire,
        native_schema: false,
        max_output_tokens: Some(task().budget.max_output_tokens),
    };
    provider::cost::estimate_for(&target, &profile, &request).unwrap_or(unknown)
}

/// `thumbnail.estimate {candidate}`: se o Provedor é pago e o custo estimado.
fn cmd_estimate(v: Value, _: &mut EventSink<'_>) -> CommandResult {
    let ctx = context(candidate_arg(&v)?)?;
    let (profile, safety) = route_safety()?;
    let input = build_input(&ctx.cut.sentences);
    Ok(json!({
        "paid": matches!(safety, Safety::Paid),
        "profile": profile,
        "estimate": estimate_of(&input, safety),
    }))
}

/// `thumbnail.suggest {candidate, confirmed?}`: enfileira a Tarefa de IA. Provedor pago exige
/// `confirmed`; o veto "somente local" é aplicado pelo executor da fila.
fn cmd_suggest(v: Value, _: &mut EventSink<'_>) -> CommandResult {
    let ctx = context(candidate_arg(&v)?)?;
    let (profile, safety) = route_safety()?;
    let input = build_input(&ctx.cut.sentences);
    if matches!(safety, Safety::Paid) && v["confirmed"] != true {
        return Err(CoreError {
            code: "confirmation_required".into(),
            message:
                "Esta sugestão de capa usa um Provedor pago: confirme o custo estimado antes de gerar."
                    .into(),
            usage: Some(json!({"estimate": estimate_of(&input, safety)})),
        });
    }
    let (run, (start, end)) = (ctx.cut.run, ctx.cut.identity);
    let busy = projects::with_reader(|c| {
        c.query_row(
            "SELECT COUNT(*) FROM thumbnail_suggestions g JOIN jobs j ON j.id=g.job_id WHERE g.run_id=?1 AND g.cand_start_id=?2 AND g.cand_end_id=?3 AND j.state IN ('queued','running')",
            (run, start, end),
            |r| r.get::<_, i64>(0),
        )
    })?;
    if busy > 0 {
        return Err(error(
            "suggestion_in_progress",
            "Já há uma sugestão de capa em andamento para este Corte.",
        ));
    }
    let definition = task();
    let batch = format!("thumbnail-{run}-{start}-{end}");
    let job = jobs::enqueue_ai_in_batch(TASK_ID, &input, safety, Some(&batch))?;
    projects::with_writer(|c| {
        c.execute(
            "INSERT INTO thumbnail_suggestions(job_id,run_id,cand_start_id,cand_end_id,task_version,prompt_sha256,profile) VALUES (?1,?2,?3,?4,?5,?6,?7)",
            (job, run, start, end, definition.version, definition.prompt_sha256, &profile),
        )?;
        Ok(())
    })?;
    Ok(json!({"job": job}))
}

/// Grava a saída dos jobs concluídos que ainda não viraram sugestão: converte o ID da Frase num
/// instante do Corte (o que sai do Corte é descartado) e a torna a escolha atual. Idempotente.
fn materialize(ctx: &Context) -> Result<(), CoreError> {
    let (run, (start, end)) = (ctx.cut.run, ctx.cut.identity);
    projects::with_writer(|c| {
        let mut q = c.prepare(
            "SELECT g.id,j.result FROM thumbnail_suggestions g JOIN jobs j ON j.id=g.job_id WHERE g.run_id=?1 AND g.cand_start_id=?2 AND g.cand_end_id=?3 AND g.sentence_id IS NULL AND j.state='completed' ORDER BY g.id",
        )?;
        let rows: Vec<(i64, Option<String>)> = q
            .query_map((run, start, end), |r| Ok((r.get(0)?, r.get(1)?)))?
            .collect::<rusqlite::Result<_>>()?;
        for (id, result) in rows {
            let data = result
                .and_then(|t| serde_json::from_str::<Value>(&t).ok())
                .map(|r| r["data"].clone());
            let Some(data) = data else { continue };
            let (Some(sentence), Some(why)) = (data["sentenceId"].as_i64(), data["why"].as_str())
            else {
                continue;
            };
            let Some(found) = ctx.cut.sentences.iter().find(|s| s.id == sentence) else {
                continue;
            };
            let instant = instant_of(found);
            c.execute(
                "UPDATE thumbnail_suggestions SET sentence_id=?2,instant_us=?3,why=?4 WHERE id=?1",
                (id, sentence, instant, why.trim()),
            )?;
            c.execute(
                "INSERT INTO thumbnail_choices(run_id,cand_start_id,cand_end_id,instant_us,origin,suggestion_id) VALUES (?1,?2,?3,?4,'provider',?5)",
                (run, start, end, instant, id),
            )?;
        }
        Ok(())
    })
}

/// Código de erro do job: só o formato fixo esperado, nunca texto do modelo.
fn job_code(result: &Option<Value>) -> Option<String> {
    result.as_ref()?["code"]
        .as_str()
        .filter(|c| {
            !c.is_empty()
                && c.len() <= 48
                && c.chars()
                    .all(|ch| ch.is_ascii_lowercase() || ch == '_' || ch.is_ascii_digit())
        })
        .map(str::to_owned)
}

fn violation_codes(result: &Option<Value>) -> Vec<String> {
    result
        .as_ref()
        .and_then(|r| r["violations"].as_array())
        .map(|a| {
            a.iter()
                .filter_map(|x| x["code"].as_str())
                .filter(|c| {
                    c.len() <= 48 && c.chars().all(|ch| ch.is_ascii_lowercase() || ch == '_')
                })
                .map(str::to_owned)
                .collect()
        })
        .unwrap_or_default()
}

fn document(ctx: &Context) -> Result<Value, CoreError> {
    materialize(ctx)?;
    let (run, (start, end)) = (ctx.cut.run, ctx.cut.identity);
    projects::with_reader(|c| {
        let mut q = c.prepare(
            "SELECT g.id,g.job_id,g.task_version,g.prompt_sha256,g.profile,g.sentence_id,g.instant_us,g.why,g.created_at,j.state,j.result FROM thumbnail_suggestions g LEFT JOIN jobs j ON j.id=g.job_id WHERE g.run_id=?1 AND g.cand_start_id=?2 AND g.cand_end_id=?3 ORDER BY g.id",
        )?;
        let rows: Vec<(Value, Option<Value>)> = q
            .query_map((run, start, end), |r| {
                let result: Option<String> = r.get(10)?;
                let result: Option<Value> = result.and_then(|t| serde_json::from_str(&t).ok());
                Ok((
                    json!({
                        "id": r.get::<_, i64>(0)?,
                        "jobId": r.get::<_, i64>(1)?,
                        "taskVersion": r.get::<_, i64>(2)?,
                        "promptSha256": r.get::<_, String>(3)?,
                        "profile": r.get::<_, String>(4)?,
                        "sentenceId": r.get::<_, Option<i64>>(5)?,
                        "instantUs": r.get::<_, Option<i64>>(6)?,
                        "why": r.get::<_, Option<String>>(7)?,
                        "createdAt": r.get::<_, String>(8)?,
                        "state": r.get::<_, Option<String>>(9)?,
                    }),
                    result,
                ))
            })?
            .collect::<rusqlite::Result<_>>()?;
        let last_job = rows.last().map(|(s, result)| {
            json!({
                "id": s["jobId"],
                "state": s["state"],
                "code": job_code(result),
                "violations": violation_codes(result),
            })
        });
        let suggestions: Vec<Value> = rows
            .into_iter()
            .map(|(s, _)| s)
            .filter(|s| !s["sentenceId"].is_null())
            .collect();
        let mut q = c.prepare(
            "SELECT id,instant_us,origin,suggestion_id,created_at FROM thumbnail_choices WHERE run_id=?1 AND cand_start_id=?2 AND cand_end_id=?3 ORDER BY id",
        )?;
        let choices: Vec<Value> = q
            .query_map((run, start, end), |r| {
                Ok(json!({
                    "id": r.get::<_, i64>(0)?,
                    "instantUs": r.get::<_, i64>(1)?,
                    "origin": r.get::<_, String>(2)?,
                    "suggestionId": r.get::<_, Option<i64>>(3)?,
                    "createdAt": r.get::<_, String>(4)?,
                }))
            })?
            .collect::<rusqlite::Result<_>>()?;
        let current = choices.last().cloned().map(|mut c| {
            let why = c["suggestionId"]
                .as_i64()
                .and_then(|id| suggestions.iter().find(|s| s["id"] == id))
                .map(|s| s["why"].clone());
            c["why"] = why.unwrap_or(Value::Null);
            c
        });
        Ok(json!({
            "schemaVersion": 1,
            "candidate": {"run": run, "startId": start, "endId": end},
            "source": ctx.source,
            "cut": {"startUs": ctx.start_us, "endUs": ctx.end_us},
            "current": current,
            "job": last_job,
            "suggestions": suggestions,
            "choices": choices,
            "maxWhyChars": MAX_WHY_CHARS,
        }))
    })
}

/// `thumbnail.get {candidate}`: a escolha atual, o último job, as sugestões e o histórico.
fn cmd_get(v: Value, _: &mut EventSink<'_>) -> CommandResult {
    document(&context(candidate_arg(&v)?)?)
}

/// `thumbnail.choose {candidate, instant_us}`: o usuário marca um instante do Corte (o do preview)
/// como capa. Fora do Corte: `instant_out_of_cut`. Repetir o instante atual não grava nada.
fn cmd_choose(v: Value, _: &mut EventSink<'_>) -> CommandResult {
    let ctx = context(candidate_arg(&v)?)?;
    let instant = v["instant_us"]
        .as_i64()
        .filter(|t| (ctx.start_us..=ctx.end_us).contains(t))
        .ok_or_else(|| {
            error(
                "instant_out_of_cut",
                "O instante da capa precisa estar dentro do Corte.",
            )
        })?;
    materialize(&ctx)?;
    let (run, (start, end)) = (ctx.cut.run, ctx.cut.identity);
    projects::with_writer(|c| {
        let last: Option<i64> = c
            .query_row(
                "SELECT instant_us FROM thumbnail_choices WHERE run_id=?1 AND cand_start_id=?2 AND cand_end_id=?3 ORDER BY id DESC LIMIT 1",
                (run, start, end),
                |r| r.get(0),
            )
            .ok();
        if last != Some(instant) {
            c.execute(
                "INSERT INTO thumbnail_choices(run_id,cand_start_id,cand_end_id,instant_us,origin) VALUES (?1,?2,?3,?4,'user')",
                (run, start, end, instant),
            )?;
        }
        Ok(())
    })?;
    document(&ctx)
}

// ---------------------------------------------------------------- export do quadro

fn failed() -> CoreError {
    error(
        "thumbnail_failed",
        "Não foi possível extrair o quadro da capa.",
    )
}

fn validate_output(output: &Path) -> Result<(), CoreError> {
    if output.exists() {
        return Err(error(
            "thumbnail_exists",
            "Já existe um arquivo no destino. Escolha outro nome.",
        ));
    }
    if !output.is_absolute()
        || output
            .extension()
            .is_none_or(|e| !e.eq_ignore_ascii_case("png"))
        || output.parent().is_none_or(|p| !p.is_dir())
    {
        return Err(error(
            "thumbnail_destination",
            "Escolha uma pasta existente e um nome PNG válido.",
        ));
    }
    Ok(())
}

/// Argumentos do FFmpeg: um quadro no tamanho nativo da Fonte, sem filtro, recorte nem texto.
fn extract_args(source: PathBuf, instant_us: i64, partial: &Path) -> Vec<OsString> {
    vec![
        "-hide_banner".into(),
        "-nostdin".into(),
        "-loglevel".into(),
        "error".into(),
        "-ss".into(),
        crate::export::render::seconds(instant_us).into(),
        "-i".into(),
        source.into_os_string(),
        "-map".into(),
        "0:v:0".into(),
        "-frames:v".into(),
        "1".into(),
        "-an".into(),
        "-sn".into(),
        "-c:v".into(),
        "png".into(),
        "-f".into(),
        "image2".into(),
        "-y".into(),
        partial.as_os_str().to_owned(),
    ]
}

const PNG_SIGNATURE: [u8; 8] = [0x89, b'P', b'N', b'G', 0x0D, 0x0A, 0x1A, 0x0A];

fn extract(
    ffmpeg: &Path,
    source: PathBuf,
    instant_us: i64,
    output: &Path,
) -> Result<(), CoreError> {
    let parent = output.parent().ok_or_else(failed)?;
    let partial = tempfile::Builder::new()
        .prefix(".clipes-capa-")
        .suffix(".part")
        .tempfile_in(parent)
        .map_err(|_| failed())?;
    let args = extract_args(source, instant_us, partial.path());
    let (mut child, group) = crate::process::spawn_managed(ffmpeg, &args).map_err(|_| failed())?;
    // Drena o stderr numa thread para o pipe nunca travar o FFmpeg.
    let mut stderr = child.stderr.take();
    let drain = std::thread::spawn(move || {
        let mut sink = Vec::new();
        if let Some(s) = stderr.as_mut() {
            let _ = s.read_to_end(&mut sink);
        }
    });
    let mut stdout = child.stdout.take();
    let drain_out = std::thread::spawn(move || {
        let mut sink = Vec::new();
        if let Some(s) = stdout.as_mut() {
            let _ = s.read_to_end(&mut sink);
        }
    });
    let started = Instant::now();
    let status = loop {
        match child.try_wait() {
            Ok(Some(status)) => break Some(status),
            Ok(None) if started.elapsed() > EXTRACT_TIMEOUT => {
                group.terminate();
                let _ = child.kill();
                let _ = child.wait();
                break None;
            }
            Ok(None) => std::thread::sleep(Duration::from_millis(20)),
            Err(_) => break None,
        }
    };
    let _ = drain.join();
    let _ = drain_out.join();
    if !status.is_some_and(|s| s.success()) {
        return Err(failed());
    }
    let mut head = [0u8; 8];
    std::fs::File::open(partial.path())
        .and_then(|mut f| f.read_exact(&mut head))
        .map_err(|_| failed())?;
    if head != PNG_SIGNATURE {
        return Err(failed());
    }
    partial.persist_noclobber(output).map_err(|e| {
        if e.error.kind() == std::io::ErrorKind::AlreadyExists {
            error(
                "thumbnail_exists",
                "Já existe um arquivo no destino. Escolha outro nome.",
            )
        } else {
            failed()
        }
    })?;
    Ok(())
}

/// `thumbnail.export {candidate, output}`: extrai localmente, com o FFmpeg, o quadro do instante
/// escolhido (ou `instant_us`, se vier) e grava o PNG em `output`, que o usuário escolheu no
/// diálogo de salvar. Nunca sobrescreve um arquivo. Fonte offline: `source_offline`.
fn cmd_export(v: Value, _: &mut EventSink<'_>) -> CommandResult {
    let _guard = projects::start_job()?;
    let ctx = context(candidate_arg(&v)?)?;
    let output = v["output"]
        .as_str()
        .map(PathBuf::from)
        .ok_or_else(|| error("thumbnail_destination", "Escolha um destino PNG."))?;
    validate_output(&output)?;
    materialize(&ctx)?;
    let doc = document(&ctx)?;
    let instant = match v["instant_us"].as_i64() {
        Some(t) if (ctx.start_us..=ctx.end_us).contains(&t) => t,
        Some(_) => {
            return Err(error(
                "instant_out_of_cut",
                "O instante da capa precisa estar dentro do Corte.",
            ))
        }
        None => doc["current"]["instantUs"].as_i64().ok_or_else(|| {
            error(
                "no_instant",
                "Escolha um instante para a capa antes de exportar.",
            )
        })?,
    };
    let project = crate::proxy::project_path()?;
    let (source, ..) = crate::proxy::checked_source(ctx.source, &project)?;
    let ffmpeg = crate::components::cache_settings()?
        .2
        .ok_or_else(|| error("component_missing", "Instale o Componente FFmpeg."))?;
    let source = source.canonicalize().map_err(|_| failed())?;
    extract(&ffmpeg, source, instant, &output)?;
    Ok(json!({"output": output, "instantUs": instant}))
}

inventory::submit! { CommandRegistration { name: "thumbnail.estimate", execute: cmd_estimate } }
inventory::submit! { CommandRegistration { name: "thumbnail.suggest", execute: cmd_suggest } }
inventory::submit! { CommandRegistration { name: "thumbnail.get", execute: cmd_get } }
inventory::submit! { CommandRegistration { name: "thumbnail.choose", execute: cmd_choose } }
inventory::submit! { CommandRegistration { name: "thumbnail.export", execute: cmd_export } }

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn instant_is_the_middle_of_the_sentence() {
        let s = Sentence {
            id: 5,
            first_position: 0,
            last_position: 3,
            start_us: 10_000_000,
            end_us: 14_000_000,
            language: None,
            text: "x".into(),
        };
        assert_eq!(instant_of(&s), 12_000_000);
    }

    #[test]
    fn destination_must_be_a_new_png_in_an_existing_folder() {
        let dir = tempfile::tempdir().unwrap();
        assert!(validate_output(&dir.path().join("capa.png")).is_ok());
        assert_eq!(
            validate_output(&dir.path().join("capa.jpg"))
                .unwrap_err()
                .code,
            "thumbnail_destination"
        );
        assert_eq!(
            validate_output(Path::new("capa.png")).unwrap_err().code,
            "thumbnail_destination"
        );
        std::fs::write(dir.path().join("a.png"), b"x").unwrap();
        assert_eq!(
            validate_output(&dir.path().join("a.png")).unwrap_err().code,
            "thumbnail_exists"
        );
    }

    #[test]
    fn ffmpeg_arguments_keep_the_native_size() {
        let args = extract_args(PathBuf::from("v.mp4"), 1_500_000, Path::new("o.part"));
        let text: Vec<String> = args
            .iter()
            .map(|a| a.to_string_lossy().into_owned())
            .collect();
        assert!(!text.iter().any(|a| a == "-vf" || a == "-filter_complex"));
        assert!(text.windows(2).any(|w| w == ["-ss", "1.500000"]));
        assert!(text.windows(2).any(|w| w == ["-frames:v", "1"]));
    }
}
