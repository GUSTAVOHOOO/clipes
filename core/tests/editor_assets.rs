//! Miniaturas e onda da timeline (#61), geradas do proxy: ciclo da tarefa, cache junto do proxy,
//! protocolo de mídia, limpeza LRU e cancelamento. Sem rede; vídeo sintético do FFmpeg.
use clipes_core::{dispatch, media};
use serde_json::{json, Value};
use std::{
    fs,
    path::{Path, PathBuf},
    process::Command,
    sync::Mutex,
    time::{Duration, Instant, SystemTime, UNIX_EPOCH},
};

static LOCK: Mutex<()> = Mutex::new(());

fn run(name: &str, args: Value) -> Result<Value, clipes_core::CoreError> {
    dispatch(name, args, &mut |_| {})
}

fn scratch() -> PathBuf {
    let root = std::env::temp_dir().join(format!(
        "clipes-timeline-{}-{}",
        std::process::id(),
        SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap()
            .as_nanos()
    ));
    fs::create_dir_all(&root).unwrap();
    std::env::set_var("CLIPES_DATA_DIR", root.join("data"));
    std::env::set_var("CLIPES_FFPROBE", "ffprobe");
    root
}

fn settings(root: &Path, limit: u64) {
    run("components.settings.set", json!({"data_dir":root.join("data"),"cache_dir":root.join("cache"),"cache_limit_bytes":limit,"ffmpeg_path":"ffmpeg"})).unwrap();
}

fn ffmpeg_with_x264() -> bool {
    Command::new("ffmpeg")
        .args(["-hide_banner", "-encoders"])
        .output()
        .map(|o| String::from_utf8_lossy(&o.stdout).contains("libx264"))
        .unwrap_or(false)
        && Command::new("ffprobe").arg("-version").output().is_ok()
}

fn synthetic(path: &Path, seconds: u32) {
    assert!(Command::new("ffmpeg")
        .args(["-v", "error", "-f", "lavfi", "-i"])
        .arg(format!("testsrc=s=320x180:r=30:d={seconds}"))
        .args(["-f", "lavfi", "-i"])
        .arg(format!("sine=duration={seconds}"))
        .args(["-c:v", "mpeg4", "-c:a", "pcm_s16le", "-ac", "2", "-y"])
        .arg(path)
        .status()
        .unwrap()
        .success());
}

fn wait(key: &str, window: i64, wanted: &[&str]) -> Value {
    let start = Instant::now();
    loop {
        let s = run(
            "editor.timeline_status",
            json!({"key": key, "window_us": window}),
        )
        .unwrap();
        if wanted.contains(&s["state"].as_str().unwrap()) {
            return s;
        }
        assert!(start.elapsed() < Duration::from_secs(60), "timeout: {s}");
        std::thread::sleep(Duration::from_millis(50));
    }
}

fn proxy_ready(key: &str) {
    let start = Instant::now();
    while run("proxy.status", json!({"key": key})).unwrap()["state"] != "ready" {
        assert!(start.elapsed() < Duration::from_secs(60));
        std::thread::sleep(Duration::from_millis(50));
    }
}

fn import(root: &Path, seconds: u32) -> i64 {
    let media_file = root.join("source.mkv");
    synthetic(&media_file, seconds);
    let project = run("projects.create", json!({"parent":root,"name":"Canal"})).unwrap();
    let project = project["path"].as_str().unwrap().to_owned();
    let source = run(
        "sources.import",
        json!({"project":project,"path":media_file,"permission":{"status":"none"},"audio_track":1}),
    )
    .unwrap();
    source["id"].as_i64().unwrap()
}

#[test]
fn timeline_assets_come_from_the_proxy_and_live_in_its_cache() {
    if !ffmpeg_with_x264() {
        eprintln!("Skipping: ffmpeg with libx264 and ffprobe are required");
        return;
    }
    let _guard = LOCK.lock().unwrap_or_else(|e| e.into_inner());
    let root = scratch();
    settings(&root, 1_000_000_000);
    let source_id = import(&root, 300);
    let us = |s: i64| s * 1_000_000;
    let cut = json!({"source_id":source_id,"start_us":us(10),"end_us":us(40)});

    // Sem proxy pronto não há timeline: ela nasce do proxy, nunca da Fonte.
    assert_eq!(
        run("editor.timeline", cut.clone()).unwrap_err().code,
        "proxy_not_ready"
    );
    let key = run("proxy.request", cut.clone()).unwrap()["key"]
        .as_str()
        .unwrap()
        .to_owned();
    proxy_ready(&key);

    let first = run("editor.timeline", cut.clone()).unwrap();
    assert_eq!(first["key"], key.as_str());
    assert_eq!(first["state"], "queued");
    let again = run("editor.timeline", cut.clone()).unwrap();
    assert_eq!(
        again["job"], first["job"],
        "pedir de novo não cria outra tarefa"
    );
    let window = first["windowEndUs"].as_i64().unwrap() - first["windowStartUs"].as_i64().unwrap();
    let done = wait(&key, window, &["ready", "failed"]);
    assert_eq!(done["state"], "ready", "{done}");
    assert_eq!(done["thumbs"]["id"], format!("thumbs/{key}"));
    assert_eq!(
        done["thumbs"]["count"].as_i64().unwrap(),
        (window + 1_999_999) / 2_000_000
    );
    assert!(!done
        .to_string()
        .contains(root.to_str().unwrap().replace('\\', "\\\\").as_str()));

    // Cache junto do proxy; pedir de novo é acerto de cache, sem tarefa nova.
    let dir = root.join("cache/proxies").join(&key);
    assert!(dir.join("thumbs.jpg").is_file() && dir.join("wave.bin").is_file());
    let hit = run("editor.timeline", cut.clone()).unwrap();
    assert_eq!(hit["state"], "ready");
    let timeline_jobs = run("jobs.list", json!({}))
        .unwrap()
        .as_array()
        .unwrap()
        .iter()
        .filter(|j| j["kind"] == "timeline")
        .count();
    assert_eq!(timeline_jobs, 1);

    // A onda (um byte por 100 ms do proxy) reflete o áudio e o sprite sai pelo protocolo de mídia.
    let wave = run("editor.wave", json!({"key": key})).unwrap();
    let values = wave["values"].as_array().unwrap();
    assert!(
        (values.len() as i64 - window / 100_000).abs() <= 2,
        "{}",
        values.len()
    );
    assert!(
        values.iter().filter(|v| v.as_u64().unwrap() > 100).count() > values.len() / 2,
        "seno audível"
    );
    let sprite = media::serve(&format!("thumbs/{key}"), None);
    assert_eq!(sprite.status, 200);
    assert!(sprite.body.starts_with(&[0xFF, 0xD8]), "JPEG");
    assert_eq!(media::serve("thumbs/../secret", None).status, 404);

    // O LRU conta tudo da pasta: com limite menor que o total, outro proxy expulsa este.
    let total: u64 = fs::read_dir(&dir)
        .unwrap()
        .flatten()
        .map(|f| f.metadata().unwrap().len())
        .sum();
    assert!(total > fs::metadata(dir.join("proxy.mp4")).unwrap().len());
    settings(&root, total + 1);
    let other = json!({"source_id":source_id,"start_us":us(250),"end_us":us(280)});
    let key2 = run("proxy.request", other).unwrap()["key"]
        .as_str()
        .unwrap()
        .to_owned();
    proxy_ready(&key2);
    // A limpeza roda logo depois de publicar o proxy novo.
    let waited = Instant::now();
    while dir.exists() && waited.elapsed() < Duration::from_secs(10) {
        std::thread::sleep(Duration::from_millis(50));
    }
    assert!(
        !dir.exists(),
        "pasta antiga removida inteira, com miniaturas e onda"
    );
    assert_eq!(media::serve(&format!("thumbs/{key}"), None).status, 404);
    run("projects.close", json!({})).unwrap();
}

#[test]
fn timeline_job_can_be_cancelled_without_leaving_files() {
    if !ffmpeg_with_x264() {
        eprintln!("Skipping: ffmpeg with libx264 and ffprobe are required");
        return;
    }
    let _guard = LOCK.lock().unwrap_or_else(|e| e.into_inner());
    let root = scratch();
    settings(&root, 1_000_000_000);
    let source_id = import(&root, 90);
    let cut = json!({"source_id":source_id,"start_us":10_000_000,"end_us":40_000_000});
    let key = run("proxy.request", cut.clone()).unwrap()["key"]
        .as_str()
        .unwrap()
        .to_owned();
    proxy_ready(&key);
    let job = run("editor.timeline", cut).unwrap()["job"]
        .as_i64()
        .unwrap();
    run("jobs.cancel", json!({"id": job})).unwrap();
    let end = wait(&key, 0, &["cancelled", "ready"]);
    let dir = root.join("cache/proxies").join(&key);
    if end["state"] == "cancelled" {
        for name in ["thumbs.jpg", "wave.bin", "thumbs.jpg.part", "wave.bin.part"] {
            assert!(!dir.join(name).exists(), "{name}");
        }
    }
    assert!(dir.join("proxy.mp4").is_file(), "o proxy fica");
    run("projects.close", json!({})).unwrap();
}
