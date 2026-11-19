# Avaliação independente de UI — Onda 4 (Editor do Corte)

> ⚠️ **DEGRADED: single-context (critique + audit em sessão única, sem subagente independente nem navegador interativo manual além da suíte Playwright + axe-core; ambiente mock TS `VITE_CORE_MOCK=1`, sem Tauri).**

- **Data:** 2026-11-18
- **Commit avaliado:** `03e02b9` (`origin/master`, PR `#459`, Onda 4 `#354`–`#358`)
- **Referências:** [`DESIGN.md`](../../../../DESIGN.md), [`GLOSSARY.md`](../../../../GLOSSARY.md), [`08-plano-onda-4.md`](../08-plano-onda-4.md), [`D-corte-editar.md`](../telas/D-corte-editar.md), [`editor.html?variant=D`](../wireframes/prototipo/editor.html), [`avaliacao-onda-3.md`](./avaliacao-onda-3.md)
- **Script reproduzível:** [`front-v2/e2e/ui-onda4.spec.ts`](../../../../front-v2/e2e/ui-onda4.spec.ts) (pulado sem `UI_BASELINE=1`; reaproveita fixtures/helpers de [`e2e/corte-editar.spec.ts`](../../../../front-v2/e2e/corte-editar.spec.ts))
- **Capturas:** 24 PNGs em [`docs/produto/front-v2/ui/capturas/onda-4/`](./capturas/onda-4/)

---

## 1. Cenário executado e evidências automatizadas

### 1.1 Comandos verificados

| Verificação | Comando | Resultado observado |
|---|---|---|
| Instalação | `cd front-v2; bun install` | `152 packages installed [18.56s]`, exit `0` |
| Static UI check | `bunx impeccable detect --json front-v2/src` | `[]` (zero detecções), exit `0` |
| Contraste tokens DS | `cd design-system-v2; bun scripts/contraste.ts` | `Todos os pares passam.`, exit `0` |
| Typecheck | `cd front-v2; bun run typecheck` (`tsc --noEmit`) | Exit `0` |
| Unitários (suíte completa) | `cd front-v2; bun run test -- --maxWorkers=2` | `70 passed | 2 failed (72)` arquivos · `542 passed | 4 failed (546)` testes em `367.15s` — 4 timeouts de `5000ms` por contenção de CPU em `EditarCorte.test.tsx:628,710` e `PassoNarracao.test.tsx:837,908` |
| Unitários (arquivos isolados) | `cd front-v2; bunx vitest run src/telas/corte/EditarCorte.test.tsx src/telas/corte/transformar/PassoNarracao.test.tsx --maxWorkers=1` | `2 passed (2)` · `14 passed (14)` em `22.76s` (`1.2s–1.7s` nos 4 casos antes expirados), exit `0` |
| E2E CI padrão | `cd front-v2; bunx playwright test` (sem `UI_BASELINE`) | `30 passed`, `4 skipped` (`ui-baseline`, `ui-onda2`, `ui-onda3`, `ui-onda4`) em `35.6s`, exit `0` |
| Baseline Onda 4 + axe + DOM audit | `$env:UI_BASELINE="1"; bunx playwright test e2e/ui-onda4.spec.ts` | `1 passed (57.4s)`, `erros: []` (`0 pageerror`), 24 capturas geradas, exit `0` |

### 1.2 Auditoria transversal nas 24 capturas

- **axe-core:** `0` violações em todos os 24 estados (`1366×768` e `1440×900`, padrão e `[data-contrast="high"]`).
- **Headings / Semântica:** `h1Count = 1` e `saltoHeading` vazio em todas as 24 capturas; `semNomeAcessivel = 0`; `imagensQuebradas = 0`.
- **Overflow externo:** `0 px` de overflow horizontal ou vertical na viewport (`scrollW === innerW` e `scrollH === innerH`) nas 24 capturas.
- **Variante D (`editor.html?variant=D`):** `inspetorFixoCount = 0` (nenhum painel direito fixo); palco central com proporção `231 × 411 px` em `1366×768`; `<ContextoCorte>` sem tab `Transformar` no Corte direto.
- **Regressões detectadas na auditoria DOM + inspeção visual:** detalhadas nos achados **UI-60** a **UI-69** abaixo.

---

## 2. Notas por fluxo (Nielsen H1–H10) e Audit Impeccable

Meta do projeto: **≥ 90% por fluxo (≥ 36/40)**, **WCAG 2.2 AA** (incl. alto contraste e 2.1.4) e **zero bloqueador funcional**.

| Fluxo | H1 | H2 | H3 | H4 | H5 | H6 | H7 | H8 | H9 | H10 | Total | % | Meta (≥ 90%) |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|:---:|
| **(m)** `<ContextoCorte>` e Exportação Individual (`Ctrl+E`) | 4 | 4 | 3 | 3 | 4 | 4 | 4 | 4 | 4 | 4 | **38/40** | **95,0%** | ✅ Atendida |
| **(n)** Sub-aba Editar, Palco, Painel Esquerdo, Transporte e Timeline | 4 | 4 | 2 | 3 | 4 | 3 | 3 | 3 | 4 | 4 | **34/40** | **85,0%** | ❌ Abaixo |
| **(o)** Os 5 Popovers (`Enquadrar`, `Legenda`/Tradução, `Silêncios`, `Áudio`, `Histórico`) | 4 | 3 | 3 | 3 | 4 | 4 | 4 | 2 | 4 | 4 | **35/40** | **87,5%** | ❌ Abaixo |
| **(p)** Ciclo de vida, erros, `offline`/`changed`, `avulso-*` e vazios | 3 | 4 | 4 | 3 | 4 | 4 | 4 | 4 | 3 | 4 | **37/40** | **92,5%** | ✅ Atendida |

### Justificativa de cada heurística abaixo de 4

- **Fluxo (m):**
  - **H3 = 3:** Diálogo de exportação inicia foco em `"Fechar (Esc)"` em vez da ação/checklist principal (**UI-62**); `<span tabIndex={0}>` envolve `"Converter em Vídeo transformado"` desabilitado no cabeçalho (**UI-63**).
  - **H4 = 3:** `"Exportar Corte"` permanece `.bg-sinal` no DOM atrás do modal junto de `"Iniciar exportação"` (`botoesPrimariosSinal: 2`, **UI-66**); `?estado=erro`/`vazio` repete `"Corte #201 · Corte #201"` no cabeçalho (**UI-68**).
- **Fluxo (n):**
  - **H3 = 2:** `Shell` intercepta `F6` em fase de captura e bloqueia `EditarCorte`, impedindo alcançar `Barra de ações`, `Linha do tempo` e `Contexto do Corte` via `F6` (**UI-60**); em modo WCAG 2.1.4 `"alt"`, `Alt+I`/`Alt+O` de snap bloqueia o atalho livre `Alt+I`/`Alt+O` (**UI-64**).
  - **H4 = 3:** `<Segmentado>` `"Enquadrar na Fonte 16:9"` quebra em 2 linhas e invade a borda branca em alto contraste (**UI-67**); botão `"Ir"` no Índice do Corte mede `23.8 × 24 px` (< 24 px, **UI-63**); `<PalcoEditor>` não adapta dicas de atalho em `<Transporte>` para WCAG 2.1.4 (**UI-64**).
  - **H6 = 3:** `Transcrição` abre no início da janela `±2 min` (`Frase 28..32 · fora do Corte`, esmaecida) em vez da primeira frase do Corte (**UI-69**); comando `editor.popover.alternar` aparece sem `Ctrl+]` na Paleta (**UI-64**).
  - **H7 = 3:** Navegação rápida entre regiões por `F6` bloqueada pelo `Shell` (**UI-60**) e colisão de `Alt+I`/`Alt+O` no modo `alt` (**UI-64**).
  - **H8 = 3:** Quebra de 2 linhas em `<Segmentado>` do palco com colisão de borda no `[data-contrast="high"]` (**UI-67**).
- **Fluxo (o):**
  - **H2 = 3:** Exposição de `"Preset de estilo"`/`"preset"` (termo evitado no `GLOSSARY.md`), `"Layout: fit"` em inglês e espaçamento `"Desfazer ( 1 )"` (**UI-68**).
  - **H3 = 3:** Popovers abrem focando `"Fechar (Esc)"`, `Esc` em `PopoverEnquadrar` não devolve foco ao botão `"Enquadrar"` (**UI-62**), e `"Restaurar"` desabilitado usa `<span tabIndex={0}>` (**UI-63**).
  - **H4 = 3:** `"Baixar e continuar"` dentro de `PopoverEnquadrar` usa `bg-sinal` simultaneamente com `"Exportar Corte"` (**UI-66**).
  - **H8 = 2:** Popovers `w-[268px]` com `align="center"` e `max-h-[min(520px,var(--available-height))]` sobrepõem cabeçalho/`BarraAcoes` em `1366×768`, escondem o topo ao rolar e cortam opções horizontais (`"Narr..."`, `"Importar áudio (até 500..."`) (**UI-65**).
- **Fluxo (p):**
  - **H1 = 3 / H9 = 3:** Banner `"Falha ao salvar"` / `"Tentar novamente"` na `BarraStatus` permanece preso mesmo após `Ctrl+S` limpar o estado sem erro (**UI-61**).
  - **H4 = 3:** Botão `"Tentar novamente"` no rodapé mede `110.4 × 21.4 px` (< 24 px, **UI-61**); estado vazio renderiza dois botões `.bg-sinal` no DOM (**UI-66**); cabeçalho duplica `"Corte #201 · Corte #201"` (**UI-68**).

### Impeccable Audit (`/20`)

| Dimensão | Nota (0–4) | Síntese |
|---|---:|---|
| Contraste e Cor | 4 | `contraste.ts` 100% aprovado; alto contraste com 0 violações de texto na auditoria (`|()` na timeline é `aria-hidden`). |
| Tipografia e Hierarquia | 3 | 1 `<h1>` por tela, `0` saltos, `tabular-nums`; descontado por quebra de 2 linhas no `Segmentado` (**UI-67**) e corte de texto nos popovers (**UI-65**). |
| Layout, Espaçamento e Viewport | 3 | `0` overflow externo na viewport e Variante D fiel ao protótipo; descontado por sobreposição/clipping de popovers em `1366×768` (**UI-65**) e scroll inicial da transcrição (**UI-69**). |
| Alvos, Teclado e A11y AA | 2 | `axe = 0`, mas falham `F6` (**UI-60**), foco inicial/retorno em flutuantes (**UI-62**), `<span tabIndex={0}>` + `"Ir"` `23.8×24` (**UI-63**), `"Tentar novamente"` `110.4×21.4` (**UI-61**) e WCAG 2.1.4 (**UI-64**). |
| Sobriedade Visual (*Luz Única* / *Estado Cinza*) | 3 | Palco e estados bem calibrados; descontado por dois `bg-sinal` simultâneos (**UI-66**) e erro persistente no rodapé (**UI-61**). |
| **Total Audit Impeccable** | **15/20** | **75%** |

---

## 3. Achados (numerados a partir de `UI-60`)

| ID | Sev. | Categoria | Resumo | Local principal |
|---|---|---|---|---|
| **UI-60** | P1 | bloqueador funcional / A11y AA | `Shell` intercepta `F6` antes do `EditarCorte`, bloqueando navegação entre regiões do editor | `front-v2/src/shell/Shell.tsx:445` |
| **UI-61** | P2 | bloqueador funcional / A11y AA | Indicador `"Falha ao salvar"` + `"Tentar novamente"` (`110.4×21.4 px`) trava na `BarraStatus` após `Ctrl+S` | `front-v2/src/stores/editorCorte.ts:1191` · `Shell.tsx:560-574` |
| **UI-62** | P2 | A11y AA | `DialogoExportarCorte` e popovers abrem focando `"Fechar (Esc)"`; `Esc` no popover não devolve foco ao gatilho | `design-system-v2/src/primitivas/Flutuantes.tsx:185-192` · `Midia.tsx:233-237` |
| **UI-63** | P2 | A11y AA | `<span tabIndex={0}>` em botões desabilitados e alvo `"Ir"` de `23.8 × 24 px` (< 24 px) no Índice do Corte | `ContextoCorteConectado.tsx:450` · `PopoverHistorico.tsx:123` · `PainelEsquerdoCorte.tsx:1342` |
| **UI-64** | P2 | bloqueador funcional / A11y AA | Conflito `Alt+I`/`Alt+O` em WCAG 2.1.4 `"alt"`, tooltips fixos no `<Transporte>` e `Ctrl+]` ausente na Paleta | `atalhos.tsx:132-136` · `EditarCorte.tsx:792-797,877-945` · `PalcoEditor.tsx:920-931` |
| **UI-65** | P2 | visual | Popovers (`w-[268px]`) sobrepõem cabeçalho/barra em `1366×768` e cortam controles horizontais (`"Narr..."`, `"Importar áudio..."`) | `Midia.tsx:231-232` · `PopoverLegenda.tsx:318-323` · `PopoverAudio.tsx:395-413` |
| **UI-66** | P2 | visual | Violação da *Regra da Luz Única*: 2 botões `bg-sinal` simultâneos (`Baixar e continuar` no popover e estado vazio/modais) | `InstaladorJustInTime.tsx:585-593` · `PopoverEnquadrar.tsx:298-304` |
| **UI-67** | P2 | visual | `<Segmentado>` `"Enquadrar na Fonte 16:9"` quebra em 2 linhas em `26 px` e colide com borda em alto contraste | `PalcoEditor.tsx:674-682` · `Escolhas.tsx:121` |
| **UI-68** | P3 | texto | Glossário e strings cruas: `"Preset de estilo"`/`"preset"`, `"Layout: fit"`, `"Desfazer ( 1 )"` e `"Corte #201 · Corte #201"` | `PopoverLegenda.tsx:327-339` · `PopoverHistorico.tsx:49,61,118` · `ContextoCorteConectado.tsx:257-261` |
| **UI-69** | P3 | visual | `Transcrição` abre rolada para fora do Corte (`Frase 28..32 · fora do Corte`, opacidade 45%) em vez da 1ª frase ativa | `front-v2/src/telas/corte/PainelEsquerdoCorte.tsx` |

### Detalhamento dos achados

#### UI-60 — `Shell` intercepta `F6` em captura antes de `EditarCorte` (P1 · bloqueador funcional / A11y AA)
- **Tela / Arquivo:** `#/projeto/:id/corte/:corteId/editar` — [`front-v2/src/shell/Shell.tsx#L445`](../../../../front-v2/src/shell/Shell.tsx#L445), [`front-v2/src/telas/corte/EditarCorte.tsx#L1046`](../../../../front-v2/src/telas/corte/EditarCorte.tsx#L1046) e [`design-system-v2/src/componentes/Tela.tsx#L84-L85`](../../../../design-system-v2/src/componentes/Tela.tsx#L84-L85)
- **Passo para reproduzir:** Abrir o Editor (`#/projeto/demo/corte/102/editar`) e pressionar `F6` repetidamente para ciclar regiões (`Conteúdo`, `Linha do tempo`, `Barra de ações`, `Barra de status`, `Topo`).
- **Evidência:** O `Shell` registra `window.addEventListener('keydown', aoTeclar, { capture: true })` na frente do listener de `EditarCorte`, chamando `e.preventDefault(); e.stopPropagation(); ciclarRegiao(...)`. Além disso, `<Tela>` renderiza `{meio}` (`ContextoCorteConectado`) fora de `<BarraSuperior data-regiao="topo">` e sem `data-regiao`. Na auditoria E2E, `checksExtras.atalhosEditor.regioesF6` percorreu somente `["conteudo","rodape","topo","conteudo","rodape","topo"]`.
- **Captura:** [`01-editar-direto-1366.png`](./capturas/onda-4/01-editar-direto-1366.png)
- **Sugestão:** Remover `stopPropagation()` do listener de `F6` no `Shell` (ou consultar regiões declaradas no `<main>`/`meio` antes de ciclar apenas topo/conteúdo/rodapé) e marcar `{meio}` com `data-regiao="contexto"` quando aplicável.

#### UI-61 — `"Falha ao salvar"` e `"Tentar novamente"` (`110.4×21.4 px`) travados na `BarraStatus` após `Ctrl+S` (P2 · bloqueador funcional / A11y AA)
- **Tela / Arquivo:** Barra de status após `editor_save_failed` — [`front-v2/src/stores/editorCorte.ts#L1191`](../../../../front-v2/src/stores/editorCorte.ts#L1191) e [`front-v2/src/shell/Shell.tsx#L284-L296`](../../../../front-v2/src/shell/Shell.tsx#L284-L296), [`#L560-L574`](../../../../front-v2/src/shell/Shell.tsx#L560-L574)
- **Passo para reproduzir:** Disparar falha de salvamento na rota de erro (`?estado=erro-flush`), cancelar o diálogo de saída, retornar ao estado sem erro e pressionar `Ctrl+S`.
- **Evidência:** `executarFlush` não invoca `limparErroSalvamentoEditor()` quando o flush retorna limpo, e no mock sem `dirty` o evento `editor_saved` não é emitido. Resultado observado em `checksExtras.statusRodapeAposCtrlSLimpo`: `"Falha ao salvar\nTentar novamente\nSem jobs ativos..."`. Adicionalmente, o botão `"Tentar novamente"` mede `110.4 × 21.4 px` (< `24 px`, WCAG 2.5.8).
- **Captura:** [`18-ciclo-editor-save-failed-shell-1366.png`](./capturas/onda-4/18-ciclo-editor-save-failed-shell-1366.png)
- **Sugestão:** Limpar o estado global de erro de salvamento sempre que `executarFlush` concluir sem erro, e aumentar a altura mínima/padding do botão `"Tentar novamente"` na `BarraStatus` para `≥ 24 px`.

#### UI-62 — Foco inicial em `"Fechar (Esc)"` e retorno de foco ausente ao fechar popover com `Esc` (P2 · A11y AA)
- **Tela / Arquivo:** `DialogoExportarCorte` e Popovers da `BarraAcoes` — [`design-system-v2/src/primitivas/Flutuantes.tsx#L185-L192`](../../../../design-system-v2/src/primitivas/Flutuantes.tsx#L185-L192) e [`design-system-v2/src/componentes/Midia.tsx#L233-L237`](../../../../design-system-v2/src/componentes/Midia.tsx#L233-L237)
- **Passo para reproduzir:** (1) Pressionar `Ctrl+E` para abrir Exportar Corte e verificar `document.activeElement`; (2) Abrir `"Enquadrar"`, verificar foco inicial e pressionar `Esc`.
- **Evidência:** `<D.Close>` e `<P.Close>` (`"Fechar (Esc)"`) precedem o conteúdo no DOM sem `initialFocus`. Observado: `focoInicialExport = button "Fechar (Esc)"` (`focoRetornoExport` voltou corretamente para `"Exportar Corte Ctrl+E"`); `focoPopoverEnquadrarAbrir = button "Fechar (Esc)"` e `focoPopoverEnquadrarEsc = button "Limpar todas as edições manuais"` (não retornou ao botão `"Enquadrar"`).
- **Capturas:** [`06-exportar-corte-dialog-1366.png`](./capturas/onda-4/06-exportar-corte-dialog-1366.png), [`09-popover-enquadrar-yunet-1366.png`](./capturas/onda-4/09-popover-enquadrar-yunet-1366.png)
- **Sugestão:** Mover foco inicial para o primeiro controle de ação/conteúdo do diálogo e popover (ou posicionar o botão Fechar ao fim da ordem lógica de foco / usar `initialFocus`) e restaurar o foco no gatilho ao fechar popover por `Esc`.

#### UI-63 — `<span tabIndex={0}>` em botões desabilitados e alvo `"Ir"` < 24 px (P2 · A11y AA)
- **Tela / Arquivo:** Cabeçalho do Corte, `PopoverHistorico`, `InstaladorJustInTime` e `Índice do Corte` — [`front-v2/src/telas/corte/ContextoCorteConectado.tsx#L450`](../../../../front-v2/src/telas/corte/ContextoCorteConectado.tsx#L450), [`front-v2/src/telas/corte/popovers/PopoverHistorico.tsx#L123`](../../../../front-v2/src/telas/corte/popovers/PopoverHistorico.tsx#L123), [`front-v2/src/componentes/InstaladorJustInTime.tsx#L598`](../../../../front-v2/src/componentes/InstaladorJustInTime.tsx#L598), [`front-v2/src/telas/corte/PainelEsquerdoCorte.tsx#L1342`](../../../../front-v2/src/telas/corte/PainelEsquerdoCorte.tsx#L1342)
- **Passo para reproduzir:** Tabular pelo cabeçalho quando `"Converter em Vídeo transformado"` está desabilitado ou pelo `PopoverHistorico` quando `"Restaurar"` está desabilitado; inspecionar dimensões no `Índice do Corte` (Corte transformado).
- **Evidência:** `focusOutlineTeste` registrou `span: [2px solid rgb(255, 90, 31)]` (`m-exportar-fallback`, `p-ciclo-save-failed-shell`) e `span:Restaurar [2px solid rgb(255, 90, 31)]` (`o-popover-historico`). No `Índice do Corte`, 11 botões `"Ir"` mediram `23.8 × 24 px` (< `24 px` de largura). *(Nota: a `Agulha` da timeline em [`TimelineCorte.tsx#L936`](../../../../front-v2/src/telas/corte/TimelineCorte.tsx#L936) mede `2 px` visuais, mas declara `before:-inset-x-[11px]` para compensar a área de ponteiro.)*
- **Capturas:** [`03-editar-transformado-3faixas-1440.png`](./capturas/onda-4/03-editar-transformado-3faixas-1440.png), [`15-popover-historico-1440.png`](./capturas/onda-4/15-popover-historico-1440.png)
- **Sugestão:** Usar atributo semântico nativo no próprio botão desabilitado (`aria-disabled` + tooltip ou wrapper não focável) em vez de `<span tabIndex={0}>`, e garantir `min-w-6` (`24 px`) no botão `"Ir"` do Índice do Corte.

#### UI-64 — Lacunas WCAG 2.1.4 no Editor: conflito `Alt+I`/`Alt+O`, tooltips fixos no `<Transporte>` e `Ctrl+]` ausente na Paleta (P2 · bloqueador funcional / A11y AA)
- **Tela / Arquivo:** [`front-v2/src/comandos/atalhos.tsx#L132-L136`](../../../../front-v2/src/comandos/atalhos.tsx#L132-L136), [`front-v2/src/telas/corte/EditarCorte.tsx#L792-L797`](../../../../front-v2/src/telas/corte/EditarCorte.tsx#L792-L797), [`#L877-L945`](../../../../front-v2/src/telas/corte/EditarCorte.tsx#L877-L945), [`front-v2/src/telas/corte/PalcoEditor.tsx#L920-L931`](../../../../front-v2/src/telas/corte/PalcoEditor.tsx#L920-L931) e [`design-system-v2/src/componentes/Midia.tsx#L139-L141`](../../../../design-system-v2/src/componentes/Midia.tsx#L139-L141)
- **Passo para reproduzir:** (1) Ativar modo WCAG 2.1.4 `"alt"` (`Exigir modificador Alt + tecla`) e tentar usar `Alt+I`/`Alt+O` de quadro livre ou inspecionar tooltips de `<Transporte>`; (2) Abrir Paleta (`Ctrl+K`) e observar `"Abrir/fechar último popover da barra de ações"`.
- **Evidência:** Em modo `"alt"`, `useAtalhos` converte `I`/`O` (`teclaUnica: true`) em `Alt+I`/`Alt+O` e chama `e.preventDefault()`, interceptando o atalho de quadro livre (`free: true`) em `EditarCorte.tsx:933-945`. `<PalcoEditor>` não passa `atalhoReproduzir`/`atalhoEntrada`/`atalhoSaida` adaptados ao `<Transporte>` (`Espaço`/`I`/`O` permanecem fixos nos títulos). Na Paleta (`checksExtras.atalhosEditor.paletaPopoverTexto`), `"Abrir/fechar último popover da barra de ações"` aparece sem badge de atalho (`tecla` omitido em `EditarCorte.tsx:792-797`).
- **Captura:** [`16-ciclo-overlay-borda-alt-1366.png`](./capturas/onda-4/16-ciclo-overlay-borda-alt-1366.png)
- **Sugestão:** Não interceptar `Alt+I`/`Alt+O` livre no handler de `useAtalhos` (ex.: `Shift+Alt+I`/`O` ou prioridade), passar rótulos via `resolverTeclaExibida` para `<Transporte>` e declarar `tecla: 'Mod+]'` em `editor.popover.alternar`.

#### UI-65 — Popovers da `BarraAcoes` sobrepõem cabeçalho/barra em `1366×768` e cortam controles horizontais (P2 · visual)
- **Tela / Arquivo:** [`design-system-v2/src/componentes/Midia.tsx#L231-L232`](../../../../design-system-v2/src/componentes/Midia.tsx#L231-L232), [`front-v2/src/telas/corte/popovers/PopoverLegenda.tsx#L318-L323`](../../../../front-v2/src/telas/corte/popovers/PopoverLegenda.tsx#L318-L323), [`design-system-v2/src/primitivas/Escolhas.tsx#L121`](../../../../design-system-v2/src/primitivas/Escolhas.tsx#L121) e [`front-v2/src/telas/corte/popovers/PopoverAudio.tsx#L395-L413`](../../../../front-v2/src/telas/corte/popovers/PopoverAudio.tsx#L395-L413)
- **Passo para reproduzir:** Em `1366×768`, abrir `Enquadrar`, `Legenda` ou `Áudio` na `BarraAcoes`.
- **Evidência:** `<P.Positioner side="right" align="center">` com `w-[268px]` e `max-h-[min(520px,var(--available-height))]` centrado sobre o palco (`h=411 px`) invade o `<ContextoCorte>` superior e a `BarraAcoes` inferior, além de rolar ocultando o cabeçalho do próprio popover. Internamente, o `<Segmentado>` de 4 itens (`Automático | Original | Traduzida | Narração`) corta `"Narr..."` na direita, e a linha `flex` de `PopoverAudio` corta `"Importar áudio (até 500..."`.
- **Capturas:** [`09-popover-enquadrar-yunet-1366.png`](./capturas/onda-4/09-popover-enquadrar-yunet-1366.png), [`11-popover-legenda-estilo-1366.png`](./capturas/onda-4/11-popover-legenda-estilo-1366.png), [`14-popover-audio-ccby-1366.png`](./capturas/onda-4/14-popover-audio-ccby-1366.png)
- **Sugestão:** Fixar cabeçalho do popover fora da área rolável, restringir `max-h` à área disponível entre cabeçalho e timeline (`collisionBoundary`), alargar para `296–320 px` ou empilhar os controles de `Legenda` (2×2 / select) e `Áudio` (botão em linha própria).

#### UI-66 — Violação da *Regra da Luz Única*: dois botões `bg-sinal` simultâneos (P2 · visual)
- **Tela / Arquivo:** [`front-v2/src/componentes/InstaladorJustInTime.tsx#L585-L593`](../../../../front-v2/src/componentes/InstaladorJustInTime.tsx#L585-L593), [`front-v2/src/telas/corte/popovers/PopoverEnquadrar.tsx#L298-L304`](../../../../front-v2/src/telas/corte/popovers/PopoverEnquadrar.tsx#L298-L304) e estado vazio de `EditarCorte`
- **Passo para reproduzir:** Abrir `PopoverEnquadrar` sem `yunet` instalado; ou abrir `#/projeto/demo/corte/201/editar?estado=vazio`.
- **Evidência:** `botoesPrimariosSinal = 2` (`["Exportar CorteCtrl+E", "Baixar e continuar"]` em `o-popover-enquadrar-yunet`, `o-popover-enquadrar-limpar`, `o-editar-hc-popover`; `["Exportar CorteCtrl+E", "Voltar para Cortes"]` em `p-estado-vazio-editar`). Nos modais (`m-exportar-dialog`, `o-popover-legenda-traducao-custo`, `p-ciclo-erro-flush-saida`), o botão primário do cabeçalho também permanece com classe `.bg-sinal` visível atrás do véu.
- **Capturas:** [`09-popover-enquadrar-yunet-1366.png`](./capturas/onda-4/09-popover-enquadrar-yunet-1366.png), [`23-estado-vazio-editar-1366.png`](./capturas/onda-4/23-estado-vazio-editar-1366.png), [`24-estado-editar-hc-popover-1440.png`](./capturas/onda-4/24-estado-editar-hc-popover-1440.png)
- **Sugestão:** Usar `variante="secundario"` em `"Baixar e continuar"` quando `modo="inline"` dentro de popovers do Editor, e ocultar ou rebaixar `"Exportar Corte"` quando em `?estado=vazio`.

#### UI-67 — `<Segmentado>` `"Enquadrar na Fonte 16:9"` quebra em 2 linhas e invade borda em alto contraste (P2 · visual)
- **Tela / Arquivo:** [`front-v2/src/telas/corte/PalcoEditor.tsx#L674-L682`](../../../../front-v2/src/telas/corte/PalcoEditor.tsx#L674-L682) e [`design-system-v2/src/primitivas/Escolhas.tsx#L121`](../../../../design-system-v2/src/primitivas/Escolhas.tsx#L121)
- **Passo para reproduzir:** Abrir `#/projeto/demo/corte/102/editar` em `1366×768` (especialmente com `[data-contrast="high"]`).
- **Evidência:** A opção `"Enquadrar na Fonte 16:9"` dentro de altura fixa `h-6.5` (`26 px`) e `flex-1` quebra para `"Enquadrar na"` / `"Fonte 16:9"`, ultrapassando a altura interna e tocando a borda branca de alto contraste.
- **Capturas:** [`01-editar-direto-1366.png`](./capturas/onda-4/01-editar-direto-1366.png), [`05-editar-hc-1366.png`](./capturas/onda-4/05-editar-hc-1366.png), [`24-estado-editar-hc-popover-1440.png`](./capturas/onda-4/24-estado-editar-hc-popover-1440.png)
- **Sugestão:** Adicionar `whitespace-nowrap`, ajustar `min-h-7`/`px-2.5` ou abreviar para `"Fonte 16:9"` com `aria-label="Enquadrar na Fonte 16:9"`.

#### UI-68 — Glossário e textos crus: `"preset"`, `"Layout: fit"`, `"Desfazer ( 1 )"` e cabeçalho duplicado (P3 · texto)
- **Tela / Arquivo:** [`front-v2/src/telas/corte/popovers/PopoverLegenda.tsx#L327-L339`](../../../../front-v2/src/telas/corte/popovers/PopoverLegenda.tsx#L327-L339), [`front-v2/src/telas/corte/popovers/PopoverHistorico.tsx#L49`](../../../../front-v2/src/telas/corte/popovers/PopoverHistorico.tsx#L49), [`#L61`](../../../../front-v2/src/telas/corte/popovers/PopoverHistorico.tsx#L61), [`#L118`](../../../../front-v2/src/telas/corte/popovers/PopoverHistorico.tsx#L118) e [`front-v2/src/telas/corte/ContextoCorteConectado.tsx#L257-L261`](../../../../front-v2/src/telas/corte/ContextoCorteConectado.tsx#L257-L261)
- **Passo para reproduzir:** Abrir `PopoverLegenda`, `PopoverHistorico` após alteração de layout e `?estado=erro` / `?estado=vazio`.
- **Evidência:** `glossarioViolacoes` acusou `preset: Preset, preset` em `o-popover-legenda-estilo` e `o-popover-legenda-traducao-custo` (`GLOSSARY.md` veta `preset`). `PopoverHistorico` exibe `"Layout: fit"` (chave técnica em inglês) e `"Desfazer ( 1 )"` / `"Refazer ( 0 )"`. No cabeçalho em `?estado=erro`/`vazio`, lê-se `"Corte #201 · Corte #201"`.
- **Capturas:** [`11-popover-legenda-estilo-1366.png`](./capturas/onda-4/11-popover-legenda-estilo-1366.png), [`15-popover-historico-1440.png`](./capturas/onda-4/15-popover-historico-1440.png), [`22-estado-erro-fatal-1366.png`](./capturas/onda-4/22-estado-erro-fatal-1366.png), [`23-estado-vazio-editar-1366.png`](./capturas/onda-4/23-estado-vazio-editar-1366.png)
- **Sugestão:** Trocar `"Preset de estilo"` por `"Estilo da legenda"`/`"Perfil de estilo"`, mapear `fit`/`face`/etc. em `PopoverHistorico` com o mesmo dicionário PT-BR de `PopoverEnquadrar`, remover espaços dentro dos parênteses e evitar duplicar `#id` quando o título de fallback já contém o número do Corte.

#### UI-69 — `Transcrição` abre fora da faixa do Corte (`Frase 28..32`) sem rolar para a primeira frase ativa (P3 · visual)
- **Tela / Arquivo:** [`front-v2/src/telas/corte/PainelEsquerdoCorte.tsx`](../../../../front-v2/src/telas/corte/PainelEsquerdoCorte.tsx)
- **Passo para reproduzir:** Abrir `#/projeto/demo/corte/102/editar` ou Corte `202` (offline).
- **Evidência:** O painel `Transcrição` exibe o início da janela de contexto `±2 min` (`Frase 28..32 · fora do Corte`, todas em `opacity-45`), obrigando rolagem manual para visualizar o texto efetivo do Corte.
- **Capturas:** [`01-editar-direto-1366.png`](./capturas/onda-4/01-editar-direto-1366.png), [`20-estado-fonte-offline-1366.png`](./capturas/onda-4/20-estado-fonte-offline-1366.png)
- **Sugestão:** Rolar automaticamente a lista na abertura inicial até a primeira frase dentro do intervalo `[startUs, endUs]` do Corte (mantendo as frases `±2 min` acima acessíveis ao rolar para cima).

---

## 4. Inventário de capturas (`docs/produto/front-v2/ui/capturas/onda-4/`)

| # | Arquivo | Viewport / Tema | Fluxo | O que verifica |
|---:|---|---|---:|---|
| 01 | `01-editar-direto-1366.png` | 1366×768 · padrão | (n) | Abertura do Corte direto (`102`), Variante D (sem painel direito fixo), 2 faixas |
| 02 | `02-editar-recolhido-indice-1366.png` | 1366×768 · padrão | (n) | Painel esquerdo recolhido (`Ctrl+[`), reabertura na aba `Índice do Corte` |
| 03 | `03-editar-transformado-3faixas-1440.png` | 1440×900 · padrão | (n) | Corte transformado (`101`) com `+3 faixas` (5 faixas visíveis) e `Índice do Corte` |
| 04 | `04-editar-fonte-16-9-crop-1366.png` | 1366×768 · padrão | (n) | Modo `Enquadrar na Fonte 16:9` com recorte 9:16 e atalhos `I`/`O` |
| 05 | `05-editar-hc-1366.png` | 1366×768 · alto contraste | (n) | `[data-contrast="high"]` no Editor (`[2px solid white]` e bordas de UI) |
| 06 | `06-exportar-corte-dialog-1366.png` | 1366×768 · padrão | (m) | Diálogo `Exportar Corte` (`Ctrl+E`), checklist pré-exportação e destino |
| 07 | `07-exportar-fallback-cpu-1440.png` | 1440×900 · padrão | (m) | Conclusão de exportação com aviso `encoder_fallback` (CPU) |
| 08 | `08-exportar-hc-1366.png` | 1366×768 · alto contraste | (m) | Diálogo `Exportar Corte` em `[data-contrast="high"]` |
| 09 | `09-popover-enquadrar-yunet-1366.png` | 1366×768 · padrão | (o) | `PopoverEnquadrar` com estado `yunet` ausente (`InstaladorJustInTime inline`) |
| 10 | `10-popover-enquadrar-limpar-dialog-1440.png` | 1440×900 · padrão | (o) | Confirmação `"Limpar todas as edições manuais"` no `PopoverEnquadrar` |
| 11 | `11-popover-legenda-estilo-1366.png` | 1366×768 · padrão | (o) | `PopoverLegenda` (abas de estilo/fonte/posição/tradução) |
| 12 | `12-popover-legenda-traducao-custo-1440.png` | 1440×900 · padrão | (o) | Confirmação de custo/privacidade antes de `Traduzir Corte` |
| 13 | `13-popover-silencios-1366.png` | 1366×768 · padrão | (o) | `PopoverSilencios` (limiar `ms`, prévia e autosave) |
| 14 | `14-popover-audio-ccby-1366.png` | 1366×768 · padrão | (o) | `PopoverAudio` (músicas/SFX, créditos CC-BY e controles de volume/ducking) |
| 15 | `15-popover-historico-1440.png` | 1440×900 · padrão | (o) | `PopoverHistorico` (`Desfazer`/`Refazer` e restauração) |
| 16 | `16-ciclo-overlay-borda-alt-1366.png` | 1366×768 · padrão | (n)/(p) | Atalhos no palco, borda `I`/`O` e comportamento WCAG 2.1.4 `"alt"` |
| 17 | `17-ciclo-erro-flush-saida-1366.png` | 1366×768 · padrão | (p) | Guarda de saída após `editor_save_failed` com diálogo de 3 ações |
| 18 | `18-ciclo-editor-save-failed-shell-1366.png` | 1366×768 · padrão | (p) | Estado de erro na `BarraStatus` (`Falha ao salvar` / `Tentar novamente`) |
| 19 | `19-estado-guarda-entrada-toast-1366.png` | 1366×768 · padrão | (p) | Guarda de entrada: Corte inválido redireciona para `#/projeto/:id/cortes` com toast |
| 20 | `20-estado-fonte-offline-1366.png` | 1366×768 · padrão | (p) | Fonte `offline`: banner somente leitura + botão `Relocalizar Fonte` |
| 21 | `21-estado-corte-avulso-v1-1440.png` | 1440×900 · padrão | (p) | Corte V1 avulso (`avulso-4-10-14`) preservando leitura e navegação |
| 22 | `22-estado-erro-fatal-1366.png` | 1366×768 · padrão | (p) | Estado `?estado=erro` com alerta e recuperação |
| 23 | `23-estado-vazio-editar-1366.png` | 1366×768 · padrão | (p) | Estado `?estado=vazio` com ação de retorno para `Cortes` |
| 24 | `24-estado-editar-hc-popover-1440.png` | 1440×900 · alto contraste | (o)/(p) | `EditarCorte` + popover aberto em `1440×900` com `[data-contrast="high"]` |
