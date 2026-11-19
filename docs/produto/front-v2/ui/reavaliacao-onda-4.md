# Reavaliação Independente de UI — Onda 4: Editor do Corte (`front-v2`)

> ⚠️ **DEGRADED: single-context (critique + audit em sessão única com sub-checagens isoladas em Playwright, sem subagente separado nem navegador manual além da suíte E2E + auditoria DOM + `impeccable detect`; ambiente mock TS `VITE_CORE_MOCK=1`, sem Tauri).**

- **Data da avaliação:** 2026-11-18
- **Commit avaliado (`HEAD`):** `fcd857b` (`fix(front-v2): corrige achados UI-60 a UI-69 da avaliação da Onda 4 (#465) (#473)`)
- **Linha de base comparada:** `c4aafdb` / `03e02b9` ([avaliacao-onda-4.md](./avaliacao-onda-4.md))
- **Entregas incorporadas desde a linha de base:** `#473` / `#465` (`fcd857b`, correções de `UI-60` a `UI-69`), além de `#461` (Painel da Fila), `#469` (`3f0c512`), `#470` (`bb3716d`) e `#471` (`d370c0b`).
- **Escopo:** Onda 4 — Editor do Corte (`#/projeto/:id/corte/:corteId/editar`): Fluxo **(m)** `<ContextoCorte>` e Exportação Individual (`Ctrl+E`), Fluxo **(n)** Sub-aba Editar, Palco, Painel Esquerdo, Transporte e Timeline, Fluxo **(o)** Os 5 Popovers (`Enquadrar`, `Legenda`/Tradução, `Silêncios`, `Áudio`, `Histórico`), Fluxo **(p)** Ciclo de vida, erros, `offline`/`changed`, `avulso-*` e vazios, além da conferência de `F6` do `Shell` fora do Editor (`Início`, `Fontes`, `Cortes`, `Exportação`). Papel exclusivamente avaliador — nenhuma tela ou script de teste foi alterado neste PR.
- **Capturas:** 24 PNGs em [`docs/produto/front-v2/ui/capturas/onda-4-reav/`](./capturas/onda-4-reav/)

---

## 1. Cenário reproduzido e evidências automatizadas

O cenário fixo da linha de base foi executado integralmente e sem alterações em [`front-v2/e2e/ui-onda4.spec.ts`](../../../../front-v2/e2e/ui-onda4.spec.ts) com `VITE_CORE_MOCK=1`, nos viewports `1366×768` e `1440×900`, tema escuro padrão e modo de alto contraste (`[data-contrast="high"]`). As capturas geradas foram movidas para `docs/produto/front-v2/ui/capturas/onda-4-reav/` e as originais de `onda-4/` foram restauradas com `git checkout`.

### 1.1 Comandos verificados

| Verificação | Comando | Resultado observado |
|---|---|---|
| Instalação | `cd front-v2 && bun install` | `152 packages installed [19.83s]`, exit `0` |
| Static UI check | `bunx impeccable detect --json front-v2/src` | `[]` (zero detecções), exit `0` |
| Contraste tokens DS | `cd design-system-v2 && bun scripts/contraste.ts` | `Todos os pares passam.` (escuro, claro, escuro `[data-contrast="high"]`, claro `[data-contrast="high"]`), exit `0` |
| Typecheck | `cd front-v2 && bun run typecheck` | `tsc --noEmit` limpo, exit `0` |
| Unitários (suíte completa) | `cd front-v2 && bun run test -- --maxWorkers=2` | **`79 passed (79)`** arquivos · **`625 passed (625)`** testes em `366.79s`, exit `0` |
| E2E CI padrão | `cd front-v2 && bunx playwright test` (sem `UI_BASELINE`) | **`35 passed`**, **`4 skipped`** (`ui-baseline`, `ui-onda2`, `ui-onda3`, `ui-onda4`) em `50.3s`, exit `0` |
| Reavaliação Onda 4 + DOM audit | `$env:UI_BASELINE = "1"; bunx playwright test e2e/ui-onda4.spec.ts` | **`1 passed (41.7s)`**, `erros: []` (`0 pageerror`), 24 capturas geradas, exit `0` |

### 1.2 Síntese das verificações transversais nas 24 capturas

- **Contraste WCAG 2.2 AA:** `0` violações de texto abaixo de `4,5:1` (`3:1` texto grande) em todas as 24 capturas, inclusive em `[data-contrast="high"]` (`05`, `08`, `24`). *(O único item reportado pelo auditor é o separador decorativo `|` com `aria-hidden="true"` na barra de ferramentas da timeline, já conhecido da linha de base e sem impacto em AA.)*
- **Headings e semântica:** `h1Count = 1`, `saltoHeading = null`, `semNomeAcessivel = 0`, `imagensQuebradas = 0` e `ticketRefsVisiveis = []` em todos os 24 estados.
- **Overflow externo e tabelas:** `0 px` de overflow horizontal ou vertical na viewport (`scrollW === innerW` e `scrollH === innerH`) e `overflowTabelasInternas = 0` nas 24 capturas. *(Há overflow visual interno no diálogo `07-exportar-fallback-cpu-1440.png`, registrado em **UI-71**.)*
- **Alvos ≥ 24 px (WCAG 2.5.8):** `"Ir"` no `Índice do Corte` (`≥ 24 px`, **UI-63**) e `"Tentar novamente"` na `BarraStatus` (`≥ 24 px`, **UI-61**) foram corrigidos; permanece **1 alvo recorrente `< 24 px`**: o botão de job ativo `"Onda e miniaturas 42%"` na `BarraStatus` (`159.2 × 21.4 px` em todas as 24 capturas, **UI-70**). *(A `Agulha` `2 × 86 px` usa `before:-inset-x-[11px]` para compensar a área de ponteiro para `24 px`.)*
- **Glossário e `GLOSSARY.md`:** `glossarioViolacoes = []` em todos os 24 estados (**UI-68**).
- **`F6` fora do Editor (`Shell`):** Verificado ao vivo no mock (`1366×768`) com `F6` e `Shift+F6` em todas as rotas solicitadas:
  - **Início (`#/inicio`):** `topo → conteudo → rodape → topo` (reverso `rodape → conteudo → topo → rodape`).
  - **Fontes (`#/projeto/demo/fontes`):** `topo → conteudo → rodape → topo` (reverso `rodape → conteudo → topo → rodape`).
  - **Cortes (`#/projeto/demo/cortes`):** cicla as 4 regiões próprias (`Topo → Configurador → Acompanhamento → Rodapé`) nos dois sentidos sem regressão.
  - **Exportação (`#/projeto/demo/exportacao`):** cicla as 5 regiões próprias (`Topo → Sub-barra → Zona esquerda → Zona direita → Rodapé`) nos dois sentidos sem regressão.
- **WCAG 2.1.4 no Editor (`"alt"`):** Verificado ao vivo que `Shift+Alt+I` marca Entrada encaixada em Frase (`50 s`) enquanto `Alt+I` marca Entrada livre por quadro (`49 s`), sem conflito (**UI-64**).

---

## 2. Notas por fluxo (Nielsen H1–H10) e Audit Impeccable

Meta do projeto: **≥ 90% por fluxo (≥ 36/40)**, **WCAG 2.2 AA** (incl. alto contraste e 2.1.4) e **zero bloqueador funcional**.
Legenda: **H1** Visibilidade de estado · **H2** Mundo real / vocabulário · **H3** Controle e liberdade · **H4** Consistência e padrões · **H5** Prevenção de erros · **H6** Reconhecimento vs. lembrança · **H7** Flexibilidade e atalhos · **H8** Estética e minimalismo · **H9** Recuperação de erros · **H10** Ajuda e documentação.

| Fluxo | H1 | H2 | H3 | H4 | H5 | H6 | H7 | H8 | H9 | H10 | Original (`c4aafdb`) | Agora (`fcd857b`) | Delta | % Agora | Meta (≥ 90%) |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|:---:|
| **(m)** `<ContextoCorte>` e Exportação Individual (`Ctrl+E`) | 4 | 4 | 4 | 4 | 4 | 4 | 4 | 3 | 4 | 4 | 38/40 (95,0%) | **39/40** | **+1 (+2,5 p.p.)** | **97,5%** | ✅ Atendida |
| **(n)** Sub-aba Editar, Palco, Painel Esquerdo, Transporte e Timeline | 4 | 4 | 4 | 4 | 4 | 4 | 3 | 4 | 4 | 4 | 34/40 (85,0%) | **39/40** | **+5 (+12,5 p.p.)** | **97,5%** | ✅ Atendida |
| **(o)** Os 5 Popovers (`Enquadrar`, `Legenda`/Tradução, `Silêncios`, `Áudio`, `Histórico`) | 4 | 4 | 4 | 4 | 4 | 4 | 4 | 3 | 4 | 4 | 35/40 (87,5%) | **39/40** | **+4 (+10,0 p.p.)** | **97,5%** | ✅ Atendida |
| **(p)** Ciclo de vida, erros, `offline`/`changed`, `avulso-*` e vazios | 4 | 4 | 4 | 3 | 4 | 4 | 4 | 4 | 4 | 4 | 37/40 (92,5%) | **39/40** | **+2 (+5,0 p.p.)** | **97,5%** | ✅ Atendida |

> **Nota sobre WCAG 2.2 AA:** Zero bloqueadores funcionais (`P0`/`P1`). Todos os 4 fluxos superam `90%` (`97,5%`), porém a conformidade integral de **WCAG 2.2 AA (SC 2.5.8)** fica condicionada à correção do alvo `< 24 px` no botão de job ativo da `BarraStatus` (**UI-70**, `159.2 × 21.4 px`).

### Justificativa de cada heurística que mudou (ou permaneceu < 4)

- **Fluxo (m) · `38/40 → 39/40` (+1 pt / +2,5 p.p.):**
  - **H3 (`3 → 4`, +1):** `DialogoExportarCorte` inicia foco em `"Cancelar"` (`focoInicialExport = button:Cancelar`) e devolve foco a `"Exportar Corte"` (**UI-62**); `<span tabIndex={0}>` foi removido de `"Converter em Vídeo transformado"` (**UI-63**).
  - **H4 (`3 → 4`, +1):** Cabeçalho em `?estado=erro`/`?estado=vazio` corrige `"Corte #201 · Corte #201"` para `"Corte 201"` (**UI-68**); contagem `botoesPrimariosSinal: 2` atrás do `veu` modal decorre apenas da permanência do botão da barra atrás do backdrop escuro (`06`, `08`), consistente com a Onda 3.
  - **H8 (`4 → 3`, -1):** Em [`07-exportar-fallback-cpu-1440.png`](./capturas/onda-4-reav/07-exportar-fallback-cpu-1440.png), o aviso de fallback de encoder (`DialogoExportarCorte.tsx:901` via `<Status tom="aviso">` com `whitespace-nowrap`) não quebra linha e extravasa a borda direita do cartão interno e do diálogo (**UI-71**).

- **Fluxo (n) · `34/40 → 39/40` (+5 pts / +12,5 p.p.):**
  - **H3 (`2 → 4`, +2):** `Shell` passa a respeitar `[data-f6-proprio]`, liberando `F6` / `Shift+F6` no Editor para percorrer `painel-esquerdo → palco → popover-editor → timeline → rodape → topo` (**UI-60**); modo WCAG 2.1.4 `"alt"` usa `Shift+Alt+I`/`Shift+Alt+O` para encaixe em Frase e mantém `Alt+I`/`Alt+O` livre por quadro (**UI-64**).
  - **H4 (`3 → 4`, +1):** `<Segmentado>` `"Enquadrar na Fonte 16:9"` fica em 1 linha sem colidir com a borda branca em `[data-contrast="high"]` (`01`, `05`, **UI-67**); `"Ir"` no Índice do Corte agora tem `min-w-6` (`≥ 24 px`, `03`, **UI-63**); `<PalcoEditor>` repassa atalhos adaptados (`Alt+Espaço`, `Shift+Alt+I`/`O`) ao `<Transporte>` (**UI-64**).
  - **H6 (`3 → 4`, +1):** `Transcrição` abre rolada para a 1ª frase dentro do Corte (`Frase 40` em `01`, `Frase 10` em `09`, **UI-69**), e `Ctrl+]` aparece na Paleta para `editor.popover.alternar` (**UI-64**).
  - **H7 (`3 → 3`, 0):** `F6` agora alcança as áreas internas do Editor e a convivência `Shift+Alt+I/O` vs `Alt+I/O` resolveu o bloqueio de teclado (**UI-60**, **UI-64**); permanece em `3` porque `EditarCorte.tsx:1007,1016` mapeia `[data-regiao="contexto"]` para `topo` em vez de incluí-lo como parada própria do ciclo `F6` (**UI-72**).
  - **H8 (`3 → 4`, +1):** Quebra de 2 linhas e colisão de borda no `<Segmentado>` do palco eliminadas (`01`, `04`, `05`, **UI-67**).

- **Fluxo (o) · `35/40 → 39/40` (+4 pts / +10,0 p.p.):**
  - **H2 (`3 → 4`, +1):** `"Preset de estilo"` corrigido para `"Estilo da legenda"` (`11`), `"Layout: Fit / Centro"` traduzido e espaçamento `"Desfazer (1)"` / `"Refazer (0)"` ajustado (`15`, **UI-68**); `glossarioViolacoes = []` em todas as capturas.
  - **H3 (`3 → 4`, +1):** Popover abre focando o primeiro controle útil do conteúdo (`"Rosto (9:16)"` em `Enquadrar`), `Esc` restaura o foco ao gatilho `"Enquadrar"` (**UI-62**), e `<span tabIndex={0}>` foi removido de `"Restaurar"` (`15`, **UI-63**).
  - **H4 (`3 → 4`, +1):** `"Baixar e continuar"` dentro de `PopoverEnquadrar` passou a `variante="secundario"` (`botoesPrimariosSinal = 1` em `09`, `10`, `24`, **UI-66**).
  - **H8 (`2 → 3`, +1):** Popovers alargados para `308 px` com `collisionBoundary` e cabeçalho fixo fora da área rolável eliminam sobreposição sobre `<ContextoCorte>`/`BarraAcoes` (`09`, `11`, `13`, `24`) e o corte de `"Narr..."` e `"Importar áudio"` (**UI-65**). Mantém `3` apenas porque, ao focar `"Atribuição"` com erro de validação em [`14-popover-audio-ccby-1366.png`](./capturas/onda-4-reav/14-popover-audio-ccby-1366.png), os botões finais `"Cancelar"`/`"Confirmar importação"` ficam parcialmente cortados na base da rolagem do popover.

- **Fluxo (p) · `37/40 → 39/40` (+2 pts / +5,0 p.p.):**
  - **H1 (`3 → 4`, +1):** `Ctrl+S` com estado limpo agora limpa `"Falha ao salvar"` na `BarraStatus`, retornando a `"Salvo"` (**UI-61**).
  - **H4 (`3 → 3`, 0):** `"Tentar novamente"` foi ajustado para `min-h-6` (`≥ 24 px`, `18`, **UI-61**), `?estado=vazio` usa `"Exportar Corte"` como `secundario` (`23`, `botoesPrimariosSinal = 1`, **UI-66**) e o cabeçalho exibe `"Corte 201"` sem duplicação (**UI-68**). Permanece em `3` porque o botão irmão de job na `BarraStatus` (`"Onda e miniaturas 42%"`, `Shell.tsx:773,786`) ainda mede `159.2 × 21.4 px` (`< 24 px`, WCAG 2.5.8, **UI-70**).
  - **H9 (`3 → 4`, +1):** Recuperação pós-`editor_save_failed` via `Ctrl+S` limpo ou `"Tentar novamente"` limpa consistentemente o estado global de erro (**UI-61**).

### Impeccable Audit (`/20`)

| Dimensão | Original | Agora | Delta | Síntese |
|---|---:|---:|---:|---|
| Contraste e Cor | 4 | **4** | **0** | `contraste.ts` 100% aprovado nos 4 modos; `0` violações de texto nas 24 capturas (`|()` na timeline continua `aria-hidden`). |
| Tipografia e Hierarquia | 3 | **4** | **+1** | `1` `<h1>` por tela, `0` saltos, `num` tabular, `<Segmentado>` em 1 linha (**UI-67**), popovers `308 px` legíveis (**UI-65**) e glossário limpo (**UI-68**). |
| Layout, Espaçamento e Viewport | 3 | **3** | **0** | `0` overflow externo, popovers contidos com `collisionBoundary` (**UI-65**) e transcrição rolada para a 1ª frase ativa (**UI-69**); cai 1 ponto pelo overflow do aviso `<Status tom="aviso">` no diálogo de exportação com fallback de CPU (**UI-71**). |
| Alvos, Teclado e A11y AA | 2 | **3** | **+1** | `F6` do Editor e do Shell corrigidos (**UI-60**), foco inicial/retorno em flutuantes (**UI-62**), fim de `<span tabIndex={0}>` + `"Ir"` `≥ 24 px` (**UI-63**), WCAG 2.1.4 com `Shift+Alt+I/O` + tooltips `<Transporte>` + `Ctrl+]` na Paleta (**UI-64**), `"Tentar novamente"` `≥ 24 px` (**UI-61**); perde 1 ponto pelo alvo `< 24 px` em `"Onda e miniaturas 42%"` na `BarraStatus` (**UI-70**) e omissão de `contexto` como parada própria no `F6` do Editor (**UI-72**). |
| Sobriedade Visual (*Luz Única* / *Estado Cinza*) | 3 | **4** | **+1** | *Regra da Luz Única* restaurada em `PopoverEnquadrar` e `?estado=vazio` (**UI-66**); erro persistente no rodapé resolvido (**UI-61**). |
| **Total Audit Impeccable** | **15/20** *(75%)* | **18/20** *(90%)* | **+3 (+15 p.p.)** | **Meta de ≥ 90% atendida em todos os fluxos, zero bloqueadores; 2 achados P2 (`UI-70`, `UI-71`) e 1 achado P3 (`UI-72`).** |

---

## 3. Status dos achados da linha de base (`UI-60` a `UI-69`)

| ID | Sev. | Resumo na linha de base | Status | Evidência na reavaliação (captura / passo / código) |
|---|---|---|---|---|
| **UI-60** | **P1** | `Shell` interceptava `F6` antes do `EditarCorte`, bloqueando regiões do Editor | **Resolvido** | `Shell.tsx:518` passa a checar `if (mainRef.current?.querySelector('[data-f6-proprio]')) return`; `EditarCorte.tsx:985-1063` cicla `["painel-esquerdo", "palco", "popover-editor", "timeline", "rodape", "topo"]` (`checksExtras.atalhosEditor.regioesF6`). `F6` fora do Editor (`Início`, `Fontes`, `Cortes`, `Exportação`) segue íntegro. *(Detalhe menor sobre `contexto` registrado em **UI-72**.)* |
| **UI-61** | **P2** | `"Falha ao salvar"` e `"Tentar novamente"` (`110.4×21.4 px`) travavam na `BarraStatus` após `Ctrl+S` | **Resolvido** | `EditarCorte.tsx:806` + `editorCorte.ts` chamam `limparErroSalvamentoEditor(fila)` quando `salvarAgora()` conclui limpo (`checksExtras.statusRodapeAposCtrlSLimpo` retorna `"Salvo..."`). `Shell.tsx:655` adiciona `min-h-6` em `"Tentar novamente"` (ausente de `alvosMenores24` em `p-ciclo-save-failed-shell`, [`18-ciclo-editor-save-failed-shell-1366.png`](./capturas/onda-4-reav/18-ciclo-editor-save-failed-shell-1366.png)). *(Botão vizinho de job na `BarraStatus` herdou a altura de `21.4 px`: ver **UI-70**.)* |
| **UI-62** | **P2** | Foco inicial em `"Fechar (Esc)"` e retorno de foco ausente ao fechar popover por `Esc` | **Resolvido** | `Midia.tsx:272-273` + `Flutuantes.tsx` configuram `initialFocus`/`finalFocus` no primeiro controle do conteúdo e retorno ao gatilho. Comprovado em `checksExtras`: `focoInicialExport = button:Cancelar`, `focoRetornoExport = button:Exportar CorteCtrl+E`, `focoPopoverEnquadrarAbrir = button:Rosto (9:16)` e `focoPopoverEnquadrarEsc = button:Enquadrar` ([`06-exportar-corte-dialog-1366.png`](./capturas/onda-4-reav/06-exportar-corte-dialog-1366.png), [`09-popover-enquadrar-yunet-1366.png`](./capturas/onda-4-reav/09-popover-enquadrar-yunet-1366.png)). |
| **UI-63** | **P2** | `<span tabIndex={0}>` em botões desabilitados e alvo `"Ir"` de `23.8×24 px` | **Resolvido** | `ContextoCorteConectado.tsx:461`, `PopoverHistorico.tsx:135` e `InstaladorJustInTime.tsx:600` removeram `tabIndex={0}` do `<span>` (`checksExtras.spanTabIndexContexto = []`). `PainelEsquerdoCorte.tsx:1379` adicionou `min-w-6` em `"Ir"` (`0` ocorrências de `"Ir"` em `alvosMenores24` de [`03-editar-transformado-3faixas-1440.png`](./capturas/onda-4-reav/03-editar-transformado-3faixas-1440.png)). |
| **UI-64** | **P2** | Conflito `Alt+I`/`Alt+O` no modo WCAG 2.1.4 `"alt"`, tooltips fixos no `<Transporte>` e `Ctrl+]` ausente na Paleta | **Resolvido** | `atalhos.tsx:89-90,140` + `EditarCorte.tsx:885,894` adotam `teclaModoAlt: 'Shift+Alt+I'` / `'Shift+Alt+O'` para encaixe em Frase e preservam `Alt+I`/`Alt+O` livre por quadro (verificado ao vivo: `Shift+Alt+I` manteve `50 s`, `Alt+I` moveu para `49 s`). `PalcoEditor.tsx:212-225,948-950` adapta tooltips do `<Transporte>` (`Alt+Espaço`, `Shift+Alt+I`/`O`). `EditarCorte.tsx:795` declara `tecla: 'Mod+]'` (`checksExtras.atalhosEditor.paletaPopoverTexto` exibe `Ctrl+]`). |
| **UI-65** | **P2** | Popovers (`w-[268px]`) sobrepunham cabeçalho/barra em `1366×768` e cortavam controles | **Resolvido** | `Midia.tsx:266-280` ampliou para `w-[308px]`, aplicou `collisionBoundary` e fixou o cabeçalho fora da área rolável (`09`, `11`, `13`, `14`, `15`, `24`). `PopoverLegenda.tsx:323` usa `grid-cols-2` (`"Automático \| Original \| Traduzida \| Narração"` sem cortar `"Narr..."`, [`11-popover-legenda-estilo-1366.png`](./capturas/onda-4-reav/11-popover-legenda-estilo-1366.png)); `PopoverAudio.tsx:410` exibe `"Importar áudio (até 500 MiB)"` em largura total (`284 px` dentro de `308 px`, `scrollWidth === clientWidth`). |
| **UI-66** | **P2** | Violação da *Regra da Luz Única*: 2 botões `bg-sinal` simultâneos | **Resolvido** | `InstaladorJustInTime.tsx:589` passou a usar `variante="secundario"` no modo `inline` dentro de `PopoverEnquadrar` (`botoesPrimariosSinal = 1` em `09`, `10`, `24`). `ContextoCorteConectado.tsx:504` rebaixa `"Exportar Corte"` para `variante="secundario"` em `?estado=vazio` (`botoesPrimariosSinal = 1` em [`23-estado-vazio-editar-1366.png`](./capturas/onda-4-reav/23-estado-vazio-editar-1366.png)). *(Em modais, o botão de fundo permanece sob o `bg-veu`, mesmo padrão da Onda 3.)* |
| **UI-67** | **P2** | `<Segmentado>` `"Enquadrar na Fonte 16:9"` quebrava em 2 linhas e colidia com borda em alto contraste | **Resolvido** | `Escolhas.tsx:121` + `PalcoEditor.tsx` mantêm `"Enquadrar na Fonte 16:9"` em linha única sem colisão com a borda branca em `[data-contrast="high"]` ([`01-editar-direto-1366.png`](./capturas/onda-4-reav/01-editar-direto-1366.png), [`05-editar-hc-1366.png`](./capturas/onda-4-reav/05-editar-hc-1366.png), [`24-estado-editar-hc-popover-1440.png`](./capturas/onda-4-reav/24-estado-editar-hc-popover-1440.png)). |
| **UI-68** | **P3** | Glossário e textos crus (`"preset"`, `"Layout: fit"`, `"Desfazer ( 1 )"`, `"Corte #201 · Corte #201"`) | **Resolvido** | `glossarioViolacoes = []` nos 24 estados; `"Estilo da legenda"` em [`11-popover-legenda-estilo-1366.png`](./capturas/onda-4-reav/11-popover-legenda-estilo-1366.png); `"Desfazer (1)"`, `"Refazer (0)"` e `"Layout: Fit / Centro"` em [`15-popover-historico-1440.png`](./capturas/onda-4-reav/15-popover-historico-1440.png); cabeçalho `"Corte 201"` sem duplicação em [`22-estado-erro-fatal-1366.png`](./capturas/onda-4-reav/22-estado-erro-fatal-1366.png) e [`23-estado-vazio-editar-1366.png`](./capturas/onda-4-reav/23-estado-vazio-editar-1366.png). |
| **UI-69** | **P3** | `Transcrição` abria rolada fora do Corte (`Frase 28..32`) em vez da 1ª frase ativa | **Resolvido** | `PainelEsquerdoCorte.tsx` rola automaticamente na abertura inicial para a primeira frase dentro do Corte (`Frase 40` em `01` e `20`, `Frase 10` em `09`, `Frase 1` em `21`). |

---

## 4. Achados novos (`UI-70` em diante)

> Zero bloqueadores funcionais (`P0`) e zero `P1`. Foram identificados **2 achados `P2`** (1 de A11y AA / WCAG 2.5.8 herdado na `BarraStatus` do `Shell` e 1 visual no diálogo de exportação com fallback de CPU) e **1 achado `P3`** de navegação por `F6`.

| ID | Sev. | Categoria | Tela / Arquivo | Passo para reproduzir | Captura / Evidência | Sugestão de correção |
|---|---|---|---|---|---|---|
| **UI-70** | **P2** | A11y AA (WCAG 2.5.8) | `BarraStatus` (`front-v2/src/shell/Shell.tsx:770-793`) | Abrir o Editor (ou qualquer tela com job em andamento ou chamadas incertas na Fila) e medir a altura do botão `"Onda e miniaturas 42%"` no rodapé. | `alvosMenores24` em todos os 24 estados de `ui-onda4-audit.json`: `button "Onda e miniaturas42%"` mede **`159.2 × 21.4 px`** (`< 24 px` de altura). A correção de **UI-61** aplicou `min-h-6` apenas em `"Tentar novamente"` (`Shell.tsx:655`), omitindo os botões irmãos nas linhas `773` e `786`. | Adicionar `min-h-6` aos dois `<button>` de job ativo e chamadas incertas em `Shell.tsx:773` e `Shell.tsx:786`. |
| **UI-71** | **P2** | visual | `DialogoExportarCorte` (`front-v2/src/telas/corte/DialogoExportarCorte.tsx:900-904`; `design-system-v2/src/primitivas/Indicadores.tsx:62`) | Abrir `#/projeto/demo/corte/102/editar?run=1&estado=fallback`, acionar `Ctrl+E`, confirmar `"Entendi o risco"` e concluir a exportação. | Em [`07-exportar-fallback-cpu-1440.png`](./capturas/onda-4-reav/07-exportar-fallback-cpu-1440.png), o texto `"A exportação usou a CPU (libx264) porque o encoder de placa de vídeo falhou (h264_nvenc)."` é renderizado dentro de `<Status tom="aviso">`, que impõe `whitespace-nowrap` (`Indicadores.tsx:62`), fazendo `(h264_nvenc).` extravasar além da borda direita do bloco `bg-area` e do diálogo `560 px`. | Permitir quebra de linha no aviso de fallback (`className="items-start whitespace-normal"` em `<Status>` ou layout flex com ícone `shrink-0` e texto em `<span>` quebrável). |
| **UI-72** | **P3** | A11y AA / teclado | `EditarCorte` (`front-v2/src/telas/corte/EditarCorte.tsx:986-1020`) | No Editor, pressionar `F6` repetidamente a partir do `topo` para navegar até a barra `<ContextoCorte>` (*Cortes*, *Anterior/Próximo*, abas *Editar/Transformar/Empacotar*, *Exportar Corte*). | `obterRegioes` inclui `[topo, painel, palco, popover, timeline, filaRegiao, rodape]` e mapeia elementos dentro de `[data-regiao="contexto"]` para o índice `0` (`topo`), pulando `contexto` como parada própria do ciclo `F6` / `Shift+F6` (diferente do `Shell.tsx:487`, que trata `[data-regiao="contexto"]` como região própria). | Incluir `document.querySelector<HTMLElement>('[data-regiao="contexto"]')` logo após `topo` em `obterRegioes` de `EditarCorte.tsx:988-1009` e remover o fallback que o colapsa no índice `0`. |

### Observações menores (fora de severidade bloqueadora)
- Em [`14-popover-audio-ccby-1366.png`](./capturas/onda-4-reav/14-popover-audio-ccby-1366.png), quando a validação de licença `CC-BY` move o foco para o campo `"Atribuição"`, os botões finais `"Cancelar"` e `"Confirmar importação"` ficam parcialmente cortados na base da área rolável do popover até o usuário rolar alguns pixels.
- Em [`12-popover-legenda-traducao-custo-1440.png`](./capturas/onda-4-reav/12-popover-legenda-traducao-custo-1440.png), o endpoint `api.openai.com` no `<ResumoCustoPrivacidade>` dentro do popover `308 px` trunca para `api.open...`.
- Na `BarraStatus` (`Shell.tsx:802`), `<DicaAtalho tecla="?">Atalhos</DicaAtalho>` continua exibindo `?` estático no modo WCAG 2.1.4 `"alt"` (`statusBarKbdsAlt: ["F6", "?", "Ctrl K", "Ctrl ,"]`).

---

## 5. Inventário de capturas (`docs/produto/front-v2/ui/capturas/onda-4-reav/`)

Total: **24 arquivos PNG** gerados por `front-v2/e2e/ui-onda4.spec.ts` (`$env:UI_BASELINE = "1"`).

| # | Arquivo | Viewport / Tema | Fluxo | O que verifica |
|---:|---|---|---:|---|
| 01 | [`01-editar-direto-1366.png`](./capturas/onda-4-reav/01-editar-direto-1366.png) | 1366×768 · padrão | (n) | Abertura do Corte direto (`102`), Variante D, `<Segmentado>` em 1 linha (**UI-67**) e `Transcrição` rolada para `Frase 40` (**UI-69**) |
| 02 | [`02-editar-recolhido-indice-1366.png`](./capturas/onda-4-reav/02-editar-recolhido-indice-1366.png) | 1366×768 · padrão | (n) | Painel esquerdo recolhido (`Ctrl+[`) |
| 03 | [`03-editar-transformado-3faixas-1440.png`](./capturas/onda-4-reav/03-editar-transformado-3faixas-1440.png) | 1440×900 · padrão | (n) | Corte transformado (`201`) com `+3 faixas`, `Índice do Corte` e botão `"Ir"` `≥ 24 px` (**UI-63**) |
| 04 | [`04-editar-fonte-16-9-crop-1366.png`](./capturas/onda-4-reav/04-editar-fonte-16-9-crop-1366.png) | 1366×768 · padrão | (n) | Modo `Enquadrar na Fonte 16:9` com retângulo de crop por teclado |
| 05 | [`05-editar-hc-1366.png`](./capturas/onda-4-reav/05-editar-hc-1366.png) | 1366×768 · alto contraste | (n) | `[data-contrast="high"]` no Editor sem colisão de borda no `<Segmentado>` (**UI-67**) |
| 06 | [`06-exportar-corte-dialog-1366.png`](./capturas/onda-4-reav/06-exportar-corte-dialog-1366.png) | 1366×768 · padrão | (m) | Diálogo `Exportar Corte` (`Ctrl+E`) com foco inicial em `"Cancelar"` (**UI-62**) |
| 07 | [`07-exportar-fallback-cpu-1440.png`](./capturas/onda-4-reav/07-exportar-fallback-cpu-1440.png) | 1440×900 · padrão | (m) | Conclusão de exportação com aviso `encoder_fallback` extravasando a borda direita (**UI-71**) |
| 08 | [`08-exportar-hc-1366.png`](./capturas/onda-4-reav/08-exportar-hc-1366.png) | 1366×768 · alto contraste | (m) | Diálogo `Exportar Corte` em `[data-contrast="high"]` |
| 09 | [`09-popover-enquadrar-yunet-1366.png`](./capturas/onda-4-reav/09-popover-enquadrar-yunet-1366.png) | 1366×768 · padrão | (o) | `PopoverEnquadrar` `308 px` contido entre cabeçalho e `BarraAcoes`, foco em `"Rosto (9:16)"` e `1` único `bg-sinal` (**UI-62**, **UI-65**, **UI-66**) |
| 10 | [`10-popover-enquadrar-limpar-dialog-1440.png`](./capturas/onda-4-reav/10-popover-enquadrar-limpar-dialog-1440.png) | 1440×900 · padrão | (o) | Confirmação `"Limpar edições manuais?"` e `"Baixar e continuar"` secundário (**UI-66**) |
| 11 | [`11-popover-legenda-estilo-1366.png`](./capturas/onda-4-reav/11-popover-legenda-estilo-1366.png) | 1366×768 · padrão | (o) | `PopoverLegenda` com faixas em grade `2×2` sem cortar `"Narração"` e título `"Estilo da legenda"` (**UI-65**, **UI-68**) |
| 12 | [`12-popover-legenda-traducao-custo-1440.png`](./capturas/onda-4-reav/12-popover-legenda-traducao-custo-1440.png) | 1440×900 · padrão | (o) | Confirmação de custo/privacidade antes de `Traduzir Corte` |
| 13 | [`13-popover-silencios-1366.png`](./capturas/onda-4-reav/13-popover-silencios-1366.png) | 1366×768 · padrão | (o) | `PopoverSilencios` contido sem sobreposição (**UI-65**) |
| 14 | [`14-popover-audio-ccby-1366.png`](./capturas/onda-4-reav/14-popover-audio-ccby-1366.png) | 1366×768 · padrão | (o) | `PopoverAudio` com formulário e erro de atribuição `CC-BY` focado |
| 15 | [`15-popover-historico-1440.png`](./capturas/onda-4-reav/15-popover-historico-1440.png) | 1440×900 · padrão | (o) | `PopoverHistorico` com `"Desfazer (1)"`, `"Refazer (0)"`, `"Layout: Fit / Centro"` e `"Restaurar"` sem `<span tabIndex={0}>` (**UI-63**, **UI-68**) |
| 16 | [`16-ciclo-overlay-borda-alt-1366.png`](./capturas/onda-4-reav/16-ciclo-overlay-borda-alt-1366.png) | 1366×768 · padrão | (n)/(p) | Arrasto de borda com `Alt` (`"Livre por quadro (Alt)"`) |
| 17 | [`17-ciclo-erro-flush-saida-1366.png`](./capturas/onda-4-reav/17-ciclo-erro-flush-saida-1366.png) | 1366×768 · padrão | (p) | Guarda de saída após `editor_save_failed` com diálogo de 3 ações |
| 18 | [`18-ciclo-editor-save-failed-shell-1366.png`](./capturas/onda-4-reav/18-ciclo-editor-save-failed-shell-1366.png) | 1366×768 · padrão | (p) | Erro na `BarraStatus` com `"Tentar novamente"` `≥ 24 px` (**UI-61**) e botão de job `< 24 px` (**UI-70**) |
| 19 | [`19-estado-guarda-entrada-toast-1366.png`](./capturas/onda-4-reav/19-estado-guarda-entrada-toast-1366.png) | 1366×768 · padrão | (p) | Guarda de entrada redirecionando para `#/projeto/:id/cortes` com toast |
| 20 | [`20-estado-fonte-offline-1366.png`](./capturas/onda-4-reav/20-estado-fonte-offline-1366.png) | 1366×768 · padrão | (p) | Fonte `offline` somente leitura + `Relocalizar Fonte` + `Transcrição` rolada para `Frase 40` (**UI-69**) |
| 21 | [`21-estado-corte-avulso-v1-1440.png`](./capturas/onda-4-reav/21-estado-corte-avulso-v1-1440.png) | 1440×900 · padrão | (p) | Corte V1 avulso (`avulso-1-1-3`) preservando leitura e navegação |
| 22 | [`22-estado-erro-fatal-1366.png`](./capturas/onda-4-reav/22-estado-erro-fatal-1366.png) | 1366×768 · padrão | (p) | Estado `?estado=erro` com cabeçalho `"Corte 201"` sem duplicação (**UI-68**) |
| 23 | [`23-estado-vazio-editar-1366.png`](./capturas/onda-4-reav/23-estado-vazio-editar-1366.png) | 1366×768 · padrão | (p) | Estado `?estado=vazio` com único `bg-sinal` em `"Voltar para Cortes"` (**UI-66**) |
| 24 | [`24-estado-editar-hc-popover-1440.png`](./capturas/onda-4-reav/24-estado-editar-hc-popover-1440.png) | 1440×900 · alto contraste | (o)/(p) | `EditarCorte` + popover aberto em `1440×900` com `[data-contrast="high"]` limpo (**UI-65**, **UI-66**, **UI-67**) |
