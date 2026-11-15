use clipes_core::{ai_task::{self, TaskInput}, provider::{CancelToken, Provider, StructuredRequest}, CoreError};
use serde_json::{json, Value};

struct Fake(Value);
impl Provider for Fake {
    fn structured(&self, _: &StructuredRequest) -> Result<Value, CoreError> { Ok(json!({"data": self.0, "calls": 1})) }
}
fn run(data: Value) -> Result<ai_task::TaskOutput, ai_task::TaskError> {
    let task = ai_task::find("packaging").expect("packaging task registered");
    ai_task::run(task, &TaskInput { context: json!({"language":"pt-BR"}), ..Default::default() }, &Fake(data), &CancelToken::new())
}
fn valid() -> Value { json!({"schemaVersion":1,"language":"pt-BR","title":"Um título","description":"Uma descrição","tags":["corte"],"hashtags":["#corte"]}) }
#[test]
fn packaging_checks_limits_hashtags_and_language() {
    assert!(run(valid()).is_ok());
    let mut long = valid(); long["title"] = json!("a".repeat(101));
    assert!(run(long).unwrap_err().violations.iter().any(|v| v.code == "title_too_long"));
    let mut hashtag = valid(); hashtag["hashtags"] = json!(["#duas palavras"]);
    assert!(run(hashtag).unwrap_err().violations.iter().any(|v| v.code == "invalid_hashtag"));
    let mut language = valid(); language["language"] = json!("en");
    assert!(run(language).unwrap_err().violations.iter().any(|v| v.code == "language_mismatch"));
}
