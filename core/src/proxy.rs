//! Proxy de preview do Corte (#58): um H.264 de GOP curto só para a janela do Corte ±2 min,
//! gerado pelo FFmpeg numa tarefa local da fila e guardado num cache **fora do Projeto**, com
//! limpeza LRU por tamanho total. O arquivo é servido pelo protocolo de mídia (`media.rs`).
//!
//! Inspirado no protótipo do #15 (~33 ms contra ~277 ms na Fonte direta). Este ticket usa
//! altura máxima 540, quadro-chave a cada 0,5 s, sem quadros B, ~2,5 Mb/s e AAC 128 kb/s;
//! sua medição fica em docs/research/2026-11-15-busca-no-proxy.md. Não há detecção de encoder
//! de vídeo no núcleo (a de `hardware.rs` é só da
//! Transcrição), então o encoder é sempre x264 (ADR-0003: o FFmpeg baixado é a build GPL).
use crate::{jobs, projects, CommandRegistration, CommandResult, CoreError, EventSink};
use serde_json::{json, Value};
use sha2::{Digest, Sha256};
use std::{
    fs,
    path::{Path, PathBuf},
    sync::atomic::AtomicBool,
    time::{Duration, SystemTime},
};

/// Margem antes e depois do Corte (limitada à Fonte): 2 min.
pub const MARGIN_US: i64 = 120_000_000;
/// Maior Corte aceito (sem a margem): guarda contra pedir a Fonte inteira. A seleção (#53)
/// limita os Cortes a 3 min; 10 min deixa folga para o editor.
pub const MAX_CLIP_US: i64 = 600_000_000;
/// Altura máxima do proxy; nunca amplia uma Fonte menor.
pub const HEIGHT: u32 = 540;
/// Intervalo entre quadros-chave (GOP curto). `force_key_frames` vale por tempo, não por
/// quadros, então não depende da taxa da Fonte.
pub const KEYFRAME_SECONDS: &str = "0.5";
/// Taxa do vídeo e do áudio do proxy.
pub const VIDEO_KBPS: u32 = 2500;
pub const AUDIO_KBPS: u32 = 128;
/// Tamanho máximo do cache de proxies (LRU). O limite do usuário (`cache_limit_bytes`) vale se
/// for menor. ~90 MB por janela de 5 min no protótipo: cabem ~20 janelas.
pub const CACHE_MAX_BYTES: u64 = 2 * 1024 * 1024 * 1024;
/// `.part` abandonado há mais que isso é apagado na limpeza.
const STALE_PART: Duration = Duration::from_secs(24 * 60 * 60);
/// Nome do arquivo dentro da pasta da chave.
pub const FILE_NAME: &str = "proxy.mp4";
/// Muda quando o jeito de gerar muda; entra na chave do cache.
const PARAMS_VERSION: u32 = 1;

inventory::submit! { projects::Migration { id: "0058_001_proxy_jobs", sql: "CREATE TABLE proxy_jobs (job_id INTEGER PRIMARY KEY, source_id INTEGER NOT NULL, key TEXT NOT NULL, start_us INTEGER NOT NULL, end_us INTEGER NOT NULL, error TEXT); CREATE INDEX proxy_jobs_by_key ON proxy_jobs(key);" } }

fn error(code: &str, message: &str) -> CoreError {
    CoreError {
        code: code.into(),
        message: message.into(),
        usage: None,
    }
}
fn failed() -> CoreError {
    error("proxy_failed", "Não foi possível gerar o preview do Corte.")
}
fn invalid_range() -> CoreError {
    error("invalid_range", "Intervalo do Corte inválido.")
}

/// Janela do proxy: o Corte ±`MARGIN_US`, limitada a `[0, duração]`.
pub fn window(start_us: i64, end_us: i64, duration_us: i64) -> Result<(i64, i64), CoreError> {
    if start_us < 0 || end_us <= start_us || end_us > duration_us {
        return Err(invalid_range());
    }
    if end_us - start_us > MAX_CLIP_US {
        return Err(error(
            "clip_too_long",
            "O Corte é longo demais para o preview.",
        ));
    }
    Ok((
        (start_us - MARGIN_US).max(0),
        (end_us + MARGIN_US).min(duration_us),
    ))
}

/// Tempo da Fonte para o do proxy; `None` fora da janela (o proxy não tem esse trecho).
pub fn to_proxy_us(source_us: i64, window_start_us: i64, window_end_us: i64) -> Option<i64> {
    (window_start_us..=window_end_us)
        .contains(&source_us)
        .then(|| source_us - window_start_us)
}
/// Tempo do proxy para o da Fonte; `None` fora do proxy.
pub fn to_source_us(proxy_us: i64, window_start_us: i64, window_end_us: i64) -> Option<i64> {
    (0..=window_end_us - window_start_us)
        .contains(&proxy_us)
        .then(|| proxy_us + window_start_us)
}

/// Chave do cache: Fonte (impressão digital parcial e faixa de áudio), janela e parâmetros.
pub fn cache_key(partial_hash: &str, audio: i64, start_us: i64, end_us: i64) -> String {
    let params =
        format!("v{PARAMS_VERSION}|h{HEIGHT}|k{KEYFRAME_SECONDS}|v{VIDEO_KBPS}|a{AUDIO_KBPS}|x264");
    let mut hash = Sha256::new();
    for part in [
        "clipes-proxy",
        partial_hash,
        &audio.to_string(),
        &start_us.to_string(),
        &end_us.to_string(),
        &params,
    ] {
        hash.update(part.as_bytes());
        hash.update([0]);
    }
    format!("{:x}", hash.finalize())
}

fn limit_for(user_limit: u64) -> u64 {
    user_limit.min(CACHE_MAX_BYTES)
}

pub(crate) fn proxies_root(cache: &Path) -> PathBuf {
    cache.join("proxies")
}

pub(crate) fn ready_file(cache: &Path, key: &str) -> Option<PathBuf> {
    let file = proxies_root(cache).join(key).join(FILE_NAME);
    file.is_file().then_some(file)
}

/// Remove os proxies menos usados até o total caber em `limit`. Nunca remove `keep` (o que
/// acabou de ser gerado). Um arquivo que o sistema não deixa apagar (em uso no Windows) é
/// pulado, não vira erro. Devolve quantas pastas foram removidas.
pub(crate) fn evict(root: &Path, limit: u64, keep: &str) -> usize {
    let Ok(entries) = fs::read_dir(root) else {
        return 0;
    };
    let mut items = Vec::new();
    for entry in entries.flatten() {
        let name = entry.file_name().to_string_lossy().into_owned();
        let path = entry.path();
        if !entry.file_type().is_ok_and(|t| t.is_dir()) {
            continue;
        }
        if name.starts_with('.') {
            let old = fs::metadata(&path)
                .and_then(|m| m.modified())
                .ok()
                .and_then(|m| SystemTime::now().duration_since(m).ok())
                .is_some_and(|age| age > STALE_PART);
            if old {
                let _ = fs::remove_dir_all(&path);
            }
            continue;
        }
        let Ok(meta) = fs::metadata(path.join(FILE_NAME)) else {
            continue;
        };
        // Miniaturas e onda (#61) moram na pasta do proxy e contam no mesmo total.
        let extra: u64 = fs::read_dir(&path)
            .into_iter()
            .flatten()
            .flatten()
            .filter(|f| f.file_name() != FILE_NAME)
            .filter_map(|f| f.metadata().ok())
            .map(|m| m.len())
            .sum();
        items.push((
            meta.modified().unwrap_or(SystemTime::UNIX_EPOCH),
            meta.len() + extra,
            name,
            path,
        ));
    }
    let mut total: u64 = items.iter().map(|i| i.1).sum();
    items.sort_by_key(|i| i.0);
    let mut removed = 0;
    for (_, size, name, path) in items {
        if total <= limit {
            break;
        }
        if name == keep {
            continue;
        }
        if fs::remove_dir_all(&path).is_ok() {
            total = total.saturating_sub(size);
            removed += 1;
        }
    }
    removed
}

/// Limpeza LRU depois que a timeline (#61) cresceu a pasta do proxy `keep`.
pub(crate) fn evict_after_timeline(root: &Path, user_limit: u64, keep: &str) {
    evict(root, limit_for(user_limit), keep);
}

pub(crate) fn project_path() -> Result<PathBuf, CoreError> {
    let current = crate::dispatch("projects.current", json!({}), &mut |_| {})?;
    current["path"]
        .as_str()
        .map(PathBuf::from)
        .ok_or_else(|| error("invalid_project", "Nenhum Projeto aberto."))
}

fn offline() -> CoreError {
    error(
        "source_offline",
        "A Fonte está offline: reconecte ou relocalize a Fonte para ver o preview.",
    )
}
fn changed() -> CoreError {
    error(
        "source_changed",
        "A Fonte foi alterada: verifique a identidade dela antes do preview.",
    )
}

/// Valida a Fonte sem gerar nada: arquivo presente e identidade parcial igual à registrada.
pub(crate) fn checked_source(
    id: i64,
    project: &Path,
) -> Result<(PathBuf, String, i64, i64), CoreError> {
    let stored: String = projects::with_reader(|c| {
        c.query_row("SELECT path FROM sources WHERE id=?1", [id], |r| r.get(0))
    })
    .map_err(|_| error("source_not_found", "Fonte não encontrada."))?;
    let stored = PathBuf::from(stored);
    let path = if stored.is_absolute() {
        stored
    } else {
        project.join(stored)
    };
    if !path.is_file() {
        return Err(offline());
    }
    match jobs::preview::source(id, project) {
        Ok((path, hash, audio, duration, _)) => Ok((path, hash, audio, duration)),
        Err(e) if e.code == "source_changed" => Err(changed()),
        Err(_) => Err(failed()),
    }
}

fn status_json(cache: &Path, key: &str) -> Result<Value, CoreError> {
    if let Some(file) = ready_file(cache, key) {
        crate::media::touch(&file);
        return Ok(json!({"state":"ready","key":key,"job":null,"progress":100,"error":null}));
    }
    let row = projects::with_reader(|c| {
        use rusqlite::OptionalExtension;
        c.query_row(
            "SELECT j.id, j.state, j.progress, p.error FROM proxy_jobs p JOIN jobs j ON j.id=p.job_id WHERE p.key=?1 ORDER BY j.id DESC LIMIT 1",
            [key],
            |r| Ok((r.get::<_, i64>(0)?, r.get::<_, String>(1)?, r.get::<_, i64>(2)?, r.get::<_, Option<String>>(3)?)),
        )
        .optional()
    })?;
    Ok(match row {
        None => json!({"state":"missing","key":key,"job":null,"progress":0,"error":null}),
        Some((job, state, progress, err)) => {
            let state = match state.as_str() {
                "queued" => "queued",
                "running" => "running",
                "cancelled" => "cancelled",
                "completed" => "missing", // concluído, mas o arquivo foi limpo pelo LRU
                _ => "failed",
            };
            json!({"state":state,"key":key,"job":job,"progress":progress,"error":err})
        }
    })
}

fn key_of(v: &Value) -> Result<String, CoreError> {
    v["key"]
        .as_str()
        .filter(|k| k.len() == 64 && k.bytes().all(|b| matches!(b, b'0'..=b'9' | b'a'..=b'f')))
        .map(str::to_owned)
        .ok_or_else(|| error("invalid_key", "Chave de preview inválida."))
}

/// `proxy.request {source_id, start_us, end_us}`: devolve o estado do proxy do Corte. Se o
/// proxy não existe e não há tarefa, enfileira uma. Fonte offline ou alterada falha antes de
/// qualquer coisa, mesmo com proxy em cache.
fn request(v: Value, _: &mut EventSink<'_>) -> CommandResult {
    let source = v["source_id"]
        .as_i64()
        .ok_or_else(|| error("invalid_source", "Fonte inválida."))?;
    let (start, end) = (
        v["start_us"].as_i64().ok_or_else(invalid_range)?,
        v["end_us"].as_i64().ok_or_else(invalid_range)?,
    );
    let project = project_path()?;
    let (_, hash, audio, duration) = checked_source(source, &project)?;
    let (win_start, win_end) = window(start, end, duration)?;
    let key = cache_key(&hash, audio, win_start, win_end);
    let (cache, _, _) = crate::components::cache_settings()?;
    let mut status = status_json(&cache, &key)?;
    if matches!(
        status["state"].as_str(),
        Some("missing" | "failed" | "cancelled")
    ) {
        let job = projects::with_writer(|c| {
            let tx = c.transaction()?;
            tx.execute(
                "INSERT INTO jobs(kind,safety,state,source_id) VALUES ('proxy','local','queued',?1)",
                [source],
            )?;
            let id = tx.last_insert_rowid();
            tx.execute(
                "INSERT INTO proxy_jobs(job_id,source_id,key,start_us,end_us) VALUES (?1,?2,?3,?4,?5)",
                (id, source, &key, win_start, win_end),
            )?;
            tx.commit()?;
            Ok(id)
        })?;
        status = json!({"state":"queued","key":key,"job":job,"progress":0,"error":null});
    }
    status["windowStartUs"] = json!(win_start);
    status["windowEndUs"] = json!(win_end);
    Ok(status)
}
inventory::submit! { CommandRegistration { name: "proxy.request", execute: request } }

/// `proxy.status {key}`: estado, tarefa e progresso. Nunca devolve caminho.
fn status(v: Value, _: &mut EventSink<'_>) -> CommandResult {
    let key = key_of(&v)?;
    let (cache, _, _) = crate::components::cache_settings()?;
    status_json(&cache, &key)
}
inventory::submit! { CommandRegistration { name: "proxy.status", execute: status } }

/// `proxy.map_time {window_start_us, window_end_us, source_us | proxy_us}`: o mapeamento de
/// tempo da Fonte para o proxy (e de volta) que a UI usa ao clicar numa palavra.
fn map_time(v: Value, _: &mut EventSink<'_>) -> CommandResult {
    let (start, end) = (
        v["window_start_us"].as_i64().ok_or_else(invalid_range)?,
        v["window_end_us"].as_i64().ok_or_else(invalid_range)?,
    );
    if let Some(us) = v["source_us"].as_i64() {
        return Ok(json!({"proxyUs": to_proxy_us(us, start, end)}));
    }
    let us = v["proxy_us"].as_i64().ok_or_else(invalid_range)?;
    Ok(json!({"sourceUs": to_source_us(us, start, end)}))
}
inventory::submit! { CommandRegistration { name: "proxy.map_time", execute: map_time } }

/// Argumentos do FFmpeg: `-ss`/`-t` antes de `-i` (busca rápida e recorte exato ao recodificar),
/// altura limitada e par, `yuv420p` (o `testsrc` sai 4:4:4 sem isso e o WebView pode não tocar),
/// GOP curto por tempo, sem quadros B, AAC e `faststart` para o `<video>` começar já.
fn encode_args(
    source: &Path,
    audio: i64,
    start_us: i64,
    end_us: i64,
    output: &Path,
) -> Vec<std::ffi::OsString> {
    let secs = |us: i64| format!("{:.6}", us as f64 / 1_000_000.0);
    let mut args: Vec<std::ffi::OsString> = Vec::new();
    fn push(args: &mut Vec<std::ffi::OsString>, items: &[&str]) {
        args.extend(items.iter().map(std::ffi::OsString::from));
    }
    push(
        &mut args,
        &[
            "-v",
            "error",
            "-nostdin",
            "-progress",
            "pipe:1",
            "-nostats",
            "-ss",
        ],
    );
    push(
        &mut args,
        &[&secs(start_us), "-t", &secs(end_us - start_us), "-i"],
    );
    args.push(source.as_os_str().to_owned());
    let filter = format!("scale=-2:'min({HEIGHT},trunc(ih/2)*2)',format=yuv420p");
    let map_audio = format!("0:{audio}");
    let force = format!("expr:gte(t,n_forced*{KEYFRAME_SECONDS})");
    let (video, rate, buffer, aac) = (
        format!("{VIDEO_KBPS}k"),
        format!("{VIDEO_KBPS}k"),
        format!("{}k", VIDEO_KBPS * 2),
        format!("{AUDIO_KBPS}k"),
    );
    push(
        &mut args,
        &["-map", "0:v:0", "-map", &map_audio, "-vf", &filter],
    );
    push(
        &mut args,
        &[
            "-c:v",
            "libx264",
            "-preset",
            "veryfast",
            "-profile:v",
            "high",
            "-pix_fmt",
            "yuv420p",
        ],
    );
    push(
        &mut args,
        &[
            "-b:v", &video, "-maxrate", &rate, "-bufsize", &buffer, "-bf", "0",
        ],
    );
    push(&mut args, &["-force_key_frames", &force]);
    push(
        &mut args,
        &[
            "-c:a",
            "aac",
            "-b:a",
            &aac,
            "-ac",
            "2",
            "-movflags",
            "+faststart",
            "-y",
        ],
    );
    args.push(output.as_os_str().to_owned());
    args
}

/// Executa o job `proxy` da fila. Grava o código de falha (fixo) em `proxy_jobs.error`.
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
                c.execute("UPDATE proxy_jobs SET error=?2 WHERE job_id=?1", (id, code))?;
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
            "SELECT key,start_us,end_us FROM proxy_jobs WHERE job_id=?1",
            [id],
            |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?)),
        )
    })?;
    let (source, hash, audio, duration) = checked_source(source_id, project)?;
    // A Fonte pode ter mudado entre o pedido e a execução: a chave tem de bater.
    if end > duration || cache_key(&hash, audio, start, end) != key {
        return Err(changed());
    }
    let (cache, user_limit, ffmpeg) = crate::components::cache_settings()?;
    let ffmpeg =
        ffmpeg.ok_or_else(|| error("component_missing", "Instale o Componente FFmpeg."))?;
    if ready_file(&cache, &key).is_some() {
        return Ok(());
    }
    let root = proxies_root(&cache);
    fs::create_dir_all(&root).map_err(|_| failed())?;
    let stage = root.join(format!(".{key}.part"));
    let _ = fs::remove_dir_all(&stage);
    fs::create_dir_all(&stage).map_err(|_| failed())?;
    let outcome = encode(id, &ffmpeg, &source, audio, start, end, &stage, stop);
    if let Err(e) = outcome {
        let _ = fs::remove_dir_all(&stage);
        return Err(e);
    }
    let target = root.join(&key);
    let _ = fs::remove_dir_all(&target);
    if fs::rename(&stage, &target).is_err() {
        let _ = fs::remove_dir_all(&stage);
        return Err(failed());
    }
    crate::media::touch(&target.join(FILE_NAME));
    evict(&root, limit_for(user_limit), &key);
    Ok(())
}

#[allow(clippy::too_many_arguments)]
fn encode(
    id: i64,
    ffmpeg: &Path,
    source: &Path,
    audio: i64,
    start: i64,
    end: i64,
    stage: &Path,
    stop: &AtomicBool,
) -> Result<(), CoreError> {
    jobs::progress(id, "proxy", 1, "Gerando o preview do Corte")?;
    let output = stage.join(FILE_NAME);
    let args = encode_args(source, audio, start, end, &output);
    let total = (end - start).max(1);
    let mut pending = String::new();
    let mut last = 1u8;
    jobs::preview::run_process(ffmpeg, args, id, stop, |bytes| {
        pending.push_str(&String::from_utf8_lossy(bytes));
        while let Some(line_end) = pending.find('\n') {
            let line: String = pending.drain(..=line_end).collect();
            if let Some(us) = line
                .trim()
                .strip_prefix("out_time_us=")
                .and_then(|n| n.parse::<i64>().ok())
            {
                let pct = (us.clamp(0, total) * 98 / total) as u8;
                if pct > last {
                    last = pct;
                    let _ = jobs::progress(id, "proxy", pct, "Gerando o preview do Corte");
                }
            }
        }
    })
    .map_err(|e| match e.code.as_str() {
        "cancelled" | "interrupted" => e,
        _ => failed(),
    })?;
    if fs::metadata(&output).map(|m| m.len()).unwrap_or(0) == 0 {
        return Err(failed());
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn window_is_clip_plus_margin_clamped_to_the_source() {
        let hour = 3_600_000_000;
        assert_eq!(
            window(600_000_000, 660_000_000, hour).unwrap(),
            (480_000_000, 780_000_000)
        );
        assert_eq!(
            window(10_000_000, 40_000_000, hour).unwrap(),
            (0, 160_000_000)
        );
        assert_eq!(
            window(hour - 30_000_000, hour, hour).unwrap(),
            (hour - 150_000_000, hour)
        );
        for (s, e) in [(-1, 5), (5, 5), (9, 5), (0, hour + 1), (0, MAX_CLIP_US + 1)] {
            assert!(window(s, e, hour).is_err(), "{s}-{e}");
        }
        assert_eq!(window(0, hour, hour).unwrap_err().code, "clip_too_long");
        assert_eq!(window(5, 5, hour).unwrap_err().code, "invalid_range");
    }

    #[test]
    fn time_maps_between_source_and_proxy_inside_the_window_only() {
        let (a, b) = (480_000_000, 780_000_000);
        assert_eq!(to_proxy_us(a, a, b), Some(0));
        assert_eq!(to_proxy_us(600_000_000, a, b), Some(120_000_000));
        assert_eq!(to_proxy_us(b, a, b), Some(b - a));
        assert_eq!(to_proxy_us(a - 1, a, b), None);
        assert_eq!(to_proxy_us(b + 1, a, b), None);
        assert_eq!(to_source_us(0, a, b), Some(a));
        assert_eq!(to_source_us(120_000_000, a, b), Some(600_000_000));
        assert_eq!(to_source_us(-1, a, b), None);
        assert_eq!(to_source_us(b - a + 1, a, b), None);
        for us in [a, a + 1, 600_000_000, b] {
            assert_eq!(to_source_us(to_proxy_us(us, a, b).unwrap(), a, b), Some(us));
        }
    }

    #[test]
    fn cache_key_depends_on_every_input() {
        let base = cache_key("abc", 1, 10, 20);
        assert_eq!(base.len(), 64);
        assert_eq!(base, cache_key("abc", 1, 10, 20));
        assert_ne!(base, cache_key("abd", 1, 10, 20));
        assert_ne!(base, cache_key("abc", 2, 10, 20));
        assert_ne!(base, cache_key("abc", 1, 11, 20));
        assert_ne!(base, cache_key("abc", 1, 10, 21));
        // Separador: "1" + "02" não pode colidir com "10" + "2".
        assert_ne!(cache_key("a", 1, 2, 3), cache_key("a", 12, 3, 3));
    }

    #[test]
    fn eviction_removes_least_recently_used_and_keeps_the_new_one() {
        let dir = tempfile::tempdir().unwrap();
        let set = |name: &str, bytes: usize, seconds: u64| {
            let folder = dir.path().join(name);
            fs::create_dir_all(&folder).unwrap();
            let file = folder.join(FILE_NAME);
            fs::write(&file, vec![0u8; bytes]).unwrap();
            fs::OpenOptions::new()
                .write(true)
                .open(&file)
                .unwrap()
                .set_times(
                    fs::FileTimes::new()
                        .set_modified(SystemTime::UNIX_EPOCH + Duration::from_secs(seconds)),
                )
                .unwrap();
        };
        set("old", 100, 1_000);
        set("mid", 100, 2_000);
        set("new", 100, 3_000);
        fs::create_dir_all(dir.path().join(".busy.part")).unwrap();
        fs::write(
            dir.path().join(".busy.part").join(FILE_NAME),
            vec![0u8; 500],
        )
        .unwrap();
        assert_eq!(evict(dir.path(), 300, "new"), 0);
        assert_eq!(evict(dir.path(), 250, "new"), 1);
        assert!(!dir.path().join("old").exists());
        assert!(dir.path().join("mid").exists());
        // "old" é o mais velho, mas "keep" nunca sai, mesmo acima do limite.
        set("old2", 100, 500);
        assert_eq!(evict(dir.path(), 50, "old2"), 2);
        assert!(dir.path().join("old2").exists());
        assert!(!dir.path().join("mid").exists() && !dir.path().join("new").exists());
        assert!(
            dir.path().join(".busy.part").exists(),
            "o .part em andamento não é evictado"
        );
    }

    #[test]
    fn encode_arguments_are_safe_for_the_webview() {
        let args: Vec<String> = encode_args(
            Path::new("in.mkv"),
            1,
            5_000_000,
            65_500_000,
            Path::new("out.mp4"),
        )
        .into_iter()
        .map(|a| a.to_string_lossy().into_owned())
        .collect();
        let line = args.join(" ");
        assert!(
            line.contains("-ss 5.000000 -t 60.500000 -i in.mkv"),
            "{line}"
        );
        for needle in [
            "libx264",
            "yuv420p",
            "-bf 0",
            "+faststart",
            "aac",
            "n_forced*0.5",
            "-map 0:1",
        ] {
            assert!(line.contains(needle), "{needle}");
        }
        assert!(args.iter().position(|a| a == "-ss") < args.iter().position(|a| a == "-i"));
    }
}
