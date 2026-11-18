//! Testes de regressão pela interface pública (`clipes_core::dispatch` + `jobs::set_ai_provider`)
//! cobrindo pré-vôo, estimativa, confirmação paga e códigos sanitizados em `*.get` para todas
//! as Tarefas de IA (`angles.*`, `packaging.*`, `thumbnail.*`, `script.*`, `selection.*`,
//! `translation.*` e `jobs.redo*`).
use clipes_core::{
    dispatch, jobs,
    projects::with_writer,
    provider::{CancelToken, Provider, StructuredRequest},
    CoreError,
};
use serde_json::{json, Value};
use std::{
    sync::{
        atomic::{AtomicUsize, Ordering},
        Arc, Mutex,
    },
    time::{Duration, Instant},
};

const REMOTE: &str = "https://192.0.2.10/v1";
const LOCAL: &str = "http://127.0.0.1:9/v1";
const SECRET_LEAK: &str = "C:\\Users\\secret\\modelo-texto-cru";

fn call(name: &str, args: Value) -> Value {
    dispatch(name, args, &mut |_| {}).unwrap()
}

fn fail(name: &str, args: Value) -> CoreError {
    dispatch(name, args, &mut |_| {}).unwrap_err()
}

fn configure_local_default() {
    call(
        "provider.configure",
        json!({"endpoint": LOCAL, "kind": "openai", "model": "local-model", "context": 32768}),
    );
    call("assistant.default.set", json!({"choice": "endpoint"}));
}

fn configure_remote_default() {
    call(
        "provider.configure",
        json!({"endpoint": REMOTE, "kind": "openai", "model": "remote-model", "context": 32768}),
    );
    call("assistant.default.set", json!({"choice": "endpoint"}));
}

#[derive(Default)]
struct ScriptedProvider {
    calls: AtomicUsize,
    fail_code: Mutex<Option<&'static str>>,
    bad_angles: Mutex<bool>,
    bad_packaging: Mutex<bool>,
    bad_thumbnail: Mutex<bool>,
    bad_script_block: Mutex<bool>,
    bad_translation: Mutex<bool>,
}

impl ScriptedProvider {
    fn count(&self) -> usize {
        self.calls.load(Ordering::SeqCst)
    }
}

impl Provider for ScriptedProvider {
    fn structured(&self, _: &StructuredRequest) -> Result<Value, CoreError> {
        unreachable!("executor uses structured_with")
    }

    fn structured_with(
        &self,
        request: &StructuredRequest,
        _: &CancelToken,
    ) -> Result<Value, CoreError> {
        self.calls.fetch_add(1, Ordering::SeqCst);
        if let Some(code) = self.fail_code.lock().unwrap().take() {
            return Err(CoreError {
                code: code.into(),
                message: format!("modelo respondeu texto cru: {SECRET_LEAK}"),
                usage: None,
            });
        }
        let data = if request.transcript.starts_with("#ANGULOS") {
            if *self.bad_angles.lock().unwrap() {
                json!({
                    "schemaVersion": 1,
                    "angles": [
                        {"name": "A", "promise": "Uma promessa curta.", "audience": "Público", "sentence_ids": [999]},
                        {"name": "B", "promise": "Outra promessa curta.", "audience": "Público", "sentence_ids": [10]}
                    ]
                })
            } else {
                json!({
                    "schemaVersion": 1,
                    "angles": [
                        {"name": "Escolha", "promise": "Entenda por que decidir cedo muda o resultado.", "audience": "Quem decide", "sentence_ids": [10, 11]},
                        {"name": "Aprendizado", "promise": "Descubra como transformar uma falha em aprendizado.", "audience": "Iniciantes", "sentence_ids": [12]}
                    ]
                })
            }
        } else if request.transcript.starts_with("#BLOCO") {
            if *self.bad_script_block.lock().unwrap() {
                json!({"schemaVersion": 1, "narration": ""})
            } else {
                json!({"schemaVersion": 1, "narration": "Narração curta e clara sobre o trecho do Corte."})
            }
        } else if request.schema.to_string().contains("blocks") {
            json!({
                "schemaVersion": 1,
                "language": "pt-BR",
                "blocks": [
                    {"title": "Bloco 1", "intent": "Apresentar a escolha.", "refs": [10]},
                    {"title": "Bloco 2", "intent": "Explicar o impacto.", "refs": [11]},
                    {"title": "Bloco 3", "intent": "Fechar com síntese.", "refs": [12]}
                ]
            })
        } else if request.transcript.starts_with("#CAPA") {
            if *self.bad_thumbnail.lock().unwrap() {
                json!({"schemaVersion": 1, "sentenceId": 999, "why": "Fora do Corte."})
            } else {
                json!({"schemaVersion": 1, "sentenceId": 10, "why": "Momento que sustenta a promessa."})
            }
        } else if request.schema.to_string().contains("hashtags") {
            if *self.bad_packaging.lock().unwrap() {
                json!({
                    "schemaVersion": 1,
                    "language": "en",
                    "title": "English title",
                    "description": "Wrong language description.",
                    "tags": ["tag"],
                    "hashtags": ["#tag"]
                })
            } else {
                json!({
                    "schemaVersion": 1,
                    "language": "pt-BR",
                    "title": "Título do Corte",
                    "description": "Resumo curto do Corte.",
                    "tags": ["escolha"],
                    "hashtags": ["#escolha"]
                })
            }
        } else if request.transcript.starts_with("#TRADUCAO") {
            if *self.bad_translation.lock().unwrap() {
                json!({"schemaVersion": 1, "language": "en", "lines": [{"id": 10, "text": ""}]})
            } else {
                let lines: Vec<Value> = request
                    .transcript
                    .lines()
                    .filter(|l| !l.starts_with('#') && !l.trim().is_empty())
                    .filter_map(|l| l.split_once(' ').and_then(|(id, rest)| Some((id.parse::<i64>().ok()?, rest))))
                    .map(|(id, rest)| json!({"id": id, "text": format!("Translated line {id} from {rest}")}))
                    .collect();
                json!({"schemaVersion": 1, "language": "en", "lines": lines})
            }
        } else {
            let first = request
                .transcript
                .lines()
                .find(|l| !l.starts_with('#'))
                .and_then(|l| l.split(' ').next())
                .and_then(|id| id.parse::<i64>().ok());
            let commentary = request.schema.to_string().contains("commentary");
            let list = if first == Some(1) {
                let mut c = json!({
                    "startId": 10,
                    "endId": 12,
                    "title": "",
                    "hook": {"score": 9, "why": "motivo"},
                    "selfContained": {"score": 9, "why": "motivo"},
                    "energy": {"score": 9, "why": "motivo"},
                    "value": {"score": 9, "why": "motivo"},
                    "closing": {"score": 9, "why": "motivo"},
                });
                if commentary {
                    c["commentary"] = json!({"score": 9, "why": "motivo"});
                }
                vec![c]
            } else {
                vec![]
            };
            json!({"schemaVersion": 1, "candidates": list})
        };
        Ok(json!({
            "data": data,
            "usage": {"inputTokens": 10, "outputTokens": 5},
            "calls": 1
        }))
    }
}

fn seed_source() -> i64 {
    with_writer(|c| {
        c.execute(
            "INSERT INTO sources(path,size,duration_us,partial_hash,metadata,permission,audio_track) VALUES ('C:/videos/live.mp4',1,2400000000,'h','{}',?1,0)",
            [json!({"status": "granted", "who": "Host", "where": "Email", "scope": "translation"}).to_string()],
        )?;
        let source = c.last_insert_rowid();
        c.execute(
            "INSERT INTO transcripts(source_id,audio_track,engine,model,revision,compute_type,state,resume_us,duration_us) VALUES (?1,0,'local','m','r','c','complete',2400000000,2400000000)",
            [source],
        )?;
        let transcript = c.last_insert_rowid();
        for position in 0..2400_i64 {
            let text = if position % 10 == 9 {
                " palavra."
            } else {
                " palavra"
            };
            c.execute(
                "INSERT INTO transcript_words(transcript_id,position,kind,text,start_us,end_us,language) VALUES (?1,?2,'word',?3,?4,?5,'pt')",
                (transcript, position, text, position * 1_000_000, (position + 1) * 1_000_000),
            )?;
        }
        Ok(source)
    })
    .unwrap()
}

fn wait_until(mut poll: impl FnMut() -> Value, done: impl Fn(&Value) -> bool) -> Value {
    let deadline = Instant::now() + Duration::from_secs(60);
    loop {
        let value = poll();
        if done(&value) {
            return value;
        }
        assert!(Instant::now() < deadline, "timed out waiting: {value}");
        std::thread::sleep(Duration::from_millis(20));
    }
}

fn assert_local_only_veto(
    provider: &ScriptedProvider,
    task: &str,
    cmd: &str,
    args_without_confirmed: Value,
    args_with_confirmed: Value,
) {
    let before = provider.count();
    call(
        "assistant.local_only.set",
        json!({"task": task, "enabled": true}),
    );
    assert_eq!(
        fail(cmd, args_without_confirmed.clone()).code,
        "local_only_violation",
        "task local_only must block before confirmation for {cmd}"
    );
    assert_eq!(
        fail(cmd, args_with_confirmed.clone()).code,
        "local_only_violation",
        "task local_only must block even with confirmed for {cmd}"
    );
    call(
        "assistant.local_only.set",
        json!({"task": task, "enabled": false}),
    );

    call("projects.local_only.set", json!({"enabled": true}));
    assert_eq!(
        fail(cmd, args_without_confirmed).code,
        "local_only_violation",
        "project local_only must block before confirmation for {cmd}"
    );
    assert_eq!(
        fail(cmd, args_with_confirmed).code,
        "local_only_violation",
        "project local_only must block even with confirmed for {cmd}"
    );
    call("projects.local_only.set", json!({"enabled": false}));
    assert_eq!(provider.count(), before, "{cmd} hit provider during veto");
}

fn assert_requires_confirmation(provider: &ScriptedProvider, cmd: &str, args: Value) -> Value {
    let before = provider.count();
    let err = fail(cmd, args);
    assert_eq!(
        err.code, "confirmation_required",
        "expected confirmation_required for {cmd}"
    );
    let usage = err.usage.expect("confirmation_required must carry usage");
    assert!(
        usage["estimate"].is_object(),
        "{cmd} confirmation_required missing usage.estimate: {usage}"
    );
    assert!(
        usage["estimate"]["kind"].is_string(),
        "{cmd} usage.estimate.kind missing: {usage}"
    );
    assert_eq!(
        provider.count(),
        before,
        "{cmd} hit provider before confirmation"
    );
    usage
}

#[test]
fn ai_preflight_confirmation_and_sanitized_outcomes_across_all_tasks() {
    let root = tempfile::tempdir().unwrap();
    std::env::set_var("CLIPES_DATA_DIR", root.path().join("data"));
    call(
        "projects.create",
        json!({"parent": root.path(), "name": "Canal"}),
    );

    let source = seed_source();
    call("transcription.segment", json!({"source_id": source}));

    let fake = Arc::new(ScriptedProvider::default());
    jobs::set_ai_provider(Some(fake.clone()));
    jobs::set_ai_route(None);

    // Perfis extras para testar jobs.redo* e selection.redo com profileId.
    call(
        "provider.configure",
        json!({"profileId": "local-alt", "label": "Local Alt", "kind": "openai", "endpoint": "http://127.0.0.1:11/v1", "model": "local-alt-model"}),
    );
    call(
        "provider.configure",
        json!({"profileId": "remote-alt", "label": "Remote Alt", "kind": "openai", "endpoint": REMOTE, "model": "remote-alt-model"}),
    );

    // ---------------- 1. selection.* ----------------
    configure_remote_default();
    assert_local_only_veto(
        &fake,
        "selection",
        "selection.estimate",
        json!({"source_id": source, "videoKind": "transformed"}),
        json!({"source_id": source, "videoKind": "transformed"}),
    );
    assert_local_only_veto(
        &fake,
        "selection",
        "selection.start",
        json!({"source_id": source, "videoKind": "transformed"}),
        json!({"source_id": source, "videoKind": "transformed", "confirmed": true}),
    );
    assert_requires_confirmation(
        &fake,
        "selection.start",
        json!({"source_id": source, "videoKind": "transformed"}),
    );

    configure_local_default();
    let sel_est = call(
        "selection.estimate",
        json!({"source_id": source, "videoKind": "transformed"}),
    );
    assert_eq!(sel_est["paid"], false);
    // Local sem confirmed executa.
    let run = call(
        "selection.start",
        json!({"source_id": source, "videoKind": "transformed"}),
    )["run"]
        .as_i64()
        .unwrap();
    let sel_doc = wait_until(
        || call("selection.get", json!({"run": run})),
        |v| v["run"]["state"] == "completed",
    );
    let candidate = sel_doc["candidates"][0]["id"].as_i64().unwrap();
    let sel_job0 = sel_doc["windows"][0]["jobId"].as_i64().unwrap();
    call(
        "selection.decide",
        json!({"candidate": candidate, "decision": "approved"}),
    );

    // selection.redo com profileId remoto vs local + veto local_only.
    assert_local_only_veto(
        &fake,
        "selection",
        "selection.redo",
        json!({"run": run, "windows": [0], "profileId": "remote-alt"}),
        json!({"run": run, "windows": [0], "profileId": "remote-alt", "confirmed": true}),
    );
    let redo_usage = assert_requires_confirmation(
        &fake,
        "selection.redo",
        json!({"run": run, "windows": [0], "profileId": "remote-alt"}),
    );
    assert_eq!(redo_usage["profile"]["id"], "remote-alt");
    assert_eq!(redo_usage["leavesMachine"], true);
    // Local sem confirmed executa.
    call(
        "selection.redo",
        json!({"run": run, "windows": [0], "profileId": "local-alt"}),
    );
    let redo_doc = wait_until(
        || call("selection.get", json!({"run": run})),
        |v| v["run"]["state"] == "completed" && v["run"]["revision"] == 2,
    );
    let candidate = redo_doc["candidates"][0]["id"].as_i64().unwrap();

    // ---------------- 2. jobs.redo* ----------------
    assert_local_only_veto(
        &fake,
        "selection",
        "jobs.redo.estimate",
        json!({"id": sel_job0, "profileId": "remote-alt"}),
        json!({"id": sel_job0, "profileId": "remote-alt"}),
    );
    assert_local_only_veto(
        &fake,
        "selection",
        "jobs.redo",
        json!({"id": sel_job0, "profileId": "remote-alt"}),
        json!({"id": sel_job0, "profileId": "remote-alt", "confirmed": true}),
    );
    let jobs_redo_usage = assert_requires_confirmation(
        &fake,
        "jobs.redo",
        json!({"id": sel_job0, "profileId": "remote-alt"}),
    );
    assert_eq!(jobs_redo_usage["profile"]["id"], "remote-alt");
    assert_eq!(jobs_redo_usage["leavesMachine"], true);
    let jobs_redo_est = call(
        "jobs.redo.estimate",
        json!({"id": sel_job0, "profileId": "local-alt"}),
    );
    assert_eq!(jobs_redo_est["paid"], false);
    assert_eq!(jobs_redo_est["leavesMachine"], false);
    let redone_job = call("jobs.redo", json!({"id": sel_job0, "profileId": "local-alt"}))["job"]
        .as_i64()
        .unwrap();
    wait_until(
        || {
            call("jobs.list", json!({}))
                .as_array()
                .unwrap()
                .iter()
                .find(|j| j["id"] == redone_job)
                .cloned()
                .unwrap_or(Value::Null)
        },
        |j| j["state"] == "completed",
    );

    // ---------------- 3. angles.* ----------------
    configure_remote_default();
    assert_local_only_veto(
        &fake,
        "script",
        "angles.estimate",
        json!({"candidate": candidate}),
        json!({"candidate": candidate}),
    );
    assert_local_only_veto(
        &fake,
        "script",
        "angles.generate",
        json!({"candidate": candidate}),
        json!({"candidate": candidate, "confirmed": true}),
    );
    assert_requires_confirmation(&fake, "angles.generate", json!({"candidate": candidate}));

    configure_local_default();
    assert_eq!(
        call("angles.estimate", json!({"candidate": candidate}))["paid"],
        false
    );
    call("angles.generate", json!({"candidate": candidate}));
    let angles_ok = wait_until(
        || call("angles.get", json!({"candidate": candidate})),
        |v| v["busy"] == false,
    );
    assert_eq!(angles_ok["job"]["state"], "completed");
    call(
        "angles.choose",
        json!({"candidate": candidate, "generation": angles_ok["generation"], "index": 0}),
    );

    *fake.bad_angles.lock().unwrap() = true;
    call("angles.generate", json!({"candidate": candidate}));
    let angles_bad = wait_until(
        || call("angles.get", json!({"candidate": candidate})),
        |v| v["busy"] == false,
    );
    *fake.bad_angles.lock().unwrap() = false;
    assert_eq!(angles_bad["job"]["state"], "failed");
    assert_eq!(angles_bad["job"]["code"], "verification_failed");
    assert!(!angles_bad.to_string().contains(SECRET_LEAK));

    // ---------------- 4. packaging.* ----------------
    configure_remote_default();
    assert_local_only_veto(
        &fake,
        "packaging",
        "packaging.estimate",
        json!({"candidate": candidate}),
        json!({"candidate": candidate}),
    );
    assert_local_only_veto(
        &fake,
        "packaging",
        "packaging.generate",
        json!({"candidate": candidate}),
        json!({"candidate": candidate, "confirmed": true}),
    );
    assert_requires_confirmation(&fake, "packaging.generate", json!({"candidate": candidate}));

    configure_local_default();
    assert_eq!(
        call("packaging.estimate", json!({"candidate": candidate}))["paid"],
        false
    );
    call("packaging.generate", json!({"candidate": candidate}));
    let pkg_ok = wait_until(
        || call("packaging.get", json!({"candidate": candidate})),
        |v| v["job"]["state"] == "completed",
    );
    assert_eq!(pkg_ok["current"]["title"], "Título do Corte");

    *fake.bad_packaging.lock().unwrap() = true;
    call("packaging.generate", json!({"candidate": candidate}));
    let pkg_bad = wait_until(
        || call("packaging.get", json!({"candidate": candidate})),
        |v| v["job"]["state"] == "failed",
    );
    *fake.bad_packaging.lock().unwrap() = false;
    assert_eq!(pkg_bad["job"]["code"], "verification_failed");
    assert!(pkg_bad["job"]["violations"]
        .as_array()
        .unwrap()
        .contains(&json!("language_mismatch")));

    // ---------------- 5. thumbnail.* ----------------
    configure_remote_default();
    assert_local_only_veto(
        &fake,
        "packaging",
        "thumbnail.estimate",
        json!({"candidate": candidate}),
        json!({"candidate": candidate}),
    );
    assert_local_only_veto(
        &fake,
        "packaging",
        "thumbnail.suggest",
        json!({"candidate": candidate}),
        json!({"candidate": candidate, "confirmed": true}),
    );
    assert_requires_confirmation(&fake, "thumbnail.suggest", json!({"candidate": candidate}));

    configure_local_default();
    assert_eq!(
        call("thumbnail.estimate", json!({"candidate": candidate}))["paid"],
        false
    );
    call("thumbnail.suggest", json!({"candidate": candidate}));
    let thumb_ok = wait_until(
        || call("thumbnail.get", json!({"candidate": candidate})),
        |v| v["job"]["state"] == "completed",
    );
    assert_eq!(thumb_ok["job"]["state"], "completed");

    *fake.bad_thumbnail.lock().unwrap() = true;
    call("thumbnail.suggest", json!({"candidate": candidate}));
    let thumb_bad = wait_until(
        || call("thumbnail.get", json!({"candidate": candidate})),
        |v| v["job"]["state"] == "failed",
    );
    *fake.bad_thumbnail.lock().unwrap() = false;
    assert_eq!(thumb_bad["job"]["code"], "verification_failed");
    assert!(thumb_bad["job"]["violations"]
        .as_array()
        .unwrap()
        .contains(&json!("sentence_outside_cut")));

    // ---------------- 6. script.* ----------------
    configure_remote_default();
    assert_local_only_veto(
        &fake,
        "script",
        "script.estimate",
        json!({"candidate": candidate}),
        json!({"candidate": candidate}),
    );
    assert_local_only_veto(
        &fake,
        "script",
        "script.generate",
        json!({"candidate": candidate}),
        json!({"candidate": candidate, "confirmed": true}),
    );
    assert_requires_confirmation(&fake, "script.generate", json!({"candidate": candidate}));

    configure_local_default();
    assert_eq!(
        call("script.estimate", json!({"candidate": candidate}))["paid"],
        false
    );
    call("script.generate", json!({"candidate": candidate}));
    let script_ok = wait_until(
        || call("script.get", json!({"candidate": candidate})),
        |v| v["busy"] == false && v["current"]["complete"] == true,
    );
    let block_id = script_ok["current"]["blocks"][0]["id"].as_i64().unwrap();

    configure_remote_default();
    assert_local_only_veto(
        &fake,
        "script",
        "script.regenerate",
        json!({"candidate": candidate, "block": block_id}),
        json!({"candidate": candidate, "block": block_id, "confirmed": true}),
    );
    assert_requires_confirmation(
        &fake,
        "script.regenerate",
        json!({"candidate": candidate, "block": block_id}),
    );

    configure_local_default();
    *fake.bad_script_block.lock().unwrap() = true;
    call(
        "script.regenerate",
        json!({"candidate": candidate, "block": block_id}),
    );
    let script_bad = wait_until(
        || call("script.get", json!({"candidate": candidate})),
        |v| v["busy"] == false,
    );
    *fake.bad_script_block.lock().unwrap() = false;
    assert_eq!(script_bad["current"]["blocks"][0]["job"]["state"], "failed");
    assert_eq!(
        script_bad["current"]["blocks"][0]["job"]["code"],
        "verification_failed"
    );
    assert!(!script_bad["current"]["blocks"][0]["job"]["violations"]
        .as_array()
        .unwrap()
        .is_empty());

    // ---------------- 7. translation.* ----------------
    let clip = call(
        "editor.open",
        json!({"source_id": source, "start_id": 10, "end_id": 12, "candidate_id": candidate}),
    )["clipId"]
        .as_i64()
        .unwrap();

    configure_remote_default();
    assert_local_only_veto(
        &fake,
        "translation",
        "translation.estimate",
        json!({"clip_id": clip}),
        json!({"clip_id": clip}),
    );
    assert_local_only_veto(
        &fake,
        "translation",
        "translation.start",
        json!({"clip_id": clip}),
        json!({"clip_id": clip, "confirmed": true}),
    );
    assert_requires_confirmation(&fake, "translation.start", json!({"clip_id": clip}));

    configure_local_default();
    assert_eq!(
        call("translation.estimate", json!({"clip_id": clip}))["paid"],
        false
    );
    let tr_run = call("translation.start", json!({"clip_id": clip}))["run"]
        .as_i64()
        .unwrap();
    let tr_ok = wait_until(
        || call("translation.get", json!({"clip_id": clip})),
        |v| v["run"]["id"] == tr_run && v["run"]["state"] != "running",
    );
    assert_eq!(tr_ok["run"]["state"], "completed");

    // Falha de translation com invalid_json contendo texto/caminho secreto: `*.get` só expõe código seguro.
    *fake.fail_code.lock().unwrap() = Some("invalid_json");
    let tr_fail_run = call("translation.start", json!({"clip_id": clip}))["run"]
        .as_i64()
        .unwrap();
    let tr_fail = wait_until(
        || call("translation.get", json!({"clip_id": clip})),
        |v| v["run"]["id"] == tr_fail_run && v["run"]["state"] != "running",
    );
    assert_eq!(tr_fail["run"]["state"], "failed");
    assert_eq!(tr_fail["run"]["jobs"][0]["code"], "invalid_json");
    assert_eq!(tr_fail["run"]["jobs"][0]["violations"], json!([]));
    assert!(!tr_fail.to_string().contains(SECRET_LEAK));

    // Também garante que um result de job com `code`/`violations` inseguros nunca vaza em `*.get`.
    let bad_json = json!({
        "outcome": "failed",
        "code": "bad code C:/secret",
        "violations": [{"code": "good_code"}, {"code": "Bad/Path!"}]
    })
    .to_string();
    let tr_job_id = tr_fail["run"]["jobs"][0]["id"].as_i64().unwrap();
    let pkg_job_id = pkg_bad["job"]["id"].as_i64().unwrap();
    let thumb_job_id = thumb_bad["job"]["id"].as_i64().unwrap();
    let angles_job_id = angles_bad["job"]["id"].as_i64().unwrap();
    let script_job_id = script_bad["current"]["blocks"][0]["job"]["id"]
        .as_i64()
        .unwrap();
    with_writer(|c| {
        for jid in [
            tr_job_id,
            pkg_job_id,
            thumb_job_id,
            angles_job_id,
            script_job_id,
        ] {
            c.execute("UPDATE jobs SET result=?2 WHERE id=?1", (jid, &bad_json))?;
        }
        Ok(())
    })
    .unwrap();
    for (cmd, args) in [
        ("angles.get", json!({"candidate": candidate})),
        ("packaging.get", json!({"candidate": candidate})),
        ("thumbnail.get", json!({"candidate": candidate})),
    ] {
        let got = call(cmd, args);
        assert_eq!(got["job"]["code"], Value::Null, "{cmd} leaked unsafe code");
        assert_eq!(
            got["job"]["violations"],
            json!(["good_code"]),
            "{cmd} leaked unsafe violation"
        );
    }
    let script_sanitized = call("script.get", json!({"candidate": candidate}));
    assert_eq!(
        script_sanitized["current"]["blocks"][0]["job"]["code"],
        Value::Null
    );
    assert_eq!(
        script_sanitized["current"]["blocks"][0]["job"]["violations"],
        json!(["good_code"])
    );
    let tr_sanitized = call("translation.get", json!({"clip_id": clip}));
    assert_eq!(tr_sanitized["run"]["jobs"][0]["code"], Value::Null);
    assert_eq!(
        tr_sanitized["run"]["jobs"][0]["violations"],
        json!(["good_code"])
    );

    // Também testa `selection.resume` com falha + confirmação paga + `local_only_violation`
    // e sanitização de `code` inseguro em `selection.get`.
    *fake.fail_code.lock().unwrap() = Some("invalid_json");
    let fail_sel_run = call(
        "selection.start",
        json!({"source_id": source, "videoKind": "direct"}),
    )["run"]
        .as_i64()
        .unwrap();
    let fail_sel_doc = wait_until(
        || call("selection.get", json!({"run": fail_sel_run})),
        |v| v["run"]["state"] == "partial",
    );
    let fail_sel_job = fail_sel_doc["windows"][0]["jobId"].as_i64().unwrap();
    assert!(!fail_sel_doc.to_string().contains(SECRET_LEAK));
    assert_eq!(
        fail_sel_doc["run"]["summary"]["windows"]["failed"][0]["code"],
        "invalid_json"
    );
    with_writer(|c| {
        c.execute(
            "UPDATE jobs SET result=?2 WHERE id=?1",
            (fail_sel_job, &bad_json),
        )?;
        Ok(())
    })
    .unwrap();
    // `selection.resume` com provedor pago exige confirmação; `local_only` bloqueia antes.
    configure_remote_default();
    assert_local_only_veto(
        &fake,
        "selection",
        "selection.resume",
        json!({"run": fail_sel_run}),
        json!({"run": fail_sel_run, "confirmed": true}),
    );
    assert_requires_confirmation(&fake, "selection.resume", json!({"run": fail_sel_run}));
    configure_local_default();
    call("selection.resume", json!({"run": fail_sel_run}));
    wait_until(
        || call("selection.get", json!({"run": fail_sel_run})),
        |v| v["run"]["state"] == "completed",
    );

    jobs::set_ai_provider(None);
    jobs::set_ai_route(None);
    call("projects.close", json!({}));
    std::env::remove_var("CLIPES_DATA_DIR");
}
