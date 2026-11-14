use crate::CoreError;
use reqwest::Url;
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::{
    net::{SocketAddr, ToSocketAddrs},
    time::Duration,
};

fn error(code: &str, message: &str) -> CoreError {
    CoreError {
        code: code.into(),
        message: message.into(),
        usage: None,
    }
}

fn resolve(endpoint: &str) -> Result<(Url, Vec<SocketAddr>), CoreError> {
    let url =
        Url::parse(endpoint).map_err(|_| error("invalid_endpoint", "Invalid provider endpoint"))?;
    if !matches!(url.scheme(), "http" | "https")
        || !url.username().is_empty()
        || url.password().is_some()
        || url.query().is_some()
        || url.fragment().is_some()
    {
        return Err(error(
            "invalid_endpoint",
            "Endpoint must be an HTTP(S) URL without credentials, query or fragment",
        ));
    }
    let host = url
        .host_str()
        .ok_or_else(|| error("invalid_endpoint", "Endpoint has no host"))?
        .trim_matches(['[', ']']);
    let port = url
        .port_or_known_default()
        .ok_or_else(|| error("invalid_endpoint", "Endpoint has no port"))?;
    let addresses: Vec<_> = (host, port)
        .to_socket_addrs()
        .map_err(|_| error("network", "Could not resolve provider host"))?
        .collect();
    if addresses.is_empty() {
        return Err(error("network", "Could not resolve provider host"));
    }
    Ok((url, addresses))
}

pub fn is_local_endpoint(endpoint: &str) -> Result<bool, CoreError> {
    let (_, addresses) = resolve(endpoint)?;
    Ok(addresses.iter().all(|address| address.ip().is_loopback()))
}

/// Loopback by the literal host (`localhost` or a loopback IP), with no DNS lookup, so the
/// "local only" veto never touches the network. Anything it cannot read counts as not local.
pub(crate) fn is_loopback_endpoint(endpoint: &str) -> bool {
    let Ok(url) = Url::parse(endpoint) else {
        return false;
    };
    url.host_str().is_some_and(|host| {
        host.eq_ignore_ascii_case("localhost")
            || host
                .trim_matches(['[', ']'])
                .parse::<std::net::IpAddr>()
                .is_ok_and(|ip| ip.is_loopback())
    })
}

/// Fixed message: it never carries text, endpoints, profile names or the Project name (ADR-0006).
pub(crate) fn local_only_violation() -> CoreError {
    error(
        "local_only_violation",
        "This task only accepts a local provider",
    )
}

#[derive(Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct StructuredRequest {
    pub instruction: String,
    pub transcript: String,
    pub schema: Value,
    pub native_schema: bool,
    #[serde(default)]
    pub max_output_tokens: Option<u64>,
}

pub trait Provider {
    fn structured(&self, request: &StructuredRequest) -> Result<Value, CoreError>;
    /// Like `structured`, but stops with a `cancelled` error once `cancel` is set: during the
    /// 429 wait, an HTTP request in flight, or a CLI run (which kills the process tree).
    /// The default only looks at the token before starting.
    fn structured_with(
        &self,
        request: &StructuredRequest,
        cancel: &CancelToken,
    ) -> Result<Value, CoreError> {
        if cancel.is_cancelled() {
            return Err(control::cancelled());
        }
        self.structured(request)
    }
}

mod adapters;
pub(crate) mod control;
pub use adapters::{AnthropicProvider, GeminiProvider, OpenAiProvider};
pub use control::{CancelToken, Timeouts};
pub mod cost;
pub use settings::run_structured;
pub(crate) use settings::{profile_infos, routed, Routed};

mod settings {
    use super::*;
    use crate::{CommandRegistration, CommandResult, EventSink};
    use std::{fs, path::PathBuf, sync::Mutex};
    static LOCK: Mutex<()> = Mutex::new(());

    /// Id of the profile synthesized from the single-endpoint settings (v1).
    pub(super) const LEGACY: &str = "legacy";
    const CLI_IDS: [&str; 2] = ["codex", "claude"];

    #[derive(Clone, Default, Serialize, Deserialize)]
    #[serde(rename_all = "camelCase")]
    struct Settings {
        /// Absent in files written before profiles existed (v1).
        #[serde(default, skip_serializing_if = "Option::is_none")]
        schema_version: Option<u32>,
        /// v1 fields. In v2 they mirror the `legacy` profile, so older readers keep working.
        #[serde(default)]
        endpoint: String,
        #[serde(default)]
        model: String,
        #[serde(default = "default_kind")]
        kind: String,
        #[serde(default)]
        native_schema: bool,
        /// Per vault account: the key suffix. Per endpoint: the consent.
        #[serde(default)]
        timeouts: Timeouts,
        #[serde(default)]
        providers: std::collections::HashMap<String, Metadata>,
        /// Absent until the user edits something; reading synthesizes `legacy` meanwhile.
        #[serde(default, skip_serializing_if = "Option::is_none")]
        profiles: Option<Vec<Profile>>,
    }
    fn default_kind() -> String {
        "openai".into()
    }
    #[derive(Clone, Default, Serialize, Deserialize)]
    #[serde(rename_all = "camelCase")]
    struct Metadata {
        confirmed: bool,
        key_last_four: Option<String>,
    }
    /// A saved Provider. Locality is never stored: it is computed from the endpoint.
    #[derive(Clone, Serialize, Deserialize)]
    #[serde(rename_all = "camelCase")]
    struct Profile {
        id: String,
        label: String,
        kind: String,
        endpoint: String,
        model: String,
        #[serde(default)]
        native_schema: bool,
        /// `None` means the vault account is the endpoint string (shared, and the v1 account).
        #[serde(default, skip_serializing_if = "Option::is_none")]
        vault_account: Option<String>,
    }
    impl Profile {
        fn account(&self) -> String {
            self.vault_account
                .clone()
                .unwrap_or_else(|| self.endpoint.clone())
        }
    }
    fn profiles(settings: &Settings) -> Vec<Profile> {
        if let Some(list) = &settings.profiles {
            return list.clone();
        }
        if settings.endpoint.is_empty() {
            return Vec::new();
        }
        vec![Profile {
            id: LEGACY.into(),
            label: "Principal".into(),
            kind: if settings.kind.is_empty() {
                default_kind()
            } else {
                settings.kind.clone()
            },
            endpoint: settings.endpoint.clone(),
            model: settings.model.clone(),
            native_schema: settings.native_schema,
            vault_account: None,
        }]
    }
    fn find(settings: &Settings, id: &str) -> Option<Profile> {
        profiles(settings).into_iter().find(|p| p.id == id)
    }
    /// The profile a command acts on: the explicit `profileId`, else `legacy` (if any).
    fn pick(settings: &Settings, args: &Value) -> Result<Option<Profile>, CoreError> {
        pick_by(settings, args.get("profileId").and_then(Value::as_str))
    }
    fn pick_by(settings: &Settings, id: Option<&str>) -> Result<Option<Profile>, CoreError> {
        match id {
            Some(id) => find(settings, id)
                .map(Some)
                .ok_or_else(|| error("invalid_settings", "Profile not found")),
            None => Ok(find(settings, LEGACY)),
        }
    }
    /// What the assistant needs to know about a saved profile (no key, no consent).
    pub(crate) struct ProfileInfo {
        pub id: String,
        pub label: String,
        pub kind: String,
        pub endpoint: String,
        pub model: String,
    }
    impl From<&Profile> for ProfileInfo {
        fn from(p: &Profile) -> Self {
            Self {
                id: p.id.clone(),
                label: p.label.clone(),
                kind: p.kind.clone(),
                endpoint: p.endpoint.clone(),
                model: p.model.clone(),
            }
        }
    }
    /// The saved profiles (the synthesized `legacy` included), not the CLIs.
    pub(crate) fn profile_infos() -> Result<Vec<ProfileInfo>, CoreError> {
        let _guard = locked()?;
        let settings = read()?;
        Ok(profiles(&settings).iter().map(ProfileInfo::from).collect())
    }
    /// Where a call goes, already past the "local only" veto. Used by the cost estimate.
    pub(crate) enum Routed {
        Cli(String),
        Api { profile: ProfileInfo, local: bool },
    }
    enum Picked {
        Cli(String),
        Profile(Profile),
    }
    /// Resolves the destination of one call and applies the per-task "local only" veto before
    /// the consent check, the vault and any network access. Locality is computed here, at
    /// call time, never stored. Only the app settings choose; the Project never does.
    fn pick_target(task: Option<&str>, explicit: Option<&str>) -> Result<Picked, CoreError> {
        let mut profile_id = explicit.map(str::to_owned);
        let mut cli = None;
        if explicit.is_none() {
            match crate::assistant::route(task)? {
                crate::assistant::Route::Cli(kind) => cli = Some(kind),
                crate::assistant::Route::Profile(id) => profile_id = Some(id),
                // "endpoint" resolves to the synthesized `legacy` profile.
                crate::assistant::Route::Endpoint => {}
                crate::assistant::Route::Unset => cli = crate::provider_cli::selected()?,
            }
        }
        let local_only = match task {
            Some(task) => crate::assistant::local_only(task)?,
            None => false,
        };
        if let Some(kind) = cli {
            // CLIs are never local.
            return if local_only {
                Err(local_only_violation())
            } else {
                Ok(Picked::Cli(kind))
            };
        }
        let settings = {
            let _guard = locked()?;
            read()?
        };
        let profile = pick_by(&settings, profile_id.as_deref())?
            .filter(|p| !p.endpoint.is_empty())
            .ok_or_else(|| error("invalid_settings", "Configure the provider first"))?;
        if local_only && !is_loopback_endpoint(&profile.endpoint) {
            return Err(local_only_violation());
        }
        Ok(Picked::Profile(profile))
    }
    pub(crate) fn routed(task: Option<&str>, explicit: Option<&str>) -> Result<Routed, CoreError> {
        Ok(match pick_target(task, explicit)? {
            Picked::Cli(kind) => Routed::Cli(kind),
            Picked::Profile(p) => Routed::Api {
                local: is_loopback_endpoint(&p.endpoint),
                profile: ProfileInfo::from(&p),
            },
        })
    }
    /// Saves the list as v2 and mirrors `legacy` into the v1 fields.
    fn store(settings: &mut Settings, list: Vec<Profile>) {
        let legacy = list.iter().find(|p| p.id == LEGACY).cloned();
        settings.endpoint = legacy
            .as_ref()
            .map(|p| p.endpoint.clone())
            .unwrap_or_default();
        settings.model = legacy.as_ref().map(|p| p.model.clone()).unwrap_or_default();
        settings.kind = legacy
            .as_ref()
            .map_or_else(default_kind, |p| p.kind.clone());
        settings.native_schema = legacy.as_ref().is_some_and(|p| p.native_schema);
        settings.schema_version = Some(2);
        settings.profiles = Some(list);
    }
    fn valid_id(id: &str) -> bool {
        !id.is_empty()
            && id.len() <= 40
            && !CLI_IDS.contains(&id)
            && id
                .chars()
                .all(|c| c.is_ascii_lowercase() || c.is_ascii_digit() || c == '-' || c == '_')
    }
    fn path() -> Result<PathBuf, CoreError> {
        if let Some(dir) = std::env::var_os("CLIPES_DATA_DIR") {
            return Ok(PathBuf::from(dir).join("provider.json"));
        }
        #[cfg(test)]
        return Ok(
            std::env::temp_dir().join(format!("clipes-provider-test-{}.json", std::process::id()))
        );
        #[cfg(not(test))]
        directories::ProjectDirs::from("io", "github.gustavohooo", "clipes")
            .map(|p| p.config_dir().join("provider.json"))
            .ok_or_else(|| error("settings", "Could not locate settings directory"))
    }
    fn read() -> Result<Settings, CoreError> {
        match fs::read(path()?) {
            Ok(bytes) => serde_json::from_slice(&bytes)
                .map_err(|_| error("settings", "Could not read provider settings")),
            Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(Settings::default()),
            Err(_) => Err(error("settings", "Could not read provider settings")),
        }
    }
    fn write(settings: &Settings) -> Result<(), CoreError> {
        let path = path()?;
        fs::create_dir_all(path.parent().unwrap())
            .map_err(|_| error("settings", "Could not save provider settings"))?;
        let bytes = serde_json::to_vec(settings)
            .map_err(|_| error("settings", "Could not save provider settings"))?;
        fs::write(path, bytes).map_err(|_| error("settings", "Could not save provider settings"))
    }
    #[cfg(not(test))]
    fn vault_set(account: &str, key: &str) -> Result<(), CoreError> {
        keyring::Entry::new("io.github.gustavohooo.clipes.provider", account)
            .and_then(|e| e.set_password(key))
            .map_err(|_| error("vault", "Could not save key in system vault"))
    }
    #[cfg(not(test))]
    fn vault_get(account: &str) -> Result<String, CoreError> {
        keyring::Entry::new("io.github.gustavohooo.clipes.provider", account)
            .and_then(|e| e.get_password())
            .map_err(|_| error("vault", "Could not read key from system vault"))
    }
    #[cfg(not(test))]
    fn vault_remove(account: &str) -> Result<(), CoreError> {
        match keyring::Entry::new("io.github.gustavohooo.clipes.provider", account)
            .and_then(|e| e.delete_credential())
        {
            Ok(()) | Err(keyring::Error::NoEntry) => Ok(()),
            Err(_) => Err(error("vault", "Could not remove key from system vault")),
        }
    }
    #[cfg(test)]
    static FAKE_VAULT: std::sync::LazyLock<Mutex<std::collections::HashMap<String, String>>> =
        std::sync::LazyLock::new(|| Mutex::new(std::collections::HashMap::new()));
    #[cfg(test)]
    fn vault_set(account: &str, key: &str) -> Result<(), CoreError> {
        FAKE_VAULT
            .lock()
            .unwrap()
            .insert(account.into(), key.into());
        Ok(())
    }
    #[cfg(test)]
    fn vault_get(account: &str) -> Result<String, CoreError> {
        FAKE_VAULT
            .lock()
            .unwrap()
            .get(account)
            .cloned()
            .ok_or_else(|| error("vault", "Could not read key from system vault"))
    }
    #[cfg(test)]
    fn vault_remove(account: &str) -> Result<(), CoreError> {
        FAKE_VAULT.lock().unwrap().remove(account);
        Ok(())
    }
    fn locked() -> Result<std::sync::MutexGuard<'static, ()>, CoreError> {
        LOCK.lock()
            .map_err(|_| error("settings", "Could not access provider settings"))
    }
    fn metadata(settings: &Settings, key: &str) -> Metadata {
        settings.providers.get(key).cloned().unwrap_or_default()
    }
    fn status_json(settings: &Settings, profile: Option<&Profile>) -> Value {
        let Some(p) = profile else {
            return json!({"endpoint":"", "model":"", "kind":"openai", "nativeSchema":false, "timeouts":settings.timeouts.effective(), "keyLastFour":null, "remote":false, "confirmed":false});
        };
        let remote = !is_local_endpoint(&p.endpoint).unwrap_or(false);
        let key = metadata(settings, &p.account());
        json!({"profileId":p.id, "endpoint":p.endpoint, "model":p.model, "kind":p.kind, "nativeSchema":p.native_schema, "timeouts":settings.timeouts.effective(), "keyLastFour":key.key_last_four, "remote":remote, "confirmed":metadata(settings, &p.endpoint).confirmed})
    }
    fn status(args: Value, _: &mut EventSink<'_>) -> CommandResult {
        let _guard = locked()?;
        let settings = read()?;
        let profile = pick(&settings, &args)?;
        Ok(status_json(&settings, profile.as_ref()))
    }
    fn profile_view(settings: &Settings, p: &Profile) -> Value {
        let price = super::cost::price_for(&p.kind, &p.model)
            .ok()
            .flatten()
            .map(|(price, source)| {
                json!({"inputPerMillion":price.input_per_million, "outputPerMillion":price.output_per_million, "source":source})
            });
        json!({
            "id": p.id, "label": p.label, "kind": p.kind, "endpoint": p.endpoint,
            "model": p.model, "nativeSchema": p.native_schema,
            "ownKey": p.vault_account.is_some(),
            "keyLastFour": metadata(settings, &p.account()).key_last_four,
            "local": is_local_endpoint(&p.endpoint).unwrap_or(false),
            "confirmed": metadata(settings, &p.endpoint).confirmed,
            "price": price, "cli": false,
        })
    }
    fn cli_view(kind: &str, status: &Value) -> Value {
        json!({
            "id": kind, "label": if kind == "codex" { "Codex CLI" } else { "Claude Code CLI" },
            "kind": kind, "endpoint": null, "model": null, "nativeSchema": false,
            "ownKey": false, "keyLastFour": null, "local": false,
            "confirmed": status[format!("{kind}Confirmed")].as_bool().unwrap_or(false),
            "active": status["selected"] == kind, "price": null, "cli": true,
            "experimental": true,
        })
    }
    /// Every profile: the saved ones, then the Codex and Claude Code CLIs. Reading never writes.
    fn profiles_list(_: Value, events: &mut EventSink<'_>) -> CommandResult {
        let settings = {
            let _guard = locked()?;
            read()?
        };
        let mut out: Vec<Value> = profiles(&settings)
            .iter()
            .map(|p| profile_view(&settings, p))
            .collect();
        let cli = crate::dispatch("provider.cli.status", json!({}), events)?;
        out.extend(CLI_IDS.iter().map(|kind| cli_view(kind, &cli)));
        Ok(json!({"profiles": out}))
    }
    fn configure(args: Value, _: &mut EventSink<'_>) -> CommandResult {
        let endpoint = args
            .get("endpoint")
            .and_then(Value::as_str)
            .ok_or_else(|| error("invalid_settings", "Endpoint is required"))?
            .trim()
            .trim_end_matches('/')
            .to_owned();
        let model = args
            .get("model")
            .and_then(Value::as_str)
            .ok_or_else(|| error("invalid_settings", "Model is required"))?
            .trim()
            .to_owned();
        if model.is_empty() {
            return Err(error("invalid_settings", "Model is required"));
        }
        resolve(&endpoint)?;
        let id = match args.get("profileId") {
            None | Some(Value::Null) => None,
            Some(Value::String(id)) if id == LEGACY || valid_id(id) => Some(id.as_str()),
            Some(_) => return Err(error("invalid_settings", "Invalid profile id")),
        };
        let target = id.unwrap_or(LEGACY);
        let own_key = args.get("ownKey").and_then(Value::as_bool);
        if own_key.is_some() && target == LEGACY {
            return Err(error(
                "invalid_settings",
                "The main profile always uses the endpoint as vault account",
            ));
        }
        let _guard = locked()?;
        let mut settings = read()?;
        let kind = args.get("kind").and_then(Value::as_str).unwrap_or("openai");
        if !matches!(kind, "openai" | "anthropic" | "gemini") {
            return Err(error("invalid_settings", "Invalid provider type"));
        }
        let mut list = profiles(&settings);
        let existing = list.iter().position(|p| p.id == target);
        let label = args
            .get("label")
            .and_then(Value::as_str)
            .map(str::trim)
            .filter(|l| !l.is_empty())
            .map(|l| l.chars().take(60).collect::<String>())
            .or_else(|| existing.map(|i| list[i].label.clone()))
            .unwrap_or_else(|| {
                if target == LEGACY {
                    "Principal".into()
                } else {
                    target.into()
                }
            });
        let mut vault_account = existing.and_then(|i| list[i].vault_account.clone());
        let mut stale = None;
        match own_key {
            Some(true) => vault_account = Some(format!("profile:{target}")),
            Some(false) => stale = vault_account.take(),
            None => {}
        }
        let profile = Profile {
            id: target.into(),
            label,
            kind: kind.into(),
            endpoint,
            model,
            native_schema: args
                .get("nativeSchema")
                .and_then(Value::as_bool)
                .unwrap_or(false),
            vault_account,
        };
        match existing {
            Some(i) => list[i] = profile,
            None => list.push(profile),
        }
        if let Some(account) = stale {
            vault_remove(&account)?;
            settings.providers.remove(&account);
        }
        store(&mut settings, list);
        write(&settings)?;
        // Only the legacy form replaces "the" provider, so only it deactivates the CLI.
        if id.is_none() {
            crate::provider_cli::clear()?;
            return Ok(json!({}));
        }
        Ok(json!({"profileId": target}))
    }
    fn profile_remove(args: Value, _: &mut EventSink<'_>) -> CommandResult {
        let id = args
            .get("profileId")
            .and_then(Value::as_str)
            .ok_or_else(|| error("invalid_settings", "Profile not found"))?;
        if id == LEGACY {
            return Err(error(
                "invalid_settings",
                "The main profile cannot be removed",
            ));
        }
        let _guard = locked()?;
        let mut settings = read()?;
        let mut list = profiles(&settings);
        let index = list
            .iter()
            .position(|p| p.id == id)
            .ok_or_else(|| error("invalid_settings", "Profile not found"))?;
        let removed = list.remove(index);
        if let Some(account) = removed.vault_account {
            vault_remove(&account)?;
            settings.providers.remove(&account);
        }
        store(&mut settings, list);
        write(&settings)?;
        Ok(json!({}))
    }
    fn key_set(args: Value, _: &mut EventSink<'_>) -> CommandResult {
        let key = args
            .get("key")
            .and_then(Value::as_str)
            .filter(|s| !s.is_empty())
            .ok_or_else(|| error("invalid_key", "Enter a key"))?;
        let _guard = locked()?;
        let mut settings = read()?;
        let profile = pick(&settings, &args)?
            .ok_or_else(|| error("invalid_settings", "Configure the provider first"))?;
        let account = profile.account();
        vault_set(&account, key)?;
        settings.providers.entry(account).or_default().key_last_four = Some(
            key.chars()
                .rev()
                .take(4)
                .collect::<String>()
                .chars()
                .rev()
                .collect(),
        );
        write(&settings)?;
        Ok(json!({}))
    }
    fn key_remove(args: Value, _: &mut EventSink<'_>) -> CommandResult {
        let _guard = locked()?;
        let mut settings = read()?;
        let Some(profile) = pick(&settings, &args)? else {
            return Ok(json!({}));
        };
        let account = profile.account();
        vault_remove(&account)?;
        settings.providers.entry(account).or_default().key_last_four = None;
        write(&settings)?;
        Ok(json!({}))
    }
    fn confirm(args: Value, _: &mut EventSink<'_>) -> CommandResult {
        let _guard = locked()?;
        let mut settings = read()?;
        let profile = pick(&settings, &args)?;
        let endpoint = match &profile {
            Some(p) if !p.endpoint.is_empty() => p.endpoint.clone(),
            _ => {
                return Err(error(
                    "invalid_settings",
                    "Provider endpoint changed; review it again",
                ))
            }
        };
        if args.get("endpoint").and_then(Value::as_str) != Some(endpoint.as_str()) {
            return Err(error(
                "invalid_settings",
                "Provider endpoint changed; review it again",
            ));
        }
        // Consent is per endpoint: every profile on it inherits.
        settings.providers.entry(endpoint).or_default().confirmed = true;
        write(&settings)?;
        Ok(json!({}))
    }
    /// `provider.structured` with a cancellation token, for the AI job executor (#121).
    pub fn run_structured(args: Value, cancel: &CancelToken) -> CommandResult {
        let explicit = match args.get("profileId") {
            None | Some(Value::Null) => None,
            Some(Value::String(id)) => Some(id.as_str()),
            Some(_) => return Err(error("invalid_settings", "Profile not found")),
        };
        let profile = match pick_target(args.get("task").and_then(Value::as_str), explicit)? {
            Picked::Cli(kind) => {
                let request: StructuredRequest = serde_json::from_value(args)
                    .map_err(|_| error("invalid_request", "Invalid structured request"))?;
                let timeout = crate::provider_cli::timeout()?;
                return crate::provider_cli::CliProvider(kind, timeout)
                    .structured_with(&request, cancel);
            }
            Picked::Profile(profile) => profile,
        };
        let settings = {
            let _guard = locked()?;
            read()?
        };
        let consent = metadata(&settings, &profile.endpoint);
        if !consent.confirmed && !is_local_endpoint(&profile.endpoint)? {
            return Err(error(
                "confirmation_required",
                "Confirm sending text to this provider first",
            ));
        }
        let account = profile.account();
        let key = if metadata(&settings, &account).key_last_four.is_some() {
            Some(vault_get(&account)?)
        } else {
            None
        };
        let mut request: StructuredRequest = serde_json::from_value(args)
            .map_err(|_| error("invalid_request", "Invalid structured request"))?;
        request.native_schema = profile.native_schema;
        match profile.kind.as_str() {
            "" | "openai" => {
                let mut p = OpenAiProvider::new(profile.endpoint, profile.model, key)?;
                p.confirm(consent.confirmed);
                p.structured(&request)
            }
            "anthropic" => {
                let mut p = AnthropicProvider::new(profile.endpoint, profile.model, key)?;
                p.confirm(consent.confirmed);
                p.structured(&request)
            }
            "gemini" => {
                let mut p = GeminiProvider::new(profile.endpoint, profile.model, key)?;
                p.confirm(consent.confirmed);
                p.structured(&request)
            }
            _ => Err(error("invalid_settings", "Invalid provider type")),
        }
    }
    fn call(args: Value, events: &mut EventSink<'_>) -> CommandResult {
        events(crate::ProgressEvent {
            project: None,
            job: "provider.structured".into(),
            stage: "starting".into(),
            percentage: 0,
            message: "Preparing provider request".into(),
            error: None,
        });
        let result = run_structured(args, &CancelToken::default());
        events(crate::ProgressEvent {
            project: None,
            job: "provider.structured".into(),
            stage: if result.is_ok() { "complete" } else { "failed" }.into(),
            percentage: 100,
            message: if result.is_ok() {
                "Provider response validated"
            } else {
                "Provider request failed"
            }
            .into(),
            error: result.as_ref().err().cloned(),
        });
        result
    }
    fn test(args: Value, events: &mut EventSink<'_>) -> CommandResult {
        let (native, profile_id) = {
            let _guard = locked()?;
            let settings = read()?;
            let profile = pick(&settings, &args)?;
            (
                profile.is_some_and(|p| p.native_schema),
                args.get("profileId").cloned(),
            )
        };
        let mut request = json!({"instruction":"Respond with schemaVersion 1.","transcript":"","schema":{"type":"object","properties":{"schemaVersion":{"type":"integer","const":1}},"required":["schemaVersion"],"additionalProperties":false},"nativeSchema":native});
        if let Some(id) = profile_id {
            request["profileId"] = id;
        }
        call(request, events)
    }
    inventory::submit! { CommandRegistration { name: "provider.status", execute: status } }
    inventory::submit! { CommandRegistration { name: "provider.configure", execute: configure } }
    inventory::submit! { CommandRegistration { name: "provider.profiles.list", execute: profiles_list } }
    inventory::submit! { CommandRegistration { name: "provider.profiles.remove", execute: profile_remove } }
    inventory::submit! { CommandRegistration { name: "provider.key.set", execute: key_set } }
    inventory::submit! { CommandRegistration { name: "provider.key.remove", execute: key_remove } }
    inventory::submit! { CommandRegistration { name: "provider.confirm", execute: confirm } }
    inventory::submit! { CommandRegistration { name: "provider.test", execute: test } }
    inventory::submit! { CommandRegistration { name: "provider.structured", execute: call } }
    #[cfg(test)]
    mod tests {
        use super::*;
        use std::{
            io::{Read, Write},
            net::TcpListener,
            thread,
        };
        static GUARD: Mutex<()> = Mutex::new(());
        /// Serializes the tests that share the settings file and the fake vault, and resets both.
        fn fresh() -> std::sync::MutexGuard<'static, ()> {
            let guard = GUARD.lock().unwrap_or_else(|e| e.into_inner());
            let _ = fs::remove_file(path().unwrap());
            FAKE_VAULT.lock().unwrap().clear();
            guard
        }
        fn run(name: &str, args: Value) -> CommandResult {
            crate::dispatch(name, args, &mut |_| {})
        }
        fn profile<'a>(list: &'a Value, id: &str) -> &'a Value {
            list["profiles"]
                .as_array()
                .unwrap()
                .iter()
                .find(|p| p["id"] == id)
                .unwrap()
        }
        /// Accepts one request, checks the wire and answers a valid structured response.
        fn serve(check: impl Fn(String) + Send + 'static) -> (String, thread::JoinHandle<()>) {
            let listener = TcpListener::bind("127.0.0.1:0").unwrap();
            let endpoint = format!("http://{}/v1", listener.local_addr().unwrap());
            let handle = thread::spawn(move || {
                let (mut stream, _) = listener.accept().unwrap();
                let wire =
                    String::from_utf8(super::super::test_http::read_request(&mut stream)).unwrap();
                check(wire.to_lowercase());
                let body = r#"{"choices":[{"message":{"content":"{\"schemaVersion\":1}"}}]}"#;
                write!(
                    stream,
                    "HTTP/1.1 200 OK\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{}",
                    body.len(),
                    body
                )
                .unwrap();
            });
            (endpoint, handle)
        }
        const V1_REMOTE: &str = "https://192.0.2.10/v1";
        fn write_v1(endpoint: &str) {
            fs::write(
                path().unwrap(),
                json!({"endpoint":endpoint,"model":"old-model","kind":"openai","nativeSchema":true,
                    "providers":{endpoint:{"confirmed":true,"keyLastFour":"1234"}}})
                .to_string(),
            )
            .unwrap();
        }
        #[test]
        fn v1_file_is_read_as_legacy_profile_without_rewriting_it() {
            let _g = fresh();
            write_v1(V1_REMOTE);
            let before = fs::read(path().unwrap()).unwrap();
            let list = run("provider.profiles.list", json!({})).unwrap();
            let legacy = profile(&list, "legacy");
            assert_eq!(legacy["endpoint"], V1_REMOTE);
            assert_eq!(legacy["model"], "old-model");
            assert_eq!(legacy["kind"], "openai");
            assert_eq!(legacy["nativeSchema"], true);
            assert_eq!(legacy["keyLastFour"], "1234");
            assert_eq!(legacy["confirmed"], true);
            assert_eq!(legacy["local"], false);
            let status = run("provider.status", json!({})).unwrap();
            assert_eq!(status["model"], "old-model");
            assert_eq!(status["keyLastFour"], "1234");
            assert_eq!(fs::read(path().unwrap()).unwrap(), before);
        }
        #[test]
        fn old_vault_key_stays_readable_under_the_endpoint_account() {
            let _g = fresh();
            let (endpoint, server) = serve(|wire| {
                assert!(wire.contains("authorization: bearer old-key-1234"));
            });
            write_v1(&endpoint);
            // The v1 key was saved under the endpoint string; nothing may move it.
            vault_set(&endpoint, "old-key-1234").unwrap();
            let output = run("provider.test", json!({})).unwrap();
            assert_eq!(output["data"]["schemaVersion"], 1);
            server.join().unwrap();
            // Editing the legacy profile migrates the file to v2 but keeps the account.
            run(
                "provider.configure",
                json!({"endpoint":endpoint,"model":"new-model","kind":"openai"}),
            )
            .unwrap();
            let file: Value = serde_json::from_slice(&fs::read(path().unwrap()).unwrap()).unwrap();
            assert_eq!(file["schemaVersion"], 2);
            assert_eq!(file["profiles"][0]["id"], "legacy");
            assert!(file["profiles"][0].get("vaultAccount").is_none());
            assert_eq!(vault_get(&endpoint).unwrap(), "old-key-1234");
            assert_eq!(
                run("provider.status", json!({})).unwrap()["keyLastFour"],
                "1234"
            );
        }
        #[test]
        fn profiles_on_one_endpoint_share_key_and_consent_and_an_own_key_does_not() {
            let _g = fresh();
            let configure = |extra: Value| {
                let mut args = json!({"endpoint":V1_REMOTE,"model":"m","kind":"openai"});
                args.as_object_mut()
                    .unwrap()
                    .extend(extra.as_object().unwrap().clone());
                run("provider.configure", args).unwrap()
            };
            configure(json!({}));
            run("provider.key.set", json!({"key":"shared-key-1111"})).unwrap();
            run("provider.confirm", json!({"endpoint":V1_REMOTE})).unwrap();
            configure(json!({"profileId":"fast","model":"cheap","label":"Rápido"}));
            let list = run("provider.profiles.list", json!({})).unwrap();
            let fast = profile(&list, "fast");
            assert_eq!(fast["label"], "Rápido");
            assert_eq!(fast["keyLastFour"], "1111");
            assert_eq!(fast["confirmed"], true);
            assert_eq!(fast["ownKey"], false);
            assert_eq!(FAKE_VAULT.lock().unwrap().len(), 1);
            configure(json!({"profileId":"second","model":"other","ownKey":true}));
            run(
                "provider.key.set",
                json!({"profileId":"second","key":"second-key-2222"}),
            )
            .unwrap();
            assert_eq!(vault_get("profile:second").unwrap(), "second-key-2222");
            assert_eq!(vault_get(V1_REMOTE).unwrap(), "shared-key-1111");
            let list = run("provider.profiles.list", json!({})).unwrap();
            assert_eq!(profile(&list, "second")["keyLastFour"], "2222");
            assert_eq!(profile(&list, "second")["confirmed"], true);
            assert_eq!(profile(&list, "legacy")["keyLastFour"], "1111");
            run("provider.key.remove", json!({"profileId":"second"})).unwrap();
            assert!(vault_get("profile:second").is_err());
            assert_eq!(vault_get(V1_REMOTE).unwrap(), "shared-key-1111");
            // Removing a profile with its own key also removes that key; the shared one stays.
            run(
                "provider.key.set",
                json!({"profileId":"second","key":"again-3333"}),
            )
            .unwrap();
            run("provider.profiles.remove", json!({"profileId":"second"})).unwrap();
            assert!(vault_get("profile:second").is_err());
            assert_eq!(vault_get(V1_REMOTE).unwrap(), "shared-key-1111");
            assert_eq!(
                run("provider.profiles.remove", json!({"profileId":"legacy"}))
                    .unwrap_err()
                    .code,
                "invalid_settings"
            );
            let text = fs::read_to_string(path().unwrap()).unwrap();
            assert!(!text.contains("shared-key") && !text.contains("second-key"));
            assert!(!text.contains("\"local\":"));
        }
        #[test]
        fn explicit_profile_calls_its_own_model_and_key() {
            let _g = fresh();
            let (endpoint, server) = serve(|wire| {
                assert!(wire.contains("authorization: bearer fast-key-4444"));
                assert!(wire.contains("\"model\":\"cheap\""));
            });
            run(
                "provider.configure",
                json!({"endpoint":endpoint,"model":"main","kind":"openai"}),
            )
            .unwrap();
            run(
                "provider.configure",
                json!({"profileId":"fast","endpoint":endpoint,"model":"cheap","kind":"openai","ownKey":true}),
            )
            .unwrap();
            run(
                "provider.key.set",
                json!({"profileId":"fast","key":"fast-key-4444"}),
            )
            .unwrap();
            run("provider.test", json!({"profileId":"fast"})).unwrap();
            server.join().unwrap();
            assert_eq!(
                run("provider.test", json!({"profileId":"missing"}))
                    .unwrap_err()
                    .code,
                "invalid_settings"
            );
        }
        #[test]
        fn invalid_profile_ids_and_cli_ids_are_rejected() {
            let _g = fresh();
            for id in ["", "Codex", "codex", "claude", "a b", "../x"] {
                let err = run(
                    "provider.configure",
                    json!({"profileId":id,"endpoint":V1_REMOTE,"model":"m"}),
                )
                .unwrap_err();
                assert_eq!(err.code, "invalid_settings", "{id}");
            }
            assert!(!path().unwrap().exists());
        }
        #[test]
        fn legacy_settings_default_to_openai() {
            let settings: Settings = serde_json::from_value(
                json!({"endpoint":"http://localhost:1/v1", "model":"old", "nativeSchema":false}),
            )
            .unwrap();
            assert_eq!(settings.kind, "openai");
            assert_eq!(settings.timeouts, Timeouts::default());
            let configured: Settings = serde_json::from_value(
                json!({"endpoint":"http://localhost:1/v1", "model":"m", "nativeSchema":false, "timeouts":{"local":900}}),
            )
            .unwrap();
            assert_eq!(configured.timeouts.endpoint(true), Duration::from_secs(900));
            assert_eq!(configured.timeouts.endpoint(false), Duration::from_secs(60));
        }
        #[test]
        fn headless_dispatch_uses_fake_vault_and_never_returns_key() {
            let _g = fresh();
            let listener = TcpListener::bind("127.0.0.1:0").unwrap();
            let endpoint = format!("http://{}/v1", listener.local_addr().unwrap());
            let server = thread::spawn(move || {
                let (mut stream, _) = listener.accept().unwrap();
                stream
                    .set_read_timeout(Some(Duration::from_secs(3)))
                    .unwrap();
                let mut bytes = Vec::new();
                loop {
                    let mut chunk = [0; 4096];
                    let n = stream.read(&mut chunk).unwrap();
                    bytes.extend_from_slice(&chunk[..n]);
                    if let Some(pos) = bytes.windows(4).position(|x| x == b"\r\n\r\n") {
                        let headers = String::from_utf8_lossy(&bytes[..pos]).to_lowercase();
                        let length: usize = headers
                            .lines()
                            .find_map(|line| line.strip_prefix("content-length:"))
                            .unwrap()
                            .trim()
                            .parse()
                            .unwrap();
                        if bytes.len() >= pos + 4 + length {
                            break;
                        }
                    }
                }
                let wire = String::from_utf8(bytes).unwrap();
                assert!(wire
                    .to_lowercase()
                    .contains("authorization: bearer fixture-value-1234"));
                let body = r#"{"choices":[{"message":{"content":"{\"schemaVersion\":1}"}}]}"#;
                write!(
                    stream,
                    "HTTP/1.1 200 OK\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{}",
                    body.len(),
                    body
                )
                .unwrap();
            });
            let mut events = Vec::new();
            let mut dispatch =
                |name, args| crate::dispatch(name, args, &mut |event| events.push(event));
            dispatch(
                "provider.configure",
                json!({"endpoint":endpoint,"model":"example","nativeSchema":false}),
            )
            .unwrap();
            dispatch("provider.key.set", json!({"key":"fixture-value-1234"})).unwrap();
            let status = dispatch("provider.status", json!({})).unwrap();
            assert_eq!(status["keyLastFour"], "1234");
            assert!(!status.to_string().contains("fixture-value"));
            let output = dispatch("provider.test", json!({})).unwrap();
            assert_eq!(
                output,
                json!({"data":{"schemaVersion":1},"usage":null,"calls":1})
            );
            dispatch("provider.key.remove", json!({})).unwrap();
            assert_eq!(
                dispatch("provider.status", json!({})).unwrap()["keyLastFour"],
                Value::Null
            );
            assert!(!fs::read_to_string(path().unwrap())
                .unwrap()
                .contains("fixture-value"));
            server.join().unwrap();
            for kind in ["anthropic", "gemini"] {
                let listener = TcpListener::bind("127.0.0.1:0").unwrap();
                let endpoint = format!("http://{}/v1", listener.local_addr().unwrap());
                let server = thread::spawn(move || {
                    let (mut stream, _) = listener.accept().unwrap();
                    let _ = super::super::test_http::read_request(&mut stream);
                    let body = if kind == "anthropic" { json!({"content":[{"type":"text","text":"{\"schemaVersion\":1}"}],"usage":{"input_tokens":2,"output_tokens":3}}) } else { json!({"candidates":[{"content":{"parts":[{"text":"{\"schemaVersion\":1}"}]}}],"usageMetadata":{"promptTokenCount":2,"candidatesTokenCount":3}}) }.to_string();
                    write!(
                        stream,
                        "HTTP/1.1 200 OK\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{}",
                        body.len(),
                        body
                    )
                    .unwrap();
                });
                dispatch(
                    "provider.configure",
                    json!({"endpoint":endpoint,"model":"example","kind":kind,"nativeSchema":true}),
                )
                .unwrap();
                assert_eq!(
                    dispatch("provider.test", json!({})).unwrap(),
                    json!({"data":{"schemaVersion":1},"usage":{"inputTokens":2,"outputTokens":3},"calls":1})
                );
                server.join().unwrap();
            }
            drop(dispatch);
            assert!(!serde_json::to_string(&events)
                .unwrap()
                .contains("fixture-value"));
            fs::remove_file(path().unwrap()).unwrap();
        }
    }
}

#[cfg(test)]
mod test_http {
    pub(super) fn read_request(stream: &mut std::net::TcpStream) -> Vec<u8> {
        stream.set_nonblocking(false).unwrap();
        stream
            .set_read_timeout(Some(std::time::Duration::from_secs(3)))
            .unwrap();
        let mut bytes = Vec::new();
        loop {
            let mut chunk = [0; 4096];
            let n = std::io::Read::read(stream, &mut chunk).unwrap();
            assert!(n > 0, "request ended before its body");
            bytes.extend_from_slice(&chunk[..n]);
            if let Some(pos) = bytes.windows(4).position(|x| x == b"\r\n\r\n") {
                let headers = String::from_utf8_lossy(&bytes[..pos]);
                let length: usize = headers
                    .lines()
                    .find_map(|line| {
                        line.split_once(':')
                            .filter(|(name, _)| name.eq_ignore_ascii_case("content-length"))
                            .map(|(_, value)| value.trim().parse().unwrap())
                    })
                    .expect("missing Content-Length");
                if bytes.len() >= pos + 4 + length {
                    return bytes;
                }
            }
        }
    }
}

#[cfg(test)]
mod security_tests {
    use super::*;
    use std::{net::TcpListener, thread, time::Instant};

    fn input() -> StructuredRequest {
        StructuredRequest {
            instruction: "Return JSON".into(),
            transcript: String::new(),
            schema: json!({"type":"object"}),
            native_schema: false,
            max_output_tokens: None,
        }
    }

    #[test]
    fn timeout_after_request_does_not_retry() {
        let listener = TcpListener::bind("127.0.0.1:0").unwrap();
        let endpoint = format!("http://{}/v1", listener.local_addr().unwrap());
        listener.set_nonblocking(true).unwrap();
        let server = thread::spawn(move || {
            let deadline = Instant::now() + Duration::from_secs(2);
            let mut connections = Vec::new();
            while Instant::now() < deadline {
                if let Ok((mut stream, _)) = listener.accept() {
                    stream
                        .set_read_timeout(Some(Duration::from_secs(1)))
                        .unwrap();
                    let _ = super::test_http::read_request(&mut stream);
                    connections.push(stream);
                }
                thread::sleep(Duration::from_millis(5));
            }
            connections.len()
        });
        let mut provider = OpenAiProvider::new(endpoint, "model".into(), None).unwrap();
        provider.0.timeout = Some(Duration::from_millis(100));
        assert_eq!(
            provider.structured(&input()).unwrap_err().code,
            "timeout_uncertain"
        );
        assert_eq!(server.join().unwrap(), 1);
    }

    #[test]
    fn remote_plain_http_with_key_is_rejected_before_connecting() {
        let mut provider = OpenAiProvider::new(
            "http://0.0.0.0:1/v1".into(),
            "model".into(),
            Some("fixture-value-1234".into()),
        )
        .unwrap();
        provider.0.remote_confirmed = true;
        assert_eq!(
            provider.structured(&input()).unwrap_err().code,
            "insecure_endpoint"
        );
        provider.0.key = None;
        assert_ne!(
            provider.structured(&input()).unwrap_err().code,
            "insecure_endpoint"
        );
    }
}
