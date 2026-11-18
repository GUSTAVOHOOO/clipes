//! Testes TDD de `editor.snapshots` (com `snapshot_id`) e `editor.snapshots.restore`.
use clipes_core::{
    dispatch,
    projects::{with_reader, with_writer},
    CoreError,
};
use rusqlite::Connection;
use serde_json::{json, Value};
use std::{
    ffi::OsString,
    fs,
    path::{Path, PathBuf},
    sync::{Mutex, MutexGuard},
};

static TEST_LOCK: Mutex<()> = Mutex::new(());
const V1_FIXTURE: &[u8] = include_bytes!("fixtures/project-pre-0104.sqlite");

struct SessionGuard {
    _lock: MutexGuard<'static, ()>,
    prev_data_dir: Option<OsString>,
    _tmp: tempfile::TempDir,
    project_path: Option<PathBuf>,
}

impl SessionGuard {
    fn new() -> Self {
        let lock = TEST_LOCK.lock().unwrap_or_else(|e| e.into_inner());
        let tmp = tempfile::tempdir().unwrap();
        let prev_data_dir = std::env::var_os("CLIPES_DATA_DIR");
        std::env::set_var("CLIPES_DATA_DIR", tmp.path().join("data"));
        Self {
            _lock: lock,
            prev_data_dir,
            _tmp: tmp,
            project_path: None,
        }
    }

    fn root(&self) -> &Path {
        self._tmp.path()
    }

    fn create_project(&mut self, name: &str) -> PathBuf {
        let created = call(
            "projects.create",
            json!({ "parent": self.root(), "name": name }),
        );
        let path = PathBuf::from(created["path"].as_str().unwrap());
        self.project_path = Some(path.clone());
        path
    }

    fn open_v1_fixture(&mut self, name: &str) -> PathBuf {
        let dir = self.root().join(format!("{name}.clipes"));
        fs::create_dir_all(&dir).unwrap();
        fs::write(dir.join("project.sqlite"), V1_FIXTURE).unwrap();
        let opened = call("projects.open", json!({ "path": dir }));
        let canonical = PathBuf::from(opened["path"].as_str().unwrap());
        self.project_path = Some(canonical.clone());
        canonical
    }
}

impl Drop for SessionGuard {
    fn drop(&mut self) {
        let _ = dispatch("projects.close", json!({}), &mut |_| {});
        match self.prev_data_dir.take() {
            Some(v) => std::env::set_var("CLIPES_DATA_DIR", v),
            None => std::env::remove_var("CLIPES_DATA_DIR"),
        }
    }
}

fn call(name: &str, args: Value) -> Value {
    dispatch(name, args, &mut |_| {}).unwrap()
}

fn run(name: &str, args: Value) -> Result<Value, CoreError> {
    dispatch(name, args, &mut |_| {})
}

fn seed_source_with_transcript() -> i64 {
    with_writer(|c| {
        c.execute(
            "INSERT INTO sources(path,size,duration_us,partial_hash,metadata,permission,audio_track) VALUES ('offline.mp4',1,2000000000,'h',?1,'{}',0)",
            [r#"{"streams":[{"codec_type":"video","avg_frame_rate":"30/1"}]}"#],
        )?;
        let source = c.last_insert_rowid();
        c.execute(
            "INSERT INTO transcripts(source_id,audio_track,engine,model,revision,compute_type,state,resume_us,duration_us) VALUES (?1,0,'local','m','r','c','complete',2000000000,2000000000)",
            [source],
        )?;
        let transcript = c.last_insert_rowid();
        for id in 1..=30 {
            let start = (id - 1) * 10_000_000i64;
            let end = start + 8_000_000i64;
            c.execute(
                "INSERT INTO sentences(transcript_id,id,first_position,last_position,start_us,end_us,text) VALUES (?1,?2,?2,?2,?3,?4,'Frase')",
                (transcript, id, start, start + 10_000_000i64),
            )?;
            c.execute(
                "INSERT INTO transcript_words(transcript_id,position,kind,text,start_us,end_us,language) VALUES (?1,?2,'word','fala',?3,?4,'pt')",
                (transcript, id, start, end),
            )?;
        }
        Ok(source)
    })
    .unwrap()
}

#[test]
fn editor_snapshots_exposes_stable_snapshot_id_additively() {
    let mut guard = SessionGuard::new();
    guard.create_project("SnapshotsId");
    let source = seed_source_with_transcript();
    let opened = call(
        "editor.open",
        json!({ "source_id": source, "start_id": 5, "end_id": 10 }),
    );
    let clip_id = opened["clipId"].as_i64().unwrap();

    call(
        "editor.adjust",
        json!({ "clip_id": clip_id, "edge": "start", "sentence_delta": -1 }),
    );
    call("editor.flush", json!({}));

    let snaps_first = call("editor.snapshots", json!({ "clip_id": clip_id }));
    let list_first = snaps_first.as_array().unwrap();
    assert_eq!(list_first.len(), 1);
    let first_snap = &list_first[0];
    let first_id = first_snap["snapshot_id"]
        .as_i64()
        .expect("snapshot_id deve ser inteiro em editor.snapshots");
    assert_eq!(first_snap["schemaVersion"], 2);
    assert_eq!(first_snap["revision"], 1);
    assert_eq!(first_snap["range"]["startUs"], 30_000_000);

    let db_ids: Vec<i64> = with_reader(|c| {
        let mut q = c.prepare("SELECT id FROM clip_snapshots WHERE clip_id=?1 ORDER BY id DESC")?;
        let rows = q
            .query_map([clip_id], |r| r.get(0))?
            .collect::<rusqlite::Result<Vec<_>>>();
        rows
    })
    .unwrap();
    assert_eq!(db_ids, vec![first_id]);

    // Novos salvamentos preservam o snapshot_id do item anterior (mesmo após vários saves).
    for n in 0..5 {
        call(
            "editor.adjust",
            json!({ "clip_id": clip_id, "edge": "end", "time_us": if n % 2 == 0 { 110_000_000 } else { 100_000_000 } }),
        );
        call("editor.flush", json!({}));
    }
    let snaps_after = call("editor.snapshots", json!({ "clip_id": clip_id }));
    let list_after = snaps_after.as_array().unwrap();
    assert_eq!(list_after.len(), 6);
    assert_eq!(list_after.last().unwrap()["snapshot_id"], first_id);
}

#[test]
fn editor_snapshots_restore_applies_document_bumps_revision_and_persists() {
    let mut guard = SessionGuard::new();
    let project_path = guard.create_project("RestoreDoc");
    let source = seed_source_with_transcript();
    let request = json!({ "source_id": source, "start_id": 5, "end_id": 10 });
    let opened = call("editor.open", request.clone());
    let clip_id = opened["clipId"].as_i64().unwrap();

    // Estado 1 (snapshot alvo): borda inicial ajustada + silêncios detectados + crop face com keyframe.
    call(
        "editor.adjust",
        json!({ "clip_id": clip_id, "edge": "start", "sentence_delta": -1 }),
    );
    call(
        "editor.silences.detect",
        json!({ "clip_id": clip_id, "threshold_us": 500_000 }),
    );
    call(
        "editor.crop.set_layout",
        json!({ "clip_id": clip_id, "layout": "face" }),
    );
    let snap1_state = call(
        "editor.crop.set_edits",
        json!({ "clip_id": clip_id, "edits": [{ "timeUs": 35_000_000, "x": 0.25, "y": 0.0, "width": 0.4, "height": 1.0 }] }),
    );
    call("editor.flush", json!({}));

    let snaps_after_1 = call("editor.snapshots", json!({ "clip_id": clip_id }));
    let snap1_id = snaps_after_1[0]["snapshot_id"].as_i64().unwrap();

    // Estado 2 e 3 posteriores: altera borda, reverte silêncios e muda layout para fit sem keyframes.
    call(
        "editor.adjust",
        json!({ "clip_id": clip_id, "edge": "start", "sentence_delta": -1 }),
    );
    call("editor.silences.revert_all", json!({ "clip_id": clip_id }));
    call(
        "editor.crop.set_layout",
        json!({ "clip_id": clip_id, "layout": "fit" }),
    );
    call(
        "editor.crop.set_edits",
        json!({ "clip_id": clip_id, "edits": [] }),
    );
    call("editor.flush", json!({}));
    let before_restore = call(
        "editor.adjust",
        json!({ "clip_id": clip_id, "edge": "end", "sentence_delta": 1 }),
    );
    assert_eq!(before_restore["startUs"], 20_000_000);
    assert_eq!(before_restore["endUs"], 110_000_000);
    let rev_before = before_restore["revision"].as_u64().unwrap();
    let undo_before = before_restore["undoCount"].as_u64().unwrap();

    let restored = call(
        "editor.snapshots.restore",
        json!({ "id": clip_id, "snapshot_id": snap1_id }),
    );

    // Mesmo formato completo de estado dos demais comandos de edição.
    assert_eq!(restored["clipId"], clip_id);
    assert_eq!(restored["schemaVersion"], 2);
    assert!(restored["request"].is_object());
    assert!(restored["silences"].is_object());
    assert!(restored["crop"].is_object());
    assert!(restored.get("montage").is_some());
    assert!(restored.get("audioMix").is_some());

    // Documento restaurado bate com o snapshot 1 e a revisão aumenta.
    assert_eq!(restored["startUs"], 30_000_000);
    assert_eq!(restored["endUs"], 100_000_000);
    assert_eq!(restored["request"]["start_id"], 4);
    assert_eq!(restored["request"]["end_id"], 10);
    assert_eq!(restored["crop"]["layout"], "face");
    assert_eq!(restored["crop"]["edits"], snap1_state["edits"]);
    assert!(
        restored["silences"]["removedUs"].as_i64().unwrap() > 0,
        "silêncios ativos do snapshot 1 devem voltar restaurados"
    );
    let rev_restored = restored["revision"].as_u64().unwrap();
    assert!(
        rev_restored > rev_before,
        "revisão deve aumentar ao restaurar"
    );
    assert_eq!(restored["undoCount"], undo_before + 1);
    assert_eq!(restored["redoCount"], 0);

    // Persiste como as outras edições ao fechar/reabrir Projeto.
    call("projects.close", json!({}));
    call("projects.open", json!({ "path": project_path }));
    let reopened = call("editor.open", request);
    assert_eq!(reopened["startUs"], 30_000_000);
    assert_eq!(reopened["endUs"], 100_000_000);
    assert_eq!(reopened["revision"], rev_restored);
    assert_eq!(reopened["crop"]["layout"], "face");
    assert_eq!(reopened["crop"]["edits"], snap1_state["edits"]);
    assert_eq!(reopened["undoCount"], undo_before + 1);
}

#[test]
fn editor_undo_reverts_restore_and_editor_redo_reapplies() {
    let mut guard = SessionGuard::new();
    guard.create_project("RestoreUndoRedo");
    let source = seed_source_with_transcript();
    let opened = call(
        "editor.open",
        json!({ "source_id": source, "start_id": 5, "end_id": 10 }),
    );
    let clip_id = opened["clipId"].as_i64().unwrap();

    // Snapshot 1: [30s, 100s]
    call(
        "editor.adjust",
        json!({ "clip_id": clip_id, "edge": "start", "sentence_delta": -1 }),
    );
    call("editor.flush", json!({}));
    let snap1_id = call("editor.snapshots", json!({ "clip_id": clip_id }))[0]["snapshot_id"]
        .as_i64()
        .unwrap();

    // Estado atual antes da restauração: [20s, 120s]
    call(
        "editor.adjust",
        json!({ "clip_id": clip_id, "edge": "start", "sentence_delta": -1 }),
    );
    let pre_restore = call(
        "editor.adjust",
        json!({ "clip_id": clip_id, "edge": "end", "time_us": 120_000_000 }),
    );
    assert_eq!(pre_restore["startUs"], 20_000_000);
    assert_eq!(pre_restore["endUs"], 120_000_000);

    let restored = call(
        "editor.snapshots.restore",
        json!({ "id": clip_id, "snapshot_id": snap1_id }),
    );
    assert_eq!(restored["startUs"], 30_000_000);
    assert_eq!(restored["endUs"], 100_000_000);
    let rev_after_restore = restored["revision"].as_u64().unwrap();

    // editor.undo volta ao estado anterior à restauração ([20s, 120s]).
    let undone = call("editor.undo", json!({ "clip_id": clip_id }));
    assert_eq!(undone["startUs"], 20_000_000);
    assert_eq!(undone["endUs"], 120_000_000);
    assert!(undone["revision"].as_u64().unwrap() > rev_after_restore);
    assert_eq!(undone["redoCount"], 1);

    // editor.redo reaplica a restauração ([30s, 100s]).
    let redone = call("editor.redo", json!({ "clip_id": clip_id }));
    assert_eq!(redone["startUs"], 30_000_000);
    assert_eq!(redone["endUs"], 100_000_000);
    assert!(redone["revision"].as_u64().unwrap() > undone["revision"].as_u64().unwrap());
    assert_eq!(redone["redoCount"], 0);
}

#[test]
fn editor_snapshots_restore_rejects_other_clip_or_missing_snapshot_without_effect() {
    let mut guard = SessionGuard::new();
    guard.create_project("RestoreOwnership");
    let source = seed_source_with_transcript();

    let clip_a = call(
        "editor.open",
        json!({ "source_id": source, "start_id": 2, "end_id": 6 }),
    )["clipId"]
        .as_i64()
        .unwrap();
    let clip_b = call(
        "editor.open",
        json!({ "source_id": source, "start_id": 12, "end_id": 16 }),
    )["clipId"]
        .as_i64()
        .unwrap();

    let state_a_before = call(
        "editor.adjust",
        json!({ "clip_id": clip_a, "edge": "end", "sentence_delta": 1 }),
    );
    call(
        "editor.adjust",
        json!({ "clip_id": clip_b, "edge": "start", "sentence_delta": -1 }),
    );
    call("editor.flush", json!({}));

    let snap_b_id = call("editor.snapshots", json!({ "clip_id": clip_b }))[0]["snapshot_id"]
        .as_i64()
        .unwrap();

    for bad_snap in [json!(snap_b_id), json!(999_999), Value::Null] {
        let err = run(
            "editor.snapshots.restore",
            json!({ "id": clip_a, "snapshot_id": bad_snap }),
        )
        .unwrap_err();
        assert_eq!(err.code, "snapshot_missing");
    }

    // Estado do Corte A permanece inalterado.
    let state_a_after = call(
        "editor.open",
        json!({ "source_id": source, "start_id": 2, "end_id": 6 }),
    );
    assert_eq!(state_a_after["startUs"], state_a_before["startUs"]);
    assert_eq!(state_a_after["endUs"], state_a_before["endUs"]);
    assert_eq!(state_a_after["revision"], state_a_before["revision"]);
    assert_eq!(state_a_after["undoCount"], state_a_before["undoCount"]);
    assert_eq!(state_a_after["redoCount"], state_a_before["redoCount"]);
}

#[test]
fn editor_snapshots_restore_migrates_v1_snapshot_document() {
    let mut guard = SessionGuard::new();
    guard.create_project("RestoreV1Snapshot");
    let source = seed_source_with_transcript();

    let v1_doc = json!({
        "schemaVersion": 1,
        "revision": 3,
        "original": { "source_id": source, "start_id": 3, "end_id": 7 },
        "range": { "startId": 3, "endId": 7, "startUs": 20_000_000, "endUs": 70_000_000 },
        "undo": [{ "startId": 3, "endId": 6, "startUs": 20_000_000, "endUs": 60_000_000 }],
        "redo": []
    });
    let (clip_id, v1_snap_id) = with_writer(|c| {
        c.execute(
            "INSERT INTO clip_edits(identity,document) VALUES (?1,?2)",
            (format!("source:{source}:3:7"), v1_doc.to_string()),
        )?;
        let clip_id = c.last_insert_rowid();
        c.execute(
            "INSERT INTO clip_snapshots(clip_id,document) VALUES (?1,?2)",
            (clip_id, v1_doc.to_string()),
        )?;
        let snap_id = c.last_insert_rowid();
        Ok((clip_id, snap_id))
    })
    .unwrap();

    // Edita o Corte já aberto (migrado para v2) antes de restaurar o snapshot v1.
    let edited = call(
        "editor.adjust",
        json!({ "clip_id": clip_id, "edge": "end", "sentence_delta": 1 }),
    );
    assert_eq!(edited["endUs"], 80_000_000);
    let rev_before = edited["revision"].as_u64().unwrap();

    let snaps = call("editor.snapshots", json!({ "clip_id": clip_id }));
    assert_eq!(snaps[0]["schemaVersion"], 2);
    assert_eq!(snaps[0]["snapshot_id"], v1_snap_id);

    let restored = call(
        "editor.snapshots.restore",
        json!({ "id": clip_id, "snapshot_id": v1_snap_id }),
    );
    assert_eq!(restored["schemaVersion"], 2);
    assert_eq!(restored["startUs"], 20_000_000);
    assert_eq!(restored["endUs"], 70_000_000);
    assert!(restored["revision"].as_u64().unwrap() > rev_before);

    let undone = call("editor.undo", json!({ "clip_id": clip_id }));
    assert_eq!(undone["endUs"], 80_000_000);
    let redone = call("editor.redo", json!({ "clip_id": clip_id }));
    assert_eq!(redone["endUs"], 70_000_000);
}

#[test]
fn v1_project_fixture_still_opens_cleanly() {
    let mut guard = SessionGuard::new();
    let dir = guard.open_v1_fixture("AntigoSnapshots");
    let current = call("projects.current", json!({}));
    assert_eq!(current["name"], "Antigo");

    call("projects.close", json!({}));
    let conn = Connection::open(dir.join("project.sqlite")).unwrap();
    let integrity: String = conn
        .query_row("PRAGMA integrity_check", [], |r| r.get(0))
        .unwrap();
    assert_eq!(integrity, "ok");
}
