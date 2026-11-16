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
    let opened = call("editor.open", json!({"source_id":source,"start_id":2,"end_id":6}));
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
    let seg2_x = suggested_before["segments"][1]["keyframes"][0]["x"].as_f64().unwrap();

    let edited = call(
        "editor.crop.set_edits",
        json!({"clip_id":1,"edits":[{"timeUs":15_000_000,"x":0.4,"y":0.0,"width":0.3,"height":1.0}]}),
    );
    assert_eq!(edited["suggested"], suggested_before, "suggested é imutável");
    let at_seg1 = call("editor.crop.evaluate", json!({"clip_id":1,"time_us":20_000_000}));
    assert!((at_seg1["rect"]["x"].as_f64().unwrap() - 0.4).abs() < 1e-9);
    let at_seg2 = call("editor.crop.evaluate", json!({"clip_id":1,"time_us":seg2_start}));
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
    call("projects.close", json!({}));
}
