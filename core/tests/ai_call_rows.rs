//! Uma linha de custo por chamada HTTP e por reparo, com o adaptador de verdade falando com um
//! servidor falso em loopback (#124): o `OpenAiProvider` real entra como Provedor injetado. O servidor lê a requisição inteira antes de responder
//! (docs/agents/impedimentos.md). A rota de preço é fixada num alvo pago; a chamada vai a loopback.
#[path = "support/ai_fake.rs"]
mod ai_fake;
use ai_fake::*;
use clipes_core::{
    dispatch,
    jobs::{self, Safety},
    provider::{
        cost::{self, Target},
        OpenAiProvider, Provider, StructuredRequest,
    },
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
                    "HTTP/1.1 {}\r\nRetry-After: 0\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{body}",
                    if content == "429" { "429 Too Many Requests" } else { "200 OK" },
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
    wait_state(repaired, "completed");
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
        call("jobs.budget.get", json!({}))["budgets"]
            .as_array()
            .unwrap()
            .iter()
            .find(|b| b["key"] == "r2")
            .unwrap()["usage"]["calls"],
        1
    );

    // A retentativa após 429 também é uma chamada: o teto não permite escondê-la.
    let endpoint = serve(vec!["429", good]);
    jobs::set_ai_provider(Some(std::sync::Arc::new(
        OpenAiProvider::new(endpoint, "m".into(), None).unwrap(),
    )));
    call(
        "jobs.budget.set",
        json!({"scope":"batch","key":"retry","maxCalls":1}),
    );
    let retry = enqueue("retry", "retry");
    wait_state(retry, "failed");
    assert_eq!(result(retry)["code"], "budget_calls");
    let r = rows(retry);
    assert_eq!(r.len(), 1);
    assert_eq!(r[0]["outcome"], "rate_limit");
    assert_eq!(r[0]["calls"], 1);

    // O reparo envia a resposta anterior: seu custo precisa de estimativa própria.
    let long_bad: &'static str = Box::leak("x".repeat(4000).into_boxed_str());
    let endpoint = serve(vec![long_bad, good]);
    jobs::set_ai_provider(Some(std::sync::Arc::new(
        OpenAiProvider::new(endpoint, "m".into(), None).unwrap(),
    )));
    let estimate = rows(repaired)[0]["estimateMicroUsd"].as_i64().unwrap();
    call(
        "jobs.budget.set",
        json!({"scope":"batch","key":"repair-cost","maxCostMicroUsd": estimate + 2000}),
    );
    let expensive = enqueue("z", "repair-cost");
    wait_state(expensive, "failed");
    assert_eq!(result(expensive)["code"], "budget_cost");
    assert_eq!(rows(expensive).len(), 1);
    assert_eq!(rows(expensive)[0]["outcome"], "invalid_json");

    // O caminho síncrono do #40 usa o mesmo registro por chamada, incluindo o reparo.
    let direct = OpenAiProvider::new(serve(vec![bad, good]), "m".into(), None).unwrap();
    let definition = clipes_core::ai_task::find("example").unwrap();
    let request = StructuredRequest {
        estimate_hint: Default::default(),
        instruction: clipes_core::ai_task::normalized_prompt(definition.prompt),
        transcript: "direct".into(),
        schema: serde_json::from_str(definition.wire_schema).unwrap(),
        native_schema: false,
        max_output_tokens: Some(256),
    };
    cost::run_costed_for(
        Some("p1"),
        &Target::Api {
            provider: "openai".into(),
            model: "m".into(),
            local: false,
        },
        "example",
        Some("direct"),
        || direct.structured(&request),
    )
    .unwrap();
    let direct_rows = call("provider.cost.list", json!({"batch":"direct"}));
    assert_eq!(direct_rows.as_array().unwrap().len(), 2);
    assert_eq!(direct_rows[0]["outcome"], "invalid_json");
    assert_eq!(direct_rows[1]["outcome"], "ok");

    // Test the real call guard, not only a fake Provider that bypasses it.
    let endpoint = serve(vec![good]);
    jobs::set_ai_provider(Some(std::sync::Arc::new(
        OpenAiProvider::new(endpoint, "m".into(), None).unwrap(),
    )));
    for language in ["haw", "private-invalid-value"] {
        let mut data = input("x");
        data.estimate_hint.language = language.into();
        let id =
            jobs::enqueue_ai_in_batch("example", &data, Safety::Paid, Some("bad-hint")).unwrap();
        wait_state(id, "completed");
        assert_eq!(rows(id)[0]["outcome"], "ok");
    }

    jobs::set_ai_route(None);
    dispatch("projects.close", json!({}), &mut |_| {}).unwrap();
    let _ = std::fs::remove_dir_all(root);
}
