//! Regras puras da seleção de Cortes (#53): Nota total, ajuste de bordas por Frase inteira e
//! junção de duplicatas. Sem I/O, sem relógio e sem Provedor: o modelo só aponta IDs de Frase e
//! dá notas; tudo o que muda tempo ou ordem é código.

/// Um eixo da Nota e o peso dele, em pontos percentuais. A tabela [`AXES`] é a **única** fonte
/// dos pesos: a Nota total, o schema de saída, os verificadores e a UI leem dela. Um eixo novo
/// (o 6º, "Espaço para comentário", do Vídeo transformado) entra aqui; os pesos têm de somar 100.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct Axis {
    /// Chave no schema fio e na saída do comando.
    pub key: &'static str,
    pub weight_percent: u32,
}

/// Pesos da v1 (decisão do dev, 15/11/2026). Sem curva.
pub const AXES: [Axis; 5] = [
    Axis {
        key: "hook",
        weight_percent: 30,
    },
    Axis {
        key: "selfContained",
        weight_percent: 20,
    },
    Axis {
        key: "energy",
        weight_percent: 20,
    },
    Axis {
        key: "value",
        weight_percent: 15,
    },
    Axis {
        key: "closing",
        weight_percent: 15,
    },
];

pub const AXIS_COUNT: usize = AXES.len();
pub const SCORE_MAX: u8 = 10;

/// Soma ponderada em centésimos de ponto: `Σ peso% × nota`, de 0 a 1000. A Nota total é
/// esse número ÷ 100 (duas casas exatas, sem ponto flutuante na comparação).
pub fn total_centi(scores: &[u8; AXIS_COUNT]) -> u32 {
    AXES.iter()
        .zip(scores)
        .map(|(axis, score)| axis.weight_percent * u32::from(*score))
        .sum()
}

pub const SECOND_US: i64 = 1_000_000;
/// Duração mínima padrão de um Corte (até o Perfil de canal do #72 existir).
pub const MIN_CUT_US: i64 = 20 * SECOND_US;
/// Fim da faixa desejada, informado ao modelo. Cortes entre este valor e o máximo valem.
pub const PREFERRED_MAX_US: i64 = 60 * SECOND_US;
/// Duração máxima padrão: igual ao maior Corte que o planejador de Janelas (#144) prevê.
pub const MAX_CUT_US: i64 = 180 * SECOND_US;
/// Interseção em tempo, em % da duração do menor Corte, a partir da qual dois candidatos são
/// o mesmo momento.
pub const DUPLICATE_OVERLAP_PERCENT: i64 = 50;
/// Meta de candidatos por hora de Janela (proporcional à duração dela).
pub const CANDIDATES_PER_HOUR: i64 = 10;
/// O verificador aceita até este múltiplo da meta: a meta é "até ~", não um limite exato.
pub const CANDIDATE_HARD_FACTOR: i64 = 2;
const HOUR_US: i64 = 3_600 * SECOND_US;

/// Meta de candidatos de uma Janela, pelo menos 1.
pub fn target_candidates(window_us: i64) -> i64 {
    ((window_us.max(0) * CANDIDATES_PER_HOUR + HOUR_US - 1) / HOUR_US).max(1)
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Default)]
pub struct Span {
    pub start_us: i64,
    pub end_us: i64,
}

/// Como as bordas mudaram, em Frases inteiras.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Default)]
pub struct Adjust {
    pub extended_before: u32,
    pub extended_after: u32,
    pub trimmed_end: u32,
}

impl Adjust {
    pub fn changed(&self) -> bool {
        self.extended_before + self.extended_after + self.trimmed_end > 0
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Discard {
    /// Não chegou ao mínimo nem estendendo (fim da Transcrição, ou o máximo vedou).
    TooShort,
    /// Não coube no máximo nem tirando Frases do fim (uma única Frase maior que o máximo).
    TooLong,
}

fn duration(spans: &[Span], start: usize, end: usize) -> i64 {
    spans[end].end_us - spans[start].start_us
}

/// Ajusta `[start, end]` (índices de Frase da Transcrição inteira) à faixa `[min, max]`.
/// Curto: acrescenta a Frase seguinte até o mínimo, sem passar do máximo nem da Transcrição;
/// se a seguinte não couber, acrescenta a anterior. Longo: tira Frases do fim até caber.
/// Nunca divide uma Frase.
pub fn fit(
    spans: &[Span],
    mut start: usize,
    mut end: usize,
    min_us: i64,
    max_us: i64,
) -> Result<(usize, usize, Adjust), Discard> {
    let mut adjust = Adjust::default();
    while end > start && duration(spans, start, end) > max_us {
        end -= 1;
        adjust.trimmed_end += 1;
    }
    if duration(spans, start, end) > max_us {
        return Err(Discard::TooLong);
    }
    while duration(spans, start, end) < min_us {
        if end + 1 < spans.len() && duration(spans, start, end + 1) <= max_us {
            end += 1;
            adjust.extended_after += 1;
        } else if start > 0 && duration(spans, start - 1, end) <= max_us {
            start -= 1;
            adjust.extended_before += 1;
        } else {
            return Err(Discard::TooShort);
        }
    }
    Ok((start, end, adjust))
}

/// Candidato já com bordas finais, para a junção de duplicatas.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Merged {
    pub span: Span,
    pub total_centi: u32,
    /// Índices (da execução) das Janelas de onde o momento veio, sem repetir, em ordem.
    pub windows: Vec<usize>,
    /// Índice do chamador para recuperar o resto do candidato; não influencia a junção.
    pub tag: usize,
}

fn same_moment(a: &Span, b: &Span) -> bool {
    let overlap = (a.end_us.min(b.end_us) - a.start_us.max(b.start_us)).max(0);
    let shortest = (a.end_us - a.start_us).min(b.end_us - b.start_us);
    shortest > 0 && overlap * 100 >= DUPLICATE_OVERLAP_PERCENT * shortest
}

/// Junta os candidatos que são o mesmo momento: fica o de maior Nota total, e no empate o mais
/// curto (depois o que começa antes, para o resultado ser determinístico). O sobrevivente
/// guarda a união das Janelas dos que absorveu. Devolve ordenado por Nota total decrescente e
/// início crescente, e a quantidade absorvida.
pub fn merge_duplicates(mut items: Vec<Merged>) -> (Vec<Merged>, usize) {
    items.sort_by_key(|c| {
        (
            std::cmp::Reverse(c.total_centi),
            c.span.end_us - c.span.start_us,
            c.span.start_us,
            c.tag,
        )
    });
    let mut kept: Vec<Merged> = Vec::new();
    let mut absorbed = 0;
    for item in items {
        if let Some(winner) = kept.iter_mut().find(|k| same_moment(&k.span, &item.span)) {
            winner.windows.extend(item.windows);
            absorbed += 1;
        } else {
            kept.push(item);
        }
    }
    for item in &mut kept {
        item.windows.sort_unstable();
        item.windows.dedup();
    }
    (kept, absorbed)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn weights_sum_to_one_hundred_percent() {
        assert_eq!(AXES.iter().map(|a| a.weight_percent).sum::<u32>(), 100);
        assert_eq!(total_centi(&[10; AXIS_COUNT]), 1000);
        assert_eq!(total_centi(&[0; AXIS_COUNT]), 0);
    }

    #[test]
    fn total_matches_a_hand_calculation() {
        // 0,30×8 + 0,20×6 + 0,20×7 + 0,15×9 + 0,15×5 = 2,4 + 1,2 + 1,4 + 1,35 + 0,75 = 7,10
        assert_eq!(total_centi(&[8, 6, 7, 9, 5]), 710);
    }

    #[test]
    fn target_is_proportional_to_the_window() {
        assert_eq!(target_candidates(15 * 60 * SECOND_US), 3);
        assert_eq!(target_candidates(HOUR_US), 10);
        assert_eq!(target_candidates(SECOND_US), 1);
    }

    /// Frases de 10 s encostadas: a Frase i vai de 10i a 10(i+1) s.
    fn spans(count: i64) -> Vec<Span> {
        (0..count)
            .map(|i| Span {
                start_us: i * 10 * SECOND_US,
                end_us: (i + 1) * 10 * SECOND_US,
            })
            .collect()
    }

    #[test]
    fn short_cut_extends_forward_then_backward() {
        let s = spans(10);
        let (a, b, adj) = fit(&s, 2, 2, MIN_CUT_US, MAX_CUT_US).unwrap();
        assert_eq!((a, b), (2, 3));
        assert_eq!(adj.extended_after, 1);
        // Na última Frase não há seguinte: usa a anterior.
        let (a, b, adj) = fit(&s, 9, 9, MIN_CUT_US, MAX_CUT_US).unwrap();
        assert_eq!((a, b), (8, 9));
        assert_eq!(adj.extended_before, 1);
        // O máximo veda a seguinte (40 s); a anterior cabe.
        let mut t = spans(8);
        t[6] = Span {
            start_us: 60 * SECOND_US,
            end_us: 100 * SECOND_US,
        };
        let (a, b, adj) = fit(&t, 5, 5, 20 * SECOND_US, 30 * SECOND_US).unwrap();
        assert_eq!((a, b), (4, 5));
        assert_eq!(adj.extended_before, 1);
    }

    #[test]
    fn long_cut_loses_sentences_from_the_end() {
        let s = spans(30);
        let (a, b, adj) = fit(&s, 0, 29, MIN_CUT_US, MAX_CUT_US).unwrap();
        assert_eq!((a, b), (0, 17));
        assert_eq!(adj.trimmed_end, 12);
        assert!(adj.changed());
        let (_, _, same) = fit(&s, 0, 3, MIN_CUT_US, MAX_CUT_US).unwrap();
        assert!(!same.changed());
    }

    #[test]
    fn impossible_cuts_are_discarded() {
        let huge = [Span {
            start_us: 0,
            end_us: 200 * SECOND_US,
        }];
        assert_eq!(
            fit(&huge, 0, 0, MIN_CUT_US, MAX_CUT_US),
            Err(Discard::TooLong)
        );
        let tiny = spans(1);
        assert_eq!(
            fit(&tiny, 0, 0, MIN_CUT_US, MAX_CUT_US),
            Err(Discard::TooShort)
        );
    }

    fn m(start: i64, end: i64, total: u32, window: usize) -> Merged {
        Merged {
            span: Span {
                start_us: start * SECOND_US,
                end_us: end * SECOND_US,
            },
            total_centi: total,
            windows: vec![window],
            tag: 0,
        }
    }

    #[test]
    fn duplicates_keep_the_best_then_the_shortest_and_remember_windows() {
        // 0–60 e 30–90: interseção de 30 s = 50% do menor (60 s): é o mesmo momento.
        let (kept, absorbed) = merge_duplicates(vec![m(0, 60, 700, 0), m(30, 90, 800, 1)]);
        assert_eq!(absorbed, 1);
        assert_eq!(kept.len(), 1);
        assert_eq!(kept[0].span.start_us, 30 * SECOND_US);
        assert_eq!(kept[0].windows, vec![0, 1]);
        // Empate: fica o mais curto.
        let (kept, _) = merge_duplicates(vec![m(0, 60, 700, 0), m(0, 40, 700, 1)]);
        assert_eq!(kept[0].span.end_us, 40 * SECOND_US);
        // Abaixo de 50% são momentos distintos, ordenados por Nota.
        let (kept, absorbed) = merge_duplicates(vec![m(0, 60, 500, 0), m(31, 91, 900, 1)]);
        assert_eq!(absorbed, 0);
        assert_eq!(kept[0].total_centi, 900);
        assert_eq!(kept[1].total_centi, 500);
    }
}
