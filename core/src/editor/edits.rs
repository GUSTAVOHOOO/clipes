//! Documento do Corte e histórico limitado. Prévias são puras; só o pointerup edita.
//! Ordem de locks: editor -> sessão do Projeto. Troca/fechamento passam por
//! `project_change`, que impede autosave tardio em outro Projeto.
use super::*;
use serde::{Deserialize, Serialize};
use std::{
    collections::BTreeMap,
    sync::{Mutex, OnceLock},
    time::{Duration, Instant},
};

inventory::submit! { projects::Migration { id: "0070_001_clip_edits", sql: "
CREATE TABLE clip_edits (id INTEGER PRIMARY KEY, identity TEXT NOT NULL UNIQUE, document TEXT NOT NULL);
CREATE TABLE clip_snapshots (id INTEGER PRIMARY KEY, clip_id INTEGER NOT NULL REFERENCES clip_edits(id) ON DELETE CASCADE, document TEXT NOT NULL);
CREATE INDEX clip_snapshots_clip ON clip_snapshots(clip_id,id);
" } }

pub(crate) const SCHEMA_VERSION: u64 = 2;

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(crate) struct Borders {
    pub start_id: i64,
    pub end_id: i64,
    pub start_us: i64,
    pub end_us: i64,
}
#[derive(Clone, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct DocumentV1 {
    schema_version: u64,
    revision: u64,
    original: crate::export::ExportRequest,
    range: Borders,
    undo: Vec<Borders>,
    redo: Vec<Borders>,
}
#[derive(Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(crate) struct Document {
    schema_version: u64,
    revision: u64,
    pub original: crate::export::ExportRequest,
    pub range: Borders,
    undo: Vec<Borders>,
    redo: Vec<Borders>,
    pub crop: crop::CropTimeline,
}
struct Entry {
    doc: Document,
    dirty: Option<Instant>,
}
#[derive(Default)]
struct State {
    entries: BTreeMap<i64, Entry>,
}
fn state() -> &'static Mutex<State> {
    static STATE: OnceLock<Mutex<State>> = OnceLock::new();
    STATE.get_or_init(|| Mutex::new(State::default()))
}
fn invalid() -> CoreError {
    error("invalid_clip", "Corte inválido ou incompatível.")
}
fn lock() -> Result<std::sync::MutexGuard<'static, State>, CoreError> {
    state().lock().map_err(|_| invalid())
}
fn decode(encoded: &str) -> Result<Document, CoreError> {
    let raw: Value = serde_json::from_str(encoded).map_err(|_| invalid())?;
    let version = raw
        .get("schemaVersion")
        .and_then(Value::as_u64)
        .ok_or_else(invalid)?;
    let doc = match version {
        1 => {
            let v1: DocumentV1 = serde_json::from_value(raw).map_err(|_| invalid())?;
            if v1.schema_version != 1 {
                return Err(invalid());
            }
            Document {
                schema_version: SCHEMA_VERSION,
                revision: v1.revision,
                original: v1.original,
                range: v1.range,
                undo: v1.undo,
                redo: v1.redo,
                crop: crop::CropTimeline::default(),
            }
        }
        SCHEMA_VERSION => serde_json::from_value(raw).map_err(|_| invalid())?,
        _ => return Err(invalid()),
    };
    if doc.schema_version != SCHEMA_VERSION
        || doc.undo.len() + doc.redo.len() > 100
        || doc.revision == u64::MAX
        || doc.original.clip_id.is_some()
    {
        return Err(invalid());
    }
    crop::validate_timeline(&doc.crop)?;
    Ok(doc)
}
fn load(s: &mut State, id: i64) -> Result<&mut Entry, CoreError> {
    if let std::collections::btree_map::Entry::Vacant(entry) = s.entries.entry(id) {
        let encoded: Option<String> = projects::with_reader(|c| {
            c.query_row("SELECT document FROM clip_edits WHERE id=?1", [id], |r| {
                r.get(0)
            })
            .optional()
        })?;
        let doc = decode(&encoded.ok_or_else(invalid)?)?;
        validate(&doc, &doc.range)?;
        entry.insert(Entry { doc, dirty: None });
    }
    s.entries.get_mut(&id).ok_or_else(invalid)
}
fn crop_view(crop: &crop::CropTimeline) -> Value {
    let resolved = crop::resolve(crop);
    json!({
        "suggested": crop.suggested,
        "edits": crop.edits,
        "resolved": resolved,
        "hasCrop": !resolved.is_empty(),
    })
}
fn answer(id: i64, doc: &Document) -> Value {
    let r = &doc.range;
    json!({"clipId":id,"schemaVersion":doc.schema_version,"revision":doc.revision,
        "request":{"source_id":doc.original.source_id,"candidate_id":doc.original.candidate_id,"start_id":r.start_id,"end_id":r.end_id},
        "startUs":r.start_us,"endUs":r.end_us,"undoCount":doc.undo.len(),"redoCount":doc.redo.len(),
        "crop":crop_view(&doc.crop)})
}
fn save(s: &mut State, due_only: bool) -> Result<(), CoreError> {
    let ids: Vec<_> = s
        .entries
        .iter()
        .filter(|(_, e)| {
            e.dirty
                .is_some_and(|t| !due_only || t.elapsed() >= Duration::from_secs(1))
        })
        .map(|(id, _)| *id)
        .collect();
    if ids.is_empty() {
        return Ok(());
    }
    let project: String = projects::with_reader(|c| {
        c.query_row("SELECT id FROM queue_project_identity", [], |r| r.get(0))
    })?;
    projects::with_writer(|c| {
        let tx = c.transaction()?;
        for id in &ids {
            let encoded = serde_json::to_string(&s.entries[id].doc)
                .map_err(|_| rusqlite::Error::InvalidQuery)?;
            tx.execute(
                "UPDATE clip_edits SET document=?2 WHERE id=?1",
                (id, &encoded),
            )?;
            tx.execute(
                "INSERT INTO clip_snapshots(clip_id,document) VALUES (?1,?2)",
                (id, &encoded),
            )?;
            tx.execute("DELETE FROM clip_snapshots WHERE clip_id=?1 AND id NOT IN (SELECT id FROM clip_snapshots WHERE clip_id=?1 ORDER BY id DESC LIMIT 20)",[id])?;
        }
        tx.commit()
    })?;
    for id in ids {
        s.entries.get_mut(&id).unwrap().dirty = None;
        crate::emit_background(crate::ProgressEvent {
            job: format!("editor:{id}"),
            project: Some(project.clone()),
            stage: "editor_saved".into(),
            percentage: 100,
            message: "Corte salvo.".into(),
            error: None,
        });
    }
    Ok(())
}
fn start_autosave() {
    static STARTED: OnceLock<()> = OnceLock::new();
    STARTED.get_or_init(|| {
        std::thread::spawn(|| loop {
            std::thread::sleep(Duration::from_millis(50));
            if let Ok(mut s) = lock() {
                if let Err(error) = save(&mut s, true) {
                    crate::emit_background(crate::ProgressEvent {
                        job: "editor".into(),
                        project: None,
                        stage: "editor_save_failed".into(),
                        percentage: 0,
                        message: "Não foi possível salvar o Corte.".into(),
                        error: Some(error),
                    });
                    for e in s.entries.values_mut().filter(|e| e.dirty.is_some()) {
                        e.dirty = Some(Instant::now());
                    }
                }
            }
        });
    });
}
/// Flush serializado com autosave/comandos; nenhum estado atravessa troca/restauração.
pub(crate) fn project_change<T>(
    change: impl FnOnce() -> Result<T, CoreError>,
) -> Result<T, CoreError> {
    let mut s = lock()?;
    save(&mut s, false)?;
    let result = change();
    s.entries.clear();
    result
}
pub(super) fn open(request: &Request, start: i64, end: i64) -> Result<Value, CoreError> {
    let mut s = lock()?;
    let identity = request
        .candidate
        .map(|id| format!("candidate:{id}"))
        .unwrap_or_else(|| {
            format!(
                "source:{}:{}:{}",
                request.source, request.start_id, request.end_id
            )
        });
    let existing: Option<i64> = projects::with_reader(|c| {
        c.query_row(
            "SELECT id FROM clip_edits WHERE identity=?1",
            [&identity],
            |r| r.get(0),
        )
        .optional()
    })?;
    let id = if let Some(id) = existing {
        id
    } else {
        let doc = Document {
            schema_version: SCHEMA_VERSION,
            revision: 0,
            original: crate::export::ExportRequest {
                source_id: request.source,
                start_id: request.start_id,
                end_id: request.end_id,
                candidate_id: request.candidate,
                clip_id: None,
            },
            range: Borders {
                start_id: request.start_id,
                end_id: request.end_id,
                start_us: start,
                end_us: end,
            },
            undo: vec![],
            redo: vec![],
            crop: crop::CropTimeline::default(),
        };
        let encoded = serde_json::to_string(&doc).map_err(|_| invalid())?;
        projects::with_writer(|c| {
            c.execute(
                "INSERT INTO clip_edits(identity,document) VALUES (?1,?2)",
                (&identity, &encoded),
            )?;
            Ok(c.last_insert_rowid())
        })?
    };
    let entry = load(&mut s, id)?;
    if entry.doc.original.source_id != request.source {
        return Err(invalid());
    }
    start_autosave();
    Ok(answer(id, &entry.doc))
}
/// Export lê o documento validado, nunca tempos arbitrários da UI.
pub(crate) fn document(id: i64) -> Result<Document, CoreError> {
    let mut s = lock()?;
    Ok(load(&mut s, id)?.doc.clone())
}
fn all_sentences(source: i64) -> Result<Vec<(i64, i64, i64)>, CoreError> {
    let transcript = sentences::source_transcript(&json!({"source_id":source}))?;
    projects::with_reader(|c| {
        let mut q = c.prepare(
            "SELECT id,start_us,end_us FROM sentences WHERE transcript_id=?1 ORDER BY start_us,id",
        )?;
        let rows = q
            .query_map([transcript], |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?)))?
            .collect::<rusqlite::Result<Vec<_>>>()?;
        Ok(rows)
    })
}
fn validate(doc: &Document, range: &Borders) -> Result<(), CoreError> {
    let (duration, _) = source_row(doc.original.source_id)?;
    if range.start_us < 0 || range.end_us > duration {
        return Err(error("invalid_range", "Intervalo do Corte inválido."));
    }
    if range.end_us <= range.start_us {
        return Err(error(
            "adjust_empty",
            "O Corte precisa manter ao menos uma Frase.",
        ));
    }
    let (min, max) = duration_range(doc.original.candidate_id, doc.original.source_id)?;
    let length = range.end_us - range.start_us;
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
    Ok(())
}
fn adjusted(doc: &Document, v: &Value) -> Result<Borders, CoreError> {
    let start = match v["edge"].as_str() {
        Some("start") => true,
        Some("end") => false,
        _ => return Err(invalid()),
    };
    let list = all_sentences(doc.original.source_id)?;
    if list.is_empty() {
        return Err(unknown_sentence());
    }
    let (duration, fps) = source_row(doc.original.source_id)?;
    let time = if let Some(delta) = v["sentence_delta"].as_i64() {
        if delta != -1 && delta != 1 {
            return Err(invalid());
        }
        let id = if start {
            doc.range.start_id
        } else {
            doc.range.end_id
        };
        let index = list
            .iter()
            .position(|s| s.0 == id)
            .ok_or_else(unknown_sentence)? as i64;
        let Some(sentence) = usize::try_from(index + delta)
            .ok()
            .and_then(|i| list.get(i))
        else {
            return Ok(doc.range.clone());
        };
        if start {
            sentence.1
        } else {
            sentence.2
        }
    } else if let Some(id) = v["sentence_id"].as_i64() {
        let s = list
            .iter()
            .find(|s| s.0 == id)
            .ok_or_else(unknown_sentence)?;
        if start {
            s.1
        } else {
            s.2
        }
    } else {
        let requested = v["time_us"]
            .as_i64()
            .ok_or_else(invalid)?
            .clamp(0, duration);
        if v["free"].as_bool().unwrap_or(false) {
            ((requested as f64 * fps / 1_000_000.0).round() * 1_000_000.0 / fps)
                .round()
                .clamp(0.0, duration as f64) as i64
        } else {
            list.iter()
                .flat_map(|s| [s.1, s.2])
                .filter(|t| *t >= 0 && *t <= duration)
                .min_by_key(|t| ((t - requested).abs(), *t))
                .ok_or_else(unknown_sentence)?
        }
    };
    let mut range = doc.range.clone();
    if start {
        range.start_us = time;
    } else {
        range.end_us = time;
    }
    range.start_id = list
        .iter()
        .find(|s| s.2 > range.start_us)
        .unwrap_or(list.last().unwrap())
        .0;
    range.end_id = list
        .iter()
        .rev()
        .find(|s| s.1 < range.end_us)
        .unwrap_or(&list[0])
        .0;
    validate(doc, &range)?;
    Ok(range)
}
fn id(v: &Value) -> Result<i64, CoreError> {
    v["clip_id"].as_i64().ok_or_else(invalid)
}
fn adjust(v: Value, _: &mut EventSink<'_>) -> CommandResult {
    let mut s = lock()?;
    let id = id(&v)?;
    let entry = load(&mut s, id)?;
    let next = adjusted(&entry.doc, &v)?;
    if v["preview"].as_bool().unwrap_or(false) {
        let mut doc = entry.doc.clone();
        doc.range = next;
        return Ok(answer(id, &doc));
    }
    if next != entry.doc.range {
        entry.doc.undo.push(entry.doc.range.clone());
        if entry.doc.undo.len() > 100 {
            entry.doc.undo.remove(0);
        }
        entry.doc.redo.clear();
        entry.doc.range = next;
        entry.doc.revision += 1;
        entry.dirty = Some(Instant::now());
    }
    Ok(answer(id, &entry.doc))
}
fn history(v: Value, redo: bool) -> CommandResult {
    let mut s = lock()?;
    let id = id(&v)?;
    let entry = load(&mut s, id)?;
    let next = if redo {
        entry.doc.redo.last()
    } else {
        entry.doc.undo.last()
    };
    if let Some(next) = next.cloned() {
        validate(&entry.doc, &next)?;
        if redo {
            entry.doc.redo.pop();
            entry.doc.undo.push(entry.doc.range.clone());
        } else {
            entry.doc.undo.pop();
            entry.doc.redo.push(entry.doc.range.clone());
        }
        entry.doc.range = next;
        entry.doc.revision += 1;
        entry.dirty = Some(Instant::now());
    }
    Ok(answer(id, &entry.doc))
}
fn undo(v: Value, _: &mut EventSink<'_>) -> CommandResult {
    history(v, false)
}
fn redo(v: Value, _: &mut EventSink<'_>) -> CommandResult {
    history(v, true)
}
fn flush(_: Value, _: &mut EventSink<'_>) -> CommandResult {
    let mut s = lock()?;
    save(&mut s, false)?;
    Ok(Value::Null)
}
fn snapshots(v: Value, _: &mut EventSink<'_>) -> CommandResult {
    let id = id(&v)?;
    let mut s = lock()?;
    load(&mut s, id)?;
    projects::with_reader(|c| {
        let mut q = c.prepare(
            "SELECT document FROM clip_snapshots WHERE clip_id=?1 ORDER BY id DESC LIMIT 20",
        )?;
        let docs = q
            .query_map([id], |r| r.get::<_, String>(0))?
            .collect::<rusqlite::Result<Vec<_>>>()?;
        Ok(docs)
    })?
    .into_iter()
    .map(|s| decode(&s).and_then(|d| serde_json::to_value(d).map_err(|_| invalid())))
    .collect::<Result<Vec<_>, _>>()
    .map(Value::from)
}
fn crop_answer(id: i64, doc: &Document) -> Value {
    let mut out = crop_view(&doc.crop);
    out["clipId"] = json!(id);
    out["schemaVersion"] = json!(doc.schema_version);
    out["revision"] = json!(doc.revision);
    out
}
fn crop_get(v: Value, _: &mut EventSink<'_>) -> CommandResult {
    let id = id(&v)?;
    let mut s = lock()?;
    let entry = load(&mut s, id)?;
    Ok(crop_answer(id, &entry.doc))
}
fn crop_set_suggested(v: Value, _: &mut EventSink<'_>) -> CommandResult {
    let id = id(&v)?;
    let mut s = lock()?;
    let entry = load(&mut s, id)?;
    let suggested: Option<crop::SuggestedCrop> = if let Some(reframe_id) = v["reframe_id"].as_i64()
    {
        let raw: Option<String> = projects::with_reader(|c| {
            c.query_row(
                "SELECT timeline FROM reframe_suggestions WHERE id=?1 AND source_id=?2",
                (reframe_id, entry.doc.original.source_id),
                |r| r.get(0),
            )
            .optional()
        })?;
        let text = raw.ok_or_else(crop::invalid_crop)?;
        Some(serde_json::from_str(&text).map_err(|_| crop::invalid_crop())?)
    } else if v.get("suggested").is_some_and(Value::is_null) {
        None
    } else {
        Some(serde_json::from_value(v["suggested"].clone()).map_err(|_| crop::invalid_crop())?)
    };
    if let Some(ref sug) = suggested {
        crop::validate_suggested(sug)?;
    }
    if entry.doc.crop.suggested != suggested {
        entry.doc.crop.suggested = suggested;
        entry.doc.revision += 1;
        entry.dirty = Some(Instant::now());
    }
    Ok(crop_answer(id, &entry.doc))
}
fn crop_set_edits(v: Value, _: &mut EventSink<'_>) -> CommandResult {
    let id = id(&v)?;
    let edits: Vec<crop::CropKeyframe> =
        serde_json::from_value(v["edits"].clone()).map_err(|_| crop::invalid_crop())?;
    crop::validate_edits(&edits)?;
    let mut s = lock()?;
    let entry = load(&mut s, id)?;
    if entry.doc.crop.edits != edits {
        entry.doc.crop.edits = edits;
        entry.doc.revision += 1;
        entry.dirty = Some(Instant::now());
    }
    Ok(crop_answer(id, &entry.doc))
}
fn crop_evaluate(v: Value, _: &mut EventSink<'_>) -> CommandResult {
    let id = id(&v)?;
    let time_us = v["time_us"].as_i64().ok_or_else(crop::invalid_crop)?;
    let mut s = lock()?;
    let entry = load(&mut s, id)?;
    let resolved = crop::resolve(&entry.doc.crop);
    let rect = crop::interpolate(&resolved, time_us);
    Ok(json!({ "clipId": id, "timeUs": time_us, "rect": rect }))
}
fn crop_example(v: Value, _: &mut EventSink<'_>) -> CommandResult {
    let id = id(&v)?;
    let aspect = v["aspect"].as_f64().unwrap_or(16.0 / 9.0);
    if !aspect.is_finite() || !(0.1..=10.0).contains(&aspect) {
        return Err(crop::invalid_crop());
    }
    let mut s = lock()?;
    let entry = load(&mut s, id)?;
    let example = crop::example_timeline(entry.doc.range.start_us, entry.doc.range.end_us, aspect);
    crop::validate_suggested(&example)?;
    entry.doc.crop.suggested = Some(example);
    entry.doc.revision += 1;
    entry.dirty = Some(Instant::now());
    Ok(crop_answer(id, &entry.doc))
}
inventory::submit! {CommandRegistration {name:"editor.adjust",execute:adjust}}
inventory::submit! {CommandRegistration {name:"editor.undo",execute:undo}}
inventory::submit! {CommandRegistration {name:"editor.redo",execute:redo}}
inventory::submit! {CommandRegistration {name:"editor.flush",execute:flush}}
inventory::submit! {CommandRegistration {name:"editor.snapshots",execute:snapshots}}
inventory::submit! {CommandRegistration {name:"editor.crop.get",execute:crop_get}}
inventory::submit! {CommandRegistration {name:"editor.crop.set_suggested",execute:crop_set_suggested}}
inventory::submit! {CommandRegistration {name:"editor.crop.set_edits",execute:crop_set_edits}}
inventory::submit! {CommandRegistration {name:"editor.crop.evaluate",execute:crop_evaluate}}
inventory::submit! {CommandRegistration {name:"editor.crop.example",execute:crop_example}}
