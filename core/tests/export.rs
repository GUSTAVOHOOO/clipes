//! Contrato do export pelo mesmo despacho da UI; sem rede e com dados isolados.
use clipes_core::{dispatch, projects::with_writer};
use serde_json::{json, Value};
use sha2::{Digest, Sha256};
use std::{
    fs,
    sync::{Arc, Mutex},
    time::{Duration, Instant},
};

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
