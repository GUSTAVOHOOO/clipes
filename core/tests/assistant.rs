use clipes_core::dispatch;
use serde_json::{json, Value};
use std::{
    env, fs,
    io::{Read, Write},
    net::TcpListener,
    path::{Path, PathBuf},
    thread,
    time::Duration,
};

/// Fake local server: reads the whole request before answering, as Windows requires.
fn serve(routes: Vec<(&'static str, &'static str)>) -> String {
    let listener = TcpListener::bind("127.0.0.1:0").unwrap();
    let url = format!("http://{}", listener.local_addr().unwrap());
    thread::spawn(move || {
        for stream in listener.incoming() {
            let Ok(mut stream) = stream else { continue };
            stream.set_nonblocking(false).unwrap();
            stream
                .set_read_timeout(Some(Duration::from_secs(3)))
                .unwrap();
            let mut bytes = Vec::new();
            while !bytes.windows(4).any(|w| w == b"\r\n\r\n") {
                let mut chunk = [0; 1024];
                match stream.read(&mut chunk) {
                    Ok(0) | Err(_) => break,
                    Ok(n) => bytes.extend_from_slice(&chunk[..n]),
                }
            }
            let head = String::from_utf8_lossy(&bytes).to_string();
            let target = head.split_whitespace().nth(1).unwrap_or("").to_owned();
            let (status, body) = routes
                .iter()
                .find(|(path, _)| *path == target)
                .map(|(_, body)| ("200 OK", *body))
                .unwrap_or(("404 Not Found", "{}"));
            let _ = write!(
                stream,
                "HTTP/1.1 {status}\r\nContent-Type: application/json\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{body}",
                body.len()
            );
        }
    });
    url
}

fn closed_port() -> String {
    let listener = TcpListener::bind("127.0.0.1:0").unwrap();
    let url = format!("http://{}", listener.local_addr().unwrap());
    drop(listener);
    url
}

fn fake_path(names: &[&str]) -> (tempfile::TempDir, String) {
    let dir = tempfile::tempdir().unwrap();
    for name in names {
        let file = dir.path().join(if cfg!(windows) {
            format!("{name}.exe")
        } else {
            (*name).to_owned()
        });
        fs::write(&file, b"").unwrap();
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            fs::set_permissions(&file, fs::Permissions::from_mode(0o755)).unwrap();
        }
    }
    let path = dir.path().to_string_lossy().into_owned();
    (dir, path)
}

fn run(name: &str, args: Value) -> Result<Value, clipes_core::CoreError> {
    dispatch(name, args, &mut |_| {})
}

#[test]
fn detects_everything_installed() {
    let ollama = serve(vec![(
        "/api/tags",
        r#"{"models":[{"name":"llama3:8b"},{"name":"qwen3"}]}"#,
    )]);
    let lmstudio = serve(vec![("/v1/models", r#"{"data":[{"id":"gemma-3"}]}"#)]);
    let llamacpp = serve(vec![("/v1/models", r#"{"data":[{"id":"model.gguf"}]}"#)]);
    let (_dir, path) = fake_path(&["codex", "claude", "opencode"]);
    let found = run(
        "assistant.detect",
        json!({"ollama":ollama,"lmStudio":lmstudio,"llamaCpp":llamacpp,"path":path}),
    )
    .unwrap();
    assert_eq!(found["ollama"]["found"], true);
    assert_eq!(found["ollama"]["models"], json!(["llama3:8b", "qwen3"]));
    assert_eq!(found["ollama"]["endpoint"], ollama);
    assert_eq!(found["lmStudio"]["endpoint"], format!("{lmstudio}/v1"));
    assert_eq!(found["lmStudio"]["models"], json!(["gemma-3"]));
    assert_eq!(found["llamaCpp"]["endpoint"], format!("{llamacpp}/v1"));
    assert_eq!(found["llamaCpp"]["models"], json!(["model.gguf"]));
    assert_eq!(found["codex"]["found"], true);
    assert_eq!(found["claude"]["found"], true);
    assert_eq!(found["opencode"]["found"], true);
}

#[test]
fn detects_nothing_when_nothing_is_installed() {
    let (_dir, path) = fake_path(&[]);
    let found = run(
        "assistant.detect",
        json!({"ollama":closed_port(),"lmStudio":closed_port(),"llamaCpp":closed_port(),"path":path}),
    )
    .unwrap();
    for key in [
        "ollama", "lmStudio", "llamaCpp", "codex", "claude", "opencode",
    ] {
        assert_eq!(found[key]["found"], false, "{key}");
    }
    assert_eq!(found["ollama"]["models"], json!([]));
}

#[test]
fn llamacpp_falls_back_to_health_and_ignores_wrong_replies() {
    let llamacpp = serve(vec![("/health", r#"{"status":"ok"}"#)]);
    let wrong = serve(vec![("/api/tags", "not json"), ("/v1/models", "[]")]);
    let (_dir, path) = fake_path(&[]);
    let found = run(
        "assistant.detect",
        json!({"ollama":wrong,"lmStudio":wrong,"llamaCpp":llamacpp,"path":path}),
    )
    .unwrap();
    assert_eq!(found["llamaCpp"]["found"], true);
    assert_eq!(found["llamaCpp"]["models"], json!([]));
    assert_eq!(found["ollama"]["found"], false);
    assert_eq!(found["lmStudio"]["found"], false);
}

#[test]
fn detection_never_contacts_a_remote_address() {
    for args in [
        json!({"ollama":"http://192.0.2.1:11434"}),
        json!({"lmStudio":"https://127.0.0.1:1234"}),
        json!({"llamaCpp":"http://example.com"}),
    ] {
        assert_eq!(
            run("assistant.detect", args).unwrap_err().code,
            "invalid_endpoint"
        );
    }
}

fn compile_fake(dir: &Path, name: &str) {
    let rustc = PathBuf::from(env!("CARGO")).with_file_name(if cfg!(windows) {
        "rustc.exe"
    } else {
        "rustc"
    });
    let executable = dir.join(if cfg!(windows) {
        format!("{name}.exe")
    } else {
        name.to_owned()
    });
    assert!(std::process::Command::new(rustc)
        .arg(PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("tests/fixtures/fake_provider_cli.rs"))
        .arg("-o")
        .arg(executable)
        .status()
        .unwrap()
        .success());
}

static DATA_LOCK: std::sync::Mutex<()> = std::sync::Mutex::new(());

/// Settings, first-run state and per-task routing share one data dir, so they run in order.
#[test]
fn settings_and_routing() {
    let _guard = DATA_LOCK.lock().unwrap_or_else(|e| e.into_inner());
    let root = env::temp_dir().join(format!("clipes-assistant-it-{}", std::process::id()));
    fs::create_dir_all(&root).unwrap();
    env::set_var("CLIPES_DATA_DIR", &root);
    compile_fake(&root, "codex");
    compile_fake(&root, "claude");
    env::set_var(
        "PATH",
        env::join_paths(
            std::iter::once(root.clone()).chain(env::split_paths(&env::var_os("PATH").unwrap())),
        )
        .unwrap(),
    );
    let log = root.join("log");
    env::set_var("FAKE_LOG", &log);

    // First run: nothing chosen, no factory default.
    let status = run("assistant.status", json!({})).unwrap();
    assert_eq!(status["needsSetup"], true);
    assert_eq!(status["default"], "");
    assert_eq!(
        status["tasks"],
        json!({"selection":"","packaging":"","script":"","translation":""})
    );

    // Invalid input is rejected with fixed codes.
    assert_eq!(
        run("assistant.default.set", json!({"choice":"gpt"}))
            .unwrap_err()
            .code,
        "invalid_settings"
    );
    assert_eq!(
        run(
            "assistant.task.set",
            json!({"task":"nope","choice":"endpoint"})
        )
        .unwrap_err()
        .code,
        "invalid_settings"
    );
    // A CLI cannot become a choice before the #39 warning is confirmed.
    assert_eq!(
        run("assistant.default.set", json!({"choice":"codex"}))
            .unwrap_err()
            .code,
        "confirmation_required"
    );

    run("provider.cli.configure", json!({"kind":"codex"})).unwrap();
    run("provider.cli.confirm", json!({"kind":"codex"})).unwrap();
    run("provider.cli.configure", json!({"kind":"claude"})).unwrap();
    run("provider.cli.confirm", json!({"kind":"claude"})).unwrap();
    run("assistant.default.set", json!({"choice":"codex"})).unwrap();
    run(
        "assistant.task.set",
        json!({"task":"script","choice":"claude"}),
    )
    .unwrap();

    let request = |task: Option<&str>| {
        let mut r = json!({"instruction":"Return data","transcript":"t","schema":{"type":"object","properties":{"schemaVersion":{"const":1}},"required":["schemaVersion"],"additionalProperties":false},"nativeSchema":true});
        if let Some(task) = task {
            r["task"] = json!(task);
        }
        r
    };
    let first_arg = || {
        fs::read_to_string(&log)
            .unwrap()
            .lines()
            .next()
            .unwrap()
            .to_owned()
    };
    // The default applies to a task without a switch and to a call without a task.
    run("provider.structured", request(Some("selection"))).unwrap();
    assert_eq!(first_arg(), "exec");
    // The task with a switch uses its own Provider.
    run("provider.structured", request(Some("script"))).unwrap();
    assert_eq!(first_arg(), "-p");
    run("provider.structured", request(None)).unwrap();
    assert_eq!(first_arg(), "exec");
    assert_eq!(
        run("provider.structured", request(Some("bogus")))
            .unwrap_err()
            .code,
        "invalid_request"
    );

    // Clearing a switch returns the task to the default.
    run("assistant.task.set", json!({"task":"script","choice":""})).unwrap();
    run("provider.structured", request(Some("script"))).unwrap();
    assert_eq!(first_arg(), "exec");

    // Completion and skipping are recorded; reopening keeps the choices.
    assert_eq!(
        run("assistant.complete", json!({})).unwrap()["needsSetup"],
        false
    );
    let skipped = run("assistant.complete", json!({"skipped":true})).unwrap();
    assert_eq!(skipped["skipped"], true);
    assert_eq!(skipped["completed"], false);
    assert_eq!(skipped["needsSetup"], false);
    assert_eq!(skipped["default"], "codex");

    // Disabling the CLI forgets the choices that pointed to it.
    run("provider.cli.configure", json!({"kind":""})).unwrap();
    assert_eq!(run("assistant.status", json!({})).unwrap()["default"], "");
    // The data lives only in CLIPES_DATA_DIR, never in a Project.
    assert!(root.join("assistant.json").exists());
    fs::remove_dir_all(root).unwrap();
}

#[test]
fn ollama_detected_by_assistant_uses_native_context_and_num_ctx() {
    let _guard = DATA_LOCK.lock().unwrap_or_else(|e| e.into_inner());
    let root = env::temp_dir().join(format!("clipes-assistant-ollama-{}", std::process::id()));
    let _ = fs::remove_dir_all(&root);
    fs::create_dir_all(&root).unwrap();
    env::set_var("CLIPES_DATA_DIR", &root);

    let listener = TcpListener::bind("127.0.0.1:0").unwrap();
    let base = format!("http://{}", listener.local_addr().unwrap());
    let calls = std::sync::Arc::new(std::sync::Mutex::new(Vec::<(String, Value)>::new()));
    let seen = calls.clone();
    thread::spawn(move || {
        for stream in listener.incoming() {
            let Ok(mut stream) = stream else { break };
            stream.set_nonblocking(false).unwrap();
            stream
                .set_read_timeout(Some(Duration::from_secs(3)))
                .unwrap();
            let mut bytes = Vec::new();
            let head_end = loop {
                if let Some(pos) = bytes.windows(4).position(|w| w == b"\r\n\r\n") {
                    break Some(pos);
                }
                let mut chunk = [0; 1024];
                match stream.read(&mut chunk) {
                    Ok(0) | Err(_) => break None,
                    Ok(n) => bytes.extend_from_slice(&chunk[..n]),
                }
            };
            let Some(head_end) = head_end else { continue };
            let headers = String::from_utf8_lossy(&bytes[..head_end]).to_string();
            let content_len: usize = headers
                .lines()
                .find_map(|line| {
                    line.split_once(':')
                        .filter(|(k, _)| k.eq_ignore_ascii_case("content-length"))
                        .and_then(|(_, v)| v.trim().parse().ok())
                })
                .unwrap_or(0);
            while bytes.len() < head_end + 4 + content_len {
                let mut chunk = [0; 1024];
                match stream.read(&mut chunk) {
                    Ok(0) | Err(_) => break,
                    Ok(n) => bytes.extend_from_slice(&chunk[..n]),
                }
            }
            let target = headers.split_whitespace().nth(1).unwrap_or("").to_owned();
            let req_body = if content_len > 0 {
                serde_json::from_slice(&bytes[head_end + 4..head_end + 4 + content_len])
                    .unwrap_or(Value::Null)
            } else {
                Value::Null
            };
            seen.lock().unwrap().push((target.clone(), req_body));
            let (status, body) = match target.as_str() {
                "/api/tags" => ("200 OK", r#"{"models":[{"name":"llama3:8b"}]}"#),
                "/api/show" => (
                    "200 OK",
                    r#"{"model_info":{"general.architecture":"llama","llama.context_length":131072}}"#,
                ),
                "/api/ps" => (
                    "200 OK",
                    r#"{"models":[{"name":"llama3:8b","model":"llama3:8b","context_length":32768}]}"#,
                ),
                "/api/chat" => (
                    "200 OK",
                    r#"{"message":{"role":"assistant","content":"{\"schemaVersion\":1}"},"done":true,"prompt_eval_count":12,"eval_count":4}"#,
                ),
                _ => ("404 Not Found", "{}"),
            };
            let _ = write!(
                stream,
                "HTTP/1.1 {status}\r\nContent-Type: application/json\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{body}",
                body.len()
            );
        }
    });

    let (_dir, path) = fake_path(&[]);
    let found = run(
        "assistant.detect",
        json!({"ollama":base,"lmStudio":closed_port(),"llamaCpp":closed_port(),"path":path}),
    )
    .unwrap();
    assert_eq!(found["ollama"]["found"], true);
    assert_eq!(found["ollama"]["endpoint"], base);
    let model = found["ollama"]["models"][0].as_str().unwrap();

    run(
        "provider.configure",
        json!({"kind":"ollama","endpoint":found["ollama"]["endpoint"],"model":model,"nativeSchema":false}),
    )
    .unwrap();
    run("assistant.default.set", json!({"choice":"endpoint"})).unwrap();

    let status = run("provider.status", json!({})).unwrap();
    assert_eq!(status["kind"], "ollama");
    assert_eq!(status["endpoint"], base);

    let context = run("provider.context.get", json!({})).unwrap();
    assert_eq!(context["kind"], "ollama");
    assert_eq!(context["value"], 32768);
    assert_eq!(context["source"], "loaded");
    assert_eq!(context["maxContext"]["value"], 131072);

    let reply = run(
        "provider.structured",
        json!({
            "instruction": "Return data",
            "transcript": "hello",
            "schema": {"type":"object","properties":{"schemaVersion":{"const":1}},"required":["schemaVersion"],"additionalProperties":false},
            "nativeSchema": false
        }),
    )
    .unwrap();
    assert_eq!(reply["data"]["schemaVersion"], 1);

    let recorded = calls.lock().unwrap();
    assert!(recorded.iter().any(|(p, _)| p == "/api/show"));
    assert!(recorded.iter().any(|(p, _)| p == "/api/ps"));
    let chat = recorded
        .iter()
        .find(|(p, _)| p == "/api/chat")
        .expect("expected /api/chat call");
    assert_eq!(chat.1["options"]["num_ctx"], 32768);
    assert_eq!(chat.1["model"], "llama3:8b");

    let _ = fs::remove_dir_all(root);
}
