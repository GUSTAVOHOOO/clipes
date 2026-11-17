use clipes_core::dispatch;
use serde_json::json;

#[test]
fn components_manifest_contains_pinned_licensed_downloads() {
    let result = dispatch("components.manifest", json!({}), &mut |_| {}).unwrap();
    let entries = result.as_array().unwrap();
    for id in ["ffmpeg", "yt-dlp", "deno"] {
        let item = entries.iter().find(|entry| entry["id"] == id).unwrap();
        assert!(item["url"].as_str().unwrap().starts_with("https://"));
        assert_eq!(item["sha256"].as_str().unwrap().len(), 64);
        assert!(item["size"].as_u64().unwrap() > 0);
        assert!(!item["license"].as_str().unwrap().is_empty());
    }
}

// GPL is allowed only for the separately downloaded FFmpeg executable (ADR-0003).
#[test]
fn every_component_has_an_allowed_license() {
    let result = dispatch("components.manifest", json!({}), &mut |_| {}).unwrap();
    let entries = result.as_array().unwrap();
    assert!(!entries.is_empty());
    for entry in entries {
        let id = entry["id"].as_str().expect("component id");
        let license = entry["license"].as_str().expect("component license");
        let allowed = matches!(
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
        );
        assert!(
            allowed || (id == "ffmpeg" && license == "GPL-3.0-or-later"),
            "{id}: disallowed license {license}"
        );
    }
}

#[test]
fn download_requires_confirmation() {
    let err = dispatch(
        "components.download",
        json!({"id":"ffmpeg", "confirmed":false}),
        &mut |_| {},
    )
    .unwrap_err();
    assert_eq!(err.code, "confirmation_required");
}

static ENV_LOCK: std::sync::Mutex<()> = std::sync::Mutex::new(());

struct EnvGuard {
    _lock: std::sync::MutexGuard<'static, ()>,
    prev: Option<std::ffi::OsString>,
}

impl EnvGuard {
    fn set(dir: &std::path::Path) -> Self {
        let lock = ENV_LOCK.lock().unwrap_or_else(|e| e.into_inner());
        let prev = std::env::var_os("CLIPES_DATA_DIR");
        std::env::set_var("CLIPES_DATA_DIR", dir);
        Self { _lock: lock, prev }
    }
}

impl Drop for EnvGuard {
    fn drop(&mut self) {
        match self.prev.take() {
            Some(v) => std::env::set_var("CLIPES_DATA_DIR", v),
            None => std::env::remove_var("CLIPES_DATA_DIR"),
        }
    }
}

#[test]
fn deno_download_requires_confirmation_and_status_reports_missing_component() {
    let tmp = tempfile::tempdir().unwrap();
    let _guard = EnvGuard::set(tmp.path());
    let err = dispatch(
        "components.download",
        json!({"id":"deno", "confirmed":false}),
        &mut |_| {},
    )
    .unwrap_err();
    assert_eq!(err.code, "confirmation_required");
    let status = dispatch("components.deno.status", json!({}), &mut |_| {}).unwrap();
    assert!(status["pinned"].is_string());
    assert_eq!(status["installed"], false);
}

#[test]
fn yt_dlp_update_requires_confirmation() {
    let err = dispatch("components.ytdlp.update", json!({}), &mut |_| {}).unwrap_err();
    assert_eq!(err.code, "confirmation_required");
}

#[test]
fn transcription_models_are_pinned_licensed_and_need_consent_and_the_worker() {
    let tmp = tempfile::tempdir().unwrap();
    let _guard = EnvGuard::set(tmp.path());
    let models = dispatch("components.models.manifest", json!({}), &mut |_| {}).unwrap();
    let models = models.as_array().unwrap();
    assert_eq!(models.len(), 3);
    for model in models {
        let id = model["id"].as_str().unwrap();
        assert_eq!(model["license"], "MIT", "{id}");
        assert_eq!(model["revision"].as_str().unwrap().len(), 40, "{id}");
        assert!(model["source_url"]
            .as_str()
            .unwrap()
            .starts_with(if id == "yunet" {
                "https://github.com/opencv/opencv_zoo/"
            } else {
                "https://huggingface.co/"
            }));
        assert!(model["source_url"]
            .as_str()
            .unwrap()
            .contains(model["revision"].as_str().unwrap()));
        let files = model["files"].as_array().unwrap();
        assert_eq!(
            model["size"].as_u64().unwrap(),
            files
                .iter()
                .map(|f| f["size"].as_u64().unwrap())
                .sum::<u64>()
        );
        for file in files {
            assert_eq!(file["sha256"].as_str().unwrap().len(), 64, "{id}");
        }
    }
    assert_eq!(
        models.iter().filter(|m| m["recommended"] == true).count(),
        1
    );
    let error = dispatch(
        "components.models.download",
        json!({"id":"whisper-small"}),
        &mut |_| {},
    )
    .unwrap_err();
    assert_eq!(error.code, "confirmation_required");
    let error = dispatch(
        "components.models.download",
        json!({"id":"inexistente","confirmed":true}),
        &mut |_| {},
    )
    .unwrap_err();
    assert_eq!(error.code, "unknown_component");
}

#[test]
fn ffmpeg_status_reports_missing_until_configured() {
    let tmp = tempfile::tempdir().unwrap();
    let _guard = EnvGuard::set(tmp.path());
    let initial = dispatch("components.ffmpeg.status", json!({}), &mut |_| {}).unwrap();
    assert_eq!(initial["installed"], false);
    assert_eq!(initial["incomplete"], false);

    let exe_dir = tmp.path().join("components");
    std::fs::create_dir_all(&exe_dir).unwrap();
    let ffmpeg = exe_dir.join(if cfg!(windows) {
        "ffmpeg.exe"
    } else {
        "ffmpeg"
    });
    let ffprobe = exe_dir.join(if cfg!(windows) {
        "ffprobe.exe"
    } else {
        "ffprobe"
    });
    std::fs::write(&ffmpeg, b"ffmpeg").unwrap();
    let settings = dispatch("components.settings.get", json!({}), &mut |_| {}).unwrap();
    let mut updated = settings.clone();
    updated["ffmpeg_path"] = json!(ffmpeg);
    dispatch("components.settings.set", updated, &mut |_| {}).unwrap();

    let incomplete = dispatch("components.ffmpeg.status", json!({}), &mut |_| {}).unwrap();
    assert_eq!(incomplete["incomplete"], true);
    assert_eq!(incomplete["installed"], false);

    std::fs::write(&ffprobe, b"ffprobe").unwrap();
    let ready = dispatch("components.ffmpeg.status", json!({}), &mut |_| {}).unwrap();
    assert_eq!(ready["incomplete"], false);
    assert_eq!(ready["installed"], true);
}

#[test]
fn changing_data_dir_revalidates_managed_ffmpeg_and_preserves_system_ffmpeg() {
    let tmp = tempfile::tempdir().unwrap();
    let _guard = EnvGuard::set(tmp.path());

    let ffmpeg_bin = if cfg!(windows) {
        "ffmpeg.exe"
    } else {
        "ffmpeg"
    };
    let ffprobe_bin = if cfg!(windows) {
        "ffprobe.exe"
    } else {
        "ffprobe"
    };

    let dir_a = tmp.path().join("dir-a");
    let dir_b = tmp.path().join("dir-b");
    let dir_c = tmp.path().join("dir-c");
    std::fs::create_dir_all(dir_a.join("components")).unwrap();
    std::fs::create_dir_all(&dir_b).unwrap();
    std::fs::create_dir_all(dir_c.join("components")).unwrap();

    let ffmpeg_a = dir_a.join("components").join(ffmpeg_bin);
    std::fs::write(&ffmpeg_a, b"ffmpeg-a").unwrap();
    std::fs::write(dir_a.join("components").join(ffprobe_bin), b"ffprobe-a").unwrap();

    let mut settings = dispatch("components.settings.get", json!({}), &mut |_| {}).unwrap();
    settings["data_dir"] = json!(dir_a);
    settings["ffmpeg_path"] = json!(ffmpeg_a);
    dispatch("components.settings.set", settings.clone(), &mut |_| {}).unwrap();
    let status_a = dispatch("components.ffmpeg.status", json!({}), &mut |_| {}).unwrap();
    assert_eq!(status_a["installed"], true);
    assert_eq!(status_a["incomplete"], false);

    // Ao mudar para uma data_dir vazia, a UI ainda envia o ffmpeg_path antigo gerenciado;
    // o núcleo precisa limpar em vez de tratá-lo como FFmpeg do sistema.
    let mut to_empty = dispatch("components.settings.get", json!({}), &mut |_| {}).unwrap();
    to_empty["data_dir"] = json!(dir_b);
    let updated_empty = dispatch("components.settings.set", to_empty, &mut |_| {}).unwrap();
    assert!(
        updated_empty["ffmpeg_path"].is_null(),
        "ffmpeg_path gerenciado na data_dir antiga deve ser limpo: {updated_empty}"
    );
    let persisted = dispatch("components.settings.get", json!({}), &mut |_| {}).unwrap();
    assert!(persisted["ffmpeg_path"].is_null());
    let status_b = dispatch("components.ffmpeg.status", json!({}), &mut |_| {}).unwrap();
    assert_eq!(status_b["installed"], false);
    assert_eq!(status_b["incomplete"], false);

    // Ao mudar para uma data_dir que já tem FFmpeg gerenciado, o caminho é atualizado para ela.
    let ffmpeg_c = dir_c.join("components").join(ffmpeg_bin);
    std::fs::write(&ffmpeg_c, b"ffmpeg-c").unwrap();
    std::fs::write(dir_c.join("components").join(ffprobe_bin), b"ffprobe-c").unwrap();
    let mut back_to_a = dispatch("components.settings.get", json!({}), &mut |_| {}).unwrap();
    back_to_a["data_dir"] = json!(dir_a);
    back_to_a["ffmpeg_path"] = json!(ffmpeg_a);
    dispatch("components.settings.set", back_to_a, &mut |_| {}).unwrap();

    let mut to_c = dispatch("components.settings.get", json!({}), &mut |_| {}).unwrap();
    to_c["data_dir"] = json!(dir_c);
    let updated_c = dispatch("components.settings.set", to_c, &mut |_| {}).unwrap();
    assert_eq!(
        std::path::PathBuf::from(updated_c["ffmpeg_path"].as_str().unwrap()),
        ffmpeg_c
    );
    let status_c = dispatch("components.ffmpeg.status", json!({}), &mut |_| {}).unwrap();
    assert_eq!(status_c["installed"], true);
    assert_eq!(status_c["incomplete"], false);

    // FFmpeg externo do sistema continua preservado quando data_dir muda.
    let external_ffmpeg = tmp.path().join("system-bin").join(ffmpeg_bin);
    std::fs::create_dir_all(external_ffmpeg.parent().unwrap()).unwrap();
    std::fs::write(&external_ffmpeg, b"sys-ffmpeg").unwrap();
    let mut with_system = dispatch("components.settings.get", json!({}), &mut |_| {}).unwrap();
    with_system["ffmpeg_path"] = json!(external_ffmpeg);
    dispatch("components.settings.set", with_system, &mut |_| {}).unwrap();

    let mut system_to_b = dispatch("components.settings.get", json!({}), &mut |_| {}).unwrap();
    system_to_b["data_dir"] = json!(dir_b);
    let updated_sys = dispatch("components.settings.set", system_to_b, &mut |_| {}).unwrap();
    assert_eq!(
        std::path::PathBuf::from(updated_sys["ffmpeg_path"].as_str().unwrap()),
        external_ffmpeg
    );
}
