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

#[allow(clippy::too_many_arguments)]
fn execute(
    program: &Path,
    args: &[OsString],
    cwd: Option<&Path>,
    cancel: &CancelToken,
    duration_us: i64,
    font_file: Option<&'static str>,
    range: (u64, u64),
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
            if let Some(value) = line
                .strip_prefix("out_time_us=")
                .and_then(|s| s.parse::<i64>().ok())
            {
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
            let (low, high) = range;
            let part = (value.max(0) as u64).saturating_mul(high - low) / duration_us.max(1) as u64;
            progress((low + part).clamp(low.max(1), high.max(1)) as u8);
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
    let report = execute(
        ffmpeg,
        &["-hide_banner".into(), "-h".into(), "filter=ass".into()],
        None,
        cancel,
        1,
        None,
        (0, 0),
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
    if output.exists() {
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
    render_ass_spliced(ffmpeg, input, segments, &doc, encoder, cancel, progress)
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
    prepared.style.validate()?;
    let doc = AssDoc {
        ass: &prepared.ass,
        font_file: prepared.style.font_file(),
        font_bytes: prepared.style.font_bytes(),
    };
    render_ass_spliced(ffmpeg, input, segments, &doc, encoder, cancel, progress)
}

struct AssDoc<'a> {
    ass: &'a str,
    font_file: &'static str,
    font_bytes: &'a [u8],
}

fn render_ass_spliced(
    ffmpeg: &Path,
    input: &RenderInput,
    segments: &[KeptSegment],
    doc: &AssDoc<'_>,
    encoder: &str,
    cancel: &CancelToken,
    progress: &mut dyn FnMut(u8),
) -> Result<(), CoreError> {
    validate_output(&input.output)?;
    if input.start_us < 0 || input.end_us <= input.start_us || input.audio_track < 0 {
        return Err(error("export_bounds", "As bordas do Corte são inválidas."));
    }
    check_ass(ffmpeg, cancel)?;
    let duration = input.end_us - input.start_us;
    let spliced = segments.len() > 1;
    let output_duration = if spliced {
        segments.last().map_or(duration, |s| s.output_end_us)
    } else {
        duration
    };
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
    let measured = measure_loudness(
        ffmpeg,
        &source,
        input,
        segments,
        output_duration,
        work.path(),
        cancel,
        progress,
    )?;
    let plan = pipeline::with_loudness(encoder, measured);
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
        (if measured.is_some() { MEASURE_END } else { 0 }, RENDER_END),
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
    progress(100);
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
