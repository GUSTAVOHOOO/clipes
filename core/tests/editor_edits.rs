//! Bordas e histórico pelo mesmo dispatch do app, sem rede.
use clipes_core::{dispatch, projects::{with_reader, with_writer}};
use serde_json::{json, Value};

fn call(name: &str, args: Value) -> Value { dispatch(name, args, &mut |_| {}).unwrap() }

#[test]
fn edits_snap_group_persist_and_respect_source_and_history_limits() {
    let root = tempfile::tempdir().unwrap();
    std::env::set_var("CLIPES_DATA_DIR", root.path().join("data"));
    let project = call("projects.create", json!({"parent":root.path(),"name":"Bordas"}));
    let source = with_writer(|c| {
        c.execute("INSERT INTO sources(path,size,duration_us,partial_hash,metadata,permission,audio_track) VALUES ('offline.mp4',1,2000000000,'h',?1,'{}',0)", [r#"{"streams":[{"codec_type":"video","avg_frame_rate":"25/1"}]}"#])?;
        let source = c.last_insert_rowid();
        c.execute("INSERT INTO transcripts(source_id,audio_track,engine,model,revision,compute_type,state,resume_us,duration_us) VALUES (?1,0,'local','m','r','c','complete',2000000000,2000000000)", [source])?;
        let transcript = c.last_insert_rowid();
        for id in 1..=200 {
            c.execute("INSERT INTO sentences(transcript_id,id,first_position,last_position,start_us,end_us,text) VALUES (?1,?2,?2,?2,?3,?4,'Frase')", (transcript,id,(id-1)*10_000_000i64,id*10_000_000i64))?;
        }
        Ok(source)
    }).unwrap();
    let request = json!({"source_id":source,"start_id":5,"end_id":10});
    let opened = call("editor.open", request.clone());
    let clip = opened["clipId"].as_i64().expect("Corte persistente");
    // Várias prévias do mesmo arrasto não entram na pilha.
    for time in [31_000_000, 34_900_000, 35_100_000] {
        let preview = call("editor.adjust", json!({"clip_id":clip,"edge":"start","time_us":time,"preview":true}));
        assert_eq!(preview["undoCount"], 0);
    }
    let adjusted = call("editor.adjust", json!({"clip_id":clip,"edge":"start","time_us":34_900_000}));
    assert_eq!(adjusted["startUs"], 30_000_000);
    assert_eq!(adjusted["undoCount"], 1);
    assert_eq!(call("editor.undo", json!({"clip_id":clip}))["startUs"],40_000_000);
    assert_eq!(call("editor.redo", json!({"clip_id":clip}))["startUs"],30_000_000);
    let fine = call("editor.adjust", json!({"clip_id":clip,"edge":"start","time_us":31_234_567,"free":true}));
    assert_eq!(fine["startUs"], 31_240_000);
    assert_eq!(fine["request"]["start_id"], 4);
    // Primeira/última Frase: o passo fora da Fonte não altera nada.
    let first = call("editor.open", json!({"source_id":source,"start_id":1,"end_id":6}));
    let last = call("editor.open", json!({"source_id":source,"start_id":195,"end_id":200}));
    for (id, edge, delta, expected) in [(&first["clipId"],"start",-1,0),(&last["clipId"],"end",1,2_000_000_000)] {
        let v = call("editor.adjust", json!({"clip_id":id,"edge":edge,"sentence_delta":delta}));
        assert_eq!(v[if edge == "start" {"startUs"} else {"endUs"}],expected);
        assert_eq!(v["undoCount"],0);
    }
    let clamp = call("editor.adjust", json!({"clip_id":first["clipId"],"edge":"start","time_us":-5_000_000,"free":true}));
    assert_eq!(clamp["startUs"],0);
    let clamp = call("editor.adjust", json!({"clip_id":last["clipId"],"edge":"end","time_us":3_000_000_000i64,"free":true}));
    assert_eq!(clamp["endUs"],2_000_000_000);
    for (edge, delta, expected) in [("start",-1,20_000_000),("start",1,30_000_000),("end",1,110_000_000),("end",-1,100_000_000)] {
        let v = call("editor.adjust",json!({"clip_id":clip,"edge":edge,"sentence_delta":delta}));
        assert_eq!(v[if edge == "start" {"startUs"} else {"endUs"}],expected);
    }
    for (time, code) in [(99_000_000,"adjust_too_short"),(110_000_000,"adjust_empty")] {
        assert_eq!(dispatch("editor.adjust",json!({"clip_id":clip,"edge":"start","time_us":time,"free":true}),&mut |_|{}).unwrap_err().code,code);
    }
    // Debounce: documento ainda anterior no SQLite; flush de fechamento salva o atual.
    assert_eq!(with_reader(|c|c.query_row("SELECT json_extract(document,'$.revision') FROM clip_edits WHERE id=?1",[clip],|r|r.get::<_,i64>(0))).unwrap(),0);
    call("projects.close",json!({}));
    call("projects.open",json!({"path":project["path"]}));
    let restored = call("editor.open",request.clone());
    assert_eq!(restored["startUs"],30_000_000);
    assert!(restored["undoCount"].as_u64().unwrap()>1);
    // Uma edição nova limpa refazer; histórico e snapshots têm teto independente.
    call("editor.undo",json!({"clip_id":clip}));
    for n in 0..105 {
        let v = call("editor.adjust",json!({"clip_id":clip,"edge":"end","time_us":if n%2==0 {110_000_000} else {100_000_000}}));
        assert_eq!(v["redoCount"],0);
        call("editor.flush",json!({}));
    }
    let capped = call("editor.open",request.clone());
    assert_eq!(capped["undoCount"],100);
    assert_eq!(call("editor.snapshots",json!({"clip_id":clip})).as_array().unwrap().len(),20);
    for _ in 0..100 { call("editor.undo",json!({"clip_id":clip})); }
    assert_eq!(call("editor.undo",json!({"clip_id":clip}))["undoCount"],0);
    // Autosave real após 1 s, sem precisar manter o editor montado.
    call("editor.adjust",json!({"clip_id":clip,"edge":"end","time_us":120_000_000}));
    std::thread::sleep(std::time::Duration::from_millis(1250));
    assert_eq!(with_reader(|c|c.query_row("SELECT json_extract(document,'$.range.endUs') FROM clip_edits WHERE id=?1",[clip],|r|r.get::<_,i64>(0))).unwrap(),120_000_000);
    call("projects.close",json!({}));
}
