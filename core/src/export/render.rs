//! Processo gerenciado, sem shell, sem caminhos no log e publicação sem sobrescrita.
use super::{
    captions::{self, CaptionWord},
    error, failed, pipeline,
};
use crate::{editor::silences::KeptSegment, provider::CancelToken, CoreError};
use std::{
    ffi::OsString,
    fs,
    io::{BufRead, BufReader},
    path::{Path, PathBuf},
    sync::mpsc,
    time::{Duration, Instant},
};

pub const FONT_BYTES: &[u8] = include_bytes!("../../assets/fonts/NotoSans-Bold.ttf");
pub const SERIF_FONT_BYTES: &[u8] = include_bytes!("../../assets/fonts/NotoSerif-Bold.ttf");
pub const FONT_SHA256: &str = "c976e4b1b99edc88775377fcc21692ca4bfa46b6d6ca6522bfda505b28ff9d6a";
pub const PROCESS_POLL: Duration = Duration::from_millis(25);
/// Campos do JSON do `loudnorm` (ordem de `Measured`).
const MEASURED_KEYS: [&str; 5] = [
    "input_i",
    "input_tp",
    "input_lra",
    "input_thresh",
    "target_offset",
];
/// A medição ocupa o começo da barra; a renderização, o resto (até 95%).
const MEASURE_END: u64 = 10;
const RENDER_END: u64 = 95;
pub const PROBE_TIMEOUT: Duration = Duration::from_secs(10);

pub struct RenderInput {
    pub source: PathBuf,
    pub output: PathBuf,
    pub start_us: i64,
    pub end_us: i64,
    pub audio_track: i64,
    /// Tempos relativos ao início do Corte, texto efetivo.
    pub words: Vec<CaptionWord>,
    /// Segmentos resolvidos de crop (#66); vazio mantém Fit 1080×1920.
    pub crop: Vec<crate::editor::crop::CropSegment>,
}
#[derive(Default)]
struct Report {
    measured: [Option<f64>; 5],
    help: String,
    font_selected: bool,
    font_fallback: bool,
    font_loaded: bool,
}

fn cancelled() -> CoreError {
    error("cancelled", "Export cancelado.")
}

/// Extrai `out_time_us` de uma linha `-progress` do FFmpeg, ignorando `N/A` ou outros campos.
pub fn parse_out_time_us(line: &str) -> Option<i64> {
    line.trim()
        .strip_prefix("out_time_us=")
        .and_then(|s| s.parse::<i64>().ok())
}

/// Converte relatórios `-progress` em porcentagens monótonas entre as passagens do export.
/// O FFmpeg 9 pode emitir `out_time_us` fora de ordem quando vídeo e áudio com `loudnorm`
/// avançam em ritmos diferentes; o normalizador retém o maior percentual já emitido.
#[derive(Clone, Copy, Debug, Default)]
pub struct ProgressNormalizer {
    last_percent: u8,
}

impl ProgressNormalizer {
    pub fn new() -> Self {
        Self::default()
    }

    pub fn push_line(&mut self, line: &str, duration_us: i64, range: (u64, u64)) -> Option<u8> {
        let time_us = parse_out_time_us(line)?;
        self.push_time_us(time_us, duration_us, range)
    }

    pub fn push_time_us(
        &mut self,
        out_time_us: i64,
        duration_us: i64,
        range: (u64, u64),
    ) -> Option<u8> {
        let (low, high) = range;
        if high == 0 || high < low {
            return None;
        }
        let part =
            (out_time_us.max(0) as u64).saturating_mul(high - low) / duration_us.max(1) as u64;
        let pct = (low + part).clamp(low.max(1), high) as u8;
        if pct > self.last_percent {
            self.last_percent = pct;
            Some(pct)
        } else {
            None
        }
    }

    pub fn finish(&mut self) -> Option<u8> {
        if self.last_percent < 100 {
            self.last_percent = 100;
            Some(100)
        } else {
            None
        }
    }
}

#[allow(clippy::too_many_arguments)]
fn execute(
    program: &Path,
    args: &[OsString],
    cwd: Option<&Path>,
    cancel: &CancelToken,
    duration_us: i64,
    font_file: Option<&'static str>,
    range: (u64, u64),
    tracker: &mut ProgressNormalizer,
    progress: &mut dyn FnMut(u8),
) -> Result<Report, CoreError> {
    let probe = font_file.is_none();
    let font_file = font_file.unwrap_or("NotoSans-Bold.ttf");
    if cancel.is_cancelled() {
        return Err(cancelled());
    }
    let (mut child, group) = crate::process::spawn_managed_with(program, args, |command| {
        command.stdin(std::process::Stdio::null());
        if let Some(dir) = cwd {
            command.current_dir(dir);
        }
    })
    .map_err(|_| failed())?;
    let stdout = child.stdout.take().ok_or_else(failed)?;
    let stderr = child.stderr.take().ok_or_else(failed)?;
    let (tx, rx) = mpsc::channel();
    let reader = std::thread::spawn(move || {
        let mut help = String::new();
        for line in BufReader::new(stdout).lines().map_while(Result::ok) {
            if probe && help.len() < 65_536 {
                help.push_str(&line);
                help.push('\n');
            }
            if let Some(value) = parse_out_time_us(&line) {
                let _ = tx.send(value);
            }
        }
        help
    });
    let errors = std::thread::spawn(move || {
        let mut selected = false;
        let mut fallback = false;
        let mut loaded = false;
        let mut measured = [None; 5];
        for line in BufReader::new(stderr).lines().map_while(Result::ok) {
            // Só os campos numéricos do JSON do `loudnorm`; o resto do stderr é descartado.
            if let Some((key, value)) = line
                .trim()
                .strip_prefix('"')
                .and_then(|s| s.split_once('"'))
            {
                if let Some(i) = MEASURED_KEYS.iter().position(|k| *k == key) {
                    measured[i] = value
                        .trim_start_matches([' ', ':'])
                        .trim_end_matches(',')
                        .trim_matches('"')
                        .parse::<f64>()
                        .ok();
                }
            }
            loaded |= line.contains("Loading font file") && line.contains(font_file);
            if line.contains("fontselect:") && line.contains(" -> ") {
                if line
                    .split(" -> ")
                    .nth(1)
                    .is_some_and(|s| s.contains(font_file.trim_end_matches(".ttf")))
                {
                    selected = true;
                } else {
                    fallback = true;
                }
            }
        }
        (selected, fallback, loaded, measured)
    });
    let started = Instant::now();
    let status = loop {
        if cancel.is_cancelled() || (probe && started.elapsed() > PROBE_TIMEOUT) {
            group.terminate();
            let _ = child.wait();
            break Err(if cancel.is_cancelled() {
                cancelled()
            } else {
                failed()
            });
        }
        for value in rx.try_iter() {
            if let Some(pct) = tracker.push_time_us(value, duration_us, range) {
                progress(pct);
            }
        }
        match child.try_wait() {
            Ok(Some(status)) => {
                break if status.success() {
                    Ok(())
                } else {
                    Err(failed())
                }
            }
            Ok(None) => std::thread::sleep(PROCESS_POLL),
            Err(_) => {
                group.terminate();
                let _ = child.wait();
                break Err(failed());
            }
        }
    };
    let help = reader.join().map_err(|_| failed())?;
    let (font_selected, font_fallback, font_loaded, measured) =
        errors.join().map_err(|_| failed())?;
    status?;
    for value in rx.try_iter() {
        if let Some(pct) = tracker.push_time_us(value, duration_us, range) {
            progress(pct);
        }
    }
    Ok(Report {
        measured,
        help,
        font_selected,
        font_fallback,
        font_loaded,
    })
}

/// `-h filter=ass` pode sair com código zero mesmo quando o filtro não existe.
pub fn check_ass(ffmpeg: &Path, cancel: &CancelToken) -> Result<(), CoreError> {
    let mut tracker = ProgressNormalizer::new();
    let report = execute(
        ffmpeg,
        &["-hide_banner".into(), "-h".into(), "filter=ass".into()],
        None,
        cancel,
        1,
        None,
        (0, 0),
        &mut tracker,
        &mut |_| {},
    )?;
    if !report.help.lines().any(|s| s.trim() == "Filter ass") || !report.help.contains("fontsdir") {
        return Err(error(
            "export_ass_missing",
            "O Componente FFmpeg não tem o filtro ASS/libass.",
        ));
    }
    Ok(())
}

pub fn validate_output(output: &Path) -> Result<(), CoreError> {
    validate_output_with_overwrite(output, false)
}

pub(crate) fn validate_output_with_overwrite(
    output: &Path,
    overwrite: bool,
) -> Result<(), CoreError> {
    if !overwrite && output.exists() {
        return Err(error(
            "export_exists",
            "Já existe um arquivo no destino. Escolha outro nome.",
        ));
    }
    if !output.is_absolute()
        || output
            .extension()
            .is_none_or(|e| !e.eq_ignore_ascii_case("mp4"))
        || output.parent().is_none_or(|p| !p.is_dir())
    {
        return Err(error(
            "export_destination",
            "Escolha uma pasta existente e um nome MP4 válido.",
        ));
    }
    Ok(())
}

/// O temporário fica na mesma pasta da saída; persist_noclobber publica sem jamais
/// substituir um arquivo criado enquanto o FFmpeg estava trabalhando.
pub fn render(
    ffmpeg: &Path,
    input: &RenderInput,
    cancel: &CancelToken,
    progress: &mut dyn FnMut(u8),
) -> Result<(), CoreError> {
    render_with(ffmpeg, input, super::encoder::X264, cancel, progress)
}

/// Igual a `render`, com o encoder da etapa `SelectedEncoder` (#62).
pub fn render_with(
    ffmpeg: &Path,
    input: &RenderInput,
    encoder: &str,
    cancel: &CancelToken,
    progress: &mut dyn FnMut(u8),
) -> Result<(), CoreError> {
    render_spliced_with(ffmpeg, input, &[], encoder, cancel, progress)
}

/// Igual a `render`, aplicando os trechos mantidos do corte de silêncios (#77).
pub fn render_spliced(
    ffmpeg: &Path,
    input: &RenderInput,
    segments: &[KeptSegment],
    cancel: &CancelToken,
    progress: &mut dyn FnMut(u8),
) -> Result<(), CoreError> {
    render_spliced_with(
        ffmpeg,
        input,
        segments,
        super::encoder::X264,
        cancel,
        progress,
    )
}

pub fn render_spliced_with(
    ffmpeg: &Path,
    input: &RenderInput,
    segments: &[KeptSegment],
    encoder: &str,
    cancel: &CancelToken,
    progress: &mut dyn FnMut(u8),
) -> Result<(), CoreError> {
    let duration = if segments.len() > 1 {
        segments
            .last()
            .map_or(input.end_us - input.start_us, |s| s.output_end_us)
    } else {
        input.end_us - input.start_us
    };
    let ass = captions::ass(&input.words, duration)?;
    let doc = AssDoc {
        ass: &ass,
        font_file: "NotoSans-Bold.ttf",
        font_bytes: FONT_BYTES,
    };
    render_ass_spliced(
        ffmpeg, input, segments, &doc, encoder, false, cancel, progress,
    )
}

/// O job usa exatamente o documento/cues entregue ao preview no início do render.
pub fn render_styled(
    ffmpeg: &Path,
    input: &RenderInput,
    prepared: &crate::caption_style::Prepared,
    cancel: &CancelToken,
    progress: &mut dyn FnMut(u8),
) -> Result<(), CoreError> {
    render_styled_with(
        ffmpeg,
        input,
        prepared,
        super::encoder::X264,
        cancel,
        progress,
    )
}

/// `render_styled` com o encoder escolhido (#62).
pub fn render_styled_with(
    ffmpeg: &Path,
    input: &RenderInput,
    prepared: &crate::caption_style::Prepared,
    encoder: &str,
    cancel: &CancelToken,
    progress: &mut dyn FnMut(u8),
) -> Result<(), CoreError> {
    render_styled_spliced_with(ffmpeg, input, &[], prepared, encoder, cancel, progress)
}

/// `render_styled_with` aplicando os trechos mantidos do corte de silêncios (#77).
pub fn render_styled_spliced_with(
    ffmpeg: &Path,
    input: &RenderInput,
    segments: &[KeptSegment],
    prepared: &crate::caption_style::Prepared,
    encoder: &str,
    cancel: &CancelToken,
    progress: &mut dyn FnMut(u8),
) -> Result<(), CoreError> {
    render_styled_spliced_with_overwrite(
        ffmpeg, input, segments, prepared, encoder, false, cancel, progress,
    )
}

/// Variante interna usada pelo lote (#64) quando a sobrescrita foi confirmada pelo usuário.
#[allow(clippy::too_many_arguments)]
pub(crate) fn render_styled_spliced_with_overwrite(
    ffmpeg: &Path,
    input: &RenderInput,
    segments: &[KeptSegment],
    prepared: &crate::caption_style::Prepared,
    encoder: &str,
    overwrite: bool,
    cancel: &CancelToken,
    progress: &mut dyn FnMut(u8),
) -> Result<(), CoreError> {
    render_styled_spliced_crop_plan_with_overwrite(
        ffmpeg, input, segments, prepared, encoder, overwrite, None, cancel, progress,
    )
}

/// Exporta um plano de layout completo (#78: 5 layouts v1, 1 ou 2 painéis).
#[allow(clippy::too_many_arguments)]
pub fn render_crop_plan(
    ffmpeg: &Path,
    input: &RenderInput,
    crop_plan: &crate::editor::crop::ResolvedCropPlan,
    cancel: &CancelToken,
    progress: &mut dyn FnMut(u8),
) -> Result<(), CoreError> {
    let duration = input.end_us - input.start_us;
    let ass = captions::ass(&input.words, duration)?;
    let doc = AssDoc {
        ass: &ass,
        font_file: "NotoSans-Bold.ttf",
        font_bytes: FONT_BYTES,
    };
    render_ass_spliced_plan(
        ffmpeg,
        input,
        &[],
        &doc,
        super::encoder::X264,
        false,
        Some(crop_plan),
        cancel,
        progress,
    )
}

/// Variante interna usada pelo export com layout (#78).
#[allow(clippy::too_many_arguments)]
pub(crate) fn render_styled_spliced_crop_plan_with_overwrite(
    ffmpeg: &Path,
    input: &RenderInput,
    segments: &[KeptSegment],
    prepared: &crate::caption_style::Prepared,
    encoder: &str,
    overwrite: bool,
    crop_plan: Option<&crate::editor::crop::ResolvedCropPlan>,
    cancel: &CancelToken,
    progress: &mut dyn FnMut(u8),
) -> Result<(), CoreError> {
    prepared.style.validate()?;
    let doc = AssDoc {
        ass: &prepared.ass,
        font_file: prepared.style.font_file(),
        font_bytes: prepared.style.font_bytes(),
    };
    render_ass_spliced_plan(
        ffmpeg, input, segments, &doc, encoder, overwrite, crop_plan, cancel, progress,
    )
}

struct AssDoc<'a> {
    ass: &'a str,
    font_file: &'static str,
    font_bytes: &'a [u8],
}

#[allow(clippy::too_many_arguments)]
fn render_ass_spliced(
    ffmpeg: &Path,
    input: &RenderInput,
    segments: &[KeptSegment],
    doc: &AssDoc<'_>,
    encoder: &str,
    overwrite: bool,
    cancel: &CancelToken,
    progress: &mut dyn FnMut(u8),
) -> Result<(), CoreError> {
    render_ass_spliced_plan(
        ffmpeg, input, segments, doc, encoder, overwrite, None, cancel, progress,
    )
}

#[allow(clippy::too_many_arguments)]
fn render_ass_spliced_plan(
    ffmpeg: &Path,
    input: &RenderInput,
    segments: &[KeptSegment],
    doc: &AssDoc<'_>,
    encoder: &str,
    overwrite: bool,
    crop_plan: Option<&crate::editor::crop::ResolvedCropPlan>,
    cancel: &CancelToken,
    progress: &mut dyn FnMut(u8),
) -> Result<(), CoreError> {
    validate_output_with_overwrite(&input.output, overwrite)?;
    if input.start_us < 0 || input.end_us <= input.start_us || input.audio_track < 0 {
        return Err(error("export_bounds", "As bordas do Corte são inválidas."));
    }
    let duration = input.end_us - input.start_us;
    let spliced = segments.len() > 1;
    let output_duration = if spliced {
        segments.last().map_or(duration, |s| s.output_end_us)
    } else {
        duration
    };
    let missing =
        captions::missing_glyphs_in_duration(&input.words, doc.font_bytes, output_duration);
    if !missing.is_empty() {
        return Err(super::glyph_missing_error(
            doc.font_file.trim_end_matches(".ttf"),
            missing,
        ));
    }
    check_ass(ffmpeg, cancel)?;
    let parent = input.output.parent().unwrap();
    let work = tempfile::Builder::new()
        .prefix(".clipes-export-")
        .tempdir_in(parent)
        .map_err(|_| failed())?;
    let fonts = work.path().join("fonts");
    fs::create_dir(&fonts).map_err(|_| failed())?;
    fs::write(fonts.join(doc.font_file), doc.font_bytes).map_err(|_| failed())?;
    fs::write(work.path().join("captions.ass"), doc.ass).map_err(|_| failed())?;
    let partial = tempfile::Builder::new()
        .prefix(".clipes-export-")
        .suffix(".part")
        .tempfile_in(parent)
        .map_err(|_| failed())?;
    let source = input.source.canonicalize().map_err(|_| {
        error(
            "source_changed",
            "A Fonte está indisponível ou foi alterada.",
        )
    })?;
    let mut tracker = ProgressNormalizer::new();
    let measured = measure_loudness(
        ffmpeg,
        &source,
        input,
        segments,
        output_duration,
        work.path(),
        cancel,
        &mut tracker,
        progress,
    )?;
    let plan = if let Some(cp) = crop_plan {
        pipeline::with_crop_plan(
            encoder,
            measured,
            Some(pipeline::CropLayoutStage {
                crop_plan: cp,
                start_us: input.start_us,
                end_us: input.end_us,
            }),
        )
    } else {
        let crop = (!input.crop.is_empty()).then_some(pipeline::Crop {
            segments: &input.crop,
            start_us: input.start_us,
            end_us: input.end_us,
        });
        pipeline::with_crop(encoder, measured, crop)
    };
    for (name, commands) in &plan.crop_files {
        fs::write(work.path().join(name), commands).map_err(|_| failed())?;
    }
    let mut args: Vec<OsString> = vec![
        "-hide_banner".into(),
        "-nostdin".into(),
        "-loglevel".into(),
        "verbose".into(),
        "-filter_threads".into(),
        "1".into(),
        "-ss".into(),
        seconds(input.start_us).into(),
        "-i".into(),
        source.into_os_string(),
        "-t".into(),
        seconds(duration).into(),
    ];
    if spliced {
        let graph = pipeline::build_spliced_filter_complex(
            input.audio_track,
            input.start_us,
            segments,
            &plan,
        );
        args.extend([
            "-filter_complex".into(),
            graph.into(),
            "-map".into(),
            "[vout]".into(),
            "-map".into(),
            "[aout]".into(),
        ]);
    } else if plan.dual_video.is_some() {
        let graph = pipeline::build_dual_filter_complex(&plan);
        args.extend([
            "-filter_complex".into(),
            graph.into(),
            "-map".into(),
            "[vout]".into(),
            "-map".into(),
            format!("0:{}", input.audio_track).into(),
            "-af".into(),
            plan.audio_filters.join(",").into(),
        ]);
    } else {
        args.extend([
            "-map".into(),
            "0:v:0".into(),
            "-map".into(),
            format!("0:{}", input.audio_track).into(),
            "-vf".into(),
            plan.video_filters.join(",").into(),
            "-af".into(),
            plan.audio_filters.join(",").into(),
        ]);
    }
    args.extend([
        "-c:v".into(),
        plan.encoder.into(),
        "-threads".into(),
        "2".into(),
    ]);
    args.extend(plan.encoder_args.iter().map(OsString::from));
    args.extend([
        "-c:a".into(),
        "aac".into(),
        "-b:a".into(),
        "192k".into(),
        "-fps_mode".into(),
        "vfr".into(),
        "-map_metadata".into(),
        "-1".into(),
        "-metadata:s:v:0".into(),
        "rotate=0".into(),
        "-movflags".into(),
        "+faststart".into(),
        "-progress".into(),
        "pipe:1".into(),
        "-f".into(),
        "mp4".into(),
        "-y".into(),
        partial.path().as_os_str().to_owned(),
    ]);
    let report = execute(
        ffmpeg,
        &args,
        Some(work.path()),
        cancel,
        output_duration,
        Some(doc.font_file),
        (MEASURE_END, RENDER_END),
        &mut tracker,
        progress,
    )?;
    if cancel.is_cancelled() {
        return Err(cancelled());
    }
    if !captions::layout(&input.words).is_empty()
        && (!report.font_selected || report.font_fallback || !report.font_loaded)
    {
        return Err(error(
            "export_font_missing",
            "A fonte empacotada da legenda não foi usada pelo FFmpeg.",
        ));
    }
    if overwrite {
        partial.persist(&input.output).map_err(|_| failed())?;
    } else {
        partial.persist_noclobber(&input.output).map_err(|e| {
            if e.error.kind() == std::io::ErrorKind::AlreadyExists {
                error(
                    "export_exists",
                    "Já existe um arquivo no destino. Escolha outro nome.",
                )
            } else {
                failed()
            }
        })?;
    }
    if let Some(pct) = tracker.finish() {
        progress(pct);
    }
    Ok(())
}
pub fn seconds(us: i64) -> String {
    format!("{}.{:06}", us / 1_000_000, us % 1_000_000)
}

/// Primeira passagem do `loudnorm` (#63): mede só o trecho do Corte (já emendado quando há
/// silêncios removidos, #77), sem gravar nada.
/// `None` quando o áudio é silencioso (medição infinita): então não há o que normalizar.
#[allow(clippy::too_many_arguments)]
fn measure_loudness(
    ffmpeg: &Path,
    source: &Path,
    input: &RenderInput,
    segments: &[KeptSegment],
    output_duration: i64,
    work: &Path,
    cancel: &CancelToken,
    tracker: &mut ProgressNormalizer,
    progress: &mut dyn FnMut(u8),
) -> Result<Option<pipeline::Measured>, CoreError> {
    let duration = input.end_us - input.start_us;
    let mut args: Vec<OsString> = vec![
        "-hide_banner".into(),
        "-nostdin".into(),
        "-loglevel".into(),
        "verbose".into(),
        "-ss".into(),
        seconds(input.start_us).into(),
        "-t".into(),
        seconds(duration).into(),
        "-i".into(),
        source.as_os_str().to_owned(),
        "-vn".into(),
    ];
    if segments.len() > 1 {
        let graph =
            pipeline::build_measure_filter_complex(input.audio_track, input.start_us, segments);
        args.extend([
            "-filter_complex".into(),
            graph.into(),
            "-map".into(),
            "[aout]".into(),
        ]);
    } else {
        args.extend([
            "-map".into(),
            format!("0:{}", input.audio_track).into(),
            "-af".into(),
            pipeline::loudnorm_measure_filter().into(),
        ]);
    }
    args.extend([
        "-progress".into(),
        "pipe:1".into(),
        "-f".into(),
        "null".into(),
        "-".into(),
    ]);
    let report = execute(
        ffmpeg,
        &args,
        Some(work),
        cancel,
        output_duration,
        Some("NotoSans-Bold.ttf"),
        (0, MEASURE_END),
        tracker,
        progress,
    )?;
    // O FFmpeg sempre imprime o JSON; a falta dele é falha. `-inf` (áudio mudo) não é.
    let [Some(input_i), Some(input_tp), Some(input_lra), Some(input_thresh), Some(target_offset)] =
        report.measured
    else {
        return Err(failed());
    };
    let finite = [input_i, input_tp, input_lra, input_thresh, target_offset]
        .iter()
        .all(|v| v.is_finite());
    Ok(finite.then_some(pipeline::Measured {
        input_i,
        input_tp,
        input_lra,
        input_thresh,
        target_offset,
    }))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn progress_normalizer_stays_monotonic_when_ffmpeg_reports_regress_within_a_pass() {
        let mut norm = ProgressNormalizer::new();
        let mut emitted = Vec::new();
        let duration_us = 5_000_000;

        // Passagem 1 (loudnorm measure): termina rápido em 5s -> 10%.
        for line in ["out_time_us=N/A", "out_time_us=5000000", "progress=end"] {
            if let Some(p) = norm.push_line(line, duration_us, (0, MEASURE_END)) {
                emitted.push(p);
            }
        }
        // Passagem 2 (FFmpeg 9 com loudnorm/x264): out_time_us recua de 4.7s -> 2.2s -> 1.3s.
        for line in [
            "out_time_us=N/A",
            "out_time_us=3750000", // 73%
            "out_time_us=4750000", // 90%
            "out_time_us=2200000", // 47% (recuo ignorado)
            "out_time_us=1300000", // 32% (recuo ignorado)
            "out_time_us=5000000", // 95%
            "progress=end",
        ] {
            if let Some(p) = norm.push_line(line, duration_us, (MEASURE_END, RENDER_END)) {
                emitted.push(p);
            }
        }
        if let Some(p) = norm.finish() {
            emitted.push(p);
        }

        assert_eq!(emitted, vec![10, 73, 90, 95, 100]);
        assert!(emitted.windows(2).all(|w| w[0] < w[1]));
    }

    #[test]
    fn progress_normalizer_handles_spliced_duration_muted_audio_and_overshoot() {
        let mut norm = ProgressNormalizer::new();
        let mut emitted = Vec::new();
        let spliced_duration_us = 6_000_000;

        for line in [
            "out_time_us=-23220",
            "out_time_us=3000000",
            "out_time_us=6500000",
        ] {
            if let Some(p) = norm.push_line(line, spliced_duration_us, (0, MEASURE_END)) {
                emitted.push(p);
            }
        }
        // Mesmo após áudio mudo (measured = None), a 2ª passagem começa após MEASURE_END.
        for line in [
            "out_time_us=0",
            "out_time_us=3000000",
            "out_time_us=1500000",
            "out_time_us=6200000",
        ] {
            if let Some(p) = norm.push_line(line, spliced_duration_us, (MEASURE_END, RENDER_END)) {
                emitted.push(p);
            }
        }
        if let Some(p) = norm.finish() {
            emitted.push(p);
        }

        assert_eq!(emitted, vec![1, 5, 10, 52, 95, 100]);
        assert!(emitted.windows(2).all(|w| w[0] < w[1]));
    }
}
