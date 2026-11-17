//! Testes headless do catálogo remoto assinado (#256):
//! - fallback offline para o catálogo embutido;
//! - atualização via manifesto remoto assinado com Ed25519 (par de chaves de teste);
//! - rejeição de assinatura inválida, arquivo adulterado e rollback (anti-rollback);
//! - atualização de modelos instalados (transcrição e TTS) com confirmação explícita e
//!   validação SHA-256 em servidor HTTP loopback (sem rede real) e `CLIPES_DATA_DIR` isolado.

use clipes_core::dispatch;
use ed25519_dalek::{Signer, SigningKey, VerifyingKey};
use rand::RngCore;
use serde_json::{json, Value};
use sha2::{Digest, Sha256};
use std::{
    collections::HashMap,
    fs,
    io::{Read, Write},
    net::TcpListener,
    path::Path,
    sync::Mutex,
    thread,
    time::Duration,
};

static SERIAL: Mutex<()> = Mutex::new(());
const FAKE_WORKER: &str = env!("CARGO_BIN_EXE_fake-worker");

fn call(name: &str, args: Value) -> Value {
    dispatch(name, args, &mut |_| {}).unwrap()
}

fn sha256_hex(bytes: &[u8]) -> String {
    format!("{:x}", Sha256::digest(bytes))
}

fn test_keypair() -> (SigningKey, String) {
    let mut seed = [0u8; 32];
    rand::thread_rng().fill_bytes(&mut seed);
    let signing = SigningKey::from_bytes(&seed);
    let verifying: VerifyingKey = signing.verifying_key();
    let mut pub_hex = String::with_capacity(64);
    for b in verifying.to_bytes() {
        use std::fmt::Write;
        let _ = write!(&mut pub_hex, "{b:02x}");
    }
    (signing, pub_hex)
}

fn sign_hex(signing: &SigningKey, payload: &[u8]) -> Vec<u8> {
    let sig = signing.sign(payload);
    let mut hex = String::with_capacity(129);
    for b in sig.to_bytes() {
        use std::fmt::Write;
        let _ = write!(&mut hex, "{b:02x}");
    }
    hex.push('\n');
    hex.into_bytes()
}

fn spawn_http_map(
    build: impl FnOnce(&str) -> Vec<(String, Vec<u8>)>,
) -> (String, thread::JoinHandle<()>) {
    let listener = TcpListener::bind("127.0.0.1:0").unwrap();
    let addr = listener.local_addr().unwrap();
    let base = format!("http://{addr}");
    let routes: HashMap<String, Vec<u8>> = build(&base).into_iter().collect();
    let count = routes.len();
    let handle = thread::spawn(move || {
        for _ in 0..count {
            let (mut stream, _) = listener.accept().unwrap();
            stream.set_nonblocking(false).unwrap();
            stream
                .set_read_timeout(Some(Duration::from_secs(3)))
                .unwrap();
            let mut req = Vec::new();
            while !req.ends_with(b"\r\n\r\n") {
                let mut byte = [0u8; 1];
                stream.read_exact(&mut byte).unwrap();
                req.push(byte[0]);
            }
            let first = String::from_utf8_lossy(&req);
            let path = first
                .lines()
                .next()
                .and_then(|l| l.split_whitespace().nth(1))
                .unwrap_or("/");
            let (status, body) = match routes.get(path) {
                Some(b) => ("200 OK", b.as_slice()),
                None => ("404 Not Found", b"".as_slice()),
            };
            let header = format!(
                "HTTP/1.1 {status}\r\nContent-Length: {}\r\nConnection: close\r\n\r\n",
                body.len()
            );
            stream.write_all(header.as_bytes()).unwrap();
            stream.write_all(body).unwrap();
        }
    });
    (base, handle)
}

fn read_embedded_catalog() -> Value {
    let raw = fs::read_to_string(
        Path::new(env!("CARGO_MANIFEST_DIR"))
            .parent()
            .unwrap()
            .join("catalog/models.json"),
    )
    .unwrap();
    serde_json::from_str(&raw).unwrap()
}

fn seed_installed_worker_and_models(data_dir: &Path, small_rev: &str, tts_rev: &str) {
    let uv_ver = call("components.manifest", json!({}))
        .as_array()
        .unwrap()
        .iter()
        .find(|c| c["id"] == "uv")
        .unwrap()["version"]
        .as_str()
        .unwrap()
        .to_owned();
    let worker_dir = data_dir.join("worker");
    fs::create_dir_all(worker_dir.join("venv")).unwrap();
    let py = if cfg!(windows) {
        worker_dir.join("venv/Scripts/python.exe")
    } else {
        worker_dir.join("venv/bin/python")
    };
    fs::create_dir_all(py.parent().unwrap()).unwrap();
    fs::write(&py, b"fake-python").unwrap();

    // Obtém o mesmo lock_sha256 e files_sha256 usados por components::worker via estado real:
    // usa fake-worker como uv para instalar worker e gerar worker.state.json válido.
    let comp_dir = data_dir.join("components");
    fs::create_dir_all(&comp_dir).unwrap();
    let uv_exe = comp_dir.join(if cfg!(windows) { "uv.exe" } else { "uv" });
    fs::copy(FAKE_WORKER, &uv_exe).unwrap();
    fs::write(comp_dir.join("uv.version"), uv_ver).unwrap();
    call("components.worker.install", json!({"confirmed": true}));

    let small_dir = data_dir.join("models/whisper-small");
    fs::create_dir_all(&small_dir).unwrap();
    fs::write(small_dir.join("model.bin"), b"old-small-weights").unwrap();
    fs::write(
        small_dir.join("model.state.json"),
        serde_json::to_vec(&json!({"revision": small_rev})).unwrap(),
    )
    .unwrap();

    let tts_cat = call("tts.catalog", json!({}));
    let terms_ver = tts_cat["engines"][0]["prohibitedUse"]["version"]
        .as_str()
        .unwrap()
        .to_owned();
    let tts_dir = data_dir.join("tts-models/pocket-tts/portuguese_24l");
    fs::create_dir_all(tts_dir.join("voices")).unwrap();
    fs::write(tts_dir.join("model.safetensors"), b"old-tts-weights").unwrap();
    fs::write(tts_dir.join("tokenizer.json"), b"{}").unwrap();
    fs::write(
        tts_dir.join("config.yaml"),
        b"weights_path: 'model.safetensors'\n",
    )
    .unwrap();
    fs::write(
        tts_dir.join("voices/13063-pt-24l.safetensors"),
        b"old-voice-weights",
    )
    .unwrap();
    fs::write(
        tts_dir.join("model.state.json"),
        serde_json::to_vec(&json!({
            "engine": "pocket-tts",
            "id": "portuguese_24l",
            "revision": tts_rev,
            "terms_version": terms_ver,
        }))
        .unwrap(),
    )
    .unwrap();
}

#[test]
fn signed_remote_catalog_updates_models_rejects_invalid_and_falls_back_offline() {
    let _guard = SERIAL.lock().unwrap_or_else(|e| e.into_inner());
    let root = tempfile::tempdir().unwrap();
    let data_dir = root.path().join("data");
    std::env::set_var("CLIPES_DATA_DIR", &data_dir);
    std::env::remove_var("CLIPES_TEST_CATALOG_URL");
    std::env::remove_var("CLIPES_TEST_CATALOG_PUBKEY");
    std::env::remove_var("CLIPES_TEST_MODEL_BASE_URL");

    // 1. Offline fallback: sem catálogo remoto, usa o embutido (v1).
    let status = call("components.catalog.status", json!({}));
    assert_eq!(status["version"], 1);
    assert_eq!(status["source"], "embedded");
    assert!(status["warning"].is_null());

    let embedded_models = call("components.models.manifest", json!({}));
    let small_v1_rev = embedded_models
        .as_array()
        .unwrap()
        .iter()
        .find(|m| m["id"] == "whisper-small")
        .unwrap()["revision"]
        .as_str()
        .unwrap()
        .to_owned();
    let embedded_tts = call("tts.catalog", json!({}));
    let tts_v1_rev = embedded_tts["models"]
        .as_array()
        .unwrap()
        .iter()
        .find(|m| m["id"] == "portuguese_24l")
        .unwrap()["revision"]
        .as_str()
        .unwrap()
        .to_owned();

    seed_installed_worker_and_models(&data_dir, &small_v1_rev, &tts_v1_rev);

    // 2. Assinatura inválida (chave errada) é recusada e mantém fallback offline.
    let (signing, pub_hex) = test_keypair();
    let (other_signing, _) = test_keypair();
    std::env::set_var("CLIPES_TEST_CATALOG_PUBKEY", &pub_hex);

    let mut v2 = read_embedded_catalog();
    let small_v2_rev = "2222222222222222222222222222222222222222";
    let tts_v2_rev = "3333333333333333333333333333333333333333";
    let small_cfg = b"{\"v\":2}";
    let small_bin = b"new-small-weights-v2";
    let small_tok = b"{\"tok\":2}";
    let small_voc = b"voc-v2";
    let tts_weights = b"new-tts-weights-v2";
    let tts_tok = b"{\"tts_tok\":2}";
    let tts_voice = b"new-voice-v2";

    v2["version"] = json!(2);
    let models_arr = v2["models"].as_array_mut().unwrap();
    let small_obj = models_arr
        .iter_mut()
        .find(|m| m["id"] == "whisper-small")
        .unwrap();
    small_obj["revision"] = json!(small_v2_rev);
    small_obj["files"] = json!([
        {"name": "config.json", "size": small_cfg.len(), "sha256": sha256_hex(small_cfg)},
        {"name": "model.bin", "size": small_bin.len(), "sha256": sha256_hex(small_bin)},
        {"name": "tokenizer.json", "size": small_tok.len(), "sha256": sha256_hex(small_tok)},
        {"name": "vocabulary.txt", "size": small_voc.len(), "sha256": sha256_hex(small_voc)},
    ]);

    let tts_models_arr = v2["tts"]["models"].as_array_mut().unwrap();
    let pt24_obj = tts_models_arr
        .iter_mut()
        .find(|m| m["id"] == "portuguese_24l")
        .unwrap();
    pt24_obj["revision"] = json!(tts_v2_rev);
    pt24_obj["files"] = json!([
        {
            "name": "model.safetensors",
            "url": format!("https://huggingface.co/kyutai/pocket-tts-without-voice-cloning/resolve/{tts_v2_rev}/languages/portuguese_24l/model.safetensors"),
            "size": tts_weights.len(),
            "sha256": sha256_hex(tts_weights),
        },
        {
            "name": "tokenizer.json",
            "url": format!("https://huggingface.co/kyutai/pocket-tts-without-voice-cloning/resolve/{tts_v2_rev}/languages/portuguese_24l/tokenizer.json"),
            "size": tts_tok.len(),
            "sha256": sha256_hex(tts_tok),
        }
    ]);
    v2["tts"]["voices"][0]["embeddings"][0]["size"] = json!(tts_voice.len());
    v2["tts"]["voices"][0]["embeddings"][0]["sha256"] = json!(sha256_hex(tts_voice));

    let v2_bytes = serde_json::to_vec(&v2).unwrap();
    let bad_sig = sign_hex(&other_signing, &v2_bytes);
    let (bad_base, h_bad) = spawn_http_map(|base| {
        let releases = serde_json::to_vec(&json!([{
            "tag_name": "catalog-2",
            "draft": false,
            "assets": [
                {"name": "catalog.json", "browser_download_url": format!("{base}/catalog.json")},
                {"name": "catalog.json.sig", "browser_download_url": format!("{base}/catalog.json.sig")},
            ]
        }]))
        .unwrap();
        vec![
            ("/releases".into(), releases),
            ("/catalog.json".into(), v2_bytes.clone()),
            ("/catalog.json.sig".into(), bad_sig),
        ]
    });
    std::env::set_var("CLIPES_TEST_CATALOG_URL", &bad_base);
    let err = dispatch("components.catalog.check", json!({}), &mut |_| {}).unwrap_err();
    h_bad.join().unwrap();
    assert_eq!(err.code, "catalog_signature_invalid");
    assert_eq!(
        call("components.catalog.status", json!({}))["source"],
        "embedded"
    );

    // 3. Manifesto válido assinado com a chave esperada atualiza ambos os catálogos.
    let good_sig = sign_hex(&signing, &v2_bytes);
    let (good_base, h_good) = spawn_http_map(|base| {
        let releases = serde_json::to_vec(&json!([{
            "tag_name": "catalog-2",
            "draft": false,
            "assets": [
                {"name": "catalog.json", "browser_download_url": format!("{base}/catalog.json")},
                {"name": "catalog.json.sig", "browser_download_url": format!("{base}/catalog.json.sig")},
            ]
        }]))
        .unwrap();
        vec![
            ("/releases".into(), releases),
            ("/catalog.json".into(), v2_bytes.clone()),
            ("/catalog.json.sig".into(), good_sig),
        ]
    });
    std::env::set_var("CLIPES_TEST_CATALOG_URL", &good_base);
    let checked = call("components.catalog.check", json!({}));
    h_good.join().unwrap();
    assert_eq!(checked["version"], 2);
    assert_eq!(checked["updated"], true);
    assert_eq!(checked["source"], "remote");

    let models_v2 = call("components.models.manifest", json!({}));
    let small_entry = models_v2
        .as_array()
        .unwrap()
        .iter()
        .find(|m| m["id"] == "whisper-small")
        .unwrap();
    assert_eq!(small_entry["revision"], small_v2_rev);
    assert_eq!(small_entry["installed"], true);
    assert_eq!(small_entry["installed_revision"], small_v1_rev);
    assert_eq!(small_entry["update_available"], true);

    let tts_v2 = call("tts.catalog", json!({}));
    assert_eq!(tts_v2["catalogVersion"], 2);
    let pt24_entry = tts_v2["models"]
        .as_array()
        .unwrap()
        .iter()
        .find(|m| m["id"] == "portuguese_24l")
        .unwrap();
    assert_eq!(pt24_entry["revision"], tts_v2_rev);
    assert_eq!(pt24_entry["installed"], true);
    assert_eq!(pt24_entry["updateAvailable"], true);

    // 4. Download de atualização exige confirmação e valida SHA-256:
    //    sem confirmação falha com `confirmation_required`; hash divergente falha com
    //    `hash_mismatch` e preserva o modelo antigo intacto.
    let unconfirmed = dispatch(
        "components.models.download",
        json!({"id": "whisper-small", "confirmed": false}),
        &mut |_| {},
    )
    .unwrap_err();
    assert_eq!(unconfirmed.code, "confirmation_required");

    let (bad_dl_base, h_bad_dl) =
        spawn_http_map(|_| vec![("/whisper-small/config.json".into(), b"corrupted".to_vec())]);
    std::env::set_var("CLIPES_TEST_MODEL_BASE_URL", &bad_dl_base);
    let dl_err = dispatch(
        "components.models.download",
        json!({"id": "whisper-small", "confirmed": true}),
        &mut |_| {},
    )
    .unwrap_err();
    h_bad_dl.join().unwrap();
    assert_eq!(dl_err.code, "hash_mismatch");
    assert_eq!(
        fs::read(data_dir.join("models/whisper-small/model.bin")).unwrap(),
        b"old-small-weights"
    );

    // Download válido do whisper-small e do portuguese_24l atualiza revisão e arquivos.
    let (dl_base, h_dl) = spawn_http_map(|_| {
        vec![
            ("/whisper-small/config.json".into(), small_cfg.to_vec()),
            ("/whisper-small/model.bin".into(), small_bin.to_vec()),
            ("/whisper-small/tokenizer.json".into(), small_tok.to_vec()),
            ("/whisper-small/vocabulary.txt".into(), small_voc.to_vec()),
            (
                "/tts/portuguese_24l/model.safetensors".into(),
                tts_weights.to_vec(),
            ),
            (
                "/tts/portuguese_24l/tokenizer.json".into(),
                tts_tok.to_vec(),
            ),
            (
                "/tts/portuguese_24l/13063-pt-24l.safetensors".into(),
                tts_voice.to_vec(),
            ),
        ]
    });
    std::env::set_var("CLIPES_TEST_MODEL_BASE_URL", &dl_base);
    call(
        "components.models.download",
        json!({"id": "whisper-small", "confirmed": true}),
    );
    call(
        "tts.models.download",
        json!({"id": "portuguese_24l", "confirmed": true, "termsAccepted": true}),
    );
    h_dl.join().unwrap();

    let after_models = call("components.models.manifest", json!({}));
    let small_after = after_models
        .as_array()
        .unwrap()
        .iter()
        .find(|m| m["id"] == "whisper-small")
        .unwrap();
    assert_eq!(small_after["installed"], true);
    assert_eq!(small_after["installed_revision"], small_v2_rev);
    assert_eq!(small_after["update_available"], false);
    assert_eq!(
        fs::read(data_dir.join("models/whisper-small/model.bin")).unwrap(),
        small_bin
    );

    let after_tts = call("tts.catalog", json!({}));
    let pt24_after = after_tts["models"]
        .as_array()
        .unwrap()
        .iter()
        .find(|m| m["id"] == "portuguese_24l")
        .unwrap();
    assert_eq!(pt24_after["installed"], true);
    assert_eq!(pt24_after["installedRevision"], tts_v2_rev);
    assert_eq!(pt24_after["updateAvailable"], false);

    // 5. Anti-rollback via dispatch: versão menor que a ativa (v2 -> v1) é recusada.
    let (rb_base, h_rb) = spawn_http_map(|_| {
        let releases = serde_json::to_vec(&json!([{
            "tag_name": "catalog-1",
            "draft": false,
            "assets": []
        }]))
        .unwrap();
        vec![("/releases".into(), releases)]
    });
    std::env::set_var("CLIPES_TEST_CATALOG_URL", &rb_base);
    let rb_err = dispatch("components.catalog.check", json!({}), &mut |_| {}).unwrap_err();
    h_rb.join().unwrap();
    assert_eq!(rb_err.code, "catalog_rollback");
    assert_eq!(call("components.catalog.status", json!({}))["version"], 2);

    // 6. Cache adulterado no disco cai automaticamente para o catálogo embutido com aviso.
    fs::write(data_dir.join("catalog/catalog.json"), b"{\"version\":99}").unwrap();
    let tampered_status = call("components.catalog.status", json!({}));
    assert_eq!(tampered_status["version"], 1);
    assert_eq!(tampered_status["source"], "embedded");
    assert_eq!(tampered_status["warningCode"], "catalog_signature_invalid");
    assert!(tampered_status["warning"].is_string());

    let fallback_models = call("components.models.manifest", json!({}));
    let small_fallback = fallback_models
        .as_array()
        .unwrap()
        .iter()
        .find(|m| m["id"] == "whisper-small")
        .unwrap();
    assert_eq!(small_fallback["revision"], small_v1_rev);

    std::env::remove_var("CLIPES_TEST_CATALOG_URL");
    std::env::remove_var("CLIPES_TEST_CATALOG_PUBKEY");
    std::env::remove_var("CLIPES_TEST_MODEL_BASE_URL");
}
