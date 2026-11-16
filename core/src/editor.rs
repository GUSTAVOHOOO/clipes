//! Editor do Corte (#61/#70): bordas validadas no núcleo, documento persistente
//! com histórico/autosave (`edits`) e miniaturas/onda da janela do proxy (`assets`).
use crate::{projects, proxy, sentences, CommandRegistration, CommandResult, CoreError, EventSink};
use rusqlite::OptionalExtension;
use serde_json::{json, Value};

pub mod assets;
pub mod crop;
pub(crate) mod edits;
pub mod silences;

/// Faixa de duração quando o Corte não vem de um candidato (a mesma da seleção, #53).
pub const MIN_CLIP_US: i64 = 20_000_000;
pub const MAX_CLIP_US: i64 = 180_000_000;
/// Máximo de Frases por página de `editor.sentences`.
const MAX_PAGE: i64 = 200;
/// Taxa de quadros usada quando a Fonte não informa uma válida.
const DEFAULT_FPS: f64 = 30.0;

fn error(code: &str, message: &str) -> CoreError {
    CoreError {
        code: code.into(),
        message: message.into(),
        usage: None,
    }
}
fn invalid_source() -> CoreError {
    error("invalid_source", "Fonte inválida.")
}
fn unknown_sentence() -> CoreError {
    error("unknown_sentence_id", "Frase desconhecida.")
}
fn no_candidate() -> CoreError {
    error("candidate_not_found", "Candidato não encontrado.")
}

struct Request {
    source: i64,
    start_id: i64,
    end_id: i64,
    candidate: Option<i64>,
}

fn parse(v: &Value) -> Result<Request, CoreError> {
    Ok(Request {
        source: v["source_id"].as_i64().ok_or_else(invalid_source)?,
        start_id: v["start_id"].as_i64().ok_or_else(unknown_sentence)?,
        end_id: v["end_id"].as_i64().ok_or_else(unknown_sentence)?,
        candidate: match &v["candidate_id"] {
            Value::Null => None,
            other => Some(other.as_i64().ok_or_else(no_candidate)?),
        },
    })
}

/// Faixa de duração aceita: a da execução do candidato ou a padrão de 20 a 180 s.
fn duration_range(candidate: Option<i64>, source: i64) -> Result<(i64, i64), CoreError> {
    let Some(candidate) = candidate else {
        return Ok((MIN_CLIP_US, MAX_CLIP_US));
    };
    projects::with_reader(|c| {
        c.query_row(
            "SELECT r.min_us, r.max_us, t.source_id FROM selection_candidates c JOIN selection_runs r ON r.id=c.run_id JOIN transcripts t ON t.id=r.transcript_id WHERE c.id=?1",
            [candidate],
            |r| Ok((r.get::<_, i64>(0)?, r.get::<_, i64>(1)?, r.get::<_, i64>(2)?)),
        )
        .optional()
    })?
    .filter(|(_, _, owner)| *owner == source)
    .map(|(min, max, _)| (min, max))
    .ok_or_else(no_candidate)
}

fn sentence_bounds(transcript: i64, id: i64) -> Result<(i64, i64), CoreError> {
    projects::with_reader(|c| {
        c.query_row(
            "SELECT start_us, end_us FROM sentences WHERE transcript_id=?1 AND id=?2",
            (transcript, id),
            |r| Ok((r.get(0)?, r.get(1)?)),
        )
        .optional()
    })?
    .ok_or_else(unknown_sentence)
}

/// Bordas do Corte em µs da Fonte, validadas contra a Transcrição e a faixa de duração.
fn validated(request: &Request) -> Result<(i64, i64), CoreError> {
    let transcript = sentences::source_transcript(&json!({"source_id": request.source}))?;
    let (start, _) = sentence_bounds(transcript, request.start_id)?;
    let (_, end) = sentence_bounds(transcript, request.end_id)?;
    if request.end_id < request.start_id {
        return Err(error(
            "adjust_empty",
            "O Corte precisa manter ao menos uma Frase.",
        ));
    }
    let (min, max) = duration_range(request.candidate, request.source)?;
    let length = end - start;
    if length < min {
        return Err(error(
            "adjust_too_short",
            "O Corte ficaria abaixo da duração mínima.",
        ));
    }
    if length > max {
        return Err(error(
            "adjust_too_long",
            "O Corte ficaria acima da duração máxima.",
        ));
    }
    Ok((start, end))
}

fn echo(request: &Request) -> Value {
    let mut out = json!({"source_id": request.source, "start_id": request.start_id, "end_id": request.end_id});
    if let Some(candidate) = request.candidate {
        out["candidate_id"] = json!(candidate);
    }
    out
}

fn source_row(source: i64) -> Result<(i64, f64), CoreError> {
    let (duration, metadata): (i64, String) = projects::with_reader(|c| {
        c.query_row(
            "SELECT duration_us, metadata FROM sources WHERE id=?1",
            [source],
            |r| Ok((r.get(0)?, r.get(1)?)),
        )
        .optional()
    })?
    .ok_or_else(|| error("source_not_found", "Fonte não encontrada."))?;
    Ok((duration, fps_of(&metadata)))
}

/// Taxa de quadros do primeiro vídeo (`avg_frame_rate` do ffprobe, "num/den").
pub(crate) fn fps_of(metadata: &str) -> f64 {
    serde_json::from_str::<Value>(metadata)
        .ok()
        .and_then(|m| {
            m["streams"]
                .as_array()?
                .iter()
                .find(|s| s["codec_type"] == "video")?["avg_frame_rate"]
                .as_str()
                .map(str::to_owned)
        })
        .and_then(|rate| {
            let (n, d) = rate.split_once('/')?;
            let (n, d) = (n.parse::<f64>().ok()?, d.parse::<f64>().ok()?);
            (d > 0.0 && n > 0.0).then(|| n / d)
        })
        .filter(|fps| (1.0..=240.0).contains(fps))
        .unwrap_or(DEFAULT_FPS)
}

/// `editor.range {source_id, start_id, end_id, candidate_id?}`: valida e devolve as bordas em µs.
fn range(v: Value, _: &mut EventSink<'_>) -> CommandResult {
    let request = parse(&v)?;
    let (start, end) = validated(&request)?;
    Ok(json!({"request": echo(&request), "startUs": start, "endUs": end}))
}

/// `editor.open`: valida o Corte e devolve a janela do proxy (Corte ±2 min) e a taxa de quadros.
fn open(v: Value, _: &mut EventSink<'_>) -> CommandResult {
    let _project = projects::start_job()?;
    let request = parse(&v)?;
    let (start, end) = validated(&request)?;
    let mut result = edits::open(&request, start, end)?;
    let (start, end) = (
        result["startUs"].as_i64().unwrap(),
        result["endUs"].as_i64().unwrap(),
    );
    let (duration, fps) = source_row(request.source)?;
    let (window_start, window_end) = proxy::window(start, end, duration)?;
    result["windowStartUs"] = json!(window_start);
    result["windowEndUs"] = json!(window_end);
    result["fps"] = json!(fps);
    if request.candidate.is_none() {
        result["request"]
            .as_object_mut()
            .unwrap()
            .remove("candidate_id");
    }
    Ok(result)
}

/// `editor.sentences {source_id, start_us, end_us, after_id, limit}`: Frases inteiras dentro da
/// janela, por ID crescente, com o texto já corrigido (#52). A janela é limitada à do proxy.
fn sentences_page(v: Value, _: &mut EventSink<'_>) -> CommandResult {
    let (start, end) = (
        v["start_us"].as_i64().unwrap_or(-1),
        v["end_us"].as_i64().unwrap_or(-1),
    );
    if start < 0 || end <= start || end - start > proxy::MAX_CLIP_US + 2 * proxy::MARGIN_US {
        return Err(error("invalid_range", "Intervalo do Corte inválido."));
    }
    let transcript = sentences::source_transcript(&v)?;
    let after = v["after_id"].as_i64().unwrap_or(0);
    let limit = v["limit"].as_i64().unwrap_or(MAX_PAGE).clamp(1, MAX_PAGE);
    let rows = projects::with_reader(|c| {
        let mut q = c.prepare(
            "SELECT id, start_us, end_us, first_position, last_position, text FROM sentences WHERE transcript_id=?1 AND id>?2 AND start_us>=?3 AND end_us<=?4 ORDER BY id LIMIT ?5",
        )?;
        let rows = q
            .query_map((transcript, after, start, end, limit), |r| {
                Ok((
                    r.get::<_, i64>(0)?,
                    r.get::<_, i64>(1)?,
                    r.get::<_, i64>(2)?,
                    r.get::<_, i64>(3)?,
                    r.get::<_, i64>(4)?,
                    r.get::<_, String>(5)?,
                ))
            })?
            .collect::<rusqlite::Result<Vec<_>>>()?;
        let mut words = c.prepare(&format!(
            "SELECT {} FROM transcript_words WHERE transcript_id=?1 AND kind='word' AND position BETWEEN ?2 AND ?3 ORDER BY position",
            crate::corrections::EFFECTIVE_TEXT
        ))?;
        let mut out = Vec::with_capacity(rows.len());
        for (id, start_us, end_us, first, last, stored) in rows {
            let list = words
                .query_map((transcript, first, last), |r| r.get::<_, String>(0))?
                .collect::<rusqlite::Result<Vec<_>>>()?;
            let text = if list.is_empty() {
                stored
            } else {
                sentences::join_text(list.iter().map(String::as_str))
            };
            out.push(json!({"id": id, "startUs": start_us, "endUs": end_us, "text": text}));
        }
        Ok(out)
    })?;
    Ok(Value::from(rows))
}

inventory::submit! { CommandRegistration { name: "editor.open", execute: open } }
inventory::submit! { CommandRegistration { name: "editor.range", execute: range } }
inventory::submit! { CommandRegistration { name: "editor.sentences", execute: sentences_page } }

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn frame_rate_comes_from_the_first_video_stream() {
        let meta = r#"{"streams":[{"codec_type":"audio"},{"codec_type":"video","avg_frame_rate":"30000/1001"}]}"#;
        assert!((fps_of(meta) - 29.97).abs() < 0.01);
        for bad in [
            "",
            "{}",
            r#"{"streams":[{"codec_type":"video","avg_frame_rate":"0/0"}]}"#,
        ] {
            assert_eq!(fps_of(bad), DEFAULT_FPS);
        }
    }
}
