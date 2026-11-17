//! Métricas puras e calibração offline do benchmark de seleção (#57).
//!
//! Sem I/O, sem rede e sem texto de Transcrição: recebe apenas intervalos em microssegundos,
//! séries agregadas de chat e contagens de custo/tempo para calcular recall, bordas no meio de
//! Frase, tempo/custo por hora e calibração dos parâmetros de pico de chat.

use crate::chat::{self, Interval, Peak};
use serde::{Deserialize, Serialize};

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

/// Avalia quantos Cortes humanos recebem pelo menos um pico de chat deslocado pelo atraso de
/// reação (`[início - atraso, fim - atraso)`) e quantos picos caem fora de todo Corte humano.
pub fn evaluate_chat_signal(
    series: &[Interval],
    clips: &[GroundTruthClip],
    params: &ChatCalibrationParams,
    tolerance_us: i64,
) -> ChatSignalEvaluation {
    let peaks = peaks_with(series, params);
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
    let mut rows = Vec::with_capacity(grid.len());
    for params in grid {
        let mut total_clips = 0;
        let mut clips_hit = 0;
        let mut total_peaks = 0;
        let mut signal_peaks = 0;
        let mut per_source_recalls = Vec::with_capacity(sources.len());
        for (series, clips) in sources {
            let ev = evaluate_chat_signal(series, clips, params, tolerance_us);
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
