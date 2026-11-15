//! Worker output is data, never paths or instructions. Validate before SQLite.
use super::*;
use serde::{Deserialize, Serialize};

#[derive(Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(super) struct Timeline {
    schema_version: u32,
    revision: u32,
    status: String,
    segments: Vec<Segment>,
    metrics: Metrics,
}
#[derive(Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct Segment {
    start_us: i64,
    end_us: i64,
    reason: String,
    keyframes: Vec<Keyframe>,
}
#[derive(Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct Keyframe {
    time_us: i64,
    x: f64,
    y: f64,
    width: f64,
    height: f64,
    confidence: f64,
}
#[derive(Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct Metrics {
    device: String,
    frames: u64,
    elapsed_ms: u64,
}

pub(super) fn validate(data: Value, start: i64, end: i64) -> Result<Timeline, CoreError> {
    let doc: Timeline = serde_json::from_value(data).map_err(|_| protocol())?;
    if doc.schema_version != 1
        || doc.revision != 1
        || doc.status != "suggestion"
        || doc.segments.is_empty()
        || !matches!(doc.metrics.device.as_str(), "cpu" | "cuda")
    {
        return Err(protocol());
    }
    let mut next = start;
    let mut count = 0u64;
    for (i, segment) in doc.segments.iter().enumerate() {
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
    let max_frames = ((end - start) as u64).div_ceil(200_000);
    if next != end || count > max_frames || count != doc.metrics.frames {
        return Err(protocol());
    }
    Ok(doc)
}
