//! Uma linha de custo por chamada HTTP e por reparo, com o adaptador de verdade falando com um
//! servidor falso em loopback (#124): o `OpenAiProvider` real entra como Provedor injetado. O servidor lê a requisição inteira antes de responder
//! (docs/agents/impedimentos.md). A rota de preço é fixada num alvo pago; a chamada vai a loopback.
#[path = "support/ai_fake.rs"]
mod ai_fake;
use ai_fake::*;
use clipes_core::{
    dispatch,
    jobs::{self, Safety},
    provider::{cost::Target, OpenAiProvider},
};
use serde_json::{json, Value};
use std::{
    io::{Read, Write},
    net::TcpListener,
    thread,
    time::Duration,
};

fn call(name: &str, args: Value) -> Value {
    dispatch(name, args, &mut |_| {}).unwrap()
}

fn read_request(stream: &mut std::net::TcpStream) {
    stream.set_nonblocking(false).unwrap();
    stream
        .set_read_timeout(Some(Duration::from_secs(3)))
        .unwrap();
    let mut bytes = Vec::new();
    loop {
        let mut chunk = [0; 4096];
        let n = stream.read(&mut chunk).unwrap();
        assert!(n > 0, "request ended before its body");
        bytes.extend_from_slice(&chunk[..n]);
        if let Some(pos) = bytes.windows(4).position(|x| x == b"\r\n\r\n") {
            let length: usize = String::from_utf8_lossy(&bytes[..pos])
                .lines()
                .find_map(|line| {
                    line.split_once(':')
                        .filter(|(name, _)| name.eq_ignore_ascii_case("content-length"))
                        .map(|(_, value)| value.trim().parse().unwrap())
                })
                .expect("missing Content-Length");
            if bytes.len() >= pos + 4 + length {
                return;
            }
        }
    }
}

/// Responde cada requisição na ordem; depois da última lista, repete a última.
fn serve(replies: Vec<&'static str>) -> String {
    let listener = TcpListener::bind("127.0.0.1:0").unwrap();
    let endpoint = format!("http://{}/v1", listener.local_addr().unwrap());
    thread::spawn(move || {
        let mut n = 0;
        for stream in listener.incoming() {
            let Ok(mut stream) = stream else { continue };
            read_request(&mut stream);
            let content = replies[n.min(replies.len() - 1)];
            n += 1;
            let body = json!({
                "choices": [{"message": {"content": content}, "finish_reason": "stop"}],
                "usage": {"prompt_tokens": 10, "completion_tokens": 5}
            })
            .to_string();
            let _ = stream.write_all(
                format!(
                    "HTTP/1.1 200 OK\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{body}",
                    body.len()
                )
                .as_bytes(),
            );
        }
    });
    endpoint
}

fn rows(job: i64) -> Vec<Value> {
    call("provider.cost.list", json!({"job": job}))
        .as_array()
        .unwrap()
        .clone()
}

#[test]
fn a_repair_is_its_own_cost_row_and_the_call_budget_can_forbid_it() {
    let root = std::env::temp_dir().join(format!("clipes-ai-rows-{}", std::process::id()));
    std::fs::create_dir_all(&root).unwrap();
    std::env::set_var("CLIPES_DATA_DIR", root.join("data"));
    call("projects.create", json!({"parent": root, "name": "Canal"}));
    let bad = "not json";
    let good = r#"{"schemaVersion":1,"picks":[]}"#;
    let endpoint = serve(vec![bad, good, bad, good]);
    jobs::set_ai_provider(Some(std::sync::Arc::new(
        OpenAiProvider::new(endpoint, "m".into(), None).unwrap(),
    )));
    call(
        "provider.prices.set",
        json!({"provider":"openai","model":"m","inputPerMillion":100.0,"outputPerMillion":200.0}),
    );
    jobs::set_ai_route(Some((
        Target::Api {
            provider: "openai".into(),
            model: "m".into(),
            local: false,
        },
        "p1".into(),
    )));
    let enqueue = |text: &str, batch: &str| {
        jobs::enqueue_ai_in_batch("example", &input(text), Safety::Paid, Some(batch)).unwrap()
    };

    // Resposta inválida e reparo: duas linhas, tentativa 0 (invalid_json) e tentativa 1 (ok).
    let repaired = enqueue("x", "r1");
    let st = std::time::Instant::now();
    while job_state(repaired) == "running" || job_state(repaired) == "queued" {
        thread::sleep(Duration::from_millis(20));
        assert!(st.elapsed().as_secs() < 20);
    }
    assert_eq!(job_state(repaired), "completed", "{}", result(repaired));
    let r = rows(repaired);
    assert_eq!(r.len(), 2);
    assert_eq!(
        (r[0]["attempt"].as_i64(), r[0]["outcome"].as_str()),
        (Some(0), Some("invalid_json"))
    );
    assert_eq!(
        (r[1]["attempt"].as_i64(), r[1]["outcome"].as_str()),
        (Some(1), Some("ok"))
    );
    for row in &r {
        assert_eq!(row["costKind"], "usd");
        assert_eq!(row["microUsd"], 2000);
        assert_eq!(row["calls"], 1);
        assert_eq!(row["profile"], "p1");
    }

    // Com o limite de chamadas do lote em uma, o reparo não sai: falha cobrada, uma linha.
    call(
        "jobs.budget.set",
        json!({"scope":"batch","key":"r2","maxCalls":1}),
    );
    let forbidden = enqueue("y", "r2");
    wait_state(forbidden, "failed");
    assert_eq!(result(forbidden)["code"], "budget_calls");
    let r = rows(forbidden);
    assert_eq!(r.len(), 1);
    assert_eq!(r[0]["outcome"], "invalid_json");
    assert_eq!(r[0]["microUsd"], 2000);
    assert_eq!(
        call("jobs.budget.get", json!({}))["budgets"][0]["usage"]["calls"],
        1
    );

    jobs::set_ai_route(None);
    dispatch("projects.close", json!({}), &mut |_| {}).unwrap();
    let _ = std::fs::remove_dir_all(root);
}

fn job_state(id: i64) -> String {
    call("jobs.list", json!({}))
        .as_array()
        .unwrap()
        .iter()
        .find(|j| j["id"] == id)
        .unwrap()["state"]
        .as_str()
        .unwrap()
        .into()
}
