//! Testes da simulação offline de políticas de roteamento (#127), sem I/O nem rede.
use clipes_core::selection::{
    benchmark::{GroundTruthClip, SentenceSpan},
    routing_benchmark::{
        simulate_policy, PolicyKind, RoutingSourceInput, RoutingWindowRecord, ScoredCandidateSpan,
    },
};

fn cand(
    start_id: i64,
    end_id: i64,
    start_us: i64,
    end_us: i64,
    total_centi: u32,
) -> ScoredCandidateSpan {
    ScoredCandidateSpan {
        start_id,
        end_id,
        start_us,
        end_us,
        total_centi,
    }
}

fn win(
    window_index: usize,
    start_us: i64,
    end_us: i64,
    schema_valid: bool,
    rules_valid: bool,
    cost_micro_usd: u64,
    duration_ms: u64,
    candidates: Vec<ScoredCandidateSpan>,
) -> RoutingWindowRecord {
    RoutingWindowRecord {
        source_index: 0,
        window_index,
        window_start_us: start_us,
        window_end_us: end_us,
        schema_valid,
        rules_valid,
        error_code: None,
        calls: 1,
        input_tokens: 1000,
        output_tokens: 200,
        cost_micro_usd,
        duration_ms,
        raw_candidates_count: candidates.len(),
        violations: Vec::new(),
        candidates,
    }
}

#[test]
fn offline_policies_reproduce_always_cheap_strong_oracle_cascade_and_two_pass() {
    let sentences: Vec<SentenceSpan> = (1..=12)
        .map(|id| SentenceSpan {
            id,
            start_us: (id - 1) * 10_000_000,
            end_us: id * 10_000_000,
        })
        .collect();
    // 2 Cortes humanos: um na janela 0 (20..50s) e um na janela 1 (80..110s).
    let gt = vec![
        GroundTruthClip {
            start_us: 20_000_000,
            end_us: 50_000_000,
        },
        GroundTruthClip {
            start_us: 80_000_000,
            end_us: 110_000_000,
        },
    ];

    // Janela 0 (0..60s): barato passa na validação e acerta o Corte 0; forte erra o Corte 0.
    // Janela 1 (60..120s): barato falha nas regras determinísticas (rules_valid = false); forte acerta o Corte 1.
    // Janela 2 (120..180s, controle negativo): barato devolve [] válido; forte propõe falso positivo.
    let cheap = vec![
        win(
            0,
            0,
            60_000_000,
            true,
            true,
            100,
            500,
            vec![cand(3, 5, 20_000_000, 50_000_000, 800)],
        ),
        win(1, 60_000_000, 120_000_000, true, false, 100, 500, vec![]),
        win(2, 120_000_000, 180_000_000, true, true, 100, 500, vec![]),
    ];
    let strong = vec![
        win(0, 0, 60_000_000, true, true, 1000, 2000, vec![]),
        win(
            1,
            60_000_000,
            120_000_000,
            true,
            true,
            1000,
            2000,
            vec![cand(9, 11, 80_000_000, 110_000_000, 900)],
        ),
        win(
            2,
            120_000_000,
            180_000_000,
            true,
            true,
            1000,
            2000,
            vec![cand(1, 2, 0, 20_000_000, 400)],
        ),
    ];

    let src = [RoutingSourceInput {
        source_index: 0,
        language: "pt",
        duration_us: 180_000_000,
        ground_truth: &gt,
        sentences: &sentences,
        cheap_windows: &cheap,
        strong_windows: &strong,
    }];

    let always_cheap = simulate_policy(PolicyKind::AlwaysCheap, &src);
    assert_eq!(always_cheap.metrics.recalled_min_50, 1);
    assert_eq!(always_cheap.escalated_windows, 0);
    assert_eq!(always_cheap.total_cost_micro_usd, 300);

    let always_strong = simulate_policy(PolicyKind::AlwaysStrong, &src);
    assert_eq!(always_strong.metrics.recalled_min_50, 1);
    assert_eq!(always_strong.escalated_windows, 3);
    assert_eq!(always_strong.total_cost_micro_usd, 3000);

    // Oráculo: janela 0 -> cheap (acerta Corte 0); janela 1 -> strong (acerta Corte 1); janela 2 -> cheap (sem FP).
    let oracle = simulate_policy(PolicyKind::Oracle, &src);
    assert_eq!(oracle.metrics.recalled_min_50, 2);
    assert_eq!(oracle.metrics.recall_min_50, 1.0);
    assert_eq!(oracle.escalated_windows, 1);
    assert_eq!(oracle.total_cost_micro_usd, 1200);
    assert_eq!(oracle.metrics.mid_sentence_boundaries, 0);

    // Cascata: escala apenas a janela 1 (rules_valid = false), mantendo barato na 0 e na 2.
    let cascade = simulate_policy(PolicyKind::Cascade, &src);
    assert_eq!(cascade.metrics.recalled_min_50, 2);
    assert_eq!(cascade.escalated_windows, 1);
    assert!((cascade.escalation_rate - 1.0 / 3.0).abs() < 1e-9);
    assert_eq!(cascade.total_cost_micro_usd, 1300);
    assert_eq!(cascade.total_duration_ms, 3500);
    assert_eq!(cascade.final_valid_windows, 3);

    // Duas passadas: barato filtra janelas com >=1 candidato válido (apenas janela 0 passa -> forte roda na 0).
    let two_pass = simulate_policy(PolicyKind::TwoPass, &src);
    assert_eq!(two_pass.strong_calls_windows, 1);
    assert_eq!(two_pass.cheap_calls_windows, 3);
    assert_eq!(two_pass.total_cost_micro_usd, 1300);
    assert_eq!(two_pass.metrics.recalled_min_50, 0); // forte não propôs na janela 0
}

#[test]
fn offline_simulation_merges_overlapping_candidates_across_windows() {
    let sentences: Vec<SentenceSpan> = (1..=6)
        .map(|id| SentenceSpan {
            id,
            start_us: (id - 1) * 10_000_000,
            end_us: id * 10_000_000,
        })
        .collect();
    let gt = vec![GroundTruthClip {
        start_us: 10_000_000,
        end_us: 40_000_000,
    }];
    // Duas janelas propõem o mesmo Corte; `merge_duplicates` deve consolidar em 1 candidato.
    let cheap = vec![
        win(
            0,
            0,
            50_000_000,
            true,
            true,
            50,
            100,
            vec![cand(2, 4, 10_000_000, 40_000_000, 750)],
        ),
        win(
            1,
            10_000_000,
            60_000_000,
            true,
            true,
            50,
            100,
            vec![cand(2, 4, 10_000_000, 40_000_000, 820)],
        ),
    ];
    let strong = cheap.clone();
    let src = [RoutingSourceInput {
        source_index: 0,
        language: "en",
        duration_us: 60_000_000,
        ground_truth: &gt,
        sentences: &sentences,
        cheap_windows: &cheap,
        strong_windows: &strong,
    }];

    let res = simulate_policy(PolicyKind::AlwaysCheap, &src);
    assert_eq!(res.metrics.candidates_count, 1);
    assert_eq!(res.metrics.recalled_iou_50, 1);
}
