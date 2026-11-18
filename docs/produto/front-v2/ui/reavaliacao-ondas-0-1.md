# Reavaliação Independente de UI — Ondas 0 + 1 (`front-v2`)

> ⚠️ **DEGRADED: single-context (subagentes desabilitados pela regra da tarefa; avaliação conduzida em contexto único combinando inspeção visual das capturas renderizadas, auditoria automatizada de DOM/WCAG, testes interativos de teclado/fluxo no navegador e análise de código).**
>
> **Data da reavaliação:** 2026-11-18  
> **Commit avaliado (`HEAD`):** `bac1165` (`fix(front-v2): vocabulário e textos — preset, refs de issue/mock e idioma EN (UI-11 a UI-13) (#387)`)  
> **Linha de base comparada:** `a67cc53` ([avaliacao-ondas-0-1.md](./avaliacao-ondas-0-1.md))  
> **Entregas incorporadas desde a linha de base:** correções `UI-01` a `UI-14` (`#381`/PR `#386`, `#382`/PR `#385`, `#383`/PR `#389`, `#384`/PR `#387`) e telas de Fontes (`#343`/PR `#390`).  
> **Escopo:** Onda 0 (Shell Global) e Onda 1 (`#/inicio`, `#/assistente`, `<InstaladorJustInTime>`, `#/config/provedores`, `#/config/custos`, `#/config/componentes`, `#/config/exportacao`, `#/config/aparencia`, `#/config/projeto`), considerando também os efeitos observados da integração com `#/projeto/:id/fontes`. Papel exclusivamente avaliador — nenhuma tela ou teste foi alterado neste PR.

---

## 1. Cenário reproduzido e saídas automatizadas

Foi repetido o mesmo cenário fixo da seção 1 da linha de base sobre o mock TypeScript (`VITE_CORE_MOCK=1`, sem Tauri), nos viewports `1366×768` e `1440×900`, tema padrão (`escuro`), tema `claro`, `[data-contrast="high"]` e escala `[data-escala="115"]`.

### Comandos executados e resultados observados

- `cd front-v2; bun install`: `152 packages installed` (exit `0`).
- `cd front-v2; bun run typecheck` (`tsc --noEmit`): sem erros (exit `0`).
- `cd front-v2; bun run test` (`vitest run`): **`30 passed (30)`**, **`266 passed (266)`** testes unitários/componentes.
- `cd front-v2; bunx playwright test` (suíte E2E padrão): **`19 passed`**, `1 skipped` (`e2e/ui-baseline.spec.ts` ignorado sem `UI_BASELINE=1`).
- `cd front-v2; $env:UI_BASELINE = "1"; bunx playwright test e2e/ui-baseline.spec.ts`: gerou as capturas `01` a `06` e interrompeu por timeout na L326 (detalhes em **Desvio do cenário** abaixo). As PNGs originais da linha de base foram restauradas com `git checkout -- docs/produto/front-v2/ui/capturas/ondas-0-1/`.
- `bunx impeccable detect --json front-v2/src`: **`[]`** (exit `0`, zero achados no detector mecânico).
- `cd design-system-v2; bun scripts/contraste.ts`: **`Todos os pares passam.`** (tema escuro, tema claro, escuro `[data-contrast="high"]` e claro `[data-contrast="high"]`, incluindo `contorno-controle` e `contorno-campo` de `8,37:1` a `11,97:1`).

### Desvio do cenário

- **Onde e por que `e2e/ui-baseline.spec.ts` parou:** na execução com `UI_BASELINE=1`, o teste falhou por timeout (30 s) na **linha 326** (`await page.getByRole('button', { name: 'Fechar Projeto' }).click()`). Na linha de base (`a67cc53`), clicar em `"Fechar Projeto"` no menu `SeletorProjeto` (L319) não fazia nada (`UI-01`), então o Projeto continuava aberto ao voltar para `#/inicio` (L325). Com a correção de `UI-01`, o clique na L319 passou a executar `projects.close` e redirecionar imediatamente para `#/inicio` sem Projeto aberto, tornando inexistente o botão da L326. Conforme a regra de avaliação independente, `front-v2/e2e/ui-baseline.spec.ts` não foi alterado (sua atualização fica para ticket separado).
- **O que foi rodado no lugar:** com o app mockado ativo (`cd front-v2; bun run dev`, `VITE_CORE_MOCK=1` em `http://127.0.0.1:1430`), foi executado um runner Playwright equivalente em Node (`chromium.launch()`, script descartável fora do repositório) repetindo exatamente o mesmo roteiro a partir de `#/inicio` até o fim — ajustando apenas a transição pós-`Fechar Projeto` — para gerar todas as capturas (`01` a `20`), além da captura `21` em `#/projeto/meu-canal-de-cortes/fontes` (fluxo `URL (VOD)` com `<InstaladorJustInTime>`) e das checagens interativas complementares de teclado (`F6`, `Ctrl+J`, `?`, `Ctrl+,`, `Ctrl+K`, `Ctrl+N`, `Esc`), `UI-02`, `UI-03`, `UI-05`, `PlaceholderTela` (`Cortes`, `Relatos`, `Sobre`), formulário de sobrescrita em `ConfigCustos` e escala `[data-escala="115"]`.
- **Equivalência das medições:** o runner executou exatamente a mesma função `auditarPagina` da linha de base (`front-v2/e2e/ui-baseline.spec.ts` L34–245) — contraste computado texto vs. fundo efetivo, dimensões `getBoundingClientRect` para alvos `< 24 px`, nomes acessíveis, hierarquia `h1–h6`, termos proibidos do `GLOSSARY.md` (acrescido de regex `#\d{3}` para referências de issue), `scrollWidth`/`scrollHeight` e verificação de `outline`/`box-shadow` após `Tab` — totalizando **26 auditorias de tela/estado** com **`0` `pageerror`**.

### Síntese das verificações transversais (DOM + Teclado + Glossário)

| Aspecto | Resultado observado | Evidência / Observação |
|---|---|---|
| **Teclado (Tab, Esc, `F6`, `Ctrl+J`, `Ctrl+K`, `?`, `Ctrl+,`)** | **Aprovado** nas Ondas 0+1 | `F6` cicla `conteudo → rodape → topo → conteudo`; `Ctrl+K` abre Paleta com rodapé `"Enter para executar · Esc para fechar"` e `Esc` devolve foco ao gatilho (`Abrir comandos (Ctrl+K)`); `?` e `Ctrl+/` abrem `FolhaAtalhos` e `Esc` fecha; `Ctrl+,` abre `#/config/provedores`; `Ctrl+N` foca `Nome do Projeto` no diálogo; `Ctrl+J` dispara toast de status da Fila (gaveta completa entra na Onda 6). |
| **Foco visível** | **Aprovado** | Anel `2px solid rgb(255, 90, 31)` (`--foco`) / branco em alto contraste e borda interna `foco-interno` na barra lateral e listas. |
| **Contraste WCAG 2.2 AA** | **Aprovado** | `0` textos abaixo de 4,5:1 / 3:1 nas 26 telas/estados auditados (incluindo tema claro e `[data-contrast="high"]`). Controles em `[data-contrast="high"]` exibem bordas `1px` (`8,37:1`–`11,97:1`). Campos dentro de `bg-elevado` usam `bg-chao` + contorno `1px` `--linha`. |
| **Alvos ≥ 24 px (WCAG 2.5.8)** | **Aprovado nas Ondas 0+1; falha na tela Fontes (#343)** | `0` alvos < 24 px nas telas das Ondas 0+1 (exceção inline/espaçamento nos 3 links `Código-fonte` em `ConfigComponentes`, dentro de `<p>`). Na nova tela `#/projeto/:id/fontes`, os checkboxes de seleção em lote medem **`16×24 px`** (**UI-15**). |
| **Headings (`h1–h6`)** | **Aprovado nas Ondas 0+1; falha na tela Fontes (#343)** | `Assistente`, `PlaceholderTela` (`Cortes`, `Relatos`, `Sobre`) e `ConfigExportacao` agora têm `<h1>` e `<h2>` semânticos. A nova tela `#/projeto/:id/fontes` não possui `<h1>` (**UI-16**). |
| **Textos PT-BR e `GLOSSARY.md`** | **Aprovado** para termos proibidos; **Parcial** em refs de issue | `0` ocorrências de `preset`, `clipe`, `short`, `input`, `voice-over`, `locução` ou `workspace`. `English` desabilitado com `"Em preparação"`. Ainda restam refs `(#301)`/`(#307)` em `<InstaladorJustInTime>` e `(#295)` em `ListaFontes` (**UI-12 / UI-18**). |
| **Overflow (`1366×768`, `1440×900`, escala `115%`)** | **Aprovado** | `0` ocorrências de scroll horizontal ou vertical externo em todas as 26 telas/estados auditados, incluindo `115%` em `#/config/aparencia` e `#/config/provedores`. |
| **Estados de erro e aviso de custo** | **Aprovado** | Erros em `role="alert"` via `BannerErroCore` (`?estado=erro`, `js_runtime_missing`). Consentimento prévio explícito antes de ação externa em API (`PassoProvedor`, `FormPerfilProvedor`) e CLI (`Codex`/`Claude`/`OpenCode` via `<ConfirmDialog>` em `ConfigProvedores`). |

---

## 2. Tabela de pontuação por fluxo (Critique — Nielsen 0–4)

Meta do mandato: **≥ 90%** da pontuação aplicável (**`36 / 40`**).  
Legenda: **H1** Visibilidade de estado · **H2** Mundo real / vocabulário · **H3** Controle e liberdade · **H4** Consistência e padrões · **H5** Prevenção de erros · **H6** Reconhecimento vs. lembrança · **H7** Flexibilidade e atalhos · **H8** Estética e minimalismo · **H9** Recuperação de erros · **H10** Ajuda e documentação.

| Fluxo / Superfície | H1 | H2 | H3 | H4 | H5 | H6 | H7 | H8 | H9 | H10 | Linha de base (`a67cc53`) | Agora (`bac1165`) | Delta | % Agora | Meta ≥ 90% |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| **Onda 0 · Shell Global** | 3 | 4 | 4 | 4 | 3 | 4 | 4 | 4 | 3 | 4 | 27 / 40 (67,5%) | **37 / 40** | **+10 (+25,0 p.p.)** | **92,5%** | **Atinge** |
| **Fluxo (a) · Início e Projetos (`#/inicio`)** | 4 | 4 | 4 | 4 | 4 | 4 | 4 | 4 | 3 | 3 | 36 / 40 (90,0%) | **38 / 40** | **+2 (+5,0 p.p.)** | **95,0%** | **Atinge** |
| **Fluxo (b) · Assistente (`#/assistente`) + JIT** | 3 | 3 | 4 | 4 | 4 | 4 | 3 | 3 | 3 | 3 | 28 / 40 (70,0%) | **34 / 40** | **+6 (+15,0 p.p.)** | **85,0%** | **Abaixo** |
| **Fluxo (c) · Provedores e Custos (`#/config/provedores`, `custos`)** | 4 | 4 | 3 | 4 | 4 | 4 | 4 | 4 | 4 | 3 | 32 / 40 (80,0%) | **38 / 40** | **+6 (+15,0 p.p.)** | **95,0%** | **Atinge** |
| **Fluxo (d) · Componentes, Exportação, Aparência e Projeto** | 4 | 4 | 4 | 4 | 4 | 4 | 4 | 4 | 3 | 3 | 35 / 40 (87,5%) | **38 / 40** | **+3 (+7,5 p.p.)** | **95,0%** | **Atinge** |

### Justificativa das mudanças por heurística e fluxo

- **Onda 0 · Shell Global (`27/40 → 37/40`, +10, Atinge 92,5%):**
  - **H3 (`1 → 4`)**: `SeletorProjeto` passou a executar `Trocar Projeto…`, `Configurações do Projeto`, troca direta entre recentes e `Fechar Projeto` (`projects.close`) ([03-shell-projeto-aberto-1366.png](./capturas/ondas-0-1-reav/03-shell-projeto-aberto-1366.png)).
  - **H4 (`3 → 4`)**: Rodapé da Paleta `Ctrl+K` alinhado à especificação (`"Enter para executar · Esc para fechar"`, [02-shell-paleta-1366.png](./capturas/ondas-0-1-reav/02-shell-paleta-1366.png)) e guarda de fechamento (`FechamentoJanela`) consistente com o restante do shell.
  - **H6 (`2 → 4`)**: Barra Superior expõe `Configurações` (`Ctrl+,`), menu `Mais ações` (`Relatos`, `Sobre`, `Ajuda de atalhos`) e botão clicável `Somente local` ([01-shell-inicio-1366.png](./capturas/ondas-0-1-reav/01-shell-inicio-1366.png)).
  - **H7 (`2 → 4`)**: `F6` / `Shift+F6` ciclam as 3 regiões macro (`topo` ↔ `conteudo` ↔ `rodape`), `Ctrl+J`, `Ctrl+,` e `?` / `Ctrl+/` funcionam globalmente.
  - **H10 (`2 → 4`)**: `FolhaAtalhos` (`?` / `Ctrl+/`) apresenta o mapa oficial de atalhos agrupado por escopo, respeitando a política WCAG 2.1.4 e com atalho direto para personalização.
  - *Nota:* **H1** permanece em `3` porque `Ctrl+J` / `Fila 0` abrem um toast informativo enquanto a gaveta completa da Fila de Jobs aguarda a Onda 6.

- **Fluxo (a) · Início e Projetos (`36/40 → 38/40`, +2, Atinge 95,0%):**
  - **H4 (`3 → 4`)** e **H8 (`3 → 4`)**: Campos do diálogo `Novo Projeto` agora têm superfície `bg-chao` e contorno `1px` `--linha` sobre `bg-elevado` ([06-inicio-novo-projeto-1366.png](./capturas/ondas-0-1-reav/06-inicio-novo-projeto-1366.png)), e `<summary>` de `BannerErroCore` passou a respeitar `min-height: 24px` ([05-inicio-erro-1366.png](./capturas/ondas-0-1-reav/05-inicio-erro-1366.png)).

- **Fluxo (b) · Assistente + Instalador JIT (`28/40 → 34/40`, +6, Abaixo 85,0%):**
  - **H3 (`3 → 4`)**: Reabrir por `#/config/provedores` preserva `?retorno=config` nos passos 1 e 2 e retorna para Provedores ao pular/concluir (`UI-05`).
  - **H4 (`2 → 4`)**: Inputs em `PassoProvedor` visíveis sobre o card selecionado ([08-assistente-passo2-api-1366.png](./capturas/ondas-0-1-reav/08-assistente-passo2-api-1366.png)), alvos `role="radio"` e `"Mudar pasta de instalação"` ≥ 24 px, e `<h1>` presente nos dois passos ([07-assistente-passo1-1366.png](./capturas/ondas-0-1-reav/07-assistente-passo1-1366.png)).
  - **H5 (`2 → 4`)**: `cliConsentido` inicia desmarcado (`false`) para os 3 CLIs (`UI-03`), e o JIT exige aceite de termos antes de baixar por URL.
  - **H6 (`3 → 4`)**: Informações de origem, licença, tamanho e privacidade ficam explícitas tanto no Assistente quanto no bloco JIT montado.
  - *Por que não atingiu 90% (permanece em 85,0%):* **H1** fica em `3` porque `<InstaladorJustInTime>` entrou em produção apenas para `url_import` na tela Fontes (`#343`), permanecendo `yunet` (Onda 4) e `tts` (Onda 5) sem ponto de entrada navegável; **H2** fica em `3` porque `InstaladorJustInTime.tsx` ainda exibe `(#301)` e `(#307)` no texto visível; e **H8** fica em `3` porque, ao abrir inline em `EntradaFonte`, coexistem **dois botões primários laranja (`bg-sinal`) simultâneos** na tela ([21-fontes-jit-1366.png](./capturas/ondas-0-1-reav/21-fontes-jit-1366.png), **UI-17**).

- **Fluxo (c) · Provedores e Custos (`32/40 → 38/40`, +6, Atinge 95,0%):**
  - **H2 (`3 → 4`)**: Removidos `(#305)` em `ConfigProvedores` e `(preset)` em `FormPerfilProvedor` ([09-config-provedores-1366.png](./capturas/ondas-0-1-reav/09-config-provedores-1366.png), [10-config-provedores-modal-1366.png](./capturas/ondas-0-1-reav/10-config-provedores-modal-1366.png)).
  - **H4 (`2 → 4`)**: Campos em `FormPerfilProvedor`, cards CLI e formulário de sobrescrita em `ConfigCustos` agora têm contraste claro de superfície/borda ([13-config-custos-precos-1366.png](./capturas/ondas-0-1-reav/13-config-custos-precos-1366.png)) e bordas ≥ 3:1 em `[data-contrast="high"]` ([20-config-provedores-hc-1440.png](./capturas/ondas-0-1-reav/20-config-provedores-hc-1440.png)).
  - **H5 (`2 → 4`)**: Clicar em `Testar` de CLI em `"Aguarda confirmação"` abre `<ConfirmDialog>` com foco inicial em `Cancelar` antes de chamar `provider.test` (`UI-02`).
  - **H8 (`3 → 4`)**: Superfícies, modal e alto contraste bem hierarquizados e sem overflow mesmo em `115%`.

- **Fluxo (d) · Componentes, Exportação, Aparência e Projeto (`35/40 → 38/40`, +3, Atinge 95,0%):**
  - **H2 (`2 → 4`)**: `"Preset de legenda"` substituído por `"Estilo de legenda"` / `"Estilo padrão de legenda"` ([19-config-projeto-1366.png](./capturas/ondas-0-1-reav/19-config-projeto-1366.png)); `(#307)` e `"Instalado (test)"` removidos de `ConfigComponentes` (`Instalado (2026.11.01)`, [15-config-componentes-modelos-1366.png](./capturas/ondas-0-1-reav/15-config-componentes-modelos-1366.png)); `English` desabilitado com `"Em preparação"` sem alterar `lang` (`UI-13`).
  - **H4 (`3 → 4`)**: Contorno visível em `[data-contrast="high"]` em todos os controles ([18-config-aparencia-hc-1366.png](./capturas/ondas-0-1-reav/18-config-aparencia-hc-1366.png)) e headings `<h2>` semânticos em `ConfigExportacao` ([16-config-exportacao-detectado-1366.png](./capturas/ondas-0-1-reav/16-config-exportacao-detectado-1366.png)).

### Auditoria Técnica (Impeccable Audit — `/20`)

| Dimensão | Linha de base | Agora | Delta | Achado principal |
|---|---|---|---|---|
| 1. Accessibility | 2 / 4 | **3 / 4** | +1 | Ondas 0+1 cumprem WCAG AA (contraste, alvos ≥ 24 px, `<h1>`/`<h2>`, `F6`/`?`, alto contraste). Perde 1 ponto apenas pelos achados na nova tela `#/projeto/:id/fontes`: checkboxes de `16×24 px` (**UI-15**) e ausência de `<h1>` (**UI-16**). |
| 2. Performance | 4 / 4 | **4 / 4** | 0 | Carregamento paralelo sem layout thrashing e respeito a `prefers-reduced-motion`. |
| 3. Theming | 2 / 4 | **4 / 4** | +2 | Fusão `bg-elevado`/`bg-elevado` eliminada em diálogos, cards e formulários; `[data-contrast="high"]` com contornos de `8,37:1`–`11,97:1`; `contraste.ts` 100% aprovado. |
| 4. Responsive Design | 4 / 4 | **4 / 4** | 0 | Zero overflow externo em `1366×768` e `1440×900`, inclusive em `[data-escala="115"]`. |
| 5. Implementation Integrity | 3 / 4 | **3 / 4** | 0 | `impeccable detect` limpo (`[]`), mas `InstaladorJustInTime` ainda vaza `(#301)`/`(#307)`, `ListaFontes` cita `(#295)` após `sources.delete` já existir no núcleo (**UI-18**), e o JIT inline quebra a *Regra da Luz Única* (**UI-17**). |
| **Total** | **15 / 20** *(Good)* | **18 / 20** *(Excellent)* | **+3** | **Ondas 0+1 aprovadas em Shell, Início, Provedores/Custos e Configs; restam ajustes pontuais no JIT e na tela Fontes (#343).** |

---

## 3. Status dos achados da linha de base (`UI-01` a `UI-14`)

| ID | Descrição resumida (linha de base) | Status | Prova / Evidência na reavaliação |
|---|---|---|---|
| **UI-01** | `SeletorProjeto` sem callbacks funcionais | **Resolvido** | `Tela.tsx` L118–140 e `Shell.tsx` L327–362; [03-shell-projeto-aberto-1366.png](./capturas/ondas-0-1-reav/03-shell-projeto-aberto-1366.png). No Playwright, clicar em `Fechar Projeto` fechou `"Canal Baseline"` e navegou para `#/inicio` (chegando inclusive a quebrar a premissa antiga da L326 de `ui-baseline.spec.ts`); `shell.spec.ts` cobre todas as 4 ações. |
| **UI-02** | `Testar` de CLI em `ConfigProvedores` sem `<ConfirmDialog>` | **Resolvido** | No Playwright em `#/config/provedores`, clicar em `Testar` no card `Codex CLI` (`Aguarda confirmação`) abriu `role="alertdialog"` (`"Confirmar envio de texto via CLI?"`, foco inicial em `Cancelar`, explicando envio só de texto e cota do plano) antes de chamar `provider.test`; `config-provedores-custos.spec.ts` L144–187 passa. |
| **UI-03** | `cliConsentido` pré-marcado em `#/assistente?passo=2` | **Resolvido** | No Playwright em `#/assistente?passo=2`, ao selecionar `Codex CLI`, os checkboxes de consentimento iniciam com `checked: false`; `assistente.spec.ts` passa. |
| **UI-04** | Shell sem `Configurações`, `Mais`, `F6`, `Ctrl+J`, `?` e `Somente local` clicável | **Resolvido** | [01-shell-inicio-1366.png](./capturas/ondas-0-1-reav/01-shell-inicio-1366.png) e `Shell.tsx` L368–570: botão `Configurações` (`Ctrl+,`), menu `Mais ações` (`Relatos`, `Sobre`, `Ajuda de atalhos`), `F6` ciclando 3 regiões, `?`/`Ctrl+/` abrindo `FolhaAtalhos`, `Somente local` clicável e `Ctrl+J` ativo (abre toast informativo até a gaveta da Fila na Onda 6). |
| **UI-05** | Perda de `?retorno=config` ao reabrir Assistente | **Resolvido** | No Playwright, `Reabrir assistente inicial` abre `#/assistente?passo=1&retorno=config`, avançar preserva `#/assistente?passo=2&retorno=config` e `Pular por enquanto` volta a `#/config/provedores`; `assistente.spec.ts` e `config-provedores-custos.spec.ts` passam. |
| **UI-06** | `<InstaladorJustInTime>` sem ponto de entrada navegável | **Parcial** | Passou a ser montado para `url_import` em `#/projeto/:id/fontes` (`EntradaFonte.tsx` L638), verificado ao vivo com `https://youtube.com/watch/js-test` ([21-fontes-jit-1366.png](./capturas/ondas-0-1-reav/21-fontes-jit-1366.png)). Os modos `yunet` (Onda 4) e `tts` (Onda 5) continuam apenas em testes unitários até a entrega dessas ondas. |
| **UI-07** | Campos `bg-elevado` invisíveis dentro de `bg-elevado` | **Resolvido** | Campos usam `bg-chao` + `1px` `--linha` dentro de `bg-elevado`: verificado em [06-inicio-novo-projeto-1366.png](./capturas/ondas-0-1-reav/06-inicio-novo-projeto-1366.png), [08-assistente-passo2-api-1366.png](./capturas/ondas-0-1-reav/08-assistente-passo2-api-1366.png), [09-config-provedores-1366.png](./capturas/ondas-0-1-reav/09-config-provedores-1366.png), [10-config-provedores-modal-1366.png](./capturas/ondas-0-1-reav/10-config-provedores-modal-1366.png), [13-config-custos-precos-1366.png](./capturas/ondas-0-1-reav/13-config-custos-precos-1366.png) e no formulário de sobrescrita de preços (`rgb(15, 16, 18)` + inset `1px`). |
| **UI-08** | Alvos `< 24 px` (`role="radio"`, `"Mudar pasta"`, `<summary>`) | **Resolvido** | `base.css` L75–77 (`summary { min-height: 24px }`) + ajustes nos componentes; `0` alvos `< 24 px` nas telas das Ondas 0+1 no JSON auditado e `a11y-ui-07-10.spec.ts` passa. *(Nota: novo caso de checkbox `16×24 px` encontrado na tela Fontes — ver **UI-15**).* |
| **UI-09** | Controles sem borda em `[data-contrast="high"]` | **Resolvido** | [18-config-aparencia-hc-1366.png](./capturas/ondas-0-1-reav/18-config-aparencia-hc-1366.png), [20-config-provedores-hc-1440.png](./capturas/ondas-0-1-reav/20-config-provedores-hc-1440.png), `contraste.ts` (`contorno-controle`/`contorno-campo` ≥ 8,37:1) e `a11y-ui-07-10.spec.ts` passam. |
| **UI-10** | Falta de `<h1>` em Assistente/Placeholder e `<h2>` em Exportação | **Resolvido** | Auditoria DOM confirma `<h1>` em `Passo 1`, `Passo 2`, `Cortes`, `Relatos` e `Sobre`, e `<h2>` em `Status atual` / `Escolha de encoder` ([07-assistente-passo1-1366.png](./capturas/ondas-0-1-reav/07-assistente-passo1-1366.png), [16-config-exportacao-detectado-1366.png](./capturas/ondas-0-1-reav/16-config-exportacao-detectado-1366.png)). *(Nota: nova tela Fontes sem `<h1>` — ver **UI-16**).* |
| **UI-11** | Termo proibido `preset` em `ConfigProjeto` e `FormPerfilProvedor` | **Resolvido** | Substituído por `"Estilo padrão de legenda"` / `"Estilo de legenda"` ([19-config-projeto-1366.png](./capturas/ondas-0-1-reav/19-config-projeto-1366.png)) e `"Modelo rápido"` ([10-config-provedores-modal-1366.png](./capturas/ondas-0-1-reav/10-config-provedores-modal-1366.png)); `0` violações de glossário nas 26 auditorias. |
| **UI-12** | Códigos `#305`/`#307` e `"Instalado (test)"` no texto visível | **Parcial** | Limpo em `PassoEssencial` ([07-assistente-passo1-1366.png](./capturas/ondas-0-1-reav/07-assistente-passo1-1366.png)), `ConfigProvedores` ([09-config-provedores-1366.png](./capturas/ondas-0-1-reav/09-config-provedores-1366.png)) e `ConfigComponentes` (`Instalado (2026.11.01)`, [15-config-componentes-modelos-1366.png](./capturas/ondas-0-1-reav/15-config-componentes-modelos-1366.png)). Porém `<InstaladorJustInTime>` ainda exibe `(#301)` e `(#307)` no texto visível (`InstaladorJustInTime.tsx` L177, L344, L659). |
| **UI-13** | Seleção de `English` alterava `<html lang="en">` sem traduzir | **Resolvido** | `English` desabilitado com rótulo `"Em preparação"` em `ConfigAparencia.tsx` e verificado em `ConfigAparencia.test.tsx`. |
| **UI-14** *(linha de base)* | Paleta `Ctrl+K` sem rodapé `"Enter para executar · Esc para fechar"` | **Resolvido** | Rodapé presente e legível em `Paleta.tsx` L88–90 ([02-shell-paleta-1366.png](./capturas/ondas-0-1-reav/02-shell-paleta-1366.png)) e validado em `shell.spec.ts`. |

---

## 4. Achados novos

> **Nota de numeração:** A linha de base ([avaliacao-ondas-0-1.md](./avaliacao-ondas-0-1.md) L107) e `front-v2/e2e/shell.spec.ts` já utilizam o identificador `UI-14` para o rodapé da Paleta `Ctrl+K` (resolvido). Para preservar rastreabilidade sem colisão, os achados novos desta reavaliação iniciam em **`UI-15`**.

| ID | Sev. | Categoria | Tela / Arquivo | Passo para reproduzir | Captura | Sugestão de correção |
|---|---|---|---|---|---|---|
| **UI-15** | **P1** | A11y AA | `#/projeto/:id/fontes` (`front-v2/src/telas/fontes/ListaFontes.tsx` L425–431; `design-system-v2/src/primitivas/Escolhas.tsx` L20) | Abrir um Projeto em `#/projeto/:id/fontes` e medir os checkboxes `"Selecionar <arquivo> para lote"` nos cartões da lista: como o rótulo usa `sr-only`, o `<label>` herda `min-h-6` sem largura mínima e mede **`16×24 px`** (abaixo de `24 px` da WCAG 2.5.8). | [03-shell-projeto-aberto-1366.png](./capturas/ondas-0-1-reav/03-shell-projeto-aberto-1366.png), [21-fontes-jit-1366.png](./capturas/ondas-0-1-reav/21-fontes-jit-1366.png) | Adicionar `min-w-6 justify-center` quando `<Checkbox>` não tiver conteúdo visível (ou aplicar `min-w-6` na classe base do `<Checkbox>` em `Escolhas.tsx`). |
| **UI-16** | **P2** | A11y AA | `#/projeto/:id/fontes` (`front-v2/src/telas/fontes/Fontes.tsx` L204–250) | Abrir `#/projeto/:id/fontes` (aba `Fontes` ou `?sub=lotes`) e inspecionar a árvore de headings (`h1–h6`): não há `<h1>` na página — o primeiro heading é `<h2>Entrada de Fonte</h2>` (ou `<h2>Lotes de Fontes</h2>` em `EstadoTela`). | [03-shell-projeto-aberto-1366.png](./capturas/ondas-0-1-reav/03-shell-projeto-aberto-1366.png), [21-fontes-jit-1366.png](./capturas/ondas-0-1-reav/21-fontes-jit-1366.png) | Incluir `<h1 className="sr-only">Fontes e Transcrição</h1>` no topo de `Fontes.tsx` e passar `nivelTitulo="h1"` quando `sub === 'lotes'` for a única região principal. |
| **UI-17** | **P2** | visual | `#/projeto/:id/fontes` + `<InstaladorJustInTime>` (`front-v2/src/telas/fontes/EntradaFonte.tsx` L605–649; `InstaladorJustInTime.tsx` L489) | Em `#/projeto/:id/fontes`, alternar para `URL (VOD)`, preencher `https://youtube.com/watch/js-test`, clicar em `Baixar por URL` e aceitar os termos: o painel inline `<InstaladorJustInTime>` abre exibindo o botão primário laranja `Baixar e continuar` logo abaixo de `Baixar por URL`, que permanece como `variante="primario"` — resultando em **dois botões primários simultâneos** (violação da *Regra da Luz Única* do `DESIGN.md`). | [21-fontes-jit-1366.png](./capturas/ondas-0-1-reav/21-fontes-jit-1366.png) | Quando `mostrarJit` estiver aberto em `EntradaFonte.tsx`, rebaixar `Baixar por URL` para `variante="secundario"` para manter um único primário (`Baixar e continuar`) na tela. |
| **UI-18** | **P2** | texto | `<InstaladorJustInTime>` e `#/projeto/:id/fontes` (`front-v2/src/componentes/InstaladorJustInTime.tsx` L177, L344, L659, L727, L757; `ListaFontes.tsx` L563) | Acionar `<InstaladorJustInTime>` sem manifesto macOS ou Worker (`(#301)` e `(#307)` ainda aparecem no texto visível ao usuário), ou inspecionar o botão desabilitado `Excluir Fonte` em `ListaFontes` (o tooltip cita `(#295)`, apesar de `sources.delete` já ter entrado no núcleo em `30505af`). | [03-shell-projeto-aberto-1366.png](./capturas/ondas-0-1-reav/03-shell-projeto-aberto-1366.png) | Remover `(#301)` e `(#307)` do corpo visível de `InstaladorJustInTime.tsx` (alinhando com `UI-12`) e ligar `Excluir Fonte` a `sources.delete` (ou remover `#295` do texto exposto). |

---

## 5. Inventário das capturas PNG (`docs/produto/front-v2/ui/capturas/ondas-0-1-reav/`)

Total: **21 arquivos** (as 20 capturas equivalentes ao cenário da linha de base + `21-fontes-jit-1366.png` para sustentar UI-06 e os achados novos em `#/projeto/:id/fontes`).

| Arquivo | Tela / Estado | Viewport / Tema | Sustenta |
|---|---|---|---|
| `01-shell-inicio-1366.png` | `#/inicio` padrão | `1366×768` · padrão | Onda 0 (UI-04), Fluxo (a) |
| `02-shell-paleta-1366.png` | Paleta `Ctrl+K` aberta com rodapé | `1366×768` · padrão | Onda 0 (UI-14) |
| `03-shell-projeto-aberto-1366.png` | Menu `SeletorProjeto` aberto sobre `#/projeto/.../fontes` | `1366×768` · padrão | Onda 0 (UI-01), UI-15, UI-16, UI-18 |
| `04-inicio-vazio-1366.png` | `#/inicio?estado=vazio` (e tooltip `Configurações`) | `1366×768` · padrão | Fluxo (a) estado vazio |
| `05-inicio-erro-1366.png` | `#/inicio?estado=erro` (`BannerErroCore`) | `1366×768` · padrão | Fluxo (a) e UI-08 |
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
| `21-fontes-jit-1366.png` | `#/projeto/meu-canal-de-cortes/fontes` (`URL (VOD)` + JIT aberto) | `1366×768` · padrão | UI-06, UI-15, UI-16, UI-17 |
