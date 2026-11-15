//! Avisos de contexto por Perfil de Provedor (#146).
//!
//! `provider.selection_state` diz se o contexto efetivo de um perfil comporta a seleção de
//! Cortes: janela cheia, reduzida ou nenhuma (bloqueada). O resultado vem do planejador de
//! Janelas (#144), rodado sobre uma **Fonte sintética de referência** (fala densa de
//! [`REFERENCE_SOURCE_MINUTES`] min), não sobre uma Fonte real: é uma estimativa do PERFIL,
//! nunca um portão fixo. O estado real de uma Fonte é do #53, na hora de selecionar.
//!
//! Só devolve categorias e números (estado, contexto, origem, rota de instruções). O texto
//! PT/EN fica na UI. Nada aqui faz rede: o contexto vem do cache do #143, a calibração do
//! #140 e o preço do #141, como em [`plan_for_profile`].
//!
//! O diagnóstico (#36, ADR-0006, emenda de 14/11/2026) acrescenta só o contexto efetivo em
//! tokens e a origem categórica da rota da Tarefa `selection`.

use crate::diagnostic::{DiagnosticField, DiagnosticKind};
use crate::selection_windows::{
    plan_for_profile, PlanState, ProfileRequest, DEFAULT_OUTPUT_RESERVE, DEFAULT_OVERLAP_US,
    DEFAULT_REASONING_RESERVE, MIN_WINDOW_FACTOR, WINDOW_MAX_US,
};
use crate::sentences::Sentence;
use crate::{provider, CommandRegistration, CommandResult, EventSink};
use serde_json::{json, Value};

/// Duração da Fonte sintética de referência.
pub const REFERENCE_SOURCE_MINUTES: i64 = 60;
/// Tokens por minuto do formato H em fala densa: pesquisa #115, seção 6.2 (≈ 0,385 mil/min,
/// "valor conservador do regime denso").
pub const DENSE_TOKENS_PER_MINUTE: u64 = 385;
/// Caracteres por token do formato H: pesquisa #115, seção 3.4 (3,3 a 3,8; vale o pior caso).
pub const H_CHARS_PER_TOKEN_TENTHS: u64 = 33;
/// Caracteres por minuto da fala densa no formato H: 385 × 3,3, arredondado para cima.
/// Inclui o marcador `## hh:mm` de cada minuto e o id de cada linha.
pub const DENSE_CHARS_PER_MINUTE: u64 =
    (DENSE_TOKENS_PER_MINUTE * H_CHARS_PER_TOKEN_TENTHS).div_ceil(10);
/// Frases por minuto de referência: Frase de 5 s (a pesquisa mede 600 a 900 por hora).
const SENTENCES_PER_MINUTE: i64 = 12;
/// `## hh:mm\n`.
const HEADER_CHARS: u64 = 9;
/// Premissa da pesquisa #115, seção 6.2: instrução + schema ≈ 1,5 mil tokens. A instrução real
/// é do #53; aqui só se reserva o tamanho (≈ 3,3 caracteres por token).
const REFERENCE_PROMPT_CHARS: usize = 4_950;

const CLI_IDS: [&str; 3] = ["codex", "claude", "opencode"];

/// 60 min de fala densa, 12 Frases por minuto, cada linha `id texto\n` com o tamanho médio que
/// dá [`DENSE_CHARS_PER_MINUTE`] por minuto, marcador de minuto incluído.
fn reference_source() -> Vec<Sentence> {
    let per_sentence = (DENSE_CHARS_PER_MINUTE - HEADER_CHARS) / SENTENCES_PER_MINUTE as u64;
    let filler = "palavra ".repeat(per_sentence as usize / 8 + 2);
    let count = REFERENCE_SOURCE_MINUTES * SENTENCES_PER_MINUTE;
    let step_us = 60_000_000 / SENTENCES_PER_MINUTE;
    (0..count)
        .map(|i| {
            let id = i + 1;
            let overhead = id.to_string().len() as u64 + 2; // "id " e "\n"
            let length = per_sentence.saturating_sub(overhead) as usize;
            Sentence {
                id,
                first_position: i * 10,
                last_position: i * 10 + 9,
                start_us: i * step_us,
                end_us: (i + 1) * step_us,
                language: Some("pt".into()),
                text: filler[..length].trim_end().to_owned(),
            }
        })
        .collect()
}

/// Rota de instruções práticas para aumentar o contexto; a UI escolhe o texto fixo de cada uma.
fn guides(kind: &str, endpoint: &str) -> Vec<&'static str> {
    if kind == "ollama" {
        return vec!["ollama_profile"];
    }
    if kind == "openai" && provider::is_loopback_endpoint(endpoint) {
        return vec!["ollama_server", "lmstudio", "llamacpp"];
    }
    Vec::new()
}

fn state_name(state: PlanState) -> &'static str {
    match state {
        PlanState::Full => "full",
        PlanState::Reduced => "reduced",
        PlanState::Blocked => "blocked",
    }
}

fn selection_state(args: Value, _: &mut EventSink<'_>) -> CommandResult {
    let profile_id = args.get("profileId").and_then(Value::as_str);
    let task = args.get("task").and_then(Value::as_str);
    if let Some(id) = profile_id {
        if CLI_IDS.contains(&id) {
            return Ok(json!({"applicable": false}));
        }
    }
    let context = provider::effective_cached(task, profile_id)?;
    if CLI_IDS.contains(&context.kind.as_str()) {
        return Ok(json!({"applicable": false}));
    }
    let endpoint = provider::profile_infos()?
        .into_iter()
        .find(|p| p.id == context.profile_id)
        .map(|p| p.endpoint)
        .unwrap_or_default();

    let schema = json!({"type": "object"});
    let instruction = "Instrução de referência. ".repeat(REFERENCE_PROMPT_CHARS / 25);
    let frases = reference_source();
    let request = ProfileRequest {
        profile_id: Some(&context.profile_id),
        task: None,
        instruction: &instruction,
        schema: &schema,
        native_schema: false,
        output_reserve: DEFAULT_OUTPUT_RESERVE,
        reasoning_reserve: DEFAULT_REASONING_RESERVE,
        max_cut_us: DEFAULT_OVERLAP_US,
    };
    let (state, windows) = match plan_for_profile(&request, &frases) {
        Ok(plan) => (plan.state, Some(plan.windows)),
        Err(e) if e.code == "context_too_small" => (PlanState::Blocked, None),
        Err(e) => return Err(e),
    };
    let minutes = |us: i64| us as f64 / 60_000_000.0;
    let (first, windows_count) = windows.as_ref().map_or((None, None), |w| {
        (
            // A primeira janela é a que o limite de tokens dimensiona; a última é só o resto.
            w.first()
                .map(|x| minutes(x.end_us - x.start_us).floor() as i64),
            Some(w.len()),
        )
    });
    Ok(json!({
        "applicable": true,
        "profileId": context.profile_id,
        "kind": context.kind,
        "model": context.model,
        "contextTokens": context.value,
        "origin": context.origin,
        "state": state_name(state),
        "reference": {
            "sourceMinutes": REFERENCE_SOURCE_MINUTES,
            "maxWindowMinutes": WINDOW_MAX_US / 60_000_000,
            "minWindowMinutes": DEFAULT_OVERLAP_US * MIN_WINDOW_FACTOR / 60_000_000,
            "firstWindowMinutes": first,
            "windows": windows_count,
        },
        "guides": guides(&context.kind, &endpoint),
    }))
}
inventory::submit! { CommandRegistration { name: "provider.selection_state", execute: selection_state } }

/// Diagnóstico: só números e categorias fechadas, da rota da Tarefa `selection`. CLI, falta de
/// perfil ou qualquer erro viram `indisponível`; nunca o texto do erro.
fn selection_context() -> Option<(u64, &'static str)> {
    let context = provider::effective_cached(Some("selection"), None).ok()?;
    if CLI_IDS.contains(&context.kind.as_str()) {
        return None;
    }
    Some((context.value, context.origin))
}
fn tokens_diagnostic() -> String {
    selection_context().map_or_else(|| "indisponível".into(), |(tokens, _)| tokens.to_string())
}
fn origin_diagnostic() -> String {
    selection_context().map_or_else(|| "indisponível".into(), |(_, origin)| origin.to_owned())
}
inventory::submit! { DiagnosticField { kind: DiagnosticKind::EffectiveContextTokens, value: tokens_diagnostic } }
inventory::submit! { DiagnosticField { kind: DiagnosticKind::EffectiveContextOrigin, value: origin_diagnostic } }
