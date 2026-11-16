use clipes_core::{
    export::{
        captions::CaptionWord,
        render::{render, RenderInput},
    },
    provider::CancelToken,
};
use std::{
    fs,
    path::{Path, PathBuf},
    time::{Duration, Instant},
};

fn input(source: &Path, output: &Path) -> RenderInput {
    RenderInput {
        source: source.into(),
        output: output.into(),
        start_us: 0,
        end_us: 1_000_000,
        audio_track: 1,
        words: vec![CaptionWord {
            text: "fala".into(),
            start_us: 0,
            end_us: 800_000,
        }],
        crop: Vec::new(),
    }
}
fn files(path: &Path) -> Vec<PathBuf> {
    fs::read_dir(path)
        .unwrap()
        .map(|f| f.unwrap().path())
        .collect()
}

#[test]
fn missing_ass_failures_cancellation_and_existing_destinations_never_leave_partials() {
    let root = tempfile::tempdir().unwrap();
    let source = root.path().join("original.mp4");
    fs::write(&source, b"source").unwrap();
    let output = root.path().join("corte.mp4");
    let ffmpeg = Path::new(env!("CARGO_BIN_EXE_fake-export"));
    let token = CancelToken::new();
    std::env::set_var("CLIPES_FAKE_NO_ASS", "1");
    let error = render(ffmpeg, &input(&source, &output), &token, &mut |_| {}).unwrap_err();
    assert_eq!(error.code, "export_ass_missing");
    assert_eq!(files(root.path()), vec![source.clone()]);
    std::env::remove_var("CLIPES_FAKE_NO_ASS");
    std::env::set_var("CLIPES_FAKE_EXPORT_FAIL", "1");
    assert_eq!(
        render(ffmpeg, &input(&source, &output), &token, &mut |_| {})
            .unwrap_err()
            .code,
        "export_failed"
    );
    assert_eq!(files(root.path()), vec![source.clone()]);
    std::env::remove_var("CLIPES_FAKE_EXPORT_FAIL");
    std::env::set_var("CLIPES_FAKE_EXPORT_STATE", root.path());
    let cancel = token.clone();
    let started = root.path().join("started");
    std::thread::scope(|scope| {
        scope.spawn(|| {
            let deadline = Instant::now() + Duration::from_secs(10);
            while !started.exists() {
                assert!(Instant::now() < deadline);
                std::thread::sleep(Duration::from_millis(10));
            }
            cancel.cancel();
        });
        assert_eq!(
            render(ffmpeg, &input(&source, &output), &token, &mut |_| {})
                .unwrap_err()
                .code,
            "cancelled"
        );
    });
    std::env::remove_var("CLIPES_FAKE_EXPORT_STATE");
    fs::remove_file(started).unwrap();
    assert_eq!(files(root.path()), vec![source.clone()]);
    fs::write(&output, b"keep").unwrap();
    assert_eq!(
        render(
            ffmpeg,
            &input(&source, &output),
            &CancelToken::new(),
            &mut |_| {}
        )
        .unwrap_err()
        .code,
        "export_exists"
    );
    assert_eq!(fs::read(output).unwrap(), b"keep");
}

#[test]
fn missing_glyph_fails_before_invoking_ffmpeg() {
    let root = tempfile::tempdir().unwrap();
    let source = root.path().join("original.mp4");
    fs::write(&source, b"source").unwrap();
    let output = root.path().join("corte.mp4");
    let ffmpeg = Path::new(env!("CARGO_BIN_EXE_fake-export"));
    let mut bad = input(&source, &output);
    bad.words[0].text = "来".into();
    std::env::set_var("CLIPES_FAKE_NO_ASS", "1");
    let error = render(ffmpeg, &bad, &CancelToken::new(), &mut |_| {}).unwrap_err();
    std::env::remove_var("CLIPES_FAKE_NO_ASS");
    assert_eq!(error.code, "export_glyph_missing");
    let usage = error.usage.expect("usage details");
    assert_eq!(usage["missing_glyphs"][0]["word"], "来");
    assert_eq!(usage["missing_glyphs"][0]["codepoint"], "U+6765");
    assert_eq!(files(root.path()), vec![source]);
}
