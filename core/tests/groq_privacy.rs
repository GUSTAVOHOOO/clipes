//! O veto por Projeto precede qualquer leitura do cofre e qualquer rede.
use clipes_core::dispatch;
use serde_json::json;

#[test]
fn project_veto_prevents_testing_groq_key() {
    let root = tempfile::tempdir().unwrap();
    std::env::set_var("CLIPES_DATA_DIR", root.path().join("data"));
    dispatch(
        "projects.create",
        json!({"parent":root.path(),"name":"Groq privacy"}),
        &mut |_| {},
    )
    .unwrap();
    dispatch(
        "projects.local_only.set",
        json!({"enabled":true}),
        &mut |_| {},
    )
    .unwrap();
    let error = dispatch("transcription.groq.key.test", json!({}), &mut |_| {}).unwrap_err();
    assert_eq!(error.code, "local_only_violation");
    dispatch("projects.close", json!({}), &mut |_| {}).unwrap();
}
