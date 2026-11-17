# Seleção e revisão de Cortes, ângulos, Perfil de canal e assistente

## A jornada

Antes de produzir qualquer vídeo, o usuário configura **como** o app vai usar inteligência artificial (no assistente de primeira execução ou nas Preferências) e **quais** são as regras do canal aberto (no Perfil de canal do Projeto). O assistente detecta servidores locais e CLIs já presentes na máquina, ajuda a definir o Perfil de Provedor padrão e por Tarefa de IA, e permite ativar a restrição **Somente local** por tarefa. Já o Perfil de canal salva no Projeto portátil o tipo de vídeo padrão (**Corte direto** ou **Vídeo transformado**), o idioma, a faixa de duração dos Cortes, a voz da Narração, o estilo padrão de legenda e a lista de Fontes permitidas.

Depois que uma Fonte tem sua Transcrição concluída e segmentada em Frases, o usuário chega à etapa de seleção de Cortes. O núcleo divide a Transcrição em Janelas de seleção dimensionadas para a Janela de contexto do Provedor, pede que ele aponte IDs de Frase com Nota explicável por eixos (nunca timestamps), ajusta as bordas por Frase inteira, remove duplicatas e ordena os candidatos. Em seguida, na revisão humana, o usuário aprova, rejeita ou ajusta as bordas em Frases (com desfazer persistido no Projeto), e pode refazer Janelas específicas com outro Perfil de Provedor sem perder decisões anteriores.

Para candidatos aprovados no modo **Vídeo transformado**, antes de gerar o Roteiro da Narração o usuário passa pela etapa de ângulos: o Provedor sugere 2 ou 3 ângulos distintos (ou o usuário escreve o próprio), definindo a promessa e o público do vídeo. Por fim, antes de exportar individualmente ou em lote, os guarda-corpos (guardrails) avaliam o Corte ou o lote para exibir um checklist informativo de originalidade, Permissão, Roteiro, Narração, trilha sonora e o aviso único por canal sobre o risco de monetização do Corte direto — sempre informando, sem nunca bloquear a exportação.

---

## Como funciona por baixo

### Provedor, workflows fixos e saída estruturada (ADR-0007 e ADR-0008)

- **Workflows fixos sem agente (ADR-0007):** toda Tarefa de IA (`selection`, `selection_transformed`, `angles`, além de `script`, `packaging` e `translation`) é um workflow determinístico escrito em Rust (`core/src/ai_task.rs`). O núcleo declara entrada, prompt versionado (com hash SHA-256 conferido), schema de saída, verificadores determinísticos e orçamento (`Budget`). Não há *tool calling* nem agente autônomo.
- **Saída estruturada em duas camadas (ADR-0008):** o núcleo envia ao Provedor um **schema fio** (`wire_schema`) restrito ao subconjunto mínimo aceito por todos os adaptadores (`type`, `properties`, `required`, `additionalProperties: false`, `enum`, `items`, `description`, `title`, com `schemaVersion` na raiz). Ao receber a resposta, o núcleo valida sempre contra o **schema completo** (`full_schema`, via `jsonschema`) e depois roda os verificadores determinísticos de cada tarefa. A Transcrição entra sempre como dado não confiável (`transcript`), separada das instruções.
- **Execução na fila persistida (`core/src/jobs.rs` e `core/src/jobs/ai.rs`):** um **job** (unidade de trabalho assíncrona executada em segundo plano pela fila SQLite do Projeto) roda uma única chamada/unidade idempotente (uma Janela de seleção ou uma geração de ângulos). Chamadas pagas (API remota ou CLI) exigem `confirmed: true` após estimativa de custo; em falha ou cancelamento após envio pago, a fila nunca repete às cegas (`uncertain`).

### Janelas de seleção e pipeline de seleção (`core/src/selection_windows.rs`, `core/src/selection.rs`, `core/src/selection/cut.rs`)

1. **Planejamento puro (`selection_windows::plan`):** dimensiona janelas sobre somas prefixadas de Frases sem I/O nem rede:
   - Teto por janela: **15 min** (`WINDOW_MAX_US`).
   - Sobreposição entre janelas vizinhas: igual à duração máxima do Corte (`max_cut_us`, padrão **3 min** em `DEFAULT_OVERLAP_US`, limitada ao máximo técnico de **5 min** em `selection_windows::MAX_CUT_US`). A próxima janela começa na primeira Frase após `fim - sobreposição`, para que todo Corte que cruza a fronteira caiba inteiro na janela seguinte.
   - Janela mínima planejada: **3× a sobreposição** (**9 min** no padrão), ou **2× a sobreposição** quando o limitante for `tokens_per_request` ou `tokens_per_minute`. Fontes mais curtas que o mínimo formam uma janela única.
   - Orçamento de tokens por janela: `85%` (`CONTEXT_USABLE_PERCENT`) do contexto efetivo do Perfil de Provedor (ou do limite por requisição/minuto, e também `85%` do menor limiar de preço em faixas `PRICE_THRESHOLD_PERCENT`), descontando reserva de saída (`1000` tokens no padrão, cortada pelo limite do perfil), reserva de raciocínio e tokens fixos (instrução + schema).
   - Estados possíveis do plano: `full` (todas até 15 min), `reduced` (ao menos uma encurtada por tokens) ou erro bloqueante `context_too_small` / `max_cut_too_long`.
2. **Sinais locais no texto enviado:** se já medidos na Fonte antes de `selection.start`, o núcleo anexa marcas inline no texto compacto das Frases para energia do áudio (`energy_marks`) e picos de chat de live (`chat_marks`). Esses sinalizadores ficam congelados na execução (`selection_runs`) para que retomar ou refazer Janelas use exatamente os mesmos dados.
3. **Pesos e Nota explicável (`core/src/selection/cut.rs`):** cada candidato recebe notas inteiras de `0` a `10` por eixo, com justificativa obrigatória de até `300` caracteres (`MAX_WHY_CHARS`) e título opcional de até `80` caracteres (`MAX_TITLE_CHARS`). A Nota total (`0.00` a `10.00`, armazenada como `total_centi` de `0` a `1000`) é média ponderada sem curva:
   - **Corte direto (`direct`, 5 eixos):** `hook` (30%), `selfContained` (20%), `energy` (20%), `value` (15%), `closing` (15%).
   - **Vídeo transformado (`transformed`, 6 eixos):** `commentary` — Espaço para comentário (30%), `hook` (20%), `energy` (15%), `value` (15%), `selfContained` (10%), `closing` (10%). Usa a Tarefa `selection_transformed` (que roteia nas preferências pelo mesmo ID `selection`).
4. **Verificadores e pós-processamento determinístico:** o núcleo verifica se `startId`/`endId` pertencem à janela, `startId <= endId`, notas entre `0..=10`, justificativas não vazias e sem candidatos duplicados na mesma janela ou acima de `2× target_candidates` (~10 candidatos/hora). Depois que todas as Janelas terminam (`advance`), código puro em Rust ajusta as bordas para caber na faixa `[minUs, maxUs]` por Frase inteira (`fit`: corta Frases do fim se longo; estende após e depois antes se curto; descarta como `TooShort` ou `TooLong` se impossível), junta duplicatas (`merge_duplicates`: interseção `>= 50%` do menor Corte mantém o de maior Nota, desempatando pelo mais curto e depois pelo início mais cedo) e ordena por Nota decrescente.

### Revisão humana e revisões da execução (`core/src/selection/review.rs` e `selection.rs`)

- **Identidade estável do candidato:** as decisões de revisão ficam na tabela `selection_decisions` do Projeto identificadas por `(run_id, cand_start_id, cand_end_id)` (as bordas originais propostas na seleção). Quando o usuário refaz uma ou mais Janelas com outro Perfil de Provedor (`selection.redo` com `profileId`), a execução cria uma nova **Revisão da execução** (`revision` incrementada em `selection_runs` e `selection_candidates`), preservando revisões anteriores e mantendo as decisões já tomadas para candidatos com a mesma identidade.
- **Ações na revisão:** o usuário aprova (`approved`), rejeita (`rejected`) ou ajusta bordas (`adjusted`) movendo `start` ou `end` em `delta` Frases inteiras dentro da faixa `[minUs, maxUs]` da execução. `selection.undo` desfaz a última decisão apagando o último registro de `selection_decisions` — funciona inclusive entre sessões reabertas. Os tempos nunca vêm da UI: o núcleo calcula tudo por IDs de Frase.

### Ângulos (`core/src/angles.rs`)

- Exclusivo de candidatos **aprovados** em execuções de **Vídeo transformado** (`video_kind = 'transformed'`).
- A Tarefa de IA `angles` herda rota de Provedor e veto **Somente local** da tarefa `script` (`ai_task::routing_id("angles") == "script"`).
- O Provedor propõe `2` ou `3` ângulos distintos (verificador garante diferença de `name` normalizado e similaridade de Jaccard na `promise` `< 0.6`), cada um com `name` (até 60 chars), `promise` (1 frase, até 200 chars), `audience` (até 120 chars) e `sentence_ids` (1 a 12 IDs válidos do Corte).
- O usuário pode escolher uma das sugestões ou escrever um ângulo manual (`audience` e `sentence_ids` são opcionais na escrita manual). A escolha fica em `script_angles` e é pré-condição obrigatória (`angle_required`) antes de gerar o Roteiro. Trocar o ângulo quando já existe Roteiro exige confirmação (`angle_change_confirmation`) e marca os blocos existentes como desatualizados.

### Perfil de canal (`core/src/channel_profile.rs`)

- Vive na tabela `channel_profile` (linha única `id = 1`) do SQLite do Projeto (`*.clipes`), viajando com o Projeto portátil. O estilo padrão de legenda fica na tabela `caption_style_default` do mesmo banco.
- Armazena: `videoKind` (`direct` | `transformed`), `language` (código ISO-639-1 minúsculo suportado pela Transcrição, padrão `"pt"`), `minUs` e `maxUs` (padrão `20 s` a `60 s`, teto do perfil `180 s`, teto técnico do planejador `300 s`), `captionStyle`, `allowedSources` (até `200` itens com `label`, `url` HTTP/HTTPS opcional e `note` opcional), `narrationVoice` (opcional, validada contra o catálogo TTS permitido pela política de licenças) e `directMonetizationAck` (booleano somente leitura via `channel_profile.set`, atualizado por `guardrails.ack_direct_notice`).
- Nunca guarda credenciais de rede social nem escolha de Provedor (ADR-0010).

### Guarda-corpos (ADR-0001, `core/src/guardrails.rs`)

- **Puramente informativos, zero chamadas de IA e nunca bloqueiam a exportação:** avaliam `scope`: `"single"` (um Corte), `"source"` (todos os Cortes aprovados da Fonte) ou `"project"` (todos os Cortes aprovados do Projeto).
- **O que verificam:**
  - Tipo do vídeo (`direct`, `transformed` ou `mixed` em lote) e se o aviso único de monetização do Corte direto precisa ser exibido (`needsDirectNotice: !ack && hasDirect`);
  - Permissão da Fonte (`granted`, `partial`, `none` + `who`/`where`/`scope`);
  - No Vídeo transformado: status do Roteiro (blocos aprovados vs. pendentes), uso de TTS local (para orientar sobre divulgação de voz sintética quando aplicável) e sobra final da Narração (`freezeTailUs`, marcando `longFreezeTail` acima de `5 s`);
  - Áudios importados no Corte (`audio.hasAudio`, `unverifiedCount` de trilhas/SFX sem licença verificada) e se a duração efetiva do Corte passa de `60 s` (`SHORT_CLAIM_LIMIT_US`), faixa em que Shorts com música reivindicada são bloqueados/inelegíveis para monetização no YouTube.
- **Aviso único por canal:** `guardrails.ack_direct_notice` grava `direct_monetization_ack = 1` em `channel_profile`.

### Assistente e roteamento de Provedores (`core/src/assistant.rs` e ADR-0010)

- **Sem padrão de fábrica:** ao instalar o app, nenhuma escolha vem preenchida (`needsSetup: true` enquanto `completed == false && skipped == false`).
- **O que detecta (`assistant.detect`):** faz sondagem local apenas em endereços de **loopback** (`localhost`, `127.0.0.1`, `[::1]`, timeout 800 ms, sem redirecionamento/proxy) procurando **Ollama** (`/api/tags`), **LM Studio** (`/v1/models`) e **llama.cpp** (`/v1/models` ou `/health`), além de procurar no `PATH` os executáveis `codex`, `claude` e `opencode`.
- **Quatro tarefas roteáveis:** `selection` (cobre `selection` e `selection_transformed`), `packaging` (cobre `packaging` e `thumbnail`), `script` (cobre `script`, `script_block` e `angles`) e `translation`. Cada uma pode herdar `default` ou escolher um destino específico (`""`, `"endpoint"`, `"codex"`, `"claude"`, `"opencode"`, ou `"profile:<id>"`).
- **Modo Somente local (`local_only`):** existe por tarefa em `assistant.json` (`assistant.local_only.set`) e como veto global por Projeto no SQLite (`projects.local_only.set`, fora deste domínio). Só proíbe, nunca escolhe Provedor: apenas endpoints de loopback contam como locais (servidores na LAN e CLIs são recusados antes de qualquer acesso à rede com erro `local_only_violation`).

---

## Fluxo típico

### A. Configuração inicial e Perfil de canal
1. Ao abrir o app sem configuração concluída (`assistant.status` → `needsSetup: true`), a UI abre o assistente e chama `assistant.detect` → lista servidores locais e CLIs encontrados.
2. O usuário escolhe um Provedor padrão via `assistant.default.set` (ou configura API/CLI antes) e conclui ou pula com `assistant.complete`.
3. Nas Preferências, a UI consulta `assistant.status`, `assistant.tasks` (com localidade, custo por milhão de tokens, bloqueios e sugestão não aplicada) e permite ajustar escolhas com `assistant.default.set`, `assistant.task.set` e `assistant.local_only.set`.
4. No Projeto aberto, a UI carrega `channel_profile.get` e `channel_profile.languages`, exibindo e salvando as preferências do canal com `channel_profile.set`.

### B. Seleção e revisão de Cortes
1. Com a Fonte transcrita, a UI lê `channel_profile.get` para obter o `videoKind` padrão e lista execuções anteriores com `selection.list`.
2. A UI calcula o plano de janelas e a estimativa de custo com `selection.estimate` (`{ source_id, videoKind }`). Se retornar `context_too_small`, orienta a aumentar o contexto ou trocar o perfil.
3. Ao iniciar, se `paid: true`, a UI exibe diálogo de confirmação de custo e chama `selection.start` com `confirmed: true` → cria `selection_runs`, `selection_windows` e enfileira 1 job `ai:selection` (ou `ai:selection_transformed`) por Janela.
4. A UI escuta `core-progress` (eventos `ai:selection:*` / `ai:selection_transformed:*` e `selection:window` / `selection:done`) e consulta `selection.get` até `run.state` virar `"completed"` ou `"partial"`.
5. Quando a seleção tem candidatos, a UI chama `selection.review` para carregar o estado de revisão (`pending` / `approved` / `rejected`, bordas atuais e `moves` permitidos).
6. Durante a revisão, o usuário aprova/rejeita com `selection.decide`, move bordas por Frase com `selection.adjust` e desfaz a última ação com `selection.undo`.
7. **Caminhos alternativos:**
   - **Cancelar em andamento:** `selection.cancel` cancela Janelas na fila e pede cancelamento da em andamento (chamadas pagas já enviadas viram `uncertain`).
   - **Retomar ou refazer Janelas que falharam/cancelaram:** `selection.estimate { run, windows? }` → `selection.resume { run, confirmed }` (todas as pendentes) ou `selection.redo { run, windows, confirmed }`.
   - **Refazer com outro Perfil de Provedor ("refazer com o forte"):** `selection.estimate { run, windows, profileId }` (devolve prévia com `leavesMachine` e `estimate`) → `selection.redo { run, windows, profileId, confirmed: true }`, criando uma nova revisão da execução sem apagar decisões anteriores.
   - **Pausa por orçamento do lote:** se `run.budgetPause` aparecer não nulo, o usuário precisa aumentar o teto/continuar na fila (`jobs.budget.continue`, de outro domínio).

### C. Ângulos (Vídeo transformado) e Guarda-corpos pré-export
1. Para um candidato aprovado em `videoKind === "transformed"`, o painel de Roteiro chama `angles.get` para ver sugestões anteriores e o ângulo selecionado.
2. Ao pedir sugestões, a UI chama `angles.estimate` → confirma se `paid: true` → chama `angles.generate` e faz polling em `angles.get` enquanto `busy === true`.
3. O usuário escolhe uma sugestão (`angles.choose { candidate, generation, index }`) ou escreve o próprio ângulo (`angles.choose { candidate, angle }`). Se já existir Roteiro, trata `angle_change_confirmation` pedindo confirmação (`confirmed: true`).
4. Antes de exportar um Corte ou lote, a UI chama `guardrails.check` para renderizar o checklist informativo; se `needsDirectNotice === true`, exibe o aviso único de risco de monetização do Corte direto e, ao confirmar, registra com `guardrails.ack_direct_notice`.

---

## Comandos

### `selection.estimate`
- **O que faz:** Planeja as Janelas de seleção e calcula a estimativa de tokens e custo antes de iniciar uma seleção, ou estima o custo para retomar/refazer Janelas de uma execução existente (inclusive com outro Perfil de Provedor).
- **Entrada:**
  - *Modo 1 — Nova seleção:*
    - `source_id: number` (obrigatório) — ID da Fonte transcrita.
    - `minUs: number` (opcional) — duração mínima do Corte em µs (padrão do `channel_profile`).
    - `maxUs: number` (opcional) — duração máxima do Corte em µs (padrão do `channel_profile`).
    - `videoKind: "direct" | "transformed"` (opcional) — tipo de vídeo (padrão do `channel_profile`).
  - *Modo 2 — Retomar/refazer execução existente (sem `profileId`):*
    - `run: number` (obrigatório) — ID da execução em `selection_runs`.
    - `windows: number[]` (opcional) — índices (0-based) das Janelas falhas/canceladas a estimar; omitido estima todas as que falharam/foram canceladas.
  - *Modo 3 — Refazer com outro Perfil de Provedor (`run` + `profileId`):*
    - `run: number` (obrigatório) — ID da execução.
    - `windows: number[]` (obrigatório, não vazio) — índices das Janelas a refazer.
    - `profileId: string` (obrigatório, 1..=64 chars) — ID do Perfil de Provedor (ou CLI) escolhido.
- **Saída:**
  - *Modo 1:* `{ paid: boolean, profile: string, minUs: number, maxUs: number, plan: { state: "full" | "reduced", windows: [{ index, firstId, lastId, startUs, endUs }], contextTokens: number }, videoKind: "direct" | "transformed", weights: [{ key, weight }], energy: { measured, high?, peak? }, chat: { available, peaks?, marked? }, estimate: { kind, units, windows, inputTokens, minMicroUsd, maxMicroUsd } }`.
  - *Modo 2:* `{ paid: boolean, videoKind: "direct" | "transformed", estimate: { kind, units, windows, inputTokens, minMicroUsd, maxMicroUsd } }`.
  - *Modo 3:* `{ profile: { id, label, kind, model }, paid: boolean, leavesMachine: boolean, windows: number[], estimate: { kind, units, windows, inputTokens, minMicroUsd, maxMicroUsd } }`.
- **Erros:** `project_not_open`, `project_busy`, `project_read`, `project_write` (segmentação sob demanda), `source_missing`, `transcript_missing`, `transcript_incomplete`, `no_sentences`, `invalid_cut_range`, `invalid_video_kind`, `invalid_request` (tarefa inválida), `confirmation_required` (CLI não confirmado na rota), `profile_unavailable`, `invalid_settings` (Provedor não configurado ou perfil inexistente), `local_only_violation`, `invalid_task`, `context_too_small`, `max_cut_too_long`, `invalid_selection_plan`, `invalid_profile`, `run_not_found`, `windows_required`, `window_not_found`, `window_not_redoable`, `window_uncertain`, `invalid_job`, `invalid_job_payload`, `unknown_task`, `task_version_changed`, `nothing_to_redo`.
- **Eventos e jobs:** nenhum (execução síncrona; sem rede).
- **Pré-condições:** Projeto aberto; Fonte com Transcrição completa (`Modo 1`) ou execução existente (`Modos 2 e 3`); Provedor configurado para a tarefa `selection` (ou `profileId` válido no Modo 3) respeitando `local_only`.
- **Tela hoje:** `src/features/projects/Selection.tsx` (Modos 1 e 2) e `src/features/projects/RedoWithProfile.tsx` (Modo 3).
- **Mock TS:** sim, em `src/lib/core.ts` (`selectionMockDispatch`), apenas quando os query params `?source-test` e `?transcript-test` estão ativos.
- **US (#26):** US-28, US-59, US-60, US-61, US-63.
- **Código:** `core/src/selection.rs:1552`

### `selection.start`
- **O que faz:** Planeja as Janelas da Transcrição, cria uma execução de seleção no Projeto e enfileira um job de IA por Janela na fila persistida.
- **Entrada:**
  - `source_id: number` (obrigatório) — ID da Fonte transcrita.
  - `minUs: number` (opcional) — duração mínima do Corte em µs.
  - `maxUs: number` (opcional) — duração máxima do Corte em µs.
  - `videoKind: "direct" | "transformed"` (opcional) — tipo de vídeo.
  - `confirmed: boolean` (obrigatório como `true` quando o Provedor resolvido for pago ou CLI).
  - `batch: string` (opcional, 1..=80 chars `[A-Za-z0-9_-]`) — chave de lote externo (usado por `source_batches.rs`; omitido usa `selection-<run>`).
- **Saída:** `{ run: number, batch: string, videoKind: "direct" | "transformed", minUs: number, maxUs: number, windows: number, planState: "full" | "reduced", weights: [{ key, weight }] }`.
- **Erros:** `project_not_open`, `project_busy`, `project_read`, `project_write`, `invalid_batch`, `source_missing`, `transcript_missing`, `transcript_incomplete`, `no_sentences`, `invalid_cut_range`, `invalid_video_kind`, `confirmation_required` (com `usage.estimate` quando pago e sem `confirmed: true`, ou CLI não confirmado), `profile_unavailable`, `invalid_settings`, `local_only_violation`, `invalid_task`, `unknown_task`, `context_too_small`, `max_cut_too_long`, `invalid_selection_plan`.
- **Eventos e jobs:** enfileira `N` jobs `ai:selection` (Corte direto) ou `ai:selection_transformed` (Vídeo transformado) na fila `jobs` do Projeto. Cada job emite eventos `core-progress` com `job: "<job_id>"` e `stage: "ai:selection:prepare" | "call" | "verify" | "paused" | "done"` (ou `ai:selection_transformed:*`), e o agregador da execução emite `job: "selection-<run>"` com `stage: "selection:window"` e `"selection:done"`. Cancelável por `selection.cancel` (ou `jobs.cancel`).
- **Pré-condições:** Projeto aberto; Fonte com Transcrição completa e ao menos 1 Frase; Provedor configurado para `selection` e respeitando `local_only`; `confirmed: true` se pago.
- **Tela hoje:** `src/features/projects/Selection.tsx` (e internamente por `core/src/source_batches.rs`).
- **Mock TS:** sim, em `src/lib/core.ts` (`selectionMockDispatch`, sob `?source-test&transcript-test`).
- **US (#26):** US-59, US-60, US-61, US-62, US-63, US-125, US-126.
- **Código:** `core/src/selection.rs:1553`

### `selection.get`
- **O que faz:** Devolve os detalhes de uma execução de seleção (metadados, contagens, estado de cada Janela e candidatos consolidados ordenados por Nota), fechando a execução se todas as Janelas já tiverem sido resolvidas.
- **Entrada:**
  - `run: number` (obrigatório) — ID da execução em `selection_runs`.
  - `revision: number` (opcional) — número da revisão da execução cujos candidatos se deseja ler (padrão: revisão atual da execução).
- **Saída:** `{ run: { id, transcriptId, taskVersion, promptSha256, profile, state, minUs, maxUs, weights, planState, counts: { windows, completed, failed, kept, discarded, merged }, summary, createdAt, videoKind, revision, budgetPause, revisions: number[] }, windows: [{ index, firstId, lastId, startUs, endUs, jobId, state, code, resetAtMs, profile, redoFailed }], candidates: [{ id, rank, startId, endId, startUs, endUs, axes, total, totalCenti, title, windows, chat, revision, profile, adjusted, adjust }] }`.
- **Erros:** `project_not_open`, `project_busy`, `project_read`, `project_write`, `run_not_found`.
- **Eventos e jobs:** síncrono, mas se todas as Janelas já estiverem resolvidas e `run.state === "running"`, chama `advance(run)` que consolida candidatos e emite `selection:done` em `core-progress`.
- **Pré-condições:** Projeto aberto; execução `run` existente.
- **Tela hoje:** `src/features/projects/Selection.tsx` (e internamente por `core/src/source_batches.rs`).
- **Mock TS:** sim, em `src/lib/core.ts` (`selectionMockDispatch`, sob `?source-test&transcript-test`).
- **US (#26):** US-59, US-60, US-64, US-65, US-126.
- **Código:** `core/src/selection.rs:1554`

### `selection.list`
- **O que faz:** Lista todas as execuções de seleção da Transcrição de uma Fonte, da mais recente à mais antiga (atualizando antes o fechamento de execuções pendentes).
- **Entrada:**
  - `source_id: number` (obrigatório) — ID da Fonte.
- **Saída:** array de objetos `run` (mesma estrutura do campo `run` de `selection.get`).
- **Erros:** `project_not_open`, `project_busy`, `project_read`, `project_write`, `source_missing`, `transcript_missing`, `run_not_found`.
- **Eventos e jobs:** síncrono (pode disparar `selection:done` via `advance` se alguma execução tiver acabado de concluir).
- **Pré-condições:** Projeto aberto; Fonte com registro em `transcripts`.
- **Tela hoje:** `src/features/projects/Selection.tsx`.
- **Mock TS:** sim, em `src/lib/core.ts` (`selectionMockDispatch`, sob `?source-test&transcript-test`).
- **US (#26):** US-59, US-65.
- **Código:** `core/src/selection.rs:1555`

### `selection.cancel`
- **O que faz:** Cancela todas as Janelas na fila (`queued` → `cancelled`) e sinaliza cancelamento para a Janela em execução (`cancel_requested = 1`) de uma execução de seleção.
- **Entrada:**
  - `run: number` (obrigatório) — ID da execução.
- **Saída:** `null`.
- **Erros:** `project_not_open`, `project_busy`, `project_read`, `project_write`, `run_not_found`.
- **Eventos e jobs:** atualiza jobs na fila e chama `advance(run)`; se não houver mais job `running`, emite `selection:done` (com erro `selection_windows_failed`). Chamadas pagas já enviadas ao Provedor antes do cancelamento terminam como `uncertain` na fila.
- **Pré-condições:** Projeto aberto; execução `run` existente.
- **Tela hoje:** `src/features/projects/Selection.tsx` (e internamente por `core/src/source_batches.rs`).
- **Mock TS:** sim, em `src/lib/core.ts` (`selectionMockDispatch`, sob `?source-test&transcript-test`).
- **US (#26):** US-51.
- **Código:** `core/src/selection.rs:1556`

### `selection.redo`
- **O que faz:** Reenfileira Janelas que falharam ou foram canceladas na rota atual da tarefa `selection` (sem repetir Janelas concluídas), ou — quando `profileId` é informado — refaz quaisquer Janelas escolhidas (mesmo concluídas) com outro Perfil de Provedor criando uma nova revisão da execução.
- **Entrada:**
  - `run: number` (obrigatório) — ID da execução.
  - `windows: number[]` (opcional sem `profileId`; obrigatório e não vazio com `profileId`) — índices (0-based) das Janelas a refazer.
  - `profileId: string` (opcional, 1..=64 chars) — Perfil de Provedor explícito para refazer só desta vez (sem mudar o padrão).
  - `confirmed: boolean` (obrigatório como `true` quando a rota for paga ou CLI).
- **Saída:**
  - *Sem `profileId`:* `{ run: number, windows: number[] }`.
  - *Com `profileId`:* `{ run: number, windows: number[], profile: { id, label, kind, model } }`.
- **Erros:** `project_not_open`, `project_busy`, `project_read`, `project_write`, `run_not_found`, `invalid_profile`, `windows_required`, `window_not_found`, `window_not_redoable`, `window_uncertain`, `invalid_job`, `invalid_job_payload`, `unknown_task`, `task_version_changed`, `nothing_to_redo`, `confirmation_required`, `profile_unavailable`, `invalid_settings`, `local_only_violation`, `invalid_task`.
- **Eventos e jobs:** enfileira novos jobs `ai:selection` / `ai:selection_transformed` na fila no mesmo lote da execução (`batch_for(run)`), mantendo `prev_job_id` / `prev_profile` como salvaguarda caso o refazer com perfil falhe. Emite os mesmos eventos de `selection.start`. Cancelável por `selection.cancel`.
- **Pré-condições:** Projeto aberto; execução `run` existente; Janela elegível (não `queued`/`running`, e não `uncertain` quando com `profileId`); Provedor respeitando `local_only`; `confirmed: true` se pago.
- **Tela hoje:** `src/features/projects/Selection.tsx` (por janela) e `src/features/projects/RedoWithProfile.tsx` (com `profileId`).
- **Mock TS:** sim, em `src/lib/core.ts` (`selectionMockDispatch`, sob `?source-test&transcript-test`).
- **US (#26):** US-31, US-32, US-33, US-51.
- **Código:** `core/src/selection.rs:1557`

### `selection.resume`
- **O que faz:** Retoma uma execução de seleção parcial reenfileirando todas as Janelas que falharam ou foram canceladas (registrado como alias direto do mesmo handler `cmd_redo` de `selection.redo`, sem passar `windows`).
- **Entrada:**
  - `run: number` (obrigatório) — ID da execução.
  - `confirmed: boolean` (obrigatório como `true` se o Provedor for pago).
  - *(Nota: por compartilhar o handler `cmd_redo`, aceita também `windows` e `profileId` tecnicamente, mas o contrato previsto é apenas `{ run, confirmed? }`.)*
- **Saída:** `{ run: number, windows: number[] }`.
- **Erros:** os mesmos de `selection.redo` (`run_not_found`, `nothing_to_redo`, `confirmation_required`, `local_only_violation`, etc.).
- **Eventos e jobs:** idêntico a `selection.redo` (enfileira jobs `ai:selection` / `ai:selection_transformed` no mesmo lote da execução).
- **Pré-condições:** Projeto aberto; execução `run` com ao menos uma Janela em estado `failed`, `cancelled`, `unscheduled` ou `uncertain` (no modo sem `profileId`, `Outcome::Failed` engloba `uncertain`, `failed` e `cancelled` — ver observação 3).
- **Tela hoje:** `src/features/projects/Selection.tsx` (e internamente por `core/src/source_batches.rs`).
- **Mock TS:** sim, em `src/lib/core.ts` (`selectionMockDispatch`, sob `?source-test&transcript-test`).
- **US (#26):** US-32, US-51.
- **Código:** `core/src/selection.rs:1558`

### `selection.review`
- **O que faz:** Devolve o estado atual de revisão de todos os candidatos da revisão ativa de uma execução (situação, bordas atuais em Frases e µs, trechos de texto das bordas, movimentos permitidos de ±1 Frase e se há ação para desfazer).
- **Entrada:**
  - `run: number` (obrigatório) — ID da execução.
- **Saída:** `{ run: number, items: [{ candidate: number, status: "pending" | "approved" | "rejected", adjusted: boolean, startId: number, endId: number, startUs: number, endUs: number, startText: string, endText: string, moves: { startEarlier: boolean, startLater: boolean, endEarlier: boolean, endLater: boolean } }], canUndo: boolean }`. (Se alguma borda não existir nas Frases, devolve apenas `{ candidate, status }`.)
- **Erros:** `project_not_open`, `project_busy`, `project_read`, `run_not_found`.
- **Eventos e jobs:** nenhum (síncrono).
- **Pré-condições:** Projeto aberto; execução `run` existente.
- **Tela hoje:** `src/features/projects/CandidateReview.tsx` (e internamente por `core/src/export.rs`, `core/src/export/batch.rs` e `core/src/reframe.rs`).
- **Mock TS:** sim, em `src/lib/core.ts` (`selectionReviewMock`, sob `?source-test&transcript-test`).
- **US (#26):** US-65, US-66, US-67.
- **Código:** `core/src/selection/review.rs:482`

### `selection.decide`
- **O que faz:** Registra a aprovação ou rejeição de um candidato na tabela `selection_decisions` do Projeto (não grava nada se o candidato já estiver no mesmo estado).
- **Entrada:**
  - `candidate: number` (obrigatório) — ID atual do candidato em `selection_candidates`.
  - `decision: "approved" | "rejected"` (obrigatório).
- **Saída:** `{ run: number, item: ReviewItem | null, canUndo: boolean }` (onde `ReviewItem` tem o mesmo formato dos itens de `selection.review`).
- **Erros:** `project_not_open`, `project_busy`, `project_read`, `project_write`, `candidate_not_found`, `invalid_decision`, `run_not_found`.
- **Eventos e jobs:** nenhum (síncrono).
- **Pré-condições:** Projeto aberto; candidato existente na revisão atual da execução.
- **Tela hoje:** `src/features/projects/CandidateReview.tsx`.
- **Mock TS:** sim, em `src/lib/core.ts` (`selectionReviewMock`, sob `?source-test&transcript-test`).
- **US (#26):** US-66, US-67.
- **Código:** `core/src/selection/review.rs:483`

### `selection.adjust`
- **O que faz:** Move a borda inicial (`start`) ou final (`end`) de um candidato em `delta` Frases inteiras (negativo = mais cedo), validando contra os limites da Transcrição e a faixa `[minUs, maxUs]` da execução.
- **Entrada:**
  - `candidate: number` (obrigatório) — ID do candidato.
  - `edge: "start" | "end"` (obrigatório) — qual borda mover.
  - `delta: number` (obrigatório) — deslocamento em Frases inteiras (`!= 0` e `|delta| <= 1000`).
- **Saída:** `{ run: number, item: ReviewItem | null, canUndo: boolean }`.
- **Erros:** `project_not_open`, `project_busy`, `project_read`, `project_write`, `candidate_not_found`, `invalid_edge`, `invalid_delta`, `run_not_found`, `adjust_out_of_transcript`, `adjust_empty`, `adjust_too_short`, `adjust_too_long`.
- **Eventos e jobs:** nenhum (síncrono).
- **Pré-condições:** Projeto aberto; candidato existente na revisão atual; novo intervalo dentro da Transcrição e da faixa de duração da execução.
- **Tela hoje:** `src/features/projects/CandidateReview.tsx`.
- **Mock TS:** sim, em `src/lib/core.ts` (`selectionReviewMock`, sob `?source-test&transcript-test`).
- **US (#26):** US-63, US-66, US-73.
- **Código:** `core/src/selection/review.rs:484`

### `selection.undo`
- **O que faz:** Desfaz a última decisão (`approved`, `rejected` ou `adjusted`) gravada para uma execução em `selection_decisions` (apagando a última linha), funcionando inclusive entre sessões reabertas.
- **Entrada:**
  - `run: number` (obrigatório) — ID da execução.
- **Saída:** `{ run: number, item: ReviewItem | null, canUndo: boolean }` (com o `item` do candidato afetado, se presente na revisão atual).
- **Erros:** `project_not_open`, `project_busy`, `project_read`, `project_write`, `run_not_found`, `nothing_to_undo`.
- **Eventos e jobs:** nenhum (síncrono).
- **Pré-condições:** Projeto aberto; execução `run` existente com pelo menos uma decisão em `selection_decisions`.
- **Tela hoje:** `src/features/projects/CandidateReview.tsx`.
- **Mock TS:** sim, em `src/lib/core.ts` (`selectionReviewMock`, sob `?source-test&transcript-test`).
- **US (#26):** US-40, US-66, US-67.
- **Código:** `core/src/selection/review.rs:485`

### `angles.get`
- **O que faz:** Devolve o documento atual de ângulos de um candidato aprovado do Vídeo transformado (sugestões mais recentes concluídas, ângulo selecionado, estado de ocupação e histórico de jobs).
- **Entrada:**
  - `candidate: number` (obrigatório) — ID do candidato aprovado.
- **Saída:** `{ angles: [{ name, promise, audience, sentence_ids }], generation: number | null, selected: Angle | null, busy: boolean, job: { id, state, code, violations } | null, generations: [{ id, jobId, state, data, code, violations }] }`.
- **Erros:** `project_not_open`, `project_busy`, `project_read`, `candidate_not_found`, `not_approved`, `adjust_out_of_transcript`, `script_requires_transformed`, `angle_invalid` (se JSON salvo no banco estiver inválido).
- **Eventos e jobs:** nenhum (síncrono).
- **Pré-condições:** Projeto aberto; candidato aprovado pertencente a uma execução `transformed`.
- **Tela hoje:** `src/features/projects/Angles.tsx`.
- **Mock TS:** sim, em `src/lib/scriptMock.ts`.
- **US (#26):** US-127.
- **Código:** `core/src/angles.rs:389`

### `angles.estimate`
- **O que faz:** Estima o custo da chamada ao Provedor para sugerir 2 ou 3 ângulos para um candidato aprovado do Vídeo transformado.
- **Entrada:**
  - `candidate: number` (obrigatório) — ID do candidato aprovado.
  - `language: "pt-BR" | "en"` (opcional se detectado pelas Frases com ≥ 80% de participação; obrigatório caso contrário).
- **Saída:** `{ paid: boolean, profile: string, estimate: { kind, inputTokens?, minMicroUsd?, maxMicroUsd?, ... } }`.
- **Erros:** `project_not_open`, `project_busy`, `project_read`, `candidate_not_found`, `not_approved`, `adjust_out_of_transcript`, `script_requires_transformed`, `language_required`, `invalid_request`, `confirmation_required` (CLI não confirmado), `profile_unavailable`, `invalid_settings`, `local_only_violation`.
- **Eventos e jobs:** nenhum (síncrono).
- **Pré-condições:** Projeto aberto; candidato aprovado em execução `transformed`; idioma detectável ou informado; Provedor configurado para `script` respeitando `local_only`.
- **Tela hoje:** `src/features/projects/Angles.tsx`.
- **Mock TS:** sim, em `src/lib/scriptMock.ts`.
- **US (#26):** US-28, US-127.
- **Código:** `core/src/angles.rs:390`

### `angles.generate`
- **O que faz:** Enfileira um job da Tarefa de IA `angles` para gerar 2 ou 3 ângulos distintos para um candidato aprovado do Vídeo transformado.
- **Entrada:**
  - `candidate: number` (obrigatório) — ID do candidato aprovado.
  - `language: "pt-BR" | "en"` (opcional se detectado pelas Frases; obrigatório se ambíguo).
  - `confirmed: boolean` (obrigatório como `true` quando a rota for paga ou CLI).
- **Saída:** `{ job: number }`.
- **Erros:** `project_not_open`, `project_busy`, `project_read`, `project_write`, `candidate_not_found`, `not_approved`, `adjust_out_of_transcript`, `script_requires_transformed`, `language_required`, `confirmation_required` (com `usage.estimate`), `profile_unavailable`, `invalid_settings`, `local_only_violation`, `generation_in_progress`, `unknown_task`, `invalid_task`.
- **Eventos e jobs:** enfileira job `ai:angles` no lote `angles-<run>-<start_id>-<end_id>`. Emite `core-progress` com `job: "<job_id>"` e `stage: "ai:angles:prepare" | "call" | "verify" | "paused" | "done"`. Cancelável via `jobs.cancel`.
- **Pré-condições:** Projeto aberto; candidato aprovado em execução `transformed`; sem geração de ângulos já em andamento (`busy: false`); Provedor configurado para `script` respeitando `local_only`; `confirmed: true` se pago.
- **Tela hoje:** `src/features/projects/Angles.tsx`.
- **Mock TS:** sim, em `src/lib/scriptMock.ts`.
- **US (#26):** US-127.
- **Código:** `core/src/angles.rs:391`

### `angles.choose`
- **O que faz:** Seleciona um ângulo gerado pela IA ou grava um ângulo escrito manualmente pelo usuário para um candidato aprovado do Vídeo transformado.
- **Entrada:**
  - `candidate: number` (obrigatório) — ID do candidato aprovado.
  - *Opção A (escolher sugestão):* `generation: number` (ID de `angle_generations` com estado `completed`) e `index: number` (índice na lista `angles`).
  - *Opção B (ângulo manual):* `angle: { name: string (1..=60), promise: string (1..=200, 1 linha e 1 frase), audience?: string (1..=120), sentence_ids?: number[] (1..=12 IDs do Corte) }`.
  - `confirmed: boolean` (obrigatório como `true` se já existir Roteiro gerado e o ângulo estiver mudando).
- **Saída:** mesmo objeto completo retornado por `angles.get`.
- **Erros:** `project_not_open`, `project_busy`, `project_read`, `project_write`, `candidate_not_found`, `not_approved`, `adjust_out_of_transcript`, `script_requires_transformed`, `angle_invalid`, `generation_in_progress` (quando há geração de Roteiro em andamento), `angle_change_confirmation` (quando já existem blocos de Roteiro e `confirmed !== true`).
- **Eventos e jobs:** nenhum (síncrono).
- **Pré-condições:** Projeto aberto; candidato aprovado em execução `transformed`; nenhuma geração de Roteiro em andamento; se já houver Roteiro, `confirmed: true`.
- **Tela hoje:** `src/features/projects/Angles.tsx`.
- **Mock TS:** sim, em `src/lib/scriptMock.ts` (devolve apenas `{ selected }`, diferente do Rust).
- **US (#26):** US-127, US-128.
- **Código:** `core/src/angles.rs:392`

### `channel_profile.get`
- **O que faz:** Lê o Perfil de canal do Projeto aberto (tipo de vídeo padrão, idioma, faixa de duração, estilo padrão de legenda, fontes permitidas, voz da Narração, aceite do aviso de Corte direto e limites técnicos).
- **Entrada:** nenhuma (`{}`).
- **Saída:** `{ videoKind: "direct" | "transformed", language: string, minUs: number, maxUs: number, captionStyle: Style, allowedSources: [{ label, url?, note? }], narrationVoice: string | null, directMonetizationAck: boolean, limits: { defaultMinUs, defaultMaxUs, maxUs, technicalMaxUs } }`.
- **Erros:** `project_not_open`, `project_busy`, `project_read`, `invalid_video_kind`, `channel_profile_invalid`, `caption_style_invalid`.
- **Eventos e jobs:** nenhum (síncrono).
- **Pré-condições:** Projeto aberto.
- **Tela hoje:** `src/features/projects/ChannelProfile.tsx`, `src/features/projects/Selection.tsx`, `src/features/projects/Sources.tsx`, `src/features/projects/SourceBatches.tsx`.
- **Mock TS:** sim, em `src/lib/core.ts`.
- **US (#26):** US-41, US-42, US-63, US-102.
- **Código:** `core/src/channel_profile.rs:489`

### `channel_profile.set`
- **O que faz:** Atualiza parcialmente os campos configuráveis do Perfil de canal do Projeto aberto e devolve o perfil completo atualizado. Campos desconhecidos são rejeitados (`deny_unknown_fields`); `directMonetizationAck` e `limits` enviados são ignorados (somente leitura).
- **Entrada:** objeto `SetInput` (todos os campos opcionais):
  - `videoKind?: "direct" | "transformed"`
  - `language?: string` (ISO-639-1 minúsculo de `SUPPORTED_LANGUAGES`)
  - `minUs?: number` (`> 0` e `< maxUs`)
  - `maxUs?: number` (`> minUs` e `<= 180_000_000`)
  - `captionStyle?: Style` (salvo como estilo padrão em `caption_style_default`)
  - `allowedSources?: [{ label: string (1..=120, sem controle), url?: string (HTTP/HTTPS, <= 500), note?: string (<= 300) }]` (máx. 200 itens)
  - `narrationVoice?: string | null` (`null` ou vazio limpa; senão ID válido no catálogo TTS permitido)
  - `directMonetizationAck?: any` (ignorado)
  - `limits?: any` (ignorado)
- **Saída:** mesmo objeto completo de `channel_profile.get`.
- **Erros:** `project_not_open`, `project_busy`, `project_read`, `project_write`, `channel_profile_invalid`, `invalid_video_kind`, `invalid_cut_range`, `invalid_url`, `caption_style_invalid`.
- **Eventos e jobs:** nenhum (síncrono).
- **Pré-condições:** Projeto aberto.
- **Tela hoje:** `src/features/projects/ChannelProfile.tsx`.
- **Mock TS:** sim, em `src/lib/core.ts`.
- **US (#26):** US-41, US-63.
- **Código:** `core/src/channel_profile.rs:490`

### `channel_profile.languages`
- **O que faz:** Lista os códigos e nomes de idiomas suportados para configuração do Perfil de canal (reutilizando `SUPPORTED_LANGUAGES` do módulo de Transcrição).
- **Entrada:** nenhuma (`{}`).
- **Saída:** array `[{ code: string, name: string }]`.
- **Erros:** nenhum previsto (leitura de constante estática).
- **Eventos e jobs:** nenhum (síncrono).
- **Pré-condições:** nenhuma (funciona mesmo sem Projeto aberto).
- **Tela hoje:** `src/features/projects/ChannelProfile.tsx`.
- **Mock TS:** sim, em `src/lib/core.ts`.
- **US (#26):** US-41.
- **Código:** `core/src/channel_profile.rs:491`

### `guardrails.check`
- **O que faz:** Avalia de forma informativa (sem bloquear nem alterar estado) os guarda-corpos de originalidade, monetização, Permissão, Roteiro, Narração/TTS, sobra final, áudio importado e duração acima de 60 s para um Corte, uma Fonte ou o Projeto inteiro.
- **Entrada:**
  - `scope?: "single" | "source" | "project"` (opcional, padrão `"single"`).
  - *Quando `scope === "single"`:* `source_id: number` (obrigatório), `candidate_id?: number`, `clip_id?: number`, `start_id?: number`, `end_id?: number`.
  - *Quando `scope === "source"`:* `source_id: number` (obrigatório).
  - *Quando `scope === "project"`:* nenhum outro campo.
- **Saída:**
  - *Escopo `"single"`:* `{ scope: "single", directMonetizationAck, needsDirectNotice, videoKind, hasDirect, hasTransformed, totalCuts: 1, durationUs, over60s, over60sCount, shortClaimLimitUs: 60000000, permission: { status, grantedCount, missingCount, totalCount, who, where, scope }, script: { applicable, exists?, approved?, pendingBlocks?, totalBlocks? }, narration: { applicable, hasTts?, generatedBlocks?, totalBlocks?, voices?, freezeTailUs?, longFreezeTail? }, audio: { hasAudio, assetCount, unverifiedCount } }`.
  - *Escopo `"source"` ou `"project"`:* `{ scope, directMonetizationAck, needsDirectNotice, videoKind: "direct" | "transformed" | "mixed", hasDirect, hasTransformed, totalCuts, durationUs, over60s, over60sCount, shortClaimLimitUs: 60000000, permission: { status: "granted" | "partial" | "none", grantedCount, missingCount, totalCount, ... }, script: { applicable, transformedCount?, approvedCount?, unapprovedCount? }, narration: { applicable, hasTts?, ttsCutCount?, transformedCount?, freezeTailCount?, longFreezeTailCount?, maxFreezeTailUs? }, audio: { hasAudio, cutsWithAudio, cutsWithUnverifiedAudio, unverifiedCount } }`.
- **Erros:** `project_not_open`, `project_busy`, `project_read`, `invalid_guardrails_scope`, `source_missing`, mais eventuais erros de leitura de `export::batch`, `script` ou `channel_profile`.
- **Eventos e jobs:** nenhum (síncrono).
- **Pré-condições:** Projeto aberto; `source_id` existente quando `scope` for `"single"` ou `"source"`.
- **Tela hoje:** `src/features/guardrails/GuardrailsPanel.tsx` (usado por `Editor.tsx`, `ExportButton.tsx` e `BatchExport.tsx`).
- **Mock TS:** sim, em `src/lib/core.ts` (com pequenas diferenças de campos no modo em lote).
- **US (#26):** US-102, US-103, US-104, US-105.
- **Código:** `core/src/guardrails.rs:588`

### `guardrails.ack_direct_notice`
- **O que faz:** Registra uma única vez no Perfil de canal do Projeto aberto que o usuário visualizou e confirmou o aviso sobre o risco de monetização do Corte direto.
- **Entrada:** nenhuma (`{}`).
- **Saída:** `{ directMonetizationAck: true }`.
- **Erros:** `project_not_open`, `project_busy`, `project_write`.
- **Eventos e jobs:** nenhum (síncrono).
- **Pré-condições:** Projeto aberto.
- **Tela hoje:** `src/features/guardrails/GuardrailsPanel.tsx` (chamado por `ExportButton.tsx` e `BatchExport.tsx`).
- **Mock TS:** sim, em `src/lib/core.ts`.
- **US (#26):** US-102.
- **Código:** `core/src/guardrails.rs:589`

### `assistant.status`
- **O que faz:** Devolve o estado atual do assistente e do roteamento global de Provedores (`completed`, `skipped`, `needsSetup`, escolha padrão, escolhas por tarefa, `localOnly` por tarefa e perfis removidos em `missing`).
- **Entrada:** nenhuma (`{}`).
- **Saída:** `{ completed: boolean, skipped: boolean, needsSetup: boolean, default: string, tasks: { selection, packaging, script, translation }, localOnly: { selection, packaging, script, translation }, missing: Record<string, string> }`.
- **Erros:** `settings` (falha ao ler `assistant.json`, `provider.json` ou localizar diretório de configuração).
- **Eventos e jobs:** nenhum (síncrono).
- **Pré-condições:** nenhuma.
- **Tela hoje:** `src/features/assistant/Assistant.tsx`, `src/features/assistant/AssistantSettings.tsx`.
- **Mock TS:** sim, em `src/lib/core.ts`.
- **US (#26):** US-20, US-26.
- **Código:** `core/src/assistant.rs:589`

### `assistant.detect`
- **O que faz:** Sonda localmente servidores de modelo em loopback (Ollama, LM Studio e llama.cpp) e procura executáveis de CLI (`codex`, `claude`, `opencode`) no `PATH`, sem enviar nenhum dado de usuário.
- **Entrada:** `{}` na UI (aceita opcionalmente `ollama`, `lmStudio`, `llamaCpp` com URLs `http://` de loopback e `path` para testes).
- **Saída:** `{ ollama: { found, endpoint, models }, lmStudio: { found, endpoint, models }, llamaCpp: { found, endpoint, models }, codex: { found }, claude: { found }, opencode: { found } }`.
- **Erros:** `invalid_endpoint` (se uma URL de teste informada não for `http://` de loopback sem credenciais/query/caminho).
- **Eventos e jobs:** nenhum (síncrono; faz requisições HTTP locais com timeout de 800 ms em paralelo).
- **Pré-condições:** nenhuma.
- **Tela hoje:** `src/features/assistant/Assistant.tsx`.
- **Mock TS:** sim, em `src/lib/core.ts`.
- **US (#26):** US-20, US-22, US-23, US-24.
- **Código:** `core/src/assistant.rs:590`

### `assistant.default.set`
- **O que faz:** Define o Provedor padrão global do app (ou limpa com `""`) usado pelas Tarefas de IA que não tiverem escolha própria.
- **Entrada:**
  - `choice: "" | "endpoint" | "codex" | "claude" | "opencode" | "profile:<id>"` (opcional; ausente equivale a `""`).
- **Saída:** mesmo objeto completo retornado por `assistant.status`.
- **Erros:** `invalid_settings` (escolha inválida ou perfil inexistente), `confirmation_required` (CLI escolhido ainda não confirmado via `provider.cli.confirm`), `settings`.
- **Eventos e jobs:** nenhum (síncrono).
- **Pré-condições:** se `choice` for `profile:<id>`, o perfil deve existir; se for CLI, deve estar confirmado.
- **Tela hoje:** `src/features/assistant/Assistant.tsx`, `src/features/assistant/AssistantSettings.tsx`.
- **Mock TS:** sim, em `src/lib/core.ts`.
- **US (#26):** US-20, US-26.
- **Código:** `core/src/assistant.rs:591`

### `assistant.task.set`
- **O que faz:** Define (ou limpa com `""` para herdar o padrão) o Provedor de uma Tarefa de IA específica sem alterar as demais tarefas nem o padrão global.
- **Entrada:**
  - `task: "selection" | "packaging" | "script" | "translation"` (obrigatório).
  - `choice: "" | "endpoint" | "codex" | "claude" | "opencode" | "profile:<id>"` (opcional; ausente remove a escolha da tarefa).
- **Saída:** mesmo objeto completo retornado por `assistant.status`.
- **Erros:** `invalid_settings` (tarefa inválida, escolha inválida ou perfil inexistente), `confirmation_required` (CLI não confirmado), `settings`.
- **Eventos e jobs:** nenhum (síncrono).
- **Pré-condições:** tarefa válida; se `choice` for `profile:<id>` ou CLI, deve existir/estar confirmado.
- **Tela hoje:** `src/features/assistant/TaskTable.tsx`.
- **Mock TS:** sim, em `src/lib/core.ts`.
- **US (#26):** US-26.
- **Código:** `core/src/assistant.rs:592`

### `assistant.complete`
- **O que faz:** Marca o assistente de primeira execução como concluído (`skipped: false`) ou pulado (`skipped: true`), fazendo `needsSetup` virar `false`.
- **Entrada:**
  - `skipped: boolean` (opcional, padrão `false`).
- **Saída:** mesmo objeto completo retornado por `assistant.status`.
- **Erros:** `settings`.
- **Eventos e jobs:** nenhum (síncrono).
- **Pré-condições:** nenhuma.
- **Tela hoje:** `src/features/assistant/Assistant.tsx`.
- **Mock TS:** sim, em `src/lib/core.ts`.
- **US (#26):** US-20.
- **Código:** `core/src/assistant.rs:593`

### `assistant.local_only.set`
- **O que faz:** Liga ou desliga a restrição **Somente local** para uma Tarefa de IA específica nas configurações globais do app (impedindo envio fora de `loopback` naquela tarefa).
- **Entrada:**
  - `task: "selection" | "packaging" | "script" | "translation"` (obrigatório).
  - `enabled: boolean` (obrigatório).
- **Saída:** mesmo objeto completo retornado por `assistant.status`.
- **Erros:** `invalid_settings` (tarefa inválida ou `enabled` ausente/não booleano), `settings`.
- **Eventos e jobs:** nenhum (síncrono).
- **Pré-condições:** nenhuma.
- **Tela hoje:** `src/features/assistant/TaskTable.tsx`.
- **Mock TS:** sim, em `src/lib/core.ts`.
- **US (#26):** US-22, US-121.
- **Código:** `core/src/assistant.rs:594`

### `assistant.tasks`
- **O que faz:** Monta os dados da tabela de Tarefas de IA: perfil resolvido (próprio ou herdado), localidade (`local`, `cli`), tabela de custo, flag `blocked` (quando `localOnly` ou o veto do Projeto bloqueia o perfil), perfil `missing` removido e eventual `suggestion` local (nunca aplicada automaticamente).
- **Entrada:** nenhuma (`{}`).
- **Saída:** `{ tasks: [{ task, choice, source: "task" | "default" | "none", profile: { id, label, kind, model, local, cli, cost } | null, localOnly: boolean, blocked: boolean, missing: string | null, suggestion: { choice, label, measured: false } | null }], projectLocalOnly: boolean }`.
- **Erros:** `settings`, `project_busy`, `project_read` (se houver Projeto aberto e falhar a leitura de `project_privacy`).
- **Eventos e jobs:** nenhum (síncrono).
- **Pré-condições:** nenhuma (se não houver Projeto aberto, `projectLocalOnly` retorna `false`).
- **Tela hoje:** `src/features/assistant/TaskTable.tsx`.
- **Mock TS:** sim, em `src/lib/core.ts` (não consulta tabela de preços para perfis remotos).
- **US (#26):** US-20, US-22, US-26.
- **Código:** `core/src/assistant.rs:595`

---

## Estados e eventos do domínio

### Eventos `core-progress` emitidos neste domínio

| `job` | `stage` | Quando acontece | Percentual | Pode ter `error` |
| --- | --- | --- | --- | --- |
| `<job_id>` (kind `ai:selection`, `ai:selection_transformed` ou `ai:angles`) | `ai:<tarefa>:prepare` | Fila inicia a execução do job de IA | `0` | Não |
| `<job_id>` | `ai:<tarefa>:call` | Núcleo envia a chamada ao Provedor | `10` | Não |
| `<job_id>` | `ai:<tarefa>:verify` | Resposta recebida; validando schema completo e verificadores | `80` | Não |
| `<job_id>` | `ai:<tarefa>:paused` | Orçamento por tarefa/lote barrou o envio; job volta a `queued` | `0` | Sim (`budget_*` ou `cost_unknown`) |
| `<job_id>` | `ai:<tarefa>:done` | Job finalizou (`completed`, `failed`, `cancelled` ou `uncertain`) | `100` (ok) / `0` (erro ou cancelado) | Sim (em `failed` ou `uncertain`) |
| `selection-<run>` | `selection:window` | Uma Janela da execução foi resolvida e ainda restam outras | `0`–`99` (`(completed+failed)*100/total`) | Não |
| `selection-<run>` | `selection:done` | Todas as Janelas foram resolvidas e a revisão da execução fechou | `100` | Sim (`selection_windows_failed`, se `failed > 0`) |

### Estados dos objetos do domínio e modelo de estados de um Corte

1. **Planejamento de Janelas (`selection.estimate` → `plan.state`):**
   - `full` (todas as Janelas com até 15 min) | `reduced` (ao menos uma encurtada por limite de tokens) | erro bloqueante `context_too_small` / `max_cut_too_long`.
2. **Execução de seleção (`selection_runs.state`):**
   - `running` (enquanto houver Janela `queued` ou `running`) → `completed` (todas `completed`, ou com resultado anterior preservado após falha de redo) | `partial` (ao menos uma Janela falhou, foi cancelada ou ficou `uncertain`).
   - Refazer com `profileId` reabre temporariamente a execução para `running` e, se ao menos uma Janela refeita concluir, avança `revision` (`revision + 1`).
3. **Janela de seleção (`selection_windows` / `jobs.state`):**
   - `unscheduled` (sem job associado) | `queued` (na fila, possivelmente pausada por `budgetPause`) → `running` → `completed` | `failed` | `cancelled` | `uncertain` (timeout ou cancelamento após envio pago).
4. **Modelo de estados de um Corte (do candidato proposto à exportação):**
   - **Proposto / Pendente (`status: "pending"`):** gerado em `selection_candidates` após `advance(run)` (já com bordas ajustadas por `fit` dentro de `[minUs, maxUs]` e duplicatas absorvidas); ainda sem decisão em `selection_decisions`.
   - **Ajustado (`adjusted: true`):** bordas `startId`/`endId` movidas por `selection.adjust` em Frases inteiras dentro da faixa da execução. Nota: ajustar um candidato **não** muda o `status` dele (`pending`, `approved` ou `rejected`), apenas atualiza `startId`/`endId` e marca `adjusted: true` (e registra uma ação desfazível em `selection_decisions`).
   - **Rejeitado (`status: "rejected"`):** marcado via `selection.decide`; fica fora do editor, do Empacotamento e da exportação. Pode voltar a `pending` (ou ao estado anterior) via `selection.undo` ou ser aprovado via `selection.decide`.
   - **Aprovado (`status: "approved"`):** marcado via `selection.decide`; libera:
     - **Se `videoKind === "direct"` (Corte direto):** edição (`editor.open`), Empacotamento (`packaging.*`), capa (`thumbnail.*`), reenquadramento (`reframe.start`), tradução (`translation.*`) e exportação (`export.start` / `export.batch.start`).
     - **Se `videoKind === "transformed"` (Vídeo transformado):** além dos recursos do Corte, exige a cadeia humana no loop antes da Narração: **Ângulo** (`angles.generate`/`angles.choose` → `selected !== null`) → **Roteiro** (`script.*`, com todos os blocos aprovados) → **Narração** (`narration.*`, liberada apenas com `narrationAllowed === true`).
   - *(Observação: um Corte também pode ser aberto no editor/exportado avulso diretamente por `(source_id, start_id, end_id)`, sem passar por candidato de seleção.)*
5. **Geração de ângulos (`angles.get` → `job.state`):**
   - Sem geração (`job: null`) → `queued` → `running` → `completed` | `failed` | `cancelled` | `uncertain`. O ângulo escolhido em `script_angles` é independente da última geração (pode ser manual).

---

## Configurações deste domínio

| Preferência / Dado | Onde vive | Quem lê / grava |
| --- | --- | --- |
| Provedor padrão, escolhas por tarefa, flag `completed`/`skipped` do assistente e `localOnly` por tarefa | Arquivo global `assistant.json` em `config_dir` (`%LOCALAPPDATA%\io.github.gustavohooo.clipes\` no Windows, `config_local_dir/io.github.gustavohooo.clipes/` no Linux/macOS, ou `CLIPES_DATA_DIR` quando definido, `core/src/paths.rs`) | `assistant.status`, `assistant.default.set`, `assistant.task.set`, `assistant.complete`, `assistant.local_only.set`, `assistant.tasks` (e leitura de rota em `provider::routed` / `selection.*` / `angles.*`) |
| Veto `Somente local` do Projeto | SQLite do Projeto (`*.clipes`), tabela `project_privacy` | Lido por `assistant.tasks`, `selection.*`, `angles.*` (gravado por `projects.local_only.set`, de outro domínio) |
| Perfil de canal (`video_kind`, `language`, `min_us`, `max_us`, `allowed_sources`, `narration_voice`, `direct_monetization_ack`) | SQLite do Projeto (`*.clipes`), tabela `channel_profile` | `channel_profile.get`, `channel_profile.set`, `guardrails.check`, `guardrails.ack_direct_notice` (e leitura de defaults em `selection.*`) |
| Estilo de legenda padrão do canal | SQLite do Projeto (`*.clipes`), tabela `caption_style_default` | `channel_profile.get`, `channel_profile.set` (e `captions.style.*`) |
| Execuções de seleção, Janelas e candidatos por revisão | SQLite do Projeto (`*.clipes`), tabelas `selection_runs`, `selection_windows`, `selection_candidates` | `selection.start`, `selection.get`, `selection.list`, `selection.cancel`, `selection.redo`, `selection.resume`, `selection.review` |
| Decisões humanas de revisão (aprovar/rejeitar/ajustar) | SQLite do Projeto (`*.clipes`), tabela `selection_decisions` | `selection.review`, `selection.decide`, `selection.adjust`, `selection.undo` |
| Ângulos sugeridos e ângulo escolhido por Corte | SQLite do Projeto (`*.clipes`), tabelas `angle_generations`, `script_angles` | `angles.get`, `angles.generate`, `angles.choose` (e leitura em `script.*`) |

---

## Observações para o front novo

1. **Mock de `selection.*` preso a query params e divergente do núcleo:**
   - Em `src/lib/core.ts:861`, **todos** os 11 comandos `selection.*` só respondem no mock se a URL tiver **ambos** `?source-test` e `?transcript-test`; fora disso, lançam `Unknown core command`.
   - `selectionReviewMock` ignora o `run` passado e sempre usa 3 candidatos fixos (`1, 2, 3`); `selectionMockDispatch` de `selection.list` e `selection.get` omite campos reais do Rust como `minUs`, `maxUs`, `planState`, `revisions` e `revision` no objeto `run`.
   - Em `src/lib/scriptMock.ts`, `angles.estimate` não retorna `profile`, e `angles.choose` retorna `{ selected }` em vez do documento completo devolvido pelo Rust (`angles.get`).
   - Em `src/lib/core.ts`, `guardrails.check` em escopo `source`/`project` retorna `audio: { applicable, cutsWithAudio, cutsWithUnverifiedAudio, totalUnverified }`, enquanto o núcleo (`core/src/guardrails.rs:550-555`) retorna `{ hasAudio, cutsWithAudio, cutsWithUnverifiedAudio, unverifiedCount }` (sem `applicable`), e o mock também omite `freezeTailCount`, `longFreezeTailCount` e `maxFreezeTailUs` em `narration`.
   - `channel_profile.set` no mock não rejeita campos extras (`deny_unknown_fields` no Rust), não valida `language` contra `SUPPORTED_LANGUAGES` e não valida limites de `allowedSources`.
2. **Revisões anteriores (`revisions`) existem no núcleo, mas a UI atual não permite vê-las:** `selection.get` aceita `revision` opcional e devolve `run.revisions: number[]`, porém `src/features/projects/Selection.tsx` nunca envia `revision` e não oferece seletor para comparar candidatos de revisões anteriores após usar `RedoWithProfile`.
3. **Inconsistência em `selection.resume` vs. `selection.redo` e comportamento de `uncertain`:**
   - No Rust (`core/src/selection.rs:1558`), `selection.resume` é registrado apontando para a mesma função `cmd_redo` de `selection.redo`. Assim, `selection.resume` aceita os mesmos argumentos opcionais (`windows`, `profileId`).
   - Quando chamado **sem `profileId`** (caminho de `selection.resume` ou "Refazer janela" na `Selection.tsx`), `redo_inputs` trata `Outcome::Failed` — o que **inclui** Janelas em estado `uncertain` (`window.outcome()` mapeia `"uncertain"` para `Outcome::Failed`), re-enfileirando sem o bloqueio `window_uncertain` que existe no refazer com `profileId`! O front novo deve respeitar a regra do ADR-0005/ADR-0009 (resolver `uncertain` explicitamente na fila antes de reprocessar).
4. **Parâmetros aceitos pelo núcleo mas não expostos na UI atual:**
   - `selection.estimate` e `selection.start` aceitam `minUs` e `maxUs` por execução, mas `Selection.tsx` usa apenas os valores salvos em `channel_profile`.
   - `assistant.detect` e `assistant.tasks` já suportam o CLI `opencode` no núcleo (`core/src/assistant.rs`), além de `codex` e `claude` (enquanto o `GLOSSARY.md` e a issue #26 citavam apenas Codex e Claude Code).
   - `channel_profile.set` envia `captionStyle` junto e incrementa silenciosamente `caption_style_default` sem checar conflito de `revision` (comportamento diferente de `captions.style.set`).
5. **Tratamento de erro genérico nas telas atuais:**
   - `Selection.tsx` exibe apenas `error.message` sem mapear códigos como `context_too_small`, `local_only_violation`, `confirmation_required` ou `profile_unavailable`.
   - `Assistant.tsx`, `AssistantSettings.tsx` e `TaskTable.tsx` descartam o `CoreError.code` e exibem sempre a mesma mensagem genérica (`t.failed`), inclusive quando falta confirmação de CLI (`confirmation_required`) ou quando um perfil foi removido (`profile_unavailable`).
   - `GuardrailsPanel.tsx` engole qualquer erro de `guardrails.check` e `guardrails.ack_direct_notice` silenciosamente (`return null` / no-op), para nunca travar a exportação.
   - `Angles.tsx` trata especificamente apenas `angle_invalid`, `local_only_violation`, `generation_in_progress` e `angle_change_confirmation`; códigos como `language_required`, `not_approved` ou `script_requires_transformed` caem no erro genérico.
