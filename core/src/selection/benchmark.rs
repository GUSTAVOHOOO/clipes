//! Métricas puras e calibração offline do benchmark de seleção (#57).
//!
//! Sem I/O, sem rede e sem texto de Transcrição: recebe apenas intervalos em microssegundos,
//! séries agregadas de chat e contagens de custo/tempo para calcular recall, bordas no meio de
//! Frase, tempo/custo por hora e calibração dos parâmetros de pico de chat.

use crate::{
    ai_task::TaskInput,
    chat::{self, Interval, Peak},
    energy,
    provider::EstimateHint,
    selection::{
        self,
        cut::{target_candidates, PREFERRED_MAX_US},
        Range, VideoKind,
    },
    sentences::{self, Marks, Sentence, SentenceMarks},
};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::collections::HashMap;

/// Intervalo de um Corte humano de referência (em µs na Fonte).
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GroundTruthClip {
    pub start_us: i64,
    pub end_us: i64,
}

/// Intervalo de um Corte candidato proposto pelo núcleo (em µs e IDs de Frase).
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CandidateSpan {
    pub start_id: i64,
    pub end_id: i64,
    pub start_us: i64,
    pub end_us: i64,
}

/// Intervalo de uma Frase da Transcrição (em µs na Fonte).
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SentenceSpan {
    pub id: i64,
    pub start_us: i64,
    pub end_us: i64,
}

/// Métricas agregadas de recall e respeito às bordas de Frase.
#[derive(Debug, Clone, Copy, Default, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RecallMetrics {
    pub total_clips: usize,
    pub recalled_min_50: usize,
    pub recalled_gt_cov_50: usize,
    pub recalled_iou_30: usize,
    pub recalled_iou_50: usize,
    pub recall_min_50: f64,
    pub recall_gt_cov_50: f64,
    pub recall_iou_30: f64,
    pub recall_iou_50: f64,
    pub total_scenes: usize,
    pub recalled_scenes_min_50: usize,
    pub recalled_scenes_iou_30: usize,
    pub recalled_scenes_iou_50: usize,
    pub recall_scenes_min_50: f64,
    pub recall_scenes_iou_30: f64,
    pub recall_scenes_iou_50: f64,
    pub candidates_count: usize,
    pub mid_sentence_boundaries: usize,
    pub mid_sentence_boundary_rate: f64,
}

fn overlap_us(a_start: i64, a_end: i64, b_start: i64, b_end: i64) -> i64 {
    (a_end.min(b_end) - a_start.max(b_start)).max(0)
}

fn iou(a_start: i64, a_end: i64, b_start: i64, b_end: i64) -> f64 {
    let ov = overlap_us(a_start, a_end, b_start, b_end);
    if ov == 0 {
        return 0.0;
    }
    let union = (a_end.max(b_end) - a_start.min(b_start)).max(1);
    ov as f64 / union as f64
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

fn gt_coverage(gt_start: i64, gt_end: i64, cand_start: i64, cand_end: i64) -> f64 {
    let len = gt_end - gt_start;
    if len <= 0 {
        0.0
    } else {
        overlap_us(gt_start, gt_end, cand_start, cand_end) as f64 / len as f64
    }
}

/// Une Cortes humanos sobrepostos da mesma Fonte em cenas únicas, para medir recall sem
/// inflar ou diluir publicações duplicadas da mesma cena.
pub fn merge_overlapping_scenes(clips: &[GroundTruthClip]) -> Vec<GroundTruthClip> {
    let mut sorted = clips.to_vec();
    sorted.sort_by_key(|c| (c.start_us, c.end_us));
    let mut merged: Vec<GroundTruthClip> = Vec::new();
    for clip in sorted {
        if clip.end_us <= clip.start_us {
            continue;
        }
        if let Some(last) = merged.last_mut() {
            if clip.start_us < last.end_us {
                last.end_us = last.end_us.max(clip.end_us);
                continue;
            }
        }
        merged.push(clip);
    }
    merged
}

/// Conta quantos candidatos têm início ou fim no meio de alguma Frase ou fora dos limites exatos
/// das Frases `start_id` e `end_id`. Meta do #57: 0%.
pub fn mid_sentence_boundary_count(
    candidates: &[CandidateSpan],
    sentences: &[SentenceSpan],
) -> usize {
    let find_sentence = |id: i64| {
        sentences
            .binary_search_by_key(&id, |s| s.id)
            .ok()
            .map(|idx| sentences[idx])
    };
    let inside_any_sentence = |edge_us: i64| {
        sentences
            .iter()
            .any(|s| s.start_us < edge_us && edge_us < s.end_us)
    };
    candidates
        .iter()
        .filter(|c| {
            let start_ok = find_sentence(c.start_id).is_some_and(|s| s.start_us == c.start_us);
            let end_ok = find_sentence(c.end_id).is_some_and(|s| s.end_us == c.end_us);
            !start_ok || !end_ok || inside_any_sentence(c.start_us) || inside_any_sentence(c.end_us)
        })
        .count()
}

fn rate(num: usize, den: usize) -> f64 {
    if den == 0 {
        0.0
    } else {
        num as f64 / den as f64
    }
}

fn finalize_rates(mut m: RecallMetrics) -> RecallMetrics {
    m.recall_min_50 = rate(m.recalled_min_50, m.total_clips);
    m.recall_gt_cov_50 = rate(m.recalled_gt_cov_50, m.total_clips);
    m.recall_iou_30 = rate(m.recalled_iou_30, m.total_clips);
    m.recall_iou_50 = rate(m.recalled_iou_50, m.total_clips);
    m.recall_scenes_min_50 = rate(m.recalled_scenes_min_50, m.total_scenes);
    m.recall_scenes_iou_30 = rate(m.recalled_scenes_iou_30, m.total_scenes);
    m.recall_scenes_iou_50 = rate(m.recalled_scenes_iou_50, m.total_scenes);
    m.mid_sentence_boundary_rate = rate(m.mid_sentence_boundaries, m.candidates_count);
    m
}

/// Avalia recall e bordas de uma Fonte contra os Cortes humanos revisados.
pub fn evaluate_source(
    ground_truth: &[GroundTruthClip],
    candidates: &[CandidateSpan],
    sentences: &[SentenceSpan],
) -> RecallMetrics {
    let mut m = RecallMetrics {
        total_clips: ground_truth.len(),
        candidates_count: candidates.len(),
        mid_sentence_boundaries: mid_sentence_boundary_count(candidates, sentences),
        ..Default::default()
    };
    for gt in ground_truth {
        if candidates
            .iter()
            .any(|c| min_overlap_ratio(gt.start_us, gt.end_us, c.start_us, c.end_us) >= 0.50)
        {
            m.recalled_min_50 += 1;
        }
        if candidates
            .iter()
            .any(|c| gt_coverage(gt.start_us, gt.end_us, c.start_us, c.end_us) >= 0.50)
        {
            m.recalled_gt_cov_50 += 1;
        }
        if candidates
            .iter()
            .any(|c| iou(gt.start_us, gt.end_us, c.start_us, c.end_us) >= 0.30)
        {
            m.recalled_iou_30 += 1;
        }
        if candidates
            .iter()
            .any(|c| iou(gt.start_us, gt.end_us, c.start_us, c.end_us) >= 0.50)
        {
            m.recalled_iou_50 += 1;
        }
    }
    let scenes = merge_overlapping_scenes(ground_truth);
    m.total_scenes = scenes.len();
    for sc in &scenes {
        if candidates
            .iter()
            .any(|c| min_overlap_ratio(sc.start_us, sc.end_us, c.start_us, c.end_us) >= 0.50)
        {
            m.recalled_scenes_min_50 += 1;
        }
        if candidates
            .iter()
            .any(|c| iou(sc.start_us, sc.end_us, c.start_us, c.end_us) >= 0.30)
        {
            m.recalled_scenes_iou_30 += 1;
        }
        if candidates
            .iter()
            .any(|c| iou(sc.start_us, sc.end_us, c.start_us, c.end_us) >= 0.50)
        {
            m.recalled_scenes_iou_50 += 1;
        }
    }
    finalize_rates(m)
}

/// Soma contagens de várias Fontes e recalcula as taxas agregadas.
pub fn aggregate_metrics(sources: &[RecallMetrics]) -> RecallMetrics {
    let mut sum = RecallMetrics::default();
    for s in sources {
        sum.total_clips += s.total_clips;
        sum.recalled_min_50 += s.recalled_min_50;
        sum.recalled_gt_cov_50 += s.recalled_gt_cov_50;
        sum.recalled_iou_30 += s.recalled_iou_30;
        sum.recalled_iou_50 += s.recalled_iou_50;
        sum.total_scenes += s.total_scenes;
        sum.recalled_scenes_min_50 += s.recalled_scenes_min_50;
        sum.recalled_scenes_iou_30 += s.recalled_scenes_iou_30;
        sum.recalled_scenes_iou_50 += s.recalled_scenes_iou_50;
        sum.candidates_count += s.candidates_count;
        sum.mid_sentence_boundaries += s.mid_sentence_boundaries;
    }
    finalize_rates(sum)
}

/// Parâmetros calibráveis da detecção de picos de chat (#57 / #151).
#[derive(Debug, Clone, Copy, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ChatCalibrationParams {
    pub interval_us: i64,
    pub median_window_us: i64,
    pub peak_ratio: f64,
    pub baseline_floor: f64,
    pub min_peak_people: u32,
    pub reaction_delay_us: i64,
}

impl Default for ChatCalibrationParams {
    fn default() -> Self {
        Self {
            interval_us: chat::INTERVAL_US,
            median_window_us: chat::MEDIAN_WINDOW_US,
            peak_ratio: chat::PEAK_RATIO,
            baseline_floor: chat::BASELINE_FLOOR,
            min_peak_people: chat::MIN_PEAK_PEOPLE,
            reaction_delay_us: chat::REACTION_DELAY_US,
        }
    }
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

fn compute_baselines(series: &[Interval], params: &ChatCalibrationParams) -> Vec<f64> {
    let half = ((params.median_window_us / params.interval_us.max(1)) / 2).max(1) as usize;
    let mut window: Vec<u32> = Vec::with_capacity(half * 2 + 1);
    (0..series.len())
        .map(|i| {
            window.clear();
            window.extend(
                series[i.saturating_sub(half)..(i + half + 1).min(series.len())]
                    .iter()
                    .map(|x| x.people),
            );
            median_u32(&mut window).max(params.baseline_floor)
        })
        .collect()
}

fn peaks_from_baselines(
    series: &[Interval],
    baselines: &[f64],
    params: &ChatCalibrationParams,
) -> Vec<Peak> {
    let mut out = Vec::new();
    for (i, (interval, &baseline)) in series.iter().zip(baselines.iter()).enumerate() {
        if interval.people < params.min_peak_people {
            continue;
        }
        let ratio = f64::from(interval.people) / baseline;
        if ratio >= params.peak_ratio {
            out.push(Peak {
                interval: i,
                people: interval.people,
                ratio_tenths: (ratio * 10.0).round() as u32,
                reaction: interval.dominant(),
            });
        }
    }
    out
}

/// Espelha a lógica de `chat::peaks` com parâmetros configuráveis, para calibração offline sem
/// alterar as constantes de `core/src/chat.rs`.
pub fn peaks_with(series: &[Interval], params: &ChatCalibrationParams) -> Vec<Peak> {
    let half = ((params.median_window_us / params.interval_us.max(1)) / 2).max(1) as usize;
    let mut out = Vec::new();
    let mut window: Vec<u32> = Vec::new();
    for (i, interval) in series.iter().enumerate() {
        if interval.people < params.min_peak_people {
            continue;
        }
        window.clear();
        window.extend(
            series[i.saturating_sub(half)..(i + half + 1).min(series.len())]
                .iter()
                .map(|x| x.people),
        );
        let baseline = median_u32(&mut window).max(params.baseline_floor);
        let ratio = f64::from(interval.people) / baseline;
        if ratio >= params.peak_ratio {
            out.push(Peak {
                interval: i,
                people: interval.people,
                ratio_tenths: (ratio * 10.0).round() as u32,
                reaction: interval.dominant(),
            });
        }
    }
    out
}

/// Resultado da avaliação do sinal de chat contra Cortes humanos numa configuração.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ChatSignalEvaluation {
    pub params: ChatCalibrationParams,
    pub total_clips: usize,
    pub clips_hit: usize,
    pub recall: f64,
    pub total_peaks: usize,
    pub signal_peaks: usize,
    /// Picos de chat que não caíram em nenhum Corte humano (raid, sorteio, trem de subs etc.).
    pub noise_peaks: usize,
    pub noise_rate: f64,
    pub precision: f64,
    pub f1: f64,
}

fn evaluate_chat_peaks(
    peaks: &[Peak],
    clips: &[GroundTruthClip],
    params: &ChatCalibrationParams,
    tolerance_us: i64,
) -> ChatSignalEvaluation {
    let peak_spans: Vec<(i64, i64)> = peaks
        .iter()
        .map(|p| {
            let from = p.interval as i64 * params.interval_us - params.reaction_delay_us;
            let to = from + params.interval_us;
            (from, to)
        })
        .collect();
    let clips_hit = clips
        .iter()
        .filter(|c| {
            let cs = c.start_us - tolerance_us;
            let ce = c.end_us + tolerance_us;
            peak_spans
                .iter()
                .any(|&(ps, pe)| overlap_us(cs, ce, ps, pe) > 0)
        })
        .count();
    let signal_peaks = peak_spans
        .iter()
        .filter(|&&(ps, pe)| {
            clips
                .iter()
                .any(|c| overlap_us(c.start_us - tolerance_us, c.end_us + tolerance_us, ps, pe) > 0)
        })
        .count();
    let total_peaks = peak_spans.len();
    let noise_peaks = total_peaks.saturating_sub(signal_peaks);
    let recall = rate(clips_hit, clips.len());
    let precision = rate(signal_peaks, total_peaks);
    let f1 = if recall + precision > 0.0 {
        2.0 * recall * precision / (recall + precision)
    } else {
        0.0
    };
    ChatSignalEvaluation {
        params: *params,
        total_clips: clips.len(),
        clips_hit,
        recall,
        total_peaks,
        signal_peaks,
        noise_peaks,
        noise_rate: rate(noise_peaks, total_peaks),
        precision,
        f1,
    }
}

/// Avalia quantos Cortes humanos recebem pelo menos um pico de chat deslocado pelo atraso de
/// reação (`[início - atraso, fim - atraso)`) e quantos picos caem fora de todo Corte humano.
pub fn evaluate_chat_signal(
    series: &[Interval],
    clips: &[GroundTruthClip],
    params: &ChatCalibrationParams,
    tolerance_us: i64,
) -> ChatSignalEvaluation {
    let peaks = peaks_with(series, params);
    evaluate_chat_peaks(&peaks, clips, params, tolerance_us)
}

/// Linha da busca em grade sobre múltiplas Fontes com replay de chat, incluindo a variância
/// entre Fontes (mínimo e máximo do recall por Fonte).
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ChatGridRow {
    pub aggregate: ChatSignalEvaluation,
    pub per_source_recall_min: f64,
    pub per_source_recall_max: f64,
    pub per_source_recalls: Vec<f64>,
}

pub fn grid_search_chat(
    sources: &[(&[Interval], &[GroundTruthClip])],
    grid: &[ChatCalibrationParams],
    tolerance_us: i64,
) -> Vec<ChatGridRow> {
    type BaselineKey = (i64, i64, u64);
    type PeakKey = (i64, i64, u64, u64, u32);
    // Cache de baselines (medianas) e de picos por parâmetro que não depende de `reaction_delay_us`.
    let mut baseline_cache: HashMap<BaselineKey, Vec<Vec<f64>>> = HashMap::new();
    let mut peak_cache: HashMap<PeakKey, Vec<Vec<Peak>>> = HashMap::new();

    let mut rows = Vec::with_capacity(grid.len());
    for params in grid {
        let base_key = (
            params.interval_us,
            params.median_window_us,
            params.baseline_floor.to_bits(),
        );
        let peak_key = (
            params.interval_us,
            params.median_window_us,
            params.baseline_floor.to_bits(),
            params.peak_ratio.to_bits(),
            params.min_peak_people,
        );
        let per_source_peaks = peak_cache.entry(peak_key).or_insert_with(|| {
            let baselines = baseline_cache.entry(base_key).or_insert_with(|| {
                sources
                    .iter()
                    .map(|(series, _)| compute_baselines(series, params))
                    .collect()
            });
            sources
                .iter()
                .zip(baselines.iter())
                .map(|((series, _), base)| peaks_from_baselines(series, base, params))
                .collect()
        });

        let mut total_clips = 0;
        let mut clips_hit = 0;
        let mut total_peaks = 0;
        let mut signal_peaks = 0;
        let mut per_source_recalls = Vec::with_capacity(sources.len());
        for ((_, clips), peaks) in sources.iter().zip(per_source_peaks.iter()) {
            let ev = evaluate_chat_peaks(peaks, clips, params, tolerance_us);
            total_clips += ev.total_clips;
            clips_hit += ev.clips_hit;
            total_peaks += ev.total_peaks;
            signal_peaks += ev.signal_peaks;
            per_source_recalls.push(ev.recall);
        }
        let noise_peaks = total_peaks.saturating_sub(signal_peaks);
        let recall = rate(clips_hit, total_clips);
        let precision = rate(signal_peaks, total_peaks);
        let f1 = if recall + precision > 0.0 {
            2.0 * recall * precision / (recall + precision)
        } else {
            0.0
        };
        let min_r = per_source_recalls
            .iter()
            .copied()
            .fold(f64::INFINITY, f64::min);
        let max_r = per_source_recalls
            .iter()
            .copied()
            .fold(f64::NEG_INFINITY, f64::max);
        rows.push(ChatGridRow {
            aggregate: ChatSignalEvaluation {
                params: *params,
                total_clips,
                clips_hit,
                recall,
                total_peaks,
                signal_peaks,
                noise_peaks,
                noise_rate: rate(noise_peaks, total_peaks),
                precision,
                f1,
            },
            per_source_recall_min: if min_r.is_finite() { min_r } else { 0.0 },
            per_source_recall_max: if max_r.is_finite() { max_r } else { 0.0 },
            per_source_recalls,
        });
    }
    rows
}

/// Estatísticas de tempo e custo por execução/Provedor, normalizadas por hora de Fonte.
#[derive(Debug, Clone, Default, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ProviderCostTiming {
    pub source_duration_us: i64,
    pub wall_ms: u64,
    pub windows_total: usize,
    pub windows_completed: usize,
    pub windows_failed: usize,
    pub calls: u64,
    pub repairs: u64,
    pub input_tokens: u64,
    pub output_tokens: u64,
    pub cost_micro_usd: u64,
    pub hours: f64,
    pub secs_per_hour: f64,
    pub usd_per_hour: f64,
}

/// Contagens brutas de uma execução para normalização por hora.
#[derive(Debug, Clone, Copy, Default, PartialEq, Eq)]
pub struct CostCounts {
    pub source_duration_us: i64,
    pub wall_ms: u64,
    pub windows_total: usize,
    pub windows_completed: usize,
    pub windows_failed: usize,
    pub calls: u64,
    pub repairs: u64,
    pub input_tokens: u64,
    pub output_tokens: u64,
    pub cost_micro_usd: u64,
}

impl ProviderCostTiming {
    pub fn from_counts(c: CostCounts) -> Self {
        let hours = c.source_duration_us.max(0) as f64 / 3_600_000_000.0;
        let secs = c.wall_ms as f64 / 1000.0;
        let usd = c.cost_micro_usd as f64 / 1_000_000.0;
        Self {
            source_duration_us: c.source_duration_us,
            wall_ms: c.wall_ms,
            windows_total: c.windows_total,
            windows_completed: c.windows_completed,
            windows_failed: c.windows_failed,
            calls: c.calls,
            repairs: c.repairs,
            input_tokens: c.input_tokens,
            output_tokens: c.output_tokens,
            cost_micro_usd: c.cost_micro_usd,
            hours,
            secs_per_hour: if hours > 0.0 { secs / hours } else { 0.0 },
            usd_per_hour: if hours > 0.0 { usd / hours } else { 0.0 },
        }
    }
}

/// Intervalo de confiança de Wilson (95%, z = 1.96) para uma proporção `hits / total`.
pub fn wilson_ci95(hits: usize, total: usize) -> (f64, f64) {
    if total == 0 {
        return (0.0, 0.0);
    }
    let n = total as f64;
    let p = hits as f64 / n;
    let z = 1.96_f64;
    let z2 = z * z;
    let denom = 1.0 + z2 / n;
    let center = (p + z2 / (2.0 * n)) / denom;
    let half = (z * ((p * (1.0 - p) + z2 / (4.0 * n)) / n).sqrt()) / denom;
    (
        (center - half).clamp(0.0, 1.0),
        (center + half).clamp(0.0, 1.0),
    )
}

// ---------------------------------------------------------------- matriz de janelas e formatos (#148)

const BENCH_MINUTE_US: i64 = 60_000_000;

/// Formato de serialização de Frases usado no experimento #148 (somente no harness).
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum BenchFormat {
    /// Formato compacto H (`## hh:mm` + `ID texto`), padrão da v1 no núcleo.
    CompactH,
    /// Formato completo B (`[S123 01:02:03.4] texto`), braço experimental do #115/#148.
    FullB,
}

impl BenchFormat {
    pub fn as_str(self) -> &'static str {
        match self {
            Self::CompactH => "H",
            Self::FullB => "B",
        }
    }

    pub fn parse(value: &str) -> Option<Self> {
        match value.trim() {
            "H" | "h" | "compact" | "CompactH" => Some(Self::CompactH),
            "B" | "b" | "full" | "FullB" => Some(Self::FullB),
            _ => None,
        }
    }

    pub fn estimate_format(self) -> &'static str {
        match self {
            Self::CompactH => "compact",
            Self::FullB => "full",
        }
    }

    /// Caracteres por token padrão da pesquisa #115 (§3.4) / `cost.rs`.
    pub fn default_chars_per_token(self, language: &str) -> f64 {
        match self {
            Self::CompactH => {
                if language == "en" {
                    3.6
                } else {
                    3.3
                }
            }
            Self::FullB => 2.4,
        }
    }
}

/// Formata um instante em microssegundos como `hh:mm:ss.d` (décimos de segundo) para o formato B.
pub fn format_timestamp_tenths(us: i64) -> String {
    let tenths_total = us.max(0) / 100_000;
    let d = tenths_total % 10;
    let secs_total = tenths_total / 10;
    let s = secs_total % 60;
    let mins_total = secs_total / 60;
    let m = mins_total % 60;
    let h = mins_total / 60;
    format!("{h:02}:{m:02}:{s:02}.{d}")
}

/// Serializa uma única Frase no formato B (`[S123 01:02:03.4] texto`, com marcas opcionais).
pub fn format_b_line(sentence: &Sentence, marks: &impl SentenceMarks) -> String {
    let ts = format_timestamp_tenths(sentence.start_us);
    let mut out = format!("[S{} {ts}]", sentence.id);
    if let Some(mark) = marks.energy_of(sentence.id).and_then(energy::mark) {
        out.push(' ');
        out.push_str(mark);
    }
    if let Some(mark) = marks.chat_of(sentence.id) {
        out.push(' ');
        out.push_str(&chat::mark(mark));
    }
    out.push(' ');
    out.push_str(&sentence.text);
    out.push('\n');
    out
}

/// Serializa um trecho de Frases no formato B completo.
pub fn format_b_transcript(sentences: &[Sentence], marks: &impl SentenceMarks) -> String {
    let mut out = String::new();
    for s in sentences {
        out.push_str(&format_b_line(s, marks));
    }
    out
}

fn dominant_language(sentences: &[Sentence]) -> String {
    let mut counts = std::collections::BTreeMap::<&str, usize>::new();
    for s in sentences {
        let lang = s
            .language
            .as_deref()
            .filter(|l| l.len() == 2 && l.bytes().all(|c| c.is_ascii_lowercase()))
            .unwrap_or("und");
        *counts.entry(lang).or_default() += s.text.chars().count();
    }
    let total: usize = counts.values().sum();
    if total == 0 {
        return "und".into();
    }
    counts
        .into_iter()
        .find(|(_, n)| {
            n.saturating_mul(100) >= total.saturating_mul(sentences::LANGUAGE_MAJORITY_PERCENT)
        })
        .map_or_else(|| "mul".into(), |(l, _)| l.into())
}

/// Monta o `TaskInput` da Tarefa de IA `selection` para qualquer formato experimental do #148,
/// preservando o prompt, o schema e os verificadores do núcleo (#53/#57).
pub fn bench_window_input(
    frases: &[Sentence],
    format: BenchFormat,
    min_us: i64,
    max_us: i64,
    marks: &Marks,
) -> TaskInput {
    let length = frases.last().map_or(0, |s| s.end_us) - frases.first().map_or(0, |s| s.start_us);
    let target = target_candidates(length);
    let desired_max = PREFERRED_MAX_US.min(max_us).max(min_us);
    let (body, hint) = match format {
        BenchFormat::CompactH => {
            let compact = sentences::compact_with_hint_marked(frases, marks);
            (compact.text, compact.hint)
        }
        BenchFormat::FullB => (
            format_b_transcript(frases, marks),
            EstimateHint {
                format: "full".into(),
                language: dominant_language(frases),
            },
        ),
    };
    let fmt_note = match format {
        BenchFormat::CompactH => "",
        BenchFormat::FullB => {
            " formato=B ([S<ID> hh:mm:ss.d]; devolva startId/endId inteiros sem S)"
        }
    };
    let header = format!(
        "#JANELA max_candidatos={target} duracao_desejada_s={}-{} duracao_maxima_s={}{fmt_note}\n",
        min_us / 1_000_000,
        desired_max / 1_000_000,
        max_us / 1_000_000,
    );
    TaskInput {
        transcript: header + &body,
        estimate_hint: hint,
        context: json!({
            "ids": frases.iter().map(|s| s.id).collect::<Vec<_>>(),
            "targetCandidates": target,
        }),
        native_schema: false,
    }
}

/// Configuração de uma célula da matriz experimental do #148.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MatrixWindowSpec {
    pub id: String,
    pub duration_label: String,
    /// `None` representa a live inteira em uma única chamada.
    pub window_max_us: Option<i64>,
    pub overlap_us: i64,
    pub format: BenchFormat,
}

impl MatrixWindowSpec {
    pub fn new(window_minutes: Option<i64>, overlap_minutes: i64, format: BenchFormat) -> Self {
        let (duration_label, window_max_us) = match window_minutes {
            Some(m) => (format!("{m}m"), Some(m * BENCH_MINUTE_US)),
            None => ("full".to_owned(), None),
        };
        let ov_min = if window_max_us.is_none() {
            0
        } else {
            overlap_minutes.max(0)
        };
        let id = format!("{duration_label}_ov{ov_min}m_{}", format.as_str());
        Self {
            id,
            duration_label,
            window_max_us,
            overlap_us: ov_min * BENCH_MINUTE_US,
            format,
        }
    }
}

/// Matriz completa do ticket #148: 10/15/30/60 min × 0/1/3 min × H/B + live inteira × H/B (26 células).
pub fn default_matrix() -> Vec<MatrixWindowSpec> {
    let mut specs = Vec::with_capacity(26);
    for dur in [Some(10), Some(15), Some(30), Some(60)] {
        for ov in [0, 1, 3] {
            for fmt in [BenchFormat::CompactH, BenchFormat::FullB] {
                specs.push(MatrixWindowSpec::new(dur, ov, fmt));
            }
        }
    }
    for fmt in [BenchFormat::CompactH, BenchFormat::FullB] {
        specs.push(MatrixWindowSpec::new(None, 0, fmt));
    }
    specs
}

/// Estado do planejamento de uma célula da matriz para um dado limite de contexto efetivo.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", tag = "kind")]
pub enum BenchPlanStatus {
    Full,
    Reduced {
        min_achieved_us: i64,
        max_achieved_us: i64,
    },
    Infeasible {
        code: String,
        required_tokens: u64,
        available_tokens: u64,
    },
}

/// Janela planejada pelo harness do #148 (contém apenas índices, tempos e contagens).
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct BenchPlannedWindow {
    pub index: usize,
    pub first_index: usize,
    pub last_index: usize,
    pub first_id: i64,
    pub last_id: i64,
    pub start_us: i64,
    pub end_us: i64,
    pub duration_us: i64,
    pub sentence_count: usize,
    pub transcript_chars: usize,
    pub est_input_tokens: u64,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct BenchPlan {
    pub spec: MatrixWindowSpec,
    pub effective_context_tokens: u64,
    pub input_budget_tokens: u64,
    pub status: BenchPlanStatus,
    pub windows: Vec<BenchPlannedWindow>,
}

fn json_escaped_chars(text: &str) -> u64 {
    serde_json::to_string(text).map_or(text.chars().count() as u64, |j| {
        (j.chars().count() as u64).saturating_sub(2)
    })
}

/// Planeja janelas experimentais para o #148 respeitando a capacidade real do perfil (margem de 85%,
/// reserva de saída/raciocínio e tokens fixos). Registra combinações inviáveis sem forçar.
#[allow(clippy::too_many_arguments)]
pub fn plan_matrix_windows(
    sentences: &[Sentence],
    marks: &Marks,
    spec: &MatrixWindowSpec,
    effective_context_tokens: u64,
    fixed_tokens: u64,
    output_reserve: u64,
    reasoning_reserve: u64,
    planning_factor: f64,
) -> BenchPlan {
    let usable = ((u128::from(effective_context_tokens) * 85) / 100) as u64;
    let input_limit = usable.saturating_sub(output_reserve.saturating_add(reasoning_reserve));
    let budget = input_limit.saturating_sub(fixed_tokens);

    if sentences.is_empty() {
        return BenchPlan {
            spec: spec.clone(),
            effective_context_tokens,
            input_budget_tokens: budget,
            status: BenchPlanStatus::Full,
            windows: Vec::new(),
        };
    }

    let lang = dominant_language(sentences);
    let chars_per_tok = spec.format.default_chars_per_token(&lang).max(0.5);
    let tok_per_char = (1.0 / chars_per_tok) * planning_factor.max(1.0);

    let line_chars: Vec<u64> = sentences
        .iter()
        .map(|s| {
            let text = match spec.format {
                BenchFormat::CompactH => sentences::line(s, marks),
                BenchFormat::FullB => format_b_line(s, marks),
            };
            json_escaped_chars(&text)
        })
        .collect();
    let header_chars = match spec.format {
        BenchFormat::CompactH => json_escaped_chars("## 00:00\n"),
        BenchFormat::FullB => 0,
    };

    let n = sentences.len();
    let mut prefix_chars = Vec::with_capacity(n + 1);
    let mut prefix_headers = Vec::with_capacity(n + 1);
    let mut c_sum = 0_u64;
    let mut h_sum = 0_u64;
    prefix_chars.push(0);
    prefix_headers.push(0);
    let minute_of = |s: &Sentence| s.start_us.max(0) / BENCH_MINUTE_US;
    for i in 0..n {
        c_sum = c_sum.saturating_add(line_chars[i]);
        if matches!(spec.format, BenchFormat::CompactH) {
            h_sum += u64::from(i == 0 || minute_of(&sentences[i]) != minute_of(&sentences[i - 1]));
        }
        prefix_chars.push(c_sum);
        prefix_headers.push(h_sum);
    }
    let starts_header = |i: usize| {
        matches!(spec.format, BenchFormat::CompactH)
            && (i == 0 || minute_of(&sentences[i]) != minute_of(&sentences[i - 1]))
    };
    let chars_of = |s: usize, e: usize| {
        let extra = if matches!(spec.format, BenchFormat::CompactH) {
            let markers = prefix_headers[e + 1] - prefix_headers[s] + u64::from(!starts_header(s));
            markers.saturating_mul(header_chars)
        } else {
            0
        };
        (prefix_chars[e + 1] - prefix_chars[s]).saturating_add(extra)
    };
    let tokens_of =
        |s: usize, e: usize| -> u64 { ((chars_of(s, e) as f64) * tok_per_char).ceil() as u64 };

    // Live inteira: 1 única chamada. Se não couber, registra inviável sem quebrar em janelas.
    if spec.window_max_us.is_none() {
        let needed = tokens_of(0, n - 1);
        if needed > budget {
            return BenchPlan {
                spec: spec.clone(),
                effective_context_tokens,
                input_budget_tokens: budget,
                status: BenchPlanStatus::Infeasible {
                    code: "context_too_small_full_live".into(),
                    required_tokens: needed.saturating_add(fixed_tokens),
                    available_tokens: input_limit,
                },
                windows: Vec::new(),
            };
        }
        return BenchPlan {
            spec: spec.clone(),
            effective_context_tokens,
            input_budget_tokens: budget,
            status: BenchPlanStatus::Full,
            windows: vec![BenchPlannedWindow {
                index: 0,
                first_index: 0,
                last_index: n - 1,
                first_id: sentences[0].id,
                last_id: sentences[n - 1].id,
                start_us: sentences[0].start_us,
                end_us: sentences[n - 1].end_us,
                duration_us: sentences[n - 1].end_us - sentences[0].start_us,
                sentence_count: n,
                transcript_chars: chars_of(0, n - 1) as usize,
                est_input_tokens: needed.saturating_add(fixed_tokens),
            }],
        };
    }

    let w_max = spec.window_max_us.unwrap();
    let overlap = spec.overlap_us;
    let min_req_us = if overlap > 0 {
        w_max.min(overlap.saturating_mul(2))
    } else {
        w_max.min(5 * BENCH_MINUTE_US)
    };

    let mut windows = Vec::new();
    let mut reduced = false;
    let mut start = 0_usize;
    while start < n {
        let by_duration = sentences[start..]
            .partition_point(|s| s.end_us - sentences[start].start_us <= w_max)
            .checked_sub(1)
            .map(|k| start + k)
            .unwrap_or(start);

        let by_tokens = {
            let (mut lo, mut hi) = (start, by_duration + 1);
            while lo < hi {
                let mid = lo + (hi - lo) / 2;
                if tokens_of(start, mid) <= budget {
                    lo = mid + 1;
                } else {
                    hi = mid;
                }
            }
            match lo.checked_sub(1).filter(|last| *last >= start) {
                Some(last) => last,
                None => {
                    return BenchPlan {
                        spec: spec.clone(),
                        effective_context_tokens,
                        input_budget_tokens: budget,
                        status: BenchPlanStatus::Infeasible {
                            code: "context_too_small".into(),
                            required_tokens: tokens_of(start, start).saturating_add(fixed_tokens),
                            available_tokens: input_limit,
                        },
                        windows: Vec::new(),
                    };
                }
            }
        };

        let required = (start
            + sentences[start..]
                .partition_point(|s| s.end_us - sentences[start].start_us < min_req_us))
        .min(n - 1)
        .min(by_duration);
        if required > by_tokens {
            return BenchPlan {
                spec: spec.clone(),
                effective_context_tokens,
                input_budget_tokens: budget,
                status: BenchPlanStatus::Infeasible {
                    code: "context_too_small".into(),
                    required_tokens: tokens_of(start, required).saturating_add(fixed_tokens),
                    available_tokens: input_limit,
                },
                windows: Vec::new(),
            };
        }

        let end = by_duration.min(by_tokens);
        if by_tokens < by_duration {
            reduced = true;
        }
        let dur_us = sentences[end].end_us - sentences[start].start_us;
        windows.push(BenchPlannedWindow {
            index: windows.len(),
            first_index: start,
            last_index: end,
            first_id: sentences[start].id,
            last_id: sentences[end].id,
            start_us: sentences[start].start_us,
            end_us: sentences[end].end_us,
            duration_us: dur_us,
            sentence_count: end - start + 1,
            transcript_chars: chars_of(start, end) as usize,
            est_input_tokens: tokens_of(start, end).saturating_add(fixed_tokens),
        });
        if end == n - 1 {
            break;
        }
        let cut = sentences[end].end_us - overlap;
        let next = sentences.partition_point(|s| s.start_us <= cut);
        let reaches_beyond =
            next > start && sentences[end + 1].end_us - sentences[next].start_us <= w_max;
        start = if reaches_beyond { next } else { end + 1 };
    }

    let min_achieved = windows.iter().map(|w| w.duration_us).min().unwrap_or(0);
    let max_achieved = windows.iter().map(|w| w.duration_us).max().unwrap_or(0);
    let total_dur = sentences[n - 1].end_us - sentences[0].start_us;
    // Se pediu janela >15 min (30 ou 60 min) numa Fonte mais longa que 15 min, mas o contexto
    // reduziu todas as janelas para <= 15 min, registra inviabilidade para evitar duplicar 15m.
    let status = if w_max > 15 * BENCH_MINUTE_US
        && total_dur > 15 * BENCH_MINUTE_US
        && max_achieved <= 15 * BENCH_MINUTE_US
    {
        BenchPlanStatus::Infeasible {
            code: "context_cannot_hold_target_window".into(),
            required_tokens: tokens_of(0, n - 1).saturating_add(fixed_tokens),
            available_tokens: input_limit,
        }
    } else if reduced {
        BenchPlanStatus::Reduced {
            min_achieved_us: min_achieved,
            max_achieved_us: max_achieved,
        }
    } else {
        BenchPlanStatus::Full
    };

    BenchPlan {
        spec: spec.clone(),
        effective_context_tokens,
        input_budget_tokens: budget,
        status,
        windows,
    }
}

/// Mede quantos Cortes humanos cabem inteiros em ao menos uma janela e quantos cruzam borda.
#[derive(Debug, Clone, Copy, Default, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct WindowCrossingStats {
    pub total_clips: usize,
    pub contained_clips: usize,
    pub crossing_clips: usize,
    pub crossing_rate: f64,
}

pub fn evaluate_window_crossing(
    windows: &[(i64, i64)],
    ground_truth: &[GroundTruthClip],
) -> WindowCrossingStats {
    let total_clips = ground_truth.len();
    let contained_clips = ground_truth
        .iter()
        .filter(|gt| {
            windows
                .iter()
                .any(|&(ws, we)| ws <= gt.start_us && gt.end_us <= we)
        })
        .count();
    let crossing_clips = total_clips.saturating_sub(contained_clips);
    WindowCrossingStats {
        total_clips,
        contained_clips,
        crossing_clips,
        crossing_rate: rate(crossing_clips, total_clips),
    }
}

/// Contagem de validade de saída e falhas tipadas por execução (#148).
#[derive(Debug, Clone, Copy, Default, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ValidityCounts {
    pub windows_total: usize,
    pub windows_attempted: usize,
    pub windows_completed: usize,
    pub windows_failed: usize,
    pub invalid_json: usize,
    pub output_invalid: usize,
    pub verification_failed: usize,
    pub context_truncated: usize,
    pub timeout_uncertain: usize,
    pub rate_limit: usize,
    pub other_errors: usize,
    pub validity_rate: f64,
}

impl ValidityCounts {
    pub fn record_failure(&mut self, code: &str) {
        self.windows_failed += 1;
        match code {
            "invalid_json" | "invalid_response" => self.invalid_json += 1,
            "output_invalid" | "output_truncated" | "refusal" => self.output_invalid += 1,
            "verification_failed" => self.verification_failed += 1,
            "context_truncated" => self.context_truncated += 1,
            "timeout_uncertain" => self.timeout_uncertain += 1,
            "rate_limit" | "provider_daily_limit" => self.rate_limit += 1,
            _ => self.other_errors += 1,
        }
    }

    pub fn finalize(&mut self) {
        self.validity_rate = rate(self.windows_completed, self.windows_attempted);
    }

    pub fn merge(&mut self, other: &Self) {
        self.windows_total += other.windows_total;
        self.windows_attempted += other.windows_attempted;
        self.windows_completed += other.windows_completed;
        self.windows_failed += other.windows_failed;
        self.invalid_json += other.invalid_json;
        self.output_invalid += other.output_invalid;
        self.verification_failed += other.verification_failed;
        self.context_truncated += other.context_truncated;
        self.timeout_uncertain += other.timeout_uncertain;
        self.rate_limit += other.rate_limit;
        self.other_errors += other.other_errors;
        self.finalize();
    }
}

/// Candidato produzido pelo pipeline exato do núcleo (`build_candidates`), para avaliação
/// no harness (e eventual segunda passada) sem tocar no SQLite do produto.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct BenchCandidate {
    pub start_id: i64,
    pub end_id: i64,
    pub start_us: i64,
    pub end_us: i64,
    pub total_centi: u32,
    pub title: String,
    pub windows: Vec<usize>,
    pub scores: Vec<u8>,
    pub why: Vec<String>,
}

impl BenchCandidate {
    pub fn span(&self) -> CandidateSpan {
        CandidateSpan {
            start_id: self.start_id,
            end_id: self.end_id,
            start_us: self.start_us,
            end_us: self.end_us,
        }
    }
}

#[derive(Debug, Clone, Copy, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CandidateTallySummary {
    pub proposed: usize,
    pub kept: usize,
    pub merged: usize,
    pub adjusted: usize,
    pub too_short: usize,
    pub too_long: usize,
    pub unknown_id: usize,
}

/// Executa o mesmo ajuste de bordas, junção de duplicatas e ordenação de `selection.rs` sobre as
/// saídas validadas pelo `ai_task::run` no harness.
pub fn build_candidates_for_benchmark(
    frases: &[Sentence],
    min_us: i64,
    max_us: i64,
    done: &[(usize, Value)],
) -> (Vec<BenchCandidate>, CandidateTallySummary) {
    let range = Range { min_us, max_us };
    let (kept, tally) = selection::build_candidates(VideoKind::Direct, frases, &range, done);
    let summary = CandidateTallySummary {
        proposed: tally.proposed,
        kept: kept.len(),
        merged: tally.merged,
        adjusted: tally.adjusted,
        too_short: tally.too_short,
        too_long: tally.too_long,
        unknown_id: tally.unknown_id,
    };
    let out = kept
        .into_iter()
        .map(|(m, p)| BenchCandidate {
            start_id: frases[p.start].id,
            end_id: frases[p.end].id,
            start_us: m.span.start_us,
            end_us: m.span.end_us,
            total_centi: m.total_centi,
            title: p.title,
            windows: m.windows,
            scores: p.scores,
            why: p.why,
        })
        .collect();
    (out, summary)
}

/// Métricas de comparação antes/depois da segunda passada (reordenação global) por corte de topo K.
#[derive(Debug, Clone, Copy, Default, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TopKRecall {
    pub k: usize,
    pub pass1_recall_min_50: f64,
    pub pass2_recall_min_50: f64,
    pub pass1_recall_iou_30: f64,
    pub pass2_recall_iou_30: f64,
}

#[derive(Debug, Clone, Default, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TwoPassEvalMetrics {
    pub total_clips: usize,
    pub total_candidates: usize,
    pub pass1_all_recall_min_50: f64,
    pub pass2_all_recall_min_50: f64,
    pub top_k: Vec<TopKRecall>,
}

fn recall_at_k(
    ground_truth: &[GroundTruthClip],
    ordered_spans: &[CandidateSpan],
    k: usize,
) -> (f64, f64) {
    if ground_truth.is_empty() {
        return (0.0, 0.0);
    }
    let slice = &ordered_spans[..ordered_spans.len().min(k)];
    let hit_min50 = ground_truth
        .iter()
        .filter(|gt| {
            slice
                .iter()
                .any(|c| min_overlap_ratio(gt.start_us, gt.end_us, c.start_us, c.end_us) >= 0.50)
        })
        .count();
    let hit_iou30 = ground_truth
        .iter()
        .filter(|gt| {
            slice
                .iter()
                .any(|c| iou(gt.start_us, gt.end_us, c.start_us, c.end_us) >= 0.30)
        })
        .count();
    (
        rate(hit_min50, ground_truth.len()),
        rate(hit_iou30, ground_truth.len()),
    )
}

/// Avalia o ganho da segunda passada em Recall@K comparando a ordem original (Pass 1) com a ordem
/// reordenada (Pass 2, índices base-0 em `pass1_ordered`).
pub fn evaluate_two_pass_rerank(
    ground_truth: &[GroundTruthClip],
    pass1_ordered: &[CandidateSpan],
    pass2_indices: &[usize],
    ks: &[usize],
) -> TwoPassEvalMetrics {
    let pass2_ordered: Vec<CandidateSpan> = pass2_indices
        .iter()
        .filter_map(|&idx| pass1_ordered.get(idx).copied())
        .collect();
    let (p1_all, _) = recall_at_k(ground_truth, pass1_ordered, pass1_ordered.len());
    let (p2_all, _) = recall_at_k(ground_truth, &pass2_ordered, pass2_ordered.len());
    let top_k = ks
        .iter()
        .map(|&k| {
            let (p1_m, p1_i) = recall_at_k(ground_truth, pass1_ordered, k);
            let (p2_m, p2_i) = recall_at_k(ground_truth, &pass2_ordered, k);
            TopKRecall {
                k,
                pass1_recall_min_50: p1_m,
                pass2_recall_min_50: p2_m,
                pass1_recall_iou_30: p1_i,
                pass2_recall_iou_30: p2_i,
            }
        })
        .collect();
    TwoPassEvalMetrics {
        total_clips: ground_truth.len(),
        total_candidates: pass1_ordered.len(),
        pass1_all_recall_min_50: p1_all,
        pass2_all_recall_min_50: p2_all,
        top_k,
    }
}

/// Carrega as Frases segmentadas, marcas de energia e marcas de chat de uma Fonte do Projeto
/// aberto, usando as mesmas funções internas da seleção (#53/#54/#151).
pub fn load_source_sentences_and_marks(
    source_id: i64,
    with_chat: bool,
) -> Result<(Vec<Sentence>, Marks, bool), crate::CoreError> {
    let transcript = sentences::source_transcript(&json!({"source_id": source_id}))?;
    sentences::segment_transcript(transcript)?;
    let frases = sentences::load_for(transcript)?;
    let energy_marks = energy::load_marks(transcript)?.unwrap_or_default();
    let chat_loaded = chat::load_marks(transcript, &frases)?;
    let has_chat = chat_loaded.is_some();
    let chat_marks = if with_chat {
        chat_loaded.unwrap_or_default()
    } else {
        Default::default()
    };
    Ok((
        frases,
        Marks {
            energy: energy_marks,
            chat: chat_marks,
        },
        has_chat,
    ))
}

/// Estimativa de tokens fixos (envelope + instrução + schema) da Tarefa `selection` para
/// dimensionamento de janelas no harness do #148.
pub fn selection_fixed_tokens() -> u64 {
    let task = super::task_for(VideoKind::Direct);
    let instruction = crate::ai_task::normalized_prompt(task.prompt);
    let schema: Value = serde_json::from_str(task.wire_schema).unwrap_or(Value::Null);
    let req = crate::provider::StructuredRequest {
        estimate_hint: EstimateHint {
            format: "compact".into(),
            language: "pt".into(),
        },
        instruction,
        transcript: String::new(),
        schema,
        native_schema: false,
        max_output_tokens: Some(task.budget.max_output_tokens),
    };
    let chars = crate::provider::cost::input_characters(&req) as f64;
    (chars / 3.3).ceil() as u64
}
