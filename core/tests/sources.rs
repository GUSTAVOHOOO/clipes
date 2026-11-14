use clipes_core::dispatch;
use serde_json::json;
use std::{
    fs,
    process::Command,
    time::{SystemTime, UNIX_EPOCH},
};

#[test]
fn local_source_lifecycle() {
    if Command::new("ffmpeg").arg("-version").output().is_err()
        || Command::new("ffprobe").arg("-version").output().is_err()
    {
        eprintln!("Skipping: ffmpeg and ffprobe are required to generate the temporary fixture");
        return;
    }
    let root = std::env::temp_dir().join(format!(
        "clipes-source-{}-{}",
        std::process::id(),
        SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap()
            .as_nanos()
    ));
    fs::create_dir_all(&root).unwrap();
    std::env::set_var("CLIPES_DATA_DIR", root.join("data"));
    let media = root.join("source.mkv");
    assert!(Command::new("ffmpeg")
        .args([
            "-v",
            "error",
            "-f",
            "lavfi",
            "-i",
            "color=c=black:s=64x64:d=1",
            "-f",
            "lavfi",
            "-i",
            "sine=frequency=440:duration=1",
            "-f",
            "lavfi",
            "-i",
            "sine=frequency=880:duration=1",
            "-map",
            "0:v",
            "-map",
            "1:a",
            "-map",
            "2:a",
            "-c:v",
            "mpeg4",
            "-c:a",
            "pcm_s16le",
            "-y"
        ])
        .arg(&media)
        .status()
        .unwrap()
        .success());
    let run = |name, args| dispatch(name, args, &mut |_| {});
    let project = run("projects.create", json!({"parent":root,"name":"Canal"})).unwrap();
    let project = project["path"].as_str().unwrap();
    let source=run("sources.import",json!({"project":project,"path":media,"permission":{"status":"none"},"audio_track":2,"copy":false})).unwrap();
    let id = source["id"].as_i64().unwrap();
    assert_eq!(source["permission"]["status"], "none");
    assert_eq!(source["available"], true);
    assert_eq!(source["metadata"]["streams"][0]["width"], 64);
    assert_eq!(source["audio_track"], 2);
    assert_eq!(
        source["metadata"]["streams"]
            .as_array()
            .unwrap()
            .iter()
            .filter(|s| s["codec_type"] == "audio")
            .count(),
        2
    );
    assert_eq!(run("sources.import",json!({"project":project,"path":media,"permission":{"status":"granted","who":"A"},"audio_track":2})).unwrap_err().code,"invalid_permission");
    run(
        "sources.hash",
        json!({"project":project,"id":id,"job":"test-hash"}),
    )
    .unwrap();
    let replacement = root.join("replacement.mkv");
    fs::rename(&media, &replacement).unwrap();
    fs::copy(&replacement, &media).unwrap();
    fs::remove_file(&replacement).unwrap();
    let file = fs::OpenOptions::new().write(true).open(&media).unwrap();
    file.set_times(
        fs::FileTimes::new()
            .set_modified(UNIX_EPOCH + std::time::Duration::from_secs(1_000_000_000)),
    )
    .unwrap();
    drop(file);
    let altered = run("sources.list", json!({"project":project})).unwrap();
    assert_eq!(altered[0]["status"], "changed");
    assert_eq!(altered[0]["available"], false);
    run(
        "sources.hash",
        json!({"project":project,"id":id,"job":"verify-changed"}),
    )
    .unwrap();
    assert_eq!(
        run("sources.list", json!({"project":project})).unwrap()[0]["status"],
        "available"
    );
    let original = fs::read(&media).unwrap();
    let mut changed = original.clone();
    changed[0] ^= 1;
    fs::write(&media, &changed).unwrap();
    assert_eq!(
        run("sources.list", json!({"project":project})).unwrap()[0]["available"],
        false
    );
    fs::write(&media, &original).unwrap();
    let moved = root.join("moved.mkv");
    fs::rename(&media, &moved).unwrap();
    assert_eq!(
        run("sources.list", json!({"project":project})).unwrap()[0]["available"],
        false
    );
    let other = root.join("other.mkv");
    fs::write(&other, b"different").unwrap();
    assert_eq!(
        run(
            "sources.relocate",
            json!({"project":project,"id":id,"path":other})
        )
        .unwrap_err()
        .code,
        "source_mismatch"
    );
    run(
        "sources.relocate",
        json!({"project":project,"id":id,"path":moved}),
    )
    .unwrap();
    assert_eq!(
        run("sources.list", json!({"project":project})).unwrap()[0]["available"],
        true
    );
    let copied = run("sources.import", json!({"project":project,"path":moved,"permission":{"status":"granted","who":"Criador","where":"Email","scope":"tradução"},"audio_track":2,"copy":true})).unwrap();
    assert_eq!(copied["permission"]["scope"], "tradução");
    assert_eq!(copied["verified"], true);
    assert!(std::path::Path::new(copied["path"].as_str().unwrap())
        .starts_with(std::path::Path::new(project).join("media")));
    let unverified = run(
        "sources.import",
        json!({"project":project,"path":moved,"permission":{"status":"none"},"audio_track":2}),
    )
    .unwrap();
    let unverified_id = unverified["id"].as_i64().unwrap();
    assert_eq!(
        run(
            "sources.relocate",
            json!({"project":project,"id":unverified_id,"path":moved})
        )
        .unwrap_err()
        .code,
        "confirmation_required"
    );
    assert!(run(
        "sources.relocate",
        json!({"project":project,"id":unverified_id,"path":moved,"confirmed":true})
    )
    .is_ok());
    let mut job_blocks_close = false;
    run(
        "sources.hash",
        json!({"project":project,"id":id,"job":"guard-test"}),
    )
    .unwrap();
    dispatch(
        "sources.hash",
        json!({"project":project,"id":id,"job":"guard-observe"}),
        &mut |_| {
            job_blocks_close = dispatch("projects.close", json!({}), &mut |_| {})
                .unwrap_err()
                .code
                == "project_busy";
        },
    )
    .unwrap();
    assert!(job_blocks_close);
    let mut emitted = false;
    let result = dispatch(
        "sources.hash",
        json!({"project":project,"id":id,"job":"cancel-test"}),
        &mut |_| {
            emitted = true;
            dispatch("sources.cancel", json!({"job":"cancel-test"}), &mut |_| {}).unwrap();
        },
    );
    assert!(emitted);
    assert_eq!(result.unwrap_err().code, "cancelled");
    // A different file can match all three sampled blocks; the full hash must reject it.
    let large = root.join("large.mkv");
    fs::copy(&moved, &large).unwrap();
    {
        let file = fs::OpenOptions::new().write(true).open(&large).unwrap();
        file.set_len(20 * 1024 * 1024).unwrap();
    }
    let large_source = run(
        "sources.import",
        json!({"project":project,"path":large,"permission":{"status":"none"},"audio_track":2}),
    )
    .unwrap();
    let large_id = large_source["id"].as_i64().unwrap();
    run(
        "sources.hash",
        json!({"project":project,"id":large_id,"job":"large-hash"}),
    )
    .unwrap();
    let impostor = root.join("impostor.mkv");
    fs::copy(&large, &impostor).unwrap();
    {
        use std::io::{Seek, SeekFrom, Write};
        let mut file = fs::OpenOptions::new().write(true).open(&impostor).unwrap();
        file.seek(SeekFrom::Start(5 * 1024 * 1024)).unwrap();
        file.write_all(&[1]).unwrap();
    }
    assert_eq!(
        run(
            "sources.relocate",
            json!({"project":project,"id":large_id,"path":impostor})
        )
        .unwrap_err()
        .code,
        "source_mismatch"
    );
    fs::copy(&impostor, &large).unwrap();
    assert_eq!(
        run(
            "sources.hash",
            json!({"project":project,"id":large_id,"job":"check-changed"})
        )
        .unwrap_err()
        .code,
        "confirmation_required"
    );
    assert_eq!(
        run("sources.list", json!({"project":project}))
            .unwrap()
            .as_array()
            .unwrap()
            .iter()
            .find(|s| s["id"] == large_id)
            .unwrap()["status"],
        "changed"
    );
    run(
        "sources.hash",
        json!({"project":project,"id":large_id,"job":"confirm-changed","confirmed":true}),
    )
    .unwrap();
    assert_eq!(
        run("sources.list", json!({"project":project}))
            .unwrap()
            .as_array()
            .unwrap()
            .iter()
            .find(|s| s["id"] == large_id)
            .unwrap()["status"],
        "available"
    );
    let moved_project = root.join("Canal-movido.clipes");
    run("projects.close", json!({})).unwrap();
    fs::rename(project, &moved_project).unwrap();
    let reopened = run("projects.open", json!({"path":moved_project})).unwrap();
    let items = run("sources.list", json!({"project":reopened["path"]})).unwrap();
    let copy = items
        .as_array()
        .unwrap()
        .iter()
        .find(|s| s["id"] == copied["id"])
        .unwrap();
    assert_eq!(copy["available"], true);
    run("projects.close", json!({})).unwrap();
    fs::remove_dir_all(root).unwrap();
}
