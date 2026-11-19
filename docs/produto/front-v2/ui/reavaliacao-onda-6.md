# Reavaliação independente de UI — Onda 6 (Exportação, Fila de Jobs, Relatos e Sobre)

> ⚠️ **DEGRADED: single-context (critique + audit em sessão única com sub-checagens automatizadas em Playwright, sem subagente independente nem navegador interativo manual além da suíte E2E + auditoria DOM + `impeccable detect`; ambiente mock TS `VITE_CORE_MOCK=1`, sem Tauri).**

- **Data da reavaliação:** 2026-11-19
- **Commit avaliado (`HEAD`):** `0e8c8cb` (`origin/master`, incorporando `6987e9c` — PR `#480` / `#475`, correções de `UI-80` a `UI-87` e `UI-70`)
- **Linha de base comparada:** `bb3716d` / `3d83bbf` ([avaliacao-onda-6.md](./avaliacao-onda-6.md))
- **Referências:** [`DESIGN.md`](../../../../DESIGN.md), [`GLOSSARY.md`](../../../../GLOSSARY.md), [`10-plano-onda-6.md`](../10-plano-onda-6.md), [`F-exportacao-fila-relatos.md`](../telas/F-exportacao-fila-relatos.md), [`reavaliacao-onda-4.md`](./reavaliacao-onda-4.md)
- **Script reproduzível:** [`front-v2/e2e/ui-onda6.spec.ts`](../../../../front-v2/e2e/ui-onda6.spec.ts) (executado integralmente e sem alterações com `UI_BASELINE=1`; nenhuma tela ou teste foi alterado neste PR)
- **Capturas:** 24 PNGs em [`docs/produto/front-v2/ui/capturas/onda-6-reav/`](./capturas/onda-6-reav/)

---

## 1. Cenário executado e evidências automatizadas

O cenário fixo da linha de base foi reproduzido do começo ao fim em [`front-v2/e2e/ui-onda6.spec.ts`](../../../../front-v2/e2e/ui-onda6.spec.ts) com `VITE_CORE_MOCK=1`, nos viewports `1366×768` e `1440×900`, tema escuro padrão e modo de alto contraste (`[data-contrast="high"]`). As 24 capturas geradas foram movidas para `docs/produto/front-v2/ui/capturas/onda-6-reav/` e as capturas originais de `onda-6/` foram restauradas via `git checkout`.

### 1.1 Comandos verificados

| Verificação | Comando | Resultado observado |
|---|---|---|
| Instalação | `cd front-v2; bun install` | `152 packages installed [19.80s]`, exit `0` |
| Static UI check | `impeccable detect --json front-v2/src` | `[]` (zero detecções), exit `0` |
| Contraste tokens DS | `cd design-system-v2; bun scripts/contraste.ts` | `Todos os pares passam.` (escuro, claro, escuro `[data-contrast="high"]`, claro `[data-contrast="high"]`), exit `0` |
| Typecheck | `cd front-v2; bun run typecheck` (`tsc --noEmit`) | Exit `0` |
| E2E CI padrão | `cd front-v2; bunx playwright test --reporter=list` (sem `UI_BASELINE`) | `37 passed`, `5 skipped` (`ui-baseline`, `ui-onda2`, `ui-onda3`, `ui-onda4`, `ui-onda6`) em `48.8s`, exit `0` |
| Reavaliação Onda 6 + DOM audit | `$env:UI_BASELINE="1"; bunx playwright test e2e/ui-onda6.spec.ts --reporter=list` | `1 passed (39.0s)`, `erros: []` (`0 pageerror`), 24 capturas geradas e 21 auditorias DOM, exit `0` |

### 1.2 Síntese das verificações transversais nas 21 medições DOM

- **Contraste de texto (DOM):** `0` textos abaixo de `4,5:1` (`3:1` grande) nas 21 medições (`1366×768` e `1440×900`, padrão e `[data-contrast="high"]`).
- **Headings / Semântica:** `h1Count = 1`, `saltoHeading = null`, `semNomeAcessivel = 0` e `imagensQuebradas = 0` em todas as 21 medições (`MesaProntidao` agora inclui `<h2 className="sr-only">Cortes aprovados</h2>`, resolvendo **UI-83**). Os wrappers `<span tabIndex={0}>` em botões desabilitados de `MesaProntidao` foram eliminados (`spanTabIndexZero: []` em `01`–`03`). *(Os `span[tabindex="0"]` reportados em `Relatos` e nos diálogos correspondem ao `<Checkbox>` acessível `role="checkbox"` e aos focus-guards internos do `@base-ui/react`.)*
- **Overflow externo e tabelas:** `0 px` de overflow horizontal ou vertical na viewport (`scrollW === innerW` e `scrollH === innerH`) e `overflowTabelasInternas = 0` em todas as 21 medições.
- **Alvos ≥ 24 px (WCAG 2.5.8):** `alvosMenores24: []` em todas as 21 medições — corrigidos os alvos da `BarraStatus` (`Onda e miniaturas 42%`, **UI-70** / **UI-82**), `DialogoRefazerJob` (`size-6`), `"Ver em Histórico"` e `"Itens do lote"`.
- **Teclado (`F6`, `Esc` e foco inicial):** Em `Exportacao`, `F6` passou a incluir `fila` (`regioesF6ExportacaoComFila: ["conteudo", "fila", "rodape", "topo", "conteudo", "fila", "rodape"]`) e `Esc` dentro da Fila após `Tab` em `"Fechar Fila (Esc)"` passou a fechar a gaveta (`escapeFechouAposTab: true`, **UI-80**). Permanecem: `focoInicialRetry: "Ver estimativa e repetir"` em `DialogoTentarDeNovo` (**UI-82** parcial), `regioesF6CortesComFila` omitindo `fila` em `#/projeto/demo/cortes` e `escapeFechouExportFila: false` quando o foco sai da Fila via `F6` (**UI-90**).
- **Toasts e Regra da Luz Única:** `t-fila-sem-projeto` (`#/inicio + Fila`) e os diálogos de `MesaProntidao` agora mantêm `botoesPrimariosSinal: 1` (**UI-84** parcial; diálogos da Fila sobre `Cortes` mantêm `2`). O toast da Fila passou a expirar em `4 s` (`Shell.tsx:420`), mas ainda sobrepõe o botão primário de `Exportacao` enquanto visível (`sobreposicaoToast: true` em `15`, **UI-81** parcial).
- **Glossário e referências internas:** `ticketRefsVisiveis: []` em todas as 21 medições (**UI-86**); permanece apenas `"Clipe da sonda de hardware"` em `THIRD_PARTY_NOTICES.md` (`glossarioViolacoes: ["clipe (exceto marca Clipes): Clipe"]` em `s-sobre-atualizacao-1440`).

---

## 2. Notas por fluxo (Nielsen H1–H10) e Audit Impeccable

Meta do projeto: **≥ 90% por fluxo (≥ 36/40)**, **WCAG 2.2 AA** (incl. alto contraste e 2.1.4) e **zero bloqueador funcional**.
Legenda: **H1** Visibilidade de estado · **H2** Mundo real / vocabulário · **H3** Controle e liberdade · **H4** Consistência e padrões · **H5** Prevenção de erros · **H6** Reconhecimento vs. lembrança · **H7** Flexibilidade e atalhos · **H8** Estética e minimalismo · **H9** Recuperação de erros · **H10** Ajuda e documentação.

| Fluxo | H1 | H2 | H3 | H4 | H5 | H6 | H7 | H8 | H9 | H10 | Original (`bb3716d`) | Agora (`0e8c8cb`) | Delta | % Agora | Meta (≥ 90%) |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|:---:|
| **(q)** Exportação (Mesa de Prontidão, Lote e Histórico) | 4 | 4 | 3 | 4 | 4 | 4 | 4 | 3 | 4 | 4 | 33/40 (82,5%) | **38/40** | **+5 (+12,5 p.p.)** | **95,0%** | ✅ Atendida |
| **(r)** Painel Global da Fila de Jobs (`Ctrl+J`, região `fila`) | 4 | 3 | 3 | 3 | 4 | 4 | 3 | 4 | 4 | 4 | 33/40 (82,5%) | **36/40** | **+3 (+7,5 p.p.)** | **90,0%** | ✅ Atendida |
| **(s)** Relatos e Diagnóstico (`#/relatos`) e Sobre (`#/sobre`) | 4 | 3 | 4 | 4 | 4 | 4 | 4 | 4 | 4 | 4 | 39/40 (97,5%) | **39/40** | **0 (0,0 p.p.)** | **97,5%** | ✅ Atendida |
| **(t)** Estados de erro, vazios, carregamento e sem Projeto | 4 | 4 | 4 | 4 | 4 | 4 | 4 | 4 | 4 | 4 | 38/40 (95,0%) | **40/40** | **+2 (+5,0 p.p.)** | **100,0%** | ✅ Atendida |

> **Nota sobre meta e WCAG 2.2 AA:** Todos os 4 fluxos atingiram a meta de **≥ 90%** (`90,0%` a `100,0%`), com `0` violações de contraste, `0` alvos `< 24 px` (SC 2.5.8 atendido), `0` saltos de heading e `0` bloqueadores `P0` permanentes. Permanece **1 bloqueio temporário (4 s)** por sobreposição do toast sobre o botão primário da Mesa (**UI-81** parcial) e **2 achados `P2` de teclado/foco** (**UI-82** parcial e **UI-90**).

### Justificativa de cada heurística que mudou (ou permaneceu < 4)

- **Fluxo (q) · `33/40 → 38/40` (+5 pts / +12,5 p.p.):**
  - **H1 (`3 → 4`, +1):** `ChecklistGuardaCorpos` abre sincronizado na 1ª carga da Mesa quando `abertoPorPadrao` passa a `true` ([`01-exportacao-prontidao-1366.png`](./capturas/onda-6-reav/01-exportacao-prontidao-1366.png), [`02-exportacao-prontidao-1440.png`](./capturas/onda-6-reav/02-exportacao-prontidao-1440.png), **UI-85**); Zona C de `HistoricoLotes` acompanha o lote ao vivo (`1/2 concluído · 62%`, sincronizado com Zona D, [`06-exportacao-lote-progresso-1366.png`](./capturas/onda-6-reav/06-exportacao-lote-progresso-1366.png), **UI-85**).
  - **H2 (`3 → 4`, +1):** `HistoricoLotes` traduz códigos de encoder e falha (`placa de vídeo NVIDIA`, `de placa de vídeo NVIDIA: a codificação falhou` em `06` e [`07-exportacao-lote-parcial-falhas-1440.png`](./capturas/onda-6-reav/07-exportacao-lote-parcial-falhas-1440.png), **UI-86**) e ajusta concordância (`1 concluído` / `2 concluídos`, **UI-85**).
  - **H3 (`2 → 3`, +1):** `Exportacao` delegou `F6` ao `Shell`, permitindo alcançar `[data-regiao="fila"]`, e o toast da Fila deixou de ser persistente (`timeout: 4000`, **UI-80** / **UI-81**). Permanece em `3` porque o toast no canto inferior direito ainda sobrepõe e impede cliques no botão primário `"Exportar N aprovados em lote"` durante os 4 s em que permanece na tela ([`15-fila-toast-abrir-fila-1366.png`](./capturas/onda-6-reav/15-fila-toast-abrir-fila-1366.png), `sobreposicaoToast: true`, **UI-81** parcial), e `Esc` não fecha a Fila se o foco sair dela via `F6` (`escapeFechouExportFila: false`, **UI-90**).
  - **H4 (`3 → 4`, +1):** Adicionado `<h2 className="sr-only">Cortes aprovados</h2>` (`saltoHeading: null`), removidos `<span tabIndex={0}>` em botões desabilitados (**UI-83**), todos os alvos ≥ 24 px (`alvosMenores24: []`, **UI-70**/**UI-82**) e botão primário da Zona B rebaixado quando há diálogo aberto (`04`, `05`, **UI-84**).
  - **H7 (`3 → 4`, +1):** Ciclo `F6` / `Shift+F6` em `Exportacao` percorre todas as regiões incluindo a Fila aberta (**UI-80**).
  - **H8 (`3 → 3`, 0):** Remoção do ruído de wrappers focáveis e ajuste da Zona A limpam a leitura, mas permanece em `3` devido à colisão visual/funcional do toast sobre o botão primário da Zona B em `15` (**UI-81** parcial).

- **Fluxo (r) · `33/40 → 36/40` (+3 pts / +7,5 p.p.):**
  - **H2 (`3 → 3`, 0):** Cards da Fila agora traduzem `Perfil configurado`, `Lote de Fontes 3` e `Codex` ([`09-fila-jobs-aberta-1366.png`](./capturas/onda-6-reav/09-fila-jobs-aberta-1366.png)) e `DialogoResultadoJob` usa `"Concluído com sucesso"` (**UI-86**); permanece em `3` porque o banner de orçamento na Fila e o `DialogoOrcamento` ainda mostram `"Lote: sources-3"` cru (`09`, `10`, `11`, [`13-fila-dialog-orcamento-1440.png`](./capturas/onda-6-reav/13-fila-dialog-orcamento-1440.png), **UI-86** parcial).
  - **H3 (`2 → 3`, +1):** `Esc` dentro de `PainelFilaJobs` agora fecha a gaveta mesmo após `Tab` focar `"Fechar Fila (Esc)"` (`escapeFechouAposTab: true`, **UI-80**). Permanece em `3` porque `DialogoTentarDeNovo` continua sem mover o foco inicial para `"Cancelar"` (`focoInicialRetry: "Ver estimativa e repetir"`, [`12-fila-dialog-retry-custo-1366.png`](./capturas/onda-6-reav/12-fila-dialog-retry-custo-1366.png), **UI-82** parcial) e `Esc` não fecha a Fila se o foco tiver saído da gaveta via `F6` (**UI-90**).
  - **H4 (`3 → 3`, 0):** Alvos `< 24 px` na `BarraStatus`, `DialogoRefazerJob` e sublista de lotes foram corrigidos (`alvosMenores24: []`, [`14-fila-dialog-redo-result-1366.png`](./capturas/onda-6-reav/14-fila-dialog-redo-result-1366.png), **UI-70**/**UI-82**); permanece em `3` por `botoesPrimariosSinal: 2` com `Cortes` atrás do véu nos diálogos da Fila (`12`–`14`, **UI-84** parcial) e por `DialogoResultadoJob` aplicar `variante="primario"` ao botão `"Fechar"` (**UI-91**).
  - **H6 (`3 → 4`, +1):** `<Dica>` de `"ETA indisponível"` e `"Em memória nesta sessão"` passaram a `<button type="button">` focáveis por teclado (`PainelFilaJobs.tsx:903,1222`, **UI-87**).
  - **H7 (`3 → 3`, 0):** `Esc` após `Tab` na Fila foi corrigido (**UI-80**), mas permanece em `3` porque na tela de `Seleção de Cortes` (`#/projeto/:id/cortes`) o ciclo `F6` ainda omite `[data-regiao="fila"]` (`regioesF6CortesComFila`, **UI-90**).
  - **H8 (`3 → 4`, +1):** Zona 1 limitada a `max-h-[40%]` com rolagem interna devolve espaço aos cartões em `1366×768` (`09`, [`11-fila-jobs-hc-1366.png`](./capturas/onda-6-reav/11-fila-jobs-hc-1366.png), **UI-87**).

- **Fluxo (s) · `39/40 → 39/40` (0 pt / 0,0 p.p.):**
  - **H2 (`3 → 3`, 0):** `Relatos` melhorou rótulos da sonda (`Motor / Modelo`, `Placa de vídeo · precisão int8_float16 (verificado)`, `lote seguro: 8 (medido)` em `16`, `17`) e `THIRD_PARTY_NOTICES.md` removeu `#50`/`#60` (`ticketRefsVisiveis: []` em [`20-sobre-atualizacao-atribuicoes-1440.png`](./capturas/onda-6-reav/20-sobre-atualizacao-atribuicoes-1440.png), **UI-86**); permanece em `3` porque `THIRD_PARTY_NOTICES.md:60` ainda traz `## Clipe da sonda de hardware` (`glossarioViolacoes: ["clipe (exceto marca Clipes): Clipe"]`) e `Relatos` ainda expõe `int8_float16` (`16`, `17`).

- **Fluxo (t) · `38/40 → 40/40` (+2 pts / +5,0 p.p.):**
  - **H4 (`3 → 4`, +1):** Em `#/inicio + Fila` (`24`), `"Ir para Início"` foi ocultado e o estado vazio da gaveta não usa `.bg-sinal` (`botoesPrimariosSinal: 1`, **UI-84**); botão de job ativo na `BarraStatus` passou para `min-h-6` (`alvosMenores24: []`, **UI-70**/**UI-82**).
  - **H8 (`3 → 4`, +1):** Eliminada a redundância visual de dois botões `.bg-sinal` e do botão `"Ir para Início"` na própria rota `#/inicio` ([`24-estado-fila-sem-projeto-1366.png`](./capturas/onda-6-reav/24-estado-fila-sem-projeto-1366.png), **UI-84**).

### Impeccable Audit (`/20`)

| Dimensão | Original (`bb3716d`) | Agora (`0e8c8cb`) | Delta | Síntese |
|---|---:|---:|---:|---|
| Contraste e Cor | 4 | **4** | **0** | `contraste.ts` 100% aprovado nos 4 modos; `0` violações de contraste de texto nas 21 medições DOM (`1366×768`, `1440×900` e alto contraste). |
| Tipografia e Hierarquia | 3 | **4** | **+1** | `h1Count = 1` e `saltoHeading: null` em todas as 21 medições (**UI-83**), `num` tabular consistente e tradução de strings na maioria dos pontos (**UI-86**). |
| Layout, Espaçamento e Viewport | 3 | **3** | **0** | `0 px` de overflow externo e de tabelas nas 21 medições; Zona 1 da Fila limitada a `40%` em `1366×768` (**UI-87**); mantém `3` pela sobreposição temporária (4 s) do toast sobre o botão primário da Zona B em `Exportacao` (**UI-81** parcial). |
| Alvos, Teclado e A11y AA | 2 | **3** | **+1** | `alvosMenores24: []` em todas as 21 medições (**UI-70**, **UI-82** alvos), `F6` em `Exportacao` alcança a Fila e `Esc` após `Tab` fecha a gaveta (**UI-80**), fim de `<span tabIndex={0}>` em desabilitados (**UI-83**) e `<Dica>` focáveis na Fila (**UI-87**). Perde 1 ponto pelo foco inicial de `DialogoTentarDeNovo` (**UI-82** parcial) e por `F6` em `Selecao` omitindo `fila` + `Esc` fora da gaveta (**UI-90**). |
| Sobriedade Visual (*Luz Única* / *Estado Cinza*) | 3 | **4** | **+1** | *Regra da Luz Única* restaurada em `#/inicio + Fila` e nos diálogos de `MesaProntidao` (**UI-84**), `ChecklistGuardaCorpos` aberto na 1ª carga e Zona C sincronizada (**UI-85**). *(Resíduos pontuais em `Cortes` atrás de `DialogosFila` e em `"Fechar"` de `DialogoResultadoJob`, **UI-91**.)* |
| **Total Audit Impeccable** | **15/20** *(75%)* | **18/20** *(90%)* | **+3 (+15 p.p.)** | **Meta ≥ 90% atingida nos 4 fluxos; alvos `< 24 px` e headings 100% limpos; restam ajustes pontuais de toast/foco/F6 (`UI-81`, `UI-82`, `UI-90`, `UI-91`).** |

---

## 3. Status dos achados da linha de base (`UI-80` a `UI-87` e `UI-70`)

| ID | Sev. | Resumo na linha de base | Status | Evidência na reavaliação (captura / passo / código) |
|---|---|---|---|---|
| **UI-70** | **P2** | Botão de job ativo na `BarraStatus` (`Shell.tsx`) media `159,2 × 21,4 px` (< 24 px) | **Resolvido** | `Shell.tsx:790,803` adicionou `min-h-6` nos botões de job ativo e chamadas incertas. `alvosMenores24: []` em todas as 21 medições DOM (incl. `Onda e miniaturas 42%` em [`01`](./capturas/onda-6-reav/01-exportacao-prontidao-1366.png)–[`23`](./capturas/onda-6-reav/23-estado-exportacao-erro-1366.png)). |
| **UI-80** | **P1** | `Exportacao` interceptava `F6` omitindo `fila`; `Esc` falhava na Fila após `Tab` em `Fechar Fila (Esc)` | **Resolvido** | `Exportacao.tsx` removeu o listener próprio de `F6`, delegando ao `Shell.tsx:486-509`: `regioesF6ExportacaoComFila = ["conteudo","fila","rodape","topo","conteudo","fila","rodape"]`. `PainelFilaJobs.tsx:356-371` ignora `defaultPrevented` de `<Dica>`: `escapeFechouAposTab: true` em `t-fila-sem-projeto`. *(Lacunas correlatas em `Selecao` e `Esc` fora do `<aside>` registradas em **UI-90**.)* |
| **UI-81** | **P1** | Toast persistente de erro (`Abrir Fila`) no canto inferior direito bloqueava botão primário de `Exportacao` | **Parcial** | `Shell.tsx:419-420` definiu `timeout: 4000` (deixando o erro fixo no topo e encerrando a persistência indefinida). Porém `ProvedorToast` (`Indicadores.tsx:156`) segue fixo em `right-4 bottom-10`, ainda sobrepondo e bloqueando o botão primário `"Exportar 4 aprovados em lote"` durante os 4 s em que está visível (`sobreposicaoToast: true` em [`15-fila-toast-abrir-fila-1366.png`](./capturas/onda-6-reav/15-fila-toast-abrir-fila-1366.png)). |
| **UI-82** | **P2** | `DialogoTentarDeNovo` não focava `"Cancelar"`; alvos `< 24 px` em `DialogoRefazerJob`, `BarraStatus` e listas | **Parcial** | **Alvos resolvidos:** `DialogosFila.tsx:590` usa `size-6`, `Shell.tsx:790,803`, `Exportacao.tsx` e `PainelFilaJobs.tsx:1047` usam `min-h-6` (`alvosMenores24: []` nas 21 medições, [`14-fila-dialog-redo-result-1366.png`](./capturas/onda-6-reav/14-fila-dialog-redo-result-1366.png)). **Não resolvido em `DialogoTentarDeNovo`:** `DialogosFila.tsx:199` mantém `if (!job) return null`, montando `<ConfirmDialog>` já com `aberto={true}`; `checksExtras.fila.focoInicialRetry` segue em `"Ver estimativa e repetir"` ([`12-fila-dialog-retry-custo-1366.png`](./capturas/onda-6-reav/12-fila-dialog-retry-custo-1366.png)). |
| **UI-83** | **P2** | `<span tabIndex={0}>` em botões desabilitados e salto `h1 → h3` na Zona A de `MesaProntidao` | **Resolvido** | `MesaProntidao.tsx:877` inseriu `<h2 className="sr-only">Cortes aprovados</h2>` (`saltoHeading: null` nas 21 medições) e removeu `<span tabIndex={0}>` de `"Converter em Vídeo transformado"` e `"Salvar pasta padrão"` (`spanTabIndexZero: []` em `q-exportacao-prontidao-*`, [`01`](./capturas/onda-6-reav/01-exportacao-prontidao-1366.png)–[`03`](./capturas/onda-6-reav/03-exportacao-prontidao-hc-1366.png)). |
| **UI-84** | **P2** | Violação da *Regra da Luz Única*: dois `.bg-sinal` em `#/inicio + Fila` e atrás de modais | **Parcial** | **Resolvido em `#/inicio + Fila`:** `PainelFilaJobs.tsx:778-782` remove `"Ir para Início"` na rota `#/inicio` e não usa CTA primário (`botoesPrimariosSinal: 1` em [`24-estado-fila-sem-projeto-1366.png`](./capturas/onda-6-reav/24-estado-fila-sem-projeto-1366.png)). **Resolvido em `MesaProntidao`:** `MesaProntidao.tsx:1073` rebaixa o botão quando `algumDialogoAberto` (`botoesPrimariosSinal: 1` em [`04`](./capturas/onda-6-reav/04-exportacao-aviso-direto-1366.png), [`05`](./capturas/onda-6-reav/05-exportacao-conflitos-dialog-1366.png)). **Pendente nos diálogos da Fila sobre `Cortes`:** `12`, `13`, `14` mantêm `botoesPrimariosSinal: 2` (`"Selecionar Cortes"` atrás do véu + botão do modal). |
| **UI-85** | **P2** | `ChecklistGuardaCorpos` abria recolhido na 1ª carga e Zona C ficava em `0/2` (`1 concluídos`) | **Resolvido** | `Avisos.tsx:103-112` sincroniza `aberto` com `abertoPorPadrao` até interação manual (`01` e `02` abrem expandidos). Em [`06-exportacao-lote-progresso-1366.png`](./capturas/onda-6-reav/06-exportacao-lote-progresso-1366.png), Zona C mostra `"1/2 concluído 62%"` alinhada à Zona D (`"62% (1 concluído · 1 exportando...)"`). |
| **UI-86** | **P3** | Strings técnicas cruas na Fila, `HistoricoLotes`, `Relatos` e `THIRD_PARTY_NOTICES.md` | **Parcial** | Cards da Fila (`Perfil configurado`, `Lote de Fontes 3`, `Codex`, `09`), `HistoricoLotes` (`placa de vídeo NVIDIA`, `a codificação falhou`, `06`/`07`), `DialogoResultadoJob` (`Concluído com sucesso`) e `THIRD_PARTY_NOTICES.md` (sem `#50`/`#60`, `20`) foram corrigidos. **Restam:** `"Lote: sources-3"` no banner de orçamento e em `DialogoOrcamento` (`rotuloEscopoOrcamento` em `DialogosFila.tsx:83`, visível em `09`–`11` e `13`), `"Clipe da sonda de hardware"` em `THIRD_PARTY_NOTICES.md:60` (`glossarioViolacoes` em `s-sobre-atualizacao-1440`) e `int8_float16` em `Relatos` (`16`, `17`). |
| **UI-87** | **P3** | Banners comprimiam a lista da Fila em `1366×768` e `<Dica>` em `<span>` sem teclado | **Resolvido** | `PainelFilaJobs.tsx:631` aplica `max-h-[40%] shrink-0 overflow-y-auto` na Zona 1 (`09` e `11` exibem 3 cards completos e o 4º visível em `1366×768`); `<Dica>` em `PainelFilaJobs.tsx:903,1222` usa `<button type="button">` com `min-h-6` e classe `foco`. |

---

## 4. Achados novos (`UI-90` em diante)

> Zero bloqueadores `P0` e zero `P1` novos. Foram identificados **1 achado `P2`** (A11y AA / teclado em `Selecao` + `Esc` fora da gaveta da Fila) e **1 achado `P3`** (botão `"Fechar"` de diálogo apenas de leitura usando `.bg-sinal`).

| ID | Sev. | Categoria | Tela / Arquivo | Passo para reproduzir | Captura / Evidência | Sugestão de correção |
|---|---|---|---|---|---|---|
| **UI-90** | **P2** | A11y AA / teclado | `Selecao` (`front-v2/src/telas/cortes/Selecao.tsx:130-142`) e `PainelFilaJobs` (`front-v2/src/telas/fila/PainelFilaJobs.tsx:597`) | (1) Abrir `#/projeto/demo/cortes`, pressionar `Ctrl+J` e pressionar `F6` 6 vezes; (2) Em `#/projeto/demo/exportacao`, abrir a Fila (`Ctrl+J`), pressionar `F6` 7 vezes (até `rodape`) e pressionar `Esc`. | `checksExtras.fila.regioesF6CortesComFila` = `["conteudo","conteudo","rodape","topo","conteudo","conteudo"]` (`fila` omitida por `obterRegioes()` em `Selecao.tsx:136-141`). `checksExtras.exportacao.escapeFechouExportFila = false` porque `onKeyDownCapture={aoTeclarNoPainel}` está preso apenas ao `<aside>` e não responde quando o foco sai da gaveta por `F6`. | Incluir `document.querySelector<HTMLElement>('[data-regiao="fila"]')` em `obterRegioes()` de `Selecao.tsx` e registrar o atalho `Escape` da `PainelFilaJobs` em `window` (cedendo apenas a modais/popovers abertos). |
| **UI-91** | **P3** | visual (*Luz Única*) | `DialogoResultadoJob` (`front-v2/src/telas/fila/DialogosFila.tsx:683`) | Na Fila (`Ctrl+J`), clicar em `"Ver resultado"` no job `#4` (`Roteiro`). | `r-fila-dialog-resultado` registra `botoesPrimariosSinal: 2` (`["Selecionar Cortes", "Fechar"]`): um diálogo somente de leitura destaca `"Fechar"` como ação primária `.bg-sinal`, contrariando a *Regra da Luz Única* (`DESIGN.md`). | Alterar `<Botao variante="primario">` para `variante="secundario"` em `"Fechar"` de `DialogoResultadoJob` (`DialogosFila.tsx:683`). |

---

## 5. Inventário de capturas (`docs/produto/front-v2/ui/capturas/onda-6-reav/`)

Total: **24 arquivos PNG** gerados por `front-v2/e2e/ui-onda6.spec.ts` (`$env:UI_BASELINE = "1"`).

| # | Arquivo | Viewport / Tema | Fluxo | O que verifica |
|---:|---|---|---:|---|
| 01 | [`01-exportacao-prontidao-1366.png`](./capturas/onda-6-reav/01-exportacao-prontidao-1366.png) | 1366×768 · padrão | (q) | Mesa de Prontidão com `<h2>` na Zona A (**UI-83**), checklist sincronizado (**UI-85**) e `BarraStatus` ≥ 24 px (**UI-70**) |
| 02 | [`02-exportacao-prontidao-1440.png`](./capturas/onda-6-reav/02-exportacao-prontidao-1440.png) | 1440×900 · padrão | (q) | Mesa de Prontidão em 3 colunas com checklist aberto na carga inicial (**UI-85**) |
| 03 | [`03-exportacao-prontidao-hc-1366.png`](./capturas/onda-6-reav/03-exportacao-prontidao-hc-1366.png) | 1366×768 · alto contraste | (q) | Mesa de Prontidão em `[data-contrast="high"]` sem `<span tabIndex={0}>` (**UI-83**) |
| 04 | [`04-exportacao-aviso-direto-1366.png`](./capturas/onda-6-reav/04-exportacao-aviso-direto-1366.png) | 1366×768 · padrão | (q) | Diálogo de Corte direto com botão da Zona B rebaixado (`botoesPrimariosSinal: 1`, **UI-84**) |
| 05 | [`05-exportacao-conflitos-dialog-1366.png`](./capturas/onda-6-reav/05-exportacao-conflitos-dialog-1366.png) | 1366×768 · padrão | (q) | Confirmação de sobrescrita com `1` único `.bg-sinal` visível (**UI-84**) |
| 06 | [`06-exportacao-lote-progresso-1366.png`](./capturas/onda-6-reav/06-exportacao-lote-progresso-1366.png) | 1366×768 · padrão | (q) | Lote ao vivo com Zona C sincronizada (`1/2 concluído`, **UI-85**) e encoder humano (**UI-86**) |
| 07 | [`07-exportacao-lote-parcial-falhas-1440.png`](./capturas/onda-6-reav/07-exportacao-lote-parcial-falhas-1440.png) | 1440×900 · padrão | (q) | Lote histórico `#6399` com `"de placa de vídeo NVIDIA: a codificação falhou"` (**UI-86**) |
| 08 | [`08-exportacao-lotes-hc-1440.png`](./capturas/onda-6-reav/08-exportacao-lotes-hc-1440.png) | 1440×900 · alto contraste | (q) | Histórico de lotes em `[data-contrast="high"]` |
| 09 | [`09-fila-jobs-aberta-1366.png`](./capturas/onda-6-reav/09-fila-jobs-aberta-1366.png) | 1366×768 · padrão | (r) | `PainelFilaJobs` com Zona 1 limitada a 40% (**UI-87**), cards traduzidos e resíduo `Lote: sources-3` (**UI-86**) |
| 10 | [`10-fila-jobs-1440.png`](./capturas/onda-6-reav/10-fila-jobs-1440.png) | 1440×900 · padrão | (r) | `PainelFilaJobs` acoplada em `560 px` em `1440×900` |
| 11 | [`11-fila-jobs-hc-1366.png`](./capturas/onda-6-reav/11-fila-jobs-hc-1366.png) | 1366×768 · alto contraste | (r) | `PainelFilaJobs` em `[data-contrast="high"]` com alvos ≥ 24 px |
| 12 | [`12-fila-dialog-retry-custo-1366.png`](./capturas/onda-6-reav/12-fila-dialog-retry-custo-1366.png) | 1366×768 · padrão | (r) | `DialogoTentarDeNovo` ainda com foco inicial fora de `"Cancelar"` (**UI-82** parcial) |
| 13 | [`13-fila-dialog-orcamento-1440.png`](./capturas/onda-6-reav/13-fila-dialog-orcamento-1440.png) | 1440×900 · padrão | (r) | `DialogoOrcamento` com resíduo `Lote: sources-3` (**UI-86** parcial) e `Cortes` `.bg-sinal` ao fundo |
| 14 | [`14-fila-dialog-redo-result-1366.png`](./capturas/onda-6-reav/14-fila-dialog-redo-result-1366.png) | 1366×768 · padrão | (r) | `DialogoRefazerJob` com botão de informação `24 × 24 px` (**UI-82** alvos) |
| 15 | [`15-fila-toast-abrir-fila-1366.png`](./capturas/onda-6-reav/15-fila-toast-abrir-fila-1366.png) | 1366×768 · padrão | (r) | Toast de 4 s (`Abrir Fila`) ainda sobrepondo o botão primário da Zona B (**UI-81** parcial) |
| 16 | [`16-relatos-passo1-segredo-1366.png`](./capturas/onda-6-reav/16-relatos-passo1-segredo-1366.png) | 1366×768 · padrão | (s) | `#/relatos` Passo 1 com sonda traduzida (`Motor / Modelo`, `Placa de vídeo`, `medido`) |
| 17 | [`17-relatos-passo2-revisao-1440.png`](./capturas/onda-6-reav/17-relatos-passo2-revisao-1440.png) | 1440×900 · padrão | (s) | `#/relatos` Passo 2 em 60/40 com painel auxiliar de hardware e allowlist |
| 18 | [`18-relatos-hc-1366.png`](./capturas/onda-6-reav/18-relatos-hc-1366.png) | 1366×768 · alto contraste | (s) | `#/relatos` Passo 2 em `[data-contrast="high"]` |
| 19 | [`19-sobre-padrao-1366.png`](./capturas/onda-6-reav/19-sobre-padrao-1366.png) | 1366×768 · padrão | (s) | `#/sobre`: versão instalada, atualizador e Licença Apache-2.0 |
| 20 | [`20-sobre-atualizacao-atribuicoes-1440.png`](./capturas/onda-6-reav/20-sobre-atualizacao-atribuicoes-1440.png) | 1440×900 · padrão | (s) | `#/sobre` sem `#50`/`#60` visíveis, restando `"Clipe da sonda"` em `Atribuições` (**UI-86** parcial) |
| 21 | [`21-sobre-hc-reinicio-critico-1440.png`](./capturas/onda-6-reav/21-sobre-hc-reinicio-critico-1440.png) | 1440×900 · alto contraste | (s) | `#/sobre` em `[data-contrast="high"]` com `<ConfirmDialog>` focado em `"Reiniciar mesmo assim"` |
| 22 | [`22-estado-exportacao-vazio-1366.png`](./capturas/onda-6-reav/22-estado-exportacao-vazio-1366.png) | 1366×768 · padrão | (t) | `#/projeto/demo/exportacao?estado=vazio` |
| 23 | [`23-estado-exportacao-erro-1366.png`](./capturas/onda-6-reav/23-estado-exportacao-erro-1366.png) | 1366×768 · padrão | (t) | `#/projeto/demo/exportacao?estado=erro` |
| 24 | [`24-estado-fila-sem-projeto-1366.png`](./capturas/onda-6-reav/24-estado-fila-sem-projeto-1366.png) | 1366×768 · padrão | (t) | `#/inicio` com `PainelFilaJobs` aberta e `1` único `.bg-sinal` (**UI-84**) |
