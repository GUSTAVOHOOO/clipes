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
