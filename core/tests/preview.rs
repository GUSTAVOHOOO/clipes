use clipes_core::dispatch;
use serde_json::json;
use std::{
    fs,
    process::Command,
    time::{Duration, Instant, SystemTime, UNIX_EPOCH},
};

#[test]
fn source_import_generates_cached_previews() {
    if Command::new("ffmpeg").arg("-version").output().is_err()
        || Command::new("ffprobe").arg("-version").output().is_err()
    {
        return;
    }
    let root = std::env::temp_dir().join(format!(
        "clipes-preview-{}-{}",
        std::process::id(),
        SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap()
            .as_nanos()
    ));
    fs::create_dir_all(&root).unwrap();
    std::env::set_var("CLIPES_DATA_DIR", root.join("data"));
    std::env::set_var("CLIPES_FFPROBE", "ffprobe");
    let media = root.join("source.mkv");
    assert!(Command::new("ffmpeg")
        .args([
            "-v",
            "error",
            "-f",
            "lavfi",
            "-i",
            "color=s=160x90:d=2",
            "-f",
            "lavfi",
            "-i",
            "sine=duration=2",
            "-c:v",
            "mpeg4",
            "-c:a",
            "pcm_s16le",
            "-y"
        ])
        .arg(&media)
        .status()
        .unwrap()
        .success());
    let run = |name, args| dispatch(name, args, &mut |_| {});
    run("components.settings.set", json!({"data_dir":root.join("data"),"cache_dir":root.join("cache"),"cache_limit_bytes":10000000,"ffmpeg_path":"ffmpeg"})).unwrap();
    let project = run("projects.create", json!({"parent":root,"name":"Canal"})).unwrap();
    let path = project["path"].as_str().unwrap();
    let source = run(
        "sources.import",
        json!({"project":path,"path":media,"permission":{"status":"none"},"audio_track":1}),
    )
    .unwrap();
    let start = Instant::now();
    loop {
        let jobs = run("jobs.list", json!({})).unwrap();
        assert!(
            jobs.as_array()
                .unwrap()
                .iter()
                .any(|job| job["kind"] == "preview"),
            "missing preview job"
        );
        let job = jobs
            .as_array()
            .unwrap()
            .iter()
            .find(|job| job["kind"] == "preview")
            .unwrap();
        assert_ne!(job["state"], "failed");
        if job["state"] == "completed" {
            break;
        }
        assert!(start.elapsed() < Duration::from_secs(30));
        std::thread::sleep(Duration::from_millis(50));
    }
    let previews = run("jobs.preview", json!({"source_id":source["id"]})).unwrap();
    assert!(std::path::Path::new(previews["waveform"].as_str().unwrap()).is_file());
    assert!(!previews["thumbnails"].as_array().unwrap().is_empty());
    let waveform = fs::read(previews["waveform"].as_str().unwrap()).unwrap();
    assert_eq!(&waveform[..8], b"CLPWAVE\0");
    assert_eq!(
        u32::from_le_bytes(waveform[12..16].try_into().unwrap()),
        100
    );
    assert_eq!(u32::from_le_bytes(waveform[16..20].try_into().unwrap()), 1);
    assert!(u32::from_le_bytes(waveform[20..24].try_into().unwrap()) > 1);
    let old = root.join("cache/previews/old");
    let newer = root.join("cache/previews/newer");
    fs::create_dir_all(&old).unwrap();
    fs::create_dir_all(&newer).unwrap();
    fs::write(old.join("data"), vec![0u8; 4096]).unwrap();
    fs::write(newer.join("data"), vec![0u8; 4096]).unwrap();
    for (dir, seconds) in [(&old, 1_000_000_000), (&newer, 1_100_000_000)] {
        fs::OpenOptions::new()
            .write(true)
            .open(dir.join("data"))
            .unwrap()
            .set_times(fs::FileTimes::new().set_modified(UNIX_EPOCH + Duration::from_secs(seconds)))
            .unwrap();
    }
    let first_size: u64 = fs::read_dir(
        std::path::Path::new(previews["waveform"].as_str().unwrap())
            .parent()
            .unwrap(),
    )
    .unwrap()
    .map(|e| e.unwrap().metadata().unwrap().len())
    .sum();

    let fake = root.join(if cfg!(windows) {
        "fake-ffmpeg.exe"
    } else {
        "fake-ffmpeg"
    });
    let compiler = std::env::var_os("RUSTC")
        .map(std::path::PathBuf::from)
        .unwrap_or_else(|| {
            let home =
                std::env::var_os(if cfg!(windows) { "USERPROFILE" } else { "HOME" }).unwrap();
            std::path::PathBuf::from(home)
                .join(".cargo/bin")
                .join(if cfg!(windows) { "rustc.exe" } else { "rustc" })
        });
    assert!(Command::new(compiler)
        .arg(std::path::Path::new(env!("CARGO_MANIFEST_DIR")).join("tests/fixtures/fake_ffmpeg.rs"))
        .arg("-o")
        .arg(&fake)
        .status()
        .unwrap()
        .success());
    std::env::set_var("CLIPES_FAKE_FFMPEG_STATE", &root);
    run("components.settings.set", json!({"data_dir":root.join("data"),"cache_dir":root.join("cache"),"cache_limit_bytes":first_size + 6144,"ffmpeg_path":fake})).unwrap();
    let second = root.join("second.mkv");
    assert!(Command::new("ffmpeg")
        .args([
            "-v",
            "error",
            "-f",
            "lavfi",
            "-i",
            "color=c=red:s=160x90:d=2",
            "-f",
            "lavfi",
            "-i",
            "sine=frequency=330:duration=2",
            "-c:v",
            "mpeg4",
            "-c:a",
            "pcm_s16le",
            "-y"
        ])
        .arg(&second)
        .status()
        .unwrap()
        .success());
    run(
        "sources.import",
        json!({"project":path,"path":second,"permission":{"status":"none"},"audio_track":1}),
    )
    .unwrap();
    let start = Instant::now();
    while !root.join("running").exists() {
        assert!(start.elapsed() < Duration::from_secs(30));
        std::thread::sleep(Duration::from_millis(20));
    }
    run("projects.close", json!({})).unwrap();
    fs::write(root.join("continue"), b"continue").unwrap();
    run("projects.open", json!({"path":path})).unwrap();
    let start = Instant::now();
    loop {
        let jobs = run("jobs.list", json!({})).unwrap();
        let job = jobs.as_array().unwrap().last().unwrap();
        assert_ne!(job["state"], "failed");
        if job["state"] == "completed" {
            assert_eq!(job["attempts"], 2);
            break;
        }
        assert!(start.elapsed() < Duration::from_secs(30));
        std::thread::sleep(Duration::from_millis(20));
    }
    assert!(!old.exists());
    assert!(newer.exists());
    assert!(std::path::Path::new(previews["waveform"].as_str().unwrap()).is_file());
    run("projects.close", json!({})).unwrap();
    fs::remove_dir_all(root).unwrap();
}
