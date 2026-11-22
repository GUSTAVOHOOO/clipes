//! Worker output is data, never paths or instructions. Validate before SQLite.
use super::*;
use serde::{Deserialize, Serialize};

#[derive(Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(super) struct Timeline {
    schema_version: u32,
    revision: u32,
    status: String,
    segments: Vec<Segment>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    secondary_segments: Option<Vec<Segment>>,
    metrics: Metrics,
}
#[derive(Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct Segment {
    start_us: i64,
    end_us: i64,
    reason: String,
    keyframes: Vec<Keyframe>,
}
#[derive(Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct Keyframe {
    time_us: i64,
    x: f64,
    y: f64,
    width: f64,
    height: f64,
    confidence: f64,
}
#[derive(Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct Metrics {
    device: String,
    frames: u64,
    elapsed_ms: u64,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    webcam_detected: Option<bool>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    webcam_confidence: Option<f64>,
    /// "retangulo" | "circulo" | "recorte" | "nenhuma" (só no layout Jogo + Webcam).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    webcam_shape: Option<String>,
    /// Câmera grande demais para o painel: o layout Rosto serve melhor.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    webcam_large: Option<bool>,
}

fn validate_segments(
    segments: &[Segment],
    start: i64,
    end: i64,
    max_frames: u64,
    expected_frames: u64,
) -> Result<(), CoreError> {
    if segments.is_empty() {
        return Err(protocol());
    }
    let mut next = start;
    let mut count = 0u64;
    for (i, segment) in segments.iter().enumerate() {
        if segment.start_us != next
            || segment.end_us <= next
            || segment.end_us > end
            || segment.keyframes.is_empty()
            || (i == 0 && segment.reason != "start")
            || (i > 0 && !matches!(segment.reason.as_str(), "scene" | "face_switch"))
            || segment.keyframes[0].time_us != segment.start_us
        {
            return Err(protocol());
        }
        let mut previous = segment.start_us - 1;
        for k in &segment.keyframes {
            if k.time_us <= previous
                || k.time_us >= segment.end_us
                || ![k.x, k.y, k.width, k.height, k.confidence]
                    .iter()
                    .all(|n| n.is_finite() && (0.0..=1.0).contains(n))
                || k.width == 0.0
                || k.height == 0.0
                || k.x + k.width > 1.0 + 1e-9
                || k.y + k.height > 1.0 + 1e-9
            {
                return Err(protocol());
            }
            previous = k.time_us;
            count += 1;
        }
        next = segment.end_us;
    }
    if next != end || count > max_frames || count > expected_frames {
        return Err(protocol());
    }
    Ok(())
}

pub(super) fn validate(
    data: Value,
    start: i64,
    end: i64,
    layout: &str,
) -> Result<(Timeline, Option<Timeline>), CoreError> {
    let mut doc: Timeline = serde_json::from_value(data).map_err(|_| protocol())?;
    if doc.schema_version != 1
        || doc.revision != 1
        || doc.status != "suggestion"
        || !matches!(doc.metrics.device.as_str(), "cpu" | "cuda")
        || doc
            .metrics
            .webcam_confidence
            .is_some_and(|c| !c.is_finite() || !(0.0..=1.0).contains(&c))
    {
        return Err(protocol());
    }
    let max_frames = ((end - start) as u64).div_ceil(200_000);
    validate_segments(&doc.segments, start, end, max_frames, doc.metrics.frames)?;
    let secondary_segments = doc.secondary_segments.take();
    let secondary = match (layout, secondary_segments) {
        ("gameplay_webcam" | "two_people", Some(segs)) => {
            validate_segments(&segs, start, end, max_frames, doc.metrics.frames)?;
            Some(Timeline {
                schema_version: doc.schema_version,
                revision: doc.revision,
                status: doc.status.clone(),
                segments: segs,
                secondary_segments: None,
                metrics: doc.metrics.clone(),
            })
        }
        ("gameplay_webcam" | "two_people", None) => return Err(protocol()),
        (_, Some(_)) => return Err(protocol()),
        (_, None) => None,
    };
    Ok((doc, secondary))
}
