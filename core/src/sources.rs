use crate::{projects, CommandRegistration, CommandResult, CoreError, EventSink, ProgressEvent};
use rusqlite::params;
use serde_json::{json, Value};
use sha2::{Digest, Sha256};
use std::{
    collections::HashMap,
    fs::{self, File},
    io::{Read, Seek, SeekFrom, Write},
    path::{Path, PathBuf},
    sync::{
        atomic::{AtomicBool, Ordering},
        Arc, Mutex, OnceLock,
    },
};

inventory::submit! { projects::Migration { id:"0041_001_sources", sql:"CREATE TABLE sources (id INTEGER PRIMARY KEY, path TEXT NOT NULL, size INTEGER NOT NULL, duration_us INTEGER NOT NULL, partial_hash TEXT NOT NULL, full_hash TEXT, metadata TEXT NOT NULL, permission TEXT NOT NULL, audio_track INTEGER NOT NULL);" } }
inventory::submit! { projects::Migration { id:"0041_002_source_mtime", sql:"ALTER TABLE sources ADD COLUMN modified TEXT;" } }
inventory::submit! { projects::Migration { id:"0045_001_source_origin_url", sql:"ALTER TABLE sources ADD COLUMN origin_url TEXT;" } }
fn err(code: &str, message: &str) -> CoreError {
    CoreError {
        code: code.into(),
        message: message.into(),
        usage: None,
    }
}
fn project_job(v: &Value) -> Result<projects::ProjectJob, CoreError> {
    let job = projects::start_job()?;
    let requested = v["project"]
        .as_str()
        .ok_or_else(|| err("invalid_project", "Projeto obrigatório"))?;
    let current = crate::dispatch("projects.current", json!({}), &mut |_| {})?;
    if current["path"].as_str() != Some(requested) {
        return Err(err("invalid_project", "O Projeto não está aberto"));
    }
    Ok(job)
}

fn resolve_path(v: &Value, stored: &str) -> Result<PathBuf, CoreError> {
    let path = PathBuf::from(stored);
    if path.is_absolute() {
        Ok(path)
    } else {
        let project = v["project"]
            .as_str()
            .ok_or_else(|| err("invalid_project", "Projeto obrigatório"))?;
        Ok(Path::new(project).join(path))
    }
}
fn probe_path() -> Result<PathBuf, CoreError> {
    if let Some(p) = std::env::var_os("CLIPES_FFPROBE") {
        return Ok(p.into());
    }
    crate::components::ffprobe_executable(crate::components::configured_ffmpeg().as_deref())
}
fn probe(path: &Path) -> Result<Value, CoreError> {
    let path = path
        .canonicalize()
        .map_err(|_| err("source_unavailable", "Fonte indisponível"))?;
    if !path.is_file() {
        return Err(err("source_unavailable", "Fonte indisponível"));
    }
    let child = crate::process::spawn(
        probe_path()?,
        [
            std::ffi::OsStr::new("-v"),
            std::ffi::OsStr::new("error"),
            std::ffi::OsStr::new("-show_format"),
            std::ffi::OsStr::new("-show_streams"),
            std::ffi::OsStr::new("-of"),
            std::ffi::OsStr::new("json"),
            path.as_os_str(),
        ],
        None,
    )
    .map_err(|_| {
        err(
            "ffprobe_missing",
            "ffprobe indisponível; verifique os Componentes",
        )
    })?;
    let output = child
        .wait_with_output()
        .map_err(|_| err("probe_failed", "Não foi possível ler a Fonte"))?;
    if !output.status.success() {
        return Err(err("probe_failed", "Não foi possível ler a Fonte"));
    }
    let result: Value = serde_json::from_slice(&output.stdout)
        .map_err(|_| err("probe_failed", "Metadados inválidos"))?;
    if duration(&result).is_none() || !result["streams"].is_array() {
        return Err(err("probe_failed", "Metadados incompletos"));
    }
    Ok(result)
}
fn duration(v: &Value) -> Option<i64> {
    let n = v["format"]["duration"].as_str()?.parse::<f64>().ok()?;
    if n.is_finite() && n >= 0.0 && n < i64::MAX as f64 / 1_000_000.0 {
        Some((n * 1_000_000.0).round() as i64)
    } else {
        None
    }
}
pub(crate) fn partial(path: &Path) -> Result<(u64, String), CoreError> {
    let mut f = File::open(path).map_err(|_| err("source_unavailable", "Fonte indisponível"))?;
    let size = f
        .metadata()
        .map_err(|_| err("source_unavailable", "Fonte indisponível"))?
        .len();
    let mut hash = Sha256::new();
    let block = 4 * 1024 * 1024u64;
    for offset in [
        0,
        size.saturating_sub(block) / 2,
        size.saturating_sub(block),
    ] {
        f.seek(SeekFrom::Start(offset))
            .map_err(|_| err("source_read", "Não foi possível ler a Fonte"))?;
        let mut part = (&mut f).take(block);
        std::io::copy(&mut part, &mut hash)
            .map_err(|_| err("source_read", "Não foi possível ler a Fonte"))?;
    }
    Ok((size, format!("{:x}", hash.finalize())))
}
fn modified(path: &Path) -> Result<String, CoreError> {
    let time = fs::metadata(path)
        .and_then(|m| m.modified())
        .map_err(|_| err("source_unavailable", "Fonte indisponível"))?;
    Ok(match time.duration_since(std::time::UNIX_EPOCH) {
        Ok(d) => d.as_nanos().to_string(),
        Err(e) => format!("-{}", e.duration().as_nanos()),
    })
}
type Flags = Mutex<HashMap<String, Arc<AtomicBool>>>;
fn jobs() -> &'static Flags {
    static JOBS: OnceLock<Flags> = OnceLock::new();
    JOBS.get_or_init(|| Mutex::new(HashMap::new()))
}
fn full(
    path: &Path,
    flag: &AtomicBool,
    job: &str,
    events: &mut EventSink<'_>,
) -> Result<String, CoreError> {
    let mut file = File::open(path).map_err(|_| err("source_unavailable", "Fonte indisponível"))?;
    let size = file
        .metadata()
        .map_err(|_| err("source_read", "Não foi possível ler a Fonte"))?
        .len();
    let mut hash = Sha256::new();
    let mut buf = [0; 65536];
    let mut done = 0u64;
    let mut last = 255;
    loop {
        if flag.load(Ordering::Relaxed) {
            return Err(err("cancelled", "Verificação cancelada"));
        }
        let n = file
            .read(&mut buf)
            .map_err(|_| err("source_read", "Não foi possível ler a Fonte"))?;
        if n == 0 {
            break;
        }
        hash.update(&buf[..n]);
        done += n as u64;
        let pct = ((done.saturating_mul(100) / size.max(1)).min(100)) as u8;
        if pct != last {
            events(ProgressEvent {
                project: None,
                job: job.into(),
                stage: "hash".into(),
                percentage: pct,
                message: "Verificando Fonte".into(),
                error: None,
            });
            last = pct;
        }
    }
    Ok(format!("{:x}", hash.finalize()))
}
fn run_hash(path: &Path, id: &str, events: &mut EventSink<'_>) -> Result<String, CoreError> {
    let flag = Arc::new(AtomicBool::new(false));
    {
        let mut map = jobs().lock().unwrap();
        if map.contains_key(id) {
            return Err(err("job_running", "Verificação em andamento"));
        }
        map.insert(id.into(), flag.clone());
    }
    let result = full(path, &flag, id, events);
    jobs().lock().unwrap().remove(id);
    result
}
fn cancel(v: Value, _: &mut EventSink<'_>) -> CommandResult {
    if let Some(flag) = jobs().lock().unwrap().get(v["job"].as_str().unwrap_or("")) {
        flag.store(true, Ordering::Relaxed);
    }
    Ok(json!({}))
}
fn permission(v: &Value) -> Result<(), CoreError> {
    match v["status"].as_str() {
        Some("none") => Ok(()),
        Some("granted")
            if ["who", "where", "scope"]
                .iter()
                .all(|k| v[*k].as_str().is_some_and(|s| !s.trim().is_empty())) =>
        {
            Ok(())
        }
        _ => Err(err(
            "invalid_permission",
            "Registre a Permissão ou informe que não há permissão",
        )),
    }
}
fn inspect(v: Value, _: &mut EventSink<'_>) -> CommandResult {
    let path = PathBuf::from(
        v["path"]
            .as_str()
            .ok_or_else(|| err("invalid_source", "Selecione a Fonte"))?,
    );
    probe(&path)
}
fn import(v: Value, events: &mut EventSink<'_>) -> CommandResult {
    let _job = project_job(&v)?;
    permission(&v["permission"])?;
    let origin_url = match v.get("origin_url") {
        None | Some(Value::Null) => None,
        Some(Value::String(url)) => {
            crate::url_import::validate_url(url)?;
            Some(url.as_str())
        }
        _ => return Err(err("invalid_url", "Informe uma URL HTTP ou HTTPS válida")),
    };
    let source = PathBuf::from(
        v["path"]
            .as_str()
            .ok_or_else(|| err("invalid_source", "Selecione a Fonte"))?,
    );
    let metadata = probe(&source)?;
    let audio = v["audio_track"]
        .as_i64()
        .ok_or_else(|| err("invalid_track", "Selecione uma faixa de áudio"))?;
    if !metadata["streams"]
        .as_array()
        .unwrap()
        .iter()
        .any(|s| s["codec_type"] == "audio" && s["index"].as_i64() == Some(audio))
    {
        return Err(err("invalid_track", "Selecione uma faixa de áudio válida"));
    }
    let (size, part) = partial(&source)?;
    let dur = duration(&metadata).unwrap();
    let mut path = source
        .canonicalize()
        .map_err(|_| err("source_unavailable", "Fonte indisponível"))?;
    let mut full_hash = None;
    if v["copy"] == true {
        let dir = PathBuf::from(
            v["project"]
                .as_str()
                .ok_or_else(|| err("invalid_project", "Projeto obrigatório"))?,
        )
        .join("media");
        fs::create_dir_all(&dir)
            .map_err(|_| err("copy_failed", "Não foi possível copiar a Fonte"))?;
        let name = path
            .file_name()
            .ok_or_else(|| err("invalid_source", "Nome da Fonte inválido"))?;
        let target = dir.join(name);
        if target.exists() {
            return Err(err("copy_exists", "Já existe uma Fonte com esse nome"));
        }
        let tmp = dir.join(format!(
            ".clipes-{}-{}.part",
            std::process::id(),
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap()
                .as_nanos()
        ));
        let result = (|| {
            let mut src = File::open(&path)
                .map_err(|_| err("copy_failed", "Não foi possível copiar a Fonte"))?;
            let mut dst = File::create(&tmp)
                .map_err(|_| err("copy_failed", "Não foi possível copiar a Fonte"))?;
            std::io::copy(&mut src, &mut dst)
                .map_err(|_| err("copy_failed", "Não foi possível copiar a Fonte"))?;
            dst.flush()
                .map_err(|_| err("copy_failed", "Não foi possível copiar a Fonte"))?;
            drop(dst);
            let original = run_hash(&path, "source-copy-original", events)?;
            let copied = run_hash(&tmp, "source-copy-check", events)?;
            if original != copied {
                return Err(err("hash_mismatch", "A cópia não confere"));
            }
            fs::rename(&tmp, &target)
                .map_err(|_| err("copy_failed", "Não foi possível copiar a Fonte"))?;
            Ok(original)
        })();
        if result.is_err() {
            let _ = fs::remove_file(&tmp);
        }
        full_hash = Some(result?);
        path = Path::new("media").join(name);
    }
    let modified = modified(&resolve_path(&v, &path.to_string_lossy())?)?;
    let id = projects::with_writer(|conn| {
        let tx = conn.transaction()?;
        tx.execute("INSERT INTO sources(path,size,duration_us,partial_hash,full_hash,metadata,permission,audio_track,modified,origin_url) VALUES(?1,?2,?3,?4,?5,?6,?7,?8,?9,?10)",params![path.to_string_lossy(),size as i64,dur,part,full_hash,metadata.to_string(),v["permission"].to_string(),audio,modified,origin_url])?;
        let id = tx.last_insert_rowid();
        tx.execute(
            "INSERT INTO jobs(kind,safety,state,source_id) VALUES ('preview','local','queued',?1)",
            [id],
        )?;
        tx.commit()?;
        Ok(id)
    })?;
    get(&v, id)
}
fn get(v: &Value, id: i64) -> CommandResult {
    let (path,metadata,permission,audio,hash,size,partial_hash,mtime,origin_url):(String,String,String,i64,Option<String>,i64,String,Option<String>,Option<String>)=projects::with_reader(|conn| conn.query_row("SELECT path,metadata,permission,audio_track,full_hash,size,partial_hash,modified,origin_url FROM sources WHERE id=?1",[id],|r|Ok((r.get(0)?,r.get(1)?,r.get(2)?,r.get(3)?,r.get(4)?,r.get(5)?,r.get(6)?,r.get(7)?,r.get(8)?)))).map_err(|_|err("source_missing","Fonte não encontrada"))?;
    let resolved = resolve_path(v, &path)?;
    let state = if !resolved.is_file() {
        "offline"
    } else if partial(&resolved).is_ok_and(|f| f == (size as u64, partial_hash))
        && modified(&resolved).ok().as_ref() == mtime.as_ref()
        && mtime.is_some()
    {
        "available"
    } else {
        "changed"
    };
    Ok(
        json!({"id":id,"status":state,"available":state=="available","path":resolved,"metadata":serde_json::from_str::<Value>(&metadata).unwrap_or(Value::Null),"permission":serde_json::from_str::<Value>(&permission).unwrap_or(Value::Null),"audio_track":audio,"verified":hash.is_some(),"origin_url":origin_url}),
    )
}
fn list(v: Value, _: &mut EventSink<'_>) -> CommandResult {
    let _job = project_job(&v)?;
    let ids = projects::with_reader(|conn| {
        let mut q = conn.prepare("SELECT id FROM sources ORDER BY id")?;
        let rows = q
            .query_map([], |r| r.get::<_, i64>(0))?
            .collect::<Result<Vec<_>, _>>()?;
        Ok(rows)
    })?;
    Ok(json!(ids
        .into_iter()
        .map(|id| get(&v, id))
        .collect::<Result<Vec<_>, _>>()?))
}
fn hash_source(v: Value, events: &mut EventSink<'_>) -> CommandResult {
    let _job = project_job(&v)?;
    let id = v["id"]
        .as_i64()
        .ok_or_else(|| err("source_missing", "Fonte não encontrada"))?;
    let (path, size, part, mtime, previous_hash): (
        String,
        i64,
        String,
        Option<String>,
        Option<String>,
    ) = projects::with_reader(|conn| {
        conn.query_row(
            "SELECT path,size,partial_hash,modified,full_hash FROM sources WHERE id=?1",
            [id],
            |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?, r.get(3)?, r.get(4)?)),
        )
    })
    .map_err(|_| err("source_missing", "Fonte não encontrada"))?;
    let resolved = resolve_path(&v, &path)?;
    let before = partial(&resolved)?;
    let before_mtime = modified(&resolved)?;
    let changed = before != (size as u64, part.clone()) || mtime.as_deref() != Some(&before_mtime);
    if changed && previous_hash.is_none() && v["confirmed"] != true {
        return Err(err(
            "confirmation_required",
            "Não há hash original; confirme que é a mesma Fonte",
        ));
    }
    let hash = run_hash(
        &resolved,
        v["job"].as_str().unwrap_or("source-hash"),
        events,
    )?;
    if partial(&resolved)? != before || modified(&resolved)? != before_mtime {
        return Err(err(
            "source_changed",
            "A Fonte foi alterada durante a verificação",
        ));
    }
    if previous_hash.as_ref().is_some_and(|old| old != &hash) && v["confirmed"] != true {
        return Err(err(
            "confirmation_required",
            "O hash não confere; confirme que é a mesma Fonte",
        ));
    }
    let metadata = if changed {
        Some(probe(&resolved)?)
    } else {
        None
    };
    if partial(&resolved)? != before || modified(&resolved)? != before_mtime {
        return Err(err(
            "source_changed",
            "A Fonte foi alterada durante a verificação",
        ));
    }
    let updated = projects::with_writer(|conn| {
        conn.execute("UPDATE sources SET full_hash=?1,size=?2,partial_hash=?3,modified=?4,metadata=COALESCE(?5,metadata),duration_us=COALESCE(?6,duration_us) WHERE id=?7 AND path=?8 AND partial_hash=?9",params![hash,before.0 as i64,before.1,before_mtime,metadata.as_ref().map(Value::to_string),metadata.as_ref().and_then(duration),id,path,part])
    })?;
    if updated != 1 {
        return Err(err(
            "source_changed",
            "A Fonte foi alterada durante a verificação",
        ));
    }
    Ok(json!({"verified":true}))
}
fn relocate(v: Value, events: &mut EventSink<'_>) -> CommandResult {
    let _job = project_job(&v)?;
    let id = v["id"]
        .as_i64()
        .ok_or_else(|| err("source_missing", "Fonte não encontrada"))?;
    let candidate = PathBuf::from(
        v["path"]
            .as_str()
            .ok_or_else(|| err("invalid_source", "Selecione a Fonte"))?,
    );
    let (size, dur, part, hash): (i64, i64, String, Option<String>) =
        projects::with_reader(|conn| {
            conn.query_row(
                "SELECT size,duration_us,partial_hash,full_hash FROM sources WHERE id=?1",
                [id],
                |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?, r.get(3)?)),
            )
        })
        .map_err(|_| err("source_missing", "Fonte não encontrada"))?;
    if partial(&candidate)? != (size as u64, part.clone())
        || duration(&probe(&candidate)?) != Some(dur)
    {
        return Err(err("source_mismatch", "O arquivo não corresponde à Fonte"));
    }
    if hash.is_none() && v["confirmed"] != true {
        return Err(err("confirmation_required","Tamanho, duração e amostras conferem; confirme a relocalização sem verificação completa"));
    }
    let candidate_mtime = modified(&candidate)?;
    let candidate_hash = run_hash(
        &candidate,
        v["job"].as_str().unwrap_or("source-relocate"),
        events,
    )?;
    if hash.as_ref().is_some_and(|h| h != &candidate_hash) {
        return Err(err("source_mismatch", "O arquivo não corresponde à Fonte"));
    }
    if partial(&candidate)? != (size as u64, part) || modified(&candidate)? != candidate_mtime {
        return Err(err("source_changed", "A Fonte foi alterada"));
    }
    let path = candidate
        .canonicalize()
        .map_err(|_| err("source_unavailable", "Fonte indisponível"))?;
    projects::with_writer(|conn| {
        conn.execute(
            "UPDATE sources SET path=?1,full_hash=?2,modified=?3 WHERE id=?4",
            params![path.to_string_lossy(), candidate_hash, candidate_mtime, id],
        )
    })?;
    get(&v, id)
}
inventory::submit! {CommandRegistration{name:"sources.import",execute:import}}
inventory::submit! {CommandRegistration{name:"sources.inspect",execute:inspect}}
inventory::submit! {CommandRegistration{name:"sources.list",execute:list}}
inventory::submit! {CommandRegistration{name:"sources.hash",execute:hash_source}}
inventory::submit! {CommandRegistration{name:"sources.relocate",execute:relocate}}
inventory::submit! {CommandRegistration{name:"sources.cancel",execute:cancel}}
