//! Planejador de Janelas de seleção (#144).
//!
//! Uma Janela de seleção é o trecho da Transcrição que uma chamada de IA analisa na seleção de
//! Cortes (#53). Este módulo só **dimensiona** as janelas: dado o contexto efetivo do Perfil
//! de Provedor (#143), a estimativa de tokens (#140) e o limiar de preço (#141), devolve
//! intervalos de Frases (#49) que cabem no orçamento, ou o erro tipado `context_too_small`.
//! Não seleciona, não pontua, não enfileira jobs e não tem UI.
//!
//! [`plan`] é uma função **pura**: sem arquivo, sem rede e sem chamar o estimador. Os
//! caracteres de cada Frase entram prontos e viram somas prefixadas, de modo que uma live de
//! 11 h (dezenas de milhares de Frases) custa uma passada mais uma busca binária por janela.
//! [`plan_for_profile`] é o wrapper fino que monta essas entradas a partir do perfil.
//!
//! # Regras
//! - Teto de [`WINDOW_MAX_US`] (15 min) por janela.
//! - A sobreposição é o maior Corte permitido (padrão [`DEFAULT_OVERLAP_US`], 3 min): a
//!   próxima janela começa na primeira Frase que começa depois de `fim - sobreposição`, então
//!   todo Corte que cruza o fim de uma janela cabe inteiro na seguinte.
//! - Mínimo planejado = [`MIN_WINDOW_FACTOR`] × sobreposição (9 min no padrão).
//! - Entrada máxima = [`CONTEXT_USABLE_PERCENT`] % do contexto (margem de 15 %, porque o
//!   estimador erra) menos a saída e o raciocínio reservados, e nunca mais que
//!   [`PRICE_THRESHOLD_PERCENT`] % do menor limiar de preço do modelo. Os tokens fixos
//!   (envelope, instrução e schema) saem desse orçamento antes da Transcrição.
//! - Os tokens de uma janela usam [`cost::planning_range`] (#173): ponto ×1,2 sem calibração,
//!   ponta alta calibrada com ela. A parte fixa usa [`cost::planning_fixed_tokens`] (ponto ×1,0).
//!
//! # Estados
//! - cheia: nenhuma janela foi encurtada por tokens; todas têm até 15 min por duração;
//! - reduzida: cabe, mas ao menos uma janela terminou antes dos 15 min por limite de tokens;
//! - bloqueada (erro `context_too_small`): a janela mínima não cabe em algum ponto da Fonte,
//!   ou uma única Frase não cabe numa janela. Não há como forçar nem trocar de perfil aqui.
//!
//! Uma Fonte mais curta que o mínimo vira uma janela só com a Fonte inteira, desde que caiba
//! nos tokens; a capacidade mínima é verificada sobre o que existe (`min(mínimo, Fonte)`).
//! Uma Frase nunca é dividida e as janelas nunca deixam lacuna entre Frases.

use crate::energy::EnergyMarks;
use crate::provider::{self, cost};
use crate::sentences::{self, Sentence};
use crate::CoreError;
use serde_json::Value;

const MINUTE_US: i64 = 60_000_000;
/// Teto de duração de uma Janela de seleção (decisão do #19; só sobe com ganho medido no #57).
pub const WINDOW_MAX_US: i64 = 15 * MINUTE_US;
/// Sobreposição padrão: o maior Corte permitido enquanto não há Perfil de canal (#72).
pub const DEFAULT_OVERLAP_US: i64 = 3 * MINUTE_US;
/// A janela mínima é este múltiplo da sobreposição, para não reprocessar mais de 1/3 dela.
pub const MIN_WINDOW_FACTOR: i64 = 3;
/// Maior Corte aceito hoje (5 min): o mínimo planejado (3 × Corte) não pode passar do teto.
/// O Perfil de canal (#72) limita a duração máxima do Corte a este valor.
pub const MAX_CUT_US: i64 = WINDOW_MAX_US / MIN_WINDOW_FACTOR;
/// Fração do contexto efetivo que a chamada pode usar; os 15 % restantes são a margem do
/// estimador de tokens.
pub const CONTEXT_USABLE_PERCENT: u64 = 85;
/// Fração do menor limiar de preço que a entrada não ultrapassa.
pub const PRICE_THRESHOLD_PERCENT: u64 = 85;
/// Reserva de saída por janela quando quem chama não informa outra (premissa da pesquisa #115,
/// seção 6.2: candidatos esperados × 150 + folga).
pub const DEFAULT_OUTPUT_RESERVE: u64 = 1_000;
/// Reserva de raciocínio padrão: modelos sem raciocínio não reservam nada.
pub const DEFAULT_REASONING_RESERVE: u64 = 0;

/// O que o planejador precisa saber de uma Frase.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct SentenceSpan {
    pub id: i64,
    pub start_us: i64,
    pub end_us: i64,
    /// Caracteres que a linha `123 texto\n` ocupa no pedido (já com o escape do JSON).
    pub chars: u64,
}

/// De onde vem o contexto efetivo; é a categoria de `provider.context.get` (#143).
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum ContextOrigin {
    User,
    Loaded,
    Server,
    Catalog,
    Fallback,
    Measured,
}

impl ContextOrigin {
    pub fn parse(origin: &str) -> Option<Self> {
        Some(match origin {
            "user" => Self::User,
            "loaded" => Self::Loaded,
            "server" => Self::Server,
            "catalog" => Self::Catalog,
            "fallback" => Self::Fallback,
            "measured" => Self::Measured,
            _ => return None,
        })
    }
    fn label(self) -> &'static str {
        match self {
            Self::User => "definido por você no perfil",
            Self::Loaded => "carregado pelo servidor",
            Self::Server => "máximo informado pelo servidor",
            Self::Catalog => "catálogo de modelos",
            Self::Fallback => "padrão conservador: nenhum limite foi descoberto",
            Self::Measured => "confirmado pelo uso informado pelo Provedor",
        }
    }
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct EffectiveContext {
    pub tokens: u64,
    pub origin: ContextOrigin,
}

/// Tokens por caractere já resolvidos para o perfil, formato e idioma (#140).
#[derive(Clone, Copy, Debug, PartialEq)]
pub struct TokenRatio {
    pub low: f64,
    pub high: f64,
}

#[derive(Clone, Copy, Debug)]
pub struct PlanInput<'a> {
    pub sentences: &'a [SentenceSpan],
    /// Caracteres do marcador `## hh:mm\n` (com escape), que cada janela repete por minuto.
    pub header_chars: u64,
    pub context: EffectiveContext,
    pub ratio: TokenRatio,
    /// Tokens do envelope, da instrução e do schema, somados a cada janela.
    pub fixed_tokens: u64,
    pub output_reserve: u64,
    pub reasoning_reserve: u64,
    /// Maior Corte permitido (µs); é a sobreposição entre janelas.
    pub max_cut_us: i64,
    /// Menor `above_input_tokens` do modelo; `None` quando o preço não tem faixas.
    pub price_threshold: Option<u64>,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum PlanState {
    Full,
    Reduced,
    Blocked,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct Window {
    /// Posição das Frases na entrada (inclusive).
    pub first_index: usize,
    pub last_index: usize,
    pub first_id: i64,
    pub last_id: i64,
    pub start_us: i64,
    pub end_us: i64,
    /// Tokens de entrada estimados (fixos + Transcrição) nas pontas baixa e alta.
    pub tokens_low: u64,
    pub tokens_high: u64,
}

#[derive(Clone, Debug, PartialEq)]
pub struct Plan {
    /// `Full` ou `Reduced`; `Blocked` só existe como erro.
    pub state: PlanState,
    pub windows: Vec<Window>,
    pub context: EffectiveContext,
    /// Entrada máxima por chamada (fixos + Transcrição), já com margem e limiar de preço.
    pub input_limit_tokens: u64,
    pub min_window_us: i64,
    pub overlap_us: i64,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum PlanError {
    /// Nem a janela mínima (ou uma Frase) cabe no contexto efetivo.
    ContextTooSmall {
        context: EffectiveContext,
        min_window_us: i64,
    },
    /// O maior Corte permitido faz o mínimo (3 × sobreposição) passar do teto de 15 min.
    MaxCutTooLong,
    /// Frases fora de ordem, tempos inválidos, razão de tokens ou Corte não positivos.
    InvalidInput,
}

impl PlanError {
    pub fn state(&self) -> PlanState {
        PlanState::Blocked
    }
}

fn minutes(us: i64) -> String {
    let tenths = us.max(0) / (MINUTE_US / 10);
    if tenths % 10 == 0 {
        format!("{}", tenths / 10)
    } else {
        format!("{}.{}", tenths / 10, tenths % 10)
    }
}

impl From<PlanError> for CoreError {
    fn from(error: PlanError) -> Self {
        let (code, message) = match error {
            PlanError::ContextTooSmall {
                context,
                min_window_us,
            } => (
                "context_too_small",
                format!(
                    "Contexto efetivo de {} tokens ({}): não cabe a janela mínima de seleção de {} min. Aumente o contexto no Perfil de Provedor ou escolha outro perfil para a seleção.",
                    context.tokens,
                    context.origin.label(),
                    minutes(min_window_us)
                ),
            ),
            PlanError::MaxCutTooLong => (
                "max_cut_too_long",
                format!(
                    "O maior Corte permitido é longo demais: hoje o máximo aceito é {} min, porque a janela mínima (3 vezes a sobreposição) não pode passar do teto de 15 min. Cortes mais longos dependem de uma decisão futura sobre janelas maiores.",
                    minutes(MAX_CUT_US)
                ),
            ),
            PlanError::InvalidInput => (
                "invalid_selection_plan",
                "Entrada inválida para o planejador de Janelas de seleção: confira se não há tempos negativos ou invertidos, IDs de Frase fora de ordem, duração máxima do Corte não positiva ou razão de tokens inválida.".to_owned(),
            ),
        };
        CoreError {
            code: code.into(),
            message,
            usage: None,
        }
    }
}

fn tokens(chars: u64, ratio: f64) -> u64 {
    (chars as f64 * ratio).ceil() as u64
}

fn percent(value: u64, percent: u64) -> u64 {
    (u128::from(value) * u128::from(percent) / 100) as u64
}

fn minute_of(span: &SentenceSpan) -> i64 {
    span.start_us.max(0) / MINUTE_US
}

fn validate(input: &PlanInput<'_>) -> Result<bool, PlanError> {
    let ratio_ok = input.ratio.high.is_finite()
        && input.ratio.high > 0.0
        && input.ratio.low.is_finite()
        && input.ratio.low > 0.0
        && input.ratio.low <= input.ratio.high;
    if !ratio_ok || input.max_cut_us <= 0 {
        return Err(PlanError::InvalidInput);
    }
    let mut needs_normalization = false;
    let mut previous: Option<&SentenceSpan> = None;
    for s in input.sentences {
        if s.start_us < 0 || s.end_us < s.start_us {
            return Err(PlanError::InvalidInput);
        }
        if s.end_us == s.start_us {
            needs_normalization = true;
        }
        if let Some(p) = previous {
            if s.id <= p.id {
                return Err(PlanError::InvalidInput);
            }
            if s.start_us < p.end_us {
                needs_normalization = true;
            }
        }
        previous = Some(s);
    }
    Ok(needs_normalization)
}

fn normalized_spans(sentences: &[SentenceSpan]) -> Vec<SentenceSpan> {
    let mut pairs: Vec<(i64, i64)> = sentences.iter().map(|s| (s.start_us, s.end_us)).collect();
    let _ = sentences::normalize_spans(&mut pairs, None);
    sentences
        .iter()
        .zip(pairs)
        .map(|(s, (start_us, end_us))| SentenceSpan {
            start_us,
            end_us,
            ..*s
        })
        .collect()
}

/// Calcula as janelas. Pura: o resultado depende só de `input`.
pub fn plan(input: &PlanInput<'_>) -> Result<Plan, PlanError> {
    let needs_normalization = validate(input)?;
    let overlap = input.max_cut_us;
    if overlap > MAX_CUT_US {
        return Err(PlanError::MaxCutTooLong);
    }
    let min_window_us = overlap * MIN_WINDOW_FACTOR;

    let mut input_limit = percent(input.context.tokens, CONTEXT_USABLE_PERCENT)
        .saturating_sub(input.output_reserve.saturating_add(input.reasoning_reserve));
    if let Some(threshold) = input.price_threshold {
        input_limit = input_limit.min(percent(threshold, PRICE_THRESHOLD_PERCENT));
    }
    let budget = input_limit.saturating_sub(input.fixed_tokens);
    let blocked = PlanError::ContextTooSmall {
        context: input.context,
        min_window_us,
    };
    let spans: std::borrow::Cow<'_, [SentenceSpan]> = if needs_normalization {
        std::borrow::Cow::Owned(normalized_spans(input.sentences))
    } else {
        std::borrow::Cow::Borrowed(input.sentences)
    };
    let spans = spans.as_ref();
    let n = spans.len();
    let mut result = Plan {
        state: PlanState::Full,
        windows: Vec::new(),
        context: input.context,
        input_limit_tokens: input_limit,
        min_window_us,
        overlap_us: overlap,
    };
    if n == 0 {
        return Ok(result);
    }

    // Somas prefixadas: linhas e marcadores de minuto (um por mudança de minuto na Fonte; o
    // primeiro de cada janela é sempre emitido).
    let mut lines = Vec::with_capacity(n + 1);
    let mut heads = Vec::with_capacity(n + 1);
    let (mut line_sum, mut head_sum) = (0u64, 0u64);
    lines.push(0);
    heads.push(0);
    for (i, s) in spans.iter().enumerate() {
        line_sum = line_sum.saturating_add(s.chars);
        head_sum += u64::from(i == 0 || minute_of(s) != minute_of(&spans[i - 1]));
        lines.push(line_sum);
        heads.push(head_sum);
    }
    let starts_header = |i: usize| i == 0 || minute_of(&spans[i]) != minute_of(&spans[i - 1]);
    let chars_of = |s: usize, e: usize| {
        let markers = heads[e + 1] - heads[s] + u64::from(!starts_header(s));
        (lines[e + 1] - lines[s]).saturating_add(markers.saturating_mul(input.header_chars))
    };
    let high_of = |s: usize, e: usize| tokens(chars_of(s, e), input.ratio.high);
    let duration = |s: usize, e: usize| spans[e].end_us - spans[s].start_us;

    let mut reduced = false;
    let mut start = 0;
    loop {
        // Maior índice que respeita o teto de duração e o orçamento de tokens a partir de `start`.
        let by_duration = spans[start..]
            .partition_point(|s| s.end_us - spans[start].start_us <= WINDOW_MAX_US)
            .checked_sub(1)
            .map(|k| start + k)
            .ok_or(blocked)?;
        let by_tokens = {
            // Busca binária em [start, by_duration]; monotônica porque os tokens só crescem.
            let (mut low, mut high) = (start, by_duration + 1);
            while low < high {
                let mid = low + (high - low) / 2;
                if high_of(start, mid) <= budget {
                    low = mid + 1;
                } else {
                    high = mid;
                }
            }
            low.checked_sub(1)
                .filter(|last| *last >= start)
                .ok_or(blocked)?
        };
        // Capacidade mínima: a janela de `min(mínimo, o que existe até o teto)` tem que caber.
        let required = (start
            + spans[start..].partition_point(|s| s.end_us - spans[start].start_us < min_window_us))
        .min(n - 1)
        .min(by_duration);
        if required > by_tokens {
            return Err(blocked);
        }
        let end = by_duration.min(by_tokens);
        if by_tokens < by_duration {
            reduced = true;
        }
        let fixed = input.fixed_tokens;
        result.windows.push(Window {
            first_index: start,
            last_index: end,
            first_id: spans[start].id,
            last_id: spans[end].id,
            start_us: spans[start].start_us,
            end_us: spans[end].end_us,
            tokens_low: fixed.saturating_add(tokens(chars_of(start, end), input.ratio.low)),
            tokens_high: fixed.saturating_add(high_of(start, end)),
        });
        debug_assert!(duration(start, end) <= WINDOW_MAX_US);
        if end == n - 1 {
            break;
        }
        // Próxima janela: primeira Frase que começa depois de `fim - sobreposição`. Se a
        // janela é mais curta que a sobreposição, ou se uma janela a partir dali não
        // alcançaria a Frase seguinte (só acontece quando o teto de duração a cortou antes de
        // um grande silêncio), recomeça depois dela: repetir Frases não traria nada novo.
        let cut = spans[end].end_us - overlap;
        let next = spans.partition_point(|s| s.start_us <= cut);
        let reaches_beyond =
            next > start && spans[end + 1].end_us - spans[next].start_us <= WINDOW_MAX_US;
        start = if reaches_beyond { next } else { end + 1 };
    }
    result.state = if reduced {
        PlanState::Reduced
    } else {
        PlanState::Full
    };
    Ok(result)
}

/// Escape do JSON: o transcript vai dentro de uma string do envelope (#140 conta assim).
fn escaped_chars(text: &str) -> u64 {
    serde_json::to_string(text).map_or(text.chars().count() as u64, |json| {
        json.chars().count() as u64 - 2
    })
}

/// O que o wrapper pede além do perfil: a tarefa e as reservas ficam com quem chama (#53).
#[derive(Clone, Copy, Debug)]
pub struct ProfileRequest<'a> {
    /// Perfil explícito; sem ele vale a rota da `task`, como em `provider.context.get`.
    pub profile_id: Option<&'a str>,
    pub task: Option<&'a str>,
    pub instruction: &'a str,
    pub schema: &'a Value,
    pub native_schema: bool,
    pub output_reserve: u64,
    pub reasoning_reserve: u64,
    pub max_cut_us: i64,
}

/// Monta as entradas de [`plan`] a partir do perfil e planeja. Não usa a rede: lê o contexto
/// efetivo do cache de #143 (`cached_effective`), a calibração local de #140 (uma vez, não por
/// janela) e a tabela de preços de #141. Nada é enviado a Provedor, portanto o veto
/// "somente local" (#123) não tem o que barrar aqui.
pub fn plan_for_profile(
    request: &ProfileRequest<'_>,
    frases: &[Sentence],
) -> Result<Plan, CoreError> {
    plan_for_profile_marked(request, frases, &EnergyMarks::new())
}

/// [`plan_for_profile`] sobre o texto com as marcas de energia do áudio (#54): as marcas são
/// texto enviado, então a razão de tokens e o tamanho de cada Frase as contam.
pub fn plan_for_profile_marked(
    request: &ProfileRequest<'_>,
    frases: &[Sentence],
    marks: &impl sentences::SentenceMarks,
) -> Result<Plan, CoreError> {
    let profile = provider::effective_cached(request.task, request.profile_id)?;
    // A reserva de saída é a da chamada (#147): o pedido, cortado pelo limite do Perfil e do
    // modelo. Sem Perfil (CLI) vale o que o chamador pediu.
    let output_reserve =
        provider::output_reserve(request.task, request.profile_id, request.output_reserve)?;
    let origin = ContextOrigin::parse(profile.origin).ok_or(PlanError::InvalidInput)?;

    let compact = sentences::compact_with_hint_marked(frases, marks);
    let structured = |transcript: String| provider::StructuredRequest {
        estimate_hint: compact.hint.clone(),
        instruction: request.instruction.to_owned(),
        transcript,
        schema: request.schema.clone(),
        native_schema: request.native_schema,
        max_output_tokens: None,
    };
    // Duas chamadas ao estimador no total: a Transcrição inteira (razão) e o envelope vazio
    // (tokens fixos).
    let full = structured(compact.text);
    let full_chars = cost::input_characters(&full).max(1);
    let range = cost::planning_range(&profile.profile_id, &profile.model, &full)?;
    let ratio = TokenRatio {
        low: (range.low as f64 / full_chars as f64).max(f64::MIN_POSITIVE),
        high: (range.high as f64 / full_chars as f64).max(f64::MIN_POSITIVE),
    };
    // A parte fixa é o mesmo texto em toda janela e conhecida por inteiro: ponto ×1,0 (#173).
    let fixed_tokens = cost::planning_fixed_tokens(
        &profile.profile_id,
        &profile.model,
        &structured(String::new()),
    )?;

    let header_chars = escaped_chars(&sentences::compact(&[Sentence {
        id: 0,
        first_position: 0,
        last_position: 0,
        start_us: 0,
        end_us: 0,
        language: None,
        text: String::new(),
    }]))
    .saturating_sub(escaped_chars("0 \n"));
    let spans: Vec<SentenceSpan> = frases
        .iter()
        .map(|s| SentenceSpan {
            id: s.id,
            start_us: s.start_us,
            end_us: s.end_us,
            chars: escaped_chars(&sentences::line(s, marks)),
        })
        .collect();

    let price_threshold = cost::price_for(&profile.kind, &profile.model)?
        .and_then(|(price, _)| price.tiers.iter().map(|t| t.above_input_tokens).min());
    plan(&PlanInput {
        sentences: &spans,
        header_chars,
        context: EffectiveContext {
            tokens: profile.value,
            origin,
        },
        ratio,
        fixed_tokens,
        output_reserve,
        reasoning_reserve: request.reasoning_reserve,
        max_cut_us: request.max_cut_us,
        price_threshold,
    })
    .map_err(CoreError::from)
}

#[cfg(test)]
mod tests;
