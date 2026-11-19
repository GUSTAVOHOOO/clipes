//! Guarda-corpos de monetização e originalidade (#76; ADR-0001, ADR-0007).
//!
//! Todos os guarda-corpos são informativos e nunca bloqueiam a exportação. Não há chamada de IA,
//! rede nem heurística de evasão de detecção.

use crate::editor::silences::SpliceMap;
use crate::selection::cut::VideoKind;
use crate::{channel_profile, projects, CommandRegistration, CommandResult, CoreError, EventSink};
use rusqlite::OptionalExtension;
use serde_json::{json, Value};
use std::collections::HashMap;

/// Limite de duração (60 s em µs) a partir do qual Shorts com conteúdo reivindicado por música são
/// bloqueados e inelegíveis para monetização no YouTube.
pub const SHORT_CLAIM_LIMIT_US: i64 = 60_000_000;

inventory::submit! {
    projects::Migration {
        id: "0076_001_channel_guardrails",
        sql: "ALTER TABLE channel_profile ADD COLUMN direct_monetization_ack INTEGER NOT NULL DEFAULT 0 CHECK(direct_monetization_ack IN (0,1));",
    }
}

fn error(code: &str, message: &str) -> CoreError {
    CoreError {
        code: code.into(),
        message: message.into(),
        usage: None,
    }
}

#[derive(Clone, Debug)]
struct PermissionInfo {
    granted: bool,
    who: Option<String>,
    where_text: Option<String>,
    scope: Option<String>,
}

fn read_source_permission(
    c: &rusqlite::Connection,
    source_id: i64,
) -> rusqlite::Result<Option<PermissionInfo>> {
    let raw: Option<String> = c
        .query_row(
            "SELECT permission FROM sources WHERE id=?1",
            [source_id],
            |r| r.get(0),
        )
        .optional()?;
    Ok(raw.map(|raw| {
        let parsed: Value = serde_json::from_str(&raw).unwrap_or(Value::Null);
        let granted = parsed["status"].as_str() == Some("granted");
        let field = |k: &str| {
            parsed[k]
                .as_str()
                .map(str::trim)
                .filter(|s| !s.is_empty())
                .map(str::to_owned)
        };
        PermissionInfo {
            granted,
            who: if granted { field("who") } else { None },
            where_text: if granted { field("where") } else { None },
            scope: if granted { field("scope") } else { None },
        }
    }))
}

fn effective_clip_duration(clip_id: Option<i64>) -> Option<i64> {
    let cid = clip_id?;
    let doc = crate::editor::edits::document(cid).ok()?;
    let splice = SpliceMap::new(doc.range.start_us, doc.range.end_us, &doc.active_silences());
    Some(splice.output_duration_us.max(0))
}

fn resolve_candidate_clip_id(candidate_id: i64, explicit_clip_id: Option<i64>) -> Option<i64> {
    if explicit_clip_id.is_some() {
        return explicit_clip_id;
    }
    crate::editor::edits::clip_id_for_candidate(candidate_id)
        .ok()
        .flatten()
}

fn narration_freeze_tail_us(clip_id: Option<i64>, candidate_id: i64) -> i64 {
    let resolved_clip = resolve_candidate_clip_id(candidate_id, clip_id);
    crate::montage::plan_for_clip(resolved_clip, candidate_id, &[])
        .ok()
        .flatten()
        .map_or(0, |p| p.freeze_tail_us.max(0))
}

fn sentence_range_duration(
    c: &rusqlite::Connection,
    source_id: i64,
    start_id: i64,
    end_id: i64,
) -> Option<i64> {
    if start_id <= 0 || end_id < start_id {
        return None;
    }
    let transcript_id: i64 = c
        .query_row(
            "SELECT t.id FROM transcripts t JOIN sources s ON s.id=t.source_id AND s.audio_track=t.audio_track WHERE s.id=?1 AND t.state='complete'",
            [source_id],
            |r| r.get(0),
        )
        .optional()
        .ok()??;
    c.query_row(
        "SELECT b.end_us - a.start_us FROM sentences a JOIN sentences b ON a.transcript_id=b.transcript_id WHERE a.transcript_id=?1 AND a.id=?2 AND b.id=?3",
        (transcript_id, start_id, end_id),
        |r| r.get::<_, i64>(0),
    )
    .optional()
    .ok()
    .flatten()
    .map(|d| d.max(0))
}

fn candidate_video_kind(c: &rusqlite::Connection, candidate_id: Option<i64>) -> Option<VideoKind> {
    let cid = candidate_id?;
    crate::selection::effective_video_kind(c, cid)
        .ok()
        .flatten()
}

fn resolve_single_clip_id(
    explicit_clip_id: Option<i64>,
    candidate_id: Option<i64>,
    source_id: i64,
    start_id: Option<i64>,
    end_id: Option<i64>,
) -> Option<i64> {
    if explicit_clip_id.is_some() {
        return explicit_clip_id;
    }
    if let Some(cid) = candidate_id {
        return resolve_candidate_clip_id(cid, None);
    }
    let (s, e) = (start_id?, end_id?);
    crate::editor::edits::clip_id_for_source_range(source_id, s, e)
        .ok()
        .flatten()
}

fn clip_audio_summary(clip_id: Option<i64>) -> crate::audio::GuardrailAudioSummary {
    let Some(cid) = clip_id else {
        return crate::audio::GuardrailAudioSummary::default();
    };
    let Ok(ids) = crate::editor::edits::audio_asset_ids_for_clip(cid) else {
        return crate::audio::GuardrailAudioSummary::default();
    };
    if ids.is_empty() {
        return crate::audio::GuardrailAudioSummary::default();
    }
    projects::with_reader(|c| crate::audio::guardrail_summary_for_assets(c, &ids))
        .unwrap_or_default()
}

fn check_single(v: &Value, ack: bool) -> CommandResult {
    let source_id = v["source_id"]
        .as_i64()
        .ok_or_else(|| error("source_missing", "Fonte não encontrada."))?;
    let candidate_id = v["candidate_id"].as_i64();
    let clip_id = v["clip_id"].as_i64();
    let start_id = v["start_id"].as_i64();
    let end_id = v["end_id"].as_i64();

    let (perm, kind_from_cand, range_duration) = projects::with_reader(|c| {
        let perm = read_source_permission(c, source_id)?;
        let kind = candidate_video_kind(c, candidate_id);
        let dur = match (start_id, end_id) {
            (Some(s), Some(e)) => sentence_range_duration(c, source_id, s, e),
            _ => None,
        };
        Ok((perm, kind, dur))
    })?;
    let perm = perm.ok_or_else(|| error("source_missing", "Fonte não encontrada."))?;

    let video_kind = match kind_from_cand {
        Some(k) => k,
        None => channel_profile::selection_defaults()?.video_kind,
    };

    let duration_us = effective_clip_duration(clip_id)
        .or(range_duration)
        .or_else(|| {
            let cid = candidate_id?;
            let cut = crate::selection::approved_cut(cid).ok()?;
            let first = cut.sentences.first()?;
            let last = cut.sentences.last()?;
            Some((last.end_us - first.start_us).max(0))
        })
        .unwrap_or(0);

    let script_json = if video_kind == VideoKind::Transformed {
        match candidate_id {
            Some(cid) => match crate::script::guardrail_status(cid) {
                Ok(Some(st)) => json!({
                    "applicable": true,
                    "exists": st.has_script,
                    "approved": st.approved,
                    "pendingBlocks": st.pending_blocks,
                    "totalBlocks": st.total_blocks,
                }),
                Ok(None) => json!({ "applicable": false }),
                Err(e) if e.code == "not_approved" || e.code == "candidate_not_found" => json!({
                    "applicable": true,
                    "exists": false,
                    "approved": false,
                    "pendingBlocks": 0,
                    "totalBlocks": 0,
                }),
                Err(e) => return Err(e),
            },
            None => json!({
                "applicable": true,
                "exists": false,
                "approved": false,
                "pendingBlocks": 0,
                "totalBlocks": 0,
            }),
        }
    } else {
        json!({ "applicable": false })
    };

    let narration_json = if video_kind == VideoKind::Transformed {
        match candidate_id {
            Some(cid) => {
                let freeze_tail_us = narration_freeze_tail_us(clip_id, cid);
                let long_freeze_tail = freeze_tail_us > crate::montage::LONG_FREEZE_TAIL_US;
                match crate::tts::guardrail_status(cid) {
                    Ok(Some(st)) => json!({
                        "applicable": true,
                        "hasTts": st.has_tts,
                        "generatedBlocks": st.generated_blocks,
                        "totalBlocks": st.total_blocks,
                        "voices": st.voices,
                        "freezeTailUs": freeze_tail_us,
                        "longFreezeTail": long_freeze_tail,
                    }),
                    Ok(None) => json!({ "applicable": false }),
                    Err(e) if e.code == "not_approved" || e.code == "candidate_not_found" => {
                        json!({
                            "applicable": true,
                            "hasTts": false,
                            "generatedBlocks": 0,
                            "totalBlocks": 0,
                            "voices": [],
                            "freezeTailUs": freeze_tail_us,
                            "longFreezeTail": long_freeze_tail,
                        })
                    }
                    Err(e) => return Err(e),
                }
            }
            None => json!({
                "applicable": true,
                "hasTts": false,
                "generatedBlocks": 0,
                "totalBlocks": 0,
                "voices": [],
                "freezeTailUs": 0,
                "longFreezeTail": false,
            }),
        }
    } else {
        json!({ "applicable": false })
    };

    let resolved_clip = resolve_single_clip_id(clip_id, candidate_id, source_id, start_id, end_id);
    let audio_summary = clip_audio_summary(resolved_clip);
    let has_direct = video_kind == VideoKind::Direct;
    let over60s = duration_us > SHORT_CLAIM_LIMIT_US;
    Ok(json!({
        "scope": "single",
        "directMonetizationAck": ack,
        "needsDirectNotice": !ack && has_direct,
        "videoKind": video_kind.as_str(),
        "hasDirect": has_direct,
        "hasTransformed": video_kind == VideoKind::Transformed,
        "totalCuts": 1,
        "durationUs": duration_us,
        "over60s": over60s,
        "over60sCount": if over60s { 1 } else { 0 },
        "shortClaimLimitUs": SHORT_CLAIM_LIMIT_US,
        "permission": {
            "status": if perm.granted { "granted" } else { "none" },
            "grantedCount": if perm.granted { 1 } else { 0 },
            "missingCount": if perm.granted { 0 } else { 1 },
            "totalCount": 1,
            "who": perm.who,
            "where": perm.where_text,
            "scope": perm.scope,
        },
        "script": script_json,
        "narration": narration_json,
        "audio": {
            "hasAudio": audio_summary.has_audio,
            "assetCount": audio_summary.asset_count,
            "unverifiedCount": audio_summary.unverified_count,
        },
    }))
}

fn check_batch(scope: &str, v: &Value, ack: bool) -> CommandResult {
    let scope_source = if scope == "source" {
        Some(
            v["source_id"]
                .as_i64()
                .ok_or_else(|| error("source_missing", "Fonte não encontrada."))?,
        )
    } else {
        None
    };

    let cuts = match crate::export::batch::collect_cuts(scope_source) {
        Ok(list) => list,
        Err(e) if e.code == "export_batch_empty" => Vec::new(),
        Err(e) => return Err(e),
    };

    if cuts.is_empty() {
        let defaults = channel_profile::selection_defaults()?;
        let perm = if let Some(sid) = scope_source {
            projects::with_reader(|c| read_source_permission(c, sid))?.map(|p| {
                json!({
                    "status": if p.granted { "granted" } else { "none" },
                    "grantedCount": if p.granted { 1 } else { 0 },
                    "missingCount": if p.granted { 0 } else { 1 },
                    "totalCount": 1,
                    "who": p.who,
                    "where": p.where_text,
                    "scope": p.scope,
                })
            })
        } else {
            None
        }
        .unwrap_or_else(|| {
            json!({
                "status": "none",
                "grantedCount": 0,
                "missingCount": 0,
                "totalCount": 0,
            })
        });

        return Ok(json!({
            "scope": scope,
            "directMonetizationAck": ack,
            "needsDirectNotice": false,
            "videoKind": defaults.video_kind.as_str(),
            "hasDirect": false,
            "hasTransformed": false,
            "totalCuts": 0,
            "durationUs": 0,
            "over60s": false,
            "over60sCount": 0,
            "shortClaimLimitUs": SHORT_CLAIM_LIMIT_US,
            "permission": perm,
            "script": { "applicable": false },
            "narration": { "applicable": false },
            "audio": { "hasAudio": false, "cutsWithAudio": 0, "cutsWithUnverifiedAudio": 0, "unverifiedCount": 0 },
        }));
    }

    let mut has_direct = false;
    let mut has_transformed = false;
    let mut max_duration_us = 0i64;
    let mut over60s_count = 0usize;
    let mut granted_count = 0usize;
    let mut missing_count = 0usize;
    let mut transformed_count = 0usize;
    let mut script_approved_count = 0usize;
    let mut script_unapproved_count = 0usize;
    let mut tts_cut_count = 0usize;
    let mut freeze_tail_count = 0usize;
    let mut long_freeze_tail_count = 0usize;
    let mut max_freeze_tail_us = 0i64;
    let mut cuts_with_audio = 0usize;
    let mut cuts_with_unverified_audio = 0usize;
    let mut total_unverified_audio = 0usize;

    let mut perm_cache: HashMap<i64, PermissionInfo> = HashMap::new();

    for cut in &cuts {
        let kind = projects::with_reader(|c| {
            Ok(crate::selection::effective_video_kind(c, cut.candidate_id)?.unwrap_or_default())
        })?;
        match kind {
            VideoKind::Direct => has_direct = true,
            VideoKind::Transformed => {
                has_transformed = true;
                transformed_count += 1;
                match crate::script::guardrail_status(cut.candidate_id) {
                    Ok(Some(st)) if st.approved => script_approved_count += 1,
                    Ok(Some(_)) => script_unapproved_count += 1,
                    Ok(None) => {}
                    Err(e) if e.code == "not_approved" || e.code == "candidate_not_found" => {
                        script_unapproved_count += 1;
                    }
                    Err(e) => return Err(e),
                }
                if let Ok(Some(tts)) = crate::tts::guardrail_status(cut.candidate_id) {
                    if tts.has_tts {
                        tts_cut_count += 1;
                    }
                }
                let tail_us = narration_freeze_tail_us(cut.clip_id, cut.candidate_id);
                if tail_us > 0 {
                    freeze_tail_count += 1;
                    max_freeze_tail_us = max_freeze_tail_us.max(tail_us);
                    if tail_us > crate::montage::LONG_FREEZE_TAIL_US {
                        long_freeze_tail_count += 1;
                    }
                }
            }
        }

        let perm = if let Some(p) = perm_cache.get(&cut.source_id) {
            p.clone()
        } else {
            let p = projects::with_reader(|c| read_source_permission(c, cut.source_id))?
                .ok_or_else(|| error("source_missing", "Fonte não encontrada."))?;
            perm_cache.insert(cut.source_id, p.clone());
            p
        };
        if perm.granted {
            granted_count += 1;
        } else {
            missing_count += 1;
        }

        let dur = effective_clip_duration(cut.clip_id)
            .unwrap_or(cut.duration_us)
            .max(0);
        if dur > max_duration_us {
            max_duration_us = dur;
        }
        if dur > SHORT_CLAIM_LIMIT_US {
            over60s_count += 1;
        }
        let resolved_clip = resolve_candidate_clip_id(cut.candidate_id, cut.clip_id);
        let cut_audio = clip_audio_summary(resolved_clip);
        if cut_audio.has_audio {
            cuts_with_audio += 1;
            if cut_audio.unverified_count > 0 {
                cuts_with_unverified_audio += 1;
                total_unverified_audio += cut_audio.unverified_count;
            }
        }
    }

    let video_kind = match (has_direct, has_transformed) {
        (true, false) => "direct",
        (false, true) => "transformed",
        (true, true) => "mixed",
        (false, false) => "direct",
    };
    let perm_status = match (granted_count > 0, missing_count > 0) {
        (true, false) => "granted",
        (true, true) => "partial",
        (false, _) => "none",
    };

    Ok(json!({
        "scope": scope,
        "directMonetizationAck": ack,
        "needsDirectNotice": !ack && has_direct,
        "videoKind": video_kind,
        "hasDirect": has_direct,
        "hasTransformed": has_transformed,
        "totalCuts": cuts.len(),
        "durationUs": max_duration_us,
        "over60s": over60s_count > 0,
        "over60sCount": over60s_count,
        "shortClaimLimitUs": SHORT_CLAIM_LIMIT_US,
        "permission": {
            "status": perm_status,
            "grantedCount": granted_count,
            "missingCount": missing_count,
            "totalCount": cuts.len(),
        },
        "script": if has_transformed {
            json!({
                "applicable": true,
                "transformedCount": transformed_count,
                "approvedCount": script_approved_count,
                "unapprovedCount": script_unapproved_count,
            })
        } else {
            json!({ "applicable": false })
        },
        "narration": if has_transformed {
            json!({
                "applicable": true,
                "hasTts": tts_cut_count > 0,
                "ttsCutCount": tts_cut_count,
                "transformedCount": transformed_count,
                "freezeTailCount": freeze_tail_count,
                "longFreezeTailCount": long_freeze_tail_count,
                "maxFreezeTailUs": max_freeze_tail_us,
            })
        } else {
            json!({ "applicable": false })
        },
        "audio": {
            "hasAudio": cuts_with_audio > 0,
            "cutsWithAudio": cuts_with_audio,
            "cutsWithUnverifiedAudio": cuts_with_unverified_audio,
            "unverifiedCount": total_unverified_audio,
        },
    }))
}

/// `guardrails.check {scope?, source_id?, candidate_id?, clip_id?, start_id?, end_id?}`:
/// avalia os guarda-corpos informativos antes de exportar, sem bloquear nem alterar estado.
fn cmd_check(v: Value, _: &mut EventSink<'_>) -> CommandResult {
    let ack = channel_profile::direct_monetization_ack()?;
    let scope = v["scope"].as_str().unwrap_or("single");
    match scope {
        "single" => check_single(&v, ack),
        "source" | "project" => check_batch(scope, &v, ack),
        _ => Err(error(
            "invalid_guardrails_scope",
            "Escopo inválido para os guarda-corpos.",
        )),
    }
}

/// `guardrails.ack_direct_notice {}`: registra uma única vez por canal que o aviso de
/// monetização do Corte direto foi exibido e reconhecido.
fn cmd_ack_direct_notice(_: Value, _: &mut EventSink<'_>) -> CommandResult {
    projects::with_writer(|c| {
        c.execute(
            "INSERT INTO channel_profile (id, direct_monetization_ack) VALUES (1, 1)
             ON CONFLICT(id) DO UPDATE SET direct_monetization_ack = 1",
            [],
        )?;
        Ok(())
    })?;
    Ok(json!({ "directMonetizationAck": true }))
}

inventory::submit! { CommandRegistration { name: "guardrails.check", execute: cmd_check } }
inventory::submit! { CommandRegistration { name: "guardrails.ack_direct_notice", execute: cmd_ack_direct_notice } }
