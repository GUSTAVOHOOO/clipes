//! Tarefa → Perfil de Provedor e "somente local" por tarefa (#120). Sem rede: o servidor falso
//! escuta só em loopback e os endereços "remotos" são IPs literais reservados para documentação
//! (192.0.2.0/24) ou de LAN, que a recusa nunca chega a contactar.
use clipes_core::{dispatch, CoreError};
use serde_json::{json, Value};
use std::{
    env, fs,
    io::{Read, Write},
    net::TcpListener,
    thread,
    time::{Duration, Instant},
};

const REMOTE: &str = "https://192.0.2.10/v1";
const LAN: &str = "http://192.168.0.2:1234/v1";
const SECRET: &str = "SEGREDO-DA-TRANSCRICAO-731";

fn run(name: &str, args: Value) -> Result<Value, CoreError> {
    dispatch(name, args, &mut |_| {})
}

/// Loopback fake: answers every request with a valid structured reply, after reading it whole
/// (the Windows CI needs the full request read before closing).
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
    // No usage: `run_costed` records nothing for a call that never happened.
    assert!(error.usage.is_none());
    let shown = serde_json::to_string(&error).unwrap();
    for leak in [SECRET, "192.0.2", "192.168", "127.0.0.1"] {
        assert!(!shown.contains(leak), "{leak}");
    }
}

#[test]
fn task_to_profile_and_local_only() {
    let root = env::temp_dir().join(format!("clipes-task-profiles-{}", std::process::id()));
    let _ = fs::remove_dir_all(&root);
    fs::create_dir_all(&root).unwrap();
    env::set_var("CLIPES_DATA_DIR", root.join("data"));
    let local = fake_local();
    configure("local", &local, "qwen-local");
    configure("remote", REMOTE, "cheap");
    configure("lan", LAN, "lan-model");
    // A confirmed remote endpoint: only the veto, never the consent, may stop the call.
    run(
        "provider.confirm",
        json!({"profileId":"remote","endpoint":REMOTE}),
    )
    .unwrap();

    // Nothing is chosen out of the box and the assistant only suggests, as "not measured".
    let status = run("assistant.status", json!({})).unwrap();
    assert_eq!(status["default"], "");
    assert_eq!(status["tasks"]["selection"], "");
    let table = run("assistant.tasks", json!({})).unwrap();
    let row = |table: &Value, task: &str| {
        table["tasks"]
            .as_array()
            .unwrap()
            .iter()
            .find(|r| r["task"] == task)
            .unwrap()
            .clone()
    };
    let selection = row(&table, "selection");
    assert_eq!(selection["source"], "none");
    assert!(selection["profile"].is_null());
    assert_eq!(selection["suggestion"]["choice"], "profile:local");
    assert_eq!(selection["suggestion"]["measured"], false);
    assert_eq!(
        run("assistant.status", json!({})).unwrap()["tasks"]["selection"],
        "",
        "the suggestion is never applied on its own"
    );

    // `profile:<id>` is accepted for existing profiles only; the CLIs keep their old values.
    for bad in ["profile:ghost", "profile:codex", "profile:", "profile"] {
        let error = run(
            "assistant.task.set",
            json!({"task":"selection","choice":bad}),
        )
        .unwrap_err();
        assert_eq!(error.code, "invalid_settings", "{bad}");
    }
    // Changing one task leaves the others (and the default) alone.
    run(
        "assistant.task.set",
        json!({"task":"selection","choice":"profile:local"}),
    )
    .unwrap();
    run(
        "assistant.task.set",
        json!({"task":"packaging","choice":"profile:remote"}),
    )
    .unwrap();
    let before = run("assistant.status", json!({})).unwrap();
    run(
        "assistant.task.set",
        json!({"task":"script","choice":"profile:lan"}),
    )
    .unwrap();
    run(
        "assistant.task.set",
        json!({"task":"script","choice":"endpoint"}),
    )
    .unwrap();
    let after = run("assistant.status", json!({})).unwrap();
    assert_eq!(
        after["tasks"]["script"], "endpoint",
        "old values stay verbatim"
    );
    for task in ["selection", "packaging", "translation"] {
        assert_eq!(before["tasks"][task], after["tasks"][task], "{task}");
    }
    assert_eq!(after["tasks"]["selection"], "profile:local");
    assert_eq!(after["tasks"]["packaging"], "profile:remote");
    assert_eq!(after["default"], before["default"]);
    run("assistant.task.set", json!({"task":"script","choice":""})).unwrap();

    // The table shows profile, locality seal and price per (kind, model).
    let table = run("assistant.tasks", json!({})).unwrap();
    let selection = row(&table, "selection");
    assert_eq!(selection["profile"]["label"], "local");
    assert_eq!(selection["profile"]["local"], true);
    assert_eq!(selection["profile"]["cost"]["kind"], "zero");
    let packaging = row(&table, "packaging");
    assert_eq!(packaging["profile"]["local"], false);
    assert_eq!(packaging["profile"]["cost"]["kind"], "unknown");
    run(
        "provider.prices.set",
        json!({"provider":"openai","model":"cheap","inputPerMillion":0.5,"outputPerMillion":1.5}),
    )
    .unwrap();
    let packaging = row(&run("assistant.tasks", json!({})).unwrap(), "packaging");
    assert_eq!(packaging["profile"]["cost"]["kind"], "usd");
    assert_eq!(packaging["profile"]["cost"]["inputPerMillion"], 0.5);

    // The profile and model that served a call are returned, and the estimate follows the task.
    let out = run("provider.cost.run", structured("selection", json!({}))).unwrap();
    assert_eq!(out["route"]["profileId"], "local");
    assert_eq!(out["route"]["model"], "qwen-local");
    let estimate = run("provider.cost.estimate", structured("selection", json!({}))).unwrap();
    assert_eq!(estimate["profileId"], "local");
    assert_eq!(estimate["kind"], "zero");
    let estimate = run("provider.cost.estimate", structured("packaging", json!({}))).unwrap();
    assert_eq!(estimate["profileId"], "remote");
    assert_eq!(estimate["kind"], "usd");
    assert_eq!(estimate["priceSource"], "override");

    // "Local only" refuses a non-loopback profile before any network access, and the
    // refusal carries neither text, endpoint nor Project name.
    run(
        "assistant.local_only.set",
        json!({"task":"packaging","enabled":true}),
    )
    .unwrap();
    let began = Instant::now();
    assert_violation(run("provider.structured", structured("packaging", json!({}))).unwrap_err());
    assert_violation(
        run("provider.cost.estimate", structured("packaging", json!({}))).unwrap_err(),
    );
    assert_violation(run("provider.cost.run", structured("packaging", json!({}))).unwrap_err());
    // An explicit profileId does not bypass the veto, and a LAN server is not local.
    for id in ["remote", "lan"] {
        let args = structured("packaging", json!({"profileId":id}));
        assert_violation(run("provider.structured", args).unwrap_err());
    }
    assert!(
        began.elapsed() < Duration::from_secs(2),
        "refused without connecting"
    );
    // Other tasks are untouched, and a local profile passes the veto.
    assert_eq!(
        run("provider.cost.run", structured("selection", json!({})))
            .map(|v| v["route"]["profileId"].clone())
            .unwrap(),
        "local"
    );
    run(
        "assistant.task.set",
        json!({"task":"packaging","choice":"profile:local"}),
    )
    .unwrap();
    assert_eq!(
        run("provider.cost.run", structured("packaging", json!({})))
            .map(|v| v["route"]["profileId"].clone())
            .unwrap(),
        "local"
    );
    assert!(row(&run("assistant.tasks", json!({})).unwrap(), "packaging")["blocked"] == false);
    // The veto is on the task: turning it off allows the remote profile again (it would
    // connect, so only the resolution is checked here).
    run(
        "assistant.task.set",
        json!({"task":"packaging","choice":"profile:lan"}),
    )
    .unwrap();
    assert_eq!(
        row(&run("assistant.tasks", json!({})).unwrap(), "packaging")["blocked"],
        true
    );
    run(
        "assistant.local_only.set",
        json!({"task":"packaging","enabled":false}),
    )
    .unwrap();
    assert_eq!(
        row(&run("assistant.tasks", json!({})).unwrap(), "packaging")["blocked"],
        false
    );
    assert_eq!(
        run("assistant.status", json!({})).unwrap()["localOnly"]["packaging"],
        false
    );

    // CLIs are never local: a chosen CLI and the old "selected CLI" path are both refused.
    run("provider.cli.configure", json!({"kind":"codex"})).unwrap();
    run("provider.cli.confirm", json!({"kind":"codex"})).unwrap();
    run(
        "assistant.local_only.set",
        json!({"task":"translation","enabled":true}),
    )
    .unwrap();
    assert_violation(run("provider.structured", structured("translation", json!({}))).unwrap_err());
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

    // A refusal leaves nothing in the diagnostic.
    let diagnostic = run("diagnostic.get", json!({})).unwrap().to_string();
    assert!(!diagnostic.contains(SECRET) && !diagnostic.contains("192.0.2"));

    // A removed profile: the task goes back to "no choice", the UI is told, and the call is
    // refused. It never falls to the default or to another profile.
    run(
        "assistant.task.set",
        json!({"task":"packaging","choice":""}),
    )
    .unwrap();
    run("assistant.default.set", json!({"choice":"profile:local"})).unwrap();
    run(
        "assistant.task.set",
        json!({"task":"selection","choice":"profile:lan"}),
    )
    .unwrap();
    run("provider.profiles.remove", json!({"profileId":"lan"})).unwrap();
    let status = run("assistant.status", json!({})).unwrap();
    assert_eq!(status["tasks"]["selection"], "");
    assert_eq!(status["missing"]["selection"], "lan");
    assert_eq!(status["default"], "profile:local");
    let gone = row(&run("assistant.tasks", json!({})).unwrap(), "selection");
    assert_eq!(gone["missing"], "lan");
    assert!(gone["profile"].is_null());
    let error = run("provider.structured", structured("selection", json!({}))).unwrap_err();
    assert_eq!(error.code, "profile_unavailable");
    assert_eq!(error.message, "The chosen profile no longer exists");
    // Other tasks keep working, and clearing the choice returns to the default on purpose.
    assert!(run("provider.structured", structured("script", json!({}))).is_ok());
    run(
        "assistant.task.set",
        json!({"task":"selection","choice":""}),
    )
    .unwrap();
    assert!(run("assistant.status", json!({})).unwrap()["missing"]
        .as_object()
        .unwrap()
        .is_empty());

    // The Project record carries the profile id.
    run("projects.create", json!({"parent":root,"name":"Canal"})).unwrap();
    let out = run("provider.cost.run", structured("selection", json!({}))).unwrap();
    assert_eq!(out["route"]["profileId"], "local");
    assert_eq!(out["cost"]["recorded"], true);
    let list = run("provider.cost.list", json!({})).unwrap();
    assert_eq!(list[0]["profile"], "local");
    assert_eq!(list[0]["model"], "qwen-local");
}
