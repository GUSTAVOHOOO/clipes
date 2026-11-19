use super::*;

fn input(ids: &[i64], target: i64) -> TaskInput {
    TaskInput {
        context: json!({"ids": ids, "targetCandidates": target}),
        ..Default::default()
    }
}

fn axis(score: i64) -> Value {
    json!({"score": score, "why": "motivo curto"})
}

fn candidate(start: i64, end: i64) -> Value {
    json!({
        "startId": start, "endId": end, "title": "",
        "hook": axis(8), "selfContained": axis(6), "energy": axis(7), "value": axis(9), "closing": axis(5),
    })
}

fn task() -> &'static AiTask {
    task_for(VideoKind::Direct)
}

fn all(input: &TaskInput, output: &Value) -> Vec<&'static str> {
    all_for(VideoKind::Direct, input, output)
}

fn all_for(kind: VideoKind, input: &TaskInput, output: &Value) -> Vec<&'static str> {
    task_for(kind)
        .verifiers
        .iter()
        .flat_map(|v| v(input, output))
        .map(|v| v.code)
        .collect()
}

#[test]
fn definition_is_valid_and_schema_axes_follow_the_weight_table() {
    ai_task::check_definition(task()).unwrap();
    let wire: Value = serde_json::from_str(WIRE).unwrap();
    let props = &wire["properties"]["candidates"]["items"]["properties"];
    for axis in AXES {
        assert!(
            props[axis.key].is_object(),
            "{} missing in wire schema",
            axis.key
        );
    }
    // startId, endId, title e um objeto por eixo.
    assert_eq!(props.as_object().unwrap().len(), 3 + AXES.len());
}

#[test]
fn a_clean_output_and_an_empty_list_pass() {
    let i = input(&[1, 2, 3, 4], 3);
    assert!(all(
        &i,
        &json!({"schemaVersion": 1, "candidates": [candidate(1, 3)]})
    )
    .is_empty());
    assert!(all(&i, &json!({"schemaVersion": 1, "candidates": []})).is_empty());
}

#[test]
fn verifiers_report_every_violation_with_fixed_codes() {
    let i = input(&[1, 2, 3, 4], 1);
    let mut bad = candidate(9, 2);
    bad["hook"]["why"] = json!("   ");
    bad["energy"]["score"] = json!(11);
    bad["value"]["why"] = json!("x".repeat(MAX_WHY_CHARS + 1));
    bad["title"] = json!("t".repeat(MAX_TITLE_CHARS + 1));
    let codes = all(&i, &json!({"candidates": [bad]}));
    for code in [
        "unknown_sentence_id",
        "start_after_end",
        "empty_reason",
        "score_out_of_range",
        "reason_too_long",
        "title_too_long",
    ] {
        assert!(codes.contains(&code), "{code} not reported: {codes:?}");
    }
}

#[test]
fn repeated_candidates_and_too_many_are_rejected() {
    let i = input(&[1, 2, 3, 4], 1);
    let repeated = json!({"candidates": [candidate(1, 2), candidate(1, 2)]});
    assert!(all(&i, &repeated).contains(&"duplicate_candidate"));
    let many = json!({"candidates": [candidate(1, 2), candidate(2, 3), candidate(3, 4)]});
    assert!(all(&i, &many).contains(&"too_many_candidates"));
}

#[test]
fn full_schema_rejects_a_score_that_the_wire_schema_lets_through() {
    let (_, full) = ai_task::check_definition(task()).unwrap();
    let validator = jsonschema::validator_for(&full).unwrap();
    let mut bad = candidate(1, 2);
    bad["hook"]["score"] = json!(11);
    assert!(!validator.is_valid(&json!({"schemaVersion": 1, "candidates": [bad]})));
    assert!(validator.is_valid(&json!({"schemaVersion": 1, "candidates": []})));
}

fn transformed(start: i64, end: i64) -> Value {
    let mut c = candidate(start, end);
    c["commentary"] = axis(7);
    c
}

#[test]
fn transformed_definition_is_valid_and_its_schema_follows_the_six_axis_table() {
    let task = task_for(VideoKind::Transformed);
    assert_eq!(task.id, TASK_ID_TRANSFORMED);
    ai_task::check_definition(task).unwrap();
    for schema in [WIRE_TRANSFORMED, FULL_TRANSFORMED] {
        let schema: Value = serde_json::from_str(schema).unwrap();
        let item = &schema["properties"]["candidates"]["items"];
        for axis in AXES_TRANSFORMED {
            assert!(item["properties"][axis.key].is_object(), "{}", axis.key);
            assert!(item["required"]
                .as_array()
                .unwrap()
                .contains(&json!(axis.key)));
        }
        assert_eq!(
            item["properties"].as_object().unwrap().len(),
            3 + AXES_TRANSFORMED.len()
        );
    }
}

#[test]
fn direct_task_keeps_its_schema_without_the_sixth_axis() {
    let direct = task_for(VideoKind::Direct);
    assert_eq!((direct.id, direct.version), ("selection", 3));
    assert_eq!(
        direct.prompt_sha256,
        "e00332d06248cff669ccb8922aae9d50190a7e30715630e566c4943941469b8a"
    );
    assert!(!WIRE.contains("commentary") && !FULL.contains("commentary"));
    assert!(!PROMPT.contains("commentary"));
    assert!(PROMPT_TRANSFORMED.contains("commentary"));
}

#[test]
fn only_the_transformed_verifier_requires_the_commentary_axis() {
    let i = input(&[1, 2, 3, 4], 3);
    let direct_output = json!({"schemaVersion": 1, "candidates": [candidate(1, 3)]});
    let transformed_output = json!({"schemaVersion": 1, "candidates": [transformed(1, 3)]});
    assert!(all_for(VideoKind::Direct, &i, &direct_output).is_empty());
    assert!(all_for(VideoKind::Transformed, &i, &transformed_output).is_empty());
    // Sem o 6º eixo, o transformado recusa; com ele, o Corte direto o ignora.
    let missing = all_for(VideoKind::Transformed, &i, &direct_output);
    assert!(missing.contains(&"score_out_of_range"), "{missing:?}");
    assert!(missing.contains(&"empty_reason"), "{missing:?}");
    assert!(all_for(VideoKind::Direct, &i, &transformed_output).is_empty());
    let mut bad = transformed(1, 3);
    bad["commentary"] = json!({"score": 11, "why": " "});
    let codes = all_for(VideoKind::Transformed, &i, &json!({"candidates": [bad]}));
    assert!(codes.contains(&"score_out_of_range") && codes.contains(&"empty_reason"));
}

#[test]
fn transformed_full_schema_requires_the_commentary_axis_and_bounds_its_score() {
    let (_, full) = ai_task::check_definition(task_for(VideoKind::Transformed)).unwrap();
    let validator = jsonschema::validator_for(&full).unwrap();
    let ok = json!({"schemaVersion": 1, "candidates": [transformed(1, 2)]});
    assert!(validator.is_valid(&ok));
    assert!(!validator.is_valid(&json!({"schemaVersion": 1, "candidates": [candidate(1, 2)]})));
    let mut bad = transformed(1, 2);
    bad["commentary"]["score"] = json!(11);
    assert!(!validator.is_valid(&json!({"schemaVersion": 1, "candidates": [bad]})));
}

#[test]
fn the_video_kind_of_a_request_defaults_to_direct_and_rejects_unknown_values() {
    assert_eq!(parse_kind(&json!({})).unwrap(), VideoKind::Direct);
    assert_eq!(
        parse_kind(&json!({"videoKind": "transformed"})).unwrap(),
        VideoKind::Transformed
    );
    for bad in [json!("dark"), json!(3), json!("")] {
        assert_eq!(
            parse_kind(&json!({"videoKind": bad})).unwrap_err().code,
            "invalid_video_kind"
        );
    }
}

#[test]
fn the_transformed_task_routes_as_the_selection_task() {
    assert_eq!(ai_task::routing_id(TASK_ID_TRANSFORMED), TASK_ID);
    assert_eq!(ai_task::routing_id(TASK_ID), TASK_ID);
    assert!(is_job_kind(JOB_KIND) && is_job_kind(JOB_KIND_TRANSFORMED));
    assert!(!is_job_kind("ai:packaging"));
}

#[test]
fn selection_console_emits_window_progress_and_never_leaks_content() {
    let root = tempfile::tempdir().expect("tempdir");
    let data_dir = root.path().join("data");
    let _guard = crate::test_env::set_data_dir(&data_dir);

    crate::dispatch(
        "projects.create",
        json!({"parent": root.path(), "name": "SelConsole"}),
        &mut |_| {},
    )
    .expect("projects.create");
    crate::dispatch(
        "provider.configure",
        json!({
            "endpoint": "http://127.0.0.1:9/v1",
            "kind": "openai",
            "model": "qwen-sel-local",
            "context": 32768
        }),
        &mut |_| {},
    )
    .expect("provider.configure");

    let secret_sentence = "TEXTO_SECRETO_FRASES_SELECAO_123";
    let secret_title = "TITULO_SECRETO_CANDIDATO_456";
    let secret_why = "JUSTIFICATIVA_SECRETA_789";

    let source_id = projects::with_writer(|c| {
        // Impede o worker da fila de tentar HTTP real durante este teste unitário.
        c.execute(
            "INSERT INTO ai_pauses(scope,key,reason) VALUES ('task','selection','user')",
            [],
        )?;
        c.execute(
            "INSERT INTO sources(path,size,duration_us,partial_hash,metadata,permission,audio_track) VALUES (?1,100,60000000,'h','{}','{}',0)",
            [r"C:\Users\MariaSecreta\Videos\live_secreta.mp4"],
        )?;
        let src = c.last_insert_rowid();
        c.execute(
            "INSERT INTO transcripts(source_id,audio_track,engine,model,revision,compute_type,state,resume_us,duration_us) VALUES (?1,0,'local','small','r','int8','complete',60000000,60000000)",
            [src],
        )?;
        let tr = c.last_insert_rowid();
        for pos in 0..20 {
            let text = if pos == 19 {
                format!(" {secret_sentence}.")
            } else {
                " palavra".to_owned()
            };
            c.execute(
                "INSERT INTO transcript_words(transcript_id,position,kind,text,start_us,end_us,language) VALUES (?1,?2,'word',?3,?4,?5,'pt')",
                (tr, pos, text, pos * 1_500_000, (pos + 1) * 1_500_000),
            )?;
        }
        Ok(src)
    })
    .expect("seed transcript");

    let seq_before = crate::dispatch("console.history", json!({}), &mut |_| {})
        .unwrap()["items"]
        .as_array()
        .and_then(|a| a.last())
        .and_then(|e| e["seq"].as_u64())
        .unwrap_or(0);

    let started = crate::dispatch(
        "selection.start",
        json!({"source_id": source_id, "confirmed": true}),
        &mut |_| {},
    )
    .expect("selection.start");
    let run = started["run"].as_i64().expect("run id");

    // Simula conclusão da Janela 0 com candidato contendo título/justificativa secretos.
    let cand_data = json!({
        "schemaVersion": 1,
        "candidates": [{
            "startId": 1,
            "endId": 1,
            "title": secret_title,
            "hook": {"score": 8, "why": secret_why},
            "selfContained": {"score": 7, "why": secret_why},
            "energy": {"score": 7, "why": secret_why},
            "value": {"score": 8, "why": secret_why},
            "closing": {"score": 7, "why": secret_why}
        }]
    });
    projects::with_writer(|c| {
        let job_id: i64 = c.query_row(
            "SELECT job_id FROM selection_windows WHERE run_id=?1 AND idx=0",
            [run],
            |r| r.get(0),
        )?;
        let res = json!({"outcome": "ok", "data": cand_data}).to_string();
        c.execute(
            "UPDATE jobs SET state='completed', result=?2 WHERE id=?1",
            (job_id, res),
        )?;
        Ok(())
    })
    .expect("complete window 0");

    advance(run).expect("advance run");

    let run2 = crate::dispatch(
        "selection.start",
        json!({"source_id": source_id, "confirmed": true}),
        &mut |_| {},
    )
    .expect("selection.start 2")["run"]
        .as_i64()
        .expect("run2 id");
    crate::dispatch("selection.cancel", json!({"run": run2}), &mut |_| {})
        .expect("selection.cancel");

    let items: Vec<Value> = crate::dispatch("console.history", json!({}), &mut |_| {})
        .unwrap()["items"]
        .as_array()
        .cloned()
        .unwrap_or_default()
        .into_iter()
        .filter(|e| {
            e["seq"].as_u64().unwrap_or(0) > seq_before
                && (e["job"] == format!("selection-{run}")
                    || e["job"] == format!("selection-{run2}"))
        })
        .collect();

    let joined = serde_json::to_string(&items).unwrap();
    assert!(items.iter().all(|e| e["origin"] == "ai"), "{joined}");
    assert!(joined.contains("Seleção de Cortes"), "{joined}");
    assert!(joined.contains("qwen-sel-local"), "{joined}");
    assert!(joined.contains("Janela(s)"), "{joined}");
    assert!(joined.contains("Seleção de Cortes concluída"), "{joined}");
    assert!(joined.contains("Seleção de Cortes cancelada"), "{joined}");
    assert!(!joined.contains(secret_sentence), "leaked transcript!");
    assert!(!joined.contains(secret_title), "leaked candidate title!");
    assert!(!joined.contains(secret_why), "leaked justification!");
    assert!(!joined.contains("MariaSecreta"), "leaked personal path!");
    assert!(!joined.contains("live_secreta.mp4"), "leaked source name!");

    let _ = crate::dispatch("projects.close", json!({}), &mut |_| {});
}
