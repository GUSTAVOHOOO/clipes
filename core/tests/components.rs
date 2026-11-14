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
