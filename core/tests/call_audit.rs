//! Trilha de auditoria do Projeto (#125; ADR-0009 regras 7 a 10, ADR-0006 emenda): uma linha por
//! chamada, só com hashes e metadados, ligada à linha de custo. O adaptador HTTP de verdade fala
//! com um servidor falso em loopback que guarda os bytes recebidos; nenhum teste usa a rede.
#[path = "support/ai_fake.rs"]
mod ai_fake;
use ai_fake::*;
use clipes_core::{
    dispatch,
    jobs::{self, Safety},
    provider::{cost::Target, OpenAiProvider},
};
use serde_json::{json, Value};
use sha2::{Digest, Sha256};
use std::{
    io::{Read, Write},
    net::TcpListener,
    path::Path,
    sync::{Arc, Mutex},
    thread,
    time::Duration,
};

fn call(name: &str, args: Value) -> Value {
    dispatch(name, args, &mut |_| {}).unwrap()
}
fn sha(bytes: &[u8]) -> String {
    format!("{:x}", Sha256::digest(bytes))
}

type Exchanges = Arc<Mutex<Vec<(Vec<u8>, Vec<u8>)>>>;

/// Responde na ordem (a última se repete) e guarda `(corpo recebido, corpo respondido)`.
fn serve(replies: Vec<String>) -> (String, Exchanges) {
    let listener = TcpListener::bind("127.0.0.1:0").unwrap();
    let endpoint = format!("http://{}/v1", listener.local_addr().unwrap());
    let seen: Exchanges = Arc::default();
    let log = seen.clone();
    thread::spawn(move || {
        for (n, stream) in listener.incoming().enumerate() {
            let Ok(mut stream) = stream else { continue };
            stream.set_nonblocking(false).unwrap();
            stream
                .set_read_timeout(Some(Duration::from_secs(3)))
                .unwrap();
            let mut bytes = Vec::new();
            let body = loop {
                let mut chunk = [0; 4096];
                let read = stream.read(&mut chunk).unwrap();
                assert!(read > 0, "request ended before its body");
                bytes.extend_from_slice(&chunk[..read]);
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
                        break bytes[pos + 4..pos + 4 + length].to_vec();
                    }
                }
            };
            let content = &replies[n.min(replies.len() - 1)];
            let reply = json!({
                "choices": [{"message": {"content": content}, "finish_reason": "stop"}],
                "usage": {"prompt_tokens": 10, "completion_tokens": 5}
            })
            .to_string();
            log.lock().unwrap().push((body, reply.clone().into_bytes()));
            let _ = stream.write_all(
                format!(
                    "HTTP/1.1 200 OK\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{reply}",
                    reply.len()
                )
                .as_bytes(),
            );
        }
    });
    (endpoint, seen)
}

fn files_under(dir: &Path, out: &mut Vec<std::path::PathBuf>) {
    for entry in std::fs::read_dir(dir).into_iter().flatten().flatten() {
        let path = entry.path();
        if path.is_dir() {
            files_under(&path, out);
        } else {
            out.push(path);
        }
    }
}

fn contains(bytes: &[u8], needle: &str) -> bool {
    bytes.windows(needle.len()).any(|w| w == needle.as_bytes())
}

#[test]
fn the_audit_trail_has_hashes_and_metadata_and_no_text_anywhere_else() {
    // Texto-sentinela único: na Transcrição, no Roteiro (contexto) e na resposta do servidor.
    let sentinel = format!(
        "SENTINELA-{}-{:x}",
        std::process::id(),
        std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap()
            .as_nanos()
    );
    let root = std::env::temp_dir().join(format!("clipes-call-audit-{}", std::process::id()));
    std::fs::create_dir_all(&root).unwrap();
    let data = root.join("data");
    std::env::set_var("CLIPES_DATA_DIR", &data);
    call("projects.create", json!({"parent": root, "name": "Canal"}));
    call(
        "provider.prices.set",
        json!({"provider":"openai","model":"private-model-m7","inputPerMillion":100.0,"outputPerMillion":200.0}),
    );

    // A primeira resposta é inválida e leva o sentinela (cobrada, vira reparo); a segunda é boa.
    let bad = format!("not json {sentinel}");
    let good = r#"{"schemaVersion":1,"picks":[]}"#.to_string();
    let (endpoint, seen) = serve(vec![bad, good]);
    jobs::set_ai_provider(Some(Arc::new(
        OpenAiProvider::new(endpoint, "private-model-m7".into(), None).unwrap(),
    )));
    jobs::set_ai_route(Some((
        Target::Api {
            provider: "openai".into(),
            model: "private-model-m7".into(),
            local: false,
        },
        "private-profile-p7".into(),
    )));
    let mut data_in = input(&format!("fala do canal {sentinel}"));
    data_in.context = json!({"ids": [1, 2, 3], "script": format!("roteiro {sentinel}")});
    let id = jobs::enqueue_ai("example", &data_in, Safety::Paid).unwrap();
    wait_state(id, "completed");

    // Controle positivo: duas linhas (a chamada e o reparo), ligadas às de custo.
    let audit = call("provider.audit.list", json!({"job": id}));
    let audit = audit.as_array().unwrap();
    let costs = call("provider.cost.list", json!({"job": id}));
    assert_eq!(audit.len(), 2);
    assert_eq!(costs.as_array().unwrap().len(), 2);
    let seen = seen.lock().unwrap().clone();
    assert_eq!(seen.len(), 2);
    let prompt_hash = "9b4e7b18b09bbdc1aa0e17f38f2af8e045c679b6c7e6f86068201ab399e8b1ae";
    for (row, (sent, received)) in audit.iter().zip(&seen) {
        assert_eq!(row["providerKind"], "openai");
        assert_eq!(row["host"], "127.0.0.1");
        assert_eq!(row["model"], "private-model-m7");
        assert_eq!(row["task"], "example");
        assert_eq!(row["taskVersion"], 1);
        assert_eq!(row["promptSha256"], prompt_hash);
        assert_eq!(row["inputSha256"], sha(sent));
        assert_eq!(row["sentBytes"], sent.len());
        assert_eq!(row["responseSha256"], sha(received));
        assert!(row["costId"].is_i64());
        assert_eq!(row["job"], id);
    }
    assert_eq!(audit[0]["outcome"], "invalid_json");
    assert_eq!(audit[1]["outcome"], "ok");
    assert_ne!(audit[0]["inputSha256"], audit[1]["inputSha256"]);
    // O sentinela realmente foi enviado (o hash o cobre) e voltou na resposta.
    assert!(contains(&seen[0].0, &sentinel));
    assert!(contains(&seen[0].1, &sentinel));

    // Nada de texto na trilha nem no custo.
    for text in [
        serde_json::to_string(&audit).unwrap(),
        serde_json::to_string(&costs).unwrap(),
    ] {
        assert!(!text.contains(&sentinel));
    }
    // Nem em arquivo algum do diretório de dados (log local, índice, configurações).
    let mut files = Vec::new();
    files_under(&data, &mut files);
    for file in files {
        assert!(
            !contains(&std::fs::read(&file).unwrap(), &sentinel),
            "sentinel in {}",
            file.display()
        );
    }

    // Diagnóstico: só os dois campos novos; hashes de entrada e resposta, host, perfil e modelo
    // ficam fora, e o sentinela também.
    let text = call("diagnostic.get", json!({}))["text"]
        .as_str()
        .unwrap()
        .to_owned();
    assert!(text.contains("Versão da Tarefa de IA: 1"));
    assert!(text.contains(&format!("Hash do prompt (SHA-256): {prompt_hash}")));
    let mut forbidden = vec![
        sentinel.clone(),
        "127.0.0.1".to_string(),
        "private-model-m7".to_string(),
        "private-profile-p7".to_string(),
    ];
    for row in audit {
        forbidden.push(row["inputSha256"].as_str().unwrap().into());
        forbidden.push(row["responseSha256"].as_str().unwrap().into());
    }
    for value in &forbidden {
        assert!(!text.contains(value.as_str()), "diagnostic leaks {value}");
    }
    let exported = root.join("diagnostic.txt");
    call("diagnostic.export", json!({"path": exported, "text": text}));
    let exported = std::fs::read_to_string(exported).unwrap();
    for value in &forbidden {
        assert!(!exported.contains(value.as_str()));
    }

    // Um Projeto compartilhado pode trazer qualquer valor: só hex de 64 caracteres sai.
    clipes_core::projects::with_writer(|c| {
        c.execute(
            "UPDATE call_audit SET prompt_sha256=NULL WHERE cost_id IN (SELECT id FROM provider_costs WHERE outcome<>'ok')",
            [],
        )?;
        Ok(())
    })
    .unwrap();
    let text = call("diagnostic.get", json!({}))["text"]
        .as_str()
        .unwrap()
        .to_owned();
    assert!(text.contains(&format!("Hash do prompt (SHA-256): {prompt_hash}")));
    let injected = "Z".repeat(64);
    clipes_core::projects::with_writer(|c| {
        c.execute("UPDATE call_audit SET prompt_sha256=?1", [&injected])?;
        c.execute("UPDATE provider_costs SET task_version=-7", [])?;
        Ok(())
    })
    .unwrap();
    let text = call("diagnostic.get", json!({}))["text"]
        .as_str()
        .unwrap()
        .to_owned();
    assert!(!text.contains(&injected));
    assert!(text.contains("Versão da Tarefa de IA: indisponível"));
    assert!(text.contains("Hash do prompt (SHA-256): indisponível"));

    jobs::set_ai_route(None);
    dispatch("projects.close", json!({}), &mut |_| {}).unwrap();
    let _ = std::fs::remove_dir_all(root);
}
