use super::*;
use crate::sentences::{self, Sentence};

const RATE: u32 = SAMPLE_RATE;

/// Tom de 440 Hz com a amplitude de cada segundo dada por `amp(segundo)`, em PCM `s16le`.
fn tone(seconds: usize, amp: impl Fn(usize) -> f64) -> Vec<u8> {
    let mut out = Vec::with_capacity(seconds * RATE as usize * 2);
    for n in 0..seconds * RATE as usize {
        let t = n as f64 / f64::from(RATE);
        let sample = (amp(n / RATE as usize) * (2.0 * std::f64::consts::PI * 440.0 * t).sin())
            .round() as i16;
        out.extend_from_slice(&sample.to_le_bytes());
    }
    out
}

fn blocks_of(pcm: &[u8]) -> Vec<f64> {
    let mut meter = BlockMeter::default();
    // Em pedaços de tamanho ímpar: o byte pendente entre pedaços não pode perder amostra.
    for chunk in pcm.chunks(4097) {
        meter.push(chunk);
    }
    meter.finish()
}

/// `n` Frases de 5 s, sem pausas.
fn frases(n: i64) -> Vec<Sentence> {
    (0..n)
        .map(|i| Sentence {
            id: i + 1,
            first_position: i * 3,
            last_position: i * 3 + 2,
            start_us: i * 5_000_000,
            end_us: (i + 1) * 5_000_000,
            language: Some("pt".into()),
            text: "uma frase qualquer.".into(),
        })
        .collect()
}

fn levels_of(frases: &[Sentence], blocks: &[f64]) -> Vec<EnergyLevel> {
    let loudness: Vec<Option<i64>> = frases
        .iter()
        .map(|s| sentence_loudness(blocks, s.start_us, s.end_us))
        .collect();
    levels(&loudness)
}

#[test]
fn block_meter_is_exact_and_keeps_the_odd_byte_between_chunks() {
    let pcm = tone(3, |_| 1000.0);
    let blocks = blocks_of(&pcm);
    assert_eq!(blocks.len(), 30);
    let rms_centi_db = centi_db(blocks[10]);
    // 1000 de amplitude: RMS 707, -33,3 dBFS.
    assert!((rms_centi_db + 3330).abs() <= 15, "{rms_centi_db}");
}

#[test]
fn loud_stretches_of_a_synthetic_tone_get_the_marks() {
    // 40 Frases de 5 s: som baixo, uma Frase forte (s20) e duas Frases com grito (s10, s30).
    let loud_at = |second: usize| match second / 5 + 1 {
        10 | 30 => 20_000.0,
        20 => 6_000.0,
        _ => 1_000.0,
    };
    let blocks = blocks_of(&tone(200, loud_at));
    let frases = frases(40);
    let levels = levels_of(&frases, &blocks);
    assert_eq!(levels[9], EnergyLevel::Peak);
    assert_eq!(levels[29], EnergyLevel::Peak);
    assert_eq!(levels[19], EnergyLevel::High);
    assert_eq!(
        levels.iter().filter(|l| mark(**l).is_some()).count(),
        3,
        "só as três Frases fortes têm marca"
    );
    assert_eq!(mark(EnergyLevel::High), Some("[energia alta]"));
    assert_eq!(mark(EnergyLevel::Peak), Some("[energia pico]"));
    assert_eq!(mark(EnergyLevel::Mid), None);
    assert_eq!(mark(EnergyLevel::Low), None);
}

#[test]
fn a_short_shout_inside_a_long_sentence_still_counts() {
    // Uma Frase de 5 s com só 0,5 s de grito: o maior momentâneo (400 ms), não a média, decide.
    let sentence_samples = RATE as usize * 5;
    let shout = |n: usize| -> f64 {
        // Frase 10, de 2,5 s a 3,0 s dentro dela.
        let (index, offset) = (n / sentence_samples, n % sentence_samples);
        if index == 9 && (40_000..48_000).contains(&offset) {
            20_000.0
        } else {
            1_000.0
        }
    };
    let mut pcm = Vec::new();
    for n in 0..200 * RATE as usize {
        let t = n as f64 / f64::from(RATE);
        let sample = (shout(n) * (2.0 * std::f64::consts::PI * 440.0 * t).sin()).round() as i16;
        pcm.extend_from_slice(&sample.to_le_bytes());
    }
    let blocks = blocks_of(&pcm);
    let frases = frases(40);
    let levels = levels_of(&frases, &blocks);
    assert_eq!(levels[9], EnergyLevel::Peak);
}

#[test]
fn a_source_without_variation_has_no_peak_and_no_mark() {
    let frases = frases(40);
    let flat = blocks_of(&tone(200, |_| 3_000.0));
    assert!(levels_of(&frases, &flat)
        .iter()
        .all(|l| *l == EnergyLevel::Mid));
    // Variação pequena (menos de 3 dB da mediana) também não marca ninguém.
    let wobble = blocks_of(&tone(
        200,
        |s| if (s / 5) % 2 == 0 { 3_000.0 } else { 3_600.0 },
    ));
    assert!(levels_of(&frases, &wobble)
        .iter()
        .all(|l| mark(*l).is_none()));
}

#[test]
fn few_sentences_and_silence_get_no_marks() {
    let blocks = blocks_of(&tone(30, |s| if s / 5 == 2 { 20_000.0 } else { 500.0 }));
    // 6 Frases: abaixo do mínimo para percentis.
    assert!(levels_of(&frases(6), &blocks)
        .iter()
        .all(|l| *l == EnergyLevel::Mid));
    // Frases mudas ficam fora das estatísticas e nunca ganham marca.
    let silent = blocks_of(&vec![0u8; 200 * RATE as usize * 2]);
    let l = levels_of(&frases(40), &silent);
    assert!(l.iter().all(|l| *l == EnergyLevel::Mid));
    assert_eq!(
        sentence_loudness(&silent, 0, 5_000_000),
        Some(SILENCE_FLOOR_CENTI)
    );
    // Frase além do fim do áudio: sem medida.
    assert_eq!(sentence_loudness(&silent, 900_000_000, 905_000_000), None);
}

#[test]
fn loudness_is_not_affected_by_other_sentences() {
    // Frase mais curta que a janela momentânea usa os blocos que tem.
    let blocks = blocks_of(&tone(10, |_| 1_000.0));
    let short = sentence_loudness(&blocks, 0, 150_000).unwrap();
    let long = sentence_loudness(&blocks, 0, 5_000_000).unwrap();
    assert!((short - long).abs() <= 20);
}

#[test]
fn marked_text_has_the_mark_and_costs_more_characters() {
    let frases = frases(3);
    let mut marks = EnergyMarks::new();
    marks.insert(2, EnergyLevel::High);
    marks.insert(3, EnergyLevel::Peak);
    let text = sentences::compact_marked(&frases, &marks);
    assert_eq!(
        text,
        "## 00:00\n1 uma frase qualquer.\n2 [energia alta] uma frase qualquer.\n3 [energia pico] uma frase qualquer.\n"
    );
    let plain = sentences::compact(&frases);
    assert_eq!(
        plain,
        sentences::compact_marked(&frases, &EnergyMarks::new())
    );
    assert!(text.chars().count() > plain.chars().count());
    // Sem número de loudness nem tempo na marca.
    assert!(!text.contains("dB") && !text.contains("loud"));
    let hinted = sentences::compact_with_hint_marked(&frases, &marks);
    assert_eq!(hinted.text, text);
    let plain_hint = sentences::compact_with_hint(&frases).hint;
    assert_eq!(
        (hinted.hint.format, hinted.hint.language),
        (plain_hint.format, plain_hint.language)
    );
}
