//! The same name+JSON seam as the UI; fake worker, isolated Project, no network.
use clipes_core::{dispatch, projects::with_writer};
use serde_json::{json, Value};
use sha2::{Digest, Sha256};
use std::{
    fs,
    time::{Duration, Instant},
};

fn call(name: &str, args: Value) -> Value {
    dispatch(name, args, &mut |_| {}).unwrap()
}
fn wait(id: &Value) -> Value {
    let deadline = Instant::now() + Duration::from_secs(30);
    loop {
        let status = call("reframe.status", json!({"id":id}));
        if matches!(
            status["state"].as_str(),
            Some("completed" | "failed" | "cancelled")
        ) {
            return status;
        }
        assert!(Instant::now() < deadline, "{status}");
        std::thread::sleep(Duration::from_millis(20));
    }
}

#[test]
fn chosen_interval_runs_locally_persists_and_cancels_without_partial_suggestion() {
    let root = tempfile::tempdir().unwrap();
    let data = root.path().join("data");
    std::env::set_var("CLIPES_DATA_DIR", &data);
    std::env::set_var("CLIPES_FAKE_WORKER_MODE", "transcribe");
    let log = root.path().join("request.json");
    std::env::set_var("CLIPES_FAKE_REFRAME_LOG", &log);
    let venv = if cfg!(windows) {
        "worker/venv/Scripts/python.exe"
    } else {
        "worker/venv/bin/python"
    };
    let python = data.join(venv);
    fs::create_dir_all(python.parent().unwrap()).unwrap();
    fs::copy(env!("CARGO_BIN_EXE_fake-worker"), &python).unwrap();
    fs::write(data.join("worker/worker.state.json"), b"{\"cuda\":false}").unwrap();
    let model = data.join("models/yunet");
    fs::create_dir_all(&model).unwrap();
    fs::write(
        model.join("model.state.json"),
        br#"{"revision":"48b10fa505aeb51fbd127fc60a5c660040e823b7"}"#,
    )
    .unwrap();
    fs::write(model.join("face_detection_yunet_2023mar.onnx"), b"fake").unwrap();
    call(
        "components.settings.set",
        json!({"data_dir":data,"cache_dir":root.path().join("cache"),"cache_limit_bytes":1000000,"ffmpeg_path":python}),
    );
    let project = call(
        "projects.create",
        json!({"parent":root.path(),"name":"Canal"}),
    );
    call("projects.local_only.set", json!({"enabled":true}));
    let media = root.path().join("source.mp4");
    fs::write(&media, b"synthetic source for fake worker").unwrap();
    let bytes = fs::read(&media).unwrap();
    let hash = format!("{:x}", Sha256::digest(bytes.repeat(3)));
    with_writer(|c| {
        c.execute("INSERT INTO sources(id,path,size,duration_us,partial_hash,metadata,permission,audio_track) VALUES (1,?1,?2,10000000,?3,'{\"streams\":[]}','{}',0)", (media.to_str(), bytes.len() as i64, hash))?;
        Ok(())
    }).unwrap();
    let err = dispatch(
        "reframe.start",
        json!({"source":1,"startUs":2000000,"endUs":4000000}),
        &mut |_| {},
    )
    .unwrap_err();
    assert_eq!(err.code, "reframe_not_chosen");
    for bounds in [(-1, 2), (4, 4), (0, 10000001)] {
        assert_eq!(
            dispatch(
                "reframe.start",
                json!({"source":1,"startUs":bounds.0,"endUs":bounds.1,"requested":true}),
                &mut |_| {}
            )
            .unwrap_err()
            .code,
            "invalid_reframe"
        );
    }
    let args = json!({"source":1,"startUs":2000000,"endUs":4000000,"requested":true});
    let started = call("reframe.start", args.clone());
    assert_eq!(call("reframe.start", args.clone())["id"], started["id"]);
    let status = wait(&started["id"]);
    assert_eq!(status["state"], "completed", "{status}");
    let timeline = &status["timeline"];
    assert_eq!(timeline["status"], "suggestion");
    assert_eq!(timeline["schemaVersion"], 1);
    assert_eq!(timeline["segments"][0]["keyframes"][0]["timeUs"], 2000000);
    let sent: Value = serde_json::from_slice(&fs::read(&log).unwrap()).unwrap();
    assert_eq!(sent["start_us"], 2000000);
    assert_eq!(sent["end_us"], 4000000);
    assert!(!timeline.to_string().contains("source.mp4"));
    call("projects.close", json!({}));
    call("projects.open", json!({"path":project["path"]}));
    assert_eq!(
        call("reframe.status", json!({"id":started["id"]}))["timeline"],
        *timeline
    );

    // Approval is enforced by the core, and adjusted sentence boundaries win
    // over the original candidate times and anything a caller could supply.
    with_writer(|c| {
        c.execute("INSERT INTO transcripts(id,source_id,audio_track,engine,model,revision,compute_type,state,resume_us,duration_us) VALUES (1,1,0,'local','m','r','int8','complete',10000000,10000000)", [])?;
        for i in 1..=4i64 {
            c.execute("INSERT INTO sentences(transcript_id,id,first_position,last_position,start_us,end_us,text) VALUES (1,?1,?1,?1,?2,?3,'x')", (i, (i-1)*2000000,i*2000000))?;
        }
        c.execute("INSERT INTO selection_runs(id,transcript_id,task_version,prompt_sha256,state,min_us,max_us,weights,plan_state,windows_total) VALUES (1,1,1,'hash','completed',1000000,10000000,'{}','ready',1)", [])?;
        c.execute("INSERT INTO selection_candidates(id,run_id,rank,start_id,end_id,start_us,end_us,axes,total_centi,windows) VALUES (1,1,1,1,2,0,4000000,'{}',1,'[]')", [])?;
        Ok(())
    }).unwrap();
    assert_eq!(
        dispatch("reframe.start", json!({"candidate":1}), &mut |_| {})
            .unwrap_err()
            .code,
        "reframe_not_chosen"
    );
    call(
        "selection.decide",
        json!({"candidate":1,"decision":"approved"}),
    );
    call(
        "selection.adjust",
        json!({"candidate":1,"edge":"start","delta":1}),
    );
    assert_eq!(
        call("reframe.start", json!({"candidate":1}))["id"],
        started["id"]
    );
    call(
        "selection.decide",
        json!({"candidate":1,"decision":"rejected"}),
    );
    assert_eq!(
        dispatch("reframe.start", json!({"candidate":1}), &mut |_| {})
            .unwrap_err()
            .code,
        "reframe_not_chosen"
    );

    let hold = root.path().join("hold");
    fs::write(&hold, b"hold").unwrap();
    std::env::set_var("CLIPES_FAKE_WORKER_HOLD", &hold);
    let cancelled = call(
        "reframe.start",
        json!({"source":1,"startUs":4000000,"endUs":6000000,"requested":true}),
    );
    let deadline = Instant::now() + Duration::from_secs(10);
    while call("reframe.status", json!({"id":cancelled["id"]}))["state"] != "running" {
        assert!(Instant::now() < deadline);
        std::thread::sleep(Duration::from_millis(20));
    }
    call("jobs.cancel", json!({"id":cancelled["job"]}));
    let result = wait(&cancelled["id"]);
    assert_eq!(result["state"], "cancelled");
    assert!(result["timeline"].is_null());
    fs::remove_file(hold).unwrap();
    std::env::remove_var("CLIPES_FAKE_WORKER_HOLD");
    // Worker output is untrusted even when its protocol envelope is valid.
    std::env::set_var("CLIPES_FAKE_REFRAME_INVALID", "1");
    let bad = call(
        "reframe.start",
        json!({"source":1,"startUs":6000000,"endUs":8000000,"requested":true}),
    );
    let bad = wait(&bad["id"]);
    assert_eq!(bad["state"], "failed");
    assert_eq!(bad["error"]["code"], "worker_protocol");
    assert!(bad["timeline"].is_null());
    call("projects.close", json!({}));
}
