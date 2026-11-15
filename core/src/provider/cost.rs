//! Cost of Provider tasks: estimate before, real value after, price table and Project record.
use super::StructuredRequest;
use crate::{projects, CommandRegistration, CommandResult, CoreError, EventSink};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::{fs, path::PathBuf, sync::Mutex};

/// Anthropic requires a limit; this mirrors the adapter default.
const ANTHROPIC_DEFAULT_MAX_OUTPUT_TOKENS: u64 = 8192;
/// Input tokens are estimated as one token per 4 characters, rounded up.
pub const CHARS_PER_TOKEN: u64 = 4;
const EMBEDDED: &str = include_str!("prices.json");
static LOCK: Mutex<()> = Mutex::new(());
mod catalog;
pub use catalog::{Price, Tier};

fn error(code: &str, message: &str) -> CoreError {
    CoreError {
        code: code.into(),
        message: message.into(),
        usage: None,
    }
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct Table {
    updated_at: String,
    prices: Vec<Price>,
}
#[derive(Default, Serialize, Deserialize)]
struct Overrides {
    prices: Vec<Price>,
}
fn embedded() -> Table {
    serde_json::from_str(EMBEDDED).expect("embedded price table is valid")
}
fn overrides_path() -> Result<PathBuf, CoreError> {
    if let Some(dir) = std::env::var_os("CLIPES_DATA_DIR") {
        return Ok(PathBuf::from(dir).join("provider-prices.json"));
    }
    #[cfg(test)]
    return Ok(std::env::temp_dir().join(format!(
        "clipes-price-overrides-test-{}.json",
        std::process::id()
    )));
    #[cfg(not(test))]
    directories::ProjectDirs::from("io", "github.gustavohooo", "clipes")
        .map(|p| p.config_dir().join("provider-prices.json"))
        .ok_or_else(|| error("settings", "Could not locate settings directory"))
}
fn read_overrides() -> Result<Overrides, CoreError> {
    match fs::read(overrides_path()?) {
        Ok(b) => serde_json::from_slice::<Overrides>(&b)
            .ok()
            .filter(|o| o.prices.iter().all(valid_price))
            .ok_or_else(|| error("settings", "Could not read price overrides")),
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(Overrides::default()),
        Err(_) => Err(error("settings", "Could not read price overrides")),
    }
}
fn write_overrides(o: &Overrides) -> Result<(), CoreError> {
    let p = overrides_path()?;
    fs::create_dir_all(p.parent().unwrap())
        .map_err(|_| error("settings", "Could not save price overrides"))?;
    fs::write(
        p,
        serde_json::to_vec(o).map_err(|_| error("settings", "Could not save price overrides"))?,
    )
    .map_err(|_| error("settings", "Could not save price overrides"))
}

/// Where the provider that will run a task sends its text.
#[derive(Clone, Debug, PartialEq)]
pub enum Target {
    /// Codex or Claude Code subscription: no money value, consumes the plan quota.
    Cli { name: String },
    /// HTTP adapter (`openai`, `anthropic`, `gemini`); `local` means loopback.
    Api {
        provider: String,
        model: String,
        local: bool,
    },
}
impl Target {
    fn label(&self) -> (String, String) {
        match self {
            Target::Cli { name } => (format!("cli:{name}"), String::new()),
            Target::Api {
                provider, model, ..
            } => (provider.clone(), model.clone()),
        }
    }
}

#[derive(Clone, Debug, PartialEq)]
pub enum Cost {
    /// Local model: always zero.
    Zero,
    /// CLI subscription: no money value.
    PlanQuota,
    /// No known price, or tokens not reported. Never zero.
    Unknown,
    Usd {
        micro_usd: u64,
        source: &'static str,
    },
}
impl Cost {
    fn kind(&self) -> &'static str {
        match self {
            Cost::Zero => "zero",
            Cost::PlanQuota => "plan_quota",
            Cost::Unknown => "unknown",
            Cost::Usd { .. } => "usd",
        }
    }
    fn micro(&self) -> Option<u64> {
        match self {
            Cost::Usd { micro_usd, .. } => Some(*micro_usd),
            Cost::Zero => Some(0),
            _ => None,
        }
    }
    fn source(&self) -> Option<&'static str> {
        match self {
            Cost::Usd { source, .. } => Some(source),
            _ => None,
        }
    }
}

/// An override wins over the embedded table; the match is exact on provider and model.
pub fn price_for(provider: &str, model: &str) -> Result<Option<(Price, &'static str)>, CoreError> {
    let _g = LOCK
        .lock()
        .map_err(|_| error("settings", "Could not access price overrides"))?;
    let find = |list: Vec<Price>| {
        list.into_iter()
            .find(|p| p.provider == provider && p.model == model)
    };
    if let Some(mut p) = find(read_overrides()?.prices) {
        // A flat override replaces all tariffs, but does not erase known model limits.
        if let Some(base) = find(embedded().prices) {
            p.context_window = p.context_window.or(base.context_window);
            p.max_output = p.max_output.or(base.max_output);
            p.limits_source = p.limits_source.or(base.limits_source).or(base.source);
        }
        return Ok(Some((p, "override")));
    }
    Ok(find(embedded().prices).map(|p| (p, "table")))
}

fn micro_usd(tokens: u64, per_million: f64) -> u64 {
    // A price per million tokens in USD equals micro-USD per token.
    (tokens as f64 * per_million).round() as u64
}

/// The single point that turns tokens into micro-USD for a priced model. It receives the
/// input tokens of the request so context tiers (research #115, a separate ticket) can replace
/// the flat rate here without touching the callers.
pub(crate) fn price_micro_usd(price: &Price, input_tokens: u64, output_tokens: u64) -> u64 {
    let (input, output) = price.rates(input_tokens);
    micro_usd(input_tokens, input).saturating_add(micro_usd(output_tokens, output))
}

/// Temporary interval over chars/4 and the measured full format's chars/2.4 (#115).
/// Replaced by the shared range estimator when #140 is integrated.
fn input_range(input: u64) -> (u64, u64) {
    (input, input.saturating_mul(5).div_ceil(3))
}

/// The one estimator of input tokens (chars/4 today; #115 found it undercounts, and a ticket of
/// its own will replace it). Every budget check and estimate goes through here.
pub fn estimate_input_tokens(request: &StructuredRequest) -> u64 {
    let chars = request.instruction.chars().count()
        + request.transcript.chars().count()
        + request.schema.to_string().chars().count();
    (chars as u64).div_ceil(CHARS_PER_TOKEN)
}

/// Estimated cost before running: input from the prompt heuristic, output capped by
/// `maxOutputTokens`. Min is input only; max adds the full output ceiling.
pub fn estimate(target: &Target, request: &StructuredRequest) -> Result<Value, CoreError> {
    let input = estimate_input_tokens(request);
    estimate_with_input(target, request, input)
}

/// Same estimator with input corrected by the usage of the preceding call.
pub(crate) fn estimate_with_input(
    target: &Target,
    request: &StructuredRequest,
    input: u64,
) -> Result<Value, CoreError> {
    let (low_input, high_input) = input_range(input);
    let mut tier = Value::Null;
    let (kind, ceiling, min, max, source) = match target {
        Target::Cli { .. } => ("plan_quota", None, None, None, None),
        Target::Api { local: true, .. } => {
            ("zero", request.max_output_tokens, Some(0), Some(0), None)
        }
        Target::Api {
            provider, model, ..
        } => {
            let ceiling = request.max_output_tokens.or(if provider == "anthropic" {
                Some(ANTHROPIC_DEFAULT_MAX_OUTPUT_TOKENS)
            } else {
                None
            });
            match price_for(provider, model)? {
                None => ("unknown", ceiling, None, None, None),
                Some((p, source)) => {
                    if !p.tiers.is_empty() {
                        let selected = p.tier(high_input);
                        tier = json!({
                            "aboveInputTokens": selected.map(|t| t.above_input_tokens),
                            "upToInputTokens": p.tiers.iter().find(|t| t.above_input_tokens >= high_input).map(|t| t.above_input_tokens),
                            "crossesThreshold": p.tiers.iter().any(|t| low_input <= t.above_input_tokens && high_input > t.above_input_tokens),
                        });
                    }
                    let low = price_micro_usd(&p, low_input, 0);
                    (
                        "usd",
                        ceiling,
                        Some(low),
                        ceiling.map(|c| price_micro_usd(&p, high_input, c)),
                        Some(source),
                    )
                }
            }
        }
    };
    Ok(json!({
        "kind": kind,
        "inputTokens": input,
        "inputTokensRange": {"min":low_input,"max":high_input},
        "tier": tier,
        "maxOutputTokens": ceiling,
        "minMicroUsd": min,
        "maxMicroUsd": max,
        "priceSource": source,
        "tableUpdatedAt": embedded().updated_at,
        "heuristic": "chars/4-to-chars/2.4",
    }))
}

/// Real cost from the `usage` returned by the adapter (both token counts are needed).
pub fn actual(target: &Target, usage: &Value) -> Result<Cost, CoreError> {
    Ok(match target {
        Target::Cli { .. } => Cost::PlanQuota,
        Target::Api { local: true, .. } => Cost::Zero,
        Target::Api {
            provider, model, ..
        } => {
            let (Some(i), Some(o)) = (
                usage["inputTokens"].as_u64(),
                usage["outputTokens"].as_u64(),
            ) else {
                return Ok(Cost::Unknown);
            };
            match price_for(provider, model)? {
                None => Cost::Unknown,
                Some((p, source)) => Cost::Usd {
                    micro_usd: price_micro_usd(&p, i, o),
                    source,
                },
            }
        }
    })
}

fn cost_json(c: &Cost) -> Value {
    json!({"kind":c.kind(),"microUsd":c.micro(),"priceSource":c.source()})
}

inventory::submit! { projects::Migration { id: "0040_001_provider_costs", sql: "CREATE TABLE provider_costs (id INTEGER PRIMARY KEY, task TEXT NOT NULL, batch TEXT, provider TEXT NOT NULL, model TEXT NOT NULL, input_tokens INTEGER, output_tokens INTEGER, calls INTEGER NOT NULL, cost_kind TEXT NOT NULL CHECK(cost_kind IN ('usd','zero','plan_quota','unknown')), cost_micro_usd INTEGER, price_source TEXT, table_updated_at TEXT NOT NULL, created_at INTEGER NOT NULL DEFAULT (CAST(strftime('%s','now') AS INTEGER) * 1000000)); CREATE INDEX provider_costs_batch ON provider_costs(batch);" } }

inventory::submit! { projects::Migration { id: "0120_001_provider_costs_profile", sql: "ALTER TABLE provider_costs ADD COLUMN profile TEXT;" } }

// #124: one row per call (and per repair), linked to job, task version and outcome. The columns
// are all nullable, so rows written by #40 and #120 stay readable. `jobs.batch` labels a batch
// (#56); `ai_budgets` holds the accumulated limits per task or batch and `ai_pauses` the queues
// that stopped on one.
inventory::submit! { projects::Migration { id: "0124_001_ai_call_costs_and_budgets", sql: "ALTER TABLE provider_costs ADD COLUMN job_id INTEGER; ALTER TABLE provider_costs ADD COLUMN task_version INTEGER; ALTER TABLE provider_costs ADD COLUMN attempt INTEGER CHECK(attempt IS NULL OR attempt IN (0,1)); ALTER TABLE provider_costs ADD COLUMN outcome TEXT CHECK(outcome IS NULL OR outcome IN ('ok','invalid_json','truncated','refused','timeout_uncertain','rate_limit','provider_http','cancelled')); ALTER TABLE provider_costs ADD COLUMN code TEXT; ALTER TABLE provider_costs ADD COLUMN estimate_micro_usd INTEGER; ALTER TABLE provider_costs ADD COLUMN duration_ms INTEGER; CREATE INDEX provider_costs_job ON provider_costs(job_id); ALTER TABLE jobs ADD COLUMN batch TEXT; CREATE TABLE ai_budgets (scope TEXT NOT NULL CHECK(scope IN ('task','batch')), key TEXT NOT NULL, max_calls INTEGER, max_tokens INTEGER, max_wall_ms INTEGER, max_cost_micro_usd INTEGER, unknown_confirmed INTEGER NOT NULL DEFAULT 0, since INTEGER NOT NULL, PRIMARY KEY(scope,key)); CREATE TABLE ai_pauses (scope TEXT NOT NULL CHECK(scope IN ('task','batch')), key TEXT NOT NULL, reason TEXT NOT NULL, created_at INTEGER NOT NULL DEFAULT (CAST(strftime('%s','now') AS INTEGER) * 1000000), PRIMARY KEY(scope,key));" } }

/// Microseconds since the Unix epoch: the clock of `provider_costs.created_at` and of the
/// `since` of a budget, so a budget reset never counts rows written before it.
pub fn now_micros() -> i64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map_or(0, |d| d.as_micros() as i64)
}

/// Normalizes a typed error code to one of the eight outcomes stored in `provider_costs.outcome`.
/// The raw code is kept in its own column. Codes with no better match (`network`) map to
/// `provider_http`; a response that failed schema or verification maps to `invalid_json`.
pub fn outcome_of(code: &str) -> &'static str {
    match code {
        "ok" => "ok",
        "output_truncated" | "truncated" => "truncated",
        "refusal" | "refused" => "refused",
        "timeout_uncertain" | "budget_time" => "timeout_uncertain",
        "rate_limit" => "rate_limit",
        "cancelled" => "cancelled",
        "invalid_json"
        | "invalid_response"
        | "output_invalid"
        | "verification_failed"
        | "budget_calls" => "invalid_json",
        _ => "provider_http",
    }
}

/// One call to the Provider, as written to `provider_costs`.
pub struct CallRow<'a> {
    pub profile: Option<&'a str>,
    pub target: &'a Target,
    pub task: &'a str,
    pub task_version: Option<u32>,
    pub batch: Option<&'a str>,
    pub job: Option<i64>,
    /// 0 for the call, 1 for the repair.
    pub attempt: Option<u8>,
    pub usage: &'a Value,
    pub calls: u64,
    pub cost: &'a Cost,
    pub code: &'a str,
    pub estimate_micro_usd: Option<u64>,
    pub duration_ms: Option<u64>,
}

/// Records one call with its job, outcome and estimate (#124).
pub fn record_call(row: &CallRow<'_>) -> Result<(), CoreError> {
    let (provider, model) = row.target.label();
    let table = embedded().updated_at;
    projects::with_writer(|c| {
        c.execute(
            "INSERT INTO provider_costs(task,batch,provider,model,input_tokens,output_tokens,calls,cost_kind,cost_micro_usd,price_source,table_updated_at,profile,job_id,task_version,attempt,outcome,code,estimate_micro_usd,duration_ms,created_at) VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9,?10,?11,?12,?13,?14,?15,?16,?17,?18,?19,?20)",
            rusqlite::params![
                row.task,
                row.batch,
                provider,
                model,
                row.usage["inputTokens"].as_u64().map(|v| v as i64),
                row.usage["outputTokens"].as_u64().map(|v| v as i64),
                row.calls as i64,
                row.cost.kind(),
                row.cost.micro().map(|v| v as i64),
                row.cost.source(),
                table,
                row.profile,
                row.job,
                row.task_version.map(i64::from),
                row.attempt.map(i64::from),
                outcome_of(row.code),
                row.code,
                row.estimate_micro_usd.map(|v| v as i64),
                row.duration_ms.map(|v| v as i64),
                now_micros()
            ],
        )?;
        Ok(())
    })
}

/// The Provider that serves `task` now: its target and the id of its profile. A "local only"
/// task fails here, before any call.
pub fn route_for(task: &str) -> Result<(Target, String), CoreError> {
    target_now(Some(task), None)
}

/// Totals of `provider_costs` grouped by `column` (`task`, `profile` or `batch`), keyed by the
/// column value; rows with a null key are left out. Unknown cost is counted apart, never as zero.
pub fn totals_by(column: &str) -> Result<std::collections::HashMap<String, Value>, CoreError> {
    let column = match column {
        "task" | "profile" | "batch" => column,
        _ => return Err(error("invalid_request", "Invalid cost grouping")),
    };
    projects::with_reader(|c| {
        let mut s = c.prepare(&format!("SELECT {column},{TOTALS} FROM provider_costs WHERE {column} IS NOT NULL GROUP BY {column}"))?;
        let rows = s.query_map([], |r| Ok((r.get::<_, String>(0)?, totals_row(r, 1)?)))?;
        rows.collect::<rusqlite::Result<std::collections::HashMap<_, _>>>()
    })
}

const TOTALS: &str = "COALESCE(SUM(calls),0),COALESCE(SUM(input_tokens),0),COALESCE(SUM(output_tokens),0),COALESCE(SUM(CASE WHEN cost_kind IN ('usd','zero') THEN cost_micro_usd ELSE 0 END),0),COALESCE(SUM(cost_kind='unknown'),0),COALESCE(SUM(cost_kind='plan_quota'),0),COALESCE(SUM(duration_ms),0)";

/// `{calls, inputTokens, outputTokens, microUsd, unknownCostCalls, planQuotaCalls, durationMs,
/// costLabel}`. `microUsd` sums only what has a known price; `costLabel` says what the sum
/// leaves out ("custo desconhecido", "consome a cota do plano") and is null when it leaves out
/// nothing.
pub(crate) fn totals_row(r: &rusqlite::Row<'_>, at: usize) -> rusqlite::Result<Value> {
    let (unknown, plan): (i64, i64) = (r.get(at + 4)?, r.get(at + 5)?);
    Ok(json!({
        "calls": r.get::<_, i64>(at)?,
        "inputTokens": r.get::<_, i64>(at + 1)?,
        "outputTokens": r.get::<_, i64>(at + 2)?,
        "microUsd": r.get::<_, i64>(at + 3)?,
        "unknownCostCalls": unknown,
        "planQuotaCalls": plan,
        "durationMs": r.get::<_, i64>(at + 6)?,
        "costLabel": if unknown > 0 { json!("custo desconhecido") } else if plan > 0 { json!("consome a cota do plano") } else { Value::Null },
    }))
}

/// Totals of the rows matching `column = key` (`task` or `batch`) created at or after `since`.
pub(crate) fn totals_since(column: &str, key: &str, since: i64) -> Result<Value, CoreError> {
    let column = match column {
        "task" | "batch" => column,
        _ => return Err(error("invalid_request", "Invalid cost grouping")),
    };
    projects::with_reader(|c| {
        c.query_row(
            &format!("SELECT {TOTALS} FROM provider_costs WHERE {column}=?1 AND created_at>=?2"),
            rusqlite::params![key, since],
            |r| totals_row(r, 0),
        )
    })
}

/// Records one finished call in the open Project; `batch` stays null until batches exist (#56).
pub fn record(
    target: &Target,
    task: &str,
    batch: Option<&str>,
    usage: &Value,
    calls: u64,
    cost: &Cost,
) -> Result<(), CoreError> {
    record_for(None, target, task, batch, usage, calls, cost)
}

/// Like `record`, also saving the id of the Provider Profile that served the call (#120).
pub fn record_for(
    profile: Option<&str>,
    target: &Target,
    task: &str,
    batch: Option<&str>,
    usage: &Value,
    calls: u64,
    cost: &Cost,
) -> Result<(), CoreError> {
    let (provider, model) = target.label();
    let table = embedded().updated_at;
    projects::with_writer(|c| {
        c.execute(
            "INSERT INTO provider_costs(task,batch,provider,model,input_tokens,output_tokens,calls,cost_kind,cost_micro_usd,price_source,table_updated_at,profile) VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9,?10,?11,?12)",
            rusqlite::params![
                task,
                batch,
                provider,
                model,
                usage["inputTokens"].as_u64().map(|v| v as i64),
                usage["outputTokens"].as_u64().map(|v| v as i64),
                calls as i64,
                cost.kind(),
                cost.micro().map(|v| v as i64),
                cost.source(),
                table,
                profile
            ],
        )?;
        Ok(())
    })
}

/// Runs a provider call and attaches and records its real cost. Failures that carry usage
/// (truncation, invalid JSON, refusal) are recorded too; a timeout is recorded as unknown.
/// `cost.recorded` is false when no Project is open.
pub fn run_costed(
    target: &Target,
    task: &str,
    batch: Option<&str>,
    call: impl FnOnce() -> CommandResult,
) -> CommandResult {
    run_costed_for(None, target, task, batch, call)
}

/// Like `run_costed`, also saving the id of the Provider Profile that serves the call.
pub fn run_costed_for(
    profile: Option<&str>,
    target: &Target,
    task: &str,
    batch: Option<&str>,
    call: impl FnOnce() -> CommandResult,
) -> CommandResult {
    if task.trim().is_empty() {
        return Err(error("invalid_request", "Task is required"));
    }
    let priced_target = target.clone();
    let guard =
        Box::new(move |request: &StructuredRequest, _: &[Value]| estimate(&priced_target, request));
    let (reply, mut log) = super::control::with_call_scope(None, Some(guard), call);
    if let Err(e) = &reply {
        if let Some(last) = log.last_mut() {
            if last["code"] == "ok" || last["code"] == "cancelled" {
                last["code"] = json!(e.code);
            }
        }
    }
    let settle = |usage: &Value, calls: u64, code: &str| -> Result<Value, CoreError> {
        // Each request (including a repair) chooses its own tier. Adding usages first
        // could incorrectly move two low-tier calls into the high tier.
        let costs = log
            .iter()
            .map(|entry| actual(target, &entry["usage"]))
            .collect::<Result<Vec<_>, _>>()?;
        let cost = if costs.is_empty() {
            actual(target, usage)?
        } else if costs.contains(&Cost::Unknown) {
            Cost::Unknown
        } else if let Cost::Usd { source, .. } = costs[0] {
            Cost::Usd {
                micro_usd: costs
                    .iter()
                    .fold(0u64, |sum, c| sum.saturating_add(c.micro().unwrap_or(0))),
                source,
            }
        } else {
            costs[0].clone()
        };
        let fallback = [json!({"usage":usage,"calls":calls,"code":code})];
        let entries = if log.is_empty() {
            &fallback[..]
        } else {
            &log[..]
        };
        let mut recorded = true;
        for entry in entries {
            let usage = if matches!(target, Target::Cli { .. })
                || matches!(
                    entry["code"].as_str(),
                    Some("cancelled" | "timeout_uncertain")
                ) {
                Value::Null
            } else {
                entry["usage"].clone()
            };
            let each_cost = actual(target, &usage)?;
            let row = CallRow {
                profile,
                target,
                task,
                task_version: None,
                batch,
                job: None,
                attempt: entry["attempt"].as_u64().map(|a| u8::from(a == 1)),
                usage: &usage,
                calls: entry["calls"].as_u64().unwrap_or(1),
                cost: &each_cost,
                code: entry["code"].as_str().unwrap_or(code),
                estimate_micro_usd: entry["estimate"]["maxMicroUsd"].as_u64(),
                duration_ms: entry["durationMs"].as_u64(),
            };
            recorded &= record_call(&row).is_ok();
        }
        let mut v = cost_json(&cost);
        v["recorded"] = json!(recorded);
        Ok(v)
    };
    match reply {
        Ok(mut value) => {
            let calls = value["calls"].as_u64().unwrap_or(1);
            value["cost"] = settle(&value["usage"].clone(), calls, "ok")?;
            Ok(value)
        }
        Err(mut e) => {
            // Failures after a response carry `{usage, calls}` and were billed (truncation,
            // invalid JSON, refusal). A timeout may have been billed: unknown, never zero.
            if let Some(info) = e.usage.clone().filter(|i| i.get("calls").is_some()) {
                let calls = info["calls"].as_u64().unwrap_or(1);
                let cost = settle(&info["usage"], calls, &e.code)?;
                e.usage = Some(json!({"usage":info["usage"],"calls":calls,"cost":cost}));
            } else if !log.is_empty()
                || matches!(e.code.as_str(), "timeout_uncertain" | "cancelled")
            {
                settle(&Value::Null, 1, &e.code)?;
            }
            Err(e)
        }
    }
}

// Same route as `provider.structured`: the explicit profile, else the task choice, then the
// default, then the CLI selection. The price is the one of (kind, model) in `provider.prices`.
// Returns the profile id too, for the Project record. A "local only" task fails here, before
// any call.
fn target_now(task: Option<&str>, explicit: Option<&str>) -> Result<(Target, String), CoreError> {
    Ok(match super::routed(task, explicit)? {
        super::Routed::Cli(name) => (Target::Cli { name: name.clone() }, name),
        super::Routed::Api { profile, local } => (
            Target::Api {
                provider: profile.kind,
                model: profile.model,
                local,
            },
            profile.id,
        ),
    })
}
fn request(args: &Value) -> Result<StructuredRequest, CoreError> {
    serde_json::from_value(args.clone())
        .map_err(|_| error("invalid_request", "Invalid structured request"))
}
fn cmd_estimate(args: Value, _: &mut EventSink<'_>) -> CommandResult {
    let (target, profile) = target_now(args["task"].as_str(), args["profileId"].as_str())?;
    let mut estimate = estimate(&target, &request(&args)?)?;
    estimate["profileId"] = json!(profile);
    Ok(estimate)
}
fn cmd_run(args: Value, events: &mut EventSink<'_>) -> CommandResult {
    let task = args["task"].as_str().unwrap_or("").to_owned();
    let batch = args["batch"].as_str().map(str::to_owned);
    request(&args)?;
    let (target, profile) = target_now(args["task"].as_str(), args["profileId"].as_str())?;
    // The profile and model that serve the call are recorded in the Project and returned.
    let route = match &target {
        Target::Cli { name } => json!({"profileId": profile, "kind": name, "model": null}),
        Target::Api {
            provider, model, ..
        } => json!({"profileId": profile, "kind": provider, "model": model}),
    };
    let mut done = run_costed_for(Some(&profile), &target, &task, batch.as_deref(), || {
        crate::dispatch("provider.structured", args, events)
    })?;
    done["route"] = route;
    Ok(done)
}
fn price_view() -> Result<Value, CoreError> {
    let _g = LOCK
        .lock()
        .map_err(|_| error("settings", "Could not access price overrides"))?;
    let table = embedded();
    Ok(
        json!({"updatedAt":table.updated_at,"prices":table.prices,"overrides":read_overrides()?.prices}),
    )
}
fn cmd_prices(_: Value, _: &mut EventSink<'_>) -> CommandResult {
    price_view()
}
fn valid_price(p: &Price) -> bool {
    p.valid()
}
fn cmd_price_set(args: Value, _: &mut EventSink<'_>) -> CommandResult {
    let price: Price = serde_json::from_value(args)
        .ok()
        .filter(valid_price)
        .ok_or_else(|| error("invalid_price", "Invalid price"))?;
    {
        let _g = LOCK
            .lock()
            .map_err(|_| error("settings", "Could not access price overrides"))?;
        let mut o = read_overrides()?;
        o.prices
            .retain(|p| !(p.provider == price.provider && p.model == price.model));
        o.prices.push(price);
        write_overrides(&o)?;
    }
    price_view()
}
fn cmd_price_clear(args: Value, _: &mut EventSink<'_>) -> CommandResult {
    let (Some(provider), Some(model)) = (args["provider"].as_str(), args["model"].as_str()) else {
        return Err(error("invalid_price", "Invalid price"));
    };
    {
        let _g = LOCK
            .lock()
            .map_err(|_| error("settings", "Could not access price overrides"))?;
        let mut o = read_overrides()?;
        o.prices
            .retain(|p| !(p.provider == provider && p.model == model));
        write_overrides(&o)?;
    }
    price_view()
}
fn cmd_list(args: Value, _: &mut EventSink<'_>) -> CommandResult {
    let batch = args["batch"].as_str().map(str::to_owned);
    let job = args["job"].as_i64();
    projects::with_reader(|c| {
        let mut s = c.prepare("SELECT id,task,batch,provider,model,input_tokens,output_tokens,calls,cost_kind,cost_micro_usd,price_source,table_updated_at,created_at,profile,job_id,task_version,attempt,outcome,code,estimate_micro_usd,duration_ms FROM provider_costs WHERE (?1 IS NULL OR batch=?1) AND (?2 IS NULL OR job_id=?2) ORDER BY id")?;
        let rows = s.query_map(rusqlite::params![batch, job], |r| Ok(json!({"jobId":r.get::<_,Option<i64>>(14)?,"taskVersion":r.get::<_,Option<i64>>(15)?,"attempt":r.get::<_,Option<i64>>(16)?,"outcome":r.get::<_,Option<String>>(17)?,"code":r.get::<_,Option<String>>(18)?,"estimateMicroUsd":r.get::<_,Option<i64>>(19)?,"durationMs":r.get::<_,Option<i64>>(20)?,"id":r.get::<_,i64>(0)?,"task":r.get::<_,String>(1)?,"batch":r.get::<_,Option<String>>(2)?,"provider":r.get::<_,String>(3)?,"model":r.get::<_,String>(4)?,"inputTokens":r.get::<_,Option<i64>>(5)?,"outputTokens":r.get::<_,Option<i64>>(6)?,"calls":r.get::<_,i64>(7)?,"costKind":r.get::<_,String>(8)?,"microUsd":r.get::<_,Option<i64>>(9)?,"priceSource":r.get::<_,Option<String>>(10)?,"tableUpdatedAt":r.get::<_,String>(11)?,"createdAt":r.get::<_,i64>(12)?,"profile":r.get::<_,Option<String>>(13)?})))?;
        rows.collect::<rusqlite::Result<Vec<_>>>()
    })
    .map(|v| json!(v))
}
inventory::submit! { CommandRegistration { name: "provider.cost.estimate", execute: cmd_estimate } }
inventory::submit! { CommandRegistration { name: "provider.cost.run", execute: cmd_run } }
inventory::submit! { CommandRegistration { name: "provider.cost.list", execute: cmd_list } }
inventory::submit! { CommandRegistration { name: "provider.prices.get", execute: cmd_prices } }
inventory::submit! { CommandRegistration { name: "provider.prices.set", execute: cmd_price_set } }
inventory::submit! { CommandRegistration { name: "provider.prices.clear", execute: cmd_price_clear } }

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn repairs_are_priced_per_request_without_combining_their_tiers() {
        let target = Target::Api {
            provider: "anthropic".into(),
            model: "claude-haiku-5-5".into(),
            local: false,
        };
        let reply = run_costed(&target, "selection", None, || {
            let mut log = super::super::control::CallLog::default();
            for attempt in 0..2 {
                log.0.push(json!({"attempt":attempt,"calls":1,"code":"ok","usage":{"inputTokens":60_000,"outputTokens":1000}}));
            }
            Ok(json!({"data":{},"usage":{"inputTokens":120_000,"outputTokens":2000},"calls":2}))
        }).unwrap();
        assert_eq!(reply["cost"]["microUsd"], 13_000);
    }

    #[test]
    fn embedded_table_is_dated_unique_and_sourced() {
        let table = embedded();
        assert_eq!(table.updated_at.len(), 10);
        let mut seen = std::collections::HashSet::new();
        for p in &table.prices {
            assert!(
                seen.insert((p.provider.clone(), p.model.clone())),
                "{}",
                p.model
            );
            assert!(valid_price(p));
            assert!(p
                .source
                .as_deref()
                .is_some_and(|u| u.starts_with("https://")));
        }
    }
}
