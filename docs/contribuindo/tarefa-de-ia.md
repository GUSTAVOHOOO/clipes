# Como escrever uma Tarefa de IA e um verificador

Uma **Tarefa de IA** é um workflow fixo no núcleo Rust, sem agente e sem tool calling ([ADR-0007](../adr/0007-tarefas-de-ia-como-workflows-fixos-no-nucleo.md)). O contrato de saída é o do [ADR-0008](../adr/0008-contrato-de-saida-estruturada-agnostico-de-provedor.md). O código está em `core/src/ai_task.rs`. Consulte o [glossário](../../GLOSSARY.md) e o guia de [Provedor](provedor.md).

Este módulo só define a tarefa e a executa (`run`). A fila de jobs está em `core/src/jobs/ai.rs` (veja "Jobs de IA na fila" abaixo); o custo por chamada e a aplicação do orçamento ficam no executor e em `core/src/jobs/budget.rs` (#124). A auditoria é o #125.

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

`TaskError { code, message, violations, usage }`: erros do Provedor mantêm o `code` (`refusal`, `output_truncated`, `context_truncated`, `timeout_uncertain`, `cancelled`, ...) e o `usage`; `output_invalid` (schema completo) e `verification_failed` (verificadores) levam as `violations` e o `usage` já gasto; `invalid_task` indica uma definição quebrada (hash, schema fio ou completo). `run` não tenta reparo próprio além do que o adaptador já faz, e não troca de Provedor.

## Cancelamento

`run` recebe um `CancelToken` e o repassa ao Provedor. O executor da fila guarda um clone e o levanta quando o job é cancelado (veja abaixo).

## Orçamento

`Budget` declara os limites por job. `run` usa `max_output_tokens` como teto de saída; o executor aplica chamadas (incluindo reparo e retentativa HTTP), tokens de entrada estimados pelo #40, tempo e custo. Um limite por job falha com `budget_*`. `max_cost_micro_cents` usa 1e-5 US$; os comandos de custo e orçamento usam µUS$ (1e-6 US$).

`jobs::enqueue_ai_in_batch(tarefa, &input, safety, Some(lote))` associa a unidade a um lote. O orçamento acumulado no Projeto é configurado pelo mesmo despacho headless e da UI:

```json
{"scope":"batch","key":"lote-1","maxCalls":100,"maxTokens":100000,"maxWallMs":600000,"maxCostMicroUsd":1000000}
```

Passe esse objeto a `jobs.budget.set`. `scope` aceita `task` (a chave é o id da Tarefa) ou `batch` (o rótulo do lote). Campos omitidos mantêm o limite anterior; `null` remove um limite. `jobs.budget.get {}` devolve limites, consumo e motivo da pausa. `jobs.budget.continue` aceita os mesmos campos, atualiza os tetos e libera só aquele escopo. `resetUsage: true` inicia uma nova janela de consumo; as linhas históricas de custo permanecem.

Antes de **cada envio**, inclusive reparos e retentativas HTTP, o executor soma o gasto real à estimativa da próxima chamada. Igualdade com o teto é permitida. Se não couber, pausa só o escopo afetado (`budget_calls`, `budget_tokens`, `budget_time`, `budget_cost`): antes do primeiro envio, o job fica `queued`, sem consumir tentativa; depois de uma resposta, o job falha e preserva as linhas das chamadas já cobradas. Os outros lotes continuam. O watchdog cancela a chamada ao atingir o tempo restante; chamada paga em voo fica `uncertain`, com custo desconhecido.

CLI conta só por chamadas e mostra `consome a cota do plano`, com tokens e custo em moeda nulos. Perfil sem preço mostra `custo desconhecido` e fica fora do teto monetário; qualquer lote que o use pausa com `cost_unknown`, mesmo sem teto monetário. Continuar exige `confirmed: true`. Uma Tarefa sem lote não pede essa confirmação.

O preço continua vindo de `provider.prices.*`, pelo par tipo/modelo do perfil, sem outra tabela nem outro estimador. `price_micro_usd(price, input_tokens, output_tokens)` é o ponto de extensão para faixas de contexto; por enquanto usa só o preço base, conforme o escopo do #124.

`jobs.list.budgetPause` identifica o motivo de pausa dos jobs `queued`; nos outros estados é nulo. A lista existente traduz os motivos em rótulos fixos PT/EN e exibe o `costLabel` dos acumulados. Os controles visuais de teto, continuação e confirmação do lote são do #56; o #124 entrega o mecanismo do núcleo e essa apresentação mínima, conforme decisão do coordenador.

## Jobs de IA na fila

`jobs::enqueue_ai(tarefa, &TaskInput, Safety)` cria um job `ai:<tarefa>`: uma unidade idempotente (uma janela, um Corte), sem Tarefa composta num job só. `Safety::Local` é para modelo de loopback; qualquer outro Provedor (API remota ou CLI) é `Paid`. O payload (`payload`) e o resultado (`result`) ficam na linha do job (migração `0121_001_ai_jobs`); `jobs.list` não os devolve. Expõe `outcome`, `cost`, `batch`, `profile` e os acumulados `taskCost`, `profileCost`, `batchCost`, com chamadas, tokens, µUS$, duração e contagem de custos desconhecidos e de cota de CLI. `costLabel` indica quando o total em moeda deixa custos de fora. `jobs.result {id}` devolve o resultado e `jobs.estimate {id}` o custo estimado de repetir.

Estado final de um job de IA:

| Situação | Estado | `cost` em `result` |
|---|---|---|
| resposta validada (schema completo e verificadores) | `completed` | `usage` (pago) ou `zero` (local) |
| `timeout_uncertain` | `uncertain` | `unknown` (pago) ou `zero` (local) |
| cancelado depois de enviar uma chamada paga | `uncertain` | `unknown`, nunca `cancelled` com custo zero |
| cancelado antes de enviar, ou modelo local | `cancelled` | `zero` |
| qualquer outro erro, inclusive `invalid_json` com resposta | `failed` | `usage` (o `usage` do erro fica em `result.usage`) |
| processo morto no meio da chamada paga | `uncertain` | `unknown` |

- O resultado validado e o estado `completed` são gravados na mesma instrução; um job `completed` nunca se repete.
- `jobs.retry` de um job `uncertain` **pago** exige `confirmed: true`; sem ele devolve `confirmation_required` com `usage.estimate` (o mesmo de `jobs.estimate`). Job `local` repete sem confirmação (custo zero, ADR-0009 regra 5).
- Um job `local` só envia a endpoint de loopback; se a configuração mudou, falha com `not_local` antes de enviar.
- `jobs.cancel` levanta o `CancelToken` da chamada em voo (a fila consulta `cancel_requested` a cada 25 ms).
- Eventos: `ProgressEvent` com `stage` `ai:<tarefa>:prepare`, `call`, `verify` e `done`, mensagens fixas, sem Transcrição nem resposta do modelo.
- O escopo da thread coleta metadados por envio, sem mudar a resposta pública do Provedor. Cada envio e reparo gera uma linha na tabela existente `provider_costs`, com job, versão da tarefa, perfil, modelo, tentativa, tokens, resultado (oito valores) e código de erro separado, estimativa e custo real. A migração `0124_001_ai_call_costs_and_budgets` mantém as linhas antigas legíveis. `provider.cost.list {job}` consulta as linhas de um job; o caminho síncrono `provider.cost.run` também separa as chamadas. Timeout e cancelamento pagos ficam desconhecidos, nunca zero. Nenhum texto de entrada, prompt ou resposta entra nessas linhas.
- Testes: `jobs::set_ai_provider(Some(fake))` injeta um Provedor falso no worker da fila; `jobs::set_ai_route` fixa o alvo de preço e perfil no harness. Veja `core/tests/ai_jobs.rs`, `ai_jobs_crash.rs`, `ai_budget.rs` e `ai_call_rows.rs`; todos isolam os dados com `CLIPES_DATA_DIR` e não acessam serviços externos.
