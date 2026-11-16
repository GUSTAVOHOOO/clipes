use super::{Preset, Style, StyledWord};
use crate::{
    export::captions::{self, CaptionWord, ASS_TICK_US},
    CoreError,
};
use serde::{Deserialize, Serialize};

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct VisibleWord {
    pub text: String,
    pub start_us: i64,
    pub end_us: i64,
    pub position: i64,
    pub color: String,
    pub active_color: String,
    pub highlight: bool,
}
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Cue {
    pub start_us: i64,
    pub end_us: i64,
    pub lines: Vec<Vec<VisibleWord>>,
}
#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Prepared {
    pub ass: String,
    pub cues: Vec<Cue>,
    pub style: Style,
    pub emoji_removed: usize,
}

pub fn has_emoji(text: &str) -> bool {
    text.chars().any(|c| matches!(c,'\u{200d}'|'\u{fe0e}'|'\u{fe0f}'|'\u{20e3}'|'\u{00a9}'|'\u{00ae}'|'\u{2300}'..='\u{23ff}'|'\u{2600}'..='\u{27ff}'|'\u{1f000}'..='\u{1faff}'|'\u{e0020}'..='\u{e007f}'))
}
fn size(words: &[VisibleWord]) -> usize {
    words.iter().map(|w| w.text.chars().count()).sum::<usize>() + words.len().saturating_sub(1)
}
fn balanced(words: &[VisibleWord], max: usize) -> Option<usize> {
    (1..words.len())
        .filter(|&i| size(&words[..i]) <= max && size(&words[i..]) <= max)
        .min_by_key(|&i| size(&words[..i]).abs_diff(size(&words[i..])))
}

/// Sanitização do #59 conserva todas as palavras mesmo em tempos impossíveis.
/// A quantização é compartilhada: CSS e ASS trabalham nos mesmos centésimos.
pub fn prepare(
    input: &[StyledWord],
    style: &Style,
    duration_us: i64,
) -> Result<Prepared, CoreError> {
    style.validate()?;
    if duration_us <= 0 {
        return Err(super::invalid());
    }
    for w in input {
        w.overrides.validate()?;
    }
    let raw: Vec<CaptionWord> = input.iter().map(|w| w.word.clone()).collect();
    let clean = captions::sanitize(&raw)?;
    let words: Vec<_> = clean
        .iter()
        .filter_map(|word| {
            let text = captions::escape_text(&word.text);
            if text.is_empty() || word.start_us >= duration_us {
                return None;
            }
            let original = input
                .iter()
                .find(|w| w.word.start_us >= word.start_us && w.word.start_us < word.end_us)?;
            Some(VisibleWord {
                text,
                start_us: word.start_us / ASS_TICK_US * ASS_TICK_US,
                end_us: (word.end_us.min(duration_us) / ASS_TICK_US * ASS_TICK_US)
                    .max(word.start_us / ASS_TICK_US * ASS_TICK_US + ASS_TICK_US)
                    .min(duration_us),
                position: original.position,
                color: original
                    .overrides
                    .color
                    .clone()
                    .unwrap_or_else(|| style.color.clone()),
                active_color: original
                    .overrides
                    .active_color
                    .clone()
                    .unwrap_or_else(|| style.active_color.clone()),
                highlight: style.highlight && original.overrides.highlight.unwrap_or(true),
            })
        })
        .collect();
    let mut cues = Vec::new();
    let mut i = 0;
    while i < words.len() {
        let max_chars = if style.preset == Preset::Vertical {
            18
        } else {
            36
        };
        let mut end = i + 1;
        while end < words.len() {
            let next = &words[i..=end];
            let fits = if style.preset == Preset::Vertical {
                next.len() <= 3 && size(next) <= max_chars
            } else {
                size(next) <= max_chars || balanced(next, max_chars).is_some()
            };
            if !fits || words[end].start_us - words[end - 1].end_us > 800_000 {
                break;
            }
            end += 1;
        }
        let block = &words[i..end];
        let lines = if style.preset != Preset::Vertical && size(block) > 18 {
            match balanced(block, max_chars) {
                Some(split) => vec![block[..split].to_vec(), block[split..].to_vec()],
                None => vec![block.to_vec()],
            }
        } else {
            vec![block.to_vec()]
        };
        cues.push(Cue {
            start_us: block[0].start_us,
            end_us: block.last().unwrap().end_us,
            lines,
        });
        i = end;
    }
    let ass = ass(&cues, style);
    Ok(Prepared {
        ass,
        cues,
        style: style.clone(),
        emoji_removed: input.iter().filter(|w| has_emoji(&w.word.text)).count(),
    })
}
fn color(c: &str) -> String {
    format!("&H{}{}{}&", &c[5..7], &c[3..5], &c[1..3])
}
fn time(us: i64) -> String {
    let cs = us / ASS_TICK_US;
    format!(
        "{}:{:02}:{:02}.{:02}",
        cs / 360000,
        cs / 6000 % 60,
        cs / 100 % 60,
        cs % 100
    )
}
fn ass(cues: &[Cue], s: &Style) -> String {
    let mut out=format!("[Script Info]\nScriptType: v4.00+\nPlayResX: 1080\nPlayResY: 1920\nScaledBorderAndShadow: yes\nWrapStyle: 2\n\n[V4+ Styles]\nFormat: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding\nStyle: Default,{},{},{},{},{},&H00000000,-1,0,0,0,100,100,0,0,1,{},{},2,0,0,0,1\n\n[Events]\nFormat: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text\n",s.font,s.font_size,color(&s.active_color),color(&s.color),color(&s.outline_color),s.outline,s.shadow);
    for cue in cues {
        let mut text = format!(
            "{{\\an2\\pos({},{}){}}}",
            s.x,
            s.y,
            if s.preset == Preset::Cinema {
                "\\fad(120,120)"
            } else {
                ""
            }
        );
        let mut cursor = cue.start_us / ASS_TICK_US;
        for (line_no, line) in cue.lines.iter().enumerate() {
            if line_no > 0 {
                text.push_str("\\N");
            }
            for (n, w) in line.iter().enumerate() {
                if n > 0 {
                    text.push(' ');
                }
                let start = w.start_us / ASS_TICK_US;
                if start > cursor {
                    text.push_str(&format!("{{\\k{}}}\\h", start - cursor));
                }
                let end = w.end_us / ASS_TICK_US;
                if w.highlight {
                    text.push_str(&format!(
                        "{{\\1c{}\\2c{}\\kf{}\\t({},{},\\1c{})}}{}",
                        color(&w.active_color),
                        color(&w.color),
                        (end - start).max(1),
                        (w.end_us - cue.start_us) / 1000,
                        (w.end_us - cue.start_us) / 1000,
                        color(&s.dim_color),
                        w.text
                    ));
                } else {
                    text.push_str(&format!(
                        "{{\\1c{}\\2c{}\\k{}}}{}",
                        color(&w.color),
                        color(&w.color),
                        (end - start).max(1),
                        w.text
                    ));
                }
                cursor = end;
            }
        }
        out.push_str(&format!(
            "Dialogue: 0,{},{},Default,,0,0,0,,{}\n",
            time(cue.start_us),
            time(cue.end_us),
            text
        ));
    }
    out
}
