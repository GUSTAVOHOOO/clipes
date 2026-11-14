use crate::{projects, CommandRegistration, CommandResult, EventSink};
use serde_json::{json, Value};

#[derive(Clone, Copy)]
pub enum Safety {
    Local,
    Paid,
}

pub fn enqueue(kind: &str, safety: Safety) -> Result<i64, crate::CoreError> {
    let safety = match safety {
        Safety::Local => "local",
        Safety::Paid => "paid",
    };
    projects::with_writer(|c| {
        c.execute(
            "INSERT INTO jobs(kind,safety,state) VALUES (?1,?2,'queued')",
            (kind, safety),
        )?;
        Ok(c.last_insert_rowid())
    })
}

pub fn begin(id: i64) -> Result<bool, crate::CoreError> {
    projects::with_writer(|c| {
        Ok(c.execute(
            "UPDATE jobs SET state='running',attempts=attempts+1 WHERE id=?1 AND state='queued'",
            [id],
        )? == 1)
    })
}

pub fn checkpoint(id: i64, checkpoint: &str) -> Result<(), crate::CoreError> {
    projects::with_writer(|c| {
        c.execute(
            "UPDATE jobs SET checkpoint=?2 WHERE id=?1 AND state='running'",
            (id, checkpoint),
        )?;
        Ok(())
    })
}

inventory::submit! { projects::Migration { id: "0044_001_jobs", sql: "CREATE TABLE jobs (id INTEGER PRIMARY KEY, kind TEXT NOT NULL, safety TEXT NOT NULL CHECK(safety IN ('local','paid')), state TEXT NOT NULL CHECK(state IN ('queued','running','uncertain','completed','cancelled','failed')), attempts INTEGER NOT NULL DEFAULT 0, checkpoint TEXT, progress INTEGER NOT NULL DEFAULT 0);" } }

pub(crate) fn reconcile() -> Result<(), crate::CoreError> {
    projects::with_writer(|c| {
        c.execute("UPDATE jobs SET state=CASE safety WHEN 'local' THEN 'queued' ELSE 'uncertain' END WHERE state='running'", [])?;
        Ok(())
    })
}

fn list(_: Value, _: &mut EventSink<'_>) -> CommandResult {
    projects::with_reader(|c| {
        let mut s = c.prepare("SELECT id,kind,safety,state,attempts,checkpoint,progress FROM jobs ORDER BY id")?;
        let rows = s.query_map([], |r| Ok(json!({"id":r.get::<_,i64>(0)?,"kind":r.get::<_,String>(1)?,"safety":r.get::<_,String>(2)?,"state":r.get::<_,String>(3)?,"attempts":r.get::<_,i64>(4)?,"checkpoint":r.get::<_,Option<String>>(5)?,"progress":r.get::<_,i64>(6)?})))?;
        rows.collect::<rusqlite::Result<Vec<_>>>()
    }).map(|v| json!(v))
}
inventory::submit! { CommandRegistration { name: "jobs.list", execute: list } }
