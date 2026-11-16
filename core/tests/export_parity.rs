//! Paridade real, inteiramente sintética. FFmpeg/libass é instalado pelo CI;
//! nenhum teste baixa mídia, fonte, modelo nem acessa a rede.
use clipes_core::{
    export::{
        captions::{self, CaptionWord},
        render::{render, RenderInput, FONT_BYTES, FONT_SHA256},
    },
    provider::CancelToken,
};
use serde_json::Value;
use sha2::{Digest, Sha256};
use std::{fs, path::Path, process::Output};

fn ffmpeg(args: &[&str]) -> Output {
    let program = std::env::var("CLIPES_TEST_FFMPEG").unwrap_or("ffmpeg".into());
    let output = clipes_core::process::spawn(&program, args, None)
        .expect("instale FFmpeg com libass para o harness de paridade")
        .wait_with_output()
        .unwrap();
    assert!(
        output.status.success(),
        "{}",
        String::from_utf8_lossy(&output.stderr)
    );
    output
}
fn probe(path: &Path) -> Value {
    let program = std::env::var("CLIPES_TEST_FFPROBE").unwrap_or("ffprobe".into());
    let output = clipes_core::process::spawn(
        program,
        [
            "-v",
            "error",
            "-show_streams",
            "-show_format",
            "-show_frames",
            "-of",
            "json",
            path.to_str().unwrap(),
        ],
        None,
    )
    .unwrap()
    .wait_with_output()
    .unwrap();
    assert!(output.status.success());
    serde_json::from_slice(&output.stdout).unwrap()
}
fn frame(path: &Path, time: f64, filter: &str) -> Vec<u8> {
    ffmpeg(&[
        "-v",
        "error",
        "-filter_threads",
        "1",
        "-ss",
        &format!("{time:.6}"),
        "-i",
        path.to_str().unwrap(),
        "-vf",
        filter,
        "-frames:v",
        "1",
        "-pix_fmt",
        "rgb24",
        "-f",
        "rawvideo",
        "pipe:1",
    ])
    .stdout
}
fn differences(actual: &[u8], reference: &[u8]) -> (f64, usize, usize) {
    assert_eq!(actual.len(), 270 * 480 * 3);
    assert_eq!(actual.len(), reference.len());
    let mut error = 0_u64;
    let mut background = 0;
    let mut yellow = 0;
    let mut white = 0;
    for (i, (a, b)) in actual
        .as_chunks::<3>()
        .0
        .iter()
        .zip(reference.as_chunks::<3>().0.iter())
        .enumerate()
    {
        let x = i % 270;
        let y = i / 270;
        let delta = a
            .iter()
            .zip(b)
            .map(|(a, b)| i32::from(*a).abs_diff(i32::from(*b)))
            .sum::<u32>();
        if (280..380).contains(&y) && (15..255).contains(&x) {
            if delta > 70 && a[0] > 140 && a[1] > 100 && a[2] < 110 {
                yellow += 1;
            }
            if delta > 70 && a.iter().all(|v| *v > 175) {
                white += 1;
            }
        } else {
            error += u64::from(delta);
            background += 3;
        }
    }
    (error as f64 / background as f64, yellow, white)
}

#[test]
fn real_ffmpeg_preserves_fit_geometry_timing_vfr_sar_rotation_and_bundled_font() {
    let root = tempfile::tempdir().unwrap();
    std::env::set_var("CLIPES_DATA_DIR", root.path().join("data"));
    assert_eq!(format!("{:x}", Sha256::digest(FONT_BYTES)), FONT_SHA256);
    let base = root.path().join("base.mp4");
    ffmpeg(&[
        "-v",
        "error",
        "-f",
        "lavfi",
        "-i",
        "testsrc2=size=160x90:rate=12:duration=4",
        "-f",
        "lavfi",
        "-i",
        "sine=frequency=440:duration=4",
        "-f",
        "lavfi",
        "-i",
        "sine=frequency=880:duration=4",
        "-map",
        "0:v",
        "-map",
        "1:a",
        "-map",
        "2:a",
        "-c:v",
        "libx264",
        "-threads",
        "2",
        "-pix_fmt",
        "yuv420p",
        "-c:a",
        "aac",
        "-y",
        base.to_str().unwrap(),
    ]);
    let vfr = root.path().join("vfr.mp4");
    ffmpeg(&[
        "-v",
        "error",
        "-i",
        base.to_str().unwrap(),
        "-map",
        "0",
        "-vf",
        "select='not(mod(n,2))+not(mod(n,5))'",
        "-fps_mode",
        "vfr",
        "-c:v",
        "libx264",
        "-threads",
        "2",
        "-c:a",
        "copy",
        "-y",
        vfr.to_str().unwrap(),
    ]);
    let sar = root.path().join("sar.mp4");
    ffmpeg(&[
        "-v",
        "error",
        "-i",
        base.to_str().unwrap(),
        "-map",
        "0",
        "-vf",
        "setsar=2/1",
        "-c:v",
        "libx264",
        "-threads",
        "2",
        "-c:a",
        "copy",
        "-y",
        sar.to_str().unwrap(),
    ]);
    let rotated = root.path().join("rotated.mp4");
    ffmpeg(&[
        "-v",
        "error",
        "-display_rotation",
        "90",
        "-i",
        base.to_str().unwrap(),
        "-map",
        "0",
        "-c",
        "copy",
        "-y",
        rotated.to_str().unwrap(),
    ]);
    let vfr_probe = probe(&vfr);
    let mut timestamps = vfr_probe["frames"]
        .as_array()
        .unwrap()
        .iter()
        .filter(|f| f["media_type"] == "video")
        .filter_map(|f| {
            f["best_effort_timestamp_time"]
                .as_str()
                .and_then(|t| t.parse::<f64>().ok())
        });
    let mut prev = timestamps.next().unwrap();
    let mut deltas = Vec::new();
    for t in timestamps {
        deltas.push(((t - prev) * 1000.0).round() as i64);
        prev = t;
    }
    assert!(
        deltas.iter().min() != deltas.iter().max(),
        "fixture precisa ser VFR"
    );
    assert_eq!(probe(&sar)["streams"][0]["sample_aspect_ratio"], "2:1");
    assert!(probe(&rotated)["streams"][0]["side_data_list"]
        .as_array()
        .unwrap()
        .iter()
        .any(|s| s["rotation"].as_i64().is_some_and(|r| r.abs() == 90)));
    let words = vec![
        CaptionWord {
            text: "Olá".into(),
            start_us: 200_000,
            end_us: 600_000,
        },
        CaptionWord {
            text: "world!".into(),
            start_us: 900_000,
            end_us: 1_300_000,
        },
    ];
    let program = std::env::var("CLIPES_TEST_FFMPEG").unwrap_or("ffmpeg".into());
    for (name, source, width, height) in [
        ("cfr", &base, 1080, 606),
        ("vfr", &vfr, 1080, 606),
        ("sar", &sar, 1080, 302),
        ("rotation", &rotated, 1080, 1920),
    ] {
        let output = root.path().join(format!("{name}-export.mp4"));
        let input = RenderInput {
            source: source.clone(),
            output: output.clone(),
            start_us: 500_000,
            end_us: 2_500_000,
            audio_track: 2,
            words: words.clone(),
        };
        let mut progress = Vec::new();
        render(Path::new(&program), &input, &CancelToken::new(), &mut |p| {
            progress.push(p)
        })
        .unwrap_or_else(|e| panic!("{name}: {e:?}"));
        assert_eq!(progress.last(), Some(&100));
        let info = probe(&output);
        let video = &info["streams"][0];
        assert_eq!(
            (video["width"].as_i64(), video["height"].as_i64()),
            (Some(1080), Some(1920))
        );
        assert_eq!(video["sample_aspect_ratio"], "1:1");
        assert_eq!(video["codec_name"], "h264");
        assert_eq!(info["streams"][1]["codec_name"], "aac");
        let audio = ffmpeg(&[
            "-v",
            "error",
            "-i",
            output.to_str().unwrap(),
            "-map",
            "0:a:0",
            "-ac",
            "1",
            "-ar",
            "8000",
            "-f",
            "s16le",
            "pipe:1",
        ])
        .stdout;
        let samples: Vec<i16> = audio
            .as_chunks::<2>()
            .0
            .iter()
            .map(|b| i16::from_le_bytes([b[0], b[1]]))
            .collect();
        let crossings = samples.windows(2).filter(|s| s[0] < 0 && s[1] >= 0).count();
        let frequency = crossings as f64 / (samples.len() as f64 / 8000.0);
        assert!(
            (frequency - 880.0).abs() < 8.0,
            "faixa selecionada errada: {frequency}"
        );
        assert!(video["side_data_list"]
            .as_array()
            .is_none_or(|a| a.iter().all(|s| s["rotation"].as_i64().unwrap_or(0) == 0)));
        let reference = format!(
            "scale={width}:{height},setsar=1,pad=1080:1920:(ow-iw)/2:(oh-ih)/2:black,scale=270:480"
        );
        let mut metrics = Vec::new();
        for time in [0.083333, 0.583333, 0.75, 1.083333, 1.583333] {
            let actual = frame(&output, time, "scale=270:480");
            let expected = frame(source, time + 0.5, &reference);
            let metric = differences(&actual, &expected);
            assert!(
                metric.0 < 2.0,
                "{name} em {time}: erro de geometria/tempo no fundo {}",
                metric.0
            );
            metrics.push(metric);
        }
        assert!(
            metrics[0].1 + metrics[0].2 < 30,
            "legenda antes da hora: {name} {metrics:?}"
        );
        assert!(
            metrics[1].1 > 20 && metrics[2].1 > 20,
            "primeira palavra sem destaque: {name} {metrics:?}"
        );
        assert!(
            metrics[2].2 > 20,
            "próxima palavra precisa continuar branca durante a pausa: {name} {metrics:?}"
        );
        assert!(
            metrics[3].1 > metrics[2].1 + 15,
            "segunda palavra sem karaokê: {name} {metrics:?}"
        );
        assert!(
            metrics[4].1 + metrics[4].2 < 30,
            "legenda depois do fim: {name} {metrics:?}"
        );
        eprintln!("paridade {name}: {metrics:?}");
    }
    // Controle negativo: a troca silenciosa de família deve mudar a rasterização.
    let good = frame(&root.path().join("cfr-export.mp4"), 0.75, "scale=270:480");
    let wrong_ass = captions::ass(&words, 2_000_000)
        .unwrap()
        .replace("Noto Sans", "Clipes Font Deliberately Missing");
    let work = root.path().join("font-negative");
    fs::create_dir(&work).unwrap();
    fs::write(work.join("wrong.ass"), wrong_ass).unwrap();
    let fallback=clipes_core::process::spawn(&program,["-v","verbose","-filter_threads","1","-ss","0.5","-i",base.to_str().unwrap(),"-vf","scale=1080:606,setsar=1,pad=1080:1920:(ow-iw)/2:(oh-ih)/2:black,ass=wrong.ass,scale=270:480","-ss","0.75","-frames:v","1","-pix_fmt","rgb24","-f","rawvideo","pipe:1"],Some(&work)).unwrap().wait_with_output().unwrap();
    assert!(fallback.status.success());
    assert!(!String::from_utf8_lossy(&fallback.stderr)
        .lines()
        .filter(|s| s.contains("fontselect:"))
        .any(|s| s.contains(" -> NotoSans-Bold")));
    assert_ne!(
        good, fallback.stdout,
        "controle negativo não detectou troca de fonte"
    );
    let changed = good
        .as_chunks::<3>()
        .0
        .iter()
        .zip(fallback.stdout.as_chunks::<3>().0.iter())
        .filter(|(a, b)| {
            a.iter()
                .zip(*b)
                .map(|(a, b)| a.abs_diff(*b) as u32)
                .sum::<u32>()
                > 70
        })
        .count();
    assert!(changed > 100, "métrica não detectou fallback: {changed}");
}

#[test]
fn real_ffmpeg_silence_splicing_keeps_av_duration_parity_and_remaps_captions() {
    use clipes_core::editor::silences::{
        detect_from_words, refine_valleys, SpliceMap, DEFAULT_MIN_SILENCE_US,
    };
    use clipes_core::export::render::render_spliced;

    let root = tempfile::tempdir().unwrap();
    let source = root.path().join("speech_with_silences.mp4");
    // 11 trechos de fala (1.0 s) separados por 10 silêncios de 1.2 s -> 24 s totais a 25 fps.
    let audio_expr = "sine=frequency=440:sample_rate=48000:duration=24,volume='if(lt(mod(t,2.2),1.0),0.8,0.0)':eval=frame";
    ffmpeg(&[
        "-v",
        "error",
        "-f",
        "lavfi",
        "-i",
        "testsrc2=size=160x90:rate=25:duration=24",
        "-f",
        "lavfi",
        "-i",
        audio_expr,
        "-map",
        "0:v",
        "-map",
        "1:a",
        "-c:v",
        "libx264",
        "-preset",
        "ultrafast",
        "-pix_fmt",
        "yuv420p",
        "-c:a",
        "aac",
        "-y",
        source.to_str().unwrap(),
    ]);

    let mut raw_words = Vec::new();
    for i in 0..11_i64 {
        let s = i * 2_200_000 + 200_000;
        let e = s + 600_000;
        raw_words.push((s, e));
    }
    let mut intervals =
        detect_from_words(&raw_words, 0, 24_000_000, DEFAULT_MIN_SILENCE_US).unwrap();
    assert_eq!(intervals.len(), 10, "esperava 10 silêncios detectados");

    let program = std::env::var("CLIPES_TEST_FFMPEG").unwrap_or("ffmpeg".into());
    if let Some(samples) =
        clipes_core::editor::silences::extract_pcm(Path::new(&program), &source, 1, 0, 24_000_000)
    {
        refine_valleys(&mut intervals, &samples, 16_000, 0);
    }

    let active_cuts: Vec<(i64, i64)> = intervals.iter().map(|i| (i.start_us, i.end_us)).collect();
    let splice = SpliceMap::new(0, 24_000_000, &active_cuts);
    assert_eq!(splice.segments.len(), 11);

    let words: Vec<CaptionWord> = raw_words
        .iter()
        .enumerate()
        .filter_map(|(i, &(s, e))| {
            let (ms, me) = splice.remap_word(s, e)?;
            Some(CaptionWord {
                text: format!("palavra{i}"),
                start_us: ms,
                end_us: me,
            })
        })
        .collect();
    assert_eq!(words.len(), 11);

    let output = root.path().join("spliced.mp4");
    let input = RenderInput {
        source: source.clone(),
        output: output.clone(),
        start_us: 0,
        end_us: 24_000_000,
        audio_track: 1,
        words: words.clone(),
    };
    let mut progress = Vec::new();
    render_spliced(
        Path::new(&program),
        &input,
        &splice.segments,
        &CancelToken::new(),
        &mut |p| progress.push(p),
    )
    .unwrap();
    assert_eq!(progress.last(), Some(&100));

    let info = probe(&output);
    let v_dur: f64 = info["streams"][0]["duration"]
        .as_str()
        .unwrap()
        .parse()
        .unwrap();
    let a_dur: f64 = info["streams"][1]["duration"]
        .as_str()
        .unwrap()
        .parse()
        .unwrap();
    let expected_s = splice.output_duration_us as f64 / 1_000_000.0;
    assert!(
        (v_dur - a_dur).abs() < 0.05,
        "deriva entre vídeo ({v_dur}s) e áudio ({a_dur}s) após 10 emendas"
    );
    assert!(
        (a_dur - expected_s).abs() < 0.12,
        "duração emendada ({a_dur}s) distante do esperado ({expected_s}s)"
    );

    // Após 9 emendas, a 10ª palavra continua alinhada no vídeo e na legenda.
    let w9 = &words[9];
    let mid_out = (w9.start_us + w9.end_us) as f64 / 2_000_000.0;
    let mid_src = splice.output_to_source((w9.start_us + w9.end_us) / 2) as f64 / 1_000_000.0;
    let actual = frame(&output, mid_out, "scale=270:480");
    let ref_filter =
        "scale=1080:606,setsar=1,pad=1080:1920:(ow-iw)/2:(oh-ih)/2:black,scale=270:480";
    let metrics: Vec<_> = [-0.08, -0.04, 0.0, 0.04]
        .into_iter()
        .map(|dt| {
            let expected = frame(&source, (mid_src + dt).max(0.0), ref_filter);
            differences(&actual, &expected)
        })
        .collect();
    let best = metrics
        .iter()
        .min_by(|a, b| a.0.total_cmp(&b.0))
        .copied()
        .unwrap();
    eprintln!(
        "spliced parity: v_dur={v_dur} a_dur={a_dur} expected={expected_s} best={best:?} all={metrics:?}"
    );
    assert!(
        best.0 < 2.0,
        "fundo desalinhado após 9 emendas: erro {}",
        best.0
    );
    assert!(
        best.1 + best.2 > 20,
        "legenda remapeada ausente no quadro esperado: {best:?}"
    );
}
