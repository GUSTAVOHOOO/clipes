//! #153: dispatch headless, Provedor injetado e nenhum acesso à rede.
use clipes_core::{
    dispatch, jobs,
    projects::with_writer,
    provider::{cost::Target, CancelToken, Provider, StructuredRequest},
    CoreError,
};
use serde_json::{json, Value};
use std::{
    sync::{Arc, Mutex},
    time::{Duration, Instant},
};

#[test]
fn angle_verifiers_cover_similarity_boundary_fields_and_ids() {
    use clipes_core::ai_task::{self, TaskInput};
    let task = ai_task::find("angles").expect("angles is registered");
    let input = TaskInput {
        transcript: "#ANGULOS\n10 texto\n11 texto\n12 texto".into(),
        context: json!({"ids":[10,11,12]}),
        ..TaskInput::default()
    };
    let check = |data: Value| {
        let fake = Fake {
            angles: Mutex::new(data),
            seen: Mutex::new(vec![]),
        };
        ai_task::run(task, &input, &fake, &CancelToken::new())
    };
    assert!(check(valid()).is_ok());
    let mut data = valid();
    data["angles"][0]["promise"] = json!("Um dois três quatro.");
    data["angles"][1]["promise"] = json!("um dois tres cinco!");
    assert_eq!(check(data).unwrap_err().code, "verification_failed"); // Jaccard = 3/5.
    for (field, value) in [
        ("name", json!("n".repeat(61))),
        ("name", json!(" ")),
        ("promise", json!("p".repeat(201))),
        ("promise", json!("Uma frase. Outra frase.")),
        ("audience", json!("a".repeat(121))),
        ("sentence_ids", json!([])),
        ("sentence_ids", json!([999])),
        ("sentence_ids", json!(vec![10; 13])),
    ] {
        let mut data = valid();
        data["angles"][0][field] = value;
        assert_eq!(
            check(data).unwrap_err().code,
            "verification_failed",
            "{field}"
        );
    }
    let mut three = valid();
    three["angles"].as_array_mut().unwrap().push(json!({"name":"Uma outra visão","promise":"Explore o contexto por trás do tema.","audience":"Curiosos","sentence_ids":[11]}));
    assert!(check(three.clone()).is_ok());
    three["angles"]
        .as_array_mut()
        .unwrap()
        .push(valid()["angles"][0].clone());
    assert_eq!(check(three).unwrap_err().code, "verification_failed");
    let mut one = valid();
    one["angles"].as_array_mut().unwrap().pop();
    assert_eq!(check(one).unwrap_err().code, "verification_failed");
}

fn call(name: &str, args: Value) -> Value {
    dispatch(name, args, &mut |_| {}).unwrap()
}
fn fail(name: &str, args: Value) -> CoreError {
    dispatch(name, args, &mut |_| {}).unwrap_err()
}

fn seed() -> i64 {
    with_writer(|c| {
        c.execute("INSERT INTO sources(path,size,duration_us,partial_hash,metadata,permission,audio_track) VALUES ('fixture.mp4',1,2400000000,'h','{}','{}',0)", [])?;
        let source = c.last_insert_rowid();
        c.execute("INSERT INTO transcripts(source_id,audio_track,engine,model,revision,compute_type,state,resume_us,duration_us) VALUES (?1,0,'local','m','r','c','complete',2400000000,2400000000)", [source])?;
        let transcript = c.last_insert_rowid();
        for position in 0..2400_i64 {
            let text = if position % 10 == 9 { " palavra." } else { " palavra" };
            c.execute("INSERT INTO transcript_words(transcript_id,position,kind,text,start_us,end_us,language) VALUES (?1,?2,'word',?3,?4,?5,'pt')", (transcript, position, text, position * 1_000_000, (position + 1) * 1_000_000))?;
        }
        Ok(source)
    }).unwrap()
}

fn valid() -> Value {
    json!({"schemaVersion":1,"angles":[
        {"name":"Custo da escolha", "promise":"Entenda por que decidir cedo muda o resultado.", "audience":"Quem precisa decidir", "sentence_ids":[10,11]},
        {"name":"Aprender com o erro", "promise":"Descubra como transformar uma falha em aprendizado.", "audience":"Iniciantes", "sentence_ids":[12]}
    ]})
}

struct Fake {
    angles: Mutex<Value>,
    seen: Mutex<Vec<StructuredRequest>>,
}
impl Provider for Fake {
    fn structured(&self, _: &StructuredRequest) -> Result<Value, CoreError> {
        unreachable!()
    }
    fn structured_with(&self, r: &StructuredRequest, _: &CancelToken) -> Result<Value, CoreError> {
        self.seen.lock().unwrap().push(r.clone());
        let data = if r.transcript.starts_with("#ANGULOS") {
            self.angles.lock().unwrap().clone()
        } else if r.transcript.starts_with("#BLOCO") {
            json!({"schemaVersion":1,"narration":"Comentário do criador sobre o trecho."})
        } else if r.schema.to_string().contains("blocks") {
            json!({"schemaVersion":1,"language":"pt-BR","blocks":(1..=3).map(|n| json!({"title":format!("Bloco {n}"),"intent":"Comentar o trecho.","refs":[10]})).collect::<Vec<_>>()})
        } else if r.transcript.starts_with("#CAPA") {
            json!({"schemaVersion":1,"sentenceId":10,"why":"Momento que sustenta a promessa."})
        } else if r.schema.to_string().contains("hashtags") {
            json!({"schemaVersion":1,"language":"pt-BR","title":"Uma escolha muda tudo","description":"Comentário sobre a escolha.","tags":["escolha"],"hashtags":["#escolha"]})
        } else {
            let first = r
                .transcript
                .lines()
                .find(|l| !l.starts_with('#'))
                .and_then(|l| l.split(' ').next());
            let mut cand = json!({"startId":10,"endId":12,"title":""});
            for key in [
                "hook",
                "selfContained",
                "energy",
                "value",
                "closing",
                "commentary",
            ] {
                cand[key] = json!({"score":9,"why":"motivo"});
            }
            if !r.schema.to_string().contains("commentary") {
                cand.as_object_mut().unwrap().remove("commentary");
            }
            json!({"schemaVersion":1,"candidates":if first == Some("1") {vec![cand]} else {vec![]}})
        };
        Ok(json!({"data":data,"usage":{"inputTokens":10,"outputTokens":5},"calls":1}))
    }
}

fn wait(mut get: impl FnMut() -> Value, done: impl Fn(&Value) -> bool) -> Value {
    let deadline = Instant::now() + Duration::from_secs(60);
    loop {
        let v = get();
        if done(&v) {
            return v;
        }
        assert!(Instant::now() < deadline, "job did not settle: {v}");
        std::thread::sleep(Duration::from_millis(20));
    }
}

fn suggest(candidate: i64) -> Value {
    call("angles.generate", json!({"candidate":candidate}));
    wait(
        || call("angles.get", json!({"candidate":candidate})),
        |v| v["busy"] == false,
    )
}

fn script(candidate: i64) -> Value {
    wait(
        || call("script.get", json!({"candidate":candidate})),
        |v| v["busy"] == false,
    )
}

#[test]
fn angles_list_manual_gate_and_script_propagation() {
    let root = tempfile::tempdir().unwrap();
    std::env::set_var("CLIPES_DATA_DIR", root.path().join("data"));
    call(
        "projects.create",
        json!({"parent":root.path(),"name":"Canal"}),
    );
    let source = seed();
    call("transcription.segment", json!({"source_id":source}));
    let fake = Arc::new(Fake {
        angles: Mutex::new(valid()),
        seen: Mutex::new(vec![]),
    });
    jobs::set_ai_provider(Some(fake.clone()));
    call(
        "provider.configure",
        json!({"endpoint":"http://127.0.0.1:9/v1","kind":"openai","model":"fake","context":32768}),
    );
    jobs::set_ai_route(Some((
        Target::Api {
            provider: "openai".into(),
            model: "fake".into(),
            local: true,
        },
        "legacy".into(),
    )));
    let run = call(
        "selection.start",
        json!({"source_id":source,"videoKind":"transformed"}),
    )["run"]
        .as_i64()
        .unwrap();
    let selection = wait(
        || call("selection.get", json!({"run":run})),
        |v| v["run"]["state"] == "completed",
    );
    let candidate = selection["candidates"][0]["id"].as_i64().unwrap();
    call(
        "selection.decide",
        json!({"candidate":candidate,"decision":"approved"}),
    );

    // Trava no núcleo, antes de enfileirar qualquer chamada ao Provedor.
    let before = fake.seen.lock().unwrap().len();
    assert_eq!(
        fail("script.generate", json!({"candidate":candidate})).code,
        "angle_required"
    );
    assert_eq!(fake.seen.lock().unwrap().len(), before);

    // A tarefa angles herda a rota e os vetos de script antes de qualquer envio.
    jobs::set_ai_route(None);
    call(
        "provider.configure",
        json!({"endpoint":"https://192.0.2.10/v1","kind":"openai","model":"fake","context":32768}),
    );
    assert_eq!(
        fail("angles.generate", json!({"candidate":candidate})).code,
        "confirmation_required"
    );
    call(
        "assistant.local_only.set",
        json!({"task":"script","enabled":true}),
    );
    assert_eq!(
        fail(
            "angles.generate",
            json!({"candidate":candidate,"confirmed":true})
        )
        .code,
        "local_only_violation"
    );
    call(
        "assistant.local_only.set",
        json!({"task":"script","enabled":false}),
    );
    call("projects.local_only.set", json!({"enabled":true}));
    assert_eq!(
        fail("angles.estimate", json!({"candidate":candidate})).code,
        "local_only_violation"
    );
    call("projects.local_only.set", json!({"enabled":false}));
    assert_eq!(fake.seen.lock().unwrap().len(), before);
    call(
        "provider.configure",
        json!({"endpoint":"http://127.0.0.1:9/v1","kind":"openai","model":"fake","context":32768}),
    );
    jobs::set_ai_route(Some((
        Target::Api {
            provider: "openai".into(),
            model: "fake".into(),
            local: true,
        },
        "legacy".into(),
    )));

    // Lista válida e IDs do Corte, com custo da tarefa registrado pela fila.
    let list = suggest(candidate);
    assert_eq!(list["angles"], valid()["angles"]);
    assert_eq!(list["job"]["state"], "completed");
    call(
        "angles.choose",
        json!({"candidate":candidate,"generation":list["generation"],"index":1}),
    );
    assert_eq!(
        call("script.get", json!({"candidate":candidate}))["angle"],
        valid()["angles"][1]
    );
    let request = fake.seen.lock().unwrap().last().unwrap().clone();
    assert!(request.transcript.starts_with("#ANGULOS"));
    assert!(!request.transcript.contains("start_us"));
    assert!(request.instruction.contains("lista"));
    assert!(call("provider.cost.list", json!({}))
        .as_array()
        .unwrap()
        .iter()
        .any(|v| v["task"] == "angles"));

    // Nomes iguais mesmo com acentos e pontuação: resposta inteira rejeitada.
    let mut repeated = valid();
    repeated["angles"][0]["name"] = json!("ÂNGULO, único!");
    repeated["angles"][1]["name"] = json!("angulo unico");
    *fake.angles.lock().unwrap() = repeated;
    assert_eq!(suggest(candidate)["job"]["code"], "verification_failed");
    assert_eq!(
        call("script.get", json!({"candidate":candidate}))["angle"],
        valid()["angles"][1],
        "uma lista rejeitada não troca a escolha"
    );
    let mut outside = valid();
    outside["angles"][1]["sentence_ids"] = json!([999]);
    *fake.angles.lock().unwrap() = outside;
    assert_eq!(suggest(candidate)["job"]["code"], "verification_failed");

    // Ângulo manual: nada é enviado; campos opcionais podem ser omitidos.
    let before = fake.seen.lock().unwrap().len();
    let own = json!({"name":"Minha leitura","promise":"Entenda a consequência da escolha."});
    call("angles.choose", json!({"candidate":candidate,"angle":own}));
    assert_eq!(fake.seen.lock().unwrap().len(), before);
    assert_eq!(
        call("script.get", json!({"candidate":candidate}))["angle"],
        own
    );
    assert_eq!(
        fail(
            "angles.choose",
            json!({"candidate":candidate,"angle":{"name":"","promise":"x"}})
        )
        .code,
        "angle_invalid"
    );
    call("script.generate", json!({"candidate":candidate}));
    let doc = script(candidate);
    for r in fake.seen.lock().unwrap().iter().skip(before) {
        assert!(r.transcript.contains("#ANGULO\n"));
        assert!(r.transcript.contains("Minha leitura"));
    }
    let blocks = doc["current"]["blocks"].as_array().unwrap();
    for b in blocks {
        call(
            "script.approve",
            json!({"candidate":candidate,"block":b["id"]}),
        );
    }
    assert_eq!(script(candidate)["narrationAllowed"], true);
    assert_eq!(doc["generations"][0]["angle"], own);

    // Confirmação de troca, textos preservados e reaprovação explícita.
    let next = valid()["angles"][0].clone();
    assert_eq!(
        fail("angles.choose", json!({"candidate":candidate,"angle":next})).code,
        "angle_change_confirmation"
    );
    call(
        "angles.choose",
        json!({"candidate":candidate,"angle":next,"confirmed":true}),
    );
    let changed = script(candidate);
    assert_eq!(changed["narrationAllowed"], false);
    for (old, new) in blocks
        .iter()
        .zip(changed["current"]["blocks"].as_array().unwrap())
    {
        assert_eq!(old["narration"], new["narration"]);
        assert_eq!(new["stale"], true);
        call(
            "script.approve",
            json!({"candidate":candidate,"block":new["id"]}),
        );
    }
    assert_eq!(script(candidate)["narrationAllowed"], true);
    assert_eq!(
        script(candidate)["generations"][0]["angle"],
        own,
        "a proveniência da geração é preservada"
    );
    call(
        "script.regenerate",
        json!({"candidate":candidate,"block":blocks[0]["id"]}),
    );
    script(candidate);
    assert!(fake
        .seen
        .lock()
        .unwrap()
        .last()
        .unwrap()
        .transcript
        .contains("Custo da escolha"));

    // As três formas de revisar limpam o selo, mas só aprovação libera a Narração.
    call(
        "angles.choose",
        json!({"candidate":candidate,"angle":own,"confirmed":true}),
    );
    let edited = call(
        "script.edit",
        json!({"candidate":candidate,"block":blocks[0]["id"],"narration":blocks[0]["narration"]}),
    );
    assert_eq!(edited["current"]["blocks"][0]["stale"], false);
    assert_eq!(edited["current"]["blocks"][0]["status"], "pendente");
    call(
        "script.regenerate",
        json!({"candidate":candidate,"block":blocks[1]["id"]}),
    );
    let regenerated = script(candidate);
    assert_eq!(regenerated["current"]["blocks"][1]["stale"], false);
    assert_eq!(regenerated["current"]["blocks"][2]["stale"], true);
    call(
        "angles.choose",
        json!({"candidate":candidate,"angle":next,"confirmed":true}),
    );

    call("packaging.generate", json!({"candidate":candidate}));
    wait(
        || call("packaging.get", json!({"candidate":candidate})),
        |v| v["job"]["state"] == "completed",
    );
    assert!(fake
        .seen
        .lock()
        .unwrap()
        .last()
        .unwrap()
        .transcript
        .contains("Custo da escolha"));
    call("thumbnail.suggest", json!({"candidate":candidate}));
    wait(
        || call("thumbnail.get", json!({"candidate":candidate})),
        |v| v["job"]["state"] == "completed",
    );
    assert!(fake
        .seen
        .lock()
        .unwrap()
        .last()
        .unwrap()
        .transcript
        .contains("Custo da escolha"));
    // A escolha e os estados viajam no Projeto, inclusive após reabrir.
    let path = call("projects.current", json!({}))["path"].clone();
    let persisted = script(candidate);
    call("projects.close", json!({}));
    call("projects.open", json!({"path":path}));
    let reopened = script(candidate);
    assert_eq!(reopened["angle"], persisted["angle"]);
    assert_eq!(reopened["current"], persisted["current"]);
    call("projects.close", json!({}));
    jobs::set_ai_provider(None);
    jobs::set_ai_route(None);
    std::env::remove_var("CLIPES_DATA_DIR");
}
