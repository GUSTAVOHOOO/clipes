# Linha de base UI e Avaliação Impeccable — Ondas 0 + 1 (`front-v2`)

> ⚠️ **DEGRADED: single-context (subagentes desabilitados pela regra da tarefa; avaliação conduzida em contexto único combinando inspeção visual das capturas renderizadas, auditoria automatizada de DOM/WCAG e análise de código).**
>
> **Data da avaliação:** 2026-11-18  
> **Commit avaliado (`origin/master`):** `a67cc53` (`feat(front-v2): Configurações — Componentes (#/config/componentes) e Exportação (#/config/exportacao) (#362)`)  
> **Escopo:** Onda 0 (Shell Global) e Onda 1 (`#/inicio`, `#/assistente`, `<InstaladorJustInTime>`, `#/config/provedores`, `#/config/custos`, `#/config/componentes`, `#/config/exportacao`, `#/config/aparencia`, `#/config/projeto`). Papel exclusivamente avaliador — nenhuma tela foi alterada neste PR.

---

## 1. Cenário fixo e reproduzível

Este cenário foi executado sobre o mock TypeScript (`VITE_CORE_MOCK=1`, sem Tauri) e pode ser repetido integralmente pelo revisor independente.

### Pré-requisitos e comandos

```powershell
# 1. Instalar dependências e subir o app mockado (porta 1430)
cd front-v2
bun install
bun run dev

# 2. Executar o script Playwright da linha de base (gera as 20 PNGs e o JSON de auditoria DOM)
$env:UI_BASELINE = "1"
bunx playwright test e2e/ui-baseline.spec.ts
Remove-Item Env:UI_BASELINE

# 3. Verificações estáticas e de contraste
cd ..
bunx impeccable detect --json front-v2/src
cd design-system-v2
bun scripts/contraste.ts
```

No Linux/macOS (bash/zsh), substitua a etapa 2 por `UI_BASELINE=1 bunx playwright test e2e/ui-baseline.spec.ts`.

### Parâmetros do cenário

- **Viewports:** `1366×768` (notebook alvo) e `1440×900`.
- **Temas e contraste:** tema escuro padrão (`:root` / `[data-tema="escuro"]`), `[data-contrast="high"]` (via toggle em `#/config/aparencia`) e conferência de contraste de texto em `[data-tema="claro"]` após transição CSS (`300 ms`).
- **Estados forçados (`?estado=`):** `carregando`, `vazio`, `erro` em `#/inicio`, além dos estados carregados, vazios e parciais nativos do mock (`?assistant-test=1` e `?source-test=1`).
- **Checagem Axe:** `@axe-core/playwright` **não** consta em `front-v2/package.json` (nenhuma dependência foi adicionada). A auditoria A11y AA foi feita via inspeção manual de teclado (`Tab`, `Esc`, `Ctrl+K`, `F6`, `Ctrl+J`, setas em `radiogroup`/`TabelaGrade`) combinada com medição programática em `front-v2/e2e/ui-baseline.spec.ts` (contraste computado `color` vs fundo efetivo, dimensões `getBoundingClientRect` de alvos interativos, nomes acessíveis, hierarquia `h1–h6`, overflow `scrollWidth`/`scrollHeight` e vocabulário do `GLOSSARY.md`).

### Saídas automatizadas observadas

- `bunx impeccable detect --json front-v2/src`: `[]` (exit code `0`, zero achados no detector mecânico).
- `cd design-system-v2 && bun scripts/contraste.ts`: `Todos os pares passam.` (escuro, claro, escuro alto contraste, claro alto contraste).
- `cd front-v2 && bun run typecheck && bun run test`: `tsc --noEmit` limpo; `24 passed (24)`, `202 passed (202)`.
- `cd front-v2 && bunx playwright test` (CI padrão): `12 passed` (`e2e/ui-baseline.spec.ts` ignorado por `test.skip(!process.env.UI_BASELINE)`).
- `UI_BASELINE=1 bunx playwright test e2e/ui-baseline.spec.ts`: `1 passed`, `0` `pageerror`, `0` ocorrências de overflow horizontal ou vertical externo em `1366×768` e `1440×900`.

---

## 2. Tabela de pontuação por fluxo (Critique — Nielsen 0–4)

Meta do mandato: **≥ 90%** da pontuação aplicável (`36/40`).  
Legenda de heurísticas (0–4): **H1** Visibilidade de estado · **H2** Mundo real / vocabulário · **H3** Controle e liberdade · **H4** Consistência e padrões · **H5** Prevenção de erros · **H6** Reconhecimento vs. lembrança · **H7** Flexibilidade e atalhos · **H8** Estética e minimalismo · **H9** Recuperação de erros · **H10** Ajuda e documentação.

| Fluxo / Superfície | H1 | H2 | H3 | H4 | H5 | H6 | H7 | H8 | H9 | H10 | Pontuação | % Aplicável | Meta ≥ 90% |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| **Onda 0 · Shell Global** | 3 | 4 | 1 | 3 | 3 | 2 | 2 | 4 | 3 | 2 | **27 / 40** | **67,5%** | Abaixo |
| **Fluxo (a) · Início e Projetos (`#/inicio`)** | 4 | 4 | 4 | 3 | 4 | 4 | 4 | 3 | 3 | 3 | **36 / 40** | **90,0%** | Atinge |
| **Fluxo (b) · Assistente (`#/assistente`) + JIT** | 3 | 3 | 3 | 2 | 2 | 3 | 3 | 3 | 3 | 3 | **28 / 40** | **70,0%** | Abaixo |
| **Fluxo (c) · Provedores e Custos (`#/config/provedores`, `custos`)** | 4 | 3 | 3 | 2 | 2 | 4 | 4 | 3 | 4 | 3 | **32 / 40** | **80,0%** | Abaixo |
| **Fluxo (d) · Componentes, Exportação, Aparência e Projeto** | 4 | 2 | 4 | 3 | 4 | 4 | 4 | 4 | 3 | 3 | **35 / 40** | **87,5%** | Abaixo |

### Síntese do Critique por fluxo

- **Onda 0 · Shell Global (27/40 — 67,5%):** A moldura de `40 px` + `28 px` é limpa e sem scroll externo, e a Paleta `Ctrl+K` funciona de qualquer campo restaurando o foco com `Esc`. Cai drasticamente em **H3/H6/H7** porque o `SeletorProjeto` (`design-system-v2/src/componentes/Tela.tsx`) renderiza os itens `"Trocar Projeto…"`, `"Configurações do Projeto"` e `"Fechar Projeto"` sem `aoSelecionar` (clicar neles não faz nada — verificado em `03-shell-projeto-aberto-1366.png`), a Barra Superior não expõe acesso a Configurações (`Ctrl+,`), Relatos ou Sobre, e os atalhos globais `F6`, `Ctrl+J` e `?` listados no mapa oficial não estão conectados em `Shell.tsx`.
- **Fluxo (a) · Projetos (36/40 — 90,0%):** Fluxo mais sólido desta linha de base. Estados `carregando`, `vazio`, `erro` (`newer_project`, `project_busy`), criação e abertura de pasta `.clipes` V1 funcionam com atalhos `Ctrl+N`/`Ctrl+O` e validação inline. Perde pontos apenas pela fusão de fundo `bg-elevado` dos campos dentro de `DialogoNovoProjeto` (`06-inicio-novo-projeto-1366.png`) e pelo alvo `<summary>` de `17,4 px` em `BannerErroCore`.
- **Fluxo (b) · Assistente + Instalador JIT (28/40 — 70,0%):** O Passo 1 traduz hardware em linguagem humana mantendo `int8_float16`/`handshake` dentro de `<details>`, e o Passo 2 destaca `Local · US$ 0,00 · não sai do computador` e `Experimental`. Cai em **H4/H5** porque: (1) os inputs de `Chave de API` somem sobre o card selecionado `bg-elevado` (`08-assistente-passo2-api-1366.png`), (2) `cliConsentido` inicia pré-marcado como `true` para os 3 CLIs, (3) o retorno `?retorno=config` se perde ao reabrir por `#/config/provedores`, (4) os 4 `role="radio"` têm `22,8 px` e `"Mudar pasta de instalação"` tem `17,4 px`, e (5) `<InstaladorJustInTime>` ainda não está montado em nenhuma rota navegável (coberto apenas em teste unitário).
- **Fluxo (c) · Provedores e Custos (32/40 — 80,0%):** A tela de Custos/Orçamentos/Auditoria é exemplar em transparência (`ResumoCustoPrivacidade`, falhas cobradas somadas no total, pausa `cost_unknown` com confirmação e auditoria SHA-256 sem texto). O fluxo perde pontos por: (1) botão `"Testar"` nos cards CLI de `#/config/provedores` disparar `provider.test` sem exigir confirmação prévia quando em `"Aguarda confirmação"`, (2) campos invisíveis (`bg-elevado` sobre `bg-elevado`) no modal `FormPerfilProvedor`, nos cards CLI e no formulário de sobrescrita de preços (`09`, `10`, `13`, `20`), e (3) exposição de `(#305)` no texto visível e `"preset"` em `"Modelo rápido (preset)"`.
- **Fluxo (d) · Componentes, Exportação, Aparência e Projeto (35/40 — 87,5%):** `ConfigExportacao` e `ConfigComponentes` entregam revelação progressiva, aviso VAD `#279` e isolamento de `core-progress` por job; `ConfigAparencia` implementa WCAG 2.1.4 com detecção de conflito e escala `115%` sem overflow. Fica a 1 ponto dos 90% por usar `"Preset de legenda"` em `ConfigProjeto.tsx` (`19-config-projeto-1366.png`), expor `(#307)` e `"Instalado (test)"` em `ConfigComponentes.tsx`, e não adicionar contorno nos controles em `[data-contrast="high"]`.

### Auditoria Técnica (Impeccable Audit — `/20`)

| Dimensão | Pontuação | Achado principal |
|---|---|---|
| 1. Accessibility | **2 / 4** | Contraste de texto passa em todos os temas, mas há alvos `< 24 px` (`22,8 px` e `17,4 px`), falta `<h1>` em Assistente/Placeholder, `F6`/`Ctrl+J` sem binding e controles sem borda em `[data-contrast="high"]`. |
| 2. Performance | **4 / 4** | Carregamento paralelo sem layout thrashing, animações curtas com `prefers-reduced-motion`. |
| 3. Theming | **2 / 4** | Fusão de superfície 1:1 (`bg-elevado` sobre `bg-elevado`) em campos dentro de diálogos e cards selecionados; bordas ausentes no modo alto contraste. |
| 4. Responsive Design | **4 / 4** | Zero overflow externo em `1366×768` e `1440×900`, inclusive com `[data-escala="115"]`. |
| 5. Implementation Integrity | **3 / 4** | `impeccable detect` limpo (`[]`), boa disciplina de tokens `DESIGN.md`, com lacunas funcionais no `SeletorProjeto`, consentimento CLI e termos do glossário. |
| **Total** | **15 / 20** | **Good** (corrigir lacunas de A11y, theming e bloqueadores antes da Onda 7) |

---

## 3. Tabela de achados

Categorias: **bloqueador funcional** · **A11y AA** · **visual** · **texto**.

| ID | Sev. | Categoria | Tela / Arquivo | Passo para reproduzir | Captura | Sugestão de correção |
|---|---|---|---|---|---|---|
| **UI-01** | **P0** | bloqueador funcional | Shell Global (`design-system-v2/src/componentes/Tela.tsx` L81–103; `front-v2/src/shell/Shell.tsx` L320) | Abrir/criar Projeto → clicar no nome do Projeto na Barra Superior (`Canal Baseline v`) → clicar em `Fechar Projeto`, `Trocar Projeto…` ou `Configurações do Projeto`. Nada acontece (`url` permanece a mesma). | [03-shell-projeto-aberto-1366.png](./capturas/ondas-0-1/03-shell-projeto-aberto-1366.png) | Expor props `aoTrocar`, `aoConfigurar`, `aoFechar` e lista clicável em `SeletorProjeto` e ligá-las em `Shell.tsx` a `projects.close` / navegação. |
| **UI-02** | **P1** | bloqueador funcional | `#/config/provedores` (`front-v2/src/telas/config/ConfigProvedores.tsx` L912–925) | Em `Assinaturas via CLI`, com CLI em status `Aguarda confirmação`, clicar em `Testar`. O app chama `provider.test` sem abrir `<ConfirmDialog>` de consentimento. | [09-config-provedores-1366.png](./capturas/ondas-0-1/09-config-provedores-1366.png) | Verificar `!confirmado` no clique de `Testar` e abrir `setConfirmarCli({ kind })` antes de executar `provider.test`. |
| **UI-03** | **P1** | bloqueador funcional | `#/assistente?passo=2` (`front-v2/src/telas/assistente/PassoProvedor.tsx` L113–117) | Abrir `#/assistente?passo=2` com CLI detectado (`Codex CLI`/`OpenCode CLI`) e selecioná-la: o checkbox de consentimento (`cliConsentido`) já vem marcado como `true`. | [08-assistente-passo2-api-1366.png](./capturas/ondas-0-1/08-assistente-passo2-api-1366.png) | Inicializar `cliConsentido` como `{}` (`false` por padrão) e exigir marcação explícita antes de habilitar `Concluir configuração`. |
| **UI-04** | **P1** | bloqueador funcional | Shell Global (`front-v2/src/shell/Shell.tsx` L230–347; `Tela.tsx` L46–55) | Em `#/inicio`, verificar Barra Superior sem botão `Configurações` e sem menu `Mais` (`Relatos`/`Sobre`), pressionar `F6` (foco não cicla regiões) e `Ctrl+J` (nenhuma gaveta/aviso abre), e notar que `Somente local` não é clicável. | [01-shell-inicio-1366.png](./capturas/ondas-0-1/01-shell-inicio-1366.png) | Preencher slot `direita` de `<Tela>` com `BotaoIcone` de Configurações + menu `Mais`, registrar `F6`, `Ctrl+J` e `?` no `Shell`, e tornar `Somente local` botão/link. |
| **UI-05** | **P2** | bloqueador funcional | `#/config/provedores` → `#/assistente` (`ConfigProvedores.tsx` L1060–1062; `Assistente.tsx` L12–28) | Em `#/config/provedores`, clicar em `Reabrir assistente inicial` → clicar em `Pular por enquanto` ou concluir. Navega para `#/inicio` em vez de voltar a `#/config/provedores`. | [09-config-provedores-1366.png](./capturas/ondas-0-1/09-config-provedores-1366.png) | Navegar para `#/assistente?passo=1&retorno=config` e preservar o query param `retorno=config` ao trocar entre passos 1 e 2. |
| **UI-06** | **P2** | bloqueador funcional | `<InstaladorJustInTime>` (`front-v2/src/componentes/InstaladorJustInTime.tsx`) | Percorrer todas as rotas de Onda 0+1: nenhum ponto de entrada na UI montada instancia `<InstaladorJustInTime>` (testado apenas em Vitest até a chegada das Ondas 2, 4 e 5). | — *(cobertura unitária)* | Manter validação E2E dedicada quando as rotas de Fontes URL (Onda 2), YuNet (Onda 4) e Narração TTS (Onda 5) forem conectadas. |
| **UI-07** | **P1** | visual | `design-system-v2/src/primitivas/Campos.tsx` (`caixaCampo` L10–13) em `PassoProvedor`, `ConfigProvedores`, `FormPerfilProvedor`, `ConfigCustos`, `DialogoNovoProjeto` | Abrir `Novo Perfil de Provedor`, selecionar `Chave de API` no Assistente Passo 2, ver campos dos cards CLI ou o formulário inferior de sobrescrita em `Preços`: campos `bg-elevado` sobre fundo `bg-elevado` somem completamente (contraste de borda 1,00:1). | [08-assistente-passo2-api-1366.png](./capturas/ondas-0-1/08-assistente-passo2-api-1366.png), [10-config-provedores-modal-1366.png](./capturas/ondas-0-1/10-config-provedores-modal-1366.png), [13-config-custos-precos-1366.png](./capturas/ondas-0-1/13-config-custos-precos-1366.png) | Dar aos campos contraste de superfície ou contorno sutil (`shadow-[inset_0_0_0_1px_var(--linha)]`) e/ou usar `bg-chao` quando montados dentro de `bg-elevado`. |
| **UI-08** | **P1** | A11y AA | `#/assistente?passo=1,2`, `BannerErroCore`, `ConfigComponentes` (`PassoProvedor.tsx` L390–419, `PassoEssencial.tsx` L500, `Estados.tsx` L161) | Medir altura de alvos interativos em `1366×768`: os 4 `role="radio"` no Passo 2 têm `22,8 px`, o botão `Mudar pasta de instalação` tem `17,4 px` e todos os `<summary>` têm `17,4 px` (abaixo do mínimo de `24 px` da WCAG 2.5.8). | [07-assistente-passo1-1366.png](./capturas/ondas-0-1/07-assistente-passo1-1366.png), [08-assistente-passo2-api-1366.png](./capturas/ondas-0-1/08-assistente-passo2-api-1366.png), [05-inicio-erro-1366.png](./capturas/ondas-0-1/05-inicio-erro-1366.png) | Aplicar `min-h-6` (24 px) aos `role="radio"`, ao botão `Mudar pasta de instalação` e aos elementos `<summary>` clicáveis. |
| **UI-09** | **P1** | A11y AA | `design-system-v2/src/tokens/tokens.css` (L67–86) e primitivas `@ds` | Ligar `Modo Alto Contraste` (`[data-contrast="high"]`) em `#/config/aparencia` e inspecionar controles (`Botao`, `Segmentado`, `Select`, `Entrada`): apenas texto, `Switch` e `Checkbox` ganham destaque; botões secundários e campos continuam sem contorno (`border-0`). | [18-config-aparencia-hc-1366.png](./capturas/ondas-0-1/18-config-aparencia-hc-1366.png), [20-config-provedores-hc-1440.png](./capturas/ondas-0-1/20-config-provedores-hc-1440.png) | Sob `[data-contrast="high"]`, aplicar borda interna `1px solid var(--linha-forte)` em `Botao` secundário/suave, `Segmentado`, `Entrada`, `Select` e cards `bg-elevado`. |
| **UI-10** | **P2** | A11y AA | `#/assistente`, `PlaceholderTela`, `#/config/exportacao` (`PassoEssencial.tsx`, `PassoProvedor.tsx`, `ConfigExportacao.tsx` L281, L317) | Inspecionar árvore de headings (`h1–h6`) em `#/assistente?passo=1` e `#/projeto/.../fontes`: não há `<h1>` (apenas `<h2>`); em `#/config/exportacao`, títulos de bloco usam `<strong>` em vez de `<h2>`. | [07-assistente-passo1-1366.png](./capturas/ondas-0-1/07-assistente-passo1-1366.png), [16-config-exportacao-detectado-1366.png](./capturas/ondas-0-1/16-config-exportacao-detectado-1366.png) | Promover o título principal de `PassoEssencial`/`PassoProvedor` para `<h1>` e transformar `Status atual` e `Escolha de encoder` em `<h2>`. |
| **UI-11** | **P2** | texto | `#/config/projeto` (`ConfigProjeto.tsx` L736–740) e `FormPerfilProvedor.tsx` (L347) | Abrir `/?source-test=1#/config/projeto` e o modal `Novo Perfil de Provedor`: exibem `"Preset de legenda"` e `"Modelo rápido (preset)"`, contrariando o termo proibido `preset` em `GLOSSARY.md`. | [19-config-projeto-1366.png](./capturas/ondas-0-1/19-config-projeto-1366.png), [10-config-provedores-modal-1366.png](./capturas/ondas-0-1/10-config-provedores-modal-1366.png) | Substituir por `"Estilo de legenda"` / `"Estilo padrão"` em `ConfigProjeto.tsx` e `"Modelo rápido"` em `FormPerfilProvedor.tsx`. |
| **UI-12** | **P2** | texto | `#/assistente?passo=1`, `#/config/provedores`, `#/config/componentes` (`PassoEssencial.tsx` L486, `ConfigProvedores.tsx` L817/940, `ConfigComponentes.tsx` L1184) | Abrir Passo 1, `#/config/provedores` ou `#/config/componentes` → `Componentes e Modelos`: textos principais exibem `(#305)`, `(#307)` e `Instalado (test)` do mock de `yt-dlp`. | [07-assistente-passo1-1366.png](./capturas/ondas-0-1/07-assistente-passo1-1366.png), [09-config-provedores-1366.png](./capturas/ondas-0-1/09-config-provedores-1366.png), [15-config-componentes-modelos-1366.png](./capturas/ondas-0-1/15-config-componentes-modelos-1366.png) | Remover códigos `#305`/`#307` do corpo visível (manter só em tooltips técnicos ou linguagem natural) e ajustar versão mock de `yt-dlp` de `"test"` para versão realista. |
| **UI-13** | **P3** | texto | `#/config/aparencia` (`ConfigAparencia.tsx` L55–58, L394–407) | Selecionar `English` em `Idioma`: apenas `<html lang="en">` muda, sem traduzir textos nem sinalizar que o idioma EN ainda está em preparação. | [17-config-aparencia-padrao-1366.png](./capturas/ondas-0-1/17-config-aparencia-padrao-1366.png) | Desabilitar `English` no `Select` com descrição `"Em preparação"` até a entrada da tradução. |
| **UI-14** | **P3** | visual | Paleta `Ctrl+K` (`design-system-v2/src/componentes/Paleta.tsx` L44–84) | Pressionar `Ctrl+K` em `#/inicio`: lista exibe comandos e `Esc` no topo, mas omite o rodapé `"Enter para executar · Esc para fechar"` previsto na spec (`A-shell-inicio-config.md` §3.3). | [02-shell-paleta-1366.png](./capturas/ondas-0-1/02-shell-paleta-1366.png) | Adicionar rodapé discreto de 1 linha abaixo de `Command.List` na `Paleta`. |

---

## 4. Inventário das capturas PNG (`docs/produto/front-v2/ui/capturas/ondas-0-1/`)

Total: **20 arquivos** (otimizados via `ffmpeg` sem perda de legibilidade).

| Arquivo | Tela / Estado | Viewport / Tema | Sustenta |
|---|---|---|---|
| `01-shell-inicio-1366.png` | `#/inicio` padrão | `1366×768` · padrão | Shell Onda 0, Fluxo (a) e UI-04 |
| `02-shell-paleta-1366.png` | Paleta `Ctrl+K` aberta | `1366×768` · padrão | Shell Onda 0 e UI-14 |
| `03-shell-projeto-aberto-1366.png` | Shell com Projeto aberto e menu `SeletorProjeto` | `1366×768` · padrão | Shell Onda 0 e UI-01 |
| `04-inicio-vazio-1366.png` | `#/inicio?estado=vazio` | `1366×768` · padrão | Fluxo (a) estado vazio |
| `05-inicio-erro-1366.png` | `#/inicio?estado=erro` | `1366×768` · padrão | Fluxo (a) `BannerErroCore` e UI-08 |
| `06-inicio-novo-projeto-1366.png` | Diálogo `Novo Projeto` | `1366×768` · padrão | Fluxo (a) e UI-07 |
| `07-assistente-passo1-1366.png` | `#/assistente?passo=1` | `1366×768` · padrão | Fluxo (b), UI-08, UI-10, UI-12 |
| `08-assistente-passo2-api-1366.png` | `#/assistente?passo=2` (`Chave de API`) | `1366×768` · padrão | Fluxo (b), UI-03, UI-07, UI-08 |
| `09-config-provedores-1366.png` | `#/config/provedores` | `1366×768` · padrão | Fluxo (c), UI-02, UI-05, UI-07, UI-12 |
| `10-config-provedores-modal-1366.png` | Modal `Novo Perfil de Provedor` | `1366×768` · padrão | Fluxo (c), UI-07, UI-11 |
| `11-config-custos-orcamentos-1366.png` | `/?source-test=1#/config/custos` (`Orçamentos e Gastos`) | `1366×768` · padrão | Fluxo (c) |
| `12-config-custos-auditoria-1366.png` | `/?source-test=1#/config/custos` (`Auditoria`) | `1366×768` · padrão | Fluxo (c) |
| `13-config-custos-precos-1366.png` | `/?source-test=1#/config/custos` (`Preços e Estimador`) | `1366×768` · padrão | Fluxo (c) e UI-07 |
| `14-config-componentes-hardware-1366.png` | `/?source-test=1#/config/componentes` (`Hardware`) | `1366×768` · padrão | Fluxo (d) |
| `15-config-componentes-modelos-1366.png` | `/?source-test=1#/config/componentes` (`Modelos`) | `1366×768` · padrão | Fluxo (d) e UI-12 |
| `16-config-exportacao-detectado-1366.png` | `/?source-test=1#/config/exportacao` (após detectar) | `1366×768` · padrão | Fluxo (d) e UI-10 |
| `17-config-aparencia-padrao-1366.png` | `/?source-test=1#/config/aparencia` | `1366×768` · padrão | Fluxo (d) e UI-13 |
| `18-config-aparencia-hc-1366.png` | `/?source-test=1#/config/aparencia` (`[data-contrast="high"]`) | `1366×768` · alto contraste | Fluxo (d) e UI-09 |
| `19-config-projeto-1366.png` | `/?source-test=1#/config/projeto` | `1366×768` · padrão | Fluxo (d) e UI-11 |
| `20-config-provedores-hc-1440.png` | `/?source-test=1#/config/provedores` (`[data-contrast="high"]`) | `1440×900` · alto contraste | Fluxos (c)/(d), UI-07, UI-09 |
