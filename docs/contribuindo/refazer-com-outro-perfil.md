# Refazer com outro perfil ("refazer com o forte")

Botão manual na revisão do Corte candidato (#55) que refaz, com **outro** Perfil de Provedor escolhido pelo usuário, o que gerou o candidato (#126; [ADR-0010](../adr/0010-perfis-multiplos-de-provedor-tarefa-para-perfil-e-somente-local.md), regra 4). Não existe troca automática de perfil em nenhum caso, e o padrão do app e o da Tarefa nunca mudam: o perfil vale só para esta execução.

## Comando genérico (para o Roteiro, #73)

O comando vale para qualquer unidade de Tarefa de IA, não só para a seleção. O "regenerar bloco" do Roteiro (#73) deve usá-lo em vez de criar outro caminho.

- `jobs.redo.estimate {id, profileId}`: o que o usuário confirma. Devolve `{profile: {id, label, kind, model}, paid, leavesMachine, estimate}`. Nunca leva endpoint nem chave.
- `jobs.redo {id, profileId, confirmed?}`: enfileira a unidade de novo (mesmo lote, mesma entrada do job original) com o perfil escolhido e devolve `{job, profile}`. Perfil pago sem `confirmed: true` devolve `confirmation_required`, com `usage: {estimate, profile, leavesMachine}`.
- Em código: `jobs::redo::{source, route, estimate_inputs, preview, confirmation_required}` e `jobs::enqueue_ai_with_profile`. O perfil explícito fica no payload do job (`profileId`) e o executor o resolve no lugar da rota da Tarefa (`jobs::ai::route_of_profile`).

Recusas, todas **antes** de qualquer rede e com mensagem fixa:

| Código | Quando |
| --- | --- |
| `local_only_violation` | perfil remoto (ou CLI) com "somente local" ligado, por tarefa ou por Projeto |
| `job_uncertain` | o job está `uncertain` (ADR-0005): antes o usuário resolve a incerteza |
| `job_not_redoable` | o job está na fila ou rodando |
| `confirmation_required` | perfil pago sem `confirmed: true` |
| `invalid_settings` | o perfil não existe |

O teto do lote não recusa: o job entra na fila e o executor **pausa** a fila antes de enviar (`budget_*`), como em qualquer outro job do lote.

## Seleção: `selection.redo` com `profileId`

`selection.redo {run, windows, profileId, confirmed?}` refaz as Janelas pedidas, mesmo concluídas, com o perfil. O caminho é o mesmo do refazer de Janelas que falharam (`enqueue_windows`), estendido; o pipeline não foi duplicado. Sem `profileId` nada muda. A entrada de cada Janela é a do próprio job dela, então o outro perfil responde à mesma pergunta.

- `selection.estimate {run, windows, profileId}` devolve o mesmo resumo de `jobs.redo.estimate` mais `windows`.
- Erros próprios: `windows_required`, `window_not_found`, `window_not_redoable` (Janela sem job, na fila ou rodando) e `window_uncertain` (job `uncertain`). Os vetos e `confirmation_required` são os de cima.

### Revisões da execução e o perfil registrado

Migração `0126_001_selection_redo_profile`:

- `selection_runs.revision`: a revisão atual (começa em 1).
- `selection_windows.profile`: o perfil que gerou o resultado vigente da Janela. `prev_job_id`/`prev_profile` guardam o resultado anterior quando uma Janela concluída é refeita; `redo` marca o job que ainda não virou revisão.
- `selection_candidates.revision` e `.profile`: o perfil da Janela de origem do candidato (a de menor índice, se foi juntado).

Quando todas as Janelas refeitas se resolvem, a execução fecha com os candidatos novos numa **nova revisão** (`revision + 1`). As revisões anteriores ficam gravadas e as decisões do #55 (`selection_decisions`, por execução e Frases) **não são apagadas**: uma decisão sobre o mesmo trecho continua valendo na revisão nova. `selection.get {run}` devolve a revisão atual; `selection.get {run, revision}` lê uma anterior; `run.revisions` lista as que existem. O perfil que gerou cada resultado também fica em `provider_costs.profile`.

Se o refazer falha ou é cancelado, **não há troca automática nem perda**: o resultado anterior da Janela continua valendo, o erro aparece em `windows[i].redoFailed` e em `summary.redoFailed`, e a revisão não avança.

## UI

`RedoWithProfile.tsx`, dentro do detalhe do candidato: seletor de perfil (o que gerou o candidato não entra), botão **Refazer com este perfil** e um `ConfirmDialog` que mostra o perfil, o custo estimado e se o texto sai da máquina. Fica indisponível, com a explicação, quando uma Janela de origem tem job `uncertain` ou ainda está na fila. O candidato mostra "Gerado por {perfil} · revisão {n}".

## Testes

- `core/tests/selection_redo_profile.rs` (headless, Provedor falso injetado, dois perfis, sem rede): prévia e confirmação, vetos por tarefa e por Projeto, nova revisão com perfil registrado e decisão preservada, falha sem troca automática, comando genérico, Janela `uncertain` e teto do lote.
- `scripts/ui.mjs` (`redoChecks`, núcleo simulado, PT e EN): seletor, aviso de saída da máquina, confirmação, veto e Janela incerta.
