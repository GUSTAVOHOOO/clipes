//! Executor de Tarefas de IA na fila (#121; ADR-0005, ADR-0007, ADR-0009).
//!
//! Um job `ai:<tarefa>` é uma unidade idempotente (uma janela, um Corte). O payload e o
//! resultado ficam na própria linha do job (`payload`, `result`), sem tabela nova de custo:
//! o registro de custo por chamada é o #124, que lê o `usage` e o `cost` de `result`.
//!
//! Regras de estado (a chamada paga é a única que pode ter sido cobrada sem sabermos):
//! - resposta validada: `completed`, com o resultado gravado na mesma instrução;
//! - `timeout_uncertain`: `uncertain` (custo desconhecido se `paid`, zero se `local`);
//! - cancelado depois de enviar uma chamada `paid`: `uncertain`, nunca `cancelled` com custo
//!   zero; cancelado antes de enviar (ou `local`): `cancelled`;
//! - qualquer outro erro, inclusive `invalid_json` com resposta recebida: `failed`, com o
//!   `usage` preservado em `result`.
use super::*;
use crate::{
    ai_task::{self, AiTask, TaskInput},
    provider::{
        cost::{self, Target},
        CancelToken, Provider, StructuredRequest,
    },
    CoreError,
};
use std::{
    sync::{
        atomic::{AtomicBool, Ordering},
        Arc, Mutex,
    },
    time::Duration,
};

pub(super) const KIND_PREFIX: &str = "ai:";

fn error(code: &str, message: &str) -> CoreError {
    CoreError {
        code: code.into(),
        message: message.into(),
        usage: None,
    }
}

type SharedProvider = Arc<dyn Provider + Send + Sync>;
static PROVIDER: Mutex<Option<SharedProvider>> = Mutex::new(None);

/// Troca o Provedor usado pelo executor (harness e testes headless). Sem troca, o executor usa
/// o Provedor configurado em `provider.json`, pela mesma rota de `provider.structured`.
pub fn set_ai_provider(provider: Option<SharedProvider>) {
    if let Ok(mut slot) = PROVIDER.lock() {
        *slot = provider;
    }
}

static ROUTE: Mutex<Option<(Target, String)>> = Mutex::new(None);

/// Fixa o alvo (Provedor e id do perfil) que preço e estimativa usam, para o harness e os
/// testes headless que injetam um Provedor falso. Sem ele, vale a rota da Tarefa em `provider.json`.
pub fn set_ai_route(route: Option<(Target, String)>) {
    if let Ok(mut slot) = ROUTE.lock() {
        *slot = route;
    }
}

/// O alvo do job: o fixado, ou a rota configurada da Tarefa. Sem configuração, um Provedor pago
/// fica sem preço (custo desconhecido, nunca zero) e um local custa zero.
fn route_of(task: &str, paid: bool) -> Result<(Target, String), CoreError> {
    if let Some(route) = ROUTE.lock().ok().and_then(|slot| slot.clone()) {
        return Ok(route);
    }
    match cost::route_for(task) {
        Ok(route) => Ok(route),
        Err(e)
            if e.code == "local_only_violation"
                || !PROVIDER.lock().ok().is_some_and(|p| p.is_some()) =>
        {
            Err(e)
        }
        Err(_) if paid => Ok((
            Target::Api {
                provider: "unknown".into(),
                model: String::new(),
                local: false,
            },
            String::new(),
        )),
        Err(_) => Ok((
            Target::Api {
                provider: "local".into(),
                model: String::new(),
                local: true,
            },
            String::new(),
        )),
    }
}

/// Provedor de produção: `provider::run_structured` com a rota da tarefa. Um job `local` só
/// envia a um endpoint de loopback; se a configuração mudou, falha antes de enviar.
struct Configured {
    task: String,
    local: bool,
}

impl Provider for Configured {
    fn structured(&self, request: &StructuredRequest) -> Result<Value, CoreError> {
        self.structured_with(request, &CancelToken::new())
    }
    fn structured_with(
        &self,
        request: &StructuredRequest,
        cancel: &CancelToken,
    ) -> Result<Value, CoreError> {
        let mut args = serde_json::to_value(request)
            .map_err(|_| error("invalid_request", "Invalid structured request"))?;
        args["task"] = json!(self.task);
        if self.local {
            let route = crate::provider::routed(Some(&self.task), None)?;
            if !matches!(route, crate::provider::Routed::Api { local: true, .. }) {
                return Err(error(
                    "not_local",
                    "A tarefa local não pode usar um Provedor fora do computador.",
                ));
            }
        }
        crate::provider::run_structured(args, cancel)
    }
}

/// Marca que a chamada saiu: depois disso, um cancelamento pode ter sido cobrado.
struct Probe<'a> {
    inner: &'a dyn Provider,
    sent: &'a AtomicBool,
    /// Teto de chamadas HTTP deste job; o escopo é conferido de novo antes de cada envio.
    max_calls: u64,
    /// Uma entrada por chamada HTTP que o Provedor fez (a chamada e o reparo).
    log: &'a Mutex<Vec<Value>>,
    job: i64,
    task: &'static AiTask,
    batch: Option<String>,
    route: (Target, String),
}

impl Provider for Probe<'_> {
    fn structured(&self, request: &StructuredRequest) -> Result<Value, CoreError> {
        self.structured_with(request, &CancelToken::new())
    }
    fn structured_with(
        &self,
        request: &StructuredRequest,
        cancel: &CancelToken,
    ) -> Result<Value, CoreError> {
        if !cancel.is_cancelled() {
            self.sent.store(true, Ordering::SeqCst);
            let _ = checkpoint(self.job, "sent");
        }
        let task = self.task;
        let batch = self.batch.clone();
        let route = self.route.clone();
        let guard = Box::new(move |request: &StructuredRequest, entries: &[Value]| {
            let heuristic = cost::estimate_input_tokens(request);
            // Actual usage corrects an underestimate before the next send, including repairs.
            let correction = entries.last().map_or(0, |last| {
                last["usage"]["inputTokens"]
                    .as_u64()
                    .unwrap_or(0)
                    .saturating_sub(
                        last["estimate"]["inputTokens"]
                            .as_u64()
                            .unwrap_or(heuristic),
                    )
            });
            let estimate =
                cost::estimate_with_input(&route.0, request, heuristic.saturating_add(correction))?;
            let pending = pending_usage(&route.0, entries)?;
            if let Some((code, message)) = job_limit(task, &estimate) {
                return Err(error(code, message));
            }
            if task.budget.max_cost_micro_cents.is_some_and(|cap| {
                estimate["maxMicroUsd"].as_u64().is_some_and(|next| {
                    pending["microUsd"]
                        .as_u64()
                        .unwrap_or(0)
                        .saturating_add(next)
                        > cap.saturating_mul(10)
                })
            }) {
                return Err(error(
                    "budget_cost",
                    "O teto de custo da Tarefa foi atingido.",
                ));
            }
            match budget::gate(
                task.id,
                batch.as_deref(),
                &estimate,
                task.budget.max_calls as u64,
                &pending,
            )? {
                budget::Gate::Go { .. } => Ok(estimate),
                budget::Gate::Pause { scope, key, code } => {
                    budget::pause(scope, &key, code);
                    Err(error(code, budget::pause_message(code)))
                }
            }
        });
        let (reply, log) =
            crate::provider::control::with_call_scope(Some(self.max_calls), Some(guard), || {
                self.inner.structured_with(request, cancel)
            });
        if let Ok(mut all) = self.log.lock() {
            all.extend(log);
        }
        reply
    }
}

inventory::submit! { projects::Migration { id: "0121_001_ai_jobs", sql: "ALTER TABLE jobs ADD COLUMN payload TEXT; ALTER TABLE jobs ADD COLUMN result TEXT;" } }

/// Enfileira uma unidade de trabalho da Tarefa de IA `task`. `safety` é `Paid` para qualquer
/// Provedor que não seja um modelo local (API remota ou CLI de assinatura).
pub fn enqueue_ai(task: &str, input: &TaskInput, safety: Safety) -> Result<i64, CoreError> {
    enqueue_ai_in_batch(task, input, safety, None)
}

/// Como `enqueue_ai`, com o rótulo do lote (#56) que o orçamento por lote soma.
pub fn enqueue_ai_in_batch(
    task: &str,
    input: &TaskInput,
    safety: Safety,
    batch: Option<&str>,
) -> Result<i64, CoreError> {
    let definition =
        ai_task::find(task).ok_or_else(|| error("unknown_task", "Tarefa de IA desconhecida."))?;
    ai_task::check_definition(definition).map_err(CoreError::from)?;
    let payload = json!({
        "task": task,
        "taskVersion": definition.version,
        "input": {
            "transcript": input.transcript,
            "context": input.context,
            "nativeSchema": input.native_schema,
        },
    })
    .to_string();
    let safety = match safety {
        Safety::Local => "local",
        Safety::Paid => "paid",
    };
    projects::with_writer(|c| {
        if let Some(batch) = batch {
            c.execute("INSERT INTO ai_budgets(scope,key,since) VALUES ('batch',?1,0) ON CONFLICT(scope,key) DO NOTHING", [batch])?;
        }
        c.execute(
            "INSERT INTO jobs(kind,safety,state,payload,batch) VALUES (?1,?2,'queued',?3,?4)",
            (format!("{KIND_PREFIX}{task}"), safety, payload, batch),
        )?;
        Ok(c.last_insert_rowid())
    })
}

struct Unit {
    task: &'static AiTask,
    input: TaskInput,
    paid: bool,
    batch: Option<String>,
}

fn load(id: i64) -> Result<Unit, CoreError> {
    let (safety, payload, batch): (String, Option<String>, Option<String>) =
        projects::with_reader(|c| {
            c.query_row(
                "SELECT safety,payload,batch FROM jobs WHERE id=?1",
                [id],
                |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?)),
            )
        })?;
    let invalid = || error("invalid_job_payload", "Dados da tarefa de IA inválidos.");
    let payload: Value =
        serde_json::from_str(&payload.ok_or_else(invalid)?).map_err(|_| invalid())?;
    let task = ai_task::find(payload["task"].as_str().ok_or_else(invalid)?)
        .ok_or_else(|| error("unknown_task", "Tarefa de IA desconhecida."))?;
    if payload["taskVersion"].as_u64() != Some(task.version as u64) {
        return Err(error(
            "task_version_changed",
            "A versão da Tarefa de IA mudou desde que o job foi criado.",
        ));
    }
    let input = &payload["input"];
    Ok(Unit {
        task,
        input: TaskInput {
            transcript: input["transcript"].as_str().ok_or_else(invalid)?.into(),
            context: input["context"].clone(),
            native_schema: input["nativeSchema"].as_bool().unwrap_or(false),
        },
        paid: safety != "local",
        batch,
    })
}

#[derive(Debug, PartialEq, Eq)]
pub(super) enum Settle {
    Uncertain,
    Cancelled,
    Failed,
    /// Nada foi enviado (ou o custo é zero) e o app está fechando: volta à fila.
    Requeue,
}

/// Decide o estado de um erro da execução. `sent`: a chamada chegou ao Provedor.
pub(super) fn classify(code: &str, sent: bool, paid: bool, shutting_down: bool) -> Settle {
    match code {
        "timeout_uncertain" => Settle::Uncertain,
        "cancelled" if sent && paid => Settle::Uncertain,
        "cancelled" if shutting_down => Settle::Requeue,
        "cancelled" => Settle::Cancelled,
        _ => Settle::Failed,
    }
}

fn cost_of(paid: bool, has_usage: bool, unknown: bool) -> &'static str {
    match (paid, has_usage, unknown) {
        (false, _, _) => "zero",
        (true, _, true) => "unknown",
        (true, true, false) => "usage",
        (true, false, false) => "none",
    }
}

fn is_cancelled(id: i64) -> bool {
    projects::with_reader(|c| {
        c.query_row("SELECT cancel_requested FROM jobs WHERE id=?1", [id], |r| {
            r.get::<_, bool>(0)
        })
    })
    .unwrap_or(false)
}

fn emit(id: i64, task: &str, step: &str, percentage: u8, message: &str, error: Option<CoreError>) {
    let project = projects::with_reader(|c| {
        c.query_row("SELECT id FROM queue_project_identity", [], |r| {
            r.get::<_, String>(0)
        })
    })
    .ok();
    crate::emit_background(crate::ProgressEvent {
        job: id.to_string(),
        project,
        stage: format!("ai:{task}:{step}"),
        percentage,
        message: message.into(),
        error,
    });
}

fn stage(id: i64, task: &str, step: &str, percentage: u8, message: &str) {
    let _ = projects::with_writer(|c| {
        c.execute(
            "UPDATE jobs SET progress=?2 WHERE id=?1 AND state='running'",
            (id, percentage),
        )?;
        Ok(())
    });
    emit(id, task, step, percentage, message, None);
}

/// Grava o estado final e o resultado numa só instrução: uma queda entre os dois não deixa um
/// job pago `uncertain` com resultado validado.
fn settle(id: i64, state: &str, result: &Value) {
    let _ = projects::with_writer(|c| {
        c.execute(
            "UPDATE jobs SET state=?2,result=?3,progress=CASE WHEN ?2='completed' THEN 100 ELSE progress END,checkpoint=CASE WHEN ?2='completed' THEN 'validated' ELSE checkpoint END WHERE id=?1 AND state='running'",
            (id, state, result.to_string()),
        )?;
        Ok(())
    });
}

fn requeue(id: i64) {
    let _ = projects::with_writer(|c| {
        c.execute(
            "UPDATE jobs SET state='queued',result=NULL WHERE id=?1 AND state='running'",
            [id],
        )?;
        Ok(())
    });
}

fn fail_fixed(id: i64, task: &str, e: CoreError) {
    settle(
        id,
        "failed",
        &json!({"outcome":"failed","code":e.code,"cost":"none"}),
    );
    emit(id, task, "done", 0, "Tarefa de IA falhou", Some(e));
}

/// O pedido que o executor envia (o mesmo de `ai_task::run`), para estimar antes de enviar.
fn request_of(unit: &Unit) -> Option<StructuredRequest> {
    let (wire, _) = ai_task::check_definition(unit.task).ok()?;
    Some(StructuredRequest {
        instruction: ai_task::normalized_prompt(unit.task.prompt),
        transcript: unit.input.transcript.clone(),
        schema: wire,
        native_schema: unit.input.native_schema,
        max_output_tokens: Some(unit.task.budget.max_output_tokens),
    })
}

/// Limites do `AiTask.budget` que valem por job e que a estimativa já decide antes de enviar
/// (ADR-0009, regra 3). Estourar falha o job com `budget_*`; não pausa a fila.
fn job_limit(task: &AiTask, estimate: &Value) -> Option<(&'static str, &'static str)> {
    let b = task.budget;
    if b.max_calls == 0 {
        return Some(("budget_calls", "A Tarefa não permite nenhuma chamada."));
    }
    if estimate["callsOnly"] == true || estimate["kind"] == "plan_quota" {
        return None;
    }
    if b.max_wall_clock_secs == 0 {
        return Some((
            "budget_time",
            "O limite de tempo da Tarefa foi atingido; nada foi enviado.",
        ));
    }
    if estimate["inputTokens"].as_u64().unwrap_or(0) > b.max_input_tokens {
        return Some((
            "budget_input_tokens",
            "A entrada passa do limite de tokens da Tarefa; nada foi enviado.",
        ));
    }
    // `max_cost_micro_cents` está em 1e-5 US$; o custo do núcleo, em 1e-6 US$.
    let cap = b.max_cost_micro_cents.map(|c| c.saturating_mul(10));
    let next = estimate["maxMicroUsd"]
        .as_u64()
        .or_else(|| estimate["minMicroUsd"].as_u64());
    if cap.zip(next).is_some_and(|(cap, next)| next > cap) {
        return Some((
            "budget_cost",
            "A estimativa passa do teto de custo da Tarefa; nada foi enviado.",
        ));
    }
    None
}

/// Metadata of the calls already completed in this request, not written again until it settles.
fn pending_usage(target: &Target, entries: &[Value]) -> Result<Value, CoreError> {
    let mut calls = 0_u64;
    let mut input = 0_u64;
    let mut output = 0_u64;
    let mut micro = 0_u64;
    let mut duration = 0_u64;
    for entry in entries {
        calls = calls.saturating_add(entry["calls"].as_u64().unwrap_or(1));
        input = input.saturating_add(entry["usage"]["inputTokens"].as_u64().unwrap_or(0));
        output = output.saturating_add(entry["usage"]["outputTokens"].as_u64().unwrap_or(0));
        duration = duration.saturating_add(entry["durationMs"].as_u64().unwrap_or(0));
        if let cost::Cost::Usd { micro_usd, .. } = cost::actual(target, &entry["usage"])? {
            micro = micro.saturating_add(micro_usd);
        }
    }
    Ok(
        json!({"calls":calls,"inputTokens":input,"outputTokens":output,"microUsd":micro,"durationMs":duration}),
    )
}

/// O log de chamadas do Provedor (`{attempt, calls, usage, code, durationMs}`); sem log, uma
/// entrada só com o total.
fn entries_of(log: &[Value], usage: &Option<Value>, calls: u64, code: &str) -> Vec<Value> {
    if log.is_empty() {
        vec![json!({"attempt":0,"calls":calls,"usage":usage,"code":code})]
    } else {
        log.to_vec()
    }
}

/// Erros que acontecem depois de uma chamada chegar ao Provedor: só esses geram linha de custo.
fn reached_provider(code: &str) -> bool {
    matches!(
        code,
        "timeout_uncertain"
            | "cancelled"
            | "budget_time"
            | "budget_calls"
            | "budget_cost"
            | "budget_tokens"
            | "rate_limit"
            | "cli_free_limit"
            | "provider_http"
            | "network"
            | "output_truncated"
            | "refusal"
            | "invalid_json"
            | "invalid_response"
            | "output_invalid"
            | "verification_failed"
    )
}

/// Grava uma linha de custo por chamada (e por reparo) do job (#124). Chamada paga sem `usage`
/// (timeout, cancelamento em voo) fica com custo desconhecido, nunca zero.
fn record_calls(
    id: i64,
    unit: &Unit,
    route: &(Target, String),
    estimate: &Value,
    entries: &[Value],
    elapsed_ms: u64,
) {
    let each = estimate["maxMicroUsd"]
        .as_u64()
        .or_else(|| estimate["minMicroUsd"].as_u64());
    for entry in entries {
        let usage = if route.0.is_cli()
            || matches!(
                entry["code"].as_str(),
                Some("cancelled" | "timeout_uncertain")
            ) {
            Value::Null
        } else {
            entry["usage"].clone()
        };
        let Ok(cost) = cost::actual(&route.0, &usage) else {
            continue;
        };
        let profile = (!route.1.is_empty()).then_some(route.1.as_str());
        let _ = cost::record_call(&cost::CallRow {
            profile,
            target: &route.0,
            task: unit.task.id,
            task_version: Some(unit.task.version),
            batch: unit.batch.as_deref(),
            job: Some(id),
            attempt: Some(u8::from(entry["attempt"].as_u64() == Some(1))),
            usage: &usage,
            calls: entry["calls"].as_u64().unwrap_or(1),
            cost: &cost,
            code: entry["code"].as_str().unwrap_or("ok"),
            estimate_micro_usd: entry["estimate"]["maxMicroUsd"].as_u64().or(each),
            duration_ms: Some(entry["durationMs"].as_u64().unwrap_or(elapsed_ms)),
        });
    }
}

/// Executa o job `id`, já `running`. Resolve o estado final sozinho; só devolve o job à fila
/// quando o app fecha antes de qualquer envio (ou com um modelo local), ou quando o orçamento
/// acumulado pausa a fila antes de enviar.
pub(super) fn execute(id: i64, stop: &AtomicBool) {
    let unit = match load(id) {
        Ok(unit) => unit,
        Err(e) => return fail_fixed(id, "unknown", e),
    };
    let task = unit.task.id;
    let _ = projects::with_writer(|c| {
        c.execute("UPDATE jobs SET result=NULL WHERE id=?1", [id])?;
        Ok(())
    });
    stage(id, task, "prepare", 0, "Preparando a Tarefa de IA");
    if stop.load(Ordering::SeqCst) {
        return requeue(id);
    }
    if is_cancelled(id) {
        settle(
            id,
            "cancelled",
            &json!({"outcome":"cancelled","cost":"zero"}),
        );
        return emit(id, task, "done", 0, "Tarefa de IA cancelada", None);
    }
    // Orçamento: a estimativa de antes de enviar é a do #40 (`cost::estimate`).
    let route = match route_of(task, unit.paid) {
        Ok(route) => route,
        Err(e) => return fail_fixed(id, task, e),
    };
    let estimate = request_of(&unit)
        .and_then(|request| cost::estimate(&route.0, &request).ok())
        .unwrap_or_else(|| json!({"kind":"unknown"}));
    if let Some((code, message)) = job_limit(unit.task, &estimate) {
        return fail_fixed(id, task, error(code, message));
    }
    let job_calls = unit.task.budget.max_calls as u64;
    let max_calls = match budget::gate(
        task,
        unit.batch.as_deref(),
        &estimate,
        job_calls,
        &Value::Null,
    ) {
        Ok(budget::Gate::Go { max_calls }) => max_calls,
        Ok(budget::Gate::Pause { scope, key, code }) => {
            budget::pause(scope, &key, code);
            let _ = projects::with_writer(|c| {
                c.execute(
                    "UPDATE jobs SET state='queued',attempts=attempts-1,result=NULL WHERE id=?1 AND state='running'",
                    [id],
                )?;
                Ok(())
            });
            let e = error(code, budget::pause_message(code));
            return emit(
                id,
                task,
                "paused",
                0,
                "Fila pausada pelo orçamento",
                Some(e),
            );
        }
        Err(e) => return fail_fixed(id, task, e),
    };
    let provider: SharedProvider = PROVIDER
        .lock()
        .ok()
        .and_then(|slot| slot.clone())
        .unwrap_or_else(|| {
            Arc::new(Configured {
                task: task.into(),
                local: !unit.paid,
            })
        });
    let sent = AtomicBool::new(false);
    let call_log: Mutex<Vec<Value>> = Mutex::new(Vec::new());
    let probe = Probe {
        inner: provider.as_ref(),
        sent: &sent,
        max_calls,
        log: &call_log,
        job: id,
        task: unit.task,
        batch: unit.batch.clone(),
        route: route.clone(),
    };
    let token = CancelToken::new();
    let finished = AtomicBool::new(false);
    let shutdown = AtomicBool::new(false);
    let timed_out = AtomicBool::new(false);
    let started = std::time::Instant::now();
    let wall = if route.0.is_cli() {
        Duration::MAX
    } else {
        let own = Duration::from_secs(unit.task.budget.max_wall_clock_secs);
        match budget::remaining_wall(task, unit.batch.as_deref()) {
            Ok(Some(remaining)) => own.min(remaining),
            Ok(None) => own,
            Err(e) => return fail_fixed(id, task, e),
        }
    };
    stage(id, task, "call", 10, "Chamando o Provedor");
    let run = std::thread::scope(|scope| {
        scope.spawn(|| {
            while !finished.load(Ordering::SeqCst) {
                if stop.load(Ordering::SeqCst) {
                    shutdown.store(true, Ordering::SeqCst);
                    token.cancel();
                    break;
                }
                if is_cancelled(id) {
                    token.cancel();
                    break;
                }
                // Tempo máximo do job: cancela a chamada em voo (paga, vira incerto).
                if started.elapsed() >= wall {
                    timed_out.store(true, Ordering::SeqCst);
                    token.cancel();
                    break;
                }
                std::thread::sleep(Duration::from_millis(25));
            }
        });
        let run = ai_task::run(unit.task, &unit.input, &probe, &token);
        finished.store(true, Ordering::SeqCst);
        run
    });
    let elapsed_ms = started.elapsed().as_millis() as u64;
    stage(id, task, "verify", 80, "Conferindo a resposta");
    match run {
        Ok(out) => {
            let log = call_log.lock().map(|l| l.clone()).unwrap_or_default();
            let entries = entries_of(&log, &out.usage, out.calls, "ok");
            record_calls(id, &unit, &route, &estimate, &entries, elapsed_ms);
            settle(
                id,
                "completed",
                &json!({
                    "outcome": "ok",
                    "data": out.data,
                    "usage": out.usage,
                    "calls": out.calls,
                    "cost": cost_of(unit.paid, out.usage.is_some(), false),
                }),
            );
            emit(id, task, "done", 100, "Tarefa de IA concluída", None);
        }
        Err(mut e) => {
            let sent = sent.load(Ordering::SeqCst);
            // O limite de tempo do job cancelou a chamada: é um timeout, não um cancelamento.
            if e.code == "cancelled" && timed_out.load(Ordering::SeqCst) {
                e.code = if sent && unit.paid {
                    "timeout_uncertain".into()
                } else {
                    "budget_time".into()
                };
            }
            let how = classify(&e.code, sent, unit.paid, shutdown.load(Ordering::SeqCst));
            if how == Settle::Requeue {
                return requeue(id);
            }
            if sent && reached_provider(&e.code) {
                let info = e.usage.clone().unwrap_or(Value::Null);
                let usage = info.get("usage").filter(|u| !u.is_null()).cloned();
                let calls = info["calls"].as_u64().unwrap_or(1);
                let log = call_log.lock().map(|l| l.clone()).unwrap_or_default();
                let mut entries = entries_of(&log, &usage, calls, &e.code);
                // A última chamada chegou, mas não passou no schema nem nos verificadores; ou
                // foi cortada pelo limite de tempo do job.
                if let Some(last) = entries.last_mut() {
                    if last["code"] == "ok" || last["code"] == "cancelled" {
                        last["code"] = json!(e.code);
                    }
                }
                record_calls(id, &unit, &route, &estimate, &entries, elapsed_ms);
            }
            let unknown = how == Settle::Uncertain && unit.paid;
            let core: CoreError = e.clone().into();
            let result = json!({
                "outcome": match how { Settle::Uncertain => "uncertain", Settle::Cancelled => "cancelled", _ => "failed" },
                "code": e.code,
                "violations": e.violations,
                "usage": e.usage,
                "cost": cost_of(unit.paid, e.usage.is_some(), unknown),
            });
            let (state, message) = match how {
                Settle::Requeue => unreachable!("handled above"),
                Settle::Uncertain => ("uncertain", "Resultado da chamada incerto"),
                Settle::Cancelled => ("cancelled", "Tarefa de IA cancelada"),
                Settle::Failed => ("failed", "Tarefa de IA falhou"),
            };
            settle(id, state, &result);
            emit(id, task, "done", 0, message, Some(core));
        }
    }
}

/// Custo estimado de repetir o job (ADR-0009, regra 5): modelo local é zero; para o resto, a
/// estimativa do #40 para a rota da Tarefa, ou `unknown` se não houver.
pub(super) fn estimate(id: i64) -> Value {
    let Ok(unit) = load(id) else {
        return json!({"kind":"unknown"});
    };
    if !unit.paid {
        return json!({"kind":"zero"});
    }
    let Ok(route) = route_of(unit.task.id, true) else {
        return json!({"kind":"unknown"});
    };
    let Some(request) = request_of(&unit) else {
        return json!({"kind":"unknown"});
    };
    cost::estimate(&route.0, &request).unwrap_or_else(|_| json!({"kind":"unknown"}))
}

fn job_id(v: &Value) -> Result<i64, CoreError> {
    v["id"]
        .as_i64()
        .ok_or_else(|| error("invalid_job", "Tarefa inválida."))
}

fn cmd_estimate(v: Value, _: &mut EventSink<'_>) -> CommandResult {
    let id = job_id(&v)?;
    let safety: String = projects::with_reader(|c| {
        c.query_row("SELECT safety FROM jobs WHERE id=?1", [id], |r| r.get(0))
    })
    .map_err(|_| error("invalid_job", "Tarefa inválida."))?;
    Ok(json!({"safety":safety,"estimate":estimate(id)}))
}
inventory::submit! { CommandRegistration { name: "jobs.estimate", execute: cmd_estimate } }

/// Resultado do job de IA: `outcome`, `data`, `usage`, `calls`, `cost` e erro tipado.
fn cmd_result(v: Value, _: &mut EventSink<'_>) -> CommandResult {
    let id = job_id(&v)?;
    let result: Option<String> = projects::with_reader(|c| {
        c.query_row("SELECT result FROM jobs WHERE id=?1", [id], |r| r.get(0))
    })
    .map_err(|_| error("invalid_job", "Tarefa inválida."))?;
    Ok(result
        .and_then(|text| serde_json::from_str(&text).ok())
        .unwrap_or(Value::Null))
}
inventory::submit! { CommandRegistration { name: "jobs.result", execute: cmd_result } }

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn classification_never_calls_a_sent_paid_cancel_free() {
        use Settle::*;
        // (code, sent, paid, shutting_down) -> state
        let table = [
            ("cancelled", false, true, false, Cancelled),
            ("cancelled", true, true, false, Uncertain),
            ("cancelled", true, true, true, Uncertain),
            ("cancelled", false, true, true, Requeue),
            ("cancelled", true, false, false, Cancelled),
            ("cancelled", true, false, true, Requeue),
            ("timeout_uncertain", true, true, false, Uncertain),
            ("timeout_uncertain", true, false, false, Uncertain),
            ("invalid_json", true, true, false, Failed),
            ("output_invalid", true, true, false, Failed),
            ("network", true, true, false, Failed),
        ];
        for (code, sent, paid, down, want) in table {
            assert_eq!(
                classify(code, sent, paid, down),
                want,
                "{code} {sent} {paid} {down}"
            );
        }
    }

    #[test]
    fn cost_marker_is_explicit() {
        assert_eq!(cost_of(true, false, true), "unknown");
        assert_eq!(cost_of(true, true, false), "usage");
        assert_eq!(cost_of(true, false, false), "none");
        assert_eq!(cost_of(false, false, false), "zero");
    }
}
