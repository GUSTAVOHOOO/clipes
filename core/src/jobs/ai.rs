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
    console::{emit_console, ConsoleDraft, ConsoleKind, ConsoleLevel},
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

/// Resumo público seguro de um Perfil de Provedor (sem endpoint nem chave).
#[derive(Debug, Clone, PartialEq, Eq, serde::Serialize)]
pub struct ProfileSummary {
    pub id: String,
    pub label: String,
    pub kind: String,
    pub model: Option<String>,
}

/// Rota resolvida para uma Tarefa de IA, já após o veto "somente local" (tarefa e Projeto).
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct AiRoute {
    pub profile: ProfileSummary,
    pub safety: Safety,
}

impl AiRoute {
    pub fn paid(&self) -> bool {
        matches!(self.safety, Safety::Paid)
    }

    pub fn preview(&self, estimate: Value) -> Value {
        json!({
            "profile": self.profile,
            "paid": self.paid(),
            "leavesMachine": self.paid(),
            "estimate": estimate,
        })
    }
}

/// Pedido único de pré-vôo + enfileiramento de 1..N unidades de uma Tarefa de IA.
pub struct EnqueueAiRequest<'a> {
    pub task_id: &'a str,
    pub profile_id: Option<&'a str>,
    pub batch: Option<&'a str>,
    pub inputs: &'a [TaskInput],
    pub confirmed: bool,
    pub confirmation_message: &'a str,
}

/// Códigos sanitizados de falha/violação extraídos de `jobs.result` (ADR-0006).
#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct JobOutcomeCodes {
    pub code: Option<String>,
    pub violations: Vec<String>,
}

/// Resolve rota já aplicando os dois vetos "somente local" (por Tarefa e por Projeto).
pub fn resolve_route(task_id: &str, profile_id: Option<&str>) -> Result<AiRoute, CoreError> {
    Ok(match crate::provider::routed(Some(task_id), profile_id)? {
        crate::provider::Routed::Cli(name) => AiRoute {
            profile: ProfileSummary {
                id: name.clone(),
                label: name.clone(),
                kind: name,
                model: None,
            },
            safety: Safety::Paid,
        },
        crate::provider::Routed::Api { profile, local } => AiRoute {
            profile: ProfileSummary {
                id: profile.id,
                label: profile.label,
                kind: profile.kind,
                model: Some(profile.model),
            },
            safety: if local { Safety::Local } else { Safety::Paid },
        },
    })
}

/// Estima 1..N unidades para a tarefa e rota informadas; custo desconhecido nunca vira zero.
pub fn estimate_units(
    task_id: &str,
    inputs: &[TaskInput],
    safety: Safety,
    profile_id: Option<&str>,
) -> Value {
    let paid = matches!(safety, Safety::Paid);
    let mut kind = String::from("unknown");
    let (mut input_tokens, mut min, mut max) = (0_u64, Some(0_u64), Some(0_u64));
    if inputs.is_empty() {
        min = None;
        max = None;
    } else if let (Some(definition), Ok((target, profile))) = (
        ai_task::find(task_id),
        route_of_profile(task_id, paid, profile_id),
    ) {
        for (i, input) in inputs.iter().enumerate() {
            let estimate = request_for(definition, input)
                .and_then(|request| cost::estimate_for(&target, &profile, &request).ok());
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
    } else {
        min = None;
        max = None;
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

pub(crate) fn confirmation_error(
    route: &AiRoute,
    estimate: Value,
    include_profile: bool,
    message: &str,
) -> CoreError {
    let usage = if include_profile {
        json!({
            "estimate": estimate,
            "profile": route.profile,
            "leavesMachine": route.paid(),
        })
    } else {
        json!({"estimate": estimate})
    };
    CoreError {
        code: "confirmation_required".into(),
        message: message.into(),
        usage: Some(usage),
    }
}

/// Garante confirmação paga (calculando a estimativa apenas se necessário) e enfileira todas as unidades.
pub fn enqueue_checked(req: EnqueueAiRequest<'_>) -> Result<(AiRoute, Vec<i64>), CoreError> {
    let route = resolve_route(req.task_id, req.profile_id)?;
    if route.paid() && !req.confirmed {
        let estimate = estimate_units(req.task_id, req.inputs, route.safety, req.profile_id);
        return Err(confirmation_error(
            &route,
            estimate,
            req.profile_id.is_some(),
            req.confirmation_message,
        ));
    }
    let mut ids = Vec::with_capacity(req.inputs.len());
    for input in req.inputs {
        ids.push(enqueue_ai_with_profile(
            req.task_id,
            input,
            route.safety,
            req.batch,
            req.profile_id,
        )?);
    }
    Ok((route, ids))
}

fn is_safe_code(code: &str) -> bool {
    !code.is_empty()
        && code.len() <= 48
        && code
            .chars()
            .all(|ch| ch.is_ascii_lowercase() || ch == '_' || ch.is_ascii_digit())
}

/// Extrai `code` e `violations[].code` de `jobs.result` somente no formato identificador seguro (`[a-z0-9_]`).
pub fn outcome_codes(result: Option<&Value>) -> JobOutcomeCodes {
    let Some(result) = result else {
        return JobOutcomeCodes::default();
    };
    let code = result["code"]
        .as_str()
        .filter(|c| is_safe_code(c))
        .map(str::to_owned);
    let violations = result["violations"]
        .as_array()
        .map(|items| {
            items
                .iter()
                .filter_map(|item| item["code"].as_str())
                .filter(|c| is_safe_code(c))
                .map(str::to_owned)
                .collect()
        })
        .unwrap_or_default();
    JobOutcomeCodes { code, violations }
}

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

/// O alvo do job: o Perfil explícito (#126), ou o fixado, ou a rota configurada da Tarefa. O Perfil
/// explícito vale no lugar dos outros dois e passa pelo veto "somente local" (por tarefa e por
/// Projeto) antes de qualquer envio. Sem configuração, um Provedor pago fica sem preço (custo
/// desconhecido, nunca zero) e um local custa zero.
fn route_of_profile(
    task: &str,
    paid: bool,
    profile: Option<&str>,
) -> Result<(Target, String), CoreError> {
    if let Some(profile) = profile {
        return cost::route_with_profile(task, profile);
    }
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
    profile: Option<String>,
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
        if let Some(profile) = &self.profile {
            args["profileId"] = json!(profile);
        }
        if self.local {
            let route = crate::provider::routed(Some(&self.task), self.profile.as_deref())?;
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
    /// Transport facts of a subscription CLI call, which has no HTTP call log (#125).
    transport: &'a Mutex<Option<Value>>,
    job: i64,
    task: &'static AiTask,
    batch: Option<String>,
    route: (Target, String),
    /// Contexto seguro para o console ao vivo (sem prompt, Transcrição ou resposta).
    console_meta: &'a AiConsoleMeta,
    repair_announced: Arc<AtomicBool>,
    /// Fim do orçamento de tempo do job: nenhum timeout de chamada passa dele (#147).
    deadline: Option<std::time::Instant>,
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
        let meta = self.console_meta.clone();
        let repair_announced = Arc::clone(&self.repair_announced);
        let last_retry_len = Mutex::new(0usize);
        let guard = Box::new(move |request: &StructuredRequest, entries: &[Value]| {
            if entries
                .iter()
                .any(|e| e["attempt"].as_u64() == Some(0) && e["code"] == "invalid_json")
                && !repair_announced.swap(true, Ordering::SeqCst)
            {
                emit_ai_console(
                    &meta,
                    ConsoleLevel::Warn,
                    &format!(
                        "{}{} — resposta fora do formato esperado; tentando reparo automático",
                        meta.label, meta.unit_pt
                    ),
                    &format!(
                        "job={} task={}{} stage=repair attempt=1 reason=invalid_json",
                        meta.job_id, task.id, meta.unit_tech
                    ),
                );
            }
            if entries.last().is_some_and(|e| e["rateLimitRetry"] == true) {
                let mut seen = last_retry_len.lock().unwrap_or_else(|e| e.into_inner());
                if entries.len() > *seen {
                    *seen = entries.len();
                    let secs = entries.last().and_then(|e| e["retryAfterSeconds"].as_u64());
                    let wait_pt = secs.map(|s| format!(" ({s} s)")).unwrap_or_default();
                    let wait_tech = secs
                        .map(|s| format!(" retry_after_s={s}"))
                        .unwrap_or_default();
                    emit_ai_console(
                        &meta,
                        ConsoleLevel::Warn,
                        &format!(
                            "{}{} — limite de requisições do Provedor; aguardando nova tentativa{wait_pt}",
                            meta.label, meta.unit_pt
                        ),
                        &format!(
                            "job={} task={}{} stage=rate_limit_retry{wait_tech}",
                            meta.job_id, task.id, meta.unit_tech
                        ),
                    );
                }
            }
            let mut estimate = cost::estimate_for(&route.0, &route.1, request)?;
            let heuristic = estimate["inputTokens"].as_u64().unwrap_or(0);
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
            if correction > 0 {
                let corrected = cost::estimate_with_range(
                    &route.0,
                    request,
                    cost::TokenRange {
                        low: estimate["inputTokensRange"]["min"].as_u64().unwrap_or(0),
                        high: heuristic.saturating_add(correction),
                    },
                )?;
                for field in [
                    "inputTokens",
                    "inputTokensRange",
                    "tier",
                    "minMicroUsd",
                    "maxMicroUsd",
                ] {
                    estimate[field] = corrected[field].clone();
                }
            }
            let pending = pending_usage(&route.0, &route.1, entries)?;
            if let Some((code, message)) = job_limit(task, &estimate) {
                emit_ai_console(
                    &meta,
                    ConsoleLevel::Error,
                    &format!(
                        "{}{} interrompida antes de nova chamada: {message}",
                        meta.label, meta.unit_pt
                    ),
                    &format!(
                        "job={} task={}{} stage=limit error={code}",
                        meta.job_id, task.id, meta.unit_tech
                    ),
                );
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
                emit_ai_console(
                    &meta,
                    ConsoleLevel::Error,
                    &format!(
                        "{}{} interrompida: teto de custo da Tarefa atingido.",
                        meta.label, meta.unit_pt
                    ),
                    &format!(
                        "job={} task={}{} stage=limit error=budget_cost",
                        meta.job_id, task.id, meta.unit_tech
                    ),
                );
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
                    let reason = budget::pause_message(code);
                    emit_ai_console(
                        &meta,
                        ConsoleLevel::Warn,
                        &format!("{}{} pausada: {reason}", meta.label, meta.unit_pt),
                        &format!(
                            "job={} task={}{} stage=paused scope={scope} key={key} code={code}",
                            meta.job_id, task.id, meta.unit_tech
                        ),
                    );
                    Err(error(code, reason))
                }
            }
        });
        let ((reply, transport), log) =
            crate::provider::control::with_call_scope(Some(self.max_calls), Some(guard), || {
                crate::provider::control::set_deadline(self.deadline);
                let reply = self.inner.structured_with(request, cancel);
                (reply, crate::provider::control::take_transport())
            });
        if let (Ok(mut slot), Some(transport)) = (self.transport.lock(), transport) {
            *slot = Some(transport);
        }
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
    enqueue_ai_with_profile(task, input, safety, batch, None)
}

/// Como `enqueue_ai_in_batch`, mas o job usa o Perfil de Provedor `profile` só nesta execução
/// (#126): o padrão do app e da Tarefa não muda e o veto "somente local" vale antes de qualquer
/// envio. É o ponto de entrada genérico de "refazer com o perfil X" para uma unidade de IA.
pub fn enqueue_ai_with_profile(
    task: &str,
    input: &TaskInput,
    safety: Safety,
    batch: Option<&str>,
    profile: Option<&str>,
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
            "estimateHint": input.estimate_hint,
        },
        "profileId": profile,
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

pub(super) struct Unit {
    pub(super) task: &'static AiTask,
    pub(super) input: TaskInput,
    pub(super) paid: bool,
    pub(super) batch: Option<String>,
    /// Perfil explícito desta execução (#126); `None` segue a rota da Tarefa.
    pub(super) profile: Option<String>,
}

pub(super) fn load(id: i64) -> Result<Unit, CoreError> {
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
            estimate_hint: serde_json::from_value(input["estimateHint"].clone())
                .unwrap_or_default(),
            native_schema: input["nativeSchema"].as_bool().unwrap_or(false),
        },
        paid: safety != "local",
        batch,
        profile: payload["profileId"].as_str().map(str::to_owned),
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

fn clip_id_for(id: i64, unit: &Unit) -> Option<i64> {
    if unit.task.id != crate::translation::TASK_ID {
        return None;
    }
    unit.input
        .context
        .get("clip_id")
        .and_then(Value::as_i64)
        .or_else(|| {
            projects::with_reader(|c| {
                c.query_row(
                    "SELECT r.clip_id FROM translation_run_jobs rj JOIN translation_runs r ON r.id=rj.run_id WHERE rj.job_id=?1",
                    [id],
                    |r| r.get(0),
                )
                .optional()
            })
            .ok()
            .flatten()
        })
}

fn current_project_id() -> Option<String> {
    projects::with_reader(|c| {
        c.query_row("SELECT id FROM queue_project_identity", [], |r| {
            r.get::<_, String>(0)
        })
    })
    .ok()
}

#[derive(Clone)]
struct AiConsoleMeta {
    job_id: String,
    project: Option<String>,
    label: String,
    unit_pt: String,
    unit_tech: String,
}

fn task_label_pt(task: &str) -> &str {
    match task {
        "selection" => "Seleção de Cortes",
        "selection_transformed" => "Seleção de Cortes (Vídeo transformado)",
        "packaging" => "Empacotamento",
        "thumbnail" => "Ideia de capa",
        "script" => "Roteiro",
        "script_block" => "Roteiro (bloco)",
        "angles" => "Ângulos do Roteiro",
        "translation" => "Tradução de legendas",
        other => other,
    }
}

fn unit_position(id: i64, task: &str) -> Option<(&'static str, i64, i64)> {
    projects::with_reader(|c| match task {
        "selection" | "selection_transformed" => c
            .query_row(
                "SELECT w.idx, r.windows_total FROM selection_windows w JOIN selection_runs r ON r.id=w.run_id WHERE w.job_id=?1",
                [id],
                |r| Ok(("Janela", r.get::<_, i64>(0)? + 1, r.get::<_, i64>(1)?)),
            )
            .optional(),
        "script_block" => c
            .query_row(
                "SELECT b.position, (SELECT COUNT(*) FROM script_blocks b2 WHERE b2.generation_id=b.generation_id) FROM script_block_versions v JOIN script_blocks b ON b.id=v.block_id WHERE v.job_id=?1",
                [id],
                |r| Ok(("Bloco", r.get::<_, i64>(0)? + 1, r.get::<_, i64>(1)?)),
            )
            .optional(),
        "translation" => c
            .query_row(
                "SELECT rj.batch_index, r.batches_total FROM translation_run_jobs rj JOIN translation_runs r ON r.id=rj.run_id WHERE rj.job_id=?1",
                [id],
                |r| Ok(("Bloco", r.get::<_, i64>(0)? + 1, r.get::<_, i64>(1)?)),
            )
            .optional(),
        _ => Ok(None),
    })
    .ok()
    .flatten()
    .filter(|(_, n, m)| *n > 0 && *m > 0)
}

fn build_console_meta(id: i64, task: &str, project: Option<String>) -> AiConsoleMeta {
    let (unit_pt, unit_tech) = match unit_position(id, task) {
        Some((kind, n, m)) => (
            format!(" · {kind} {n} de {m}"),
            format!(" unit={kind}:{n}/{m}"),
        ),
        None => (String::new(), String::new()),
    };
    AiConsoleMeta {
        job_id: id.to_string(),
        project,
        label: task_label_pt(task).to_owned(),
        unit_pt,
        unit_tech,
    }
}

fn emit_ai_console(meta: &AiConsoleMeta, level: ConsoleLevel, simple: &str, technical: &str) {
    emit_console(ConsoleDraft {
        job: &meta.job_id,
        project: meta.project.as_deref(),
        origin: "ai",
        level,
        kind: ConsoleKind::Milestone,
        simple,
        technical: Some(technical),
    });
}

fn describe_route(
    task: &str,
    explicit_profile: Option<&str>,
    target: &Target,
    profile_id: &str,
) -> (String, String) {
    let profile_label = resolve_route(task, explicit_profile)
        .ok()
        .filter(|r| profile_id.is_empty() || r.profile.id == profile_id)
        .map(|r| r.profile.label);
    match target {
        Target::Cli { name } => (
            crate::provider_cli::label(name).to_owned(),
            format!("provider=cli:{name}"),
        ),
        Target::OpenCode { model } => (
            format!("OpenCode CLI ({model})"),
            format!("provider=cli:opencode model={model}"),
        ),
        Target::Api {
            provider,
            model,
            local,
        } => {
            let simple = match (profile_label.as_deref(), model.is_empty()) {
                (Some(lbl), false) => format!("Perfil {lbl} ({model})"),
                (Some(lbl), true) => format!("Perfil {lbl}"),
                (None, false) if *local => format!("{provider} local ({model})"),
                (None, false) => format!("{provider} ({model})"),
                (None, true) if *local => format!("{provider} local"),
                (None, true) => provider.clone(),
            };
            let tech_prof = if profile_id.is_empty() {
                "-"
            } else {
                profile_id
            };
            let tech_model = if model.is_empty() { "-" } else { model };
            let tech = format!(
                "profile={tech_prof} provider={provider} model={tech_model} local={local}"
            );
            (simple, tech)
        }
    }
}

fn format_duration_pt(ms: u64) -> String {
    if ms < 1000 {
        format!("{ms} ms")
    } else {
        format!("{:.1} s", ms as f64 / 1000.0).replace('.', ",")
    }
}

fn format_tokens_pt(usage: Option<&Value>) -> (String, String) {
    let Some(u) = usage else {
        return (String::new(), String::new());
    };
    let inp = u.get("inputTokens").and_then(Value::as_u64);
    let out = u.get("outputTokens").and_then(Value::as_u64);
    match (inp, out) {
        (Some(i), Some(o)) => (
            format!("{} tokens ({i} entrada / {o} saída)", i.saturating_add(o)),
            format!("tokens_in={i} tokens_out={o}"),
        ),
        (Some(i), None) => (
            format!("{i} tokens de entrada"),
            format!("tokens_in={i}"),
        ),
        (None, Some(o)) => (
            format!("{o} tokens de saída"),
            format!("tokens_out={o}"),
        ),
        (None, None) => (String::new(), String::new()),
    }
}

fn format_cost_pt(
    target: &Target,
    profile_id: &str,
    entries: &[Value],
    usage: Option<&Value>,
    paid: bool,
) -> (String, String) {
    if target.is_cli() {
        return ("consome a cota do plano".into(), "cost=plan_quota".into());
    }
    if !paid {
        return ("custo US$ 0,00 (local)".into(), "cost=zero".into());
    }
    let profile_opt = (!profile_id.is_empty()).then_some(profile_id);
    let mut total_micro = 0_u64;
    let mut any_usd = false;
    let mut any_unknown = false;
    let mut all_zero = true;
    let fallback = usage.cloned().unwrap_or(Value::Null);
    let mut checked = false;
    for entry in entries {
        checked = true;
        match cost::actual_for(profile_opt, target, &entry["usage"]) {
            Ok(cost::Cost::Usd { micro_usd, .. }) => {
                any_usd = true;
                all_zero = false;
                total_micro = total_micro.saturating_add(micro_usd);
            }
            Ok(cost::Cost::Zero) => {}
            Ok(cost::Cost::PlanQuota) => {
                return ("consome a cota do plano".into(), "cost=plan_quota".into());
            }
            _ => {
                any_unknown = true;
                all_zero = false;
            }
        }
    }
    if !checked {
        match cost::actual_for(profile_opt, target, &fallback) {
            Ok(cost::Cost::Usd { micro_usd, .. }) => {
                any_usd = true;
                all_zero = false;
                total_micro = micro_usd;
            }
            Ok(cost::Cost::Zero) => {}
            Ok(cost::Cost::PlanQuota) => {
                return ("consome a cota do plano".into(), "cost=plan_quota".into());
            }
            _ => {
                any_unknown = true;
                all_zero = false;
            }
        }
    }
    if all_zero {
        return ("custo US$ 0,00 (local)".into(), "cost=zero".into());
    }
    if any_usd && !any_unknown {
        let usd = total_micro as f64 / 1_000_000.0;
        let simple = if total_micro == 0 {
            "custo US$ 0,00".to_owned()
        } else if total_micro < 10_000 {
            format!("custo US$ {:.4}", usd).replace('.', ",")
        } else {
            format!("custo US$ {:.2}", usd).replace('.', ",")
        };
        return (simple, format!("cost_micro_usd={total_micro}"));
    }
    ("custo desconhecido".into(), "cost=unknown".into())
}

fn emit(
    id: i64,
    task: &str,
    clip_id: Option<i64>,
    step: &str,
    percentage: u8,
    message: &str,
    error: Option<CoreError>,
) {
    let project = current_project_id();
    crate::emit_background(crate::ProgressEvent {
        job: id.to_string(),
        project,
        clip_id,
        stage: format!("ai:{task}:{step}"),
        percentage,
        message: message.into(),
        error,
    });
}

fn stage(id: i64, task: &str, clip_id: Option<i64>, step: &str, percentage: u8, message: &str) {
    let _ = projects::with_writer(|c| {
        c.execute(
            "UPDATE jobs SET progress=?2 WHERE id=?1 AND state='running'",
            (id, percentage),
        )?;
        Ok(())
    });
    emit(id, task, clip_id, step, percentage, message, None);
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
            "UPDATE jobs SET state='queued',result=NULL,started_at_ms=NULL WHERE id=?1 AND state='running'",
            [id],
        )?;
        Ok(())
    });
}

fn fail_fixed(id: i64, task: &str, clip_id: Option<i64>, e: CoreError) {
    let code = e.code.clone();
    settle(
        id,
        "failed",
        &json!({"outcome":"failed","code":code,"cost":"none"}),
    );
    let meta = build_console_meta(id, task, current_project_id());
    emit_ai_console(
        &meta,
        ConsoleLevel::Error,
        &format!("{}{} falhou ({code})", meta.label, meta.unit_pt),
        &format!(
            "job={id} task={task}{} stage=done outcome=failed code={code}",
            meta.unit_tech
        ),
    );
    emit(id, task, clip_id, "done", 0, "Tarefa de IA falhou", Some(e));
}

/// O pedido que o executor envia (o mesmo de `ai_task::run`), para estimar antes de enviar.
pub(super) fn request_of(unit: &Unit) -> Option<StructuredRequest> {
    request_for(unit.task, &unit.input)
}

/// O pedido de `input` para a Tarefa `task` (usado também por "refazer com outro perfil").
pub(super) fn request_for(task: &AiTask, input: &TaskInput) -> Option<StructuredRequest> {
    let (wire, _) = ai_task::check_definition(task).ok()?;
    Some(StructuredRequest {
        estimate_hint: input.estimate_hint.clone(),
        instruction: ai_task::normalized_prompt(task.prompt),
        transcript: input.transcript.clone(),
        schema: wire,
        native_schema: input.native_schema,
        max_output_tokens: Some(task.budget.max_output_tokens),
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
fn pending_usage(target: &Target, profile: &str, entries: &[Value]) -> Result<Value, CoreError> {
    let mut calls = 0_u64;
    let mut input = 0_u64;
    let mut output = 0_u64;
    let mut micro = 0_u64;
    let mut duration = 0_u64;
    let profile_opt = (!profile.is_empty()).then_some(profile);
    for entry in entries {
        calls = calls.saturating_add(entry["calls"].as_u64().unwrap_or(1));
        input = input.saturating_add(entry["usage"]["inputTokens"].as_u64().unwrap_or(0));
        output = output.saturating_add(entry["usage"]["outputTokens"].as_u64().unwrap_or(0));
        duration = duration.saturating_add(entry["durationMs"].as_u64().unwrap_or(0));
        if let cost::Cost::Usd { micro_usd, .. } =
            cost::actual_for(profile_opt, target, &entry["usage"])?
        {
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
            | "provider_daily_limit"
            | "request_too_large"
            | "cli_free_limit"
            | "provider_http"
            | "network"
            | "output_truncated"
            | "context_truncated"
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
    cli_transport: &Mutex<Option<Value>>,
    elapsed_ms: u64,
) {
    let each = estimate["maxMicroUsd"]
        .as_u64()
        .or_else(|| estimate["minMicroUsd"].as_u64());
    let mut entries = entries.to_vec();
    if let Ok(transport) = cli_transport.lock() {
        crate::provider::control::merge_transport(&mut entries, &transport);
    }
    for entry in &entries {
        let _ = cost::observe_entry(&route.1, &route.0, entry);
        let usage = if route.0.is_cli()
            || matches!(
                entry["code"].as_str(),
                Some("cancelled" | "timeout_uncertain")
            ) {
            Value::Null
        } else {
            entry["usage"].clone()
        };
        let profile = (!route.1.is_empty()).then_some(route.1.as_str());
        let Ok(cost) = cost::actual_for(profile, &route.0, &usage) else {
            continue;
        };
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
            transport: entry,
        });
    }
}

/// Executa o job `id`, já `running`. Resolve o estado final sozinho; só devolve o job à fila
/// quando o app fecha antes de qualquer envio (ou com um modelo local), ou quando o orçamento
/// acumulado pausa a fila antes de enviar.
pub(super) fn execute(id: i64, stop: &AtomicBool) {
    let unit = match load(id) {
        Ok(unit) => unit,
        Err(e) => return fail_fixed(id, "unknown", None, e),
    };
    let task = unit.task.id;
    let clip_id = clip_id_for(id, &unit);
    let meta = build_console_meta(id, task, current_project_id());
    let _ = projects::with_writer(|c| {
        c.execute("UPDATE jobs SET result=NULL WHERE id=?1", [id])?;
        Ok(())
    });
    stage(id, task, clip_id, "prepare", 0, "Preparando a Tarefa de IA");
    if stop.load(Ordering::SeqCst) {
        return requeue(id);
    }
    if is_cancelled(id) {
        settle(
            id,
            "cancelled",
            &json!({"outcome":"cancelled","cost":"zero"}),
        );
        emit_ai_console(
            &meta,
            ConsoleLevel::Warn,
            &format!("{}{} cancelada", meta.label, meta.unit_pt),
            &format!(
                "job={id} task={task}{} stage=done outcome=cancelled",
                meta.unit_tech
            ),
        );
        return emit(id, task, clip_id, "done", 0, "Tarefa de IA cancelada", None);
    }
    // Orçamento: a estimativa de antes de enviar é a do #40 (`cost::estimate`).
    let route = match route_of_profile(task, unit.paid, unit.profile.as_deref()) {
        Ok(route) => route,
        Err(e) => return fail_fixed(id, task, clip_id, e),
    };
    let (route_simple, route_tech) =
        describe_route(task, unit.profile.as_deref(), &route.0, &route.1);
    emit_ai_console(
        &meta,
        ConsoleLevel::Info,
        &format!(
            "{}{} — iniciando com {route_simple}",
            meta.label, meta.unit_pt
        ),
        &format!(
            "job={id} task={task}{} stage=prepare {route_tech}",
            meta.unit_tech
        ),
    );
    let estimate = request_of(&unit)
        .and_then(|request| cost::estimate_for(&route.0, &route.1, &request).ok())
        .unwrap_or_else(|| json!({"kind":"unknown"}));
    if let Some((code, message)) = job_limit(unit.task, &estimate) {
        return fail_fixed(id, task, clip_id, error(code, message));
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
                    "UPDATE jobs SET state='queued',attempts=attempts-1,result=NULL,started_at_ms=NULL WHERE id=?1 AND state='running'",
                    [id],
                )?;
                Ok(())
            });
            let reason = budget::pause_message(code);
            emit_ai_console(
                &meta,
                ConsoleLevel::Warn,
                &format!("{}{} pausada: {reason}", meta.label, meta.unit_pt),
                &format!(
                    "job={id} task={task}{} stage=paused scope={scope} key={key} code={code}",
                    meta.unit_tech
                ),
            );
            let e = error(code, reason);
            return emit(
                id,
                task,
                clip_id,
                "paused",
                0,
                "Fila pausada pelo orçamento",
                Some(e),
            );
        }
        Err(e) => return fail_fixed(id, task, clip_id, e),
    };
    let provider: SharedProvider = PROVIDER
        .lock()
        .ok()
        .and_then(|slot| slot.clone())
        .unwrap_or_else(|| {
            Arc::new(Configured {
                task: task.into(),
                local: !unit.paid,
                profile: unit.profile.clone(),
            })
        });
    let started = std::time::Instant::now();
    let wall = if route.0.is_cli() {
        Duration::MAX
    } else {
        let own = Duration::from_secs(unit.task.budget.max_wall_clock_secs);
        match budget::remaining_wall(task, unit.batch.as_deref()) {
            Ok(Some(remaining)) => own.min(remaining),
            Ok(None) => own,
            Err(e) => return fail_fixed(id, task, clip_id, e),
        }
    };
    let sent = AtomicBool::new(false);
    let repair_announced = Arc::new(AtomicBool::new(false));
    let call_log: Mutex<Vec<Value>> = Mutex::new(Vec::new());
    let cli_transport: Mutex<Option<Value>> = Mutex::new(None);
    let probe = Probe {
        inner: provider.as_ref(),
        sent: &sent,
        max_calls,
        log: &call_log,
        transport: &cli_transport,
        job: id,
        task: unit.task,
        batch: unit.batch.clone(),
        route: route.clone(),
        console_meta: &meta,
        repair_announced: Arc::clone(&repair_announced),
        deadline: started.checked_add(wall),
    };
    let token = CancelToken::new();
    let finished = AtomicBool::new(false);
    let shutdown = AtomicBool::new(false);
    let timed_out = AtomicBool::new(false);
    stage(id, task, clip_id, "call", 10, "Chamando o Provedor");
    emit_ai_console(
        &meta,
        ConsoleLevel::Info,
        &format!(
            "{}{} — consultando {route_simple}",
            meta.label, meta.unit_pt
        ),
        &format!(
            "job={id} task={task}{} stage=call {route_tech}",
            meta.unit_tech
        ),
    );
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
    let dur_pt = format_duration_pt(elapsed_ms);
    stage(id, task, clip_id, "verify", 80, "Conferindo a resposta");
    match run {
        Ok(out) => {
            let log = call_log.lock().map(|l| l.clone()).unwrap_or_default();
            if !repair_announced.swap(true, Ordering::SeqCst)
                && (out.calls > 1
                    || log
                        .iter()
                        .any(|e| e["attempt"].as_u64().is_some_and(|a| a > 0)))
            {
                emit_ai_console(
                    &meta,
                    ConsoleLevel::Warn,
                    &format!(
                        "{}{} — reparo automático aplicado ({} chamadas)",
                        meta.label, meta.unit_pt, out.calls
                    ),
                    &format!(
                        "job={id} task={task}{} stage=repair calls={}",
                        meta.unit_tech, out.calls
                    ),
                );
            }
            let entries = entries_of(&log, &out.usage, out.calls, "ok");
            record_calls(
                id,
                &unit,
                &route,
                &estimate,
                &entries,
                &cli_transport,
                elapsed_ms,
            );
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
            let (tokens_pt, tokens_tech) = format_tokens_pt(out.usage.as_ref());
            let (cost_pt, cost_tech) =
                format_cost_pt(&route.0, &route.1, &entries, out.usage.as_ref(), unit.paid);
            let metrics_pt = if tokens_pt.is_empty() {
                cost_pt
            } else {
                format!("{tokens_pt}, {cost_pt}")
            };
            let tokens_tech_part = if tokens_tech.is_empty() {
                String::new()
            } else {
                format!(" {tokens_tech}")
            };
            emit_ai_console(
                &meta,
                ConsoleLevel::Info,
                &format!(
                    "{}{} concluída em {dur_pt} — {metrics_pt}",
                    meta.label, meta.unit_pt
                ),
                &format!(
                    "job={id} task={task}{} stage=done outcome=ok calls={}{tokens_tech_part} {cost_tech} duration_ms={elapsed_ms} {route_tech}",
                    meta.unit_tech, out.calls
                ),
            );
            emit(
                id,
                task,
                clip_id,
                "done",
                100,
                "Tarefa de IA concluída",
                None,
            );
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
            let log = call_log.lock().map(|l| l.clone()).unwrap_or_default();
            let info = e.usage.clone().unwrap_or(Value::Null);
            let err_usage = info.get("usage").filter(|u| !u.is_null()).cloned();
            let err_calls = info["calls"].as_u64().unwrap_or(1);
            if !repair_announced.swap(true, Ordering::SeqCst)
                && (err_calls > 1
                    || log
                        .iter()
                        .any(|en| en["attempt"].as_u64().is_some_and(|a| a > 0)))
            {
                emit_ai_console(
                    &meta,
                    ConsoleLevel::Warn,
                    &format!(
                        "{}{} — tentativa de reparo automático ({err_calls} chamadas)",
                        meta.label, meta.unit_pt
                    ),
                    &format!(
                        "job={id} task={task}{} stage=repair calls={err_calls}",
                        meta.unit_tech
                    ),
                );
            }
            let mut billed_entries = Vec::new();
            if sent && reached_provider(&e.code) {
                let mut entries = entries_of(&log, &err_usage, err_calls, &e.code);
                // A última chamada chegou, mas não passou no schema nem nos verificadores; ou
                // foi cortada pelo limite de tempo do job.
                if let Some(last) = entries.last_mut() {
                    if last["code"] == "ok" || last["code"] == "cancelled" {
                        last["code"] = json!(e.code);
                    }
                }
                record_calls(
                    id,
                    &unit,
                    &route,
                    &estimate,
                    &entries,
                    &cli_transport,
                    elapsed_ms,
                );
                billed_entries = entries;
            }
            let unknown = how == Settle::Uncertain && unit.paid;
            let has_usage = e
                .usage
                .as_ref()
                .is_some_and(|u| u.get("usage").is_some_and(|inner| !inner.is_null()));
            let core: CoreError = e.clone().into();
            let mut result = json!({
                "outcome": match how { Settle::Uncertain => "uncertain", Settle::Cancelled => "cancelled", _ => "failed" },
                "code": e.code,
                "violations": e.violations,
                "usage": e.usage,
                "cost": cost_of(unit.paid, has_usage, unknown),
            });
            if let Some(reset) = e
                .usage
                .as_ref()
                .and_then(|u| u.get("resetAtMs"))
                .filter(|v| !v.is_null())
            {
                result["resetAtMs"] = reset.clone();
            }
            let (state, message) = match how {
                Settle::Requeue => unreachable!("handled above"),
                Settle::Uncertain => ("uncertain", "Resultado da chamada incerto"),
                Settle::Cancelled => ("cancelled", "Tarefa de IA cancelada"),
                Settle::Failed => ("failed", "Tarefa de IA falhou"),
            };
            settle(id, state, &result);
            let (tokens_pt, tokens_tech) = format_tokens_pt(err_usage.as_ref());
            let (cost_pt, cost_tech) = if sent && reached_provider(&e.code) {
                format_cost_pt(
                    &route.0,
                    &route.1,
                    &billed_entries,
                    err_usage.as_ref(),
                    unit.paid,
                )
            } else {
                (String::new(), String::new())
            };
            let level = match how {
                Settle::Failed => ConsoleLevel::Error,
                _ => ConsoleLevel::Warn,
            };
            let suffix_pt = match (tokens_pt.is_empty(), cost_pt.is_empty()) {
                (false, false) => format!(" — {tokens_pt}, {cost_pt}"),
                (false, true) => format!(" — {tokens_pt}"),
                (true, false) => format!(" — {cost_pt}"),
                (true, true) => String::new(),
            };
            let simple_console = match how {
                Settle::Uncertain => format!(
                    "{}{} terminou com resultado incerto ({}) em {dur_pt}{suffix_pt}",
                    meta.label, meta.unit_pt, e.code
                ),
                Settle::Cancelled => format!(
                    "{}{} cancelada em {dur_pt}{suffix_pt}",
                    meta.label, meta.unit_pt
                ),
                Settle::Failed => format!(
                    "{}{} falhou ({}) em {dur_pt}{suffix_pt}",
                    meta.label, meta.unit_pt, e.code
                ),
                Settle::Requeue => unreachable!("handled above"),
            };
            let tokens_tech_part = if tokens_tech.is_empty() {
                String::new()
            } else {
                format!(" {tokens_tech}")
            };
            let cost_tech_part = if cost_tech.is_empty() {
                String::new()
            } else {
                format!(" {cost_tech}")
            };
            emit_ai_console(
                &meta,
                level,
                &simple_console,
                &format!(
                    "job={id} task={task}{} stage=done outcome={state} code={}{tokens_tech_part}{cost_tech_part} duration_ms={elapsed_ms} {route_tech}",
                    meta.unit_tech, e.code
                ),
            );
            emit(id, task, clip_id, "done", 0, message, Some(core));
        }
    }
}

/// Custo estimado de repetir o job (ADR-0009, regra 5): modelo local é zero; para o resto, a
/// estimativa do #40 para a rota da Tarefa, ou `unknown` se não houver.
pub(super) fn estimate(id: i64) -> Value {
    if let Some(estimate) = crate::transcription::job_estimate(id) {
        return estimate;
    }
    let Ok(unit) = load(id) else {
        return json!({"kind":"unknown"});
    };
    if !unit.paid {
        return json!({"kind":"zero"});
    }
    let Ok(route) = route_of_profile(unit.task.id, true, unit.profile.as_deref()) else {
        return json!({"kind":"unknown"});
    };
    let Some(request) = request_of(&unit) else {
        return json!({"kind":"unknown"});
    };
    cost::estimate_for(&route.0, &route.1, &request).unwrap_or_else(|_| json!({"kind":"unknown"}))
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

    struct ConsoleTestProvider {
        simulate_repair: bool,
    }

    impl Provider for ConsoleTestProvider {
        fn structured(&self, _: &StructuredRequest) -> Result<Value, CoreError> {
            unreachable!("must call structured_with")
        }

        fn structured_with(
            &self,
            request: &StructuredRequest,
            _: &CancelToken,
        ) -> Result<Value, CoreError> {
            if self.simulate_repair {
                let mut log = crate::provider::control::CallLog::default();
                log.0.push(json!({
                    "attempt": 0,
                    "calls": 1,
                    "usage": {"inputTokens": 50, "outputTokens": 20},
                    "code": "invalid_json",
                }));
                let _ = crate::provider::control::before_call(request, &log.0)?;
                log.0.push(json!({
                    "attempt": 1,
                    "calls": 1,
                    "usage": {"inputTokens": 70, "outputTokens": 10},
                    "code": "ok",
                }));
                Ok(json!({
                    "data": {"schemaVersion": 1, "candidates": []},
                    "usage": {"inputTokens": 120, "outputTokens": 30},
                    "calls": 2,
                }))
            } else {
                Ok(json!({
                    "data": {"schemaVersion": 1, "candidates": []},
                    "usage": {"inputTokens": 10, "outputTokens": 5},
                    "calls": 1,
                }))
            }
        }
    }

    fn console_events_since(since_seq: u64, job: &str) -> Vec<Value> {
        let res = crate::dispatch("console.history", json!({}), &mut |_| {})
            .expect("console.history must succeed");
        res["items"]
            .as_array()
            .cloned()
            .unwrap_or_default()
            .into_iter()
            .filter(|ev| ev["seq"].as_u64().unwrap_or(0) > since_seq && ev["job"] == job)
            .collect()
    }

    fn latest_console_seq() -> u64 {
        let res = crate::dispatch("console.history", json!({}), &mut |_| {})
            .expect("console.history must succeed");
        res["items"]
            .as_array()
            .and_then(|a| a.last())
            .and_then(|ev| ev["seq"].as_u64())
            .unwrap_or(0)
    }

    #[test]
    fn console_emits_ai_metadata_repair_pause_and_never_leaks_content() {
        let root = tempfile::tempdir().expect("tempdir");
        let data_dir = root.path().join("data");
        let _guard = crate::test_env::set_data_dir(&data_dir);

        crate::dispatch(
            "projects.create",
            json!({"parent": root.path(), "name": "ConsoleAi"}),
            &mut |_| {},
        )
        .expect("projects.create");

        let route = (
            Target::Api {
                provider: "openai".into(),
                model: "gpt-test-model".into(),
                local: false,
            },
            "prof-console".into(),
        );
        set_ai_route(Some(route));
        crate::dispatch(
            "provider.prices.set",
            json!({
                "provider": "openai",
                "model": "gpt-test-model",
                "inputPerMillion": 100.0,
                "outputPerMillion": 200.0,
            }),
            &mut |_| {},
        )
        .expect("prices.set");

        set_ai_provider(Some(Arc::new(ConsoleTestProvider {
            simulate_repair: true,
        })));

        let secret_transcript = "SEGREDO_TRANSCRICAO_NAO_DEVE_SAIR_999";
        let input = TaskInput {
            transcript: secret_transcript.into(),
            context: json!({"ids": [1], "targetCandidates": 1}),
            ..Default::default()
        };
        let job1 = enqueue_ai("selection", &input, Safety::Paid).expect("enqueue job1");
        projects::with_writer(|c| {
            c.execute(
                "INSERT INTO sources(path,size,duration_us,partial_hash,metadata,permission,audio_track) VALUES ('s.mp4',1,1000,'h','{}','{}',0)",
                [],
            )?;
            let src = c.last_insert_rowid();
            c.execute(
                "INSERT INTO transcripts(source_id,audio_track,engine,model,revision,compute_type,state,resume_us,duration_us) VALUES (?1,0,'local','small','r','int8','complete',1000,1000)",
                [src],
            )?;
            let tr = c.last_insert_rowid();
            c.execute(
                "INSERT INTO selection_runs(transcript_id,task_version,prompt_sha256,profile,state,min_us,max_us,weights,plan_state,windows_total) VALUES (?1,3,'h','prof-console','running',1000,2000,'[]','full',2)",
                [tr],
            )?;
            let run = c.last_insert_rowid();
            c.execute(
                "INSERT INTO selection_windows(run_id,idx,first_id,last_id,start_us,end_us,job_id) VALUES (?1,0,1,1,0,1000,?2)",
                (run, job1),
            )?;
            c.execute("UPDATE jobs SET state='running' WHERE id=?1", [job1])?;
            Ok(())
        })
        .expect("seed selection window");

        let seq0 = latest_console_seq();
        let stop = AtomicBool::new(false);
        execute(job1, &stop);

        let evs1 = console_events_since(seq0, &job1.to_string());
        assert!(!evs1.is_empty(), "expected console events for job1");
        assert!(evs1.iter().all(|e| e["origin"] == "ai"));

        let joined1 = serde_json::to_string(&evs1).unwrap();
        assert!(joined1.contains("Seleção de Cortes"), "{joined1}");
        assert!(joined1.contains("Janela 1 de 2"), "{joined1}");
        assert!(joined1.contains("gpt-test-model"), "{joined1}");
        assert!(joined1.contains("reparo automático"), "{joined1}");
        assert!(
            joined1.contains("150 tokens (120 entrada / 30 saída)"),
            "{joined1}"
        );
        assert!(joined1.contains("tokens_in=120 tokens_out=30"), "{joined1}");
        assert!(joined1.contains("cost_micro_usd="), "{joined1}");
        assert!(joined1.contains("duration_ms="), "{joined1}");
        assert!(!joined1.contains(secret_transcript), "leaked transcript!");
        assert!(
            !joined1.contains("Nunca devolva tempos"),
            "leaked prompt text!"
        );

        // Caso 2: pausa por orçamento emite motivo legível.
        projects::with_writer(|c| {
            c.execute(
                "INSERT INTO ai_budgets(scope,key,max_calls,since) VALUES ('task','selection',0,0)",
                [],
            )?;
            Ok(())
        })
        .expect("insert budget");

        let job2 = enqueue_ai("selection", &input, Safety::Paid).expect("enqueue job2");
        projects::with_writer(|c| {
            c.execute("UPDATE jobs SET state='running' WHERE id=?1", [job2])?;
            Ok(())
        })
        .expect("mark job2 running");

        let seq1 = latest_console_seq();
        execute(job2, &stop);

        let evs2 = console_events_since(seq1, &job2.to_string());
        let joined2 = serde_json::to_string(&evs2).unwrap();
        assert!(evs2.iter().any(|e| e["level"] == "warn"), "{joined2}");
        assert!(joined2.contains("pausada"), "{joined2}");
        assert!(joined2.contains("limite de chamadas"), "{joined2}");
        assert!(joined2.contains("code=budget_calls"), "{joined2}");
        assert!(!joined2.contains(secret_transcript), "leaked transcript!");

        set_ai_provider(None);
        set_ai_route(None);
        let _ = crate::dispatch("projects.close", json!({}), &mut |_| {});
    }
}
