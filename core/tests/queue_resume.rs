use clipes_core::dispatch;
use serde_json::json;
use std::{
    fs,
    path::PathBuf,
    process::Command,
    time::{Duration, Instant, SystemTime, UNIX_EPOCH},
};

#[test]
fn closing_and_reopening_resumes_inflight_preview() {
    let root = std::env::temp_dir().join(format!(
        "clipes-resume-{}-{}",
        std::process::id(),
        SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap()
            .as_nanos()
    ));
    fs::create_dir_all(&root).unwrap();
    let fake = root.join(if cfg!(windows) { "fake.exe" } else { "fake" });
    let compiler = std::env::var_os("RUSTC")
        .map(PathBuf::from)
        .unwrap_or_else(|| {
            PathBuf::from(
                std::env::var_os(if cfg!(windows) { "USERPROFILE" } else { "HOME" }).unwrap(),
            )
            .join(".cargo/bin")
            .join(if cfg!(windows) { "rustc.exe" } else { "rustc" })
        });
    assert!(Command::new(compiler)
        .arg(PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("tests/fixtures/fake_ffmpeg.rs"))
        .arg("-o")
        .arg(&fake)
        .status()
        .unwrap()
        .success());
    std::env::set_var("CLIPES_FAKE_FFMPEG_STATE", &root);
    std::env::set_var("CLIPES_FFPROBE", &fake);
    std::env::set_var("CLIPES_DATA_DIR", root.join("data"));
    let run = |name, args| dispatch(name, args, &mut |_| {});
    run("components.settings.set",json!({"data_dir":root.join("data"),"cache_dir":root.join("cache"),"cache_limit_bytes":1000000,"ffmpeg_path":fake})).unwrap();
    let project = run("projects.create", json!({"parent":root,"name":"Canal"})).unwrap();
    let path = project["path"].as_str().unwrap();
    let media = root.join("source.mp4");
    fs::write(&media, b"media").unwrap();
    run(
        "sources.import",
        json!({"project":path,"path":media,"permission":{"status":"none"},"audio_track":0}),
    )
    .unwrap();
    let deadline = Instant::now() + Duration::from_secs(30);
    while !root.join("running").exists() {
        assert!(Instant::now() < deadline);
        std::thread::sleep(Duration::from_millis(20));
    }
    run("projects.close", json!({})).unwrap();
    fs::write(root.join("continue"), b"go").unwrap();
    run("projects.open", json!({"path":path})).unwrap();
    loop {
        let jobs = run("jobs.list", json!({})).unwrap();
        let job = &jobs[0];
        assert_ne!(job["state"], "failed");
        if job["state"] == "completed" {
            assert_eq!(job["attempts"], 2);
            break;
        }
        assert!(Instant::now() < deadline);
        std::thread::sleep(Duration::from_millis(20));
    }
    fs::remove_file(root.join("running")).unwrap();
    fs::remove_file(root.join("continue")).unwrap();
    let second = root.join("second.mp4");
    fs::write(&second, b"different media").unwrap();
    run(
        "sources.import",
        json!({"project":path,"path":second,"permission":{"status":"none"},"audio_track":0}),
    )
    .unwrap();
    while !root.join("running").exists() {
        assert!(Instant::now() < deadline);
        std::thread::sleep(Duration::from_millis(20));
    }
    let job = run("jobs.list", json!({})).unwrap()[1]["id"].clone();
    run("jobs.cancel", json!({"id":job})).unwrap();
    loop {
        let jobs = run("jobs.list", json!({})).unwrap();
        if jobs[1]["state"] == "cancelled" {
            break;
        }
        assert!(Instant::now() < deadline);
        std::thread::sleep(Duration::from_millis(20));
    }
    run("projects.close", json!({})).unwrap();
    fs::remove_dir_all(root).unwrap();
}
