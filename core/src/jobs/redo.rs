//! "Refazer com o perfil X" para uma unidade de Tarefa de IA (#126; ADR-0010, regra 4).
//!
//! É o comando genérico: vale para qualquer job `ai:<tarefa>` (uma Janela de seleção, e no
//! futuro um bloco do Roteiro, #73). O usuário escolhe **outro** Perfil de Provedor; a
//! unidade é enfileirada de novo com o mesmo pedido e esse perfil, só nesta execução. Nada
//! aqui troca perfil sozinho nem muda o padrão do app ou da Tarefa, e a rota passa pelo veto
//! "somente local" (por tarefa e por Projeto) antes de qualquer rede. Um job `uncertain` nunca
//! é refeito por aqui: antes o usuário resolve a incerteza (ADR-0005).
use super::{ai, enqueue_ai_with_profile, Safety};
use crate::{
    ai_task::{self, TaskInput},
    projects, provider, CommandRegistration, CommandResult, CoreError, EventSink,
};
use serde_json::{json, Value};

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

/// Para onde a unidade iria com o perfil pedido, já depois do veto "somente local".
pub struct Route {
    /// `{id, label, kind, model}`: nada de endpoint nem de chave.
    pub profile: Value,
    pub safety: Safety,
}

impl Route {
    pub fn paid(&self) -> bool {
        matches!(self.safety, Safety::Paid)
    }
}

/// Resolve `profile` para a Tarefa `task`. Perfil remoto com "somente local" ligado (da tarefa
/// ou do Projeto) devolve `local_only_violation` aqui, sem nenhuma chamada de rede.
pub fn route(task: &str, profile: &str) -> Result<Route, CoreError> {
    Ok(match provider::routed(Some(task), Some(profile))? {
        provider::Routed::Cli(name) => Route {
            profile: json!({"id": name, "label": name, "kind": name, "model": null}),
            safety: Safety::Paid,
        },
        provider::Routed::Api { profile, local } => Route {
            profile: json!({"id": profile.id, "label": profile.label, "kind": profile.kind, "model": profile.model}),
            safety: if local { Safety::Local } else { Safety::Paid },
        },
    })
}

/// Soma a estimativa do #40 das unidades para o perfil pedido (ou a rota da Tarefa, sem
/// perfil). Custo desconhecido nunca vira zero.
pub fn estimate_inputs(
    task: &str,
    inputs: &[TaskInput],
    safety: Safety,
    profile: Option<&str>,
) -> Value {
    let paid = matches!(safety, Safety::Paid);
    let mut kind = String::from("unknown");
    let (mut input_tokens, mut min, mut max) = (0_u64, Some(0_u64), Some(0_u64));
    if let (Some(definition), Ok((target, profile))) = (
        ai_task::find(task),
        ai::route_of_profile(task, paid, profile),
    ) {
        for (i, input) in inputs.iter().enumerate() {
            let estimate = ai::request_for(definition, input)
                .and_then(|request| provider::cost::estimate_for(&target, &profile, &request).ok());
            let Some(estimate) = estimate else {
                kind = "unknown".into();
                min = None;
                max = None;
                break;
            };
            let this = estimate["kind"].as_str().unwrap_or("unknown").to_owned();
            if i == 0 {
                kind = this;
            } else if kind != this {
                kind = "unknown".into();
            }
            input_tokens += estimate["inputTokens"].as_u64().unwrap_or(0);
            min = min
                .zip(estimate["minMicroUsd"].as_u64())
                .map(|(a, b)| a + b);
            max = max
                .zip(estimate["maxMicroUsd"].as_u64())
                .map(|(a, b)| a + b);
        }
    }
    json!({
        "kind": kind,
        "units": inputs.len(),
        "windows": inputs.len(),
        "inputTokens": input_tokens,
        "minMicroUsd": min,
        "maxMicroUsd": max,
    })
}

/// O que a confirmação mostra antes de refazer: o perfil, o custo estimado e se o texto sai da
/// máquina (todo perfil que não é loopback, e todo CLI).
pub fn preview(route: &Route, estimate: Value) -> Value {
    json!({
        "profile": route.profile,
        "paid": route.paid(),
        "leavesMachine": route.paid(),
        "estimate": estimate,
    })
}

/// A confirmação pedida a um perfil pago: o mesmo erro tipado de `selection.start`, com o
/// perfil e a estimativa em `usage`.
pub fn confirmation_required(preview: Value) -> CoreError {
    CoreError {
        code: "confirmation_required".into(),
        message: "Refazer com este perfil envia o texto a um Provedor pago: confirme o perfil e o custo estimado antes de começar.".into(),
        usage: Some(json!({"estimate": preview["estimate"], "profile": preview["profile"], "leavesMachine": preview["leavesMachine"]})),
    }
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
    let route = route(&source.task, &profile)?;
    let estimate = estimate_inputs(&source.task, &[source.input], route.safety, Some(&profile));
    Ok(preview(&route, estimate))
}

/// `jobs.redo {id, profileId, confirmed?}`: enfileira a unidade de novo, no mesmo lote, com o
/// perfil escolhido só para esta execução. Perfil pago exige `confirmed: true`.
fn cmd_redo(v: Value, _: &mut EventSink<'_>) -> CommandResult {
    let profile = profile_arg(&v)?;
    let source = source(job_arg(&v)?)?;
    let route = route(&source.task, &profile)?;
    if route.paid() && v["confirmed"] != true {
        let estimate = estimate_inputs(
            &source.task,
            std::slice::from_ref(&source.input),
            route.safety,
            Some(&profile),
        );
        return Err(confirmation_required(preview(&route, estimate)));
    }
    let job = enqueue_ai_with_profile(
        &source.task,
        &source.input,
        route.safety,
        source.batch.as_deref(),
        Some(&profile),
    )?;
    Ok(json!({"job": job, "profile": route.profile}))
}

inventory::submit! { CommandRegistration { name: "jobs.redo.estimate", execute: cmd_estimate } }
inventory::submit! { CommandRegistration { name: "jobs.redo", execute: cmd_redo } }
