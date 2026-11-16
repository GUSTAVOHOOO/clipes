//! Mesma fronteira de dispatch da UI, sem rede e com Projeto isolado.
use clipes_core::{dispatch, projects::with_writer};
use serde_json::{json, Value};
static LOCK: std::sync::Mutex<()> = std::sync::Mutex::new(());
fn call(name: &str, args: Value) -> Value {
    dispatch(name, args, &mut |_| {}).unwrap()
}

#[test]
fn overrides_are_persistent_independent_of_presets_and_remap_only_unique_near_words() {
    let _guard = LOCK.lock().unwrap_or_else(|e| e.into_inner());
    let root = tempfile::tempdir().unwrap();
    std::env::set_var("CLIPES_DATA_DIR", root.path().join("data"));
    let project = call(
        "projects.create",
        json!({"parent":root.path(),"name":"Legendas"}),
    );
    let transcript=with_writer(|c| {
        c.execute("INSERT INTO sources(path,size,duration_us,partial_hash,metadata,permission,audio_track) VALUES ('missing',1,9000000,'h','{}','{}',0)",[])?;
        c.execute("INSERT INTO transcripts(source_id,audio_track,engine,model,revision,compute_type,state,duration_us) VALUES (1,0,'local','m','r','c','complete',9000000)",[])?;
        let t=c.last_insert_rowid();
        for (p,text,start) in [(0," Olá",0),(1," mundo",1_000_000),(2," ambígua",2_000_000),(3," distante",4_000_000)] {
            c.execute("INSERT INTO transcript_words(transcript_id,position,kind,text,start_us,end_us) VALUES (?1,?2,'word',?3,?4,?4+200000)",(t,p,text,start))?;
        }
        Ok(t)
    }).unwrap();
    for position in 0..4 {
        call(
            "captions.override",
            json!({"transcript_id":transcript,"position":position,"overrides":{"color":"#FF0000","highlight":false}}),
        );
    }
    call("projects.close", json!({}));
    call("projects.open", json!({"path":project["path"]}));
    let overrides = call("captions.overrides", json!({"transcript_id":transcript}));
    assert_eq!(overrides.as_array().unwrap().len(), 4);
    let err = dispatch(
        "captions.override",
        json!({"transcript_id":transcript,"position":99,"overrides":{"color":"#FF0000"}}),
        &mut |_| {},
    )
    .unwrap_err();
    assert_eq!(err.code, "word_missing");
    with_writer(|c| {
        let tx=c.transaction()?;
        clipes_core::caption_style::store::stage_remap(&tx,transcript)?;
        tx.execute("DELETE FROM transcripts WHERE id=?1",[transcript])?;
        tx.execute("INSERT INTO transcripts(source_id,audio_track,engine,model,revision,compute_type,state,duration_us) VALUES (1,0,'local','m','r','c','complete',9000000)",[])?;
        let t=tx.last_insert_rowid();
        for (p,text,start) in [(0," OLÁ ",300_000),(1,"mundo",900_000),(2,"ambígua",1_900_000),(3,"ambígua",2_100_000),(4,"distante",4_310_000)] {
            tx.execute("INSERT INTO transcript_words(transcript_id,position,kind,text,start_us,end_us) VALUES (?1,?2,'word',?3,?4,?4+100000)",(t,p,text,start))?;
        }
        assert_eq!(clipes_core::caption_style::store::finish_remap(&tx,t)?,2);
        tx.commit()
    }).unwrap();
    let overrides = call("captions.overrides", json!({"transcript_id":transcript}));
    assert_eq!(overrides.as_array().unwrap().len(), 2);
    assert_eq!(overrides[0]["overrides"]["color"], "#FF0000");
    assert_eq!(
        call("captions.remap_status", json!({"source_id":1}))["discarded"],
        2
    );
    call("projects.close", json!({}));
}

#[test]
fn style_is_per_clip_new_clips_copy_the_project_default_and_stale_revisions_conflict() {
    let _guard = LOCK.lock().unwrap_or_else(|e| e.into_inner());
    let root = tempfile::tempdir().unwrap();
    std::env::set_var("CLIPES_DATA_DIR", root.path().join("data"));
    call(
        "projects.create",
        json!({"parent":root.path(),"name":"Estilos"}),
    );
    with_writer(|c| {
        for i in 1..=3 {
            c.execute(
                "INSERT INTO clip_edits(identity,document) VALUES (?1,'{}')",
                [format!("candidate:{i}")],
            )?;
        }
        Ok(())
    })
    .unwrap();
    assert!(dispatch("captions.style.get", json!({"clip_id":99}), &mut |_| {}).is_err());
    let first = call("captions.style.get", json!({"clip_id":1}));
    assert_eq!(first["preset"], "vertical");
    let cinema = call(
        "captions.style.preset",
        json!({"clip_id":1,"preset":"cinema","revision":first["revision"]}),
    );
    assert_eq!(cinema["revision"], 1);
    let stale = dispatch(
        "captions.style.preset",
        json!({"clip_id":1,"preset":"simple","revision":0}),
        &mut |_| {},
    )
    .unwrap_err();
    assert_eq!(stale.code, "caption_style_conflict");
    // O padrão ainda é o inicial: o Corte 2 não herda o estilo do Corte 1.
    assert_eq!(
        call("captions.style.get", json!({"clip_id":2}))["preset"],
        "vertical"
    );
    call("captions.style.default", json!({"clip_id":1}));
    let third = call("captions.style.get", json!({"clip_id":3}));
    assert_eq!(third["preset"], "cinema");
    assert_eq!(third["revision"], 0);
    assert_eq!(
        call("captions.style.get", json!({"clip_id":2}))["preset"],
        "vertical"
    );
    assert!(dispatch("captions.style.get", json!({"clip_id":0}), &mut |_| {}).is_err());
    with_writer(|c| c.execute("DELETE FROM clip_edits WHERE id=1", [])).unwrap();
    let left: i64 = with_writer(|c| {
        c.query_row(
            "SELECT COUNT(*) FROM caption_styles WHERE clip_id=1",
            [],
            |r| r.get(0),
        )
    })
    .unwrap();
    assert_eq!(left, 0, "estilo some com o Corte (ON DELETE CASCADE)");
    call("projects.close", json!({}));
}
