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
    /// O Provedor de API ou modelo local configurado em `provider.configure`.
    Endpoint,
    /// Um CLI (`codex` ou `claude`) já confirmado pelo usuário.
    Cli(String),
}

fn valid_choice(choice: &str) -> bool {
    matches!(choice, "" | "endpoint" | "codex" | "claude")
}

fn valid_task(task: &str) -> bool {
    TASKS.contains(&task)
}

/// Resolve o Provedor de uma tarefa: troca da tarefa, senão o padrão, senão nada.
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
        kind @ ("codex" | "claude") => {
            if crate::provider_cli::confirmed(kind)? {
                Ok(Route::Cli(kind.into()))
            } else {
                Err(error(
                    "confirmation_required",
                    "Confirm sending text to this provider first",
                ))
            }
        }
        _ => Err(error("invalid_settings", "Invalid provider")),
    }
}

/// Esquece as escolhas que apontam para um CLI desativado.
pub(crate) fn forget_cli() -> Result<(), CoreError> {
    let _lock = locked()?;
    let mut settings = read()?;
    let is_cli = |choice: &String| matches!(choice.as_str(), "codex" | "claude");
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

fn view(settings: &Settings) -> Value {
    let tasks: BTreeMap<&str, &str> = TASKS
        .iter()
        .map(|task| {
            (
                *task,
                settings.tasks.get(*task).map(String::as_str).unwrap_or(""),
            )
        })
        .collect();
    json!({
        "completed": settings.completed,
        "skipped": settings.skipped,
        "needsSetup": !settings.completed && !settings.skipped,
        "default": settings.default,
        "tasks": tasks,
    })
}

fn status(_: Value, _: &mut EventSink<'_>) -> CommandResult {
    let _lock = locked()?;
    Ok(view(&read()?))
}

fn check_choice(choice: &str) -> Result<(), CoreError> {
    if !valid_choice(choice) {
        return Err(error("invalid_settings", "Invalid provider"));
    }
    if matches!(choice, "codex" | "claude") && !crate::provider_cli::confirmed(choice)? {
        return Err(error(
            "confirmation_required",
            "Confirm sending text to this provider first",
        ));
    }
    Ok(())
}

fn set_default(args: Value, _: &mut EventSink<'_>) -> CommandResult {
    let choice = args.get("choice").and_then(Value::as_str).unwrap_or("");
    check_choice(choice)?;
    let _lock = locked()?;
    let mut settings = read()?;
    settings.default = choice.into();
    write(&settings)?;
    Ok(view(&settings))
}

fn set_task(args: Value, _: &mut EventSink<'_>) -> CommandResult {
    let task = args.get("task").and_then(Value::as_str).unwrap_or("");
    if !valid_task(task) {
        return Err(error("invalid_settings", "Invalid task"));
    }
    let choice = args.get("choice").and_then(Value::as_str).unwrap_or("");
    check_choice(choice)?;
    let _lock = locked()?;
    let mut settings = read()?;
    if choice.is_empty() {
        settings.tasks.remove(task);
    } else {
        settings.tasks.insert(task.into(), choice.into());
    }
    write(&settings)?;
    Ok(view(&settings))
}

fn complete(args: Value, _: &mut EventSink<'_>) -> CommandResult {
    let skipped = args
        .get("skipped")
        .and_then(Value::as_bool)
        .unwrap_or(false);
    let _lock = locked()?;
    let mut settings = read()?;
    settings.completed = !skipped;
    settings.skipped = skipped;
    write(&settings)?;
    Ok(view(&settings))
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
    }))
}

inventory::submit! { CommandRegistration { name: "assistant.status", execute: status } }
inventory::submit! { CommandRegistration { name: "assistant.detect", execute: detect } }
inventory::submit! { CommandRegistration { name: "assistant.default.set", execute: set_default } }
inventory::submit! { CommandRegistration { name: "assistant.task.set", execute: set_task } }
inventory::submit! { CommandRegistration { name: "assistant.complete", execute: complete } }

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
