use super::*;

const SEC: i64 = 1_000_000;
const RATIO: TokenRatio = TokenRatio {
    low: 0.25,
    high: 0.3,
};
/// Cerca de 385 tokens por minuto (12 Frases × 107 caracteres × 0,3).
const DENSE: u64 = 107;

/// Fala contínua: uma Frase de 5 s por vez; `chars` por Frase define a densidade.
fn live(minutes: i64, chars: u64) -> Vec<SentenceSpan> {
    (0..minutes * 12)
        .map(|i| SentenceSpan {
            id: i + 1,
            start_us: i * 5 * SEC,
            end_us: (i + 1) * 5 * SEC,
            chars,
        })
        .collect()
}

fn input(spans: &[SentenceSpan], ctx: u64) -> PlanInput<'_> {
    PlanInput {
        sentences: spans,
        header_chars: 10,
        context: EffectiveContext {
            tokens: ctx,
            origin: ContextOrigin::User,
        },
        ratio: RATIO,
        fixed_tokens: 1_500,
        output_reserve: 1_000,
        reasoning_reserve: 0,
        max_cut_us: DEFAULT_OVERLAP_US,
        price_threshold: None,
    }
}

/// Invariantes que todo plano precisa cumprir.
fn check(spans: &[SentenceSpan], plan: &Plan, overlap: i64) {
    let w = &plan.windows;
    assert_eq!(w[0].first_index, 0);
    assert_eq!(w.last().unwrap().last_index, spans.len() - 1);
    for pair in w.windows(2) {
        let (a, b) = (&pair[0], &pair[1]);
        assert!(b.first_index > a.first_index, "sem progresso");
        assert!(b.first_index <= a.last_index + 1, "lacuna entre Frases");
        assert!(b.last_index > a.last_index);
        // Todo Corte de até `overlap` que cruza o fim de `a` cabe em `b`.
        assert!(
            spans[b.first_index - 1].start_us <= a.end_us - overlap
                || b.first_index == a.last_index + 1
        );
    }
    for win in w {
        assert!(win.end_us - win.start_us <= WINDOW_MAX_US);
        assert_eq!(win.first_id, spans[win.first_index].id);
        assert_eq!(win.last_id, spans[win.last_index].id);
        assert!(win.tokens_high <= plan.input_limit_tokens);
        assert!(win.tokens_low <= win.tokens_high);
    }
}

#[test]
fn contexts_block_reduce_and_fill() {
    let spans = live(120, DENSE);
    let blocked = plan(&input(&spans, 4_096)).unwrap_err();
    assert_eq!(blocked.state(), PlanState::Blocked);
    let reduced = plan(&input(&spans, 8_192)).unwrap();
    assert_eq!(reduced.state, PlanState::Reduced);
    check(&spans, &reduced, DEFAULT_OVERLAP_US);
    let longest = reduced.windows.iter().map(|w| w.end_us - w.start_us).max();
    assert!(longest.unwrap() < WINDOW_MAX_US);
    for ctx in [16_384, 32_768, 1_000_000] {
        let full = plan(&input(&spans, ctx)).unwrap();
        assert_eq!(full.state, PlanState::Full, "{ctx}");
        check(&spans, &full, DEFAULT_OVERLAP_US);
        assert!(full.windows[0].end_us - full.windows[0].start_us >= WINDOW_MAX_US - 5 * SEC);
    }
}

#[test]
fn blocked_message_names_context_origin_and_exits() {
    let spans = live(60, DENSE);
    let mut i = input(&spans, 4_096);
    i.context.origin = ContextOrigin::Fallback;
    let error: CoreError = plan(&i).unwrap_err().into();
    assert_eq!(error.code, "context_too_small");
    assert!(error.message.contains("4096"));
    assert!(error.message.contains("padrão conservador"));
    assert!(error.message.contains("Aumente o contexto no Perfil"));
    assert!(error.message.contains("escolha outro perfil"));
    assert!(!error.message.to_lowercase().contains("forçar"));
}

#[test]
fn lives_of_one_four_and_eleven_hours() {
    for hours in [1, 4, 11] {
        let spans = live(hours * 60, DENSE);
        let started = std::time::Instant::now();
        let full = plan(&input(&spans, 32_768)).unwrap();
        let reduced = plan(&input(&spans, 8_192)).unwrap();
        assert!(started.elapsed() < std::time::Duration::from_secs(2));
        check(&spans, &full, DEFAULT_OVERLAP_US);
        check(&spans, &reduced, DEFAULT_OVERLAP_US);
        assert!(reduced.windows.len() > full.windows.len());
        // 15 min com 3 min de sobreposição avançam cerca de 12 min por janela.
        let expected = (hours * 60 - 3) / 12;
        assert!((expected..=expected + 2).contains(&(full.windows.len() as i64)));
    }
}

#[test]
fn eleven_hour_live_with_tens_of_thousands_of_sentences_is_fast() {
    // 11 h com uma Frase a cada 1,5 s: 26 400 Frases.
    let spans: Vec<_> = (0..26_400)
        .map(|i| SentenceSpan {
            id: i + 1,
            start_us: i * 1_500_000,
            end_us: (i + 1) * 1_500_000 - 1,
            chars: 40,
        })
        .collect();
    let started = std::time::Instant::now();
    let plan = plan(&input(&spans, 16_384)).unwrap();
    assert!(started.elapsed() < std::time::Duration::from_secs(2));
    check(&spans, &plan, DEFAULT_OVERLAP_US);
}

#[test]
fn reasoning_reserve_and_price_threshold_shrink_the_input() {
    let spans = live(120, DENSE);
    let mut i = input(&spans, 8_192);
    i.reasoning_reserve = 3_000;
    assert!(plan(&i).is_err());
    let mut i = input(&spans, 16_384);
    i.reasoning_reserve = 4_000;
    assert_eq!(plan(&i).unwrap().state, PlanState::Full);
    // 85 % de 8 000 = 6 800 tokens de entrada, mesmo com 1 M de contexto.
    let mut i = input(&spans, 1_000_000);
    i.price_threshold = Some(8_000);
    let capped = plan(&i).unwrap();
    assert_eq!(capped.input_limit_tokens, 6_800);
    assert_eq!(capped.state, PlanState::Reduced);
    assert!(capped.windows.iter().all(|w| w.tokens_high <= 6_800));
}

#[test]
fn cut_length_sets_overlap_and_minimum() {
    let spans = live(120, DENSE);
    for minutes in [1, 2, 3, 4, 5] {
        let mut i = input(&spans, 32_768);
        i.max_cut_us = minutes * 60 * SEC;
        let p = plan(&i).unwrap();
        assert_eq!(p.min_window_us, 3 * minutes * 60 * SEC);
        check(&spans, &p, i.max_cut_us);
    }
    // Corte de 5 min: o mínimo é 15 min, igual ao teto; 8192 não comporta.
    let mut i = input(&spans, 8_192);
    i.max_cut_us = MAX_CUT_US;
    assert!(matches!(
        plan(&i).unwrap_err(),
        PlanError::ContextTooSmall { .. }
    ));
    i.max_cut_us = MAX_CUT_US + SEC;
    let error = plan(&i).unwrap_err();
    assert_eq!(error, PlanError::MaxCutTooLong);
    let core: CoreError = error.into();
    assert_eq!(core.code, "max_cut_too_long");
    assert!(core.message.contains("5 min"));
    assert_eq!(MAX_CUT_US, 5 * 60 * SEC);
}

#[test]
fn short_source_is_one_window_and_still_checks_capacity() {
    let spans = live(2, DENSE);
    let p = plan(&input(&spans, 8_192)).unwrap();
    assert_eq!(p.windows.len(), 1);
    assert_eq!((p.windows[0].first_index, p.windows[0].last_index), (0, 23));
    assert_eq!(p.state, PlanState::Full);
    // Dois minutos densos não cabem em 3000 tokens: segue bloqueada.
    assert!(plan(&input(&spans, 3_000)).is_err());
    assert!(plan(&input(&[], 4_096)).unwrap().windows.is_empty());
}

#[test]
fn silence_and_last_window_have_no_gaps_or_loops() {
    // 20 min de fala, 40 min de silêncio, 20 min de fala.
    let mut spans = live(20, DENSE);
    let offset = 60 * 60 * SEC;
    let tail: Vec<_> = live(20, DENSE)
        .into_iter()
        .map(|s| SentenceSpan {
            id: s.id + 1_000,
            start_us: s.start_us + offset,
            end_us: s.end_us + offset,
            ..s
        })
        .collect();
    spans.extend(tail);
    for ctx in [8_192, 32_768] {
        let p = plan(&input(&spans, ctx)).unwrap();
        check(&spans, &p, DEFAULT_OVERLAP_US);
    }
    // Silêncio maior que o teto depois de uma janela curta não trava o planejador.
    let lone = [
        SentenceSpan {
            id: 1,
            start_us: 0,
            end_us: 10 * SEC,
            chars: 50,
        },
        SentenceSpan {
            id: 2,
            start_us: 30 * 60 * SEC,
            end_us: 30 * 60 * SEC + 10 * SEC,
            chars: 50,
        },
    ];
    let p = plan(&input(&lone, 8_192)).unwrap();
    assert_eq!(p.windows.len(), 2);
}

#[test]
fn a_sentence_is_never_split_and_an_oversized_one_blocks() {
    let mut spans = live(60, DENSE);
    spans[100].chars = 100_000;
    let error = plan(&input(&spans, 32_768)).unwrap_err();
    assert!(matches!(error, PlanError::ContextTooSmall { .. }));
    // Frase maior que o teto de duração.
    let long = [SentenceSpan {
        id: 1,
        start_us: 0,
        end_us: 16 * 60 * SEC,
        chars: 10,
    }];
    assert!(plan(&input(&long, 32_768)).is_err());
    // Frase na borda: cada janela termina numa Frase inteira.
    let edge = live(40, DENSE);
    let p = plan(&input(&edge, 32_768)).unwrap();
    check(&edge, &p, DEFAULT_OVERLAP_US);
}

#[test]
fn invalid_input_is_typed() {
    let spans = live(10, DENSE);
    let mut i = input(&spans, 16_384);
    i.max_cut_us = 0;
    assert_eq!(plan(&i).unwrap_err(), PlanError::InvalidInput);
    let mut i = input(&spans, 16_384);
    i.ratio.high = 0.0;
    assert_eq!(plan(&i).unwrap_err(), PlanError::InvalidInput);
    let mut i = input(&spans, 16_384);
    i.ratio.high = f64::NAN;
    assert_eq!(plan(&i).unwrap_err(), PlanError::InvalidInput);
    let mut shuffled = spans.clone();
    shuffled.swap(1, 2);
    assert_eq!(
        plan(&input(&shuffled, 16_384)).unwrap_err(),
        PlanError::InvalidInput
    );
    let mut neg = spans.clone();
    neg[0].start_us = -1;
    assert_eq!(
        plan(&input(&neg, 16_384)).unwrap_err(),
        PlanError::InvalidInput
    );
    let mut inverted = spans.clone();
    inverted[0].end_us = inverted[0].start_us - 1;
    let err = plan(&input(&inverted, 16_384)).unwrap_err();
    assert_eq!(err, PlanError::InvalidInput);
    let core: CoreError = err.into();
    assert_eq!(core.code, "invalid_selection_plan");
    assert!(core.message.contains("tempos negativos"));
    assert!(core.message.contains("IDs de Frase"));
}

#[test]
fn overlapping_and_zero_duration_sentences_normalize_and_plan() {
    let mut spans = live(40, DENSE);
    // Sobreposição de 196 ms entre Frases adjacentes (padrão real do faster-whisper).
    spans[78].start_us = 390_864_000;
    spans[78].end_us = 391_844_000;
    spans[79].start_us = 391_648_000;
    spans[79].end_us = 392_268_000;
    // Frase inteira com duração zero.
    spans[109].start_us = 547_764_000;
    spans[109].end_us = 547_764_000;
    let p = plan(&input(&spans, 16_384)).unwrap();
    assert!(!p.windows.is_empty());
    let mut normalized = spans;
    let mut pairs: Vec<(i64, i64)> = normalized.iter().map(|s| (s.start_us, s.end_us)).collect();
    sentences::normalize_spans(&mut pairs, None).unwrap();
    for (s, (start, end)) in normalized.iter_mut().zip(pairs) {
        s.start_us = start;
        s.end_us = end;
    }
    check(&normalized, &p, DEFAULT_OVERLAP_US);
}

#[test]
fn minute_markers_are_counted_once_per_minute_in_each_window() {
    let spans = live(30, DENSE);
    let with = input(&spans, 1_000_000);
    let mut without = with;
    without.header_chars = 0;
    let (a, b) = (plan(&with).unwrap(), plan(&without).unwrap());
    // 15 min = 15 ou 16 marcadores de 10 caracteres (3 tokens cada).
    let extra = a.windows[0].tokens_high - b.windows[0].tokens_high;
    assert!((45..=51).contains(&extra), "{extra}");
}
