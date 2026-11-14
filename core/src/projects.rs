use crate::{CommandRegistration, CommandResult, CoreError, EventSink};
use rusqlite::{backup::Backup, Connection, OpenFlags};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::{
    fs,
    path::{Path, PathBuf},
    time::Duration,
};

mod backups;
pub use backups::{start_job, with_reader, with_writer, ProjectJob};

fn error(code: &str, e: impl ToString) -> CoreError {
    CoreError {
        code: code.into(),
        message: e.to_string(),
    }
}

// Each migration is independently registered so parallel tickets need not edit a central list.
pub struct Migration {
    pub id: &'static str,
    pub sql: &'static str,
}
inventory::collect!(Migration);
inventory::submit! { Migration { id: "0033_001_project", sql: "CREATE TABLE project (name TEXT NOT NULL);" } }

#[derive(Serialize, Deserialize)]
struct Recent {
    name: String,
    path: PathBuf,
}
fn library() -> Result<PathBuf, CoreError> {
    if let Some(dir) = std::env::var_os("CLIPES_DATA_DIR") {
        return Ok(PathBuf::from(dir).join("projects.json"));
    }
    Ok(dirs::data_local_dir()
        .ok_or_else(|| error("library", "Diretório de dados indisponível"))?
        .join("Clipes/projects.json"))
}
fn read_library(path: &Path) -> Result<Vec<Recent>, CoreError> {
    match fs::read(path) {
        Ok(b) => serde_json::from_slice(&b).map_err(|e| error("library", e)),
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(vec![]),
        Err(e) => Err(error("library", e)),
    }
}
fn remember(path: &Path, project: Recent) -> Result<(), CoreError> {
    let mut items = read_library(path)?;
    items.retain(|p| p.path != project.path);
    items.insert(0, project);
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent).map_err(|e| error("library", e))?;
    }
    fs::write(
        path,
        serde_json::to_vec_pretty(&items).map_err(|e| error("library", e))?,
    )
    .map_err(|e| error("library", e))
}
fn backup(conn: &Connection, path: &Path) -> Result<(), CoreError> {
    let mut target = Connection::open(path).map_err(|e| error("backup", e))?;
    {
        let backup = Backup::new(conn, &mut target).map_err(|e| error("backup", e))?;
        backup
            .run_to_completion(100, Duration::from_millis(10), None)
            .map_err(|e| error("backup", e))?;
    }
    let check: String = target
        .query_row("PRAGMA integrity_check", [], |r| r.get(0))
        .map_err(|e| error("backup", e))?;
    if check != "ok" {
        return Err(error("backup", check));
    }
    Ok(())
}
fn migrate(conn: &mut Connection, path: &Path) -> Result<(), CoreError> {
    let mut migrations: Vec<_> = inventory::iter::<Migration>.into_iter().collect();
    migrations.sort_by_key(|m| m.id);
    if migrations.windows(2).any(|p| p[0].id == p[1].id) {
        return Err(error("migration", "Identificador de migração duplicado"));
    }
    let exists: bool = conn.query_row("SELECT EXISTS(SELECT 1 FROM sqlite_master WHERE type='table' AND name='schema_migrations')", [], |r| r.get(0)).map_err(|e| error("migration", e))?;
    let applied: Vec<String> = if exists {
        let mut stmt = conn
            .prepare("SELECT id FROM schema_migrations")
            .map_err(|e| error("migration", e))?;
        let rows = stmt
            .query_map([], |r| r.get(0))
            .map_err(|e| error("migration", e))?;
        rows.collect::<Result<_, _>>()
            .map_err(|e| error("migration", e))?
    } else {
        vec![]
    };
    if applied
        .iter()
        .any(|id| !migrations.iter().any(|m| m.id == id))
    {
        return Err(error(
            "newer_project",
            "Projeto criado por uma versão mais nova do Clipes",
        ));
    }
    let pending: Vec<_> = migrations
        .into_iter()
        .filter(|m| !applied.iter().any(|id| id == m.id))
        .collect();
    if !pending.is_empty() {
        let has_tables: bool = conn
            .query_row(
                "SELECT EXISTS(SELECT 1 FROM sqlite_master WHERE type='table')",
                [],
                |r| r.get(0),
            )
            .map_err(|e| error("migration", e))?;
        if has_tables {
            backup(conn, &path.join("project.pre-migration.sqlite"))?;
        }
        let tx = conn.transaction().map_err(|e| error("migration", e))?;
        tx.execute_batch(
            "CREATE TABLE IF NOT EXISTS schema_migrations (id TEXT PRIMARY KEY NOT NULL);",
        )
        .map_err(|e| error("migration", e))?;
        for m in pending {
            tx.execute_batch(m.sql).map_err(|e| error("migration", e))?;
            tx.execute("INSERT INTO schema_migrations (id) VALUES (?1)", [m.id])
                .map_err(|e| error("migration", e))?;
        }
        tx.commit().map_err(|e| error("migration", e))?;
    }
    Ok(())
}
fn open_db(path: &Path) -> Result<Connection, CoreError> {
    let db = path.join("project.sqlite");
    let mut conn = Connection::open_with_flags(db, OpenFlags::SQLITE_OPEN_READ_WRITE)
        .map_err(|e| error("project_open", e))?;
    migrate(&mut conn, path)?;
    conn.pragma_update(None, "journal_mode", "WAL")
        .map_err(|e| error("project_open", e))?;
    Ok(conn)
}
fn open(v: Value, _: &mut EventSink<'_>) -> CommandResult {
    let path = PathBuf::from(
        v["path"]
            .as_str()
            .ok_or_else(|| error("invalid_project", "Pasta obrigatória"))?,
    );
    if path.extension().and_then(|s| s.to_str()) != Some("clipes") {
        return Err(error("invalid_project", "Escolha uma pasta .clipes"));
    }
    let path = path.canonicalize().map_err(|e| error("project_open", e))?;
    let name = backups::open_session(path.clone())?;
    remember(
        &library()?,
        Recent {
            name: name.clone(),
            path: path.clone(),
        },
    )?;
    Ok(json!({"name": name, "path":path}))
}
fn create(v: Value, events: &mut EventSink<'_>) -> CommandResult {
    let name = v["name"].as_str().unwrap_or("").trim();
    if name.is_empty() || name == "." || name == ".." || name.contains(['/', '\\', ':']) {
        return Err(error("invalid_project", "Nome de Projeto inválido"));
    }
    let parent = PathBuf::from(
        v["parent"]
            .as_str()
            .ok_or_else(|| error("invalid_project", "Pasta de destino obrigatória"))?,
    );
    let path = parent.join(format!("{name}.clipes"));
    fs::create_dir(&path).map_err(|e| error("project_create", e))?;
    let result = (|| {
        let mut conn = Connection::open(path.join("project.sqlite"))
            .map_err(|e| error("project_create", e))?;
        migrate(&mut conn, &path)?;
        conn.execute("INSERT INTO project (name) VALUES (?1)", [name])
            .map_err(|e| error("project_create", e))?;
        drop(conn);
        open(json!({"path":path}), events)
    })();
    result
}
fn recent(_: Value, _: &mut EventSink<'_>) -> CommandResult {
    let items = read_library(&library()?)?;
    Ok(json!(items.into_iter().map(|p| json!({"available":p.path.join("project.sqlite").is_file(),"name":p.name,"path":p.path})).collect::<Vec<_>>()))
}
inventory::submit! { CommandRegistration { name:"projects.create", execute:create } }
inventory::submit! { CommandRegistration { name:"projects.open", execute:open } }
inventory::submit! { CommandRegistration { name:"projects.recent", execute:recent } }

/// Time in integer microseconds.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub struct Microseconds(pub i64);

pub struct DocumentType {
    pub name: &'static str,
    pub current_version: u64,
    pub validate: fn(&Value) -> Result<(), CoreError>,
}
pub struct DocumentMigration {
    pub kind: &'static str,
    pub from_version: u64,
    pub migrate: fn(Value) -> Result<Value, CoreError>,
}
inventory::collect!(DocumentType);
inventory::collect!(DocumentMigration);
fn validate_envelope(doc: &Value) -> Result<(), CoreError> {
    if !doc.is_object() || doc.get("revision").and_then(Value::as_u64).is_none() {
        return Err(error(
            "invalid_document",
            "revision deve ser um inteiro não negativo",
        ));
    }
    Ok(())
}
inventory::submit! { DocumentType { name:"clip", current_version:1, validate:validate_envelope } }
inventory::submit! { DocumentType { name:"style", current_version:1, validate:validate_envelope } }
inventory::submit! { DocumentType { name:"script", current_version:1, validate:validate_envelope } }
inventory::submit! { DocumentType { name:"packaging", current_version:1, validate:validate_envelope } }
fn document(v: Value, _: &mut EventSink<'_>) -> CommandResult {
    let kind = v["type"].as_str().unwrap_or("");
    let spec = inventory::iter::<DocumentType>
        .into_iter()
        .find(|d| d.name == kind)
        .ok_or_else(|| error("invalid_document", "Tipo de documento desconhecido"))?;
    let mut doc = v["document"].clone();
    let mut version = doc
        .get("schemaVersion")
        .and_then(Value::as_u64)
        .ok_or_else(|| error("invalid_document", "schemaVersion inválida"))?;
    if version > spec.current_version {
        return Err(error(
            "newer_document",
            "Documento criado por uma versão mais nova",
        ));
    }
    while version < spec.current_version {
        let migration = inventory::iter::<DocumentMigration>
            .into_iter()
            .find(|m| m.kind == kind && m.from_version == version)
            .ok_or_else(|| error("invalid_document", "Migração de documento indisponível"))?;
        doc = (migration.migrate)(doc)?;
        let next = doc
            .get("schemaVersion")
            .and_then(Value::as_u64)
            .ok_or_else(|| error("invalid_document", "Migração retornou versão inválida"))?;
        if next != version + 1 {
            return Err(error(
                "invalid_document",
                "Migração retornou versão inválida",
            ));
        }
        version = next;
    }
    (spec.validate)(&doc)?;
    Ok(doc)
}
inventory::submit! { CommandRegistration { name:"documents.validate", execute:document } }
