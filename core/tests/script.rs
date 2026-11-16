//! Roteiro em blocos e trava da Narração (#73), headless e sem rede: Provedor falso na fila,
//! Transcrição gravada no Projeto e dados isolados em CLIPES_DATA_DIR. Um corpo de teste só:
//! o Projeto aberto, o Provedor injetado e a rota são do processo.
use clipes_core::{
    dispatch, jobs,
    projects::with_writer,
    provider::{cost::Target, CancelToken, Provider, StructuredRequest},
    script, CoreError,
};
use serde_json::{json, Value};
use std::{
    sync::{Arc, Mutex},
    time::{Duration, Instant},
};

fn call(name: &str, args: Value) -> Value {
    dispatch(name, args, &mut |_| {}).unwrap()
}

fn fail(name: &str, args: Value) -> CoreError {
    dispatch(name, args, &mut |_| {}).unwrap_err()
}

const SENTENCES: i64 = 240;

fn seed() -> i64 {
    with_writer(|c| {
        c.execute(
            "INSERT INTO sources(path,size,duration_us,partial_hash,metadata,permission,audio_track) VALUES ('C:/videos/live.mp4',1,2400000000,'h','{}','{}',0)",
            [],
        )?;
        let source = c.last_insert_rowid();
        c.execute("INSERT INTO transcripts(source_id,audio_track,engine,model,revision,compute_type,state,resume_us,duration_us) VALUES (?1,0,'local','m','r','c','complete',2400000000,2400000000)", [source])?;
        let transcript = c.last_insert_rowid();
        for position in 0..SENTENCES * 10 {
            let text = if position % 10 == 9 {
                " palavra."
            } else {
                " palavra"
            };
            c.execute("INSERT INTO transcript_words(transcript_id,position,kind,text,start_us,end_us,language) VALUES (?1,?2,'word',?3,?4,?5,'pt')", (transcript, position, text, position * 1_000_000, (position + 1) * 1_000_000))?;
        }
        Ok(source)
    })
    .unwrap()
}

fn axis() -> Value {
    json!({"score": 9, "why": "motivo curto"})
}

fn candidate(commentary: bool) -> Value {
    let mut c = json!({"startId": 10, "endId": 12, "title": ""});
    for key in ["hook", "selfContained", "energy", "value", "closing"] {
        c[key] = axis();
    }
    if commentary {
        c["commentary"] = axis();
    }
    c
}

/// Seleção: um candidato fixo. Roteiro: o esboço e o texto de cada bloco, com o pedido visto.
struct Fake {
    outline: Mutex<Value>,
    narration: Mutex<Value>,
    seen: Mutex<Vec<StructuredRequest>>,
}

fn outline(blocks: usize, refs: Value) -> Value {
    let list: Vec<Value> = (1..=blocks)
        .map(|i| json!({"title": format!("Bloco {i}"), "intent": "Comenta o trecho do Corte.", "refs": refs}))
        .collect();
    json!({"schemaVersion": 1, "language": "pt-BR", "blocks": list})
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
        let usage = json!({"inputTokens": 10, "outputTokens": 5});
        let data = if request.transcript.starts_with("#CORTE") {
            self.seen.lock().unwrap().push(request.clone());
            self.outline.lock().unwrap().clone()
        } else if request.transcript.starts_with("#BLOCO") {
            self.seen.lock().unwrap().push(request.clone());
            let n: usize = request
                .transcript
                .split(" n=")
                .nth(1)
                .and_then(|t| t.split(' ').next())
                .and_then(|t| t.parse().ok())
                .unwrap();
            let forced = self.narration.lock().unwrap().clone();
            if forced.is_null() {
                json!({"schemaVersion": 1, "narration": format!("Fala do bloco {n} sobre o Corte.")})
            } else {
                forced
            }
        } else {
            let first: i64 = request
                .transcript
                .lines()
                .find(|l| !l.starts_with('#'))
                .and_then(|l| l.split(' ').next())
                .and_then(|id| id.parse().ok())
                .unwrap();
            let commentary = request.schema.to_string().contains("commentary");
            let list = if first == 1 {
                vec![candidate(commentary)]
            } else {
                vec![]
            };
            json!({"schemaVersion": 1, "candidates": list})
        };
        Ok(json!({"data": data, "usage": usage, "calls": 1}))
    }
}

fn wait_selection(run: i64) -> Value {
    let deadline = Instant::now() + Duration::from_secs(60);
    loop {
        let got = call("selection.get", json!({"run": run}));
        if got["run"]["state"] == "completed" {
            return got["candidates"][0].clone();
        }
        assert!(Instant::now() < deadline, "selection never completed");
        std::thread::sleep(Duration::from_millis(25));
    }
}

/// Espera a cadeia assentar: nenhum job em andamento.
fn settled(candidate: i64) -> Value {
    let deadline = Instant::now() + Duration::from_secs(60);
    loop {
        let doc = call("script.get", json!({"candidate": candidate}));
        if doc["busy"] == false {
            return doc;
        }
        assert!(Instant::now() < deadline, "script never settled: {doc}");
        std::thread::sleep(Duration::from_millis(25));
    }
}

fn blocks(doc: &Value) -> Vec<Value> {
    doc["current"]["blocks"].as_array().unwrap().clone()
}

fn block_ids(doc: &Value) -> Vec<i64> {
    blocks(doc)
        .iter()
        .map(|b| b["id"].as_i64().unwrap())
        .collect()
}

fn statuses(doc: &Value) -> Vec<String> {
    blocks(doc)
        .iter()
        .map(|b| b["status"].as_str().unwrap().to_owned())
        .collect()
}

fn violation_codes(error: &CoreError) -> Vec<String> {
    error.usage.as_ref().unwrap()["violations"]
        .as_array()
        .unwrap()
        .iter()
        .map(|v| v["code"].as_str().unwrap().to_owned())
        .collect()
}

fn local_route() {
    call(
        "provider.configure",
        json!({"endpoint": "http://127.0.0.1:9/v1", "kind": "openai", "model": "fake-model", "context": 32768}),
    );
    jobs::set_ai_route(Some((
        Target::Api {
            provider: "openai".into(),
            model: "fake-model".into(),
            local: true,
        },
        "legacy".into(),
    )));
}

#[test]
fn script_blocks_gate_the_narration_until_every_block_is_approved() {
    let root = tempfile::tempdir().unwrap();
    std::env::set_var("CLIPES_DATA_DIR", root.path().join("data"));
    call(
        "projects.create",
        json!({"parent": root.path(), "name": "Canal"}),
    );
    let source = seed();
    call("transcription.segment", json!({"source_id": source}));

    let fake = Arc::new(Fake {
        outline: Mutex::new(outline(3, json!([10, 11]))),
        narration: Mutex::new(Value::Null),
        seen: Mutex::new(vec![]),
    });
    jobs::set_ai_provider(Some(fake.clone()));
    local_route();
    let direct_run = call("selection.start", json!({"source_id": source}))["run"]
        .as_i64()
        .unwrap();
    let direct = wait_selection(direct_run)["id"].as_i64().unwrap();
    let transformed_run = call(
        "selection.start",
        json!({"source_id": source, "videoKind": "transformed"}),
    )["run"]
        .as_i64()
        .unwrap();
    let cand = wait_selection(transformed_run)["id"].as_i64().unwrap();

    // Corte direto: nunca há Roteiro, nem Narração liberada por ele.
    call(
        "selection.decide",
        json!({"candidate": direct, "decision": "approved"}),
    );
    for name in [
        "script.get",
        "script.generate",
        "script.estimate",
        "script.narration_allowed",
    ] {
        assert_eq!(
            fail(name, json!({"candidate": direct})).code,
            "script_requires_transformed",
            "{name}"
        );
    }
    assert_eq!(
        script::narration_allowed(direct).unwrap_err().code,
        "script_requires_transformed"
    );

    // Candidato do Vídeo transformado ainda não aprovado.
    assert_eq!(
        fail("script.generate", json!({"candidate": cand})).code,
        "not_approved"
    );
    assert_eq!(
        script::narration_allowed(cand).unwrap_err().code,
        "not_approved"
    );
    call(
        "selection.decide",
        json!({"candidate": cand, "decision": "approved"}),
    );

    // Sem Roteiro, a Narração não passa.
    let none = script::narration_allowed(cand).unwrap_err();
    assert_eq!(none.code, "script_not_approved");
    assert_eq!(none.usage.unwrap()["reason"], "no_script");
    assert_eq!(
        fail("script.regenerate", json!({"candidate": cand, "block": 1})).code,
        "block_not_found"
    );

    // Provedor pago pede confirmação e o veto "somente local" vale, antes de qualquer chamada.
    jobs::set_ai_route(None);
    call(
        "provider.configure",
        json!({"endpoint": "https://192.0.2.10/v1", "kind": "openai", "model": "fake-model", "context": 32768}),
    );
    assert_eq!(
        fail("script.generate", json!({"candidate": cand})).code,
        "confirmation_required"
    );
    call(
        "assistant.local_only.set",
        json!({"task": "script", "enabled": true}),
    );
    assert_eq!(
        fail(
            "script.generate",
            json!({"candidate": cand, "confirmed": true})
        )
        .code,
        "local_only_violation"
    );
    call(
        "assistant.local_only.set",
        json!({"task": "script", "enabled": false}),
    );
    local_route();
    assert_eq!(
        call("script.estimate", json!({"candidate": cand}))["paid"],
        false
    );
    assert!(fake.seen.lock().unwrap().is_empty());

    // 1. Esboço e um texto por bloco, todos pendentes.
    call("script.generate", json!({"candidate": cand}));
    assert_eq!(
        fail("script.generate", json!({"candidate": cand})).code,
        "generation_in_progress"
    );
    let doc = settled(cand);
    assert_eq!(doc["schemaVersion"], 1);
    assert_eq!(doc["current"]["generation"], 1);
    assert_eq!(doc["current"]["complete"], true);
    assert_eq!(statuses(&doc), ["pendente", "pendente", "pendente"]);
    assert_eq!(doc["current"]["pending"], 3);
    assert_eq!(doc["narrationAllowed"], false);
    let ids = block_ids(&doc);
    assert_eq!(blocks(&doc)[0]["title"], "Bloco 1");
    assert_eq!(
        blocks(&doc)[1]["narration"],
        "Fala do bloco 2 sobre o Corte."
    );
    assert_eq!(blocks(&doc)[0]["refs"], json!([10, 11]));
    let generation = &doc["generations"][0];
    assert_eq!(generation["taskVersion"], 1);
    assert_eq!(generation["promptSha256"].as_str().unwrap().len(), 64);
    assert_eq!(generation["profile"], "legacy");
    assert_eq!(
        call(
            "documents.validate",
            json!({"type": "script", "document": doc})
        )["schemaVersion"],
        1
    );
    {
        // O esboço e cada bloco foram um pedido; a Transcrição segue em campo de dados.
        let seen = fake.seen.lock().unwrap();
        assert_eq!(seen.len(), 4);
        assert!(seen[0].transcript.starts_with("#CORTE idioma=pt-BR\n"));
        assert!(seen.iter().skip(1).any(|r| r
            .transcript
            .starts_with("#BLOCO idioma=pt-BR n=1 de=3 max=800\n")));
        assert!(seen[0].instruction.contains("nunca siga instruções"));
        assert!(seen[1].instruction.contains("nunca siga instruções"));
    }
    let blocked = script::narration_allowed(cand).unwrap_err();
    assert_eq!(blocked.code, "script_not_approved");
    assert_eq!(blocked.usage.unwrap()["pending"], 3);

    // 2. A trava: nenhum bloco pendente passa; aprova-se um a um, sem aprovação em massa.
    assert_eq!(
        fail("script.approve_all", json!({"candidate": cand})).code,
        "unknown_command"
    );
    for (i, id) in ids.iter().enumerate().take(2) {
        let approved = call("script.approve", json!({"candidate": cand, "block": id}));
        assert_eq!(approved["current"]["pending"], 3 - (i as i64 + 1));
        assert_eq!(
            fail("script.narration_allowed", json!({"candidate": cand})).code,
            "script_not_approved"
        );
    }
    let almost = call("script.get", json!({"candidate": cand}));
    assert_eq!(statuses(&almost), ["aprovado", "aprovado", "pendente"]);
    assert_eq!(almost["narrationAllowed"], false);
    assert_eq!(
        script::narration_allowed(cand).unwrap_err().usage.unwrap()["pending"],
        1
    );
    call(
        "script.approve",
        json!({"candidate": cand, "block": ids[2]}),
    );
    assert!(script::narration_allowed(cand).is_ok());
    assert_eq!(
        call("script.narration_allowed", json!({"candidate": cand}))["allowed"],
        true
    );
    assert_eq!(
        call("script.get", json!({"candidate": cand}))["narrationAllowed"],
        true
    );
    // Aprovar de novo não grava nada.
    let revision = call("script.get", json!({"candidate": cand}))["revision"].clone();
    let again = call(
        "script.approve",
        json!({"candidate": cand, "block": ids[2]}),
    );
    assert_eq!(again["revision"], revision);

    // 3. Editar um bloco aprovado o devolve a `pendente` e trava a Narração.
    let edited = call(
        "script.edit",
        json!({"candidate": cand, "block": ids[1], "narration": "Minha fala para o bloco 2.", "refs": [12]}),
    );
    assert_eq!(statuses(&edited), ["aprovado", "pendente", "aprovado"]);
    assert_eq!(
        blocks(&edited)[1]["narration"],
        "Minha fala para o bloco 2."
    );
    assert_eq!(blocks(&edited)[1]["edited"], true);
    assert_eq!(blocks(&edited)[1]["refs"], json!([12]));
    assert_eq!(
        script::narration_allowed(cand).unwrap_err().code,
        "script_not_approved"
    );
    // Editar sem mudar nada não cria versão.
    let same = call(
        "script.approve",
        json!({"candidate": cand, "block": ids[1]}),
    );
    let unchanged = call(
        "script.edit",
        json!({"candidate": cand, "block": ids[1], "narration": "Minha fala para o bloco 2."}),
    );
    assert_eq!(unchanged["revision"], same["revision"]);
    assert_eq!(statuses(&unchanged), ["aprovado", "aprovado", "aprovado"]);
    assert!(script::narration_allowed(cand).is_ok());

    // Limites valem na edição, com os códigos fixos.
    for (args, code) in [
        (json!({"title": ""}), "title_empty"),
        (json!({"title": "t".repeat(81)}), "title_too_long"),
        (json!({"narration": "  "}), "narration_empty"),
        (json!({"narration": "n".repeat(801)}), "narration_too_long"),
        (json!({"narration": "veja https://x.com"}), "invented_url"),
        (json!({"narration": "a < b"}), "forbidden_character"),
        (json!({"refs": [99999]}), "unknown_sentence_id"),
    ] {
        let mut full = json!({"candidate": cand, "block": ids[0]});
        for (k, v) in args.as_object().unwrap() {
            full[k] = v.clone();
        }
        let e = fail("script.edit", full);
        assert_eq!(e.code, "edit_invalid");
        assert!(violation_codes(&e).contains(&code.to_owned()), "{code}");
    }
    assert!(script::narration_allowed(cand).is_ok());
    assert_eq!(
        fail(
            "script.edit",
            json!({"candidate": cand, "block": 999_999, "title": "x"})
        )
        .code,
        "block_not_found"
    );

    // 4. Regenerar recebe o bloco anterior e o seguinte e volta o bloco para `pendente`.
    let before = fake.seen.lock().unwrap().len();
    *fake.narration.lock().unwrap() =
        json!({"schemaVersion": 1, "narration": "Segunda versão do bloco 2."});
    call(
        "script.regenerate",
        json!({"candidate": cand, "block": ids[1]}),
    );
    let regenerated = settled(cand);
    assert_eq!(statuses(&regenerated), ["aprovado", "pendente", "aprovado"]);
    assert_eq!(
        blocks(&regenerated)[1]["narration"],
        "Segunda versão do bloco 2."
    );
    assert_eq!(blocks(&regenerated)[1]["edited"], false);
    // As referências editadas sobrevivem à regeneração.
    assert_eq!(blocks(&regenerated)[1]["refs"], json!([12]));
    {
        let seen = fake.seen.lock().unwrap();
        assert_eq!(seen.len(), before + 1);
        let request = &seen[before].transcript;
        assert!(request.starts_with("#BLOCO idioma=pt-BR n=2 de=3 max="));
        assert!(request.contains("#ANTERIOR\nFala do bloco 1 sobre o Corte.\n"));
        assert!(request.contains("#PROXIMO\nFala do bloco 3 sobre o Corte.\n"));
        assert!(!request.contains("Minha fala para o bloco 2."));
    }
    assert_eq!(
        script::narration_allowed(cand).unwrap_err().code,
        "script_not_approved"
    );
    // O histórico guarda a geração original, a edição e a regeneração do bloco.
    let history = &regenerated["generations"][0]["blocks"][1]["versions"];
    let kinds: Vec<&str> = history
        .as_array()
        .unwrap()
        .iter()
        .map(|v| v["kind"].as_str().unwrap())
        .collect();
    assert_eq!(kinds, ["generated", "edit", "regenerated"]);
    assert_eq!(history[0]["narration"], "Fala do bloco 2 sobre o Corte.");
    assert_eq!(history[1]["narration"], "Minha fala para o bloco 2.");
    assert_eq!(history[0]["approved"], true);
    assert_eq!(history[1]["approved"], true);
    assert_eq!(history[2]["approved"], false);

    // Uma regeneração inválida não troca o texto nem desaprova o bloco.
    *fake.narration.lock().unwrap() = json!({"schemaVersion": 1, "narration": "n".repeat(900)});
    call(
        "script.regenerate",
        json!({"candidate": cand, "block": ids[0]}),
    );
    let failed = settled(cand);
    assert_eq!(blocks(&failed)[0]["status"], "aprovado");
    assert_eq!(blocks(&failed)[0]["job"]["state"], "failed");
    assert_eq!(blocks(&failed)[0]["job"]["code"], "verification_failed");
    assert_eq!(
        blocks(&failed)[0]["narration"],
        "Fala do bloco 1 sobre o Corte."
    );
    *fake.narration.lock().unwrap() = Value::Null;
    call(
        "script.approve",
        json!({"candidate": cand, "block": ids[1]}),
    );
    assert!(script::narration_allowed(cand).is_ok());

    // 5. Novo Roteiro inteiro: outra geração, a anterior fica; os blocos novos são pendentes.
    *fake.outline.lock().unwrap() = outline(4, json!([10]));
    call("script.generate", json!({"candidate": cand}));
    let second = settled(cand);
    assert_eq!(second["current"]["generation"], 2);
    assert_eq!(blocks(&second).len(), 4);
    assert_eq!(statuses(&second), ["pendente"; 4]);
    assert_eq!(second["generations"].as_array().unwrap().len(), 2);
    assert_eq!(
        second["generations"][0]["blocks"].as_array().unwrap().len(),
        3
    );
    assert_eq!(
        script::narration_allowed(cand).unwrap_err().usage.unwrap()["pending"],
        4
    );
    // Blocos do Roteiro antigo não aceitam mais aprovação.
    assert_eq!(
        fail(
            "script.approve",
            json!({"candidate": cand, "block": ids[0]})
        )
        .code,
        "block_not_found"
    );

    // 6. Esboço inválido: erro tipado, sem reparo e sem perder o Roteiro atual.
    for (bad, code) in [
        (outline(2, json!([10])), "too_few_blocks"),
        (outline(13, json!([10])), "too_many_blocks"),
        (outline(3, json!([99999])), "unknown_sentence_id"),
    ] {
        *fake.outline.lock().unwrap() = bad;
        call("script.generate", json!({"candidate": cand}));
        let failed = settled(cand);
        assert_eq!(failed["job"]["state"], "failed");
        assert_eq!(failed["job"]["code"], "verification_failed");
        assert!(failed["job"]["violations"]
            .as_array()
            .unwrap()
            .contains(&json!(code)));
        assert_eq!(failed["current"]["generation"], 2);
    }
    let mut wrong = outline(3, json!([10]));
    wrong["language"] = json!("en");
    *fake.outline.lock().unwrap() = wrong;
    call("script.generate", json!({"candidate": cand}));
    assert!(settled(cand)["job"]["violations"]
        .as_array()
        .unwrap()
        .contains(&json!("language_mismatch")));
}
