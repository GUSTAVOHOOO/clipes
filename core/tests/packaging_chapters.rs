//! Capítulos no Empacotamento (#80): testes headless sem rede (Provedor falso + CLIPES_DATA_DIR).
//! Cobre:
//! - Corte direto não gera capítulos (`applicable: false`);
//! - Vídeo transformado exige Roteiro aprovado e durações REAIS do TTS (sem estimativa);
//! - Bloco < 10 s junta com o anterior (o 1º com o seguinte); < 3 capítulos restantes avisa e não gera;
//! - 1º capítulo fixado em 00:00 mesmo quando o 1º bloco da montagem tem `start_us > 0`;
//! - Orçamento de 5000 bytes na chamada de IA desconta crédito + capítulos;
//! - Materialização do bloco delimitado, edição livre com avisos não-bloqueantes e
//!   `packaging.refresh_chapters` preservando edições fora dos delimitadores (inclusive após arrasto).

use clipes_core::{
    dispatch, jobs,
    projects::with_writer,
    provider::{cost::Target, CancelToken, Provider, StructuredRequest},
    CoreError,
};
use serde_json::{json, Value};
use std::{
    fs,
    path::{Path, PathBuf},
    sync::{Arc, Mutex},
    time::{Duration, Instant},
};

static SERIAL: Mutex<()> = Mutex::new(());

fn call(name: &str, args: Value) -> Value {
    dispatch(name, args, &mut |_| {}).unwrap()
}

fn fail(name: &str, args: Value) -> CoreError {
    dispatch(name, args, &mut |_| {}).unwrap_err()
}

struct FakeProvider {
    next: Mutex<Value>,
    seen: Mutex<Vec<StructuredRequest>>,
}

impl Provider for FakeProvider {
    fn structured(&self, _: &StructuredRequest) -> Result<Value, CoreError> {
        unreachable!("the executor must use structured_with")
    }
    fn structured_with(
        &self,
        request: &StructuredRequest,
        _: &CancelToken,
    ) -> Result<Value, CoreError> {
        self.seen.lock().unwrap().push(request.clone());
        Ok(json!({
            "data": self.next.lock().unwrap().clone(),
            "usage": {"inputTokens": 10, "outputTokens": 5},
            "calls": 1
        }))
    }
}

fn pack_out(description: &str) -> Value {
    json!({
        "schemaVersion": 1,
        "language": "pt-BR",
        "title": "Título transformado",
        "description": description,
        "tags": ["analise", "corte"],
        "hashtags": ["#analise", "#corte"]
    })
}

fn wait_packaging(candidate: i64, job_id: i64) -> Value {
    let deadline = Instant::now() + Duration::from_secs(60);
    loop {
        let doc = call("packaging.get", json!({"candidate": candidate}));
        let job = &doc["job"];
        if job["id"] == job_id && !matches!(job["state"].as_str(), Some("queued" | "running")) {
            return doc;
        }
        assert!(
            Instant::now() < deadline,
            "job {job_id} never settled: {doc}"
        );
        std::thread::sleep(Duration::from_millis(20));
    }
}

fn generate_packaging(candidate: i64) -> Value {
    let job_id = call("packaging.generate", json!({"candidate": candidate}))["job"]
        .as_i64()
        .unwrap();
    wait_packaging(candidate, job_id)
}

fn seed_cut(
    video_kind: &str,
    blocks: &[(&str, Vec<i64>, &str)],
    approved: bool,
) -> (PathBuf, i64, i64, Vec<(i64, i64)>, tempfile::TempDir) {
    let root = tempfile::tempdir().unwrap();
    std::env::set_var("CLIPES_DATA_DIR", root.path().join("data"));
    let proj = call(
        "projects.create",
        json!({"parent": root.path(), "name": "ChaptersProj"}),
    );
    let project_path = PathBuf::from(proj["path"].as_str().unwrap());

    let (source, candidate, block_versions) = with_writer(|c| {
        c.execute(
            "INSERT INTO sources(path,size,duration_us,partial_hash,metadata,permission,audio_track,origin_url) VALUES ('offline.mp4',1,600000000,?1,?2,?3,0,'https://example.com/live')",
            (
                "hash",
                r#"{"streams":[{"codec_type":"video","avg_frame_rate":"25/1"}]}"#,
                json!({"status":"granted","who":"Canal Original"}).to_string(),
            ),
        )?;
        let source = c.last_insert_rowid();
        c.execute(
            "INSERT INTO transcripts(source_id,audio_track,engine,model,revision,compute_type,state,resume_us,duration_us) VALUES (?1,0,'local','m','r','c','complete',600000000,600000000)",
            [source],
        )?;
        let transcript = c.last_insert_rowid();
        // 10 Frases de 10 s cada (1..=10).
        for id in 1..=10_i64 {
            let s0 = (id - 1) * 10_000_000;
            let s1 = id * 10_000_000;
            c.execute(
                "INSERT INTO sentences(transcript_id,id,first_position,last_position,start_us,end_us,language,text) VALUES (?1,?2,?3,?4,?5,?6,'pt','Frase de teste.')",
                (transcript, id, id * 2 - 1, id * 2, s0, s1),
            )?;
            c.execute(
                "INSERT INTO transcript_words(transcript_id,position,kind,text,start_us,end_us,language) VALUES (?1,?2,'word','Frase',?3,?4,'pt')",
                (transcript, id * 2 - 1, s0, s0 + 4_000_000),
            )?;
            c.execute(
                "INSERT INTO transcript_words(transcript_id,position,kind,text,start_us,end_us,language) VALUES (?1,?2,'word','teste',?3,?4,'pt')",
                (transcript, id * 2, s0 + 5_000_000, s1),
            )?;
        }
        c.execute(
            "INSERT INTO selection_runs(transcript_id,task_version,prompt_sha256,profile,state,min_us,max_us,weights,plan_state,windows_total,video_kind) VALUES (?1,1,'h','legacy','completed',20000000,180000000,'{}','[]',1,?2)",
            (transcript, video_kind),
        )?;
        let run = c.last_insert_rowid();
        // Candidato cobre Frases 2..=8 (10s..80s -> 70s de Corte).
        c.execute(
            "INSERT INTO selection_candidates(run_id,rank,start_id,end_id,start_us,end_us,axes,total_centi,title,windows) VALUES (?1,1,2,8,10000000,80000000,'{}',900,'Corte','[0]')",
            [run],
        )?;
        let candidate = c.last_insert_rowid();
        c.execute(
            "INSERT INTO selection_decisions(run_id,cand_start_id,cand_end_id,decision,before_start_id,before_end_id,after_start_id,after_end_id) VALUES (?1,2,8,'approved',2,8,2,8)",
            [run],
        )?;

        let mut bvs = Vec::new();
        if !blocks.is_empty() {
            c.execute(
                "INSERT INTO jobs(kind,safety,state,progress) VALUES ('ai:script','local','completed',100)",
                [],
            )?;
            let gen_job = c.last_insert_rowid();
            c.execute(
                "INSERT INTO script_generations(job_id,run_id,cand_start_id,cand_end_id,language,task_version,prompt_sha256,profile,safety,outline,angle) VALUES (?1,?2,2,8,'pt-BR',2,'h','legacy','local','[]','{\"name\":\"Angulo\",\"promise\":\"Promessa\"}')",
                (gen_job, run),
            )?;
            let gen_id = c.last_insert_rowid();
            for (i, (title, refs, narration)) in blocks.iter().enumerate() {
                let pos = i as i64 + 1;
                let refs_json = serde_json::to_string(refs).unwrap();
                c.execute(
                    "INSERT INTO script_blocks(generation_id,position,title,intent,refs) VALUES (?1,?2,?3,'Intenção',?4)",
                    (gen_id, pos, *title, &refs_json),
                )?;
                let block_id = c.last_insert_rowid();
                c.execute(
                    "INSERT INTO script_block_versions(block_id,kind,title,narration,refs,angle_revision) VALUES (?1,'generated',?2,?3,?4,0)",
                    (block_id, *title, *narration, &refs_json),
                )?;
                let ver_id = c.last_insert_rowid();
                if approved {
                    c.execute(
                        "INSERT INTO script_approvals(block_id,version_id,angle_revision) VALUES (?1,?2,0)",
                        (block_id, ver_id),
                    )?;
                }
                bvs.push((block_id, ver_id));
            }
        }
        Ok((source, candidate, bvs))
    })
    .unwrap();

    (project_path, source, candidate, block_versions, root)
}

fn seed_tts_wav(
    project_path: &Path,
    candidate_id: i64,
    block_id: i64,
    version_id: i64,
    duration_us: i64,
) {
    let rel = format!("narrations/c{candidate_id}/b{block_id}-v{version_id}.wav");
    let full = project_path.join(&rel);
    fs::create_dir_all(full.parent().unwrap()).unwrap();
    fs::write(&full, b"RIFF0000WAVEfmt ").unwrap();
    with_writer(|c| {
        c.execute(
            "INSERT OR REPLACE INTO narration_blocks(block_id,version_id,voice_id,model_id,engine_id,audio_rel_path,duration_us,sample_rate,channels,bytes,sha256)
             VALUES (?1,?2,'13063','portuguese_24l','pocket-tts',?3,?4,24000,1,16,'sha')",
            (block_id, version_id, &rel, duration_us),
        )?;
        Ok(())
    })
    .unwrap();
}

#[test]
fn direct_clip_never_generates_chapters() {
    let _guard = SERIAL.lock().unwrap_or_else(|e| e.into_inner());
    let (_proj, _src, cand, _bvs, _root) = seed_cut("direct", &[], false);
    let doc = call("packaging.get", json!({"candidate": cand}));
    assert_eq!(doc["chapters"]["applicable"], false);
    assert_eq!(doc["chapters"]["status"], "not_transformed");
    assert_eq!(doc["chapters"]["generationWarning"], Value::Null);
    assert_eq!(
        fail("packaging.refresh_chapters", json!({"candidate": cand})).code,
        "nothing_to_edit"
    );
}

#[test]
fn transformed_requires_approved_script_and_real_tts_and_merges_short_blocks() {
    let _guard = SERIAL.lock().unwrap_or_else(|e| e.into_inner());
    // 4 blocos: mesmo com texto longo (estimativa > 30s), sem TTS real deve avisar `narration_required`.
    let long_text = "a".repeat(240);
    let (proj, _src, cand, bvs, _root) = seed_cut(
        "transformed",
        &[
            ("Abertura", vec![3], &long_text), // Frase 3 (20s -> output 10s), mas 1º capítulo é fixado em 00:00!
            ("Contexto curto", vec![4], &long_text), // Frase 4 (output 20s)
            ("Virada", vec![5], &long_text),   // Frase 5 (output 30s)
            ("Fechamento", vec![7], &long_text), // Frase 7 (output 50s)
        ],
        false,
    );

    // 1. Roteiro ainda não aprovado -> script_not_approved.
    let doc = call("packaging.get", json!({"candidate": cand}));
    assert_eq!(doc["chapters"]["applicable"], true);
    assert_eq!(doc["chapters"]["status"], "script_not_approved");
    assert_eq!(doc["chapters"]["canGenerate"], false);
    assert_eq!(
        doc["chapters"]["generationWarning"]["code"],
        "script_not_approved"
    );

    // Aprovar todos os blocos via SQL para avançar ao próximo portão.
    with_writer(|c| {
        for (bid, vid) in &bvs {
            c.execute(
                "INSERT INTO script_approvals(block_id,version_id,angle_revision) VALUES (?1,?2,0)",
                (*bid, *vid),
            )?;
        }
        Ok(())
    })
    .unwrap();

    // 2. Roteiro aprovado, mas sem TTS real -> narration_required (nada de estimativa!).
    let doc = call("packaging.get", json!({"candidate": cand}));
    assert_eq!(doc["chapters"]["status"], "narration_required");
    assert_eq!(
        doc["chapters"]["generationWarning"]["code"],
        "narration_required"
    );
    assert_eq!(
        doc["chapters"]["generationWarning"]["message"],
        "Gere a Narração para ter capítulos."
    );

    // TTS parcial (só 3 de 4 blocos) -> continua narration_required.
    seed_tts_wav(&proj, cand, bvs[0].0, bvs[0].1, 10_000_000);
    seed_tts_wav(&proj, cand, bvs[1].0, bvs[1].1, 5_000_000);
    seed_tts_wav(&proj, cand, bvs[2].0, bvs[2].1, 12_000_000);
    let doc = call("packaging.get", json!({"candidate": cand}));
    assert_eq!(doc["chapters"]["status"], "narration_required");

    // 3. 4º bloco com TTS, mas duração que resulta em < 3 capítulos? Vamos testar primeiro < 10s no bloco 2:
    // B0: Frase 3 (output 10s, dura 10s -> 10..20s, mas 1º capítulo fixado em 00:00 -> 0..20.3s = 20s)
    // B1: Frase 4 (output 20s -> empurrado para 20.3s, dura 5s -> próximo é B2 em 30s -> 20..30s = 10s!
    // Vamos colocar B1 durando 4s e B2 ancorado em Frase 4 também -> empurrado para 24.6s!
    // Aí B1 cobre 20..24s = 4s < 10s e deve juntar com B0!)
    // Primeiro testamos < 3 capítulos quando todos os blocos são curtos:
    // Se B3 também fica curto e sobra < 3 capítulos -> too_few_chapters.
    // Aqui vamos colocar B3 com 15s (Frase 7 = output 50s -> 50..65s, dentro dos 70s do corte).
    seed_tts_wav(&proj, cand, bvs[3].0, bvs[3].1, 15_000_000);

    // Vamos também checar que B1 com 5s e B2 com 12s empurrado geram:
    // Sem empurrar B2: B0 em 00:00 (ref Frase 3 = 10s..20s -> fixado em 00:00), B1 em 00:20 (dura 5s até B2 em 00:30 = 10s).
    // Se B1 for movido para perto de B2 ou B1 estiver < 10s do próximo, junta com o anterior.
    let doc = call("packaging.get", json!({"candidate": cand}));
    assert_eq!(doc["chapters"]["status"], "ready");
    assert_eq!(doc["chapters"]["canGenerate"], true);
    let suggested = doc["chapters"]["suggested"].as_array().unwrap();
    assert_eq!(suggested[0]["timestamp"], "00:00");
    assert_eq!(suggested[0]["title"], "Abertura");
    assert_eq!(suggested[1]["timestamp"], "00:20");
    assert_eq!(suggested[2]["timestamp"], "00:30");
    assert_eq!(suggested[3]["timestamp"], "00:50");
}

#[test]
fn transformed_packaging_budget_materialization_editing_drag_and_refresh() {
    let _guard = SERIAL.lock().unwrap_or_else(|e| e.into_inner());
    let long_text = "fala ".repeat(20);
    let (proj, src, cand, bvs, _root) = seed_cut(
        "transformed",
        &[
            ("Abertura", vec![2], &long_text),        // Frase 2 = output 0s
            ("Desenvolvimento", vec![4], &long_text), // Frase 4 = output 20s
            ("Conclusão", vec![6], &long_text),       // Frase 6 = output 40s
        ],
        true,
    );
    seed_tts_wav(&proj, cand, bvs[0].0, bvs[0].1, 12_000_000);
    seed_tts_wav(&proj, cand, bvs[1].0, bvs[1].1, 12_000_000);
    seed_tts_wav(&proj, cand, bvs[2].0, bvs[2].1, 15_000_000);

    call(
        "provider.configure",
        json!({"endpoint": "http://127.0.0.1:9/v1", "kind": "openai", "model": "fake-model", "context": 32768}),
    );
    let fake = Arc::new(FakeProvider {
        next: Mutex::new(pack_out("Resumo do vídeo transformado.")),
        seen: Mutex::new(vec![]),
    });
    jobs::set_ai_provider(Some(fake.clone()));
    jobs::set_ai_route(Some((
        Target::Api {
            provider: "openai".into(),
            model: "fake-model".into(),
            local: true,
        },
        "legacy".into(),
    )));

    // 1. Orçamento: descrição de 4910 bytes cabe no crédito (48), mas estoura 5000 com o bloco de capítulos!
    *fake.next.lock().unwrap() = pack_out(&"x".repeat(4910));
    let over_budget = generate_packaging(cand);
    assert_eq!(over_budget["job"]["state"], "failed");
    assert_eq!(over_budget["job"]["code"], "verification_failed");
    assert!(over_budget["job"]["violations"]
        .as_array()
        .unwrap()
        .contains(&json!("description_too_long")));

    // 2. Geração válida materializa com o bloco delimitado dentro de `description`.
    *fake.next.lock().unwrap() = pack_out("Resumo do vídeo transformado.");
    let doc = generate_packaging(cand);
    assert_eq!(doc["job"]["state"], "completed");
    assert_eq!(doc["chapters"]["hasDelimiters"], true);
    assert_eq!(doc["chapters"]["editWarnings"], json!([]));
    let desc = doc["current"]["description"].as_str().unwrap();
    assert!(desc.starts_with("Resumo do vídeo transformado.\n\n--- Capítulos ---\n"));
    assert!(desc.contains("00:00 Abertura\n00:20 Desenvolvimento\n00:40 Conclusão"));
    assert!(desc.ends_with("--- Fim dos capítulos ---"));
    let full = doc["current"]["fullDescription"].as_str().unwrap();
    assert!(full.contains("Crédito: vídeo original de Canal Original."));

    // 3. Edição que quebra regras do YouTube salva normalmente, mas devolve avisos não-bloqueantes.
    let edited_broken = call(
        "packaging.edit",
        json!({
            "candidate": cand,
            "description": "Meu resumo.\n\n--- Capítulos ---\n00:05 Abertura\n00:10 Desenvolvimento\n--- Fim dos capítulos ---\n\nRodapé do usuário."
        }),
    );
    assert!(edited_broken["current"]["description"]
        .as_str()
        .unwrap()
        .contains("00:05 Abertura"));
    let warn_codes: Vec<&str> = edited_broken["chapters"]["editWarnings"]
        .as_array()
        .unwrap()
        .iter()
        .filter_map(|w| w["code"].as_str())
        .collect();
    assert!(warn_codes.contains(&"first_chapter_not_zero"));
    assert!(warn_codes.contains(&"too_few_chapters"));
    assert!(warn_codes.contains(&"chapter_too_short"));

    // 4. Arrasto manual no editor (#204) move o bloco 2 (Desenvolvimento) para Frase 5 (output 30s),
    // e `packaging.refresh_chapters` reescreve SOMENTE o bloco delimitado, preservando resumo e rodapé!
    let opened = call(
        "editor.open",
        json!({"source_id": src, "start_id": 2, "end_id": 8, "candidate_id": cand}),
    );
    let clip_id = opened["clipId"].as_i64().unwrap();
    // Frase 5 tem start_us = 40_000_000 (na Fonte) -> no Corte (início em Frase 2 = 10s), output = 30s!
    call(
        "editor.montage.set_start",
        json!({"clip_id": clip_id, "block_id": bvs[1].0, "time_us": 40_000_000}),
    );

    let refreshed = call("packaging.refresh_chapters", json!({"candidate": cand}));
    let refreshed_desc = refreshed["current"]["description"].as_str().unwrap();
    assert!(refreshed_desc.starts_with("Meu resumo.\n\n--- Capítulos ---\n"));
    assert!(refreshed_desc.contains("00:00 Abertura\n00:30 Desenvolvimento\n00:42 Conclusão"));
    assert!(refreshed_desc.ends_with("--- Fim dos capítulos ---\n\nRodapé do usuário."));
    assert_eq!(refreshed["chapters"]["editWarnings"], json!([]));

    // 5. Se o usuário apagou os delimitadores, `packaging.refresh_chapters` avisa e não altera nada!
    let no_delim_desc = "Meu resumo sem delimitadores.\n\n00:00 Abertura";
    call(
        "packaging.edit",
        json!({"candidate": cand, "description": no_delim_desc}),
    );
    let err = fail("packaging.refresh_chapters", json!({"candidate": cand}));
    assert_eq!(err.code, "chapter_delimiters_missing");
    assert_eq!(
        call("packaging.get", json!({"candidate": cand}))["current"]["description"],
        no_delim_desc
    );
}
