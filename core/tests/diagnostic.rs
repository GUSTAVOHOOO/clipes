use clipes_core::dispatch;
use serde_json::json;

#[test]
fn diagnostic_never_echoes_unlisted_input() {
    let result = dispatch("diagnostic.get", json!({"secret":"PRIVATE-KEY", "path":"C:/Users/Alice/private.mp4", "transcript":"PRIVATE-TEXT"}), &mut |_| {}).unwrap();
    let text = result.to_string();
    assert!(!text.contains("PRIVATE"));
    assert!(!text.contains("Alice"));
    assert!(text.contains("indisponível"));
    assert!(text.contains(env!("CARGO_PKG_VERSION")));
}

#[test]
fn export_rejects_invalid_destinations() {
    let dir = std::env::temp_dir();
    for path in [
        dir.join("diagnostic.json"),
        dir.join("relative").join(".."),
        std::path::PathBuf::from("relative.txt"),
    ] {
        let err = dispatch(
            "diagnostic.export",
            json!({"path":path,"text":"diagnostic"}),
            &mut |_| {},
        )
        .unwrap_err();
        assert_eq!(err.code, "invalid_path");
        assert_eq!(err.message, "Caminho inválido");
    }
}
