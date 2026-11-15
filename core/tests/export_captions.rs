use clipes_core::export::captions::{ass, escape_text, layout, sanitize, CaptionWord, MIN_WORD_US};

fn word(text: &str, start_us: i64, end_us: i64) -> CaptionWord {
    CaptionWord {
        text: text.into(),
        start_us,
        end_us,
    }
}

#[test]
fn native_times_stay_native_and_impossible_words_merge_without_losing_text() {
    let valid = vec![
        word("Olá", 100_000, 300_000),
        word("mundo", 500_000, 800_000),
    ];
    assert_eq!(sanitize(&valid).unwrap(), valid);
    for words in [
        vec![
            word("uma", 100_000, 400_000),
            word("fala", 300_000, 500_000),
        ],
        vec![
            word("uma", 100_000, 100_001),
            word("fala", 105_000, 500_000),
        ],
        vec![word("uma", 100_000, 90_000), word("fala", 105_000, 500_000)],
        vec![
            word("uma", 300_000, 400_000),
            word("fala", 100_000, 500_000),
        ],
    ] {
        let merged = sanitize(&words).unwrap();
        assert_eq!(merged.len(), 1);
        assert_eq!(merged[0].text, "uma fala");
        assert_eq!(merged[0].end_us, 500_000);
    }
    let repaired = sanitize(&[word("curta", 10_000, 0), word("fim", 40_000, 80_000)]).unwrap();
    assert_eq!(repaired[0].end_us, 10_000 + MIN_WORD_US);
    let chain = sanitize(&[
        word("a", 0, 600_000),
        word("b", 200_000, 400_000),
        word("c", 500_000, 900_000),
    ])
    .unwrap();
    assert_eq!(chain, vec![word("a b c", 0, 900_000)]);
    assert!(sanitize(&[word("inválida", -1, 3)]).is_err());
}

#[test]
fn untrusted_text_cannot_inject_ass_tags_linebreaks_or_color_emoji() {
    let escaped = escape_text(r"{\pos(0,0)} texto \N \kf999 😀🎉 coração❤️");
    assert!(!escaped.contains(r"{\pos"));
    assert!(!escaped.contains(r"\N"));
    assert!(!escaped.contains(r"\kf999"));
    assert!(!escaped.contains('😀'));
    assert!(!escaped.contains('🎉'));
    assert!(!escaped.contains('❤'));
    assert!(escaped.contains("texto"));
    assert!(escaped.contains('｛') && escaped.contains('｝') && escaped.contains('＼'));
}

#[test]
fn ass_has_explicit_resolution_breaks_and_native_karaoke_gaps() {
    let words = vec![
        word("Olá", 100_000, 300_000),
        word("mundo!", 500_000, 800_000),
    ];
    let content = ass(&words, 1_000_000).unwrap();
    for line in [
        "PlayResX: 1080",
        "PlayResY: 1920",
        "ScaledBorderAndShadow: yes",
        "WrapStyle: 2",
        "Noto Sans",
        r"{\kf20}Olá",
        r"{\k20}",
        r"{\kf30}mundo!",
    ] {
        assert!(content.contains(line), "missing {line}: {content}");
    }
    let lines = layout(&[
        word("Uma", 0, 1),
        word("fala", 1, 2),
        word("curta", 2, 3),
        word("aqui", 3, 4),
    ]);
    assert_eq!(lines[0].len(), 3);
    assert_eq!(lines[1].len(), 1);
    assert_eq!(layout(&[]).len(), 0);
}
