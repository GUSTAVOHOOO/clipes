//! Contrato de keyframes de crop no documento do Corte (#66): migração v1->v2,
//! separação entre `suggested` e `edits`, interpolação e carga via `reframe`.
use clipes_core::{dispatch, projects::with_writer};
use serde_json::{json, Value};

fn call(name: &str, args: Value) -> Value {
    dispatch(name, args, &mut |_| {}).unwrap()
}

#[test]
fn migrates_v1_clip_documents_to_v2_and_preserves_suggested_separately_from_edits() {
    let root = tempfile::tempdir().unwrap();
    std::env::set_var("CLIPES_DATA_DIR", root.path().join("data"));
    let project = call(
        "projects.create",
        json!({"parent":root.path(),"name":"CropDoc"}),
    );
    let source = with_writer(|c| {
        c.execute("INSERT INTO sources(path,size,duration_us,partial_hash,metadata,permission,audio_track) VALUES ('offline.mp4',1,2000000000,'h',?1,'{}',0)", [r#"{"streams":[{"codec_type":"video","avg_frame_rate":"30/1"}]}"#])?;
        let source = c.last_insert_rowid();
        c.execute("INSERT INTO transcripts(source_id,audio_track,engine,model,revision,compute_type,state,resume_us,duration_us) VALUES (?1,0,'local','m','r','c','complete',2000000000,2000000000)", [source])?;
        let transcript = c.last_insert_rowid();
        for id in 1..=20 {
            c.execute("INSERT INTO sentences(transcript_id,id,first_position,last_position,start_us,end_us,text) VALUES (?1,?2,?2,?2,?3,?4,'Frase')", (transcript,id,(id-1)*10_000_000i64,id*10_000_000i64))?;
            c.execute("INSERT INTO transcript_words(transcript_id,position,kind,text,start_us,end_us,language) VALUES (?1,?2,'word','fala',?3,?4,'pt')",(transcript,id,(id-1)*10_000_000i64,id*10_000_000i64))?;
        }
        let v1_doc = json!({
            "schemaVersion": 1,
            "revision": 3,
            "original": {"source_id": source, "start_id": 2, "end_id": 6},
            "range": {"startId": 2, "endId": 6, "startUs": 10_000_000, "endUs": 60_000_000},
            "undo": [],
            "redo": []
        });
        c.execute(
            "INSERT INTO clip_edits(id,identity,document) VALUES (1,?1,?2)",
            (format!("source:{source}:2:6"), v1_doc.to_string()),
        )?;
        c.execute(
            "INSERT INTO clip_snapshots(clip_id,document) VALUES (1,?1)",
            [v1_doc.to_string()],
        )?;
        let future_doc = json!({
            "schemaVersion": 99,
            "revision": 0,
            "original": {"source_id": source, "start_id": 7, "end_id": 10},
            "range": {"startId": 7, "endId": 10, "startUs": 60_000_000, "endUs": 100_000_000},
            "undo": [],
            "redo": []
        });
        c.execute(
            "INSERT INTO clip_edits(id,identity,document) VALUES (2,?1,?2)",
            (format!("source:{source}:7:10"), future_doc.to_string()),
        )?;
        Ok(source)
    })
    .unwrap();

    // Documento v1 é migrado para v2; versão futura é recusada.
    let opened = call(
        "editor.open",
        json!({"source_id":source,"start_id":2,"end_id":6}),
    );
    assert_eq!(opened["schemaVersion"], 2);
    assert_eq!(opened["revision"], 3);
    assert_eq!(opened["crop"]["hasCrop"], false);
    assert_eq!(
        call("editor.snapshots", json!({"clip_id":1}))[0]["schemaVersion"],
        2
    );
    assert_eq!(
        dispatch(
            "editor.open",
            json!({"source_id":source,"start_id":7,"end_id":10}),
            &mut |_| {}
        )
        .unwrap_err()
        .code,
        "invalid_clip"
    );

    // Sugestão de exemplo entra separada de edits; edits sobrescrevem só o segmento editado.
    let example = call("editor.crop.example", json!({"clip_id":1}));
    assert_eq!(example["hasCrop"], true);
    assert_eq!(example["resolved"].as_array().unwrap().len(), 2);
    let suggested_before = example["suggested"].clone();
    let seg2_start = suggested_before["segments"][1]["startUs"].as_i64().unwrap();
    let seg2_x = suggested_before["segments"][1]["keyframes"][0]["x"]
        .as_f64()
        .unwrap();

    let edited = call(
        "editor.crop.set_edits",
        json!({"clip_id":1,"edits":[{"timeUs":15_000_000,"x":0.4,"y":0.0,"width":0.3,"height":1.0}]}),
    );
    assert_eq!(
        edited["suggested"], suggested_before,
        "suggested é imutável"
    );
    let at_seg1 = call(
        "editor.crop.evaluate",
        json!({"clip_id":1,"time_us":20_000_000}),
    );
    assert!((at_seg1["rect"]["x"].as_f64().unwrap() - 0.4).abs() < 1e-9);
    let at_seg2 = call(
        "editor.crop.evaluate",
        json!({"clip_id":1,"time_us":seg2_start}),
    );
    assert!((at_seg2["rect"]["x"].as_f64().unwrap() - seg2_x).abs() < 1e-9);

    // Refazer a sugestão preserva os edits existentes.
    let reapplied = call(
        "editor.crop.set_suggested",
        json!({"clip_id":1,"suggested":suggested_before}),
    );
    assert_eq!(reapplied["edits"].as_array().unwrap().len(), 1);

    call("projects.close", json!({}));
    call("projects.open", json!({"path":project["path"]}));
    let reopened = call("editor.crop.get", json!({"clip_id":1}));
    assert_eq!(reopened["edits"].as_array().unwrap().len(), 1);
    assert_eq!(reopened["suggested"], suggested_before);

    // export.start congela resolved_crop no enfileiramento; edições depois não mudam o job.
    let data = root.path().join("data");
    std::fs::write(
        data.join("component-settings.json"),
        json!({"data_dir":data,"cache_dir":data.join("cache"),"cache_limit_bytes":1_000_000,"ffmpeg_path":env!("CARGO_BIN_EXE_fake-export")}).to_string(),
    )
    .unwrap();
    let cand = with_writer(|c| {
        c.execute("INSERT INTO selection_runs(transcript_id,task_version,prompt_sha256,state,min_us,max_us,weights,plan_state,windows_total) SELECT id,1,'h','completed',20000000,180000000,'[]','ready',0 FROM transcripts WHERE source_id=?1",[source])?;
        let run = c.last_insert_rowid();
        c.execute("INSERT INTO selection_candidates(run_id,rank,start_id,end_id,start_us,end_us,axes,total_centi,windows) VALUES (?1,1,2,6,10000000,60000000,'{}',500,'[]')",[run])?;
        Ok(c.last_insert_rowid())
    })
    .unwrap();
    call(
        "selection.decide",
        json!({"candidate":cand,"decision":"approved"}),
    );
    let media = root.path().join("media.mp4");
    std::fs::write(&media, b"fake media").unwrap();
    let bytes = std::fs::read(&media).unwrap();
    use sha2::{Digest, Sha256};
    let hash = format!("{:x}", Sha256::digest(bytes.repeat(3)));
    with_writer(|c| {
        c.execute(
            "UPDATE sources SET path=?2,size=?3,partial_hash=?4 WHERE id=?1",
            (source, media.to_str().unwrap(), bytes.len() as i64, hash),
        )?;
        Ok(())
    })
    .unwrap();
    let cand_clip = call(
        "editor.open",
        json!({"source_id":source,"start_id":2,"end_id":6,"candidate_id":cand}),
    )["clipId"]
        .as_i64()
        .unwrap();
    call(
        "editor.crop.set_edits",
        json!({"clip_id":cand_clip,"edits":[{"timeUs":10_000_000,"x":0.15,"y":0.0,"width":0.3,"height":1.0}]}),
    );
    let out = root.path().join("frozen-crop.mp4");
    let job = call(
        "export.start",
        json!({"source_id":source,"start_id":2,"end_id":6,"candidate_id":cand,"clip_id":cand_clip,"output":out,"resolved_crop":[{"startUs":0,"endUs":1,"reason":"start","keyframes":[]}]}),
    )["job"]
        .as_i64()
        .unwrap();
    let frozen: String = clipes_core::projects::with_reader(|c| {
        c.query_row("SELECT request FROM exports WHERE job_id=?1", [job], |r| {
            r.get(0)
        })
    })
    .unwrap();
    let frozen_json: Value = serde_json::from_str(&frozen).unwrap();
    assert_eq!(frozen_json["resolved_crop"][0]["keyframes"][0]["x"], 0.15);
    call(
        "editor.crop.set_edits",
        json!({"clip_id":cand_clip,"edits":[{"timeUs":10_000_000,"x":0.55,"y":0.0,"width":0.3,"height":1.0}]}),
    );
    let frozen_after: String = clipes_core::projects::with_reader(|c| {
        c.query_row("SELECT request FROM exports WHERE job_id=?1", [job], |r| {
            r.get(0)
        })
    })
    .unwrap();
    assert_eq!(
        serde_json::from_str::<Value>(&frozen_after).unwrap()["resolved_crop"][0]["keyframes"][0]
            ["x"],
        0.15,
        "edição de crop depois de enfileirar não muda o job"
    );

    // #78: cinco layouts, proporção ajustável, painéis independentes, undo/redo e congelamento no export.
    let err_ratio = dispatch(
        "editor.crop.set_layout",
        json!({"clip_id":cand_clip,"layout":"gameplay_webcam","split_ratio":0.10}),
        &mut |_| {},
    )
    .unwrap_err();
    assert_eq!(err_ratio.code, "invalid_crop");

    // Fullscreen ROI reutiliza os edits manuais do #71 e ignora suggested.
    call(
        "editor.crop.set_suggested",
        json!({"clip_id":cand_clip,"suggested":suggested_before}),
    );
    let roi = call(
        "editor.crop.set_layout",
        json!({"clip_id":cand_clip,"layout":"fullscreen_roi"}),
    );
    assert_eq!(roi["layout"], "fullscreen_roi");
    assert_eq!(
        roi["plan"]["panels"][0]["keyframes"]
            .as_array()
            .map(|a| a.len())
            .unwrap_or(0),
        0
    );
    assert!(
        (roi["plan"]["panels"][0]["segments"][0]["keyframes"][0]["x"]
            .as_f64()
            .unwrap()
            - 0.55)
            .abs()
            < 1e-9
    );

    // Jogo + webcam: padrão 30/70, ajustável 20..50%, retângulos manuais por painel preservados no undo/redo.
    let gw = call(
        "editor.crop.set_layout",
        json!({"clip_id":cand_clip,"layout":"gameplay_webcam","split_ratio":0.35}),
    );
    assert_eq!(gw["layout"], "gameplay_webcam");
    assert_eq!(gw["plan"]["panels"][0]["targetHeight"], 672);
    assert_eq!(gw["plan"]["panels"][1]["targetHeight"], 1248);

    let gw_top = call(
        "editor.crop.set_edits",
        json!({"clip_id":cand_clip,"panel":"top","edits":[{"timeUs":12_000_000,"x":0.02,"y":0.04,"width":0.25,"height":0.24}]}),
    );
    assert!(
        (gw_top["plan"]["panels"][0]["segments"][0]["keyframes"][0]["x"]
            .as_f64()
            .unwrap()
            - 0.02)
            .abs()
            < 1e-9
    );
    let gw_bot = call(
        "editor.crop.set_edits",
        json!({"clip_id":cand_clip,"panel":"bottom","edits":[{"timeUs":12_000_000,"x":0.30,"y":0.0,"width":0.42,"height":1.0}]}),
    );
    assert!(
        (gw_bot["plan"]["panels"][1]["segments"][0]["keyframes"][0]["x"]
            .as_f64()
            .unwrap()
            - 0.30)
            .abs()
            < 1e-9
    );

    let eval_gw = call(
        "editor.crop.evaluate",
        json!({"clip_id":cand_clip,"time_us":12_000_000}),
    );
    assert_eq!(eval_gw["panels"].as_array().unwrap().len(), 2);
    assert!((eval_gw["panels"][0]["rect"]["x"].as_f64().unwrap() - 0.02).abs() < 1e-9);
    assert!((eval_gw["panels"][1]["rect"]["x"].as_f64().unwrap() - 0.30).abs() < 1e-9);

    // Duas pessoas empilhadas + Fit/centro.
    let tp = call(
        "editor.crop.set_layout",
        json!({"clip_id":cand_clip,"layout":"two_people"}),
    );
    assert_eq!(tp["plan"]["panels"][0]["targetHeight"], 960);
    assert_eq!(tp["plan"]["panels"][1]["targetHeight"], 960);

    let fit = call(
        "editor.crop.set_layout",
        json!({"clip_id":cand_clip,"layout":"fit"}),
    );
    assert_eq!(fit["plan"]["panels"][0]["fitMode"], "fit");

    // Undo volta para two_people e depois para gameplay_webcam com edits preservados.
    let undone_tp = call("editor.undo", json!({"clip_id":cand_clip}));
    assert_eq!(undone_tp["crop"]["layout"], "two_people");
    let undone_gw = call("editor.undo", json!({"clip_id":cand_clip}));
    assert_eq!(undone_gw["crop"]["layout"], "gameplay_webcam");
    assert!(
        (undone_gw["crop"]["plan"]["panels"][0]["segments"][0]["keyframes"][0]["x"]
            .as_f64()
            .unwrap()
            - 0.02)
            .abs()
            < 1e-9
    );

    // Export congela resolved_crop_plan para gameplay_webcam.
    let out_gw = root.path().join("frozen-gw.mp4");
    let job_gw = call(
        "export.start",
        json!({"source_id":source,"start_id":2,"end_id":6,"candidate_id":cand,"clip_id":cand_clip,"output":out_gw}),
    )["job"]
        .as_i64()
        .unwrap();
    let frozen_gw: Value = serde_json::from_str(
        &clipes_core::projects::with_reader(|c| {
            c.query_row(
                "SELECT request FROM exports WHERE job_id=?1",
                [job_gw],
                |r| r.get::<_, String>(0),
            )
        })
        .unwrap(),
    )
    .unwrap();
    assert_eq!(frozen_gw["resolved_crop_plan"]["layout"], "gameplay_webcam");
    assert_eq!(
        frozen_gw["resolved_crop_plan"]["panels"]
            .as_array()
            .unwrap()
            .len(),
        2
    );

    call("projects.close", json!({}));
}
