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

fn all(input: &TaskInput, output: &Value) -> Vec<&'static str> {
    task()
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
