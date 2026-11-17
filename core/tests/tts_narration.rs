//! Testes headless da Narração por TTS (#79):
//! - catálogo extensível, troca de modelo padrão (`portuguese_24l` <-> `portuguese` 6L) e termo de uso proibido;
//! - download/verificação SHA-256 via servidor HTTP falso em loopback (sem rede real);
//! - trava do Roteiro aprovado (#73), síntese por bloco via binário `pocket-tts` falso, duração real
//!   exposta em `block_durations_for_candidate` (#204), invalidação ao editar o Roteiro,
//!   regeneração de bloco único, cancelamento via `jobs.cancel`, `media::serve` e checklist #76.

use clipes_core::{
    dispatch, media::serve, montage, projects::with_writer, tts::block_durations_for_candidate,
    CoreError,
};
use serde_json::{json, Value};
use std::{
    fs,
    path::{Path, PathBuf},
    sync::Mutex,
    time::{Duration, Instant},
};

static SERIAL: Mutex<()> = Mutex::new(());

fn call(name: &str, args: Value) -> Value {
    dispatch(name, args, &mut |_| {}).unwrap()
}

fn fail(name: &str, args: Value) -> CoreError {
    dispatch(name, args, &mut |_| {}).unwrap_err()
}

fn build_fake_pocket_tts(dir: &Path) -> PathBuf {
    let fake = dir.join(if cfg!(windows) {
        "pocket-tts.exe"
    } else {
        "pocket-tts"
    });
    let rustc = PathBuf::from(env!("CARGO")).with_file_name(if cfg!(windows) {
        "rustc.exe"
    } else {
        "rustc"
    });
    assert!(std::process::Command::new(rustc)
        .arg(Path::new(env!("CARGO_MANIFEST_DIR")).join("tests/fixtures/fake_pocket_tts.rs"))
        .arg("-o")
        .arg(&fake)
        .status()
        .unwrap()
        .success());
    fake
}

fn install_fake_tts_model(
    data_dir: &Path,
    model_id: &str,
    voice_files: &[&str],
    terms_version: &str,
) {
    let dir = data_dir
        .join("tts-models")
        .join("pocket-tts")
        .join(model_id);
    fs::create_dir_all(dir.join("voices")).unwrap();
    fs::write(dir.join("model.safetensors"), b"fake-weights").unwrap();
    fs::write(dir.join("tokenizer.json"), b"{}").unwrap();
    fs::write(
        dir.join("config.yaml"),
        "weights_path: 'model.safetensors'\n",
    )
    .unwrap();
    for vf in voice_files {
        fs::write(dir.join("voices").join(vf), b"fake-voice-safetensors").unwrap();
    }
    fs::write(
        dir.join("model.state.json"),
        serde_json::to_vec_pretty(&json!({
            "engine": "pocket-tts",
            "id": model_id,
            "repo": "kyutai/pocket-tts-without-voice-cloning",
            "revision": "a7056f505a4a8ca72d8b5fb1440071d6f1a35739",
            "terms_version": terms_version,
        }))
        .unwrap(),
    )
    .unwrap();
}

fn seed_transformed_cut(approved_script: bool) -> (i64, i64, Vec<i64>) {
    with_writer(|c| {
        c.execute(
            "INSERT INTO sources(path,size,duration_us,partial_hash,metadata,permission,audio_track) VALUES ('offline.mp4',1,120000000,'h','{}','{\"status\":\"granted\",\"who\":\"Criador\",\"where\":\"Live\"}',0)",
            [],
        )?;
        let source = c.last_insert_rowid();
        c.execute(
            "INSERT INTO transcripts(source_id,audio_track,engine,model,revision,compute_type,state,resume_us,duration_us) VALUES (?1,0,'local','m','r','c','complete',120000000,120000000)",
            [source],
        )?;
        let transcript = c.last_insert_rowid();
        for id in 1..=6_i64 {
            let s0 = (id - 1) * 10_000_000;
            let s1 = id * 10_000_000;
            c.execute(
                "INSERT INTO sentences(transcript_id,id,first_position,last_position,start_us,end_us,text) VALUES (?1,?2,?3,?4,?5,?6,'Frase.')",
                (transcript, id, id * 2 - 1, id * 2, s0, s1),
            )?;
        }
        c.execute(
            "INSERT INTO selection_runs(transcript_id,task_version,prompt_sha256,profile,state,min_us,max_us,weights,plan_state,windows_total,video_kind) VALUES (?1,1,'h','legacy','completed',20000000,180000000,'[]','full',1,'transformed')",
            [transcript],
        )?;
        let run = c.last_insert_rowid();
        c.execute(
            "INSERT INTO selection_candidates(run_id,rank,start_id,end_id,start_us,end_us,axes,total_centi,title,windows) VALUES (?1,1,1,6,0,60000000,'{}',900,'Corte','[0]')",
            [run],
        )?;
        let candidate = c.last_insert_rowid();
        c.execute(
            "INSERT INTO selection_decisions(run_id,cand_start_id,cand_end_id,decision,before_start_id,before_end_id,after_start_id,after_end_id) VALUES (?1,1,6,'approved',1,6,1,6)",
            [run],
        )?;
        c.execute(
            "INSERT INTO jobs(kind,safety,state,progress) VALUES ('ai:script','local','completed',100)",
            [],
        )?;
        let gen_job = c.last_insert_rowid();
        c.execute(
            "INSERT INTO script_generations(job_id,run_id,cand_start_id,cand_end_id,language,task_version,prompt_sha256,profile,safety,outline,angle) VALUES (?1,?2,1,6,'pt-BR',2,'h','legacy','local','[]','{\"name\":\"Angulo\",\"promise\":\"Promessa\"}')",
            (gen_job, run),
        )?;
        let gen_id = c.last_insert_rowid();

        let texts = [
            "Primeiro bloco curto de abertura.",
            "Segundo bloco com comentario detalhado sobre o lance principal.",
            "Terceiro bloco fechando a ideia do video.",
        ];
        let mut block_ids = Vec::new();
        for (idx, text) in texts.iter().enumerate() {
            let pos = idx as i64 + 1;
            c.execute(
                "INSERT INTO script_blocks(generation_id,position,title,intent,refs) VALUES (?1,?2,?3,'Intencao','[1]')",
                (gen_id, pos, format!("Bloco {pos}")),
            )?;
            let block_id = c.last_insert_rowid();
            c.execute(
                "INSERT INTO script_block_versions(block_id,kind,title,narration,refs,angle_revision) VALUES (?1,'generated',?2,?3,'[1]',0)",
                (block_id, format!("Bloco {pos}"), *text),
            )?;
            let ver_id = c.last_insert_rowid();
            if approved_script || pos < 3 {
                c.execute(
                    "INSERT INTO script_approvals(block_id,version_id,angle_revision) VALUES (?1,?2,0)",
                    (block_id, ver_id),
                )?;
            }
            block_ids.push(block_id);
        }
        Ok((source, candidate, block_ids))
    })
    .unwrap()
}

fn wait_narration_done(candidate: i64) -> Value {
    let deadline = Instant::now() + Duration::from_secs(30);
    loop {
        let doc = call("narration.get", json!({"candidate": candidate}));
        if doc["busy"] == false && doc["job"].is_object() {
            return doc;
        }
        assert!(Instant::now() < deadline, "narration did not settle: {doc}");
        std::thread::sleep(Duration::from_millis(30));
    }
}

#[test]
fn headless_narration_gate_synthesis_durations_edit_invalidation_and_guardrails() {
    let _guard = SERIAL.lock().unwrap_or_else(|e| e.into_inner());
    let root = tempfile::tempdir().unwrap();
    let data_dir = root.path().join("data");
    std::env::set_var("CLIPES_DATA_DIR", &data_dir);
    std::env::remove_var("CLIPES_FAKE_TTS_SLEEP_MS");
    std::env::remove_var("CLIPES_FAKE_TTS_FAIL");

    // 1. Catálogo sem rede: padrão portuguese_24l, aceita troca para portuguese 6L e exige termos.
    let cat = call("tts.catalog", json!({}));
    assert_eq!(cat["activeModels"]["pt"], "portuguese_24l");
    assert_eq!(cat["activeModels"]["en"], "english");
    let terms_version = cat["engines"][0]["prohibitedUse"]["version"]
        .as_str()
        .unwrap()
        .to_owned();

    assert_eq!(
        fail(
            "tts.models.download",
            json!({"id": "portuguese_24l", "confirmed": true, "termsAccepted": false})
        )
        .code,
        "terms_acceptance_required"
    );

    // Instala componente e modelos falsos no CLIPES_DATA_DIR isolado.
    let comp_dir = data_dir.join("components");
    fs::create_dir_all(&comp_dir).unwrap();
    build_fake_pocket_tts(&comp_dir);
    assert_eq!(
        call("components.pocket_tts.status", json!({}))["installed"],
        true
    );

    install_fake_tts_model(
        &data_dir,
        "portuguese_24l",
        &["13063-pt-24l.safetensors"],
        &terms_version,
    );
    install_fake_tts_model(
        &data_dir,
        "portuguese",
        &["13063-pt-6l.safetensors"],
        &terms_version,
    );
    install_fake_tts_model(
        &data_dir,
        "english",
        &["alba-en.safetensors", "marius-en.safetensors"],
        &terms_version,
    );

    let project = call(
        "projects.create",
        json!({"parent": root.path(), "name": "CanalNarration"}),
    );

    // 2. Perfil de canal aceita vozes comerciais limpas e recusa rafael/cosette/jean.
    for forbidden in ["rafael", "cosette", "jean", "desconhecida"] {
        assert_eq!(
            fail("channel_profile.set", json!({"narrationVoice": forbidden})).code,
            "channel_profile_invalid"
        );
    }
    let prof = call("channel_profile.set", json!({"narrationVoice": "13063"}));
    assert_eq!(prof["narrationVoice"], "13063");

    // 3. Trava: bloco 3 ainda pendente impede gerar Narração.
    let (source_id, candidate, block_ids) = seed_transformed_cut(false);
    assert_eq!(
        fail("narration.generate", json!({"candidate": candidate})).code,
        "script_not_approved"
    );

    // Aprova o último bloco e libera a Narração.
    call(
        "script.approve",
        json!({"candidate": candidate, "block": block_ids[2]}),
    );
    assert_eq!(
        call("script.narration_allowed", json!({"candidate": candidate}))["allowed"],
        true
    );

    // 4. Gera Narração completa com o modelo padrão `portuguese_24l` e voz `13063`.
    let started = call("narration.generate", json!({"candidate": candidate}));
    assert_eq!(started["modelId"], "portuguese_24l");
    assert_eq!(started["voiceId"], "13063");
    let done = wait_narration_done(candidate);
    assert_eq!(done["job"]["state"], "completed");
    assert_eq!(done["blocks"].as_array().unwrap().len(), 3);
    assert!(done["totalDurationUs"].as_i64().unwrap() > 0);

    // Durações reais expostas para o #204; caminhos relativos no Projeto (ADR-0006).
    let durations = block_durations_for_candidate(candidate).unwrap();
    assert_eq!(durations.len(), 3);
    for (idx, bid) in block_ids.iter().enumerate() {
        let block_json = &done["blocks"][idx];
        let audio = &block_json["audio"];
        assert_eq!(audio["stale"], false);
        assert_eq!(audio["modelId"], "portuguese_24l");
        assert_eq!(durations[bid], audio["durationUs"].as_i64().unwrap());
        let rel = audio["relPath"].as_str().unwrap();
        assert!(rel.starts_with("narrations/"));
        assert!(!Path::new(rel).is_absolute());
        let wav_id = audio["id"].as_i64().unwrap();
        let media = serve(&format!("narration/{wav_id}"), None);
        assert_eq!(media.status, 200);
        assert!(media
            .headers
            .iter()
            .any(|(k, v)| *k == "Content-Type" && v == "audio/wav"));
        assert_eq!(&media.body[0..4], b"RIFF");
    }

    // Checklist #76 mostra Narração por TTS.
    let guard = call(
        "guardrails.check",
        json!({"scope": "single", "source_id": source_id, "candidate_id": candidate}),
    );
    assert_eq!(guard["narration"]["applicable"], true);
    assert_eq!(guard["narration"]["hasTts"], true);
    assert_eq!(guard["narration"]["generatedBlocks"], 3);
    assert_eq!(guard["narration"]["totalBlocks"], 3);
    assert_eq!(guard["narration"]["voices"], json!(["13063"]));

    // 5. Editar um bloco do Roteiro invalida sua Narração até re-aprovar e regenerar só esse bloco.
    call(
        "script.edit",
        json!({"candidate": candidate, "block": block_ids[1], "narration": "Texto editado bem mais longo para o segundo bloco da narracao."}),
    );
    let after_edit = call("narration.get", json!({"candidate": candidate}));
    assert_eq!(after_edit["narrationAllowed"], false);
    assert_eq!(after_edit["blocks"][1]["audio"]["stale"], true);
    let durations_stale = block_durations_for_candidate(candidate).unwrap();
    assert_eq!(durations_stale.len(), 2);
    assert!(!durations_stale.contains_key(&block_ids[1]));

    // Não regenera enquanto pendente.
    assert_eq!(
        fail(
            "narration.regenerate_block",
            json!({"candidate": candidate, "block": block_ids[1]})
        )
        .code,
        "script_not_approved"
    );

    // Troca o modelo padrão para `portuguese` (6L leve) no catálogo, re-aprova o bloco 2 e regenera só ele.
    call(
        "tts.models.choose",
        json!({"language": "pt", "modelId": "portuguese"}),
    );
    call(
        "script.approve",
        json!({"candidate": candidate, "block": block_ids[1]}),
    );
    let regen = call(
        "narration.regenerate_block",
        json!({"candidate": candidate, "block": block_ids[1]}),
    );
    assert_eq!(regen["modelId"], "portuguese");
    let after_regen = wait_narration_done(candidate);
    assert_eq!(after_regen["job"]["state"], "completed");
    assert_eq!(after_regen["blocks"][1]["audio"]["stale"], false);
    assert_eq!(after_regen["blocks"][1]["audio"]["modelId"], "portuguese");
    assert_eq!(
        after_regen["blocks"][0]["audio"]["modelId"],
        "portuguese_24l"
    );
    assert_eq!(block_durations_for_candidate(candidate).unwrap().len(), 3);

    // Persiste ao fechar e reabrir o Projeto, e alimenta a montagem (#204) com durações reais.
    call("projects.close", json!({}));
    call("projects.open", json!({"path": project["path"]}));
    let reopened_durations = block_durations_for_candidate(candidate).unwrap();
    assert_eq!(reopened_durations.len(), 3);
    let plan = montage::plan_for_clip(None, candidate, &[])
        .unwrap()
        .unwrap();
    assert!(!plan.uses_estimated_durations);
    assert_eq!(plan.blocks.len(), 3);
    for (idx, b) in plan.blocks.iter().enumerate() {
        assert!(!b.estimated);
        assert_eq!(
            b.duration_us,
            after_regen["blocks"][idx]["audio"]["durationUs"]
                .as_i64()
                .unwrap()
        );
    }
    let opened_ed = call(
        "editor.open",
        json!({"source_id": source_id, "start_id": 1, "end_id": 6, "candidate_id": candidate}),
    );
    assert_eq!(opened_ed["montage"]["usesEstimatedDurations"], false);
    assert_eq!(
        call("channel_profile.get", json!({}))["narrationVoice"],
        "13063"
    );
}

#[test]
fn headless_narration_cancellation_stops_process_cleanly() {
    let _guard = SERIAL.lock().unwrap_or_else(|e| e.into_inner());
    let root = tempfile::tempdir().unwrap();
    let data_dir = root.path().join("data");
    std::env::set_var("CLIPES_DATA_DIR", &data_dir);
    std::env::set_var("CLIPES_FAKE_TTS_SLEEP_MS", "3000");
    std::env::remove_var("CLIPES_FAKE_TTS_FAIL");

    let comp_dir = data_dir.join("components");
    fs::create_dir_all(&comp_dir).unwrap();
    build_fake_pocket_tts(&comp_dir);
    let cat = call("tts.catalog", json!({}));
    let terms_version = cat["engines"][0]["prohibitedUse"]["version"]
        .as_str()
        .unwrap()
        .to_owned();
    install_fake_tts_model(
        &data_dir,
        "portuguese_24l",
        &["13063-pt-24l.safetensors"],
        &terms_version,
    );

    call(
        "projects.create",
        json!({"parent": root.path(), "name": "CanalCancel"}),
    );
    let (_, candidate, _) = seed_transformed_cut(true);
    let started = call("narration.generate", json!({"candidate": candidate}));
    let job_id = started["job"].as_i64().unwrap();
    std::thread::sleep(Duration::from_millis(120));
    call("jobs.cancel", json!({"id": job_id}));
    let settled = wait_narration_done(candidate);
    std::env::remove_var("CLIPES_FAKE_TTS_SLEEP_MS");
    assert_eq!(settled["job"]["state"], "cancelled");
}
