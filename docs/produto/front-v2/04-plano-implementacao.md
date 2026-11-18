# Front v2 · Plano de implementação

> **Para agentes:** SUB-SKILL OBRIGATÓRIA: superpowers:subagent-driven-development (recomendado) ou superpowers:executing-plans para executar tarefa por tarefa. Toda tarefa é TDD (superpowers:test-driven-development): teste falhando primeiro, depois o mínimo de código. Passos com checkbox (`- [ ]`).

**Goal:** Construir o front v2 do Clipes do zero sobre o núcleo Rust da v1, com o design system v2, em ondas testadas, até substituir o front v1 no app Tauri.

**Architecture:** App novo em `front-v2/` (Vite + React 19 + TS + Tailwind 4), que importa os componentes de `design-system-v2/` por alias e fala com o núcleo só por um cliente tipado sobre o `coreDispatch` existente (`src/lib/core.ts`, que já traz o mock TS com `VITE_CORE_MOCK=1`). O front v1 (`src/`) continua sendo o app do Tauri até a Onda 7, quando o `tauri.conf.json` passa a apontar para `front-v2/` e o v1 é removido. Estado do front em stores pequenas com `useSyncExternalStore` (sem biblioteca nova).

**Tech Stack:** React 19, TypeScript, Tailwind 4, `@base-ui/react` 1.9.0, `lucide-react`, Vite; testes com Vitest + Testing Library + jsdom (unidade e componente) e `@playwright/test` contra o mock (fluxos); E2E Tauri existente (`bun run test:e2e`) na troca final.

**Spec:** `docs/produto/front-v2/01-arquitetura.md` (rotas §3, shell §4, fila §5, estados §6, custo §7, atalhos §8, acessibilidade §9, estado §10), `02-consolidacao.md` (componentes e decisões), `03-direcao-visual.md` (visual e organização), `telas/A..F-*.md` (cada tela), wireframes `docs/produto/front-v2/wireframes/` e protótipos `wireframes/prototipo/`. Issue-mãe: #288.

## Global Constraints

- Vocabulário do `GLOSSARY.md`: Projeto, Fonte, Corte, Corte direto, Vídeo transformado, Transcrição, Frase, Nota, Narração, Empacotamento, Provedor. Nunca "clipe", "short", "input" nem "IA" como substantivo. Textos em PT-BR, com folga para +30% (EN depois).
- Visual só pelo design system v2 (`design-system-v2/src/index.ts`); nenhuma cor fora dos tokens; o laranja-sinal só no playhead, na marca de seleção e no único botão primário da tela; estado com ícone + palavra.
- Revelação progressiva: só o que a tarefa atual precisa fica visível (decisão do dev, `03-direcao-visual.md`).
- WCAG 2.2 AA: texto ≥ 4,5:1, foco visível, alvo ≥ 24 px, estado nunca só por cor, `prefers-reduced-motion`, teclas únicas desligáveis (WCAG 2.1.4).
- Telas cabem em 1366×768 sem rolagem da janela; testadas também em 1440×900.
- Erro nunca aparece cru: sempre pelo mapeador `CoreError.code` (§6) dentro de `role="alert"`.
- Todo comando pago ou que manda dado para fora passa por `<ResumoCustoPrivacidade>` antes (§7).
- Nada de mudança em `core/` ou `src-tauri/` neste plano: o que faltar no núcleo já está nos tickets #289–#307; o front usa o mock e esconde/desabilita o que depende de ticket aberto.
- Disco: `cargo clean` e limpeza do `%TEMP%\clipes-<ticket>-*` antes de cada `worker_done` (AGENTS.md).

## Review Focus

1. **Evento `core-progress` de um job desconhecido ou fora de ordem** (ex.: `percentage` 100 antes de 40, job de outro Projeto, `job: "0"` residual de #293): a Fila não pode regredir nem mostrar job de outro Projeto. Teste em `progresso.test.ts` (Tarefa 3).
2. **Erro sem `code` ou com `code` desconhecido** (string solta, `undefined`, exceção JS): mensagem genérica humana com "Ver detalhe técnico", nunca tela branca. Teste em `erros.test.ts` (Tarefa 2).
3. **Hash inválido ou de Projeto que não está aberto** (`#/projeto/outro/cortes`, `#/qualquer`): redireciona pela guarda, sem loop. Teste em `rotas.test.ts` (Tarefa 4).
4. **Tecla única com foco em campo de texto ou com o interruptor WCAG 2.1.4 desligado**: não dispara. Teste em `atalhos.test.ts` (Tarefa 6).
5. **`localStorage` indisponível ou corrompido** (JSON inválido, acesso lançando): preferências caem no padrão sem quebrar a abertura. Teste em `preferencias.test.ts` (Tarefa 5).

---

## Ondas

Cada onda é um conjunto de tickets (sub-issues de #288), entregue em PRs pequenos, cada um com CI verde. Só a Onda 0 está detalhada aqui; o orquestrador da implementação escreve o plano detalhado de cada onda seguinte (mesmo formato, mesmo cabeçalho) antes de despachar, a partir da especificação da tela e do wireframe.

| Onda | Conteúdo | Especificação | Depende |
|---|---|---|---|
| **0 · Fundação** | `front-v2/` com testes, cliente do núcleo, mapeador de erros, Fila/`core-progress`, rotas e guardas, preferências, atalhos e paleta, shell `<Tela>` com estados forçados por `?estado=`, CI | `01-arquitetura.md` §3–§10 | — |
| **1 · Entrada e Configurações** | Início e Projetos, Assistente de primeiro uso, Instalador just-in-time, as 6 seções de Configurações | `telas/A-shell-inicio-config.md`, wireframes A2–A10 | 0 |
| **2 · Fontes e Transcrição** | Lista e entrada de Fontes (arquivo e link, Permissão), Lotes, Detalhe da Fonte e Transcrição (correção, busca, agrupamento de VAD) | `telas/B-fontes-e-transcricao.md`, B1–B3 | 0, 1 (componentes) |
| **3 · Cortes** | Configurador de Seleção com custo, Bancada de revisão (lista e detalhe, Nota, ±1 Frase, aprovar/rejeitar por teclado) | `telas/C-cortes-selecao-revisao.md`, C1–C2, `prototipo/revisao.html?variant=A` | 2 |
| **4 · Editor** | `<ContextoCorte>` e exportação individual; palco 9:16 + transporte + barra de 5 ações com popovers; Transcrição/Índice do Corte; timeline compacta; ciclo de vida (`editor.open`, autosave, `editor.flush`, diálogo de 3 ações) | `telas/D-corte-editar.md`, D1–D5, `prototipo/editor.html?variant=D` | 3 |
| **5 · Transformar e Empacotar** | Ângulos, Roteiro, Narração (TTS, gravação, importação, teleprompter); Empacotamento com validadores | `telas/E-corte-transformar-empacotar.md`, E1–E2 | 4 |
| **6 · Exportação, Fila, Relatos, Sobre** | Mesa de prontidão e lote, painel da Fila de Jobs, Relatos (ADR-0006), Sobre e atualizações | `telas/F-exportacao-fila-relatos.md`, F1–F4 | 4 |
| **7 · Troca** | `tauri.conf.json` aponta para `front-v2/`; E2E Tauri (`scripts/e2e-tauri.mjs`) migrado para as telas v2; fechamento da janela com `app-close-requested` (#291); remoção do front v1 (`src/`, `design-system/`) **só com ok do dev** | `01-arquitetura.md` §5 | 1–6 e #289–#291 |

Regras de toda onda:
- Cada tela entra com: teste de componente para cada um dos 6 estados (§6) que ela tem, teste de cada ação (comando chamado com os argumentos certos, resposta aplicada), teste de teclado dos atalhos que ela registra, e um fluxo Playwright contra o mock em 1366×768 (`front-v2/e2e/<tela>.spec.ts`).
- Lacuna do mock TS (`02-consolidacao.md` seção "Lacunas do mock TS"): o ticket que precisa estende `src/lib/core.ts`/mocks no mesmo PR, com teste.
- Ação que depende de ticket de núcleo aberto fica desabilitada com tooltip que cita o ticket (ex.: "Converter em Vídeo transformado", #292).
- Ao fim de cada onda: rodar `bunx impeccable detect --json front-v2/src` (skill impeccable) e corrigir achados; screenshots 1366 e 1440 anexados ao PR.

---

## Onda 0 · Fundação

**Estrutura de arquivos** (tudo novo, em `front-v2/`):

```
front-v2/
  package.json, tsconfig.json, vite.config.ts, index.html, playwright.config.ts
  src/main.tsx                  monta <App/>
  src/App.tsx                   provedores + roteador + shell
  src/test/setup.ts             Testing Library + jest-dom
  src/core/cliente.ts           chamar<T>() tipado, ErroCore
  src/core/erros.ts             mapeador CoreError.code → mensagem + ação
  src/core/progresso.ts         listener único core-progress + store da Fila
  src/rotas/rotas.ts            parse do hash + guardas (puro)
  src/rotas/useRota.ts          hook sobre hashchange
  src/preferencias/preferencias.ts  store local (localStorage) atrás de interface
  src/comandos/atalhos.ts       registro de comandos e atalhos (puro + hook)
  src/shell/Shell.tsx           <Tela> do DS ligado a rota, Projeto, Fila, Paleta
  src/shell/EstadoForcado.tsx   ?estado= para QA
  e2e/shell.spec.ts
```

### Tarefa 1: Projeto `front-v2/` com Vitest e Playwright rodando

**Files:**
- Create: `front-v2/package.json`, `front-v2/tsconfig.json`, `front-v2/vite.config.ts`, `front-v2/index.html`, `front-v2/playwright.config.ts`, `front-v2/src/main.tsx`, `front-v2/src/App.tsx`, `front-v2/src/test/setup.ts`, `front-v2/.gitignore`
- Test: `front-v2/src/App.test.tsx`, `front-v2/e2e/abre.spec.ts`
- Modify: `.github/workflows/ci.yml` (job `check`: depois de `bun run test:ui`, `cd front-v2 && bun install --frozen-lockfile && bun run typecheck && bun run test && bunx playwright test`)

**Interfaces:**
- Produces: aliases `~` → `front-v2/src` (o código do v2 usa só `~`), `@ds` → `design-system-v2/src/index.ts`, `@core` → `src/lib/core.ts`; scripts `dev` (porta 1430, `VITE_CORE_MOCK=1`), `test` (`vitest run`), `typecheck`, `build`, `e2e` (`playwright test`).
- Atenção: `design-system-v2/src` e o `src/` do v1 usam, cada um, `@/` para a própria pasta. No Vite/Vitest, um plugin `aliasPorPacote` em `vite.config.ts` resolve `@/x` pela pasta do arquivo que importa (dentro de `design-system-v2/` → `design-system-v2/src/x`; dentro de `src/` do v1 → `src/x`). No `tsconfig.json`, `"@/*": ["../design-system-v2/src/*", "../src/*"]` (o TS tenta na ordem). Teste: `App.test.tsx` também importa `chamar` de `~/core/cliente` na Tarefa 2 e precisa resolver o `@/features/export/mock` do `core.ts`.

- [ ] **Step 1: Teste de componente falhando** — `App.test.tsx`: `render(<App/>)` mostra o texto "Clipes" (`screen.getByText('Clipes')`).
- [ ] **Step 2:** `bun run test` → FAIL (`App` não existe).
- [ ] **Step 3:** `package.json` com as mesmas versões da raiz/`design-system-v2` (react 19, tailwind 4.3.5, `@base-ui/react` 1.9.0, `lucide-react` 1.72.0, `@tauri-apps/api`) + devDeps `vitest`, `@testing-library/react`, `@testing-library/jest-dom`, `@testing-library/user-event`, `jsdom`, `@playwright/test` 1.65.0; `vite.config.ts` com `test: { environment: 'jsdom', setupFiles: ['src/test/setup.ts'] }`; `App.tsx` renderiza `<Tela titulo="Clipes" ...>` do `@ds`; `main.tsx` importa `@ds/estilos.css` (ou o CSS de tokens que o DS exporta) e monta.
- [ ] **Step 4:** `bun run test` → PASS; `bun run typecheck` → sem erros; `bun run build` → sem erros (prova que os dois `@/` resolvem).
- [ ] **Step 5: E2E falhando, depois passando** — `e2e/abre.spec.ts`: viewport 1366×768, `page.goto('/')`, espera `getByText('Clipes')` e nenhum `pageerror`. `playwright.config.ts` sobe `bun run dev` como `webServer`. `bunx playwright test` → PASS.
- [ ] **Step 6:** Commit `feat(front-v2): projeto com Vitest e Playwright`.

### Tarefa 2: Cliente do núcleo e mapeador de erros

**Files:**
- Create: `front-v2/src/core/cliente.ts`, `front-v2/src/core/erros.ts`
- Test: `front-v2/src/core/cliente.test.ts`, `front-v2/src/core/erros.test.ts`

**Interfaces:**
- Consumes: `coreDispatch<T>(name: string, args: object): Promise<T>` de `@core`.
- Produces:
  - `class ErroCore extends Error { code: string; detalhe: string }`
  - `chamar<T>(comando: string, args?: object): Promise<T>` — rejeita sempre com `ErroCore` (normaliza objeto `{code,message}`, string, `Error` e `undefined`; sem `code` → `code: 'desconhecido'`).
  - `type Recuperacao = { rotulo: string; rota?: string; acao?: 'abrir-fila' | 'confirmar' | 'refazer-outro-perfil' | 'ajustar-orcamento' | 'instalar-componente' | 'relocalizar-fonte' | 'aceitar-termos' | 'recarregar' }`
  - `mensagemDeErro(e: ErroCore): { titulo: string; recuperacao?: Recuperacao }`

- [ ] **Step 1: Testes falhando** — `cliente.test.ts` (mock de `@core` com `vi.mock`): resposta repassada; `{code:'project_busy',message:'x'}` vira `ErroCore` com `code === 'project_busy'` e `detalhe === 'x'`; `'boom'` e `undefined` viram `code === 'desconhecido'`. `erros.test.ts`: tabela-teste com uma linha por grupo da §6, valores exatos da spec, por exemplo:
  - `project_not_open` → `{ titulo: 'Nenhum Projeto está aberto no momento.', recuperacao: { rotulo: 'Ir para Início', rota: '#/inicio' } }`
  - `budget_cost` → `titulo: 'O orçamento configurado pausou a fila antes de exceder o limite.'`, `recuperacao.acao === 'ajustar-orcamento'`
  - `source_changed` → `recuperacao.acao === 'relocalizar-fonte'`
  - `desconhecido` → `titulo: 'Algo deu errado nesta operação.'`, sem `recuperacao` (o "Ver detalhe técnico" mostra `detalhe`).
- [ ] **Step 2:** `bun run test src/core` → FAIL.
- [ ] **Step 3:** Implementar. `erros.ts` é uma tabela `Record<string, {titulo, recuperacao?}>` com TODAS as linhas da tabela da §6 de `01-arquitetura.md` (códigos agrupados apontam para a mesma entrada).
- [ ] **Step 4:** `bun run test src/core` → PASS.
- [ ] **Step 5:** Commit `feat(front-v2): cliente do núcleo e mapeador de erros`.

### Tarefa 3: Listener único de `core-progress` e store da Fila

**Files:**
- Create: `front-v2/src/core/progresso.ts`
- Test: `front-v2/src/core/progresso.test.ts`

**Interfaces:**
- Produces:
  - `type EventoProgresso = { job: string; project?: string; stage: string; percentage: number; message: string; error: { code: string; message: string } | null }` (igual ao `ProgressEvent` de `core/src/lib.rs:13`)
  - `type EstadoJob = 'rodando' | 'concluido' | 'falhou' | 'pausado' | 'incerto'`
  - `type Job = { id: string; etapa: string; percentual: number; mensagem: string; estado: EstadoJob; erro?: { code: string; message: string }; inicioMs: number; etaMs?: number }`
  - `criarFila(projetoAtual: () => string | null, agora?: () => number): { aplicar(e: EventoProgresso): void; jobs(): Job[]; assinar(fn: () => void): () => void }`
  - `useFila(): Job[]` e `iniciarProgresso(fila): Promise<() => void>` (um único `listen('core-progress')`; fora do Tauri, no-op).

- [ ] **Step 1: Testes falhando:**
  - evento novo cria job `rodando`; `percentage: 100` sem erro → `concluido`; `error` presente → `falhou` com `erro`; `error.code === 'timeout_uncertain'` → `incerto`; códigos `budget_*`/`time_budget_exhausted` → `pausado`.
  - percentual não regride: 40 depois de 60 mantém 60.
  - evento com `project` diferente de `projetoAtual()` é ignorado; `job === '0'` é ignorado (#293).
  - ETA: só aparece quando o job foi visto desde 0% nesta sessão e a etapa não começa com `ai:`; com `agora` controlado, 0% em t=0 e 50% em t=10 000 → `etaMs === 10 000`.
  - `assinar` notifica a cada `aplicar`.
- [ ] **Step 2:** `bun run test src/core/progresso` → FAIL.
- [ ] **Step 3:** Implementar (store em memória; `useFila` com `useSyncExternalStore`).
- [ ] **Step 4:** PASS.
- [ ] **Step 5:** Commit `feat(front-v2): fila de jobs sobre core-progress`.

### Tarefa 4: Rotas e guardas

**Files:**
- Create: `front-v2/src/rotas/rotas.ts`, `front-v2/src/rotas/useRota.ts`
- Test: `front-v2/src/rotas/rotas.test.ts`

**Interfaces:**
- Produces:
  - `type Rota = { tela: 'inicio' } | { tela: 'assistente'; passo: 1 | 2 } | { tela: 'fontes'; projeto: string; sub: 'fontes' | 'lotes' } | { tela: 'fonte'; projeto: string; fonte: string } | { tela: 'cortes'; projeto: string; fonte?: string; run?: string; rev?: number } | { tela: 'revisao'; projeto: string; run: string; rev?: number; corte?: string } | { tela: 'corte'; projeto: string; corte: string; aba: 'editar' | 'transformar' | 'empacotar'; run?: string } | { tela: 'exportacao'; projeto: string; sub: 'prontidao' | 'lotes' } | { tela: 'config'; secao: 'provedores' | 'custos' | 'componentes' | 'exportacao' | 'aparencia' | 'projeto' } | { tela: 'relatos' } | { tela: 'sobre' }`
  - `type Contexto = { projetoAberto: string | null; corteTipo?: (corte: string) => 'direto' | 'transformado' | 'avulso' }`
  - `resolver(hash: string, ctx: Contexto): { rota: Rota } | { redirecionar: string; aviso?: string }`
  - `useRota(ctx: Contexto): Rota` (aplica `redirecionar` com `location.replace`).

- [ ] **Step 1: Testes falhando** (valores da tabela §3):
  - `''` e `'#/'` → `#/inicio`; `'#/xyz'` → `#/inicio`.
  - `'#/projeto/canal/cortes'` sem Projeto aberto → `{ redirecionar: '#/inicio' }`; Projeto aberto `'outro'` → também `#/inicio` (não abre outro Projeto pela URL).
  - `'#/projeto/canal/fontes'` → `sub: 'fontes'`; `'?sub=lotes'` → `sub: 'lotes'`.
  - `'#/projeto/canal/exportacao/lotes'` → `{ redirecionar: '#/projeto/canal/exportacao?sub=lotes' }`.
  - `'#/projeto/canal/corte/12/transformar'` com `corteTipo('12') === 'direto'` → redireciona para `.../corte/12/editar` com `aviso: 'Transformar está disponível apenas para Vídeo transformado'`; `'avulso-3-10-20'` em `empacotar` → `.../editar`.
  - `'#/config/projeto'` sem Projeto → `#/config/provedores`; `'#/config/custos'` sem Projeto → rota normal.
  - nenhum redirecionamento aponta para um hash que redireciona de novo (teste de propriedade sobre todos os casos acima).
- [ ] **Step 2:** FAIL. **Step 3:** Implementar `resolver` puro. **Step 4:** PASS.
- [ ] **Step 5:** Commit `feat(front-v2): rotas com guardas`.

### Tarefa 5: Preferências locais

**Files:**
- Create: `front-v2/src/preferencias/preferencias.ts`
- Test: `front-v2/src/preferencias/preferencias.test.ts`

**Interfaces:**
- Produces:
  - `type Preferencias = { tema: 'escuro' | 'claro' | 'sistema'; escala: 100 | 115; altoContraste: boolean; idioma: 'pt' | 'en'; teclasUnicas: boolean; atalhos: Record<string, string> }`
  - `PADRAO: Preferencias = { tema: 'escuro', escala: 100, altoContraste: false, idioma: 'pt', teclasUnicas: true, atalhos: {} }`
  - `criarPreferencias(armazenamento?: Pick<Storage, 'getItem' | 'setItem'>): { ler(): Preferencias; mudar(p: Partial<Preferencias>): void; assinar(fn): () => void }` (chave `clipes.preferencias.v1`)
  - `usePreferencias(): [Preferencias, (p: Partial<Preferencias>) => void]`

- [ ] **Step 1: Testes falhando:** sem nada salvo → `PADRAO`; `mudar({ tema: 'claro' })` persiste e `ler()` devolve; JSON inválido salvo → `PADRAO`; `getItem` lançando → `PADRAO` e `mudar` não lança; campo desconhecido salvo é ignorado.
- [ ] **Step 2:** FAIL. **Step 3:** Implementar. **Step 4:** PASS.
- [ ] **Step 5:** Commit `feat(front-v2): preferências locais`.

### Tarefa 6: Comandos, atalhos e paleta

**Files:**
- Create: `front-v2/src/comandos/atalhos.ts`
- Test: `front-v2/src/comandos/atalhos.test.ts`

**Interfaces:**
- Consumes: `Comando` e `<Paleta>` de `@ds`; `usePreferencias` (Tarefa 5).
- Produces:
  - `type Atalho = { id: string; titulo: string; grupo: string; tecla?: string; teclaUnica?: boolean; executar(): void }` (`tecla` no formato `'Mod+K'`, `'Alt+PageDown'`, `'A'`; `Mod` = Ctrl no Windows/Linux, Cmd no macOS)
  - `criarRegistro(): { registrar(a: Atalho[]): () => void; lista(): Atalho[]; tratar(e: KeyboardEvent, opcoes: { teclasUnicas: boolean }): boolean }`
  - `useAtalhos(a: Atalho[]): void` (registra enquanto a tela está montada); `ProvedorAtalhos` (um `keydown` global + `<Paleta>` em `Mod+K`).

- [ ] **Step 1: Testes falhando:** `Ctrl+K` dispara o comando da paleta; tecla única `A` dispara com `teclasUnicas: true` e NÃO dispara com `false`; tecla única NÃO dispara com `e.target` sendo `input`, `textarea` ou `[contenteditable]`; atalho com `Mod` dispara mesmo em campo de texto; desmontar a tela remove seus atalhos; o atalho registrado por último vence em conflito (tela por cima do shell).
- [ ] **Step 2:** FAIL. **Step 3:** Implementar. **Step 4:** PASS.
- [ ] **Step 5:** Commit `feat(front-v2): comandos, atalhos e paleta`.

### Tarefa 7: Shell e estados forçados

**Files:**
- Create: `front-v2/src/shell/Shell.tsx`, `front-v2/src/shell/EstadoForcado.tsx`
- Modify: `front-v2/src/App.tsx`
- Test: `front-v2/src/shell/Shell.test.tsx`, `front-v2/e2e/shell.spec.ts`

**Interfaces:**
- Consumes: Tarefas 2–6; `Tela`, `EstadoTela`, `Esqueleto`, `BannerErroCore` de `@ds`.
- Produces:
  - `<Shell>{children}</Shell>`: `<Tela>` com Projeto (`projects.current`), etapa a partir da `Rota`, contador da Fila (`useFila`), gatilho da Paleta, selo Somente local (`projects.local_only.get`); sem Projeto → `mostrarEtapas={false}`; rota `assistente` → `modoMinimo`.
  - `estadoForcado(search: string): 'vazio' | 'erro' | 'carregando' | 'parcial' | 'offline' | 'erro-flush' | 'fallback' | null` e `<ComEstado estado={...} carregando={...} vazio={...} erro={...}>` usado por toda tela.

- [ ] **Step 1: Testes falhando** (`chamar` mockado): sem Projeto → não há navegação de etapas; com Projeto `{name:'Canal de Cortes'}` → mostra "Canal de Cortes" e as 3 etapas, com a etapa da rota marcada `aria-current="page"`; 2 jobs `rodando` → gatilho da Fila mostra "2"; `estadoForcado('?estado=vazio')` → `'vazio'`; `'?estado=qualquer'` → `null`; `<ComEstado>` em `erro` mostra `role="alert"` com o `titulo` do mapeador.
- [ ] **Step 2:** FAIL. **Step 3:** Implementar e ligar em `App.tsx` (rota → placeholder por tela com `EstadoTela tipo="vazio"` até a onda dela). **Step 4:** PASS.
- [ ] **Step 5: E2E** `e2e/shell.spec.ts` (mock, 1366×768): abre em `#/inicio`; `Ctrl+K` abre a paleta e `Esc` fecha; `#/projeto/x/cortes` sem Projeto volta para `#/inicio`; nenhum `pageerror`; screenshot em 1366 e 1440 salvo em `test-results/`. `bunx playwright test` → PASS.
- [ ] **Step 6:** Commit `feat(front-v2): shell com estados e paleta`.

### Tarefa 8: Fechamento da Onda 0

- [ ] **Step 1:** `bun run typecheck && bun run test && bunx playwright test` em `front-v2/` → tudo verde; CI do PR verde (o `testEditorDucking` do v1 é instável no Windows: rerun antes de concluir que quebrou).
- [ ] **Step 2:** `impeccable detect --json front-v2/src` → sem achados (ou corrigidos).
- [ ] **Step 3:** `front-v2/README.md` curto: como rodar (`bun run dev` → `http://127.0.0.1:1430`), testes, onde ficam as telas.
- [ ] **Step 4:** PR "feat(front-v2): fundação (onda 0)" ligado a #288, com screenshots; merge só com CI verde e ok do dev.
