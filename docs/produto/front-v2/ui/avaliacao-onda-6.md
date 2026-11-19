# Avaliação independente de UI — Onda 6 (Exportação, Fila de Jobs, Relatos e Sobre)

> ⚠️ **DEGRADED: single-context (critique + audit em sessão única, sem subagente independente nem navegador interativo manual além da suíte Playwright; ambiente mock TS `VITE_CORE_MOCK=1`, sem Tauri).**

- **Data:** 2026-11-18
- **Commit avaliado:** `bb3716d` (`origin/master`, PR `#470`, Onda 6 `#368`–`#371`, incluindo `#469` `export.readiness`)
- **Referências:** [`DESIGN.md`](../../../../DESIGN.md), [`GLOSSARY.md`](../../../../GLOSSARY.md), [`10-plano-onda-6.md`](../10-plano-onda-6.md), [`F-exportacao-fila-relatos.md`](../telas/F-exportacao-fila-relatos.md), [`avaliacao-onda-4.md`](./avaliacao-onda-4.md)
- **Script reproduzível:** [`front-v2/e2e/ui-onda6.spec.ts`](../../../../front-v2/e2e/ui-onda6.spec.ts) (pulado sem `UI_BASELINE=1`; reaproveita cenários/seletores de [`e2e/exportacao.spec.ts`](../../../../front-v2/e2e/exportacao.spec.ts), [`e2e/fila-jobs.spec.ts`](../../../../front-v2/e2e/fila-jobs.spec.ts), [`e2e/relatos.spec.ts`](../../../../front-v2/e2e/relatos.spec.ts) e [`e2e/sobre.spec.ts`](../../../../front-v2/e2e/sobre.spec.ts))
- **Capturas:** 24 PNGs em [`docs/produto/front-v2/ui/capturas/onda-6/`](./capturas/onda-6/)

---

## 1. Cenário executado e evidências automatizadas

### 1.1 Comandos verificados

| Verificação | Comando | Resultado observado |
|---|---|---|
| Instalação | `cd front-v2; bun install` | `152 packages installed [21.38s]`, exit `0` |
| Static UI check | `impeccable detect --json front-v2/src` | `[]` (zero detecções), exit `0` |
| Contraste tokens DS | `cd design-system-v2; bun scripts/contraste.ts` | `Todos os pares passam.` (escuro, claro, alto contraste escuro e alto contraste claro), exit `0` |
| Typecheck | `cd front-v2; bun run typecheck` (`tsc --noEmit`) | Exit `0` |
| Unitários (suíte completa) | `cd front-v2; bun run test -- --maxWorkers=2` | `79 passed (79)` arquivos · `617 passed (617)` testes em `262.32s`, exit `0` |
| E2E CI padrão | `cd front-v2; bunx playwright test --reporter=list` (sem `UI_BASELINE`) | `35 passed`, `5 skipped` (`ui-baseline`, `ui-onda2`, `ui-onda3`, `ui-onda4`, `ui-onda6`) em `53.9s`, exit `0` |
| Baseline Onda 6 + DOM audit | `$env:UI_BASELINE="1"; bunx playwright test e2e/ui-onda6.spec.ts --reporter=list` | `1 passed (27.7s)`, `erros: []` (`0 pageerror`), 24 capturas geradas e 21 auditorias DOM, exit `0` |

### 1.2 Auditoria transversal nas 21 medições DOM

- **Contraste de texto (DOM):** `0` textos abaixo de `4,5:1` (`3:1` grande) nas 21 medições (`1366×768` e `1440×900`, padrão e `[data-contrast="high"]`).
- **Headings / Semântica:** `h1Count = 1` e `semNomeAcessivel = 0`, `imagensQuebradas = 0` em todas as 21 medições; detectado salto `h1 → h3` na Zona A de `MesaProntidao` (**UI-83**).
- **Overflow externo e tabelas:** `0 px` de overflow horizontal ou vertical na viewport (`scrollW === innerW` e `scrollH === innerH`) e `overflowTabelasInternas = 0` em todas as 21 medições.
- **Alvos e teclado:** detectados alvos `< 24 px` na `BarraStatus` (`159.2 × 21.4 px`) e em `DialogoRefazerJob` (`20 × 20 px`, **UI-82**), `<span tabIndex={0}>` em `MesaProntidao` (**UI-83**), falha de `F6` com `PainelFilaJobs` aberta em `Exportacao` e falha de `Esc` após `Tab` em `PainelFilaJobs` (**UI-80**).
- **Regra da Luz Única e toasts:** detectado bloqueio do botão primário de `MesaProntidao` por toast de erro no canto inferior direito (**UI-81**) e dois botões `.bg-sinal` simultâneos em `#/inicio` com Fila aberta e atrás de modais (**UI-84**).

---

## 2. Notas por fluxo (Nielsen H1–H10) e Audit Impeccable

Meta do projeto: **≥ 90% por fluxo (≥ 36/40)**, **WCAG 2.2 AA** (incl. alto contraste e 2.1.4) e **zero bloqueador funcional**.

| Fluxo | H1 | H2 | H3 | H4 | H5 | H6 | H7 | H8 | H9 | H10 | Total | % | Meta (≥ 90%) |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|:---:|
| **(q)** Exportação (Mesa de Prontidão, Lote e Histórico) | 3 | 3 | 2 | 3 | 4 | 4 | 3 | 3 | 4 | 4 | **33/40** | **82,5%** | ❌ Abaixo |
| **(r)** Painel Global da Fila de Jobs (`Ctrl+J`, região `fila`) | 4 | 3 | 2 | 3 | 4 | 3 | 3 | 3 | 4 | 4 | **33/40** | **82,5%** | ❌ Abaixo |
| **(s)** Relatos e Diagnóstico (`#/relatos`) e Sobre (`#/sobre`) | 4 | 3 | 4 | 4 | 4 | 4 | 4 | 4 | 4 | 4 | **39/40** | **97,5%** | ✅ Atendida |
| **(t)** Estados de erro, vazios, carregamento e sem Projeto | 4 | 4 | 4 | 3 | 4 | 4 | 4 | 3 | 4 | 4 | **38/40** | **95,0%** | ✅ Atendida |

### Justificativa de cada heurística abaixo de 4

- **Fluxo (q):**
  - **H1 = 3:** `ChecklistGuardaCorpos` inicia recolhido na primeira carga da Mesa apesar dos 4 avisos (`01-exportacao-prontidao-1366.png`, **UI-85**); cartão do lote na Zona C permanece em `0/2 concluídos` enquanto Zona D já marca `1 concluídos` durante execução ao vivo (**UI-85**).
  - **H2 = 3:** `HistoricoLotes` exibe `"de h264_nvenc: encoder_failed"` e `"h264_nvenc"` sem tradução na tabela de itens (**UI-86**) e `"1 concluídos"` no plural (**UI-85**).
  - **H3 = 2:** `Exportacao` intercepta `F6` omitindo `[data-regiao="fila"]` quando a Fila está aberta (**UI-80**), e toast persistente `"Tarefa falhou"` sobrepõe e impede cliques no botão primário `"Exportar N aprovados em lote"` (**UI-81**).
  - **H4 = 3:** Salto de heading `h1 → h3` na Zona A e `<span tabIndex={0}>` em botões desabilitados (**UI-83**); botão `"Ver em Histórico"` na `FaixaJob` e botão de job na `BarraStatus` < `24 px` (**UI-82**); dois `.bg-sinal` visíveis com `ConfirmDialog` aberto (**UI-84**).
  - **H7 = 3 / H8 = 3:** Bloqueio de acesso via `F6` à Fila aberta (**UI-80**), repetição de botão desabilitado `"Converter em Vídeo transformado"` em todo card `Corte direto` (**UI-83**) e obstrução da Zona B pelo toast (**UI-81**).
- **Fluxo (r):**
  - **H2 = 3:** Cards da Fila exibem strings técnicas cruas (`· legacy`, `· sources-3`, `· codex`) em `PainelFilaJobs` e `"Sucesso (ok)"` em `DialogoResultadoJob` (**UI-86**).
  - **H3 = 2:** Após `Tab` dentro da `PainelFilaJobs` (`Fechar Fila (Esc)`), `Esc` deixa de fechar a gaveta (`escapeFechouAposTab: false`, **UI-80**); `DialogoTentarDeNovo` abre sem mover foco para `"Cancelar"` (`focoInicialRetry: "Ver estimativa e repetir"`, **UI-82**).
  - **H4 = 3:** Botão `"Aviso sobre Revisão da execução"` mede `20 × 20 px` (`size-5`) e botões da `BarraStatus` / `"Itens do lote (...)"` medem `21,4 px` de altura (< `24 px`, **UI-82**); modais mantêm `.bg-sinal` da tela atrás do véu (**UI-84**).
  - **H6 = 3:** `<Dica>` de `"ETA indisponível"` e `"Em memória nesta sessão"` envolvem `<span>` sem foco por teclado (**UI-87**).
  - **H7 = 3 / H8 = 3:** Conflito `F6`/`Esc` (**UI-80**), toast obstruindo ações inferiores (**UI-81**) e banners prioritários ocupando cerca de metade da altura da gaveta em `1366×768` (**UI-87**).
- **Fluxo (s):**
  - **H2 = 3:** Ficha da sonda em `Relatos` exibe termos técnicos crus (`CT2 / Modelo`, `cuda / int8_float16`, `lote seguro: 8 (probe)`) e `THIRD_PARTY_NOTICES.md` em `Sobre` contém referências `#50`/`#60` e `"Clipe"` (**UI-86**).
- **Fluxo (t):**
  - **H4 = 3 / H8 = 3:** Em `#/inicio` com `PainelFilaJobs` aberta (`t-fila-sem-projeto`), coexistem dois botões `.bg-sinal` (`Novo Projeto Ctrl+N` e `Ir para Início`, sendo o segundo redundante na própria rota `#/inicio`, **UI-84**); botão de job na `BarraStatus` < `24 px` quando ativo (**UI-82**).

### Impeccable Audit (`/20`)

| Dimensão | Nota (0–4) | Síntese |
|---|---:|---|
| Contraste e Cor | 4 | `contraste.ts` 100% aprovado nos 4 modos; `0` violações de contraste de texto na auditoria DOM (`1366×768`, `1440×900` e alto contraste). |
| Tipografia e Hierarquia | 3 | `1` `<h1>` por tela e `tabular-nums` consistente; descontado pelo salto `h1 → h3` na Zona A de `MesaProntidao` (**UI-83**) e strings técnicas cruas (**UI-86**). |
| Layout, Espaçamento e Viewport | 3 | `0 px` de overflow externo na viewport e `0` overflow de tabela; descontado pela sobreposição do toast no canto inferior direito (**UI-81**) e altura dos banners na Fila em `1366×768` (**UI-87**). |
| Alvos, Teclado e A11y AA | 2 | Falham `F6` com Fila aberta em `Exportacao`, `Esc` após `Tab` na Fila (**UI-80**), foco inicial em `DialogoTentarDeNovo` + alvos `20 × 20 px` / `21,4 px` (**UI-82**), `<span tabIndex={0}>` (**UI-83**) e `<Dica>` em `<span>` (**UI-87**). |
| Sobriedade Visual (*Luz Única* / *Estado Cinza*) | 3 | *Estado Cinza*, *Erro Sem Fundo* e *Sombra Flutuante* bem aplicados; descontado por dois `.bg-sinal` em `#/inicio` + Fila e atrás de modais (**UI-84**) e checklist recolhido na carga inicial (**UI-85**). |
| **Total Audit Impeccable** | **15/20** | **75%** |

---

## 3. Achados (numerados a partir de `UI-80`)

| ID | Sev. | Categoria | Resumo | Local principal |
|---|---|---|---|---|
| **UI-80** | P1 | bloqueador funcional / A11y AA | `Exportacao` intercepta `F6` omitindo `fila`; `Esc` falha na `PainelFilaJobs` após `Tab` em `Fechar Fila (Esc)` | `Exportacao.tsx:116-178` · `PainelFilaJobs.tsx:354-366,613-620` |
| **UI-81** | P1 | bloqueador funcional / visual | Toast persistente de erro (`Abrir Fila`) no canto inferior direito sobrepõe e bloqueia o botão primário de `Exportacao` | `Shell.tsx:414-424` · `MesaProntidao.tsx:1073-1084` |
| **UI-82** | P2 | A11y AA | `DialogoTentarDeNovo` não foca `"Cancelar"` ao abrir; alvos `< 24 px` em `DialogoRefazerJob` (`20×20`), `BarraStatus` (`21,4 px`) e listas | `DialogosFila.tsx:177,201-218,568` · `Shell.tsx:768` · `Exportacao.tsx:277` · `PainelFilaJobs.tsx:1037` |
| **UI-83** | P2 | A11y AA | `<span tabIndex={0}>` em botões desabilitados e salto de heading `h1 → h3` na Zona A de `MesaProntidao` | `MesaProntidao.tsx:335,444-449,858-878,980-985` |
| **UI-84** | P2 | visual | Violação da *Regra da Luz Única*: dois `.bg-sinal` simultâneos em `#/inicio` com Fila aberta (`Ir para Início`) e atrás de modais | `PainelFilaJobs.tsx:771-774` · `MesaProntidao.tsx:1073-1079` |
| **UI-85** | P2 | visual | `ChecklistGuardaCorpos` abre recolhido na 1ª carga assíncrona da Mesa; Zona C de `HistoricoLotes` fica em `0/2` durante lote ativo (`1 concluídos`) | `Avisos.tsx:103` · `HistoricoLotes.tsx:116-129,422,500` |
| **UI-86** | P3 | texto | Strings técnicas cruas na UI (`legacy`, `sources-3`, `codex`, `h264_nvenc: encoder_failed`, `Sucesso (ok)`, `CT2`, `#50`/`#60` em atribuições) | `PainelFilaJobs.tsx:863-868` · `HistoricoLotes.tsx:257,263` · `DialogosFila.tsx:687` · `Relatos.tsx:464-496` · `THIRD_PARTY_NOTICES.md` |
| **UI-87** | P3 | visual | Banners prioritários comprimem lista da Fila em `1366×768` e `<Dica>` informativas em `<span>` não são focáveis por teclado | `PainelFilaJobs.tsx:626-684,891-899,1211-1216` |

### Detalhamento dos achados

#### UI-80 — `Exportacao` intercepta `F6` sem `[data-regiao="fila"]` e `PainelFilaJobs` perde `Esc` após `Tab` (P1 · bloqueador funcional / A11y AA)
- **Tela / Arquivos:** `#/projeto/:id/exportacao` e `PainelFilaJobs` (`Ctrl+J`) — [`front-v2/src/telas/exportacao/Exportacao.tsx#L116-L178`](../../../../front-v2/src/telas/exportacao/Exportacao.tsx#L116-L178), [`front-v2/src/telas/fila/PainelFilaJobs.tsx#L354-L366`](../../../../front-v2/src/telas/fila/PainelFilaJobs.tsx#L354-L366), [`#L613-L620`](../../../../front-v2/src/telas/fila/PainelFilaJobs.tsx#L613-L620) e [`front-v2/src/shell/Shell.tsx#L484-L530`](../../../../front-v2/src/shell/Shell.tsx#L484-L530)
- **Passo para reproduzir:** (1) Abrir `#/projeto/demo/exportacao`, abrir a Fila (`Ctrl+J`) e pressionar `F6` 7 vezes; (2) Em `#/inicio`, abrir a Fila (`Ctrl+J`), pressionar `Tab` (focando `Fechar Fila (Esc)`) e pressionar `Esc`.
- **Evidência:** Em `Exportacao.tsx:120-126`, `obterRegioes()` inclui apenas `[topo, subbarraRef, zonaEsquerdaRef, zonaDireitaRef, rodape]` e chama `e.stopImmediatePropagation()`, impedindo `F6` de alcançar `[data-regiao="fila"]` (`regioesF6ExportacaoComFila = ["conteudo","conteudo","conteudo","rodape","topo","conteudo","conteudo"]`). Além disso, em `t-fila-sem-projeto`, após `Tab` focar `button:Fechar Fila (Esc)` (que envolve `<Dica>` via `BotaoIcone`), `Esc` não fechou o painel (`escapeFechouAposTab: false`) porque `PainelFilaJobs.tsx:356` descarta o evento se `e.defaultPrevented` for verdadeiro após o tooltip interceptar `Escape`.
- **Capturas:** [`01-exportacao-prontidao-1366.png`](./capturas/onda-6/01-exportacao-prontidao-1366.png), [`24-estado-fila-sem-projeto-1366.png`](./capturas/onda-6/24-estado-fila-sem-projeto-1366.png)
- **Sugestão:** Incluir `[data-regiao="fila"]` (quando montado) na lista de regiões `F6` de `Exportacao.tsx` e `Relatos.tsx` (ou delegar sub-regiões ao `Shell`), e garantir que `Esc` na `PainelFilaJobs` feche a gaveta mesmo quando um `<Dica>` filho estiver aberto/focado.

#### UI-81 — Toast persistente de erro no canto inferior direito bloqueia botão primário de `Exportacao` (P1 · bloqueador funcional / visual)
- **Tela / Arquivos:** `#/projeto/:id/exportacao` + `Shell` — [`front-v2/src/shell/Shell.tsx#L414-L424`](../../../../front-v2/src/shell/Shell.tsx#L414-L424) e [`front-v2/src/telas/exportacao/MesaProntidao.tsx#L1073-L1084`](../../../../front-v2/src/telas/exportacao/MesaProntidao.tsx#L1073-L1084)
- **Passo para reproduzir:** Descartar ou falhar um job na Fila (disparando toast `"Tarefa falhou — Janela descartada [Abrir Fila]"`) e navegar para `#/projeto/demo/exportacao` tentando clicar em `"Exportar 4 aprovados em lote"`.
- **Evidência:** O portal `[aria-label="Notifications"]` fixa os toasts no canto inferior direito diretamente sobre o rodapé da Zona B (`sobreposicaoToast: true`), interceptando eventos de ponteiro sobre o único botão primário da tela e mantendo o toast `type="erro"` aberto indefinidamente. No snapshot de acessibilidade do erro observado, o botão de fechar do toast apareceu com `[aria-hidden]`.
- **Captura:** [`15-fila-toast-abrir-fila-1366.png`](./capturas/onda-6/15-fila-toast-abrir-fila-1366.png)
- **Sugestão:** Posicionar o contêiner de toasts acima da `BarraStatus` ou em faixa que não cubra o botão primário da coluna direita (ex.: canto superior direito abaixo da `BarraSuperior` ou com deslocamento lateral/vertical adequado), garantir fechamento automático/atalho e nome acessível quando visível a leitores de tela.

#### UI-82 — `DialogoTentarDeNovo` perde foco inicial em `"Cancelar"` e alvos `< 24 px` na Fila e `BarraStatus` (P2 · A11y AA)
- **Tela / Arquivos:** `DialogosFila`, `PainelFilaJobs`, `Shell` (`BarraStatus`) e `Exportacao` — [`front-v2/src/telas/fila/DialogosFila.tsx#L177`](../../../../front-v2/src/telas/fila/DialogosFila.tsx#L177), [`#L201-L218`](../../../../front-v2/src/telas/fila/DialogosFila.tsx#L201-L218), [`#L568`](../../../../front-v2/src/telas/fila/DialogosFila.tsx#L568), [`front-v2/src/shell/Shell.tsx#L768-L788`](../../../../front-v2/src/shell/Shell.tsx#L768-L788), [`front-v2/src/telas/exportacao/Exportacao.tsx#L277`](../../../../front-v2/src/telas/exportacao/Exportacao.tsx#L277) e [`front-v2/src/telas/fila/PainelFilaJobs.tsx#L1037`](../../../../front-v2/src/telas/fila/PainelFilaJobs.tsx#L1037)
- **Passo para reproduzir:** (1) Na Fila, clicar em `"Ver estimativa e repetir"` em job `uncertain`; (2) Abrir `"Refazer com outro Perfil"` em job `ai:selection` e inspecionar o botão de informação; (3) Inspecionar altura dos botões clicáveis da `BarraStatus`.
- **Evidência:** Como `DialogoTentarDeNovo` retorna `null` quando `!job`, `<ConfirmDialog>` monta já com `aberto={true}` e `initialFocus` não move o foco para `"Cancelar"` (`checksExtras.fila.focoInicialRetry = "Ver estimativa e repetir"`). Em `DialogoRefazerJob`, o botão `"Aviso sobre Revisão da execução"` mede `20 × 20 px` (`size-5`, `< 24 px`). Na `BarraStatus`, o botão de job ativo (`"Onda e miniaturas 42%"` / `"Exportando Corte 2 50%"`) mediu `159.2 × 21.4 px` (`< 24 px` de altura em 15 auditorias DOM), padrão repetido em `"Ver em Histórico"` (`Exportacao.tsx:277`, `py-0.5`) e `"Itens do lote"` (`PainelFilaJobs.tsx:1037`, `py-0.5`).
- **Capturas:** [`12-fila-dialog-retry-custo-1366.png`](./capturas/onda-6/12-fila-dialog-retry-custo-1366.png), [`14-fila-dialog-redo-result-1366.png`](./capturas/onda-6/14-fila-dialog-redo-result-1366.png), [`01-exportacao-prontidao-1366.png`](./capturas/onda-6/01-exportacao-prontidao-1366.png)
- **Sugestão:** Manter `<ConfirmDialog>` sempre montado em `DialogosFila` (com `aberto={aberto && job !== null}`) para acionar `initialFocus` na transição `false → true`, trocar `size-5` por `size-6` em `DialogoRefazerJob` e aplicar `min-h-6` (`24 px`) nos botões da `BarraStatus`, `FaixaJob` e sublista de lotes.

#### UI-83 — `<span tabIndex={0}>` em botões desabilitados e salto `h1 → h3` na Zona A da `MesaProntidao` (P2 · A11y AA)
- **Tela / Arquivos:** `#/projeto/:id/exportacao?sub=prontidao` — [`front-v2/src/telas/exportacao/MesaProntidao.tsx#L335`](../../../../front-v2/src/telas/exportacao/MesaProntidao.tsx#L335), [`#L444-L449`](../../../../front-v2/src/telas/exportacao/MesaProntidao.tsx#L444-L449), [`#L858-L878`](../../../../front-v2/src/telas/exportacao/MesaProntidao.tsx#L858-L878) e [`#L980-L985`](../../../../front-v2/src/telas/exportacao/MesaProntidao.tsx#L980-L985)
- **Passo para reproduzir:** Abrir `#/projeto/demo/exportacao` e tabular pelos cards e pela Zona B; inspecionar a árvore de headings.
- **Evidência:** `spanTabIndexZero` registrou `["Converter em Vídeo transformado", "Salvar pasta padrão"]` em `q-exportacao-prontidao-1366`, `1440` e `hc` (spans focáveis sem `role` nem `aria-disabled`). A árvore de headings na mesma tela é `h1 ("Exportação") → h3 ("A virada do jogo...") → h2 ("Exportação em lote")`, gerando `saltoHeading: "h1 -> h3"`.
- **Capturas:** [`01-exportacao-prontidao-1366.png`](./capturas/onda-6/01-exportacao-prontidao-1366.png), [`02-exportacao-prontidao-1440.png`](./capturas/onda-6/02-exportacao-prontidao-1440.png), [`03-exportacao-prontidao-hc-1366.png`](./capturas/onda-6/03-exportacao-prontidao-hc-1366.png)
- **Sugestão:** Substituir `<span tabIndex={0}>` por `aria-disabled="true"` no próprio `<Botao>` ou texto explicativo inline sem wrapper focável, e incluir um `<h2>` (`"Cortes aprovados"` / `sr-only` ou discreto) na Zona A antes dos cards `<h3>`.

#### UI-84 — Violação da *Regra da Luz Única*: dois `.bg-sinal` simultâneos em `#/inicio` com Fila aberta e atrás de modais (P2 · visual)
- **Tela / Arquivos:** `PainelFilaJobs` + `#/inicio`, `MesaProntidao` e `DialogosFila` — [`front-v2/src/telas/fila/PainelFilaJobs.tsx#L771-L774`](../../../../front-v2/src/telas/fila/PainelFilaJobs.tsx#L771-L774), [`front-v2/src/telas/exportacao/MesaProntidao.tsx#L1073-L1079`](../../../../front-v2/src/telas/exportacao/MesaProntidao.tsx#L1073-L1079)
- **Passo para reproduzir:** Em `#/inicio` sem Projeto aberto, pressionar `Ctrl+J` para abrir `PainelFilaJobs`.
- **Evidência:** `botoesPrimariosSinal = 2` (`["Novo ProjetoCtrl+N", "Ir para Início"]`), com o agravante de `"Ir para Início"` apontar para a própria tela atual. Em modais (`04`, `05`, `12`, `13`, `14`), o `.bg-sinal` da tela principal também permanece ativo atrás do véu junto do botão primário do diálogo.
- **Capturas:** [`24-estado-fila-sem-projeto-1366.png`](./capturas/onda-6/24-estado-fila-sem-projeto-1366.png), [`04-exportacao-aviso-direto-1366.png`](./capturas/onda-6/04-exportacao-aviso-direto-1366.png), [`12-fila-dialog-retry-custo-1366.png`](./capturas/onda-6/12-fila-dialog-retry-custo-1366.png)
- **Sugestão:** Rebaixar os CTAs do estado vazio dentro da gaveta `PainelFilaJobs` para `variante="secundario"` (e ocultar `"Ir para Início"` quando já estiver em `#/inicio`).

#### UI-85 — `ChecklistGuardaCorpos` inicia recolhido na 1ª carga da Mesa e Zona C de `HistoricoLotes` fica defasada durante execução (P2 · visual)
- **Tela / Arquivos:** `#/projeto/:id/exportacao` (`MesaProntidao` e `HistoricoLotes`) — [`design-system-v2/src/componentes/Avisos.tsx#L103`](../../../../design-system-v2/src/componentes/Avisos.tsx#L103), [`front-v2/src/telas/exportacao/MesaProntidao.tsx#L1047-L1052`](../../../../front-v2/src/telas/exportacao/MesaProntidao.tsx#L1047-L1052), [`front-v2/src/telas/exportacao/HistoricoLotes.tsx#L116-L129`](../../../../front-v2/src/telas/exportacao/HistoricoLotes.tsx#L116-L129), [`#L422`](../../../../front-v2/src/telas/exportacao/HistoricoLotes.tsx#L422), [`#L500`](../../../../front-v2/src/telas/exportacao/HistoricoLotes.tsx#L500)
- **Passo para reproduzir:** (1) Abrir `#/projeto/demo/exportacao` pela primeira vez e observar `"Antes de exportar · 4 pontos para olhar"` na Zona B; (2) Disparar lote e observar Zona C vs. Zona D durante o progresso.
- **Evidência:** Em `01-exportacao-prontidao-1366.png`, o checklist abre recolhido (`> Antes de exportar · 4 pontos para olhar`) porque `useState(abertoPorPadrao ?? atencao > 0)` em `Avisos.tsx:103` não sincroniza quando `abertoPorPadrao` muda após carga assíncrona. Durante o progresso do lote em `06-exportacao-lote-progresso-1366.png`, a Zona C mostra `"Todo o Projeto · 0/2 concluídos · 62%"` enquanto a Zona D ao lado mostra `"62% (1 concluídos · 1 exportando)"` (e usa plural fixo `"1 concluídos"`).
- **Capturas:** [`01-exportacao-prontidao-1366.png`](./capturas/onda-6/01-exportacao-prontidao-1366.png), [`02-exportacao-prontidao-1440.png`](./capturas/onda-6/02-exportacao-prontidao-1440.png), [`06-exportacao-lote-progresso-1366.png`](./capturas/onda-6/06-exportacao-lote-progresso-1366.png)
- **Sugestão:** Atualizar `aberto` em `ChecklistGuardaCorpos` quando `abertoPorPadrao` passar a `true` antes de interação manual, refletir `detalheLive` na contagem do cartão selecionado na Zona C e ajustar concordância (`1 concluído` / `N concluídos`).

#### UI-86 — Strings técnicas cruas expostas na Fila, Histórico de Lotes, Relatos e Atribuições (P3 · texto)
- **Tela / Arquivos:** [`front-v2/src/telas/fila/PainelFilaJobs.tsx#L863-L868`](../../../../front-v2/src/telas/fila/PainelFilaJobs.tsx#L863-L868), [`front-v2/src/telas/exportacao/HistoricoLotes.tsx#L257`](../../../../front-v2/src/telas/exportacao/HistoricoLotes.tsx#L257), [`#L263`](../../../../front-v2/src/telas/exportacao/HistoricoLotes.tsx#L263), [`front-v2/src/telas/fila/DialogosFila.tsx#L687`](../../../../front-v2/src/telas/fila/DialogosFila.tsx#L687), [`front-v2/src/telas/relatos/Relatos.tsx#L464-L496`](../../../../front-v2/src/telas/relatos/Relatos.tsx#L464-L496) e [`THIRD_PARTY_NOTICES.md`](../../../../THIRD_PARTY_NOTICES.md)
- **Passo para reproduzir:** Abrir Fila (`Ctrl+J`), Histórico de Lotes (`#6399`), Resultado do job `#4`, Relatos (sonda) e Sobre (`Atribuições de terceiros`).
- **Evidência:** Cards da Fila exibem `· legacy`, `· sources-3` e `· codex` crus (`DialogosFila` já traduz `'legacy'` para `'Perfil configurado'`); tabela de itens exibe `de h264_nvenc: encoder_failed` e `h264_nvenc`; `DialogoResultadoJob` mostra `Sucesso (ok)`; ficha da sonda em `Relatos` mostra `CT2 / Modelo`, `cuda / int8_float16` e `lote seguro: 8 (probe)`; `THIRD_PARTY_NOTICES.md` expõe `#50`, `#60` e `"Clipe"` (`ticketRefsVisiveis: ["#60", "#50"]`, `glossarioViolacoes: ["clipe...: Clipe"]`).
- **Capturas:** [`07-exportacao-lote-parcial-falhas-1440.png`](./capturas/onda-6/07-exportacao-lote-parcial-falhas-1440.png), [`09-fila-jobs-aberta-1366.png`](./capturas/onda-6/09-fila-jobs-aberta-1366.png), [`16-relatos-passo1-segredo-1366.png`](./capturas/onda-6/16-relatos-passo1-segredo-1366.png), [`20-sobre-atualizacao-atribuicoes-1440.png`](./capturas/onda-6/20-sobre-atualizacao-atribuicoes-1440.png)
- **Sugestão:** Reutilizar `rotuloPerfilVisivel` nos cards da Fila, traduzir código/motivo de encoder em `HistoricoLotes`, substituir `"Sucesso (ok)"` por `"Concluído com sucesso"`, simplificar rótulos da sonda visual em `Relatos` e limpar referências internas de tickets em `THIRD_PARTY_NOTICES.md`.

#### UI-87 — Banners prioritários comprimem a lista da Fila em `1366×768` e `<Dica>` em `<span>` sem acesso por teclado (P3 · visual)
- **Tela / Arquivos:** [`front-v2/src/telas/fila/PainelFilaJobs.tsx#L626-L684`](../../../../front-v2/src/telas/fila/PainelFilaJobs.tsx#L626-L684), [`#L891-L899`](../../../../front-v2/src/telas/fila/PainelFilaJobs.tsx#L891-L899) e [`#L1211-L1216`](../../../../front-v2/src/telas/fila/PainelFilaJobs.tsx#L1211-L1216)
- **Passo para reproduzir:** Abrir `PainelFilaJobs` em `1366×768` com 1 job `uncertain` e 1 pausa de orçamento ativos; tentar focar `"ETA indisponível"` via `Tab`.
- **Evidência:** A Zona 1 + abas consomem ~50% da altura da gaveta (`470 px` de largura), deixando apenas ~3 cartões visíveis e cortando o 4º item na dobra; `"ETA indisponível"` e `"Em memória nesta sessão"` usam `<Dica>` sobre `<span>` sem `tabIndex={0}` nem botão acessível.
- **Capturas:** [`09-fila-jobs-aberta-1366.png`](./capturas/onda-6/09-fila-jobs-aberta-1366.png), [`11-fila-jobs-hc-1366.png`](./capturas/onda-6/11-fila-jobs-hc-1366.png)
- **Sugestão:** Compactar o texto/espaçamento vertical dos alertas na Zona 1 quando múltiplos avisos estiverem ativos e transformar as dicas informativas em texto curto inline ou botão de ajuda de `24 × 24 px`.

---

## 4. Inventário de capturas (`docs/produto/front-v2/ui/capturas/onda-6/`)

| # | Arquivo | Viewport / Tema | Fluxo | O que verifica |
|---:|---|---|---:|---|
| 01 | `01-exportacao-prontidao-1366.png` | 1366×768 · padrão | (q) | Mesa de Prontidão (cards direto × transformado, filtro Fonte, Zona B e checklist recolhido) |
| 02 | `02-exportacao-prontidao-1440.png` | 1440×900 · padrão | (q) | Mesa de Prontidão em grade de 3 colunas e checklist aberto em `1440×900` |
| 03 | `03-exportacao-prontidao-hc-1366.png` | 1366×768 · alto contraste | (q) | Mesa de Prontidão com `[data-contrast="high"]` |
| 04 | `04-exportacao-aviso-direto-1366.png` | 1366×768 · padrão | (q) | Diálogo único de monetização de Corte direto (`guardrails.ack_direct_notice`) |
| 05 | `05-exportacao-conflitos-dialog-1366.png` | 1366×768 · padrão | (q) | Confirmação de sobrescrita (`confirmation_required` com lista de arquivos) |
| 06 | `06-exportacao-lote-progresso-1366.png` | 1366×768 · padrão | (q) | `?sub=lotes` em andamento (`core-progress` ao vivo, Zona C vs. Zona D e `Cancelar lote`) |
| 07 | `07-exportacao-lote-parcial-falhas-1440.png` | 1440×900 · padrão | (q) | Lote histórico V1 `#6399` (`partial`, selo `Caiu para x264`, filtro `Mostrar apenas falhas`) |
| 08 | `08-exportacao-lotes-hc-1440.png` | 1440×900 · alto contraste | (q) | Histórico de lotes em `[data-contrast="high"]` |
| 09 | `09-fila-jobs-aberta-1366.png` | 1366×768 · padrão | (r) | `PainelFilaJobs` (`Ctrl+J`): alertas no topo, banner `uncertain`, orçamento e lista |
| 10 | `10-fila-jobs-1440.png` | 1440×900 · padrão | (r) | `PainelFilaJobs` acoplada em `560 px` em `1440×900` |
| 11 | `11-fila-jobs-hc-1366.png` | 1366×768 · alto contraste | (r) | `PainelFilaJobs` em `[data-contrast="high"]` |
| 12 | `12-fila-dialog-retry-custo-1366.png` | 1366×768 · padrão | (r) | Diálogo `Repetir tarefa #2` com `<ResumoCustoPrivacidade>` (`jobs.estimate`) |
| 13 | `13-fila-dialog-orcamento-1440.png` | 1440×900 · padrão | (r) | Diálogo `Ajustar orçamento e continuar fila` (`cost_unknown` + confirmação explícita) |
| 14 | `14-fila-dialog-redo-result-1366.png` | 1366×768 · padrão | (r) | Diálogo `Refazer job #2 com outro Perfil` (com nota `#304` sem expor ticket) |
| 15 | `15-fila-toast-abrir-fila-1366.png` | 1366×768 · padrão | (r) | Toast `"Tarefa falhou"` com `"Abrir Fila"` sobreposto ao botão primário da Zona B |
| 16 | `16-relatos-passo1-segredo-1366.png` | 1366×768 · padrão | (s) | `#/relatos` Passo 1 com alerta de segredo (`role="alert"`) e sonda de hardware expandida |
| 17 | `17-relatos-passo2-revisao-1440.png` | 1440×900 · padrão | (s) | `#/relatos` Passo 2 em layout 60/40 com painel auxiliar de hardware e allowlist |
| 18 | `18-relatos-hc-1366.png` | 1366×768 · alto contraste | (s) | `#/relatos` Passo 2 em `[data-contrast="high"]` após cópia por URL > 8 KB |
| 19 | `19-sobre-padrao-1366.png` | 1366×768 · padrão | (s) | `#/sobre`: versão instalada, atualizador explícito e Licença Apache-2.0 |
| 20 | `20-sobre-atualizacao-atribuicoes-1440.png` | 1440×900 · padrão | (s) | `#/sobre?updater-test=available` (`Baixar e instalar 0.2.0`) e aba `Atribuições de terceiros` |
| 21 | `21-sobre-hc-reinicio-critico-1440.png` | 1440×900 · alto contraste | (s) | `#/sobre` em `[data-contrast="high"]` com `<ConfirmDialog>` de reinício e operação em voo |
| 22 | `22-estado-exportacao-vazio-1366.png` | 1366×768 · padrão | (t) | `#/projeto/demo/exportacao?estado=vazio` (`Nenhum Corte aprovado para exportar`) |
| 23 | `23-estado-exportacao-erro-1366.png` | 1366×768 · padrão | (t) | `#/projeto/demo/exportacao?estado=erro` (`component_missing` em `<BannerErroCore>`) |
| 24 | `24-estado-fila-sem-projeto-1366.png` | 1366×768 · padrão | (t) | `#/inicio` sem Projeto aberto com `PainelFilaJobs` aberta (`Nenhum Projeto aberto`) |
