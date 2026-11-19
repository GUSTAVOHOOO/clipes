# Front v2 do Clipes

Interface v2 do Clipes (React 19, TypeScript, Vite e Tailwind 4), construída sobre os componentes de [`design-system-v2/`](../design-system-v2) (`@ds`) e falando com o núcleo por `@core` (`src/lib/core.ts`, com mock TS quando `VITE_CORE_MOCK=1`).

Especificação: [arquitetura](../docs/produto/front-v2/01-arquitetura.md), [plano de implementação](../docs/produto/front-v2/04-plano-implementacao.md), [`DESIGN.md`](../DESIGN.md) e [`GLOSSARY.md`](../GLOSSARY.md).

## Como rodar

```sh
cd front-v2
bun install
bun run dev        # http://127.0.0.1:1430 (sobe com VITE_CORE_MOCK=1)
```

Parâmetros de query suportados para QA e mock após `#` (ou na query da janela):

- `?estado=vazio|erro|carregando|parcial|offline|erro-flush|fallback` — força o estado da tela.
- `?source-test=1` — carrega o Projeto de demonstração no mock (ex.: `/?source-test=1#/projeto/test-project/cortes`).

## Testes e verificação

```sh
bun run typecheck      # checagem TypeScript (tsc --noEmit)
bun run build          # typecheck + build de produção (vite build)
bun run test           # testes unitários e de componente (Vitest + Testing Library)
bunx playwright test   # fluxos E2E contra o mock em 1366×768 e 1440×900 (ou bun run e2e)
```

Auditoria visual (a partir da raiz do repositório):

```sh
bunx impeccable detect --json front-v2/src
```

## Onde ficam as telas e módulos

- `src/App.tsx` — provedores globais, ligação das rotas e placeholders das telas (cada tela de `docs/produto/front-v2/telas/` entra nas ondas seguintes substituindo o placeholder correspondente).
- `src/shell/` — `<Shell>` (moldura global com `<Tela>` do `@ds`) e `EstadoForcado` (`ComEstado` / `?estado=`).
- `src/rotas/` — parser de hash com guardas (`rotas.ts`) e hook `useRota`.
- `src/core/` — cliente tipado `chamar` (`cliente.ts`), mapeador `CoreError.code` (`erros.ts`) e store da Fila sobre `core-progress` (`progresso.ts`).
- `src/preferencias/` — persistência local de tema, escala, alto contraste, idioma e atalhos (`preferencias.ts`).
- `src/comandos/` — registro central de atalhos e Paleta de comandos `Ctrl+K` (`atalhos.tsx`).
- `e2e/` — testes Playwright contra o mock; `docs/screenshots/` — capturas do shell em 1366×768 e 1440×900.

## Coexistência com o V1 e reversão

`src/` e `design-system/` (o front V1) **ficam no repositório até depois da `v2.0.0`**: o `front-v2/` ainda importa módulos de `src/` e a reversão depende deles. Não os remova nem mova.

### O que o front-v2 importa de `src/`

- `src/lib/core.ts` (alias `@core`): `coreDispatch`, `assinarProgressoMock`, `emitirProgressoMock` e o tipo `EventoProgressoMock`. O arquivo puxa `version` de `package.json` da raiz, os mocks `./editorEditsMock`, `./captionsMock`, `./batchMock`, `./packagingMock`, `./thumbnailMock`, `./scriptMock`, `./translationMock` e `@/features/export/mock` (resolvido por `aliasPorPacote()` em `vite.config.ts`). `ExportRequest` também é exportado ali.
- `src/lib/media.ts`: `initMediaTransport()` (boot em `src/main.tsx`) e `mediaUrl()` (telas de Fontes, Editor, Empacotar e Transformar).
- `src/features/updates/updateError.ts`: `isSignatureOrIntegrityError`, `isConnectivityError`, `shouldIgnoreAutoCheckError`, `formatUpdateError`, `errorReason`.
- `src/features/editor/{cropMath,timelineMath,duckingMath}.ts`: matemática de enquadramento, linha do tempo e ducking.
- `src/features/captions/{render,types}.ts`: renderizador 1080×1920 e tipos de legenda.
- `src/lib/desktop.ts` (`openDialog`, `saveDialog`, `openExternalUrl`, `copyText`, `confirmAction`, `getUpdaterBehavior`, `shouldMockUpdater`, `ClipesE2EState`): o front-v2 **não** o importa (usa `src/core/desktop.ts`), mas o V1 sim, e a reversão precisa dele.

### Reverter para o V1

Em `src-tauri/tauri.conf.json`, volte os 4 campos de `build`:

```json
"beforeDevCommand": "bun run dev",
"devUrl": "http://localhost:1420",
"beforeBuildCommand": "bun run build",
"frontendDist": "../dist"
```

Nada mais muda. Os bancos `.clipes` (`project.sqlite`) são do mesmo `clipes-core` e abrem nos dois fronts, e o `front-v2/` não precisa ser apagado. `media_server.rs` aceita `:1420` (V1) e `:1430` (V2) em build debug. As preferências do V2 ficam no `localStorage` da WebView na chave `clipes.preferencias.v1` (o V1 usa `clipes.language`); ao voltar para o V1 elas ficam sem uso, sem afetar o V1.

### Verificar a reversão

Da raiz do repositório:

```sh
node scripts/test-reversao-v1.mjs               # exports e imports de src/, typecheck e build do V1, dist/index.html
node scripts/test-reversao-v1.mjs --with-cargo  # também roda cargo check -p clipes com a configuração do V1
```

O script não altera arquivos versionados: a configuração do V1 é aplicada em memória (`TAURI_CONFIG`).
