//! Teste real do #62 com o FFmpeg do sistema e mídia sintética: pula quando não há FFmpeg ou
//! encoder de hardware. Roda sem rede e com dados isolados. Use `--nocapture` para ver o
//! encoder escolhido e os tempos de um export de 30 s com o encoder de hardware contra o x264.
use clipes_core::{
    dispatch,
    export::{
        captions::CaptionWord,
        encoder::{self, X264},
        render::{render_with, RenderInput},
    },
    provider::CancelToken,
};
use serde_json::{json, Value};
use std::{fs, path::Path, process::Command, time::Instant};

fn run(program: &str, args: &[&str]) -> Option<String> {
    let output = Command::new(program).args(args).output().ok()?;
    output
        .status
        .success()
        .then(|| String::from_utf8_lossy(&output.stdout).into_owned())
}

fn codec(file: &Path) -> String {
    run(
        "ffprobe",
        &[
            "-v",
            "error",
            "-select_streams",
            "v:0",
            "-show_entries",
            "stream=codec_name,width,height",
            "-of",
            "csv=p=0",
            file.to_str().unwrap(),
        ],
    )
    .unwrap_or_default()
    .trim()
    .to_owned()
}

#[test]
fn real_ffmpeg_detects_a_working_encoder_and_exports_30_seconds() {
    if run("ffmpeg", &["-version"]).is_none() || run("ffprobe", &["-version"]).is_none() {
        eprintln!("pulado: FFmpeg/ffprobe do sistema indisponíveis");
        return;
    }
    let root = tempfile::tempdir().unwrap();
    let data = root.path().join("data");
    fs::create_dir_all(&data).unwrap();
    std::env::set_var("CLIPES_DATA_DIR", &data);
    dispatch(
        "components.settings.set",
        json!({"data_dir":data,"cache_dir":data.join("cache"),"cache_limit_bytes":1_000_000,"ffmpeg_path":null}),
        &mut |_| {},
    )
    .unwrap();
    dispatch(
        "components.ffmpeg.system",
        json!({"path":"ffmpeg"}),
        &mut |_| {},
    )
    .unwrap();
    let cancel = CancelToken::new();
    let started = Instant::now();
    let chosen = encoder::resolve(Path::new("ffmpeg"), &cancel).unwrap();
    let status = dispatch("export.encoder.status", json!({}), &mut |_| {}).unwrap();
    eprintln!(
        "encoder escolhido: {chosen} (detecção em {:.1}s; passaram: {})",
        started.elapsed().as_secs_f32(),
        status["passed"]
    );
    assert_eq!(status["detected"], true);
    assert_eq!(status["passed"].as_array().unwrap().last().unwrap(), X264);
    if chosen == X264 {
        eprintln!("pulado: nenhum encoder de hardware passou no teste");
        return;
    }

    // Fonte sintética de 30 s com vídeo e áudio.
    let source = root.path().join("fonte.mp4");
    run(
        "ffmpeg",
        &[
            "-hide_banner",
            "-loglevel",
            "error",
            "-f",
            "lavfi",
            "-i",
            "testsrc2=size=1920x1080:rate=30:duration=30",
            "-f",
            "lavfi",
            "-i",
            "sine=frequency=440:duration=30",
            "-c:v",
            "libx264",
            "-preset",
            "ultrafast",
            "-c:a",
            "aac",
            "-shortest",
            "-y",
            source.to_str().unwrap(),
        ],
    )
    .expect("fonte sintética");
    let mut timings = Vec::new();
    for name in [chosen.as_str(), X264] {
        let output = root.path().join(format!("corte-{name}.mp4"));
        let input = RenderInput {
            source: source.clone(),
            output: output.clone(),
            start_us: 0,
            end_us: 30_000_000,
            audio_track: 1,
            words: vec![CaptionWord {
                text: "fala".into(),
                start_us: 0,
                end_us: 800_000,
            }],
            crop: Vec::new(),
        };
        let started = Instant::now();
        render_with(Path::new("ffmpeg"), &input, name, &cancel, &mut |_| {}).unwrap();
        let seconds = started.elapsed().as_secs_f32();
        assert_eq!(codec(&output), "h264,1080,1920", "{name}");
        eprintln!(
            "export de 30 s com {name}: {seconds:.2}s, {} bytes",
            fs::metadata(&output).unwrap().len()
        );
        timings.push((name.to_owned(), seconds));
    }
    let _: Value = json!(timings);
}
