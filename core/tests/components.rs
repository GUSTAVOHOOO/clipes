use clipes_core::dispatch;
use serde_json::json;

#[test]
fn components_manifest_contains_pinned_licensed_downloads() {
    let result = dispatch("components.manifest", json!({}), &mut |_| {}).unwrap();
    let entries = result.as_array().unwrap();
    for id in ["ffmpeg", "yt-dlp"] {
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
fn yt_dlp_update_requires_confirmation() {
    let err = dispatch("components.ytdlp.update", json!({}), &mut |_| {}).unwrap_err();
    assert_eq!(err.code, "confirmation_required");
}
