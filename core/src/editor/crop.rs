//! Timeline de keyframes de enquadramento (#66): sugestão (#60) e edições
//! separadas, resolução por segmento e função única de interpolação linear.
use super::*;
use serde::{Deserialize, Serialize};

fn is_false(value: &bool) -> bool {
    !*value
}

#[derive(Clone, Copy, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CropRect {
    pub x: f64,
    pub y: f64,
    pub width: f64,
    pub height: f64,
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct CropKeyframe {
    pub time_us: i64,
    pub x: f64,
    pub y: f64,
    pub width: f64,
    pub height: f64,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub confidence: Option<f64>,
    #[serde(default, skip_serializing_if = "is_false")]
    pub cut: bool,
}

impl CropKeyframe {
    pub fn rect(&self) -> CropRect {
        CropRect {
            x: self.x,
            y: self.y,
            width: self.width,
            height: self.height,
        }
    }
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct CropSegment {
    pub start_us: i64,
    pub end_us: i64,
    pub reason: String,
    pub keyframes: Vec<CropKeyframe>,
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct SuggestedCrop {
    pub schema_version: u32,
    pub revision: u32,
    pub status: String,
    pub segments: Vec<CropSegment>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub metrics: Option<Value>,
}

pub const GAMEPLAY_WEBCAM_DEFAULT_SPLIT: f64 = 0.30;
pub const GAMEPLAY_WEBCAM_MIN_SPLIT: f64 = 0.20;
pub const GAMEPLAY_WEBCAM_MAX_SPLIT: f64 = 0.50;
pub const TWO_PEOPLE_DEFAULT_SPLIT: f64 = 0.50;
pub const TWO_PEOPLE_MIN_SPLIT: f64 = 0.30;
pub const TWO_PEOPLE_MAX_SPLIT: f64 = 0.70;

#[derive(Clone, Copy, Debug, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum CropLayout {
    #[default]
    Fit,
    Face,
    GameplayWebcam,
    TwoPeople,
    FullscreenRoi,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum PanelFitMode {
    Fit,
    Fill,
}

#[derive(Clone, Debug, Default, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct CropPanelDoc {
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub suggested: Option<SuggestedCrop>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub edits: Vec<CropKeyframe>,
}

#[derive(Clone, Debug, Default, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct DualCropPanels {
    #[serde(default)]
    pub top: CropPanelDoc,
    #[serde(default)]
    pub bottom: CropPanelDoc,
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PanelPlan {
    pub target_width: u32,
    pub target_height: u32,
    pub fit_mode: PanelFitMode,
    pub segments: Vec<CropSegment>,
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ResolvedCropPlan {
    pub layout: CropLayout,
    pub split_ratio: f64,
    pub panels: Vec<PanelPlan>,
}

#[derive(Clone, Copy, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct EvaluatedPanel {
    pub target_width: u32,
    pub target_height: u32,
    pub fit_mode: PanelFitMode,
    pub rect: CropRect,
}

#[derive(Clone, Debug, Default, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct CropTimeline {
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub layout: Option<CropLayout>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub split_ratio: Option<f64>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub suggested: Option<SuggestedCrop>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub edits: Vec<CropKeyframe>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub gameplay_webcam: Option<DualCropPanels>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub two_people: Option<DualCropPanels>,
}

impl CropTimeline {
    pub fn effective_layout(&self) -> CropLayout {
        if let Some(layout) = self.layout {
            return layout;
        }
        if self.suggested.is_some() || !self.edits.is_empty() {
            CropLayout::Face
        } else {
            CropLayout::Fit
        }
    }

    pub fn has_explicit_crop(&self) -> bool {
        self.layout.is_some()
            || self.suggested.is_some()
            || !self.edits.is_empty()
            || self.gameplay_webcam.is_some()
            || self.two_people.is_some()
    }
}

pub(crate) fn invalid_crop() -> CoreError {
    error("invalid_crop", "Timeline de enquadramento inválida.")
}

pub fn validate_keyframe(k: &CropKeyframe) -> Result<(), CoreError> {
    if k.time_us < 0
        || ![k.x, k.y, k.width, k.height]
            .iter()
            .all(|v| v.is_finite() && (0.0..=1.0).contains(v))
        || k.width <= 0.0
        || k.height <= 0.0
        || k.x + k.width > 1.0 + 1e-9
        || k.y + k.height > 1.0 + 1e-9
        || k.confidence
            .is_some_and(|c| !c.is_finite() || !(0.0..=1.0).contains(&c))
    {
        return Err(invalid_crop());
    }
    Ok(())
}

pub fn validate_suggested(suggested: &SuggestedCrop) -> Result<(), CoreError> {
    if suggested.schema_version != 1
        || suggested.revision == 0
        || suggested.status != "suggestion"
        || suggested.segments.is_empty()
    {
        return Err(invalid_crop());
    }
    let mut prev_end = None;
    for (i, seg) in suggested.segments.iter().enumerate() {
        if seg.start_us < 0
            || seg.end_us <= seg.start_us
            || seg.keyframes.is_empty()
            || prev_end.is_some_and(|end| seg.start_us != end)
            || (i == 0 && seg.reason != "start")
            || (i > 0 && !matches!(seg.reason.as_str(), "scene" | "face_switch"))
            || seg.keyframes[0].time_us != seg.start_us
        {
            return Err(invalid_crop());
        }
        let mut prev_t = seg.start_us - 1;
        for k in &seg.keyframes {
            validate_keyframe(k)?;
            if k.time_us <= prev_t || k.time_us >= seg.end_us || k.cut {
                return Err(invalid_crop());
            }
            prev_t = k.time_us;
        }
        prev_end = Some(seg.end_us);
    }
    Ok(())
}

pub fn validate_edits(edits: &[CropKeyframe]) -> Result<(), CoreError> {
    let mut prev_t = -1;
    for k in edits {
        validate_keyframe(k)?;
        if k.time_us <= prev_t {
            return Err(invalid_crop());
        }
        prev_t = k.time_us;
    }
    Ok(())
}

pub fn split_bounds(layout: CropLayout) -> Option<(f64, f64, f64)> {
    match layout {
        CropLayout::GameplayWebcam => Some((
            GAMEPLAY_WEBCAM_DEFAULT_SPLIT,
            GAMEPLAY_WEBCAM_MIN_SPLIT,
            GAMEPLAY_WEBCAM_MAX_SPLIT,
        )),
        CropLayout::TwoPeople => Some((
            TWO_PEOPLE_DEFAULT_SPLIT,
            TWO_PEOPLE_MIN_SPLIT,
            TWO_PEOPLE_MAX_SPLIT,
        )),
        _ => None,
    }
}

pub fn validate_split_ratio(
    layout: Option<CropLayout>,
    split_ratio: Option<f64>,
) -> Result<Option<f64>, CoreError> {
    let Some(ratio) = split_ratio else {
        return Ok(None);
    };
    if !ratio.is_finite() {
        return Err(invalid_crop());
    }
    if let Some(l) = layout {
        if let Some((_, min, max)) = split_bounds(l) {
            if ratio < min - 1e-9 || ratio > max + 1e-9 {
                return Err(invalid_crop());
            }
            return Ok(Some(ratio.clamp(min, max)));
        }
    }
    if !(0.1..=0.9).contains(&ratio) {
        return Err(invalid_crop());
    }
    Ok(Some(ratio))
}

pub fn panel_heights(layout: CropLayout, split_ratio: Option<f64>) -> (u32, u32) {
    let Some((def, min, max)) = split_bounds(layout) else {
        return (1920, 0);
    };
    let ratio = split_ratio.unwrap_or(def).clamp(min, max);
    let min_px = (1920.0 * min).round() as u32;
    let max_px = (1920.0 * max).round() as u32;
    let top_h = (((1920.0 * ratio / 2.0).round() as u32) * 2).clamp(min_px, max_px);
    (top_h, 1920 - top_h)
}

pub fn effective_split_ratio(layout: CropLayout, split_ratio: Option<f64>) -> f64 {
    let (top_h, _) = panel_heights(layout, split_ratio);
    f64::from(top_h) / 1920.0
}

fn validate_panel_doc(doc: &CropPanelDoc) -> Result<(), CoreError> {
    if let Some(suggested) = &doc.suggested {
        validate_suggested(suggested)?;
    }
    validate_edits(&doc.edits)
}

pub fn validate_timeline(timeline: &CropTimeline) -> Result<(), CoreError> {
    validate_split_ratio(timeline.layout, timeline.split_ratio)?;
    if let Some(suggested) = &timeline.suggested {
        validate_suggested(suggested)?;
    }
    validate_edits(&timeline.edits)?;
    if let Some(dual) = &timeline.gameplay_webcam {
        validate_panel_doc(&dual.top)?;
        validate_panel_doc(&dual.bottom)?;
    }
    if let Some(dual) = &timeline.two_people {
        validate_panel_doc(&dual.top)?;
        validate_panel_doc(&dual.bottom)?;
    }
    Ok(())
}

fn split_manual_cuts(
    start_us: i64,
    end_us: i64,
    first_reason: &str,
    keyframes: &[CropKeyframe],
) -> Vec<CropSegment> {
    let mut out: Vec<CropSegment> = Vec::new();
    for (idx, k) in keyframes.iter().enumerate() {
        if idx == 0 {
            out.push(CropSegment {
                start_us: start_us.min(k.time_us),
                end_us,
                reason: first_reason.into(),
                keyframes: vec![k.clone()],
            });
        } else if k.cut {
            if let Some(prev) = out.last_mut() {
                prev.end_us = k.time_us;
            }
            out.push(CropSegment {
                start_us: k.time_us,
                end_us,
                reason: "manual".into(),
                keyframes: vec![k.clone()],
            });
        } else {
            out.last_mut().unwrap().keyframes.push(k.clone());
        }
    }
    if let Some(last) = out.last_mut() {
        last.end_us = end_us.max(last.keyframes.last().unwrap().time_us + 1);
    }
    out
}

/// Combina `suggested` (#60) e `edits` (#66/#71). Um segmento de `suggested` com
/// ao menos um keyframe em `edits` usa só os `edits` daquele segmento; os demais
/// preservam `suggested`. Limites entre segmentos dão corte seco.
pub fn resolve_panel_segments(
    suggested: Option<&SuggestedCrop>,
    edits: &[CropKeyframe],
) -> Vec<CropSegment> {
    let Some(suggested) = suggested.filter(|s| !s.segments.is_empty()) else {
        if edits.is_empty() {
            return Vec::new();
        }
        let first_t = edits[0].time_us;
        let last_t = edits.last().unwrap().time_us + 1;
        return split_manual_cuts(first_t, last_t, "start", edits);
    };

    let count = suggested.segments.len();
    let mut resolved = Vec::new();
    for (i, seg) in suggested.segments.iter().enumerate() {
        let low = if i == 0 { i64::MIN } else { seg.start_us };
        let high = if i + 1 == count { i64::MAX } else { seg.end_us };
        let edited: Vec<CropKeyframe> = edits
            .iter()
            .filter(|k| k.time_us >= low && k.time_us < high)
            .cloned()
            .collect();
        if edited.is_empty() {
            resolved.push(seg.clone());
        } else {
            resolved.extend(split_manual_cuts(
                seg.start_us,
                seg.end_us,
                &seg.reason,
                &edited,
            ));
        }
    }
    resolved
}

pub fn resolve(timeline: &CropTimeline) -> Vec<CropSegment> {
    resolve_panel_segments(timeline.suggested.as_ref(), &timeline.edits)
}

pub fn sanitize_aspect(aspect: f64) -> f64 {
    if aspect.is_finite() && (0.1..=10.0).contains(&aspect) {
        aspect
    } else {
        16.0 / 9.0
    }
}

pub fn default_panel_rect(
    source_aspect: f64,
    panel_aspect: f64,
    zoom: f64,
    cx: f64,
    cy: f64,
) -> CropRect {
    let sa = sanitize_aspect(source_aspect);
    let pa = if panel_aspect.is_finite() && panel_aspect > 0.05 {
        panel_aspect
    } else {
        9.0 / 16.0
    };
    let ratio = pa / sa;
    let base_w = ratio.clamp(0.05, 1.0);
    let base_h = (1.0 / ratio).clamp(0.05, 1.0);
    let z = zoom.max(1.0);
    let width = (base_w / z).clamp(0.05, 1.0);
    let height = (base_h / z).clamp(0.05, 1.0);
    let x = (cx - width / 2.0).clamp(0.0, (1.0 - width).max(0.0));
    let y = (cy - height / 2.0).clamp(0.0, (1.0 - height).max(0.0));
    CropRect {
        x,
        y,
        width,
        height,
    }
}

fn static_segment(start_us: i64, end_us: i64, rect: CropRect) -> CropSegment {
    let end = end_us.max(start_us + 1);
    CropSegment {
        start_us,
        end_us: end,
        reason: "start".into(),
        keyframes: vec![CropKeyframe {
            time_us: start_us,
            x: rect.x,
            y: rect.y,
            width: rect.width,
            height: rect.height,
            confidence: None,
            cut: false,
        }],
    }
}

/// Função única do núcleo para resolver qualquer um dos 5 layouts (#78), usada
/// igualmente por preview e export para garantir paridade geométrica.
pub fn resolve_plan(
    timeline: &CropTimeline,
    source_aspect: f64,
    clip_start_us: i64,
    clip_end_us: i64,
) -> ResolvedCropPlan {
    let layout = timeline.effective_layout();
    let aspect = sanitize_aspect(source_aspect);
    match layout {
        CropLayout::Fit => {
            let segments = if timeline.edits.is_empty() {
                vec![static_segment(
                    clip_start_us,
                    clip_end_us,
                    CropRect {
                        x: 0.0,
                        y: 0.0,
                        width: 1.0,
                        height: 1.0,
                    },
                )]
            } else {
                resolve_panel_segments(None, &timeline.edits)
            };
            ResolvedCropPlan {
                layout,
                split_ratio: 1.0,
                panels: vec![PanelPlan {
                    target_width: 1080,
                    target_height: 1920,
                    fit_mode: PanelFitMode::Fit,
                    segments,
                }],
            }
        }
        CropLayout::Face => {
            let mut segments = resolve_panel_segments(timeline.suggested.as_ref(), &timeline.edits);
            if segments.is_empty() {
                segments = vec![static_segment(
                    clip_start_us,
                    clip_end_us,
                    default_panel_rect(aspect, 9.0 / 16.0, 1.0, 0.5, 0.5),
                )];
            }
            ResolvedCropPlan {
                layout,
                split_ratio: 1.0,
                panels: vec![PanelPlan {
                    target_width: 1080,
                    target_height: 1920,
                    fit_mode: PanelFitMode::Fill,
                    segments,
                }],
            }
        }
        CropLayout::FullscreenRoi => {
            // Reutiliza os keyframes do #71 sem sugestão automática de rosto.
            let mut segments = resolve_panel_segments(None, &timeline.edits);
            if segments.is_empty() {
                segments = vec![static_segment(
                    clip_start_us,
                    clip_end_us,
                    default_panel_rect(aspect, 9.0 / 16.0, 1.0, 0.5, 0.5),
                )];
            }
            ResolvedCropPlan {
                layout,
                split_ratio: 1.0,
                panels: vec![PanelPlan {
                    target_width: 1080,
                    target_height: 1920,
                    fit_mode: PanelFitMode::Fill,
                    segments,
                }],
            }
        }
        CropLayout::GameplayWebcam => {
            let (top_h, bot_h) = panel_heights(CropLayout::GameplayWebcam, timeline.split_ratio);
            let dual = timeline.gameplay_webcam.as_ref();
            let mut top_segs = dual
                .map(|d| resolve_panel_segments(d.top.suggested.as_ref(), &d.top.edits))
                .unwrap_or_default();
            if top_segs.is_empty() {
                top_segs = vec![static_segment(
                    clip_start_us,
                    clip_end_us,
                    default_panel_rect(aspect, 1080.0 / f64::from(top_h), 3.0, 0.18, 0.22),
                )];
            }
            let mut bot_segs = dual
                .map(|d| resolve_panel_segments(d.bottom.suggested.as_ref(), &d.bottom.edits))
                .unwrap_or_default();
            if bot_segs.is_empty() {
                bot_segs = vec![static_segment(
                    clip_start_us,
                    clip_end_us,
                    default_panel_rect(aspect, 1080.0 / f64::from(bot_h), 1.0, 0.5, 0.5),
                )];
            }
            ResolvedCropPlan {
                layout,
                split_ratio: f64::from(top_h) / 1920.0,
                panels: vec![
                    PanelPlan {
                        target_width: 1080,
                        target_height: top_h,
                        fit_mode: PanelFitMode::Fill,
                        segments: top_segs,
                    },
                    PanelPlan {
                        target_width: 1080,
                        target_height: bot_h,
                        fit_mode: PanelFitMode::Fill,
                        segments: bot_segs,
                    },
                ],
            }
        }
        CropLayout::TwoPeople => {
            let (top_h, bot_h) = panel_heights(CropLayout::TwoPeople, timeline.split_ratio);
            let dual = timeline.two_people.as_ref();
            let mut top_segs = dual
                .map(|d| resolve_panel_segments(d.top.suggested.as_ref(), &d.top.edits))
                .unwrap_or_default();
            if top_segs.is_empty() {
                top_segs = vec![static_segment(
                    clip_start_us,
                    clip_end_us,
                    default_panel_rect(aspect, 1080.0 / f64::from(top_h), 1.0, 0.25, 0.5),
                )];
            }
            let mut bot_segs = dual
                .map(|d| resolve_panel_segments(d.bottom.suggested.as_ref(), &d.bottom.edits))
                .unwrap_or_default();
            if bot_segs.is_empty() {
                bot_segs = vec![static_segment(
                    clip_start_us,
                    clip_end_us,
                    default_panel_rect(aspect, 1080.0 / f64::from(bot_h), 1.0, 0.75, 0.5),
                )];
            }
            ResolvedCropPlan {
                layout,
                split_ratio: f64::from(top_h) / 1920.0,
                panels: vec![
                    PanelPlan {
                        target_width: 1080,
                        target_height: top_h,
                        fit_mode: PanelFitMode::Fill,
                        segments: top_segs,
                    },
                    PanelPlan {
                        target_width: 1080,
                        target_height: bot_h,
                        fit_mode: PanelFitMode::Fill,
                        segments: bot_segs,
                    },
                ],
            }
        }
    }
}

pub fn evaluate_plan(plan: &ResolvedCropPlan, time_us: i64) -> Vec<EvaluatedPanel> {
    plan.panels
        .iter()
        .filter_map(|p| {
            interpolate(&p.segments, time_us).map(|rect| EvaluatedPanel {
                target_width: p.target_width,
                target_height: p.target_height,
                fit_mode: p.fit_mode,
                rect,
            })
        })
        .collect()
}

fn segment_at(segments: &[CropSegment], time_us: i64) -> Option<&CropSegment> {
    if segments.is_empty() {
        return None;
    }
    if time_us < segments[0].start_us {
        return Some(&segments[0]);
    }
    let idx = segments.partition_point(|s| s.start_us <= time_us);
    Some(&segments[idx.saturating_sub(1)])
}

/// Única função de interpolação para preview e export. Interpola linearmente
/// apenas dentro do segmento ativo; limites de segmento (`scene`/`face_switch`)
/// dão corte seco sem interpolação cruzada.
pub fn interpolate(segments: &[CropSegment], time_us: i64) -> Option<CropRect> {
    let seg = segment_at(segments, time_us)?;
    interpolate_in_segment(seg, time_us)
}

pub(crate) fn interpolate_in_segment(seg: &CropSegment, time_us: i64) -> Option<CropRect> {
    let first = seg.keyframes.first()?;
    if time_us <= first.time_us || seg.keyframes.len() == 1 {
        return Some(first.rect());
    }
    let last = seg.keyframes.last().unwrap();
    if time_us >= last.time_us {
        return Some(last.rect());
    }
    let next_idx = seg.keyframes.partition_point(|k| k.time_us <= time_us);
    let a = &seg.keyframes[next_idx - 1];
    let b = &seg.keyframes[next_idx];
    let span = (b.time_us - a.time_us) as f64;
    let alpha = (time_us - a.time_us) as f64 / span;
    Some(CropRect {
        x: a.x + (b.x - a.x) * alpha,
        y: a.y + (b.y - a.y) * alpha,
        width: a.width + (b.width - a.width) * alpha,
        height: a.height + (b.height - a.height) * alpha,
    })
}

/// Timeline de exemplo determinística para testes e demonstração sem o worker (#20).
pub fn example_timeline(start_us: i64, end_us: i64, source_aspect: f64) -> SuggestedCrop {
    let crop_w = (9.0 / 16.0 / source_aspect).clamp(0.05, 1.0);
    let crop_h = (source_aspect / (9.0 / 16.0)).clamp(0.05, 1.0);
    let max_x = (1.0 - crop_w).max(0.0);
    let max_y = (1.0 - crop_h).max(0.0);
    let mid = start_us + (end_us - start_us) / 2;
    let pan_end = (start_us + (end_us - start_us) * 2 / 5).max(start_us + 1);
    let segments = if end_us - start_us >= 2_000_000 {
        vec![
            CropSegment {
                start_us,
                end_us: mid,
                reason: "start".into(),
                keyframes: vec![
                    CropKeyframe {
                        time_us: start_us,
                        x: 0.0,
                        y: 0.0,
                        width: crop_w,
                        height: crop_h,
                        confidence: Some(0.95),
                        cut: false,
                    },
                    CropKeyframe {
                        time_us: pan_end,
                        x: max_x * 0.5,
                        y: max_y * 0.5,
                        width: crop_w,
                        height: crop_h,
                        confidence: Some(0.95),
                        cut: false,
                    },
                ],
            },
            CropSegment {
                start_us: mid,
                end_us,
                reason: "scene".into(),
                keyframes: vec![CropKeyframe {
                    time_us: mid,
                    x: max_x,
                    y: max_y,
                    width: crop_w,
                    height: crop_h,
                    confidence: Some(0.9),
                    cut: false,
                }],
            },
        ]
    } else {
        vec![CropSegment {
            start_us,
            end_us,
            reason: "start".into(),
            keyframes: vec![CropKeyframe {
                time_us: start_us,
                x: max_x * 0.5,
                y: max_y * 0.5,
                width: crop_w,
                height: crop_h,
                confidence: Some(0.95),
                cut: false,
            }],
        }]
    };
    SuggestedCrop {
        schema_version: 1,
        revision: 1,
        status: "suggestion".into(),
        segments,
        metrics: None,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn kf(time_us: i64, x: f64, width: f64) -> CropKeyframe {
        CropKeyframe {
            time_us,
            x,
            y: 0.0,
            width,
            height: 1.0,
            confidence: None,
            cut: false,
        }
    }

    #[test]
    fn interpolates_linearly_inside_segments_and_hard_cuts_across_scene_and_face_switch() {
        let suggested = SuggestedCrop {
            schema_version: 1,
            revision: 1,
            status: "suggestion".into(),
            segments: vec![
                CropSegment {
                    start_us: 1_000_000,
                    end_us: 3_000_000,
                    reason: "start".into(),
                    keyframes: vec![kf(1_000_000, 0.1, 0.3), kf(2_000_000, 0.3, 0.3)],
                },
                CropSegment {
                    start_us: 3_000_000,
                    end_us: 5_000_000,
                    reason: "scene".into(),
                    keyframes: vec![kf(3_000_000, 0.6, 0.3), kf(4_000_000, 0.7, 0.3)],
                },
                CropSegment {
                    start_us: 5_000_000,
                    end_us: 7_000_000,
                    reason: "face_switch".into(),
                    keyframes: vec![kf(5_000_000, 0.0, 0.3)],
                },
            ],
            metrics: None,
        };
        let resolved = resolve(&CropTimeline {
            suggested: Some(suggested),
            edits: vec![],
            ..Default::default()
        });
        assert_eq!(interpolate(&resolved, 500_000).unwrap().x, 0.1);
        assert!((interpolate(&resolved, 1_500_000).unwrap().x - 0.2).abs() < 1e-12);
        // Holds last keyframe until segment end: never interpolates toward 0.6 across scene cut.
        assert!((interpolate(&resolved, 2_999_999).unwrap().x - 0.3).abs() < 1e-12);
        // Hard cut at scene boundary.
        assert!((interpolate(&resolved, 3_000_000).unwrap().x - 0.6).abs() < 1e-12);
        assert!((interpolate(&resolved, 3_500_000).unwrap().x - 0.65).abs() < 1e-12);
        // Holds 0.7 up to face_switch, then hard cuts to 0.0.
        assert!((interpolate(&resolved, 4_999_999).unwrap().x - 0.7).abs() < 1e-12);
        assert!((interpolate(&resolved, 5_000_000).unwrap().x - 0.0).abs() < 1e-12);
        assert!((interpolate(&resolved, 9_000_000).unwrap().x - 0.0).abs() < 1e-12);
    }

    #[test]
    fn edits_override_only_their_scene_segment_and_keep_suggested_intact() {
        let suggested = example_timeline(10_000_000, 20_000_000, 16.0 / 9.0);
        let timeline = CropTimeline {
            suggested: Some(suggested.clone()),
            edits: vec![kf(11_000_000, 0.4, 0.3), kf(13_000_000, 0.5, 0.3)],
            ..Default::default()
        };
        let resolved = resolve(&timeline);
        assert_eq!(resolved.len(), 2);
        // Segment 1 (10s..15s) uses edits only.
        assert!((interpolate(&resolved, 10_000_000).unwrap().x - 0.4).abs() < 1e-12);
        assert!((interpolate(&resolved, 12_000_000).unwrap().x - 0.45).abs() < 1e-12);
        // Segment 2 (15s..20s) keeps untouched suggestion.
        let seg2_expected = suggested.segments[1].keyframes[0].x;
        assert!((interpolate(&resolved, 15_000_000).unwrap().x - seg2_expected).abs() < 1e-12);
        // Suggested remains immutable inside the timeline.
        assert_eq!(timeline.suggested.as_ref().unwrap(), &suggested);
    }

    #[test]
    fn rejects_invalid_bounds_and_non_monotonic_keyframes() {
        assert!(validate_keyframe(&kf(0, 0.8, 0.3)).is_err());
        assert!(validate_keyframe(&kf(-1, 0.1, 0.3)).is_err());
        assert!(validate_keyframe(&kf(0, 0.1, 0.0)).is_err());
        assert!(validate_edits(&[kf(100, 0.1, 0.3), kf(100, 0.2, 0.3)]).is_err());
    }

    #[test]
    fn resolve_plan_covers_all_five_v1_layouts_and_split_bounds() {
        let suggested = example_timeline(0, 4_000_000, 16.0 / 9.0);
        let manual = vec![kf(0, 0.12, 0.31640625)];

        // Fit: ignora suggested, usa tela inteira sem edits e aceita edits manuais.
        let fit_default = resolve_plan(
            &CropTimeline {
                layout: Some(CropLayout::Fit),
                suggested: Some(suggested.clone()),
                ..Default::default()
            },
            16.0 / 9.0,
            0,
            4_000_000,
        );
        assert_eq!(fit_default.panels.len(), 1);
        assert_eq!(fit_default.panels[0].fit_mode, PanelFitMode::Fit);
        assert_eq!(fit_default.panels[0].segments[0].keyframes[0].width, 1.0);

        let fit_manual = resolve_plan(
            &CropTimeline {
                layout: Some(CropLayout::Fit),
                edits: vec![kf(0, 0.2, 0.5)],
                ..Default::default()
            },
            16.0 / 9.0,
            0,
            4_000_000,
        );
        assert_eq!(fit_manual.panels[0].fit_mode, PanelFitMode::Fit);
        assert_eq!(fit_manual.panels[0].segments[0].keyframes[0].x, 0.2);

        // FullscreenRoi: reutiliza edits do #71 e ignora suggested (sem rastreio de rosto).
        let roi = resolve_plan(
            &CropTimeline {
                layout: Some(CropLayout::FullscreenRoi),
                suggested: Some(suggested),
                edits: manual,
                ..Default::default()
            },
            16.0 / 9.0,
            0,
            4_000_000,
        );
        assert_eq!(roi.panels[0].fit_mode, PanelFitMode::Fill);
        assert_eq!(roi.panels[0].segments.len(), 1);
        assert_eq!(roi.panels[0].segments[0].keyframes[0].x, 0.12);

        // GameplayWebcam: padrão 30/70 (576/1344) e limites 20..50%.
        let gw = resolve_plan(
            &CropTimeline {
                layout: Some(CropLayout::GameplayWebcam),
                ..Default::default()
            },
            16.0 / 9.0,
            0,
            4_000_000,
        );
        assert_eq!(gw.panels.len(), 2);
        assert_eq!(
            (gw.panels[0].target_height, gw.panels[1].target_height),
            (576, 1344)
        );
        assert!(validate_split_ratio(Some(CropLayout::GameplayWebcam), Some(0.19)).is_err());
        assert!(validate_split_ratio(Some(CropLayout::GameplayWebcam), Some(0.51)).is_err());
        assert!(validate_split_ratio(Some(CropLayout::GameplayWebcam), Some(0.40)).is_ok());

        // TwoPeople: padrão 50/50 (960/960) e limites 30..70%.
        let tp = resolve_plan(
            &CropTimeline {
                layout: Some(CropLayout::TwoPeople),
                split_ratio: Some(0.40),
                ..Default::default()
            },
            16.0 / 9.0,
            0,
            4_000_000,
        );
        assert_eq!(tp.panels.len(), 2);
        assert_eq!(
            (tp.panels[0].target_height, tp.panels[1].target_height),
            (768, 1152)
        );
        assert!(validate_split_ratio(Some(CropLayout::TwoPeople), Some(0.29)).is_err());
        assert!(validate_split_ratio(Some(CropLayout::TwoPeople), Some(0.71)).is_err());
    }
}
