//! Matar o processo no meio de uma chamada paga de um lote de Fontes (#56): a Janela vira
//! incerta e não é repetida às cegas; a Fonte pausa, as outras seguem; repetir só com confirmação
//! mostrando o custo; e o lote retoma sem repetir Fonte nem Janela concluída.
#[path = "support/batch_fake.rs"]
mod batch_fake;
use batch_fake::*;
use clipes_core::{jobs, provider::cost::Target};
use serde_json::json;
use std::{
    fs,
    process::Command,
    sync::Arc,
    time::{Duration, Instant, SystemTime, UNIX_EPOCH},
};

fn paid_setup() {
    configure("https://192.0.2.10/v1", 32768);
    call(
        "provider.prices.set",
        json!({"provider":"openai","model":"fake-model","inputPerMillion":100.0,"outputPerMillion":200.0}),
    );
    jobs::set_ai_route(Some((
        Target::Api {
            provider: "openai".into(),
            model: "fake-model".into(),
            local: false,
        },
        "legacy".into(),
    )));
}

#[test]
fn child_worker() {
    let Ok(root) = std::env::var("CLIPES_CRASH_ROOT") else {
        return;
    };
    call("projects.create", json!({"parent": root, "name": "Canal"}));
    let (s1, s2) = (seed(1), seed(2));
    let fake = Arc::new(Fake::default());
    let ready = std::path::Path::new(&root).join("ready");
    *fake.on_enter.lock().unwrap() = Some(Box::new(move || {
        fs::write(&ready, b"ready").unwrap();
    }));
    fake.set(1, Behavior::Hang);
    jobs::set_ai_provider(Some(fake));
    paid_setup();
    call(
        "batches.create",
        json!({"sourceIds": [s1, s2], "confirmed": true}),
    );
    loop {
        std::thread::park();
    }
}

#[test]
fn crash_during_a_paid_call_is_uncertain_never_repeated_and_the_batch_resumes() {
    let root = std::env::temp_dir().join(format!(
        "clipes-batch-crash-{}-{}",
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
            start.elapsed() < Duration::from_secs(90),
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
    paid_setup();
    call("projects.open", json!({"path": root.join("Canal.clipes")}));
    let id = call("batches.list", json!({}))[0]["id"].as_i64().unwrap();
    let (s1, s2) = (1, 2);

    // A Fonte 1 pausa como incerta; a 2 segue e termina; nada da 1 foi reenviado.
    let b = wait_batch(id, "paused the uncertain Source", |b| {
        item_state(b, s1) == "paused" && item_state(b, s2) == "completed"
    });
    assert_eq!(b["items"][0]["error"], "interrupted");
    assert_eq!(
        fake.calls_of(1),
        0,
        "an uncertain paid call is never repeated blindly"
    );
    let calls_of_2 = fake.calls_of(2);
    assert!(calls_of_2 > 1);

    // Repetir sem confirmação é recusado, com o custo estimado; nada é enviado.
    let err = fail("batches.item.resume", json!({"id": id, "sourceId": s1}));
    assert_eq!(err.code, "confirmation_required");
    assert!(err.usage.unwrap()["estimate"].is_object());
    std::thread::sleep(Duration::from_millis(400));
    assert_eq!(fake.calls_of(1), 0);

    // Confirmado, só as Janelas não concluídas voltam; a Fonte 2 não se repete.
    call(
        "batches.item.resume",
        json!({"id": id, "sourceId": s1, "confirmed": true}),
    );
    let b = wait_batch(id, "finished", |b| b["status"] == "completed");
    assert_eq!(item_state(&b, s1), "completed");
    assert!(fake.calls_of(1) > 0);
    assert_eq!(fake.calls_of(2), calls_of_2);

    call("projects.close", json!({}));
    jobs::set_ai_provider(None);
    let _ = fs::remove_dir_all(root);
}
