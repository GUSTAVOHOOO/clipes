use clipes_core::export::pipeline::{Audio, Encoder, ExportPlan, Stage, Subtitle, Video};

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
