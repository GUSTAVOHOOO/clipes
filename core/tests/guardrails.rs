//! Guarda-corpos de monetização e originalidade (#76), headless e sem rede:
//! aviso único por canal do Corte direto, checklist pré-export, sinal > 60 s e não bloqueio.

use clipes_core::{dispatch, projects::with_writer, CoreError};
use serde_json::{json, Value};

fn call(name: &str, args: Value) -> Value {
    dispatch(name, args, &mut |_| {}).unwrap()
}

fn fail(name: &str, args: Value) -> CoreError {
    dispatch(name, args, &mut |_| {}).unwrap_err()
}

fn seed_source_with_sentences(n: i64, sentences: i64, permission: Value) -> (i64, i64) {
    with_writer(|c| {
        c.execute(
            "INSERT INTO sources(path,size,duration_us,partial_hash,metadata,permission,audio_track) VALUES (?1,1,?2,?3,'{}',?4,0)",
            (
                format!("C:/videos/live{n}.mp4"),
                sentences * 10_000_000,
                format!("h{n}"),
                permission.to_string(),
            ),
        )?;
        let source = c.last_insert_rowid();
        c.execute(
            "INSERT INTO transcripts(source_id,audio_track,engine,model,revision,compute_type,state,resume_us,duration_us) VALUES (?1,0,'local','m','r','c','complete',?2,?2)",
            (source, sentences * 10_000_000),
        )?;
        let transcript = c.last_insert_rowid();
        for s in 0..sentences {
            let pos = s * 2;
            c.execute(
                "INSERT INTO transcript_words(transcript_id,position,kind,text,start_us,end_us,language) VALUES (?1,?2,'word',' palavra',?3,?4,'pt')",
                (transcript, pos, s * 10_000_000, s * 10_000_000 + 4_000_000),
            )?;
            c.execute(
                "INSERT INTO transcript_words(transcript_id,position,kind,text,start_us,end_us,language) VALUES (?1,?2,'word',' fim.',?3,?4,'pt')",
                (transcript, pos + 1, s * 10_000_000 + 4_200_000, (s + 1) * 10_000_000),
            )?;
        }
        Ok((source, transcript))
    })
    .unwrap()
}

fn seed_run_and_approved_candidate(
    transcript_id: i64,
    video_kind: &str,
    start_id: i64,
    end_id: i64,
) -> (i64, i64) {
    with_writer(|c| {
        c.execute(
            "INSERT INTO selection_runs(transcript_id,task_version,prompt_sha256,profile,state,batch,min_us,max_us,weights,plan_state,windows_total,video_kind) VALUES (?1,1,'h','p','completed','',20000000,180000000,'[]','full',1,?2)",
            (transcript_id, video_kind),
        )?;
        let run_id = c.last_insert_rowid();
        c.execute(
            "INSERT INTO selection_candidates(run_id,rank,start_id,end_id,start_us,end_us,axes,total_centi,title,windows,adjust) VALUES (?1,1,?2,?3,?4,?5,'{}',800,'Corte','[0]',NULL)",
            (
                run_id,
                start_id,
                end_id,
                (start_id - 1) * 10_000_000,
                end_id * 10_000_000,
            ),
        )?;
        let candidate_id = c.last_insert_rowid();
        c.execute(
            "INSERT INTO selection_decisions(run_id,cand_start_id,cand_end_id,decision,before_start_id,before_end_id,after_start_id,after_end_id) VALUES (?1,?2,?3,'approved',?2,?3,?2,?3)",
            (run_id, start_id, end_id),
        )?;
        Ok((run_id, candidate_id))
    })
    .unwrap()
}

#[test]
fn guardrails_track_one_time_direct_ack_checklist_over60s_and_never_block() {
    let root = tempfile::tempdir().unwrap();
    std::env::set_var("CLIPES_DATA_DIR", root.path().join("data"));

    // Sem Projeto aberto.
    assert_eq!(
        fail("guardrails.check", json!({"source_id": 1})).code,
        "project_not_open"
    );
    assert_eq!(
        fail("guardrails.ack_direct_notice", json!({})).code,
        "project_not_open"
    );

    let project = call(
        "projects.create",
        json!({"parent": root.path(), "name": "CanalGuardrails"}),
    );

    // Ack inicial falso no Perfil de canal.
    assert_eq!(
        call("channel_profile.get", json!({}))["directMonetizationAck"],
        false
    );

    // Fonte 1: sem permissão, 10 Frases (100 s total).
    let (s1, t1) = seed_source_with_sentences(1, 10, json!({"status": "none"}));
    call("transcription.segment", json!({"source_id": s1}));

    // Lote vazio não falha e não pede aviso de Corte direto.
    let empty_batch = call("guardrails.check", json!({"scope": "project"}));
    assert_eq!(empty_batch["totalCuts"], 0);
    assert_eq!(empty_batch["needsDirectNotice"], false);
    assert_eq!(empty_batch["over60s"], false);

    // Candidato direto com exatamente 60 s (Frases 1..6): não dispara > 60 s.
    let (_, cand_60) = seed_run_and_approved_candidate(t1, "direct", 1, 6);
    let check_60 = call(
        "guardrails.check",
        json!({"source_id": s1, "candidate_id": cand_60, "start_id": 1, "end_id": 6}),
    );
    assert_eq!(check_60["directMonetizationAck"], false);
    assert_eq!(check_60["needsDirectNotice"], true);
    assert_eq!(check_60["videoKind"], "direct");
    assert_eq!(check_60["durationUs"], 60_000_000);
    assert_eq!(check_60["over60s"], false);
    assert_eq!(check_60["permission"]["status"], "none");
    assert_eq!(check_60["script"]["applicable"], false);

    // Candidato direto com 70 s (Frases 1..7): dispara > 60 s.
    let (_, cand_70) = seed_run_and_approved_candidate(t1, "direct", 1, 7);
    let check_70 = call(
        "guardrails.check",
        json!({"source_id": s1, "candidate_id": cand_70, "start_id": 1, "end_id": 7}),
    );
    assert_eq!(check_70["durationUs"], 70_000_000);
    assert_eq!(check_70["over60s"], true);
    assert_eq!(check_70["over60sCount"], 1);

    // Edição com remoção de silêncios reduzindo duração efetiva para 55 s: limpa > 60 s.
    let doc_55s = json!({
        "schemaVersion": 2,
        "revision": 1,
        "original": {"source_id": s1, "start_id": 1, "end_id": 7, "candidate_id": cand_70},
        "range": {"startId": 1, "endId": 7, "startUs": 0, "endUs": 70_000_000},
        "silences": {
            "thresholdUs": 600_000,
            "intervals": [{
                "id": 1,
                "startUs": 10_000_000,
                "endUs": 25_000_000,
                "gapStartUs": 10_000_000,
                "gapEndUs": 25_000_000,
                "status": "active"
            }]
        },
        "undo": [{"startId": 1, "endId": 7, "startUs": 0, "endUs": 70_000_000}],
        "redo": []
    });
    let clip_id = with_writer(|c| {
        c.execute(
            "INSERT INTO clip_edits(identity,document) VALUES (?1,?2)",
            (format!("candidate:{cand_70}"), doc_55s.to_string()),
        )?;
        Ok(c.last_insert_rowid())
    })
    .unwrap();
    let check_edited = call(
        "guardrails.check",
        json!({"source_id": s1, "candidate_id": cand_70, "clip_id": clip_id, "start_id": 1, "end_id": 7}),
    );
    assert_eq!(check_edited["durationUs"], 55_000_000);
    assert_eq!(check_edited["over60s"], false);

    // Confirma o aviso único do Corte direto e valida persistência após salvar perfil e reabrir Projeto.
    let acked = call("guardrails.ack_direct_notice", json!({}));
    assert_eq!(acked["directMonetizationAck"], true);

    call("channel_profile.set", json!({"language": "en"}));
    call("projects.close", json!({}));
    call("projects.open", json!({"path": project["path"]}));

    let profile_after = call("channel_profile.get", json!({}));
    assert_eq!(profile_after["directMonetizationAck"], true);
    assert_eq!(profile_after["language"], "en");

    let check_after_ack = call(
        "guardrails.check",
        json!({"source_id": s1, "candidate_id": cand_60}),
    );
    assert_eq!(check_after_ack["directMonetizationAck"], true);
    assert_eq!(check_after_ack["needsDirectNotice"], false);

    // Fonte 2: com permissão e Vídeo transformado + Roteiro pendente -> aprovado.
    let (s2, t2) = seed_source_with_sentences(
        2,
        8,
        json!({"status": "granted", "who": "Streamer", "where": "Chat", "scope": "cortes"}),
    );
    call("transcription.segment", json!({"source_id": s2}));
    let (run_t, cand_t) = seed_run_and_approved_candidate(t2, "transformed", 1, 8);

    let check_t_no_script = call(
        "guardrails.check",
        json!({"source_id": s2, "candidate_id": cand_t}),
    );
    assert_eq!(check_t_no_script["videoKind"], "transformed");
    assert_eq!(check_t_no_script["needsDirectNotice"], false);
    assert_eq!(check_t_no_script["over60s"], true);
    assert_eq!(check_t_no_script["permission"]["status"], "granted");
    assert_eq!(check_t_no_script["permission"]["who"], "Streamer");
    assert_eq!(check_t_no_script["script"]["applicable"], true);
    assert_eq!(check_t_no_script["script"]["exists"], false);
    assert_eq!(check_t_no_script["script"]["approved"], false);

    // Insere um Roteiro com 1 bloco aprovado e 1 pendente, depois aprova o 2º bloco.
    let (block2_id, ver2_id) = with_writer(|c| {
        c.execute(
            "INSERT INTO script_generations(job_id,run_id,cand_start_id,cand_end_id,language,task_version,prompt_sha256,profile,safety,outline,angle) VALUES (9001,?1,1,8,'pt-BR',1,'h','p','local','{}','{}')",
            [run_t],
        )?;
        let gen_id = c.last_insert_rowid();
        c.execute(
            "INSERT INTO script_blocks(generation_id,position,title,intent,refs) VALUES (?1,1,'B1','i','[1]')",
            [gen_id],
        )?;
        let b1 = c.last_insert_rowid();
        c.execute(
            "INSERT INTO script_block_versions(block_id,kind,title,narration,refs,angle_revision) VALUES (?1,'generated','B1','Fala 1','[1]',0)",
            [b1],
        )?;
        let v1 = c.last_insert_rowid();
        c.execute(
            "INSERT INTO script_approvals(block_id,version_id,angle_revision) VALUES (?1,?2,0)",
            (b1, v1),
        )?;

        c.execute(
            "INSERT INTO script_blocks(generation_id,position,title,intent,refs) VALUES (?1,2,'B2','i','[2]')",
            [gen_id],
        )?;
        let b2 = c.last_insert_rowid();
        c.execute(
            "INSERT INTO script_block_versions(block_id,kind,title,narration,refs,angle_revision) VALUES (?1,'generated','B2','Fala 2','[2]',0)",
            [b2],
        )?;
        let v2 = c.last_insert_rowid();
        Ok((b2, v2))
    })
    .unwrap();

    let check_t_pending = call(
        "guardrails.check",
        json!({"source_id": s2, "candidate_id": cand_t}),
    );
    assert_eq!(check_t_pending["script"]["exists"], true);
    assert_eq!(check_t_pending["script"]["approved"], false);
    assert_eq!(check_t_pending["script"]["pendingBlocks"], 1);
    assert_eq!(check_t_pending["script"]["totalBlocks"], 2);

    with_writer(|c| {
        c.execute(
            "INSERT INTO script_approvals(block_id,version_id,angle_revision) VALUES (?1,?2,0)",
            (block2_id, ver2_id),
        )?;
        Ok(())
    })
    .unwrap();

    let check_t_approved = call(
        "guardrails.check",
        json!({"source_id": s2, "candidate_id": cand_t}),
    );
    assert_eq!(check_t_approved["script"]["approved"], true);
    assert_eq!(check_t_approved["script"]["pendingBlocks"], 0);
    assert_eq!(check_t_approved["narration"]["freezeTailUs"], 0);
    assert_eq!(check_t_approved["narration"]["longFreezeTail"], false);

    // Quando a Narração ultrapassa o fim do Corte, o checklist pré-export expõe `freezeTailUs` (> 0).
    let long_text = "a".repeat(1500); // ~100 s em 15 chars/s -> sobra além de 80 s (> 5 s)
    with_writer(|c| {
        c.execute(
            "INSERT INTO script_block_versions(block_id,kind,title,narration,refs,angle_revision) VALUES (?1,'edit','B2',?2,'[8]',0)",
            (block2_id, &long_text),
        )?;
        let ver3 = c.last_insert_rowid();
        c.execute(
            "INSERT INTO script_approvals(block_id,version_id,angle_revision) VALUES (?1,?2,0)",
            (block2_id, ver3),
        )?;
        Ok(())
    })
    .unwrap();

    let check_t_freeze = call(
        "guardrails.check",
        json!({"source_id": s2, "candidate_id": cand_t}),
    );
    let tail_us = check_t_freeze["narration"]["freezeTailUs"]
        .as_i64()
        .unwrap();
    assert!(
        tail_us > 5_000_000,
        "esperava sobra > 5 s, obtida {tail_us}"
    );
    assert_eq!(check_t_freeze["narration"]["longFreezeTail"], true);

    // Lote por Projeto agrega direto + transformado, permissões parciais e Cortes > 60 s.
    let project_batch = call("guardrails.check", json!({"scope": "project"}));
    assert_eq!(project_batch["scope"], "project");
    assert_eq!(project_batch["totalCuts"], 3);
    assert_eq!(project_batch["videoKind"], "mixed");
    assert_eq!(project_batch["hasDirect"], true);
    assert_eq!(project_batch["hasTransformed"], true);
    assert_eq!(project_batch["over60s"], true);
    assert_eq!(project_batch["over60sCount"], 1);
    assert_eq!(project_batch["permission"]["status"], "partial");
    assert_eq!(project_batch["permission"]["grantedCount"], 1);
    assert_eq!(project_batch["permission"]["missingCount"], 2);
    assert_eq!(project_batch["script"]["applicable"], true);
    assert_eq!(project_batch["script"]["transformedCount"], 1);
    assert_eq!(project_batch["script"]["approvedCount"], 1);
    assert_eq!(project_batch["script"]["unapprovedCount"], 0);
    assert_eq!(project_batch["narration"]["freezeTailCount"], 1);
    assert_eq!(project_batch["narration"]["longFreezeTailCount"], 1);
    assert_eq!(project_batch["narration"]["maxFreezeTailUs"], tail_us);

    // Escopo inválido retorna erro tipado sem caminho pessoal.
    assert_eq!(
        fail("guardrails.check", json!({"scope": "invalid"})).code,
        "invalid_guardrails_scope"
    );

    call("projects.close", json!({}));
}
