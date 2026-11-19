//! Limpeza de voz não destrutiva da Narração gravada (#83) ou importada (#84) (#155).
//!
//! Cadeia padrão: `highpass` (~80 Hz) -> `afftdn` (com compensação da latência de janela do
//! `afftdn` via `apad`/`atrim` para manter 0 ms de deslocamento em relação ao alinhamento #81),
//! usando exclusivamente filtros nativos do Componente FFmpeg (`process::spawn_managed`, sem shell).
//!
//! O WAV original do bloco (`narrations/c<cand>/b<block>-v<ver>.wav`) nunca é alterado; a versão
//! limpa é derivada em `narrations/c<cand>/b<block>-v<ver>.clean.wav` (caminho relativo no SQLite)
//! e ligada por padrão para `engine_id` `'recorded'` e `'imported'` (TTS não passa pela limpeza).

use crate::{
    components::worker,
    narration_record::{
        encode_pcm_wav_mono, resample_i16_mono, to_mono_resampled, try_parse_wav, vad_ready,
        TARGET_SAMPLE_RATE,
    },
    process, projects,
    provider::CancelToken,
    tts::narration::{parse_wav_info, project_root_dir, read_latest_script_in, resolve_rel_path},
    CommandRegistration, CommandResult, CoreError, EventSink,
};
use rusqlite::{Connection, OptionalExtension};
use serde_json::{json, Value};
use std::{
    ffi::OsString,
    fs,
    path::{Path, PathBuf},
    sync::atomic::{AtomicBool, AtomicU64, Ordering},
    time::{Duration, Instant},
};

/// Frequência de corte do filtro passa-alta (remove grave de ventilador e ar-condicionado).
pub const CLEANUP_HIGHPASS_HZ: f64 = 80.0;
/// Redução de ruído nominal aplicada pelo `afftdn` (dB).
pub const CLEANUP_AFFTDN_NR_DB: f64 = 12.0;
/// Piso de ruído padrão (`afftdn nf`, dBFS) quando o VAD está ausente ou há pouco silêncio.
pub const CLEANUP_DEFAULT_NOISE_FLOOR_DB: f64 = -50.0;
/// Limite inferior aceito pelo `afftdn nf` no FFmpeg (dBFS).
pub const CLEANUP_MIN_NOISE_FLOOR_DB: f64 = -80.0;
/// Limite superior aceito pelo `afftdn nf` no FFmpeg (dBFS).
pub const CLEANUP_MAX_NOISE_FLOOR_DB: f64 = -20.0;
/// Folga somada ao RMS pós-passa-alta medido no silêncio para cobrir picos espectrais do ruído.
pub const CLEANUP_NOISE_FLOOR_HEADROOM_DB: f64 = 3.0;
/// Duração mínima acumulada de trechos sem fala para medir o piso de ruído via VAD (200 ms).
pub const CLEANUP_MIN_SILENCE_US: i64 = 200_000;
/// Margem de segurança recortada das bordas entre silêncio e fala ao medir o piso de ruído (20 ms).
pub const CLEANUP_VAD_BOUNDARY_GUARD_US: i64 = 20_000;
/// Latência interna da janela FFT do `afftdn` (25 ms), compensada para preservar o início da fala.
pub const CLEANUP_AFFTDN_LATENCY_S: f64 = 0.025;
/// Janela inicial da fala após o início do VAD verificada pelo harness (50 ms).
pub const CLEANUP_ONSET_WINDOW_US: i64 = 50_000;
/// Perda máxima tolerada na energia do início da fala (primeiros 50 ms) após limpeza (dB).
pub const CLEANUP_ONSET_MAX_LOSS_DB: f64 = 3.0;
/// Redução mínima esperada no ruído de fundo nos trechos sem fala no harness (dB).
pub const CLEANUP_MIN_NOISE_IMPROVEMENT_DB: f64 = 3.0;
/// Tempo máximo para o FFmpeg concluir a limpeza de um bloco.
pub const CLEANUP_TIMEOUT: Duration = Duration::from_secs(120);

const VAD_SAMPLE_RATE: u32 = 16_000;
const ENGINE_RECORDED: &str = "recorded";
const ENGINE_IMPORTED: &str = "imported";
const NOISE_FLOOR_SILENCE_THRESHOLD: f64 = 1e-8;

static TEMP_SEQ: AtomicU64 = AtomicU64::new(1);

inventory::submit! {
    projects::Migration {
        id: "0155_001_narration_cleanup",
        sql: "
CREATE TABLE narration_cleanups (
  narration_id INTEGER PRIMARY KEY REFERENCES narration_blocks(id) ON DELETE CASCADE,
  enabled INTEGER NOT NULL DEFAULT 1 CHECK(enabled IN (0, 1)),
  clean_rel_path TEXT,
  source_sha256 TEXT NOT NULL,
  noise_floor_db REAL,
  noise_floor_source TEXT NOT NULL DEFAULT 'pending' CHECK(noise_floor_source IN ('pending','vad','default')),
  warning_code TEXT,
  warning_message TEXT,
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
INSERT OR IGNORE INTO narration_cleanups(narration_id, enabled, source_sha256, noise_floor_source)
SELECT id, 1, sha256, 'pending'
FROM narration_blocks
WHERE engine_id IN ('recorded', 'imported');
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

/// Retorna `true` apenas para Narração gravada (#83) ou importada (#84); TTS fica fora.
pub fn is_cleanup_engine(engine_id: &str) -> bool {
    matches!(engine_id, ENGINE_RECORDED | ENGINE_IMPORTED)
}

#[derive(Clone, Debug, PartialEq)]
pub struct NoiseFloorMeasurement {
    pub noise_floor_db: f64,
    pub source: &'static str,
    pub warning_code: Option<&'static str>,
    pub warning_message: Option<&'static str>,
}

pub(crate) fn default_noise_floor(
    warning_code: &'static str,
    warning_message: &'static str,
) -> NoiseFloorMeasurement {
    NoiseFloorMeasurement {
        noise_floor_db: CLEANUP_DEFAULT_NOISE_FLOOR_DB,
        source: "default",
        warning_code: Some(warning_code),
        warning_message: Some(warning_message),
    }
}

pub(crate) fn vad_unavailable_noise_floor() -> NoiseFloorMeasurement {
    default_noise_floor(
        "vad_unavailable",
        "Piso de ruído padrão usado: instale o worker para medir o ruído da gravação.",
    )
}

fn insufficient_silence_noise_floor() -> NoiseFloorMeasurement {
    default_noise_floor(
        "insufficient_silence",
        "Trecho sem fala insuficiente para medir o ruído; usando piso padrão.",
    )
}

/// Filtro passa-alta Butterworth de 2ª ordem em `cutoff_hz` (Direct Form II Transposed).
pub fn highpass_biquad(samples: &[i16], sample_rate: u32, cutoff_hz: f64) -> Vec<f64> {
    if samples.is_empty() || sample_rate == 0 || cutoff_hz <= 0.0 {
        return samples.iter().map(|&s| f64::from(s) / 32768.0).collect();
    }
    let w0 = 2.0 * std::f64::consts::PI * cutoff_hz / f64::from(sample_rate);
    let cos_w0 = w0.cos();
    let sin_w0 = w0.sin();
    let alpha = sin_w0 / std::f64::consts::SQRT_2;
    let a0 = 1.0 + alpha;
    let b0 = ((1.0 + cos_w0) / 2.0) / a0;
    let b1 = -(1.0 + cos_w0) / a0;
    let b2 = b0;
    let a1 = (-2.0 * cos_w0) / a0;
    let a2 = (1.0 - alpha) / a0;

    let mut out = Vec::with_capacity(samples.len());
    let mut z1 = 0.0_f64;
    let mut z2 = 0.0_f64;
    for &s in samples {
        let x = f64::from(s) / 32768.0;
        let y = b0 * x + z1;
        z1 = b1 * x - a1 * y + z2;
        z2 = b2 * x - a2 * y;
        out.push(y);
    }
    out
}

/// Extrai os intervalos sem fala `(start_us, end_us)` da resposta do worker `vad`.
/// Usa `data["silences"]` quando preenchido, ou calcula o complemento de `data["spans"]`.
pub(crate) fn extract_vad_silences(data: &Value, total_us: i64) -> Vec<(i64, i64)> {
    if total_us <= 0 {
        return Vec::new();
    }
    if let Some(arr) = data["silences"].as_array() {
        let explicit: Vec<(i64, i64)> = arr
            .iter()
            .filter_map(|s| {
                let a = s["start_us"].as_i64()?.clamp(0, total_us);
                let b = s["end_us"].as_i64()?.clamp(0, total_us);
                (b > a).then_some((a, b))
            })
            .collect();
        if !explicit.is_empty() {
            return explicit;
        }
    }
    let Some(spans) = data["spans"].as_array() else {
        return Vec::new();
    };
    if spans.is_empty() {
        return Vec::new();
    }
    let mut silences = Vec::new();
    let mut cursor = 0_i64;
    for span in spans {
        let Some(start) = span["start_us"].as_i64() else {
            continue;
        };
        let Some(end) = span["end_us"].as_i64() else {
            continue;
        };
        let s = start.clamp(0, total_us);
        let e = end.clamp(0, total_us);
        if s > cursor {
            silences.push((cursor, s));
        }
        cursor = cursor.max(e);
    }
    if total_us > cursor {
        silences.push((cursor, total_us));
    }
    silences
}

/// Mede o piso de ruído (`afftdn nf`, dBFS pós-passa-alta) nos trechos sem fala marcados pelo VAD.
pub fn measure_noise_floor_from_silences(
    samples: &[i16],
    sample_rate: u32,
    silences_us: &[(i64, i64)],
) -> NoiseFloorMeasurement {
    if samples.is_empty() || sample_rate == 0 || silences_us.is_empty() {
        return insufficient_silence_noise_floor();
    }
    let total_us = ((samples.len() as u128 * 1_000_000) / u128::from(sample_rate)) as i64;
    let mut guarded = Vec::new();
    let mut total_silence_us = 0_i64;
    for &(raw_start, raw_end) in silences_us {
        let s = raw_start.clamp(0, total_us);
        let e = raw_end.clamp(0, total_us);
        if e <= s {
            continue;
        }
        // Protege as bordas que encostam em fala para não contaminar o ruído com respiração/ataque.
        let gs = if s > 0 {
            s.saturating_add(CLEANUP_VAD_BOUNDARY_GUARD_US)
        } else {
            s
        };
        let ge = if e < total_us {
            e.saturating_sub(CLEANUP_VAD_BOUNDARY_GUARD_US)
        } else {
            e
        };
        if ge > gs {
            total_silence_us = total_silence_us.saturating_add(ge - gs);
            guarded.push((gs, ge));
        }
    }

    if total_silence_us < CLEANUP_MIN_SILENCE_US || guarded.is_empty() {
        return insufficient_silence_noise_floor();
    }

    let filtered = highpass_biquad(samples, sample_rate, CLEANUP_HIGHPASS_HZ);
    let mut sum_sq = 0.0_f64;
    let mut count = 0_usize;
    for (gs, ge) in guarded {
        let idx0 = ((gs as u128 * u128::from(sample_rate)) / 1_000_000) as usize;
        let idx1 = ((ge as u128 * u128::from(sample_rate)) / 1_000_000) as usize;
        let idx0 = idx0.min(filtered.len());
        let idx1 = idx1.clamp(idx0, filtered.len());
        for &v in &filtered[idx0..idx1] {
            sum_sq += v * v;
            count += 1;
        }
    }

    if count == 0 {
        return insufficient_silence_noise_floor();
    }

    let rms = (sum_sq / count as f64).sqrt();
    let db = if rms <= NOISE_FLOOR_SILENCE_THRESHOLD {
        CLEANUP_MIN_NOISE_FLOOR_DB
    } else {
        (20.0 * rms.log10() + CLEANUP_NOISE_FLOOR_HEADROOM_DB)
            .clamp(CLEANUP_MIN_NOISE_FLOOR_DB, CLEANUP_MAX_NOISE_FLOOR_DB)
    };

    NoiseFloorMeasurement {
        noise_floor_db: db,
        source: "vad",
        warning_code: None,
        warning_message: None,
    }
}

/// Monta a cadeia de filtros FFmpeg para limpeza de voz (`highpass` -> `afftdn` com compensação de latência).
pub fn build_cleanup_filter_chain(noise_floor_db: f64) -> String {
    let nf = if noise_floor_db.is_finite() {
        noise_floor_db.clamp(CLEANUP_MIN_NOISE_FLOOR_DB, CLEANUP_MAX_NOISE_FLOOR_DB)
    } else {
        CLEANUP_DEFAULT_NOISE_FLOOR_DB
    };
    format!(
        "highpass=f={CLEANUP_HIGHPASS_HZ},apad=pad_dur={CLEANUP_AFFTDN_LATENCY_S:.3},afftdn=nr={CLEANUP_AFFTDN_NR_DB}:nf={nf:.2},atrim=start={CLEANUP_AFFTDN_LATENCY_S:.3},asetpts=PTS-STARTPTS"
    )
}

pub fn clean_rel_path_for(audio_rel_path: &str) -> String {
    match audio_rel_path.strip_suffix(".wav") {
        Some(stem) => format!("{stem}.clean.wav"),
        None => format!("{audio_rel_path}.clean.wav"),
    }
}

fn cleanup_ffmpeg_executable() -> Result<PathBuf, CoreError> {
    let ffmpeg = crate::components::cache_settings()?.2.ok_or_else(|| {
        error(
            "ffmpeg_missing",
            "Instale o Componente FFmpeg para limpar o áudio.",
        )
    })?;
    if (ffmpeg.is_absolute() || ffmpeg.components().count() > 1) && !ffmpeg.is_file() {
        return Err(error(
            "ffmpeg_missing",
            "Instale o Componente FFmpeg para limpar o áudio.",
        ));
    }
    Ok(ffmpeg)
}

/// Executa a cadeia de limpeza de voz via FFmpeg do Componente (sem shell) gravando WAV atômico.
/// Retorna a duração resultante em µs.
pub fn run_ffmpeg_cleanup(
    ffmpeg: &Path,
    src_wav: &Path,
    dest_wav: &Path,
    noise_floor_db: f64,
    cancel: Option<&CancelToken>,
) -> Result<i64, CoreError> {
    if cancel.is_some_and(|c| c.is_cancelled()) {
        return Err(error("cancelled", "Limpeza de voz cancelada."));
    }
    if let Some(parent) = dest_wav.parent() {
        fs::create_dir_all(parent).map_err(|_| {
            error(
                "narration_cleanup_failed",
                "Não foi possível preparar a pasta de limpeza da Narração.",
            )
        })?;
    }
    let tmp_wav = dest_wav.with_extension("wav.part");
    let _ = fs::remove_file(&tmp_wav);

    let filter = build_cleanup_filter_chain(noise_floor_db);
    let args: Vec<OsString> = vec![
        "-nostdin".into(),
        "-v".into(),
        "error".into(),
        "-y".into(),
        "-i".into(),
        src_wav.as_os_str().to_owned(),
        "-vn".into(),
        "-af".into(),
        filter.into(),
        "-ac".into(),
        "1".into(),
        "-ar".into(),
        TARGET_SAMPLE_RATE.to_string().into(),
        "-c:a".into(),
        "pcm_s16le".into(),
        "-f".into(),
        "wav".into(),
        tmp_wav.as_os_str().to_owned(),
    ];

    let (mut child, group) = process::spawn_managed(ffmpeg, args).map_err(|_| {
        error(
            "ffmpeg_missing",
            "Não foi possível iniciar o Componente FFmpeg para limpeza de voz.",
        )
    })?;
    let drains: Vec<_> = [
        child
            .stdout
            .take()
            .map(|s| Box::new(s) as Box<dyn std::io::Read + Send>),
        child
            .stderr
            .take()
            .map(|s| Box::new(s) as Box<dyn std::io::Read + Send>),
    ]
    .into_iter()
    .flatten()
    .map(|mut stream| {
        std::thread::spawn(move || drop(std::io::copy(&mut stream, &mut std::io::sink())))
    })
    .collect();

    let start = Instant::now();
    let exec_result = loop {
        if cancel.is_some_and(|c| c.is_cancelled()) {
            group.terminate();
            let _ = child.wait();
            break Err(error("cancelled", "Limpeza de voz cancelada."));
        }
        if start.elapsed() > CLEANUP_TIMEOUT {
            group.terminate();
            let _ = child.wait();
            break Err(error(
                "narration_cleanup_failed",
                "Tempo esgotado ao aplicar a limpeza de voz.",
            ));
        }
        match child.try_wait() {
            Ok(Some(status)) if status.success() => break Ok(()),
            Ok(Some(_)) | Err(_) => {
                break Err(error(
                    "narration_cleanup_failed",
                    "Não foi possível aplicar a limpeza de voz na Narração.",
                ));
            }
            Ok(None) => std::thread::sleep(Duration::from_millis(20)),
        }
    };
    for drain in drains {
        let _ = drain.join();
    }
    if let Err(err) = exec_result {
        let _ = fs::remove_file(&tmp_wav);
        return Err(err);
    }

    let info = parse_wav_info(&tmp_wav).map_err(|_| {
        let _ = fs::remove_file(&tmp_wav);
        error(
            "narration_cleanup_failed",
            "O áudio limpo não resultou em um WAV válido.",
        )
    })?;
    if dest_wav.exists() {
        let _ = fs::remove_file(dest_wav);
    }
    fs::rename(&tmp_wav, dest_wav).map_err(|_| {
        let _ = fs::remove_file(&tmp_wav);
        error(
            "narration_cleanup_failed",
            "Não foi possível salvar o áudio limpo da Narração.",
        )
    })?;
    Ok(info.duration_us)
}

fn measure_wav_noise_floor_via_vad(wav_path: &Path) -> NoiseFloorMeasurement {
    if !vad_ready() {
        return vad_unavailable_noise_floor();
    }
    let Ok(bytes) = fs::read(wav_path) else {
        return insufficient_silence_noise_floor();
    };
    let Some(pcm) = try_parse_wav(&bytes) else {
        return insufficient_silence_noise_floor();
    };
    let samples_24k = to_mono_resampled(&pcm, TARGET_SAMPLE_RATE);
    if samples_24k.is_empty() {
        return insufficient_silence_noise_floor();
    }

    let Ok((cache_dir, _, _)) = crate::components::cache_settings() else {
        return vad_unavailable_noise_floor();
    };
    let work_dir = cache_dir.join("narration-cleanup");
    if fs::create_dir_all(&work_dir).is_err() {
        return insufficient_silence_noise_floor();
    }
    let samples_16k = resample_i16_mono(&samples_24k, TARGET_SAMPLE_RATE, VAD_SAMPLE_RATE);
    let wav_16k = encode_pcm_wav_mono(&samples_16k, VAD_SAMPLE_RATE);
    let seq = TEMP_SEQ.fetch_add(1, Ordering::Relaxed);
    let vad_path = work_dir.join(format!("vad-cleanup-{}-{seq}.wav", std::process::id()));
    if crate::narration_record::write_atomic_bytes(&vad_path, &wav_16k).is_err() {
        let _ = fs::remove_file(&vad_path);
        return insufficient_silence_noise_floor();
    }

    let Ok(mut client) = worker::start_worker() else {
        let _ = fs::remove_file(&vad_path);
        return vad_unavailable_noise_floor();
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

    let Ok(data) = result else {
        return insufficient_silence_noise_floor();
    };
    let total_us =
        ((samples_24k.len() as u128 * 1_000_000) / u128::from(TARGET_SAMPLE_RATE)) as i64;
    let silences = extract_vad_silences(&data, total_us);
    measure_noise_floor_from_silences(&samples_24k, TARGET_SAMPLE_RATE, &silences)
}

/// Remove eventual WAV limpo derivado de `narration_id` antes de sobrescrever o bloco.
pub(crate) fn remove_clean_file_for_narration(c: &Connection, project: &Path, narration_id: i64) {
    let rel: Option<String> = c
        .query_row(
            "SELECT clean_rel_path FROM narration_cleanups WHERE narration_id=?1",
            [narration_id],
            |r| r.get(0),
        )
        .optional()
        .ok()
        .flatten()
        .flatten();
    if let Some(rel_path) = rel {
        if let Some(abs) = resolve_rel_path(project, &rel_path) {
            let _ = fs::remove_file(abs);
        }
    }
}

/// Registra/reinicia o estado de limpeza derivada para Narração gravada ou importada.
pub(crate) fn upsert_pending_in(
    tx: &Connection,
    narration_id: i64,
    source_sha256: &str,
    noise_floor: Option<&NoiseFloorMeasurement>,
    preserve_enabled: bool,
) -> rusqlite::Result<()> {
    let (nf_db, nf_src, warn_code, warn_msg) = match noise_floor {
        Some(m) => (
            Some(m.noise_floor_db),
            m.source,
            m.warning_code,
            m.warning_message,
        ),
        None => (None, "pending", None, None),
    };
    tx.execute(
        "INSERT INTO narration_cleanups(narration_id, enabled, clean_rel_path, source_sha256, noise_floor_db, noise_floor_source, warning_code, warning_message)
         VALUES (?1, 1, NULL, ?2, ?3, ?4, ?5, ?6)
         ON CONFLICT(narration_id) DO UPDATE SET
           enabled=CASE WHEN ?7 THEN narration_cleanups.enabled ELSE 1 END,
           clean_rel_path=NULL,
           source_sha256=excluded.source_sha256,
           noise_floor_db=excluded.noise_floor_db,
           noise_floor_source=excluded.noise_floor_source,
           warning_code=excluded.warning_code,
           warning_message=excluded.warning_message,
           updated_at=strftime('%Y-%m-%dT%H:%M:%fZ','now')",
        (
            narration_id,
            source_sha256,
            nf_db,
            nf_src,
            warn_code,
            warn_msg,
            i64::from(preserve_enabled),
        ),
    )?;
    Ok(())
}

/// Remove metadados e arquivo de limpeza quando o bloco passa a ser TTS (`pocket-tts`).
pub(crate) fn delete_for_tts_in(
    tx: &Connection,
    project: &Path,
    narration_id: i64,
) -> rusqlite::Result<()> {
    remove_clean_file_for_narration(tx, project, narration_id);
    tx.execute(
        "DELETE FROM narration_cleanups WHERE narration_id=?1",
        [narration_id],
    )?;
    Ok(())
}

#[derive(Clone, Debug)]
struct CleanupDbRow {
    enabled: bool,
    clean_rel_path: Option<String>,
    source_sha256: String,
    noise_floor_db: Option<f64>,
    noise_floor_source: String,
    warning_code: Option<String>,
    warning_message: Option<String>,
}

fn read_cleanup_row(c: &Connection, narration_id: i64) -> rusqlite::Result<Option<CleanupDbRow>> {
    c.query_row(
        "SELECT enabled, clean_rel_path, source_sha256, noise_floor_db, noise_floor_source, warning_code, warning_message
         FROM narration_cleanups WHERE narration_id=?1",
        [narration_id],
        |r| {
            Ok(CleanupDbRow {
                enabled: r.get::<_, i64>(0)? != 0,
                clean_rel_path: r.get(1)?,
                source_sha256: r.get(2)?,
                noise_floor_db: r.get(3)?,
                noise_floor_source: r.get(4)?,
                warning_code: r.get(5)?,
                warning_message: r.get(6)?,
            })
        },
    )
    .optional()
}

/// Serializa o bloco `cleanup` para `narration.get` (`Value::Null` para TTS).
pub(crate) fn read_cleanup_json(
    c: &Connection,
    project: &Path,
    narration_id: i64,
    engine_id: &str,
    block_sha256: &str,
) -> rusqlite::Result<Value> {
    if !is_cleanup_engine(engine_id) {
        return Ok(Value::Null);
    }
    let row = read_cleanup_row(c, narration_id)?;
    let (enabled, ready, noise_floor_db, noise_floor_source, warning_code, warning) = match row {
        Some(r) => {
            let ready = r.source_sha256 == block_sha256
                && r.clean_rel_path
                    .as_deref()
                    .and_then(|rel| resolve_rel_path(project, rel))
                    .is_some();
            (
                r.enabled,
                ready,
                r.noise_floor_db,
                r.noise_floor_source,
                r.warning_code,
                r.warning_message,
            )
        }
        None => (true, false, None, "pending".to_owned(), None, None),
    };
    Ok(json!({
        "applicable": true,
        "enabled": enabled,
        "ready": ready,
        "noiseFloorDb": noise_floor_db,
        "noiseFloorSource": noise_floor_source,
        "warningCode": warning_code,
        "warning": warning,
    }))
}

#[derive(Clone, Debug)]
pub(crate) struct PreparedCleanup {
    pub path: PathBuf,
    pub duration_us: i64,
    pub rel_path: String,
    pub enabled: bool,
    pub noise_floor_db: f64,
    pub noise_floor_source: String,
    pub warning_code: Option<String>,
    pub warning_message: Option<String>,
}

/// Garante que o arquivo limpo derivado exista para `narration_id`, gerando via FFmpeg se pendente.
pub(crate) fn ensure_cleaned_for_narration(
    project: &Path,
    narration_id: i64,
    ffmpeg: &Path,
    cancel: Option<&CancelToken>,
) -> Result<PreparedCleanup, CoreError> {
    let (engine_id, audio_rel_path, block_sha256, block_duration_us, row) =
        projects::with_reader(|c| {
            let block: Option<(String, String, String, i64)> = c
                .query_row(
                    "SELECT engine_id, audio_rel_path, sha256, duration_us FROM narration_blocks WHERE id=?1",
                    [narration_id],
                    |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?, r.get(3)?)),
                )
                .optional()?;
            let row = read_cleanup_row(c, narration_id)?;
            Ok((block, row))
        })
        .map(|(b, r)| {
            b.map(|(e, rel, sha, dur)| (e, rel, sha, dur, r))
                .ok_or_else(|| error("narration_missing", "Áudio da Narração não encontrado."))
        })??;

    if !is_cleanup_engine(&engine_id) {
        return Err(error(
            "cleanup_not_applicable",
            "A limpeza de voz só se aplica a Narração gravada ou importada.",
        ));
    }
    let orig_abs = resolve_rel_path(project, &audio_rel_path).ok_or_else(|| {
        error(
            "narration_missing",
            "Áudio da Narração não encontrado no Projeto.",
        )
    })?;

    let enabled = row.as_ref().is_none_or(|r| r.enabled);
    let target_clean_rel = clean_rel_path_for(&audio_rel_path);
    let existing_fresh = row.as_ref().is_some_and(|r| {
        r.source_sha256 == block_sha256
            && r.noise_floor_source != "pending"
            && r.clean_rel_path.as_deref() == Some(target_clean_rel.as_str())
            && resolve_rel_path(project, &target_clean_rel).is_some()
    });
    let can_upgrade_imported_vad = engine_id == ENGINE_IMPORTED
        && row
            .as_ref()
            .is_some_and(|r| r.warning_code.as_deref() == Some("vad_unavailable"))
        && vad_ready();

    if existing_fresh && !can_upgrade_imported_vad {
        let r = row.unwrap();
        let clean_abs = resolve_rel_path(project, &target_clean_rel).unwrap();
        let dur = parse_wav_info(&clean_abs)
            .map(|i| i.duration_us)
            .unwrap_or(block_duration_us);
        return Ok(PreparedCleanup {
            path: clean_abs,
            duration_us: dur,
            rel_path: target_clean_rel,
            enabled,
            noise_floor_db: r.noise_floor_db.unwrap_or(CLEANUP_DEFAULT_NOISE_FLOOR_DB),
            noise_floor_source: r.noise_floor_source,
            warning_code: r.warning_code,
            warning_message: r.warning_message,
        });
    }

    let (nf_db, nf_src, warn_code, warn_msg) = match &row {
        Some(r)
            if r.source_sha256 == block_sha256
                && r.noise_floor_source != "pending"
                && !can_upgrade_imported_vad =>
        {
            (
                r.noise_floor_db.unwrap_or(CLEANUP_DEFAULT_NOISE_FLOOR_DB),
                r.noise_floor_source.clone(),
                r.warning_code.clone(),
                r.warning_message.clone(),
            )
        }
        _ => {
            let m = measure_wav_noise_floor_via_vad(&orig_abs);
            (
                m.noise_floor_db,
                m.source.to_owned(),
                m.warning_code.map(str::to_owned),
                m.warning_message.map(str::to_owned),
            )
        }
    };

    let dest_abs = project.join(&target_clean_rel);
    let duration_us = run_ffmpeg_cleanup(ffmpeg, &orig_abs, &dest_abs, nf_db, cancel)?;

    projects::with_writer(|c| {
        c.execute(
            "INSERT INTO narration_cleanups(narration_id, enabled, clean_rel_path, source_sha256, noise_floor_db, noise_floor_source, warning_code, warning_message)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)
             ON CONFLICT(narration_id) DO UPDATE SET
               clean_rel_path=excluded.clean_rel_path,
               source_sha256=excluded.source_sha256,
               noise_floor_db=excluded.noise_floor_db,
               noise_floor_source=excluded.noise_floor_source,
               warning_code=excluded.warning_code,
               warning_message=excluded.warning_message,
               updated_at=strftime('%Y-%m-%dT%H:%M:%fZ','now')",
            (
                narration_id,
                i64::from(enabled),
                &target_clean_rel,
                &block_sha256,
                nf_db,
                &nf_src,
                warn_code.as_deref(),
                warn_msg.as_deref(),
            ),
        )?;
        Ok(())
    })?;

    Ok(PreparedCleanup {
        path: dest_abs,
        duration_us,
        rel_path: target_clean_rel,
        enabled,
        noise_floor_db: nf_db,
        noise_floor_source: nf_src,
        warning_code: warn_code,
        warning_message: warn_msg,
    })
}

/// Resolve o caminho a usar no export (#82 -> #63): se a limpeza estiver ligada para
/// `recorded`/`imported`, gera (se pendente) e devolve o WAV limpo; caso contrário devolve o original.
pub(crate) fn resolve_export_audio_path(
    project: &Path,
    narration_id: i64,
    original_abs: &Path,
    original_duration_us: i64,
    ffmpeg: &Path,
    cancel: Option<&CancelToken>,
) -> Result<(PathBuf, i64), CoreError> {
    let info: Option<(String, bool)> = projects::with_reader(|c| {
        c.query_row(
            "SELECT nb.engine_id, COALESCE(nc.enabled, 1)
             FROM narration_blocks nb
             LEFT JOIN narration_cleanups nc ON nc.narration_id=nb.id
             WHERE nb.id=?1",
            [narration_id],
            |r| Ok((r.get(0)?, r.get::<_, i64>(1)? != 0)),
        )
        .optional()
    })?;
    let Some((engine_id, enabled)) = info else {
        return Ok((original_abs.to_path_buf(), original_duration_us));
    };
    if !is_cleanup_engine(&engine_id) || !enabled {
        return Ok((original_abs.to_path_buf(), original_duration_us));
    }
    let prepared = ensure_cleaned_for_narration(project, narration_id, ffmpeg, cancel)?;
    Ok((prepared.path, prepared.duration_us))
}

struct ActiveMediaRow {
    engine_id: String,
    orig_rel: String,
    block_sha: String,
    enabled: Option<bool>,
    clean_rel: Option<String>,
    clean_sha: Option<String>,
}

/// Caminho ativo servido por `narration/<id>` em `media.rs`:
/// devolve o WAV limpo quando aplicável, habilitado e já gerado; senão o original.
pub(crate) fn media_active_audio_path(narration_id: i64) -> Option<PathBuf> {
    let project = project_root_dir().ok()?;
    let row = projects::with_reader(|c| {
        c.query_row(
            "SELECT nb.engine_id, nb.audio_rel_path, nb.sha256, nc.enabled, nc.clean_rel_path, nc.source_sha256
             FROM narration_blocks nb
             LEFT JOIN narration_cleanups nc ON nc.narration_id=nb.id
             WHERE nb.id=?1",
            [narration_id],
            |r| {
                Ok(ActiveMediaRow {
                    engine_id: r.get(0)?,
                    orig_rel: r.get(1)?,
                    block_sha: r.get(2)?,
                    enabled: r.get::<_, Option<i64>>(3)?.map(|v| v != 0),
                    clean_rel: r.get(4)?,
                    clean_sha: r.get(5)?,
                })
            },
        )
        .optional()
    })
    .ok()
    .flatten()?;
    if is_cleanup_engine(&row.engine_id)
        && row.enabled.unwrap_or(true)
        && row.clean_sha.as_deref() == Some(row.block_sha.as_str())
    {
        if let Some(clean_path) = row
            .clean_rel
            .as_deref()
            .and_then(|rel| resolve_rel_path(&project, rel))
        {
            return Some(clean_path);
        }
    }
    resolve_rel_path(&project, &row.orig_rel)
}

/// Caminho exclusivo do WAV limpo para a prévia "Depois" (`narration-clean/<id>` em `media.rs`).
pub(crate) fn media_clean_audio_path(narration_id: i64) -> Option<PathBuf> {
    let project = project_root_dir().ok()?;
    let row: Option<(String, String, Option<String>, Option<String>)> =
        projects::with_reader(|c| {
            c.query_row(
                "SELECT nb.engine_id, nb.sha256, nc.clean_rel_path, nc.source_sha256
             FROM narration_blocks nb
             LEFT JOIN narration_cleanups nc ON nc.narration_id=nb.id
             WHERE nb.id=?1",
                [narration_id],
                |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?, r.get(3)?)),
            )
            .optional()
        })
        .ok()
        .flatten();
    let (engine_id, block_sha, clean_rel, clean_sha) = row?;
    if !is_cleanup_engine(&engine_id) || clean_sha.as_deref() != Some(block_sha.as_str()) {
        return None;
    }
    clean_rel
        .as_deref()
        .and_then(|rel| resolve_rel_path(&project, rel))
}

fn block_arg(v: &Value) -> Result<i64, CoreError> {
    v["block"]
        .as_i64()
        .or_else(|| v["blockId"].as_i64())
        .ok_or_else(|| error("block_not_found", "Bloco não encontrado."))
}

fn resolve_current_narration_block(
    candidate_id: i64,
    block_id: i64,
) -> Result<(i64, String, String), CoreError> {
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
        let Some(block) = latest.blocks.into_iter().find(|b| b.block_id == block_id) else {
            return Ok(Err(error("block_not_found", "Bloco não encontrado.")));
        };
        let Some(version_id) = block.version_id else {
            return Ok(Err(error(
                "narration_missing",
                "Este bloco ainda não tem áudio.",
            )));
        };
        let row: Option<(i64, String, String)> = c
            .query_row(
                "SELECT id, engine_id, sha256 FROM narration_blocks WHERE block_id=?1 AND version_id=?2",
                (block_id, version_id),
                |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?)),
            )
            .optional()?;
        Ok(row.ok_or_else(|| error("narration_missing", "Este bloco ainda não tem áudio.")))
    })?
}

/// `narration.cleanup.set { candidate, block, enabled }`: liga ou desliga a limpeza de voz do bloco.
fn cmd_cleanup_set(v: Value, _: &mut EventSink<'_>) -> CommandResult {
    let candidate_id = crate::selection::candidate_id_arg(&v, "candidate")?;
    let block_id = block_arg(&v)?;
    let enabled = v["enabled"].as_bool().ok_or_else(|| {
        error(
            "invalid_cleanup_state",
            "Informe se a limpeza deve ficar ligada ou desligada.",
        )
    })?;
    let project = project_root_dir()?;
    let (narration_id, engine_id, block_sha256) =
        resolve_current_narration_block(candidate_id, block_id)?;
    if !is_cleanup_engine(&engine_id) {
        return Err(error(
            "cleanup_not_applicable",
            "A limpeza de voz só se aplica a Narração gravada ou importada.",
        ));
    }

    projects::with_writer(|c| {
        c.execute(
            "INSERT INTO narration_cleanups(narration_id, enabled, source_sha256, noise_floor_source)
             VALUES (?1, ?2, ?3, 'pending')
             ON CONFLICT(narration_id) DO UPDATE SET
               enabled=excluded.enabled,
               updated_at=strftime('%Y-%m-%dT%H:%M:%fZ','now')",
            (narration_id, i64::from(enabled), &block_sha256),
        )?;
        Ok(())
    })?;

    let cleanup = projects::with_reader(|c| {
        read_cleanup_json(c, &project, narration_id, &engine_id, &block_sha256)
    })?;
    Ok(json!({
        "candidate": candidate_id,
        "blockId": block_id,
        "narrationId": narration_id,
        "cleanup": cleanup,
    }))
}

/// `narration.cleanup.prepare { candidate, block }`: gera a versão limpa derivada para prévia antes/depois.
fn cmd_cleanup_prepare(v: Value, _: &mut EventSink<'_>) -> CommandResult {
    let _guard = projects::start_job()?;
    let candidate_id = crate::selection::candidate_id_arg(&v, "candidate")?;
    let block_id = block_arg(&v)?;
    let project = project_root_dir()?;
    let (narration_id, engine_id, _) = resolve_current_narration_block(candidate_id, block_id)?;
    if !is_cleanup_engine(&engine_id) {
        return Err(error(
            "cleanup_not_applicable",
            "A limpeza de voz só se aplica a Narração gravada ou importada.",
        ));
    }

    let ffmpeg = cleanup_ffmpeg_executable()?;
    let prepared = ensure_cleaned_for_narration(&project, narration_id, &ffmpeg, None)?;
    Ok(json!({
        "candidate": candidate_id,
        "blockId": block_id,
        "narrationId": narration_id,
        "enabled": prepared.enabled,
        "ready": true,
        "cleanRelPath": prepared.rel_path,
        "durationUs": prepared.duration_us,
        "noiseFloorDb": prepared.noise_floor_db,
        "noiseFloorSource": prepared.noise_floor_source,
        "warningCode": prepared.warning_code,
        "warning": prepared.warning_message,
    }))
}

inventory::submit! { CommandRegistration { name: "narration.cleanup.set", execute: cmd_cleanup_set } }
inventory::submit! { CommandRegistration { name: "narration.cleanup.prepare", execute: cmd_cleanup_prepare } }

#[cfg(test)]
mod tests {
    use super::*;

    fn sine_i16(freq_hz: f64, amplitude: f64, sample_rate: u32, frames: usize) -> Vec<i16> {
        (0..frames)
            .map(|i| {
                let t = i as f64 / f64::from(sample_rate);
                let v = (2.0 * std::f64::consts::PI * freq_hz * t).sin() * amplitude * 32767.0;
                v.round().clamp(-32768.0, 32767.0) as i16
            })
            .collect()
    }

    #[test]
    fn highpass_biquad_attenuates_60hz_hum_and_preserves_voice_band() {
        let sr = 24_000;
        let low = sine_i16(50.0, 0.25, sr, 24_000);
        let voice = sine_i16(300.0, 0.25, sr, 24_000);
        let hp_low = highpass_biquad(&low, sr, CLEANUP_HIGHPASS_HZ);
        let hp_voice = highpass_biquad(&voice, sr, CLEANUP_HIGHPASS_HZ);

        let rms = |slice: &[f64]| -> f64 {
            (slice.iter().map(|v| v * v).sum::<f64>() / slice.len() as f64).sqrt()
        };
        let low_db = 20.0 * rms(&hp_low[4_800..]).log10();
        let voice_db = 20.0 * rms(&hp_voice[4_800..]).log10();
        let raw_db = 20.0 * (0.25_f64 / std::f64::consts::SQRT_2).log10();
        assert!(
            low_db < raw_db - 8.0,
            "50 Hz deveria cair > 8 dB: raw={raw_db:.2}, hp={low_db:.2}"
        );
        assert!(
            (voice_db - raw_db).abs() < 0.5,
            "300 Hz deveria manter energia: raw={raw_db:.2}, hp={voice_db:.2}"
        );
    }

    #[test]
    fn measures_noise_floor_from_vad_silences_and_falls_back_when_insufficient() {
        let sr = 24_000;
        // 0..0.6s ruído ~ -40 dBFS, 0.6..1.6s fala ~ -12 dBFS, 1.6..2.0s ruído
        let mut samples = vec![0_i16; 48_000];
        for (i, s) in samples.iter_mut().enumerate() {
            let t = i as f64 / f64::from(sr);
            let noise = (2.0 * std::f64::consts::PI * 220.0 * t).sin() * 0.014;
            let speech = if (14_400..38_400).contains(&i) {
                (2.0 * std::f64::consts::PI * 440.0 * t).sin() * 0.30
            } else {
                0.0
            };
            *s = ((noise + speech) * 32767.0).round() as i16;
        }

        let measured = measure_noise_floor_from_silences(
            &samples,
            sr,
            &[(0, 600_000), (1_600_000, 2_000_000)],
        );
        assert_eq!(measured.source, "vad");
        assert_eq!(measured.warning_code, None);
        // RMS(0.014) = 0.014/sqrt(2) ≈ -40.1 dBFS, + 3 dB headroom ≈ -37.1 dBFS
        assert!(
            (measured.noise_floor_db - (-37.1)).abs() < 1.5,
            "noise_floor_db inesperado: {}",
            measured.noise_floor_db
        );

        let short = measure_noise_floor_from_silences(&samples, sr, &[(0, 100_000)]);
        assert_eq!(short.source, "default");
        assert_eq!(short.noise_floor_db, CLEANUP_DEFAULT_NOISE_FLOOR_DB);
        assert_eq!(short.warning_code, Some("insufficient_silence"));
    }

    #[test]
    fn cleanup_filter_chain_clamps_noise_floor_and_excludes_tts() {
        assert!(is_cleanup_engine("recorded"));
        assert!(is_cleanup_engine("imported"));
        assert!(!is_cleanup_engine("pocket-tts"));

        let low = build_cleanup_filter_chain(-120.0);
        assert!(low.contains("highpass=f=80"));
        assert!(low.contains("nf=-80.00"));

        let high = build_cleanup_filter_chain(-5.0);
        assert!(high.contains("nf=-20.00"));
    }
}
