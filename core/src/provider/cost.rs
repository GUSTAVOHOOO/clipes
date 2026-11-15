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

fn error(code: &str, message: &str) -> CoreError {
    CoreError {
        code: code.into(),
        message: message.into(),
        usage: None,
    }
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Price {
    pub provider: String,
    pub model: String,
    pub input_per_million: f64,
    pub output_per_million: f64,
    /// Official pricing page the embedded price was read from; absent in user overrides.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub source: Option<String>,
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
        Ok(b) => serde_json::from_slice(&b)
            .map_err(|_| error("settings", "Could not read price overrides")),
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
    /// Isolated OpenCode: a model with an exact, officially verified free price, or unknown.
    OpenCode { model: String },
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
            Target::OpenCode { model } => ("cli:opencode".into(), model.clone()),
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
    if let Some(p) = find(read_overrides()?.prices) {
        return Ok(Some((p, "override")));
    }
    Ok(find(embedded().prices).map(|p| (p, "table")))
}

fn micro_usd(tokens: u64, per_million: f64) -> u64 {
    // A price per million tokens in USD equals micro-USD per token.
    (tokens as f64 * per_million).round() as u64
}

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
    let (kind, ceiling, min, max, source) = match target {
        Target::Cli { .. } => ("plan_quota", None, None, None, None),
        Target::OpenCode { model } => {
            if crate::provider_cli::opencode_cost(model)["kind"] == "zero" {
                ("zero", None, Some(0), Some(0), None)
            } else {
                ("unknown", None, None, None, None)
            }
        }
        Target::Api { local: true, .. } => ("zero", None, Some(0), Some(0), None),
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
                    let low = micro_usd(input, p.input_per_million);
                    (
                        "usd",
                        ceiling,
                        Some(low),
                        ceiling.map(|c| low + micro_usd(c, p.output_per_million)),
                        Some(source),
                    )
                }
            }
        }
    };
    Ok(json!({
        "kind": kind,
        "inputTokens": input,
        "maxOutputTokens": ceiling,
        "minMicroUsd": min,
        "maxMicroUsd": max,
        "priceSource": source,
        "tableUpdatedAt": embedded().updated_at,
        "heuristic": "chars/4",
    }))
}

/// Real cost from the `usage` returned by the adapter (both token counts are needed).
pub fn actual(target: &Target, usage: &Value) -> Result<Cost, CoreError> {
    Ok(match target {
        Target::Cli { .. } => Cost::PlanQuota,
        Target::OpenCode { model } => {
            if crate::provider_cli::opencode_cost(model)["kind"] == "zero" {
                Cost::Zero
            } else {
                Cost::Unknown
            }
        }
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
                    micro_usd: micro_usd(i, p.input_per_million)
                        + micro_usd(o, p.output_per_million),
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
    let settle = |usage: &Value, calls: u64| -> Result<Value, CoreError> {
        let cost = actual(target, usage)?;
        let recorded = record_for(profile, target, task, batch, usage, calls, &cost).is_ok();
        let mut v = cost_json(&cost);
        v["recorded"] = json!(recorded);
        Ok(v)
    };
    match call() {
        Ok(mut value) => {
            let calls = value["calls"].as_u64().unwrap_or(1);
            value["cost"] = settle(&value["usage"].clone(), calls)?;
            Ok(value)
        }
        Err(mut e) => {
            // Failures after a response carry `{usage, calls}` and were billed (truncation,
            // invalid JSON, refusal). A timeout may have been billed: unknown, never zero.
            if let Some(info) = e.usage.clone().filter(|i| i.get("calls").is_some()) {
                let calls = info["calls"].as_u64().unwrap_or(1);
                let cost = settle(&info["usage"], calls)?;
                e.usage = Some(json!({"usage":info["usage"],"calls":calls,"cost":cost}));
            } else if e.code == "timeout_uncertain" {
                settle(&Value::Null, 1)?;
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
        super::Routed::Cli(name) if name == "opencode" => (
            Target::OpenCode {
                model: crate::provider_cli::opencode_model()?,
            },
            name,
        ),
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
        Target::OpenCode { model } => json!({"profileId":profile,"kind":"opencode","model":model}),
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
    !p.provider.trim().is_empty()
        && !p.model.trim().is_empty()
        && p.input_per_million.is_finite()
        && p.output_per_million.is_finite()
        && p.input_per_million >= 0.0
        && p.output_per_million >= 0.0
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
    projects::with_reader(|c| {
        let mut s = c.prepare("SELECT id,task,batch,provider,model,input_tokens,output_tokens,calls,cost_kind,cost_micro_usd,price_source,table_updated_at,created_at,profile FROM provider_costs WHERE (?1 IS NULL OR batch=?1) ORDER BY id")?;
        let rows = s.query_map([batch], |r| Ok(json!({"id":r.get::<_,i64>(0)?,"task":r.get::<_,String>(1)?,"batch":r.get::<_,Option<String>>(2)?,"provider":r.get::<_,String>(3)?,"model":r.get::<_,String>(4)?,"inputTokens":r.get::<_,Option<i64>>(5)?,"outputTokens":r.get::<_,Option<i64>>(6)?,"calls":r.get::<_,i64>(7)?,"costKind":r.get::<_,String>(8)?,"microUsd":r.get::<_,Option<i64>>(9)?,"priceSource":r.get::<_,Option<String>>(10)?,"tableUpdatedAt":r.get::<_,String>(11)?,"createdAt":r.get::<_,i64>(12)?,"profile":r.get::<_,Option<String>>(13)?})))?;
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
