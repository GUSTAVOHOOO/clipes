//! Export local de Cortes (#59), independente do Tauri e de Provedores.
pub mod batch;
pub mod captions;
pub mod encoder;
mod font_cmap;
pub mod pipeline;
pub mod render;

use crate::caption_style::{self, store::ClipId, Preset, Style, StyledWord, WordOverride};
use crate::editor::crop::{self, CropSegment, ResolvedCropPlan};
use crate::editor::silences::{KeptSegment, SpliceMap};
use crate::{projects, CommandRegistration, CommandResult, CoreError, EventSink};
use captions::CaptionWord;
use rusqlite::OptionalExtension;
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::{
    fs,
    path::{Path, PathBuf},
    sync::atomic::{AtomicBool, Ordering},
    time::Duration,
};

pub const JOB_KIND: &str = "export";

/// Contrato compartilhado pela revisão e editor. `clip_id` resolve o documento #70.
#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct ExportRequest {
    pub source_id: i64,
    pub start_id: i64,
    pub end_id: i64,
    #[serde(default)]
    pub candidate_id: Option<i64>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub clip_id: Option<i64>,
}

#[derive(Clone, Serialize, Deserialize)]
pub(crate) struct FrozenCaptionWord {
    pub(crate) text: String,
    pub(crate) start_us: i64,
    pub(crate) end_us: i64,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub(crate) sentence_id: Option<i64>,
}

#[derive(Serialize, Deserialize)]
pub(crate) struct StartRequest {
    #[serde(flatten)]
    pub(crate) cut: ExportRequest,
    #[serde(default)]
    pub(crate) output: PathBuf,
    // Congela as bordas, os silêncios e o crop no enfileiramento, para edições posteriores não mudarem o job.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub(crate) resolved_bounds: Option<(i64, i64)>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub(crate) resolved_silences: Option<Vec<(i64, i64)>>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub(crate) resolved_crop: Option<Vec<CropSegment>>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub(crate) resolved_crop_plan: Option<ResolvedCropPlan>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub(crate) resolved_captions: Option<Vec<FrozenCaptionWord>>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub(crate) resolved_narration_starts: Option<std::collections::BTreeMap<i64, i64>>,
    // Só o lote (#64) com `confirmed: true` ativa a substituição atômica de destino existente.
    #[serde(default, skip_serializing_if = "std::ops::Not::not")]
    pub(crate) overwrite: bool,
}

inventory::submit! { projects::Migration { id:"0059_001_exports", sql:"
CREATE TABLE exports (
  job_id INTEGER PRIMARY KEY REFERENCES jobs(id),
  request TEXT NOT NULL,
  error_code TEXT,
  error_message TEXT
);
" } }

inventory::submit! { projects::Migration { id:"0062_001_export_encoder", sql:"
ALTER TABLE exports ADD COLUMN encoder TEXT;
ALTER TABLE exports ADD COLUMN fallback_from TEXT;
ALTER TABLE exports ADD COLUMN fallback_reason TEXT;
" } }

inventory::submit! { projects::Migration { id:"0196_001_export_error_details", sql:"
ALTER TABLE exports ADD COLUMN error_details TEXT;
" } }

pub(crate) struct Target {
    pub(crate) start_us: i64,
    pub(crate) end_us: i64,
    pub(crate) output_duration_us: i64,
    pub(crate) words: Vec<CaptionWord>,
    pub(crate) styled: Vec<StyledWord>,
    pub(crate) source_starts: Vec<i64>,
    pub(crate) source_ends: Vec<i64>,
    pub(crate) sentence_ids: Vec<Option<i64>>,
    pub(crate) segments: Vec<KeptSegment>,
    pub(crate) active_cuts: Vec<(i64, i64)>,
    pub(crate) transcript: i64,
    pub(crate) crop: Vec<CropSegment>,
    pub(crate) crop_plan: Option<ResolvedCropPlan>,
    pub(crate) caption_track: &'static str,
    pub(crate) target_language: Option<String>,
}

impl Target {
    fn frozen_captions(&self) -> Vec<FrozenCaptionWord> {
        self.styled
            .iter()
            .zip(
                self.source_starts
                    .iter()
                    .zip(self.source_ends.iter().zip(&self.sentence_ids)),
            )
            .map(
                |(w, (&start_us, (&end_us, &sentence_id)))| FrozenCaptionWord {
                    text: w.word.text.clone(),
                    start_us,
                    end_us,
                    sentence_id,
                },
            )
            .collect()
    }
    fn missing_glyphs(&self, style: &Style) -> Vec<captions::MissingGlyph> {
        let font_bytes = style.font_bytes();
        captions::check_words_glyphs(
            self.styled
                .iter()
                .zip(self.source_starts.iter().zip(&self.sentence_ids))
                .filter(|(w, _)| {
                    w.word.start_us < self.output_duration_us
                        && !w.overrides.hidden.unwrap_or(false)
                })
                .map(
                    |(w, (&source_start_us, &sentence_id))| captions::GlyphWord {
                        position: w.position,
                        sentence_id,
                        text: &w.word.text,
                        start_us: source_start_us,
                    },
                ),
            font_bytes,
        )
    }
}
fn bounds() -> CoreError {
    error(
        "export_bounds",
        "As bordas do Corte devem coincidir com Frases da Transcrição completa.",
    )
}
fn candidate_error() -> CoreError {
    error(
        "export_candidate",
        "Aprove o candidato e use as bordas atuais da revisão.",
    )
}

fn parse(v: Value) -> Result<ExportRequest, CoreError> {
    serde_json::from_value(v).map_err(|_| bounds())
}

pub(crate) type FrozenTarget = ((i64, i64), Vec<(i64, i64)>);

pub(crate) fn target(
    request: &ExportRequest,
    frozen: Option<FrozenTarget>,
    frozen_captions: Option<&[FrozenCaptionWord]>,
) -> Result<Target, CoreError> {
    let edited = request
        .clip_id
        .map(crate::editor::edits::document)
        .transpose()?;
    if let Some(doc) = &edited {
        if doc.original.source_id != request.source_id
            || doc.original.candidate_id.is_none()
            || doc.original.candidate_id != request.candidate_id
        {
            return Err(candidate_error());
        }
    }
    let effective = edited.as_ref().map(|doc| ExportRequest {
        source_id: doc.original.source_id,
        candidate_id: doc.original.candidate_id,
        start_id: doc.range.start_id,
        end_id: doc.range.end_id,
        clip_id: request.clip_id,
    });
    let request = effective.as_ref().unwrap_or(request);
    if request.start_id <= 0 || request.end_id < request.start_id {
        return Err(bounds());
    }
    let transcript: Option<i64> = projects::with_reader(|c| {
        c.query_row("SELECT t.id FROM transcripts t JOIN sources s ON s.id=t.source_id AND s.audio_track=t.audio_track WHERE s.id=?1 AND t.state='complete'",[request.source_id],|r|r.get(0)).optional()
    })?;
    let transcript = transcript.ok_or_else(bounds)?;
    if let Some(candidate) = request.candidate_id {
        let run=projects::with_reader(|c| c.query_row("SELECT c.run_id FROM selection_candidates c JOIN selection_runs r ON r.id=c.run_id WHERE c.id=?1 AND r.transcript_id=?2",(candidate,transcript),|r|r.get::<_,i64>(0)).optional())?.ok_or_else(candidate_error)?;
        let review = crate::dispatch("selection.review", json!({"run":run}), &mut |_| {})?;
        let valid = review["items"].as_array().is_some_and(|items| {
            items.iter().any(|item| {
                item["candidate"] == candidate
                    && item["status"] == "approved"
                    && (edited.is_some()
                        || (item["startId"] == request.start_id && item["endId"] == request.end_id))
            })
        });
        if !valid {
            return Err(candidate_error());
        }
    }
    let active_lang = if frozen_captions.is_none() {
        request
            .clip_id
            .map(crate::translation::active_translated_language)
            .transpose()?
            .flatten()
    } else {
        None
    };
    let translated_sentences = match (request.clip_id, active_lang.as_deref()) {
        (Some(clip_id), Some(lang)) => Some(crate::translation::translated_map(clip_id, lang)?),
        _ => None,
    };
    projects::with_reader(|c| {
        let border:Option<(i64,i64,i64,i64)>=c.query_row("SELECT a.start_us,b.end_us,a.first_position,b.last_position FROM sentences a JOIN sentences b ON a.transcript_id=b.transcript_id JOIN transcripts t ON t.id=a.transcript_id WHERE a.transcript_id=?1 AND a.id=?2 AND b.id=?3 AND b.end_us<=t.duration_us",(transcript,request.start_id,request.end_id),|r|Ok((r.get(0)?,r.get(1)?,r.get(2)?,r.get(3)?))).optional()?;
        let Some((start_us, end_us, first, last)) = border else {
            return Ok(Err(bounds()));
        };
        let ((start_us, end_us), active_cuts) = edited
            .as_ref()
            .map(|doc| {
                frozen.clone().unwrap_or_else(|| {
                    (
                        (doc.range.start_us, doc.range.end_us),
                        doc.active_silences(),
                    )
                })
            })
            .unwrap_or(((start_us, end_us), Vec::new()));
        let (duration, metadata): (i64, String) = c.query_row(
            "SELECT duration_us, metadata FROM sources WHERE id=?1",
            [request.source_id],
            |r| Ok((r.get(0)?, r.get(1)?)),
        )?;
        let source_aspect = crate::editor::aspect_of(&metadata);
        if end_us > duration {
            return Ok(Err(bounds()));
        }
        if start_us < 0 || end_us <= start_us || last < first {
            return Ok(Err(bounds()));
        }
        let splice = SpliceMap::new(start_us, end_us, &active_cuts);
        if splice.output_duration_us <= 0 {
            return Ok(Err(bounds()));
        }
        let clamp = edited.is_some();
        let mut styled = Vec::new();
        let mut source_starts = Vec::new();
        let mut source_ends = Vec::new();
        let mut sentence_ids = Vec::new();
        let caption_track = if frozen_captions.is_some() || translated_sentences.is_some() {
            "translated"
        } else {
            "original"
        };
        if let Some(frozen_words) = frozen_captions {
            for (idx, w) in frozen_words.iter().enumerate() {
                let cs = if clamp {
                    w.start_us.max(start_us)
                } else {
                    w.start_us
                };
                let ce = if clamp {
                    w.end_us.min(end_us)
                } else {
                    w.end_us
                };
                let Some((mapped_start, mapped_end)) = splice.remap_word(cs, ce) else {
                    continue;
                };
                source_starts.push(cs);
                source_ends.push(ce);
                sentence_ids.push(w.sentence_id);
                styled.push(StyledWord {
                    word: CaptionWord {
                        text: w.text.clone(),
                        start_us: mapped_start,
                        end_us: mapped_end,
                    },
                    position: -(idx as i64 + 1),
                    overrides: WordOverride::default(),
                });
            }
        } else if let Some(ref translated) = translated_sentences {
            let mut sq = c.prepare("SELECT id,first_position,last_position,start_us,end_us FROM sentences WHERE transcript_id=?1 AND ((?6=1 AND end_us>?4 AND start_us<?5) OR (?6=0 AND id BETWEEN ?2 AND ?3)) ORDER BY id")?;
            let sentence_rows = sq
                .query_map(
                    (
                        transcript,
                        request.start_id,
                        request.end_id,
                        start_us,
                        end_us,
                        clamp,
                    ),
                    |r| {
                        Ok((
                            r.get::<_, i64>(0)?,
                            r.get::<_, i64>(1)?,
                            r.get::<_, i64>(2)?,
                            r.get::<_, i64>(3)?,
                            r.get::<_, i64>(4)?,
                        ))
                    },
                )?
                .collect::<rusqlite::Result<Vec<_>>>()?;
            let mut wq = c.prepare(&format!("SELECT {},w.start_us,w.end_us,w.position,o.document FROM transcript_words w LEFT JOIN caption_word_overrides o ON o.transcript_id=w.transcript_id AND o.position=w.position WHERE w.transcript_id=?1 AND w.kind='word' AND w.position BETWEEN ?2 AND ?3 ORDER BY w.position",crate::corrections::EFFECTIVE_TEXT))?;
            let mut synthetic_idx = 0_i64;
            for (sentence_id, s_first, s_last, s_start_us, s_end_us) in sentence_rows {
                if let Some(translated_text) = translated.get(&sentence_id) {
                    let clamp_start = if clamp {
                        s_start_us.max(start_us)
                    } else {
                        s_start_us
                    };
                    let clamp_end = if clamp {
                        s_end_us.min(end_us)
                    } else {
                        s_end_us
                    };
                    let intervals: Vec<(i64, i64)> = splice
                        .segments
                        .iter()
                        .filter_map(|seg| {
                            let a = seg.source_start_us.max(clamp_start);
                            let b = seg.source_end_us.min(clamp_end);
                            (b > a).then_some((a, b))
                        })
                        .collect();
                    for w in crate::translation::interpolate_words_in_intervals(
                        translated_text,
                        &intervals,
                    ) {
                        let Some((mapped_start, mapped_end)) =
                            splice.remap_word(w.start_us, w.end_us)
                        else {
                            continue;
                        };
                        synthetic_idx += 1;
                        source_starts.push(w.start_us);
                        source_ends.push(w.end_us);
                        sentence_ids.push(Some(sentence_id));
                        styled.push(StyledWord {
                            word: CaptionWord {
                                text: format!(" {}", w.text),
                                start_us: mapped_start,
                                end_us: mapped_end,
                            },
                            position: -synthetic_idx,
                            overrides: WordOverride::default(),
                        });
                    }
                } else {
                    let rows = wq
                        .query_map((transcript, s_first, s_last), |r| {
                            Ok((
                                r.get::<_, String>(0)?,
                                r.get::<_, i64>(1)?,
                                r.get::<_, i64>(2)?,
                                r.get::<_, i64>(3)?,
                                r.get::<_, Option<String>>(4)?
                                    .map(|doc| serde_json::from_str::<WordOverride>(&doc))
                                    .transpose()
                                    .map_err(|_| rusqlite::Error::InvalidQuery)?
                                    .unwrap_or_default(),
                            ))
                        })?
                        .collect::<rusqlite::Result<Vec<_>>>()?;
                    for (text, start, end, position, overrides) in rows {
                        let cs = if clamp { start.max(start_us) } else { start };
                        let ce = if clamp { end.min(end_us) } else { end };
                        let Some((mapped_start, mapped_end)) = splice.remap_word(cs, ce) else {
                            continue;
                        };
                        source_starts.push(cs);
                        source_ends.push(ce);
                        sentence_ids.push(Some(sentence_id));
                        styled.push(StyledWord {
                            word: CaptionWord {
                                text,
                                start_us: mapped_start,
                                end_us: mapped_end,
                            },
                            position,
                            overrides,
                        });
                    }
                }
            }
        } else {
            // Bordas congeladas podem anteceder a edição atual; busque pelo tempo na Transcrição.
            let mut q=c.prepare(&format!("SELECT {},w.start_us,w.end_us,w.position,o.document,(SELECT s.id FROM sentences s WHERE s.transcript_id=w.transcript_id AND w.position BETWEEN s.first_position AND s.last_position LIMIT 1) FROM transcript_words w LEFT JOIN caption_word_overrides o ON o.transcript_id=w.transcript_id AND o.position=w.position WHERE w.transcript_id=?1 AND w.kind='word' AND ((?6=1 AND w.end_us>?4 AND w.start_us<?5) OR (?6=0 AND w.position BETWEEN ?2 AND ?3)) ORDER BY w.position",crate::corrections::EFFECTIVE_TEXT))?;
            let rows = q
                .query_map((transcript, first, last, start_us, end_us, clamp), |r| {
                    Ok((
                        r.get::<_, String>(0)?,
                        r.get::<_, i64>(1)?,
                        r.get::<_, i64>(2)?,
                        r.get::<_, i64>(3)?,
                        r.get::<_, Option<String>>(4)?
                            .map(|doc| serde_json::from_str::<WordOverride>(&doc))
                            .transpose()
                            .map_err(|_| rusqlite::Error::InvalidQuery)?
                            .unwrap_or_default(),
                        r.get::<_, Option<i64>>(5)?,
                    ))
                })?
                .collect::<rusqlite::Result<Vec<_>>>()?;
            styled.reserve(rows.len());
            source_starts.reserve(rows.len());
            source_ends.reserve(rows.len());
            sentence_ids.reserve(rows.len());
            for (text, start, end, position, overrides, sentence_id) in rows {
                let cs = if clamp { start.max(start_us) } else { start };
                let ce = if clamp { end.min(end_us) } else { end };
                let Some((mapped_start, mapped_end)) = splice.remap_word(cs, ce) else {
                    continue;
                };
                source_starts.push(cs);
                source_ends.push(ce);
                sentence_ids.push(sentence_id);
                styled.push(StyledWord {
                    word: CaptionWord {
                        text,
                        start_us: mapped_start,
                        end_us: mapped_end,
                    },
                    position,
                    overrides,
                });
            }
        }
        let crop_plan = edited
            .as_ref()
            .filter(|doc| doc.crop.has_explicit_crop())
            .map(|doc| crop::resolve_plan(&doc.crop, source_aspect, start_us, end_us));
        let crop = crop_plan
            .as_ref()
            .and_then(|p| p.panels.first().map(|panel| panel.segments.clone()))
            .unwrap_or_else(|| {
                edited
                    .as_ref()
                    .map(|doc| crop::resolve(&doc.crop))
                    .unwrap_or_default()
            });
        let words = styled
            .iter()
            .filter(|w| !w.overrides.hidden.unwrap_or(false))
            .map(|w| w.word.clone())
            .collect();
        Ok(Ok(Target {
            start_us,
            end_us,
            output_duration_us: splice.output_duration_us,
            words,
            styled,
            source_starts,
            source_ends,
            sentence_ids,
            segments: splice.segments,
            active_cuts,
            transcript,
            crop,
            crop_plan,
            caption_track,
            target_language: active_lang,
        }))
    })?
}

pub(crate) fn current_path() -> Result<PathBuf, CoreError> {
    let current = crate::dispatch("projects.current", json!({}), &mut |_| {})?;
    current["path"]
        .as_str()
        .map(PathBuf::from)
        .ok_or_else(|| error("invalid_project", "Abra um Projeto para exportar."))
}

fn cmd_captions(v: Value, _: &mut EventSink<'_>) -> CommandResult {
    let _project = projects::start_job()?;
    let style = request_style(&v)?;
    let request = parse(v)?;
    let target = target(&request, None, None)?;
    let words = captions::sanitize(&target.words)?;
    let prepared = caption_style::prepare(&target.styled, &style, target.output_duration_us)?;
    let missing = target.missing_glyphs(&style);
    let editable: Vec<_> = target
        .styled
        .iter()
        .zip(target.source_starts.iter())
        .map(|(w, source_start_us)| {
            let missing_glyph = missing.iter().find(|m| m.position == w.position);
            json!({
                "position": w.position,
                "text": w.word.text,
                "startUs": w.word.start_us,
                "endUs": w.word.end_us,
                "sourceStartUs": source_start_us,
                "overrides": w.overrides,
                "missingGlyph": missing_glyph,
            })
        })
        .collect();
    Ok(
        json!({"ass":prepared.ass,"lines":captions::layout(&words),"start_us":target.start_us,"end_us":target.end_us,"durationUs":target.output_duration_us,"segments":target.segments,"cues":prepared.cues,"style":prepared.style,"emojiRemoved":prepared.emoji_removed,"words":editable,"transcriptId":target.transcript,"missingGlyphs":missing,"track":target.caption_track,"targetLanguage":target.target_language}),
    )
}

fn style_for_clip(clip_id: Option<i64>) -> Result<Style, CoreError> {
    match clip_id {
        Some(id) => caption_style::store::style(ClipId(id)),
        None => Ok(Style::preset(Preset::Vertical)),
    }
}

fn request_style(v: &Value) -> Result<Style, CoreError> {
    style_for_clip(v["clip_id"].as_i64())
}

fn check_target_glyphs(target: &Target, style: &Style) -> Result<(), CoreError> {
    let missing = target.missing_glyphs(style);
    if missing.is_empty() {
        Ok(())
    } else {
        Err(glyph_missing_error(&style.font, missing))
    }
}

pub(crate) fn prepare_start_request(
    mut request: StartRequest,
    project: &Path,
) -> Result<(StartRequest, i64), CoreError> {
    // Ignora qualquer snapshot enviado pela UI; o núcleo resolve o documento atual.
    let resolved = target(&request.cut, None, None)?;
    let style = style_for_clip(request.cut.clip_id)?;
    request.resolved_bounds = request
        .cut
        .clip_id
        .map(|_| (resolved.start_us, resolved.end_us));
    request.resolved_silences = request.cut.clip_id.map(|_| resolved.active_cuts.clone());
    request.resolved_crop = request.cut.clip_id.map(|_| resolved.crop.clone());
    request.resolved_crop_plan = resolved.crop_plan.clone();
    request.resolved_captions =
        (resolved.caption_track == "translated").then(|| resolved.frozen_captions());
    request.resolved_narration_starts = request
        .cut
        .clip_id
        .map(crate::editor::edits::document)
        .transpose()?
        .map(|doc| doc.narration_starts);
    render::validate_output_with_overwrite(&request.output, request.overwrite)?;
    let _ = crate::jobs::preview::source(request.cut.source_id, project)?;
    check_target_glyphs(&resolved, &style)?;
    let total_duration_us = resolve_narration_render(
        request.cut.candidate_id,
        request.cut.clip_id,
        &resolved,
        request.resolved_narration_starts.as_ref(),
    )?
    .map_or(resolved.output_duration_us, |n| n.total_duration_us);
    Ok((request, total_duration_us))
}

/// Resolve as faixas de Narração e `tpad` final a partir de `montage::audio_mix_plan` e dos
/// WAVs gravados pelo #79. Retorna `None` quando o Corte não tem Narração sintetizada.
fn resolve_narration_render(
    candidate_id: Option<i64>,
    clip_id: Option<i64>,
    target: &Target,
    frozen_starts: Option<&std::collections::BTreeMap<i64, i64>>,
) -> Result<Option<render::NarrationRenderInput>, CoreError> {
    let Some(candidate_id) = candidate_id else {
        return Ok(None);
    };
    let Some(script_doc) = crate::script::montage_blocks_readonly(candidate_id)? else {
        return Ok(None);
    };
    let audio_map = crate::tts::block_audio_for_candidate(candidate_id)?;
    if audio_map.is_empty() {
        return Ok(None);
    }
    let manual_starts = match frozen_starts {
        Some(starts) => starts.clone(),
        None => match clip_id {
            Some(id) => crate::editor::edits::document(id)?.narration_starts,
            None => std::collections::BTreeMap::new(),
        },
    };
    let sentences = crate::montage::load_transcript_sentences(target.transcript)?;
    let splice = SpliceMap::new(target.start_us, target.end_us, &target.active_cuts);
    let blocks: Vec<crate::montage::MontageBlockInput> = script_doc
        .blocks
        .into_iter()
        .map(|b| {
            let (duration_us, estimated) = match audio_map.get(&b.id) {
                Some(audio) => (audio.duration_us, false),
                None => (
                    b.narration
                        .as_deref()
                        .map_or(0, crate::montage::estimate_block_duration_us),
                    true,
                ),
            };
            crate::montage::MontageBlockInput {
                block_id: b.id,
                position: b.position,
                title: b.title,
                refs: b.refs,
                duration_us,
                estimated,
            }
        })
        .collect();
    let plan = crate::montage::resolve(&crate::montage::MontageInput {
        blocks: &blocks,
        sentences: &sentences,
        splice: &splice,
        manual_starts: &manual_starts,
    })?;
    let mix = crate::montage::audio_mix_plan(&plan);
    let tracks: Vec<render::NarrationTrackInput> = mix
        .segments
        .into_iter()
        .filter_map(|seg| {
            audio_map
                .get(&seg.block_id)
                .map(|audio| render::NarrationTrackInput {
                    path: audio.path.clone(),
                    start_us: seg.start_us,
                    duration_us: audio.duration_us,
                })
        })
        .collect();
    if tracks.is_empty() {
        return Ok(None);
    }
    let narration_end_us = tracks
        .iter()
        .map(|t| t.start_us + t.duration_us)
        .max()
        .unwrap_or(0);
    let clip_duration_us = mix.clip_duration_us;
    let freeze_tail_us = (narration_end_us - clip_duration_us).max(0);
    let total_duration_us = clip_duration_us + freeze_tail_us;
    Ok(Some(render::NarrationRenderInput {
        tracks,
        clip_duration_us,
        freeze_tail_us,
        total_duration_us,
    }))
}

pub(crate) fn enqueue_tx(
    tx: &rusqlite::Transaction<'_>,
    request: &StartRequest,
    batch_key: Option<&str>,
) -> rusqlite::Result<i64> {
    let encoded = serde_json::to_string(request).map_err(|_| rusqlite::Error::InvalidQuery)?;
    tx.execute(
        "INSERT INTO jobs(kind,safety,state,source_id,batch) VALUES ('export','local','queued',?1,?2)",
        (request.cut.source_id, batch_key),
    )?;
    let id = tx.last_insert_rowid();
    tx.execute(
        "INSERT INTO exports(job_id,request) VALUES (?1,?2)",
        (id, encoded),
    )?;
    Ok(id)
}

fn cmd_start(v: Value, _: &mut EventSink<'_>) -> CommandResult {
    let _guard = projects::start_job()?;
    let mut request: StartRequest = serde_json::from_value(v).map_err(|_| bounds())?;
    // O export avulso nunca sobrescreve destino existente.
    request.overwrite = false;
    let project = current_path()?;
    let (request, _) = prepare_start_request(request, &project)?;
    if crate::components::cache_settings()?.2.is_none() {
        return Err(error("component_missing", "Instale o Componente FFmpeg."));
    }
    let id = projects::with_writer(|c| {
        let tx = c.transaction()?;
        let id = enqueue_tx(&tx, &request, None)?;
        tx.commit()?;
        Ok(id)
    })?;
    // Preferência local, fora do Projeto portátil. Uma falha de preferência não perde o job.
    let _ = save_directory(request.output.parent().unwrap());
    Ok(json!({"job":id,"state":"queued"}))
}

fn cmd_status(v: Value, _: &mut EventSink<'_>) -> CommandResult {
    let id = v["job"]
        .as_i64()
        .ok_or_else(|| error("invalid_job", "Tarefa inválida."))?;
    projects::with_reader(|c| {
        c.query_row("SELECT j.state,j.progress,e.request,e.error_code,e.error_message,e.error_details,e.encoder,e.fallback_from,e.fallback_reason FROM exports e JOIN jobs j ON j.id=e.job_id WHERE j.id=?1",[id],|r| {
        let request:String=r.get(2)?;
        let request:Value=serde_json::from_str(&request).unwrap_or(Value::Null);
        let code:Option<String>=r.get(3)?;
        let message:Option<String>=r.get(4)?;
        let details:Option<String>=r.get(5)?;
        let error=code.map(|code| {
            let mut obj=json!({"code":code,"message":message});
            if let Some(usage)=details.and_then(|raw| serde_json::from_str::<Value>(&raw).ok()) {
                obj["usage"]=usage;
            }
            obj
        });
        Ok(json!({"job":id,"state":r.get::<_,String>(0)?,"progress":r.get::<_,i64>(1)?,"output":request["output"],"error":error}))
    })
    })
}

fn settings_path() -> Result<PathBuf, CoreError> {
    crate::paths::config_file("export-settings.json").map_err(|_| failed())
}
pub(crate) fn save_directory(path: &Path) -> Result<(), CoreError> {
    let target = settings_path()?;
    fs::create_dir_all(target.parent().unwrap()).map_err(|_| failed())?;
    fs::write(target, json!({"last_directory":path}).to_string()).map_err(|_| failed())
}
fn cmd_settings(_: Value, _: &mut EventSink<'_>) -> CommandResult {
    let saved = fs::read(settings_path()?)
        .ok()
        .and_then(|bytes| serde_json::from_slice::<Value>(&bytes).ok());
    let directory = saved
        .as_ref()
        .and_then(|v| v["last_directory"].as_str())
        .filter(|p| Path::new(p).is_absolute() && Path::new(p).is_dir());
    Ok(json!({"last_directory":directory}))
}

pub(crate) fn run(
    id: i64,
    _source: i64,
    project: &Path,
    stop: &AtomicBool,
) -> Result<(), CoreError> {
    let mut used: Option<encoder::Outcome> = None;
    let result = (|| {
        crate::jobs::preview::check(id, stop)?;
        let request: String = projects::with_reader(|c| {
            c.query_row("SELECT request FROM exports WHERE job_id=?1", [id], |r| {
                r.get(0)
            })
        })?;
        let encoded: Value = serde_json::from_str(&request).map_err(|_| failed())?;
        let style = request_style(&encoded)?;
        let request: StartRequest = serde_json::from_value(encoded).map_err(|_| failed())?;
        let frozen = request
            .resolved_bounds
            .map(|b| (b, request.resolved_silences.clone().unwrap_or_default()));
        let target = target(&request.cut, frozen, request.resolved_captions.as_deref())?;
        check_target_glyphs(&target, &style)?;
        let prepared = caption_style::prepare(&target.styled, &style, target.output_duration_us)?;
        let narration = resolve_narration_render(
            request.cut.candidate_id,
            request.cut.clip_id,
            &target,
            request.resolved_narration_starts.as_ref(),
        )?;
        let (source, _, audio, _, _) =
            crate::jobs::preview::source(request.cut.source_id, project)?;
        let ffmpeg = crate::components::cache_settings()?
            .2
            .ok_or_else(|| error("component_missing", "Instale o Componente FFmpeg."))?;
        let crop_plan = request.resolved_crop_plan.or(target.crop_plan);
        let crop = request.resolved_crop.unwrap_or(target.crop);
        let input = render::RenderInput {
            source,
            output: request.output,
            start_us: target.start_us,
            end_us: target.end_us,
            audio_track: audio,
            words: target.words,
            crop,
        };
        let cancel = crate::provider::CancelToken::new();
        // Etapa de encoder (#62): detecta na primeira vez, usa o do cache e cai para x264.
        let preferred = encoder::resolve(&ffmpeg, &cancel)?;
        let finished = AtomicBool::new(false);
        crate::jobs::progress(id, "export", 1, "Exportando Corte")?;
        batch::on_job_progress(id);
        let result = std::thread::scope(|scope| {
            scope.spawn(|| {
                while !finished.load(Ordering::SeqCst) {
                    if stop.load(Ordering::SeqCst) || crate::jobs::preview::is_cancelled(id) {
                        cancel.cancel();
                        break;
                    }
                    std::thread::sleep(Duration::from_millis(25));
                }
            });
            let mut last = 0;
            let result = encoder::render_styled_spliced_crop_plan_narration_with_fallback_overwrite(
                &ffmpeg,
                &input,
                &target.segments,
                &prepared,
                &preferred,
                request.overwrite,
                crop_plan.as_ref(),
                narration.as_ref(),
                &cancel,
                &mut |percentage| {
                    if percentage > last {
                        let _ = crate::jobs::progress(id, "export", percentage, "Exportando Corte");
                        batch::on_job_progress(id);
                        last = percentage;
                    }
                },
            );
            finished.store(true, Ordering::SeqCst);
            result
        });
        if stop.load(Ordering::SeqCst) && result.as_ref().is_err_and(|e| e.code == "cancelled") {
            return Err(error("interrupted", "O export foi interrompido."));
        }
        result.map(|outcome| used = Some(outcome))
    })();
    let details = result
        .as_ref()
        .err()
        .and_then(|e| e.usage.as_ref())
        .and_then(|u| serde_json::to_string(u).ok());
    projects::with_writer(|c| {
        c.execute(
            "UPDATE exports SET error_code=?2,error_message=?3,error_details=?4,encoder=?5,fallback_from=?6,fallback_reason=?7 WHERE job_id=?1",
            (
                id,
                result.as_ref().err().map(|e| &e.code),
                result.as_ref().err().map(|e| &e.message),
                details.as_deref(),
                used.as_ref().map(|o| &o.encoder),
                used.as_ref().and_then(|o| o.fallback.as_ref()).map(|f| &f.from),
                used.as_ref().and_then(|o| o.fallback.as_ref()).map(|f| f.reason),
            ),
        )?;
        Ok(())
    })?;
    result
}

inventory::submit! { CommandRegistration {name:"export.start",execute:cmd_start} }
inventory::submit! { CommandRegistration {name:"export.captions",execute:cmd_captions} }
inventory::submit! { CommandRegistration {name:"export.status",execute:cmd_status} }
inventory::submit! { CommandRegistration {name:"export.settings",execute:cmd_settings} }

pub(crate) fn error(code: &str, message: &str) -> crate::CoreError {
    crate::CoreError {
        code: code.into(),
        message: message.into(),
        usage: None,
    }
}
pub(crate) fn failed() -> crate::CoreError {
    error("export_failed", "Não foi possível exportar o Corte.")
}
pub(crate) fn glyph_missing_error(
    font: &str,
    missing: Vec<captions::MissingGlyph>,
) -> crate::CoreError {
    let first = &missing[0];
    let message = match first.sentence_id {
        Some(sentence_id) => format!(
            "A fonte da legenda ({font}) não tem glifo para “{}” ({}, Frase {sentence_id}) em “{}”. Corrija a palavra na Transcrição.",
            first.char, first.codepoint, first.word
        ),
        None => format!(
            "A fonte da legenda ({font}) não tem glifo para “{}” ({}) em “{}”. Corrija a palavra na Transcrição.",
            first.char, first.codepoint, first.word
        ),
    };
    crate::CoreError {
        code: "export_glyph_missing".into(),
        message,
        usage: Some(json!({
            "font": font,
            "missing_glyphs": missing,
        })),
    }
}
