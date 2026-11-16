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
