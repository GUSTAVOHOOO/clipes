use clipes_core::CoreError;
use std::{
    ffi::OsString,
    fs,
    path::{Path, PathBuf},
};

fn explorer_error(code: &str, message: impl Into<String>) -> CoreError {
    CoreError {
        code: code.into(),
        message: message.into(),
        usage: None,
    }
}

#[cfg(any(target_os = "windows", test))]
fn has_network_or_device_prefix(raw: &str) -> bool {
    if raw.starts_with("//") {
        return true;
    }
    #[cfg(windows)]
    {
        use std::path::{Component, Prefix};
        matches!(
            Path::new(raw).components().next(),
            Some(Component::Prefix(prefix))
                if matches!(
                    prefix.kind(),
                    Prefix::UNC(..) | Prefix::VerbatimUNC(..) | Prefix::DeviceNS(..) | Prefix::Verbatim(..)
                )
        )
    }
    #[cfg(not(windows))]
    {
        raw.starts_with(r"\\")
    }
}

#[cfg(any(target_os = "windows", test))]
fn strip_windows_verbatim_prefix(path: &Path) -> PathBuf {
    let text = path.to_string_lossy();
    if let Some(rest) = text.strip_prefix(r"\\?\") {
        let bytes = rest.as_bytes();
        if bytes.len() >= 3 && bytes[0].is_ascii_alphabetic() && bytes[1] == b':' {
            return PathBuf::from(rest);
        }
    }
    path.to_path_buf()
}

/// Valida que `raw` é um caminho local absoluto existente (arquivo ou pasta),
/// rejeitando caminhos relativos, prefixos UNC/rede/dispositivo e inexistentes.
#[cfg(any(target_os = "windows", test))]
pub(crate) fn validate_local_path(raw: &str) -> Result<(PathBuf, bool), CoreError> {
    if raw.trim().is_empty() {
        return Err(explorer_error(
            "invalid_path",
            "Informe o caminho da pasta ou do arquivo.",
        ));
    }
    if has_network_or_device_prefix(raw) {
        return Err(explorer_error(
            "invalid_path",
            "Caminhos de rede (UNC) ou dispositivo não são permitidos.",
        ));
    }
    let path = Path::new(raw);
    if !path.is_absolute() {
        return Err(explorer_error(
            "invalid_path",
            "Informe um caminho absoluto válido.",
        ));
    }
    let canonical = fs::canonicalize(path).map_err(|err| {
        if err.kind() == std::io::ErrorKind::NotFound {
            explorer_error(
                "path_not_found",
                "A pasta ou o arquivo informado não existe.",
            )
        } else {
            explorer_error(
                "invalid_path",
                format!("Não foi possível validar o caminho: {err}"),
            )
        }
    })?;
    let canonical_text = canonical.to_string_lossy();
    if has_network_or_device_prefix(&canonical_text) {
        return Err(explorer_error(
            "invalid_path",
            "Caminhos de rede (UNC) ou dispositivo não são permitidos.",
        ));
    }
    let meta = fs::metadata(&canonical).map_err(|err| {
        explorer_error(
            "invalid_path",
            format!("Não foi possível ler os atributos do caminho: {err}"),
        )
    })?;
    if !meta.is_dir() && !meta.is_file() {
        return Err(explorer_error(
            "invalid_path",
            "O caminho deve apontar para uma pasta ou um arquivo.",
        ));
    }
    let clean = strip_windows_verbatim_prefix(&canonical);
    Ok((clean, meta.is_dir()))
}

/// Monta os argumentos do `explorer.exe`:
/// - pasta: `[<caminho>]`
/// - arquivo: `["/select,<caminho>"]` em um único argumento.
#[cfg(any(target_os = "windows", test))]
pub(crate) fn build_explorer_args(path: &Path, is_dir: bool) -> Vec<OsString> {
    if is_dir {
        vec![path.as_os_str().to_os_string()]
    } else {
        let mut select = OsString::from("/select,");
        select.push(path.as_os_str());
        vec![select]
    }
}

#[cfg(any(target_os = "windows", test))]
pub(crate) fn prepare_explorer_args(raw: &str) -> Result<Vec<OsString>, CoreError> {
    let (clean, is_dir) = validate_local_path(raw)?;
    Ok(build_explorer_args(&clean, is_dir))
}

#[cfg(target_os = "windows")]
fn explorer_executable() -> PathBuf {
    if let Some(root) = std::env::var_os("SystemRoot") {
        let candidate = PathBuf::from(root).join("explorer.exe");
        if candidate.is_file() {
            return candidate;
        }
    }
    PathBuf::from("explorer.exe")
}

/// Abre pasta ou revela arquivo no Windows Explorer via `std::process::Command`
/// sem shell e sem aguardar o encerramento do processo.
#[cfg(target_os = "windows")]
pub(crate) fn open_in_windows_explorer(raw: &str) -> Result<(), CoreError> {
    let args = prepare_explorer_args(raw)?;
    std::process::Command::new(explorer_executable())
        .args(&args)
        .spawn()
        .map_err(|err| {
            explorer_error(
                "open_path_failed",
                format!("Não foi possível abrir o Explorador de Arquivos: {err}"),
            )
        })?;
    Ok(())
}

#[cfg(not(target_os = "windows"))]
pub(crate) fn open_in_windows_explorer(_raw: &str) -> Result<(), CoreError> {
    Err(explorer_error(
        "unsupported_platform",
        "Abertura direta via explorer.exe só é suportada no Windows.",
    ))
}

#[tauri::command]
pub(crate) async fn open_path_windows(path: String) -> Result<(), CoreError> {
    tauri::async_runtime::spawn_blocking(move || open_in_windows_explorer(&path))
        .await
        .map_err(|_| explorer_error("open_path_failed", "Falha ao abrir caminho no sistema."))?
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn build_explorer_args_handles_spaces_quotes_and_commas() {
        let dir = Path::new(r#"C:\Cortes "Ao Vivo", Parte 1\lote final"#);
        assert_eq!(
            build_explorer_args(dir, true),
            vec![OsString::from(r#"C:\Cortes "Ao Vivo", Parte 1\lote final"#)]
        );

        let file = Path::new(r#"C:\Cortes "Ao Vivo", Parte 1\corte, 01.mp4"#);
        assert_eq!(
            build_explorer_args(file, false),
            vec![OsString::from(
                r#"/select,C:\Cortes "Ao Vivo", Parte 1\corte, 01.mp4"#
            )]
        );
    }

    #[test]
    fn validate_local_path_rejects_relative_unc_and_missing_paths() {
        for bad in [
            "",
            "   ",
            "pasta/relativa",
            "./relativo.mp4",
            r"\\servidor\compartilhamento\video.mp4",
            "//servidor/compartilhamento/video.mp4",
            r"\\?\UNC\servidor\compartilhamento\video.mp4",
        ] {
            let err = validate_local_path(bad).unwrap_err();
            assert_eq!(
                err.code, "invalid_path",
                "esperado invalid_path para {bad:?}"
            );
        }

        #[cfg(windows)]
        {
            for bad_win in [r"\sem_unidade\pasta", r"C:relativo_na_unidade", r"\\.\NUL"] {
                let err = validate_local_path(bad_win).unwrap_err();
                assert_eq!(
                    err.code, "invalid_path",
                    "esperado invalid_path para {bad_win:?}"
                );
            }
        }

        let missing = tempfile::tempdir().unwrap();
        let missing_path = missing.path().join("nao-existe.mp4");
        let err = validate_local_path(missing_path.to_str().unwrap()).unwrap_err();
        assert_eq!(err.code, "path_not_found");
    }

    #[test]
    fn prepare_explorer_args_canonicalizes_real_dir_and_file_with_spaces_and_commas() {
        let root = tempfile::Builder::new()
            .prefix("clipes-511-")
            .tempdir()
            .unwrap();
        let dir = root.path().join("pasta com espaco, virgula");
        fs::create_dir(&dir).unwrap();
        let file = dir.join("corte final, 01.mp4");
        fs::write(&file, b"mp4").unwrap();

        let dir_args = prepare_explorer_args(dir.to_str().unwrap()).unwrap();
        assert_eq!(dir_args.len(), 1);
        let dir_text = dir_args[0].to_string_lossy();
        assert!(!dir_text.starts_with(r"\\?\"));
        assert!(dir_text.ends_with("pasta com espaco, virgula"));

        let file_args = prepare_explorer_args(file.to_str().unwrap()).unwrap();
        assert_eq!(file_args.len(), 1);
        let file_text = file_args[0].to_string_lossy();
        assert!(file_text.starts_with("/select,"));
        let selected = file_text.strip_prefix("/select,").unwrap();
        assert!(!selected.starts_with(r"\\?\"));
        assert!(selected.ends_with("corte final, 01.mp4"));
    }
}
