//! Avaliação offline e determinística de seleção de Cortes por sinais (#286 / #283).
//!
//! Mede dois modos exclusivamente no harness do #57 (sem chamadas a Provedor, sem rede e sem
//! gravar texto de Transcrição, nomes de criadores, títulos ou IDs de vídeo):
//! - **Modo A (sem IA):** gera Cortes de 20–180 s (e sensibilidade 10–180 s) alinhados a Frases
//!   via `cut::fit` + `cut::merge_duplicates`, comparando ablações A1..A5 e combinações C1/C2.
//! - **Modo B (pré-filtro para IA):** simula orçamentos de 15%, 25%, 35% e 50% da duração
//!   (janelas do planejador e regiões focadas) e mede cobertura do gabarito e retenção dos acertos
//!   do Codex (`windows_codex_gpt61sol_sample24.json`).

use crate::{
    chat, dispatch,
    energy::{self, EnergyLevel, SILENCE_FLOOR_CENTI},
    projects,
    selection::{
        benchmark::{
            aggregate_metrics, evaluate_source, peaks_with, wilson_ci95, CandidateSpan,
            ChatCalibrationParams, GroundTruthClip, RecallMetrics, SentenceSpan,
        },
        cut::{fit, merge_duplicates, Merged, Span, MAX_CUT_US, MIN_CUT_US, SECOND_US},
        routing_benchmark::RoutingWindowRecord,
    },
    selection_windows::{
        self, ContextOrigin, EffectiveContext, PlanInput, SentenceSpan as PlanSentenceSpan,
        TokenRatio, DEFAULT_REASONING_RESERVE,
    },
    CoreError,
};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::{
    collections::{HashMap, HashSet},
    fs, io,
    path::{Path, PathBuf},
};

const NMS_MIN_GAP_US: i64 = 45 * SECOND_US;
const SENSITIVITY_MIN_CUT_US: i64 = 10 * SECOND_US;
const K_VALUES: [usize; 4] = [5, 10, 15, 20];
const MODE_B_BUDGETS: [f64; 4] = [0.15, 0.25, 0.35, 0.50];

// ---------------------------------------------------------------- entradas puras

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SentenceData {
    pub id: i64,
    pub start_us: i64,
    pub end_us: i64,
    pub text: String,
    pub loudness_centi: Option<i64>,
}

impl SentenceData {
    fn to_span(&self) -> SentenceSpan {
        SentenceSpan {
            id: self.id,
            start_us: self.start_us,
            end_us: self.end_us,
        }
    }
    fn to_cut_span(&self) -> Span {
        Span {
            start_us: self.start_us,
            end_us: self.end_us,
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Serialize, Deserialize)]
pub struct HeatmapPoint {
    pub start_time: f64,
    pub end_time: f64,
    pub value: f64,
}

#[derive(Debug, Clone)]
pub struct DeterministicSourceInput {
    pub source_index: usize,
    pub language: String,
    pub duration_us: i64,
    pub sentences: Vec<SentenceData>,
    pub chat: Option<(i64, Vec<chat::Interval>)>,
    pub heatmap: Vec<HeatmapPoint>,
    pub ground_truth: Vec<GroundTruthClip>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SampleWindowRef {
    pub source_index: usize,
    pub window_index: usize,
    pub start_us: i64,
    pub end_us: i64,
    #[serde(default)]
    pub est_input_tokens: u64,
    #[serde(default)]
    pub overlapping_clip_indices: Vec<usize>,
}

// ---------------------------------------------------------------- métricas e saída

#[derive(Debug, Clone, Copy, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct WilsonCi {
    pub low: f64,
    pub high: f64,
    pub n: usize,
}

impl WilsonCi {
    fn from_counts(hits: usize, total: usize) -> Self {
        let (low, high) = wilson_ci95(hits, total);
        Self {
            low,
            high,
            n: total,
        }
    }
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PrecisionNoiseMetrics {
    pub candidates_count: usize,
    pub candidates_per_hour: f64,
    pub matched_min_50: usize,
    pub matched_iou_30: usize,
    pub precision_min_50: f64,
    pub noise_rate_min_50: f64,
    pub precision_iou_30: f64,
    pub noise_rate_iou_30: f64,
    pub ci_precision_min_50: WilsonCi,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct EvalBlock {
    pub label: String,
    pub hours: f64,
    pub recall: RecallMetrics,
    pub precision_noise: PrecisionNoiseMetrics,
    pub ci_recall_min_50: WilsonCi,
    pub ci_recall_gt_cov_50: WilsonCi,
    pub ci_recall_iou_30: WilsonCi,
    pub ci_recall_iou_50: WilsonCi,
    pub ci_scenes_min_50: WilsonCi,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ArmEvalRow {
    pub arm: String,
    pub min_cut_secs: i64,
    pub k_per_hour: Option<usize>,
    pub scope: String,
    pub full_lives: EvalBlock,
    pub sample_seed57: EvalBlock,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub applicable_subset: Option<EvalBlock>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ModeBWindowRow {
    pub scorer: String,
    pub budget_pct: u32,
    pub full_windows_kept: usize,
    pub full_windows_total: usize,
    pub full_duration_kept_pct: f64,
    pub full_chars_kept_pct: f64,
    pub full_gt_covered_min50: usize,
    pub full_gt_total: usize,
    pub full_gt_recall: f64,
    pub full_scenes_covered: usize,
    pub full_scenes_total: usize,
    pub sample_windows_kept: usize,
    pub sample_windows_total: usize,
    pub sample_gt_covered: usize,
    pub sample_gt_total: usize,
    pub codex_hits_surviving: usize,
    pub codex_hits_baseline: usize,
    pub codex_hit_retention_rate: f64,
    pub codex_input_tokens_kept: u64,
    pub codex_input_tokens_total: u64,
    pub codex_token_savings_pct: f64,
    pub codex_active_ms_kept: u64,
    pub codex_active_ms_total: u64,
    pub codex_time_savings_pct: f64,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ModeBFocusedRow {
    pub scorer: String,
    pub budget_pct: u32,
    pub regions_count_full: usize,
    pub full_duration_kept_pct: f64,
    pub full_raw_chars_kept_pct: f64,
    pub full_planner_tokens_kept_pct: f64,
    pub full_token_savings_vs_planner_pct: f64,
    pub full_gt_covered_min50: usize,
    pub full_gt_covered_gt50: usize,
    pub full_gt_total: usize,
    pub full_gt_recall_gt50: f64,
    pub full_scenes_covered: usize,
    pub full_scenes_total: usize,
    pub sample_duration_kept_pct: f64,
    pub sample_gt_covered_gt50: usize,
    pub sample_gt_total: usize,
    pub codex_hits_surviving: usize,
    pub codex_hits_baseline: usize,
    pub codex_hit_retention_rate: f64,
    pub est_codex_secs_per_hour: f64,
    pub est_time_savings_pct: f64,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SourceSignalSummary {
    pub source_index: usize,
    pub language: String,
    pub hours: f64,
    pub sentences: usize,
    pub ground_truth_clips: usize,
    pub ground_truth_under_20s: usize,
    pub has_chat: bool,
    pub chat_intervals: usize,
    pub has_heatmap: bool,
    pub heatmap_points: usize,
    pub energy_high: usize,
    pub energy_peak: usize,
    pub delta_db_6: usize,
    pub delta_db_9: usize,
    pub post_silence_2s_bursts: usize,
    pub trigger_hits: usize,
    pub question_sentences: usize,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DeterministicEvalReport {
    pub sources_summary: Vec<SourceSignalSummary>,
    pub heatmap_sources_available: usize,
    pub codex_baseline_hits_sample24: usize,
    pub codex_baseline_clips_sample24: usize,
    pub codex_baseline_secs_per_hour: f64,
    pub mode_a_results: Vec<ArmEvalRow>,
    pub mode_b_windows: Vec<ModeBWindowRow>,
    pub mode_b_focused: Vec<ModeBFocusedRow>,
}

// ---------------------------------------------------------------- estatística e geometria

fn overlap_us(a_start: i64, a_end: i64, b_start: i64, b_end: i64) -> i64 {
    (a_end.min(b_end) - a_start.max(b_start)).max(0)
}

fn min_overlap_ratio(a_start: i64, a_end: i64, b_start: i64, b_end: i64) -> f64 {
    let ov = overlap_us(a_start, a_end, b_start, b_end);
    let shortest = (a_end - a_start).min(b_end - b_start);
    if shortest <= 0 {
        0.0
    } else {
        ov as f64 / shortest as f64
    }
}

fn gt_coverage_ratio(gt_start: i64, gt_end: i64, reg_start: i64, reg_end: i64) -> f64 {
    let len = gt_end - gt_start;
    if len <= 0 {
        0.0
    } else {
        overlap_us(gt_start, gt_end, reg_start, reg_end) as f64 / len as f64
    }
}

fn iou(a_start: i64, a_end: i64, b_start: i64, b_end: i64) -> f64 {
    let ov = overlap_us(a_start, a_end, b_start, b_end);
    if ov == 0 {
        return 0.0;
    }
    let union = (a_end.max(b_end) - a_start.min(b_start)).max(1);
    ov as f64 / union as f64
}

fn median_f64(values: &[f64]) -> f64 {
    if values.is_empty() {
        return 0.0;
    }
    let mut sorted = values.to_vec();
    sorted.sort_by(f64::total_cmp);
    let n = sorted.len();
    if n % 2 == 1 {
        sorted[n / 2]
    } else {
        (sorted[n / 2 - 1] + sorted[n / 2]) / 2.0
    }
}

fn mad_f64(values: &[f64], med: f64) -> f64 {
    if values.is_empty() {
        return 0.0;
    }
    let devs: Vec<f64> = values.iter().map(|v| (v - med).abs()).collect();
    median_f64(&devs)
}

fn union_intervals(spans: &[(i64, i64)]) -> Vec<(i64, i64)> {
    let mut s: Vec<(i64, i64)> = spans.iter().copied().filter(|(a, b)| b > a).collect();
    if s.is_empty() {
        return Vec::new();
    }
    s.sort_unstable();
    let mut out = Vec::with_capacity(s.len());
    let (mut cur_a, mut cur_b) = s[0];
    for &(a, b) in &s[1..] {
        if a <= cur_b {
            cur_b = cur_b.max(b);
        } else {
            out.push((cur_a, cur_b));
            cur_a = a;
            cur_b = b;
        }
    }
    out.push((cur_a, cur_b));
    out
}

fn union_duration_us(spans: &[(i64, i64)]) -> i64 {
    union_intervals(spans)
        .into_iter()
        .map(|(a, b)| (b - a).max(0))
        .sum()
}

fn median_u32(values: &mut [u32]) -> f64 {
    values.sort_unstable();
    let n = values.len();
    if n == 0 {
        0.0
    } else if n % 2 == 1 {
        f64::from(values[n / 2])
    } else {
        (f64::from(values[n / 2 - 1]) + f64::from(values[n / 2])) / 2.0
    }
}

// ---------------------------------------------------------------- extração de sinais por Frase

struct ExtractedSignals {
    energy_levels: Vec<EnergyLevel>,
    a1_peak: Vec<f64>,
    a1_high_peak: Vec<f64>,
    a2_audio: Vec<f64>,
    a3_chat_current: Vec<f64>,
    a3_chat_balanced: Vec<f64>,
    a3_chat_enriched: Vec<f64>,
    a4_text: Vec<f64>,
    a5_heatmap: Vec<f64>,
    c1_universal: Vec<f64>,
    c2_live_full: Vec<f64>,
    /// Profundidade TextTiling de fronteira após a Frase `i` (maior = maior mudança de assunto).
    lexical_depth: Vec<f64>,
    question_flags: Vec<bool>,
    summary_delta_6: usize,
    summary_delta_9: usize,
    summary_post_silence_bursts: usize,
    summary_trigger_hits: usize,
}

fn is_stopword(w: &str) -> bool {
    matches!(
        w,
        "que"
            | "não"
            | "nao"
            | "uma"
            | "uns"
            | "umas"
            | "com"
            | "por"
            | "para"
            | "pra"
            | "pro"
            | "dos"
            | "das"
            | "nos"
            | "nas"
            | "ele"
            | "ela"
            | "eles"
            | "elas"
            | "isso"
            | "isto"
            | "aqui"
            | "ali"
            | "mas"
            | "mais"
            | "muito"
            | "como"
            | "então"
            | "entao"
            | "cara"
            | "tipo"
            | "the"
            | "and"
            | "that"
            | "this"
            | "with"
            | "for"
            | "you"
            | "your"
            | "are"
            | "was"
            | "were"
            | "have"
            | "has"
            | "had"
            | "not"
            | "but"
            | "just"
            | "like"
            | "what"
            | "when"
            | "from"
            | "they"
            | "them"
            | "it's"
            | "its"
    )
}

fn tokenize_content(text: &str) -> HashMap<String, f64> {
    let mut tf = HashMap::new();
    for raw in text.split(|c: char| !c.is_alphanumeric()) {
        if raw.chars().count() < 3 {
            continue;
        }
        let lower = raw.to_lowercase();
        if is_stopword(&lower) {
            continue;
        }
        *tf.entry(lower).or_insert(0.0) += 1.0;
    }
    tf
}

fn cosine_tf(a: &HashMap<String, f64>, b: &HashMap<String, f64>) -> f64 {
    if a.is_empty() || b.is_empty() {
        return 0.0;
    }
    let mut dot = 0.0;
    for (k, va) in a {
        if let Some(vb) = b.get(k) {
            dot += va * vb;
        }
    }
    if dot <= 0.0 {
        return 0.0;
    }
    let na: f64 = a.values().map(|v| v * v).sum::<f64>().sqrt();
    let nb: f64 = b.values().map(|v| v * v).sum::<f64>().sqrt();
    if na == 0.0 || nb == 0.0 {
        0.0
    } else {
        (dot / (na * nb)).clamp(0.0, 1.0)
    }
}

/// Calcula a profundidade de fronteira lexical (TextTiling, Hearst 1997) após cada Frase `i`.
fn compute_lexical_depths(sentences: &[SentenceData]) -> Vec<f64> {
    let n = sentences.len();
    if n < 4 {
        return vec![0.0; n];
    }
    let tfs: Vec<HashMap<String, f64>> = sentences
        .iter()
        .map(|s| tokenize_content(&s.text))
        .collect();
    let k = 3_usize;
    let mut sims = vec![0.0_f64; n];
    for i in 0..n.saturating_sub(1) {
        let mut left = HashMap::new();
        for tf in &tfs[i.saturating_sub(k - 1)..=i] {
            for (tok, c) in tf {
                *left.entry(tok.clone()).or_insert(0.0) += *c;
            }
        }
        let mut right = HashMap::new();
        let r_end = (i + k).min(n - 1);
        for tf in &tfs[(i + 1)..=r_end] {
            for (tok, c) in tf {
                *right.entry(tok.clone()).or_insert(0.0) += *c;
            }
        }
        sims[i] = cosine_tf(&left, &right);
    }
    let mut depths = vec![0.0_f64; n];
    for i in 0..n.saturating_sub(1) {
        let mut left_max = sims[i];
        let mut j = i;
        while j > 0 && sims[j - 1] >= sims[j] && i - j < 5 {
            j -= 1;
            left_max = left_max.max(sims[j]);
        }
        let mut right_max = sims[i];
        let mut r = i;
        while r + 1 < n - 1 && sims[r + 1] >= sims[r] && r - i < 5 {
            r += 1;
            right_max = right_max.max(sims[r]);
        }
        depths[i] = (0.5 * (left_max - sims[i]) + 0.5 * (right_max - sims[i])).max(0.0);
    }
    depths
}

fn text_trigger_and_punct_score(text: &str) -> (f64, bool, bool) {
    let lower = text.to_lowercase();
    let meta_triggers = [
        "clipa",
        "clipe",
        "clipou",
        "corta isso",
        "salva isso",
        "grava isso",
        "clip it",
        "clip that",
    ];
    let reaction_phrases = [
        "olha isso",
        "não acredito",
        "nao acredito",
        "meu deus",
        "que isso",
        "impossível",
        "impossivel",
        "mentira",
        "história real",
        "historia real",
        "nunca contei",
        "caralho",
        "puta que pariu",
        "no way",
        "oh my god",
        "what the hell",
        "what the fuck",
        "are you kidding",
        "unbelievable",
        "wait what",
        "bro what",
        "listen to this",
        "true story",
        "never told",
    ];
    let mut score = 0.0_f64;
    let mut hit = false;
    if meta_triggers.iter().any(|p| lower.contains(p)) {
        score += 0.65;
        hit = true;
    }
    if reaction_phrases.iter().any(|p| lower.contains(p)) {
        score += 0.45;
        hit = true;
    }
    let mut laugh_hit = lower.contains("[risos]")
        || lower.contains("(risos)")
        || lower.contains("[laughter]")
        || lower.contains("(laughter)");
    for tok in lower
        .split(|c: char| !c.is_alphanumeric())
        .filter(|t| !t.is_empty())
    {
        if matches!(tok, "wtf" | "omg" | "wth") {
            score += 0.40;
            hit = true;
        }
        if matches!(tok, "lmao" | "lol" | "haha" | "hahaha" | "hehe" | "hehehe")
            || (tok.len() >= 3 && tok.chars().all(|c| c == 'k'))
            || tok.starts_with("rsrs")
        {
            laugh_hit = true;
        }
    }
    if laugh_hit {
        score += 0.35;
        hit = true;
    }
    let has_q = text.contains('?');
    let excl_count = text.chars().filter(|&c| c == '!').count();
    if has_q {
        score += 0.25;
    }
    if excl_count >= 2 {
        score += 0.30;
    } else if excl_count == 1 {
        score += 0.18;
    }
    (score.clamp(0.0, 1.0), hit, has_q)
}

fn project_chat_peaks(
    peaks: &[chat::Peak],
    interval_us: i64,
    delay_us: i64,
    sentences: &[SentenceData],
) -> Vec<f64> {
    let mut scores = vec![0.0_f64; sentences.len()];
    for p in peaks {
        let from = p.interval as i64 * interval_us - delay_us;
        let to = from + interval_us;
        let first = sentences.partition_point(|s| s.end_us <= from);
        let val = (f64::from(p.ratio_tenths) / 50.0).clamp(0.1, 1.0);
        for idx in first..sentences.len() {
            if sentences[idx].start_us >= to {
                break;
            }
            if val > scores[idx] {
                scores[idx] = val;
            }
        }
    }
    scores
}

fn extract_signals(src: &DeterministicSourceInput) -> ExtractedSignals {
    let n = src.sentences.len();
    let loudness_opts: Vec<Option<i64>> = src.sentences.iter().map(|s| s.loudness_centi).collect();
    let energy_levels = energy::levels(&loudness_opts);

    let mut a1_peak = vec![0.0_f64; n];
    let mut a1_high_peak = vec![0.0_f64; n];
    for (i, (&lvl, s)) in energy_levels.iter().zip(src.sentences.iter()).enumerate() {
        let l_norm = s
            .loudness_centi
            .filter(|&v| v > SILENCE_FLOOR_CENTI)
            .map_or(0.0, |v| {
                ((v - SILENCE_FLOOR_CENTI) as f64 / 12_000.0).clamp(0.0, 0.2)
            });
        match lvl {
            EnergyLevel::Peak => {
                a1_peak[i] = 0.8 + l_norm;
                a1_high_peak[i] = 0.8 + l_norm;
            }
            EnergyLevel::High => {
                a1_high_peak[i] = 0.45 + l_norm;
            }
            _ => {}
        }
    }

    // A2: estatísticas robustas da Fonte (loudness + ΔdB + pós-silêncio + WPS)
    let valid_loud: Vec<f64> = src
        .sentences
        .iter()
        .filter_map(|s| s.loudness_centi)
        .filter(|&v| v > SILENCE_FLOOR_CENTI)
        .map(|v| v as f64)
        .collect();
    let med_loud = median_f64(&valid_loud);
    let scale_loud = (1.4826 * mad_f64(&valid_loud, med_loud)).max(150.0);

    let word_counts: Vec<usize> = src
        .sentences
        .iter()
        .map(|s| s.text.split_whitespace().count())
        .collect();
    let wps_vals: Vec<Option<f64>> = src
        .sentences
        .iter()
        .zip(word_counts.iter())
        .map(|(s, &wc)| {
            let dur = s.end_us - s.start_us;
            if wc >= 3 && dur >= 500_000 {
                Some((wc as f64 / (dur as f64 / 1_000_000.0)).min(12.0))
            } else {
                None
            }
        })
        .collect();
    let valid_wps: Vec<f64> = wps_vals.iter().flatten().copied().collect();
    let med_wps = median_f64(&valid_wps);
    let scale_wps = (1.4826 * mad_f64(&valid_wps, med_wps)).max(0.8);

    let mut a2_audio = vec![0.0_f64; n];
    let mut summary_delta_6 = 0_usize;
    let mut summary_delta_9 = 0_usize;
    let mut summary_post_silence_bursts = 0_usize;

    for i in 0..n {
        let loud = src.sentences[i]
            .loudness_centi
            .filter(|&v| v > SILENCE_FLOOR_CENTI);
        let z_loud = loud.map_or(0.0, |v| ((v as f64 - med_loud) / scale_loud).max(0.0));
        let u_loud = (z_loud / 3.5).clamp(0.0, 1.0).max(match energy_levels[i] {
            EnergyLevel::Peak => 0.75,
            EnergyLevel::High => 0.45,
            _ => 0.0,
        });

        // Salto ΔdB contra até 3 Frases válidas anteriores dentro de 30 s.
        let delta_centi = if let Some(cur) = loud {
            let prev: Vec<f64> = (i.saturating_sub(3)..i)
                .filter(|&j| src.sentences[i].start_us - src.sentences[j].end_us <= 30 * SECOND_US)
                .filter_map(|j| {
                    src.sentences[j]
                        .loudness_centi
                        .filter(|&v| v > SILENCE_FLOOR_CENTI)
                        .map(|v| v as f64)
                })
                .collect();
            if prev.is_empty() {
                0
            } else {
                (cur - median_f64(&prev).round() as i64).max(0)
            }
        } else {
            0
        };
        if delta_centi >= 600 {
            summary_delta_6 += 1;
        }
        if delta_centi >= 900 {
            summary_delta_9 += 1;
        }
        let u_delta = (delta_centi as f64 / 1000.0).clamp(0.0, 1.0);

        let gap_before_us = if i > 0 {
            (src.sentences[i].start_us - src.sentences[i - 1].end_us).max(0)
        } else {
            0
        };
        let post_silence = if gap_before_us >= 2 * SECOND_US
            && (delta_centi >= 800 || energy_levels[i] == EnergyLevel::Peak || z_loud >= 2.2)
        {
            summary_post_silence_bursts += 1;
            let gap_factor = if gap_before_us >= 3 * SECOND_US {
                1.0
            } else {
                0.7
            };
            let strength = (delta_centi as f64 / 1000.0)
                .max(z_loud / 3.5)
                .clamp(0.35, 1.0);
            gap_factor * strength
        } else {
            0.0
        };

        let z_wps = wps_vals[i].map_or(0.0, |w| ((w - med_wps) / scale_wps).max(0.0));
        let u_wps = (z_wps / 3.0).clamp(0.0, 1.0);

        let raw = 0.40 * u_loud + 0.30 * u_delta + 0.15 * post_silence + 0.15 * u_wps;
        a2_audio[i] = if word_counts[i] == 0 {
            (raw - 0.25).max(0.0)
        } else {
            raw.clamp(0.0, 1.0)
        };
    }

    // A4: texto determinístico + TextTiling
    let lexical_depth = compute_lexical_depths(&src.sentences);
    let mut a4_text = vec![0.0_f64; n];
    let mut question_flags = vec![false; n];
    let mut summary_trigger_hits = 0_usize;
    for i in 0..n {
        let (mut score, hit, has_q) = text_trigger_and_punct_score(&src.sentences[i].text);
        if hit {
            summary_trigger_hits += 1;
        }
        question_flags[i] = has_q;
        // Pergunta seguida de fala contínua (gancho explicativo).
        if has_q
            && i + 2 < n
            && src.sentences[i + 1].start_us - src.sentences[i].end_us < 2 * SECOND_US
            && src.sentences[i + 2].start_us - src.sentences[i + 1].end_us < 2 * SECOND_US
        {
            score = (score + 0.15).min(1.0);
        }
        a4_text[i] = score;
    }

    // A3: chat (atual, equilibrado #57, enriquecido com aceleração/reação/paid, e gated por áudio)
    let mut a3_chat_current = vec![0.0_f64; n];
    let mut a3_chat_balanced = vec![0.0_f64; n];
    let mut a3_chat_enriched = vec![0.0_f64; n];
    let mut a3_chat_gated = vec![0.0_f64; n];

    if let Some((interval_us, ref series)) = src.chat {
        if !series.is_empty() && interval_us > 0 {
            let cur_peaks = chat::peaks(series, interval_us);
            a3_chat_current = project_chat_peaks(
                &cur_peaks,
                interval_us,
                chat::REACTION_DELAY_US,
                &src.sentences,
            );

            let bal_params = ChatCalibrationParams {
                interval_us,
                median_window_us: 1_200_000_000, // 20 min
                peak_ratio: 1.75,
                baseline_floor: 1.0,
                min_peak_people: 12,
                reaction_delay_us: 20_000_000, // 20 s
            };
            let bal_peaks = peaks_with(series, &bal_params);
            a3_chat_balanced = project_chat_peaks(
                &bal_peaks,
                interval_us,
                bal_params.reaction_delay_us,
                &src.sentences,
            );

            let half = ((bal_params.median_window_us / interval_us.max(1)) / 2).max(1) as usize;
            let mut win_buf = Vec::with_capacity(half * 2 + 1);
            let delay_us = 20_000_000_i64;
            for (b, item) in series.iter().enumerate() {
                if item.people < 8 {
                    continue;
                }
                win_buf.clear();
                win_buf.extend(
                    series[b.saturating_sub(half)..(b + half + 1).min(series.len())]
                        .iter()
                        .map(|x| x.people),
                );
                let baseline = median_u32(&mut win_buf).max(1.0);
                let ratio = f64::from(item.people) / baseline;
                if ratio < 1.5 {
                    continue;
                }
                let prev_people = if b > 0 {
                    series[b - 1].people
                } else {
                    item.people
                };
                let accel = ((f64::from(item.people) - f64::from(prev_people)) / baseline).max(0.0);
                let react_ratio = f64::from(item.laugh + item.surprise + 3 * item.clip)
                    / f64::from(item.messages.max(1));
                let raw = ((ratio - 1.25) / 2.5).clamp(0.0, 1.0)
                    * (1.0 + 0.35 * (accel / 1.5).clamp(0.0, 1.0))
                    * (1.0 + 0.30 * (react_ratio / 0.40).clamp(0.0, 1.0));
                let raw = raw.clamp(0.0, 1.0);

                let paid_local: u32 = series[b.saturating_sub(1)..=(b + 1).min(series.len() - 1)]
                    .iter()
                    .map(|x| x.paid)
                    .sum();
                let is_paid_heavy = paid_local >= 2
                    || (item.paid >= 1
                        && item.messages > 0
                        && f64::from(item.paid) / f64::from(item.messages) >= 0.15);
                let enriched_val = if is_paid_heavy && item.laugh == 0 && item.surprise == 0 {
                    raw * 0.30
                } else {
                    raw
                };

                let from = b as i64 * interval_us - delay_us;
                let to = from + interval_us;
                let first = src.sentences.partition_point(|s| s.end_us <= from);

                let mut max_audio_near = 0.0_f64;
                let a_first = src
                    .sentences
                    .partition_point(|s| s.end_us <= from - 10 * SECOND_US);
                for s_idx in a_first..n {
                    if src.sentences[s_idx].start_us >= to + 10 * SECOND_US {
                        break;
                    }
                    max_audio_near = max_audio_near.max(a2_audio[s_idx]);
                }
                let gated_val = if is_paid_heavy && max_audio_near < 0.35 {
                    raw * 0.30
                } else {
                    raw
                };

                for idx in first..n {
                    if src.sentences[idx].start_us >= to {
                        break;
                    }
                    if enriched_val > a3_chat_enriched[idx] {
                        a3_chat_enriched[idx] = enriched_val;
                    }
                    if gated_val > a3_chat_gated[idx] {
                        a3_chat_gated[idx] = gated_val;
                    }
                }
            }
        }
    }

    // A5: heatmap do YouTube
    let mut a5_heatmap = vec![0.0_f64; n];
    if !src.heatmap.is_empty() {
        let hm_vals: Vec<f64> = src.heatmap.iter().map(|h| h.value).collect();
        let med_hm = median_f64(&hm_vals);
        let scale_hm = (1.4826 * mad_f64(&hm_vals, med_hm)).max(0.05);
        for bucket in &src.heatmap {
            let b_start = (bucket.start_time * 1_000_000.0).round() as i64;
            let b_end = (bucket.end_time * 1_000_000.0).round() as i64;
            let z = ((bucket.value - med_hm) / scale_hm).max(0.0);
            let base = (z / 3.5).clamp(0.0, 1.0);
            if base <= 0.0 {
                continue;
            }
            let b_mid = b_start + (b_end - b_start) / 2;
            let half_b = ((b_end - b_start) / 2).max(1) as f64;
            let first = src.sentences.partition_point(|s| s.end_us <= b_start);
            for idx in first..n {
                if src.sentences[idx].start_us >= b_end {
                    break;
                }
                let s_mid = src.sentences[idx].start_us
                    + (src.sentences[idx].end_us - src.sentences[idx].start_us) / 2;
                let center_bias =
                    1.0 - 0.10 * ((s_mid - b_mid).abs() as f64 / half_b).clamp(0.0, 1.0);
                let val = (base * center_bias).clamp(0.0, 1.0);
                if val > a5_heatmap[idx] {
                    a5_heatmap[idx] = val;
                }
            }
        }
    }

    // C1 = 0.65 * A2 + 0.35 * A4 (sem plataformas)
    let mut c1_universal = vec![0.0_f64; n];
    // C2 = renormalização automática de áudio (0.45) + chat (0.35) + texto (0.20) + heatmap (0.15)
    let has_chat = src.chat.as_ref().is_some_and(|(_, s)| !s.is_empty());
    let has_hm = !src.heatmap.is_empty();
    let w_sum = 0.45 + 0.20 + if has_chat { 0.35 } else { 0.0 } + if has_hm { 0.15 } else { 0.0 };
    let mut c2_live_full = vec![0.0_f64; n];

    for i in 0..n {
        let mut s1 = 0.65 * a2_audio[i] + 0.35 * a4_text[i];
        let mut s2 = (0.45 * a2_audio[i]
            + 0.20 * a4_text[i]
            + if has_chat {
                0.35 * a3_chat_gated[i]
            } else {
                0.0
            }
            + if has_hm { 0.15 * a5_heatmap[i] } else { 0.0 })
            / w_sum;
        if word_counts[i] == 0 {
            s1 = (s1 - 0.20).max(0.0);
            s2 = (s2 - 0.20).max(0.0);
        }
        c1_universal[i] = s1.clamp(0.0, 1.0);
        c2_live_full[i] = s2.clamp(0.0, 1.0);
    }

    ExtractedSignals {
        energy_levels,
        a1_peak,
        a1_high_peak,
        a2_audio,
        a3_chat_current,
        a3_chat_balanced,
        a3_chat_enriched,
        a4_text,
        a5_heatmap,
        c1_universal,
        c2_live_full,
        lexical_depth,
        question_flags,
        summary_delta_6,
        summary_delta_9,
        summary_post_silence_bursts,
        summary_trigger_hits,
    }
}

// ---------------------------------------------------------------- geração de candidatos (Modo A)

#[derive(Debug, Clone, Copy)]
enum ExpandStyle {
    Symmetric20,
    Asymmetric25_15,
    NaturalBoundary,
}

fn select_nms_anchors(
    sentences: &[SentenceData],
    scores: &[f64],
    allowed_range_us: Option<&[(i64, i64)]>,
) -> Vec<(usize, f64)> {
    let mut indexed: Vec<(usize, f64)> = scores
        .iter()
        .copied()
        .enumerate()
        .filter(|&(i, sc)| {
            if sc <= 0.0 {
                return false;
            }
            if let Some(ranges) = allowed_range_us {
                let s = &sentences[i];
                ranges
                    .iter()
                    .any(|&(ra, rb)| overlap_us(s.start_us, s.end_us, ra, rb) > 0)
            } else {
                true
            }
        })
        .collect();
    indexed.sort_by(|a, b| {
        b.1.total_cmp(&a.1)
            .then_with(|| sentences[a.0].start_us.cmp(&sentences[b.0].start_us))
            .then_with(|| a.0.cmp(&b.0))
    });

    let mut picked: Vec<(usize, f64)> = Vec::new();
    for (idx, sc) in indexed {
        let mid = sentences[idx].start_us + (sentences[idx].end_us - sentences[idx].start_us) / 2;
        let too_close = picked.iter().any(|&(p_idx, _)| {
            let p_mid = sentences[p_idx].start_us
                + (sentences[p_idx].end_us - sentences[p_idx].start_us) / 2;
            (mid - p_mid).abs() < NMS_MIN_GAP_US
        });
        if !too_close {
            picked.push((idx, sc));
        }
    }
    picked
}

fn expand_anchor(
    sentences: &[SentenceData],
    signals: &ExtractedSignals,
    anchor: usize,
    style: ExpandStyle,
    min_us: i64,
) -> (usize, usize) {
    let n = sentences.len();
    let a = &sentences[anchor];
    let short_mode = min_us < MIN_CUT_US;
    match style {
        ExpandStyle::Symmetric20 => {
            let half = if short_mode {
                8 * SECOND_US
            } else {
                20 * SECOND_US
            };
            let mid = a.start_us + (a.end_us - a.start_us) / 2;
            let from = mid - half;
            let to = mid + half;
            let start = sentences.partition_point(|s| s.end_us <= from).min(anchor);
            let end = sentences
                .partition_point(|s| s.start_us < to)
                .saturating_sub(1)
                .max(anchor)
                .min(n - 1);
            (start, end)
        }
        ExpandStyle::Asymmetric25_15 => {
            let (back, fwd) = if short_mode {
                (10 * SECOND_US, 6 * SECOND_US)
            } else {
                (25 * SECOND_US, 15 * SECOND_US)
            };
            let from = a.start_us - back;
            let to = a.end_us + fwd;
            let start = sentences.partition_point(|s| s.end_us <= from).min(anchor);
            let end = sentences
                .partition_point(|s| s.start_us < to)
                .saturating_sub(1)
                .max(anchor)
                .min(n - 1);
            (start, end)
        }
        ExpandStyle::NaturalBoundary => {
            // Recua buscando pausa >= 700ms, pergunta (?) ou vale lexical (TextTiling).
            let (min_b, ideal_b, max_b) = if short_mode {
                (18 * SECOND_US, 9 * SECOND_US, 4 * SECOND_US)
            } else {
                (45 * SECOND_US, 25 * SECOND_US, 10 * SECOND_US)
            };
            let min_start_us = a.start_us - min_b;
            let ideal_start_us = a.start_us - ideal_b;
            let max_start_us = a.start_us - max_b;
            let lo = sentences
                .partition_point(|s| s.end_us <= min_start_us)
                .min(anchor);
            let hi = sentences
                .partition_point(|s| s.start_us <= max_start_us)
                .min(anchor);

            let mut best_start = sentences
                .partition_point(|s| s.end_us <= ideal_start_us)
                .min(anchor);
            let mut best_start_q = f64::NEG_INFINITY;
            for idx in lo..=hi {
                let mut q = 0.0_f64;
                if idx > 0 {
                    let gap = sentences[idx].start_us - sentences[idx - 1].end_us;
                    if gap >= 1_200_000 {
                        q += 2.0;
                    } else if gap >= 700_000 {
                        q += 1.2;
                    }
                    q += 2.5 * signals.lexical_depth[idx - 1];
                }
                if signals.question_flags[idx] {
                    q += 1.0;
                }
                let dist_penalty =
                    ((sentences[idx].start_us - ideal_start_us).abs() as f64 / 20_000_000.0) * 0.5;
                let total_q = q - dist_penalty;
                if total_q > best_start_q {
                    best_start_q = total_q;
                    best_start = idx;
                }
            }

            // Avança buscando pausa natural, fechamento ou vale lexical.
            let (min_f, ideal_f, max_f) = if short_mode {
                (3 * SECOND_US, 6 * SECOND_US, 12 * SECOND_US)
            } else {
                (8 * SECOND_US, 15 * SECOND_US, 25 * SECOND_US)
            };
            let min_end_us = a.end_us + min_f;
            let ideal_end_us = a.end_us + ideal_f;
            let max_end_us = a.end_us + max_f;
            let elo = sentences
                .partition_point(|s| s.end_us < min_end_us)
                .max(anchor)
                .min(n - 1);
            let ehi = sentences
                .partition_point(|s| s.start_us <= max_end_us)
                .saturating_sub(1)
                .max(elo)
                .min(n - 1);

            let mut best_end = sentences
                .partition_point(|s| s.start_us < ideal_end_us)
                .saturating_sub(1)
                .max(anchor)
                .min(n - 1);
            let mut best_end_q = f64::NEG_INFINITY;
            for idx in elo..=ehi {
                let mut q = 0.0_f64;
                if idx + 1 < n {
                    let gap = sentences[idx + 1].start_us - sentences[idx].end_us;
                    if gap >= 1_200_000 {
                        q += 2.0;
                    } else if gap >= 700_000 {
                        q += 1.2;
                    }
                    q += 2.5 * signals.lexical_depth[idx];
                }
                let t = sentences[idx].text.trim_end();
                if t.ends_with(['.', '!', '?']) {
                    q += 0.6;
                }
                let dist_penalty =
                    ((sentences[idx].end_us - ideal_end_us).abs() as f64 / 15_000_000.0) * 0.5;
                let total_q = q - dist_penalty;
                if total_q > best_end_q {
                    best_end_q = total_q;
                    best_end = idx;
                }
            }
            (best_start.min(anchor), best_end.max(anchor))
        }
    }
}

struct CandidateGenSpec<'a> {
    style: ExpandStyle,
    min_us: i64,
    max_us: i64,
    allowed_range_us: Option<&'a [(i64, i64)]>,
    top_k_limit: Option<usize>,
}

fn generate_candidates(
    sentences: &[SentenceData],
    signals: &ExtractedSignals,
    scores: &[f64],
    spec: &CandidateGenSpec<'_>,
) -> Vec<CandidateSpan> {
    if sentences.is_empty() {
        return Vec::new();
    }
    let spans: Vec<Span> = sentences.iter().map(SentenceData::to_cut_span).collect();
    let anchors = select_nms_anchors(sentences, scores, spec.allowed_range_us);

    let mut raw: Vec<CandidateSpan> = Vec::with_capacity(anchors.len());
    let mut merged_in: Vec<Merged> = Vec::with_capacity(anchors.len());
    for (anchor_idx, score) in anchors {
        let (s0, e0) = expand_anchor(sentences, signals, anchor_idx, spec.style, spec.min_us);
        let Ok((s, e, _)) = fit(&spans, s0, e0, spec.min_us, spec.max_us) else {
            continue;
        };
        let total_centi = (score.clamp(0.0, 1.0) * 1000.0).round() as u32;
        let tag = raw.len();
        raw.push(CandidateSpan {
            start_id: sentences[s].id,
            end_id: sentences[e].id,
            start_us: sentences[s].start_us,
            end_us: sentences[e].end_us,
        });
        merged_in.push(Merged {
            span: Span {
                start_us: sentences[s].start_us,
                end_us: sentences[e].end_us,
            },
            total_centi,
            windows: vec![0],
            tag,
        });
    }
    let (kept, _) = merge_duplicates(merged_in);
    let iter = kept.into_iter().map(|m| raw[m.tag]);
    match spec.top_k_limit {
        Some(limit) => iter.take(limit).collect(),
        None => iter.collect(),
    }
}

fn compute_precision_noise(
    gt: &[GroundTruthClip],
    candidates: &[CandidateSpan],
    hours: f64,
) -> PrecisionNoiseMetrics {
    let matched_min_50 = candidates
        .iter()
        .filter(|c| {
            gt.iter()
                .any(|g| min_overlap_ratio(g.start_us, g.end_us, c.start_us, c.end_us) >= 0.50)
        })
        .count();
    let matched_iou_30 = candidates
        .iter()
        .filter(|c| {
            gt.iter()
                .any(|g| iou(g.start_us, g.end_us, c.start_us, c.end_us) >= 0.30)
        })
        .count();
    let n = candidates.len();
    let prec_50 = if n == 0 {
        0.0
    } else {
        matched_min_50 as f64 / n as f64
    };
    let prec_30 = if n == 0 {
        0.0
    } else {
        matched_iou_30 as f64 / n as f64
    };
    PrecisionNoiseMetrics {
        candidates_count: n,
        candidates_per_hour: if hours > 0.0 { n as f64 / hours } else { 0.0 },
        matched_min_50,
        matched_iou_30,
        precision_min_50: prec_50,
        noise_rate_min_50: if n == 0 { 0.0 } else { 1.0 - prec_50 },
        precision_iou_30: prec_30,
        noise_rate_iou_30: if n == 0 { 0.0 } else { 1.0 - prec_30 },
        ci_precision_min_50: WilsonCi::from_counts(matched_min_50, n),
    }
}

fn build_eval_block(
    label: &str,
    per_source: &[(Vec<GroundTruthClip>, Vec<CandidateSpan>, i64)],
    sentences_by_src: &[Vec<SentenceSpan>],
) -> EvalBlock {
    let mut recalls = Vec::with_capacity(per_source.len());
    let mut total_matched_50 = 0_usize;
    let mut total_matched_30 = 0_usize;
    let mut total_cands = 0_usize;
    let mut total_dur_us = 0_i64;

    for (idx, (gt, cands, dur_us)) in per_source.iter().enumerate() {
        recalls.push(evaluate_source(gt, cands, &sentences_by_src[idx]));
        let pn = compute_precision_noise(gt, cands, *dur_us as f64 / 3_600_000_000.0);
        total_matched_50 += pn.matched_min_50;
        total_matched_30 += pn.matched_iou_30;
        total_cands += pn.candidates_count;
        total_dur_us += (*dur_us).max(0);
    }

    let recall = aggregate_metrics(&recalls);
    let hours = total_dur_us as f64 / 3_600_000_000.0;
    let prec_50 = if total_cands == 0 {
        0.0
    } else {
        total_matched_50 as f64 / total_cands as f64
    };
    let prec_30 = if total_cands == 0 {
        0.0
    } else {
        total_matched_30 as f64 / total_cands as f64
    };
    EvalBlock {
        label: label.to_owned(),
        hours,
        ci_recall_min_50: WilsonCi::from_counts(recall.recalled_min_50, recall.total_clips),
        ci_recall_gt_cov_50: WilsonCi::from_counts(recall.recalled_gt_cov_50, recall.total_clips),
        ci_recall_iou_30: WilsonCi::from_counts(recall.recalled_iou_30, recall.total_clips),
        ci_recall_iou_50: WilsonCi::from_counts(recall.recalled_iou_50, recall.total_clips),
        ci_scenes_min_50: WilsonCi::from_counts(recall.recalled_scenes_min_50, recall.total_scenes),
        recall,
        precision_noise: PrecisionNoiseMetrics {
            candidates_count: total_cands,
            candidates_per_hour: if hours > 0.0 {
                total_cands as f64 / hours
            } else {
                0.0
            },
            matched_min_50: total_matched_50,
            matched_iou_30: total_matched_30,
            precision_min_50: prec_50,
            noise_rate_min_50: if total_cands == 0 { 0.0 } else { 1.0 - prec_50 },
            precision_iou_30: prec_30,
            noise_rate_iou_30: if total_cands == 0 { 0.0 } else { 1.0 - prec_30 },
            ci_precision_min_50: WilsonCi::from_counts(total_matched_50, total_cands),
        },
    }
}

// ---------------------------------------------------------------- Modo B (pré-filtro)

#[derive(Debug, Clone)]
struct PlannedWin {
    window_index: usize,
    start_us: i64,
    end_us: i64,
    chars: usize,
}

fn plan_full_windows(src: &DeterministicSourceInput) -> Vec<PlannedWin> {
    if src.sentences.is_empty() {
        return Vec::new();
    }
    let spans: Vec<PlanSentenceSpan> = src
        .sentences
        .iter()
        .map(|s| PlanSentenceSpan {
            id: s.id,
            start_us: s.start_us,
            end_us: s.end_us,
            chars: (s.text.len() + 12) as u64,
        })
        .collect();
    let plan = selection_windows::plan(&PlanInput {
        sentences: &spans,
        header_chars: 10,
        context: EffectiveContext {
            tokens: 131_072,
            origin: ContextOrigin::Catalog,
        },
        ratio: TokenRatio {
            low: 0.30,
            high: 0.45,
        },
        fixed_tokens: 1_500,
        output_reserve: 2_000,
        reasoning_reserve: DEFAULT_REASONING_RESERVE,
        max_cut_us: MAX_CUT_US,
        price_threshold: None,
        tokens_per_request: None,
        tokens_per_minute: None,
    });
    match plan {
        Ok(p) => p
            .windows
            .into_iter()
            .enumerate()
            .map(|(w_idx, w)| {
                let chars = src.sentences[w.first_index..=w.last_index]
                    .iter()
                    .map(|s| s.text.len())
                    .sum();
                PlannedWin {
                    window_index: w_idx,
                    start_us: w.start_us,
                    end_us: w.end_us,
                    chars,
                }
            })
            .collect(),
        Err(_) => {
            // Fallback simples por tempo se uma fixture sintética tiver pouca margem.
            vec![PlannedWin {
                window_index: 0,
                start_us: src.sentences.first().unwrap().start_us,
                end_us: src.sentences.last().unwrap().end_us,
                chars: src.sentences.iter().map(|s| s.text.len()).sum(),
            }]
        }
    }
}

fn score_window_top3_nms(
    sentences: &[SentenceData],
    scores: &[f64],
    win_start_us: i64,
    win_end_us: i64,
) -> f64 {
    let anchors = select_nms_anchors(sentences, scores, Some(&[(win_start_us, win_end_us)]));
    anchors.into_iter().take(3).map(|(_, sc)| sc).sum()
}

fn eval_codex_hits(
    sources: &[DeterministicSourceInput],
    sample_windows: &[SampleWindowRef],
    codex_windows: &[RoutingWindowRecord],
    kept_mask: Option<&HashSet<(usize, usize)>>,
) -> (usize, usize, u64, u64) {
    let mut hits = 0_usize;
    let mut total_clips = 0_usize;
    let mut tokens_in = 0_u64;
    let mut active_ms = 0_u64;

    for src in sources {
        let mut clip_indices: Vec<usize> = sample_windows
            .iter()
            .filter(|w| w.source_index == src.source_index)
            .flat_map(|w| w.overlapping_clip_indices.iter().copied())
            .collect();
        clip_indices.sort_unstable();
        clip_indices.dedup();
        let eval_gt: Vec<GroundTruthClip> = clip_indices
            .iter()
            .filter_map(|&ci| src.ground_truth.get(ci).copied())
            .collect();
        total_clips += eval_gt.len();

        let mut merged_in = Vec::new();
        let mut raw = Vec::new();
        for rec in codex_windows
            .iter()
            .filter(|r| r.source_index == src.source_index)
        {
            if let Some(mask) = kept_mask {
                if !mask.contains(&(rec.source_index, rec.window_index)) {
                    continue;
                }
            }
            tokens_in += rec.input_tokens;
            active_ms += rec.duration_ms;
            for c in &rec.candidates {
                let tag = raw.len();
                raw.push(c.to_candidate_span());
                merged_in.push(Merged {
                    span: Span {
                        start_us: c.start_us,
                        end_us: c.end_us,
                    },
                    total_centi: c.total_centi,
                    windows: vec![rec.window_index],
                    tag,
                });
            }
        }
        let (kept, _) = merge_duplicates(merged_in);
        let deduped: Vec<CandidateSpan> = kept.into_iter().map(|m| raw[m.tag]).collect();
        let sents: Vec<SentenceSpan> = src.sentences.iter().map(SentenceData::to_span).collect();
        let m = evaluate_source(&eval_gt, &deduped, &sents);
        hits += m.recalled_min_50;
    }
    (hits, total_clips, tokens_in, active_ms)
}

struct ModeBContext<'a> {
    sources: &'a [DeterministicSourceInput],
    signals: &'a [ExtractedSignals],
    full_windows_by_src: &'a [Vec<PlannedWin>],
    sample_windows: &'a [SampleWindowRef],
    codex_windows: &'a [RoutingWindowRecord],
    codex_hits_base: usize,
    codex_in_total: u64,
    codex_ms_total: u64,
    codex_secs_per_hour: f64,
}

fn evaluate_mode_b_windows(
    scorer_name: &str,
    ctx: &ModeBContext<'_>,
    score_fn: impl Fn(&ExtractedSignals) -> &[f64],
) -> Vec<ModeBWindowRow> {
    let sources = ctx.sources;
    let signals = ctx.signals;
    let full_windows_by_src = ctx.full_windows_by_src;
    let sample_windows = ctx.sample_windows;
    let codex_windows = ctx.codex_windows;
    let (codex_hits_base, codex_in_total, codex_ms_total) =
        (ctx.codex_hits_base, ctx.codex_in_total, ctx.codex_ms_total);
    let total_full_wins: usize = full_windows_by_src.iter().map(Vec::len).sum();
    let total_full_chars: usize = full_windows_by_src.iter().flatten().map(|w| w.chars).sum();
    let total_full_dur: i64 = sources.iter().map(|s| s.duration_us.max(0)).sum();

    let mut rows = Vec::with_capacity(MODE_B_BUDGETS.len());
    for &budget in &MODE_B_BUDGETS {
        let mut kept_full_wins = 0_usize;
        let mut kept_full_chars = 0_usize;
        let mut kept_full_dur = 0_i64;
        let mut full_gt_covered = 0_usize;
        let mut full_gt_total = 0_usize;
        let mut full_scenes_cov = 0_usize;
        let mut full_scenes_tot = 0_usize;

        let mut kept_sample_mask: HashSet<(usize, usize)> = HashSet::new();
        let mut sample_gt_cov = 0_usize;
        let mut sample_gt_tot = 0_usize;

        for (src_idx, src) in sources.iter().enumerate() {
            let scores = score_fn(&signals[src_idx]);
            let mut scored_full: Vec<(&PlannedWin, f64)> = full_windows_by_src[src_idx]
                .iter()
                .map(|w| {
                    (
                        w,
                        score_window_top3_nms(&src.sentences, scores, w.start_us, w.end_us),
                    )
                })
                .collect();
            scored_full.sort_by(|a, b| {
                b.1.total_cmp(&a.1)
                    .then_with(|| a.0.window_index.cmp(&b.0.window_index))
            });
            let take_full = ((budget * scored_full.len() as f64).round() as usize)
                .clamp(1, scored_full.len().max(1));
            let picked_full: Vec<&PlannedWin> = scored_full
                .into_iter()
                .take(take_full)
                .map(|(w, _)| w)
                .collect();
            kept_full_wins += picked_full.len();
            kept_full_chars += picked_full.iter().map(|w| w.chars).sum::<usize>();
            let spans: Vec<(i64, i64)> =
                picked_full.iter().map(|w| (w.start_us, w.end_us)).collect();
            kept_full_dur += union_duration_us(&spans);

            full_gt_total += src.ground_truth.len();
            full_gt_covered += src
                .ground_truth
                .iter()
                .filter(|g| {
                    spans
                        .iter()
                        .any(|&(ws, we)| min_overlap_ratio(g.start_us, g.end_us, ws, we) >= 0.50)
                })
                .count();
            let scenes = crate::selection::benchmark::merge_overlapping_scenes(&src.ground_truth);
            full_scenes_tot += scenes.len();
            full_scenes_cov += scenes
                .iter()
                .filter(|sc| {
                    spans
                        .iter()
                        .any(|&(ws, we)| min_overlap_ratio(sc.start_us, sc.end_us, ws, we) >= 0.50)
                })
                .count();

            // Sample 24 windows
            let mut src_sample: Vec<(&SampleWindowRef, f64)> = sample_windows
                .iter()
                .filter(|w| w.source_index == src.source_index)
                .map(|w| {
                    (
                        w,
                        score_window_top3_nms(&src.sentences, scores, w.start_us, w.end_us),
                    )
                })
                .collect();
            if !src_sample.is_empty() {
                src_sample.sort_by(|a, b| {
                    b.1.total_cmp(&a.1)
                        .then_with(|| a.0.window_index.cmp(&b.0.window_index))
                });
                let take_s = ((budget * src_sample.len() as f64).round() as usize)
                    .clamp(1, src_sample.len());
                let picked_s: Vec<&SampleWindowRef> = src_sample
                    .into_iter()
                    .take(take_s)
                    .map(|(w, _)| w)
                    .collect();
                let s_spans: Vec<(i64, i64)> =
                    picked_s.iter().map(|w| (w.start_us, w.end_us)).collect();
                for w in &picked_s {
                    kept_sample_mask.insert((w.source_index, w.window_index));
                }
                let mut clip_indices: Vec<usize> = sample_windows
                    .iter()
                    .filter(|w| w.source_index == src.source_index)
                    .flat_map(|w| w.overlapping_clip_indices.iter().copied())
                    .collect();
                clip_indices.sort_unstable();
                clip_indices.dedup();
                for ci in clip_indices {
                    if let Some(g) = src.ground_truth.get(ci) {
                        sample_gt_tot += 1;
                        if s_spans.iter().any(|&(ws, we)| {
                            min_overlap_ratio(g.start_us, g.end_us, ws, we) >= 0.50
                        }) {
                            sample_gt_cov += 1;
                        }
                    }
                }
            }
        }

        let (codex_hits_surv, _, codex_in_kept, codex_ms_kept) = eval_codex_hits(
            sources,
            sample_windows,
            codex_windows,
            Some(&kept_sample_mask),
        );
        let tok_kept_frac = if codex_in_total > 0 {
            codex_in_kept as f64 / codex_in_total as f64
        } else {
            0.0
        };
        let time_kept_frac = if codex_ms_total > 0 {
            codex_ms_kept as f64 / codex_ms_total as f64
        } else {
            0.0
        };
        rows.push(ModeBWindowRow {
            scorer: scorer_name.to_owned(),
            budget_pct: (budget * 100.0).round() as u32,
            full_windows_kept: kept_full_wins,
            full_windows_total: total_full_wins,
            full_duration_kept_pct: if total_full_dur > 0 {
                (kept_full_dur as f64 / total_full_dur as f64) * 100.0
            } else {
                0.0
            },
            full_chars_kept_pct: if total_full_chars > 0 {
                (kept_full_chars as f64 / total_full_chars as f64) * 100.0
            } else {
                0.0
            },
            full_gt_covered_min50: full_gt_covered,
            full_gt_total,
            full_gt_recall: if full_gt_total > 0 {
                full_gt_covered as f64 / full_gt_total as f64
            } else {
                0.0
            },
            full_scenes_covered: full_scenes_cov,
            full_scenes_total: full_scenes_tot,
            sample_windows_kept: kept_sample_mask.len(),
            sample_windows_total: sample_windows.len(),
            sample_gt_covered: sample_gt_cov,
            sample_gt_total: sample_gt_tot,
            codex_hits_surviving: codex_hits_surv,
            codex_hits_baseline: codex_hits_base,
            codex_hit_retention_rate: if codex_hits_base > 0 {
                codex_hits_surv as f64 / codex_hits_base as f64
            } else {
                0.0
            },
            codex_input_tokens_kept: codex_in_kept,
            codex_input_tokens_total: codex_in_total,
            codex_token_savings_pct: (1.0 - tok_kept_frac) * 100.0,
            codex_active_ms_kept: codex_ms_kept,
            codex_active_ms_total: codex_ms_total,
            codex_time_savings_pct: (1.0 - time_kept_frac) * 100.0,
        });
    }
    rows
}

fn select_focused_regions(
    sentences: &[SentenceData],
    scores: &[f64],
    budget_us: i64,
    allowed_ranges: Option<&[(i64, i64)]>,
) -> Vec<(i64, i64)> {
    let anchors = select_nms_anchors(sentences, scores, allowed_ranges);
    let mut regions: Vec<(i64, i64)> = Vec::new();
    for (idx, _) in anchors {
        let a = &sentences[idx];
        let from = (a.start_us - 50 * SECOND_US).max(0);
        let to = a.end_us + 55 * SECOND_US;
        let s_idx = sentences.partition_point(|s| s.end_us <= from).min(idx);
        let e_idx = sentences
            .partition_point(|s| s.start_us < to)
            .saturating_sub(1)
            .max(idx)
            .min(sentences.len().saturating_sub(1));
        let candidate = (sentences[s_idx].start_us, sentences[e_idx].end_us);
        let mut next_regions = regions.clone();
        next_regions.push(candidate);
        let merged = union_intervals(&next_regions);
        let dur: i64 = merged.iter().map(|&(a, b)| (b - a).max(0)).sum();
        regions = merged;
        if dur >= budget_us {
            break;
        }
    }
    regions
}

fn chars_in_regions(sentences: &[SentenceData], regions: &[(i64, i64)]) -> usize {
    sentences
        .iter()
        .filter(|s| {
            regions
                .iter()
                .any(|&(ra, rb)| overlap_us(s.start_us, s.end_us, ra, rb) > 0)
        })
        .map(|s| s.text.len())
        .sum()
}

fn evaluate_mode_b_focused(
    scorer_name: &str,
    ctx: &ModeBContext<'_>,
    score_fn: impl Fn(&ExtractedSignals) -> &[f64],
) -> Vec<ModeBFocusedRow> {
    let sources = ctx.sources;
    let signals = ctx.signals;
    let full_windows_by_src = ctx.full_windows_by_src;
    let sample_windows = ctx.sample_windows;
    let codex_windows = ctx.codex_windows;
    let codex_baseline_hits = ctx.codex_hits_base;
    let codex_baseline_secs_per_hour = ctx.codex_secs_per_hour;
    let total_raw_chars: usize = sources
        .iter()
        .map(|s| s.sentences.iter().map(|x| x.text.len()).sum::<usize>())
        .sum();
    let total_planner_chars: usize = full_windows_by_src.iter().flatten().map(|w| w.chars).sum();
    let total_full_dur: i64 = sources.iter().map(|s| s.duration_us.max(0)).sum();

    let mut rows = Vec::with_capacity(MODE_B_BUDGETS.len());
    for &budget in &MODE_B_BUDGETS {
        let mut regions_count = 0_usize;
        let mut kept_full_dur = 0_i64;
        let mut kept_full_chars = 0_usize;
        let mut full_gt_min50 = 0_usize;
        let mut full_gt_gt50 = 0_usize;
        let mut full_gt_tot = 0_usize;
        let mut full_sc_cov = 0_usize;
        let mut full_sc_tot = 0_usize;

        let mut sample_dur_tot = 0_i64;
        let mut sample_dur_kept = 0_i64;
        let mut sample_gt_gt50 = 0_usize;
        let mut sample_gt_tot = 0_usize;
        let mut sample_regions_by_src: Vec<Vec<(i64, i64)>> = Vec::with_capacity(sources.len());

        for (src_idx, src) in sources.iter().enumerate() {
            let scores = score_fn(&signals[src_idx]);
            let budget_us = (src.duration_us.max(0) as f64 * budget).round() as i64;
            let regs = select_focused_regions(&src.sentences, scores, budget_us, None);
            regions_count += regs.len();
            kept_full_dur += union_duration_us(&regs);
            kept_full_chars += chars_in_regions(&src.sentences, &regs);

            full_gt_tot += src.ground_truth.len();
            full_gt_min50 += src
                .ground_truth
                .iter()
                .filter(|g| {
                    regs.iter()
                        .any(|&(ra, rb)| min_overlap_ratio(g.start_us, g.end_us, ra, rb) >= 0.50)
                })
                .count();
            full_gt_gt50 += src
                .ground_truth
                .iter()
                .filter(|g| {
                    regs.iter()
                        .any(|&(ra, rb)| gt_coverage_ratio(g.start_us, g.end_us, ra, rb) >= 0.50)
                })
                .count();
            let scenes = crate::selection::benchmark::merge_overlapping_scenes(&src.ground_truth);
            full_sc_tot += scenes.len();
            full_sc_cov += scenes
                .iter()
                .filter(|sc| {
                    regs.iter()
                        .any(|&(ra, rb)| gt_coverage_ratio(sc.start_us, sc.end_us, ra, rb) >= 0.50)
                })
                .count();

            // Sample windows
            let s_ranges: Vec<(i64, i64)> = sample_windows
                .iter()
                .filter(|w| w.source_index == src.source_index)
                .map(|w| (w.start_us, w.end_us))
                .collect();
            let s_union = union_intervals(&s_ranges);
            let s_dur = union_duration_us(&s_union);
            sample_dur_tot += s_dur;
            let s_budget = (s_dur as f64 * budget).round() as i64;
            let s_regs = select_focused_regions(&src.sentences, scores, s_budget, Some(&s_union));
            sample_dur_kept += union_duration_us(&s_regs);

            let mut clip_indices: Vec<usize> = sample_windows
                .iter()
                .filter(|w| w.source_index == src.source_index)
                .flat_map(|w| w.overlapping_clip_indices.iter().copied())
                .collect();
            clip_indices.sort_unstable();
            clip_indices.dedup();
            for ci in clip_indices {
                if let Some(g) = src.ground_truth.get(ci) {
                    sample_gt_tot += 1;
                    if s_regs
                        .iter()
                        .any(|&(ra, rb)| gt_coverage_ratio(g.start_us, g.end_us, ra, rb) >= 0.50)
                    {
                        sample_gt_gt50 += 1;
                    }
                }
            }
            sample_regions_by_src.push(s_regs);
        }

        // Quantos dos 7 acertos do Codex sobrevivem nas regiões focadas?
        // Um acerto sobrevive se o candidato do Codex que acertou o corte humano (e o próprio corte)
        // cai dentro de alguma região focada mantida (>= 50% de cobertura).
        let mut codex_surv = 0_usize;
        for (src_idx, src) in sources.iter().enumerate() {
            let s_regs = &sample_regions_by_src[src_idx];
            let mut clip_indices: Vec<usize> = sample_windows
                .iter()
                .filter(|w| w.source_index == src.source_index)
                .flat_map(|w| w.overlapping_clip_indices.iter().copied())
                .collect();
            clip_indices.sort_unstable();
            clip_indices.dedup();

            let mut raw = Vec::new();
            let mut merged_in = Vec::new();
            for rec in codex_windows
                .iter()
                .filter(|r| r.source_index == src.source_index)
            {
                for c in &rec.candidates {
                    let tag = raw.len();
                    raw.push(c.to_candidate_span());
                    merged_in.push(Merged {
                        span: Span {
                            start_us: c.start_us,
                            end_us: c.end_us,
                        },
                        total_centi: c.total_centi,
                        windows: vec![rec.window_index],
                        tag,
                    });
                }
            }
            let (kept, _) = merge_duplicates(merged_in);
            let deduped: Vec<CandidateSpan> = kept.into_iter().map(|m| raw[m.tag]).collect();

            for ci in clip_indices {
                let Some(gt) = src.ground_truth.get(ci) else {
                    continue;
                };
                let hitting_cand = deduped.iter().find(|c| {
                    min_overlap_ratio(gt.start_us, gt.end_us, c.start_us, c.end_us) >= 0.50
                });
                if let Some(cand) = hitting_cand {
                    let cand_in_reg = s_regs.iter().any(|&(ra, rb)| {
                        min_overlap_ratio(cand.start_us, cand.end_us, ra, rb) >= 0.50
                    });
                    let gt_in_reg = s_regs
                        .iter()
                        .any(|&(ra, rb)| gt_coverage_ratio(gt.start_us, gt.end_us, ra, rb) >= 0.50);
                    if cand_in_reg && gt_in_reg {
                        codex_surv += 1;
                    }
                }
            }
        }

        let planner_frac = if total_planner_chars > 0 {
            kept_full_chars as f64 / total_planner_chars as f64
        } else {
            0.0
        };
        let dur_kept_pct = if total_full_dur > 0 {
            (kept_full_dur as f64 / total_full_dur as f64) * 100.0
        } else {
            0.0
        };
        rows.push(ModeBFocusedRow {
            scorer: scorer_name.to_owned(),
            budget_pct: (budget * 100.0).round() as u32,
            regions_count_full: regions_count,
            full_duration_kept_pct: dur_kept_pct,
            full_raw_chars_kept_pct: if total_raw_chars > 0 {
                (kept_full_chars as f64 / total_raw_chars as f64) * 100.0
            } else {
                0.0
            },
            full_planner_tokens_kept_pct: planner_frac * 100.0,
            full_token_savings_vs_planner_pct: (1.0 - planner_frac) * 100.0,
            full_gt_covered_min50: full_gt_min50,
            full_gt_covered_gt50: full_gt_gt50,
            full_gt_total: full_gt_tot,
            full_gt_recall_gt50: if full_gt_tot > 0 {
                full_gt_gt50 as f64 / full_gt_tot as f64
            } else {
                0.0
            },
            full_scenes_covered: full_sc_cov,
            full_scenes_total: full_sc_tot,
            sample_duration_kept_pct: if sample_dur_tot > 0 {
                (sample_dur_kept as f64 / sample_dur_tot as f64) * 100.0
            } else {
                0.0
            },
            sample_gt_covered_gt50: sample_gt_gt50,
            sample_gt_total: sample_gt_tot,
            codex_hits_surviving: codex_surv,
            codex_hits_baseline: codex_baseline_hits,
            codex_hit_retention_rate: if codex_baseline_hits > 0 {
                codex_surv as f64 / codex_baseline_hits as f64
            } else {
                0.0
            },
            est_codex_secs_per_hour: codex_baseline_secs_per_hour * planner_frac,
            est_time_savings_pct: (1.0 - planner_frac) * 100.0,
        });
    }
    rows
}

// ---------------------------------------------------------------- orquestração pura

pub fn evaluate_deterministic_all(
    sources: &[DeterministicSourceInput],
    sample_windows: &[SampleWindowRef],
    codex_windows: &[RoutingWindowRecord],
) -> DeterministicEvalReport {
    let signals: Vec<ExtractedSignals> = sources.iter().map(extract_signals).collect();
    let sentences_by_src: Vec<Vec<SentenceSpan>> = sources
        .iter()
        .map(|s| s.sentences.iter().map(SentenceData::to_span).collect())
        .collect();

    let sources_summary: Vec<SourceSignalSummary> = sources
        .iter()
        .zip(signals.iter())
        .map(|(src, sig)| SourceSignalSummary {
            source_index: src.source_index,
            language: src.language.clone(),
            hours: src.duration_us as f64 / 3_600_000_000.0,
            sentences: src.sentences.len(),
            ground_truth_clips: src.ground_truth.len(),
            ground_truth_under_20s: src
                .ground_truth
                .iter()
                .filter(|g| g.end_us - g.start_us < MIN_CUT_US)
                .count(),
            has_chat: src.chat.as_ref().is_some_and(|(_, c)| !c.is_empty()),
            chat_intervals: src.chat.as_ref().map_or(0, |(_, c)| c.len()),
            has_heatmap: !src.heatmap.is_empty(),
            heatmap_points: src.heatmap.len(),
            energy_high: sig
                .energy_levels
                .iter()
                .filter(|&&l| l == EnergyLevel::High)
                .count(),
            energy_peak: sig
                .energy_levels
                .iter()
                .filter(|&&l| l == EnergyLevel::Peak)
                .count(),
            delta_db_6: sig.summary_delta_6,
            delta_db_9: sig.summary_delta_9,
            post_silence_2s_bursts: sig.summary_post_silence_bursts,
            trigger_hits: sig.summary_trigger_hits,
            question_sentences: sig.question_flags.iter().filter(|&&q| q).count(),
        })
        .collect();

    // Prepara intervalos da amostra seed=57 e GT correspondente por Fonte.
    let sample_ranges_by_src: Vec<Vec<(i64, i64)>> = sources
        .iter()
        .map(|src| {
            union_intervals(
                &sample_windows
                    .iter()
                    .filter(|w| w.source_index == src.source_index)
                    .map(|w| (w.start_us, w.end_us))
                    .collect::<Vec<_>>(),
            )
        })
        .collect();
    let sample_gt_by_src: Vec<Vec<GroundTruthClip>> = sources
        .iter()
        .map(|src| {
            let mut idxs: Vec<usize> = sample_windows
                .iter()
                .filter(|w| w.source_index == src.source_index)
                .flat_map(|w| w.overlapping_clip_indices.iter().copied())
                .collect();
            idxs.sort_unstable();
            idxs.dedup();
            idxs.into_iter()
                .filter_map(|ci| src.ground_truth.get(ci).copied())
                .collect()
        })
        .collect();

    struct ArmSpec<'a> {
        name: &'a str,
        style: ExpandStyle,
        scope: &'a str,
        subset_filter: Option<fn(&DeterministicSourceInput) -> bool>,
        k_sweep: bool,
        include_unbounded: bool,
        scores_fn: fn(&ExtractedSignals) -> &[f64],
    }

    fn is_chat_src(s: &DeterministicSourceInput) -> bool {
        s.chat.as_ref().is_some_and(|(_, c)| !c.is_empty())
    }
    fn is_hm_src(s: &DeterministicSourceInput) -> bool {
        !s.heatmap.is_empty()
    }

    let arms: Vec<ArmSpec<'_>> = vec![
        ArmSpec {
            name: "A1_peak_sym",
            style: ExpandStyle::Symmetric20,
            scope: "all",
            subset_filter: None,
            k_sweep: true,
            include_unbounded: true,
            scores_fn: |s| &s.a1_peak,
        },
        ArmSpec {
            name: "A1_peak_asym",
            style: ExpandStyle::Asymmetric25_15,
            scope: "all",
            subset_filter: None,
            k_sweep: true,
            include_unbounded: true,
            scores_fn: |s| &s.a1_peak,
        },
        ArmSpec {
            name: "A1_high_peak_sym",
            style: ExpandStyle::Symmetric20,
            scope: "all",
            subset_filter: None,
            k_sweep: true,
            include_unbounded: true,
            scores_fn: |s| &s.a1_high_peak,
        },
        ArmSpec {
            name: "A1_high_peak_asym",
            style: ExpandStyle::Asymmetric25_15,
            scope: "all",
            subset_filter: None,
            k_sweep: true,
            include_unbounded: true,
            scores_fn: |s| &s.a1_high_peak,
        },
        ArmSpec {
            name: "A2_audio_derived",
            style: ExpandStyle::NaturalBoundary,
            scope: "all",
            subset_filter: None,
            k_sweep: true,
            include_unbounded: false,
            scores_fn: |s| &s.a2_audio,
        },
        ArmSpec {
            name: "A3_chat_current",
            style: ExpandStyle::Asymmetric25_15,
            scope: "chat_sources",
            subset_filter: Some(is_chat_src),
            k_sweep: true,
            include_unbounded: true,
            scores_fn: |s| &s.a3_chat_current,
        },
        ArmSpec {
            name: "A3_chat_balanced_57",
            style: ExpandStyle::Asymmetric25_15,
            scope: "chat_sources",
            subset_filter: Some(is_chat_src),
            k_sweep: true,
            include_unbounded: true,
            scores_fn: |s| &s.a3_chat_balanced,
        },
        ArmSpec {
            name: "A3_chat_enriched",
            style: ExpandStyle::NaturalBoundary,
            scope: "chat_sources",
            subset_filter: Some(is_chat_src),
            k_sweep: true,
            include_unbounded: true,
            scores_fn: |s| &s.a3_chat_enriched,
        },
        ArmSpec {
            name: "A4_text_det",
            style: ExpandStyle::NaturalBoundary,
            scope: "all",
            subset_filter: None,
            k_sweep: true,
            include_unbounded: false,
            scores_fn: |s| &s.a4_text,
        },
        ArmSpec {
            name: "A5_heatmap",
            style: ExpandStyle::Asymmetric25_15,
            scope: "heatmap_sources",
            subset_filter: Some(is_hm_src),
            k_sweep: true,
            include_unbounded: false,
            scores_fn: |s| &s.a5_heatmap,
        },
        ArmSpec {
            name: "C1_universal",
            style: ExpandStyle::NaturalBoundary,
            scope: "all",
            subset_filter: None,
            k_sweep: true,
            include_unbounded: false,
            scores_fn: |s| &s.c1_universal,
        },
        ArmSpec {
            name: "C2_live_full",
            style: ExpandStyle::NaturalBoundary,
            scope: "all",
            subset_filter: None,
            k_sweep: true,
            include_unbounded: false,
            scores_fn: |s| &s.c2_live_full,
        },
    ];

    let mut mode_a_results = Vec::new();
    for min_us in [MIN_CUT_US, SENSITIVITY_MIN_CUT_US] {
        let min_secs = min_us / SECOND_US;
        for arm in &arms {
            let mut k_options: Vec<Option<usize>> = Vec::new();
            if arm.include_unbounded {
                k_options.push(None);
            }
            if arm.k_sweep {
                for &k in &K_VALUES {
                    k_options.push(Some(k));
                }
            }
            for k_opt in k_options {
                let mut full_per_src = Vec::with_capacity(sources.len());
                let mut sample_per_src = Vec::with_capacity(sources.len());
                let mut subset_per_src = Vec::new();
                let mut subset_sents = Vec::new();

                for (idx, src) in sources.iter().enumerate() {
                    let scores = (arm.scores_fn)(&signals[idx]);
                    let full_hours = src.duration_us.max(0) as f64 / 3_600_000_000.0;
                    let full_limit =
                        k_opt.map(|k| ((k as f64) * full_hours).round().max(1.0) as usize);
                    let cands_full = generate_candidates(
                        &src.sentences,
                        &signals[idx],
                        scores,
                        &CandidateGenSpec {
                            style: arm.style,
                            min_us,
                            max_us: MAX_CUT_US,
                            allowed_range_us: None,
                            top_k_limit: full_limit,
                        },
                    );
                    if arm.subset_filter.is_some_and(|pred| pred(src)) {
                        subset_per_src.push((
                            src.ground_truth.clone(),
                            cands_full.clone(),
                            src.duration_us,
                        ));
                        subset_sents.push(sentences_by_src[idx].clone());
                    }
                    full_per_src.push((src.ground_truth.clone(), cands_full, src.duration_us));

                    let s_dur = union_duration_us(&sample_ranges_by_src[idx]);
                    let s_hours = s_dur as f64 / 3_600_000_000.0;
                    let s_limit = k_opt.map(|k| ((k as f64) * s_hours).round().max(1.0) as usize);
                    let cands_sample = if sample_ranges_by_src[idx].is_empty() {
                        Vec::new()
                    } else {
                        generate_candidates(
                            &src.sentences,
                            &signals[idx],
                            scores,
                            &CandidateGenSpec {
                                style: arm.style,
                                min_us,
                                max_us: MAX_CUT_US,
                                allowed_range_us: Some(&sample_ranges_by_src[idx]),
                                top_k_limit: s_limit,
                            },
                        )
                    };
                    sample_per_src.push((sample_gt_by_src[idx].clone(), cands_sample, s_dur));
                }

                let full_lives = build_eval_block("full_lives", &full_per_src, &sentences_by_src);
                let sample_seed57 =
                    build_eval_block("sample_seed57", &sample_per_src, &sentences_by_src);
                let applicable_subset = if !subset_per_src.is_empty() {
                    Some(build_eval_block(arm.scope, &subset_per_src, &subset_sents))
                } else {
                    None
                };

                mode_a_results.push(ArmEvalRow {
                    arm: arm.name.to_owned(),
                    min_cut_secs: min_secs,
                    k_per_hour: k_opt,
                    scope: arm.scope.to_owned(),
                    full_lives,
                    sample_seed57,
                    applicable_subset,
                });
            }
        }
    }

    // Modo B: pré-filtro com C1 e C2
    let full_windows_by_src: Vec<Vec<PlannedWin>> = sources.iter().map(plan_full_windows).collect();
    let (codex_hits_base, codex_clips_base, codex_in_total, codex_ms_total) =
        eval_codex_hits(sources, sample_windows, codex_windows, None);
    let sample_total_hours = sample_ranges_by_src
        .iter()
        .map(|r| union_duration_us(r))
        .sum::<i64>() as f64
        / 3_600_000_000.0;
    let codex_secs_per_hour = if sample_total_hours > 0.0 {
        (codex_ms_total as f64 / 1000.0) / sample_total_hours
    } else {
        0.0
    };

    let mode_b_ctx = ModeBContext {
        sources,
        signals: &signals,
        full_windows_by_src: &full_windows_by_src,
        sample_windows,
        codex_windows,
        codex_hits_base,
        codex_in_total,
        codex_ms_total,
        codex_secs_per_hour,
    };
    let mut mode_b_windows = Vec::new();
    let mut mode_b_focused = Vec::new();
    for (scorer_name, score_fn) in [
        (
            "C1_universal",
            (|s: &ExtractedSignals| s.c1_universal.as_slice()) as fn(&ExtractedSignals) -> &[f64],
        ),
        (
            "C2_live_full",
            (|s: &ExtractedSignals| s.c2_live_full.as_slice()) as fn(&ExtractedSignals) -> &[f64],
        ),
    ] {
        mode_b_windows.extend(evaluate_mode_b_windows(scorer_name, &mode_b_ctx, score_fn));
        mode_b_focused.extend(evaluate_mode_b_focused(scorer_name, &mode_b_ctx, score_fn));
    }

    DeterministicEvalReport {
        heatmap_sources_available: sources.iter().filter(|s| !s.heatmap.is_empty()).count(),
        sources_summary,
        codex_baseline_hits_sample24: codex_hits_base,
        codex_baseline_clips_sample24: codex_clips_base,
        codex_baseline_secs_per_hour: codex_secs_per_hour,
        mode_a_results,
        mode_b_windows,
        mode_b_focused,
    }
}

// ---------------------------------------------------------------- CLI / leitura de projeto isolado

#[derive(Deserialize)]
struct ManifestFile {
    items: Vec<ManifestEntry>,
}

#[derive(Deserialize)]
struct ManifestEntry {
    duration_seconds: i64,
    #[serde(default)]
    idiomas_provisorios: Vec<String>,
    #[serde(default)]
    clips: Vec<ManifestClip>,
}

#[derive(Deserialize)]
struct ManifestClip {
    start: f64,
    end: f64,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct SamplePlanJson {
    sampled_windows: Vec<SampleWindowRef>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct HeatmapFileEntry {
    source_index: usize,
    #[serde(default)]
    points: Vec<HeatmapPoint>,
}

fn flag_val<'a>(args: &'a [String], key: &str) -> Result<&'a str, String> {
    args.windows(2)
        .find(|w| w[0] == key)
        .map(|w| w[1].as_str())
        .ok_or_else(|| format!("parâmetro obrigatório ausente: {key}"))
}

fn flag_opt<'a>(args: &'a [String], key: &str) -> Option<&'a str> {
    args.windows(2).find(|w| w[0] == key).map(|w| w[1].as_str())
}

fn copy_dir_rec(src: &Path, dst: &Path) -> io::Result<()> {
    fs::create_dir_all(dst)?;
    for entry in fs::read_dir(src)? {
        let entry = entry?;
        let ty = entry.file_type()?;
        let to = dst.join(entry.file_name());
        if ty.is_dir() {
            copy_dir_rec(&entry.path(), &to)?;
        } else {
            fs::copy(entry.path(), to)?;
        }
    }
    Ok(())
}

fn call_core(name: &str, args: Value) -> Result<Value, String> {
    dispatch(name, args, &mut |_| {}).map_err(|e: CoreError| format!("{}: {}", e.code, e.message))
}

/// Carrega apenas os campos necessários das Fontes do Projeto aberto (em memória).
pub fn load_sources_from_open_project(
    manifest_path: &Path,
    heatmaps_path: Option<&Path>,
) -> Result<Vec<DeterministicSourceInput>, String> {
    let raw = fs::read(manifest_path).map_err(|e| format!("manifesto ilegível: {e}"))?;
    let manifest: ManifestFile =
        serde_json::from_slice(&raw).map_err(|e| format!("manifesto inválido: {e}"))?;
    let lives: Vec<ManifestEntry> = manifest
        .items
        .into_iter()
        .filter(|i| !i.clips.is_empty())
        .collect();

    let heatmaps_map: HashMap<usize, Vec<HeatmapPoint>> = match heatmaps_path {
        Some(p) => {
            let hraw = fs::read(p).map_err(|e| format!("heatmaps ilegível: {e}"))?;
            let entries: Vec<HeatmapFileEntry> =
                serde_json::from_slice(&hraw).map_err(|e| format!("heatmaps inválido: {e}"))?;
            entries
                .into_iter()
                .map(|e| (e.source_index, e.points))
                .collect()
        }
        None => HashMap::new(),
    };

    let mut out = Vec::with_capacity(lives.len());
    for (idx, item) in lives.iter().enumerate() {
        let source_id = (idx + 1) as i64;
        let duration_us: i64 = projects::with_reader(|c| {
            c.query_row(
                "SELECT duration_us FROM sources WHERE id=?1",
                [source_id],
                |r| r.get(0),
            )
        })
        .unwrap_or(item.duration_seconds * SECOND_US);

        let transcript_id: i64 = projects::with_reader(|c| {
            c.query_row(
                "SELECT id FROM transcripts WHERE source_id=?1 ORDER BY id LIMIT 1",
                [source_id],
                |r| r.get(0),
            )
        })
        .map_err(|e| {
            format!(
                "transcrição ausente para source_{idx}: {}: {}",
                e.code, e.message
            )
        })?;

        let sentences: Vec<SentenceData> = projects::with_reader(|c| {
            let mut q = c.prepare(
                "SELECT s.id, s.start_us, s.end_us, s.text, e.loudness_centi
                 FROM sentences s
                 LEFT JOIN sentence_energy e
                   ON e.transcript_id = s.transcript_id AND e.sentence_id = s.id
                 WHERE s.transcript_id = ?1
                 ORDER BY s.id",
            )?;
            let rows = q.query_map([transcript_id], |r| {
                Ok(SentenceData {
                    id: r.get(0)?,
                    start_us: r.get(1)?,
                    end_us: r.get(2)?,
                    text: r.get(3)?,
                    loudness_centi: r.get(4)?,
                })
            })?;
            rows.collect::<rusqlite::Result<Vec<_>>>()
        })
        .map_err(|e| format!("{}: {}", e.code, e.message))?;

        let stored_chat = chat::load(source_id)
            .map_err(|e| format!("{}: {}", e.code, e.message))?
            .map(|st| (st.interval_us, st.series));

        let gt: Vec<GroundTruthClip> = item
            .clips
            .iter()
            .map(|c| GroundTruthClip {
                start_us: (c.start * 1_000_000.0).round() as i64,
                end_us: (c.end * 1_000_000.0).round() as i64,
            })
            .collect();

        out.push(DeterministicSourceInput {
            source_index: idx,
            language: item
                .idiomas_provisorios
                .first()
                .cloned()
                .unwrap_or_else(|| "en".to_owned()),
            duration_us,
            sentences,
            chat: stored_chat,
            heatmap: heatmaps_map.get(&idx).cloned().unwrap_or_default(),
            ground_truth: gt,
        });
    }
    Ok(out)
}

/// Ponto de entrada do subcomando `deterministic-eval` em `selection_benchmark`.
pub fn run_cli(args: &[String]) -> Result<(), String> {
    if args.len() < 4 {
        return Err(
            "Uso: deterministic-eval <manifest.json> <bench-dir> --sample <sample_plan_112.json> --codex-windows <windows_codex.json> --out <w286_deterministic_eval.json> [--heatmaps <w286_heatmaps.json>] [--project <work-w286.clipes>]"
                .into(),
        );
    }
    let manifest_path = PathBuf::from(&args[0]);
    let bench_dir = PathBuf::from(&args[1]);
    let sample_path = PathBuf::from(flag_val(args, "--sample")?);
    let codex_path = PathBuf::from(flag_val(args, "--codex-windows")?);
    let out_path = PathBuf::from(flag_val(args, "--out")?);
    let heatmaps_path = flag_opt(args, "--heatmaps").map(PathBuf::from);
    let explicit_project = flag_opt(args, "--project").map(PathBuf::from);

    let temp_guard = tempfile::tempdir().map_err(|e| format!("tempdir falhou: {e}"))?;
    let data_dir = temp_guard.path().join("data-w286");
    fs::create_dir_all(&data_dir).map_err(|e| e.to_string())?;
    std::env::set_var("CLIPES_DATA_DIR", &data_dir);

    let work_project = match explicit_project {
        Some(p) => p,
        None => {
            let dst = temp_guard.path().join("work-w286.clipes");
            copy_dir_rec(&bench_dir.join("bench.clipes"), &dst)
                .map_err(|e| format!("falha ao copiar bench.clipes: {e}"))?;
            dst
        }
    };

    call_core("projects.open", json!({ "path": work_project }))?;
    let load_res = load_sources_from_open_project(&manifest_path, heatmaps_path.as_deref());
    let _ = call_core("projects.close", json!({}));
    let sources = load_res?;

    let sample_raw = fs::read(&sample_path).map_err(|e| format!("falha ao ler --sample: {e}"))?;
    let sample_file: SamplePlanJson =
        serde_json::from_slice(&sample_raw).map_err(|e| format!("--sample inválido: {e}"))?;

    let codex_raw =
        fs::read(&codex_path).map_err(|e| format!("falha ao ler --codex-windows: {e}"))?;
    let codex_windows: Vec<RoutingWindowRecord> =
        serde_json::from_slice(&codex_raw).map_err(|e| format!("--codex-windows inválido: {e}"))?;

    let report = evaluate_deterministic_all(&sources, &sample_file.sampled_windows, &codex_windows);
    fs::write(&out_path, serde_json::to_vec_pretty(&report).unwrap())
        .map_err(|e| format!("falha ao gravar saída: {e}"))?;

    println!(
        "deterministic-eval concluído: {} fontes, codex_base={}/{}, salvo em {}",
        report.sources_summary.len(),
        report.codex_baseline_hits_sample24,
        report.codex_baseline_clips_sample24,
        out_path.display()
    );
    Ok(())
}
