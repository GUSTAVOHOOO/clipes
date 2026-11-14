//! #104: um Projeto criado com o esquema anterior ao rusqlite 0.42 abre e migra sem perda.
//! A fixture `project-pre-0104.sqlite` foi gerada pelo código com rusqlite 0.32.
use clipes_core::dispatch;
use rusqlite::Connection;
use serde_json::json;
use std::{fs, path::Path};

static LOCK: std::sync::Mutex<()> = std::sync::Mutex::new(());
const FIXTURE: &[u8] = include_bytes!("fixtures/project-pre-0104.sqlite");

fn project_dir(root: &Path) -> std::path::PathBuf {
    let dir = root.join("Antigo.clipes");
    fs::create_dir_all(&dir).unwrap();
    fs::write(dir.join("project.sqlite"), FIXTURE).unwrap();
    dir
}

fn assert_data(dir: &Path) {
    let c = Connection::open(dir.join("project.sqlite")).unwrap();
    let integrity: String = c
        .query_row("PRAGMA integrity_check", [], |r| r.get(0))
        .unwrap();
    assert_eq!(integrity, "ok");
    let (interval, copies): (i64, i64) = c
        .query_row(
            "SELECT interval_seconds, copies FROM backup_settings",
            [],
            |r| Ok((r.get(0)?, r.get(1)?)),
        )
        .unwrap();
    assert_eq!((interval, copies), (900, 5));
    let origin: String = c
        .query_row("SELECT origin_url FROM sources WHERE id = 1", [], |r| {
            r.get(0)
        })
        .unwrap();
    assert_eq!(origin, "https://example.invalid/v");
    let state: String = c
        .query_row("SELECT state FROM jobs WHERE id = 1", [], |r| r.get(0))
        .unwrap();
    assert_eq!(state, "queued");
}

#[test]
fn project_from_previous_sqlite_opens_and_keeps_data() {
    let _guard = LOCK.lock().unwrap();
    let tmp = tempfile::tempdir().unwrap();
    std::env::set_var("CLIPES_DATA_DIR", tmp.path().join("data"));
    let dir = project_dir(tmp.path());
    let opened = dispatch("projects.open", json!({"path": dir}), &mut |_| {}).unwrap();
    assert_eq!(opened["name"], "Antigo");
    dispatch("projects.close", json!({}), &mut |_| {}).unwrap();
    assert_data(&dir);
    std::env::remove_var("CLIPES_DATA_DIR");
}

#[test]
fn project_missing_a_migration_migrates_with_backup() {
    let _guard = LOCK.lock().unwrap();
    let tmp = tempfile::tempdir().unwrap();
    std::env::set_var("CLIPES_DATA_DIR", tmp.path().join("data"));
    let dir = project_dir(tmp.path());
    {
        // Simula um Projeto de versão anterior sem a migração mais recente.
        let c = Connection::open(dir.join("project.sqlite")).unwrap();
        c.execute_batch(
            "ALTER TABLE sources DROP COLUMN origin_url;
             DELETE FROM schema_migrations WHERE id = '0045_001_source_origin_url';",
        )
        .unwrap();
    }
    dispatch("projects.open", json!({"path": dir}), &mut |_| {}).unwrap();
    dispatch("projects.close", json!({}), &mut |_| {}).unwrap();
    assert!(dir.join("project.pre-migration.sqlite").exists());
    let c = Connection::open(dir.join("project.sqlite")).unwrap();
    let applied: i64 = c
        .query_row(
            "SELECT count(*) FROM schema_migrations WHERE id = '0045_001_source_origin_url'",
            [],
            |r| r.get(0),
        )
        .unwrap();
    assert_eq!(applied, 1);
    let size: i64 = c
        .query_row("SELECT size FROM sources WHERE id = 1", [], |r| r.get(0))
        .unwrap();
    assert_eq!(size, 1024);
    std::env::remove_var("CLIPES_DATA_DIR");
}
