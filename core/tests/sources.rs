use clipes_core::{dispatch, projects::with_writer};
use serde_json::json;
use std::{
    fs,
    process::Command,
    sync::Mutex,
    time::{SystemTime, UNIX_EPOCH},
};

static TEST_LOCK: Mutex<()> = Mutex::new(());

#[test]
fn local_source_lifecycle() {
    let _lock = TEST_LOCK.lock().unwrap_or_else(|e| e.into_inner());
    if Command::new("ffmpeg").arg("-version").output().is_err()
        || Command::new("ffprobe").arg("-version").output().is_err()
    {
        eprintln!("Skipping: ffmpeg and ffprobe are required to generate the temporary fixture");
        return;
    }
    let root = std::env::temp_dir().join(format!(
        "clipes-source-{}-{}",
        std::process::id(),
        SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap()
            .as_nanos()
    ));
    fs::create_dir_all(&root).unwrap();
    std::env::set_var("CLIPES_DATA_DIR", root.join("data"));
    std::env::set_var("CLIPES_FFPROBE", "ffprobe");
    let media = root.join("source.mkv");
    assert!(Command::new("ffmpeg")
        .args([
            "-v",
            "error",
            "-f",
            "lavfi",
            "-i",
            "color=c=black:s=64x64:d=1",
            "-f",
            "lavfi",
            "-i",
            "sine=frequency=440:duration=1",
            "-f",
            "lavfi",
            "-i",
            "sine=frequency=880:duration=1",
            "-map",
            "0:v",
            "-map",
            "1:a",
            "-map",
            "2:a",
            "-c:v",
            "mpeg4",
            "-c:a",
            "pcm_s16le",
            "-y"
        ])
        .arg(&media)
        .status()
        .unwrap()
        .success());
    let run = |name, args| dispatch(name, args, &mut |_| {});
    let project = run("projects.create", json!({"parent":root,"name":"Canal"})).unwrap();
    let project = project["path"].as_str().unwrap();
    let source=run("sources.import",json!({"project":project,"path":media,"permission":{"status":"none"},"audio_track":2,"copy":false})).unwrap();
    let id = source["id"].as_i64().unwrap();
    assert_eq!(source["permission"]["status"], "none");
    assert_eq!(source["language"], "pt");
    assert_eq!(source["transcript_state"], "none");
    assert_eq!(source["available"], true);
    assert_eq!(source["metadata"]["streams"][0]["width"], 64);
    assert_eq!(source["audio_track"], 2);
    assert_eq!(
        run("sources.import",json!({"project":project,"path":media,"permission":{"status":"none"},"audio_track":2,"language":"xx"})).unwrap_err().code,
        "invalid_language"
    );
    let spanish = run("sources.import",json!({"project":project,"path":media,"permission":{"status":"none"},"audio_track":2,"language":"Spanish"})).unwrap();
    assert_eq!(spanish["language"], "es");
    let spanish_id = spanish["id"].as_i64().unwrap();
    let updated = run(
        "sources.language.set",
        json!({"project":project,"id":spanish_id,"language":"en"}),
    )
    .unwrap();
    assert_eq!(updated["language"], "en");
    // Padrão herdado do Perfil de canal (#72 + #195) quando `language` é omitido.
    run("channel_profile.set", json!({"language": "fr"})).unwrap();
    let inherited = run(
        "sources.import",
        json!({"project":project,"path":media,"permission":{"status":"none"},"audio_track":2}),
    )
    .unwrap();
    assert_eq!(inherited["language"], "fr");
    run("channel_profile.set", json!({"language": "pt"})).unwrap();
    assert_eq!(
        source["metadata"]["streams"]
            .as_array()
            .unwrap()
            .iter()
            .filter(|s| s["codec_type"] == "audio")
            .count(),
        2
    );
    assert_eq!(run("sources.import",json!({"project":project,"path":media,"permission":{"status":"granted","who":"A"},"audio_track":2})).unwrap_err().code,"invalid_permission");
    assert_eq!(
        run(
            "sources.permission.set",
            json!({"project":project,"id":id,"permission":{"status":"granted","who":"A"}})
        )
        .unwrap_err()
        .code,
        "invalid_permission"
    );
    assert_eq!(
        run(
            "sources.permission.set",
            json!({"project":project,"id":id,"permission":{"status":"granted","who":"   ","where":"Email","scope":"cortes"}})
        )
        .unwrap_err()
        .code,
        "invalid_permission"
    );
    assert_eq!(
        run(
            "sources.permission.set",
            json!({"project":project,"id":999999,"permission":{"status":"none"}})
        )
        .unwrap_err()
        .code,
        "source_missing"
    );
    let granted = run(
        "sources.permission.set",
        json!({"project":project,"id":id,"permission":{"status":"granted","who":"  Criador  ","where":" Email ","scope":" cortes, tradução "}}),
    )
    .unwrap();
    assert_eq!(
        granted["permission"],
        json!({"status":"granted","who":"Criador","where":"Email","scope":"cortes, tradução"})
    );
    let reverted = run(
        "sources.permission.set",
        json!({"project":project,"id":id,"permission":{"status":"none"}}),
    )
    .unwrap();
    assert_eq!(reverted["permission"], json!({"status":"none"}));
    run(
        "sources.hash",
        json!({"project":project,"id":id,"job":"test-hash"}),
    )
    .unwrap();
    let replacement = root.join("replacement.mkv");
    fs::rename(&media, &replacement).unwrap();
    fs::copy(&replacement, &media).unwrap();
    fs::remove_file(&replacement).unwrap();
    let file = fs::OpenOptions::new().write(true).open(&media).unwrap();
    file.set_times(
        fs::FileTimes::new()
            .set_modified(UNIX_EPOCH + std::time::Duration::from_secs(1_000_000_000)),
    )
    .unwrap();
    drop(file);
    let altered = run("sources.list", json!({"project":project})).unwrap();
    assert_eq!(altered[0]["status"], "changed");
    assert_eq!(altered[0]["available"], false);
    run(
        "sources.hash",
        json!({"project":project,"id":id,"job":"verify-changed"}),
    )
    .unwrap();
    assert_eq!(
        run("sources.list", json!({"project":project})).unwrap()[0]["status"],
        "available"
    );
    let original = fs::read(&media).unwrap();
    let mut changed = original.clone();
    changed[0] ^= 1;
    fs::write(&media, &changed).unwrap();
    assert_eq!(
        run("sources.list", json!({"project":project})).unwrap()[0]["available"],
        false
    );
    fs::write(&media, &original).unwrap();
    let moved = root.join("moved.mkv");
    fs::rename(&media, &moved).unwrap();
    assert_eq!(
        run("sources.list", json!({"project":project})).unwrap()[0]["available"],
        false
    );
    let other = root.join("other.mkv");
    fs::write(&other, b"different").unwrap();
    assert_eq!(
        run(
            "sources.relocate",
            json!({"project":project,"id":id,"path":other})
        )
        .unwrap_err()
        .code,
        "source_mismatch"
    );
    run(
        "sources.relocate",
        json!({"project":project,"id":id,"path":moved}),
    )
    .unwrap();
    assert_eq!(
        run("sources.list", json!({"project":project})).unwrap()[0]["available"],
        true
    );
    let copied = run("sources.import", json!({"project":project,"path":moved,"permission":{"status":"granted","who":"Criador","where":"Email","scope":"tradução"},"audio_track":2,"copy":true})).unwrap();
    assert_eq!(copied["permission"]["scope"], "tradução");
    assert_eq!(copied["verified"], true);
    assert!(std::path::Path::new(copied["path"].as_str().unwrap())
        .starts_with(std::path::Path::new(project).join("media")));
    let unverified = run(
        "sources.import",
        json!({"project":project,"path":moved,"permission":{"status":"none"},"audio_track":2}),
    )
    .unwrap();
    let unverified_id = unverified["id"].as_i64().unwrap();
    assert_eq!(
        run(
            "sources.relocate",
            json!({"project":project,"id":unverified_id,"path":moved})
        )
        .unwrap_err()
        .code,
        "confirmation_required"
    );
    assert!(run(
        "sources.relocate",
        json!({"project":project,"id":unverified_id,"path":moved,"confirmed":true})
    )
    .is_ok());
    let mut job_blocks_close = false;
    run(
        "sources.hash",
        json!({"project":project,"id":id,"job":"guard-test"}),
    )
    .unwrap();
    dispatch(
        "sources.hash",
        json!({"project":project,"id":id,"job":"guard-observe"}),
        &mut |_| {
            job_blocks_close = dispatch("projects.close", json!({}), &mut |_| {})
                .unwrap_err()
                .code
                == "project_busy";
        },
    )
    .unwrap();
    assert!(job_blocks_close);
    let mut emitted = false;
    let result = dispatch(
        "sources.hash",
        json!({"project":project,"id":id,"job":"cancel-test"}),
        &mut |_| {
            emitted = true;
            dispatch("sources.cancel", json!({"job":"cancel-test"}), &mut |_| {}).unwrap();
        },
    );
    assert!(emitted);
    assert_eq!(result.unwrap_err().code, "cancelled");
    // A different file can match all three sampled blocks; the full hash must reject it.
    let large = root.join("large.mkv");
    fs::copy(&moved, &large).unwrap();
    {
        let file = fs::OpenOptions::new().write(true).open(&large).unwrap();
        file.set_len(20 * 1024 * 1024).unwrap();
    }
    let large_source = run(
        "sources.import",
        json!({"project":project,"path":large,"permission":{"status":"none"},"audio_track":2}),
    )
    .unwrap();
    let large_id = large_source["id"].as_i64().unwrap();
    run(
        "sources.hash",
        json!({"project":project,"id":large_id,"job":"large-hash"}),
    )
    .unwrap();
    let impostor = root.join("impostor.mkv");
    fs::copy(&large, &impostor).unwrap();
    {
        use std::io::{Seek, SeekFrom, Write};
        let mut file = fs::OpenOptions::new().write(true).open(&impostor).unwrap();
        file.seek(SeekFrom::Start(5 * 1024 * 1024)).unwrap();
        file.write_all(&[1]).unwrap();
    }
    assert_eq!(
        run(
            "sources.relocate",
            json!({"project":project,"id":large_id,"path":impostor})
        )
        .unwrap_err()
        .code,
        "source_mismatch"
    );
    fs::copy(&impostor, &large).unwrap();
    assert_eq!(
        run(
            "sources.hash",
            json!({"project":project,"id":large_id,"job":"check-changed"})
        )
        .unwrap_err()
        .code,
        "confirmation_required"
    );
    assert_eq!(
        run("sources.list", json!({"project":project}))
            .unwrap()
            .as_array()
            .unwrap()
            .iter()
            .find(|s| s["id"] == large_id)
            .unwrap()["status"],
        "changed"
    );
    run(
        "sources.hash",
        json!({"project":project,"id":large_id,"job":"confirm-changed","confirmed":true}),
    )
    .unwrap();
    assert_eq!(
        run("sources.list", json!({"project":project}))
            .unwrap()
            .as_array()
            .unwrap()
            .iter()
            .find(|s| s["id"] == large_id)
            .unwrap()["status"],
        "available"
    );
    let moved_project = root.join("Canal-movido.clipes");
    run("projects.close", json!({})).unwrap();
    fs::rename(project, &moved_project).unwrap();
    let reopened = run("projects.open", json!({"path":moved_project})).unwrap();
    let items = run("sources.list", json!({"project":reopened["path"]})).unwrap();
    let copy = items
        .as_array()
        .unwrap()
        .iter()
        .find(|s| s["id"] == copied["id"])
        .unwrap();
    assert_eq!(copy["available"], true);
    assert_eq!(
        items
            .as_array()
            .unwrap()
            .iter()
            .find(|s| s["id"] == spanish_id)
            .unwrap()["language"],
        "en"
    );
    // Alterar Permissão mesmo quando a Fonte está offline.
    fs::remove_file(&moved).unwrap();
    let offline_updated = run(
        "sources.permission.set",
        json!({"project":reopened["path"],"id":unverified_id,"permission":{"status":"granted","who":"Canal Offline","where":"DM","scope":"cortes"}}),
    )
    .unwrap();
    assert_eq!(offline_updated["status"], "offline");
    assert_eq!(offline_updated["permission"]["who"], "Canal Offline");
    run("projects.close", json!({})).unwrap();
    std::env::remove_var("CLIPES_FFPROBE");
    std::env::remove_var("CLIPES_DATA_DIR");
    fs::remove_dir_all(root).unwrap();
}

#[test]
fn permission_set_reflects_in_packaging_translation_and_guardrails() {
    let _lock = TEST_LOCK.lock().unwrap_or_else(|e| e.into_inner());
    let root = std::env::temp_dir().join(format!(
        "clipes-source-perm-{}-{}",
        std::process::id(),
        SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap()
            .as_nanos()
    ));
    fs::create_dir_all(&root).unwrap();
    std::env::set_var("CLIPES_DATA_DIR", root.join("data"));
    let run = |name, args| dispatch(name, args, &mut |_| {});

    assert_eq!(
        run(
            "sources.permission.set",
            json!({"project": root.join("Canal.clipes"), "id": 1, "permission": {"status": "none"}})
        )
        .unwrap_err()
        .code,
        "project_not_open"
    );

    let project = run(
        "projects.create",
        json!({"parent": root, "name": "CanalPerm"}),
    )
    .unwrap();
    let project_path = project["path"].as_str().unwrap();

    assert_eq!(
        run(
            "sources.permission.set",
            json!({"project": root.join("Outro.clipes"), "id": 1, "permission": {"status": "none"}})
        )
        .unwrap_err()
        .code,
        "invalid_project"
    );

    let (source_id, candidate_id) = with_writer(|c| {
        c.execute(
            "INSERT INTO sources(path,size,duration_us,partial_hash,metadata,permission,audio_track,origin_url) VALUES ('C:/videos/perm.mp4',1,30000000,'h','{}','{\"status\":\"none\"}',0,'https://example.com/watch?v=perm')",
            [],
        )?;
        let source_id = c.last_insert_rowid();
        c.execute(
            "INSERT INTO transcripts(source_id,audio_track,engine,model,revision,compute_type,state,resume_us,duration_us) VALUES (?1,0,'local','m','r','c','complete',30000000,30000000)",
            [source_id],
        )?;
        let transcript_id = c.last_insert_rowid();
        for (pos, text, start_us, end_us) in [
            (0, "Primeira", 0, 4_000_000),
            (1, " frase.", 4_100_000, 10_000_000),
            (2, "Segunda", 11_000_000, 15_000_000),
            (3, " frase.", 15_100_000, 21_000_000),
        ] {
            c.execute(
                "INSERT INTO transcript_words(transcript_id,position,kind,text,start_us,end_us,language) VALUES (?1,?2,'word',?3,?4,?5,'pt')",
                (transcript_id, pos, text, start_us, end_us),
            )?;
        }
        c.execute(
            "INSERT INTO selection_runs(transcript_id,task_version,prompt_sha256,profile,state,batch,min_us,max_us,weights,plan_state,windows_total,video_kind) VALUES (?1,1,'h','p','completed','',20000000,180000000,'[]','full',1,'direct')",
            [transcript_id],
        )?;
        let run_id = c.last_insert_rowid();
        c.execute(
            "INSERT INTO selection_candidates(run_id,rank,start_id,end_id,start_us,end_us,axes,total_centi,title,windows,adjust) VALUES (?1,1,1,2,0,21000000,'{}',800,'Corte','[0]',NULL)",
            [run_id],
        )?;
        let candidate_id = c.last_insert_rowid();
        Ok((source_id, candidate_id))
    })
    .unwrap();

    run("transcription.segment", json!({"source_id": source_id})).unwrap();
    run(
        "selection.decide",
        json!({"candidate": candidate_id, "decision": "approved"}),
    )
    .unwrap();
    let clip = run(
        "editor.open",
        json!({"source_id": source_id, "start_id": 1, "end_id": 2}),
    )
    .unwrap();
    let clip_id = clip["clipId"].as_i64().unwrap();

    run(
        "provider.configure",
        json!({"endpoint": "http://127.0.0.1:9/v1", "kind": "openai", "model": "fake-model", "context": 32768}),
    )
    .unwrap();

    // 1. Inicialmente sem Permissão: sem crédito no Empacotamento, tradução bloqueada e guarda-corpos sem permissão.
    let pack0 = run("packaging.get", json!({"candidate": candidate_id})).unwrap();
    assert_eq!(pack0["credit"]["text"], json!(null));
    assert_eq!(pack0["credit"]["warning"], "no_permission");
    let tr0 = run("translation.get", json!({"clip_id": clip_id})).unwrap();
    assert_eq!(tr0["permitted"], false);
    assert_eq!(
        tr0["permissionError"]["code"],
        "translation_permission_required"
    );
    assert_eq!(
        run("translation.estimate", json!({"clip_id": clip_id}))
            .unwrap_err()
            .code,
        "translation_permission_required"
    );
    let gr0 = run(
        "guardrails.check",
        json!({"scope": "single", "source_id": source_id, "candidate_id": candidate_id}),
    )
    .unwrap();
    assert_eq!(gr0["permission"]["status"], "none");
    assert_eq!(gr0["permission"]["missingCount"], 1);
    let gr0_batch = run("guardrails.check", json!({"scope": "project"})).unwrap();
    assert_eq!(gr0_batch["permission"]["status"], "none");
    assert_eq!(gr0_batch["permission"]["missingCount"], 1);

    // 2. Registrar Permissão sem escopo "tradução": Empacotamento e guarda-corpos refletem; tradução pede atualização.
    run(
        "sources.permission.set",
        json!({"project": project_path, "id": source_id, "permission": {"status": "granted", "who": "Criador Inicial", "where": "Discord", "scope": "cortes diretos"}}),
    )
    .unwrap();
    let pack1 = run("packaging.get", json!({"candidate": candidate_id})).unwrap();
    assert_eq!(
        pack1["credit"]["text"],
        "Crédito: vídeo original de Criador Inicial.\nFonte: https://example.com/watch?v=perm"
    );
    assert_eq!(pack1["credit"]["warning"], json!(null));
    let tr1 = run("translation.get", json!({"clip_id": clip_id})).unwrap();
    assert_eq!(tr1["permitted"], false);
    assert!(tr1["permissionError"]["message"]
        .as_str()
        .unwrap()
        .contains("Atualize a Permissão"));
    let gr1 = run(
        "guardrails.check",
        json!({"scope": "single", "source_id": source_id, "candidate_id": candidate_id}),
    )
    .unwrap();
    assert_eq!(gr1["permission"]["status"], "granted");
    assert_eq!(gr1["permission"]["who"], "Criador Inicial");
    assert_eq!(gr1["permission"]["where"], "Discord");
    assert_eq!(gr1["permission"]["scope"], "cortes diretos");
    assert_eq!(gr1["permission"]["grantedCount"], 1);
    let gr1_batch = run(
        "guardrails.check",
        json!({"scope": "source", "source_id": source_id}),
    )
    .unwrap();
    assert_eq!(gr1_batch["permission"]["status"], "granted");
    assert_eq!(gr1_batch["permission"]["grantedCount"], 1);

    // 3. Editar Permissão para incluir "tradução" e novo "who": todos os três módulos refletem imediatamente.
    run(
        "sources.permission.set",
        json!({"project": project_path, "id": source_id, "permission": {"status": "granted", "who": "Criador Atualizado", "where": "Email", "scope": "cortes, tradução"}}),
    )
    .unwrap();
    let pack2 = run("packaging.get", json!({"candidate": candidate_id})).unwrap();
    assert_eq!(
        pack2["credit"]["text"],
        "Crédito: vídeo original de Criador Atualizado.\nFonte: https://example.com/watch?v=perm"
    );
    let tr2 = run("translation.get", json!({"clip_id": clip_id})).unwrap();
    assert_eq!(tr2["permitted"], true);
    assert_eq!(tr2["permissionError"], json!(null));
    let est = run("translation.estimate", json!({"clip_id": clip_id})).unwrap();
    assert_eq!(est["targetLanguage"], "en");
    let gr2 = run(
        "guardrails.check",
        json!({"scope": "single", "source_id": source_id, "candidate_id": candidate_id}),
    )
    .unwrap();
    assert_eq!(gr2["permission"]["who"], "Criador Atualizado");
    assert_eq!(gr2["permission"]["where"], "Email");
    assert_eq!(gr2["permission"]["scope"], "cortes, tradução");

    // 4. Voltar para "none": remove crédito, bloqueia tradução e atualiza guarda-corpos.
    run(
        "sources.permission.set",
        json!({"project": project_path, "id": source_id, "permission": {"status": "none"}}),
    )
    .unwrap();
    let pack3 = run("packaging.get", json!({"candidate": candidate_id})).unwrap();
    assert_eq!(pack3["credit"]["text"], json!(null));
    assert_eq!(pack3["credit"]["warning"], "no_permission");
    let tr3 = run("translation.get", json!({"clip_id": clip_id})).unwrap();
    assert_eq!(tr3["permitted"], false);
    assert_eq!(
        run("translation.estimate", json!({"clip_id": clip_id}))
            .unwrap_err()
            .code,
        "translation_permission_required"
    );
    let gr3 = run(
        "guardrails.check",
        json!({"scope": "single", "source_id": source_id, "candidate_id": candidate_id}),
    )
    .unwrap();
    assert_eq!(gr3["permission"]["status"], "none");
    assert_eq!(gr3["permission"]["missingCount"], 1);

    run("projects.close", json!({})).unwrap();
    std::env::remove_var("CLIPES_DATA_DIR");
    fs::remove_dir_all(root).unwrap();
}

#[test]
fn sources_list_and_mutating_responses_expose_transcript_state() {
    let _lock = TEST_LOCK.lock().unwrap_or_else(|e| e.into_inner());
    let root = tempfile::tempdir().unwrap();
    std::env::set_var("CLIPES_DATA_DIR", root.path().join("data"));
    let run = |name, args| dispatch(name, args, &mut |_| {});

    let project = run(
        "projects.create",
        json!({"parent": root.path(), "name": "CanalEstado"}),
    )
    .unwrap();
    let project_path = project["path"].as_str().unwrap().to_owned();

    let (s_none, s_queued, s_running_partial, s_partial, s_failed_zero, s_complete) =
        with_writer(|c| {
            let insert_source = |name: &str| -> rusqlite::Result<i64> {
                c.execute(
                    "INSERT INTO sources(path,size,duration_us,partial_hash,metadata,permission,audio_track) VALUES (?1,1,30000000,'h','{}','{\"status\":\"none\"}',0)",
                    [format!("C:/videos/{name}")],
                )?;
                Ok(c.last_insert_rowid())
            };

            let s_none = insert_source("none.mp4")?;

            let s_queued = insert_source("queued.mp4")?;
            c.execute(
                "INSERT INTO transcripts(source_id,audio_track,engine,model,revision,compute_type,state,resume_us,duration_us) VALUES (?1,0,'local','m','r','c','running',0,30000000)",
                [s_queued],
            )?;
            c.execute(
                "INSERT INTO jobs(kind,safety,state,source_id) VALUES ('transcription','local','queued',?1)",
                [s_queued],
            )?;

            let s_running_partial = insert_source("running_partial.mp4")?;
            c.execute(
                "INSERT INTO transcripts(source_id,audio_track,engine,model,revision,compute_type,state,resume_us,duration_us) VALUES (?1,0,'local','m','r','c','running',10000000,30000000)",
                [s_running_partial],
            )?;
            c.execute(
                "INSERT INTO jobs(kind,safety,state,source_id) VALUES ('transcription','local','running',?1)",
                [s_running_partial],
            )?;

            let s_partial = insert_source("partial.mp4")?;
            c.execute(
                "INSERT INTO transcripts(source_id,audio_track,engine,model,revision,compute_type,state,resume_us,duration_us) VALUES (?1,0,'local','m','r','c','running',10000000,30000000)",
                [s_partial],
            )?;
            c.execute(
                "INSERT INTO jobs(kind,safety,state,source_id) VALUES ('transcription','local','cancelled',?1)",
                [s_partial],
            )?;

            let s_failed_zero = insert_source("failed_zero.mp4")?;
            c.execute(
                "INSERT INTO transcripts(source_id,audio_track,engine,model,revision,compute_type,state,resume_us,duration_us) VALUES (?1,0,'local','m','r','c','running',0,30000000)",
                [s_failed_zero],
            )?;
            c.execute(
                "INSERT INTO jobs(kind,safety,state,source_id) VALUES ('transcription','local','failed',?1)",
                [s_failed_zero],
            )?;

            let s_complete = insert_source("complete.mp4")?;
            c.execute(
                "INSERT INTO transcripts(source_id,audio_track,engine,model,revision,compute_type,state,resume_us,duration_us) VALUES (?1,0,'local','m','r','c','complete',30000000,30000000)",
                [s_complete],
            )?;
            c.execute(
                "INSERT INTO jobs(kind,safety,state,source_id) VALUES ('transcription','local','completed',?1)",
                [s_complete],
            )?;

            Ok((
                s_none,
                s_queued,
                s_running_partial,
                s_partial,
                s_failed_zero,
                s_complete,
            ))
        })
        .unwrap();

    let list = run("sources.list", json!({"project": project_path})).unwrap();
    let items = list.as_array().unwrap();
    let state_of = |id: i64| -> String {
        items.iter().find(|item| item["id"] == id).unwrap()["transcript_state"]
            .as_str()
            .unwrap()
            .to_owned()
    };

    assert_eq!(state_of(s_none), "none");
    assert_eq!(state_of(s_queued), "running");
    assert_eq!(state_of(s_running_partial), "running");
    assert_eq!(state_of(s_partial), "partial");
    assert_eq!(state_of(s_failed_zero), "none");
    assert_eq!(state_of(s_complete), "complete");

    // Retornos de comandos que delegam para fn get também expõem transcript_state.
    let lang_updated = run(
        "sources.language.set",
        json!({"project": project_path, "id": s_none, "language": "en"}),
    )
    .unwrap();
    assert_eq!(lang_updated["transcript_state"], "none");

    let perm_updated = run(
        "sources.permission.set",
        json!({"project": project_path, "id": s_complete, "permission": {"status": "granted", "who": "Autor", "where": "YT", "scope": "cortes"}}),
    )
    .unwrap();
    assert_eq!(perm_updated["transcript_state"], "complete");

    run("projects.close", json!({})).unwrap();
    std::env::remove_var("CLIPES_DATA_DIR");
}
