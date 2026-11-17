//! Headless tests for central path resolution and legacy data migration (#231).
//! All tests run exclusively against temporary directories and `CLIPES_DATA_DIR`;
//! real user/app directories are never read or modified.
use clipes_core::{
    dispatch,
    paths::{
        migrate_legacy_data, resolve_with_env, LegacyDirs, MigrationOutcome, SystemBases,
        APP_IDENTIFIER,
    },
};
use serde_json::{json, Value};
use std::{
    ffi::OsString,
    fs,
    path::{Path, PathBuf},
    sync::Mutex,
};

static ENV_LOCK: Mutex<()> = Mutex::new(());

struct EnvGuard(Option<OsString>);

impl EnvGuard {
    fn set(dir: &Path) -> Self {
        let prev = std::env::var_os("CLIPES_DATA_DIR");
        std::env::set_var("CLIPES_DATA_DIR", dir);
        Self(prev)
    }

    fn clear() -> Self {
        let prev = std::env::var_os("CLIPES_DATA_DIR");
        std::env::remove_var("CLIPES_DATA_DIR");
        Self(prev)
    }
}

impl Drop for EnvGuard {
    fn drop(&mut self) {
        match self.0.take() {
            Some(v) => std::env::set_var("CLIPES_DATA_DIR", v),
            None => std::env::remove_var("CLIPES_DATA_DIR"),
        }
    }
}

#[test]
fn resolves_windows_linux_macos_and_isolated_paths() {
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
        PathBuf::from(format!(r"C:\Users\Dev\AppData\Local\{APP_IDENTIFIER}"))
    );
    assert_eq!(win.config_dir, win.data_dir);
    assert_eq!(win.cache_dir, win.data_dir.join("cache"));

    let linux_bases = SystemBases {
        data_local: Some(PathBuf::from("/home/dev/.local/share")),
        config_local: Some(PathBuf::from("/home/dev/.config")),
        cache: Some(PathBuf::from("/home/dev/.cache")),
        project_config: Some(PathBuf::from("/home/dev/.config/clipes")),
    };
    let linux = resolve_with_env(None, &linux_bases, false).unwrap();
    assert!(!linux.isolated);
    assert_eq!(
        linux.data_dir,
        PathBuf::from(format!("/home/dev/.local/share/{APP_IDENTIFIER}"))
    );
    assert_eq!(
        linux.config_dir,
        PathBuf::from(format!("/home/dev/.config/{APP_IDENTIFIER}"))
    );
    assert_eq!(
        linux.cache_dir,
        PathBuf::from(format!("/home/dev/.cache/{APP_IDENTIFIER}"))
    );

    let mac_bases = SystemBases {
        data_local: Some(PathBuf::from("/Users/dev/Library/Application Support")),
        config_local: Some(PathBuf::from("/Users/dev/Library/Application Support")),
        cache: Some(PathBuf::from("/Users/dev/Library/Caches")),
        project_config: Some(PathBuf::from(format!(
            "/Users/dev/Library/Application Support/{APP_IDENTIFIER}"
        ))),
    };
    let mac = resolve_with_env(None, &mac_bases, false).unwrap();
    assert_eq!(
        mac.data_dir,
        PathBuf::from(format!(
            "/Users/dev/Library/Application Support/{APP_IDENTIFIER}"
        ))
    );
    assert_eq!(mac.config_dir, mac.data_dir);
    assert_eq!(
        mac.cache_dir,
        PathBuf::from(format!("/Users/dev/Library/Caches/{APP_IDENTIFIER}"))
    );

    let override_dir = OsString::from("/tmp/clipes-override");
    let isolated = resolve_with_env(Some(&override_dir), &win_bases, true).unwrap();
    assert!(isolated.isolated);
    assert_eq!(isolated.data_dir, PathBuf::from("/tmp/clipes-override"));
    assert_eq!(isolated.config_dir, PathBuf::from("/tmp/clipes-override"));
    assert_eq!(
        isolated.cache_dir,
        PathBuf::from("/tmp/clipes-override/cache")
    );

    let empty = OsString::from("");
    let not_isolated = resolve_with_env(Some(&empty), &linux_bases, false).unwrap();
    assert!(!not_isolated.isolated);
    assert_eq!(not_isolated.data_dir, linux.data_dir);
}

#[test]
fn migrates_legacy_windows_install_keeping_binaries_and_dispatch_reads_migrated_data() {
    let _lock = ENV_LOCK.lock().unwrap_or_else(|e| e.into_inner());
    let tmp = tempfile::tempdir().unwrap();
    let local = tmp.path().join("Local");
    let roaming = tmp.path().join("Roaming");
    let old_install = local.join("Clipes");
    let old_proj = roaming.join("github.gustavohooo/clipes/config");

    fs::create_dir_all(old_install.join("components")).unwrap();
    fs::create_dir_all(old_install.join("models/whisper-small")).unwrap();
    fs::create_dir_all(old_install.join("worker/venv")).unwrap();
    fs::create_dir_all(old_install.join("cache/proxies")).unwrap();
    fs::create_dir_all(&old_proj).unwrap();

    // Old NSIS install binaries and unrelated files must stay untouched.
    fs::write(old_install.join("clipes.exe"), b"exe-bytes").unwrap();
    fs::write(old_install.join("uninstall.exe"), b"uninst-bytes").unwrap();
    fs::write(old_install.join("README-local.txt"), b"keep-me").unwrap();

    // Known legacy entries.
    fs::write(old_install.join("components/yt-dlp.exe"), b"yt").unwrap();
    fs::write(
        old_install.join("models/whisper-small/model.bin"),
        b"model-weights",
    )
    .unwrap();
    fs::write(
        old_install.join("worker/venv/pyvenv.cfg"),
        format!(
            "home = {}\nversion_info = 3.12\n",
            old_install
                .join("worker/python/cpython-3.12")
                .to_string_lossy()
        ),
    )
    .unwrap();
    fs::write(old_install.join("cache/proxies/a.mp4"), b"proxy").unwrap();
    let sample_project = tmp.path().join("MyCanal.clipes");
    fs::write(
        old_install.join("projects.json"),
        serde_json::to_vec(&json!([{"name":"MyCanal","path":sample_project}])).unwrap(),
    )
    .unwrap();
    fs::write(
        old_install.join("settings.json"),
        serde_json::to_vec(&json!({
            "data_dir": old_install,
            "cache_dir": old_install.join("cache"),
            "cache_limit_bytes": 4_200_000_000u64,
            "ffmpeg_path": old_install.join("components/ffmpeg.exe"),
        }))
        .unwrap(),
    )
    .unwrap();
    fs::write(
        old_install.join("url-import.json"),
        serde_json::to_vec(&json!({
            "terms_accepted": true,
            "download_dir": tmp.path().join("Downloads/Clipes"),
        }))
        .unwrap(),
    )
    .unwrap();
    fs::write(old_install.join("diagnostic.log"), b"component_failure\n").unwrap();
    fs::write(old_install.join("export-encoder.json"), b"{}").unwrap();
    fs::write(old_install.join("export-settings.json"), b"{}").unwrap();
    fs::write(old_install.join("transcription-hardware.json"), b"{}").unwrap();
    fs::write(old_install.join("transcription-consent.json"), b"{}").unwrap();

    // Group (2): ProjectDirs config files.
    fs::write(
        old_proj.join("provider.json"),
        serde_json::to_vec(&json!({
            "endpoint": "https://192.0.2.10/v1",
            "model": "m-legacy",
            "kind": "openai",
            "nativeSchema": false,
            "timeouts": {"local": 900},
            "providers": {"https://192.0.2.10/v1": {"confirmed": true, "keyLastFour": "1234"}}
        }))
        .unwrap(),
    )
    .unwrap();
    fs::write(
        old_proj.join("assistant.json"),
        serde_json::to_vec(&json!({
            "completed": true,
            "skipped": false,
            "default": "endpoint",
            "tasks": {}
        }))
        .unwrap(),
    )
    .unwrap();
    fs::write(
        old_proj.join("provider-cli.json"),
        br#"{"selected":"","codex_confirmed":false,"claude_confirmed":false}"#,
    )
    .unwrap();
    fs::write(old_proj.join("provider-prices.json"), b"{\"prices\":[]}").unwrap();
    fs::write(old_proj.join("token-calibration.json"), b"{}").unwrap();
    fs::write(old_proj.join("provider-context.json"), b"{}").unwrap();

    let bases = SystemBases {
        data_local: Some(local.clone()),
        config_local: Some(local.clone()),
        cache: Some(local),
        project_config: Some(old_proj.clone()),
    };
    let target = resolve_with_env(None, &bases, true).unwrap();
    let legacy = LegacyDirs::from_bases(&bases);

    let report = migrate_legacy_data(&target, &legacy);
    assert!(!report.already_migrated);
    assert!(report.marker_written);

    // Binaries and unrelated files remain in old_install.
    assert_eq!(
        fs::read(old_install.join("clipes.exe")).unwrap(),
        b"exe-bytes"
    );
    assert_eq!(
        fs::read(old_install.join("uninstall.exe")).unwrap(),
        b"uninst-bytes"
    );
    assert_eq!(
        fs::read(old_install.join("README-local.txt")).unwrap(),
        b"keep-me"
    );

    // All known data moved without leaving duplicates behind.
    assert!(!old_install.join("models").exists());
    assert!(!old_install.join("components").exists());
    assert!(!old_install.join("worker").exists());
    assert!(!old_install.join("cache").exists());
    assert!(!old_install.join("projects.json").exists());
    assert!(!old_proj.join("provider.json").exists());

    assert_eq!(
        fs::read(target.data_dir.join("models/whisper-small/model.bin")).unwrap(),
        b"model-weights"
    );
    assert_eq!(
        fs::read(target.cache_dir.join("proxies/a.mp4")).unwrap(),
        b"proxy"
    );
    assert!(target.config_dir.join("provider.json").is_file());
    assert!(target.config_dir.join("assistant.json").is_file());
    assert!(target.config_dir.join("token-calibration.json").is_file());
    assert!(target.config_dir.join("provider-context.json").is_file());

    // In Windows layout (config_dir == data_dir), migrated files can also be verified through
    // headless dispatch by pointing CLIPES_DATA_DIR at target.data_dir.
    let _guard = EnvGuard::set(&target.data_dir);
    let recent = dispatch("projects.recent", json!({}), &mut |_| {}).unwrap();
    assert_eq!(recent[0]["name"], "MyCanal");

    let url_settings = dispatch("sources.url.settings.get", json!({}), &mut |_| {}).unwrap();
    assert_eq!(url_settings["terms_accepted"], true);

    let assistant = dispatch("assistant.status", json!({}), &mut |_| {}).unwrap();
    assert_eq!(assistant["completed"], true);
    assert_eq!(assistant["default"], "endpoint");

    let profiles = dispatch("provider.profiles.list", json!({}), &mut |_| {}).unwrap();
    assert!(profiles["profiles"]
        .as_array()
        .unwrap()
        .iter()
        .any(|p| p["id"] == "legacy" && p["model"] == "m-legacy"));

    let diag = dispatch("diagnostic.get", json!({}), &mut |_| {}).unwrap();
    let diag_text = diag["text"].as_str().unwrap();
    assert!(diag_text.contains("Erro: falha em componente"));
    assert!(!diag_text.contains(&tmp.path().to_string_lossy().into_owned()));

    // Check settings.json (non-isolated reads settings.json, isolated reads component-settings.json;
    // verify settings.json directly).
    let settings: Value =
        serde_json::from_slice(&fs::read(target.config_dir.join("settings.json")).unwrap())
            .unwrap();
    assert_eq!(
        settings["data_dir"].as_str().unwrap(),
        target.data_dir.to_string_lossy()
    );
    assert_eq!(
        settings["cache_dir"].as_str().unwrap(),
        target.cache_dir.to_string_lossy()
    );
    assert_eq!(settings["cache_limit_bytes"], 4_200_000_000u64);
    assert_eq!(
        settings["ffmpeg_path"].as_str().unwrap(),
        target
            .data_dir
            .join("components")
            .join("ffmpeg.exe")
            .to_string_lossy()
    );

    // Marker contains no personal paths.
    let marker = fs::read_to_string(target.data_dir.join(".migrated-v1.json")).unwrap();
    assert!(!marker.contains(&tmp.path().to_string_lossy().into_owned()));

    // Second run is a no-op.
    let second = migrate_legacy_data(&target, &legacy);
    assert!(second.already_migrated);
}

#[test]
fn preserves_custom_data_dir_and_merges_partial_directories_idempotently() {
    let tmp = tempfile::tempdir().unwrap();
    let local = tmp.path().join("local");
    let config = tmp.path().join("config");
    let cache = tmp.path().join("cache");
    let old_data = local.join("Clipes");
    let old_cfg = config.join("Clipes");
    let custom_data = tmp.path().join("CustomDisk/ClipesData");

    fs::create_dir_all(old_data.join("models/whisper-small")).unwrap();
    fs::create_dir_all(&old_cfg).unwrap();
    fs::write(
        old_data.join("models/whisper-small/model.bin"),
        b"old-small",
    )
    .unwrap();

    // User had a custom data_dir in settings.json: migration must NOT overwrite it.
    fs::write(
        old_cfg.join("settings.json"),
        serde_json::to_vec(&json!({
            "data_dir": custom_data,
            "cache_dir": custom_data.join("cache"),
            "cache_limit_bytes": 1_000_000_000u64,
            "ffmpeg_path": "ffmpeg",
        }))
        .unwrap(),
    )
    .unwrap();

    let bases = SystemBases {
        data_local: Some(local),
        config_local: Some(config),
        cache: Some(cache),
        project_config: None,
    };
    let target = resolve_with_env(None, &bases, false).unwrap();

    // Destination already has whisper-turbo and a pre-existing whisper-small/extra.txt.
    fs::create_dir_all(target.data_dir.join("models/whisper-turbo")).unwrap();
    fs::write(
        target.data_dir.join("models/whisper-turbo/model.bin"),
        b"new-turbo",
    )
    .unwrap();

    let report = migrate_legacy_data(&target, &LegacyDirs::from_bases(&bases));
    assert_eq!(
        report.entries.get("data:models"),
        Some(&MigrationOutcome::Merged)
    );
    assert!(target
        .data_dir
        .join("models/whisper-turbo/model.bin")
        .is_file());
    assert!(target
        .data_dir
        .join("models/whisper-small/model.bin")
        .is_file());

    let migrated_settings: Value =
        serde_json::from_slice(&fs::read(target.config_dir.join("settings.json")).unwrap())
            .unwrap();
    assert_eq!(
        migrated_settings["data_dir"].as_str().unwrap(),
        custom_data.to_string_lossy()
    );
    assert_eq!(migrated_settings["ffmpeg_path"], "ffmpeg");
}

#[test]
fn macos_same_config_dir_is_a_safe_noop_for_project_config() {
    let tmp = tempfile::tempdir().unwrap();
    let app_support = tmp.path().join("Application Support");
    let caches = tmp.path().join("Caches");
    let target_cfg = app_support.join(APP_IDENTIFIER);
    fs::create_dir_all(&target_cfg).unwrap();
    fs::write(target_cfg.join("provider.json"), b"keep-provider").unwrap();

    let bases = SystemBases {
        data_local: Some(app_support.clone()),
        config_local: Some(app_support.clone()),
        cache: Some(caches),
        project_config: Some(target_cfg.clone()),
    };
    let target = resolve_with_env(None, &bases, false).unwrap();
    let report = migrate_legacy_data(&target, &LegacyDirs::from_bases(&bases));
    assert!(report.marker_written);
    assert_eq!(
        fs::read(target.config_dir.join("provider.json")).unwrap(),
        b"keep-provider"
    );
}

#[test]
fn rewrites_only_legacy_settings_paths_and_rerun_without_marker_is_idempotent() {
    let tmp = tempfile::tempdir().unwrap();
    let local = tmp.path().join("local");
    let old_data = local.join("Clipes");
    let custom_cache = tmp.path().join("FastSSD/ClipesCache");
    fs::create_dir_all(&old_data).unwrap();

    // data_dir matches old default, while cache_dir and ffmpeg_path are user-chosen outside it.
    fs::write(
        old_data.join("settings.json"),
        serde_json::to_vec(&json!({
            "data_dir": old_data,
            "cache_dir": custom_cache,
            "cache_limit_bytes": 2_000_000_000u64,
            "ffmpeg_path": "/usr/local/bin/ffmpeg",
        }))
        .unwrap(),
    )
    .unwrap();

    let bases = SystemBases {
        data_local: Some(local.clone()),
        config_local: Some(local.clone()),
        cache: Some(local),
        project_config: None,
    };
    let target = resolve_with_env(None, &bases, true).unwrap();
    let legacy = LegacyDirs::from_bases(&bases);

    let first = migrate_legacy_data(&target, &legacy);
    assert_eq!(
        first.entries.get("config:settings.json"),
        Some(&MigrationOutcome::Moved)
    );

    let after_first: Value =
        serde_json::from_slice(&fs::read(target.config_dir.join("settings.json")).unwrap())
            .unwrap();
    assert_eq!(
        after_first["data_dir"].as_str().unwrap(),
        target.data_dir.to_string_lossy()
    );
    assert_eq!(
        after_first["cache_dir"].as_str().unwrap(),
        custom_cache.to_string_lossy()
    );
    assert_eq!(after_first["ffmpeg_path"], "/usr/local/bin/ffmpeg");

    // Simulate a re-run with marker removed and a stale legacy settings.json present:
    // destination must NOT be overwritten or double-rewritten.
    fs::remove_file(target.data_dir.join(".migrated-v1.json")).unwrap();
    fs::write(
        old_data.join("settings.json"),
        serde_json::to_vec(&json!({
            "data_dir": old_data,
            "cache_dir": old_data.join("cache"),
            "cache_limit_bytes": 123u64,
            "ffmpeg_path": null,
        }))
        .unwrap(),
    )
    .unwrap();

    let second = migrate_legacy_data(&target, &legacy);
    assert_eq!(
        second.entries.get("config:settings.json"),
        Some(&MigrationOutcome::SkippedExisting)
    );
    let after_second: Value =
        serde_json::from_slice(&fs::read(target.config_dir.join("settings.json")).unwrap())
            .unwrap();
    assert_eq!(after_second, after_first);
}

#[test]
#[should_panic(expected = "CLIPES_DATA_DIR")]
fn integration_test_without_clipes_data_dir_panics_instead_of_touching_real_dirs() {
    let _lock = ENV_LOCK.lock().unwrap_or_else(|e| e.into_inner());
    let _guard = EnvGuard::clear();
    let _ = clipes_core::paths::app_dirs();
}
