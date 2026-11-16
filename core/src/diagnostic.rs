use crate::{CommandRegistration, CommandResult, CoreError, EventSink};
use serde_json::{json, Value};
use std::{
    fs::{self, OpenOptions},
    io::{BufRead, BufReader, Write},
    path::{Path, PathBuf},
};

/// Only these reviewed fields can be contributed by features.
#[derive(Clone, Copy, PartialEq, Eq)]
pub enum DiagnosticKind {
    Components,
    GpuVram,
    Encoder,
    TranscriptionEngine,
    Provider,
    TokenCalibration,
    TaskVersion,
    PromptHash,
    EffectiveContextTokens,
    EffectiveContextOrigin,
}
impl DiagnosticKind {
    fn label(self) -> &'static str {
        match self {
            Self::Components => "Componentes",
            Self::GpuVram => "GPU/VRAM",
            Self::Encoder => "Encoder",
            Self::TranscriptionEngine => "Motor de transcrição",
            Self::Provider => "Provedor",
            Self::TokenCalibration => "Calibração de tokens",
            Self::TaskVersion => "Versão da Tarefa de IA",
            Self::PromptHash => "Hash do prompt (SHA-256)",
            Self::EffectiveContextTokens => "Contexto efetivo (tokens)",
            Self::EffectiveContextOrigin => "Origem do contexto efetivo",
        }
    }
}
/// Values must be fixed, reviewed strings, never user-provided text.
pub struct DiagnosticField {
    pub kind: DiagnosticKind,
    pub value: fn() -> String,
}
inventory::collect!(DiagnosticField);

/// The log accepts event identifiers, never arbitrary error messages or paths.
#[derive(Clone, Copy)]
pub enum DiagnosticEvent {
    ComponentFailure,
    InvalidEstimateHint,
}
impl DiagnosticEvent {
    fn code(self) -> &'static str {
        match self {
            Self::ComponentFailure => "component_failure",
            Self::InvalidEstimateHint => "invalid_estimate_hint",
        }
    }
}
fn log_dir() -> Option<PathBuf> {
    std::env::var_os("CLIPES_DATA_DIR")
        .map(PathBuf::from)
        .or_else(|| dirs::data_local_dir().map(|p| p.join("Clipes")))
}
pub fn record(event: DiagnosticEvent) {
    if let Some(dir) = log_dir() {
        if fs::create_dir_all(&dir).is_ok() {
            if let Ok(mut file) = OpenOptions::new()
                .create(true)
                .append(true)
                .open(dir.join("diagnostic.log"))
            {
                let _ = writeln!(file, "{}", event.code());
            }
        }
    }
}
fn log_lines(path: &Path) -> Vec<&'static str> {
    let mut lines = std::collections::VecDeque::new();
    if let Ok(file) = fs::File::open(path) {
        for line in BufReader::new(file).lines().map_while(Result::ok) {
            // Reconstruct messages from an allowlist on export, even if the file is edited.
            let message = match line.as_str() {
                "component_failure" => Some("Erro: falha em componente"),
                "invalid_estimate_hint" => Some("Metadados de estimativa inválidos"),
                _ => None,
            };
            if let Some(message) = message {
                if lines.len() == 200 {
                    lines.pop_front();
                }
                lines.push_back(message);
            }
        }
    }
    lines.into_iter().collect()
}
// The file and its export are both restricted to a closed vocabulary.
fn valid_ytdlp_code(code: &str) -> bool {
    matches!(
        code,
        "age_restricted"
            | "login_required"
            | "js_runtime_missing"
            | "sabr_unavailable"
            | "download_failed"
    )
}
fn valid_ytdlp_pattern(pattern: &str) -> bool {
    matches!(
        pattern,
        "yt_dlp.sign_in_age"
            | "yt_dlp.age_restricted"
            | "yt_dlp.login_required"
            | "yt_dlp.no_js_runtime"
            | "yt_dlp.sabr_unavailable"
            | "yt_dlp.http_403"
            | "yt_dlp.unrecognized"
    )
}
fn valid_ytdlp_version(version: &str) -> bool {
    !version.is_empty()
        && version.len() <= 40
        && version.bytes().all(|b| b.is_ascii_digit() || b == b'.')
}
pub(crate) fn record_ytdlp(code: &str, patterns: &[&str], exit: Option<i32>, version: &str) {
    if !valid_ytdlp_code(code) {
        return;
    }
    let version = if valid_ytdlp_version(version) {
        version
    } else {
        "indisponível"
    };
    let patterns: Vec<_> = patterns
        .iter()
        .rev()
        .take(50)
        .rev()
        .filter(|p| valid_ytdlp_pattern(p))
        .collect();
    if let Some(dir) = log_dir() {
        if fs::create_dir_all(&dir).is_ok() {
            let data = json!({"code":code,"patterns":patterns,"exit":exit,"version":version});
            let _ = fs::write(dir.join("ytdlp-diagnostic.json"), data.to_string());
        }
    }
}
fn ytdlp_diagnostic() -> Option<String> {
    let bytes = fs::read(log_dir()?.join("ytdlp-diagnostic.json")).ok()?;
    if bytes.len() > 8192 {
        return None;
    }
    let data: Value = serde_json::from_slice(&bytes).ok()?;
    let code = data["code"].as_str().filter(|c| valid_ytdlp_code(c))?;
    let version = data["version"]
        .as_str()
        .filter(|v| valid_ytdlp_version(v))
        .unwrap_or("indisponível");
    let exit = data["exit"]
        .as_i64()
        .and_then(|v| i32::try_from(v).ok())
        .map(|v| v.to_string())
        .unwrap_or_else(|| "indisponível".into());
    let patterns: Vec<_> = data["patterns"]
        .as_array()?
        .iter()
        .rev()
        .take(50)
        .rev()
        .filter_map(|p| p.as_str().filter(|p| valid_ytdlp_pattern(p)))
        .collect();
    Some(format!(
        "yt-dlp: {code}; exit: {exit}; versão: {version}\n{}",
        patterns.join("\n")
    ))
}
fn get(_: Value, _: &mut EventSink<'_>) -> CommandResult {
    let logs = log_dir()
        .map(|p| log_lines(&p.join("diagnostic.log")))
        .unwrap_or_default();
    let mut lines = vec![
        format!("Clipes: {}", env!("CARGO_PKG_VERSION")),
        format!("Sistema operacional: {}", std::env::consts::OS),
        format!(
            "Etapa da falha: {}",
            if logs.is_empty() {
                "indisponível"
            } else {
                "componente"
            }
        ),
        format!(
            "Avisos e erros: {}",
            if logs.is_empty() {
                "indisponível".into()
            } else {
                logs.join("\n")
            }
        ),
    ];
    if let Some(detail) = ytdlp_diagnostic() {
        lines.push(detail);
    }
    for kind in [
        DiagnosticKind::Components,
        DiagnosticKind::GpuVram,
        DiagnosticKind::Encoder,
        DiagnosticKind::TranscriptionEngine,
        DiagnosticKind::Provider,
        DiagnosticKind::TokenCalibration,
        DiagnosticKind::TaskVersion,
        DiagnosticKind::PromptHash,
        DiagnosticKind::EffectiveContextTokens,
        DiagnosticKind::EffectiveContextOrigin,
    ] {
        let value = inventory::iter::<DiagnosticField>
            .into_iter()
            .find(|field| field.kind == kind)
            .map(|field| (field.value)())
            .unwrap_or_else(|| "indisponível".into());
        lines.push(format!("{}: {}", kind.label(), value));
    }
    Ok(json!({"text": lines.join("\n")}))
}
fn export(v: Value, _: &mut EventSink<'_>) -> CommandResult {
    let path = v["path"].as_str().ok_or_else(|| CoreError {
        code: "invalid_path".into(),
        message: "Caminho inválido".into(),
        usage: None,
    })?;
    let destination = Path::new(path);
    if !destination.is_absolute()
        || destination.extension().and_then(|s| s.to_str()) != Some("txt")
        || destination.is_dir()
    {
        return Err(CoreError {
            code: "invalid_path".into(),
            message: "Caminho inválido".into(),
            usage: None,
        });
    }
    let text = v["text"].as_str().ok_or_else(|| CoreError {
        code: "invalid_text".into(),
        message: "Texto inválido".into(),
        usage: None,
    })?;
    fs::write(path, text).map_err(|_| CoreError {
        code: "export_failed".into(),
        message: "Não foi possível salvar o diagnóstico".into(),
        usage: None,
    })?;
    Ok(json!({}))
}
inventory::submit! { CommandRegistration { name: "diagnostic.get", execute: get } }
inventory::submit! { CommandRegistration { name: "diagnostic.export", execute: export } }
#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn log_export_ignores_unknown_and_sensitive_lines_and_limits_history() {
        let path =
            std::env::temp_dir().join(format!("clipes-diagnostic-test-{}", std::process::id()));
        fs::write(
            &path,
            format!(
                "{}\nC:/Users/Alice/secret\n",
                "component_failure\n".repeat(250)
            ),
        )
        .unwrap();
        let lines = log_lines(&path);
        assert_eq!(lines.len(), 200);
        assert!(lines
            .iter()
            .all(|line| *line == "Erro: falha em componente"));
        fs::remove_file(path).unwrap();
    }
}
