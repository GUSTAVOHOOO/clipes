//! Detecção e corte de silêncios a partir dos tempos das palavras da Transcrição (#77).
//!
//! Os pontos de corte preservam margens antes/depois da fala, deixam uma pausa de respiro
//! em vez de zerar e buscam o mínimo local de amplitude (e cruzamento por zero) dentro de
//! ±20 ms quando o áudio está acessível. O mesmo `SpliceMap` remapeia legendas, preview e export.

use crate::CoreError;
use serde::{Deserialize, Serialize};
use std::{
    path::Path,
    sync::{Mutex, OnceLock},
};

/// Silêncio mínimo padrão entre palavras para remoção (600 ms).
pub const DEFAULT_MIN_SILENCE_US: i64 = 600_000;
/// Menor limite ajustável na UI (300 ms).
pub const MIN_SILENCE_THRESHOLD_US: i64 = 300_000;
/// Maior limite ajustável na UI (2000 ms).
pub const MAX_SILENCE_THRESHOLD_US: i64 = 2_000_000;
/// Margem mínima preservada antes do início da palavra seguinte (75 ms).
pub const PRE_SPEECH_MARGIN_US: i64 = 75_000;
/// Margem preservada após o fim da palavra anterior (120 ms).
pub const POST_SPEECH_MARGIN_US: i64 = 120_000;
/// Pausa de respiro deixada entre palavras ao encurtar o silêncio (200 ms).
pub const BREATH_PAUSE_US: i64 = 200_000;
/// Fade curto de saída/entrada em cada ponta da emenda, sem sobreposição (12 ms).
pub const SPLICE_FADE_US: i64 = 12_000;
/// Janela de busca do vale local de amplitude ao redor do ponto de corte (±20 ms).
pub const VALLEY_SEARCH_US: i64 = 20_000;
/// Duração mínima de um corte válido após ajuste no vale (20 ms).
pub const MIN_CUT_US: i64 = 20_000;

const VALLEY_SAMPLE_RATE: u32 = 16_000;
const VALLEY_RMS_HALF_US: i64 = 1_000;
const ZERO_CROSSING_HALF_US: i64 = 1_000;
const MAX_PCM_BYTES: usize = 64 * 1024 * 1024;

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum SilenceStatus {
    Active,
    Reverted,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct SilenceInterval {
    pub id: u64,
    pub start_us: i64,
    pub end_us: i64,
    pub gap_start_us: i64,
    pub gap_end_us: i64,
    pub status: SilenceStatus,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct SilenceConfig {
    pub threshold_us: i64,
    pub intervals: Vec<SilenceInterval>,
}

impl Default for SilenceConfig {
    fn default() -> Self {
        Self {
            threshold_us: DEFAULT_MIN_SILENCE_US,
            intervals: Vec::new(),
        }
    }
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct KeptSegment {
    pub source_start_us: i64,
    pub source_end_us: i64,
    pub output_start_us: i64,
    pub output_end_us: i64,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct SpliceMap {
    pub clip_start_us: i64,
    pub clip_end_us: i64,
    pub segments: Vec<KeptSegment>,
    pub output_duration_us: i64,
    pub removed_us: i64,
}

fn error(code: &str, message: &str) -> CoreError {
    CoreError {
        code: code.into(),
        message: message.into(),
        usage: None,
    }
}

pub fn validate_threshold(threshold_us: i64) -> Result<i64, CoreError> {
    if !(MIN_SILENCE_THRESHOLD_US..=MAX_SILENCE_THRESHOLD_US).contains(&threshold_us) {
        return Err(error(
            "invalid_silence_threshold",
            "O limite de silêncio deve ficar entre 300 ms e 2000 ms.",
        ));
    }
    Ok(threshold_us)
}

/// Detecta silêncios removíveis entre palavras dentro de `[clip_start_us, clip_end_us]`.
/// Silêncios antes da primeira palavra ou após a última não são tocados.
pub fn detect_from_words(
    words: &[(i64, i64)],
    clip_start_us: i64,
    clip_end_us: i64,
    threshold_us: i64,
) -> Result<Vec<SilenceInterval>, CoreError> {
    if clip_start_us < 0 || clip_end_us <= clip_start_us {
        return Err(error("invalid_range", "Intervalo do Corte inválido."));
    }
    validate_threshold(threshold_us)?;

    let mut clamped: Vec<(i64, i64)> = words
        .iter()
        .filter(|(s, e)| *e > clip_start_us && *s < clip_end_us)
        .map(|(s, e)| {
            let cs = (*s).clamp(clip_start_us, clip_end_us);
            let ce = (*e).clamp(cs, clip_end_us);
            (cs, ce)
        })
        .filter(|(s, e)| e > s)
        .collect();
    clamped.sort_unstable();

    if clamped.len() < 2 {
        return Ok(Vec::new());
    }

    let remaining_pause = BREATH_PAUSE_US.max(POST_SPEECH_MARGIN_US + PRE_SPEECH_MARGIN_US);
    let keep_after = POST_SPEECH_MARGIN_US;
    let keep_before = remaining_pause - keep_after;

    let mut out = Vec::new();
    let mut speech_end = clamped[0].1;
    let mut next_id: u64 = 1;

    for &(w_start, w_end) in &clamped[1..] {
        if w_start > speech_end {
            let gap = w_start - speech_end;
            if gap >= threshold_us {
                let cut_start = speech_end + keep_after;
                let cut_end = w_start - keep_before;
                if cut_end - cut_start >= MIN_CUT_US {
                    out.push(SilenceInterval {
                        id: next_id,
                        start_us: cut_start,
                        end_us: cut_end,
                        gap_start_us: speech_end,
                        gap_end_us: w_start,
                        status: SilenceStatus::Active,
                    });
                    next_id += 1;
                }
            }
        }
        speech_end = speech_end.max(w_end);
    }

    Ok(out)
}

/// Move cada ponto de corte dentro de ±20 ms para o mínimo local de amplitude e o cruzamento
/// por zero mais próximo, respeitando as bordas da lacuna entre palavras.
pub fn refine_valleys(
    intervals: &mut [SilenceInterval],
    samples: &[i16],
    sample_rate: u32,
    pcm_start_us: i64,
) {
    if samples.is_empty() || sample_rate == 0 {
        return;
    }
    let mut prefix = Vec::with_capacity(samples.len() + 1);
    prefix.push(0_i64);
    for &s in samples {
        let prev = *prefix.last().unwrap();
        prefix.push(prev + i64::from(s).abs());
    }

    for interval in intervals {
        let start_lo = (interval.start_us - VALLEY_SEARCH_US).max(interval.gap_start_us);
        let start_hi =
            (interval.start_us + VALLEY_SEARCH_US).min(interval.end_us - MIN_CUT_US);
        let new_start = find_valley(
            samples,
            &prefix,
            sample_rate,
            pcm_start_us,
            interval.start_us,
            start_lo,
            start_hi,
        );
        let end_lo = (interval.end_us - VALLEY_SEARCH_US).max(new_start + MIN_CUT_US);
        let end_hi = (interval.end_us + VALLEY_SEARCH_US).min(interval.gap_end_us);
        let new_end = find_valley(
            samples,
            &prefix,
            sample_rate,
            pcm_start_us,
            interval.end_us,
            end_lo,
            end_hi,
        );
        if new_end - new_start >= MIN_CUT_US {
            interval.start_us = new_start;
            interval.end_us = new_end;
        }
    }
}

fn find_valley(
    samples: &[i16],
    prefix: &[i64],
    sample_rate: u32,
    pcm_start_us: i64,
    nominal_us: i64,
    min_us: i64,
    max_us: i64,
) -> i64 {
    if min_us >= max_us || samples.is_empty() {
        return nominal_us.clamp(min_us.min(max_us), max_us.max(min_us));
    }
    let to_idx = |t_us: i64| -> usize {
        let rel = (t_us - pcm_start_us).max(0);
        ((rel * i64::from(sample_rate)) / 1_000_000).clamp(0, samples.len() as i64 - 1) as usize
    };
    let lo = to_idx(min_us);
    let hi = to_idx(max_us);
    if lo >= hi {
        return nominal_us;
    }
    let nominal_idx = to_idx(nominal_us).clamp(lo, hi);
    let half_win = ((VALLEY_RMS_HALF_US * i64::from(sample_rate)) / 1_000_000).max(1) as usize;
    let zc_half = ((ZERO_CROSSING_HALF_US * i64::from(sample_rate)) / 1_000_000).max(1) as usize;

    let mut best_idx = nominal_idx;
    let mut best_key = (i64::MAX, usize::MAX);
    for idx in lo..=hi {
        let a = idx.saturating_sub(half_win);
        let b = (idx + half_win + 1).min(samples.len());
        let avg_abs = (prefix[b] - prefix[a]) * 1024 / (b - a) as i64;
        let key = (avg_abs, idx.abs_diff(nominal_idx));
        if key < best_key {
            best_key = key;
            best_idx = idx;
        }
    }

    let zc_lo = best_idx.saturating_sub(zc_half).max(lo);
    let zc_hi = (best_idx + zc_half).min(hi);
    let mut best_zc: Option<(i32, usize, usize)> = None;
    for idx in zc_lo..=zc_hi {
        let cur = i32::from(samples[idx]);
        let crosses = cur == 0
            || (idx + 1 <= zc_hi
                && ((cur <= 0 && samples[idx + 1] >= 0) || (cur >= 0 && samples[idx + 1] <= 0)));
        if crosses {
            let candidate = (cur.abs(), idx.abs_diff(best_idx), idx);
            if best_zc.is_none_or(|b| candidate < b) {
                best_zc = Some(candidate);
            }
        }
    }
    let chosen_idx = best_zc.map_or(best_idx, |(_, _, idx)| idx);
    let chosen_us = pcm_start_us + (chosen_idx as i64 * 1_000_000) / i64::from(sample_rate);
    chosen_us.clamp(min_us, max_us)
}

impl SpliceMap {
    /// Constrói o mapa de emendas para `[clip_start_us, clip_end_us]` removendo `active_cuts`.
    pub fn new(clip_start_us: i64, clip_end_us: i64, active_cuts: &[(i64, i64)]) -> Self {
        if clip_end_us <= clip_start_us {
            return Self {
                clip_start_us,
                clip_end_us,
                segments: Vec::new(),
                output_duration_us: 0,
                removed_us: 0,
            };
        }
        let mut cuts: Vec<(i64, i64)> = active_cuts
            .iter()
            .map(|(s, e)| ((*s).clamp(clip_start_us, clip_end_us), (*e).clamp(clip_start_us, clip_end_us)))
            .filter(|(s, e)| e > s)
            .collect();
        cuts.sort_unstable();

        let mut merged: Vec<(i64, i64)> = Vec::new();
        for (s, e) in cuts {
            if let Some(last) = merged.last_mut() {
                if s <= last.1 {
                    last.1 = last.1.max(e);
                    continue;
                }
            }
            merged.push((s, e));
        }

        let mut segments = Vec::new();
        let mut cursor = clip_start_us;
        let mut out_cursor = 0_i64;

        for (cs, ce) in merged {
            if cs > cursor {
                let dur = cs - cursor;
                segments.push(KeptSegment {
                    source_start_us: cursor,
                    source_end_us: cs,
                    output_start_us: out_cursor,
                    output_end_us: out_cursor + dur,
                });
                out_cursor += dur;
            }
            cursor = cursor.max(ce);
        }
        if clip_end_us > cursor {
            let dur = clip_end_us - cursor;
            segments.push(KeptSegment {
                source_start_us: cursor,
                source_end_us: clip_end_us,
                output_start_us: out_cursor,
                output_end_us: out_cursor + dur,
            });
            out_cursor += dur;
        }

        let original_dur = clip_end_us - clip_start_us;
        Self {
            clip_start_us,
            clip_end_us,
            segments,
            output_duration_us: out_cursor,
            removed_us: (original_dur - out_cursor).max(0),
        }
    }

    pub fn from_config(clip_start_us: i64, clip_end_us: i64, config: &SilenceConfig) -> Self {
        let active: Vec<(i64, i64)> = config
            .intervals
            .iter()
            .filter(|i| i.status == SilenceStatus::Active)
            .map(|i| (i.start_us, i.end_us))
            .collect();
        Self::new(clip_start_us, clip_end_us, &active)
    }

    /// Converte tempo absoluto da Fonte (µs) para o tempo relativo no Corte emendado (µs).
    pub fn source_to_output(&self, source_us: i64) -> i64 {
        if source_us <= self.clip_start_us || self.segments.is_empty() {
            return 0;
        }
        if source_us >= self.clip_end_us {
            return self.output_duration_us;
        }
        for seg in &self.segments {
            if source_us < seg.source_start_us {
                return seg.output_start_us;
            }
            if source_us <= seg.source_end_us {
                return seg.output_start_us + (source_us - seg.source_start_us);
            }
        }
        self.output_duration_us
    }

    /// Converte tempo relativo no Corte emendado (µs) para o tempo absoluto da Fonte (µs).
    pub fn output_to_source(&self, output_us: i64) -> i64 {
        let Some(first) = self.segments.first() else {
            return self.clip_start_us;
        };
        if output_us <= 0 {
            return first.source_start_us;
        }
        for seg in &self.segments {
            if output_us <= seg.output_end_us {
                return seg.source_start_us + (output_us - seg.output_start_us);
            }
        }
        self.segments.last().unwrap().source_end_us
    }

    /// Remapeia uma palavra `[start_us, end_us]` (Fonte absoluta) para o tempo do Corte emendado.
    pub fn remap_word(&self, start_us: i64, end_us: i64) -> Option<(i64, i64)> {
        let cs = start_us.max(self.clip_start_us);
        let ce = end_us.min(self.clip_end_us);
        if ce <= cs {
            return None;
        }
        let s = self.source_to_output(cs);
        let e = self.source_to_output(ce);
        (e > s).then_some((s, e))
    }
}

// ------------------------------------------------------------------ cache de PCM para busca de vale

struct CachedPcm {
    source_id: i64,
    partial_hash: String,
    audio_track: i64,
    start_us: i64,
    end_us: i64,
    samples: Vec<i16>,
}

fn pcm_cache() -> &'static Mutex<Option<CachedPcm>> {
    static CACHE: OnceLock<Mutex<Option<CachedPcm>>> = OnceLock::new();
    CACHE.get_or_init(|| Mutex::new(None))
}

pub(crate) fn clear_pcm_cache() {
    if let Ok(mut guard) = pcm_cache().lock() {
        *guard = None;
    }
}

/// Decodifica PCM mono 16 kHz da Fonte com FFmpeg no trecho `[start_us, end_us]`.
pub fn extract_pcm(
    ffmpeg: &Path,
    source: &Path,
    audio_track: i64,
    start_us: i64,
    end_us: i64,
) -> Option<Vec<i16>> {
    if audio_track < 0 || end_us <= start_us || !source.is_file() {
        return None;
    }
    let duration = end_us - start_us;
    let ss = crate::export::render::seconds(start_us);
    let dur = crate::export::render::seconds(duration);
    let rate = VALLEY_SAMPLE_RATE.to_string();
    let map_arg = format!("0:{audio_track}");
    let args = [
        "-v", "error", "-nostdin", "-ss", &ss, "-t", &dur, "-i",
    ];
    let mut full: Vec<std::ffi::OsString> = args.iter().map(Into::into).collect();
    full.push(source.as_os_str().to_owned());
    full.extend(
        [
            "-map", &map_arg, "-vn", "-ac", "1", "-ar", &rate, "-f", "s16le", "-",
        ]
        .iter()
        .map(Into::into),
    );
    let output = crate::process::spawn(ffmpeg, &full, None)
        .ok()?
        .wait_with_output()
        .ok()?;
    if !output.status.success() || output.stdout.len() > MAX_PCM_BYTES {
        return None;
    }
    let samples = output
        .stdout
        .chunks_exact(2)
        .map(|b| i16::from_le_bytes([b[0], b[1]]))
        .collect();
    Some(samples)
}

/// Refina os cortes no vale usando o áudio da Fonte, quando disponível; falha silenciosamente
/// para os pontos nominais se a Fonte estiver offline ou o FFmpeg faltar.
pub(crate) fn refine_for_source(
    source_id: i64,
    project: &Path,
    clip_start_us: i64,
    clip_end_us: i64,
    intervals: &mut [SilenceInterval],
) {
    if intervals.is_empty() {
        return;
    }
    let Ok((source_path, hash, audio_track, _duration, _)) =
        crate::jobs::preview::source(source_id, project)
    else {
        return;
    };
    let Ok((_, _, Some(ffmpeg))) = crate::components::cache_settings() else {
        return;
    };
    if let Ok(mut guard) = pcm_cache().lock() {
        let hit = guard.as_ref().is_some_and(|c| {
            c.source_id == source_id
                && c.partial_hash == hash
                && c.audio_track == audio_track
                && c.start_us <= clip_start_us
                && c.end_us >= clip_end_us
        });
        if !hit {
            let Some(samples) =
                extract_pcm(&ffmpeg, &source_path, audio_track, clip_start_us, clip_end_us)
            else {
                return;
            };
            *guard = Some(CachedPcm {
                source_id,
                partial_hash: hash,
                audio_track,
                start_us: clip_start_us,
                end_us: clip_end_us,
                samples,
            });
        }
        if let Some(cached) = guard.as_ref() {
            refine_valleys(intervals, &cached.samples, VALLEY_SAMPLE_RATE, cached.start_us);
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn detects_silences_between_words_with_margins_and_breath_pause() {
        let words = vec![
            (500_000, 1_000_000),   // 500ms silêncio antes (não tocado)
            (1_500_000, 2_000_000), // 500ms gap -> abaixo de 600ms
            (2_800_000, 3_300_000), // 800ms gap -> vira corte [2_120_000, 2_720_000]
            (4_000_000, 4_500_000), // 700ms gap -> vira corte [3_420_000, 3_920_000]
        ];
        let found = detect_from_words(&words, 0, 5_500_000, DEFAULT_MIN_SILENCE_US).unwrap();
        assert_eq!(found.len(), 2);
        assert_eq!(found[0].start_us, 2_120_000);
        assert_eq!(found[0].end_us, 2_720_000);
        assert_eq!(
            (found[0].start_us - found[0].gap_start_us)
                + (found[0].gap_end_us - found[0].end_us),
            BREATH_PAUSE_US
        );
        assert_eq!(found[1].start_us, 3_420_000);
        assert_eq!(found[1].end_us, 3_920_000);
        // Com limite de 300 ms, o gap de 500 ms passa a entrar.
        let sensitive = detect_from_words(&words, 0, 5_500_000, 300_000).unwrap();
        assert_eq!(sensitive.len(), 3);
        assert_eq!(sensitive[0].start_us, 1_120_000);
        assert_eq!(sensitive[0].end_us, 1_420_000);
    }

    #[test]
    fn threshold_validation_respects_ui_bounds() {
        assert!(validate_threshold(300_000).is_ok());
        assert!(validate_threshold(2_000_000).is_ok());
        assert!(validate_threshold(299_999).is_err());
        assert!(validate_threshold(2_000_001).is_err());
    }

    #[test]
    fn valley_search_moves_cut_to_quiet_zero_crossing_within_20ms() {
        let sr = 16_000_u32;
        // 3 segundos: fala forte até 1.130s, silêncio no meio (1.135s..1.910s), fala às 1.915s.
        let mut samples = vec![0_i16; sr as usize * 3];
        for (i, s) in samples.iter_mut().enumerate() {
            let t = i as f64 / f64::from(sr);
            if !(1.132..=1.912).contains(&t) {
                *s = (12_000.0 * (2.0 * std::f64::consts::PI * 300.0 * t).sin()) as i16;
            }
        }
        // Corte nominal: start=1.120s (ainda na fala! vale está +12..20ms depois), end=1.920s (na fala! vale está -8..20ms antes).
        let mut intervals = vec![SilenceInterval {
            id: 1,
            start_us: 1_120_000,
            end_us: 1_920_000,
            gap_start_us: 1_000_000,
            gap_end_us: 2_000_000,
            status: SilenceStatus::Active,
        }];
        refine_valleys(&mut intervals, &samples, sr, 0);
        assert!(
            intervals[0].start_us >= 1_132_000 && intervals[0].start_us <= 1_140_000,
            "start moveu para o vale: {}",
            intervals[0].start_us
        );
        assert!(
            intervals[0].end_us >= 1_900_000 && intervals[0].end_us <= 1_912_000,
            "end moveu para o vale: {}",
            intervals[0].end_us
        );
    }

    #[test]
    fn splice_map_keeps_segments_consistent_across_words_and_reverts() {
        let map = SpliceMap::new(1_000_000, 6_000_000, &[(2_000_000, 3_000_000), (4_000_000, 4_500_000)]);
        assert_eq!(map.removed_us, 1_500_000);
        assert_eq!(map.output_duration_us, 3_500_000);
        assert_eq!(map.segments.len(), 3);
        assert_eq!(map.remap_word(1_100_000, 1_500_000), Some((100_000, 500_000)));
        assert_eq!(map.remap_word(3_200_000, 3_800_000), Some((1_200_000, 1_800_000)));
        assert_eq!(map.remap_word(5_000_000, 5_500_000), Some((2_500_000, 3_000_000)));
        assert_eq!(map.output_to_source(1_500_000), 3_500_000);
        assert_eq!(map.source_to_output(2_500_000), 1_000_000);
    }
}
