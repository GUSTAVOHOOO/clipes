use clipes_core::{dispatch, media, projects, CoreError};
use serde_json::json;
use sha2::{Digest, Sha256};
use std::{
    ffi::OsString,
    fs,
    path::{Path, PathBuf},
    sync::{Mutex, MutexGuard},
};
use tempfile::TempDir;

static ENV_LOCK: Mutex<()> = Mutex::new(());

struct EnvGuard {
    _lock: MutexGuard<'static, ()>,
    previous_data_dir: Option<OsString>,
}

impl EnvGuard {
    fn set_data_dir(dir: &Path) -> Self {
        let lock = ENV_LOCK.lock().unwrap_or_else(|e| e.into_inner());
        let previous_data_dir = std::env::var_os("CLIPES_DATA_DIR");
        std::env::set_var("CLIPES_DATA_DIR", dir);
        Self {
            _lock: lock,
            previous_data_dir,
        }
    }
}

impl Drop for EnvGuard {
    fn drop(&mut self) {
        let _ = dispatch("projects.close", json!({}), &mut |_| {});
        match self.previous_data_dir.take() {
            Some(v) => std::env::set_var("CLIPES_DATA_DIR", v),
            None => std::env::remove_var("CLIPES_DATA_DIR"),
        }
    }
}

fn partial_hash_for_small_file(bytes: &[u8]) -> (i64, String) {
    let mut hash = Sha256::new();
    for _ in 0..3 {
        hash.update(bytes);
    }
    (bytes.len() as i64, format!("{:x}", hash.finalize()))
}

struct Fixture {
    _env: EnvGuard,
    _root: TempDir,
    cache_dir: PathBuf,
    project_path: String,
    source_id: i64,
    waveform_bytes: Vec<u8>,
    thumb_bytes: Vec<Vec<u8>>,
}

fn setup_fixture() -> Fixture {
    let root = tempfile::tempdir().unwrap();
    let env = EnvGuard::set_data_dir(&root.path().join("data"));
    let cache_dir = root.path().join("cache");

    dispatch(
        "components.settings.set",
        json!({
            "data_dir": root.path().join("data"),
            "cache_dir": cache_dir,
            "cache_limit_bytes": 10_000_000u64,
        }),
        &mut |_| {},
    )
    .unwrap();

    let project = dispatch(
        "projects.create",
        json!({"parent": root.path(), "name": "CanalPreview"}),
        &mut |_| {},
    )
    .unwrap();
    let project_path = project["path"].as_str().unwrap().to_owned();
    let proj_dir = PathBuf::from(&project_path);

    let media_dir = proj_dir.join("media");
    fs::create_dir_all(&media_dir).unwrap();
    let source_bytes = b"dummy-video-source-bytes";
    let source_file = media_dir.join("live.mp4");
    fs::write(&source_file, source_bytes).unwrap();

    let (size, hash) = partial_hash_for_small_file(source_bytes);
    let audio_track = 1i64;
    let metadata = json!({
        "streams": [
            {"index": 0, "codec_type": "video"},
            {"index": 1, "codec_type": "audio", "channels": 2}
        ]
    })
    .to_string();

    let source_id: i64 = projects::with_writer(|c| {
        c.execute(
            "INSERT INTO sources (path, size, duration_us, partial_hash, metadata, permission, audio_track) VALUES (?1, ?2, 10000000, ?3, ?4, '{}', ?5)",
            rusqlite::params![source_file.to_string_lossy().as_ref(), size, hash, metadata, audio_track],
        )?;
        Ok(c.last_insert_rowid())
    })
    .unwrap();

    let preview_dir = cache_dir
        .join("previews")
        .join(format!("{hash}-{audio_track}"));
    fs::create_dir_all(&preview_dir).unwrap();
    let waveform_bytes = b"CLPWAVE\0waveform-payload-0123456789".to_vec();
    fs::write(preview_dir.join("waveform.bin"), &waveform_bytes).unwrap();

    let thumb_bytes = vec![
        b"\xff\xd8\xff\xe0thumb-zero-bytes".to_vec(),
        b"\xff\xd8\xff\xe0thumb-one-bytes".to_vec(),
    ];
    fs::write(preview_dir.join("thumb-00000001.jpg"), &thumb_bytes[0]).unwrap();
    fs::write(preview_dir.join("thumb-00000002.jpg"), &thumb_bytes[1]).unwrap();

    Fixture {
        _env: env,
        _root: root,
        cache_dir,
        project_path,
        source_id,
        waveform_bytes,
        thumb_bytes,
    }
}

fn assert_opaque_key(key: &str, cache_dir: &Path) {
    assert!(!key.is_empty(), "empty key");
    assert_eq!(
        key.matches('/').count(),
        1,
        "key must have only type/id separator: {key}"
    );
    assert!(!key.contains('\\'), "backslash in key: {key}");
    assert!(!key.contains(':'), "drive/colon in key: {key}");
    assert!(!key.contains(".."), "traversal in key: {key}");
    let cache_str = cache_dir.to_string_lossy();
    assert!(
        !key.contains(cache_str.as_ref()),
        "cache dir leaked into key: {key}"
    );
}

#[test]
fn jobs_preview_accepts_source_id_camel_and_snake_and_returns_servable_opaque_keys() {
    let fx = setup_fixture();

    let by_snake = dispatch(
        "jobs.preview",
        json!({"source_id": fx.source_id}),
        &mut |_| {},
    )
    .expect("source_id should work");
    let by_camel = dispatch(
        "jobs.preview",
        json!({"sourceId": fx.source_id}),
        &mut |_| {},
    )
    .expect("sourceId should work");
    let by_both = dispatch(
        "jobs.preview",
        json!({"sourceId": fx.source_id, "source_id": fx.source_id}),
        &mut |_| {},
    )
    .expect("matching sourceId and source_id should work");

    // Retrocompatibilidade: waveform e thumbnails mantêm os caminhos em disco
    let waveform_path = PathBuf::from(by_snake["waveform"].as_str().unwrap());
    assert!(waveform_path.is_file());
    assert_eq!(by_camel["waveform"], by_snake["waveform"]);
    assert_eq!(by_both["waveform"], by_snake["waveform"]);

    let thumbs_snake = by_snake["thumbnails"].as_array().unwrap();
    let thumbs_camel = by_camel["thumbnails"].as_array().unwrap();
    assert_eq!(thumbs_snake.len(), 2);
    assert_eq!(thumbs_camel, thumbs_snake);
    assert_eq!(by_both["thumbnails"].as_array().unwrap(), thumbs_snake);

    // Chaves opacas idênticas para sourceId e source_id
    let waveform_key = by_snake["waveformKey"].as_str().unwrap();
    assert_eq!(by_camel["waveformKey"].as_str().unwrap(), waveform_key);
    assert_eq!(by_both["waveformKey"].as_str().unwrap(), waveform_key);
    assert_opaque_key(waveform_key, &fx.cache_dir);

    let thumb_keys_snake: Vec<&str> = by_snake["thumbnailKeys"]
        .as_array()
        .unwrap()
        .iter()
        .map(|v| v.as_str().unwrap())
        .collect();
    let thumb_keys_camel: Vec<&str> = by_camel["thumbnailKeys"]
        .as_array()
        .unwrap()
        .iter()
        .map(|v| v.as_str().unwrap())
        .collect();
    assert_eq!(thumb_keys_camel, thumb_keys_snake);
    assert_eq!(thumb_keys_snake.len(), thumbs_snake.len());

    // Resolve e serve waveform (HTTP 200 e 206)
    let resolved_wave = media::resolve(waveform_key).expect("waveformKey must resolve");
    assert_eq!(resolved_wave.path, waveform_path.canonicalize().unwrap());

    let wave_200 = media::serve(waveform_key, None);
    assert_eq!(wave_200.status, 200);
    assert_eq!(wave_200.body, fx.waveform_bytes);

    let wave_206 = media::serve(waveform_key, Some("bytes=0-7"));
    assert_eq!(wave_206.status, 206);
    assert_eq!(wave_206.body, b"CLPWAVE\0");

    // Resolve e serve cada thumbnail na mesma ordem de `thumbnails` (HTTP 200 e 206)
    for (idx, (key, path_val)) in thumb_keys_snake.iter().zip(thumbs_snake.iter()).enumerate() {
        assert_opaque_key(key, &fx.cache_dir);
        let expected_path = PathBuf::from(path_val.as_str().unwrap())
            .canonicalize()
            .unwrap();
        let resolved = media::resolve(key).expect("thumbnailKey must resolve");
        assert_eq!(resolved.path, expected_path);
        assert_eq!(resolved.content_type, "image/jpeg");

        let res_200 = media::serve(key, None);
        assert_eq!(res_200.status, 200);
        assert_eq!(res_200.body, fx.thumb_bytes[idx]);

        let res_206 = media::serve(key, Some("bytes=0-3"));
        assert_eq!(res_206.status, 206);
        assert_eq!(res_206.body, &fx.thumb_bytes[idx][..4]);
    }
}

#[test]
fn jobs_preview_rejects_mismatched_and_invalid_inputs() {
    let fx = setup_fixture();

    let mismatch: CoreError = dispatch(
        "jobs.preview",
        json!({"sourceId": fx.source_id, "source_id": fx.source_id + 1}),
        &mut |_| {},
    )
    .unwrap_err();
    assert_eq!(mismatch.code, "invalid_input");

    for bad in [
        json!({}),
        json!({"sourceId": "1"}),
        json!({"source_id": "1"}),
        json!({"sourceId": 0}),
        json!({"source_id": -5}),
    ] {
        let err = dispatch("jobs.preview", bad.clone(), &mut |_| {}).unwrap_err();
        assert_eq!(err.code, "invalid_input", "payload: {bad}");
    }

    let missing = dispatch("jobs.preview", json!({"sourceId": 999}), &mut |_| {});
    assert!(missing.is_err());
}

#[test]
fn media_rejects_traversal_encoding_out_of_range_and_other_source_preview_keys() {
    let fx = setup_fixture();
    let previews = dispatch(
        "jobs.preview",
        json!({"sourceId": fx.source_id}),
        &mut |_| {},
    )
    .unwrap();
    let wave_key = previews["waveformKey"].as_str().unwrap();
    let thumb_key_0 = previews["thumbnailKeys"][0].as_str().unwrap();

    // Índice fora do intervalo
    let prefix = thumb_key_0.rsplit_once('-').unwrap().0;
    for out_of_range in [format!("{prefix}-2"), format!("{prefix}-999")] {
        assert_eq!(media::resolve(&out_of_range), None, "{out_of_range}");
        assert_eq!(media::serve(&out_of_range, None).status, 404);
    }

    // sourceId inexistente no Projeto aberto
    let nonexistent_wave = wave_key.replace(&fx.source_id.to_string(), "9999");
    let nonexistent_thumb = format!("preview-thumb/9999-0");
    assert_eq!(media::resolve(&nonexistent_wave), None);
    assert_eq!(media::serve(&nonexistent_wave, None).status, 404);
    assert_eq!(media::resolve(&nonexistent_thumb), None);
    assert_eq!(media::serve(&nonexistent_thumb, None).status, 404);

    // Entradas maliciosas (travessia, encoding, barra extra, extensão)
    for bad in [
        "preview-waveform/",
        "preview-waveform/0",
        "preview-waveform/-1",
        "preview-waveform/..",
        "preview-waveform/../1",
        "preview-waveform/1/extra",
        "preview-waveform/1.bin",
        "preview-waveform/%2e%2e",
        "preview-waveform/1%2Fextra",
        "preview-waveform/1%2f..",
        "preview-thumb/",
        "preview-thumb/1",
        "preview-thumb/1-",
        "preview-thumb/1--1",
        "preview-thumb/1-0-2",
        "preview-thumb/1-0.jpg",
        "preview-thumb/1-0/extra",
        "preview-thumb/1-%2e%2e",
        "preview-thumb/%2e%2e-0",
        "preview-thumb/1%2F0",
    ] {
        assert_eq!(media::resolve(bad), None, "{bad}");
        assert_eq!(media::serve(bad, None).status, 404, "{bad}");
    }

    // Ao fechar o Projeto, as prévias não devem mais ser servidas
    dispatch("projects.close", json!({}), &mut |_| {}).unwrap();
    assert_eq!(media::resolve(wave_key), None);
    assert_eq!(media::serve(wave_key, None).status, 404);
    assert_eq!(media::resolve(thumb_key_0), None);
    assert_eq!(media::serve(thumb_key_0, None).status, 404);

    // Reabre outro Projeto sem essa Fonte -> continua recusando
    let other_parent = fx._root.path().join("other");
    fs::create_dir_all(&other_parent).unwrap();
    dispatch(
        "projects.create",
        json!({"parent": other_parent, "name": "OutroCanal"}),
        &mut |_| {},
    )
    .unwrap();
    assert_eq!(media::resolve(wave_key), None);
    assert_eq!(media::serve(wave_key, None).status, 404);
    assert_eq!(media::resolve(thumb_key_0), None);
    assert_eq!(media::serve(thumb_key_0, None).status, 404);

    let _ = &fx.project_path;
}
