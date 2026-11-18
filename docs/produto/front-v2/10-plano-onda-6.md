# Front v2 · Onda 6: Exportação, Fila, Relatos e Sobre

> **Para agentes:** SUB-SKILL OBRIGATÓRIA: `superpowers:subagent-driven-development` (recomendado) ou `superpowers:executing-plans` para executar tarefa por tarefa. Toda tarefa é TDD (`superpowers:test-driven-development`): teste falhando primeiro, depois o mínimo de código. Passos com checkbox (`- [ ]`).

**Goal:** Construir todas as superfícies finais do front v2 do Clipes — **Macro-etapa 3: Exportação** (`#/projeto/:id/exportacao?sub=prontidao|lotes` e alias `/exportacao/lotes`, com Mesa de Prontidão em grade, disparo de lote MP4 1080×1920 `-14 LUFS / -1 dBTP` sem marca d'água, histórico/detalhe de lotes com fallback `x264` e *"Exportar só este"*, inclusive para exportações e lotes de Projetos existentes da V1), **Painel Global da Fila de Jobs** (`Ctrl/Cmd+J` no Shell, unificando jobs persistidos do Projeto, Lotes de Fontes, Lotes de exportação, pausas de orçamento, resolução de `uncertain` e operações globais, integrado a `FechamentoJanela` de `#291`/PR #346 sem duplicar), **Relatos e Diagnóstico** (`#/relatos`, fluxo obrigatório em 2 passos do ADR-0006 sem telemetria) e **Sobre e Atualizações** (`#/sobre`, updater do Tauri via `releases/latest/download/latest.json`, `LICENSE` e `THIRD_PARTY_NOTICES.md`) — sobre a fundação da Onda 0 e os contratos das Ondas 1–4, com mock TS completo e testes Vitest + Playwright em `1366×768` e `1440×900`. *(A Onda 5 — Transformar e Empacotar — corre em paralelo em `09-plano-onda-5.md` e não é replanejada aqui; a Onda 6 depende só até a Onda 4.)*

**Architecture:** Telas, stores e componentes em `front-v2/src/` importam primitivas/componentes de `@ds` (`design-system-v2/src/index.ts`), reaproveitam `<SeletorCaminho>` (`#329`, Onda 1), `fontesProjeto` (`#342`, Onda 2), `selecaoProjeto` (`#348`, Onda 3), `<DialogoExportarCorte>` (`#355`, Onda 4), `FechamentoJanela` / `operacoesCriticasEmVoo` (`#291`, PR #346) e os utilitários puros de erro do updater (`src/features/updates/updateError.ts`), falando com o núcleo exclusivamente por `chamar<T>()` (`~/core/cliente`), `mensagemDeErro()` (`~/core/erros`), `useFila()` (`~/core/progresso`), `useRota()` (`~/rotas/useRota`) e `useAtalhos()` (`~/comandos/atalhos`). O mock TS em `src/lib/core.ts`, `src/lib/batchMock.ts` e `src/features/export/mock.ts` remove portões ocultos (`?source-test=1` em `jobs.*`), implementa `jobs.redo.estimate`, `jobs.redo`, `jobs.result`, `diagnostic.export`, `transcription.hardware.diagnostic`, enriquece `export.batch.*` com `encoderFallback` / eventos `core-progress` (`export_batch`, `export_batch_complete`, `export_batch_cancelled`) e dados de Projetos V1 no Projeto `"demo"`. Sem alterações em `core/` nem `src-tauri/`.

**Tech Stack:** React 19, TypeScript, Tailwind 4, `@base-ui/react` 1.9.0, `lucide-react`, Vite; testes com Vitest + Testing Library + jsdom (unidade e componente) e `@playwright/test` contra o mock (`VITE_CORE_MOCK=1`).

**Spec:** `docs/produto/front-v2/telas/F-exportacao-fila-relatos.md` (§1–§4), wireframes `docs/produto/front-v2/wireframes/F1-exportacao.html`, `F2-fila.html`, `F3-relatos.html` e `F4-sobre.html`, `DESIGN.md`, `docs/produto/front-v2/01-arquitetura.md` (§3 rotas, §4 shell, §5 fila/eventos, §6 estados, §7 custo/privacidade, §8 atalhos, §9 acessibilidade, §10 estado), `docs/produto/front-v2/02-consolidacao.md` (catálogo canônico, Questões #2, #7–#9, #16 e "Lacunas do mock TS"), `docs/adr/0005-projeto-portatil-com-sqlite.md`, `docs/adr/0006-relato-de-problemas-sem-telemetria.md`, `docs/adr/0009-custo-orcamento-e-auditoria-de-chamadas-de-ia.md`, `docs/adr/0010-perfis-multiplos-de-provedor-tarefa-para-perfil-e-somente-local.md` e `docs/produto/funcionalidades/{01-instalacao-e-sistema,06-roteiro-narracao-e-saida,07-provedores-jobs-e-eventos}.md`. Issue-mãe: `#288`.

## Global Constraints

Herdadas integralmente de [04-plano-implementacao.md](./04-plano-implementacao.md#global-constraints):

- Vocabulário canônico do `GLOSSARY.md` em PT-BR (Projeto, Fonte, VOD, Corte, Corte direto, Vídeo transformado, Transformação, Narração, Roteiro, Transcrição, Frase, Empacotamento, Permissão, Lote de Fontes, Provedor, Perfil de Provedor, Perfil de canal, Somente local). Nunca "clipe", "short", "input", "voice-over" nem "IA" como substantivo.
- Visual só pelos tokens e componentes de `design-system-v2/src/index.ts` (`@ds`) e regras do `DESIGN.md`: **A Regra da Luz Única** (um único botão primário `sinal` por tela — no card da Mesa de Prontidão só o botão da ação contextual principal ou na barra da Zona B o disparo do lote, sem dois botões `sinal` competindo no mesmo foco — e marca de seleção `marcado` de `2 px`), **A Regra do Estado Cinza** (`<Status>` nunca usa pílula colorida), **A Regra do Erro Sem Fundo** (`role="alert"` via `<BannerErroCore>`), **A Regra do Número Tabular** (`num` em todo timecode, duração, contador, porcentagem, bytes UTF-8 e custo) e **A Regra da Sombra Flutuante** (painéis/cartões ficam planos por degrau; sombra só em diálogos/popovers/gaveta sobreposta/toast).
- Revelação progressiva: detalhes técnicos (trace/`CoreError.code`, JSON bruto de `jobs.result`) ficam recolhidos em `<details>` ou `<BannerErroCore>`, nunca expostos crus na UI principal.
- WCAG 2.2 AA (`1366×768` sem rolagem da janela externa e verificado em `1440×900`, rolagem apenas interna em `AreaRolagem` / tabelas, alvos ≥ `24×24` CSS px, foco `.foco`/`.foco-interno`, teclas únicas respeitando o interruptor WCAG 2.1.4 e desabilitadas em campos de texto, `F6`/`Shift+F6` entre regiões, `<pre tabIndex={0}>` rolável por teclado em `#/sobre`).
- Toda chamada paga ou que envia texto para fora da máquina na Fila (`jobs.retry` com `safety === 'paid'`, `jobs.redo` com `paid`/`leavesMachine`, `batches.item.resume` com `confirmation_required`) passa por `<ResumoCustoPrivacidade>` + `<ConfirmDialog focoInicial="cancelar">` enviando `confirmed: true` (§7).
- Toda ação que depende de ticket aberto no núcleo (`#289`–`#307`) fica **desabilitada com `<Dica>` citando o ticket** (ou segue o contorno explícito da tabela abaixo).
- Nada de mudança em `core/` ou `src-tauri/`.
- Disco: `cargo clean` (se algo tiver compilado) e limpeza de `%TEMP%\clipes-<ticket>-*` antes de cada `worker_done` (`AGENTS.md`).

### Ações dependentes de tickets abertos no núcleo (#289–#307)

| Ticket aberto | Tela / Superfície afetada | Comportamento na Onda 6 |
|---|---|---|
| **#292** (`core(selection): converter Corte direto individual em Vídeo transformado`) | `#/projeto/:id/exportacao` (cards `Corte direto` na Mesa de Prontidão) | Se o menu secundário do card exibir `"Converter em Vídeo transformado"`, a ação fica **desabilitada** com `<Dica>` citando `#292` (`"Conversão individual para Vídeo transformado aguarda comando no núcleo (#292)."`). |
| **#298** (`core(export): criar comando agregado export.readiness para Mesa de Prontidão`) | `#/projeto/:id/exportacao` (Mesa de Prontidão) | Como `export.readiness` ainda não existe, `exportacaoProjeto.ts` carrega os aprovados por paginação sob demanda e cache (`sources.list` → `selection.list/get/review` → `packaging.get`/`thumbnail.get`/`guardrails.check` por página visível). Eventual botão/atalho `"Atualizar prontidão em lote (núcleo)"` fica omitido ou **desabilitado** com `<Dica>` citando `#298` (`"Consulta agregada em uma chamada aguarda export.readiness no núcleo (#298); carregamento paginado ativo."`). |
| **#300** (`core(diagnostic): inferir etapa real da falha em diagnostic.get`) | `#/relatos` (Passo 2 — pré-visualização editável) | Não desabilita ação; `diagnostic.get` fixa `"Etapa da falha: componente"` quando `diagnostic.log` não está vazio. A nota de ajuda do `<textarea>` editável informa explicitamente `#300` para que o usuário possa corrigir a linha da etapa antes de copiar/exportar/enviar. |
| **#303** (`core(jobs,export): expor startedAtMs e alvo em jobs.list + export.settings.set`) | `#/projeto/:id/exportacao` (Zona B) e `PainelFilaJobs` (`Ctrl+J`) | 1) Na Zona B de Exportação, escolher pasta atualiza o estado local (enviado em `export.batch.start` / `export.start`); o botão `"Salvar pasta padrão"` fica **desabilitado** com `<Dica>` citando `#303` (`"Persistir pasta padrão sem exportar aguarda export.settings.set no núcleo (#303)."`).<br>2) Na Fila de Jobs, `jobs.list` não traz `startedAtMs` nem rótulo de Fonte/Corte: ETA é calculado apenas para jobs determinísticos observados desde `0%` na sessão atual via `useFila()` e omitido após reload/estágios `ai:*` (com dica citando `#303` quando indisponível após recarga), exibindo `#<id>`, `batch` e `profile` sem inventar nomes. |
| **#304** (`core(jobs): avaliar atualização de selection_runs.revision em jobs.redo`) | `PainelFilaJobs` (`Ctrl+J` → diálogo `"Refazer com outro Perfil"`) | Para jobs `ai:selection*`, `"Refazer com outro Perfil"` (`jobs.redo`) re-enfileira apenas a unidade sem incrementar `selection_runs.revision`; exibe nota e `<Dica>` citando `#304` (*"Refazer pela Fila não cria nova Revisão na Bancada (#304); para nova Revisão, use Cortes → Revisão."*). |
| **#307** (`core(telemetry): campos informativos extras...` — `components.active_jobs`) | `PainelFilaJobs` (`Ctrl+J` → seção **Operações globais**) | Operações globais síncronas (`components.download`, `sources.url.download`, etc.) vivem apenas na memória de `useFila()` durante a sessão aberta; após reload da WebView não há `components.active_jobs` para reidratá-las (`#307`), exibindo nota discreta quando aplicável. |

> **Nota sobre `#289`, `#291` e `#293`:** `#289` já está fechado no núcleo (`encoderFallback` em `export.status` e `export.batch.*`); `#293` (`job === '0'` residual) já é filtrado em `front-v2/src/core/progresso.ts`; e `#291` (PR #346) já implementa `FechamentoJanela.tsx` no `Shell` lendo `operacoesCriticasEmVoo(jobs)` sobre `useFila()`. A Onda 6 **reconcilia** jobs persistidos/lotes com `useFila()` (garantindo que exportações e chamadas pagas ativas sejam visíveis a `FechamentoJanela`) e **reutiliza** `operacoesCriticasEmVoo` no reinício (`relaunch`) de `#/sobre`, **sem duplicar** o listener `app-close-requested`.

## Review Focus

1. **Fonte única da Fila e integração sem duplicação com `#291` (PR #346):** `PainelFilaJobs` (`Ctrl/Cmd+J`) não pode registrar outro `listen('core-progress')` nem outro `listen('app-close-requested')`. Ele lê `useFila()` (`~/core/progresso`) + store de reconciliação (`filaGlobal.ts` para `jobs.list`, `batches.list`, `export.batch.list`, `jobs.budget.get`) disparando atualização com *debounce* nos eventos terminais (`complete`, `failed`, `ai:*:done`, `ai:*:paused`, `batch:*`, `export_batch*`), invalidando os caches de `fontesProjeto`/`selecaoProjeto`/`exportacaoProjeto` e disparando toast / notificação nativa do SO apenas quando `!document.hasFocus()` ou `document.hidden`. `FechamentoJanela.tsx` continua sendo o único guardião de `app-close-requested`, e `#/sobre` usa `operacoesCriticasEmVoo` antes de `relaunch()`.
2. **Proteção contra cobrança dupla (`uncertain`, `jobs.redo`, `cost_unknown` e `Somente local`):** nenhum fluxo repete `state === 'uncertain'` automaticamente (`ADR-0005` / `ADR-0009`). `jobs.retry` com `safety === 'paid'` exige `jobs.estimate` → `<ConfirmDialog focoInicial="cancelar">` com `<ResumoCustoPrivacidade>` + `confirmed: true` (enquanto `safety === 'local'` pode repetir direto); `jobs.redo` exige `jobs.redo.estimate` + `<ConfirmDialog>` se `paid` ou `leavesMachine` e bloqueia confirmação com banner `role="alert"` quando `Somente local` veta o Perfil (`ADR-0010`); `jobs.budget.continue` com `paused === 'cost_unknown'` exige confirmação explícita (`confirmed: true`); e `batches.item.resume` tratando `uncertain_job` rola/foca o item `uncertain` correspondente.
3. **Contrato da Mesa de Prontidão, Projetos V1 e `export.batch.start`:** `core/src/export/batch.rs` valida `args.project === projects.current.path` (`invalid_project` se divergir). Projetos V1 existentes podem ter candidatos aprovados sem `packaging.get`/`thumbnail.get` (`current === null` → fallback `"Título sugerido (sem Empacotamento)"` e `"Sem capa"`), Fontes `offline`/`changed` (não bloqueiam o disparo do lote inteiro, mas avisam na Zona B e falham por item em `?sub=lotes` com recuperação *"Relocalizar Fonte"*), além de lotes V1 parciais pré-existentes (`status: 'partial'`). A Mesa usa paginação sob demanda (`#298`), executa `guardrails.ack_direct_notice` quando `needsDirectNotice === true`, trata `confirmation_required` (`usage.conflicts`) listando arquivos a sobrescrever, reutiliza `<DialogoExportarCorte>` (`#355`) em *"Exportar só este"* e atualiza `?sub=lotes` com `encoderFallback` por `core-progress` sem `setInterval`.
4. **Regra obrigatória de 2 passos em `#/relatos` (ADR-0006) e limite de 8.000 bytes UTF-8:** antes de clicar em **"Revisar relato antes de enviar"**, os botões **Copiar texto**, **Exportar diagnóstico (.txt)** e **Abrir no GitHub** **não existem no DOM**. No Passo 2, `copyText` e `diagnostic.export { path, text }` (com diálogo nativo `save` no Tauri ou download `Blob` no navegador) usam exatamente o texto editado pelo usuário no `<textarea>`. Ao montar a URL `https://github.com/GUSTAVOHOOO/clipes/issues/new?...`, validar `new TextEncoder().encode(url).length > 8000` para copiar o diagnóstico automaticamente e substituir o corpo pelo texto + aviso; e o detector `/token|chave|\bkey\b/i` exibe `role="alert"` sem roubar foco da digitação.
5. **Updater em `#/sobre` sem instalação automática (US-16/US-17/US-121) e limites de `capabilities/default.json`:** o verificador aponta para `https://github.com/GUSTAVOHOOO/clipes/releases/latest/download/latest.json` (`src-tauri/tauri.conf.json`), nunca inicia download sem clique em **"Baixar e instalar"**, diferencia erro de rede/offline de `invalid-signature` (`src/features/updates/updateError.ts`) bloqueando instalação em `role="alert"`, e exibe aviso se houver `operacoesCriticasEmVoo` antes de `relaunch()`. Como `src-tauri/capabilities/default.json` (intocado nesta onda) restringe `opener:allow-open-url` a `issues/new*` e não habilita `opener:allow-open-path`, helpers de desktop (`abrirPastaOuArquivo`, `abrirUrlExterna`) devem tratar recusa do `opener` fora do mock copiando o caminho/URL com toast explicativo até a Onda 7 atualizar as permissões.

---

## Onda 6 · Exportação, Fila, Relatos e Sobre

**Estrutura de arquivos:**

```text
src/lib/
  core.ts                             remove portão ?source-test de jobs.*; implementa jobs.redo.estimate, jobs.redo, jobs.result, diagnostic.export, transcription.hardware.diagnostic; enriquece diagnostic.get e Projeto "demo" com cortes/lotes V1
  batchMock.ts                        suporte a item paused/uncertain_job e eventos core-progress batch:* coerentes
src/features/export/
  mock.ts                             suporte a lotes iniciais V1 (inclusive partial com encoderFallback), ?estado=vazio|erro|carregando|parcial|fallback e eventos core-progress export_batch / export_batch_complete / export_batch_cancelled

front-v2/
  package.json, bun.lock              (se adicionar plugins Tauri updater/process/opener/clipboard/dialog, manter mesmas versões da raiz e atualizar bun.lock; alternativa: wrappers via invoke como SeletorCaminho.tsx)
  src/
    core/
      erros.ts                        amplia TABELA_ERROS com códigos do Pacote F (exportação em lote, fila, relatos)
      progresso.ts                    suporte a hidratação/reconciliação com jobs ativos do Projeto sem duplicar listener core-progress
      desktop.ts                      helpers de área de transferência, saveDialog (.txt), abrirUrlExterna, abrirNoSistema (compatível com window.__CLIPES_E2E__)
    rotas/
      rotas.ts                        adiciona query ?tipo=bug|ideia|provedor na rota relatos
    stores/
      filaGlobal.ts                   store reativo da Fila Unificada (jobs.list, batches.list, export.batch.list, jobs.budget.get, invalidações, notificações SO)
      exportacaoProjeto.ts            store paginado + cache (#298) da Mesa de Prontidão e Lotes de Exportação
      atualizador.ts                  serviço compartilhado de atualização (@tauri-apps/plugin-updater + updateError.ts + mock ?updater-test=)
    telas/fila/
      DialogosFila.tsx                diálogos Tentar de novo (jobs.estimate→retry), Descartar (jobs.discard), Refazer com outro Perfil (jobs.redo.estimate→redo + #304), Resultado (jobs.result) e Orçamento (jobs.budget.set/continue)
      PainelFilaJobs.tsx              gaveta global acoplável Ctrl+J (4 trilhas, filtros, banners uncertain/orçamento, sublista batches, operações globais, F6/Esc)
    shell/
      Shell.tsx                       integra PainelFilaJobs (Ctrl+J), badge de prioridade (uncertain/ai_pauses) no GatilhoFila, resumo na BarraStatus, F6 com gaveta aberta e leitura única para FechamentoJanela (#291)
    telas/exportacao/
      MesaProntidao.tsx               Zona A (grade responsiva 2 cols 1366 / 3–4 cols 1440+, filtros, glifos, "Exportar só este" via DialogoExportarCorte) + Zona B (escopo, SeletorCaminho, encoder, ChecklistGuardaCorpos, disparo com ack_direct_notice e conflitos)
      HistoricoLotes.tsx               Zona C (lista de lotes) + Zona D (tabela role="grid", fallback x264, ações por item, progresso core-progress, cancelar lote)
      Exportacao.tsx                  #/projeto/:id/exportacao?sub=prontidao|lotes (orquestração, 5 regiões F6, estados §6, V1)
    telas/relatos/
      Relatos.tsx                     #/relatos?tipo=bug|ideia|provedor (ADR-0006 em 2 passos, detector de segredos, sonda hardware, allowlist, #300, export .txt e GitHub > 8 KB)
    telas/sobre/
      Sobre.tsx                       #/sobre (app.version, atualizador com guarda operacoesCriticasEmVoo #291, abas LICENSE e THIRD_PARTY_NOTICES.md com busca)
    App.tsx                           liga rotas exportacao, relatos e sobre
  e2e/
    fila-jobs.spec.ts                 Playwright Painel Global da Fila (1366×768 e 1440×900)
    exportacao.spec.ts                Playwright Mesa de Prontidão e Histórico de Lotes (1366×768 e 1440×900)
    relatos.spec.ts                   Playwright Relatos e Diagnóstico (1366×768 e 1440×900)
    sobre.spec.ts                     Playwright Sobre e Atualizações (1366×768 e 1440×900)
```

---

### Tarefa 1: Erros, rotas, helpers de desktop e atualização do mock TS (Fila, Exportação em lote, Relatos e Sobre)

**Files:**
- Modify: `front-v2/src/core/erros.ts` (adicionar em `TABELA_ERROS` os códigos do Pacote F ausentes: `export_batch_empty`, `batch_not_found`, `job_uncertain`, `job_not_redoable`, `task_version_changed`, `invalid_profile`, `uncertain_job`, `invalid_budget`, `invalid_job_state`, `invalid_path`, `invalid_text`, `settings`)
- Modify: `front-v2/src/rotas/rotas.ts` (estender `{ tela: 'relatos'; tipo?: 'bug' | 'ideia' | 'provedor' }` lendo `?tipo=`)
- Create: `front-v2/src/core/desktop.ts` (wrappers `copiarTexto`, `salvarDialogo`, `abrirUrlExterna`, `abrirNoSistema`, `notificarSistema` respeitando `window.__CLIPES_E2E__`, `isTauri()` e fallback seguro no navegador/quando `capabilities` restringir)
- Modify: `src/lib/core.ts` (remover exigência de `?source-test` em `jobs.list`/`estimate`/`retry`/`discard`; implementar `jobs.redo.estimate`, `jobs.redo`, `jobs.result`, `diagnostic.export`, `transcription.hardware.diagnostic`; enriquecer `diagnostic.get` com blocos reais da allowlist sem caminhos pessoais; manter no Projeto `"demo"` jobs realistas `uncertain`, `budgetPause`, `ai:*` concluídos/falhos para demonstrar Fila e V1)
- Modify: `src/lib/batchMock.ts` (suporte a item com erro `timeout_uncertain` para testar `uncertain_job` em `batches.item.resume` e emissão de eventos `core-progress` coerentes)
- Modify: `src/features/export/mock.ts` (popular lote histórico V1 inicial `partial` com item `encoderFallback` `h264_nvenc` → `libx264` e item `failed`, suportar `?estado=vazio|erro|carregando|parcial|fallback`, emitir eventos `core-progress` `export_batch`, `export_batch_complete`, `export_batch_cancelled` e `export` por item via `emitirProgressoMock` sem precisar de `setInterval`)
- Test: `front-v2/src/core/erros.test.ts`, `front-v2/src/rotas/rotas.test.ts`, `front-v2/src/core/desktop.test.ts`, `front-v2/src/core/onda6Mock.test.ts`

**Interfaces:**
- Consumes: `emitirProgressoMock` (`src/lib/core.ts`), `ErroCore` (`~/core/cliente`).
- Produces:
  - `TABELA_ERROS` completa para todos os códigos de `F-exportacao-fila-relatos.md` §§1.5, 2.5, 3.5 e 4.5.
  - `resolver('#/relatos?tipo=provedor', { projetoAberto: null })` → `{ rota: { tela: 'relatos', tipo: 'provedor' } }`.
  - Mocks TS sem portões ocultos aderentes a `core/src/export/batch.rs`, `core/src/jobs.rs`, `core/src/jobs/ai.rs`, `core/src/jobs/redo.rs`, `core/src/diagnostic.rs`, `core/src/components/hardware.rs` e `core/src/version.rs`.

- [ ] **Step 1: Testes falhando** —
  - `erros.test.ts`: valida tradução + recuperação de `export_batch_empty`, `batch_not_found`, `job_uncertain`, `job_not_redoable`, `task_version_changed`, `invalid_budget`, `invalid_path`, `invalid_text`, `settings`;
  - `rotas.test.ts`: testa `#/relatos?tipo=bug|ideia|provedor` e `?tipo=invalido` (ignorado);
  - `desktop.test.ts`: valida fila E2E (`window.__CLIPES_E2E__`) em `copiarTexto`, `salvarDialogo`, `abrirUrlExterna` e fallback sem lançar exceção quando `opener` falha;
  - `onda6Mock.test.ts` (sem query flags ocultas): `jobs.list`, `jobs.estimate`, `jobs.retry` (`confirmation_required` vs `confirmed: true`), `jobs.discard`, `jobs.redo.estimate` / `jobs.redo`, `jobs.result`, `export.batch.start` (validando `conflicts` + `confirmed: true`), `export.batch.status`/`list`/`cancel` emitindo `core-progress` (`export_batch*`), `diagnostic.get`, `diagnostic.export` (`invalid_path`/`invalid_text`) e `transcription.hardware.diagnostic` (e `null` em `?estado=vazio`).
- [ ] **Step 2:** `cd front-v2; bun run test src/core/erros.test.ts src/rotas/rotas.test.ts src/core/desktop.test.ts src/core/onda6Mock.test.ts` → FAIL.
- [ ] **Step 3:** Atualizar `erros.ts`, `rotas.ts`, criar `desktop.ts` e atualizar `src/lib/core.ts`, `src/lib/batchMock.ts` e `src/features/export/mock.ts`.
- [ ] **Step 4:** `cd front-v2; bun run test src/core/erros.test.ts src/rotas/rotas.test.ts src/core/desktop.test.ts src/core/onda6Mock.test.ts` → PASS.
- [ ] **Step 5:** Commit `feat(front-v2): erros, rotas, desktop e mock TS da Onda 6`.

---

### Tarefa 2: Stores reativos (`filaGlobal.ts`, `exportacaoProjeto.ts`, `atualizador.ts`) e reconciliação com `#291`

**Files:**
- Modify: `front-v2/src/core/progresso.ts` (expor método opcional `sincronizarExterno` / registro de jobs em andamento vindos de `jobs.list`/`export.batch.list` para que `FechamentoJanela.tsx` enxergue operações críticas em voo mesmo após reload, sem duplicar `listen('core-progress')`)
- Create: `front-v2/src/stores/filaGlobal.ts`, `front-v2/src/stores/exportacaoProjeto.ts`, `front-v2/src/stores/atualizador.ts`
- Test: `front-v2/src/stores/filaGlobal.test.ts`, `front-v2/src/stores/exportacaoProjeto.test.ts`, `front-v2/src/stores/atualizador.test.ts`

**Interfaces:**
- Consumes: `chamar`, `ErroCore` (`~/core/cliente`); `Fila`, `useFila`, `Job` (`~/core/progresso`); `useFontesProjeto` (`~/stores/fontesProjeto`, Onda 2); `useSelecaoProjeto` (`~/stores/selecaoProjeto`, Onda 3); `isSignatureOrIntegrityError`, `isConnectivityError`, `shouldIgnoreAutoCheckError`, `formatUpdateError` (`../../../src/features/updates/updateError`); `isTauri`, `invoke` (`@tauri-apps/api/core`); `getUpdaterBehavior` (`../../../src/lib/desktop` ou equivalente em `~/core/desktop`).
- Real core commands used: `jobs.list`, `jobs.budget.get`, `batches.list`, `batches.get`, `export.batch.list`, `export.batch.status`, `sources.list`, `selection.list`, `selection.get`, `selection.review`, `packaging.get`, `thumbnail.get`, `guardrails.check`, `export.settings`, `export.encoder.status`.
- Produces:
  - `filaGlobal.ts` (`criarStoreFilaGlobal()` + `useFilaGlobal(projetoPath)`):
    - agrega as 4 trilhas da §5/`F.2`: (1) `jobs.list`, (2) `batches.list`, (3) `export.batch.list` e (4) operações globais transitórias (`project === null`) vindas de `useFila()`;
    - assina mudanças em `useFila()` para fazer refresh *debounced* de `jobs.list`/`batches.list`/`export.batch.list` quando chegam eventos terminais (`complete`, `failed`, `ai:*:done`, `ai:*:paused`, `batch:*`, `export_batch*`) e dispara callbacks de invalidação + notificação nativa do SO somente quando `!document.hasFocus() || document.hidden`;
    - expõe `contagemAtivos`, `contagemIncertos`, `pausasOrcamento` (`budgets.filter(b => b.paused !== null)`) para o `Shell` e limpa completamente as trilhas de Projeto quando `projetoPath === null` ou muda;
    - sincroniza jobs `running` críticos com `Fila` para que `FechamentoJanela` (`#291`/PR #346) não perca proteção após recarga.
  - `exportacaoProjeto.ts` (`criarStoreExportacaoProjeto()` + `useExportacaoProjeto(projetoPath)`):
    - carrega aprovados com paginação sob demanda e cache (`TAMANHO_PAGINA = 12`) até existir `export.readiness` (`#298`), combinando `sources.list`, `selection.list/get/review` (inclusive execuções V1) e carregando por página visível `packaging.get`, `thumbnail.get` e `guardrails.check { scope: 'single' }`;
    - carrega `guardrails.check { scope: 'project' | 'source' }`, `export.settings`, `export.encoder.status` e `export.batch.list`;
    - atualiza progresso de lote ativo em tempo real a partir de `useFila()` (`export-batch-<id>` e `<job_id>` numérico) e limpa todo cache ao trocar/fechar Projeto.
  - `atualizador.ts` (`criarStoreAtualizador()` + `useAtualizador()`):
    - unifica estado (`idle` | `checking` | `available` | `installing` | `installed` | `error` | `offline`) para `#/sobre` e eventual aviso na largada, apontando para o updater do Tauri (`endpoints: ["https://github.com/GUSTAVOHOOO/clipes/releases/latest/download/latest.json"]` de `src-tauri/tauri.conf.json`), respeitando `?updater-test=offline|invalid-signature|available|release-not-found|install-invalid-signature|install-network-error` e `VITE_UPDATER_MOCK` / `window.__CLIPES_E2E__.updaterMode`, e verificando `operacoesCriticasEmVoo` (`#291`) antes de `relaunch()`.

- [ ] **Step 1: Testes falhando** —
  - `filaGlobal.test.ts`: carrega as 3 trilhas de Projeto + operações globais; quando `projetoPath` vira `null`, oculta trilhas de Projeto mantendo globais; evento `export_batch_complete` dispara refresh de `export.batch.list` e notifica apenas quando `document.hidden === true`; job `running` hidratado de `jobs.list` é refletido para `FechamentoJanela` sem duplicar `core-progress`;
  - `exportacaoProjeto.test.ts`: pagina `packaging.get`/`thumbnail.get` em lotes de 12 itens (não dispara N+1 para 30 itens de uma vez, `#298`), usa cache ao navegar de volta, reage a `export_batch` em `useFila()` e zera cache quando `projetoPath` muda;
  - `atualizador.test.ts`: `checking` → `available` sem iniciar `downloadAndInstall` automaticamente; `?updater-test=invalid-signature` marca `signature: true` e bloqueia instalação; `navigator.onLine === false` entra em estado `offline` sem erro alarmante.
- [ ] **Step 2:** `cd front-v2; bun run test src/stores/filaGlobal.test.ts src/stores/exportacaoProjeto.test.ts src/stores/atualizador.test.ts` → FAIL.
- [ ] **Step 3:** Atualizar `progresso.ts` e implementar `filaGlobal.ts`, `exportacaoProjeto.ts` e `atualizador.ts`.
- [ ] **Step 4:** `cd front-v2; bun run test src/stores/filaGlobal.test.ts src/stores/exportacaoProjeto.test.ts src/stores/atualizador.test.ts` → PASS.
- [ ] **Step 5:** Commit `feat(front-v2): stores de Fila Global, Exportação paginada e Atualizador`.

---

### Tarefa 3: Diálogos da Fila (`DialogosFila.tsx`) e Painel Global da Fila de Jobs (`PainelFilaJobs.tsx`)

**Files:**
- Create: `front-v2/src/telas/fila/DialogosFila.tsx`, `front-v2/src/telas/fila/PainelFilaJobs.tsx`
- Test: `front-v2/src/telas/fila/DialogosFila.test.tsx`, `front-v2/src/telas/fila/PainelFilaJobs.test.tsx`

**Interfaces:**
- Consumes: `chamar`, `ErroCore`, `mensagemDeErro` (`~/core/cliente`, `~/core/erros`); `useFilaGlobal` (`~/stores/filaGlobal`); `useFila` (`~/core/progresso`); `abrirNoSistema` (`~/core/desktop`); `@ds` (`Abas`, `AreaRolagem`, `BannerErroCore`, `Botao`, `BotaoIcone`, `Campo`, `Checkbox`, `ConfirmDialog`, `Dica`, `Dialogo`, `Entrada`, `Esqueleto`, `EstadoTela`, `Progresso`, `ResumoCustoPrivacidade`, `Select`, `Status`, `TabelaGrade`, `Kbd`, `usd`, `useToast`).
- Real core commands used: `jobs.list`, `jobs.cancel`, `jobs.estimate`, `jobs.retry`, `jobs.discard`, `jobs.redo.estimate`, `jobs.redo`, `jobs.result`, `jobs.budget.get`, `jobs.budget.set`, `jobs.budget.continue`, `batches.list`, `batches.pause`, `batches.resume`, `batches.cancel`, `batches.item.resume`, `export.batch.list`, `export.batch.cancel`, `provider.profiles.list`, `projects.local_only.get`, `components.cancel`, `tts.models.cancel`, `sources.url.cancel`, `sources.cancel`.
- Produces:
  - `<DialogosFila>`:
    - **Tentar de novo (`uncertain`):** chama `jobs.estimate { id }`; se `safety === 'local'`, permite repetir sem custo extra; se `safety === 'paid'`, abre `<ConfirmDialog focoInicial="cancelar">` com `<ResumoCustoPrivacidade>` antes de `jobs.retry { id, confirmed: true }`;
    - **Descartar (`uncertain`):** `<ConfirmDialog focoInicial="cancelar">` chamando `jobs.discard { id }`;
    - **Refazer com outro Perfil (`ai:*` `completed`|`failed`|`cancelled`):** lista perfis de `provider.profiles.list`, chama `jobs.redo.estimate { id, profileId }`, exibe `<ResumoCustoPrivacidade>` e banner `role="alert"` bloqueando confirmação se `Somente local` vetar o Perfil (`ADR-0010`); quando `kind` começar com `ai:selection`, exibe nota + `<Dica>` citando `#304` (*"Refazer pela Fila não cria nova Revisão na Bancada (#304)."*); confirma com `jobs.redo { id, profileId, confirmed: true }`;
    - **Ver resultado (`ai:*`):** chama `jobs.result { id }` e exibe `outcome`, `usage`, `cost`, resumo de `data` / `violations` e JSON completo dentro de `<details>Expandir JSON completo</details>`;
    - **Ajustar orçamento e continuar:** edita `maxCostMicroUsd`/`maxCalls`/`maxTokens`, `resetUsage`, exige checkbox `confirmed: true` quando `paused === 'cost_unknown'` e chama `jobs.budget.continue` / `jobs.budget.set`.
  - `<PainelFilaJobs aberto aoFechar projetoAberto refRetornoFoco>`:
    - `<aside role="complementary" aria-label="Fila de Jobs">` acoplável (largura `470 px` em `1366` / `560 px` em `1440+`), fechável com botão `X` ou `Esc` devolvendo foco a `refRetornoFoco`;
    - **Zona 1 — Alertas Prioritários:** banner fixo sempre que houver `state === 'uncertain'` (*"Uma ou mais chamadas pagas foram interrompidas ou expiraram. O Clipes nunca as repete automaticamente para evitar cobrança dupla."* ADR-0005/0009) e banners de `budgets` com `paused !== null` (motivo traduzido + consumo acumulado vs teto + `"Ajustar orçamento e continuar"`);
    - **Zona 2 — Filtros (`Abas` `role="tablist"`):** `Todos`, `Ativos e na fila`, `Atenção`, `Concluídos`;
    - **Zona 3 — Lista Unificada (`AreaRolagem`):**
      1. Jobs persistidos (`jobs.list`) com mapeamento humano de todos os `kind` (`preview`, `proxy`, `transcription`, `energy`, `chat`, `reframe`, `narration*`, `export`, `ai:*`), estado, barra `<Progresso>` + ETA apenas quando observado desde `0%` na sessão atual em etapas determinísticas (nota `#303` quando indisponível após reload), cancelar (`jobs.cancel`, com `<ConfirmDialog>` quando `running && safety === 'paid'`) e botões de ação;
      2. Lotes de Fontes (`batches.list`) com `"Pausar"`, `"Retomar"`, `"Cancelar"` (`<ConfirmDialog>`), `"Orçamento"` e sublista expansível com `"Retomar Fonte"` (`batches.item.resume`, redirecionando foco ao card `uncertain` se retornar `uncertain_job`);
      3. Lotes de Exportação (`export.batch.list`) com `"Cancelar lote"` e link `"Abrir em Exportação"` (`#/projeto/:id/exportacao?sub=lotes`);
      4. Operações Globais (`useFila()` com `project === null`) roteando cancelamento por prefixo (`components.cancel`, `tts.models.cancel`, `sources.url.cancel`, `sources.cancel`), com nota `#307` quando aplicável;
    - Todos os estados §6 (`loading` 4 `<Esqueleto variante="lista" />`, `empty` sem Projeto vs Projeto sem jobs, `error` `<BannerErroCore>` com `local_only_violation` / `confirmation_required` / `job_uncertain` / `job_not_redoable` / `task_version_changed` / `profile_unavailable` / `uncertain_job` / `budget_*` / `invalid_budget` / `project_busy`, `ready`, `job_running`, `partial`).

- [ ] **Step 1: Testes falhando** (`DialogosFila.test.tsx`, `PainelFilaJobs.test.tsx`):
  - `DialogosFila`: `uncertain` `paid` abre `<ConfirmDialog>` com `<ResumoCustoPrivacidade>` e foco inicial em `"Cancelar"` antes de `jobs.retry { confirmed: true }`; `jobs.redo` bloqueia com banner `role="alert"` em `Somente local` e mostra nota `#304` em `ai:selection`; `jobs.budget.continue` exige `confirmed: true` em `cost_unknown`; `jobs.result` mantém JSON dentro de `<details>`;
  - `PainelFilaJobs`: todos os estados §6 (`loading`, `empty` com e sem Projeto, `error`, `ready`, `job_running`, `partial`); banner `uncertain` sempre no topo; cancelar `running && paid` pede `<ConfirmDialog>`; `batches.item.resume` com `uncertain_job` foca o card `uncertain`; cancelamento global roteia `tts:` para `tts.models.cancel` e `ffmpeg` para `components.cancel`; sem `startedAtMs` (`#303`), ETA não é inventado após reload; `Esc` fecha e devolve foco ao gatilho.
- [ ] **Step 2:** `cd front-v2; bun run test src/telas/fila` → FAIL.
- [ ] **Step 3:** Implementar `DialogosFila.tsx` e `PainelFilaJobs.tsx`.
- [ ] **Step 4:** `cd front-v2; bun run test src/telas/fila` → PASS.
- [ ] **Step 5:** Commit `feat(front-v2): Painel Global da Fila de Jobs e diálogos de incerteza/redo/orçamento`.

---

### Tarefa 4: Integração da Fila Global no Shell (`Shell.tsx`, `Ctrl+J`, `F6`, `#291`) + E2E `fila-jobs.spec.ts`

**Files:**
- Modify: `front-v2/src/shell/Shell.tsx` (montar `<PainelFilaJobs>` no shell; registrar `Mod+J` em `useAtalhos`; exibir no `GatilhoFila` e `BarraStatus` alertas prioritários para `uncertain > 0` / `ai_pauses > 0` e resumo do job ativo; integrar `<PainelFilaJobs>` ao ciclo `F6`/`Shift+F6`; preservar `<FechamentoJanela jobs={jobs} />` de `#291`/PR #346 sem duplicar o listener `app-close-requested`)
- Modify: `front-v2/src/shell/Shell.test.tsx` (adicionar testes de `Ctrl+J`, alerta `uncertain`/`ai_pauses` e integração única com `FechamentoJanela`)
- Test: `front-v2/e2e/fila-jobs.spec.ts`

**Interfaces:**
- Consumes: `useFilaGlobal` (`~/stores/filaGlobal`), `<PainelFilaJobs>` (`~/telas/fila/PainelFilaJobs`), `FechamentoJanela` (`~/shell/FechamentoJanela`, PR #346), `useAtalhos` (`~/comandos/atalhos`).
- Produces: Fila global acessível de qualquer rota via `Ctrl/Cmd+J`, botão no topo, resumo clicável na `BarraStatus` e Paleta `Ctrl/Cmd+K`, mantendo o conteúdo da rota ativa navegável à esquerda e preservando `#291` sem duplicação.

- [ ] **Step 1: Testes falhando** (`Shell.test.tsx`): `Ctrl+J` ou clicar no `GatilhoFila` abre `<PainelFilaJobs>` sem sair da rota atual; `uncertain > 0` anuncia alerta no gatilho; `Esc` fecha a gaveta e devolve o foco ao gatilho; `FechamentoJanela` recebe a lista unificada sem registrar um segundo `app-close-requested`.
- [ ] **Step 2:** `cd front-v2; bun run test src/shell/Shell.test.tsx` → FAIL.
- [ ] **Step 3:** Atualizar `Shell.tsx`.
- [ ] **Step 4:** `cd front-v2; bun run test src/shell/Shell.test.tsx` → PASS.
- [ ] **Step 5: E2E Playwright (`front-v2/e2e/fila-jobs.spec.ts`)** em `1366×768` e `1440×900` cobrindo os 8 critérios de aceite da spec `F.2` §2.10 (`Ctrl+J` abrir/fechar com retorno de foco, banner `uncertain`, `jobs.estimate` → `<ResumoCustoPrivacidade>` → `jobs.retry`, `jobs.discard`, `jobs.budget.continue` em `budget_cost`/`cost_unknown`, `jobs.redo` com nota `#304`, `jobs.result`, e sem Projeto aberto mantendo Operações Globais); zero `pageerror` e zero scroll horizontal. `cd front-v2; bunx playwright test e2e/fila-jobs.spec.ts` → PASS.
- [ ] **Step 6:** Commit `feat(front-v2): integrar Painel Global da Fila de Jobs ao Shell (#291)`.

---

### Tarefa 5: Mesa de Prontidão e Disparo em Lote (`MesaProntidao.tsx`)

**Files:**
- Create: `front-v2/src/telas/exportacao/MesaProntidao.tsx`
- Test: `front-v2/src/telas/exportacao/MesaProntidao.test.tsx`

**Interfaces:**
- Consumes: `chamar`, `ErroCore`, `mensagemDeErro` (`~/core/cliente`, `~/core/erros`); `mediaUrl` (`../../../src/lib/media`); `useExportacaoProjeto` (`~/stores/exportacaoProjeto`); `<SeletorCaminho>` (`~/componentes/SeletorCaminho`, Onda 1 `#329`); `<DialogoExportarCorte>` (`~/telas/corte/DialogoExportarCorte`, Onda 4 `#355`); `@ds` (`AreaRolagem`, `BannerErroCore`, `Botao`, `ChecklistGuardaCorpos`, `ConfirmDialog`, `Dica`, `Esqueleto`, `EstadoTela`, `SeloTipoVideo`, `Select`, `Status`, `duracao`, `useToast`).
- Real core commands used: `sources.list`, `selection.list`, `selection.get`, `selection.review`, `packaging.get`, `thumbnail.get`, `guardrails.check`, `guardrails.ack_direct_notice`, `export.settings`, `export.encoder.status`, `export.batch.start`, `export.start`.
- Produces:
  - `MesaProntidao({ projetoId, projetoPath, aoAbrirLote, aoLimparFiltros? })`:
    - **Sub-barra de filtros:** `<Select>` Fonte (`"Todas as Fontes"` ou Fonte específica), filtro de prontidão (`Todos`, `Com pendências`, `Prontos para publicar`, `Corte direto`, `Vídeo transformado`), busca por título e ordenação (`Por Fonte`, `Por Nota`, `Pendências primeiro` — expandidos na linha em `1440+ px`);
    - **Zona A (Grade de Prontidão):** `2` colunas em `1366 px`, `3–4` colunas em `1440+ px`, cartões `<article>` com:
      1. Miniatura 9:16 (capa em `thumbnail.current.instantUs` via protocolo de mídia ou placeholder `"Sem capa escolhida"`), `<SeloTipoVideo>` e duração `tabular-nums`;
      2. Título (`packaging.current.title` ou `candidate.title` com etiqueta `"Título sugerido (sem Empacotamento)"`);
      3. Nome da Fonte + status da Permissão (`Permissão registrada` / `Sem Permissão`) + selo de saúde se `offline`/`changed`;
      4. Glifos de pendência (ícone + rótulo curto, nunca só cor — SC 1.4.1): Capa, Empacotamento, Permissão, Roteiro/Narração/Sobra > 5 s (apenas `Vídeo transformado`), Áudio sem licença, Acima de 60 s, Fonte indisponível;
      5. Ações rápidas: ação contextual principal (*"Relocalizar Fonte"*, *"Transformar"*, *"Empacotar"*, *"Editar Corte"*), secundárias (*"Editar"*, *"Empacotar"*), *"Exportar só este"* (abre `<DialogoExportarCorte>` da Onda 4 `#355`), e se exibir *"Converter em Vídeo transformado"* em `Corte direto`, fica **desabilitado** com `<Dica>` citando `#292`; paginação incremental (`"Carregar mais"` / interseção, `#298`).
    - **Zona B (Configuração e Disparo em Lote):**
      - Escopo explícito (`Todo o Projeto (N)` vs `Fonte: <nome> (M)`), com aviso se houver K Fontes `offline`/`changed`;
      - `<SeletorCaminho>` pré-carregado com `export.settings().last_directory`, nota fixa MP4 1080×1920 `-14 LUFS / -1 dBTP` sem marca d'água, e botão `"Salvar pasta padrão"` **desabilitado** com `<Dica>` citando `#303`;
      - Bloco `export.encoder.status`: alerta + CTA `#/config/componentes` se `!ffmpeg`; orientação + link `#/config/exportacao` se `!detected` ou `stale`; explicação do fallback automático para `x264`;
      - `<ChecklistGuardaCorpos escopo={...} />` informativo (aberto por padrão quando houver avisos);
      - Botão primário **"Exportar N aprovados em lote"** (desabilitado se `N === 0 || !outputDir || !ffmpeg`):
        1. Se `needsDirectNotice`: `<ConfirmDialog focoInicial="cancelar">` único de monetização de Corte direto → `guardrails.ack_direct_notice`;
        2. Chama `export.batch.start { project: projetoPath, output_dir, source_id?, confirmed? }` (contrato obrigatório de `core/src/export/batch.rs`);
        3. Se `confirmation_required` (`usage.conflicts`): `<ConfirmDialog focoInicial="cancelar">` listando todos os arquivos conflitantes → reenvia com `confirmed: true`;
        4. Ao iniciar, chama `aoAbrirLote(batch.id)` para destacar em `?sub=lotes`.

- [ ] **Step 1: Testes falhando** (`MesaProntidao.test.tsx`):
  - renderiza cards com título sugerido V1, `<SeloTipoVideo>`, glifos com ícone + texto, paginação (`#298`) e filtros por Fonte/prontidão;
  - clicar em `"Empacotar"` ou `"Transformar"` navega para a rota exata do Corte; clicar em `"Exportar só este"` abre `<DialogoExportarCorte>`; ação `#292` (quando presente) e `"Salvar pasta padrão"` (`#303`) ficam desabilitadas com `<Dica>`;
  - quando `!ffmpeg`, botão de exportar lote fica bloqueado e exibe CTA `"Instalar FFmpeg em Componentes"`;
  - fluxo completo de disparo: `needsDirectNotice` → `<ConfirmDialog>` → `guardrails.ack_direct_notice` → `export.batch.start` enviando `project: projetoPath` → `confirmation_required` (`conflicts`) → `<ConfirmDialog>` listando arquivos → `export.batch.start { confirmed: true }`.
- [ ] **Step 2:** `cd front-v2; bun run test src/telas/exportacao/MesaProntidao.test.tsx` → FAIL.
- [ ] **Step 3:** Implementar `MesaProntidao.tsx`.
- [ ] **Step 4:** `cd front-v2; bun run test src/telas/exportacao/MesaProntidao.test.tsx` → PASS.
- [ ] **Step 5:** Commit `feat(front-v2): MesaProntidao e disparo de Exportação em Lote`.

---

### Tarefa 6: Histórico de Lotes (`HistoricoLotes.tsx`), Tela `Exportacao.tsx` (`#/projeto/:id/exportacao`) + E2E

**Files:**
- Create: `front-v2/src/telas/exportacao/HistoricoLotes.tsx`, `front-v2/src/telas/exportacao/Exportacao.tsx`
- Modify: `front-v2/src/App.tsx` (ligar rota `exportacao` ao `<Exportacao />`)
- Test: `front-v2/src/telas/exportacao/HistoricoLotes.test.tsx`, `front-v2/src/telas/exportacao/Exportacao.test.tsx`, `front-v2/e2e/exportacao.spec.ts`

**Interfaces:**
- Consumes: `chamar`, `ErroCore`, `mensagemDeErro` (`~/core/cliente`, `~/core/erros`); `useExportacaoProjeto` (`~/stores/exportacaoProjeto`); `useFila` (`~/core/progresso`); `abrirNoSistema` (`~/core/desktop`); `estadoForcado`, `<ComEstado>` (`~/shell/EstadoForcado`); `useAtalhos`; `<MesaProntidao>`; `@ds` (`Abas`, `AreaRolagem`, `BannerErroCore`, `Botao`, `ConfirmDialog`, `Esqueleto`, `EstadoTela`, `Progresso`, `Status`, `TabelaGrade`, `duracao`, `useToast`).
- Real core commands used: `export.batch.list`, `export.batch.status`, `export.batch.cancel`.
- Produces:
  - `HistoricoLotes({ projetoId, loteSelecionadoId, aoSelecionarLote, aoVoltarProntidao })`:
    - **Zona C (Lista de Lotes):** cartões ordenados do mais recente ao mais antigo (`#id`, escopo, `<Progresso>` ponderado, `completed/total`, `<Status>` `Em andamento` / `Concluído` / `Concluído com falhas` / `Falhou` / `Cancelado`);
    - **Zona D (Detalhe do Lote selecionado):** pasta de destino + `"Abrir pasta"` (`abrirNoSistema`), `"Cancelar lote"` (`<ConfirmDialog focoInicial="cancelar">` → `export.batch.cancel { id }` quando `state === 'running'`), barra de progresso ponderada + contagens `tabular-nums`, faixa `partial` com filtro `"Mostrar apenas falhas"` quando `status === 'partial'`, e `<TabelaGrade role="grid">` de itens:
      - `#`, Título + `filename`, Duração (`duracao`), Estado + `<Progresso>` individual quando `running`, Encoder + selo `"Caiu para x264"` (`encoderFallback != null` com `from`/`reason`), erro traduzido + botão de recuperação (`"Relocalizar Fonte"` → `#/projeto/:id/fontes/:sourceId`, `"Abrir Corte"` → `#/projeto/:id/corte/:cid/editar`) quando `failed`, e `"Abrir arquivo"` / `"Mostrar na pasta"` quando `completed`.
  - `Exportacao({ projetoId, projetoPath, sub })`:
    - sub-barra `Abas` (`role="tablist"`, setas `←`/`→`): `Prontidão e Lote (N)` (`?sub=prontidao`) e `Histórico de lotes (M ativos)` (`?sub=lotes`); redirecionamento `/exportacao/lotes` já garantido em `rotas.ts`;
    - suporte a `F6` / `Shift+F6` entre as 5 regiões (`Barra Superior` → `Sub-barra` → `Zona esquerda` → `Zona direita` → `Barra de Status`);
    - todos os 6 estados §6 (`loading` 6 `<Esqueleto variante="cards" />` na Zona A + `<Esqueleto variante="formulario" />` na Zona B sem nunca mostrar `"Nenhum Corte aprovado"`; `empty` sem aprovados → `"Nenhum Corte aprovado para exportar"` + CTA `"Ir para Cortes"`, filtro vazio → `"Limpar filtros"`, histórico vazio → `"Nenhum lote exportado ainda"` + `"Voltar para Prontidão e Lote"`; `error` `<BannerErroCore>` cobrindo todos os 14 códigos da tabela §1.5; `ready`; `job_running` mantendo Mesa interativa com faixa do lote ativo; `partial` em lote com falhas e em cards `offline`/`changed`).

- [ ] **Step 1: Testes falhando** (`HistoricoLotes.test.tsx`, `Exportacao.test.tsx`):
  - `HistoricoLotes`: exibe lote `partial`, filtro `"Mostrar apenas falhas"`, selo `"Caiu para x264"` (`encoderFallback`), botão `"Relocalizar Fonte"` em item falho, `"Cancelar lote"` com `<ConfirmDialog>` chamando `export.batch.cancel` e atualização via `core-progress` (`export_batch` / `export_batch_complete`);
  - `Exportacao`: todos os 6 estados §6 (`loading` nunca mostra `"Nenhum Corte aprovado"`, `empty`, `error` `component_missing`/`export_batch_empty`/`insufficient_space`/`batch_not_found`, `ready`, `job_running`, `partial`), alternância de abas `?sub=prontidao` ↔ `?sub=lotes` via teclado e ciclo `F6`.
- [ ] **Step 2:** `cd front-v2; bun run test src/telas/exportacao` → FAIL.
- [ ] **Step 3:** Implementar `HistoricoLotes.tsx`, `Exportacao.tsx` e ligar em `App.tsx`.
- [ ] **Step 4:** `cd front-v2; bun run test src/telas/exportacao` → PASS.
- [ ] **Step 5: E2E Playwright (`front-v2/e2e/exportacao.spec.ts`)** em `1366×768` e `1440×900` cobrindo os 10 critérios de aceite da spec `F.1` §1.10 (`?estado=carregando`, `?estado=vazio` → CTA Cortes, cards V1/direto/transformado com glifos, navegação para `/empacotar`/`/transformar` e volta, checklist informativo sem bloquear, `guardrails.ack_direct_notice`, `confirmation_required` com `conflicts`, progresso `core-progress` em `?sub=lotes` + selo fallback `x264`, cancelar lote via `<ConfirmDialog>`, `?estado=erro` `component_missing` → `#/config/componentes`); zero `pageerror` e zero scroll horizontal externo. `cd front-v2; bunx playwright test e2e/exportacao.spec.ts` → PASS.
- [ ] **Step 6:** Commit `feat(front-v2): tela Exportação com Mesa de Prontidão e Histórico de Lotes (#/projeto/:id/exportacao)`.

---

### Tarefa 7: Tela Relatos e Diagnóstico (`#/relatos`, ADR-0006) + E2E

**Files:**
- Create: `front-v2/src/telas/relatos/Relatos.tsx`
- Modify: `front-v2/src/App.tsx` (ligar rota `relatos` ao `<Relatos />`)
- Test: `front-v2/src/telas/relatos/Relatos.test.tsx`, `front-v2/e2e/relatos.spec.ts`

**Interfaces:**
- Consumes: `chamar`, `ErroCore`, `mensagemDeErro` (`~/core/cliente`, `~/core/erros`); `copiarTexto`, `salvarDialogo`, `abrirUrlExterna` (`~/core/desktop`); `estadoForcado`, `<ComEstado>` (`~/shell/EstadoForcado`); `@ds` (`AreaRolagem`, `AreaTexto`, `BannerErroCore`, `Botao`, `Campo`, `Checkbox`, `Entrada`, `Esqueleto`, `EstadoTela`, `Status`, `useToast`).
- Real core commands used: `diagnostic.get`, `diagnostic.export`, `transcription.hardware.diagnostic`.
- Produces:
  - `Relatos({ tipoInicial? })`:
    - **Passo 1 (Edição do relato, largura `≤ 68 ch`):**
      - `role="radiogroup"` (`Relatar problema` → `bug.yml`, `includeDiagnostic = true`; `Sugerir ideia` → `ideia.yml`, `includeDiagnostic = false`; `Propor Provedor ou modelo` → `provedor-modelo.yml`, `includeDiagnostic = false`; troca de tipo sai da revisão se aberta);
      - `<Entrada>` `Título` e `<AreaTexto>` `Descrição` com `<label>` associado e editáveis imediatamente mesmo durante `loading` do diagnóstico;
      - detector `/token|chave|\bkey\b/i` exibindo banner `role="alert"` não intrusivo (nunca rouba foco do campo);
      - `<Checkbox>` `Incluir diagnóstico técnico local (allowlist)` + texto explícito do que entra e o que nunca entra (ADR-0006);
      - `<details>` **"Diagnóstico da sonda de hardware (Transcrição)"** (`transcription.hardware.diagnostic`, exibindo *"Nenhuma sonda de hardware gravada ainda."* quando `null`, ou campos `key`, `chosen`, `verified`, `batch`, `vram_free_mib`, `measured_at`, `fallback_reason`, `attempts` com botão `"Anexar resumo de hardware ao diagnóstico"`);
      - botão primário **"Revisar relato antes de enviar"** e link externo `SECURITY.md` (*"Reportar vulnerabilidade de segurança em privado"*).
    - **Passo 2 (Pré-visualização editável obrigatória — ADR-0006 regra 2):**
      - **Os botões de saída (`Copiar texto`, `Exportar diagnóstico (.txt)` e `Abrir no GitHub`) só são renderizados no DOM no Passo 2**;
      - em `1440+ px`, exibe o `<AreaTexto>` editável à esquerda (60%) e painel auxiliar de Sonda de Hardware + Allowlist à direita (40%, integrado ao ciclo `F6`);
      - nota discreta junto ao `<AreaTexto>` citando `#300` (sobre `"Etapa da falha: componente"` poder ser editada antes de enviar);
      - **Copiar texto:** `copiarTexto(textoCompleto)` + `role="status"` `"Texto copiado."`;
      - **Exportar diagnóstico (`.txt`):** diálogo `salvarDialogo` + `diagnostic.export { path, text }` no Tauri (ou `Blob` + `diagnostic.export` no mock) enviando **exatamente o texto editado pelo usuário**; trata `invalid_path`, `invalid_text` e `export_failed` em `role="alert"` com recuperação;
      - **Abrir no GitHub:** valida `new TextEncoder().encode(url).length > 8000`; se exceder e `include === true`, copia `diagnostic` via `copiarTexto`, troca corpo da URL para descrição + aviso e anuncia em `role="status"`; se ainda exceder 8.000 bytes, orienta usar **"Copiar texto completo"**; abre `https://github.com/GUSTAVOHOOO/clipes/issues/new?...` via `abrirUrlExterna`.

- [ ] **Step 1: Testes falhando** (`Relatos.test.tsx`):
  - Passo 1: `?tipo=ideia` seleciona `Sugerir ideia` com `includeDiagnostic` desmarcado; padrão `bug` vem marcado; botões `Copiar texto`, `Exportar diagnóstico (.txt)` e `Abrir no GitHub` **não existem no DOM** antes de clicar `"Revisar relato antes de enviar"`;
  - digitar `"minha chave da api"` exibe `role="alert"` mantendo foco no `<textarea>`;
  - sonda de hardware exibe `null` (`"Nenhuma sonda de hardware gravada ainda."`) ou dados sem expor caminhos; exibe nota `#300` na revisão;
  - Passo 2: editar linha no `<textarea>` do diagnóstico e exportar chama `diagnostic.export` com o texto editado; URL > 8.000 bytes copia diagnóstico e anuncia `role="status"`; erros `invalid_path`, `invalid_text`, `export_failed` e `settings` traduzem em `role="alert"`.
- [ ] **Step 2:** `cd front-v2; bun run test src/telas/relatos/Relatos.test.tsx` → FAIL.
- [ ] **Step 3:** Implementar `Relatos.tsx` e ligar rota `relatos` em `App.tsx`.
- [ ] **Step 4:** `cd front-v2; bun run test src/telas/relatos/Relatos.test.tsx` → PASS.
- [ ] **Step 5: E2E Playwright (`front-v2/e2e/relatos.spec.ts`)** em `1366×768` e `1440×900` cobrindo os 7 critérios de aceite da spec `F.3` §3.10; zero `pageerror` e zero scroll horizontal. `cd front-v2; bunx playwright test e2e/relatos.spec.ts` → PASS.
- [ ] **Step 6:** Commit `feat(front-v2): tela Relatos e Diagnóstico (#/relatos, ADR-0006)`.

---

### Tarefa 8: Tela Sobre e Atualizações (`#/sobre`) + E2E

**Files:**
- Create: `front-v2/src/telas/sobre/Sobre.tsx`
- Modify: `front-v2/src/App.tsx` (ligar rota `sobre` ao `<Sobre />`)
- Test: `front-v2/src/telas/sobre/Sobre.test.tsx`, `front-v2/e2e/sobre.spec.ts`

**Interfaces:**
- Consumes: `chamar`, `ErroCore` (`~/core/cliente`); `useAtualizador` (`~/stores/atualizador`); `useFila` (`~/core/progresso`); `operacoesCriticasEmVoo` (`~/shell/FechamentoJanela`, `#291`/PR #346); `abrirUrlExterna` (`~/core/desktop`); `estadoForcado`, `<ComEstado>` (`~/shell/EstadoForcado`); `LICENSE` (`../../../LICENSE?raw`) e `THIRD_PARTY_NOTICES.md` (`../../../THIRD_PARTY_NOTICES.md?raw`); `@ds` (`Abas`, `BannerErroCore`, `Botao`, `Busca`, `ConfirmDialog`, `Esqueleto`, `EstadoTela`, `Progresso`, `Status`, `useToast`).
- Real core commands used: `app.version` (e updater Tauri sobre `https://github.com/GUSTAVOHOOO/clipes/releases/latest/download/latest.json`).
- Produces:
  - `Sobre()`:
    - **Zona 1 — Identidade e Versão:** chama `app.version {}` (`<Esqueleto variante="linha" />` durante `loading`, erro com `"Tentar novamente"` se falhar), exibe versão em `.num`, licença `Apache-2.0`, links para repositório e `#/relatos`;
    - **Zona 2 — Atualizações do aplicativo:** botão **"Verificar atualizações"** (nunca baixa/instala sem clique explícito, US-16); estados `idle`/`up_to_date`, `checking`, `available` (versão atual → nova, data, notas, **"Baixar e instalar"** e **"Lembrar depois"**), `installing`, `installed`, `offline` (quando `navigator.onLine === false`, mensagem neutra sem erro alarmante — US-121) e `error` (`role="alert"` diferenciando rede vs `invalid-signature` bloqueada por segurança); antes de reiniciar (`relaunch`), se `operacoesCriticasEmVoo(jobs).length > 0` (`#291`), abre `<ConfirmDialog focoInicial="cancelar">` listando as operações em andamento antes de prosseguir; nota permanente com link para `#/config/componentes` (*"FFmpeg, yt-dlp, Worker Python e modelos atualizam à parte"*, US-17);
    - **Zona 3 — Licenças e Atribuições:** `<Abas role="tablist">` **Licença do Clipes (Apache-2.0)** | **Atribuições de terceiros** (setas `←`/`→`), campo `<Busca>` filtrando `THIRD_PARTY_NOTICES.md` (estado `empty` `"Nenhuma atribuição encontrada para '<termo>'."` + `"Limpar busca"`) e `<pre tabIndex={0} aria-label="...">` rolável por teclado (`↑`/`↓`/`PageUp`/`PageDown`, WCAG 2.1.1).

- [ ] **Step 1: Testes falhando** (`Sobre.test.tsx`):
  - `loading` exibe `<Esqueleto>` só na linha da versão mantendo licenças legíveis; falha em `app.version` exibe `"Tentar novamente"`;
  - `"Verificar atualizações"` exibe atualização disponível sem iniciar download automático; `?updater-test=invalid-signature` bloqueia instalação em `role="alert"`; `navigator.onLine === false` mostra aviso offline neutro;
  - ao reiniciar após instalar com download/exportação ativa em `useFila()`, abre `<ConfirmDialog>` reutilizando `operacoesCriticasEmVoo` (`#291`);
  - abas `Apache-2.0` / `Atribuições` alternam por setas `←`/`→`; `<pre>` tem `tabIndex={0}`; busca sem match mostra `"Limpar busca"`; link para `#/config/componentes` presente.
- [ ] **Step 2:** `cd front-v2; bun run test src/telas/sobre/Sobre.test.tsx` → FAIL.
- [ ] **Step 3:** Implementar `Sobre.tsx` e ligar rota `sobre` em `App.tsx`.
- [ ] **Step 4:** `cd front-v2; bun run test src/telas/sobre/Sobre.test.tsx` → PASS.
- [ ] **Step 5: E2E Playwright (`front-v2/e2e/sobre.spec.ts`)** em `1366×768` e `1440×900` cobrindo os 6 critérios de aceite da spec `F.4` §4.10; zero `pageerror` e zero scroll horizontal. `cd front-v2; bunx playwright test e2e/sobre.spec.ts` → PASS.
- [ ] **Step 6:** Commit `feat(front-v2): tela Sobre e Atualizações (#/sobre)`.

---

### Tarefa 9: Fechamento da Onda 6

- [ ] **Step 1:** Em `front-v2/`: `bun run typecheck`, `bun run build`, `bun run test` e `bunx playwright test` → 100% verdes em `1366×768` e `1440×900`.
- [ ] **Step 2:** `bunx impeccable detect --json front-v2/src` → sem achados críticos (ou corrigidos antes do PR final).
- [ ] **Step 3:** Conferir aderência visual ao `DESIGN.md` e aos wireframes `F1-exportacao.html`, `F2-fila.html`, `F3-relatos.html` e `F4-sobre.html` (Regra da Luz Única, Estado Cinza, Número Tabular, Erro Sem Fundo) e anexar screenshots `1366×768` e `1440×900` de `#/projeto/demo/exportacao?sub=prontidao`, `#/projeto/demo/exportacao?sub=lotes`, gaveta `Ctrl+J`, `#/relatos` (Passos 1 e 2) e `#/sobre` ao PR final.
- [ ] **Step 4:** Limpeza de disco (`cargo clean` se aplicável e remoção de eventuais `%TEMP%\clipes-<ticket>-*`).

---

## Tickets

Agrupamento das 9 tarefas em **4 tickets** executáveis em PRs pequenos. Após o ticket base **T1**, **T2** (Fila Global) e **T3** (Exportação) têm arquivos de tela disjuntos (tocando `App.tsx` apenas ao ligar suas rotas), e **T4** entrega Relatos, Sobre e o fechamento de verificação da Onda 6. Onde PRs paralelos tocam `front-v2/src/App.tsx`, fazer rebase em `origin/master` após o merge do anterior conforme `docs/agents/impedimentos.md`.

| Ticket | Título | Tarefas | Depende de | Arquivos criados / editados | Lacunas do mock TS fechadas |
|---|---|---|---|---|---|
| **T1** | `front-v2(onda 6): Mock TS, erros, rota Relatos, desktop e stores de Fila/Exportação/Updater` | Tarefas 1, 2 | Onda 0 (`#315`–`#317`), `#291` (PR #346), Onda 1 (`#329`–`#333`), Onda 2 (`#342`), Onda 3 (`#348`), Onda 4 (`#354`) | `src/lib/core.ts`, `src/lib/batchMock.ts`, `src/features/export/mock.ts`, `front-v2/src/core/erros.ts`, `progresso.ts`, `desktop.ts`, `front-v2/src/rotas/rotas.ts`, `front-v2/src/stores/filaGlobal.ts`, `exportacaoProjeto.ts`, `atualizador.ts`, `front-v2/src/core/erros.test.ts`, `rotas.test.ts`, `desktop.test.ts`, `onda6Mock.test.ts`, `front-v2/src/stores/filaGlobal.test.ts`, `exportacaoProjeto.test.ts`, `atualizador.test.ts` | Remove `?source-test` de `jobs.*`; implementa `jobs.redo.estimate`, `jobs.redo`, `jobs.result`, `diagnostic.export`, `transcription.hardware.diagnostic`; enriquece `diagnostic.get`; adiciona lote V1 inicial `partial` com `encoderFallback` e eventos `core-progress` (`export_batch*`, `batch:*`, `export`); unifica mock do updater (`?updater-test=`) |
| **T2** | `front-v2(onda 6): Painel Global da Fila de Jobs (Ctrl+J) e integração no Shell (#291)` | Tarefas 3, 4 | **T1**, Onda 0 (`#316`, `#317`), `#291` (PR #346) | `front-v2/src/telas/fila/DialogosFila.tsx`, `PainelFilaJobs.tsx`, `front-v2/src/shell/Shell.tsx`, `front-v2/src/telas/fila/DialogosFila.test.tsx`, `PainelFilaJobs.test.tsx`, `front-v2/src/shell/Shell.test.tsx`, `front-v2/e2e/fila-jobs.spec.ts` | — *(consome T1)* |
| **T3** | `front-v2(onda 6): Exportação — Mesa de Prontidão, Exportação em Lote e Histórico (#/projeto/:id/exportacao)` | Tarefas 5, 6 | **T1**, Onda 1 (`#329`), Onda 2 (`#342`), Onda 3 (`#348`), Onda 4 (`#355`) | `front-v2/src/telas/exportacao/MesaProntidao.tsx`, `HistoricoLotes.tsx`, `Exportacao.tsx`, `front-v2/src/App.tsx`, `front-v2/src/telas/exportacao/MesaProntidao.test.tsx`, `HistoricoLotes.test.tsx`, `Exportacao.test.tsx`, `front-v2/e2e/exportacao.spec.ts` | — *(consome T1)* |
| **T4** | `front-v2(onda 6): Relatos e Diagnóstico (#/relatos), Sobre e Atualizações (#/sobre) e fechamento` | Tarefas 7, 8, 9 | **T1**, **T2**, **T3** | `front-v2/src/telas/relatos/Relatos.tsx`, `front-v2/src/telas/sobre/Sobre.tsx`, `front-v2/src/App.tsx`, `front-v2/src/telas/relatos/Relatos.test.tsx`, `front-v2/src/telas/sobre/Sobre.test.tsx`, `front-v2/e2e/relatos.spec.ts`, `front-v2/e2e/sobre.spec.ts` | — *(consome T1)* |

### Critérios de aceite por ticket

#### T1 — `front-v2(onda 6): Mock TS, erros, rota Relatos, desktop e stores de Fila/Exportação/Updater`
- [ ] Testes unitários em `erros.test.ts`, `rotas.test.ts` e `desktop.test.ts` cobrindo todos os códigos `CoreError.code` do Pacote F, parsing de `?tipo=bug|ideia|provedor` em `#/relatos` e wrappers `desktop.ts` com `window.__CLIPES_E2E__` e fallback seguro.
- [ ] Testes de contrato em `onda6Mock.test.ts` validando `jobs.*` (`redo`, `result`, `estimate`, `retry`, `discard`), `export.batch.*`, `diagnostic.get`/`export` e `transcription.hardware.diagnostic` sem query flags ocultas e emitindo `core-progress`.
- [ ] Testes unitários em `filaGlobal.test.ts`, `exportacaoProjeto.test.ts` e `atualizador.test.ts` cobrindo: reconciliação com `FechamentoJanela` (`#291`) sem duplicar `core-progress`, notificação SO apenas sem foco, paginação com cache da Mesa de Prontidão (`#298`), limpeza ao fechar Projeto e estados do atualizador (`invalid-signature`, `offline`, confirmação explícita).
- [ ] `bun run typecheck && bun run test` verdes no CI.

#### T2 — `front-v2(onda 6): Painel Global da Fila de Jobs (Ctrl+J) e integração no Shell (#291)`
- [ ] Testes de componente em `DialogosFila.test.tsx` e `PainelFilaJobs.test.tsx` cobrindo todos os estados §6 (`loading`, `empty` com e sem Projeto, `error`, `ready`, `job_running`, `partial`), ações (`jobs.retry`, `jobs.discard`, `jobs.redo` com veto `Somente local` e nota `#304`, `jobs.result`, `jobs.budget.continue` com `cost_unknown`, `batches.*`, `export.batch.cancel`, cancelamento de globais), ausência de ETA após reload (`#303`) e nota de operações globais em memória (`#307`).
- [ ] Testes em `Shell.test.tsx` cobrindo `Ctrl+J`, alerta prioritário no `GatilhoFila`, resumo na `BarraStatus`, foco devolvido no `Esc`, ciclo `F6` e fonte única para `FechamentoJanela` (`#291`).
- [ ] Fluxo Playwright em `1366×768` e `1440×900` (`front-v2/e2e/fila-jobs.spec.ts`) verde cobrindo os 8 critérios de aceite de `F.2` §2.10, sem `pageerror` nem scroll horizontal.
- [ ] `bun run typecheck && bun run test && bunx playwright test e2e/fila-jobs.spec.ts` verdes no CI.

#### T3 — `front-v2(onda 6): Exportação — Mesa de Prontidão, Exportação em Lote e Histórico (#/projeto/:id/exportacao)`
- [ ] Testes de componente em `MesaProntidao.test.tsx`, `HistoricoLotes.test.tsx` e `Exportacao.test.tsx` cobrindo todos os estados §6 (`loading` sem mostrar vazio, `empty`, `error` dos 14 códigos, `ready`, `job_running`, `partial`), Projetos/Cortes V1, ações (`guardrails.ack_direct_notice`, `export.batch.start` com `project` + `confirmation_required` conflicts, `export.batch.cancel`, *"Exportar só este"* via `<DialogoExportarCorte>`), tooltips `#292`/`#298`/`#303`, selo fallback `x264`, abas `←`/`→` e ciclo `F6`.
- [ ] Fluxo Playwright em `1366×768` e `1440×900` (`front-v2/e2e/exportacao.spec.ts`) verde cobrindo os 10 critérios de aceite de `F.1` §1.10, sem `pageerror` nem scroll horizontal.
- [ ] `bun run typecheck && bun run test && bunx playwright test e2e/exportacao.spec.ts` verdes no CI.

#### T4 — `front-v2(onda 6): Relatos e Diagnóstico (#/relatos), Sobre e Atualizações (#/sobre) e fechamento`
- [ ] Testes de componente em `Relatos.test.tsx` cobrindo estados §6 (`loading`, `empty` sonda `null`, `error` `invalid_path`/`invalid_text`/`export_failed`/`settings`, `ready`), fluxo obrigatório em 2 passos do ADR-0006 (ausência de botões de envio no DOM no Passo 1), detector `/token|chave|\bkey\b/i` sem roubar foco, nota `#300`, envio exato do texto editado para `diagnostic.export` e limite de `8.000` bytes UTF-8 na URL do GitHub.
- [ ] Testes de componente em `Sobre.test.tsx` cobrindo estados §6 (`loading` só na versão, `empty` busca de atribuições, `error` `app.version`/`invalid-signature`, `ready`, `job_running`, `offline`), verificação/instalação apenas por clique explícito (US-16), guarda `operacoesCriticasEmVoo` (`#291`) antes de `relaunch()`, nota Componentes (US-17) e abas legais `←`/`→` com `<pre tabIndex={0}>`.
- [ ] Fluxos Playwright em `1366×768` e `1440×900` (`front-v2/e2e/relatos.spec.ts` e `front-v2/e2e/sobre.spec.ts`) verdes cobrindo todos os critérios de aceite de `F.3` §3.10 e `F.4` §4.10, sem `pageerror` nem scroll horizontal.
- [ ] Fechamento da Onda 6: `bunx impeccable detect --json front-v2/src` limpo, screenshots `1366×768` e `1440×900` anexados ao PR e `bun run typecheck && bun run build && bun run test && bunx playwright test` verdes no CI.
