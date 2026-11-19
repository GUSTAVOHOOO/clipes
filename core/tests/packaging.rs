//! Empacotamento do Corte (#68), headless e sem rede: Provedor falso na fila, Transcrição gravada
//! no Projeto e dados isolados em CLIPES_DATA_DIR.
use clipes_core::{
    ai_task::{self, TaskInput},
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

struct Direct(Value);
impl Provider for Direct {
    fn structured(&self, _: &StructuredRequest) -> Result<Value, CoreError> {
        Ok(json!({"data": self.0, "calls": 1}))
    }
}

fn run(data: Value) -> Result<ai_task::TaskOutput, ai_task::TaskError> {
    let task = ai_task::find("packaging").expect("packaging task registered");
    ai_task::run(
        task,
        &TaskInput {
            context: json!({"language":"pt-BR","creditBytes":60}),
            ..Default::default()
        },
        &Direct(data),
        &CancelToken::new(),
    )
}

fn valid() -> Value {
    json!({"schemaVersion":1,"language":"pt-BR","title":"Um título","description":"Uma descrição","tags":["corte"],"hashtags":["#corte"]})
}

fn codes(data: Value) -> Vec<&'static str> {
    run(data)
        .expect_err("must fail")
        .violations
        .iter()
        .map(|v| v.code)
        .collect()
}

#[test]
fn verifiers_check_limits_hashtags_urls_and_language() {
    assert!(run(valid()).is_ok());
    let mut d = valid();
    d["title"] = json!("a".repeat(101));
    assert!(codes(d).contains(&"title_too_long"));
    let mut d = valid();
    d["title"] = json!("a".repeat(100));
    assert!(run(d).is_ok());
    // 5000 bytes no total, contando o crédito reservado (60) e UTF-8 de 2 bytes.
    let mut d = valid();
    d["description"] = json!("é".repeat(2480));
    assert!(codes(d).contains(&"description_too_long"));
    let mut d = valid();
    d["description"] = json!("é".repeat(2470));
    assert!(run(d).is_ok());
    let mut d = valid();
    d["tags"] = json!((0..30)
        .map(|i| format!("tag-numero-{i:02}xxxxxx"))
        .collect::<Vec<_>>());
    assert!(codes(d).contains(&"tags_too_long"));
    let mut d = valid();
    d["hashtags"] = json!(["#duas palavras"]);
    assert!(codes(d).contains(&"invalid_hashtag"));
    let mut d = valid();
    d["hashtags"] = json!(["sem-cerquilha"]);
    assert!(codes(d).contains(&"invalid_hashtag"));
    let mut d = valid();
    d["description"] = json!("Veja em https://exemplo.com/invento");
    assert!(codes(d).contains(&"invented_url"));
    let mut d = valid();
    d["language"] = json!("en");
    assert!(codes(d).contains(&"language_mismatch"));
    // Texto longo em outro idioma, com o campo `language` certo: a heurística pega.
    let mut d = valid();
    d["description"] = json!("This video is about how the team built a house and what they have learned from it when there were all of the people with them");
    assert!(codes(d).contains(&"language_mismatch"));
    // Texto curto ou ambíguo passa.
    let mut d = valid();
    d["description"] = json!("The best moment");
    assert!(run(d).is_ok());
}

static SERIAL: Mutex<()> = Mutex::new(());

fn call(name: &str, args: Value) -> Value {
    dispatch(name, args, &mut |_| {}).unwrap()
}

fn fail(name: &str, args: Value) -> CoreError {
    dispatch(name, args, &mut |_| {}).unwrap_err()
}

const SENTENCES: i64 = 240;
const WHERE: &str = "SECRET-WHERE-123";
const SCOPE: &str = "SECRET-SCOPE-456";

fn seed() -> i64 {
    with_writer(|c| {
        c.execute(
            "INSERT INTO sources(path,size,duration_us,partial_hash,metadata,permission,audio_track,origin_url) VALUES ('C:/videos/live.mp4',1,2400000000,'h','{}',?1,0,'https://example.com/watch?v=abc')",
            [json!({"status":"granted","who":"Canal Exemplo","where":WHERE,"scope":SCOPE}).to_string()],
        )?;
        let source = c.last_insert_rowid();
        c.execute("INSERT INTO transcripts(source_id,audio_track,engine,model,revision,compute_type,state,resume_us,duration_us) VALUES (?1,0,'local','m','r','c','complete',2400000000,2400000000)", [source])?;
        let transcript = c.last_insert_rowid();
        for position in 0..SENTENCES * 10 {
            let text = if position % 10 == 9 { " palavra." } else { " palavra" };
            c.execute("INSERT INTO transcript_words(transcript_id,position,kind,text,start_us,end_us,language) VALUES (?1,?2,'word',?3,?4,?5,'pt')", (transcript, position, text, position * 1_000_000, (position + 1) * 1_000_000))?;
        }
        Ok(source)
    })
    .unwrap()
}

fn candidate() -> Value {
    let mut c = json!({"startId": 10, "endId": 11, "title": ""});
    for key in ["hook", "selfContained", "energy", "value", "closing"] {
        c[key] = json!({"score": 9, "why": "motivo curto"});
    }
    c
}

/// Seleção: um candidato fixo. Empacotamento: a próxima saída da fila, e o pedido visto.
struct Fake {
    next: Mutex<Value>,
    seen: Mutex<Vec<StructuredRequest>>,
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
        if request.transcript.starts_with("#CORTE") {
            self.seen.lock().unwrap().push(request.clone());
            return Ok(
                json!({"data": self.next.lock().unwrap().clone(), "usage": usage, "calls": 1}),
            );
        }
        let first: i64 = request
            .transcript
            .lines()
            .find(|l| !l.starts_with('#'))
            .and_then(|l| l.split(' ').next())
            .and_then(|id| id.parse().ok())
            .unwrap();
        let list = if first == 1 {
            vec![candidate()]
        } else {
            vec![]
        };
        Ok(json!({"data": {"schemaVersion": 1, "candidates": list}, "usage": usage, "calls": 1}))
    }
}

fn out(language: &str, title: &str, description: &str) -> Value {
    json!({"schemaVersion":1,"language":language,"title":title,"description":description,"tags":["corte","live"],"hashtags":["#corte","#live"]})
}

fn wait_job(candidate: i64, id: i64) -> Value {
    let deadline = Instant::now() + Duration::from_secs(60);
    loop {
        let doc = call("packaging.get", json!({"candidate": candidate}));
        let job = &doc["job"];
        if job["id"] == id && !matches!(job["state"].as_str(), Some("queued" | "running")) {
            return doc;
        }
        assert!(Instant::now() < deadline, "job {id} never settled: {doc}");
        std::thread::sleep(Duration::from_millis(25));
    }
}

fn generate(candidate: i64, extra: Value) -> Value {
    let mut args = json!({"candidate": candidate});
    for (k, v) in extra.as_object().into_iter().flatten() {
        args[k] = v.clone();
    }
    let job = call("packaging.generate", args)["job"].as_i64().unwrap();
    wait_job(candidate, job)
}

#[test]
fn packaging_flow_credit_edits_regeneration_and_failures() {
    let _guard = SERIAL.lock().unwrap_or_else(|e| e.into_inner());
    let root = tempfile::tempdir().unwrap();
    std::env::set_var("CLIPES_DATA_DIR", root.path().join("data"));
    call(
        "projects.create",
        json!({"parent": root.path(), "name": "Canal"}),
    );
    let source = seed();
    call("transcription.segment", json!({"source_id": source}));
    call(
        "provider.configure",
        json!({"endpoint": "http://127.0.0.1:9/v1", "kind": "openai", "model": "fake-model", "context": 32768}),
    );
    let fake = Arc::new(Fake {
        next: Mutex::new(out(
            "pt-BR",
            "Título gerado",
            "Resumo curto do que acontece no Corte.",
        )),
        seen: Mutex::new(vec![]),
    });
    jobs::set_ai_provider(Some(fake.clone()));
    jobs::set_ai_route(Some((
        Target::Api {
            provider: "openai".into(),
            model: "fake-model".into(),
            local: true,
        },
        "legacy".into(),
    )));

    let run1 = call("selection.start", json!({"source_id": source}))["run"]
        .as_i64()
        .unwrap();
    let deadline = Instant::now() + Duration::from_secs(60);
    let candidates = loop {
        let got = call("selection.get", json!({"run": run1}));
        if got["run"]["state"] == "completed" {
            break got["candidates"].clone();
        }
        assert!(Instant::now() < deadline, "selection never completed");
        std::thread::sleep(Duration::from_millis(25));
    };
    let cand = candidates[0]["id"].as_i64().unwrap();

    // Só candidato aprovado gera.
    assert_eq!(
        fail("packaging.generate", json!({"candidate": cand})).code,
        "not_approved"
    );
    call(
        "selection.decide",
        json!({"candidate": cand, "decision": "approved"}),
    );
    let estimate = call("packaging.estimate", json!({"candidate": cand}));
    assert_eq!(estimate["language"], "pt-BR");
    assert_eq!(estimate["paid"], false);

    // 1. Saída válida; o crédito é do núcleo (nome e link públicos) e vai depois da descrição.
    let doc = generate(cand, json!({}));
    assert_eq!(doc["job"]["state"], "completed");
    assert_eq!(doc["schemaVersion"], 1);
    assert_eq!(doc["current"]["generation"], 1);
    assert_eq!(doc["current"]["title"], "Título gerado");
    let credit = doc["credit"]["text"].as_str().unwrap().to_owned();
    assert_eq!(
        credit,
        "Crédito: vídeo original de Canal Exemplo.\nFonte: https://example.com/watch?v=abc"
    );
    assert_eq!(
        doc["current"]["fullDescription"],
        format!("Resumo curto do que acontece no Corte.\n\n{credit}")
    );
    assert!(!doc["current"]["description"]
        .as_str()
        .unwrap()
        .contains("Canal Exemplo"));
    let generation = &doc["generations"][0];
    assert_eq!(generation["taskVersion"], 2);
    assert_eq!(generation["promptSha256"].as_str().unwrap().len(), 64);
    assert_eq!(generation["profile"], "legacy");
    let validated = call(
        "documents.validate",
        json!({"type": "packaging", "document": doc}),
    );
    assert_eq!(validated["schemaVersion"], 1);

    // O modelo nunca vê `where`, `scope` nem o nome: o crédito não é pedido a ele.
    {
        let seen = fake.seen.lock().unwrap();
        let request = &seen[0];
        assert!(request.transcript.starts_with("#CORTE idioma=pt-BR\n"));
        assert!(
            !request.transcript.contains("#ANGULO"),
            "Corte direto mantém a entrada sem ângulo"
        );
        for text in [&request.transcript, &request.instruction] {
            for secret in [WHERE, SCOPE, "Canal Exemplo", "example.com"] {
                assert!(!text.contains(secret), "{secret} leaked to the provider");
            }
        }
    }
    // Nem o documento guardado os tem.
    assert!(!doc.to_string().contains(WHERE) && !doc.to_string().contains(SCOPE));

    // 2. Edição: nova linha; a geração original segue intacta; limites valem na edição.
    let edited = call(
        "packaging.edit",
        json!({"candidate": cand, "title": "Meu título", "tags": ["a", "b"]}),
    );
    assert_eq!(edited["current"]["title"], "Meu título");
    assert_eq!(edited["current"]["edited"], true);
    assert_eq!(edited["current"]["tags"], json!(["a", "b"]));
    assert_eq!(
        edited["generations"][0]["generated"]["title"],
        "Título gerado"
    );
    assert_eq!(
        edited["generations"][0]["edits"].as_array().unwrap().len(),
        1
    );
    let too_long = fail(
        "packaging.edit",
        json!({"candidate": cand, "title": "x".repeat(101)}),
    );
    assert_eq!(too_long.code, "edit_invalid");
    assert!(too_long.usage.unwrap()["violations"][0]["code"] == "title_too_long");
    let space = fail(
        "packaging.edit",
        json!({"candidate": cand, "hashtags": ["#duas palavras"]}),
    );
    assert_eq!(space.code, "edit_invalid");
    let big_description = fail(
        "packaging.edit",
        json!({"candidate": cand, "description": "x".repeat(4990)}),
    );
    assert_eq!(
        big_description.code, "edit_invalid",
        "credit counts toward 5000 bytes"
    );
    assert_eq!(
        call("packaging.get", json!({"candidate": cand}))["current"]["title"],
        "Meu título"
    );

    // 3. Regenerar cria a versão 2 e preserva a geração 1 com a edição.
    *fake.next.lock().unwrap() = out("pt-BR", "Segundo título", "Outro resumo do Corte.");
    let regenerated = generate(cand, json!({}));
    assert_eq!(regenerated["current"]["generation"], 2);
    assert_eq!(regenerated["current"]["title"], "Segundo título");
    let all = regenerated["generations"].as_array().unwrap();
    assert_eq!(all.len(), 2);
    assert_eq!(all[0]["generated"]["title"], "Título gerado");
    assert_eq!(all[0]["edits"][0]["title"], "Meu título");
    assert_eq!(regenerated["revision"], 3);

    // 4. Falha de verificador: erro tipado, sem reparo, sem perder a versão atual.
    *fake.next.lock().unwrap() = out("en", "Wrong", "Wrong language");
    let failed = generate(cand, json!({}));
    assert_eq!(failed["job"]["state"], "failed");
    assert_eq!(failed["job"]["code"], "verification_failed");
    assert!(failed["job"]["violations"]
        .as_array()
        .unwrap()
        .contains(&json!("language_mismatch")));
    assert_eq!(failed["current"]["generation"], 2);
    *fake.next.lock().unwrap() = out("pt-BR", &"t".repeat(120), "Resumo.");
    let long = generate(cand, json!({}));
    assert!(long["job"]["violations"]
        .as_array()
        .unwrap()
        .contains(&json!("title_too_long")));
    *fake.next.lock().unwrap() = json!({"schemaVersion":1,"language":"pt-BR","title":"x","description":"y","tags":["a"],"hashtags":["#duas palavras"]});
    let tags = generate(cand, json!({}));
    assert!(tags["job"]["violations"]
        .as_array()
        .unwrap()
        .contains(&json!("invalid_hashtag")));

    // 5. Sem Permissão: aviso claro e nenhum crédito inventado.
    with_writer(|c| {
        c.execute("UPDATE sources SET permission='{\"status\":\"none\"}'", [])?;
        Ok(())
    })
    .unwrap();
    let none = call("packaging.get", json!({"candidate": cand}));
    assert_eq!(none["credit"]["text"], Value::Null);
    assert_eq!(none["credit"]["warning"], "no_permission");
    assert_eq!(
        none["current"]["fullDescription"],
        none["current"]["description"]
    );

    // 6. Idioma desconhecido: precisa escolher PT-BR ou EN; sem escolha, language_required.
    with_writer(|c| {
        c.execute("UPDATE sentences SET language=NULL", [])?;
        Ok(())
    })
    .unwrap();
    let unknown = call("packaging.get", json!({"candidate": cand}));
    assert_eq!(unknown["languageRequired"], true);
    assert_eq!(
        fail("packaging.generate", json!({"candidate": cand})).code,
        "language_required"
    );
    assert_eq!(
        fail(
            "packaging.generate",
            json!({"candidate": cand, "language": "fr"})
        )
        .code,
        "language_required"
    );
    *fake.next.lock().unwrap() = out("en", "A title", "A short summary of the clip.");
    let english = generate(cand, json!({"language": "en"}));
    assert_eq!(english["current"]["language"], "en");
    assert_eq!(english["current"]["generation"], 3);
    {
        let seen = fake.seen.lock().unwrap();
        assert!(seen
            .last()
            .unwrap()
            .transcript
            .starts_with("#CORTE idioma=en\n"));
    }
}

#[test]
fn packaging_edit_initializes_manual_without_prior_generation() {
    let _guard = SERIAL.lock().unwrap_or_else(|e| e.into_inner());
    let root = tempfile::tempdir().unwrap();
    std::env::set_var("CLIPES_DATA_DIR", root.path().join("data"));
    call(
        "projects.create",
        json!({"parent": root.path(), "name": "CanalManual"}),
    );
    let source = seed();
    call("transcription.segment", json!({"source_id": source}));

    // Seed de um candidato aprovado sem configurar Provedor nem rodar packaging.generate.
    let cand = with_writer(|c| {
        let transcript: i64 =
            c.query_row("SELECT id FROM transcripts WHERE source_id=?1", [source], |r| r.get(0))?;
        c.execute(
            "INSERT INTO selection_runs(transcript_id,task_version,prompt_sha256,profile,state,batch,min_us,max_us,weights,plan_state,windows_total,video_kind)
             VALUES (?1,1,'h','legacy','completed','',20000000,180000000,'[]','full',1,'direct')",
            [transcript],
        )?;
        let run = c.last_insert_rowid();
        c.execute(
            "INSERT INTO selection_candidates(run_id,rank,start_id,end_id,start_us,end_us,axes,total_centi,windows)
             VALUES (?1,1,10,11,100000000,120000000,'{}',900,'[]')",
            [run],
        )?;
        let cand = c.last_insert_rowid();
        c.execute(
            "INSERT INTO selection_decisions(run_id,cand_start_id,cand_end_id,decision,before_start_id,before_end_id,after_start_id,after_end_id)
             VALUES (?1,10,11,'approved',10,11,10,11)",
            [run],
        )?;
        Ok(cand)
    })
    .unwrap();

    let initial = call("packaging.get", json!({"candidate": cand}));
    assert!(initial["current"].is_null());
    assert!(initial["job"].is_null());
    let credit = initial["credit"]["text"].as_str().unwrap().to_owned();
    assert_eq!(
        credit,
        "Crédito: vídeo original de Canal Exemplo.\nFonte: https://example.com/watch?v=abc"
    );

    // Contrato de refresh_chapters permanece inalterado quando não há ficha.
    assert_eq!(
        fail("packaging.refresh_chapters", json!({"candidate": cand})).code,
        "nothing_to_edit"
    );

    // Limites do YouTube continuam validados mesmo antes da criação inicial; falha não persiste ficha.
    let empty_title = fail(
        "packaging.edit",
        json!({"candidate": cand, "description": "Só descrição sem título"}),
    );
    assert_eq!(empty_title.code, "edit_invalid");
    assert_eq!(
        empty_title.usage.unwrap()["violations"][0]["code"],
        "title_empty"
    );
    let too_long_title = fail(
        "packaging.edit",
        json!({"candidate": cand, "title": "x".repeat(101)}),
    );
    assert_eq!(too_long_title.code, "edit_invalid");
    assert_eq!(
        too_long_title.usage.unwrap()["violations"][0]["code"],
        "title_too_long"
    );
    let big_desc = fail(
        "packaging.edit",
        json!({"candidate": cand, "title": "Ok", "description": "x".repeat(4990)}),
    );
    assert_eq!(
        big_desc.code, "edit_invalid",
        "credit counts toward 5000 bytes on manual creation"
    );
    assert!(
        call("packaging.get", json!({"candidate": cand}))["current"].is_null(),
        "failed edit must not initialize packaging"
    );

    // Edição manual inicializa a ficha vazia e persiste a edição sem packaging.generate prévio.
    let created = call(
        "packaging.edit",
        json!({
            "candidate": cand,
            "title": "Título manual",
            "description": "Descrição escrita à mão.",
            "tags": ["manual", "corte"],
            "hashtags": ["#manual"]
        }),
    );
    assert_eq!(created["current"]["generation"], 1);
    assert_eq!(created["current"]["language"], "pt-BR");
    assert_eq!(created["current"]["edited"], true);
    assert_eq!(created["current"]["title"], "Título manual");
    assert_eq!(
        created["current"]["description"],
        "Descrição escrita à mão."
    );
    assert_eq!(created["current"]["tags"], json!(["manual", "corte"]));
    assert_eq!(created["current"]["hashtags"], json!(["#manual"]));
    assert_eq!(
        created["current"]["fullDescription"],
        format!("Descrição escrita à mão.\n\n{credit}")
    );
    assert!(created["job"].is_null());
    assert_eq!(created["generations"].as_array().unwrap().len(), 1);
    assert!(created["generations"][0]["jobId"].is_null());
    assert_eq!(created["generations"][0]["generated"]["title"], "");
    assert_eq!(
        created["generations"][0]["edits"].as_array().unwrap().len(),
        1
    );
    call(
        "documents.validate",
        json!({"type": "packaging", "document": created}),
    );

    // packaging.get preserva a edição e o crédito protegido da Fonte.
    let fetched = call("packaging.get", json!({"candidate": cand}));
    assert_eq!(fetched["current"]["title"], "Título manual");
    assert_eq!(
        fetched["current"]["fullDescription"],
        format!("Descrição escrita à mão.\n\n{credit}")
    );
    assert!(!fetched["current"]["description"]
        .as_str()
        .unwrap()
        .contains("Canal Exemplo"));

    // Segunda edição preserva os demais campos e continua validando limites.
    let updated = call(
        "packaging.edit",
        json!({"candidate": cand, "title": "Título manual v2"}),
    );
    assert_eq!(updated["current"]["title"], "Título manual v2");
    assert_eq!(
        updated["current"]["description"],
        "Descrição escrita à mão."
    );
    assert_eq!(
        updated["generations"][0]["edits"].as_array().unwrap().len(),
        2
    );
    assert_eq!(
        fail(
            "packaging.edit",
            json!({"candidate": cand, "hashtags": ["semhash"]})
        )
        .code,
        "edit_invalid"
    );

    // export.readiness lê ficha manual com jobId null sem falhar.
    let readiness = call("export.readiness", json!({}));
    assert_eq!(
        readiness["items"][0]["packaging"]["current"]["title"],
        "Título manual v2"
    );
    assert!(readiness["items"][0]["packaging"]["job"].is_null());
}
