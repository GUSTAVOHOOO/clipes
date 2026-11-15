//! Contrato do editor pelo harness headless, sem rede e com dados isolados.
use clipes_core::{dispatch, projects::with_writer};
use serde_json::{json, Value};

fn call(name: &str, value: Value) -> Value {
    dispatch(name, value, &mut |_| {}).unwrap()
}

#[test]
fn editor_uses_sentence_borders_limits_and_only_the_proxy_window() {
    let root = tempfile::tempdir().unwrap();
    std::env::set_var("CLIPES_DATA_DIR", root.path().join("data"));
    call(
        "projects.create",
        json!({"parent":root.path(),"name":"Editor"}),
    );
    let source = with_writer(|c| {
        c.execute("INSERT INTO sources(path,size,duration_us,partial_hash,metadata,permission,audio_track) VALUES ('local.mp4',1,7200000000,'h',?1,'{}',0)", [r#"{"streams":[{"codec_type":"video","avg_frame_rate":"24000/1001"}]}"#])?;
        let source = c.last_insert_rowid();
        c.execute("INSERT INTO transcripts(source_id,audio_track,engine,model,revision,compute_type,state,resume_us,duration_us) VALUES (?1,0,'local','m','r','c','complete',7200000000,7200000000)", [source])?;
        let transcript = c.last_insert_rowid();
        for id in 1..=720 {
            c.execute("INSERT INTO sentences(transcript_id,id,first_position,last_position,start_us,end_us,text) VALUES (?1,?2,?2,?2,?3,?4,?5)", (transcript,id,(id-1)*10_000_000i64,id*10_000_000i64,format!("Frase {id}")))?;
        }
        Ok(source)
    }).unwrap();
    let request = json!({"source_id":source,"start_id":361,"end_id":366});
    let opened = call("editor.open", request.clone());
    assert_eq!(opened["request"], request);
    assert_eq!(opened["startUs"], 3_600_000_000i64);
    assert_eq!(opened["endUs"], 3_660_000_000i64);
    assert_eq!(opened["windowStartUs"], 3_480_000_000i64);
    assert_eq!(opened["windowEndUs"], 3_780_000_000i64);
    assert!((opened["fps"].as_f64().unwrap() - 24000.0 / 1001.0).abs() < 0.001);
    let page = call(
        "editor.sentences",
        json!({"source_id":source,"start_us":3_480_000_000i64,"end_us":3_780_000_000i64,"after_id":0,"limit":5}),
    );
    assert_eq!(page.as_array().unwrap().len(), 5);
    assert_eq!(page[0]["id"], 349);
    let next = call(
        "editor.sentences",
        json!({"source_id":source,"start_us":3_480_000_000i64,"end_us":3_780_000_000i64,"after_id":353,"limit":500}),
    );
    assert_eq!(next.as_array().unwrap().len(), 25);
    for (end, code) in [
        (361, "adjust_too_short"),
        (380, "adjust_too_long"),
        (360, "adjust_empty"),
        (900, "unknown_sentence_id"),
    ] {
        let err = dispatch(
            "editor.range",
            json!({"source_id":source,"start_id":361,"end_id":end}),
            &mut |_| {},
        )
        .unwrap_err();
        assert_eq!(err.code, code);
        assert!(!err.message.contains("local.mp4"));
    }
    let err = dispatch(
        "editor.sentences",
        json!({"source_id":source,"start_us":0,"end_us":7_200_000_000i64}),
        &mut |_| {},
    )
    .unwrap_err();
    assert_eq!(err.code, "invalid_range");
    call("projects.close", json!({}));
}
