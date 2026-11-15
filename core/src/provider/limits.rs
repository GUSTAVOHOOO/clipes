//! Limites de saída e timeout por Perfil de Provedor e tamanho da chamada (#147).
//!
//! Funções **puras** (sem arquivo, sem rede), no estilo de `selection_windows::plan`. O
//! adaptador, a estimativa de custo e o planejador de Janelas de seleção (#144) leem a mesma
//! regra, para o plano e a chamada não divergirem.
//!
//! # Saída máxima (`max_output_tokens`)
//! Dois passos:
//! 1. **Teto estático** ([`output_ceiling`]): o menor entre o pedido da Tarefa, o limite do
//!    Perfil e o `max_output` conhecido do modelo (servidor ou catálogo, o mesmo número que
//!    `provider.context.get` mostra). Se nem o Perfil nem o modelo informam limite, vale
//!    [`FALLBACK_MAX_OUTPUT_TOKENS`]. É o que o planejador usa como reserva de saída.
//! 2. **Espaço livre** ([`apply_free_space`]): `contexto efetivo − estimativa ALTA da entrada −
//!    raciocínio reservado`. Menor que [`MIN_USEFUL_OUTPUT_TOKENS`], a chamada é recusada
//!    antes de enviar (`output_space_insufficient`), sem rede, sem custo e sem trilha.
//!
//! Sem pedido da Tarefa (`ask` nulo) só o Anthropic recebe teto, porque a API o exige: o pedido
//! padrão é [`DEFAULT_ASK_TOKENS`], o mesmo 8192 de antes, agora limitado pelo catálogo, pelo
//! Perfil e pelo espaço livre. Os outros tipos continuam sem teto, a menos que o Perfil tenha
//! um limite próprio.
//!
//! # Timeout
//! [`timeout`]: o valor do Perfil, se houver (exato, editado pelo usuário); senão o timeout por
//! tipo do #117 mais [`TIMEOUT_MS_PER_1K_INPUT_TOKENS`] por 1.000 tokens estimados. Nos dois
//! casos o orçamento de tempo restante do executor (#121) é o teto.
use super::*;
use std::time::Duration;

/// Teto conservador quando nem o Perfil nem o modelo informam a saída máxima.
pub const FALLBACK_MAX_OUTPUT_TOKENS: u64 = 4096;
/// Pedido padrão do Anthropic quando a Tarefa não pede um teto (era o 8192 fixo do adaptador).
pub const DEFAULT_ASK_TOKENS: u64 = 8192;
/// Espaço livre mínimo para valer a chamada: menos que isso não comporta nem uma resposta curta.
pub const MIN_USEFUL_OUTPUT_TOKENS: u64 = 512;
/// Reserva de raciocínio quando o chamador não informa outra (modelos sem raciocínio).
pub const DEFAULT_REASONING_RESERVE: u64 = 0;
/// Acréscimo ao timeout por tipo, por 1.000 tokens estimados de entrada (a leitura de um
/// prompt longo é mais lenta).
pub const TIMEOUT_MS_PER_1K_INPUT_TOKENS: u64 = 1000;
/// Nenhum timeout calculado passa disto (o mesmo teto dos timeouts configuráveis).
pub const MAX_TIMEOUT_SECS: u64 = 3600;

pub const OUTPUT_SPACE_MESSAGE: &str =
    "There is not enough free context left for an answer; nothing was sent";

/// De onde vem o valor de saída máxima aplicado.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum OutputSource {
    /// O pedido da Tarefa (ou o pedido padrão do Anthropic) já era o menor.
    Task,
    /// O limite editado no Perfil.
    Profile,
    /// `max_output` do modelo: o informado pelo servidor ou o do catálogo (#141).
    Model,
    /// Nenhum limite conhecido: o fallback conservador.
    Fallback,
    /// O espaço livre do contexto, depois da entrada e do raciocínio.
    FreeSpace,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct OutputLimit {
    pub tokens: u64,
    pub source: OutputSource,
}

/// O que o teto estático precisa saber.
#[derive(Clone, Copy, Debug, Default)]
pub struct CeilingInput {
    /// Pedido da Tarefa (`StructuredRequest::max_output_tokens`).
    pub ask: Option<u64>,
    /// Limite do Perfil (campo `maxOutput`).
    pub profile: Option<u64>,
    /// `max_output` do modelo (servidor ou catálogo).
    pub model: Option<u64>,
    /// A API recusa a chamada sem teto (Anthropic): usa [`DEFAULT_ASK_TOKENS`] sem pedido.
    pub requires_ceiling: bool,
}

/// O limite do Perfil e do modelo, sem o pedido da Tarefa: o menor dos conhecidos, ou o
/// fallback conservador se nenhum for conhecido. É o valor que a tela mostra.
pub fn profile_output_limit(profile: Option<u64>, model: Option<u64>) -> OutputLimit {
    let mut best: Option<OutputLimit> = None;
    for (tokens, source) in [
        (profile, OutputSource::Profile),
        (model, OutputSource::Model),
    ] {
        if let Some(tokens) = tokens {
            if best.is_none_or(|b| tokens < b.tokens) {
                best = Some(OutputLimit { tokens, source });
            }
        }
    }
    best.unwrap_or(OutputLimit {
        tokens: FALLBACK_MAX_OUTPUT_TOKENS,
        source: OutputSource::Fallback,
    })
}

/// Teto estático de saída. `None` quando ninguém pede nem limita e a API não exige teto.
pub fn output_ceiling(input: CeilingInput) -> Option<OutputLimit> {
    let ask = input
        .ask
        .or(input.requires_ceiling.then_some(DEFAULT_ASK_TOKENS));
    if ask.is_none() && input.profile.is_none() {
        return None;
    }
    let cap = profile_output_limit(input.profile, input.model);
    Some(match ask {
        Some(tokens) if tokens <= cap.tokens => OutputLimit {
            tokens,
            source: OutputSource::Task,
        },
        _ => cap,
    })
}

/// O contexto de uma chamada: o que sobra para a saída.
#[derive(Clone, Copy, Debug)]
pub struct Space {
    pub context: u64,
    /// Estimativa ALTA da entrada (#140).
    pub input_high: u64,
    pub reasoning: u64,
}

impl Space {
    pub fn free(&self) -> u64 {
        self.context
            .saturating_sub(self.input_high)
            .saturating_sub(self.reasoning)
    }
}

/// Aplica o espaço livre ao teto. Recusa (`output_space_insufficient`) se o espaço livre não
/// chega a [`MIN_USEFUL_OUTPUT_TOKENS`], mesmo sem teto. Sem teto e com espaço, nada muda.
pub fn apply_free_space(
    ceiling: Option<OutputLimit>,
    space: Space,
) -> Result<Option<OutputLimit>, CoreError> {
    let free = space.free();
    if free < MIN_USEFUL_OUTPUT_TOKENS {
        return Err(error("output_space_insufficient", OUTPUT_SPACE_MESSAGE));
    }
    Ok(ceiling.map(|c| {
        if free < c.tokens {
            OutputLimit {
                tokens: free,
                source: OutputSource::FreeSpace,
            }
        } else {
            c
        }
    }))
}

/// De onde vem o timeout aplicado.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum TimeoutSource {
    /// O valor editado no Perfil.
    Profile,
    /// O timeout por tipo (#117) mais o acréscimo pelo tamanho da entrada.
    Default,
    /// O orçamento de tempo restante do executor era menor.
    Budget,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct TimeoutValue {
    pub duration: Duration,
    pub source: TimeoutSource,
}

/// Timeout de uma chamada. `base` é o timeout por tipo (#117), `profile` o do Perfil,
/// `input_high` a estimativa alta da entrada e `remaining` o orçamento de tempo que sobra ao
/// executor (`None` fora dele).
pub fn timeout(
    base: Duration,
    profile: Option<Duration>,
    input_high: u64,
    remaining: Option<Duration>,
) -> TimeoutValue {
    let (own, source) = match profile {
        Some(own) => (own, TimeoutSource::Profile),
        None => {
            let extra = Duration::from_millis(
                input_high.saturating_mul(TIMEOUT_MS_PER_1K_INPUT_TOKENS) / 1000,
            );
            (
                base.saturating_add(extra)
                    .min(Duration::from_secs(MAX_TIMEOUT_SECS)),
                TimeoutSource::Default,
            )
        }
    };
    match remaining {
        Some(left) if left < own => TimeoutValue {
            duration: left,
            source: TimeoutSource::Budget,
        },
        _ => TimeoutValue {
            duration: own,
            source,
        },
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn ceiling(
        ask: Option<u64>,
        profile: Option<u64>,
        model: Option<u64>,
        req: bool,
    ) -> Option<(u64, OutputSource)> {
        output_ceiling(CeilingInput {
            ask,
            profile,
            model,
            requires_ceiling: req,
        })
        .map(|l| (l.tokens, l.source))
    }

    #[test]
    fn smallest_of_ask_profile_and_model_wins() {
        use OutputSource::*;
        assert_eq!(
            ceiling(Some(1000), Some(2000), Some(8000), false),
            Some((1000, Task))
        );
        assert_eq!(
            ceiling(Some(9000), Some(2000), Some(8000), false),
            Some((2000, Profile))
        );
        assert_eq!(
            ceiling(Some(9000), None, Some(8000), false),
            Some((8000, Model))
        );
        // A request larger than the catalog is cut to it.
        assert_eq!(
            ceiling(Some(100_000), None, Some(64_000), false),
            Some((64_000, Model))
        );
        // A tie keeps the earlier source.
        assert_eq!(
            ceiling(Some(2000), Some(2000), Some(2000), false),
            Some((2000, Task))
        );
    }

    #[test]
    fn catalog_of_8192_or_more_keeps_a_smaller_request() {
        use OutputSource::*;
        assert_eq!(
            ceiling(Some(256), None, Some(8192), false),
            Some((256, Task))
        );
        assert_eq!(
            ceiling(Some(4096), None, Some(64_000), true),
            Some((4096, Task))
        );
        // The Anthropic default ask is the former fixed 8192.
        assert_eq!(ceiling(None, None, Some(64_000), true), Some((8192, Task)));
    }

    #[test]
    fn unknown_limit_uses_the_explicit_conservative_fallback() {
        use OutputSource::*;
        assert_eq!(
            ceiling(Some(8192), None, None, false),
            Some((FALLBACK_MAX_OUTPUT_TOKENS, Fallback))
        );
        assert_eq!(
            ceiling(None, None, None, true),
            Some((FALLBACK_MAX_OUTPUT_TOKENS, Fallback))
        );
        assert_eq!(ceiling(Some(100), None, None, false), Some((100, Task)));
        // A known limit disables the fallback.
        assert_eq!(
            ceiling(Some(8192), Some(6000), None, false),
            Some((6000, Profile))
        );
    }

    #[test]
    fn no_ask_no_profile_limit_and_no_requirement_sends_no_ceiling() {
        assert_eq!(ceiling(None, None, Some(64_000), false), None);
        assert_eq!(ceiling(None, None, None, false), None);
        assert_eq!(
            ceiling(None, Some(500), Some(64_000), false),
            Some((500, OutputSource::Profile))
        );
    }

    #[test]
    fn free_space_cuts_the_ceiling_and_refuses_below_the_minimum() {
        let c = output_ceiling(CeilingInput {
            ask: Some(4096),
            ..Default::default()
        });
        let space = |context, input_high, reasoning| Space {
            context,
            input_high,
            reasoning,
        };
        let cut = apply_free_space(c, space(8192, 5000, 0)).unwrap().unwrap();
        assert_eq!((cut.tokens, cut.source), (3192, OutputSource::FreeSpace));
        let reasoning = apply_free_space(c, space(8192, 5000, 2000))
            .unwrap()
            .unwrap();
        assert_eq!(reasoning.tokens, 1192);
        let roomy = apply_free_space(c, space(32_768, 5000, 0))
            .unwrap()
            .unwrap();
        assert_eq!((roomy.tokens, roomy.source), (4096, OutputSource::Task));
        // Exactly the minimum still goes; one token less is refused, even without a ceiling.
        assert!(apply_free_space(c, space(5512, 5000, 0)).is_ok());
        let e = apply_free_space(c, space(5511, 5000, 0)).unwrap_err();
        assert_eq!(
            (e.code.as_str(), e.message.as_str()),
            ("output_space_insufficient", OUTPUT_SPACE_MESSAGE)
        );
        assert!(apply_free_space(None, space(100, 5000, 0)).is_err());
        assert_eq!(
            apply_free_space(None, space(32_768, 5000, 0)).unwrap(),
            None
        );
    }

    #[test]
    fn default_timeout_grows_with_the_input_and_the_profile_value_is_exact() {
        let base = Duration::from_secs(60);
        let small = timeout(base, None, 0, None);
        assert_eq!(
            (small.duration, small.source),
            (base, TimeoutSource::Default)
        );
        let big = timeout(base, None, 50_000, None);
        assert_eq!(
            big.duration,
            Duration::from_millis(60_000 + 50 * TIMEOUT_MS_PER_1K_INPUT_TOKENS)
        );
        let own = timeout(base, Some(Duration::from_secs(10)), 50_000, None);
        assert_eq!(
            (own.duration, own.source),
            (Duration::from_secs(10), TimeoutSource::Profile)
        );
        assert_eq!(
            timeout(Duration::from_secs(3000), None, 10_000_000, None).duration,
            Duration::from_secs(MAX_TIMEOUT_SECS)
        );
    }

    #[test]
    fn remaining_budget_caps_both_kinds() {
        let left = Some(Duration::from_secs(5));
        let capped = timeout(Duration::from_secs(60), None, 0, left);
        assert_eq!(
            (capped.duration, capped.source),
            (Duration::from_secs(5), TimeoutSource::Budget)
        );
        let capped = timeout(
            Duration::from_secs(60),
            Some(Duration::from_secs(30)),
            0,
            left,
        );
        assert_eq!(capped.source, TimeoutSource::Budget);
        let kept = timeout(
            Duration::from_secs(60),
            Some(Duration::from_secs(3)),
            0,
            left,
        );
        assert_eq!(
            (kept.duration, kept.source),
            (Duration::from_secs(3), TimeoutSource::Profile)
        );
    }
}
