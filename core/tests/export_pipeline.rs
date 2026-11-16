use clipes_core::editor::crop::{CropKeyframe, CropSegment};
use clipes_core::export::pipeline::{
    self, Audio, Crop, Encoder, ExportPlan, Stage, Subtitle, Video,
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
