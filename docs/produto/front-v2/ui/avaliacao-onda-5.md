# Avaliação independente de UI — Onda 5 (Transformar e Empacotar)

> ⚠️ **DEGRADED: single-context (critique + audit em sessão única, sem subagente independente nem navegador interativo manual além da suíte Playwright; ambiente mock TS `VITE_CORE_MOCK=1`, sem Tauri).**

- **Data:** 2026-11-19
- **Commit avaliado:** `386a4d4` (`origin/master`, Onda 5 `#366`/`#367`/`#485`)
- **Referências:** [`DESIGN.md`](../../../../DESIGN.md), [`GLOSSARY.md`](../../../../GLOSSARY.md), [`09-plano-onda-5.md`](../09-plano-onda-5.md), [`E-corte-transformar-empacotar.md`](../telas/E-corte-transformar-empacotar.md), [`avaliacao-onda-6.md`](./avaliacao-onda-6.md)
- **Script reproduzível:** [`front-v2/e2e/ui-onda5.spec.ts`](../../../../front-v2/e2e/ui-onda5.spec.ts) (pulado sem `UI_BASELINE=1`; reaproveita cenários/seletores de [`e2e/corte-transformar.spec.ts`](../../../../front-v2/e2e/corte-transformar.spec.ts) e [`e2e/corte-empacotar.spec.ts`](../../../../front-v2/e2e/corte-empacotar.spec.ts))
- **Capturas:** 20 PNGs em [`docs/produto/front-v2/ui/capturas/onda-5-aval/`](./capturas/onda-5-aval/) (além das 4 capturas prévias do `#367` em [`docs/produto/front-v2/ui/capturas/onda-5/`](./capturas/onda-5/))

---

## 1. Cenário executado e evidências automatizadas

### 1.1 Comandos verificados

| Verificação | Comando | Resultado observado |
|---|---|---|
| Instalação | `cd front-v2; bun install` | `152 packages installed [18.81s]`, exit `0` |
| Static UI check | `impeccable detect --json front-v2/src` | `[]` (zero detecções), exit `0` |
| Contraste tokens DS | `cd design-system-v2; bun scripts/contraste.ts` | `Todos os pares passam.` (escuro, claro, alto contraste escuro e alto contraste claro), exit `0` |
| Typecheck | `cd front-v2; bun run typecheck` (`tsc --noEmit`) | Exit `0` |
| E2E Onda 5 padrão (sem `UI_BASELINE`) | `cd front-v2; bunx playwright test e2e/ui-onda5.spec.ts e2e/corte-transformar.spec.ts e2e/corte-empacotar.spec.ts --reporter=list` | `3 passed`, `1 skipped` (`ui-onda5`), em `18.6s`, exit `0` |
| Baseline Onda 5 + DOM audit | `$env:UI_BASELINE="1"; bunx playwright test e2e/ui-onda5.spec.ts --reporter=list` | `1 passed (50.0s)`, `erros: []` (`0 pageerror`), 20 capturas geradas e 24 auditorias DOM, exit `0` |

### 1.2 Auditoria transversal nas 24 medições DOM

- **Contraste de texto (DOM):** `0` violações estáticas em texto nas 24 medições (`1366×768` e `1440×900`, padrão e `[data-contrast="high"]`). Detectado apenas artefato transitório de `transition` no `<kbd>Ctrl+E</kbd>` em `?estado=carregando` logo após `?estado=vazio`.
- **Headings / Semântica:** `h1Count = 1`, `semNomeAcessivel = 0`, `imagensQuebradas = 0` e zero referências internas de ticket (`#292`, `#293`, `#299`, `#301`, `#303`, `#306`) ou violações do `GLOSSARY.md` em todas as 24 medições. Detectado salto `h1 → h3` em `Empacotar` e em `PassoNarracao` com `InstaladorJustInTime` (**UI-103**), além de `<span tabIndex={0}>` em `"Remover áudio"` e `"Preencher manualmente"` (**UI-102**).
- **Overflow externo e tabelas:** `0 px` de overflow horizontal ou vertical na viewport (`scrollW === innerW` e `scrollH === innerH`) e `overflowTabelasInternas = 0` em todas as 24 medições.
- **Alvos e teclado:** detectado link `"Registrar Permissão na Fonte"` medindo `165,8 × 17,4 px` (`< 24 px`, **UI-102**); falha de `F6` omitindo `[data-regiao="contexto"]` e `[data-regiao="fila"]` tanto em `TransformarCorte` quanto em `EmpacotarCorte`; falha de `Esc` após `Tab` em `GravadorTeleprompter` (**UI-100**). Verificados com sucesso: foco inicial em `"Cancelar"` nos diálogos de custo (`focoInicialCustoAngulo: "Cancelar"`, `focoInicialCustoPacote: "Cancelar"`), modo `Passo` automático com `prefers-reduced-motion: reduce` (`teleprompterReducedPasso: true`) e bloqueio de teclas únicas dentro de campos de texto (`wcag214Ok: true`).
- **Regra da Luz Única:** detectados `2` a `3` botões `.bg-sinal` simultâneos em praticamente todos os estados de `TransformarCorte` e atrás de modais, e `0` botões `.bg-sinal` em `Empacotar ?estado=vazio` (**UI-101**).

---

## 2. Notas por fluxo (Nielsen H1–H10) e Audit Impeccable

Meta do projeto: **≥ 90% por fluxo (≥ 36/40)**, **WCAG 2.2 AA** (incl. alto contraste e 2.1.4) e **zero bloqueador funcional**.

| Fluxo | H1 | H2 | H3 | H4 | H5 | H6 | H7 | H8 | H9 | H10 | Total | % | Meta (≥ 90%) |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|:---:|
| **(u)** Transformar (Ângulo, Roteiro em blocos, Narração, estados e Corte direto) | 3 | 3 | 2 | 2 | 4 | 4 | 3 | 3 | 4 | 4 | **32/40** | **80,0%** | ❌ Abaixo |
| **(v)** Empacotar (Capa, Ficha, Provedor/custo, Guardrails, estados e Fonte offline) | 3 | 3 | 2 | 2 | 3 | 4 | 3 | 3 | 4 | 4 | **31/40** | **77,5%** | ❌ Abaixo |

### Justificativa de cada heurística abaixo de 4

- **Fluxo (u) — Transformar:**
  - **H1 = 3:** Player nativo `<audio controls>` exibe `0:00 / 0:00` antes da reprodução na comparação Antes/Depois (`08-transformar-narracao-limpeza-revisao-1440.png`, **UI-106**).
  - **H2 = 3:** Cartão de bloco TTS exibe ID numérico bruto `"TTS · 13063"` em vez do rótulo da voz (`PassoNarracao.tsx:84`); botão `"Avançar para Empacotar →"` duplica seta gráfica e Unicode (`06`, **UI-105**); avisos usam concordância mecânica `"bloco(s) pendente(s)"` e `"acréscimo(s), troca(s)"` (`05`, `08`, **UI-105**).
  - **H3 = 2:** `TransformarCorte` intercepta `F6` omitindo `[data-regiao="contexto"]`, o painel recolhido de Transcrição e `[data-regiao="fila"]` quando a Fila está aberta (`Ctrl+J`), e `Esc` não fecha `GravadorTeleprompter` após `Tab` focar `BotaoIcone` com `<Dica>` (`escapeFechouGravador: false`, **UI-100**).
  - **H4 = 2:** Violação sistemática da *Regra da Luz Única* com 2 a 3 botões `.bg-sinal` simultâneos (`Exportar Corte` + primário do passo + modal, **UI-101**); `<span tabIndex={0}>` em `"Remover áudio"` (**UI-102**); salto `h1 → h3` com `InstaladorJustInTime` e ausência de `<h2>` no Passo 3 liberado (`06`, `09`, **UI-103**).
  - **H7 = 3:** Atalhos `Ctrl+[`, `Ctrl+S`, `Ctrl+K` e `prefers-reduced-motion` funcionam bem, mas o bloqueio de `F6` e a falha de `Esc` no gravador quebram o fluxo por teclado (**UI-100**).
  - **H8 = 3:** Competição visual de múltiplos botões `.bg-sinal` (**UI-101**), duplicação do card de ângulo selecionado logo acima da lista de sugestões (`01-transformar-angulo-1366.png`, **UI-105**) e player `<audio controls>` claro em fundo escuro (`08`, **UI-106**).
- **Fluxo (v) — Empacotar:**
  - **H1 = 3:** Enquanto o proxy ainda gera (`40%`), `PlayerProxy` exibe `"A Fonte não está no lugar de antes."` (`14`, `15`, **UI-104**); `?estado=vazio` cai em `"Fonte offline"` ao não encontrar `run=2` em `selection.list` (`19`, **UI-104**).
  - **H2 = 3:** Ficha da capa exibe `"00:05,0 Sugerido pelo Provedor de 20 s"` com `"de 20 s"` solto após o `<Status>` (`12`, **UI-105**).
  - **H3 = 2:** `EmpacotarCorte` intercepta `F6` omitindo `[data-regiao="contexto"]` e `[data-regiao="fila"]` quando a Fila está aberta (`Ctrl+J`, **UI-100**).
  - **H4 = 2:** Salto de heading `h1 → h3` em todas as medições ativas da Ficha (**UI-103**); `<span tabIndex={0}>` em `"Preencher manualmente"` (**UI-102**); link `"Registrar Permissão na Fonte"` mede `165,8 × 17,4 px` (`< 24 px`, **UI-102**); `0` botões `.bg-sinal` em `?estado=vazio` (`19`, **UI-101**).
  - **H5 = 3:** `FichaEmpacotamento.tsx:198` passa `null` como duração do Corte para `validarCapitulosTempoReal`, deixando passar capítulo após o fim do Corte (`00:24` em Corte de `20 s`, `12`, **UI-105**).
  - **H7 = 3:** `Ctrl+S`, `Ctrl+E`, `role="slider"` com `PageUp`/`PageDown`/`Home`/`End` e WCAG 2.1.4 funcionam bem; descontado pela interceptação incompleta de `F6` (**UI-100**).
  - **H8 = 3:** Ausência de botão primário em `?estado=vazio` (**UI-101**), falso estado `"A Fonte não está no lugar de antes."` durante geração do proxy (**UI-104**) e desalinhamento vertical entre `"Sugerir novamente"` e `"Idioma"` (`12`, **UI-106**).

### Impeccable Audit (`/20`)

| Dimensão | Nota (0–4) | Síntese |
|---|---:|---|
| Contraste e Cor | 4 | `contraste.ts` 100% aprovado nos 4 modos; `0` violações reais de contraste estático em texto nas 24 medições DOM (`1366×768`, `1440×900` e `[data-contrast="high"]`). |
| Tipografia e Hierarquia | 3 | `1` `<h1>` por tela e `tabular-nums` consistente em contadores, bytes UTF-8, durações e timecodes; descontado pelo salto `h1 → h3` em `Empacotar` e `InstaladorJustInTime`, falta de `<h2>` no Passo 3 liberado (**UI-103**) e strings como `TTS · 13063` / `"de 20 s"` (**UI-105**). |
| Layout, Espaçamento e Viewport | 3 | `0 px` de overflow externo na viewport e `0` overflow de tabela em todas as 24 medições; descontado pelo falso erro de Fonte ausente no `PlayerProxy` durante carga do proxy e em `?estado=vazio` (**UI-104**), card duplicado no Passo 1 (**UI-105**) e desalinhamento em `FichaEmpacotamento` (**UI-106**). |
| Alvos, Teclado e A11y AA | 2 | `F6` omite `contexto` e `fila` em `TransformarCorte` e `EmpacotarCorte`, `Esc` falha após `Tab` em `GravadorTeleprompter` (**UI-100**), `<span tabIndex={0}>` em botões desabilitados, link `"Registrar Permissão na Fonte"` com `17,4 px` de altura e `aria-describedby` desconectado no erro de `ListaChips` (**UI-102**). |
| Sobriedade Visual (*Luz Única* / *Estado Cinza*) | 2 | *Estado Cinza*, *Erro Sem Fundo* e *Sombra Flutuante* bem aplicados; descontado pela violação sistemática da *Regra da Luz Única* (`2`–`3` botões `.bg-sinal` simultâneos em `Transformar` e `0` `.bg-sinal` em `Empacotar ?estado=vazio`, **UI-101**). |
| **Total Audit Impeccable** | **14/20** | **70%** |

---

## 3. Achados (numerados a partir de `UI-100`)

| ID | Sev. | Categoria | Resumo | Local principal |
|---|---|---|---|---|
| **UI-100** | P1 | bloqueador funcional / A11y AA | `TransformarCorte` e `EmpacotarCorte` interceptam `F6` omitindo `contexto` e `fila`; `Esc` falha em `GravadorTeleprompter` após `Tab` | `TransformarCorte.tsx:652-711` · `EmpacotarCorte.tsx:395-441` · `GravadorTeleprompter.tsx:257-293` |
| **UI-101** | P1 | visual / bloqueador funcional | Violação sistemática da *Regra da Luz Única*: 2–3 `.bg-sinal` simultâneos em `Transformar` e atrás de modais; 0 `.bg-sinal` em `Empacotar ?estado=vazio` | `ContextoCorteConectado.tsx:503-510` · `PassoAngulo.tsx:427-441,532` · `PassoRoteiro.tsx:581-600` · `PassoNarracao.tsx:515-520,615-622` · `FichaEmpacotamento.tsx:551-558` |
| **UI-102** | P2 | A11y AA | `<span tabIndex={0}>` em botões desabilitados, link `"Registrar Permissão na Fonte"` `< 24 px` (`17,4 px`) e erro do `ListaChips` fora do `aria-describedby` | `PassoNarracao.tsx:866-875` · `FichaEmpacotamento.tsx:559-568,725-727` · `ListaChips.tsx:136-193` |
| **UI-103** | P2 | A11y AA | Salto de heading `h1 → h3` em `FichaEmpacotamento` e `PassoNarracao` (com `InstaladorJustInTime`); Passo 3 liberado sem `<h2>` | `FichaEmpacotamento.tsx:655,781` · `PassoNarracao.tsx:590-624` · `InstaladorJustInTime.tsx:771` |
| **UI-104** | P2 | bloqueador funcional / visual | `EmpacotarCorte ?estado=vazio` cai em `Fonte offline` e `PlayerProxy` mostra `"A Fonte não está no lugar de antes."` durante geração do proxy (`40%`) | `EmpacotarCorte.tsx:143-151` · `src/lib/core.ts:1993` · `PainelCapa.tsx:551-574` · `Midia.tsx:47-64` |
| **UI-105** | P2 | visual / texto | `TTS · 13063` cru, dupla seta `→`, plural `"bloco(s)"`, `"de 20 s"` solto na capa, card duplicado no Passo 1 e capítulos sem `cutDurationUs` | `PassoNarracao.tsx:84,499,618-621,964-965` · `PassoAngulo.tsx:493-599` · `PainelCapa.tsx:628` · `FichaEmpacotamento.tsx:198` |
| **UI-106** | P3 | visual | Player `<audio controls>` nativo claro em tema escuro, desalinhamento `Sugerir novamente` × `Idioma` e toasts sobrepondo controles no canto inferior direito | `PassoNarracao.tsx:928` · `FichaEmpacotamento.tsx:573-601` · `Shell.tsx:414-424` |

### Detalhamento dos achados

#### UI-100 — `TransformarCorte` e `EmpacotarCorte` interceptam `F6` omitindo `contexto` e `fila`; `Esc` falha em `GravadorTeleprompter` após `Tab` (P1 · bloqueador funcional / A11y AA)
- **Tela / Arquivos:** `#/projeto/:id/corte/:corteId/transformar`, `#/projeto/:id/corte/:corteId/empacotar` e `<GravadorTeleprompter>` — [`front-v2/src/telas/corte/transformar/TransformarCorte.tsx#L652-L711`](../../../../front-v2/src/telas/corte/transformar/TransformarCorte.tsx#L652-L711), [`front-v2/src/telas/corte/empacotar/EmpacotarCorte.tsx#L395-L441`](../../../../front-v2/src/telas/corte/empacotar/EmpacotarCorte.tsx#L395-L441) e [`front-v2/src/componentes/GravadorTeleprompter.tsx#L257-L293`](../../../../front-v2/src/componentes/GravadorTeleprompter.tsx#L257-L293)
- **Passo para reproduzir:** (1) Em `Transformar` ou `Empacotar`, abrir a Fila (`Ctrl+J`) e pressionar `F6` 7 vezes; (2) No Passo 3, clicar em `"Gravar no microfone"`, pressionar `Tab` (focando `A-`, que usa `<Dica>`) e pressionar `Esc`.
- **Evidência:** Tanto `TransformarCorte.tsx:653` quanto `EmpacotarCorte.tsx:396` usam listener próprio em `window` com `e.stopImmediatePropagation()` sem incluir `[data-regiao="contexto"]` nem `[data-regiao="fila"]` (`regioesF6TransformarComFila = ["transformar-principal","rodape","topo",...]` e `regioesF6EmpacotarComFila = ["empacotar-capa","empacotar-ficha","rodape","topo",...]`), tornando inalcançáveis por `F6` as sub-abas do Corte e a gaveta da Fila aberta. No gravador, após `Tab` focar `button:A-`, `escapeFechouGravador` retornou `false` porque `<Dica>` consome o `Escape` antes do listener em fase de bolha de `GravadorTeleprompter.tsx:291`.
- **Capturas:** [`01-transformar-angulo-1366.png`](./capturas/onda-5-aval/01-transformar-angulo-1366.png), [`07-transformar-narracao-gravador-1366.png`](./capturas/onda-5-aval/07-transformar-narracao-gravador-1366.png), [`12-empacotar-padrao-1366.png`](./capturas/onda-5-aval/12-empacotar-padrao-1366.png)
- **Sugestão:** Incluir `[data-regiao="contexto"]` e `[data-regiao="fila"]` (quando montados) no ciclo `F6` de `TransformarCorte` e `EmpacotarCorte` (seguindo o padrão de `EditarCorte`), e no `GravadorTeleprompter` garantir que `Esc` feche (ou abra a confirmação de descarte quando gravando) mesmo com `<Dica>` aberta em botão filho.

#### UI-101 — Violação sistemática da *Regra da Luz Única*: 2–3 botões `.bg-sinal` em `Transformar` e 0 `.bg-sinal` em `Empacotar ?estado=vazio` (P1 · visual / bloqueador funcional)
- **Tela / Arquivos:** `<ContextoCorteConectado>`, `PassoAngulo`, `PassoRoteiro`, `PassoNarracao` e `FichaEmpacotamento` — [`front-v2/src/telas/corte/ContextoCorteConectado.tsx#L503-L510`](../../../../front-v2/src/telas/corte/ContextoCorteConectado.tsx#L503-L510), [`front-v2/src/telas/corte/transformar/PassoAngulo.tsx#L427-L441`](../../../../front-v2/src/telas/corte/transformar/PassoAngulo.tsx#L427-L441), [`#L532`](../../../../front-v2/src/telas/corte/transformar/PassoAngulo.tsx#L532), [`front-v2/src/telas/corte/transformar/PassoRoteiro.tsx#L581-L600`](../../../../front-v2/src/telas/corte/transformar/PassoRoteiro.tsx#L581-L600), [`front-v2/src/telas/corte/transformar/PassoNarracao.tsx#L515-L520`](../../../../front-v2/src/telas/corte/transformar/PassoNarracao.tsx#L515-L520), [`#L615-L622`](../../../../front-v2/src/telas/corte/transformar/PassoNarracao.tsx#L615-L622) e [`front-v2/src/telas/corte/empacotar/FichaEmpacotamento.tsx#L551-L558`](../../../../front-v2/src/telas/corte/empacotar/FichaEmpacotamento.tsx#L551-L558)
- **Passo para reproduzir:** Abrir qualquer passo de `Transformar` (`201` ou `202`) e abrir `Empacotar` em `?estado=vazio`.
- **Evidência:** `<ContextoCorteConectado>` mantém `"Exportar Corte"` como `variante="primario"` durante toda a sub-aba `Transformar`, enquanto cada passo também usa `variante="primario"` (`"Sugerir ângulos"`, `"Avançar para Roteiro"`, `"Sugerir novo Roteiro"`, `"Voltar ao próximo bloco pendente"`, `"Avançar para Empacotar →"`), resultando em `botoesPrimariosSinal = 2` (e `3` com diálogos abertos: `u-angulo-custo-dialog`, `u-narracao-gravador-1366`). Em contrapartida, em `v-empacotar-vazio-1366`, `"Exportar Corte"` é rebaixado para `secundario` e `"Sugerir Empacotamento"` também usa `variante="secundario"` (`FichaEmpacotamento.tsx:552`), deixando `botoesPrimariosSinal = 0`.
- **Capturas:** [`01-transformar-angulo-1366.png`](./capturas/onda-5-aval/01-transformar-angulo-1366.png), [`03-transformar-roteiro-1440.png`](./capturas/onda-5-aval/03-transformar-roteiro-1440.png), [`05-transformar-narracao-travada-1366.png`](./capturas/onda-5-aval/05-transformar-narracao-travada-1366.png), [`06-transformar-narracao-jit-tts-1366.png`](./capturas/onda-5-aval/06-transformar-narracao-jit-tts-1366.png), [`09-transformar-narracao-hc-1366.png`](./capturas/onda-5-aval/09-transformar-narracao-hc-1366.png), [`19-empacotar-estado-vazio-1366.png`](./capturas/onda-5-aval/19-empacotar-estado-vazio-1366.png)
- **Sugestão:** Em `Transformar` (ou enquanto houver uma única ação primária da sub-aba em foco), rebaixar `"Exportar Corte"` no `<ContextoCorteConectado>` para `variante="secundario"` — mantendo a luz `sinal` apenas na ação que fecha a etapa atual — e promover `"Sugerir Empacotamento"` para `variante="primario"` quando `current === null` em `FichaEmpacotamento`.

#### UI-102 — `<span tabIndex={0}>` em botões desabilitados, link `"Registrar Permissão na Fonte"` `< 24 px` e erro de `ListaChips` desconectado (P2 · A11y AA)
- **Tela / Arquivos:** `PassoNarracao`, `FichaEmpacotamento` e `ListaChips` — [`front-v2/src/telas/corte/transformar/PassoNarracao.tsx#L866-L875`](../../../../front-v2/src/telas/corte/transformar/PassoNarracao.tsx#L866-L875), [`front-v2/src/telas/corte/empacotar/FichaEmpacotamento.tsx#L559-L568`](../../../../front-v2/src/telas/corte/empacotar/FichaEmpacotamento.tsx#L559-L568), [`#L725-L727`](../../../../front-v2/src/telas/corte/empacotar/FichaEmpacotamento.tsx#L725-L727) e [`front-v2/src/componentes/ListaChips.tsx#L136-L193`](../../../../front-v2/src/componentes/ListaChips.tsx#L136-L193)
- **Passo para reproduzir:** (1) Tabular pelos cards do Passo 3 (`202`) ou estado vazio de `Empacotar`; (2) Abrir `Empacotar` com `?packaging-nopermission` e inspecionar a altura do link `"Registrar Permissão na Fonte"`.
- **Evidência:** `PassoNarracao.tsx:869` e `FichaEmpacotamento.tsx:560` envolvem botões `disabled` com `<span tabIndex={0}>`, gerando alvos focáveis sem `role` nem `aria-disabled` (`focusOutlineTeste` em `u-narracao-limpeza-revisao-1440` parou em `span:Remover áudio`; `spanTabIndexZero` acusou `["Preencher manualmente"]`). Em `v-empacotar-noperm-1366`, o link autônomo `"Registrar Permissão na Fonte"` mediu `165,8 × 17,4 px` (`< 24 px` de altura, WCAG 2.2 SC 2.5.8). Em `ListaChips.tsx:136,188-193`, `erroAtivo` é renderizado fora de `<Campo>`, desconectado de `aria-describedby`.
- **Capturas:** [`08-transformar-narracao-limpeza-revisao-1440.png`](./capturas/onda-5-aval/08-transformar-narracao-limpeza-revisao-1440.png), [`17-empacotar-sem-permissao-1366.png`](./capturas/onda-5-aval/17-empacotar-sem-permissao-1366.png), [`19-empacotar-estado-vazio-1366.png`](./capturas/onda-5-aval/19-empacotar-estado-vazio-1366.png)
- **Sugestão:** Substituir `<span tabIndex={0}>` por `aria-disabled="true"` no `<Botao>` ou nota de ajuda inline não focável; aplicar `inline-flex min-h-6 items-center` (`24 px`) ao link `"Registrar Permissão na Fonte"`; passar `erro={erroAtivo}` ao `<Campo>` em `ListaChips.tsx` para associar `aria-describedby`.

#### UI-103 — Salto de hierarquia de headings (`h1 → h3`) em `FichaEmpacotamento` e `PassoNarracao` + `InstaladorJustInTime` (P2 · A11y AA)
- **Tela / Arquivos:** `FichaEmpacotamento`, `PassoNarracao` e `InstaladorJustInTime` — [`front-v2/src/telas/corte/empacotar/FichaEmpacotamento.tsx#L655`](../../../../front-v2/src/telas/corte/empacotar/FichaEmpacotamento.tsx#L655), [`#L781`](../../../../front-v2/src/telas/corte/empacotar/FichaEmpacotamento.tsx#L781), [`front-v2/src/telas/corte/transformar/PassoNarracao.tsx#L590-L624`](../../../../front-v2/src/telas/corte/transformar/PassoNarracao.tsx#L590-L624) e [`front-v2/src/componentes/InstaladorJustInTime.tsx#L771`](../../../../front-v2/src/componentes/InstaladorJustInTime.tsx#L771)
- **Passo para reproduzir:** Abrir `Empacotar` (`202`) ou o Passo 3 de `Transformar` (`201` com `InstaladorJustInTime` aberto / `202` liberado) e inspecionar a árvore de headings.
- **Evidência:** Em `Empacotar`, `<ContextoCorteConectado>` fornece `<h1>`, e `FichaEmpacotamento` abre diretamente com `<h3>Capítulos</h3>` e `<h3>Guardrails e saída</h3>` (`saltoHeading: "h1 -> h3"` em todas as 6 medições com ficha preenchida). Em `PassoNarracao`, o estado travado tem `<h2>`, mas o estado liberado não tem nenhum `<h2>` (`headings: ["h1"]` em `09`), fazendo `<InstaladorJustInTime>` (`<h3>Recurso necessário para esta ação</h3>`) gerar `saltoHeading: "h1 -> h3"` em `06`.
- **Capturas:** [`06-transformar-narracao-jit-tts-1366.png`](./capturas/onda-5-aval/06-transformar-narracao-jit-tts-1366.png), [`09-transformar-narracao-hc-1366.png`](./capturas/onda-5-aval/09-transformar-narracao-hc-1366.png), [`12-empacotar-padrao-1366.png`](./capturas/onda-5-aval/12-empacotar-padrao-1366.png), [`16-empacotar-validadores-guardrails-1440.png`](./capturas/onda-5-aval/16-empacotar-validadores-guardrails-1440.png)
- **Sugestão:** Incluir `<h2>` visíveis (ou discretos/semânticos de seção) para `"Capa e preview"` / `"Ficha de Empacotamento"` em `EmpacotarCorte` e `"3. Narração"` no `PassoNarracao` liberado.

#### UI-104 — `EmpacotarCorte ?estado=vazio` cai em `Fonte offline` e `PlayerProxy` exibe `"A Fonte não está no lugar de antes."` enquanto o proxy gera (`40%`) (P2 · bloqueador funcional / visual)
- **Tela / Arquivos:** `EmpacotarCorte`, `PainelCapa`, `PlayerProxy` e mock `core.ts` — [`front-v2/src/telas/corte/empacotar/EmpacotarCorte.tsx#L143-L151`](../../../../front-v2/src/telas/corte/empacotar/EmpacotarCorte.tsx#L143-L151), [`src/lib/core.ts#L1993`](../../../../src/lib/core.ts#L1993), [`front-v2/src/telas/corte/empacotar/PainelCapa.tsx#L551-L574`](../../../../front-v2/src/telas/corte/empacotar/PainelCapa.tsx#L551-L574) e [`design-system-v2/src/componentes/Midia.tsx#L47-L64`](../../../../design-system-v2/src/componentes/Midia.tsx#L47-L64)
- **Passo para reproduzir:** (1) Navegar para `#/projeto/demo/corte/201/empacotar?run=2&estado=vazio`; (2) Abrir `Empacotar` em `201` ou `202` enquanto `proxy` ainda está em `40%`.
- **Evidência:** Em `?estado=vazio`, `selection.list` retorna `[]` (`src/lib/core.ts:1993`), levando `resolverCorte()` (`EmpacotarCorte.tsx:143`) a manter o fallback `fontes[0]` (Fonte `1`, `changed`/`offline`), exibindo o alerta `"Fonte offline"` e desabilitando `"Exportar vídeo (MP4)"` (`19-empacotar-estado-vazio-1366.png`). Além disso, enquanto `proxyEmAndamento` (`40%`) e `urlProxy === undefined`, `PlayerProxy` cai no ramo `else` exibindo `"A Fonte não está no lugar de antes."` com ícone de arquivo ausente (`14-empacotar-hc-1366.png`, `15-empacotar-custo-provedor-1366.png`), contradizendo a barra de progresso acima.
- **Capturas:** [`14-empacotar-hc-1366.png`](./capturas/onda-5-aval/14-empacotar-hc-1366.png), [`15-empacotar-custo-provedor-1366.png`](./capturas/onda-5-aval/15-empacotar-custo-provedor-1366.png), [`19-empacotar-estado-vazio-1366.png`](./capturas/onda-5-aval/19-empacotar-estado-vazio-1366.png)
- **Sugestão:** Em `EmpacotarCorte`, não forçar `Fonte offline` quando `forcado === 'vazio'` (ou selecionar fonte disponível no estado forçado); em `PlayerProxy` / `PainelCapa`, diferenciar `fonteDisponivel && !poster` (`"Preparando quadro…"`) de `!fonteDisponivel` (`"A Fonte não está no lugar de antes."`).

#### UI-105 — Rótulos técnicos/ambíguos (`TTS · 13063`, `"de 20 s"`, dupla seta `→`, `"bloco(s)"`), card duplicado no Passo 1 e capítulos sem `cutDurationUs` (P2 · visual / texto)
- **Tela / Arquivos:** `PassoNarracao`, `PassoAngulo`, `PainelCapa` e `FichaEmpacotamento` — [`front-v2/src/telas/corte/transformar/PassoNarracao.tsx#L84`](../../../../front-v2/src/telas/corte/transformar/PassoNarracao.tsx#L84), [`#L499`](../../../../front-v2/src/telas/corte/transformar/PassoNarracao.tsx#L499), [`#L618-L621`](../../../../front-v2/src/telas/corte/transformar/PassoNarracao.tsx#L618-L621), [`#L964-L965`](../../../../front-v2/src/telas/corte/transformar/PassoNarracao.tsx#L964-L965), [`front-v2/src/telas/corte/transformar/PassoAngulo.tsx#L493-L599`](../../../../front-v2/src/telas/corte/transformar/PassoAngulo.tsx#L493-L599), [`front-v2/src/telas/corte/empacotar/PainelCapa.tsx#L628`](../../../../front-v2/src/telas/corte/empacotar/PainelCapa.tsx#L628) e [`front-v2/src/telas/corte/empacotar/FichaEmpacotamento.tsx#L198`](../../../../front-v2/src/telas/corte/empacotar/FichaEmpacotamento.tsx#L198)
- **Passo para reproduzir:** Observar Passo 1 com ângulo sugerido escolhido (`201`), Passo 3 travado (`201`), Passo 3 com bloco TTS/revisão (`202`) e Ficha da capa + Capítulos em `Empacotar` (`202`).
- **Evidência:** `PassoNarracao.tsx:84` exibe o ID numérico `TTS · 13063` em vez do nome humano da voz do catálogo; o botão `"Avançar para Empacotar →"` mistura `icone={<ArrowRight />}` com seta `→` no texto; mensagens usam `"bloco(s) pendente(s)"` e `"acréscimo(s), troca(s)"` em vez de pluralização natural; `PainelCapa.tsx:628` renderiza `"00:05,0 Sugerido pelo Provedor de 20 s"`; `PassoAngulo` repete exatamente o mesmo cartão com borda `marcado` duas vezes seguidas (`01`); e `FichaEmpacotamento.tsx:198` passa `null` em `cutDurationUs` para `validarCapitulosTempoReal`, omitindo o aviso `chapter_past_end` quando `00:24 Fechamento` ultrapassa os `20 s` do Corte (`12`).
- **Capturas:** [`01-transformar-angulo-1366.png`](./capturas/onda-5-aval/01-transformar-angulo-1366.png), [`05-transformar-narracao-travada-1366.png`](./capturas/onda-5-aval/05-transformar-narracao-travada-1366.png), [`06-transformar-narracao-jit-tts-1366.png`](./capturas/onda-5-aval/06-transformar-narracao-jit-tts-1366.png), [`08-transformar-narracao-limpeza-revisao-1440.png`](./capturas/onda-5-aval/08-transformar-narracao-limpeza-revisao-1440.png), [`12-empacotar-padrao-1366.png`](./capturas/onda-5-aval/12-empacotar-padrao-1366.png)
- **Sugestão:** Mapear `audio.voiceId` pelo `label` de `tts.catalog.voices`; remover `→` duplicado no texto do botão; aplicar singular/plural real; trocar `"de {duracao}"` por `"duração do Corte: {duracao}"` ou omitir quando redundante com o transporte; suprimir/compactar o card repetido na lista quando o ângulo escolhido já está em destaque no topo; passar `fonte.endUs - fonte.startUs` para `validarCapitulosTempoReal`.

#### UI-106 — Player `<audio controls>` claro em tema escuro, desalinhamento `Sugerir novamente` × `Idioma` e toasts no canto inferior direito (P3 · visual)
- **Tela / Arquivos:** `PassoNarracao`, `FichaEmpacotamento` e `Shell` — [`front-v2/src/telas/corte/transformar/PassoNarracao.tsx#L928`](../../../../front-v2/src/telas/corte/transformar/PassoNarracao.tsx#L928), [`front-v2/src/telas/corte/empacotar/FichaEmpacotamento.tsx#L573-L601`](../../../../front-v2/src/telas/corte/empacotar/FichaEmpacotamento.tsx#L573-L601) e [`front-v2/src/shell/Shell.tsx#L414-L424`](../../../../front-v2/src/shell/Shell.tsx#L414-L424)
- **Passo para reproduzir:** Abrir `PassoNarracao` (`202` em `1440×900`), `Empacotar` (`202` em `1366×768`) e redirecionamento de `Corte direto` (`102`).
- **Evidência:** `<audio controls>` renderiza controles cinza-claro padrão do Chromium sobre card escuro `bg-elevado` e exibe `0:00 / 0:00` no mock (`08`); na barra superior da Ficha (`12`), `items-end` deixa espaço vazio sobre `"Sugerir novamente"` e `"Salvo"` ao lado do rótulo `"Idioma"`; toasts empilhados no canto inferior direito cobrem controles inferiores (`10` e captura prévia `empacotar-1366x768.png`).
- **Capturas:** [`08-transformar-narracao-limpeza-revisao-1440.png`](./capturas/onda-5-aval/08-transformar-narracao-limpeza-revisao-1440.png), [`10-transformar-corte-direto-redir-1366.png`](./capturas/onda-5-aval/10-transformar-corte-direto-redir-1366.png), [`12-empacotar-padrao-1366.png`](./capturas/onda-5-aval/12-empacotar-padrao-1366.png)
- **Sugestão:** Aplicar `color-scheme: dark` / `light` conforme `[data-tema]` (ou player compacto com tokens do DS), mover o rótulo `"Idioma"` para linha inline ou `items-center` e evitar empilhamento de toasts sobre ações de rodapé.

---

## 4. Inventário de capturas (`docs/produto/front-v2/ui/capturas/onda-5-aval/`)

| # | Arquivo | Viewport / Tema | Fluxo | O que verifica |
|---:|---|---|---:|---|
| 01 | `01-transformar-angulo-1366.png` | 1366×768 · padrão | (u) | Passo 1 (Ângulo escolhido + sugestões do Provedor + Transcrição recolhida) |
| 02 | `02-transformar-angulo-custo-1366.png` | 1366×768 · padrão | (u) | `<ConfirmDialog>` + `<ResumoCustoPrivacidade>` ao acionar `"Sugerir ângulos"` |
| 03 | `03-transformar-roteiro-1440.png` | 1440×900 · padrão | (u) | Passo 2 (Roteiro em blocos, banner ADR-0001, `Desatualizado` e Transcrição à esquerda) |
| 04 | `04-transformar-roteiro-hc-1366.png` | 1366×768 · alto contraste | (u) | Passo 2 (Roteiro em blocos) com `[data-contrast="high"]` |
| 05 | `05-transformar-narracao-travada-1366.png` | 1366×768 · padrão | (u) | Passo 3 travado pela regra ADR-0001 com `"Voltar ao próximo bloco pendente"` |
| 06 | `06-transformar-narracao-jit-tts-1366.png` | 1366×768 · padrão | (u) | Passo 3 com `<InstaladorJustInTime recurso="tts" />` e termo de uso responsável |
| 07 | `07-transformar-narracao-gravador-1366.png` | 1366×768 · padrão | (u) | Modal `<GravadorTeleprompter>` (Rolagem/Passo, fonte A-/A+, velocidade, VU, cronômetro) |
| 08 | `08-transformar-narracao-limpeza-revisao-1440.png` | 1440×900 · padrão | (u) | Corte V1 `202`: limpeza `Depois (limpa)` e revisão `needs_review` (`Roteiro` × `Detectado na fala`) |
| 09 | `09-transformar-narracao-hc-1366.png` | 1366×768 · alto contraste | (u) | Passo 3 (Narração) em `[data-contrast="high"]` |
| 10 | `10-transformar-corte-direto-redir-1366.png` | 1366×768 · padrão | (u) | Redirecionamento de `Corte direto` (`102`) de `/transformar` para `/editar` sem aba `Transformar` |
| 11 | `11-transformar-estado-erro-1366.png` | 1366×768 · padrão | (u) | `#/projeto/demo/corte/201/transformar?run=2&estado=erro` (`<BannerErroCore>`) |
| 12 | `12-empacotar-padrao-1366.png` | 1366×768 · padrão | (v) | Empacotar `202`: PainelCapa + FichaEmpacotamento (título, descrição UTF-8, capítulos) |
| 13 | `13-empacotar-padrao-1440.png` | 1440×900 · padrão | (v) | Empacotar `202` em 40/60 (inclui verificação WCAG 2.1.4 no campo `Título`) |
| 14 | `14-empacotar-hc-1366.png` | 1366×768 · alto contraste | (v) | Empacotar `202` com `[data-contrast="high"]` |
| 15 | `15-empacotar-custo-provedor-1366.png` | 1366×768 · padrão | (v) | `<ConfirmDialog>` + `<ResumoCustoPrivacidade>` ao acionar `"Sugerir Empacotamento"` |
| 16 | `16-empacotar-validadores-guardrails-1440.png` | 1440×900 · padrão | (v) | Tags, hashtags, `ChecklistGuardaCorpos`, `AiDisclosureNote` e ações de saída |
| 17 | `17-empacotar-sem-permissao-1366.png` | 1366×768 · padrão | (v) | `?packaging-nopermission`: alerta de ausência de Permissão e link para Fonte |
| 18 | `18-empacotar-fonte-offline-1366.png` | 1366×768 · padrão | (v) | `?estado=offline`: banner `"Relocalizar Fonte"`, capa/exportação bloqueadas e ficha editável |
| 19 | `19-empacotar-estado-vazio-1366.png` | 1366×768 · padrão | (v) | `?estado=vazio`: capa vazia, `"Sugerir Empacotamento"` e `"Preencher manualmente"` desabilitado |
| 20 | `20-empacotar-estado-erro-1366.png` | 1366×768 · padrão | (v) | `#/projeto/demo/corte/201/empacotar?run=2&estado=erro` (`<BannerErroCore>`) |
