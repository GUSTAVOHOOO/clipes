//! Geração de Narração por bloco do Roteiro aprovado (#79) usando o Componente `pocket-tts`.
//!
//! Trava obrigatória: [`crate::script::narration_allowed`] é chamada antes de enfileirar e
//! antes de executar cada job. Os WAVs ficam dentro da pasta do Projeto (`narrations/...`)
//! com caminho relativo salvo no SQLite (migração `0079_001_narration`, ADR-0005/ADR-0006),
//! e [`block_durations_for_candidate`] expõe a duração real por `script_blocks.id` ao #204.

use super::catalog::{self, normalize_language};
use crate::{
    channel_profile,
    components::pocket_tts_executable,
    jobs::{self, preview, Safety},
    process::spawn_managed_with,
    projects, script, CommandRegistration, CommandResult, CoreError, EventSink,
};
use rusqlite::{Connection, OptionalExtension};
use serde_json::{json, Value};
use sha2::{Digest, Sha256};
use std::{
    collections::BTreeMap,
    fs::{self, File},
    io::{Read, Write},
    path::{Path, PathBuf},
    process::Stdio,
    sync::atomic::AtomicBool,
    time::Duration,
};

pub const JOB_KIND: &str = "narration";
const ENGINE_ID: &str = "pocket-tts";

inventory::submit! {
    projects::Migration {
        id: "0079_001_narration",
        sql: "
CREATE TABLE narration_blocks (
  id INTEGER PRIMARY KEY,
  block_id INTEGER NOT NULL REFERENCES script_blocks(id) ON DELETE CASCADE,
  version_id INTEGER NOT NULL REFERENCES script_block_versions(id) ON DELETE CASCADE,
  voice_id TEXT NOT NULL,
  model_id TEXT NOT NULL,
  engine_id TEXT NOT NULL DEFAULT 'pocket-tts',
  audio_rel_path TEXT NOT NULL,
  duration_us INTEGER NOT NULL CHECK(duration_us > 0),
  sample_rate INTEGER NOT NULL CHECK(sample_rate > 0),
  channels INTEGER NOT NULL CHECK(channels > 0),
  bytes INTEGER NOT NULL CHECK(bytes > 0),
  sha256 TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  UNIQUE(block_id, version_id)
);
CREATE INDEX narration_blocks_block ON narration_blocks(block_id, id);
CREATE TABLE narration_jobs (
  job_id INTEGER PRIMARY KEY REFERENCES jobs(id) ON DELETE CASCADE,
  candidate_id INTEGER NOT NULL,
  block_id INTEGER,
  voice_id TEXT NOT NULL,
  model_id TEXT NOT NULL,
  quantize INTEGER NOT NULL DEFAULT 1 CHECK(quantize IN (0,1))
);
",
    }
}

fn error(code: &str, message: &str) -> CoreError {
    CoreError {
        code: code.into(),
        message: message.into(),
        usage: None,
    }
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub(crate) struct WavInfo {
    pub duration_us: i64,
    pub sample_rate: i64,
    pub channels: i64,
    pub bytes: i64,
    pub sha256: String,
}

/// Lê cabeçalho WAV PCM (RIFF/WAVE) e calcula a duração real em µs sem depender de processo externo.
pub(crate) fn parse_wav_info(path: &Path) -> Result<WavInfo, CoreError> {
    let mut file = File::open(path)
        .map_err(|_| error("narration_failed", "Áudio da Narração não foi gerado."))?;
    let mut bytes = Vec::new();
    file.read_to_end(&mut bytes)
        .map_err(|_| error("narration_failed", "Não foi possível ler o áudio gerado."))?;
    if bytes.len() < 44 || &bytes[0..4] != b"RIFF" || &bytes[8..12] != b"WAVE" {
        return Err(error(
            "narration_failed",
            "O arquivo gerado não é um WAV PCM válido.",
        ));
    }

    let mut pos = 12usize;
    let mut channels: Option<u16> = None;
    let mut sample_rate: Option<u32> = None;
    let mut bits_per_sample: Option<u16> = None;
    let mut byte_rate: Option<u32> = None;
    let mut data_bytes: Option<u32> = None;

    while pos + 8 <= bytes.len() {
        let id = &bytes[pos..pos + 4];
        let size = u32::from_le_bytes(bytes[pos + 4..pos + 8].try_into().unwrap());
        let body_start = pos + 8;
        let body_end = body_start.saturating_add(size as usize);
        if body_end > bytes.len() {
            break;
        }
        if id == b"fmt " && size >= 16 {
            channels = Some(u16::from_le_bytes(
                bytes[body_start + 2..body_start + 4].try_into().unwrap(),
            ));
            sample_rate = Some(u32::from_le_bytes(
                bytes[body_start + 4..body_start + 8].try_into().unwrap(),
            ));
            byte_rate = Some(u32::from_le_bytes(
                bytes[body_start + 8..body_start + 12].try_into().unwrap(),
            ));
            bits_per_sample = Some(u16::from_le_bytes(
                bytes[body_start + 14..body_start + 16].try_into().unwrap(),
            ));
        } else if id == b"data" {
            data_bytes = Some(size);
            break;
        }
        let padded = (size as usize).saturating_add((size as usize) & 1);
        pos = body_start.saturating_add(padded);
    }

    let ch = channels
        .filter(|&c| c > 0)
        .ok_or_else(|| error("narration_failed", "Cabeçalho WAV sem canais válidos."))?;
    let sr = sample_rate.filter(|&r| r > 0).ok_or_else(|| {
        error(
            "narration_failed",
            "Cabeçalho WAV sem taxa de amostragem válida.",
        )
    })?;
    let data = data_bytes
        .filter(|&d| d > 0)
        .ok_or_else(|| error("narration_failed", "O áudio gerado da Narração está vazio."))?;

    let computed_byte_rate = byte_rate
        .filter(|&b| b > 0)
        .or_else(|| {
            bits_per_sample
                .filter(|&bps| bps > 0)
                .map(|bps| sr * u32::from(ch) * u32::from(bps / 8))
        })
        .ok_or_else(|| error("narration_failed", "Taxa de bytes WAV inválida."))?;

    let duration_us =
        ((u128::from(data) * 1_000_000) / u128::from(computed_byte_rate)).max(1) as i64;
    let sha256 = format!("{:x}", Sha256::digest(&bytes));
    Ok(WavInfo {
        duration_us,
        sample_rate: i64::from(sr),
        channels: i64::from(ch),
        bytes: bytes.len() as i64,
        sha256,
    })
}

#[derive(Clone, Debug)]
pub(crate) struct CurrentBlock {
    pub block_id: i64,
    pub position: i64,
    pub title: String,
    pub version_id: Option<i64>,
    pub narration_text: Option<String>,
}

pub(crate) struct LatestScript {
    pub language: String,
    pub blocks: Vec<CurrentBlock>,
}

pub(crate) fn read_latest_script_in(
    c: &Connection,
    cut: &crate::selection::ApprovedCut,
) -> rusqlite::Result<Result<Option<LatestScript>, CoreError>> {
    let kind: String = c.query_row(
        "SELECT video_kind FROM selection_runs WHERE id=?1",
        [cut.run],
        |r| r.get(0),
    )?;
    if kind != "transformed" {
        return Ok(Err(error(
            "script_requires_transformed",
            "A Narração por Roteiro só existe para Cortes do Vídeo transformado.",
        )));
    }

    let gen: Option<(i64, String)> = c
        .query_row(
            "SELECT g.id, g.language FROM script_generations g
             WHERE g.run_id=?1 AND g.cand_start_id=?2 AND g.cand_end_id=?3
               AND EXISTS (SELECT 1 FROM script_blocks b WHERE b.generation_id=g.id)
             ORDER BY g.id DESC LIMIT 1",
            (cut.run, cut.identity.0, cut.identity.1),
            |r| Ok((r.get(0)?, r.get(1)?)),
        )
        .optional()?;
    let Some((gen_id, language)) = gen else {
        return Ok(Ok(None));
    };

    let mut stmt = c.prepare(
        "SELECT b.id, b.position, b.title,
                (SELECT v.id FROM script_block_versions v
                 WHERE v.block_id=b.id AND v.narration IS NOT NULL
                 ORDER BY v.id DESC LIMIT 1) AS cur_ver_id,
                (SELECT v.title FROM script_block_versions v
                 WHERE v.block_id=b.id AND v.narration IS NOT NULL
                 ORDER BY v.id DESC LIMIT 1) AS cur_title,
                (SELECT v.narration FROM script_block_versions v
                 WHERE v.block_id=b.id AND v.narration IS NOT NULL
                 ORDER BY v.id DESC LIMIT 1) AS cur_narration
         FROM script_blocks b
         WHERE b.generation_id=?1
         ORDER BY b.position",
    )?;
    let blocks = stmt
        .query_map([gen_id], |r| {
            let base_title: String = r.get(2)?;
            let cur_title: Option<String> = r.get(4)?;
            Ok(CurrentBlock {
                block_id: r.get(0)?,
                position: r.get(1)?,
                title: cur_title.unwrap_or(base_title),
                version_id: r.get(3)?,
                narration_text: r.get(5)?,
            })
        })?
        .collect::<rusqlite::Result<Vec<_>>>()?;

    Ok(Ok(Some(LatestScript { language, blocks })))
}

pub(crate) fn project_root_dir() -> Result<PathBuf, CoreError> {
    let cur = crate::dispatch("projects.current", json!({}), &mut |_| {})?;
    let path = cur["path"]
        .as_str()
        .ok_or_else(|| error("project_not_open", "Nenhum Projeto aberto."))?;
    Ok(PathBuf::from(path))
}

pub(crate) fn resolve_rel_path(project: &Path, rel: &str) -> Option<PathBuf> {
    let candidate = project.join(rel);
    let root = project.join("narrations").canonicalize().ok()?;
    let resolved = candidate.canonicalize().ok()?;
    (resolved.starts_with(&root) && resolved.is_file()).then_some(resolved)
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub(crate) struct NarrationBlockAudio {
    pub narration_id: i64,
    pub path: PathBuf,
    pub duration_us: i64,
}

/// Áudios reais de Narração atuais por `script_blocks.id` (#79 -> #204 / #82).
/// Ignora blocos cujo texto do Roteiro mudou desde a geração da Narração ou cujo WAV não existe.
/// Para Cortes diretos (`script_requires_transformed`), devolve mapa vazio.
pub(crate) fn block_audio_for_candidate(
    candidate_id: i64,
) -> Result<BTreeMap<i64, NarrationBlockAudio>, CoreError> {
    let project = project_root_dir()?;
    let cut = crate::selection::approved_cut(candidate_id)?;
    let rows = projects::with_reader(|c| {
        let latest = match read_latest_script_in(c, &cut)? {
            Ok(Some(s)) => s,
            Ok(None) => return Ok(Ok(Vec::new())),
            Err(e) if e.code == "script_requires_transformed" => return Ok(Ok(Vec::new())),
            Err(e) => return Ok(Err(e)),
        };
        let mut out = Vec::new();
        for b in latest.blocks {
            let Some(ver_id) = b.version_id else {
                continue;
            };
            let row: Option<(i64, String, i64)> = c
                .query_row(
                    "SELECT id, audio_rel_path, duration_us FROM narration_blocks WHERE block_id=?1 AND version_id=?2",
                    (b.block_id, ver_id),
                    |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?)),
                )
                .optional()?;
            if let Some((narration_id, rel, duration_us)) = row {
                out.push((b.block_id, narration_id, rel, duration_us));
            }
        }
        Ok(Ok(out))
    })??;

    let mut map = BTreeMap::new();
    for (block_id, narration_id, rel, duration_us) in rows {
        if duration_us > 0 {
            if let Some(path) = resolve_rel_path(&project, &rel) {
                map.insert(
                    block_id,
                    NarrationBlockAudio {
                        narration_id,
                        path,
                        duration_us,
                    },
                );
            }
        }
    }
    Ok(map)
}

/// Durações reais em µs dos áudios de Narração atuais por `script_blocks.id` (#79 -> #204).
/// Ignora blocos cujo texto do Roteiro mudou desde a geração da Narração ou cujo WAV não existe.
pub fn block_durations_for_candidate(candidate_id: i64) -> Result<BTreeMap<i64, i64>, CoreError> {
    Ok(block_audio_for_candidate(candidate_id)?
        .into_iter()
        .map(|(block_id, audio)| (block_id, audio.duration_us))
        .collect())
}

/// Caminho absoluto seguro de um áudio da Narração pelo `narration_blocks.id`, para `media.rs`.
pub(crate) fn media_audio_path(narration_id: i64) -> Option<PathBuf> {
    let project = project_root_dir().ok()?;
    let rel: String = projects::with_reader(|c| {
        c.query_row(
            "SELECT audio_rel_path FROM narration_blocks WHERE id=?1",
            [narration_id],
            |r| r.get(0),
        )
        .optional()
    })
    .ok()
    .flatten()?;
    resolve_rel_path(&project, &rel)
}

#[derive(Clone, Debug)]
pub(crate) struct TtsGuardrailStatus {
    pub has_tts: bool,
    pub generated_blocks: usize,
    pub total_blocks: usize,
    pub voices: Vec<String>,
}

/// Estado da Narração por TTS para o checklist de originalidade (#76 + #79).
pub(crate) fn guardrail_status(candidate_id: i64) -> Result<Option<TtsGuardrailStatus>, CoreError> {
    let project = project_root_dir()?;
    let cut = crate::selection::approved_cut(candidate_id)?;
    let rows = projects::with_reader(|c| {
        let latest = match read_latest_script_in(c, &cut)? {
            Ok(Some(s)) => s,
            Ok(None) => return Ok(Ok(Some((0usize, Vec::new())))),
            Err(e) if e.code == "script_requires_transformed" => return Ok(Ok(None)),
            Err(e) => return Ok(Err(e)),
        };
        let total = latest.blocks.len();
        let mut items = Vec::new();
        for b in latest.blocks {
            let Some(ver_id) = b.version_id else {
                continue;
            };
            let row: Option<(String, String)> = c
                .query_row(
                    "SELECT voice_id, audio_rel_path FROM narration_blocks WHERE block_id=?1 AND version_id=?2",
                    (b.block_id, ver_id),
                    |r| Ok((r.get(0)?, r.get(1)?)),
                )
                .optional()?;
            if let Some((voice_id, rel)) = row {
                items.push((voice_id, rel));
            }
        }
        Ok(Ok(Some((total, items))))
    })??;

    let Some((total_blocks, items)) = rows else {
        return Ok(None);
    };
    let mut voices = Vec::new();
    let mut generated = 0usize;
    for (voice_id, rel) in items {
        if resolve_rel_path(&project, &rel).is_some() {
            generated += 1;
            if !voices.contains(&voice_id) {
                voices.push(voice_id);
            }
        }
    }
    Ok(Some(TtsGuardrailStatus {
        has_tts: generated > 0,
        generated_blocks: generated,
        total_blocks,
        voices,
    }))
}

fn preferred_voice_for(lang: &str, requested: Option<&str>) -> Result<String, CoreError> {
    if let Some(v) = requested.map(str::trim).filter(|s| !s.is_empty()) {
        return Ok(v.to_owned());
    }
    let norm = normalize_language(lang);
    if let Some(profile_voice) = channel_profile::configured_narration_voice()? {
        if let Some(spec) = catalog::find_voice(&profile_voice) {
            if spec.language == norm {
                return Ok(spec.id.to_owned());
            }
        }
    }
    Ok(catalog::default_voice_for_language(norm).id.to_owned())
}

fn candidate_arg(v: &Value) -> Result<i64, CoreError> {
    v["candidate"]
        .as_i64()
        .ok_or_else(|| error("candidate_not_found", "Candidato não encontrado."))
}

struct JobRow {
    id: i64,
    state: String,
    progress: i64,
    code: Option<String>,
    block_id: Option<i64>,
    voice_id: String,
    model_id: String,
}

fn read_job_json(c: &Connection, candidate_id: i64) -> rusqlite::Result<(bool, Value)> {
    let row = c
        .query_row(
            "SELECT j.id, j.state, j.progress, json_extract(j.result,'$.code'), n.block_id, n.voice_id, n.model_id
             FROM narration_jobs n JOIN jobs j ON j.id=n.job_id
             WHERE n.candidate_id=?1
             ORDER BY j.id DESC LIMIT 1",
            [candidate_id],
            |r| {
                Ok(JobRow {
                    id: r.get(0)?,
                    state: r.get(1)?,
                    progress: r.get(2)?,
                    code: r.get(3)?,
                    block_id: r.get(4)?,
                    voice_id: r.get(5)?,
                    model_id: r.get(6)?,
                })
            },
        )
        .optional()?;
    match row {
        Some(r) => {
            let busy = matches!(r.state.as_str(), "queued" | "running");
            Ok((
                busy,
                json!({
                    "id": r.id,
                    "state": r.state,
                    "progress": r.progress,
                    "code": r.code,
                    "blockId": r.block_id,
                    "voiceId": r.voice_id,
                    "modelId": r.model_id,
                }),
            ))
        }
        None => Ok((false, Value::Null)),
    }
}

struct AudioRow {
    id: i64,
    ver_id: i64,
    voice_id: String,
    model_id: String,
    rel: String,
    dur: i64,
    sr: i64,
    ch: i64,
    bytes: i64,
    sha256: String,
}

fn cmd_get(v: Value, _: &mut EventSink<'_>) -> CommandResult {
    let candidate_id = candidate_arg(&v)?;
    let project = project_root_dir()?;
    let gate_err = script::narration_allowed(candidate_id).err();
    let allowed = gate_err.is_none();
    let gate_reason = gate_err
        .as_ref()
        .and_then(|e| e.usage.as_ref())
        .and_then(|u| u["reason"].as_str())
        .map(str::to_owned);

    let cut = crate::selection::approved_cut(candidate_id)?;
    let (latest, job_busy, job_json, align_busy, align_job_json) = projects::with_reader(|c| {
        let latest = match read_latest_script_in(c, &cut)? {
            Ok(s) => s,
            Err(e) => return Ok(Err(e)),
        };
        let (busy, job) = read_job_json(c, candidate_id)?;
        let (align_busy, align_job) = crate::narration_align::read_align_job_json(c, candidate_id)?;
        Ok(Ok((latest, busy, job, align_busy, align_job)))
    })??;
    let align_ready = crate::narration_align::prerequisites_ready();

    let Some(latest) = latest else {
        return Ok(json!({
            "candidate": candidate_id,
            "narrationAllowed": false,
            "gateReason": gate_reason.unwrap_or_else(|| "no_script".into()),
            "language": "pt",
            "defaultVoiceId": preferred_voice_for("pt", None)?,
            "activeModelId": catalog::active_model_id(&crate::components::load_settings()?, "pt"),
            "busy": job_busy,
            "job": job_json,
            "alignBusy": align_busy,
            "alignJob": align_job_json,
            "alignPrerequisitesReady": align_ready,
            "blocks": [],
            "totalDurationUs": 0,
        }));
    };

    let norm_lang = normalize_language(&latest.language);
    let default_voice_id = preferred_voice_for(norm_lang, None)?;
    let active_model_id = catalog::active_model_id(&crate::components::load_settings()?, norm_lang);

    let mut total_duration_us = 0i64;
    let mut blocks_json = Vec::new();
    projects::with_reader(|c| {
        for b in &latest.blocks {
            let row = c
                .query_row(
                    "SELECT id, version_id, voice_id, model_id, audio_rel_path, duration_us, sample_rate, channels, bytes, sha256
                     FROM narration_blocks WHERE block_id=?1 ORDER BY id DESC LIMIT 1",
                    [b.block_id],
                    |r| {
                        Ok(AudioRow {
                            id: r.get(0)?,
                            ver_id: r.get(1)?,
                            voice_id: r.get(2)?,
                            model_id: r.get(3)?,
                            rel: r.get(4)?,
                            dur: r.get(5)?,
                            sr: r.get(6)?,
                            ch: r.get(7)?,
                            bytes: r.get(8)?,
                            sha256: r.get(9)?,
                        })
                    },
                )
                .optional()?;
            let (audio_json, alignment_json) = match row {
                Some(r) if resolve_rel_path(&project, &r.rel).is_some() => {
                    let stale = Some(r.ver_id) != b.version_id;
                    if !stale {
                        total_duration_us += r.dur;
                    }
                    let align = if stale {
                        Value::Null
                    } else {
                        crate::narration_align::read_block_alignment_json(c, r.id, &r.sha256)?
                    };
                    (
                        json!({
                            "id": r.id,
                            "versionId": r.ver_id,
                            "voiceId": r.voice_id,
                            "modelId": r.model_id,
                            "relPath": r.rel,
                            "durationUs": r.dur,
                            "sampleRate": r.sr,
                            "channels": r.ch,
                            "bytes": r.bytes,
                            "stale": stale,
                        }),
                        align,
                    )
                }
                _ => (Value::Null, Value::Null),
            };
            blocks_json.push(json!({
                "blockId": b.block_id,
                "position": b.position,
                "title": b.title,
                "versionId": b.version_id,
                "narrationText": b.narration_text,
                "audio": audio_json,
                "alignment": alignment_json,
            }));
        }
        Ok(())
    })?;

    Ok(json!({
        "candidate": candidate_id,
        "narrationAllowed": allowed,
        "gateReason": gate_reason,
        "language": norm_lang,
        "defaultVoiceId": default_voice_id,
        "activeModelId": active_model_id,
        "busy": job_busy,
        "job": job_json,
        "alignBusy": align_busy,
        "alignJob": align_job_json,
        "alignPrerequisitesReady": align_ready,
        "blocks": blocks_json,
        "totalDurationUs": total_duration_us,
    }))
}

fn enqueue_narration(v: &Value, block_id: Option<i64>) -> CommandResult {
    let candidate_id = candidate_arg(v)?;
    script::narration_allowed(candidate_id)?;
    let _ = pocket_tts_executable()?;

    let cut = crate::selection::approved_cut(candidate_id)?;
    let latest = projects::with_reader(|c| read_latest_script_in(c, &cut))??
        .ok_or_else(|| error("script_not_approved", "Nenhum Roteiro aprovado encontrado."))?;
    if let Some(bid) = block_id {
        if !latest.blocks.iter().any(|b| b.block_id == bid) {
            return Err(error("block_not_found", "Bloco não encontrado."));
        }
    }

    let voice_req = v["voiceId"].as_str();
    let model_req = v["modelId"].as_str();
    let chosen_voice = preferred_voice_for(&latest.language, voice_req)?;
    let bundle =
        catalog::resolve_installed_bundle(&latest.language, Some(&chosen_voice), model_req)?;
    let quantize = v["quantize"].as_bool().unwrap_or(true);

    let busy: bool = projects::with_reader(|c| {
        c.query_row(
            "SELECT EXISTS(
               SELECT 1 FROM narration_jobs n JOIN jobs j ON j.id=n.job_id
               WHERE n.candidate_id=?1 AND j.state IN ('queued','running')
             )",
            [candidate_id],
            |r| r.get(0),
        )
    })?;
    if busy {
        return Err(error(
            "generation_in_progress",
            "Já há uma geração de Narração em andamento para este Corte.",
        ));
    }

    let job_id = jobs::enqueue(JOB_KIND, Safety::Local)?;
    let voice_id = bundle.voice_id.as_str();
    let model_id = bundle.model_id.as_str();
    projects::with_writer(|c| {
        c.execute(
            "INSERT INTO narration_jobs(job_id, candidate_id, block_id, voice_id, model_id, quantize)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6)",
            (
                job_id,
                candidate_id,
                block_id,
                voice_id,
                model_id,
                i64::from(quantize),
            ),
        )?;
        Ok(())
    })?;

    Ok(json!({
        "job": job_id,
        "candidate": candidate_id,
        "blockId": block_id,
        "voiceId": bundle.voice_id,
        "modelId": bundle.model_id,
        "quantize": quantize,
    }))
}

fn cmd_generate(v: Value, _: &mut EventSink<'_>) -> CommandResult {
    enqueue_narration(&v, None)
}

fn cmd_regenerate_block(v: Value, _: &mut EventSink<'_>) -> CommandResult {
    let block_id = v["block"]
        .as_i64()
        .or_else(|| v["blockId"].as_i64())
        .ok_or_else(|| error("block_not_found", "Bloco não encontrado."))?;
    enqueue_narration(&v, Some(block_id))
}

fn synthesize_block(
    job_id: i64,
    exe: &Path,
    bundle: &catalog::InstalledTtsBundle,
    quantize: bool,
    text: &str,
    out_wav: &Path,
    stop: &AtomicBool,
) -> Result<WavInfo, CoreError> {
    if let Some(parent) = out_wav.parent() {
        fs::create_dir_all(parent).map_err(|_| {
            error(
                "narration_failed",
                "Não foi possível preparar a pasta de Narração do Projeto.",
            )
        })?;
    }
    let tmp_wav = out_wav.with_extension("wav.part");
    let _ = fs::remove_file(&tmp_wav);

    let mut args: Vec<std::ffi::OsString> = vec![
        "generate".into(),
        "--config".into(),
        bundle.config_path.as_os_str().to_owned(),
        "--voice".into(),
        bundle.voice_path.as_os_str().to_owned(),
        "--text".into(),
        "-".into(),
        "--output-path".into(),
        tmp_wav.as_os_str().to_owned(),
        "-q".into(),
    ];
    if quantize {
        args.push("--quantize".into());
    }

    let (mut child, group) = spawn_managed_with(exe, args, |cmd| {
        cmd.stdin(Stdio::piped());
    })
    .map_err(|_| {
        error(
            "component_missing",
            "Não foi possível iniciar o motor Pocket TTS.",
        )
    })?;

    if let Some(mut stdin) = child.stdin.take() {
        let _ = stdin.write_all(text.as_bytes());
        let _ = stdin.flush();
    }

    loop {
        if let Err(err) = preview::check(job_id, stop) {
            group.terminate();
            let _ = child.wait();
            let _ = fs::remove_file(&tmp_wav);
            return Err(err);
        }
        match child.try_wait() {
            Ok(Some(status)) => {
                if !status.success() {
                    let _ = fs::remove_file(&tmp_wav);
                    return Err(error(
                        "narration_failed",
                        "O motor Pocket TTS falhou ao sintetizar este bloco.",
                    ));
                }
                break;
            }
            Ok(None) => std::thread::sleep(Duration::from_millis(50)),
            Err(_) => {
                group.terminate();
                let _ = child.wait();
                let _ = fs::remove_file(&tmp_wav);
                return Err(error(
                    "narration_failed",
                    "Erro ao aguardar o motor Pocket TTS.",
                ));
            }
        }
    }

    let info = parse_wav_info(&tmp_wav).inspect_err(|_| {
        let _ = fs::remove_file(&tmp_wav);
    })?;
    if out_wav.exists() {
        let _ = fs::remove_file(out_wav);
    }
    fs::rename(&tmp_wav, out_wav).map_err(|_| {
        let _ = fs::remove_file(&tmp_wav);
        error(
            "narration_failed",
            "Não foi possível gravar o áudio da Narração.",
        )
    })?;
    Ok(info)
}

pub fn run(job_id: i64, project: &Path, stop: &AtomicBool) -> Result<(), CoreError> {
    let (candidate_id, only_block_id, voice_id, model_id, quantize): (
        i64,
        Option<i64>,
        String,
        String,
        bool,
    ) = projects::with_reader(|c| {
        c.query_row(
            "SELECT candidate_id, block_id, voice_id, model_id, quantize FROM narration_jobs WHERE job_id=?1",
            [job_id],
            |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?, r.get(3)?, r.get::<_, i64>(4)? != 0)),
        )
    })?;

    script::narration_allowed(candidate_id)?;
    let exe = pocket_tts_executable()?;
    let cut = crate::selection::approved_cut(candidate_id)?;
    let latest = projects::with_reader(|c| read_latest_script_in(c, &cut))??
        .ok_or_else(|| error("script_not_approved", "Nenhum Roteiro aprovado encontrado."))?;
    let bundle =
        catalog::resolve_installed_bundle(&latest.language, Some(&voice_id), Some(&model_id))?;

    let targets: Vec<CurrentBlock> = latest
        .blocks
        .into_iter()
        .filter(|b| only_block_id.is_none_or(|id| b.block_id == id))
        .collect();
    if targets.is_empty() {
        return Err(error("block_not_found", "Bloco não encontrado."));
    }

    let norm_lang = normalize_language(&latest.language).to_owned();
    let total = targets.len();
    for (idx, block) in targets.into_iter().enumerate() {
        preview::check(job_id, stop)?;
        let version_id = block.version_id.ok_or_else(|| {
            error(
                "script_not_approved",
                "Bloco sem texto aprovado para narrar.",
            )
        })?;
        let text = block
            .narration_text
            .as_deref()
            .map(str::trim)
            .filter(|s| !s.is_empty())
            .ok_or_else(|| error("script_not_approved", "Bloco sem texto para narrar."))?;

        let rel_path = format!(
            "narrations/c{candidate_id}/b{}-v{version_id}.wav",
            block.block_id
        );
        let out_wav = project.join(&rel_path);
        let info = synthesize_block(job_id, &exe, &bundle, quantize, text, &out_wav, stop)?;

        let bundle_voice_id = bundle.voice_id.as_str();
        let bundle_model_id = bundle.model_id.as_str();
        projects::with_writer(|c| {
            c.execute(
                "INSERT INTO narration_blocks(block_id, version_id, voice_id, model_id, engine_id, audio_rel_path, duration_us, sample_rate, channels, bytes, sha256)
                 VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11)
                 ON CONFLICT(block_id, version_id) DO UPDATE SET
                   voice_id=excluded.voice_id,
                   model_id=excluded.model_id,
                   engine_id=excluded.engine_id,
                   audio_rel_path=excluded.audio_rel_path,
                   duration_us=excluded.duration_us,
                   sample_rate=excluded.sample_rate,
                   channels=excluded.channels,
                   bytes=excluded.bytes,
                   sha256=excluded.sha256,
                   created_at=strftime('%Y-%m-%dT%H:%M:%fZ','now')",
                (
                    block.block_id,
                    version_id,
                    bundle_voice_id,
                    bundle_model_id,
                    ENGINE_ID,
                    &rel_path,
                    info.duration_us,
                    info.sample_rate,
                    info.channels,
                    info.bytes,
                    &info.sha256,
                ),
            )?;
            let narration_id: i64 = c.query_row(
                "SELECT id FROM narration_blocks WHERE block_id=?1 AND version_id=?2",
                (block.block_id, version_id),
                |r| r.get(0),
            )?;
            crate::narration_align::mark_pending_in(
                c,
                narration_id,
                block.block_id,
                version_id,
                &info.sha256,
                &norm_lang,
            )?;
            Ok(())
        })?;

        let pct = (((idx + 1) * 100) / total).min(99) as u8;
        let _ = jobs::progress(job_id, "narration", pct, "Narração gerada");
    }

    crate::narration_align::enqueue_after_tts(candidate_id, only_block_id);
    Ok(())
}

inventory::submit! { CommandRegistration { name: "narration.get", execute: cmd_get } }
inventory::submit! { CommandRegistration { name: "narration.generate", execute: cmd_generate } }
inventory::submit! { CommandRegistration { name: "narration.regenerate_block", execute: cmd_regenerate_block } }

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_pcm_wav_duration_precisely() {
        let dir = tempfile::tempdir().unwrap();
        let wav = dir.path().join("sample.wav");
        // 24 kHz, mono, 16-bit PCM, 2.5 s -> 60_000 samples -> 120_000 bytes
        let samples = 60_000u32;
        let data_bytes = samples * 2;
        let mut buf = Vec::new();
        buf.extend_from_slice(b"RIFF");
        buf.extend_from_slice(&(36 + data_bytes).to_le_bytes());
        buf.extend_from_slice(b"WAVEfmt ");
        buf.extend_from_slice(&16u32.to_le_bytes());
        buf.extend_from_slice(&1u16.to_le_bytes());
        buf.extend_from_slice(&1u16.to_le_bytes());
        buf.extend_from_slice(&24_000u32.to_le_bytes());
        buf.extend_from_slice(&48_000u32.to_le_bytes());
        buf.extend_from_slice(&2u16.to_le_bytes());
        buf.extend_from_slice(&16u16.to_le_bytes());
        buf.extend_from_slice(b"data");
        buf.extend_from_slice(&data_bytes.to_le_bytes());
        buf.resize(buf.len() + data_bytes as usize, 0);
        fs::write(&wav, buf).unwrap();

        let info = parse_wav_info(&wav).unwrap();
        assert_eq!(info.duration_us, 2_500_000);
        assert_eq!(info.sample_rate, 24_000);
        assert_eq!(info.channels, 1);
        assert_eq!(info.sha256.len(), 64);
    }

    #[test]
    fn rejects_invalid_or_empty_wav() {
        let dir = tempfile::tempdir().unwrap();
        let bad = dir.path().join("bad.wav");
        fs::write(&bad, b"not-a-wav").unwrap();
        assert_eq!(parse_wav_info(&bad).unwrap_err().code, "narration_failed");
    }
}
