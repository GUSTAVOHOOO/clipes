//! Catálogo remoto assinado de modelos de Transcrição, detecção e TTS (#256).
//!
//! O manifesto compilado em `catalog/models.json` é o fallback offline garantido.
//! Atualizações remotas vêm de releases `catalog-N` com assinatura Ed25519 destacada
//! (`catalog.json.sig`), verificada contra a chave pública embutida antes de gravar ou usar.
//! Versões menores que a conhecida (ou que a embutida) são recusadas (anti-rollback).

use super::{error, load_settings, Settings};
use crate::{CommandRegistration, CommandResult, CoreError, EventSink};
use ed25519_dalek::{Signature, VerifyingKey};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::{
    collections::HashSet,
    fs,
    io::Read,
    path::{Path, PathBuf},
    sync::{Mutex, OnceLock},
    time::Duration,
};

const EMBEDDED_CATALOG_JSON: &str = include_str!("../../../catalog/models.json");
const DEFAULT_RELEASES_URL: &str =
    "https://api.github.com/repos/GUSTAVOHOOO/clipes/releases?per_page=100";
const MAX_CATALOG_BYTES: u64 = 1_048_576;
const CATALOG_DIR_NAME: &str = "catalog";
const CATALOG_FILE_NAME: &str = "catalog.json";
const CATALOG_SIG_NAME: &str = "catalog.json.sig";

/// Chave pública Ed25519 em hexadecimal (32 bytes / 64 caracteres hex) usada para verificar
/// o catálogo remoto assinado (#256).
pub(crate) const CATALOG_PUBLIC_KEY_HEX: &str =
    "0000000000000000000000000000000000000000000000000000000000000000";

static EMBEDDED_CACHE: OnceLock<CatalogManifest> = OnceLock::new();
static CHECK_LOCK: OnceLock<Mutex<()>> = OnceLock::new();

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub(crate) struct CatalogModelFile {
    pub name: String,
    pub size: u64,
    pub sha256: String,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub(crate) struct CatalogModel {
    pub id: String,
    pub label: String,
    pub repo: String,
    #[serde(default)]
    pub former_repo: Option<String>,
    pub revision: String,
    pub license: String,
    pub device: String,
    pub files: Vec<CatalogModelFile>,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub(crate) struct CatalogTtsEngine {
    pub id: String,
    pub label: String,
    pub component_id: String,
    pub code_license: String,
    pub source_url: String,
    pub supports_quantize: bool,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub(crate) struct CatalogTtsFile {
    pub name: String,
    pub url: String,
    pub size: u64,
    pub sha256: String,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub(crate) struct CatalogTtsModel {
    pub id: String,
    pub engine_id: String,
    pub language: String,
    pub label: String,
    pub description: String,
    pub default_for_language: bool,
    pub lightweight: bool,
    pub repo: String,
    pub revision: String,
    pub license: String,
    pub files: Vec<CatalogTtsFile>,
    #[serde(default)]
    pub config_template: Option<String>,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub(crate) struct CatalogTtsEmbedding {
    pub model_id: String,
    pub filename: String,
    pub size: u64,
    pub sha256: String,
    #[serde(default)]
    pub url: Option<String>,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub(crate) struct CatalogTtsVoice {
    pub id: String,
    pub engine_id: String,
    pub language: String,
    pub gender: String,
    pub label: String,
    pub default_for_language: bool,
    pub license: String,
    pub attribution: String,
    pub source_url: String,
    pub embeddings: Vec<CatalogTtsEmbedding>,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub(crate) struct CatalogTtsSection {
    pub voice_release_base_url: String,
    pub engines: Vec<CatalogTtsEngine>,
    pub models: Vec<CatalogTtsModel>,
    pub voices: Vec<CatalogTtsVoice>,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub(crate) struct CatalogManifest {
    pub version: u64,
    pub models: Vec<CatalogModel>,
    pub tts: CatalogTtsSection,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(crate) enum CatalogSource {
    Embedded,
    Remote,
}

impl CatalogSource {
    pub(crate) fn as_str(self) -> &'static str {
        match self {
            Self::Embedded => "embedded",
            Self::Remote => "remote",
        }
    }
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(crate) struct CatalogWarning {
    pub code: &'static str,
    pub message: &'static str,
}

#[derive(Clone, Debug)]
pub(crate) struct ActiveCatalog {
    pub manifest: CatalogManifest,
    pub source: CatalogSource,
    pub embedded_version: u64,
    pub warning: Option<CatalogWarning>,
}

pub(crate) fn embedded_catalog() -> &'static CatalogManifest {
    EMBEDDED_CACHE.get_or_init(|| {
        let parsed: CatalogManifest = serde_json::from_str(EMBEDDED_CATALOG_JSON)
            .expect("catálogo embutido catalog/models.json deve ser JSON válido");
        validate_catalog(&parsed).expect("catálogo embutido catalog/models.json deve ser válido");
        parsed
    })
}

fn catalog_dir(settings: &Settings) -> PathBuf {
    settings.data_dir.join(CATALOG_DIR_NAME)
}

fn catalog_file(settings: &Settings) -> PathBuf {
    catalog_dir(settings).join(CATALOG_FILE_NAME)
}

fn catalog_sig_file(settings: &Settings) -> PathBuf {
    catalog_dir(settings).join(CATALOG_SIG_NAME)
}

fn decode_hex(s: &str) -> Option<Vec<u8>> {
    let s = s.trim();
    if !s.len().is_multiple_of(2) || s.is_empty() {
        return None;
    }
    let mut out = Vec::with_capacity(s.len() / 2);
    let (chunks, _) = s.as_bytes().as_chunks::<2>();
    for [hi_b, lo_b] in chunks {
        let hi = (*hi_b as char).to_digit(16)?;
        let lo = (*lo_b as char).to_digit(16)?;
        out.push(((hi << 4) | lo) as u8);
    }
    Some(out)
}

pub(crate) fn parse_public_key_hex(hex_str: &str) -> Result<VerifyingKey, CoreError> {
    let invalid = || error("catalog_key_invalid", "Chave pública do catálogo inválida.");
    let bytes = decode_hex(hex_str).ok_or_else(invalid)?;
    let arr: [u8; 32] = bytes.try_into().map_err(|_| invalid())?;
    VerifyingKey::from_bytes(&arr).map_err(|_| invalid())
}

fn effective_public_key() -> Result<VerifyingKey, CoreError> {
    if crate::paths::is_cargo_test_binary() {
        if let Ok(test_hex) = std::env::var("CLIPES_TEST_CATALOG_PUBKEY") {
            if !test_hex.trim().is_empty() {
                return parse_public_key_hex(&test_hex);
            }
        }
    }
    parse_public_key_hex(CATALOG_PUBLIC_KEY_HEX)
}

fn parse_signature_bytes(sig_bytes: &[u8]) -> Result<Signature, CoreError> {
    let invalid = || {
        error(
            "catalog_signature_invalid",
            "Assinatura do catálogo remoto inválida; usando o catálogo embutido.",
        )
    };
    let text = std::str::from_utf8(sig_bytes).map_err(|_| invalid())?;
    let trimmed = text.trim();
    if trimmed.len() != 128 {
        return Err(invalid());
    }
    let decoded = decode_hex(trimmed).ok_or_else(invalid)?;
    let arr: [u8; 64] = decoded.try_into().map_err(|_| invalid())?;
    Ok(Signature::from_bytes(&arr))
}

fn is_allowed_license(license: &str) -> bool {
    matches!(
        license,
        "MIT"
            | "BSL-1.0"
            | "Apache-2.0"
            | "BSD-2-Clause"
            | "BSD-3-Clause"
            | "ISC"
            | "Zlib"
            | "Unicode-3.0"
            | "MPL-2.0"
            | "MIT-0"
            | "CDLA-Permissive-2.0"
            | "bzip2-1.0.6"
            | "OFL-1.1"
            | "0BSD"
            | "Unlicense"
            | "Apache-2.0 WITH LLVM-exception"
            | "CC-BY-4.0"
            | "CC0-1.0"
    )
}

fn is_safe_id(id: &str) -> bool {
    !id.is_empty()
        && id.len() <= 64
        && id
            .bytes()
            .all(|b| b.is_ascii_alphanumeric() || b == b'_' || b == b'-')
}

fn is_safe_filename(name: &str) -> bool {
    !name.is_empty()
        && name != "."
        && name != ".."
        && !name.contains('/')
        && !name.contains('\\')
        && !name.contains("..")
}

fn is_valid_sha256(sha: &str) -> bool {
    sha.len() == 64 && sha.bytes().all(|b| b.is_ascii_hexdigit())
}

fn is_valid_revision(rev: &str) -> bool {
    rev.len() == 40 && rev.bytes().all(|b| b.is_ascii_hexdigit())
}

fn is_valid_repo(repo: &str) -> bool {
    let Some((owner, name)) = repo.split_once('/') else {
        return false;
    };
    let valid_part = |part: &str| {
        !part.is_empty()
            && part != "."
            && part != ".."
            && part
                .bytes()
                .all(|b| b.is_ascii_alphanumeric() || matches!(b, b'_' | b'-' | b'.'))
    };
    valid_part(owner) && valid_part(name)
}

fn is_allowed_asset_url(raw: &str) -> bool {
    let Ok(url) = reqwest::Url::parse(raw) else {
        return false;
    };
    let host = url.host_str().unwrap_or("");
    url.scheme() == "https"
        && [
            "huggingface.co",
            "hf.co",
            "github.com",
            "githubusercontent.com",
        ]
        .iter()
        .any(|root| host == *root || host.ends_with(&format!(".{root}")))
}

fn is_allowed_https_url(raw: &str) -> bool {
    reqwest::Url::parse(raw).is_ok_and(|u| u.scheme() == "https" && u.host_str().is_some())
}

pub(crate) fn validate_catalog(manifest: &CatalogManifest) -> Result<(), CoreError> {
    let invalid = || {
        error(
            "catalog_invalid",
            "Catálogo remoto inválido; usando o catálogo embutido.",
        )
    };
    if manifest.version == 0 || manifest.models.is_empty() {
        return Err(invalid());
    }
    let mut model_ids = HashSet::new();
    for m in &manifest.models {
        if !is_safe_id(&m.id)
            || m.label.trim().is_empty()
            || !is_valid_repo(&m.repo)
            || !is_valid_revision(&m.revision)
            || !is_allowed_license(&m.license)
            || !matches!(m.device.as_str(), "cuda" | "cpu")
            || m.files.is_empty()
            || !model_ids.insert(m.id.as_str())
        {
            return Err(invalid());
        }
        if let Some(former) = &m.former_repo {
            if !is_valid_repo(former) {
                return Err(invalid());
            }
        }
        let mut file_names = HashSet::new();
        for f in &m.files {
            if !is_safe_filename(&f.name)
                || f.size == 0
                || !is_valid_sha256(&f.sha256)
                || !file_names.insert(f.name.as_str())
            {
                return Err(invalid());
            }
        }
        if !m
            .files
            .iter()
            .any(|f| f.name == "model.bin" || f.name.ends_with(".onnx"))
        {
            return Err(invalid());
        }
    }
    for required in ["whisper-turbo", "whisper-small", "yunet"] {
        if !model_ids.contains(required) {
            return Err(invalid());
        }
    }

    let tts = &manifest.tts;
    if !is_allowed_asset_url(&tts.voice_release_base_url) || tts.engines.is_empty() {
        return Err(invalid());
    }
    let mut engine_ids = HashSet::new();
    for e in &tts.engines {
        if !is_safe_id(&e.id)
            || e.label.trim().is_empty()
            || !is_safe_id(&e.component_id)
            || !is_allowed_license(&e.code_license)
            || !is_allowed_https_url(&e.source_url)
            || !engine_ids.insert(e.id.as_str())
        {
            return Err(invalid());
        }
    }
    let mut tts_model_ids = HashSet::new();
    for m in &tts.models {
        if !is_safe_id(&m.id)
            || !engine_ids.contains(m.engine_id.as_str())
            || !matches!(m.language.as_str(), "pt" | "en")
            || m.label.trim().is_empty()
            || m.description.trim().is_empty()
            || !is_valid_repo(&m.repo)
            || !is_valid_revision(&m.revision)
            || !is_allowed_license(&m.license)
            || m.files.is_empty()
            || !tts_model_ids.insert(m.id.as_str())
        {
            return Err(invalid());
        }
        if m.config_template
            .as_deref()
            .is_some_and(|tpl| tpl.trim().is_empty())
        {
            return Err(invalid());
        }
        let mut names = HashSet::new();
        for f in &m.files {
            if !is_safe_filename(&f.name)
                || !is_allowed_asset_url(&f.url)
                || f.size == 0
                || !is_valid_sha256(&f.sha256)
                || !names.insert(f.name.as_str())
            {
                return Err(invalid());
            }
        }
    }
    if !tts.models.iter().any(|m| m.language == "pt")
        || !tts.models.iter().any(|m| m.language == "en")
    {
        return Err(invalid());
    }
    let mut voice_ids = HashSet::new();
    for v in &tts.voices {
        if !is_safe_id(&v.id)
            || matches!(v.id.as_str(), "rafael" | "cosette" | "jean")
            || !engine_ids.contains(v.engine_id.as_str())
            || !matches!(v.language.as_str(), "pt" | "en")
            || v.label.trim().is_empty()
            || !is_allowed_license(&v.license)
            || !is_allowed_https_url(&v.source_url)
            || v.embeddings.is_empty()
            || !voice_ids.insert(v.id.as_str())
        {
            return Err(invalid());
        }
        for emb in &v.embeddings {
            if !tts_model_ids.contains(emb.model_id.as_str())
                || !is_safe_filename(&emb.filename)
                || emb.size == 0
                || !is_valid_sha256(&emb.sha256)
            {
                return Err(invalid());
            }
            if let Some(url) = &emb.url {
                if !is_allowed_asset_url(url) {
                    return Err(invalid());
                }
            }
        }
    }
    Ok(())
}

/// Verifica assinatura Ed25519, faz parsing do JSON, impõe anti-rollback (`version >= min_version`)
/// e valida todas as entradas do catálogo.
pub(crate) fn verify_and_parse_catalog(
    manifest_bytes: &[u8],
    sig_bytes: &[u8],
    pubkey: &VerifyingKey,
    min_version: u64,
) -> Result<CatalogManifest, CoreError> {
    if manifest_bytes.len() as u64 > MAX_CATALOG_BYTES || sig_bytes.len() > 512 {
        return Err(error(
            "catalog_invalid",
            "Catálogo remoto inválido; usando o catálogo embutido.",
        ));
    }
    let signature = parse_signature_bytes(sig_bytes)?;
    pubkey
        .verify_strict(manifest_bytes, &signature)
        .map_err(|_| {
            error(
                "catalog_signature_invalid",
                "Assinatura do catálogo remoto inválida; usando o catálogo embutido.",
            )
        })?;
    let manifest: CatalogManifest = serde_json::from_slice(manifest_bytes).map_err(|_| {
        error(
            "catalog_invalid",
            "Catálogo remoto inválido; usando o catálogo embutido.",
        )
    })?;
    if manifest.version < min_version {
        return Err(error(
            "catalog_rollback",
            "Versão do catálogo remoto menor que a conhecida; atualização recusada.",
        ));
    }
    validate_catalog(&manifest)?;
    Ok(manifest)
}

fn read_limited_file(path: &Path, max: u64) -> Option<Vec<u8>> {
    let meta = fs::metadata(path).ok()?;
    if meta.len() > max {
        return None;
    }
    fs::read(path).ok()
}

pub(crate) fn load_active_catalog(settings: &Settings) -> ActiveCatalog {
    load_active_catalog_with(settings, effective_public_key().ok().as_ref())
}

fn load_active_catalog_with(settings: &Settings, pubkey: Option<&VerifyingKey>) -> ActiveCatalog {
    let embedded = embedded_catalog();
    let json_path = catalog_file(settings);
    let sig_path = catalog_sig_file(settings);
    let has_json = json_path.exists();
    let has_sig = sig_path.exists();
    if !has_json && !has_sig {
        return ActiveCatalog {
            manifest: embedded.clone(),
            source: CatalogSource::Embedded,
            embedded_version: embedded.version,
            warning: None,
        };
    }
    let fallback_with = |code: &'static str, message: &'static str| ActiveCatalog {
        manifest: embedded.clone(),
        source: CatalogSource::Embedded,
        embedded_version: embedded.version,
        warning: Some(CatalogWarning { code, message }),
    };
    if !has_json || !has_sig {
        return fallback_with(
            "catalog_signature_invalid",
            "Assinatura do catálogo em cache inválida; usando o catálogo embutido.",
        );
    }
    let Some(manifest_bytes) = read_limited_file(&json_path, MAX_CATALOG_BYTES) else {
        return fallback_with(
            "catalog_invalid",
            "Catálogo em cache inválido; usando o catálogo embutido.",
        );
    };
    let Some(sig_bytes) = read_limited_file(&sig_path, 512) else {
        return fallback_with(
            "catalog_signature_invalid",
            "Assinatura do catálogo em cache inválida; usando o catálogo embutido.",
        );
    };
    let Some(pubkey) = pubkey else {
        return fallback_with(
            "catalog_key_invalid",
            "Chave pública do catálogo inválida; usando o catálogo embutido.",
        );
    };
    // Versão menor que a embutida significa que o app foi atualizado com catálogo mais novo.
    match verify_and_parse_catalog(&manifest_bytes, &sig_bytes, pubkey, 1) {
        Ok(manifest) if manifest.version > embedded.version => ActiveCatalog {
            manifest,
            source: CatalogSource::Remote,
            embedded_version: embedded.version,
            warning: None,
        },
        Ok(_) => ActiveCatalog {
            manifest: embedded.clone(),
            source: CatalogSource::Embedded,
            embedded_version: embedded.version,
            warning: None,
        },
        Err(err) => {
            let (code, message) = match err.code.as_str() {
                "catalog_signature_invalid" => (
                    "catalog_signature_invalid",
                    "Assinatura do catálogo em cache inválida; usando o catálogo embutido.",
                ),
                _ => (
                    "catalog_invalid",
                    "Catálogo em cache inválido; usando o catálogo embutido.",
                ),
            };
            fallback_with(code, message)
        }
    }
}

fn is_loopback_http(url: &reqwest::Url) -> bool {
    url.scheme() == "http" && matches!(url.host_str(), Some("127.0.0.1" | "localhost" | "::1"))
}

fn test_catalog_base_url() -> Option<String> {
    if !crate::paths::is_cargo_test_binary() {
        return None;
    }
    let raw = std::env::var("CLIPES_TEST_CATALOG_URL").ok()?;
    let url = reqwest::Url::parse(raw.trim()).ok()?;
    is_loopback_http(&url).then(|| raw.trim().trim_end_matches('/').to_owned())
}

fn allowed_catalog_url(url: &reqwest::Url, loopback_override: Option<&reqwest::Url>) -> bool {
    if let Some(allowed_loopback) = loopback_override {
        return url.scheme() == allowed_loopback.scheme()
            && url.host_str() == allowed_loopback.host_str()
            && url.port_or_known_default() == allowed_loopback.port_or_known_default();
    }
    let host = url.host_str().unwrap_or("");
    url.scheme() == "https"
        && ["api.github.com", "github.com", "githubusercontent.com"]
            .iter()
            .any(|root| host == *root || host.ends_with(&format!(".{root}")))
}

fn catalog_http_client(
    loopback_override: Option<reqwest::Url>,
) -> Result<reqwest::blocking::Client, CoreError> {
    reqwest::blocking::Client::builder()
        .user_agent("Clipes-catalog-update")
        .timeout(Duration::from_secs(30))
        .redirect(reqwest::redirect::Policy::custom(move |attempt| {
            if attempt.previous().len() >= 5
                || !allowed_catalog_url(attempt.url(), loopback_override.as_ref())
            {
                attempt.error("redirecionamento não permitido")
            } else {
                attempt.follow()
            }
        }))
        .build()
        .map_err(|_| {
            error(
                "catalog_network",
                "Não foi possível consultar o catálogo remoto de modelos.",
            )
        })
}

fn fetch_limited(
    client: &reqwest::blocking::Client,
    url: &str,
    max: u64,
    loopback_override: Option<&reqwest::Url>,
) -> Result<Vec<u8>, CoreError> {
    let parsed = reqwest::Url::parse(url).map_err(|_| {
        error(
            "catalog_invalid",
            "Catálogo remoto inválido; usando o catálogo embutido.",
        )
    })?;
    if !allowed_catalog_url(&parsed, loopback_override) {
        return Err(error(
            "catalog_invalid",
            "Catálogo remoto inválido; usando o catálogo embutido.",
        ));
    }
    let mut response = client
        .get(parsed)
        .send()
        .and_then(|r| r.error_for_status())
        .map_err(|_| {
            error(
                "catalog_network",
                "Não foi possível consultar o catálogo remoto de modelos.",
            )
        })?;
    let mut bytes = Vec::new();
    let mut chunk = [0u8; 8192];
    loop {
        let n = response.read(&mut chunk).map_err(|_| {
            error(
                "catalog_network",
                "Não foi possível consultar o catálogo remoto de modelos.",
            )
        })?;
        if n == 0 {
            break;
        }
        if bytes.len() as u64 + n as u64 > max {
            return Err(error(
                "catalog_invalid",
                "Catálogo remoto inválido; usando o catálogo embutido.",
            ));
        }
        bytes.extend_from_slice(&chunk[..n]);
    }
    Ok(bytes)
}

fn parse_catalog_tag_version(tag: &str) -> Option<u64> {
    let suffix = tag.strip_prefix("catalog-")?;
    if suffix.is_empty() || !suffix.bytes().all(|b| b.is_ascii_digit()) {
        return None;
    }
    suffix.parse::<u64>().ok().filter(|v| *v > 0)
}

fn persist_verified_catalog(
    settings: &Settings,
    manifest_bytes: &[u8],
    sig_bytes: &[u8],
) -> Result<(), CoreError> {
    let dir = catalog_dir(settings);
    fs::create_dir_all(&dir).map_err(|_| {
        error(
            "catalog_io",
            "Não foi possível salvar o catálogo de modelos.",
        )
    })?;
    let json_dst = catalog_file(settings);
    let sig_dst = catalog_sig_file(settings);
    let json_part = dir.join("catalog.json.part");
    let sig_part = dir.join("catalog.json.sig.part");
    let json_bak = dir.join("catalog.json.bak");
    let sig_bak = dir.join("catalog.json.sig.bak");

    let io_err = || {
        error(
            "catalog_io",
            "Não foi possível salvar o catálogo de modelos.",
        )
    };
    if fs::write(&sig_part, sig_bytes).is_err() || fs::write(&json_part, manifest_bytes).is_err() {
        let _ = fs::remove_file(&sig_part);
        let _ = fs::remove_file(&json_part);
        return Err(io_err());
    }
    let had_json = json_dst.exists();
    let had_sig = sig_dst.exists();
    if had_json && fs::rename(&json_dst, &json_bak).is_err() {
        let _ = fs::remove_file(&sig_part);
        let _ = fs::remove_file(&json_part);
        return Err(io_err());
    }
    if had_sig && fs::rename(&sig_dst, &sig_bak).is_err() {
        if had_json {
            let _ = fs::rename(&json_bak, &json_dst);
        }
        let _ = fs::remove_file(&sig_part);
        let _ = fs::remove_file(&json_part);
        return Err(io_err());
    }
    if fs::rename(&sig_part, &sig_dst).is_err() || fs::rename(&json_part, &json_dst).is_err() {
        let _ = fs::remove_file(&sig_dst);
        let _ = fs::remove_file(&json_dst);
        if had_sig {
            let _ = fs::rename(&sig_bak, &sig_dst);
        }
        if had_json {
            let _ = fs::rename(&json_bak, &json_dst);
        }
        let _ = fs::remove_file(&sig_part);
        let _ = fs::remove_file(&json_part);
        return Err(io_err());
    }
    let _ = fs::remove_file(&json_bak);
    let _ = fs::remove_file(&sig_bak);
    Ok(())
}

pub(crate) fn check_for_update_with(
    settings: &Settings,
    releases_url: &str,
    pubkey: &VerifyingKey,
    loopback_override: Option<&reqwest::Url>,
) -> Result<Value, CoreError> {
    let active = load_active_catalog_with(settings, Some(pubkey));
    let known_version = active.manifest.version;
    let client = catalog_http_client(loopback_override.cloned())?;
    let releases_bytes =
        fetch_limited(&client, releases_url, MAX_CATALOG_BYTES, loopback_override)?;
    let releases: Vec<Value> = serde_json::from_slice(&releases_bytes).map_err(|_| {
        error(
            "catalog_invalid",
            "Catálogo remoto inválido; usando o catálogo embutido.",
        )
    })?;

    let latest = releases
        .iter()
        .filter(|rel| rel["draft"] != true)
        .filter_map(|rel| {
            let tag = rel["tag_name"].as_str()?;
            let ver = parse_catalog_tag_version(tag)?;
            Some((ver, rel))
        })
        .max_by_key(|(ver, _)| *ver);

    let Some((remote_tag_version, release)) = latest else {
        return Ok(json!({
            "version": active.manifest.version,
            "previousVersion": active.manifest.version,
            "embeddedVersion": active.embedded_version,
            "source": active.source.as_str(),
            "updated": false,
            "upToDate": true,
            "warning": active.warning.map(|w| w.message),
            "warningCode": active.warning.map(|w| w.code),
        }));
    };

    if remote_tag_version < known_version {
        crate::diagnostic::record(crate::diagnostic::DiagnosticEvent::CatalogVerificationFailed);
        return Err(error(
            "catalog_rollback",
            "Versão do catálogo remoto menor que a conhecida; atualização recusada.",
        ));
    }
    if remote_tag_version == known_version && active.warning.is_none() {
        return Ok(json!({
            "version": active.manifest.version,
            "previousVersion": active.manifest.version,
            "embeddedVersion": active.embedded_version,
            "source": active.source.as_str(),
            "updated": false,
            "upToDate": true,
            "warning": Value::Null,
            "warningCode": Value::Null,
        }));
    }

    let assets = release["assets"].as_array().ok_or_else(|| {
        error(
            "catalog_invalid",
            "Catálogo remoto inválido; usando o catálogo embutido.",
        )
    })?;
    let asset_url = |name: &str| -> Option<&str> {
        assets
            .iter()
            .find(|a| a["name"].as_str() == Some(name))
            .and_then(|a| a["browser_download_url"].as_str())
    };
    let Some(json_url) = asset_url(CATALOG_FILE_NAME) else {
        crate::diagnostic::record(crate::diagnostic::DiagnosticEvent::CatalogVerificationFailed);
        return Err(error(
            "catalog_invalid",
            "Catálogo remoto inválido; usando o catálogo embutido.",
        ));
    };
    let Some(sig_url) = asset_url(CATALOG_SIG_NAME) else {
        crate::diagnostic::record(crate::diagnostic::DiagnosticEvent::CatalogVerificationFailed);
        return Err(error(
            "catalog_signature_invalid",
            "Assinatura do catálogo remoto ausente; usando o catálogo embutido.",
        ));
    };

    let manifest_bytes = fetch_limited(&client, json_url, MAX_CATALOG_BYTES, loopback_override)?;
    let sig_bytes = fetch_limited(&client, sig_url, 512, loopback_override)?;
    let verified =
        match verify_and_parse_catalog(&manifest_bytes, &sig_bytes, pubkey, known_version) {
            Ok(m) if m.version == remote_tag_version => m,
            Ok(_) => {
                crate::diagnostic::record(
                    crate::diagnostic::DiagnosticEvent::CatalogVerificationFailed,
                );
                return Err(error(
                    "catalog_invalid",
                    "Catálogo remoto inválido; usando o catálogo embutido.",
                ));
            }
            Err(err) => {
                crate::diagnostic::record(
                    crate::diagnostic::DiagnosticEvent::CatalogVerificationFailed,
                );
                return Err(err);
            }
        };

    persist_verified_catalog(settings, &manifest_bytes, &sig_bytes)?;
    Ok(json!({
        "version": verified.version,
        "previousVersion": known_version,
        "embeddedVersion": active.embedded_version,
        "source": CatalogSource::Remote.as_str(),
        "updated": verified.version > known_version,
        "upToDate": verified.version == known_version,
        "warning": Value::Null,
        "warningCode": Value::Null,
    }))
}

fn cmd_status(_: Value, _: &mut EventSink<'_>) -> CommandResult {
    let settings = load_settings()?;
    let active = load_active_catalog(&settings);
    Ok(json!({
        "version": active.manifest.version,
        "embeddedVersion": active.embedded_version,
        "source": active.source.as_str(),
        "warning": active.warning.map(|w| w.message),
        "warningCode": active.warning.map(|w| w.code),
    }))
}

fn cmd_check(_: Value, events: &mut EventSink<'_>) -> CommandResult {
    let _guard = CHECK_LOCK
        .get_or_init(|| Mutex::new(()))
        .lock()
        .unwrap_or_else(|e| e.into_inner());
    let settings = load_settings()?;
    let pubkey = effective_public_key()?;
    let test_base = test_catalog_base_url();
    let (releases_url, loopback_override) = match &test_base {
        Some(base) => {
            let parsed = reqwest::Url::parse(base).map_err(|_| {
                error(
                    "catalog_network",
                    "Não foi possível consultar o catálogo remoto de modelos.",
                )
            })?;
            (format!("{base}/releases"), Some(parsed))
        }
        None => (DEFAULT_RELEASES_URL.to_owned(), None),
    };
    let result = check_for_update_with(
        &settings,
        &releases_url,
        &pubkey,
        loopback_override.as_ref(),
    )?;
    events(crate::ProgressEvent {
        project: None,
        job: "catalog".into(),
        stage: "complete".into(),
        percentage: 100,
        message: "Catálogo de modelos verificado".into(),
        error: None,
    });
    Ok(result)
}

inventory::submit! { CommandRegistration { name: "components.catalog.status", execute: cmd_status } }
inventory::submit! { CommandRegistration { name: "components.catalog.check", execute: cmd_check } }

#[cfg(test)]
mod tests {
    use super::*;
    use ed25519_dalek::{Signer, SigningKey};
    use rand::RngCore;
    use std::{io::Write, net::TcpListener, thread};

    fn test_keypair() -> (SigningKey, VerifyingKey) {
        let mut seed = [0u8; 32];
        rand::thread_rng().fill_bytes(&mut seed);
        let signing = SigningKey::from_bytes(&seed);
        let verifying = signing.verifying_key();
        (signing, verifying)
    }

    fn sign_hex(signing: &SigningKey, payload: &[u8]) -> Vec<u8> {
        let sig = signing.sign(payload);
        let mut hex = String::with_capacity(129);
        for b in sig.to_bytes() {
            use std::fmt::Write;
            let _ = write!(&mut hex, "{b:02x}");
        }
        hex.push('\n');
        hex.into_bytes()
    }

    fn test_settings(dir: &Path) -> Settings {
        Settings {
            data_dir: dir.to_path_buf(),
            cache_dir: dir.join("cache"),
            cache_limit_bytes: 1,
            ffmpeg_path: None,
        }
    }

    #[test]
    fn embedded_catalog_is_valid_and_complete() {
        let cat = embedded_catalog();
        assert_eq!(cat.version, 1);
        assert_eq!(cat.models.len(), 3);
        assert_eq!(cat.tts.models.len(), 3);
        assert_eq!(cat.tts.voices.len(), 3);
    }

    #[test]
    fn verifies_signed_catalog_and_rejects_invalid_signature_tampering_and_rollback() {
        let (signing, verifying) = test_keypair();
        let (_, other_verifying) = test_keypair();

        let mut updated = embedded_catalog().clone();
        updated.version = 2;
        updated.models[1].revision = "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa".into();
        let payload = serde_json::to_vec(&updated).unwrap();
        let sig = sign_hex(&signing, &payload);

        let parsed = verify_and_parse_catalog(&payload, &sig, &verifying, 1).unwrap();
        assert_eq!(parsed.version, 2);

        // Chave errada
        assert_eq!(
            verify_and_parse_catalog(&payload, &sig, &other_verifying, 1)
                .unwrap_err()
                .code,
            "catalog_signature_invalid"
        );

        // Conteúdo adulterado
        let mut tampered = payload.clone();
        let last = tampered.len() - 1;
        tampered[last] = b' ';
        assert_eq!(
            verify_and_parse_catalog(&tampered, &sig, &verifying, 1)
                .unwrap_err()
                .code,
            "catalog_signature_invalid"
        );

        // Anti-rollback: versão menor que a conhecida (min_version = 3)
        assert_eq!(
            verify_and_parse_catalog(&payload, &sig, &verifying, 3)
                .unwrap_err()
                .code,
            "catalog_rollback"
        );

        // Licença não comercial recusada mesmo se assinada
        let mut bad_license = embedded_catalog().clone();
        bad_license.version = 3;
        bad_license.tts.models[0].license = "CC-BY-NC-4.0".into();
        let bad_payload = serde_json::to_vec(&bad_license).unwrap();
        let bad_sig = sign_hex(&signing, &bad_payload);
        assert_eq!(
            verify_and_parse_catalog(&bad_payload, &bad_sig, &verifying, 1)
                .unwrap_err()
                .code,
            "catalog_invalid"
        );
    }

    #[test]
    fn tampered_cached_catalog_falls_back_to_embedded_with_warning() {
        let tmp = tempfile::tempdir().unwrap();
        let settings = test_settings(tmp.path());
        let dir = catalog_dir(&settings);
        fs::create_dir_all(&dir).unwrap();
        let mut v2 = embedded_catalog().clone();
        v2.version = 2;
        fs::write(catalog_file(&settings), serde_json::to_vec(&v2).unwrap()).unwrap();
        fs::write(
            catalog_sig_file(&settings),
            format!("{}\n", "0".repeat(128)),
        )
        .unwrap();

        let active = load_active_catalog(&settings);
        assert_eq!(active.source, CatalogSource::Embedded);
        assert_eq!(active.manifest.version, 1);
        assert!(active.warning.is_some());
    }

    fn serve_sequence(
        build: impl FnOnce(&str) -> Vec<(String, Vec<u8>)>,
    ) -> (String, thread::JoinHandle<()>) {
        let listener = TcpListener::bind("127.0.0.1:0").unwrap();
        let addr = listener.local_addr().unwrap();
        let base = format!("http://{addr}");
        let responses = build(&base);
        let handle = thread::spawn(move || {
            for (expected_path, body) in responses {
                let (mut stream, _) = listener.accept().unwrap();
                stream.set_nonblocking(false).unwrap();
                stream
                    .set_read_timeout(Some(Duration::from_secs(3)))
                    .unwrap();
                let mut req = Vec::new();
                while !req.ends_with(b"\r\n\r\n") {
                    let mut byte = [0u8; 1];
                    stream.read_exact(&mut byte).unwrap();
                    req.push(byte[0]);
                }
                let text = String::from_utf8_lossy(&req);
                let first_line = text.lines().next().unwrap_or("");
                assert!(
                    first_line.contains(&expected_path),
                    "expected {expected_path} in {first_line}"
                );
                let header = format!(
                    "HTTP/1.1 200 OK\r\nContent-Length: {}\r\nConnection: close\r\n\r\n",
                    body.len()
                );
                stream.write_all(header.as_bytes()).unwrap();
                stream.write_all(&body).unwrap();
            }
        });
        (base, handle)
    }

    #[test]
    fn check_for_update_persists_valid_release_and_blocks_rollback_on_loopback() {
        let tmp = tempfile::tempdir().unwrap();
        let settings = test_settings(tmp.path());
        let (signing, verifying) = test_keypair();

        let mut v2 = embedded_catalog().clone();
        v2.version = 2;
        v2.models[1].revision = "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb".into();
        let v2_bytes = serde_json::to_vec(&v2).unwrap();
        let v2_sig = sign_hex(&signing, &v2_bytes);

        let (serve_base, h2) = serve_sequence(|base| {
            let releases_v2 = serde_json::to_vec(&json!([
                {
                    "tag_name": "catalog-2",
                    "draft": false,
                    "assets": [
                        { "name": "catalog.json", "browser_download_url": format!("{base}/v2/catalog.json") },
                        { "name": "catalog.json.sig", "browser_download_url": format!("{base}/v2/catalog.json.sig") }
                    ]
                }
            ]))
            .unwrap();
            vec![
                ("/releases".into(), releases_v2),
                ("/v2/catalog.json".into(), v2_bytes),
                ("/v2/catalog.json.sig".into(), v2_sig),
            ]
        });
        let parsed_base: reqwest::Url = serve_base.parse().unwrap();
        let res = check_for_update_with(
            &settings,
            &format!("{serve_base}/releases"),
            &verifying,
            Some(&parsed_base),
        )
        .unwrap();
        h2.join().unwrap();

        assert_eq!(res["version"], 2);
        assert_eq!(res["updated"], true);
        assert_eq!(res["source"], "remote");

        // Rollback para catalog-1 deve ser recusado.
        let (rb_base, h_rb) = serve_sequence(|_| {
            let releases_v1 = serde_json::to_vec(&json!([
                {
                    "tag_name": "catalog-1",
                    "draft": false,
                    "assets": []
                }
            ]))
            .unwrap();
            vec![("/releases".into(), releases_v1)]
        });
        let rb_parsed: reqwest::Url = rb_base.parse().unwrap();
        let err = check_for_update_with(
            &settings,
            &format!("{rb_base}/releases"),
            &verifying,
            Some(&rb_parsed),
        )
        .unwrap_err();
        h_rb.join().unwrap();
        assert_eq!(err.code, "catalog_rollback");
    }
}
