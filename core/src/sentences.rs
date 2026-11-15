//! Frases: a Transcrição segmentada na unidade que tudo o que vem depois aponta (#49).
//!
//! Uma Frase termina na pontuação do Whisper ou numa pausa de pelo menos 700 ms; uma Frase
//! com mais de 25 s é quebrada na maior pausa interna, recursivamente. O ID é um inteiro
//! sequencial por Transcrição (portanto por Fonte), começando em 1: a segmentação é uma função
//! pura das palavras, então as mesmas palavras geram sempre os mesmos IDs. O formato compacto
//! da pesquisa #115 manda Frases ao Provedor por esse ID, nunca por UUID.
//!
//! A segmentação roda ao fim do job de transcrição (e sob demanda, para Transcrições antigas)
//! e é idempotente: se as Frases gravadas já são as calculadas, nada é escrito.

use crate::{projects, CommandRegistration, CommandResult, CoreError, EventSink};
use rusqlite::OptionalExtension;
use serde_json::{json, Value};

/// Pausa entre duas palavras a partir da qual a Frase termina.
pub const PAUSE_US: i64 = 700_000;
/// Duração máxima de uma Frase antes de ser quebrada na maior pausa interna.
pub const MAX_SENTENCE_US: i64 = 25_000_000;

inventory::submit! { projects::Migration { id: "0049_001_sentences", sql: "CREATE TABLE sentences (transcript_id INTEGER NOT NULL REFERENCES transcripts(id) ON DELETE CASCADE, id INTEGER NOT NULL, first_position INTEGER NOT NULL, last_position INTEGER NOT NULL, start_us INTEGER NOT NULL, end_us INTEGER NOT NULL, language TEXT, text TEXT NOT NULL, PRIMARY KEY (transcript_id, id)) WITHOUT ROWID; CREATE INDEX sentences_by_time ON sentences(transcript_id, start_us);" } }

fn error(code: &str, message: &str) -> CoreError {
    CoreError {
        code: code.into(),
        message: message.into(),
        usage: None,
    }
}

/// Uma palavra da Transcrição, com a posição que ela tem no Projeto.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct WordRow {
    pub position: i64,
    pub text: String,
    pub start_us: i64,
    pub end_us: i64,
    pub language: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Sentence {
    pub id: i64,
    pub first_position: i64,
    pub last_position: i64,
    pub start_us: i64,
    pub end_us: i64,
    pub language: Option<String>,
    pub text: String,
}

/// A palavra fecha uma Frase quando termina em `.`, `!`, `?` ou `…`, mesmo seguida de
/// aspas ou fecha-parênteses.
fn ends_sentence(text: &str) -> bool {
    text.trim_end_matches(['"', '\'', '”', '’', ')', ']', '»'])
        .ends_with(['.', '!', '?', '…', '。', '！', '？'])
}

fn gap(words: &[WordRow], i: usize) -> i64 {
    (words[i + 1].start_us - words[i].end_us).max(0)
}

/// Quebra `[first, last]` (índices em `words`) enquanto passar de 25 s, sempre na maior pausa
/// interna; empate fica com a pausa mais perto do meio da Frase, depois com a primeira.
fn split_long(words: &[WordRow], first: usize, last: usize, out: &mut Vec<(usize, usize)>) {
    let start = words[first].start_us;
    let end = words[last].end_us;
    if last == first || end - start <= MAX_SENTENCE_US {
        out.push((first, last));
        return;
    }
    let middle = start + (end - start) / 2;
    let cut = (first..last)
        .min_by_key(|&i| {
            (
                std::cmp::Reverse(gap(words, i)),
                (words[i].end_us - middle).abs(),
                i,
            )
        })
        .expect("faixa com pelo menos duas palavras");
    split_long(words, first, cut, out);
    split_long(words, cut + 1, last, out);
}

/// Idioma da Frase: o mais frequente entre as palavras; empate fica com o que aparece primeiro.
fn language_of(words: &[WordRow]) -> Option<String> {
    let mut counts: Vec<(&str, usize)> = Vec::new();
    for language in words.iter().filter_map(|w| w.language.as_deref()) {
        match counts.iter_mut().find(|(l, _)| *l == language) {
            Some((_, n)) => *n += 1,
            None => counts.push((language, 1)),
        }
    }
    let mut best: Option<(&str, usize)> = None;
    for (language, n) in counts {
        if best.is_none_or(|(_, b)| n > b) {
            best = Some((language, n));
        }
    }
    best.map(|(l, _)| l.to_owned())
}

/// Texto de uma Frase a partir do texto das suas palavras (aparado, sem vazios, com um espaço).
pub(crate) fn join_text<'a>(words: impl Iterator<Item = &'a str>) -> String {
    words
        .map(str::trim)
        .filter(|t| !t.is_empty())
        .collect::<Vec<_>>()
        .join(" ")
}

/// Segmenta as palavras (em ordem de posição) em Frases com IDs 1, 2, 3…
pub fn segment(words: &[WordRow]) -> Vec<Sentence> {
    let mut ranges: Vec<(usize, usize)> = Vec::new();
    let mut first = 0;
    for i in 0..words.len() {
        let last_word = i + 1 == words.len();
        if last_word || ends_sentence(&words[i].text) || gap(words, i) >= PAUSE_US {
            split_long(words, first, i, &mut ranges);
            first = i + 1;
        }
    }
    ranges
        .into_iter()
        .enumerate()
        .map(|(n, (first, last))| {
            let slice = &words[first..=last];
            Sentence {
                id: n as i64 + 1,
                first_position: slice[0].position,
                last_position: slice[slice.len() - 1].position,
                start_us: slice[0].start_us,
                end_us: slice[slice.len() - 1].end_us,
                language: language_of(slice),
                text: join_text(slice.iter().map(|w| w.text.as_str())),
            }
        })
        .collect()
}

/// Segmenta a Transcrição completa e grava as Frases; devolve `(quantidade, mudou)`.
/// Idempotente: Frases já gravadas e iguais às calculadas não são tocadas.
pub(crate) fn segment_transcript(transcript: i64) -> Result<(usize, bool), CoreError> {
    projects::with_writer(|conn| {
        let tx = conn.transaction()?;
        let state: Option<String> = tx
            .query_row("SELECT state FROM transcripts WHERE id=?1", [transcript], |r| r.get(0))
            .optional()?;
        if state.as_deref() != Some("complete") {
            return Ok(None);
        }
        let words = {
            let mut q = tx.prepare(
                "SELECT position, text, start_us, end_us, language FROM transcript_words WHERE transcript_id=?1 AND kind='word' ORDER BY position",
            )?;
            let rows = q.query_map([transcript], |r| {
                Ok(WordRow {
                    position: r.get(0)?,
                    text: r.get(1)?,
                    start_us: r.get(2)?,
                    end_us: r.get(3)?,
                    language: r.get(4)?,
                })
            })?;
            rows.collect::<rusqlite::Result<Vec<_>>>()?
        };
        // Fronteiras e IDs vêm só do texto original do Motor e dos tempos (estáveis por
        // contrato); o texto de cada Frase vem do texto efetivo (com as correções, #52).
        let mut computed = segment(&words);
        let effective = {
            let mut q = tx.prepare(&format!(
                "SELECT {} FROM transcript_words WHERE transcript_id=?1 AND kind='word' ORDER BY position",
                crate::corrections::EFFECTIVE_TEXT
            ))?;
            let rows = q.query_map([transcript], |r| r.get::<_, String>(0))?;
            rows.collect::<rusqlite::Result<Vec<_>>>()?
        };
        for sentence in &mut computed {
            let first = words.partition_point(|w| w.position < sentence.first_position);
            let last = words.partition_point(|w| w.position <= sentence.last_position);
            sentence.text = join_text(effective[first..last].iter().map(String::as_str));
        }
        let stored = load(&tx, transcript)?;
        let changed = stored != computed;
        if changed {
            tx.execute("DELETE FROM sentences WHERE transcript_id=?1", [transcript])?;
            let mut insert = tx.prepare(
                "INSERT INTO sentences(transcript_id, id, first_position, last_position, start_us, end_us, language, text) VALUES (?1,?2,?3,?4,?5,?6,?7,?8)",
            )?;
            for s in &computed {
                insert.execute((
                    transcript,
                    s.id,
                    s.first_position,
                    s.last_position,
                    s.start_us,
                    s.end_us,
                    &s.language,
                    &s.text,
                ))?;
            }
            drop(insert);
        }
        tx.commit()?;
        Ok(Some((computed.len(), changed)))
    })?
    .ok_or_else(|| {
        error(
            "transcript_incomplete",
            "A Transcrição ainda não está completa.",
        )
    })
}

fn load(conn: &rusqlite::Connection, transcript: i64) -> rusqlite::Result<Vec<Sentence>> {
    let mut q = conn.prepare(
        "SELECT id, first_position, last_position, start_us, end_us, language, text FROM sentences WHERE transcript_id=?1 ORDER BY id",
    )?;
    let rows = q.query_map([transcript], |r| {
        Ok(Sentence {
            id: r.get(0)?,
            first_position: r.get(1)?,
            last_position: r.get(2)?,
            start_us: r.get(3)?,
            end_us: r.get(4)?,
            language: r.get(5)?,
            text: r.get(6)?,
        })
    })?;
    rows.collect()
}

pub(crate) fn source_transcript(v: &Value) -> Result<i64, CoreError> {
    let source = v["source_id"]
        .as_i64()
        .ok_or_else(|| error("source_missing", "Fonte não encontrada"))?;
    projects::with_reader(|c| {
        c.query_row(
            "SELECT id FROM transcripts WHERE source_id=?1 ORDER BY id LIMIT 1",
            [source],
            |r| r.get(0),
        )
        .optional()
    })?
    .ok_or_else(|| error("transcript_missing", "Transcrição não encontrada."))
}

/// `transcription.segment`: segmenta a Transcrição completa da Fonte em Frases. Idempotente.
fn segment_command(v: Value, _: &mut EventSink<'_>) -> CommandResult {
    let transcript = source_transcript(&v)?;
    let (sentences, changed) = segment_transcript(transcript)?;
    Ok(json!({"transcript_id": transcript, "sentences": sentences, "changed": changed}))
}

/// `transcription.sentences`: Frases da Fonte por ID crescente (`after_id`, `limit`).
fn sentences_command(v: Value, _: &mut EventSink<'_>) -> CommandResult {
    let transcript = source_transcript(&v)?;
    let after = v["after_id"].as_i64().unwrap_or(0);
    let limit = v["limit"].as_i64().unwrap_or(1_000).clamp(1, 10_000);
    projects::with_reader(|c| {
        let mut q = c.prepare(
            "SELECT id, start_us, end_us, language, text, first_position, last_position FROM sentences WHERE transcript_id=?1 AND id>?2 ORDER BY id LIMIT ?3",
        )?;
        let rows = q.query_map((transcript, after, limit), |r| {
            Ok(json!({"id": r.get::<_, i64>(0)?, "start_us": r.get::<_, i64>(1)?, "end_us": r.get::<_, i64>(2)?, "language": r.get::<_, Option<String>>(3)?, "text": r.get::<_, String>(4)?, "first_position": r.get::<_, i64>(5)?, "last_position": r.get::<_, i64>(6)?}))
        })?;
        rows.collect::<rusqlite::Result<Vec<_>>>()
    })
    .map(Value::from)
}

/// `transcription.timeline`: Frases e todos os silêncios em ordem de tempo, paginados.
fn timeline_command(v: Value, _: &mut EventSink<'_>) -> CommandResult {
    let transcript = source_transcript(&v)?;
    let offset = v["offset"].as_i64().unwrap_or(0).max(0);
    let limit = v["limit"].as_i64().unwrap_or(500).clamp(0, 2_000);
    const ITEMS: &str = "SELECT 'sentence' AS type, id, start_us, end_us, language, text, 1 AS ord FROM sentences WHERE transcript_id=?1 UNION ALL SELECT 'silence', NULL, w.start_us, w.end_us, NULL, '', 0 FROM transcript_words w WHERE w.transcript_id=?1 AND w.kind='silence'";
    projects::with_reader(|c| {
        let total: i64 = c.query_row(
            &format!("SELECT COUNT(*) FROM ({ITEMS})"),
            [transcript],
            |r| r.get(0),
        )?;
        let mut q = c.prepare(&format!(
            "SELECT type, id, start_us, end_us, language, text FROM ({ITEMS}) ORDER BY start_us, ord LIMIT ?2 OFFSET ?3"
        ))?;
        let rows = q.query_map((transcript, limit, offset), |r| {
            let kind: String = r.get(0)?;
            Ok(if kind == "sentence" {
                json!({"type": "sentence", "id": r.get::<_, i64>(1)?, "start_us": r.get::<_, i64>(2)?, "end_us": r.get::<_, i64>(3)?, "language": r.get::<_, Option<String>>(4)?, "text": r.get::<_, String>(5)?})
            } else {
                json!({"type": "silence", "start_us": r.get::<_, i64>(2)?, "end_us": r.get::<_, i64>(3)?})
            })
        })?;
        let mut items = rows.collect::<rusqlite::Result<Vec<_>>>()?;
        attach_words(c, transcript, &mut items)?;
        Ok(json!({"total": total, "offset": offset, "items": items}))
    })
}

/// Acrescenta a cada Frase da página `first_position`, `last_position` e `words`
/// (`position`, `text` efetivo, `corrected`, `start_us` na Fonte, que o preview usa ao clicar), para a UI focar e corrigir palavra a palavra.
fn attach_words(
    c: &rusqlite::Connection,
    transcript: i64,
    items: &mut [Value],
) -> rusqlite::Result<()> {
    let ids: Vec<i64> = items.iter().filter_map(|i| i["id"].as_i64()).collect();
    let (Some(min), Some(max)) = (ids.iter().min(), ids.iter().max()) else {
        return Ok(());
    };
    let mut q = c.prepare(
        "SELECT id, first_position, last_position FROM sentences WHERE transcript_id=?1 AND id BETWEEN ?2 AND ?3",
    )?;
    let ranges = q
        .query_map((transcript, min, max), |r| {
            Ok((
                r.get::<_, i64>(0)?,
                r.get::<_, i64>(1)?,
                r.get::<_, i64>(2)?,
            ))
        })?
        .collect::<rusqlite::Result<Vec<_>>>()?;
    let low = ranges.iter().map(|r| r.1).min().unwrap_or(0);
    let high = ranges.iter().map(|r| r.2).max().unwrap_or(-1);
    let mut q = c.prepare(&format!(
        "SELECT position, {}, corrected_text IS NOT NULL, start_us FROM transcript_words WHERE transcript_id=?1 AND kind='word' AND position BETWEEN ?2 AND ?3 ORDER BY position",
        crate::corrections::EFFECTIVE_TEXT
    ))?;
    let words = q
        .query_map((transcript, low, high), |r| {
            Ok((
                r.get::<_, i64>(0)?,
                r.get::<_, String>(1)?,
                r.get::<_, bool>(2)?,
                r.get::<_, i64>(3)?,
            ))
        })?
        .collect::<rusqlite::Result<Vec<_>>>()?;
    for item in items.iter_mut() {
        let Some(id) = item["id"].as_i64() else {
            continue;
        };
        let Some(&(_, first, last)) = ranges.iter().find(|r| r.0 == id) else {
            continue;
        };
        let from = words.partition_point(|w| w.0 < first);
        let to = words.partition_point(|w| w.0 <= last);
        item["first_position"] = json!(first);
        item["last_position"] = json!(last);
        item["words"] = words[from..to]
            .iter()
            .map(|(p, t, c, start)| json!({"position": p, "text": t.trim(), "corrected": c, "start_us": start}))
            .collect();
    }
    Ok(())
}

inventory::submit! { CommandRegistration { name: "transcription.segment", execute: segment_command } }
inventory::submit! { CommandRegistration { name: "transcription.sentences", execute: sentences_command } }
inventory::submit! { CommandRegistration { name: "transcription.timeline", execute: timeline_command } }

/// Serialize a selection using the stable IDs of the full transcript. Minute markers are
/// context only; timestamps for any returned IDs must be resolved by the core.
pub fn compact(sentences: &[Sentence]) -> String {
    use std::fmt::Write;
    let mut result = String::new();
    let mut previous = None;
    for sentence in sentences {
        let minute = sentence.start_us.max(0) / 60_000_000;
        if previous != Some(minute) {
            let _ = writeln!(result, "## {:02}:{:02}", minute / 60, minute % 60);
            previous = Some(minute);
        }
        let _ = writeln!(result, "{} {}", sentence.id, sentence.text);
    }
    result
}

/// Character share needed to assign one language to a selection.
pub const LANGUAGE_MAJORITY_PERCENT: usize = 80;

/// Compact text and internal metadata for the token estimator.
pub struct CompactTranscript {
    pub text: String,
    pub hint: crate::provider::EstimateHint,
}

pub fn compact_with_hint(sentences: &[Sentence]) -> CompactTranscript {
    let mut counts = std::collections::BTreeMap::<&str, usize>::new();
    for s in sentences {
        *counts
            .entry(
                s.language
                    .as_deref()
                    .filter(|language| crate::provider::valid_language(language))
                    .unwrap_or("und"),
            )
            .or_default() += s.text.chars().count();
    }
    let total: usize = counts.values().sum();
    let language = if total == 0 {
        "und"
    } else {
        counts
            .into_iter()
            .find(|(_, n)| n.saturating_mul(100) >= total.saturating_mul(LANGUAGE_MAJORITY_PERCENT))
            .map_or("mul", |(language, _)| language)
    };
    CompactTranscript {
        text: compact(sentences),
        hint: crate::provider::EstimateHint {
            format: "compact".into(),
            language: language.into(),
        },
    }
}

/// Todas as Frases da Transcrição por ID crescente (texto efetivo, #52), para o núcleo.
pub(crate) fn load_for(transcript: i64) -> Result<Vec<Sentence>, CoreError> {
    projects::with_reader(|c| load(c, transcript))
}
