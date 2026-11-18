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
