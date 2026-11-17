//! Trilha sonora e efeitos sonoros importados pelo usuário (#154; ADR-0003, ADR-0005, ADR-0006).
//!
//! O app não embute nenhuma música. Os arquivos importados são validados (limite de 500 MiB,
//! stream de áudio válido via WAV PCM ou ffprobe), deduplicados por SHA-256 e copiados para
//! `<projeto>/audio/` com caminho relativo salvo no SQLite (`0154_001_audio_assets`).

use crate::{
    editor::silences::SpliceMap, export::pipeline::DUCKING_RELEASE_MS, montage, projects,
    CommandRegistration, CommandResult, CoreError, EventSink,
};
use rusqlite::{Connection, OptionalExtension};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use sha2::{Digest, Sha256};
use std::{
    collections::{BTreeSet, HashMap},
    fs::{self, File},
    io::{Read, Seek, SeekFrom},
    path::{Path, PathBuf},
};

/// Limite máximo por arquivo de áudio importado (500 MiB).
pub const MAX_AUDIO_BYTES: u64 = 500 * 1024 * 1024;
/// Volume padrão da trilha sonora (30% = ~ -10.5 dB).
pub const DEFAULT_SOUNDTRACK_VOLUME: f64 = 0.30;
/// Volume padrão de efeitos sonoros (80%).
pub const DEFAULT_SFX_VOLUME: f64 = 0.80;
/// Tamanho máximo do texto de atribuição CC-BY.
pub const MAX_ATTRIBUTION_CHARS: usize = 500;
/// Tamanho máximo do nome exibido de um áudio importado.
pub const MAX_ASSET_NAME_CHARS: usize = 120;
/// Gap mínimo entre intervalos de fala para não bombear a rampa de ducking da trilha (300 ms,
/// igual a `DUCKING_RELEASE_MS` do #82).
pub const SPEECH_DUCK_MERGE_GAP_US: i64 = (DUCKING_RELEASE_MS * 1000.0) as i64;

const ALLOWED_EXTENSIONS: &[&str] = &["wav", "mp3", "m4a", "aac", "ogg", "opus", "flac", "webm"];

inventory::submit! {
    projects::Migration {
        id: "0154_001_audio_assets",
        sql: "
CREATE TABLE audio_assets (
  id INTEGER PRIMARY KEY,
  kind TEXT NOT NULL CHECK(kind IN ('music','sfx')),
  name TEXT NOT NULL,
  audio_rel_path TEXT NOT NULL,
  duration_us INTEGER NOT NULL CHECK(duration_us > 0),
  sample_rate INTEGER NOT NULL CHECK(sample_rate > 0),
  channels INTEGER NOT NULL CHECK(channels > 0),
  bytes INTEGER NOT NULL CHECK(bytes > 0),
  sha256 TEXT NOT NULL,
  license_kind TEXT NOT NULL CHECK(license_kind IN ('unknown','youtube_audio_library','cc0','cc_by','purchased','original')),
  license_attribution TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE INDEX audio_assets_sha256 ON audio_assets(sha256);
",
    }
}

pub(crate) fn error(code: &str, message: &str) -> CoreError {
    CoreError {
        code: code.into(),
        message: message.into(),
        usage: None,
    }
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum AudioKind {
    Music,
    Sfx,
}

impl AudioKind {
    pub fn parse(raw: &str) -> Option<Self> {
        match raw.trim() {
            "music" => Some(Self::Music),
            "sfx" => Some(Self::Sfx),
            _ => None,
        }
    }

    pub fn as_str(self) -> &'static str {
        match self {
            Self::Music => "music",
            Self::Sfx => "sfx",
        }
    }
}

#[derive(Clone, Copy, Debug, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum LicenseKind {
    #[default]
    Unknown,
    YoutubeAudioLibrary,
    Cc0,
    CcBy,
    Purchased,
    Original,
}

impl LicenseKind {
    pub fn parse(raw: &str) -> Option<Self> {
        match raw.trim() {
            "unknown" => Some(Self::Unknown),
            "youtube_audio_library" => Some(Self::YoutubeAudioLibrary),
            "cc0" => Some(Self::Cc0),
            "cc_by" => Some(Self::CcBy),
            "purchased" => Some(Self::Purchased),
            "original" => Some(Self::Original),
            _ => None,
        }
    }

    pub fn as_str(self) -> &'static str {
        match self {
            Self::Unknown => "unknown",
            Self::YoutubeAudioLibrary => "youtube_audio_library",
            Self::Cc0 => "cc0",
            Self::CcBy => "cc_by",
            Self::Purchased => "purchased",
            Self::Original => "original",
        }
    }

    pub fn is_verified(self) -> bool {
        !matches!(self, Self::Unknown)
    }
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AudioAsset {
    pub id: i64,
    pub kind: AudioKind,
    pub name: String,
    #[serde(skip_serializing)]
    pub audio_rel_path: String,
    pub duration_us: i64,
    pub sample_rate: i64,
    pub channels: i64,
    pub bytes: i64,
    pub sha256: String,
    pub license_kind: LicenseKind,
    pub license_attribution: String,
    pub license_verified: bool,
    pub media_id: String,
    pub created_at: String,
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct SoundtrackEdit {
    pub asset_id: i64,
    #[serde(default)]
    pub start_us: i64,
    #[serde(default = "default_soundtrack_volume")]
    pub volume: f64,
    #[serde(default)]
    pub fade_in_us: i64,
    #[serde(default)]
    pub fade_out_us: i64,
    #[serde(default = "default_true")]
    pub loop_to_fit: bool,
}

fn default_soundtrack_volume() -> f64 {
    DEFAULT_SOUNDTRACK_VOLUME
}

fn default_true() -> bool {
    true
}

#[derive(Clone, Copy, Debug, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum WordTrack {
    #[default]
    Original,
    Narration,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(tag = "kind", rename_all = "snake_case", deny_unknown_fields)]
pub enum SfxAnchor {
    Moment {
        source_us: i64,
    },
    Word {
        #[serde(default)]
        track: WordTrack,
        position: i64,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        block_id: Option<i64>,
        #[serde(default)]
        offset_us: i64,
    },
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct SfxEdit {
    pub id: i64,
    pub asset_id: i64,
    pub anchor: SfxAnchor,
    #[serde(default = "default_sfx_volume")]
    pub volume: f64,
    #[serde(default)]
    pub fade_in_us: i64,
    #[serde(default)]
    pub fade_out_us: i64,
}

fn default_sfx_volume() -> f64 {
    DEFAULT_SFX_VOLUME
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SpeechInterval {
    pub start_us: i64,
    pub end_us: i64,
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ResolvedSoundtrack {
    pub asset_id: i64,
    pub name: String,
    pub media_id: String,
    pub asset_duration_us: i64,
    pub start_us: i64,
    pub play_duration_us: i64,
    pub end_us: i64,
    pub volume: f64,
    pub fade_in_us: i64,
    pub fade_out_us: i64,
    pub loop_to_fit: bool,
    pub license_kind: LicenseKind,
    pub license_attribution: String,
    pub license_verified: bool,
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ResolvedSfx {
    pub id: i64,
    pub asset_id: i64,
    pub name: String,
    pub media_id: String,
    pub asset_duration_us: i64,
    pub anchor: SfxAnchor,
    pub word_text: Option<String>,
    pub start_us: i64,
    pub end_us: i64,
    pub source_start_us: i64,
    pub volume: f64,
    pub fade_in_us: i64,
    pub fade_out_us: i64,
    pub outside_clip: bool,
    pub license_kind: LicenseKind,
    pub license_attribution: String,
    pub license_verified: bool,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AudioMixWarning {
    pub code: String,
    pub message: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub sfx_id: Option<i64>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub asset_id: Option<i64>,
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AudioMixView {
    pub soundtrack: Option<ResolvedSoundtrack>,
    pub sfx: Vec<ResolvedSfx>,
    pub speech_intervals: Vec<SpeechInterval>,
    pub total_duration_us: i64,
    pub unverified_count: usize,
    pub warnings: Vec<AudioMixWarning>,
}

pub(crate) fn validate_volume(vol: f64) -> Result<f64, CoreError> {
    if vol.is_finite() && (0.0..=1.0).contains(&vol) {
        Ok(vol)
    } else {
        Err(error(
            "invalid_audio_mix",
            "O volume deve ficar entre 0% e 100%.",
        ))
    }
}

pub(crate) fn validate_soundtrack_edit(st: &SoundtrackEdit) -> Result<(), CoreError> {
    validate_volume(st.volume)?;
    if st.asset_id <= 0 || st.start_us < 0 || st.fade_in_us < 0 || st.fade_out_us < 0 {
        return Err(error(
            "invalid_audio_mix",
            "Parâmetros da trilha sonora são inválidos.",
        ));
    }
    Ok(())
}

pub(crate) fn validate_sfx_edit(sfx: &SfxEdit) -> Result<(), CoreError> {
    validate_volume(sfx.volume)?;
    if sfx.id <= 0 || sfx.asset_id <= 0 || sfx.fade_in_us < 0 || sfx.fade_out_us < 0 {
        return Err(error(
            "invalid_audio_mix",
            "Parâmetros do efeito sonoro são inválidos.",
        ));
    }
    match &sfx.anchor {
        SfxAnchor::Moment { source_us } if *source_us < 0 => {
            return Err(error(
                "invalid_audio_mix",
                "O momento do efeito não pode ser negativo.",
            ));
        }
        SfxAnchor::Word {
            track: WordTrack::Narration,
            block_id: None,
            ..
        } => {
            return Err(error(
                "invalid_audio_mix",
                "Efeito ancorado na Narração exige o bloco de origem.",
            ));
        }
        _ => {}
    }
    Ok(())
}

fn sanitize_text(raw: &str, max_chars: usize) -> String {
    raw.chars()
        .filter(|c| !c.is_control() && *c != '<' && *c != '>')
        .collect::<String>()
        .split_whitespace()
        .collect::<Vec<_>>()
        .join(" ")
        .chars()
        .take(max_chars)
        .collect()
}

fn normalize_license(
    license_kind: Option<&str>,
    attribution: Option<&str>,
) -> Result<(LicenseKind, String), CoreError> {
    let kind = match license_kind {
        None => LicenseKind::Unknown,
        Some(raw) => LicenseKind::parse(raw)
            .ok_or_else(|| error("invalid_license", "Origem ou licença de áudio inválida."))?,
    };
    let clean_attr = attribution
        .map(|s| sanitize_text(s, MAX_ATTRIBUTION_CHARS))
        .unwrap_or_default();
    if kind == LicenseKind::CcBy && clean_attr.is_empty() {
        return Err(error(
            "attribution_required",
            "A licença CC-BY exige o texto de atribuição do autor/obra.",
        ));
    }
    Ok((kind, clean_attr))
}

pub(crate) fn project_root_dir() -> Result<PathBuf, CoreError> {
    let cur = crate::dispatch("projects.current", json!({}), &mut |_| {})?;
    let path = cur["path"]
        .as_str()
        .ok_or_else(|| error("project_not_open", "Abra um Projeto para gerenciar áudios."))?;
    Ok(PathBuf::from(path))
}

pub(crate) fn resolve_audio_rel_path(project: &Path, rel: &str) -> Option<PathBuf> {
    let candidate = project.join(rel);
    let root = project.join("audio").canonicalize().ok()?;
    let resolved = candidate.canonicalize().ok()?;
    (resolved.starts_with(&root) && resolved.is_file()).then_some(resolved)
}

/// Usado por `media.rs` para servir `audio/<id>` com proteção contra path traversal e symlinks.
pub(crate) fn media_audio_path(id: i64) -> Option<PathBuf> {
    let project = project_root_dir().ok()?;
    let rel: String = projects::with_reader(|c| {
        c.query_row(
            "SELECT audio_rel_path FROM audio_assets WHERE id=?1",
            [id],
            |r| r.get(0),
        )
        .optional()
    })
    .ok()
    .flatten()?;
    resolve_audio_rel_path(&project, &rel)
}

struct AudioMeta {
    duration_us: i64,
    sample_rate: i64,
    channels: i64,
}

/// Lê cabeçalho WAV PCM sem carregar o arquivo inteiro na memória (suporta arquivos até 500 MiB).
fn try_inspect_wav_header(path: &Path) -> Option<AudioMeta> {
    let mut file = File::open(path).ok()?;
    let file_len = file.metadata().ok()?.len();
    if file_len < 44 {
        return None;
    }
    let mut riff = [0u8; 12];
    file.read_exact(&mut riff).ok()?;
    if &riff[0..4] != b"RIFF" || &riff[8..12] != b"WAVE" {
        return None;
    }

    let mut pos: u64 = 12;
    let mut channels: Option<u16> = None;
    let mut sample_rate: Option<u32> = None;
    let mut bits_per_sample: Option<u16> = None;
    let mut byte_rate: Option<u32> = None;
    let mut data_bytes: Option<u32> = None;
    let mut fmt_tag: Option<u16> = None;

    while pos + 8 <= file_len {
        file.seek(SeekFrom::Start(pos)).ok()?;
        let mut hdr = [0u8; 8];
        file.read_exact(&mut hdr).ok()?;
        let id = &hdr[0..4];
        let size = u32::from_le_bytes(hdr[4..8].try_into().ok()?);
        let body_start = pos + 8;
        let body_end = body_start.saturating_add(u64::from(size));
        if body_end > file_len {
            break;
        }
        if id == b"fmt " && size >= 16 {
            let mut fmt = [0u8; 16];
            file.read_exact(&mut fmt).ok()?;
            fmt_tag = Some(u16::from_le_bytes(fmt[0..2].try_into().ok()?));
            channels = Some(u16::from_le_bytes(fmt[2..4].try_into().ok()?));
            sample_rate = Some(u32::from_le_bytes(fmt[4..8].try_into().ok()?));
            byte_rate = Some(u32::from_le_bytes(fmt[8..12].try_into().ok()?));
            bits_per_sample = Some(u16::from_le_bytes(fmt[14..16].try_into().ok()?));
        } else if id == b"data" {
            data_bytes = Some(size);
            break;
        }
        let padded = u64::from(size).saturating_add(u64::from(size & 1));
        pos = body_start.saturating_add(padded);
    }

    if fmt_tag != Some(1) {
        return None;
    }
    let ch = channels.filter(|&c| c > 0)?;
    let sr = sample_rate.filter(|&r| r > 0)?;
    let data = data_bytes.filter(|&d| d > 0)?;
    let computed_byte_rate = byte_rate.filter(|&b| b > 0).or_else(|| {
        bits_per_sample
            .filter(|&bps| bps > 0)
            .map(|bps| sr * u32::from(ch) * u32::from(bps / 8))
    })?;
    let duration_us =
        ((u128::from(data) * 1_000_000) / u128::from(computed_byte_rate)).max(1) as i64;
    Some(AudioMeta {
        duration_us,
        sample_rate: i64::from(sr),
        channels: i64::from(ch),
    })
}

fn probe_path() -> Result<PathBuf, CoreError> {
    if let Some(p) = std::env::var_os("CLIPES_FFPROBE") {
        return Ok(p.into());
    }
    crate::components::ffprobe_executable(crate::components::configured_ffmpeg().as_deref())
        .map_err(|_| {
            error(
                "ffprobe_missing",
                "ffprobe indisponível; verifique os Componentes.",
            )
        })
}

fn inspect_audio_file(path: &Path) -> Result<AudioMeta, CoreError> {
    if let Some(wav) = try_inspect_wav_header(path) {
        return Ok(wav);
    }
    let ffprobe = probe_path()?;
    let child = crate::process::spawn(
        &ffprobe,
        [
            std::ffi::OsStr::new("-v"),
            std::ffi::OsStr::new("error"),
            std::ffi::OsStr::new("-select_streams"),
            std::ffi::OsStr::new("a:0"),
            std::ffi::OsStr::new("-show_format"),
            std::ffi::OsStr::new("-show_streams"),
            std::ffi::OsStr::new("-of"),
            std::ffi::OsStr::new("json"),
            path.as_os_str(),
        ],
        None,
    )
    .map_err(|_| {
        error(
            "ffprobe_missing",
            "ffprobe indisponível; verifique os Componentes.",
        )
    })?;
    let output = child
        .wait_with_output()
        .map_err(|_| error("invalid_audio", "Não foi possível ler o arquivo de áudio."))?;
    if !output.status.success() {
        return Err(error(
            "invalid_audio",
            "Arquivo de áudio inválido ou não suportado.",
        ));
    }
    let parsed: Value = serde_json::from_slice(&output.stdout)
        .map_err(|_| error("invalid_audio", "Metadados de áudio inválidos."))?;
    let stream = parsed["streams"]
        .as_array()
        .and_then(|arr| arr.iter().find(|s| s["codec_type"] == "audio"))
        .ok_or_else(|| error("invalid_audio", "O arquivo não contém faixa de áudio."))?;
    let dur_secs = stream["duration"]
        .as_str()
        .or_else(|| parsed["format"]["duration"].as_str())
        .and_then(|s| s.parse::<f64>().ok())
        .filter(|d| d.is_finite() && *d > 0.0 && *d < i64::MAX as f64 / 1_000_000.0)
        .ok_or_else(|| error("invalid_audio", "Duração de áudio inválida ou ausente."))?;
    let duration_us = (dur_secs * 1_000_000.0).round().max(1.0) as i64;
    let sample_rate = stream["sample_rate"]
        .as_str()
        .and_then(|s| s.parse::<i64>().ok())
        .filter(|&r| r > 0)
        .unwrap_or(48_000);
    let channels = stream["channels"].as_i64().filter(|&c| c > 0).unwrap_or(2);
    Ok(AudioMeta {
        duration_us,
        sample_rate,
        channels,
    })
}

fn stream_sha256_and_size(path: &Path) -> Result<(u64, String), CoreError> {
    let meta = fs::metadata(path)
        .map_err(|_| error("invalid_audio", "Arquivo de áudio não encontrado."))?;
    if !meta.is_file() {
        return Err(error(
            "invalid_audio",
            "Selecione um arquivo de áudio válido.",
        ));
    }
    let reported_len = meta.len();
    if reported_len == 0 {
        return Err(error("invalid_audio", "O arquivo de áudio está vazio."));
    }
    if reported_len > MAX_AUDIO_BYTES {
        return Err(error(
            "audio_too_large",
            "O arquivo de áudio excede o limite de 500 MiB.",
        ));
    }

    let mut file = File::open(path).map_err(|_| {
        error(
            "invalid_audio",
            "Não foi possível abrir o arquivo de áudio.",
        )
    })?;
    let mut hasher = Sha256::new();
    let mut buf = [0u8; 65_536];
    let mut total: u64 = 0;
    loop {
        let n = file
            .read(&mut buf)
            .map_err(|_| error("invalid_audio", "Não foi possível ler o arquivo de áudio."))?;
        if n == 0 {
            break;
        }
        total = total.saturating_add(n as u64);
        if total > MAX_AUDIO_BYTES {
            return Err(error(
                "audio_too_large",
                "O arquivo de áudio excede o limite de 500 MiB.",
            ));
        }
        hasher.update(&buf[..n]);
    }
    if total == 0 {
        return Err(error("invalid_audio", "O arquivo de áudio está vazio."));
    }
    Ok((total, format!("{:x}", hasher.finalize())))
}

fn safe_extension(path: &Path) -> &'static str {
    let ext = path
        .extension()
        .and_then(|e| e.to_str())
        .map(|s| s.to_ascii_lowercase());
    match ext.as_deref() {
        Some(e) => ALLOWED_EXTENSIONS
            .iter()
            .copied()
            .find(|&allowed| allowed == e)
            .unwrap_or("bin"),
        None => "bin",
    }
}

fn row_to_asset(r: &rusqlite::Row<'_>) -> rusqlite::Result<AudioAsset> {
    let kind_str: String = r.get(1)?;
    let license_str: String = r.get(9)?;
    let id: i64 = r.get(0)?;
    let license_kind = LicenseKind::parse(&license_str).unwrap_or(LicenseKind::Unknown);
    Ok(AudioAsset {
        id,
        kind: AudioKind::parse(&kind_str).unwrap_or(AudioKind::Music),
        name: r.get(2)?,
        audio_rel_path: r.get(3)?,
        duration_us: r.get(4)?,
        sample_rate: r.get(5)?,
        channels: r.get(6)?,
        bytes: r.get(7)?,
        sha256: r.get(8)?,
        license_kind,
        license_attribution: r.get(10)?,
        license_verified: license_kind.is_verified(),
        media_id: format!("audio/{id}"),
        created_at: r.get(11)?,
    })
}

pub(crate) fn load_asset(c: &Connection, id: i64) -> rusqlite::Result<Option<AudioAsset>> {
    c.query_row(
        "SELECT id, kind, name, audio_rel_path, duration_us, sample_rate, channels, bytes, sha256, license_kind, license_attribution, created_at FROM audio_assets WHERE id=?1",
        [id],
        row_to_asset,
    )
    .optional()
}

pub(crate) fn load_assets_map(c: &Connection) -> rusqlite::Result<HashMap<i64, AudioAsset>> {
    let mut stmt = c.prepare(
        "SELECT id, kind, name, audio_rel_path, duration_us, sample_rate, channels, bytes, sha256, license_kind, license_attribution, created_at FROM audio_assets ORDER BY id DESC",
    )?;
    let rows = stmt.query_map([], row_to_asset)?;
    let mut map = HashMap::new();
    for row in rows {
        let asset = row?;
        map.insert(asset.id, asset);
    }
    Ok(map)
}

fn cmd_import(v: Value, _: &mut EventSink<'_>) -> CommandResult {
    let _job = projects::start_job()?;
    let project = project_root_dir()?;
    let kind = v["kind"]
        .as_str()
        .and_then(AudioKind::parse)
        .ok_or_else(|| {
            error(
                "invalid_audio_kind",
                "Tipo de áudio inválido: use music ou sfx.",
            )
        })?;
    let source_path = PathBuf::from(
        v["path"]
            .as_str()
            .filter(|s| !s.trim().is_empty())
            .ok_or_else(|| error("invalid_audio", "Selecione um arquivo de áudio."))?,
    );
    let (license_kind, license_attribution) = normalize_license(
        v.get("license_kind").and_then(Value::as_str),
        v.get("license_attribution").and_then(Value::as_str),
    )?;
    let (bytes, sha256) = stream_sha256_and_size(&source_path)?;

    // Verifica duplicata existente no Projeto pelo SHA-256 antes de inspecionar/copiar.
    let existing_same_kind: Option<AudioAsset> = projects::with_reader(|c| {
        c.query_row(
            "SELECT id, kind, name, audio_rel_path, duration_us, sample_rate, channels, bytes, sha256, license_kind, license_attribution, created_at
             FROM audio_assets WHERE sha256=?1 AND kind=?2 ORDER BY id LIMIT 1",
            (&sha256, kind.as_str()),
            row_to_asset,
        )
        .optional()
    })?;
    if let Some(existing) = existing_same_kind {
        if resolve_audio_rel_path(&project, &existing.audio_rel_path).is_some() {
            // Se já existia com o mesmo hash e tipo, não duplica o arquivo nem a linha;
            // atualiza licença apenas se o usuário informou uma licença explícita na reimportação.
            if v.get("license_kind").is_some()
                && (existing.license_kind != license_kind
                    || existing.license_attribution != license_attribution)
            {
                let updated = projects::with_writer(|c| {
                    c.execute(
                        "UPDATE audio_assets SET license_kind=?2, license_attribution=?3 WHERE id=?1",
                        (existing.id, license_kind.as_str(), &license_attribution),
                    )?;
                    load_asset(c, existing.id)
                })?
                .ok_or_else(|| error("audio_asset_missing", "Áudio importado não encontrado."))?;
                return Ok(serde_json::to_value(updated).unwrap());
            }
            return Ok(serde_json::to_value(existing).unwrap());
        }
    }

    let meta = inspect_audio_file(&source_path)?;

    let audio_dir = project.join("audio");
    fs::create_dir_all(&audio_dir).map_err(|_| {
        error(
            "copy_failed",
            "Não foi possível preparar a pasta de áudios.",
        )
    })?;

    // Reutiliza arquivo físico já presente no disco para o mesmo SHA-256 (ex.: mesmo arquivo como music e sfx).
    let existing_rel_on_disk: Option<String> = projects::with_reader(|c| {
        c.query_row(
            "SELECT audio_rel_path FROM audio_assets WHERE sha256=?1 LIMIT 1",
            [&sha256],
            |r| r.get(0),
        )
        .optional()
    })?
    .filter(|rel: &String| resolve_audio_rel_path(&project, rel).is_some());

    let rel_path = if let Some(rel) = existing_rel_on_disk {
        rel
    } else {
        let ext = safe_extension(&source_path);
        let file_name = format!("{sha256}.{ext}");
        let target = audio_dir.join(&file_name);
        if !target.is_file() {
            let mut tmp = tempfile::Builder::new()
                .prefix(".clipes-audio-")
                .tempfile_in(&audio_dir)
                .map_err(|_| error("copy_failed", "Não foi possível copiar o arquivo de áudio."))?;
            fs::copy(&source_path, tmp.path())
                .map_err(|_| error("copy_failed", "Não foi possível copiar o arquivo de áudio."))?;
            let _ = tmp.as_file_mut();
            match tmp.persist_noclobber(&target) {
                Ok(_) => {}
                Err(e) if e.error.kind() == std::io::ErrorKind::AlreadyExists => {}
                Err(_) => {
                    return Err(error(
                        "copy_failed",
                        "Não foi possível salvar o arquivo de áudio no Projeto.",
                    ))
                }
            }
        }
        format!("audio/{file_name}")
    };

    let raw_name = v["name"]
        .as_str()
        .map(str::trim)
        .filter(|s| !s.is_empty())
        .map(str::to_owned)
        .or_else(|| {
            source_path
                .file_stem()
                .and_then(|s| s.to_str())
                .map(str::to_owned)
        })
        .unwrap_or_else(|| "audio".into());
    let name = {
        let clean = sanitize_text(&raw_name, MAX_ASSET_NAME_CHARS);
        if clean.is_empty() {
            "audio".into()
        } else {
            clean
        }
    };

    let asset = projects::with_writer(|c| {
        c.execute(
            "INSERT INTO audio_assets(kind, name, audio_rel_path, duration_us, sample_rate, channels, bytes, sha256, license_kind, license_attribution)
             VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9,?10)",
            (
                kind.as_str(),
                &name,
                &rel_path,
                meta.duration_us,
                meta.sample_rate,
                meta.channels,
                bytes as i64,
                &sha256,
                license_kind.as_str(),
                &license_attribution,
            ),
        )?;
        let id = c.last_insert_rowid();
        load_asset(c, id)
    })?
    .ok_or_else(|| error("audio_asset_missing", "Áudio importado não encontrado."))?;

    Ok(serde_json::to_value(asset).unwrap())
}

fn cmd_list(v: Value, _: &mut EventSink<'_>) -> CommandResult {
    let _ = project_root_dir()?;
    let filter_kind = match v.get("kind").and_then(Value::as_str) {
        None => None,
        Some(raw) => Some(AudioKind::parse(raw).ok_or_else(|| {
            error(
                "invalid_audio_kind",
                "Tipo de áudio inválido: use music ou sfx.",
            )
        })?),
    };
    let items: Vec<AudioAsset> = projects::with_reader(|c| {
        if let Some(kind) = filter_kind {
            let mut stmt = c.prepare(
                "SELECT id, kind, name, audio_rel_path, duration_us, sample_rate, channels, bytes, sha256, license_kind, license_attribution, created_at
                 FROM audio_assets WHERE kind=?1 ORDER BY id DESC",
            )?;
            let rows = stmt.query_map([kind.as_str()], row_to_asset)?;
            rows.collect::<rusqlite::Result<Vec<_>>>()
        } else {
            let mut stmt = c.prepare(
                "SELECT id, kind, name, audio_rel_path, duration_us, sample_rate, channels, bytes, sha256, license_kind, license_attribution, created_at
                 FROM audio_assets ORDER BY id DESC",
            )?;
            let rows = stmt.query_map([], row_to_asset)?;
            rows.collect::<rusqlite::Result<Vec<_>>>()
        }
    })?;
    Ok(serde_json::to_value(items).unwrap())
}

fn cmd_license_set(v: Value, _: &mut EventSink<'_>) -> CommandResult {
    let _ = project_root_dir()?;
    let id = v["id"]
        .as_i64()
        .ok_or_else(|| error("audio_asset_missing", "Áudio importado não encontrado."))?;
    let (license_kind, license_attribution) = normalize_license(
        v.get("license_kind")
            .and_then(Value::as_str)
            .or(Some("unknown")),
        v.get("license_attribution").and_then(Value::as_str),
    )?;
    let updated = projects::with_writer(|c| {
        let changed = c.execute(
            "UPDATE audio_assets SET license_kind=?2, license_attribution=?3 WHERE id=?1",
            (id, license_kind.as_str(), &license_attribution),
        )?;
        if changed == 0 {
            return Ok(None);
        }
        load_asset(c, id)
    })?
    .ok_or_else(|| error("audio_asset_missing", "Áudio importado não encontrado."))?;
    Ok(serde_json::to_value(updated).unwrap())
}

fn cmd_delete(v: Value, _: &mut EventSink<'_>) -> CommandResult {
    let project = project_root_dir()?;
    let id = v["id"]
        .as_i64()
        .ok_or_else(|| error("audio_asset_missing", "Áudio importado não encontrado."))?;
    let rel_to_remove: Option<String> = projects::with_writer(|c| {
        let rel: Option<String> = c
            .query_row(
                "SELECT audio_rel_path FROM audio_assets WHERE id=?1",
                [id],
                |r| r.get(0),
            )
            .optional()?;
        let Some(rel) = rel else {
            return Ok(None);
        };
        c.execute("DELETE FROM audio_assets WHERE id=?1", [id])?;
        let refs: i64 = c.query_row(
            "SELECT COUNT(*) FROM audio_assets WHERE audio_rel_path=?1",
            [&rel],
            |r| r.get(0),
        )?;
        Ok((refs == 0).then_some(rel))
    })?;
    if let Some(rel) = rel_to_remove {
        if let Some(path) = resolve_audio_rel_path(&project, &rel) {
            let _ = fs::remove_file(path);
        }
    }
    Ok(json!({ "deleted": true, "id": id }))
}

// ---------------------------------------------------------------- intervalos de fala & resolução

/// Une intervalos `[start_us, end_us]` sobrepostos ou separados por menos de `merge_gap_us`.
pub fn merge_speech_intervals(
    mut raw: Vec<SpeechInterval>,
    merge_gap_us: i64,
) -> Vec<SpeechInterval> {
    raw.retain(|i| i.end_us > i.start_us);
    if raw.is_empty() {
        return raw;
    }
    raw.sort_by_key(|i| (i.start_us, i.end_us));
    let mut out = Vec::with_capacity(raw.len());
    let mut cur = raw[0];
    for next in raw.into_iter().skip(1) {
        if next.start_us <= cur.end_us.saturating_add(merge_gap_us.max(0)) {
            cur.end_us = cur.end_us.max(next.end_us);
        } else {
            out.push(cur);
            cur = next;
        }
    }
    out.push(cur);
    out
}

fn subtract_intervals(base: SpeechInterval, cuts: &[(i64, i64)]) -> Vec<SpeechInterval> {
    let mut active = vec![base];
    for &(ca, cb) in cuts {
        if cb <= ca {
            continue;
        }
        let mut next = Vec::with_capacity(active.len() + 1);
        for seg in active {
            if cb <= seg.start_us || ca >= seg.end_us {
                next.push(seg);
            } else {
                if ca > seg.start_us {
                    next.push(SpeechInterval {
                        start_us: seg.start_us,
                        end_us: ca,
                    });
                }
                if cb < seg.end_us {
                    next.push(SpeechInterval {
                        start_us: cb,
                        end_us: seg.end_us,
                    });
                }
            }
        }
        active = next;
    }
    active
}

/// Coleta intervalos de fala no eixo de saída (`0..total_duration_us`) a partir das Frases da
/// Transcrição (mapeadas pelo `SpliceMap`) e do alinhamento/blocos da Narração (#81/#204).
pub(crate) fn resolve_speech_intervals_for_clip(
    c: &Connection,
    transcript_id: Option<i64>,
    splice: &SpliceMap,
    approved_cut: Option<&crate::selection::ApprovedCut>,
    montage_plan: Option<&montage::MontagePlan>,
) -> rusqlite::Result<Vec<SpeechInterval>> {
    let mut narration_block_ranges: Vec<(i64, i64)> = Vec::new();
    let mut narration_speech: Vec<SpeechInterval> = Vec::new();

    if let Some(plan) = montage_plan {
        let mut aligned_by_block: HashMap<i64, Vec<SpeechInterval>> = HashMap::new();
        if let Some(cut) = approved_cut {
            if let Ok(Ok(Some(latest))) = crate::tts::narration::read_latest_script_in(c, cut) {
                for b in latest.blocks {
                    let Some(ver_id) = b.version_id else {
                        continue;
                    };
                    let nar_row: Option<(i64, String)> = c
                            .query_row(
                                "SELECT id, sha256 FROM narration_blocks WHERE block_id=?1 AND version_id=?2",
                                (b.block_id, ver_id),
                                |r| Ok((r.get(0)?, r.get(1)?)),
                            )
                            .optional()?;
                    let Some((narration_id, sha256)) = nar_row else {
                        continue;
                    };
                    let align_row: Option<(String, String, Option<String>)> = c
                            .query_row(
                                "SELECT audio_sha256, status, choice FROM narration_alignments WHERE narration_id=?1",
                                [narration_id],
                                |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?)),
                            )
                            .optional()?;
                    let track = match align_row {
                        Some((row_sha, ref status, ref choice)) if row_sha == sha256 => {
                            match status.as_str() {
                                "aligned" => Some("script"),
                                "approved" => choice.as_deref(),
                                _ => None,
                            }
                        }
                        _ => None,
                    };
                    if let Some(track) = track {
                        let mut q = c.prepare(
                            "SELECT sentence_idx, MIN(start_us), MAX(end_us)
                                 FROM narration_aligned_words
                                 WHERE narration_id=?1 AND track=?2
                                 GROUP BY sentence_idx
                                 ORDER BY MIN(start_us)",
                        )?;
                        let spans = q
                            .query_map((narration_id, track), |r| {
                                Ok((r.get::<_, i64>(1)?, r.get::<_, i64>(2)?))
                            })?
                            .collect::<rusqlite::Result<Vec<_>>>()?;
                        if !spans.is_empty() {
                            aligned_by_block.insert(
                                b.block_id,
                                spans
                                    .into_iter()
                                    .map(|(s, e)| SpeechInterval {
                                        start_us: s,
                                        end_us: e,
                                    })
                                    .collect(),
                            );
                        }
                    }
                }
            }
        }

        for b in &plan.blocks {
            if b.duration_us <= 0 {
                continue;
            }
            narration_block_ranges.push((b.start_us, b.end_us));
            if let Some(spans) = aligned_by_block.get(&b.block_id) {
                for sp in spans {
                    let abs_s = (b.start_us + sp.start_us).max(b.start_us);
                    let abs_e = (b.start_us + sp.end_us).min(b.end_us);
                    if abs_e > abs_s {
                        narration_speech.push(SpeechInterval {
                            start_us: abs_s,
                            end_us: abs_e,
                        });
                    }
                }
            } else {
                narration_speech.push(SpeechInterval {
                    start_us: b.start_us,
                    end_us: b.end_us,
                });
            }
        }
    }

    let mut source_speech: Vec<SpeechInterval> = Vec::new();
    if let Some(tid) = transcript_id {
        let mut q = c.prepare(
            "SELECT start_us, end_us FROM sentences
             WHERE transcript_id=?1 AND end_us > ?2 AND start_us < ?3
             ORDER BY start_us, id",
        )?;
        let rows = q
            .query_map((tid, splice.clip_start_us, splice.clip_end_us), |r| {
                Ok((r.get::<_, i64>(0)?, r.get::<_, i64>(1)?))
            })?
            .collect::<rusqlite::Result<Vec<_>>>()?;
        for (s_start, s_end) in rows {
            for seg in &splice.segments {
                let a = s_start.max(seg.source_start_us);
                let b = s_end.min(seg.source_end_us);
                if b > a {
                    let out_s = seg.output_start_us + (a - seg.source_start_us);
                    let out_e = seg.output_start_us + (b - seg.source_start_us);
                    let base = SpeechInterval {
                        start_us: out_s,
                        end_us: out_e,
                    };
                    if narration_block_ranges.is_empty() {
                        source_speech.push(base);
                    } else {
                        source_speech.extend(subtract_intervals(base, &narration_block_ranges));
                    }
                }
            }
        }
    }

    let mut all = source_speech;
    all.extend(narration_speech);
    Ok(merge_speech_intervals(all, SPEECH_DUCK_MERGE_GAP_US))
}

/// Resolve um word anchor para `(output_start_us, source_start_us, word_text, outside_clip)`.
pub(crate) fn resolve_sfx_anchor(
    c: &Connection,
    anchor: &SfxAnchor,
    transcript_id: Option<i64>,
    splice: &SpliceMap,
    montage_plan: Option<&montage::MontagePlan>,
) -> rusqlite::Result<(i64, i64, Option<String>, bool)> {
    match anchor {
        SfxAnchor::Moment { source_us } => {
            let clamped = (*source_us).clamp(splice.clip_start_us, splice.clip_end_us);
            let out_us = splice.source_to_output(clamped).max(0);
            Ok((out_us, clamped, None, false))
        }
        SfxAnchor::Word {
            track: WordTrack::Original,
            position,
            offset_us,
            ..
        } => {
            let Some(tid) = transcript_id else {
                return Ok((0, splice.clip_start_us, None, true));
            };
            let sql = format!(
                "SELECT {}, start_us FROM transcript_words WHERE transcript_id=?1 AND position=?2 AND kind='word'",
                crate::corrections::EFFECTIVE_TEXT
            );
            let row: Option<(String, i64)> = c
                .query_row(&sql, (tid, *position), |r| Ok((r.get(0)?, r.get(1)?)))
                .optional()?;
            let Some((raw_text, word_start_us)) = row else {
                return Ok((0, splice.clip_start_us, None, true));
            };
            let word_text = Some(raw_text.trim().to_owned());
            let kept = splice.segments.iter().find(|seg| {
                word_start_us >= seg.source_start_us && word_start_us <= seg.source_end_us
            });
            let Some(seg) = kept else {
                return Ok((0, word_start_us, word_text, true));
            };
            let out_us =
                (seg.output_start_us + (word_start_us - seg.source_start_us) + *offset_us).max(0);
            let src_us = splice.output_to_source(out_us);
            Ok((out_us, src_us, word_text, false))
        }
        SfxAnchor::Word {
            track: WordTrack::Narration,
            position,
            block_id: Some(bid),
            offset_us,
        } => {
            let Some(block) =
                montage_plan.and_then(|p| p.blocks.iter().find(|b| b.block_id == *bid))
            else {
                return Ok((0, splice.clip_start_us, None, true));
            };
            let nar_id: Option<i64> = c
                .query_row(
                    "SELECT nb.id
                     FROM narration_blocks nb
                     JOIN narration_alignments na ON na.narration_id=nb.id
                     WHERE nb.block_id=?1 AND na.audio_sha256=nb.sha256 AND na.status IN ('aligned','approved')
                     ORDER BY nb.id DESC LIMIT 1",
                    [*bid],
                    |r| r.get(0),
                )
                .optional()?;
            let Some(nid) = nar_id else {
                return Ok((0, splice.clip_start_us, None, true));
            };
            let status_choice: (String, Option<String>) = c.query_row(
                "SELECT status, choice FROM narration_alignments WHERE narration_id=?1",
                [nid],
                |r| Ok((r.get(0)?, r.get(1)?)),
            )?;
            let track = match status_choice.0.as_str() {
                "aligned" => "script",
                "approved" => status_choice.1.as_deref().unwrap_or("script"),
                _ => return Ok((0, splice.clip_start_us, None, true)),
            };
            let word: Option<(String, i64)> = c
                .query_row(
                    "SELECT text, start_us FROM narration_aligned_words WHERE narration_id=?1 AND track=?2 AND position=?3",
                    (nid, track, *position),
                    |r| Ok((r.get(0)?, r.get(1)?)),
                )
                .optional()?;
            let Some((raw_text, rel_start_us)) = word else {
                return Ok((0, splice.clip_start_us, None, true));
            };
            let out_us = (block.start_us + rel_start_us + *offset_us).max(0);
            let src_us = if out_us <= splice.output_duration_us {
                splice.output_to_source(out_us)
            } else {
                splice.clip_end_us
            };
            Ok((out_us, src_us, Some(raw_text.trim().to_owned()), false))
        }
        SfxAnchor::Word {
            track: WordTrack::Narration,
            block_id: None,
            ..
        } => Ok((0, splice.clip_start_us, None, true)),
    }
}

/// Resolve o estado completo de trilha + efeitos + intervalos de fala de um Corte para UI e export.
#[allow(clippy::too_many_arguments)]
pub(crate) fn resolve_audio_mix(
    project: &Path,
    soundtrack: Option<&SoundtrackEdit>,
    sfx_list: &[SfxEdit],
    transcript_id: Option<i64>,
    splice: &SpliceMap,
    candidate_id: Option<i64>,
    montage_plan: Option<&montage::MontagePlan>,
) -> Result<AudioMixView, CoreError> {
    let total_duration_us = montage_plan
        .map_or(splice.output_duration_us, |p| p.total_duration_us)
        .max(0);

    let approved = candidate_id.and_then(|cid| crate::selection::approved_cut(cid).ok());
    let (assets, speech_intervals, sfx_anchors) = projects::with_reader(|c| {
        let assets = load_assets_map(c)?;
        let speech = resolve_speech_intervals_for_clip(
            c,
            transcript_id,
            splice,
            approved.as_ref(),
            montage_plan,
        )?;
        let mut resolved_anchors = Vec::with_capacity(sfx_list.len());
        for s in sfx_list {
            resolved_anchors.push(resolve_sfx_anchor(
                c,
                &s.anchor,
                transcript_id,
                splice,
                montage_plan,
            )?);
        }
        Ok((assets, speech, resolved_anchors))
    })?;

    let mut warnings = Vec::new();
    let mut unverified_asset_ids = BTreeSet::new();

    let resolved_soundtrack = if let Some(st) = soundtrack {
        match assets.get(&st.asset_id) {
            Some(asset) if resolve_audio_rel_path(project, &asset.audio_rel_path).is_some() => {
                if !asset.license_verified {
                    unverified_asset_ids.insert(asset.id);
                }
                let start_us = st.start_us.clamp(0, total_duration_us);
                let remaining = (total_duration_us - start_us).max(0);
                let play_duration_us = if st.loop_to_fit {
                    remaining
                } else {
                    remaining.min(asset.duration_us)
                };
                let fade_in_us = st.fade_in_us.clamp(0, play_duration_us);
                let fade_out_us = st.fade_out_us.clamp(0, play_duration_us);
                Some(ResolvedSoundtrack {
                    asset_id: asset.id,
                    name: asset.name.clone(),
                    media_id: asset.media_id.clone(),
                    asset_duration_us: asset.duration_us,
                    start_us,
                    play_duration_us,
                    end_us: start_us + play_duration_us,
                    volume: st.volume,
                    fade_in_us,
                    fade_out_us,
                    loop_to_fit: st.loop_to_fit,
                    license_kind: asset.license_kind,
                    license_attribution: asset.license_attribution.clone(),
                    license_verified: asset.license_verified,
                })
            }
            _ => {
                warnings.push(AudioMixWarning {
                    code: "audio_asset_missing".into(),
                    message: "A trilha sonora selecionada não foi encontrada no Projeto.".into(),
                    sfx_id: None,
                    asset_id: Some(st.asset_id),
                });
                None
            }
        }
    } else {
        None
    };

    let mut resolved_sfx = Vec::with_capacity(sfx_list.len());
    for (s, (start_us, source_start_us, word_text, outside_clip)) in
        sfx_list.iter().zip(sfx_anchors)
    {
        match assets.get(&s.asset_id) {
            Some(asset) if resolve_audio_rel_path(project, &asset.audio_rel_path).is_some() => {
                if !asset.license_verified {
                    unverified_asset_ids.insert(asset.id);
                }
                if outside_clip {
                    warnings.push(AudioMixWarning {
                        code: "sfx_anchor_outside_clip".into(),
                        message: "A palavra de âncora deste efeito ficou fora do Corte atual."
                            .into(),
                        sfx_id: Some(s.id),
                        asset_id: Some(asset.id),
                    });
                }
                let play_dur = if outside_clip {
                    0
                } else {
                    (total_duration_us - start_us).clamp(0, asset.duration_us)
                };
                resolved_sfx.push(ResolvedSfx {
                    id: s.id,
                    asset_id: asset.id,
                    name: asset.name.clone(),
                    media_id: asset.media_id.clone(),
                    asset_duration_us: asset.duration_us,
                    anchor: s.anchor.clone(),
                    word_text,
                    start_us,
                    end_us: start_us + play_dur,
                    source_start_us,
                    volume: s.volume,
                    fade_in_us: s.fade_in_us.clamp(0, play_dur),
                    fade_out_us: s.fade_out_us.clamp(0, play_dur),
                    outside_clip,
                    license_kind: asset.license_kind,
                    license_attribution: asset.license_attribution.clone(),
                    license_verified: asset.license_verified,
                });
            }
            _ => {
                warnings.push(AudioMixWarning {
                    code: "audio_asset_missing".into(),
                    message: "Um efeito sonoro selecionado não foi encontrado no Projeto.".into(),
                    sfx_id: Some(s.id),
                    asset_id: Some(s.asset_id),
                });
            }
        }
    }

    Ok(AudioMixView {
        soundtrack: resolved_soundtrack,
        sfx: resolved_sfx,
        speech_intervals,
        total_duration_us,
        unverified_count: unverified_asset_ids.len(),
        warnings,
    })
}

/// Resumo para o checklist #76 dado o conjunto de IDs de `audio_assets` usados em um Corte.
#[derive(Clone, Debug, Default)]
pub(crate) struct GuardrailAudioSummary {
    pub has_audio: bool,
    pub asset_count: usize,
    pub unverified_count: usize,
}

pub(crate) fn guardrail_summary_for_assets(
    c: &Connection,
    asset_ids: &[i64],
) -> rusqlite::Result<GuardrailAudioSummary> {
    if asset_ids.is_empty() {
        return Ok(GuardrailAudioSummary::default());
    }
    let unique: BTreeSet<i64> = asset_ids.iter().copied().collect();
    let mut asset_count = 0usize;
    let mut unverified_count = 0usize;
    for id in unique {
        let kind: Option<String> = c
            .query_row(
                "SELECT license_kind FROM audio_assets WHERE id=?1",
                [id],
                |r| r.get(0),
            )
            .optional()?;
        if let Some(raw) = kind {
            asset_count += 1;
            if !LicenseKind::parse(&raw)
                .unwrap_or(LicenseKind::Unknown)
                .is_verified()
            {
                unverified_count += 1;
            }
        }
    }
    Ok(GuardrailAudioSummary {
        has_audio: asset_count > 0,
        asset_count,
        unverified_count,
    })
}

/// Atribuições CC-BY dos áudios ligados ao Corte aprovado do candidato, para o Empacotamento (#68).
pub(crate) fn cc_by_attributions_for_candidate(
    candidate_id: i64,
) -> Result<Vec<String>, CoreError> {
    let asset_ids = crate::editor::edits::audio_asset_ids_for_candidate(candidate_id)?;
    if asset_ids.is_empty() {
        return Ok(Vec::new());
    }
    projects::with_reader(|c| {
        let mut out = Vec::new();
        let mut seen = BTreeSet::new();
        for id in asset_ids {
            if !seen.insert(id) {
                continue;
            }
            let row: Option<(String, String)> = c
                .query_row(
                    "SELECT license_kind, license_attribution FROM audio_assets WHERE id=?1",
                    [id],
                    |r| Ok((r.get(0)?, r.get(1)?)),
                )
                .optional()?;
            if let Some((kind, attr)) = row {
                if kind == "cc_by" {
                    let clean = attr.trim();
                    if !clean.is_empty() {
                        out.push(clean.to_owned());
                    }
                }
            }
        }
        Ok(out)
    })
}

inventory::submit! { CommandRegistration { name: "audio.import", execute: cmd_import } }
inventory::submit! { CommandRegistration { name: "audio.list", execute: cmd_list } }
inventory::submit! { CommandRegistration { name: "audio.license.set", execute: cmd_license_set } }
inventory::submit! { CommandRegistration { name: "audio.delete", execute: cmd_delete } }

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn merge_speech_intervals_coalesces_overlapping_and_close_gaps() {
        let raw = vec![
            SpeechInterval {
                start_us: 2_000_000,
                end_us: 3_000_000,
            },
            SpeechInterval {
                start_us: 500_000,
                end_us: 1_200_000,
            },
            SpeechInterval {
                start_us: 1_400_000,
                end_us: 1_900_000,
            }, // gap 200 ms <= 300 ms -> junta com 0.5..1.2 e depois gap 100 ms <= 300 ms -> junta com 2.0..3.0
            SpeechInterval {
                start_us: 4_500_000,
                end_us: 5_000_000,
            }, // gap 1.5 s > 300 ms -> separado
        ];
        let merged = merge_speech_intervals(raw, SPEECH_DUCK_MERGE_GAP_US);
        assert_eq!(
            merged,
            vec![
                SpeechInterval {
                    start_us: 500_000,
                    end_us: 3_000_000
                },
                SpeechInterval {
                    start_us: 4_500_000,
                    end_us: 5_000_000
                },
            ]
        );
    }

    #[test]
    fn cc_by_requires_non_empty_attribution_and_sanitizes() {
        assert_eq!(
            normalize_license(Some("cc_by"), Some("   "))
                .unwrap_err()
                .code,
            "attribution_required"
        );
        assert_eq!(
            normalize_license(Some("cc_by"), None).unwrap_err().code,
            "attribution_required"
        );
        let (k, attr) = normalize_license(Some("cc_by"), Some("  <Track> by Artist\n")).unwrap();
        assert_eq!(k, LicenseKind::CcBy);
        assert_eq!(attr, "Track by Artist");
        assert!(k.is_verified());
        assert!(!LicenseKind::Unknown.is_verified());
    }
}
