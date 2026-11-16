//! Etapas compõem um plano, nunca executam processos. Veja docs/contribuindo/export.md.
use crate::editor::crop::{interpolate_in_segment, CropKeyframe, CropSegment};
use crate::editor::silences::{KeptSegment, SPLICE_FADE_US};
use std::fmt::Write;

#[derive(Default, Debug)]
pub struct ExportPlan {
    pub video_filters: Vec<String>,
    pub audio_filters: Vec<String>,
    pub encoder: String,
    pub encoder_args: Vec<String>,
    pub crop_commands: Option<String>,
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
/// Etapa de enquadramento (#66): aplica keyframes de crop antes de `Subtitle`,
/// produzindo o canvas 1080×1920 com `exact=1` e `scale` lanczos antes do `crop`
/// em movimentos animados para evitar degraus de pixel da Fonte.
pub struct Crop<'a> {
    pub segments: &'a [CropSegment],
    pub start_us: i64,
    pub end_us: i64,
}
pub struct Subtitle;
pub struct Audio;
/// Última etapa de áudio (#63): `loudnorm` linear com os valores medidos e volta a 48 kHz.
/// As etapas futuras de áudio (#82, #154, #155: limpeza, ducking, trilha, `amix normalize=0`)
/// entram antes dela. Sem medição (áudio silencioso), nada é aplicado.
pub struct Loudness(pub Option<Measured>);
pub struct Encoder;
/// Encoder escolhido pela detecção (#62); `Encoder` continua sendo o x264 do #59.
pub struct SelectedEncoder<'a>(pub &'a str);
fn make_keyframe(time_us: i64, rect: crate::editor::crop::CropRect) -> CropKeyframe {
    CropKeyframe {
        time_us,
        x: rect.x,
        y: rect.y,
        width: rect.width,
        height: rect.height,
        confidence: None,
        cut: false,
    }
}

fn slice_crop_segments(segments: &[CropSegment], start_us: i64, end_us: i64) -> Vec<CropSegment> {
    if segments.is_empty() || end_us <= start_us {
        return Vec::new();
    }
    if end_us <= segments[0].start_us {
        let Some(first) = segments[0].keyframes.first() else {
            return Vec::new();
        };
        return vec![CropSegment {
            start_us,
            end_us,
            reason: "start".into(),
            keyframes: vec![make_keyframe(start_us, first.rect())],
        }];
    }
    let last_seg = segments.last().unwrap();
    if start_us >= last_seg.end_us {
        let Some(last) = last_seg.keyframes.last() else {
            return Vec::new();
        };
        return vec![CropSegment {
            start_us,
            end_us,
            reason: "start".into(),
            keyframes: vec![make_keyframe(start_us, last.rect())],
        }];
    }
    let mut out = Vec::new();
    for seg in segments {
        if seg.end_us <= start_us || seg.start_us >= end_us {
            continue;
        }
        let s_start = if out.is_empty() {
            start_us
        } else {
            seg.start_us.max(start_us)
        };
        let s_end = seg.end_us.min(end_us);
        let Some(start_rect) = interpolate_in_segment(seg, s_start) else {
            continue;
        };
        let mut keyframes = vec![make_keyframe(s_start, start_rect)];
        for k in &seg.keyframes {
            if k.time_us > s_start && k.time_us < s_end {
                keyframes.push(k.clone());
            }
        }
        if seg
            .keyframes
            .last()
            .is_some_and(|last| last.time_us >= s_end)
        {
            if let Some(end_rect) = interpolate_in_segment(seg, s_end) {
                if keyframes.last().unwrap().time_us < s_end {
                    keyframes.push(make_keyframe(s_end, end_rect));
                }
            }
        }
        out.push(CropSegment {
            start_us: s_start,
            end_us: s_end,
            reason: seg.reason.clone(),
            keyframes,
        });
    }
    out
}

fn linear_expr(t0: f64, dt: f64, v0: f64, v1: f64) -> String {
    let dv = v1 - v0;
    if dv.abs() < 1e-12 || dt <= 0.0 {
        format!("{v0:.9}")
    } else {
        format!("({v0:.9}+({dv:.9})*(t-{t0:.6})/{dt:.6})")
    }
}

fn scale_w_expr(cw: &str, ch: &str) -> String {
    format!("max(2,2*ceil(if(gte(dar*({cw})/({ch}),1080/1920),1080/({cw}),1920*dar/({ch}))/2))")
}

fn scale_h_expr(cw: &str, ch: &str) -> String {
    format!("max(2,2*ceil(if(gte(dar*({cw})/({ch}),1080/1920),1080/(({cw})*dar),1920/({ch}))/2))")
}

fn crop_w_expr(ratio: f64) -> String {
    format!(
        "min(1080,max(2,trunc(if(gte(a*({ratio:.9}),1080/1920),1080,1920*a*({ratio:.9}))/2)*2))"
    )
}

fn crop_h_expr(ratio: f64) -> String {
    format!(
        "min(1920,max(2,trunc(if(gte(a*({ratio:.9}),1080/1920),1080/(a*({ratio:.9})),1920)/2)*2))"
    )
}

fn clamp_x_expr(x_expr: &str, w_expr: &str) -> String {
    format!("min(((1-({w_expr}))/({w_expr}))*ow,max(0,(({x_expr})/({w_expr}))*ow))")
}

fn clamp_y_expr(y_expr: &str, h_expr: &str) -> String {
    format!("min(((1-({h_expr}))/({h_expr}))*oh,max(0,(({y_expr})/({h_expr}))*oh))")
}

impl Stage for Crop<'_> {
    fn apply(&self, plan: &mut ExportPlan) {
        let sliced = slice_crop_segments(self.segments, self.start_us, self.end_us);
        let Some(first) = sliced.first().and_then(|s| s.keyframes.first()) else {
            Video.apply(plan);
            return;
        };
        let all_kfs: Vec<&CropKeyframe> = sliced.iter().flat_map(|s| &s.keyframes).collect();
        let is_static = all_kfs.iter().all(|k| {
            (k.x - first.x).abs() < 1e-9
                && (k.y - first.y).abs() < 1e-9
                && (k.width - first.width).abs() < 1e-9
                && (k.height - first.height).abs() < 1e-9
        });
        if is_static {
            // Corte estático: crop exact=1 seguido de scale lanczos + Fit (#66).
            plan.video_filters.extend([
                format!(
                    "crop=w='max(2,trunc(iw*{:.9}/2)*2)':h='max(2,trunc(ih*{:.9}/2)*2)':x='min(iw-ow,max(0,round(iw*{:.9})))':y='min(ih-oh,max(0,round(ih*{:.9})))':exact=1",
                    first.width, first.height, first.x, first.y
                ),
                "scale=w='if(gte(dar,1080/1920),1080,max(2,trunc(1920*dar/2)*2))':h='if(gte(dar,1080/1920),max(2,trunc(1080/dar/2)*2),1920)':flags=lanczos".into(),
                "setsar=1".into(),
                "pad=1080:1920:(ow-iw)/2:(oh-ih)/2:color=black".into(),
            ]);
            return;
        }

        let constant_size = all_kfs.iter().all(|k| {
            (k.width - first.width).abs() < 1e-9 && (k.height - first.height).abs() < 1e-9
        });
        let first_ratio = first.width / first.height;
        let min_w = all_kfs
            .iter()
            .map(|k| k.width)
            .fold(f64::INFINITY, f64::min);
        let min_h = all_kfs
            .iter()
            .map(|k| k.height)
            .fold(f64::INFINITY, f64::min);
        let mut commands = String::new();
        let mut init_crop_x = None;
        let mut init_crop_y = None;
        let mut init_ratio = first_ratio;

        for seg in &sliced {
            let mut prev_ratio: Option<f64> = None;
            for idx in 0..seg.keyframes.len() {
                let a = &seg.keyframes[idx];
                let t_a = (a.time_us - self.start_us) as f64 / 1_000_000.0;
                let (x_expr, y_expr, cw_expr, ch_expr) = if idx + 1 < seg.keyframes.len() {
                    let b = &seg.keyframes[idx + 1];
                    let dt = (b.time_us - a.time_us) as f64 / 1_000_000.0;
                    (
                        linear_expr(t_a, dt, a.x, b.x),
                        linear_expr(t_a, dt, a.y, b.y),
                        linear_expr(t_a, dt, a.width, b.width),
                        linear_expr(t_a, dt, a.height, b.height),
                    )
                } else {
                    (
                        format!("{:.9}", a.x),
                        format!("{:.9}", a.y),
                        format!("{:.9}", a.width),
                        format!("{:.9}", a.height),
                    )
                };
                let cx = clamp_x_expr(&x_expr, &cw_expr);
                let cy = clamp_y_expr(&y_expr, &ch_expr);
                let sw = scale_w_expr(&cw_expr, &ch_expr);
                let sh = scale_h_expr(&cw_expr, &ch_expr);
                let ratio = a.width / a.height;
                if init_crop_x.is_none() {
                    init_crop_x = Some(cx.clone());
                    init_crop_y = Some(cy.clone());
                    init_ratio = ratio;
                }
                let mut parts = Vec::new();
                if !constant_size {
                    parts.push(format!("scale@s w '{sw}'"));
                    parts.push(format!("scale@s h '{sh}'"));
                    if prev_ratio.is_none_or(|r| (r - ratio).abs() > 1e-6) {
                        parts.push(format!("crop@c w '{}'", crop_w_expr(ratio)));
                        parts.push(format!("crop@c h '{}'", crop_h_expr(ratio)));
                        prev_ratio = Some(ratio);
                    }
                }
                parts.push(format!("crop@c x '{cx}'"));
                parts.push(format!("crop@c y '{cy}'"));
                commands.push_str(&format!("{t_a:.6} {};\n", parts.join(", ")));
            }
        }

        plan.crop_commands = Some(commands);
        plan.video_filters.push("sendcmd=f=crop.cmd".into());
        if constant_size {
            let cw = format!("{:.9}", first.width);
            let ch = format!("{:.9}", first.height);
            plan.video_filters.push(format!(
                "scale=w='{}':h='{}':flags=lanczos",
                scale_w_expr(&cw, &ch),
                scale_h_expr(&cw, &ch)
            ));
        } else {
            let max_cw = format!("{min_w:.9}");
            let max_ch = format!("{min_h:.9}");
            plan.video_filters.push(format!(
                "scale@s=w='{}':h='{}':flags=lanczos:eval=frame",
                scale_w_expr(&max_cw, &max_ch),
                scale_h_expr(&max_cw, &max_ch)
            ));
        }
        plan.video_filters.push("setsar=1".into());
        plan.video_filters.push(format!(
            "crop@c=w='{}':h='{}':x='{}':y='{}':exact=1",
            crop_w_expr(init_ratio),
            crop_h_expr(init_ratio),
            init_crop_x.unwrap(),
            init_crop_y.unwrap(),
        ));
        plan.video_filters
            .push("pad=1080:1920:(ow-iw)/2:(oh-ih)/2:color=black".into());
    }
}
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
    with_crop(encoder, measured, None)
}
pub fn with_crop(encoder: &str, measured: Option<Measured>, crop: Option<Crop<'_>>) -> ExportPlan {
    let mut plan = ExportPlan::default();
    let selected = SelectedEncoder(encoder);
    let loudness = Loudness(measured);
    let video_stage: &dyn Stage = match &crop {
        Some(c) if !c.segments.is_empty() => c,
        _ => &Video,
    };
    for stage in [video_stage, &Subtitle, &Audio, &loudness, &selected] {
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
    let (pre_crop, post_video) = if plan.crop_commands.is_some() && plan.video_filters.len() > 1 {
        let (head, tail) = plan.video_filters.split_at(plan.video_filters.len() - 1);
        (Some(head), tail)
    } else {
        (None, plan.video_filters.as_slice())
    };
    let mut out = if let Some(crop_filters) = pre_crop {
        format!("[0:v:0]{},split={n}", crop_filters.join(","))
    } else {
        format!("[0:v:0]split={n}")
    };
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
        post_video.join(","),
        plan.audio_filters.join(",")
    );
    out
}
