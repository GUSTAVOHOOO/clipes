//! Importação de áudio externo de Narração por bloco (#84).
//!
//! Aceita WAV, MP3, M4A e OGG por bloco do Roteiro aprovado (`script::narration_allowed`),
//! valida tamanho (<= 200 MiB), extensão, stream/codec (`pcm_*`, `mp3`, `aac`, `alac`,
//! `flac`, `vorbis`, `opus`) e duração (300 ms a 10 min) via `ffprobe`, converte com o
//! FFmpeg do Componente (sem shell) para o formato padrão da Narração (WAV PCM s16le,
//! 24000 Hz, mono), grava em `narrations/c<candidate>/b<block>-v<version>.wav` (caminho
//! relativo no SQLite) e dispara o alinhamento por palavra (#81).

use crate::{
    components::ffprobe_executable,
    jobs::{self, preview, Safety},
    process, projects, script,
    tts::narration::{parse_wav_info, read_latest_script_in},
    CommandRegistration, CommandResult, CoreError, EventSink,
};
use rusqlite::{Connection, OptionalExtension};
use serde_json::{json, Value};
use std::{
    ffi::OsStr,
    fs,
    io::Read,
    path::{Path, PathBuf},
    sync::atomic::AtomicBool,
    time::{Duration, Instant},
};

pub const JOB_KIND: &str = "narration_import";
pub const ENGINE_ID: &str = "imported";
pub const VOICE_ID: &str = "imported";
pub const MODEL_ID: &str = "external";

/// Limite máximo de tamanho do arquivo importado: 200 MiB.
pub const MAX_IMPORT_BYTES: u64 = 200 * 1024 * 1024;
/// Duração mínima aceita por bloco: 300 ms em µs.
pub const MIN_IMPORT_DURATION_US: i64 = 300_000;
/// Duração máxima aceita por bloco: 10 min em µs.
pub const MAX_IMPORT_DURATION_US: i64 = 600_000_000;
/// Formato padrão da Narração no Projeto (idêntico à saída do Pocket TTS).
pub const STANDARD_SAMPLE_RATE: u32 = 24_000;
pub const STANDARD_CHANNELS: u16 = 1;

pub const SUPPORTED_EXTENSIONS: [&str; 4] = ["wav", "mp3", "m4a", "ogg"];
const PROBE_TIMEOUT: Duration = Duration::from_secs(30);
const CONVERT_TIMEOUT: Duration = Duration::from_secs(180);

inventory::submit! {
    projects::Migration {
        id: "0084_001_narration_import",
        sql: "
CREATE TABLE narration_import_jobs (
  job_id INTEGER PRIMARY KEY REFERENCES jobs(id) ON DELETE CASCADE,
  candidate_id INTEGER NOT NULL,
  block_id INTEGER NOT NULL,
  source_path TEXT NOT NULL,
  warning TEXT
);
CREATE INDEX narration_import_jobs_candidate ON narration_import_jobs(candidate_id, job_id);
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
pub struct ProbeValidation {
    pub codec_name: String,
    pub duration_us: i64,
    pub multiple_audio_streams: bool,
}

pub fn is_supported_extension(path: &Path) -> bool {
    path.extension()
        .and_then(|e| e.to_str())
        .map(str::to_ascii_lowercase)
        .is_some_and(|ext| SUPPORTED_EXTENSIONS.contains(&ext.as_str()))
}

pub fn is_supported_audio_codec(codec: &str) -> bool {
    let c = codec.trim().to_ascii_lowercase();
    c.starts_with("pcm_")
        || matches!(
            c.as_str(),
            "mp3" | "aac" | "alac" | "flac" | "vorbis" | "opus"
        )
}

fn parse_duration_us(v: &Value) -> Option<i64> {
    let sec = v
        .as_str()
        .and_then(|s| s.trim().parse::<f64>().ok())
        .or_else(|| v.as_f64())?;
    if !sec.is_finite() || sec <= 0.0 || sec >= (i64::MAX as f64 / 1_000_000.0) {
        return None;
    }
    Some((sec * 1_000_000.0).round() as i64)
}

/// Valida os metadados retornados pelo `ffprobe` sem expor caminhos pessoais.
pub fn validate_probe_metadata(probe: &Value) -> Result<ProbeValidation, CoreError> {
    let streams = probe["streams"].as_array().ok_or_else(|| {
        error(
            "import_invalid_audio",
            "Metadados inválidos no arquivo de áudio.",
        )
    })?;
    let audio_streams: Vec<&Value> = streams
        .iter()
        .filter(|s| s["codec_type"].as_str() == Some("audio"))
        .collect();
    if audio_streams.is_empty() {
        return Err(error(
            "import_no_audio_stream",
            "O arquivo não contém faixa de áudio.",
        ));
    }

    let multiple_audio_streams = audio_streams.len() > 1;
    let first = audio_streams[0];
    let codec_name = first["codec_name"]
        .as_str()
        .map(str::trim)
        .map(str::to_ascii_lowercase)
        .filter(|s| !s.is_empty())
        .ok_or_else(|| {
            error(
                "import_unsupported_codec",
                "Codec de áudio não identificado.",
            )
        })?;
    if !is_supported_audio_codec(&codec_name) {
        return Err(error(
            "import_unsupported_codec",
            "Codec de áudio não suportado. Use WAV, MP3, M4A ou OGG.",
        ));
    }

    let duration_us = parse_duration_us(&first["duration"])
        .or_else(|| parse_duration_us(&probe["format"]["duration"]))
        .ok_or_else(|| {
            error(
                "import_invalid_audio",
                "Não foi possível determinar a duração do áudio.",
            )
        })?;
    validate_duration_bounds(duration_us)?;

    Ok(ProbeValidation {
        codec_name,
        duration_us,
        multiple_audio_streams,
    })
}

fn validate_duration_bounds(duration_us: i64) -> Result<(), CoreError> {
    if duration_us < MIN_IMPORT_DURATION_US {
        return Err(error(
            "import_duration_too_short",
            "O áudio importado deve ter pelo menos 0,3 segundos.",
        ));
    }
    if duration_us > MAX_IMPORT_DURATION_US {
        return Err(error(
            "import_duration_too_long",
            "O áudio importado ultrapassa o limite de 10 minutos por bloco.",
        ));
    }
    Ok(())
}

fn configured_ffmpeg_and_probe() -> Result<(PathBuf, PathBuf), CoreError> {
    let ffmpeg = crate::components::cache_settings()?
        .2
        .ok_or_else(|| error("component_missing", "Instale o Componente FFmpeg."))?;
    if (ffmpeg.is_absolute() || ffmpeg.components().count() > 1) && !ffmpeg.is_file() {
        return Err(error("component_missing", "Instale o Componente FFmpeg."));
    }
    let ffprobe = match std::env::var_os("CLIPES_FFPROBE") {
        Some(p) => PathBuf::from(p),
        None => ffprobe_executable(Some(&ffmpeg))?,
    };
    Ok((ffmpeg, ffprobe))
}

fn validate_input_file(raw_path: &str) -> Result<PathBuf, CoreError> {
    let trimmed = raw_path.trim();
    if trimmed.is_empty() {
        return Err(error(
            "invalid_audio_path",
            "Selecione um arquivo de áudio válido.",
        ));
    }
    let path = PathBuf::from(trimmed);
    let meta = fs::metadata(&path)
        .map_err(|_| error("import_file_missing", "Arquivo de áudio não encontrado."))?;
    if !meta.is_file() {
        return Err(error(
            "import_file_missing",
            "Arquivo de áudio não encontrado.",
        ));
    }
    if !is_supported_extension(&path) {
        return Err(error(
            "import_unsupported_format",
            "Formato de áudio não suportado. Use WAV, MP3, M4A ou OGG.",
        ));
    }
    if meta.len() == 0 {
        return Err(error("import_empty_file", "O arquivo de áudio está vazio."));
    }
    if meta.len() > MAX_IMPORT_BYTES {
        return Err(error(
            "import_file_too_large",
            "O arquivo de áudio ultrapassa o limite de 200 MiB.",
        ));
    }
    path.canonicalize()
        .map_err(|_| error("import_file_missing", "Arquivo de áudio não encontrado."))
}

pub(crate) fn read_import_job_json(
    c: &Connection,
    candidate_id: i64,
) -> rusqlite::Result<(bool, Value)> {
    let row = c
        .query_row(
            "SELECT j.id, j.state, j.progress, json_extract(j.result,'$.code'), i.block_id, i.warning
             FROM narration_import_jobs i JOIN jobs j ON j.id=i.job_id
             WHERE i.candidate_id=?1
             ORDER BY j.id DESC LIMIT 1",
            [candidate_id],
            |r| {
                Ok((
                    r.get::<_, i64>(0)?,
                    r.get::<_, String>(1)?,
                    r.get::<_, i64>(2)?,
                    r.get::<_, Option<String>>(3)?,
                    r.get::<_, i64>(4)?,
                    r.get::<_, Option<String>>(5)?,
                ))
            },
        )
        .optional()?;
    match row {
        Some((id, state, progress, code, block_id, warning)) => {
            let busy = matches!(state.as_str(), "queued" | "running");
            Ok((
                busy,
                json!({
                    "id": id,
                    "state": state,
                    "progress": progress,
                    "code": code,
                    "blockId": block_id,
                    "warning": warning,
                }),
            ))
        }
        None => Ok((false, Value::Null)),
    }
}

fn cmd_import(v: Value, _: &mut EventSink<'_>) -> CommandResult {
    let candidate_id = crate::selection::candidate_id_arg(&v, "candidate")?;
    let block_id = v["block"]
        .as_i64()
        .or_else(|| v["blockId"].as_i64())
        .ok_or_else(|| error("block_not_found", "Bloco não encontrado."))?;
    let raw_path = v["path"].as_str().ok_or_else(|| {
        error(
            "invalid_audio_path",
            "Selecione um arquivo de áudio válido.",
        )
    })?;

    script::narration_allowed(candidate_id)?;
    let cut = crate::selection::approved_cut(candidate_id)?;
    let latest = projects::with_reader(|c| read_latest_script_in(c, &cut))??
        .ok_or_else(|| error("script_not_approved", "Nenhum Roteiro aprovado encontrado."))?;
    let block = latest
        .blocks
        .iter()
        .find(|b| b.block_id == block_id)
        .ok_or_else(|| error("block_not_found", "Bloco não encontrado."))?;
    if block.version_id.is_none()
        || block
            .narration_text
            .as_deref()
            .is_none_or(|s| s.trim().is_empty())
    {
        return Err(error(
            "script_not_approved",
            "Bloco sem texto aprovado para narrar.",
        ));
    }

    let source_path = validate_input_file(raw_path)?;
    let _ = configured_ffmpeg_and_probe()?;

    let (import_busy, tts_busy): (bool, bool) = projects::with_reader(|c| {
        let imp: bool = c.query_row(
            "SELECT EXISTS(
               SELECT 1 FROM narration_import_jobs i JOIN jobs j ON j.id=i.job_id
               WHERE i.candidate_id=?1 AND j.state IN ('queued','running')
             )",
            [candidate_id],
            |r| r.get(0),
        )?;
        let tts: bool = c.query_row(
            "SELECT EXISTS(
               SELECT 1 FROM narration_jobs n JOIN jobs j ON j.id=n.job_id
               WHERE n.candidate_id=?1 AND j.state IN ('queued','running')
             )",
            [candidate_id],
            |r| r.get(0),
        )?;
        Ok((imp, tts))
    })?;
    if import_busy {
        return Err(error(
            "import_in_progress",
            "Já há uma importação de áudio em andamento para este Corte.",
        ));
    }
    if tts_busy {
        return Err(error(
            "generation_in_progress",
            "Já há uma geração de Narração em andamento para este Corte.",
        ));
    }

    let job_id = jobs::enqueue(JOB_KIND, Safety::Local)?;
    projects::with_writer(|c| {
        c.execute(
            "INSERT INTO narration_import_jobs(job_id, candidate_id, block_id, source_path)
             VALUES (?1, ?2, ?3, ?4)",
            (
                job_id,
                candidate_id,
                block_id,
                source_path.to_string_lossy().as_ref(),
            ),
        )?;
        Ok(())
    })?;

    Ok(json!({
        "job": job_id,
        "candidate": candidate_id,
        "blockId": block_id,
    }))
}

fn probe_audio_file(
    ffprobe: &Path,
    source_path: &Path,
    job_id: i64,
    stop: &AtomicBool,
) -> Result<ProbeValidation, CoreError> {
    let args = [
        OsStr::new("-v"),
        OsStr::new("error"),
        OsStr::new("-show_format"),
        OsStr::new("-show_streams"),
        OsStr::new("-of"),
        OsStr::new("json"),
        source_path.as_os_str(),
    ];
    let (mut child, group) = process::spawn_managed(ffprobe, args).map_err(|_| {
        error(
            "ffprobe_missing",
            "ffprobe indisponível; verifique os Componentes.",
        )
    })?;
    let stdout_thread = child.stdout.take().map(|mut s| {
        std::thread::spawn(move || {
            let mut buf = Vec::new();
            let _ = s.read_to_end(&mut buf);
            buf
        })
    });
    let stderr_thread = child.stderr.take().map(|mut s| {
        std::thread::spawn(move || {
            let _ = std::io::copy(&mut s, &mut std::io::sink());
        })
    });

    let start = Instant::now();
    let status = loop {
        if let Err(err) = preview::check(job_id, stop) {
            group.terminate();
            let _ = child.wait();
            if let Some(t) = stdout_thread {
                let _ = t.join();
            }
            if let Some(t) = stderr_thread {
                let _ = t.join();
            }
            return Err(err);
        }
        if start.elapsed() > PROBE_TIMEOUT {
            group.terminate();
            let _ = child.wait();
            if let Some(t) = stdout_thread {
                let _ = t.join();
            }
            if let Some(t) = stderr_thread {
                let _ = t.join();
            }
            return Err(error(
                "import_invalid_audio",
                "Tempo esgotado ao validar o arquivo de áudio.",
            ));
        }
        match child.try_wait() {
            Ok(Some(st)) => break st,
            Ok(None) => std::thread::sleep(Duration::from_millis(20)),
            Err(_) => {
                group.terminate();
                let _ = child.wait();
                if let Some(t) = stdout_thread {
                    let _ = t.join();
                }
                if let Some(t) = stderr_thread {
                    let _ = t.join();
                }
                return Err(error(
                    "import_invalid_audio",
                    "Não foi possível validar o arquivo de áudio.",
                ));
            }
        }
    };

    let stdout = stdout_thread
        .and_then(|t| t.join().ok())
        .unwrap_or_default();
    if let Some(t) = stderr_thread {
        let _ = t.join();
    }
    if !status.success() {
        return Err(error(
            "import_invalid_audio",
            "Não foi possível ler os metadados do arquivo de áudio.",
        ));
    }
    let parsed: Value = serde_json::from_slice(&stdout).map_err(|_| {
        error(
            "import_invalid_audio",
            "Metadados inválidos no arquivo de áudio.",
        )
    })?;
    validate_probe_metadata(&parsed)
}

fn convert_to_standard_wav(
    ffmpeg: &Path,
    source_path: &Path,
    out_wav: &Path,
    job_id: i64,
    stop: &AtomicBool,
) -> Result<crate::tts::narration::WavInfo, CoreError> {
    if let Some(parent) = out_wav.parent() {
        fs::create_dir_all(parent).map_err(|_| {
            error(
                "import_failed",
                "Não foi possível preparar a pasta de Narração do Projeto.",
            )
        })?;
    }
    let tmp_wav = out_wav.with_extension("wav.part");
    let _ = fs::remove_file(&tmp_wav);

    let sr_str = STANDARD_SAMPLE_RATE.to_string();
    let ch_str = STANDARD_CHANNELS.to_string();
    let args: Vec<std::ffi::OsString> = vec![
        "-nostdin".into(),
        "-v".into(),
        "error".into(),
        "-y".into(),
        "-i".into(),
        source_path.as_os_str().to_owned(),
        "-map".into(),
        "0:a:0".into(),
        "-vn".into(),
        "-sn".into(),
        "-dn".into(),
        "-ac".into(),
        ch_str.into(),
        "-ar".into(),
        sr_str.into(),
        "-c:a".into(),
        "pcm_s16le".into(),
        "-f".into(),
        "wav".into(),
        tmp_wav.as_os_str().to_owned(),
    ];

    let (mut child, group) = process::spawn_managed(ffmpeg, args).map_err(|_| {
        error(
            "component_missing",
            "Não foi possível iniciar o Componente FFmpeg.",
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
        if let Err(err) = preview::check(job_id, stop) {
            group.terminate();
            let _ = child.wait();
            break Err(err);
        }
        if start.elapsed() > CONVERT_TIMEOUT {
            group.terminate();
            let _ = child.wait();
            break Err(error(
                "import_failed",
                "Tempo esgotado ao converter o áudio importado.",
            ));
        }
        match child.try_wait() {
            Ok(Some(status)) if status.success() => break Ok(()),
            Ok(Some(_)) | Err(_) => {
                break Err(error(
                    "import_failed",
                    "Não foi possível converter o áudio importado para Narração.",
                ));
            }
            Ok(None) => std::thread::sleep(Duration::from_millis(25)),
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
        error("import_failed", "O áudio convertido não é um WAV válido.")
    })?;
    if let Err(err) = validate_duration_bounds(info.duration_us) {
        let _ = fs::remove_file(&tmp_wav);
        return Err(err);
    }
    if info.sample_rate != i64::from(STANDARD_SAMPLE_RATE)
        || info.channels != i64::from(STANDARD_CHANNELS)
    {
        let _ = fs::remove_file(&tmp_wav);
        return Err(error(
            "import_failed",
            "O áudio convertido saiu fora do formato padrão da Narração.",
        ));
    }

    if out_wav.exists() {
        let _ = fs::remove_file(out_wav);
    }
    fs::rename(&tmp_wav, out_wav).map_err(|_| {
        let _ = fs::remove_file(&tmp_wav);
        error(
            "import_failed",
            "Não foi possível salvar o áudio importado no Projeto.",
        )
    })?;
    Ok(info)
}

fn clear_source_path(job_id: i64) {
    let _ = projects::with_writer(|c| {
        c.execute(
            "UPDATE narration_import_jobs SET source_path='' WHERE job_id=?1",
            [job_id],
        )?;
        Ok(())
    });
}

pub fn run(job_id: i64, project: &Path, stop: &AtomicBool) -> Result<(), CoreError> {
    let result = run_inner(job_id, project, stop);
    // Só limpa o caminho pessoal depois que o job conclui ou falha de forma definitiva;
    // se foi interrompido (`interrupted`), a fila recoloca o job e precisará do caminho.
    if result
        .as_ref()
        .err()
        .is_none_or(|e| e.code != "interrupted")
    {
        clear_source_path(job_id);
    }
    result
}

fn run_inner(job_id: i64, project: &Path, stop: &AtomicBool) -> Result<(), CoreError> {
    let (candidate_id, block_id, raw_path): (i64, i64, String) = projects::with_reader(|c| {
        c.query_row(
            "SELECT candidate_id, block_id, source_path FROM narration_import_jobs WHERE job_id=?1",
            [job_id],
            |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?)),
        )
    })?;

    preview::check(job_id, stop)?;
    script::narration_allowed(candidate_id)?;
    let cut = crate::selection::approved_cut(candidate_id)?;
    let latest = projects::with_reader(|c| read_latest_script_in(c, &cut))??
        .ok_or_else(|| error("script_not_approved", "Nenhum Roteiro aprovado encontrado."))?;
    let block = latest
        .blocks
        .iter()
        .find(|b| b.block_id == block_id)
        .ok_or_else(|| error("block_not_found", "Bloco não encontrado."))?;
    let version_id = block.version_id.ok_or_else(|| {
        error(
            "script_not_approved",
            "Bloco sem texto aprovado para narrar.",
        )
    })?;
    if block
        .narration_text
        .as_deref()
        .is_none_or(|s| s.trim().is_empty())
    {
        return Err(error("script_not_approved", "Bloco sem texto para narrar."));
    }

    let source_path = validate_input_file(&raw_path)?;
    let (ffmpeg, ffprobe) = configured_ffmpeg_and_probe()?;

    let _ = jobs::progress(job_id, "narration_import", 10, "Validando áudio importado");
    let probe = probe_audio_file(&ffprobe, &source_path, job_id, stop)?;
    if probe.multiple_audio_streams {
        projects::with_writer(|c| {
            c.execute(
                "UPDATE narration_import_jobs SET warning='multiple_audio_streams' WHERE job_id=?1",
                [job_id],
            )?;
            Ok(())
        })?;
    }

    let _ = jobs::progress(
        job_id,
        "narration_import",
        35,
        "Convertendo áudio para Narração",
    );
    let rel_path = format!("narrations/c{candidate_id}/b{block_id}-v{version_id}.wav");
    let out_wav = project.join(&rel_path);
    let info = convert_to_standard_wav(&ffmpeg, &source_path, &out_wav, job_id, stop)?;

    let _ = jobs::progress(
        job_id,
        "narration_import",
        85,
        "Salvando Narração importada",
    );
    let norm_lang = crate::tts::catalog::normalize_language(&latest.language).to_owned();
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
                block_id,
                version_id,
                VOICE_ID,
                MODEL_ID,
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
            (block_id, version_id),
            |r| r.get(0),
        )?;
        crate::narration_cleanup::remove_clean_file_for_narration(c, project, narration_id);
        crate::narration_cleanup::upsert_pending_in(c, narration_id, &info.sha256, None, false)?;
        crate::narration_align::mark_pending_in(
            c,
            narration_id,
            block_id,
            version_id,
            &info.sha256,
            &norm_lang,
        )?;
        Ok(())
    })?;

    crate::narration_align::enqueue_after_tts(candidate_id, Some(block_id));
    Ok(())
}

inventory::submit! { CommandRegistration { name: "narration.import", execute: cmd_import } }

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn checks_supported_extensions_and_codecs() {
        assert!(is_supported_extension(Path::new("voz.wav")));
        assert!(is_supported_extension(Path::new("VOZ.MP3")));
        assert!(is_supported_extension(Path::new("audio.m4a")));
        assert!(is_supported_extension(Path::new("gravacao.OGG")));
        assert!(!is_supported_extension(Path::new("video.mp4")));
        assert!(!is_supported_extension(Path::new("texto.txt")));

        assert!(is_supported_audio_codec("pcm_s16le"));
        assert!(is_supported_audio_codec("PCM_F32LE"));
        assert!(is_supported_audio_codec("mp3"));
        assert!(is_supported_audio_codec("aac"));
        assert!(is_supported_audio_codec("alac"));
        assert!(is_supported_audio_codec("flac"));
        assert!(is_supported_audio_codec("vorbis"));
        assert!(is_supported_audio_codec("opus"));
        assert!(!is_supported_audio_codec("wma"));
        assert!(!is_supported_audio_codec("h264"));
    }

    #[test]
    fn validates_probe_streams_codec_duration_and_multi_stream_warning() {
        let valid = json!({
            "streams": [
                {"codec_type": "video", "codec_name": "mjpeg"},
                {"codec_type": "audio", "codec_name": "mp3", "duration": "2.500000"}
            ],
            "format": {"duration": "2.500000"}
        });
        let res = validate_probe_metadata(&valid).unwrap();
        assert_eq!(res.codec_name, "mp3");
        assert_eq!(res.duration_us, 2_500_000);
        assert!(!res.multiple_audio_streams);

        let multi = json!({
            "streams": [
                {"codec_type": "audio", "codec_name": "aac", "duration": "1.2"},
                {"codec_type": "audio", "codec_name": "opus", "duration": "1.2"}
            ]
        });
        let res_multi = validate_probe_metadata(&multi).unwrap();
        assert!(res_multi.multiple_audio_streams);
        assert_eq!(res_multi.codec_name, "aac");

        let no_audio = json!({
            "streams": [{"codec_type": "video", "codec_name": "h264"}],
            "format": {"duration": "2.0"}
        });
        assert_eq!(
            validate_probe_metadata(&no_audio).unwrap_err().code,
            "import_no_audio_stream"
        );

        let bad_codec = json!({
            "streams": [{"codec_type": "audio", "codec_name": "wmav2", "duration": "2.0"}]
        });
        assert_eq!(
            validate_probe_metadata(&bad_codec).unwrap_err().code,
            "import_unsupported_codec"
        );

        let too_short = json!({
            "streams": [{"codec_type": "audio", "codec_name": "pcm_s16le", "duration": "0.15"}]
        });
        assert_eq!(
            validate_probe_metadata(&too_short).unwrap_err().code,
            "import_duration_too_short"
        );

        let too_long = json!({
            "streams": [{"codec_type": "audio", "codec_name": "opus", "duration": "605.0"}]
        });
        assert_eq!(
            validate_probe_metadata(&too_long).unwrap_err().code,
            "import_duration_too_long"
        );
    }
}
