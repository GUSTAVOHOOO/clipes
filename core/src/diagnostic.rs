use crate::{CommandRegistration, CommandResult, CoreError, EventSink};
use serde_json::{json, Value};
use std::{
    fs::{self, OpenOptions},
    io::{BufRead, BufReader, Write},
    path::Path,
};

/// Only these reviewed fields can be contributed by features.
#[derive(Clone, Copy, PartialEq, Eq)]
pub enum DiagnosticKind {
    Components,
    GpuVram,
    Encoder,
    TranscriptionEngine,
    Provider,
}
impl DiagnosticKind {
    fn label(self) -> &'static str {
        match self {
            Self::Components => "Componentes",
            Self::GpuVram => "GPU/VRAM",
            Self::Encoder => "Encoder",
            Self::TranscriptionEngine => "Motor de transcrição",
            Self::Provider => "Provedor",
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
}
impl DiagnosticEvent {
    fn code(self) -> &'static str {
        match self {
            Self::ComponentFailure => "component_failure",
        }
    }
}
pub fn record(event: DiagnosticEvent) {
    if let Some(dir) = dirs::data_local_dir().map(|p| p.join("Clipes")) {
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
fn get(_: Value, _: &mut EventSink<'_>) -> CommandResult {
    let logs = dirs::data_local_dir()
        .map(|p| log_lines(&p.join("Clipes").join("diagnostic.log")))
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
    for kind in [
        DiagnosticKind::Components,
        DiagnosticKind::GpuVram,
        DiagnosticKind::Encoder,
        DiagnosticKind::TranscriptionEngine,
        DiagnosticKind::Provider,
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
    })?;
    let destination = Path::new(path);
    if !destination.is_absolute()
        || destination.extension().and_then(|s| s.to_str()) != Some("txt")
        || destination.is_dir()
    {
        return Err(CoreError {
            code: "invalid_path".into(),
            message: "Caminho inválido".into(),
        });
    }
    let text = v["text"].as_str().ok_or_else(|| CoreError {
        code: "invalid_text".into(),
        message: "Texto inválido".into(),
    })?;
    fs::write(path, text).map_err(|_| CoreError {
        code: "export_failed".into(),
        message: "Não foi possível salvar o diagnóstico".into(),
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
