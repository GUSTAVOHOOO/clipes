//! Central app directory resolution and one-time legacy data migration (#231).
//!
//! All user/app files outside individual `.clipes` Projects live under the app identifier
//! (`io.github.gustavohooo.clipes`), separated from the NSIS install directory
//! (`%LOCALAPPDATA%\Clipes`). Setting `CLIPES_DATA_DIR` isolates everything into that directory
//! and never triggers migration of real user data.
use crate::CoreError;
use serde::{Deserialize, Serialize};
use std::{
    collections::BTreeMap,
    ffi::OsStr,
    fs, io,
    path::{Path, PathBuf},
    sync::OnceLock,
};

pub const APP_IDENTIFIER: &str = "io.github.gustavohooo.clipes";
const LEGACY_DIR_NAME: &str = "Clipes";
const MIGRATION_MARKER: &str = ".migrated-v1.json";

const LEGACY_DATA_DIRS: &[&str] = &["components", "models", "worker"];
const LEGACY_DATA_FILES: &[&str] = &[
    "projects.json",
    "transcription-hardware.json",
    "diagnostic.log",
    "ytdlp-diagnostic.json",
    "export-encoder.json",
];
const LEGACY_DATA_TO_CONFIG_FILES: &[&str] = &["export-settings.json", "url-import.json"];
const LEGACY_CONFIG_LOCAL_FILES: &[&str] = &["settings.json", "transcription-consent.json"];
const LEGACY_PROJECT_CONFIG_FILES: &[&str] = &[
    "assistant.json",
    "provider.json",
    "provider-cli.json",
    "provider-prices.json",
    "token-calibration.json",
    "provider-context.json",
];

static MIGRATED: OnceLock<()> = OnceLock::new();

fn unavailable() -> CoreError {
    CoreError {
        code: "settings".into(),
        message: "Diretório local indisponível.".into(),
        usage: None,
    }
}

/// Resolved base directories for Clipes outside `.clipes` Projects.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct AppDirs {
    pub data_dir: PathBuf,
    pub config_dir: PathBuf,
    pub cache_dir: PathBuf,
    pub isolated: bool,
}

/// OS base directories used to resolve `AppDirs` and `LegacyDirs` without side effects.
#[derive(Debug, Clone, Default)]
pub struct SystemBases {
    pub data_local: Option<PathBuf>,
    pub config_local: Option<PathBuf>,
    pub cache: Option<PathBuf>,
    pub project_config: Option<PathBuf>,
}

impl SystemBases {
    #[cfg(not(test))]
    fn current() -> Self {
        Self {
            data_local: dirs::data_local_dir(),
            config_local: dirs::config_local_dir(),
            cache: dirs::cache_dir(),
            project_config: directories::ProjectDirs::from("io", "github.gustavohooo", "clipes")
                .map(|p| p.config_dir().to_path_buf()),
        }
    }
}

/// Legacy directories where previous versions stored data/config outside Projects.
#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct LegacyDirs {
    pub data_local: Option<PathBuf>,
    pub config_local: Option<PathBuf>,
    pub project_config: Option<PathBuf>,
}

impl LegacyDirs {
    /// Computes legacy directories from OS base directories.
    pub fn from_bases(bases: &SystemBases) -> Self {
        Self {
            data_local: bases.data_local.as_ref().map(|p| p.join(LEGACY_DIR_NAME)),
            config_local: bases.config_local.as_ref().map(|p| p.join(LEGACY_DIR_NAME)),
            project_config: bases.project_config.clone(),
        }
    }
}

/// Outcome recorded per migrated entry (fixed categories only, never personal paths).
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum MigrationOutcome {
    Moved,
    MovedCrossVolume,
    Merged,
    SkippedExisting,
    Absent,
    Error,
}

/// Summary of a legacy-data migration pass.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct MigrationReport {
    pub version: u32,
    pub already_migrated: bool,
    pub skipped_isolated: bool,
    pub marker_written: bool,
    pub entries: BTreeMap<String, MigrationOutcome>,
}

impl MigrationReport {
    fn has_errors(&self) -> bool {
        self.entries
            .values()
            .any(|outcome| *outcome == MigrationOutcome::Error)
    }
}

/// Resolves `AppDirs` purely from `CLIPES_DATA_DIR`, OS base dirs, and target OS flavor.
pub fn resolve_with_env(
    clipes_data_dir: Option<&OsStr>,
    bases: &SystemBases,
    is_windows: bool,
) -> Result<AppDirs, CoreError> {
    if let Some(dir) = clipes_data_dir.filter(|v| !v.is_empty()) {
        let root = PathBuf::from(dir);
        return Ok(AppDirs {
            cache_dir: root.join("cache"),
            config_dir: root.clone(),
            data_dir: root,
            isolated: true,
        });
    }
    let data_local = bases.data_local.as_ref().ok_or_else(unavailable)?;
    let data_dir = data_local.join(APP_IDENTIFIER);
    let config_dir = if is_windows {
        data_dir.clone()
    } else {
        bases
            .config_local
            .as_ref()
            .unwrap_or(data_local)
            .join(APP_IDENTIFIER)
    };
    let cache_dir = if is_windows {
        data_dir.join("cache")
    } else {
        bases
            .cache
            .as_ref()
            .map(|c| c.join(APP_IDENTIFIER))
            .unwrap_or_else(|| data_dir.join("cache"))
    };
    Ok(AppDirs {
        data_dir,
        config_dir,
        cache_dir,
        isolated: false,
    })
}

pub(crate) fn is_cargo_test_binary() -> bool {
    if cfg!(test) {
        return true;
    }
    let Ok(exe) = std::env::current_exe() else {
        return false;
    };
    let Some(stem) = exe.file_stem().and_then(|s| s.to_str()) else {
        return false;
    };
    let Some((_, hash)) = stem.rsplit_once('-') else {
        return false;
    };
    hash.len() == 16 && hash.bytes().all(|b| b.is_ascii_hexdigit())
}

fn resolve_raw() -> Result<(AppDirs, SystemBases), CoreError> {
    let env_dir = std::env::var_os("CLIPES_DATA_DIR");
    if env_dir.as_ref().is_some_and(|v| !v.is_empty()) {
        let bases = SystemBases::default();
        let dirs = resolve_with_env(env_dir.as_deref(), &bases, cfg!(windows))?;
        return Ok((dirs, bases));
    }
    #[cfg(test)]
    {
        let root = std::env::temp_dir().join(format!("clipes-core-test-{}", std::process::id()));
        let dirs = AppDirs {
            cache_dir: root.join("cache"),
            config_dir: root.clone(),
            data_dir: root,
            isolated: true,
        };
        Ok((dirs, SystemBases::default()))
    }
    #[cfg(not(test))]
    {
        if is_cargo_test_binary() {
            panic!("Testes devem definir CLIPES_DATA_DIR antes de resolver caminhos do app.");
        }
        let bases = SystemBases::current();
        let dirs = resolve_with_env(None, &bases, cfg!(windows))?;
        Ok((dirs, bases))
    }
}

/// Runs the one-time legacy data migration if `CLIPES_DATA_DIR` is not set.
pub fn ensure_migrated() -> Result<(), CoreError> {
    let (dirs, bases) = resolve_raw()?;
    if !dirs.isolated {
        if is_cargo_test_binary() {
            panic!("ensure_migrated não pode rodar em testes sem CLIPES_DATA_DIR.");
        }
        MIGRATED.get_or_init(|| {
            let legacy = LegacyDirs::from_bases(&bases);
            let _ = migrate_legacy_data(&dirs, &legacy);
        });
    }
    Ok(())
}

/// Returns the resolved app directories without running side-effect migration.
pub fn app_dirs() -> Result<AppDirs, CoreError> {
    let (dirs, _) = resolve_raw()?;
    Ok(dirs)
}

pub(crate) fn data_dir() -> Result<PathBuf, CoreError> {
    Ok(app_dirs()?.data_dir)
}

pub(crate) fn data_file(name: &str) -> Result<PathBuf, CoreError> {
    Ok(app_dirs()?.data_dir.join(name))
}

pub(crate) fn config_file(name: &str) -> Result<PathBuf, CoreError> {
    Ok(app_dirs()?.config_dir.join(name))
}

pub(crate) fn component_settings_file() -> Result<PathBuf, CoreError> {
    let dirs = app_dirs()?;
    if dirs.isolated {
        Ok(dirs.data_dir.join("component-settings.json"))
    } else {
        Ok(dirs.config_dir.join("settings.json"))
    }
}

fn is_cross_device(err: &io::Error) -> bool {
    if err.kind() == io::ErrorKind::CrossesDevices {
        return true;
    }
    matches!(err.raw_os_error(), Some(17) | Some(18))
}

fn move_file(src: &Path, dst: &Path) -> MigrationOutcome {
    if !src.is_file() {
        return MigrationOutcome::Absent;
    }
    if src == dst || dst.exists() {
        return MigrationOutcome::SkippedExisting;
    }
    let Some(parent) = dst.parent() else {
        return MigrationOutcome::Error;
    };
    if fs::create_dir_all(parent).is_err() {
        return MigrationOutcome::Error;
    }
    match fs::rename(src, dst) {
        Ok(()) => MigrationOutcome::Moved,
        Err(err) if is_cross_device(&err) => copy_then_remove_file(src, dst),
        Err(_) if dst.exists() => MigrationOutcome::SkippedExisting,
        Err(_) => MigrationOutcome::Error,
    }
}

fn copy_then_remove_file(src: &Path, dst: &Path) -> MigrationOutcome {
    let part = dst.with_extension(format!("migrating-{}.part", std::process::id()));
    let copy_ok = (|| -> io::Result<()> {
        let mut reader = fs::File::open(src)?;
        let mut writer = fs::File::create(&part)?;
        io::copy(&mut reader, &mut writer)?;
        writer.sync_all()?;
        Ok(())
    })();
    if copy_ok.is_err() {
        let _ = fs::remove_file(&part);
        return MigrationOutcome::Error;
    }
    if dst.exists() {
        let _ = fs::remove_file(&part);
        return MigrationOutcome::SkippedExisting;
    }
    if fs::rename(&part, dst).is_err() {
        let _ = fs::remove_file(&part);
        return if dst.exists() {
            MigrationOutcome::SkippedExisting
        } else {
            MigrationOutcome::Error
        };
    }
    let _ = fs::remove_file(src);
    MigrationOutcome::MovedCrossVolume
}

fn move_dir(src: &Path, dst: &Path) -> MigrationOutcome {
    if !src.is_dir() {
        return MigrationOutcome::Absent;
    }
    if src == dst {
        return MigrationOutcome::SkippedExisting;
    }
    if !dst.exists() {
        let Some(parent) = dst.parent() else {
            return MigrationOutcome::Error;
        };
        if fs::create_dir_all(parent).is_err() {
            return MigrationOutcome::Error;
        }
        match fs::rename(src, dst) {
            Ok(()) => return MigrationOutcome::Moved,
            Err(err) if is_cross_device(&err) => {}
            Err(_) if !dst.exists() => return MigrationOutcome::Error,
            Err(_) => {}
        }
    }
    if !dst.is_dir() {
        return MigrationOutcome::SkippedExisting;
    }
    merge_dir(src, dst)
}

fn merge_dir(src: &Path, dst: &Path) -> MigrationOutcome {
    if fs::create_dir_all(dst).is_err() {
        return MigrationOutcome::Error;
    }
    let Ok(entries) = fs::read_dir(src) else {
        return MigrationOutcome::Error;
    };
    let mut moved_any = false;
    let mut skipped_any = false;
    let mut had_error = false;
    for entry in entries {
        let Ok(entry) = entry else {
            had_error = true;
            continue;
        };
        let child_src = entry.path();
        let child_dst = dst.join(entry.file_name());
        let Ok(ftype) = entry.file_type() else {
            had_error = true;
            continue;
        };
        let outcome = if ftype.is_symlink() {
            move_symlink(&child_src, &child_dst)
        } else if ftype.is_dir() {
            move_dir(&child_src, &child_dst)
        } else if ftype.is_file() {
            move_file(&child_src, &child_dst)
        } else {
            MigrationOutcome::SkippedExisting
        };
        match outcome {
            MigrationOutcome::Moved
            | MigrationOutcome::MovedCrossVolume
            | MigrationOutcome::Merged => moved_any = true,
            MigrationOutcome::SkippedExisting => skipped_any = true,
            MigrationOutcome::Error => had_error = true,
            MigrationOutcome::Absent => {}
        }
    }
    if !had_error {
        let _ = fs::remove_dir(src);
    }
    if had_error {
        MigrationOutcome::Error
    } else if moved_any {
        MigrationOutcome::Merged
    } else if skipped_any {
        MigrationOutcome::SkippedExisting
    } else {
        MigrationOutcome::Absent
    }
}

fn move_symlink(src: &Path, dst: &Path) -> MigrationOutcome {
    if dst.symlink_metadata().is_ok() {
        return MigrationOutcome::SkippedExisting;
    }
    let Ok(target) = fs::read_link(src) else {
        return MigrationOutcome::Error;
    };
    #[cfg(unix)]
    let created = std::os::unix::fs::symlink(&target, dst);
    #[cfg(windows)]
    let created = if fs::metadata(src).is_ok_and(|m| m.is_dir()) {
        std::os::windows::fs::symlink_dir(&target, dst)
    } else {
        std::os::windows::fs::symlink_file(&target, dst)
    };
    if created.is_err() {
        return MigrationOutcome::Error;
    }
    let _ = fs::remove_file(src);
    MigrationOutcome::Moved
}

fn rewrite_migrated_settings(settings_file: &Path, legacy_data_dir: &Path, target: &AppDirs) {
    let Ok(bytes) = fs::read(settings_file) else {
        return;
    };
    let Ok(mut doc) = serde_json::from_slice::<serde_json::Value>(&bytes) else {
        return;
    };
    let Some(obj) = doc.as_object_mut() else {
        return;
    };
    let mut changed = false;
    if obj
        .get("data_dir")
        .and_then(|v| v.as_str())
        .is_some_and(|s| Path::new(s) == legacy_data_dir)
    {
        obj.insert(
            "data_dir".into(),
            serde_json::json!(target.data_dir.to_string_lossy()),
        );
        changed = true;
    }
    let old_cache = legacy_data_dir.join("cache");
    if obj
        .get("cache_dir")
        .and_then(|v| v.as_str())
        .is_some_and(|s| Path::new(s) == old_cache)
    {
        obj.insert(
            "cache_dir".into(),
            serde_json::json!(target.cache_dir.to_string_lossy()),
        );
        changed = true;
    }
    let old_components = legacy_data_dir.join("components");
    if let Some(ffmpeg) = obj.get("ffmpeg_path").and_then(|v| v.as_str()) {
        if let Ok(rel) = Path::new(ffmpeg).strip_prefix(&old_components) {
            let updated = target.data_dir.join("components").join(rel);
            obj.insert(
                "ffmpeg_path".into(),
                serde_json::json!(updated.to_string_lossy()),
            );
            changed = true;
        }
    }
    if changed {
        if let Ok(encoded) = serde_json::to_vec_pretty(&doc) {
            let part = settings_file.with_extension("json.part");
            if fs::write(&part, encoded).is_ok() {
                let _ = fs::rename(&part, settings_file);
            }
        }
    }
}

fn rewrite_migrated_pyvenv(new_worker: &Path, old_worker: &Path) {
    let cfg = new_worker.join("venv").join("pyvenv.cfg");
    if old_worker != new_worker {
        if let Ok(text) = fs::read_to_string(&cfg) {
            let mut changed = false;
            let mut out = String::with_capacity(text.len());
            for segment in text.split_inclusive('\n') {
                let (line, eol) = if let Some(stripped) = segment.strip_suffix("\r\n") {
                    (stripped, "\r\n")
                } else if let Some(stripped) = segment.strip_suffix('\n') {
                    (stripped, "\n")
                } else {
                    (segment, "")
                };
                if let Some(rest) = line.strip_prefix("home = ") {
                    if let Ok(rel) = Path::new(rest).strip_prefix(old_worker) {
                        out.push_str("home = ");
                        out.push_str(&new_worker.join(rel).to_string_lossy());
                        out.push_str(eol);
                        changed = true;
                        continue;
                    }
                }
                out.push_str(line);
                out.push_str(eol);
            }
            if changed {
                let _ = fs::write(&cfg, out);
            }
        }
    }
    #[cfg(unix)]
    {
        let bin_dir = new_worker.join("venv").join("bin");
        if let Ok(entries) = fs::read_dir(&bin_dir) {
            for entry in entries.flatten() {
                let path = entry.path();
                if let Ok(target) = fs::read_link(&path) {
                    if let Ok(rel) = target.strip_prefix(old_worker) {
                        let new_target = new_worker.join(rel);
                        if fs::remove_file(&path).is_ok() {
                            let _ = std::os::unix::fs::symlink(new_target, &path);
                        }
                    }
                }
            }
        }
    }
}

/// Moves only known legacy data/config entries into `target`, leaving binaries and unknown files
/// in place. Idempotent: existing destination files are never overwritten, and a marker file
/// without personal paths prevents redundant scans on subsequent launches.
pub fn migrate_legacy_data(target: &AppDirs, legacy: &LegacyDirs) -> MigrationReport {
    let mut entries = BTreeMap::new();
    if target.isolated {
        return MigrationReport {
            version: 1,
            already_migrated: false,
            skipped_isolated: true,
            marker_written: false,
            entries,
        };
    }

    let marker = target.data_dir.join(MIGRATION_MARKER);
    if marker.is_file() {
        return MigrationReport {
            version: 1,
            already_migrated: true,
            skipped_isolated: false,
            marker_written: true,
            entries,
        };
    }

    if let Some(old_data) = legacy
        .data_local
        .as_ref()
        .filter(|p| *p != &target.data_dir)
    {
        if old_data.is_dir() {
            for name in LEGACY_DATA_DIRS {
                let outcome = move_dir(&old_data.join(name), &target.data_dir.join(name));
                entries.insert(format!("data:{name}"), outcome);
                if *name == "worker"
                    && matches!(
                        outcome,
                        MigrationOutcome::Moved
                            | MigrationOutcome::MovedCrossVolume
                            | MigrationOutcome::Merged
                    )
                {
                    rewrite_migrated_pyvenv(
                        &target.data_dir.join("worker"),
                        &old_data.join("worker"),
                    );
                }
            }

            let cache_outcome = move_dir(&old_data.join("cache"), &target.cache_dir);
            entries.insert("data:cache".into(), cache_outcome);

            for name in LEGACY_DATA_FILES {
                let outcome = move_file(&old_data.join(name), &target.data_dir.join(name));
                entries.insert(format!("data:{name}"), outcome);
            }

            for name in LEGACY_DATA_TO_CONFIG_FILES {
                let outcome = move_file(&old_data.join(name), &target.config_dir.join(name));
                entries.insert(format!("data:{name}"), outcome);
            }
        }
    }

    let config_source = legacy.config_local.as_ref().or(legacy.data_local.as_ref());
    if let Some(old_cfg) = config_source.filter(|p| *p != &target.config_dir) {
        if old_cfg.is_dir() {
            for name in LEGACY_CONFIG_LOCAL_FILES {
                let dst = target.config_dir.join(name);
                let outcome = move_file(&old_cfg.join(name), &dst);
                entries.insert(format!("config:{name}"), outcome);
                if *name == "settings.json"
                    && matches!(
                        outcome,
                        MigrationOutcome::Moved | MigrationOutcome::MovedCrossVolume
                    )
                {
                    let old_data_ref = legacy.data_local.as_deref().unwrap_or(old_cfg.as_path());
                    rewrite_migrated_settings(&dst, old_data_ref, target);
                }
            }
        }
    }

    if let Some(old_proj) = legacy
        .project_config
        .as_ref()
        .filter(|p| *p != &target.config_dir)
    {
        if old_proj.is_dir() {
            for name in LEGACY_PROJECT_CONFIG_FILES {
                let outcome = move_file(&old_proj.join(name), &target.config_dir.join(name));
                entries.insert(format!("project:{name}"), outcome);
            }
        }
    }

    let mut report = MigrationReport {
        version: 1,
        already_migrated: false,
        skipped_isolated: false,
        marker_written: false,
        entries,
    };

    if !report.has_errors() && fs::create_dir_all(&target.data_dir).is_ok() {
        report.marker_written = true;
        if let Ok(encoded) = serde_json::to_vec_pretty(&report) {
            let part = marker.with_extension("json.part");
            if fs::write(&part, encoded).is_ok() && fs::rename(&part, &marker).is_ok() {
                return report;
            }
            let _ = fs::remove_file(&part);
            report.marker_written = false;
        } else {
            report.marker_written = false;
        }
    }

    report
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::ffi::OsString;

    #[test]
    fn resolves_distinct_platform_layouts_and_isolates_with_env() {
        let bases = SystemBases {
            data_local: Some(PathBuf::from("/home/u/.local/share")),
            config_local: Some(PathBuf::from("/home/u/.config")),
            cache: Some(PathBuf::from("/home/u/.cache")),
            project_config: Some(PathBuf::from("/home/u/.config/clipes")),
        };
        let linux = resolve_with_env(None, &bases, false).unwrap();
        assert!(!linux.isolated);
        assert_eq!(
            linux.data_dir,
            PathBuf::from("/home/u/.local/share/io.github.gustavohooo.clipes")
        );
        assert_eq!(
            linux.config_dir,
            PathBuf::from("/home/u/.config/io.github.gustavohooo.clipes")
        );
        assert_eq!(
            linux.cache_dir,
            PathBuf::from("/home/u/.cache/io.github.gustavohooo.clipes")
        );

        let win_bases = SystemBases {
            data_local: Some(PathBuf::from(r"C:\Users\Dev\AppData\Local")),
            config_local: Some(PathBuf::from(r"C:\Users\Dev\AppData\Local")),
            cache: Some(PathBuf::from(r"C:\Users\Dev\AppData\Local")),
            project_config: Some(PathBuf::from(
                r"C:\Users\Dev\AppData\Roaming\github.gustavohooo\clipes\config",
            )),
        };
        let win = resolve_with_env(None, &win_bases, true).unwrap();
        assert!(!win.isolated);
        assert_eq!(
            win.data_dir,
            PathBuf::from(r"C:\Users\Dev\AppData\Local").join(APP_IDENTIFIER)
        );
        assert_eq!(win.config_dir, win.data_dir);
        assert_eq!(win.cache_dir, win.data_dir.join("cache"));

        let env_val = OsString::from("/tmp/clipes-isolated");
        let isolated = resolve_with_env(Some(&env_val), &win_bases, true).unwrap();
        assert!(isolated.isolated);
        assert_eq!(isolated.data_dir, PathBuf::from("/tmp/clipes-isolated"));
        assert_eq!(isolated.config_dir, PathBuf::from("/tmp/clipes-isolated"));
        assert_eq!(
            isolated.cache_dir,
            PathBuf::from("/tmp/clipes-isolated/cache")
        );
    }

    #[test]
    fn migrates_only_known_entries_without_touching_binaries_and_is_idempotent() {
        let root = tempfile::tempdir().unwrap();
        let local = root.path().join("local");
        let roaming = root.path().join("roaming");
        let old_install = local.join("Clipes");
        let old_proj = roaming.join("github.gustavohooo/clipes/config");
        fs::create_dir_all(old_install.join("models/whisper-small")).unwrap();
        fs::create_dir_all(old_install.join("components")).unwrap();
        fs::create_dir_all(old_install.join("worker/venv")).unwrap();
        fs::create_dir_all(old_install.join("cache/proxies")).unwrap();
        fs::create_dir_all(&old_proj).unwrap();

        // Binaries and unrelated files in the old NSIS install dir MUST remain untouched.
        fs::write(old_install.join("clipes.exe"), b"bin").unwrap();
        fs::write(old_install.join("uninstall.exe"), b"uninst").unwrap();
        fs::write(old_install.join("custom-note.txt"), b"keep").unwrap();

        // Known data entries.
        fs::write(
            old_install.join("models/whisper-small/model.bin"),
            b"weights",
        )
        .unwrap();
        fs::write(old_install.join("components/yt-dlp.exe"), b"yt").unwrap();
        fs::write(
            old_install.join("worker/venv/pyvenv.cfg"),
            format!(
                "home = {}\ninclude-system-site-packages = false\n",
                old_install
                    .join("worker/python/cpython-3.12")
                    .to_string_lossy()
            ),
        )
        .unwrap();
        fs::write(old_install.join("cache/proxies/p.mp4"), b"proxy").unwrap();
        fs::write(old_install.join("projects.json"), b"[]").unwrap();
        fs::write(
            old_install.join("settings.json"),
            serde_json::to_vec(&serde_json::json!({
                "data_dir": old_install,
                "cache_dir": old_install.join("cache"),
                "cache_limit_bytes": 5_000_000_000u64,
                "ffmpeg_path": old_install.join("components/ffmpeg.exe"),
            }))
            .unwrap(),
        )
        .unwrap();
        fs::write(old_proj.join("provider.json"), b"{}").unwrap();
        fs::write(old_proj.join("assistant.json"), b"{}").unwrap();

        let bases = SystemBases {
            data_local: Some(local.clone()),
            config_local: Some(local.clone()),
            cache: Some(local.clone()),
            project_config: Some(old_proj.clone()),
        };
        let target = resolve_with_env(None, &bases, true).unwrap();
        let legacy = LegacyDirs::from_bases(&bases);

        let first = migrate_legacy_data(&target, &legacy);
        assert!(!first.already_migrated);
        assert!(first.marker_written);
        assert_eq!(
            first.entries.get("data:models"),
            Some(&MigrationOutcome::Moved)
        );
        assert_eq!(
            first.entries.get("project:provider.json"),
            Some(&MigrationOutcome::Moved)
        );

        // Binaries stayed in old_install.
        assert!(old_install.join("clipes.exe").is_file());
        assert!(old_install.join("uninstall.exe").is_file());
        assert!(old_install.join("custom-note.txt").is_file());

        // Data moved to target.
        assert!(target
            .data_dir
            .join("models/whisper-small/model.bin")
            .is_file());
        assert!(!old_install.join("models").exists());
        assert!(target.cache_dir.join("proxies/p.mp4").is_file());
        assert!(target.config_dir.join("provider.json").is_file());
        assert!(target.config_dir.join("assistant.json").is_file());

        // settings.json and pyvenv.cfg rewritten to new paths.
        let migrated_settings: serde_json::Value =
            serde_json::from_slice(&fs::read(target.config_dir.join("settings.json")).unwrap())
                .unwrap();
        assert_eq!(
            migrated_settings["data_dir"].as_str().unwrap(),
            target.data_dir.to_string_lossy()
        );
        assert_eq!(
            migrated_settings["cache_dir"].as_str().unwrap(),
            target.cache_dir.to_string_lossy()
        );
        assert_eq!(
            migrated_settings["ffmpeg_path"].as_str().unwrap(),
            target
                .data_dir
                .join("components")
                .join("ffmpeg.exe")
                .to_string_lossy()
        );
        let pyvenv = fs::read_to_string(target.data_dir.join("worker/venv/pyvenv.cfg")).unwrap();
        assert!(pyvenv.contains(
            &target
                .data_dir
                .join("worker")
                .join("python/cpython-3.12")
                .to_string_lossy()
                .into_owned()
        ));

        // Marker must not contain personal paths.
        let marker_text = fs::read_to_string(target.data_dir.join(MIGRATION_MARKER)).unwrap();
        assert!(!marker_text.contains(&root.path().to_string_lossy().into_owned()));

        // Second run is a no-op because of the marker.
        let second = migrate_legacy_data(&target, &legacy);
        assert!(second.already_migrated);
    }

    #[test]
    fn does_not_overwrite_existing_destination_files_even_without_marker() {
        let root = tempfile::tempdir().unwrap();
        let local = root.path().join("local");
        let old_install = local.join("Clipes");
        fs::create_dir_all(&old_install).unwrap();
        fs::write(old_install.join("projects.json"), b"old-projects").unwrap();

        let bases = SystemBases {
            data_local: Some(local.clone()),
            config_local: Some(local.clone()),
            cache: Some(local),
            project_config: None,
        };
        let target = resolve_with_env(None, &bases, true).unwrap();
        fs::create_dir_all(&target.data_dir).unwrap();
        fs::write(target.data_dir.join("projects.json"), b"new-projects").unwrap();

        let report = migrate_legacy_data(&target, &LegacyDirs::from_bases(&bases));
        assert_eq!(
            report.entries.get("data:projects.json"),
            Some(&MigrationOutcome::SkippedExisting)
        );
        assert_eq!(
            fs::read(target.data_dir.join("projects.json")).unwrap(),
            b"new-projects"
        );
        assert_eq!(
            fs::read(old_install.join("projects.json")).unwrap(),
            b"old-projects"
        );
    }
}
