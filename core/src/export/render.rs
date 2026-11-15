//! Processo gerenciado, sem shell, sem caminhos no log e publicação sem sobrescrita.
use super::{
    captions::{self, CaptionWord},
    error, failed, pipeline,
};
use crate::{provider::CancelToken, CoreError};
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
    help: String,
    font_selected: bool,
    font_fallback: bool,
    font_loaded: bool,
}

fn cancelled() -> CoreError {
    error("cancelled", "Export cancelado.")
}

fn execute(
    program: &Path,
    args: &[OsString],
    cwd: Option<&Path>,
    cancel: &CancelToken,
    duration_us: i64,
    probe: bool,
    progress: &mut dyn FnMut(u8),
) -> Result<Report, CoreError> {
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
        for line in BufReader::new(stderr).lines().map_while(Result::ok) {
            loaded |= line.contains("Loading font file") && line.contains("NotoSans-Bold.ttf");
            if line.contains("fontselect:") && line.contains(" -> ") {
                if line
                    .split(" -> ")
                    .nth(1)
                    .is_some_and(|s| s.contains("NotoSans-Bold"))
                {
                    selected = true;
                } else {
                    fallback = true;
                }
            }
        }
        (selected, fallback, loaded)
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
            progress((value.saturating_mul(95) / duration_us.max(1)).clamp(1, 95) as u8);
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
    let (font_selected, font_fallback, font_loaded) = errors.join().map_err(|_| failed())?;
    status?;
    Ok(Report {
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
        true,
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
    validate_output(&input.output)?;
    if input.start_us < 0 || input.end_us <= input.start_us || input.audio_track < 0 {
        return Err(error("export_bounds", "As bordas do Corte são inválidas."));
    }
    check_ass(ffmpeg, cancel)?;
    let duration = input.end_us - input.start_us;
    let ass = captions::ass(&input.words, duration)?;
    let parent = input.output.parent().unwrap();
    let work = tempfile::Builder::new()
        .prefix(".clipes-export-")
        .tempdir_in(parent)
        .map_err(|_| failed())?;
    let fonts = work.path().join("fonts");
    fs::create_dir(&fonts).map_err(|_| failed())?;
    fs::write(fonts.join("NotoSans-Bold.ttf"), FONT_BYTES).map_err(|_| failed())?;
    fs::write(work.path().join("captions.ass"), ass).map_err(|_| failed())?;
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
    let plan = pipeline::standard();
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
        "-map".into(),
        "0:v:0".into(),
        "-map".into(),
        format!("0:{}", input.audio_track).into(),
        "-vf".into(),
        plan.video_filters.join(",").into(),
        "-af".into(),
        plan.audio_filters.join(",").into(),
        "-c:v".into(),
        plan.encoder.into(),
        "-threads".into(),
        "2".into(),
    ];
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
        duration,
        false,
        progress,
    )?;
    if cancel.is_cancelled() {
        return Err(cancelled());
    }
    if !captions::layout(&input.words).is_empty() && (!report.font_selected || report.font_fallback || !report.font_loaded)
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
