use crate::{projects, CommandRegistration, CommandResult, CoreError, EventSink, ProgressEvent};
use rusqlite::{params, Connection};
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
fn err(code: &str, message: &str) -> CoreError {
    CoreError {
        code: code.into(),
        message: message.into(),
    }
}
fn writer(v: &Value) -> Result<Connection, CoreError> {
    let p = v["project"]
        .as_str()
        .ok_or_else(|| err("invalid_project", "Projeto obrigatório"))?;
    projects::open_db(Path::new(p))
        .map_err(|_| err("project_open", "Não foi possível abrir o Projeto"))
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
fn probe_path() -> PathBuf {
    if let Some(p) = std::env::var_os("CLIPES_FFPROBE") {
        return p.into();
    }
    if let Some(p) = crate::components::configured_ffmpeg() {
        let sibling = p.with_file_name(if cfg!(windows) {
            "ffprobe.exe"
        } else {
            "ffprobe"
        });
        if sibling.is_file() {
            return sibling;
        }
    }
    PathBuf::from(if cfg!(windows) {
        "ffprobe.exe"
    } else {
        "ffprobe"
    })
}
fn probe(path: &Path) -> Result<Value, CoreError> {
    let path = path
        .canonicalize()
        .map_err(|_| err("source_unavailable", "Fonte indisponível"))?;
    if !path.is_file() {
        return Err(err("source_unavailable", "Fonte indisponível"));
    }
    let child = crate::process::spawn(
        probe_path(),
        [
            std::ffi::OsStr::new("-v"),
            std::ffi::OsStr::new("error"),
            std::ffi::OsStr::new("-show_format"),
            std::ffi::OsStr::new("-show_streams"),
            std::ffi::OsStr::new("-of"),
            std::ffi::OsStr::new("json"),
            path.as_os_str(),
        ],
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
fn partial(path: &Path) -> Result<(u64, String), CoreError> {
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
    permission(&v["permission"])?;
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
    let conn = writer(&v)?;
    conn.execute("INSERT INTO sources(path,size,duration_us,partial_hash,full_hash,metadata,permission,audio_track) VALUES(?1,?2,?3,?4,?5,?6,?7,?8)",params![path.to_string_lossy(),size as i64,dur,part,full_hash,metadata.to_string(),v["permission"].to_string(),audio]).map_err(|_|err("source_save","Não foi possível salvar a Fonte"))?;
    let id = conn.last_insert_rowid();
    drop(conn);
    get(&v, id)
}
fn get(v: &Value, id: i64) -> CommandResult {
    let conn = writer(v)?;
    let (path,metadata,permission,audio,hash,size,partial_hash):(String,String,String,i64,Option<String>,i64,String)=conn.query_row("SELECT path,metadata,permission,audio_track,full_hash,size,partial_hash FROM sources WHERE id=?1",[id],|r|Ok((r.get(0)?,r.get(1)?,r.get(2)?,r.get(3)?,r.get(4)?,r.get(5)?,r.get(6)?))).map_err(|_|err("source_missing","Fonte não encontrada"))?;
    let resolved = resolve_path(v, &path)?;
    let available =
        partial(&resolved).is_ok_and(|fingerprint| fingerprint == (size as u64, partial_hash));
    Ok(
        json!({"id":id,"available":available,"path":resolved,"metadata":serde_json::from_str::<Value>(&metadata).unwrap_or(Value::Null),"permission":serde_json::from_str::<Value>(&permission).unwrap_or(Value::Null),"audio_track":audio,"verified":hash.is_some()}),
    )
}
fn list(v: Value, _: &mut EventSink<'_>) -> CommandResult {
    let conn = writer(&v)?;
    let mut q = conn
        .prepare("SELECT id FROM sources ORDER BY id")
        .map_err(|_| err("source_read", "Não foi possível listar Fontes"))?;
    let ids = q
        .query_map([], |r| r.get::<_, i64>(0))
        .map_err(|_| err("source_read", "Não foi possível listar Fontes"))?
        .collect::<Result<Vec<_>, _>>()
        .map_err(|_| err("source_read", "Não foi possível listar Fontes"))?;
    drop(q);
    drop(conn);
    Ok(json!(ids
        .into_iter()
        .map(|id| get(&v, id))
        .collect::<Result<Vec<_>, _>>()?))
}
fn hash_source(v: Value, events: &mut EventSink<'_>) -> CommandResult {
    let id = v["id"]
        .as_i64()
        .ok_or_else(|| err("source_missing", "Fonte não encontrada"))?;
    let conn = writer(&v)?;
    let (path, size, part, previous_hash): (String, i64, String, Option<String>) = conn
        .query_row(
            "SELECT path,size,partial_hash,full_hash FROM sources WHERE id=?1",
            [id],
            |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?, r.get(3)?)),
        )
        .map_err(|_| err("source_missing", "Fonte não encontrada"))?;
    drop(conn);
    let resolved = resolve_path(&v, &path)?;
    let before = partial(&resolved)?;
    if before != (size as u64, part.clone()) {
        return Err(err("source_changed", "A Fonte foi alterada"));
    }
    let hash = run_hash(
        &resolved,
        v["job"].as_str().unwrap_or("source-hash"),
        events,
    )?;
    if partial(&resolved)? != before {
        return Err(err("source_changed", "A Fonte foi alterada"));
    }
    if previous_hash
        .as_ref()
        .is_some_and(|previous| previous != &hash)
    {
        return Err(err("source_changed", "A Fonte foi alterada"));
    }
    let conn = writer(&v)?;
    conn.execute(
        "UPDATE sources SET full_hash=?1 WHERE id=?2 AND path=?3 AND partial_hash=?4",
        params![hash, id, path, part],
    )
    .map_err(|_| err("source_save", "Não foi possível salvar a verificação"))?;
    Ok(json!({"verified":true}))
}
fn relocate(v: Value, events: &mut EventSink<'_>) -> CommandResult {
    let id = v["id"]
        .as_i64()
        .ok_or_else(|| err("source_missing", "Fonte não encontrada"))?;
    let candidate = PathBuf::from(
        v["path"]
            .as_str()
            .ok_or_else(|| err("invalid_source", "Selecione a Fonte"))?,
    );
    let conn = writer(&v)?;
    let (size, dur, part, hash): (i64, i64, String, Option<String>) = conn
        .query_row(
            "SELECT size,duration_us,partial_hash,full_hash FROM sources WHERE id=?1",
            [id],
            |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?, r.get(3)?)),
        )
        .map_err(|_| err("source_missing", "Fonte não encontrada"))?;
    drop(conn);
    if partial(&candidate)? != (size as u64, part.clone())
        || duration(&probe(&candidate)?) != Some(dur)
    {
        return Err(err("source_mismatch", "O arquivo não corresponde à Fonte"));
    }
    if hash.is_none() && v["confirmed"] != true {
        return Err(err("confirmation_required","Tamanho, duração e amostras conferem; confirme a relocalização sem verificação completa"));
    }
    let candidate_hash = run_hash(
        &candidate,
        v["job"].as_str().unwrap_or("source-relocate"),
        events,
    )?;
    if hash.as_ref().is_some_and(|h| h != &candidate_hash) {
        return Err(err("source_mismatch", "O arquivo não corresponde à Fonte"));
    }
    if partial(&candidate)? != (size as u64, part) {
        return Err(err("source_changed", "A Fonte foi alterada"));
    }
    let path = candidate
        .canonicalize()
        .map_err(|_| err("source_unavailable", "Fonte indisponível"))?;
    let conn = writer(&v)?;
    conn.execute(
        "UPDATE sources SET path=?1,full_hash=?2 WHERE id=?3",
        params![path.to_string_lossy(), candidate_hash, id],
    )
    .map_err(|_| err("source_save", "Não foi possível relocalizar a Fonte"))?;
    drop(conn);
    get(&v, id)
}
inventory::submit! {CommandRegistration{name:"sources.import",execute:import}}
inventory::submit! {CommandRegistration{name:"sources.inspect",execute:inspect}}
inventory::submit! {CommandRegistration{name:"sources.list",execute:list}}
inventory::submit! {CommandRegistration{name:"sources.hash",execute:hash_source}}
inventory::submit! {CommandRegistration{name:"sources.relocate",execute:relocate}}
inventory::submit! {CommandRegistration{name:"sources.cancel",execute:cancel}}
