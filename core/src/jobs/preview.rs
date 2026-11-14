use super::*;
use rusqlite::OptionalExtension;
use std::{
    fs,
    io::{Read, Write},
    path::{Path, PathBuf},
    sync::{
        atomic::{AtomicBool, Ordering},
        mpsc, Arc,
    },
    time::{Duration, SystemTime},
};

fn error(code: &str, message: &str) -> crate::CoreError {
    crate::CoreError {
        code: code.into(),
        message: message.into(),
    }
}
fn failed() -> crate::CoreError {
    error(
        "preview_failed",
        "Não foi possível gerar as prévias da Fonte.",
    )
}
fn interrupted() -> crate::CoreError {
    error("interrupted", "A tarefa foi interrompida.")
}
fn cancelled() -> crate::CoreError {
    error("cancelled", "Tarefa cancelada.")
}
fn is_cancelled(id: i64) -> bool {
    projects::with_reader(|c| {
        c.query_row("SELECT cancel_requested FROM jobs WHERE id=?1", [id], |r| {
            r.get::<_, bool>(0)
        })
    })
    .unwrap_or(true)
}
fn check(id: i64, stop: &AtomicBool) -> Result<(), crate::CoreError> {
    if stop.load(Ordering::SeqCst) {
        Err(interrupted())
    } else if is_cancelled(id) {
        Err(cancelled())
    } else {
        Ok(())
    }
}

pub(super) fn run_queue(project: PathBuf, stop: Arc<AtomicBool>) {
    while !stop.load(Ordering::SeqCst) {
        let next = projects::with_reader(|c| c.query_row("SELECT id,source_id FROM jobs WHERE kind='preview' AND safety='local' AND state='queued' ORDER BY id LIMIT 1", [], |r| Ok((r.get::<_,i64>(0)?,r.get::<_,i64>(1)?))).optional()).ok().flatten();
        if let Some((id, source)) = next {
            let Ok(_guard) = projects::start_job() else {
                break;
            };
            if stop.load(Ordering::SeqCst) {
                break;
            }
            if begin(id).unwrap_or(false) {
                let result = generate(id, source, &project, &stop);
                if result.as_ref().is_err_and(|e| e.code == "interrupted") {
                    let _ = projects::with_writer(|c| {
                        c.execute(
                            "UPDATE jobs SET state='queued' WHERE id=?1 AND state='running'",
                            [id],
                        )?;
                        Ok(())
                    });
                } else {
                    let err = result.as_ref().err().cloned();
                    let _ = finish(id, result);
                    let _ = progress_event(id, err);
                }
            }
        } else {
            std::thread::sleep(Duration::from_millis(100));
        }
    }
}
fn progress_event(id: i64, err: Option<crate::CoreError>) -> Result<(), crate::CoreError> {
    let project = projects::with_reader(|c| {
        c.query_row("SELECT id FROM queue_project_identity", [], |r| {
            r.get::<_, String>(0)
        })
    })?;
    crate::emit_background(crate::ProgressEvent {
        job: id.to_string(),
        project: Some(project),
        stage: if err.is_some() { "failed" } else { "complete" }.into(),
        percentage: if err.is_some() { 0 } else { 100 },
        message: if err.is_some() {
            "Prévia interrompida"
        } else {
            "Prévia pronta"
        }
        .into(),
        error: err,
    });
    Ok(())
}
fn source(id: i64, project: &Path) -> Result<(PathBuf, String, i64, i64), crate::CoreError> {
    let (stored, hash, audio, size, duration): (String, String, i64, i64, i64) =
        projects::with_reader(|c| {
            c.query_row(
                "SELECT path,partial_hash,audio_track,size,duration_us FROM sources WHERE id=?1",
                [id],
                |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?, r.get(3)?, r.get(4)?)),
            )
        })?;
    let stored = PathBuf::from(stored);
    let path = if stored.is_absolute() {
        stored
    } else {
        project.join(stored)
    };
    if crate::sources::partial(&path).ok() != Some((size as u64, hash.clone())) {
        return Err(error(
            "source_changed",
            "A Fonte está indisponível ou foi alterada.",
        ));
    }
    Ok((path, hash, audio, duration))
}
fn key(hash: &str, audio: i64) -> String {
    format!("{hash}-{audio}")
}

fn generate(
    id: i64,
    source_id: i64,
    project: &Path,
    stop: &AtomicBool,
) -> Result<(), crate::CoreError> {
    check(id, stop)?;
    let (source, hash, audio, duration) = source(source_id, project)?;
    let (cache, limit, ffmpeg) = crate::components::cache_settings()?;
    let ffmpeg =
        ffmpeg.ok_or_else(|| error("component_missing", "Instale o Componente FFmpeg."))?;
    let root = cache.join("previews");
    fs::create_dir_all(&root).map_err(|_| failed())?;
    let name = key(&hash, audio);
    let output = root.join(&name);
    if output.join("waveform.bin").is_file()
        && fs::read_dir(&output)
            .map(|mut d| {
                d.any(|e| {
                    e.ok()
                        .is_some_and(|e| e.path().extension().is_some_and(|s| s == "jpg"))
                })
            })
            .unwrap_or(false)
    {
        return Ok(());
    }
    let stage = root.join(format!(".{name}.part"));
    fs::create_dir_all(&stage).map_err(|_| failed())?;
    progress(id, "waveform", 1, "Gerando onda de áudio")?;
    let waveform = stage.join("waveform.bin");
    if !waveform.is_file() {
        let args = vec![
            "-v".into(),
            "error".into(),
            "-i".into(),
            source.as_os_str().to_owned(),
            "-map".into(),
            format!("0:{audio}").into(),
            "-ac".into(),
            "1".into(),
            "-ar".into(),
            "8000".into(),
            "-f".into(),
            "s16le".into(),
            "pipe:1".into(),
        ];
        let mut peaks = Vec::new();
        let mut lo = i16::MAX;
        let mut hi = i16::MIN;
        let mut count = 0usize;
        let mut pending = None;
        let mut processed = 0u64;
        let mut last = 1u8;
        run_process(&ffmpeg, args, id, stop, |bytes| {
            processed += bytes.len() as u64;
            let percentage = ((processed.saturating_mul(1_000_000).saturating_mul(49)
                / 16_000
                / (duration.max(1) as u64))
                .min(49)) as u8;
            if percentage > last {
                let _ = progress(id, "waveform", percentage, "Gerando onda de áudio");
                last = percentage;
            }
            for &b in bytes {
                if let Some(first) = pending.take() {
                    let sample = i16::from_le_bytes([first, b]);
                    lo = lo.min(sample);
                    hi = hi.max(sample);
                    count += 1;
                    if count == 80 {
                        peaks.push((lo, hi));
                        lo = i16::MAX;
                        hi = i16::MIN;
                        count = 0;
                    }
                } else {
                    pending = Some(b);
                }
            }
        })?;
        if count > 0 {
            peaks.push((lo, hi));
        }
        let temp = stage.join("waveform.tmp");
        write_waveform(&temp, peaks)?;
        fs::rename(temp, &waveform).map_err(|_| failed())?;
    }
    checkpoint(id, "waveform")?;
    check(id, stop)?;
    progress(id, "thumbnails", 50, "Gerando miniaturas")?;
    let target = stage.join("thumb-%08d.jpg");
    let args = vec![
        "-v".into(),
        "error".into(),
        "-i".into(),
        source.as_os_str().to_owned(),
        "-vf".into(),
        "fps=1/10:round=up,scale=-2:90".into(),
        "-pix_fmt".into(),
        "yuvj420p".into(),
        "-q:v".into(),
        "8".into(),
        "-y".into(),
        target.as_os_str().to_owned(),
    ];
    run_process(&ffmpeg, args, id, stop, |_| {})?;
    check(id, stop)?;
    if output.exists() {
        fs::remove_dir_all(&output).map_err(|_| failed())?;
    }
    fs::rename(&stage, &output).map_err(|_| failed())?;
    clean_cache(&cache, limit, project)?;
    Ok(())
}

fn run_process(
    ffmpeg: &Path,
    args: Vec<std::ffi::OsString>,
    id: i64,
    stop: &AtomicBool,
    mut consume: impl FnMut(&[u8]),
) -> Result<(), crate::CoreError> {
    let (mut child, group) = crate::process::spawn_managed(ffmpeg, args).map_err(|_| failed())?;
    let mut stdout = child.stdout.take().ok_or_else(failed)?;
    let mut stderr = child.stderr.take().ok_or_else(failed)?;
    let (tx, rx) = mpsc::sync_channel::<Vec<u8>>(8);
    let reader = std::thread::spawn(move || {
        let mut buf = [0u8; 8192];
        loop {
            match stdout.read(&mut buf) {
                Ok(0) | Err(_) => break,
                Ok(n) => {
                    if tx.send(buf[..n].to_vec()).is_err() {
                        break;
                    }
                }
            }
        }
    });
    let errors = std::thread::spawn(move || {
        let _ = std::io::copy(&mut stderr, &mut std::io::sink());
    });
    let result = loop {
        if let Err(e) = check(id, stop) {
            group.terminate();
            let _ = child.wait();
            break Err(e);
        }
        match rx.recv_timeout(Duration::from_millis(50)) {
            Ok(bytes) => consume(&bytes),
            Err(mpsc::RecvTimeoutError::Disconnected) => {
                let status = child.wait().map_err(|_| failed())?;
                break if status.success() {
                    Ok(())
                } else {
                    Err(failed())
                };
            }
            Err(mpsc::RecvTimeoutError::Timeout) => {}
        }
    };
    drop(rx);
    let _ = reader.join();
    let _ = errors.join();
    result
}

fn write_waveform(path: &Path, first: Vec<(i16, i16)>) -> Result<(), crate::CoreError> {
    let target = first.len().div_ceil(100).max(1);
    let mut levels = vec![first];
    while levels.last().unwrap().len() > target {
        let prev = levels.last().unwrap();
        let next = prev
            .chunks(4)
            .map(|chunk| {
                (
                    chunk.iter().map(|x| x.0).min().unwrap(),
                    chunk.iter().map(|x| x.1).max().unwrap(),
                )
            })
            .collect();
        levels.push(next);
    }
    let mut out = fs::File::create(path).map_err(|_| failed())?;
    out.write_all(b"CLPWAVE\0").map_err(|_| failed())?;
    for value in [1u32, 100, 1, levels.len() as u32] {
        out.write_all(&value.to_le_bytes()).map_err(|_| failed())?;
    }
    let mut offset = 24u64 + levels.len() as u64 * 16;
    for level in &levels {
        out.write_all(&offset.to_le_bytes()).map_err(|_| failed())?;
        out.write_all(&(level.len() as u64).to_le_bytes())
            .map_err(|_| failed())?;
        offset += level.len() as u64 * 4;
    }
    for level in levels {
        for (lo, hi) in level {
            out.write_all(&lo.to_le_bytes())
                .and_then(|_| out.write_all(&hi.to_le_bytes()))
                .map_err(|_| failed())?;
        }
    }
    out.flush().map_err(|_| failed())
}

fn clean_cache(cache: &Path, limit: u64, _project: &Path) -> Result<(), crate::CoreError> {
    let root = cache.join("previews");
    let protected: Vec<String> = projects::with_reader(|c| {
        let mut q = c.prepare("SELECT partial_hash,audio_track FROM sources")?;
        let rows = q.query_map([], |r| Ok(key(&r.get::<_, String>(0)?, r.get(1)?)))?;
        rows.collect()
    })?;
    let mut entries = Vec::new();
    for entry in fs::read_dir(&root).map_err(|_| failed())? {
        let entry = entry.map_err(|_| failed())?;
        if !entry.file_type().map_err(|_| failed())?.is_dir() {
            continue;
        }
        let filename = entry.file_name().to_string_lossy().into_owned();
        let name = filename
            .strip_prefix('.')
            .and_then(|s| s.strip_suffix(".part"))
            .unwrap_or(&filename)
            .to_owned();
        let mut size = 0u64;
        let mut last = SystemTime::UNIX_EPOCH;
        for f in fs::read_dir(entry.path()).map_err(|_| failed())? {
            let m = f.map_err(|_| failed())?.metadata().map_err(|_| failed())?;
            size = size.saturating_add(m.len());
            last = last.max(m.modified().unwrap_or(SystemTime::UNIX_EPOCH));
        }
        entries.push((last, entry.path(), name, size));
    }
    let mut total = entries.iter().map(|e| e.3).sum::<u64>();
    entries.sort_by_key(|e| e.0);
    for (_, path, name, size) in entries {
        if total <= limit {
            break;
        }
        if !protected.contains(&name) {
            fs::remove_dir_all(path).map_err(|_| failed())?;
            total = total.saturating_sub(size);
        }
    }
    Ok(())
}

fn preview(v: Value, _: &mut EventSink<'_>) -> CommandResult {
    let id = v["source_id"].as_i64().ok_or_else(failed)?;
    let current = crate::dispatch("projects.current", json!({}), &mut |_| {})?;
    let project = current["path"].as_str().ok_or_else(failed)?;
    let (_, hash, audio, _) = source(id, Path::new(project))?;
    let (cache, _, _) = crate::components::cache_settings()?;
    let dir = cache.join("previews").join(key(&hash, audio));
    let waveform = dir.join("waveform.bin");
    if !waveform.is_file() {
        return Err(error("preview_unavailable", "Prévia indisponível."));
    }
    let mut thumbs = fs::read_dir(dir)
        .map_err(|_| failed())?
        .filter_map(Result::ok)
        .map(|e| e.path())
        .filter(|p| p.extension().is_some_and(|x| x == "jpg"))
        .collect::<Vec<_>>();
    thumbs.sort();
    for path in std::iter::once(&waveform).chain(thumbs.iter()) {
        if let Ok(f) = fs::OpenOptions::new().write(true).open(path) {
            let _ = f.set_times(fs::FileTimes::new().set_modified(SystemTime::now()));
        }
    }
    Ok(json!({"waveform":waveform,"thumbnails":thumbs}))
}
inventory::submit! { CommandRegistration { name:"jobs.preview", execute:preview } }
