# Como escrever uma Tarefa de IA e um verificador

Uma **Tarefa de IA** é um workflow fixo no núcleo Rust, sem agente e sem tool calling ([ADR-0007](../adr/0007-tarefas-de-ia-como-workflows-fixos-no-nucleo.md)). O contrato de saída é o do [ADR-0008](../adr/0008-contrato-de-saida-estruturada-agnostico-de-provedor.md). O código está em `core/src/ai_task.rs`. Consulte o [glossário](../../GLOSSARY.md) e o guia de [Provedor](provedor.md).

Este módulo só define a tarefa e a executa (`run`). A fila de jobs (#121), o custo por chamada e a aplicação do orçamento (#124) e a auditoria (#125) vêm em outros tickets.

## Tarefa nova, passo a passo

1. Crie o módulo da feature e o prompt em arquivo próprio (por exemplo `core/src/selection/prompt.md`). O prompt é a instrução: nunca coloque nele texto da Transcrição.
2. Escreva o **schema fio** e o **schema completo** (JSON em `&'static str`, por exemplo com `include_str!`).
3. Declare a tarefa com `inventory::submit!`, sem tocar em lista central:

```rust
inventory::submit! {
    AiTask {
        id: "selection",
        version: 1,
        prompt: include_str!("prompt.md"),
        prompt_sha256: "<sha256 do prompt>",
        wire_schema: include_str!("wire.json"),
        full_schema: include_str!("full.json"),
        verifiers: &[ids_exist_in_window],
        budget: Budget { max_calls: 3, max_input_tokens: 30_000, max_output_tokens: 2_000,
                         max_wall_clock_secs: 300, max_cost_micro_cents: None },
    }
}
```

4. Calcule o hash: `tr -d '\r' < prompt.md | sha256sum` (o hash é do texto com `\n`, então não muda no checkout do Windows).
5. Acrescente `{id, version, sha256}` em `core/src/ai_task/prompt-lock.json`.
6. Chame `ai_task::run(task, &input, &provider, &cancel)`. Os testes injetam um Provedor falso (`Provider::structured_with`); nunca usam a rede.

## Versão e hash do prompt

`prompt-lock.json` é uma trava só de acréscimo. Um teste falha se o texto de uma versão já travada mudar. Para mudar o prompt, o schema ou um verificador: **suba `version`**, atualize `prompt_sha256` e acrescente uma entrada nova na trava. Não edite entradas antigas.

## Schema fio e schema completo

- **Fio** (`wire_schema`): o que vai ao Provedor. Só objetos com todos os campos em `required` e `additionalProperties: false`, tipos simples (`object`, `array`, `string`, `integer`, `number`, `boolean`), `enum`, `items`, `description`/`title` e `schemaVersion` na raiz. Nada de `minLength`, `pattern`, `minItems`, `oneOf`, `$ref` ou tipo em lista: `check_wire_schema` recusa, e o teste de registro falha.
- **Completo** (`full_schema`): o que o núcleo valida **sempre** (limites, `const`, `maximum`, `maxItems`). Não dependa do Provedor para aplicá-los.
- Campos de justificativa ficam livres no fio (ADR-0008, regra 5).
- Teste sempre uma saída que passa no fio e viola o completo.

## Entrada e segurança

`TaskInput.transcript` é texto de terceiros e vai ao Provedor só como campo de dados. `TaskInput.context` é montado pelo núcleo (por exemplo, os IDs de Frase da janela) e só os verificadores o leem; o modelo não o vê. A saída do modelo é só dado: nunca vira comando, caminho, URL, argumento de processo ou SQL. Os tempos nunca passam pelo modelo: a saída leva IDs de Frase e o núcleo calcula os µs.

## Como escrever um verificador

Um verificador é uma função determinística `fn(&TaskInput, &Value) -> Vec<Violation>`. Ele recebe a saída já validada pelo schema completo e devolve **todas** as violações, sem parar na primeira:

```rust
fn ids_exist_in_window(input: &TaskInput, output: &Value) -> Vec<Violation> {
    // compare output["picks"][i]["id"] com input.context["ids"]
    vec![Violation::new("unknown_sentence_id", "/picks/1/id", "Sentence id is not in the window")]
}
```

- `code` e `message` são `&'static str` fixos (inglês, como os erros do núcleo): nada de texto da Transcrição, da resposta ou de caminhos pessoais ([ADR-0006](../adr/0006-relato-de-problemas-sem-telemetria.md)). `path` é um JSON Pointer na saída.
- Sem I/O, sem relógio, sem aleatoriedade, sem chamada de IA.
- Ideias por tarefa estão na seção 7.1 da [pesquisa do harness](../research/2026-11-14-harness-agentes-clipes.md).
- Cubra com um teste que faz o verificador devolver a violação esperada.

## Erros de `run`

`TaskError { code, message, violations, usage }`: erros do Provedor mantêm o `code` (`refusal`, `output_truncated`, `timeout_uncertain`, `cancelled`, ...) e o `usage`; `output_invalid` (schema completo) e `verification_failed` (verificadores) levam as `violations` e o `usage` já gasto; `invalid_task` indica uma definição quebrada (hash, schema fio ou completo). `run` não tenta reparo próprio além do que o adaptador já faz, e não troca de Provedor.

## Cancelamento

`run` recebe um `CancelToken` e o repassa ao Provedor. O executor da fila (#121) guarda um clone e o levanta quando o job é cancelado.

## Orçamento

`Budget` só declara os limites. Hoje `run` usa apenas `max_output_tokens` como teto de saída da requisição; quem aplica chamadas, tokens de entrada, tempo e custo é o #124.
