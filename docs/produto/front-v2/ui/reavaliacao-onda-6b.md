# Reavaliação independente de UI — Onda 6 (Exportação, Fila de Jobs, Relatos e Sobre) · 2ª rodada

> ⚠️ **DEGRADED: single-context (critique + audit em sessão única com sub-checagens automatizadas em Playwright, sem subagente independente nem navegador interativo manual além da suíte E2E + auditoria DOM + `impeccable detect`; ambiente mock TS `VITE_CORE_MOCK=1`, sem Tauri).**

- **Data da reavaliação:** 2026-11-19
- **Commit avaliado (`HEAD`):** `c012304` (`origin/master`, incorporando `e255e08` — PR `#495` / `#488`, correções de `UI-81`, `UI-82`, `UI-84`, `UI-86`, `UI-90` e `UI-91`)
- **Linha de base comparada:** `5a277d7` / `0e8c8cb` ([`reavaliacao-onda-6.md`](./reavaliacao-onda-6.md), PR `#487`)
- **Referências:** [`DESIGN.md`](../../../../DESIGN.md), [`GLOSSARY.md`](../../../../GLOSSARY.md), [`10-plano-onda-6.md`](../10-plano-onda-6.md), [`F-exportacao-fila-relatos.md`](../telas/F-exportacao-fila-relatos.md), [`reavaliacao-onda-6.md`](./reavaliacao-onda-6.md)
- **Script reproduzível:** [`front-v2/e2e/ui-onda6.spec.ts`](../../../../front-v2/e2e/ui-onda6.spec.ts) (executado integralmente e sem alterações com `UI_BASELINE=1`; nenhuma tela ou teste foi alterado neste PR)
- **Capturas:** 24 PNGs em [`docs/produto/front-v2/ui/capturas/onda-6-reav2/`](./capturas/onda-6-reav2/)

---

## 1. Cenário executado e evidências automatizadas

O cenário fixo da linha de base foi reproduzido do começo ao fim em [`front-v2/e2e/ui-onda6.spec.ts`](../../../../front-v2/e2e/ui-onda6.spec.ts) com `VITE_CORE_MOCK=1`, nos viewports `1366×768` e `1440×900`, tema escuro padrão e modo de alto contraste (`[data-contrast="high"]`). As 24 capturas geradas foram movidas para `docs/produto/front-v2/ui/capturas/onda-6-reav2/` e as capturas originais de `onda-6/` foram restauradas via `git checkout -- docs/produto/front-v2/ui/capturas/onda-6/`.

### 1.1 Comandos verificados

| Verificação | Comando | Resultado observado |
|---|---|---|
| Instalação | `cd front-v2; bun install` | `152 packages installed [16.74s]`, exit `0` |
| Static UI check | `impeccable detect --json front-v2/src` | `[]` (zero detecções), exit `0` |
| Contraste tokens DS | `cd design-system-v2; bun scripts/contraste.ts` | `Todos os pares passam.` (escuro, claro, escuro `[data-contrast="high"]`, claro `[data-contrast="high"]`), exit `0` |
| Typecheck | `cd front-v2; bun run typecheck` (`tsc --noEmit`) | Exit `0` |
| E2E CI padrão | `cd front-v2; bunx playwright test --reporter=list` (sem `UI_BASELINE`) | `42 passed`, `6 skipped` (`ui-baseline`, `ui-onda2`, `ui-onda3`, `ui-onda4`, `ui-onda5`, `ui-onda6`) em `42.4s`, exit `0` |
| Reavaliação Onda 6 + DOM audit | `$env:UI_BASELINE="1"; bunx playwright test e2e/ui-onda6.spec.ts --reporter=list` | `1 passed (25.5s)`, `erros: []` (`0 pageerror`), 24 capturas geradas e 21 auditorias DOM, exit `0` |

### 1.2 Síntese das verificações transversais nas 21 medições DOM

- **Contraste de texto (DOM):** `0` textos abaixo de `4,5:1` (`3:1` grande) nas 21 medições (`1366×768` e `1440×900`, padrão e `[data-contrast="high"]`).
- **Headings / Semântica:** `h1Count = 1`, `saltoHeading = null`, `semNomeAcessivel = 0` e `imagensQuebradas = 0` em todas as 21 medições. `spanTabIndexZero: []` em todas as telas principais (`01`–`03`, `06`–`11`, `15`, `17`–`20`, `22`–`24`); os únicos `span[tabindex="0"]` reportados pertencem ao `<Checkbox>` acessível (`role="checkbox"`) em `Relatos` (`16`, `t-relatos-vazio`, `t-relatos-erro`) e aos focus-guards internos do `@base-ui/react` em diálogos (`04`, `05`, `12`–`14`, `21`).
- **Overflow externo e tabelas:** `0 px` de overflow horizontal ou vertical na viewport (`scrollW === innerW` e `scrollH === innerH`) e `overflowTabelasInternas = 0` em todas as 21 medições.
- **Alvos ≥ 24 px (WCAG 2.5.8):** `alvosMenores24: []` em todas as 21 medições.
- **Teclado (`F6`, `Esc` e foco inicial):**
  - `regioesF6ExportacaoComFila`: `["conteudo", "fila", "rodape", "topo", "conteudo", "fila", "rodape"]`.
  - `regioesF6CortesComFila`: `["conteudo", "conteudo", "fila", "rodape", "topo", "conteudo"]` (`fila` agora incluída em `Selecao`, resolvendo **UI-90**).
  - `escapeFechouAposTab: true` e `escapeFechouExportFila: true` (listener `Escape` em `window` fecha a gaveta da Fila mesmo após `F6` mover o foco para fora do `<aside>`, resolvendo **UI-90**).
  - `focoInicialRetry: "Cancelar"` em `DialogoTentarDeNovo` (resolvendo **UI-82**), ao lado de `focoInicialDlgDireto: "Cancelar"` e `focoInicialDlgConflitos: "Cancelar"`.
- **Toasts e Regra da Luz Única:**
  - `botoesPrimariosSinal <= 1` em todas as 21 medições DOM (inclusive `r-fila-dialog-retry`, `r-fila-dialog-orcamento`, `r-fila-dialog-redo` com `1` único botão `.bg-sinal` e `r-fila-dialog-resultado` com `0` — resolvendo **UI-84** e **UI-91**).
  - `sobreposicaoToast: false` em `r-fila-toast` (`15-fila-toast-abrir-fila-1366.png`): `ProvedorToast` em `acima-acoes` (`bottom: 7rem`) deixa o botão primário `"Exportar 4 aprovados em lote"` livre e clicável (**UI-81** resolvido). Na captura `15`, o toast ainda recobre temporariamente (4 s) o gatilho recolhível secundário `"Checklist informativo"` em `1366×768` (**UI-120**).
- **Glossário e referências internas:** `ticketRefsVisiveis: []` e `glossarioViolacoes: []` em todas as 21 medições DOM (inclusive `s-sobre-atualizacao-1440` após correção de `"Corte da sonda de hardware"` em `THIRD_PARTY_NOTICES.md:60`, e `Relatos` exibindo `"precisão equilibrada"`, resolvendo **UI-86**).

---

## 2. Notas por fluxo (Nielsen H1–H10) e Audit Impeccable

Meta do projeto: **≥ 90% por fluxo (≥ 36/40)**, **WCAG 2.2 AA** (incl. alto contraste e 2.1.4) e **zero bloqueador funcional**.
Legenda: **H1** Visibilidade de estado · **H2** Mundo real / vocabulário · **H3** Controle e liberdade · **H4** Consistência e padrões · **H5** Prevenção de erros · **H6** Reconhecimento vs. lembrança · **H7** Flexibilidade e atalhos · **H8** Estética e minimalismo · **H9** Recuperação de erros · **H10** Ajuda e documentação.

| Fluxo | H1 | H2 | H3 | H4 | H5 | H6 | H7 | H8 | H9 | H10 | Original (`5a277d7`) | Agora (`c012304`) | Delta | % Agora | Meta (≥ 90%) |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|:---:|
| **(q)** Exportação (Mesa de Prontidão, Lote e Histórico) | 4 | 4 | 4 | 4 | 4 | 4 | 4 | 3 | 4 | 4 | 38/40 (95,0%) | **39/40** | **+1 (+2,5 p.p.)** | **97,5%** | ✅ Atendida |
| **(r)** Painel Global da Fila de Jobs (`Ctrl+J`, região `fila`) | 4 | 4 | 4 | 4 | 4 | 4 | 4 | 4 | 4 | 4 | 36/40 (90,0%) | **40/40** | **+4 (+10,0 p.p.)** | **100,0%** | ✅ Atendida |
| **(s)** Relatos e Diagnóstico (`#/relatos`) e Sobre (`#/sobre`) | 4 | 3 | 4 | 4 | 4 | 4 | 4 | 4 | 4 | 4 | 39/40 (97,5%) | **39/40** | **0 (0,0 p.p.)** | **97,5%** | ✅ Atendida |
| **(t)** Estados de erro, vazios, carregamento e sem Projeto | 4 | 4 | 4 | 4 | 4 | 4 | 4 | 4 | 4 | 4 | 40/40 (100,0%) | **40/40** | **0 (0,0 p.p.)** | **100,0%** | ✅ Atendida |

> **Nota sobre meta e WCAG 2.2 AA:** Todos os 4 fluxos superam a meta de **≥ 90%** (`97,5%` a `100,0%`), com `0` violações de contraste, `0` alvos `< 24 px` (SC 2.5.8), `0` saltos de heading, `0` violações do `GLOSSARY.md` e `0` bloqueadores `P0`/`P1`/`P2`. Todos os achados `UI-70`, `UI-80`–`UI-87`, `UI-90` e `UI-91` foram resolvidos; restam apenas **3 achados `P3`** de polimento (**UI-120**, **UI-121** e **UI-122**).

### Justificativa de cada heurística que mudou (ou permaneceu `< 4`)

- **Fluxo (q) · `38/40 → 39/40` (+1 pt / +2,5 p.p.):**
  - **H3 (`3 → 4`, +1):** O toast em `acima-acoes` deixou de obstruir o botão primário `"Exportar 4 aprovados em lote"` (`sobreposicaoToast: false` em [`15-fila-toast-abrir-fila-1366.png`](./capturas/onda-6-reav2/15-fila-toast-abrir-fila-1366.png), **UI-81**) e `Esc` passou a fechar a Fila aberta em `Exportacao` mesmo depois de `F6` mover o foco para fora da gaveta (`escapeFechouExportFila: true`, **UI-90**).
  - **H8 (`3 → 3`, 0):** Apesar do fim da colisão com o botão primário (**UI-81**), permanece em `3` porque em `1366×768` o toast de 4 s (`bottom: 7rem`) ainda cobre o gatilho recolhível `"Checklist informativo — nenhum item bloqueia a exportação"` na Zona B ([`15-fila-toast-abrir-fila-1366.png`](./capturas/onda-6-reav2/15-fila-toast-abrir-fila-1366.png), **UI-120**) e a Zona B exibe `"1 Corte(s) estão..."` ([`01`](./capturas/onda-6-reav2/01-exportacao-prontidao-1366.png)–[`03`](./capturas/onda-6-reav2/03-exportacao-prontidao-hc-1366.png), **UI-121**).

- **Fluxo (r) · `36/40 → 40/40` (+4 pts / +10,0 p.p.):**
  - **H2 (`3 → 4`, +1):** `rotuloEscopoOrcamento` passou a usar `rotuloLoteFontes`, substituindo `"Lote: sources-3"` por `"Lote de Fontes 3"` no banner da Fila ([`09-fila-jobs-aberta-1366.png`](./capturas/onda-6-reav2/09-fila-jobs-aberta-1366.png), [`10-fila-jobs-1440.png`](./capturas/onda-6-reav2/10-fila-jobs-1440.png), [`11-fila-jobs-hc-1366.png`](./capturas/onda-6-reav2/11-fila-jobs-hc-1366.png)) e em `DialogoOrcamento` ([`13-fila-dialog-orcamento-1440.png`](./capturas/onda-6-reav2/13-fila-dialog-orcamento-1440.png), **UI-86**).
  - **H3 (`3 → 4`, +1):** `DialogoTentarDeNovo` passou a manter o `<ConfirmDialog>` montado antes de abrir, levando o foco inicial para `"Cancelar"` (`focoInicialRetry: "Cancelar"`, [`12-fila-dialog-retry-custo-1366.png`](./capturas/onda-6-reav2/12-fila-dialog-retry-custo-1366.png), **UI-82**), e `PainelFilaJobs` passou a escutar `Escape` em `window` (`capture: true`), fechando a gaveta independentemente de onde esteja o foco (`escapeFechouExportFila: true`, **UI-90**).
  - **H4 (`3 → 4`, +1):** `definirDialogoFilaAberto` / `useDialogoFilaAberto` rebaixam o botão primário de `Selecao` e `MesaProntidao` enquanto há diálogo da Fila aberto (`botoesPrimariosSinal: 1` em [`12`](./capturas/onda-6-reav2/12-fila-dialog-retry-custo-1366.png)–[`14`](./capturas/onda-6-reav2/14-fila-dialog-redo-result-1366.png), **UI-84**), e `DialogoResultadoJob` trocou `"Fechar"` para `variante="secundario"` (`botoesPrimariosSinal: 0` em `r-fila-dialog-resultado`, **UI-91**).
  - **H7 (`3 → 4`, +1):** `Selecao.tsx` incluiu `[data-regiao="fila"]` em `obterRegioes()`, fazendo `F6` / `Shift+F6` alcançar a gaveta da Fila também em `#/projeto/demo/cortes` (`regioesF6CortesComFila: ["conteudo","conteudo","fila","rodape","topo","conteudo"]`, **UI-90**).

- **Fluxo (s) · `39/40 → 39/40` (0 pt / 0,0 p.p.):**
  - **H2 (`3 → 3`, 0):** `THIRD_PARTY_NOTICES.md:60` corrigiu `"Clipe da sonda de hardware"` para `"Corte da sonda de hardware"` (`glossarioViolacoes: []` em [`20-sobre-atualizacao-atribuicoes-1440.png`](./capturas/onda-6-reav2/20-sobre-atualizacao-atribuicoes-1440.png)) e `Relatos` traduziu `int8_float16` para `"precisão equilibrada"` no resumo humano da sonda ([`16`](./capturas/onda-6-reav2/16-relatos-passo1-segredo-1366.png), [`17`](./capturas/onda-6-reav2/17-relatos-passo2-revisao-1440.png), **UI-86**). Permanece em `3` porque `Sobre` ainda exibe o carimbo ISO-8601 bruto `"2026-11-13T00:00:00Z"` na versão disponível ([`20-sobre-atualizacao-atribuicoes-1440.png`](./capturas/onda-6-reav2/20-sobre-atualizacao-atribuicoes-1440.png), **UI-122**).

- **Fluxo (t) · `40/40 → 40/40` (0 pt / 0,0 p.p.):**
  - Mantém nota máxima em todas as heurísticas (`22`–`24` e medições DOM de erro/vazio/carregamento/sem projeto sem desvios).

### Impeccable Audit (`/20`)

| Dimensão | Original (`5a277d7`) | Agora (`c012304`) | Delta | Síntese |
|---|---:|---:|---:|---|
| Contraste e Cor | 4 | **4** | **0** | `contraste.ts` 100% aprovado nos 4 modos; `0` violações de contraste de texto nas 21 medições DOM (`1366×768`, `1440×900` e alto contraste). |
| Tipografia e Hierarquia | 4 | **4** | **0** | `h1Count = 1`, `saltoHeading: null`, `num` tabular e zero violações de glossário (`glossarioViolacoes: []`) em todas as 21 medições (**UI-86**). |
| Layout, Espaçamento e Viewport | 3 | **3** | **0** | `0 px` de overflow externo e de tabelas nas 21 medições; toast deixou de cobrir o botão primário da Mesa (**UI-81**), mas em `1366×768` (`bottom: 7rem`) ainda sobrepõe por 4 s o cabeçalho recolhível `"Checklist informativo"` na Zona B (**UI-120**). |
| Alvos, Teclado e A11y AA | 3 | **4** | **+1** | `alvosMenores24: []` nas 21 medições; `DialogoTentarDeNovo` foca `"Cancelar"` (**UI-82**); `F6` em `Selecao` inclui `fila` e `Esc` fecha a Fila de qualquer região (**UI-90**). |
| Sobriedade Visual (*Luz Única* / *Estado Cinza*) | 4 | **4** | **0** | `botoesPrimariosSinal <= 1` nas 21 medições — botão primário de `Selecao` e `MesaProntidao` rebaixado atrás de diálogos da Fila (**UI-84**) e `"Fechar"` de `DialogoResultadoJob` em `secundario` (**UI-91**). |
| **Total Audit Impeccable** | **18/20** *(90%)* | **19/20** *(95%)* | **+1 (+5 p.p.)** | **Todos os achados `UI-70`–`UI-91` resolvidos; zero `P0`/`P1`/`P2`; restam apenas 3 polimentos `P3` (`UI-120`–`UI-122`).** |

---

## 3. Status dos achados da linha de base (`UI-70`, `UI-80`–`UI-87` e `UI-90`–`UI-91`)

| ID | Sev. | Resumo na linha de base | Status | Evidência na reavaliação (captura / passo / código) |
|---|---|---|---|---|
| **UI-70** | **P2** | Botão de job ativo na `BarraStatus` (`Shell.tsx`) media `< 24 px` | **Resolvido** | Mantido `min-h-6` em `Shell.tsx`; `alvosMenores24: []` em todas as 21 medições DOM ([`01`](./capturas/onda-6-reav2/01-exportacao-prontidao-1366.png)–[`23`](./capturas/onda-6-reav2/23-estado-exportacao-erro-1366.png)). |
| **UI-80** | **P1** | `Exportacao` interceptava `F6` omitindo `fila`; `Esc` falhava após `Tab` em `Fechar Fila (Esc)` | **Resolvido** | `regioesF6ExportacaoComFila: ["conteudo","fila","rodape","topo","conteudo","fila","rodape"]`, `escapeFechouAposTab: true` e `escapeFechouExportFila: true`. |
| **UI-81** | **P1** | Toast (`Abrir Fila`) no canto inferior direito bloqueava o botão primário de `Exportacao` | **Resolvido** | [`Indicadores.tsx#L150-L189`](../../../../design-system-v2/src/primitivas/Indicadores.tsx#L150-L189) moveu `ProvedorToast` para `posicao="acima-acoes"` (`bottom: 7rem`, com deslocamento `--toast-right` em [`Shell.tsx#L457-L475`](../../../../front-v2/src/shell/Shell.tsx#L457-L475) quando a Fila abre). `sobreposicaoToast: false` em [`15-fila-toast-abrir-fila-1366.png`](./capturas/onda-6-reav2/15-fila-toast-abrir-fila-1366.png); botão `"Exportar 4 aprovados em lote"` permanece livre. *(Sobreposição residual ao gatilho secundário do checklist registrada em **UI-120**.)* |
| **UI-82** | **P2** | `DialogoTentarDeNovo` não focava `"Cancelar"`; alvos `< 24 px` | **Resolvido** | [`DialogosFila.tsx#L192-L280`](../../../../front-v2/src/telas/fila/DialogosFila.tsx#L192-L280) manteve `<ConfirmDialog aberto={aberto && Boolean(job)}>` montado antes da abertura; `checksExtras.fila.focoInicialRetry: "Cancelar"` ([`12-fila-dialog-retry-custo-1366.png`](./capturas/onda-6-reav2/12-fila-dialog-retry-custo-1366.png)). `alvosMenores24: []` nas 21 medições ([`14-fila-dialog-redo-result-1366.png`](./capturas/onda-6-reav2/14-fila-dialog-redo-result-1366.png)). |
| **UI-83** | **P2** | `<span tabIndex={0}>` em desabilitados e salto `h1 → h3` na Zona A de `MesaProntidao` | **Resolvido** | `saltoHeading: null` e `spanTabIndexZero: []` em `q-exportacao-prontidao-*` ([`01`](./capturas/onda-6-reav2/01-exportacao-prontidao-1366.png)–[`03`](./capturas/onda-6-reav2/03-exportacao-prontidao-hc-1366.png)). |
| **UI-84** | **P2** | Violação da *Regra da Luz Única*: dois `.bg-sinal` em `#/inicio + Fila` e atrás de modais da Fila | **Resolvido** | [`PainelFilaJobs.tsx#L356-L373`](../../../../front-v2/src/telas/fila/PainelFilaJobs.tsx#L356-L373), [`DialogosFila.tsx#L210-L228`](../../../../front-v2/src/telas/fila/DialogosFila.tsx#L210-L228), [`ConfiguradorSelecao.tsx`](../../../../front-v2/src/telas/cortes/ConfiguradorSelecao.tsx) e [`MesaProntidao.tsx#L506-L510`](../../../../front-v2/src/telas/exportacao/MesaProntidao.tsx#L506-L510) rebaixam o CTA da tela de fundo quando diálogo da Fila abre. `botoesPrimariosSinal: 1` em [`04`](./capturas/onda-6-reav2/04-exportacao-aviso-direto-1366.png), [`05`](./capturas/onda-6-reav2/05-exportacao-conflitos-dialog-1366.png), [`12`](./capturas/onda-6-reav2/12-fila-dialog-retry-custo-1366.png), [`13`](./capturas/onda-6-reav2/13-fila-dialog-orcamento-1440.png), [`14`](./capturas/onda-6-reav2/14-fila-dialog-redo-result-1366.png) e [`24`](./capturas/onda-6-reav2/24-estado-fila-sem-projeto-1366.png). |
| **UI-85** | **P2** | `ChecklistGuardaCorpos` abria recolhido na 1ª carga e Zona C ficava em `0/2` (`1 concluídos`) | **Resolvido** | Checklist aberto na carga inicial em [`01`](./capturas/onda-6-reav2/01-exportacao-prontidao-1366.png)/[`02`](./capturas/onda-6-reav2/02-exportacao-prontidao-1440.png) e Zona C sincronizada (`1/2 concluído · 62%`) em [`06`](./capturas/onda-6-reav2/06-exportacao-lote-progresso-1366.png). |
| **UI-86** | **P3** | Strings técnicas cruas na Fila (`Lote: sources-3`), `Relatos` (`int8_float16`) e `THIRD_PARTY_NOTICES.md` (`Clipe`) | **Resolvido** | [`DialogosFila.tsx#L236`](../../../../front-v2/src/telas/fila/DialogosFila.tsx#L236) exibe `"Lote de Fontes 3"` em [`09`](./capturas/onda-6-reav2/09-fila-jobs-aberta-1366.png)–[`11`](./capturas/onda-6-reav2/11-fila-jobs-hc-1366.png) e [`13`](./capturas/onda-6-reav2/13-fila-dialog-orcamento-1440.png); [`Relatos.tsx#L496-L501`](../../../../front-v2/src/telas/relatos/Relatos.tsx#L496-L501) exibe `"precisão equilibrada"` em [`16`](./capturas/onda-6-reav2/16-relatos-passo1-segredo-1366.png)/[`17`](./capturas/onda-6-reav2/17-relatos-passo2-revisao-1440.png); [`THIRD_PARTY_NOTICES.md#L60`](../../../../THIRD_PARTY_NOTICES.md#L60) usa `"## Corte da sonda de hardware"` (`glossarioViolacoes: []` em [`20`](./capturas/onda-6-reav2/20-sobre-atualizacao-atribuicoes-1440.png)). *(No campo editável do relato para o GitHub em `17`/`18`, termos técnicos permanecem propositalmente como dados de diagnóstico.)* |
| **UI-87** | **P3** | Banners comprimiam a lista da Fila em `1366×768` e `<Dica>` em `<span>` sem teclado | **Resolvido** | Zona 1 em `max-h-[40%]` ([`09`](./capturas/onda-6-reav2/09-fila-jobs-aberta-1366.png), [`11`](./capturas/onda-6-reav2/11-fila-jobs-hc-1366.png)) e `<Dica>` em `<button type="button">` focáveis. |
| **UI-90** | **P2** | `Selecao` omitia `fila` em `F6`; `Esc` não fechava a Fila fora do `<aside>` | **Resolvido** | [`Selecao.tsx#L153-L160`](../../../../front-v2/src/telas/cortes/Selecao.tsx#L153-L160) inclui `[data-regiao="fila"]` (`regioesF6CortesComFila: ["conteudo","conteudo","fila","rodape","topo","conteudo"]`) e [`PainelFilaJobs.tsx#L375-L394`](../../../../front-v2/src/telas/fila/PainelFilaJobs.tsx#L375-L394) escuta `Escape` em `window` (`escapeFechouExportFila: true`). |
| **UI-91** | **P3** | `DialogoResultadoJob` destacava `"Fechar"` com `variante="primario"` | **Resolvido** | [`DialogosFila.tsx#L715`](../../../../front-v2/src/telas/fila/DialogosFila.tsx#L715) usa `variante="secundario"` (`botoesPrimariosSinal: 0` em `r-fila-dialog-resultado`). |

---

## 4. Achados novos (`UI-120` em diante)

> Zero bloqueadores `P0`, zero `P1` e zero `P2`. Foram identificados **3 achados `P3`** de polimento visual/copy.

| ID | Sev. | Categoria | Tela / Arquivo | Passo para reproduzir | Captura / Evidência | Sugestão de correção |
|---|---|---|---|---|---|---|
| **UI-120** | **P3** | layout / posicionamento | `ProvedorToast` ([`Indicadores.tsx#L171-L179`](../../../../design-system-v2/src/primitivas/Indicadores.tsx#L171-L179)) sobre `MesaProntidao` | Em `#/projeto/demo/cortes`, descartar a chamada incerta `#2` e navegar imediatamente para `#/projeto/demo/exportacao` em `1366×768` enquanto o toast `acima-acoes` (`4 s`) está visível. | Embora não sobreponha o botão primário `"Exportar 4 aprovados em lote"` (`sobreposicaoToast: false`), em [`15-fila-toast-abrir-fila-1366.png`](./capturas/onda-6-reav2/15-fila-toast-abrir-fila-1366.png) o toast posicionado em `bottom: 7rem` (`112 px`) cobre o cabeçalho recolhível `"Checklist informativo — nenhum item bloqueia a exportação"` na Zona B durante 4 s. | Avaliar `posicao="superior-centro"` ou `bottom` alinhado acima do rodapé/barra esquerda quando a tela usa painel lateral de altura total com CTA na base, ou adicionar espaçamento inferior extra na Zona B. |
| **UI-121** | **P3** | vocabulário / pluralização | `MesaProntidao` ([`MesaProntidao.tsx#L187,200,225,234,995`](../../../../front-v2/src/telas/exportacao/MesaProntidao.tsx#L995)) | Abrir `#/projeto/demo/exportacao` com 1 Corte offline na lista. | Em [`01-exportacao-prontidao-1366.png`](./capturas/onda-6-reav2/01-exportacao-prontidao-1366.png)–[`03`](./capturas/onda-6-reav2/03-exportacao-prontidao-hc-1366.png) e [`15`](./capturas/onda-6-reav2/15-fila-toast-abrir-fila-1366.png), a Zona B exibe `"1 Corte(s) estão com a Fonte offline ou alterada e falharão até serem relocalizados."` (plural mecânico `(s)` com verbo no plural para quantidade `1`; mesmo padrão nas linhas do checklist). | Usar concordância singular/plural real (`qtd === 1 ? '1 Corte está...' : '${qtd} Cortes estão...'`) na Zona B e nos títulos de `ChecklistGuardaCorpos`. |
| **UI-122** | **P3** | mundo real / formato | `Sobre` ([`Sobre.tsx#L207-L208`](../../../../front-v2/src/telas/sobre/Sobre.tsx#L207-L208)) | Abrir `/?updater-test=available#/sobre` em `1440×900` e clicar em `"Verificar atualizações"`. | Em [`20-sobre-atualizacao-atribuicoes-1440.png`](./capturas/onda-6-reav2/20-sobre-atualizacao-atribuicoes-1440.png), ao lado de `"Nova versão disponível: 1.0.0 → 0.2.0"`, o componente exibe o carimbo ISO-8601 UTC bruto `"2026-11-13T00:00:00Z"`. | Formatar `atualizador.atualizacao.date` com `Intl.DateTimeFormat('pt-BR', { dateStyle: 'short' })` (mantendo fallback caso não seja data válida). |

*(Observação lateral fora da Onda 6: em `1366×768` com a gaveta da Fila aberta de `470 px` sobre `Seleção de Cortes`, o rótulo `"Teto: 300 s"` em [`ConfiguradorSelecao.tsx`](../../../../front-v2/src/telas/cortes/ConfiguradorSelecao.tsx) quebra `"s"` em uma segunda linha — [`09`](./capturas/onda-6-reav2/09-fila-jobs-aberta-1366.png), [`11`](./capturas/onda-6-reav2/11-fila-jobs-hc-1366.png).)*

---

## 5. Inventário de capturas (`docs/produto/front-v2/ui/capturas/onda-6-reav2/`)

Total: **24 arquivos PNG** gerados por `front-v2/e2e/ui-onda6.spec.ts` (`$env:UI_BASELINE = "1"`).

| # | Arquivo | Viewport / Tema | Fluxo | O que verifica |
|---:|---|---|---:|---|
| 01 | [`01-exportacao-prontidao-1366.png`](./capturas/onda-6-reav2/01-exportacao-prontidao-1366.png) | 1366×768 · padrão | (q) | Mesa de Prontidão em `1366×768` com alvos ≥ 24 px, `h2` na Zona A e aviso `"1 Corte(s) estão..."` (**UI-121**) |
| 02 | [`02-exportacao-prontidao-1440.png`](./capturas/onda-6-reav2/02-exportacao-prontidao-1440.png) | 1440×900 · padrão | (q) | Mesa de Prontidão em 3 colunas com checklist aberto na carga inicial |
| 03 | [`03-exportacao-prontidao-hc-1366.png`](./capturas/onda-6-reav2/03-exportacao-prontidao-hc-1366.png) | 1366×768 · alto contraste | (q) | Mesa de Prontidão em `[data-contrast="high"]` sem violações de contraste |
| 04 | [`04-exportacao-aviso-direto-1366.png`](./capturas/onda-6-reav2/04-exportacao-aviso-direto-1366.png) | 1366×768 · padrão | (q) | Diálogo de Corte direto com foco inicial em `"Cancelar"` e `1` único `.bg-sinal` |
| 05 | [`05-exportacao-conflitos-dialog-1366.png`](./capturas/onda-6-reav2/05-exportacao-conflitos-dialog-1366.png) | 1366×768 · padrão | (q) | Confirmação de sobrescrita com `1` único `.bg-sinal` visível |
| 06 | [`06-exportacao-lote-progresso-1366.png`](./capturas/onda-6-reav2/06-exportacao-lote-progresso-1366.png) | 1366×768 · padrão | (q) | Lote ao vivo com Zona C sincronizada (`1/2 concluído · 62%`), encoder humano e toasts em `acima-acoes` |
| 07 | [`07-exportacao-lote-parcial-falhas-1440.png`](./capturas/onda-6-reav2/07-exportacao-lote-parcial-falhas-1440.png) | 1440×900 · padrão | (q) | Lote histórico `#6399` com `"de placa de vídeo NVIDIA: a codificação falhou"` |
| 08 | [`08-exportacao-lotes-hc-1440.png`](./capturas/onda-6-reav2/08-exportacao-lotes-hc-1440.png) | 1440×900 · alto contraste | (q) | Histórico de lotes em `[data-contrast="high"]` |
| 09 | [`09-fila-jobs-aberta-1366.png`](./capturas/onda-6-reav2/09-fila-jobs-aberta-1366.png) | 1366×768 · padrão | (r) | `PainelFilaJobs` com `"Orçamento pausou: Lote de Fontes 3"` (**UI-86**) e cards legíveis |
| 10 | [`10-fila-jobs-1440.png`](./capturas/onda-6-reav2/10-fila-jobs-1440.png) | 1440×900 · padrão | (r) | `PainelFilaJobs` acoplada em `560 px` com banner traduzido (**UI-86**) |
| 11 | [`11-fila-jobs-hc-1366.png`](./capturas/onda-6-reav2/11-fila-jobs-hc-1366.png) | 1366×768 · alto contraste | (r) | `PainelFilaJobs` em `[data-contrast="high"]` com contornos nítidos e alvos ≥ 24 px |
| 12 | [`12-fila-dialog-retry-custo-1366.png`](./capturas/onda-6-reav2/12-fila-dialog-retry-custo-1366.png) | 1366×768 · padrão | (r) | `DialogoTentarDeNovo` com foco inicial em `"Cancelar"` (**UI-82**) e `"Selecionar Cortes"` rebaixado ao fundo (**UI-84**) |
| 13 | [`13-fila-dialog-orcamento-1440.png`](./capturas/onda-6-reav2/13-fila-dialog-orcamento-1440.png) | 1440×900 · padrão | (r) | `DialogoOrcamento` com `"Lote de Fontes 3"` (**UI-86**) e `1` único `.bg-sinal` (**UI-84**) |
| 14 | [`14-fila-dialog-redo-result-1366.png`](./capturas/onda-6-reav2/14-fila-dialog-redo-result-1366.png) | 1366×768 · padrão | (r) | `DialogoRefazerJob` com `1` único `.bg-sinal` (**UI-84**) e alvos ≥ 24 px |
| 15 | [`15-fila-toast-abrir-fila-1366.png`](./capturas/onda-6-reav2/15-fila-toast-abrir-fila-1366.png) | 1366×768 · padrão | (r) | Toast `acima-acoes` (`Abrir Fila`) com botão primário livre (**UI-81**, `sobreposicaoToast: false`), cobrindo temporariamente o cabeçalho do checklist (**UI-120**) |
| 16 | [`16-relatos-passo1-segredo-1366.png`](./capturas/onda-6-reav2/16-relatos-passo1-segredo-1366.png) | 1366×768 · padrão | (s) | `#/relatos` Passo 1 com `"Placa de vídeo · precisão equilibrada (verificado)"` (**UI-86**) |
| 17 | [`17-relatos-passo2-revisao-1440.png`](./capturas/onda-6-reav2/17-relatos-passo2-revisao-1440.png) | 1440×900 · padrão | (s) | `#/relatos` Passo 2 em 60/40 com resumo humano `"precisão equilibrada"` no painel auxiliar (**UI-86**) |
| 18 | [`18-relatos-hc-1366.png`](./capturas/onda-6-reav2/18-relatos-hc-1366.png) | 1366×768 · alto contraste | (s) | `#/relatos` Passo 2 em `[data-contrast="high"]` |
| 19 | [`19-sobre-padrao-1366.png`](./capturas/onda-6-reav2/19-sobre-padrao-1366.png) | 1366×768 · padrão | (s) | `#/sobre`: versão instalada, atualizador e Licença Apache-2.0 |
| 20 | [`20-sobre-atualizacao-atribuicoes-1440.png`](./capturas/onda-6-reav2/20-sobre-atualizacao-atribuicoes-1440.png) | 1440×900 · padrão | (s) | `#/sobre` sem `"Clipe"` (`glossarioViolacoes: []`, **UI-86**) e carimbo ISO `"2026-11-13T00:00:00Z"` (**UI-122**) |
| 21 | [`21-sobre-hc-reinicio-critico-1440.png`](./capturas/onda-6-reav2/21-sobre-hc-reinicio-critico-1440.png) | 1440×900 · alto contraste | (s) | `#/sobre` em `[data-contrast="high"]` com `<ConfirmDialog>` focado em `"Reiniciar mesmo assim"` |
| 22 | [`22-estado-exportacao-vazio-1366.png`](./capturas/onda-6-reav2/22-estado-exportacao-vazio-1366.png) | 1366×768 · padrão | (t) | `#/projeto/demo/exportacao?estado=vazio` |
| 23 | [`23-estado-exportacao-erro-1366.png`](./capturas/onda-6-reav2/23-estado-exportacao-erro-1366.png) | 1366×768 · padrão | (t) | `#/projeto/demo/exportacao?estado=erro` |
| 24 | [`24-estado-fila-sem-projeto-1366.png`](./capturas/onda-6-reav2/24-estado-fila-sem-projeto-1366.png) | 1366×768 · padrão | (t) | `#/inicio` com `PainelFilaJobs` aberta e `1` único `.bg-sinal` |
