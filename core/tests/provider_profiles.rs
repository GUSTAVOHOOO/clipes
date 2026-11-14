//! Perfis de Provedor (#118): migração dos arquivos do formato antigo, sem rede e sem cofre.
use clipes_core::dispatch;
use serde_json::{json, Value};
use std::{env, fs};

fn run(name: &str, args: Value) -> Result<Value, clipes_core::CoreError> {
    dispatch(name, args, &mut |_| {})
}

fn profile<'a>(list: &'a Value, id: &str) -> &'a Value {
    list["profiles"]
        .as_array()
        .unwrap()
        .iter()
        .find(|p| p["id"] == id)
        .unwrap()
}

#[test]
fn files_in_the_old_format_keep_working_and_are_not_rewritten() {
    let root = env::temp_dir().join(format!("clipes-profiles-{}", std::process::id()));
    let _ = fs::remove_dir_all(&root);
    fs::create_dir_all(&root).unwrap();
    env::set_var("CLIPES_DATA_DIR", &root);
    // IP literals: no DNS and no network. 192.0.2.0/24 is reserved for documentation.
    let endpoint = "https://192.0.2.10/v1";
    let files = [
        (
            "provider.json",
            json!({"endpoint":endpoint,"model":"m","kind":"openai","nativeSchema":false,
                "providers":{endpoint:{"confirmed":true,"keyLastFour":"abcd"}}}),
        ),
        (
            "assistant.json",
            json!({"completed":true,"skipped":false,"default":"endpoint","tasks":{"translation":"codex"}}),
        ),
        (
            "provider-prices.json",
            json!({"prices":[{"provider":"openai","model":"m","inputPerMillion":2.0,"outputPerMillion":4.0}]}),
        ),
    ];
    for (name, content) in &files {
        fs::write(root.join(name), content.to_string()).unwrap();
    }
    let snapshot = || -> Vec<Vec<u8>> {
        files
            .iter()
            .map(|(name, _)| fs::read(root.join(name)).unwrap())
            .collect()
    };
    let before = snapshot();

    // The single endpoint becomes the `legacy` profile; the user price override applies to it.
    let list = run("provider.profiles.list", json!({})).unwrap();
    let legacy = profile(&list, "legacy");
    assert_eq!(legacy["endpoint"], endpoint);
    assert_eq!(legacy["keyLastFour"], "abcd");
    assert_eq!(legacy["confirmed"], true);
    assert_eq!(legacy["local"], false);
    assert_eq!(legacy["price"]["source"], "override");
    assert_eq!(legacy["price"]["inputPerMillion"], 2.0);
    // The CLIs are profiles too: never local, no money price, experimental.
    for kind in ["codex", "claude"] {
        let cli = profile(&list, kind);
        assert_eq!(cli["cli"], true);
        assert_eq!(cli["local"], false);
        assert_eq!(cli["price"], Value::Null);
        assert_eq!(cli["experimental"], true);
        assert_eq!(cli["active"], false);
    }

    // The old values of assistant.json still resolve: "endpoint" is the legacy profile.
    let assistant = run("assistant.status", json!({})).unwrap();
    assert_eq!(assistant["default"], "endpoint");
    assert_eq!(assistant["tasks"]["translation"], "codex");
    let estimate = run(
        "provider.cost.estimate",
        json!({"task":"selection","instruction":"x","transcript":"y","schema":{"type":"object"},"nativeSchema":false}),
    )
    .unwrap();
    assert_eq!(estimate["kind"], "usd");
    assert_eq!(estimate["priceSource"], "override");
    assert_eq!(run("provider.status", json!({})).unwrap()["model"], "m");
    assert_eq!(snapshot(), before, "reading must not rewrite the files");

    // Locality is computed from the endpoint, never stored.
    run(
        "provider.configure",
        json!({"profileId":"local-qwen","label":"Local","kind":"openai","endpoint":"http://127.0.0.1:11434/v1","model":"qwen","nativeSchema":true}),
    )
    .unwrap();
    let list = run("provider.profiles.list", json!({})).unwrap();
    assert_eq!(profile(&list, "local-qwen")["local"], true);
    assert_eq!(profile(&list, "local-qwen")["label"], "Local");
    assert_eq!(profile(&list, "legacy")["endpoint"], endpoint);
    let saved = fs::read_to_string(root.join("provider.json")).unwrap();
    assert!(!saved.contains("\"local\""));
    let saved: Value = serde_json::from_str(&saved).unwrap();
    assert_eq!(saved["schemaVersion"], 2);
    // The v1 fields keep mirroring the legacy profile for older readers.
    assert_eq!(saved["endpoint"], endpoint);
    assert_eq!(saved["providers"][endpoint]["keyLastFour"], "abcd");

    // `provider.configure` with profileId does not turn the CLI off; without it, it does.
    run("provider.cli.configure", json!({"kind":"codex"})).unwrap();
    run(
        "provider.configure",
        json!({"profileId":"local-qwen","kind":"openai","endpoint":"http://127.0.0.1:11434/v1","model":"qwen3"}),
    )
    .unwrap();
    assert_eq!(
        run("provider.cli.status", json!({})).unwrap()["selected"],
        "codex"
    );
    assert_eq!(
        profile(&run("provider.profiles.list", json!({})).unwrap(), "codex")["active"],
        true
    );
    run(
        "provider.configure",
        json!({"kind":"openai","endpoint":endpoint,"model":"m2"}),
    )
    .unwrap();
    assert_eq!(
        run("provider.cli.status", json!({})).unwrap()["selected"],
        ""
    );
    let list = run("provider.profiles.list", json!({})).unwrap();
    assert_eq!(profile(&list, "legacy")["model"], "m2");
    assert_eq!(profile(&list, "local-qwen")["model"], "qwen3");

    // Removing a profile leaves the legacy one and its consent alone.
    run(
        "provider.profiles.remove",
        json!({"profileId":"local-qwen"}),
    )
    .unwrap();
    let list = run("provider.profiles.list", json!({})).unwrap();
    assert!(list["profiles"]
        .as_array()
        .unwrap()
        .iter()
        .all(|p| p["id"] != "local-qwen"));
    assert_eq!(profile(&list, "legacy")["confirmed"], true);
    fs::remove_dir_all(root).unwrap();
}
