//! Simulação offline de políticas de roteamento entre modelos de seleção (#127).
//!
//! Sem I/O, sem rede e sem texto de Transcrição: opera exclusivamente sobre registros por
//! janela (validade de schema, violação de regras, `usage`, custo, latência e candidatos já
//! ajustados por `cut::fit`) para reproduzir `always_cheap`, `always_strong`, `oracle`,
//! `cascade`, `cascade_or_empty` e `two_pass` com o mesmo avaliador do #57.

use crate::selection::benchmark::{
    aggregate_metrics, evaluate_source, wilson_ci95, CandidateSpan, GroundTruthClip, RecallMetrics,
    SentenceSpan,
};
use crate::selection::cut::{merge_duplicates, Merged, Span};
use serde::{Deserialize, Serialize};

/// Candidato de janela já ajustado para fronteiras de Frase, com nota ponderada para desempate.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ScoredCandidateSpan {
    pub start_id: i64,
    pub end_id: i64,
    pub start_us: i64,
    pub end_us: i64,
    pub total_centi: u32,
}

impl ScoredCandidateSpan {
    pub fn to_candidate_span(self) -> CandidateSpan {
        CandidateSpan {
            start_id: self.start_id,
            end_id: self.end_id,
            start_us: self.start_us,
            end_us: self.end_us,
        }
    }
}

/// Registro anônimo de uma chamada de modelo sobre uma Janela de seleção (#127).
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RoutingWindowRecord {
    pub source_index: usize,
    pub window_index: usize,
    pub window_start_us: i64,
    pub window_end_us: i64,
    pub schema_valid: bool,
    pub rules_valid: bool,
    pub error_code: Option<String>,
    pub calls: u64,
    pub input_tokens: u64,
    pub output_tokens: u64,
    pub cost_micro_usd: u64,
    pub duration_ms: u64,
    pub raw_candidates_count: usize,
    pub violations: Vec<String>,
    pub candidates: Vec<ScoredCandidateSpan>,
}

impl RoutingWindowRecord {
    /// Verdadeiro quando a resposta passou no schema completo, nos verificadores e não falhou.
    pub fn passed_validation(&self) -> bool {
        self.schema_valid && self.rules_valid && self.error_code.is_none()
    }
}

/// Políticas de roteamento reproduzidas offline sobre pares `(cheap, strong)` por janela.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum PolicyKind {
    /// Usa sempre o modelo barato/local.
    AlwaysCheap,
    /// Usa sempre o modelo forte.
    AlwaysStrong,
    /// Limite teórico otimista por janela (escolhe por janela quem acerta mais o gabarito).
    Oracle,
    /// Chama o barato; só escala para o forte quando schema ou regras falham.
    Cascade,
    /// Variante diagnóstica: escala quando schema/regras falham ou o barato devolve `[]`.
    CascadeOrEmpty,
    /// Duas passadas: barato filtra janelas com >=1 candidato válido; forte analisa só essas.
    TwoPass,
}

impl PolicyKind {
    pub fn all() -> &'static [PolicyKind] {
        &[
            PolicyKind::AlwaysCheap,
            PolicyKind::AlwaysStrong,
            PolicyKind::Oracle,
            PolicyKind::Cascade,
            PolicyKind::CascadeOrEmpty,
            PolicyKind::TwoPass,
        ]
    }

    pub fn label(self) -> &'static str {
        match self {
            PolicyKind::AlwaysCheap => "always_cheap",
            PolicyKind::AlwaysStrong => "always_strong",
            PolicyKind::Oracle => "oracle",
            PolicyKind::Cascade => "cascade",
            PolicyKind::CascadeOrEmpty => "cascade_or_empty",
            PolicyKind::TwoPass => "two_pass",
        }
    }
}

/// Dados de uma Fonte para simular políticas offline sem texto.
pub struct RoutingSourceInput<'a> {
    pub source_index: usize,
    pub language: &'a str,
    pub duration_us: i64,
    pub ground_truth: &'a [GroundTruthClip],
    pub sentences: &'a [SentenceSpan],
    pub cheap_windows: &'a [RoutingWindowRecord],
    pub strong_windows: &'a [RoutingWindowRecord],
}

/// Intervalo de confiança Wilson 95% serializável.
#[derive(Debug, Clone, Copy, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Ci95 {
    pub low: f64,
    pub high: f64,
    pub n: usize,
}

/// Métricas agregadas de uma política reproduzida offline (#127).
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PolicySummary {
    pub policy: PolicyKind,
    pub policy_name: String,
    pub windows_total: usize,
    pub cheap_calls_windows: usize,
    pub strong_calls_windows: usize,
    pub escalated_windows: usize,
    pub escalation_rate: f64,
    pub final_valid_windows: usize,
    pub final_valid_rate: f64,
    pub cheap_input_tokens: u64,
    pub cheap_output_tokens: u64,
    pub strong_input_tokens: u64,
    pub strong_output_tokens: u64,
    pub total_cost_micro_usd: u64,
    pub mean_cost_micro_usd_per_window: f64,
    pub usd_per_hour: f64,
    pub total_duration_ms: u64,
    pub mean_latency_ms_per_window: f64,
    pub secs_per_hour: f64,
    pub audio_hours: f64,
    pub metrics: RecallMetrics,
    pub ci_min_50: Ci95,
    pub ci_iou_30: Ci95,
    pub ci_scenes_min_50: Ci95,
}

fn overlap(a_start: i64, a_end: i64, b_start: i64, b_end: i64) -> i64 {
    (a_end.min(b_end) - a_start.max(b_start)).max(0)
}

fn min_overlap_ratio(a_start: i64, a_end: i64, b_start: i64, b_end: i64) -> f64 {
    let ov = overlap(a_start, a_end, b_start, b_end);
    let shortest = (a_end - a_start).min(b_end - b_start);
    if shortest <= 0 {
        0.0
    } else {
        ov as f64 / shortest as f64
    }
}

fn iou(a_start: i64, a_end: i64, b_start: i64, b_end: i64) -> f64 {
    let ov = overlap(a_start, a_end, b_start, b_end);
    if ov == 0 {
        return 0.0;
    }
    let union = (a_end.max(b_end) - a_start.min(b_start)).max(1);
    ov as f64 / union as f64
}

/// Pontua a qualidade de um conjunto de candidatos sobre os Cortes humanos que cruzam uma janela.
/// Retorna `(acertos_min50, soma_melhor_iou_em_milesimos, valido)` para desempate determinístico.
fn window_oracle_score(
    candidates: &[ScoredCandidateSpan],
    gt_in_window: &[GroundTruthClip],
    passed: bool,
) -> (usize, i64, u8) {
    if gt_in_window.is_empty() {
        // Janela negativa: prefere saída válida e sem falso positivo.
        let no_fp = i64::from(candidates.is_empty());
        return (0, no_fp, u8::from(passed));
    }
    let mut hits = 0_usize;
    let mut iou_milli = 0_i64;
    for gt in gt_in_window {
        if candidates
            .iter()
            .any(|c| min_overlap_ratio(gt.start_us, gt.end_us, c.start_us, c.end_us) >= 0.50)
        {
            hits += 1;
        }
        let best_iou = candidates
            .iter()
            .map(|c| iou(gt.start_us, gt.end_us, c.start_us, c.end_us))
            .fold(0.0_f64, f64::max);
        iou_milli += (best_iou * 1000.0).round() as i64;
    }
    (hits, iou_milli, u8::from(passed))
}

struct WindowDecision<'a> {
    used_cheap: bool,
    used_strong: bool,
    escalated: bool,
    chosen: Option<&'a RoutingWindowRecord>,
}

fn decide_window<'a>(
    policy: PolicyKind,
    cheap: &'a RoutingWindowRecord,
    strong: &'a RoutingWindowRecord,
    gt_for_source: &[GroundTruthClip],
) -> WindowDecision<'a> {
    match policy {
        PolicyKind::AlwaysCheap => WindowDecision {
            used_cheap: true,
            used_strong: false,
            escalated: false,
            chosen: Some(cheap),
        },
        PolicyKind::AlwaysStrong => WindowDecision {
            used_cheap: false,
            used_strong: true,
            escalated: true,
            chosen: Some(strong),
        },
        PolicyKind::Oracle => {
            let gt_w: Vec<GroundTruthClip> = gt_for_source
                .iter()
                .copied()
                .filter(|g| {
                    overlap(
                        g.start_us,
                        g.end_us,
                        cheap.window_start_us,
                        cheap.window_end_us,
                    ) > 0
                })
                .collect();
            let cheap_score =
                window_oracle_score(&cheap.candidates, &gt_w, cheap.passed_validation());
            let strong_score =
                window_oracle_score(&strong.candidates, &gt_w, strong.passed_validation());
            if strong_score > cheap_score {
                WindowDecision {
                    used_cheap: false,
                    used_strong: true,
                    escalated: true,
                    chosen: Some(strong),
                }
            } else {
                WindowDecision {
                    used_cheap: true,
                    used_strong: false,
                    escalated: false,
                    chosen: Some(cheap),
                }
            }
        }
        PolicyKind::Cascade => {
            if cheap.passed_validation() {
                WindowDecision {
                    used_cheap: true,
                    used_strong: false,
                    escalated: false,
                    chosen: Some(cheap),
                }
            } else {
                WindowDecision {
                    used_cheap: true,
                    used_strong: true,
                    escalated: true,
                    chosen: Some(strong),
                }
            }
        }
        PolicyKind::CascadeOrEmpty => {
            if cheap.passed_validation() && !cheap.candidates.is_empty() {
                WindowDecision {
                    used_cheap: true,
                    used_strong: false,
                    escalated: false,
                    chosen: Some(cheap),
                }
            } else {
                WindowDecision {
                    used_cheap: true,
                    used_strong: true,
                    escalated: true,
                    chosen: Some(strong),
                }
            }
        }
        PolicyKind::TwoPass => {
            if cheap.passed_validation() && !cheap.candidates.is_empty() {
                WindowDecision {
                    used_cheap: true,
                    used_strong: true,
                    escalated: true,
                    chosen: Some(strong),
                }
            } else {
                WindowDecision {
                    used_cheap: true,
                    used_strong: false,
                    escalated: false,
                    chosen: cheap.passed_validation().then_some(cheap),
                }
            }
        }
    }
}

/// Reproduz uma política de roteamento offline sobre um conjunto de Fontes com janelas pareadas.
/// As janelas `cheap_windows` e `strong_windows` de cada Fonte devem corresponder aos mesmos
/// `window_index` (o emparelhamento é feito por `window_index`).
pub fn simulate_policy(policy: PolicyKind, sources: &[RoutingSourceInput<'_>]) -> PolicySummary {
    let mut windows_total = 0_usize;
    let mut cheap_calls_windows = 0_usize;
    let mut strong_calls_windows = 0_usize;
    let mut escalated_windows = 0_usize;
    let mut final_valid_windows = 0_usize;
    let mut cheap_input_tokens = 0_u64;
    let mut cheap_output_tokens = 0_u64;
    let mut strong_input_tokens = 0_u64;
    let mut strong_output_tokens = 0_u64;
    let mut total_cost_micro_usd = 0_u64;
    let mut total_duration_ms = 0_u64;
    let mut total_audio_us = 0_i64;
    let mut per_source_metrics: Vec<RecallMetrics> = Vec::with_capacity(sources.len());

    for src in sources {
        total_audio_us += src.duration_us.max(0);
        let mut raw_spans: Vec<ScoredCandidateSpan> = Vec::new();
        let mut merged_inputs: Vec<Merged> = Vec::new();

        for cheap in src.cheap_windows {
            let Some(strong) = src
                .strong_windows
                .iter()
                .find(|s| s.window_index == cheap.window_index)
            else {
                continue;
            };
            windows_total += 1;
            let dec = decide_window(policy, cheap, strong, src.ground_truth);
            if dec.used_cheap {
                cheap_calls_windows += 1;
                cheap_input_tokens += cheap.input_tokens;
                cheap_output_tokens += cheap.output_tokens;
                total_cost_micro_usd += cheap.cost_micro_usd;
                total_duration_ms += cheap.duration_ms;
            }
            if dec.used_strong {
                strong_calls_windows += 1;
                strong_input_tokens += strong.input_tokens;
                strong_output_tokens += strong.output_tokens;
                total_cost_micro_usd += strong.cost_micro_usd;
                total_duration_ms += strong.duration_ms;
            }
            if dec.escalated {
                escalated_windows += 1;
            }
            if let Some(chosen) = dec.chosen {
                if chosen.passed_validation() {
                    final_valid_windows += 1;
                }
                for cand in &chosen.candidates {
                    let tag = raw_spans.len();
                    raw_spans.push(*cand);
                    merged_inputs.push(Merged {
                        span: Span {
                            start_us: cand.start_us,
                            end_us: cand.end_us,
                        },
                        total_centi: cand.total_centi,
                        windows: vec![cheap.window_index],
                        tag,
                    });
                }
            }
        }

        let (kept, _) = merge_duplicates(merged_inputs);
        let deduped: Vec<CandidateSpan> = kept
            .into_iter()
            .map(|m| raw_spans[m.tag].to_candidate_span())
            .collect();
        per_source_metrics.push(evaluate_source(src.ground_truth, &deduped, src.sentences));
    }

    let metrics = aggregate_metrics(&per_source_metrics);
    let audio_hours = total_audio_us as f64 / 3_600_000_000.0;
    let (ci_m50_l, ci_m50_h) = wilson_ci95(metrics.recalled_min_50, metrics.total_clips);
    let (ci_i30_l, ci_i30_h) = wilson_ci95(metrics.recalled_iou_30, metrics.total_clips);
    let (ci_sc_l, ci_sc_h) = wilson_ci95(metrics.recalled_scenes_min_50, metrics.total_scenes);
    let wt = windows_total.max(1) as f64;

    PolicySummary {
        policy,
        policy_name: policy.label().to_owned(),
        windows_total,
        cheap_calls_windows,
        strong_calls_windows,
        escalated_windows,
        escalation_rate: if windows_total == 0 {
            0.0
        } else {
            escalated_windows as f64 / wt
        },
        final_valid_windows,
        final_valid_rate: if windows_total == 0 {
            0.0
        } else {
            final_valid_windows as f64 / wt
        },
        cheap_input_tokens,
        cheap_output_tokens,
        strong_input_tokens,
        strong_output_tokens,
        total_cost_micro_usd,
        mean_cost_micro_usd_per_window: if windows_total == 0 {
            0.0
        } else {
            total_cost_micro_usd as f64 / wt
        },
        usd_per_hour: if audio_hours > 0.0 {
            (total_cost_micro_usd as f64 / 1_000_000.0) / audio_hours
        } else {
            0.0
        },
        total_duration_ms,
        mean_latency_ms_per_window: if windows_total == 0 {
            0.0
        } else {
            total_duration_ms as f64 / wt
        },
        secs_per_hour: if audio_hours > 0.0 {
            (total_duration_ms as f64 / 1000.0) / audio_hours
        } else {
            0.0
        },
        audio_hours,
        metrics,
        ci_min_50: Ci95 {
            low: ci_m50_l,
            high: ci_m50_h,
            n: metrics.total_clips,
        },
        ci_iou_30: Ci95 {
            low: ci_i30_l,
            high: ci_i30_h,
            n: metrics.total_clips,
        },
        ci_scenes_min_50: Ci95 {
            low: ci_sc_l,
            high: ci_sc_h,
            n: metrics.total_scenes,
        },
    }
}
