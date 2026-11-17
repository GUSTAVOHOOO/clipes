//! Tradução de legenda PT-BR ↔ EN (#75), headless e sem rede: Provedor falso injetado na
//! fila, Transcrição gravada no Projeto e dados isolados em CLIPES_DATA_DIR.
use clipes_core::{
    ai_task::{self, TaskInput},
    dispatch, jobs,
    projects::{with_reader, with_writer},
    provider::{cost::Target, CancelToken, Provider, StructuredRequest},
    CoreError,
};
use serde_json::{json, Value};
use sha2::{Digest, Sha256};
use std::{
    fs,
    path::Path,
    sync::{Arc, Mutex},
    time::{Duration, Instant},
};

static TEST_LOCK: Mutex<()> = Mutex::new(());

fn call(name: &str, args: Value) -> Value {
    dispatch(name, args, &mut |_| {}).unwrap()
}

fn fail(name: &str, args: Value) -> CoreError {
    dispatch(name, args, &mut |_| {}).unwrap_err()
}

fn seed_with_permission(
    media_path: Option<&Path>,
    permission: Value,
    sentences_spec: &[(&str, &str)],
    sentence_step_us: i64,
) -> (i64, i64) {
    let (path_str, size, hash_hex) = match media_path {
        Some(p) => {
            fs::write(p, b"original").unwrap();
            let mut hash = Sha256::new();
            for _ in 0..3 {
                hash.update(b"original");
            }
            (
                p.to_str().unwrap().to_owned(),
                8_i64,
                format!("{:x}", hash.finalize()),
            )
        }
        None => ("C:/videos/live.mp4".to_owned(), 1_i64, "h".to_owned()),
    };
    with_writer(|c| {
        c.execute(
            "INSERT INTO sources(path,size,duration_us,partial_hash,metadata,permission,audio_track) VALUES (?1,?2,6000000000,?3,'{}',?4,0)",
            (path_str, size, hash_hex, permission.to_string()),
        )?;
        let source = c.last_insert_rowid();
        c.execute(
            "INSERT INTO transcripts(source_id,audio_track,engine,model,revision,compute_type,state,resume_us,duration_us) VALUES (?1,0,'local','m','r','c','complete',6000000000,6000000000)",
            [source],
        )?;
        let transcript = c.last_insert_rowid();
        let mut pos = 0_i64;
        let speech_us = (sentence_step_us - 1_000_000).max(200_000);
        for (idx, (sentence_text, lang)) in sentences_spec.iter().enumerate() {
            let start = idx as i64 * sentence_step_us;
            let words: Vec<&str> = sentence_text.split_whitespace().collect();
            let step = speech_us / (words.len().max(1) as i64);
            for (wi, w) in words.iter().enumerate() {
                let text = if wi == 0 {
                    (*w).to_owned()
                } else {
                    format!(" {w}")
                };
                let ws = start + wi as i64 * step;
                let we = ws + step - 10_000;
                c.execute(
                    "INSERT INTO transcript_words(transcript_id,position,kind,text,start_us,end_us,language) VALUES (?1,?2,'word',?3,?4,?5,?6)",
                    (transcript, pos, text, ws, we, lang),
                )?;
                pos += 1;
            }
        }
        Ok((source, transcript))
    })
    .unwrap()
}

fn transcript_words_of(transcript: i64) -> Vec<String> {
    with_reader(|c| {
        let mut q = c.prepare(
            "SELECT text FROM transcript_words WHERE transcript_id=?1 ORDER BY position",
        )?;
        let rows = q.query_map([transcript], |r| r.get(0))?;
        rows.collect()
    })
    .unwrap()
}

fn approve_candidate(source: i64, start_id: i64, end_id: i64) -> i64 {
    let cand = with_writer(|c| {
        c.execute(
            "INSERT INTO selection_runs(transcript_id,task_version,prompt_sha256,state,min_us,max_us,weights,plan_state,windows_total) SELECT id,1,'h','completed',1,999999999,'[]','ready',0 FROM transcripts WHERE source_id=?1",
            [source],
        )?;
        let run = c.last_insert_rowid();
        c.execute(
            "INSERT INTO selection_candidates(run_id,rank,start_id,end_id,start_us,end_us,axes,total_centi,windows) VALUES (?1,1,?2,?3,0,22000000,'{}',500,'[]')",
            (run, start_id, end_id),
        )?;
        Ok(c.last_insert_rowid())
    })
    .unwrap();
    call(
        "selection.decide",
        json!({"candidate": cand, "decision": "approved"}),
    );
    cand
}

fn open_clip(source: i64, start_id: i64, end_id: i64) -> i64 {
    let opened = call(
        "editor.open",
        json!({"source_id": source, "start_id": start_id, "end_id": end_id}),
    );
    opened["clipId"].as_i64().unwrap()
}

fn open_candidate_clip(source: i64, start_id: i64, end_id: i64, candidate_id: i64) -> i64 {
    let opened = call(
        "editor.open",
        json!({"source_id": source, "start_id": start_id, "end_id": end_id, "candidate_id": candidate_id}),
    );
    opened["clipId"].as_i64().unwrap()
}

struct Direct(Value);
impl Provider for Direct {
    fn structured(&self, _: &StructuredRequest) -> Result<Value, CoreError> {
        Ok(json!({"data": self.0, "calls": 1}))
    }
}

fn run_task(
    sentences: &[Value],
    target_lang: &str,
    data: Value,
) -> Result<ai_task::TaskOutput, ai_task::TaskError> {
    let task = ai_task::find("translation").expect("translation task registered");
    ai_task::run(
        task,
        &TaskInput {
            transcript: "#TRADUCAO origem=pt-BR destino=en\n1 Olá\n".into(),
            context: json!({
                "sourceLanguage": "pt-BR",
                "targetLanguage": target_lang,
                "sentences": sentences,
            }),
            ..Default::default()
        },
        &Direct(data),
        &CancelToken::new(),
    )
}

fn violation_codes(sentences: &[Value], target_lang: &str, data: Value) -> Vec<&'static str> {
    run_task(sentences, target_lang, data)
        .expect_err("must fail")
        .violations
        .iter()
        .map(|v| v.code)
        .collect()
}

#[test]
fn verifiers_check_ids_empty_lines_numbers_urls_language_and_limits() {
    let sentences = vec![
        json!({"id": 1, "text": "Tenho 42 pontos e 3,5 de nota em https://example.com/a."}),
        json!({"id": 2, "text": "Esta frase tem uma explicação clara sobre o jogo de hoje."}),
    ];
    let ok = json!({
        "schemaVersion": 1,
        "language": "en",
        "lines": [
            {"id": 1, "text": "I have 42 points and a 3.5 score at https://example.com/a."},
            {"id": 2, "text": "This sentence gives a clear explanation about today's game."}
        ]
    });
    assert!(run_task(&sentences, "en", ok.clone()).is_ok());

    // 1) Quantidade / IDs errados ou duplicados
    let mut bad = ok.clone();
    bad["lines"] = json!([{"id": 1, "text": "I have 42 points and 3.5 at https://example.com/a."}]);
    let codes = violation_codes(&sentences, "en", bad);
    assert!(codes.contains(&"line_count_mismatch"));
    assert!(codes.contains(&"missing_sentence_id"));

    let mut bad = ok.clone();
    bad["lines"][1]["id"] = json!(999);
    let codes = violation_codes(&sentences, "en", bad);
    assert!(codes.contains(&"unknown_sentence_id"));
    assert!(codes.contains(&"missing_sentence_id"));

    let mut bad = ok.clone();
    bad["lines"][1]["id"] = json!(1);
    let codes = violation_codes(&sentences, "en", bad);
    assert!(codes.contains(&"duplicate_sentence_id"));
    assert!(codes.contains(&"missing_sentence_id"));

    // 2) Linha vazia quando a original tinha texto
    let mut bad = ok.clone();
    bad["lines"][1]["text"] = json!("   ");
    assert!(violation_codes(&sentences, "en", bad).contains(&"empty_translation"));

    // 3) Número perdido
    let mut bad = ok.clone();
    bad["lines"][0]["text"] = json!("I have points and a 3.5 score at https://example.com/a.");
    assert!(violation_codes(&sentences, "en", bad).contains(&"number_not_preserved"));

    // 4) URL perdida ou inventada
    let mut bad = ok.clone();
    bad["lines"][0]["text"] = json!("I have 42 points and a 3.5 score here.");
    assert!(violation_codes(&sentences, "en", bad).contains(&"url_not_preserved"));

    let mut bad = ok.clone();
    bad["lines"][1]["text"] = json!("See https://evil.example for more details.");
    assert!(violation_codes(&sentences, "en", bad).contains(&"invented_url"));

    // 5) Idioma errado
    let mut bad = ok.clone();
    bad["language"] = json!("pt-BR");
    assert!(violation_codes(&sentences, "en", bad).contains(&"language_mismatch"));

    let mut bad = ok.clone();
    bad["lines"][1]["text"] = json!("O vídeo de hoje é sobre como a gente fez a casa com o povo e quando ele falou que não tinha mais o que fazer.");
    assert!(violation_codes(&sentences, "en", bad).contains(&"language_mismatch"));

    // 6) Controle / caractere proibido / tamanho absurdo
    let mut bad = ok.clone();
    bad["lines"][1]["text"] = json!("Line one\nLine two");
    assert!(violation_codes(&sentences, "en", bad).contains(&"control_character"));

    let mut bad = ok.clone();
    bad["lines"][1]["text"] = json!("<script>bad</script>");
    assert!(violation_codes(&sentences, "en", bad).contains(&"forbidden_character"));

    let mut bad = ok.clone();
    bad["lines"][1]["text"] = json!("ab");
    assert!(violation_codes(&sentences, "en", bad).contains(&"translation_too_short"));

    let mut bad = ok.clone();
    bad["lines"][1]["text"] = json!("x ".repeat(200));
    assert!(violation_codes(&sentences, "en", bad).contains(&"translation_too_long"));
}

#[derive(Default)]
struct EchoTranslator {
    seen: Mutex<Vec<StructuredRequest>>,
    prefix: Mutex<String>,
    force_glyph: Mutex<Option<String>>,
}

impl Provider for EchoTranslator {
    fn structured(&self, _: &StructuredRequest) -> Result<Value, CoreError> {
        unreachable!("executor must use structured_with")
    }
    fn structured_with(
        &self,
        request: &StructuredRequest,
        _: &CancelToken,
    ) -> Result<Value, CoreError> {
        self.seen.lock().unwrap().push(request.clone());
        let header = request.transcript.lines().next().unwrap_or("");
        let target_lang = header
            .split("destino=")
            .nth(1)
            .unwrap_or("en")
            .trim()
            .to_owned();
        let prefix = self.prefix.lock().unwrap().clone();
        let forced = self.force_glyph.lock().unwrap().clone();
        let mut lines = Vec::new();
        for raw in request.transcript.lines().skip(1) {
            if raw.starts_with("##") || raw.trim().is_empty() {
                continue;
            }
            let Some((id_str, rest)) = raw.split_once(' ') else {
                continue;
            };
            let Ok(id) = id_str.parse::<i64>() else {
                continue;
            };
            let text = if let Some(ref g) = forced {
                format!("{g} {rest}")
            } else if target_lang == "en" {
                format!("{prefix}Translated line {id} from {rest}")
            } else {
                format!("{prefix}Linha traduzida {id} de {rest}")
            };
            lines.push(json!({"id": id, "text": text}));
        }
        Ok(json!({
            "data": {
                "schemaVersion": 1,
                "language": target_lang,
                "lines": lines,
            },
            "usage": {"inputTokens": 50, "outputTokens": 40},
            "calls": 1,
        }))
    }
}

fn wait_run(clip_id: i64, run_id: i64) -> Value {
    let deadline = Instant::now() + Duration::from_secs(60);
    loop {
        let doc = call("translation.get", json!({"clip_id": clip_id}));
        if doc["run"]["id"] == run_id && doc["run"]["state"] != "running" {
            return doc;
        }
        assert!(
            Instant::now() < deadline,
            "translation run {run_id} did not settle: {doc}"
        );
        std::thread::sleep(Duration::from_millis(25));
    }
}

#[test]
fn permission_scope_enforced_before_any_provider_call() {
    let _lock = TEST_LOCK.lock().unwrap_or_else(|e| e.into_inner());
    let root = tempfile::tempdir().unwrap();
    std::env::set_var("CLIPES_DATA_DIR", root.path().join("data"));
    call(
        "projects.create",
        json!({"parent": root.path(), "name": "Perm"}),
    );

    let fake = Arc::new(EchoTranslator::default());
    jobs::set_ai_provider(Some(fake.clone()));

    // 1. status == "none": bloqueado antes do Provedor
    let (s_none, _) = seed_with_permission(
        None,
        json!({"status": "none"}),
        &[
            ("Primeira frase para teste.", "pt"),
            ("Segunda frase para teste.", "pt"),
        ],
        11_000_000,
    );
    call("transcription.segment", json!({"source_id": s_none}));
    let clip_none = open_clip(s_none, 1, 2);
    let doc = call("translation.get", json!({"clip_id": clip_none}));
    assert_eq!(doc["permitted"], false);
    assert_eq!(
        doc["permissionError"]["code"],
        "translation_permission_required"
    );
    assert_eq!(
        fail("translation.estimate", json!({"clip_id": clip_none})).code,
        "translation_permission_required"
    );
    assert_eq!(
        fail("translation.start", json!({"clip_id": clip_none})).code,
        "translation_permission_required"
    );
    assert!(fake.seen.lock().unwrap().is_empty());

    // 2. status == "granted" sem escopo "tradução": bloqueado antes do Provedor
    let (s_no_scope, _) = seed_with_permission(
        None,
        json!({"status": "granted", "who": "Criador", "where": "Email", "scope": "cortes diretos"}),
        &[
            ("Primeira frase para teste.", "pt"),
            ("Segunda frase para teste.", "pt"),
        ],
        11_000_000,
    );
    call("transcription.segment", json!({"source_id": s_no_scope}));
    let clip_no_scope = open_clip(s_no_scope, 1, 2);
    let doc = call("translation.get", json!({"clip_id": clip_no_scope}));
    assert_eq!(doc["permitted"], false);
    assert_eq!(
        fail("translation.start", json!({"clip_id": clip_no_scope})).code,
        "translation_permission_required"
    );
    assert!(fake.seen.lock().unwrap().is_empty());

    // 3. status == "granted" com escopo "tradução" (ou "translation"): permitido
    call(
        "provider.configure",
        json!({"endpoint": "http://127.0.0.1:9/v1", "kind": "openai", "model": "fake-model", "context": 32768}),
    );
    jobs::set_ai_route(Some((
        Target::Api {
            provider: "openai".into(),
            model: "fake-model".into(),
            local: true,
        },
        "legacy".into(),
    )));
    let (s_ok, _) = seed_with_permission(
        None,
        json!({"status": "granted", "who": "Criador", "where": "Email", "scope": "cortes, Tradução"}),
        &[
            ("Primeira frase para teste.", "pt"),
            ("Segunda frase para teste.", "pt"),
        ],
        11_000_000,
    );
    call("transcription.segment", json!({"source_id": s_ok}));
    let clip_ok = open_clip(s_ok, 1, 2);
    let est = call("translation.estimate", json!({"clip_id": clip_ok}));
    assert_eq!(est["sourceLanguage"], "pt-BR");
    assert_eq!(est["targetLanguage"], "en");
    let started = call("translation.start", json!({"clip_id": clip_ok}));
    let done = wait_run(clip_ok, started["run"].as_i64().unwrap());
    assert_eq!(done["run"]["state"], "completed");
    assert_eq!(fake.seen.lock().unwrap().len(), 1);

    jobs::set_ai_provider(None);
    jobs::set_ai_route(None);
    call("projects.close", json!({}));
}

#[test]
fn translation_flow_track_switch_interpolation_edits_glyphs_batches_and_vetoes() {
    let _lock = TEST_LOCK.lock().unwrap_or_else(|e| e.into_inner());
    let root = tempfile::tempdir().unwrap();
    std::env::set_var("CLIPES_DATA_DIR", root.path().join("data"));
    call(
        "projects.create",
        json!({"parent": root.path(), "name": "Tradu"}),
    );

    let fake = Arc::new(EchoTranslator::default());
    jobs::set_ai_provider(Some(fake.clone()));

    // Provedor pago inicialmente para testar confirmation_required e veto somente local
    call(
        "provider.configure",
        json!({"endpoint": "https://192.0.2.10/v1", "kind": "openai", "model": "gpt-4o-mini", "context": 32768}),
    );
    jobs::set_ai_route(Some((
        Target::Api {
            provider: "openai".into(),
            model: "gpt-4o-mini".into(),
            local: false,
        },
        "legacy".into(),
    )));

    let media = root.path().join("live.mp4");
    let (source, transcript) = seed_with_permission(
        Some(&media),
        json!({"status": "granted", "who": "Streamer", "where": "Contrato", "scope": "clips, translation"}),
        &[
            ("Olá mundo 10!", "pt"),
            ("Isso custa 20 reais agora.", "pt"),
        ],
        11_000_000,
    );
    call("transcription.segment", json!({"source_id": source}));
    let cand = approve_candidate(source, 1, 2);
    let clip = open_candidate_clip(source, 1, 2, cand);

    // Sem tradução, selecionar faixa traduzida falha
    assert_eq!(
        fail(
            "translation.track.set",
            json!({"clip_id": clip, "track": "translated"})
        )
        .code,
        "translation_missing"
    );

    // Veto somente local por tarefa bloqueia sem chamar Provedor
    call(
        "assistant.local_only.set",
        json!({"task": "translation", "enabled": true}),
    );
    assert_eq!(
        fail("translation.estimate", json!({"clip_id": clip})).code,
        "local_only_violation"
    );
    assert_eq!(
        fail("translation.start", json!({"clip_id": clip})).code,
        "local_only_violation"
    );
    call(
        "assistant.local_only.set",
        json!({"task": "translation", "enabled": false}),
    );

    // Veto somente local por Projeto também bloqueia
    call("projects.local_only.set", json!({"enabled": true}));
    assert_eq!(
        fail("translation.start", json!({"clip_id": clip})).code,
        "local_only_violation"
    );
    call("projects.local_only.set", json!({"enabled": false}));

    // Provedor pago exige confirmação com estimativa
    let est = call("translation.estimate", json!({"clip_id": clip}));
    assert_eq!(est["paid"], true);
    let conf_err = fail("translation.start", json!({"clip_id": clip}));
    assert_eq!(conf_err.code, "confirmation_required");
    assert!(conf_err.usage.unwrap()["estimate"].is_object());

    // Confirmado: executa na fila
    let started = call(
        "translation.start",
        json!({"clip_id": clip, "confirmed": true}),
    );
    let doc = wait_run(clip, started["run"].as_i64().unwrap());
    assert_eq!(doc["run"]["state"], "completed");
    assert_eq!(doc["activeTrack"], "original");
    assert_eq!(doc["targetLanguage"], "en");
    assert_eq!(doc["hasTranslation"], true);

    // Transcrição original nunca muda
    let original_words = transcript_words_of(transcript);
    assert_eq!(
        original_words,
        vec!["Olá", " mundo", " 10!", "Isso", " custa", " 20", " reais", " agora."]
    );

    // Com padrão "original", export.captions usa o texto original
    let cap_orig = call(
        "export.captions",
        json!({"source_id": source, "start_id": 1, "end_id": 2, "candidate_id": cand, "clip_id": clip}),
    );
    assert_eq!(cap_orig["track"], "original");
    assert_eq!(cap_orig["words"][0]["text"], "Olá");

    // Troca para "translated": export.captions interpola palavras e preserva [start_us, end_us] da Frase
    let switched = call(
        "translation.track.set",
        json!({"clip_id": clip, "track": "translated"}),
    );
    assert_eq!(switched["activeTrack"], "translated");

    // Edita a primeira Frase traduzida para ter exatamente "Hi there!" (2 chars vs 6 chars)
    let edited = call(
        "translation.edit",
        json!({"clip_id": clip, "sentence_id": 1, "text": "Hi there!"}),
    );
    assert_eq!(edited["sentences"][0]["translatedText"], "Hi there!");
    assert_eq!(edited["sentences"][0]["edited"], true);

    // Transcrição original continua intacta depois da edição!
    assert_eq!(transcript_words_of(transcript), original_words);

    let cap_tr = call(
        "export.captions",
        json!({"source_id": source, "start_id": 1, "end_id": 2, "candidate_id": cand, "clip_id": clip}),
    );
    assert_eq!(cap_tr["track"], "translated");
    assert_eq!(cap_tr["targetLanguage"], "en");
    assert_eq!(cap_tr["words"][0]["text"], " Hi");
    assert_eq!(cap_tr["words"][1]["text"], " there!");
    // Frase 1 vai de 0 a ~7_990_000 µs; "Hi" (2/8) e "there!" (6/8) devem ser proporcionais e contínuas
    let w0_start = cap_tr["words"][0]["startUs"].as_i64().unwrap();
    let w0_end = cap_tr["words"][0]["endUs"].as_i64().unwrap();
    let w1_start = cap_tr["words"][1]["startUs"].as_i64().unwrap();
    let w1_end = cap_tr["words"][1]["endUs"].as_i64().unwrap();
    assert_eq!(w0_start, 0);
    assert_eq!(w0_end, w1_start);
    assert!((w1_end - w1_start) > (w0_end - w0_start) * 2);

    // #196: palavra traduzida sem glifo na fonte aparece em missingGlyphs e bloqueia export.start
    call(
        "translation.edit",
        json!({"clip_id": clip, "sentence_id": 1, "text": "Hi 来"}),
    );
    let cap_glyph = call(
        "export.captions",
        json!({"source_id": source, "start_id": 1, "end_id": 2, "candidate_id": cand, "clip_id": clip}),
    );
    assert_eq!(cap_glyph["missingGlyphs"][0]["word"], "来");
    assert_eq!(cap_glyph["missingGlyphs"][0]["sentence_id"], 1);
    let exp_err = fail(
        "export.start",
        json!({"source_id": source, "start_id": 1, "end_id": 2, "candidate_id": cand, "clip_id": clip, "output": root.path().join("out.mp4")}),
    );
    assert_eq!(exp_err.code, "export_glyph_missing");

    // Corrigindo o glifo na legenda traduzida, export.start aceita e congela a legenda traduzida no job
    call(
        "translation.edit",
        json!({"clip_id": clip, "sentence_id": 1, "text": "Hi there!"}),
    );
    let data_dir = root.path().join("data");
    fs::write(
        data_dir.join("component-settings.json"),
        json!({"data_dir": data_dir, "cache_dir": data_dir.join("cache"), "cache_limit_bytes": 1_000_000, "ffmpeg_path": env!("CARGO_BIN_EXE_fake-export")}).to_string(),
    )
    .unwrap();
    let exp_ok = call(
        "export.start",
        json!({"source_id": source, "start_id": 1, "end_id": 2, "candidate_id": cand, "clip_id": clip, "output": root.path().join("ok.mp4")}),
    );
    let exp_job = exp_ok["job"].as_i64().unwrap();
    let frozen_req: String = with_reader(|c| {
        c.query_row(
            "SELECT request FROM exports WHERE job_id=?1",
            [exp_job],
            |r| r.get(0),
        )
    })
    .unwrap();
    let frozen_json: Value = serde_json::from_str(&frozen_req).unwrap();
    assert_eq!(frozen_json["resolved_captions"][0]["text"], " Hi");

    // Volta para "original" -> export.captions volta ao texto original
    call(
        "translation.track.set",
        json!({"clip_id": clip, "track": "original"}),
    );
    let cap_back = call(
        "export.captions",
        json!({"source_id": source, "start_id": 1, "end_id": 2, "candidate_id": cand, "clip_id": clip}),
    );
    assert_eq!(cap_back["track"], "original");
    assert_eq!(cap_back["words"][0]["text"], "Olá");

    // Direção inversa EN -> PT-BR e teto de 100 Frases por lote
    call(
        "provider.configure",
        json!({"endpoint": "http://127.0.0.1:9/v1", "kind": "openai", "model": "fake-model", "context": 65536}),
    );
    jobs::set_ai_route(Some((
        Target::Api {
            provider: "openai".into(),
            model: "fake-model".into(),
            local: true,
        },
        "legacy".into(),
    )));
    let many: Vec<(&str, &str)> = (0..125).map(|_| ("Hello world today.", "en")).collect();
    let (s_en, _) = seed_with_permission(
        None,
        json!({"status": "granted", "who": "Host", "where": "Email", "scope": "translation"}),
        &many,
        1_000_000,
    );
    call("transcription.segment", json!({"source_id": s_en}));
    let clip_en = open_clip(s_en, 1, 125);
    fake.seen.lock().unwrap().clear();
    let est_en = call("translation.estimate", json!({"clip_id": clip_en}));
    assert_eq!(est_en["sourceLanguage"], "en");
    assert_eq!(est_en["targetLanguage"], "pt-BR");
    assert_eq!(est_en["batches"], 2);
    let run_en = call("translation.start", json!({"clip_id": clip_en}));
    let doc_en = wait_run(clip_en, run_en["run"].as_i64().unwrap());
    assert_eq!(doc_en["run"]["state"], "completed");
    assert_eq!(doc_en["run"]["batchesTotal"], 2);
    assert_eq!(fake.seen.lock().unwrap().len(), 2);
    assert_eq!(doc_en["sentences"].as_array().unwrap().len(), 125);
    assert!(doc_en["sentences"][124]["translatedText"]
        .as_str()
        .unwrap()
        .starts_with("Linha traduzida 125"));

    // Contexto pequeno demais retorna context_too_small; contexto reduzido divide em múltiplos lotes pelo estimador
    call(
        "provider.configure",
        json!({"endpoint": "http://127.0.0.1:9/v1", "kind": "openai", "model": "fake-model", "context": 200}),
    );
    assert_eq!(
        fail("translation.estimate", json!({"clip_id": clip_en})).code,
        "context_too_small"
    );

    call(
        "provider.configure",
        json!({"endpoint": "http://127.0.0.1:9/v1", "kind": "openai", "model": "fake-model", "context": 3000, "maxOutput": 512}),
    );
    let est_small = call("translation.estimate", json!({"clip_id": clip_en}));
    assert!(est_small["batches"].as_u64().unwrap() > 2);

    jobs::set_ai_provider(None);
    jobs::set_ai_route(None);
    call("projects.close", json!({}));
}
