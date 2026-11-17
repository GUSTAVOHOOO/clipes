//! Reparo idempotente de Transcrições salvas com tempos sobrepostos e erro tipado para
//! entradas realmente inválidas (#233). Um corpo de teste isolado porque a sessão de Projeto e
//! `CLIPES_DATA_DIR` pertencem ao processo.
use clipes_core::{dispatch, projects::with_writer, CoreError};
use serde_json::{json, Value};

fn call(name: &str, args: Value) -> Value {
    dispatch(name, args, &mut |_| {}).unwrap()
}

fn fail(name: &str, args: Value) -> CoreError {
    dispatch(name, args, &mut |_| {}).unwrap_err()
}

#[test]
fn repairs_saved_overlapping_transcript_and_keeps_negative_timestamps_invalid() {
    let root = tempfile::tempdir().unwrap();
    std::env::set_var("CLIPES_DATA_DIR", root.path().join("data"));
    let created = call(
        "projects.create",
        json!({"parent": root.path(), "name": "Antigo"}),
    );
    let project_dir = created["path"].as_str().unwrap().to_owned();
    call(
        "provider.configure",
        json!({"endpoint": "http://127.0.0.1:9/v1", "kind": "openai", "model": "fake-model", "context": 32768}),
    );

    // Simula um Projeto salvo antes do #233: palavras com sobreposição de 196 ms, duração zero
    // e Frases adjacentes sobrepostas gravadas no banco antes da migração 0233_001.
    let source = with_writer(|c| {
        c.execute(
            "DELETE FROM schema_migrations WHERE id='0233_001_normalize_transcript_timestamps'",
            [],
        )?;
        c.execute("INSERT INTO sources(path,size,duration_us,partial_hash,metadata,permission,audio_track) VALUES ('C:/videos/antigo.mp4',1,500000000,'h','{}','{}',0)", [])?;
        let source = c.last_insert_rowid();
        c.execute("INSERT INTO transcripts(source_id,audio_track,engine,model,revision,compute_type,state,resume_us,duration_us) VALUES (?1,0,'local','m','r','c','complete',500000000,500000000)", [source])?;
        let t = c.last_insert_rowid();
        let words = [
            (0_i64, "um", 390_864_000_i64, 391_504_000_i64),
            (1, "dois.", 391_504_000, 391_844_000),
            (2, "tres", 391_648_000, 391_648_000),
            (3, "quatro.", 391_900_000, 392_268_000),
            (4, "cinco.", 400_000_000, 400_000_000),
        ];
        for (pos, text, s, e) in words {
            c.execute(
                "INSERT INTO transcript_words(transcript_id,position,kind,text,start_us,end_us,language) VALUES (?1,?2,'word',?3,?4,?5,'pt')",
                (t, pos, text, s, e),
            )?;
        }
        c.execute(
            "INSERT INTO sentences(transcript_id,id,first_position,last_position,start_us,end_us,language,text) VALUES (?1,1,0,1,390864000,391844000,'pt','um dois.')",
            [t],
        )?;
        c.execute(
            "INSERT INTO sentences(transcript_id,id,first_position,last_position,start_us,end_us,language,text) VALUES (?1,2,2,3,391648000,392268000,'pt','tres quatro.')",
            [t],
        )?;
        c.execute(
            "INSERT INTO sentences(transcript_id,id,first_position,last_position,start_us,end_us,language,text) VALUES (?1,3,4,4,400000000,400000000,'pt','cinco.')",
            [t],
        )?;
        Ok(source)
    })
    .unwrap();

    // Reabre o Projeto: a migração 0233_001 roda com backup pré-migração e repara as tabelas.
    call("projects.close", json!({}));
    call("projects.open", json!({"path": project_dir}));
    assert!(std::path::Path::new(&project_dir)
        .join("project.pre-migration.sqlite")
        .is_file());

    let sentences = call("transcription.sentences", json!({"source_id": source}))
        .as_array()
        .unwrap()
        .clone();
    assert_eq!(sentences.len(), 3);
    assert_eq!(sentences[0]["end_us"], 391_844_000);
    assert_eq!(sentences[1]["start_us"], 391_844_000);
    assert_eq!(sentences[2]["start_us"], 400_000_000);
    assert_eq!(sentences[2]["end_us"], 400_000_001);

    // Idempotente: segmentar de novo não altera nada.
    let seg = call("transcription.segment", json!({"source_id": source}));
    assert_eq!(seg["changed"], false);

    // A seleção passa a planejar sem erro.
    let est = call("selection.estimate", json!({"source_id": source}));
    assert!(!est["plan"]["windows"].as_array().unwrap().is_empty());

    // Entrada realmente inválida (tempo negativo) continua recusada com erro tipado e explicativo.
    let bad_source = with_writer(|c| {
        c.execute("INSERT INTO sources(path,size,duration_us,partial_hash,metadata,permission,audio_track) VALUES ('C:/videos/invalido.mp4',1,500000000,'h2','{}','{}',0)", [])?;
        let s = c.last_insert_rowid();
        c.execute("INSERT INTO transcripts(source_id,audio_track,engine,model,revision,compute_type,state,resume_us,duration_us) VALUES (?1,0,'local','m','r','c','complete',500000000,500000000)", [s])?;
        let t = c.last_insert_rowid();
        c.execute("INSERT INTO transcript_words(transcript_id,position,kind,text,start_us,end_us,language) VALUES (?1,0,'word','invalido.',-100,100,'pt')", [t])?;
        Ok(s)
    })
    .unwrap();
    let err = fail("selection.estimate", json!({"source_id": bad_source}));
    assert_eq!(err.code, "invalid_selection_plan");
    assert!(err.message.contains("tempos negativos"));
}
