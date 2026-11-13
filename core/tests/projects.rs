use clipes_core::dispatch;
use serde_json::json;
use std::{
    fs,
    time::{SystemTime, UNIX_EPOCH},
};

#[test]
fn project_lifecycle_and_library_rebuild() {
    let root = std::env::temp_dir().join(format!(
        "clipes-project-{}-{}",
        std::process::id(),
        SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap()
            .as_nanos()
    ));
    fs::create_dir_all(&root).unwrap();
    let data_dir = root.join("data");
    let library = data_dir.join("projects.json");
    let victim = root.join("victim.json");
    fs::write(&victim, "[]").unwrap();
    std::env::set_var("CLIPES_DATA_DIR", &data_dir);
    let run = |name, args| dispatch(name, args, &mut |_| {});
    let project = run(
        "projects.create",
        json!({"parent":root,"name":"Canal","library":victim}),
    )
    .unwrap();
    assert_eq!(fs::read_to_string(&victim).unwrap(), "[]");
    assert!(library.exists());
    let path = project["path"].as_str().unwrap();
    assert!(std::path::Path::new(path).join("project.sqlite").exists());
    assert!(!std::path::Path::new(path)
        .join("project.pre-migration.sqlite")
        .exists());
    let conn =
        rusqlite::Connection::open(std::path::Path::new(path).join("project.sqlite")).unwrap();
    assert_eq!(
        conn.query_row("PRAGMA journal_mode", [], |r| r.get::<_, String>(0))
            .unwrap(),
        "wal"
    );
    conn.execute_batch("CREATE VIRTUAL TABLE fts_probe USING fts5(content); DROP TABLE fts_probe;")
        .unwrap();
    drop(conn);
    fs::remove_file(&library).unwrap();
    assert_eq!(
        run("projects.open", json!({"path":path,"library":victim})).unwrap()["name"],
        "Canal"
    );
    assert_eq!(fs::read_to_string(&victim).unwrap(), "[]");
    assert_eq!(
        run("projects.recent", json!({"library":victim}))
            .unwrap()
            .as_array()
            .unwrap()
            .len(),
        1
    );
    fs::remove_dir_all(std::path::Path::new(path)).unwrap();
    assert_eq!(
        run("projects.recent", json!({"library":victim})).unwrap()[0]["available"],
        false
    );
    std::env::remove_var("CLIPES_DATA_DIR");
    fs::remove_dir_all(root).unwrap();
}

#[test]
fn document_envelopes_are_validated_by_type() {
    for kind in ["clip", "style", "script", "packaging"] {
        assert!(dispatch(
            "documents.validate",
            json!({"type":kind,"document":{"schemaVersion":1,"revision":0}}),
            &mut |_| {}
        )
        .is_ok());
        for doc in [
            json!({"schemaVersion":2,"revision":0}),
            json!({"schemaVersion":1,"revision":-1}),
            json!({"schemaVersion":1,"revision":0.5}),
            json!({}),
        ] {
            assert!(dispatch(
                "documents.validate",
                json!({"type":kind,"document":doc}),
                &mut |_| {}
            )
            .is_err());
        }
    }
    assert!(dispatch(
        "documents.validate",
        json!({"type":"unknown","document":{"schemaVersion":1,"revision":0}}),
        &mut |_| {}
    )
    .is_err());
}

#[test]
fn migration_backup_is_valid_and_unknown_migration_is_rejected() {
    use rusqlite::Connection;
    let root = std::env::temp_dir().join(format!(
        "clipes-migration-{}-{}",
        std::process::id(),
        SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap()
            .as_nanos()
    ));
    let path = root.join("old.clipes");
    fs::create_dir_all(&path).unwrap();
    let db = path.join("project.sqlite");
    let conn = Connection::open(&db).unwrap();
    conn.execute_batch(
        "CREATE TABLE sentinel (value TEXT); INSERT INTO sentinel VALUES ('preserved');",
    )
    .unwrap();
    drop(conn);
    // The initial schema migration runs, although this old database has no project row.
    assert!(dispatch("projects.open", json!({"path":path}), &mut |_| {}).is_err());
    let backup = Connection::open(path.join("project.pre-migration.sqlite")).unwrap();
    assert_eq!(
        backup
            .query_row("PRAGMA integrity_check", [], |r| r.get::<_, String>(0))
            .unwrap(),
        "ok"
    );
    assert_eq!(
        backup
            .query_row("SELECT value FROM sentinel", [], |r| r.get::<_, String>(0))
            .unwrap(),
        "preserved"
    );
    drop(backup);
    let conn = Connection::open(&db).unwrap();
    conn.execute("INSERT INTO schema_migrations VALUES ('9999_future')", [])
        .unwrap();
    drop(conn);
    assert_eq!(
        dispatch("projects.open", json!({"path":path}), &mut |_| {})
            .unwrap_err()
            .code,
        "newer_project"
    );
    fs::remove_dir_all(root).unwrap();
}
