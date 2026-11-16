//! Etapas compõem um plano, nunca executam processos. Veja docs/contribuindo/export.md.
use crate::editor::silences::{KeptSegment, SPLICE_FADE_US};
use std::fmt::Write;

#[derive(Default, Debug)]
pub struct ExportPlan {
    pub video_filters: Vec<String>,
    pub audio_filters: Vec<String>,
    pub encoder: String,
    pub encoder_args: Vec<String>,
}
/// Alvos de loudness das plataformas (#63): -14 LUFS integrado, true peak de -1 dBTP, LRA 11 LU.
pub const TARGET_LUFS: f64 = -14.0;
pub const TARGET_TRUE_PEAK_DBTP: f64 = -1.0;
pub const TARGET_LRA_LU: f64 = 11.0;
/// Taxa de saída fixa: o `loudnorm` reamostra internamente (192 kHz), então se volta a 48 kHz.
pub const OUTPUT_SAMPLE_RATE: u32 = 48_000;

/// Medição da primeira passagem do `loudnorm`; só números, nunca o stderr (ADR-0006).
#[derive(Clone, Copy, Debug, PartialEq)]
pub struct Measured {
    pub input_i: f64,
    pub input_tp: f64,
    pub input_lra: f64,
    pub input_thresh: f64,
    pub target_offset: f64,
}

/// Filtro da primeira passagem: só mede o trecho do Corte e imprime JSON.
pub fn loudnorm_measure_filter() -> String {
    format!(
        "loudnorm=I={TARGET_LUFS}:TP={TARGET_TRUE_PEAK_DBTP}:LRA={TARGET_LRA_LU}:print_format=json"
    )
}

pub trait Stage {
    fn apply(&self, plan: &mut ExportPlan);
}
pub struct Video;
pub struct Subtitle;
pub struct Audio;
/// Última etapa de áudio (#63): `loudnorm` linear com os valores medidos e volta a 48 kHz.
/// As etapas futuras de áudio (#82, #154, #155: limpeza, ducking, trilha, `amix normalize=0`)
/// entram antes dela. Sem medição (áudio silencioso), nada é aplicado.
pub struct Loudness(pub Option<Measured>);
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
impl Stage for Loudness {
    fn apply(&self, plan: &mut ExportPlan) {
        let Some(m) = self.0 else { return };
        plan.audio_filters.push(format!(
            "loudnorm=I={TARGET_LUFS}:TP={TARGET_TRUE_PEAK_DBTP}:LRA={TARGET_LRA_LU}\
:measured_I={:.2}:measured_TP={:.2}:measured_LRA={:.2}:measured_thresh={:.2}\
:offset={:.2}:linear=true",
            m.input_i, m.input_tp, m.input_lra, m.input_thresh, m.target_offset
        ));
        plan.audio_filters
            .push(format!("aresample={OUTPUT_SAMPLE_RATE}"));
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
    with_loudness(encoder, None)
}
pub fn with_loudness(encoder: &str, measured: Option<Measured>) -> ExportPlan {
    let mut plan = ExportPlan::default();
    let selected = SelectedEncoder(encoder);
    let loudness = Loudness(measured);
    for stage in [
        &Video as &dyn Stage,
        &Subtitle,
        &Audio,
        &loudness,
        &selected,
    ] {
        stage.apply(&mut plan);
    }
    plan
}

fn sec(us: i64) -> String {
    format!("{}.{:06}", us / 1_000_000, us % 1_000_000)
}

fn push_audio_trim_fade(
    out: &mut String,
    idx: usize,
    start_us: i64,
    end_us: i64,
    fade_in: bool,
    fade_out: bool,
) {
    let dur_us = end_us - start_us;
    let fade_us = SPLICE_FADE_US.min(dur_us / 2);
    let _ = write!(
        out,
        "[a{idx}]atrim=start={}:end={},asetpts=PTS-STARTPTS",
        sec(start_us),
        sec(end_us)
    );
    if fade_in && fade_us > 0 {
        let _ = write!(out, ",afade=t=in:st=0:d={}", sec(fade_us));
    }
    if fade_out && fade_us > 0 {
        let _ = write!(
            out,
            ",afade=t=out:st={}:d={}",
            sec(dur_us - fade_us),
            sec(fade_us)
        );
    }
    let _ = write!(out, "[at{idx}];");
}

/// Monta o grafo da 1ª passagem do `loudnorm` sobre o áudio já emendado (#77).
pub fn build_measure_filter_complex(
    audio_track: i64,
    clip_start_us: i64,
    segments: &[KeptSegment],
) -> String {
    let n = segments.len();
    let mut out = format!("[0:{audio_track}]asplit={n}");
    for i in 0..n {
        let _ = write!(out, "[a{i}]");
    }
    out.push(';');
    for (i, seg) in segments.iter().enumerate() {
        push_audio_trim_fade(
            &mut out,
            i,
            seg.source_start_us - clip_start_us,
            seg.source_end_us - clip_start_us,
            i > 0,
            i + 1 < n,
        );
    }
    for i in 0..n {
        let _ = write!(out, "[at{i}]");
    }
    let _ = write!(
        out,
        "concat=n={n}:v=0:a=1,{}[aout]",
        loudnorm_measure_filter()
    );
    out
}

/// Monta o grafo completo (#77): corte e `concat` de vídeo e áudio pelos mesmos pontos
/// com `afade` curto sem sobreposição (nunca `acrossfade`), antes de legenda e loudness.
pub fn build_spliced_filter_complex(
    audio_track: i64,
    clip_start_us: i64,
    segments: &[KeptSegment],
    plan: &ExportPlan,
) -> String {
    let n = segments.len();
    let mut out = format!("[0:v:0]split={n}");
    for i in 0..n {
        let _ = write!(out, "[v{i}]");
    }
    let _ = write!(out, ";[0:{audio_track}]asplit={n}");
    for i in 0..n {
        let _ = write!(out, "[a{i}]");
    }
    out.push(';');
    for (i, seg) in segments.iter().enumerate() {
        let rel_s = seg.source_start_us - clip_start_us;
        let rel_e = seg.source_end_us - clip_start_us;
        let _ = write!(
            out,
            "[v{i}]trim=start={}:end={},setpts=PTS-STARTPTS[vt{i}];",
            sec(rel_s),
            sec(rel_e)
        );
        push_audio_trim_fade(&mut out, i, rel_s, rel_e, i > 0, i + 1 < n);
    }
    for i in 0..n {
        let _ = write!(out, "[vt{i}][at{i}]");
    }
    let _ = write!(
        out,
        "concat=n={n}:v=1:a=1[vc][ac];[vc]{}[vout];[ac]{}[aout]",
        plan.video_filters.join(","),
        plan.audio_filters.join(",")
    );
    out
}
