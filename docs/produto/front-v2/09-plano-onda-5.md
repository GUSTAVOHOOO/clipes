# Front v2 · Onda 5: Transformar e Empacotar

> **Para agentes:** SUB-SKILL OBRIGATÓRIA: `superpowers:subagent-driven-development` (recomendado) ou `superpowers:executing-plans` para executar tarefa por tarefa. Toda tarefa é TDD (`superpowers:test-driven-development`): teste falhando primeiro, depois o mínimo de código. Passos com checkbox (`- [ ]`).

**Goal:** Construir as duas sub-abas finais da Tela do Corte do front v2 do Clipes — **Transformar** (`#/projeto/:id/corte/:corteId/transformar`, com painel esquerdo recolhível `Transcrição do Corte` em `Ctrl/Cmd+[`, Stepper de 3 etapas com trava humana-no-loop ADR-0001: **1. Ângulo** → **2. Roteiro em blocos** → **3. Narração** via `<InstaladorJustInTime recurso="tts" />`, `<GravadorTeleprompter>`, importação, aparo VAD, limpeza Antes/Depois e revisão de alinhamento `needs_review`) e **Empacotar** (`#/projeto/:id/corte/:corteId/empacotar`, com `<PlayerProxy modo="capa">`, scrubber, sugestão/escolha/exportação PNG da capa, Ficha de Empacotamento com validadores YouTube/vidIQ, contador em bytes UTF-8, crédito protegido `aria-readonly="true"`, capítulos determinísticos e `<ChecklistGuardaCorpos>` + `AiDisclosureNote` + exportação individual MP4) — inclusive **Cortes, Roteiros e Narrações de Projetos existentes da V1** (com edições, idioma indefinido, sem Permissão ou Fonte `offline`/`changed` em SQLite), sobre a fundação da Onda 0 e os contratos das Ondas 1, 2, 3 e 4, com mock TS completo e testes Vitest + Playwright em `1366×768` e `1440×900`.

**Architecture:** Telas, stores e componentes em `front-v2/src/` importam primitivas/componentes de `@ds` (`design-system-v2/src/index.ts`), reaproveitam `<SeletorCaminho>` (`#329`) e `<InstaladorJustInTime recurso="tts" />` (`#330`) da Onda 1, `useFontesProjeto` (`#342`) da Onda 2, `useSelecaoProjeto` / `resolverDestinoSelecao` (`#348`) da Onda 3 e `<ContextoCorteConectado>` + `<DialogoExportarCorte>` (`#355`) da Onda 4. Falam com o núcleo exclusivamente via `chamar<T>()` (`~/core/cliente`), `mensagemDeErro()` (`~/core/erros`), `useFila()` (`~/core/progresso`), `useRota()` (`~/rotas/useRota`) e `useAtalhos()` (`~/comandos/atalhos`), usando `mediaUrl()` (`../../../src/lib/media`) e utilitários nativos (`saveDialog`, `copyText` de `../../../src/lib/desktop`). O mock TS em `src/lib/core.ts`, `src/lib/scriptMock.ts`, `src/lib/thumbnailMock.ts` e `src/lib/packagingMock.ts` remove as flags ocultas obrigatórias (`?script-paid`, `?packaging-*`, `?thumbnail-*`, `?narration-deviation`, `?record-no-*`), indexa estado por `candidate`, implementa `script.narration_allowed`, suporta `profileId`/`block` em `script.estimate`/`regenerate`, atualiza `title`/`refs` em `script.edit`, aplica limites reais em `packaging.edit` / `thumbnail.export`, emite eventos `core-progress` via barramento da Onda 1 e serve WAVs simulados para `narration-original/` e `narration-clean/`. Sem alterações em `core/` nem `src-tauri/`.

**Tech Stack:** React 19, TypeScript, Tailwind 4, `@base-ui/react` 1.9.0, `lucide-react`, Vite; testes com Vitest + Testing Library + jsdom (unidade e componente) e `@playwright/test` contra o mock (`VITE_CORE_MOCK=1`).

**Spec:** `docs/produto/front-v2/telas/E-corte-transformar-empacotar.md` (Telas 1 e 2), wireframes `docs/produto/front-v2/wireframes/E1-transformar.html` e `E2-empacotar.html`, `DESIGN.md`, `docs/produto/front-v2/01-arquitetura.md` (§3 rotas, §4 shell, §5 fila/eventos, §6 estados, §7 custo/privacidade, §8 atalhos, §9 acessibilidade, §10 estado), `docs/produto/front-v2/02-consolidacao.md` (catálogo canônico, Questões #1, #10, #11, #25, #26, Inconsistências #3–#8 e "Lacunas do mock TS"), `docs/produto/funcionalidades/06-roteiro-narracao-e-saida.md` e `docs/adr/0001-dois-tipos-de-video-e-regras-de-transformacao.md`. Issue-mãe: #288.

## Global Constraints

Herdadas integralmente de [04-plano-implementacao.md](./04-plano-implementacao.md#global-constraints):

- Vocabulário canônico do `GLOSSARY.md` em PT-BR (Projeto, Fonte, VOD, Corte, Corte direto, Vídeo transformado, Transformação, Narração, Roteiro, Empacotamento, Permissão, Transcrição, Frase, Provedor, Perfil de Provedor, Perfil de canal, Somente local). Nunca "clipe", "short", "voice-over", "locução", "metadados", "SEO", "input" nem "IA" como substantivo.
- Visual só pelos tokens e componentes de `design-system-v2/src/index.ts` (`@ds`) e regras do `DESIGN.md`: **A Regra da Luz Única** (um único botão primário `sinal` por tela — respeitando o `<ContextoCorte>` —, marca de seleção `marcado` de `2 px` e anel de foco `.foco`/`.foco-interno`), **A Regra do Estado Cinza** (`<Status>` e `<SeloTipoVideo>` nunca usam pílula colorida; `E1`/`E2` definem a organização funcional, mas o visual segue estritamente `DESIGN.md`), **A Regra do Erro Sem Fundo** (`role="alert"` via `<BannerErroCore>`), **A Regra do Número Tabular** (`num` em todo contador de caracteres, bytes UTF-8, tags, timecode, duração e USD) e **A Regra do Degrau** (`chao` → `area` → `elevado` → `hover`, sombra só em camadas flutuantes).
- Revelação progressiva: coluna de leitura confortável (`≤ 68 ch`) em `Transformar` e na Ficha de `Empacotar`; painel `Transcrição do Corte` acoplado **à esquerda com `Ctrl/Cmd+[`** (`02-consolidacao.md`, Inconsistência #3), recolhido por padrão em `1366×768` e aberto em `≥ 1440 px`; detalhes técnicos em `<BannerErroCore>` (`<details>`), histórico de sugestões da capa em `<details>` e texto completo de uso proibido TTS recolhido atrás de `"Ver texto completo"`.
- WCAG 2.2 AA (`1366×768` sem rolagem externa da janela e verificado em `1440×900`; rolagem apenas interna via `AreaRolagem`; alvos ≥ `24×24` CSS px; `role="slider"` no scrubber da capa; `aria-readonly="true"` no crédito protegido da Fonte; `prefers-reduced-motion: reduce` trocando rolagem contínua do `<GravadorTeleprompter>` para modo `Passo` por `↑`/`↓`; ciclo `F6`/`Shift+F6`; teclas únicas `Espaço`/`J`/`K`/`L`/`←`/`→` desabilitadas em campos de texto e sujeitas ao interruptor WCAG 2.1.4).
- Toda chamada paga, remota ou via CLI (`angles.generate`, `script.generate`, `script.regenerate`, `thumbnail.suggest`, `packaging.generate`) passa por `<ResumoCustoPrivacidade>` + `<ConfirmDialog focoInicial="cancelar">` enviando `confirmed: true` antes de disparar (§7) e respeita `projects.local_only` / `localOnly` por tarefa.
- Toda ação que depende de ticket aberto no núcleo (#289–#307) fica **desabilitada com `<Dica>` citando o ticket** (ou segue o contorno explícito da tabela abaixo).
- Nada de mudança em `core/` ou `src-tauri/`.
- Disco: `cargo clean` (se algo tiver compilado) e limpeza de `%TEMP%\clipes-<ticket>-*` antes de cada `worker_done` (`AGENTS.md`).

### Ações dependentes de tickets abertos no núcleo (#289–#307)

| Ticket aberto | Tela / Superfície afetada | Comportamento na Onda 5 |
|---|---|---|
| **#292** (`core(selection): converter Corte direto individual em Vídeo transformado`) | `<ContextoCorteConectado>` (`#/projeto/:id/corte/:corteId/transformar` e `/empacotar`) | Herdado da Onda 4 (`#355`): em `Corte direto`, o botão `"Converter em Vídeo transformado"` fica **desabilitado** com `<Dica>` citando `#292`, e a sub-aba `Transformar` permanece oculta; acesso direto à URL redireciona para `/editar` com toast `"Transformar está disponível apenas para Vídeo transformado"`. |
| **#293** (`core(narration): remover evento residual job 0 em narration.record_block`) | `Transformar` → Passo 3 (`narration.record_block`) | `core/src/narration_record.rs:859` emite evento residual `job: "0"` junto de `job: "narration_record"`. O store global da Fila (`~/core/progresso.ts`, Onda 0 `#315`) já filtra `job === "0"`; `transformarCorte.ts` escuta apenas `job === "narration_record"` sem criar listener paralelo (`#293`). |
| **#299** (`core(packaging): permitir criação manual inicial em packaging.edit sem packaging.generate`) | `Empacotar` → Ficha vazia (`current === null`) | Como `core/src/packaging.rs:949` retorna `nothing_to_edit` quando nunca houve `packaging.generate`, o estado vazio exibe o CTA primário `"Sugerir Empacotamento"` e mantém a ação secundária `"Preencher manualmente"` **desabilitada** com `<Dica>` citando `#299` (`"Criação manual sem sugestão prévia aguarda suporte em packaging.edit no núcleo (#299)."`). |
| **#301** (`core(components): adicionar entradas macOS (ffmpeg, yt-dlp, uv) no manifesto`) | `Transformar` Passo 3 (`<InstaladorJustInTime recurso="tts" />`) e `Empacotar` (`thumbnail.export` / `export.start`) | Herdado da Onda 1 (`#330`): quando `ffmpeg` estiver ausente no manifesto (macOS), o download automático fica **desabilitado** com `<Dica>` citando `#301`, mantendo orientação para FFmpeg do sistema. |
| **#303** (`core(jobs,export): expor startedAtMs e alvo em jobs.list + export.settings.set`) | `<ContextoCorteConectado>` e `Empacotar` → `"Exportar vídeo (MP4)"` | Herdado da Onda 4 (`#355`): ambos reutilizam `<DialogoExportarCorte>`, enviando o destino direto em `export.start { output }` sem botão separado de salvar pasta padrão até `#303`. |
| **#306** (`core(narration): adicionar narration.delete_block e progresso em cleanup.prepare`) | `Transformar` → Passo 3 (cartão de bloco da Narração) | 1) Como não existe comando para apagar o áudio de um bloco voltando a `Sem áudio`, o botão/item `"Remover áudio do bloco"` fica **desabilitado** com `<Dica>` citando `#306` (`"Remover áudio voltando a Sem áudio aguarda narration.delete_block no núcleo (#306); substitua por TTS, gravação ou importação."`).<br>2) Como `narration.cleanup.prepare` roda sincronamente sem `core-progress`, o seletor `Depois (limpa)` mantém estado de carregamento local por bloco até a Promise resolver (`#306`). |

> **Nota sobre `#289` e Questão #26 (`02-consolidacao.md`):** `#289` (`encoder_fallback` em `export.status`) já foi fechado no núcleo e é tratado pelo `<DialogoExportarCorte>` reutilizado da Onda 4. Conforme `02-consolidacao.md` Questão #26, apenas `script.estimate`/`script.regenerate` aceitam `profileId` ad-hoc; para trocar o Perfil de `angles.generate`, `thumbnail.suggest` ou `packaging.generate` após concluir/falhar, a UI orienta usar `"Refazer na Fila de Jobs"` (`Ctrl/Cmd+J`, `jobs.redo`).

## Review Focus

1. **Trava humana-no-loop obrigatória (ADR-0001) e transição de estados entre `angles.*`, `script.*` e `narration.*`:** Passo 2 só abre com `angles.get.selected !== null`; trocar ângulo quando há Roteiro intercepta `angle_change_confirmation` em `<ConfirmDialog focoInicial="cancelar">` antes de enviar `confirmed: true`, marcando blocos como `stale: true` e `Pendente`; editar bloco (`script.edit`) retorna para `Pendente`, bloqueia `"Aprovar bloco"` enquanto houver edição não salva e re-trava Passo 3 (`narrationAllowed === false`); aprovar o último bloco verifica `script.narration_allowed` e destrava imediatamente o Passo 3; nenhuma ação de TTS, gravação ou importação dispara com `narrationAllowed === false`.
2. **Pipeline completo da Narração (3A `pocket-tts` JIT, 3B Teleprompter + VAD, Importação, Limpeza Antes/Depois e Revisão `needs_review`):** reutilização integral de `<InstaladorJustInTime recurso="tts" />` (Onda 1 `#330`, aceite `termsAccepted: true` e cancelamento via `tts.models.cancel` vs `components.cancel`); gravação em `<GravadorTeleprompter>` para WAV 24 kHz mono tratando `no_speech_detected` com player do rascunho + `narration.discard_draft`, permissão de microfone negada (oferecendo Importação/TTS) e `vad_unavailable` com `"Aparar silêncios agora"` (`narration.trim_block`); limpeza Antes/Depois alternando `mediaUrl('narration-original/' + audio.id)` e `mediaUrl('narration-clean/' + audio.id)` com loading local em `narration.cleanup.prepare` (`#306`); e revisão de desvios `needs_review` exigindo `narration.review { choice: 'script' | 'spoken' }`.
3. **Validadores determinísticos do YouTube e proteção de dados em `Empacotar` (`thumbnail.*`, `packaging.*`, `guardrails.*`):** crédito da Fonte protegido (`aria-readonly="true"`), contador de descrição em **bytes UTF-8** somando `bytesOf(description) + creditBytes` contra `limits.descriptionBytes` (`5000`), orientadores não bloqueantes de título (`50–70`), gancho (`150`) e hashtags (`≤ 3`), validadores de capítulos (`00:00`, `≥ 3`, `≥ 10 s`, ordenação, formato, limite do Corte) e `packaging.refresh_chapters` preservando texto fora dos delimitadores (tratando `chapter_delimiters_missing`), scrubber estritamente em `[cut.startUs, cut.endUs]` + `thumbnail.export` em PNG nativo, e trava `#299` quando `current === null`.
4. **Reaproveitamento das Ondas 1–4 sem duplicação e compatibilidade com Cortes, Roteiros e Narrações de Projetos V1:** `<ContextoCorteConectado>` e `<DialogoExportarCorte>` vêm da Onda 4 (`#355`); `<PlayerProxy modo="capa">` reaproveita o player existente; painel `Transcrição do Corte` em `Transformar` fica **sempre à esquerda com `Ctrl/Cmd+[`** (`02-consolidacao.md` Inconsistência #3), recolhido em `1366×768` e aberto em `1440+ px`; e Projetos V1 existentes (com Cortes, Roteiros, Narrações, capas e empacotamentos já salvos, sem Permissão `no_permission`, com idioma indefinido `languageRequired: true`, ou com Fonte `offline`/`changed` em SQLite) funcionam sem perder edições nem travar a edição textual.
5. **Guarda `<ResumoCustoPrivacidade>`, veto `Somente local` e `core-progress`:** `angles.estimate`, `script.estimate` (inclusive com `profileId`), `thumbnail.estimate` e `packaging.estimate` resolvem o Perfil de destino via `provider.profiles.list` + `assistant.tasks` + `jobs.budget.get` quando necessário (`02-consolidacao.md` Questão #20), exibem `<ConfirmDialog focoInicial="cancelar">` com `<ResumoCustoPrivacidade>` antes de `confirmed: true` para `paid`/CLI, respeitam `projects.local_only` / `localOnly` sem trocar Provedor sozinho, e reagem a `core-progress` (`ai:angles:*`, `ai:script:*`, `ai:script_block:*`, `ai:thumbnail:*`, `ai:packaging:*`, `narration`, `narration_import`, `aligning`, `narration_record` filtrando `job === "0"` `#293`, `proxy`, `export`, `pocket-tts`, `tts:*`) exclusivamente via `useFila()`.

---

## Onda 5 · Transformar e Empacotar

**Estrutura de arquivos:**

```text
src/lib/
  core.ts                               remove portões ocultos em narration.*/tts.*; emite core-progress em tempo real; serve WAVs simulados em narration-original/ e narration-clean/; Projeto "demo" com Cortes, Roteiros e Narrações V1/transformado/direto
  scriptMock.ts                         indexa por candidate; implementa script.narration_allowed; suporta profileId e block em script.estimate/regenerate; script.edit atualiza title/narration/refs; languageRequired
  thumbnailMock.ts                      indexa por candidate; remove portões ?thumbnail-paid/?thumbnail-offline; valida thumbnail.export e Fonte offline/changed
  packagingMock.ts                      indexa por candidate; remove portões ocultos; lê Permissão real por Fonte; valida limites YouTube em packaging.edit e capítulos determinísticos

front-v2/
  src/
    core/
      erros.ts                          amplia TABELA_ERROS com códigos do Pacote E
    componentes/
      ListaChips.tsx                    editor acessível de tags/hashtags/refs com remoção individual e aria-live
      ContadorLimite.tsx                contador tabular-nums (caracteres/bytes UTF-8/tags) com faixa orientativa e erro rígido
      GravadorTeleprompter.tsx          captura microfone WebView (WAV 24 kHz mono), VU, teleprompter (Rolagem vs Passo reduced-motion) e rascunho no_speech_detected
    stores/
      transformarCorte.ts               store reativo de angles.*, script.*, narration.*, tts.catalog, perfil/orçamento e invalidação via core-progress (filtrando job "0" #293)
      empacotarCorte.ts                 store reativo de thumbnail.*, packaging.*, guardrails.check, estado sujo local, validadores YouTube e core-progress
    telas/corte/
      transformar/
        PainelTranscricaoTransformar.tsx  painel esquerdo recolhível (Ctrl+[) da Transcrição do Corte com #ID e clique para refs
        PassoAngulo.tsx                 Passo 1: sugestões (angles.estimate -> ResumoCustoPrivacidade -> generate), idioma, escolha e ângulo manual
        PassoRoteiro.tsx                Passo 2: banner ADR-0001, blocos 1..N, editar/aprovar/regenerar com profileId e trava narrationAllowed
        PassoNarracao.tsx               Passo 3: trava pedagógica, 3A (<InstaladorJustInTime recurso="tts" />), 3B (Gravador), importação, VAD, Antes/Depois (#306) e needs_review
        TransformarCorte.tsx            #/projeto/:id/corte/:corteId/transformar (stepper fixo, guarda Corte direto/avulso/V1, regiões F6, atalhos, estados §6)
      empacotar/
        PainelCapa.tsx                  coluna esquerda: <PlayerProxy modo="capa">, scrubber [startUs, endUs], sugestões/escolha manual, PNG export e histórico <details>
        FichaEmpacotamento.tsx          coluna direita: título (50–70), descrição (bytes UTF-8 + 150 + capítulos + crédito aria-readonly), tags/hashtags, <ChecklistGuardaCorpos> + Exportar
        EmpacotarCorte.tsx              #/projeto/:id/corte/:corteId/empacotar (guardas, layout 42/58 e 40/60, Ctrl+S, Ctrl+E, F6, estados §6)
    App.tsx                             liga rota corte (aba === 'transformar' e 'empacotar') com <ContextoCorteConectado />
  e2e/
    corte-transformar.spec.ts           Playwright Tela 1 (1366×768 e 1440×900)
    corte-empacotar.spec.ts             Playwright Tela 2 (1366×768 e 1440×900)
```

---

### Tarefa 1: Erros do Pacote E e Mock TS completo (`scriptMock`, `thumbnailMock`, `packagingMock`, `narration.*` e mídia WAV)

**Files:**
- Modify: `front-v2/src/core/erros.ts` (adicionar códigos de erro do Pacote E ausentes em `TABELA_ERROS`: `angle_invalid`, `angle_change_confirmation`, `edit_invalid`, `invalid_edit`, `nothing_to_edit`, `nothing_to_approve`, `generation_in_progress`, `suggestion_in_progress`, `generating`, `no_script`, `pending_blocks`, `import_in_progress`, `import_unsupported_format`, `import_file_too_large`, `import_duration_too_short`, `import_duration_too_long`, `import_no_audio_stream`, `import_unsupported_codec`, `import_empty_file`, `import_failed`, `import_file_missing`, `import_invalid_audio`, `invalid_recording_audio`, `recording_too_large`, `narration_record_failed`, `narration_failed`, `narration_missing`, `narration_not_recorded`, `narration_align_failed`, `narration_cleanup_failed`, `cleanup_not_applicable`, `invalid_cleanup_state`, `alignment_missing`, `invalid_review_choice`, `tts_model_missing`, `tts_model_unknown`, `tts_model_language_mismatch`, `tts_voice_unknown`, `tts_voice_language_mismatch`, `tts_voice_unsupported`, `terms_acceptance_required`, `ffmpeg_missing`, `instant_out_of_cut`, `no_instant`, `thumbnail_exists`, `thumbnail_destination`, `thumbnail_failed`, `chapter_delimiters_missing`, `chapters_require_transformed`, `chapters_unavailable`, `narration_required`, `too_few_chapters`, `block_not_found`)
- Modify: `src/lib/scriptMock.ts` (indexar estado por `candidate`; implementar `script.narration_allowed`; suportar `profileId` e `block` em `script.estimate`/`regenerate`; `script.edit` atualizar `title`, `narration` e `refs`; suportar `languageRequired` e `local_only_violation`; emitir `core-progress` `ai:angles:*`, `ai:script:*`, `ai:script_block:*` via callback/barramento)
- Modify: `src/lib/thumbnailMock.ts` (indexar por `candidate`; remover dependência obrigatória de `?thumbnail-paid`/`?thumbnail-offline`; validar `thumbnail_exists`, `thumbnail_destination`, `component_missing`, `source_offline`/`source_changed`; emitir `core-progress` `ai:thumbnail:*`)
- Modify: `src/lib/packagingMock.ts` (indexar por `candidate`; remover dependência obrigatória de `?packaging-*`; validar limites completos de YouTube em `packaging.edit`: `title_too_long`, `description_too_long`, `too_many_tags`, `tag_too_long`, `too_many_hashtags`, `invalid_hashtag`; emitir `core-progress` `ai:packaging:*`)
- Modify: `src/lib/core.ts` (conectar `scriptMock`, `thumbnailMock`, `packagingMock` ao perfil/Permissão/estado de Fonte real do Projeto `"demo"`, inclusive Cortes, Roteiros e Narrações de Projetos V1 pré-populados; remover portões ocultos de `narration.*`/`tts.*`; emitir `core-progress` para `narration`, `narration_import`, `aligning`, `narration_record` — inclusive residual `job: "0"` para validar filtro `#293`; disponibilizar WAV PCM válido simulado para `narration-original/<id>` e `narration-clean/<id>` em ambiente de mock/browser; suportar `?estado=vazio|erro|carregando|parcial|offline`)
- Test: `front-v2/src/core/erros.test.ts`, `front-v2/src/core/transformarEmpacotarMock.test.ts`

**Interfaces:**
- Consumes: `emitirProgressoMock` (`src/lib/core.ts`), `ErroCore` (`~/core/cliente`).
- Produces:
  - `TABELA_ERROS` cobrindo todos os códigos de `E-corte-transformar-empacotar.md` §5 e dos módulos Rust (`angles.rs`, `script.rs`, `tts/narration.rs`, `narration_*.rs`, `thumbnail.rs`, `packaging.rs`).
  - Mocks TS 100% aderentes ao núcleo Rust sem query flags ocultas obrigatórias, indexados por `candidate` e integrados ao barramento `core-progress`.

- [ ] **Step 1: Testes falhando** —
  - `erros.test.ts`: valida tradução e recuperação de `angle_invalid`, `tts_model_missing`, `import_unsupported_format`, `narration_cleanup_failed`, `instant_out_of_cut`, `thumbnail_exists`, `chapter_delimiters_missing`, `chapters_require_transformed`, `export_glyph_missing`;
  - `transformarEmpacotarMock.test.ts`:
    - `angles.estimate` retorna `{ paid, profile, estimate }`; `angles.choose` retorna documento completo de `angles.get` e exige `angle_change_confirmation` ao trocar com Roteiro existente;
    - `script.narration_allowed { candidate }` retorna `{ allowed: true }` apenas quando todos os blocos estão aprovados e rejeita com `script_not_approved` caso contrário;
    - `script.edit` persiste `title`, `narration` e `refs` e retorna o bloco para `pendente`; `script.estimate`/`regenerate` respeitam `profileId` e `block`;
    - `narration.record_block` / `trim_block` / `discard_draft` / `import` / `cleanup.set` / `cleanup.prepare` / `align` / `review` operam por `candidate` e emitem `core-progress`;
    - `thumbnail.*` e `packaging.*` operam por `candidate`, aplicam Permissão real da Fonte no crédito, validam limites YouTube e bloqueiam `thumbnail.export` quando Fonte `offline`.
- [ ] **Step 2:** `cd front-v2; bun run test src/core/erros.test.ts src/core/transformarEmpacotarMock.test.ts` → FAIL.
- [ ] **Step 3:** Atualizar `erros.ts`, `scriptMock.ts`, `thumbnailMock.ts`, `packagingMock.ts` e `src/lib/core.ts`.
- [ ] **Step 4:** `cd front-v2; bun run test src/core/erros.test.ts src/core/transformarEmpacotarMock.test.ts` → PASS.
- [ ] **Step 5:** Commit `feat(front-v2): erros do Pacote E e mock TS completo de Transformar e Empacotar`.

---

### Tarefa 2: Componentes compartilhados (`<ListaChips>`, `<ContadorLimite>`, `<GravadorTeleprompter>`) e Stores (`transformarCorte.ts`, `empacotarCorte.ts`)

**Files:**
- Create: `front-v2/src/componentes/ListaChips.tsx`, `front-v2/src/componentes/ContadorLimite.tsx`, `front-v2/src/componentes/GravadorTeleprompter.tsx`, `front-v2/src/stores/transformarCorte.ts`, `front-v2/src/stores/empacotarCorte.ts`
- Test: `front-v2/src/componentes/ListaChips.test.tsx`, `front-v2/src/componentes/ContadorLimite.test.tsx`, `front-v2/src/componentes/GravadorTeleprompter.test.tsx`, `front-v2/src/stores/transformarCorte.test.ts`, `front-v2/src/stores/empacotarCorte.test.ts`

**Interfaces:**
- Consumes: `chamar`, `ErroCore` (`~/core/cliente`); `useFila` (`~/core/progresso`); `resolverDestinoSelecao` (`~/stores/selecaoProjeto`, Onda 3 `#348`); `@ds` (`Botao`, `BotaoIcone`, `Campo`, `ConfirmDialog`, `Dialogo`, `Dica`, `Entrada`, `Kbd`, `Progresso`, `Segmentado`, `Slider`, `Status`, `duracao`, `tc`, `useToast`).
- Real core commands used: `angles.get`, `script.get`, `script.narration_allowed`, `narration.get`, `tts.catalog`, `components.pocket_tts.status`, `provider.profiles.list`, `assistant.tasks`, `jobs.budget.get`, `projects.local_only.get`, `thumbnail.get`, `packaging.get`, `guardrails.check`, `proxy.request`, `proxy.status`.
- Produces:
  - `<ListaChips itens aoAlterar maxItens maxCharsItem? prefixo? rotulo placeholder? desabilitado? erro? />`: adição por `Enter` ou vírgula, remoção individual com `aria-label="Remover {item}"` (alvo `≥ 24×24` px), deduplicação, prefixo `#` automático quando `prefixo="#"`, validação por item (`<= maxCharsItem`), e região `aria-live="polite"` anunciando adição/remoção.
  - `<ContadorLimite usado maximo unidade="caracteres" | "bytes" | "tags" faixaIdeal?={[50, 70]} />`: exibição `tabular-nums` (`"62/100 caracteres"`, `"1240/5000 bytes"`), indicador orientativo `role="status"` (`"Curto"` / `"Ideal"` / `"Pode truncar no mobile"`) sem bloquear, e estado `erro` quando `usado > maximo`.
  - `<GravadorTeleprompter aberto bloco titulo totalBlocos aoSalvarAudio aoDescartarRascunho aoAlternarParaImportar? aoAlternarParaTts? aoFechar />`:
    - captura de áudio via `navigator.mediaDevices.getUserMedia` + Web Audio (codificador WAV 24 kHz mono PCM em `base64`), indicador VU acessível (`aria-label="Nível do microfone"`), cronômetro `tabular-nums`;
    - teleprompter com texto `≤ 68 ch`, controle de velocidade (`px/s`), tamanho da fonte (`A-` / `A+`), `<Segmentado>` `Rolagem | Passo` (inicializando automaticamente em `Passo` com `↑`/`↓` quando `matchMedia('(prefers-reduced-motion: reduce)').matches`);
    - atalhos `Espaço` (pausar/retomar rolagem fora de sliders/inputs) e `Esc` (fecha se ocioso; se gravando, pede `<ConfirmDialog>` de descarte antes de fechar);
    - se microfone negado (`NotAllowedError`), exibe alerta acionável com alternativas imediatas (*"Importar áudio"* / *"Usar TTS local"*);
    - ao receber `no_speech_detected` com `hasDraft`, mantém o modal aberto exibindo player do rascunho, *"Gravar novamente"* e *"Descartar rascunho"*.
  - `transformarCorte.ts` (`useTransformarCorte(candidateId)`):
    - carrega em paralelo `angles.get`, `script.get`, `narration.get`, `tts.catalog`, `components.pocket_tts.status`, `provider.profiles.list`, `assistant.tasks`, `jobs.budget.get`, `projects.local_only.get`;
    - resolve destino/privacidade para tarefas `script` (e `profileId` específico) alimentando `<ResumoCustoPrivacidade>`;
    - reage a eventos `core-progress` via `useFila()` (`ai:angles:*`, `ai:script:*`, `ai:script_block:*`, `narration`, `narration_import`, `aligning`, `narration_record` filtrando `job === "0"` `#293`, `pocket-tts`, `tts:*`) recarregando o domínio afetado; limpa cache ao trocar `:corteId` ou fechar Projeto.
  - `empacotarCorte.ts` (`useEmpacotarCorte(candidateId, fonte)`):
    - carrega `thumbnail.get`, `packaging.get`, `guardrails.check { scope: 'single' }` e (se Fonte disponível) `proxy.request`;
    - mantém rascunho editável (`title`, `description`, `tags`, `hashtags`) e `sujo: boolean`, calcula bytes UTF-8 (`bytesOf(description) + creditBytes`) e valida capítulos em tempo real (`00:00`, `≥ 3`, `≥ 10 s`, ordenação, formato, limite do Corte);
    - resolve destino/privacidade para tarefa `packaging` e reage a `core-progress` (`ai:thumbnail:*`, `ai:packaging:*`, `proxy`, `export`) preservando edições não salvas em conflito até escolha do usuário.

- [ ] **Step 1: Testes falhando** —
  - `ListaChips.test.tsx`: adiciona por `Enter`/vírgula, remove via `aria-label="Remover ..."`, bloqueia acima de `maxItens`/`maxCharsItem` e anuncia em `aria-live="polite"`;
  - `ContadorLimite.test.tsx`: `bytes` conta UTF-8 multi-byte (`é`, emojis), `faixaIdeal={[50, 70]}` alterna `Curto` / `Ideal` / `Pode truncar no mobile`;
  - `GravadorTeleprompter.test.tsx`: com `prefers-reduced-motion: reduce` inicia no modo `Passo` (`↑`/`↓`); `Esc` ocioso fecha e durante gravação pede confirmação; erro de permissão oferece Importar/TTS; `no_speech_detected` exibe player de rascunho + `"Descartar rascunho"`;
  - `transformarCorte.test.ts` e `empacotarCorte.test.ts`: carregamento inicial, cálculo UTF-8 + validadores de capítulo, reação a `core-progress` (ignorando `job === "0"` `#293`) e limpeza ao trocar `candidateId`.
- [ ] **Step 2:** `cd front-v2; bun run test src/componentes/ListaChips.test.tsx src/componentes/ContadorLimite.test.tsx src/componentes/GravadorTeleprompter.test.tsx src/stores/transformarCorte.test.ts src/stores/empacotarCorte.test.ts` → FAIL.
- [ ] **Step 3:** Implementar `ListaChips.tsx`, `ContadorLimite.tsx`, `GravadorTeleprompter.tsx`, `transformarCorte.ts` e `empacotarCorte.ts`.
- [ ] **Step 4:** `cd front-v2; bun run test src/componentes/ListaChips.test.tsx src/componentes/ContadorLimite.test.tsx src/componentes/GravadorTeleprompter.test.tsx src/stores/transformarCorte.test.ts src/stores/empacotarCorte.test.ts` → PASS.
- [ ] **Step 5:** Commit `feat(front-v2): componentes auxiliares e stores de Transformar e Empacotar`.

---

### Tarefa 3: Painel Transcrição do Corte (`PainelTranscricaoTransformar.tsx`), Passo 1 (`PassoAngulo.tsx`) e Passo 2 (`PassoRoteiro.tsx`)

**Files:**
- Create: `front-v2/src/telas/corte/transformar/PainelTranscricaoTransformar.tsx`, `front-v2/src/telas/corte/transformar/PassoAngulo.tsx`, `front-v2/src/telas/corte/transformar/PassoRoteiro.tsx`
- Test: `front-v2/src/telas/corte/transformar/PainelTranscricaoTransformar.test.tsx`, `front-v2/src/telas/corte/transformar/PassoAngulo.test.tsx`, `front-v2/src/telas/corte/transformar/PassoRoteiro.test.tsx`

**Interfaces:**
- Consumes: `chamar`, `ErroCore`, `mensagemDeErro` (`~/core/cliente`, `~/core/erros`); `useTransformarCorte` (`~/stores/transformarCorte`); `<ListaChips>` (`~/componentes/ListaChips`); `<ContadorLimite>` (`~/componentes/ContadorLimite`); `@ds` (`AreaRolagem`, `AreaTexto`, `BannerErroCore`, `Botao`, `BotaoIcone`, `Campo`, `ConfirmDialog`, `Entrada`, `EstadoTela`, `Menu`, `MenuItem`, `Progresso`, `ResumoCustoPrivacidade`, `Select`, `Status`, `Kbd`, `tcLongo`, `useToast`).
- Real core commands used: `transcription.sentences`, `angles.get`, `angles.estimate`, `angles.generate`, `angles.choose`, `script.estimate`, `script.generate`, `script.get`, `script.edit`, `script.approve`, `script.regenerate`, `script.narration_allowed`, `provider.profiles.list`, `jobs.cancel`.
- Produces:
  - `<PainelTranscricaoTransformar sourceId startId endId aberto refsAtivas fraseDestacadaId aoAlternarAberto aoClicarFrase />`:
    - acoplado **à esquerda** com `Ctrl/Cmd+[` (`02-consolidacao.md` Inconsistência #3; recolhido por padrão em `1366 px`, aberto em `≥ 1440 px`, sem *hover*);
    - busca as Frases do Corte via `transcription.sentences` (`startId..endId`), exibe `#ID` + `tcLongo` em `num` + texto, marca `marcado` nas Frases em `refsAtivas`, e clicar em qualquer Frase insere/alterna seu ID no campo `refs` em foco no Passo 1 ou Passo 2 (além de rolar até a Frase quando `fraseDestacadaId` muda).
  - `<PassoAngulo candidateId store aoClicarChipFrase aoMudarRefEmFoco aoAvancarPasso />`:
    - exibe explicação inicial, seletor de idioma (`PT-BR` / `EN`) quando `languageRequired === true`, cartão destacado do ângulo escolhido (`selected`), botão `"Sugerir ângulos"` / `"Sugerir novos ângulos"` (`angles.estimate` → `<ConfirmDialog focoInicial="cancelar">` com `<ResumoCustoPrivacidade>` quando `paid` ou CLI → `angles.generate` + progresso/cancelamento), lista de 2–3 sugestões com chips de `sentence_ids` clicáveis e `"Escolher este ângulo"`, e `<details>` `"Escrever meu próprio ângulo"` (Nome `1..60`, Promessa `1..200`, Para quem `0..120`, Frases de apoio `1..12` via `<ListaChips>`, botão `"Usar meu ângulo"`);
    - intercepta `angle_change_confirmation` via `<ConfirmDialog focoInicial="cancelar">` antes de reenviar `angles.choose { ..., confirmed: true }`.
  - `<PassoRoteiro candidateId store aoMudarRefEmFoco aoAvancarNarracao blocoFocadoInicial? />`:
    - **Banner pedagógico permanente (ADR-0001):** *"Revisão humana obrigatória antes da Narração"*;
    - barra de cabeçalho: ângulo ativo, seletor de idioma se `languageRequired`, `"Sugerir Roteiro"` / `"Sugerir novo Roteiro"` (`script.estimate` → `<ResumoCustoPrivacidade>` + `<ConfirmDialog>` → `script.generate`), contador de aprovação (`"Faltam N de M blocos para aprovar"` ou `"Todos os blocos aprovados — Narração liberada"`), contador global `<ContadorLimite>` (`totalChars / limits.scriptChars`), e `"Avançar para Narração →"` habilitado apenas quando `narrationAllowed === true`;
    - faixa `partial` quando houver blocos gerados junto a blocos vazios/falhos;
    - lista ordenada de blocos (`1..N`, coluna `≤ 68 ch`): `<Status>` (`Pendente` / `Aprovado`, mais `Editado` e `Desatualizado — ângulo mudou`), `intent`, inputs de `title`, `narration` (`<AreaTexto>`), `refs` (`<ListaChips>`), indicador por bloco durante `ai:script_block`, botão `"Salvar edição"` (`script.edit`, também acionado por `Ctrl/Cmd+S` no bloco focado; retorna bloco para `Pendente`), botão `"Aprovar bloco"` (`script.approve`, desabilitado se houver edição não salva ou texto vazio; ao aprovar o último pendente valida `script.narration_allowed` e anuncia liberação em `aria-live="polite"`), e menu `"Regenerar bloco"` (Perfil padrão ou `"Refazer com outro Perfil…"` listando `provider.profiles.list` → `script.estimate { block, profileId }` → `<ResumoCustoPrivacidade>` + `<ConfirmDialog>` → `script.regenerate`).

- [ ] **Step 1: Testes falhando** —
  - `PainelTranscricaoTransformar.test.tsx`: carrega Frases `[startId..endId]`, destaca `refsAtivas`, clicar em Frase chama `aoClicarFrase(id)` e `fraseDestacadaId` rola até o item;
  - `PassoAngulo.test.tsx`: estado vazio (`"Nenhum ângulo sugerido ainda"`), `angles.estimate` + `<ResumoCustoPrivacidade>` + `<ConfirmDialog>` antes de `angles.generate`, validação inline de ângulo manual (`angle_invalid`), clique em chip rola Transcrição, e troca de ângulo com Roteiro abre `<ConfirmDialog>` (`angle_change_confirmation`) antes de `confirmed: true`;
  - `PassoRoteiro.test.tsx`: banner ADR-0001 visível, geração com `<ResumoCustoPrivacidade>`, editar campo habilita `"Salvar edição"` (`Ctrl+S`) e desabilita `"Aprovar bloco"`, salvar volta bloco para `Pendente`, aprovar último bloco chama `script.narration_allowed` e habilita `"Avançar para Narração →"`, `"Refazer com outro Perfil…"` chama `script.estimate { block, profileId }` + `<ConfirmDialog>` → `script.regenerate`.
- [ ] **Step 2:** `cd front-v2; bun run test src/telas/corte/transformar/PainelTranscricaoTransformar.test.tsx src/telas/corte/transformar/PassoAngulo.test.tsx src/telas/corte/transformar/PassoRoteiro.test.tsx` → FAIL.
- [ ] **Step 3:** Implementar `PainelTranscricaoTransformar.tsx`, `PassoAngulo.tsx` e `PassoRoteiro.tsx`.
- [ ] **Step 4:** `cd front-v2; bun run test src/telas/corte/transformar/PainelTranscricaoTransformar.test.tsx src/telas/corte/transformar/PassoAngulo.test.tsx src/telas/corte/transformar/PassoRoteiro.test.tsx` → PASS.
- [ ] **Step 5:** Commit `feat(front-v2): painel Transcrição, Passo 1 (Ângulo) e Passo 2 (Roteiro) de Transformar`.

---

### Tarefa 4: Passo 3 — Narração (`PassoNarracao.tsx`), TTS *just-in-time*, Teleprompter, Limpeza e Alinhamento

**Files:**
- Create: `front-v2/src/telas/corte/transformar/PassoNarracao.tsx`
- Test: `front-v2/src/telas/corte/transformar/PassoNarracao.test.tsx`

**Interfaces:**
- Consumes: `chamar`, `ErroCore`, `mensagemDeErro` (`~/core/cliente`, `~/core/erros`); `mediaUrl` (`../../../src/lib/media`); `saveDialog` / `openDialog` (`../../../src/lib/desktop`); `useTransformarCorte` (`~/stores/transformarCorte`); `<InstaladorJustInTime>` (`~/componentes/InstaladorJustInTime`, Onda 1 `#330`); `<GravadorTeleprompter>` (`~/componentes/GravadorTeleprompter`); `<SeletorCaminho>` (`~/componentes/SeletorCaminho`, Onda 1 `#329`); `@ds` (`BannerErroCore`, `Botao`, `ConfirmDialog`, `Dica`, `EstadoTela`, `Progresso`, `Segmentado`, `Select`, `Status`, `Switch`, `duracao`, `tc`, `useToast`).
- Real core commands used: `narration.get`, `narration.generate`, `narration.regenerate_block`, `narration.record_block`, `narration.trim_block`, `narration.discard_draft`, `narration.import`, `narration.align`, `narration.align_block`, `narration.review`, `narration.cleanup.set`, `narration.cleanup.prepare`, `tts.catalog`, `tts.models.choose`, `components.pocket_tts.status`, `jobs.cancel`.
- Produces:
  - `<PassoNarracao candidateId store aoVoltarBlocoPendente aoIrParaEmpacotar aoIrParaEditar />`:
    - **Estado travado (`narrationAllowed === false`):** exibe faixa pedagógica ADR-0001 (*"Narração travada: ainda há N bloco(s) pendente(s) no Roteiro."* ou *"Gere e aprove o Roteiro antes de narrar."*) com botão primário *"Voltar ao próximo bloco pendente"* (salta para Passo 2 focando o primeiro bloco pendente);
    - **Sub-superfície 3A (TTS *just-in-time*):** quando faltar `pocket-tts` ou modelo TTS do idioma e o usuário acionar síntese TTS (ou expandir preparação TTS), renderiza `<InstaladorJustInTime recurso="tts" idioma={...} modo="inline" />` (reaproveitando Onda 1 `#330`, inclusive cancelamento via `tts.models.cancel` / `components.cancel` e guarda `#301`);
    - **Resumo e ações globais:** idioma, duração total `tabular-nums`, status de alinhamento (`alignPrerequisitesReady === false` → aviso com link `#/config/componentes`), seletores de **Voz** (`tts.catalog.voices` com atribuição/licença) e **Modelo ativo** (`tts.models.choose`), botão *"Gerar voz de todos os blocos (TTS)"* (`<ConfirmDialog>` se algum bloco já tiver áudio `recorded`/`imported`), *"Alinhar todos os blocos"* (`narration.align`), faixa `partial` com *"Ir para o próximo pendente"* e ações de saída *"Avançar para Empacotar →"* / *"Ajustar na timeline (Editar)"*;
    - **Cartões por bloco:**
      - `<Status>` da origem (`TTS · {voiceId}` | `Gravado` | `Importado` | `Sem áudio`), `durationUs` (`tabular-nums`), e `<Status tom="aviso">Desatualizado (Roteiro alterado)</Status>` quando `audio.stale === true`;
      - 3 caminhos de criação/substituição: *"Gerar com voz (TTS)"* / *"Regenerar TTS"* (`narration.regenerate_block`), *"Gravar no microfone"* (abre `<GravadorTeleprompter>` → `narration.record_block`, tratando `no_speech_detected` e `job === "narration_record"` filtrando `"0"` `#293`), *"Importar áudio"* (`.wav`, `.mp3`, `.m4a`, `.ogg`, `<ConfirmDialog>` se já houver áudio → `narration.import` + progresso `narration_import`);
      - botão *"Remover áudio"* **desabilitado** com `<Dica>` citando `#306` (`"Remover áudio voltando a Sem áudio aguarda narration.delete_block no núcleo (#306); substitua por TTS, gravação ou importação."`);
      - aparo VAD pós-gravação: quando `engineId === 'recorded' && !trimmed`, exibe aviso e botão *"Aparar silêncios agora"* (`narration.trim_block` quando `vadReady === true`, ou link `#/config/componentes`);
      - limpeza de voz (`cleanup.applicable === true`): `<Switch>` *"Limpeza de voz"* (`narration.cleanup.set`), `<Segmentado>` **`Antes (original)` | `Depois (limpa)`** (ao escolher `Depois` com `!cleanup.ready`, chama `narration.cleanup.prepare` mantendo loading local no bloco `#306` e reproduz `mediaUrl('narration-original/' + audio.id)` vs `mediaUrl('narration-clean/' + audio.id)`), mais indicador de piso de ruído (`"Ruído medido nos silêncios"` vs `"Piso padrão aplicado"`);
      - alinhamento (`alignment.status`): `<Status>` (`Pendente` | `Alinhado` | `Revisão necessária` | `Revisado` | `Falhou`), bloco comparativo `needs_review` (**Roteiro aprovado** × **Detectado na fala**) com *"Usar texto do Roteiro"* / *"Usar texto falado"* (`narration.review { choice }`), e *"Re-alinhar bloco"* (`narration.align_block`).

- [ ] **Step 1: Testes falhando** (`PassoNarracao.test.tsx`):
  - quando `narrationAllowed === false`, renderiza trava pedagógica ADR-0001 e botão *"Voltar ao próximo bloco pendente"* chama `aoVoltarBlocoPendente`;
  - quando `pocket-tts` ou modelo TTS ausente, acionar TTS exibe `<InstaladorJustInTime recurso="tts" />`;
  - `"Gerar voz de todos os blocos (TTS)"` com bloco já gravado abre `<ConfirmDialog>` antes de `narration.generate`;
  - clicar *"Gravar no microfone"* abre `<GravadorTeleprompter>`; salvar envia `narration.record_block`; bloco gravado sem VAD (`trimmed: false`) exibe *"Aparar silêncios agora"* (`narration.trim_block`);
  - em bloco `recorded`/`imported`, alternar `<Segmentado>` para `Depois (limpa)` com `ready: false` exibe loading local (`#306`), chama `narration.cleanup.prepare` e muda `<audio src>` para `mediaUrl('narration-clean/...')`;
  - em `alignment.status === 'needs_review'`, exibe comparação `narrationText` × `spokenText` e clicar *"Usar texto falado"* chama `narration.review { choice: 'spoken' }`;
  - botão *"Remover áudio"* está desabilitado com `<Dica>` citando `#306`; erros de importação (`import_unsupported_format`, `import_file_too_large`) renderizam em `role="alert"`.
- [ ] **Step 2:** `cd front-v2; bun run test src/telas/corte/transformar/PassoNarracao.test.tsx` → FAIL.
- [ ] **Step 3:** Implementar `PassoNarracao.tsx`.
- [ ] **Step 4:** `cd front-v2; bun run test src/telas/corte/transformar/PassoNarracao.test.tsx` → PASS.
- [ ] **Step 5:** Commit `feat(front-v2): Passo 3 (Narração — TTS JIT, Teleprompter, Limpeza e Alinhamento)`.

---

### Tarefa 5: Orquestração de `TransformarCorte.tsx` (`#/projeto/:id/corte/:corteId/transformar`), Estados §6, Teclado e E2E

**Files:**
- Create: `front-v2/src/telas/corte/transformar/TransformarCorte.tsx`
- Modify: `front-v2/src/App.tsx` (ligar `rota.tela === 'corte' && rota.aba === 'transformar'` ao `<TransformarCorte />` com `<ContextoCorteConectado />` no `<Shell semPaddingConteudo />`)
- Test: `front-v2/src/telas/corte/transformar/TransformarCorte.test.tsx`, `front-v2/e2e/corte-transformar.spec.ts`

**Interfaces:**
- Consumes: `useTransformarCorte` (`~/stores/transformarCorte`); `useFontesProjeto` (`~/stores/fontesProjeto`); `useSelecaoProjeto` (`~/stores/selecaoProjeto`); `estadoForcado`, `<ComEstado>` (`~/shell/EstadoForcado`); `useAtalhos` (`~/comandos/atalhos`); `<ContextoCorteConectado>` (`~/telas/corte/ContextoCorteConectado`, Onda 4 `#355`); `<PainelTranscricaoTransformar>`, `<PassoAngulo>`, `<PassoRoteiro>`, `<PassoNarracao>`; `@ds` (`AreaRolagem`, `BannerErroCore`, `Botao`, `Esqueleto`, `EstadoTela`, `Kbd`, `Status`, `useToast`).
- Produces:
  - `<TransformarCorte projetoId corteId runId? />`:
    - **Guardas de entrada:** `avulso-*` ou `videoKind === 'direct'` redireciona para `#/projeto/:id/corte/:corteId/editar` com toast *"Transformar está disponível apenas para Vídeo transformado"*; `:corteId` inexistente/não aprovado redireciona para `#/projeto/:id/cortes` com toast; Fonte `offline`/`changed` exibe banner não bloqueante `"Relocalizar Fonte"` preservando 100% da edição de Ângulo, Roteiro e Narração via SQLite (inclusive Cortes, Roteiros e Narrações de Projetos existentes da V1);
    - **Stepper fixo acessível:** `<nav aria-label="Etapas da Transformação">` com `<ol>`, `aria-current="step"`, `aria-disabled="true"` + `aria-describedby` no Passo 2 quando `selected === null` e indicação `Travado · N blocos pendentes` no Passo 3 (clicável para exibir explicação ADR-0001);
    - **Todos os 6 estados §6:** `loading` (`<Esqueleto>` do Stepper + 3 blocos, sem `return null`), `empty` por passo, `error` (`<BannerErroCore>` em `role="alert"`), `ready`, `job_running` (`ai:angles`, `ai:script`, `narration`, `narration_import`, `aligning` sem travar blocos livres), `partial` (blocos parciais no Passo 2 ou pendentes/revisão no Passo 3 + Fonte `offline`);
    - **Teclado e `F6`:** `F6`/`Shift+F6` cicla regiões (Topo/`<ContextoCorte>` → Transcrição do Corte quando aberta → Stepper + Passo Ativo → Barra de Status); `Mod+[` alterna Transcrição do Corte à esquerda; `Mod+S` salva bloco em foco no Passo 2; comandos na Paleta (`Ctrl+K`) para `Passo 1: Ângulo`, `Passo 2: Roteiro`, `Passo 3: Narração`, `Sugerir Roteiro`, `Aprovar bloco atual`, `Abrir gravador`.

- [ ] **Step 1: Testes falhando** (`TransformarCorte.test.tsx`):
  - `Corte direto` ou `avulso-*` redireciona para `/editar` com toast informativo; `:corteId` ausente redireciona para `/cortes`;
  - todos os 6 estados §6 (`loading`, `empty`, `error` `local_only_violation`/`script_requires_transformed`, `ready`, `job_running`, `partial` inclusive Fonte `offline` editável);
  - navegação no Stepper respeita travas (`selected === null` impede Passo 2; Passo 3 abre faixa ADR-0001 quando `narrationAllowed === false`);
  - `Ctrl+[` abre/recolhe Transcrição do Corte à esquerda; `F6` cicla regiões; Corte V1 existente abre com ângulo, Roteiro e Narração preservados.
- [ ] **Step 2:** `cd front-v2; bun run test src/telas/corte/transformar/TransformarCorte.test.tsx` → FAIL.
- [ ] **Step 3:** Implementar `TransformarCorte.tsx` e ligar aba `transformar` em `App.tsx`.
- [ ] **Step 4:** `cd front-v2; bun run test src/telas/corte/transformar/TransformarCorte.test.tsx` → PASS.
- [ ] **Step 5: E2E Playwright (`front-v2/e2e/corte-transformar.spec.ts`)** em `1366×768` e `1440×900` (cobrindo os 10 critérios de aceite de `E-corte-transformar-empacotar.md` Tela 1 §10):
  1. `Corte direto` oculta `Transformar` e navegação direta redireciona para `/editar`;
  2. `?estado=vazio` exibe Passo 1 vazio e Passos 2–3 travados;
  3. `"Sugerir ângulos"` pago exibe `<ResumoCustoPrivacidade>` + `<ConfirmDialog>` antes de `confirmed: true`;
  4. Escrever ângulo manual desbloqueia Passo 2; trocar ângulo com Roteiro existente abre confirmação e marca blocos `Desatualizado`;
  5. Editar bloco e `"Salvar edição"` (`Ctrl+S`) volta bloco a `Pendente` mantendo Passo 3 travado;
  6. Aprovar último bloco destrava Passo 3 (`narrationAllowed === true`);
  7. `<InstaladorJustInTime recurso="tts" />` em Passo 3 com aceite de termo e cancelamento;
  8. Alternar limpeza para `Depois (limpa)` chama `narration.cleanup.prepare` e atualiza player;
  9. Revisar bloco `needs_review` chamando `narration.review { choice: 'spoken' }`;
  10. Transcrição acoplada à esquerda em `1440×900` (`Ctrl+[` em `1366×768`), zero `pageerror` e zero scroll horizontal externo.
  `cd front-v2; bunx playwright test e2e/corte-transformar.spec.ts` → PASS.
- [ ] **Step 6:** Commit `feat(front-v2): tela Transformar do Corte (#/projeto/:id/corte/:corteId/transformar)`.

---

### Tarefa 6: Coluna Esquerda de Empacotar — Capa e Preview (`PainelCapa.tsx`)

**Files:**
- Create: `front-v2/src/telas/corte/empacotar/PainelCapa.tsx`
- Test: `front-v2/src/telas/corte/empacotar/PainelCapa.test.tsx`

**Interfaces:**
- Consumes: `chamar`, `ErroCore`, `mensagemDeErro` (`~/core/cliente`, `~/core/erros`); `mediaUrl` (`../../../src/lib/media`); `saveDialog` (`../../../src/lib/desktop`); `useEmpacotarCorte` (`~/stores/empacotarCorte`); `<SeletorCaminho>` (`~/componentes/SeletorCaminho`, Onda 1 `#329`, fallback quando fora do Tauri); `@ds` (`BannerErroCore`, `Botao`, `ConfirmDialog`, `Dica`, `PlayerProxy`, `Progresso`, `ResumoCustoPrivacidade`, `Slider`, `Status`, `duracao`, `tc`, `useToast`).
- Real core commands used: `thumbnail.get`, `thumbnail.estimate`, `thumbnail.suggest`, `thumbnail.choose`, `thumbnail.export`, `proxy.request`, `proxy.status`, `jobs.cancel`.
- Produces:
  - `<PainelCapa corteId store fonte aoRelocalizarFonte aoMudarInstantPreview? />`:
    - reaproveita `<PlayerProxy modo="capa" ... />` ligado a `mediaUrl('proxy/' + proxyKey)` quando `fonteDisponivel` e `proxy.state === 'ready'`, exibindo o quadro do instante do scrubber (`current.instantUs` ao carregar); durante `proxy` `queued`/`running`, mostra `<Progresso>` + `"Cancelar"` (`jobs.cancel`); se Fonte `offline`/`changed`, exibe banner acionável `"Relocalizar Fonte"` sem impedir edição textual na coluna direita;
    - **Scrubber da capa:** `role="slider"`, `aria-label="Instante da capa"`, estritamente limitado entre `cut.startUs` e `cut.endUs`, `aria-valuetext` legível (`"00:14,2 de 00:48,0"`), botões `-1 s` / `+1 s`, `Reproduzir/Pausar` (`Espaço` fora de campos de texto) e exibição `tabular-nums`;
    - **Ficha do momento (`current`):** timecode `tabular-nums`, `<Status>` de origem (`"Sugerido pelo Provedor"` vs `"Escolhido por você"`), `current.why` (`<= 200` chars) ou estado vazio `"Nenhum momento de capa escolhido ainda."`;
    - **Ações:** `"Sugerir momento da capa"` / `"Sugerir de novo"` (`thumbnail.estimate` → `<ConfirmDialog focoInicial="cancelar">` com `<ResumoCustoPrivacidade>` se `paid` ou CLI → `thumbnail.suggest`), `"Usar quadro atual como capa"` (`thumbnail.choose { candidate, instant_us }`, habilitado apenas se diferente de `current?.instantUs` e dentro de `[cut.startUs, cut.endUs]`), `"Salvar capa (PNG)"` (`saveDialog` nativo / `<SeletorCaminho modo="salvar">` com padrão `capa-{corte}.png` → `thumbnail.export { candidate, output }`, habilitado quando `current !== null` e Fonte online, tratando `thumbnail_exists`, `thumbnail_destination`, `component_missing` e exibindo toast `"Capa salva"`);
    - **Histórico recolhível (`<details>`):** lista `suggestions` e `choices` com botão `"Ver quadro"` posicionando o scrubber.

- [ ] **Step 1: Testes falhando** (`PainelCapa.test.tsx`):
  - estado vazio exibe `"Nenhum momento de capa escolhido ainda."` e desabilita `"Salvar capa (PNG)"`;
  - scrubber possui `role="slider"` limitado a `[cut.startUs, cut.endUs]` e `-1 s`/`+1 s` atualizam instante;
  - `"Sugerir momento da capa"` pago abre `<ConfirmDialog focoInicial="cancelar">` com `<ResumoCustoPrivacidade>` antes de `thumbnail.suggest { confirmed: true }`;
  - `"Usar quadro atual como capa"` chama `thumbnail.choose` e atualiza selo para `"Escolhido por você"`;
  - `"Salvar capa (PNG)"` chama `thumbnail.export` e exibe toast `"Capa salva"`; erro `thumbnail_exists` exibe alerta acionável;
  - com Fonte `offline`, bloqueia preview e botões de exportar/usar quadro mantendo histórico legível.
- [ ] **Step 2:** `cd front-v2; bun run test src/telas/corte/empacotar/PainelCapa.test.tsx` → FAIL.
- [ ] **Step 3:** Implementar `PainelCapa.tsx`.
- [ ] **Step 4:** `cd front-v2; bun run test src/telas/corte/empacotar/PainelCapa.test.tsx` → PASS.
- [ ] **Step 5:** Commit `feat(front-v2): PainelCapa com PlayerProxy, scrubber e exportação PNG`.

---

### Tarefa 7: Coluna Direita de Empacotar — Ficha, Validadores YouTube, Crédito e Guardrails (`FichaEmpacotamento.tsx`)

**Files:**
- Create: `front-v2/src/telas/corte/empacotar/FichaEmpacotamento.tsx`
- Test: `front-v2/src/telas/corte/empacotar/FichaEmpacotamento.test.tsx`

**Interfaces:**
- Consumes: `chamar`, `ErroCore`, `mensagemDeErro` (`~/core/cliente`, `~/core/erros`); `copyText` (`../../../src/lib/desktop`); `useEmpacotarCorte` (`~/stores/empacotarCorte`); `<ListaChips>` (`~/componentes/ListaChips`); `<ContadorLimite>` (`~/componentes/ContadorLimite`); `@ds` (`AreaTexto`, `BannerErroCore`, `Botao`, `Campo`, `ChecklistGuardaCorpos`, `ConfirmDialog`, `Dica`, `Entrada`, `EstadoTela`, `Progresso`, `ResumoCustoPrivacidade`, `Select`, `Status`, `useToast`).
- Real core commands used: `packaging.get`, `packaging.estimate`, `packaging.generate`, `packaging.edit`, `packaging.refresh_chapters`, `guardrails.check`, `guardrails.ack_direct_notice`, `jobs.cancel`.
- Produces:
  - `<FichaEmpacotamento projetoId corteId fonteId fonteDisponivel store aoAbrirExportacao aoIrParaFonte aoIrParaTransformar aoIrParaMesaExportacao />`:
    - **Estado vazio (`current === null`):** exibe `<EstadoTela tipo="vazio" />` (*"Nenhum texto de publicação gerado ainda."*), seletor de idioma quando `languageRequired`, CTA primário `"Sugerir Empacotamento"` (`packaging.estimate` → `<ConfirmDialog focoInicial="cancelar">` com `<ResumoCustoPrivacidade>` → `packaging.generate`), e botão secundário `"Preencher manualmente"` **desabilitado** com `<Dica>` citando `#299`;
    - **Barra superior da Ficha:** `"Sugerir novamente"`, seletor de idioma (`PT-BR` | `EN`), selo de estado (`Salvo` | `Alterações não salvas`), e nota transparente *"Sugestão gerada pelo Provedor — revise título, descrição e tags antes de publicar."*;
    - **Título + vidIQ:** `<Entrada>` + `<ContadorLimite usado={[...title].length} maximo={limits.titleChars} unidade="caracteres" faixaIdeal={[50, 70]} />` (orientativo, erro rígido apenas se vazio ou `> 100`);
    - **Descrição + Gancho 150 + Capítulos + Crédito:**
      - `<AreaTexto>` + `<ContadorLimite usado={bytesOf(description) + creditBytes} maximo={limits.descriptionBytes} unidade="bytes" />` + indicador `"Gancho inicial: {min(len, 150)}/150 caracteres visíveis antes de 'Mostrar mais'"`;
      - **Capítulos** (visível apenas quando `chapters.applicable === true`, i.e., `Vídeo transformado`): explica `script_not_approved` / `narration_required` / `too_few_chapters` quando `!canGenerate`, botão `"Atualizar capítulos"` (`packaging.refresh_chapters`) quando `ready`, e validadores instantâneos não bloqueantes (`role="status"`: `first_chapter_not_zero`, `too_few_chapters`, `chapter_too_short`, `chapters_not_ordered`, `invalid_chapter_format`, `chapter_past_end`, `hasDelimiters === false`);
      - **Crédito protegido (`credit`):** quando `credit.text !== null`, bloco visualmente separado com cadeado e `aria-readonly="true"` (*"Crédito da Fonte (preenchido pela Permissão — não editável)"*); quando `credit.warning === "no_permission"`, alerta informativo + link `"Registrar Permissão na Fonte"` (`#/projeto/:id/fontes/:fonteId`);
    - **Tags & Hashtags:** dois `<ListaChips>` (`30` tags / `500` chars / `<= 60` por tag; `15` hashtags com orientação não bloqueante `"Recomendado: até 3 hashtags..."`);
    - **Salvamento:** `"Salvar alterações"` (`packaging.edit`, habilitado quando alterado) + `"Copiar descrição completa"` (`copyText(fullDescription)` + toast `"Descrição copiada"`);
    - **Guardrails e Saída:** reutiliza `<ChecklistGuardaCorpos escopo="single" mostrarDivulgacaoIa ... />` (tipo do vídeo + regra *"Legenda, crop, filtros e trilha não contam como Transformação"*, Permissão, Roteiro/Narração + aviso `longFreezeTail > 5 s`, `unverifiedCount`, `over60s`, `AiDisclosureNote`, ciência única `guardrails.ack_direct_notice`), botão `"Exportar vídeo (MP4)"` (desabilitado se Fonte offline, acionando `aoAbrirExportacao` → `<DialogoExportarCorte>` da Onda 4 `#355`) e `"Ir para Mesa de Prontidão (Lote) →"` (`#/projeto/:id/exportacao`).

- [ ] **Step 1: Testes falhando** (`FichaEmpacotamento.test.tsx`):
  - com `current === null`, exibe `"Sugerir Empacotamento"` e `"Preencher manualmente"` desabilitado com `<Dica>` citando `#299`;
  - `"Sugerir Empacotamento"` pago abre `<ResumoCustoPrivacidade>` + `<ConfirmDialog>` antes de `packaging.generate { confirmed: true }`;
  - Título mostra validador `50–70` (`Curto` / `Ideal` / `Pode truncar no mobile`) sem bloquear salvamento; Descrição soma bytes UTF-8 + crédito contra `5000`;
  - bloco de crédito tem `aria-readonly="true"`; sem Permissão (`no_permission`) exibe link para `#/projeto/:id/fontes/:fonteId`;
  - digitar capítulos sem `00:00` mostra aviso `first_chapter_not_zero` em `role="status"` sem bloquear `packaging.edit`; clicar `"Atualizar capítulos"` chama `packaging.refresh_chapters`; `chapter_delimiters_missing` renderiza em `role="alert"`;
  - `<ChecklistGuardaCorpos>` exibe `AiDisclosureNote`, `longFreezeTail > 5 s`, `over60s` e botão de ciência chama `guardrails.ack_direct_notice`; `"Copiar descrição completa"` chama `copyText(fullDescription)`.
- [ ] **Step 2:** `cd front-v2; bun run test src/telas/corte/empacotar/FichaEmpacotamento.test.tsx` → FAIL.
- [ ] **Step 3:** Implementar `FichaEmpacotamento.tsx`.
- [ ] **Step 4:** `cd front-v2; bun run test src/telas/corte/empacotar/FichaEmpacotamento.test.tsx` → PASS.
- [ ] **Step 5:** Commit `feat(front-v2): FichaEmpacotamento com validadores YouTube, crédito protegido e Guardrails`.

---

### Tarefa 8: Orquestração de `EmpacotarCorte.tsx` (`#/projeto/:id/corte/:corteId/empacotar`), Teclado, E2E e Fechamento da Onda 5

**Files:**
- Create: `front-v2/src/telas/corte/empacotar/EmpacotarCorte.tsx`
- Modify: `front-v2/src/App.tsx` (ligar `rota.tela === 'corte' && rota.aba === 'empacotar'` ao `<EmpacotarCorte />` com `<ContextoCorteConectado />` no `<Shell semPaddingConteudo />`, removendo o último placeholder de `rota.tela === 'corte'`)
- Test: `front-v2/src/telas/corte/empacotar/EmpacotarCorte.test.tsx`, `front-v2/e2e/corte-empacotar.spec.ts`

**Interfaces:**
- Consumes: `useEmpacotarCorte` (`~/stores/empacotarCorte`); `useFontesProjeto` (`~/stores/fontesProjeto`); `useSelecaoProjeto` (`~/stores/selecaoProjeto`); `estadoForcado`, `<ComEstado>` (`~/shell/EstadoForcado`); `useAtalhos` (`~/comandos/atalhos`); `<ContextoCorteConectado>`, `<DialogoExportarCorte>` (`~/telas/corte/...`, Onda 4 `#355`); `<PainelCapa>`, `<FichaEmpacotamento>`; `@ds` (`AreaRolagem`, `BannerErroCore`, `Esqueleto`, `useToast`).
- Produces:
  - `<EmpacotarCorte projetoId corteId runId? />`:
    - **Guardas de entrada:** `avulso-*` redireciona para `#/projeto/:id/corte/:corteId/editar`; `:corteId` inexistente/não aprovado redireciona para `#/projeto/:id/cortes` com toast; funciona para `Corte direto` e `Vídeo transformado` (incluindo Cortes e fichas de Projetos existentes da V1); Fonte `offline`/`changed` bloqueia preview de capa, `thumbnail.export` e `export.start` mantendo 100% da ficha textual editável via SQLite;
    - **Layout 2 colunas acopladas:** `42% / 58%` em `1366×768` (`40% / 60%` em `1440+ px`) com `AreaRolagem` independente em cada coluna e `≤ 68 ch` na Ficha, sem rolagem externa na janela;
    - **Todos os 6 estados §6:** `loading` (`<Esqueleto>` de player 16:9 à esquerda + campos à direita), `empty` (sem capa e/ou sem ficha), `error` (`<BannerErroCore>` em `role="alert"` para `local_only_violation`, `edit_invalid`, `export_glyph_missing`, `chapter_delimiters_missing`, `thumbnail_exists`, `component_missing`, etc.), `ready`, `job_running` (`ai:thumbnail`, `ai:packaging`, `proxy`, `export` sem travar edição do outro recurso), `partial` (capa sem ficha, `chapters.status !== 'ready'`, `no_permission` ou Fonte `offline`);
    - **Teclado e `F6`:** `F6`/`Shift+F6` cicla regiões (Topo/`<ContextoCorte>` → Coluna Capa → Coluna Ficha/Guardrails → Barra de Status); `Mod+S` salva ficha (`packaging.edit`); `Mod+E` abre `<DialogoExportarCorte>`; `Espaço`/`J`/`K`/`L`/`←`/`→` operam o preview da capa apenas fora de `input`/`textarea`/`select` respeitando WCAG 2.1.4; registra comandos da Paleta (`Ctrl+K`) para `Sugerir capa`, `Usar quadro atual`, `Sugerir Empacotamento`, `Atualizar capítulos`, `Exportar capa PNG`, `Exportar vídeo MP4`.
  - **Fechamento da Onda 5:** verificação completa em `front-v2/` (`typecheck`, `test`, `playwright test`, `bunx impeccable detect --json front-v2/src` e screenshots `1366×768` / `1440×900`).

- [ ] **Step 1: Testes falhando** (`EmpacotarCorte.test.tsx`):
  - `avulso-*` redireciona para `/editar`; `:corteId` ausente redireciona para `/cortes`;
  - todos os 6 estados §6 (`loading`, `empty`, `error` `export_glyph_missing`/`local_only_violation`, `ready`, `job_running`, `partial` com Fonte `offline` mantendo Ficha editável);
  - `Ctrl+S` chama `packaging.edit`; `Ctrl+E` abre `<DialogoExportarCorte>`; `Espaço`/`←`/`→` controlam preview apenas fora de campos de texto e com `teclasUnicas: true` (WCAG 2.1.4); `F6` cicla regiões.
- [ ] **Step 2:** `cd front-v2; bun run test src/telas/corte/empacotar/EmpacotarCorte.test.tsx` → FAIL.
- [ ] **Step 3:** Implementar `EmpacotarCorte.tsx` e ligar aba `empacotar` em `App.tsx`.
- [ ] **Step 4:** `cd front-v2; bun run test src/telas/corte/empacotar/EmpacotarCorte.test.tsx` → PASS.
- [ ] **Step 5: E2E Playwright (`front-v2/e2e/corte-empacotar.spec.ts`)** em `1366×768` e `1440×900` (cobrindo os 10 critérios de aceite de `E-corte-transformar-empacotar.md` Tela 2 §10):
  1. `?estado=vazio` exibe estado vazio da capa e CTA `"Sugerir Empacotamento"` (mais botão `#299` desabilitado);
  2. `"Sugerir momento da capa"` pago abre `<ResumoCustoPrivacidade>` + `<ConfirmDialog>` antes de `thumbnail.suggest { confirmed: true }`;
  3. Mover scrubber e clicar `"Usar quadro atual como capa"` chama `thumbnail.choose` e mostra `"Escolhido por você"`;
  4. `"Salvar capa (PNG)"` chama `thumbnail.export` e exibe toast `"Capa salva"`;
  5. Crédito da Fonte é `aria-readonly="true"` e contador UTF-8 soma `description + credit` contra `5000 bytes`;
  6. Fonte sem Permissão exibe alerta + link para `#/projeto/:id/fontes/:fonteId`;
  7. Capítulos sem `00:00` exibem aviso sem bloquear `packaging.edit` (`Ctrl+S`); `"Atualizar capítulos"` preserva texto fora dos delimitadores;
  8. `Corte direto` com `needsDirectNotice` confirma `guardrails.ack_direct_notice` e oculta pendência;
  9. `?estado=offline` bloqueia preview/PNG/MP4 mantendo Ficha editável;
  10. `F6` e `Tab` navegam entre regiões com foco visível, alvos `≥ 24 px`, zero `pageerror` e zero scroll horizontal externo.
  `cd front-v2; bunx playwright test e2e/corte-empacotar.spec.ts` → PASS.
- [ ] **Step 6: Fechamento da Onda 5** — `cd front-v2; bun run typecheck; bun run test; bunx playwright test` → 100% verde; `bunx impeccable detect --json front-v2/src` → sem achados críticos; anexar screenshots `1366×768` e `1440×900` de `#/projeto/demo/corte/:id/transformar` e `#/projeto/demo/corte/:id/empacotar` ao PR final.
- [ ] **Step 7:** Commit `feat(front-v2): tela Empacotar do Corte (#/projeto/:id/corte/:corteId/empacotar) e fechamento da Onda 5`.

---

## Tickets

Agrupamento das 8 tarefas em **5 tickets** executáveis em PRs pequenos. Após o ticket base **T1**, os tickets **T2**, **T3** e a primeira parte de **T5** (`PainelCapa` + `FichaEmpacotamento`) têm arquivos 100% disjuntos e podem avançar em paralelo (fazendo rebase onde **T4** e **T5** editam `front-v2/src/App.tsx`, conforme `docs/agents/impedimentos.md`).

| Ticket | Título | Tarefas | Depende de | Arquivos criados / editados | Lacunas do mock TS fechadas |
|---|---|---|---|---|---|
| **T1** | `front-v2(onda 5): Mock TS, erros, componentes auxiliares e stores de Transformar e Empacotar` | Tarefas 1, 2 | Onda 0 (`#315`–`#317`), Onda 1 (`#329`, `#330`), Onda 2 (`#342`), Onda 3 (`#348`), Onda 4 (`#354`) | `src/lib/core.ts`, `src/lib/scriptMock.ts`, `src/lib/thumbnailMock.ts`, `src/lib/packagingMock.ts`, `front-v2/src/core/erros.ts`, `front-v2/src/componentes/ListaChips.tsx`, `front-v2/src/componentes/ContadorLimite.tsx`, `front-v2/src/componentes/GravadorTeleprompter.tsx`, `front-v2/src/stores/transformarCorte.ts`, `front-v2/src/stores/empacotarCorte.ts`, `front-v2/src/core/erros.test.ts`, `transformarEmpacotarMock.test.ts`, `front-v2/src/componentes/ListaChips.test.tsx`, `ContadorLimite.test.tsx`, `GravadorTeleprompter.test.tsx`, `front-v2/src/stores/transformarCorte.test.ts`, `empacotarCorte.test.ts` | Remove portões ocultos (`?script-paid`, `?packaging-*`, `?thumbnail-*`, `?narration-deviation`, `?record-no-*`); indexa `scriptMock`/`thumbnailMock`/`packagingMock`/`narration` por `candidate`; implementa `script.narration_allowed`, `profileId`/`block` em `script.estimate`/`regenerate` e `title`/`refs` em `script.edit`; aplica limites YouTube em `packaging.edit` e validações em `thumbnail.export`; consulta Permissão real por `sourceId`; emite `core-progress` para `ai:angles:*`, `ai:script:*`, `ai:script_block:*`, `ai:thumbnail:*`, `ai:packaging:*`, `narration`, `narration_import`, `aligning`, `narration_record` (inclusive residual `"0"` `#293`); serve WAVs simulados para `narration-original/` e `narration-clean/` |
| **T2** | `front-v2(onda 5): Sub-aba Transformar — Transcrição, Passo 1 (Ângulo) e Passo 2 (Roteiro)` | Tarefa 3 | **T1** | `front-v2/src/telas/corte/transformar/PainelTranscricaoTransformar.tsx`, `PassoAngulo.tsx`, `PassoRoteiro.tsx`, `PainelTranscricaoTransformar.test.tsx`, `PassoAngulo.test.tsx`, `PassoRoteiro.test.tsx` | — *(consome T1)* |
| **T3** | `front-v2(onda 5): Sub-aba Transformar — Passo 3 (Narração JIT, Teleprompter, Limpeza e Alinhamento)` | Tarefa 4 | **T1**, Onda 1 (`#329`, `#330`) | `front-v2/src/telas/corte/transformar/PassoNarracao.tsx`, `PassoNarracao.test.tsx` | — *(consome T1)* |
| **T4** | `front-v2(onda 5): Orquestração de Transformar (#/projeto/:id/corte/:corteId/transformar), Teclado e E2E` | Tarefa 5 | **T1**, **T2**, **T3**, Onda 4 (`#355`, `#358`) | `front-v2/src/telas/corte/transformar/TransformarCorte.tsx`, `front-v2/src/App.tsx`, `front-v2/src/telas/corte/transformar/TransformarCorte.test.tsx`, `front-v2/e2e/corte-transformar.spec.ts` | — *(consome T1)* |
| **T5** | `front-v2(onda 5): Sub-aba Empacotar (#/projeto/:id/corte/:corteId/empacotar), E2E e fechamento` | Tarefas 6, 7, 8 | **T1**, **T4** *(ou apenas rebase em `App.tsx`)*, Onda 1 (`#329`), Onda 4 (`#355`, `#358`) | `front-v2/src/telas/corte/empacotar/PainelCapa.tsx`, `FichaEmpacotamento.tsx`, `EmpacotarCorte.tsx`, `front-v2/src/App.tsx`, `PainelCapa.test.tsx`, `FichaEmpacotamento.test.tsx`, `EmpacotarCorte.test.tsx`, `front-v2/e2e/corte-empacotar.spec.ts` | — *(consome T1)* |

### Critérios de aceite por ticket

#### T1 — `front-v2(onda 5): Mock TS, erros, componentes auxiliares e stores de Transformar e Empacotar`
- [ ] Testes unitários em `erros.test.ts` e `transformarEmpacotarMock.test.ts` cobrindo todos os códigos `CoreError.code` do Pacote E (`angle_invalid`, `tts_model_missing`, `import_unsupported_format`, `narration_cleanup_failed`, `instant_out_of_cut`, `thumbnail_exists`, `chapter_delimiters_missing`, etc.) e contratos mock sem query flags ocultas.
- [ ] Testes de componente em `ListaChips.test.tsx`, `ContadorLimite.test.tsx` e `GravadorTeleprompter.test.tsx` cobrindo adição/remoção acessível, contagem UTF-8 + faixa `50–70`, modo `Passo` em `prefers-reduced-motion`, permissão de microfone negada e rascunho `no_speech_detected`.
- [ ] Testes unitários em `transformarCorte.test.ts` e `empacotarCorte.test.ts` cobrindo cálculo de bytes UTF-8, validadores de capítulo, resolução de `<ResumoCustoPrivacidade>` e filtro de `job === "0"` (`#293`) em `core-progress`.
- [ ] `bun run typecheck && bun run test` verdes no CI.

#### T2 — `front-v2(onda 5): Sub-aba Transformar — Transcrição, Passo 1 (Ângulo) e Passo 2 (Roteiro)`
- [ ] Testes de componente em `PainelTranscricaoTransformar.test.tsx` cobrindo `transcription.sentences`, marcação de `refsAtivas`, clique inserindo/alternando ID e rolagem para chip do ângulo.
- [ ] Testes de componente em `PassoAngulo.test.tsx` cobrindo estado vazio, `<ResumoCustoPrivacidade>` + `<ConfirmDialog focoInicial="cancelar">` em `angles.estimate`/`generate`, validação de ângulo manual (`1..60` / `1..200`) e `<ConfirmDialog>` em `angle_change_confirmation`.
- [ ] Testes de componente em `PassoRoteiro.test.tsx` cobrindo banner ADR-0001, edição com `Ctrl+S` voltando para `Pendente`, bloqueio de `"Aprovar bloco"` enquanto sujo, `script.narration_allowed` ao aprovar último bloco e `"Refazer com outro Perfil…"` (`profileId`).
- [ ] `bun run typecheck && bun run test` verdes no CI.

#### T3 — `front-v2(onda 5): Sub-aba Transformar — Passo 3 (Narração JIT, Teleprompter, Limpeza e Alinhamento)`
- [ ] Testes de componente em `PassoNarracao.test.tsx` cobrindo trava pedagógica ADR-0001 (`narrationAllowed === false`) com `"Voltar ao próximo bloco pendente"`, sub-superfície 3A via `<InstaladorJustInTime recurso="tts" />` (`#330` / `#301`), confirmação ao sobrescrever áudio gravado/importado com TTS, gravação via `<GravadorTeleprompter>` + `"Aparar silêncios agora"` (`narration.trim_block`), limpeza Antes/Depois via `mediaUrl('narration-original/...')` / `'narration-clean/...'` com loading local (`#306`), botão `"Remover áudio"` desabilitado com `<Dica>` citando `#306` e resolução de `needs_review` (`narration.review`).
- [ ] `bun run typecheck && bun run test` verdes no CI.

#### T4 — `front-v2(onda 5): Orquestração de Transformar (#/projeto/:id/corte/:corteId/transformar), Teclado e E2E`
- [ ] Testes de componente em `TransformarCorte.test.tsx` cobrindo guardas de rota (`Corte direto` e `avulso-*` redirecionando para `/editar` com toast, `:corteId` ausente → `/cortes`), Cortes, Roteiros e Narrações de Projetos V1 existentes, todos os estados §6 (`loading`, `empty`, `error`, `ready`, `job_running`, `partial` inclusive Fonte `offline`), `Ctrl+[` à esquerda, `Ctrl+S` contextual, `F6`/`Shift+F6` e Paleta (`Ctrl+K`).
- [ ] Fluxo Playwright em `1366×768` e `1440×900` (`front-v2/e2e/corte-transformar.spec.ts`) verde cobrindo todos os 10 critérios de aceite da Tela 1 (`E-corte-transformar-empacotar.md` §10), sem `pageerror` nem scroll horizontal externo.
- [ ] `bun run typecheck && bun run test && bunx playwright test e2e/corte-transformar.spec.ts` verdes no CI.

#### T5 — `front-v2(onda 5): Sub-aba Empacotar (#/projeto/:id/corte/:corteId/empacotar), E2E e fechamento`
- [ ] Testes de componente em `PainelCapa.test.tsx` cobrindo `<PlayerProxy modo="capa">`, scrubber `role="slider"` em `[startUs, endUs]`, `<ResumoCustoPrivacidade>` + `<ConfirmDialog>` em `thumbnail.suggest`, `thumbnail.choose`, `thumbnail.export` (e erro `thumbnail_exists`) e bloqueio em Fonte `offline`.
- [ ] Testes de componente em `FichaEmpacotamento.test.tsx` cobrindo estado vazio com ação `"Preencher manualmente"` desabilitada com `<Dica>` citando `#299`, validador `50–70` do título, contador UTF-8 de `description + credit` contra `5000 bytes`, crédito `aria-readonly="true"`, alerta `no_permission` com link para Fonte, validadores não bloqueantes de capítulos + `packaging.refresh_chapters`, `<ChecklistGuardaCorpos>` + `AiDisclosureNote` + `guardrails.ack_direct_notice` e `copyText`.
- [ ] Testes de componente em `EmpacotarCorte.test.tsx` cobrindo guardas (`avulso-*` → `/editar`), todos os estados §6 (`loading`, `empty`, `error`, `ready`, `job_running`, `partial` inclusive Fonte `offline` editável via SQLite), atalhos (`Ctrl+S`, `Ctrl+E`, `Espaço`/`J`/`K`/`L`/`←`/`→` respeitando WCAG 2.1.4) e ciclo `F6`/`Shift+F6`.
- [ ] Fluxo Playwright em `1366×768` e `1440×900` (`front-v2/e2e/corte-empacotar.spec.ts`) verde cobrindo todos os 10 critérios de aceite da Tela 2 (`E-corte-transformar-empacotar.md` §10), sem `pageerror` nem scroll horizontal externo.
- [ ] Fechamento da Onda 5: `bunx impeccable detect --json front-v2/src` limpo, screenshots `1366×768` e `1440×900` anexados ao PR e `bun run typecheck && bun run test && bunx playwright test` verdes no CI.
