//! Documento do Corte e histórico limitado. Prévias são puras; só o pointerup edita.
//! Ordem de locks: editor -> sessão do Projeto. Troca/fechamento passam por
//! `project_change`, que impede autosave tardio em outro Projeto.
use super::silences::{self, SilenceConfig, SilenceStatus, SpliceMap, DEFAULT_MIN_SILENCE_US};
use super::*;
use crate::{
    audio::{self, SfxAnchor, SfxEdit, SoundtrackEdit, WordTrack},
    montage,
};
use serde::{Deserialize, Serialize};
use std::{
    collections::BTreeMap,
    path::PathBuf,
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
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(crate) struct EditSnapshot {
    pub start_id: i64,
    pub end_id: i64,
    pub start_us: i64,
    pub end_us: i64,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub silences: Option<SilenceConfig>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub crop_edits: Option<Vec<crop::CropKeyframe>>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub narration_starts: Option<BTreeMap<i64, i64>>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub crop_layout: Option<crop::CropLayout>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub crop_split_ratio: Option<f64>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub gameplay_webcam_edits: Option<(Vec<crop::CropKeyframe>, Vec<crop::CropKeyframe>)>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub two_people_edits: Option<(Vec<crop::CropKeyframe>, Vec<crop::CropKeyframe>)>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub soundtrack: Option<SoundtrackEdit>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub sfx: Vec<SfxEdit>,
}
impl EditSnapshot {
    fn dual_edits(
        dual: Option<&crop::DualCropPanels>,
    ) -> Option<(Vec<crop::CropKeyframe>, Vec<crop::CropKeyframe>)> {
        dual.filter(|d| !d.top.edits.is_empty() || !d.bottom.edits.is_empty())
            .map(|d| (d.top.edits.clone(), d.bottom.edits.clone()))
    }
    fn from_doc(doc: &Document) -> Self {
        Self {
            start_id: doc.range.start_id,
            end_id: doc.range.end_id,
            start_us: doc.range.start_us,
            end_us: doc.range.end_us,
            silences: doc.silences.clone(),
            crop_edits: (!doc.crop.edits.is_empty()).then(|| doc.crop.edits.clone()),
            narration_starts: (!doc.narration_starts.is_empty())
                .then(|| doc.narration_starts.clone()),
            crop_layout: doc.crop.layout,
            crop_split_ratio: doc.crop.split_ratio,
            gameplay_webcam_edits: Self::dual_edits(doc.crop.gameplay_webcam.as_ref()),
            two_people_edits: Self::dual_edits(doc.crop.two_people.as_ref()),
            soundtrack: doc.soundtrack.clone(),
            sfx: doc.sfx.clone(),
        }
    }
    fn borders(&self) -> Borders {
        Borders {
            start_id: self.start_id,
            end_id: self.end_id,
            start_us: self.start_us,
            end_us: self.end_us,
        }
    }
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
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub silences: Option<SilenceConfig>,
    undo: Vec<EditSnapshot>,
    redo: Vec<EditSnapshot>,
    #[serde(default)]
    pub crop: crop::CropTimeline,
    #[serde(default, skip_serializing_if = "BTreeMap::is_empty")]
    pub narration_starts: BTreeMap<i64, i64>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub soundtrack: Option<SoundtrackEdit>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub sfx: Vec<SfxEdit>,
}
impl Document {
    pub(crate) fn active_silences(&self) -> Vec<(i64, i64)> {
        self.silences
            .as_ref()
            .map(|cfg| {
                cfg.intervals
                    .iter()
                    .filter(|i| i.status == SilenceStatus::Active)
                    .map(|i| (i.start_us, i.end_us))
                    .collect()
            })
            .unwrap_or_default()
    }
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
            let to_snapshot = |b: Borders| EditSnapshot {
                start_id: b.start_id,
                end_id: b.end_id,
                start_us: b.start_us,
                end_us: b.end_us,
                silences: None,
                crop_edits: None,
                narration_starts: None,
                crop_layout: None,
                crop_split_ratio: None,
                gameplay_webcam_edits: None,
                two_people_edits: None,
                soundtrack: None,
                sfx: Vec::new(),
            };
            Document {
                schema_version: SCHEMA_VERSION,
                revision: v1.revision,
                original: v1.original,
                range: v1.range,
                silences: None,
                undo: v1.undo.into_iter().map(to_snapshot).collect(),
                redo: v1.redo.into_iter().map(to_snapshot).collect(),
                crop: crop::CropTimeline::default(),
                narration_starts: BTreeMap::new(),
                soundtrack: None,
                sfx: Vec::new(),
            }
        }
        SCHEMA_VERSION => serde_json::from_value(raw).map_err(|_| invalid())?,
        _ => return Err(invalid()),
    };
    if doc.schema_version != SCHEMA_VERSION
        || doc.undo.len() + doc.redo.len() > 100
        || doc.revision == u64::MAX
        || doc.original.clip_id.is_some()
        || doc.narration_starts.values().any(|&t| t < 0)
        || doc.undo.iter().chain(&doc.redo).any(|s| {
            s.narration_starts
                .as_ref()
                .is_some_and(|m| m.values().any(|&t| t < 0))
        })
    {
        return Err(invalid());
    }
    crop::validate_timeline(&doc.crop)?;
    if let Some(st) = &doc.soundtrack {
        audio::validate_soundtrack_edit(st)?;
    }
    for sfx in &doc.sfx {
        audio::validate_sfx_edit(sfx)?;
    }
    for snap in doc.undo.iter().chain(&doc.redo) {
        if let Some(st) = &snap.soundtrack {
            audio::validate_soundtrack_edit(st)?;
        }
        for sfx in &snap.sfx {
            audio::validate_sfx_edit(sfx)?;
        }
    }
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
        validate_silences(&doc.range, doc.silences.as_ref())?;
        entry.insert(Entry { doc, dirty: None });
    }
    s.entries.get_mut(&id).ok_or_else(invalid)
}
struct ResolvedDocMontage {
    plan: montage::MontagePlan,
    script_approved: bool,
    sentences: Vec<montage::MontageSentence>,
    splice: SpliceMap,
}
fn resolve_doc_montage(doc: &Document) -> Result<Option<ResolvedDocMontage>, CoreError> {
    let Some(candidate_id) = doc.original.candidate_id else {
        return Ok(None);
    };
    let Ok(Some(script_doc)) = crate::script::montage_blocks_readonly(candidate_id) else {
        return Ok(None);
    };
    let Some(transcript_id) = montage::transcript_id_for_source(doc.original.source_id)? else {
        return Ok(None);
    };
    let sentences = montage::load_transcript_sentences(transcript_id)?;
    let splice = SpliceMap::new(doc.range.start_us, doc.range.end_us, &doc.active_silences());
    let tts_durations = crate::tts::block_durations_for_candidate(candidate_id).unwrap_or_default();
    let blocks: Vec<montage::MontageBlockInput> = script_doc
        .blocks
        .into_iter()
        .map(|b| {
            let (duration_us, estimated) = match tts_durations.get(&b.id).copied() {
                Some(real) => (real, false),
                None => (
                    b.narration
                        .as_deref()
                        .map_or(0, montage::estimate_block_duration_us),
                    true,
                ),
            };
            montage::MontageBlockInput {
                block_id: b.id,
                position: b.position,
                title: b.title,
                refs: b.refs,
                duration_us,
                estimated,
            }
        })
        .collect();
    let plan = montage::resolve(&montage::MontageInput {
        blocks: &blocks,
        sentences: &sentences,
        splice: &splice,
        manual_starts: &doc.narration_starts,
    })?;
    Ok(Some(ResolvedDocMontage {
        plan,
        script_approved: script_doc.approved,
        sentences,
        splice,
    }))
}
fn montage_view(doc: &Document) -> Value {
    let Ok(Some(resolved)) = resolve_doc_montage(doc) else {
        return Value::Null;
    };
    let audio_map = doc
        .original
        .candidate_id
        .and_then(|cid| crate::tts::block_audio_for_candidate(cid).ok())
        .unwrap_or_default();
    let mut value = serde_json::to_value(resolved.plan).unwrap_or(Value::Null);
    if let Some(obj) = value.as_object_mut() {
        obj.insert("scriptApproved".into(), json!(resolved.script_approved));
        if let Some(blocks) = obj.get_mut("blocks").and_then(Value::as_array_mut) {
            for block in blocks {
                let audio_id = block
                    .get("blockId")
                    .and_then(Value::as_i64)
                    .and_then(|id| audio_map.get(&id))
                    .map(|a| a.narration_id);
                if let Some(block_obj) = block.as_object_mut() {
                    block_obj.insert("audioId".into(), json!(audio_id));
                }
            }
        }
    }
    value
}
fn doc_aspect(doc: &Document) -> f64 {
    source_info(doc.original.source_id)
        .map(|(_, _, aspect)| aspect)
        .unwrap_or(16.0 / 9.0)
}
fn crop_view(crop: &crop::CropTimeline, range: &Borders, source_aspect: f64) -> Value {
    let resolved = crop::resolve(crop);
    let plan = crop::resolve_plan(crop, source_aspect, range.start_us, range.end_us);
    json!({
        "layout": plan.layout,
        "explicitLayout": crop.layout,
        "splitRatio": plan.split_ratio,
        "suggested": crop.suggested,
        "edits": crop.edits,
        "gameplayWebcam": crop.gameplay_webcam,
        "twoPeople": crop.two_people,
        "resolved": resolved,
        "hasCrop": crop.has_explicit_crop(),
        "plan": plan,
    })
}
fn audio_mix_view(doc: &Document) -> Value {
    let Some(project) = current_project_path() else {
        return Value::Null;
    };
    let active = doc.active_silences();
    let splice = SpliceMap::new(doc.range.start_us, doc.range.end_us, &active);
    let transcript_id = montage::transcript_id_for_source(doc.original.source_id)
        .ok()
        .flatten();
    let montage_plan = resolve_doc_montage(doc).ok().flatten().map(|m| m.plan);
    match audio::resolve_audio_mix(
        &project,
        doc.soundtrack.as_ref(),
        &doc.sfx,
        transcript_id,
        &splice,
        doc.original.candidate_id,
        montage_plan.as_ref(),
    ) {
        Ok(view) => serde_json::to_value(view).unwrap_or(Value::Null),
        Err(_) => Value::Null,
    }
}
fn answer(id: i64, doc: &Document) -> Value {
    let r = &doc.range;
    let active = doc.active_silences();
    let splice = SpliceMap::new(r.start_us, r.end_us, &active);
    let threshold_us = doc
        .silences
        .as_ref()
        .map_or(DEFAULT_MIN_SILENCE_US, |s| s.threshold_us);
    let intervals = doc
        .silences
        .as_ref()
        .map(|s| s.intervals.as_slice())
        .unwrap_or(&[]);
    let aspect = doc_aspect(doc);
    json!({"clipId":id,"schemaVersion":doc.schema_version,"revision":doc.revision,
        "request":{"source_id":doc.original.source_id,"candidate_id":doc.original.candidate_id,"start_id":r.start_id,"end_id":r.end_id},
        "startUs":r.start_us,"endUs":r.end_us,"undoCount":doc.undo.len(),"redoCount":doc.redo.len(),
        "silences":{"enabled":doc.silences.is_some(),"thresholdUs":threshold_us,"intervals":intervals,"segments":splice.segments,"removedUs":splice.removed_us,"effectiveDurationUs":splice.output_duration_us},
        "crop":crop_view(&doc.crop, r, aspect),
        "montage":montage_view(doc),
        "audioMix":audio_mix_view(doc)})
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
    silences::clear_pcm_cache();
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
            silences: None,
            undo: vec![],
            redo: vec![],
            crop: crop::CropTimeline::default(),
            narration_starts: BTreeMap::new(),
            soundtrack: None,
            sfx: Vec::new(),
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
fn validate_silences(range: &Borders, silences: Option<&SilenceConfig>) -> Result<(), CoreError> {
    let Some(cfg) = silences else {
        return Ok(());
    };
    silences::validate_threshold(cfg.threshold_us)?;
    for item in &cfg.intervals {
        if item.gap_start_us < range.start_us
            || item.gap_end_us > range.end_us
            || item.start_us < item.gap_start_us
            || item.end_us > item.gap_end_us
            || item.end_us <= item.start_us
        {
            return Err(invalid());
        }
    }
    Ok(())
}
fn clip_silences_to_range(
    silences: &Option<SilenceConfig>,
    range: &Borders,
) -> Option<SilenceConfig> {
    silences.as_ref().map(|cfg| SilenceConfig {
        threshold_us: cfg.threshold_us,
        intervals: cfg
            .intervals
            .iter()
            .filter(|i| {
                i.gap_start_us >= range.start_us
                    && i.gap_end_us <= range.end_us
                    && i.start_us >= range.start_us
                    && i.end_us <= range.end_us
            })
            .cloned()
            .collect(),
    })
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
fn push_history(entry: &mut Entry) {
    entry.doc.undo.push(EditSnapshot::from_doc(&entry.doc));
    if entry.doc.undo.len() > 100 {
        entry.doc.undo.remove(0);
    }
    entry.doc.redo.clear();
    entry.doc.revision += 1;
    entry.dirty = Some(Instant::now());
}
fn adjust(v: Value, _: &mut EventSink<'_>) -> CommandResult {
    let mut s = lock()?;
    let id = id(&v)?;
    let entry = load(&mut s, id)?;
    let next = adjusted(&entry.doc, &v)?;
    let next_silences = clip_silences_to_range(&entry.doc.silences, &next);
    if v["preview"].as_bool().unwrap_or(false) {
        let mut doc = entry.doc.clone();
        doc.range = next;
        doc.silences = next_silences;
        return Ok(answer(id, &doc));
    }
    if next != entry.doc.range || next_silences != entry.doc.silences {
        push_history(entry);
        entry.doc.range = next;
        entry.doc.silences = next_silences;
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
        let next_range = next.borders();
        let next_crop_edits = next.crop_edits.unwrap_or_default();
        let next_narration_starts = next.narration_starts.unwrap_or_default();
        let next_gw_edits = next.gameplay_webcam_edits.unwrap_or_default();
        let next_tp_edits = next.two_people_edits.unwrap_or_default();
        let next_soundtrack = next.soundtrack;
        let next_sfx = next.sfx;
        validate(&entry.doc, &next_range)?;
        validate_silences(&next_range, next.silences.as_ref())?;
        crop::validate_split_ratio(next.crop_layout, next.crop_split_ratio)?;
        crop::validate_edits(&next_crop_edits)?;
        if next_narration_starts.values().any(|&t| t < 0) {
            return Err(invalid());
        }
        if let Some(st) = &next_soundtrack {
            audio::validate_soundtrack_edit(st)?;
        }
        for sfx in &next_sfx {
            audio::validate_sfx_edit(sfx)?;
        }
        crop::validate_edits(&next_gw_edits.0)?;
        crop::validate_edits(&next_gw_edits.1)?;
        crop::validate_edits(&next_tp_edits.0)?;
        crop::validate_edits(&next_tp_edits.1)?;
        if redo {
            entry.doc.redo.pop();
            entry.doc.undo.push(EditSnapshot::from_doc(&entry.doc));
        } else {
            entry.doc.undo.pop();
            entry.doc.redo.push(EditSnapshot::from_doc(&entry.doc));
        }
        entry.doc.range = next_range;
        entry.doc.silences = next.silences;
        entry.doc.crop.layout = next.crop_layout;
        entry.doc.crop.split_ratio = next.crop_split_ratio;
        entry.doc.crop.edits = next_crop_edits;
        entry.doc.narration_starts = next_narration_starts;
        entry.doc.soundtrack = next_soundtrack;
        entry.doc.sfx = next_sfx;
        let apply_dual =
            |slot: &mut Option<crop::DualCropPanels>,
             (top, bot): (Vec<crop::CropKeyframe>, Vec<crop::CropKeyframe>)| {
                if top.is_empty()
                    && bot.is_empty()
                    && slot
                        .as_ref()
                        .is_none_or(|d| d.top.suggested.is_none() && d.bottom.suggested.is_none())
                {
                    *slot = None;
                } else {
                    let d = slot.get_or_insert_with(crop::DualCropPanels::default);
                    d.top.edits = top;
                    d.bottom.edits = bot;
                }
            };
        apply_dual(&mut entry.doc.crop.gameplay_webcam, next_gw_edits);
        apply_dual(&mut entry.doc.crop.two_people, next_tp_edits);
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
fn clip_words(source_id: i64, start_us: i64, end_us: i64) -> Result<Vec<(i64, i64)>, CoreError> {
    let transcript = sentences::source_transcript(&json!({"source_id": source_id}))?;
    projects::with_reader(|c| {
        let mut q = c.prepare(
            "SELECT start_us, end_us FROM transcript_words WHERE transcript_id=?1 AND kind='word' AND end_us>?2 AND start_us<?3 ORDER BY position",
        )?;
        let rows = q
            .query_map((transcript, start_us, end_us), |r| {
                Ok((r.get(0)?, r.get(1)?))
            })?
            .collect::<rusqlite::Result<Vec<_>>>()?;
        Ok(rows)
    })
}
fn current_project_path() -> Option<PathBuf> {
    let current = crate::dispatch("projects.current", json!({}), &mut |_| {}).ok()?;
    current["path"].as_str().map(PathBuf::from)
}
fn silences_detect(v: Value, _: &mut EventSink<'_>) -> CommandResult {
    let mut s = lock()?;
    let id = id(&v)?;
    let entry = load(&mut s, id)?;
    let threshold_us = v["threshold_us"].as_i64().unwrap_or_else(|| {
        entry
            .doc
            .silences
            .as_ref()
            .map_or(DEFAULT_MIN_SILENCE_US, |c| c.threshold_us)
    });
    let words = clip_words(
        entry.doc.original.source_id,
        entry.doc.range.start_us,
        entry.doc.range.end_us,
    )?;
    let mut intervals = silences::detect_from_words(
        &words,
        entry.doc.range.start_us,
        entry.doc.range.end_us,
        threshold_us,
    )?;
    if let Some(project) = current_project_path() {
        silences::refine_for_source(
            entry.doc.original.source_id,
            &project,
            entry.doc.range.start_us,
            entry.doc.range.end_us,
            &mut intervals,
        );
    }
    let next = Some(SilenceConfig {
        threshold_us,
        intervals,
    });
    if v["preview"].as_bool().unwrap_or(false) {
        let mut doc = entry.doc.clone();
        doc.silences = next;
        return Ok(answer(id, &doc));
    }
    if entry.doc.silences != next {
        push_history(entry);
        entry.doc.silences = next;
    }
    Ok(answer(id, &entry.doc))
}
fn silences_toggle(v: Value, _: &mut EventSink<'_>) -> CommandResult {
    let mut s = lock()?;
    let id = id(&v)?;
    let entry = load(&mut s, id)?;
    let interval_id = v["id"]
        .as_u64()
        .ok_or_else(|| error("invalid_silence_interval", "Trecho de silêncio inválido."))?;
    let explicit = match v.get("status").and_then(Value::as_str) {
        Some("active") => Some(SilenceStatus::Active),
        Some("reverted") => Some(SilenceStatus::Reverted),
        Some(_) => {
            return Err(error(
                "invalid_silence_status",
                "Estado de silêncio inválido.",
            ))
        }
        None => None,
    };
    let mut next = entry
        .doc
        .silences
        .clone()
        .ok_or_else(|| error("invalid_silence_interval", "Trecho de silêncio inválido."))?;
    let Some(item) = next.intervals.iter_mut().find(|i| i.id == interval_id) else {
        return Err(error(
            "invalid_silence_interval",
            "Trecho de silêncio inválido.",
        ));
    };
    let target_status = explicit.unwrap_or(match item.status {
        SilenceStatus::Active => SilenceStatus::Reverted,
        SilenceStatus::Reverted => SilenceStatus::Active,
    });
    if item.status != target_status {
        item.status = target_status;
        push_history(entry);
        entry.doc.silences = Some(next);
    }
    Ok(answer(id, &entry.doc))
}
fn silences_set_all(v: Value, status: SilenceStatus) -> CommandResult {
    let mut s = lock()?;
    let id = id(&v)?;
    let entry = load(&mut s, id)?;
    if let Some(mut next) = entry.doc.silences.clone() {
        let mut changed = false;
        for item in &mut next.intervals {
            if item.status != status {
                item.status = status;
                changed = true;
            }
        }
        if changed {
            push_history(entry);
            entry.doc.silences = Some(next);
        }
    }
    Ok(answer(id, &entry.doc))
}
fn silences_revert_all(v: Value, _: &mut EventSink<'_>) -> CommandResult {
    silences_set_all(v, SilenceStatus::Reverted)
}
fn silences_apply_all(v: Value, _: &mut EventSink<'_>) -> CommandResult {
    silences_set_all(v, SilenceStatus::Active)
}

fn crop_answer(id: i64, doc: &Document) -> Value {
    let aspect = doc_aspect(doc);
    let mut out = crop_view(&doc.crop, &doc.range, aspect);
    out["clipId"] = json!(id);
    out["schemaVersion"] = json!(doc.schema_version);
    out["revision"] = json!(doc.revision);
    out["undoCount"] = json!(doc.undo.len());
    out["redoCount"] = json!(doc.redo.len());
    out
}
fn crop_get(v: Value, _: &mut EventSink<'_>) -> CommandResult {
    let id = id(&v)?;
    let mut s = lock()?;
    let entry = load(&mut s, id)?;
    Ok(crop_answer(id, &entry.doc))
}
fn dual_slot_mut(
    timeline: &mut crop::CropTimeline,
    layout: crop::CropLayout,
) -> Result<&mut crop::DualCropPanels, CoreError> {
    match layout {
        crop::CropLayout::GameplayWebcam => Ok(timeline
            .gameplay_webcam
            .get_or_insert_with(crop::DualCropPanels::default)),
        crop::CropLayout::TwoPeople => Ok(timeline
            .two_people
            .get_or_insert_with(crop::DualCropPanels::default)),
        _ => Err(crop::invalid_crop()),
    }
}
fn crop_set_layout(v: Value, _: &mut EventSink<'_>) -> CommandResult {
    let id = id(&v)?;
    let layout: crop::CropLayout =
        serde_json::from_value(v["layout"].clone()).map_err(|_| crop::invalid_crop())?;
    let raw_ratio = v
        .get("split_ratio")
        .or_else(|| v.get("splitRatio"))
        .filter(|val| !val.is_null())
        .map(|val| val.as_f64().ok_or_else(crop::invalid_crop))
        .transpose()?;
    let next_ratio = if let Some((def, _, _)) = crop::split_bounds(layout) {
        let validated = crop::validate_split_ratio(Some(layout), raw_ratio)?;
        Some(validated.unwrap_or(def))
    } else {
        if raw_ratio.is_some() {
            return Err(crop::invalid_crop());
        }
        None
    };
    let mut s = lock()?;
    let entry = load(&mut s, id)?;
    let resolved_ratio = if raw_ratio.is_some() {
        next_ratio
    } else if entry.doc.crop.layout == Some(layout) {
        entry.doc.crop.split_ratio.or(next_ratio)
    } else {
        next_ratio
    };
    if v["preview"].as_bool().unwrap_or(false) {
        let mut doc = entry.doc.clone();
        doc.crop.layout = Some(layout);
        doc.crop.split_ratio = resolved_ratio;
        return Ok(crop_answer(id, &doc));
    }
    if entry.doc.crop.layout != Some(layout) || entry.doc.crop.split_ratio != resolved_ratio {
        push_history(entry);
        entry.doc.crop.layout = Some(layout);
        entry.doc.crop.split_ratio = resolved_ratio;
    }
    Ok(crop_answer(id, &entry.doc))
}
fn crop_set_suggested(v: Value, _: &mut EventSink<'_>) -> CommandResult {
    let id = id(&v)?;
    let mut s = lock()?;
    let entry = load(&mut s, id)?;
    if let Some(reframe_id) = v["reframe_id"].as_i64() {
        type ReframeSuggestionRow = (Option<String>, String, Option<f64>, Option<String>);
        let row: Option<ReframeSuggestionRow> = projects::with_reader(|c| {
            c.query_row(
                    "SELECT timeline, layout, split_ratio, secondary_timeline FROM reframe_suggestions WHERE id=?1 AND source_id=?2",
                    (reframe_id, entry.doc.original.source_id),
                    |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?, r.get(3)?)),
                )
                .optional()
        })?;
        let (raw, layout_str, split_ratio, raw_sec) = row.ok_or_else(crop::invalid_crop)?;
        let text = raw.ok_or_else(crop::invalid_crop)?;
        let primary: crop::SuggestedCrop =
            serde_json::from_str(&text).map_err(|_| crop::invalid_crop())?;
        crop::validate_suggested(&primary)?;
        let secondary: Option<crop::SuggestedCrop> = raw_sec
            .map(|s| serde_json::from_str(&s))
            .transpose()
            .map_err(|_| crop::invalid_crop())?;
        if let Some(ref sec) = secondary {
            crop::validate_suggested(sec)?;
        }
        match layout_str.as_str() {
            "gameplay_webcam" | "two_people" => {
                let target_layout = if layout_str == "gameplay_webcam" {
                    crop::CropLayout::GameplayWebcam
                } else {
                    crop::CropLayout::TwoPeople
                };
                let sec = secondary.ok_or_else(crop::invalid_crop)?;
                let mut changed = false;
                if entry.doc.crop.layout != Some(target_layout) {
                    entry.doc.crop.layout = Some(target_layout);
                    changed = true;
                }
                if let Some(ratio) = split_ratio {
                    if entry.doc.crop.split_ratio != Some(ratio) {
                        entry.doc.crop.split_ratio = Some(ratio);
                        changed = true;
                    }
                }
                let dual = dual_slot_mut(&mut entry.doc.crop, target_layout)?;
                if dual.top.suggested.as_ref() != Some(&primary)
                    || dual.bottom.suggested.as_ref() != Some(&sec)
                {
                    dual.top.suggested = Some(primary);
                    dual.bottom.suggested = Some(sec);
                    changed = true;
                }
                if changed {
                    entry.doc.revision += 1;
                    entry.dirty = Some(Instant::now());
                }
            }
            _ => {
                if entry.doc.crop.suggested.as_ref() != Some(&primary) {
                    entry.doc.crop.suggested = Some(primary);
                    entry.doc.revision += 1;
                    entry.dirty = Some(Instant::now());
                }
            }
        }
        return Ok(crop_answer(id, &entry.doc));
    }
    let suggested: Option<crop::SuggestedCrop> = if v.get("suggested").is_some_and(Value::is_null) {
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
    let panel = match v.get("panel").and_then(Value::as_str) {
        None | Some("primary") => "primary",
        Some(p @ ("top" | "bottom")) => p,
        Some(_) => return Err(crop::invalid_crop()),
    };
    let explicit_layout: Option<crop::CropLayout> = v
        .get("layout")
        .filter(|val| !val.is_null())
        .map(|val| serde_json::from_value(val.clone()).map_err(|_| crop::invalid_crop()))
        .transpose()?;
    let mut s = lock()?;
    let entry = load(&mut s, id)?;
    if panel == "primary" {
        if v["preview"].as_bool().unwrap_or(false) {
            let mut doc = entry.doc.clone();
            doc.crop.edits = edits;
            return Ok(crop_answer(id, &doc));
        }
        if entry.doc.crop.edits != edits {
            push_history(entry);
            entry.doc.crop.edits = edits;
        }
        return Ok(crop_answer(id, &entry.doc));
    }
    let target_layout = explicit_layout.unwrap_or_else(|| entry.doc.crop.effective_layout());
    if !matches!(
        target_layout,
        crop::CropLayout::GameplayWebcam | crop::CropLayout::TwoPeople
    ) {
        return Err(crop::invalid_crop());
    }
    if v["preview"].as_bool().unwrap_or(false) {
        let mut doc = entry.doc.clone();
        doc.crop.layout = Some(target_layout);
        let dual = dual_slot_mut(&mut doc.crop, target_layout)?;
        if panel == "top" {
            dual.top.edits = edits;
        } else {
            dual.bottom.edits = edits;
        }
        return Ok(crop_answer(id, &doc));
    }
    let current_edits = match target_layout {
        crop::CropLayout::GameplayWebcam => entry.doc.crop.gameplay_webcam.as_ref(),
        crop::CropLayout::TwoPeople => entry.doc.crop.two_people.as_ref(),
        _ => None,
    }
    .map(|d| {
        if panel == "top" {
            &d.top.edits
        } else {
            &d.bottom.edits
        }
    });
    let changed = current_edits != Some(&edits) || entry.doc.crop.layout != Some(target_layout);
    if changed {
        push_history(entry);
        entry.doc.crop.layout = Some(target_layout);
        let dual = dual_slot_mut(&mut entry.doc.crop, target_layout)?;
        if panel == "top" {
            dual.top.edits = edits;
        } else {
            dual.bottom.edits = edits;
        }
    }
    Ok(crop_answer(id, &entry.doc))
}
fn crop_evaluate(v: Value, _: &mut EventSink<'_>) -> CommandResult {
    let id = id(&v)?;
    let time_us = v["time_us"].as_i64().ok_or_else(crop::invalid_crop)?;
    let mut s = lock()?;
    let entry = load(&mut s, id)?;
    let doc = &entry.doc;
    let aspect = doc_aspect(doc);
    let plan = crop::resolve_plan(&doc.crop, aspect, doc.range.start_us, doc.range.end_us);
    let panels = crop::evaluate_plan(&plan, time_us);
    let rect = if doc.crop.has_explicit_crop() {
        panels.first().map(|p| p.rect)
    } else {
        let resolved = crop::resolve(&doc.crop);
        crop::interpolate(&resolved, time_us)
    };
    Ok(json!({ "clipId": id, "timeUs": time_us, "rect": rect, "panels": panels }))
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
fn montage_get(v: Value, _: &mut EventSink<'_>) -> CommandResult {
    let id = id(&v)?;
    let mut s = lock()?;
    let entry = load(&mut s, id)?;
    Ok(json!({
        "clipId": id,
        "schemaVersion": entry.doc.schema_version,
        "revision": entry.doc.revision,
        "undoCount": entry.doc.undo.len(),
        "redoCount": entry.doc.redo.len(),
        "montage": montage_view(&entry.doc),
    }))
}
fn montage_set_start(v: Value, _: &mut EventSink<'_>) -> CommandResult {
    let id = id(&v)?;
    let block_id = v["block_id"]
        .as_i64()
        .ok_or_else(|| error("block_not_found", "Bloco não encontrado."))?;
    let mut s = lock()?;
    let entry = load(&mut s, id)?;
    let Some(ResolvedDocMontage {
        plan,
        sentences,
        splice,
        ..
    }) = resolve_doc_montage(&entry.doc)?
    else {
        return Err(error("block_not_found", "Bloco não encontrado."));
    };
    let Some(block_idx) = plan.blocks.iter().position(|b| b.block_id == block_id) else {
        return Err(error("block_not_found", "Bloco não encontrado."));
    };
    let mut next_starts = entry.doc.narration_starts.clone();
    match v.get("time_us") {
        None | Some(Value::Null) => {
            next_starts.remove(&block_id);
        }
        Some(raw) => {
            let requested = raw
                .as_i64()
                .ok_or_else(|| error("invalid_montage", "Início manual inválido."))?
                .clamp(entry.doc.range.start_us, entry.doc.range.end_us);
            let (_, fps) = source_row(entry.doc.original.source_id)?;
            let free = v["free"].as_bool().unwrap_or(false);
            let min_output_start = if block_idx == 0 {
                0
            } else {
                plan.blocks[block_idx - 1].end_us + montage::BLOCK_GAP_US
            };
            let in_clip: Vec<&montage::MontageSentence> = sentences
                .iter()
                .filter(|sent| {
                    sent.start_us >= entry.doc.range.start_us
                        && sent.start_us <= entry.doc.range.end_us
                })
                .collect();
            let snapped = if free {
                let frame = ((requested as f64 * fps / 1_000_000.0).round() * 1_000_000.0 / fps)
                    .round()
                    .clamp(
                        entry.doc.range.start_us as f64,
                        entry.doc.range.end_us as f64,
                    ) as i64;
                if splice.source_to_output(frame) < min_output_start {
                    if min_output_start >= splice.output_duration_us {
                        entry.doc.range.end_us
                    } else {
                        splice
                            .output_to_source(min_output_start)
                            .clamp(entry.doc.range.start_us, entry.doc.range.end_us)
                    }
                } else {
                    frame
                }
            } else {
                let candidate = in_clip
                    .iter()
                    .min_by_key(|sent| ((sent.start_us - requested).abs(), sent.start_us))
                    .map_or(entry.doc.range.start_us, |sent| sent.start_us);
                if splice.source_to_output(candidate) < min_output_start {
                    in_clip
                        .iter()
                        .find(|sent| splice.source_to_output(sent.start_us) >= min_output_start)
                        .map(|sent| sent.start_us)
                        .unwrap_or_else(|| {
                            if min_output_start >= splice.output_duration_us {
                                entry.doc.range.end_us
                            } else {
                                splice
                                    .output_to_source(min_output_start)
                                    .clamp(entry.doc.range.start_us, entry.doc.range.end_us)
                            }
                        })
                } else {
                    candidate
                }
            };
            next_starts.insert(block_id, snapped);
        }
    }
    if v["preview"].as_bool().unwrap_or(false) {
        let mut doc = entry.doc.clone();
        doc.narration_starts = next_starts;
        return Ok(answer(id, &doc));
    }
    if next_starts != entry.doc.narration_starts {
        push_history(entry);
        entry.doc.narration_starts = next_starts;
    }
    Ok(answer(id, &entry.doc))
}

pub(crate) fn audio_asset_ids_for_clip(clip_id: i64) -> Result<Vec<i64>, CoreError> {
    let doc = document(clip_id)?;
    let mut ids = Vec::new();
    if let Some(st) = &doc.soundtrack {
        ids.push(st.asset_id);
    }
    for sfx in &doc.sfx {
        ids.push(sfx.asset_id);
    }
    Ok(ids)
}

pub(crate) fn audio_asset_ids_for_candidate(candidate_id: i64) -> Result<Vec<i64>, CoreError> {
    let clip_id: Option<i64> = projects::with_reader(|c| {
        c.query_row(
            "SELECT id FROM clip_edits WHERE identity=?1",
            [format!("candidate:{candidate_id}")],
            |r| r.get(0),
        )
        .optional()
    })?;
    match clip_id {
        Some(id) => audio_asset_ids_for_clip(id),
        None => Ok(Vec::new()),
    }
}

fn require_asset_kind(
    asset_id: i64,
    expected: audio::AudioKind,
) -> Result<audio::AudioAsset, CoreError> {
    let asset = projects::with_reader(|c| audio::load_asset(c, asset_id))?.ok_or_else(|| {
        error(
            "audio_asset_missing",
            "Áudio importado não encontrado no Projeto.",
        )
    })?;
    if asset.kind != expected {
        return Err(error(
            "invalid_audio_kind",
            if expected == audio::AudioKind::Music {
                "Selecione um áudio importado como trilha sonora."
            } else {
                "Selecione um áudio importado como efeito sonoro."
            },
        ));
    }
    let Some(project) = current_project_path() else {
        return Err(error(
            "project_not_open",
            "Abra um Projeto para gerenciar áudios.",
        ));
    };
    if audio::resolve_audio_rel_path(&project, &asset.audio_rel_path).is_none() {
        return Err(error(
            "audio_asset_missing",
            "Arquivo de áudio importado não foi encontrado no Projeto.",
        ));
    }
    Ok(asset)
}

fn parse_sfx_anchor(v: &Value, doc: &Document) -> Result<SfxAnchor, CoreError> {
    let kind = v["kind"]
        .as_str()
        .ok_or_else(|| error("invalid_audio_mix", "Âncora do efeito sonoro inválida."))?;
    match kind {
        "moment" => {
            let raw = v["source_us"]
                .as_i64()
                .or_else(|| v["sourceUs"].as_i64())
                .or_else(|| v["time_us"].as_i64())
                .or_else(|| v["timeUs"].as_i64())
                .ok_or_else(|| error("invalid_audio_mix", "Informe o momento do efeito."))?;
            let clamped = raw.clamp(doc.range.start_us, doc.range.end_us);
            Ok(SfxAnchor::Moment { source_us: clamped })
        }
        "word" => {
            let track = match v.get("track").and_then(Value::as_str) {
                None | Some("original") => WordTrack::Original,
                Some("narration") => WordTrack::Narration,
                Some(_) => {
                    return Err(error(
                        "invalid_audio_mix",
                        "Faixa de palavra inválida para o efeito.",
                    ))
                }
            };
            let position = v["position"]
                .as_i64()
                .ok_or_else(|| error("word_not_found", "Informe a posição da palavra."))?;
            let block_id = v
                .get("block_id")
                .or_else(|| v.get("blockId"))
                .and_then(Value::as_i64);
            let offset_us = v
                .get("offset_us")
                .or_else(|| v.get("offsetUs"))
                .and_then(Value::as_i64)
                .unwrap_or(0);
            let anchor = SfxAnchor::Word {
                track,
                position,
                block_id,
                offset_us,
            };
            if track == WordTrack::Narration && block_id.is_none() {
                return Err(error(
                    "invalid_audio_mix",
                    "Efeito ancorado na Narração exige o bloco de origem.",
                ));
            }
            let transcript_id = montage::transcript_id_for_source(doc.original.source_id)?;
            let splice =
                SpliceMap::new(doc.range.start_us, doc.range.end_us, &doc.active_silences());
            let montage_plan = resolve_doc_montage(doc).ok().flatten().map(|m| m.plan);
            let (_, _, _, outside) = projects::with_reader(|c| {
                audio::resolve_sfx_anchor(c, &anchor, transcript_id, &splice, montage_plan.as_ref())
            })?;
            if outside {
                return Err(error(
                    "word_not_found",
                    "A palavra escolhida não está ativa dentro do Corte.",
                ));
            }
            Ok(anchor)
        }
        _ => Err(error("invalid_audio_mix", "Tipo de âncora inválido.")),
    }
}

fn nearest_clip_word_anchor(
    doc: &Document,
    source_us: i64,
) -> Result<Option<SfxAnchor>, CoreError> {
    let transcript_id = montage::transcript_id_for_source(doc.original.source_id)?;
    let Some(tid) = transcript_id else {
        return Ok(None);
    };
    let active = doc.active_silences();
    let splice = SpliceMap::new(doc.range.start_us, doc.range.end_us, &active);
    let words: Vec<(i64, i64)> = projects::with_reader(|c| {
        let mut q = c.prepare(
            "SELECT position, start_us FROM transcript_words
             WHERE transcript_id=?1 AND kind='word' AND start_us>=?2 AND start_us<=?3
             ORDER BY position",
        )?;
        let rows = q
            .query_map((tid, doc.range.start_us, doc.range.end_us), |r| {
                Ok((r.get::<_, i64>(0)?, r.get::<_, i64>(1)?))
            })?
            .collect::<rusqlite::Result<Vec<_>>>()?;
        Ok(rows)
    })?;
    let best = words
        .into_iter()
        .filter(|(_, su)| {
            splice
                .segments
                .iter()
                .any(|seg| *su >= seg.source_start_us && *su <= seg.source_end_us)
        })
        .min_by_key(|(pos, su)| ((*su - source_us).abs(), *pos));
    Ok(best.map(|(position, _)| SfxAnchor::Word {
        track: WordTrack::Original,
        position,
        block_id: None,
        offset_us: 0,
    }))
}

fn audio_get(v: Value, _: &mut EventSink<'_>) -> CommandResult {
    let id = id(&v)?;
    let mut s = lock()?;
    let entry = load(&mut s, id)?;
    Ok(json!({
        "clipId": id,
        "schemaVersion": entry.doc.schema_version,
        "revision": entry.doc.revision,
        "undoCount": entry.doc.undo.len(),
        "redoCount": entry.doc.redo.len(),
        "audioMix": audio_mix_view(&entry.doc),
    }))
}

fn audio_soundtrack_set(v: Value, _: &mut EventSink<'_>) -> CommandResult {
    let id = id(&v)?;
    let mut s = lock()?;
    let entry = load(&mut s, id)?;
    let next_soundtrack = match v.get("asset_id") {
        Some(Value::Null) => None,
        Some(raw_asset) => {
            let asset_id = raw_asset
                .as_i64()
                .ok_or_else(|| error("audio_asset_missing", "Áudio importado inválido."))?;
            require_asset_kind(asset_id, audio::AudioKind::Music)?;
            let prev = entry
                .doc
                .soundtrack
                .as_ref()
                .filter(|p| p.asset_id == asset_id);
            let st = SoundtrackEdit {
                asset_id,
                start_us: v["start_us"]
                    .as_i64()
                    .unwrap_or_else(|| prev.map_or(0, |p| p.start_us)),
                volume: v["volume"]
                    .as_f64()
                    .unwrap_or_else(|| prev.map_or(audio::DEFAULT_SOUNDTRACK_VOLUME, |p| p.volume)),
                fade_in_us: v["fade_in_us"]
                    .as_i64()
                    .unwrap_or_else(|| prev.map_or(0, |p| p.fade_in_us)),
                fade_out_us: v["fade_out_us"]
                    .as_i64()
                    .unwrap_or_else(|| prev.map_or(0, |p| p.fade_out_us)),
                loop_to_fit: v["loop_to_fit"]
                    .as_bool()
                    .unwrap_or_else(|| prev.is_none_or(|p| p.loop_to_fit)),
            };
            audio::validate_soundtrack_edit(&st)?;
            Some(st)
        }
        None => {
            let Some(prev) = &entry.doc.soundtrack else {
                return Err(error(
                    "audio_asset_missing",
                    "Selecione uma trilha sonora primeiro.",
                ));
            };
            let st = SoundtrackEdit {
                asset_id: prev.asset_id,
                start_us: v["start_us"].as_i64().unwrap_or(prev.start_us),
                volume: v["volume"].as_f64().unwrap_or(prev.volume),
                fade_in_us: v["fade_in_us"].as_i64().unwrap_or(prev.fade_in_us),
                fade_out_us: v["fade_out_us"].as_i64().unwrap_or(prev.fade_out_us),
                loop_to_fit: v["loop_to_fit"].as_bool().unwrap_or(prev.loop_to_fit),
            };
            audio::validate_soundtrack_edit(&st)?;
            Some(st)
        }
    };

    if v["preview"].as_bool().unwrap_or(false) {
        let mut doc = entry.doc.clone();
        doc.soundtrack = next_soundtrack;
        return Ok(answer(id, &doc));
    }
    if next_soundtrack != entry.doc.soundtrack {
        push_history(entry);
        entry.doc.soundtrack = next_soundtrack;
    }
    Ok(answer(id, &entry.doc))
}

fn audio_soundtrack_clear(v: Value, _: &mut EventSink<'_>) -> CommandResult {
    let id = id(&v)?;
    let mut s = lock()?;
    let entry = load(&mut s, id)?;
    if v["preview"].as_bool().unwrap_or(false) {
        let mut doc = entry.doc.clone();
        doc.soundtrack = None;
        return Ok(answer(id, &doc));
    }
    if entry.doc.soundtrack.is_some() {
        push_history(entry);
        entry.doc.soundtrack = None;
    }
    Ok(answer(id, &entry.doc))
}

fn audio_sfx_add(v: Value, _: &mut EventSink<'_>) -> CommandResult {
    let id = id(&v)?;
    let mut s = lock()?;
    let entry = load(&mut s, id)?;
    let asset_id = v["asset_id"]
        .as_i64()
        .ok_or_else(|| error("audio_asset_missing", "Selecione um efeito sonoro."))?;
    require_asset_kind(asset_id, audio::AudioKind::Sfx)?;
    let anchor = parse_sfx_anchor(&v["anchor"], &entry.doc)?;
    let next_id = entry.doc.sfx.iter().map(|s| s.id).max().unwrap_or(0) + 1;
    let item = SfxEdit {
        id: next_id,
        asset_id,
        anchor,
        volume: v["volume"].as_f64().unwrap_or(audio::DEFAULT_SFX_VOLUME),
        fade_in_us: v["fade_in_us"].as_i64().unwrap_or(0),
        fade_out_us: v["fade_out_us"].as_i64().unwrap_or(0),
    };
    audio::validate_sfx_edit(&item)?;
    if v["preview"].as_bool().unwrap_or(false) {
        let mut doc = entry.doc.clone();
        doc.sfx.push(item);
        return Ok(answer(id, &doc));
    }
    push_history(entry);
    entry.doc.sfx.push(item);
    Ok(answer(id, &entry.doc))
}

fn audio_sfx_update(v: Value, _: &mut EventSink<'_>) -> CommandResult {
    let id = id(&v)?;
    let sfx_id = v["id"]
        .as_i64()
        .ok_or_else(|| error("sfx_not_found", "Efeito sonoro não encontrado no Corte."))?;
    let mut s = lock()?;
    let entry = load(&mut s, id)?;
    let Some(pos) = entry.doc.sfx.iter().position(|item| item.id == sfx_id) else {
        return Err(error(
            "sfx_not_found",
            "Efeito sonoro não encontrado no Corte.",
        ));
    };
    let mut next_item = entry.doc.sfx[pos].clone();
    if let Some(asset_id) = v.get("asset_id").and_then(Value::as_i64) {
        require_asset_kind(asset_id, audio::AudioKind::Sfx)?;
        next_item.asset_id = asset_id;
    }
    if v.get("anchor").is_some_and(|a| !a.is_null()) {
        next_item.anchor = parse_sfx_anchor(&v["anchor"], &entry.doc)?;
    } else if let Some(requested) = v.get("time_us").and_then(Value::as_i64) {
        let clamped = requested.clamp(entry.doc.range.start_us, entry.doc.range.end_us);
        let (_, fps) = source_row(entry.doc.original.source_id)?;
        let free = v["free"].as_bool().unwrap_or(false);
        if free {
            let snapped = ((clamped as f64 * fps / 1_000_000.0).round() * 1_000_000.0 / fps)
                .round()
                .clamp(
                    entry.doc.range.start_us as f64,
                    entry.doc.range.end_us as f64,
                ) as i64;
            next_item.anchor = SfxAnchor::Moment { source_us: snapped };
        } else if let Some(word_anchor) = nearest_clip_word_anchor(&entry.doc, clamped)? {
            next_item.anchor = word_anchor;
        } else {
            next_item.anchor = SfxAnchor::Moment { source_us: clamped };
        }
    }
    if let Some(vol) = v.get("volume").and_then(Value::as_f64) {
        next_item.volume = vol;
    }
    if let Some(fi) = v.get("fade_in_us").and_then(Value::as_i64) {
        next_item.fade_in_us = fi;
    }
    if let Some(fo) = v.get("fade_out_us").and_then(Value::as_i64) {
        next_item.fade_out_us = fo;
    }
    audio::validate_sfx_edit(&next_item)?;

    if v["preview"].as_bool().unwrap_or(false) {
        let mut doc = entry.doc.clone();
        doc.sfx[pos] = next_item;
        return Ok(answer(id, &doc));
    }
    if next_item != entry.doc.sfx[pos] {
        push_history(entry);
        entry.doc.sfx[pos] = next_item;
    }
    Ok(answer(id, &entry.doc))
}

fn audio_sfx_remove(v: Value, _: &mut EventSink<'_>) -> CommandResult {
    let id = id(&v)?;
    let sfx_id = v["id"]
        .as_i64()
        .ok_or_else(|| error("sfx_not_found", "Efeito sonoro não encontrado no Corte."))?;
    let mut s = lock()?;
    let entry = load(&mut s, id)?;
    let Some(pos) = entry.doc.sfx.iter().position(|item| item.id == sfx_id) else {
        return Err(error(
            "sfx_not_found",
            "Efeito sonoro não encontrado no Corte.",
        ));
    };
    if v["preview"].as_bool().unwrap_or(false) {
        let mut doc = entry.doc.clone();
        doc.sfx.remove(pos);
        return Ok(answer(id, &doc));
    }
    push_history(entry);
    entry.doc.sfx.remove(pos);
    Ok(answer(id, &entry.doc))
}
inventory::submit! {CommandRegistration {name:"editor.adjust",execute:adjust}}
inventory::submit! {CommandRegistration {name:"editor.undo",execute:undo}}
inventory::submit! {CommandRegistration {name:"editor.redo",execute:redo}}
inventory::submit! {CommandRegistration {name:"editor.flush",execute:flush}}
inventory::submit! {CommandRegistration {name:"editor.snapshots",execute:snapshots}}
inventory::submit! {CommandRegistration {name:"editor.silences.detect",execute:silences_detect}}
inventory::submit! {CommandRegistration {name:"editor.silences.toggle",execute:silences_toggle}}
inventory::submit! {CommandRegistration {name:"editor.silences.revert_all",execute:silences_revert_all}}
inventory::submit! {CommandRegistration {name:"editor.silences.apply_all",execute:silences_apply_all}}
inventory::submit! {CommandRegistration {name:"editor.crop.get",execute:crop_get}}
inventory::submit! {CommandRegistration {name:"editor.crop.set_layout",execute:crop_set_layout}}
inventory::submit! {CommandRegistration {name:"editor.crop.set_suggested",execute:crop_set_suggested}}
inventory::submit! {CommandRegistration {name:"editor.crop.set_edits",execute:crop_set_edits}}
inventory::submit! {CommandRegistration {name:"editor.crop.evaluate",execute:crop_evaluate}}
inventory::submit! {CommandRegistration {name:"editor.crop.example",execute:crop_example}}
inventory::submit! {CommandRegistration {name:"editor.montage.get",execute:montage_get}}
inventory::submit! {CommandRegistration {name:"editor.montage.set_start",execute:montage_set_start}}
inventory::submit! {CommandRegistration {name:"editor.audio.get",execute:audio_get}}
inventory::submit! {CommandRegistration {name:"editor.audio.soundtrack.set",execute:audio_soundtrack_set}}
inventory::submit! {CommandRegistration {name:"editor.audio.soundtrack.clear",execute:audio_soundtrack_clear}}
inventory::submit! {CommandRegistration {name:"editor.audio.sfx.add",execute:audio_sfx_add}}
inventory::submit! {CommandRegistration {name:"editor.audio.sfx.update",execute:audio_sfx_update}}
inventory::submit! {CommandRegistration {name:"editor.audio.sfx.remove",execute:audio_sfx_remove}}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn v1_document_without_silences_loads_as_none_and_serializes_without_field() {
        let v1_json = r#"{"schemaVersion":1,"revision":2,"original":{"source_id":1,"start_id":1,"end_id":4,"candidate_id":null},"range":{"startId":1,"endId":4,"startUs":0,"endUs":40000000},"undo":[{"startId":1,"endId":3,"startUs":0,"endUs":30000000}],"redo":[]}"#;
        let doc = decode(v1_json).unwrap();
        assert_eq!(doc.schema_version, SCHEMA_VERSION);
        assert!(doc.silences.is_none());
        assert_eq!(doc.undo.len(), 1);
        assert!(doc.undo[0].silences.is_none());
        let encoded = serde_json::to_string(&doc).unwrap();
        assert!(!encoded.contains("silences"));
    }

    #[test]
    fn document_with_silences_round_trips_cleanly() {
        let v2_with_silences = r#"{"schemaVersion":2,"revision":3,"original":{"source_id":1,"start_id":1,"end_id":4,"candidate_id":null},"range":{"startId":1,"endId":4,"startUs":0,"endUs":40000000},"silences":{"thresholdUs":500000,"intervals":[{"id":1,"startUs":1120000,"endUs":2920000,"gapStartUs":1000000,"gapEndUs":3000000,"status":"active"}]},"undo":[{"startId":1,"endId":4,"startUs":0,"endUs":40000000}],"redo":[]}"#;
        let doc = decode(v2_with_silences).unwrap();
        let cfg = doc.silences.as_ref().unwrap();
        assert_eq!(cfg.threshold_us, 500_000);
        assert_eq!(cfg.intervals.len(), 1);
        assert_eq!(cfg.intervals[0].status, SilenceStatus::Active);
        assert_eq!(doc.active_silences(), vec![(1_120_000, 2_920_000)]);
        let encoded = serde_json::to_string(&doc).unwrap();
        let reloaded = decode(&encoded).unwrap();
        assert_eq!(reloaded.silences, doc.silences);
    }

    #[test]
    fn document_with_narration_starts_round_trips_without_bumping_schema_version() {
        let v2_without = r#"{"schemaVersion":2,"revision":3,"original":{"source_id":1,"start_id":1,"end_id":4,"candidate_id":null},"range":{"startId":1,"endId":4,"startUs":0,"endUs":40000000},"undo":[{"startId":1,"endId":4,"startUs":0,"endUs":40000000}],"redo":[]}"#;
        let doc = decode(v2_without).unwrap();
        assert!(doc.narration_starts.is_empty());
        assert!(!serde_json::to_string(&doc)
            .unwrap()
            .contains("narrationStarts"));

        let v2_with = r#"{"schemaVersion":2,"revision":4,"original":{"source_id":1,"start_id":1,"end_id":4,"candidate_id":null},"range":{"startId":1,"endId":4,"startUs":0,"endUs":40000000},"undo":[],"redo":[],"narrationStarts":{"10":12000000}}"#;
        let doc = decode(v2_with).unwrap();
        assert_eq!(doc.schema_version, 2);
        assert_eq!(doc.narration_starts.get(&10), Some(&12_000_000));
        let encoded = serde_json::to_string(&doc).unwrap();
        let reloaded = decode(&encoded).unwrap();
        assert_eq!(reloaded.narration_starts, doc.narration_starts);

        let negative = r#"{"schemaVersion":2,"revision":4,"original":{"source_id":1,"start_id":1,"end_id":4,"candidate_id":null},"range":{"startId":1,"endId":4,"startUs":0,"endUs":40000000},"undo":[],"redo":[],"narrationStarts":{"10":-1}}"#;
        assert!(decode(negative).is_err());
    }
}
