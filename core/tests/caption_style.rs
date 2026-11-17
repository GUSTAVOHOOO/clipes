use clipes_core::{
    caption_style::{prepare, Preset, Style, StyledWord, WordOverride},
    export::captions::CaptionWord,
};

fn words() -> Vec<StyledWord> {
    ["Uma", "fala", "curta", "com", "legenda", "bem", "legível."]
        .iter()
        .enumerate()
        .map(|(i, text)| StyledWord {
            word: CaptionWord {
                text: (*text).into(),
                start_us: i as i64 * 400_000,
                end_us: i as i64 * 400_000 + 300_000,
            },
            position: i as i64,
            overrides: WordOverride::default(),
        })
        .collect()
}

#[test]
fn presets_share_explicit_breaks_and_keep_word_overrides() {
    for preset in [Preset::Vertical, Preset::Cinema, Preset::Simple] {
        let style = Style::preset(preset);
        let mut input = words();
        input[0].overrides.color = Some("#FF0000".into());
        input[0].overrides.highlight = Some(false);
        let prepared = prepare(&input, &style, 3_000_000).unwrap();
        assert!(prepared.ass.contains("WrapStyle: 2"));
        assert!(prepared.ass.contains("&H0000FF&"));
        assert!(prepared.cues.iter().all(|cue| cue.lines.len() <= 2));
        assert_eq!(
            prepared
                .cues
                .iter()
                .flat_map(|c| &c.lines)
                .flatten()
                .map(|w| w.text.as_str())
                .collect::<Vec<_>>(),
            words()
                .iter()
                .map(|w| w.word.text.as_str())
                .collect::<Vec<_>>()
        );
        if preset == Preset::Vertical {
            assert!(prepared
                .cues
                .iter()
                .all(|c| c.lines.len() == 1 && c.lines[0].len() <= 3));
        }
        assert_eq!(
            prepared.ass.contains(r"\fad(120,120)"),
            preset == Preset::Cinema
        );
        assert_eq!(prepared.ass.contains(r"\kf"), preset != Preset::Simple);
    }
}

#[test]
fn style_rejects_unsafe_or_unrenderable_values() {
    let mut style = Style::preset(Preset::Vertical);
    assert!(style.validate().is_ok());
    style.font = "Arial".into();
    assert_eq!(style.validate().unwrap_err().code, "caption_style_invalid");
    style.font = "Noto Sans".into();
    style.active_color = "{\\pos(0,0)}".into();
    assert!(style.validate().is_err());
    style.active_color = "#FFFFFF".into();
    style.font_size = 0;
    assert!(style.validate().is_err());
}

#[test]
fn cinema_balances_lines_and_emoji_never_reaches_either_renderer() {
    let mut input = words();
    input[0].word.text = "Uma😀".into();
    let prepared = prepare(&input, &Style::preset(Preset::Cinema), 3_000_000).unwrap();
    assert_eq!(prepared.emoji_removed, 1);
    assert!(!prepared.ass.contains('😀'));
    assert_eq!(prepared.cues[0].lines.len(), 2);
    let lengths: Vec<_> = prepared.cues[0]
        .lines
        .iter()
        .map(|l| l.iter().map(|w| w.text.chars().count() + 1).sum::<usize>())
        .collect();
    assert!(lengths[0].abs_diff(lengths[1]) <= 10);
    assert!(prepared.ass.contains(r"\N"));
}

#[test]
fn hidden_words_are_omitted_from_cues_and_ass_without_merging_into_neighbors() {
    let mut input = words();
    input[1].word.text = "fala😀".into();
    input[1].word.end_us = 950_000; // sobrepõe input[2], mas oculta não deve se fundir
    input[1].overrides.hidden = Some(true);
    let prepared = prepare(&input, &Style::preset(Preset::Vertical), 3_000_000).unwrap();
    assert_eq!(prepared.emoji_removed, 0);
    let visible: Vec<_> = prepared
        .cues
        .iter()
        .flat_map(|c| &c.lines)
        .flatten()
        .map(|w| w.text.as_str())
        .collect();
    assert_eq!(
        visible,
        ["Uma", "curta", "com", "legenda", "bem", "legível."]
    );
    assert!(!prepared.ass.contains("fala"));

    for w in &mut input {
        w.overrides.hidden = Some(true);
    }
    let all_hidden = prepare(&input, &Style::preset(Preset::Vertical), 3_000_000).unwrap();
    assert!(all_hidden.cues.is_empty());
    assert!(!all_hidden.ass.contains("Dialogue:"));
}
