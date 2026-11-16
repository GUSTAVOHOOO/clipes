//! Loudness do export (#63) com FFmpeg real e áudio inteiramente sintético: o arquivo exportado
//! é medido com `ebur128` e precisa ficar em -14 LUFS (±1 LU) com true peak ≤ -1 dBTP (+0,1).
//! Nada aqui acessa a rede nem usa mídia de terceiros.
use clipes_core::{
    export::{
        captions::CaptionWord,
        render::{render, RenderInput},
    },
    provider::CancelToken,
};
use std::{path::Path, process::Output};

const TOLERANCE_LU: f64 = 1.0;
const PEAK_TOLERANCE_DB: f64 = 0.1;

fn ffmpeg(args: &[&str]) -> Output {
    let program = std::env::var("CLIPES_TEST_FFMPEG").unwrap_or("ffmpeg".into());
    let output = clipes_core::process::spawn(&program, args, None)
        .expect("instale FFmpeg para o harness de loudness")
        .wait_with_output()
        .unwrap();
    assert!(output.status.success());
    output
}

/// Lê `I:` (LUFS) e o `Peak:` de "True peak:" do resumo do `ebur128=peak=true`.
fn measure(path: &Path) -> (f64, f64) {
    let output = ffmpeg(&[
        "-nostats",
        "-i",
        path.to_str().unwrap(),
        "-map",
        "0:a:0",
        "-af",
        "ebur128=peak=true",
        "-f",
        "null",
        "-",
    ]);
    let text = String::from_utf8_lossy(&output.stderr).into_owned();
    let summary = text.rsplit("Summary:").next().unwrap();
    let value = |label: &str, unit: &str| -> f64 {
        let rest = summary.split(label).nth(1).unwrap_or_else(|| {
            panic!("ebur128 sem {label}");
        });
        let rest = rest.trim_start().split(unit).next().unwrap();
        rest.trim().parse().unwrap()
    };
    (value("I:", "LUFS"), value("Peak:", "dBFS"))
}

fn cut(source: &Path, output: &Path, start_us: i64, end_us: i64) {
    let program = std::env::var("CLIPES_TEST_FFMPEG").unwrap_or("ffmpeg".into());
    let input = RenderInput {
        source: source.into(),
        output: output.into(),
        start_us,
        end_us,
        audio_track: 1,
        words: vec![CaptionWord {
            text: "fala".into(),
            start_us: 0,
            end_us: 500_000,
        }],
        crop: Vec::new(),
    };
    let mut progress = Vec::new();
    render(Path::new(&program), &input, &CancelToken::new(), &mut |p| {
        progress.push(p)
    })
    .unwrap();
    assert_eq!(progress.last(), Some(&100));
    assert!(
        progress.windows(2).all(|w| w[0] <= w[1]),
        "progresso não recua: {progress:?}"
    );
}

#[test]
fn exported_audio_lands_on_the_platform_target_for_quiet_and_loud_sources() {
    let root = tempfile::tempdir().unwrap();
    // `volume` por tempo: a primeira metade é bem baixa e a segunda bem alta, para o Corte
    // medir só o próprio trecho (a análise não pode olhar o resto da Fonte).
    let audio = "sine=frequency=440:sample_rate=44100:duration=12,volume=1.2[s];\
                 anoisesrc=color=pink:sample_rate=44100:duration=12:amplitude=0.5,volume=0.8[n];\
                 [s][n]amix=inputs=2:normalize=0,volume='if(lt(t,6),0.08,1.0)':eval=frame[a]";
    let source = root.path().join("fonte.mp4");
    ffmpeg(&[
        "-v",
        "error",
        "-f",
        "lavfi",
        "-i",
        "testsrc2=size=320x180:rate=15:duration=12",
        "-filter_complex",
        audio,
        "-map",
        "0:v",
        "-map",
        "[a]",
        "-t",
        "12",
        "-c:v",
        "libx264",
        "-preset",
        "ultrafast",
        "-c:a",
        "aac",
        "-y",
        source.to_str().unwrap(),
    ]);
    for (name, start, end) in [("baixo", 0, 5_000_000), ("alto", 7_000_000, 11_000_000)] {
        let output = root.path().join(format!("{name}.mp4"));
        cut(&source, &output, start, end);
        let (integrated, peak) = measure(&output);
        assert!(
            (integrated - -14.0).abs() <= TOLERANCE_LU,
            "{name}: {integrated} LUFS fora de -14 ± 1"
        );
        assert!(
            peak <= -1.0 + PEAK_TOLERANCE_DB,
            "{name}: true peak {peak} dBTP acima de -1 (+0,1)"
        );
        let info = ffmpeg(&[
            "-v",
            "error",
            "-i",
            output.to_str().unwrap(),
            "-map",
            "0:a:0",
            "-f",
            "null",
            "-",
        ]);
        assert!(info.status.success());
    }
}
