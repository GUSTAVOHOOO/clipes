//! Testes de prontidão de exportação (`export.readiness`, #298):
//! agregação somente leitura em 1 chamada, filtro por Fonte, paginação,
//! Corte direto vs Vídeo transformado, Fonte offline, Projeto V1 sem `clip_edits`
//! e exclusão de candidatos não aprovados.

use clipes_core::{
    dispatch,
    projects::{with_reader, with_writer},
};
use serde_json::{json, Value};
use sha2::{Digest, Sha256};
use std::{
    ffi::OsString,
    fs,
    path::{Path, PathBuf},
    sync::{Mutex, MutexGuard},
};

static TEST_LOCK: Mutex<()> = Mutex::new(());
const V1_FIXTURE: &[u8] = include_bytes!("fixtures/project-pre-0104.sqlite");

struct SessionGuard {
    _lock: MutexGuard<'static, ()>,
    prev_data_dir: Option<OsString>,
    _tmp: tempfile::TempDir,
}

impl SessionGuard {
    fn new() -> Self {
        let lock = TEST_LOCK.lock().unwrap_or_else(|e| e.into_inner());
        let tmp = tempfile::tempdir().unwrap();
        let prev_data_dir = std::env::var_os("CLIPES_DATA_DIR");
        std::env::set_var("CLIPES_DATA_DIR", tmp.path().join("data"));
        Self {
            _lock: lock,
            prev_data_dir,
            _tmp: tmp,
        }
    }

    fn root(&self) -> &Path {
        self._tmp.path()
    }

    fn create_project(&self, name: &str) -> PathBuf {
        let created = call(
            "projects.create",
            json!({ "parent": self.root(), "name": name }),
        );
        PathBuf::from(created["path"].as_str().unwrap())
    }

    fn open_v1_fixture(&self, name: &str) -> PathBuf {
        let dir = self.root().join(format!("{name}.clipes"));
        fs::create_dir_all(&dir).unwrap();
        fs::write(dir.join("project.sqlite"), V1_FIXTURE).unwrap();
        let opened = call("projects.open", json!({ "path": dir }));
        PathBuf::from(opened["path"].as_str().unwrap())
    }
}

impl Drop for SessionGuard {
    fn drop(&mut self) {
        let _ = dispatch("projects.close", json!({}), &mut |_| {});
        match self.prev_data_dir.take() {
            Some(v) => std::env::set_var("CLIPES_DATA_DIR", v),
            None => std::env::remove_var("CLIPES_DATA_DIR"),
        }
    }
}

fn call(name: &str, args: Value) -> Value {
    dispatch(name, args, &mut |_| {}).unwrap()
}

fn fail(name: &str, args: Value, code: &str) {
    let err = dispatch(name, args, &mut |_| {}).unwrap_err();
    assert_eq!(err.code, code, "expected {code}, got {err:?}");
}

fn file_modified_nanos(path: &Path) -> String {
    let time = fs::metadata(path).unwrap().modified().unwrap();
    match time.duration_since(std::time::UNIX_EPOCH) {
        Ok(d) => d.as_nanos().to_string(),
        Err(e) => format!("-{}", e.duration().as_nanos()),
    }
}

fn partial_hash_small(bytes: &[u8]) -> String {
    let mut hash = Sha256::new();
    for _ in 0..3 {
        hash.update(bytes);
    }
    format!("{:x}", hash.finalize())
}

fn seed_source(media: &Path, sentences: i64, permission: Value, available_file: bool) -> (i64, i64) {
    let bytes = b"fake-media-bytes-for-readiness-test";
    fs::write(media, bytes).unwrap();
    let size = bytes.len() as i64;
    let hash = partial_hash_small(bytes);
    let mtime = file_modified_nanos(media);
    if !available_file {
        fs::remove_file(media).unwrap();
    }

    let source_id = with_writer(|c| {
        c.execute(
            "INSERT INTO sources(path,size,duration_us,partial_hash,metadata,permission,audio_track,modified)
             VALUES (?1,?2,?3,?4,'{}',?5,0,?6)",
            (
                media.to_str().unwrap(),
                size,
                sentences * 10_000_000,
                hash,
                permission.to_string(),
                mtime,
            ),
        )?;
        let source_id = c.last_insert_rowid();
        c.execute(
            "INSERT INTO transcripts(source_id,audio_track,engine,model,revision,compute_type,state,resume_us,duration_us)
             VALUES (?1,0,'local','m','r','c','complete',?2,?2)",
            (source_id, sentences * 10_000_000),
        )?;
        let transcript_id = c.last_insert_rowid();
        for s in 0..sentences {
            let pos = s * 2;
            c.execute(
                "INSERT INTO transcript_words(transcript_id,position,kind,text,start_us,end_us,language)
                 VALUES (?1,?2,'word',' palavra',?3,?4,'pt')",
                (transcript_id, pos, s * 10_000_000, s * 10_000_000 + 4_000_000),
            )?;
            c.execute(
                "INSERT INTO transcript_words(transcript_id,position,kind,text,start_us,end_us,language)
                 VALUES (?1,?2,'word',' fim.',?3,?4,'pt')",
                (transcript_id, pos + 1, s * 10_000_000 + 4_200_000, (s + 1) * 10_000_000),
            )?;
        }
        Ok(source_id)
    })
    .unwrap();
    call("transcription.segment", json!({ "source_id": source_id }));
    let transcript_id = with_reader(|c| {
        c.query_row(
            "SELECT id FROM transcripts WHERE source_id=?1",
            [source_id],
            |r| r.get::<_, i64>(0),
        )
    })
    .unwrap();
    (source_id, transcript_id)
}

fn seed_candidate(
    transcript_id: i64,
    run_kind: &str,
    cand_kind: Option<&str>,
    start_id: i64,
    end_id: i64,
    title: &str,
    decision: Option<&str>,
) -> (i64, i64) {
    with_writer(|c| {
        c.execute(
            "INSERT INTO selection_runs(transcript_id,task_version,prompt_sha256,profile,state,batch,min_us,max_us,weights,plan_state,windows_total,video_kind)
             VALUES (?1,1,'h','p','completed','',20000000,180000000,'[]','full',1,?2)",
            (transcript_id, run_kind),
        )?;
        let run_id = c.last_insert_rowid();
        c.execute(
            "INSERT INTO selection_candidates(run_id,rank,start_id,end_id,start_us,end_us,axes,total_centi,title,windows,adjust,video_kind)
             VALUES (?1,1,?2,?3,?4,?5,'{}',825,?6,'[0]',NULL,?7)",
            (
                run_id,
                start_id,
                end_id,
                (start_id - 1) * 10_000_000,
                end_id * 10_000_000,
                title,
                cand_kind,
            ),
        )?;
        let candidate_id = c.last_insert_rowid();
        if let Some(kind) = decision {
            c.execute(
                "INSERT INTO selection_decisions(run_id,cand_start_id,cand_end_id,decision,before_start_id,before_end_id,after_start_id,after_end_id)
                 VALUES (?1,?2,?3,?4,?2,?3,?2,?3)",
                (run_id, start_id, end_id, kind),
            )?;
        }
        Ok((run_id, candidate_id))
    })
    .unwrap()
}

fn seed_packaging(run_id: i64, start_id: i64, end_id: i64, title: &str, desc: &str) {
    with_writer(|c| {
        c.execute(
            "INSERT INTO jobs(kind,safety,state,progress) VALUES ('ai:packaging','local','completed',100)",
            [],
        )?;
        let job_id = c.last_insert_rowid();
        let fields = json!({
            "title": title,
            "description": desc,
            "tags": ["clipes", "teste"],
            "hashtags": ["#clipes"]
        })
        .to_string();
        c.execute(
            "INSERT INTO packaging_generations(job_id,run_id,cand_start_id,cand_end_id,language,task_version,prompt_sha256,profile,generated)
             VALUES (?1,?2,?3,?4,'pt-BR',1,'h','local',?5)",
            (job_id, run_id, start_id, end_id, fields),
        )?;
        Ok(())
    })
    .unwrap();
}

fn seed_thumbnail(run_id: i64, start_id: i64, end_id: i64, instant_us: i64, origin: &str) {
    with_writer(|c| {
        c.execute(
            "INSERT INTO thumbnail_choices(run_id,cand_start_id,cand_end_id,instant_us,origin)
             VALUES (?1,?2,?3,?4,?5)",
            (run_id, start_id, end_id, instant_us, origin),
        )?;
        Ok(())
    })
    .unwrap();
}

fn seed_script(
    run_id: i64,
    start_id: i64,
    end_id: i64,
    approved_count: usize,
    total_blocks: usize,
) -> Vec<i64> {
    with_writer(|c| {
        c.execute(
            "INSERT INTO jobs(kind,safety,state,progress) VALUES ('ai:script','local','completed',100)",
            [],
        )?;
        let gen_job_id = c.last_insert_rowid();
        c.execute(
            "INSERT INTO script_generations(job_id,run_id,cand_start_id,cand_end_id,language,task_version,prompt_sha256,profile,safety,outline)
             VALUES (?1,?2,?3,?4,'pt-BR',1,'h','local','local','[]')",
            (gen_job_id, run_id, start_id, end_id),
        )?;
        let gen_id = c.last_insert_rowid();
        let mut block_ids = Vec::with_capacity(total_blocks);
        for idx in 0..total_blocks {
            c.execute(
                "INSERT INTO script_blocks(generation_id,position,title,intent,refs)
                 VALUES (?1,?2,?3,'intent','[1]')",
                (gen_id, idx as i64 + 1, format!("Bloco {}", idx + 1)),
            )?;
            let block_id = c.last_insert_rowid();
            c.execute(
                "INSERT INTO script_block_versions(block_id,kind,title,narration,refs,angle_revision)
                 VALUES (?1,'generated',?2,'Texto falado da narração.','[1]',0)",
                (block_id, format!("Bloco {}", idx + 1)),
            )?;
            let ver_id = c.last_insert_rowid();
            if idx < approved_count {
                c.execute(
                    "INSERT INTO script_approvals(block_id,version_id,angle_revision) VALUES (?1,?2,0)",
                    (block_id, ver_id),
                )?;
            }
            block_ids.push(block_id);
        }
        Ok(block_ids)
    })
    .unwrap()
}

fn seed_tts_wav(project_dir: &Path, candidate_id: i64, block_id: i64, voice_id: &str) {
    let rel = format!("narrations/c{candidate_id}/b{block_id}.wav");
    let full = project_dir.join(&rel);
    fs::create_dir_all(full.parent().unwrap()).unwrap();
    fs::write(&full, b"RIFF0000WAVEfmt ").unwrap();
    with_writer(|c| {
        let ver_id: i64 = c.query_row(
            "SELECT id FROM script_block_versions WHERE block_id=?1 ORDER BY id DESC LIMIT 1",
            [block_id],
            |r| r.get(0),
        )?;
        c.execute(
            "INSERT INTO narration_blocks(block_id,version_id,voice_id,model_id,engine_id,audio_rel_path,duration_us,sample_rate,channels,bytes,sha256)
             VALUES (?1,?2,?3,'portuguese_24l','pocket-tts',?4,3000000,24000,1,16,'abc')",
            (block_id, ver_id, voice_id, rel),
        )?;
        Ok(())
    })
    .unwrap();
}

#[test]
fn requires_open_project_and_returns_empty_without_approved_cuts() {
    let guard = SessionGuard::new();
    fail("export.readiness", json!({}), "project_not_open");

    guard.create_project("Vazio");
    let empty = call("export.readiness", json!({}));
    assert_eq!(empty["total"], 0);
    assert_eq!(empty["offset"], 0);
    assert!(empty["limit"].is_null());
    assert_eq!(empty["hasMore"], false);
    assert_eq!(empty["items"], json!([]));
}

#[test]
fn aggregates_approved_cuts_filters_paginates_and_stays_readonly() {
    let guard = SessionGuard::new();
    let project_dir = guard.create_project("Prontidao");

    // Fonte 1 (online, com permissão)
    let media1 = guard.root().join("live-online.mp4");
    let (s1, t1) = seed_source(
        &media1,
        10,
        json!({"status": "granted", "who": "Criador X", "where": "Chat", "scope": "cortes"}),
        true,
    );

    // Fonte 2 (offline, sem permissão)
    let media2 = guard.root().join("live-offline.mp4");
    let (s2, t2) = seed_source(&media2, 10, json!({"status": "none"}), false);

    // Cut A (s1): direct, approved, com pacote + thumbnail, editado com silêncio reduzindo para 55 s
    let (run_a, cand_a) = seed_candidate(t1, "direct", None, 1, 7, "Corte A Sugerido", Some("approved"));
    seed_packaging(run_a, 1, 7, "Título Empacotado A", "Descrição A");
    seed_thumbnail(run_a, 1, 7, 25_000_000, "user");
    let clip_a = with_writer(|c| {
        let doc = json!({
            "schemaVersion": 2,
            "revision": 1,
            "original": {"source_id": s1, "start_id": 1, "end_id": 7, "candidate_id": cand_a},
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
            "undo": [],
            "redo": []
        });
        c.execute(
            "INSERT INTO clip_edits(identity,document) VALUES (?1,?2)",
            (format!("candidate:{cand_a}"), doc.to_string()),
        )?;
        Ok(c.last_insert_rowid())
    })
    .unwrap();

    // Cut B (s1): transformed, approved, sem pacote, sem capa, roteiro pendente (1/2 aprovado), sem narração
    let (run_b, cand_b) = seed_candidate(
        t1,
        "transformed",
        None,
        2,
        4,
        "Corte B Transformado",
        Some("approved"),
    );
    seed_script(run_b, 2, 4, 1, 2);

    // Cortes NÃO aprovados (pending e rejected) não devem aparecer
    let (_run_p, cand_pending) = seed_candidate(t1, "direct", None, 5, 7, "Pendente", None);
    let (_run_r, cand_rejected) =
        seed_candidate(t1, "direct", None, 6, 8, "Rejeitado", Some("rejected"));

    // Cut E (s2 offline): transformed, approved, roteiro aprovado (2/2) + narração TTS + áudio sem licença + > 60s
    let (run_e, cand_e) = seed_candidate(
        t2,
        "transformed",
        None,
        1,
        8,
        "Corte E Offline Completo",
        Some("approved"),
    );
    let e_blocks = seed_script(run_e, 1, 8, 2, 2);
    seed_tts_wav(&project_dir, cand_e, e_blocks[0], "13063");
    seed_tts_wav(&project_dir, cand_e, e_blocks[1], "13063");
    seed_packaging(run_e, 1, 8, "Empacotado E", "Descrição E");
    seed_thumbnail(run_e, 1, 8, 15_000_000, "provider");
    with_writer(|c| {
        c.execute(
            "INSERT INTO audio_assets(kind,name,audio_rel_path,duration_us,sample_rate,channels,bytes,sha256,license_kind,license_attribution)
             VALUES ('music','Trilha','audio/trilha.wav',10000000,48000,2,1024,'h','unknown','')",
            [],
        )?;
        let asset_id = c.last_insert_rowid();
        let doc = json!({
            "schemaVersion": 2,
            "revision": 1,
            "original": {"source_id": s2, "start_id": 1, "end_id": 8, "candidate_id": cand_e},
            "range": {"startId": 1, "endId": 8, "startUs": 0, "endUs": 80_000_000},
            "soundtrack": {"assetId": asset_id, "startUs": 0, "volume": 0.3},
            "sfx": [],
            "undo": [],
            "redo": []
        });
        c.execute(
            "INSERT INTO clip_edits(identity,document) VALUES (?1,?2)",
            (format!("candidate:{cand_e}"), doc.to_string()),
        )?;
        Ok(())
    })
    .unwrap();

    // Cut F (s2 offline): direct, approved, sem pacote/capa, nunca aberto no editor (clipId null)
    let (_run_f, cand_f) = seed_candidate(t2, "direct", None, 3, 5, "Corte F Direto", Some("approved"));

    // Fonte 3 (changed: arquivo alterado no disco após importação) com gravação de voz (sem TTS)
    let media3 = guard.root().join("live-changed.mp4");
    let (s3, t3) = seed_source(&media3, 8, json!({"status": "none"}), true);
    fs::write(&media3, b"different-content-size-changed").unwrap();
    let (run_g, cand_g) = seed_candidate(
        t3,
        "transformed",
        None,
        1,
        3,
        "Corte G Gravado",
        Some("approved"),
    );
    let g_blocks = seed_script(run_g, 1, 3, 1, 1);
    let rel_g = format!("narrations/c{cand_g}/b{}.wav", g_blocks[0]);
    let full_g = project_dir.join(&rel_g);
    fs::create_dir_all(full_g.parent().unwrap()).unwrap();
    fs::write(&full_g, b"RIFF0000WAVEfmt ").unwrap();
    with_writer(|c| {
        let ver_id: i64 = c.query_row(
            "SELECT id FROM script_block_versions WHERE block_id=?1 ORDER BY id DESC LIMIT 1",
            [g_blocks[0]],
            |r| r.get(0),
        )?;
        c.execute(
            "INSERT INTO narration_blocks(block_id,version_id,voice_id,model_id,engine_id,audio_rel_path,duration_us,sample_rate,channels,bytes,sha256)
             VALUES (?1,?2,'recorded','silero-vad','recorded',?3,2500000,24000,1,16,'rec')",
            (g_blocks[0], ver_id, rel_g),
        )?;
        // Job de empacotamento concluído mas ainda não materializado em packaging_generations.generated
        c.execute(
            "INSERT INTO jobs(kind,safety,state,progress,result) VALUES ('ai:packaging','local','completed',100,?1)",
            [json!({
                "outcome": "ok",
                "data": {
                    "title": "Pacote Não Materializado G",
                    "description": "Desc G",
                    "tags": ["g"],
                    "hashtags": ["#g"]
                }
            })
            .to_string()],
        )?;
        let pkg_job = c.last_insert_rowid();
        c.execute(
            "INSERT INTO packaging_generations(job_id,run_id,cand_start_id,cand_end_id,language,task_version,prompt_sha256,profile,generated)
             VALUES (?1,?2,1,3,'pt-BR',1,'h','local',NULL)",
            (pkg_job, run_g),
        )?;
        Ok(())
    })
    .unwrap();

    // 1) Chamada única retorna todos os 5 aprovados (e nenhum não-aprovado)
    let all = call("export.readiness", json!({}));
    assert_eq!(all["total"], 5);
    assert_eq!(all["offset"], 0);
    assert!(all["limit"].is_null());
    assert_eq!(all["hasMore"], false);

    let items = all["items"].as_array().unwrap();
    assert_eq!(items.len(), 5);
    let ids: Vec<i64> = items
        .iter()
        .map(|it| it["candidateId"].as_i64().unwrap())
        .collect();
    assert!(!ids.contains(&cand_pending));
    assert!(!ids.contains(&cand_rejected));
    assert_eq!(ids, vec![cand_a, cand_b, cand_e, cand_f, cand_g]);

    // Cut A assertions
    let item_a = &items[0];
    assert_eq!(item_a["clipId"], clip_a);
    assert_eq!(item_a["videoKind"], "direct");
    assert_eq!(item_a["durationUs"], 55_000_000);
    assert_eq!(item_a["source"]["id"], s1);
    assert_eq!(item_a["source"]["status"], "available");
    assert_eq!(item_a["source"]["available"], true);
    assert_eq!(item_a["source"]["online"], true);
    assert_eq!(item_a["packaging"]["ready"], true);
    assert_eq!(item_a["packaging"]["current"]["title"], "Título Empacotado A");
    assert_eq!(item_a["thumbnail"]["ready"], true);
    assert_eq!(item_a["thumbnail"]["current"]["instantUs"], 25_000_000);
    assert_eq!(item_a["thumbnail"]["current"]["origin"], "user");
    assert_eq!(item_a["script"]["applicable"], false);
    assert_eq!(item_a["narration"]["applicable"], false);
    assert_eq!(item_a["guardrails"]["over60s"], false);
    assert_eq!(item_a["guardrails"]["needsDirectNotice"], true);
    assert_eq!(item_a["guardrails"]["permission"]["status"], "granted");

    // Cut B assertions (transformed, sem pacote/capa, roteiro pendente, sem narração)
    let item_b = &items[1];
    assert!(item_b["clipId"].is_null());
    assert_eq!(item_b["videoKind"], "transformed");
    assert_eq!(item_b["packaging"]["ready"], false);
    assert!(item_b["packaging"]["current"].is_null());
    assert_eq!(item_b["thumbnail"]["ready"], false);
    assert!(item_b["thumbnail"]["current"].is_null());
    assert_eq!(item_b["script"]["applicable"], true);
    assert_eq!(item_b["script"]["exists"], true);
    assert_eq!(item_b["script"]["approved"], false);
    assert_eq!(item_b["script"]["pendingBlocks"], 1);
    assert_eq!(item_b["script"]["totalBlocks"], 2);
    assert_eq!(item_b["narration"]["applicable"], true);
    assert_eq!(item_b["narration"]["hasTts"], false);
    assert_eq!(item_b["narration"]["generatedBlocks"], 0);
    assert_eq!(item_b["narration"]["readyBlocks"], 0);
    assert_eq!(item_b["narration"]["ready"], false);
    assert_eq!(item_b["narration"]["totalBlocks"], 2);

    // Cut E assertions (offline, transformed completo, áudio sem licença, >60s)
    let item_e = &items[2];
    assert_eq!(item_e["source"]["id"], s2);
    assert_eq!(item_e["source"]["status"], "offline");
    assert_eq!(item_e["source"]["available"], false);
    assert_eq!(item_e["source"]["online"], false);
    assert_eq!(item_e["script"]["applicable"], true);
    assert_eq!(item_e["script"]["approved"], true);
    assert_eq!(item_e["script"]["pendingBlocks"], 0);
    assert_eq!(item_e["narration"]["applicable"], true);
    assert_eq!(item_e["narration"]["hasTts"], true);
    assert_eq!(item_e["narration"]["generatedBlocks"], 2);
    assert_eq!(item_e["narration"]["readyBlocks"], 2);
    assert_eq!(item_e["narration"]["ready"], true);
    assert_eq!(item_e["guardrails"]["over60s"], true);
    assert_eq!(item_e["guardrails"]["permission"]["status"], "none");
    assert_eq!(item_e["guardrails"]["audio"]["hasAudio"], true);
    assert_eq!(item_e["guardrails"]["audio"]["unverifiedCount"], 1);

    // Cut F assertions (direct, sem pacote/capa, offline, sem clip_edits)
    let item_f = &items[3];
    assert!(item_f["clipId"].is_null());
    assert_eq!(item_f["videoKind"], "direct");
    assert_eq!(item_f["source"]["online"], false);
    assert_eq!(item_f["packaging"]["ready"], false);
    assert_eq!(item_f["thumbnail"]["ready"], false);
    assert_eq!(item_f["script"]["applicable"], false);
    assert_eq!(item_f["narration"]["applicable"], false);

    // Cut G assertions (Fonte changed, gravação de voz sem TTS, pacote lido em memória sem gravar)
    let item_g = &items[4];
    assert_eq!(item_g["source"]["id"], s3);
    assert_eq!(item_g["source"]["status"], "changed");
    assert_eq!(item_g["source"]["available"], false);
    assert_eq!(item_g["source"]["online"], false);
    assert_eq!(item_g["packaging"]["ready"], true);
    assert_eq!(
        item_g["packaging"]["current"]["title"],
        "Pacote Não Materializado G"
    );
    assert_eq!(item_g["narration"]["applicable"], true);
    assert_eq!(item_g["narration"]["hasTts"], false);
    assert_eq!(item_g["narration"]["generatedBlocks"], 0);
    assert_eq!(item_g["narration"]["readyBlocks"], 1);
    assert_eq!(item_g["narration"]["ready"], true);

    // 2) Filtro por source_id e sourceId
    let only_s1 = call("export.readiness", json!({ "source_id": s1 }));
    assert_eq!(only_s1["total"], 2);
    assert_eq!(
        only_s1["items"]
            .as_array()
            .unwrap()
            .iter()
            .map(|x| x["candidateId"].as_i64().unwrap())
            .collect::<Vec<_>>(),
        vec![cand_a, cand_b]
    );
    let only_s2 = call("export.readiness", json!({ "sourceId": s2 }));
    assert_eq!(only_s2["total"], 2);
    assert_eq!(
        only_s2["items"]
            .as_array()
            .unwrap()
            .iter()
            .map(|x| x["candidateId"].as_i64().unwrap())
            .collect::<Vec<_>>(),
        vec![cand_e, cand_f]
    );
    fail("export.readiness", json!({ "source_id": 999_999 }), "source_missing");
    fail(
        "export.readiness",
        json!({ "source_id": s1, "sourceId": s2 }),
        "invalid_input",
    );

    // 3) Paginação (limit/offset)
    let page1 = call("export.readiness", json!({ "limit": 2, "offset": 0 }));
    assert_eq!(page1["total"], 5);
    assert_eq!(page1["limit"], 2);
    assert_eq!(page1["offset"], 0);
    assert_eq!(page1["hasMore"], true);
    assert_eq!(page1["items"].as_array().unwrap().len(), 2);
    assert_eq!(page1["items"][0]["candidateId"], cand_a);
    assert_eq!(page1["items"][1]["candidateId"], cand_b);

    let page2 = call("export.readiness", json!({ "limit": 2, "offset": 2 }));
    assert_eq!(page2["total"], 5);
    assert_eq!(page2["hasMore"], true);
    assert_eq!(page2["items"].as_array().unwrap().len(), 2);
    assert_eq!(page2["items"][0]["candidateId"], cand_e);
    assert_eq!(page2["items"][1]["candidateId"], cand_f);

    let page3 = call("export.readiness", json!({ "limit": 2, "offset": 4 }));
    assert_eq!(page3["total"], 5);
    assert_eq!(page3["hasMore"], false);
    assert_eq!(page3["items"].as_array().unwrap().len(), 1);
    assert_eq!(page3["items"][0]["candidateId"], cand_g);

    let past = call("export.readiness", json!({ "limit": 2, "offset": 10 }));
    assert_eq!(past["total"], 5);
    assert_eq!(past["hasMore"], false);
    assert_eq!(past["items"].as_array().unwrap().len(), 0);

    fail("export.readiness", json!({ "limit": -1 }), "invalid_input");
    fail("export.readiness", json!({ "offset": -1 }), "invalid_input");

    // 4) Somente leitura: data_version do SQLite e packaging_generations.generated não mudam
    let dv_before: i64 =
        with_reader(|c| c.query_row("PRAGMA data_version", [], |r| r.get(0))).unwrap();
    let _ = call("export.readiness", json!({}));
    let dv_after: i64 =
        with_reader(|c| c.query_row("PRAGMA data_version", [], |r| r.get(0))).unwrap();
    assert_eq!(dv_before, dv_after);
    let still_unmaterialized: Option<String> = with_reader(|c| {
        c.query_row(
            "SELECT generated FROM packaging_generations WHERE run_id=?1",
            [run_g],
            |r| r.get(0),
        )
    })
    .unwrap();
    assert!(still_unmaterialized.is_none());
}

#[test]
fn works_with_v1_project_without_clip_edits() {
    let guard = SessionGuard::new();
    let _dir = guard.open_v1_fixture("ProjetoV1");

    // Garante que a tabela clip_edits está vazia na fixture V1 e aprova um candidato se não houver
    let clip_edits_count: i64 =
        with_reader(|c| c.query_row("SELECT COUNT(*) FROM clip_edits", [], |r| r.get(0))).unwrap();
    assert_eq!(clip_edits_count, 0);

    let before = call("export.readiness", json!({}));
    if before["total"].as_u64() == Some(0) {
        let first_cand: Option<i64> = with_reader(|c| {
            c.query_row("SELECT id FROM selection_candidates ORDER BY id LIMIT 1", [], |r| r.get(0))
        })
        .ok();
        if let Some(cid) = first_cand {
            call("selection.decide", json!({ "candidate": cid, "decision": "approved" }));
            let after = call("export.readiness", json!({}));
            assert_eq!(after["total"], 1);
            assert!(after["items"][0]["clipId"].is_null());
            assert_eq!(after["items"][0]["candidateId"], cid);
            return;
        }
    }
    assert!(before["total"].as_u64().is_some());
    assert!(before["items"].is_array());
}
