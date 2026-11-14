//! Matar o processo no meio de uma chamada paga (#121): só aquele job fica `uncertain`, os já
//! `completed` não se repetem e repetir exige confirmação.
#[path = "support/ai_fake.rs"]
mod ai_fake;
use ai_fake::*;
use clipes_core::{
    dispatch,
    jobs::{self, Safety},
};
use serde_json::json;
use std::{
    fs,
    process::Command,
    sync::Arc,
    time::{Duration, Instant, SystemTime, UNIX_EPOCH},
};

#[test]
fn child_worker() {
    let Ok(root) = std::env::var("CLIPES_CRASH_ROOT") else {
        return;
    };
    dispatch(
        "projects.create",
        json!({"parent": root, "name": "Canal"}),
        &mut |_| {},
    )
    .unwrap();
    let fake = Arc::new(Fake::default());
    let ready = std::path::Path::new(&root).join("ready");
    *fake.on_enter.lock().unwrap() = Some(Box::new(move || {
        fs::write(&ready, b"ready").unwrap();
    }));
    jobs::set_ai_provider(Some(fake.clone()));
    let done = jobs::enqueue_ai("example", &input("ok: um"), Safety::Paid).unwrap();
    wait_state(done, "completed");
    jobs::enqueue_ai("example", &input("hang: dois"), Safety::Paid).unwrap();
    jobs::enqueue_ai("example", &input("ok: tres"), Safety::Paid).unwrap();
    loop {
        std::thread::park();
    }
}

#[test]
fn crash_during_a_paid_call_leaves_only_that_job_uncertain() {
    let root = std::env::temp_dir().join(format!(
        "clipes-ai-crash-{}-{}",
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
    let start = Instant::now();
    while !root.join("ready").exists() {
        assert!(
            start.elapsed() < Duration::from_secs(60),
            "child did not reach the paid call: {:?}",
            child.try_wait()
        );
        std::thread::sleep(Duration::from_millis(20));
    }
    child.kill().unwrap();
    child.wait().unwrap();

    std::env::set_var("CLIPES_DATA_DIR", root.join("data"));
    let fake = Arc::new(Fake::default());
    jobs::set_ai_provider(Some(fake.clone()));
    dispatch(
        "projects.open",
        json!({"path": root.join("Canal.clipes")}),
        &mut |_| {},
    )
    .unwrap();
    let list = dispatch("jobs.list", json!({}), &mut |_| {}).unwrap();
    assert_eq!(list[0]["state"], "completed");
    assert_eq!(list[1]["state"], "uncertain");
    assert_eq!(list[1]["cost"], "unknown");
    // O job que não tinha começado segue a fila (o worker pode já tê-lo pego).
    assert_ne!(list[2]["state"], "uncertain");
    // O concluído e o incerto não se repetem.
    wait_state(list[2]["id"].as_i64().unwrap(), "completed");
    assert_eq!(fake.count("ok: um"), 0);
    assert_eq!(fake.count("hang:"), 0);
    let uncertain = list[1]["id"].as_i64().unwrap();
    assert_eq!(result(uncertain)["cost"], "unknown");
    let err = dispatch("jobs.retry", json!({"id": uncertain}), &mut |_| {}).unwrap_err();
    assert_eq!(err.code, "confirmation_required");
    assert!(err.usage.unwrap()["estimate"].is_object());
    assert_eq!(fake.count("hang:"), 0);
    let first = list[0]["id"].as_i64().unwrap();
    assert_eq!(wait_state(first, "completed")["attempts"], 1);

    dispatch("projects.close", json!({}), &mut |_| {}).unwrap();
    jobs::set_ai_provider(None);
    let _ = fs::remove_dir_all(root);
}
