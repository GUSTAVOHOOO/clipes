use clipes_core::sentences::{segment, WordRow};

fn word(position: i64, text: &str, start: i64, end: i64) -> WordRow {
    WordRow {
        position,
        text: text.into(),
        start_us: start,
        end_us: end,
        language: Some("pt".into()),
    }
}

#[test]
fn punctuation_and_pauses_end_sentences() {
    let rows = vec![
        word(0, "Olá.", 0, 100_000),
        word(1, "Como", 200_000, 300_000),
        word(2, "vai", 1_000_000, 1_100_000),
    ];
    let result = segment(&rows);
    assert_eq!(
        result.iter().map(|s| (&*s.text, s.id)).collect::<Vec<_>>(),
        vec![("Olá.", 1), ("Como", 2), ("vai", 3)]
    );
}

#[test]
fn long_sentence_splits_at_largest_internal_pause() {
    let rows = vec![
        word(0, "um", 0, 1_000_000),
        word(1, "dois", 1_100_000, 10_000_000),
        word(2, "três", 10_500_000, 26_000_000),
    ];
    let result = segment(&rows);
    assert_eq!(
        result.iter().map(|s| &*s.text).collect::<Vec<_>>(),
        vec!["um dois", "três"]
    );
}
