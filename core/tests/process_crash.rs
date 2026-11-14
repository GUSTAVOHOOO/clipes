#![cfg(target_os = "linux")]
use std::{
    fs,
    process::Command,
    time::{Duration, Instant, SystemTime, UNIX_EPOCH},
};

#[test]
fn managed_child_helper() {
    let Ok(marker) = std::env::var("CLIPES_PARENT_DEATH_MARKER") else {
        return;
    };
    let (child, _group) = clipes_core::process::spawn_managed("sleep", ["60"]).unwrap();
    fs::write(marker, child.id().to_string()).unwrap();
    loop {
        std::thread::park();
    }
}

#[test]
fn managed_child_ends_when_parent_is_killed() {
    let marker = std::env::temp_dir().join(format!(
        "clipes-parent-{}-{}",
        std::process::id(),
        SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap()
            .as_nanos()
    ));
    let mut parent = Command::new(std::env::current_exe().unwrap())
        .args(["--exact", "managed_child_helper"])
        .env("CLIPES_PARENT_DEATH_MARKER", &marker)
        .spawn()
        .unwrap();
    let deadline = Instant::now() + Duration::from_secs(20);
    while !marker.exists() {
        assert!(Instant::now() < deadline);
        std::thread::sleep(Duration::from_millis(20));
    }
    let pid = fs::read_to_string(&marker).unwrap();
    parent.kill().unwrap();
    parent.wait().unwrap();
    let proc_status = format!("/proc/{}/status", pid.trim());
    loop {
        match fs::read_to_string(&proc_status) {
            Err(_) => break,
            Ok(s)
                if s.lines()
                    .any(|line| line.starts_with("State:") && line.contains('Z')) =>
            {
                break
            }
            _ => (),
        }
        assert!(
            Instant::now() < deadline,
            "managed child survived its parent"
        );
        std::thread::sleep(Duration::from_millis(20));
    }
    fs::remove_file(marker).unwrap();
}
