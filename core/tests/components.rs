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

#[test]
fn deno_download_requires_confirmation_and_status_reports_missing_component() {
    let err = dispatch(
        "components.download",
        json!({"id":"deno", "confirmed":false}),
        &mut |_| {},
    )
    .unwrap_err();
    assert_eq!(err.code, "confirmation_required");
    let status = dispatch("components.deno.status", json!({}), &mut |_| {}).unwrap();
    assert!(status["pinned"].is_string());
    assert!(status["installed"].is_boolean());
}

#[test]
fn yt_dlp_update_requires_confirmation() {
    let err = dispatch("components.ytdlp.update", json!({}), &mut |_| {}).unwrap_err();
    assert_eq!(err.code, "confirmation_required");
}

#[test]
fn transcription_models_are_pinned_licensed_and_need_consent_and_the_worker() {
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
