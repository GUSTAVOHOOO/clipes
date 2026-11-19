//! Capítulos do YouTube no Empacotamento (#80): gerados deterministicamente pelo núcleo a
//! partir da montagem do Vídeo transformado (`montage::plan_for_clip`) quando o Roteiro está
//! aprovado e todos os blocos têm duração real da Narração (sem estimativa por caracteres).
//!
//! Os capítulos vivem num bloco delimitado dentro de `description`, são contabilizados no
//! orçamento de 5000 bytes da chamada de IA e podem ser editados livremente na descrição ou
//! atualizados via `packaging.refresh_chapters` sem sobrescrever o restante do texto editado.

use crate::{
    montage::{self, MontagePlan},
    packaging::Lang,
    script, CoreError,
};
use serde::Serialize;

/// Mínimo de capítulos exigido pelo YouTube.
pub const MIN_CHAPTERS: usize = 3;
/// Duração mínima de cada capítulo no YouTube, em segundos.
pub const MIN_CHAPTER_SECONDS: i64 = 10;

pub const DELIM_PT_START: &str = "--- Capítulos ---";
pub const DELIM_PT_END: &str = "--- Fim dos capítulos ---";
pub const DELIM_EN_START: &str = "--- Chapters ---";
pub const DELIM_EN_END: &str = "--- End chapters ---";

#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ChapterEntry {
    pub start_secs: i64,
    pub timestamp: String,
    pub title: String,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ChapterWarning {
    pub code: String,
    pub message: String,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ChapterResolution {
    pub applicable: bool,
    pub status: &'static str,
    pub can_generate: bool,
    pub suggested: Vec<ChapterEntry>,
    pub block: Option<String>,
    pub generation_warning: Option<ChapterWarning>,
    #[serde(skip)]
    pub total_duration_secs: Option<i64>,
}

fn warn(code: &str, message: &str) -> ChapterWarning {
    ChapterWarning {
        code: code.to_owned(),
        message: message.to_owned(),
    }
}

/// Formata segundos não negativos como `MM:SS` ou `H:MM:SS`.
pub fn format_timestamp(seconds: i64) -> String {
    let s = seconds.max(0);
    let h = s / 3600;
    let m = (s / 60) % 60;
    let sec = s % 60;
    if h > 0 {
        format!("{h}:{m:02}:{sec:02}")
    } else {
        format!("{m:02}:{sec:02}")
    }
}

pub fn delimiters_for(lang: Lang) -> (&'static str, &'static str) {
    match lang {
        Lang::Pt => (DELIM_PT_START, DELIM_PT_END),
        Lang::En => (DELIM_EN_START, DELIM_EN_END),
    }
}

fn sanitize_title(raw: &str, position: i64) -> String {
    let clean: String = raw
        .chars()
        .filter(|c| !c.is_control() && *c != '<' && *c != '>')
        .collect::<String>()
        .split_whitespace()
        .collect::<Vec<_>>()
        .join(" ");
    if clean.is_empty() {
        format!("Capítulo {position}")
    } else {
        clean
    }
}

#[derive(Clone, Debug)]
struct PendingChapter {
    start_secs: i64,
    title: String,
}

/// Constrói capítulos válidos para o YouTube a partir do `MontagePlan` resolvido:
/// - fixa o 1º capítulo em `00:00` com o título do 1º bloco;
/// - junta qualquer bloco com menos de 10 s ao anterior (e o 1º ao seguinte);
/// - exige ao menos 3 capítulos restantes.
pub fn build_chapters_from_plan(plan: &MontagePlan) -> Result<Vec<ChapterEntry>, ChapterWarning> {
    if plan.blocks.is_empty() {
        return Err(warn(
            "too_few_chapters",
            "O YouTube exige pelo menos 3 capítulos de 10 s cada, começando em 00:00.",
        ));
    }

    let total_secs = plan.total_duration_us.max(0) / 1_000_000;
    let mut items: Vec<PendingChapter> = plan
        .blocks
        .iter()
        .enumerate()
        .map(|(i, b)| PendingChapter {
            start_secs: if i == 0 {
                0
            } else {
                b.start_us.max(0) / 1_000_000
            },
            title: sanitize_title(&b.title, b.position),
        })
        .collect();

    while items.len() >= 2 {
        let short_idx = items.iter().enumerate().position(|(i, item)| {
            let end = if i + 1 < items.len() {
                items[i + 1].start_secs
            } else {
                total_secs
            };
            end - item.start_secs < MIN_CHAPTER_SECONDS
        });
        let Some(idx) = short_idx else {
            break;
        };
        if idx == 0 {
            items.remove(1);
        } else {
            items.remove(idx);
        }
    }

    if items.len() < MIN_CHAPTERS || total_secs < MIN_CHAPTERS as i64 * MIN_CHAPTER_SECONDS {
        return Err(warn(
            "too_few_chapters",
            "A duração ou quantidade de blocos não atinge o mínimo do YouTube (3 capítulos de pelo menos 10 s cada, começando em 00:00).",
        ));
    }

    Ok(items
        .into_iter()
        .map(|item| ChapterEntry {
            start_secs: item.start_secs,
            timestamp: format_timestamp(item.start_secs),
            title: item.title,
        })
        .collect())
}

pub fn format_block(entries: &[ChapterEntry], lang: Lang) -> String {
    let (start_delim, end_delim) = delimiters_for(lang);
    let mut out = String::from(start_delim);
    for entry in entries {
        out.push('\n');
        out.push_str(&entry.timestamp);
        out.push(' ');
        out.push_str(&entry.title);
    }
    out.push('\n');
    out.push_str(end_delim);
    out
}

/// Resolve a elegibilidade e a sugestão de capítulos de um candidato aprovado.
/// Retorna `applicable: false` para Corte direto (não gera capítulos).
pub fn resolve(candidate_id: i64, lang: Lang) -> Result<ChapterResolution, CoreError> {
    let cut = crate::selection::approved_cut(candidate_id)?;
    if cut.video_kind != crate::selection::cut::VideoKind::Transformed {
        return Ok(ChapterResolution {
            applicable: false,
            status: "not_transformed",
            can_generate: false,
            suggested: Vec::new(),
            block: None,
            generation_warning: None,
            total_duration_secs: None,
        });
    }

    if script::narration_allowed(candidate_id).is_err() {
        return Ok(ChapterResolution {
            applicable: true,
            status: "script_not_approved",
            can_generate: false,
            suggested: Vec::new(),
            block: None,
            generation_warning: Some(warn(
                "script_not_approved",
                "Aprove todos os blocos do Roteiro e gere a Narração para ter capítulos.",
            )),
            total_duration_secs: None,
        });
    }

    let clip_id = crate::editor::edits::clip_id_for_candidate(cut.candidate)?;

    let Some(plan) = montage::plan_for_clip(clip_id, candidate_id, &[])? else {
        return Ok(ChapterResolution {
            applicable: true,
            status: "script_not_approved",
            can_generate: false,
            suggested: Vec::new(),
            block: None,
            generation_warning: Some(warn(
                "script_not_approved",
                "Aprove todos os blocos do Roteiro e gere a Narração para ter capítulos.",
            )),
            total_duration_secs: None,
        });
    };

    if plan.blocks.is_empty() {
        return Ok(ChapterResolution {
            applicable: true,
            status: "script_not_approved",
            can_generate: false,
            suggested: Vec::new(),
            block: None,
            generation_warning: Some(warn(
                "script_not_approved",
                "Aprove todos os blocos do Roteiro e gere a Narração para ter capítulos.",
            )),
            total_duration_secs: None,
        });
    }

    if plan.uses_estimated_durations {
        return Ok(ChapterResolution {
            applicable: true,
            status: "narration_required",
            can_generate: false,
            suggested: Vec::new(),
            block: None,
            generation_warning: Some(warn(
                "narration_required",
                "Gere a Narração para ter capítulos.",
            )),
            total_duration_secs: None,
        });
    }

    let total_secs = plan.total_duration_us.max(0) / 1_000_000;
    match build_chapters_from_plan(&plan) {
        Ok(entries) => {
            let block = format_block(&entries, lang);
            Ok(ChapterResolution {
                applicable: true,
                status: "ready",
                can_generate: true,
                suggested: entries,
                block: Some(block),
                generation_warning: None,
                total_duration_secs: Some(total_secs),
            })
        }
        Err(w) => Ok(ChapterResolution {
            applicable: true,
            status: "too_few_chapters",
            can_generate: false,
            suggested: Vec::new(),
            block: None,
            generation_warning: Some(w),
            total_duration_secs: Some(total_secs),
        }),
    }
}

/// Localiza o bloco delimitado em `text`, retornando
/// `(block_start, block_end, inner_start, inner_end)` em bytes.
pub fn find_delimited_range(text: &str) -> Option<(usize, usize, usize, usize)> {
    let pairs = [
        (DELIM_PT_START, DELIM_PT_END),
        (DELIM_EN_START, DELIM_EN_END),
    ];
    let mut offset = 0;
    let mut found_start: Option<(usize, usize, &str)> = None;

    for raw_line in text.split('\n') {
        let line_len = raw_line.len();
        let trimmed = raw_line.strip_suffix('\r').unwrap_or(raw_line);
        if let Some((block_start, inner_start, expected_end)) = found_start {
            if trimmed == expected_end {
                let block_end = offset + trimmed.len();
                let inner_end = offset;
                return Some((block_start, block_end, inner_start, inner_end));
            }
        } else if let Some((_, end_marker)) = pairs.iter().find(|(s, _)| *s == trimmed) {
            let inner_start = (offset + line_len + 1).min(text.len());
            found_start = Some((offset, inner_start, *end_marker));
        }
        offset += line_len + 1;
    }

    None
}

/// Substitui somente o bloco delimitado dentro de `text` por `new_block`, preservando o restante.
/// Retorna `None` quando os delimitadores não estão presentes.
pub fn replace_delimited_block(text: &str, new_block: &str) -> Option<String> {
    let (start, end, _, _) = find_delimited_range(text)?;
    Some(format!("{}{}{}", &text[..start], new_block, &text[end..]))
}

fn parse_hms(token: &str) -> Option<i64> {
    let parts: Vec<&str> = token.split(':').collect();
    match parts.as_slice() {
        [m_str, s_str] => {
            if m_str.is_empty() || m_str.len() > 3 || s_str.len() != 2 {
                return None;
            }
            let m: i64 = m_str.parse().ok()?;
            let s: i64 = s_str.parse().ok()?;
            if m < 0 || !(0..60).contains(&s) {
                return None;
            }
            Some(m * 60 + s)
        }
        [h_str, m_str, s_str] => {
            if h_str.is_empty() || h_str.len() > 2 || m_str.len() != 2 || s_str.len() != 2 {
                return None;
            }
            let h: i64 = h_str.parse().ok()?;
            let m: i64 = m_str.parse().ok()?;
            let s: i64 = s_str.parse().ok()?;
            if h < 0 || !(0..60).contains(&m) || !(0..60).contains(&s) {
                return None;
            }
            Some(h * 3600 + m * 60 + s)
        }
        _ => None,
    }
}

fn starts_with_timestamp_shape(line: &str) -> bool {
    let trimmed = line.trim_start();
    let token = trimmed.split_whitespace().next().unwrap_or("");
    let parts: Vec<&str> = token.split(':').collect();
    (parts.len() == 2 || parts.len() == 3)
        && parts
            .iter()
            .all(|p| !p.is_empty() && p.chars().all(|c| c.is_ascii_digit()))
}

fn parse_chapter_line(line: &str) -> Option<i64> {
    let trimmed = line.trim();
    let mut parts = trimmed.splitn(2, char::is_whitespace);
    let ts = parts.next()?;
    let title = parts.next().map(str::trim).unwrap_or("");
    if title.is_empty() {
        return None;
    }
    parse_hms(ts)
}

fn push_unique_warning(list: &mut Vec<ChapterWarning>, code: &str, message: &str) {
    if !list.iter().any(|w| w.code == code) {
        list.push(warn(code, message));
    }
}

/// Valida capítulos presentes na descrição editada contra as regras do YouTube
/// (`00:00` obrigatório, mínimo de 3 capítulos, cada um com >= 10 s, ordem crescente).
/// Nunca bloqueia a edição: devolve avisos informativos.
pub fn validate_description_chapters(
    description: &str,
    total_duration_secs: Option<i64>,
) -> Vec<ChapterWarning> {
    let lines: Vec<&str> =
        if let Some((_, _, inner_start, inner_end)) = find_delimited_range(description) {
            description[inner_start..inner_end]
                .lines()
                .map(str::trim)
                .filter(|l| !l.is_empty())
                .collect()
        } else {
            let ts_lines: Vec<&str> = description
                .lines()
                .map(str::trim)
                .filter(|l| starts_with_timestamp_shape(l))
                .collect();
            if ts_lines.is_empty() {
                return Vec::new();
            }
            ts_lines
        };

    let mut warnings = Vec::new();
    let mut parsed_secs = Vec::new();
    for line in &lines {
        match parse_chapter_line(line) {
            Some(secs) => parsed_secs.push(secs),
            None => push_unique_warning(
                &mut warnings,
                "invalid_chapter_format",
                "Cada linha de capítulo deve ter timestamp (ex.: 00:00) e título.",
            ),
        }
    }

    if let Some(&first) = parsed_secs.first() {
        if first != 0 {
            push_unique_warning(
                &mut warnings,
                "first_chapter_not_zero",
                "O primeiro capítulo deve começar em 00:00.",
            );
        }
    }

    if parsed_secs.len() < MIN_CHAPTERS {
        push_unique_warning(
            &mut warnings,
            "too_few_chapters",
            "O YouTube exige pelo menos 3 capítulos.",
        );
    }

    for pair in parsed_secs.windows(2) {
        if pair[1] < pair[0] {
            push_unique_warning(
                &mut warnings,
                "chapters_not_ordered",
                "Os timestamps dos capítulos devem estar em ordem crescente.",
            );
        } else if pair[1] - pair[0] < MIN_CHAPTER_SECONDS {
            push_unique_warning(
                &mut warnings,
                "chapter_too_short",
                "Cada capítulo no YouTube precisa durar pelo menos 10 s.",
            );
        }
    }

    if let (Some(total), Some(&last)) = (total_duration_secs, parsed_secs.last()) {
        if last > total {
            push_unique_warning(
                &mut warnings,
                "chapter_past_end",
                "Um capítulo começa após o fim do vídeo.",
            );
        } else if total - last < MIN_CHAPTER_SECONDS {
            push_unique_warning(
                &mut warnings,
                "chapter_too_short",
                "Cada capítulo no YouTube precisa durar pelo menos 10 s.",
            );
        }
    }

    warnings
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::montage::{MontagePlan, ResolvedBlock, StartMode, MONTAGE_SCHEMA_VERSION};

    fn resolved_block(
        id: i64,
        pos: i64,
        title: &str,
        start_us: i64,
        duration_us: i64,
    ) -> ResolvedBlock {
        ResolvedBlock {
            block_id: id,
            position: pos,
            title: title.to_owned(),
            mode: StartMode::Automatic,
            anchor_sentence_id: None,
            manual_source_start_us: None,
            auto_start_us: start_us,
            desired_start_us: start_us,
            start_us,
            end_us: start_us + duration_us,
            duration_us,
            estimated: false,
            pushed_us: 0,
            overflow_us: 0,
            source_start_us: start_us,
        }
    }

    fn plan(blocks: Vec<ResolvedBlock>, total_duration_us: i64) -> MontagePlan {
        MontagePlan {
            schema_version: MONTAGE_SCHEMA_VERSION,
            blocks,
            clip_duration_us: total_duration_us,
            narration_end_us: total_duration_us,
            freeze_tail_us: 0,
            total_duration_us,
            total_pushed_us: 0,
            uses_estimated_durations: false,
            warnings: Vec::new(),
        }
    }

    #[test]
    fn formats_mm_ss_and_h_mm_ss() {
        assert_eq!(format_timestamp(0), "00:00");
        assert_eq!(format_timestamp(65), "01:05");
        assert_eq!(format_timestamp(3661), "1:01:01");
    }

    #[test]
    fn pins_first_chapter_to_zero_and_merges_short_blocks() {
        // Block 1 starts at 5s in montage, pinned to 00:00 (covers 0..16s = 16s >= 10s).
        // Block 2 (16..22s = 6s < 10s) merges with previous (Block 1).
        // Block 3 (22..34s = 12s >= 10s), Block 4 (34..46s = 12s >= 10s).
        let p = plan(
            vec![
                resolved_block(1, 1, "Abertura", 5_000_000, 10_000_000),
                resolved_block(2, 2, "Curto", 16_000_000, 5_000_000),
                resolved_block(3, 3, "Virada", 22_000_000, 11_000_000),
                resolved_block(4, 4, "Fechamento", 34_000_000, 12_000_000),
            ],
            46_000_000,
        );
        let entries = build_chapters_from_plan(&p).unwrap();
        assert_eq!(
            entries,
            vec![
                ChapterEntry {
                    start_secs: 0,
                    timestamp: "00:00".into(),
                    title: "Abertura".into(),
                },
                ChapterEntry {
                    start_secs: 22,
                    timestamp: "00:22".into(),
                    title: "Virada".into(),
                },
                ChapterEntry {
                    start_secs: 34,
                    timestamp: "00:34".into(),
                    title: "Fechamento".into(),
                },
            ]
        );
    }

    #[test]
    fn first_short_block_merges_with_next() {
        // Block 1 (0..4s < 10s) merges with Block 2 (4..18s) -> Block 1 covers 0..18s (18s).
        let p = plan(
            vec![
                resolved_block(1, 1, "Intro", 0, 4_000_000),
                resolved_block(2, 2, "Contexto", 4_000_000, 14_000_000),
                resolved_block(3, 3, "Analise", 18_000_000, 12_000_000),
                resolved_block(4, 4, "Fim", 30_000_000, 12_000_000),
            ],
            42_000_000,
        );
        let entries = build_chapters_from_plan(&p).unwrap();
        assert_eq!(entries.len(), 3);
        assert_eq!(entries[0].timestamp, "00:00");
        assert_eq!(entries[0].title, "Intro");
        assert_eq!(entries[1].timestamp, "00:18");
        assert_eq!(entries[2].timestamp, "00:30");
    }

    #[test]
    fn rejects_when_fewer_than_three_chapters_remain_after_merging() {
        let p = plan(
            vec![
                resolved_block(1, 1, "Um", 0, 12_000_000),
                resolved_block(2, 2, "Dois", 12_000_000, 12_000_000),
                resolved_block(3, 3, "Tres curto", 24_000_000, 5_000_000),
            ],
            29_000_000,
        );
        let err = build_chapters_from_plan(&p).unwrap_err();
        assert_eq!(err.code, "too_few_chapters");
    }

    #[test]
    fn delimited_block_replacement_preserves_surrounding_text() {
        let desc = "Resumo editado.\n\n--- Capítulos ---\n00:00 A\n00:10 B\n00:20 C\n--- Fim dos capítulos ---\n\nNota final.";
        let updated = replace_delimited_block(
            desc,
            "--- Capítulos ---\n00:00 A\n00:15 B\n00:30 C\n--- Fim dos capítulos ---",
        )
        .unwrap();
        assert_eq!(
            updated,
            "Resumo editado.\n\n--- Capítulos ---\n00:00 A\n00:15 B\n00:30 C\n--- Fim dos capítulos ---\n\nNota final."
        );
        assert!(replace_delimited_block("Sem delimitadores", "--- Capítulos ---").is_none());
    }

    #[test]
    fn manual_validation_flags_youtube_rules_without_false_positives_in_prose() {
        assert!(validate_description_chapters("Aos 12:30 ele contou a história.", None).is_empty());

        let valid = "--- Capítulos ---\n00:00 A\n00:10 B\n00:20 C\n--- Fim dos capítulos ---";
        assert!(validate_description_chapters(valid, Some(35)).is_empty());

        let broken = "--- Capítulos ---\n00:05 A\n00:10 B\n--- Fim dos capítulos ---";
        let codes: Vec<String> = validate_description_chapters(broken, Some(15))
            .into_iter()
            .map(|w| w.code)
            .collect();
        assert!(codes.contains(&"first_chapter_not_zero".to_string()));
        assert!(codes.contains(&"too_few_chapters".to_string()));
        assert!(codes.contains(&"chapter_too_short".to_string()));
    }
}
