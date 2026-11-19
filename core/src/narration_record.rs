//! Gravação da Narração por bloco com aparo de silêncios por Silero VAD (#83).
//!
//! Converte a captura do microfone (WAV PCM ou contêiner do WebView via FFmpeg) para
//! WAV PCM 16 bits, 24 kHz, mono — mesmo formato e caminho do TTS (#79) —, apara os
//! silêncios do início e do fim via tarefa `vad` (Silero) do worker e dispara o
//! alinhamento por palavra (#81).

use crate::{
    components::worker,
    process, projects, script,
    tts::catalog::normalize_language,
    tts::narration::{parse_wav_info, project_root_dir, read_latest_script_in},
    CommandRegistration, CommandResult, CoreError, EventSink,
};
use rusqlite::{Connection, OptionalExtension};
use serde_json::{json, Value};
use std::{
    fs::{self, File},
    io::Write,
    path::{Path, PathBuf},
    sync::atomic::{AtomicBool, AtomicU64, Ordering},
};

pub const TARGET_SAMPLE_RATE: u32 = 24_000;
const VAD_SAMPLE_RATE: u32 = 16_000;
const ENGINE_ID: &str = "recorded";
const VOICE_ID: &str = "recorded";
const MODEL_VAD: &str = "silero-vad";
const MODEL_UNTRIMMED: &str = "untrimmed";
const MAX_RECORDING_BYTES: usize = 64 * 1024 * 1024;

static TEMP_SEQ: AtomicU64 = AtomicU64::new(1);

inventory::submit! {
    projects::Migration {
        id: "0083_001_narration_recordings",
        sql: "
CREATE TABLE narration_recordings (
  narration_id INTEGER PRIMARY KEY REFERENCES narration_blocks(id) ON DELETE CASCADE,
  trimmed INTEGER NOT NULL DEFAULT 1 CHECK(trimmed IN (0, 1)),
  trim_start_us INTEGER NOT NULL DEFAULT 0,
  trim_end_us INTEGER NOT NULL DEFAULT 0,
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
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

fn error_with_usage(code: &str, message: &str, usage: Value) -> CoreError {
    CoreError {
        code: code.into(),
        message: message.into(),
        usage: Some(usage),
    }
}

/// O worker de ML (que inclui Silero VAD) está instalado?
pub(crate) fn vad_ready() -> bool {
    let Ok(settings) = crate::components::load_settings() else {
        return false;
    };
    worker::installed(&settings)
}

fn decode_base64(input: &str) -> Result<Vec<u8>, CoreError> {
    let invalid = || error("invalid_recording_audio", "Áudio gravado inválido.");
    let cleaned: Vec<u8> = input.bytes().filter(|b| !b.is_ascii_whitespace()).collect();
    if cleaned.is_empty() || !cleaned.len().is_multiple_of(4) {
        return Err(invalid());
    }
    let estimated = (cleaned.len() / 4) * 3;
    if estimated > MAX_RECORDING_BYTES + 3 {
        return Err(error(
            "recording_too_large",
            "A gravação excede o tamanho máximo permitido.",
        ));
    }
    let mut out = Vec::with_capacity(estimated);
    let val = |b: u8| -> Option<u8> {
        match b {
            b'A'..=b'Z' => Some(b - b'A'),
            b'a'..=b'z' => Some(b - b'a' + 26),
            b'0'..=b'9' => Some(b - b'0' + 52),
            b'+' | b'-' => Some(62),
            b'/' | b'_' => Some(63),
            _ => None,
        }
    };
    for (idx, chunk) in cleaned.as_chunks::<4>().0.iter().enumerate() {
        let is_last = idx + 1 == cleaned.len() / 4;
        let a = val(chunk[0]).ok_or_else(invalid)?;
        let b = val(chunk[1]).ok_or_else(invalid)?;
        let pad_c = chunk[2] == b'=';
        let pad_d = chunk[3] == b'=';
        if (pad_c && !pad_d) || ((pad_c || pad_d) && !is_last) {
            return Err(invalid());
        }
        let c = if pad_c {
            0
        } else {
            val(chunk[2]).ok_or_else(invalid)?
        };
        let d = if pad_d {
            0
        } else {
            val(chunk[3]).ok_or_else(invalid)?
        };
        out.push((a << 2) | (b >> 4));
        if !pad_c {
            out.push((b << 4) | (c >> 2));
        }
        if !pad_d {
            out.push((c << 6) | d);
        }
    }
    if out.is_empty() {
        return Err(invalid());
    }
    if out.len() > MAX_RECORDING_BYTES {
        return Err(error(
            "recording_too_large",
            "A gravação excede o tamanho máximo permitido.",
        ));
    }
    Ok(out)
}

#[derive(Clone, Debug)]
pub(crate) struct PcmAudio {
    sample_rate: u32,
    channels: u16,
    /// Amostras normalizadas por quadro intercaladas por canal.
    samples: Vec<f32>,
}

pub(crate) fn try_parse_wav(bytes: &[u8]) -> Option<PcmAudio> {
    if bytes.len() < 44 || &bytes[0..4] != b"RIFF" || &bytes[8..12] != b"WAVE" {
        return None;
    }
    let mut pos = 12usize;
    let mut format = None;
    let mut channels = None;
    let mut sample_rate = None;
    let mut bits = None;
    let mut data: Option<&[u8]> = None;
    while pos + 8 <= bytes.len() {
        let id = &bytes[pos..pos + 4];
        let size = u32::from_le_bytes(bytes[pos + 4..pos + 8].try_into().ok()?) as usize;
        let body_start = pos + 8;
        let body_end = body_start.saturating_add(size);
        if body_end > bytes.len() {
            break;
        }
        if id == b"fmt " && size >= 16 {
            format = Some(u16::from_le_bytes(
                bytes[body_start..body_start + 2].try_into().ok()?,
            ));
            channels = Some(u16::from_le_bytes(
                bytes[body_start + 2..body_start + 4].try_into().ok()?,
            ));
            sample_rate = Some(u32::from_le_bytes(
                bytes[body_start + 4..body_start + 8].try_into().ok()?,
            ));
            bits = Some(u16::from_le_bytes(
                bytes[body_start + 14..body_start + 16].try_into().ok()?,
            ));
        } else if id == b"data" {
            data = Some(&bytes[body_start..body_end]);
            break;
        }
        pos = body_start.saturating_add(size + (size & 1));
    }
    let (Some(fmt), Some(ch), Some(sr), Some(bps), Some(raw)) =
        (format, channels, sample_rate, bits, data)
    else {
        return None;
    };
    if ch == 0 || sr == 0 {
        return None;
    }
    let samples: Vec<f32> = match (fmt, bps) {
        (1, 16) => {
            if raw.len() < usize::from(ch) * 2 {
                return None;
            }
            raw.as_chunks::<2>()
                .0
                .iter()
                .map(|b| f32::from(i16::from_le_bytes(*b)) / 32768.0)
                .collect()
        }
        (3, 32) => {
            if raw.len() < usize::from(ch) * 4 {
                return None;
            }
            raw.as_chunks::<4>()
                .0
                .iter()
                .map(|b| f32::from_le_bytes(*b).clamp(-1.0, 1.0))
                .collect()
        }
        _ => return None,
    };
    if samples.len() < usize::from(ch) {
        return None;
    }
    Some(PcmAudio {
        sample_rate: sr,
        channels: ch,
        samples,
    })
}

pub(crate) fn to_mono_resampled(audio: &PcmAudio, target_rate: u32) -> Vec<i16> {
    let ch = usize::from(audio.channels);
    let frames = audio.samples.len() / ch;
    let mono: Vec<f32> = if ch == 1 {
        audio.samples[..frames].to_vec()
    } else {
        (0..frames)
            .map(|f| {
                let sum: f32 = (0..ch).map(|c| audio.samples[f * ch + c]).sum();
                sum / ch as f32
            })
            .collect()
    };
    if audio.sample_rate == target_rate {
        return mono
            .into_iter()
            .map(|s| (s.clamp(-1.0, 1.0) * 32767.0).round() as i16)
            .collect();
    }
    let out_frames = ((u64::try_from(frames).unwrap_or(0) * u64::from(target_rate))
        / u64::from(audio.sample_rate))
    .max(1) as usize;
    let ratio = f64::from(audio.sample_rate) / f64::from(target_rate);
    let mut out = Vec::with_capacity(out_frames);
    for idx in 0..out_frames {
        let pos = idx as f64 * ratio;
        let i0 = (pos.floor() as usize).min(frames.saturating_sub(1));
        let i1 = (i0 + 1).min(frames.saturating_sub(1));
        let frac = (pos - i0 as f64) as f32;
        let sample = mono[i0] + (mono[i1] - mono[i0]) * frac;
        out.push((sample.clamp(-1.0, 1.0) * 32767.0).round() as i16);
    }
    out
}

pub(crate) fn resample_i16_mono(samples: &[i16], src_rate: u32, dst_rate: u32) -> Vec<i16> {
    if src_rate == dst_rate || samples.is_empty() {
        return samples.to_vec();
    }
    let out_frames = ((u64::try_from(samples.len()).unwrap_or(0) * u64::from(dst_rate))
        / u64::from(src_rate))
    .max(1) as usize;
    let ratio = f64::from(src_rate) / f64::from(dst_rate);
    let mut out = Vec::with_capacity(out_frames);
    for idx in 0..out_frames {
        let pos = idx as f64 * ratio;
        let i0 = (pos.floor() as usize).min(samples.len().saturating_sub(1));
        let i1 = (i0 + 1).min(samples.len().saturating_sub(1));
        let frac = pos - i0 as f64;
        let v = f64::from(samples[i0]) + (f64::from(samples[i1]) - f64::from(samples[i0])) * frac;
        out.push(v.round().clamp(-32768.0, 32767.0) as i16);
    }
    out
}

pub(crate) fn encode_pcm_wav_mono(samples: &[i16], sample_rate: u32) -> Vec<u8> {
    let data_bytes = (samples.len() * 2) as u32;
    let byte_rate = sample_rate * 2;
    let mut buf = Vec::with_capacity(44 + data_bytes as usize);
    buf.extend_from_slice(b"RIFF");
    buf.extend_from_slice(&(36 + data_bytes).to_le_bytes());
    buf.extend_from_slice(b"WAVEfmt ");
    buf.extend_from_slice(&16u32.to_le_bytes());
    buf.extend_from_slice(&1u16.to_le_bytes());
    buf.extend_from_slice(&1u16.to_le_bytes());
    buf.extend_from_slice(&sample_rate.to_le_bytes());
    buf.extend_from_slice(&byte_rate.to_le_bytes());
    buf.extend_from_slice(&2u16.to_le_bytes());
    buf.extend_from_slice(&16u16.to_le_bytes());
    buf.extend_from_slice(b"data");
    buf.extend_from_slice(&data_bytes.to_le_bytes());
    for &s in samples {
        buf.extend_from_slice(&s.to_le_bytes());
    }
    buf
}

pub(crate) fn write_atomic_bytes(dest: &Path, bytes: &[u8]) -> Result<(), CoreError> {
    if let Some(parent) = dest.parent() {
        fs::create_dir_all(parent).map_err(|_| {
            error(
                "narration_record_failed",
                "Não foi possível preparar a pasta de gravação.",
            )
        })?;
    }
    let tmp = dest.with_extension("wav.part");
    let _ = fs::remove_file(&tmp);
    {
        let mut f = File::create(&tmp).map_err(|_| {
            error(
                "narration_record_failed",
                "Não foi possível gravar o arquivo de áudio.",
            )
        })?;
        f.write_all(bytes).map_err(|_| {
            error(
                "narration_record_failed",
                "Não foi possível gravar o arquivo de áudio.",
            )
        })?;
        f.sync_all().map_err(|_| {
            error(
                "narration_record_failed",
                "Não foi possível confirmar a gravação do áudio.",
            )
        })?;
    }
    if dest.exists() {
        let _ = fs::remove_file(dest);
    }
    fs::rename(&tmp, dest).map_err(|_| {
        let _ = fs::remove_file(&tmp);
        error(
            "narration_record_failed",
            "Não foi possível salvar o áudio gravado.",
        )
    })?;
    Ok(())
}

fn mime_extension(mime: Option<&str>) -> &'static str {
    let m = mime.unwrap_or("").to_ascii_lowercase();
    if m.contains("webm") {
        "webm"
    } else if m.contains("ogg") {
        "ogg"
    } else if m.contains("mp4") || m.contains("aac") || m.contains("m4a") {
        "m4a"
    } else if m.contains("wav") {
        "wav"
    } else {
        "bin"
    }
}

fn transcode_to_24k_mono(
    raw_bytes: &[u8],
    mime: Option<&str>,
    work_dir: &Path,
) -> Result<Vec<i16>, CoreError> {
    if let Some(pcm) = try_parse_wav(raw_bytes) {
        return Ok(to_mono_resampled(&pcm, TARGET_SAMPLE_RATE));
    }
    let ffmpeg = crate::components::cache_settings()?.2.ok_or_else(|| {
        error(
            "component_missing",
            "Instale o Componente FFmpeg para converter o áudio gravado.",
        )
    })?;
    fs::create_dir_all(work_dir).map_err(|_| {
        error(
            "narration_record_failed",
            "Não foi possível preparar a pasta temporária de gravação.",
        )
    })?;
    let seq = TEMP_SEQ.fetch_add(1, Ordering::Relaxed);
    let pid = std::process::id();
    let in_path = work_dir.join(format!("rec-in-{pid}-{seq}.{}", mime_extension(mime)));
    let out_path = work_dir.join(format!("rec-24k-{pid}-{seq}.wav"));
    let _ = fs::remove_file(&out_path);
    fs::write(&in_path, raw_bytes).map_err(|_| {
        error(
            "narration_record_failed",
            "Não foi possível preparar o áudio gravado para conversão.",
        )
    })?;

    let args: Vec<std::ffi::OsString> = vec![
        "-v".into(),
        "error".into(),
        "-y".into(),
        "-i".into(),
        in_path.as_os_str().to_owned(),
        "-vn".into(),
        "-ac".into(),
        "1".into(),
        "-ar".into(),
        TARGET_SAMPLE_RATE.to_string().into(),
        "-c:a".into(),
        "pcm_s16le".into(),
        "-f".into(),
        "wav".into(),
        out_path.as_os_str().to_owned(),
    ];
    let status = process::spawn_managed(&ffmpeg, args).and_then(|(mut child, _group)| child.wait());
    let _ = fs::remove_file(&in_path);

    let converted = match status {
        Ok(st) if st.success() => fs::read(&out_path).ok(),
        _ => None,
    };
    let _ = fs::remove_file(&out_path);

    let bytes = converted.ok_or_else(|| {
        error(
            "narration_record_failed",
            "Não foi possível converter o áudio gravado para WAV.",
        )
    })?;
    let pcm = try_parse_wav(&bytes).ok_or_else(|| {
        error(
            "narration_record_failed",
            "O áudio convertido não resultou em um WAV PCM válido.",
        )
    })?;
    Ok(to_mono_resampled(&pcm, TARGET_SAMPLE_RATE))
}

fn draft_wav_path(work_dir: &Path, candidate_id: i64, block_id: i64) -> PathBuf {
    work_dir.join(format!("draft-c{candidate_id}-b{block_id}.wav"))
}

struct VadTrimResult {
    start_idx: usize,
    end_idx: usize,
    first_start_us: i64,
    last_end_us: i64,
    silences_us: Vec<(i64, i64)>,
}

fn trim_with_silero_vad(samples_24k: &[i16], work_dir: &Path) -> Result<VadTrimResult, CoreError> {
    if samples_24k.is_empty() {
        return Err(error(
            "no_speech_detected",
            "Nenhuma fala detectada na gravação.",
        ));
    }
    fs::create_dir_all(work_dir).map_err(|_| {
        error(
            "narration_record_failed",
            "Não foi possível preparar o áudio para o detector de fala.",
        )
    })?;
    let samples_16k = resample_i16_mono(samples_24k, TARGET_SAMPLE_RATE, VAD_SAMPLE_RATE);
    let wav_16k_bytes = encode_pcm_wav_mono(&samples_16k, VAD_SAMPLE_RATE);
    let seq = TEMP_SEQ.fetch_add(1, Ordering::Relaxed);
    let vad_path = work_dir.join(format!("vad-{}-{seq}.wav", std::process::id()));
    write_atomic_bytes(&vad_path, &wav_16k_bytes)?;

    let mut client = match worker::start_worker() {
        Ok(c) => c,
        Err(e) => {
            let _ = fs::remove_file(&vad_path);
            return Err(e);
        }
    };
    let cancel = AtomicBool::new(false);
    let result = client.run(
        "vad",
        json!({ "audio": vad_path, "final": true }),
        &cancel,
        &mut |_| {},
    );
    client.shutdown();
    let _ = fs::remove_file(&vad_path);

    let data = result?;
    let spans = data["spans"].as_array().ok_or_else(|| {
        error(
            "worker_protocol",
            "O worker enviou uma resposta de VAD inválida.",
        )
    })?;
    if spans.is_empty() {
        return Err(error(
            "no_speech_detected",
            "Nenhuma fala detectada na gravação.",
        ));
    }

    let first_start_us = spans
        .first()
        .and_then(|s| s["start_us"].as_i64())
        .ok_or_else(|| error("worker_protocol", "Intervalo de fala inválido no VAD."))?
        .max(0);
    let last_end_us = spans
        .last()
        .and_then(|s| s["end_us"].as_i64())
        .ok_or_else(|| error("worker_protocol", "Intervalo de fala inválido no VAD."))?;
    if last_end_us <= first_start_us {
        return Err(error(
            "no_speech_detected",
            "Nenhuma fala detectada na gravação.",
        ));
    }

    let total = samples_24k.len();
    let total_us = ((total as u128 * 1_000_000) / u128::from(TARGET_SAMPLE_RATE)) as i64;
    let silences_us = crate::narration_cleanup::extract_vad_silences(&data, total_us);
    let start_idx =
        ((first_start_us as u128 * u128::from(TARGET_SAMPLE_RATE)) / 1_000_000) as usize;
    let start_idx = start_idx.min(total.saturating_sub(1));
    let end_idx =
        (last_end_us as u128 * u128::from(TARGET_SAMPLE_RATE)).div_ceil(1_000_000) as usize;
    let end_idx = end_idx.clamp(start_idx + 1, total);

    Ok(VadTrimResult {
        start_idx,
        end_idx,
        first_start_us,
        last_end_us,
        silences_us,
    })
}

fn ensure_not_busy(c: &Connection, candidate_id: i64) -> rusqlite::Result<Result<(), CoreError>> {
    let tts_busy: bool = c.query_row(
        "SELECT EXISTS(
           SELECT 1 FROM narration_jobs n JOIN jobs j ON j.id=n.job_id
           WHERE n.candidate_id=?1 AND j.state IN ('queued','running')
         )",
        [candidate_id],
        |r| r.get(0),
    )?;
    if tts_busy {
        return Ok(Err(error(
            "generation_in_progress",
            "Já há uma operação de Narração em andamento para este Corte.",
        )));
    }
    let align_busy: bool = c.query_row(
        "SELECT EXISTS(
           SELECT 1 FROM narration_align_jobs a JOIN jobs j ON j.id=a.job_id
           WHERE a.candidate_id=?1 AND j.state IN ('queued','running')
         )",
        [candidate_id],
        |r| r.get(0),
    )?;
    if align_busy {
        return Ok(Err(error(
            "generation_in_progress",
            "Já há um alinhamento de Narração em andamento para este Corte.",
        )));
    }
    let import_busy: bool = c.query_row(
        "SELECT EXISTS(
           SELECT 1 FROM narration_import_jobs i JOIN jobs j ON j.id=i.job_id
           WHERE i.candidate_id=?1 AND j.state IN ('queued','running')
         )",
        [candidate_id],
        |r| r.get(0),
    )?;
    if import_busy {
        return Ok(Err(error(
            "generation_in_progress",
            "Já há uma importação de Narração em andamento para este Corte.",
        )));
    }
    Ok(Ok(()))
}

fn load_target_block(candidate_id: i64, block_id: i64) -> Result<(String, i64), CoreError> {
    script::narration_allowed(candidate_id)?;
    let cut = crate::selection::approved_cut(candidate_id)?;
    projects::with_reader(|c| {
        if let Err(e) = ensure_not_busy(c, candidate_id)? {
            return Ok(Err(e));
        }
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
        let Some(block) = latest.blocks.into_iter().find(|b| b.block_id == block_id) else {
            return Ok(Err(error("block_not_found", "Bloco não encontrado.")));
        };
        let version_id = block.version_id.ok_or_else(|| {
            error(
                "script_not_approved",
                "Bloco sem texto aprovado para narrar.",
            )
        });
        let version_id = match version_id {
            Ok(v) => v,
            Err(e) => return Ok(Err(e)),
        };
        let has_text = block
            .narration_text
            .as_deref()
            .is_some_and(|s| !s.trim().is_empty());
        if !has_text {
            return Ok(Err(error(
                "script_not_approved",
                "Bloco sem texto para narrar.",
            )));
        }
        Ok(Ok((
            normalize_language(&latest.language).to_owned(),
            version_id,
        )))
    })?
}

struct RecordTarget<'a> {
    project: &'a Path,
    candidate_id: i64,
    block_id: i64,
    version_id: i64,
    norm_lang: &'a str,
}

struct TrimState {
    trimmed: bool,
    start_us: i64,
    end_us: i64,
}

fn persist_recorded_block(
    target: &RecordTarget<'_>,
    samples_24k: &[i16],
    trim: &TrimState,
    noise_floor: &crate::narration_cleanup::NoiseFloorMeasurement,
    preserve_cleanup_toggle: bool,
) -> Result<(i64, String, crate::tts::narration::WavInfo), CoreError> {
    let rel_path = format!(
        "narrations/c{}/b{}-v{}.wav",
        target.candidate_id, target.block_id, target.version_id
    );
    let out_wav = target.project.join(&rel_path);
    let wav_bytes = encode_pcm_wav_mono(samples_24k, TARGET_SAMPLE_RATE);
    write_atomic_bytes(&out_wav, &wav_bytes)?;
    let info = parse_wav_info(&out_wav)?;
    let model_id = if trim.trimmed {
        MODEL_VAD
    } else {
        MODEL_UNTRIMMED
    };

    let narration_id = projects::with_writer(|c| {
        let tx = c.transaction()?;
        tx.execute(
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
                target.block_id,
                target.version_id,
                VOICE_ID,
                model_id,
                ENGINE_ID,
                &rel_path,
                info.duration_us,
                info.sample_rate,
                info.channels,
                info.bytes,
                &info.sha256,
            ),
        )?;
        let narration_id: i64 = tx.query_row(
            "SELECT id FROM narration_blocks WHERE block_id=?1 AND version_id=?2",
            (target.block_id, target.version_id),
            |r| r.get(0),
        )?;
        tx.execute(
            "INSERT INTO narration_recordings(narration_id, trimmed, trim_start_us, trim_end_us)
             VALUES (?1, ?2, ?3, ?4)
             ON CONFLICT(narration_id) DO UPDATE SET
               trimmed=excluded.trimmed,
               trim_start_us=excluded.trim_start_us,
               trim_end_us=excluded.trim_end_us,
               updated_at=strftime('%Y-%m-%dT%H:%M:%fZ','now')",
            (
                narration_id,
                i64::from(trim.trimmed),
                trim.start_us,
                trim.end_us,
            ),
        )?;
        crate::narration_cleanup::remove_clean_file_for_narration(
            &tx,
            target.project,
            narration_id,
        );
        crate::narration_cleanup::upsert_pending_in(
            &tx,
            narration_id,
            &info.sha256,
            Some(noise_floor),
            preserve_cleanup_toggle,
        )?;
        crate::narration_align::mark_pending_in(
            &tx,
            narration_id,
            target.block_id,
            target.version_id,
            &info.sha256,
            target.norm_lang,
        )?;
        tx.commit()?;
        Ok(narration_id)
    })?;

    crate::narration_align::enqueue_after_tts(target.candidate_id, Some(target.block_id));
    Ok((narration_id, rel_path, info))
}

fn block_arg(v: &Value) -> Result<i64, CoreError> {
    v["block"]
        .as_i64()
        .or_else(|| v["blockId"].as_i64())
        .ok_or_else(|| error("block_not_found", "Bloco não encontrado."))
}

/// `narration.record_block { candidate, block, audioBase64, mimeType? }`:
/// normaliza a gravação para WAV PCM 24 kHz mono, apara início/fim com Silero VAD
/// quando o worker está instalado (ou salva sem aparo com aviso) e dispara o alinhamento.
fn cmd_record_block(v: Value, events: &mut EventSink<'_>) -> CommandResult {
    let _guard = projects::start_job()?;
    let candidate_id = crate::selection::candidate_id_arg(&v, "candidate")?;
    let block_id = block_arg(&v)?;
    let project = project_root_dir()?;
    let (norm_lang, version_id) = load_target_block(candidate_id, block_id)?;

    let audio_b64 = v["audioBase64"]
        .as_str()
        .map(str::trim)
        .filter(|s| !s.is_empty())
        .ok_or_else(|| error("invalid_recording_audio", "Áudio gravado ausente."))?;
    let mime = v["mimeType"].as_str();
    let raw_bytes = decode_base64(audio_b64)?;

    let (cache_dir, _, _) = crate::components::cache_settings()?;
    let work_dir = cache_dir.join("narration-record");
    let samples_24k = transcode_to_24k_mono(&raw_bytes, mime, &work_dir)?;
    if samples_24k.is_empty() {
        return Err(error(
            "invalid_recording_audio",
            "O áudio gravado está vazio.",
        ));
    }

    let draft_path = draft_wav_path(&work_dir, candidate_id, block_id);
    let _ = fs::remove_file(&draft_path);

    let (trimmed, slice, trim_start_us, trim_end_us, noise_floor, warning_code, warning) =
        if vad_ready() {
            events(crate::ProgressEvent {
                job: "narration_record".into(),
                project: None,
                stage: "vad".into(),
                percentage: 40,
                message: "Aparando silêncios da gravação".into(),
                error: None,
            });
            match trim_with_silero_vad(&samples_24k, &work_dir) {
                Ok(vad) => {
                    let nf = crate::narration_cleanup::measure_noise_floor_from_silences(
                        &samples_24k,
                        TARGET_SAMPLE_RATE,
                        &vad.silences_us,
                    );
                    (
                        true,
                        &samples_24k[vad.start_idx..vad.end_idx],
                        vad.first_start_us,
                        vad.last_end_us,
                        nf,
                        None,
                        None,
                    )
                }
                Err(err) if err.code == "no_speech_detected" => {
                    let raw_wav = encode_pcm_wav_mono(&samples_24k, TARGET_SAMPLE_RATE);
                    let _ = write_atomic_bytes(&draft_path, &raw_wav);
                    let raw_duration_us = ((samples_24k.len() as u128 * 1_000_000)
                        / u128::from(TARGET_SAMPLE_RATE))
                        as i64;
                    return Err(error_with_usage(
                        "no_speech_detected",
                        "Nenhuma fala detectada na gravação. O áudio anterior foi mantido; descarte ou grave novamente.",
                        json!({ "hasDraft": true, "durationUs": raw_duration_us }),
                    ));
                }
                Err(err) => return Err(err),
            }
        } else {
            let full_us = ((samples_24k.len() as u128 * 1_000_000) / u128::from(TARGET_SAMPLE_RATE))
                .max(1) as i64;
            (
                false,
                samples_24k.as_slice(),
                0,
                full_us,
                crate::narration_cleanup::vad_unavailable_noise_floor(),
                Some("vad_unavailable"),
                Some("Aparo de silêncio indisponível: instale o worker."),
            )
        };

    let (narration_id, rel_path, info) = persist_recorded_block(
        &RecordTarget {
            project: &project,
            candidate_id,
            block_id,
            version_id,
            norm_lang: &norm_lang,
        },
        slice,
        &TrimState {
            trimmed,
            start_us: trim_start_us,
            end_us: trim_end_us,
        },
        &noise_floor,
        false,
    )?;

    events(crate::ProgressEvent {
        job: "narration_record".into(),
        project: None,
        stage: "done".into(),
        percentage: 100,
        message: "Gravação salva".into(),
        error: None,
    });

    Ok(json!({
        "candidate": candidate_id,
        "blockId": block_id,
        "narrationId": narration_id,
        "versionId": version_id,
        "engineId": ENGINE_ID,
        "voiceId": VOICE_ID,
        "modelId": if trimmed { MODEL_VAD } else { MODEL_UNTRIMMED },
        "relPath": rel_path,
        "durationUs": info.duration_us,
        "sampleRate": info.sample_rate,
        "channels": info.channels,
        "bytes": info.bytes,
        "trimmed": trimmed,
        "warningCode": warning_code,
        "warning": warning,
    }))
}

/// `narration.trim_block { candidate, block }`:
/// apara uma gravação salva anteriormente sem aparo quando o worker passa a estar instalado.
fn cmd_trim_block(v: Value, events: &mut EventSink<'_>) -> CommandResult {
    let _guard = projects::start_job()?;
    let candidate_id = crate::selection::candidate_id_arg(&v, "candidate")?;
    let block_id = block_arg(&v)?;
    let project = project_root_dir()?;
    let (norm_lang, version_id) = load_target_block(candidate_id, block_id)?;

    if !vad_ready() {
        return Err(error(
            "worker_missing",
            "Instale o worker de ML em Componentes para aparar os silêncios da gravação.",
        ));
    }

    let row: Option<(String, String)> = projects::with_reader(|c| {
        c.query_row(
            "SELECT engine_id, audio_rel_path FROM narration_blocks WHERE block_id=?1 AND version_id=?2",
            (block_id, version_id),
            |r| Ok((r.get(0)?, r.get(1)?)),
        )
        .optional()
    })?;
    let Some((engine_id, rel_path)) = row else {
        return Err(error(
            "narration_missing",
            "Grave o áudio deste bloco antes de aparar.",
        ));
    };
    if engine_id != ENGINE_ID {
        return Err(error(
            "narration_not_recorded",
            "Apenas gravações de microfone podem ser aparadas com VAD.",
        ));
    }
    let wav_path =
        crate::tts::narration::resolve_rel_path(&project, &rel_path).ok_or_else(|| {
            error(
                "narration_missing",
                "Áudio gravado não encontrado no Projeto.",
            )
        })?;
    let raw_bytes = fs::read(&wav_path).map_err(|_| {
        error(
            "narration_record_failed",
            "Não foi possível ler a gravação do bloco.",
        )
    })?;
    let pcm = try_parse_wav(&raw_bytes).ok_or_else(|| {
        error(
            "narration_record_failed",
            "O arquivo gravado não é um WAV PCM válido.",
        )
    })?;
    let samples_24k = to_mono_resampled(&pcm, TARGET_SAMPLE_RATE);

    let (cache_dir, _, _) = crate::components::cache_settings()?;
    let work_dir = cache_dir.join("narration-record");
    events(crate::ProgressEvent {
        job: "narration_record".into(),
        project: None,
        stage: "vad".into(),
        percentage: 50,
        message: "Aparando silêncios da gravação".into(),
        error: None,
    });
    let vad = trim_with_silero_vad(&samples_24k, &work_dir)?;
    let noise_floor = crate::narration_cleanup::measure_noise_floor_from_silences(
        &samples_24k,
        TARGET_SAMPLE_RATE,
        &vad.silences_us,
    );
    let (narration_id, rel_path, info) = persist_recorded_block(
        &RecordTarget {
            project: &project,
            candidate_id,
            block_id,
            version_id,
            norm_lang: &norm_lang,
        },
        &samples_24k[vad.start_idx..vad.end_idx],
        &TrimState {
            trimmed: true,
            start_us: vad.first_start_us,
            end_us: vad.last_end_us,
        },
        &noise_floor,
        true,
    )?;

    Ok(json!({
        "candidate": candidate_id,
        "blockId": block_id,
        "narrationId": narration_id,
        "versionId": version_id,
        "engineId": ENGINE_ID,
        "voiceId": VOICE_ID,
        "modelId": MODEL_VAD,
        "relPath": rel_path,
        "durationUs": info.duration_us,
        "sampleRate": info.sample_rate,
        "channels": info.channels,
        "bytes": info.bytes,
        "trimmed": true,
    }))
}

/// `narration.discard_draft { candidate, block }`:
/// remove o arquivo temporário de uma gravação recusada (`no_speech_detected`).
fn cmd_discard_draft(v: Value, _: &mut EventSink<'_>) -> CommandResult {
    let candidate_id = crate::selection::candidate_id_arg(&v, "candidate")?;
    let block_id = block_arg(&v)?;
    let (cache_dir, _, _) = crate::components::cache_settings()?;
    let work_dir = cache_dir.join("narration-record");
    let draft = draft_wav_path(&work_dir, candidate_id, block_id);
    let existed = draft.exists();
    if existed {
        let _ = fs::remove_file(&draft);
    }
    Ok(json!({
        "candidate": candidate_id,
        "blockId": block_id,
        "discarded": existed,
    }))
}

inventory::submit! { CommandRegistration { name: "narration.record_block", execute: cmd_record_block } }
inventory::submit! { CommandRegistration { name: "narration.trim_block", execute: cmd_trim_block } }
inventory::submit! { CommandRegistration { name: "narration.discard_draft", execute: cmd_discard_draft } }

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn base64_roundtrip_and_rejects_malformed() {
        // "RIFF" -> "UklGRg==" (actually "RIFF\0\0" etc.)
        assert_eq!(decode_base64("SGVsbG8=").unwrap(), b"Hello");
        assert_eq!(decode_base64("SGVs\n bG8=").unwrap(), b"Hello");
        assert_eq!(
            decode_base64("not!valid").unwrap_err().code,
            "invalid_recording_audio"
        );
        assert_eq!(
            decode_base64("").unwrap_err().code,
            "invalid_recording_audio"
        );
    }

    #[test]
    fn resamples_48k_stereo_pcm_wav_to_24k_mono() {
        // 48 kHz stereo, 0.5 s = 24000 frames
        let sr = 48_000u32;
        let ch = 2u16;
        let frames = 24_000usize;
        let data_bytes = (frames * usize::from(ch) * 2) as u32;
        let mut buf = Vec::with_capacity(44 + data_bytes as usize);
        buf.extend_from_slice(b"RIFF");
        buf.extend_from_slice(&(36 + data_bytes).to_le_bytes());
        buf.extend_from_slice(b"WAVEfmt ");
        buf.extend_from_slice(&16u32.to_le_bytes());
        buf.extend_from_slice(&1u16.to_le_bytes());
        buf.extend_from_slice(&ch.to_le_bytes());
        buf.extend_from_slice(&sr.to_le_bytes());
        buf.extend_from_slice(&(sr * u32::from(ch) * 2).to_le_bytes());
        buf.extend_from_slice(&(ch * 2).to_le_bytes());
        buf.extend_from_slice(&16u16.to_le_bytes());
        buf.extend_from_slice(b"data");
        buf.extend_from_slice(&data_bytes.to_le_bytes());
        for i in 0..frames {
            let s = if i < 12_000 { 1000i16 } else { -1000i16 };
            buf.extend_from_slice(&s.to_le_bytes());
            buf.extend_from_slice(&s.to_le_bytes());
        }

        let parsed = try_parse_wav(&buf).unwrap();
        let mono_24k = to_mono_resampled(&parsed, TARGET_SAMPLE_RATE);
        assert_eq!(mono_24k.len(), 12_000);
        let out_wav = encode_pcm_wav_mono(&mono_24k, TARGET_SAMPLE_RATE);
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("out.wav");
        fs::write(&path, out_wav).unwrap();
        let info = parse_wav_info(&path).unwrap();
        assert_eq!(info.sample_rate, 24_000);
        assert_eq!(info.channels, 1);
        assert_eq!(info.duration_us, 500_000);
    }
}
