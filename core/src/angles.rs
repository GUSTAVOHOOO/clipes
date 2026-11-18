//! Ângulo antes do Roteiro (#153). `angles` herda a rota e o veto de `script`.
//! A fila aplica cancelamento, orçamento, custo e auditoria; a escolha é sempre humana.
use crate::{
    ai_task::{AiTask, Budget, TaskInput, Violation},
    jobs, packaging, projects,
    selection::{approved_transformed_cut, candidate_id_arg, cut::VideoKind, ApprovedCut},
    sentences, CommandRegistration, CommandResult, CoreError, EventSink,
};
use rusqlite::OptionalExtension;
use serde_json::{json, Value};
use std::collections::BTreeSet;
use unicode_normalization::{char::is_combining_mark, UnicodeNormalization};

pub const TASK_ID: &str = "angles";
pub const PROMISE_SIMILARITY_THRESHOLD: f64 = 0.6;
const PROMPT: &str = include_str!("angles/prompt.md");

fn error(code: &str, message: &str) -> CoreError {
    CoreError {
        code: code.into(),
        message: message.into(),
        usage: None,
    }
}

fn invalid() -> CoreError {
    error(
        "angle_invalid",
        "O ângulo tem campos ou referências inválidos.",
    )
}

fn normalized(text: &str) -> String {
    text.nfd()
        .filter(|c| !is_combining_mark(*c))
        .flat_map(char::to_lowercase)
        .filter(|c| c.is_alphanumeric() || c.is_whitespace())
        .collect::<String>()
        .split_whitespace()
        .collect::<Vec<_>>()
        .join(" ")
}

fn similar(a: &str, b: &str) -> bool {
    let a = normalized(a);
    let b = normalized(b);
    let a: BTreeSet<_> = a.split_whitespace().collect();
    let b: BTreeSet<_> = b.split_whitespace().collect();
    let union = a.union(&b).count();
    union > 0 && a.intersection(&b).count() as f64 / union as f64 >= PROMISE_SIMILARITY_THRESHOLD
}

/// A escrita manual usa os mesmos limites, mas dispensa público/IDs e similaridade.
fn validate_angle(angle: &Value, ids: &[i64], manual: bool) -> Result<Value, CoreError> {
    let object = angle.as_object().ok_or_else(invalid)?;
    if object
        .keys()
        .any(|k| !matches!(k.as_str(), "name" | "promise" | "audience" | "sentence_ids"))
    {
        return Err(invalid());
    }
    let mut result = json!({});
    for (key, max, required) in [
        ("name", 60, true),
        ("promise", 200, true),
        ("audience", 120, !manual),
    ] {
        if !required && !object.contains_key(key) {
            continue;
        }
        let text = angle[key].as_str().ok_or_else(invalid)?.trim();
        if text.is_empty() || text.chars().count() > max {
            return Err(invalid());
        }
        if key == "promise"
            && (text.lines().count() > 1
                || text
                    .split(['.', '!', '?'])
                    .filter(|p| !p.trim().is_empty())
                    .count()
                    > 1)
        {
            return Err(invalid());
        }
        result[key] = json!(text);
    }
    if !manual || object.contains_key("sentence_ids") {
        let refs = angle["sentence_ids"].as_array().ok_or_else(invalid)?;
        if refs.is_empty()
            || refs.len() > 12
            || refs
                .iter()
                .any(|v| !v.as_i64().is_some_and(|id| ids.contains(&id)))
        {
            return Err(invalid());
        }
        result["sentence_ids"] = json!(refs);
    }
    Ok(result)
}

fn verify(input: &TaskInput, output: &Value) -> Vec<Violation> {
    let angles = output["angles"].as_array().map_or(&[][..], Vec::as_slice);
    let ids: Vec<_> = input.context["ids"]
        .as_array()
        .into_iter()
        .flatten()
        .filter_map(Value::as_i64)
        .collect();
    let mut out = Vec::new();
    if !(2..=3).contains(&angles.len()) {
        out.push(Violation::new(
            "angle_count",
            "/angles",
            "Expected two or three angles",
        ));
    }
    for (i, a) in angles.iter().enumerate() {
        if validate_angle(a, &ids, false).is_err() {
            out.push(Violation::new(
                "angle_invalid",
                format!("/angles/{i}"),
                "Angle fields or references are invalid",
            ));
        }
        for b in angles.iter().take(i) {
            if normalized(a["name"].as_str().unwrap_or(""))
                == normalized(b["name"].as_str().unwrap_or(""))
                || similar(
                    a["promise"].as_str().unwrap_or(""),
                    b["promise"].as_str().unwrap_or(""),
                )
            {
                out.push(Violation::new(
                    "angles_too_similar",
                    format!("/angles/{i}"),
                    "Angles must be different",
                ));
            }
        }
    }
    out
}

inventory::submit! { AiTask {
    id: TASK_ID, version: 1, prompt: PROMPT,
    prompt_sha256: "a1ad388ce6799e27247084e6887b47cdeeca3f413956db62aafbe0958f52f8ef",
    wire_schema: include_str!("angles/wire.json"), full_schema: include_str!("angles/full.json"),
    verifiers: &[verify], budget: Budget { max_calls:2, max_input_tokens:30_000, max_output_tokens:1_500, max_wall_clock_secs:300, max_cost_micro_cents:None },
} }

inventory::submit! { projects::Migration { id:"0153_001_angles",sql:"
CREATE TABLE angle_generations (
 id INTEGER PRIMARY KEY, job_id INTEGER NOT NULL UNIQUE REFERENCES jobs(id),
 run_id INTEGER NOT NULL REFERENCES selection_runs(id) ON DELETE CASCADE,
 cand_start_id INTEGER NOT NULL, cand_end_id INTEGER NOT NULL
);
CREATE INDEX angle_generations_cut ON angle_generations(run_id,cand_start_id,cand_end_id,id);
CREATE TABLE script_angles (
 id INTEGER PRIMARY KEY, run_id INTEGER NOT NULL REFERENCES selection_runs(id) ON DELETE CASCADE,
 cand_start_id INTEGER NOT NULL, cand_end_id INTEGER NOT NULL, angle TEXT NOT NULL,
 generation_id INTEGER REFERENCES angle_generations(id),
 created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE INDEX script_angles_cut ON script_angles(run_id,cand_start_id,cand_end_id,id);
ALTER TABLE script_generations ADD COLUMN angle TEXT NOT NULL DEFAULT 'null';
ALTER TABLE script_block_versions ADD COLUMN angle_revision INTEGER NOT NULL DEFAULT 0;
ALTER TABLE script_approvals ADD COLUMN angle_revision INTEGER NOT NULL DEFAULT 0;
" } }

pub(crate) fn transformed(cut: &ApprovedCut) -> bool {
    cut.video_kind == VideoKind::Transformed
}

fn context(v: &Value) -> Result<ApprovedCut, CoreError> {
    approved_transformed_cut(
        candidate_id_arg(v, "candidate")?,
        "O Roteiro só existe para Cortes do Vídeo transformado.",
    )
}

pub(crate) fn selected(cut: &ApprovedCut) -> Result<(i64, Value), CoreError> {
    projects::with_reader(|c| c.query_row("SELECT id,angle FROM script_angles WHERE run_id=?1 AND cand_start_id=?2 AND cand_end_id=?3 ORDER BY id DESC LIMIT 1",(cut.run,cut.identity.0,cut.identity.1), |r| Ok((r.get(0)?,r.get::<_,String>(1)?))).optional())?
        .map(|(id,s)| serde_json::from_str(&s).map(|v| (id,v)).map_err(|_|invalid()))
        .transpose().map(|v|v.unwrap_or((0,Value::Null)))
}

pub(crate) fn required(cut: &ApprovedCut) -> Result<(i64, Value), CoreError> {
    let (id, angle) = selected(cut)?;
    if angle.is_null() {
        return Err(error(
            "angle_required",
            "Escolha ou escreva o ângulo antes de gerar o Roteiro.",
        ));
    }
    let ids: Vec<_> = cut.sentences.iter().map(|s| s.id).collect();
    Ok((id, validate_angle(&angle, &ids, true)?))
}

/// Dados do usuário, nunca instruções. O Corte direto não recebe nem o marcador.
pub(crate) fn add_to_input(
    input: &mut TaskInput,
    cut: &ApprovedCut,
    require: bool,
) -> Result<(), CoreError> {
    if !transformed(cut) {
        return Ok(());
    }
    let (_, angle) = if require {
        required(cut)?
    } else {
        selected(cut)?
    };
    if !angle.is_null() {
        input.transcript.push_str(&format!("\n#ANGULO\n{}", angle));
    }
    Ok(())
}

fn input(cut: &ApprovedCut, v: &Value) -> Result<TaskInput, CoreError> {
    let lang = packaging::detect_language(&cut.sentences)
        .or_else(|| v["language"].as_str().and_then(packaging::Lang::parse))
        .ok_or_else(|| error("language_required", "Escolha o idioma: PT-BR ou EN."))?;
    let compact = sentences::compact_with_hint(&cut.sentences);
    Ok(TaskInput {
        transcript: format!("#ANGULOS idioma={}\n{}", lang.code(), compact.text),
        estimate_hint: compact.hint,
        context: json!({"ids":cut.sentences.iter().map(|s|s.id).collect::<Vec<_>>()}),
        native_schema: false,
    })
}

fn cmd_estimate(v: Value, _: &mut EventSink<'_>) -> CommandResult {
    let cut = context(&v)?;
    let route = jobs::resolve_route(TASK_ID, None)?;
    let input = input(&cut, &v)?;
    Ok(json!({
        "paid": route.paid(),
        "profile": route.profile.id,
        "estimate": jobs::estimate_units(TASK_ID, &[input], route.safety, None),
    }))
}

fn cmd_generate(v: Value, _: &mut EventSink<'_>) -> CommandResult {
    let cut = context(&v)?;
    let input = input(&cut, &v)?;
    let doc = document(&cut)?;
    if doc["busy"] == true {
        return Err(error(
            "generation_in_progress",
            "Já há uma sugestão de ângulos em andamento.",
        ));
    }
    let batch = format!("angles-{}-{}-{}", cut.run, cut.identity.0, cut.identity.1);
    let (_, job_ids) = jobs::enqueue_checked(jobs::EnqueueAiRequest {
        task_id: TASK_ID,
        profile_id: None,
        batch: Some(&batch),
        inputs: &[input],
        confirmed: v["confirmed"] == true,
        confirmation_message:
            "Confirme o custo estimado antes de sugerir ângulos com o Provedor pago.",
    })?;
    let job = job_ids[0];
    projects::with_writer(|c| {
        c.execute("INSERT INTO angle_generations(job_id,run_id,cand_start_id,cand_end_id) VALUES (?1,?2,?3,?4)",(job,cut.run,cut.identity.0,cut.identity.1))?;
        Ok(())
    })?;
    Ok(json!({"job":job}))
}

fn document(cut: &ApprovedCut) -> CommandResult {
    let rows: Vec<Value> = projects::with_reader(|c| {
        let mut q = c.prepare("SELECT g.id,g.job_id,j.state,j.result FROM angle_generations g JOIN jobs j ON j.id=g.job_id WHERE g.run_id=?1 AND g.cand_start_id=?2 AND g.cand_end_id=?3 ORDER BY g.id")?;
        let rows = q.query_map((cut.run,cut.identity.0,cut.identity.1),|r| {
            let result: Option<String> = r.get(3)?;
            let result: Option<Value> = result.and_then(|s|serde_json::from_str(&s).ok());
            let codes = jobs::outcome_codes(result.as_ref());
            Ok(json!({"id":r.get::<_,i64>(0)?,"jobId":r.get::<_,i64>(1)?,"state":r.get::<_,String>(2)?,"data":result.as_ref().map(|v|v["data"].clone()),"code":codes.code,"violations":codes.violations}))
        })?.collect::<rusqlite::Result<Vec<_>>>()?;
        Ok(rows)
    })?;
    let last = rows.last();
    let good = rows.iter().rev().find(|r| r["state"] == "completed");
    let (_, selected) = selected(cut)?;
    Ok(
        json!({"angles":good.map(|r|r["data"]["angles"].clone()).unwrap_or(json!([])),"generation":good.map(|r|r["id"].clone()),"selected":selected,"busy":rows.iter().any(|r|matches!(r["state"].as_str(),Some("queued"|"running"))),"job":last.map(|r|json!({"id":r["jobId"],"state":r["state"],"code":r["code"],"violations":r["violations"]})),"generations":rows}),
    )
}

fn cmd_get(v: Value, _: &mut EventSink<'_>) -> CommandResult {
    document(&context(&v)?)
}

fn cmd_choose(v: Value, _: &mut EventSink<'_>) -> CommandResult {
    let cut = context(&v)?;
    let generation = v["generation"].as_i64();
    let angle = if let Some(id) = generation {
        let doc = document(&cut)?;
        let row = doc["generations"]
            .as_array()
            .and_then(|a| {
                a.iter()
                    .find(|r| r["id"] == id && r["state"] == "completed")
            })
            .ok_or_else(invalid)?;
        let index = v["index"]
            .as_u64()
            .and_then(|n| usize::try_from(n).ok())
            .ok_or_else(invalid)?;
        row["data"]["angles"]
            .get(index)
            .cloned()
            .ok_or_else(invalid)?
    } else {
        v["angle"].clone()
    };
    let ids: Vec<_> = cut.sentences.iter().map(|s| s.id).collect();
    let angle = validate_angle(&angle, &ids, generation.is_none())?;
    if selected(&cut)?.1 == angle {
        return document(&cut);
    }
    let (busy, exists) = crate::script::angle_change_state(&cut)?;
    if busy {
        return Err(error(
            "generation_in_progress",
            "Aguarde a geração do Roteiro antes de trocar o ângulo.",
        ));
    }
    if exists && v["confirmed"] != true {
        return Err(error(
            "angle_change_confirmation",
            "Confirme a troca do ângulo: os blocos do Roteiro ficarão desatualizados.",
        ));
    }
    projects::with_writer(|c| {
        c.execute("INSERT INTO script_angles(run_id,cand_start_id,cand_end_id,angle,generation_id) VALUES (?1,?2,?3,?4,?5)",(cut.run,cut.identity.0,cut.identity.1,angle.to_string(),generation))?;
        Ok(())
    })?;
    document(&cut)
}

inventory::submit! { CommandRegistration { name:"angles.get",execute:cmd_get } }
inventory::submit! { CommandRegistration { name:"angles.estimate",execute:cmd_estimate } }
inventory::submit! { CommandRegistration { name:"angles.generate",execute:cmd_generate } }
inventory::submit! { CommandRegistration { name:"angles.choose",execute:cmd_choose } }
