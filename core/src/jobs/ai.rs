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
    provider::{CancelToken, Provider, StructuredRequest},
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
            let estimate = crate::dispatch("provider.cost.estimate", args.clone(), &mut |_| {})?;
            if estimate["kind"] != "zero" {
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
    job: i64,
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
        self.inner.structured_with(request, cancel)
    }
}

inventory::submit! { projects::Migration { id: "0121_001_ai_jobs", sql: "ALTER TABLE jobs ADD COLUMN payload TEXT; ALTER TABLE jobs ADD COLUMN result TEXT;" } }

/// Enfileira uma unidade de trabalho da Tarefa de IA `task`. `safety` é `Paid` para qualquer
/// Provedor que não seja um modelo local (API remota ou CLI de assinatura).
pub fn enqueue_ai(task: &str, input: &TaskInput, safety: Safety) -> Result<i64, CoreError> {
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
        c.execute(
            "INSERT INTO jobs(kind,safety,state,payload) VALUES (?1,?2,'queued',?3)",
            (format!("{KIND_PREFIX}{task}"), safety, payload),
        )?;
        Ok(c.last_insert_rowid())
    })
}

struct Unit {
    task: &'static AiTask,
    input: TaskInput,
    paid: bool,
}

fn load(id: i64) -> Result<Unit, CoreError> {
    let (safety, payload): (String, Option<String>) = projects::with_reader(|c| {
        c.query_row("SELECT safety,payload FROM jobs WHERE id=?1", [id], |r| {
            Ok((r.get(0)?, r.get(1)?))
        })
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

/// Executa o job `id`, já `running`. Resolve o estado final sozinho; só devolve o job à fila
/// quando o app fecha antes de qualquer envio (ou com um modelo local).
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
    let probe = Probe {
        inner: provider.as_ref(),
        sent: &sent,
        job: id,
    };
    let token = CancelToken::new();
    let finished = AtomicBool::new(false);
    let shutdown = AtomicBool::new(false);
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
                std::thread::sleep(Duration::from_millis(25));
            }
        });
        let run = ai_task::run(unit.task, &unit.input, &probe, &token);
        finished.store(true, Ordering::SeqCst);
        run
    });
    stage(id, task, "verify", 80, "Conferindo a resposta");
    match run {
        Ok(out) => {
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
        Err(e) => {
            let sent = sent.load(Ordering::SeqCst);
            let how = classify(&e.code, sent, unit.paid, shutdown.load(Ordering::SeqCst));
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
                Settle::Requeue => return requeue(id),
                Settle::Uncertain => ("uncertain", "Resultado da chamada incerto"),
                Settle::Cancelled => ("cancelled", "Tarefa de IA cancelada"),
                Settle::Failed => ("failed", "Tarefa de IA falhou"),
            };
            settle(id, state, &result);
            emit(id, task, "done", 0, message, Some(core));
        }
    }
}

/// Custo estimado de repetir o job (ADR-0009, regra 5): modelo local é zero; para o resto,
/// `provider.cost.estimate` da rota da tarefa, ou `unknown` se não houver estimativa.
pub(super) fn estimate(id: i64) -> Value {
    let Ok(unit) = load(id) else {
        return json!({"kind":"unknown"});
    };
    if !unit.paid {
        return json!({"kind":"zero"});
    }
    let Ok((wire, _)) = ai_task::check_definition(unit.task) else {
        return json!({"kind":"unknown"});
    };
    let request = StructuredRequest {
        instruction: ai_task::normalized_prompt(unit.task.prompt),
        transcript: unit.input.transcript,
        schema: wire,
        native_schema: unit.input.native_schema,
        max_output_tokens: Some(unit.task.budget.max_output_tokens),
    };
    let Ok(mut args) = serde_json::to_value(&request) else {
        return json!({"kind":"unknown"});
    };
    args["task"] = json!(unit.task.id);
    crate::dispatch("provider.cost.estimate", args, &mut |_| {})
        .unwrap_or_else(|_| json!({"kind":"unknown"}))
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
