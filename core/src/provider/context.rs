//! Effective context of a Provider Profile (#143): `provider.context.get`.
//!
//! The value the planner may rely on comes from, in this order: what the user typed for the
//! profile, the context the server has loaded, the maximum the server reports, the model
//! catalog (#141) and a conservative fallback (4096 Ollama, 8192 the rest). Every known
//! ceiling (loaded, server maximum, catalog maximum) still lowers the chosen value, so an edit
//! can never exceed a confirmed limit. Numbers carry a closed origin, never a free text.
//!
//! Probing is metadata only and never generates paid text:
//! - the default call reads the cache and passive metadata that does not load a model
//!   (Ollama `/api/show` and `/api/ps`, LM Studio, llama.cpp, Anthropic, Gemini, OpenRouter,
//!   Groq and compatible `/models`);
//! - Ollama is preloaded (empty `messages`, `num_predict` 1, per the docs) only on
//!   `refresh: true`, on a loopback or private-network server, because loading a model takes
//!   RAM/VRAM and may unload another one;
//! - the "Test Provider" probe (`provider.test` with `probeContext`, #145) is the one call that
//!   generates text: synthetic, loopback only, user-triggered, saved here as `measured`;
//! - a remote endpoint without the existing consent, and any task or Project with "local only"
//!   on, is never probed: the catalog and the fallback answer, and the origin says so.
//!
//! Fixture formats come from the official docs cited next to each parser.
use super::adapters::send_cancellable;
use super::control::cancelled;
use super::settings::{context_pick, data_file, ContextPick, ContextTarget};
use super::*;
use crate::{CommandRegistration, CommandResult, EventSink};
use reqwest::blocking::Client;
use sha2::{Digest, Sha256};
use std::{fs, io::Write, net::IpAddr, sync::Mutex};

const FALLBACK: u64 = 8192;
const OLLAMA_FALLBACK: u64 = 4096;
const CACHE_FILE: &str = "provider-context.json";
const CACHE_VERSION: u32 = 1;
const CACHE_MAX_ENTRIES: usize = 64;
/// A loaded context can change under us (the user reloads the model); a maximum hardly does.
const TTL_LOADED_SECS: u64 = 5 * 60;
const TTL_STATIC_SECS: u64 = 6 * 60 * 60;
const PROBE_TIMEOUT: Duration = Duration::from_secs(8);
const MAX_BODY: usize = 8 * 1024 * 1024;
static CACHE_LOCK: Mutex<()> = Mutex::new(());

/// Where a number comes from. `Measured` is what the context probe of "Test Provider" (#145)
/// saw the server keep from a text of known size.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
enum Source {
    User,
    Loaded,
    Server,
    Catalog,
    Fallback,
    Measured,
}
impl Source {
    pub(crate) fn as_str(self) -> &'static str {
        match self {
            Source::User => "user",
            Source::Loaded => "loaded",
            Source::Server => "server",
            Source::Catalog => "catalog",
            Source::Fallback => "fallback",
            Source::Measured => "measured",
        }
    }
    fn explanation(self) -> &'static str {
        match self {
            Source::User => "Value set by you for this profile.",
            Source::Loaded => "Context currently loaded by the server for this model.",
            Source::Server => "Context limit reported by the server for this model.",
            Source::Catalog => "Context limit from the built-in model catalog.",
            Source::Fallback => "Conservative default: no limit was discovered.",
            Source::Measured => "Confirmed by the usage the provider reported.",
        }
    }
}

/// Which server answered. A closed list: it is the only "detail" ever stored or returned.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
enum Server {
    Ollama,
    LmStudio,
    LlamaCpp,
    OpenRouter,
    Anthropic,
    Gemini,
    Models,
}

/// What discovery found. Only numbers and categories are cached.
#[derive(Clone, Debug, Default, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct Found {
    loaded: Option<u64>,
    /// Tokens a server kept from the probe text (#145): the context it really runs with.
    #[serde(default)]
    measured: Option<u64>,
    max_context: Option<u64>,
    max_output: Option<u64>,
    /// The reported maximum is what a call can really use (hosted APIs). For local servers
    /// the training maximum is only a ceiling: the operating context is the loaded one.
    #[serde(default)]
    operating: bool,
    server: Option<Server>,
}
impl Found {
    fn any(&self) -> bool {
        self.loaded.is_some()
            || self.measured.is_some()
            || self.max_context.is_some()
            || self.max_output.is_some()
    }
    fn merge(&mut self, other: Found) {
        self.loaded = self.loaded.or(other.loaded);
        self.measured = self.measured.or(other.measured);
        if self.max_context.is_none() {
            self.operating = other.operating;
        }
        self.max_context = self.max_context.or(other.max_context);
        self.max_output = self.max_output.or(other.max_output);
        self.server = self.server.or(other.server);
    }
}

fn positive(v: &Value) -> Option<u64> {
    v.as_u64().filter(|n| *n > 0)
}

// Ollama POST /api/show: https://docs.ollama.com/api-reference/show-model-details.md
// `model_info` has "<architecture>.context_length".
fn parse_ollama_show(v: &Value) -> Option<Found> {
    let info = v.get("model_info")?.as_object()?;
    let max = info
        .iter()
        .find(|(k, _)| k.ends_with(".context_length"))
        .and_then(|(_, n)| positive(n));
    Some(Found {
        max_context: max,
        server: Some(Server::Ollama),
        ..Found::default()
    })
}
// Ollama GET /api/ps: https://docs.ollama.com/api/ps.md (`context_length` of a running model;
// the GitHub api.md of `main` is outdated and lacks it).
fn parse_ollama_ps(v: &Value, model: &str) -> Option<Found> {
    let list = v.get("models")?.as_array()?;
    let latest = format!("{model}:latest");
    let same = |name: &str| name == model || name == latest;
    let loaded = list
        .iter()
        .find(|m| {
            ["name", "model"]
                .iter()
                .any(|k| m.get(*k).and_then(Value::as_str).is_some_and(same))
        })
        .and_then(|m| positive(&m["context_length"]));
    Some(Found {
        loaded,
        server: Some(Server::Ollama),
        ..Found::default()
    })
}
// LM Studio GET /api/v1/models: https://lmstudio.ai/docs/developer/rest/list
// `max_context_length` and `loaded_instances[].config.context_length`.
fn parse_lmstudio(v: &Value, model: &str) -> Option<Found> {
    let list = v.get("models")?.as_array()?;
    let entry = list.iter().find(|m| {
        m["key"] == model
            || m["loaded_instances"]
                .as_array()
                .is_some_and(|l| l.iter().any(|i| i["id"] == model))
    });
    let mut found = Found {
        server: Some(Server::LmStudio),
        ..Found::default()
    };
    if let Some(entry) = entry {
        found.max_context = positive(&entry["max_context_length"]);
        let instances = entry["loaded_instances"].as_array();
        let chosen =
            instances.and_then(|l| l.iter().find(|i| i["id"] == model).or_else(|| l.first()));
        found.loaded = chosen.and_then(|i| positive(&i["config"]["context_length"]));
    }
    Some(found)
}
// llama.cpp GET /props: https://github.com/ggml-org/llama.cpp/blob/master/tools/server/README.md
// `default_generation_settings.n_ctx` is the context the server runs with.
fn parse_llama_props(v: &Value) -> Option<Found> {
    let settings = v.get("default_generation_settings")?;
    Some(Found {
        loaded: positive(&settings["n_ctx"]),
        server: Some(Server::LlamaCpp),
        ..Found::default()
    })
}
// GET {base}/models, OpenAI-compatible list. Optional extras by server:
// - llama.cpp `meta.n_ctx_train` (training maximum, not the running context);
// - OpenRouter https://openrouter.ai/docs/api/api-reference/models/list-all-models-and-their-properties
//   `context_length`, `top_provider.context_length`, `top_provider.max_completion_tokens`;
// - Groq https://console.groq.com/docs/api-reference#models-list `context_window`,
//   `max_completion_tokens`.
// The official OpenAI list has none of them: it is not even requested.
fn parse_models(v: &Value, model: &str, server: Server) -> Option<Found> {
    let list = v.get("data")?.as_array()?;
    let entry = list
        .iter()
        .find(|m| m["id"] == model)
        .or_else(|| (list.len() == 1 && server == Server::LlamaCpp).then(|| &list[0]));
    let mut found = Found {
        server: Some(server),
        ..Found::default()
    };
    let Some(m) = entry else {
        return Some(found);
    };
    let hosted = [
        positive(&m["context_window"]),
        positive(&m["top_provider"]["context_length"]),
        positive(&m["context_length"]),
    ]
    .into_iter()
    .flatten()
    .min();
    if let Some(n) = hosted {
        found.max_context = Some(n);
        found.operating = true;
    } else {
        found.max_context = positive(&m["meta"]["n_ctx_train"]);
    }
    found.max_output = positive(&m["top_provider"]["max_completion_tokens"])
        .or_else(|| positive(&m["max_completion_tokens"]));
    Some(found)
}
// Anthropic GET /v1/models/{id}: https://platform.claude.com/docs/en/api/models/retrieve
// (`max_input_tokens`, `max_tokens`).
fn parse_anthropic(v: &Value) -> Option<Found> {
    v.get("id")?;
    Some(Found {
        max_context: positive(&v["max_input_tokens"]),
        max_output: positive(&v["max_tokens"]),
        operating: true,
        server: Some(Server::Anthropic),
        ..Found::default()
    })
}
// Gemini models.get: https://ai.google.dev/api/models#method:-models.get
// (`inputTokenLimit`, `outputTokenLimit`).
fn parse_gemini(v: &Value) -> Option<Found> {
    v.get("name")?;
    Some(Found {
        max_context: positive(&v["inputTokenLimit"]),
        max_output: positive(&v["outputTokenLimit"]),
        operating: true,
        server: Some(Server::Gemini),
        ..Found::default()
    })
}

struct Resolved {
    value: u64,
    source: Source,
    capped: bool,
    max_context: Option<(u64, Source)>,
    max_output: Option<(u64, Source)>,
}

/// Pure resolution: user, loaded, server, catalog, fallback; then the lowest known ceiling.
fn resolve_value(
    kind: &str,
    local: bool,
    user: Option<u64>,
    found: &Found,
    catalog: (Option<u64>, Option<u64>),
) -> Resolved {
    let fallback = if kind == "ollama" {
        OLLAMA_FALLBACK
    } else {
        FALLBACK
    };
    // The catalog is the real context only for a hosted model; a local server runs the
    // context it was started with, whatever the catalog says about the model name.
    let catalog_operates = !local && kind != "ollama";
    let (mut value, mut source) = if let Some(n) = user {
        (n, Source::User)
    } else if let Some(n) = found.measured {
        (n, Source::Measured)
    } else if let Some(n) = found.loaded {
        (n, Source::Loaded)
    } else if let Some(n) = found.max_context.filter(|_| found.operating) {
        (n, Source::Server)
    } else if let Some(n) = catalog.0.filter(|_| catalog_operates) {
        (n, Source::Catalog)
    } else {
        (fallback, Source::Fallback)
    };
    let mut capped = false;
    // Ollama reloads the model with the `num_ctx` a call asks for, so what is loaded now is
    // where the value starts (user, then loaded, then 4096), not a ceiling above the user.
    for (ceiling, origin) in [
        (
            found.measured.filter(|_| kind != "ollama"),
            Source::Measured,
        ),
        (found.loaded.filter(|_| kind != "ollama"), Source::Loaded),
        (found.max_context, Source::Server),
        (catalog.0, Source::Catalog),
    ] {
        if let Some(n) = ceiling.filter(|n| *n < value) {
            (value, source, capped) = (n, origin, true);
        }
    }
    Resolved {
        value,
        source,
        capped,
        max_context: found
            .max_context
            .map(|n| (n, Source::Server))
            .or(catalog.0.map(|n| (n, Source::Catalog))),
        max_output: found
            .max_output
            .map(|n| (n, Source::Server))
            .or(catalog.1.map(|n| (n, Source::Catalog))),
    }
}

/// What the endpoint of an OpenAI-compatible profile can be probed as. Decided by the host
/// alone, in a fixed order, with no new profile field.
#[derive(Debug, PartialEq)]
enum Plan {
    OllamaNative,
    Anthropic,
    Gemini,
    /// `GET {base}/models` and nothing else.
    Models(Server),
    /// LM Studio, then llama.cpp, then `{base}/models`; stops at the first recognized.
    Loopback,
    /// The official OpenAI list has no limits: catalog only.
    None,
}
fn plan_for(kind: &str, endpoint: &str, loopback: bool) -> Plan {
    match kind {
        "ollama" => Plan::OllamaNative,
        "anthropic" => Plan::Anthropic,
        "gemini" => Plan::Gemini,
        _ => {
            let host = Url::parse(endpoint)
                .ok()
                .and_then(|u| u.host_str().map(str::to_ascii_lowercase))
                .unwrap_or_default();
            if host == "api.openai.com" {
                Plan::None
            } else if host == "openrouter.ai" {
                Plan::Models(Server::OpenRouter)
            } else if loopback {
                Plan::Loopback
            } else {
                Plan::Models(Server::Models)
            }
        }
    }
}

/// Loopback or a private network: where a preload costs nothing but local memory.
fn private_ip(ip: IpAddr) -> bool {
    match ip {
        IpAddr::V4(a) => a.is_loopback() || a.is_private() || a.is_link_local(),
        IpAddr::V6(a) => {
            a.is_loopback()
                || (a.segments()[0] & 0xfe00) == 0xfc00
                || (a.segments()[0] & 0xffc0) == 0xfe80
        }
    }
}

enum Reply {
    Json(Value),
    /// Not found, not a success or not JSON: try the next probe.
    Nothing,
    /// The server could not be reached (or refused our credentials).
    Unavailable,
}

struct Prober<'a> {
    base: String,
    origin: Url,
    addresses: Vec<std::net::SocketAddr>,
    key: Option<String>,
    kind: String,
    cancel: &'a CancelToken,
    unavailable: bool,
}
impl Prober<'_> {
    fn call(
        &mut self,
        path: &str,
        body: Option<&Value>,
        timeout: Duration,
    ) -> Result<Reply, CoreError> {
        if self.cancel.is_cancelled() {
            return Err(cancelled());
        }
        let mut url = self.origin.clone();
        url.set_path(path);
        let host = url
            .host_str()
            .unwrap_or_default()
            .trim_matches(['[', ']'])
            .to_owned();
        let client = Client::builder()
            .timeout(timeout)
            .redirect(reqwest::redirect::Policy::none())
            .no_proxy()
            .resolve_to_addrs(&host, &self.addresses)
            .build()
            .map_err(|_| error("network", "Could not initialize HTTP client"))?;
        let mut call = match body {
            Some(body) => client.post(url).json(body),
            None => client.get(url),
        };
        if let Some(key) = &self.key {
            call = match self.kind.as_str() {
                "anthropic" => call.header("x-api-key", key),
                "gemini" => call.header("x-goog-api-key", key),
                _ => call.bearer_auth(key),
            };
        }
        if self.kind == "anthropic" {
            call = call.header("anthropic-version", "2023-06-01");
        }
        let reply = match send_cancellable(call, self.cancel)? {
            Ok(reply) => reply,
            Err(_) => {
                self.unavailable = true;
                return Ok(Reply::Unavailable);
            }
        };
        if matches!(reply.status, 401 | 403) {
            self.unavailable = true;
            return Ok(Reply::Unavailable);
        }
        if !(200..300).contains(&reply.status) {
            return Ok(Reply::Nothing);
        }
        Ok(reply
            .body
            .ok()
            .filter(|b| b.len() <= MAX_BODY)
            .and_then(|b| serde_json::from_slice(&b).ok())
            .map_or(Reply::Nothing, Reply::Json))
    }
    fn get(&mut self, path: &str) -> Result<Option<Value>, CoreError> {
        Ok(match self.call(path, None, PROBE_TIMEOUT)? {
            Reply::Json(v) => Some(v),
            _ => None,
        })
    }
    fn models_path(&self) -> String {
        format!("{}/models", self.base)
    }
    fn run(
        &mut self,
        plan: &Plan,
        target: &ContextTarget,
        preload: bool,
    ) -> Result<Found, CoreError> {
        let mut found = Found::default();
        let model = target.model.as_str();
        let safe_model = model
            .chars()
            .all(|c| c.is_ascii_alphanumeric() || matches!(c, '-' | '_' | '.' | ':'));
        match plan {
            Plan::None => {}
            Plan::OllamaNative => {
                let base = self.base.clone();
                let show = self.call(
                    &format!("{base}/api/show"),
                    Some(&json!({"model": model})),
                    PROBE_TIMEOUT,
                )?;
                if let Reply::Json(v) = show {
                    found.merge(parse_ollama_show(&v).unwrap_or_default());
                }
                if preload {
                    // Empty `messages` only loads the model (https://docs.ollama.com/api/chat.md);
                    // `num_predict` 1 is a belt over the braces. The same `num_ctx` a call sends.
                    let body = json!({"model": model, "messages": [], "stream": false,
                        "options": {"num_ctx": target.user_context.unwrap_or(OLLAMA_FALLBACK), "num_predict": 1}});
                    let timeout = target.timeouts.endpoint(true);
                    self.call(&format!("{base}/api/chat"), Some(&body), timeout)?;
                }
                if let Some(v) = self.get(&format!("{base}/api/ps"))? {
                    found.merge(parse_ollama_ps(&v, model).unwrap_or_default());
                }
            }
            Plan::Anthropic if safe_model => {
                let path = format!("{}/models/{model}", self.base);
                if let Some(v) = self.get(&path)? {
                    found.merge(parse_anthropic(&v).unwrap_or_default());
                }
            }
            Plan::Gemini if safe_model => {
                let path = format!("{}/models/{model}", self.base);
                if let Some(v) = self.get(&path)? {
                    found.merge(parse_gemini(&v).unwrap_or_default());
                }
            }
            Plan::Anthropic | Plan::Gemini => {}
            Plan::Models(server) => {
                let path = self.models_path();
                if let Some(v) = self.get(&path)? {
                    found.merge(parse_models(&v, model, *server).unwrap_or_default());
                }
            }
            Plan::Loopback => {
                if let Some(f) = self
                    .get("/api/v1/models")?
                    .and_then(|v| parse_lmstudio(&v, model))
                {
                    found.merge(f);
                } else if let Some(f) = self.get("/props")?.and_then(|v| parse_llama_props(&v)) {
                    found.merge(f);
                    let path = self.models_path();
                    if let Some(v) = self.get(&path)? {
                        found.merge(parse_models(&v, model, Server::LlamaCpp).unwrap_or_default());
                    }
                } else {
                    let path = self.models_path();
                    if let Some(f) = self
                        .get(&path)?
                        .and_then(|v| parse_models(&v, model, Server::Models))
                    {
                        found.merge(f);
                    }
                }
            }
        }
        Ok(found)
    }
}

// ---- cache: provider-context.json, next to provider.json, numbers and categories only ----

#[derive(Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct Entry {
    profile: String,
    /// SHA-256 of profile, type, endpoint, model and configuration: a change of any of them
    /// is a different key, so old data is never served for the new setup.
    key: String,
    at: u64,
    found: Found,
}
#[derive(Default, Serialize, Deserialize)]
struct CacheFile {
    version: u32,
    entries: Vec<Entry>,
}
fn now() -> u64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map_or(0, |d| d.as_secs())
}
fn identity(t: &ContextTarget) -> String {
    let mut hash = Sha256::new();
    for part in [
        t.id.as_str(),
        &t.kind,
        &t.endpoint,
        &t.model,
        &t.native_schema.to_string(),
        &t.user_context.map(|n| n.to_string()).unwrap_or_default(),
    ] {
        hash.update(part.len().to_le_bytes());
        hash.update(part.as_bytes());
    }
    hash.finalize()
        .iter()
        .take(16)
        .map(|b| format!("{b:02x}"))
        .collect()
}
fn cache_load() -> CacheFile {
    data_file(CACHE_FILE)
        .ok()
        .and_then(|p| fs::read(p).ok())
        .and_then(|b| serde_json::from_slice::<CacheFile>(&b).ok())
        .filter(|f| f.version == CACHE_VERSION)
        .unwrap_or(CacheFile {
            version: CACHE_VERSION,
            entries: Vec::new(),
        })
}
fn cache_save(file: &CacheFile) -> Result<(), CoreError> {
    let fail = || error("settings", "Could not save context cache");
    let target = data_file(CACHE_FILE)?;
    let parent = target.parent().ok_or_else(fail)?;
    fs::create_dir_all(parent).map_err(|_| fail())?;
    let mut tmp = tempfile::NamedTempFile::new_in(parent).map_err(|_| fail())?;
    serde_json::to_writer(&mut tmp, file).map_err(|_| fail())?;
    tmp.flush().map_err(|_| fail())?;
    tmp.persist(&target).map_err(|_| fail())?;
    Ok(())
}
fn cache_get(t: &ContextTarget) -> Option<Found> {
    let _guard = CACHE_LOCK.lock().ok()?;
    let key = identity(t);
    cache_load()
        .entries
        .into_iter()
        .find(|e| e.key == key)
        .filter(|e| {
            let ttl = if e.found.loaded.is_some() || e.found.measured.is_some() {
                TTL_LOADED_SECS
            } else {
                TTL_STATIC_SECS
            };
            now().saturating_sub(e.at) < ttl
        })
        .map(|e| e.found)
}
/// Replaces what is cached for this exact setup (and drops the profile's older setups).
fn cache_put(t: &ContextTarget, found: &Found) {
    let Ok(_guard) = CACHE_LOCK.lock() else {
        return;
    };
    let mut file = cache_load();
    file.entries.retain(|e| e.profile != t.id);
    if found.any() {
        file.entries.push(Entry {
            profile: t.id.clone(),
            key: identity(t),
            at: now(),
            found: found.clone(),
        });
    }
    let excess = file.entries.len().saturating_sub(CACHE_MAX_ENTRIES);
    file.entries.drain(..excess);
    let _ = cache_save(&file);
}
/// Removing a profile removes what was discovered for it.
pub(super) fn forget(profile: &str) {
    let Ok(_guard) = CACHE_LOCK.lock() else {
        return;
    };
    let mut file = cache_load();
    let before = file.entries.len();
    file.entries.retain(|e| e.profile != profile);
    if file.entries.len() != before {
        let _ = cache_save(&file);
    }
}

// ---- the command ----

fn result(
    id: &str,
    kind: &str,
    user: Option<u64>,
    resolved: &Resolved,
    found: &Found,
    warning: Option<&str>,
    refreshed: bool,
) -> Value {
    let pair = |p: Option<(u64, Source)>| {
        p.map(|(value, source)| json!({"value": value, "source": source}))
    };
    json!({
        "profileId": id, "kind": kind, "value": resolved.value, "source": resolved.source,
        "detail": found.server, "explanation": resolved.source.explanation(),
        "capped": resolved.capped, "warning": warning,
        "measured": resolved.source == Source::Measured,
        "userContext": user, "loaded": found.loaded.map(|value| json!({"value": value})),
        "maxContext": pair(resolved.max_context), "maxOutput": pair(resolved.max_output),
        "refreshed": refreshed,
    })
}

fn cli_result(kind: &str) -> Value {
    let resolved = resolve_value("cli", false, None, &Found::default(), (None, None));
    result(
        kind,
        kind,
        None,
        &resolved,
        &Found::default(),
        Some("not_measured"),
        false,
    )
}

fn catalog_limits(t: &ContextTarget) -> (Option<u64>, Option<u64>) {
    super::cost::price_for(&t.kind, &t.model)
        .ok()
        .flatten()
        .map_or((None, None), |(p, _)| (p.context_window, p.max_output))
}

/// The context a call uses, from the cache only (no probe): the same resolution as
/// `provider.context.get`. For Ollama it is the `num_ctx` sent: user, else loaded, else 4096,
/// never the advertised maximum, which would allocate a huge KV cache.
pub(super) fn cached_effective(t: &ContextTarget) -> u64 {
    let local = is_loopback_endpoint(&t.endpoint);
    let found = cache_get(t).unwrap_or_default();
    resolve_value(&t.kind, local, t.user_context, &found, catalog_limits(t)).value
}

/// The context a call is known to run with, for the input-truncation defence (#145): for Ollama
/// the `num_ctx` sent; for the others only a value that is not the blind fallback or the
/// catalog (the user's, the loaded one or a measured one), because pinning against a guess
/// would flag good answers.
pub(super) fn cached_sent(t: &ContextTarget) -> Option<u64> {
    let local = is_loopback_endpoint(&t.endpoint);
    let found = cache_get(t).unwrap_or_default();
    let r = resolve_value(&t.kind, local, t.user_context, &found, catalog_limits(t));
    (t.kind == "ollama" || matches!(r.source, Source::User | Source::Loaded | Source::Measured))
        .then_some(r.value)
}

/// The optional probe of "Test Provider" (#145): one synthetic text of known size, a little
/// above the effective context, with the smallest possible output. Only on an explicit user
/// action and only for a loopback, zero-cost server. It never uses a Transcript and never goes
/// through the cost log, so it cannot calibrate the estimator. Whether the server cut the text
/// tells the context it really runs with, saved in the cache with origin `measured`.
pub(super) fn probe(t: ContextTarget, cancel: &CancelToken) -> CommandResult {
    use super::truncation::*;
    if !is_loopback_endpoint(&t.endpoint) {
        return Err(error(
            "probe_not_local",
            "The context probe only runs on a local provider",
        ));
    }
    let context = cached_effective(&t);
    let characters = context.saturating_mul(PROBE_CHARS_PER_CONTEXT_TOKEN);
    if characters > PROBE_MAX_CHARS {
        return Err(error(
            "probe_unavailable",
            "The context is too large to probe",
        ));
    }
    let key = t.key()?;
    let adapter = match t.kind.as_str() {
        "" | "openai" => {
            OpenAiProvider::new(t.endpoint.clone(), t.model.clone(), key)?
                .with_timeouts(t.timeouts)
                .with_context(Some(context))
                .0
        }
        "ollama" => {
            OllamaProvider::new(t.endpoint.clone(), t.model.clone(), key)?
                .with_timeouts(t.timeouts)
                .with_context(Some(context))
                .0
        }
        _ => return Err(error("invalid_settings", "Invalid provider type")),
    };
    let (input, explicit) = adapter.probe(&probe_text(characters), cancel)?;
    let verdict = probe_verdict(characters, context, input, explicit);
    if let Some(measured) = verdict.measured {
        let _guard = CACHE_LOCK.lock().ok();
        let mut found = cache_load()
            .entries
            .into_iter()
            .find(|e| e.key == identity(&t))
            .map(|e| e.found)
            .unwrap_or_default();
        found.measured = Some(measured);
        drop(_guard);
        cache_put(&t, &found);
    }
    let resolved = resolve_value(
        &t.kind,
        true,
        t.user_context,
        &cache_get(&t).unwrap_or_default(),
        catalog_limits(&t),
    );
    Ok(json!({
        "profileId": t.id, "contextSent": context, "inputTokens": input,
        "truncated": verdict.truncated, "measured": verdict.measured,
        "value": resolved.value, "source": resolved.source,
    }))
}

/// What the window planner (#144) reads: the cached effective context of a profile or CLI.
pub(crate) struct CachedContext {
    pub profile_id: String,
    pub kind: String,
    pub model: String,
    pub value: u64,
    pub origin: &'static str,
}

/// Cache only, no probe and no network: the same resolution as `provider.context.get`.
pub(crate) fn effective_cached(
    task: Option<&str>,
    explicit: Option<&str>,
) -> Result<CachedContext, CoreError> {
    Ok(match context_pick(task, explicit)? {
        ContextPick::Cli(kind) => {
            let r = resolve_value("cli", false, None, &Found::default(), (None, None));
            CachedContext {
                profile_id: kind.clone(),
                kind,
                model: String::new(),
                value: r.value,
                origin: r.source.as_str(),
            }
        }
        ContextPick::Profile(t) => {
            let local = is_loopback_endpoint(&t.endpoint);
            let found = cache_get(&t).unwrap_or_default();
            let r = resolve_value(&t.kind, local, t.user_context, &found, catalog_limits(&t));
            CachedContext {
                value: r.value,
                origin: r.source.as_str(),
                profile_id: t.id,
                kind: t.kind,
                model: t.model,
            }
        }
    })
}

fn target_result(
    t: ContextTarget,
    task: Option<&str>,
    refresh: bool,
    cancel: &CancelToken,
) -> CommandResult {
    let catalog = catalog_limits(&t);
    let loopback_literal = is_loopback_endpoint(&t.endpoint);
    let plan = plan_for(&t.kind, &t.endpoint, loopback_literal);
    let resolved_addr = resolve(&t.endpoint).ok();
    let local = resolved_addr
        .as_ref()
        .is_some_and(|(_, a)| a.iter().all(|a| a.ip().is_loopback()));
    let mut warning = None;
    let mut found = Found::default();
    if plan != Plan::None {
        let local_only = match task {
            Some(task) => crate::assistant::local_only(task)?,
            None => false,
        } || crate::projects::project_local_only()?;
        if local_only && !loopback_literal {
            warning = Some("local_only");
        } else if !local && !t.confirmed {
            warning = Some("consent_required");
        } else if resolved_addr.is_none() {
            warning = Some("unavailable");
        } else if let Some(cached) = Some(refresh).filter(|r| !r).and_then(|_| cache_get(&t)) {
            found = cached;
        } else if let Some((url, addresses)) = resolved_addr {
            let key = t.key()?;
            if key.is_some() && url.scheme() == "http" && !local {
                warning = Some("unavailable");
            } else {
                let preload =
                    refresh && t.kind == "ollama" && addresses.iter().all(|a| private_ip(a.ip()));
                let mut prober = Prober {
                    base: url.path().trim_end_matches('/').to_owned(),
                    origin: url,
                    addresses,
                    key,
                    kind: t.kind.clone(),
                    cancel,
                    unavailable: false,
                };
                found = prober.run(&plan, &t, preload)?;
                if !found.any() && prober.unavailable {
                    warning = Some("unavailable");
                } else {
                    found.measured = found.measured.or(cache_get(&t).and_then(|c| c.measured));
                    cache_put(&t, &found);
                }
            }
        }
    }
    let resolved = resolve_value(&t.kind, local, t.user_context, &found, catalog);
    Ok(result(
        &t.id,
        &t.kind,
        t.user_context,
        &resolved,
        &found,
        warning,
        refresh,
    ))
}

/// `provider.context.get {profileId?, task?, refresh?}` with a cancellation token.
pub fn get_with(args: Value, cancel: &CancelToken) -> CommandResult {
    let explicit = match args.get("profileId") {
        None | Some(Value::Null) => None,
        Some(Value::String(id)) => Some(id.as_str()),
        Some(_) => return Err(error("invalid_settings", "Profile not found")),
    };
    let task = args.get("task").and_then(Value::as_str);
    let refresh = args
        .get("refresh")
        .and_then(Value::as_bool)
        .unwrap_or(false);
    match context_pick(task, explicit)? {
        ContextPick::Cli(kind) => Ok(cli_result(&kind)),
        ContextPick::Profile(target) => target_result(target, task, refresh, cancel),
    }
}
fn get(args: Value, _: &mut EventSink<'_>) -> CommandResult {
    get_with(args, &CancelToken::default())
}
inventory::submit! { CommandRegistration { name: "provider.context.get", execute: get } }

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parsers_read_the_documented_fields() {
        let show =
            json!({"model_info":{"general.architecture":"gemma4","gemma4.context_length":131072}});
        assert_eq!(parse_ollama_show(&show).unwrap().max_context, Some(131072));
        let ps = json!({"models":[{"name":"other","context_length":8},{"name":"m:latest","model":"m:latest","context_length":4096}]});
        assert_eq!(parse_ollama_ps(&ps, "m").unwrap().loaded, Some(4096));
        assert_eq!(parse_ollama_ps(&ps, "x").unwrap().loaded, None);
        assert!(parse_ollama_ps(&json!({}), "m").is_none());
        let router = json!({"data":[{"id":"a/b","context_length":131072,"top_provider":{"context_length":65536,"max_completion_tokens":8192}}]});
        let f = parse_models(&router, "a/b", Server::OpenRouter).unwrap();
        assert_eq!(
            (f.max_context, f.max_output, f.operating),
            (Some(65536), Some(8192), true)
        );
        let groq =
            json!({"data":[{"id":"g","context_window":131072,"max_completion_tokens":32768}]});
        assert_eq!(
            parse_models(&groq, "g", Server::Models)
                .unwrap()
                .max_context,
            Some(131072)
        );
        let openai = json!({"data":[{"id":"gpt-x","object":"model","owned_by":"openai"}]});
        assert!(!parse_models(&openai, "gpt-x", Server::Models)
            .unwrap()
            .any());
        let anthropic = json!({"id":"m","max_input_tokens":200000,"max_tokens":64000});
        assert_eq!(parse_anthropic(&anthropic).unwrap().max_output, Some(64000));
        let gemini = json!({"name":"models/m","inputTokenLimit":1048576,"outputTokenLimit":65536});
        assert_eq!(parse_gemini(&gemini).unwrap().max_context, Some(1048576));
    }

    #[test]
    fn the_server_is_chosen_by_the_host_in_a_fixed_order() {
        assert_eq!(
            plan_for("openai", "https://openrouter.ai/api/v1", false),
            Plan::Models(Server::OpenRouter)
        );
        assert_eq!(
            plan_for("openai", "https://api.openai.com/v1", false),
            Plan::None
        );
        assert_eq!(
            plan_for("openai", "https://api.groq.com/openai/v1", false),
            Plan::Models(Server::Models)
        );
        assert_eq!(
            plan_for("openai", "http://127.0.0.1:1234/v1", true),
            Plan::Loopback
        );
        assert_eq!(
            plan_for("ollama", "http://127.0.0.1:11434", true),
            Plan::OllamaNative
        );
    }

    #[test]
    fn resolution_order_and_ceilings() {
        let loaded = Found {
            loaded: Some(4096),
            max_context: Some(131072),
            ..Found::default()
        };
        let r = resolve_value("ollama", true, Some(32768), &loaded, (None, None));
        assert_eq!((r.value, r.source, r.capped), (32768, Source::User, false));
        let r = resolve_value("ollama", true, None, &loaded, (None, None));
        assert_eq!((r.value, r.source), (4096, Source::Loaded));
        let r = resolve_value("openai", true, Some(32768), &loaded, (None, None));
        assert_eq!((r.value, r.source, r.capped), (4096, Source::Loaded, true));
        let r = resolve_value("ollama", true, Some(2048), &loaded, (None, None));
        assert_eq!((r.value, r.source, r.capped), (2048, Source::User, false));
        let r = resolve_value(
            "ollama",
            true,
            None,
            &Found {
                max_context: Some(131072),
                ..Found::default()
            },
            (None, None),
        );
        assert_eq!((r.value, r.source), (4096, Source::Fallback));
        let hosted = Found {
            max_context: Some(200000),
            operating: true,
            ..Found::default()
        };
        let r = resolve_value("anthropic", false, None, &hosted, (Some(1000000), None));
        assert_eq!((r.value, r.source), (200000, Source::Server));
        let r = resolve_value(
            "openai",
            false,
            None,
            &Found::default(),
            (Some(1050000), Some(128000)),
        );
        assert_eq!(
            (r.value, r.source, r.max_output),
            (1050000, Source::Catalog, Some((128000, Source::Catalog)))
        );
        let r = resolve_value(
            "openai",
            true,
            None,
            &Found::default(),
            (Some(1050000), None),
        );
        assert_eq!(
            (r.value, r.source, r.capped),
            (FALLBACK, Source::Fallback, false)
        );
    }

    #[test]
    fn private_networks_only_for_preload() {
        for ip in [
            "127.0.0.1",
            "10.0.0.2",
            "192.168.1.5",
            "172.16.0.1",
            "::1",
            "fd00::1",
            "fe80::1",
        ] {
            assert!(private_ip(ip.parse().unwrap()), "{ip}");
        }
        for ip in ["8.8.8.8", "192.0.2.10", "2606:4700::1"] {
            assert!(!private_ip(ip.parse().unwrap()), "{ip}");
        }
    }
}
