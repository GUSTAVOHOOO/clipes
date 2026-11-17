//! Testes headless da montagem da Narração (#204) pelo mesmo dispatch do app.
use clipes_core::{
    dispatch,
    montage::{self, BLOCK_GAP_US},
    projects::{with_reader, with_writer},
    script,
};
use serde_json::{json, Value};
use std::collections::BTreeMap;

fn call(name: &str, args: Value) -> Value {
    dispatch(name, args, &mut |_| {}).unwrap()
}

fn seed_transformed_script(
    blocks: &[(Vec<i64>, &str)],
) -> (Value, i64, i64, Vec<i64>, tempfile::TempDir) {
    let root = tempfile::tempdir().unwrap();
    std::env::set_var("CLIPES_DATA_DIR", root.path().join("data"));
    let project = call(
        "projects.create",
        json!({"parent": root.path(), "name": "Montagem"}),
    );

    let (source, candidate, block_ids) = with_writer(|c| {
        c.execute(
            "INSERT INTO sources(path,size,duration_us,partial_hash,metadata,permission,audio_track) VALUES ('offline.mp4',1,600000000,'h',?1,'{}',0)",
            [r#"{"streams":[{"codec_type":"video","avg_frame_rate":"25/1"}]}"#],
        )?;
        let source = c.last_insert_rowid();
        c.execute(
            "INSERT INTO transcripts(source_id,audio_track,engine,model,revision,compute_type,state,resume_us,duration_us) VALUES (?1,0,'local','m','r','c','complete',600000000,600000000)",
            [source],
        )?;
        let transcript = c.last_insert_rowid();
        // 20 Frases de 10 s cada (1..=20); cada Frase tem 2 palavras deixando gap de 2 s para teste de silêncio.
        for id in 1..=20_i64 {
            let s_start = (id - 1) * 10_000_000;
            let s_end = id * 10_000_000;
            c.execute(
                "INSERT INTO sentences(transcript_id,id,first_position,last_position,start_us,end_us,text) VALUES (?1,?2,?3,?4,?5,?6,'Frase de teste.')",
                (transcript, id, id * 2 - 1, id * 2, s_start, s_end),
            )?;
            c.execute(
                "INSERT INTO transcript_words(transcript_id,position,kind,text,start_us,end_us,language) VALUES (?1,?2,'word','Frase',?3,?4,'pt')",
                (transcript, id * 2 - 1, s_start, s_start + 3_000_000),
            )?;
            c.execute(
                "INSERT INTO transcript_words(transcript_id,position,kind,text,start_us,end_us,language) VALUES (?1,?2,'word','teste',?3,?4,'pt')",
                (transcript, id * 2, s_start + 5_000_000, s_end),
            )?;
        }

        c.execute(
            "INSERT INTO selection_runs(transcript_id,task_version,prompt_sha256,profile,state,min_us,max_us,weights,plan_state,windows_total,video_kind) VALUES (?1,1,'h','legacy','completed',20000000,180000000,'{}','[]',1,'transformed')",
            [transcript],
        )?;
        let run = c.last_insert_rowid();
        // Candidato cobre Frases 2..=6 (10s..60s -> 50s de Corte).
        c.execute(
            "INSERT INTO selection_candidates(run_id,rank,start_id,end_id,start_us,end_us,axes,total_centi,title,windows) VALUES (?1,1,2,6,10000000,60000000,'{}',900,'Corte','[0]')",
            [run],
        )?;
        let candidate = c.last_insert_rowid();
        c.execute(
            "INSERT INTO selection_decisions(run_id,cand_start_id,cand_end_id,decision,before_start_id,before_end_id,after_start_id,after_end_id) VALUES (?1,2,6,'approved',2,6,2,6)",
            [run],
        )?;
        c.execute(
            "INSERT INTO jobs(kind,safety,state,progress) VALUES ('ai:script','local','completed',100)",
            [],
        )?;
        let gen_job = c.last_insert_rowid();
        c.execute(
            "INSERT INTO script_generations(job_id,run_id,cand_start_id,cand_end_id,language,task_version,prompt_sha256,profile,safety,outline,angle) VALUES (?1,?2,2,6,'pt-BR',2,'h','legacy','local','[]','{\"name\":\"Angulo\",\"promise\":\"Promessa\"}')",
            (gen_job, run),
        )?;
        let gen_id = c.last_insert_rowid();

        let mut ids = Vec::new();
        for (i, (refs, text)) in blocks.iter().enumerate() {
            let pos = i as i64 + 1;
            let refs_json = serde_json::to_string(refs).unwrap();
            c.execute(
                "INSERT INTO script_blocks(generation_id,position,title,intent,refs) VALUES (?1,?2,?3,'Intenção',?4)",
                (gen_id, pos, format!("Bloco {pos}"), &refs_json),
            )?;
            let block_id = c.last_insert_rowid();
            c.execute(
                "INSERT INTO script_block_versions(block_id,kind,title,narration,refs,angle_revision) VALUES (?1,'generated',?2,?3,?4,0)",
                (block_id, format!("Bloco {pos}"), *text, &refs_json),
            )?;
            let ver_id = c.last_insert_rowid();
            c.execute(
                "INSERT INTO script_approvals(block_id,version_id,angle_revision) VALUES (?1,?2,0)",
                (block_id, ver_id),
            )?;
            ids.push(block_id);
        }
        Ok((source, candidate, ids))
    })
    .unwrap();

    (project, source, candidate, block_ids, root)
}

#[test]
fn headless_montage_resolves_anchors_pushes_tail_drag_undo_and_persists() {
    // 4 blocos:
    // B1 (refs: [2], 180 chars -> 12s): ancora em Frase 2 (output 0s..12s)
    // B2 (refs: [3], 150 chars -> 10s): ancora em Frase 3 (10s), colide com B1 -> empurrado para 12.3s..22.3s
    // B3 (refs: [], 90 chars -> 6s): sem refs -> entra após B2 em 22.6s..28.6s
    // B4 (refs: [6], 180 chars -> 12s): ancora em Frase 6 (40s..52s) -> sobra final de 2s (tpad)
    let text_12s = "a".repeat(180);
    let text_10s = "b".repeat(150);
    let text_6s = "c".repeat(90);
    let (project, source, candidate, block_ids, _root) = seed_transformed_script(&[
        (vec![2], &text_12s),
        (vec![3], &text_10s),
        (vec![], &text_6s),
        (vec![6], &text_12s),
    ]);

    let opened = call(
        "editor.open",
        json!({"source_id": source, "start_id": 2, "end_id": 6, "candidate_id": candidate}),
    );
    let clip_id = opened["clipId"].as_i64().unwrap();
    assert_eq!(opened["schemaVersion"], 2);
    let m = &opened["montage"];
    assert_eq!(m["scriptApproved"], true);
    assert_eq!(m["usesEstimatedDurations"], true);
    assert_eq!(m["clipDurationUs"], 50_000_000);
    assert_eq!(m["freezeTailUs"], 2_000_000);
    assert_eq!(m["totalDurationUs"], 52_000_000);

    let b = m["blocks"].as_array().unwrap();
    assert_eq!(b[0]["startUs"], 0);
    assert_eq!(b[1]["startUs"], 12_000_000 + BLOCK_GAP_US);
    assert_eq!(b[1]["pushedUs"], 2_000_000 + BLOCK_GAP_US);
    assert_eq!(b[2]["startUs"], 22_300_000 + BLOCK_GAP_US);
    assert_eq!(b[3]["startUs"], 40_000_000);
    assert_eq!(b[3]["overflowUs"], 2_000_000);

    // Preview de arrasto não cria passo no undo.
    let preview = call(
        "editor.montage.set_start",
        json!({"clip_id": clip_id, "block_id": block_ids[2], "time_us": 41_000_000, "preview": true}),
    );
    assert_eq!(preview["undoCount"], 0);
    assert_eq!(preview["montage"]["blocks"][2]["mode"], "manual");
    assert_eq!(preview["montage"]["blocks"][2]["startUs"], 30_000_000); // Frase 5 em 40s da Fonte -> 30s do Corte

    // Arrasto real do B3 para Frase 5 (40s da Fonte -> 30s no Corte) sem invalidar aprovação.
    let moved = call(
        "editor.montage.set_start",
        json!({"clip_id": clip_id, "block_id": block_ids[2], "time_us": 39_000_000}),
    );
    assert_eq!(moved["undoCount"], 1);
    assert_eq!(moved["montage"]["blocks"][2]["mode"], "manual");
    assert_eq!(moved["montage"]["blocks"][2]["startUs"], 30_000_000);
    assert!(script::narration_allowed(candidate).is_ok());

    // Desfazer e refazer pelo mecanismo do editor.
    let undone = call("editor.undo", json!({"clip_id": clip_id}));
    assert_eq!(undone["montage"]["blocks"][2]["mode"], "automatic");
    assert_eq!(undone["montage"]["blocks"][2]["startUs"], 22_600_000);
    let redone = call("editor.redo", json!({"clip_id": clip_id}));
    assert_eq!(redone["montage"]["blocks"][2]["mode"], "manual");
    assert_eq!(redone["montage"]["blocks"][2]["startUs"], 30_000_000);

    // Silêncio ativo encurta o Corte e remapeia o início manual em Fonte -> saída.
    let with_silences = call(
        "editor.silences.detect",
        json!({"clip_id": clip_id, "threshold_us": 1_000_000}),
    );
    assert!(with_silences["silences"]["removedUs"].as_i64().unwrap() > 0);
    let b3_source = with_silences["montage"]["blocks"][2]["manualSourceStartUs"]
        .as_i64()
        .unwrap();
    assert_eq!(b3_source, 40_000_000);

    // Persiste ao fechar e reabrir o Projeto sem subir schemaVersion.
    call("projects.close", json!({}));
    call("projects.open", json!({"path": project["path"]}));
    let schema_in_db: i64 = with_reader(|c| {
        c.query_row(
            "SELECT json_extract(document,'$.schemaVersion') FROM clip_edits WHERE id=?1",
            [clip_id],
            |r| r.get(0),
        )
    })
    .unwrap();
    assert_eq!(schema_in_db, 2);

    let reopened = call(
        "editor.open",
        json!({"source_id": source, "start_id": 2, "end_id": 6, "candidate_id": candidate}),
    );
    assert_eq!(reopened["montage"]["blocks"][2]["mode"], "manual");
    assert_eq!(
        reopened["montage"]["blocks"][2]["manualSourceStartUs"],
        40_000_000
    );

    // Consumo direto pelo #79/#82 via `plan_for_clip` com durações reais.
    let mut real_durations = BTreeMap::new();
    real_durations.insert(block_ids[0], 5_000_000);
    real_durations.insert(block_ids[1], 5_000_000);
    real_durations.insert(block_ids[2], 5_000_000);
    real_durations.insert(block_ids[3], 5_000_000);
    let real_plan = montage::plan_for_clip(Some(clip_id), candidate, &real_durations)
        .unwrap()
        .unwrap();
    assert!(!real_plan.uses_estimated_durations);
    assert_eq!(real_plan.blocks[2].manual_source_start_us, Some(40_000_000));
    let mix = montage::audio_mix_plan(&real_plan);
    assert_eq!(mix.segments.len(), 4);

    // Voltar ao automático limpa a marca manual e é desfeito com Ctrl+Z.
    let reset = call(
        "editor.montage.set_start",
        json!({"clip_id": clip_id, "block_id": block_ids[2], "time_us": null}),
    );
    assert_eq!(reset["montage"]["blocks"][2]["mode"], "automatic");
}
