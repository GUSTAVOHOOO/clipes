//! Chat da live como sinal na seleção (#151), headless e sem rede: yt-dlp falso (mesmo padrão da
//! importação por URL, #53), replays SINTÉTICOS no formato real (nomes, IDs e textos inventados),
//! Provedor falso na fila e dados isolados em CLIPES_DATA_DIR. Um corpo de teste só: o Projeto
//! aberto, o Provedor injetado e as variáveis de ambiente são do processo.
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
    sync::{Arc, Mutex},
    time::{Duration, Instant},
};

fn call(name: &str, args: Value) -> Value {
    dispatch(name, args, &mut |_| {}).unwrap()
}

fn fail(name: &str, args: Value) -> CoreError {
    dispatch(name, args, &mut |_| {}).unwrap_err()
}

/// Uma linha do replay no formato real do yt-dlp.
fn text_line(ms: i64, author: &str, text: &str) -> String {
    json!({"replayChatItemAction": {"actions": [{"addChatItemAction": {"item": {"liveChatTextMessageRenderer": {
        "message": {"runs": [{"text": text}]},
        "authorName": {"simpleText": "Nome Inventado"},
        "authorExternalChannelId": author,
        "timestampUsec": "0"
    }}}}], "videoOffsetTimeMsec": ms.to_string()}, "videoOffsetTimeMsec": ms.to_string()})
    .to_string()
}

fn paid_line(ms: i64, author: &str) -> String {
    json!({"replayChatItemAction": {"actions": [{"addChatItemAction": {"item": {"liveChatPaidMessageRenderer": {
        "purchaseAmountText": {"simpleText": "R$ 5,00"},
        "authorExternalChannelId": author
    }}}}], "videoOffsetTimeMsec": ms.to_string()}})
    .to_string()
}

/// 40 min com 3 pessoas por intervalo de 10 s, mais: um comando espalhado (intervalo 50), um
/// spammer repetindo a mesma frase (1500 s em diante), um Super Chat e um raid de risadas no
/// intervalo 100 (1000 s).
fn raid_replay() -> String {
    let mut lines = vec![json!({"liveChatRenderer": "cabeçalho que não é mensagem"}).to_string()];
    for i in 0..240_i64 {
        for k in 0..3_i64 {
            lines.push(text_line(
                i * 10_000 + k * 1_000,
                &format!("autor-sintetico-{}", (i * 3 + k) % 40),
                &format!("fala número {i}-{k}"),
            ));
        }
    }
    for j in 0..30 {
        lines.push(text_line(
            500_000 + j * 100,
            &format!("cmd-{j}"),
            "!sorteio",
        ));
    }
    for s in 0..50 {
        lines.push(text_line(
            1_500_000 + s * 2_000,
            "spammer-sintetico",
            "oi oi oi",
        ));
    }
    lines.push(paid_line(700_000, "doador-sintetico"));
    for j in 0..15 {
        lines.push(text_line(
            1_000_000 + j * 500,
            &format!("raid-sintetico-{j}"),
            "KKKKK",
        ));
    }
    lines.join("\n") + "\n"
}

fn exe(name: &str) -> String {
    format!("{name}{}", std::env::consts::EXE_SUFFIX)
}

fn wait_job(id: i64) -> Value {
    let deadline = Instant::now() + Duration::from_secs(60);
    loop {
        let jobs = call("jobs.list", json!({}));
        if let Some(job) = jobs.as_array().unwrap().iter().find(|j| {
            j["id"] == id
                && matches!(
                    j["state"].as_str(),
                    Some("completed" | "failed" | "cancelled")
                )
        }) {
            return job.clone();
        }
        assert!(Instant::now() < deadline, "job {id} never settled: {jobs}");
        std::thread::sleep(Duration::from_millis(50));
    }
}

/// Baixa a mídia pelo yt-dlp falso e importa a Fonte por URL; devolve (ID da Fonte, caminho).
fn import_url(project: &str, url: &str) -> (i64, PathBuf) {
    let downloaded = call(
        "sources.url.download",
        json!({"project": project, "url": url, "job": format!("dl-{url}")}),
    );
    let source = call(
        "sources.import",
        json!({"project": project, "path": downloaded["path"], "audio_track": 0, "permission": {"status": "none"}, "origin_url": downloaded["url"]}),
    );
    (
        source["id"].as_i64().unwrap(),
        PathBuf::from(downloaded["path"].as_str().unwrap()),
    )
}

fn chat_job(source: i64) -> i64 {
    let deadline = Instant::now() + Duration::from_secs(30);
    loop {
        if let Some(job) = call("chat.status", json!({"source_id": source}))["job"]["id"].as_i64() {
            return job;
        }
        assert!(
            Instant::now() < deadline,
            "o job de chat nunca entrou na fila"
        );
        std::thread::sleep(Duration::from_millis(25));
    }
}

fn seed_transcript(source: i64) {
    with_writer(|c| {
        c.execute("INSERT INTO transcripts(source_id,audio_track,engine,model,revision,compute_type,state,resume_us,duration_us) VALUES (?1,0,'local','m','r','c','complete',2400000000,2400000000)", [source])?;
        let transcript = c.last_insert_rowid();
        for position in 0..2400_i64 {
            let text = if position % 10 == 9 { " palavra." } else { " palavra" };
            c.execute("INSERT INTO transcript_words(transcript_id,position,kind,text,start_us,end_us,language) VALUES (?1,?2,'word',?3,?4,?5,'pt')", (transcript, position, text, position * 1_000_000, (position + 1) * 1_000_000))?;
        }
        Ok(())
    })
    .unwrap();
    call("transcription.segment", json!({"source_id": source}));
}

#[derive(Default)]
struct Fake {
    sent: Mutex<Vec<String>>,
}

fn axes() -> Value {
    let mut out = json!({"schemaVersion": 1});
    for key in ["hook", "selfContained", "energy", "value", "closing"] {
        out[key] = json!({"score": 7, "why": "motivo curto"});
    }
    out
}

impl Provider for Fake {
    fn structured(&self, _: &StructuredRequest) -> Result<Value, CoreError> {
        unreachable!("the executor must use structured_with")
    }
    fn structured_with(
        &self,
        request: &StructuredRequest,
        _: &CancelToken,
    ) -> Result<Value, CoreError> {
        self.sent.lock().unwrap().push(request.transcript.clone());
        let has = |id: &str| {
            request
                .transcript
                .lines()
                .any(|l| l.starts_with(&format!("{id} ")))
        };
        let mut candidates = vec![];
        if has("98") && has("101") {
            let mut c = axes();
            c.as_object_mut().unwrap().remove("schemaVersion");
            c["startId"] = json!(98);
            c["endId"] = json!(101);
            c["title"] = json!("");
            candidates.push(c);
        }
        Ok(
            json!({"data": {"schemaVersion": 1, "candidates": candidates}, "usage": {"inputTokens": 10, "outputTokens": 5}, "calls": 1}),
        )
    }
}

fn wait_run(run: i64) -> Value {
    let deadline = Instant::now() + Duration::from_secs(60);
    loop {
        let value = call("selection.get", json!({"run": run}));
        if value["run"]["state"] == "completed" {
            return value;
        }
        assert!(
            Instant::now() < deadline,
            "run {run} never completed: {value}"
        );
        std::thread::sleep(Duration::from_millis(25));
    }
}

#[test]
fn chat_peaks_reach_the_selection_text_and_the_candidate_without_leaking_messages() {
    let root = tempfile::tempdir().unwrap();
    let data = root.path().join("data");
    std::env::set_var("CLIPES_DATA_DIR", &data);

    // ---- yt-dlp falso como Componente instalado (mesmo padrão do #53).
    let components = data.join("components");
    fs::create_dir_all(&components).unwrap();
    let fake = components.join(exe("yt-dlp"));
    let compiler = std::env::var_os("RUSTC")
        .map(PathBuf::from)
        .unwrap_or_else(|| {
            PathBuf::from(
                std::env::var_os(if cfg!(windows) { "USERPROFILE" } else { "HOME" }).unwrap(),
            )
            .join(".cargo/bin")
            .join(exe("rustc"))
        });
    assert!(Command::new(compiler)
        .arg(Path::new(env!("CARGO_MANIFEST_DIR")).join("tests/fixtures/fake_ytdlp.rs"))
        .arg("-o")
        .arg(&fake)
        .status()
        .unwrap()
        .success());
    let hash = format!("{:x}", Sha256::digest(fs::read(&fake).unwrap()));
    fs::write(
        components.join("yt-dlp.state.json"),
        json!({"version": "2027.01.01.000000", "sha256": hash, "origin": "SHA2-256SUMS assinado por yt-dlp"}).to_string(),
    )
    .unwrap();
    std::env::set_var("CLIPES_FFPROBE", &fake);
    call(
        "sources.url.settings.set",
        json!({"terms_accepted": true, "download_dir": root.path().join("downloads")}),
    );

    let project = call(
        "projects.create",
        json!({"parent": root.path(), "name": "Canal"}),
    );
    let project = project["path"].as_str().unwrap().to_owned();

    // ---- 1. Importação por URL de uma live com replay: o chat vem junto, sem ação do usuário.
    let replay = root.path().join("raid.live_chat.json");
    fs::write(&replay, raid_replay()).unwrap();
    std::env::set_var("CLIPES_FAKE_CHAT_FILE", &replay);
    let (live, media) = import_url(&project, "https://example.com/watch/live-chat-replay");
    let job = wait_job(chat_job(live));
    assert_eq!(job["state"], "completed", "{job}");
    assert_eq!(job["safety"], "local");
    // O replay bruto fica ao lado da mídia da Fonte.
    let beside = media.with_extension("live_chat.json");
    assert!(
        beside.is_file(),
        "o replay bruto deve ficar ao lado da mídia"
    );
    let status = call("chat.status", json!({"source_id": live}));
    assert_eq!(status["state"], "available");
    assert_eq!(status["canFetch"], true);
    assert_eq!(status["peaks"], 1, "{status}");
    assert_eq!(status["intervals"], 240);

    // O Projeto guarda só a série agregada: nenhum autor, nenhum texto, nem hash deles.
    let tables: Vec<String> = with_writer(|c| {
        let mut q = c.prepare(
            "SELECT sql FROM sqlite_master WHERE name IN ('chat_replays','chat_series')",
        )?;
        let rows = q.query_map([], |r| r.get(0))?;
        rows.collect::<rusqlite::Result<Vec<String>>>()
    })
    .unwrap();
    for ddl in &tables {
        for forbidden in ["author", "text", "name", "hash", "message_id"] {
            assert!(!ddl.contains(forbidden), "{ddl}");
        }
    }
    with_writer(|c| c.execute_batch("PRAGMA wal_checkpoint(TRUNCATE)")).unwrap();
    let mut sqlite_bytes = fs::read(Path::new(&project).join("project.sqlite")).unwrap();
    if let Ok(wal) = fs::read(Path::new(&project).join("project.sqlite-wal")) {
        sqlite_bytes.extend(wal);
    }
    let haystack = String::from_utf8_lossy(&sqlite_bytes);
    for secret in [
        "autor-sintetico",
        "raid-sintetico",
        "spammer-sintetico",
        "doador-sintetico",
        "sorteio",
        "KKKKK",
    ] {
        assert!(!haystack.contains(secret), "{secret} vazou para o Projeto");
    }
    // 240 intervalos: 3 pessoas cada; o raid soma 15 no 100; o Super Chat entra no 70.
    let (people, paid, laugh): (i64, i64, i64) = with_writer(|c| {
        c.query_row(
            "SELECT people,paid,laugh FROM chat_series WHERE source_id=?1 AND idx=100",
            [live],
            |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?)),
        )
    })
    .unwrap();
    assert_eq!((people, laugh), (18, 15));
    assert_eq!(paid, 0);
    let (paid_at_70, commands): (i64, i64) = with_writer(|c| {
        c.query_row(
            "SELECT paid, messages FROM chat_series WHERE source_id=?1 AND idx=70",
            [live],
            |r| Ok((r.get(0)?, r.get(1)?)),
        )
    })
    .unwrap();
    assert_eq!(paid_at_70, 1);
    assert_eq!(commands, 4, "3 mensagens + 1 Super Chat");
    let at_50: i64 = with_writer(|c| {
        c.query_row(
            "SELECT messages FROM chat_series WHERE source_id=?1 AND idx=50",
            [live],
            |r| r.get(0),
        )
    })
    .unwrap();
    assert_eq!(at_50, 3, "os 30 comandos `!` foram ignorados");
    let spam: i64 = with_writer(|c| {
        c.query_row(
            "SELECT SUM(messages) FROM chat_series WHERE source_id=?1 AND idx>=150 AND idx<160",
            [live],
            |r| r.get(0),
        )
    })
    .unwrap();
    assert_eq!(
        spam,
        30 + 1,
        "o spammer repetido conta uma vez só: 30 normais + 1"
    );

    // ---- 2. A seleção: a marca chega ao Provedor só nas Frases certas, e o candidato a guarda.
    seed_transcript(live);
    call(
        "provider.configure",
        json!({"endpoint": "http://127.0.0.1:9/v1", "kind": "openai", "model": "fake-model", "context": 32768}),
    );
    let provider = Arc::new(Fake::default());
    jobs::set_ai_provider(Some(provider.clone()));
    jobs::set_ai_route(Some((
        Target::Api {
            provider: "openai".into(),
            model: "fake-model".into(),
            local: true,
        },
        "legacy".into(),
    )));
    let estimate = call("selection.estimate", json!({"source_id": live}));
    assert_eq!(estimate["chat"]["available"], true);
    let run = call("selection.start", json!({"source_id": live}))["run"]
        .as_i64()
        .unwrap();
    let done = wait_run(run);
    assert_eq!(done["run"]["summary"]["chat"]["available"], true);
    assert_eq!(done["run"]["summary"]["chat"]["peaks"], 1);
    let sent = provider.sent.lock().unwrap().clone();
    let lines: Vec<&str> = sent.iter().flat_map(|t| t.lines()).collect();
    // Pico no intervalo 100 (1000 s), com a marca 10 s para trás: a Frase 100 (990 a 1000 s).
    assert!(
        lines
            .iter()
            .any(|l| l.starts_with("100 [chat 6,0× · risadas] palavra")),
        "{:?}",
        lines
            .iter()
            .filter(|l| l.contains("[chat"))
            .collect::<Vec<_>>()
    );
    assert!(lines
        .iter()
        .filter(|l| l.contains("[chat"))
        .all(|l| l.starts_with("100 ")));
    // Nada de mensagem, autor ou ID vai para o Provedor.
    for t in &sent {
        for secret in ["sintetico", "KKKKK", "sorteio", "fala número", "UC"] {
            assert!(!t.contains(secret), "{secret} vazou para o Provedor");
        }
    }
    let candidates = done["candidates"].as_array().unwrap();
    assert_eq!(candidates.len(), 1, "{done}");
    let marks = candidates[0]["chat"].as_array().unwrap();
    assert_eq!(marks.len(), 1);
    assert_eq!(marks[0]["ratio"], 6.0);
    assert_eq!(marks[0]["reaction"], "laugh");
    assert_eq!(marks[0]["atUs"], 990_000_000_i64);

    // ---- 3. Vídeo sem replay: segue sem chat e sem erro.
    let (plain, _) = import_url(&project, "https://example.com/watch/sem-chat");
    assert_eq!(wait_job(chat_job(plain))["state"], "completed");
    let status = call("chat.status", json!({"source_id": plain}));
    assert_eq!(status["state"], "absent");
    assert_eq!(status["peaks"], 0);
    seed_transcript(plain);
    assert_eq!(
        call("selection.estimate", json!({"source_id": plain}))["chat"],
        json!({"available": false})
    );

    // ---- 4. Replay vazio (só comandos): também sem chat e sem erro.
    let empty = root.path().join("empty.live_chat.json");
    fs::write(
        &empty,
        [
            text_line(1_000, "cmd-1", "!pix"),
            text_line(2_000, "cmd-2", "!discord"),
        ]
        .join("\n"),
    )
    .unwrap();
    std::env::set_var("CLIPES_FAKE_CHAT_FILE", &empty);
    let (vazio, _) = import_url(&project, "https://example.com/watch/vazio-chat-replay");
    assert_eq!(wait_job(chat_job(vazio))["state"], "completed");
    assert_eq!(
        call("chat.status", json!({"source_id": vazio}))["state"],
        "absent"
    );

    // ---- 5. Buscar depois: a primeira tentativa falha (erro fixo), a segunda funciona.
    std::env::set_var("CLIPES_FAKE_CHAT_FILE", root.path().join("nao-existe.json"));
    let (late, _) = import_url(&project, "https://example.com/watch/depois-chat-replay");
    let first = wait_job(chat_job(late));
    assert_eq!(first["state"], "failed", "{first}");
    assert_eq!(
        call("chat.status", json!({"source_id": late}))["state"],
        "none"
    );
    std::env::set_var("CLIPES_FAKE_CHAT_FILE", &replay);
    let again = call("chat.fetch", json!({"source_id": late}));
    assert_eq!(again["state"], "queued");
    // Idempotente enquanto há job na fila ou rodando.
    let twice = call("chat.fetch", json!({"source_id": late}));
    assert!(twice["job"].as_i64().is_some());
    let second = wait_job(again["job"].as_i64().unwrap());
    assert_eq!(second["state"], "completed", "{second}");
    assert_eq!(
        call("chat.status", json!({"source_id": late}))["state"],
        "available"
    );

    // ---- 6. Fonte local: não há o que buscar, sem botão (canFetch) e erro tipado.
    let local_media = root.path().join("local.mp4");
    fs::write(&local_media, b"media local").unwrap();
    let local = call(
        "sources.import",
        json!({"project": project, "path": local_media, "audio_track": 0, "permission": {"status": "none"}}),
    )["id"]
        .as_i64()
        .unwrap();
    let status = call("chat.status", json!({"source_id": local}));
    assert_eq!(
        (
            status["state"].as_str(),
            status["canFetch"].as_bool(),
            status["job"].is_null()
        ),
        (Some("none"), Some(false), true)
    );
    assert_eq!(
        fail("chat.fetch", json!({"source_id": local})).code,
        "chat_needs_url"
    );
    assert_eq!(
        fail("chat.fetch", json!({"source_id": 9999})).code,
        "source_missing"
    );
}
