//! Tradução de legenda PT-BR ↔ EN (#75): passo explícito por Corte como Tarefa de IA.
//!
//! A Transcrição original (`transcript_words` e `sentences`) nunca é alterada. A tradução só
//! roda quando a Permissão da Fonte autoriza explicitamente o escopo "tradução", é planejada
//! em lotes de Frases dimensionados pela janela de contexto do Perfil de Provedor (teto de
//! segurança de [`MAX_BATCH_SENTENCES`] Frases por lote) e fica guardada como faixa traduzida
//! do Corte (`original` vs `translated`, padrão `original`).
//!
//! O modelo só devolve texto por ID de Frase. O núcleo preserva IDs e tempos, dividindo o
//! texto traduzido de cada Frase em palavras com timestamps interpolados proporcionalmente ao
//! número de caracteres dentro de `[start_us, end_us]`.
use crate::{
    ai_task::{self, AiTask, Budget, TaskInput, Violation},
    jobs::{self, Safety},
    packaging::{self, Lang},
    projects, provider, selection_windows,
    sentences::{self, Sentence},
    CommandRegistration, CommandResult, CoreError, EventSink,
};
use rusqlite::{OptionalExtension, Transaction};
use serde_json::{json, Value};
use std::collections::{BTreeMap, BTreeSet, HashMap};
use unicode_normalization::{char::is_combining_mark, UnicodeNormalization};

pub const TASK_ID: &str = "translation";
pub const JOB_KIND: &str = "ai:translation";
pub const MAX_BATCH_SENTENCES: usize = 100;
pub const MAX_SENTENCE_CHARS: usize = 2000;
const OUTPUT_RESERVE_USABLE_PERCENT: u64 = 80;

const PROMPT: &str = include_str!("translation/prompt.md");
const WIRE: &str = include_str!("translation/wire.json");
const FULL: &str = include_str!("translation/full.json");

fn error(code: &str, message: &str) -> CoreError {
    CoreError {
        code: code.into(),
        message: message.into(),
        usage: None,
    }
}

fn v(code: &'static str, path: impl Into<String>, message: &'static str) -> Violation {
    Violation::new(code, path, message)
}

// ---------------------------------------------------------------- Permissão

fn strip_accents_and_lower(s: &str) -> String {
    s.nfd()
        .filter(|c| !is_combining_mark(*c))
        .collect::<String>()
        .to_lowercase()
}

/// A tradução só é liberada quando a Permissão tem `status == "granted"` e `scope` (normalizado:
/// minúsculas, sem acento, separado por vírgula ou espaço) contém `"traducao"` ou `"translation"`.
pub fn has_translation_permission(permission: &Value) -> bool {
    if permission["status"].as_str() != Some("granted") {
        return false;
    }
    let Some(scope) = permission["scope"].as_str() else {
        return false;
    };
    strip_accents_and_lower(scope)
        .split(|c: char| c == ',' || c.is_whitespace())
        .map(|tok| tok.trim_matches(|c: char| !c.is_alphanumeric()))
        .any(|tok| matches!(tok, "traducao" | "translation"))
}

pub fn permission_error(permission: &Value) -> CoreError {
    if permission["status"].as_str() != Some("granted") {
        error(
            "translation_permission_required",
            "Esta Fonte não tem Permissão registrada com escopo “tradução”. Registre a Permissão antes de traduzir.",
        )
    } else {
        error(
            "translation_permission_required",
            "A Permissão desta Fonte não inclui o escopo “tradução”. Atualize a Permissão da Fonte para incluir tradução.",
        )
    }
}

// ---------------------------------------------------------------- Idioma (PT-BR ↔ EN)

fn opposite(lang: Lang) -> Lang {
    match lang {
        Lang::Pt => Lang::En,
        Lang::En => Lang::Pt,
    }
}

fn parse_lang_opt(raw: &Value, key: &str) -> Result<Option<Lang>, CoreError> {
    match raw.get(key) {
        None | Some(Value::Null) => Ok(None),
        Some(Value::String(code)) => Lang::parse(code).map(Some).ok_or_else(|| {
            error(
                "invalid_language",
                "Idioma inválido. Na v1, a tradução suporta apenas PT-BR e EN.",
            )
        }),
        Some(_) => Err(error(
            "invalid_language",
            "Idioma inválido. Na v1, a tradução suporta apenas PT-BR e EN.",
        )),
    }
}

fn resolve_languages(sentences: &[Sentence], args: &Value) -> Result<(Lang, Lang), CoreError> {
    let source_arg = parse_lang_opt(args, "source_language")?;
    let target_arg = parse_lang_opt(args, "target_language")?;
    let detected = packaging::detect_language(sentences);
    match (source_arg, target_arg) {
        (Some(src), Some(dst)) => {
            if src == dst {
                return Err(error(
                    "invalid_language",
                    "Escolha idiomas diferentes entre origem e destino (PT-BR ↔ EN).",
                ));
            }
            Ok((src, dst))
        }
        (None, Some(dst)) => {
            let src = detected.unwrap_or_else(|| opposite(dst));
            if src == dst {
                return Err(error(
                    "invalid_language",
                    "O idioma de destino precisa ser diferente do idioma detectado no Corte.",
                ));
            }
            Ok((src, dst))
        }
        (Some(src), None) => Ok((src, opposite(src))),
        (None, None) => detected.map(|src| (src, opposite(src))).ok_or_else(|| {
            error(
                "language_required",
                "O idioma do Corte não é claro. Escolha o idioma de destino: PT-BR ou EN.",
            )
        }),
    }
}

// ---------------------------------------------------------------- Verificadores determinísticos

fn expected_sentences(input: &TaskInput) -> Vec<(i64, String)> {
    input.context["sentences"]
        .as_array()
        .map_or_else(Vec::new, |arr| {
            arr.iter()
                .filter_map(|item| {
                    Some((
                        item["id"].as_i64()?,
                        item["text"].as_str().unwrap_or("").to_owned(),
                    ))
                })
                .collect()
        })
}

fn output_lines(output: &Value) -> &[Value] {
    output["lines"].as_array().map_or(&[], Vec::as_slice)
}

fn same_ids_and_count(input: &TaskInput, output: &Value) -> Vec<Violation> {
    let expected = expected_sentences(input);
    let lines = output_lines(output);
    let mut violations = Vec::new();
    if lines.len() != expected.len() {
        violations.push(v(
            "line_count_mismatch",
            "/lines",
            "Translated line count differs from input sentences",
        ));
    }
    let expected_ids: BTreeSet<i64> = expected.iter().map(|(id, _)| *id).collect();
    let mut seen = BTreeSet::new();
    for (i, line) in lines.iter().enumerate() {
        let Some(id) = line["id"].as_i64() else {
            violations.push(v(
                "unknown_sentence_id",
                format!("/lines/{i}/id"),
                "Sentence id is missing",
            ));
            continue;
        };
        if !expected_ids.contains(&id) {
            violations.push(v(
                "unknown_sentence_id",
                format!("/lines/{i}/id"),
                "Sentence id is not in the batch",
            ));
        } else if !seen.insert(id) {
            violations.push(v(
                "duplicate_sentence_id",
                format!("/lines/{i}/id"),
                "Sentence id is duplicated",
            ));
        }
    }
    for (id, _) in &expected {
        if !seen.contains(id) {
            violations.push(v(
                "missing_sentence_id",
                "/lines",
                "Expected sentence id is missing from translation",
            ));
        }
    }
    violations
}

fn no_empty_lines(input: &TaskInput, output: &Value) -> Vec<Violation> {
    let expected: HashMap<i64, String> = expected_sentences(input).into_iter().collect();
    let mut violations = Vec::new();
    for (i, line) in output_lines(output).iter().enumerate() {
        let Some(id) = line["id"].as_i64() else {
            continue;
        };
        let Some(orig) = expected.get(&id) else {
            continue;
        };
        if !orig.trim().is_empty() && line["text"].as_str().unwrap_or("").trim().is_empty() {
            violations.push(v(
                "empty_translation",
                format!("/lines/{i}/text"),
                "Translated line is empty",
            ));
        }
    }
    violations
}

fn language_matches(input: &TaskInput, output: &Value) -> Vec<Violation> {
    let Some(want) = input.context["targetLanguage"]
        .as_str()
        .and_then(Lang::parse)
    else {
        return vec![v(
            "language_mismatch",
            "/language",
            "Requested target language is unknown",
        )];
    };
    if output["language"].as_str() != Some(want.code()) {
        return vec![v(
            "language_mismatch",
            "/language",
            "Output language differs from the requested one",
        )];
    }
    let combined = output_lines(output)
        .iter()
        .filter_map(|l| l["text"].as_str())
        .collect::<Vec<_>>()
        .join(" ");
    if packaging::looks_wrong_language(&combined, want) {
        return vec![v(
            "language_mismatch",
            "/lines",
            "Translated text seems to be in another language",
        )];
    }
    Vec::new()
}

fn extract_urls(text: &str) -> Vec<String> {
    text.split_whitespace()
        .filter_map(|tok| {
            let trimmed = tok
                .trim_start_matches(|c: char| matches!(c, '(' | '[' | '<' | '"' | '\'' | '«'))
                .trim_end_matches(|c: char| {
                    matches!(
                        c,
                        '.' | ',' | '!' | '?' | ';' | ':' | ')' | ']' | '>' | '"' | '\'' | '»'
                    )
                });
            let lower = trimmed.to_lowercase();
            if lower.starts_with("http://")
                || lower.starts_with("https://")
                || lower.starts_with("www.")
                || lower.contains("://")
            {
                Some(lower)
            } else {
                None
            }
        })
        .collect()
}

fn extract_numbers(text: &str) -> Vec<String> {
    // URLs are checked separately so digits inside a URL are not duplicated here.
    let without_urls = text
        .split_whitespace()
        .filter(|tok| extract_urls(tok).is_empty())
        .collect::<Vec<_>>()
        .join(" ");
    let bytes = without_urls.as_bytes();
    let mut out = Vec::new();
    let mut i = 0;
    while i < bytes.len() {
        if bytes[i].is_ascii_digit() {
            let start = i;
            i += 1;
            while i < bytes.len() {
                if bytes[i].is_ascii_digit() {
                    i += 1;
                } else if (bytes[i] == b'.' || bytes[i] == b',')
                    && i + 1 < bytes.len()
                    && bytes[i + 1].is_ascii_digit()
                {
                    i += 1;
                } else {
                    break;
                }
            }
            let normalized = without_urls[start..i].replace(',', ".");
            out.push(normalized);
        } else {
            i += 1;
        }
    }
    out
}

fn count_items(items: Vec<String>) -> BTreeMap<String, usize> {
    let mut map = BTreeMap::new();
    for item in items {
        *map.entry(item).or_default() += 1;
    }
    map
}

fn numbers_and_urls_preserved(input: &TaskInput, output: &Value) -> Vec<Violation> {
    let expected: HashMap<i64, String> = expected_sentences(input).into_iter().collect();
    let mut violations = Vec::new();
    for (i, line) in output_lines(output).iter().enumerate() {
        let Some(id) = line["id"].as_i64() else {
            continue;
        };
        let Some(orig) = expected.get(&id) else {
            continue;
        };
        let out_text = line["text"].as_str().unwrap_or("");
        let path = format!("/lines/{i}/text");

        let orig_urls = count_items(extract_urls(orig));
        let out_urls = count_items(extract_urls(out_text));
        for (url, needed) in &orig_urls {
            if out_urls.get(url).copied().unwrap_or(0) < *needed {
                violations.push(v(
                    "url_not_preserved",
                    &path,
                    "Original URL was dropped or altered",
                ));
                break;
            }
        }
        for (url, got) in &out_urls {
            if *got > orig_urls.get(url).copied().unwrap_or(0) {
                violations.push(v(
                    "invented_url",
                    &path,
                    "Translated line contains an invented URL",
                ));
                break;
            }
        }

        let orig_nums = count_items(extract_numbers(orig));
        let out_nums = count_items(extract_numbers(out_text));
        for (num, needed) in &orig_nums {
            if out_nums.get(num).copied().unwrap_or(0) < *needed {
                violations.push(v(
                    "number_not_preserved",
                    &path,
                    "Original number was dropped or altered",
                ));
                break;
            }
        }
    }
    violations
}

fn caption_limits(input: &TaskInput, output: &Value) -> Vec<Violation> {
    let expected: HashMap<i64, String> = expected_sentences(input).into_iter().collect();
    let mut violations = Vec::new();
    for (i, line) in output_lines(output).iter().enumerate() {
        let out_text = line["text"].as_str().unwrap_or("");
        let path = format!("/lines/{i}/text");
        if out_text.chars().any(char::is_control) {
            violations.push(v(
                "control_character",
                &path,
                "Translated line contains a control character",
            ));
        }
        if out_text.contains(['<', '>']) {
            violations.push(v(
                "forbidden_character",
                &path,
                "Translated line contains a forbidden character",
            ));
        }
        let out_chars = out_text.trim().chars().count();
        if out_chars > MAX_SENTENCE_CHARS {
            violations.push(v(
                "translation_too_long",
                &path,
                "Translated line exceeds maximum length",
            ));
        } else if let Some(orig) = line["id"].as_i64().and_then(|id| expected.get(&id)) {
            let orig_chars = orig.trim().chars().count();
            if orig_chars >= 10 && out_chars > orig_chars.saturating_mul(4).saturating_add(40) {
                violations.push(v(
                    "translation_too_long",
                    &path,
                    "Translated line is disproportionately longer than original",
                ));
            } else if orig_chars >= 30 && out_chars < 3 {
                violations.push(v(
                    "translation_too_short",
                    &path,
                    "Translated line is disproportionately shorter than original",
                ));
            }
        }
    }
    violations
}

inventory::submit! {
    AiTask {
        id: TASK_ID,
        version: 1,
        prompt: PROMPT,
        prompt_sha256: "6a1964dcb96897bf51587676535bab2608d26a3440f527c3e5f1a4abfa231e1d",
        wire_schema: WIRE,
        full_schema: FULL,
        verifiers: &[
            same_ids_and_count,
            no_empty_lines,
            language_matches,
            numbers_and_urls_preserved,
            caption_limits,
        ],
        budget: Budget {
            max_calls: 2,
            max_input_tokens: 60_000,
            max_output_tokens: 4_000,
            max_wall_clock_secs: 300,
            max_cost_micro_cents: None,
        },
    }
}

fn task() -> &'static AiTask {
    ai_task::find(TASK_ID).expect("translation task is registered")
}

// ---------------------------------------------------------------- Persistência (migração 0075)

inventory::submit! { projects::Migration { id: "0075_001_translation", sql: "
CREATE TABLE translation_runs (
  id INTEGER PRIMARY KEY,
  clip_id INTEGER NOT NULL REFERENCES clip_edits(id) ON DELETE CASCADE,
  source_language TEXT NOT NULL CHECK(source_language IN ('pt-BR','en')),
  target_language TEXT NOT NULL CHECK(target_language IN ('pt-BR','en')),
  task_version INTEGER NOT NULL,
  prompt_sha256 TEXT NOT NULL,
  profile TEXT NOT NULL DEFAULT '',
  state TEXT NOT NULL CHECK(state IN ('running','completed','partial','failed','cancelled')),
  batch TEXT NOT NULL DEFAULT '',
  batches_total INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE INDEX translation_runs_clip ON translation_runs(clip_id, id);
CREATE TABLE translation_run_jobs (
  run_id INTEGER NOT NULL REFERENCES translation_runs(id) ON DELETE CASCADE,
  job_id INTEGER NOT NULL UNIQUE REFERENCES jobs(id) ON DELETE CASCADE,
  batch_index INTEGER NOT NULL,
  first_sentence_id INTEGER NOT NULL,
  last_sentence_id INTEGER NOT NULL,
  sentence_ids TEXT NOT NULL,
  PRIMARY KEY(run_id, batch_index)
);
CREATE TABLE clip_caption_tracks (
  clip_id INTEGER PRIMARY KEY REFERENCES clip_edits(id) ON DELETE CASCADE,
  active_track TEXT NOT NULL DEFAULT 'original' CHECK(active_track IN ('original','translated')),
  target_language TEXT CHECK(target_language IN ('pt-BR','en'))
);
CREATE TABLE clip_translated_sentences (
  clip_id INTEGER NOT NULL REFERENCES clip_edits(id) ON DELETE CASCADE,
  language TEXT NOT NULL CHECK(language IN ('pt-BR','en')),
  sentence_id INTEGER NOT NULL,
  translated_text TEXT NOT NULL,
  generated_text TEXT NOT NULL,
  edited INTEGER NOT NULL DEFAULT 0 CHECK(edited IN (0,1)),
  run_id INTEGER REFERENCES translation_runs(id) ON DELETE SET NULL,
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  PRIMARY KEY(clip_id, language, sentence_id)
);
" } }

// ---------------------------------------------------------------- Contexto do Corte e lotes

struct ClipContext {
    clip_id: i64,
    source_id: i64,
    transcript_id: i64,
    permission: Value,
    sentences: Vec<Sentence>,
}

fn clip_id_arg(v: &Value) -> Result<i64, CoreError> {
    v["clip_id"]
        .as_i64()
        .filter(|id| *id > 0)
        .ok_or_else(|| error("invalid_clip", "Corte inválido ou incompatível."))
}

fn load_clip_sentences(
    transcript_id: i64,
    start_id: i64,
    end_id: i64,
) -> Result<Vec<Sentence>, CoreError> {
    sentences::segment_transcript(transcript_id)?;
    let all = sentences::load_for(transcript_id)?;
    let from = all.partition_point(|s| s.id < start_id);
    let to = all.partition_point(|s| s.id <= end_id);
    Ok(all[from..to].to_vec())
}

fn clip_context(clip_id: i64) -> Result<ClipContext, CoreError> {
    let doc = crate::editor::edits::document(clip_id)?;
    let source_id = doc.original.source_id;
    let transcript_id = sentences::source_transcript(&json!({"source_id": source_id}))?;
    let permission: String = projects::with_reader(|c| {
        c.query_row(
            "SELECT permission FROM sources WHERE id=?1",
            [source_id],
            |r| r.get(0),
        )
    })
    .map_err(|_| error("source_missing", "Fonte não encontrada"))?;
    let sentences = load_clip_sentences(transcript_id, doc.range.start_id, doc.range.end_id)?;
    if sentences.is_empty() {
        return Err(error(
            "no_sentences",
            "O Corte não tem Frases para traduzir.",
        ));
    }
    Ok(ClipContext {
        clip_id,
        source_id,
        transcript_id,
        permission: serde_json::from_str(&permission).unwrap_or(Value::Null),
        sentences,
    })
}

fn route_safety() -> Result<(String, Safety), CoreError> {
    Ok(match provider::routed(Some(TASK_ID), None)? {
        provider::Routed::Cli(name) => (name, Safety::Paid),
        provider::Routed::Api { profile, local } => {
            (profile.id, if local { Safety::Local } else { Safety::Paid })
        }
    })
}

fn percent(value: u64, pct: u64) -> u64 {
    (u128::from(value) * u128::from(pct) / 100) as u64
}

fn escaped_chars(text: &str) -> u64 {
    serde_json::to_string(text).map_or(text.chars().count() as u64, |json| {
        json.chars().count() as u64 - 2
    })
}

fn header_line(source_lang: Lang, target_lang: Lang) -> String {
    format!(
        "#TRADUCAO origem={} destino={}\n",
        source_lang.code(),
        target_lang.code()
    )
}

fn build_input(batch: &[Sentence], source_lang: Lang, target_lang: Lang) -> TaskInput {
    let compact = sentences::compact_with_hint(batch);
    let context_sentences: Vec<Value> = batch
        .iter()
        .map(|s| json!({"id": s.id, "text": s.text}))
        .collect();
    TaskInput {
        transcript: format!("{}{}", header_line(source_lang, target_lang), compact.text),
        estimate_hint: compact.hint,
        context: json!({
            "sourceLanguage": source_lang.code(),
            "targetLanguage": target_lang.code(),
            "sentences": context_sentences,
        }),
        native_schema: false,
    }
}

struct PlannedBatch {
    first_id: i64,
    last_id: i64,
    sentence_ids: Vec<i64>,
    input: TaskInput,
}

fn plan_batches(
    frases: &[Sentence],
    source_lang: Lang,
    target_lang: Lang,
) -> Result<(Vec<PlannedBatch>, u64), CoreError> {
    let definition = task();
    let (wire, _) = ai_task::check_definition(definition).map_err(CoreError::from)?;
    let instruction = ai_task::normalized_prompt(definition.prompt);
    let profile = provider::effective_cached(Some(TASK_ID), None)?;
    let output_reserve =
        provider::output_reserve(Some(TASK_ID), None, definition.budget.max_output_tokens)?;
    let compact = sentences::compact_with_hint(frases);
    let fixed_header = header_line(source_lang, target_lang);
    let structured = |transcript: String| provider::StructuredRequest {
        estimate_hint: compact.hint.clone(),
        instruction: instruction.clone(),
        transcript,
        schema: wire.clone(),
        native_schema: false,
        max_output_tokens: None,
    };
    let full_req = structured(format!("{fixed_header}{}", compact.text));
    let full_chars = provider::cost::input_characters(&full_req).max(1);
    let range = provider::cost::planning_range(&profile.profile_id, &profile.model, &full_req)?;
    let ratio_high = (range.high as f64 / full_chars as f64).max(f64::MIN_POSITIVE);
    let fixed_tokens = provider::cost::planning_fixed_tokens(
        &profile.profile_id,
        &profile.model,
        &structured(fixed_header),
    )?;
    let price_threshold = provider::cost::price_for(&profile.kind, &profile.model)?
        .and_then(|(price, _)| price.tiers.iter().map(|t| t.above_input_tokens).min());

    let mut input_limit = percent(profile.value, selection_windows::CONTEXT_USABLE_PERCENT)
        .saturating_sub(output_reserve);
    if let Some(threshold) = price_threshold {
        input_limit = input_limit.min(percent(
            threshold,
            selection_windows::PRICE_THRESHOLD_PERCENT,
        ));
    }
    input_limit = input_limit.min(definition.budget.max_input_tokens);
    let input_budget = input_limit.saturating_sub(fixed_tokens);
    let output_budget = percent(output_reserve, OUTPUT_RESERVE_USABLE_PERCENT);

    let minute_header_chars = escaped_chars(&sentences::compact(&[Sentence {
        id: 0,
        first_position: 0,
        last_position: 0,
        start_us: 0,
        end_us: 0,
        language: None,
        text: String::new(),
    }]))
    .saturating_sub(escaped_chars("0 \n"));

    let n = frases.len();
    let empty_marks = crate::energy::EnergyMarks::new();
    let mut line_chars = Vec::with_capacity(n + 1);
    let mut head_counts = Vec::with_capacity(n + 1);
    let mut line_sum = 0u64;
    let mut head_sum = 0u64;
    line_chars.push(0);
    head_counts.push(0);
    let minute_of = |s: &Sentence| s.start_us.max(0) / 60_000_000;
    for (i, s) in frases.iter().enumerate() {
        line_sum = line_sum.saturating_add(escaped_chars(&sentences::line(s, &empty_marks)));
        head_sum += u64::from(i == 0 || minute_of(s) != minute_of(&frases[i - 1]));
        line_chars.push(line_sum);
        head_counts.push(head_sum);
    }
    let starts_header = |i: usize| i == 0 || minute_of(&frases[i]) != minute_of(&frases[i - 1]);
    let chars_of = |s: usize, e: usize| {
        let markers = head_counts[e + 1] - head_counts[s] + u64::from(!starts_header(s));
        (line_chars[e + 1] - line_chars[s])
            .saturating_add(markers.saturating_mul(minute_header_chars))
    };
    let in_tokens_of = |s: usize, e: usize| (chars_of(s, e) as f64 * ratio_high).ceil() as u64;
    let out_tokens_of = |s: usize, e: usize| {
        let raw_chars = line_chars[e + 1] - line_chars[s];
        let json_overhead = ((e - s + 1) as u64).saturating_mul(24) + 40;
        let est_chars = ((raw_chars as f64) * 1.5).ceil() as u64 + json_overhead;
        (est_chars as f64 * ratio_high).ceil() as u64
    };

    let mut batches = Vec::new();
    let mut start = 0;
    while start < n {
        if in_tokens_of(start, start) > input_budget {
            return Err(error(
                "context_too_small",
                &format!(
                    "Contexto efetivo de {} tokens insuficiente para traduzir a Frase {}. Aumente o contexto no Perfil de Provedor ou escolha outro perfil.",
                    profile.value, frases[start].id
                ),
            ));
        }
        let max_end = (start + MAX_BATCH_SENTENCES - 1).min(n - 1);
        let mut end = start;
        while end < max_end {
            let next = end + 1;
            if in_tokens_of(start, next) > input_budget
                || out_tokens_of(start, next) > output_budget
            {
                break;
            }
            end = next;
        }
        let slice = &frases[start..=end];
        batches.push(PlannedBatch {
            first_id: slice[0].id,
            last_id: slice[slice.len() - 1].id,
            sentence_ids: slice.iter().map(|s| s.id).collect(),
            input: build_input(slice, source_lang, target_lang),
        });
        start = end + 1;
    }
    Ok((batches, profile.value))
}

// ---------------------------------------------------------------- Materialização e fila

fn settle_run_state(tx: &Transaction<'_>, run_id: i64) -> rusqlite::Result<()> {
    let mut q = tx.prepare(
        "SELECT j.state FROM translation_run_jobs rj JOIN jobs j ON j.id=rj.job_id WHERE rj.run_id=?1",
    )?;
    let states: Vec<String> = q
        .query_map([run_id], |r| r.get(0))?
        .collect::<rusqlite::Result<_>>()?;
    if states.is_empty() {
        return Ok(());
    }
    let active = states
        .iter()
        .any(|s| matches!(s.as_str(), "queued" | "running"));
    if active {
        tx.execute(
            "UPDATE translation_runs SET state='running' WHERE id=?1",
            [run_id],
        )?;
        return Ok(());
    }
    let completed = states.iter().filter(|s| *s == "completed").count();
    let cancelled = states.iter().filter(|s| *s == "cancelled").count();
    let next = if completed == states.len() {
        "completed"
    } else if completed > 0 {
        "partial"
    } else if cancelled == states.len() {
        "cancelled"
    } else {
        "failed"
    };
    tx.execute(
        "UPDATE translation_runs SET state=?2 WHERE id=?1",
        (run_id, next),
    )?;
    Ok(())
}

fn materialize_run(run_id: i64) -> Result<(), CoreError> {
    projects::with_writer(|c| {
        let tx = c.transaction()?;
        let (clip_id, target_language): (i64, String) = tx.query_row(
            "SELECT clip_id, target_language FROM translation_runs WHERE id=?1",
            [run_id],
            |r| Ok((r.get(0)?, r.get(1)?)),
        )?;
        let mut q = tx.prepare(
            "SELECT j.result FROM translation_run_jobs rj JOIN jobs j ON j.id=rj.job_id WHERE rj.run_id=?1 AND j.state='completed'",
        )?;
        let results: Vec<Option<String>> = q
            .query_map([run_id], |r| r.get(0))?
            .collect::<rusqlite::Result<_>>()?;
        drop(q);
        for raw in results.into_iter().flatten() {
            let Ok(parsed) = serde_json::from_str::<Value>(&raw) else {
                continue;
            };
            let Some(lines) = parsed["data"]["lines"].as_array() else {
                continue;
            };
            for line in lines {
                let (Some(id), Some(text)) = (line["id"].as_i64(), line["text"].as_str()) else {
                    continue;
                };
                let normalized: String = text.nfc().collect::<String>().trim().to_owned();
                tx.execute(
                    "INSERT INTO clip_translated_sentences(clip_id,language,sentence_id,translated_text,generated_text,edited,run_id)
                     VALUES (?1,?2,?3,?4,?4,0,?5)
                     ON CONFLICT(clip_id,language,sentence_id) DO UPDATE SET
                       translated_text=excluded.translated_text,
                       generated_text=excluded.generated_text,
                       edited=0,
                       run_id=excluded.run_id,
                       updated_at=strftime('%Y-%m-%dT%H:%M:%fZ','now')
                     WHERE COALESCE(clip_translated_sentences.run_id, 0) <= excluded.run_id",
                    (clip_id, &target_language, id, &normalized, run_id),
                )?;
            }
        }
        settle_run_state(&tx, run_id)?;
        tx.commit()?;
        Ok(())
    })
}

fn materialize_clip(clip_id: i64) -> Result<(), CoreError> {
    let run_ids: Vec<i64> = projects::with_reader(|c| {
        let mut q = c.prepare(
            "SELECT id FROM translation_runs WHERE clip_id=?1 AND state='running' ORDER BY id",
        )?;
        let rows = q
            .query_map([clip_id], |r| r.get(0))?
            .collect::<rusqlite::Result<_>>()?;
        Ok(rows)
    })?;
    for run_id in run_ids {
        materialize_run(run_id)?;
    }
    Ok(())
}

/// Chamado pela fila quando um job `ai:translation` termina.
pub(crate) fn on_job_settled(job_id: i64) {
    let run_id: Option<i64> = projects::with_reader(|c| {
        c.query_row(
            "SELECT run_id FROM translation_run_jobs WHERE job_id=?1",
            [job_id],
            |r| r.get(0),
        )
        .optional()
    })
    .ok()
    .flatten();
    if let Some(run_id) = run_id {
        let _ = materialize_run(run_id);
    }
}

// ---------------------------------------------------------------- Interpolação de palavras para legenda/export

#[derive(Clone, Debug, PartialEq, Eq)]
pub(crate) struct InterpolatedWord {
    pub text: String,
    pub start_us: i64,
    pub end_us: i64,
}

fn offset_to_time(intervals: &[(i64, i64)], offset: i64) -> i64 {
    let mut remaining = offset.max(0);
    for &(start, end) in intervals {
        let len = (end - start).max(0);
        if remaining <= len {
            return start + remaining;
        }
        remaining -= len;
    }
    intervals.last().map_or(0, |&(_, end)| end)
}

/// Divide o texto traduzido de uma Frase em palavras e interpola os tempos proporcionalmente
/// ao número de caracteres dentro dos intervalos mantidos da Frase.
pub(crate) fn interpolate_words_in_intervals(
    text: &str,
    intervals: &[(i64, i64)],
) -> Vec<InterpolatedWord> {
    let tokens: Vec<&str> = text.split_whitespace().collect();
    if tokens.is_empty() || intervals.is_empty() {
        return Vec::new();
    }
    let total_dur: i64 = intervals.iter().map(|&(a, b)| (b - a).max(0)).sum();
    if total_dur <= 0 {
        let t = intervals[0].0;
        return tokens
            .into_iter()
            .map(|w| InterpolatedWord {
                text: w.to_owned(),
                start_us: t,
                end_us: t,
            })
            .collect();
    }
    let weights: Vec<i128> = tokens
        .iter()
        .map(|w| w.chars().count().max(1) as i128)
        .collect();
    let total_chars: i128 = weights.iter().sum();
    let count = tokens.len();
    let mut out = Vec::with_capacity(count);
    let mut cum: i128 = 0;
    for (i, (tok, weight)) in tokens.into_iter().zip(weights).enumerate() {
        let off_start = ((i128::from(total_dur) * cum) / total_chars) as i64;
        cum += weight;
        let off_end = if i + 1 == count {
            total_dur
        } else {
            ((i128::from(total_dur) * cum) / total_chars) as i64
        };
        let start_us = offset_to_time(intervals, off_start);
        let mut end_us = offset_to_time(intervals, off_end);
        if end_us <= start_us && off_start < total_dur {
            end_us = offset_to_time(intervals, (off_start + 1).min(total_dur));
        }
        out.push(InterpolatedWord {
            text: tok.to_owned(),
            start_us,
            end_us,
        });
    }
    out
}

/// Retorna o idioma traduzido ativo para o Corte (`None` quando a faixa escolhida é `original`).
pub(crate) fn active_translated_language(clip_id: i64) -> Result<Option<String>, CoreError> {
    materialize_clip(clip_id)?;
    projects::with_reader(|c| {
        let row: Option<(String, Option<String>)> = c
            .query_row(
                "SELECT active_track, target_language FROM clip_caption_tracks WHERE clip_id=?1",
                [clip_id],
                |r| Ok((r.get(0)?, r.get(1)?)),
            )
            .optional()?;
        match row {
            Some((track, Some(lang))) if track == "translated" => Ok(Some(lang)),
            _ => Ok(None),
        }
    })
}

/// Mapa `sentence_id -> translated_text` para o Corte e idioma informados.
pub(crate) fn translated_map(
    clip_id: i64,
    language: &str,
) -> Result<HashMap<i64, String>, CoreError> {
    projects::with_reader(|c| {
        let mut q = c.prepare(
            "SELECT sentence_id, translated_text FROM clip_translated_sentences WHERE clip_id=?1 AND language=?2",
        )?;
        let rows = q
            .query_map((clip_id, language), |r| {
                Ok((r.get::<_, i64>(0)?, r.get::<_, String>(1)?))
            })?
            .collect::<rusqlite::Result<HashMap<_, _>>>()?;
        Ok(rows)
    })
}

// ---------------------------------------------------------------- Documento e comandos

fn active_track_and_language(clip_id: i64) -> Result<(String, Option<String>), CoreError> {
    projects::with_reader(|c| {
        let row: Option<(String, Option<String>)> = c
            .query_row(
                "SELECT active_track, target_language FROM clip_caption_tracks WHERE clip_id=?1",
                [clip_id],
                |r| Ok((r.get(0)?, r.get(1)?)),
            )
            .optional()?;
        if let Some((track, lang)) = row {
            let lang = match lang {
                Some(l) => Some(l),
                None => c
                    .query_row(
                        "SELECT language FROM clip_translated_sentences WHERE clip_id=?1 ORDER BY updated_at DESC LIMIT 1",
                        [clip_id],
                        |r| r.get(0),
                    )
                    .optional()?,
            };
            Ok((track, lang))
        } else {
            let lang: Option<String> = c
                .query_row(
                    "SELECT language FROM clip_translated_sentences WHERE clip_id=?1 ORDER BY updated_at DESC LIMIT 1",
                    [clip_id],
                    |r| r.get(0),
                )
                .optional()?;
            Ok(("original".into(), lang))
        }
    })
}

fn document(ctx: &ClipContext) -> Result<Value, CoreError> {
    materialize_clip(ctx.clip_id)?;
    let permitted = has_translation_permission(&ctx.permission);
    let permission_error = if permitted {
        Value::Null
    } else {
        let err = permission_error(&ctx.permission);
        json!({"code": err.code, "message": err.message})
    };
    let detected = packaging::detect_language(&ctx.sentences);
    let default_target = detected.map(|l| opposite(l).code());
    let (active_track, mut target_language) = active_track_and_language(ctx.clip_id)?;

    let run = projects::with_reader(|c| {
        let row: Option<(i64, String, String, String, i64, String, String, i64, String)> = c
            .query_row(
                "SELECT id,state,source_language,target_language,task_version,prompt_sha256,profile,batches_total,created_at FROM translation_runs WHERE clip_id=?1 ORDER BY id DESC LIMIT 1",
                [ctx.clip_id],
                |r| {
                    Ok((
                        r.get(0)?,
                        r.get(1)?,
                        r.get(2)?,
                        r.get(3)?,
                        r.get(4)?,
                        r.get(5)?,
                        r.get(6)?,
                        r.get(7)?,
                        r.get(8)?,
                    ))
                },
            )
            .optional()?;
        let Some((id, state, src, dst, ver, sha, prof, total, created)) = row else {
            return Ok(None);
        };
        let mut q = c.prepare(
            "SELECT rj.job_id,rj.batch_index,j.state,j.result FROM translation_run_jobs rj JOIN jobs j ON j.id=rj.job_id WHERE rj.run_id=?1 ORDER BY rj.batch_index",
        )?;
        let jobs = q
            .query_map([id], |r| {
                let result: Option<String> = r.get(3)?;
                let parsed = result.and_then(|s| serde_json::from_str::<Value>(&s).ok());
                Ok(json!({
                    "id": r.get::<_, i64>(0)?,
                    "batchIndex": r.get::<_, i64>(1)?,
                    "state": r.get::<_, String>(2)?,
                    "code": crate::packaging::job_code(&parsed),
                    "violations": crate::packaging::violation_codes(&parsed),
                }))
            })?
            .collect::<rusqlite::Result<Vec<_>>>()?;
        let completed = jobs.iter().filter(|j| j["state"] == "completed").count();
        let failed = jobs
            .iter()
            .filter(|j| {
                matches!(
                    j["state"].as_str(),
                    Some("failed" | "uncertain" | "cancelled")
                )
            })
            .count();
        Ok(Some(json!({
            "id": id,
            "state": state,
            "sourceLanguage": src,
            "targetLanguage": dst,
            "taskVersion": ver,
            "promptSha256": sha,
            "profile": prof,
            "batchesTotal": total,
            "batchesCompleted": completed,
            "batchesFailed": failed,
            "createdAt": created,
            "jobs": jobs,
        })))
    })?;

    if target_language.is_none() {
        target_language = run
            .as_ref()
            .and_then(|r| r["targetLanguage"].as_str().map(str::to_owned));
    }

    let stored: HashMap<i64, (String, bool)> = if let Some(ref lang) = target_language {
        projects::with_reader(|c| {
            let mut q = c.prepare(
                "SELECT sentence_id, translated_text, edited FROM clip_translated_sentences WHERE clip_id=?1 AND language=?2",
            )?;
            let rows = q
                .query_map((ctx.clip_id, lang), |r| {
                    Ok((
                        r.get::<_, i64>(0)?,
                        (r.get::<_, String>(1)?, r.get::<_, i64>(2)? != 0),
                    ))
                })?
                .collect::<rusqlite::Result<HashMap<_, _>>>()?;
            Ok(rows)
        })?
    } else {
        HashMap::new()
    };

    let has_translation = ctx.sentences.iter().any(|s| stored.contains_key(&s.id));
    let mut missing_ids = Vec::new();
    let sentences_json: Vec<Value> = ctx
        .sentences
        .iter()
        .map(|s| {
            let entry = stored.get(&s.id);
            if has_translation && entry.is_none() {
                missing_ids.push(s.id);
            }
            json!({
                "id": s.id,
                "startUs": s.start_us,
                "endUs": s.end_us,
                "originalText": s.text,
                "translatedText": entry.map(|(t, _)| t.as_str()),
                "edited": entry.is_some_and(|(_, e)| *e),
            })
        })
        .collect();

    Ok(json!({
        "schemaVersion": 1,
        "clipId": ctx.clip_id,
        "sourceId": ctx.source_id,
        "transcriptId": ctx.transcript_id,
        "permitted": permitted,
        "permissionError": permission_error,
        "detectedLanguage": detected.map(Lang::code),
        "languageRequired": detected.is_none(),
        "defaultTargetLanguage": default_target,
        "activeTrack": active_track,
        "targetLanguage": target_language,
        "hasTranslation": has_translation,
        "missingSentenceIds": missing_ids,
        "sentences": sentences_json,
        "run": run,
    }))
}

fn cmd_get(v: Value, _: &mut EventSink<'_>) -> CommandResult {
    let _guard = projects::start_job()?;
    let ctx = clip_context(clip_id_arg(&v)?)?;
    document(&ctx)
}

fn estimate_batches(batches: &[PlannedBatch], safety: Safety) -> Value {
    let inputs: Vec<TaskInput> = batches.iter().map(|b| b.input.clone()).collect();
    jobs::redo::estimate_inputs(TASK_ID, &inputs, safety, None)
}

fn cmd_estimate(v: Value, _: &mut EventSink<'_>) -> CommandResult {
    let _guard = projects::start_job()?;
    let ctx = clip_context(clip_id_arg(&v)?)?;
    if !has_translation_permission(&ctx.permission) {
        return Err(permission_error(&ctx.permission));
    }
    let (source_lang, target_lang) = resolve_languages(&ctx.sentences, &v)?;
    let (profile, safety) = route_safety()?;
    let (batches, context_tokens) = plan_batches(&ctx.sentences, source_lang, target_lang)?;
    let estimate = estimate_batches(&batches, safety);
    Ok(json!({
        "paid": matches!(safety, Safety::Paid),
        "profile": profile,
        "sourceLanguage": source_lang.code(),
        "targetLanguage": target_lang.code(),
        "batches": batches.len(),
        "sentenceCount": ctx.sentences.len(),
        "contextTokens": context_tokens,
        "estimate": estimate,
    }))
}

fn cmd_start(v: Value, _: &mut EventSink<'_>) -> CommandResult {
    let _guard = projects::start_job()?;
    let ctx = clip_context(clip_id_arg(&v)?)?;
    if !has_translation_permission(&ctx.permission) {
        return Err(permission_error(&ctx.permission));
    }
    let (source_lang, target_lang) = resolve_languages(&ctx.sentences, &v)?;
    let busy: i64 = projects::with_reader(|c| {
        c.query_row(
            "SELECT COUNT(*) FROM translation_run_jobs rj JOIN translation_runs r ON r.id=rj.run_id JOIN jobs j ON j.id=rj.job_id WHERE r.clip_id=?1 AND j.state IN ('queued','running')",
            [ctx.clip_id],
            |r| r.get(0),
        )
    })?;
    if busy > 0 {
        return Err(error(
            "translation_in_progress",
            "Já há uma tradução em andamento para este Corte.",
        ));
    }
    let (profile, safety) = route_safety()?;
    let (batches, _) = plan_batches(&ctx.sentences, source_lang, target_lang)?;
    if matches!(safety, Safety::Paid) && v["confirmed"] != true {
        return Err(CoreError {
            code: "confirmation_required".into(),
            message:
                "Esta tradução usa um Provedor pago: confirme o custo estimado antes de começar."
                    .into(),
            usage: Some(json!({"estimate": estimate_batches(&batches, safety)})),
        });
    }
    let definition = task();
    let run_id = projects::with_writer(|c| {
        c.execute(
            "INSERT INTO translation_runs(clip_id,source_language,target_language,task_version,prompt_sha256,profile,state,batches_total) VALUES (?1,?2,?3,?4,?5,?6,'running',?7)",
            (
                ctx.clip_id,
                source_lang.code(),
                target_lang.code(),
                definition.version,
                definition.prompt_sha256,
                &profile,
                batches.len() as i64,
            ),
        )?;
        let run_id = c.last_insert_rowid();
        let batch_label = format!("translation-{run_id}");
        c.execute(
            "UPDATE translation_runs SET batch=?2 WHERE id=?1",
            (run_id, &batch_label),
        )?;
        Ok(run_id)
    })?;
    let batch_label = format!("translation-{run_id}");
    let mut job_ids = Vec::with_capacity(batches.len());
    for (idx, b) in batches.iter().enumerate() {
        let job_id = jobs::enqueue_ai_in_batch(TASK_ID, &b.input, safety, Some(&batch_label))?;
        let ids_json = serde_json::to_string(&b.sentence_ids).unwrap_or_else(|_| "[]".into());
        projects::with_writer(|c| {
            c.execute(
                "INSERT INTO translation_run_jobs(run_id,job_id,batch_index,first_sentence_id,last_sentence_id,sentence_ids) VALUES (?1,?2,?3,?4,?5,?6)",
                (run_id, job_id, idx as i64, b.first_id, b.last_id, ids_json),
            )?;
            Ok(())
        })?;
        job_ids.push(job_id);
    }
    projects::with_writer(|c| {
        c.execute(
            "INSERT INTO clip_caption_tracks(clip_id,active_track,target_language) VALUES (?1,'original',?2)
             ON CONFLICT(clip_id) DO UPDATE SET target_language=excluded.target_language",
            (ctx.clip_id, target_lang.code()),
        )?;
        Ok(())
    })?;
    Ok(json!({
        "run": run_id,
        "jobs": job_ids,
        "batches": batches.len(),
        "sourceLanguage": source_lang.code(),
        "targetLanguage": target_lang.code(),
    }))
}

fn cmd_track_set(v: Value, _: &mut EventSink<'_>) -> CommandResult {
    let _guard = projects::start_job()?;
    let ctx = clip_context(clip_id_arg(&v)?)?;
    materialize_clip(ctx.clip_id)?;
    let track = match v["track"].as_str() {
        Some(t @ ("original" | "translated")) => t,
        _ => {
            return Err(error(
                "invalid_track",
                "Escolha a faixa da legenda: original ou traduzida.",
            ))
        }
    };
    let explicit_lang = parse_lang_opt(&v, "target_language")?;
    let (_, current_lang) = active_track_and_language(ctx.clip_id)?;
    let lang = explicit_lang.map(|l| l.code().to_owned()).or(current_lang);
    if track == "translated" {
        let Some(ref lang_code) = lang else {
            return Err(error(
                "translation_missing",
                "Gere uma legenda traduzida antes de selecioná-la.",
            ));
        };
        let count: i64 = projects::with_reader(|c| {
            c.query_row(
                "SELECT COUNT(*) FROM clip_translated_sentences WHERE clip_id=?1 AND language=?2",
                (ctx.clip_id, lang_code),
                |r| r.get(0),
            )
        })?;
        if count == 0 {
            return Err(error(
                "translation_missing",
                "Gere uma legenda traduzida antes de selecioná-la.",
            ));
        }
    }
    projects::with_writer(|c| {
        c.execute(
            "INSERT INTO clip_caption_tracks(clip_id,active_track,target_language) VALUES (?1,?2,?3)
             ON CONFLICT(clip_id) DO UPDATE SET active_track=excluded.active_track, target_language=COALESCE(excluded.target_language, clip_caption_tracks.target_language)",
            (ctx.clip_id, track, lang.as_deref()),
        )?;
        Ok(())
    })?;
    document(&ctx)
}

fn normalize_edited_text(raw: &str) -> Result<String, CoreError> {
    let text: String = raw.nfc().collect::<String>().trim().to_owned();
    if text.is_empty() {
        return Err(error(
            "translation_empty",
            "O texto da legenda traduzida não pode ficar vazio.",
        ));
    }
    if text.chars().any(char::is_control) || text.contains(['<', '>']) {
        return Err(error(
            "invalid_translation_edit",
            "O texto contém caracteres não permitidos na legenda.",
        ));
    }
    if text.chars().count() > MAX_SENTENCE_CHARS {
        return Err(error(
            "translation_too_long",
            "O texto traduzido passa do limite de caracteres da legenda.",
        ));
    }
    Ok(text)
}

fn cmd_edit(v: Value, _: &mut EventSink<'_>) -> CommandResult {
    let _guard = projects::start_job()?;
    let ctx = clip_context(clip_id_arg(&v)?)?;
    materialize_clip(ctx.clip_id)?;
    let sentence_id = v["sentence_id"]
        .as_i64()
        .filter(|id| *id > 0)
        .ok_or_else(|| error("unknown_sentence_id", "Frase desconhecida."))?;
    let raw_text = v["text"].as_str().ok_or_else(|| {
        error(
            "invalid_translation_edit",
            "Informe o novo texto da legenda traduzida.",
        )
    })?;
    let text = normalize_edited_text(raw_text)?;
    let explicit_lang = parse_lang_opt(&v, "language")?;
    let (_, current_lang) = active_track_and_language(ctx.clip_id)?;
    let lang = explicit_lang
        .map(|l| l.code().to_owned())
        .or(current_lang)
        .ok_or_else(|| {
            error(
                "translation_missing",
                "Gere uma legenda traduzida antes de editar.",
            )
        })?;
    let updated = projects::with_writer(|c| {
        c.execute(
            "UPDATE clip_translated_sentences SET translated_text=?4, edited=1, updated_at=strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE clip_id=?1 AND language=?2 AND sentence_id=?3",
            (ctx.clip_id, &lang, sentence_id, &text),
        )
    })?;
    if updated == 0 {
        return Err(error(
            "translation_missing",
            "Frase traduzida não encontrada neste Corte.",
        ));
    }
    document(&ctx)
}

inventory::submit! { CommandRegistration { name: "translation.get", execute: cmd_get } }
inventory::submit! { CommandRegistration { name: "translation.estimate", execute: cmd_estimate } }
inventory::submit! { CommandRegistration { name: "translation.start", execute: cmd_start } }
inventory::submit! { CommandRegistration { name: "translation.track.set", execute: cmd_track_set } }
inventory::submit! { CommandRegistration { name: "translation.edit", execute: cmd_edit } }

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn permission_check_covers_none_missing_scope_and_granted() {
        assert!(!has_translation_permission(&json!({"status": "none"})));
        assert!(!has_translation_permission(&json!({
            "status": "granted",
            "who": "Creator",
            "where": "Email",
            "scope": "cortes diretos"
        })));
        assert!(has_translation_permission(&json!({
            "status": "granted",
            "who": "Creator",
            "where": "Email",
            "scope": "cortes, Tradução"
        })));
        assert!(has_translation_permission(&json!({
            "status": "granted",
            "who": "Creator",
            "where": "Email",
            "scope": "clips and translation"
        })));
        assert!(has_translation_permission(&json!({
            "status": "granted",
            "who": "Creator",
            "where": "Email",
            "scope": "traducao"
        })));
    }

    #[test]
    fn interpolation_splits_proportionally_by_characters() {
        let words = interpolate_words_in_intervals("Hi there!", &[(1_000_000, 4_000_000)]);
        assert_eq!(words.len(), 2);
        // "Hi" (2 chars) vs "there!" (6 chars) => total 8 chars => 2/8 of 3s = 750ms, 6/8 = 2250ms.
        assert_eq!(words[0].text, "Hi");
        assert_eq!(words[0].start_us, 1_000_000);
        assert_eq!(words[0].end_us, 1_750_000);
        assert_eq!(words[1].text, "there!");
        assert_eq!(words[1].start_us, 1_750_000);
        assert_eq!(words[1].end_us, 4_000_000);
    }

    #[test]
    fn interpolation_respects_kept_intervals_when_silences_are_removed() {
        // Sentence [0, 10s], silence [4s, 6s] removed -> kept: [0, 4s] and [6s, 10s] (8s total).
        let words =
            interpolate_words_in_intervals("abcd efgh", &[(0, 4_000_000), (6_000_000, 10_000_000)]);
        assert_eq!(words.len(), 2);
        assert_eq!(words[0].start_us, 0);
        assert_eq!(words[0].end_us, 4_000_000);
        assert_eq!(words[1].start_us, 4_000_000);
        assert_eq!(words[1].end_us, 10_000_000);
    }
}
