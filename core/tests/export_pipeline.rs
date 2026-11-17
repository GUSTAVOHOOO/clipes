use clipes_core::editor::crop::{
    resolve_plan, CropKeyframe, CropLayout, CropPanelDoc, CropSegment, CropTimeline, DualCropPanels,
};
use clipes_core::export::pipeline::{
    self, Audio, Crop, CropLayoutStage, Encoder, ExportPlan, Stage, Subtitle, Video,
};

#[test]
fn a_new_stage_enters_without_changing_existing_stages() {
    struct Extra;
    impl Stage for Extra {
        fn apply(&self, plan: &mut ExportPlan) {
            plan.video_filters.push("null".into());
        }
    }
    let stages: Vec<Box<dyn Stage>> = vec![
        Box::new(Video),
        Box::new(Extra),
        Box::new(Subtitle),
        Box::new(Audio),
        Box::new(Encoder),
    ];
    let mut plan = ExportPlan::default();
    for stage in stages {
        stage.apply(&mut plan);
    }
    assert!(plan.video_filters[0].contains("scale="));
    assert_eq!(plan.video_filters[1], "setsar=1");
    assert_eq!(plan.video_filters[3], "null");
    assert!(plan.video_filters[4].contains("ass=filename=captions.ass:fontsdir=fonts"));
    assert_eq!(plan.audio_filters, vec!["anull"]);
    assert_eq!(plan.encoder, "libx264");
}

#[test]
fn loudness_is_the_last_audio_stage_and_returns_to_48_khz() {
    use clipes_core::export::pipeline::{self, Measured};
    let measured = Measured {
        input_i: -27.61,
        input_tp: -4.47,
        input_lra: 18.06,
        input_thresh: -39.2,
        target_offset: 0.58,
    };
    let plan = pipeline::with_loudness("libx264", Some(measured));
    assert_eq!(plan.audio_filters[0], "anull");
    assert_eq!(
        plan.audio_filters[1],
        "loudnorm=I=-14:TP=-1:LRA=11:measured_I=-27.61:measured_TP=-4.47:measured_LRA=18.06:measured_thresh=-39.20:offset=0.58:linear=true"
    );
    assert_eq!(plan.audio_filters[2], "aresample=48000");
    assert_eq!(plan.audio_filters.len(), 3);
    // Áudio mudo (medição infinita): nada é aplicado.
    assert_eq!(
        pipeline::with_loudness("libx264", None).audio_filters,
        ["anull"]
    );
    assert_eq!(
        pipeline::loudnorm_measure_filter(),
        "loudnorm=I=-14:TP=-1:LRA=11:print_format=json"
    );
}

#[test]
fn crop_stage_uses_exact_1_and_scales_before_crop_only_when_animated() {
    let kf = |time_us, x, width| CropKeyframe {
        time_us,
        x,
        y: 0.0,
        width,
        height: 1.0,
        confidence: None,
        cut: false,
    };
    let static_seg = vec![CropSegment {
        start_us: 0,
        end_us: 2_000_000,
        reason: "start".into(),
        keyframes: vec![kf(0, 0.2, 0.3)],
    }];
    let static_plan = pipeline::with_crop(
        "libx264",
        None,
        Some(Crop {
            segments: &static_seg,
            start_us: 0,
            end_us: 2_000_000,
        }),
    );
    assert!(static_plan.crop_commands.is_none());
    assert!(static_plan.video_filters[0].starts_with("crop="));
    assert!(static_plan.video_filters[0].contains(":exact=1"));
    assert!(static_plan.video_filters[1].contains("flags=lanczos"));
    assert!(static_plan
        .video_filters
        .last()
        .unwrap()
        .contains("ass=filename=captions.ass"));

    let pan_seg = vec![CropSegment {
        start_us: 0,
        end_us: 2_000_000,
        reason: "start".into(),
        keyframes: vec![kf(0, 0.1, 0.3), kf(2_000_000, 0.2, 0.3)],
    }];
    let pan_plan = pipeline::with_crop(
        "libx264",
        None,
        Some(Crop {
            segments: &pan_seg,
            start_us: 0,
            end_us: 2_000_000,
        }),
    );
    assert!(pan_plan.crop_commands.is_some());
    assert_eq!(pan_plan.video_filters[0], "sendcmd=f=crop.cmd");
    assert!(pan_plan.video_filters[1].starts_with("scale="));
    assert!(pan_plan.video_filters[1].contains("flags=lanczos"));
    assert!(pan_plan.video_filters[3].starts_with("crop@c="));
    assert!(pan_plan.video_filters[3].contains(":exact=1"));
}

#[test]
fn crop_layout_stage_builds_fit_single_and_dual_stacked_plans() {
    let fit_plan = resolve_plan(
        &CropTimeline {
            layout: Some(CropLayout::Fit),
            ..Default::default()
        },
        16.0 / 9.0,
        0,
        2_000_000,
    );
    let fit_export = pipeline::with_crop_plan(
        "libx264",
        None,
        Some(CropLayoutStage {
            crop_plan: &fit_plan,
            start_us: 0,
            end_us: 2_000_000,
        }),
    );
    assert!(fit_export.dual_video.is_none());
    assert!(fit_export.video_filters[0].starts_with("scale="));
    assert!(fit_export
        .video_filters
        .iter()
        .any(|f| f.starts_with("pad=1080:1920")));

    let gw_plan = resolve_plan(
        &CropTimeline {
            layout: Some(CropLayout::GameplayWebcam),
            split_ratio: Some(0.30),
            gameplay_webcam: Some(DualCropPanels {
                top: CropPanelDoc {
                    suggested: None,
                    edits: vec![
                        CropKeyframe {
                            time_us: 0,
                            x: 0.02,
                            y: 0.02,
                            width: 0.25,
                            height: 0.24,
                            confidence: None,
                            cut: false,
                        },
                        CropKeyframe {
                            time_us: 1_000_000,
                            x: 0.04,
                            y: 0.02,
                            width: 0.25,
                            height: 0.24,
                            confidence: None,
                            cut: false,
                        },
                    ],
                },
                bottom: CropPanelDoc::default(),
            }),
            ..Default::default()
        },
        16.0 / 9.0,
        0,
        2_000_000,
    );
    let gw_export = pipeline::with_crop_plan(
        "libx264",
        None,
        Some(CropLayoutStage {
            crop_plan: &gw_plan,
            start_us: 0,
            end_us: 2_000_000,
        }),
    );
    let dual = gw_export.dual_video.as_ref().unwrap();
    assert_eq!(gw_export.crop_files.len(), 1);
    assert_eq!(gw_export.crop_files[0].0, "crop_top.cmd");
    assert!(dual.top_filters[0].contains("sendcmd@t=f=crop_top.cmd"));
    assert!(dual
        .top_filters
        .iter()
        .any(|f| f.starts_with("pad=1080:576")));
    assert!(dual
        .bot_filters
        .iter()
        .any(|f| f.starts_with("pad=1080:1344")));
    let graph = pipeline::build_dual_filter_complex(&gw_export);
    assert!(graph.contains("vstack=inputs=2,ass=filename=captions.ass:fontsdir=fonts[vout]"));
}

#[test]
fn ducking_stage_enters_before_loudness_and_builds_numeric_graph() {
    use clipes_core::editor::silences::KeptSegment;
    use clipes_core::export::pipeline::{Measured, NarrationMixPlan, NarrationMixSegment};

    let mix = NarrationMixPlan {
        segments: vec![
            NarrationMixSegment {
                input_index: 1,
                start_us: 500_000,
                duration_us: 2_000_000,
            },
            NarrationMixSegment {
                input_index: 2,
                start_us: 4_500_000,
                duration_us: 3_000_000,
            },
        ],
        clip_duration_us: 6_000_000,
        freeze_tail_us: 1_500_000,
        total_duration_us: 7_500_000,
    };
    let measured = Measured {
        input_i: -18.0,
        input_tp: -3.0,
        input_lra: 6.0,
        input_thresh: -28.0,
        target_offset: 0.4,
    };
    let plan = pipeline::with_narration("libx264", Some(measured), None, Some(&mix));
    assert_eq!(plan.narration_mix.as_ref(), Some(&mix));
    assert!(plan.audio_filters[1].starts_with("loudnorm="));
    assert_eq!(plan.audio_filters[2], "aresample=48000");

    let graph = pipeline::build_narration_filter_complex(1, &plan);
    assert!(graph.contains("sidechaincompress="));
    assert!(graph.contains("amix=inputs=2:duration=longest:normalize=0"));
    assert!(graph.contains("adelay=delays=500.000:all=1"));
    assert!(graph.contains("adelay=delays=4500.000:all=1"));
    assert!(graph.contains("tpad=stop_mode=clone:stop_duration=1.500000,ass=filename=captions.ass"));
    // Loudnorm entra após a mixagem.
    let amix_pos = graph
        .rfind("amix=inputs=2:duration=longest:normalize=0")
        .unwrap();
    let loudnorm_pos = graph.find("loudnorm=").unwrap();
    assert!(loudnorm_pos > amix_pos);

    // Também funciona com trechos emendados (silêncios cortados, #77).
    let spliced_segs = vec![
        KeptSegment {
            source_start_us: 0,
            source_end_us: 3_000_000,
            output_start_us: 0,
            output_end_us: 3_000_000,
        },
        KeptSegment {
            source_start_us: 4_000_000,
            source_end_us: 7_000_000,
            output_start_us: 3_000_000,
            output_end_us: 6_000_000,
        },
    ];
    let spliced_graph = pipeline::build_spliced_filter_complex(1, 0, &spliced_segs, &plan);
    assert!(spliced_graph.contains("concat=n=2:v=1:a=1[vc][ac]"));
    assert!(spliced_graph
        .contains("tpad=stop_mode=clone:stop_duration=1.500000,ass=filename=captions.ass"));
    assert!(spliced_graph.contains("sidechaincompress="));
    assert!(spliced_graph.contains("amix=inputs=2:duration=longest:normalize=0"));

    // Sem sobra final, não há `tpad`.
    let no_tail = NarrationMixPlan {
        freeze_tail_us: 0,
        total_duration_us: 6_000_000,
        ..mix
    };
    let no_tail_plan = pipeline::with_narration("libx264", None, None, Some(&no_tail));
    let no_tail_graph = pipeline::build_narration_filter_complex(1, &no_tail_plan);
    assert!(!no_tail_graph.contains("tpad="));
}
