//! "Somente local" como veto por Projeto (#123). Sem rede: o servidor falso escuta só em
//! loopback e o endereço "remoto" é um IP de documentação (192.0.2.0/24) que a recusa nunca
//! chega a contactar.
use clipes_core::{dispatch, CoreError};
use serde_json::{json, Value};
use std::{
    env, fs,
    io::{Read, Write},
    net::TcpListener,
    path::Path,
    thread,
    time::{Duration, Instant},
};

const REMOTE: &str = "https://192.0.2.10/v1";
const SECRET: &str = "SEGREDO-DA-TRANSCRICAO-123";
const PROJECT_NAME: &str = "CanalSecretoDoProjeto";

fn run(name: &str, args: Value) -> Result<Value, CoreError> {
    dispatch(name, args, &mut |_| {})
}

/// Loopback fake: answers every request after reading it whole (the Windows CI needs that).
fn fake_local() -> String {
    let listener = TcpListener::bind("127.0.0.1:0").unwrap();
    let url = format!("http://{}/v1", listener.local_addr().unwrap());
    thread::spawn(move || {
        let body = r#"{"choices":[{"message":{"content":"{\"schemaVersion\":1}"}}],"usage":{"prompt_tokens":3,"completion_tokens":2}}"#;
        for stream in listener.incoming() {
            let Ok(mut stream) = stream else { continue };
            stream.set_nonblocking(false).unwrap();
            stream
                .set_read_timeout(Some(Duration::from_secs(3)))
                .unwrap();
            let mut bytes = Vec::new();
            loop {
                let mut chunk = [0; 4096];
                match stream.read(&mut chunk) {
                    Ok(0) | Err(_) => break,
                    Ok(n) => bytes.extend_from_slice(&chunk[..n]),
                }
                if let Some(pos) = bytes.windows(4).position(|w| w == b"\r\n\r\n") {
                    let head = String::from_utf8_lossy(&bytes[..pos]).to_lowercase();
                    let length: usize = head
                        .lines()
                        .find_map(|l| l.strip_prefix("content-length:"))
                        .and_then(|v| v.trim().parse().ok())
                        .unwrap_or(0);
                    if bytes.len() >= pos + 4 + length {
                        break;
                    }
                }
            }
            let _ = write!(
                stream,
                "HTTP/1.1 200 OK\r\nContent-Type: application/json\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{body}",
                body.len()
            );
        }
    });
    url
}

fn structured(task: &str, extra: Value) -> Value {
    let mut args = json!({"task":task,"instruction":"x","transcript":SECRET,"schema":{"type":"object","properties":{"schemaVersion":{"type":"integer"}},"required":["schemaVersion"]},"nativeSchema":false});
    if let (Some(a), Some(e)) = (args.as_object_mut(), extra.as_object()) {
        a.extend(e.clone());
    }
    args
}

fn configure(id: &str, endpoint: &str, model: &str) {
    run(
        "provider.configure",
        json!({"profileId":id,"label":id,"kind":"openai","endpoint":endpoint,"model":model}),
    )
    .unwrap();
}

fn assert_violation(error: CoreError) {
    assert_eq!(error.code, "local_only_violation");
    assert_eq!(error.message, "This task only accepts a local provider");
    assert!(error.usage.is_none());
    let shown = serde_json::to_string(&error).unwrap();
    for leak in [SECRET, PROJECT_NAME, "192.0.2", "127.0.0.1"] {
        assert!(!shown.contains(leak), "{leak}");
    }
}

fn enabled() -> bool {
    run("projects.local_only.get", json!({})).unwrap()["enabled"] == true
}

fn row(task: &str) -> Value {
    run("assistant.tasks", json!({})).unwrap()["tasks"]
        .as_array()
        .unwrap()
        .iter()
        .find(|r| r["task"] == task)
        .unwrap()
        .clone()
}

fn copy_dir(from: &Path, to: &Path) {
    fs::create_dir_all(to).unwrap();
    for entry in fs::read_dir(from).unwrap() {
        let entry = entry.unwrap();
        let target = to.join(entry.file_name());
        if entry.file_type().unwrap().is_dir() {
            copy_dir(&entry.path(), &target);
        } else {
            fs::copy(entry.path(), target).unwrap();
        }
    }
}

#[test]
fn project_veto() {
    let root = env::temp_dir().join(format!("clipes-project-local-only-{}", std::process::id()));
    let _ = fs::remove_dir_all(&root);
    fs::create_dir_all(&root).unwrap();
    env::set_var("CLIPES_DATA_DIR", root.join("data"));
    configure("local", &fake_local(), "qwen-local");
    configure("remote", REMOTE, "cheap");
    run(
        "provider.confirm",
        json!({"profileId":"remote","endpoint":REMOTE}),
    )
    .unwrap();
    run("provider.cli.configure", json!({"kind":"codex"})).unwrap();
    run("provider.cli.confirm", json!({"kind":"codex"})).unwrap();

    // No Project open: there is no veto, only the per-task setting counts.
    let none = run("projects.local_only.get", json!({})).unwrap();
    assert_eq!(none["open"], false);
    assert_eq!(none["enabled"], false);
    assert_eq!(
        run("projects.local_only.set", json!({"enabled":true}))
            .unwrap_err()
            .code,
        "project_not_open"
    );
    assert_eq!(
        run("assistant.tasks", json!({})).unwrap()["projectLocalOnly"],
        false
    );
    assert!(run(
        "provider.cost.run",
        structured("selection", json!({"profileId":"local"}))
    )
    .is_ok());

    // New Project: off by default, so a remote profile is not blocked by the veto.
    let created = run(
        "projects.create",
        json!({"parent":root,"name":PROJECT_NAME}),
    )
    .unwrap();
    let path = created["path"].as_str().unwrap().to_owned();
    assert!(!enabled());
    run(
        "assistant.task.set",
        json!({"task":"packaging","choice":"profile:remote"}),
    )
    .unwrap();
    assert_eq!(row("packaging")["blocked"], false);
    assert_eq!(
        run("assistant.tasks", json!({})).unwrap()["projectLocalOnly"],
        false
    );
    assert_eq!(
        run("projects.local_only.set", json!({"enabled":"yes"}))
            .unwrap_err()
            .code,
        "invalid_request"
    );

    // Veto on: remote profile, explicit profile, CLI and the old "selected CLI" are refused
    // before any network access, even though the task points to a remote profile.
    let on = run("projects.local_only.set", json!({"enabled":true})).unwrap();
    assert_eq!(on["enabled"], true);
    assert!(enabled());
    let began = Instant::now();
    assert_violation(run("provider.structured", structured("packaging", json!({}))).unwrap_err());
    assert_violation(
        run("provider.cost.estimate", structured("packaging", json!({}))).unwrap_err(),
    );
    assert_violation(run("provider.cost.run", structured("packaging", json!({}))).unwrap_err());
    // "Redo with the strong one" (and any escalation) names a profile: no bypass.
    for task in ["packaging", "selection"] {
        let args = structured(task, json!({"profileId":"remote"}));
        assert_violation(run("provider.structured", args).unwrap_err());
    }
    // A call with no task at all is covered too.
    let mut no_task = structured("x", json!({"profileId":"remote"}));
    no_task.as_object_mut().unwrap().remove("task");
    assert_violation(run("provider.structured", no_task).unwrap_err());
    // CLI chosen by the task, and CLI selected the old way.
    run(
        "assistant.task.set",
        json!({"task":"translation","choice":"codex"}),
    )
    .unwrap();
    assert_violation(run("provider.structured", structured("translation", json!({}))).unwrap_err());
    run(
        "assistant.task.set",
        json!({"task":"translation","choice":""}),
    )
    .unwrap();
    assert_violation(run("provider.structured", structured("translation", json!({}))).unwrap_err());
    assert!(
        began.elapsed() < Duration::from_secs(2),
        "refused without connecting"
    );

    // The table says the Project veto is active and which rows it blocks.
    let table = run("assistant.tasks", json!({})).unwrap();
    assert_eq!(table["projectLocalOnly"], true);
    assert_eq!(row("packaging")["blocked"], true);
    assert_eq!(row("packaging")["localOnly"], false);

    // Loopback passes the veto.
    let ok = run(
        "provider.cost.run",
        structured("selection", json!({"profileId":"local"})),
    )
    .unwrap();
    assert_eq!(ok["route"]["profileId"], "local");
    run(
        "assistant.task.set",
        json!({"task":"packaging","choice":"profile:local"}),
    )
    .unwrap();
    assert_eq!(row("packaging")["blocked"], false);
    assert!(run("provider.structured", structured("packaging", json!({}))).is_ok());
    run(
        "assistant.task.set",
        json!({"task":"packaging","choice":"profile:remote"}),
    )
    .unwrap();

    // Refusals leave nothing in the diagnostic: no text, no Project name.
    let diagnostic = run("diagnostic.get", json!({})).unwrap().to_string();
    for leak in [SECRET, PROJECT_NAME, "192.0.2"] {
        assert!(!diagnostic.contains(leak), "{leak}");
    }

    // The flag travels with the folder: copy the Project elsewhere and open it there.
    run("projects.close", json!({})).unwrap();
    let moved = root.join("outra-maquina").join("Canal.clipes");
    copy_dir(Path::new(&path), &moved);
    run("projects.open", json!({"path":moved})).unwrap();
    assert!(enabled(), "reopened elsewhere keeps the veto");
    assert_violation(run("provider.structured", structured("packaging", json!({}))).unwrap_err());

    // Backup keeps the flag; restoring brings it back after it was turned off.
    run("backups.create", json!({})).unwrap();
    let id = run("backups.list", json!({})).unwrap()[0]["id"]
        .as_str()
        .unwrap()
        .to_owned();
    run("projects.local_only.set", json!({"enabled":false})).unwrap();
    assert!(!enabled());
    run("backups.restore", json!({"id":id})).unwrap();
    assert!(enabled(), "restore preserves the flag");
    assert_violation(run("provider.structured", structured("packaging", json!({}))).unwrap_err());

    // Closing the Project lifts the veto: it only exists while the Project is open.
    run("projects.close", json!({})).unwrap();
    assert_eq!(
        run("projects.local_only.get", json!({})).unwrap()["open"],
        false
    );
    assert_eq!(
        run("assistant.tasks", json!({})).unwrap()["projectLocalOnly"],
        false
    );
}
