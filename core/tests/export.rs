//! Contrato do export pelo mesmo despacho da UI; sem rede e com dados isolados.
use clipes_core::{dispatch, projects::with_writer};
use serde_json::{json, Value};
use sha2::{Digest, Sha256};
use std::{
    fs,
    sync::{Arc, Mutex},
    time::{Duration, Instant},
};

static TEST_LOCK: Mutex<()> = Mutex::new(());

fn call(name: &str, args: Value) -> Value {
    dispatch(name, args, &mut |_| {}).unwrap()
}
fn fail(name: &str, args: Value, code: &str) {
    let error = dispatch(name, args, &mut |_| {}).unwrap_err();
    assert_eq!(error.code, code, "{error:?}");
    assert!(!error.message.contains("Users"));
}
fn settled(id: i64) -> Value {
    let deadline = Instant::now() + Duration::from_secs(10);
    loop {
        let status = call("export.status", json!({"job":id}));
        if matches!(
            status["state"].as_str(),
            Some("completed" | "cancelled" | "failed")
        ) {
            return status;
        }
        assert!(Instant::now() < deadline, "{status}");
        std::thread::sleep(Duration::from_millis(10));
    }
}

#[test]
fn export_validates_sentences_uses_effective_text_and_is_a_local_queue_job() {
    let _lock = TEST_LOCK.lock().unwrap_or_else(|e| e.into_inner());
    let root = tempfile::tempdir().unwrap();
    let data = root.path().join("data");
    std::env::set_var("CLIPES_DATA_DIR", &data);
    call(
        "projects.create",
        json!({"parent":root.path(),"name":"Canal"}),
    );
    let media = root.path().join("original.mp4");
    fs::write(&media, b"original").unwrap();
    let mut hash = Sha256::new();
    for _ in 0..3 {
        hash.update(b"original");
    }
    let source = with_writer(|c| {
        c.execute("INSERT INTO sources(path,size,duration_us,partial_hash,metadata,permission,audio_track) VALUES (?1,8,2000000,?2,'{}','{}',1)", (media.to_str().unwrap(), format!("{:x}",hash.finalize())))?;
        let source = c.last_insert_rowid();
        c.execute("INSERT INTO transcripts(source_id,audio_track,engine,model,revision,compute_type,state,duration_us) VALUES (?1,1,'local','m','r','c','complete',2000000)", [source])?;
        let transcript = c.last_insert_rowid();
        for (position,text,start,end) in [(0," original",0,400_000),(1," fala.",500_000,900_000),(2," fim.",1_000_000,1_900_000)] {
            c.execute("INSERT INTO transcript_words(transcript_id,position,kind,text,start_us,end_us,language) VALUES (?1,?2,'word',?3,?4,?5,'pt')", (transcript,position,text,start,end))?;
        }
        Ok(source)
    }).unwrap();
    call("transcription.segment", json!({"source_id":source}));
    call(
        "transcription.correct",
        json!({"source_id":source,"position":0,"text":"corrigida"}),
    );
    // O núcleo fornece a quebra para o preview reutilizar. O texto original nunca vaza.
    let caption = call(
        "export.captions",
        json!({"source_id":source,"start_id":1,"end_id":2}),
    );
    assert!(caption["ass"].as_str().unwrap().contains("corrigida"));
    assert!(!caption["ass"].as_str().unwrap().contains("original"));
    assert!(caption["lines"].as_array().is_some());
    let output = root.path().join("corte.mp4");
    let mut request = json!({"source_id":source,"start_id":1,"end_id":2,"output":output});
    request["start_id"] = json!(0);
    fail("export.start", request.clone(), "export_bounds");
    request["start_id"] = json!(1);
    request["end_id"] = json!(999);
    fail("export.start", request.clone(), "export_bounds");
    request["end_id"] = json!(2);
    request["candidate_id"] = json!(999);
    fail("export.start", request.clone(), "export_candidate");
    request.as_object_mut().unwrap().remove("candidate_id");
    fs::write(&output, b"do not replace").unwrap();
    fail("export.start", request.clone(), "export_exists");
    assert_eq!(fs::read(&output).unwrap(), b"do not replace");
    fs::remove_file(&output).unwrap();
    // Sem Componente não há job inútil. Nenhum download é feito pelo export.
    fail("export.start", request.clone(), "component_missing");

    assert_eq!(call("jobs.list", json!({})), json!([]));
    assert_eq!(
        call("export.settings", json!({}))["last_directory"],
        Value::Null
    );
    let candidate=with_writer(|c| {
        c.execute("INSERT INTO selection_runs(transcript_id,task_version,prompt_sha256,state,min_us,max_us,weights,plan_state,windows_total) SELECT id,1,'h','completed',1,9999999,'[]','ready',0 FROM transcripts WHERE source_id=?1",[source])?;
        let run=c.last_insert_rowid();
        c.execute("INSERT INTO selection_candidates(run_id,rank,start_id,end_id,start_us,end_us,axes,total_centi,windows) VALUES (?1,1,1,2,0,1900000,'{}',500,'[]')",[run])?;
        Ok(c.last_insert_rowid())
    }).unwrap();
    request["candidate_id"] = json!(candidate);
    fail("export.start", request.clone(), "export_candidate");
    call(
        "selection.decide",
        json!({"candidate":candidate,"decision":"approved"}),
    );
    request["end_id"] = json!(1);
    fail("export.start", request.clone(), "export_candidate");
    request["end_id"] = json!(2);
    fs::write(data.join("component-settings.json"),json!({"data_dir":data,"cache_dir":data.join("cache"),"cache_limit_bytes":1_000_000,"ffmpeg_path":env!("CARGO_BIN_EXE_fake-export")}).to_string()).unwrap();
    call("projects.local_only.set", json!({"enabled":true}));
    let clip = call("editor.open", request.clone())["clipId"].clone();
    call(
        "editor.adjust",
        json!({"clip_id":clip,"edge":"end","time_us":1_800_000,"free":true}),
    );
    request["clip_id"] = clip.clone();
    // Um snapshot vindo da UI é ignorado no enfileiramento.
    request["resolved_bounds"] = json!([0, 1]);
    let events = Arc::new(Mutex::new(Vec::new()));
    let captured = events.clone();
    assert!(clipes_core::set_event_emitter(Arc::new(move |event| {
        captured.lock().unwrap().push(event);
    }))
    .is_ok());
    std::env::set_var("CLIPES_FAKE_NO_ASS", "1");
    let job = call("export.start", request.clone())["job"]
        .as_i64()
        .unwrap();
    let status = settled(job);
    assert_eq!(status["state"], "failed");
    assert_eq!(status["error"]["code"], "export_ass_missing");
    assert!(!output.exists());
    std::env::remove_var("CLIPES_FAKE_NO_ASS");
    assert_eq!(
        call("export.settings", json!({}))["last_directory"],
        json!(root.path())
    );
    std::env::set_var("CLIPES_FAKE_EXPORT_STATE", root.path());
    let job = call("export.start", request.clone())["job"]
        .as_i64()
        .unwrap();
    let deadline = Instant::now() + Duration::from_secs(10);
    while !root.path().join("started").exists() {
        assert!(Instant::now() < deadline);
        std::thread::sleep(Duration::from_millis(10));
    }
    let frozen = clipes_core::projects::with_reader(|c| {
        c.query_row("SELECT request FROM exports WHERE job_id=?1", [job], |r| {
            r.get::<_, String>(0)
        })
    })
    .unwrap();
    assert_eq!(
        serde_json::from_str::<Value>(&frozen).unwrap()["resolved_bounds"],
        json!([0, 1_800_000])
    );
    call(
        "editor.adjust",
        json!({"clip_id":clip,"edge":"end","time_us":1_700_000,"free":true}),
    );
    assert_eq!(
        serde_json::from_str::<Value>(&frozen).unwrap()["resolved_bounds"],
        json!([0, 1_800_000]),
        "edição posterior não altera o job"
    );
    call("jobs.cancel", json!({"id":job}));
    assert_eq!(settled(job)["state"], "cancelled");
    std::env::remove_var("CLIPES_FAKE_EXPORT_STATE");
    assert!(!output.exists());
    assert!(!fs::read_dir(root.path()).unwrap().any(|f| f
        .unwrap()
        .file_name()
        .to_string_lossy()
        .starts_with(".clipes-export-")));
    let jobs = call("jobs.list", json!({}));
    assert!(jobs
        .as_array()
        .unwrap()
        .iter()
        .all(|j| j["safety"] == "local"));
    assert!(events
        .lock()
        .unwrap()
        .iter()
        .any(|e| e.stage == "export" && e.project.is_some()));
    // O caminho da Fonte original é verificado a cada execução; o proxy não participa.
    fs::write(&media, b"changed!").unwrap();
    fail("export.start", request, "source_changed");
    call("projects.close", json!({}));
}

#[test]
fn export_blocks_missing_glyphs_before_ffmpeg_and_recovers_after_correction() {
    let _lock = TEST_LOCK.lock().unwrap_or_else(|e| e.into_inner());
    let root = tempfile::tempdir().unwrap();
    let data = root.path().join("data");
    fs::create_dir_all(&data).unwrap();
    std::env::set_var("CLIPES_DATA_DIR", &data);
    call(
        "projects.create",
        json!({"parent":root.path(),"name":"CanalGlifo"}),
    );
    let media = root.path().join("original.mp4");
    fs::write(&media, b"original").unwrap();
    let mut hash = Sha256::new();
    for _ in 0..3 {
        hash.update(b"original");
    }
    let source = with_writer(|c| {
        c.execute("INSERT INTO sources(path,size,duration_us,partial_hash,metadata,permission,audio_track) VALUES (?1,8,3000000,?2,'{}','{}',1)", (media.to_str().unwrap(), format!("{:x}",hash.finalize())))?;
        let source = c.last_insert_rowid();
        c.execute("INSERT INTO transcripts(source_id,audio_track,engine,model,revision,compute_type,state,duration_us) VALUES (?1,1,'local','m','r','c','complete',3000000)", [source])?;
        let transcript = c.last_insert_rowid();
        for (position, text, start, end) in [
            (0, " olá.", 0, 400_000),
            (1, " 来", 500_000, 900_000),
            (2, " fim.", 1_000_000, 1_900_000),
        ] {
            c.execute("INSERT INTO transcript_words(transcript_id,position,kind,text,start_us,end_us,language) VALUES (?1,?2,'word',?3,?4,?5,'pt')", (transcript,position,text,start,end))?;
        }
        Ok(source)
    }).unwrap();
    call("transcription.segment", json!({"source_id":source}));

    fs::write(
        data.join("component-settings.json"),
        json!({"data_dir":data,"cache_dir":data.join("cache"),"cache_limit_bytes":1_000_000,"ffmpeg_path":env!("CARGO_BIN_EXE_fake-export")}).to_string(),
    )
    .unwrap();

    // Aviso por palavra em export.captions
    let captions = call(
        "export.captions",
        json!({"source_id":source,"start_id":1,"end_id":2}),
    );
    let cap_missing = captions["missingGlyphs"].as_array().unwrap();
    assert_eq!(cap_missing.len(), 1);
    assert_eq!(cap_missing[0]["position"], 1);
    assert_eq!(cap_missing[0]["sentence_id"], 2);
    assert_eq!(cap_missing[0]["word"], "来");
    assert_eq!(cap_missing[0]["char"], "来");
    assert_eq!(cap_missing[0]["codepoint"], "U+6765");
    assert_eq!(cap_missing[0]["start_us"], 500_000);
    assert_eq!(captions["words"][1]["missingGlyph"]["codepoint"], "U+6765");

    // Bloqueio imediato em export.start antes de enfileirar ou chamar o FFmpeg (mesmo com CLIPES_FAKE_NO_ASS=1).
    std::env::set_var("CLIPES_FAKE_NO_ASS", "1");
    let output = root.path().join("corte.mp4");
    let err = dispatch(
        "export.start",
        json!({"source_id":source,"start_id":1,"end_id":2,"output":output}),
        &mut |_| {},
    )
    .unwrap_err();
    assert_eq!(err.code, "export_glyph_missing");
    assert!(err.message.contains("来"), "{}", err.message);
    assert!(err.message.contains("Frase 2"), "{}", err.message);
    let usage = err.usage.expect("usage details");
    assert_eq!(usage["missing_glyphs"][0]["position"], 1);
    assert_eq!(usage["missing_glyphs"][0]["sentence_id"], 2);
    assert_eq!(usage["missing_glyphs"][0]["word"], "来");
    assert_eq!(usage["missing_glyphs"][0]["char"], "来");
    assert_eq!(usage["missing_glyphs"][0]["codepoint"], "U+6765");
    assert_eq!(usage["missing_glyphs"][0]["start_us"], 500_000);
    assert_eq!(call("jobs.list", json!({})), json!([]));
    std::env::remove_var("CLIPES_FAKE_NO_ASS");

    // Se a palavra inválida entrar após o enfileiramento, export::run também falha antes do FFmpeg e grava em export.status.
    call(
        "transcription.correct",
        json!({"source_id":source,"position":1,"text":"certo"}),
    );
    let blocker_out = root.path().join("blocker.mp4");
    let state_dir = root.path().join("fake-state");
    fs::create_dir_all(&state_dir).unwrap();
    std::env::set_var("CLIPES_FAKE_EXPORT_STATE", &state_dir);
    let blocker = call(
        "export.start",
        json!({"source_id":source,"start_id":1,"end_id":1,"output":blocker_out}),
    )["job"]
        .as_i64()
        .unwrap();
    let deadline = Instant::now() + Duration::from_secs(10);
    while !state_dir.join("started").exists() {
        assert!(Instant::now() < deadline);
        std::thread::sleep(Duration::from_millis(10));
    }
    let queued_job = call(
        "export.start",
        json!({"source_id":source,"start_id":1,"end_id":2,"output":output}),
    )["job"]
        .as_i64()
        .unwrap();
    call(
        "transcription.correct",
        json!({"source_id":source,"position":1,"text":"来"}),
    );
    std::env::set_var("CLIPES_FAKE_NO_ASS", "1");
    fs::write(state_dir.join("continue"), b"go").unwrap();
    let blocker_status = settled(blocker);
    assert_eq!(blocker_status["state"], "completed", "{blocker_status}");
    let failed_status = settled(queued_job);
    assert_eq!(failed_status["state"], "failed");
    assert_eq!(failed_status["error"]["code"], "export_glyph_missing");
    assert_eq!(
        failed_status["error"]["usage"]["missing_glyphs"][0]["codepoint"],
        "U+6765"
    );
    assert_eq!(
        failed_status["error"]["usage"]["missing_glyphs"][0]["sentence_id"],
        2
    );
    assert!(!output.exists());
    std::env::remove_var("CLIPES_FAKE_NO_ASS");
    std::env::remove_var("CLIPES_FAKE_EXPORT_STATE");

    // Após corrigir a palavra com transcription.correct, o export conclui com sucesso.
    call(
        "transcription.correct",
        json!({"source_id":source,"position":1,"text":"mundo"}),
    );
    let ok_job = call(
        "export.start",
        json!({"source_id":source,"start_id":1,"end_id":2,"output":output}),
    )["job"]
        .as_i64()
        .unwrap();
    assert_eq!(settled(ok_job)["state"], "completed");
    assert!(output.exists());
    call("projects.close", json!({}));
}

#[test]
fn export_batch_rejects_missing_glyph_per_cut_before_render() {
    let _lock = TEST_LOCK.lock().unwrap_or_else(|e| e.into_inner());
    let root = tempfile::tempdir().unwrap();
    let data = root.path().join("data");
    fs::create_dir_all(&data).unwrap();
    std::env::set_var("CLIPES_DATA_DIR", &data);
    call(
        "projects.create",
        json!({"parent":root.path(),"name":"LoteGlifo"}),
    );
    let media = root.path().join("original.mp4");
    fs::write(&media, b"original").unwrap();
    let mut hash = Sha256::new();
    for _ in 0..3 {
        hash.update(b"original");
    }
    let source = with_writer(|c| {
        c.execute(
            "INSERT INTO sources(path,size,duration_us,partial_hash,metadata,permission,audio_track) VALUES (?1,8,3000000,?2,'{}','{}',1)",
            (media.to_str().unwrap(), format!("{:x}", hash.finalize())),
        )?;
        let source = c.last_insert_rowid();
        c.execute(
            "INSERT INTO transcripts(source_id,audio_track,engine,model,revision,compute_type,state,duration_us) VALUES (?1,1,'local','m','r','c','complete',3000000)",
            [source],
        )?;
        let transcript = c.last_insert_rowid();
        for (position, text, start, end) in [
            (0, " olá.", 0, 400_000),
            (1, " 来.", 500_000, 900_000),
        ] {
            c.execute(
                "INSERT INTO transcript_words(transcript_id,position,kind,text,start_us,end_us,language) VALUES (?1,?2,'word',?3,?4,?5,'pt')",
                (transcript, position, text, start, end),
            )?;
        }
        Ok(source)
    })
    .unwrap();
    call("transcription.segment", json!({"source_id":source}));

    let (cand_ok, cand_bad) = with_writer(|c| {
        let t: i64 = c.query_row(
            "SELECT id FROM transcripts WHERE source_id=?1",
            [source],
            |r| r.get(0),
        )?;
        c.execute(
            "INSERT INTO selection_runs(transcript_id,task_version,prompt_sha256,state,min_us,max_us,weights,plan_state,windows_total) VALUES (?1,1,'h','completed',1,9999999,'[]','ready',0)",
            [t],
        )?;
        let run = c.last_insert_rowid();
        c.execute(
            "INSERT INTO selection_candidates(run_id,rank,start_id,end_id,start_us,end_us,axes,total_centi,title,windows) VALUES (?1,1,1,1,0,400000,'{}',800,'Valido','[]')",
            [run],
        )?;
        let cand_ok = c.last_insert_rowid();
        c.execute(
            "INSERT INTO selection_candidates(run_id,rank,start_id,end_id,start_us,end_us,axes,total_centi,title,windows) VALUES (?1,2,2,2,500000,900000,'{}',700,'SemGlifo','[]')",
            [run],
        )?;
        let cand_bad = c.last_insert_rowid();
        Ok((cand_ok, cand_bad))
    })
    .unwrap();
    call(
        "selection.decide",
        json!({"candidate":cand_ok,"decision":"approved"}),
    );
    call(
        "selection.decide",
        json!({"candidate":cand_bad,"decision":"approved"}),
    );

    fs::write(
        data.join("component-settings.json"),
        json!({"data_dir":data,"cache_dir":data.join("cache"),"cache_limit_bytes":1_000_000,"ffmpeg_path":env!("CARGO_BIN_EXE_fake-export")}).to_string(),
    )
    .unwrap();

    let out_dir = root.path().join("batch-out");
    fs::create_dir_all(&out_dir).unwrap();
    let batch = call(
        "export.batch.start",
        json!({"source_id":source,"output_dir":out_dir}),
    );
    let batch_id = batch["id"].as_i64().unwrap();
    assert_eq!(batch["counts"]["total"], 2);
    let items = batch["items"].as_array().unwrap();
    let ok_item = items.iter().find(|i| i["candidateId"] == cand_ok).unwrap();
    let bad_item = items.iter().find(|i| i["candidateId"] == cand_bad).unwrap();
    assert!(ok_item["jobId"].is_i64(), "{ok_item}");
    assert_eq!(bad_item["jobId"], Value::Null);
    assert_eq!(bad_item["state"], "failed");
    assert_eq!(bad_item["error"]["code"], "export_glyph_missing");
    assert!(bad_item["error"]["message"]
        .as_str()
        .unwrap()
        .contains("来"));

    let deadline = Instant::now() + Duration::from_secs(10);
    let settled_batch = loop {
        let view = call("export.batch.status", json!({"id":batch_id}));
        if view["state"] != "running" {
            break view;
        }
        assert!(Instant::now() < deadline, "{view}");
        std::thread::sleep(Duration::from_millis(15));
    };
    assert_eq!(settled_batch["status"], "partial", "{settled_batch}");
    assert_eq!(settled_batch["counts"]["completed"], 1);
    assert_eq!(settled_batch["counts"]["failed"], 1);
    assert!(out_dir
        .join(ok_item["filename"].as_str().unwrap())
        .is_file());
    assert!(!out_dir
        .join(bad_item["filename"].as_str().unwrap())
        .exists());
    call("projects.close", json!({}));
}
