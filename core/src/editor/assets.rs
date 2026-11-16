//! Miniaturas e onda da timeline do editor (#61), geradas **a partir do proxy do #58** (nunca da
//! Fonte inteira) por uma tarefa local e cancelável da fila. Os arquivos moram na pasta do proxy
//! (`thumbs.jpg` e `wave.bin`), então a limpeza LRU do proxy os conta e os remove juntos.
//!
//! A onda reusa o `BlockMeter` da energia do áudio (#54): blocos de 100 ms extraídos do áudio do
//! proxy, convertidos para um byte por bloco (0–255 entre o piso e 0 dBFS).
use crate::{
    energy::{BlockMeter, BLOCK_US, SAMPLE_RATE},
    jobs, projects, proxy, CommandRegistration, CommandResult, CoreError, EventSink,
};
use serde_json::{json, Value};
use std::{
    ffi::OsString,
    fs,
    path::{Path, PathBuf},
    sync::atomic::AtomicBool,
};

pub const JOB_KIND: &str = "timeline";
pub const THUMBS_FILE: &str = "thumbs.jpg";
pub const WAVE_FILE: &str = "wave.bin";
/// Uma miniatura a cada 2 s do proxy.
pub const THUMB_INTERVAL_US: i64 = 2_000_000;
pub const THUMB_WIDTH: u32 = 96;
pub const THUMB_HEIGHT: u32 = 54;
pub const THUMB_COLUMNS: u32 = 20;
/// Piso da onda em centésimos de dBFS: abaixo disso o byte é 0.
const WAVE_FLOOR_CENTI: f64 = -6_000.0;

inventory::submit! { projects::Migration { id: "0061_001_timeline_jobs", sql: "CREATE TABLE timeline_jobs (job_id INTEGER PRIMARY KEY, source_id INTEGER NOT NULL, key TEXT NOT NULL, start_us INTEGER NOT NULL, end_us INTEGER NOT NULL, error TEXT); CREATE INDEX timeline_jobs_by_key ON timeline_jobs(key);" } }

fn error(code: &str, message: &str) -> CoreError {
    CoreError {
        code: code.into(),
        message: message.into(),
        usage: None,
    }
}
fn failed() -> CoreError {
    error(
        "timeline_failed",
        "Não foi possível gerar a timeline do Corte.",
    )
}
fn invalid_key() -> CoreError {
    error("invalid_key", "Chave de preview inválida.")
}

fn key_of(v: &Value) -> Result<String, CoreError> {
    v["key"]
        .as_str()
        .filter(|k| k.len() == 64 && k.bytes().all(|b| matches!(b, b'0'..=b'9' | b'a'..=b'f')))
        .map(str::to_owned)
        .ok_or_else(invalid_key)
}

fn folder(cache: &Path, key: &str) -> PathBuf {
    proxy::proxies_root(cache).join(key)
}

fn thumb_count(window_us: i64) -> u32 {
    (window_us.max(1) as u64)
        .div_ceil(THUMB_INTERVAL_US as u64)
        .max(1) as u32
}

/// Byte da onda para a energia média (amostra²) de um bloco.
pub(crate) fn wave_byte(mean_square: f64) -> u8 {
    if !(mean_square.is_finite() && mean_square > 0.0) {
        return 0;
    }
    let centi = 1000.0 * (mean_square / (32768.0_f64 * 32768.0)).log10();
    (((centi - WAVE_FLOOR_CENTI) / -WAVE_FLOOR_CENTI).clamp(0.0, 1.0) * 255.0).round() as u8
}

fn ready(cache: &Path, key: &str) -> bool {
    let dir = folder(cache, key);
    dir.join(proxy::FILE_NAME).is_file()
        && dir.join(THUMBS_FILE).is_file()
        && dir.join(WAVE_FILE).is_file()
}

fn status_json(cache: &Path, key: &str, window_us: i64) -> Result<Value, CoreError> {
    if ready(cache, key) {
        let dir = folder(cache, key);
        for name in [proxy::FILE_NAME, THUMBS_FILE, WAVE_FILE] {
            crate::media::touch(&dir.join(name));
        }
        return Ok(json!({
            "state": "ready", "key": key, "job": null, "progress": 100, "error": null,
            "thumbs": {"id": format!("thumbs/{key}"), "count": thumb_count(window_us), "intervalUs": THUMB_INTERVAL_US, "width": THUMB_WIDTH, "height": THUMB_HEIGHT, "columns": THUMB_COLUMNS},
        }));
    }
    use rusqlite::OptionalExtension;
    let row = projects::with_reader(|c| {
        c.query_row(
            "SELECT j.id, j.state, j.progress, t.error FROM timeline_jobs t JOIN jobs j ON j.id=t.job_id WHERE t.key=?1 ORDER BY j.id DESC LIMIT 1",
            [key],
            |r| Ok((r.get::<_, i64>(0)?, r.get::<_, String>(1)?, r.get::<_, i64>(2)?, r.get::<_, Option<String>>(3)?)),
        )
        .optional()
    })?;
    Ok(match row {
        None => {
            json!({"state":"missing","key":key,"job":null,"progress":0,"error":null,"thumbs":null})
        }
        Some((job, state, progress, err)) => {
            let state = match state.as_str() {
                "queued" => "queued",
                "running" => "running",
                "cancelled" => "cancelled",
                "completed" => "missing",
                _ => "failed",
            };
            json!({"state":state,"key":key,"job":job,"progress":progress,"error":err,"thumbs":null})
        }
    })
}

/// `editor.timeline {source_id, start_us, end_us}`: estado das miniaturas e da onda do Corte. Só
/// existem a partir de um proxy pronto; sem ele, `proxy_not_ready`. Enfileira a tarefa se faltar.
fn request(v: Value, _: &mut EventSink<'_>) -> CommandResult {
    let source = v["source_id"]
        .as_i64()
        .ok_or_else(|| error("invalid_source", "Fonte inválida."))?;
    let range = |k: &str| {
        v[k].as_i64()
            .ok_or_else(|| error("invalid_range", "Intervalo do Corte inválido."))
    };
    let (start, end) = (range("start_us")?, range("end_us")?);
    let current = crate::dispatch("projects.current", json!({}), &mut |_| {})?;
    let project = PathBuf::from(
        current["path"]
            .as_str()
            .ok_or_else(|| error("invalid_project", "Nenhum Projeto aberto."))?,
    );
    let (_, hash, audio, duration) = proxy::checked_source(source, &project)?;
    let (win_start, win_end) = proxy::window(start, end, duration)?;
    let key = proxy::cache_key(&hash, audio, win_start, win_end);
    let (cache, _, _) = crate::components::cache_settings()?;
    if proxy::ready_file(&cache, &key).is_none() {
        return Err(error(
            "proxy_not_ready",
            "O preview do Corte ainda não está pronto.",
        ));
    }
    let window = win_end - win_start;
    let mut status = status_json(&cache, &key, window)?;
    if matches!(
        status["state"].as_str(),
        Some("missing" | "failed" | "cancelled")
    ) {
        let job = projects::with_writer(|c| {
            let tx = c.transaction()?;
            tx.execute(
                "INSERT INTO jobs(kind,safety,state,source_id) VALUES ('timeline','local','queued',?1)",
                [source],
            )?;
            let id = tx.last_insert_rowid();
            tx.execute(
                "INSERT INTO timeline_jobs(job_id,source_id,key,start_us,end_us) VALUES (?1,?2,?3,?4,?5)",
                (id, source, &key, win_start, win_end),
            )?;
            tx.commit()?;
            Ok(id)
        })?;
        status =
            json!({"state":"queued","key":key,"job":job,"progress":0,"error":null,"thumbs":null});
    }
    status["windowStartUs"] = json!(win_start);
    status["windowEndUs"] = json!(win_end);
    Ok(status)
}

/// `editor.timeline_status {key, window_us?}`: estado e progresso; nunca devolve caminho.
fn status(v: Value, _: &mut EventSink<'_>) -> CommandResult {
    let key = key_of(&v)?;
    let (cache, _, _) = crate::components::cache_settings()?;
    status_json(&cache, &key, v["window_us"].as_i64().unwrap_or(0))
}

/// `editor.wave {key}`: um byte (0–255) por bloco de 100 ms do proxy.
fn wave(v: Value, _: &mut EventSink<'_>) -> CommandResult {
    let key = key_of(&v)?;
    let (cache, _, _) = crate::components::cache_settings()?;
    let bytes = fs::read(folder(&cache, &key).join(WAVE_FILE))
        .map_err(|_| error("timeline_missing", "A timeline do Corte não está pronta."))?;
    Ok(json!({"blockUs": BLOCK_US, "values": bytes}))
}

inventory::submit! { CommandRegistration { name: "editor.timeline", execute: request } }
inventory::submit! { CommandRegistration { name: "editor.timeline_status", execute: status } }
inventory::submit! { CommandRegistration { name: "editor.wave", execute: wave } }

fn args(items: &[&str], input: &Path, tail: &[&str], output: Option<&Path>) -> Vec<OsString> {
    let mut out: Vec<OsString> = items.iter().map(OsString::from).collect();
    out.push("-i".into());
    out.push(input.as_os_str().to_owned());
    out.extend(tail.iter().map(OsString::from));
    if let Some(path) = output {
        out.push(path.as_os_str().to_owned());
    }
    out
}

/// FFmpeg do sprite: uma miniatura por 2 s, encaixada em `THUMB_WIDTH`×`THUMB_HEIGHT`, em grade.
pub(crate) fn thumbs_args(proxy_file: &Path, window_us: i64, output: &Path) -> Vec<OsString> {
    let count = thumb_count(window_us);
    let rows = count.div_ceil(THUMB_COLUMNS);
    let filter = format!(
        "fps=1/{},scale={THUMB_WIDTH}:{THUMB_HEIGHT}:force_original_aspect_ratio=decrease,pad={THUMB_WIDTH}:{THUMB_HEIGHT}:(ow-iw)/2:(oh-ih)/2,tile={THUMB_COLUMNS}x{rows}",
        THUMB_INTERVAL_US / 1_000_000
    );
    args(
        &["-v", "error", "-nostdin"],
        proxy_file,
        &[
            "-an",
            "-vf",
            &filter,
            "-frames:v",
            "1",
            "-q:v",
            "6",
            "-f",
            "image2",
            "-y",
        ],
        Some(output),
    )
}

/// FFmpeg do PCM mono 16 kHz `s16le` do áudio do proxy, no formato que o `BlockMeter` lê.
pub(crate) fn wave_args(proxy_file: &Path) -> Vec<OsString> {
    let rate = SAMPLE_RATE.to_string();
    args(
        &["-v", "error", "-nostdin"],
        proxy_file,
        &[
            "-map", "0:a:0", "-vn", "-ac", "1", "-ar", &rate, "-f", "s16le", "-",
        ],
        None,
    )
}

/// Executa a tarefa `timeline` da fila. O erro (fixo) fica em `timeline_jobs.error`.
pub(crate) fn run(
    id: i64,
    source_id: i64,
    project: &Path,
    stop: &AtomicBool,
) -> Result<(), CoreError> {
    let result = generate(id, source_id, project, stop);
    if let Err(e) = &result {
        if e.code != "interrupted" {
            let code = e.code.clone();
            let _ = projects::with_writer(|c| {
                c.execute(
                    "UPDATE timeline_jobs SET error=?2 WHERE job_id=?1",
                    (id, code),
                )?;
                Ok(())
            });
        }
    }
    result
}

fn generate(id: i64, source_id: i64, project: &Path, stop: &AtomicBool) -> Result<(), CoreError> {
    jobs::preview::check(id, stop)?;
    let (key, start, end): (String, i64, i64) = projects::with_reader(|c| {
        c.query_row(
            "SELECT key,start_us,end_us FROM timeline_jobs WHERE job_id=?1",
            [id],
            |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?)),
        )
    })?;
    // A Fonte pode ter mudado desde o pedido: a chave do proxy tem de continuar valendo.
    let (_, hash, audio, duration) = proxy::checked_source(source_id, project)?;
    if end > duration || proxy::cache_key(&hash, audio, start, end) != key {
        return Err(error(
            "source_changed",
            "A Fonte foi alterada: verifique a identidade dela antes do preview.",
        ));
    }
    let (cache, _, ffmpeg) = crate::components::cache_settings()?;
    let ffmpeg =
        ffmpeg.ok_or_else(|| error("component_missing", "Instale o Componente FFmpeg."))?;
    let proxy_file = proxy::ready_file(&cache, &key).ok_or_else(|| {
        error(
            "proxy_not_ready",
            "O preview do Corte ainda não está pronto.",
        )
    })?;
    let dir = folder(&cache, &key);
    let work = |name: &str| dir.join(format!("{name}.part"));
    let cleanup = || {
        for name in [THUMBS_FILE, WAVE_FILE] {
            let _ = fs::remove_file(work(name));
        }
    };

    jobs::progress(id, "timeline", 2, "Gerando a timeline do Corte")?;
    // Onda: o áudio do proxy passa pelo BlockMeter do #54, sem tocar na Fonte.
    let mut meter = BlockMeter::default();
    let outcome =
        jobs::preview::run_process_as(&ffmpeg, wave_args(&proxy_file), id, stop, failed, |bytes| {
            meter.push(bytes)
        });
    if let Err(e) = outcome {
        cleanup();
        return Err(e);
    }
    let blocks: Vec<u8> = meter.finish().into_iter().map(wave_byte).collect();
    jobs::progress(id, "timeline", 40, "Gerando a timeline do Corte")?;
    if let Err(e) = fs::write(work(WAVE_FILE), &blocks).map_err(|_| failed()) {
        cleanup();
        return Err(e);
    }

    // Miniaturas: um sprite em grade lido do proxy.
    let outcome = jobs::preview::run_process_as(
        &ffmpeg,
        thumbs_args(&proxy_file, end - start, &work(THUMBS_FILE)),
        id,
        stop,
        failed,
        |_| {},
    );
    let produced = fs::metadata(work(THUMBS_FILE))
        .map(|m| m.len())
        .unwrap_or(0)
        > 0;
    if let Err(e) = outcome {
        cleanup();
        return Err(e);
    }
    if !produced {
        cleanup();
        return Err(failed());
    }
    // Publica por renomeação: o estado "pronto" exige os dois arquivos finais.
    for name in [THUMBS_FILE, WAVE_FILE] {
        if fs::rename(work(name), dir.join(name)).is_err() {
            cleanup();
            return Err(failed());
        }
    }
    let (_, user_limit, _) = crate::components::cache_settings()?;
    proxy::evict_after_timeline(&proxy::proxies_root(&cache), user_limit, &key);
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn wave_byte_spans_the_floor_to_full_scale() {
        assert_eq!(wave_byte(0.0), 0);
        assert_eq!(wave_byte(f64::NAN), 0);
        assert_eq!(wave_byte(32768.0 * 32768.0), 255);
        assert!(wave_byte(1.0) < 10);
        assert!(wave_byte(1e6) > wave_byte(1e3));
    }

    #[test]
    fn thumbnail_grid_covers_the_window() {
        assert_eq!(thumb_count(300_000_000), 150);
        assert_eq!(thumb_count(1), 1);
        let line: Vec<String> = thumbs_args(Path::new("p.mp4"), 300_000_000, Path::new("t.jpg"))
            .iter()
            .map(|a| a.to_string_lossy().into_owned())
            .collect();
        let line = line.join(" ");
        assert!(line.contains("fps=1/2"), "{line}");
        assert!(line.contains("tile=20x8"), "{line}");
        assert!(line.contains("-i p.mp4"), "{line}");
    }
}
