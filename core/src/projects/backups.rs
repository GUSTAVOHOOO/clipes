use super::*;
use rusqlite::OptionalExtension;
use std::{
    sync::{
        mpsc::{self, RecvTimeoutError, Sender},
        Mutex, OnceLock,
    },
    thread,
    time::{SystemTime, UNIX_EPOCH},
};

const INTERVAL: u64 = 1800;
const COPIES: u64 = 10;
inventory::submit! { Migration { id: "0037_001_backup_settings", sql: "CREATE TABLE backup_settings (id INTEGER PRIMARY KEY CHECK(id=1), interval_seconds INTEGER NOT NULL, copies INTEGER NOT NULL);" } }
struct Session {
    path: PathBuf,
    name: String,
    conn: Option<Connection>,
    dirty: bool,
    warning: Option<CoreError>,
    stop: Sender<()>,
    jobs: usize,
}
fn state() -> &'static Mutex<Option<Session>> {
    static STATE: OnceLock<Mutex<Option<Session>>> = OnceLock::new();
    STATE.get_or_init(|| Mutex::new(None))
}
fn fixed(code: &str, msg: &str) -> CoreError {
    error(code, msg)
}
fn failure() -> CoreError {
    fixed(
        "backup_failed",
        "Não foi possível criar o backup do Projeto.",
    )
}
fn invalid() -> CoreError {
    fixed(
        "backup_invalid",
        "O backup não é íntegro ou é incompatível.",
    )
}
fn closed() -> CoreError {
    fixed("project_not_open", "Nenhum Projeto está aberto.")
}
fn busy() -> CoreError {
    fixed("project_busy", "Há uma tarefa ativa no Projeto.")
}
fn session(s: &mut Option<Session>) -> Result<&mut Session, CoreError> {
    s.as_mut().ok_or_else(closed)
}

/// Read from the current Project without marking it as changed.
pub fn with_reader<T>(f: impl FnOnce(&Connection) -> rusqlite::Result<T>) -> Result<T, CoreError> {
    let mut guard = state().lock().map_err(|_| busy())?;
    let s = session(&mut guard)?;
    f(s.conn.as_ref().ok_or_else(closed)?)
        .map_err(|_| fixed("project_read", "Não foi possível ler o Projeto."))
}

/// All Project writes must use this function, including writes made by jobs.
pub fn with_writer<T>(
    f: impl FnOnce(&mut Connection) -> rusqlite::Result<T>,
) -> Result<T, CoreError> {
    let mut guard = state().lock().map_err(|_| busy())?;
    let s = session(&mut guard)?;
    s.dirty = true;
    f(s.conn.as_mut().ok_or_else(closed)?)
        .map_err(|_| fixed("project_write", "Não foi possível salvar o Projeto."))
}
/// A job holds this guard while it needs its Project to remain open.
pub struct ProjectJob;
pub fn start_job() -> Result<ProjectJob, CoreError> {
    let mut g = state().lock().map_err(|_| busy())?;
    session(&mut g)?.jobs += 1;
    Ok(ProjectJob)
}
impl Drop for ProjectJob {
    fn drop(&mut self) {
        if let Ok(mut g) = state().lock() {
            if let Some(s) = g.as_mut() {
                s.jobs = s.jobs.saturating_sub(1);
            }
        }
    }
}
fn settings(c: &Connection) -> Result<(u64, u64), CoreError> {
    c.query_row(
        "SELECT interval_seconds,copies FROM backup_settings LIMIT 1",
        [],
        |r| Ok((r.get(0)?, r.get(1)?)),
    )
    .optional()
    .map(|row| row.unwrap_or((INTERVAL, COPIES)))
    .map_err(|_| failure())
}
fn is_id(name: &str, prefix: &str) -> bool {
    name.strip_prefix(prefix)
        .and_then(|s| s.strip_suffix(".sqlite"))
        .is_some_and(|s| s.len() == 39 && s.bytes().all(|c| c.is_ascii_digit()))
}
fn paths(path: &Path) -> Result<Vec<PathBuf>, CoreError> {
    let entries = match fs::read_dir(path.join("backups")) {
        Ok(v) => v,
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => return Ok(vec![]),
        Err(_) => return Err(failure()),
    };
    let mut out = vec![];
    for e in entries {
        let e = e.map_err(|_| failure())?;
        let name = e.file_name();
        let name = name.to_string_lossy();
        if is_id(&name, "backup-") && e.file_type().map_err(|_| failure())?.is_file() {
            out.push(e.path());
        }
    }
    out.sort();
    out.reverse();
    Ok(out)
}
fn verify(c: &Connection) -> Result<(), CoreError> {
    let mut q = c.prepare("PRAGMA integrity_check").map_err(|_| invalid())?;
    let lines = q
        .query_map([], |r| r.get::<_, String>(0))
        .map_err(|_| invalid())?
        .collect::<Result<Vec<_>, _>>()
        .map_err(|_| invalid())?;
    if lines != ["ok"] {
        return Err(invalid());
    }
    let mut q = c
        .prepare("PRAGMA foreign_key_check")
        .map_err(|_| invalid())?;
    if q.query([])
        .map_err(|_| invalid())?
        .next()
        .map_err(|_| invalid())?
        .is_some()
    {
        return Err(invalid());
    }
    Ok(())
}
fn unique(prefix: &str) -> String {
    format!(
        "{}-{:039}.sqlite",
        prefix,
        SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap_or_default()
            .as_nanos()
    )
}
fn take(s: &mut Session) -> Result<(), CoreError> {
    let dir = s.path.join("backups");
    fs::create_dir_all(&dir).map_err(|_| failure())?;
    let target = dir.join(unique("backup"));
    let result = (|| {
        super::backup(s.conn.as_ref().ok_or_else(closed)?, &target).map_err(|_| failure())?;
        let c = Connection::open_with_flags(&target, OpenFlags::SQLITE_OPEN_READ_ONLY)
            .map_err(|_| failure())?;
        verify(&c).map_err(|_| failure())
    })();
    if result.is_err() {
        let _ = fs::remove_file(&target);
        return result;
    }
    s.dirty = false;
    s.warning = None;
    let count = settings(s.conn.as_ref().ok_or_else(closed)?)?.1 as usize;
    for p in paths(&s.path)?
        .into_iter()
        .filter(|p| p != &target)
        .skip(count.saturating_sub(1))
    {
        fs::remove_file(p).map_err(|_| failure())?;
    }
    Ok(())
}
fn due(s: &Session) -> Result<bool, CoreError> {
    let secs = settings(s.conn.as_ref().ok_or_else(closed)?)?.0;
    let Some(last) = paths(&s.path)?.first().cloned() else {
        return Ok(true);
    };
    let modified = fs::metadata(last)
        .and_then(|m| m.modified())
        .map_err(|_| failure())?;
    Ok(modified.elapsed().unwrap_or_default() >= Duration::from_secs(secs))
}
fn try_backup(s: &mut Session) {
    if let Err(e) = take(s) {
        s.warning = Some(e);
    }
}
pub(super) fn open_session(path: PathBuf) -> Result<String, CoreError> {
    let mut g = state().lock().map_err(|_| busy())?;
    if g.as_ref().is_some_and(|s| s.jobs > 0) {
        return Err(busy());
    }
    if let Some(old) = g.take() {
        let _ = old.stop.send(());
    }
    let conn = super::open_db(&path)?;
    let name: String = conn
        .query_row("SELECT name FROM project LIMIT 1", [], |r| r.get(0))
        .map_err(|_| fixed("invalid_project", "Projeto inválido."))?;
    let result_name = name.clone();
    let (stop, rx) = mpsc::channel();
    let mut s = Session {
        path,
        name,
        conn: Some(conn),
        dirty: false,
        warning: None,
        stop,
        jobs: 0,
    };
    match due(&s) {
        Ok(true) => try_backup(&mut s),
        Ok(false) => (),
        Err(e) => s.warning = Some(e),
    }
    *g = Some(s);
    thread::spawn(move || loop {
        match rx.recv_timeout(Duration::from_secs(1)) {
            Err(RecvTimeoutError::Timeout) => {
                let Ok(mut g) = state().lock() else { break };
                if rx.try_recv().is_ok() {
                    break;
                }
                if let Some(s) = g.as_mut() {
                    if s.dirty {
                        match due(s) {
                            Ok(true) => try_backup(s),
                            Ok(false) => (),
                            Err(e) => s.warning = Some(e),
                        }
                    }
                }
            }
            _ => break,
        }
    });
    Ok(result_name)
}
fn current(_: Value, _: &mut EventSink<'_>) -> CommandResult {
    let g = state().lock().map_err(|_| busy())?;
    Ok(match g.as_ref() {
        Some(s) => json!({"name":s.name,"path":s.path,"warning":s.warning}),
        None => Value::Null,
    })
}
fn close(_: Value, _: &mut EventSink<'_>) -> CommandResult {
    let mut g = state().lock().map_err(|_| busy())?;
    if g.as_ref().is_some_and(|s| s.jobs > 0) {
        return Err(busy());
    }
    if let Some(s) = g.take() {
        let _ = s.stop.send(());
    }
    Ok(Value::Null)
}
fn config_get(_: Value, _: &mut EventSink<'_>) -> CommandResult {
    let mut g = state().lock().map_err(|_| busy())?;
    let s = session(&mut g)?;
    let (interval_seconds, copies) = settings(s.conn.as_ref().ok_or_else(closed)?)?;
    Ok(
        json!({"interval_seconds":interval_seconds,"copies":copies,"default_interval_seconds":INTERVAL,"default_copies":COPIES,"warning":s.warning}),
    )
}
fn config_set(v: Value, _: &mut EventSink<'_>) -> CommandResult {
    let secs = v["interval_seconds"]
        .as_u64()
        .filter(|v| *v > 0 && *v <= i64::MAX as u64)
        .ok_or_else(|| fixed("backup_settings", "Intervalo inválido."))?;
    let copies = v["copies"]
        .as_u64()
        .filter(|v| *v > 0 && *v <= i64::MAX as u64)
        .ok_or_else(|| fixed("backup_settings", "Número de cópias inválido."))?;
    with_writer(|c| {
        c.execute(
            "INSERT INTO backup_settings (id,interval_seconds,copies) VALUES (1,?1,?2) ON CONFLICT(id) DO UPDATE SET interval_seconds=excluded.interval_seconds,copies=excluded.copies",
            (secs as i64, copies as i64),
        )?;
        Ok(())
    })?;
    Ok(Value::Null)
}
fn create(_: Value, _: &mut EventSink<'_>) -> CommandResult {
    let mut g = state().lock().map_err(|_| busy())?;
    take(session(&mut g)?)?;
    Ok(Value::Null)
}
fn list(_: Value, _: &mut EventSink<'_>) -> CommandResult {
    let mut g = state().lock().map_err(|_| busy())?;
    let s = session(&mut g)?;
    let mut all = paths(&s.path)?;
    let dir = s.path.join("backups");
    if dir.exists() {
        for entry in fs::read_dir(dir).map_err(|_| failure())? {
            let entry = entry.map_err(|_| failure())?;
            let name = entry.file_name();
            let name = name.to_string_lossy();
            if is_id(&name, "before-restore-")
                && entry.file_type().map_err(|_| failure())?.is_file()
            {
                all.push(entry.path());
            }
        }
    }
    all.sort_by_key(|p| std::cmp::Reverse(p.metadata().and_then(|m| m.modified()).ok()));
    Ok(json!(all.iter().filter_map(|p| { let id = p.file_name()?.to_str()?; let time = p.metadata().ok()?.modified().ok()?.duration_since(UNIX_EPOCH).ok()?.as_secs(); Some(json!({"id":id,"created_at":time,"before_restore":id.starts_with("before-restore-")})) }).collect::<Vec<_>>()))
}
fn restore(v: Value, _: &mut EventSink<'_>) -> CommandResult {
    let id = v["id"]
        .as_str()
        .filter(|id| is_id(id, "backup-") || is_id(id, "before-restore-"))
        .ok_or_else(invalid)?;
    let mut g = state().lock().map_err(|_| busy())?;
    let s = session(&mut g)?;
    if s.jobs > 0 {
        return Err(busy());
    }
    let source = s.path.join("backups").join(id);
    if !fs::symlink_metadata(&source)
        .map(|m| m.file_type().is_file())
        .unwrap_or(false)
    {
        return Err(invalid());
    }
    let temp = s.path.join(unique("restore-staging"));
    fs::copy(source, &temp).map_err(|_| invalid())?;
    let checked = (|| {
        let c = Connection::open_with_flags(&temp, OpenFlags::SQLITE_OPEN_READ_ONLY)
            .map_err(|_| invalid())?;
        verify(&c)?;
        let name: String = c
            .query_row("SELECT name FROM project LIMIT 1", [], |r| r.get(0))
            .map_err(|_| invalid())?;
        let mut q = c
            .prepare("SELECT id FROM schema_migrations")
            .map_err(|_| invalid())?;
        let ids = q
            .query_map([], |r| r.get::<_, String>(0))
            .map_err(|_| invalid())?
            .collect::<Result<Vec<_>, _>>()
            .map_err(|_| invalid())?;
        if ids
            .iter()
            .any(|id| !inventory::iter::<Migration>.into_iter().any(|m| m.id == id))
        {
            return Err(invalid());
        }
        Ok(name)
    })();
    let name = match checked {
        Ok(n) => n,
        Err(e) => {
            let _ = fs::remove_file(&temp);
            return Err(e);
        }
    };
    let preservation = s.path.join("backups").join(unique("before-restore"));
    if super::backup(s.conn.as_ref().ok_or_else(closed)?, &preservation).is_err() {
        let _ = fs::remove_file(&temp);
        return Err(failure());
    }
    let db = s.path.join("project.sqlite");
    let old = s.path.join(unique("restore-previous"));
    drop(s.conn.take());
    if fs::rename(&db, &old)
        .and_then(|_| fs::rename(&temp, &db))
        .is_err()
    {
        if !db.exists() {
            let _ = fs::rename(&old, &db);
        }
        s.conn = super::open_db(&s.path).ok();
        let _ = fs::remove_file(&temp);
        return Err(fixed(
            "restore_failed",
            "Não foi possível restaurar o backup.",
        ));
    }
    match super::open_db(&s.path) {
        Ok(c) => {
            s.conn = Some(c);
            s.name = name;
            s.dirty = false;
            let _ = fs::remove_file(old);
            Ok(Value::Null)
        }
        Err(_) => {
            let _ = fs::rename(&db, &temp);
            let _ = fs::rename(&old, &db);
            s.conn = super::open_db(&s.path).ok();
            let _ = fs::remove_file(temp);
            Err(fixed(
                "restore_failed",
                "Não foi possível restaurar o backup.",
            ))
        }
    }
}
inventory::submit! { CommandRegistration { name:"projects.current", execute:current } }
inventory::submit! { CommandRegistration { name:"projects.close", execute:close } }
inventory::submit! { CommandRegistration { name:"backups.settings.get", execute:config_get } }
inventory::submit! { CommandRegistration { name:"backups.settings.set", execute:config_set } }
inventory::submit! { CommandRegistration { name:"backups.create", execute:create } }
inventory::submit! { CommandRegistration { name:"backups.list", execute:list } }
inventory::submit! { CommandRegistration { name:"backups.restore", execute:restore } }
