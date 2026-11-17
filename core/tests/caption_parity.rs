//! Paridade por preset: o mesmo `Prepared` (cues + ASS) que a UI recebe é o que o libass
//! renderiza. Mídia sintética por lavfi; sem rede.
use clipes_core::{
    caption_style::{prepare, Preset, Style, StyledWord, WordOverride},
    export::{
        captions::CaptionWord,
        render::{render_styled, RenderInput},
    },
    provider::CancelToken,
};
use std::path::Path;

static LOCK: std::sync::Mutex<()> = std::sync::Mutex::new(());

fn ffmpeg_path() -> String {
    std::env::var("CLIPES_TEST_FFMPEG").unwrap_or("ffmpeg".into())
}
fn ffmpeg(args: &[&str]) -> Vec<u8> {
    let out = clipes_core::process::spawn(ffmpeg_path(), args, None)
        .expect("instale FFmpeg com libass")
        .wait_with_output()
        .unwrap();
    assert!(
        out.status.success(),
        "{}",
        String::from_utf8_lossy(&out.stderr)
    );
    out.stdout
}
fn frame(path: &Path, t: f64) -> Vec<u8> {
    ffmpeg(&[
        "-v",
        "error",
        "-ss",
        &format!("{t:.3}"),
        "-i",
        path.to_str().unwrap(),
        "-frames:v",
        "1",
        "-pix_fmt",
        "rgb24",
        "-f",
        "rawvideo",
        "pipe:1",
    ])
}
/// Caixa dos pixels claros (texto) e contagem de pixels na cor ativa.
fn ink(f: &[u8], active: [u8; 3]) -> (Option<(usize, usize, usize, usize)>, usize, usize) {
    let (mut x0, mut y0, mut x1, mut y1) = (usize::MAX, usize::MAX, 0, 0);
    let (mut any, mut act, mut light) = (false, 0, 0);
    for (i, p) in f.chunks_exact(3).enumerate() {
        let (x, y) = (i % 1080, i / 1080);
        let near = |c: [u8; 3]| p.iter().zip(c).all(|(a, b)| a.abs_diff(b) < 40);
        if near(active) {
            act += 1;
        }
        if near([255, 255, 255]) {
            light += 1;
        }
        if near(active) || near([255, 255, 255]) {
            any = true;
            (x0, y0, x1, y1) = (x0.min(x), y0.min(y), x1.max(x), y1.max(y));
        }
    }
    (any.then_some((x0, y0, x1, y1)), act, light)
}

#[test]
fn every_preset_renders_the_prepared_cues_in_the_safe_zone_with_its_font() {
    let _guard = LOCK.lock().unwrap_or_else(|e| e.into_inner());
    let root = tempfile::tempdir().unwrap();
    std::env::set_var("CLIPES_DATA_DIR", root.path().join("data"));
    let source = root.path().join("base.mp4");
    ffmpeg(&[
        "-v",
        "error",
        "-f",
        "lavfi",
        "-i",
        "color=c=black:size=1080x1920:rate=12:duration=4",
        "-f",
        "lavfi",
        "-i",
        "sine=frequency=440:duration=4",
        "-c:v",
        "libx264",
        "-threads",
        "2",
        "-pix_fmt",
        "yuv420p",
        "-c:a",
        "aac",
        "-y",
        source.to_str().unwrap(),
    ]);
    let texts = ["Uma", "fala", "curta", "com", "legenda", "bem", "legível"];
    let styled: Vec<StyledWord> = texts
        .iter()
        .enumerate()
        .map(|(i, t)| StyledWord {
            word: CaptionWord {
                text: (*t).into(),
                start_us: i as i64 * 500_000,
                end_us: i as i64 * 500_000 + 450_000,
            },
            position: i as i64,
            overrides: WordOverride::default(),
        })
        .collect();
    let mut fonts_seen = Vec::new();
    for preset in [Preset::Vertical, Preset::Cinema, Preset::Simple] {
        let style = Style::preset(preset);
        let prepared = prepare(&styled, &style, 3_500_000).unwrap();
        let output = root.path().join(format!("{preset:?}.mp4"));
        let input = RenderInput {
            source: source.clone(),
            output: output.clone(),
            start_us: 0,
            end_us: 3_500_000,
            audio_track: 1,
            words: styled.iter().map(|w| w.word.clone()).collect(),
            crop: Vec::new(),
        };
        render_styled(
            Path::new(&ffmpeg_path()),
            &input,
            &prepared,
            &CancelToken::new(),
            &mut |_| {},
        )
        .unwrap_or_else(|e| panic!("{preset:?}: {e:?}"));
        // Meio de cada cue: o texto aparece só dentro da zona segura e acima da âncora.
        let mut raster = Vec::new();
        for cue in &prepared.cues {
            let mid = (cue.start_us + cue.end_us) as f64 / 2e6;
            let f = frame(&output, mid);
            let (bbox, active, light) = ink(&f, [0xFA, 0xCC, 0x15]);
            let (x0, y0, x1, y1) =
                bbox.unwrap_or_else(|| panic!("{preset:?}: cue sem texto em {mid}"));
            assert!(
                x0 >= 40 && x1 <= 1040,
                "{preset:?}: fora da zona segura x {x0}..{x1}"
            );
            assert!(
                y1 <= style.y as usize + style.outline as usize + 2,
                "{preset:?}: abaixo da âncora {y1}"
            );
            assert!(y0 >= 192 && y0 < y1, "{preset:?}: y {y0}");
            if style.highlight {
                assert!(active + light > 200);
            } else {
                assert_eq!(active, 0, "{preset:?}: sem destaque não usa cor ativa");
            }
            raster.push(f);
        }
        // Fora de qualquer cue (depois do fim) não há legenda.
        let after = frame(&output, 3.45);
        assert!(
            ink(&after, [0xFA, 0xCC, 0x15]).0.is_none(),
            "{preset:?}: legenda depois do fim"
        );
        if preset == Preset::Cinema {
            let cue = &prepared.cues[0];
            assert!(cue.lines.len() <= 2);
            let early = ink(
                &frame(&output, cue.start_us as f64 / 1e6 + 0.02),
                [0xFA, 0xCC, 0x15],
            );
            let full = ink(
                &frame(&output, (cue.start_us + 400_000) as f64 / 1e6),
                [0xFA, 0xCC, 0x15],
            );
            assert!(
                early.1 + early.2 < full.1 + full.2,
                "fad(120) não suaviza a entrada"
            );
        }
        fonts_seen.push((preset, style.font.clone(), raster.concat()));
    }
    assert_eq!(fonts_seen[0].1, "Noto Sans");
    assert_eq!(fonts_seen[1].1, "Noto Serif");
    assert_ne!(fonts_seen[0].2, fonts_seen[1].2);
}

#[test]
fn hidden_word_override_removes_word_from_cues_and_rendered_frames_and_survives_preset_switch() {
    use clipes_core::{caption_style::Prepared, dispatch, projects::with_writer};
    use serde_json::{json, Value};

    let _guard = LOCK.lock().unwrap_or_else(|e| e.into_inner());
    let root = tempfile::tempdir().unwrap();
    std::env::set_var("CLIPES_DATA_DIR", root.path().join("data"));
    let source_path = root.path().join("base.mp4");
    ffmpeg(&[
        "-v",
        "error",
        "-f",
        "lavfi",
        "-i",
        "color=c=black:size=1080x1920:rate=12:duration=22",
        "-f",
        "lavfi",
        "-i",
        "sine=frequency=440:duration=22",
        "-c:v",
        "libx264",
        "-threads",
        "2",
        "-pix_fmt",
        "yuv420p",
        "-c:a",
        "aac",
        "-y",
        source_path.to_str().unwrap(),
    ]);

    let call = |name: &str, args: Value| dispatch(name, args, &mut |_| {}).unwrap();
    call(
        "projects.create",
        json!({"parent":root.path(),"name":"OcultaParidade"}),
    );
    let (source, transcript, candidate) = with_writer(|c| {
        c.execute(
            "INSERT INTO sources(path,size,duration_us,partial_hash,metadata,permission,audio_track) VALUES (?1,1,22000000,'h','{}','{}',1)",
            [source_path.to_str().unwrap()],
        )?;
        let source = c.last_insert_rowid();
        c.execute(
            "INSERT INTO transcripts(source_id,audio_track,engine,model,revision,compute_type,state,duration_us) VALUES (?1,1,'local','m','r','c','complete',22000000)",
            [source],
        )?;
        let t = c.last_insert_rowid();
        for (p, text, start, end) in [
            (0, "Visível", 100_000, 600_000),
            (1, "Oculta", 1_800_000, 2_300_000),
            (2, "Final", 3_200_000, 3_700_000),
        ] {
            c.execute(
                "INSERT INTO transcript_words(transcript_id,position,kind,text,start_us,end_us) VALUES (?1,?2,'word',?3,?4,?5)",
                (t, p, text, start, end),
            )?;
        }
        c.execute("INSERT INTO sentences(transcript_id,id,first_position,last_position,start_us,end_us,text) VALUES (?1,1,0,0,100000,600000,'Visível')", [t])?;
        c.execute("INSERT INTO sentences(transcript_id,id,first_position,last_position,start_us,end_us,text) VALUES (?1,2,1,1,1800000,2300000,'Oculta')", [t])?;
        c.execute("INSERT INTO sentences(transcript_id,id,first_position,last_position,start_us,end_us,text) VALUES (?1,3,2,2,3200000,21000000,'Final')", [t])?;
        c.execute("INSERT INTO selection_runs(transcript_id,task_version,prompt_sha256,state,min_us,max_us,weights,plan_state,windows_total) VALUES (?1,1,'h','completed',20000000,180000000,'[]','ready',0)", [t])?;
        let run = c.last_insert_rowid();
        c.execute("INSERT INTO selection_candidates(run_id,rank,start_id,end_id,start_us,end_us,axes,total_centi,windows) VALUES (?1,1,1,3,100000,21000000,'{}',500,'[]')", [run])?;
        let candidate = c.last_insert_rowid();
        Ok((source, t, candidate))
    })
    .unwrap();

    call(
        "selection.decide",
        json!({"candidate":candidate,"decision":"approved"}),
    );
    let clip = call(
        "editor.open",
        json!({"source_id":source,"start_id":1,"end_id":3,"candidate_id":candidate}),
    )["clipId"]
        .as_i64()
        .unwrap();

    call(
        "captions.override",
        json!({"transcript_id":transcript,"position":1,"overrides":{"hidden":true}}),
    );
    let style = call("captions.style.get", json!({"clip_id":clip}));
    call(
        "captions.style.preset",
        json!({"clip_id":clip,"preset":"cinema","revision":style["revision"]}),
    );

    let (words_in_db, sentences_in_db): (i64, i64) = with_writer(|c| {
        Ok((
            c.query_row(
                "SELECT COUNT(*) FROM transcript_words WHERE transcript_id=?1 AND kind='word'",
                [transcript],
                |r| r.get(0),
            )?,
            c.query_row(
                "SELECT COUNT(*) FROM sentences WHERE transcript_id=?1",
                [transcript],
                |r| r.get(0),
            )?,
        ))
    })
    .unwrap();
    assert_eq!(words_in_db, 3);
    assert_eq!(sentences_in_db, 3);

    let cap = call(
        "export.captions",
        json!({"source_id":source,"start_id":1,"end_id":3,"candidate_id":candidate,"clip_id":clip}),
    );
    let prepared: Prepared = serde_json::from_value(cap.clone()).unwrap();
    assert_eq!(prepared.cues.len(), 2);
    assert!(!prepared.ass.contains("Oculta"));

    let output = root.path().join("hidden.mp4");
    let input = RenderInput {
        source: source_path.clone(),
        output: output.clone(),
        start_us: 100_000,
        end_us: 21_000_000,
        audio_track: 1,
        words: prepared
            .cues
            .iter()
            .flat_map(|c| &c.lines)
            .flatten()
            .map(|w| CaptionWord {
                text: w.text.clone(),
                start_us: w.start_us,
                end_us: w.end_us,
            })
            .collect(),
        crop: Vec::new(),
    };
    render_styled(
        Path::new(&ffmpeg_path()),
        &input,
        &prepared,
        &CancelToken::new(),
        &mut |_| {},
    )
    .unwrap();

    // Palavra visível antes (0.25s relativo ao início do Corte 0.1s) e depois (3.35s relativo) aparecem.
    assert!(ink(&frame(&output, 0.25), [0xFA, 0xCC, 0x15]).0.is_some());
    assert!(ink(&frame(&output, 3.35), [0xFA, 0xCC, 0x15]).0.is_some());
    // Palavra oculta (1.8s..2.3s na Fonte => 1.7s..2.2s relativo) não renderiza pixels de legenda.
    assert!(
        ink(&frame(&output, 1.95), [0xFA, 0xCC, 0x15]).0.is_none(),
        "palavra oculta não pode aparecer nos quadros exportados"
    );

    // Todas as palavras ocultas: não falha com export_font_missing e renderiza sem legenda.
    for pos in [0, 2] {
        call(
            "captions.override",
            json!({"transcript_id":transcript,"position":pos,"overrides":{"hidden":true}}),
        );
    }
    let all_hidden_cap = call(
        "export.captions",
        json!({"source_id":source,"start_id":1,"end_id":3,"candidate_id":candidate,"clip_id":clip}),
    );
    let all_hidden_prepared: Prepared = serde_json::from_value(all_hidden_cap).unwrap();
    assert!(all_hidden_prepared.cues.is_empty());
    let empty_out = root.path().join("all_hidden.mp4");
    let empty_input = RenderInput {
        source: source_path,
        output: empty_out.clone(),
        start_us: 100_000,
        end_us: 21_000_000,
        audio_track: 1,
        words: Vec::new(),
        crop: Vec::new(),
    };
    render_styled(
        Path::new(&ffmpeg_path()),
        &empty_input,
        &all_hidden_prepared,
        &CancelToken::new(),
        &mut |_| {},
    )
    .unwrap();
    assert!(ink(&frame(&empty_out, 0.25), [0xFA, 0xCC, 0x15])
        .0
        .is_none());

    call("projects.close", json!({}));
}

#[test]
fn braces_backslash_and_cyrillic_export_without_font_fallback_in_both_fonts() {
    let _guard = LOCK.lock().unwrap_or_else(|e| e.into_inner());
    let root = tempfile::tempdir().unwrap();
    std::env::set_var("CLIPES_DATA_DIR", root.path().join("data"));
    let source = root.path().join("base.mp4");
    ffmpeg(&[
        "-v",
        "error",
        "-f",
        "lavfi",
        "-i",
        "color=c=black:size=1080x1920:rate=12:duration=3",
        "-f",
        "lavfi",
        "-i",
        "sine=frequency=440:duration=3",
        "-c:v",
        "libx264",
        "-threads",
        "2",
        "-pix_fmt",
        "yuv420p",
        "-c:a",
        "aac",
        "-y",
        source.to_str().unwrap(),
    ]);
    let styled: Vec<StyledWord> = [r"{a}\b", "Привет", "Т"]
        .iter()
        .enumerate()
        .map(|(i, t)| StyledWord {
            word: CaptionWord {
                text: (*t).into(),
                start_us: i as i64 * 700_000,
                end_us: i as i64 * 700_000 + 600_000,
            },
            position: i as i64,
            overrides: WordOverride::default(),
        })
        .collect();
    for preset in [Preset::Vertical, Preset::Cinema] {
        let style = Style::preset(preset);
        let prepared = prepare(&styled, &style, 2_500_000).unwrap();
        let output = root.path().join(format!("cyrillic-{preset:?}.mp4"));
        let input = RenderInput {
            source: source.clone(),
            output: output.clone(),
            start_us: 0,
            end_us: 2_500_000,
            audio_track: 1,
            words: styled.iter().map(|w| w.word.clone()).collect(),
            crop: Vec::new(),
        };
        render_styled(
            Path::new(&ffmpeg_path()),
            &input,
            &prepared,
            &CancelToken::new(),
            &mut |_| {},
        )
        .unwrap_or_else(|e| panic!("{preset:?}: {e:?}"));
        let f = frame(&output, 0.35);
        let (bbox, active, light) = ink(&f, [0xFA, 0xCC, 0x15]);
        assert!(bbox.is_some(), "{preset:?}: esperado texto visível");
        assert!(active + light > 100);
    }
}
