use clipes_core::{dispatch, projects, ProgressEvent};
use serde_json::json;
use std::{
    fs,
    sync::{Arc, Mutex, OnceLock},
    time::{Duration, Instant, SystemTime, UNIX_EPOCH},
};

static TEST_LOCK: Mutex<()> = Mutex::new(());

fn captured_events() -> &'static Mutex<Vec<ProgressEvent>> {
    static EVENTS: OnceLock<Mutex<Vec<ProgressEvent>>> = OnceLock::new();
    EVENTS.get_or_init(|| {
        let _ = clipes_core::set_event_emitter(Arc::new(|ev| {
            if let Some(buf) = EVENTS.get() {
                if let Ok(mut guard) = buf.lock() {
                    guard.push(ev);
                }
            }
        }));
        Mutex::new(Vec::new())
    })
}

#[test]
fn backup_restore_and_reject_corruption() {
    let _lock = TEST_LOCK.lock().unwrap_or_else(|e| e.into_inner());
    let _ = captured_events();
    let root = std::env::temp_dir().join(format!(
        "clipes-backup-{}-{}",
        std::process::id(),
        SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap()
            .as_nanos()
    ));
    fs::create_dir_all(&root).unwrap();
    std::env::set_var("CLIPES_DATA_DIR", root.join("data"));
    let run = |name, value| dispatch(name, value, &mut |_| {});
    let project = run("projects.create", json!({"parent":root,"name":"Canal"})).unwrap();
    let path = std::path::Path::new(project["path"].as_str().unwrap());
    projects::with_writer(|conn| {
        conn.execute("UPDATE project SET name='Alterado'", [])?;
        Ok(())
    })
    .unwrap();
    run("backups.create", json!({})).unwrap();
    let backups = run("backups.list", json!({})).unwrap();
    let id = backups.as_array().unwrap()[0]["id"]
        .as_str()
        .unwrap()
        .to_owned();
    let job = projects::start_job().unwrap();
    assert_eq!(
        run("backups.restore", json!({"id":id})).unwrap_err().code,
        "project_busy"
    );
    drop(job);
    let (entered_tx, entered_rx) = std::sync::mpsc::channel();
    let (release_tx, release_rx) = std::sync::mpsc::channel();
    let writer = std::thread::spawn(move || {
        projects::with_writer(|conn| {
            conn.execute("UPDATE project SET name='Em escrita'", [])?;
            entered_tx.send(()).unwrap();
            release_rx.recv().unwrap();
            Ok(())
        })
        .unwrap();
    });
    entered_rx.recv().unwrap();
    let (done_tx, done_rx) = std::sync::mpsc::channel();
    let restore_id = id.clone();
    let restorer = std::thread::spawn(move || {
        done_tx
            .send(dispatch(
                "backups.restore",
                json!({"id":restore_id}),
                &mut |_| {},
            ))
            .unwrap();
    });
    assert!(done_rx
        .recv_timeout(std::time::Duration::from_millis(100))
        .is_err());
    release_tx.send(()).unwrap();
    writer.join().unwrap();
    done_rx.recv().unwrap().unwrap();
    restorer.join().unwrap();
    projects::with_writer(|conn| {
        conn.execute("UPDATE project SET name='Depois'", [])?;
        Ok(())
    })
    .unwrap();
    run("backups.restore", json!({"id":id})).unwrap();
    let name = projects::with_writer(|conn| {
        conn.query_row("SELECT name FROM project", [], |r| r.get::<_, String>(0))
    })
    .unwrap();
    assert_eq!(name, "Alterado");
    run(
        "backups.settings.set",
        json!({"interval_seconds":1,"copies":2}),
    )
    .unwrap();
    let (entered_tx, entered_rx) = std::sync::mpsc::channel();
    let (release_tx, release_rx) = std::sync::mpsc::channel();
    let writer = std::thread::spawn(move || {
        projects::with_writer(|conn| {
            conn.execute("UPDATE project SET name='Concorrente'", [])?;
            entered_tx.send(()).unwrap();
            release_rx.recv().unwrap();
            Ok(())
        })
        .unwrap()
    });
    entered_rx.recv().unwrap();
    let (done_tx, done_rx) = std::sync::mpsc::channel();
    let backup = std::thread::spawn(move || {
        done_tx
            .send(dispatch("backups.create", json!({}), &mut |_| {}))
            .unwrap();
    });
    assert!(done_rx
        .recv_timeout(std::time::Duration::from_millis(100))
        .is_err());
    release_tx.send(()).unwrap();
    writer.join().unwrap();
    done_rx.recv().unwrap().unwrap();
    backup.join().unwrap();
    let before_timer = run("backups.list", json!({})).unwrap();
    let backup_id = before_timer
        .as_array()
        .unwrap()
        .iter()
        .find(|b| b["before_restore"] == false)
        .unwrap()["id"]
        .as_str()
        .unwrap();
    let copy = rusqlite::Connection::open(path.join("backups").join(backup_id)).unwrap();
    assert_eq!(
        copy.query_row("SELECT name FROM project", [], |r| r.get::<_, String>(0))
            .unwrap(),
        "Concorrente"
    );
    drop(copy);
    projects::with_writer(|conn| {
        conn.execute("UPDATE project SET name='Concorrente'", [])?;
        Ok(())
    })
    .unwrap();
    std::thread::sleep(std::time::Duration::from_millis(2200));
    let backups = run("backups.list", json!({})).unwrap();
    assert_ne!(backups, before_timer);
    let regular: Vec<_> = backups
        .as_array()
        .unwrap()
        .iter()
        .filter(|b| b["before_restore"] == false)
        .collect();
    assert_eq!(regular.len(), 2);
    let latest = path
        .join("backups")
        .join(regular[0]["id"].as_str().unwrap());
    let copy = rusqlite::Connection::open(latest).unwrap();
    assert_eq!(
        copy.query_row("SELECT name FROM project", [], |r| r.get::<_, String>(0))
            .unwrap(),
        "Concorrente"
    );
    drop(copy);
    let ids = backups.clone();
    std::thread::sleep(std::time::Duration::from_millis(2200));
    assert_eq!(run("backups.list", json!({})).unwrap(), ids);
    let corrupt_id = format!("backup-{:039}.sqlite", 1);
    fs::write(path.join("backups").join(&corrupt_id), b"not sqlite").unwrap();
    assert_eq!(
        run("backups.restore", json!({"id":corrupt_id}))
            .unwrap_err()
            .code,
        "backup_invalid"
    );
    let name = projects::with_writer(|conn| {
        conn.query_row("SELECT name FROM project", [], |r| r.get::<_, String>(0))
    })
    .unwrap();
    assert_eq!(name, "Concorrente");
    let valid = path
        .join("backups")
        .join(regular[0]["id"].as_str().unwrap());
    let fk_id = format!("backup-{:039}.sqlite", 2);
    let fk_bad = path.join("backups").join(&fk_id);
    fs::copy(valid, &fk_bad).unwrap();
    let broken = rusqlite::Connection::open(&fk_bad).unwrap();
    broken.execute_batch("PRAGMA foreign_keys=OFF; CREATE TABLE parent_fk(id INTEGER PRIMARY KEY); CREATE TABLE child_fk(parent_id INTEGER REFERENCES parent_fk(id)); INSERT INTO child_fk VALUES (9);").unwrap();
    drop(broken);
    assert_eq!(
        run("backups.restore", json!({"id":fk_id}))
            .unwrap_err()
            .code,
        "backup_invalid"
    );
    std::thread::sleep(std::time::Duration::from_millis(1200));
    run("projects.close", json!({})).unwrap();
    let before_reopen = run("projects.open", json!({"path":path})).unwrap();
    assert_eq!(before_reopen["name"], "Concorrente");
    let after_reopen = run("backups.list", json!({})).unwrap();
    assert_ne!(after_reopen, ids);
    run("projects.close", json!({})).unwrap();
    fs::remove_dir_all(path.join("backups")).unwrap();
    fs::write(path.join("backups"), b"not a directory").unwrap();
    run("projects.open", json!({"path":path})).unwrap();
    let warning = run("projects.current", json!({})).unwrap()["warning"].clone();
    assert_eq!(warning["code"], "backup_failed");
    assert!(!warning["message"]
        .as_str()
        .unwrap()
        .contains(path.to_str().unwrap()));
    run("projects.close", json!({})).unwrap();
    fs::remove_dir_all(root).unwrap();
}

#[test]
fn auto_backup_emits_core_progress_on_complete_and_failure_without_leaking_paths() {
    let _lock = TEST_LOCK.lock().unwrap_or_else(|e| e.into_inner());
    let events_buf = captured_events();
    events_buf.lock().unwrap().clear();

    let root = tempfile::tempdir().unwrap();
    std::env::set_var("CLIPES_DATA_DIR", root.path().join("data"));
    let run = |name, value| dispatch(name, value, &mut |_| {});

    let project = run(
        "projects.create",
        json!({"parent": root.path(), "name": "AutoBackupEventos"}),
    )
    .unwrap();
    let path = std::path::PathBuf::from(project["path"].as_str().unwrap());
    let project_id = project["id"].as_str().unwrap().to_owned();

    run(
        "backups.settings.set",
        json!({"interval_seconds": 1, "copies": 2}),
    )
    .unwrap();
    std::thread::sleep(Duration::from_millis(1200));

    events_buf.lock().unwrap().clear();
    projects::with_writer(|conn| {
        conn.execute("UPDATE project SET name='AutoBackupOk'", [])?;
        Ok(())
    })
    .unwrap();

    let deadline = Instant::now() + Duration::from_secs(6);
    let ok_event = loop {
        let found = events_buf
            .lock()
            .unwrap()
            .iter()
            .find(|e| e.job == "backup" && e.stage == "backup_complete")
            .cloned();
        if let Some(ev) = found {
            break ev;
        }
        assert!(
            Instant::now() < deadline,
            "backup automático concluído não emitiu core-progress; eventos={:?}",
            *events_buf.lock().unwrap()
        );
        std::thread::sleep(Duration::from_millis(50));
    };
    assert_eq!(ok_event.project.as_deref(), Some(project_id.as_str()));
    assert_eq!(ok_event.percentage, 100);
    assert!(ok_event.error.is_none());
    let ok_json = serde_json::to_string(&ok_event).unwrap();
    assert!(
        !ok_json.contains(path.to_str().unwrap())
            && !ok_json.contains(root.path().to_str().unwrap()),
        "evento de backup concluído vazou caminho: {ok_json}"
    );

    // Agora provoca falha no backup automático em segundo plano substituindo a pasta backups por um arquivo.
    fs::remove_dir_all(path.join("backups")).unwrap();
    fs::write(path.join("backups"), b"not a directory").unwrap();
    std::thread::sleep(Duration::from_millis(1200));

    events_buf.lock().unwrap().clear();
    projects::with_writer(|conn| {
        conn.execute("UPDATE project SET name='AutoBackupFail'", [])?;
        Ok(())
    })
    .unwrap();

    let deadline = Instant::now() + Duration::from_secs(6);
    let err_event = loop {
        let found = events_buf
            .lock()
            .unwrap()
            .iter()
            .find(|e| e.job == "backup" && e.stage == "backup_failed")
            .cloned();
        if let Some(ev) = found {
            break ev;
        }
        assert!(
            Instant::now() < deadline,
            "backup automático falho não emitiu core-progress; eventos={:?}",
            *events_buf.lock().unwrap()
        );
        std::thread::sleep(Duration::from_millis(50));
    };
    assert_eq!(err_event.project.as_deref(), Some(project_id.as_str()));
    assert_eq!(err_event.percentage, 0);
    assert_eq!(
        err_event.error.as_ref().map(|e| e.code.as_str()),
        Some("backup_failed")
    );
    let err_json = serde_json::to_string(&err_event).unwrap();
    assert!(
        !err_json.contains(path.to_str().unwrap())
            && !err_json.contains(root.path().to_str().unwrap()),
        "evento de backup falho vazou caminho: {err_json}"
    );

    run("projects.close", json!({})).unwrap();
}
