//! Correção de palavras e busca na Transcrição (#52).
//!
//! O texto que o Motor produziu fica sempre em `transcript_words.text` e nunca muda: serve para
//! desfazer e para as fronteiras das Frases, que são função só do texto original e dos tempos
//! (#49, #140: IDs de Frase estáveis por contrato). A correção vai em `corrected_text`; ela
//! muda o texto, nunca os tempos nem a posição. Uma correção atualiza o texto da Frase que
//! contém a palavra, sem recalcular fronteiras nem renumerar IDs, mesmo que a palavra ganhe
//! ou perca pontuação.
//!
//! O texto efetivo de uma palavra é [`EFFECTIVE_TEXT`] (`COALESCE(corrected_text, text)`).
//! Tudo o que deriva da palavra (Frases, texto compacto, busca, legendas futuras) deve ler o
//! texto efetivo por essa função única, nunca `text` direto.
//!
//! Desfazer e refazer: uma pilha por Projeto em `transcript_corrections`, persistida no SQLite.
//! Cada correção é uma entrada com o texto antes e depois; desfazer marca a entrada como
//! `undone`, refazer a desmarca, e uma correção nova apaga as entradas `undone`.
//!
//! Busca: tabela FTS5 `sentence_search` (tokenizer `unicode61 remove_diacritics 2`) com o texto
//! efetivo das Frases, mantida por gatilhos em `sentences`: toda gravação de Frases (segmentação,
//! correção, desfazer) atualiza o índice na mesma transação, e a exclusão em cascata de uma
//! Transcrição o limpa. O rowid do índice é `(transcript_id << 32) | sentence_id`.

use crate::{projects, CommandRegistration, CommandResult, CoreError, EventSink};
use rusqlite::{OptionalExtension, Transaction};
use serde_json::{json, Value};
use unicode_normalization::UnicodeNormalization;

/// Tamanho máximo, em caracteres, do texto de uma correção.
pub const MAX_CORRECTION_CHARS: usize = 200;
/// Quantidade padrão e máxima de resultados de busca.
pub const SEARCH_DEFAULT_LIMIT: i64 = 50;
pub const SEARCH_MAX_LIMIT: i64 = 200;
/// Texto efetivo da palavra: a correção, se houver, senão o texto do Motor.
pub const EFFECTIVE_TEXT: &str = "COALESCE(corrected_text, text)";

inventory::submit! { projects::Migration { id: "0052_001_corrections_and_search", sql: "ALTER TABLE transcript_words ADD COLUMN corrected_text TEXT; CREATE TABLE transcript_corrections (seq INTEGER PRIMARY KEY AUTOINCREMENT, transcript_id INTEGER NOT NULL REFERENCES transcripts(id) ON DELETE CASCADE, position INTEGER NOT NULL, before_text TEXT, after_text TEXT, undone INTEGER NOT NULL DEFAULT 0 CHECK(undone IN (0,1))); CREATE INDEX transcript_corrections_by_state ON transcript_corrections(undone, seq); CREATE VIRTUAL TABLE sentence_search USING fts5(text, tokenize='unicode61 remove_diacritics 2'); INSERT INTO sentence_search(rowid, text) SELECT (transcript_id << 32) | id, text FROM sentences; CREATE TRIGGER sentences_search_insert AFTER INSERT ON sentences BEGIN INSERT INTO sentence_search(rowid, text) VALUES ((new.transcript_id << 32) | new.id, new.text); END; CREATE TRIGGER sentences_search_update AFTER UPDATE OF text ON sentences BEGIN UPDATE sentence_search SET text = new.text WHERE rowid = (old.transcript_id << 32) | old.id; END; CREATE TRIGGER sentences_search_delete AFTER DELETE ON sentences BEGIN DELETE FROM sentence_search WHERE rowid = (old.transcript_id << 32) | old.id; END;" } }

fn error(code: &str, message: &str) -> CoreError {
    CoreError {
        code: code.into(),
        message: message.into(),
        usage: None,
    }
}

fn invalid() -> CoreError {
    error("invalid_correction", "O texto da correção é inválido.")
}

fn word_missing() -> CoreError {
    error("word_missing", "Palavra não encontrada.")
}

/// Valida e normaliza o texto digitado. NFC, bordas aparadas, sem vazio, sem caracteres de
/// controle, até [`MAX_CORRECTION_CHARS`]; espaço interno e pontuação são permitidos. Se o
/// texto original do Motor começa com espaço (convenção do Whisper), grava com um espaço na
/// frente, para a reconstrução do texto da Frase não colar palavras.
fn normalize(input: &str, original: &str) -> Result<String, CoreError> {
    let text: String = input.nfc().collect::<String>().trim().to_owned();
    if text.is_empty()
        || text.chars().count() > MAX_CORRECTION_CHARS
        || text.chars().any(char::is_control)
    {
        return Err(invalid());
    }
    Ok(if original.starts_with(char::is_whitespace) {
        format!(" {text}")
    } else {
        text
    })
}

struct Edited {
    transcript: i64,
    position: i64,
    sentence: Option<i64>,
    text: String,
    corrected: bool,
}

/// Refaz o texto da Frase que contém `position` a partir do texto efetivo das suas palavras.
/// Não toca fronteiras nem IDs. Devolve o ID da Frase, se já existe.
fn refresh_sentence(
    tx: &Transaction<'_>,
    transcript: i64,
    position: i64,
) -> rusqlite::Result<Option<i64>> {
    let range: Option<(i64, i64, i64)> = tx
        .query_row(
            "SELECT id, first_position, last_position FROM sentences WHERE transcript_id=?1 AND first_position<=?2 AND last_position>=?2",
            (transcript, position),
            |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?)),
        )
        .optional()?;
    let Some((id, first, last)) = range else {
        return Ok(None);
    };
    let words = {
        let mut q = tx.prepare(&format!(
            "SELECT {EFFECTIVE_TEXT} FROM transcript_words WHERE transcript_id=?1 AND kind='word' AND position BETWEEN ?2 AND ?3 ORDER BY position"
        ))?;
        let rows = q.query_map((transcript, first, last), |r| r.get::<_, String>(0))?;
        rows.collect::<rusqlite::Result<Vec<_>>>()?
    };
    let text = crate::sentences::join_text(words.iter().map(String::as_str));
    tx.execute(
        "UPDATE sentences SET text=?3 WHERE transcript_id=?1 AND id=?2",
        (transcript, id, text),
    )?;
    Ok(Some(id))
}

/// Grava `corrected` (ou remove a correção, se `None`) e atualiza a Frase.
fn set_corrected(
    tx: &Transaction<'_>,
    transcript: i64,
    position: i64,
    corrected: Option<&str>,
) -> rusqlite::Result<Edited> {
    tx.execute(
        "UPDATE transcript_words SET corrected_text=?3 WHERE transcript_id=?1 AND position=?2",
        (transcript, position, corrected),
    )?;
    let sentence = refresh_sentence(tx, transcript, position)?;
    let text: String = tx.query_row(
        &format!(
            "SELECT {EFFECTIVE_TEXT} FROM transcript_words WHERE transcript_id=?1 AND position=?2"
        ),
        (transcript, position),
        |r| r.get(0),
    )?;
    Ok(Edited {
        transcript,
        position,
        sentence,
        text,
        corrected: corrected.is_some(),
    })
}

fn stack_state(tx: &Transaction<'_>) -> rusqlite::Result<(bool, bool)> {
    Ok((
        tx.query_row(
            "SELECT EXISTS(SELECT 1 FROM transcript_corrections WHERE undone=0)",
            [],
            |r| r.get(0),
        )?,
        tx.query_row(
            "SELECT EXISTS(SELECT 1 FROM transcript_corrections WHERE undone=1)",
            [],
            |r| r.get(0),
        )?,
    ))
}

fn result(tx: &Transaction<'_>, e: &Edited, changed: bool) -> rusqlite::Result<Value> {
    let source: i64 = tx.query_row(
        "SELECT source_id FROM transcripts WHERE id=?1",
        [e.transcript],
        |r| r.get(0),
    )?;
    let (can_undo, can_redo) = stack_state(tx)?;
    Ok(json!({
        "changed": changed, "source_id": source, "transcript_id": e.transcript,
        "position": e.position, "sentence_id": e.sentence, "text": e.text,
        "corrected": e.corrected, "can_undo": can_undo, "can_redo": can_redo,
    }))
}

/// `transcription.correct`: `{source_id, position, text}`.
fn correct(v: Value, _: &mut EventSink<'_>) -> CommandResult {
    let transcript = crate::sentences::source_transcript(&v)?;
    let position = v["position"].as_i64().ok_or_else(word_missing)?;
    let input = v["text"].as_str().ok_or_else(invalid)?.to_owned();
    projects::with_writer(|conn| {
        let tx = conn.transaction()?;
        let word: Option<(String, Option<String>)> = tx
            .query_row(
                "SELECT text, corrected_text FROM transcript_words WHERE transcript_id=?1 AND position=?2 AND kind='word'",
                (transcript, position),
                |r| Ok((r.get(0)?, r.get(1)?)),
            )
            .optional()?;
        let Some((original, before)) = word else {
            return Ok(Err(word_missing()));
        };
        let text = match normalize(&input, &original) {
            Ok(text) => text,
            Err(e) => return Ok(Err(e)),
        };
        // Voltar ao texto do Motor remove a correção.
        let after = (text != original).then_some(text);
        let current = before.clone().unwrap_or_else(|| original.clone());
        if after.clone().unwrap_or_else(|| original.clone()) == current {
            let e = Edited {
                transcript,
                position,
                sentence: refresh_sentence(&tx, transcript, position)?,
                text: current,
                corrected: before.is_some(),
            };
            return Ok(Ok(result(&tx, &e, false)?));
        }
        tx.execute("DELETE FROM transcript_corrections WHERE undone=1", [])?;
        tx.execute(
            "INSERT INTO transcript_corrections(transcript_id, position, before_text, after_text) VALUES (?1,?2,?3,?4)",
            (transcript, position, &before, &after),
        )?;
        let e = set_corrected(&tx, transcript, position, after.as_deref())?;
        let value = result(&tx, &e, true)?;
        tx.commit()?;
        Ok(Ok(value))
    })?
}

type Entry = (i64, i64, i64, Option<String>, Option<String>);

fn step(undo: bool) -> CommandResult {
    projects::with_writer(|conn| {
        let tx = conn.transaction()?;
        let entry: Option<Entry> = tx
            .query_row(
                if undo {
                    "SELECT seq, transcript_id, position, before_text, after_text FROM transcript_corrections WHERE undone=0 ORDER BY seq DESC LIMIT 1"
                } else {
                    "SELECT seq, transcript_id, position, before_text, after_text FROM transcript_corrections WHERE undone=1 ORDER BY seq ASC LIMIT 1"
                },
                [],
                |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?, r.get(3)?, r.get(4)?)),
            )
            .optional()?;
        let Some((seq, transcript, position, before, after)) = entry else {
            return Ok(Err(if undo {
                error("nothing_to_undo", "Não há correção para desfazer.")
            } else {
                error("nothing_to_redo", "Não há correção para refazer.")
            }));
        };
        let target = if undo { before } else { after };
        let e = set_corrected(&tx, transcript, position, target.as_deref())?;
        tx.execute(
            "UPDATE transcript_corrections SET undone=?2 WHERE seq=?1",
            (seq, i64::from(undo)),
        )?;
        let value = result(&tx, &e, true)?;
        tx.commit()?;
        Ok(Ok(value))
    })?
}

fn undo(_: Value, _: &mut EventSink<'_>) -> CommandResult {
    step(true)
}

fn redo(_: Value, _: &mut EventSink<'_>) -> CommandResult {
    step(false)
}

/// Próxima correção na pilha de desfazer (`undone = false`) ou refazer (`undone = true`).
fn next_step(c: &rusqlite::Connection, undone: bool) -> rusqlite::Result<Option<Value>> {
    let order = if undone { "ASC" } else { "DESC" };
    let sql = format!(
        "SELECT t.source_id, so.path, COALESCE(tc.after_text, w.text) \
         FROM transcript_corrections tc \
         JOIN transcripts t ON t.id = tc.transcript_id \
         JOIN sources so ON so.id = t.source_id \
         JOIN transcript_words w ON w.transcript_id = tc.transcript_id AND w.position = tc.position \
         WHERE tc.undone = ?1 \
         ORDER BY tc.seq {order} LIMIT 1"
    );
    c.query_row(&sql, [i64::from(undone)], |r| {
        let source_id: i64 = r.get(0)?;
        let path: String = r.get(1)?;
        let word: String = r.get(2)?;
        Ok(json!({
            "source_id": source_id,
            "source_name": file_name(&path),
            "word": word.trim(),
        }))
    })
    .optional()
}

/// `transcription.corrections`: estado da pilha do Projeto.
fn state(_: Value, _: &mut EventSink<'_>) -> CommandResult {
    projects::with_reader(|c| {
        let flag = |sql: &str| c.query_row(sql, [], |r| r.get::<_, bool>(0));
        Ok(json!({
            "can_undo": flag("SELECT EXISTS(SELECT 1 FROM transcript_corrections WHERE undone=0)")?,
            "can_redo": flag("SELECT EXISTS(SELECT 1 FROM transcript_corrections WHERE undone=1)")?,
            "next_undo": next_step(c, false)?,
            "next_redo": next_step(c, true)?,
        }))
    })
}

/// Expressão FTS5 segura: cada termo vira uma frase entre aspas (sem sintaxe de operador) e o
/// último termo aceita prefixo. Entrada sem letras ou dígitos devolve `None`.
fn match_expression(query: &str) -> Option<String> {
    let terms: Vec<&str> = query
        .split(|c: char| !c.is_alphanumeric())
        .filter(|t| !t.is_empty())
        .collect();
    let last = terms.len().checked_sub(1)?;
    Some(
        terms
            .iter()
            .enumerate()
            .map(|(i, t)| {
                if i == last {
                    format!("\"{t}\"*")
                } else {
                    format!("\"{t}\"")
                }
            })
            .collect::<Vec<_>>()
            .join(" "),
    )
}

/// Trecho com o termo destacado, como partes `{text, match}` (a UI não recebe HTML). O
/// `snippet()` do FTS5 marca o destaque entre U+0001 e U+0002; as partes alternam fora/dentro.
fn parts(snippet: &str) -> Vec<Value> {
    snippet
        .split(['\u{1}', '\u{2}'])
        .enumerate()
        .filter(|(_, piece)| !piece.is_empty())
        .map(|(i, piece)| json!({"text": piece, "match": i % 2 == 1}))
        .collect()
}

fn file_name(path: &str) -> String {
    path.rsplit(['/', '\\']).next().unwrap_or(path).to_owned()
}

/// `transcription.search`: `{query, limit?}` em todas as Transcrições do Projeto. Cada
/// resultado traz Fonte, Transcrição, ID da Frase, tempo, trecho e `row`, o índice da linha da
/// Frase em `transcription.timeline` (para a UI rolar até ela).
fn search(v: Value, _: &mut EventSink<'_>) -> CommandResult {
    let query = v["query"].as_str().unwrap_or("");
    let limit = v["limit"]
        .as_i64()
        .unwrap_or(SEARCH_DEFAULT_LIMIT)
        .clamp(1, SEARCH_MAX_LIMIT);
    let Some(expression) = match_expression(query) else {
        return Ok(json!([]));
    };
    projects::with_reader(|c| {
        let mut q = c.prepare(
            "SELECT s.transcript_id, t.source_id, so.path, s.id, s.start_us, s.end_us, snippet(sentence_search, 0, char(1), char(2), '…', 16), \
             (SELECT COUNT(*) FROM transcript_words w WHERE w.transcript_id=s.transcript_id AND w.kind='silence' AND w.start_us<=s.start_us) + (SELECT COUNT(*) FROM sentences x WHERE x.transcript_id=s.transcript_id AND (x.start_us<s.start_us OR (x.start_us=s.start_us AND x.id<s.id))) \
             FROM sentence_search JOIN sentences s ON s.transcript_id=(sentence_search.rowid >> 32) AND s.id=(sentence_search.rowid & 4294967295) \
             JOIN transcripts t ON t.id=s.transcript_id JOIN sources so ON so.id=t.source_id \
             WHERE sentence_search MATCH ?1 ORDER BY rank, s.transcript_id, s.id LIMIT ?2",
        )?;
        let rows = q.query_map((&expression, limit), |r| {
            let snippet: String = r.get(6)?;
            Ok(json!({
                "transcript_id": r.get::<_, i64>(0)?, "source_id": r.get::<_, i64>(1)?,
                "source": file_name(&r.get::<_, String>(2)?), "sentence_id": r.get::<_, i64>(3)?,
                "start_us": r.get::<_, i64>(4)?, "end_us": r.get::<_, i64>(5)?,
                "snippet": parts(&snippet), "row": r.get::<_, i64>(7)?,
            }))
        })?;
        rows.collect::<rusqlite::Result<Vec<_>>>()
    })
    .map(Value::from)
}

inventory::submit! { CommandRegistration { name: "transcription.correct", execute: correct } }
inventory::submit! { CommandRegistration { name: "transcription.undo", execute: undo } }
inventory::submit! { CommandRegistration { name: "transcription.redo", execute: redo } }
inventory::submit! { CommandRegistration { name: "transcription.corrections", execute: state } }
inventory::submit! { CommandRegistration { name: "transcription.search", execute: search } }
