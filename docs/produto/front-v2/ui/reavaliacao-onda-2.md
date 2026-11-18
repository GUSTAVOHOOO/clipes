# Reavaliação Independente de UI — Onda 2: Fontes e Transcrição (`front-v2`)

> ⚠️ **DEGRADED: single-context (subagentes desabilitados pela regra da tarefa; avaliação conduzida em contexto único combinando inspeção visual das 23 capturas renderizadas, auditoria automatizada de DOM/WCAG e análise de código).**
>
> **Data da avaliação:** 2026-11-18  
> **Commit avaliado (`HEAD`):** `b5e2d99` (`docs(arquitetura): candidatos de aprofundamento (fase codebase) (#433)`)  
> **Linha de base comparada:** `7046ad4` ([avaliacao-onda-2.md](./avaliacao-onda-2.md))  
> **Entregas incorporadas desde a linha de base:** correções `UI-21` a `UI-29` via `#426` (`604d518`, `#422`), `#429` (`b87f818`, `#421`), `#430` (`071649b`) e `#431` (`b95dd2b`, `#424`).  
> **Escopo:** Onda 2 — Macro-etapa 1 **Fontes e Transcrição**: Fluxo **(e)** Lista de Fontes (`#/projeto/:id/fontes`), Fluxo **(f)** Entrada de Fonte (`EntradaFonte` + `<InstaladorJustInTime>`), Fluxo **(g)** Lotes de Fontes (`#/projeto/:id/fontes?sub=lotes`) e Fluxo **(h)** Detalhe da Fonte e Leitor de Transcrição (`#/projeto/:id/fontes/:fonteId`). Papel exclusivamente avaliador — nenhuma tela ou script de teste foi alterado neste PR.

---

## 1. Cenário reproduzido e saídas automatizadas

O cenário fixo da linha de base foi executado integralmente e sem alterações sobre o mock TypeScript (`VITE_CORE_MOCK=1`, sem Tauri) pelo script `front-v2/e2e/ui-onda2.spec.ts`, nos viewports `1366×768` e `1440×900`, tema escuro padrão e modo de alto contraste (`[data-contrast="high"]`).

### Comandos executados e resultados observados

- `cd front-v2; bun install`: `152 packages installed` (exit `0`).
- `cd front-v2; bun run typecheck`: `tsc --noEmit` limpo (exit `0`).
- `cd front-v2; bun run test -- --maxWorkers=2`: **`46 passed (46)`** arquivos, **`396 passed (396)`** testes unitários/componentes (exit `0`).
- `cd front-v2; bunx playwright test` (suíte padrão sem `UI_BASELINE`): **`28 passed`**, `2 skipped` (`e2e/ui-baseline.spec.ts` e `e2e/ui-onda2.spec.ts`) (exit `0`).
- `cd front-v2; $env:UI_BASELINE = "1"; bunx playwright test e2e/ui-onda2.spec.ts`: **`1 passed`** (`14.2s`), **`0`** `pageerror`, **`0`** ocorrências de overflow externo (`1366×768` e `1440×900`) e **`0`** overflow em tabelas internas nos **25 estados auditados**.
- `bunx impeccable detect --json front-v2/src`: **`[]`** (exit `0`, zero achados no detector mecânico).
- `cd design-system-v2; bun scripts/contraste.ts`: **`Todos os pares passam.`** (escuro, claro, escuro `[data-contrast="high"]` e claro `[data-contrast="high"]`, exit `0`).

### Síntese das verificações transversais (DOM + Teclado + Glossário)

| Aspecto | Resultado observado | Evidência / Observação |
|---|---|---|
| **Teclado (`Tab`, `Esc`, `F6`, `Ctrl+F`, `F2`/`Enter`, setas)** | **Aprovado** | `F6` cicla `conteudo → rodape`; `Esc` fecha `ConfirmDialog` e `GavetaBuscaFts` devolvendo o foco; `fecharBuscaFts` cancela o timer de debounce e limpa o termo sem reabrir (**UI-21**); `F2`/`Enter` no Leitor edita e devolve o foco para `CorrigidaUI`; `←`/`→` cruza a fronteira das páginas virtualizadas em `LeitorTranscricao` (**UI-29**). |
| **Foco visível** | **Aprovado** | Anel `2px` (`rgb(255, 90, 31)` / `rgb(236, 236, 238)` no tema padrão e `rgb(255, 255, 255)` + borda `1px` em `[data-contrast="high"]`) e `foco-interno` confirmados nos 25 estados auditados. |
| **Contraste WCAG 2.2 AA** | **Aprovado** | **`0`** textos abaixo de `4,5:1` (`3:1` texto grande) nos 25 estados auditados, inclusive em `[data-contrast="high"]` (`06`, `16`, `23`). `contraste.ts` aprova todos os pares de tokens. |
| **Alvos ≥ 24 px (WCAG 2.5.8)** | **Aprovado** | **`0`** alvos `< 24 px` nos 25 estados auditados. Os 2 `role="radio"`, os 2 links de configuração e o `<summary>` em `PainelMotorSinais` agora têm `min-h-6` (`≥ 24 px`, **UI-24**). |
| **Headings (`h1–h6`)** | **Aprovado** | `h1Count = 1` em todos os 25 estados (`<h1>Fontes e Transcrição</h1>` e `<h1>Live_12_11_final.mp4</h1>`), hierarquia contínua `h1 → h2 → h3` em `ListaLotes` (`<h2 className="sr-only">Lotes do Projeto</h2>`) e `<ListaVirtual>` em `ListaFontes` migrado para `papel="region"` (**UI-25**). |
| **Textos PT-BR e `GLOSSARY.md`** | **Aprovado** *(observação P3 em **UI-42**)* | **`0`** violações de glossário (`clipe`, `short`, `input`, `voice-over`, `locução`, `workspace`, `preset`, `segmento`, `sentença`, `highlight`), **`0`** refs de ticket visíveis (`#296`, `#302`, `#307` removidos; único `#142` na busca é o índice de `Abrir Frase #142`), nome da Fonte resolvido no toast de undo/redo, `legacy`/`US$ 0,00` corrigidos em Lotes, seta dupla removida de `Ir para Cortes` e microvalores `< US$ 0,01` formatados via `faixaUsd` (**UI-28**). |
| **Regra da Luz Única** | **Parcial** *(achado **UI-40**)* | `DetalheFonte` pré-transcrição corrigido (`bgSinal = 1`, **UI-26**). Porém, quando `lotes.length === 0`, `LotesFontes` (`Focar seleção de Fontes`) e `ConstrutorLote` (`Iniciar lote com N Fontes`) exibem **2 botões `bg-sinal` simultâneos** (visível ao fundo de [12-lotes-montar-custo-1366.png](./capturas/onda-2-reav/12-lotes-montar-custo-1366.png)); o mesmo ocorre em `#/projeto/:id/fontes?estado=vazio` ao alternar `EntradaFonte` para `URL (VOD)` (**UI-40**). |
| **Estados de erro e aviso de custo** | **Aprovado** | `ConstrutorLote` rola e foca o `<BannerErroCore>` ao falhar (`local_only_violation`, **UI-22**); `retomarParcial()` reutiliza os `<ConfirmDialog>` de `PainelMotorSinais` (**UI-23**); redirecionamento de `fontes/999` usa toast `type: 'aviso'` (`AlertTriangle`, **UI-27**); e `?estado=vazio` oculta `Blocos de 10 min` (**UI-27**). |

---

## 2. Tabela de pontuação por fluxo (Critique — Nielsen 0–4)

Meta do mandato: **≥ 90%** da pontuação aplicável (**`36 / 40`**), WCAG 2.2 AA e zero bloqueador funcional.  
Legenda: **H1** Visibilidade de estado · **H2** Mundo real / vocabulário · **H3** Controle e liberdade · **H4** Consistência e padrões · **H5** Prevenção de erros · **H6** Reconhecimento vs. lembrança · **H7** Flexibilidade e atalhos · **H8** Estética e minimalismo · **H9** Recuperação de erros · **H10** Ajuda e documentação.

| Fluxo / Superfície | H1 | H2 | H3 | H4 | H5 | H6 | H7 | H8 | H9 | H10 | Original (`7046ad4`) | Agora (`b5e2d99`) | Delta | % Agora | Meta ≥ 90% |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| **Fluxo (e) · Lista de Fontes (`#/projeto/:id/fontes`)** | 4 | 4 | 4 | 4 | 4 | 4 | 4 | 3 | 4 | 4 | 35 / 40 (87,5%) | **39 / 40** | **+4 (+10,0 p.p.)** | **97,5%** | **Atinge** |
| **Fluxo (f) · Entrada de Fonte (`EntradaFonte` + JIT)** | 4 | 4 | 4 | 4 | 4 | 4 | 3 | 3 | 4 | 4 | 37 / 40 (92,5%) | **38 / 40** | **+1 (+2,5 p.p.)** | **95,0%** | **Atinge** |
| **Fluxo (g) · Lotes de Fontes (`?sub=lotes`)** | 4 | 4 | 4 | 4 | 4 | 4 | 4 | 3 | 4 | 4 | 35 / 40 (87,5%) | **39 / 40** | **+4 (+10,0 p.p.)** | **97,5%** | **Atinge** |
| **Fluxo (h) · Detalhe da Fonte e Leitor (`/:fonteId`)** | 4 | 4 | 3 | 4 | 4 | 4 | 4 | 4 | 4 | 4 | 33 / 40 (82,5%) | **39 / 40** | **+6 (+15,0 p.p.)** | **97,5%** | **Atinge** |

### Justificativa das mudanças por heurística e fluxo

- **Fluxo (e) · Lista de Fontes (`35/40 → 39/40`, +4 pts / +10,0 p.p., Atinge 97,5%):**
  - **H2 (`3 → 4`)**: Removida a seta duplicada em `Ir para Cortes` (`ListaFontes.tsx`, **UI-28**, [01-fontes-lista-1366.png](./capturas/onda-2-reav/01-fontes-lista-1366.png)).
  - **H3 (`2 → 4`)**: `fecharBuscaFts` cancela o timer de debounce, invalida buscas em voo e limpa o termo ao fechar a gaveta FTS5 (`Fontes.tsx`, **UI-21**).
  - **H4 (`3 → 4`)**: `<ListaVirtual>` em listas `> 30` Fontes passou de `papel="listbox"` para `papel="region"`, eliminando controles interativos aninhados em `role="option"` (`ListaFontes.tsx`, **UI-25**).
  - **H8 (`3 → 3`)**: Em `1366×768`, abrir `GavetaBuscaFts` agora oculta `ListaFontes` (`hidden 2xl:flex`) e evita o esmagamento de filtros/cartões (**UI-27**, [03-fontes-fts-1366.png](./capturas/onda-2-reav/03-fontes-fts-1366.png)); contudo, em `?estado=vazio` ao alternar `EntradaFonte` para `URL (VOD)`, coexistem 2 botões `bg-sinal` (**UI-40**), mantendo H8 em `3`.

- **Fluxo (f) · Entrada de Fonte (`37/40 → 38/40`, +1 pt / +2,5 p.p., Atinge 95,0%):**
  - **H2 (`3 → 4`)**: Removida a referência de ticket `(#307)` da trava de cópia simultânea (`EntradaFonte.tsx`, **UI-28**).
  - **H7 (`3 → 3`)**: Mantido em `3` porque em `1366×768`, após inspecionar arquivo local e expandir `Permissão` (`granted`), `Limpar seleção` e `Importar Fonte` continuam abaixo da dobra rolável da coluna esquerda ([07-entrada-local-inspecao-1366.png](./capturas/onda-2-reav/07-entrada-local-inspecao-1366.png)).
  - **H8 (`3 → 3`)**: Mantido em `3` pela densidade do formulário inspecionado em `1366×768` e pela coexistência de 2 `bg-sinal` quando combinado com `?estado=vazio` no modo `URL (VOD)` (**UI-40**).

- **Fluxo (g) · Lotes de Fontes (`35/40 → 39/40`, +4 pts / +10,0 p.p., Atinge 97,5%):**
  - **H2 (`3 → 4`)**: `<ConfirmDialog>` de lote exibe `Não configurado` / `Perfil configurado` e `Custo desconhecido` em vez de `legacy` e `US$ 0,00` conflitante (**UI-28**, [12-lotes-montar-custo-1366.png](./capturas/onda-2-reav/12-lotes-montar-custo-1366.png)), e `ListaLotes` formata microvalores como `< US$ 0,01` ([13-lotes-execucao-1366.png](./capturas/onda-2-reav/13-lotes-execucao-1366.png)).
  - **H4 (`3 → 4`)**: `<h2 className="sr-only">Lotes do Projeto</h2>` elimina o salto `h1 → h3` (`ListaLotes.tsx`, **UI-25**).
  - **H8 (`3 → 3`)**: Mantido em `3` porque `ConstrutorLote` segue empilhando dois `<ResumoCustoPrivacidade>` no modo `Groq` e, quando `lotes.length === 0`, exibe `Iniciar lote com N Fontes` e `Focar seleção de Fontes` simultaneamente em `bg-sinal` (**UI-40**, [12-lotes-montar-custo-1366.png](./capturas/onda-2-reav/12-lotes-montar-custo-1366.png)).
  - **H9 (`2 → 4`)**: `ConstrutorLote` agora rola (`scrollIntoView`) e foca (`foco-interno`) o `<BannerErroCore>` ao definir `erroCriar`, garantindo retorno imediato no clique em `1366×768` (**UI-22**, [14-lotes-erro-local-only-1366.png](./capturas/onda-2-reav/14-lotes-erro-local-only-1366.png)).

- **Fluxo (h) · Detalhe da Fonte e Leitor (`33/40 → 39/40`, +6 pts / +15,0 p.p., Atinge 97,5%):**
  - **H1 (`3 → 4`)**: Redirecionamento de `fontes/999` usa toast `type: 'aviso'` (`AlertTriangle`) e `?estado=vazio` oculta `Blocos de 10 min` (`blocosVisiveis`, **UI-27**, [17-detalhe-vazio-motor-1366.png](./capturas/onda-2-reav/17-detalhe-vazio-motor-1366.png)).
  - **H2 (`3 → 4`)**: Removidos `#296` e `#302`, nome da Fonte resolvido no toast de undo/redo (`LeitorTranscricao.tsx`) e microvalores no radio Groq exibem `< US$ 0,01` (`faixaUsd`, **UI-28**, [17-detalhe-vazio-motor-1366.png](./capturas/onda-2-reav/17-detalhe-vazio-motor-1366.png)).
  - **H3 (`3 → 3`)**: `retomarParcial()` (**UI-23**) e setas `←`/`→` na virtualização (**UI-29**) foram corrigidos; porém, em `1366×768`, durante `transcricaoRodando`, o único botão `Pausar / Cancelar mantendo blocos salvos` fica abaixo da dobra na coluna esquerda rolável enquanto o painel direito orienta pausar (**UI-41**, [19-detalhe-blocos-progresso-1366.png](./capturas/onda-2-reav/19-detalhe-blocos-progresso-1366.png)).
  - **H4 (`3 → 4`)**: Todos os alvos de `PainelMotorSinais` (`role="radio"`, links e `<summary>`) medem `≥ 24 px` (**UI-24**, `0` alvos `< 24 px` nas 25 auditorias).
  - **H5 (`3 → 4`)**: `retomarParcial()` aciona o fluxo completo de `PainelMotorSinais` com `<ConfirmDialog>` para `confirmation_required`, `transcription_retry_confirmation` e `engine_change_confirmation` (**UI-23**).
  - **H7 (`3 → 4`)**: `Refazer` exibe o badge `Ctrl+Shift+Z` ([20-detalhe-leitor-1366.png](./capturas/onda-2-reav/20-detalhe-leitor-1366.png)) e `←`/`→` navega entre páginas do `<ListaVirtual>` (**UI-29**).
  - **H8 (`3 → 4`)**: `Focar configuração do Motor` rebaixado para `acaoSecundaria` (`DetalheFonte.tsx`), preservando 1 único botão `bg-sinal` (`Iniciar transcrição`, **UI-26**, [17-detalhe-vazio-motor-1366.png](./capturas/onda-2-reav/17-detalhe-vazio-motor-1366.png)).

### Auditoria Técnica (Impeccable Audit — `/20`)

| Dimensão | Original | Agora | Delta | Achado principal |
|---|---|---|---|---|
| 1. Accessibility | 2 / 4 | **4 / 4** | **+2** | Contraste AA/AAA (`contraste.ts` + 25 auditorias DOM) 100% aprovado, `0` alvos `< 24 px` (**UI-24**), `h1 → h2 → h3` contínuo e `papel="region"` em `ListaFontes` (**UI-25**), foco visível e `←`/`→` atravessando a virtualização (**UI-29**). |
| 2. Performance | 4 / 4 | **4 / 4** | **0** | `<ListaVirtual>` paginado em fatias de 200 itens, `Promise.allSettled` paralelo e zero layout thrashing. |
| 3. Theming | 4 / 4 | **4 / 4** | **0** | Tokens `@ds` respeitados integralmente; `[data-contrast="high"]` sólido em Fontes, Lotes e Detalhe (`06`, `16`, `23`). |
| 4. Responsive Design | 3 / 4 | **3 / 4** | **0** | `0` overflow externo e `GavetaBuscaFts` + `ConstrutorLote` resolvidos em `1366×768` (**UI-27**, **UI-22**); mantido em `3` porque em `1366×768` `Pausar / Cancelar mantendo blocos salvos` (**UI-41**) e os botões de `EntradaFonte` após expandir permissão ([07-entrada-local-inspecao-1366.png](./capturas/onda-2-reav/07-entrada-local-inspecao-1366.png)) ainda descem abaixo da dobra rolável da coluna esquerda. |
| 5. Implementation Integrity | 2 / 4 | **3 / 4** | **+1** | `impeccable detect` limpo (`[]`), `0` bloqueadores P0/P1 (**UI-21**, **UI-22**, **UI-23** resolvidos) e `0` refs de ticket; perde 1 ponto por casos isolados da *Regra da Luz Única* no estado vazio de Lotes/Fontes (**UI-40**) e inconsistência menor de seta textual (**UI-42**). |
| **Total** | **15 / 20** *(Good)* | **18 / 20** *(Excellent)* | **+3** | **Todos os fluxos (e)–(h) atingem ≥ 95%, WCAG 2.2 AA atendido e zero bloqueador funcional.** |

---

## 3. Status dos achados da linha de base (`UI-21` a `UI-29`)

| ID | Sev. | Descrição resumida (linha de base) | Status | Prova / Evidência na reavaliação |
|---|---|---|---|---|
| **UI-21** | P1 | Corrida do debounce de `220 ms` reabrindo `GavetaBuscaFts` após fechar | **Resolvido** | `#429` (`b87f818`): `Fontes.tsx` L62–126 e L189–193 cancela o timer em `aoSubmeterBusca` e `fecharBuscaFts`, incrementa `seqBuscaRef` e limpa o termo; validado em `Fontes.test.tsx` (`UI-21`) e `e2e/fontes.spec.ts` L170–231. |
| **UI-22** | P1 | Erro `local_only_violation` fora da área visível em `ConstrutorLote` (`1366×768`) | **Resolvido** | `#426` (`604d518`): `ConstrutorLote.tsx` L194–206 e L380 rola (`scrollIntoView`) e foca (`tabIndex={-1}`, `foco-interno`) o `<BannerErroCore>` ao definir `erroCriar`; comprovado em [14-lotes-erro-local-only-1366.png](./capturas/onda-2-reav/14-lotes-erro-local-only-1366.png) e `e2e/lotes.spec.ts` L163–204. |
| **UI-23** | P1 | `retomarParcial()` em `DetalheFonte` pulava diálogos de confirmação | **Resolvido** | `#430` (`071649b`): `DetalheFonte.tsx` L286–291 delega para `iniciarTranscricaoRef` registrado por `PainelMotorSinais.tsx` L489–498, preservando `<ConfirmDialog>` de retry, custo e troca de Motor; validado em `DetalheFonte.test.tsx` (`UI-23`). |
| **UI-24** | P1 | 4 alvos `< 24 px` em `PainelMotorSinais` (`role="radio"` e links) | **Resolvido** | `#430` (`071649b`): `PainelMotorSinais.tsx` L692, L750, L766, L859 e L906 aplicam `min-h-6`; auditoria DOM em `ui-onda2.spec.ts` registra **`0` alvos `< 24 px`** nos 25 estados (incluindo `17` e `18`). |
| **UI-25** | P2 | Salto `h1 → h3` em `ListaLotes` e `role="listbox"` com controles em `ListaFontes > 30` | **Resolvido** | `#426` (`604d518`): `ListaLotes.tsx` L392 adiciona `<h2 className="sr-only">Lotes do Projeto</h2>` (confirmado na auditoria DOM de [13-lotes-execucao-1366.png](./capturas/onda-2-reav/13-lotes-execucao-1366.png) e [15-lotes-budget-uncertain-1440.png](./capturas/onda-2-reav/15-lotes-budget-uncertain-1440.png)); `#429` (`b87f818`): `ListaFontes.tsx` L712–713 usa `papel="region"`, validado em `Fontes.test.tsx` (`UI-25b`). |
| **UI-26** | P2 | 2 botões `bg-sinal` simultâneos em `DetalheFonte` pré-transcrição | **Resolvido** | `#430` (`071649b`): `DetalheFonte.tsx` L547 alterou `Focar configuração do Motor` para `acaoSecundaria`; comprovado em [17-detalhe-vazio-motor-1366.png](./capturas/onda-2-reav/17-detalhe-vazio-motor-1366.png), [18-detalhe-groq-custo-1366.png](./capturas/onda-2-reav/18-detalhe-groq-custo-1366.png) e auditoria DOM (`botoesPrimariosSinal = 1`). |
| **UI-27** | P2 | Toast `✓` em `fontes/999`, `Blocos de 10 min` em `?estado=vazio` e FTS esmagando `ListaFontes` em `1366×768` | **Resolvido** | `#430` (`071649b`): `Indicadores.tsx` L132–134 + `DetalheFonte.tsx` L110–113 usam `type: 'aviso'` (`AlertTriangle`, [17-detalhe-vazio-motor-1366.png](./capturas/onda-2-reav/17-detalhe-vazio-motor-1366.png)), e `PainelMotorSinais.tsx` L201–204 oculta `blocosVisiveis` quando `transcript === null`; `#429` (`b87f818`): `Fontes.tsx` L276 usa `hidden 2xl:flex` na lista com gaveta aberta ([03-fontes-fts-1366.png](./capturas/onda-2-reav/03-fontes-fts-1366.png)). |
| **UI-28** | P2 | Refs `#296`/`#302`/`#307`, `Fonte #4` no toast, `legacy`/`US$ 0,00` em Lotes, seta dupla `→ Ir para Cortes →` e `~US$ 0,00 – US$ 0,00` | **Resolvido** | `#431` (`b95dd2b`): remove `#296`/`#302`/`#307` e resolve nome da Fonte via `resolverNomeFonte`; `#426` (`604d518`): substitui `legacy` e alinha estimativa ([12-lotes-montar-custo-1366.png](./capturas/onda-2-reav/12-lotes-montar-custo-1366.png)); `#429` (`b87f818`): remove `→` duplicado ([01-fontes-lista-1366.png](./capturas/onda-2-reav/01-fontes-lista-1366.png)); `#430` (`071649b`): `faixaUsd` exibe `< US$ 0,01` ([17-detalhe-vazio-motor-1366.png](./capturas/onda-2-reav/17-detalhe-vazio-motor-1366.png)). |
| **UI-29** | P3 | `←`/`→` no Leitor parava na borda da janela virtualizada e `Refazer` sem badge `Ctrl+Shift+Z` | **Resolvido** | `#431` (`b95dd2b`): `LeitorTranscricao.tsx` L500–556 rola e foca linha adjacente após carregar página e L737 adiciona `atalho={formatarTecla('Mod+Shift+Z')}` em `Refazer` ([20-detalhe-leitor-1366.png](./capturas/onda-2-reav/20-detalhe-leitor-1366.png)); validado em `DetalheFonte.test.tsx` (`UI-29`). |

---

## 4. Achados novos (`UI-40` em diante)

> Nenhum bloqueador P0/P1 encontrado. Faixa `UI-30`–`UI-39` reservada à Onda 3.

| ID | Sev. | Categoria | Tela / Arquivo | Passo para reproduzir | Captura | Sugestão de correção |
|---|---|---|---|---|---|---|
| **UI-40** | **P2** | visual | `#/projeto/:id/fontes?sub=lotes` (`LotesFontes.tsx` L168–178 + `ConstrutorLote.tsx` L589–597) e `#/projeto/:id/fontes?estado=vazio` (`Fontes.tsx` L316–324 + `EntradaFonte.tsx` L594–601) | 1) Abrir `?sub=lotes` com Fontes importadas e nenhum lote criado (`lotes.length === 0`): o botão `Iniciar lote com N Fontes` (`variante="primario"`) e o botão `Focar seleção de Fontes` (`acaoPrimaria` do `<EstadoTela tipo="vazio">`) aparecem simultaneamente em `bg-sinal`. 2) Em `#/projeto/:id/fontes?estado=vazio`, alternar `EntradaFonte` para `URL (VOD)`: `Baixar por URL` e `Importar primeira Fonte` coexistem em `bg-sinal` (violação residual da *Regra da Luz Única*). | [12-lotes-montar-custo-1366.png](./capturas/onda-2-reav/12-lotes-montar-custo-1366.png) *(fundo)* | Trocar `acaoPrimaria` por `acaoSecundaria` em `LotesFontes.tsx` L174 e em `Fontes.tsx` L320 quando `EntradaFonte` estiver com CTA primário ativo (mesmo padrão aplicado em **UI-26**). |
| **UI-41** | **P2** | visual | `#/projeto/:id/fontes/:fonteId` (`PainelMotorSinais.tsx` L1000–1018 + `DetalheFonte.tsx` L553–569) | Em `1366×768`, iniciar a transcrição da Fonte `Live_12_11_final.mp4`: a coluna direita informa *"Se pausar agora, poderá retomar exatamente desse ponto sem refazer os blocos prontos"*, porém o único botão `Pausar / Cancelar mantendo blocos salvos` fica no rodapé do card `Blocos de 10 min`, **abaixo da dobra rolável** da coluna esquerda devido à altura do card `Motor de transcrição` + VAD. | [19-detalhe-blocos-progresso-1366.png](./capturas/onda-2-reav/19-detalhe-blocos-progresso-1366.png) | Exibir um botão secundário `Pausar / Cancelar mantendo blocos salvos` também dentro do card central `Transcrição em andamento` em `DetalheFonte.tsx` (ou recolher o bloco VAD enquanto `transcricaoRodando` for verdadeiro). |
| **UI-42** | **P3** | texto | `#/projeto/:id/fontes?sub=lotes` (`ListaLotes.tsx` L346) e `#/projeto/:id/fontes/:fonteId` (`DetalheFonte.tsx` L496) | Comparar os botões de transição para Cortes: `ListaFontes` (`UI-28`) usa `icone={<ArrowRight />}` à esquerda sem seta no texto (`Ir para Cortes`), enquanto `ListaLotes` (`Revisar Cortes →`) e `DetalheFonte` (`Selecionar Cortes →`) mantêm a seta literal `→` no fim do rótulo. | [13-lotes-execucao-1366.png](./capturas/onda-2-reav/13-lotes-execucao-1366.png), [20-detalhe-leitor-1366.png](./capturas/onda-2-reav/20-detalhe-leitor-1366.png) | Padronizar os botões de navegação para Cortes com `icone={<ArrowRight />}` e rótulo sem `→` literal (ou adotar a mesma convenção em todas as telas). |

---

## 5. Inventário das capturas PNG (`docs/produto/front-v2/ui/capturas/onda-2-reav/`)

Total: **23 arquivos** gerados por `front-v2/e2e/ui-onda2.spec.ts` (`$env:UI_BASELINE = "1"`).

| Arquivo | Tela / Estado | Viewport / Tema | Sustenta |
|---|---|---|---|
| `01-fontes-lista-1366.png` | `#/projeto/.../fontes` (lista com `changed`, `offline`, `mismatch`, `available`) | `1366×768` · padrão | Fluxo (e) e UI-28 |
| `02-fontes-vazio-1366.png` | `#/projeto/.../fontes?estado=vazio` | `1366×768` · padrão | Fluxo (e) estado vazio |
| `03-fontes-fts-1366.png` | Busca FTS5 `frase 142` com `<GavetaBuscaFts>` ocupando a coluna direita | `1366×768` · padrão | Fluxo (e), UI-21 e UI-27c |
| `04-fontes-excluir-dialog-1366.png` | `<ConfirmDialog>` `Excluir Fonte — offline.mp4?` | `1366×768` · padrão | Fluxo (e) foco em Cancelar |
| `05-fontes-lista-1440.png` | Lista após relocalizar V1 e selecionar 2 Fontes para lote | `1440×900` · padrão | Fluxo (e) responsivo e UI-28 |
| `06-fontes-lista-hc-1366.png` | `#/projeto/.../fontes` em alto contraste | `1366×768` · `[data-contrast="high"]` | Fluxo (e) WCAG AA |
| `07-entrada-local-inspecao-1366.png` | Arquivo local multipista OBS + `CampoPermissao` `granted` | `1366×768` · padrão | Fluxo (f) entrada local |
| `08-entrada-url-termos-1366.png` | Modo `URL (VOD)` + `<ConfirmDialog>` Termos do YouTube | `1366×768` · padrão | Fluxo (f) termos |
| `09-entrada-url-jit-1366.png` | Erro `js_runtime_missing` + `<InstaladorJustInTime>` inline | `1366×768` · padrão | Fluxo (f) JIT |
| `10-entrada-url-erro-idade-1366.png` | Erro `age_restricted` com CTA `Importar arquivo local` | `1366×768` · padrão | Fluxo (f) recuperação de erro |
| `11-entrada-jit-1440.png` | `<InstaladorJustInTime>` com tamanho, licença e origem | `1440×900` · padrão | Fluxo (f) aviso antes de ação externa |
| `12-lotes-montar-custo-1366.png` | `<ConfirmDialog>` com `<ResumoCustoPrivacidade>` ao criar lote Groq | `1366×768` · padrão | Fluxo (g), UI-28 e UI-40 |
| `13-lotes-execucao-1366.png` | `Lote #1` em execução com `<TabelaGrade>` e `< US$ 0,01` | `1366×768` · padrão | Fluxo (g), UI-25, UI-28 e UI-42 |
| `14-lotes-erro-local-only-1366.png` | Erro `local_only_violation` rolado e focado no `ConstrutorLote` | `1366×768` · padrão | Fluxo (g) e UI-22 |
| `15-lotes-budget-uncertain-1440.png` | `Lote #2` `budget_paused` + `timeout_uncertain` | `1440×900` · padrão | Fluxo (g) e UI-25 |
| `16-lotes-hc-1440.png` | Tela Lotes de Fontes em alto contraste | `1440×900` · `[data-contrast="high"]` | Fluxo (g) WCAG AA |
| `17-detalhe-vazio-motor-1366.png` | `#/projeto/.../fontes/4?estado=vazio` (Motor Local, toast aviso, 1 `bg-sinal`, `< US$ 0,01`) | `1366×768` · padrão | Fluxo (h), UI-24, UI-26, UI-27 e UI-28 |
| `18-detalhe-groq-custo-1366.png` | Motor `Groq remoto` com `<ResumoCustoPrivacidade>` | `1366×768` · padrão | Fluxo (h), UI-24 e UI-26 |
| `19-detalhe-blocos-progresso-1366.png` | Transcrição em andamento com blocos de 10 min e amostra 30 s | `1366×768` · padrão | Fluxo (h) e UI-41 |
| `20-detalhe-leitor-1366.png` | Leitor virtualizado com `CorrigidaUI`, `Silêncio` e `Refazer Ctrl+Shift+Z` | `1366×768` · padrão | Fluxo (h), UI-29 e UI-42 |
| `21-detalhe-erro-offline-1366.png` | `?estado=offline` (player bloqueado + Leitor editável) | `1366×768` · padrão | Fluxo (h) erro/offline |
| `22-detalhe-leitor-1440.png` | Detalhe completo da Fonte com blocos e Leitor `≤ 72 ch` | `1440×900` · padrão | Fluxo (h) e UI-29 |
| `23-detalhe-hc-1440.png` | Detalhe completo da Fonte em alto contraste | `1440×900` · `[data-contrast="high"]` | Fluxo (h) WCAG AA |
