//! Autosave, falha de escrita, troca de Projeto e restauração sem rede.
use clipes_core::{
    dispatch,
    projects::{with_reader, with_writer},
};
use serde_json::{json, Value};
fn call(name: &str, args: Value) -> Value {
    dispatch(name, args, &mut |_| {}).unwrap()
}

#[test]
fn pending_edits_flush_on_switch_backup_close_and_restore_without_crossing_projects() {
    let root = tempfile::tempdir().unwrap();
    std::env::set_var("CLIPES_DATA_DIR", root.path().join("data"));
    let project = call(
        "projects.create",
        json!({"parent":root.path(),"name":"Primeiro"}),
    );
    let source=with_writer(|c| {
        c.execute("INSERT INTO sources(path,size,duration_us,partial_hash,metadata,permission,audio_track) VALUES ('offline.mp4',1,100000000,'h','{}','{}',0)",[])?;
        let source=c.last_insert_rowid();
        c.execute("INSERT INTO transcripts(source_id,audio_track,engine,model,revision,compute_type,state,duration_us) VALUES (?1,0,'local','m','r','c','complete',100000000)",[source])?;
        let t=c.last_insert_rowid();
        for (id,start,end) in [(1,0,10_000_000),(2,12_000_000,20_000_000),(3,22_000_000,30_000_000),(4,30_000_000,40_000_000),(5,40_000_000,50_000_000),(6,50_000_000,60_000_000),(7,60_000_000,70_000_000),(8,70_000_000,80_000_000)] {
            c.execute("INSERT INTO sentences(transcript_id,id,first_position,last_position,start_us,end_us,text) VALUES (?1,?2,?2,?2,?3,?4,'fala')",(t,id,start,end))?;
        }
        Ok(source)
    }).unwrap();
    let request = json!({"source_id":source,"start_id":3,"end_id":7});
    let clip = call("editor.open", request.clone())["clipId"].clone();
    // Encaixa também no fim de Frase e desempata pelo tempo anterior (20 vs 22).
    for time in [19_000_000, 21_000_000] {
        let v = call(
            "editor.adjust",
            json!({"clip_id":clip,"edge":"start","time_us":time,"preview":true}),
        );
        assert_eq!(v["startUs"], 20_000_000);
    }
    call(
        "editor.adjust",
        json!({"clip_id":clip,"edge":"end","sentence_delta":1}),
    );
    call("backups.create", json!({}));
    let backup = call("backups.list", json!({}))[0]["id"].clone();
    call(
        "editor.adjust",
        json!({"clip_id":clip,"edge":"end","sentence_delta":-1}),
    );
    call("backups.restore", json!({"id":backup}));
    assert_eq!(call("editor.open", request.clone())["endUs"], 80_000_000);
    // Uma falha de autosave/flush não perde memória nem fecha o Projeto.
    with_writer(|c|c.execute_batch("CREATE TRIGGER fail_clip_save BEFORE UPDATE ON clip_edits BEGIN SELECT RAISE(ABORT,'private-path'); END;")).unwrap();
    call(
        "editor.adjust",
        json!({"clip_id":clip,"edge":"end","time_us":90_000_000,"free":true}),
    );
    let error = dispatch("projects.close", json!({}), &mut |_| {}).unwrap_err();
    assert_eq!(error.code, "project_write");
    assert!(!error.message.contains("private-path"));
    assert_eq!(call("editor.open", request.clone())["endUs"], 90_000_000);
    with_writer(|c| c.execute_batch("DROP TRIGGER fail_clip_save;")).unwrap();
    let other = call(
        "projects.create",
        json!({"parent":root.path(),"name":"Segundo"}),
    );
    assert_eq!(
        with_reader(|c| c.query_row("SELECT count(*) FROM clip_edits", [], |r| r
            .get::<_, i64>(0)))
        .unwrap(),
        0
    );
    assert_eq!(
        dispatch("editor.undo", json!({"clip_id":clip}), &mut |_| {})
            .unwrap_err()
            .code,
        "invalid_clip"
    );
    call("projects.open", json!({"path":project["path"]}));
    assert_eq!(call("editor.open", request.clone())["endUs"], 90_000_000);
    // Debounce é contado de novo a partir da última edição.
    call(
        "editor.adjust",
        json!({"clip_id":clip,"edge":"end","time_us":91_000_000,"free":true}),
    );
    std::thread::sleep(std::time::Duration::from_millis(650));
    call(
        "editor.adjust",
        json!({"clip_id":clip,"edge":"end","time_us":92_000_000,"free":true}),
    );
    std::thread::sleep(std::time::Duration::from_millis(500));
    assert_eq!(
        with_reader(|c| c.query_row(
            "SELECT json_extract(document,'$.range.endUs') FROM clip_edits",
            [],
            |r| r.get::<_, i64>(0)
        ))
        .unwrap(),
        90_000_000
    );
    call("projects.close", json!({}));
    call("projects.open", json!({"path":other["path"]}));
    std::thread::sleep(std::time::Duration::from_millis(600));
    assert_eq!(
        with_reader(|c| c.query_row("SELECT count(*) FROM clip_edits", [], |r| r
            .get::<_, i64>(0)))
        .unwrap(),
        0
    );
    call("projects.open", json!({"path":project["path"]}));
    assert_eq!(call("editor.open", request)["endUs"], 92_000_000);
    call("projects.close", json!({}));
}
