//! Catálogo extensível de motores, modelos e vozes TTS (#79).
//!
//! Novos motores e modelos entram nas tabelas deste módulo sem exigir alteração na UI:
//! `tts.catalog` devolve os metadados, licenças, termo de uso proibido, vozes e estado instalado.
//!
//! Todos os pesos do Pocket TTS vêm do mirror oficial sem login
//! `kyutai/pocket-tts-without-voice-cloning` com revisão e SHA-256 fixados; os embeddings
//! pré-computados vêm dos assets de release do Clipes com SHA-256 fixado (sem token HF).

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
const SETTINGS_FILE: &str = "tts-settings.json";
const HF_MIRROR_REPO: &str = "kyutai/pocket-tts-without-voice-cloning";
const HF_MIRROR_REVISION: &str = "a7056f505a4a8ca72d8b5fb1440071d6f1a35739";

/// URL base única dos assets de embeddings de voz publicados nas releases do Clipes.
/// Placeholder até o coordenador devolver a URL definitiva publicada.
const VOICE_RELEASE_BASE_URL: &str =
    "https://github.com/GUSTAVOHOOO/clipes/releases/download/tts-voices-placeholder";

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

#[derive(Clone, Copy)]
pub(crate) struct TtsEngineSpec {
    pub id: &'static str,
    pub label: &'static str,
    pub component_id: &'static str,
    pub code_license: &'static str,
    pub source_url: &'static str,
    pub supports_quantize: bool,
}

#[derive(Clone, Copy)]
pub(crate) struct AssetFile {
    pub name: &'static str,
    pub url: &'static str,
    pub size: u64,
    pub sha256: &'static str,
}

#[derive(Clone, Copy)]
pub(crate) struct TtsModelSpec {
    pub id: &'static str,
    pub engine_id: &'static str,
    pub language: &'static str,
    pub label: &'static str,
    pub description: &'static str,
    pub default_for_language: bool,
    pub lightweight: bool,
    pub repo: &'static str,
    pub revision: &'static str,
    pub license: &'static str,
    pub files: &'static [AssetFile],
    pub config_template: &'static str,
}

#[derive(Clone, Copy)]
pub(crate) struct VoiceEmbedding {
    pub model_id: &'static str,
    pub filename: &'static str,
    pub size: u64,
    pub sha256: &'static str,
}

impl VoiceEmbedding {
    pub(crate) fn url(&self) -> String {
        format!("{VOICE_RELEASE_BASE_URL}/{}", self.filename)
    }
}

#[derive(Clone, Copy)]
pub(crate) struct TtsVoiceSpec {
    pub id: &'static str,
    pub engine_id: &'static str,
    pub language: &'static str,
    pub gender: &'static str,
    pub label: &'static str,
    pub default_for_language: bool,
    pub license: &'static str,
    pub attribution: &'static str,
    pub source_url: &'static str,
    pub embeddings: &'static [VoiceEmbedding],
}

pub(crate) const ENGINES: [TtsEngineSpec; 1] = [TtsEngineSpec {
    id: "pocket-tts",
    label: "Pocket TTS (Kyutai)",
    component_id: "pocket-tts",
    code_license: "MIT",
    source_url: "https://github.com/kyutai-labs/pocket-tts/tree/v4.0.1",
    supports_quantize: true,
}];

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

pub(crate) const MODELS: [TtsModelSpec; 3] = [
    TtsModelSpec {
        id: "portuguese_24l",
        engine_id: "pocket-tts",
        language: "pt",
        label: "Pocket TTS PT-BR (24 camadas · padrão)",
        description: "Qualidade superior em PT-BR (336M parâmetros); roda em CPU com quantização int8.",
        default_for_language: true,
        lightweight: false,
        repo: HF_MIRROR_REPO,
        revision: HF_MIRROR_REVISION,
        license: "CC-BY-4.0",
        files: &[
            AssetFile {
                name: "model.safetensors",
                url: "https://huggingface.co/kyutai/pocket-tts-without-voice-cloning/resolve/a7056f505a4a8ca72d8b5fb1440071d6f1a35739/languages/portuguese_24l/model.safetensors",
                size: 672_178_676,
                sha256: "ce7911fe914d055e55dcb8dcc973f735d9f51d09fe6fec4fe35d80ac2c9d9670",
            },
            AssetFile {
                name: "tokenizer.json",
                url: "https://huggingface.co/kyutai/pocket-tts-without-voice-cloning/resolve/a7056f505a4a8ca72d8b5fb1440071d6f1a35739/languages/portuguese_24l/tokenizer.json",
                size: 247_014,
                sha256: "b33e269f7f042a763080d71ba087d74d2f6759674b238a723c028e436b1a25ab",
            },
        ],
        config_template: PT_24L_YAML,
    },
    TtsModelSpec {
        id: "portuguese",
        engine_id: "pocket-tts",
        language: "pt",
        label: "Pocket TTS PT-BR (6 camadas · leve)",
        description: "Variante destilada mais rápida (~4× tempo real em CPU) e menor download (219 MB).",
        default_for_language: false,
        lightweight: true,
        repo: HF_MIRROR_REPO,
        revision: HF_MIRROR_REVISION,
        license: "CC-BY-4.0",
        files: &[
            AssetFile {
                name: "model.safetensors",
                url: "https://huggingface.co/kyutai/pocket-tts-without-voice-cloning/resolve/a7056f505a4a8ca72d8b5fb1440071d6f1a35739/languages/portuguese/model.safetensors",
                size: 219_029_196,
                sha256: "28e20f32515ba8bd0eaec69671f11f8921414fcdc375aa072fa09f46cc1057c5",
            },
            AssetFile {
                name: "tokenizer.json",
                url: "https://huggingface.co/kyutai/pocket-tts-without-voice-cloning/resolve/a7056f505a4a8ca72d8b5fb1440071d6f1a35739/languages/portuguese/tokenizer.json",
                size: 247_014,
                sha256: "b33e269f7f042a763080d71ba087d74d2f6759674b238a723c028e436b1a25ab",
            },
        ],
        config_template: PT_6L_YAML,
    },
    TtsModelSpec {
        id: "english",
        engine_id: "pocket-tts",
        language: "en",
        label: "Pocket TTS EN (6 camadas · padrão)",
        description: "Modelo oficial em inglês (109M parâmetros) para roteiros em EN.",
        default_for_language: true,
        lightweight: true,
        repo: HF_MIRROR_REPO,
        revision: HF_MIRROR_REVISION,
        license: "CC-BY-4.0",
        files: &[
            AssetFile {
                name: "model.safetensors",
                url: "https://huggingface.co/kyutai/pocket-tts-without-voice-cloning/resolve/a7056f505a4a8ca72d8b5fb1440071d6f1a35739/languages/english/model.safetensors",
                size: 219_029_196,
                sha256: "4c56cbd171c63e8a26ea61f5d48b8a0cd8f3c51f4652c0ab9a19bfcced8c931d",
            },
            AssetFile {
                name: "tokenizer.json",
                url: "https://huggingface.co/kyutai/pocket-tts-without-voice-cloning/resolve/a7056f505a4a8ca72d8b5fb1440071d6f1a35739/languages/english/tokenizer.json",
                size: 245_020,
                sha256: "f498428e1eafee50492f7be13dc9bfafcfc12e508cd0eb1b01c92ecd5d8c6687",
            },
        ],
        config_template: EN_6L_YAML,
    },
];

pub(crate) const VOICES: [TtsVoiceSpec; 3] = [
    TtsVoiceSpec {
        id: "13063",
        engine_id: "pocket-tts",
        language: "pt",
        gender: "male",
        label: "Narrador PT-BR 13063 (masculina)",
        default_for_language: true,
        license: "CC-BY-4.0",
        attribution: "BRSpeech-TTS / CML-TTS (CEIA/UFG, CC-BY 4.0) a partir de gravação LibriVox em domínio público",
        source_url: "https://huggingface.co/datasets/freds0/BRSpeech-TTS",
        embeddings: &[
            VoiceEmbedding {
                model_id: "portuguese_24l",
                filename: "13063-pt-24l.safetensors",
                size: 28_906_528,
                sha256: "1047a37288518872f9759d8802495d1e045a98463077ac81366fafe445283078",
            },
            VoiceEmbedding {
                model_id: "portuguese",
                filename: "13063-pt-6l.safetensors",
                size: 7_226_616,
                sha256: "529b2693901f4fa6a06b2fa9060833bd7e95e10f6a3c5c55d09f08bdf21c7a27",
            },
        ],
    },
    TtsVoiceSpec {
        id: "alba",
        engine_id: "pocket-tts",
        language: "en",
        gender: "female",
        label: "Alba (EN, feminina)",
        default_for_language: true,
        license: "CC-BY-4.0",
        attribution: "Alba MacKenna (kyutai/tts-voices/alba-mackenna/casual.wav, CC-BY 4.0)",
        source_url: "https://huggingface.co/kyutai/tts-voices/tree/323332d33f997de8394f24a193e1a76df720e01a/alba-mackenna",
        embeddings: &[VoiceEmbedding {
            model_id: "english",
            filename: "alba-en.safetensors",
            size: 6_243_576,
            sha256: "c10abce6ca7a66cb2b9b24265490f482bb9a9c761818c810f161d59825a7837b",
        }],
    },
    TtsVoiceSpec {
        id: "marius",
        engine_id: "pocket-tts",
        language: "en",
        gender: "male",
        label: "Marius (EN, masculina)",
        default_for_language: false,
        license: "CC0-1.0",
        attribution: "Unmute Voice Donation Project (kyutai/tts-voices/voice-donations/Selfie.wav, CC0 1.0)",
        source_url: "https://huggingface.co/kyutai/tts-voices/tree/323332d33f997de8394f24a193e1a76df720e01a/voice-donations",
        embeddings: &[VoiceEmbedding {
            model_id: "english",
            filename: "marius-en.safetensors",
            size: 6_243_576,
            sha256: "d6e31471c4636fc5885657486f595b46bd2b8ec356c92c0409ef8beff6cafe1a",
        }],
    },
];

pub(crate) fn find_model(id: &str) -> Option<&'static TtsModelSpec> {
    MODELS.iter().find(|m| m.id == id)
}

pub(crate) fn find_voice(id: &str) -> Option<&'static TtsVoiceSpec> {
    VOICES.iter().find(|v| v.id == id)
}

pub fn is_valid_voice(id: &str) -> bool {
    find_voice(id).is_some()
}

pub(crate) fn default_voice_for_language(lang: &str) -> &'static TtsVoiceSpec {
    let norm = normalize_language(lang);
    VOICES
        .iter()
        .find(|v| v.language == norm && v.default_for_language)
        .unwrap_or(&VOICES[0])
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
        fs::create_dir_all(parent)
            .map_err(|_| error("settings", "Não foi possível salvar as preferências de TTS."))?;
    }
    let bytes = serde_json::to_vec_pretty(tts)
        .map_err(|_| error("settings", "Não foi possível serializar as preferências de TTS."))?;
    fs::write(path, bytes)
        .map_err(|_| error("settings", "Não foi possível salvar as preferências de TTS."))
}

pub(crate) fn active_model_id(settings: &Settings, lang: &str) -> &'static str {
    let norm = normalize_language(lang);
    let saved = load_tts_settings(settings);
    if let Some(choice) = saved.active_models.get(norm) {
        if let Some(spec) = find_model(choice) {
            if spec.language == norm {
                return spec.id;
            }
        }
    }
    MODELS
        .iter()
        .find(|m| m.language == norm && m.default_for_language)
        .map(|m| m.id)
        .unwrap_or("portuguese_24l")
}

pub(crate) fn model_dir(settings: &Settings, spec: &TtsModelSpec) -> PathBuf {
    settings
        .data_dir
        .join("tts-models")
        .join(spec.engine_id)
        .join(spec.id)
}

pub(crate) fn voice_path_in(dir: &Path, filename: &str) -> PathBuf {
    dir.join("voices").join(filename)
}

fn marker_state(dir: &Path) -> Option<Value> {
    let bytes = fs::read(dir.join(MARKER)).ok()?;
    serde_json::from_slice(&bytes).ok()
}

pub(crate) fn is_model_installed(settings: &Settings, spec: &TtsModelSpec) -> bool {
    let dir = model_dir(settings, spec);
    let Some(state) = marker_state(&dir) else {
        return false;
    };
    if state["revision"] != spec.revision || state["terms_version"] != terms_version() {
        return false;
    }
    if !dir.join("config.yaml").is_file() {
        return false;
    }
    if !spec.files.iter().all(|f| dir.join(f.name).is_file()) {
        return false;
    }
    VOICES
        .iter()
        .flat_map(|v| v.embeddings.iter())
        .filter(|e| e.model_id == spec.id)
        .all(|e| voice_path_in(&dir, e.filename).is_file())
}

pub(crate) struct InstalledTtsBundle {
    pub model_id: &'static str,
    pub voice_id: &'static str,
    pub config_path: PathBuf,
    pub voice_path: PathBuf,
}

pub(crate) fn resolve_installed_bundle(
    language: &str,
    requested_voice: Option<&str>,
    requested_model: Option<&str>,
) -> Result<InstalledTtsBundle, CoreError> {
    let settings = load_settings()?;
    let norm = normalize_language(language);
    let voice = match requested_voice {
        Some(id) => find_voice(id).ok_or_else(|| {
            error("tts_voice_unknown", "Voz de Narração desconhecida.")
        })?,
        None => default_voice_for_language(norm),
    };
    if voice.language != norm {
        return Err(error(
            "tts_voice_language_mismatch",
            "A voz escolhida não corresponde ao idioma do Roteiro.",
        ));
    }
    let model_id = match requested_model {
        Some(id) => {
            let m = find_model(id)
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
    let model = find_model(model_id)
        .ok_or_else(|| error("tts_model_unknown", "Modelo TTS desconhecido."))?;
    if !is_model_installed(&settings, model) {
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
    let dir = model_dir(&settings, model);
    let config_path = dir.join("config.yaml");
    let voice_path = voice_path_in(&dir, emb.filename);
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
    path.to_string_lossy().replace('\\', "/").replace('\'', "''")
}

pub(crate) fn render_local_config(spec: &TtsModelSpec, dir: &Path) -> String {
    let model_path = yaml_escape_path(&dir.join("model.safetensors"));
    let tok_path = yaml_escape_path(&dir.join("tokenizer.json"));
    spec.config_template
        .replace("{{MODEL_PATH}}", &model_path)
        .replace("{{TOKENIZER_PATH}}", &tok_path)
}

/// Redirecionamentos só para Hugging Face e GitHub Releases, sempre por HTTPS.
pub(crate) fn allowed_redirect(url: &reqwest::Url) -> bool {
    let host = url.host_str().unwrap_or("");
    url.scheme() == "https"
        && (["huggingface.co", "hf.co", "github.com", "githubusercontent.com"]
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

fn model_voices(model_id: &str) -> Vec<(&'static TtsVoiceSpec, &'static VoiceEmbedding)> {
    VOICES
        .iter()
        .filter_map(|v| {
            v.embeddings
                .iter()
                .find(|e| e.model_id == model_id)
                .map(|e| (v, e))
        })
        .collect()
}

pub fn catalog_json() -> Result<Value, CoreError> {
    let settings = load_settings()?;
    let active_pt = active_model_id(&settings, "pt");
    let active_en = active_model_id(&settings, "en");
    let component_installed = pocket_tts_executable().is_ok();
    let tv = terms_version();

    let engines: Vec<Value> = ENGINES
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

    let models: Vec<Value> = MODELS
        .iter()
        .map(|m| {
            let weights_size: u64 = m.files.iter().map(|f| f.size).sum();
            let voices = model_voices(m.id);
            let voices_size: u64 = voices.iter().map(|(_, e)| e.size).sum();
            let dir = model_dir(&settings, m);
            let installed = is_model_installed(&settings, m);
            let state = marker_state(&dir);
            let terms_accepted = state
                .as_ref()
                .is_some_and(|s| s["terms_version"] == tv);
            let active = match m.language {
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

    let voices: Vec<Value> = VOICES
        .iter()
        .map(|v| {
            let installed_models: Vec<&str> = v
                .embeddings
                .iter()
                .filter(|e| {
                    find_model(e.model_id)
                        .is_some_and(|m| is_model_installed(&settings, m))
                })
                .map(|e| e.model_id)
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
                "models": v.embeddings.iter().map(|e| e.model_id).collect::<Vec<_>>(),
                "installedModels": installed_models,
            })
        })
        .collect();

    Ok(json!({
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
    let spec = find_model(model_id)
        .ok_or_else(|| error("tts_model_unknown", "Modelo TTS desconhecido."))?;
    let language = v["language"].as_str().unwrap_or(spec.language);
    let norm = normalize_language(language);
    if spec.language != norm {
        return Err(error(
            "tts_model_language_mismatch",
            "O modelo TTS escolhido não pertence a este idioma.",
        ));
    }
    let settings = load_settings()?;
    let mut tts = load_tts_settings(&settings);
    tts.active_models.insert(norm.to_owned(), spec.id.to_owned());
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
    let spec = find_model(id)
        .ok_or_else(|| error("unknown_component", "Modelo TTS indisponível."))?;
    let settings = load_settings()?;
    let job_key = format!("tts:{id}");
    let flag = Arc::new(AtomicBool::new(false));
    {
        let mut map = jobs().lock().unwrap();
        if map.contains_key(&job_key) {
            return Err(error("already_downloading", "Download em andamento."));
        }
        map.insert(job_key.clone(), flag.clone());
    }
    let result = download_model(spec, &settings, &flag, &job_key, events);
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

fn download_model(
    spec: &TtsModelSpec,
    settings: &Settings,
    cancel: &AtomicBool,
    job_key: &str,
    events: &mut EventSink<'_>,
) -> CommandResult {
    let client = http_client()?;
    let root = settings.data_dir.join("tts-models").join(spec.engine_id);
    let stage = root.join(format!("{}.part", spec.id));
    fs::create_dir_all(stage.join("voices"))
        .map_err(|_| error("download", "Não foi possível preparar a pasta do modelo TTS."))?;

    let voices = model_voices(spec.id);
    let total: u64 = spec
        .files
        .iter()
        .map(|f| f.size)
        .chain(voices.iter().map(|(_, e)| e.size))
        .sum::<u64>()
        .max(1);
    let mut done = 0u64;

    for file in spec.files {
        let base = done;
        fetch_with(
            &client,
            file.url,
            file.sha256,
            file.size,
            &stage.join(file.name),
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
        let url = emb.url();
        fetch_with(
            &client,
            &url,
            emb.sha256,
            emb.size,
            &voice_path_in(&stage, emb.filename),
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

    let dir = model_dir(settings, spec);
    let _ = fs::remove_dir_all(&dir);
    fs::rename(&stage, &dir)
        .map_err(|_| error("install", "Não foi possível instalar o modelo TTS."))?;
    fs::write(dir.join("config.yaml"), render_local_config(spec, &dir))
        .map_err(|_| error("install", "Não foi possível gravar a configuração do modelo TTS."))?;

    let accepted_at = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map_or(0, |d| d.as_secs());
    let state = json!({
        "engine": spec.engine_id,
        "id": spec.id,
        "repo": spec.repo,
        "revision": spec.revision,
        "terms_accepted_at": accepted_at,
        "terms_version": terms_version(),
        "voices": voices.iter().map(|(v, _)| v.id).collect::<Vec<_>>(),
    });
    fs::write(dir.join(MARKER), serde_json::to_vec_pretty(&state).unwrap())
        .map_err(|_| error("install", "Não foi possível registrar o estado do modelo TTS."))?;

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
        for m in MODELS {
            assert_eq!(m.license, "CC-BY-4.0");
            assert_eq!(m.revision.len(), 40);
            for f in m.files {
                assert!(f.size > 0);
                assert_eq!(f.sha256.len(), 64);
                assert!(f.sha256.bytes().all(|b| b.is_ascii_hexdigit()));
                assert!(f.url.starts_with("https://huggingface.co/"));
                assert!(f.url.contains(m.revision));
            }
        }
        for v in VOICES {
            assert!(matches!(v.license, "CC-BY-4.0" | "CC0-1.0"));
            assert!(!matches!(v.id, "rafael" | "cosette" | "jean"));
            assert!(!v.embeddings.is_empty());
        }
    }

    #[test]
    fn redirects_allow_only_https_huggingface_and_github() {
        let ok = |u: &str| allowed_redirect(&u.parse().unwrap());
        assert!(ok("https://huggingface.co/x"));
        assert!(ok("https://cdn-lfs.hf.co/x"));
        assert!(ok("https://github.com/GUSTAVOHOOO/clipes/releases/download/x/y"));
        assert!(ok("https://release-assets.githubusercontent.com/x"));
        assert!(!ok("http://github.com/x"));
        assert!(!ok("https://example.com/github.com"));
    }

    #[test]
    fn local_config_uses_forward_slashes_and_local_paths() {
        let dir = PathBuf::from(r"C:\Users\Teste\AppData\Local\Clipes\tts-models\pocket-tts\portuguese_24l");
        let yaml = render_local_config(&MODELS[0], &dir);
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
