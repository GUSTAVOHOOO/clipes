# Front v2 · Onda 3: Cortes (Seleção e Revisão)

> **Para agentes:** SUB-SKILL OBRIGATÓRIA: `superpowers:subagent-driven-development` (recomendado) ou `superpowers:executing-plans` para executar tarefa por tarefa. Toda tarefa é TDD (`superpowers:test-driven-development`): teste falhando primeiro, depois o mínimo de código. Passos com checkbox (`- [ ]`).

**Goal:** Construir todas as telas e superfícies da Macro-etapa 2 (`Cortes`) do front v2 do Clipes — **Configurador e Acompanhamento de Seleção** (`#/projeto/:id/cortes`, com `<ResumoCustoPrivacidade>` antes de qualquer chamada paga, sinais locais de energia e chat, Janelas de seleção e Revisões da execução) e **Bancada de Revisão de Cortes** (`#/projeto/:id/cortes/revisao/:runId`, na organização enxuta *Lista e detalhe* com `<PlayerProxy>` 9:16, Nota explicável recolhida, ±1 Frase por `I`/`O`, aprovar/rejeitar/desfazer por teclado e *Refazer com outro Perfil*), inclusive Cortes e execuções de seleção de Projetos existentes da V1 — sobre a fundação da Onda 0 e os contratos das Ondas 1 e 2, com mock TS completo e testes Vitest + Playwright em `1366×768` e `1440×900`.

**Architecture:** Telas, stores e componentes em `front-v2/src/` importam primitivas/componentes de `@ds` (`design-system-v2/src/index.ts`), reaproveitam o store `fontesProjeto` criado na Onda 2 (sem duplicar `sources.list` nem consulta de `transcription.status`), e falam com o núcleo exclusivamente via `chamar<T>()` (`~/core/cliente`), `mensagemDeErro()` (`~/core/erros`), `useFila()` (`~/core/progresso`), `useRota()` (`~/rotas/useRota`) e `useAtalhos()` (`~/comandos/atalhos`). O mock TS em `src/lib/core.ts` e `src/lib/scriptMock.ts` deixa de exigir os portões `?source-test` / `?transcript-test` para `selection.*`, `energy.*`, `chat.*`, `proxy.*` e `jobs.estimate`/`retry`/`discard`, mantém um Projeto `"demo"` navegável desde `#/inicio` com Fontes, execuções e decisões V1 realistas, e emite eventos simulados de `core-progress` (`ai:selection:*`, `selection:window`, `selection:done`, `energy`, `chat`, `proxy`) via barramento da Onda 1. Sem alterações em `core/` nem `src-tauri/`.

**Tech Stack:** React 19, TypeScript, Tailwind 4, `@base-ui/react` 1.9.0, `@tanstack/react-virtual`, `lucide-react`, Vite; testes com Vitest + Testing Library + jsdom (unidade e componente) e `@playwright/test` contra o mock (`VITE_CORE_MOCK=1`).

**Spec:** `docs/produto/front-v2/telas/C-cortes-selecao-revisao.md` (Telas C.1 e C.2), wireframes `docs/produto/front-v2/wireframes/C1-selecao.html` e `C2-revisao.html`, protótipo `docs/produto/front-v2/wireframes/prototipo/revisao.html?variant=A`, `DESIGN.md`, `docs/produto/front-v2/01-arquitetura.md` (§3 rotas, §4 shell, §5 fila/eventos, §6 estados, §7 custo/privacidade, §8 atalhos, §9 acessibilidade, §10 estado), `docs/produto/front-v2/02-consolidacao.md` (catálogo canônico, Questões #1, #20–#22 e "Lacunas do mock TS") e `docs/produto/funcionalidades/04-selecao-de-cortes.md`. Issue-mãe: #288.

## Global Constraints

Herdadas integralmente de [04-plano-implementacao.md](./04-plano-implementacao.md#global-constraints):

- Vocabulário canônico do `GLOSSARY.md` em PT-BR (Projeto, Fonte, VOD, Corte, Corte direto, Vídeo transformado, Transformação, Narração, Roteiro, Transcrição, Frase, Janela de contexto, Janela de seleção, Nota, Espaço para comentário, Provedor, Perfil de Provedor, Perfil de canal, Revisão da execução, Permissão, Somente local). Nunca "clipe", "short", "input", "segmento", "rodada" nem "IA" como substantivo.
- Visual só pelos tokens e componentes de `design-system-v2/src/index.ts` (`@ds`) e regras do `DESIGN.md`: **A Regra da Luz Única** (um único botão primário `sinal` por tela e marca de seleção `marcado` em 2 px), **A Regra do Estado Cinza** (`<Status>` e selos nunca usam pílula colorida), **A Regra do Erro Sem Fundo** (`role="alert"` via `<BannerErroCore>`), **A Regra do Número Tabular** (`num` em timecodes, durações, contagens, custos e Notas) e **A Regra da Cor do Vídeo** (quadro 9:16 preto e amarelo `#ffd23f` restrito à legenda dentro do vídeo).
- Revelação progressiva: na Bancada C.2 (`prototipo/revisao.html?variant=A` e `C2-revisao.html`), `<BadgeNota>` mostra Nota e motivo em uma linha por padrão e `<EixosNota>` começa recolhido (`"Ver os 5 eixos"` / `"Ver os 6 eixos"`), exibindo **Espaço para comentário (30%)** em primeiro destaque no `Vídeo transformado`.
- WCAG 2.2 AA (`1366×768` sem rolagem externa da janela e verificado em `1440×900`, colunas internas com rolagem própria, `<ListaVirtual>` com `role="listbox"`, `tabIndex={0}` e `aria-activedescendant`, alvos ≥ 24×24 CSS px, foco `.foco`/`.foco-interno`, teclas únicas `A`/`R`/`I`/`O`/`Espaço`/`J`/`K`/`L` respeitando o modo WCAG 2.1.4 e desabilitadas em campos de texto).
- Todo comando pago ou que manda texto para fora da máquina (`selection.start`, `selection.resume`, `selection.redo`) passa por `<ResumoCustoPrivacidade>` e exige `<ConfirmDialog focoInicial="cancelar">` enviando `confirmed: true` antes de disparar (§7).
- Toda ação que depende de ticket aberto no núcleo (#289–#307) fica **desabilitada com `<Dica>` citando o ticket** (ou segue o contorno explícito da tabela abaixo).
- Nada de mudança em `core/` ou `src-tauri/`.
- Disco: `cargo clean` (se algo tiver compilado) e limpeza de `%TEMP%\clipes-<ticket>-*` antes de cada `worker_done` (`AGENTS.md`).

### Ações dependentes de tickets abertos no núcleo (#289–#307)

| Ticket aberto | Tela / Superfície afetada | Comportamento na Onda 3 |
|---|---|---|
| **#290** (`core(selection): bloquear janela uncertain explicitamente em selection.resume`) | `#/projeto/:id/cortes` (C.1 — banners e resumo da execução) | Em `core/src/selection.rs:1558`, `selection.resume` usa o mesmo handler de `selection.redo` e re-enfileira `uncertain` dentro de `Outcome::Failed`. Enquanto houver ao menos uma Janela com `state === 'uncertain'` em `windows[]`, o botão `"Retomar janelas pendentes"` (`selection.resume`) fica **desabilitado** com `<Dica>` citando `#290` (`"Há janela incerta nesta execução; resolva na Fila antes de retomar (#290)."`), e o banner prioritário orienta resolver via `jobs.estimate` → `jobs.retry` / `jobs.discard`. |
| **#292** (`core(selection): converter Corte direto individual em Vídeo transformado`) | `#/projeto/:id/cortes/revisao/:runId` (C.2 — detalhe de candidato `Corte direto`) | `videoKind` (`direct` \| `transformed`) pertence à execução (`selection_runs`). Enquanto não houver comando por candidato no núcleo, a ação discreta `"Converter em Vídeo transformado"` (quando exibida no detalhe de um `Corte direto`) fica **desabilitada** com `<Dica>` citando `#292` (`"Conversão individual para Vídeo transformado aguarda comando no núcleo (#292)."`). |
| **#302** (`core(transcription,sources): expor next_undo/next_redo e transcriptState`) | `#/projeto/:id/cortes` (C.1 — seletor de Fonte transcrita) | Herdado da Onda 2: como `sources.list` não traz `transcriptState`, C.1 consome `transcriptStatusBySource` do store `fontesProjeto` (alimentado por `transcription.status { source_id }` e `core-progress`) para listar apenas Fontes com `transcript.state === 'complete'`. |
| **#304** (`core(jobs): avaliar atualização de selection_runs.revision em jobs.redo`) | `#/projeto/:id/cortes` (C.1) e `#/projeto/:id/cortes/revisao/:runId` (C.2) | O botão `"Refazer com outro Perfil"` em C.1 e C.2 chama exclusivamente `selection.redo { run, windows, profileId, confirmed }` (nunca `jobs.redo`), garantindo incremento de `selection_runs.revision` e preservação de decisões; tooltip/nota informa que refazer por unidade na Fila Global não cria nova revisão (`#304`). |
| **#307** (`core(telemetry): campos informativos extras...` — `selection.review` vizinhas) | `#/projeto/:id/cortes/revisao/:runId` (C.2 — `<AjusteBorda>`) | `selection.review` retorna apenas `startText` e `endText` (sem `prevStartText`/`nextEndText`); `<AjusteBorda>` exibe `startText` e `endText` já retornados pelo comando sem inventar prévia de Frases vizinhas até `#307`. |

## Review Focus

1. **Compatibilidade com Projetos, execuções e revisões existentes da V1 (`selection.list`/`get`/`review`):** execuções importadas da V1 podem chegar com `revisions: [1]` sem `redoProfile`, candidatos com `title: ''` (exibir `"Sem título"`), `adjusted: true`, decisões prévias persistidas em `selection_decisions` (`canUndo: true` já na abertura da C.2), ou Fonte `offline`/`changed` — em que a seleção sobre Transcrição existente e a revisão textual (`BadgeNota`, `EixosNota`, `AjusteBorda`, `selection.decide`, `selection.undo`) continuam 100% funcionais enquanto `<PlayerProxy>` exibe estado acionável para relocalizar a Fonte.
2. **Guarda `<ResumoCustoPrivacidade>` e proteção de `uncertain` (`#290`):** o Modo 1 de `selection.estimate` devolve apenas `profile: string` (sem `leavesMachine` nem `kind`/`model`), exigindo cruzamento no front com `provider.profiles.list` + `assistant.tasks` (`02-consolidacao.md`, Questão #20); toda chamada paga ou CLI abre `<ConfirmDialog focoInicial="cancelar">` com `<ResumoCustoPrivacidade>` antes de enviar `confirmed: true`; `local_only` bloqueia rotas externas sem trocar de Provedor sozinho; e janelas `uncertain` bloqueiam `selection.resume` (`#290`) e `selection.redo` exigindo `jobs.estimate` → `jobs.retry { confirmed: true }` ou `jobs.discard`.
3. **Identidade estável entre Revisões (`?rev=:n`), otimismo seguro e `selection.undo`:** trocar de Revisão chama `selection.get { run, revision }` + `selection.review { run }` atualizando `?rev=:n` sem perder decisões em `selection_decisions`; `selection.decide` aplica atualização otimista com rollback em erro (enquanto `selection.start`, `selection.resume` e `selection.redo` aguardam resposta real do núcleo); `selection.adjust` trata `adjust_out_of_transcript`, `adjust_empty`, `adjust_too_short` e `adjust_too_long` inline mantendo o candidato focado; e `Ctrl/Cmd+Z` (`selection.undo`) desfaz a última decisão/ajuste entre sessões e re-seleciona o candidato afetado.
4. **Fidelidade à Variante A (*Lista e detalhe enxuta*, `prototipo/revisao.html?variant=A` e `DESIGN.md`):** na C.2, `<ListaVirtual>` usa `role="listbox"`, `tabIndex={0}` e `aria-activedescendant` (sem `tabIndex={-1}`); `<ItemCorte>` exibe apenas título, início (`tcLongo`) e duração (`duracao`) em `t3`, Nota em `num` e ícone de decisão (`Check`/`X`); `<EixosNota>` começa recolhido e põe **Espaço para comentário (30%)** em 1º no `Vídeo transformado`; apenas **1 botão primário** fica aceso por tela (`Selecionar Cortes` em C.1; `Aprovar` quando pendente e `Abrir no editor` quando aprovado em C.2); e `<ChecklistGuardaCorpos>` só aparece após aprovação.
5. **Atalhos sem conflito e atualização reativa via `core-progress`:** `I`/`O` (`Shift+I`/`Shift+O`), `A`/`R`, `↑`/`↓`, `Enter`, `Espaço`/`J`/`K`/`L`/`←`/`→` passam por `useAtalhos` respeitando foco em campos de texto e WCAG 2.1.4, sem colidir com `Ctrl+[`/`Ctrl+]` do Shell; eventos `ai:selection:*`, `selection:window`, `selection:done`, `energy`, `chat` e `proxy` fluem apenas pelo store global da Fila (`useFila`) sem `setInterval`, mantendo Nota, bordas e decisões interativas enquanto o proxy 9:16 gera (`queued`/`running`).

---

## Onda 3 · Cortes (Seleção e Revisão)

**Estrutura de arquivos:**

```text
src/lib/
  core.ts                             remove portões ?source-test&transcript-test em selection*/energy*/chat*/proxy*/jobs.estimate/retry/discard; corrige selection.list/get/review/decide/adjust/undo, chat.status, guardrails.check, proxy.map_time; implementa energy.start e eventos core-progress em tempo real + cenários ?estado=
  scriptMock.ts                       angles.choose retorna documento completo de angles.get; angles.estimate retorna profile

front-v2/
  src/
    core/
      erros.ts                        amplia TABELA_ERROS com códigos do Pacote C
    stores/
      selecaoProjeto.ts               store reativo de execuções (selection.list/get), revisão (selection.review), resolução de perfil/privacidade para Modo 1, invalidação via core-progress e limpeza ao trocar/fechar Projeto
    componentes/
      SeletorPerfilRedo.tsx           <ConfirmDialog> + seleção de Perfil + <ResumoCustoPrivacidade> (selection.estimate Modo 3 → selection.redo)
      DialogoResolverIncerteza.tsx    fluxo jobs.estimate → <ConfirmDialog> → jobs.retry { confirmed: true } | jobs.discard
    telas/cortes/
      ConfiguradorSelecao.tsx         coluna esquerda C.1 (Tipo de vídeo + pesos + aviso direto; faixa min/max; Energia/Chat; Contexto + <ResumoCustoPrivacidade> + Selecionar Cortes)
      AcompanhamentoSelecao.tsx       coluna direita C.1 (Execução, Revisão, banners orçamento/uncertain/parcial, resumo, grade de Janelas 1/2 cols e ações por Janela)
      Selecao.tsx                     #/projeto/:id/cortes (cabeçalho da Fonte transcrita, guarda sem transcrições, estados §6)
      ListaCandidatos.tsx             coluna esquerda C.2 (filtros por estado, Slider Nota mínima, ordenação, <ListaVirtual> + <ItemCorte>, filtro vazio)
      DetalheCandidato.tsx            coluna direita C.2 (<PlayerProxy> 9:16 + progresso proxy + <Transporte>, <BadgeNota> + <EixosNota> + chat, <AjusteBorda>, Aprovar/Rejeitar, Abrir no editor, <ChecklistGuardaCorpos> + angles.get + botão #292)
      Revisao.tsx                     #/projeto/:id/cortes/revisao/:runId (guarda :runId, sub-cabeçalho, Desfazer Ctrl+Z, Refazer com outro Perfil, Ir para Exportação, regiões F6, estados §6)
    App.tsx                           liga rotas cortes e revisao
  e2e/
    cortes-selecao.spec.ts            Playwright C.1 (1366×768 e 1440×900)
    cortes-revisao.spec.ts            Playwright C.2 (1366×768 e 1440×900)
```

---

### Tarefa 1: Extensão de erros e atualização do mock TS (`selection.*`, `energy.*`, `chat.*`, `proxy.*`, `guardrails.*`, `angles.*`, `jobs.*`)

**Files:**
- Modify: `front-v2/src/core/erros.ts` (adicionar em `TABELA_ERROS` os códigos do Pacote C ausentes: `run_not_found`, `candidate_not_found`, `nothing_to_undo`, `window_uncertain`, `window_not_redoable`, `windows_required`, `window_not_found`, `adjust_out_of_transcript`, `adjust_empty`, `adjust_too_short`, `adjust_too_long`, `transcript_incomplete`, `no_sentences`, `invalid_cut_range`, `invalid_video_kind`, `invalid_selection_plan`, `invalid_profile`, `verification_failed`, `selection_windows_failed`)
- Modify: `src/lib/core.ts` (remover exigência de `?source-test` e `?transcript-test` em `selectionMockDispatch`, `selectionReviewMock`, `energy.status`, `chat.status`, `chat.fetch`, `proxy.request`, `proxy.status`, `jobs.estimate`/`retry`/`discard`; implementar `energy.start` e `proxy.map_time`; enriquecer `selection.list` e `selection.get` com `minUs`, `maxUs`, `planState`, `revision`, `revisions`, `window.profile`, `window.jobId`, `window.resetAtMs`, `run.budgetPause`; tornar `selectionReviewMock` indexado por `run` e `revision`, preservando decisões entre revisões e calculando `moves` reais; alinhar `chat.status` com `intervals`/`messages` e `guardrails.check` com `hasAudio`/`unverifiedCount`/`freezeTail*`; popular Projeto `"demo"` inicial com 1 execução V1 concluída de múltiplos candidatos e `revisions: [1, 2]` além de suporte a `?estado=vazio|erro|parcial|offline|carregando`; emitir `core-progress` via `emitirProgressoMock` para `ai:selection:*`, `selection:window`, `selection:done`, `energy`, `chat`, `proxy`)
- Modify: `src/lib/scriptMock.ts` (fazer `angles.choose` retornar o documento completo de `angles.get` e `angles.estimate` retornar `profile` para aderência ao Rust)
- Test: `front-v2/src/core/erros.test.ts`, `front-v2/src/core/selecaoMock.test.ts`

**Interfaces:**
- Consumes: `emitirProgressoMock` (`src/lib/core.ts`, Onda 1), `ErroCore` (`~/core/cliente`).
- Produces:
  - `TABELA_ERROS` cobrindo todos os códigos mapeados de `C-cortes-selecao-revisao.md` §5.
  - Handlers mock sem query flag oculta, com contratos idênticos aos de `core/src/selection.rs`, `core/src/selection/review.rs`, `core/src/proxy.rs`, `core/src/energy.rs`, `core/src/chat.rs`, `core/src/guardrails.rs` e `core/src/angles.rs`.

- [ ] **Step 1: Testes falhando** — em `erros.test.ts`, validar tradução e recuperação de `run_not_found`, `window_uncertain` (`abrir-fila`), `adjust_too_short`, `adjust_too_long`, `adjust_out_of_transcript`, `transcript_incomplete`, `no_sentences`, `nothing_to_undo`, `verification_failed`. Em `selecaoMock.test.ts` (sem query params ocultos):
  - `selection.list { source_id: 1 }` e `selection.get { run, revision }` retornam `minUs`, `maxUs`, `planState`, `revision`, `revisions`, `window.profile`, `window.jobId`;
  - `selection.review` / `decide` / `adjust` / `undo` funcionam por `run`, mantêm decisões ao alternar `revision` e rejeitam com `adjust_too_short` / `adjust_too_long` / `nothing_to_undo`;
  - `energy.start`, `chat.fetch` (`chat.status` com `intervals` e `messages`), `proxy.request` / `proxy.status` / `proxy.map_time` (bidirecional `source_us` ↔ `proxy_us`) emitem `core-progress` no barramento mock;
  - `guardrails.check` retorna `hasAudio`, `unverifiedCount`, `freezeTail*` e `angles.choose` retorna documento completo de `angles.get`.
- [ ] **Step 2:** `cd front-v2; bun run test src/core/erros.test.ts src/core/selecaoMock.test.ts` → FAIL.
- [ ] **Step 3:** Atualizar `erros.ts`, `src/lib/core.ts` e `src/lib/scriptMock.ts`.
- [ ] **Step 4:** `cd front-v2; bun run test src/core/erros.test.ts src/core/selecaoMock.test.ts` → PASS.
- [ ] **Step 5:** Commit `feat(front-v2): erros e mock TS completo de seleção, revisão, proxy e sinais`.

---

### Tarefa 2: Store `selecaoProjeto.ts` e diálogos `<SeletorPerfilRedo>` / `<DialogoResolverIncerteza>`

**Files:**
- Create: `front-v2/src/stores/selecaoProjeto.ts`, `front-v2/src/componentes/SeletorPerfilRedo.tsx`, `front-v2/src/componentes/DialogoResolverIncerteza.tsx`
- Test: `front-v2/src/stores/selecaoProjeto.test.ts`, `front-v2/src/componentes/SeletorPerfilRedo.test.tsx`, `front-v2/src/componentes/DialogoResolverIncerteza.test.tsx`

**Interfaces:**
- Consumes: `chamar`, `ErroCore`, `mensagemDeErro` (`~/core/cliente`, `~/core/erros`); `Fila`, `useFila` (`~/core/progresso`); `useProjetoAtual` (`~/shell/Shell`); `@ds` (`BannerErroCore`, `Botao`, `ConfirmDialog`, `Esqueleto`, `ResumoCustoPrivacidade`, `Select`, `Status`, `usd`).
- Real core commands used: `selection.list`, `selection.get`, `selection.review`, `selection.estimate`, `selection.redo`, `provider.profiles.list`, `assistant.tasks`, `jobs.budget.get`, `jobs.estimate`, `jobs.retry`, `jobs.discard`.
- Produces:
  - `resolverDestinoSelecao(profileIdOrName, perfis, tarefas)` (função pura que resolve `perfil: { id, label, kind, model }`, `localidade: 'local' | 'remoto' | 'cli'`, `saiDaMaquina: boolean`, `host: string | null`, `bloqueadoSomenteLocal: boolean` para alimentar `<ResumoCustoPrivacidade>` no Modo 1 de `selection.estimate`, conforme `02-consolidacao.md` Questão #20).
  - `criarStoreSelecaoProjeto()` + hook `useSelecaoProjeto(projetoPath: string | null)`:
    - mantém `runsPorFonte`, `execucaoAtiva` (`selection.get`), `revisaoAtiva` (`selection.review`), e invalida automaticamente quando o store da Fila receber `ai:selection:*:done`, `ai:selection:*:paused`, `selection:window`, `selection:done`, `energy`/`chat` `complete` ou `proxy` `complete`/`failed`;
    - limpa integralmente o cache quando `projetoPath` muda ou vira `null` (`projects.close`).
  - `<SeletorPerfilRedo aberto run windows perfilAtual aoFechar aoConcluir />`:
    - lista perfis de `provider.profiles.list` (excluindo `perfilAtual`, se informado), chama `selection.estimate { run, windows, profileId }`, renderiza `<ConfirmDialog focoInicial="cancelar">` com `<ResumoCustoPrivacidade>` e, ao confirmar, chama `selection.redo { run, windows, profileId, confirmed: true }` (nunca `jobs.redo`, nota `#304`); trata `local_only_violation` e `window_uncertain` em `role="alert"`.
  - `<DialogoResolverIncerteza aberto jobId rotuloJanela aoFechar aoResolver />`:
    - chama `jobs.estimate { id: jobId }`, mostra `<ConfirmDialog focoInicial="cancelar">` com `<ResumoCustoPrivacidade>` (ou aviso se `safety === 'paid'`) e oferece **"Repetir chamada"** (`jobs.retry { id: jobId, confirmed: true }`) e **"Descartar chamada"** (`jobs.discard { id: jobId }`).

- [ ] **Step 1: Testes falhando** —
  - `selecaoProjeto.test.ts`: `resolverDestinoSelecao` distingue `local` (loopback), `remoto` (HTTPS com `host`) e `cli` (`codex`/`claude`/`opencode`); evento `core-progress` `selection:window` / `selection:done` invalida e recarrega `selection.get`; `projetoPath = null` limpa caches;
  - `SeletorPerfilRedo.test.tsx`: carrega perfis excluindo o atual, dispara `selection.estimate` Modo 3 ao trocar perfil, abre `<ConfirmDialog>` com foco inicial em `"Cancelar"`, exibe `local_only_violation` e `window_uncertain` sem fechar, e ao confirmar chama `selection.redo { run, windows, profileId, confirmed: true }`;
  - `DialogoResolverIncerteza.test.tsx`: chama `jobs.estimate { id }` ao abrir, permite repetir (`jobs.retry { confirmed: true }`) ou descartar (`jobs.discard`) e notifica `aoResolver`.
- [ ] **Step 2:** `cd front-v2; bun run test src/stores/selecaoProjeto.test.ts src/componentes/SeletorPerfilRedo.test.tsx src/componentes/DialogoResolverIncerteza.test.tsx` → FAIL.
- [ ] **Step 3:** Implementar `selecaoProjeto.ts`, `SeletorPerfilRedo.tsx` e `DialogoResolverIncerteza.tsx`.
- [ ] **Step 4:** `cd front-v2; bun run test src/stores/selecaoProjeto.test.ts src/componentes/SeletorPerfilRedo.test.tsx src/componentes/DialogoResolverIncerteza.test.tsx` → PASS.
- [ ] **Step 5:** Commit `feat(front-v2): store de Seleção e diálogos de Redo e Incerteza`.

---

### Tarefa 3: Configurador de Seleção — Coluna Esquerda C.1 (`ConfiguradorSelecao.tsx`)

**Files:**
- Create: `front-v2/src/telas/cortes/ConfiguradorSelecao.tsx`
- Test: `front-v2/src/telas/cortes/ConfiguradorSelecao.test.tsx`

**Interfaces:**
- Consumes: `chamar`, `ErroCore`, `mensagemDeErro` (`~/core/cliente`, `~/core/erros`); `useFila` (`~/core/progresso`); `resolverDestinoSelecao` (`~/stores/selecaoProjeto`); `@ds` (`BannerErroCore`, `Botao`, `Campo`, `ConfirmDialog`, `Dica`, `Entrada`, `EstadoTela`, `Progresso`, `ResumoCustoPrivacidade`, `Status`, `duracao`).
- Real core commands used: `channel_profile.get`, `guardrails.check`, `guardrails.ack_direct_notice`, `energy.status`, `energy.start`, `chat.status`, `chat.fetch`, `jobs.cancel`, `provider.selection_state`, `provider.profiles.list`, `assistant.tasks`, `jobs.budget.get`, `selection.estimate`, `selection.start`.
- Produces:
  - `ConfiguradorSelecao({ fonte, execucaoEmAndamento, refCampoMaxUs?, refBotaoDisparar?, aoIniciarSelecao })` com os 4 blocos de `C1-selecao.html`:
    1. **Tipo de vídeo desta seleção** (`role="radiogroup"`, setas `↑`/`↓`/`←`/`→` entre `Corte direto` e `Vídeo transformado`, subtítulo `"Herdado do Perfil de canal"` vs. `"Sobrescrito só para esta execução"`, pesos da Nota — destacando `Espaço para comentário (30%)` em `Vídeo transformado` — e faixa não bloqueante de `guardrails.check` com botão `"Entendi o risco"` → `guardrails.ack_direct_notice` quando `needsDirectNotice === true`);
    2. **Faixa de duração do Corte** (inputs numéricos `Mínimo (s)` e `Máximo (s)` convertidos em µs, validação inline `minUs > 0`, `minUs < maxUs`, `maxUs <= 300 s`, aviso não bloqueante acima de `60 s` sobre músicas reivindicadas, botão `"Restaurar padrão do canal"` quando diferente de `channel_profile`);
    3. **Sinais locais da Fonte** (Energia: `measured` → contagem `high`/`peak`, job `queued`/`running` → `<Progresso>` + `"Cancelar"` via `jobs.cancel`, ou `"Medir energia do áudio"` via `energy.start`; Chat: `available` → picos e mensagens, `absent` → `"Sem replay de chat"`, job ativo → `<Progresso>` + `"Cancelar"`, ou `"Buscar chat da live"` via `chat.fetch` quando `state === 'none' && canFetch`);
    4. **Contexto, Custo e Disparo**: selo de compatibilidade de `provider.selection_state` (`full` 15 min / `reduced` / `blocked` com link para `#/config/provedores`, ou `"Contexto gerenciado pelo CLI"` quando `applicable === false`), `<ResumoCustoPrivacidade>` inline com saldo de orçamento (`jobs.budget.get` para tarefa `selection`) e indicação de `Somente local` quando bloqueado; botão primário único **"Selecionar Cortes"**:
       - se `paid === true` ou CLI, abre `<ConfirmDialog focoInicial="cancelar">` contendo `<ResumoCustoPrivacidade>` antes de enviar `selection.start { source_id, minUs, maxUs, videoKind, confirmed: true }`;
       - se `local` (`!paid`), dispara `selection.start` diretamente;
       - se `profile_unavailable` (sem Provedor configurado para seleção), exibe `<EstadoTela tipo="sem_permissao" compacto />` com CTA `"Configurar Provedores"` (`#/config/provedores`) no lugar de `<ResumoCustoPrivacidade>`;
       - trata `context_too_small` / `max_cut_too_long` (botões `"Reduzir duração máxima"` focando `maxUs` e `"Trocar Perfil de Provedor"`), `local_only_violation`, `confirmation_required`, `vault` / `cli_auth_required`.

- [ ] **Step 1: Testes falhando** (`ConfiguradorSelecao.test.tsx`):
  - inicializa com `videoKind`, `minUs`/`maxUs` do `channel_profile.get`, pesos da Nota e compatibilidade de `provider.selection_state`;
  - alternar `radiogroup` para `Vídeo transformado` recalcula `selection.estimate` (debounced) e mostra `Espaço para comentário (30%)` em 1º;
  - clicar `"Entendi o risco"` chama `guardrails.ack_direct_notice` e oculta a faixa;
  - alterar máximo para `90 s` exibe aviso de limite `60 s` e habilita `"Restaurar padrão do canal"`; `min >= max` ou `> 300 s` bloqueia disparo com erro inline acessível (`aria-describedby`);
  - `"Medir energia do áudio"` chama `energy.start { source_id }`; `"Buscar chat da live"` chama `chat.fetch { source_id }`; job ativo mostra `"Cancelar"` (`jobs.cancel`);
  - com Provedor pago no mock, clicar `"Selecionar Cortes"` abre `<ConfirmDialog>` com foco inicial em `"Cancelar"` e `<ResumoCustoPrivacidade>`, e só chama `selection.start { confirmed: true }` após confirmação;
  - `context_too_small`, `local_only_violation` e `profile_unavailable` renderizam em `role="alert"` / `sem_permissao` com botões de recuperação corretos.
- [ ] **Step 2:** `cd front-v2; bun run test src/telas/cortes/ConfiguradorSelecao.test.tsx` → FAIL.
- [ ] **Step 3:** Implementar `ConfiguradorSelecao.tsx`.
- [ ] **Step 4:** `cd front-v2; bun run test src/telas/cortes/ConfiguradorSelecao.test.tsx` → PASS.
- [ ] **Step 5:** Commit `feat(front-v2): ConfiguradorSelecao com custo, sinais e validação`.

---

### Tarefa 4: Acompanhamento de Seleção (Coluna Direita) + Tela C.1 (`Selecao.tsx`, `#/projeto/:id/cortes`) + E2E

**Files:**
- Create: `front-v2/src/telas/cortes/AcompanhamentoSelecao.tsx`, `front-v2/src/telas/cortes/Selecao.tsx`
- Modify: `front-v2/src/App.tsx` (ligar rota `cortes` a `<Selecao />`)
- Test: `front-v2/src/telas/cortes/Selecao.test.tsx`, `front-v2/e2e/cortes-selecao.spec.ts`

**Interfaces:**
- Consumes: `chamar`, `ErroCore`, `mensagemDeErro`; `useFila`; `useFontesProjeto` (`~/stores/fontesProjeto`, Onda 2 — `#302`); `useSelecaoProjeto`, `resolverDestinoSelecao`; `estadoForcado`, `<ComEstado>` (`~/shell/EstadoForcado`); `useAtalhos`; `<ConfiguradorSelecao>`; `<SeletorPerfilRedo>`; `<DialogoResolverIncerteza>`; `@ds` (`AreaRolagem`, `BannerErroCore`, `Botao`, `ConfirmDialog`, `Dica`, `Esqueleto`, `EstadoTela`, `Progresso`, `ResumoCustoPrivacidade`, `SeloTipoVideo`, `Select`, `Status`, `tcLongo`, `useToast`).
- Real core commands used: `sources.list`, `transcription.status`, `selection.list`, `selection.get`, `selection.estimate`, `selection.cancel`, `selection.resume`, `selection.redo`, `jobs.budget.get`, `jobs.budget.continue`, `jobs.estimate`, `jobs.retry`, `jobs.discard`.
- Produces:
  - `<AcompanhamentoSelecao>`:
    - Seletor de **Execução** (`selection.list`, da mais recente à mais antiga, inclusive execuções da V1) + **Seletor de Revisão** (`role="tablist"` quando `<= 5` revisões ou `<Select>` quando `> 5`, anunciando `"Revisão N de M"` e atualizando `?rev=:n`);
    - Banners prioritários no topo:
      - se alguma Janela tiver `state === 'uncertain'`: banner `role="alert"` *"Chamada paga incerta — resolva antes de repetir"* com botão `"Resolver na Fila"` abrindo `<DialogoResolverIncerteza>` (e mantendo `"Retomar janelas pendentes"` **desabilitado** com `<Dica>` citando `#290`);
      - se `run.budgetPause !== null`: faixa *"Seleção pausada pelo teto de orçamento"* + botão `"Ajustar orçamento e continuar"` (`jobs.budget.get` → `<ConfirmDialog>` com teto/consumo e ciência se `cost_unknown` → `jobs.budget.continue`);
      - se `run.state === 'partial'` (sem `uncertain`): faixa *"Seleção parcial: X de Y Janelas concluídas, Z pendente(s)."* + botão `"Retomar janelas pendentes"` (`selection.estimate` Modo 2 → `<ConfirmDialog>` se pago → `selection.resume`);
    - Resumo da execução (`counts`, sinais congelados, perfil base) + `<Progresso>` determinístico durante `job_running` + `"Cancelar seleção"` (`<ConfirmDialog>` se houver chamada paga em voo → `selection.cancel { run }`) + botão **"Abrir bancada de revisão"** (`#/projeto/:id/cortes/revisao/:runId?rev=:n`, habilitado quando `candidates.length > 0`);
    - Se concluída com `0` candidatos: estado vazio com CTA `"Refazer com outro Perfil"` (abre `<SeletorPerfilRedo>`);
    - Grade responsiva de **Janelas de seleção** (1 coluna em `1366 px`, 2 colunas em `1440+ px`; `role="list"` com `aria-label="Janela X, de HH:MM:SS a HH:MM:SS, <estado>"`): índice, intervalo `tabular-nums`, perfil (`w.profile`), `<Status>` textual + sub-estágio via `useFila()`, motivo do erro traduzido (`w.code` + `resetAtMs` se `provider_daily_limit`), e ações por Janela: `"Refazer janela"` (`selection.redo { run, windows: [w.index], confirmed }` em `failed`/`cancelled`), `"Refazer com outro Perfil"` (`<SeletorPerfilRedo>`) ou `"Resolver incerteza"` (`<DialogoResolverIncerteza>` em `uncertain`).
  - `<Selecao>`:
    - Cabeçalho fixo da Fonte (combobox/Select apenas de Fontes com `transcript.state === 'complete'` via `useFontesProjeto`, `#302`), selo de saúde (`Disponível` vs. aviso não bloqueante em `offline`/`changed` de Fonte V1), contagem de execuções e link `"Ver Transcrição →"` (`#/projeto/:id/fontes/:fonteId`);
    - Layout 2 colunas (`42% / 58%` em 1366, `38% / 62%` com formulário `≤ 68 ch` em 1440+) com rolagem independente em `AreaRolagem` e regiões `F6`/`Shift+F6`;
    - Todos os 6 estados §6 (`loading` `<Esqueleto>`, `empty` sem Fontes transcritas → CTA `"Ir para Fontes e Transcrição"` `#/projeto/:id/fontes`, `empty` sem seleções na Fonte, `error` `<BannerErroCore>`, `ready`, `job_running`, `partial`).

- [ ] **Step 1: Testes falhando** (`Selecao.test.tsx`):
  - estados §6 (`loading` com `<Esqueleto>` sem mostrar lista vazia, `empty` sem Fontes transcritas com CTA `#/projeto/:id/fontes`, `empty` sem execuções na Fonte com botão que foca `"Selecionar Cortes"`, `empty` 0 candidatos, `error` `local_only_violation`/`transcript_incomplete`, `ready`, `job_running` com barra determinística e `"Cancelar seleção"`, `partial` com `budgetPause` e com `uncertain`);
  - em execução com janela `uncertain`, `"Retomar janelas pendentes"` fica desabilitado com `<Dica>` citando `#290`, e `"Resolver na Fila"` abre `<DialogoResolverIncerteza>`;
  - alternar Revisão `Rev. 1` ↔ `Rev. 2` chama `selection.get { run, revision }` e atualiza `?rev=`;
  - Fonte V1 `offline` exibe aviso não bloqueante e permite disparar seleção;
  - `core-progress` (`selection:window` / `selection:done`) atualiza progresso e habilita `"Abrir bancada de revisão"` sem `setInterval`.
- [ ] **Step 2:** `cd front-v2; bun run test src/telas/cortes/Selecao.test.tsx` → FAIL.
- [ ] **Step 3:** Implementar `AcompanhamentoSelecao.tsx`, `Selecao.tsx` e ligar rota `cortes` em `App.tsx`.
- [ ] **Step 4:** `cd front-v2; bun run test src/telas/cortes/Selecao.test.tsx` → PASS.
- [ ] **Step 5: E2E Playwright (`front-v2/e2e/cortes-selecao.spec.ts`)** em `1366×768` e `1440×900`:
  - `?estado=vazio` exibe `"Nenhuma Fonte transcrita ainda"` e CTA para `#/projeto/demo/fontes`;
  - Projeto `"demo"` pré-preenche `channel_profile.get`, compatibilidade de contexto e `<ResumoCustoPrivacidade>`;
  - alterar duração para `30–90 s` recalcula estimativa e mostra aviso > 60 s;
  - clicar `"Medir energia do áudio"` atualiza contagem via `core-progress`;
  - disparar seleção paga abre `<ConfirmDialog>` com foco em `"Cancelar"`, confirma, acompanha progresso `core-progress` até `selection:done` e habilita `"Abrir bancada de revisão"`;
  - `?estado=parcial` com `uncertain` bloqueia `"Retomar janelas pendentes"` (`#290`) e resolve via `DialogoResolverIncerteza`; alternar `Rev. 1` / `Rev. 2` atualiza `?rev=`;
  - `?estado=erro` exibe `role="alert"` em PT-BR sem stack trace; zero `pageerror` e zero scroll horizontal externo. `bunx playwright test e2e/cortes-selecao.spec.ts` → PASS.
- [ ] **Step 6:** Commit `feat(front-v2): Configurador e Acompanhamento de Seleção (#/projeto/:id/cortes)`.

---

### Tarefa 5: Lista de Candidatos e Filtros da Bancada — Coluna Esquerda C.2 (`ListaCandidatos.tsx`)

**Files:**
- Create: `front-v2/src/telas/cortes/ListaCandidatos.tsx`
- Test: `front-v2/src/telas/cortes/ListaCandidatos.test.tsx`

**Interfaces:**
- Consumes: `@ds` (`Botao`, `EstadoTela`, `ItemCorte`, `Kbd`, `ListaVirtual`, `Segmentado`, `Select`, `Slider`, `nota`).
- Produces:
  - Tipo `CandidatoLista` combinando dados de `selection.get.candidates[]` (`id`, `rank`, `title`, `total`, `chat`, `windows`, `profile`, `revision`, `adjusted`, `adjust`) + `selection.review.items[]` (`status`, `adjusted`, `startUs`, `endUs`, `startText`, `endText`, `moves`);
  - `ListaCandidatos({ candidatos, selecionadoId, aoSelecionar, filtroEstado, aoMudarFiltroEstado, notaMinima, aoMudarNotaMinima, ordenacao, aoMudarOrdenacao, aoLimparFiltros })`:
    - barra de filtros compacta (seguindo `prototipo/revisao.html?variant=A` e `C2-revisao.html`):
      - `<Segmentado>` acessível (`Todos (N)` / `Pend. (P)` / `Aprov. (A)` / `Rej. (R)`);
      - `<Slider>` **Nota mínima** (`0,0` a `10,0`, passo `0,5`, `aria-valuetext="Nota mínima X,X de 10"`);
      - `<Select>` de ordenação (`Maior Nota` | `Ordem na Fonte`);
    - `<ListaVirtual papel="listbox" ariaLabel="Candidatos a Corte">` com `tabIndex={0}` no container e `aria-activedescendant` (eliminando `tabIndex={-1}` da v1), renderizando `<ItemCorte>` enxuto (título ou `"Sem título"`, `tcLongo(startUs)`, `duracao(endUs - startUs)`, Nota tabular, ícone de decisão + marca discreta `"· ajustado"`/`chat` quando aplicável sem poluir ou quebrar a linha);
    - quando `candidatosFiltrados.length === 0` (com `candidatos.length > 0`), exibe `<EstadoTela tipo="vazio" compacto={false} titulo="Nenhum candidato corresponde aos filtros atuais" acaoPrimaria={{ rotulo: 'Limpar filtros', aoAcionar: aoLimparFiltros }} />`.

- [ ] **Step 1: Testes falhando** (`ListaCandidatos.test.tsx`):
  - `<ListaVirtual>` tem `tabIndex={0}`, `role="listbox"`, `aria-activedescendant`, e `↑`/`↓` mudam seleção e disparam `aoSelecionar`;
  - filtrar por `Aprovados` ou ajustar `Nota mínima` para `8,5` atualiza lista sem perder estado dos demais candidatos;
  - ordenar por `Ordem na Fonte` ordena por `startUs` crescente;
  - filtro que zera a lista renderiza `"Nenhum candidato corresponde aos filtros atuais"` e clicar `"Limpar filtros"` restaura `Todos` e `0,0`;
  - candidato com `title: ''` (V1) exibe `"Sem título"`.
- [ ] **Step 2:** `cd front-v2; bun run test src/telas/cortes/ListaCandidatos.test.tsx` → FAIL.
- [ ] **Step 3:** Implementar `ListaCandidatos.tsx`.
- [ ] **Step 4:** `cd front-v2; bun run test src/telas/cortes/ListaCandidatos.test.tsx` → PASS.
- [ ] **Step 5:** Commit `feat(front-v2): ListaCandidatos virtualizada e filtros da Bancada`.

---

### Tarefa 6: Detalhe do Candidato, Proxy 9:16, Nota, ±1 Frase e Guardrails — Coluna Direita C.2 (`DetalheCandidato.tsx`)

**Files:**
- Create: `front-v2/src/telas/cortes/DetalheCandidato.tsx`
- Test: `front-v2/src/telas/cortes/DetalheCandidato.test.tsx`

**Interfaces:**
- Consumes: `chamar`, `ErroCore`, `mensagemDeErro` (`~/core/cliente`, `~/core/erros`); `mediaUrl` (`@/lib/media` / `src/lib/media.ts`); `useFila` (`~/core/progresso`); `@ds` (`AjusteBorda`, `BadgeNota`, `BannerErroCore`, `Botao`, `ChecklistGuardaCorpos`, `Dica`, `EixosNota`, `Kbd`, `PlayerProxy`, `Progresso`, `SeloTipoVideo`, `Status`, `Transporte`, `duracao`, `tc`, `tcLongo`).
- Real core commands used: `proxy.request`, `proxy.status`, `proxy.map_time`, `jobs.cancel`, `selection.decide`, `selection.adjust`, `guardrails.check`, `guardrails.ack_direct_notice`, `angles.get`.
- Produces:
  - `DetalheCandidato({ projetoId, run, fonte, candidato, erroAjuste, ocupadoAjuste, aoDecidir, aoAjustar, aoAbrirEditor, aoRelocalizarFonte })`:
    - **Grade superior (`prototipo/revisao.html?variant=A` / `C2-revisao.html`):**
      - *Esquerda (`clamp(204px, 28vh, 250px)`):* `<PlayerProxy modo="previa_9_16" ... />` ligado a `mediaUrl("proxy/" + key)` quando `proxy.state === 'ready'` e `fonte.status === 'available'`; quando `proxy.state === 'queued' | 'running'`, mostra `<Progresso>` alimentado por `useFila()` + `"Cancelar preview"` (`jobs.cancel { id: job }`) mantendo Nota, bordas e decisões 100% interativos; quando `source_offline`/`source_changed` ou `component_missing` (FFmpeg), exibe fallback acionável dentro do quadro (`"Ir para Fontes e relocalizar"` / `#/config/componentes`); abaixo, `<Transporte>` (`role="toolbar"` com `Espaço`/`K` reproduzir-pausar, `J`/`L` velocidade/salto, `←`/`→` quadro/passo, ir ao início do Corte, `tc` tabular);
      - *Direita:* metadados (`<Status>` da decisão, `duracao`, `<SeloTipoVideo>`, `perfil · revisão · Janelas`), título `16 px` (`"Sem título"` se vazio), `<BadgeNota modo="detalhe">` (`Nota 8,4` + motivo em uma linha), `<EixosNota>` **recolhido por padrão** (`"Ver os 5 eixos"` ou `"Ver os 6 eixos"` com **Espaço para comentário (30%)** em 1º no `Vídeo transformado`), indicação discreta se `adjusted` na seleção (`fit`), e picos de chat (`"chat 3,1× acima do normal · risadas · 00:14:22"`);
    - **Bloco de bordas:** `<AjusteBorda>` para `Início` (`−1 Frase` `I` / `+1 Frase` `Shift+I`) e `Fim` (`−1 Frase` `O` / `+1 Frase` `Shift+O`), desabilitado conforme `moves.*`, exibindo `startText`/`endText` (`#307`) e faixa permitida (`minUs–maxUs`); erro `adjust_*` aparece inline em `role="alert"` sem perder o candidato selecionado;
    - **Barra de decisão e passagem (Regra da Luz Única):**
      - se pendente/rejeitado: `"Aprovar"` (`A`, `variante="primario"`, `aria-pressed`), `"Rejeitar"` (`R`, `aria-pressed`), e `"Abrir no editor"` (`Enter`, desabilitado com texto acessível `"Aprove este candidato para editar ou exportar"`);
      - se aprovado: `"Aprovado"` (`variante="secundario"`, `aria-pressed="true"`), `"Rejeitar"` (`R`), e `"Abrir no editor"` (`Enter`, `variante="primario"` — garantindo sempre **um único primário** na tela);
      - se `videoKind === 'direct'`: ação discreta `"Converter em Vídeo transformado"` **desabilitada** com `<Dica>` citando `#292` (`"Conversão individual para Vídeo transformado aguarda comando no núcleo (#292)."` — pode ficar junto ao `<SeloTipoVideo>` ou na faixa de opções);
    - **Faixa contextual `<ChecklistGuardaCorpos escopo="single" ... />` (visível apenas quando `status === 'approved'`):** exibe Permissão (link para `#/projeto/:id/fontes/:fonteId`), aviso > 60 s, checkbox único de ciência do Corte direto (`guardrails.ack_direct_notice`) e, se `videoKind === 'transformed'`, resultado de `angles.get` (*"Próximo passo no Editor: escolher Ângulo → aprovar Roteiro → gerar Narração na aba Transformar"* ou *"Ângulo escolhido: {selected.name}"*).

- [ ] **Step 1: Testes falhando** (`DetalheCandidato.test.tsx`):
  - `<EixosNota>` inicia recolhido (`aria-expanded="false"`); em `Vídeo transformado`, ao expandir, `Espaço para comentário` aparece em 1º lugar com `30%`;
  - durante `proxy` `queued`/`running`, `<Progresso>` e `"Cancelar preview"` (`jobs.cancel`) aparecem enquanto `Aprovar`, `Rejeitar` e `<AjusteBorda>` permanecem habilitados;
  - em `source_offline` / `component_missing`, quadro exibe CTA de recuperação e mantém Nota, bordas e decisões operacionais;
  - botões `−1 Frase` / `+1 Frase` respeitam `moves.*` e disparam `aoAjustar`; erro `adjust_too_short` aparece inline em `role="alert"`;
  - há sempre no máximo 1 botão primário na tela (`Aprovar` quando pendente → `Abrir no editor` quando aprovado);
  - quando aprovado, `<ChecklistGuardaCorpos>` renderiza e clicar no aceite chama `guardrails.ack_direct_notice`; em `Corte direto`, ação `"Converter em Vídeo transformado"` fica desabilitada com `<Dica>` citando `#292`; em `Vídeo transformado`, exibe orientação de `angles.get`.
- [ ] **Step 2:** `cd front-v2; bun run test src/telas/cortes/DetalheCandidato.test.tsx` → FAIL.
- [ ] **Step 3:** Implementar `DetalheCandidato.tsx`.
- [ ] **Step 4:** `cd front-v2; bun run test src/telas/cortes/DetalheCandidato.test.tsx` → PASS.
- [ ] **Step 5:** Commit `feat(front-v2): DetalheCandidato com PlayerProxy, Nota, ±1 Frase e Guardrails`.

---

### Tarefa 7: Orquestração da Bancada de Revisão (`Revisao.tsx`), Teclado, Rota e E2E C.2

**Files:**
- Create: `front-v2/src/telas/cortes/Revisao.tsx`
- Modify: `front-v2/src/App.tsx` (ligar rota `revisao` a `<Revisao />`)
- Test: `front-v2/src/telas/cortes/Revisao.test.tsx`, `front-v2/e2e/cortes-revisao.spec.ts`

**Interfaces:**
- Consumes: `chamar`, `ErroCore`, `mensagemDeErro`; `useFila`; `useFontesProjeto`; `useSelecaoProjeto`; `estadoForcado`, `<ComEstado>`; `useAtalhos`; `<ListaCandidatos>`; `<DetalheCandidato>`; `<SeletorPerfilRedo>`; `@ds` (`BannerErroCore`, `Botao`, `Dica`, `Esqueleto`, `EstadoTela`, `Kbd`, `SeloTipoVideo`, `Select`, `Status`, `useToast`).
- Real core commands used: `selection.get`, `selection.review`, `selection.decide`, `selection.adjust`, `selection.undo`, `selection.redo`, `sources.list`.
- Produces:
  - `<Revisao>`:
    - Guarda de rota: `:runId` inválido ou erro `run_not_found` redireciona para `#/projeto/:id/cortes` com toast explicativo (*"Esta execução de seleção não foi encontrada."*).
    - Sub-cabeçalho enxuto (`C2-revisao.html` e `prototipo/revisao.html?variant=A`): `"← Voltar à seleção"` (`#/projeto/:id/cortes?fonte=:fonteId&run=:runId&rev=:n`), título `"Execução #{id}"`, nome da Fonte, `<SeloTipoVideo>`, seletor de Revisão quando `revisions.length > 1` (atualizando `?rev=:n`), contadores `role="status"` (`"N aprovados · M rejeitados · P pendentes"`), botão `"Desfazer"` (`Ctrl/Cmd+Z`, `selection.undo`, desabilitado quando `!canUndo`, tooltip explicando escopo da execução), `"Refazer com outro Perfil…"` (`<SeletorPerfilRedo>` via `selection.redo`, `#304`), e `"Ir para Exportação (N) →"` (`#/projeto/:id/exportacao`, habilitado quando `approved > 0`).
    - Layout 2 colunas `minmax(320px, 37%) 1fr` em `1366 px` (`32% / 1fr` em `1440+ px`) sem `max-w-4xl` nem scroll externo; atualização otimista em `selection.decide` e `selection.adjust` com rollback em erro; `selection.undo` reverte última decisão/ajuste entre sessões e foca/seleciona o candidato afetado;
    - Atalhos registrados em `useAtalhos` (WCAG 2.1.4 + ignorados em inputs): `A` (aprovar), `R` (rejeitar), `I` / `Shift+I` (início −1/+1 Frase), `O` / `Shift+O` (fim −1/+1 Frase), `Enter` (abrir Corte aprovado em `#/projeto/:id/corte/:corteId/editar?run=:runId`), `Mod+Z` (desfazer), `Espaço` / `J` / `K` / `L` / `←` / `→` (transporte do `<PlayerProxy>`), `F6` / `Shift+F6` (ciclo Topo → Sub-cabeçalho → Lista → Detalhe → Barra de status);
    - Todos os 6 estados §6 (`loading` `<Esqueleto>`, `empty` 0 candidatos e filtro vazio, `error`, `ready`, `job_running` de proxy no player e redo em background no sub-cabeçalho sem travar revisão, `partial` com faixa `"Esta execução está parcial (X/Y Janelas)"` + `"Retomar na seleção"`).

- [ ] **Step 1: Testes falhando** (`Revisao.test.tsx`):
  - `:runId` inexistente (`run_not_found`) redireciona para `#/projeto/:id/cortes` com toast;
  - estados §6 (`loading`, `empty` 0 candidatos, `empty` de filtro, `error` `nothing_to_undo`/`local_only_violation`, `ready`, `job_running` redo em background + proxy gerando, `partial` com link para C.1);
  - `selection.decide` faz atualização otimista e reverte em caso de erro; `selection.undo` reverte e seleciona o candidato devolvido pelo núcleo;
  - teclado: `A` aprova, `R` rejeita, `I`/`Shift+I` e `O`/`Shift+O` ajustam bordas, `Ctrl+Z` desfaz, `Enter` navega para `#/projeto/:id/corte/:cid/editar?run=:runId` apenas quando aprovado; teclas únicas NÃO disparam quando foco está em `<input>` ou com `teclasUnicas: false` (WCAG 2.1.4);
  - trocar Revisão no seletor chama `selection.get { run, revision }` + `selection.review { run }` e atualiza `?rev=`.
- [ ] **Step 2:** `cd front-v2; bun run test src/telas/cortes/Revisao.test.tsx` → FAIL.
- [ ] **Step 3:** Implementar `Revisao.tsx` e ligar rota `revisao` em `App.tsx`.
- [ ] **Step 4:** `cd front-v2; bun run test src/telas/cortes/Revisao.test.tsx` → PASS.
- [ ] **Step 5: E2E Playwright (`front-v2/e2e/cortes-revisao.spec.ts`)** em `1366×768` e `1440×900` (cobrindo os 9 critérios de aceite da spec `C.2` §10):
  - `Tab` foca `role="listbox"` (sem `tabIndex={-1}`), `↓`/`↑` movem seleção, atualizam `aria-activedescendant` e `?corte=`;
  - filtrar por `Aprovados` / `Nota mínima 8,5` / `"Limpar filtros"`;
  - `A` aprova candidato, carrega `<ChecklistGuardaCorpos>` e habilita `"Abrir no editor"`;
  - `I`/`O` ajustam bordas mantendo foco; `Ctrl+Z` desfaz decisão;
  - execução `Vídeo transformado` mostra `Espaço para comentário` (30%) em 1º ao abrir eixos e orientação de `Transformar` após aprovar;
  - `guardrails.ack_direct_notice` em `Corte direto`;
  - `"Refazer com outro Perfil"` abre `<ConfirmDialog>` com `<ResumoCustoPrivacidade>` e foco inicial em `"Cancelar"` (e bloqueia em janela `uncertain`);
  - `Enter` em candidato aprovado navega para `#/projeto/demo/corte/:cid/editar`; zero `pageerror` e zero scroll horizontal externo. `bunx playwright test e2e/cortes-revisao.spec.ts` → PASS.
- [ ] **Step 6:** Commit `feat(front-v2): Bancada de Revisão de Cortes (#/projeto/:id/cortes/revisao/:runId)`.

---

### Tarefa 8: Fechamento da Onda 3

- [ ] **Step 1:** Em `front-v2/`: `bun run typecheck && bun run test && bunx playwright test` → 100% verde em `1366×768` e `1440×900`.
- [ ] **Step 2:** `bunx impeccable detect --json front-v2/src` → sem achados críticos (ou corrigidos antes do PR final).
- [ ] **Step 3:** Conferir aderência visual ao `DESIGN.md` e `prototipo/revisao.html?variant=A` (Regra da Luz Única, Estado Cinza, Número Tabular, eixos recolhidos por padrão) e anexar screenshots `1366×768` e `1440×900` de `#/projeto/demo/cortes` e `#/projeto/demo/cortes/revisao/1` ao PR de fechamento.

---

## Tickets

Agrupamento das 8 tarefas em **4 tickets** executáveis em PRs pequenos (após o ticket base **T1**, **T2** e **T3** têm arquivos 100% disjuntos e podem rodar em paralelo; **T4** fecha a Bancada C.2 e a verificação final da Onda 3; onde **T2** e **T4** tocam `front-v2/src/App.tsx`, fazer rebase após merge do anterior conforme `docs/agents/impedimentos.md`).

| Ticket | Título | Tarefas | Depende de | Arquivos criados / editados | Lacunas do mock TS fechadas |
|---|---|---|---|---|---|
| **T1** | `front-v2(onda 3): Mock TS, erros, store de Seleção e diálogos de Redo/Incerteza` | Tarefas 1, 2 | Onda 0 (`#315`–`#317`), Onda 1 (`#331`), Onda 2 T1, Onda 2 T2 | `src/lib/core.ts`, `src/lib/scriptMock.ts`, `front-v2/src/core/erros.ts`, `front-v2/src/stores/selecaoProjeto.ts`, `front-v2/src/componentes/SeletorPerfilRedo.tsx`, `front-v2/src/componentes/DialogoResolverIncerteza.tsx`, `front-v2/src/core/erros.test.ts`, `front-v2/src/core/selecaoMock.test.ts`, `front-v2/src/stores/selecaoProjeto.test.ts`, `front-v2/src/componentes/SeletorPerfilRedo.test.tsx`, `front-v2/src/componentes/DialogoResolverIncerteza.test.tsx` | Remove `?source-test`/`?transcript-test` de `selection.*`, `energy.*`, `chat.*`, `proxy.*` e `jobs.estimate`/`retry`/`discard`; implementa `energy.start` e `proxy.map_time`; alinha `selection.list`/`get` (`minUs`, `maxUs`, `planState`, `revision`, `revisions`, `window.profile`/`jobId`/`resetAtMs`, `budgetPause`), `selection.review` por `run`/`revision`, `chat.status` (`intervals`, `messages`), `guardrails.check` (`hasAudio`, `unverifiedCount`, `freezeTail*`), `angles.choose` (documento completo) e `angles.estimate` (`profile`); emite `core-progress` para `ai:selection:*`, `selection:window`, `selection:done`, `energy`, `chat`, `proxy` |
| **T2** | `front-v2(onda 3): Configurador e Acompanhamento de Seleção (#/projeto/:id/cortes)` | Tarefas 3, 4 | **T1**, Onda 2 T1, Onda 2 T2, Onda 2 T4 | `front-v2/src/telas/cortes/ConfiguradorSelecao.tsx`, `front-v2/src/telas/cortes/AcompanhamentoSelecao.tsx`, `front-v2/src/telas/cortes/Selecao.tsx`, `front-v2/src/App.tsx`, `front-v2/src/telas/cortes/ConfiguradorSelecao.test.tsx`, `front-v2/src/telas/cortes/Selecao.test.tsx`, `front-v2/e2e/cortes-selecao.spec.ts` | — *(consome T1)* |
| **T3** | `front-v2(onda 3): Bancada de Revisão — Lista, Filtros e Detalhe 9:16` | Tarefas 5, 6 | **T1** | `front-v2/src/telas/cortes/ListaCandidatos.tsx`, `front-v2/src/telas/cortes/DetalheCandidato.tsx`, `front-v2/src/telas/cortes/ListaCandidatos.test.tsx`, `front-v2/src/telas/cortes/DetalheCandidato.test.tsx` | — *(consome T1)* |
| **T4** | `front-v2(onda 3): Orquestração da Bancada (#/projeto/:id/cortes/revisao/:runId), Teclado e fechamento` | Tarefas 7, 8 | **T1**, **T2**, **T3** | `front-v2/src/telas/cortes/Revisao.tsx`, `front-v2/src/App.tsx`, `front-v2/src/telas/cortes/Revisao.test.tsx`, `front-v2/e2e/cortes-revisao.spec.ts` | — *(consome T1)* |

### Critérios de aceite por ticket

#### T1 — `front-v2(onda 3): Mock TS, erros, store de Seleção e diálogos de Redo/Incerteza`
- [ ] Testes unitários em `erros.test.ts` cobrindo todos os novos códigos `CoreError.code` do Pacote C (`run_not_found`, `window_uncertain`, `adjust_*`, `transcript_incomplete`, `no_sentences`, `nothing_to_undo`, `verification_failed`, etc.).
- [ ] Testes de contrato em `selecaoMock.test.ts` validando todos os comandos `selection.*`, `energy.*`, `chat.*`, `proxy.*`, `guardrails.check`, `angles.*` e `jobs.estimate`/`retry`/`discard` sem query flags ocultas e com emissão de `core-progress`.
- [ ] Testes de `selecaoProjeto.test.ts` cobrindo `resolverDestinoSelecao` (`local` / `remoto` / `cli`), invalidação por `core-progress` e limpeza integral ao fechar/trocar Projeto.
- [ ] Testes de componente em `SeletorPerfilRedo.test.tsx` e `DialogoResolverIncerteza.test.tsx` cobrindo `<ResumoCustoPrivacidade>`, `<ConfirmDialog focoInicial="cancelar">`, chamada a `selection.redo` (`#304`) e fluxo `jobs.estimate` → `jobs.retry` / `jobs.discard`.
- [ ] `bun run typecheck && bun run test` verdes no CI.

#### T2 — `front-v2(onda 3): Configurador e Acompanhamento de Seleção (#/projeto/:id/cortes)`
- [ ] Testes de componente em `ConfiguradorSelecao.test.tsx` cobrindo herança/sobrescrita de `channel_profile`, pesos da Nota (inclusive `Espaço para comentário 30%`), `guardrails.ack_direct_notice`, validação de duração e aviso `> 60 s`, `energy.start` / `chat.fetch` / `jobs.cancel`, `provider.selection_state`, `<ResumoCustoPrivacidade>` + `<ConfirmDialog>` antes de `selection.start { confirmed: true }`, e erros `context_too_small` / `local_only_violation` / `profile_unavailable`.
- [ ] Testes de componente em `Selecao.test.tsx` cobrindo todos os estados §6 (`loading`, `empty` sem Fontes transcritas / sem seleções / 0 candidatos, `error`, `ready`, `job_running`, `partial`), Fontes e execuções V1 (`offline`/`changed`), seletor de Revisão (`tablist` ≤ 5 / `<Select>` > 5), `jobs.budget.continue`, bloqueio de `"Retomar janelas pendentes"` com `<Dica>` citando `#290` quando houver janela `uncertain`, e ações por Janela.
- [ ] Fluxo Playwright em `1366×768` e `1440×900` (`front-v2/e2e/cortes-selecao.spec.ts`) verde, sem `pageerror` nem scroll horizontal.
- [ ] `bun run typecheck && bun run test && bunx playwright test e2e/cortes-selecao.spec.ts` verdes no CI.

#### T3 — `front-v2(onda 3): Bancada de Revisão — Lista, Filtros e Detalhe 9:16`
- [ ] Testes de componente em `ListaCandidatos.test.tsx` cobrindo filtros segmentados, `<Slider>` Nota mínima, ordenação (`Maior Nota` / `Ordem na Fonte`), `<ListaVirtual>` com `role="listbox"`, `tabIndex={0}`, `aria-activedescendant`, `↑`/`↓`, candidato V1 sem título (`"Sem título"`) e estado vazio de filtro (`"Limpar filtros"`).
- [ ] Testes de componente em `DetalheCandidato.test.tsx` cobrindo `<PlayerProxy>` 9:16 (progresso `core-progress` + `"Cancelar preview"` via `jobs.cancel`, fallback `source_offline`/`component_missing` mantendo revisão funcional), `<Transporte>`, `<BadgeNota>`, `<EixosNota>` recolhido por padrão e `Espaço para comentário (30%)` em 1º no `Vídeo transformado`, `<AjusteBorda>` (`±1 Frase` e erros `adjust_*` inline, nota `#307`), Regra da Luz Única (único primário por estado), `<ChecklistGuardaCorpos>` + `angles.get` e botão `"Converter em Vídeo transformado"` desabilitado com `<Dica>` citando `#292`.
- [ ] `bun run typecheck && bun run test` verdes no CI.

#### T4 — `front-v2(onda 3): Orquestração da Bancada (#/projeto/:id/cortes/revisao/:runId), Teclado e fechamento`
- [ ] Testes de componente em `Revisao.test.tsx` cobrindo guarda `:runId` (`run_not_found`), todos os estados §6 (`loading`, `empty` 0 candidatos e filtro vazio, `error`, `ready`, `job_running` de proxy e redo em background, `partial`), atualização otimista com rollback em `selection.decide`, `selection.undo` entre sessões, seletor de Revisão `?rev=:n`, `"Refazer com outro Perfil"` via `selection.redo` (`#304`), e todos os atalhos (`A`, `R`, `I`/`Shift+I`, `O`/`Shift+O`, `Enter`, `Ctrl/Cmd+Z`, `Espaço`/`J`/`K`/`L`/`←`/`→`, `F6`) respeitando campos de texto e modo WCAG 2.1.4.
- [ ] Fluxo Playwright em `1366×768` e `1440×900` (`front-v2/e2e/cortes-revisao.spec.ts`) verde cobrindo todos os 9 critérios de aceite da Tela C.2, sem `pageerror` nem scroll horizontal.
- [ ] Fechamento da Onda 3: `bunx impeccable detect --json front-v2/src` limpo, screenshots `1366×768` e `1440×900` anexados ao PR e `bun run typecheck && bun run test && bunx playwright test` verdes no CI.
