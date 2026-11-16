//! Persistência por Corte e overrides globais por identidade da palavra.
use super::*;
use crate::{projects, CommandRegistration, CommandResult, EventSink};
use rusqlite::{OptionalExtension, Transaction};
use serde_json::{json, Value};
use unicode_normalization::UnicodeNormalization;

#[derive(Clone, Copy, Debug)]
pub struct ClipId(pub i64);

/// A criação é preguiçosa: cada Corte recebe uma cópia independente do padrão.
pub fn style(clip: ClipId) -> Result<Style, CoreError> {
    let result = projects::with_writer(|c| {
        let tx = c.transaction()?;
        let exists = tx.query_row(
            "SELECT EXISTS(SELECT 1 FROM clip_edits WHERE id=?1)",
            [clip.0],
            |r| r.get::<_, bool>(0),
        )?;
        if !exists {
            return Ok(Err(invalid()));
        }
        let saved: Option<String> = tx
            .query_row(
                "SELECT document FROM caption_styles WHERE clip_id=?1",
                [clip.0],
                |r| r.get(0),
            )
            .optional()?;
        let result = if let Some(saved) = saved {
            serde_json::from_str::<Style>(&saved).map_err(|_| invalid())
        } else {
            let default: Option<String> = tx
                .query_row(
                    "SELECT document FROM caption_style_default WHERE id=1",
                    [],
                    |r| r.get(0),
                )
                .optional()?;
            let mut style = match default {
                Some(doc) => serde_json::from_str::<Style>(&doc).map_err(|_| invalid()),
                None => Ok(Style::preset(Preset::Vertical)),
            };
            if let Ok(style) = &mut style {
                style.revision = 0;
                tx.execute(
                    "INSERT INTO caption_styles VALUES (?1,?2)",
                    (clip.0, serde_json::to_string(style).unwrap()),
                )?;
            }
            style
        };
        tx.commit()?;
        Ok(result)
    })??;
    result.validate()?;
    Ok(result)
}
fn clip(v: &Value) -> Result<ClipId, CoreError> {
    v["clip_id"]
        .as_i64()
        .filter(|id| *id > 0)
        .map(ClipId)
        .ok_or_else(invalid)
}
fn conflict() -> CoreError {
    CoreError {
        code: "caption_style_conflict".into(),
        message: "O estilo mudou. Reabra a legenda antes de editar.".into(),
        usage: None,
    }
}
fn get_style(v: Value, _: &mut EventSink<'_>) -> CommandResult {
    Ok(json!(style(clip(&v)?)?))
}
fn set_style(v: Value, _: &mut EventSink<'_>) -> CommandResult {
    let id = clip(&v)?;
    let mut next: Style = serde_json::from_value(v["style"].clone()).map_err(|_| invalid())?;
    next.validate()?;
    let old = style(id)?;
    if next.revision != old.revision {
        return Err(conflict());
    }
    next.revision = next
        .revision
        .checked_add(1)
        .filter(|r| *r <= i64::MAX as u64)
        .ok_or_else(invalid)?;
    let encoded = serde_json::to_string(&next).map_err(|_| invalid())?;
    let changed = projects::with_writer(|c| {
        c.execute("UPDATE caption_styles SET document=?2 WHERE clip_id=?1 AND json_extract(document,'$.revision')=?3",(id.0,encoded,old.revision as i64))
    })?;
    if changed != 1 {
        return Err(conflict());
    }
    Ok(json!(next))
}
fn preset_style(v: Value, events: &mut EventSink<'_>) -> CommandResult {
    let id = clip(&v)?;
    let preset: Preset = serde_json::from_value(v["preset"].clone()).map_err(|_| invalid())?;
    let mut next = Style::preset(preset);
    next.revision = v["revision"].as_u64().ok_or_else(invalid)?;
    set_style(json!({"clip_id":id.0,"style":next}), events)
}
fn default_style(v: Value, _: &mut EventSink<'_>) -> CommandResult {
    let mut next = style(clip(&v)?)?;
    projects::with_writer(|c| {
        let tx = c.transaction()?;
        let revision = tx
            .query_row(
                "SELECT json_extract(document,'$.revision') FROM caption_style_default WHERE id=1",
                [],
                |r| r.get::<_, i64>(0),
            )
            .optional()?
            .unwrap_or(0);
        next.revision = revision.saturating_add(1) as u64;
        tx.execute("INSERT INTO caption_style_default VALUES (1,?1) ON CONFLICT(id) DO UPDATE SET document=excluded.document",[serde_json::to_string(&next).unwrap()])?;
        tx.commit()
    })?;
    Ok(json!(next))
}

inventory::submit! {projects::Migration {id:"0065_001_caption_styles",sql:"
CREATE TABLE caption_styles (clip_id INTEGER PRIMARY KEY, document TEXT NOT NULL);
CREATE TABLE caption_style_default (id INTEGER PRIMARY KEY CHECK(id=1), document TEXT NOT NULL);
CREATE TABLE caption_word_overrides (transcript_id INTEGER NOT NULL, position INTEGER NOT NULL, document TEXT NOT NULL, PRIMARY KEY(transcript_id,position), FOREIGN KEY(transcript_id,position) REFERENCES transcript_words(transcript_id,position) ON DELETE CASCADE) WITHOUT ROWID;
CREATE TABLE caption_remap_pending (source_id INTEGER NOT NULL, audio_track INTEGER NOT NULL, position INTEGER NOT NULL, normalized TEXT NOT NULL, start_us INTEGER NOT NULL, document TEXT NOT NULL, PRIMARY KEY(source_id,audio_track,position)) WITHOUT ROWID;
CREATE TABLE caption_remap_notices (source_id INTEGER NOT NULL, audio_track INTEGER NOT NULL, discarded INTEGER NOT NULL, PRIMARY KEY(source_id,audio_track)) WITHOUT ROWID;
"}}
fn normalize(s: &str) -> String {
    s.nfkc()
        .collect::<String>()
        .split_whitespace()
        .collect::<Vec<_>>()
        .join(" ")
        .to_lowercase()
}
fn transcript(v: &Value) -> Result<i64, CoreError> {
    v["transcript_id"]
        .as_i64()
        .filter(|id| *id > 0)
        .ok_or_else(invalid)
}
fn override_word(v: Value, _: &mut EventSink<'_>) -> CommandResult {
    let t = transcript(&v)?;
    let p = v["position"]
        .as_i64()
        .filter(|p| *p >= 0)
        .ok_or_else(invalid)?;
    let overrides: WordOverride =
        serde_json::from_value(v["overrides"].clone()).map_err(|_| invalid())?;
    overrides.validate()?;
    let encoded = serde_json::to_string(&overrides).map_err(|_| invalid())?;
    let found = projects::with_writer(|c| {
        let tx = c.transaction()?;
        let exists=tx.query_row("SELECT EXISTS(SELECT 1 FROM transcript_words WHERE transcript_id=?1 AND position=?2 AND kind='word')",(t,p),|r|r.get::<_,bool>(0))?;
        if exists {
            if overrides == WordOverride::default() {
                tx.execute(
                    "DELETE FROM caption_word_overrides WHERE transcript_id=?1 AND position=?2",
                    (t, p),
                )?;
            } else {
                tx.execute("INSERT INTO caption_word_overrides VALUES (?1,?2,?3) ON CONFLICT(transcript_id,position) DO UPDATE SET document=excluded.document",(t,p,encoded))?;
            }
        }
        tx.commit()?;
        Ok(exists)
    })?;
    if !found {
        return Err(CoreError {
            code: "word_missing".into(),
            message: "Palavra não encontrada.".into(),
            usage: None,
        });
    }
    Ok(json!({"position":p,"overrides":overrides}))
}
fn overrides(v: Value, _: &mut EventSink<'_>) -> CommandResult {
    let t = transcript(&v)?;
    projects::with_reader(|c| {
        let mut q=c.prepare("SELECT position,document FROM caption_word_overrides WHERE transcript_id=?1 ORDER BY position")?;
        let values=q.query_map([t],|r|Ok(json!({"position":r.get::<_,i64>(0)?,"overrides":serde_json::from_str::<Value>(&r.get::<_,String>(1)?).unwrap_or(Value::Null)})))?.collect::<rusqlite::Result<Vec<_>>>()?;
        Ok(json!(values))
    })
}
pub fn stage_remap(tx: &Transaction<'_>, t: i64) -> rusqlite::Result<()> {
    let mut q=tx.prepare("SELECT t.source_id,t.audio_track,w.position,w.text,w.start_us,o.document FROM caption_word_overrides o JOIN transcript_words w USING(transcript_id,position) JOIN transcripts t ON t.id=w.transcript_id WHERE t.id=?1")?;
    let rows = q
        .query_map([t], |r| {
            Ok((
                r.get::<_, i64>(0)?,
                r.get::<_, i64>(1)?,
                r.get::<_, i64>(2)?,
                r.get::<_, String>(3)?,
                r.get::<_, i64>(4)?,
                r.get::<_, String>(5)?,
            ))
        })?
        .collect::<rusqlite::Result<Vec<_>>>()?;
    for (source, track, position, text, start, doc) in rows {
        tx.execute(
            "INSERT OR REPLACE INTO caption_remap_pending VALUES (?1,?2,?3,?4,?5,?6)",
            (source, track, position, normalize(&text), start, doc),
        )?;
    }
    Ok(())
}
/// Só chama ao terminar a Transcrição: uma palavra ambígua pode surgir no bloco seguinte.
pub fn finish_remap(tx: &Transaction<'_>, t: i64) -> rusqlite::Result<usize> {
    let (source, track): (i64, i64) = tx.query_row(
        "SELECT source_id,audio_track FROM transcripts WHERE id=?1",
        [t],
        |r| Ok((r.get(0)?, r.get(1)?)),
    )?;
    let mut q=tx.prepare("SELECT normalized,start_us,document FROM caption_remap_pending WHERE source_id=?1 AND audio_track=?2 ORDER BY position")?;
    let old = q
        .query_map((source, track), |r| {
            Ok((
                r.get::<_, String>(0)?,
                r.get::<_, i64>(1)?,
                r.get::<_, String>(2)?,
            ))
        })?
        .collect::<rusqlite::Result<Vec<_>>>()?;
    if old.is_empty() {
        return Ok(0);
    }
    let mut q=tx.prepare("SELECT position,text,start_us FROM transcript_words WHERE transcript_id=?1 AND kind='word' ORDER BY start_us")?;
    let words = q
        .query_map([t], |r| {
            Ok((
                r.get::<_, i64>(0)?,
                normalize(&r.get::<_, String>(1)?),
                r.get::<_, i64>(2)?,
            ))
        })?
        .collect::<rusqlite::Result<Vec<_>>>()?;
    let mapped: Vec<_> = old
        .iter()
        .map(|(text, start, doc)| {
            let from = words.partition_point(|w| w.2 < start.saturating_sub(300_000));
            let to = words.partition_point(|w| w.2 <= start.saturating_add(300_000));
            let candidates: Vec<_> = words[from..to].iter().filter(|w| w.1 == *text).collect();
            (
                if candidates.len() == 1 {
                    Some(candidates[0].0)
                } else {
                    None
                },
                doc,
            )
        })
        .collect();
    let mut kept = 0;
    for (position, doc) in &mapped {
        if let Some(position) = position.filter(|p| {
            mapped
                .iter()
                .filter(|(other, _)| other == &Some(*p))
                .count()
                == 1
        }) {
            tx.execute(
                "INSERT OR REPLACE INTO caption_word_overrides VALUES (?1,?2,?3)",
                (t, position, doc),
            )?;
            kept += 1;
        }
    }
    let discarded = old.len() - kept;
    tx.execute("INSERT INTO caption_remap_notices VALUES (?1,?2,?3) ON CONFLICT(source_id,audio_track) DO UPDATE SET discarded=excluded.discarded",(source,track,discarded as i64))?;
    tx.execute(
        "DELETE FROM caption_remap_pending WHERE source_id=?1 AND audio_track=?2",
        (source, track),
    )?;
    Ok(discarded)
}
fn remap_status(v: Value, _: &mut EventSink<'_>) -> CommandResult {
    let source = v["source_id"].as_i64().ok_or_else(invalid)?;
    projects::with_reader(|c| {
        let count=c.query_row("SELECT n.discarded FROM caption_remap_notices n JOIN sources s ON s.id=n.source_id AND s.audio_track=n.audio_track WHERE s.id=?1",[source],|r|r.get::<_,i64>(0)).optional()?.unwrap_or(0);
        Ok(json!({"discarded":count}))
    })
}
inventory::submit! {CommandRegistration{name:"captions.override",execute:override_word}}
inventory::submit! {CommandRegistration{name:"captions.overrides",execute:overrides}}
inventory::submit! {CommandRegistration{name:"captions.remap_status",execute:remap_status}}
inventory::submit! {CommandRegistration{name:"captions.style.get",execute:get_style}}
inventory::submit! {CommandRegistration{name:"captions.style.set",execute:set_style}}
inventory::submit! {CommandRegistration{name:"captions.style.preset",execute:preset_style}}
inventory::submit! {CommandRegistration{name:"captions.style.default",execute:default_style}}
