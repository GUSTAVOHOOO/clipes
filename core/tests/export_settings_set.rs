//! Contrato de `export.settings.set` e leitura posterior via `export.settings` (#303).
use clipes_core::{dispatch, CoreError};
use serde_json::{json, Value};
use std::{
    ffi::OsString,
    fs,
    path::Path,
    sync::{Mutex, MutexGuard},
};

static TEST_LOCK: Mutex<()> = Mutex::new(());

struct DataDirGuard {
    _lock: MutexGuard<'static, ()>,
    prev_data_dir: Option<OsString>,
    _tmp: tempfile::TempDir,
}

impl DataDirGuard {
    fn new() -> Self {
        let lock = TEST_LOCK.lock().unwrap_or_else(|e| e.into_inner());
        let tmp = tempfile::tempdir().unwrap();
        let prev_data_dir = std::env::var_os("CLIPES_DATA_DIR");
        std::env::set_var("CLIPES_DATA_DIR", tmp.path().join("data"));
        Self {
            _lock: lock,
            prev_data_dir,
            _tmp: tmp,
        }
    }

    fn root(&self) -> &Path {
        self._tmp.path()
    }
}

impl Drop for DataDirGuard {
    fn drop(&mut self) {
        match self.prev_data_dir.take() {
            Some(v) => std::env::set_var("CLIPES_DATA_DIR", v),
            None => std::env::remove_var("CLIPES_DATA_DIR"),
        }
    }
}

fn call(name: &str, args: Value) -> Value {
    dispatch(name, args, &mut |_| {}).unwrap()
}

fn fail(name: &str, args: Value) -> CoreError {
    dispatch(name, args, &mut |_| {}).unwrap_err()
}

#[test]
fn export_settings_set_persists_valid_directory_and_rejects_invalid_without_overwriting() {
    let guard = DataDirGuard::new();

    assert_eq!(
        call("export.settings", json!({}))["last_directory"],
        Value::Null
    );

    let dir_a = guard.root().join("saidas_a");
    let dir_b = guard.root().join("saidas_b");
    fs::create_dir_all(&dir_a).unwrap();
    fs::create_dir_all(&dir_b).unwrap();

    // Aceita snake_case `last_directory`
    let saved_a = call("export.settings.set", json!({ "last_directory": dir_a }));
    assert_eq!(saved_a["last_directory"], json!(dir_a));
    assert_eq!(
        call("export.settings", json!({}))["last_directory"],
        json!(dir_a)
    );

    // Aceita camelCase `lastDirectory`
    let saved_b = call("export.settings.set", json!({ "lastDirectory": dir_b }));
    assert_eq!(saved_b["last_directory"], json!(dir_b));
    assert_eq!(
        call("export.settings", json!({}))["last_directory"],
        json!(dir_b)
    );

    // Recusa pasta inexistente, arquivo comum, caminho relativo e entradas vazias sem sobrescrever `dir_b`.
    let missing_dir = guard.root().join("nao_existe");
    let regular_file = guard.root().join("arquivo.txt");
    fs::write(&regular_file, b"conteudo").unwrap();

    for invalid_payload in [
        json!({ "last_directory": missing_dir }),
        json!({ "lastDirectory": missing_dir }),
        json!({ "last_directory": regular_file }),
        json!({ "last_directory": "pasta/relativa" }),
        json!({ "last_directory": "" }),
        json!({ "last_directory": "   " }),
        json!({ "last_directory": null }),
        json!({}),
    ] {
        let err = fail("export.settings.set", invalid_payload);
        assert_eq!(err.code, "export_destination", "{err:?}");
        assert_eq!(
            call("export.settings", json!({}))["last_directory"],
            json!(dir_b),
            "pasta inválida não pode sobrescrever a preferência já salva"
        );
    }
}
