//! Preview do Corte (#58), pelo despacho do núcleo: protocolo de mídia com Range, proxy de GOP
//! curto, cache LRU, Fonte offline e cancelamento. Sem rede; vídeo sintético do FFmpeg.
use clipes_core::{dispatch, media};
use serde_json::{json, Value};
use std::{
    fs,
    path::{Path, PathBuf},
    process::Command,
    sync::Mutex,
    time::{Duration, Instant, SystemTime, UNIX_EPOCH},
};

// O estado do núcleo (Projeto aberto, variáveis de ambiente) é do processo: um teste por vez.
static LOCK: Mutex<()> = Mutex::new(());

fn run(name: &str, args: Value) -> Result<Value, clipes_core::CoreError> {
    dispatch(name, args, &mut |_| {})
}

fn scratch(tag: &str) -> PathBuf {
    let root = std::env::temp_dir().join(format!(
        "clipes-proxy-{tag}-{}-{}",
        std::process::id(),
        SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap()
            .as_nanos()
    ));
    fs::create_dir_all(&root).unwrap();
    std::env::set_var("CLIPES_DATA_DIR", root.join("data"));
    std::env::set_var("CLIPES_FFPROBE", "ffprobe");
    root
}

fn settings(root: &Path, limit: u64) {
    run("components.settings.set", json!({"data_dir":root.join("data"),"cache_dir":root.join("cache"),"cache_limit_bytes":limit,"ffmpeg_path":"ffmpeg"})).unwrap();
}

fn header<'a>(response: &'a media::MediaResponse, name: &str) -> Option<&'a str> {
    response
        .headers
        .iter()
        .find(|(k, _)| k.eq_ignore_ascii_case(name))
        .map(|(_, v)| v.as_str())
}

fn ffmpeg_with_x264() -> bool {
    Command::new("ffmpeg")
        .args(["-hide_banner", "-encoders"])
        .output()
        .map(|o| String::from_utf8_lossy(&o.stdout).contains("libx264"))
        .unwrap_or(false)
        && Command::new("ffprobe").arg("-version").output().is_ok()
}

fn synthetic(path: &Path, seconds: u32, size: &str) {
    assert!(Command::new("ffmpeg")
        .args(["-v", "error", "-f", "lavfi", "-i"])
        .arg(format!("testsrc=s={size}:r=30:d={seconds}"))
        .args(["-f", "lavfi", "-i"])
        .arg(format!("sine=duration={seconds}"))
        .args(["-c:v", "mpeg4", "-c:a", "pcm_s16le", "-ac", "2", "-y"])
        .arg(path)
        .status()
        .unwrap()
        .success());
}

fn wait_state(key: &str, wanted: &[&str], seconds: u64) -> Value {
    let start = Instant::now();
    loop {
        let status = run("proxy.status", json!({"key": key})).unwrap();
        if wanted.contains(&status["state"].as_str().unwrap()) {
            return status;
        }
        assert!(
            start.elapsed() < Duration::from_secs(seconds),
            "timeout: {status}"
        );
        std::thread::sleep(Duration::from_millis(50));
    }
}

fn proxy_jobs() -> usize {
    run("jobs.list", json!({}))
        .unwrap()
        .as_array()
        .unwrap()
        .iter()
        .filter(|j| j["kind"] == "proxy")
        .count()
}

#[test]
fn media_protocol_serves_ranges_and_refuses_everything_else() {
    let _guard = LOCK.lock().unwrap_or_else(|e| e.into_inner());
    let root = scratch("range");
    settings(&root, 1_000_000_000);
    let key = "ab".repeat(32);
    let folder = root.join("cache/proxies").join(&key);
    fs::create_dir_all(&folder).unwrap();
    // 10 KiB com conteúdo que identifica o deslocamento (byte i = i % 251).
    let bytes: Vec<u8> = (0..10_240u32).map(|i| (i % 251) as u8).collect();
    fs::write(folder.join("proxy.mp4"), &bytes).unwrap();
    // Um arquivo fora do cache que nenhuma URL pode alcançar.
    fs::write(root.join("secret.txt"), b"segredo").unwrap();
    let id = format!("proxy/{key}");

    let whole = media::serve(&id, None);
    assert_eq!((whole.status, whole.body.len()), (200, 10_240));
    assert_eq!(header(&whole, "Accept-Ranges"), Some("bytes"));
    assert_eq!(header(&whole, "Content-Type"), Some("video/mp4"));
    assert_eq!(header(&whole, "Content-Length"), Some("10240"));
    assert_eq!(header(&whole, "Access-Control-Allow-Origin"), None);

    // Início.
    let first = media::serve(&id, Some("bytes=0-99"));
    assert_eq!(first.status, 206);
    assert_eq!(first.body, bytes[..100]);
    assert_eq!(header(&first, "Content-Range"), Some("bytes 0-99/10240"));
    assert_eq!(header(&first, "Content-Length"), Some("100"));
    // Meio.
    let middle = media::serve(&format!("proxy%2F{key}"), Some("bytes=5000-5999"));
    assert_eq!(middle.status, 206);
    assert_eq!(middle.body, bytes[5000..6000]);
    assert_eq!(
        header(&middle, "Content-Range"),
        Some("bytes 5000-5999/10240")
    );
    // Fim: aberto, com sufixo e com fim além do arquivo (limitado).
    for (range, from) in [
        ("bytes=10000-", 10_000usize),
        ("bytes=-240", 10_000),
        ("bytes=10000-99999", 10_000),
    ] {
        let tail = media::serve(&id, Some(range));
        assert_eq!(tail.status, 206, "{range}");
        assert_eq!(tail.body, bytes[from..], "{range}");
        assert_eq!(
            header(&tail, "Content-Range"),
            Some("bytes 10000-10239/10240"),
            "{range}"
        );
    }
    // Inválido: início depois do fim do arquivo, invertido, malformado e múltiplo.
    for range in [
        "bytes=10240-",
        "bytes=20000-30000",
        "bytes=9-3",
        "bytes=abc",
        "bytes=0-1,5-6",
        "items=0-1",
        "bytes=-0",
    ] {
        let bad = media::serve(&id, Some(range));
        assert_eq!(bad.status, 416, "{range}");
        assert_eq!(
            header(&bad, "Content-Range"),
            Some("bytes */10240"),
            "{range}"
        );
        assert!(bad.body.is_empty());
    }

    // Path traversal e identificadores fora do formato: 404, sem tocar o disco.
    let secret_via = |name: &str| media::serve(name, None);
    for attempt in [
        "proxy/../../secret.txt".to_string(),
        "../secret.txt".to_string(),
        format!("proxy/{key}/../../../secret.txt"),
        format!("proxy/{key}/../../../../secret.txt"),
        "proxy/%2e%2e%2f%2e%2e%2fsecret.txt".to_string(),
        "..%2F..%2Fsecret.txt".to_string(),
        format!("proxy/{}", root.join("secret.txt").display()),
        root.join("secret.txt").display().to_string(),
        format!("proxy\\{key}"),
        "source/..".to_string(),
        "source/../1".to_string(),
        "source/1/2".to_string(),
        "file/1".to_string(),
        String::new(),
    ] {
        let denied = secret_via(&attempt);
        assert_eq!(denied.status, 404, "{attempt}");
        assert!(denied.body.is_empty(), "{attempt}");
    }
    // Chave válida, mas inexistente; e Fonte inexistente (nenhum Projeto aberto).
    assert_eq!(
        media::serve(&format!("proxy/{}", "cd".repeat(32)), None).status,
        404
    );
    assert_eq!(media::serve("source/1", None).status, 404);

    // O teto por resposta: `bytes=0-` num arquivo maior que o teto devolve só o teto.
    let big = "ef".repeat(32);
    fs::create_dir_all(root.join("cache/proxies").join(&big)).unwrap();
    let big_len = media::MAX_RESPONSE_BYTES + 1000;
    fs::write(
        root.join("cache/proxies").join(&big).join("proxy.mp4"),
        vec![7u8; big_len as usize],
    )
    .unwrap();
    let capped = media::serve(&format!("proxy/{big}"), Some("bytes=0-"));
    assert_eq!(capped.status, 206);
    assert_eq!(capped.body.len() as u64, media::MAX_RESPONSE_BYTES);
    let expected = format!("bytes 0-{}/{big_len}", media::MAX_RESPONSE_BYTES - 1);
    assert_eq!(header(&capped, "Content-Range"), Some(expected.as_str()));

    #[cfg(unix)]
    {
        let link_key = "12".repeat(32);
        let link_dir = root.join("cache/proxies").join(&link_key);
        fs::create_dir_all(&link_dir).unwrap();
        std::os::unix::fs::symlink(root.join("secret.txt"), link_dir.join("proxy.mp4")).unwrap();
        assert_eq!(media::serve(&format!("proxy/{link_key}"), None).status, 404);
    }
}

#[test]
fn proxy_lifecycle_cache_offline_and_cancel() {
    if !ffmpeg_with_x264() {
        eprintln!("Skipping: ffmpeg with libx264 and ffprobe are required");
        return;
    }
    let _guard = LOCK.lock().unwrap_or_else(|e| e.into_inner());
    let root = scratch("life");
    settings(&root, 1_000_000_000);
    let media_file = root.join("source.mkv");
    synthetic(&media_file, 300, "320x180");
    let project = run("projects.create", json!({"parent":root,"name":"Canal"})).unwrap();
    let project = project["path"].as_str().unwrap().to_owned();
    let source = run(
        "sources.import",
        json!({"project":project,"path":media_file,"permission":{"status":"none"},"audio_track":1}),
    )
    .unwrap();
    let source_id = source["id"].as_i64().unwrap();
    let us = |s: f64| (s * 1_000_000.0) as i64;

    // Corte de 6 s a 9 s: a janela ±2 min vai de 0 (limitada ao começo) a 129 s.
    let first = run(
        "proxy.request",
        json!({"source_id":source_id,"start_us":us(6.0),"end_us":us(9.0)}),
    )
    .unwrap();
    assert_eq!(first["windowStartUs"], 0);
    assert_eq!(first["windowEndUs"], us(129.0));
    let key = first["key"].as_str().unwrap().to_owned();
    assert_eq!(key.len(), 64);
    assert!(matches!(first["state"].as_str(), Some("queued")));
    // Pedir de novo enquanto há tarefa não cria outra.
    let again = run(
        "proxy.request",
        json!({"source_id":source_id,"start_us":us(6.0),"end_us":us(9.0)}),
    )
    .unwrap();
    assert_eq!(again["job"], first["job"]);
    assert_eq!(proxy_jobs(), 1);
    let ready = wait_state(&key, &["ready", "failed"], 60);
    assert_eq!(ready["state"], "ready", "{ready}");
    // Pronto: pedir de novo não enfileira.
    let hit = run(
        "proxy.request",
        json!({"source_id":source_id,"start_us":us(6.0),"end_us":us(9.0)}),
    )
    .unwrap();
    assert_eq!(hit["state"], "ready");
    assert_eq!(proxy_jobs(), 1);
    // A resposta nunca tem caminho absoluto (ADR-0006).
    assert!(!hit
        .to_string()
        .contains(root.to_str().unwrap().replace('\\', "\\\\").as_str()));

    // O arquivo: H.264 yuv420p com AAC, e quadro-chave a cada ≤ 0,5 s (+1 quadro), 129 s de janela.
    let file = root.join("cache/proxies").join(&key).join("proxy.mp4");
    assert!(file.is_file());
    assert!(!root
        .join("cache/proxies")
        .join(format!(".{key}.part"))
        .exists());
    let probe = |args: &[&str]| {
        let out = Command::new("ffprobe")
            .args(["-v", "error"])
            .args(args)
            .arg(&file)
            .output()
            .unwrap();
        String::from_utf8_lossy(&out.stdout).into_owned()
    };
    let streams = probe(&[
        "-show_entries",
        "stream=codec_name,pix_fmt,height",
        "-of",
        "csv=p=0",
    ]);
    assert!(
        streams.contains("h264,180,yuv420p") && streams.contains("aac"),
        "{streams}"
    );
    let packets = probe(&[
        "-select_streams",
        "v:0",
        "-show_entries",
        "packet=pts_time,flags",
        "-of",
        "csv=p=0",
    ]);
    let keys: Vec<f64> = packets
        .lines()
        .filter(|l| l.contains(",K"))
        .map(|l| l.split(',').next().unwrap().parse().unwrap())
        .collect();
    assert!(
        keys.len() >= 256,
        "só {} quadros-chave em 129 s",
        keys.len()
    );
    assert!(
        keys.windows(2)
            .all(|w| w[1] - w[0] <= 0.5 + 1.0 / 30.0 + 1e-6),
        "GOP longo: {keys:?}"
    );
    let duration: f64 = probe(&["-show_entries", "format=duration", "-of", "csv=p=0"])
        .trim()
        .parse()
        .unwrap();
    assert!((duration - 129.0).abs() < 0.3, "{duration}");

    // Servido pelo protocolo, com Range, e o proxy é MP4 de verdade.
    let head = media::serve(&format!("proxy/{key}"), Some("bytes=0-3"));
    assert_eq!(head.status, 206);
    let total: u64 = header(&head, "Content-Range")
        .unwrap()
        .rsplit('/')
        .next()
        .unwrap()
        .parse()
        .unwrap();
    assert_eq!(total, fs::metadata(&file).unwrap().len());
    let ftyp = media::serve(&format!("proxy/{key}"), Some("bytes=4-7"));
    assert_eq!(ftyp.body, b"ftyp");
    // A Fonte registrada também é servida pelo id, nunca por caminho.
    let modified = fs::metadata(&media_file).unwrap().modified().unwrap();
    let src = media::serve(&format!("source/{source_id}"), Some("bytes=0-3"));
    assert_eq!(src.status, 206);
    assert_eq!(src.body, fs::read(&media_file).unwrap()[..4]);
    assert_eq!(
        fs::metadata(&media_file).unwrap().modified().unwrap(),
        modified,
        "servir a Fonte não pode alterar seu mtime nem marcá-la como alterada"
    );
    assert_eq!(
        media::serve(&format!("source/{}", source_id + 1), None).status,
        404
    );

    // Chave do cache: outra janela, outra chave.
    let other = run(
        "proxy.request",
        json!({"source_id":source_id,"start_us":us(200.0),"end_us":us(203.0)}),
    )
    .unwrap();
    assert_ne!(other["key"], first["key"]);
    assert_eq!(other["windowStartUs"], us(80.0));
    assert_eq!(other["windowEndUs"], us(300.0));
    let other_key = other["key"].as_str().unwrap().to_owned();
    // LRU: com limite de usuário minúsculo, o novo fica e o antigo sai.
    settings(&root, 1);
    let done = wait_state(&other_key, &["ready", "failed"], 60);
    assert_eq!(done["state"], "ready", "{done}");
    assert_eq!(
        run("proxy.status", json!({"key": key})).unwrap()["state"],
        "missing"
    );
    assert!(root
        .join("cache/proxies")
        .join(&other_key)
        .join("proxy.mp4")
        .is_file());
    settings(&root, 1_000_000_000);
    // Pedir o antigo de novo regenera (job novo).
    let regen = run(
        "proxy.request",
        json!({"source_id":source_id,"start_us":us(6.0),"end_us":us(9.0)}),
    )
    .unwrap();
    assert_eq!(regen["state"], "queued");
    assert_ne!(regen["job"], first["job"]);
    assert_eq!(wait_state(&key, &["ready", "failed"], 60)["state"], "ready");

    // Intervalos inválidos não enfileiram nada.
    let before = proxy_jobs();
    for (s, e, code) in [
        (us(5.0), us(5.0), "invalid_range"),
        (us(9.0), us(6.0), "invalid_range"),
        (-1, us(3.0), "invalid_range"),
        (us(1.0), us(301.0), "invalid_range"),
    ] {
        assert_eq!(
            run(
                "proxy.request",
                json!({"source_id":source_id,"start_us":s,"end_us":e})
            )
            .unwrap_err()
            .code,
            code
        );
    }
    assert_eq!(
        run(
            "proxy.request",
            json!({"source_id":999,"start_us":0,"end_us":1})
        )
        .unwrap_err()
        .code,
        "source_not_found"
    );
    assert_eq!(proxy_jobs(), before);

    // Fonte offline: erro fixo, nada é gerado e nenhuma tarefa é criada, mesmo com proxy em cache.
    let moved = root.join("moved.mkv");
    fs::rename(&media_file, &moved).unwrap();
    let before = proxy_jobs();
    let err = run(
        "proxy.request",
        json!({"source_id":source_id,"start_us":us(6.0),"end_us":us(9.0)}),
    )
    .unwrap_err();
    assert_eq!(err.code, "source_offline");
    assert!(!err.message.contains(root.to_str().unwrap()));
    let uncached = run(
        "proxy.request",
        json!({"source_id":source_id,"start_us":us(100.0),"end_us":us(103.0)}),
    )
    .unwrap_err();
    assert_eq!(uncached.code, "source_offline");
    assert_eq!(proxy_jobs(), before);
    fs::rename(&moved, &media_file).unwrap();
}

#[test]
fn proxy_job_can_be_cancelled_midway() {
    if !ffmpeg_with_x264() {
        eprintln!("Skipping: ffmpeg with libx264 and ffprobe are required");
        return;
    }
    let _guard = LOCK.lock().unwrap_or_else(|e| e.into_inner());
    let root = scratch("cancel");
    settings(&root, 1_000_000_000);
    let media_file = root.join("long.mkv");
    synthetic(&media_file, 240, "1280x720");
    let project = run("projects.create", json!({"parent":root,"name":"Canal"})).unwrap();
    let project = project["path"].as_str().unwrap().to_owned();
    let source = run(
        "sources.import",
        json!({"project":project,"path":media_file,"permission":{"status":"none"},"audio_track":1}),
    )
    .unwrap();
    let source_id = source["id"].as_i64().unwrap();
    let request = run(
        "proxy.request",
        json!({"source_id":source_id,"start_us":100_000_000,"end_us":160_000_000}),
    )
    .unwrap();
    let key = request["key"].as_str().unwrap().to_owned();
    let job = request["job"].as_i64().unwrap();
    wait_state(&key, &["running"], 30);
    run("jobs.cancel", json!({"id": job})).unwrap();
    let end = wait_state(&key, &["cancelled", "ready"], 60);
    assert_eq!(
        end["state"], "cancelled",
        "terminou antes do cancelamento: {end}"
    );
    let proxies = root.join("cache/proxies");
    assert!(!proxies.join(&key).exists());
    assert!(!proxies.join(format!(".{key}.part")).exists());
}
