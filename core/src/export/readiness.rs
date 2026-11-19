//! Prontidão agregada de exportação (`export.readiness`, #298):
//! devolve, em uma única chamada somente leitura, o resumo de prontidão de todos os Cortes
//! aprovados do Projeto aberto (`packaging`, `thumbnail`, `script`, `narration`, `guardrails` e
//! disponibilidade da Fonte), com filtro opcional por `source_id`/`sourceId` e paginação
//! `limit`/`offset`. Nunca dispara IA, rede nem gravações no banco.

use super::error;
use crate::{
    audio::{self, GuardrailAudioSummary},
    channel_profile,
    editor::{self, silences::SpliceMap},
    guardrails::SHORT_CLAIM_LIMIT_US,
    montage::{self, MontageBlockInput, MontageInput, MontagePlan},
    packaging::{self, chapters, Fields, Lang},
    projects,
    selection::{self, cut::VideoKind, ApprovedCut},
    sources, thumbnail, tts, CommandRegistration, CommandResult, CoreError, EventSink,
};
use rusqlite::{Connection, OptionalExtension};
use serde_json::{json, Value};
use std::{
    collections::{BTreeMap, HashMap},
    fs,
    path::{Path, PathBuf},
};

fn parse_optional_source_id(v: &Value) -> Result<Option<i64>, CoreError> {
    let parse_one = |key: &str| -> Result<Option<i64>, CoreError> {
        match v.get(key) {
            None | Some(Value::Null) => Ok(None),
            Some(val) => match val.as_i64() {
                Some(id) if id > 0 => Ok(Some(id)),
                _ => Err(error("invalid_input", &format!("Parâmetro {key} inválido."))),
            },
        }
    };
    let snake = parse_one("source_id")?;
    let camel = parse_one("sourceId")?;
    if let (Some(a), Some(b)) = (snake, camel) {
        if a != b {
            return Err(error(
                "invalid_input",
                "source_id e sourceId informados com valores diferentes.",
            ));
        }
    }
    Ok(snake.or(camel))
}

fn parse_pagination(v: &Value) -> Result<(usize, Option<usize>), CoreError> {
    let offset = match v.get("offset") {
        None | Some(Value::Null) => 0,
        Some(val) => val
            .as_u64()
            .and_then(|n| usize::try_from(n).ok())
            .ok_or_else(|| error("invalid_input", "Parâmetro offset inválido."))?,
    };
    let limit = match v.get("limit") {
        None | Some(Value::Null) => None,
        Some(val) => Some(
            val.as_u64()
                .and_then(|n| usize::try_from(n).ok())
                .ok_or_else(|| error("invalid_input", "Parâmetro limit inválido."))?,
        ),
    };
    Ok((offset, limit))
}

#[derive(Clone)]
struct SourceStatusInfo {
    id: i64,
    name: String,
    path: String,
    status: &'static str,
    available: bool,
    permission_raw: Value,
    granted: bool,
    who: Option<String>,
    where_text: Option<String>,
    scope: Option<String>,
    origin_url: Option<String>,
}

impl SourceStatusInfo {
    fn to_json(&self) -> Value {
        json!({
            "id": self.id,
            "name": self.name,
            "path": self.path,
            "status": self.status,
            "available": self.available,
            "online": self.available,
            "permission": self.permission_raw,
        })
    }

    fn permission_guardrail_json(&self) -> Value {
        json!({
            "status": if self.granted { "granted" } else { "none" },
            "grantedCount": if self.granted { 1 } else { 0 },
            "missingCount": if self.granted { 0 } else { 1 },
            "totalCount": 1,
            "who": self.who,
            "where": self.where_text,
            "scope": self.scope,
        })
    }
}

fn modified_nanos(path: &Path) -> Option<String> {
    let time = fs::metadata(path).ok()?.modified().ok()?;
    Some(match time.duration_since(std::time::UNIX_EPOCH) {
        Ok(d) => d.as_nanos().to_string(),
        Err(e) => format!("-{}", e.duration().as_nanos()),
    })
}

fn resolve_source_path(project_dir: Option<&Path>, stored: &str) -> PathBuf {
    let p = PathBuf::from(stored);
    if p.is_absolute() {
        p
    } else if let Some(root) = project_dir {
        root.join(p)
    } else {
        p
    }
}

fn read_source_info(
    c: &Connection,
    project_dir: Option<&Path>,
    source_id: i64,
) -> Result<SourceStatusInfo, CoreError> {
    let row: Option<(String, i64, String, Option<String>, String, Option<String>)> = c
        .query_row(
            "SELECT path, size, partial_hash, modified, permission, origin_url FROM sources WHERE id=?1",
            [source_id],
            |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?, r.get(3)?, r.get(4)?, r.get(5)?)),
        )
        .optional()
        .map_err(|_| error("project_read", "Não foi possível ler o Projeto."))?;
    let (stored_path, size, partial_hash, saved_modified, perm_str, origin_url) =
        row.ok_or_else(|| error("source_missing", "Fonte não encontrada."))?;

    let resolved = resolve_source_path(project_dir, &stored_path);
    let status = if !resolved.is_file() {
        "offline"
    } else if size >= 0
        && sources::partial(&resolved).is_ok_and(|f| f == (size as u64, partial_hash.clone()))
        && modified_nanos(&resolved).as_ref() == saved_modified.as_ref()
        && saved_modified.is_some()
    {
        "available"
    } else {
        "changed"
    };

    let permission_raw: Value = serde_json::from_str(&perm_str).unwrap_or(Value::Null);
    let granted = permission_raw["status"].as_str() == Some("granted");
    let field = |k: &str| {
        permission_raw[k]
            .as_str()
            .map(str::trim)
            .filter(|s| !s.is_empty())
            .map(str::to_owned)
    };
    let name = resolved
        .file_name()
        .and_then(|s| s.to_str())
        .map(str::to_owned)
        .unwrap_or_else(|| stored_path.clone());
    let who = if granted { field("who") } else { None };
    let where_text = if granted { field("where") } else { None };
    let scope = if granted { field("scope") } else { None };

    Ok(SourceStatusInfo {
        id: source_id,
        name,
        path: resolved.to_string_lossy().into_owned(),
        status,
        available: status == "available",
        permission_raw,
        granted,
        who,
        where_text,
        scope,
        origin_url,
    })
}

struct ScriptReadonlyState {
    exists: bool,
    approved: bool,
    pending_blocks: usize,
    total_blocks: usize,
    busy: bool,
}

impl ScriptReadonlyState {
    fn to_json(&self) -> Value {
        json!({
            "applicable": true,
            "exists": self.exists,
            "approved": self.approved,
            "pendingBlocks": self.pending_blocks,
            "totalBlocks": self.total_blocks,
            "busy": self.busy,
        })
    }
}

fn read_script_state_in(
    c: &Connection,
    run_id: i64,
    identity: (i64, i64),
) -> rusqlite::Result<ScriptReadonlyState> {
    let angle_revision: i64 = c.query_row(
        "SELECT COALESCE(MAX(id),0) FROM script_angles WHERE run_id=?1 AND cand_start_id=?2 AND cand_end_id=?3",
        (run_id, identity.0, identity.1),
        |r| r.get(0),
    )?;

    let mut q = c.prepare(
        "SELECT g.id, g.outline, j.state, j.result
         FROM script_generations g
         LEFT JOIN jobs j ON j.id=g.job_id
         WHERE g.run_id=?1 AND g.cand_start_id=?2 AND g.cand_end_id=?3
         ORDER BY g.id",
    )?;
    struct GenRow {
        id: i64,
        outline_present: bool,
        job_state: Option<String>,
        job_result: Option<String>,
        blocks_count: usize,
        pending_blocks: usize,
        any_block_busy: bool,
    }
    let mut gens: Vec<GenRow> = q
        .query_map((run_id, identity.0, identity.1), |r| {
            let outline: Option<String> = r.get(1)?;
            Ok(GenRow {
                id: r.get(0)?,
                outline_present: outline.is_some(),
                job_state: r.get(2)?,
                job_result: r.get(3)?,
                blocks_count: 0,
                pending_blocks: 0,
                any_block_busy: false,
            })
        })?
        .collect::<rusqlite::Result<Vec<_>>>()?;

    let mut bq = c.prepare("SELECT id FROM script_blocks WHERE generation_id=?1 ORDER BY position")?;
    let mut vq = c.prepare(
        "SELECT v.id, v.narration, v.angle_revision, j.state
         FROM script_block_versions v
         LEFT JOIN jobs j ON j.id=v.job_id
         WHERE v.block_id=?1
         ORDER BY v.id",
    )?;
    let mut aq = c.prepare(
        "SELECT version_id, angle_revision FROM script_approvals WHERE block_id=?1 ORDER BY id DESC LIMIT 1",
    )?;

    for g in &mut gens {
        let block_ids: Vec<i64> = bq
            .query_map([g.id], |r| r.get(0))?
            .collect::<rusqlite::Result<Vec<_>>>()?;
        g.blocks_count = block_ids.len();
        for bid in block_ids {
            let versions: Vec<(i64, Option<String>, i64, Option<String>)> = vq
                .query_map([bid], |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?, r.get(3)?)))?
                .collect::<rusqlite::Result<Vec<_>>>()?;
            let block_busy = versions.iter().any(|(_, narration, _, jstate)| {
                narration.is_none() && matches!(jstate.as_deref(), Some("queued" | "running"))
            });
            if block_busy {
                g.any_block_busy = true;
            }
            let current_ver = versions
                .iter()
                .rev()
                .find(|(_, narration, _, _)| narration.is_some())
                .map(|(vid, _, _, _)| *vid);
            let last_approval: Option<(i64, i64)> = aq
                .query_row([bid], |r| Ok((r.get(0)?, r.get(1)?)))
                .optional()?;
            let is_approved = current_ver
                .zip(last_approval)
                .is_some_and(|(cur, (app_vid, app_angle))| {
                    cur == app_vid && app_angle == angle_revision
                });
            if !is_approved {
                g.pending_blocks += 1;
            }
        }
    }

    let last_gen_busy = gens.last().is_some_and(|g| {
        matches!(g.job_state.as_deref(), Some("queued" | "running")) || g.any_block_busy
    });
    let any_gen_busy = gens.iter().any(|g| {
        matches!(g.job_state.as_deref(), Some("queued" | "running")) || g.any_block_busy
    });

    if let Some(shown) = gens.iter().rev().find(|g| g.blocks_count > 0) {
        let approved = !last_gen_busy && shown.pending_blocks == 0 && shown.blocks_count > 0;
        return Ok(ScriptReadonlyState {
            exists: true,
            approved,
            pending_blocks: shown.pending_blocks,
            total_blocks: shown.blocks_count,
            busy: any_gen_busy,
        });
    }

    // Se há geração concluída ainda não materializada em `script_blocks`, lê em memória sem gravar.
    if let Some(unmaterialized) = gens.iter().rev().find(|g| {
        !g.outline_present && g.job_state.as_deref() == Some("completed") && g.job_result.is_some()
    }) {
        let blocks_len = unmaterialized
            .job_result
            .as_deref()
            .and_then(|raw| serde_json::from_str::<Value>(raw).ok())
            .and_then(|v| v["data"]["blocks"].as_array().map(Vec::len))
            .unwrap_or(0);
        if blocks_len > 0 {
            return Ok(ScriptReadonlyState {
                exists: true,
                approved: false,
                pending_blocks: blocks_len,
                total_blocks: blocks_len,
                busy: any_gen_busy,
            });
        }
    }

    Ok(ScriptReadonlyState {
        exists: false,
        approved: false,
        pending_blocks: 0,
        total_blocks: 0,
        busy: any_gen_busy,
    })
}

struct NarrationSummary {
    json: Value,
    montage_plan: Option<MontagePlan>,
    uses_estimated_durations: bool,
}

fn read_narration_summary(
    c: &Connection,
    project_dir: Option<&Path>,
    cut: &ApprovedCut,
    script_state: &ScriptReadonlyState,
    clip_start_us: i64,
    clip_end_us: i64,
    active_silences: &[(i64, i64)],
    manual_starts: &BTreeMap<i64, i64>,
) -> Result<NarrationSummary, CoreError> {
    let latest = tts::narration::read_latest_script_in(c, cut)
        .map_err(|_| error("project_read", "Não foi possível ler o Projeto."))??;

    let mut total_blocks = script_state.total_blocks;
    let mut tts_generated_blocks = 0usize;
    let mut ready_blocks = 0usize;
    let mut voices: Vec<String> = Vec::new();
    let mut durations_by_block: BTreeMap<i64, i64> = BTreeMap::new();
    let mut montage_blocks: Vec<MontageBlockInput> = Vec::new();

    if let Some(ref script) = latest {
        total_blocks = script.blocks.len();
        for b in &script.blocks {
            let mut block_duration_us = None;
            if let Some(ver_id) = b.version_id {
                let row: Option<(String, String, String, i64)> = c
                    .query_row(
                        "SELECT engine_id, voice_id, audio_rel_path, duration_us
                         FROM narration_blocks
                         WHERE block_id=?1 AND version_id=?2",
                        (b.block_id, ver_id),
                        |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?, r.get(3)?)),
                    )
                    .optional()
                    .map_err(|_| error("project_read", "Não foi possível ler o Projeto."))?;

                if let Some((engine_id, voice_id, rel, dur_us)) = row {
                    let exists = project_dir
                        .and_then(|root| tts::narration::resolve_rel_path(root, &rel))
                        .is_some();
                    if exists {
                        ready_blocks += 1;
                        if dur_us > 0 {
                            block_duration_us = Some(dur_us);
                            durations_by_block.insert(b.block_id, dur_us);
                        }
                        if engine_id != "imported" && engine_id != "recorded" {
                            tts_generated_blocks += 1;
                            if !voices.contains(&voice_id) {
                                voices.push(voice_id);
                            }
                        }
                    }
                }
            }
            let (duration_us, estimated) = match block_duration_us {
                Some(real) => (real, false),
                None => (
                    b.narration_text
                        .as_deref()
                        .map_or(0, montage::estimate_block_duration_us),
                    true,
                ),
            };
            let refs: Vec<i64> = c
                .query_row(
                    "SELECT COALESCE(
                        (SELECT refs FROM script_block_versions WHERE block_id=?1 AND narration IS NOT NULL ORDER BY id DESC LIMIT 1),
                        (SELECT refs FROM script_blocks WHERE id=?1)
                     )",
                    [b.block_id],
                    |r| r.get::<_, Option<String>>(0),
                )
                .ok()
                .flatten()
                .and_then(|raw| serde_json::from_str::<Vec<i64>>(&raw).ok())
                .unwrap_or_default();
            montage_blocks.push(MontageBlockInput {
                block_id: b.block_id,
                position: b.position,
                title: b.title.clone(),
                refs,
                duration_us,
                estimated,
            });
        }
    }

    let narration_busy: bool = c
        .query_row(
            "SELECT EXISTS(
               SELECT 1 FROM narration_jobs n JOIN jobs j ON j.id=n.job_id
               WHERE n.candidate_id=?1 AND j.state IN ('queued','running')
             ) OR EXISTS(
               SELECT 1 FROM narration_import_jobs i JOIN jobs j ON j.id=i.job_id
               WHERE i.candidate_id=?1 AND j.state IN ('queued','running')
             ) OR EXISTS(
               SELECT 1 FROM narration_align_jobs a JOIN jobs j ON j.id=a.job_id
               WHERE a.candidate_id=?1 AND j.state IN ('queued','running')
             )",
            [cut.candidate],
            |r| r.get(0),
        )
        .unwrap_or(false);

    let (montage_plan, freeze_tail_us, uses_estimated_durations) = if montage_blocks.is_empty() {
        (None, 0, true)
    } else {
        let mut q = c
            .prepare("SELECT id, start_us, end_us FROM sentences WHERE transcript_id=?1 ORDER BY start_us, id")
            .map_err(|_| error("project_read", "Não foi possível ler o Projeto."))?;
        let sentences: Vec<montage::MontageSentence> = q
            .query_map([cut.transcript], |r| {
                Ok(montage::MontageSentence {
                    id: r.get(0)?,
                    start_us: r.get(1)?,
                    end_us: r.get(2)?,
                })
            })
            .and_then(|rows| rows.collect::<rusqlite::Result<Vec<_>>>())
            .map_err(|_| error("project_read", "Não foi possível ler o Projeto."))?;
        let splice = SpliceMap::new(clip_start_us, clip_end_us, active_silences);
        match montage::resolve(&MontageInput {
            blocks: &montage_blocks,
            sentences: &sentences,
            splice: &splice,
            manual_starts,
        }) {
            Ok(plan) => {
                let tail = plan.freeze_tail_us.max(0);
                let est = plan.uses_estimated_durations;
                (Some(plan), tail, est)
            }
            Err(_) => (None, 0, true),
        }
    };

    let long_freeze_tail = freeze_tail_us > montage::LONG_FREEZE_TAIL_US;
    let ready = total_blocks > 0 && ready_blocks == total_blocks;

    Ok(NarrationSummary {
        json: json!({
            "applicable": true,
            "hasTts": tts_generated_blocks > 0,
            "generatedBlocks": tts_generated_blocks,
            "readyBlocks": ready_blocks,
            "ready": ready,
            "totalBlocks": total_blocks,
            "voices": voices,
            "freezeTailUs": freeze_tail_us,
            "longFreezeTail": long_freeze_tail,
            "busy": narration_busy,
        }),
        montage_plan,
        uses_estimated_durations,
    })
}

fn fields_from_value(v: &Value) -> Option<Fields> {
    let strings = |key: &str| -> Option<Vec<String>> {
        v[key]
            .as_array()?
            .iter()
            .map(|x| x.as_str().map(str::to_owned))
            .collect()
    };
    Some(Fields {
        title: v["title"].as_str()?.to_owned(),
        description: v["description"].as_str()?.to_owned(),
        tags: strings("tags")?,
        hashtags: strings("hashtags")?,
    })
}

fn read_packaging_json(
    c: &Connection,
    cut: &ApprovedCut,
    src: &SourceStatusInfo,
    cc_by_attrs: &[String],
    script_approved: bool,
    narration: Option<&NarrationSummary>,
) -> rusqlite::Result<Value> {
    let mut q = c.prepare(
        "SELECT g.id, g.job_id, g.language, g.generated, j.state, j.result
         FROM packaging_generations g
         LEFT JOIN jobs j ON j.id=g.job_id
         WHERE g.run_id=?1 AND g.cand_start_id=?2 AND g.cand_end_id=?3
         ORDER BY g.id",
    )?;
    struct PkgGen {
        id: i64,
        job_id: i64,
        language: String,
        fields: Option<Fields>,
        edited: bool,
        job_state: Option<String>,
    }
    let mut gens: Vec<PkgGen> = q
        .query_map((cut.run, cut.identity.0, cut.identity.1), |r| {
            let gen_raw: Option<String> = r.get(3)?;
            let res_raw: Option<String> = r.get(5)?;
            let job_state: Option<String> = r.get(4)?;
            let fields = gen_raw
                .and_then(|t| serde_json::from_str::<Value>(&t).ok())
                .and_then(|v| fields_from_value(&v))
                .or_else(|| {
                    if job_state.as_deref() == Some("completed") {
                        res_raw
                            .and_then(|t| serde_json::from_str::<Value>(&t).ok())
                            .and_then(|r| fields_from_value(&r["data"]))
                    } else {
                        None
                    }
                });
            Ok(PkgGen {
                id: r.get(0)?,
                job_id: r.get(1)?,
                language: r.get(2)?,
                fields,
                edited: false,
                job_state,
            })
        })?
        .collect::<rusqlite::Result<Vec<_>>>()?;

    let mut eq = c.prepare("SELECT fields FROM packaging_edits WHERE generation_id=?1 ORDER BY id DESC LIMIT 1")?;
    for g in &mut gens {
        if g.fields.is_some() {
            let edit_raw: Option<String> = eq.query_row([g.id], |r| r.get(0)).optional()?;
            if let Some(edited_fields) = edit_raw
                .and_then(|t| serde_json::from_str::<Value>(&t).ok())
                .and_then(|v| fields_from_value(&v))
            {
                g.fields = Some(edited_fields);
                g.edited = true;
            }
        }
    }

    let latest_job = gens.last().map(|g| {
        json!({
            "id": g.job_id,
            "state": g.job_state,
        })
    });
    let done: Vec<&PkgGen> = gens.iter().filter(|g| g.fields.is_some()).collect();
    let detected = packaging::detect_language(&cut.sentences);
    let lang = done
        .last()
        .and_then(|g| Lang::parse(&g.language))
        .or(detected);
    let credit = lang.and_then(|l| {
        packaging::build_full_credit(l, &src.permission_raw, src.origin_url.as_deref(), cc_by_attrs)
    });

    let current = done.last().and_then(|g| {
        let f = g.fields.as_ref()?;
        Some(json!({
            "generation": done.len(),
            "language": g.language,
            "edited": g.edited,
            "title": f.title,
            "description": f.description,
            "fullDescription": packaging::full_description(&f.description, credit.as_deref()),
            "tags": f.tags,
            "hashtags": f.hashtags,
        }))
    });

    let chapters_json = if cut.video_kind != VideoKind::Transformed {
        json!({
            "applicable": false,
            "status": "not_transformed",
            "canGenerate": false,
        })
    } else if !script_approved {
        json!({
            "applicable": true,
            "status": "script_not_approved",
            "canGenerate": false,
        })
    } else if narration.is_none_or(|n| n.uses_estimated_durations || n.montage_plan.is_none()) {
        json!({
            "applicable": true,
            "status": "narration_required",
            "canGenerate": false,
        })
    } else {
        let plan = narration.unwrap().montage_plan.as_ref().unwrap();
        let can = chapters::build_chapters_from_plan(plan).is_ok();
        json!({
            "applicable": true,
            "status": if can { "ready" } else { "too_few_chapters" },
            "canGenerate": can,
        })
    };

    Ok(json!({
        "ready": current.is_some(),
        "current": current,
        "credit": {
            "text": credit,
            "warning": if src.granted { Value::Null } else { json!("no_permission") },
        },
        "chapters": chapters_json,
        "job": latest_job,
    }))
}

fn read_thumbnail_json(c: &Connection, cut: &ApprovedCut) -> rusqlite::Result<Value> {
    let mut sq = c.prepare(
        "SELECT g.id, g.job_id, g.sentence_id, g.instant_us, g.why, j.state, j.result
         FROM thumbnail_suggestions g
         LEFT JOIN jobs j ON j.id=g.job_id
         WHERE g.run_id=?1 AND g.cand_start_id=?2 AND g.cand_end_id=?3
         ORDER BY g.id",
    )?;
    struct SuggRow {
        id: i64,
        job_id: i64,
        sentence_id: Option<i64>,
        instant_us: Option<i64>,
        why: Option<String>,
        job_state: Option<String>,
        job_result: Option<String>,
    }
    let suggestions: Vec<SuggRow> = sq
        .query_map((cut.run, cut.identity.0, cut.identity.1), |r| {
            Ok(SuggRow {
                id: r.get(0)?,
                job_id: r.get(1)?,
                sentence_id: r.get(2)?,
                instant_us: r.get(3)?,
                why: r.get(4)?,
                job_state: r.get(5)?,
                job_result: r.get(6)?,
            })
        })?
        .collect::<rusqlite::Result<Vec<_>>>()?;

    let last_job = suggestions.last().map(|s| {
        json!({
            "id": s.job_id,
            "state": s.job_state,
        })
    });

    let choice: Option<(i64, i64, String, Option<i64>)> = c
        .query_row(
            "SELECT id, instant_us, origin, suggestion_id
             FROM thumbnail_choices
             WHERE run_id=?1 AND cand_start_id=?2 AND cand_end_id=?3
             ORDER BY id DESC LIMIT 1",
            (cut.run, cut.identity.0, cut.identity.1),
            |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?, r.get(3)?)),
        )
        .optional()?;

    let current = match choice {
        Some((id, instant_us, origin, suggestion_id)) => {
            let why = suggestion_id
                .and_then(|sid| suggestions.iter().find(|s| s.id == sid))
                .and_then(|s| s.why.clone());
            Some(json!({
                "id": id,
                "instantUs": instant_us,
                "origin": origin,
                "suggestionId": suggestion_id,
                "why": why,
            }))
        }
        None => {
            // Se há sugestão concluída ainda não materializada, resolve em memória sem gravar.
            suggestions
                .iter()
                .rev()
                .find_map(|s| {
                    if let (Some(_sid), Some(instant)) = (s.sentence_id, s.instant_us) {
                        return Some(json!({
                            "id": s.id,
                            "instantUs": instant,
                            "origin": "provider",
                            "suggestionId": s.id,
                            "why": s.why,
                        }));
                    }
                    if s.sentence_id.is_none() && s.job_state.as_deref() == Some("completed") {
                        let data = s
                            .job_result
                            .as_deref()
                            .and_then(|t| serde_json::from_str::<Value>(t).ok())
                            .map(|r| r["data"].clone())?;
                        let sent_id = data["sentenceId"].as_i64()?;
                        let why = data["why"].as_str()?.trim().to_owned();
                        let sentence = cut.sentences.iter().find(|x| x.id == sent_id)?;
                        return Some(json!({
                            "id": s.id,
                            "instantUs": thumbnail::instant_of(sentence),
                            "origin": "provider",
                            "suggestionId": s.id,
                            "why": why,
                        }));
                    }
                    None
                })
        }
    };

    Ok(json!({
        "ready": current.is_some(),
        "current": current,
        "job": last_job,
    }))
}

fn cmd_readiness(v: Value, _: &mut EventSink<'_>) -> CommandResult {
    let scope_source = parse_optional_source_id(&v)?;
    let (offset, limit) = parse_pagination(&v)?;

    // Garante Projeto aberto e obtém a pasta raiz sem usar `crate::dispatch`.
    let project_dir: Option<PathBuf> = projects::with_reader(|c| {
        Ok(c.path()
            .and_then(|p| Path::new(p).parent())
            .map(Path::to_path_buf))
    })?;
    let ack = channel_profile::direct_monetization_ack()?;

    let cuts = match super::batch::collect_cuts(scope_source) {
        Ok(list) => list,
        Err(e) if e.code == "export_batch_empty" => Vec::new(),
        Err(e) => return Err(e),
    };

    let total = cuts.len();
    let end = match limit {
        Some(lim) => offset.saturating_add(lim).min(total),
        None => total,
    };
    let slice = if offset >= total {
        &cuts[total..total]
    } else {
        &cuts[offset..end]
    };

    let mut source_cache: HashMap<i64, SourceStatusInfo> = HashMap::new();
    let mut items = Vec::with_capacity(slice.len());

    for planned in slice {
        // Editor (`clip_edits`) e áudio são lidos FORA de `projects::with_reader` para não reentrar no mutex do Projeto.
        let (
            start_id,
            end_id,
            start_us,
            end_us,
            duration_us,
            active_silences,
            manual_starts,
            audio_asset_ids,
        ) = if let Some(cid) = planned.clip_id {
            match editor::edits::document(cid) {
                Ok(doc) => {
                    let active = doc.active_silences();
                    let splice = SpliceMap::new(doc.range.start_us, doc.range.end_us, &active);
                    let asset_ids =
                        editor::edits::audio_asset_ids_for_clip(cid).unwrap_or_default();
                    (
                        doc.range.start_id,
                        doc.range.end_id,
                        doc.range.start_us,
                        doc.range.end_us,
                        splice.output_duration_us.max(0),
                        active,
                        doc.narration_starts,
                        asset_ids,
                    )
                }
                Err(_) => (
                    planned.start_id,
                    planned.end_id,
                    planned.start_us,
                    planned.start_us + planned.duration_us,
                    planned.duration_us.max(0),
                    Vec::new(),
                    BTreeMap::new(),
                    Vec::new(),
                ),
            }
        } else {
            (
                planned.start_id,
                planned.end_id,
                planned.start_us,
                planned.start_us + planned.duration_us,
                planned.duration_us.max(0),
                Vec::new(),
                BTreeMap::new(),
                Vec::new(),
            )
        };

        let approved_cut = selection::approved_cut(planned.candidate_id)?;
        let cc_by_attrs =
            audio::cc_by_attributions_for_candidate(planned.candidate_id).unwrap_or_default();

        let src_info = if let Some(cached) = source_cache.get(&planned.source_id) {
            cached.clone()
        } else {
            let loaded = projects::with_reader(|c| {
                Ok(read_source_info(
                    c,
                    project_dir.as_deref(),
                    planned.source_id,
                ))
            })??;
            source_cache.insert(planned.source_id, loaded.clone());
            loaded
        };

        let (total_centi, orig_start_id, orig_end_id, audio_summary, script_json, narration_summary, pkg_json, thumb_json) =
            projects::with_reader(|c| {
                let (total_centi, orig_start_id, orig_end_id): (i64, i64, i64) = c.query_row(
                    "SELECT total_centi, start_id, end_id FROM selection_candidates WHERE id=?1",
                    [planned.candidate_id],
                    |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?)),
                )?;

                let audio_summary: GuardrailAudioSummary =
                    audio::guardrail_summary_for_assets(c, &audio_asset_ids).unwrap_or_default();

                let (script_json, narration_summary, script_approved) =
                    if approved_cut.video_kind == VideoKind::Transformed {
                        let st = read_script_state_in(c, approved_cut.run, approved_cut.identity)?;
                        let narr = read_narration_summary(
                            c,
                            project_dir.as_deref(),
                            &approved_cut,
                            &st,
                            start_us,
                            end_us,
                            &active_silences,
                            &manual_starts,
                        )
                        .map_err(|_| rusqlite::Error::InvalidQuery)?;
                        (st.to_json(), Some(narr), st.approved)
                    } else {
                        (json!({ "applicable": false }), None, false)
                    };

                let pkg_json = read_packaging_json(
                    c,
                    &approved_cut,
                    &src_info,
                    &cc_by_attrs,
                    script_approved,
                    narration_summary.as_ref(),
                )?;
                let thumb_json = read_thumbnail_json(c, &approved_cut)?;

                Ok((
                    total_centi,
                    orig_start_id,
                    orig_end_id,
                    audio_summary,
                    script_json,
                    narration_summary,
                    pkg_json,
                    thumb_json,
                ))
            })?;

        let narration_json = narration_summary
            .as_ref()
            .map_or_else(|| json!({ "applicable": false }), |n| n.json.clone());

        let has_direct = approved_cut.video_kind == VideoKind::Direct;
        let has_transformed = approved_cut.video_kind == VideoKind::Transformed;
        let over60s = duration_us > SHORT_CLAIM_LIMIT_US;
        let adjusted = (start_id, end_id) != (orig_start_id, orig_end_id);

        let guardrails_json = json!({
            "scope": "single",
            "directMonetizationAck": ack,
            "needsDirectNotice": !ack && has_direct,
            "videoKind": approved_cut.video_kind.as_str(),
            "hasDirect": has_direct,
            "hasTransformed": has_transformed,
            "totalCuts": 1,
            "durationUs": duration_us,
            "over60s": over60s,
            "over60sCount": if over60s { 1 } else { 0 },
            "shortClaimLimitUs": SHORT_CLAIM_LIMIT_US,
            "permission": src_info.permission_guardrail_json(),
            "script": script_json,
            "narration": narration_json,
            "audio": {
                "hasAudio": audio_summary.has_audio,
                "assetCount": audio_summary.asset_count,
                "unverifiedCount": audio_summary.unverified_count,
            },
        });

        items.push(json!({
            "candidateId": planned.candidate_id,
            "runId": planned.run_id,
            "sourceId": planned.source_id,
            "clipId": planned.clip_id,
            "videoKind": approved_cut.video_kind.as_str(),
            "candidateTitle": planned.title,
            "scoreTotal": (total_centi as f64) / 100.0,
            "adjusted": adjusted,
            "startId": start_id,
            "endId": end_id,
            "startUs": start_us,
            "endUs": end_us,
            "durationUs": duration_us,
            "source": src_info.to_json(),
            "packaging": pkg_json,
            "thumbnail": thumb_json,
            "script": script_json,
            "narration": narration_json,
            "guardrails": guardrails_json,
        }));
    }

    let has_more = offset.saturating_add(items.len()) < total;
    Ok(json!({
        "total": total,
        "offset": offset,
        "limit": limit,
        "hasMore": has_more,
        "items": items,
    }))
}

inventory::submit! { CommandRegistration { name: "export.readiness", execute: cmd_readiness } }
