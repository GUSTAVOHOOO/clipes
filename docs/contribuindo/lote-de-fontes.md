# Lote de Fontes

O lote (`core/src/source_batches.rs`, #56) processa várias Fontes do Projeto uma depois da outra: Transcrição (Motor da Fonte, #48/#51) e seleção de Cortes ([#53](selecao-de-cortes.md)). Termos no [glossário](../../GLOSSARY.md); decisões em [ADR-0005](../adr/0005-projeto-portatil-com-sqlite.md) (chamada paga incerta nunca se repete às cegas), [ADR-0009](../adr/0009-custo-orcamento-e-auditoria-de-chamadas-de-ia.md) (teto checado antes de cada chamada) e [ADR-0010](../adr/0010-perfis-multiplos-de-provedor-tarefa-para-perfil-e-somente-local.md) (sem troca automática de Provedor).

## Modelo

Migração `0056_001_source_batches`: `source_batches` (chave `sources-<id>`, estado `running|paused|completed|cancelled`, Motor, faixa de Corte) e `source_batch_items` (uma linha por Fonte, em ordem: `pending → transcribing → selecting → completed`, ou `paused` com um código fixo de erro, ou `cancelled`; guarda o job de Transcrição e a execução de seleção). A mesma migração acrescenta `transcription_calls.created_at` (coluna e gatilho) para o teto contar o áudio pago por janela de uso.

O avanço é `source_batches::tick`, chamado pelo thread da fila a cada volta. **O estado de cada item é recalculado dos jobs, das Transcrições e das execuções (`derive`), nunca só do que o item guarda**; antes de iniciar algo, `tick` procura o que já existe (execução do lote para aquela Transcrição, job de Transcrição ativo). Por isso fechar o app, cair no meio de uma chamada ou retomar não duplica Fonte nem Janela: o job concluído é o checkpoint. Só uma Fonte fica ativa por vez. Uma Transcrição completa não passa por `transcription.start` (a Fonte pode até estar offline).

## Comandos

`batches.create {sourceIds, engine?, minUs?, maxUs?, maxCostMicroUsd?, confirmed?}`, `batches.get {id}`, `batches.list`, `batches.pause {id}`, `batches.resume {id}`, `batches.cancel {id}` e `batches.item.resume {id, sourceId, confirmed?}`. A pausa do usuário é uma linha `user` em `ai_pauses` (escopo `batch`): nenhum job do lote sai da fila, de qualquer tipo; o que já roda termina. `jobs.list` mostra `budgetPause: "user"`.

## Erros e pausas

- Falha só daquela Janela (`verification_failed`, `output_invalid`, `invalid_json`, `context_truncated`, `output_truncated`, `cancelled`, `budget_*`): as outras Janelas e Fontes seguem; a Fonte termina `paused` com o código.
- Qualquer outro erro final de uma Janela (Provedor, chamada incerta): cancela **só as Janelas ainda na fila daquela Fonte** (não gastar chamadas que falhariam igual), pausa a Fonte com o código fixo e as outras Fontes seguem. Erro transitório (`rate_limit` com `Retry-After`, rede) segue a política do executor (#121) e só chega aqui se esgotou.
- Falha de Transcrição: `jobs.finish` grava `jobs.result {outcome, code}` (código fixo, sem texto); a Fonte pausa com ele. Recusas de `transcription.start`/`selection.start` (`groq_key_missing`, `confirmation_required` de consentimento, `local_only_violation`, `source_changed`…) também pausam a Fonte.
- **Troca manual:** o usuário muda o perfil e usa `batches.item.resume`: com execução, chama `selection.resume` (pago pede `confirmed` com `usage.estimate`); sem execução, recomeça a Transcrição.
- **Chamada paga incerta nunca se repete às cegas.** `tick` nunca confirma nada: passa `confirmed: true` só ao `selection.start` da Fonte (autorizado na criação do lote) e jamais `retry_confirmed`. Um job `uncertain` pausa a Fonte; `batches.item.resume` responde `uncertain_job` (resolva em `jobs.retry`, com confirmação e custo). Quando o job volta à fila, a Fonte volta a `transcribing` sozinha.

## Confirmação e teto

`batches.create` recusa antes de criar qualquer coisa se o veto "somente local" ou a rota barram o lote. Com seleção paga ou Motor Groq exige `confirmed: true` (`confirmation_required` com `usage`: perfil, nº de Fontes, teto). A confirmação vale para o lote inteiro, dentro do teto e da checagem por chamada do #124; **não substitui** os consentimentos por endpoint (texto ao Provedor, áudio ao Groq): sem eles a Fonte pausa pedindo-os.

O teto é o do #124, escopo `batch`, chave `sources-<id>`: `selection.start` aceita `batch` e grava a chave na execução (refazer e retomar a leem de `selection_runs.batch`). Perfil sem preço pausa o lote com `cost_unknown` até `jobs.budget.continue {confirmed:true}`. **O áudio pago do Groq entra na mesma soma**: `cost::totals_since('batch')` acrescenta `audioMicroUsd`, a soma de `transcription_calls.estimated_usd` (dólares, REAL) dos jobs do lote, convertida num lugar só (`batch_audio_micro_usd`, arredondando **para cima** por chamada em µUS$); chamadas `pending` e `uncertain` contam como gasto, `failed` não. `resetUsage` zera também a janela do áudio. Antes de cada Fonte no Groq, o lote confere estimativa do áudio restante mais o gasto contra o teto e pausa com `budget_cost` sem iniciar.

## Testes

Headless, sem rede, `CLIPES_DATA_DIR` isolado: `core/tests/source_batches.rs` (erro no meio do lote, troca manual e retomada sem repetir, pausa e retomada, teto com Provedor pago, áudio arredondado e `resetUsage`, veto local, cancelamento) e `core/tests/source_batches_crash.rs` (processo morto durante chamada paga: a Janela fica incerta, nada é reenviado, repetir pede confirmação com o custo, a outra Fonte termina e o lote retoma). A UI está em `src/features/projects/SourceBatches.tsx` (mock em `src/lib/batchMock.ts`), coberta por `bun run test:ui`.
