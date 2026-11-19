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
    CatalogVerificationFailed,
    GpuProbeFallback,
}
impl DiagnosticEvent {
    fn code(self) -> &'static str {
        match self {
            Self::ComponentFailure => "component_failure",
            Self::InvalidEstimateHint => "invalid_estimate_hint",
            Self::CatalogVerificationFailed => "catalog_verification_failed",
            Self::GpuProbeFallback => "gpu_probe_fallback",
        }
    }

    fn from_code(code: &str) -> Option<Self> {
        match code {
            "component_failure" => Some(Self::ComponentFailure),
            "invalid_estimate_hint" => Some(Self::InvalidEstimateHint),
            "catalog_verification_failed" => Some(Self::CatalogVerificationFailed),
            "gpu_probe_fallback" => Some(Self::GpuProbeFallback),
            _ => None,
        }
    }

    fn message(self) -> &'static str {
        match self {
            Self::ComponentFailure => "Erro: falha em componente",
            Self::InvalidEstimateHint => "Metadados de estimativa inválidos",
            Self::CatalogVerificationFailed => {
                "Aviso: falha na verificação do catálogo remoto de modelos"
            }
            Self::GpuProbeFallback => "Aviso: sonda da GPU falhou; transcrição em CPU",
        }
    }

    fn stage(self) -> &'static str {
        match self {
            Self::ComponentFailure => "componente",
            Self::InvalidEstimateHint => "estimativa de provedor",
            Self::CatalogVerificationFailed => "verificação de catálogo",
            Self::GpuProbeFallback => "sonda de GPU",
        }
    }
}
const YTDLP_STAGE: &str = "importação por URL (yt-dlp)";
fn log_dir() -> Option<PathBuf> {
    crate::paths::data_dir().ok()
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
fn log_events(path: &Path) -> Vec<DiagnosticEvent> {
    let mut events = std::collections::VecDeque::new();
    if let Ok(file) = fs::File::open(path) {
        for line in BufReader::new(file).lines().map_while(Result::ok) {
            // Reconstruct events from an allowlist on export, even if the file is edited.
            if let Some(event) = DiagnosticEvent::from_code(line.as_str()) {
                if events.len() == 200 {
                    events.pop_front();
                }
                events.push_back(event);
            }
        }
    }
    events.into_iter().collect()
}
#[cfg(test)]
fn log_lines(path: &Path) -> Vec<&'static str> {
    log_events(path)
        .into_iter()
        .map(DiagnosticEvent::message)
        .collect()
}
fn file_modified(path: &Path) -> Option<std::time::SystemTime> {
    fs::metadata(path).and_then(|m| m.modified()).ok()
}
fn infer_stage(
    log_path: Option<&Path>,
    events: &[DiagnosticEvent],
    ytdlp_path: Option<&Path>,
    has_ytdlp: bool,
) -> &'static str {
    let Some(last_event) = events.last().copied() else {
        return if has_ytdlp {
            YTDLP_STAGE
        } else {
            "indisponível"
        };
    };
    if !has_ytdlp {
        return last_event.stage();
    }
    match (
        log_path.and_then(file_modified),
        ytdlp_path.and_then(file_modified),
    ) {
        (Some(log_mtime), Some(ytdlp_mtime)) if ytdlp_mtime > log_mtime => YTDLP_STAGE,
        _ => last_event.stage(),
    }
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
            | "yt_dlp.age_limit_needs_auth"
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
    let dir = log_dir();
    let log_path = dir.as_deref().map(|p| p.join("diagnostic.log"));
    let ytdlp_path = dir.as_deref().map(|p| p.join("ytdlp-diagnostic.json"));
    let events = log_path.as_deref().map(log_events).unwrap_or_default();
    let ytdlp = ytdlp_diagnostic();
    let stage = infer_stage(
        log_path.as_deref(),
        &events,
        ytdlp_path.as_deref(),
        ytdlp.is_some(),
    );
    let logs: Vec<&'static str> = events
        .iter()
        .copied()
        .map(DiagnosticEvent::message)
        .collect();
    let mut lines = vec![
        format!("Clipes: {}", env!("CARGO_PKG_VERSION")),
        format!("Sistema operacional: {}", std::env::consts::OS),
        format!("Etapa da falha: {stage}"),
        format!(
            "Avisos e erros: {}",
            if logs.is_empty() {
                "indisponível".into()
            } else {
                logs.join("\n")
            }
        ),
    ];
    if let Some(detail) = ytdlp {
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
    use std::time::{Duration, SystemTime};

    fn stage_line(text: &str) -> &str {
        text.lines()
            .find(|line| line.starts_with("Etapa da falha: "))
            .expect("missing Etapa da falha line")
    }

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

    #[test]
    fn diagnostic_get_infers_failure_stage_from_recent_entries_without_leaking() {
        let root = tempfile::tempdir().unwrap();
        let _guard = crate::test_env::set_data_dir(root.path());

        let get_text = || {
            crate::dispatch("diagnostic.get", json!({}), &mut |_| {}).unwrap()["text"]
                .as_str()
                .unwrap()
                .to_owned()
        };

        // Empty log and no ytdlp-diagnostic.json -> no stage.
        let empty = get_text();
        assert_eq!(stage_line(&empty), "Etapa da falha: indisponível");
        assert!(empty.contains("Avisos e erros: indisponível"));

        // Unknown / sensitive lines only -> still no stage and never leaked.
        fs::write(
            root.path().join("diagnostic.log"),
            "C:/Users/Alice/secret\nunknown_stage\n",
        )
        .unwrap();
        let ignored = get_text();
        assert_eq!(stage_line(&ignored), "Etapa da falha: indisponível");
        assert!(!ignored.contains("Alice"));
        assert!(!ignored.contains("secret"));
        assert!(!ignored.contains("unknown_stage"));

        // Different origins in diagnostic.log infer their corresponding stage from the latest valid entry.
        record(DiagnosticEvent::GpuProbeFallback);
        assert_eq!(stage_line(&get_text()), "Etapa da falha: sonda de GPU");

        record(DiagnosticEvent::CatalogVerificationFailed);
        assert_eq!(
            stage_line(&get_text()),
            "Etapa da falha: verificação de catálogo"
        );

        record(DiagnosticEvent::InvalidEstimateHint);
        assert_eq!(
            stage_line(&get_text()),
            "Etapa da falha: estimativa de provedor"
        );

        record(DiagnosticEvent::ComponentFailure);
        assert_eq!(stage_line(&get_text()), "Etapa da falha: componente");

        // Sensitive line after a valid event is ignored; stage still comes from latest valid entry.
        fs::write(
            root.path().join("diagnostic.log"),
            "component_failure\ncatalog_verification_failed\nC:/Users/Alice/secret\n",
        )
        .unwrap();
        let after_injected = get_text();
        assert_eq!(
            stage_line(&after_injected),
            "Etapa da falha: verificação de catálogo"
        );
        assert!(!after_injected.contains("Alice"));
        assert!(!after_injected.contains("secret"));

        // ytdlp-diagnostic.json alone infers the URL import / yt-dlp stage.
        fs::remove_file(root.path().join("diagnostic.log")).unwrap();
        record_ytdlp(
            "download_failed",
            &["yt_dlp.http_403"],
            Some(1),
            "2027.01.01.000000",
        );
        let ytdlp_only = get_text();
        assert_eq!(
            stage_line(&ytdlp_only),
            "Etapa da falha: importação por URL (yt-dlp)"
        );
        assert!(ytdlp_only.contains("yt-dlp: download_failed"));

        // When both files exist, the most recently modified source wins.
        let now = SystemTime::now();
        let older = now - Duration::from_secs(60);
        fs::write(root.path().join("diagnostic.log"), "gpu_probe_fallback\n").unwrap();
        fs::File::options()
            .write(true)
            .open(root.path().join("diagnostic.log"))
            .unwrap()
            .set_modified(older)
            .unwrap();
        fs::File::options()
            .write(true)
            .open(root.path().join("ytdlp-diagnostic.json"))
            .unwrap()
            .set_modified(now)
            .unwrap();
        assert_eq!(
            stage_line(&get_text()),
            "Etapa da falha: importação por URL (yt-dlp)"
        );

        let newer = now + Duration::from_secs(60);
        fs::File::options()
            .write(true)
            .open(root.path().join("diagnostic.log"))
            .unwrap()
            .set_modified(newer)
            .unwrap();
        assert_eq!(stage_line(&get_text()), "Etapa da falha: sonda de GPU");

        // History limit (>200 entries) still uses the most recent valid entry.
        fs::remove_file(root.path().join("ytdlp-diagnostic.json")).unwrap();
        fs::write(
            root.path().join("diagnostic.log"),
            format!("{}gpu_probe_fallback\n", "component_failure\n".repeat(250)),
        )
        .unwrap();
        assert_eq!(stage_line(&get_text()), "Etapa da falha: sonda de GPU");

        // Tampered ytdlp-diagnostic.json with unknown code is ignored and never leaks.
        fs::remove_file(root.path().join("diagnostic.log")).unwrap();
        fs::write(
            root.path().join("ytdlp-diagnostic.json"),
            r#"{"code":"C:/Users/Alice/secret","patterns":[],"exit":1,"version":"1.0"}"#,
        )
        .unwrap();
        let tampered = get_text();
        assert_eq!(stage_line(&tampered), "Etapa da falha: indisponível");
        assert!(!tampered.contains("Alice"));
        assert!(!tampered.contains("secret"));
    }
}
