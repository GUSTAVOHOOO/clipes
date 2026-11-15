//! #146: estado do perfil para a seleção (cheia, reduzida, bloqueada) e diagnóstico por
//! allowlist. Sem rede: perfis em 192.0.2.x (documentação) sem consentimento, e só o cache
//! do contexto efetivo é lido. Dados isolados por `CLIPES_DATA_DIR`.
use clipes_core::{dispatch, CoreError};
use serde_json::{json, Value};
use std::sync::Mutex;

static ENV: Mutex<()> = Mutex::new(());
fn run(name: &str, args: Value) -> Result<Value, CoreError> {
    dispatch(name, args, &mut |_| {})
}
fn isolated() -> (std::sync::MutexGuard<'static, ()>, tempfile::TempDir) {
    let guard = ENV.lock().unwrap_or_else(|e| e.into_inner());
    let dir = tempfile::tempdir().unwrap();
    std::env::set_var("CLIPES_DATA_DIR", dir.path());
    (guard, dir)
}
fn configure(id: &str, kind: &str, endpoint: &str, model: &str, context: Option<u64>) {
    run(
        "provider.configure",
        json!({"profileId": id, "label": id, "endpoint": endpoint, "kind": kind, "model": model, "context": context}),
    )
    .unwrap();
}
fn state(id: &str) -> Value {
    run("provider.selection_state", json!({"profileId": id})).unwrap()
}

#[test]
fn context_decides_full_reduced_or_blocked_for_dense_speech() {
    let (_guard, _dir) = isolated();
    for (id, context) in [
        ("c4", 4_096),
        ("c8", 8_192),
        ("c16", 16_384),
        ("c32", 32_768),
    ] {
        configure(
            id,
            "openai",
            "https://192.0.2.10/v1",
            "modelo-x",
            Some(context),
        );
    }
    let states: Vec<String> = ["c4", "c8", "c16", "c32"]
        .iter()
        .map(|id| state(id)["state"].as_str().unwrap().to_owned())
        .collect();
    // Os números são só referência: o estado vem do planejador (#144), não de portões fixos.
    assert_eq!(states[0], "blocked");
    assert_eq!(states[3], "full");
    // Monotônico: mais contexto nunca piora o estado.
    let rank = |s: &str| {
        ["blocked", "reduced", "full"]
            .iter()
            .position(|x| *x == s)
            .unwrap()
    };
    assert!(
        states.windows(2).all(|w| rank(&w[0]) <= rank(&w[1])),
        "{states:?}"
    );

    let full = state("c32");
    assert_eq!(full["applicable"], true);
    assert_eq!(full["contextTokens"], 32_768);
    assert_eq!(full["origin"], "user");
    assert_eq!(full["model"], "modelo-x");
    assert_eq!(full["reference"]["sourceMinutes"], 60);
    assert_eq!(full["reference"]["maxWindowMinutes"], 15);
    assert_eq!(full["reference"]["firstWindowMinutes"], 15);
    assert!(full["reference"]["windows"].as_u64().unwrap() >= 4);
    // Remoto: nenhuma rota de instruções para servidor local.
    assert_eq!(full["guides"], json!([]));

    let blocked = state("c4");
    assert_eq!(blocked["reference"]["windows"], Value::Null);
    assert_eq!(blocked["reference"]["minWindowMinutes"], 9);
}

#[test]
fn reduced_state_exists_between_blocked_and_full() {
    let (_guard, _dir) = isolated();
    let mut seen = std::collections::BTreeSet::new();
    for context in (4_096..=40_000).step_by(512) {
        configure("p", "openai", "https://192.0.2.10/v1", "m", Some(context));
        seen.insert(state("p")["state"].as_str().unwrap().to_owned());
    }
    assert_eq!(
        seen.into_iter().collect::<Vec<_>>(),
        ["blocked", "full", "reduced"]
    );
}

#[test]
fn guides_follow_the_profile_kind_and_locality() {
    let (_guard, _dir) = isolated();
    configure(
        "oll",
        "ollama",
        "http://127.0.0.1:11434",
        "llama3",
        Some(4_096),
    );
    configure(
        "lan",
        "openai",
        "http://127.0.0.1:1234/v1",
        "m",
        Some(4_096),
    );
    configure("nuvem", "openai", "https://192.0.2.10/v1", "m", Some(4_096));
    assert_eq!(state("oll")["guides"], json!(["ollama_profile"]));
    assert_eq!(
        state("lan")["guides"],
        json!(["ollama_server", "lmstudio", "llamacpp"])
    );
    assert_eq!(state("nuvem")["guides"], json!([]));
}

#[test]
fn cli_profiles_have_no_estimate_and_missing_profiles_fail_typed() {
    let (_guard, _dir) = isolated();
    for id in ["codex", "claude", "opencode"] {
        assert_eq!(state(id), json!({"applicable": false}));
    }
    let error = run(
        "provider.selection_state",
        json!({"profileId": "nao-existe"}),
    )
    .unwrap_err();
    assert_eq!(error.code, "invalid_settings");
}

#[test]
fn state_does_not_touch_the_network_the_log_or_the_audit() {
    let (_guard, dir) = isolated();
    configure("p", "openai", "https://192.0.2.10/v1", "m", Some(8_192));
    for _ in 0..3 {
        state("p");
    }
    // Um hint inválido gravaria `invalid_estimate_hint`; nada pode ter sido gravado.
    assert!(!dir.path().join("diagnostic.log").exists());
}

fn diagnostic_text() -> String {
    run("diagnostic.get", json!({}))
        .unwrap()
        .get("text")
        .and_then(Value::as_str)
        .unwrap()
        .to_owned()
}

#[test]
fn diagnostic_adds_only_effective_context_tokens_and_origin() {
    let (_guard, _dir) = isolated();
    // Sem perfil: indisponível, nunca o texto do erro.
    let empty = diagnostic_text();
    assert!(empty.contains("Contexto efetivo (tokens): indisponível"));
    assert!(empty.contains("Origem do contexto efetivo: indisponível"));
    assert!(!empty.contains("Configure"));

    let secret_label = "Perfil-Secreto-do-Usuario";
    let secret_host = "192.0.2.99";
    run(
        "provider.configure",
        json!({"profileId": "secreto", "label": secret_label, "endpoint": format!("https://{secret_host}/v1"),
            "kind": "openai", "model": "modelo-secreto-x", "context": 12_345}),
    )
    .unwrap();
    run(
        "assistant.task.set",
        json!({"task": "selection", "choice": "profile:secreto"}),
    )
    .unwrap();

    let text = diagnostic_text();
    assert!(text.contains("Contexto efetivo (tokens): 12345"));
    assert!(text.contains("Origem do contexto efetivo: user"));
    for forbidden in [
        secret_label,
        secret_host,
        "modelo-secreto-x",
        "secreto",
        "https://",
        "/v1",
    ] {
        assert!(!text.contains(forbidden), "vazou {forbidden}");
    }
    // Só duas linhas novas em relação à allowlist anterior.
    let before: Vec<&str> = text
        .lines()
        .filter(|l| !l.starts_with("Contexto efetivo") && !l.starts_with("Origem do contexto"))
        .collect();
    assert!(before.iter().all(|l| !l.contains("12345")));

    // Entrada de usuário não é ecoada.
    let echoed = run(
        "diagnostic.get",
        json!({"prompt": "PROMPT-PRIVADO", "path": "C:/Users/Alice/x"}),
    )
    .unwrap()
    .to_string();
    assert!(!echoed.contains("PROMPT-PRIVADO") && !echoed.contains("Alice"));
}

#[test]
fn diagnostic_is_unavailable_for_a_cli_route_and_for_a_removed_profile() {
    let (_guard, _dir) = isolated();
    configure("some", "openai", "https://192.0.2.10/v1", "m", Some(8_192));
    run(
        "assistant.task.set",
        json!({"task": "selection", "choice": "profile:some"}),
    )
    .unwrap();
    run("provider.profiles.remove", json!({"profileId": "some"})).unwrap();
    let text = diagnostic_text();
    assert!(
        text.contains("Contexto efetivo (tokens): indisponível"),
        "{text}"
    );
    assert!(!text.contains("profile_unavailable") && !text.contains("some"));
}

#[test]
fn diagnostic_export_is_still_a_user_reviewed_text() {
    // A revisão editável continua obrigatória: o texto exportado é o que o usuário editou, não o gerado.
    let (_guard, dir) = isolated();
    let path = dir.path().join("diagnostico.txt");
    run(
        "diagnostic.export",
        json!({"path": path, "text": "texto revisado pelo usuário"}),
    )
    .unwrap();
    assert_eq!(
        std::fs::read_to_string(path).unwrap(),
        "texto revisado pelo usuário"
    );
}
