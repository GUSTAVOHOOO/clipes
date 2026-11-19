//! Estimativa de tempo da Transcrição local, medida num trecho da própria Fonte (#50).
//!
//! Lives abrem com tela de espera, que o VAD pula, então o trecho nunca é o início: são
//! [`SAMPLE_US`] a partir de [`SAMPLE_START_PERCENT`] % da duração (Fonte com menos de
//! [`WHOLE_BELOW_US`]: inteira). O carregamento do modelo, custo único, é medido à parte da
//! taxa: estimativa = carregamento + taxa × duração. A taxa fica guardada por (hardware,
//! modelo, precisão) e é reutilizada; `remeasure` mede de novo. A medição é cancelável
//! (`components.cancel` com [`ESTIMATE_JOB`]), emite progresso e nunca grava na Transcrição.

use super::*;
use crate::components::hardware;

/// Duração do trecho medido.
pub(crate) const SAMPLE_US: i64 = 30_000_000;
/// Onde o trecho começa, em % da duração da Fonte.
pub(crate) const SAMPLE_START_PERCENT: i64 = 25;
/// Fontes mais curtas que isto são medidas por inteiro.
pub(crate) const WHOLE_BELOW_US: i64 = 60_000_000;
/// Faixa mostrada em torno da estimativa.
pub(crate) const RANGE_LOW: f64 = 0.7;
pub(crate) const RANGE_HIGH: f64 = 1.5;
pub(crate) const ESTIMATE_JOB: &str = "transcription-estimate";

/// `(início, duração)` do trecho medido, em µs.
pub(crate) fn sample_window(duration_us: i64) -> (i64, i64) {
    if duration_us < WHOLE_BELOW_US {
        return (0, duration_us);
    }
    let start = duration_us * SAMPLE_START_PERCENT / 100;
    (start, SAMPLE_US.min(duration_us - start))
}

pub(crate) fn estimate_seconds(load_s: f64, rate: f64, duration_s: f64) -> f64 {
    load_s + rate * duration_s
}

fn progress(events: &mut EventSink<'_>, percentage: u8, message: &str) {
    events(crate::ProgressEvent {
        project: None,
        clip_id: None,
        job: ESTIMATE_JOB.into(),
        stage: "estimate".into(),
        percentage,
        message: message.into(),
        error: None,
    });
}

fn measure(
    ctx: &hardware::Context,
    source: &Path,
    track: i64,
    duration_us: i64,
    cancel: &AtomicBool,
    events: &mut EventSink<'_>,
) -> Result<(f64, f64), CoreError> {
    if !ctx.model_ready() {
        return Err(error(
            "model_missing",
            "O modelo de transcrição não está instalado; baixe-o em Componentes.",
        ));
    }
    let (cache, _, ffmpeg) = crate::components::cache_settings()?;
    let ffmpeg =
        ffmpeg.ok_or_else(|| error("component_missing", "Instale o Componente FFmpeg."))?;
    let work = cache.join("transcribe");
    fs::create_dir_all(&work).map_err(|_| audio_failed())?;
    let wav = work.join(format!("estimate-{}.wav", std::process::id()));
    let (start_us, len_us) = sample_window(duration_us);
    progress(events, 0, "Extraindo o trecho");
    let check = || {
        if cancel.load(Ordering::SeqCst) {
            Err(error("cancelled", "Tarefa cancelada."))
        } else {
            Ok(())
        }
    };
    let extracted = extract_checked(
        &ffmpeg,
        &Slice {
            source,
            track,
            start_us,
            len_us,
        },
        &wav,
        &check,
    );
    let outcome = extracted.and_then(|()| {
        hardware::run_probe_task(
            json!({"mode": "audio", "audio": wav, "model": ctx.model_params()}),
            cancel,
            &mut |percent| progress(events, 10 + percent.min(100) / 2, "Medindo a velocidade"),
        )
    });
    let _ = fs::remove_file(&wav);
    let data = outcome?;
    let (load_s, run_s, audio_s) = (
        data["load_s"].as_f64(),
        data["run_s"].as_f64(),
        data["audio_s"].as_f64(),
    );
    match (load_s, run_s, audio_s) {
        (Some(load), Some(run), Some(audio)) if audio > 0.0 && run >= 0.0 && load >= 0.0 => {
            Ok((load, run / audio))
        }
        _ => Err(bad_result()),
    }
}

/// `transcription.estimate {project, source_id, remeasure?}`.
fn estimate(v: Value, events: &mut EventSink<'_>) -> CommandResult {
    let _job = project_job(&v)?;
    let source = source_id(&v)?;
    let (path, _, track, duration, _) =
        preview::source(source, Path::new(v["project"].as_str().unwrap_or_default()))?;
    let ctx = hardware::context()?;
    let cached = if v["remeasure"] == true {
        None
    } else {
        ctx.rate()
    };
    let (load_s, rate, measured_at, was_cached) = if let Some(saved) = cached {
        (saved.load_s, saved.rate, saved.measured_at, true)
    } else {
        let (load_s, rate) = hardware::with_cancel(ESTIMATE_JOB, |cancel| {
            measure(&ctx, &path, track, duration, cancel, events)
        })?;
        ctx.save_rate(load_s, rate)?;
        (load_s, rate, hardware::now(), false)
    };
    let seconds = estimate_seconds(load_s, rate, duration as f64 / 1_000_000.0);
    let (start_us, sample_us) = sample_window(duration);
    progress(events, 100, "Estimativa pronta");
    Ok(json!({
        "model": ctx.config.model,
        "device": ctx.config.device,
        "compute_type": ctx.config.compute_type,
        "load_s": load_s,
        "rate": rate,
        "estimate_s": seconds,
        "low_s": seconds * RANGE_LOW,
        "high_s": seconds * RANGE_HIGH,
        "sample_start_us": start_us,
        "sample_us": sample_us,
        "cached": was_cached,
        "measured_at": measured_at,
        "cpu": ctx.config.device == "cpu",
        "warnings": hardware::start_warnings(&ctx.config),
    }))
}

inventory::submit! { CommandRegistration { name: "transcription.estimate", execute: estimate } }

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn sample_starts_at_a_quarter_and_never_at_the_beginning() {
        assert_eq!(sample_window(36_000_000_000), (9_000_000_000, SAMPLE_US));
        assert_eq!(sample_window(100_000_000), (25_000_000, SAMPLE_US));
    }

    #[test]
    fn short_sources_are_measured_whole() {
        assert_eq!(sample_window(59_999_999), (0, 59_999_999));
        assert_eq!(sample_window(60_000_000), (15_000_000, SAMPLE_US));
    }

    #[test]
    fn estimate_separates_one_time_load_from_the_rate() {
        // Taxa medida de 0,5 s por s de áudio e 10 s de carregamento, numa hora de Fonte.
        assert_eq!(estimate_seconds(10.0, 0.5, 3600.0), 1810.0);
        assert_eq!(estimate_seconds(10.0, 0.5, 0.0), 10.0);
    }
}
