//! Uma única preparação de legenda para libass e para o preview. Tempos em µs.
use crate::CoreError;
use serde::{Deserialize, Serialize};

pub const MIN_WORD_US: i64 = 10_000;
pub const ASS_TICK_US: i64 = 10_000;
pub const WORDS_PER_LINE: usize = 3;
pub const CHARS_PER_LINE: usize = 24;
pub const LINES_PER_CUE: usize = 2;
pub const FONT_FAMILY: &str = "Noto Sans";

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq, Eq)]
pub struct CaptionWord {
    pub text: String,
    pub start_us: i64,
    pub end_us: i64,
}

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq, Eq)]
pub struct MissingGlyph {
    pub position: i64,
    #[serde(skip_serializing_if = "Option::is_none", default)]
    pub sentence_id: Option<i64>,
    pub word: String,
    pub char: String,
    pub codepoint: String,
    pub start_us: i64,
}

pub struct GlyphWord<'a> {
    pub position: i64,
    pub sentence_id: Option<i64>,
    pub text: &'a str,
    pub start_us: i64,
}

/// Confere no `cmap` da fonte se um caractere tem glifo.
pub fn font_has_glyph(font_bytes: &[u8], ch: char) -> bool {
    super::font_cmap::coverage_for(font_bytes).is_some_and(|cov| cov.contains(ch))
}

/// Valida cada palavra visível contra o `cmap` de `font_bytes` usando o mesmo escape ASS.
pub fn check_words_glyphs<'a>(
    words: impl IntoIterator<Item = GlyphWord<'a>>,
    font_bytes: &[u8],
) -> Vec<MissingGlyph> {
    let Some(coverage) = super::font_cmap::coverage_for(font_bytes) else {
        return Vec::new();
    };
    let mut missing = Vec::new();
    for word in words {
        let visible = escape_text(word.text);
        if visible.is_empty() {
            continue;
        }
        if let Some(ch) = visible.chars().find(|&c| !coverage.contains(c)) {
            let trimmed: String = word
                .text
                .trim()
                .chars()
                .filter(|c| !c.is_control())
                .collect();
            missing.push(MissingGlyph {
                position: word.position,
                sentence_id: word.sentence_id,
                word: if trimmed.is_empty() { visible } else { trimmed },
                char: ch.to_string(),
                codepoint: format!("U+{:04X}", ch as u32),
                start_us: word.start_us,
            });
        }
    }
    missing
}

/// Checa todas as palavras dadas contra o `cmap` da fonte (para testes e validação direta).
pub fn missing_glyphs(words: &[CaptionWord], font_bytes: &[u8]) -> Vec<MissingGlyph> {
    check_words_glyphs(
        words.iter().enumerate().map(|(i, w)| GlyphWord {
            position: i as i64,
            sentence_id: None,
            text: &w.text,
            start_us: w.start_us,
        }),
        font_bytes,
    )
}

/// Checa apenas palavras visíveis dentro de `0..duration_us`.
pub fn missing_glyphs_in_duration(
    words: &[CaptionWord],
    font_bytes: &[u8],
    duration_us: i64,
) -> Vec<MissingGlyph> {
    check_words_glyphs(
        words
            .iter()
            .enumerate()
            .filter(|(_, w)| w.start_us < duration_us)
            .map(|(i, w)| GlyphWord {
                position: i as i64,
                sentence_id: None,
                text: &w.text,
                start_us: w.start_us,
            }),
        font_bytes,
    )
}

fn invalid() -> CoreError {
    CoreError {
        code: "export_timestamps".into(),
        message: "Os tempos da legenda são inválidos.".into(),
        usage: None,
    }
}

/// Não muda starts válidos. Sobreposições e intervalos impossíveis viram um token
/// com todo o texto (decisão do dev); o intervalo é a união dos tempos nativos.
pub fn sanitize(words: &[CaptionWord]) -> Result<Vec<CaptionWord>, CoreError> {
    let mut result: Vec<CaptionWord> = Vec::new();
    for word in words {
        if word.start_us < 0 || word.end_us < 0 {
            return Err(invalid());
        }
        let minimum = word.start_us.checked_add(MIN_WORD_US).ok_or_else(invalid)?;
        let mut current = word.clone();
        current.end_us = current.end_us.max(minimum);
        while result
            .last()
            .is_some_and(|prev| prev.end_us > current.start_us)
        {
            let prev = result.pop().unwrap();
            current.text = format!("{} {}", prev.text.trim(), current.text.trim());
            current.start_us = prev.start_us.min(current.start_us);
            current.end_us = prev.end_us.max(current.end_us);
        }
        result.push(current);
    }
    Ok(result)
}

/// O texto nunca pode formar tags nem escapes ASS. Os três delimitadores são trocados
/// por caracteres ASCII seguros presentes nas fontes empacotadas.
/// Emoji e seletores de apresentação são removidos antes da quebra.
pub fn escape_text(text: &str) -> String {
    text.chars()
        .filter_map(|c| match c {
            '{' => Some('('),
            '}' => Some(')'),
            '\\' => Some('/'),
            '\r' | '\n' | '\t' => Some(' '),
            '\u{200d}' | '\u{fe0e}' | '\u{fe0f}' | '\u{20e3}' | '\u{00a9}' | '\u{00ae}' => None,
            '\u{2300}'..='\u{23ff}'
            | '\u{2600}'..='\u{27ff}'
            | '\u{1f000}'..='\u{1faff}'
            | '\u{e0020}'..='\u{e007f}' => None,
            _ if c.is_control() => None,
            _ => Some(c),
        })
        .collect::<String>()
        .split_whitespace()
        .collect::<Vec<_>>()
        .join(" ")
}

/// Quebras determinísticas compartilhadas pelo preview (`export.captions`).
/// O índice do token e seu tempo não mudam quando uma linha quebra.
pub fn layout(words: &[CaptionWord]) -> Vec<Vec<CaptionWord>> {
    let mut lines: Vec<Vec<CaptionWord>> = Vec::new();
    let mut length = 0;
    for word in words {
        let text = escape_text(&word.text);
        if text.is_empty() {
            continue;
        }
        let size = text.chars().count();
        if lines
            .last()
            .is_none_or(|line| line.len() >= WORDS_PER_LINE || length + 1 + size > CHARS_PER_LINE)
        {
            lines.push(Vec::new());
            length = 0;
        }
        if length > 0 {
            length += 1;
        }
        length += size;
        let mut visible = word.clone();
        visible.text = text;
        lines.last_mut().unwrap().push(visible);
    }
    lines
}

fn time(us: i64) -> String {
    let cs = us / ASS_TICK_US;
    format!(
        "{}:{:02}:{:02}.{:02}",
        cs / 360_000,
        cs / 6_000 % 60,
        cs / 100 % 60,
        cs % 100
    )
}

/// `\kf` usa somente a quantização de centésimos que o ASS exige, sem alinhamento
/// extra. Pausas são sílabas invisíveis de duração própria, sem esticar palavras.
pub fn ass(words: &[CaptionWord], duration_us: i64) -> Result<String, CoreError> {
    if duration_us <= 0 {
        return Err(invalid());
    }
    let words = sanitize(words)?;
    let lines = layout(&words);
    let mut out = format!("[Script Info]\nScriptType: v4.00+\nPlayResX: 1080\nPlayResY: 1920\nScaledBorderAndShadow: yes\nWrapStyle: 2\n\n[V4+ Styles]\nFormat: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding\nStyle: Default,{FONT_FAMILY},64,&H0015CCFA,&H00FFFFFF,&H00101010,&H00000000,-1,0,0,0,100,100,0,0,1,6,0,2,80,80,480,1\n\n[Events]\nFormat: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text\n");
    for cue in lines.chunks(LINES_PER_CUE) {
        let first = &cue[0][0];
        let last = cue.last().unwrap().last().unwrap();
        if first.start_us >= duration_us {
            break;
        }
        let end = last.end_us.min(duration_us);
        let mut cursor = first.start_us / ASS_TICK_US;
        let mut text = String::new();
        for (line_no, line) in cue.iter().enumerate() {
            if line_no > 0 {
                text.push_str("\\N");
            }
            for (i, word) in line.iter().enumerate() {
                if i > 0 {
                    text.push(' ');
                }
                let start = word.start_us / ASS_TICK_US;
                if start > cursor {
                    text.push_str(&format!("{{\\k{}}}\\h", start - cursor));
                }
                let word_end = word.end_us.min(duration_us) / ASS_TICK_US;
                text.push_str(&format!(
                    "{{\\kf{}}}{}",
                    (word_end - start).max(1),
                    word.text
                ));
                cursor = word_end;
            }
        }
        out.push_str(&format!(
            "Dialogue: 0,{},{},Default,,0,0,0,,{}\n",
            time(first.start_us),
            time(end),
            text
        ));
    }
    Ok(out)
}
