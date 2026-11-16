//! Núcleo da Tarefa de IA (ADR-0007, ADR-0008): definição declarativa registrada por módulo,
//! prompt versionado, schema fio e completo, verificadores tipados, orçamento declarado e
//! `run`, função pura com Provedor injetável.
//!
//! Este módulo não cria fila (#121), não registra custo por chamada nem aplica o orçamento
//! (#124) e não audita (#125). O orçamento aqui é só declarado.
use crate::{
    provider::{CancelToken, Provider, StructuredRequest},
    CoreError,
};
use serde::Serialize;
use serde_json::Value;
use sha2::{Digest, Sha256};

/// Violação tipada de um verificador. `code` e `message` são fixos (sem texto da Transcrição
/// nem da resposta do modelo); `path` é um JSON Pointer dentro da saída.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
pub struct Violation {
    pub code: &'static str,
    pub path: String,
    pub message: &'static str,
}

impl Violation {
    pub fn new(code: &'static str, path: impl Into<String>, message: &'static str) -> Self {
        Self {
            code,
            path: path.into(),
            message,
        }
    }
}

/// Entrada de uma execução. `transcript` é texto de terceiros e vai ao Provedor só como campo
/// de dados. `context` é montado pelo núcleo (por exemplo, os IDs de Frase da janela) e só os
/// verificadores o leem: nunca é enviado ao modelo.
#[derive(Debug, Clone, Default)]
pub struct TaskInput {
    pub transcript: String,
    pub estimate_hint: crate::provider::EstimateHint,
    pub context: Value,
    /// Usa o schema nativo do Provedor quando ele existe (ADR-0008, regra 4).
    pub native_schema: bool,
}

/// Verificador determinístico: recebe a entrada e a saída já validada pelo schema completo.
pub type Verifier = fn(&TaskInput, &Value) -> Vec<Violation>;

/// Orçamento declarado da tarefa. Quem aplica os limites é o #124.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct Budget {
    pub max_calls: u32,
    pub max_input_tokens: u64,
    pub max_output_tokens: u64,
    pub max_wall_clock_secs: u64,
    /// Teto de custo por tarefa em milésimos de centavo de dólar (1e-5 US$); `None` sem teto.
    pub max_cost_micro_cents: Option<u64>,
}

/// Definição estática de uma Tarefa de IA. Registre com `inventory::submit!`.
pub struct AiTask {
    pub id: &'static str,
    /// Sobe a cada mudança de prompt, schema ou verificador.
    pub version: u32,
    /// Texto do prompt, normalmente `include_str!`.
    pub prompt: &'static str,
    /// SHA-256 hexadecimal do prompt com quebras de linha normalizadas para `\n`.
    pub prompt_sha256: &'static str,
    /// JSON Schema enviado ao Provedor (subconjunto mínimo, ver `check_wire_schema`).
    pub wire_schema: &'static str,
    /// JSON Schema com que o núcleo valida sempre a saída.
    pub full_schema: &'static str,
    pub verifiers: &'static [Verifier],
    pub budget: Budget,
}

inventory::collect!(AiTask);

pub fn all() -> Vec<&'static AiTask> {
    inventory::iter::<AiTask>.into_iter().collect()
}

/// A Tarefa que decide o Provedor (Perfil, "somente local") de `id`. Quase sempre é o próprio
/// id; uma variante com prompt e schema próprios (a seleção do Vídeo transformado, #67) usa a
/// escolha da Tarefa que a originou, para o usuário não configurar a mesma coisa duas vezes.
pub fn routing_id(id: &str) -> &str {
    match id {
        "selection_transformed" => "selection",
        // A sugestão de capa (#74) usa a rota e o veto "somente local" do empacotamento.
        "thumbnail" => "packaging",
        other => other,
    }
}

pub fn find(id: &str) -> Option<&'static AiTask> {
    inventory::iter::<AiTask>.into_iter().find(|t| t.id == id)
}

/// Prompt com `\r\n` normalizado para `\n`, para o hash não depender do checkout no Windows.
pub fn normalized_prompt(prompt: &str) -> String {
    prompt.replace("\r\n", "\n")
}

pub fn prompt_hash(prompt: &str) -> String {
    format!("{:x}", Sha256::digest(normalized_prompt(prompt).as_bytes()))
}

/// Erro tipado de uma execução. Mensagens fixas, sem caminhos pessoais nem texto do modelo.
#[derive(Debug, Clone, PartialEq)]
pub struct TaskError {
    pub code: String,
    pub message: String,
    pub violations: Vec<Violation>,
    /// `usage` e `calls` já gastos, quando o Provedor os informou (a chamada foi cobrada).
    pub usage: Option<Value>,
}

impl TaskError {
    fn new(code: &str, message: &str) -> Self {
        Self {
            code: code.into(),
            message: message.into(),
            violations: Vec::new(),
            usage: None,
        }
    }
}

impl From<CoreError> for TaskError {
    fn from(e: CoreError) -> Self {
        Self {
            code: e.code,
            message: e.message,
            violations: Vec::new(),
            usage: e.usage,
        }
    }
}

impl From<TaskError> for CoreError {
    fn from(e: TaskError) -> Self {
        let usage = if e.violations.is_empty() {
            e.usage
        } else {
            Some(serde_json::json!({"violations": e.violations, "usage": e.usage}))
        };
        CoreError {
            code: e.code,
            message: e.message,
            usage,
        }
    }
}

#[derive(Debug, Clone, PartialEq)]
pub struct TaskOutput {
    pub data: Value,
    pub usage: Option<Value>,
    pub calls: u64,
}

const WIRE_KEYWORDS: &[&str] = &[
    "type",
    "properties",
    "required",
    "additionalProperties",
    "enum",
    "items",
    "description",
    "title",
];
const WIRE_TYPES: &[&str] = &["object", "string", "integer", "number", "boolean", "array"];

/// O schema fio leva só o que todos os Provedores aceitam (ADR-0008, regra 1): objetos com
/// todos os campos obrigatórios e `additionalProperties: false`, tipos, enums, arrays e
/// `schemaVersion` na raiz. Qualquer outra palavra-chave é recusada.
pub fn check_wire_schema(schema: &Value) -> Result<(), &'static str> {
    let has_version = schema
        .get("properties")
        .and_then(|p| p.get("schemaVersion"))
        .is_some();
    if schema.get("type").and_then(Value::as_str) != Some("object") || !has_version {
        return Err("Wire schema root must be an object with schemaVersion");
    }
    check_wire_node(schema)
}

fn check_wire_node(node: &Value) -> Result<(), &'static str> {
    let map = node
        .as_object()
        .ok_or("Wire schema node must be an object")?;
    if map.keys().any(|k| !WIRE_KEYWORDS.contains(&k.as_str())) {
        return Err("Wire schema uses a keyword outside the minimal subset");
    }
    let kind = match map.get("type").and_then(Value::as_str) {
        Some(kind) if WIRE_TYPES.contains(&kind) => kind,
        _ => return Err("Wire schema node needs a single supported type"),
    };
    if let Some(values) = map.get("enum") {
        if !values.as_array().is_some_and(|v| !v.is_empty()) {
            return Err("Wire schema enum must be a non-empty array");
        }
    }
    match kind {
        "object" => {
            let properties = map
                .get("properties")
                .and_then(Value::as_object)
                .ok_or("Wire schema object needs properties")?;
            if map.get("additionalProperties") != Some(&Value::Bool(false)) {
                return Err("Wire schema object must set additionalProperties to false");
            }
            let required: std::collections::BTreeSet<&str> = map
                .get("required")
                .and_then(Value::as_array)
                .ok_or("Wire schema object needs required")?
                .iter()
                .filter_map(Value::as_str)
                .collect();
            if required.len() != properties.len()
                || properties.keys().any(|k| !required.contains(k.as_str()))
            {
                return Err("Wire schema object must require every property");
            }
            properties.values().try_for_each(check_wire_node)
        }
        "array" => check_wire_node(map.get("items").ok_or("Wire schema array needs items")?),
        _ => Ok(()),
    }
}

fn parse(text: &str, message: &str) -> Result<Value, TaskError> {
    serde_json::from_str(text).map_err(|_| TaskError::new("invalid_task", message))
}

/// Confere a definição: hash do prompt, schema fio no subconjunto e schema completo válido.
pub fn check_definition(task: &AiTask) -> Result<(Value, Value), TaskError> {
    if task.id.is_empty() || task.version == 0 {
        return Err(TaskError::new(
            "invalid_task",
            "Task needs an id and a version",
        ));
    }
    if prompt_hash(task.prompt) != task.prompt_sha256 {
        return Err(TaskError::new(
            "invalid_task",
            "Task prompt does not match its declared hash",
        ));
    }
    let wire = parse(task.wire_schema, "Task wire schema is not valid JSON")?;
    let full = parse(task.full_schema, "Task full schema is not valid JSON")?;
    check_wire_schema(&wire).map_err(|m| TaskError::new("invalid_task", m))?;
    if jsonschema::validator_for(&full).is_err() {
        return Err(TaskError::new(
            "invalid_task",
            "Task full schema is invalid",
        ));
    }
    Ok((wire, full))
}

/// Executa uma Tarefa de IA: função pura sobre um Provedor injetado.
///
/// 1. A instrução é só o prompt da tarefa; a Transcrição segue em campo de dados separado.
/// 2. O Provedor valida o schema fio; o núcleo valida **sempre** o schema completo e depois os
///    verificadores. Qualquer violação vira erro tipado (`output_invalid` ou
///    `verification_failed`).
/// 3. A saída do modelo é só dado: nunca é executada, nem vira caminho, URL ou SQL.
///
/// `cancel` é repassado ao Provedor (`structured_with`); o executor da fila (#121) guarda um
/// clone e o levanta quando o job é cancelado.
pub fn run(
    task: &AiTask,
    input: &TaskInput,
    provider: &dyn Provider,
    cancel: &CancelToken,
) -> Result<TaskOutput, TaskError> {
    let (wire, full) = check_definition(task)?;
    if cancel.is_cancelled() {
        return Err(TaskError::new("cancelled", "Operation cancelled"));
    }
    let request = StructuredRequest {
        estimate_hint: input.estimate_hint.clone(),
        instruction: normalized_prompt(task.prompt),
        transcript: input.transcript.clone(),
        schema: wire,
        native_schema: input.native_schema,
        max_output_tokens: Some(task.budget.max_output_tokens),
    };
    let reply = provider.structured_with(&request, cancel)?;
    let usage = reply.get("usage").filter(|u| !u.is_null()).cloned();
    let calls = reply.get("calls").and_then(Value::as_u64).unwrap_or(1);
    let data = reply.get("data").cloned().ok_or_else(|| {
        TaskError::new("invalid_response", "Provider returned an invalid response")
    })?;
    let fail = |code: &str, message: &str, violations: Vec<Violation>| TaskError {
        code: code.into(),
        message: message.into(),
        violations,
        usage: Some(serde_json::json!({"usage": usage, "calls": calls})),
    };
    let validator = jsonschema::validator_for(&full)
        .map_err(|_| TaskError::new("invalid_task", "Task full schema is invalid"))?;
    let schema_violations: Vec<Violation> = validator
        .iter_errors(&data)
        .map(|e| {
            Violation::new(
                "schema",
                e.instance_path.to_string(),
                "Output violates the full schema",
            )
        })
        .collect();
    if !schema_violations.is_empty() {
        return Err(fail(
            "output_invalid",
            "Model output does not match the task schema",
            schema_violations,
        ));
    }
    let violations: Vec<Violation> = task
        .verifiers
        .iter()
        .flat_map(|verify| verify(input, &data))
        .collect();
    if !violations.is_empty() {
        return Err(fail(
            "verification_failed",
            "Model output failed verification",
            violations,
        ));
    }
    Ok(TaskOutput { data, usage, calls })
}

#[cfg(test)]
mod tests;
