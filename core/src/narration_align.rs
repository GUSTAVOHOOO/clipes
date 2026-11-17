//! Alinhamento por palavra e legendas da Narração (#81).
//!
//! Usa o worker local (`faster-whisper` via tarefa `align`) para:
//! 1. Detectar desvios/improvisos em relação ao Roteiro: marca para revisão (`needs_review`)
//!    quando há `>= MAX_CONSECUTIVE_INSERTIONS` (2) inserções seguidas ou
//!    `>= MAX_SUBSTITUTIONS` (3) substituições.
//! 2. Obter bordas de palavra por alinhamento forçado (`find_alignment` em janelas <= 30 s)
//!    no texto do Roteiro, e também guardar as palavras faladas (`spoken`) caso o usuário
//!    opte por usá-las na revisão.
//! 3. Segmentar as palavras alinhadas respeitando bordas de Frase (`sentences::segment`) e
//!    integrar à faixa `'narration'` no preview (`export.captions`) e no export (#59/#65/#204),
//!    omitindo blocos desatualizados ou pendentes de revisão.

use crate::{
    caption_style::WordOverride,
    components::{hardware, models, worker},
    editor::silences::SpliceMap,
    export::captions::{CaptionWord, MIN_WORD_US},
    jobs::{self, preview, Safety},
    montage, process, projects, script,
    sentences::{self, Sentence, WordRow},
    tts::{
        catalog::normalize_language,
        narration::{project_root_dir, read_latest_script_in, resolve_rel_path},
    },
    worker::{WorkerClient, WorkerEvent},
    CommandRegistration, CommandResult, CoreError, EventSink,
};
use rusqlite::{Connection, OptionalExtension};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::{
    collections::HashMap,
    fs::{self, File},
    io::{Read, Write},
    path::{Path, PathBuf},
    sync::atomic::{AtomicBool, Ordering},
    time::Duration,
};
use unicode_normalization::UnicodeNormalization;

pub const JOB_KIND: &str = "narration_align";

/// Limite padrão de inserções seguidas (palavras faladas ausentes do Roteiro) que dispara revisão (#81).
pub const MAX_CONSECUTIVE_INSERTIONS: usize = 2;

/// Limite padrão de substituições (palavras trocadas em relação ao Roteiro) que dispara revisão (#81).
pub const MAX_SUBSTITUTIONS: usize = 3;

const TARGET_SAMPLE_RATE: u32 = 16_000;

inventory::submit! {
    projects::Migration {
        id: "0081_001_narration_alignment",
        sql: "
CREATE TABLE narration_alignments (
  narration_id INTEGER PRIMARY KEY REFERENCES narration_blocks(id) ON DELETE CASCADE,
  block_id INTEGER NOT NULL REFERENCES script_blocks(id) ON DELETE CASCADE,
  version_id INTEGER NOT NULL REFERENCES script_block_versions(id) ON DELETE CASCADE,
  audio_sha256 TEXT NOT NULL,
  language TEXT NOT NULL,
  model_id TEXT NOT NULL,
  status TEXT NOT NULL CHECK(status IN ('pending','aligned','needs_review','approved','failed')),
  choice TEXT CHECK(choice IN ('script','spoken')),
  substitutions INTEGER NOT NULL DEFAULT 0,
  insertions INTEGER NOT NULL DEFAULT 0,
  deletions INTEGER NOT NULL DEFAULT 0,
  max_consecutive_insertions INTEGER NOT NULL DEFAULT 0,
  error_code TEXT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE INDEX narration_alignments_block ON narration_alignments(block_id, version_id);
CREATE TABLE narration_aligned_words (
  narration_id INTEGER NOT NULL REFERENCES narration_blocks(id) ON DELETE CASCADE,
  track TEXT NOT NULL CHECK(track IN ('script','spoken')),
  position INTEGER NOT NULL,
  sentence_idx INTEGER NOT NULL,
  text TEXT NOT NULL,
  start_us INTEGER NOT NULL CHECK(start_us >= 0),
  end_us INTEGER NOT NULL CHECK(end_us > start_us),
  PRIMARY KEY (narration_id, track, position)
) WITHOUT ROWID;
CREATE TABLE narration_align_jobs (
  job_id INTEGER PRIMARY KEY REFERENCES jobs(id) ON DELETE CASCADE,
  candidate_id INTEGER NOT NULL,
  block_id INTEGER
);
CREATE TABLE narration_caption_tracks (
  candidate_id INTEGER PRIMARY KEY,
  track TEXT NOT NULL CHECK(track IN ('auto','narration','original','translated'))
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

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AlignedWord {
    pub text: String,
    pub start_us: i64,
    pub end_us: i64,
    #[serde(default)]
    pub sentence_idx: i64,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct DeviationReport {
    pub substitutions: usize,
    pub insertions: usize,
    pub deletions: usize,
    pub max_consecutive_insertions: usize,
    pub needs_review: bool,
}

/// Normaliza uma palavra para comparação lexical (NFKC, minúsculas, apenas alfanuméricos).
pub fn normalize_token(text: &str) -> String {
    text.nfkc()
        .collect::<String>()
        .to_lowercase()
        .chars()
        .filter(|c| c.is_alphanumeric())
        .collect()
}

/// Compara palavras faladas contra o texto do Roteiro via distância de edição por palavra (#81).
/// Marca `needs_review` quando há `>= MAX_CONSECUTIVE_INSERTIONS` inserções seguidas ou
/// `>= MAX_SUBSTITUTIONS` substituições.
pub fn evaluate_deviation(script_text: &str, spoken_words: &[AlignedWord]) -> DeviationReport {
    evaluate_deviation_with_limits(
        script_text,
        spoken_words,
        MAX_CONSECUTIVE_INSERTIONS,
        MAX_SUBSTITUTIONS,
    )
}

pub fn evaluate_deviation_with_limits(
    script_text: &str,
    spoken_words: &[AlignedWord],
    max_consecutive_insertions_limit: usize,
    max_substitutions_limit: usize,
) -> DeviationReport {
    let ref_tokens: Vec<String> = script_text
        .split_whitespace()
        .map(normalize_token)
        .filter(|t| !t.is_empty())
        .collect();
    let hyp_tokens: Vec<String> = spoken_words
        .iter()
        .map(|w| normalize_token(&w.text))
        .filter(|t| !t.is_empty())
        .collect();

    let n = ref_tokens.len();
    let m = hyp_tokens.len();
    let mut dp = vec![vec![0usize; m + 1]; n + 1];
    for (i, row) in dp.iter_mut().enumerate() {
        row[0] = i;
    }
    for (j, cell) in dp[0].iter_mut().enumerate() {
        *cell = j;
    }
    for i in 1..=n {
        for j in 1..=m {
            let sub_cost = usize::from(ref_tokens[i - 1] != hyp_tokens[j - 1]);
            dp[i][j] = (dp[i - 1][j] + 1)
                .min(dp[i][j - 1] + 1)
                .min(dp[i - 1][j - 1] + sub_cost);
        }
    }

    #[derive(Clone, Copy)]
    enum Op {
        Match,
        Sub,
        Ins,
        Del,
    }

    let mut ops = Vec::with_capacity(n + m);
    let (mut i, mut j) = (n, m);
    while i > 0 || j > 0 {
        if i > 0 && j > 0 {
            let same = ref_tokens[i - 1] == hyp_tokens[j - 1];
            let sub_cost = usize::from(!same);
            if dp[i][j] == dp[i - 1][j - 1] + sub_cost {
                ops.push(if same { Op::Match } else { Op::Sub });
                i -= 1;
                j -= 1;
                continue;
            }
        }
        if j > 0 && dp[i][j] == dp[i][j - 1] + 1 {
            ops.push(Op::Ins);
            j -= 1;
        } else {
            ops.push(Op::Del);
            i -= 1;
        }
    }
    ops.reverse();

    let mut substitutions = 0usize;
    let mut insertions = 0usize;
    let mut deletions = 0usize;
    let mut cur_ins = 0usize;
    let mut max_consecutive_insertions = 0usize;

    for op in ops {
        match op {
            Op::Match => cur_ins = 0,
            Op::Sub => {
                substitutions += 1;
                cur_ins = 0;
            }
            Op::Ins => {
                insertions += 1;
                cur_ins += 1;
                max_consecutive_insertions = max_consecutive_insertions.max(cur_ins);
            }
            Op::Del => {
                deletions += 1;
                cur_ins = 0;
            }
        }
    }

    let needs_review = max_consecutive_insertions >= max_consecutive_insertions_limit
        || substitutions >= max_substitutions_limit;

    DeviationReport {
        substitutions,
        insertions,
        deletions,
        max_consecutive_insertions,
        needs_review,
    }
}

/// Normaliza timestamps e atribui `sentence_idx` (1, 2, 3...) reutilizando `sentences::segment` (#49/#81).
pub fn normalize_and_segment(words: &mut Vec<AlignedWord>, duration_us: i64) -> Vec<Sentence> {
    words.retain(|w| !w.text.trim().is_empty());
    if words.is_empty() {
        return Vec::new();
    }

    let mut spans: Vec<(i64, i64)> = words
        .iter()
        .map(|w| {
            let s = w.start_us.max(0);
            let e = w.end_us.max(s + 1);
            (s, e)
        })
        .collect();
    let _ = sentences::normalize_spans(&mut spans, None);
    let cap = duration_us.max(1);
    for (w, (s, e)) in words.iter_mut().zip(spans) {
        w.start_us = s.min(cap.saturating_sub(1));
        w.end_us = e.max(w.start_us + 1).min(cap.max(w.start_us + 1));
    }

    let rows: Vec<WordRow> = words
        .iter()
        .enumerate()
        .map(|(idx, w)| WordRow {
            position: idx as i64,
            text: w.text.trim().to_owned(),
            start_us: w.start_us,
            end_us: w.end_us,
            language: None,
        })
        .collect();
    let segs = sentences::segment(&rows);
    for seg in &segs {
        for pos in seg.first_position..=seg.last_position {
            if let Some(w) = words.get_mut(pos as usize) {
                w.sentence_idx = seg.id;
            }
        }
    }
    segs
}

/// Lê um WAV PCM 16 bits, verifica se já é 16 kHz mono; senão converte via FFmpeg ou
/// reamostrador PCM interno (útil quando FFmpeg não foi configurado em testes de unidade/TTS).
fn prepare_wav_16k_mono(
    src_wav: &Path,
    tmp_wav: &Path,
    job_id: i64,
    stop: &AtomicBool,
) -> Result<PathBuf, CoreError> {
    if let Ok(Some(pcm)) = try_read_pcm_wav(src_wav) {
        if pcm.sample_rate == TARGET_SAMPLE_RATE && pcm.channels == 1 {
            return Ok(src_wav.to_path_buf());
        }
        if crate::components::cache_settings()?.2.is_none() {
            write_resampled_pcm_16k_mono(&pcm, tmp_wav)?;
            return Ok(tmp_wav.to_path_buf());
        }
    }

    let ffmpeg = crate::components::cache_settings()?
        .2
        .ok_or_else(|| error("component_missing", "Instale o Componente FFmpeg."))?;
    let args: Vec<std::ffi::OsString> = vec![
        "-v".into(),
        "error".into(),
        "-y".into(),
        "-i".into(),
        src_wav.as_os_str().to_owned(),
        "-vn".into(),
        "-ac".into(),
        "1".into(),
        "-ar".into(),
        "16000".into(),
        "-c:a".into(),
        "pcm_s16le".into(),
        "-f".into(),
        "wav".into(),
        tmp_wav.as_os_str().to_owned(),
    ];
    let (mut child, group) = process::spawn_managed(&ffmpeg, args).map_err(|_| {
        error(
            "narration_align_failed",
            "Não foi possível converter o áudio da Narração.",
        )
    })?;
    loop {
        if let Err(err) = preview::check(job_id, stop) {
            group.terminate();
            let _ = child.wait();
            let _ = fs::remove_file(tmp_wav);
            return Err(err);
        }
        match child.try_wait() {
            Ok(Some(status)) if status.success() => return Ok(tmp_wav.to_path_buf()),
            Ok(Some(_)) | Err(_) => {
                let _ = fs::remove_file(tmp_wav);
                return Err(error(
                    "narration_align_failed",
                    "Falha ao preparar o áudio da Narração para alinhamento.",
                ));
            }
            Ok(None) => std::thread::sleep(Duration::from_millis(20)),
        }
    }
}

struct PcmWav {
    sample_rate: u32,
    channels: u16,
    samples: Vec<i16>,
}

fn try_read_pcm_wav(path: &Path) -> Result<Option<PcmWav>, CoreError> {
    let mut file = File::open(path).map_err(|_| {
        error(
            "narration_align_failed",
            "Áudio da Narração não encontrado.",
        )
    })?;
    let mut bytes = Vec::new();
    file.read_to_end(&mut bytes).map_err(|_| {
        error(
            "narration_align_failed",
            "Não foi possível ler o áudio da Narração.",
        )
    })?;
    if bytes.len() < 44 || &bytes[0..4] != b"RIFF" || &bytes[8..12] != b"WAVE" {
        return Ok(None);
    }
    let mut pos = 12usize;
    let mut format = None;
    let mut channels = None;
    let mut sample_rate = None;
    let mut bits = None;
    let mut data: Option<&[u8]> = None;
    while pos + 8 <= bytes.len() {
        let id = &bytes[pos..pos + 4];
        let size = u32::from_le_bytes(bytes[pos + 4..pos + 8].try_into().unwrap()) as usize;
        let body_start = pos + 8;
        let body_end = body_start.saturating_add(size);
        if body_end > bytes.len() {
            break;
        }
        if id == b"fmt " && size >= 16 {
            format = Some(u16::from_le_bytes(
                bytes[body_start..body_start + 2].try_into().unwrap(),
            ));
            channels = Some(u16::from_le_bytes(
                bytes[body_start + 2..body_start + 4].try_into().unwrap(),
            ));
            sample_rate = Some(u32::from_le_bytes(
                bytes[body_start + 4..body_start + 8].try_into().unwrap(),
            ));
            bits = Some(u16::from_le_bytes(
                bytes[body_start + 14..body_start + 16].try_into().unwrap(),
            ));
        } else if id == b"data" {
            data = Some(&bytes[body_start..body_end]);
            break;
        }
        pos = body_start.saturating_add(size + (size & 1));
    }
    let (Some(1), Some(ch), Some(sr), Some(16), Some(raw)) =
        (format, channels, sample_rate, bits, data)
    else {
        return Ok(None);
    };
    if ch == 0 || sr == 0 || raw.len() < usize::from(ch) * 2 {
        return Ok(None);
    }
    let samples = raw
        .chunks_exact(2)
        .map(|b| i16::from_le_bytes([b[0], b[1]]))
        .collect();
    Ok(Some(PcmWav {
        sample_rate: sr,
        channels: ch,
        samples,
    }))
}

fn write_resampled_pcm_16k_mono(pcm: &PcmWav, out_path: &Path) -> Result<(), CoreError> {
    let ch = usize::from(pcm.channels);
    let frames = pcm.samples.len() / ch;
    let mono: Vec<f32> = (0..frames)
        .map(|f| {
            let sum: f32 = (0..ch).map(|c| f32::from(pcm.samples[f * ch + c])).sum();
            sum / ch as f32
        })
        .collect();
    let out_frames = ((u64::try_from(frames).unwrap_or(0) * u64::from(TARGET_SAMPLE_RATE))
        / u64::from(pcm.sample_rate))
    .max(1) as usize;
    let mut out_samples = Vec::with_capacity(out_frames);
    let ratio = f64::from(pcm.sample_rate) / f64::from(TARGET_SAMPLE_RATE);
    for idx in 0..out_frames {
        let pos = idx as f64 * ratio;
        let i0 = (pos.floor() as usize).min(frames - 1);
        let i1 = (i0 + 1).min(frames - 1);
        let frac = (pos - i0 as f64) as f32;
        let v = mono[i0] * (1.0 - frac) + mono[i1] * frac;
        out_samples.push(v.clamp(f32::from(i16::MIN), f32::from(i16::MAX)).round() as i16);
    }
    let data_bytes = (out_samples.len() * 2) as u32;
    let mut buf = Vec::with_capacity(44 + data_bytes as usize);
    buf.extend_from_slice(b"RIFF");
    buf.extend_from_slice(&(36 + data_bytes).to_le_bytes());
    buf.extend_from_slice(b"WAVEfmt ");
    buf.extend_from_slice(&16u32.to_le_bytes());
    buf.extend_from_slice(&1u16.to_le_bytes());
    buf.extend_from_slice(&1u16.to_le_bytes());
    buf.extend_from_slice(&TARGET_SAMPLE_RATE.to_le_bytes());
    buf.extend_from_slice(&(TARGET_SAMPLE_RATE * 2).to_le_bytes());
    buf.extend_from_slice(&2u16.to_le_bytes());
    buf.extend_from_slice(&16u16.to_le_bytes());
    buf.extend_from_slice(b"data");
    buf.extend_from_slice(&data_bytes.to_le_bytes());
    for s in out_samples {
        buf.extend_from_slice(&s.to_le_bytes());
    }
    if let Some(parent) = out_path.parent() {
        fs::create_dir_all(parent).map_err(|_| {
            error(
                "narration_align_failed",
                "Não foi possível preparar a pasta temporária do alinhamento.",
            )
        })?;
    }
    let mut f = File::create(out_path).map_err(|_| {
        error(
            "narration_align_failed",
            "Não foi possível gravar áudio temporário para alinhamento.",
        )
    })?;
    f.write_all(&buf).map_err(|_| {
        error(
            "narration_align_failed",
            "Não foi possível gravar áudio temporário para alinhamento.",
        )
    })?;
    Ok(())
}

/// Verifica se worker e modelo Whisper locais estão instalados para alinhar a Narração.
pub(crate) fn prerequisites_ready() -> bool {
    let Ok(settings) = crate::components::load_settings() else {
        return false;
    };
    worker::installed(&settings) && models::selection().is_ok()
}

/// Marca um bloco recém-sintetizado/importado como `'pending'` (e apaga palavras antigas desse áudio).
pub(crate) fn mark_pending_in(
    c: &Connection,
    narration_id: i64,
    block_id: i64,
    version_id: i64,
    audio_sha256: &str,
    language: &str,
) -> rusqlite::Result<()> {
    c.execute(
        "DELETE FROM narration_aligned_words WHERE narration_id=?1",
        [narration_id],
    )?;
    c.execute(
        "INSERT INTO narration_alignments(narration_id, block_id, version_id, audio_sha256, language, model_id, status, choice, substitutions, insertions, deletions, max_consecutive_insertions, error_code)
         VALUES (?1, ?2, ?3, ?4, ?5, '', 'pending', NULL, 0, 0, 0, 0, NULL)
         ON CONFLICT(narration_id) DO UPDATE SET
           block_id=excluded.block_id,
           version_id=excluded.version_id,
           audio_sha256=excluded.audio_sha256,
           language=excluded.language,
           model_id='',
           status='pending',
           choice=NULL,
           substitutions=0,
           insertions=0,
           deletions=0,
           max_consecutive_insertions=0,
           error_code=NULL,
           updated_at=strftime('%Y-%m-%dT%H:%M:%fZ','now')",
        (narration_id, block_id, version_id, audio_sha256, language),
    )?;
    Ok(())
}

/// Disparo automático após TTS (#79): só enfileira se worker e modelo Whisper estiverem instalados.
/// Se faltarem, o TTS conclui normalmente e os blocos ficam em `'pending'` ("alinhamento pendente").
pub(crate) fn enqueue_after_tts(candidate_id: i64, only_block_id: Option<i64>) {
    if !prerequisites_ready() {
        return;
    }
    let already_busy = projects::with_reader(|c| {
        c.query_row(
            "SELECT EXISTS(
               SELECT 1 FROM narration_align_jobs a JOIN jobs j ON j.id=a.job_id
               WHERE a.candidate_id=?1 AND j.state IN ('queued','running')
             )",
            [candidate_id],
            |r| r.get::<_, bool>(0),
        )
    })
    .unwrap_or(false);
    if already_busy {
        return;
    }
    let Ok(job_id) = jobs::enqueue(JOB_KIND, Safety::Local) else {
        return;
    };
    let _ = projects::with_writer(|c| {
        c.execute(
            "INSERT INTO narration_align_jobs(job_id, candidate_id, block_id) VALUES (?1, ?2, ?3)",
            (job_id, candidate_id, only_block_id),
        )?;
        Ok(())
    });
}

pub(crate) fn read_align_job_json(
    c: &Connection,
    candidate_id: i64,
) -> rusqlite::Result<(bool, Value)> {
    let row = c
        .query_row(
            "SELECT j.id, j.state, j.progress, json_extract(j.result,'$.code'), a.block_id
             FROM narration_align_jobs a JOIN jobs j ON j.id=a.job_id
             WHERE a.candidate_id=?1
             ORDER BY j.id DESC LIMIT 1",
            [candidate_id],
            |r| {
                Ok((
                    r.get::<_, i64>(0)?,
                    r.get::<_, String>(1)?,
                    r.get::<_, i64>(2)?,
                    r.get::<_, Option<String>>(3)?,
                    r.get::<_, Option<i64>>(4)?,
                ))
            },
        )
        .optional()?;
    match row {
        Some((id, state, progress, code, block_id)) => {
            let busy = matches!(state.as_str(), "queued" | "running");
            Ok((
                busy,
                json!({
                    "id": id,
                    "state": state,
                    "progress": progress,
                    "code": code,
                    "blockId": block_id,
                }),
            ))
        }
        None => Ok((false, Value::Null)),
    }
}

pub(crate) fn read_block_alignment_json(
    c: &Connection,
    narration_id: i64,
    audio_sha256: &str,
) -> rusqlite::Result<Value> {
    let row = c
        .query_row(
            "SELECT audio_sha256, status, choice, substitutions, insertions, deletions, max_consecutive_insertions, error_code, model_id
             FROM narration_alignments WHERE narration_id=?1",
            [narration_id],
            |r| {
                Ok((
                    r.get::<_, String>(0)?,
                    r.get::<_, String>(1)?,
                    r.get::<_, Option<String>>(2)?,
                    r.get::<_, i64>(3)?,
                    r.get::<_, i64>(4)?,
                    r.get::<_, i64>(5)?,
                    r.get::<_, i64>(6)?,
                    r.get::<_, Option<String>>(7)?,
                    r.get::<_, String>(8)?,
                ))
            },
        )
        .optional()?;
    let Some((
        row_sha,
        status,
        choice,
        substitutions,
        insertions,
        deletions,
        max_consecutive_insertions,
        error_code,
        model_id,
    )) = row
    else {
        return Ok(json!({
            "status": "pending",
            "choice": Value::Null,
            "activeTrack": Value::Null,
            "substitutions": 0,
            "insertions": 0,
            "deletions": 0,
            "maxConsecutiveInsertions": 0,
            "errorCode": Value::Null,
            "modelId": "",
            "spokenText": Value::Null,
            "wordCount": 0,
        }));
    };
    if row_sha != audio_sha256 {
        return Ok(json!({
            "status": "pending",
            "choice": Value::Null,
            "activeTrack": Value::Null,
            "substitutions": 0,
            "insertions": 0,
            "deletions": 0,
            "maxConsecutiveInsertions": 0,
            "errorCode": Value::Null,
            "modelId": "",
            "spokenText": Value::Null,
            "wordCount": 0,
        }));
    }
    let active_track = match status.as_str() {
        "aligned" => Some("script"),
        "approved" => choice.as_deref(),
        _ => None,
    };
    let spoken_text: Option<String> = if matches!(status.as_str(), "needs_review" | "approved") {
        let mut q = c.prepare(
            "SELECT text FROM narration_aligned_words WHERE narration_id=?1 AND track='spoken' ORDER BY position",
        )?;
        let words: Vec<String> = q
            .query_map([narration_id], |r| r.get(0))?
            .collect::<rusqlite::Result<Vec<_>>>()?;
        (!words.is_empty()).then(|| words.join(" "))
    } else {
        None
    };
    let word_count: i64 = if let Some(track) = active_track {
        c.query_row(
            "SELECT COUNT(*) FROM narration_aligned_words WHERE narration_id=?1 AND track=?2",
            (narration_id, track),
            |r| r.get(0),
        )?
    } else {
        0
    };
    Ok(json!({
        "status": status,
        "choice": choice,
        "activeTrack": active_track,
        "substitutions": substitutions,
        "insertions": insertions,
        "deletions": deletions,
        "maxConsecutiveInsertions": max_consecutive_insertions,
        "errorCode": error_code,
        "modelId": model_id,
        "spokenText": spoken_text,
        "wordCount": word_count,
    }))
}

fn parse_worker_words(arr: Option<&Vec<Value>>) -> Result<Vec<AlignedWord>, CoreError> {
    let items = arr.ok_or_else(|| {
        error(
            "worker_protocol",
            "O worker enviou uma resposta de alinhamento inválida.",
        )
    })?;
    let mut out = Vec::with_capacity(items.len());
    for item in items {
        let text = item["text"]
            .as_str()
            .ok_or_else(|| error("worker_protocol", "Palavra sem texto no alinhamento."))?
            .trim()
            .to_owned();
        let start_us = item["start_us"]
            .as_i64()
            .filter(|&v| v >= 0)
            .ok_or_else(|| error("worker_protocol", "Tempo inicial inválido no alinhamento."))?;
        let end_us = item["end_us"]
            .as_i64()
            .filter(|&v| v >= start_us)
            .ok_or_else(|| error("worker_protocol", "Tempo final inválido no alinhamento."))?;
        if !text.is_empty() {
            out.push(AlignedWord {
                text,
                start_us,
                end_us: end_us.max(start_us + 1),
                sentence_idx: 1,
            });
        }
    }
    Ok(out)
}

fn run_worker_align(
    client: &mut WorkerClient,
    selection: &models::Selection,
    wav_16k: &Path,
    text: &str,
    language: &str,
    job_id: i64,
    stop: &AtomicBool,
) -> Result<(Vec<AlignedWord>, Vec<AlignedWord>), CoreError> {
    let flag = AtomicBool::new(false);
    let finished = AtomicBool::new(false);
    let params = json!({
        "audio": wav_16k,
        "text": text,
        "language": language,
        "batch_size": selection.config.batch_size(),
        "model": {
            "id": selection.spec.id,
            "dir": selection.dir,
            "device": selection.config.device,
            "compute_type": selection.config.compute_type,
        },
    });
    let result = std::thread::scope(|scope| {
        scope.spawn(|| {
            while !finished.load(Ordering::SeqCst) {
                if preview::check(job_id, stop).is_err() {
                    flag.store(true, Ordering::SeqCst);
                    break;
                }
                std::thread::sleep(Duration::from_millis(50));
            }
        });
        let res = client.run("align", params, &flag, &mut |ev| {
            if let WorkerEvent::Progress {
                percentage,
                message,
                ..
            } = ev
            {
                let _ = jobs::progress(job_id, "aligning", percentage.min(99), &message);
            }
        });
        finished.store(true, Ordering::SeqCst);
        res
    })?;
    let spoken = parse_worker_words(result["spoken_words"].as_array())?;
    let script = parse_worker_words(result["script_words"].as_array())?;
    Ok((spoken, script))
}

struct AlignTarget {
    narration_id: i64,
    block_id: i64,
    version_id: i64,
    text: String,
    rel_path: String,
    duration_us: i64,
    sha256: String,
}

fn load_align_targets(
    candidate_id: i64,
    only_block_id: Option<i64>,
) -> Result<(String, Vec<AlignTarget>), CoreError> {
    let cut = crate::selection::approved_cut(candidate_id)?;
    projects::with_reader(|c| {
        let latest = match read_latest_script_in(c, &cut)? {
            Ok(Some(s)) => s,
            Ok(None) => {
                return Ok(Err(error(
                    "script_not_approved",
                    "Nenhum Roteiro aprovado encontrado.",
                )))
            }
            Err(e) => return Ok(Err(e)),
        };
        if let Some(bid) = only_block_id {
            if !latest.blocks.iter().any(|b| b.block_id == bid) {
                return Ok(Err(error("block_not_found", "Bloco não encontrado.")));
            }
        }
        let norm_lang = normalize_language(&latest.language).to_owned();
        let mut out = Vec::new();
        for b in latest.blocks {
            if only_block_id.is_some_and(|id| id != b.block_id) {
                continue;
            }
            let Some(ver_id) = b.version_id else {
                continue;
            };
            let Some(text) = b
                .narration_text
                .as_deref()
                .map(str::trim)
                .filter(|s| !s.is_empty())
            else {
                continue;
            };
            let row: Option<(i64, String, i64, String)> = c
                .query_row(
                    "SELECT id, audio_rel_path, duration_us, sha256 FROM narration_blocks WHERE block_id=?1 AND version_id=?2",
                    (b.block_id, ver_id),
                    |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?, r.get(3)?)),
                )
                .optional()?;
            if let Some((narration_id, rel_path, duration_us, sha256)) = row {
                out.push(AlignTarget {
                    narration_id,
                    block_id: b.block_id,
                    version_id: ver_id,
                    text: text.to_owned(),
                    rel_path,
                    duration_us,
                    sha256,
                });
            }
        }
        Ok(Ok((norm_lang, out)))
    })?
}

pub fn run(job_id: i64, project: &Path, stop: &AtomicBool) -> Result<(), CoreError> {
    let (candidate_id, only_block_id): (i64, Option<i64>) = projects::with_reader(|c| {
        c.query_row(
            "SELECT candidate_id, block_id FROM narration_align_jobs WHERE job_id=?1",
            [job_id],
            |r| Ok((r.get(0)?, r.get(1)?)),
        )
    })?;

    script::narration_allowed(candidate_id)?;
    let settings = crate::components::load_settings()?;
    if !worker::installed(&settings) {
        return Err(error(
            "worker_missing",
            "Instale o worker de ML em Componentes antes de alinhar a Narração.",
        ));
    }
    let mut selection = models::selection()?;
    let (lang, targets) = load_align_targets(candidate_id, only_block_id)?;
    let valid_targets: Vec<(AlignTarget, PathBuf)> = targets
        .into_iter()
        .filter_map(|t| {
            let wav = resolve_rel_path(project, &t.rel_path)?;
            Some((t, wav))
        })
        .collect();
    if valid_targets.is_empty() {
        return Err(error(
            "narration_missing",
            "Gere ou importe o áudio da Narração antes de alinhar.",
        ));
    }

    let (cache_dir, _, _) = crate::components::cache_settings()?;
    let tmp_dir = cache_dir.join("narration-align");
    fs::create_dir_all(&tmp_dir).map_err(|_| {
        error(
            "narration_align_failed",
            "Não foi possível preparar a pasta de trabalho do alinhamento.",
        )
    })?;

    let mut client = worker::start_worker()?;
    let total = valid_targets.len();
    for (idx, (target, wav_path)) in valid_targets.into_iter().enumerate() {
        preview::check(job_id, stop)?;
        if let Ok(sel) = models::selection_for(selection.spec.id) {
            selection = sel;
        }
        let tmp_wav = tmp_dir.join(format!("job-{job_id}-b{}.wav", target.block_id));
        let prepared_wav = prepare_wav_16k_mono(&wav_path, &tmp_wav, job_id, stop)?;
        let result = run_worker_align(
            &mut client,
            &selection,
            &prepared_wav,
            &target.text,
            &lang,
            job_id,
            stop,
        );
        if tmp_wav.exists() {
            let _ = fs::remove_file(&tmp_wav);
        }
        let (mut spoken, mut script_words) = match result {
            Ok(pair) => pair,
            Err(err) => {
                if err.code != "cancelled" && err.code != "interrupted" {
                    let _ = projects::with_writer(|c| {
                        c.execute(
                            "INSERT INTO narration_alignments(narration_id, block_id, version_id, audio_sha256, language, model_id, status, error_code)
                             VALUES (?1, ?2, ?3, ?4, ?5, ?6, 'failed', ?7)
                             ON CONFLICT(narration_id) DO UPDATE SET
                               model_id=excluded.model_id,
                               status='failed',
                               error_code=excluded.error_code,
                               updated_at=strftime('%Y-%m-%dT%H:%M:%fZ','now')",
                            (
                                target.narration_id,
                                target.block_id,
                                target.version_id,
                                &target.sha256,
                                &lang,
                                selection.spec.id,
                                &err.code,
                            ),
                        )?;
                        Ok(())
                    });
                }
                return Err(err);
            }
        };

        let deviation = evaluate_deviation(&target.text, &spoken);
        normalize_and_segment(&mut script_words, target.duration_us);
        normalize_and_segment(&mut spoken, target.duration_us);
        if script_words.is_empty() {
            return Err(error(
                "narration_align_failed",
                "Não foi possível alinhar as palavras do Roteiro com o áudio.",
            ));
        }
        let _ = hardware::config_for_model(&settings, selection.spec.id);
        let status = if deviation.needs_review {
            "needs_review"
        } else {
            "aligned"
        };

        projects::with_writer(|c| {
            let tx = c.transaction()?;
            tx.execute(
                "INSERT INTO narration_alignments(narration_id, block_id, version_id, audio_sha256, language, model_id, status, choice, substitutions, insertions, deletions, max_consecutive_insertions, error_code)
                 VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, NULL, ?8, ?9, ?10, ?11, NULL)
                 ON CONFLICT(narration_id) DO UPDATE SET
                   block_id=excluded.block_id,
                   version_id=excluded.version_id,
                   audio_sha256=excluded.audio_sha256,
                   language=excluded.language,
                   model_id=excluded.model_id,
                   status=excluded.status,
                   choice=NULL,
                   substitutions=excluded.substitutions,
                   insertions=excluded.insertions,
                   deletions=excluded.deletions,
                   max_consecutive_insertions=excluded.max_consecutive_insertions,
                   error_code=NULL,
                   updated_at=strftime('%Y-%m-%dT%H:%M:%fZ','now')",
                (
                    target.narration_id,
                    target.block_id,
                    target.version_id,
                    &target.sha256,
                    &lang,
                    selection.spec.id,
                    status,
                    deviation.substitutions as i64,
                    deviation.insertions as i64,
                    deviation.deletions as i64,
                    deviation.max_consecutive_insertions as i64,
                ),
            )?;
            tx.execute(
                "DELETE FROM narration_aligned_words WHERE narration_id=?1",
                [target.narration_id],
            )?;
            {
                let mut ins = tx.prepare(
                    "INSERT INTO narration_aligned_words(narration_id, track, position, sentence_idx, text, start_us, end_us)
                     VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)",
                )?;
                for (pos, w) in script_words.iter().enumerate() {
                    ins.execute((
                        target.narration_id,
                        "script",
                        pos as i64,
                        w.sentence_idx,
                        &w.text,
                        w.start_us,
                        w.end_us,
                    ))?;
                }
                for (pos, w) in spoken.iter().enumerate() {
                    ins.execute((
                        target.narration_id,
                        "spoken",
                        pos as i64,
                        w.sentence_idx,
                        &w.text,
                        w.start_us,
                        w.end_us,
                    ))?;
                }
            }
            tx.commit()?;
            Ok(())
        })?;

        let pct = (((idx + 1) * 100) / total).min(99) as u8;
        let _ = jobs::progress(job_id, "aligning", pct, "Alinhando Narração");
    }

    client.shutdown();
    Ok(())
}

fn enqueue_align(v: &Value, block_id: Option<i64>) -> CommandResult {
    let candidate_id = v["candidate"]
        .as_i64()
        .ok_or_else(|| error("candidate_not_found", "Candidato não encontrado."))?;
    let project = project_root_dir()?;
    script::narration_allowed(candidate_id)?;
    let settings = crate::components::load_settings()?;
    if !worker::installed(&settings) {
        return Err(error(
            "worker_missing",
            "Instale o worker de ML em Componentes antes de alinhar a Narração.",
        ));
    }
    let _ = models::selection()?;
    let (_, targets) = load_align_targets(candidate_id, block_id)?;
    let has_wav = targets
        .iter()
        .any(|t| resolve_rel_path(&project, &t.rel_path).is_some());
    if !has_wav {
        return Err(error(
            "narration_missing",
            "Gere ou importe o áudio da Narração antes de alinhar.",
        ));
    }

    let busy: bool = projects::with_reader(|c| {
        c.query_row(
            "SELECT EXISTS(
               SELECT 1 FROM narration_align_jobs a JOIN jobs j ON j.id=a.job_id
               WHERE a.candidate_id=?1 AND j.state IN ('queued','running')
             )",
            [candidate_id],
            |r| r.get(0),
        )
    })?;
    if busy {
        return Err(error(
            "generation_in_progress",
            "Já há um alinhamento de Narração em andamento para este Corte.",
        ));
    }

    let job_id = jobs::enqueue(JOB_KIND, Safety::Local)?;
    projects::with_writer(|c| {
        c.execute(
            "INSERT INTO narration_align_jobs(job_id, candidate_id, block_id) VALUES (?1, ?2, ?3)",
            (job_id, candidate_id, block_id),
        )?;
        Ok(())
    })?;

    Ok(json!({
        "job": job_id,
        "candidate": candidate_id,
        "blockId": block_id,
    }))
}

fn cmd_align(v: Value, _: &mut EventSink<'_>) -> CommandResult {
    enqueue_align(&v, None)
}

fn cmd_align_block(v: Value, _: &mut EventSink<'_>) -> CommandResult {
    let block_id = v["block"]
        .as_i64()
        .or_else(|| v["blockId"].as_i64())
        .ok_or_else(|| error("block_not_found", "Bloco não encontrado."))?;
    enqueue_align(&v, Some(block_id))
}

fn cmd_review(v: Value, _: &mut EventSink<'_>) -> CommandResult {
    let candidate_id = v["candidate"]
        .as_i64()
        .ok_or_else(|| error("candidate_not_found", "Candidato não encontrado."))?;
    let block_id = v["block"]
        .as_i64()
        .or_else(|| v["blockId"].as_i64())
        .ok_or_else(|| error("block_not_found", "Bloco não encontrado."))?;
    let choice = match v["choice"].as_str() {
        Some(c @ ("script" | "spoken")) => c,
        _ => {
            return Err(error(
                "invalid_review_choice",
                "Escolha “script” (Roteiro) ou “spoken” (texto falado).",
            ))
        }
    };

    let cut = crate::selection::approved_cut(candidate_id)?;
    let (narration_id, sha256) = projects::with_reader(|c| {
        let latest = match read_latest_script_in(c, &cut)? {
            Ok(Some(s)) => s,
            Ok(None) => {
                return Ok(Err(error(
                    "script_not_approved",
                    "Nenhum Roteiro encontrado.",
                )))
            }
            Err(e) => return Ok(Err(e)),
        };
        let Some(block) = latest.blocks.into_iter().find(|b| b.block_id == block_id) else {
            return Ok(Err(error("block_not_found", "Bloco não encontrado.")));
        };
        let Some(ver_id) = block.version_id else {
            return Ok(Err(error(
                "narration_missing",
                "Bloco sem versão de Narração.",
            )));
        };
        let row: Option<(i64, String)> = c
            .query_row(
                "SELECT id, sha256 FROM narration_blocks WHERE block_id=?1 AND version_id=?2",
                (block_id, ver_id),
                |r| Ok((r.get(0)?, r.get(1)?)),
            )
            .optional()?;
        Ok(match row {
            Some(r) => Ok(r),
            None => Err(error(
                "narration_missing",
                "Bloco sem áudio de Narração para a versão atual.",
            )),
        })
    })??;

    let updated = projects::with_writer(|c| {
        let has_words: bool = c.query_row(
            "SELECT EXISTS(SELECT 1 FROM narration_aligned_words WHERE narration_id=?1 AND track=?2)",
            (narration_id, choice),
            |r| r.get(0),
        )?;
        if !has_words {
            return Ok(None);
        }
        let changed = c.execute(
            "UPDATE narration_alignments SET status='approved', choice=?2, updated_at=strftime('%Y-%m-%dT%H:%M:%fZ','now')
             WHERE narration_id=?1 AND audio_sha256=?3 AND status IN ('needs_review','approved','aligned')",
            (narration_id, choice, &sha256),
        )?;
        Ok(Some(changed))
    })?;

    if !matches!(updated, Some(1)) {
        return Err(error(
            "alignment_missing",
            "Alinhe este bloco antes de revisar o texto da legenda.",
        ));
    }

    let alignment = projects::with_reader(|c| read_block_alignment_json(c, narration_id, &sha256))?;
    Ok(json!({
        "candidate": candidate_id,
        "blockId": block_id,
        "alignment": alignment,
    }))
}

fn candidate_for_clip(c: &Connection, clip_id: i64) -> rusqlite::Result<Option<i64>> {
    let identity: Option<String> = c
        .query_row(
            "SELECT identity FROM clip_edits WHERE id=?1",
            [clip_id],
            |r| r.get(0),
        )
        .optional()?;
    Ok(identity.and_then(|id| id.strip_prefix("candidate:")?.parse::<i64>().ok()))
}

/// Persiste o modo de legenda escolhido para o candidato (`auto`, `narration`, `original` ou `translated`).
pub(crate) fn set_saved_track_for_candidate(
    candidate_id: i64,
    track: &str,
) -> Result<(), CoreError> {
    projects::with_writer(|c| {
        c.execute(
            "INSERT INTO narration_caption_tracks(candidate_id, track) VALUES (?1, ?2)
             ON CONFLICT(candidate_id) DO UPDATE SET track=excluded.track",
            (candidate_id, track),
        )?;
        Ok(())
    })
}

pub(crate) fn sync_track_from_translation(clip_id: i64, track: &str) -> Result<(), CoreError> {
    let candidate = projects::with_reader(|c| candidate_for_clip(c, clip_id))?;
    if let Some(cid) = candidate {
        set_saved_track_for_candidate(cid, track)?;
    }
    Ok(())
}

fn cmd_track_set(v: Value, _: &mut EventSink<'_>) -> CommandResult {
    let _guard = projects::start_job()?;
    let clip_id = v["clip_id"].as_i64().filter(|&id| id > 0);
    let candidate_id = match v["candidate_id"].as_i64().filter(|&id| id > 0) {
        Some(cid) => Some(cid),
        None => match clip_id {
            Some(cid) => projects::with_reader(|c| candidate_for_clip(c, cid))?,
            None => None,
        },
    };
    let track = match v["track"].as_str() {
        Some(t @ ("auto" | "narration" | "original" | "translated")) => t,
        _ => {
            return Err(error(
                "invalid_track",
                "Escolha a faixa da legenda: narração, original ou traduzida.",
            ))
        }
    };

    if track == "translated" {
        let Some(cid) = clip_id else {
            return Err(error(
                "translation_missing",
                "Gere uma legenda traduzida antes de selecioná-la.",
            ));
        };
        let lang = crate::translation::active_translated_language(cid)?;
        let has_rows = projects::with_reader(|c| {
            if let Some(l) = lang.as_deref() {
                c.query_row(
                    "SELECT COUNT(*) FROM clip_translated_sentences WHERE clip_id=?1 AND language=?2",
                    (cid, l),
                    |r| r.get::<_, i64>(0),
                )
            } else {
                c.query_row(
                    "SELECT COUNT(*) FROM clip_translated_sentences WHERE clip_id=?1",
                    [cid],
                    |r| r.get::<_, i64>(0),
                )
            }
        })?;
        if has_rows == 0 {
            return Err(error(
                "translation_missing",
                "Gere uma legenda traduzida antes de selecioná-la.",
            ));
        }
        projects::with_writer(|c| {
            c.execute(
                "INSERT INTO clip_caption_tracks(clip_id, active_track) VALUES (?1, 'translated')
                 ON CONFLICT(clip_id) DO UPDATE SET active_track='translated'",
                [cid],
            )?;
            Ok(())
        })?;
    } else if track == "original" {
        if let Some(cid) = clip_id {
            projects::with_writer(|c| {
                c.execute(
                    "UPDATE clip_caption_tracks SET active_track='original' WHERE clip_id=?1",
                    [cid],
                )?;
                Ok(())
            })?;
        }
    }

    if let Some(cand) = candidate_id {
        if track == "narration" {
            let cut = crate::selection::approved_cut(cand)?;
            let is_transformed: bool = projects::with_reader(|c| {
                c.query_row(
                    "SELECT video_kind = 'transformed' FROM selection_runs WHERE id=?1",
                    [cut.run],
                    |r| r.get(0),
                )
            })?;
            if !is_transformed {
                return Err(error(
                    "script_requires_transformed",
                    "Legendas da Narração só existem para o Vídeo transformado.",
                ));
            }
        }
        set_saved_track_for_candidate(cand, track)?;
    } else if track == "narration" {
        return Err(error(
            "candidate_not_found",
            "Candidato não encontrado para selecionar a faixa da Narração.",
        ));
    }

    Ok(json!({
        "candidateId": candidate_id,
        "clipId": clip_id,
        "track": track,
    }))
}

#[derive(Clone, Debug, Default, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct NarrationTrackSummary {
    pub has_narration: bool,
    pub aligned_blocks: usize,
    pub pending_blocks: usize,
    pub needs_review_blocks: usize,
    pub stale_blocks: usize,
}

#[derive(Clone, Debug)]
pub(crate) struct NarrationCaptionItem {
    pub text: String,
    pub start_us: i64,
    pub end_us: i64,
    pub sentence_key: (i64, i64),
}

pub(crate) struct NarrationTimelineCaptions {
    pub summary: NarrationTrackSummary,
    pub active_intervals: Vec<(i64, i64)>,
    pub words: Vec<NarrationCaptionItem>,
    pub total_duration_us: i64,
}

/// Estado resumido da Narração alinhada + palavras deslocadas pelos inícios da montagem (#204 + #81).
pub(crate) fn narration_captions_for_cut(
    candidate_id: i64,
    clip_id: Option<i64>,
) -> Result<Option<NarrationTimelineCaptions>, CoreError> {
    let Some(plan) = montage::plan_for_clip(clip_id, candidate_id, &[])? else {
        return Ok(None);
    };
    let project = project_root_dir()?;
    let cut = crate::selection::approved_cut(candidate_id)?;

    struct BlockMeta {
        has_audio: bool,
        stale: bool,
        status: String,
        words: Vec<AlignedWord>,
    }

    let meta_by_block: HashMap<i64, BlockMeta> = projects::with_reader(|c| {
        let latest = match read_latest_script_in(c, &cut)? {
            Ok(Some(s)) => s,
            Ok(None) => return Ok(Ok(HashMap::new())),
            Err(e) => return Ok(Err(e)),
        };
        let mut map = HashMap::new();
        for b in latest.blocks {
            let latest_audio: Option<(i64, i64, String, String)> = c
                .query_row(
                    "SELECT id, version_id, audio_rel_path, sha256 FROM narration_blocks WHERE block_id=?1 ORDER BY id DESC LIMIT 1",
                    [b.block_id],
                    |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?, r.get(3)?)),
                )
                .optional()?;
            let Some((narration_id, ver_id, rel_path, sha256)) = latest_audio else {
                map.insert(
                    b.block_id,
                    BlockMeta {
                        has_audio: false,
                        stale: false,
                        status: "none".into(),
                        words: Vec::new(),
                    },
                );
                continue;
            };
            if resolve_rel_path(&project, &rel_path).is_none() {
                map.insert(
                    b.block_id,
                    BlockMeta {
                        has_audio: false,
                        stale: false,
                        status: "none".into(),
                        words: Vec::new(),
                    },
                );
                continue;
            }
            if Some(ver_id) != b.version_id {
                map.insert(
                    b.block_id,
                    BlockMeta {
                        has_audio: true,
                        stale: true,
                        status: "stale".into(),
                        words: Vec::new(),
                    },
                );
                continue;
            }
            let align_row: Option<(String, String, Option<String>)> = c
                .query_row(
                    "SELECT audio_sha256, status, choice FROM narration_alignments WHERE narration_id=?1",
                    [narration_id],
                    |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?)),
                )
                .optional()?;
            let Some((row_sha, status, choice)) = align_row else {
                map.insert(
                    b.block_id,
                    BlockMeta {
                        has_audio: true,
                        stale: false,
                        status: "pending".into(),
                        words: Vec::new(),
                    },
                );
                continue;
            };
            if row_sha != sha256 {
                map.insert(
                    b.block_id,
                    BlockMeta {
                        has_audio: true,
                        stale: false,
                        status: "pending".into(),
                        words: Vec::new(),
                    },
                );
                continue;
            }
            let track = match status.as_str() {
                "aligned" => Some("script"),
                "approved" => choice.as_deref(),
                _ => None,
            };
            let words = if let Some(track) = track {
                let mut q = c.prepare(
                    "SELECT text, start_us, end_us, sentence_idx FROM narration_aligned_words
                     WHERE narration_id=?1 AND track=?2 ORDER BY position",
                )?;
                let rows = q
                    .query_map((narration_id, track), |r| {
                        Ok(AlignedWord {
                            text: r.get(0)?,
                            start_us: r.get(1)?,
                            end_us: r.get(2)?,
                            sentence_idx: r.get(3)?,
                        })
                    })?
                    .collect::<rusqlite::Result<Vec<_>>>()?;
                rows
            } else {
                Vec::new()
            };
            map.insert(
                b.block_id,
                BlockMeta {
                    has_audio: true,
                    stale: false,
                    status,
                    words,
                },
            );
        }
        Ok(Ok(map))
    })??;

    let mut summary = NarrationTrackSummary::default();
    let mut active_intervals = Vec::new();
    let mut words = Vec::new();

    for b in &plan.blocks {
        let Some(meta) = meta_by_block.get(&b.block_id) else {
            continue;
        };
        if !meta.has_audio {
            continue;
        }
        active_intervals.push((b.start_us, b.end_us));
        if meta.stale {
            summary.stale_blocks += 1;
            continue;
        }
        match meta.status.as_str() {
            "aligned" | "approved" => {
                summary.has_narration = true;
                summary.aligned_blocks += 1;
                for w in &meta.words {
                    let abs_start = b.start_us + w.start_us;
                    let abs_end = (b.start_us + w.end_us).min(b.end_us.max(abs_start + 1));
                    if abs_start >= b.end_us && b.end_us > b.start_us {
                        continue;
                    }
                    words.push(NarrationCaptionItem {
                        text: w.text.clone(),
                        start_us: abs_start,
                        end_us: abs_end.max(abs_start + 1),
                        sentence_key: (b.block_id, w.sentence_idx),
                    });
                }
            }
            "needs_review" => {
                summary.has_narration = true;
                summary.needs_review_blocks += 1;
            }
            _ => {
                summary.pending_blocks += 1;
            }
        }
    }

    Ok(Some(NarrationTimelineCaptions {
        summary,
        active_intervals,
        words,
        total_duration_us: plan.total_duration_us,
    }))
}

/// Resolve qual faixa de legenda está ativa (`"narration"`, `"translated"` ou `"original"`).
pub(crate) fn saved_track_for_candidate(candidate_id: i64) -> Result<Option<String>, CoreError> {
    projects::with_reader(|c| {
        c.query_row(
            "SELECT track FROM narration_caption_tracks WHERE candidate_id=?1",
            [candidate_id],
            |r| r.get(0),
        )
        .optional()
    })
}

/// Recorta/filtra palavras da Fonte fora dos intervalos onde há áudio de Narração, garantindo
/// sobreposição zero entre legenda da Fonte e legenda da Narração.
pub(crate) fn filter_source_words_outside_narration(
    source_styled: Vec<crate::caption_style::StyledWord>,
    source_starts: Vec<i64>,
    source_ends: Vec<i64>,
    source_sentence_ids: Vec<Option<i64>>,
    intervals: &[(i64, i64)],
) -> (
    Vec<crate::caption_style::StyledWord>,
    Vec<i64>,
    Vec<i64>,
    Vec<Option<i64>>,
) {
    if intervals.is_empty() {
        return (
            source_styled,
            source_starts,
            source_ends,
            source_sentence_ids,
        );
    }
    let mut out_styled = Vec::with_capacity(source_styled.len());
    let mut out_starts = Vec::with_capacity(source_starts.len());
    let mut out_ends = Vec::with_capacity(source_ends.len());
    let mut out_sids = Vec::with_capacity(source_sentence_ids.len());

    for (mut sw, (ss, (se, sid))) in source_styled.into_iter().zip(
        source_starts
            .into_iter()
            .zip(source_ends.into_iter().zip(source_sentence_ids)),
    ) {
        let mut ws = sw.word.start_us;
        let mut we = sw.word.end_us;
        let mut keep = true;
        for &(a, b) in intervals {
            if we <= a || ws >= b {
                continue;
            }
            let mid = ws + (we - ws) / 2;
            if mid >= a && mid < b {
                keep = false;
                break;
            }
            if ws < a && we > a {
                we = a;
            } else if ws < b && we > b {
                ws = b;
            }
            if we - ws < MIN_WORD_US {
                keep = false;
                break;
            }
        }
        if keep && we > ws {
            sw.word.start_us = ws;
            sw.word.end_us = we;
            out_styled.push(sw);
            out_starts.push(ss);
            out_ends.push(se);
            out_sids.push(sid);
        }
    }

    (out_styled, out_starts, out_ends, out_sids)
}

/// Constrói a lista mesclada (Narração nos seus intervalos + Fonte original fora deles) e os
/// índices de Frase para `caption_style::prepare_with_sentences`.
pub(crate) fn merge_narration_and_source_words(
    narration: &NarrationTimelineCaptions,
    source_styled: Vec<crate::caption_style::StyledWord>,
    source_starts: Vec<i64>,
    source_ends: Vec<i64>,
    source_sentence_ids: Vec<Option<i64>>,
    splice: &SpliceMap,
    clip_end_us: i64,
) -> (
    Vec<crate::caption_style::StyledWord>,
    Vec<i64>,
    Vec<i64>,
    Vec<Option<i64>>,
    Vec<Option<(i64, i64)>>,
) {
    let (filtered_styled, filtered_starts, filtered_ends, filtered_sids) =
        filter_source_words_outside_narration(
            source_styled,
            source_starts,
            source_ends,
            source_sentence_ids,
            &narration.active_intervals,
        );

    struct Combined {
        styled: crate::caption_style::StyledWord,
        source_start: i64,
        source_end: i64,
        sentence_id: Option<i64>,
        sentence_key: Option<(i64, i64)>,
    }

    let mut all = Vec::with_capacity(filtered_styled.len() + narration.words.len());
    for (sw, (ss, (se, sid))) in filtered_styled.into_iter().zip(
        filtered_starts
            .into_iter()
            .zip(filtered_ends.into_iter().zip(filtered_sids)),
    ) {
        all.push(Combined {
            styled: sw,
            source_start: ss,
            source_end: se,
            sentence_id: sid,
            sentence_key: sid.map(|id| (0, id)),
        });
    }

    for (idx, nw) in narration.words.iter().enumerate() {
        let mapped_src_start = if nw.start_us <= splice.output_duration_us {
            splice.output_to_source(nw.start_us)
        } else {
            clip_end_us
        };
        let mapped_src_end = if nw.end_us <= splice.output_duration_us {
            splice.output_to_source(nw.end_us)
        } else {
            clip_end_us
        };
        all.push(Combined {
            styled: crate::caption_style::StyledWord {
                word: CaptionWord {
                    text: if idx == 0 {
                        nw.text.clone()
                    } else {
                        format!(" {}", nw.text)
                    },
                    start_us: nw.start_us,
                    end_us: nw.end_us,
                },
                position: -(idx as i64 + 1),
                overrides: WordOverride::default(),
            },
            source_start: mapped_src_start,
            source_end: mapped_src_end,
            sentence_id: Some(nw.sentence_key.1),
            sentence_key: Some(nw.sentence_key),
        });
    }

    all.sort_by_key(|item| {
        (
            item.styled.word.start_us,
            item.styled.word.end_us,
            item.styled.position,
        )
    });

    let mut out_styled = Vec::with_capacity(all.len());
    let mut out_starts = Vec::with_capacity(all.len());
    let mut out_ends = Vec::with_capacity(all.len());
    let mut out_sids = Vec::with_capacity(all.len());
    let mut out_keys = Vec::with_capacity(all.len());
    for item in all {
        out_styled.push(item.styled);
        out_starts.push(item.source_start);
        out_ends.push(item.source_end);
        out_sids.push(item.sentence_id);
        out_keys.push(item.sentence_key);
    }

    (out_styled, out_starts, out_ends, out_sids, out_keys)
}

inventory::submit! { CommandRegistration { name: "narration.align", execute: cmd_align } }
inventory::submit! { CommandRegistration { name: "narration.align_block", execute: cmd_align_block } }
inventory::submit! { CommandRegistration { name: "narration.review", execute: cmd_review } }
inventory::submit! { CommandRegistration { name: "captions.track.set", execute: cmd_track_set } }

#[cfg(test)]
mod tests {
    use super::*;

    fn word(text: &str, start_us: i64, end_us: i64) -> AlignedWord {
        AlignedWord {
            text: text.into(),
            start_us,
            end_us,
            sentence_idx: 1,
        }
    }

    #[test]
    fn deviation_flags_two_consecutive_insertions_or_three_substitutions() {
        let exact = evaluate_deviation(
            "Olá mundo, tudo bem?",
            &[
                word("Olá", 0, 100),
                word("mundo", 100, 200),
                word("tudo", 200, 300),
                word("bem", 300, 400),
            ],
        );
        assert!(!exact.needs_review);
        assert_eq!(
            (exact.substitutions, exact.max_consecutive_insertions),
            (0, 0)
        );

        // 2 inserções separadas não disparam revisão.
        let single_ins = evaluate_deviation(
            "Olá mundo hoje.",
            &[
                word("Olá", 0, 100),
                word("galera", 100, 200),
                word("mundo", 200, 300),
                word("hoje", 300, 400),
                word("aqui", 400, 500),
            ],
        );
        assert!(!single_ins.needs_review);
        assert_eq!(single_ins.insertions, 2);
        assert_eq!(single_ins.max_consecutive_insertions, 1);

        // 2 inserções seguidas disparam revisão.
        let two_ins = evaluate_deviation(
            "Olá mundo.",
            &[
                word("Olá", 0, 100),
                word("meu", 100, 200),
                word("amigo", 200, 300),
                word("mundo", 300, 400),
            ],
        );
        assert!(two_ins.needs_review);
        assert_eq!(two_ins.max_consecutive_insertions, 2);

        // 3 substituições disparam revisão; 2 não.
        let two_subs = evaluate_deviation(
            "um dois tres quatro",
            &[
                word("alpha", 0, 100),
                word("beta", 100, 200),
                word("tres", 200, 300),
                word("quatro", 300, 400),
            ],
        );
        assert!(!two_subs.needs_review);
        assert_eq!(two_subs.substitutions, 2);

        let three_subs = evaluate_deviation(
            "um dois tres quatro",
            &[
                word("alpha", 0, 100),
                word("beta", 100, 200),
                word("gama", 200, 300),
                word("quatro", 300, 400),
            ],
        );
        assert!(three_subs.needs_review);
        assert_eq!(three_subs.substitutions, 3);
    }

    #[test]
    fn sentence_segmentation_splits_on_punctuation_and_long_pauses() {
        let mut words = vec![
            word("Primeira", 0, 300_000),
            word("frase.", 320_000, 600_000),
            word("Segunda", 700_000, 1_000_000), // pausa < 700ms, mas após '.'
            word("parte", 1_800_000, 2_100_000), // pausa >= 700ms
        ];
        normalize_and_segment(&mut words, 2_500_000);
        assert_eq!(
            words.iter().map(|w| w.sentence_idx).collect::<Vec<_>>(),
            vec![1, 1, 2, 3]
        );
    }
}
