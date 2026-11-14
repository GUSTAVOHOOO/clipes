//! "Somente local" como veto por Projeto (#123, ADR-0010 regra 5).
//!
//! O sinalizador mora no `project.sqlite` (viaja com o Projeto portátil e entra nos backups).
//! O Projeto não escolhe Provedor: só proíbe. Nada daqui vai para log ou diagnóstico.
use super::{with_reader, with_writer, Migration};
use crate::{CommandRegistration, CommandResult, CoreError, EventSink};
use serde_json::{json, Value};

inventory::submit! { Migration { id: "0123_001_project_local_only", sql: "CREATE TABLE project_privacy (id INTEGER PRIMARY KEY CHECK(id=1), local_only INTEGER NOT NULL DEFAULT 0 CHECK(local_only IN (0,1))); INSERT INTO project_privacy (id, local_only) VALUES (1, 0);" } }

/// Whether the open Project vetoes sending text off the machine. With no Project open the veto
/// does not apply (only the per-task setting does). Any other failure stays an error, so the
/// caller refuses instead of guessing: a veto that cannot be read must not let text out.
pub(crate) fn project_local_only() -> Result<bool, CoreError> {
    match with_reader(|c| {
        c.query_row(
            "SELECT local_only FROM project_privacy WHERE id=1",
            [],
            |r| r.get::<_, i64>(0),
        )
    }) {
        Ok(v) => Ok(v != 0),
        Err(e) if e.code == "project_not_open" => Ok(false),
        Err(e) => Err(e),
    }
}

fn get(_: Value, _: &mut EventSink<'_>) -> CommandResult {
    let open = match with_reader(|_| Ok(())) {
        Ok(()) => true,
        Err(e) if e.code == "project_not_open" => false,
        Err(e) => return Err(e),
    };
    Ok(json!({"open": open, "enabled": project_local_only()?}))
}

fn set(v: Value, _: &mut EventSink<'_>) -> CommandResult {
    let enabled = v["enabled"].as_bool().ok_or_else(|| CoreError {
        code: "invalid_request".into(),
        message: "Valor inválido para o veto do Projeto.".into(),
        usage: None,
    })?;
    with_writer(|c| {
        c.execute(
            "INSERT INTO project_privacy (id, local_only) VALUES (1, ?1) ON CONFLICT(id) DO UPDATE SET local_only=excluded.local_only",
            [enabled as i64],
        )?;
        Ok(())
    })?;
    Ok(json!({"open": true, "enabled": enabled}))
}

inventory::submit! { CommandRegistration { name: "projects.local_only.get", execute: get } }
inventory::submit! { CommandRegistration { name: "projects.local_only.set", execute: set } }
