//! Etapas compõem um plano, nunca executam processos. Veja docs/contribuindo/export.md.
use crate::editor::crop::{
    interpolate_in_segment, CropKeyframe, CropLayout, CropSegment, PanelFitMode, ResolvedCropPlan,
};
use crate::editor::silences::{KeptSegment, SPLICE_FADE_US};
use std::fmt::Write;

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct DualPanelFilters {
    pub top_filters: Vec<String>,
    pub bot_filters: Vec<String>,
}

/// Segmento de Narração posicionado no vídeo montado (#82, valores apenas numéricos).
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct NarrationMixSegment {
    /// Índice do input no FFmpeg (`1..=K`; `0` é a Fonte).
    pub input_index: usize,
    /// Início resolvido no vídeo montado em µs (`>= 0`).
    pub start_us: i64,
    /// Duração real do WAV em µs (`> 0`).
    pub duration_us: i64,
}

/// Plano numérico da mixagem de Narração, ducking e congelamento final (`tpad`) para o export (#82).
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct NarrationMixPlan {
    pub segments: Vec<NarrationMixSegment>,
    /// Duração do Corte emendado antes do `tpad` final, em µs.
    pub clip_duration_us: i64,
    /// Sobra final além do Corte que vira congelamento do último quadro (`tpad`), em µs.
    pub freeze_tail_us: i64,
    /// Duração total final (`clip_duration_us + freeze_tail_us`), em µs.
    pub total_duration_us: i64,
}

#[derive(Default, Debug)]
pub struct ExportPlan {
    pub video_filters: Vec<String>,
    pub dual_video: Option<DualPanelFilters>,
    pub audio_filters: Vec<String>,
    pub narration_mix: Option<NarrationMixPlan>,
    pub encoder: String,
    pub encoder_args: Vec<String>,
    pub crop_commands: Option<String>,
    pub crop_files: Vec<(String, String)>,
}
/// Alvos de loudness das plataformas (#63): -14 LUFS integrado, true peak de -1 dBTP, LRA 11 LU.
pub const TARGET_LUFS: f64 = -14.0;
pub const TARGET_TRUE_PEAK_DBTP: f64 = -1.0;
pub const TARGET_LRA_LU: f64 = 11.0;
/// Taxa de saída fixa: o `loudnorm` reamostra internamente (192 kHz), então se volta a 48 kHz.
pub const OUTPUT_SAMPLE_RATE: u32 = 48_000;

/// Parâmetros documentados do ducking da Fonte enquanto a Narração toca (#82):
/// alvo padrão de ~ -12 dB de redução para fala de TTS (~ -26 dBFS RMS), com ataque e
/// liberação suaves para evitar cortes bruscos entre palavras.
pub const DUCKING_TARGET_DB: f64 = -12.0;
pub const DUCKING_THRESHOLD: f64 = 0.015;
pub const DUCKING_RATIO: f64 = 4.0;
pub const DUCKING_ATTACK_MS: f64 = 40.0;
pub const DUCKING_RELEASE_MS: f64 = 300.0;
pub const DUCKING_KNEE: f64 = 4.0;
pub const DUCKING_LEVEL_SC: f64 = 2.0;

/// Filtro `sidechaincompress` usado no export com a Narração como sidechain (#82).
pub fn sidechain_duck_filter() -> String {
    format!(
        "sidechaincompress=threshold={DUCKING_THRESHOLD}:ratio={DUCKING_RATIO}:attack={DUCKING_ATTACK_MS}:release={DUCKING_RELEASE_MS}:knee={DUCKING_KNEE}:level_sc={DUCKING_LEVEL_SC}"
    )
}

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
/// Etapa de Narração e ducking (#82): entra antes de `Loudness` com `sidechaincompress`,
/// `amix normalize=0` e `tpad` final só quando a Narração ultrapassa o fim do Corte.
pub struct Ducking<'a>(pub &'a NarrationMixPlan);
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

fn scale_w_expr(cw: &str, ch: &str, target_w: u32, target_h: u32) -> String {
    format!("max(2,2*ceil(if(gte(dar*({cw})/({ch}),{target_w}/{target_h}),{target_w}/({cw}),{target_h}*dar/({ch}))/2))")
}

fn scale_h_expr(cw: &str, ch: &str, target_w: u32, target_h: u32) -> String {
    format!("max(2,2*ceil(if(gte(dar*({cw})/({ch}),{target_w}/{target_h}),{target_w}/(({cw})*dar),{target_h}/({ch}))/2))")
}

fn crop_w_expr(ratio: f64, target_w: u32, target_h: u32) -> String {
    format!(
        "min({target_w},max(2,trunc(if(gte(a*({ratio:.9}),{target_w}/{target_h}),{target_w},{target_h}*a*({ratio:.9}))/2)*2))"
    )
}

fn crop_h_expr(ratio: f64, target_w: u32, target_h: u32) -> String {
    format!(
        "min({target_h},max(2,trunc(if(gte(a*({ratio:.9}),{target_w}/{target_h}),{target_w}/(a*({ratio:.9})),{target_h})/2)*2))"
    )
}

fn clamp_x_expr(x_expr: &str, w_expr: &str) -> String {
    format!("min(((1-({w_expr}))/({w_expr}))*ow,max(0,(({x_expr})/({w_expr}))*ow))")
}

fn clamp_y_expr(y_expr: &str, h_expr: &str) -> String {
    format!("min(((1-({h_expr}))/({h_expr}))*oh,max(0,(({y_expr})/({h_expr}))*oh))")
}

#[allow(clippy::too_many_arguments)]
fn build_panel_crop_filters(
    segments: &[CropSegment],
    start_us: i64,
    end_us: i64,
    target_w: u32,
    target_h: u32,
    tag_suffix: &str,
    cmd_filename: &str,
) -> Option<(Vec<String>, Option<String>)> {
    let sliced = slice_crop_segments(segments, start_us, end_us);
    let first = sliced.first().and_then(|s| s.keyframes.first())?;
    let all_kfs: Vec<&CropKeyframe> = sliced.iter().flat_map(|s| &s.keyframes).collect();
    let is_static = all_kfs.iter().all(|k| {
        (k.x - first.x).abs() < 1e-9
            && (k.y - first.y).abs() < 1e-9
            && (k.width - first.width).abs() < 1e-9
            && (k.height - first.height).abs() < 1e-9
    });
    if is_static {
        let filters = vec![
            format!(
                "crop=w='max(2,trunc(iw*{:.9}/2)*2)':h='max(2,trunc(ih*{:.9}/2)*2)':x='min(iw-ow,max(0,round(iw*{:.9})))':y='min(ih-oh,max(0,round(ih*{:.9})))':exact=1",
                first.width, first.height, first.x, first.y
            ),
            format!(
                "scale=w='if(gte(dar,{target_w}/{target_h}),{target_w},max(2,trunc({target_h}*dar/2)*2))':h='if(gte(dar,{target_w}/{target_h}),max(2,trunc({target_w}/dar/2)*2),{target_h})':flags=lanczos"
            ),
            "setsar=1".into(),
            format!("pad={target_w}:{target_h}:(ow-iw)/2:(oh-ih)/2:color=black"),
        ];
        return Some((filters, None));
    }

    let constant_size = all_kfs
        .iter()
        .all(|k| (k.width - first.width).abs() < 1e-9 && (k.height - first.height).abs() < 1e-9);
    let first_ratio = first.width / first.height;
    let min_w = all_kfs
        .iter()
        .map(|k| k.width)
        .fold(f64::INFINITY, f64::min);
    let min_h = all_kfs
        .iter()
        .map(|k| k.height)
        .fold(f64::INFINITY, f64::min);
    let scale_tag = format!("scale@s{tag_suffix}");
    let crop_tag = format!("crop@c{tag_suffix}");
    let send_tag = if tag_suffix.is_empty() {
        format!("sendcmd=f={cmd_filename}")
    } else {
        format!("sendcmd@{tag_suffix}=f={cmd_filename}")
    };
    let mut commands = String::new();
    let mut init_crop_x = None;
    let mut init_crop_y = None;
    let mut init_ratio = first_ratio;

    for seg in &sliced {
        let mut prev_ratio: Option<f64> = None;
        for idx in 0..seg.keyframes.len() {
            let a = &seg.keyframes[idx];
            let t_a = (a.time_us - start_us) as f64 / 1_000_000.0;
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
            let sw = scale_w_expr(&cw_expr, &ch_expr, target_w, target_h);
            let sh = scale_h_expr(&cw_expr, &ch_expr, target_w, target_h);
            let ratio = a.width / a.height;
            if init_crop_x.is_none() {
                init_crop_x = Some(cx.clone());
                init_crop_y = Some(cy.clone());
                init_ratio = ratio;
            }
            let mut parts = Vec::new();
            if !constant_size {
                parts.push(format!("{scale_tag} w '{sw}'"));
                parts.push(format!("{scale_tag} h '{sh}'"));
                if prev_ratio.is_none_or(|r| (r - ratio).abs() > 1e-6) {
                    parts.push(format!(
                        "{crop_tag} w '{}'",
                        crop_w_expr(ratio, target_w, target_h)
                    ));
                    parts.push(format!(
                        "{crop_tag} h '{}'",
                        crop_h_expr(ratio, target_w, target_h)
                    ));
                    prev_ratio = Some(ratio);
                }
            }
            parts.push(format!("{crop_tag} x '{cx}'"));
            parts.push(format!("{crop_tag} y '{cy}'"));
            commands.push_str(&format!("{t_a:.6} {};\n", parts.join(", ")));
        }
    }

    let mut filters = vec![send_tag];
    if constant_size {
        let cw = format!("{:.9}", first.width);
        let ch = format!("{:.9}", first.height);
        filters.push(format!(
            "scale=w='{}':h='{}':flags=lanczos",
            scale_w_expr(&cw, &ch, target_w, target_h),
            scale_h_expr(&cw, &ch, target_w, target_h)
        ));
    } else {
        let max_cw = format!("{min_w:.9}");
        let max_ch = format!("{min_h:.9}");
        filters.push(format!(
            "{scale_tag}=w='{}':h='{}':flags=lanczos:eval=frame",
            scale_w_expr(&max_cw, &max_ch, target_w, target_h),
            scale_h_expr(&max_cw, &max_ch, target_w, target_h)
        ));
    }
    filters.push("setsar=1".into());
    filters.push(format!(
        "{crop_tag}=w='{}':h='{}':x='{}':y='{}':exact=1",
        crop_w_expr(init_ratio, target_w, target_h),
        crop_h_expr(init_ratio, target_w, target_h),
        init_crop_x.unwrap(),
        init_crop_y.unwrap(),
    ));
    filters.push(format!(
        "pad={target_w}:{target_h}:(ow-iw)/2:(oh-ih)/2:color=black"
    ));
    Some((filters, Some(commands)))
}

impl Stage for Crop<'_> {
    fn apply(&self, plan: &mut ExportPlan) {
        let Some((filters, cmd)) = build_panel_crop_filters(
            self.segments,
            self.start_us,
            self.end_us,
            1080,
            1920,
            "",
            "crop.cmd",
        ) else {
            Video.apply(plan);
            return;
        };
        if let Some(commands) = cmd {
            plan.crop_files.push(("crop.cmd".into(), commands.clone()));
            plan.crop_commands = Some(commands);
        }
        plan.video_filters.extend(filters);
    }
}

pub struct CropLayoutStage<'a> {
    pub crop_plan: &'a ResolvedCropPlan,
    pub start_us: i64,
    pub end_us: i64,
}

fn is_full_frame_static(segments: &[CropSegment]) -> bool {
    segments.len() == 1 && segments[0].keyframes.len() == 1 && {
        let k = &segments[0].keyframes[0];
        k.x.abs() < 1e-9
            && k.y.abs() < 1e-9
            && (k.width - 1.0).abs() < 1e-9
            && (k.height - 1.0).abs() < 1e-9
    }
}

impl Stage for CropLayoutStage<'_> {
    fn apply(&self, plan: &mut ExportPlan) {
        if self.crop_plan.panels.len() == 2 {
            let top = &self.crop_plan.panels[0];
            let bot = &self.crop_plan.panels[1];
            let (top_filters, top_cmd) = build_panel_crop_filters(
                &top.segments,
                self.start_us,
                self.end_us,
                top.target_width,
                top.target_height,
                "t",
                "crop_top.cmd",
            )
            .unwrap_or_else(|| {
                (
                    vec![
                        format!(
                            "scale=w='if(gte(dar,{}/{}),{},max(2,trunc({}*dar/2)*2))':h='if(gte(dar,{}/{}),max(2,trunc({}/dar/2)*2),{})'",
                            top.target_width, top.target_height, top.target_width, top.target_height,
                            top.target_width, top.target_height, top.target_width, top.target_height
                        ),
                        "setsar=1".into(),
                        format!("pad={}:{}:(ow-iw)/2:(oh-ih)/2:color=black", top.target_width, top.target_height),
                    ],
                    None,
                )
            });
            let (bot_filters, bot_cmd) = build_panel_crop_filters(
                &bot.segments,
                self.start_us,
                self.end_us,
                bot.target_width,
                bot.target_height,
                "b",
                "crop_bot.cmd",
            )
            .unwrap_or_else(|| {
                (
                    vec![
                        format!(
                            "scale=w='if(gte(dar,{}/{}),{},max(2,trunc({}*dar/2)*2))':h='if(gte(dar,{}/{}),max(2,trunc({}/dar/2)*2),{})'",
                            bot.target_width, bot.target_height, bot.target_width, bot.target_height,
                            bot.target_width, bot.target_height, bot.target_width, bot.target_height
                        ),
                        "setsar=1".into(),
                        format!("pad={}:{}:(ow-iw)/2:(oh-ih)/2:color=black", bot.target_width, bot.target_height),
                    ],
                    None,
                )
            });
            if let Some(cmd) = top_cmd {
                plan.crop_files.push(("crop_top.cmd".into(), cmd));
            }
            if let Some(cmd) = bot_cmd {
                plan.crop_files.push(("crop_bot.cmd".into(), cmd));
            }
            plan.dual_video = Some(DualPanelFilters {
                top_filters,
                bot_filters,
            });
            return;
        }
        let Some(panel) = self.crop_plan.panels.first() else {
            Video.apply(plan);
            return;
        };
        if self.crop_plan.layout == CropLayout::Fit
            && panel.fit_mode == PanelFitMode::Fit
            && is_full_frame_static(&panel.segments)
        {
            Video.apply(plan);
            return;
        }
        Crop {
            segments: &panel.segments,
            start_us: self.start_us,
            end_us: self.end_us,
        }
        .apply(plan);
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
impl Stage for Ducking<'_> {
    fn apply(&self, plan: &mut ExportPlan) {
        if self.0.segments.is_empty() {
            return;
        }
        plan.narration_mix = Some(self.0.clone());
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
    with_narration(encoder, measured, crop, None)
}

pub fn with_narration(
    encoder: &str,
    measured: Option<Measured>,
    crop: Option<Crop<'_>>,
    narration: Option<&NarrationMixPlan>,
) -> ExportPlan {
    let mut plan = ExportPlan::default();
    let selected = SelectedEncoder(encoder);
    let loudness = Loudness(measured);
    let video_stage: &dyn Stage = match &crop {
        Some(c) if !c.segments.is_empty() => c,
        _ => &Video,
    };
    let ducking = narration.map(Ducking);
    let mut stages: Vec<&dyn Stage> = vec![video_stage, &Subtitle, &Audio];
    if let Some(d) = &ducking {
        stages.push(d);
    }
    stages.push(&loudness);
    stages.push(&selected);
    for stage in stages {
        stage.apply(&mut plan);
    }
    plan
}

pub fn with_crop_plan(
    encoder: &str,
    measured: Option<Measured>,
    crop_plan: Option<CropLayoutStage<'_>>,
) -> ExportPlan {
    with_crop_plan_and_narration(encoder, measured, crop_plan, None)
}

pub fn with_crop_plan_and_narration(
    encoder: &str,
    measured: Option<Measured>,
    crop_plan: Option<CropLayoutStage<'_>>,
    narration: Option<&NarrationMixPlan>,
) -> ExportPlan {
    let mut plan = ExportPlan::default();
    let selected = SelectedEncoder(encoder);
    let loudness = Loudness(measured);
    let video_stage: &dyn Stage = match &crop_plan {
        Some(c) if !c.crop_plan.panels.is_empty() => c,
        _ => &Video,
    };
    let ducking = narration.map(Ducking);
    let mut stages: Vec<&dyn Stage> = vec![video_stage, &Subtitle, &Audio];
    if let Some(d) = &ducking {
        stages.push(d);
    }
    stages.push(&loudness);
    stages.push(&selected);
    for stage in stages {
        stage.apply(&mut plan);
    }
    plan
}

/// Insere `tpad` logo antes de `ass=...` para congelar apenas o último quadro limpo na sobra final (#82).
fn append_video_with_tpad(filters: &[String], freeze_tail_us: i64) -> Vec<String> {
    if freeze_tail_us <= 0 {
        return filters.to_vec();
    }
    let tpad = format!("tpad=stop_mode=clone:stop_duration={}", sec(freeze_tail_us));
    let mut out = Vec::with_capacity(filters.len() + 1);
    let insert_at = filters
        .iter()
        .position(|f| f.starts_with("ass="))
        .unwrap_or(filters.len());
    out.extend_from_slice(&filters[..insert_at]);
    out.push(tpad);
    out.extend_from_slice(&filters[insert_at..]);
    out
}

/// Anexa ao grafo o estágio de áudio da Narração (#82): normalização de formato, atraso por bloco,
/// `amix normalize=0` entre blocos, `sidechaincompress` na Fonte e `amix normalize=0` final,
/// seguido dos filtros posteriores (`loudnorm` + `aresample`). Só usa números (ADR-0006).
fn push_narration_audio_graph(
    out: &mut String,
    source_label: &str,
    trim_source: bool,
    mix: &NarrationMixPlan,
    post_audio: &[String],
) {
    let total_sec = sec(mix.total_duration_us.max(mix.clip_duration_us));
    let _ = write!(
        out,
        "{source_label}aresample={OUTPUT_SAMPLE_RATE},aformat=sample_fmts=fltp:channel_layouts=stereo"
    );
    if trim_source && mix.clip_duration_us > 0 {
        let _ = write!(
            out,
            ",atrim=start=0:end={},asetpts=PTS-STARTPTS",
            sec(mix.clip_duration_us)
        );
    }
    let _ = write!(out, ",apad=whole_dur={total_sec}[asrc];");

    for (i, seg) in mix.segments.iter().enumerate() {
        let _ = write!(
            out,
            "[{}:a]aresample={OUTPUT_SAMPLE_RATE},aformat=sample_fmts=fltp:channel_layouts=stereo",
            seg.input_index
        );
        if seg.start_us > 0 {
            let delay_ms = format!("{:.3}", seg.start_us as f64 / 1000.0);
            let _ = write!(out, ",adelay=delays={delay_ms}:all=1");
        }
        let _ = write!(out, "[n{i}];");
    }

    if mix.segments.len() == 1 {
        let _ = write!(
            out,
            "[n0]apad=whole_dur={total_sec},asplit=2[nar_sc][nar_mix];"
        );
    } else {
        for i in 0..mix.segments.len() {
            let _ = write!(out, "[n{i}]");
        }
        let _ = write!(
            out,
            "amix=inputs={}:duration=longest:normalize=0,apad=whole_dur={total_sec},asplit=2[nar_sc][nar_mix];",
            mix.segments.len()
        );
    }

    let _ = write!(
        out,
        "[asrc][nar_sc]{}[aducked];[aducked][nar_mix]amix=inputs=2:duration=longest:normalize=0",
        sidechain_duck_filter()
    );
    if !post_audio.is_empty() {
        let _ = write!(out, ",{}", post_audio.join(","));
    }
    out.push_str("[aout]");
}

/// Grafo para composição multi-painel sem emenda de silêncios (#78).
pub fn build_dual_filter_complex(plan: &ExportPlan) -> String {
    let dual = plan
        .dual_video
        .as_ref()
        .expect("dual_video obrigatório para build_dual_filter_complex");
    let freeze_tail_us = plan.narration_mix.as_ref().map_or(0, |m| m.freeze_tail_us);
    let post_filters = append_video_with_tpad(&plan.video_filters, freeze_tail_us);
    let post = if post_filters.is_empty() {
        String::new()
    } else {
        format!(",{}", post_filters.join(","))
    };
    format!(
        "[0:v:0]split=2[vti][vbi];[vti]{}[vtop];[vbi]{}[vbot];[vtop][vbot]vstack=inputs=2{}[vout]",
        dual.top_filters.join(","),
        dual.bot_filters.join(","),
        post
    )
}

/// Grafo completo com Narração, ducking (`sidechaincompress` + `amix normalize=0`) e `tpad` final
/// para Corte contínuo (sem emenda de silêncios), suportando layout simples e multi-painel (#82).
pub fn build_narration_filter_complex(audio_track: i64, plan: &ExportPlan) -> String {
    let mix = plan
        .narration_mix
        .as_ref()
        .expect("narration_mix obrigatório para build_narration_filter_complex");
    let mut out = if plan.dual_video.is_some() {
        let mut v = build_dual_filter_complex(plan);
        v.push(';');
        v
    } else {
        let v_filters = append_video_with_tpad(&plan.video_filters, mix.freeze_tail_us);
        format!("[0:v:0]{}[vout];", v_filters.join(","))
    };
    push_narration_audio_graph(
        &mut out,
        &format!("[0:{audio_track}]"),
        true,
        mix,
        &plan.audio_filters,
    );
    out
}

fn sec(us: i64) -> String {
    let us = us.max(0);
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
    build_measure_filter_complex_with_narration(audio_track, clip_start_us, segments, None)
}

/// Monta o grafo da 1ª passagem do `loudnorm` (#63/#77/#82), incluindo ducking e mixagem
/// da Narração antes da medição quando houver blocos narrados.
pub fn build_measure_filter_complex_with_narration(
    audio_track: i64,
    clip_start_us: i64,
    segments: &[KeptSegment],
    narration_mix: Option<&NarrationMixPlan>,
) -> String {
    let mut out = String::new();
    let measure = [loudnorm_measure_filter()];
    if segments.len() > 1 {
        let n = segments.len();
        let _ = write!(out, "[0:{audio_track}]asplit={n}");
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
        if let Some(mix) = narration_mix.filter(|m| !m.segments.is_empty()) {
            let _ = write!(out, "concat=n={n}:v=0:a=1[ac];");
            push_narration_audio_graph(&mut out, "[ac]", false, mix, &measure);
        } else {
            let _ = write!(
                out,
                "concat=n={n}:v=0:a=1,{}[aout]",
                loudnorm_measure_filter()
            );
        }
    } else if let Some(mix) = narration_mix.filter(|m| !m.segments.is_empty()) {
        push_narration_audio_graph(&mut out, &format!("[0:{audio_track}]"), true, mix, &measure);
    }
    out
}

/// Monta o grafo completo (#77/#82): corte e `concat` de vídeo e áudio pelos mesmos pontos
/// com `afade` curto sem sobreposição (nunca `acrossfade`), seguido de `tpad`, legenda,
/// ducking/mixagem da Narração e loudness.
pub fn build_spliced_filter_complex(
    audio_track: i64,
    clip_start_us: i64,
    segments: &[KeptSegment],
    plan: &ExportPlan,
) -> String {
    let n = segments.len();
    let (mut out, post_video) = if let Some(dual) = &plan.dual_video {
        (
            format!(
                "[0:v:0]split=2[vti][vbi];[vti]{}[vtop];[vbi]{}[vbot];[vtop][vbot]vstack=inputs=2,split={n}",
                dual.top_filters.join(","),
                dual.bot_filters.join(",")
            ),
            plan.video_filters.as_slice(),
        )
    } else if (!plan.crop_files.is_empty() || plan.crop_commands.is_some())
        && plan.video_filters.len() > 1
    {
        let (head, tail) = plan.video_filters.split_at(plan.video_filters.len() - 1);
        (format!("[0:v:0]{},split={n}", head.join(",")), tail)
    } else {
        (format!("[0:v:0]split={n}"), plan.video_filters.as_slice())
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
    let freeze_tail_us = plan.narration_mix.as_ref().map_or(0, |m| m.freeze_tail_us);
    let post_video = append_video_with_tpad(post_video, freeze_tail_us);
    let _ = write!(
        out,
        "concat=n={n}:v=1:a=1[vc][ac];[vc]{}[vout];",
        post_video.join(",")
    );
    if let Some(mix) = &plan.narration_mix {
        push_narration_audio_graph(&mut out, "[ac]", false, mix, &plan.audio_filters);
    } else {
        let _ = write!(out, "[ac]{}[aout]", plan.audio_filters.join(","));
    }
    out
}
