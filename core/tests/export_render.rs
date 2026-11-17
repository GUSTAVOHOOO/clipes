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

struct FakeFfmpeg {
    _dir: tempfile::TempDir,
    bin: PathBuf,
    conf: PathBuf,
}

impl FakeFfmpeg {
    /// Copia o binário falso para um diretório isolado do teste, evitando corrida por variáveis globais.
    fn new() -> Self {
        let dir = tempfile::tempdir().unwrap();
        let bin = dir
            .path()
            .join(format!("fake-export{}", std::env::consts::EXE_SUFFIX));
        fs::copy(env!("CARGO_BIN_EXE_fake-export"), &bin).unwrap();
        let conf = dir.path().join("fake-export.conf");
        fs::write(&conf, "").unwrap();
        Self {
            _dir: dir,
            bin,
            conf,
        }
    }

    fn path(&self) -> &Path {
        &self.bin
    }

    fn set(&self, content: &str) {
        fs::write(&self.conf, content).unwrap();
    }
}

#[test]
fn missing_ass_failures_cancellation_and_existing_destinations_never_leave_partials() {
    let root = tempfile::tempdir().unwrap();
    let source = root.path().join("original.mp4");
    fs::write(&source, b"source").unwrap();
    let output = root.path().join("corte.mp4");
    let ffmpeg = FakeFfmpeg::new();
    let token = CancelToken::new();
    ffmpeg.set("NO_ASS=1\n");
    let error = render(ffmpeg.path(), &input(&source, &output), &token, &mut |_| {}).unwrap_err();
    assert_eq!(error.code, "export_ass_missing");
    assert_eq!(files(root.path()), vec![source.clone()]);
    ffmpeg.set("EXPORT_FAIL=1\n");
    assert_eq!(
        render(ffmpeg.path(), &input(&source, &output), &token, &mut |_| {})
            .unwrap_err()
            .code,
        "export_failed"
    );
    assert_eq!(files(root.path()), vec![source.clone()]);
    ffmpeg.set(&format!("EXPORT_STATE={}\n", root.path().to_str().unwrap()));
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
            render(ffmpeg.path(), &input(&source, &output), &token, &mut |_| {})
                .unwrap_err()
                .code,
            "cancelled"
        );
    });
    ffmpeg.set("");
    fs::remove_file(started).unwrap();
    assert_eq!(files(root.path()), vec![source.clone()]);
    fs::write(&output, b"keep").unwrap();
    assert_eq!(
        render(
            ffmpeg.path(),
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
    let ffmpeg = FakeFfmpeg::new();
    let mut bad = input(&source, &output);
    bad.words[0].text = "来".into();
    ffmpeg.set("NO_ASS=1\n");
    let error = render(ffmpeg.path(), &bad, &CancelToken::new(), &mut |_| {}).unwrap_err();
    assert_eq!(error.code, "export_glyph_missing");
    let usage = error.usage.expect("usage details");
    assert_eq!(usage["missing_glyphs"][0]["word"], "来");
    assert_eq!(usage["missing_glyphs"][0]["codepoint"], "U+6765");
    assert_eq!(files(root.path()), vec![source]);
}
