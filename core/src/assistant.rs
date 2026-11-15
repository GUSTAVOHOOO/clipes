//! Assistente de primeira execução: detecção de Provedores já instalados na máquina e
//! escolha do Provedor padrão e das trocas por tarefa.
//!
//! As escolhas ficam nas configurações do app (`CLIPES_DATA_DIR`), nunca no Projeto nem no
//! Perfil de canal. Não existe Provedor padrão de fábrica: sem escolha do usuário, nada é
//! selecionado. A detecção só fala com loopback e nunca envia dados.
use crate::{CommandRegistration, CommandResult, CoreError, EventSink};
use reqwest::{blocking::Client, redirect::Policy, Url};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::{
    collections::BTreeMap,
    ffi::OsString,
    fs,
    net::IpAddr,
    path::{Path, PathBuf},
    sync::Mutex,
    time::Duration,
};

static LOCK: Mutex<()> = Mutex::new(());

const DETECT_TIMEOUT: Duration = Duration::from_millis(800);
const TASKS: [&str; 4] = ["selection", "packaging", "script", "translation"];
const DEFAULT_OLLAMA: &str = "http://127.0.0.1:11434";
const DEFAULT_LMSTUDIO: &str = "http://127.0.0.1:1234";
const DEFAULT_LLAMACPP: &str = "http://127.0.0.1:8080";

fn error(code: &str, message: &str) -> CoreError {
    CoreError {
        code: code.into(),
        message: message.into(),
        usage: None,
    }
}

#[derive(Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct Settings {
    #[serde(default)]
    completed: bool,
    #[serde(default)]
    skipped: bool,
    /// "" (nenhum), "endpoint", "codex" ou "claude".
    #[serde(default)]
    default: String,
    #[serde(default)]
    tasks: BTreeMap<String, String>,
    /// Tarefas que só aceitam Provedor local (só as ligadas; ausente = desligado).
    #[serde(default)]
    local_only: BTreeMap<String, bool>,
}

fn path() -> Result<PathBuf, CoreError> {
    if let Some(dir) = std::env::var_os("CLIPES_DATA_DIR") {
        return Ok(PathBuf::from(dir).join("assistant.json"));
    }
    #[cfg(test)]
    return Ok(
        std::env::temp_dir().join(format!("clipes-assistant-test-{}.json", std::process::id()))
    );
    #[cfg(not(test))]
    directories::ProjectDirs::from("io", "github.gustavohooo", "clipes")
        .map(|p| p.config_dir().join("assistant.json"))
        .ok_or_else(|| error("settings", "Could not locate settings directory"))
}

fn read() -> Result<Settings, CoreError> {
    match fs::read(path()?) {
        Ok(bytes) => serde_json::from_slice(&bytes)
            .map_err(|_| error("settings", "Could not read assistant settings")),
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(Settings::default()),
        Err(_) => Err(error("settings", "Could not read assistant settings")),
    }
}

fn write(settings: &Settings) -> Result<(), CoreError> {
    let target = path()?;
    let fail = || error("settings", "Could not save assistant settings");
    fs::create_dir_all(target.parent().ok_or_else(fail)?).map_err(|_| fail())?;
    let temporary = target.with_extension("json.tmp");
    fs::write(
        &temporary,
        serde_json::to_vec(settings).map_err(|_| fail())?,
    )
    .map_err(|_| fail())?;
    fs::rename(&temporary, &target).map_err(|_| fail())
}

fn locked() -> Result<std::sync::MutexGuard<'static, ()>, CoreError> {
    LOCK.lock()
        .map_err(|_| error("settings", "Could not access assistant settings"))
}

/// Provedor escolhido para uma chamada.
#[derive(Debug, PartialEq, Eq)]
pub(crate) enum Route {
    /// O usuário ainda não escolheu pelo assistente: vale o comportamento anterior.
    Unset,
    /// O Provedor de API ou modelo local configurado em `provider.configure`
    /// (o perfil `legacy`).
    Endpoint,
    /// Um perfil salvo, escolhido como `profile:<id>`.
    Profile(String),
    /// Um CLI (`codex` ou `claude`) já confirmado pelo usuário.
    Cli(String),
}

const PROFILE_PREFIX: &str = "profile:";

/// `profile:<id>` com o id de um perfil salvo. Os CLIs seguem como `codex` e `claude`.
fn profile_id(choice: &str) -> Option<&str> {
    choice
        .strip_prefix(PROFILE_PREFIX)
        .filter(|id| !id.is_empty() && !matches!(*id, "codex" | "claude" | "opencode"))
}

fn valid_choice(choice: &str) -> bool {
    matches!(choice, "" | "endpoint" | "codex" | "claude" | "opencode")
        || profile_id(choice).is_some()
}

fn valid_task(task: &str) -> bool {
    TASKS.contains(&task)
}

fn profile_exists(id: &str) -> Result<bool, CoreError> {
    Ok(crate::provider::profile_infos()?.iter().any(|p| p.id == id))
}

/// Resolve o Provedor de uma tarefa: troca da tarefa, senão o padrão, senão nada. Um perfil
/// removido que a escolha ainda aponta recusa a chamada: nunca cai em outro perfil sozinho.
pub(crate) fn route(task: Option<&str>) -> Result<Route, CoreError> {
    if let Some(task) = task {
        if !valid_task(task) {
            return Err(error("invalid_request", "Invalid task"));
        }
    }
    let settings = {
        let _lock = locked()?;
        read()?
    };
    let choice = task
        .and_then(|task| settings.tasks.get(task))
        .filter(|choice| !choice.is_empty())
        .unwrap_or(&settings.default);
    match choice.as_str() {
        "" => Ok(Route::Unset),
        "endpoint" => Ok(Route::Endpoint),
        kind @ ("codex" | "claude" | "opencode") => {
            if crate::provider_cli::confirmed(kind)? {
                Ok(Route::Cli(kind.into()))
            } else {
                Err(error(
                    "confirmation_required",
                    "Confirm sending text to this provider first",
                ))
            }
        }
        other => match profile_id(other) {
            Some(id) if profile_exists(id)? => Ok(Route::Profile(id.into())),
            Some(_) => Err(error(
                "profile_unavailable",
                "The chosen profile no longer exists",
            )),
            None => Err(error("invalid_settings", "Invalid provider")),
        },
    }
}

/// Se a tarefa só aceita Provedor local. Vale só para a tarefa; o veto por Projeto é outro.
pub(crate) fn local_only(task: &str) -> Result<bool, CoreError> {
    let _lock = locked()?;
    Ok(read()?.local_only.get(task).copied().unwrap_or(false))
}

/// Esquece as escolhas que apontam para um CLI desativado.
pub(crate) fn forget_cli() -> Result<(), CoreError> {
    let _lock = locked()?;
    let mut settings = read()?;
    let is_cli = |choice: &String| matches!(choice.as_str(), "codex" | "claude" | "opencode");
    let before = (settings.default.clone(), settings.tasks.len());
    if is_cli(&settings.default) {
        settings.default.clear();
    }
    settings.tasks.retain(|_, choice| !is_cli(choice));
    if before != (settings.default.clone(), settings.tasks.len()) {
        write(&settings)?;
    }
    Ok(())
}

/// A escolha como a UI a vê: um `profile:<id>` removido aparece como "sem escolha" e o id
/// vai em `missing`, para a UI avisar. Os valores antigos passam como estão.
fn shown(choice: &str, known: &[String]) -> (String, Option<String>) {
    match profile_id(choice) {
        Some(id) if !known.iter().any(|k| k == id) => (String::new(), Some(id.to_owned())),
        _ => (choice.to_owned(), None),
    }
}

fn view(settings: &Settings) -> Result<Value, CoreError> {
    let known: Vec<String> = crate::provider::profile_infos()?
        .into_iter()
        .map(|p| p.id)
        .collect();
    let mut missing = BTreeMap::new();
    let (default, gone) = shown(&settings.default, &known);
    if let Some(id) = gone {
        missing.insert("default".to_owned(), id);
    }
    let mut tasks = BTreeMap::new();
    let mut local_only = BTreeMap::new();
    for task in TASKS {
        let (choice, gone) = shown(settings.tasks.get(task).map_or("", String::as_str), &known);
        if let Some(id) = gone {
            missing.insert(task.to_owned(), id);
        }
        tasks.insert(task, choice);
        local_only.insert(
            task,
            settings.local_only.get(task).copied().unwrap_or(false),
        );
    }
    Ok(json!({
        "completed": settings.completed,
        "skipped": settings.skipped,
        "needsSetup": !settings.completed && !settings.skipped,
        "default": default,
        "tasks": tasks,
        "localOnly": local_only,
        "missing": missing,
    }))
}

fn status(_: Value, _: &mut EventSink<'_>) -> CommandResult {
    let settings = {
        let _lock = locked()?;
        read()?
    };
    view(&settings)
}

fn check_choice(choice: &str) -> Result<(), CoreError> {
    if !valid_choice(choice) {
        return Err(error("invalid_settings", "Invalid provider"));
    }
    if matches!(choice, "codex" | "claude" | "opencode") && !crate::provider_cli::confirmed(choice)?
    {
        return Err(error(
            "confirmation_required",
            "Confirm sending text to this provider first",
        ));
    }
    if let Some(id) = profile_id(choice) {
        if !profile_exists(id)? {
            return Err(error("invalid_settings", "Profile not found"));
        }
    }
    Ok(())
}

fn set_default(args: Value, _: &mut EventSink<'_>) -> CommandResult {
    let choice = args.get("choice").and_then(Value::as_str).unwrap_or("");
    check_choice(choice)?;
    let settings = {
        let _lock = locked()?;
        let mut settings = read()?;
        settings.default = choice.into();
        write(&settings)?;
        settings
    };
    view(&settings)
}

/// Trocar a escolha de uma tarefa não mexe nas outras, nem no padrão.
fn set_task(args: Value, _: &mut EventSink<'_>) -> CommandResult {
    let task = args.get("task").and_then(Value::as_str).unwrap_or("");
    if !valid_task(task) {
        return Err(error("invalid_settings", "Invalid task"));
    }
    let choice = args.get("choice").and_then(Value::as_str).unwrap_or("");
    check_choice(choice)?;
    let settings = {
        let _lock = locked()?;
        let mut settings = read()?;
        if choice.is_empty() {
            settings.tasks.remove(task);
        } else {
            settings.tasks.insert(task.into(), choice.into());
        }
        write(&settings)?;
        settings
    };
    view(&settings)
}

/// Liga ou desliga o "somente local" de uma tarefa.
fn set_local_only(args: Value, _: &mut EventSink<'_>) -> CommandResult {
    let task = args.get("task").and_then(Value::as_str).unwrap_or("");
    let Some(enabled) = args.get("enabled").and_then(Value::as_bool) else {
        return Err(error("invalid_settings", "Invalid setting"));
    };
    if !valid_task(task) {
        return Err(error("invalid_settings", "Invalid task"));
    }
    let settings = {
        let _lock = locked()?;
        let mut settings = read()?;
        if enabled {
            settings.local_only.insert(task.into(), true);
        } else {
            settings.local_only.remove(task);
        }
        write(&settings)?;
        settings
    };
    view(&settings)
}

/// Para a tabela "Tarefas": perfil, selo de localidade, preço e a sugestão (nunca aplicada).
fn tasks(_: Value, _: &mut EventSink<'_>) -> CommandResult {
    let settings = {
        let _lock = locked()?;
        read()?
    };
    let infos = crate::provider::profile_infos()?;
    let cost_of = |kind: &str, model: &str, local: bool| -> Result<Value, CoreError> {
        if local {
            return Ok(json!({"kind": "zero"}));
        }
        Ok(match crate::provider::cost::price_for(kind, model)? {
            None => json!({"kind": "unknown"}),
            Some((price, source)) => json!({
                "kind": "usd",
                "inputPerMillion": price.input_per_million,
                "outputPerMillion": price.output_per_million,
                "priceSource": source,
            }),
        })
    };
    let from_profile = |id: &str| -> Result<Option<Value>, CoreError> {
        let Some(p) = infos.iter().find(|p| p.id == id) else {
            return Ok(None);
        };
        let local = crate::provider::is_loopback_endpoint(&p.endpoint);
        Ok(Some(json!({
            "id": p.id, "label": p.label, "kind": p.kind, "model": p.model,
            "local": local, "cli": false, "cost": cost_of(&p.kind, &p.model, local)?,
        })))
    };
    let target = |choice: &str| -> Result<Option<Value>, CoreError> {
        match choice {
            "endpoint" => from_profile("legacy"),
            "codex" | "claude" | "opencode" => Ok(Some(json!({
                "id": choice, "kind": choice, "model": if choice == "opencode" { json!(crate::provider_cli::opencode_model()?) } else { Value::Null }, "local": false, "cli": true,
                "label": crate::provider_cli::label(choice),
                "cost": if choice == "opencode" { crate::provider_cli::opencode_cost(&crate::provider_cli::opencode_model()?) } else { json!({"kind":"plan_quota"}) },
            }))),
            other => match profile_id(other) {
                Some(id) => from_profile(id),
                None => Ok(None),
            },
        }
    };
    // Só sugere o que já existe nesta máquina e é local; ainda não foi medido (ADR-0010, regra 2).
    let suggestion = infos
        .iter()
        .find(|p| crate::provider::is_loopback_endpoint(&p.endpoint))
        .map(|p| {
            json!({
                "choice": format!("{PROFILE_PREFIX}{}", p.id),
                "label": p.label,
                "measured": false,
            })
        });
    let project_local_only = crate::projects::project_local_only()?;
    let mut rows = Vec::new();
    for task in TASKS {
        let own = settings.tasks.get(task).filter(|c| !c.is_empty());
        let (source, choice) = match own {
            Some(choice) => ("task", choice.as_str()),
            None if !settings.default.is_empty() => ("default", settings.default.as_str()),
            None => ("none", ""),
        };
        let target = target(choice)?;
        // Escolha que aponta para um perfil que não existe mais: volta a "sem escolha".
        let missing = if target.is_none() {
            profile_id(choice).map(str::to_owned)
        } else {
            None
        };
        let local_only = settings.local_only.get(task).copied().unwrap_or(false);
        let blocked = (local_only || project_local_only)
            && target.as_ref().is_some_and(|t| t["local"] == json!(false));
        let unchosen = target.is_none();
        rows.push(json!({
            "task": task,
            "choice": if missing.is_some() { "" } else { own.map_or("", String::as_str) },
            "source": if missing.is_some() { "none" } else { source },
            "profile": target,
            "localOnly": local_only,
            "blocked": blocked,
            "missing": missing,
            "suggestion": if unchosen { suggestion.clone().unwrap_or(Value::Null) } else { Value::Null },
        }));
    }
    Ok(json!({"tasks": rows, "projectLocalOnly": project_local_only}))
}

fn complete(args: Value, _: &mut EventSink<'_>) -> CommandResult {
    let skipped = args
        .get("skipped")
        .and_then(Value::as_bool)
        .unwrap_or(false);
    let settings = {
        let _lock = locked()?;
        let mut settings = read()?;
        settings.completed = !skipped;
        settings.skipped = skipped;
        write(&settings)?;
        settings
    };
    view(&settings)
}

// ---- Detecção ----

fn loopback_base(url: &str) -> Result<Url, CoreError> {
    let invalid = || error("invalid_endpoint", "Detection only accepts local addresses");
    let url = Url::parse(url).map_err(|_| invalid())?;
    let host = url.host_str().ok_or_else(invalid)?;
    let loopback = host.eq_ignore_ascii_case("localhost")
        || host
            .trim_matches(['[', ']'])
            .parse::<IpAddr>()
            .is_ok_and(|ip| ip.is_loopback());
    if url.scheme() != "http"
        || !loopback
        || !url.username().is_empty()
        || url.password().is_some()
        || url.query().is_some()
        || url.fragment().is_some()
        || url.path() != "/"
    {
        return Err(invalid());
    }
    Ok(url)
}

fn client() -> Option<Client> {
    Client::builder()
        .timeout(DETECT_TIMEOUT)
        .connect_timeout(DETECT_TIMEOUT)
        .redirect(Policy::none())
        .no_proxy()
        .build()
        .ok()
}

fn get(client: &Client, base: &Url, path: &str) -> Option<Vec<u8>> {
    let response = client.get(base.join(path).ok()?).send().ok()?;
    if !response.status().is_success() {
        return None;
    }
    // Um servidor local legítimo responde com listas pequenas; o resto é descartado.
    let bytes = response.bytes().ok()?;
    (bytes.len() <= 1 << 20).then(|| bytes.to_vec())
}

fn names(body: &[u8], list: &str, field: &str) -> Option<Vec<String>> {
    let value: Value = serde_json::from_slice(body).ok()?;
    let items = value.get(list)?.as_array()?;
    Some(
        items
            .iter()
            .filter_map(|item| item.get(field).and_then(Value::as_str))
            .take(200)
            .map(str::to_owned)
            .collect(),
    )
}

enum Server {
    Ollama,
    LmStudio,
    LlamaCpp,
}

fn probe(server: Server, base: &Url) -> Value {
    let absent = json!({"found": false, "endpoint": null, "models": []});
    let Some(client) = client() else {
        return absent;
    };
    let models = match server {
        Server::Ollama => get(&client, base, "api/tags").and_then(|b| names(&b, "models", "name")),
        Server::LmStudio => get(&client, base, "v1/models").and_then(|b| names(&b, "data", "id")),
        Server::LlamaCpp => get(&client, base, "v1/models")
            .and_then(|b| names(&b, "data", "id"))
            .or_else(|| get(&client, base, "health").map(|_| Vec::new())),
    };
    match models {
        Some(models) => json!({
            "found": true,
            // Base compatível com a API da OpenAI, pronta para `provider.configure`.
            "endpoint": base.join("v1").map(|u| u.to_string()).unwrap_or_default(),
            "models": models,
        }),
        None => absent,
    }
}

fn on_path(program: &str, search: &OsString) -> bool {
    let extensions: &[&str] = if cfg!(windows) {
        &["exe", "cmd", "bat", "com"]
    } else {
        &[""]
    };
    std::env::split_paths(search).any(|dir| {
        !dir.as_os_str().is_empty()
            && extensions.iter().any(|extension| {
                let name = if extension.is_empty() {
                    program.to_owned()
                } else {
                    format!("{program}.{extension}")
                };
                is_executable(&dir.join(name))
            })
    })
}

fn is_executable(path: &Path) -> bool {
    let Ok(metadata) = fs::metadata(path) else {
        return false;
    };
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        metadata.is_file() && metadata.permissions().mode() & 0o111 != 0
    }
    #[cfg(not(unix))]
    {
        metadata.is_file()
    }
}

/// Procura o que o usuário já tem. `ollama`, `lmStudio`, `llamaCpp` (URLs de loopback) e
/// `path` existem para os testes; a UI não os envia.
fn detect(args: Value, _: &mut EventSink<'_>) -> CommandResult {
    let base = |key: &str, default: &str| {
        loopback_base(args.get(key).and_then(Value::as_str).unwrap_or(default))
    };
    let (ollama, lmstudio, llamacpp) = (
        base("ollama", DEFAULT_OLLAMA)?,
        base("lmStudio", DEFAULT_LMSTUDIO)?,
        base("llamaCpp", DEFAULT_LLAMACPP)?,
    );
    let search = match args.get("path").and_then(Value::as_str) {
        Some(path) => OsString::from(path),
        None => std::env::var_os("PATH").unwrap_or_default(),
    };
    let (ollama, lmstudio, llamacpp) = std::thread::scope(|scope| {
        let a = scope.spawn(|| probe(Server::Ollama, &ollama));
        let b = scope.spawn(|| probe(Server::LmStudio, &lmstudio));
        let c = scope.spawn(|| probe(Server::LlamaCpp, &llamacpp));
        let join = |h: std::thread::ScopedJoinHandle<'_, Value>| {
            h.join()
                .unwrap_or_else(|_| json!({"found": false, "endpoint": null, "models": []}))
        };
        (join(a), join(b), join(c))
    });
    Ok(json!({
        "ollama": ollama,
        "lmStudio": lmstudio,
        "llamaCpp": llamacpp,
        "codex": {"found": on_path("codex", &search)},
        "claude": {"found": on_path("claude", &search)},
        "opencode": {"found": on_path("opencode", &search)},
    }))
}

inventory::submit! { CommandRegistration { name: "assistant.status", execute: status } }
inventory::submit! { CommandRegistration { name: "assistant.detect", execute: detect } }
inventory::submit! { CommandRegistration { name: "assistant.default.set", execute: set_default } }
inventory::submit! { CommandRegistration { name: "assistant.task.set", execute: set_task } }
inventory::submit! { CommandRegistration { name: "assistant.complete", execute: complete } }
inventory::submit! { CommandRegistration { name: "assistant.local_only.set", execute: set_local_only } }
inventory::submit! { CommandRegistration { name: "assistant.tasks", execute: tasks } }

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn detection_only_accepts_loopback_http() {
        assert!(loopback_base("http://127.0.0.1:1234").is_ok());
        assert!(loopback_base("http://localhost:8080").is_ok());
        assert!(loopback_base("http://[::1]:11434").is_ok());
        for url in [
            "http://192.168.0.2:1234",
            "https://127.0.0.1:1234",
            "http://example.com",
            "http://user@127.0.0.1:1",
            "http://127.0.0.1:1/x",
            "not a url",
        ] {
            assert_eq!(loopback_base(url).unwrap_err().code, "invalid_endpoint");
        }
    }

    #[test]
    fn settings_without_fields_mean_no_choice() {
        let settings: Settings = serde_json::from_value(json!({})).unwrap();
        assert!(settings.default.is_empty() && !settings.completed && !settings.skipped);
    }
}
