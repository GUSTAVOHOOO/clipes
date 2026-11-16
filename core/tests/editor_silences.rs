//! Remoção de silêncios pelo mesmo dispatch do app (#77): detecção, prévia,
//! reversão parcial/total, pilha de desfazer, persistência e congelamento no export.
use clipes_core::{dispatch, projects::with_writer};
use serde_json::{json, Value};
use sha2::{Digest, Sha256};
use std::fs;

fn call(name: &str, args: Value) -> Value {
    dispatch(name, args, &mut |_| {}).unwrap()
}

#[test]
fn silences_detect_preview_toggle_revert_undo_persist_and_freeze_for_export() {
    let root = tempfile::tempdir().unwrap();
    let data = root.path().join("data");
    std::env::set_var("CLIPES_DATA_DIR", &data);
    let project = call(
        "projects.create",
        json!({"parent": root.path(), "name": "Silêncios"}),
    );
    let media = root.path().join("original.mp4");
    fs::write(&media, b"original").unwrap();
    let mut hash = Sha256::new();
    for _ in 0..3 {
        hash.update(b"original");
    }
    let source = with_writer(|c| {
        c.execute(
            "INSERT INTO sources(path,size,duration_us,partial_hash,metadata,permission,audio_track) VALUES (?1,8,30000000,?2,?3,'{}',0)",
            (
                media.to_str().unwrap(),
                format!("{:x}", hash.finalize()),
                r#"{"streams":[{"codec_type":"video","avg_frame_rate":"25/1"}]}"#,
            ),
        )?;
        let source = c.last_insert_rowid();
        c.execute(
            "INSERT INTO transcripts(source_id,audio_track,engine,model,revision,compute_type,state,resume_us,duration_us) VALUES (?1,0,'local','m','r','c','complete',30000000,30000000)",
            [source],
        )?;
        let transcript = c.last_insert_rowid();
        // Palavras com pausas: 450 ms (entre 0 e 1), 900 ms (entre 1 e 2), 1200 ms (entre 2 e 3).
        let words = [
            (0_i64, "um", 500_000_i64, 1_000_000_i64),
            (1, "dois", 1_450_000, 2_000_000),
            (2, "três", 2_900_000, 3_500_000),
            (3, "quatro", 4_700_000, 25_000_000),
        ];
        for (pos, text, start, end) in words {
            c.execute(
                "INSERT INTO transcript_words(transcript_id,position,kind,text,start_us,end_us,language) VALUES (?1,?2,'word',?3,?4,?5,'pt')",
                (transcript, pos, text, start, end),
            )?;
        }
        c.execute(
            "INSERT INTO sentences(transcript_id,id,first_position,last_position,start_us,end_us,text) VALUES (?1,1,0,3,0,26000000,'um dois três quatro')",
            [transcript],
        )?;
        c.execute(
            "INSERT INTO selection_runs(transcript_id,task_version,prompt_sha256,state,min_us,max_us,weights,plan_state,windows_total) VALUES (?1,1,'h','completed',10000000,180000000,'[]','ready',0)",
            [transcript],
        )?;
        let run = c.last_insert_rowid();
        c.execute(
            "INSERT INTO selection_candidates(run_id,rank,start_id,end_id,start_us,end_us,axes,total_centi,windows) VALUES (?1,1,1,1,0,26000000,'{}',500,'[]')",
            [run],
        )?;
        Ok((source, c.last_insert_rowid()))
    })
    .unwrap();
    let (source_id, candidate_id) = source;
    call(
        "selection.decide",
        json!({"candidate": candidate_id, "decision": "approved"}),
    );

    let opened = call(
        "editor.open",
        json!({"source_id": source_id, "start_id": 1, "end_id": 1, "candidate_id": candidate_id}),
    );
    let clip_id = opened["clipId"].as_i64().unwrap();
    assert_eq!(opened["silences"]["enabled"], false);
    assert_eq!(opened["silences"]["removedUs"], 0);
    assert_eq!(opened["silences"]["effectiveDurationUs"], 26_000_000);

    // Limites inválidos são recusados.
    for bad in [299_999, 2_000_001] {
        assert_eq!(
            dispatch(
                "editor.silences.detect",
                json!({"clip_id": clip_id, "threshold_us": bad}),
                &mut |_| {}
            )
            .unwrap_err()
            .code,
            "invalid_silence_threshold"
        );
    }

    // Prévia com 300 ms encontra 3 pausas sem gravar histórico.
    let preview = call(
        "editor.silences.detect",
        json!({"clip_id": clip_id, "threshold_us": 300_000, "preview": true}),
    );
    assert_eq!(
        preview["silences"]["intervals"].as_array().unwrap().len(),
        3
    );
    assert_eq!(preview["undoCount"], 0);

    // Aplicar padrão (600 ms) encontra 2 pausas (900 ms e 1200 ms), ignorando 450 ms e bordas.
    let detected = call(
        "editor.silences.detect",
        json!({"clip_id": clip_id, "threshold_us": 600_000}),
    );
    assert_eq!(detected["undoCount"], 1);
    let intervals = detected["silences"]["intervals"].as_array().unwrap();
    assert_eq!(intervals.len(), 2);
    // 900ms - 200ms = 700ms; 1200ms - 200ms = 1000ms => 1700ms removidos.
    assert_eq!(detected["silences"]["removedUs"], 1_700_000);
    assert_eq!(detected["silences"]["effectiveDurationUs"], 24_300_000);

    // Legendas usam o mesmo mapa de emendas; sourceStartUs preserva o tempo na Fonte.
    let caps = call(
        "export.captions",
        json!({"source_id": source_id, "start_id": 1, "end_id": 1, "candidate_id": candidate_id, "clip_id": clip_id}),
    );
    assert_eq!(caps["durationUs"], 24_300_000);
    assert_eq!(caps["segments"].as_array().unwrap().len(), 3);
    let words_json = caps["words"].as_array().unwrap();
    assert_eq!(words_json[0]["startUs"], 500_000);
    assert_eq!(words_json[1]["startUs"], 1_450_000);
    // "três" estava em 2_900_000; menos 700_000 removidos = 2_200_000.
    assert_eq!(words_json[2]["startUs"], 2_200_000);
    assert_eq!(words_json[2]["sourceStartUs"], 2_900_000);
    // "quatro" estava em 4_700_000; menos 1_700_000 removidos = 3_000_000.
    assert_eq!(words_json[3]["startUs"], 3_000_000);
    assert_eq!(words_json[3]["sourceStartUs"], 4_700_000);

    // Reverter um único trecho (id 1 = 700ms).
    let toggled = call(
        "editor.silences.toggle",
        json!({"clip_id": clip_id, "id": 1}),
    );
    assert_eq!(toggled["silences"]["intervals"][0]["status"], "reverted");
    assert_eq!(toggled["silences"]["intervals"][1]["status"], "active");
    assert_eq!(toggled["silences"]["removedUs"], 1_000_000);
    assert_eq!(toggled["undoCount"], 2);

    // Desfazer e refazer restauram o estado dos silêncios.
    let undone = call("editor.undo", json!({"clip_id": clip_id}));
    assert_eq!(undone["silences"]["removedUs"], 1_700_000);
    let redone = call("editor.redo", json!({"clip_id": clip_id}));
    assert_eq!(redone["silences"]["removedUs"], 1_000_000);

    // Reverter tudo.
    let reverted = call("editor.silences.revert_all", json!({"clip_id": clip_id}));
    assert_eq!(reverted["silences"]["removedUs"], 0);
    assert_eq!(reverted["silences"]["effectiveDurationUs"], 26_000_000);

    // Reaplicar tudo.
    let reapplied = call("editor.silences.apply_all", json!({"clip_id": clip_id}));
    assert_eq!(reapplied["silences"]["removedUs"], 1_700_000);

    // Persistência após fechar e reabrir o Projeto.
    call("projects.close", json!({}));
    call("projects.open", json!({"path": project["path"]}));
    let reopened = call(
        "editor.open",
        json!({"source_id": source_id, "start_id": 1, "end_id": 1, "candidate_id": candidate_id}),
    );
    assert_eq!(reopened["silences"]["removedUs"], 1_700_000);

    // Congelamento no enfileiramento de export.start.
    fs::write(
        data.join("component-settings.json"),
        json!({
            "data_dir": data,
            "cache_dir": data.join("cache"),
            "cache_limit_bytes": 1_000_000,
            "ffmpeg_path": env!("CARGO_BIN_EXE_fake-export")
        })
        .to_string(),
    )
    .unwrap();
    let output = root.path().join("corte.mp4");
    std::env::set_var("CLIPES_FAKE_EXPORT_STATE", root.path());
    let job = call(
        "export.start",
        json!({"source_id": source_id, "start_id": 1, "end_id": 1, "candidate_id": candidate_id, "clip_id": clip_id, "output": output}),
    )["job"]
        .as_i64()
        .unwrap();
    // Reverte tudo depois de enfileirar: o job já congelou os silêncios.
    call("editor.silences.revert_all", json!({"clip_id": clip_id}));
    let frozen_req: String = clipes_core::projects::with_reader(|c| {
        c.query_row("SELECT request FROM exports WHERE job_id=?1", [job], |r| {
            r.get(0)
        })
    })
    .unwrap();
    let frozen_val: Value = serde_json::from_str(&frozen_req).unwrap();
    assert_eq!(frozen_val["resolved_silences"].as_array().unwrap().len(), 2);
    call("jobs.cancel", json!({"id": job}));
    let deadline = std::time::Instant::now() + std::time::Duration::from_secs(10);
    while call("export.status", json!({"job": job}))["state"] == "running"
        || call("export.status", json!({"job": job}))["state"] == "queued"
    {
        assert!(std::time::Instant::now() < deadline);
        std::thread::sleep(std::time::Duration::from_millis(10));
    }
    std::env::remove_var("CLIPES_FAKE_EXPORT_STATE");
    call("projects.close", json!({}));
}
