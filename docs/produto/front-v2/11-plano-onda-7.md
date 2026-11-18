# Front v2 · Onda 7: Troca

> **Para agentes:** SUB-SKILL OBRIGATÓRIA: `superpowers:subagent-driven-development` (recomendado) ou `superpowers:executing-plans` para executar tarefa por tarefa. Toda tarefa é TDD (`superpowers:test-driven-development`): teste falhando primeiro, depois o mínimo de código. Passos com checkbox (`- [ ]`).

**Goal:** Executar a troca oficial do front-end empacotado pelo Tauri da V1 (`src/`) para o `front-v2/` — atualizar `src-tauri/tauri.conf.json` (`beforeDevCommand`, `devUrl`, `beforeBuildCommand`, `frontendDist`) e o boot Tauri de `front-v2/src/main.tsx` (`initMediaTransport()` + `VITE_E2E`), manter o front V1 (`src/`, `design-system/`) preservado no repositório com caminho de reversão documentado e testado, migrar `scripts/e2e-tauri.mjs` e `scripts/linux-validation.mjs` para as telas v2 cobrindo o fluxo real do mandato (**abrir Projeto existente da V1 → revisar → editar → exportar um Corte**) e fechamento coordenado (`#291`), ajustar CI (`ci.yml`, `linux-validation.yml`, `release.yml`) com auditoria de licenças de `front-v2`/`design-system-v2` e smoke do pacote por plataforma (Windows NSIS, Linux AppImage e `.deb`), e atualizar os manifestos para a versão `2.0.0` (sem criar tag nem publicar release).

**Architecture:** `src-tauri/tauri.conf.json` passa a compilar e servir `../front-v2/dist` (e `http://127.0.0.1:1430` em `tauri dev` sem `VITE_CORE_MOCK=1`). `front-v2/src/main.tsx` passa a inicializar `initMediaTransport()` (`src/lib/media.ts`) quando `isTauri()` antes de montar `<App />`, garantindo o servidor HTTP loopback no Linux WebKitGTK (`#246`), e `src-tauri/src/media_server.rs` passa a aceitar a origem `:1430` em `cfg!(debug_assertions)` mantendo `:1420` para reversão. Por mandato do coordenador, `src/` e `design-system/` **não são removidos** nesta onda: ficam no repositório como caminho de reversão até depois da `v2.0.0`, preservando também os módulos compartilhados de `src/` que o `front-v2` continua importando (`src/lib/core.ts`, `src/lib/media.ts`, `src/lib/desktop.ts`, `src/features/updates/updateError.ts`, `src/features/editor/{cropMath,timelineMath,duckingMath}.ts` e `src/features/captions/{render,types}.ts`). O fechamento coordenado (`WindowEvent::CloseRequested` → `editor.flush` → `app-close-requested` / `FechamentoJanela.tsx`) já está no `master` (`#291`, PR `#346`) e é verificado ponta a ponta na suíte E2E Tauri real.

**Tech Stack:** Tauri v2 (`src-tauri/`), React 19, TypeScript, Vite, Tailwind 4, `@clipes/design-system-v2`, Bun 1.3.12, Rust (`clipes-core` / `clipes`), WebdriverIO + `tauri-driver` + `msedgedriver` / `WebKitWebDriver`, Vitest, Playwright, `ffmpeg`/`ffprobe`, `license-checker-rseidelsohn`.

**Spec:** `docs/produto/front-v2/04-plano-implementacao.md` (linha `7 · Troca` da tabela de Ondas — sem wireframe próprio), `docs/produto/front-v2/01-arquitetura.md` (§3 rotas, §5 fila/fechamento `#291`, §6 estados, §8 atalhos, §10 estado/mock), `docs/produto/front-v2/02-consolidacao.md` (Questão #2, "Dependências do núcleo", "Lacunas do mock TS"), `docs/agents/impedimentos.md` (DCO, Testes E2E Tauri WebDriver, Disco), `src-tauri/tauri.conf.json`, `scripts/e2e-tauri.mjs`, `scripts/linux-validation.mjs`, `.github/workflows/{ci,linux-validation,release}.yml` e planos das Ondas 1–6 (`05-plano-onda-1.md` a `10-plano-onda-6.md`). Issue-mãe: `#288`.

## Global Constraints

Herdadas integralmente de [04-plano-implementacao.md](./04-plano-implementacao.md#global-constraints), com os escopos explícitos da Troca final:

- Vocabulário canônico do `GLOSSARY.md` em PT-BR (`Projeto`, `Fonte`, `VOD`, `Corte`, `Corte direto`, `Vídeo transformado`, `Transformação`, `Narração`, `Roteiro`, `Transcrição`, `Frase`, `Nota`, `Empacotamento`, `Permissão`, `Lote de Fontes`, `Provedor`, `Perfil de Provedor`, `Perfil de canal`, `Somente local`). Nunca "clipe", "short", "input", "segmento" nem "IA" como substantivo.
- **Mandato de coexistência V1:** `src/` e `design-system/` **NÃO são removidos** nesta onda; ficam no repositório para permitir reversão rápida até depois da `v2.0.0`.
- **Mandato de versão e release:** atualizar manifestos (`tauri.conf.json`, `Cargo.toml`, `package.json`) para `2.0.0` como tarefa final; **não criar tag git nem publicar GitHub Release** (o coordenador publica após o merge).
- **Escopo de mudanças em Rust/Tauri na Onda 7:** não alterar comandos nem regras do núcleo em `core/src/*.rs` (pendências permanecem nos tickets `#292`–`#307`). Em `src-tauri/`, são permitidos apenas os ajustes da troca de empacotamento (`tauri.conf.json`, `Cargo.toml`, origem `:1430` em `cfg!(debug_assertions)` de `src-tauri/src/media_server.rs` e revisão mínima de `src-tauri/capabilities/default.json`), além de `core/Cargo.toml` e `Cargo.lock` para o bump `2.0.0`.
- Toda ação que depende de ticket aberto no núcleo (`#292`–`#307`) **permanece desabilitada com `<Dica>` citando o ticket** (listadas abaixo) e não deve ser exigida como ativa nos fluxos E2E Tauri.
- Disco: `cargo clean` no worktree e limpeza de `%TEMP%\clipes-<ticket>-*` (nunca `clipes-*`) antes de cada `worker_done` (`AGENTS.md`, `docs/agents/impedimentos.md`).

### Ações dependentes de tickets abertos no núcleo (`#289`–`#307`)

Nenhum comando novo do núcleo é habilitado na Onda 7. Na migração do E2E Tauri e da validação de UI em binário real, respeitar os contratos das ações que seguem desabilitadas com `<Dica>` até os respectivos tickets fecharem:

| Ticket aberto | Tela / Superfície afetada | Comportamento preservado na Onda 7 |
|---|---|---|
| **#292** (`core(selection): converter Corte direto individual em Vídeo transformado`) | `<ContextoCorte>`, Bancada (`C.2`), Mesa de Prontidão (`F.1`) | Botão `"Converter em Vídeo transformado"` permanece **desabilitado** com `<Dica>` citando `#292`. O E2E Tauri usa Projetos/execuções já criadas como `direct` ou `transformed` conforme o fluxo. |
| **#294** (`core(editor): implementar comando editor.snapshots.restore`) | Editor → Popover `Histórico` | Lista `editor.snapshots` permanece somente leitura, com ação de restaurar **desabilitada** com `<Dica>` citando `#294`. |
| **#295** (`core(sources): implementar comando sources.delete`) | `#/projeto/:id/fontes` | Botão `"Excluir Fonte"` permanece **desabilitado** com `<Dica>` citando `#295`. |
| **#296** (`core(jobs): enriquecer jobs.preview com chave clipes-media e sourceId`) | `#/projeto/:id/fontes/:fonteId` | Usa `<PlayerReferenciaFonte>` sobre `mediaUrl("source/" + fonteId)`; eventuais prévias via `jobs.preview` com caminho absoluto ficam omitidas/desabilitadas com `<Dica>` citando `#296`. |
| **#297** (`core(events): incluir clip_id em ai:translation:* e emitir evento de backup automático`) | Editor (`Tradução`), `#/config/projeto` (Backups) | Mapa `translationJobToClip` no cliente e recarga explícita de `backups.list` após troca de aba/jobs; no E2E Tauri, validar backup após foco/ação na aba. |
| **#298** (`core(export): criar comando agregado export.readiness`) | `#/projeto/:id/exportacao` (Mesa de Prontidão) | Paginação sob demanda + cache (`exportacaoProjeto.ts`); botão agregado (se exibido) fica **desabilitado** com `<Dica>` citando `#298`. |
| **#299** (`core(packaging): permitir criação manual inicial em packaging.edit`) | `#/projeto/:id/corte/:corteId/empacotar` | Sem `packaging.generate` prévio (comum em Projetos V1), exibe CTA `"Sugerir Empacotamento"` e mantém edição manual direta **desabilitada** com `<Dica>` citando `#299`. |
| **#300** (`core(diagnostic): inferir etapa real da falha em diagnostic.get`) | `#/relatos` (Passo 2) | Nota editável junto ao `<AreaTexto>` citando `#300`; o E2E Tauri verifica o Passo 2 editável e `diagnostic.export`. |
| **#301** (`core(components): adicionar entradas macOS no manifesto`) | `#/assistente`, `<InstaladorJustInTime>`, `#/config/componentes` | Botões de download automático ausentes do manifesto macOS ficam **desabilitados** com `<Dica>` citando `#301`. |
| **#302** (`core(transcription,sources): expor next_undo/next_redo e transcriptState`) | `#/projeto/:id/fontes`, Leitor da Transcrição | Consulta `transcription.status` no store e tooltip genérico com nota `#302` em `transcription.undo`. |
| **#303** (`core(jobs,export): expor startedAtMs e alvo em jobs.list + export.settings.set`) | `<DialogoExportarCorte>`, `#/projeto/:id/exportacao`, `PainelFilaJobs` | `"Salvar pasta padrão"` desabilitado com `<Dica>` citando `#303`; ETA omitido após reload em `jobs.list`. |
| **#304** (`core(jobs): avaliar atualização de selection_runs.revision em jobs.redo`) | `PainelFilaJobs` (`Ctrl+J`) | Refazer na Fila exibe `<Dica>` citando `#304` (não cria nova Revisão na Bancada). |
| **#305** (`core(provider): setter de timeouts globais e remoção opcional de legacy`) | `#/config/provedores` | `"Remover"` no perfil `"legacy"` e timeouts globais ficam **desabilitados** com `<Dica>` citando `#305`. |
| **#306** (`core(narration): adicionar narration.delete_block e progresso em cleanup.prepare`) | `#/projeto/:id/corte/:corteId/transformar` | Remoção de áudio de bloco para `Sem áudio` fica **desabilitada** com `<Dica>` citando `#306` (substituição e `discard_draft` seguem ativas). |
| **#307** (`core(telemetry): campos informativos extras e ID único em cópia de Fonte`) | `#/assistente`, `#/config/componentes`, Fontes, Lotes, Bancada, Fila | Cópia paralela com `copy: true` desabilitada enquanto outra cópia roda; notas informativas citando `#307`. |

> **Nota sobre `#289`, `#290`, `#291` e `#293`:** `#289` (`encoder_fallback` em `export.status`), `#290` (bloqueio de `selection.resume` em `uncertain`, PR `#372`) e `#291` (`CloseRequested` → `editor.flush` → `app-close-requested` em `FechamentoJanela.tsx`, PR `#346`) já estão no `master`; `#293` (filtro de `job === "0"`) tem guarda no front v2. O E2E Tauri da Onda 7 valida o fechamento real `#291` e o fallback/export real com `ffprobe`.

## Review Focus

1. **Boot real do Tauri no `front-v2/` (transporte de mídia Linux `#246`, `VITE_E2E`, `dev:tauri` e `media_server.rs`):** hoje `front-v2/src/main.tsx` monta `<App />` direto, sem chamar `initMediaTransport()` (`src/lib/media.ts`), e `front-v2/package.json` define `"dev": "VITE_CORE_MOCK=1 vite ..."` (sintaxe POSIX que falha em `cmd.exe` no Windows e ativaria mock fora do Tauri). Na troca, `main.tsx` precisa aguardar `initMediaTransport()` quando `isTauri()` (para o servidor HTTP loopback funcionar no Linux WebKitGTK `#246`) e garantir inicialização de `window.__CLIPES_E2E__` quando `VITE_E2E === '1'`; `beforeDevCommand` deve usar script `dev:tauri` sem `VITE_CORE_MOCK=1`; e `src-tauri/src/media_server.rs` (`is_allowed_origin`) deve autorizar `"http://localhost:1430"` e `"http://127.0.0.1:1430"` em `cfg!(debug_assertions)` mantendo `:1420` para reversão.
2. **Coexistência V1, mapa exato de imports compartilhados e reversão testada:** `src/` e `design-system/` permanecem intactos no repo até depois da `v2.0.0`. Qualquer remoção acidental em `src/` quebraria `@core` (`src/lib/core.ts`, que importa `version` de `../../package.json` e mocks `./*Mock` + `@/features/export/mock`), `src/lib/media.ts`, `src/lib/desktop.ts`, `src/features/updates/updateError.ts`, `src/features/editor/{cropMath,timelineMath,duckingMath}.ts` e `src/features/captions/{render,types}.ts`. O caminho de reversão (voltar os 4 campos `build` de `src-tauri/tauri.conf.json` para `bun run dev`, `http://localhost:1420`, `bun run build`, `../dist`) precisa ter verificação automatizada provando que o V1 continua compilando para `dist/`.
3. **Fluxo E2E Tauri real em `scripts/e2e-tauri.mjs` e `scripts/linux-validation.mjs`:** `.github/workflows/linux-validation.yml` dispara automaticamente sempre que `src-tauri/tauri.conf.json` muda, e hoje `scripts/linux-validation.mjs` ainda despacha `CustomEvent('clipes-preview-open')` e procura `section[aria-label="Preview do Corte"]` da V1. Tanto `scripts/e2e-tauri.mjs` quanto `scripts/linux-validation.mjs` precisam migrar para os seletores/rotas do `front-v2` (Base UI `role="combobox"`/`switch`/`tab`/`dialog`/`alertdialog`, `cmdk`, `<SeletorCaminho>`, `<ContextoCorte>`), cobrindo obrigatoriamente o mandato: **abrir um Projeto existente da V1 (SQLite com migração + Fonte real) → revisar candidato → editar no Editor → exportar MP4 real conferido por `ffprobe`**, sem regressão do fechamento `#291`.
4. **Workflows de CI/Release (`ci.yml`, `linux-validation.yml`, `release.yml`) e auditoria de licenças JS:** atualmente `ci.yml` (`e2e`), `linux-validation.yml` (`validate-linux`) e `release.yml` (`build`) executam `bun install --frozen-lockfile` apenas na raiz, o que faria `beforeBuildCommand` em `front-v2/` falhar nos runners; e o job `licenses` de `ci.yml` ainda não audita as dependências de produção de `front-v2` e `design-system-v2`. Além disso, é preciso cobrir smoke test real dos pacotes gerados por plataforma (Windows NSIS `.exe`, Linux `.AppImage` e `.deb`).
5. **Bump `2.0.0` coordenado sem tag/release e sem quebrar `scripts/ui.mjs`:** atualizar `version` para `2.0.0` em `src-tauri/tauri.conf.json`, `src-tauri/Cargo.toml`, `core/Cargo.toml`, `Cargo.lock`, `package.json`, `front-v2/package.json` e `design-system-v2/package.json`, além de tornar `src/lib/core.ts` (`diagnostic.get`), `src/features/updates/UpdateNotice.tsx`, `scripts/ui.mjs`, `scripts/e2e-tauri.mjs` e `ci.yml` (`licenses --excludePackages`) compatíveis com `2.0.0` — sem criar tag git nem GitHub Release.

---

## Onda 7 · Troca

**Estrutura de arquivos:**

```text
src-tauri/
  tauri.conf.json                     aponta devUrl/frontendDist/beforeDevCommand/beforeBuildCommand para front-v2/ e (T4) version 2.0.0
  Cargo.toml                          (T4) version = "2.0.0"
  capabilities/default.json           revisão mínima de permissões Tauri (opener allowlist / window / clipboard / dialog / updater)
  src/media_server.rs                 adiciona http://localhost:1430 e http://127.0.0.1:1430 em is_allowed_origin (cfg debug_assertions)

core/
  Cargo.toml                          (T4) version = "2.0.0"

Cargo.lock                            (T4) atualizado para clipes 2.0.0 e clipes-core 2.0.0
package.json                          (T4) "version": "2.0.0"
design-system-v2/package.json         (T4) "version": "2.0.0"

front-v2/
  package.json                        adiciona script "dev:tauri" (sem VITE_CORE_MOCK=1); (T4) "version": "2.0.0"
  README.md                           documenta coexistência V1, mapa de imports de src/ e procedimento testado de reversão V2 → V1
  src/
    main.tsx                          chama initMediaTransport() no Tauri antes do render e inicializa hook E2E quando VITE_E2E=1
    main.test.ts                      testes unitários de boot Tauri vs browser e fallback em falha de media_base_url

src/
  lib/core.ts                         (T4) diagnostic.get usa ${version} dinâmico de package.json (sem "1.0.0" fixo)
  features/updates/UpdateNotice.tsx   (T4) fallback de versão fora do Tauri alinhado a 2.0.0 / package.json

scripts/
  test-reversao-v1.mjs                valida build V1 intacto (dist/index.html), contratos exportados de src/lib/core.ts e mapa de reversão
  e2e-tauri.mjs                       migrado 100% para telas v2 + fluxo V1 existente → revisar → editar → exportar MP4 real + #291
  linux-validation.mjs                migrado do evento V1 clipes-preview-open para rotas/palco do Editor v2
  smoke-package.mjs                   smoke automatizado dos pacotes Windows NSIS (.exe) e Linux (.AppImage / .deb)
  ui.mjs                              (T4) compatível com versão 2.0.0 nos textos de Sobre/UpdateNotice do V1

.github/workflows/
  ci.yml                              install front-v2 no job e2e; checks de design-system-v2; auditoria de licenses em front-v2 e design-system-v2 (2.0.0)
  linux-validation.yml                install front-v2 antes de tauri build e verificação do AppImage com DOM v2
  release.yml                         install front-v2 antes de tauri build + smoke-package por plataforma (NSIS / AppImage / deb)
```

---

### Tarefa 1: Boot Tauri no `front-v2/`, `media_server.rs`, `capabilities/default.json` e troca de `src-tauri/tauri.conf.json`

**Files:**
- Modify: `front-v2/package.json` (adicionar script `"dev:tauri": "vite --host 127.0.0.1 --port 1430 --strictPort"`, sem `VITE_CORE_MOCK=1` nem sintaxe POSIX de variável inline)
- Modify: `front-v2/src/main.tsx` (extrair função testável `iniciarApp()` que, quando `isTauri()`, aguarda `initMediaTransport()` de `../../../src/lib/media` com `.catch(() => {})` antes de renderizar `<App />`, e importa `../../../src/lib/desktop` / inicialização de `window.__CLIPES_E2E__` quando `import.meta.env.VITE_E2E === '1'`)
- Modify: `src-tauri/src/media_server.rs` (incluir `"http://localhost:1430" | "http://127.0.0.1:1430"` em `is_allowed_origin` dentro de `cfg!(debug_assertions)`, preservando `1420` para reversão ao V1, com teste unitário)
- Modify: `src-tauri/capabilities/default.json` (revisar e manter permissões mínimas explícitas: confirmar `core:window:allow-destroy`, `updater:*`, `process:allow-restart`, `dialog:allow-open/save`, `clipboard-manager:allow-write-text`, e avaliar se `opener:allow-open-url` precisa incluir `https://github.com/GUSTAVOHOOO/clipes` além de `issues/new*` conforme necessidade da tela Sobre, mantendo fallback de clipboard sem `opener:allow-open-path` irrestrito)
- Modify: `src-tauri/tauri.conf.json` (atualizar apenas `build`: `"beforeDevCommand": "bun run --cwd front-v2 dev:tauri"`, `"devUrl": "http://127.0.0.1:1430"`, `"beforeBuildCommand": "bun run --cwd front-v2 build"`, `"frontendDist": "../front-v2/dist"`)
- Test: `front-v2/src/main.test.ts`

**Interfaces:**
- Consumes: `isTauri` (`@tauri-apps/api/core`), `initMediaTransport` (`../../../src/lib/media`), inicializador `__CLIPES_E2E__` (`../../../src/lib/desktop` ou `~/core/desktop`).
- Produces:
  - `iniciarApp(raiz?: HTMLElement | null)` em `front-v2/src/main.tsx` montando `<App />` após `initMediaTransport()` no Tauri e imediatamente no navegador.
  - `src-tauri/tauri.conf.json` apontando para `front-v2/` em dev e release build.
  - `is_allowed_origin` em `src-tauri/src/media_server.rs` cobrindo `:1420` e `:1430` em debug.

- [ ] **Step 1: Testes falhando** —
  - `front-v2/src/main.test.ts`:
    - quando `isTauri()` retorna `true`, `iniciarApp(el)` chama `initMediaTransport()` e **só depois** monta `<App />`;
    - se `initMediaTransport()` rejeitar, `iniciarApp(el)` não trava e monta `<App />` mesmo assim;
    - quando `isTauri()` retorna `false`, `iniciarApp(el)` monta `<App />` sem bloquear em `initMediaTransport()`;
    - com `VITE_E2E=1`, `window.__CLIPES_E2E__` fica inicializado no boot (`dialogQueue`, `confirmQueue`, `openedUrls`, `copiedText`, `updaterMode`).
  - `src-tauri/src/media_server.rs` (`mod tests`): teste confirmando que `is_allowed_origin("http://127.0.0.1:1430")` e `is_allowed_origin("http://localhost:1430")` retornam `true` em `debug_assertions` (junto de `:1420`) e origens arbitrárias (`https://evil.example`, `http://127.0.0.1:9999`) retornam `false`.
- [ ] **Step 2:** `cd front-v2; bun run test src/main.test.ts` → FAIL (`iniciarApp` não existe).
- [ ] **Step 3:** Implementar `"dev:tauri"` em `front-v2/package.json`, atualizar `front-v2/src/main.tsx`, atualizar `media_server.rs`, revisar `src-tauri/capabilities/default.json` e alterar `build` em `src-tauri/tauri.conf.json`.
- [ ] **Step 4:**
  - `cd front-v2; bun run typecheck; bun run build; bun run test src/main.test.ts` → PASS e gera `front-v2/dist/index.html`.
  - `cargo test -p clipes` → PASS (inclui `media_server::tests` e `tests::close_requested_*`).
- [ ] **Step 5:** Commit `feat(tauri): apontar tauri.conf.json para front-v2 e inicializar transporte de mídia no boot`.

---

### Tarefa 2: Coexistência V1, mapa exato de dependências em `src/lib/core.ts` e caminho de reversão documentado e testado

**Files:**
- Modify: `front-v2/README.md` (documentar: (1) permanência de `src/` e `design-system/` até depois da `v2.0.0`; (2) inventário exato do que `front-v2` continua importando de `src/lib/core.ts` e vizinhos de `src/`; (3) passo a passo de reversão V2 → V1 em `src-tauri/tauri.conf.json` e compatibilidade de SQLite/`localStorage`; (4) como rodar `scripts/test-reversao-v1.mjs`)
- Create: `scripts/test-reversao-v1.mjs` (script automatizado em Node/Bun que valida o caminho de reversão sem deixar alterações no working tree)

**Interfaces:**
- Consumes: `src-tauri/tauri.conf.json`, `package.json`, `vite.config.ts`, `src/lib/core.ts`, `src/lib/media.ts`, `src/lib/desktop.ts`, `src/features/updates/updateError.ts`, `src/features/editor/{cropMath,timelineMath,duckingMath}.ts`, `src/features/captions/{render,types}.ts`.
- Produces:
  - Inventário auditado e preservado de **o que do `src/lib/core.ts` (e `src/`) o `front-v2` continua importando**:
    1. `src/lib/core.ts` (via `@core`): `coreDispatch<T>()`, `assinarProgressoMock()`, `emitirProgressoMock()`, tipos `ExportRequest` e `EventoProgressoMock` — além das dependências transitivas de `src/lib/core.ts` (`version` de `../../package.json`, `./editorEditsMock`, `./captionsMock`, `./batchMock`, `./packagingMock`, `./thumbnailMock`, `./scriptMock`, `./translationMock`, `@/features/export/mock` via `aliasPorPacote()`).
    2. `src/lib/media.ts`: `initMediaTransport()`, `mediaUrl()`.
    3. `src/lib/desktop.ts`: `openDialog()`, `saveDialog()`, `openExternalUrl()`, `copyText()`, `confirmAction()`, `getUpdaterBehavior()`, `shouldMockUpdater()`, tipo `ClipesE2EState` / `window.__CLIPES_E2E__`.
    4. `src/features/updates/updateError.ts`: `isSignatureOrIntegrityError`, `isConnectivityError`, `shouldIgnoreAutoCheckError`, `formatUpdateError`, `errorReason`.
    5. `src/features/editor/{cropMath,timelineMath,duckingMath}.ts` e `src/features/captions/{render,types}.ts`: matemática de crop/timeline/ducking e renderizador 1080×1920 de legendas.
  - Procedimento exato de reversão V2 → V1: restaurar em `src-tauri/tauri.conf.json` os 4 campos `build`:
    ```json
    "beforeDevCommand": "bun run dev",
    "devUrl": "http://localhost:1420",
    "beforeBuildCommand": "bun run build",
    "frontendDist": "../dist"
    ```
    sem precisar alterar nenhum banco `.clipes` (`project.sqlite` usa o mesmo `clipes-core`), nem apagar `front-v2/`.
  - `scripts/test-reversao-v1.mjs`:
    1. verifica que todos os exports listados de `src/lib/core.ts`, `src/lib/media.ts`, `src/lib/desktop.ts` e `src/features/` existem e tipam;
    2. executa `bun run typecheck` e `bun run build` na raiz (provando que o front V1 compila `dist/index.html` sem erros após a troca para v2);
    3. verifica que `tauri.conf.json` com override V1 (`--config` em memória ou validação de caminho `path.resolve('src-tauri', '../dist/index.html')`) encontra o bundle V1 gerado e que `src-tauri/src/media_server.rs` mantém `:1420` permitido;
    4. opcionalmente em modo `--with-cargo`, executa `cargo check -p clipes` com `--config` de reversão para provar que o embedding V1 compila em Rust.

- [ ] **Step 1: Teste falhando** — executar `node scripts/test-reversao-v1.mjs` → FAIL (arquivo não existe).
- [ ] **Step 2:** Documentar mapa de imports de `src/lib/core.ts` / `src/` e guia de reversão V1 em `front-v2/README.md` (atualizando também referências antigas de `?source-test=1` no README se necessário).
- [ ] **Step 3:** Implementar `scripts/test-reversao-v1.mjs`.
- [ ] **Step 4:** `node scripts/test-reversao-v1.mjs` → PASS (V1 `typecheck` + `build` verdes, `dist/index.html` presente, exports de `src/lib/core.ts` validados, `:1420` ativo em `media_server.rs`).
- [ ] **Step 5:** Commit `docs(front-v2): documentar e testar caminho de reversão V1 e dependências de src/lib/core.ts`.

---

### Tarefa 3: Migrar `scripts/e2e-tauri.mjs` para as telas v2 — Helpers Base UI/DS v2, Sessão 1 e Sessão 2

**Files:**
- Modify: `scripts/e2e-tauri.mjs` (migrar `createUi`, `runSession1` e `runSession2` para as rotas, rótulos, `role="combobox"`/`switch`/`tab`/`dialog`/`alertdialog`, `cmdk` Paleta, `<SeletorCaminho>`, Fila `Ctrl+J`, `#/relatos` em 2 passos, `#/sobre` lendo a versão esperada dinamicamente de `src-tauri/tauri.conf.json`, `#/config/*`, `#/inicio`, `#/projeto/:id/fontes`, `#/projeto/:id/fontes/:fonteId`)

**Interfaces:**
- Consumes: `src-tauri/tauri.conf.json` (versão esperada), binário real `target/debug/clipes` compilado com `VITE_E2E=1` (e sem `VITE_CORE_MOCK`), `fake-worker`, `fake_ytdlp`, `fake_provider_cli`, `fake_opencode`, `startFakeProviderServer`, `ffmpeg`/`ffprobe` reais, `window.__CLIPES_E2E__`.
- Produces:
  - `createUi(browser)` atualizado para o DS v2 (`@base-ui/react` 1.9.0):
    - `selectField(label, optionTextOrValue)`: suporta tanto `<select>` nativo quanto gatilho Base UI `role="combobox"` (clica no combobox, aguarda `[role="listbox"]` visível e clica em `[role="option"]`);
    - `setChecked(label, desired)` / `isChecked(label)`: lê `aria-checked` em `[role="switch"]` e `[role="checkbox"]` além de `input[type="checkbox"]`;
    - `clickTab(name)`: clica em `[role="tab"]` pelo nome acessível;
    - `navigateHash(hash)`: helper seguro para saltos diretos quando necessário sem perder estado da WebView.
  - `runSession1(ui, ctx)` migrado para v2:
    1. Boot cai em `#/assistente?passo=1` (`assistant.status().needsSetup === true`); configurar FFmpeg do sistema (`"Já tenho FFmpeg instalado no computador"` ou validação) e avançar para Passo 2 (`?/passo=2`), escolher **Codex CLI** com `<ConfirmDialog>` de consentimento → concluir → cai em `#/inicio`.
    2. Updater via hook E2E (`sessionStorage.setItem('clipes.e2e.updaterMode', 'available')` + `location.reload()`) → verificar indicador/ponto de atualização ou ir via Paleta `Ctrl+K` (`cmdk`) para `#/sobre` → conferir versão lida de `tauri.conf.json` e `Apache-2.0` → acionar `"Verificar atualizações"` / `"Baixar e instalar"` no modo mock E2E → limpar `updaterMode` para `'off'`.
    3. `Ctrl+J` abre e `Esc` fecha `<PainelFilaJobs>` (`aside[aria-label="Fila de Jobs"]`), devolvendo foco ao gatilho; `F6` cicla regiões macro.
    4. `#/config/componentes`: validar manifesto real (`GPL-3.0-or-later`, `Unlicense`), `Limite do cache (GB)` = `10` → `12`, cancelar download via `window.__CLIPES_E2E__.confirmQueue`, cancelar `"Atualizar yt-dlp?"` em `<ConfirmDialog>`, validar FFmpeg do sistema, instalar Worker ML via `<ConfirmDialog>` (`uv: MIT OR Apache-2.0`, `PSF-2.0`, `Protocolo 1`, `faster-whisper fake`), abrir diálogo de modelo `Whisper small` (`MIT`, `SHA-256`) e cancelar.
    5. `#/relatos`: validar regra obrigatória em 2 passos do ADR-0006 (`Copiar texto`, `Exportar diagnóstico (.txt)` e `Abrir no GitHub` **não existem no DOM** no Passo 1; alternar tipo atualiza `Incluir diagnóstico`; detector `/token|chave|\bkey\b/i` exibe `role="alert"` sem roubar foco) → clicar `"Revisar relato antes de enviar"` → no Passo 2 conferir diagnóstico com versão do `tauri.conf.json` e `FFmpeg do sistema`, exportar `.txt` via `queueDialog` verificando arquivo no disco, e testar `Abrir no GitHub` normal e > `8000` bytes UTF-8 (cópia automática no `copiedText`).
    6. `#/config/provedores` e `#/config/custos`: chave Groq isolada no `ctx.vaultFile` (salvar, mascarada, remover via `<ConfirmDialog>`, salvar de novo), alternar Provedor HTTP remoto (consentimento HTTPS obrigatório + `role="alertdialog"` com focus trap) vs servidor local (`Authorization: Bearer sk-local-server-1234`), OpenCode CLI (`free-limit` + desativar), criar 2 Perfis (`Local rápido` e `Nuvem remota`), tabela Tarefas + `Somente local` bloqueando envio remoto, remover perfil via `<ConfirmDialog>`, e em `#/config/custos` testar Estimador + sobrescrita/remoção de preço.
    7. `#/config/aparencia`: alternar Tema (`claro` → `data-tema="claro"` → `escuro` → `data-tema="escuro"`), testar Alto Contraste (`data-contrast="high"`) e interruptor WCAG 2.1.4; reabrir Assistente em `#/config/provedores` e pular (`"Pular por enquanto"`).
  - `runSession2(ui, ctx)` migrado para v2:
    1. Pós-reinício: `#/inicio` abre sem reabrir `#/assistente`.
    2. Criar Projetos reais SQLite (`Canal.clipes`, `Secundario.clipes`) via `<DialogoNovoProjeto>` + `queueDialog(ctx.projectsDir)` e alternar para `Canal.clipes` via `"Abrir pasta .clipes"` / lista recente.
    3. `#/config/projeto`: testar veto `Somente local` refletindo no selo do topo e bloqueio em `#/config/provedores`, depois desligar; configurar Backups (`15` min, `5` cópias), criar backup manual, alterar `Somente local`, restaurar backup via `<ConfirmDialog>` e provar reversão do `project.sqlite`.
    4. `#/projeto/:id/fontes`: importar `source.mkv` multipista (`64 × 64`, faixa `2`, Permissão `granted`), aguardar job `Onda e miniaturas` concluir via `PainelFilaJobs` / cache `cache/previews`, simular `Fonte alterada` (`utimes`) + `"Verificar identidade"`, simular `Fonte offline` (`rename`) + `"Relocalizar arquivo"` via `<SeletorCaminho>`, importar por URL (`fake-ytdlp`, pasta customizada, `<ConfirmDialog>` Termos, `Sem permissão`).
    5. `#/projeto/:id/fontes/:fonteId`: iniciar transcrição local com `holdFile` → aguardar `33%` → cancelar mantendo blocos → selecionar `Groq` → cancelar no consentimento após `<ConfirmDialog>` de substituição parcial → voltar a `Local` → remover `holdFile` → retomar até `Transcrição pronta` → verificar `<ListaVirtual>` da Transcrição + correção `F2` (`transcription.correct`).

- [ ] **Step 1: Conferir falha contra o app v2 atual** — rodar `node scripts/e2e-tauri.mjs` antes da migração para registrar os pontos exatos de quebra dos seletores V1 contra a UI v2.
- [ ] **Step 2:** Atualizar `createUi`, `runSession1` e `runSession2` em `scripts/e2e-tauri.mjs` (lendo a versão dinamicamente de `src-tauri/tauri.conf.json`).
- [ ] **Step 3:** Executar `bun run test:e2e` (ou `CLIPES_E2E_SKIP_BUILD=1` após build inicial) para confirmar Sessões 1 e 2 verdes em WebView real.
- [ ] **Step 4:** Commit `test(e2e): migrar sessões 1 e 2 do e2e-tauri.mjs para front-v2`.

---

### Tarefa 4: Fluxo real do mandato no `scripts/e2e-tauri.mjs` — Abrir Projeto existente da V1, revisar, editar, exportar um Corte e validar `#291`

**Files:**
- Modify: `scripts/e2e-tauri.mjs` (adicionar `prepareV1ProjectFixture` + `runSession3` cobrindo o fluxo completo do mandato em binário Tauri real com SQLite V1 migrado e exportação MP4 conferida por `ffprobe`)

**Interfaces:**
- Consumes: `core/tests/fixtures/project-pre-0104.sqlite` (ou banco V1 construído com esquema pré-migração mais recente compatível com `projects.open`), `ffmpeg` + `ffprobe` reais, `fake_encoders`/encoder real `libx264` + `libass`, rotas `#/inicio`, `#/projeto/:id/fontes`, `#/projeto/:id/cortes`, `#/projeto/:id/cortes/revisao/:runId`, `#/projeto/:id/corte/:corteId/editar`, `#/projeto/:id/exportacao`.
- Produces:
  - `prepareV1ProjectFixture({ tempRoot, ffmpeg })`:
    - gera vídeo sintético `v1-source.mp4` (`1280×720`, 30 s, H.264 + AAC 48 kHz) via `ffmpeg`;
    - monta pasta `ProjetoV1.clipes/project.sqlite` usando esquema V1 (com pelo menos 1 migração pendente para exercitar `project.pre-migration.sqlite`, conforme `core/tests/rusqlite_compat.rs`), contendo:
      - 1 Fonte `available` apontando para `v1-source.mp4` (sem `full_hash` completo se aplicável ao V1, e Permissão `granted` registrada);
      - 1 Transcrição `complete` com Frases reais (ex.: 4 Frases totalizando 30 s);
      - 1 execução de seleção V1 (`selection_runs` com `revision = 1`, `video_kind = 'direct'`, `state = 'completed'`) + `selection_windows` + 2 `selection_candidates` (`status = 'pending'`, sem `packaging` nem `thumbnail` prévios — retrato fiel de Projeto V1).
  - `runSession3(ui, ctx)` em `scripts/e2e-tauri.mjs`:
    1. **Abrir Projeto existente da V1:** em `#/inicio`, acionar `"Abrir pasta .clipes"` (`queueDialog(ctx.v1ProjectDir)`), confirmar abertura de `ProjetoV1`, verificar criação de `project.pre-migration.sqlite` em disco e carregamento das Fontes/Transcrição V1 em `#/projeto/:id/fontes`.
    2. **Revisar Corte:** ir para macro-etapa `Cortes` (`#/projeto/:id/cortes`), abrir a execução V1 na Bancada (`#/projeto/:id/cortes/revisao/:runId`), aguardar `<PlayerProxy>` 9:16 carregar, expandir `"Ver os 5 eixos"`, ajustar borda `±1 Frase` (`I` / `Shift+I` ou botão `<AjusteBorda>`), aprovar candidato com teclado (`A`), confirmar ação `#292` desabilitada em `Corte direto`, e clicar `"Abrir no editor"`.
    3. **Editar Corte:** em `#/projeto/:id/corte/:corteId/editar`, confirmar `<ContextoCorte>` + `<PainelEsquerdoCorte>` + `<PalcoEditor>` + `<TimelineCorte>`, alternar silêncio ou ajustar borda / legenda, pressionar `Ctrl+S` (ou aguardar autosave) verificando `"Salvo"` na Barra de Status, e verificar que não há `pageerror` nem scroll horizontal da janela em `1366×768`.
    4. **Exportar Corte e validar mídia real:** acionar `"Exportar Corte"` (`Ctrl+E`) no `<ContextoCorte>`, confirmar `<ChecklistGuardaCorpos>` (inclusive ciência `guardrails.ack_direct_notice` se pendente), escolher destino `corte-v1-exportado.mp4` via `queueDialog`, disparar `export.start`, acompanhar progresso real até concluir, e validar o MP4 no disco com `ffprobe` (`codec_name === 'h264'`, `width === 1080`, `height === 1920`, `aac`, `sample_rate === '48000'`). Conferir também `#/projeto/:id/exportacao` mostrando o Projeto V1 na Mesa de Prontidão (com fallback `"Título sugerido (sem Empacotamento)"`).
    5. **Fechamento coordenado `#291`:** fechar a janela via `window.close()` sem jobs ativos e confirmar encerramento limpo sem travamento do WebDriver/processo.

- [ ] **Step 1:** Escrever `prepareV1ProjectFixture` e `runSession3` em `scripts/e2e-tauri.mjs` (incluindo asserts `ffprobe` no MP4 exportado e `project.pre-migration.sqlite` no disco).
- [ ] **Step 2:** Executar `bun run test:e2e` contra o binário `target/debug/clipes` compilado com `front-v2` → PASS (Sessões 1, 2 e 3, screenshots em `shots-e2e/`, zero `pageerror`).
- [ ] **Step 3:** Commit `test(e2e): cobrir fluxo Projeto V1 → revisar → editar → exportar no e2e-tauri.mjs`.

---

### Tarefa 5: `scripts/linux-validation.mjs`, workflows de CI (`ci.yml`, `linux-validation.yml`, `release.yml`) e smoke do pacote por plataforma

**Files:**
- Modify: `scripts/linux-validation.mjs` (atualizar espera de boot/UpdateNotice v2 e substituir `CustomEvent('clipes-preview-open')` + `section[aria-label="Preview do Corte"]` pela navegação v2 até `#/projeto/:id/corte/avulso-<sourceId>-1-2/editar` validando carregamento, reprodução e transporte loopback do `<video>` no `PalcoEditor` no WebKitGTK)
- Create: `scripts/smoke-package.mjs` (smoke multiplataforma dos instaladores gerados pelo Tauri:
  - no **Windows (`.exe` NSIS)**: instala silenciosamente em pasta temporária isolada (`/S /D=<temp>`), abre `clipes.exe` via `tauri-driver` + `msedgedriver` em `CLIPES_DATA_DIR` temporário, verifica carregamento real do `front-v2` sem `localhost:1430` e com a versão esperada de `tauri.conf.json`, testa fechamento limpo (`#291`), executa o desinstalador e garante que dados do usuário não foram removidos (`#231`);
  - no **Linux (`.AppImage` e `.deb`)**: extrai AppImage (`--appimage-extract`) e sobe `AppRun` via `tauri-driver` sob `xvfb-run` validando DOM do `front-v2`, ausência de `pageerror` e versão esperada; para `.deb`, valida `dpkg-deb -I` com dependências GStreamer `gstreamer1.0-plugins-good`, `gstreamer1.0-plugins-bad`, `gstreamer1.0-libav` + boot do binário instalado)
- Modify: `.github/workflows/ci.yml`:
  - job `check`: adicionar instalação e checks de `design-system-v2` (`bun install --frozen-lockfile`, `bun run typecheck`, `bun run build`, `bun run contraste`) e manter checks do V1 (para reversão) + `front-v2`;
  - job `e2e`: adicionar `bun install --frozen-lockfile` em `front-v2` antes de `bun run test:e2e`;
  - job `licenses`: adicionar `bun install --frozen-lockfile` em `front-v2` e `design-system-v2` e rodar `bunx license-checker-rseidelsohn@4.4.2 --production --unknown --start ... | node scripts/check-licenses.mjs` também para `front-v2` e `design-system-v2`.
- Modify: `.github/workflows/linux-validation.yml`: adicionar `bun install --frozen-lockfile` em `front-v2` antes de `bun run tauri build` e conferir que o script inline do AppImage valida o DOM v2 (`<header>` e texto `"Clipes"` sem erro JS).
- Modify: `.github/workflows/release.yml`: adicionar `bun install --frozen-lockfile` em `front-v2` antes de `bun run tauri build --bundles ${{ matrix.bundles }}` e adicionar step de smoke por plataforma em `pull_request` (rodando `node scripts/smoke-package.mjs` no `.exe` NSIS no Windows e no `.AppImage`/`.deb` sob `xvfb-run` no Linux).

**Interfaces:**
- Consumes: `scripts/setup-webdriver.mjs` (`ensureWebDriver`), `src-tauri/tauri.conf.json`, `scripts/check-licenses.mjs`.
- Produces: CI verde cobrindo build/testes/licenças de V1, `design-system-v2` e `front-v2`, validação Linux WebKitGTK e smoke dos pacotes NSIS / AppImage / `.deb`.

- [ ] **Step 1:** Atualizar `scripts/linux-validation.mjs` para usar rotas v2 em vez de `clipes-preview-open` e validar sintaxe/execução de dry-run (e no Linux CI sob `xvfb-run`).
- [ ] **Step 2:** Criar `scripts/smoke-package.mjs` com suporte a `--platform windows-nsis | linux-appimage | linux-deb` e testes unitários de parsing/comandos ou execução real no ambiente local disponível.
- [ ] **Step 3:** Atualizar `.github/workflows/ci.yml`, `.github/workflows/linux-validation.yml` e `.github/workflows/release.yml`.
- [ ] **Step 4:** Validar localmente os steps de licenças (`license-checker-rseidelsohn` em `.`, `design-system`, `front-v2`, `design-system-v2`), `design-system-v2` (`typecheck`, `build`, `contraste`) e smoke do pacote local disponível.
- [ ] **Step 5:** Commit `ci(front-v2): atualizar workflows, linux-validation e smoke de pacotes por plataforma`.

---

### Tarefa 6: Bump de versão para `2.0.0` nos manifestos (sem tag nem release) e fechamento da Onda 7

**Files:**
- Modify: `src-tauri/tauri.conf.json` (`"version": "2.0.0"`)
- Modify: `src-tauri/Cargo.toml` (`version = "2.0.0"`)
- Modify: `core/Cargo.toml` (`version = "2.0.0"`)
- Modify: `Cargo.lock` (atualizado para `clipes 2.0.0` e `clipes-core 2.0.0` via `cargo check --workspace`)
- Modify: `package.json` (`"version": "2.0.0"`)
- Modify: `front-v2/package.json` (`"version": "2.0.0"`)
- Modify: `design-system-v2/package.json` (`"version": "2.0.0"`)
- Modify: `src/lib/core.ts` (em `diagnostic.get`, substituir `"Clipes: 1.0.0\n..."` por `` `Clipes: ${version}\n...` `` usando `version` já importado de `../../package.json`)
- Modify: `src/features/updates/UpdateNotice.tsx` (trocar literal `'1.0.0'` fora do Tauri pelo `version` de `package.json` ou `'2.0.0'`)
- Modify: `scripts/ui.mjs` (atualizar asserts `/1\.0\.0/` para `/2\.0\.0/`)
- Modify: `.github/workflows/ci.yml` (atualizar `--excludePackages` no job `licenses`: `'clipes@2.0.0'`, `'@clipes/front-v2@2.0.0'`, `'@clipes/design-system-v2@2.0.0'`)

**Interfaces:**
- Consumes: todos os manifestos do workspace JS e Rust.
- Produces: aplicativo e pacotes configurados na versão `2.0.0` (`app.version` retorna `"2.0.0"`), **sem criação de tag git nem release no GitHub**.

- [ ] **Step 1:** Atualizar versão `"2.0.0"` em `src-tauri/tauri.conf.json`, `src-tauri/Cargo.toml`, `core/Cargo.toml`, `package.json`, `front-v2/package.json`, `design-system-v2/package.json` e regenerar `Cargo.lock` com `cargo check --workspace`.
- [ ] **Step 2:** Atualizar `src/lib/core.ts` (`diagnostic.get` usando `${version}`), `src/features/updates/UpdateNotice.tsx`, `scripts/ui.mjs` e `--excludePackages` no job `licenses` de `.github/workflows/ci.yml`.
- [ ] **Step 3:** Confirmar ausência de tag `v2.0.0` (`git tag -l v2.0.0` vazio) — publicação fica exclusivamente com o coordenador.
- [ ] **Step 4: Bateria final completa:**
  - `cargo test --workspace` → PASS
  - `bun run typecheck; bun run build; bun run test:contrast; bun run test:ui` (garante V1 íntegro para reversão) → PASS
  - `bun run --cwd design-system-v2 typecheck; bun run --cwd design-system-v2 build; bun run --cwd design-system-v2 contraste` → PASS
  - `cd front-v2; bun run typecheck; bun run build; bun run test; bunx playwright test` → PASS
  - `bunx impeccable detect --json front-v2/src` → sem achados críticos
  - `node scripts/test-reversao-v1.mjs` → PASS
  - `bun run test:e2e` (Tauri E2E completo com Projeto V1 → Revisão → Editor → Export MP4 + `#291`) → PASS
  - Auditoria de licenças JS em `.`, `design-system`, `front-v2`, `design-system-v2` + `cargo deny --locked check licenses bans advisories sources` → PASS
- [ ] **Step 5:** Limpeza de disco (`cargo clean` no worktree e apagar pastas `%TEMP%\clipes-<ticket>-*` criadas).
- [ ] **Step 6:** Commit `chore(release): preparar manifestos da v2.0.0 com front-v2 como padrão` (sem tag, sem release).

---

## Tickets

Agrupamento das 6 tarefas em **4 tickets** executáveis em PRs pequenos, com arquivos disjuntos entre T1, T2, T3 e T4 (a versão esperada em `scripts/e2e-tauri.mjs` e `scripts/smoke-package.mjs` é lida dinamicamente de `src-tauri/tauri.conf.json`, evitando conflito com o bump `2.0.0` de T4).

| Ticket | Título | Tarefas | Depende de | Arquivos criados / editados | Lacunas do mock TS fechadas |
|---|---|---|---|---|---|
| **T1** | `front-v2(onda 7): Boot Tauri no front-v2, troca de tauri.conf.json e caminho de reversão V1` | Tarefas 1, 2 | Onda 0 (`#315`–`#318`), `#291` (PR `#346`), Onda 1 (`#329`–`#333`), Onda 2 (`#342`–`#345`), Onda 3 (`#348`–`#351`), Onda 4 (`#354`–`#358`), Onda 5 (`#363`–`#367`), Onda 6 (`#368`–`#371`) | `front-v2/package.json`, `front-v2/src/main.tsx`, `front-v2/src/main.test.ts`, `front-v2/README.md`, `src-tauri/tauri.conf.json`, `src-tauri/src/media_server.rs`, `src-tauri/capabilities/default.json`, `scripts/test-reversao-v1.mjs` | — *(todas as lacunas do mock TS foram fechadas nas Ondas 1–6; T1 conecta o boot Tauri real e documenta o que continua importado de `src/lib/core.ts`)* |
| **T2** | `front-v2(onda 7): Migrar E2E Tauri (scripts/e2e-tauri.mjs) para telas v2 e fluxo Projeto V1 → Export` | Tarefas 3, 4 | **T1**, Ondas 1–6 | `scripts/e2e-tauri.mjs` | — *(executa contra o binário Rust `clipes-core` real sem `VITE_CORE_MOCK`)* |
| **T3** | `front-v2(onda 7): Migrar linux-validation.mjs, CI (check/e2e/licenses) e smoke de pacotes por plataforma` | Tarefa 5 | **T1**, **T2** | `scripts/linux-validation.mjs`, `scripts/smoke-package.mjs`, `.github/workflows/ci.yml`, `.github/workflows/linux-validation.yml`, `.github/workflows/release.yml` | — *(usa binário/pacotes reais gerados pelo Tauri)* |
| **T4** | `front-v2(onda 7): Versão 2.0.0 nos manifestos (sem tag/release) e fechamento da Onda 7` | Tarefa 6 | **T1**, **T2**, **T3** | `package.json`, `front-v2/package.json`, `design-system-v2/package.json`, `src-tauri/tauri.conf.json`, `src-tauri/Cargo.toml`, `core/Cargo.toml`, `Cargo.lock`, `src/lib/core.ts`, `src/features/updates/UpdateNotice.tsx`, `scripts/ui.mjs`, `.github/workflows/ci.yml` | `diagnostic.get` em `src/lib/core.ts` passa a interpolar `version` de `package.json` (sem `"1.0.0"` literal); `UpdateNotice.tsx` alinhado a `2.0.0` |

### Critérios de aceite por ticket

#### T1 — `front-v2(onda 7): Boot Tauri no front-v2, troca de tauri.conf.json e caminho de reversão V1`
- [ ] Testes unitários em `front-v2/src/main.test.ts` cobrindo os estados de boot (`loading`/aguarda `initMediaTransport()` no Tauri, `error`/fallback não bloqueante se `media_base_url` falhar, `ready` no navegador e inicialização de `window.__CLIPES_E2E__` com `VITE_E2E=1`).
- [ ] Testes em `src-tauri/src/media_server.rs` (`cargo test -p clipes`) comprovando que `is_allowed_origin` aceita `:1430` (v2) e `:1420` (reversão V1) em `debug_assertions` e bloqueia origens externas (`403`).
- [ ] `src-tauri/tauri.conf.json` aponta `beforeDevCommand`, `devUrl`, `beforeBuildCommand` e `frontendDist` para `front-v2/`, sem remover `src/` nem `design-system/`.
- [ ] `front-v2/README.md` documenta todas as importações preservadas de `src/lib/core.ts` e vizinhos + passo a passo de reversão V2 → V1; `node scripts/test-reversao-v1.mjs` passa provando `dist/` do V1 compilável e `src/lib/core.ts` íntegro.
- [ ] Todos os testes existentes de componente (§6, ação, teclado) e fluxos Playwright em `1366×768` e `1440×900` (`front-v2/e2e/*.spec.ts`) seguem 100% verdes.

#### T2 — `front-v2(onda 7): Migrar E2E Tauri (scripts/e2e-tauri.mjs) para telas v2 e fluxo Projeto V1 → Export`
- [ ] `scripts/e2e-tauri.mjs` migrado 100% para os componentes DS v2 / Base UI e rotas v2 (`#/assistente`, `#/inicio`, `#/config/*`, `#/relatos` 2 passos, `#/sobre`, `#/projeto/:id/fontes`, `#/projeto/:id/fontes/:fonteId`, `#/projeto/:id/cortes/revisao/:runId`, `#/projeto/:id/corte/:corteId/editar`, `#/projeto/:id/exportacao`, `PainelFilaJobs` `Ctrl+J`).
- [ ] Fluxo completo do mandato verde em binário Tauri real (`bun run test:e2e`): **abrir um Projeto existente da V1** (com migração automática + `project.pre-migration.sqlite`) → **revisar** candidato (eixos da Nota, `±1 Frase`, aprovação por teclado `A`) → **editar** no Editor v2 (`PalcoEditor`, `TimelineCorte`, `Ctrl+S` / `"Salvo"`) → **exportar** Corte MP4 real conferido por `ffprobe` (`h264`, `1080×1920`, `aac`, `48000 Hz`).
- [ ] Cobre teclado (`Ctrl+K`, `Ctrl+J`, `Esc`, `F6`, `F2`, `A`, `I`/`O`, `Ctrl+S`, `Ctrl+E`), estados §6 reais exercitados (vazio, erro traduzido, carregando, job rodando, parcial/offline/alterada), ações dependentes de `#292`–`#307` mantidas desabilitadas sem erro e fechamento coordenado `#291`.
- [ ] Suíte `front-v2/e2e/*.spec.ts` (`1366×768` e `1440×900`) e `bun run test:e2e` verdes, com zero `pageerror` e screenshots atualizados em `shots-e2e/`.

#### T3 — `front-v2(onda 7): Migrar linux-validation.mjs, CI (check/e2e/licenses) e smoke de pacotes por plataforma`
- [ ] `scripts/linux-validation.mjs` migrado para abrir e testar `<video>` no Editor v2 (`#/projeto/.../corte/avulso-1-1-2/editar`), sem depender de `clipes-preview-open` nem seletores V1, mantendo benchmark de seek, segurança loopback e fallback `libx264`.
- [ ] `scripts/smoke-package.mjs` valida os instaladores gerados por plataforma: Windows NSIS `.exe` (instalação silenciosa em pasta isolada, boot real via WebDriver carregando `front-v2` sem erro JS, desinstalação preservando dados `#231`) e Linux `.AppImage` / `.deb` (`--appimage-extract`, `dpkg-deb -I` com dependências GStreamer e boot real sob `xvfb-run`).
- [ ] `.github/workflows/ci.yml`, `linux-validation.yml` e `release.yml` instalam dependências de `front-v2/` (e `design-system-v2/`) antes do build Tauri, auditam licenças JS de produção em `front-v2` e `design-system-v2`, e mantêm os checks do V1 verdes para reversão.
- [ ] Todos os checks em `front-v2` (`typecheck`, `build`, `test`, `e2e/*.spec.ts` em `1366×768` e `1440×900`) e workflows aplicáveis no PR verdes no CI.

#### T4 — `front-v2(onda 7): Versão 2.0.0 nos manifestos (sem tag/release) e fechamento da Onda 7`
- [ ] Versão `2.0.0` aplicada em `src-tauri/tauri.conf.json`, `src-tauri/Cargo.toml`, `core/Cargo.toml`, `Cargo.lock`, `package.json`, `front-v2/package.json` e `design-system-v2/package.json`, com `app.version` retornando `"2.0.0"` em Rust e no mock (`src/lib/core.ts` / `UpdateNotice.tsx`), e `--excludePackages` de `ci.yml` atualizado para `2.0.0`.
- [ ] Nenhuma tag git nem GitHub Release criada (publicação reservada ao coordenador).
- [ ] Bateria completa de fechamento verde após a última edição: `cargo test --workspace`, `cargo deny`, `bun run typecheck && bun run build && bun run test:contrast && bun run test:ui` (V1), `design-system-v2` (`typecheck`, `build`, `contraste`), `front-v2` (`typecheck`, `build`, `test`, `bunx playwright test` em `1366×768` e `1440×900`), `bunx impeccable detect --json front-v2/src`, `node scripts/test-reversao-v1.mjs` e `bun run test:e2e`.
- [ ] Disco limpo antes do `worker_done` (`cargo clean` e remoção de `%TEMP%\clipes-<ticket>-*`).
