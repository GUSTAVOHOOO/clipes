//! Projeto anterior ao #153: migração real, backup e aprovação legada preservada.
use clipes_core::{
    dispatch,
    projects::{self, Migration},
};
use rusqlite::Connection;
use serde_json::{json, Value};

fn call(name: &str, args: Value) -> Value {
    dispatch(name, args, &mut |_| {}).unwrap()
}

#[test]
fn legacy_script_migration_preserves_approval_until_the_first_angle() {
    let root = tempfile::tempdir().unwrap();
    std::env::set_var("CLIPES_DATA_DIR", root.path().join("data"));
    let path = root.path().join("legado.clipes");
    std::fs::create_dir(&path).unwrap();
    // Fixture fora de uma sessão: aplica o registro antigo, sem a migração do ticket.
    let conn = Connection::open(path.join("project.sqlite")).unwrap();
    conn.execute_batch("CREATE TABLE schema_migrations(id TEXT PRIMARY KEY NOT NULL)")
        .unwrap();
    let mut migrations: Vec<_> = inventory::iter::<Migration>
        .into_iter()
        .filter(|m| m.id != "0153_001_angles")
        .collect();
    migrations.sort_by_key(|m| m.id);
    for migration in migrations {
        conn.execute_batch(migration.sql).unwrap();
        conn.execute("INSERT INTO schema_migrations VALUES (?1)", [migration.id])
            .unwrap();
    }
    conn.execute_batch(r#"
INSERT INTO project(name) VALUES ('Legado');
INSERT INTO sources(id,path,size,duration_us,partial_hash,metadata,permission,audio_track)
 VALUES (1,'fixture.mp4',1,30000000,'h','{}','{}',0);
INSERT INTO transcripts(id,source_id,audio_track,engine,model,revision,compute_type,state,resume_us,duration_us)
 VALUES (1,1,0,'local','m','r','c','complete',30000000,30000000);
INSERT INTO sentences(transcript_id,id,first_position,last_position,start_us,end_us,language,text)
 VALUES (1,1,0,0,0,30000000,'pt','Uma fala do Corte.');
INSERT INTO selection_runs(id,transcript_id,task_version,prompt_sha256,state,min_us,max_us,weights,plan_state,windows_total,video_kind)
 VALUES (1,1,1,'','completed',15000000,60000000,'{}','{}',1,'transformed');
INSERT INTO selection_candidates(id,run_id,rank,start_id,end_id,start_us,end_us,axes,total_centi,windows)
 VALUES (1,1,1,1,1,0,30000000,'{}',900,'[]');
INSERT INTO selection_decisions(run_id,cand_start_id,cand_end_id,decision,before_start_id,before_end_id,after_start_id,after_end_id)
 VALUES (1,1,1,'approved',1,1,1,1);
INSERT INTO script_generations(id,job_id,run_id,cand_start_id,cand_end_id,language,task_version,prompt_sha256,safety,outline)
 VALUES (1,999,1,1,1,'pt-BR',1,'','local','{"blocks":[]}');
"#).unwrap();
    for position in 1..=3 {
        conn.execute("INSERT INTO script_blocks(id,generation_id,position,title,intent,refs) VALUES (?1,1,?1,'Bloco','Comenta o trecho','[1]')",[position]).unwrap();
        conn.execute("INSERT INTO script_block_versions(id,block_id,kind,narration) VALUES (?1,?1,'edit','Texto já revisado.')",[position]).unwrap();
        conn.execute(
            "INSERT INTO script_approvals(block_id,version_id) VALUES (?1,?1)",
            [position],
        )
        .unwrap();
    }
    drop(conn);

    call("projects.open", json!({"path":path}));
    let backup = Connection::open(path.join("project.pre-migration.sqlite")).unwrap();
    assert_eq!(
        backup
            .query_row("PRAGMA integrity_check", [], |r| r.get::<_, String>(0))
            .unwrap(),
        "ok"
    );
    assert_eq!(
        backup
            .query_row(
                "SELECT COUNT(*) FROM schema_migrations WHERE id='0153_001_angles'",
                [],
                |r| r.get::<_, i64>(0)
            )
            .unwrap(),
        0
    );
    drop(backup);
    assert_eq!(
        projects::with_reader(|c| c.query_row(
            "SELECT COUNT(*) FROM schema_migrations WHERE id='0153_001_angles'",
            [],
            |r| r.get::<_, i64>(0)
        ))
        .unwrap(),
        1
    );

    let old = call("script.get", json!({"candidate":1}));
    assert!(old["angle"].is_null());
    assert_eq!(old["narrationAllowed"], true);
    assert_eq!(
        call("script.narration_allowed", json!({"candidate":1}))["allowed"],
        true
    );
    for command in ["script.generate", "script.regenerate"] {
        assert_eq!(
            dispatch(command, json!({"candidate":1,"block":1}), &mut |_| {})
                .unwrap_err()
                .code,
            "angle_required"
        );
    }
    let choice = json!({"candidate":1,"angle":{"name":"Minha análise","promise":"Entenda o contexto deste trecho."}});
    assert_eq!(
        dispatch("angles.choose", choice.clone(), &mut |_| {})
            .unwrap_err()
            .code,
        "angle_change_confirmation"
    );
    let mut confirmed = choice;
    confirmed["confirmed"] = json!(true);
    call("angles.choose", confirmed);
    let changed = call("script.get", json!({"candidate":1}));
    assert_eq!(changed["narrationAllowed"], false);
    for block in changed["current"]["blocks"].as_array().unwrap() {
        assert_eq!(block["narration"], "Texto já revisado.");
        assert_eq!(block["stale"], true);
        call("script.approve", json!({"candidate":1,"block":block["id"]}));
    }
    assert_eq!(
        call("script.narration_allowed", json!({"candidate":1}))["allowed"],
        true
    );
    // Simula queda depois do esboço, antes de criar os jobs de todos os blocos.
    projects::with_writer(|c| {
        c.execute("INSERT INTO script_blocks(id,generation_id,position,title,intent,refs) VALUES (4,1,4,'Interrompido','Comentar','[1]')",[])?;
        Ok(())
    }).unwrap();
    let before = projects::with_reader(|c| {
        c.query_row("SELECT COUNT(*) FROM jobs", [], |r| r.get::<_, i64>(0))
    })
    .unwrap();
    call(
        "angles.choose",
        json!({"candidate":1,"angle":{"name":"Outro ponto de vista","promise":"Conheça outra leitura do trecho."},"confirmed":true}),
    );
    assert_eq!(
        projects::with_reader(
            |c| c.query_row("SELECT COUNT(*) FROM jobs", [], |r| r.get::<_, i64>(0))
        )
        .unwrap(),
        before,
        "escrita manual não continua a cadeia nem chama o Provedor"
    );
    call("projects.close", json!({}));
    std::env::remove_var("CLIPES_DATA_DIR");
}
