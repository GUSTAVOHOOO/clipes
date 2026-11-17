//! Roteiro em blocos do Vídeo transformado (#73): o Provedor sugere a Narração em blocos, o
//! usuário edita, aprova ou regenera cada bloco, e a Narração só é liberada com todos os blocos
//! aprovados (ADR-0001, regra 5).
//!
//! Cadeia leve de Tarefas de IA, sem juiz, voting nem tool calling e sem tarefa de lote:
//! 1. `script`: uma chamada com o esboço dos blocos (título, intenção e Frases comentadas);
//! 2. `script_block`: uma chamada por bloco com o texto da Narração. Regenerar um bloco é uma
//!    chamada com o bloco anterior e o seguinte.
//!
//! O documento fica no Projeto (migração `0073_001_script`): cada geração guarda o esboço, a
//! versão da Tarefa, o hash do prompt e o perfil; cada texto gerado, regenerado ou editado é uma
//! versão nova do bloco. Nada é apagado. A aprovação é uma linha por (bloco, versão): editar ou
//! regenerar cria outra versão e o bloco volta a `pendente`. A trava da Narração é
//! [`narration_allowed`], estado do núcleo e não instrução de prompt. Veja
//! `docs/contribuindo/roteiro.md`.
use crate::{
    ai_task::{self, AiTask, Budget, TaskInput, Violation},
    jobs::{self, Safety},
    packaging::{self, Lang},
    projects, provider,
    sentences::{self, Sentence},
    CommandRegistration, CommandResult, CoreError, EventSink,
};
use serde_json::{json, Value};
use std::sync::Mutex;

/// Esboço dos blocos.
pub const TASK_ID: &str = "script";
/// Texto de um bloco (primeira escrita e regeneração). Roteia como `script`.
pub const BLOCK_TASK_ID: &str = "script_block";
pub const JOB_KIND: &str = "ai:script";
pub const BLOCK_JOB_KIND: &str = "ai:script_block";

// Limites do produto, calibráveis (decisão do #73).
/// Menor e maior número de blocos de um Roteiro.
pub const MIN_BLOCKS: usize = 3;
pub const MAX_BLOCKS: usize = 12;
/// Título do bloco, em caracteres.
pub const MAX_TITLE_CHARS: usize = 80;
/// Intenção do bloco no esboço, em caracteres.
pub const MAX_INTENT_CHARS: usize = 200;
/// Texto de um bloco (o que a Narração lê), em caracteres.
pub const MAX_NARRATION_CHARS: usize = 800;
/// Soma da Narração de todos os blocos, em caracteres.
pub const MAX_SCRIPT_CHARS: usize = 6000;
/// Frases de referência de um bloco.
pub const MAX_REFS: usize = 50;

const OUTLINE_PROMPT: &str = include_str!("script/outline_prompt.md");
const OUTLINE_WIRE: &str = include_str!("script/outline_wire.json");
const OUTLINE_FULL: &str = include_str!("script/outline_full.json");
const BLOCK_PROMPT: &str = include_str!("script/block_prompt.md");
const BLOCK_WIRE: &str = include_str!("script/block_wire.json");
const BLOCK_FULL: &str = include_str!("script/block_full.json");

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

// ---------------------------------------------------------------- verificadores do esboço

fn outline_of(output: &Value) -> &[Value] {
    output["blocks"].as_array().map_or(&[], Vec::as_slice)
}

fn wanted(input: &TaskInput) -> Option<Lang> {
    input.context["language"].as_str().and_then(Lang::parse)
}

fn outline_count(_: &TaskInput, output: &Value) -> Vec<Violation> {
    match outline_of(output).len() {
        n if n < MIN_BLOCKS => vec![v("too_few_blocks", "/blocks", "Too few blocks")],
        n if n > MAX_BLOCKS => vec![v("too_many_blocks", "/blocks", "Too many blocks")],
        _ => Vec::new(),
    }
}

fn forbidden(text: &str) -> bool {
    text.contains(['<', '>'])
}

fn outline_fields(_: &TaskInput, output: &Value) -> Vec<Violation> {
    let mut out = Vec::new();
    for (i, b) in outline_of(output).iter().enumerate() {
        let (title, intent) = (
            b["title"].as_str().unwrap_or("").trim(),
            b["intent"].as_str().unwrap_or("").trim(),
        );
        let at = |field: &str| format!("/blocks/{i}/{field}");
        if title.is_empty() {
            out.push(v("title_empty", &at("title"), "Title is empty"));
        } else if title.chars().count() > MAX_TITLE_CHARS {
            out.push(v("title_too_long", &at("title"), "Title is too long"));
        }
        if intent.is_empty() {
            out.push(v("intent_empty", &at("intent"), "Intent is empty"));
        } else if intent.chars().count() > MAX_INTENT_CHARS {
            out.push(v("intent_too_long", &at("intent"), "Intent is too long"));
        }
        if forbidden(title) || forbidden(intent) {
            out.push(v(
                "forbidden_character",
                &at("title"),
                "Text contains a forbidden character",
            ));
        }
        if packaging::has_url(title) || packaging::has_url(intent) {
            out.push(v("invented_url", &at("title"), "Text contains a URL"));
        }
    }
    out
}

/// As Frases citadas existem no Corte.
fn outline_refs(input: &TaskInput, output: &Value) -> Vec<Violation> {
    let ids: Vec<i64> = input.context["ids"]
        .as_array()
        .map_or_else(Vec::new, |a| a.iter().filter_map(Value::as_i64).collect());
    let mut out = Vec::new();
    for (i, b) in outline_of(output).iter().enumerate() {
        let refs = b["refs"].as_array().map_or(&[][..], Vec::as_slice);
        if refs.len() > MAX_REFS {
            out.push(v(
                "too_many_refs",
                &format!("/blocks/{i}/refs"),
                "Too many references",
            ));
        }
        for (j, r) in refs.iter().enumerate() {
            if !r.as_i64().is_some_and(|id| ids.contains(&id)) {
                out.push(v(
                    "unknown_sentence_id",
                    &format!("/blocks/{i}/refs/{j}"),
                    "Sentence id is not in the clip",
                ));
            }
        }
    }
    out
}

fn outline_language(input: &TaskInput, output: &Value) -> Vec<Violation> {
    let Some(want) = wanted(input) else {
        return vec![v(
            "language_mismatch",
            "/language",
            "Requested language is unknown",
        )];
    };
    if output["language"].as_str() != Some(want.code()) {
        return vec![v(
            "language_mismatch",
            "/language",
            "Output language differs from the requested one",
        )];
    }
    let text = outline_of(output)
        .iter()
        .map(|b| {
            format!(
                "{} {}",
                b["title"].as_str().unwrap_or(""),
                b["intent"].as_str().unwrap_or("")
            )
        })
        .collect::<Vec<_>>()
        .join(" ");
    if packaging::looks_wrong_language(&text, want) {
        return vec![v(
            "language_mismatch",
            "/blocks",
            "Text seems to be in another language",
        )];
    }
    Vec::new()
}

// ---------------------------------------------------------------- verificadores do bloco

fn max_chars(input: &TaskInput) -> usize {
    input.context["maxChars"]
        .as_u64()
        .map_or(MAX_NARRATION_CHARS, |n| n as usize)
        .min(MAX_NARRATION_CHARS)
}

fn narration_limits(input: &TaskInput, output: &Value) -> Vec<Violation> {
    let text = output["narration"].as_str().unwrap_or("");
    let mut out = Vec::new();
    if text.trim().is_empty() {
        out.push(v("narration_empty", "/narration", "Narration is empty"));
    } else if text.trim().chars().count() > max_chars(input) {
        out.push(v(
            "narration_too_long",
            "/narration",
            "Narration is too long",
        ));
    }
    if forbidden(text) {
        out.push(v(
            "forbidden_character",
            "/narration",
            "Text contains a forbidden character",
        ));
    }
    if packaging::has_url(text) {
        out.push(v("invented_url", "/narration", "Text contains a URL"));
    }
    out
}

fn block_language(input: &TaskInput, output: &Value) -> Vec<Violation> {
    let Some(want) = wanted(input) else {
        return vec![v(
            "language_mismatch",
            "/narration",
            "Requested language is unknown",
        )];
    };
    if packaging::looks_wrong_language(output["narration"].as_str().unwrap_or(""), want) {
        return vec![v(
            "language_mismatch",
            "/narration",
            "Text seems to be in another language",
        )];
    }
    Vec::new()
}

inventory::submit! {
    AiTask {
        id: TASK_ID,
        version: 2,
        prompt: OUTLINE_PROMPT,
        prompt_sha256: "99926b7d91298a925692925c2c8274feba2d4a51bca4161667faae9bbb91946b",
        wire_schema: OUTLINE_WIRE,
        full_schema: OUTLINE_FULL,
        verifiers: &[outline_language, outline_count, outline_fields, outline_refs],
        budget: Budget {
            max_calls: 2,
            max_input_tokens: 30_000,
            max_output_tokens: 2_500,
            max_wall_clock_secs: 300,
            max_cost_micro_cents: None,
        },
    }
}

inventory::submit! {
    AiTask {
        id: BLOCK_TASK_ID,
        version: 2,
        prompt: BLOCK_PROMPT,
        prompt_sha256: "2f21d62aa3f3d2cd4ec85b8de540e8c3d6e18aca729c3ccec3bcc5740b26e2d0",
        wire_schema: BLOCK_WIRE,
        full_schema: BLOCK_FULL,
        verifiers: &[block_language, narration_limits],
        budget: Budget {
            max_calls: 2,
            max_input_tokens: 32_000,
            max_output_tokens: 1_000,
            max_wall_clock_secs: 300,
            max_cost_micro_cents: None,
        },
    }
}

fn task(id: &str) -> &'static AiTask {
    ai_task::find(id).expect("script tasks are registered")
}

// ---------------------------------------------------------------- persistência

inventory::submit! { projects::Migration { id: "0073_001_script", sql: "
CREATE TABLE script_generations (
  id INTEGER PRIMARY KEY,
  job_id INTEGER NOT NULL UNIQUE,
  run_id INTEGER NOT NULL REFERENCES selection_runs(id) ON DELETE CASCADE,
  cand_start_id INTEGER NOT NULL,
  cand_end_id INTEGER NOT NULL,
  language TEXT NOT NULL CHECK(language IN ('pt-BR','en')),
  task_version INTEGER NOT NULL,
  prompt_sha256 TEXT NOT NULL,
  profile TEXT NOT NULL DEFAULT '',
  safety TEXT NOT NULL CHECK(safety IN ('local','paid')),
  outline TEXT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE INDEX script_generations_cut ON script_generations(run_id, cand_start_id, cand_end_id, id);
CREATE TABLE script_blocks (
  id INTEGER PRIMARY KEY,
  generation_id INTEGER NOT NULL REFERENCES script_generations(id) ON DELETE CASCADE,
  position INTEGER NOT NULL,
  title TEXT NOT NULL,
  intent TEXT NOT NULL,
  refs TEXT NOT NULL,
  UNIQUE(generation_id, position)
);
CREATE TABLE script_block_versions (
  id INTEGER PRIMARY KEY,
  block_id INTEGER NOT NULL REFERENCES script_blocks(id) ON DELETE CASCADE,
  kind TEXT NOT NULL CHECK(kind IN ('generated','regenerated','edit')),
  job_id INTEGER UNIQUE,
  task_version INTEGER NOT NULL DEFAULT 0,
  prompt_sha256 TEXT NOT NULL DEFAULT '',
  profile TEXT NOT NULL DEFAULT '',
  title TEXT,
  narration TEXT,
  refs TEXT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE INDEX script_block_versions_block ON script_block_versions(block_id, id);
CREATE TABLE script_approvals (
  id INTEGER PRIMARY KEY,
  block_id INTEGER NOT NULL REFERENCES script_blocks(id) ON DELETE CASCADE,
  version_id INTEGER NOT NULL REFERENCES script_block_versions(id) ON DELETE CASCADE,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE INDEX script_approvals_block ON script_approvals(block_id, id);
" } }

struct Cut {
    cut: crate::selection::ApprovedCut,
}

/// O Corte aprovado do candidato, só se for do Vídeo transformado.
fn context(candidate: i64) -> Result<Cut, CoreError> {
    let cut = crate::selection::approved_cut(candidate)?;
    let kind: String = projects::with_reader(|c| {
        c.query_row(
            "SELECT video_kind FROM selection_runs WHERE id=?1",
            [cut.run],
            |r| r.get(0),
        )
    })?;
    if kind != "transformed" {
        return Err(error(
            "script_requires_transformed",
            "O Roteiro só existe para Cortes do Vídeo transformado.",
        ));
    }
    Ok(Cut { cut })
}

/// Perfil de Provedor escolhido só para esta chamada ("refazer com o perfil X", #126): o mesmo
/// caminho de `jobs.redo`, com o veto "somente local" antes de qualquer envio.
fn profile_arg(v: &Value) -> Option<String> {
    v["profileId"]
        .as_str()
        .filter(|id| !id.is_empty() && id.len() <= 64)
        .map(str::to_owned)
}

fn candidate_arg(v: &Value) -> Result<i64, CoreError> {
    v["candidate"]
        .as_i64()
        .ok_or_else(|| error("candidate_not_found", "Candidato não encontrado."))
}

#[derive(Clone)]
struct Version {
    id: i64,
    kind: String,
    job_id: Option<i64>,
    task_version: i64,
    prompt_sha256: String,
    profile: String,
    title: Option<String>,
    narration: Option<String>,
    refs: Option<Vec<i64>>,
    created_at: String,
    job_state: Option<String>,
    job_result: Option<Value>,
    angle_revision: i64,
}

impl Version {
    fn written(&self) -> bool {
        self.narration.is_some()
    }
    fn in_flight(&self) -> bool {
        !self.written() && matches!(self.job_state.as_deref(), Some("queued" | "running"))
    }
}

struct Block {
    id: i64,
    position: i64,
    title: String,
    intent: String,
    refs: Vec<i64>,
    versions: Vec<Version>,
    /// `version_id` de cada aprovação, em ordem.
    approvals: Vec<(i64, String, i64)>,
    angle_revision: i64,
}

impl Block {
    fn current(&self) -> Option<&Version> {
        self.versions.iter().rev().find(|x| x.written())
    }
    fn title(&self) -> String {
        self.current()
            .and_then(|x| x.title.clone())
            .unwrap_or_else(|| self.title.clone())
    }
    fn refs(&self) -> Vec<i64> {
        self.current()
            .and_then(|x| x.refs.clone())
            .unwrap_or_else(|| self.refs.clone())
    }
    fn narration(&self) -> Option<&str> {
        self.current().and_then(|x| x.narration.as_deref())
    }
    fn busy(&self) -> bool {
        self.versions.iter().any(Version::in_flight)
    }
    fn approved(&self) -> bool {
        self.current()
            .zip(self.approvals.last())
            .is_some_and(|(v, (approved, _, angle))| {
                v.id == *approved && *angle == self.angle_revision
            })
    }
    fn stale(&self) -> bool {
        self.current()
            .is_some_and(|v| v.angle_revision != self.angle_revision)
            && !self.approved()
    }
}

struct Generation {
    id: i64,
    job_id: i64,
    language: String,
    task_version: i64,
    prompt_sha256: String,
    profile: String,
    safety: String,
    created_at: String,
    outline: Option<Value>,
    job_state: Option<String>,
    job_result: Option<Value>,
    blocks: Vec<Block>,
    angle: Value,
}

impl Generation {
    fn busy(&self) -> bool {
        matches!(self.job_state.as_deref(), Some("queued" | "running"))
            || self.blocks.iter().any(Block::busy)
    }
}

fn parse_ids(text: Option<String>) -> Option<Vec<i64>> {
    serde_json::from_str::<Vec<i64>>(&text?).ok()
}

fn read_generations(run: i64, identity: (i64, i64)) -> Result<Vec<Generation>, CoreError> {
    projects::with_reader(|c| {
        let angle_revision: i64 = c.query_row("SELECT COALESCE(MAX(id),0) FROM script_angles WHERE run_id=?1 AND cand_start_id=?2 AND cand_end_id=?3", (run,identity.0,identity.1), |r|r.get(0))?;
        let mut q = c.prepare(
            "SELECT g.id,g.job_id,g.language,g.task_version,g.prompt_sha256,g.profile,g.safety,g.created_at,g.outline,j.state,j.result,g.angle FROM script_generations g LEFT JOIN jobs j ON j.id=g.job_id WHERE g.run_id=?1 AND g.cand_start_id=?2 AND g.cand_end_id=?3 ORDER BY g.id",
        )?;
        let mut gens: Vec<Generation> = q
            .query_map((run, identity.0, identity.1), |r| {
                let outline: Option<String> = r.get(8)?;
                let result: Option<String> = r.get(10)?;
                Ok(Generation {
                    id: r.get(0)?,
                    job_id: r.get(1)?,
                    language: r.get(2)?,
                    task_version: r.get(3)?,
                    prompt_sha256: r.get(4)?,
                    profile: r.get(5)?,
                    safety: r.get(6)?,
                    created_at: r.get(7)?,
                    outline: outline.and_then(|t| serde_json::from_str(&t).ok()),
                    job_state: r.get(9)?,
                    job_result: result.and_then(|t| serde_json::from_str(&t).ok()),
                    blocks: Vec::new(),
                    angle: serde_json::from_str(&r.get::<_, String>(11)?).unwrap_or(Value::Null),
                })
            })?
            .collect::<rusqlite::Result<_>>()?;
        let mut blocks = c.prepare(
            "SELECT id,position,title,intent,refs FROM script_blocks WHERE generation_id=?1 ORDER BY position",
        )?;
        let mut versions = c.prepare(
            "SELECT v.id,v.kind,v.job_id,v.task_version,v.prompt_sha256,v.profile,v.title,v.narration,v.refs,v.created_at,j.state,j.result,v.angle_revision FROM script_block_versions v LEFT JOIN jobs j ON j.id=v.job_id WHERE v.block_id=?1 ORDER BY v.id",
        )?;
        let mut approvals = c.prepare(
            "SELECT version_id,created_at,angle_revision FROM script_approvals WHERE block_id=?1 ORDER BY id",
        )?;
        for g in &mut gens {
            g.blocks = blocks
                .query_map([g.id], |r| {
                    Ok(Block {
                        id: r.get(0)?,
                        position: r.get(1)?,
                        title: r.get(2)?,
                        intent: r.get(3)?,
                        refs: parse_ids(r.get(4)?).unwrap_or_default(),
                        versions: Vec::new(),
                        approvals: Vec::new(),
                        angle_revision,
                    })
                })?
                .collect::<rusqlite::Result<_>>()?;
            for b in &mut g.blocks {
                b.versions = versions
                    .query_map([b.id], |r| {
                        let result: Option<String> = r.get(11)?;
                        Ok(Version {
                            id: r.get(0)?,
                            kind: r.get(1)?,
                            job_id: r.get(2)?,
                            task_version: r.get(3)?,
                            prompt_sha256: r.get(4)?,
                            profile: r.get(5)?,
                            title: r.get(6)?,
                            narration: r.get(7)?,
                            refs: parse_ids(r.get(8)?),
                            created_at: r.get(9)?,
                            job_state: r.get(10)?,
                            job_result: result.and_then(|t| serde_json::from_str(&t).ok()),
                            angle_revision: r.get(12)?,
                        })
                    })?
                    .collect::<rusqlite::Result<_>>()?;
                b.approvals = approvals
                    .query_map([b.id], |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?)))?
                    .collect::<rusqlite::Result<_>>()?;
            }
        }
        Ok(gens)
    })
}

/// Grava o esboço e os blocos dos jobs concluídos e o texto das versões concluídas
/// (idempotente).
fn materialize(run: i64, identity: (i64, i64)) -> Result<(), CoreError> {
    projects::with_writer(|c| {
        let mut q = c.prepare(
            "SELECT g.id,j.result FROM script_generations g JOIN jobs j ON j.id=g.job_id WHERE g.run_id=?1 AND g.cand_start_id=?2 AND g.cand_end_id=?3 AND g.outline IS NULL AND j.state='completed'",
        )?;
        let rows: Vec<(i64, Option<String>)> = q
            .query_map((run, identity.0, identity.1), |r| {
                Ok((r.get(0)?, r.get(1)?))
            })?
            .collect::<rusqlite::Result<_>>()?;
        for (id, result) in rows {
            let blocks = result
                .and_then(|t| serde_json::from_str::<Value>(&t).ok())
                .and_then(|r| r["data"]["blocks"].as_array().cloned());
            let Some(blocks) = blocks else { continue };
            c.execute(
                "UPDATE script_generations SET outline=?2 WHERE id=?1",
                (id, Value::Array(blocks.clone()).to_string()),
            )?;
            for (i, b) in blocks.iter().enumerate() {
                c.execute(
                    "INSERT INTO script_blocks(generation_id,position,title,intent,refs) VALUES (?1,?2,?3,?4,?5)",
                    (
                        id,
                        i as i64 + 1,
                        b["title"].as_str().unwrap_or("").trim(),
                        b["intent"].as_str().unwrap_or("").trim(),
                        b["refs"].to_string(),
                    ),
                )?;
            }
        }
        let mut q = c.prepare(
            "SELECT v.id,v.block_id,j.result FROM script_block_versions v JOIN script_blocks b ON b.id=v.block_id JOIN script_generations g ON g.id=b.generation_id JOIN jobs j ON j.id=v.job_id WHERE g.run_id=?1 AND g.cand_start_id=?2 AND g.cand_end_id=?3 AND v.narration IS NULL AND j.state='completed' ORDER BY v.id",
        )?;
        let rows: Vec<(i64, i64, Option<String>)> = q
            .query_map((run, identity.0, identity.1), |r| {
                Ok((r.get(0)?, r.get(1)?, r.get(2)?))
            })?
            .collect::<rusqlite::Result<_>>()?;
        for (id, block, result) in rows {
            let narration = result
                .and_then(|t| serde_json::from_str::<Value>(&t).ok())
                .and_then(|r| r["data"]["narration"].as_str().map(|s| s.trim().to_owned()));
            let Some(narration) = narration else { continue };
            // Título e referências seguem os atuais do bloco (o usuário pode tê-los editado).
            let (title, refs): (String, String) = c.query_row(
                "SELECT COALESCE((SELECT title FROM script_block_versions WHERE block_id=?1 AND narration IS NOT NULL AND id<?2 ORDER BY id DESC LIMIT 1), b.title), COALESCE((SELECT refs FROM script_block_versions WHERE block_id=?1 AND narration IS NOT NULL AND id<?2 ORDER BY id DESC LIMIT 1), b.refs) FROM script_blocks b WHERE b.id=?1",
                (block, id),
                |r| Ok((r.get(0)?, r.get(1)?)),
            )?;
            c.execute(
                "UPDATE script_block_versions SET narration=?2,title=?3,refs=?4 WHERE id=?1",
                (id, narration, title, refs),
            )?;
        }
        Ok(())
    })
}

// ---------------------------------------------------------------- entradas das Tarefas

fn pick_language(cut: &Cut, v: &Value) -> Result<Lang, CoreError> {
    if let Some(lang) = packaging::detect_language(&cut.cut.sentences) {
        return Ok(lang);
    }
    v["language"].as_str().and_then(Lang::parse).ok_or_else(|| {
        error(
            "language_required",
            "Escolha o idioma do Roteiro: PT-BR ou EN.",
        )
    })
}

fn ids_of(frases: &[Sentence]) -> Vec<i64> {
    frases.iter().map(|s| s.id).collect()
}

fn outline_input(frases: &[Sentence], lang: Lang) -> TaskInput {
    let compact = sentences::compact_with_hint(frases);
    TaskInput {
        transcript: format!("#CORTE idioma={}\n{}", lang.code(), compact.text),
        estimate_hint: compact.hint,
        context: json!({"language": lang.code(), "ids": ids_of(frases)}),
        native_schema: false,
    }
}

/// Um item do esboço mostrado ao modelo: título, intenção e referências atuais.
struct Outlined {
    title: String,
    intent: String,
    refs: Vec<i64>,
}

fn one_line(text: &str) -> String {
    text.split_whitespace().collect::<Vec<_>>().join(" ")
}

fn block_input(
    frases: &[Sentence],
    lang: Lang,
    outline: &[Outlined],
    at: usize,
    neighbors: (Option<&str>, Option<&str>),
    max: usize,
) -> TaskInput {
    let compact = sentences::compact_with_hint(frases);
    let mut text = format!(
        "#BLOCO idioma={} n={} de={} max={}\n#ESBOCO\n",
        lang.code(),
        at + 1,
        outline.len(),
        max
    );
    for (i, o) in outline.iter().enumerate() {
        let refs = o
            .refs
            .iter()
            .map(i64::to_string)
            .collect::<Vec<_>>()
            .join(",");
        text.push_str(&format!(
            "{} {} :: {} :: {}\n",
            i + 1,
            one_line(&o.title),
            one_line(&o.intent),
            refs
        ));
    }
    let side = |s: Option<&str>| s.map_or("-".to_owned(), one_line);
    text.push_str(&format!(
        "#ANTERIOR\n{}\n#PROXIMO\n{}\n#CORTE\n{}",
        side(neighbors.0),
        side(neighbors.1),
        compact.text
    ));
    TaskInput {
        transcript: text,
        estimate_hint: compact.hint,
        context: json!({"language": lang.code(), "maxChars": max}),
        native_schema: false,
    }
}

fn route_safety(task: &str, profile: Option<&str>) -> Result<(String, Safety), CoreError> {
    Ok(match provider::routed(Some(task), profile)? {
        provider::Routed::Cli(name) => (name, Safety::Paid),
        provider::Routed::Api { profile, local } => {
            (profile.id, if local { Safety::Local } else { Safety::Paid })
        }
    })
}

fn estimate_of(
    task_id: &str,
    input: &TaskInput,
    safety: Safety,
    profile_id: Option<&str>,
) -> Value {
    let paid = matches!(safety, Safety::Paid);
    let unknown = json!({"kind": "unknown", "minMicroUsd": null, "maxMicroUsd": null});
    let definition = task(task_id);
    let Ok((target, profile)) = jobs::route_of_profile(task_id, paid, profile_id) else {
        return unknown;
    };
    let Ok((wire, _)) = ai_task::check_definition(definition) else {
        return unknown;
    };
    let request = provider::StructuredRequest {
        estimate_hint: input.estimate_hint.clone(),
        instruction: ai_task::normalized_prompt(definition.prompt),
        transcript: input.transcript.clone(),
        schema: wire,
        native_schema: false,
        max_output_tokens: Some(definition.budget.max_output_tokens),
    };
    provider::cost::estimate_for(&target, &profile, &request).unwrap_or(unknown)
}

/// Custo da cadeia inteira: o esboço mais de `MIN_BLOCKS` a `MAX_BLOCKS` textos.
fn chain_estimate(outline: &Value, block: &Value) -> Value {
    let unknown = json!({"kind": "unknown", "minMicroUsd": null, "maxMicroUsd": null});
    match (outline["kind"].as_str(), block["kind"].as_str()) {
        (Some("usd"), Some("usd")) => {
            let (Some(o_min), Some(o_max), Some(b_min), Some(b_max)) = (
                outline["minMicroUsd"].as_u64(),
                outline["maxMicroUsd"].as_u64(),
                block["minMicroUsd"].as_u64(),
                block["maxMicroUsd"].as_u64(),
            ) else {
                return unknown;
            };
            json!({
                "kind": "usd",
                "minMicroUsd": o_min + b_min * MIN_BLOCKS as u64,
                "maxMicroUsd": o_max + b_max * MAX_BLOCKS as u64,
            })
        }
        (Some("zero"), Some("zero")) => outline.clone(),
        (Some("plan_quota"), _) | (_, Some("plan_quota")) => {
            json!({"kind": "plan_quota", "minMicroUsd": null, "maxMicroUsd": null})
        }
        _ => unknown,
    }
}

/// Entrada de maior tamanho possível do texto de um bloco, para a estimativa.
fn worst_block_input(frases: &[Sentence], lang: Lang) -> TaskInput {
    let outline: Vec<Outlined> = (0..MAX_BLOCKS)
        .map(|_| Outlined {
            title: "t".repeat(MAX_TITLE_CHARS),
            intent: "i".repeat(MAX_INTENT_CHARS),
            refs: Vec::new(),
        })
        .collect();
    let near = "n".repeat(MAX_NARRATION_CHARS);
    block_input(
        frases,
        lang,
        &outline,
        0,
        (Some(&near), Some(&near)),
        MAX_NARRATION_CHARS,
    )
}

fn confirmation_required(estimate: Value) -> CoreError {
    CoreError {
        code: "confirmation_required".into(),
        message: "Este Roteiro usa um Provedor pago: confirme o custo estimado antes de gerar."
            .into(),
        usage: Some(json!({"estimate": estimate})),
    }
}

/// `script.estimate {candidate, language?, block?}`: idioma e custo estimado. Com `block`, o de
/// regenerar esse bloco; sem ele, o da cadeia inteira (esboço e textos).
fn cmd_estimate(v: Value, _: &mut EventSink<'_>) -> CommandResult {
    let cut = context(candidate_arg(&v)?)?;
    crate::angles::required(&cut.cut)?;
    let lang = pick_language(&cut, &v)?;
    let chosen = profile_arg(&v);
    let (profile, safety) = route_safety(
        if v["block"].is_null() {
            TASK_ID
        } else {
            BLOCK_TASK_ID
        },
        chosen.as_deref(),
    )?;
    let mut worst = worst_block_input(&cut.cut.sentences, lang);
    crate::angles::add_to_input(&mut worst, &cut.cut, true)?;
    let block = estimate_of(BLOCK_TASK_ID, &worst, safety, chosen.as_deref());
    let estimate = if v["block"].is_null() {
        let mut input = outline_input(&cut.cut.sentences, lang);
        crate::angles::add_to_input(&mut input, &cut.cut, true)?;
        let outline = estimate_of(TASK_ID, &input, safety, None);
        chain_estimate(&outline, &block)
    } else {
        block
    };
    Ok(json!({
        "paid": matches!(safety, Safety::Paid),
        "profile": profile,
        "language": lang.code(),
        "estimate": estimate,
    }))
}

fn batch_of(cut: &Cut) -> String {
    format!(
        "script-{}-{}-{}",
        cut.cut.run, cut.cut.identity.0, cut.cut.identity.1
    )
}

/// `script.generate {candidate, language?, confirmed?}`: enfileira o esboço; os textos dos
/// blocos entram na fila quando o esboço termina (veja [`advance`]). Provedor pago exige
/// `confirmed`, que vale para a cadeia inteira.
fn cmd_generate(v: Value, _: &mut EventSink<'_>) -> CommandResult {
    let cut = context(candidate_arg(&v)?)?;
    let (_, angle) = crate::angles::required(&cut.cut)?;
    let lang = pick_language(&cut, &v)?;
    let (profile, safety) = route_safety(TASK_ID, None)?;
    let mut input = outline_input(&cut.cut.sentences, lang);
    crate::angles::add_to_input(&mut input, &cut.cut, true)?;
    if matches!(safety, Safety::Paid) && v["confirmed"] != true {
        let mut worst = worst_block_input(&cut.cut.sentences, lang);
        crate::angles::add_to_input(&mut worst, &cut.cut, true)?;
        let block = estimate_of(BLOCK_TASK_ID, &worst, safety, None);
        return Err(confirmation_required(chain_estimate(
            &estimate_of(TASK_ID, &input, safety, None),
            &block,
        )));
    }
    let (run, (start, end)) = (cut.cut.run, cut.cut.identity);
    materialize(run, (start, end))?;
    if read_generations(run, (start, end))?
        .iter()
        .any(Generation::busy)
    {
        return Err(error(
            "generation_in_progress",
            "Já há uma geração em andamento para este Roteiro.",
        ));
    }
    let definition = task(TASK_ID);
    let job = jobs::enqueue_ai_in_batch(TASK_ID, &input, safety, Some(&batch_of(&cut)))?;
    let safety_text = if matches!(safety, Safety::Paid) {
        "paid"
    } else {
        "local"
    };
    projects::with_writer(|c| {
        c.execute(
            "INSERT INTO script_generations(job_id,run_id,cand_start_id,cand_end_id,language,task_version,prompt_sha256,profile,safety,angle) VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9,?10)",
            (job, run, start, end, lang.code(), definition.version, definition.prompt_sha256, &profile, safety_text, angle.to_string()),
        )?;
        Ok(())
    })?;
    Ok(json!({"job": job, "language": lang.code()}))
}

static ADVANCE: Mutex<()> = Mutex::new(());

fn outlined(block: &Block) -> Outlined {
    Outlined {
        title: block.title(),
        intent: block.intent.clone(),
        refs: block.refs(),
    }
}

fn enqueue_version(
    cut: &Cut,
    block: &Block,
    kind: &str,
    input: &TaskInput,
    safety: Safety,
    profile: &str,
    profile_id: Option<&str>,
) -> Result<i64, CoreError> {
    let definition = task(BLOCK_TASK_ID);
    let (angle_revision, _) = crate::angles::required(&cut.cut)?;
    let job = jobs::enqueue_ai_with_profile(
        BLOCK_TASK_ID,
        input,
        safety,
        Some(&batch_of(cut)),
        profile_id,
    )?;
    projects::with_writer(|c| {
        c.execute(
            "INSERT INTO script_block_versions(block_id,kind,job_id,task_version,prompt_sha256,profile,angle_revision) VALUES (?1,?2,?3,?4,?5,?6,?7)",
            (block.id, kind, job, definition.version, definition.prompt_sha256, profile, angle_revision),
        )?;
        Ok(job)
    })
}

/// Anda a cadeia: depois que o esboço termina, enfileira o texto de cada bloco que ainda não
/// tem versão. O progresso é puxado por quem lê o documento (`script.get`), como o
/// empacotamento materializa as gerações; o estado fica todo no Projeto, então uma queda entre
/// dois passos só repete o passo.
fn advance(cut: &Cut) -> Result<(), CoreError> {
    let _guard = ADVANCE.lock().map_err(|_| {
        error(
            "internal_error",
            "Não foi possível continuar a geração do Roteiro.",
        )
    })?;
    let (run, identity) = (cut.cut.run, cut.cut.identity);
    // Um Roteiro legado continua legível; só avança depois da escolha humana do ângulo.
    if crate::angles::selected(&cut.cut)?.1.is_null() {
        return Ok(());
    }
    let gens = read_generations(run, identity)?;
    for gen in &gens {
        let Some(lang) = Lang::parse(&gen.language) else {
            continue;
        };
        if gen.outline.is_none() || gen.blocks.iter().all(|b| !b.versions.is_empty()) {
            continue;
        }
        let safety = if gen.safety == "paid" {
            Safety::Paid
        } else {
            Safety::Local
        };
        let outline: Vec<Outlined> = gen.blocks.iter().map(outlined).collect();
        let max = (MAX_SCRIPT_CHARS / gen.blocks.len().max(1)).min(MAX_NARRATION_CHARS);
        for (i, block) in gen.blocks.iter().enumerate() {
            if !block.versions.is_empty() {
                continue;
            }
            let mut input = block_input(&cut.cut.sentences, lang, &outline, i, (None, None), max);
            crate::angles::add_to_input(&mut input, &cut.cut, true)?;
            enqueue_version(cut, block, "generated", &input, safety, &gen.profile, None)?;
        }
    }
    Ok(())
}

fn latest_with_blocks(gens: &[Generation]) -> Option<&Generation> {
    gens.iter().rev().find(|g| !g.blocks.is_empty())
}

/// Algum job terminou entre a materialização e a leitura: o resultado ainda não foi gravado.
fn stale(gens: &[Generation]) -> bool {
    gens.iter().any(|g| {
        (g.outline.is_none() && g.job_state.as_deref() == Some("completed"))
            || g.blocks.iter().any(|b| {
                b.versions
                    .iter()
                    .any(|x| !x.written() && x.job_state.as_deref() == Some("completed"))
            })
    })
}

fn refresh(cut: &Cut) -> Result<Vec<Generation>, CoreError> {
    let (run, identity) = (cut.cut.run, cut.cut.identity);
    materialize(run, identity)?;
    advance(cut)?;
    let mut gens = read_generations(run, identity)?;
    for _ in 0..3 {
        if !stale(&gens) {
            break;
        }
        materialize(run, identity)?;
        advance(cut)?;
        gens = read_generations(run, identity)?;
    }
    Ok(gens)
}

fn limits_json() -> Value {
    json!({
        "minBlocks": MIN_BLOCKS,
        "maxBlocks": MAX_BLOCKS,
        "titleChars": MAX_TITLE_CHARS,
        "narrationChars": MAX_NARRATION_CHARS,
        "scriptChars": MAX_SCRIPT_CHARS,
        "refs": MAX_REFS,
    })
}

fn job_json(state: &Option<String>, result: &Option<Value>, id: i64) -> Value {
    json!({
        "id": id,
        "state": state,
        "code": packaging::job_code(result),
        "violations": packaging::violation_codes(result),
    })
}

fn total_chars(gen: &Generation) -> usize {
    gen.blocks
        .iter()
        .filter_map(Block::narration)
        .map(|t| t.chars().count())
        .sum()
}

fn block_json(b: &Block) -> Value {
    let last = b.versions.last();
    let job = last
        .filter(|x| !x.written())
        .and_then(|x| Some(job_json(&x.job_state, &x.job_result, x.job_id?)));
    json!({
        "id": b.id,
        "position": b.position,
        "title": b.title(),
        "intent": b.intent,
        "refs": b.refs(),
        "narration": b.narration(),
        "status": if b.approved() { "aprovado" } else { "pendente" },
        "stale": b.stale(),
        "version": b.versions.iter().filter(|x| x.written()).count(),
        "edited": b.current().is_some_and(|x| x.kind == "edit"),
        "job": job,
    })
}

fn document(cut: &Cut) -> Result<Value, CoreError> {
    let (run, identity) = (cut.cut.run, cut.cut.identity);
    let gens = refresh(cut)?;
    let latest = gens.last();
    let shown = latest_with_blocks(&gens);
    let detected = packaging::detect_language(&cut.cut.sentences);
    let (angle_revision, angle) = crate::angles::selected(&cut.cut)?;
    let revision: usize = angle_revision as usize
        + gens
            .iter()
            .map(|g| {
                1 + g
                    .blocks
                    .iter()
                    .map(|b| b.versions.iter().filter(|x| x.written()).count() + b.approvals.len())
                    .sum::<usize>()
            })
            .sum::<usize>();
    let current = shown.map(|g| {
        let pending = g.blocks.iter().filter(|b| !b.approved()).count();
        json!({
            "generation": gens.iter().position(|x| x.id == g.id).map_or(0, |i| i + 1),
            "language": g.language,
            "blocks": g.blocks.iter().map(block_json).collect::<Vec<_>>(),
            "totalChars": total_chars(g),
            "pending": pending,
            "approved": g.blocks.len() - pending,
            "complete": g.blocks.iter().all(|b| b.current().is_some()),
        })
    });
    let generations: Vec<Value> = gens
        .iter()
        .enumerate()
        .map(|(i, g)| {
            json!({
                "generation": i + 1,
                "jobId": g.job_id,
                "language": g.language,
                "taskVersion": g.task_version,
                "promptSha256": g.prompt_sha256,
                "profile": g.profile,
                "createdAt": g.created_at,
                "outline": g.outline,
                "angle": g.angle,
                "blocks": g.blocks.iter().map(|b| json!({
                    "id": b.id,
                    "position": b.position,
                    "versions": b.versions.iter().filter(|x| x.written()).map(|x| json!({
                        "id": x.id,
                        "kind": x.kind,
                        "jobId": x.job_id,
                        "taskVersion": x.task_version,
                        "promptSha256": x.prompt_sha256,
                        "profile": x.profile,
                        "createdAt": x.created_at,
                        "title": x.title,
                        "narration": x.narration,
                        "refs": x.refs,
                        "approved": b.approvals.iter().any(|(id, _, _)| *id == x.id),
                    })).collect::<Vec<_>>(),
                })).collect::<Vec<_>>(),
            })
        })
        .collect();
    Ok(json!({
        "schemaVersion": 1,
        "revision": revision,
        "angle": angle,
        "candidate": {"run": run, "startId": identity.0, "endId": identity.1},
        "detectedLanguage": detected.map(Lang::code),
        "languageRequired": detected.is_none(),
        "current": current,
        "narrationAllowed": gate(&gens).is_ok(),
        "job": latest.map(|g| job_json(&g.job_state, &g.job_result, g.job_id)),
        "busy": gens.iter().any(Generation::busy),
        "limits": limits_json(),
        "generations": generations,
    }))
}

/// `script.get {candidate}`: o documento do Roteiro do Corte (esboço, blocos, versões, estado de
/// aprovação, último job e se a Narração está liberada).
fn cmd_get(v: Value, _: &mut EventSink<'_>) -> CommandResult {
    document(&context(candidate_arg(&v)?)?)
}

pub(crate) struct MontageScriptBlock {
    pub id: i64,
    pub position: i64,
    pub title: String,
    pub refs: Vec<i64>,
    pub narration: Option<String>,
}

pub(crate) struct MontageScript {
    pub blocks: Vec<MontageScriptBlock>,
    pub approved: bool,
}

/// Lê os blocos do Roteiro mais recente de um candidato do Vídeo transformado sem enfileirar
/// jobs nem gravar no banco (seguro para prévias e leitura na timeline).
pub(crate) fn montage_blocks_readonly(candidate: i64) -> Result<Option<MontageScript>, CoreError> {
    let cut = crate::selection::approved_cut(candidate)?;
    let kind: String = projects::with_reader(|c| {
        c.query_row(
            "SELECT video_kind FROM selection_runs WHERE id=?1",
            [cut.run],
            |r| r.get(0),
        )
    })?;
    if kind != "transformed" {
        return Ok(None);
    }
    let gens = read_generations(cut.run, cut.identity)?;
    let Some(shown) = latest_with_blocks(&gens) else {
        return Ok(None);
    };
    let approved = gate(&gens).is_ok();
    let blocks = shown
        .blocks
        .iter()
        .map(|b| MontageScriptBlock {
            id: b.id,
            position: b.position,
            title: b.title(),
            refs: b.refs(),
            narration: b.narration().map(str::to_owned),
        })
        .collect();
    Ok(Some(MontageScript { blocks, approved }))
}

/// Consulta para a escolha de ângulo: materializa respostas já recebidas, mas nunca
/// continua a cadeia nem enfileira chamadas ao Provedor no caminho da escrita manual.
pub(crate) fn angle_change_state(
    cut: &crate::selection::ApprovedCut,
) -> Result<(bool, bool), CoreError> {
    materialize(cut.run, cut.identity)?;
    let generations = read_generations(cut.run, cut.identity)?;
    Ok((
        generations.iter().any(Generation::busy),
        latest_with_blocks(&generations).is_some(),
    ))
}

fn gate_error(reason: &str, pending: usize) -> CoreError {
    CoreError {
        code: "script_not_approved".into(),
        message: "A Narração só é liberada quando todos os blocos do Roteiro estão aprovados."
            .into(),
        usage: Some(json!({"reason": reason, "pending": pending})),
    }
}

/// A trava: o Roteiro mais recente tem blocos, todos com texto e aprovados na versão atual, e
/// nenhuma geração nova está em andamento.
fn gate(gens: &[Generation]) -> Result<(), CoreError> {
    if gens.last().is_some_and(Generation::busy) {
        return Err(gate_error("generating", 0));
    }
    let Some(shown) = latest_with_blocks(gens) else {
        return Err(gate_error("no_script", 0));
    };
    let pending = shown.blocks.iter().filter(|b| !b.approved()).count();
    if pending > 0 {
        return Err(gate_error("pending_blocks", pending));
    }
    Ok(())
}

/// Trava da Narração (ADR-0001, regra 5): os comandos que geram ou importam a Narração (#79,
/// #83 e #84) chamam esta função antes de qualquer coisa. Só passa um Corte do Vídeo transformado
/// cujo Roteiro tem todos os blocos aprovados na versão atual; qualquer outro caso é
/// `script_not_approved` (ou `script_requires_transformed` para o Corte direto).
pub fn narration_allowed(candidate: i64) -> Result<(), CoreError> {
    let cut = context(candidate)?;
    gate(&refresh(&cut)?)
}

/// `script.narration_allowed {candidate}`: `{allowed: true}` ou o erro `script_not_approved`.
fn cmd_narration_allowed(v: Value, _: &mut EventSink<'_>) -> CommandResult {
    narration_allowed(candidate_arg(&v)?)?;
    Ok(json!({"allowed": true}))
}

// ---------------------------------------------------------------- edição, aprovação, regeneração

fn block_arg(v: &Value) -> Result<i64, CoreError> {
    v["block"]
        .as_i64()
        .ok_or_else(|| error("block_not_found", "Bloco não encontrado."))
}

/// O Roteiro mostrado e o bloco pedido, que tem de ser dele e estar livre de job.
fn shown_block(gens: &[Generation], id: i64) -> Result<(&Generation, &Block), CoreError> {
    let gen = latest_with_blocks(gens)
        .ok_or_else(|| error("block_not_found", "Bloco não encontrado."))?;
    let block = gen
        .blocks
        .iter()
        .find(|b| b.id == id)
        .ok_or_else(|| error("block_not_found", "Bloco não encontrado."))?;
    if gens.last().is_some_and(|g| {
        g.job_state
            .as_deref()
            .is_some_and(|s| s == "queued" || s == "running")
    }) || block.busy()
    {
        return Err(error(
            "generation_in_progress",
            "Já há uma geração em andamento para este bloco.",
        ));
    }
    Ok((gen, block))
}

fn string_arg(v: &Value, key: &str) -> Result<Option<String>, CoreError> {
    match &v[key] {
        Value::Null => Ok(None),
        Value::String(s) => Ok(Some(s.clone())),
        _ => Err(error("invalid_edit", "Edição inválida.")),
    }
}

fn refs_arg(v: &Value) -> Result<Option<Vec<i64>>, CoreError> {
    match &v["refs"] {
        Value::Null => Ok(None),
        Value::Array(a) => a
            .iter()
            .map(Value::as_i64)
            .collect::<Option<Vec<_>>>()
            .map(Some)
            .ok_or_else(|| error("invalid_edit", "Edição inválida.")),
        _ => Err(error("invalid_edit", "Edição inválida.")),
    }
}

/// Limites de uma edição, com os mesmos códigos dos verificadores.
fn check_edit(
    title: &str,
    narration: &str,
    refs: &[i64],
    ids: &[i64],
    others_chars: usize,
) -> Vec<Violation> {
    let mut out = Vec::new();
    if title.is_empty() {
        out.push(v("title_empty", "/title", "Title is empty"));
    } else if title.chars().count() > MAX_TITLE_CHARS {
        out.push(v("title_too_long", "/title", "Title is too long"));
    }
    let chars = narration.chars().count();
    if narration.is_empty() {
        out.push(v("narration_empty", "/narration", "Narration is empty"));
    } else if chars > MAX_NARRATION_CHARS {
        out.push(v(
            "narration_too_long",
            "/narration",
            "Narration is too long",
        ));
    }
    if others_chars + chars > MAX_SCRIPT_CHARS {
        out.push(v(
            "script_too_long",
            "/narration",
            "Script is too long in total",
        ));
    }
    if forbidden(title) || forbidden(narration) {
        out.push(v(
            "forbidden_character",
            "/narration",
            "Text contains a forbidden character",
        ));
    }
    if packaging::has_url(title) || packaging::has_url(narration) {
        out.push(v("invented_url", "/narration", "Text contains a URL"));
    }
    if refs.len() > MAX_REFS {
        out.push(v("too_many_refs", "/refs", "Too many references"));
    }
    for (i, r) in refs.iter().enumerate() {
        if !ids.contains(r) {
            out.push(v(
                "unknown_sentence_id",
                &format!("/refs/{i}"),
                "Sentence id is not in the clip",
            ));
        }
    }
    out
}

fn others_chars(gen: &Generation, block: &Block) -> usize {
    gen.blocks
        .iter()
        .filter(|b| b.id != block.id)
        .filter_map(Block::narration)
        .map(|t| t.chars().count())
        .sum()
}

/// `script.edit {candidate, block, title?, narration?, refs?}`: grava uma versão nova do bloco,
/// validada com os mesmos limites. O bloco volta a `pendente`.
fn cmd_edit(v: Value, _: &mut EventSink<'_>) -> CommandResult {
    let cut = context(candidate_arg(&v)?)?;
    let gens = refresh(&cut)?;
    let (gen, block) = shown_block(&gens, block_arg(&v)?)?;
    let Some(current) = block.current() else {
        return Err(error(
            "nothing_to_edit",
            "Gere o texto do bloco antes de editar.",
        ));
    };
    let title = string_arg(&v, "title")?
        .map(|s| s.trim().to_owned())
        .unwrap_or_else(|| block.title());
    let narration = string_arg(&v, "narration")?
        .map(|s| s.trim().to_owned())
        .unwrap_or_else(|| current.narration.clone().unwrap_or_default());
    let refs = refs_arg(&v)?.unwrap_or_else(|| block.refs());
    let violations = check_edit(
        &title,
        &narration,
        &refs,
        &ids_of(&cut.cut.sentences),
        others_chars(gen, block),
    );
    if !violations.is_empty() {
        return Err(CoreError {
            code: "edit_invalid".into(),
            message: "A edição passa de um limite do Roteiro ou tem formato inválido.".into(),
            usage: Some(json!({"violations": violations})),
        });
    }
    if title != block.title()
        || Some(narration.as_str()) != current.narration.as_deref()
        || refs != block.refs()
        || block.stale()
    {
        projects::with_writer(|c| {
            c.execute(
                "INSERT INTO script_block_versions(block_id,kind,title,narration,refs,angle_revision) VALUES (?1,'edit',?2,?3,?4,?5)",
                (block.id, &title, &narration, json!(refs).to_string(), block.angle_revision),
            )?;
            Ok(())
        })?;
    }
    document(&cut)
}

/// `script.approve {candidate, block}`: aprova a versão atual do bloco, um de cada vez.
fn cmd_approve(v: Value, _: &mut EventSink<'_>) -> CommandResult {
    let cut = context(candidate_arg(&v)?)?;
    let gens = refresh(&cut)?;
    let (_, block) = shown_block(&gens, block_arg(&v)?)?;
    let current = block.current().ok_or_else(|| {
        error(
            "nothing_to_approve",
            "O bloco ainda não tem texto para aprovar.",
        )
    })?;
    if !block.approved() {
        projects::with_writer(|c| {
            c.execute(
                "INSERT INTO script_approvals(block_id,version_id,angle_revision) VALUES (?1,?2,?3)",
                (block.id, current.id, block.angle_revision),
            )?;
            Ok(())
        })?;
    }
    document(&cut)
}

/// `script.regenerate {candidate, block, confirmed?}`: uma chamada com o bloco anterior e o
/// seguinte; o resultado vira uma versão nova e o bloco volta a `pendente`. Provedor pago exige
/// `confirmed`.
fn cmd_regenerate(v: Value, _: &mut EventSink<'_>) -> CommandResult {
    let cut = context(candidate_arg(&v)?)?;
    let gens = refresh(&cut)?;
    let (gen, block) = shown_block(&gens, block_arg(&v)?)?;
    crate::angles::required(&cut.cut)?;
    let lang = Lang::parse(&gen.language).unwrap_or(Lang::Pt);
    let chosen = profile_arg(&v);
    let (profile, safety) = route_safety(BLOCK_TASK_ID, chosen.as_deref())?;
    let index = gen
        .blocks
        .iter()
        .position(|b| b.id == block.id)
        .unwrap_or_default();
    let outline: Vec<Outlined> = gen.blocks.iter().map(outlined).collect();
    let neighbor = |i: Option<usize>| i.and_then(|i| gen.blocks.get(i)).and_then(Block::narration);
    let room = MAX_SCRIPT_CHARS
        .saturating_sub(others_chars(gen, block))
        .max(1);
    let mut input = block_input(
        &cut.cut.sentences,
        lang,
        &outline,
        index,
        (neighbor(index.checked_sub(1)), neighbor(Some(index + 1))),
        room.min(MAX_NARRATION_CHARS),
    );
    crate::angles::add_to_input(&mut input, &cut.cut, true)?;
    if matches!(safety, Safety::Paid) && v["confirmed"] != true {
        return Err(confirmation_required(estimate_of(
            BLOCK_TASK_ID,
            &input,
            safety,
            chosen.as_deref(),
        )));
    }
    let job = enqueue_version(
        &cut,
        block,
        "regenerated",
        &input,
        safety,
        &profile,
        chosen.as_deref(),
    )?;
    Ok(json!({"job": job, "block": block.id}))
}

inventory::submit! { CommandRegistration { name: "script.estimate", execute: cmd_estimate } }
inventory::submit! { CommandRegistration { name: "script.generate", execute: cmd_generate } }
inventory::submit! { CommandRegistration { name: "script.get", execute: cmd_get } }
inventory::submit! { CommandRegistration { name: "script.edit", execute: cmd_edit } }
inventory::submit! { CommandRegistration { name: "script.approve", execute: cmd_approve } }
inventory::submit! { CommandRegistration { name: "script.regenerate", execute: cmd_regenerate } }
inventory::submit! { CommandRegistration { name: "script.narration_allowed", execute: cmd_narration_allowed } }

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn edit_limits_cover_blocks_and_total() {
        let ids = [1, 2, 3];
        assert!(check_edit("Título", "Texto", &[1, 2], &ids, 0).is_empty());
        let codes = |t: &str, n: &str, r: &[i64], others: usize| -> Vec<&'static str> {
            check_edit(t, n, r, &ids, others)
                .iter()
                .map(|x| x.code)
                .collect()
        };
        assert!(codes("", "x", &[], 0).contains(&"title_empty"));
        assert!(codes(&"t".repeat(81), "x", &[], 0).contains(&"title_too_long"));
        assert!(codes("t", "", &[], 0).contains(&"narration_empty"));
        assert!(codes("t", &"n".repeat(801), &[], 0).contains(&"narration_too_long"));
        assert!(codes("t", &"n".repeat(800), &[], 0).is_empty());
        assert!(codes("t", &"n".repeat(800), &[], 5300).contains(&"script_too_long"));
        assert!(codes("t", &"n".repeat(800), &[], 5200).is_empty());
        assert!(codes("t", "a < b", &[], 0).contains(&"forbidden_character"));
        assert!(codes("t", "veja www.x.com", &[], 0).contains(&"invented_url"));
        assert!(codes("t", "x", &[9], 0).contains(&"unknown_sentence_id"));
    }

    #[test]
    fn chain_estimate_sums_usd_and_keeps_unknown() {
        let outline = json!({"kind":"usd","minMicroUsd":100,"maxMicroUsd":200});
        let block = json!({"kind":"usd","minMicroUsd":10,"maxMicroUsd":20});
        let chain = chain_estimate(&outline, &block);
        assert_eq!(chain["minMicroUsd"], 100 + 10 * 3);
        assert_eq!(chain["maxMicroUsd"], 200 + 20 * 12);
        let unknown = json!({"kind":"unknown","minMicroUsd":null,"maxMicroUsd":null});
        assert_eq!(chain_estimate(&outline, &unknown)["kind"], "unknown");
    }

    #[test]
    fn block_prompt_carries_neighbors_and_limit() {
        let outline = vec![
            Outlined {
                title: "Abertura".into(),
                intent: "Apresenta o tema".into(),
                refs: vec![1, 2],
            },
            Outlined {
                title: "Fecho".into(),
                intent: "Encerra".into(),
                refs: vec![],
            },
        ];
        let input = block_input(
            &[],
            Lang::Pt,
            &outline,
            1,
            (Some("texto\nanterior"), None),
            400,
        );
        assert!(input.transcript.starts_with("#BLOCO idioma=pt-BR n=2 de=2 max=400\n#ESBOCO\n1 Abertura :: Apresenta o tema :: 1,2\n2 Fecho :: Encerra :: \n#ANTERIOR\ntexto anterior\n#PROXIMO\n-\n#CORTE\n"));
        assert_eq!(input.context["maxChars"], 400);
    }
}
