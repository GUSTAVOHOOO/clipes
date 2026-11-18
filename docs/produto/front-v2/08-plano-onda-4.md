# Front v2 · Onda 4: Editor

> **Para agentes:** SUB-SKILL OBRIGATÓRIA: `superpowers:subagent-driven-development` (recomendado) ou `superpowers:executing-plans` para executar tarefa por tarefa. Toda tarefa é TDD (`superpowers:test-driven-development`): teste falhando primeiro, depois o mínimo de código. Passos com checkbox (`- [ ]`).

**Goal:** Construir o cabeçalho `<ContextoCorte>` com exportação individual (`Ctrl/Cmd+E`) e a sub-aba `Editar` (`#/projeto/:id/corte/:corteId/editar`) do front v2 do Clipes — painel esquerdo recolhível (`Ctrl/Cmd+[`) com **Transcrição do Corte** e **Índice do Corte**, palco central `9:16` / `Enquadrar na Fonte 16:9` + `<Transporte>` + `<BarraAcoes>` de 5 ações (`Enquadrar`, `Legenda`, `Silêncios`, `Áudio`, `Histórico`, `Ctrl/Cmd+]`) com popovers flutuantes (sem painel direito fixo, conforme Variante D aprovada), timeline compacta de 2 faixas com expansão `+3 faixas`, e ciclo de vida completo (`editor.open`, prévias contínuas `preview: true/false`, autosave `1 s`, `editor.flush`, diálogo de 3 ações na saída, integração com `app-close-requested` de `#291`), inclusive Cortes e edições (legendas, estilos, crop e Cortes avulsos) de Projetos existentes da V1 — sobre a fundação da Onda 0 e os contratos das Ondas 1, 2 e 3, com mock TS completo e testes Vitest + Playwright em `1366×768` e `1440×900`.

**Architecture:** Telas, stores e componentes em `front-v2/src/` importam primitivas/componentes de `@ds` (`design-system-v2/src/index.ts`), reaproveitam `<SeletorCaminho>` (`#329`) e `<InstaladorJustInTime recurso="yunet" />` (`#330`) da Onda 1, o store `fontesProjeto` da Onda 2 (`#342`) e o store `selecaoProjeto` da Onda 3 (`#348`), além da lógica pura da v1 (`src/features/editor/cropMath.ts`, `timelineMath.ts`, `duckingMath.ts` e `src/features/captions/render.ts`/`types.ts`). Falam com o núcleo exclusivamente via `chamar<T>()` (`~/core/cliente`), `mensagemDeErro()` (`~/core/erros`), `useFila()` (`~/core/progresso`), `useRota()` (`~/rotas/useRota`) e `useAtalhos()` (`~/comandos/atalhos`). O mock TS em `src/lib/core.ts`, `src/lib/editorEditsMock.ts`, `src/lib/captionsMock.ts`, `src/lib/translationMock.ts` e `src/features/export/mock.ts` remove as flags ocultas (`?source-test`, `?transcript-test`, `?editor-test`, `?crop-test`, `?montage-test`, `?duck-test`, `?narration-captions`), implementa `editor.snapshots` e `export.status`, corrige os defaults para bater com o Rust e emite eventos simulados de `core-progress` via barramento da Onda 1. Sem alterações em `core/` nem `src-tauri/`.

**Tech Stack:** React 19, TypeScript, Tailwind 4, `@base-ui/react` 1.9.0, `@tanstack/react-virtual`, `lucide-react`, Vite; testes com Vitest + Testing Library + jsdom (unidade e componente) e `@playwright/test` contra o mock (`VITE_CORE_MOCK=1`).

**Spec:** `docs/produto/front-v2/telas/D-corte-editar.md` (Superfície 1 e Tela 2), wireframes `docs/produto/front-v2/wireframes/D1-contexto-corte.html` até `D5-enquadrar-fonte.html`, protótipo `docs/produto/front-v2/wireframes/prototipo/editor.html?variant=D`, `DESIGN.md`, `design-system-v2/src/galeria/TelaEditor.tsx`, `docs/produto/front-v2/01-arquitetura.md` (§3 rotas, §4 shell, §5 fila/eventos, §6 estados, §7 custo/privacidade, §8 atalhos, §9 acessibilidade, §10 estado), `docs/produto/front-v2/02-consolidacao.md` (catálogo canônico, Questões #1, #4–#6, #23–#24 e "Lacunas do mock TS") e `docs/produto/funcionalidades/05-editor.md`. Issue-mãe: #288.

## Global Constraints

Herdadas integralmente de [04-plano-implementacao.md](./04-plano-implementacao.md#global-constraints):

- Vocabulário canônico do `GLOSSARY.md` em PT-BR (Projeto, Fonte, VOD, Corte, Corte direto, Vídeo transformado, Transformação, Narração, Roteiro, Transcrição, Frase, Reenquadramento, Layout, Tela dividida, Provedor, Perfil de Provedor, Perfil de canal, Permissão, Somente local). Nunca "clipe", "short", "input", "segmento" nem "IA" como substantivo.
- Visual só pelos tokens e componentes de `design-system-v2/src/index.ts` (`@ds`) e regras do `DESIGN.md`: **A Regra da Luz Única** (um único botão primário `sinal` por tela — `Exportar` no `<ContextoCorte>` —, agulha `sinal` de `2 px`, palavra falada em `sinal-texto`, marca de seleção `marcado` na Frase/opção/ação aberta e anel de foco `.foco`/`.foco-interno`), **A Regra do Estado Cinza** (`<Status>` e selos nunca usam pílula colorida), **A Regra do Erro Sem Fundo** (`role="alert"` via `<BannerErroCore>`), **A Regra do Número Tabular** (`num` em todo timecode, duração, contador, porcentagem, coordenada e custo) e **A Regra da Cor do Vídeo** (quadro `9:16` preto, legenda branca e palavra ativa amarela `#ffd23f` restritos ao vídeo, nunca na UI do app).
- Organização obrigatória da **Variante D** (`editor.html?variant=D`, `DESIGN.md` e `01-arquitetura.md` §1/§4): **sem painel direito fixo**. O inspetor vive nos **5 popovers flutuantes** da `<BarraAcoes>` sob o vídeo (`Enquadrar`, `Legenda`, `Silêncios`, `Áudio`, `Histórico`; `Ctrl/Cmd+]` abre/fecha o último usado); o Painel Esquerdo (`Transcrição | Índice do Corte`) é recolhível via `Ctrl/Cmd+[` (inicia aberto em `≥ 1440 px` e recolhido ou alternável em `1366×768` sem cobrir o quadro `9:16` por *hover*); a Timeline começa compacta com 2 faixas (`Vídeo` e `Áudio`) e botão `+3 faixas`.
- Revelação progressiva e WCAG 2.2 AA (`1366×768` sem rolagem da janela externa e verificado em `1440×900`; rolagem apenas interna em `AreaRolagem`/`ListaVirtual` e corpo de popover; alvos clicáveis ≥ `24×24` CSS px inclusive palavras curtas clicáveis e alças `Entrada`/`Saída`/crop; `Índice do Corte` operável 100% por teclado; teclas únicas `Espaço`/`J`/`K`/`L`/`I`/`O`/`+`/`-`/`←`/`→` respeitando o interruptor WCAG 2.1.4 e desativadas em campos de texto).
- Toda chamada paga ou remota (`translation.start`) passa por `<ResumoCustoPrivacidade>` + `<ConfirmDialog focoInicial="cancelar">` enviando `confirmed: true` antes de disparar (§7) e respeita `projects.local_only` e o escopo `tradução` da Permissão.
- Toda ação que depende de ticket aberto no núcleo (#289–#307) fica **desabilitada com `<Dica>` citando o ticket** (ou segue o contorno explícito da tabela abaixo).
- Nada de mudança em `core/` ou `src-tauri/`.
- Disco: `cargo clean` (se algo tiver compilado) e limpeza de `%TEMP%\clipes-<ticket>-*` antes de cada `worker_done` (`AGENTS.md`).

### Ações dependentes de tickets abertos no núcleo (#289–#307)

| Ticket aberto | Tela / Superfície afetada | Comportamento na Onda 4 |
|---|---|---|
| **#292** (`core(selection): converter Corte direto individual em Vídeo transformado`) | `<ContextoCorte>` (`#/projeto/:id/corte/:corteId/*`, quando `videoKind === 'direct'` e `candidateId !== null`) | O botão discreto `"Converter em Vídeo transformado"` fica **desabilitado** com `<Dica>` citando `#292` (`"Conversão individual para Vídeo transformado aguarda comando no núcleo (#292)."`), e a sub-aba `Transformar` permanece oculta/desabilitada até a conversão existir. |
| **#294** (`core(editor): implementar comando editor.snapshots.restore`) | Popover `Histórico` (`editor.snapshots`) | A lista de até 20 snapshots salvos (`clip_snapshots`) é exibida em **modo somente leitura**, e eventual ação `"Restaurar snapshot"` fica **desabilitada** com `<Dica>` citando `#294` (`"Restauração direta de snapshot aguarda comando editor.snapshots.restore no núcleo (#294)."`). |
| **#297** (`core(events): incluir clip_id em ai:translation:* e emitir evento de backup automático`) | Popover `Legenda` → sub-seção `Tradução` (`translation.start`) | Como os eventos `ai:translation:*` em `core-progress` carregam apenas `<job_id>` (sem `clip_id`), o store `editorCorte` mantém o mapa `translationJobToClip` preenchido no retorno `{ run, jobs }` de `translation.start` para atualizar apenas o Corte ativo. |
| **#302** (`core(transcription,sources): expor next_undo/next_redo e transcriptState`) | Painel Esquerdo → `Transcrição do Corte` (`transcription.undo`/`redo`) | Herdado da Onda 2: quando o foco está na Transcrição, `Ctrl/Cmd+Z` desfaz a última correção no Projeto inteiro sem prévia antecipada da Fonte afetada; o tooltip informa o escopo e cita `#302`, e se `r.source_id !== sourceId` exibe toast informando a Fonte afetada. |
| **#303** (`core(jobs,export): expor startedAtMs e alvo em jobs.list + export.settings.set`) | `<ContextoCorte>` → Diálogo de Exportação Individual (`export.settings`) | `export.settings` apenas lê `last_directory`; o caminho escolhido na sessão é enviado diretamente em `export.start { output }` (que atualiza `last_directory` no núcleo), sem botão separado de salvar pasta padrão até `#303`. |

> **Nota sobre `#289` e `#291`:** `#289` (`encoder_fallback` em `export.status`) já foi fechado no núcleo Rust — a Onda 4 exibe normalmente o `<Status tom="aviso">` de fallback para CPU (`x264`) no diálogo de exportação e cobre `?estado=fallback` no mock. `#291` (PR #346) já trata `CloseRequested` → `editor.flush` no Tauri e `app-close-requested` em `FechamentoJanela.tsx`; a Onda 4 **integra** `editor_saved` / `editor_save_failed` na Barra de Status do `Shell` e exibe o diálogo de recuperação se `editor_save_failed` chegar, **sem duplicar** o listener `app-close-requested`.

## Review Focus

1. **Ciclo de vida da sessão (`editor.open`, `preview: true/false`, autosave `1 s`, `editor.flush` e `#291`):** arrastos na timeline, sliders (`threshold_us`, `split_ratio`, `volume`, `fade`) e arrastos do retângulo de crop enviam `preview: true` sem empilhar `undo` nem marcar `dirty`; apenas `pointerup`/confirmação envia `preview: false` e registra passo na pilha `undo`. Sair de `Editar` (via `< Anterior`, `Próximo aprovado >`, troca de sub-aba, macro-etapa no topo ou `projects.close`) executa `editor.flush` antes de desmontar e, se falhar (`?estado=erro-flush`), cancela a navegação abrindo `<ConfirmDialog>` com as 3 ações obrigatórias (*"Tentar salvar novamente"*, *"Continuar editando"*, *"Sair descartando alterações não salvas"*). O evento `editor_save_failed` emitido pelo Tauri em `CloseRequested` (`#291` / PR #346) ou pelo autosave aciona o mesmo banner/diálogo na Barra de Status sem duplicar o listener `app-close-requested` de `FechamentoJanela.tsx`.
2. **Fronteira estrita entre pilhas `undo`/`redo` e ações fora do `undo`:** `Ctrl/Cmd+Z` e `Ctrl/Cmd+Shift+Z` disparam `editor.undo`/`redo` (até 100 passos em `clip_edits`), exceto quando o foco está dentro da lista/edição da `Transcrição do Corte`, quando disparam `transcription.undo`/`redo` (`#302`) — com escopo explícito no tooltip e Barra de Status. `editor.crop.set_suggested` (YuNet) **não** entra no `undo` e preserva `crop.edits` (aviso inline antes + toast depois); mutações de legenda (`captions.style.*`, `captions.override`, `captions.track.set`) e tradução (`translation.*`) gravam direto fora de `clip_edits`, com nota no rodapé do popover `Legenda` e invalidação automática de `export.captions` após `translation.edit` ou `transcription.correct` (`02-consolidacao.md` Questão #24).
3. **Fidelidade à Variante D (`editor.html?variant=D` e `DESIGN.md`) e compatibilidade com Cortes/Projetos V1 existentes:** sem painel direito fixo; palco `9:16` centralizado com `<Transporte>` + `<BarraAcoes>` de 5 ações abrindo popovers flutuantes (`Ctrl/Cmd+]`); Painel Esquerdo (`Transcrição | Índice do Corte`) recolhível (`Ctrl/Cmd+[`); Timeline compacta (`2` faixas + `+3 faixas`). Em `1366×768`, zero scroll externo na janela. Cortes V1 existentes (com `clip_edits` já salvos, `caption_styles` com `revision`, `crop` v1, ou Cortes avulsos `avulso-<sourceId>-<startId>-<endId>` e Fontes `offline`/`changed` em modo somente-leitura de texto/bordas) devem abrir sem perda de estado.
4. **Identidade `:corteId`, navegação `?run=:runId` e Exportação Individual (`Ctrl/Cmd+E`):** `:corteId` resolve para `candidateId` numérico ou token `avulso-<sourceId>-<startId>-<endId>` (ocultando/desabilitando `Transformar` e `Empacotar` em avulso e `Transformar` em `Corte direto`); `< Anterior | Próximo aprovado >` (`Alt+PageUp`/`Alt+PageDown`) usa a execução de `?run=:runId` quando presente ou todos os aprovados do Projeto; e o diálogo de exportação chama `editor.flush` (se `dirty`), `guardrails.check`, `export.captions` (`missingGlyphs`) e `export.settings` antes de `export.start`, exibindo `encoder_fallback` (`#289`) via `export.status`.
5. **Reaproveitamento da v1 e isolamento de `core-progress`:** `cropMath.ts`, `timelineMath.ts`, `duckingMath.ts` e `captions/render.ts` (`1080×1920`, `Noto Sans`/`Noto Serif`) são reutilizados sem reimplementação; `<InstaladorJustInTime recurso="yunet" />` (`#330`) e `<SeletorCaminho>` (`#329`) são reutilizados da Onda 1; e eventos `core-progress` (`proxy`, `timeline`, `reframe_*`, `ai:translation:*` via mapa `#297`, `export`, `editor_saved`/`editor_save_failed`) passam exclusivamente pelo store da Fila (`~/core/progresso`) sem `setInterval`.

---

## Onda 4 · Editor

**Estrutura de arquivos:**

```text
src/lib/
  core.ts                             remove portões ?source-test/?transcript-test/?editor-test; popula Projeto "demo" com Cortes V1/direto/transformado/avulso; emite core-progress (proxy, timeline, reframe, translation, export, editor_saved/editor_save_failed) e suporta ?estado=erro-flush|fallback|offline|parcial|carregando|vazio|erro
  editorEditsMock.ts                  remove cropTest/montageTest/duckTest; implementa editor.snapshots; alinha defaults ao Rust (soundtrack.volume=0.30, fadeInUs=0, fadeOutUs=0, sfx.volume=0.80); suporta ?estado=erro-flush
  captionsMock.ts                     isola overrides/styles/savedTracks por transcript_id e clip_id; remove ?narration-captions
  translationMock.ts                  consulta permissão real por sourceId; emite eventos core-progress ai:translation:*
src/features/export/
  mock.ts                             implementa ramo explícito export.status (com encoder_fallback / ?estado=fallback) e emite core-progress export

front-v2/
  src/
    core/
      erros.ts                        amplia TABELA_ERROS com códigos do Pacote D
      progresso.ts                    trata editor_saved / editor_save_failed fora da lista ativa de Fila e expõe sinal de salvamento do Editor
    shell/
      Shell.tsx                       slot de status de salvamento do Editor na BarraStatus + opção semPaddingConteudo para tela cheia do Editor + diálogo de recuperação em editor_save_failed (#291)
    stores/
      editorCorte.ts                  store da sessão do Corte aberto (editor.open, preview/commit, autosave/dirty, flush, mapa translationJobToClip #297, proxy/timeline/wave, undo/redo, invalidações)
    telas/corte/
      ContextoCorteConectado.tsx      <ContextoCorte> ligado a selecaoProjeto/fontesProjeto/rotas + trava #292 + guarda editor.flush
      DialogoExportarCorte.tsx        modal pré-exportação (guardrails.check, ack_direct_notice, missingGlyphs, SeletorCaminho, export.start/status/cancel, aviso encoder_fallback #289)
      PainelEsquerdoCorte.tsx         painel recolhível (Ctrl+[) com Transcrição do Corte (busca Ctrl+F, F2/Enter, undo/redo #302, silêncios, menu palavra) e Índice do Corte (<ListaVirtual> 100% teclado)
      PalcoEditor.tsx                 prévia 9:16 + Fonte 16:9 (8 alças, Topo/Base, teclado), render.ts, duckingMath.ts, overlay borda, <Transporte> e <BarraAcoes> (Ctrl+])
      popovers/
        PopoverEnquadrar.tsx          5 layouts, splitRatio, Topo/Base, <InstaladorJustInTime recurso="yunet" />, reframe.*, set_suggested fora do undo, keyframes + cut
        PopoverLegenda.tsx            remap_status, 4 faixas, 3 presets, estilo com revision/conflito, captions.override, Tradução + <ResumoCustoPrivacidade>
        PopoverSilencios.tsx          nota 120/75/200 ms, slider 300–2000 ms, resumo tabular, apply_all/revert_all, review cards "Ouvir em contexto"
        PopoverAudio.tsx              trilha 30% + ducking -12 dB, SFX 80%, biblioteca <=500 MiB (cc_by obrigatório), audio.delete (<ConfirmDialog>)
        PopoverHistorico.tsx          editor.undo/redo + Salvar agora (Ctrl+S), bloco "Fora do Desfazer", até 20 editor.snapshots somente leitura (#294)
      TimelineCorte.tsx               cabeçalho ±1 Frase, zoom, mini-mapa ±2 min, régua/agulha role="slider", 2 faixas (Vídeo/Áudio) + "+3 faixas" (Frases/Keyframes, Narração, Trilha/SFX)
      EditarCorte.tsx                 #/projeto/:id/corte/:corteId/editar (orquestração, guarda de saída 3 ações, F6 6 regiões, atalhos WCAG 2.1.4, estados §6)
    App.tsx                           liga rota corte (aba === 'editar') ao <EditarCorte /> e <ContextoCorteConectado />
  e2e/
    corte-editar.spec.ts              Playwright Superfície 1 + Tela 2 (1366×768 e 1440×900)
```

---

### Tarefa 1: Erros, eventos `editor_saved`/`editor_save_failed` no Shell (`#291`) e Mock TS completo do Editor

**Files:**
- Modify: `front-v2/src/core/erros.ts` (adicionar códigos do Pacote D em `TABELA_ERROS`: `invalid_clip`, `unknown_sentence_id`, `invalid_range`, `clip_too_long`, `adjust_empty`, `adjust_too_short`, `adjust_too_long`, `invalid_silence_threshold`, `invalid_silence_interval`, `invalid_crop`, `reframe_not_found`, `translation_permission_required`, `language_required`, `translation_missing`, `translation_empty`, `invalid_audio_kind`, `invalid_audio`, `audio_asset_missing`, `attribution_required`, `sfx_not_found`, `block_not_found`, `invalid_montage`, `proxy_not_ready`, `proxy_failed`, `export_exists`, `export_destination`, `export_glyph_missing`, `export_ass_missing`, `export_font_missing`, `export_failed`, `export_bounds`, `export_candidate`, `project_write`, `nothing_to_undo`, `nothing_to_redo`)
- Modify: `front-v2/src/core/progresso.ts` (filtrar eventos com `stage === 'editor_saved' || stage === 'editor_save_failed'` para não entrarem como jobs pendentes na Fila Global e encaminhá-los a um canal dedicado `assinarSalvamentoEditor` / `estadoSalvamentoEditor`)
- Modify: `front-v2/src/shell/Shell.tsx` (aceitar `meio`, `semPaddingConteudo?: boolean`, `statusSalvamento?: ReactNode` na `BarraStatus` exibindo `Salvo` / `Alterações pendentes…` / `Salvando…` / `Falha ao salvar` em `role="alert"`, e reagir a `editor_save_failed` — inclusive emitido por `CloseRequested` no Rust `#291`/PR #346 — sem duplicar o listener `app-close-requested` de `FechamentoJanela.tsx`)
- Modify: `src/lib/core.ts`, `src/lib/editorEditsMock.ts`, `src/lib/captionsMock.ts`, `src/lib/translationMock.ts`, `src/features/export/mock.ts` (remover portões ocultos; implementar `editor.snapshots` e `export.status`; alinhar defaults `0.30` / `0` / `0` / `0.80`; isolar `captionsMock` por `transcript_id`/`clip_id`; consultar permissão por `sourceId` em `translationMock`; emitir `core-progress` para `proxy.request`, `editor.timeline`, `reframe.start`, `translation.start`, `export.start`, `editor_saved`/`editor_save_failed`; suportar `?estado=erro-flush|fallback|offline|parcial|carregando|vazio|erro`; garantir Corte direto, Vídeo transformado, Corte V1 com edições e Corte avulso no Projeto `"demo"`)
- Test: `front-v2/src/core/erros.test.ts`, `front-v2/src/core/progresso.test.ts`, `front-v2/src/shell/Shell.test.tsx`, `front-v2/src/core/editorMock.test.ts`

**Interfaces:**
- Consumes: `emitirProgressoMock` (`src/lib/core.ts`), `ErroCore` (`~/core/cliente`), `FechamentoJanela` (`~/shell/FechamentoJanela`, `#291`/PR #346).
- Produces:
  - `TABELA_ERROS` completa para todos os códigos de `D-corte-editar.md` §5.
  - `useSalvamentoEditor()` em `progresso.ts`: `{ estado: 'ocioso' | 'salvo' | 'erro'; clipId?: number; erro?: ErroCore; limparErro(): void }` atualizado por `editor_saved` / `editor_save_failed`.
  - Mocks TS 100% aderentes a `core/src/editor/edits.rs`, `core/src/editor.rs`, `core/src/caption_style/store.rs`, `core/src/translation.rs`, `core/src/reframe.rs`, `core/src/audio.rs`, `core/src/export.rs` e `core/src/guardrails.rs`.

- [ ] **Step 1: Testes falhando** —
  - `erros.test.ts`: valida tradução + recuperação de `export_exists`, `export_destination`, `export_glyph_missing`, `export_ass_missing`, `audio_asset_missing`, `attribution_required`, `proxy_failed`, `translation_permission_required`, `project_write`, `caption_style_conflict`;
  - `progresso.test.ts`: eventos `stage: 'editor_saved'` (`job: 'editor:1'`) e `stage: 'editor_save_failed'` (`job: 'editor'`) atualizam `useSalvamentoEditor()` sem aparecer em `useFila()`;
  - `Shell.test.tsx`: `semPaddingConteudo` remove `overflow-auto p-4` do `<main>`; `editor_save_failed` exibe alerta `role="alert"` acionável na Barra de Status;
  - `editorMock.test.ts` (sem query flags ocultas): `editor.open`, `editor.sentences`, `editor.timeline`/`wave`, `editor.adjust` (`preview: true/false`), `editor.undo`/`redo`, `editor.snapshots`, `editor.flush` (e erro `project_write` em `?estado=erro-flush`), `editor.crop.*`, `reframe.start`/`status`, `captions.*` isolado por `transcript_id`, `translation.*` respeitando permissão por `sourceId`, `audio.*` com defaults `0.30`/`0`/`0`/`0.80` e `cc_by` exigindo atribuição, `export.start` + `export.status` (e `encoder_fallback` em `?estado=fallback`) emitindo `core-progress`.
- [ ] **Step 2:** `cd front-v2; bun run test src/core/erros.test.ts src/core/progresso.test.ts src/shell/Shell.test.tsx src/core/editorMock.test.ts` → FAIL.
- [ ] **Step 3:** Implementar atualizações em `erros.ts`, `progresso.ts`, `Shell.tsx` e nos arquivos mock (`core.ts`, `editorEditsMock.ts`, `captionsMock.ts`, `translationMock.ts`, `export/mock.ts`).
- [ ] **Step 4:** `cd front-v2; bun run test src/core/erros.test.ts src/core/progresso.test.ts src/shell/Shell.test.tsx src/core/editorMock.test.ts` → PASS.
- [ ] **Step 5:** Commit `feat(front-v2): erros, status de salvamento no Shell e mock TS do Editor`.

---

### Tarefa 2: Store da sessão do Editor (`editorCorte.ts`) e adaptadores puros da v1

**Files:**
- Create: `front-v2/src/stores/editorCorte.ts`
- Test: `front-v2/src/stores/editorCorte.test.ts`

**Interfaces:**
- Consumes: `chamar`, `ErroCore` (`~/core/cliente`); `useFila`, `useSalvamentoEditor` (`~/core/progresso`); módulos puros v1 (`cropMath.ts`, `timelineMath.ts`, `duckingMath.ts`, `captions/types.ts` via import relativo `../../../src/features/...` respeitando `aliasPorPacote()` do Vite).
- Real core commands used: `editor.open`, `editor.sentences`, `editor.timeline`, `editor.timeline_status`, `editor.wave`, `editor.adjust`, `editor.undo`, `editor.redo`, `editor.flush`, `editor.snapshots`, `editor.silences.*`, `editor.crop.*`, `editor.montage.set_start`, `editor.audio.*`, `audio.*`, `captions.*`, `export.captions`, `reframe.*`, `translation.*`, `proxy.request`, `proxy.status`.
- Produces:
  - `parsearCorteId(corteId: string): { kind: 'candidate'; candidateId: number } | { kind: 'avulso'; sourceId: number; startId: number; endId: number } | null`
  - `criarStoreEditorCorte()` + hook `useEditorCorte()`:
    - abre o Corte (`editor.open`) e dispara em paralelo `editor.sentences`, `export.captions`, `audio.list`, `translation.get`, `captions.remap_status` e (se Fonte disponível) `proxy.request`;
    - recarrega `editor.sentences` automaticamente quando `editor.adjust` estender bordas além da janela carregada inicialmente (`02-consolidacao.md` Avaliação Pacote D, item 4);
    - aplica atualização otimista reversível apenas em `editor.silences.toggle`, `editor.adjust` e `transcription.correct` (§10.3), mantendo estado `preview` local durante arrastos sem empilhar `undo`;
    - rastreia `dirty: boolean` e `salvando: boolean`, integrando com `useSalvamentoEditor()` (`editor_saved` limpa `dirty`; `editor_save_failed` preserva `dirty` e exibe erro);
    - `garantirSalvoParaSaida()`: chama `editor.flush` (sempre antes de desmontar `Editar` ou navegar); se falhar, retorna `{ ok: false, erro }` para a UI abrir o `<ConfirmDialog>` de 3 ações;
    - mapeia `translationJobToClip: Map<number, number>` ao chamar `translation.start` para correlacionar `core-progress` `ai:translation:*` sem `clip_id` (`#297`), e invalida `export.captions` após `translation.edit` ou `transcription.correct`;
    - mantém `modoSomenteLeituraMidia` quando Fonte está `offline` ou `changed` (texto, Índice, silêncios e bordas por Frase permanecem ativos; proxy, timeline, YuNet e exportação ficam bloqueados);
    - limpa integralmente o estado da sessão quando `:corteId` mudar ou o Projeto fechar/trocar.

- [ ] **Step 1: Testes falhando** (`editorCorte.test.ts`):
  - `parsearCorteId('12')` → `{ kind: 'candidate', candidateId: 12 }`, `parsearCorteId('avulso-2-5-9')` → `{ kind: 'avulso', sourceId: 2, startId: 5, endId: 9 }`, `'abc'` → `null`;
  - abrir Corte dispara `editor.open`, `editor.sentences`, `export.captions`, `audio.list`, `translation.get`, `captions.remap_status` e `proxy.request` (e não chama `proxy.request` quando Fonte `offline`);
  - enviar `preview: true` atualiza `previaLocal` sem incrementar `undoCount` e sem marcar `dirty`; enviar `preview: false` atualiza documento oficial e marca `dirty: true`;
  - `garantirSalvoParaSaida()` chama `editor.flush` e retorna `{ ok: false, erro }` quando `editor.flush` rejeita;
  - `translation.start` registra `job_id → clipId` (`#297`); evento `core-progress` `ai:translation:done` recarrega `translation.get` e invalida `export.captions` se faixa `Traduzida` ativa;
  - `transcription.correct` e `translation.edit` invalidam `export.captions`; `editor.adjust` além da janela carrega página faltante de `editor.sentences`.
- [ ] **Step 2:** `cd front-v2; bun run test src/stores/editorCorte.test.ts` → FAIL.
- [ ] **Step 3:** Implementar `front-v2/src/stores/editorCorte.ts`.
- [ ] **Step 4:** `cd front-v2; bun run test src/stores/editorCorte.test.ts` → PASS.
- [ ] **Step 5:** Commit `feat(front-v2): store da sessão do Editor e ciclo de vida`.

---

### Tarefa 3: `<ContextoCorteConectado>` e Diálogo de Exportação Individual (`DialogoExportarCorte.tsx`)

**Files:**
- Create: `front-v2/src/telas/corte/ContextoCorteConectado.tsx`, `front-v2/src/telas/corte/DialogoExportarCorte.tsx`
- Test: `front-v2/src/telas/corte/ContextoCorteConectado.test.tsx`, `front-v2/src/telas/corte/DialogoExportarCorte.test.tsx`

**Interfaces:**
- Consumes: `chamar`, `ErroCore`, `mensagemDeErro` (`~/core/cliente`, `~/core/erros`); `useFila` (`~/core/progresso`); `useSelecaoProjeto` (`~/stores/selecaoProjeto`, Onda 3); `useFontesProjeto` (`~/stores/fontesProjeto`, Onda 2); `<SeletorCaminho>` (`~/componentes/SeletorCaminho`, Onda 1 `#329`); `@ds` (`BannerErroCore`, `Botao`, `ChecklistGuardaCorpos`, `ConfirmDialog`, `ContextoCorte`, `Dica`, `Dialogo`, `Esqueleto`, `Progresso`, `SeloTipoVideo`, `Status`, `useToast`).
- Real core commands used: `selection.list`, `selection.get`, `selection.review`, `editor.flush`, `guardrails.check`, `guardrails.ack_direct_notice`, `export.captions`, `export.settings`, `export.start`, `export.status`, `jobs.cancel`, `sources.relocate`, `sources.hash`.
- Produces:
  - `<ContextoCorteConectado projetoId corteId subAbaAtiva runId? fonte? aoAntesDeNavegar? aoIrParaTranscricaoPalavra? />`:
    - resolve lista de Cortes aprovados usando a execução de `?run=:runId` quando presente na URL ou todos os aprovados do Projeto caso contrário (`02-consolidacao.md` Questão #5); para Corte avulso (`avulso-*`), exibe `"Corte #{corteId}"`, desabilita `< Anterior`/`Próximo aprovado >` e oculta/desabilita `Transformar` e `Empacotar`;
    - exibe `<SeloTipoVideo>` e, quando `videoKind === 'direct'` e `candidateId !== null`, botão discreto `"Converter em Vídeo transformado"` **desabilitado com `<Dica>` citando `#292`** (`"Conversão individual para Vídeo transformado aguarda comando no núcleo (#292)."`), além de `Transformar` oculta/desabilitada;
    - navegação `< Anterior` / `Próximo aprovado >` (`Alt+PageUp` / `Alt+PageDown`) e troca de sub-aba executam `aoAntesDeNavegar()` (`editor.flush` em `Editar`) antes de mudar a URL, mantendo `?run=:runId` quando presente e caindo na guarda de rota com toast se mudar para um `Corte direto` estando em `Transformar`;
    - registra atalhos `Alt+PageUp`, `Alt+PageDown` e `Mod+E` via `useAtalhos`.
  - `<DialogoExportarCorte aberto aoFechar projetoId corte fonte clipId? startId endId candidateId? aoAntesDeAbrir? aoIrParaTranscricao? aoIrParaAudio? />`:
    - antes de abrir (quando chamado de `Editar`), aguarda `aoAntesDeAbrir()` (`editor.flush`);
    - se Fonte `offline`/`changed`, exibe `<BannerErroCore>` com botão `"Relocalizar Fonte"` (`sources.relocate`) e bloqueia `export.start`;
    - carrega `guardrails.check { scope: 'single', source_id, candidate_id, clip_id, start_id, end_id }`, `export.captions` e `export.settings`, exibindo `<Esqueleto>` durante `loading`;
    - renderiza `<ChecklistGuardaCorpos escopo="single" ... />` com ciência `"Entendi o risco"` (`guardrails.ack_direct_notice`), aviso de áudio `unknown` (`unverifiedCount`), duração `> 60 s`, `longFreezeTail` e alerta de `missingGlyphs` (se não vazio, mostra lista dos glifos e botão `"Corrigir palavras na Transcrição"` antes de enfileirar);
    - campo de destino via `<SeletorCaminho modo="salvar" ... />` pré-preenchido com `last_directory` + nome sugerido `.mp4` (nota `#303`: sem `export.settings.set` separado; o valor vai direto em `export.start { output }`);
    - ao iniciar exportação (`export.start`), acompanha progresso `1%–99%` via `useFila()` (`stage === 'export'`), oferece `"Cancelar exportação"` (`jobs.cancel { id: job }`), e ao concluir (`complete`/`failed`) chama `export.status { job }`, exibindo caminho salvo e `<Status tom="aviso">` quando `encoder_fallback` estiver presente (`#289` já no núcleo).

- [ ] **Step 1: Testes falhando** —
  - `ContextoCorteConectado.test.tsx`: resolve lista de aprovados por `?run=:runId` vs Projeto inteiro; em `Corte direto` oculta/desabilita `Transformar` e exibe `"Converter em Vídeo transformado"` desabilitado com `<Dica>` `#292`; em `avulso-*` exibe `"Corte #..."` sem `Transformar`/`Empacotar`; `Alt+PageDown` e clique em `Próximo aprovado >` chamam `aoAntesDeNavegar` antes de navegar; `Ctrl+E` abre diálogo de exportação;
  - `DialogoExportarCorte.test.tsx`: `loading` (`<Esqueleto>`), `empty`/bloqueio em Fonte `offline`, `error` (`export_exists` foca campo destino, `export_destination`, `component_missing`, `audio_asset_missing`), `job_running` (progresso via `core-progress` + `"Cancelar exportação"` via `jobs.cancel`), `partial`/fallback (`encoder_fallback` em `export.status` exibe `<Status tom="aviso">`); clicar `"Entendi o risco"` chama `guardrails.ack_direct_notice`; `missingGlyphs` alerta e oferece `"Corrigir palavras na Transcrição"`; confirmar chama `export.start` com `output`.
- [ ] **Step 2:** `cd front-v2; bun run test src/telas/corte/ContextoCorteConectado.test.tsx src/telas/corte/DialogoExportarCorte.test.tsx` → FAIL.
- [ ] **Step 3:** Implementar `ContextoCorteConectado.tsx` e `DialogoExportarCorte.tsx`.
- [ ] **Step 4:** `cd front-v2; bun run test src/telas/corte/ContextoCorteConectado.test.tsx src/telas/corte/DialogoExportarCorte.test.tsx` → PASS.
- [ ] **Step 5:** Commit `feat(front-v2): ContextoCorte conectado e Diálogo de Exportação Individual`.

---

### Tarefa 4: Painel Esquerdo Recolhível — Transcrição do Corte e Índice do Corte (`PainelEsquerdoCorte.tsx`)

**Files:**
- Create: `front-v2/src/telas/corte/PainelEsquerdoCorte.tsx`
- Test: `front-v2/src/telas/corte/PainelEsquerdoCorte.test.tsx`

**Interfaces:**
- Consumes: `chamar`, `mensagemDeErro`; `useEditorCorte` (`~/stores/editorCorte`); `@ds` (`Abas`, `AreaRolagem`, `Botao`, `BotaoIcone`, `Dica`, `Entrada`, `Esqueleto`, `EstadoTela`, `LinhaFrase`, `LinhaSilencio`, `ListaVirtual`, `Menu`, `MenuItem`, `MenuSeparador`, `Status`, `tc`, `useToast`).
- Real core commands used: `editor.sentences`, `transcription.correct`, `transcription.undo`, `transcription.redo`, `transcription.corrections`, `editor.silences.toggle`, `editor.adjust`, `captions.override`, `editor.audio.sfx.add`, `editor.crop.set_edits`, `editor.montage.set_start`, `editor.audio.sfx.update`, `editor.audio.sfx.remove`.
- Produces:
  - `PainelEsquerdoCorte({ aberto, aoAlternarAberto, larguraCompacta, aoFocarLegendaOverride?, aoAbrirAbaAudio? })`:
    - quando `!aberto`: renderiza trilho recolhido de `40 px` com botão acessível `"Abrir Transcrição (Ctrl+[)"` (seguindo `editor.html?variant=D` e `D2-editar.html`, nunca abre por *hover*);
    - quando `aberto`: largura `clamp(330px, 31vw, 420px)` (e `clamp(420px, 31vw, 480px)` em `min-[1440px]`), cabeçalho com `<Abas>` `Transcrição` | `Índice do Corte` e botão recolher (`Ctrl/Cmd+[`);
    - **Visão `Transcrição`:**
      - `<Entrada>` de busca local (`Ctrl/Cmd+F`, placeholder `"Filtrar fala do Corte…"`) com contador `X/Y` e botões `Anterior`/`Próximo`; estado vazio `"Nenhuma fala com '<termo>' neste Corte."`;
      - Frases dentro do Corte em destaque normal e Frases vizinhas (antes de `start_id` e depois de `end_id` na janela `±2 min`) atenuadas (`fora={true}`) com ação rápida `"Incluir no Corte"` (`editor.adjust`);
      - barra discreta de Desfazer/Refazer correção da Transcrição (`transcription.corrections`, tooltip explicando escopo do Projeto + nota `#302`; se `r.source_id !== sourceId`, exibe toast informativo);
      - cada palavra é um controle clicável com alvo ≥ `24×24 CSS px` (`min-w-6 min-h-6`, WCAG SC 2.5.8): clique faz `seek` no palco; palavra falada sob a agulha usa `sinal-texto`; palavra com baixa confiança ou `corrected` usa sublinhado pontilhado + ícone (nunca só cor); `F2` ou `Enter` na palavra focada abre edição inline (`<input aria-label="Corrigir palavra">` que chama `transcription.correct` e mantém foco na palavra ao confirmar/`Esc`); menu contextual/botão na palavra oferece `"Definir Entrada aqui"`, `"Definir Saída aqui"`, `"Personalizar estilo da palavra"` (`captions.override` no popover `Legenda`) e `"Ancorar SFX nesta palavra"` (`editor.audio.sfx.add`);
      - silêncios inline (`<LinhaSilencio>`): texto tachado + padrão hachurado + duração + toggle `editor.silences.toggle`;
    - **Visão `Índice do Corte` (alternativa textual completa à Timeline, WCAG SC 4.1.2):**
      - filtros rápidos (`Tudo`, `Frases`, `Silêncios`, `Enquadramento`, `Narração`, `Áudio e SFX`);
      - `<ListaVirtual papel="listbox" ariaLabel="Índice do Corte">` (com `tabIndex={0}` e `aria-activedescendant`) onde cada linha mostra tipo (ícone + palavra em `Status`/texto), timecode `tabular-nums`, descrição e ações operáveis 100% por teclado: saltar agulha (`Enter`), alternar silêncio (`editor.silences.toggle`), editar/alternar `cut`/remover keyframe de crop (`editor.crop.set_edits`), mover/resetar início manual de Narração (`editor.montage.set_start` `±1 Frase` / automático) e reancorar/remover SFX (`editor.audio.sfx.update`/`remove`).

- [ ] **Step 1: Testes falhando** (`PainelEsquerdoCorte.test.tsx`):
  - alternar recolhido ↔ aberto exibe trilho `40 px` e painel sem usar *hover*;
  - `Transcrição`: Frases vizinhas atenuadas têm `"Incluir no Corte"` (`editor.adjust`); palavra sob agulha recebe classe `sinal-texto`; alvos de palavra têm `min-w-6 min-h-6`; clique faz `seek`; `F2` e `Enter` abrem edição inline, `Enter` chama `transcription.correct`, `Esc` cancela mantendo foco; `Ctrl+Z` com foco na Transcrição chama `transcription.undo` (nota `#302`); silêncio inline chama `editor.silences.toggle`;
  - busca `Ctrl+F` filtra e exibe estado `empty` quando sem ocorrência;
  - `Índice do Corte`: filtros (`Silêncios`, `Enquadramento`, `Narração`, `Áudio e SFX`) filtram itens no `<ListaVirtual role="listbox">`; acionar item salta agulha e permite alternar silêncio, alternar `cut` de keyframe, resetar Narração e remover SFX apenas por teclado.
- [ ] **Step 2:** `cd front-v2; bun run test src/telas/corte/PainelEsquerdoCorte.test.tsx` → FAIL.
- [ ] **Step 3:** Implementar `PainelEsquerdoCorte.tsx`.
- [ ] **Step 4:** `cd front-v2; bun run test src/telas/corte/PainelEsquerdoCorte.test.tsx` → PASS.
- [ ] **Step 5:** Commit `feat(front-v2): PainelEsquerdoCorte com Transcrição e Índice do Corte`.

---

### Tarefa 5: Palco Central (`PalcoEditor.tsx`), `<Transporte>` e `<BarraAcoes>` (Variante D)

**Files:**
- Create: `front-v2/src/telas/corte/PalcoEditor.tsx`
- Test: `front-v2/src/telas/corte/PalcoEditor.test.tsx`

**Interfaces:**
- Consumes: `mediaUrl` (`../../../src/lib/media`); `resolveCropPlan`, `interpolateCrop`, `clampCropRect` (`../../../src/features/editor/cropMath`); `sourceToSplicedUs`, `splicedToSourceUs`, `nextRate` (`../../../src/features/editor/timelineMath`); `computeSoundtrackGain`, `activeNarrationAt`, `activeSpeechAt` (`../../../src/features/editor/duckingMath`); `loadCaptionFonts`, `drawCaption` (`../../../src/features/captions/render`); `useEditorCorte` (`~/stores/editorCorte`); `@ds` (`BarraAcoes`, `Botao`, `Progresso`, `Segmentado`, `Status`, `Transporte`, `tc`, `tcLongo`, `type AcaoBarra`).
- Real core commands used: `proxy.request`, `proxy.status`, `jobs.cancel`, `editor.crop.set_edits`, `editor.adjust`.
- Produces:
  - `PalcoEditor({ acoesBarra, popoverAberto, aoMudarPopoverAberto, aoRelocalizarFonte, aoSolicitarFocoRef? })`:
    - alternador no topo do palco: `<Segmentado>` `Prévia 9:16` | `Enquadrar na Fonte 16:9` (com seletor de painel `Topo` | `Base` visível quando layout for `gameplay_webcam` ou `two_people`);
    - **Modo `Prévia 9:16`:** quadro preto `aspect-[9/16]` ocupando a altura disponível (`h-full min-h-0`, mantendo folga para `<Transporte>` + `<BarraAcoes>` em `1366×768`), reproduzindo `<video>` via `mediaUrl("proxy/" + proxyKey)` sincronizado ao `SpliceMap` (pulando silêncios `active`), aplicando crop interpolado (`cropMath.ts`) para os 5 layouts (`fit`, `face`, `gameplay_webcam`, `two_people`, `fullscreen_roi`), desenhando legendas ao vivo em camada `1080×1920` escalada (`render.ts`) e mixando Narração + trilha + SFX com ducking `-12 dB` (`duckingMath.ts`) via Web Audio / elementos de áudio;
    - **Modo `Enquadrar na Fonte 16:9` (`D5-enquadrar-fonte.html`):** quadro `16:9` mostrando o vídeo da Fonte/proxy com máscara escurecida fora da seleção e retângulo(s) de crop ativo (`Topo`/`Base` em layouts duplos), 8 alças de redimensionamento (`≥ 24×24` px de alvo) + alça central de arrasto enviando `editor.crop.set_edits` (`preview: true` no arrasto, `preview: false` ao soltar), e operação 100% por teclado nas alças/retângulo (`Setas` move, `Shift+Setas` passo fino/largo, `PageUp`/`PageDown` zoom do retângulo, `Tab` entre painel `Topo`/`Base`);
    - **Overlay de borda ao vivo:** quando `overlayBorda !== null` (arrasto de `Entrada` ou `Saída` na timeline), exibe quadro exato da borda com badge `tabular-nums`: timecode na Fonte + selo `"Encaixe em Frase"` ou `"Livre por quadro (Alt)"`;
    - **Estados no quadro:**
      - `Fonte offline/changed`: quadro exibe aviso e botão `"Relocalizar arquivo"` (`aoRelocalizarFonte`) sem tentar carregar `<video>`;
      - `proxy` `queued`/`running`: exibe `<Progresso>` alimentado por `useFila()` + botão `"Cancelar"` (`jobs.cancel { id: proxyJob }`);
      - `proxy_failed`: `<BannerErroCore>` com botão `"Tentar novamente"` (`proxy.request`);
    - **Linha de controles sob o vídeo (`editor.html?variant=D`):** `<Transporte>` (ir para Entrada, Reproduzir/Pausar `Espaço`/`K`, ir para Saída, timecode `tabular-nums`, `I`, `O`, mudo) + `<BarraAcoes>` (`Enquadrar`, `Legenda`, `Silêncios`, `Áudio`, `Histórico`, `Ctrl/Cmd+]`, ancorando os popovers flutuantes ao lado do quadro `refQuadro`).

- [ ] **Step 1: Testes falhando** (`PalcoEditor.test.tsx`):
  - `Prévia 9:16` renderiza camada de legenda via `render.ts` / `CaptionData`, alterna para `Enquadrar na Fonte 16:9` exibindo retângulo de crop com 8 alças e seletor `Topo`/`Base` em `gameplay_webcam`;
  - mover retângulo no modo `Fonte 16:9` por ponteiro ou setas de teclado chama `editor.crop.set_edits` (`preview: true` durante movimento, `preview: false` ao finalizar);
  - `overlayBorda` exibe timecode na Fonte e selo `"Encaixe em Frase"` vs `"Livre por quadro (Alt)"`;
  - `Fonte offline` bloqueia `<video>` e exibe `"Relocalizar arquivo"`; `proxy` `running` exibe `<Progresso>` e `"Cancelar"` (`jobs.cancel`);
  - `<Transporte>` e `<BarraAcoes>` ficam na mesma faixa, abrem um popover de cada vez ao lado do quadro e `Ctrl+]` alterna o último popover aberto.
- [ ] **Step 2:** `cd front-v2; bun run test src/telas/corte/PalcoEditor.test.tsx` → FAIL.
- [ ] **Step 3:** Implementar `PalcoEditor.tsx`.
- [ ] **Step 4:** `cd front-v2; bun run test src/telas/corte/PalcoEditor.test.tsx` → PASS.
- [ ] **Step 5:** Commit `feat(front-v2): PalcoEditor 9:16/16:9, Transporte e BarraAcoes`.

---

### Tarefa 6: Popovers 1 e 2 da `BarraAcoes` (`PopoverEnquadrar.tsx` e `PopoverLegenda.tsx`)

**Files:**
- Create: `front-v2/src/telas/corte/popovers/PopoverEnquadrar.tsx`, `front-v2/src/telas/corte/popovers/PopoverLegenda.tsx`
- Test: `front-v2/src/telas/corte/popovers/PopoverEnquadrar.test.tsx`, `front-v2/src/telas/corte/popovers/PopoverLegenda.test.tsx`

**Interfaces:**
- Consumes: `chamar`, `ErroCore`, `mensagemDeErro`; `useFila`; `useEditorCorte` (`~/stores/editorCorte`); `useFontesProjeto` (`~/stores/fontesProjeto`); `<InstaladorJustInTime recurso="yunet" />` (`~/componentes/InstaladorJustInTime`, Onda 1 `#330`); `resolverDestinoSelecao` (`~/stores/selecaoProjeto`, Onda 3) ou resolução direta via `provider.profiles.list` + `assistant.tasks` + `jobs.budget.get`; `@ds` (`BannerErroCore`, `Botao`, `ConfirmDialog`, `Dica`, `Entrada`, `GradeOpcoes`, `GrupoAjuste`, `Progresso`, `ResumoCustoPrivacidade`, `Segmentado`, `Select`, `Slider`, `Status`, `Switch`, `useToast`).
- Real core commands used:
  - `PopoverEnquadrar`: `editor.crop.set_layout`, `editor.crop.set_suggested`, `editor.crop.set_edits`, `reframe.start`, `reframe.status`, `jobs.cancel`, `components.worker.status`, `components.models.manifest`.
  - `PopoverLegenda`: `captions.remap_status`, `captions.track.set`, `captions.style.preset`, `captions.style.set`, `captions.style.default`, `captions.override`, `export.captions`, `translation.get`, `translation.estimate`, `translation.start`, `translation.track.set`, `translation.edit`, `provider.profiles.list`, `assistant.tasks`, `jobs.budget.get`, `projects.local_only.get`.
- Produces:
  - **`PopoverEnquadrar` (`D3-inspetor.html` Aba 1):**
    - `<GradeOpcoes>` dos 5 layouts (`face`, `fit`, `gameplay_webcam`, `two_people`, `fullscreen_roi`); em `fit`, exibe nota explicativa de barras laterais/superiores;
    - em `gameplay_webcam` (`0.20..0.50`, padrão `0.30`) e `two_people` (`0.30..0.70`, padrão `0.50`): `<Slider>` `Proporção vertical` (`editor.crop.set_layout` com `preview: true/false`), `<Segmentado>` `Painel ativo` (`Topo` | `Base`) e nota de que em `gameplay_webcam` o retângulo manual da webcam é o caminho principal;
    - **YuNet *just-in-time*:** para `face`/`gameplay_webcam`/`two_people`, se `worker` ou `yunet` faltar (ou Fonte disponível mas `worker_missing`/`model_missing`), embute `<InstaladorJustInTime recurso="yunet" modo="inline" />`; com Fonte `offline`, desabilita `reframe.start` com explicação; durante `reframe.start`, acompanha `core-progress` (`reframe_proxy`, `reframe_scenes`, `reframe_faces`) + `reframe.status` + `"Cancelar"` (`jobs.cancel`); ao concluir, mostra confiança (e nota `0,10–0,65` em `gameplay_webcam`) + aviso inline antes de **"Aplicar sugestão automática"** (`editor.crop.set_suggested { reframe_id }`: *"Substitui apenas a sugestão automática; suas correções manuais serão mantidas. Esta ação não entra no Desfazer."*) + toast ao aplicar;
    - **Keyframes manuais (`edits`):** lista com `timeUs`, coordenadas numéricas `x/y/w/h` editáveis por teclado, toggle `Corte seco (cut)`, botões `Adicionar/Atualizar na agulha`, `Remover` e botão perigo **"Limpar todas as edições manuais"** protegido por `<ConfirmDialog focoInicial="cancelar">`.
  - **`PopoverLegenda` (`D3-inspetor.html` Aba 2):**
    - se `captions.remap_status().discarded > 0`, faixa `<Status tom="aviso">` não bloqueante;
    - seletor de faixa (`Automático`, `Original`, `Traduzida`, e `Narração` apenas em `Vídeo transformado`);
    - 3 presets (`Vertical`, `Cinema`, `Simples` → `captions.style.preset`, preservando `overrides`) + personalização (`Noto Sans`/`Noto Serif`, tamanho `24..96`, cores, contorno `0..10`, sombra `0..10`, `X` `80..1000`, `Y` `192..1600`, karaokê, `"Usar como padrão do Projeto"` `captions.style.default`); trata `caption_style_conflict` exibindo faixa com `"Recarregar estilo"`;
    - alertas de `emojiRemoved` e `missingGlyphs` (com link para editar palavra na Transcrição);
    - controle de destaque da palavra selecionada (`captions.override`: cor, cor ativa, destaque, ocultar, `"Limpar destaque"`);
    - sub-seção **Tradução (`PT-BR ↔ EN`)**: se `!permitted`, `<Status tom="aviso">` com link para Permissão da Fonte (`#/projeto/:id/fontes/:fonteId`); se `permitted`, seletor de idioma (quando `languageRequired`), `"Calcular tradução"` (`translation.estimate`) → `<ResumoCustoPrivacidade>` + `<ConfirmDialog focoInicial="cancelar">` se pago/CLI → `"Traduzir Corte"` (`translation.start { confirmed: true }`), progresso via mapa `jobId → clipId` (`#297`), estado `partial` e lista editável por Frase (`translation.edit`, invalidando `export.captions`);
    - nota fixa no rodapé: *"Estilo, destaques e tradução são salvos automaticamente fora do Desfazer da timeline."*

- [ ] **Step 1: Testes falhando** —
  - `PopoverEnquadrar.test.tsx`: troca dos 5 layouts chama `editor.crop.set_layout`; `fit` exibe mensagem educativa; `gameplay_webcam` exibe slider `0.20–0.50` (`preview: true/false`) e `Topo`/`Base`; quando `yunet` ausente, renderiza `<InstaladorJustInTime recurso="yunet" />`; após `reframe.start`, aplicar sugestão exibe aviso de que não entra no `undo` e preserva `crop.edits`; `"Limpar todas as edições manuais"` abre `<ConfirmDialog>` com foco em `"Cancelar"`;
  - `PopoverLegenda.test.tsx`: `remap_status` `discarded > 0` mostra aviso; trocar preset preserva overrides; `caption_style_conflict` exibe `"Recarregar estilo"`; `missingGlyphs` lista glifos ausentes; `!permitted` na Tradução exibe link para a Fonte; com permissão, `translation.estimate` alimenta `<ResumoCustoPrivacidade>`, `Somente local` bloqueia remoto, `translation.start` registra job (`#297`) e `translation.edit` invalida `export.captions`; nota de fora do `undo` presente.
- [ ] **Step 2:** `cd front-v2; bun run test src/telas/corte/popovers/PopoverEnquadrar.test.tsx src/telas/corte/popovers/PopoverLegenda.test.tsx` → FAIL.
- [ ] **Step 3:** Implementar `PopoverEnquadrar.tsx` e `PopoverLegenda.tsx`.
- [ ] **Step 4:** `cd front-v2; bun run test src/telas/corte/popovers/PopoverEnquadrar.test.tsx src/telas/corte/popovers/PopoverLegenda.test.tsx` → PASS.
- [ ] **Step 5:** Commit `feat(front-v2): popovers Enquadrar e Legenda/Tradução do Editor`.

---

### Tarefa 7: Popovers 3, 4 e 5 da `BarraAcoes` (`PopoverSilencios.tsx`, `PopoverAudio.tsx`, `PopoverHistorico.tsx`)

**Files:**
- Create: `front-v2/src/telas/corte/popovers/PopoverSilencios.tsx`, `front-v2/src/telas/corte/popovers/PopoverAudio.tsx`, `front-v2/src/telas/corte/popovers/PopoverHistorico.tsx`
- Test: `front-v2/src/telas/corte/popovers/PopoverSilenciosAudioHistorico.test.tsx`

**Interfaces:**
- Consumes: `chamar`, `ErroCore`, `mensagemDeErro`; `useEditorCorte` (`~/stores/editorCorte`); `<SeletorCaminho>` (`~/componentes/SeletorCaminho`, Onda 1 `#329`); `@ds` (`BannerErroCore`, `Botao`, `Campo`, `Checkbox`, `ConfirmDialog`, `Dica`, `Entrada`, `GrupoAjuste`, `Segmentado`, `Select`, `Slider`, `Status`, `duracao`, `tc`, `useToast`).
- Real core commands used:
  - `PopoverSilencios`: `editor.silences.detect`, `editor.silences.toggle`, `editor.silences.apply_all`, `editor.silences.revert_all`.
  - `PopoverAudio`: `audio.list`, `audio.import`, `audio.license.set`, `audio.delete`, `editor.audio.soundtrack.set`, `editor.audio.soundtrack.clear`, `editor.audio.sfx.add`, `editor.audio.sfx.update`, `editor.audio.sfx.remove`.
  - `PopoverHistorico`: `editor.undo`, `editor.redo`, `editor.flush`, `editor.snapshots`.
- Produces:
  - **`PopoverSilencios`:** nota fixa de respiro (*"Preserva 120 ms após a fala anterior e 75 ms antes da próxima (mínimo 200 ms)."*), `<Slider>` `Duração mínima da pausa` (`300–2000 ms`, padrão `600 ms`, `preview: true` no arrasto e `false` ao soltar), resumo `tabular-nums` (`Original` → `Efetiva`, `Removido`, `ativas / total`), botões `"Aplicar todos"` / `"Reverter todos"`, estado `empty` quando 0 pausas, e *review cards* com `#N`, intervalo, duração, trecho de contexto, botão **"Ouvir em contexto"** (`seek` `1,5 s` antes + play) e toggle **"Remover pausa" / "Manter pausa"** (`editor.silences.toggle`).
  - **`PopoverAudio`:**
    - Trilha sonora do Corte (até 1): seleção da biblioteca, `Início (s)`, `Volume` (`0–100%`, padrão `30%`), `Fade-in`, `Fade-out`, checkbox `Repetir para cobrir o Corte` (`loopToFit`), selo de licença (`licenseVerified` vs `Licença não informada`), nota *"Abaixa automaticamente -12 dB sob a fala"*, e `"Remover trilha"` (`editor.audio.soundtrack.clear` imediato reversível por `Ctrl/Cmd+Z` + toast `"Desfazer"`, conforme `02-consolidacao.md` Questão #23);
    - Efeitos sonoros (SFX): `"Adicionar SFX na agulha"` (`moment`) ou `"Ancorar na palavra selecionada"` (`word`), lista com badge `Fora do Corte` se `outsideClip`, volume padrão `80%`, fades, `"Mover para a agulha"` (`editor.audio.sfx.update`) e `"Remover"` (`editor.audio.sfx.remove` reversível por `Ctrl/Cmd+Z`);
    - Biblioteca do Projeto (`audio.list`): filtro `Músicas | SFX`, estado `empty` (`"Nenhuma música ou efeito sonoro no Projeto ainda."` + CTA `"Importar áudio local"`), formulário de importação (`≤ 500 MiB`, `<SeletorCaminho>`, tipo, nome, licença `youtube_audio_library` / `cc0` / `cc_by` / `purchased` / `original` / `unknown`, campo obrigatório `Atribuição` quando `cc_by` validando `attribution_required` com foco no campo), edição inline de licença (`audio.license.set`) e `"Excluir da biblioteca"` (`audio.delete` protegido por `<ConfirmDialog focoInicial="cancelar">`).
  - **`PopoverHistorico`:**
    - Botões **Desfazer** (`Ctrl/Cmd+Z`, `undoCount`) e **Refazer** (`Ctrl/Cmd+Shift+Z`, `redoCount`) com tooltip explícito `"Corte atual"` (desabilitados quando `0`) e botão **"Salvar agora"** (`editor.flush`, `Ctrl/Cmd+S`);
    - Bloco explicativo **"Fora do Desfazer do Corte"** (YuNet `set_suggested`, estilo/destaques/tradução de legenda, correções de Transcrição na pilha do Projeto);
    - Lista de até 20 **Snapshots salvos** (`editor.snapshots`) em **modo somente leitura** com ação de restaurar ausente/desabilitada com `<Dica>` citando `#294` (`"Restauração direta de snapshot aguarda comando editor.snapshots.restore no núcleo (#294)."`).

- [ ] **Step 1: Testes falhando** (`PopoverSilenciosAudioHistorico.test.tsx`):
  - `PopoverSilencios`: exibe regra `120 ms / 75 ms / 200 ms`, slider chama `editor.silences.detect` (`preview: true`/`false`), resumo tabular atualiza, `"Ouvir em contexto"` move agulha `1,5 s` antes e inicia reprodução, toggle chama `editor.silences.toggle`, `empty` quando sem pausas;
  - `PopoverAudio`: importar `cc_by` sem `Atribuição` bloqueia e foca campo obrigatório (`attribution_required`); adicionar trilha usa default `30%`; remover trilha/SFX não abre `<ConfirmDialog>` e chama `soundtrack.clear`/`sfx.remove` (reversível no `undo`), enquanto `"Excluir da biblioteca"` abre `<ConfirmDialog>` antes de `audio.delete`;
  - `PopoverHistorico`: exibe `undoCount`/`redoCount`, `"Salvar agora"` chama `editor.flush`, snapshots `editor.snapshots` renderizam em somente leitura com nota/tooltip citando `#294`.
- [ ] **Step 2:** `cd front-v2; bun run test src/telas/corte/popovers/PopoverSilenciosAudioHistorico.test.tsx` → FAIL.
- [ ] **Step 3:** Implementar `PopoverSilencios.tsx`, `PopoverAudio.tsx` e `PopoverHistorico.tsx`.
- [ ] **Step 4:** `cd front-v2; bun run test src/telas/corte/popovers/PopoverSilenciosAudioHistorico.test.tsx` → PASS.
- [ ] **Step 5:** Commit `feat(front-v2): popovers Silêncios, Áudio/SFX e Histórico do Editor`.

---

### Tarefa 8: Timeline Compacta do Proxy (`TimelineCorte.tsx`)

**Files:**
- Create: `front-v2/src/telas/corte/TimelineCorte.tsx`
- Test: `front-v2/src/telas/corte/TimelineCorte.test.tsx`

**Interfaces:**
- Consumes: `mediaUrl` (`../../../src/lib/media`); `PX_PER_SEC`, `usToPx`, `pxToUs`, `visiblePx`, `visibleSentences`, `visibleThumbs` (`../../../src/features/editor/timelineMath`); `useEditorCorte` (`~/stores/editorCorte`); `useFila` (`~/core/progresso`); `@ds` (`Botao`, `BotaoIcone`, `Dica`, `Progresso`, `Status`, `duracao`, `tc`).
- Real core commands used: `editor.timeline`, `editor.timeline_status`, `editor.wave`, `editor.adjust`, `editor.montage.set_start`, `editor.audio.sfx.update`, `jobs.cancel`.
- Produces:
  - `TimelineCorte({ videoKind, fonteDisponivel, aoMudarOverlayBorda })`:
    - **Cabeçalho da Timeline:** controles `Entrada` (`−1 Frase` / `+1 Frase`) e `Saída` (`−1 Frase` / `+1 Frase`) via `editor.adjust`, duração efetiva `tabular-nums`, indicador `Encaixe em Frase` vs `Livre por quadro (Alt)`, botão `"+3 faixas"` (padrão recolhido conforme `DESIGN.md` e `TelaEditor.tsx`, expandindo `Frases & Keyframes`, `Narração` e `Trilha & SFX`), e controles de Zoom (`-`, `+`, `Ajustar ao Corte`);
    - **Mini-mapa (*Dual Timeline*):** mostra janela total do proxy (`windowStartUs..windowEndUs`), intervalo do Corte e janela visível do zoom; clicar/arrastar reposiciona scroll horizontal;
    - **Régua e Agulha (`role="slider"`):** marcações adaptativas `tabular-nums`, agulha única `sinal` de `2 px` com alvo `≥ 24 px` (`aria-valuetext`), navegável por ponteiro e teclado (`←`/`→` `100 ms`, `Shift+←/→` `1 s`, `Home`/`End`);
    - **2 faixas padrão visíveis:**
      1. `Vídeo`: grade de miniaturas `thumbs.jpg` (`96×54 px`, `20` colunas) + **Alças `Entrada` (`I`) e `Saída` (`O`)** como `role="slider"` (`aria-valuetext="Entrada em HH:MM:SS.mmm da Fonte"`, alvo `≥ 24×24 px`), enviando `editor.adjust` (`preview: true` durante arrasto com `aoMudarOverlayBorda`, `preview: false` no `pointerup`; `Alt` ativa `free: true`; teclado `←`/`→` `1 Frase`, `Alt+←/→` `1 quadro`, `PageUp`/`PageDown` `5 Frases`);
      2. `Áudio`: onda `editor.wave` (`wave.bin`) com silêncios `active` exibidos em **hachura + borda tracejada** (WCAG 1.4.1, nunca só cor);
    - **3 faixas extras (`+3 faixas`):**
      3. `Frases & Keyframes`: apenas Frases visíveis na janela (`visibleSentences`) + marcadores de keyframes manuais (`crop.edits`, ícone distinto para `cut: true`);
      4. `Narração` *(exibida apenas quando `videoKind === 'transformed' && montage !== null`)*: blocos arrastáveis (`editor.montage.set_start` com `preview: true/false` e `Alt` livre por quadro), ação de voltar ao automático (`time_us: null`), badge de empurrão (`block_pushed`, respiro `300 ms`) e bloco `Cauda congelada` (`freezeTailUs`, com `<Status tom="aviso">` se `> 5 s`);
      5. `Trilha & SFX`: envelope de ducking `-12 dB` sobre `speechIntervals` + fades e pinos arrastáveis de SFX (`editor.audio.sfx.update` com `preview: true/false` e `Alt` livre por quadro);
    - enquanto `editor.timeline` / `editor.wave` estão `queued`/`running`, exibe `<Progresso>` inline + `"Cancelar"` (`jobs.cancel`); quando Fonte `offline`/`changed`, mantém régua/alças `±1 Frase` e Frases editáveis sem exigir `thumbs.jpg` nem `wave.bin`.

- [ ] **Step 1: Testes falhando** (`TimelineCorte.test.tsx`):
  - renderiza por padrão 2 faixas (`Vídeo` e `Áudio`) e oculta as 3 extras até clicar `"+3 faixas"`;
  - alças `Entrada` e `Saída` têm `role="slider"`, `aria-valuetext` legível e alvo `≥ 24 px`; `←`/`→` ajustam `1 Frase`, `Alt+←/→` ajustam `free: true` (`1 quadro`), `PageUp`/`PageDown` ajustam `5 Frases`;
  - arrastar alça `Entrada` envia `editor.adjust` com `preview: true` durante movimento (acionando `aoMudarOverlayBorda` com `livrePorQuadro`) e `preview: false` ao soltar;
  - expandir `"+3 faixas"` em `Vídeo transformado` com `montage` mostra `Narração` (arrasto `editor.montage.set_start`, badge `block_pushed`, aviso `Cauda congelada > 5 s`) e `Trilha & SFX` (pinos `editor.audio.sfx.update`); em `Corte direto`, oculta faixa `Narração`;
  - com Fonte `offline`, botões `±1 Frase` continuam funcionando sem renderizar erro fatal por falta de `thumbs.jpg`.
- [ ] **Step 2:** `cd front-v2; bun run test src/telas/corte/TimelineCorte.test.tsx` → FAIL.
- [ ] **Step 3:** Implementar `TimelineCorte.tsx`.
- [ ] **Step 4:** `cd front-v2; bun run test src/telas/corte/TimelineCorte.test.tsx` → PASS.
- [ ] **Step 5:** Commit `feat(front-v2): TimelineCorte compacta com +3 faixas e alças acessíveis`.

---

### Tarefa 9: Tela Orquestradora `EditarCorte.tsx`, `App.tsx`, Teclado/F6 e E2E Playwright

**Files:**
- Create: `front-v2/src/telas/corte/EditarCorte.tsx`
- Modify: `front-v2/src/App.tsx` (ligar rota `corte` quando `aba === 'editar'` a `<EditarCorte />` com `<ContextoCorteConectado />` no slot `meio` do `<Shell semPaddingConteudo />`; manter placeholder acionável apenas para `transformar`/`empacotar` até a Onda 5)
- Test: `front-v2/src/telas/corte/EditarCorte.test.tsx`, `front-v2/e2e/corte-editar.spec.ts`

**Interfaces:**
- Consumes: `useEditorCorte` (`~/stores/editorCorte`); `useFontesProjeto`, `useSelecaoProjeto`; `estadoForcado`, `<ComEstado>` (`~/shell/EstadoForcado`); `useAtalhos` (`~/comandos/atalhos`); `usePreferencias` (`~/preferencias/preferencias`); `<ContextoCorteConectado>`, `<DialogoExportarCorte>`, `<PainelEsquerdoCorte>`, `<PalcoEditor>`, `<PopoverEnquadrar>`, `<PopoverLegenda>`, `<PopoverSilencios>`, `<PopoverAudio>`, `<PopoverHistorico>`, `<TimelineCorte>`; `@ds` (`BannerErroCore`, `ConfirmDialog`, `Esqueleto`, `EstadoTela`, `Status`, `useToast`).
- Real core commands used: todos os de sessão (`editor.open`, `editor.flush`, `editor.undo`, `editor.redo`, `editor.adjust`, etc.) e navegação/guarda (`selection.list`, `selection.get`, `sources.list`).
- Produces:
  - `<EditarCorte projetoId corteId runId? />`:
    - **Guarda de entrada:** se `corteId` for inválido ou o candidato não estiver aprovado/encontrado, redireciona para `#/projeto/:id/cortes` com toast *"Este Corte não está disponível para edição."* (exceto em `?estado=` de QA); se Fonte estiver `offline`/`changed`, abre em modo somente-leitura de texto/bordas com banner persistente `"Relocalizar Fonte"` (`sources.relocate`); suporta Cortes V1 existentes (inclusive `avulso-*` e Cortes com `clip_edits` prévios);
    - **Guarda de saída (`editor.flush`):** antes de sair da rota `Editar` (troca de Corte, sub-aba, macro-etapa, `projects.close` ou `hashchange` interno interceptado enquanto há edições), executa `garantirSalvoParaSaida()` (`editor.flush`). Se `editor.flush` falhar (`?estado=erro-flush`), cancela a saída e abre `<ConfirmDialog role="alertdialog" focoInicial="cancelar">` com as **3 ações obrigatórias**:
      1. **"Tentar salvar novamente"** *(primário — rechama `editor.flush` e, se passar, executa a navegação pendente)*;
      2. **"Continuar editando"** *(fecha diálogo e devolve foco ao editor)*;
      3. **"Sair descartando alterações não salvas"** *(perigo — descarta `dirty` local e libera a navegação pendente)*;
    - **Atalhos e Regiões (`useAtalhos`):**
      - `F6` / `Shift+F6` cicla entre regiões visíveis: Topo/`<ContextoCorte>` → Painel Esquerdo (se aberto) → Palco/Controles → Popover aberto (se aberto) → Timeline → Barra de Status;
      - `Mod+[` alterna Painel Esquerdo; `Mod+]` alterna último popover da `<BarraAcoes>`; `Mod+S` chama `editor.flush`; `Mod+F` abre Painel Esquerdo e foca busca da Transcrição; `Mod+Z` / `Mod+Shift+Z` escolhe `transcription.undo`/`redo` quando o foco está na Transcrição ou `editor.undo`/`redo` no restante da tela; `Espaço`/`J`/`K`/`L`/`←`/`→` (transporte), `I`/`O`/`Alt+I`/`Alt+O` (bordas) e `+`/`-` (zoom) respeitam campos de texto e o interruptor WCAG 2.1.4;
    - **Todos os 6 estados §6:** `loading` (`<Esqueleto variante="painel" />` nas 4 zonas sem `return null`), `empty` (Corte ausente/removido → redireciona com toast; sub-estados vazios em Silêncios/Áudio/Histórico), `error` (`<BannerErroCore>` para `source_offline`, `adjust_*`, `proxy_failed`, `caption_style_conflict`, `project_write`, etc.), `ready`, `job_running` (proxy/timeline/reframe/tradução/export mantendo demais zonas interativas), `partial` (Fonte `offline`/`changed` em somente leitura ou tradução parcial).

- [ ] **Step 1: Testes falhando** (`EditarCorte.test.tsx`):
  - guarda de entrada redireciona Corte inexistente/não aprovado para `#/projeto/:id/cortes` com toast;
  - todos os 6 estados §6 (`loading`, `empty`, `error`, `ready`, `job_running`, `partial`);
  - ao navegar para `Empacotar` ou `Próximo aprovado >` com `dirty: true` e `editor.flush` falhando, navegação é cancelada e `<ConfirmDialog>` exibe `"Tentar salvar novamente"`, `"Continuar editando"` e `"Sair descartando alterações não salvas"`; clicar em `"Sair descartando..."` conclui a navegação; clicar em `"Tentar salvar novamente"` após corrigir erro conclui a navegação;
  - `Ctrl+[` recolhe/abre Painel Esquerdo; `Ctrl+]` abre último popover; `Ctrl+S` chama `editor.flush`; `Ctrl+Z` chama `editor.undo` fora da Transcrição e `transcription.undo` com foco na Transcrição; `F6` cicla regiões;
  - Corte V1 existente e `avulso-1-1-3` abrem e preservam sub-abas corretas.
- [ ] **Step 2:** `cd front-v2; bun run test src/telas/corte/EditarCorte.test.tsx` → FAIL.
- [ ] **Step 3:** Implementar `EditarCorte.tsx` e ligar rota `corte` (`aba === 'editar'`) em `App.tsx`.
- [ ] **Step 4:** `cd front-v2; bun run test src/telas/corte/EditarCorte.test.tsx` → PASS.
- [ ] **Step 5: E2E Playwright (`front-v2/e2e/corte-editar.spec.ts`)** em `1366×768` e `1440×900` (cobrindo os critérios de aceite de `D-corte-editar.md` §10):
  1. `<ContextoCorte>`: `Corte direto` oculta/desabilita `Transformar` e exibe botão `#292` desabilitado; `Vídeo transformado` mostra as 3 sub-abas com `aria-current="page"`; `Próximo aprovado >` dispara `editor.flush` antes de trocar `:corteId`;
  2. `Ctrl+E` abre exportação individual com `guardrails.check`, `guardrails.ack_direct_notice`, `missingGlyphs`, `export.start` → progresso `core-progress` → `export.status` (`?estado=fallback` exibe aviso CPU `#289`);
  3. Layout Variante D em `1366×768` (sem painel direito fixo; zero scroll externo) e `1440×900` (Painel Esquerdo aberto + Palco + Timeline sem scroll externo); `Ctrl+[` e `Ctrl+]` alternam Painel Esquerdo e último popover;
  4. Arrastar alça `Entrada` envia `editor.adjust` `preview: true` (badge no palco) e `preview: false` ao soltar; `Alt` alterna `"Livre por quadro (Alt)"`; `Ctrl+Z` chama `editor.undo`;
  5. Popover `Enquadrar`: `<InstaladorJustInTime recurso="yunet" />`, `reframe.start`, aviso de que sugestão não entra no `undo`, `<ConfirmDialog>` em limpar edições manuais, e manipulação no modo `Fonte 16:9`;
  6. `Transcrição`: `F2` edita palavra (`transcription.correct`) mantendo foco; `Índice do Corte` opera silêncio e keyframe só por teclado;
  7. Popover `Legenda`: preset preserva override, tradução usa `<ResumoCustoPrivacidade>` + `<ConfirmDialog>`, `caption_style_conflict` exibe `"Recarregar estilo"`;
  8. Popover `Silêncios`: slider + toggle exibe tachado/hachurado; Popover `Áudio`: `cc_by` sem atribuição bloqueia, trilha atualiza envelope `-12 dB`; Popover `Histórico`: snapshots em somente leitura (`#294`);
  9. `?estado=erro-flush` ao sair exibe diálogo de 3 ações; `?estado=offline` mantém Transcrição e bordas navegáveis com vídeo/export bloqueados; `F6` cicla regiões; zero `pageerror`.
  `cd front-v2; bunx playwright test e2e/corte-editar.spec.ts` → PASS.
- [ ] **Step 6:** Commit `feat(front-v2): tela Editar do Corte (#/projeto/:id/corte/:corteId/editar)`.

---

### Tarefa 10: Fechamento da Onda 4

- [ ] **Step 1:** Em `front-v2/`: `bun run typecheck`, `bun run test` e `bunx playwright test` → 100% verdes em `1366×768` e `1440×900`.
- [ ] **Step 2:** `bunx impeccable detect --json front-v2/src` → sem achados críticos (ou corrigidos antes do PR final).
- [ ] **Step 3:** Conferir aderência visual ao `DESIGN.md` e `editor.html?variant=D` (Regra da Luz Única, Estado Cinza, Número Tabular, Variante D sem painel direito fixo, 2 faixas + `+3 faixas`) e anexar screenshots `1366×768` e `1440×900` de `#/projeto/demo/corte/1/editar` (com e sem popover aberto) ao PR final.

---

## Tickets

Agrupamento das 10 tarefas em **5 tickets** executáveis em PRs pequenos. Após o ticket base **T1**, os tickets **T2**, **T3** e **T4** têm arquivos 100% disjuntos e podem rodar em paralelo; **T5** integra tudo em `EditarCorte.tsx` + `App.tsx` e fecha a verificação E2E/visual da Onda 4.

| Ticket | Título | Tarefas | Depende de | Arquivos criados / editados | Lacunas do mock TS fechadas |
|---|---|---|---|---|---|
| **T1** | `front-v2(onda 4): Mock TS, erros, Shell autosave (#291) e store da sessão do Editor` | Tarefas 1, 2 | Onda 0 (`#315`–`#317`), `#291` (PR #346), Onda 1 (`#329`–`#333`), Onda 2 (`#342`, `#343`, `#345`), Onda 3 (`#348`–`#351`) | `src/lib/core.ts`, `src/lib/editorEditsMock.ts`, `src/lib/captionsMock.ts`, `src/lib/translationMock.ts`, `src/features/export/mock.ts`, `front-v2/src/core/erros.ts`, `front-v2/src/core/progresso.ts`, `front-v2/src/shell/Shell.tsx`, `front-v2/src/stores/editorCorte.ts`, `front-v2/src/core/erros.test.ts`, `progresso.test.ts`, `editorMock.test.ts`, `front-v2/src/shell/Shell.test.tsx`, `front-v2/src/stores/editorCorte.test.ts` | Remove `?source-test`/`?transcript-test`/`?editor-test`/`?crop-test`/`?montage-test`/`?duck-test`/`?narration-captions`; implementa `editor.snapshots` e `export.status` (`encoder_fallback` / `?estado=fallback`); alinha defaults `0.30`/`0`/`0`/`0.80`; isola `captionsMock` por `transcript_id`/`clip_id`; consulta permissão real por `sourceId` em `translationMock`; emite `core-progress` para `proxy`, `timeline`, `reframe`, `translation`, `export`, `editor_saved`/`editor_save_failed`; suporta `?estado=erro-flush` e Cortes V1/direto/transformado/avulso no Projeto `"demo"` |
| **T2** | `front-v2(onda 4): ContextoCorte conectado, navegação entre aprovados e Exportação Individual` | Tarefa 3 | **T1**, Onda 1 (`#329`), Onda 3 (`#348`) | `front-v2/src/telas/corte/ContextoCorteConectado.tsx`, `front-v2/src/telas/corte/DialogoExportarCorte.tsx`, `front-v2/src/telas/corte/ContextoCorteConectado.test.tsx`, `front-v2/src/telas/corte/DialogoExportarCorte.test.tsx` | — *(consome T1)* |
| **T3** | `front-v2(onda 4): Painel esquerdo (Transcrição e Índice do Corte) e Timeline compacta` | Tarefas 4, 8 | **T1** | `front-v2/src/telas/corte/PainelEsquerdoCorte.tsx`, `front-v2/src/telas/corte/TimelineCorte.tsx`, `front-v2/src/telas/corte/PainelEsquerdoCorte.test.tsx`, `front-v2/src/telas/corte/TimelineCorte.test.tsx` | — *(consome T1)* |
| **T4** | `front-v2(onda 4): Palco 9:16/16:9, Transporte, Barra de 5 ações e Popovers` | Tarefas 5, 6, 7 | **T1**, Onda 1 (`#330`) | `front-v2/src/telas/corte/PalcoEditor.tsx`, `front-v2/src/telas/corte/popovers/PopoverEnquadrar.tsx`, `PopoverLegenda.tsx`, `PopoverSilencios.tsx`, `PopoverAudio.tsx`, `PopoverHistorico.tsx`, `front-v2/src/telas/corte/PalcoEditor.test.tsx`, `front-v2/src/telas/corte/popovers/PopoverEnquadrar.test.tsx`, `PopoverLegenda.test.tsx`, `PopoverSilenciosAudioHistorico.test.tsx` | — *(consome T1)* |
| **T5** | `front-v2(onda 4): Tela Editar do Corte (#/projeto/:id/corte/:corteId/editar), Teclado, E2E e fechamento` | Tarefas 9, 10 | **T1**, **T2**, **T3**, **T4** | `front-v2/src/telas/corte/EditarCorte.tsx`, `front-v2/src/App.tsx`, `front-v2/src/telas/corte/EditarCorte.test.tsx`, `front-v2/e2e/corte-editar.spec.ts` | — *(consome T1)* |

### Critérios de aceite por ticket

#### T1 — `front-v2(onda 4): Mock TS, erros, Shell autosave (#291) e store da sessão do Editor`
- [ ] Testes unitários em `erros.test.ts` e `progresso.test.ts` cobrindo todos os códigos `CoreError.code` do Pacote D e isolamento dos eventos `editor_saved` / `editor_save_failed` da lista da Fila Global.
- [ ] Testes em `Shell.test.tsx` cobrindo `semPaddingConteudo` e exibição acionável `role="alert"` de `editor_save_failed` (inclusive integrado ao fluxo de `CloseRequested` `#291`/PR #346 sem duplicar `app-close-requested`).
- [ ] Testes de contrato em `editorMock.test.ts` validando todos os comandos `editor.*`, `captions.*`, `reframe.*`, `translation.*`, `audio.*`, `guardrails.check`, `export.*` sem flags ocultas e com `core-progress` + `?estado=erro-flush|fallback`.
- [ ] Testes unitários em `editorCorte.test.ts` cobrindo `parsearCorteId` (`candidateId` e `avulso-*`), `editor.open`, `preview: true/false`, `dirty` + `editor.flush`, mapa `jobId → clipId` (`#297`), recarga de `editor.sentences`, invalidação de `export.captions` e modo somente leitura em Fonte `offline`/`changed`.
- [ ] `bun run typecheck && bun run test` verdes no CI.

#### T2 — `front-v2(onda 4): ContextoCorte conectado, navegação entre aprovados e Exportação Individual`
- [ ] Testes de componente em `ContextoCorteConectado.test.tsx` cobrindo navegação `< Anterior | Próximo aprovado >` (`?run=:runId` vs Projeto), `Alt+PageUp`/`Alt+PageDown`, execução de `aoAntesDeNavegar` (`editor.flush`), ocultação de `Transformar` em `Corte direto` / `avulso-*` e botão `"Converter em Vídeo transformado"` desabilitado com `<Dica>` citando `#292`.
- [ ] Testes de componente em `DialogoExportarCorte.test.tsx` cobrindo estados §6 (`loading`, `empty`/Fonte `offline`, `error` `export_exists`/`export_destination`/`component_missing`/`audio_asset_missing`, `ready`, `job_running` com `jobs.cancel`, `partial`/aviso `encoder_fallback` `#289`), `guardrails.ack_direct_notice`, `missingGlyphs`, `<SeletorCaminho>` (`#303`) e `export.start`.
- [ ] `bun run typecheck && bun run test` verdes no CI.

#### T3 — `front-v2(onda 4): Painel esquerdo (Transcrição e Índice do Corte) e Timeline compacta`
- [ ] Testes de componente em `PainelEsquerdoCorte.test.tsx` cobrindo trilho recolhido (`40 px`, sem *hover*), alternância `Transcrição | Índice do Corte`, busca `Ctrl+F` (com estado `empty`), Frases vizinhas atenuadas + `"Incluir no Corte"`, alvos `≥ 24×24 px`, `F2`/`Enter` inline (`transcription.correct`) preservando foco, `transcription.undo`/`redo` (`#302`), silêncios tachados/hachurados e operação 100% por teclado no `<ListaVirtual role="listbox">` do `Índice do Corte`.
- [ ] Testes de componente em `TimelineCorte.test.tsx` cobrindo 2 faixas padrão + expansão `+3 faixas`, alças `Entrada`/`Saída` (`role="slider"`, `≥ 24 px`, `±1 Frase`, `Alt` por quadro, `PageUp`/`PageDown` 5 Frases, `preview: true/false`), mini-mapa, zoom, `Narração` condicional (`block_pushed`, `Cauda congelada > 5 s`), `Trilha & SFX` e modo `offline`.
- [ ] `bun run typecheck && bun run test` verdes no CI.

#### T4 — `front-v2(onda 4): Palco 9:16/16:9, Transporte, Barra de 5 ações e Popovers`
- [ ] Testes de componente em `PalcoEditor.test.tsx` cobrindo `Prévia 9:16` (`render.ts`, `duckingMath.ts`), modo `Enquadrar na Fonte 16:9` (8 alças, `Topo`/`Base`, arrasto + teclado em `editor.crop.set_edits`), overlay de borda ao vivo, estado `offline` + `"Relocalizar arquivo"`, progresso de `proxy` + `jobs.cancel`, `<Transporte>` (`role="toolbar"`) e `<BarraAcoes>` (`Ctrl+]`).
- [ ] Testes de componente em `PopoverEnquadrar.test.tsx` e `PopoverLegenda.test.tsx` cobrindo os 5 layouts, `<InstaladorJustInTime recurso="yunet" />`, `reframe.*` + aviso de `set_suggested` fora do `undo`, `<ConfirmDialog>` ao limpar edições manuais, `remap_status`, 4 faixas, 3 presets preservando overrides, `caption_style_conflict`, `missingGlyphs` e `Tradução` com `<ResumoCustoPrivacidade>` + `<ConfirmDialog>` + nota fora do `undo`.
- [ ] Testes de componente em `PopoverSilenciosAudioHistorico.test.tsx` cobrindo slider `300–2000 ms`, `"Ouvir em contexto"`, estado `empty`, importação `cc_by` (`attribution_required`), `soundtrack.clear`/`sfx.remove` imediatos vs `audio.delete` via `<ConfirmDialog>`, `editor.undo`/`redo`, `editor.flush` e lista `editor.snapshots` somente leitura com `<Dica>` citando `#294`.
- [ ] `bun run typecheck && bun run test` verdes no CI.

#### T5 — `front-v2(onda 4): Tela Editar do Corte (#/projeto/:id/corte/:corteId/editar), Teclado, E2E e fechamento`
- [ ] Testes de componente em `EditarCorte.test.tsx` cobrindo guarda de entrada (Corte ausente/não aprovado, Cortes V1 e `avulso-*`), todos os estados §6 (`loading`, `empty`, `error`, `ready`, `job_running`, `partial` `offline`/`changed`), guarda de saída `editor.flush` com `<ConfirmDialog>` de 3 ações (*"Tentar salvar novamente"*, *"Continuar editando"*, *"Sair descartando alterações não salvas"*), atalhos WCAG 2.1.4 (`Ctrl+[`, `Ctrl+]`, `Ctrl+S`, `Ctrl+F`, `Ctrl+Z` contextual, `Espaço`/`J`/`K`/`L`/`I`/`O`/`+`/`-`) e ciclo `F6`/`Shift+F6`.
- [ ] Fluxo Playwright em `1366×768` e `1440×900` (`front-v2/e2e/corte-editar.spec.ts`) verde cobrindo todos os critérios de aceite de `D-corte-editar.md` §10, sem `pageerror` nem scroll horizontal na janela externa.
- [ ] Fechamento da Onda 4: `bunx impeccable detect --json front-v2/src` limpo, screenshots `1366×768` e `1440×900` anexados ao PR e `bun run typecheck && bun run test && bunx playwright test` verdes no CI.
