//! "Refazer com o perfil X" para uma unidade de Tarefa de IA (#126; ADR-0010, regra 4).
//!
//! É o comando genérico: vale para qualquer job `ai:<tarefa>` (uma Janela de seleção, e no
//! futuro um bloco do Roteiro, #73). O usuário escolhe **outro** Perfil de Provedor; a
//! unidade é enfileirada de novo com o mesmo pedido e esse perfil, só nesta execução. Nada
//! aqui troca perfil sozinho nem muda o padrão do app ou da Tarefa, e a rota passa pelo veto
//! "somente local" (por tarefa e por Projeto) antes de qualquer rede. Um job `uncertain` nunca
//! é refeito por aqui: antes o usuário resolve a incerteza (ADR-0005).
use super::{ai, enqueue_checked, estimate_units, resolve_route, EnqueueAiRequest};
use crate::{
    ai_task::TaskInput,
    projects, CommandRegistration, CommandResult, CoreError, EventSink,
};
use serde_json::{json, Value};

const CONFIRMATION_MESSAGE: &str = "Refazer com este perfil envia o texto a um Provedor pago: confirme o perfil e o custo estimado antes de começar.";

fn error(code: &str, message: &str) -> CoreError {
    CoreError {
        code: code.into(),
        message: message.into(),
        usage: None,
    }
}

/// O pedido de uma unidade já enfileirada: tarefa, entrada e lote, lidos do próprio job.
pub struct Source {
    pub task: String,
    pub input: TaskInput,
    pub batch: Option<String>,
}

/// Lê o pedido do job `id` para refazê-lo. Só uma unidade de IA concluída, falha ou cancelada
/// pode ser refeita: `uncertain` tem erro tipado próprio, e na fila ou rodando está ocupada.
pub fn source(id: i64) -> Result<Source, CoreError> {
    let state: String = projects::with_reader(|c| {
        c.query_row(
            "SELECT CASE WHEN kind LIKE 'ai:%' THEN state ELSE 'not_ai' END FROM jobs WHERE id=?1",
            [id],
            |r| r.get(0),
        )
    })
    .map_err(|_| error("invalid_job", "Tarefa inválida."))?;
    match state.as_str() {
        "completed" | "failed" | "cancelled" => {}
        "uncertain" => {
            return Err(error(
                "job_uncertain",
                "Esta chamada tem resultado incerto: resolva a incerteza antes de refazer com outro perfil.",
            ))
        }
        "not_ai" => return Err(error("invalid_job", "Tarefa inválida.")),
        _ => {
            return Err(error(
                "job_not_redoable",
                "Só uma unidade concluída, que falhou ou foi cancelada pode ser refeita.",
            ))
        }
    }
    let unit = ai::load(id)?;
    Ok(Source {
        task: unit.task.id.to_owned(),
        input: unit.input,
        batch: unit.batch,
    })
}

fn profile_arg(v: &Value) -> Result<String, CoreError> {
    match v["profileId"].as_str() {
        Some(id) if !id.is_empty() && id.len() <= 64 => Ok(id.to_owned()),
        _ => Err(error("invalid_profile", "Escolha um Perfil de Provedor.")),
    }
}

fn job_arg(v: &Value) -> Result<i64, CoreError> {
    v["id"]
        .as_i64()
        .ok_or_else(|| error("invalid_job", "Tarefa inválida."))
}

/// `jobs.redo.estimate {id, profileId}`: o que o usuário confirma antes de refazer a unidade.
fn cmd_estimate(v: Value, _: &mut EventSink<'_>) -> CommandResult {
    let profile = profile_arg(&v)?;
    let source = source(job_arg(&v)?)?;
    let route = resolve_route(&source.task, Some(&profile))?;
    let estimate = estimate_units(&source.task, &[source.input], route.safety, Some(&profile));
    Ok(route.preview(estimate))
}

/// `jobs.redo {id, profileId, confirmed?}`: enfileira a unidade de novo, no mesmo lote, com o
/// perfil escolhido só para esta execução. Perfil pago exige `confirmed: true`.
fn cmd_redo(v: Value, _: &mut EventSink<'_>) -> CommandResult {
    let profile = profile_arg(&v)?;
    let source = source(job_arg(&v)?)?;
    let (route, jobs) = enqueue_checked(EnqueueAiRequest {
        task_id: &source.task,
        profile_id: Some(&profile),
        batch: source.batch.as_deref(),
        inputs: &[source.input],
        confirmed: v["confirmed"] == true,
        confirmation_message: CONFIRMATION_MESSAGE,
    })?;
    Ok(json!({"job": jobs[0], "profile": route.profile}))
}

inventory::submit! { CommandRegistration { name: "jobs.redo.estimate", execute: cmd_estimate } }
inventory::submit! { CommandRegistration { name: "jobs.redo", execute: cmd_redo } }
