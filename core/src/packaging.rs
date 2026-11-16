//! Empacotamento do Corte (#68): título, descrição, tags e hashtags sugeridos por uma Tarefa de IA
//! (uma chamada por Corte aprovado), mais o crédito da Fonte, que o NÚCLEO monta a partir da
//! Permissão e nunca pede ao modelo. Sem juiz, voting nem tool calling.
//!
//! O documento fica no Projeto (migração `0068_001_packaging`): cada geração guarda a saída do
//! modelo, a versão da Tarefa, o hash do prompt e o perfil; cada edição do usuário é uma linha
//! nova. Regenerar cria outra geração e nunca apaga as anteriores. Veja
//! `docs/contribuindo/empacotamento.md`.
use crate::{
    ai_task::{self, AiTask, Budget, TaskInput, Violation},
    jobs::{self, Safety},
    projects, provider,
    sentences::{self, Sentence},
    CommandRegistration, CommandResult, CoreError, EventSink,
};
use serde_json::{json, Value};

pub const TASK_ID: &str = "packaging";
pub const JOB_KIND: &str = "ai:packaging";

// Limites oficiais do YouTube (https://developers.google.com/youtube/v3/docs/videos, `snippet`).
/// Título: no máximo 100 caracteres.
pub const MAX_TITLE_CHARS: usize = 100;
/// Descrição: no máximo 5000 bytes (já com o crédito).
pub const MAX_DESCRIPTION_BYTES: usize = 5000;
/// Tags: soma de até 500 caracteres; vírgulas entre itens contam e uma tag com espaço conta duas
/// aspas a mais.
pub const MAX_TAGS_CHARS: usize = 500;
// Limites do produto (a API não os documenta).
pub const MAX_TAGS: usize = 30;
pub const MAX_TAG_CHARS: usize = 60;
pub const MAX_HASHTAGS: usize = 15;
pub const MAX_HASHTAG_CHARS: usize = 60;
/// Tamanho máximo do nome no crédito, em caracteres.
const MAX_CREDIT_WHO_CHARS: usize = 120;
/// Mínimo de palavras em título e descrição para a heurística de idioma agir.
pub const LANGUAGE_MIN_WORDS: usize = 12;

const PROMPT: &str = include_str!("packaging/prompt.md");
const WIRE: &str = include_str!("packaging/wire.json");
const FULL: &str = include_str!("packaging/full.json");

fn error(code: &str, message: &str) -> CoreError {
    CoreError {
        code: code.into(),
        message: message.into(),
        usage: None,
    }
}

// ---------------------------------------------------------------- idioma

#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub enum Lang {
    Pt,
    En,
}

impl Lang {
    pub fn code(self) -> &'static str {
        match self {
            Lang::Pt => "pt-BR",
            Lang::En => "en",
        }
    }
    pub fn parse(code: &str) -> Option<Lang> {
        match code {
            "pt-BR" => Some(Lang::Pt),
            "en" => Some(Lang::En),
            _ => None,
        }
    }
}

/// Idioma do Corte pela regra de 80% por caracteres das Frases (#140): `pt*` ou `en*`; `und`,
/// `mul` ou outro idioma dão `None`.
pub fn detect_language(frases: &[Sentence]) -> Option<Lang> {
    let language = sentences::compact_with_hint(frases)
        .hint
        .language
        .to_lowercase();
    let base = language.split(['-', '_']).next().unwrap_or("");
    match base {
        "pt" => Some(Lang::Pt),
        "en" => Some(Lang::En),
        _ => None,
    }
}

const PT_WORDS: &[&str] = &[
    "de", "que", "não", "um", "uma", "para", "com", "os", "é", "em", "por", "mais", "mas", "como",
    "foi", "ele", "ela", "você", "isso", "muito", "são", "também", "quando", "tem", "seu", "sua",
    "nos", "já", "até", "pelo", "pela", "sobre", "então", "porque", "aqui", "onde", "esse", "essa",
    "do", "da", "dos", "das", "na", "ao",
];
const EN_WORDS: &[&str] = &[
    "the", "and", "of", "to", "in", "is", "that", "it", "for", "with", "was", "on", "are", "as",
    "his", "they", "be", "at", "this", "have", "from", "or", "had", "by", "but", "what", "all",
    "were", "when", "your", "can", "said", "there", "each", "which", "she", "their", "will",
    "about", "how", "up", "out", "them", "then", "you", "we",
];

fn words_of(text: &str) -> Vec<String> {
    text.to_lowercase()
        .split(|c: char| !(c.is_alphabetic() || c == '\''))
        .filter(|w| !w.is_empty())
        .map(str::to_owned)
        .collect()
}

/// Heurística local de stopwords: só rejeita com pelo menos [`LANGUAGE_MIN_WORDS`] palavras,
/// quando o outro idioma tem mais que o dobro das ocorrências do pedido (e ao menos 3). Na
/// dúvida passa.
pub fn looks_wrong_language(text: &str, wanted: Lang) -> bool {
    let words = words_of(text);
    if words.len() < LANGUAGE_MIN_WORDS {
        return false;
    }
    let count = |list: &[&str]| words.iter().filter(|w| list.contains(&w.as_str())).count();
    let (pt, en) = (count(PT_WORDS), count(EN_WORDS));
    let (own, other) = match wanted {
        Lang::Pt => (pt, en),
        Lang::En => (en, pt),
    };
    other >= 3 && other > own.saturating_mul(2)
}

// ---------------------------------------------------------------- campos e limites

/// Campos editáveis do empacotamento.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Fields {
    pub title: String,
    pub description: String,
    pub tags: Vec<String>,
    pub hashtags: Vec<String>,
}

impl Fields {
    fn from_value(v: &Value) -> Option<Fields> {
        let strings = |key: &str| -> Option<Vec<String>> {
            v[key]
                .as_array()?
                .iter()
                .map(|x| x.as_str().map(str::to_owned))
                .collect()
        };
        Some(Fields {
            title: v["title"].as_str()?.to_owned(),
            description: v["description"].as_str()?.to_owned(),
            tags: strings("tags")?,
            hashtags: strings("hashtags")?,
        })
    }
    fn to_value(&self) -> Value {
        json!({"title": self.title, "description": self.description, "tags": self.tags, "hashtags": self.hashtags})
    }
}

/// Caracteres que a API conta para as tags: cada tag, duas aspas se tiver espaço, e as vírgulas.
pub fn tags_chars(tags: &[String]) -> usize {
    let items: usize = tags
        .iter()
        .map(|t| t.chars().count() + if t.contains(' ') { 2 } else { 0 })
        .sum();
    items + tags.len().saturating_sub(1)
}

pub(crate) fn has_url(text: &str) -> bool {
    let lower = text.to_lowercase();
    ["http://", "https://", "://", "www."]
        .iter()
        .any(|m| lower.contains(m))
}

fn valid_hashtag(h: &str) -> bool {
    let Some(rest) = h.strip_prefix('#') else {
        return false;
    };
    !rest.is_empty()
        && h.chars().count() <= MAX_HASHTAG_CHARS
        && rest.chars().all(|c| c.is_alphanumeric() || c == '_')
        && !rest.chars().all(|c| c.is_ascii_digit())
}

fn v(code: &'static str, path: &str, message: &'static str) -> Violation {
    Violation::new(code, path, message)
}

/// Limites e formato dos campos (compartilhado pelo verificador e pela edição). `credit_bytes` é
/// o espaço que o crédito ocupa na descrição final.
pub fn check_limits(f: &Fields, credit_bytes: usize) -> Vec<Violation> {
    let mut out = Vec::new();
    let title = f.title.trim();
    if title.is_empty() {
        out.push(v("title_empty", "/title", "Title is empty"));
    } else if title.chars().count() > MAX_TITLE_CHARS {
        out.push(v("title_too_long", "/title", "Title is too long"));
    }
    if f.description.len() + credit_bytes > MAX_DESCRIPTION_BYTES {
        out.push(v(
            "description_too_long",
            "/description",
            "Description is too long",
        ));
    }
    if f.title.contains(['<', '>']) || f.description.contains(['<', '>']) {
        out.push(v(
            "forbidden_character",
            "/title",
            "Text contains a forbidden character",
        ));
    }
    if f.tags.len() > MAX_TAGS {
        out.push(v("too_many_tags", "/tags", "Too many tags"));
    }
    for (i, t) in f.tags.iter().enumerate() {
        let p = format!("/tags/{i}");
        if t.trim().is_empty() || t.contains(',') || t.contains(['<', '>']) {
            out.push(v(
                "invalid_tag",
                &p,
                "Tag is empty or has a forbidden character",
            ));
        } else if t.chars().count() > MAX_TAG_CHARS {
            out.push(v("tag_too_long", &p, "Tag is too long"));
        }
    }
    if tags_chars(&f.tags) > MAX_TAGS_CHARS {
        out.push(v("tags_too_long", "/tags", "Tags are too long together"));
    }
    if f.hashtags.len() > MAX_HASHTAGS {
        out.push(v("too_many_hashtags", "/hashtags", "Too many hashtags"));
    }
    for (i, h) in f.hashtags.iter().enumerate() {
        if !valid_hashtag(h) {
            out.push(v(
                "invalid_hashtag",
                &format!("/hashtags/{i}"),
                "Hashtag must start with # and have no spaces",
            ));
        }
    }
    out
}

// ---------------------------------------------------------------- verificadores

fn fields_of(output: &Value) -> Option<Fields> {
    Fields::from_value(output)
}

fn wanted(input: &TaskInput) -> Option<Lang> {
    input.context["language"].as_str().and_then(Lang::parse)
}

fn limits(input: &TaskInput, output: &Value) -> Vec<Violation> {
    let Some(f) = fields_of(output) else {
        return vec![v("schema", "", "Output violates the full schema")];
    };
    let credit = input.context["creditBytes"].as_u64().unwrap_or(0) as usize;
    let mut out = check_limits(&f, credit);
    if f.description.trim().is_empty() {
        out.push(v(
            "description_empty",
            "/description",
            "Description is empty",
        ));
    }
    out
}

/// Sem URL: o link da Fonte é do núcleo, e o modelo não pode inventar nenhum.
fn no_urls(_: &TaskInput, output: &Value) -> Vec<Violation> {
    let Some(f) = fields_of(output) else {
        return Vec::new();
    };
    let mut out = Vec::new();
    for (path, text) in [("/title", &f.title), ("/description", &f.description)] {
        if has_url(text) {
            out.push(v("invented_url", path, "Text contains a URL"));
        }
    }
    for (i, t) in f.tags.iter().chain(&f.hashtags).enumerate() {
        if has_url(t) {
            out.push(v(
                "invented_url",
                &format!("/tags/{i}"),
                "Text contains a URL",
            ));
        }
    }
    out
}

/// `language` igual ao pedido e, na dúvida, passa: a heurística só rejeita com folga.
fn language_matches(input: &TaskInput, output: &Value) -> Vec<Violation> {
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
    let text = format!(
        "{} {}",
        output["title"].as_str().unwrap_or(""),
        output["description"].as_str().unwrap_or("")
    );
    if looks_wrong_language(&text, want) {
        return vec![v(
            "language_mismatch",
            "/description",
            "Text seems to be in another language",
        )];
    }
    Vec::new()
}

inventory::submit! {
    AiTask {
        id: TASK_ID,
        version: 1,
        prompt: PROMPT,
        prompt_sha256: "6a0ccbcd85b760aab2b3232d61445b413f0edc50c92108625dd8d903d20aaaf9",
        wire_schema: WIRE,
        full_schema: FULL,
        verifiers: &[language_matches, limits, no_urls],
        budget: Budget {
            max_calls: 2,
            max_input_tokens: 30_000,
            max_output_tokens: 1_500,
            max_wall_clock_secs: 300,
            max_cost_micro_cents: None,
        },
    }
}

fn task() -> &'static AiTask {
    ai_task::find(TASK_ID).expect("packaging task is registered")
}

// ---------------------------------------------------------------- crédito

/// O crédito da Fonte, montado pelo núcleo: só o nome (`who`) da Permissão e, se a Fonte veio de
/// uma URL pública, esse link. `where` e `scope` são privados e nunca entram. Sem Permissão
/// concedida (ou sem nome), `None`: nada de crédito inventado.
pub fn build_credit(lang: Lang, permission: &Value, origin_url: Option<&str>) -> Option<String> {
    if permission["status"].as_str() != Some("granted") {
        return None;
    }
    let who: String = permission["who"]
        .as_str()?
        .chars()
        .filter(|c| !c.is_control() && *c != '<' && *c != '>')
        .collect::<String>()
        .split_whitespace()
        .collect::<Vec<_>>()
        .join(" ")
        .chars()
        .take(MAX_CREDIT_WHO_CHARS)
        .collect();
    if who.is_empty() {
        return None;
    }
    let link = origin_url.and_then(public_url);
    let mut text = match lang {
        Lang::Pt => format!("Crédito: vídeo original de {who}."),
        Lang::En => format!("Credit: original video by {who}."),
    };
    if let Some(link) = link {
        text.push_str(match lang {
            Lang::Pt => "\nFonte: ",
            Lang::En => "\nSource: ",
        });
        text.push_str(&link);
    }
    Some(text)
}

/// A URL só entra se for HTTP(S) sem credenciais; o fragmento sai.
fn public_url(raw: &str) -> Option<String> {
    let mut url = reqwest::Url::parse(raw).ok()?;
    if !matches!(url.scheme(), "http" | "https")
        || url.host_str().is_none()
        || !url.username().is_empty()
        || url.password().is_some()
    {
        return None;
    }
    url.set_fragment(None);
    let text = url.to_string();
    (text.len() <= 500).then_some(text)
}

/// Descrição final: o texto do usuário e, depois, o crédito do núcleo.
pub fn full_description(description: &str, credit: Option<&str>) -> String {
    match credit {
        Some(c) => format!("{}\n\n{c}", description.trim_end()),
        None => description.to_owned(),
    }
}

fn credit_bytes(credit: Option<&str>) -> usize {
    credit.map_or(0, |c| c.len() + 2)
}

// ---------------------------------------------------------------- persistência

inventory::submit! { projects::Migration { id: "0068_001_packaging", sql: "
CREATE TABLE packaging_generations (
  id INTEGER PRIMARY KEY,
  job_id INTEGER NOT NULL UNIQUE,
  run_id INTEGER NOT NULL REFERENCES selection_runs(id) ON DELETE CASCADE,
  cand_start_id INTEGER NOT NULL,
  cand_end_id INTEGER NOT NULL,
  language TEXT NOT NULL CHECK(language IN ('pt-BR','en')),
  task_version INTEGER NOT NULL,
  prompt_sha256 TEXT NOT NULL,
  profile TEXT NOT NULL DEFAULT '',
  generated TEXT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE INDEX packaging_generations_cut ON packaging_generations(run_id, cand_start_id, cand_end_id, id);
CREATE TABLE packaging_edits (
  id INTEGER PRIMARY KEY,
  generation_id INTEGER NOT NULL REFERENCES packaging_generations(id) ON DELETE CASCADE,
  fields TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE INDEX packaging_edits_generation ON packaging_edits(generation_id, id);
" } }

struct Context {
    cut: crate::selection::ApprovedCut,
    source: i64,
    permission: Value,
    origin_url: Option<String>,
}

fn context(candidate: i64) -> Result<Context, CoreError> {
    let cut = crate::selection::approved_cut(candidate)?;
    let (source, permission, origin_url): (i64, String, Option<String>) =
        projects::with_reader(|c| {
            c.query_row(
                "SELECT s.id,s.permission,s.origin_url FROM transcripts t JOIN sources s ON s.id=t.source_id WHERE t.id=?1",
                [cut.transcript],
                |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?)),
            )
        })
        .map_err(|_| error("source_missing", "Fonte não encontrada"))?;
    Ok(Context {
        cut,
        source,
        permission: serde_json::from_str(&permission).unwrap_or(Value::Null),
        origin_url,
    })
}

fn pick_language(ctx: &Context, v: &Value) -> Result<Lang, CoreError> {
    if let Some(lang) = detect_language(&ctx.cut.sentences) {
        return Ok(lang);
    }
    v["language"].as_str().and_then(Lang::parse).ok_or_else(|| {
        error(
            "language_required",
            "Escolha o idioma do empacotamento: PT-BR ou EN.",
        )
    })
}

fn build_input(frases: &[Sentence], lang: Lang, credit: Option<&str>) -> TaskInput {
    let compact = sentences::compact_with_hint(frases);
    TaskInput {
        transcript: format!("#CORTE idioma={}\n{}", lang.code(), compact.text),
        estimate_hint: compact.hint,
        context: json!({"language": lang.code(), "creditBytes": credit_bytes(credit)}),
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

fn candidate_arg(v: &Value) -> Result<i64, CoreError> {
    v["candidate"]
        .as_i64()
        .ok_or_else(|| error("candidate_not_found", "Candidato não encontrado."))
}

/// `packaging.estimate {candidate, language?}`: idioma, se é preciso escolher, e custo estimado.
fn cmd_estimate(v: Value, _: &mut EventSink<'_>) -> CommandResult {
    let ctx = context(candidate_arg(&v)?)?;
    let (profile, safety) = route_safety()?;
    let lang = pick_language(&ctx, &v)?;
    let credit = build_credit(lang, &ctx.permission, ctx.origin_url.as_deref());
    let input = build_input(&ctx.cut.sentences, lang, credit.as_deref());
    Ok(json!({
        "paid": matches!(safety, Safety::Paid),
        "profile": profile,
        "language": lang.code(),
        "estimate": estimate_of(&input, safety),
    }))
}

/// `packaging.generate {candidate, language?, confirmed?}`: enfileira a Tarefa de IA do Corte.
/// Provedor pago exige `confirmed`.
fn cmd_generate(v: Value, _: &mut EventSink<'_>) -> CommandResult {
    let ctx = context(candidate_arg(&v)?)?;
    let lang = pick_language(&ctx, &v)?;
    let (profile, safety) = route_safety()?;
    let credit = build_credit(lang, &ctx.permission, ctx.origin_url.as_deref());
    let input = build_input(&ctx.cut.sentences, lang, credit.as_deref());
    if matches!(safety, Safety::Paid) && v["confirmed"] != true {
        return Err(CoreError {
            code: "confirmation_required".into(),
            message:
                "Este empacotamento usa um Provedor pago: confirme o custo estimado antes de gerar."
                    .into(),
            usage: Some(json!({"estimate": estimate_of(&input, safety)})),
        });
    }
    let (run, (start, end)) = (ctx.cut.run, ctx.cut.identity);
    let busy = projects::with_reader(|c| {
        c.query_row(
            "SELECT COUNT(*) FROM packaging_generations g JOIN jobs j ON j.id=g.job_id WHERE g.run_id=?1 AND g.cand_start_id=?2 AND g.cand_end_id=?3 AND j.state IN ('queued','running')",
            (run, start, end),
            |r| r.get::<_, i64>(0),
        )
    })?;
    if busy > 0 {
        return Err(error(
            "generation_in_progress",
            "Já há uma geração em andamento para este Corte.",
        ));
    }
    let definition = task();
    let batch = format!("packaging-{run}-{start}-{end}");
    let job = jobs::enqueue_ai_in_batch(TASK_ID, &input, safety, Some(&batch))?;
    projects::with_writer(|c| {
        c.execute(
            "INSERT INTO packaging_generations(job_id,run_id,cand_start_id,cand_end_id,language,task_version,prompt_sha256,profile) VALUES (?1,?2,?3,?4,?5,?6,?7,?8)",
            (job, run, start, end, lang.code(), definition.version, definition.prompt_sha256, &profile),
        )?;
        Ok(())
    })?;
    Ok(json!({"job": job, "language": lang.code()}))
}

struct Generation {
    id: i64,
    job_id: i64,
    language: String,
    task_version: i64,
    prompt_sha256: String,
    profile: String,
    created_at: String,
    generated: Option<Fields>,
    edits: Vec<(String, Fields)>,
    job_state: Option<String>,
    job_result: Option<Value>,
}

/// Grava a saída dos jobs concluídos que ainda não têm campos (idempotente).
fn materialize(run: i64, identity: (i64, i64)) -> Result<(), CoreError> {
    projects::with_writer(|c| {
        let mut q = c.prepare(
            "SELECT g.id,j.result FROM packaging_generations g JOIN jobs j ON j.id=g.job_id WHERE g.run_id=?1 AND g.cand_start_id=?2 AND g.cand_end_id=?3 AND g.generated IS NULL AND j.state='completed'",
        )?;
        let rows: Vec<(i64, Option<String>)> = q
            .query_map((run, identity.0, identity.1), |r| {
                Ok((r.get(0)?, r.get(1)?))
            })?
            .collect::<rusqlite::Result<_>>()?;
        for (id, result) in rows {
            let data = result
                .and_then(|t| serde_json::from_str::<Value>(&t).ok())
                .and_then(|r| Fields::from_value(&r["data"]));
            if let Some(f) = data {
                c.execute(
                    "UPDATE packaging_generations SET generated=?2 WHERE id=?1",
                    (id, f.to_value().to_string()),
                )?;
            }
        }
        Ok(())
    })
}

fn read_generations(run: i64, identity: (i64, i64)) -> Result<Vec<Generation>, CoreError> {
    projects::with_reader(|c| {
        let mut q = c.prepare(
            "SELECT g.id,g.job_id,g.language,g.task_version,g.prompt_sha256,g.profile,g.created_at,g.generated,j.state,j.result FROM packaging_generations g LEFT JOIN jobs j ON j.id=g.job_id WHERE g.run_id=?1 AND g.cand_start_id=?2 AND g.cand_end_id=?3 ORDER BY g.id",
        )?;
        let mut rows: Vec<Generation> = q
            .query_map((run, identity.0, identity.1), |r| {
                let generated: Option<String> = r.get(7)?;
                let result: Option<String> = r.get(9)?;
                Ok(Generation {
                    id: r.get(0)?,
                    job_id: r.get(1)?,
                    language: r.get(2)?,
                    task_version: r.get(3)?,
                    prompt_sha256: r.get(4)?,
                    profile: r.get(5)?,
                    created_at: r.get(6)?,
                    generated: generated
                        .and_then(|t| serde_json::from_str::<Value>(&t).ok())
                        .and_then(|v| Fields::from_value(&v)),
                    edits: Vec::new(),
                    job_state: r.get(8)?,
                    job_result: result.and_then(|t| serde_json::from_str(&t).ok()),
                })
            })?
            .collect::<rusqlite::Result<_>>()?;
        let mut e = c.prepare(
            "SELECT created_at,fields FROM packaging_edits WHERE generation_id=?1 ORDER BY id",
        )?;
        for g in &mut rows {
            g.edits = e
                .query_map([g.id], |r| {
                    Ok((r.get::<_, String>(0)?, r.get::<_, String>(1)?))
                })?
                .filter_map(Result::ok)
                .filter_map(|(at, t)| {
                    let f = Fields::from_value(&serde_json::from_str(&t).ok()?)?;
                    Some((at, f))
                })
                .collect();
        }
        Ok(rows)
    })
}

/// Código de erro do job: só o formato fixo esperado, nunca texto do modelo.
pub(crate) fn job_code(result: &Option<Value>) -> Option<String> {
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

pub(crate) fn violation_codes(result: &Option<Value>) -> Vec<String> {
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

fn limits_json() -> Value {
    json!({
        "titleChars": MAX_TITLE_CHARS,
        "descriptionBytes": MAX_DESCRIPTION_BYTES,
        "tagsChars": MAX_TAGS_CHARS,
        "tags": MAX_TAGS,
        "tagChars": MAX_TAG_CHARS,
        "hashtags": MAX_HASHTAGS,
    })
}

fn current_of(g: &Generation) -> Option<&Fields> {
    g.edits.last().map(|e| &e.1).or(g.generated.as_ref())
}

fn document(ctx: &Context) -> Result<Value, CoreError> {
    let (run, identity) = (ctx.cut.run, ctx.cut.identity);
    materialize(run, identity)?;
    let all = read_generations(run, identity)?;
    let done: Vec<&Generation> = all.iter().filter(|g| g.generated.is_some()).collect();
    let latest_job = all.last();
    let detected = detect_language(&ctx.cut.sentences);
    let lang = done
        .last()
        .and_then(|g| Lang::parse(&g.language))
        .or(detected);
    let credit = lang.and_then(|l| build_credit(l, &ctx.permission, ctx.origin_url.as_deref()));
    let revision: usize = done.iter().map(|g| 1 + g.edits.len()).sum();
    let current = done.last().and_then(|g| {
        let f = current_of(g)?;
        Some(json!({
            "generation": done.len(),
            "language": g.language,
            "edited": !g.edits.is_empty(),
            "title": f.title, "description": f.description, "tags": f.tags, "hashtags": f.hashtags,
            "fullDescription": full_description(&f.description, credit.as_deref()),
        }))
    });
    let generations: Vec<Value> = done
        .iter()
        .enumerate()
        .map(|(i, g)| {
            let generated = g.generated.as_ref().map(Fields::to_value);
            json!({
                "generation": i + 1,
                "jobId": g.job_id,
                "language": g.language,
                "taskVersion": g.task_version,
                "promptSha256": g.prompt_sha256,
                "profile": g.profile,
                "createdAt": g.created_at,
                "generated": generated,
                "edits": g.edits.iter().map(|(at, f)| {
                    let mut e = f.to_value();
                    e["createdAt"] = json!(at);
                    e
                }).collect::<Vec<_>>(),
            })
        })
        .collect();
    let job = latest_job.map(|g| {
        json!({
            "id": g.job_id,
            "state": g.job_state,
            "code": job_code(&g.job_result),
            "violations": violation_codes(&g.job_result),
        })
    });
    Ok(json!({
        "schemaVersion": 1,
        "revision": revision,
        "candidate": {"run": run, "startId": identity.0, "endId": identity.1},
        "detectedLanguage": detected.map(Lang::code),
        "languageRequired": detected.is_none(),
        "current": current,
        "credit": {"text": credit, "warning": if ctx.permission["status"] != "granted" { json!("no_permission") } else { Value::Null }},
        "job": job,
        "limits": limits_json(),
        "generations": generations,
        "source": ctx.source,
    }))
}

/// `packaging.get {candidate}`: o documento do Corte (gerações, edições, crédito e último job).
fn cmd_get(v: Value, _: &mut EventSink<'_>) -> CommandResult {
    document(&context(candidate_arg(&v)?)?)
}

fn edit_field(v: &Value, key: &str) -> Result<Option<Vec<String>>, CoreError> {
    match &v[key] {
        Value::Null => Ok(None),
        Value::Array(a) => a
            .iter()
            .map(|x| x.as_str().map(str::to_owned))
            .collect::<Option<Vec<_>>>()
            .map(Some)
            .ok_or_else(|| error("invalid_edit", "Edição inválida.")),
        _ => Err(error("invalid_edit", "Edição inválida.")),
    }
}

/// `packaging.edit {candidate, title?, description?, tags?, hashtags?}`: grava uma edição sobre a
/// geração atual, validada com os mesmos limites. O crédito não é editável: a edição não o vê.
fn cmd_edit(v: Value, _: &mut EventSink<'_>) -> CommandResult {
    let ctx = context(candidate_arg(&v)?)?;
    let (run, identity) = (ctx.cut.run, ctx.cut.identity);
    materialize(run, identity)?;
    let all = read_generations(run, identity)?;
    let g = all
        .iter()
        .rev()
        .find(|g| g.generated.is_some())
        .ok_or_else(|| error("nothing_to_edit", "Gere o empacotamento antes de editar."))?;
    let mut f = current_of(g).cloned().expect("generated is present");
    let before = f.clone();
    for (key, slot) in [("title", &mut f.title), ("description", &mut f.description)] {
        match &v[key] {
            Value::Null => {}
            Value::String(s) => *slot = s.clone(),
            _ => return Err(error("invalid_edit", "Edição inválida.")),
        }
    }
    if let Some(t) = edit_field(&v, "tags")? {
        f.tags = t;
    }
    if let Some(h) = edit_field(&v, "hashtags")? {
        f.hashtags = h;
    }
    f.title = f.title.trim().to_owned();
    f.tags = f.tags.iter().map(|t| t.trim().to_owned()).collect();
    f.hashtags = f.hashtags.iter().map(|t| t.trim().to_owned()).collect();
    let lang = Lang::parse(&g.language).unwrap_or(Lang::Pt);
    let credit = build_credit(lang, &ctx.permission, ctx.origin_url.as_deref());
    let violations = check_limits(&f, credit_bytes(credit.as_deref()));
    if !violations.is_empty() {
        return Err(CoreError {
            code: "edit_invalid".into(),
            message: "A edição passa de um limite do YouTube ou tem formato inválido.".into(),
            usage: Some(json!({"violations": violations})),
        });
    }
    if f != before {
        projects::with_writer(|c| {
            c.execute(
                "INSERT INTO packaging_edits(generation_id,fields) VALUES (?1,?2)",
                (g.id, f.to_value().to_string()),
            )?;
            Ok(())
        })?;
    }
    document(&ctx)
}

inventory::submit! { CommandRegistration { name: "packaging.estimate", execute: cmd_estimate } }
inventory::submit! { CommandRegistration { name: "packaging.generate", execute: cmd_generate } }
inventory::submit! { CommandRegistration { name: "packaging.get", execute: cmd_get } }
inventory::submit! { CommandRegistration { name: "packaging.edit", execute: cmd_edit } }

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn tags_count_commas_and_quotes() {
        let tags = vec!["Foo-Baz".to_owned(), "Foo Baz".to_owned()];
        assert_eq!(tags_chars(&tags), 7 + 9 + 1);
    }

    #[test]
    fn hashtags_need_hash_and_no_spaces() {
        assert!(valid_hashtag("#corte"));
        assert!(valid_hashtag("#açaí_2024"));
        assert!(!valid_hashtag("corte"));
        assert!(!valid_hashtag("#duas palavras"));
        assert!(!valid_hashtag("#"));
        assert!(!valid_hashtag("#123"));
    }

    #[test]
    fn language_heuristic_is_conservative() {
        let en = "the video is about how to build a house and what we have learned from it when they were there with all of the people";
        assert!(looks_wrong_language(en, Lang::Pt));
        assert!(!looks_wrong_language(en, Lang::En));
        assert!(!looks_wrong_language("the house is nice", Lang::Pt));
        let mixed = "o vídeo é sobre como a gente fez a casa com o povo e the best part foi quando todos chegaram";
        assert!(!looks_wrong_language(mixed, Lang::Pt));
    }

    #[test]
    fn credit_uses_only_who_and_a_public_link() {
        let p = json!({"status":"granted","who":"Canal X","where":"SECRET-W","scope":"SECRET-S"});
        let c = build_credit(Lang::Pt, &p, Some("https://u:p@x.com/a")).unwrap();
        assert_eq!(c, "Crédito: vídeo original de Canal X.");
        let c = build_credit(Lang::En, &p, Some("https://youtu.be/abc#t=1")).unwrap();
        assert_eq!(
            c,
            "Credit: original video by Canal X.\nSource: https://youtu.be/abc"
        );
        assert!(!c.contains("SECRET"));
        assert_eq!(
            build_credit(Lang::Pt, &json!({"status":"none"}), None),
            None
        );
    }
}
