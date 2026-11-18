# Front v2 · Onda 2: Fontes e Transcrição

> **Para agentes:** SUB-SKILL OBRIGATÓRIA: `superpowers:subagent-driven-development` (recomendado) ou `superpowers:executing-plans` para executar tarefa por tarefa. Toda tarefa é TDD (`superpowers:test-driven-development`): teste falhando primeiro, depois o mínimo de código. Passos com checkbox (`- [ ]`).

**Goal:** Construir todas as telas e superfícies da Macro-etapa 1 (`Fontes e Transcrição`) do front v2 do Clipes — Lista e entrada de Fontes (arquivo local, download por URL com instalador *just-in-time*, integridade no disco, Permissão, idioma, busca global FTS5 e Fontes/Transcrições de Projetos existentes da V1), Lotes de Fontes, e Detalhe da Fonte com escolha de Motor (Local vs. Groq remoto), agrupamento de VAD (`#279`), blocos retomáveis, sinais (energia/chat), player de referência e leitor virtualizado da Transcrição — sobre a fundação da Onda 0 e os componentes compartilhados da Onda 1, com mock TS completo e testes Vitest + Playwright em `1366×768` e `1440×900`.

**Architecture:** Telas, stores e componentes em `front-v2/src/` importam primitivas/componentes de `@ds` (`design-system-v2/src/index.ts`), reutilizam `<SeletorCaminho>` e `<InstaladorJustInTime>` criados na Onda 1 (`#329`, `#330`), e falam com o núcleo exclusivamente via `chamar<T>()` (`~/core/cliente`), `mensagemDeErro()` (`~/core/erros`), `useFila()` (`~/core/progresso`), `useRota()` (`~/rotas/useRota`) e `useAtalhos()` (`~/comandos/atalhos`). O mock TS em `src/lib/core.ts` e `src/lib/batchMock.ts` deixa de exigir query flags ocultas (`?source-test=1`, `?transcript-test=1`, `?batch-test=1`, `?hardware-cpu=1`) e emite eventos simulados de `core-progress` via barramento da Onda 1. Sem alterações em `core/` nem `src-tauri/`.

**Tech Stack:** React 19, TypeScript, Tailwind 4, `@base-ui/react` 1.9.0, `@tanstack/react-virtual`, `lucide-react`, Vite; testes com Vitest + Testing Library + jsdom (unidade e componente) e `@playwright/test` contra o mock (`VITE_CORE_MOCK=1`).

**Spec:** `docs/produto/front-v2/telas/B-fontes-e-transcricao.md` (Telas 1, 2 e 3), wireframes `docs/produto/front-v2/wireframes/B1-fontes.html`, `B2-lotes.html`, `B3-fonte-transcricao.html`, `docs/produto/front-v2/01-arquitetura.md` (§3 rotas, §4 shell, §5 fila/eventos, §6 estados, §7 custo/privacidade, §8 atalhos, §9 acessibilidade, §10 estado) e `docs/produto/front-v2/02-consolidacao.md` (catálogo canônico e "Lacunas do mock TS"). Issue-mãe: #288.

## Global Constraints

Herdadas integralmente de [04-plano-implementacao.md](./04-plano-implementacao.md#global-constraints):

- Vocabulário canônico do `GLOSSARY.md` em PT-BR (Projeto, Fonte, VOD, Corte, Corte direto, Vídeo transformado, Transcrição, Frase, Lote de Fontes, Motor de transcrição, Provedor, Perfil de Provedor, Permissão, Somente local). Nunca "clipe", "short", "input", "segmento" nem "IA" como substantivo.
- Visual só pelos tokens e componentes de `design-system-v2/src/index.ts` (`@ds`); nenhuma cor fora dos tokens; laranja-sinal apenas no único botão primário da tela, marca de seleção (`marcado`), palavra falada (`sinal-texto`) e foco; estado sempre com ícone + palavra (`<Status>`), nunca selo colorido.
- Revelação progressiva: detalhes técnicos (`model`, `compute_type`, VRAM livre, código/trace de erro) ficam recolhidos em `<details>` ou `<BannerErroCore>`.
- WCAG 2.2 AA (`1366×768` sem rolagem externa da janela e verificado em `1440×900`, colunas internas com rolagem própria, alvos clicáveis ≥ 24×24 CSS px inclusive palavras curtas na Transcrição, foco `.foco`/`.foco-interno`, teclas únicas respeitando o modo WCAG 2.1.4).
- Todo comando pago ou remoto (`Groq`, `batches.create` com seleção paga ou Groq) passa por `<ResumoCustoPrivacidade>` e exige confirmação explícita (`confirmed: true`) antes de disparar.
- Toda ação que depende de ticket aberto no núcleo (#289–#307) fica **desabilitada com `<Dica>` citando o ticket** (ou segue o contorno explícito da tabela abaixo).
- Nada de mudança em `core/` ou `src-tauri/`.
- Disco: `cargo clean` (se algo tiver compilado) e limpeza de `%TEMP%\clipes-<ticket>-*` antes de cada `worker_done` (`AGENTS.md`).

### Ações dependentes de tickets abertos no núcleo (#289–#307)

| Ticket aberto | Tela / Superfície afetada | Comportamento na Onda 2 |
|---|---|---|
| **#295** (`core(sources): implementar comando sources.delete para excluir Fonte do Projeto`) | `#/projeto/:id/fontes` (cartão da Fonte) | Botão `"Excluir Fonte"` fica **desabilitado** em cada cartão da lista com `<Dica>` citando `#295` (`"Exclusão de Fonte aguarda comando sources.delete no núcleo (#295)."`). |
| **#296** (`core(jobs): enriquecer jobs.preview com chave clipes-media e sourceId`) | `#/projeto/:id/fontes/:fonteId` (referência visual) | Player de referência usa `<PlayerReferenciaFonte>` sobre `mediaUrl("source/" + fonteId)` (HTTP `206 Range`). Eventual tira de miniaturas/waveform de `jobs.preview` que exija chave opaca `clipes-media` fica desabilitada/omitida com `<Dica>` citando `#296` (`"Prévia via jobs.preview aguarda chaves opacas clipes-media (#296)."`). |
| **#301** (`core(components): adicionar entradas macOS (ffmpeg, yt-dlp, uv) no manifesto`) | `#/projeto/:id/fontes` (modo URL com `<InstaladorJustInTime recurso="url_import" />`) | Herdado da Onda 1 (`#330`): se `yt-dlp` faltar no retorno de `components.manifest` (macOS), o botão `"Instalar yt-dlp"` fica **desabilitado** com `<Dica>` citando `#301`. |
| **#302** (`core(transcription,sources): expor next_undo/next_redo e transcriptState`) | `#/projeto/:id/fontes` e `#/projeto/:id/fontes/:fonteId` | 1) Como `sources.list` ainda não traz `transcriptState`, o store do Projeto consulta `transcription.status { source_id }` sob demanda e atualiza via `core-progress`.<br>2) Em `#/projeto/:id/fontes/:fonteId`, o botão `"Desfazer"` (`Ctrl/Cmd+Z`) não prevê o alvo antes do clique: exibe tooltip genérico com nota `#302` (`"Desfaz a última correção no Projeto inteiro; prévia da Fonte afetada aguarda #302"`) e, após executar `transcription.undo`, exibe toast com link `"Ir para Fonte afetada"` se `r.source_id !== fonteId`. |
| **#307** (`core(telemetry): campos informativos extras e ID único em cópia de Fonte`) | `#/projeto/:id/fontes`, `?sub=lotes`, `#/projeto/:id/fontes/:fonteId` | 1) Por usar IDs fixos `"source-copy-original"` / `"source-copy-check"`, enquanto houver importação com `copy: true` em curso o botão `"Importar Fonte"` (com `copy` marcado) fica **desabilitado** com `<Dica>` citando `#307` (`"Aguarde a cópia em andamento concluir antes de copiar outra Fonte (#307)."`).<br>2) Em `?sub=lotes`, não há `batches.estimate` nem `percentage` em `batch:*` (`#307`): a confirmação de custo vem do erro `confirmation_required` de `batches.create`, e o progresso sincroniza via `batches.get` + jobs filhos.<br>3) Em `#/projeto/:id/fontes/:fonteId`, o total previsto de blocos é calculado no cliente (`Math.ceil(duration_us / 600_000_000)`) até `#307` expor o total no núcleo. |

## Review Focus

1. **Contrato `project` obrigatório e Projetos existentes da V1 (`sources.*`, `transcription.*`):** no núcleo Rust (`core/src/sources.rs`, `core/src/url_import.rs`, `core/src/transcription.rs`, `core/src/transcription/estimate.rs`), `sources.list`, `sources.import`, `sources.hash`, `sources.relocate`, `sources.language.set`, `sources.permission.set`, `sources.url.download`, `transcription.estimate` e `transcription.start` validam `args.project === projects.current.path` (`invalid_project` se ausente). Fontes V1 antigas podem chegar sem `full_hash` (`verified: false`), `offline` ou `changed` (disparando `confirmation_required` em `sources.hash`/`relocate`) ou com Transcrições V1 já salvas que precisam permanecer legíveis/editáveis mesmo com o arquivo de mídia ausente.
2. **Estabilidade de foco e virtualização na correção da Transcrição (`F2`/`Enter` vs. `seek`):** em `<ListaVirtual>` sobre `transcription.timeline` (paginada sob demanda em fatias de 200–500 linhas, inclusive com saltos `?frase=&row=` vindos de `transcription.search`), `F2` ou `Enter` na palavra focada entra em edição inline (`transcription.correct`) sem recalcular tempos nem desmontar o nó focado ao confirmar (`Enter`) ou cancelar (`Esc`), enquanto clique / `Ctrl+Espaço` faz `seek` no `<PlayerReferenciaFonte>` e toda palavra mantém alvo ≥ 24×24 CSS px (SC 2.5.8).
3. **Consentimento, `Somente local` e retomada parcial (`Groq`, Lotes e `engine_change_confirmation`):** tanto no detalhe da Fonte quanto em `Lotes de Fontes`, `projects.local_only` bloqueia Groq e seleções remotas sem trocar de Provedor sozinho; `batches.create` e `batches.item.resume` tratam `confirmation_required`, `transcription_retry_confirmation` e `uncertain_job` (levando à Fila `Ctrl+J`); e trocar de Motor (`local` ↔ `groq`) ou modelo em Transcrição parcial (`resume_us > 0`) intercepta `engine_change_confirmation` com `<ConfirmDialog>` exibindo `usage.blocks`, `paid_audio_us` e `paid_usd` antes de reenviar `replace_confirmed: true`.
4. **Progresso por blocos, `transcription.grouping` (`#279`) e fallback GPU → CPU:** o cartão do Motor Local nunca vaza `int8_float16` ou `handshake` fora de `<details>`, exibe o aviso obrigatório do agrupamento VAD (`#279`: ~18% mais rápido na CPU vs. ~1 GB de VRAM na GPU) com sincronização global (`transcription.grouping`), reage a `gpu_probe_fallback` em `core-progress` e preserva blocos já salvos ao cancelar via `jobs.cancel`.
5. **Reuso sem duplicação de componentes da Onda 1 e guarda de rota:** a entrada de arquivo, pasta de download URL e relocalização usam `<SeletorCaminho>` (`#329`), a instalação sob demanda de `yt-dlp`/`deno` usa `<InstaladorJustInTime recurso="url_import" />` (`#330`), e `#/projeto/:id/fontes/:fonteId` com `:fonteId` inexistente em `sources.list` redireciona para `#/projeto/:id/fontes` com alerta humano sem loop.

---

## Onda 2 · Fontes e Transcrição

**Estrutura de arquivos:**

```text
src/lib/
  core.ts                           mock TS sem portões ocultos + handlers sources.*/transcription.*/energy.*/jobs.preview + eventos core-progress
  batchMock.ts                      mock TS de batches.* sem portão oculto + emissão de eventos batch:* e jobs filhos

front-v2/
  src/
    core/
      erros.ts                      amplia TABELA_ERROS com códigos do Pacote B
    rotas/
      rotas.ts                      suporte a ?frase=&row= em #/projeto/:id/fontes/:fonteId
    stores/
      fontesProjeto.ts              store reativo de sources.list, transcriptStatusBySource (#302), batches.list e seleção para Lote
    componentes/
      CampoPermissao.tsx            seletor/editor de Permissão (none vs granted com who/where/scope)
      PlayerReferenciaFonte.tsx     player 16:9/áudio sobre mediaUrl("source/" + fonteId) com fallback de codec e estado offline/changed
    telas/fontes/
      Fontes.tsx                    #/projeto/:id/fontes (sub-abas Fontes | Lotes de Fontes, busca global Ctrl+F)
      EntradaFonte.tsx              modo Arquivo local vs URL (VOD), <InstaladorJustInTime>, pré-inspeção multipista e Permissão
      ListaFontes.tsx               lista/ListaVirtual de Fontes, integridade (V1/offline/changed), seleção para Lote e ações
      GavetaBuscaFts.tsx            resultados FTS5 agrupados/listados com <mark> e navegação ?frase=&row=
      LotesFontes.tsx               #/projeto/:id/fontes?sub=lotes (orquestração das duas colunas)
      ConstrutorLote.tsx            seleção 1–500 Fontes, Motor, Corte direto/transformado, teto USD e <ResumoCustoPrivacidade>
      ListaLotes.tsx                cartões de Lote, grid role="grid", pause/resume/cancel, item.resume e budget.continue
      DetalheFonte.tsx              #/projeto/:id/fontes/:fonteId (guarda :fonteId, cabeçalho, orquestração)
      PainelMotorSinais.tsx         Local/Groq, amostra 30 s, VAD #279, blocos 10 min e Sinais (Energia + Chat)
      LeitorTranscricao.tsx         toolbar (undo/redo Projeto, busca), <PlayerReferenciaFonte> e <ListaVirtual> editável F2/Enter
    App.tsx                         liga rotas fontes e fonte
  e2e/
    fontes.spec.ts
    lotes.spec.ts
    fonte-transcricao.spec.ts
```

---

### Tarefa 1: Extensão de erros, rotas e mock TS (`sources.*`, `transcription.*`, `energy.*`, `batches.*`)

**Files:**
- Modify: `front-v2/src/core/erros.ts` (adicionar códigos de erro do Pacote B ausentes em `TABELA_ERROS`: `js_runtime_missing`, `age_restricted`, `login_required`, `sabr_unavailable`, `download_failed`, `invalid_url`, `source_unavailable`, `probe_failed`, `invalid_source`, `copy_exists`, `transcription_busy`, `transcript_complete`, `transcript_partial`, `uncertain_job`, `transcription_uncertain`, `invalid_batch`, `invalid_budget`, `invalid_batch_state`, `invalid_item_state`, `out_of_memory`, `groq_key_missing`, `audio_too_large`, `groq_http`, `invalid_correction`, `invalid_permission`, `invalid_language`, `invalid_track`, `source_missing`, `transcript_missing`, `word_missing`, `nothing_to_undo`, `nothing_to_redo`)
- Modify: `front-v2/src/rotas/rotas.ts` (estender `{ tela: 'fonte', projeto: string; fonte: string; frase?: number; row?: number }` lendo `?frase=` e `?row=`)
- Modify: `src/lib/core.ts` (remover portões `?source-test=1`, `?transcript-test=1`, `?hardware-cpu=1`; implementar `sources.cancel`, `sources.url.cancel`, `transcription.blocks`, `transcription.sentences`, `transcription.words`, `energy.start`, `jobs.preview`; corrigir `sources.import` com IDs incrementais + `audio_track`/`copy`/`language`/`origin_url`; enriquecer `chat.status` com `intervals`/`messages`, `transcription.groq.info` com `model`/`prices`, `transcription.groq.estimate` com `kind`/`minMicroUsd`/`maxMicroUsd`/`audio_us`, `transcription.status` com `model`/`engine`, `transcription.start` com `warnings`/`language`; popular `sourceItems` padrão com Fontes realistas inclusive V1 `offline` sem `full_hash` e `changed`; emitir `core-progress` via barramento da Onda 1 para URL download, `sources.hash`/`relocate`/`import(copy)`, `transcription.estimate`, `transcription.start`, `energy.start`, `chat.fetch`)
- Modify: `src/lib/batchMock.ts` (remover portão `?source-test=1&batch-test=1`; suportar `minUs`, `maxUs`, múltiplos itens com progresso e erro `uncertain`, e emitir eventos `core-progress` simulados `batch:created`, `batch:item`, `batch:item-paused`, `batch:paused`, `batch:resumed`, `batch:cancelled`, `batch:completed`)
- Test: `front-v2/src/core/erros.test.ts`, `front-v2/src/rotas/rotas.test.ts`, `front-v2/src/core/fontesMock.test.ts`

**Interfaces:**
- Consumes: `emitirProgressoMock` (barramento criado na Onda 1 T1 em `src/lib/core.ts`), `ErroCore` (`~/core/cliente`).
- Produces:
  - `TABELA_ERROS` completa para todos os códigos de `B-fontes-e-transcricao.md` §5.
  - `resolver('#/projeto/demo/fontes/1?frase=142&row=142', { projetoAberto: 'demo' })` → `{ rota: { tela: 'fonte', projeto: 'demo', fonte: '1', frase: 142, row: 142 } }`.
  - Handlers mock em `core.ts` e `batchMock.ts` compatíveis com os payloads reais de `core/src/` (validando `project` nos comandos de `sources.*`, `transcription.estimate`, `transcription.start`, `sources.url.download`).

- [ ] **Step 1: Testes falhando** — em `erros.test.ts`, validar tradução + recuperação de `js_runtime_missing` (`instalar-componente`), `age_restricted`, `login_required`, `uncertain_job` (`abrir-fila`), `groq_key_missing` (`#/config/provedores`), `invalid_correction`, `out_of_memory`. Em `rotas.test.ts`, testar `?frase=142&row=142` na rota `fonte`. Em `fontesMock.test.ts`, chamar sem query flags ocultas: `sources.list { project }`, `sources.import` com IDs incrementais e `copy: true`, `sources.cancel`, `sources.url.cancel`, `transcription.blocks`, `transcription.sentences`, `transcription.words`, `transcription.groq.estimate` (retornando `minMicroUsd`/`maxMicroUsd`/`audio_us`), `energy.start`, `jobs.preview`, e `batches.create`/`pause`/`resume`/`cancel`.
- [ ] **Step 2:** `cd front-v2 && bun run test src/core/erros.test.ts src/rotas/rotas.test.ts src/core/fontesMock.test.ts` → FAIL.
- [ ] **Step 3:** Atualizar `erros.ts`, `rotas.ts`, `src/lib/core.ts` e `src/lib/batchMock.ts`.
- [ ] **Step 4:** `cd front-v2 && bun run test src/core/erros.test.ts src/rotas/rotas.test.ts src/core/fontesMock.test.ts` → PASS.
- [ ] **Step 5:** Commit `feat(front-v2): erros, rotas e mock TS de Fontes, Transcrição e Lotes`.

---

### Tarefa 2: Store de Fontes/Transcrições (`fontesProjeto`) e `<CampoPermissao>`

**Files:**
- Create: `front-v2/src/stores/fontesProjeto.ts`, `front-v2/src/componentes/CampoPermissao.tsx`
- Test: `front-v2/src/stores/fontesProjeto.test.ts`, `front-v2/src/componentes/CampoPermissao.test.tsx`

**Interfaces:**
- Consumes: `chamar` (`~/core/cliente`), `useFila`, `Fila` (`~/core/progresso`), `useProjetoAtual` (`~/shell/Shell`); `@ds` (`Campo`, `Entrada`, `Status`).
- Produces:
  - Store `criarStoreFontesProjeto()` + hook `useFontesProjeto(projetoPath: string | null)`:
    - mantém `fontes`, `carregando`, `erro`, `transcriptStatusBySource` (carregado sob demanda via `transcription.status { source_id }` por lacuna `#302`), `lotes` (`batches.list`), `selecionadasParaLote: number[]`, `copiaEmAndamento: boolean` (para trava `#307`), e flags de invalidação automática quando `core-progress` concluir/falhar `transcription`, `energy`, `chat`, `preview` ou emitir `batch:*`;
    - limpa integralmente o cache quando `projetoPath` mudar ou for `null` (`projects.close`);
    - ações `recarregarFontes()`, `recarregarFonte(id)`, `recarregarLotes()`, `definirSelecionadasParaLote(ids)`.
  - `<CampoPermissao valor={PermissaoFonte} aoMudar={...} somenteLeitura? obrigatorio? erro? />`:
    - `<fieldset>` + `<legend>` + `role="radiogroup"` (`"Sem permissão registrada"` `{ status: 'none' }` vs. `"Tenho permissão do criador"` `{ status: 'granted', who, where, scope }`), dica explícita em `scope`: `"Inclua 'tradução' se autorizada para traduzir legendas"`, validação de campos obrigatórios quando `granted`.

- [ ] **Step 1: Testes falhando** — `fontesProjeto.test.ts`: carrega `sources.list { project }` e preenche `transcriptStatusBySource`; evento `core-progress` `stage: 'complete'` para `transcription` invalida e recarrega `transcription.status` daquela Fonte; `projetoPath = null` limpa lista e seleção de lote; `definirSelecionadasParaLote([1, 3])` preserva seleção ao navegar para `?sub=lotes`. `CampoPermissao.test.tsx`: alternar entre `none` e `granted` mostra/oculta campos `who`, `where`, `scope`; exibe dica de `"tradução"`; modo `somenteLeitura` não altera estado.
- [ ] **Step 2:** `cd front-v2 && bun run test src/stores/fontesProjeto.test.ts src/componentes/CampoPermissao.test.tsx` → FAIL.
- [ ] **Step 3:** Implementar `fontesProjeto.ts` e `CampoPermissao.tsx`.
- [ ] **Step 4:** `cd front-v2 && bun run test src/stores/fontesProjeto.test.ts src/componentes/CampoPermissao.test.tsx` → PASS.
- [ ] **Step 5:** Commit `feat(front-v2): store de Fontes do Projeto e CampoPermissao`.

---

### Tarefa 3: Painel de Entrada de Fonte (`EntradaFonte.tsx` — Arquivo local, URL com `<InstaladorJustInTime>` e pré-inspeção)

**Files:**
- Create: `front-v2/src/telas/fontes/EntradaFonte.tsx`
- Test: `front-v2/src/telas/fontes/EntradaFonte.test.tsx`

**Interfaces:**
- Consumes: `chamar`, `ErroCore`, `mensagemDeErro` (`~/core/cliente`, `~/core/erros`); `useFila` (`~/core/progresso`); `<SeletorCaminho>` (`~/componentes/SeletorCaminho`, Onda 1 `#329`); `<InstaladorJustInTime>` (`~/componentes/InstaladorJustInTime`, Onda 1 `#330`); `<CampoPermissao>` (`~/componentes/CampoPermissao`); `@ds` (`BannerErroCore`, `Botao`, `Campo`, `Checkbox`, `ConfirmDialog`, `Dica`, `Entrada`, `Progresso`, `Segmentado`, `Select`, `Status`, `duracao`).
- Real core commands used: `sources.inspect`, `sources.import`, `sources.hash`, `sources.cancel`, `sources.url.settings.get`, `sources.url.settings.set`, `sources.url.download`, `sources.url.cancel`, `channel_profile.get`, `components.ytdlp.status`, `components.deno.status`, `components.manifest`.
- Produces:
  - `EntradaFonte({ projetoPath, copiaEmAndamento, aoImportar, aoMudarCopiaAtiva, refPrimeiroControle? })`:
    - `Segmentado` (`"Arquivo local"` | `"URL (VOD)"`);
    - **Arquivo local:** `<SeletorCaminho modo="arquivo" ... />` (extensões `mp4`, `mkv`, `mov`, `webm`, `avi`, `m4v`) disparando `sources.inspect { path }`;
    - **URL (VOD):** campo `"URL do vídeo (YouTube VOD)"`, linha com `download_dir` (`sources.url.settings.get`) + `"Trocar pasta"` (`<SeletorCaminho modo="pasta">` → `sources.url.settings.set`), botão `"Baixar por URL"`:
      - se `terms_accepted === false`, abre `<ConfirmDialog>` único de Termos do YouTube antes de `sources.url.settings.set { terms_accepted: true, download_dir }` e `sources.url.download { project: projetoPath, url, job }`;
      - se `yt-dlp` ausente (`components.ytdlp.status`) ou erro `component_missing` / `js_runtime_missing`, exibe `<InstaladorJustInTime recurso="url_import" modo="inline" />` (reaproveitando Onda 1 e sua trava `#301`);
      - durante download URL, exibe `<Progresso>` por `job` + `"Cancelar download"` (`sources.url.cancel { job }`);
      - erros `age_restricted` e `login_required` oferecem botão `"Importar arquivo local"` que alterna o `Segmentado`;
      - ao concluir download, chama `sources.inspect { path }` preenchendo `origin_url`;
    - **Pré-inspeção:** resumo (nome, duração `tabular-nums`, resolução/FPS de `metadata.streams`), `<Select>` de faixa de áudio (`codec_type === "audio"`, OBS multipista), `<Select>` de idioma falado (pré-selecionado de `channel_profile.get`), `<CampoPermissao>` obrigatório, `<Checkbox>` `"Copiar vídeo para dentro do Projeto"` (desmarcado por padrão; oculto se veio de download URL), botão primário `"Importar Fonte"` (`sources.import` seguido de `sources.hash` quando `!copy`, cancelável via `sources.cancel { job }`).
    - Se `copy: true` e `copiaEmAndamento === true`, desabilita `"Importar Fonte"` com `<Dica>` citando `#307`.

- [ ] **Step 1: Testes falhando** (`EntradaFonte.test.tsx`):
  - alternar `Arquivo local` ↔ `URL (VOD)` via `radiogroup`;
  - escolher arquivo chama `sources.inspect` e lista múltiplas faixas de áudio do OBS pré-selecionando idioma de `channel_profile.get`;
  - sem escolher/preencher `Permissão` (`granted` com campos vazios), `"Importar Fonte"` fica bloqueado;
  - no modo `URL` com `terms_accepted: false`, clicar `"Baixar por URL"` abre `<ConfirmDialog>` de Termos antes de `sources.url.settings.set` e `sources.url.download`;
  - erro `js_runtime_missing` exibe `<BannerErroCore>` e `<InstaladorJustInTime recurso="url_import" />`; erro `age_restricted` exibe botão `"Importar arquivo local"` que muda o modo;
  - cancelar download URL chama `sources.url.cancel`; com `copiaEmAndamento: true` e `copy: true`, botão `"Importar Fonte"` fica desabilitado com `<Dica>` citando `#307`.
- [ ] **Step 2:** `cd front-v2 && bun run test src/telas/fontes/EntradaFonte.test.tsx` → FAIL.
- [ ] **Step 3:** Implementar `EntradaFonte.tsx`.
- [ ] **Step 4:** `cd front-v2 && bun run test src/telas/fontes/EntradaFonte.test.tsx` → PASS.
- [ ] **Step 5:** Commit `feat(front-v2): EntradaFonte local, URL e pré-inspeção`.

---

### Tarefa 4: Lista de Fontes, Busca FTS5 e Tela `#/projeto/:id/fontes` (`Fontes.tsx`) + E2E

**Files:**
- Create: `front-v2/src/telas/fontes/ListaFontes.tsx`, `front-v2/src/telas/fontes/GavetaBuscaFts.tsx`, `front-v2/src/telas/fontes/Fontes.tsx`
- Modify: `front-v2/src/App.tsx` (ligar rota `fontes` ao `<Fontes />`)
- Test: `front-v2/src/telas/fontes/Fontes.test.tsx`, `front-v2/e2e/fontes.spec.ts`

**Interfaces:**
- Consumes: `chamar`, `ErroCore`, `mensagemDeErro`; `useAtalhos`; `estadoForcado`, `<ComEstado>`; `useFontesProjeto`; `<EntradaFonte>`; `<CampoPermissao>`; `<SeletorCaminho>`; `@ds` (`Abas`, `AreaRolagem`, `BannerErroCore`, `Botao`, `Busca`, `Checkbox`, `ConfirmDialog`, `Dica`, `Dialogo`, `Esqueleto`, `EstadoTela`, `ListaVirtual`, `Select`, `Status`, `tcLongo`, `useToast`).
- Real core commands used: `sources.list`, `sources.hash`, `sources.relocate`, `sources.cancel`, `sources.permission.set`, `sources.language.set`, `transcription.status`, `transcription.search`, `channel_profile.languages`.
- Produces:
  - Barra de subnavegação (`<Abas>` `role="tablist"`: `Fontes (N)` | `Lotes de Fontes (M)`) + `<Busca>` global FTS5 (`Ctrl/Cmd+F`, placeholder `"Buscar falas em todas as Transcrições do Projeto…"`).
  - `<ListaFontes>`:
    - faixa `partial` quando houver Fontes `offline` ou `changed` (*"N Fonte(s) precisam de verificação ou relocalização no disco..."* + filtro rápido `"Ver apenas com pendência"");
    - filtro por estado (`Todas`, `Disponíveis`, `Offline / Alteradas`, `Prontas para Cortes`) e busca local por nome;
    - checkbox `"Selecionar todas"`, contador `"N Fontes selecionadas"` e botão `"Processar N Fontes em lote"` (salva IDs no store e navega para `#/projeto/:id/fontes?sub=lotes`);
    - usa `<ListaVirtual>` (`role="listbox"`) quando `fontes.length > 30`;
    - cada cartão mostra origem (`Local` / `URL`), `<Status>` de integridade (`Disponível` / `Offline` / `Alterada`), `<Status>` da Transcrição (`transcriptStatusBySource`), idioma, Permissão (`Autorizada` / `Sem permissão`), Chat, Energia e ações:
      - `"Abrir"` / `"Ir para Cortes →"` (`#/projeto/:id/fontes/:fonteId` ou `#/projeto/:id/cortes?fonte=:id` quando pronta);
      - se `offline`: `"Relocalizar arquivo"` (abre diálogo com `<SeletorCaminho>` → `sources.relocate`; se `confirmation_required` — comum em Fontes V1 sem `full_hash` — abre `<ConfirmDialog>` antes de reenviar `confirmed: true`);
      - se `changed` ou `!verified` (Fontes V1 antigas): `"Verificar identidade"` (`sources.hash`; trata `confirmation_required` com `<ConfirmDialog>`);
      - `"Permissão"` (modal com `<CampoPermissao>` → `sources.permission.set`);
      - `"Idioma"` (visível/habilitado apenas enquanto `resume_us === 0` e sem transcrição concluída/ativa → `sources.language.set`);
      - `"Excluir Fonte"` **desabilitado** com `<Dica>` citando `#295` (`"Exclusão de Fonte aguarda comando sources.delete no núcleo (#295)."`).
  - `<GavetaBuscaFts>`: lista resultados de `transcription.search { query, limit: 50 }`, destaca tokens `match: true` em `<mark>`, e ao clicar navega para `#/projeto/:id/fontes/:fonteId?frase=:sentence_id&row=:row`.
  - Todos os estados §6 (`loading` `<Esqueleto variante="lista" />`, `empty` `"Nenhuma Fonte importada ainda"` + `"Importar primeira Fonte"`, `error` `<BannerErroCore>`, `ready`, `job_running` com barra de progresso em `sources.hash`/`relocate`/`import`, `partial` com Fontes `offline`/`changed`).

- [ ] **Step 1: Testes falhando** (`Fontes.test.tsx`):
  - estados §6 (`loading` sem mostrar `"Nenhuma Fonte importada ainda"`, `empty` com CTA `"Importar primeira Fonte"`, `error` em `role="alert"`, `ready`, `job_running`, `partial` com faixa de pendência);
  - Fonte V1 `offline` exibe `<Status>` `"Offline"`, mantém `"Abrir"` habilitado e aciona `"Relocalizar arquivo"` tratando `confirmation_required` via `<ConfirmDialog>`;
  - Fonte `changed` / `!verified` aciona `"Verificar identidade"` tratando `confirmation_required`;
  - botão `"Excluir Fonte"` está desabilitado com `<Dica>` citando `#295`;
  - selecionar 2 Fontes habilita `"Processar 2 Fontes em lote"` e navega para `?sub=lotes`;
  - `Ctrl+F` foca busca global, chama `transcription.search` e clicar no resultado navega para `#/projeto/:id/fontes/:fonteId?frase=...&row=...`;
  - `> 30` Fontes renderiza `<ListaVirtual>`.
- [ ] **Step 2:** `cd front-v2 && bun run test src/telas/fontes/Fontes.test.tsx` → FAIL.
- [ ] **Step 3:** Implementar `ListaFontes.tsx`, `GavetaBuscaFts.tsx`, `Fontes.tsx` e ligar rota `fontes` em `App.tsx`.
- [ ] **Step 4:** `cd front-v2 && bun run test src/telas/fontes` → PASS.
- [ ] **Step 5: E2E Playwright (`front-v2/e2e/fontes.spec.ts`)** em `1366×768` e `1440×900`: `?estado=vazio`, `?estado=carregando`, `?estado=erro`, importação local com pré-inspeção e Permissão, erro `js_runtime_missing` + `<InstaladorJustInTime>`, erro `age_restricted`, relocalizar Fonte `offline` V1, selecionar 2 Fontes para lote, busca `Ctrl+F` navegando para Frase, zero `pageerror` e sem scroll horizontal externo. `bunx playwright test e2e/fontes.spec.ts` → PASS.
- [ ] **Step 6:** Commit `feat(front-v2): tela Lista e Entrada de Fontes (#/projeto/:id/fontes)`.

---

### Tarefa 5: Tela Lotes de Fontes (`#/projeto/:id/fontes?sub=lotes`) + E2E

**Files:**
- Create: `front-v2/src/telas/fontes/ConstrutorLote.tsx`, `front-v2/src/telas/fontes/ListaLotes.tsx`, `front-v2/src/telas/fontes/LotesFontes.tsx`
- Modify: `front-v2/src/telas/fontes/Fontes.tsx` (renderizar `<LotesFontes />` quando `rota.sub === 'lotes'`)
- Test: `front-v2/src/telas/fontes/LotesFontes.test.tsx`, `front-v2/e2e/lotes.spec.ts`

**Interfaces:**
- Consumes: `chamar`, `ErroCore`, `mensagemDeErro`; `useFila`; `estadoForcado`, `<ComEstado>`; `useFontesProjeto`; `@ds` (`AreaRolagem`, `BannerErroCore`, `Botao`, `Campo`, `Checkbox`, `ConfirmDialog`, `Dica`, `Entrada`, `Esqueleto`, `EstadoTela`, `Progresso`, `ResumoCustoPrivacidade`, `Status`, `TabelaGrade`, `usd`).
- Real core commands used: `batches.create`, `batches.get`, `batches.list`, `batches.pause`, `batches.resume`, `batches.cancel`, `batches.item.resume`, `jobs.budget.continue`, `channel_profile.get`, `assistant.tasks`, `projects.local_only.get`.
- Produces:
  - `<ConstrutorLote>`:
    - `<fieldset>` `<legend>Fontes do lote</legend>` (`1..500`, pré-preenchido de `selecionadasParaLote`; Fontes `offline` ficam desmarcadas e desabilitadas com aviso *"Offline — não pode ser transcrita agora"*; se todas estiverem `offline`, botão iniciar fica desabilitado);
    - Motor de transcrição (`Local (US$ 0,00)` vs. `Groq (remoto)`, marcando `Bloqueado por Somente local` quando `projects.local_only` ativo);
    - Parâmetros de Seleção (`Corte direto` vs. `Vídeo transformado`, duração `minUs`/`maxUs` em segundos respeitando `limits.technicalMaxUs` de `channel_profile.get`);
    - Teto de custo opcional em USD (`maxCostMicroUsd = Math.round(usd * 1_000_000)`);
    - `<ResumoCustoPrivacidade>` resolvido de `assistant.tasks` (`selection`) + `engine` (nota `#307`: sem `batches.estimate`, o valor final de confirmação vem do `usage` de `confirmation_required` retornado por `batches.create`);
    - botão primário `"Iniciar lote com N Fontes"` → trata `confirmation_required` abrindo `<ConfirmDialog>` com `<ResumoCustoPrivacidade>` alimentado por `usage` (`selectionPaid`, `transcriptionPaid`, `audioEstimateMicroUsd`, `profile`, `maxCostMicroUsd`) antes de reenviar `confirmed: true`.
  - `<ListaLotes>`:
    - cartões por lote (`running`, `paused`, `budget_paused`, `attention`, `completed`, `cancelled`) com `<Status>`, resumo de parâmetros e gasto acumulado (`tabular-nums`);
    - controles: `"Pausar lote"` (`batches.pause`), `"Retomar lote"` (`batches.resume`), `"Cancelar lote"` (`<ConfirmDialog>` → `batches.cancel`), `"Ajustar orçamento e continuar"` em `budget_paused` (diálogo com teto USD e ciência obrigatória `confirmed: true` quando `cost_unknown` → `jobs.budget.continue { scope: "batch", key: "sources-" + id, ... }`);
    - `<TabelaGrade>` (`role="grid"`) para `items[]` com `<Progresso>` por item (`role="progressbar"` + `aria-valuetext`), causa traduzida de `item.error`, `"Retomar item"` (`batches.item.resume`, tratando `confirmation_required` / `transcription_retry_confirmation` e `uncertain_job` → botão `"Resolver na Fila de Jobs"` abrindo `Ctrl+J`), `"Abrir"` (`#/projeto/:id/fontes/:sourceId`) e `"Revisar Cortes →"` (`#/projeto/:id/cortes?fonte=:sourceId&run=:selectionRun` quando concluído).
  - Todos os estados §6 (`loading`, `empty` sem Fontes vs. sem Lotes, `error` `local_only_violation` / `profile_unavailable` / `uncertain_job` / `invalid_batch` / `invalid_budget`, `ready`, `job_running`, `partial` para `attention`/`budget_paused`).

- [ ] **Step 1: Testes falhando** (`LotesFontes.test.tsx`):
  - estados §6 (`loading`, `empty` sem Fontes com CTA `"Voltar para Fontes"`, `empty` sem Lotes com CTA `"Focar seleção de Fontes"`, `error` para `local_only_violation` e `uncertain_job`, `ready`, `job_running`, `partial` em lote `attention` e `budget_paused`);
  - Fontes `offline` ficam desabilitadas no construtor; todas `offline` desabilitam `"Iniciar lote"`;
  - `batches.create` recebendo `confirmation_required` abre `<ConfirmDialog>` com `<ResumoCustoPrivacidade>` e foco inicial em `"Cancelar"`, depois reenvia `confirmed: true`;
  - `batches.pause` alterna para `"Retomar lote"`; `batches.cancel` pede `<ConfirmDialog>`;
  - `batches.item.resume` com `uncertain_job` mostra `"Resolver na Fila de Jobs"`; `jobs.budget.continue` com `cost_unknown` exige confirmação explícita;
  - `<TabelaGrade>` navega com setas e exibe `<Progresso>` acessível por item.
- [ ] **Step 2:** `cd front-v2 && bun run test src/telas/fontes/LotesFontes.test.tsx` → FAIL.
- [ ] **Step 3:** Implementar `ConstrutorLote.tsx`, `ListaLotes.tsx`, `LotesFontes.tsx` e ligar em `Fontes.tsx`.
- [ ] **Step 4:** `cd front-v2 && bun run test src/telas/fontes/LotesFontes.test.tsx` → PASS.
- [ ] **Step 5: E2E Playwright (`front-v2/e2e/lotes.spec.ts`)** em `1366×768` e `1440×900`: `?estado=vazio` em `?sub=lotes`, criar lote pago com `<ConfirmDialog>`, erro `local_only_violation`, pausar/retomar/cancelar lote, retomar item pausado + `uncertain_job`, ajustar orçamento em `budget_paused`, zero `pageerror` e sem scroll horizontal. `bunx playwright test e2e/lotes.spec.ts` → PASS.
- [ ] **Step 6:** Commit `feat(front-v2): tela Lotes de Fontes (#/projeto/:id/fontes?sub=lotes)`.

---

### Tarefa 6: Painel de Motor, Amostra 30 s, VAD `#279`, Blocos e Sinais (`PainelMotorSinais.tsx`)

**Files:**
- Create: `front-v2/src/telas/fontes/PainelMotorSinais.tsx`
- Test: `front-v2/src/telas/fontes/PainelMotorSinais.test.tsx`

**Interfaces:**
- Consumes: `chamar`, `ErroCore`, `mensagemDeErro`; `useFila`; `@ds` (`BannerErroCore`, `Botao`, `ConfirmDialog`, `Dica`, `Progresso`, `ResumoCustoPrivacidade`, `Status`, `duracao`, `tcLongo`, `usd`).
- Real core commands used: `transcription.hardware.status`, `transcription.grouping`, `transcription.estimate`, `components.cancel`, `transcription.groq.info`, `transcription.groq.estimate`, `transcription.groq.confirm`, `transcription.start`, `transcription.status`, `transcription.blocks`, `jobs.cancel`, `energy.status`, `energy.start`, `chat.status`, `chat.fetch`.
- Produces:
  - `PainelMotorSinais({ projetoPath, fonte, transcriptStatus, aoAtualizarStatus, aoFocarMotorRef? })`:
    - **Motor Local (`US$ 0,00`):** traduz `transcription.hardware.status` (`cuda` vs. `cpu` + `fallback_reason`) em linguagem humana mantendo `model`/`compute_type`/VRAM dentro de `<details>Detalhes técnicos</details>` + link `#/config/componentes`; botão `"Medir amostra 30 s"` (`transcription.estimate { project: projetoPath, source_id, remeasure }`, cancelável com `components.cancel { id: "transcription-estimate" }`, exibindo `low_s–high_s` e avisos `low_ram`/`ram_unknown`); bloco **Agrupamento VAD (`#279`)** (`transcription.grouping` `Automático` vs. `Manual`, sincronizado globalmente no app) com texto obrigatório visível fora de `<details>`: `"No modo automático, o agrupamento fica ligado na CPU (acelera em ~18%) e desligado na GPU (evita gastar ~1 GB extra de VRAM sem ganho medido)."`;
    - **Motor Groq remoto:** consulta `transcription.groq.info` e `transcription.groq.estimate { source_id }`; se `local_only`, bloqueia com selo `"Indisponível no modo Somente local"`; exibe `<ResumoCustoPrivacidade>` (`api.groq.com`, `whisper-large-v3-turbo`, envio FLAC, faixa USD mínimo 10 s), atalho `#/config/provedores` se `!configured`, e checkbox/ação de consentimento (`transcription.groq.confirm`);
    - **Disparo / Retomada (`transcription.start`):** bloqueia se `fonte.status !== 'available'`; trata `engine_change_confirmation` com `<ConfirmDialog>` mostrando `usage.blocks`, `paid_audio_us` e `paid_usd` antes de reenviar `replace_confirmed: true`; trata `transcription_retry_confirmation` com `<ConfirmDialog>` antes de reenviar `retry_confirmed: true`;
    - **Blocos de 10 min e Progresso:** barra determinística combinando `resume_us / duration_us` e `job.progress`, total previsto calculado no cliente (`Math.ceil(duration_us / 600_000_000)` — nota `#307`), estágio legível (`probe`, `gpu_probe_fallback` com aviso persistente e recarga de hardware, `transcribing`, `complete`, `failed`), ETA no front, lista `transcription.blocks` (`GPU`/`CPU`, `compute_type` apenas em tooltip/`<details>`) e `"Pausar / Cancelar mantendo blocos salvos"` (`jobs.cancel { id }`);
    - **Sinais:** cartões de Energia (`energy.status` / `energy.start` / `jobs.cancel`) e Chat (`chat.status` / `chat.fetch` / `jobs.cancel`, ou *"Disponível apenas para lives importadas por URL do YouTube"* quando `!canFetch`).

- [ ] **Step 1: Testes falhando** (`PainelMotorSinais.test.tsx`):
  - hardware GPU/CPU sem `int8_float16` fora de `<details>`; amostra 30 s emite `transcription.estimate` e cancela com `components.cancel { id: 'transcription-estimate' }`;
  - aviso obrigatório do VAD `#279` visível e alternar para Manual chama `transcription.grouping { enabled: ... }`;
  - Groq exibe `<ResumoCustoPrivacidade>` com `api.groq.com` e bloqueia disparo quando `local_only: true`;
  - troca de Motor em transcrição parcial (`resume_us > 0`) intercepta `engine_change_confirmation` e abre `<ConfirmDialog>` antes de `replace_confirmed: true`;
  - durante `job_running`, exibe blocos salvos, reação a `gpu_probe_fallback` e `"Pausar / Cancelar mantendo blocos salvos"` chama `jobs.cancel`;
  - `energy.start` e `chat.fetch` disparam quando elegíveis e ficam bloqueados se Fonte `offline`.
- [ ] **Step 2:** `cd front-v2 && bun run test src/telas/fontes/PainelMotorSinais.test.tsx` → FAIL.
- [ ] **Step 3:** Implementar `PainelMotorSinais.tsx`.
- [ ] **Step 4:** `cd front-v2 && bun run test src/telas/fontes/PainelMotorSinais.test.tsx` → PASS.
- [ ] **Step 5:** Commit `feat(front-v2): painel de Motor, VAD #279, Blocos e Sinais`.

---

### Tarefa 7: `<PlayerReferenciaFonte>`, Leitor Virtualizado da Transcrição (`F2`/`Enter`, `undo`/`redo`, FTS5), `DetalheFonte.tsx` + E2E

**Files:**
- Create: `front-v2/src/componentes/PlayerReferenciaFonte.tsx`, `front-v2/src/telas/fontes/LeitorTranscricao.tsx`, `front-v2/src/telas/fontes/DetalheFonte.tsx`
- Modify: `front-v2/src/App.tsx` (ligar rota `fonte` ao `<DetalheFonte />`)
- Test: `front-v2/src/componentes/PlayerReferenciaFonte.test.tsx`, `front-v2/src/telas/fontes/DetalheFonte.test.tsx`, `front-v2/e2e/fonte-transcricao.spec.ts`

**Interfaces:**
- Consumes: `chamar`, `ErroCore`, `mensagemDeErro`; `mediaUrl` (`@/lib/media` / `src/lib/media.ts`); `useAtalhos`; `estadoForcado`, `<ComEstado>`; `useFontesProjeto`; `<CampoPermissao>`; `<PainelMotorSinais>`; `@ds` (`BannerErroCore`, `Botao`, `Busca`, `ConfirmDialog`, `Dica`, `Dialogo`, `Esqueleto`, `EstadoTela`, `ListaVirtual`, `Select`, `Status`, `tcLongo`, `useToast`).
- Real core commands used: `sources.list`, `sources.language.set`, `sources.permission.set`, `sources.relocate`, `sources.hash`, `transcription.status`, `transcription.segment`, `transcription.timeline`, `transcription.correct`, `transcription.undo`, `transcription.redo`, `transcription.corrections`, `transcription.search`.
- Produces:
  - `<PlayerReferenciaFonte fonteId disponivel seekUs? aoMudarTempoUs? aoPedirRelocalizacao? />`:
    - reproduz `<video>` sobre `mediaUrl("source/" + fonteId)` (HTTP `206 Range` para Fontes inteiras > 10 min);
    - degrada graciosamente se a WebView recusar o codec (ex.: MKV) exibindo aviso + áudio/fallback sem quebrar a página;
    - quando `!disponivel` (`offline` ou `changed`), não carrega mídia e mostra banner inline com botão de relocalizar/verificar;
    - não depende de `jobs.preview` com caminho absoluto (nota `#296` quando aplicável a miniaturas).
  - `<LeitorTranscricao fonteId fonteDisponivel duracaoUs scrollPara? />`:
    - barra de ferramentas: `"Desfazer"` (`Ctrl/Cmd+Z`) e `"Refazer"` (`Ctrl/Cmd+Shift+Z` / `Ctrl+Y`) com `transcription.corrections`, tooltip com nota `#302` (*"Desfaz a última correção de palavra no Projeto inteiro (pode afetar outra Fonte)"*) e toast com link `"Ir para Fonte afetada"` se `transcription.undo`/`redo` devolver `source_id !== fonteId`; busca `Ctrl/Cmd+F` com escopo `"Nesta Fonte"` | `"Todo o Projeto"` via `transcription.search`;
    - inicializa com `transcription.segment { source_id }` (inclusive para Transcrições V1 que ainda não foram segmentadas) e pagina `transcription.timeline { source_id, offset, limit: 200 }` dentro de `<ListaVirtual>`;
    - item `sentence`: timecodes `tabular-nums`, selo de idioma (`language`), palavras como controles com área mínima ≥ 24×24 CSS px (`min-w-6 min-h-6`), clique / `Ctrl+Espaço` faz `seek` para `word.start_us`; palavras `corrected: true` exibem sublinhado pontilhado + ícone + `aria-description="Palavra corrigida"` (SC 1.4.1); `F2` ou `Enter` na palavra focada abre `<input aria-label="Corrigir palavra">` inline, `Enter` chama `transcription.correct { source_id, position, text }` atualizando a palavra sem desmontar o foco, `Esc` cancela; `←`/`→` navega palavra a palavra e `Home`/`End` na Frase;
    - item `silence`: faixa hachurada (`Silêncio · X,X s`), clicável para pular no player e não editável.
  - `<DetalheFonte>`:
    - guarda de rota: se `:fonteId` não existir em `sources.list`, redireciona para `#/projeto/:id/fontes` exibindo alerta humano (*"A Fonte selecionada não foi encontrada neste Projeto."*);
    - cabeçalho: `← Fontes`, nome, duração, resolução, faixa de áudio, `<Status>` de integridade + `Relocalizar`/`Verificar`, idioma (`sources.language.set` bloqueado se já começou/concluiu), Permissão editável, CTA primário `"Selecionar Cortes →"` (`#/projeto/:id/cortes?fonte=:fonteId`) habilitado quando `transcript?.state === "complete"`;
    - todos os estados §6 (`loading` `<Esqueleto>`, `empty` pré-transcrição e busca sem resultados, `error` `<BannerErroCore>`, `ready`, `job_running`, `partial` com `resume_us > 0` e faixa `"Transcrição parcial salva até MM:SS..."` + `"Retomar de MM:SS"`).

- [ ] **Step 1: Testes falhando** (`PlayerReferenciaFonte.test.tsx`, `DetalheFonte.test.tsx`):
  - `PlayerReferenciaFonte`: quando `disponivel: true`, aponta `<video>` para `mediaUrl("source/1")` e reage a `seekUs`; quando `disponivel: false`, não renderiza mídia e mostra banner de relocalização; em erro de mídia (`onError`), mostra fallback gracioso;
  - `DetalheFonte`: `:fonteId` inexistente redireciona para `#/projeto/:id/fontes` com toast de alerta;
  - estados §6 (`loading`, `empty` pré-transcrição e busca vazia, `error` `out_of_memory`/`local_only_violation`/`invalid_correction`, `ready`, `job_running`, `partial` com `resume_us > 0`);
  - Leitor: palavra tem classe/tamanho ≥ 24×24 (`min-w-6 min-h-6`), palavra corrigida tem ícone + `aria-description`, `Silêncio` é clicável e não editável;
  - `F2` e `Enter` na palavra focada abrem `<input>` inline, `Enter` chama `transcription.correct`, `Esc` cancela mantendo foco; clique faz `seek`;
  - `Ctrl+Z` chama `transcription.undo`; se `r.source_id !== fonteId`, exibe toast com link para a outra Fonte;
  - com Fonte `offline`, player fica bloqueado mas Leitor, busca `Ctrl+F` e correção `F2` continuam funcionando (inclusive em Transcrições V1).
- [ ] **Step 2:** `cd front-v2 && bun run test src/componentes/PlayerReferenciaFonte.test.tsx src/telas/fontes/DetalheFonte.test.tsx` → FAIL.
- [ ] **Step 3:** Implementar `PlayerReferenciaFonte.tsx`, `LeitorTranscricao.tsx`, `DetalheFonte.tsx` e ligar rota `fonte` em `App.tsx`.
- [ ] **Step 4:** `cd front-v2 && bun run test src/componentes/PlayerReferenciaFonte.test.tsx src/telas/fontes/DetalheFonte.test.tsx` → PASS.
- [ ] **Step 5: E2E Playwright (`front-v2/e2e/fonte-transcricao.spec.ts`)** em `1366×768` e `1440×900`: `#/projeto/demo/fontes/999` redireciona com alerta; `?estado=vazio` exibe aviso VAD `#279`; amostra 30 s sem vazar `int8_float16`; Groq com `<ResumoCustoPrivacidade>` e bloqueio `Somente local`; `job` em curso + cancelar mantendo blocos; troca de Motor parcial com `<ConfirmDialog>`; Leitor com `Silêncio`, `F2`/`Enter` salvando correção, `Ctrl+Z` entre Fontes, busca `Ctrl+F`, e Fonte `offline` mantendo Leitor editável; zero `pageerror` e sem scroll horizontal. `bunx playwright test e2e/fonte-transcricao.spec.ts` → PASS.
- [ ] **Step 6:** Commit `feat(front-v2): Detalhe da Fonte, Player de Referência e Leitor de Transcrição (#/projeto/:id/fontes/:fonteId)`.

---

### Tarefa 8: Fechamento da Onda 2

- [ ] **Step 1:** Em `front-v2/`: `bun run typecheck && bun run test && bunx playwright test` → 100% verde em `1366×768` e `1440×900`.
- [ ] **Step 2:** `bunx impeccable detect --json front-v2/src` → sem achados críticos (ou corrigidos antes do PR final).
- [ ] **Step 3:** Salvar screenshots `1366×768` e `1440×900` de `#/projeto/demo/fontes`, `#/projeto/demo/fontes?sub=lotes` e `#/projeto/demo/fontes/1` anexados ao PR de fechamento (ou por PR de tela).

---

## Tickets

Agrupamento das 8 tarefas em **4 tickets** executáveis em PRs pequenos (arquivos disjuntos entre os fluxos de tela após o ticket base **T1**; onde tocam `front-v2/src/App.tsx` ou `Fontes.tsx`, fazer rebase após merge do anterior conforme `docs/agents/impedimentos.md`).

| Ticket | Título | Tarefas | Depende de | Arquivos criados / editados | Lacunas do mock TS fechadas |
|---|---|---|---|---|---|
| **T1** | `front-v2(onda 2): Mock TS, erros, rotas, store e CampoPermissao de Fontes e Transcrição` | Tarefas 1, 2 | Onda 0 (`#315`–`#317`), Onda 1 (`#329`, `#331`–`#333`) | `src/lib/core.ts`, `src/lib/batchMock.ts`, `front-v2/src/core/erros.ts`, `front-v2/src/rotas/rotas.ts`, `front-v2/src/stores/fontesProjeto.ts`, `front-v2/src/componentes/CampoPermissao.tsx`, `front-v2/src/core/erros.test.ts`, `front-v2/src/rotas/rotas.test.ts`, `front-v2/src/core/fontesMock.test.ts`, `front-v2/src/stores/fontesProjeto.test.ts`, `front-v2/src/componentes/CampoPermissao.test.tsx` | Remove `?source-test=1`, `?transcript-test=1`, `?batch-test=1`, `?hardware-cpu=1`; adiciona `sources.cancel`, `sources.url.cancel`, `transcription.blocks`, `transcription.sentences`, `transcription.words`, `energy.start`, `jobs.preview`; corrige `sources.import` (IDs incrementais, `audio_track`, `copy`, `language`, `origin_url`), `chat.status`, `transcription.groq.info`/`estimate`, `transcription.status`/`start`; emite `core-progress` para URL, hash/relocate/copy, estimate, start, energy, chat e `batch:*` |
| **T2** | `front-v2(onda 2): Lista e Entrada de Fontes, Busca FTS5 e Fontes V1 (#/projeto/:id/fontes)` | Tarefas 3, 4 | Onda 1 (`#329` `<SeletorCaminho>`, `#330` `<InstaladorJustInTime>`), **T1** | `front-v2/src/telas/fontes/EntradaFonte.tsx`, `ListaFontes.tsx`, `GavetaBuscaFts.tsx`, `Fontes.tsx`, `front-v2/src/App.tsx`, `front-v2/src/telas/fontes/EntradaFonte.test.tsx`, `Fontes.test.tsx`, `front-v2/e2e/fontes.spec.ts` | — *(consome T1)* |
| **T3** | `front-v2(onda 2): Lotes de Fontes (#/projeto/:id/fontes?sub=lotes)` | Tarefa 5 | **T1**, **T2** | `front-v2/src/telas/fontes/ConstrutorLote.tsx`, `ListaLotes.tsx`, `LotesFontes.tsx`, `front-v2/src/telas/fontes/Fontes.tsx`, `front-v2/src/telas/fontes/LotesFontes.test.tsx`, `front-v2/e2e/lotes.spec.ts` | — *(consome T1)* |
| **T4** | `front-v2(onda 2): Detalhe da Fonte, Motor, Blocos, Leitor de Transcrição (#/projeto/:id/fontes/:fonteId) e fechamento` | Tarefas 6, 7, 8 | **T1**, **T2** | `front-v2/src/componentes/PlayerReferenciaFonte.tsx`, `front-v2/src/telas/fontes/PainelMotorSinais.tsx`, `LeitorTranscricao.tsx`, `DetalheFonte.tsx`, `front-v2/src/App.tsx`, `front-v2/src/componentes/PlayerReferenciaFonte.test.tsx`, `front-v2/src/telas/fontes/PainelMotorSinais.test.tsx`, `DetalheFonte.test.tsx`, `front-v2/e2e/fonte-transcricao.spec.ts` | — *(consome T1)* |

### Critérios de aceite por ticket

#### T1 — `front-v2(onda 2): Mock TS, erros, rotas, store e CampoPermissao de Fontes e Transcrição`
- [ ] Testes unitários em `erros.test.ts` e `rotas.test.ts` cobrindo todos os códigos `CoreError.code` do Pacote B e parsing de `?frase=&row=` na rota `fonte`.
- [ ] Testes de contrato em `fontesMock.test.ts` validando todos os handlers `sources.*`, `transcription.*`, `energy.*`, `chat.*`, `jobs.preview` e `batches.*` sem query flags ocultas e com emissão de `core-progress`.
- [ ] Testes de `fontesProjeto.test.ts` cobrindo carregamento de `sources.list`, mapa `transcriptStatusBySource` (`#302`), invalidação por `core-progress`, limpeza ao fechar/trocar Projeto e transição de seleção para lote.
- [ ] Testes de componente em `CampoPermissao.test.tsx` cobrindo `none` vs. `granted`, dica de `"tradução"`, validação e acessibilidade (`<fieldset>`/`<legend>`/`radiogroup`).
- [ ] `bun run typecheck && bun run test` verdes no CI.

#### T2 — `front-v2(onda 2): Lista e Entrada de Fontes, Busca FTS5 e Fontes V1 (#/projeto/:id/fontes)`
- [ ] Testes de componente em `EntradaFonte.test.tsx` cobrindo alternância `Arquivo local | URL (VOD)`, `<SeletorCaminho>`, `<InstaladorJustInTime recurso="url_import" />` (inclusive trava `#301`), `<ConfirmDialog>` de Termos do YouTube, pré-inspeção multipista OBS, bloqueio de Permissão incompleta, cancelamento `sources.url.cancel` e trava de cópia simultânea com `<Dica>` citando `#307`.
- [ ] Testes de componente em `Fontes.test.tsx` cobrindo todos os estados §6 (`loading`, `empty`, `error`, `ready`, `job_running`, `partial`), Fontes V1 `offline`/`changed`/`!verified` (`sources.relocate` / `sources.hash` com `confirmation_required`), edição rápida de Permissão e Idioma, botão `"Excluir Fonte"` desabilitado com `<Dica>` citando `#295`, `<ListaVirtual>` acima de 30 itens, seleção múltipla para Lote e busca FTS5 (`Ctrl+F`) navegando para `?frase=&row=`.
- [ ] Fluxo Playwright em `1366×768` e `1440×900` (`front-v2/e2e/fontes.spec.ts`) verde, sem `pageerror` nem scroll horizontal.
- [ ] `bun run typecheck && bun run test && bunx playwright test e2e/fontes.spec.ts` verdes no CI.

#### T3 — `front-v2(onda 2): Lotes de Fontes (#/projeto/:id/fontes?sub=lotes)`
- [ ] Testes de componente em `LotesFontes.test.tsx` cobrindo todos os estados §6 (`loading`, `empty` sem Fontes e sem Lotes, `error` `local_only_violation`/`profile_unavailable`/`uncertain_job`/`invalid_batch`/`invalid_budget`, `ready`, `job_running`, `partial` `attention`/`budget_paused`), desabilitação de Fontes `offline`, `<ResumoCustoPrivacidade>`, `<ConfirmDialog>` em `batches.create` (`confirmation_required`) e `batches.cancel`, pausa/retomada de lote e item, `jobs.budget.continue` com `cost_unknown` e navegação por setas no `<TabelaGrade>` (`role="grid"`).
- [ ] Fluxo Playwright em `1366×768` e `1440×900` (`front-v2/e2e/lotes.spec.ts`) verde, sem `pageerror` nem scroll horizontal.
- [ ] `bun run typecheck && bun run test && bunx playwright test e2e/lotes.spec.ts` verdes no CI.

#### T4 — `front-v2(onda 2): Detalhe da Fonte, Motor, Blocos, Leitor de Transcrição (#/projeto/:id/fontes/:fonteId) e fechamento`
- [ ] Testes de componente em `PlayerReferenciaFonte.test.tsx` cobrindo `mediaUrl("source/" + fonteId)`, `seekUs`, fallback gracioso de codec e bloqueio com banner em Fonte `offline`/`changed` (nota `#296`).
- [ ] Testes de componente em `PainelMotorSinais.test.tsx` cobrindo Local `US$ 0,00`, ausência de `int8_float16`/`handshake` fora de `<details>`, amostra 30 s cancelável (`components.cancel`), aviso obrigatório e controle VAD `#279` (`transcription.grouping`), Groq com `<ResumoCustoPrivacidade>` e bloqueio `Somente local`, `engine_change_confirmation` com `<ConfirmDialog>`, blocos de 10 min (`transcription.blocks` + total no cliente `#307`), `jobs.cancel`, `energy.start` e `chat.fetch`.
- [ ] Testes de componente em `DetalheFonte.test.tsx` cobrindo guarda `:fonteId` inexistente, todos os estados §6 (`loading`, `empty` pré-transcrição e busca vazia, `error`, `ready`, `job_running`, `partial` com `resume_us > 0`), `<ListaVirtual>` sobre `transcription.timeline` (inclusive Transcrições V1), `Silêncio` clicável, alvos ≥ 24×24 px, `F2`/`Enter` inline (`transcription.correct`) preservando foco, `Esc`, `Ctrl+Z`/`Ctrl+Shift+Z` (nota `#302` e toast entre Fontes), busca `Ctrl+F` e edição 100% funcional em Fonte `offline`.
- [ ] Fluxo Playwright em `1366×768` e `1440×900` (`front-v2/e2e/fonte-transcricao.spec.ts`) verde, sem `pageerror` nem scroll horizontal.
- [ ] Fechamento da Onda 2: `bunx impeccable detect --json front-v2/src` limpo, screenshots `1366×768` e `1440×900` anexados ao PR e `bun run typecheck && bun run test && bunx playwright test` verdes no CI.
