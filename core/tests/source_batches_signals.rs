//! Sincronização de `energy` e `chat` antes da Seleção no Lote de Fontes (#252), headless e
//! sem rede: worker, FFmpeg, yt-dlp e Provedor falsos, dados isolados em CLIPES_DATA_DIR. Um
//! corpo de teste só: variáveis de ambiente, Projeto aberto e Provedor injetado são do processo.
use clipes_core::{
    dispatch, jobs,
    projects::with_writer,
    provider::{cost::Target, CancelToken, Provider, StructuredRequest},
    CoreError,
};
use serde_json::{json, Value};
use sha2::{Digest, Sha256};
use std::{
    fs,
    path::{Path, PathBuf},
    process::Command,
    sync::{
        atomic::{AtomicUsize, Ordering},
        Arc,
    },
    time::{Duration, Instant},
};

const FAKE_WORKER: &str = env!("CARGO_BIN_EXE_fake-worker");

fn call(name: &str, args: Value) -> Value {
    dispatch(name, args, &mut |_| {}).unwrap()
}

fn exe(name: &str) -> String {
    format!("{name}{}", std::env::consts::EXE_SUFFIX)
}

fn rustc() -> PathBuf {
    std::env::var_os("RUSTC")
        .map(PathBuf::from)
        .unwrap_or_else(|| {
            PathBuf::from(
                std::env::var_os(if cfg!(windows) { "USERPROFILE" } else { "HOME" }).unwrap(),
            )
            .join(".cargo/bin")
            .join(exe("rustc"))
        })
}

fn compile_fixture(fixture: &str, out: &Path) {
    assert!(Command::new(rustc())
        .arg(Path::new(env!("CARGO_MANIFEST_DIR")).join(fixture))
        .arg("-o")
        .arg(out)
        .status()
        .unwrap()
        .success());
}

fn wait_until(what: &str, mut cond: impl FnMut() -> bool) {
    let deadline = Instant::now() + Duration::from_secs(90);
    while !cond() {
        assert!(Instant::now() < deadline, "timeout waiting for: {what}");
        std::thread::sleep(Duration::from_millis(25));
    }
}

fn wait_batch_completed(id: i64) -> Value {
    let mut last = Value::Null;
    wait_until(&format!("batch {id} completed"), || {
        last = call("batches.get", json!({"id": id}));
        last["status"] == "completed"
    });
    last
}

fn wait_source_job_settled(source: i64, kind: &str) -> Value {
    let mut found = Value::Null;
    wait_until(&format!("job {kind} for source {source}"), || {
        let jobs = call("jobs.list", json!({}));
        let hit = jobs.as_array().unwrap().iter().find(|j| {
            j["kind"] == kind
                && matches!(
                    j["state"].as_str(),
                    Some("completed" | "failed" | "cancelled")
                )
        });
        if let Some(j) = hit {
            found = j.clone();
            true
        } else {
            false
        }
    });
    found
}

fn run_count_for(source: i64) -> i64 {
    with_writer(|c| {
        c.query_row(
            "SELECT COUNT(*) FROM selection_runs r JOIN transcripts t ON t.id=r.transcript_id WHERE t.source_id=?1",
            [source],
            |r| r.get(0),
        )
    })
    .unwrap()
}

fn run_flags_for(source: i64) -> (i64, bool, bool) {
    with_writer(|c| {
        c.query_row(
            "SELECT r.id, r.energy_marks, r.chat_marks FROM selection_runs r JOIN transcripts t ON t.id=r.transcript_id WHERE t.source_id=?1 ORDER BY r.id DESC LIMIT 1",
            [source],
            |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?)),
        )
    })
    .unwrap()
}

/// Replay sintético mínimo com 1 pico no intervalo 3 (30 s): 5 autores distintos no intervalo 3.
fn synthetic_chat_replay() -> String {
    let mut lines = vec![json!({"liveChatRenderer": "cabeçalho"}).to_string()];
    for j in 0..5 {
        lines.push(
            json!({
                "replayChatItemAction": {
                    "actions": [{
                        "addChatItemAction": {
                            "item": {
                                "liveChatTextMessageRenderer": {
                                    "message": {"runs": [{"text": "KKKKK"}]},
                                    "authorName": {"simpleText": "Autor Sintetico"},
                                    "authorExternalChannelId": format!("autor-sintetico-{j}"),
                                    "timestampUsec": "0"
                                }
                            }
                        }
                    }],
                    "videoOffsetTimeMsec": (30_000 + j * 500).to_string()
                },
                "videoOffsetTimeMsec": (30_000 + j * 500).to_string()
            })
            .to_string(),
        );
    }
    lines.join("\n") + "\n"
}

fn seed_complete_transcript(source: i64, seconds: i64) {
    with_writer(|c| {
        c.execute(
            "INSERT INTO transcripts(source_id,audio_track,engine,model,revision,compute_type,state,resume_us,duration_us) VALUES (?1,0,'local','m','r','c','complete',?2,?2)",
            (source, seconds * 1_000_000),
        )?;
        let transcript = c.last_insert_rowid();
        for position in 0..seconds {
            let text = if position % 5 == 4 { " palavra." } else { " palavra" };
            c.execute(
                "INSERT INTO transcript_words(transcript_id,position,kind,text,start_us,end_us,language) VALUES (?1,?2,'word',?3,?4,?5,'pt')",
                (transcript, position, text, position * 1_000_000, (position + 1) * 1_000_000),
            )?;
        }
        Ok(())
    })
    .unwrap();
    call("transcription.segment", json!({"source_id": source}));
}

#[derive(Default)]
struct FakeProvider {
    calls: AtomicUsize,
}

impl Provider for FakeProvider {
    fn structured(&self, _: &StructuredRequest) -> Result<Value, CoreError> {
        unreachable!("the executor must use structured_with")
    }
    fn structured_with(&self, _: &StructuredRequest, _: &CancelToken) -> Result<Value, CoreError> {
        self.calls.fetch_add(1, Ordering::SeqCst);
        Ok(json!({
            "data": {"schemaVersion": 1, "candidates": []},
            "usage": {"inputTokens": 100, "outputTokens": 10},
            "calls": 1
        }))
    }
}

#[test]
fn batch_waits_for_energy_and_chat_before_starting_selection_without_blocking_on_failures() {
    let root = tempfile::tempdir().unwrap();
    let data = root.path().join("data");
    let components = data.join("components");
    fs::create_dir_all(&components).unwrap();

    let fake_ffmpeg = root.path().join(exe("fake-ffmpeg"));
    compile_fixture("tests/fixtures/fake_ffmpeg.rs", &fake_ffmpeg);
    let fake_ytdlp = components.join(exe("yt-dlp"));
    compile_fixture("tests/fixtures/fake_ytdlp.rs", &fake_ytdlp);
    let ytdlp_hash = format!("{:x}", Sha256::digest(fs::read(&fake_ytdlp).unwrap()));
    fs::write(
        components.join("yt-dlp.state.json"),
        json!({"version": "2027.01.01.000000", "sha256": ytdlp_hash, "origin": "SHA2-256SUMS assinado por yt-dlp"}).to_string(),
    )
    .unwrap();

    let continue_flag = root.path().join("continue");
    let running_flag = root.path().join("running");
    fs::write(&continue_flag, b"go").unwrap();

    std::env::set_var("CLIPES_FAKE_FFMPEG_STATE", root.path());
    std::env::set_var("CLIPES_FFPROBE", &fake_ffmpeg);
    std::env::set_var("CLIPES_DATA_DIR", &data);
    std::env::set_var("CLIPES_FAKE_DURATION", "60");
    std::env::set_var("CLIPES_TRANSCRIBE_BLOCK_SECONDS", "60");
    std::env::set_var("CLIPES_FAKE_WORKER_MODE", "transcribe");

    call(
        "components.settings.set",
        json!({
            "data_dir": data,
            "cache_dir": root.path().join("cache"),
            "cache_limit_bytes": 10_000_000,
            "ffmpeg_path": fake_ffmpeg
        }),
    );

    // Worker + modelos falsos para que `transcription` complete e enfileire `energy`.
    let manifest = call("components.manifest", json!({}));
    let uv_version = manifest
        .as_array()
        .unwrap()
        .iter()
        .find(|c| c["id"] == "uv")
        .unwrap()["version"]
        .as_str()
        .unwrap()
        .to_owned();
    fs::copy(FAKE_WORKER, components.join(exe("uv"))).unwrap();
    fs::write(components.join("uv.version"), uv_version).unwrap();
    call("components.worker.install", json!({"confirmed": true}));
    for model in call("components.models.manifest", json!({}))
        .as_array()
        .unwrap()
    {
        let dir = data.join("models").join(model["id"].as_str().unwrap());
        fs::create_dir_all(&dir).unwrap();
        fs::write(
            dir.join("model.state.json"),
            json!({"revision": model["revision"]}).to_string(),
        )
        .unwrap();
    }

    call(
        "sources.url.settings.set",
        json!({"terms_accepted": true, "download_dir": root.path().join("downloads")}),
    );

    let project = call(
        "projects.create",
        json!({"parent": root.path(), "name": "Canal"}),
    )["path"]
        .as_str()
        .unwrap()
        .to_owned();

    call(
        "provider.configure",
        json!({"endpoint": "http://127.0.0.1:9/v1", "kind": "openai", "model": "fake-model", "context": 32768}),
    );
    let provider = Arc::new(FakeProvider::default());
    jobs::set_ai_provider(Some(provider.clone()));
    jobs::set_ai_route(Some((
        Target::Api {
            provider: "openai".into(),
            model: "fake-model".into(),
            local: true,
        },
        "legacy".into(),
    )));

    // ---- 1. Transcrição -> energy enfileirada: lote espera `energy` sair de queued/running.
    let media1 = root.path().join("source1.mp4");
    fs::write(&media1, b"media1").unwrap();
    let s1 = call(
        "sources.import",
        json!({"project": project, "path": media1, "permission": {"status": "none"}, "audio_track": 0}),
    )["id"]
        .as_i64()
        .unwrap();
    let preview1 = wait_source_job_settled(s1, "preview");
    assert_eq!(preview1["state"], "completed");

    // Segura o próximo `pipe:1` (`energy`) enquanto validamos que `selection.start` não largou.
    let _ = fs::remove_file(&running_flag);
    fs::remove_file(&continue_flag).unwrap();
    let b1 = call("batches.create", json!({"sourceIds": [s1]}))["id"]
        .as_i64()
        .unwrap();
    wait_until("energy job entered pipe:1", || running_flag.exists());

    let energy_while_running = call("energy.status", json!({"source_id": s1}));
    assert_eq!(energy_while_running["measured"], false);
    assert_eq!(energy_while_running["job"]["state"], "running");
    assert_eq!(
        run_count_for(s1),
        0,
        "selection.start must wait while energy is running"
    );
    assert_eq!(provider.calls.load(Ordering::SeqCst), 0);

    // Libera `energy`: seleção larga logo em seguida com `energy_marks = true`.
    fs::write(&continue_flag, b"go").unwrap();
    wait_batch_completed(b1);
    let (run1, energy_marks, chat_marks) = run_flags_for(s1);
    assert!(energy_marks, "expected selection_runs.energy_marks = true");
    assert!(!chat_marks);
    let detail1 = call("selection.get", json!({"run": run1}));
    assert_eq!(detail1["run"]["summary"]["energy"]["measured"], true);

    // ---- 2. Fonte com `chat` na fila antes da seleção: lote aguarda `chat` e congela `chat_marks = true`.
    let replay = root.path().join("raid.live_chat.json");
    fs::write(&replay, synthetic_chat_replay()).unwrap();
    std::env::set_var("CLIPES_FAKE_CHAT_FILE", &replay);
    let dl = call(
        "sources.url.download",
        json!({"project": project, "url": "https://example.com/watch/chat-replay", "job": "dl-chat"}),
    );
    let _ = fs::remove_file(&running_flag);
    fs::remove_file(&continue_flag).unwrap();
    let s2 = call(
        "sources.import",
        json!({"project": project, "path": dl["path"], "audio_track": 0, "permission": {"status": "none"}, "origin_url": dl["url"]}),
    )["id"]
        .as_i64()
        .unwrap();
    seed_complete_transcript(s2, 60);
    // `preview` segura a fila em `running_flag` mantendo `chat` na fila (`queued`).
    wait_until("preview2 holding queue", || running_flag.exists());
    assert_eq!(
        call("chat.status", json!({"source_id": s2}))["job"]["state"],
        "queued"
    );

    let b2 = call("batches.create", json!({"sourceIds": [s2]}))["id"]
        .as_i64()
        .unwrap();
    std::thread::sleep(Duration::from_millis(300));
    assert_eq!(
        run_count_for(s2),
        0,
        "selection.start must wait while chat is queued"
    );

    fs::write(&continue_flag, b"go").unwrap();
    wait_batch_completed(b2);
    let (run2, _, chat_marks2) = run_flags_for(s2);
    assert!(chat_marks2, "expected selection_runs.chat_marks = true");
    let detail2 = call("selection.get", json!({"run": run2}));
    assert_eq!(detail2["run"]["summary"]["chat"]["available"], true);

    // ---- 3. `energy` e `chat` falhando não travam o lote.
    call(
        "components.settings.set",
        json!({"data_dir": data, "cache_dir": root.path().join("cache"), "cache_limit_bytes": 10_000_000, "ffmpeg_path": null}),
    );
    let media3 = root.path().join("source3.mp4");
    fs::write(&media3, b"media3").unwrap();
    let s3 = call(
        "sources.import",
        json!({"project": project, "path": media3, "permission": {"status": "none"}, "audio_track": 0, "origin_url": "https://example.com/watch/chat-fail"}),
    )["id"]
        .as_i64()
        .unwrap();
    seed_complete_transcript(s3, 60);
    call("energy.start", json!({"source_id": s3}));

    let b3 = call("batches.create", json!({"sourceIds": [s3]}))["id"]
        .as_i64()
        .unwrap();
    wait_batch_completed(b3);
    assert_eq!(
        call("energy.status", json!({"source_id": s3}))["job"]["state"],
        "failed"
    );
    assert_eq!(
        call("chat.status", json!({"source_id": s3}))["job"]["state"],
        "failed"
    );
    let (_run3, energy_marks3, chat_marks3) = run_flags_for(s3);
    assert!(!energy_marks3);
    assert!(!chat_marks3);

    call("projects.close", json!({}));
    jobs::set_ai_provider(None);
    jobs::set_ai_route(None);
}
