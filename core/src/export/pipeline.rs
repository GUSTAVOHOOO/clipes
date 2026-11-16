//! Etapas compõem um plano, nunca executam processos. Veja docs/contribuindo/export.md.
#[derive(Default, Debug)]
pub struct ExportPlan {
    pub video_filters: Vec<String>,
    pub audio_filters: Vec<String>,
    pub encoder: String,
    pub encoder_args: Vec<String>,
}
pub trait Stage {
    fn apply(&self, plan: &mut ExportPlan);
}
pub struct Video;
pub struct Subtitle;
pub struct Audio;
pub struct Encoder;
/// Encoder escolhido pela detecção (#62); `Encoder` continua sendo o x264 do #59.
pub struct SelectedEncoder<'a>(pub &'a str);
impl Stage for Video {
    fn apply(&self, plan: &mut ExportPlan) {
        // `dar` inclui SAR; o decoder já aplica a rotação por display matrix.
        plan.video_filters.extend([
            "scale=w='if(gte(dar,1080/1920),1080,max(2,trunc(1920*dar/2)*2))':h='if(gte(dar,1080/1920),max(2,trunc(1080/dar/2)*2),1920)'".into(),
            "setsar=1".into(),
            "pad=1080:1920:(ow-iw)/2:(oh-ih)/2:color=black".into(),
        ]);
    }
}
impl Stage for Subtitle {
    fn apply(&self, plan: &mut ExportPlan) {
        // Arquivos relativos em diretório privado: nenhum caminho de usuário entra no filtro.
        plan.video_filters
            .push("ass=filename=captions.ass:fontsdir=fonts".into());
    }
}
impl Stage for Audio {
    fn apply(&self, plan: &mut ExportPlan) {
        plan.audio_filters.push("anull".into());
    }
}
impl Stage for Encoder {
    fn apply(&self, plan: &mut ExportPlan) {
        SelectedEncoder(super::encoder::X264).apply(plan);
    }
}
impl Stage for SelectedEncoder<'_> {
    fn apply(&self, plan: &mut ExportPlan) {
        // Nome desconhecido nunca chega ao FFmpeg: cai no x264.
        let (name, args) = match super::encoder::args(self.0) {
            Some(args) => (self.0, args),
            None => (super::encoder::X264, super::encoder::X264_ARGS),
        };
        plan.encoder = name.into();
        plan.encoder_args = args.iter().map(|a| a.to_string()).collect();
    }
}
pub fn standard() -> ExportPlan {
    with_encoder(super::encoder::X264)
}
pub fn with_encoder(encoder: &str) -> ExportPlan {
    let mut plan = ExportPlan::default();
    let selected = SelectedEncoder(encoder);
    for stage in [&Video as &dyn Stage, &Subtitle, &Audio, &selected] {
        stage.apply(&mut plan);
    }
    plan
}
