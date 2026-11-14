use clipes_core::{
    dispatch,
    jobs::{self, Safety},
};
use serde_json::json;
use std::{
    fs,
    process::Command,
    time::{Duration, SystemTime, UNIX_EPOCH},
};

#[test]
fn child_worker() {
    let Ok(root) = std::env::var("CLIPES_CRASH_ROOT") else {
        return;
    };
    dispatch(
        "projects.create",
        json!({"parent":root,"name":"Canal"}),
        &mut |_| {},
    )
    .unwrap();
    let local = jobs::enqueue("preview", Safety::Local).unwrap();
    let paid = jobs::enqueue("provider", Safety::Paid).unwrap();
    assert!(jobs::begin(local).unwrap());
    assert!(jobs::begin(paid).unwrap());
    jobs::checkpoint(local, "checkpoint").unwrap();
    jobs::checkpoint(paid, "sent").unwrap();
    fs::write(std::path::Path::new(&root).join("ready"), b"ready").unwrap();
    loop {
        std::thread::park();
    }
}

#[test]
fn crash_reconciles_running_jobs_and_retains_checkpoint() {
    let root = std::env::temp_dir().join(format!(
        "clipes-jobs-{}-{}",
        std::process::id(),
        SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap()
            .as_nanos()
    ));
    fs::create_dir_all(&root).unwrap();
    let mut child = Command::new(std::env::current_exe().unwrap())
        .args(["--exact", "child_worker", "--nocapture"])
        .env("CLIPES_CRASH_ROOT", &root)
        .env("CLIPES_DATA_DIR", root.join("data"))
        .spawn()
        .unwrap();
    let start = std::time::Instant::now();
    while !root.join("ready").exists() {
        assert!(
            start.elapsed() < Duration::from_secs(30),
            "child did not become ready: {:?}",
            child.try_wait()
        );
        std::thread::sleep(Duration::from_millis(20));
    }
    child.kill().unwrap();
    child.wait().unwrap();
    std::env::set_var("CLIPES_DATA_DIR", root.join("data"));
    dispatch(
        "projects.open",
        json!({"path":root.join("Canal.clipes")}),
        &mut |_| {},
    )
    .unwrap();
    let jobs = dispatch("jobs.list", json!({}), &mut |_| {}).unwrap();
    assert_eq!(jobs[0]["state"], "queued");
    assert_eq!(jobs[0]["attempts"], 1);
    assert_eq!(jobs[0]["checkpoint"], "checkpoint");
    assert_eq!(jobs[1]["state"], "uncertain");
    assert_eq!(jobs[1]["checkpoint"], "sent");
    let paid_id = jobs[1]["id"].as_i64().unwrap();
    assert_eq!(
        dispatch("jobs.retry", json!({"id":paid_id}), &mut |_| {})
            .unwrap_err()
            .code,
        "confirmation_required"
    );
    assert_eq!(
        dispatch("jobs.list", json!({}), &mut |_| {}).unwrap()[1]["state"],
        "uncertain"
    );
    dispatch(
        "jobs.retry",
        json!({"id":paid_id,"confirmed":true}),
        &mut |_| {},
    )
    .unwrap();
    assert_eq!(
        dispatch("jobs.list", json!({}), &mut |_| {}).unwrap()[1]["state"],
        "queued"
    );
    dispatch("jobs.cancel", json!({"id":jobs[0]["id"]}), &mut |_| {}).unwrap();
    let updated = dispatch("jobs.list", json!({}), &mut |_| {}).unwrap();
    assert_eq!(updated[0]["state"], "cancelled");
    let events = std::sync::Arc::new(std::sync::Mutex::new(Vec::new()));
    let captured = events.clone();
    assert!(
        clipes_core::set_event_emitter(std::sync::Arc::new(move |event| captured
            .lock()
            .unwrap()
            .push(event)))
        .is_ok()
    );
    let id = jobs::enqueue("test", Safety::Local).unwrap();
    assert!(jobs::begin(id).unwrap());
    jobs::progress(id, "render", 42, "Gerando prévia").unwrap();
    let events = events.lock().unwrap();
    assert_eq!(events[0].job, id.to_string());
    assert!(events[0].project.as_ref().is_some_and(|id| !id.is_empty()));
    assert_eq!(events[0].percentage, 42);
    drop(events);
    let paid = jobs::enqueue("provider", Safety::Paid).unwrap();
    assert!(jobs::begin(paid).unwrap());
    jobs::finish(
        paid,
        Err(clipes_core::CoreError {
            code: "timeout_uncertain".into(),
            message: "incerto".into(),
        }),
    )
    .unwrap();
    dispatch("jobs.discard", json!({"id":paid}), &mut |_| {}).unwrap();
    assert_eq!(
        dispatch("jobs.list", json!({}), &mut |_| {})
            .unwrap()
            .as_array()
            .unwrap()
            .last()
            .unwrap()["state"],
        "cancelled"
    );
    dispatch("projects.close", json!({}), &mut |_| {}).unwrap();
    fs::remove_dir_all(root).unwrap();
}
