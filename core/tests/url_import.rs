use clipes_core::dispatch;
use serde_json::json;
use std::{
    fs,
    time::{SystemTime, UNIX_EPOCH},
};

#[test]
fn url_settings_persist_terms_and_download_directory_per_installation() {
    let root = std::env::temp_dir().join(format!(
        "clipes-url-settings-{}-{}",
        std::process::id(),
        SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap()
            .as_nanos()
    ));
    std::env::set_var("CLIPES_DATA_DIR", &root);
    let run = |name, args| dispatch(name, args, &mut |_| {});
    let initial = run("sources.url.settings.get", json!({})).unwrap();
    assert_eq!(initial["terms_accepted"], false);
    let destination = root.join("downloads");
    run(
        "sources.url.settings.set",
        json!({"terms_accepted":true,"download_dir":destination}),
    )
    .unwrap();
    let saved = run("sources.url.settings.get", json!({})).unwrap();
    assert_eq!(saved["terms_accepted"], true);
    assert_eq!(saved["download_dir"], destination.to_str().unwrap());
    run(
        "sources.url.settings.set",
        json!({"terms_accepted":false,"download_dir":destination}),
    )
    .unwrap();
    assert_eq!(
        run("sources.url.settings.get", json!({})).unwrap()["terms_accepted"],
        true
    );
    let component_dir = root.join("components");
    fs::create_dir_all(&component_dir).unwrap();
    let fake = component_dir.join(if cfg!(windows) {
        "yt-dlp.exe"
    } else {
        "yt-dlp"
    });
    let rustc = std::path::PathBuf::from(env!("CARGO")).with_file_name(if cfg!(windows) {
        "rustc.exe"
    } else {
        "rustc"
    });
    assert!(std::process::Command::new(rustc)
        .arg(std::path::Path::new(env!("CARGO_MANIFEST_DIR")).join("tests/fixtures/fake_ytdlp.rs"))
        .arg("-o")
        .arg(&fake)
        .status()
        .unwrap()
        .success());
    let project = run("projects.create", json!({"parent":root,"name":"Teste"})).unwrap();
    let project = project["path"].as_str().unwrap();
    let mut progress = Vec::new();
    let downloaded = dispatch(
        "sources.url.download",
        json!({"project":project,"url":"https://example.com/success","job":"first"}),
        &mut |e| progress.push(e.percentage),
    )
    .unwrap();
    assert!(std::path::Path::new(downloaded["path"].as_str().unwrap()).exists());
    assert!(progress.contains(&42));
    let err = dispatch(
        "sources.url.download",
        json!({"project":project,"url":"https://example.com/hang","job":"cancel-me"}),
        &mut |_| {
            dispatch(
                "sources.url.cancel",
                json!({"job":"cancel-me"}),
                &mut |_| {},
            )
            .unwrap();
        },
    )
    .unwrap_err();
    assert_eq!(err.code, "cancelled");
    assert_eq!(fs::read_dir(&destination).unwrap().count(), 1);
    run("projects.close", json!({})).unwrap();
    fs::remove_dir_all(root).unwrap();
}
#[test]
fn download_rejects_non_http_urls_before_starting_process() {
    for url in ["file:///private", "--version", "httpsx://example.com"] {
        let err = dispatch("sources.url.download", json!({"url":url}), &mut |_| {}).unwrap_err();
        assert_eq!(err.code, "invalid_url");
    }
}
