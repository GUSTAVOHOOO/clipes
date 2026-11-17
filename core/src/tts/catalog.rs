//! Catálogo extensível de motores, modelos e vozes TTS (#79, #256).
//!
//! Novos motores e modelos entram em `catalog/models.json` ou no catálogo remoto assinado
//! sem exigir alteração na UI: `tts.catalog` devolve os metadados, licenças, termo de uso
//! proibido, vozes e estado instalado.
//!
//! Todos os pesos do Pocket TTS vêm do mirror oficial sem login
//! `kyutai/pocket-tts-without-voice-cloning` com revisão e SHA-256 fixados; os embeddings
//! pré-computados vêm dos assets de release do Clipes com SHA-256 fixado (sem token HF).

use crate::components::catalog::{embedded_catalog, load_active_catalog, ActiveCatalog};
use crate::components::{fetch_with, jobs, load_settings, pocket_tts_executable, Settings};
use crate::{CommandRegistration, CommandResult, CoreError, EventSink, ProgressEvent};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use sha2::{Digest, Sha256};
use std::{
    collections::BTreeMap,
    fs,
    path::{Path, PathBuf},
    sync::{
        atomic::{AtomicBool, Ordering},
        Arc,
    },
    time::{SystemTime, UNIX_EPOCH},
};

const MARKER: &str = "model.state.json";
const STAGE_DIGEST: &str = ".stage_digest";
const SETTINGS_FILE: &str = "tts-settings.json";

/// Texto oficial de uso proibido publicado por Kyutai no cartão do Pocket TTS.
pub(crate) const PROHIBITED_USE_EN: &str = "Prohibited use: Use of our model must comply with all applicable laws and regulations and must not result in, involve, or facilitate any illegal, harmful, deceptive, fraudulent, or unauthorized activity. Prohibited uses include, without limitation, voice impersonation or cloning without explicit and lawful consent; misinformation, disinformation, or deception (including fake news, fraudulent calls, or presenting generated content as genuine recordings of real people or events); and the generation of unlawful, harmful, libelous, abusive, harassing, discriminatory, hateful, or privacy-invasive content. We disclaim all liability for any non-compliant use.";

pub(crate) const PROHIBITED_USE_PT_SUMMARY: &str = "Uso proibido pelo autor do modelo (Kyutai): o uso deve cumprir as leis aplicáveis e não pode envolver atividade ilegal, enganosa, fraudulenta ou não autorizada, incluindo imitação ou clonagem de voz sem consentimento explícito e legal, desinformação ou apresentação de áudio sintético como gravação real.";

fn terms_version() -> String {
    format!("{:x}", Sha256::digest(PROHIBITED_USE_EN.as_bytes()))
}

fn error(code: &str, message: &str) -> CoreError {
    CoreError {
        code: code.into(),
        message: message.into(),
        usage: None,
    }
}

fn sanitize_download_error(err: CoreError) -> CoreError {
    match err.code.as_str() {
        "hash_mismatch" | "cancelled" => err,
        _ => error(
            "download",
            "Não foi possível baixar os arquivos do modelo TTS.",
        ),
    }
}

#[derive(Clone, Debug)]
pub(crate) struct TtsEngineSpec {
    pub id: String,
    pub label: String,
    pub component_id: String,
    pub code_license: String,
    pub source_url: String,
    pub supports_quantize: bool,
}

#[derive(Clone, Debug)]
pub(crate) struct AssetFile {
    pub name: String,
    pub url: String,
    pub size: u64,
    pub sha256: String,
}

#[derive(Clone, Debug)]
pub(crate) struct TtsModelSpec {
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
    pub files: Vec<AssetFile>,
    pub config_template: String,
}

#[derive(Clone, Debug)]
pub(crate) struct VoiceEmbedding {
    pub model_id: String,
    pub filename: String,
    pub size: u64,
    pub sha256: String,
    pub url: String,
}

#[derive(Clone, Debug)]
pub(crate) struct TtsVoiceSpec {
    pub id: String,
    pub engine_id: String,
    pub language: String,
    pub gender: String,
    pub label: String,
    pub default_for_language: bool,
    pub license: String,
    pub attribution: String,
    pub source_url: String,
    pub embeddings: Vec<VoiceEmbedding>,
}

const PT_24L_YAML: &str = "\
weights_path: '{{MODEL_PATH}}'
replace_characters:
  '\"': ''
  '“': ''
  '”': ''
  '„': ''
  '«': ''
  '»': ''
  '’': ''''
  '‘': ''''
  '(': ''
  ')': ''
  '[': ''
  ']': ''
  '–': ','
flow_lm:
  insert_bos_before_voice: true
  dtype: float32
  flow:
    depth: 6
    dim: 512
  transformer:
    d_model: 1024
    hidden_scale: 4
    max_period: 10000
    num_heads: 16
    num_layers: 24
  lookup_table:
    dim: 1024
    n_bins: 4000
    tokenizer: tokenizers
    tokenizer_path: '{{TOKENIZER_PATH}}'
mimi:
  dtype: float32
  sample_rate: 24000
  inner_dim: 32
  outer_dim: 512
  channels: 1
  frame_rate: 12.5
  seanet:
    dimension: 512
    channels: 1
    n_filters: 64
    n_residual_layers: 1
    ratios: [6, 5, 4]
    kernel_size: 7
    residual_kernel_size: 3
    last_kernel_size: 3
    dilation_base: 2
    pad_mode: constant
    compress: 2
  transformer:
    d_model: 512
    num_heads: 8
    num_layers: 2
    layer_scale: 0.01
    context: 250
    dim_feedforward: 2048
    input_dimension: 512
    output_dimensions: [512]
  quantizer:
    dimension: 32
    output_dimension: 512
";

const PT_6L_YAML: &str = "\
weights_path: '{{MODEL_PATH}}'
replace_characters:
  '\"': ''
  '“': ''
  '”': ''
  '„': ''
  '«': ''
  '»': ''
  '’': ''''
  '‘': ''''
  '(': ''
  ')': ''
  '[': ''
  ']': ''
  '–': ','
flow_lm:
  insert_bos_before_voice: true
  dtype: float32
  flow:
    depth: 6
    dim: 512
  transformer:
    d_model: 1024
    hidden_scale: 4
    max_period: 10000
    num_heads: 16
    num_layers: 6
  lookup_table:
    dim: 1024
    n_bins: 4000
    tokenizer: tokenizers
    tokenizer_path: '{{TOKENIZER_PATH}}'
mimi:
  dtype: float32
  sample_rate: 24000
  inner_dim: 32
  outer_dim: 512
  channels: 1
  frame_rate: 12.5
  seanet:
    dimension: 512
    channels: 1
    n_filters: 64
    n_residual_layers: 1
    ratios: [6, 5, 4]
    kernel_size: 7
    residual_kernel_size: 3
    last_kernel_size: 3
    dilation_base: 2
    pad_mode: constant
    compress: 2
  transformer:
    d_model: 512
    num_heads: 8
    num_layers: 2
    layer_scale: 0.01
    context: 250
    dim_feedforward: 2048
    input_dimension: 512
    output_dimensions: [512]
  quantizer:
    dimension: 32
    output_dimension: 512
";

const EN_6L_YAML: &str = "\
weights_path: '{{MODEL_PATH}}'
default_temperature: 0.3
replace_characters:
  '’': ''''
  '‘': ''''
flow_lm:
  insert_bos_before_voice: true
  dtype: float32
  flow:
    depth: 6
    dim: 512
  transformer:
    d_model: 1024
    hidden_scale: 4
    max_period: 10000
    num_heads: 16
    num_layers: 6
  lookup_table:
    dim: 1024
    n_bins: 4000
    tokenizer: tokenizers
    tokenizer_path: '{{TOKENIZER_PATH}}'
mimi:
  dtype: float32
  sample_rate: 24000
  inner_dim: 32
  outer_dim: 512
  channels: 1
  frame_rate: 12.5
  seanet:
    dimension: 512
    channels: 1
    n_filters: 64
    n_residual_layers: 1
    ratios: [6, 5, 4]
    kernel_size: 7
    residual_kernel_size: 3
    last_kernel_size: 3
    dilation_base: 2
    pad_mode: constant
    compress: 2
  transformer:
    d_model: 512
    num_heads: 8
    num_layers: 2
    layer_scale: 0.01
    context: 250
    dim_feedforward: 2048
    input_dimension: 512
    output_dimensions: [512]
  quantizer:
    dimension: 32
    output_dimension: 512
";

fn default_config_template(model_id: &str) -> &'static str {
    match model_id {
        "portuguese" => PT_6L_YAML,
        "english" => EN_6L_YAML,
        _ => PT_24L_YAML,
    }
}

struct EffectiveTtsCatalog {
    active: ActiveCatalog,
    engines: Vec<TtsEngineSpec>,
    models: Vec<TtsModelSpec>,
    voices: Vec<TtsVoiceSpec>,
}

fn from_manifest(active: ActiveCatalog) -> EffectiveTtsCatalog {
    let base = active
        .manifest
        .tts
        .voice_release_base_url
        .trim_end_matches('/');
    let engines = active
        .manifest
        .tts
        .engines
        .iter()
        .map(|e| TtsEngineSpec {
            id: e.id.clone(),
            label: e.label.clone(),
            component_id: e.component_id.clone(),
            code_license: e.code_license.clone(),
            source_url: e.source_url.clone(),
            supports_quantize: e.supports_quantize,
        })
        .collect();
    let models = active
        .manifest
        .tts
        .models
        .iter()
        .map(|m| TtsModelSpec {
            id: m.id.clone(),
            engine_id: m.engine_id.clone(),
            language: m.language.clone(),
            label: m.label.clone(),
            description: m.description.clone(),
            default_for_language: m.default_for_language,
            lightweight: m.lightweight,
            repo: m.repo.clone(),
            revision: m.revision.clone(),
            license: m.license.clone(),
            files: m
                .files
                .iter()
                .map(|f| AssetFile {
                    name: f.name.clone(),
                    url: f.url.clone(),
                    size: f.size,
                    sha256: f.sha256.clone(),
                })
                .collect(),
            config_template: m
                .config_template
                .clone()
                .unwrap_or_else(|| default_config_template(&m.id).to_owned()),
        })
        .collect();
    let voices = active
        .manifest
        .tts
        .voices
        .iter()
        .map(|v| TtsVoiceSpec {
            id: v.id.clone(),
            engine_id: v.engine_id.clone(),
            language: v.language.clone(),
            gender: v.gender.clone(),
            label: v.label.clone(),
            default_for_language: v.default_for_language,
            license: v.license.clone(),
            attribution: v.attribution.clone(),
            source_url: v.source_url.clone(),
            embeddings: v
                .embeddings
                .iter()
                .map(|e| VoiceEmbedding {
                    model_id: e.model_id.clone(),
                    filename: e.filename.clone(),
                    size: e.size,
                    sha256: e.sha256.clone(),
                    url: e
                        .url
                        .clone()
                        .unwrap_or_else(|| format!("{base}/{}", e.filename)),
                })
                .collect(),
        })
        .collect();
    EffectiveTtsCatalog {
        active,
        engines,
        models,
        voices,
    }
}

fn load_effective_tts(settings: &Settings) -> EffectiveTtsCatalog {
    from_manifest(load_active_catalog(settings))
}

fn current_effective_tts() -> EffectiveTtsCatalog {
    match load_settings() {
        Ok(settings) => load_effective_tts(&settings),
        Err(_) => {
            let embedded = embedded_catalog().clone();
            let embedded_version = embedded.version;
            from_manifest(ActiveCatalog {
                manifest: embedded,
                source: crate::components::catalog::CatalogSource::Embedded,
                embedded_version,
                warning: None,
            })
        }
    }
}

pub(crate) fn find_model_in(models: &[TtsModelSpec], id: &str) -> Option<TtsModelSpec> {
    models.iter().find(|m| m.id == id).cloned()
}

pub(crate) fn find_voice(id: &str) -> Option<TtsVoiceSpec> {
    current_effective_tts()
        .voices
        .into_iter()
        .find(|v| v.id == id)
}

pub fn is_valid_voice(id: &str) -> bool {
    find_voice(id).is_some()
}

pub(crate) fn default_voice_for_language(lang: &str) -> TtsVoiceSpec {
    let norm = normalize_language(lang);
    let cat = current_effective_tts();
    cat.voices
        .iter()
        .find(|v| v.language == norm && v.default_for_language)
        .cloned()
        .unwrap_or_else(|| cat.voices.into_iter().next().unwrap())
}

pub(crate) fn normalize_language(lang: &str) -> &'static str {
    if lang.eq_ignore_ascii_case("en") || lang.to_ascii_lowercase().starts_with("en-") {
        "en"
    } else {
        "pt"
    }
}

#[derive(Default, Serialize, Deserialize)]
struct TtsSettings {
    #[serde(default)]
    active_models: BTreeMap<String, String>,
}

fn tts_settings_path(settings: &Settings) -> PathBuf {
    settings.data_dir.join(SETTINGS_FILE)
}

fn load_tts_settings(settings: &Settings) -> TtsSettings {
    fs::read(tts_settings_path(settings))
        .ok()
        .and_then(|bytes| serde_json::from_slice(&bytes).ok())
        .unwrap_or_default()
}

fn save_tts_settings(settings: &Settings, tts: &TtsSettings) -> Result<(), CoreError> {
    let path = tts_settings_path(settings);
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent).map_err(|_| {
            error(
                "settings",
                "Não foi possível salvar as preferências de TTS.",
            )
        })?;
    }
    let bytes = serde_json::to_vec_pretty(tts).map_err(|_| {
        error(
            "settings",
            "Não foi possível serializar as preferências de TTS.",
        )
    })?;
    fs::write(path, bytes).map_err(|_| {
        error(
            "settings",
            "Não foi possível salvar as preferências de TTS.",
        )
    })
}

pub(crate) fn active_model_id(settings: &Settings, lang: &str) -> String {
    let norm = normalize_language(lang);
    let saved = load_tts_settings(settings);
    let cat = load_effective_tts(settings);
    if let Some(choice) = saved.active_models.get(norm) {
        if let Some(spec) = find_model_in(&cat.models, choice) {
            if spec.language == norm {
                return spec.id;
            }
        }
    }
    cat.models
        .iter()
        .find(|m| m.language == norm && m.default_for_language)
        .map(|m| m.id.clone())
        .unwrap_or_else(|| "portuguese_24l".into())
}

pub(crate) fn model_dir(settings: &Settings, spec: &TtsModelSpec) -> PathBuf {
    settings
        .data_dir
        .join("tts-models")
        .join(&spec.engine_id)
        .join(&spec.id)
}

pub(crate) fn voice_path_in(dir: &Path, filename: &str) -> PathBuf {
    dir.join("voices").join(filename)
}

fn marker_state(dir: &Path) -> Option<Value> {
    let bytes = fs::read(dir.join(MARKER)).ok()?;
    serde_json::from_slice(&bytes).ok()
}

fn is_valid_hex_revision(rev: &str) -> bool {
    rev.len() == 40 && rev.bytes().all(|b| b.is_ascii_hexdigit())
}

fn model_voices_in<'a>(
    voices: &'a [TtsVoiceSpec],
    model_id: &str,
) -> Vec<(&'a TtsVoiceSpec, &'a VoiceEmbedding)> {
    voices
        .iter()
        .filter_map(|v| {
            v.embeddings
                .iter()
                .find(|e| e.model_id == model_id)
                .map(|e| (v, e))
        })
        .collect()
}

fn model_files_digest(spec: &TtsModelSpec, voices: &[TtsVoiceSpec]) -> String {
    let mut h = Sha256::new();
    h.update(spec.revision.as_bytes());
    for f in &spec.files {
        h.update(b"\0");
        h.update(f.name.as_bytes());
        h.update(f.size.to_le_bytes());
        h.update(f.sha256.as_bytes());
    }
    for (_, e) in model_voices_in(voices, &spec.id) {
        h.update(b"\0v:");
        h.update(e.filename.as_bytes());
        h.update(e.size.to_le_bytes());
        h.update(e.sha256.as_bytes());
    }
    format!("{:x}", h.finalize())
}

pub(crate) fn installed_revision(
    settings: &Settings,
    spec: &TtsModelSpec,
    voices: &[TtsVoiceSpec],
) -> Option<String> {
    let dir = model_dir(settings, spec);
    let state = marker_state(&dir)?;
    let rev = state["revision"].as_str()?;
    if !is_valid_hex_revision(rev) || state["terms_version"] != terms_version() {
        return None;
    }
    if !dir.join("config.yaml").is_file() {
        return None;
    }
    if !spec.files.iter().all(|f| dir.join(&f.name).is_file()) {
        return None;
    }
    let voices_ok = voices
        .iter()
        .flat_map(|v| v.embeddings.iter())
        .filter(|e| e.model_id == spec.id)
        .all(|e| voice_path_in(&dir, &e.filename).is_file());
    voices_ok.then(|| rev.to_owned())
}

pub(crate) fn is_model_installed(
    settings: &Settings,
    spec: &TtsModelSpec,
    voices: &[TtsVoiceSpec],
) -> bool {
    installed_revision(settings, spec, voices).is_some()
}

pub(crate) fn update_available(
    settings: &Settings,
    spec: &TtsModelSpec,
    voices: &[TtsVoiceSpec],
) -> bool {
    let Some(rev) = installed_revision(settings, spec, voices) else {
        return false;
    };
    if rev != spec.revision {
        return true;
    }
    marker_state(&model_dir(settings, spec))
        .and_then(|s| s["files_digest"].as_str().map(str::to_owned))
        .is_some_and(|digest| digest != model_files_digest(spec, voices))
}

pub(crate) struct InstalledTtsBundle {
    pub model_id: String,
    pub voice_id: String,
    pub config_path: PathBuf,
    pub voice_path: PathBuf,
}

pub(crate) fn resolve_installed_bundle(
    language: &str,
    requested_voice: Option<&str>,
    requested_model: Option<&str>,
) -> Result<InstalledTtsBundle, CoreError> {
    let settings = load_settings()?;
    let cat = load_effective_tts(&settings);
    let norm = normalize_language(language);
    let voice = match requested_voice {
        Some(id) => cat
            .voices
            .iter()
            .find(|v| v.id == id)
            .cloned()
            .ok_or_else(|| error("tts_voice_unknown", "Voz de Narração desconhecida."))?,
        None => cat
            .voices
            .iter()
            .find(|v| v.language == norm && v.default_for_language)
            .cloned()
            .unwrap_or_else(|| cat.voices[0].clone()),
    };
    if voice.language != norm {
        return Err(error(
            "tts_voice_language_mismatch",
            "A voz escolhida não corresponde ao idioma do Roteiro.",
        ));
    }
    let model_id = match requested_model {
        Some(id) => {
            let m = find_model_in(&cat.models, id)
                .ok_or_else(|| error("tts_model_unknown", "Modelo TTS desconhecido."))?;
            if m.language != norm {
                return Err(error(
                    "tts_model_language_mismatch",
                    "O modelo TTS escolhido não corresponde ao idioma do Roteiro.",
                ));
            }
            m.id
        }
        None => active_model_id(&settings, norm),
    };
    let model = find_model_in(&cat.models, &model_id)
        .ok_or_else(|| error("tts_model_unknown", "Modelo TTS desconhecido."))?;
    if !is_model_installed(&settings, &model, &cat.voices) {
        return Err(error(
            "tts_model_missing",
            "Instale o modelo TTS deste idioma em Componentes antes de gerar a Narração.",
        ));
    }
    let emb = voice
        .embeddings
        .iter()
        .find(|e| e.model_id == model.id)
        .ok_or_else(|| {
            error(
                "tts_voice_unsupported",
                "A voz selecionada não é compatível com este modelo TTS.",
            )
        })?;
    let dir = model_dir(&settings, &model);
    let config_path = dir.join("config.yaml");
    let voice_path = voice_path_in(&dir, &emb.filename);
    if !config_path.is_file() || !voice_path.is_file() {
        return Err(error(
            "tts_model_missing",
            "Arquivos do modelo TTS ausentes; reinstale o modelo em Componentes.",
        ));
    }
    Ok(InstalledTtsBundle {
        model_id: model.id,
        voice_id: voice.id,
        config_path,
        voice_path,
    })
}

fn yaml_escape_path(path: &Path) -> String {
    // Normaliza separadores para `/` para o parser YAML do pocket-tts no Windows não tratar `\`.
    path.to_string_lossy()
        .replace('\\', "/")
        .replace('\'', "''")
}

pub(crate) fn render_local_config(spec: &TtsModelSpec, dir: &Path) -> String {
    let model_path = yaml_escape_path(&dir.join("model.safetensors"));
    let tok_path = yaml_escape_path(&dir.join("tokenizer.json"));
    spec.config_template
        .replace("{{MODEL_PATH}}", &model_path)
        .replace("{{TOKENIZER_PATH}}", &tok_path)
}

fn test_model_base_url() -> Option<String> {
    if !crate::paths::is_cargo_test_binary() {
        return None;
    }
    let raw = std::env::var("CLIPES_TEST_MODEL_BASE_URL").ok()?;
    let url = reqwest::Url::parse(raw.trim()).ok()?;
    let loopback =
        url.scheme() == "http" && matches!(url.host_str(), Some("127.0.0.1" | "localhost" | "::1"));
    loopback.then(|| raw.trim().trim_end_matches('/').to_owned())
}

/// Redirecionamentos só para Hugging Face e GitHub Releases, sempre por HTTPS.
pub(crate) fn allowed_redirect(url: &reqwest::Url) -> bool {
    if let Some(base) = test_model_base_url().and_then(|raw| reqwest::Url::parse(&raw).ok()) {
        if url.scheme() == base.scheme()
            && url.host_str() == base.host_str()
            && url.port_or_known_default() == base.port_or_known_default()
        {
            return true;
        }
    }
    let host = url.host_str().unwrap_or("");
    url.scheme() == "https"
        && ([
            "huggingface.co",
            "hf.co",
            "github.com",
            "githubusercontent.com",
        ]
        .iter()
        .any(|root| host == *root || host.ends_with(&format!(".{root}"))))
}

fn http_client() -> Result<reqwest::blocking::Client, CoreError> {
    reqwest::blocking::Client::builder()
        .redirect(reqwest::redirect::Policy::custom(|attempt| {
            if attempt.previous().len() >= 5 || !allowed_redirect(attempt.url()) {
                attempt.error("redirecionamento não permitido")
            } else {
                attempt.follow()
            }
        }))
        .build()
        .map_err(|_| error("download", "Não foi possível iniciar o download."))
}

fn model_source_url(spec: &TtsModelSpec) -> String {
    format!(
        "https://huggingface.co/{}/tree/{}",
        spec.repo, spec.revision
    )
}

pub fn catalog_json() -> Result<Value, CoreError> {
    let settings = load_settings()?;
    let cat = load_effective_tts(&settings);
    let active_pt = active_model_id(&settings, "pt");
    let active_en = active_model_id(&settings, "en");
    let component_installed = pocket_tts_executable().is_ok();
    let tv = terms_version();

    let engines: Vec<Value> = cat
        .engines
        .iter()
        .map(|e| {
            json!({
                "id": e.id,
                "label": e.label,
                "componentId": e.component_id,
                "codeLicense": e.code_license,
                "sourceUrl": e.source_url,
                "supportsQuantize": e.supports_quantize,
                "prohibitedUse": {
                    "textEn": PROHIBITED_USE_EN,
                    "summaryPt": PROHIBITED_USE_PT_SUMMARY,
                    "version": tv,
                }
            })
        })
        .collect();

    let models: Vec<Value> = cat
        .models
        .iter()
        .map(|m| {
            let weights_size: u64 = m.files.iter().map(|f| f.size).sum();
            let voices = model_voices_in(&cat.voices, &m.id);
            let voices_size: u64 = voices.iter().map(|(_, e)| e.size).sum();
            let dir = model_dir(&settings, m);
            let installed_rev = installed_revision(&settings, m, &cat.voices);
            let installed = installed_rev.is_some();
            let update_avail = update_available(&settings, m, &cat.voices);
            let state = marker_state(&dir);
            let terms_accepted = state.as_ref().is_some_and(|s| s["terms_version"] == tv);
            let active = match m.language.as_str() {
                "pt" => m.id == active_pt,
                "en" => m.id == active_en,
                _ => m.default_for_language,
            };
            let mut files: Vec<Value> = m
                .files
                .iter()
                .map(|f| json!({"name": f.name, "size": f.size, "sha256": f.sha256, "kind": "weights"}))
                .collect();
            for (v, e) in &voices {
                files.push(json!({
                    "name": format!("voices/{}", e.filename),
                    "size": e.size,
                    "sha256": e.sha256,
                    "kind": "voice",
                    "voiceId": v.id,
                }));
            }
            json!({
                "id": m.id,
                "engineId": m.engine_id,
                "language": m.language,
                "label": m.label,
                "description": m.description,
                "defaultForLanguage": m.default_for_language,
                "lightweight": m.lightweight,
                "active": active,
                "installed": installed,
                "installedRevision": installed_rev,
                "updateAvailable": update_avail,
                "termsAccepted": terms_accepted,
                "repo": m.repo,
                "revision": m.revision,
                "license": m.license,
                "sourceUrl": model_source_url(m),
                "weightsSize": weights_size,
                "voicesSize": voices_size,
                "size": weights_size + voices_size,
                "files": files,
            })
        })
        .collect();

    let voices: Vec<Value> = cat
        .voices
        .iter()
        .map(|v| {
            let installed_models: Vec<&str> = v
                .embeddings
                .iter()
                .filter(|e| {
                    find_model_in(&cat.models, &e.model_id)
                        .is_some_and(|m| is_model_installed(&settings, &m, &cat.voices))
                })
                .map(|e| e.model_id.as_str())
                .collect();
            json!({
                "id": v.id,
                "engineId": v.engine_id,
                "language": v.language,
                "gender": v.gender,
                "label": v.label,
                "defaultForLanguage": v.default_for_language,
                "license": v.license,
                "attribution": v.attribution,
                "sourceUrl": v.source_url,
                "models": v.embeddings.iter().map(|e| e.model_id.as_str()).collect::<Vec<_>>(),
                "installedModels": installed_models,
            })
        })
        .collect();

    Ok(json!({
        "catalogVersion": cat.active.manifest.version,
        "catalogSource": cat.active.source.as_str(),
        "catalogWarning": cat.active.warning.map(|w| w.message),
        "catalogWarningCode": cat.active.warning.map(|w| w.code),
        "componentInstalled": component_installed,
        "activeModels": {
            "pt": active_pt,
            "en": active_en,
        },
        "engines": engines,
        "models": models,
        "voices": voices,
    }))
}

fn cmd_catalog(_: Value, _: &mut EventSink<'_>) -> CommandResult {
    catalog_json()
}

fn cmd_choose_model(v: Value, _: &mut EventSink<'_>) -> CommandResult {
    let model_id = v["modelId"]
        .as_str()
        .or_else(|| v["id"].as_str())
        .ok_or_else(|| error("tts_model_unknown", "Modelo TTS desconhecido."))?;
    let settings = load_settings()?;
    let cat = load_effective_tts(&settings);
    let spec = find_model_in(&cat.models, model_id)
        .ok_or_else(|| error("tts_model_unknown", "Modelo TTS desconhecido."))?;
    let language = v["language"].as_str().unwrap_or(&spec.language);
    let norm = normalize_language(language);
    if spec.language != norm {
        return Err(error(
            "tts_model_language_mismatch",
            "O modelo TTS escolhido não pertence a este idioma.",
        ));
    }
    let mut tts = load_tts_settings(&settings);
    tts.active_models.insert(norm.to_owned(), spec.id.clone());
    save_tts_settings(&settings, &tts)?;
    catalog_json()
}

fn cmd_download(v: Value, events: &mut EventSink<'_>) -> CommandResult {
    if v["confirmed"] != true {
        return Err(error(
            "confirmation_required",
            "Confirme o download antes de iniciar.",
        ));
    }
    if v["termsAccepted"] != true {
        return Err(error(
            "terms_acceptance_required",
            "Aceite o termo de uso proibido do modelo antes de baixar.",
        ));
    }
    let id = v["id"].as_str().unwrap_or("");
    let settings = load_settings()?;
    let cat = load_effective_tts(&settings);
    let spec = find_model_in(&cat.models, id)
        .ok_or_else(|| error("unknown_component", "Modelo TTS indisponível."))?;
    let job_key = format!("tts:{id}");
    let flag = Arc::new(AtomicBool::new(false));
    {
        let mut map = jobs().lock().unwrap();
        if map.contains_key(&job_key) {
            return Err(error("already_downloading", "Download em andamento."));
        }
        map.insert(job_key.clone(), flag.clone());
    }
    let result = download_model(
        &spec,
        &cat.voices,
        cat.active.manifest.version,
        &settings,
        &flag,
        &job_key,
        events,
    );
    if result.as_ref().is_err_and(|e| e.code != "cancelled") {
        crate::diagnostic::record(crate::diagnostic::DiagnosticEvent::ComponentFailure);
    }
    jobs().lock().unwrap().remove(&job_key);
    result
}

fn cmd_cancel(v: Value, _: &mut EventSink<'_>) -> CommandResult {
    let id = v["id"].as_str().unwrap_or("");
    let job_key = format!("tts:{id}");
    if let Some(flag) = jobs().lock().unwrap().get(&job_key) {
        flag.store(true, Ordering::Relaxed);
    }
    Ok(json!({}))
}

fn download_url(orig: &str, model_id: &str, filename: &str) -> String {
    if let Some(base) = test_model_base_url() {
        return format!("{base}/tts/{model_id}/{filename}");
    }
    orig.to_owned()
}

fn download_model(
    spec: &TtsModelSpec,
    all_voices: &[TtsVoiceSpec],
    catalog_version: u64,
    settings: &Settings,
    cancel: &AtomicBool,
    job_key: &str,
    events: &mut EventSink<'_>,
) -> CommandResult {
    let client = http_client()?;
    let root = settings.data_dir.join("tts-models").join(&spec.engine_id);
    let stage = root.join(format!("{}.part", spec.id));
    let digest = model_files_digest(spec, all_voices);
    let stage_marker = stage.join(STAGE_DIGEST);
    if stage.exists() {
        let same_stage = fs::read_to_string(&stage_marker)
            .ok()
            .is_some_and(|s| s.trim() == digest);
        if !same_stage {
            let _ = fs::remove_dir_all(&stage);
        }
    }
    fs::create_dir_all(stage.join("voices")).map_err(|_| {
        error(
            "download",
            "Não foi possível preparar a pasta do modelo TTS.",
        )
    })?;
    fs::write(&stage_marker, &digest).map_err(|_| {
        error(
            "download",
            "Não foi possível preparar a pasta do modelo TTS.",
        )
    })?;

    let voices = model_voices_in(all_voices, &spec.id);
    let total: u64 = spec
        .files
        .iter()
        .map(|f| f.size)
        .chain(voices.iter().map(|(_, e)| e.size))
        .sum::<u64>()
        .max(1);
    let mut done = 0u64;

    for file in &spec.files {
        let base = done;
        let url = download_url(&file.url, &spec.id, &file.name);
        fetch_with(
            &client,
            &url,
            &file.sha256,
            file.size,
            &stage.join(&file.name),
            cancel,
            |pct| {
                events(ProgressEvent {
                    project: None,
                    job: job_key.into(),
                    stage: "download".into(),
                    percentage: ((base + file.size * u64::from(pct) / 100) * 100 / total).min(99)
                        as u8,
                    message: "Baixando modelo TTS".into(),
                    error: None,
                });
            },
        )
        .map_err(sanitize_download_error)?;
        done += file.size;
    }

    for (_, emb) in &voices {
        let base = done;
        let url = download_url(&emb.url, &spec.id, &emb.filename);
        fetch_with(
            &client,
            &url,
            &emb.sha256,
            emb.size,
            &voice_path_in(&stage, &emb.filename),
            cancel,
            |pct| {
                events(ProgressEvent {
                    project: None,
                    job: job_key.into(),
                    stage: "download".into(),
                    percentage: ((base + emb.size * u64::from(pct) / 100) * 100 / total).min(99)
                        as u8,
                    message: "Baixando voz TTS".into(),
                    error: None,
                });
            },
        )
        .map_err(sanitize_download_error)?;
        done += emb.size;
    }
    let _ = fs::remove_file(&stage_marker);

    let dir = model_dir(settings, spec);
    let backup = root.join(format!("{}.old", spec.id));
    let _ = fs::remove_dir_all(&backup);
    let had_existing = dir.exists();
    if had_existing {
        fs::rename(&dir, &backup)
            .map_err(|_| error("install", "Não foi possível instalar o modelo TTS."))?;
    }
    let accepted_at = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map_or(0, |d| d.as_secs());
    let state = json!({
        "engine": spec.engine_id,
        "id": spec.id,
        "repo": spec.repo,
        "revision": spec.revision,
        "files_digest": digest,
        "catalog_version": catalog_version,
        "terms_accepted_at": accepted_at,
        "terms_version": terms_version(),
        "voices": voices.iter().map(|(v, _)| v.id.as_str()).collect::<Vec<_>>(),
    });
    let install_res = (|| -> Result<(), CoreError> {
        fs::rename(&stage, &dir)
            .map_err(|_| error("install", "Não foi possível instalar o modelo TTS."))?;
        fs::write(dir.join("config.yaml"), render_local_config(spec, &dir)).map_err(|_| {
            error(
                "install",
                "Não foi possível gravar a configuração do modelo TTS.",
            )
        })?;
        fs::write(dir.join(MARKER), serde_json::to_vec_pretty(&state).unwrap()).map_err(|_| {
            error(
                "install",
                "Não foi possível registrar o estado do modelo TTS.",
            )
        })?;
        Ok(())
    })();
    if let Err(err) = install_res {
        let _ = fs::remove_dir_all(&dir);
        if had_existing {
            let _ = fs::rename(&backup, &dir);
        }
        return Err(err);
    }
    if had_existing {
        let _ = fs::remove_dir_all(&backup);
    }

    events(ProgressEvent {
        project: None,
        job: job_key.into(),
        stage: "complete".into(),
        percentage: 100,
        message: "Modelo TTS instalado".into(),
        error: None,
    });
    Ok(json!({ "id": spec.id }))
}

inventory::submit! { CommandRegistration { name: "tts.catalog", execute: cmd_catalog } }
inventory::submit! { CommandRegistration { name: "tts.models.choose", execute: cmd_choose_model } }
inventory::submit! { CommandRegistration { name: "tts.models.download", execute: cmd_download } }
inventory::submit! { CommandRegistration { name: "tts.models.cancel", execute: cmd_cancel } }

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn catalog_models_are_pinned_commercial_cc_by_and_exclude_nc_voices() {
        let cat = from_manifest(ActiveCatalog {
            manifest: embedded_catalog().clone(),
            source: crate::components::catalog::CatalogSource::Embedded,
            embedded_version: 1,
            warning: None,
        });
        for m in &cat.models {
            assert_eq!(m.license, "CC-BY-4.0");
            assert_eq!(m.revision.len(), 40);
            for f in &m.files {
                assert!(f.size > 0);
                assert_eq!(f.sha256.len(), 64);
                assert!(f.sha256.bytes().all(|b| b.is_ascii_hexdigit()));
                assert!(f.url.starts_with("https://huggingface.co/"));
                assert!(f.url.contains(&m.revision));
            }
        }
        for v in &cat.voices {
            assert!(matches!(v.license.as_str(), "CC-BY-4.0" | "CC0-1.0"));
            assert!(!matches!(v.id.as_str(), "rafael" | "cosette" | "jean"));
            assert!(!v.embeddings.is_empty());
        }
    }

    #[test]
    fn redirects_allow_only_https_huggingface_and_github() {
        let ok = |u: &str| allowed_redirect(&u.parse().unwrap());
        assert!(ok("https://huggingface.co/x"));
        assert!(ok("https://cdn-lfs.hf.co/x"));
        assert!(ok(
            "https://github.com/GUSTAVOHOOO/clipes/releases/download/x/y"
        ));
        assert!(ok("https://release-assets.githubusercontent.com/x"));
        assert!(!ok("http://github.com/x"));
        assert!(!ok("https://example.com/github.com"));
    }

    #[test]
    fn local_config_uses_forward_slashes_and_local_paths() {
        let cat = from_manifest(ActiveCatalog {
            manifest: embedded_catalog().clone(),
            source: crate::components::catalog::CatalogSource::Embedded,
            embedded_version: 1,
            warning: None,
        });
        let dir = PathBuf::from(
            r"C:\Users\Teste\AppData\Local\Clipes\tts-models\pocket-tts\portuguese_24l",
        );
        let yaml = render_local_config(&cat.models[0], &dir);
        assert!(yaml.contains("weights_path: 'C:/Users/Teste/AppData/Local/Clipes/tts-models/pocket-tts/portuguese_24l/model.safetensors'"));
        assert!(yaml.contains("tokenizer_path: 'C:/Users/Teste/AppData/Local/Clipes/tts-models/pocket-tts/portuguese_24l/tokenizer.json'"));
        assert!(!yaml.contains("hf://"));
    }

    #[test]
    fn catalog_and_model_choice_persist_under_isolated_data_dir() {
        let root = tempfile::tempdir().unwrap();
        let _guard = crate::test_env::set_data_dir(root.path());

        let initial = catalog_json().unwrap();
        assert_eq!(initial["activeModels"]["pt"], "portuguese_24l");
        assert_eq!(initial["activeModels"]["en"], "english");
        assert_eq!(initial["engines"].as_array().unwrap().len(), 1);
        assert_eq!(initial["models"].as_array().unwrap().len(), 3);
        assert_eq!(initial["voices"].as_array().unwrap().len(), 3);

        let updated = crate::dispatch(
            "tts.models.choose",
            json!({"language": "pt", "modelId": "portuguese"}),
            &mut |_| {},
        )
        .unwrap();
        assert_eq!(updated["activeModels"]["pt"], "portuguese");

        let err = crate::dispatch(
            "tts.models.download",
            json!({"id": "portuguese_24l", "confirmed": true, "termsAccepted": false}),
            &mut |_| {},
        )
        .unwrap_err();
        assert_eq!(err.code, "terms_acceptance_required");
    }
}
