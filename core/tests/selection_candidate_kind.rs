//! Conversão individual de Corte direto em Vídeo transformado (#292), headless e sem rede.
use clipes_core::{
    dispatch,
    projects::{with_reader, with_writer, Migration},
    CoreError,
};
use rusqlite::Connection;
use serde_json::{json, Value};
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

fn fail(name: &str, args: Value) -> CoreError {
    dispatch(name, args, &mut |_| {}).unwrap_err()
}

fn seed_direct_run_with_two_candidates() -> (i64, i64, i64, i64) {
    with_writer(|c| {
        c.execute(
            "INSERT INTO sources(path,size,duration_us,partial_hash,metadata,permission,audio_track)
             VALUES ('C:/videos/live.mp4',1,120000000,'h1','{}','{}',0)",
            [],
        )?;
        let source = c.last_insert_rowid();
        c.execute(
            "INSERT INTO transcripts(source_id,audio_track,engine,model,revision,compute_type,state,resume_us,duration_us)
             VALUES (?1,0,'local','m','r','c','complete',120000000,120000000)",
            [source],
        )?;
        let transcript = c.last_insert_rowid();
        for s in 1..=12_i64 {
            let p0 = (s - 1) * 2;
            let s0 = (s - 1) * 10_000_000;
            c.execute(
                "INSERT INTO transcript_words(transcript_id,position,kind,text,start_us,end_us,language)
                 VALUES (?1,?2,'word',' palavra',?3,?4,'pt')",
                (transcript, p0, s0, s0 + 4_000_000),
            )?;
            c.execute(
                "INSERT INTO transcript_words(transcript_id,position,kind,text,start_us,end_us,language)
                 VALUES (?1,?2,'word',' fim.',?3,?4,'pt')",
                (transcript, p0 + 1, s0 + 4_500_000, s * 10_000_000),
            )?;
        }
        c.execute(
            "INSERT INTO selection_runs(transcript_id,task_version,prompt_sha256,profile,state,batch,min_us,max_us,weights,plan_state,windows_total,video_kind)
             VALUES (?1,3,'h','legacy','completed','',20000000,180000000,'[]','full',1,'direct')",
            [transcript],
        )?;
        let run = c.last_insert_rowid();
        c.execute(
            "INSERT INTO selection_candidates(run_id,rank,start_id,end_id,start_us,end_us,axes,total_centi,title,windows)
             VALUES (?1,0,1,3,0,30000000,'{}',900,'Primeiro Corte','[0]')",
            [run],
        )?;
        let cand_a = c.last_insert_rowid();
        c.execute(
            "INSERT INTO selection_candidates(run_id,rank,start_id,end_id,start_us,end_us,axes,total_centi,title,windows)
             VALUES (?1,1,6,9,50000000,90000000,'{}',800,'Segundo Corte','[0]')",
            [run],
        )?;
        let cand_b = c.last_insert_rowid();
        Ok((source, run, cand_a, cand_b))
    })
    .unwrap()
}

fn review_item(review: &Value, candidate: i64) -> Value {
    review["items"]
        .as_array()
        .unwrap()
        .iter()
        .find(|i| i["candidate"] == candidate)
        .unwrap()
        .clone()
}

#[test]
fn converting_one_direct_candidate_enables_transformed_chain_only_for_it() {
    let guard = SessionGuard::new();
    let project_path = guard.create_project("CanalConversao");
    let (source, run, cand_a, cand_b) = seed_direct_run_with_two_candidates();
    call("transcription.segment", json!({ "source_id": source }));
    call(
        "provider.configure",
        json!({ "endpoint": "http://127.0.0.1:9/v1", "kind": "openai", "model": "fake", "context": 32768 }),
    );
    call(
        "selection.decide",
        json!({ "candidate": cand_a, "decision": "approved" }),
    );
    call(
        "selection.decide",
        json!({ "candidate": cand_b, "decision": "approved" }),
    );

    // Antes da conversão: ambos são Corte direto e recusam Ângulos, Roteiro e Narração.
    let review_before = call("selection.review", json!({ "run": run }));
    assert_eq!(review_item(&review_before, cand_a)["videoKind"], "direct");
    assert_eq!(review_item(&review_before, cand_b)["videoKind"], "direct");

    for cand in [cand_a, cand_b] {
        let g = call(
            "guardrails.check",
            json!({ "source_id": source, "candidate_id": cand }),
        );
        assert_eq!(g["videoKind"], "direct");
        assert_eq!(g["needsDirectNotice"], true);
        assert_eq!(g["script"]["applicable"], false);
        assert_eq!(g["narration"]["applicable"], false);

        for cmd in [
            "angles.get",
            "angles.estimate",
            "script.get",
            "script.estimate",
            "script.narration_allowed",
            "narration.get",
        ] {
            assert_eq!(
                fail(cmd, json!({ "candidate": cand })).code,
                "script_requires_transformed",
                "{cmd} antes da conversão"
            );
        }
        assert_eq!(
            fail(
                "captions.track.set",
                json!({ "candidate_id": cand, "track": "narration" }),
            )
            .code,
            "script_requires_transformed"
        );
        assert_eq!(
            call("packaging.get", json!({ "candidate": cand }))["chapters"]["applicable"],
            false
        );
    }

    // Converte só `cand_a` para Vídeo transformado.
    let converted = call(
        "selection.candidate.set_kind",
        json!({ "candidate": cand_a, "videoKind": "transformed" }),
    );
    assert_eq!(converted["videoKind"], "transformed");
    assert_eq!(converted["item"]["candidate"], cand_a);
    assert_eq!(converted["item"]["videoKind"], "transformed");

    // `selection.review` e `guardrails.check` refletem `transformed` só no convertido.
    let review_after = call("selection.review", json!({ "run": run }));
    assert_eq!(
        review_item(&review_after, cand_a)["videoKind"],
        "transformed"
    );
    assert_eq!(review_item(&review_after, cand_b)["videoKind"], "direct");

    let g_a = call(
        "guardrails.check",
        json!({ "source_id": source, "candidate_id": cand_a }),
    );
    assert_eq!(g_a["videoKind"], "transformed");
    assert_eq!(g_a["needsDirectNotice"], false);
    assert_eq!(g_a["hasDirect"], false);
    assert_eq!(g_a["hasTransformed"], true);
    assert_eq!(g_a["script"]["applicable"], true);
    assert_eq!(g_a["narration"]["applicable"], true);

    let g_b = call(
        "guardrails.check",
        json!({ "source_id": source, "candidate_id": cand_b }),
    );
    assert_eq!(g_b["videoKind"], "direct");
    assert_eq!(g_b["needsDirectNotice"], true);
    assert_eq!(g_b["script"]["applicable"], false);
    assert_eq!(g_b["narration"]["applicable"], false);

    let g_project = call("guardrails.check", json!({ "scope": "project" }));
    assert_eq!(g_project["videoKind"], "mixed");
    assert_eq!(g_project["hasDirect"], true);
    assert_eq!(g_project["hasTransformed"], true);
    assert_eq!(g_project["needsDirectNotice"], true);
    assert_eq!(g_project["script"]["transformedCount"], 1);

    // `angles.*`, `script.*`, `narration.*`, `captions.track.set` e capítulos destravam só em `cand_a`.
    assert!(call("angles.get", json!({ "candidate": cand_a })).is_object());
    assert!(call("angles.estimate", json!({ "candidate": cand_a })).is_object());
    let chosen = call(
        "angles.choose",
        json!({
            "candidate": cand_a,
            "angle": { "name": "Contexto", "promise": "Explica o contexto da jogada." }
        }),
    );
    assert_eq!(chosen["selected"]["name"], "Contexto");
    assert!(call("script.estimate", json!({ "candidate": cand_a })).is_object());
    let script_doc = call("script.get", json!({ "candidate": cand_a }));
    assert_eq!(script_doc["angle"]["name"], "Contexto");
    let nar_doc = call("narration.get", json!({ "candidate": cand_a }));
    assert!(nar_doc.is_object());
    assert_eq!(
        call("packaging.get", json!({ "candidate": cand_a }))["chapters"]["applicable"],
        true
    );
    let track = call(
        "captions.track.set",
        json!({ "candidate_id": cand_a, "track": "narration" }),
    );
    assert_eq!(track["track"], "narration");

    // `cand_b` continua bloqueado como Corte direto.
    for cmd in [
        "angles.get",
        "angles.estimate",
        "script.get",
        "script.estimate",
        "script.narration_allowed",
        "narration.get",
    ] {
        assert_eq!(
            fail(cmd, json!({ "candidate": cand_b })).code,
            "script_requires_transformed",
            "{cmd} em cand_b após conversão de cand_a"
        );
    }
    assert_eq!(
        fail(
            "captions.track.set",
            json!({ "candidate_id": cand_b, "track": "narration" }),
        )
        .code,
        "script_requires_transformed"
    );
    assert_eq!(
        call("packaging.get", json!({ "candidate": cand_b }))["chapters"]["applicable"],
        false
    );

    // Persiste ao fechar e reabrir o Projeto.
    call("projects.close", json!({}));
    call("projects.open", json!({ "path": project_path }));
    let review_reopened = call("selection.review", json!({ "run": run }));
    assert_eq!(
        review_item(&review_reopened, cand_a)["videoKind"],
        "transformed"
    );
    assert_eq!(review_item(&review_reopened, cand_b)["videoKind"], "direct");
    assert!(call("angles.get", json!({ "candidate": cand_a })).is_object());
    assert_eq!(
        fail("script.get", json!({ "candidate": cand_b })).code,
        "script_requires_transformed"
    );

    // Convertendo o segundo também, o lote todo vira `transformed` e não exige mais `ack_direct_notice`.
    call(
        "selection.candidate.set_kind",
        json!({ "candidate": cand_b, "videoKind": "transformed" }),
    );
    let g_all = call("guardrails.check", json!({ "scope": "project" }));
    assert_eq!(g_all["videoKind"], "transformed");
    assert_eq!(g_all["hasDirect"], false);
    assert_eq!(g_all["needsDirectNotice"], false);
}

#[test]
fn set_kind_is_idempotent_and_rejects_unknown_candidate_or_invalid_video_kind() {
    let guard = SessionGuard::new();
    guard.create_project("CanalErros");
    let (_, run, cand_a, _) = seed_direct_run_with_two_candidates();

    // Idempotente após a primeira conversão.
    let first = call(
        "selection.candidate.set_kind",
        json!({ "candidate": cand_a, "videoKind": "transformed" }),
    );
    let second = call(
        "selection.candidate.set_kind",
        json!({ "candidate": cand_a, "videoKind": "transformed" }),
    );
    assert_eq!(first["videoKind"], "transformed");
    assert_eq!(second["videoKind"], "transformed");
    assert_eq!(second["item"]["videoKind"], "transformed");

    // Candidato inexistente.
    assert_eq!(
        fail(
            "selection.candidate.set_kind",
            json!({ "candidate": 999_999, "videoKind": "transformed" }),
        )
        .code,
        "candidate_not_found"
    );
    assert_eq!(
        fail(
            "selection.candidate.set_kind",
            json!({ "candidate": "abc", "videoKind": "transformed" }),
        )
        .code,
        "candidate_not_found"
    );

    // Valor inválido ou `"direct"` (voltar para direto está fora do ticket).
    for bad in [json!("direct"), json!("dark"), json!(null), json!(42)] {
        assert_eq!(
            fail(
                "selection.candidate.set_kind",
                json!({ "candidate": cand_a, "videoKind": bad }),
            )
            .code,
            "invalid_video_kind",
            "videoKind={bad}"
        );
    }

    // Execução que já nasceu `transformed` também é idempotente.
    let cand_t = with_writer(|c| {
        let transcript_id: i64 = c.query_row(
            "SELECT transcript_id FROM selection_runs WHERE id=?1",
            [run],
            |r| r.get(0),
        )?;
        c.execute(
            "INSERT INTO selection_runs(transcript_id,task_version,prompt_sha256,profile,state,batch,min_us,max_us,weights,plan_state,windows_total,video_kind)
             VALUES (?1,2,'h','legacy','completed','',20000000,180000000,'[]','full',1,'transformed')",
            [transcript_id],
        )?;
        let r2 = c.last_insert_rowid();
        c.execute(
            "INSERT INTO selection_candidates(run_id,rank,start_id,end_id,start_us,end_us,axes,total_centi,title,windows)
             VALUES (?1,0,1,3,0,30000000,'{}',900,'Já Transformado','[0]')",
            [r2],
        )?;
        Ok(c.last_insert_rowid())
    })
    .unwrap();
    let idem = call(
        "selection.candidate.set_kind",
        json!({ "candidate": cand_t, "videoKind": "transformed" }),
    );
    assert_eq!(idem["videoKind"], "transformed");
}

#[test]
fn v1_project_migrates_without_override_and_preserves_direct_behavior() {
    let guard = SessionGuard::new();

    // 1. Fixture real V1 (pre-0104) abre e migra sem erro.
    let fixture_dir = guard.root().join("FixtureV1.clipes");
    fs::create_dir_all(&fixture_dir).unwrap();
    fs::write(fixture_dir.join("project.sqlite"), V1_FIXTURE).unwrap();
    call("projects.open", json!({ "path": fixture_dir }));
    call("projects.close", json!({}));

    // 2. Projeto V1 com seleção direta existente antes da migração `0292_001_candidate_video_kind`.
    let legacy_dir = guard.root().join("LegadoDirect.clipes");
    fs::create_dir_all(&legacy_dir).unwrap();
    let conn = Connection::open(legacy_dir.join("project.sqlite")).unwrap();
    conn.execute_batch("CREATE TABLE schema_migrations(id TEXT PRIMARY KEY NOT NULL)")
        .unwrap();
    let mut migrations: Vec<_> = inventory::iter::<Migration>
        .into_iter()
        .filter(|m| m.id != "0292_001_candidate_video_kind")
        .collect();
    migrations.sort_by_key(|m| m.id);
    for migration in migrations {
        conn.execute_batch(migration.sql).unwrap();
        conn.execute("INSERT INTO schema_migrations VALUES (?1)", [migration.id])
            .unwrap();
    }
    conn.execute_batch(
        r#"
INSERT INTO project(name) VALUES ('LegadoDirect');
INSERT INTO sources(id,path,size,duration_us,partial_hash,metadata,permission,audio_track)
 VALUES (1,'C:/videos/v1.mp4',1,60000000,'h','{}','{}',0);
INSERT INTO transcripts(id,source_id,audio_track,engine,model,revision,compute_type,state,resume_us,duration_us)
 VALUES (1,1,0,'local','m','r','c','complete',60000000,60000000);
INSERT INTO sentences(transcript_id,id,first_position,last_position,start_us,end_us,language,text)
 VALUES
  (1,1,0,1,0,20000000,'pt','Primeira fala.'),
  (1,2,2,3,20000000,40000000,'pt','Segunda fala.'),
  (1,3,4,5,40000000,60000000,'pt','Terceira fala.');
INSERT INTO selection_runs(id,transcript_id,task_version,prompt_sha256,profile,state,batch,min_us,max_us,weights,plan_state,windows_total,video_kind)
 VALUES (1,1,3,'h','legacy','completed','selection-1',20000000,60000000,'[]','full',1,'direct');
INSERT INTO selection_candidates(id,run_id,rank,start_id,end_id,start_us,end_us,axes,total_centi,title,windows)
 VALUES (1,1,0,1,2,0,40000000,'{}',900,'Corte V1','[0]');
INSERT INTO selection_decisions(run_id,cand_start_id,cand_end_id,decision,before_start_id,before_end_id,after_start_id,after_end_id)
 VALUES (1,1,2,'approved',1,2,1,2);
"#,
    )
    .unwrap();
    drop(conn);

    call("projects.open", json!({ "path": legacy_dir }));
    let override_col: Option<String> = with_reader(|c| {
        c.query_row(
            "SELECT video_kind FROM selection_candidates WHERE id=1",
            [],
            |r| r.get(0),
        )
    })
    .unwrap();
    assert_eq!(override_col, None);

    let review = call("selection.review", json!({ "run": 1 }));
    assert_eq!(review_item(&review, 1)["videoKind"], "direct");
    let g = call(
        "guardrails.check",
        json!({ "source_id": 1, "candidate_id": 1 }),
    );
    assert_eq!(g["videoKind"], "direct");
    assert_eq!(g["needsDirectNotice"], true);
    assert_eq!(
        fail("script.get", json!({ "candidate": 1 })).code,
        "script_requires_transformed"
    );
}
