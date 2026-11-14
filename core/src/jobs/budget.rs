//! Orçamento acumulado por Tarefa de IA e por lote (#124; ADR-0009, regras 2 a 4).
//!
//! Um orçamento (`ai_budgets`) soma as linhas de `provider_costs` do escopo desde `since`.
//! Antes de cada chamada, o executor confere `acumulado + estimativa da chamada` contra cada
//! limite. Se a chamada não cabe, nada é enviado: o job volta à fila e só a fila daquele
//! escopo pausa (`ai_pauses`), com os resultados já gravados intactos. O usuário continua com
//! `jobs.budget.continue`, que pode trazer um novo teto.
//!
//! O CLI de assinatura conta só por chamadas (não informa tokens nem custo). Um Provedor de API
//! sem preço fica fora do teto de custo; num lote isso exige confirmação.
use super::*;
use crate::{provider::cost, CoreError};

fn error(code: &str, message: &str) -> CoreError {
    CoreError {
        code: code.into(),
        message: message.into(),
        usage: None,
    }
}

/// Máximo de chamadas HTTP de um pedido estruturado (a chamada e o reparo).
const MAX_CALLS_PER_REQUEST: u64 = 2;

struct Limits {
    calls: Option<i64>,
    tokens: Option<i64>,
    wall_ms: Option<i64>,
    cost: Option<i64>,
    unknown_confirmed: bool,
    since: i64,
}

fn limits(scope: &str, key: &str) -> Result<Option<Limits>, CoreError> {
    use rusqlite::OptionalExtension;
    projects::with_reader(|c| {
        c.query_row(
            "SELECT max_calls,max_tokens,max_wall_ms,max_cost_micro_usd,unknown_confirmed,since FROM ai_budgets WHERE scope=?1 AND key=?2",
            [scope, key],
            |r| {
                Ok(Limits {
                    calls: r.get(0)?,
                    tokens: r.get(1)?,
                    wall_ms: r.get(2)?,
                    cost: r.get(3)?,
                    unknown_confirmed: r.get::<_, i64>(4)? != 0,
                    since: r.get(5)?,
                })
            },
        )
        .optional()
    })
}

pub(super) enum Gate {
    /// Pode enviar, com no máximo `max_calls` chamadas HTTP (a chamada e o reparo).
    Go { max_calls: u64 },
    /// Nada é enviado: o escopo `scope`/`key` pausa por `code`.
    Pause {
        scope: &'static str,
        key: String,
        code: &'static str,
    },
}

/// Mensagem fixa do motivo de pausa (sem texto de Transcrição nem caminhos).
pub(super) fn pause_message(code: &str) -> &'static str {
    match code {
        "budget_calls" => "O limite de chamadas foi atingido; a fila foi pausada.",
        "budget_tokens" => "O limite de tokens foi atingido; a fila foi pausada.",
        "budget_time" => "O limite de tempo foi atingido; a fila foi pausada.",
        "budget_cost" => "O teto de custo foi atingido; a fila foi pausada.",
        _ => "O custo é desconhecido; confirme para continuar o lote.",
    }
}

/// O que uma chamada deve custar, lido da estimativa do #40 (`cost::estimate`).
struct Next {
    kind: String,
    tokens: i64,
    /// Teto da estimativa de custo (saída cheia); a mínima se o Provedor não limita a saída.
    micro_usd: Option<i64>,
}

fn next_call(estimate: &Value) -> Next {
    let input = estimate["inputTokens"].as_i64().unwrap_or(0);
    let output = estimate["maxOutputTokens"].as_i64().unwrap_or(0);
    Next {
        kind: estimate["kind"].as_str().unwrap_or("unknown").into(),
        tokens: input + output,
        micro_usd: estimate["maxMicroUsd"]
            .as_i64()
            .or_else(|| estimate["minMicroUsd"].as_i64()),
    }
}

/// Primeiro limite que `n` chamadas a mais violariam, ou `None` se couberem.
fn violation(
    scope: &str,
    limits: &Limits,
    used: &Value,
    next: &Next,
    n: i64,
) -> Option<&'static str> {
    let plan_quota = next.kind == "plan_quota";
    if limits
        .calls
        .is_some_and(|max| used["calls"].as_i64().unwrap_or(0) + n > max)
    {
        return Some("budget_calls");
    }
    if !plan_quota
        && limits.tokens.is_some_and(|max| {
            used["inputTokens"].as_i64().unwrap_or(0)
                + used["outputTokens"].as_i64().unwrap_or(0)
                + n * next.tokens
                > max
        })
    {
        return Some("budget_tokens");
    }
    if limits
        .wall_ms
        .is_some_and(|max| used["durationMs"].as_i64().unwrap_or(0) >= max)
    {
        return Some("budget_time");
    }
    if let Some(max) = limits.cost {
        match next.kind.as_str() {
            "usd" => {
                let each = next.micro_usd.unwrap_or(0);
                if used["microUsd"].as_i64().unwrap_or(0) + n * each > max {
                    return Some("budget_cost");
                }
            }
            // Sem preço, o lote não tem como medir o teto: só segue com confirmação.
            "unknown" if scope == "batch" && !limits.unknown_confirmed => {
                return Some("cost_unknown");
            }
            _ => {}
        }
    }
    None
}

/// Decide se a próxima chamada pode sair. `estimate` é o de `cost::estimate` da rota do job;
/// `job_max_calls` é o `max_calls` do orçamento da própria Tarefa.
pub(super) fn gate(
    task: &str,
    batch: Option<&str>,
    estimate: &Value,
    job_max_calls: u64,
) -> Result<Gate, CoreError> {
    let next = next_call(estimate);
    let mut scopes: Vec<(&'static str, String, Limits)> = Vec::new();
    if let Some(l) = limits("task", task)? {
        scopes.push(("task", task.into(), l));
    }
    if let Some(batch) = batch {
        if let Some(l) = limits("batch", batch)? {
            scopes.push(("batch", batch.into(), l));
        }
    }
    let mut used = Vec::new();
    for (scope, key, l) in &scopes {
        used.push(cost::totals_since(scope, key, l.since)?);
    }
    let ceiling = job_max_calls.min(MAX_CALLS_PER_REQUEST);
    for n in (1..=ceiling).rev() {
        let blocked = scopes
            .iter()
            .zip(&used)
            .any(|((scope, _, l), u)| violation(scope, l, u, &next, n as i64).is_some());
        if !blocked {
            return Ok(Gate::Go { max_calls: n });
        }
    }
    // Nem uma chamada cabe: pausa o primeiro escopo que a recusa (ou só segue, sem teto algum,
    // se a Tarefa não permite nenhuma chamada: quem trata é o limite por job).
    for ((scope, key, l), u) in scopes.iter().zip(&used) {
        if let Some(code) = violation(scope, l, u, &next, 1) {
            return Ok(Gate::Pause {
                scope,
                key: key.clone(),
                code,
            });
        }
    }
    Ok(Gate::Go { max_calls: 0 })
}

pub(super) fn pause(scope: &str, key: &str, code: &str) {
    let _ = projects::with_writer(|c| {
        c.execute(
            "INSERT INTO ai_pauses(scope,key,reason,created_at) VALUES (?1,?2,?3,?4) ON CONFLICT(scope,key) DO UPDATE SET reason=excluded.reason",
            rusqlite::params![scope, key, code, cost::now_micros()],
        )?;
        Ok(())
    });
}

fn scope_key(v: &Value) -> Result<(&'static str, String), CoreError> {
    let invalid = || error("invalid_budget", "Orçamento inválido.");
    let scope = match v["scope"].as_str() {
        Some("task") => "task",
        Some("batch") => "batch",
        _ => return Err(invalid()),
    };
    let key = v["key"]
        .as_str()
        .map(str::trim)
        .filter(|k| !k.is_empty() && k.len() <= 80);
    Ok((scope, key.ok_or_else(invalid)?.to_owned()))
}

/// Um limite do pedido: ausente mantém, `null` tira, número não negativo põe.
fn field(v: &Value, name: &str, current: Option<i64>) -> Result<Option<i64>, CoreError> {
    match v.get(name) {
        None => Ok(current),
        Some(Value::Null) => Ok(None),
        Some(n) => n
            .as_i64()
            .filter(|n| *n >= 0)
            .map(Some)
            .ok_or_else(|| error("invalid_budget", "Orçamento inválido.")),
    }
}

fn save(v: &Value, resume: bool) -> CommandResult {
    let (scope, key) = scope_key(v)?;
    let old = limits(scope, &key)?;
    let get = |f: fn(&Limits) -> Option<i64>| old.as_ref().and_then(f);
    let calls = field(v, "maxCalls", get(|l| l.calls))?;
    let tokens = field(v, "maxTokens", get(|l| l.tokens))?;
    let wall = field(v, "maxWallMs", get(|l| l.wall_ms))?;
    let cost_cap = field(v, "maxCostMicroUsd", get(|l| l.cost))?;
    let confirmed = v["confirmed"] == true || old.as_ref().is_some_and(|l| l.unknown_confirmed);
    if resume {
        // Pausa por custo desconhecido: só continua depois de o usuário confirmar.
        let reason: Option<String> = projects::with_reader(|c| {
            use rusqlite::OptionalExtension;
            c.query_row(
                "SELECT reason FROM ai_pauses WHERE scope=?1 AND key=?2",
                [scope, key.as_str()],
                |r| r.get(0),
            )
            .optional()
        })?;
        if reason.as_deref() == Some("cost_unknown") && !confirmed {
            return Err(CoreError {
                code: "confirmation_required".into(),
                message: "Confirme que o custo deste lote é desconhecido.".into(),
                usage: Some(json!({"reason":"cost_unknown"})),
            });
        }
    }
    let since = if v["resetUsage"] == true {
        cost::now_micros()
    } else {
        old.as_ref().map_or_else(cost::now_micros, |l| l.since)
    };
    projects::with_writer(|c| {
        c.execute(
            "INSERT INTO ai_budgets(scope,key,max_calls,max_tokens,max_wall_ms,max_cost_micro_usd,unknown_confirmed,since) VALUES (?1,?2,?3,?4,?5,?6,?7,?8) ON CONFLICT(scope,key) DO UPDATE SET max_calls=?3,max_tokens=?4,max_wall_ms=?5,max_cost_micro_usd=?6,unknown_confirmed=?7,since=?8",
            rusqlite::params![scope, key, calls, tokens, wall, cost_cap, confirmed, since],
        )?;
        if resume {
            c.execute(
                "DELETE FROM ai_pauses WHERE scope=?1 AND key=?2",
                [scope, key.as_str()],
            )?;
        }
        Ok(())
    })?;
    view(Some((scope, key)))
}

fn view(only: Option<(&str, String)>) -> CommandResult {
    let rows: Vec<(String, String, [Option<i64>; 4], bool, i64, Option<String>)> =
        projects::with_reader(|c| {
            let mut s = c.prepare("SELECT b.scope,b.key,b.max_calls,b.max_tokens,b.max_wall_ms,b.max_cost_micro_usd,b.unknown_confirmed,b.since,(SELECT reason FROM ai_pauses p WHERE p.scope=b.scope AND p.key=b.key) FROM ai_budgets b ORDER BY b.scope,b.key")?;
            let rows = s.query_map([], |r| {
                Ok((
                    r.get(0)?,
                    r.get(1)?,
                    [r.get(2)?, r.get(3)?, r.get(4)?, r.get(5)?],
                    r.get::<_, i64>(6)? != 0,
                    r.get(7)?,
                    r.get(8)?,
                ))
            })?;
            rows.collect::<rusqlite::Result<Vec<_>>>()
        })?;
    let mut out = Vec::new();
    for (scope, key, [calls, tokens, wall, cost_cap], confirmed, since, paused) in rows {
        if only.as_ref().is_some_and(|(s, k)| *s != scope || *k != key) {
            continue;
        }
        out.push(json!({
            "scope": scope,
            "key": key,
            "maxCalls": calls,
            "maxTokens": tokens,
            "maxWallMs": wall,
            "maxCostMicroUsd": cost_cap,
            "unknownConfirmed": confirmed,
            "since": since,
            "usage": cost::totals_since(&scope, &key, since)?,
            "paused": paused,
        }));
    }
    Ok(json!({"budgets": out}))
}

fn cmd_get(_: Value, _: &mut EventSink<'_>) -> CommandResult {
    view(None)
}
fn cmd_set(v: Value, _: &mut EventSink<'_>) -> CommandResult {
    save(&v, false)
}
fn cmd_continue(v: Value, _: &mut EventSink<'_>) -> CommandResult {
    save(&v, true)
}
inventory::submit! { CommandRegistration { name: "jobs.budget.get", execute: cmd_get } }
inventory::submit! { CommandRegistration { name: "jobs.budget.set", execute: cmd_set } }
inventory::submit! { CommandRegistration { name: "jobs.budget.continue", execute: cmd_continue } }
