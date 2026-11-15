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
