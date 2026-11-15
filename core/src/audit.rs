//! Leitura da trilha de auditoria do Projeto (#125; ADR-0009, regras 7 a 10) e os dois campos
//! que ela acrescenta ao diagnóstico (ADR-0006, emenda de 14/11/2026).
//!
//! A tabela `call_audit` é escrita no ponto que grava a linha de custo (`cost::record_call`) e,
//! para o áudio pago do Groq, no ponto que grava a linha de `transcription_calls`. Aqui só se lê.
//! Nenhum texto de prompt, Transcrição ou Roteiro passa por esta tela.
use crate::{
    diagnostic::{DiagnosticField, DiagnosticKind},
    projects, CommandRegistration, CommandResult, CoreError, EventSink,
};
use serde_json::{json, Value};

/// As linhas da trilha, da mais antiga para a mais nova. Tarefa, versão, modelo e resultado vêm
/// da linha de custo ligada (`provider_costs`) ou da chamada de transcrição; a trilha só soma o
/// que faltava. `job` filtra por job; sem ele devolve todas.
fn list(v: Value, _: &mut EventSink<'_>) -> CommandResult {
    let job = v["job"].as_i64();
    let rows = projects::with_reader(|c| {
        let mut s = c.prepare(
            "SELECT a.id,a.provider_kind,a.host,COALESCE(c.model,a.model),a.prompt_sha256,a.input_sha256,a.sent_bytes,a.response_sha256,c.task,c.task_version,c.outcome,c.id,t.id,COALESCE(c.job_id,t.job_id),t.state \
             FROM call_audit a LEFT JOIN provider_costs c ON c.id=a.cost_id LEFT JOIN transcription_calls t ON t.id=a.transcription_call_id \
             WHERE ?1 IS NULL OR COALESCE(c.job_id,t.job_id)=?1 ORDER BY a.id",
        )?;
        let rows = s.query_map([job], |r| {
            Ok(json!({
                "id": r.get::<_, i64>(0)?,
                "providerKind": r.get::<_, String>(1)?,
                "host": r.get::<_, Option<String>>(2)?,
                "model": r.get::<_, Option<String>>(3)?,
                "promptSha256": r.get::<_, Option<String>>(4)?,
                "inputSha256": r.get::<_, Option<String>>(5)?,
                "sentBytes": r.get::<_, Option<i64>>(6)?,
                "responseSha256": r.get::<_, Option<String>>(7)?,
                "task": r.get::<_, Option<String>>(8)?,
                "taskVersion": r.get::<_, Option<i64>>(9)?,
                "outcome": r.get::<_, Option<String>>(10)?.or(r.get::<_, Option<String>>(14)?),
                "costId": r.get::<_, Option<i64>>(11)?,
                "transcriptionCallId": r.get::<_, Option<i64>>(12)?,
                "job": r.get::<_, Option<i64>>(13)?,
            }))
        })?;
        rows.collect::<rusqlite::Result<Vec<_>>>()
    })?;
    Ok(json!(rows))
}
inventory::submit! { CommandRegistration { name: "provider.audit.list", execute: list } }

/// A chamada de IA que o diagnóstico descreve: a última que falhou; sem falha, a última.
fn latest(column: &str) -> Result<Option<Value>, CoreError> {
    projects::with_reader(|c| {
        let sql = format!(
            "SELECT {column} FROM provider_costs c JOIN call_audit a ON a.cost_id=c.id \
             WHERE c.task_version IS NOT NULL AND a.prompt_sha256 IS NOT NULL \
             ORDER BY (c.outcome IS NOT NULL AND c.outcome<>'ok') DESC, c.id DESC LIMIT 1"
        );
        match c.query_row(&sql, [], |r| r.get::<_, Value2>(0)) {
            Ok(v) => Ok(Some(v.0)),
            Err(rusqlite::Error::QueryReturnedNoRows) => Ok(None),
            Err(e) => Err(e),
        }
    })
}
struct Value2(Value);
impl rusqlite::types::FromSql for Value2 {
    fn column_result(v: rusqlite::types::ValueRef<'_>) -> rusqlite::types::FromSqlResult<Self> {
        Ok(Self(match v {
            rusqlite::types::ValueRef::Integer(i) => json!(i),
            rusqlite::types::ValueRef::Text(t) => json!(String::from_utf8_lossy(t)),
            _ => Value::Null,
        }))
    }
}

/// O banco pode vir de um Projeto compartilhado: só números e hex de 64 caracteres saem.
fn task_version_diagnostic() -> String {
    latest("c.task_version")
        .ok()
        .flatten()
        .and_then(|v| v.as_i64())
        .filter(|n| (0..=i64::from(u32::MAX)).contains(n))
        .map_or_else(|| "indisponível".into(), |n| n.to_string())
}
fn prompt_hash_diagnostic() -> String {
    latest("a.prompt_sha256")
        .ok()
        .flatten()
        .and_then(|v| v.as_str().map(str::to_owned))
        .filter(|h| h.len() == 64 && h.bytes().all(|b| matches!(b, b'0'..=b'9' | b'a'..=b'f')))
        .unwrap_or_else(|| "indisponível".into())
}
inventory::submit! { DiagnosticField { kind: DiagnosticKind::TaskVersion, value: task_version_diagnostic } }
inventory::submit! { DiagnosticField { kind: DiagnosticKind::PromptHash, value: prompt_hash_diagnostic } }
