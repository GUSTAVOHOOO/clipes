//! Crop manual (#71): histórico undo/redo, prévias, corte seco manual e reanálise.
use clipes_core::{dispatch, projects::with_writer};
use serde_json::{json, Value};

fn call(name: &str, args: Value) -> Value {
    dispatch(name, args, &mut |_| {}).unwrap()
}

#[test]
fn manual_crop_edits_undo_redo_and_reframe_rerun_preserve_edits() {
    let root = tempfile::tempdir().unwrap();
    let data = root.path().join("data");
    std::env::set_var("CLIPES_DATA_DIR", &data);
    std::env::set_var("CLIPES_FAKE_WORKER_MODE", "transcribe");
    let venv = if cfg!(windows) {
        "worker/venv/Scripts/python.exe"
    } else {
        "worker/venv/bin/python"
    };
    let python = data.join(venv);
    std::fs::create_dir_all(python.parent().unwrap()).unwrap();
    std::fs::copy(env!("CARGO_BIN_EXE_fake-worker"), &python).unwrap();
    std::fs::write(data.join("worker/worker.state.json"), b"{\"cuda\":false}").unwrap();
    let model = data.join("models/yunet");
    std::fs::create_dir_all(&model).unwrap();
    std::fs::write(
        model.join("model.state.json"),
        br#"{"revision":"48b10fa505aeb51fbd127fc60a5c660040e823b7"}"#,
    )
    .unwrap();
    std::fs::write(model.join("face_detection_yunet_2023mar.onnx"), b"fake").unwrap();
    call(
        "components.settings.set",
        json!({"data_dir":data,"cache_dir":root.path().join("cache"),"cache_limit_bytes":1000000,"ffmpeg_path":python}),
    );

    let project = call(
        "projects.create",
        json!({"parent":root.path(),"name":"ManualCrop"}),
    );
    let media = root.path().join("src.mp4");
    std::fs::write(&media, b"synthetic 16:9 media").unwrap();
    let bytes = std::fs::read(&media).unwrap();
    use sha2::{Digest, Sha256};
    let hash = format!("{:x}", Sha256::digest(bytes.repeat(3)));

    let source = with_writer(|c| {
        c.execute("INSERT INTO sources(path,size,duration_us,partial_hash,metadata,permission,audio_track) VALUES (?1,?2,2000000000,?3,?4,'{}',0)", (media.to_str().unwrap(), bytes.len() as i64, hash, r#"{"streams":[{"codec_type":"video","avg_frame_rate":"30/1"}]}"#))?;
        let source = c.last_insert_rowid();
        c.execute("INSERT INTO transcripts(source_id,audio_track,engine,model,revision,compute_type,state,resume_us,duration_us) VALUES (?1,0,'local','m','r','c','complete',2000000000,2000000000)", [source])?;
        let transcript = c.last_insert_rowid();
        for id in 1..=10 {
            c.execute("INSERT INTO sentences(transcript_id,id,first_position,last_position,start_us,end_us,text) VALUES (?1,?2,?2,?2,?3,?4,'Frase')", (transcript,id,(id-1)*10_000_000i64,id*10_000_000i64))?;
            c.execute("INSERT INTO transcript_words(transcript_id,position,kind,text,start_us,end_us,language) VALUES (?1,?2,'word','fala',?3,?4,'pt')",(transcript,id,(id-1)*10_000_000i64,id*10_000_000i64))?;
        }
        Ok(source)
    }).unwrap();

    let opened = call(
        "editor.open",
        json!({"source_id":source,"start_id":1,"end_id":4}),
    );
    let clip_id = opened["clipId"].as_i64().unwrap();

    // Preview não altera histórico nem persiste.
    let preview = call(
        "editor.crop.set_edits",
        json!({"clip_id":clip_id,"preview":true,"edits":[{"timeUs":5_000_000,"x":0.2,"y":0.0,"width":0.3,"height":1.0}]}),
    );
    assert_eq!(preview["undoCount"], 0);
    assert_eq!(preview["edits"].as_array().unwrap().len(), 1);
    assert_eq!(
        call("editor.crop.get", json!({"clip_id":clip_id}))["edits"]
            .as_array()
            .unwrap()
            .len(),
        0
    );

    // Commit cria passos de desfazer; segundo keyframe com cut=true cria corte seco manual.
    let step1 = call(
        "editor.crop.set_edits",
        json!({"clip_id":clip_id,"edits":[{"timeUs":5_000_000,"x":0.2,"y":0.0,"width":0.3,"height":1.0}]}),
    );
    assert_eq!(step1["undoCount"], 1);
    let step2 = call(
        "editor.crop.set_edits",
        json!({"clip_id":clip_id,"edits":[
            {"timeUs":5_000_000,"x":0.2,"y":0.0,"width":0.3,"height":1.0},
            {"timeUs":20_000_000,"x":0.6,"y":0.0,"width":0.3,"height":1.0,"cut":true}
        ]}),
    );
    assert_eq!(step2["undoCount"], 2);
    assert_eq!(step2["resolved"].as_array().unwrap().len(), 2);

    let before_cut = call(
        "editor.crop.evaluate",
        json!({"clip_id":clip_id,"time_us":19_999_999}),
    );
    assert!((before_cut["rect"]["x"].as_f64().unwrap() - 0.2).abs() < 1e-9);
    let at_cut = call(
        "editor.crop.evaluate",
        json!({"clip_id":clip_id,"time_us":20_000_000}),
    );
    assert!((at_cut["rect"]["x"].as_f64().unwrap() - 0.6).abs() < 1e-9);

    // Undo / Redo pelo mecanismo do editor.
    let undone1 = call("editor.undo", json!({"clip_id":clip_id}));
    assert_eq!(undone1["undoCount"], 1);
    assert_eq!(undone1["redoCount"], 1);
    assert_eq!(undone1["crop"]["edits"].as_array().unwrap().len(), 1);
    let undone2 = call("editor.undo", json!({"clip_id":clip_id}));
    assert_eq!(undone2["undoCount"], 0);
    assert_eq!(undone2["crop"]["edits"].as_array().unwrap().len(), 0);
    let redone = call("editor.redo", json!({"clip_id":clip_id}));
    assert_eq!(redone["crop"]["edits"].as_array().unwrap().len(), 1);
    call("editor.redo", json!({"clip_id":clip_id}));

    // Refazer análise automática (reframe.start com force=true) atualiza suggested sem apagar edits.
    let mut rf = call(
        "reframe.start",
        json!({"source":source,"startUs":0,"endUs":40_000_000,"requested":true}),
    );
    let deadline = std::time::Instant::now() + std::time::Duration::from_secs(15);
    while rf["state"] != "completed" {
        assert!(std::time::Instant::now() < deadline, "{rf}");
        std::thread::sleep(std::time::Duration::from_millis(20));
        rf = call("reframe.status", json!({"id":rf["id"]}));
    }
    let applied1 = call(
        "editor.crop.set_suggested",
        json!({"clip_id":clip_id,"reframe_id":rf["id"]}),
    );
    assert_eq!(applied1["edits"].as_array().unwrap().len(), 2);
    assert!(applied1["suggested"].is_object());

    let mut rf2 = call(
        "reframe.start",
        json!({"source":source,"startUs":0,"endUs":40_000_000,"requested":true,"force":true}),
    );
    while rf2["state"] != "completed" {
        assert!(std::time::Instant::now() < deadline, "{rf2}");
        std::thread::sleep(std::time::Duration::from_millis(20));
        rf2 = call("reframe.status", json!({"id":rf2["id"]}));
    }
    let applied2 = call(
        "editor.crop.set_suggested",
        json!({"clip_id":clip_id,"reframe_id":rf2["id"]}),
    );
    assert_eq!(applied2["edits"].as_array().unwrap().len(), 2);

    // Persiste ao fechar e reabrir o Projeto.
    call("projects.close", json!({}));
    call("projects.open", json!({"path":project["path"]}));
    let reopened = call("editor.crop.get", json!({"clip_id":clip_id}));
    assert_eq!(reopened["edits"].as_array().unwrap().len(), 2);
    assert!(reopened["suggested"].is_object());
    call("projects.close", json!({}));
}
