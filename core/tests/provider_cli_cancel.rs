//! Cancelling or timing out a CLI call kills the CLI and its children (#117).
use clipes_core::{
    dispatch,
    provider::{run_structured, CancelToken},
};
use serde_json::{json, Value};
use std::{
    env, fs,
    path::{Path, PathBuf},
    thread,
    time::{Duration, Instant},
};

fn counter(path: &Path) -> Option<u64> {
    fs::read_to_string(path).ok()?.trim().parse().ok()
}

fn wait_started(paths: &[&Path]) {
    let deadline = Instant::now() + Duration::from_secs(20);
    while !paths.iter().all(|p| counter(p).is_some()) {
        assert!(Instant::now() < deadline, "fake CLI did not start");
        thread::sleep(Duration::from_millis(25));
    }
}

/// True while the process behind the counter file is alive and rewriting it.
fn still_running(path: &Path) -> bool {
    let before = counter(path);
    thread::sleep(Duration::from_millis(600));
    counter(path) != before
}

#[test]
fn cancel_and_timeout_kill_the_cli_and_its_children() {
    let root = env::temp_dir().join(format!("clipes-cli-cancel-{}", std::process::id()));
    fs::create_dir_all(&root).unwrap();
    env::set_var("CLIPES_DATA_DIR", &root);
    let rustc = PathBuf::from(env!("CARGO")).with_file_name(if cfg!(windows) {
        "rustc.exe"
    } else {
        "rustc"
    });
    let executable = root.join(if cfg!(windows) { "codex.exe" } else { "codex" });
    assert!(std::process::Command::new(&rustc)
        .arg(PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("tests/fixtures/fake_slow_cli.rs"))
        .arg("-o")
        .arg(&executable)
        .status()
        .unwrap()
        .success());
    env::set_var(
        "PATH",
        env::join_paths(
            std::iter::once(root.clone()).chain(env::split_paths(&env::var_os("PATH").unwrap())),
        )
        .unwrap(),
    );
    let beat = root.join("beat");
    let beat_child = root.join("beat-child");
    env::set_var("FAKE_BEAT", &beat);
    env::set_var("FAKE_BEAT_CHILD", &beat_child);
    let run = |name, args| dispatch(name, args, &mut |_| {});
    run("provider.cli.configure", json!({"kind":"codex"})).unwrap();
    run("provider.cli.confirm", json!({"kind":"codex"})).unwrap();
    let request: Value = json!({"instruction":"Return data","transcript":"text","schema":{"type":"object"},"nativeSchema":true});

    // Cancelled while the CLI is running.
    let token = CancelToken::new();
    let canceller = {
        let (token, beat, beat_child) = (token.clone(), beat.clone(), beat_child.clone());
        thread::spawn(move || {
            wait_started(&[&beat, &beat_child]);
            token.cancel();
        })
    };
    let error = run_structured(request.clone(), &token).unwrap_err();
    canceller.join().unwrap();
    assert_eq!(error.code, "cancelled");
    assert!(!still_running(&beat), "the CLI survived the cancellation");
    assert!(
        !still_running(&beat_child),
        "a child of the CLI survived the cancellation"
    );

    // The CLI timeout is configurable and kills the tree too.
    fs::remove_file(&beat).unwrap();
    fs::remove_file(&beat_child).unwrap();
    assert_eq!(
        run("provider.cli.status", json!({})).unwrap()["timeoutSeconds"],
        300
    );
    assert_eq!(
        run(
            "provider.cli.configure",
            json!({"kind":"codex","timeoutSeconds":0})
        )
        .unwrap_err()
        .code,
        "invalid_settings"
    );
    run(
        "provider.cli.configure",
        json!({"kind":"codex","timeoutSeconds":1}),
    )
    .unwrap();
    assert_eq!(
        run("provider.cli.status", json!({})).unwrap()["timeoutSeconds"],
        1
    );
    let error = run_structured(request, &CancelToken::new()).unwrap_err();
    assert_eq!(error.code, "timeout_uncertain");
    assert!(!still_running(&beat), "the CLI survived the timeout");
    assert!(
        !still_running(&beat_child),
        "a child of the CLI survived the timeout"
    );
    fs::remove_dir_all(&root).ok();
}
