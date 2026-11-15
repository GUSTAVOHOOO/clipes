//! Auditoria de uma chamada por CLI de assinatura (#125): o host é o id do CLI (`cli:codex`), a
//! entrada é o prompt enviado ao stdin e a resposta é o stdout; sem token nem texto no banco.
use clipes_core::{
    dispatch,
    provider::cost::{self, Target},
};
use serde_json::{json, Value};
use std::{env, fs, path::PathBuf};

fn call(name: &str, args: Value) -> Value {
    dispatch(name, args, &mut |_| {}).unwrap()
}

#[test]
fn a_cli_call_is_audited_with_its_cli_id_and_no_text() {
    let root = env::temp_dir().join(format!("clipes-cli-audit-{}", std::process::id()));
    fs::create_dir_all(&root).unwrap();
    env::set_var("CLIPES_DATA_DIR", root.join("data"));
    let rustc = PathBuf::from(env!("CARGO")).with_file_name(if cfg!(windows) {
        "rustc.exe"
    } else {
        "rustc"
    });
    let bin = root.join("bin");
    fs::create_dir_all(&bin).unwrap();
    let executable = bin.join(if cfg!(windows) { "codex.exe" } else { "codex" });
    assert!(std::process::Command::new(&rustc)
        .arg(PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("tests/fixtures/fake_provider_cli.rs"))
        .arg("-o")
        .arg(executable)
        .status()
        .unwrap()
        .success());
    env::set_var(
        "PATH",
        env::join_paths(
            std::iter::once(bin).chain(env::split_paths(&env::var_os("PATH").unwrap())),
        )
        .unwrap(),
    );
    env::set_var("FAKE_LOG", root.join("log"));
    call("projects.create", json!({"parent": root, "name": "Canal"}));
    call("provider.cli.configure", json!({"kind": "codex"}));
    call("provider.cli.confirm", json!({"kind": "codex"}));
    let sentinel = format!("SENTINELA-CLI-{}", std::process::id());
    let request = json!({"instruction":"Return data", "transcript":sentinel, "schema":{"type":"object","properties":{"schemaVersion":{"const":1}},"required":["schemaVersion"],"additionalProperties":false},"nativeSchema":true});
    cost::run_costed_for(
        None,
        &Target::Cli {
            name: "codex".into(),
        },
        "example",
        Some("cli"),
        || dispatch("provider.structured", request.clone(), &mut |_| {}),
    )
    .unwrap();

    let costs = call("provider.cost.list", json!({"batch": "cli"}));
    assert_eq!(costs.as_array().unwrap().len(), 1);
    let audit = call("provider.audit.list", json!({}));
    let audit = audit.as_array().unwrap();
    assert_eq!(audit.len(), 1);
    let row = &audit[0];
    assert_eq!(row["providerKind"], "cli");
    assert_eq!(row["host"], "cli:codex");
    assert_eq!(row["costId"], costs[0]["id"]);
    assert!(row["sentBytes"].as_i64().unwrap() > sentinel.len() as i64);
    for key in ["inputSha256", "responseSha256"] {
        let hash = row[key].as_str().unwrap();
        assert!(hash.len() == 64 && hash.bytes().all(|b| b.is_ascii_hexdigit()));
    }
    assert!(!row.to_string().contains(&sentinel));

    dispatch("projects.close", json!({}), &mut |_| {}).unwrap();
    let _ = fs::remove_dir_all(root);
}
