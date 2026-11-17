use clipes_core::dispatch;
use serde_json::json;
use sha2::{Digest, Sha256};

static ENV_LOCK: std::sync::Mutex<()> = std::sync::Mutex::new(());

struct EnvGuard {
    _lock: std::sync::MutexGuard<'static, ()>,
    prev: Option<std::ffi::OsString>,
}

impl EnvGuard {
    fn set(dir: &std::path::Path) -> Self {
        let lock = ENV_LOCK.lock().unwrap_or_else(|e| e.into_inner());
        let prev = std::env::var_os("CLIPES_DATA_DIR");
        std::env::set_var("CLIPES_DATA_DIR", dir);
        Self { _lock: lock, prev }
    }
}

impl Drop for EnvGuard {
    fn drop(&mut self) {
        match self.prev.take() {
            Some(v) => std::env::set_var("CLIPES_DATA_DIR", v),
            None => std::env::remove_var("CLIPES_DATA_DIR"),
        }
    }
}

#[test]
fn diagnostic_never_echoes_unlisted_input() {
    let root = tempfile::tempdir().unwrap();
    let _guard = EnvGuard::set(root.path());
    let result = dispatch("diagnostic.get", json!({"secret":"PRIVATE-KEY", "path":"C:/Users/Alice/private.mp4", "transcript":"PRIVATE-TEXT"}), &mut |_| {}).unwrap();
    let text = result.to_string();
    assert!(!text.contains("PRIVATE"));
    assert!(!text.contains("Alice"));
    assert!(text.contains("indisponível"));
    assert!(text.contains(env!("CARGO_PKG_VERSION")));
}

#[test]
fn export_rejects_invalid_destinations() {
    let dir = std::env::temp_dir();
    for path in [
        dir.join("diagnostic.json"),
        dir.join("relative").join(".."),
        std::path::PathBuf::from("relative.txt"),
    ] {
        let err = dispatch(
            "diagnostic.export",
            json!({"path":path,"text":"diagnostic"}),
            &mut |_| {},
        )
        .unwrap_err();
        assert_eq!(err.code, "invalid_path");
        assert_eq!(err.message, "Caminho inválido");
    }
}

#[test]
fn diagnostic_never_leaks_transcript_words_after_export_glyph_missing() {
    let root = tempfile::tempdir().unwrap();
    let data = root.path().join("data");
    std::fs::create_dir_all(&data).unwrap();
    let _guard = EnvGuard::set(&data);
    dispatch(
        "projects.create",
        json!({"parent": root.path(), "name": "DiagGlifo"}),
        &mut |_| {},
    )
    .unwrap();
    let media = root.path().join("original.mp4");
    std::fs::write(&media, b"original").unwrap();
    let mut hash = Sha256::new();
    for _ in 0..3 {
        hash.update(b"original");
    }
    let partial_hash = format!("{:x}", hash.finalize());
    let source = clipes_core::projects::with_writer(|c| {
        c.execute(
            "INSERT INTO sources(path,size,duration_us,partial_hash,metadata,permission,audio_track) VALUES (?1,8,2000000,?2,'{}','{}',1)",
            (media.to_str().unwrap(), &partial_hash),
        )?;
        let source = c.last_insert_rowid();
        c.execute(
            "INSERT INTO transcripts(source_id,audio_track,engine,model,revision,compute_type,state,duration_us) VALUES (?1,1,'local','m','r','c','complete',2000000)",
            [source],
        )?;
        let transcript = c.last_insert_rowid();
        c.execute(
            "INSERT INTO transcript_words(transcript_id,position,kind,text,start_us,end_us,language) VALUES (?1,0,'word',' SEGREDO来',0,500000,'pt')",
            [transcript],
        )?;
        Ok(source)
    })
    .unwrap();
    dispatch(
        "transcription.segment",
        json!({"source_id": source}),
        &mut |_| {},
    )
    .unwrap();
    let err = dispatch(
        "export.start",
        json!({"source_id": source, "start_id": 1, "end_id": 1, "output": root.path().join("out.mp4")}),
        &mut |_| {},
    )
    .unwrap_err();
    assert_eq!(err.code, "export_glyph_missing");

    let text = dispatch("diagnostic.get", json!({}), &mut |_| {})
        .unwrap()
        .to_string();
    assert!(!text.contains("SEGREDO"), "{text}");
    assert!(!text.contains('来'), "{text}");
    assert!(!text.contains("U+6765"), "{text}");
    dispatch("projects.close", json!({}), &mut |_| {}).unwrap();
}
