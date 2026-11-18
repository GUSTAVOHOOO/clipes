# Reavaliação Independente de UI — Onda 3: Seleção e Bancada de Revisão (`front-v2`)

> **Método:** `dual-agent` (Assessment A — Design Review: `b3e42f49` · Assessment B — Technical Audit & DOM/Detector Evidence: `fef6dfe2`), combinado à execução integral do cenário Playwright (`21` estados/capturas) e às verificações estáticas.
>
> **Data da avaliação:** 2026-11-18  
> **Commit avaliado (`HEAD`):** `d13704b` (`fix(front-v2): corrige UI-30, UI-32c, UI-35a e UI-36 na Seleção de Cortes (#448)`)  
> **Linha de base comparada:** `c28c92f` / `071649b` ([avaliacao-onda-3.md](./avaliacao-onda-3.md))  
> **Entregas incorporadas desde a linha de base:** correções da Onda 3 (`UI-30` a `UI-36`) via `#445` (`376ed2e`), `#452` (`e701c2e`) e `#448` (`d13704b`), além de `#451` (Onda 2) e avanços da Onda 4 no `master`.  
> **Escopo:** Onda 3 — Macro-etapa 2 **Cortes: Seleção e Revisão**: Fluxo **(i)** Configurador de Seleção (`#/projeto/:id/cortes` esq.), Fluxo **(j)** Acompanhamento de Seleção (`#/projeto/:id/cortes` dir.), Fluxo **(k)** Bancada de Revisão (`#/projeto/:id/cortes/revisao/:runId`) e Fluxo **(l)** Estados de erro e vazios dessas telas. Papel exclusivamente avaliador — nenhuma tela ou script de teste foi alterado neste PR.

---

## 1. Cenário reproduzido e saídas automatizadas

O cenário fixo da linha de base foi executado integralmente e sem edições sobre o mock TypeScript (`VITE_CORE_MOCK=1`, sem Tauri) pelo script `front-v2/e2e/ui-onda3.spec.ts`, nos viewports `1366×768` e `1440×900`, tema escuro padrão e modo de alto contraste (`[data-contrast="high"]`).

### Comandos executados e resultados observados

- `cd front-v2 && bun install`: `152 packages installed` (exit `0`).
- `cd front-v2 && bun run typecheck`: `tsc --noEmit` limpo (exit `0`).
- `cd front-v2 && bun run test -- --maxWorkers=2`: **`58 passed (58)`** arquivos, **`481 passed (481)`** testes unitários/componentes (exit `0`).
- `cd front-v2 && bunx playwright test` (suíte padrão sem `UI_BASELINE`): **`29 passed`**, **`3 skipped`** (`e2e/ui-baseline.spec.ts`, `e2e/ui-onda2.spec.ts`, `e2e/ui-onda3.spec.ts`) (exit `0`, `31.7s`).
- `cd front-v2 && $env:UI_BASELINE = "1"; bunx playwright test e2e/ui-onda3.spec.ts`: **`1 passed`** (`22.7s`, reexecutado com `--reporter=json` para extração de `ui-onda3-audit.json`), **`0`** `pageerror`, **`0`** ocorrências de overflow externo (`1366×768` e `1440×900`) e **`0`** overflow em tabelas internas nos **21 estados auditados**.
- `bunx impeccable detect --json front-v2/src`: **`[]`** (exit `0`, zero achados no detector mecânico).
- `cd design-system-v2 && bun scripts/contraste.ts`: **`Todos os pares passam.`** (escuro, claro, escuro `[data-contrast="high"]` e claro `[data-contrast="high"]`, exit `0`).

### Síntese das verificações transversais (DOM + Teclado + Glossário)

| Aspecto | Resultado observado | Evidência / Observação |
|---|---|---|
| **Teclado (`Tab`, `Esc`, `F6`, `Ctrl+K`, `Ctrl+Z`, `A/R/I/O`, `Espaço/J/K/L`, setas)** | **Aprovado** | `F6` / `Shift+F6` em C.1 agora cicla as 4 regiões (`Topo → Configurador → Acompanhamento → Rodapé`, **UI-36**); `↑`/`↓` na `listbox`, `ArrowRight` no `radiogroup` e transporte `Espaço`/`J`/`K`/`L`/`←`/`→` funcionam; `Ctrl+Z` desfaz aprovação e ajuste em sequência; campos de texto bloqueiam teclas únicas; modo `Alt + tecla` atualiza os `<Kbd>` (`["Alt+I","Alt+O","Alt+A","Alt+R","Enter"]`, **UI-32**); todos os `<span tabIndex={0}>` foram substituídos por `aria-disabled="true"` direto em `<Botao>`. |
| **Foco visível (WCAG 2.4.7)** | **Parcial** *(achado **UI-50**)* | Botões, links, `radiogroup` e `listbox` exibem anel `2px solid rgb(255, 90, 31)` (ou borda `1px inset` em alto contraste). Porém `<Select>` (e `<Entrada>`/`<Slider>` via `caixaCampo`/`Slider`) computam **`outline: 2px none rgb(255, 90, 31)`** na auditoria DOM (`i-selecao-hc`, `l-erro-selecao-contexto`, `l-vazio-revisao-filtro-zerado`) por falta de `outline-solid` após `outline-none` no Tailwind v4 (**UI-50**). |
| **Contraste WCAG 2.2 AA** | **Aprovado** | **`0`** textos abaixo de `4,5:1` (`3:1` texto grande) nos 21 estados auditados, inclusive em `[data-contrast="high"]` (`05`, `14`). `contraste.ts` aprova todos os pares. |
| **Alvos ≥ 24 px (WCAG 2.5.8)** | **Aprovado** | **`0`** alvos `< 24 px` no DOM nos 21 estados; `<Slider>` `Nota mínima` agora recebe largura plena em grid `minmax(0,1fr)_152px` (`10`–`14`, `18`, **UI-33b**). |
| **Headings (`h1–h6`)** | **Aprovado** | `h1Count = 1` e `saltoHeading = null` em todos os 21 estados auditados. |
| **Textos PT-BR e `GLOSSARY.md`** | **Aprovado** para glossário/tickets; **Parcial** em concordância/perfil *(achado **UI-55**)* | **`0`** violações de glossário e **`0`** refs de ticket (`#304` removido, `legacy` traduzido para `Perfil configurado`, `cancelled` mapeado em `text-t3`, **UI-35**). Permanecem discordâncias menores (`"1 candidatos · 1 juntados"`, `"1 aprovados"`, `"Gerado por forte"`, `"×1.5"`, **UI-55**). |
| **Regra da Luz Única** | **Aprovado** | `1` único botão `bg-sinal` em todas as telas padrão/vazias (incluindo `18-vazio-revisao-filtro-zerado-1366.png` após rebaixar `Limpar filtros` para `acaoSecundaria`, **UI-34b**). Nos 3 diálogos (`03`, `08`, `09`), o contador `2` reflete apenas o botão da tela de fundo sob o `veu` do modal. |
| **Estados de erro, proxy e aviso de custo** | **Aprovado** *(observação em **UI-52**)* | `context_too_small` aparece com `<BannerErroCore>` e `"Reduzir duração máxima"` no fluxo padrão (`16`, **UI-30**); banner de redo não vaza entre runs e proxy respeita `state === 'ready'` (`10`, `11`, **UI-31**); `DialogoResolverIncerteza` usa `bg-area`/`border-linha` (`08`, **UI-34a**); `PlayerProxy` exibe `"Prévia indisponível"` sem `<img>` quebrada (`10`, **UI-34c**). |

---

## 2. Tabela de pontuação por fluxo (Critique — Nielsen 0–4)

Meta do mandato: **≥ 90%** da pontuação aplicável (**`36 / 40`**), WCAG 2.2 AA e zero bloqueador funcional.  
Legenda: **H1** Visibilidade de estado · **H2** Mundo real / vocabulário · **H3** Controle e liberdade · **H4** Consistência e padrões · **H5** Prevenção de erros · **H6** Reconhecimento vs. lembrança · **H7** Flexibilidade e atalhos · **H8** Estética e minimalismo · **H9** Recuperação de erros · **H10** Ajuda e documentação.

| Fluxo / Superfície | H1 | H2 | H3 | H4 | H5 | H6 | H7 | H8 | H9 | H10 | Original (`c28c92f`) | Agora (`d13704b`) | Delta | % Agora | Meta ≥ 90% |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| **Fluxo (i) · Configurador de Seleção (`#/projeto/:id/cortes` esq.)** | 3 | 4 | 4 | 3 | 4 | 4 | 3 | 3 | 4 | 4 | 35 / 40 (87,5%) | **36 / 40** | **+1 (+2,5 p.p.)** | **90,0%** | **Atinge** |
| **Fluxo (j) · Acompanhamento de Seleção (`#/projeto/:id/cortes` dir.)** | 4 | 3 | 4 | 3 | 4 | 4 | 4 | 4 | 4 | 4 | 33 / 40 (82,5%) | **38 / 40** | **+5 (+12,5 p.p.)** | **95,0%** | **Atinge** |
| **Fluxo (k) · Bancada de Revisão (`#/projeto/:id/cortes/revisao/:runId`)** | 3 | 3 | 4 | 3 | 4 | 4 | 4 | 3 | 4 | 4 | 32 / 40 (80,0%) | **36 / 40** | **+4 (+10,0 p.p.)** | **90,0%** | **Atinge** |
| **Fluxo (l) · Estados de erro e vazios (C.1 e C.2)** | 3 | 4 | 4 | 3 | 4 | 4 | 4 | 3 | 4 | 4 | 36 / 40 (90,0%) | **37 / 40** | **+1 (+2,5 p.p.)** | **92,5%** | **Atinge** |

> **Nota de conformidade da meta:** Todos os 4 fluxos atingem **≥ 90%** com **zero bloqueadores funcionais** (`UI-30` e `UI-31` resolvidos), porém a meta de **WCAG 2.2 AA integral** fica condicionada à correção do achado **UI-50 (P1)** no Design System (`outline: 2px none` em `<Select>`, `<Entrada>` e `<Slider>`).

### Justificativa das mudanças por heurística e fluxo

- **Fluxo (i) · Configurador de Seleção (`35/40 → 36/40`, +1 pt / +2,5 p.p., Atinge 90,0%):**
  - **H1 (`3 → 3`)**: O flash transitório de `semPerfilConfigurado` ao trocar para `offline.mp4` foi eliminado (`04`, **UI-30**); permanece em `3` porque no modo sem perfil em `assistant.tasks`, o selo `"Contexto gerenciado pelo CLI"` continua visível em `04` e contradiz `context_too_small` em `16` (**UI-52**).
  - **H4 (`4 → 3`)**: Cai 1 ponto porque o `<Select>` de Fonte e os campos `<Entrada>` de duração usam `caixaCampo` com `outline: 2px none`, divergindo do anel `2px solid` dos botões e rádios (**UI-50**).
  - **H5 (`3 → 4`)**: `semPerfilConfigurado` não mascara mais `erroEstimativa` nem oscila enquanto `selection.estimate` carrega (**UI-30**).
  - **H7 (`3 → 3`)**: `F6`/`Shift+F6` agora alcança o Configurador diretamente (**UI-36**); porém em `1366×768` (`01`, `02`, `05`) o `<ResumoCustoPrivacidade>` e o botão `"Selecionar Cortes"` continuam abaixo da dobra rolável (**UI-51**).
  - **H8 (`4 → 3`)**: Em `1366×768` (`01`, `05`), o corte horizontal de linhas na base da área rolável (`Sai da máquina` / `Custo`) prejudica o respiro e esconde o CTA primário (**UI-51**).
  - **H9 (`2 → 4`)**: `context_too_small` volta a exibir `<BannerErroCore>` com `"Reduzir duração máxima"` e `"Trocar Perfil de Provedor"` mesmo quando `assistant.tasks` retorna `profile: null` (`16`, **UI-30**).

- **Fluxo (j) · Acompanhamento de Seleção (`33/40 → 38/40`, +5 pts / +12,5 p.p., Atinge 95,0%):**
  - **H1 (`3 → 4`)**: `Execução #1` e as Janelas agora exibem `Perfil base: Principal` / `Perfil: Principal` em vez de `legacy` cru ([01-selecao-config-1366.png](./capturas/onda-3-reav/01-selecao-config-1366.png), **UI-35**).
  - **H2 (`2 → 3`)**: `#304` removido de `<SeletorPerfilRedo>` (`09`), `legacy` traduzido e janela cancelada explicada em PT-BR claro (`09`, **UI-35**); fica em `3` por `"1 candidatos · 1 juntados"` em `04` e identificador `forte` sem rótulo amigável em `01` (**UI-55**).
  - **H4 (`3 → 3`)**: `DialogoResolverIncerteza` e `SeletorPerfilRedo` adotaram tokens `@ds` (`08`, `09`, **UI-34a**) e `<span tabIndex={0}>` foi substituído por `aria-disabled="true"` (`07`, **UI-32b**); mantém `3` pelo `outline: 2px none` no `<Select>` de Execução (**UI-50**).
  - **H7 (`3 → 4`)**: `F6` / `Shift+F6` agora inclui o painel de Acompanhamento como região própria (`Selecao.tsx`, **UI-36**).
  - **H8 (`3 → 4`)**: Remoção das bordas brancas v1 em `DialogoResolverIncerteza` (`08`) restaura a *Regra do Degrau* (**UI-34a**).
  - **H9 (`3 → 4`)**: Janela cancelada exibe `"Esta operação foi cancelada antes de concluir."` em `text-t3` (sem falso alarme vermelho, `09`, **UI-35**).

- **Fluxo (k) · Bancada de Revisão (`32/40 → 36/40`, +4 pts / +10,0 p.p., Atinge 90,0%):**
  - **H1 (`2 → 3`)**: Banner fantasma de redo (`10`, **UI-31a**), proxy pulando progresso (`11`, **UI-31b**) e ícone de `<img>` quebrada (`10`, **UI-34c**) foram corrigidos; permanece em `3` pelo detalhe ativo mantido com lista zerada (`18`, **UI-53**), `<Transporte>` ativo sobre Fonte offline (`20`, **UI-56**) e quadro preto sem placeholder na captura de alto contraste (`14`, **UI-56**).
  - **H2 (`3 → 3`)**: `Gerado por legacy` foi corrigido para `Gerado por Perfil configurado` (`20`, **UI-35**), mas `"1 aprovados"` (`10`), `"Gerado por forte"` (`10`–`13`) e peso `"×1.5"` (`12`–`13`) mantêm H2 em `3` (**UI-55**).
  - **H4 (`2 → 3`)**: `<Kbd>` acompanha WCAG 2.1.4, `<Transporte compacto>` omitiu `I`/`O` redundantes (**UI-32**), `<span tabIndex={0}>` sumiu e `<Transporte>`/`<Slider>` não quebram mais (**UI-33**); perde 1 ponto por `outline: 2px none` em `<Slider>` `Nota mínima` e `<Select>` (`Maior Nota` / Revisão) (**UI-50**).
  - **H7 (`3 → 4`)**: Sub-cabeçalho em 1 linha (`min-[1280px]:flex-nowrap`) mantém `Aprovar`, `Rejeitar` e `Abrir no editor` acima da dobra em `1366×768` (`10`, `12`, **UI-33c**).
  - **H8 (`2 → 3`)**: `<Transporte>` e `<Slider>` agora são limpos e legíveis em `1366×768` e `1440×900` (`10`–`14`, **UI-33a/b**); perde 1 ponto pelo truncamento rígido `max-w-24` do nome da Fonte (`Live_12_11_final...`) mesmo em `1440×900` (`13`, **UI-54**).

- **Fluxo (l) · Estados de erro e vazios (`36/40 → 37/40`, +1 pt / +2,5 p.p., Atinge 92,5%):**
  - **H1 (`4 → 3`)**: Cai 1 ponto porque `16-erro-selecao-contexto-1366.png` mostra `"Contexto gerenciado pelo CLI"` acima do erro `context_too_small` (**UI-52**) e `18` mantém o detalhe do candidato visível enquanto a lista exibe `0 de 3 Cortes` (**UI-53**).
  - **H4 (`3 → 3`)**: *Regra da Luz Única* foi restaurada em `18` (`Limpar filtros` passou a `acaoSecundaria`, `sinal = 1`, **UI-34b**), porém `Limpar filtros` sem superfície `bg-elevado` parece texto solto (**UI-53**) e `<Select>`/`<Slider>` falham `focus-visible` (`outline: 2px none`, **UI-50**).
  - **H5 (`3 → 4`)**: `context_too_small` não é mais encoberto no fluxo padrão sem `?assistant-test=1` (**UI-30**).
  - **H8 (`4 → 3`)**: Em `16`, `"Ver detalhe técnico"` fica cortado na borda inferior da coluna esquerda em `1366×768` (**UI-51**).
  - **H9 (`2 → 4`)**: Recuperação de `context_too_small` (`"Reduzir duração máxima"` + `"Trocar Perfil de Provedor"`) voltou a operar no caminho padrão (`16`, **UI-30**).

### Especificidade de Design e Red Flags de Personas

- **Veredito de especificidade (`DESIGN.md`):** A identidade *"Ilha de edição, uma luz acesa"* está coesa em todas as superfícies da Onda 3: grafite em degraus limpos (`chao → area → elevado`), *Regra da Luz Única* respeitada sem selos coloridos, *Regra do Erro Sem Fundo* aplicada nos alertas/botões de perigo e números tabulares (`num`) em todos os timecodes, contadores e notas.
- **Red flags observadas por persona:**
  - **Alex (Power User, teclado):** C.2 permite triagem fluida acima da dobra (`10`, `12`) com `A`/`R`/`I`/`O`/`Ctrl+Z` e `Alt+tecla`; porém, ao filtrar até `0` itens (`18`), o detalhe anterior permanece vivo para `A`/`R` (**UI-53**), e em C.1 (`01`, `02`, `05`) o botão `"Selecionar Cortes"` exige rolagem em `1366×768` (**UI-51**).
  - **Jordan (First-Timer):** Em `16`, ver `"Contexto gerenciado pelo CLI"` acima de `"A Janela de contexto deste Perfil de Provedor é pequena..."` gera contradição (**UI-52**); em `18`, `"Limpar filtros"` sem fundo `elevado` parece texto comum (**UI-53**); em `20`, o botão Play ativo abaixo de `"não é possível exibir o preview"` confunde (**UI-56**).
  - **Sam (Acessibilidade / Teclado / Alto Contraste):** Avanço sólido em `F6`, `<Kbd>` adaptável (WCAG 2.1.4) e remoção de `<span tabIndex={0}>`; resta o defeito P1 de foco invisível (`outline: 2px none`) em `<Select>`, `<Entrada>` e `<Slider>` (**UI-50**).
  - **Riley (Casos de Borda):** Fluxos `local_only`, `context_too_small`, `uncertain`, `cancelled`, `0` fontes, `0` candidatos e `offline.mp4` operam sem `pageerror` nem vazamento entre execuções; restam o corte de `"Ver detalhe técnico"` em `16` (**UI-51**) e o estado de lista zerada com detalhe vivo (`18`, **UI-53**).

### Auditoria Técnica (Impeccable Audit — `/20`)

| Dimensão | Original | Agora | Delta | Achado principal |
|---|---|---|---|---|
| 1. Accessibility | 2 / 4 | **3 / 4** | **+1** | Contraste AA/AAA (`contraste.ts` + 21 auditorias), `0` alvos `< 24 px`, `0` saltos de heading, `F6` nas 4 regiões (**UI-36**), `<Kbd>` WCAG 2.1.4 e `aria-disabled` sem `<span tabIndex={0}>` (**UI-32**) aprovados; cai 1 ponto por **`outline: 2px none`** em `<Select>`, `<Entrada>` e `<Slider>` (`Campos.tsx` / `Escolhas.tsx`, **UI-50**, WCAG 2.4.7). |
| 2. Performance | 4 / 4 | **4 / 4** | **0** | `<ListaVirtual>` virtualizada, `core-progress` reativo sem `setInterval` e estimativa com debounce de `140 ms`. |
| 3. Theming | 3 / 4 | **4 / 4** | **+1** | Variáveis v1 removidas de `DialogoResolverIncerteza` e `SeletorPerfilRedo` (**UI-34a**); 100% tokens `@ds` e `[data-contrast="high"]` aprovado (`05`, `14`). |
| 4. Responsive Design | 2 / 4 | **4 / 4** | **+2** | `0` overflow externo/interno nos 21 estados em `1366×768` e `1440×900`; `<Transporte compacto>`, grid do `<Slider>`/`<Select>` e sub-cabeçalho em 1 linha corrigidos (**UI-33**). |
| 5. Implementation Integrity | 2 / 4 | **3 / 4** | **+1** | `impeccable detect` limpo (`[]`), `0` bloqueadores funcionais (`UI-30`/`UI-31` resolvidos), *Regra da Luz Única* restaurada (`18`), fallback de `PlayerProxy` (`10`) e `#304`/`legacy`/`cancelled` tratados (**UI-35**); cai 1 ponto pelo defeito de foco em `caixaCampo`/`Slider` (**UI-50**), selo CLI contraditório (**UI-52**) e detalhes menores em botões `aria-disabled` (`cursor-pointer` sem `cursor-not-allowed`, **UI-56**). |
| **Total** | **13 / 20** *(Acceptable)* | **18 / 20** *(Excellent)* | **+5** | **Todos os fluxos (i)–(l) ≥ 90% e zero bloqueadores funcionais; 1 P1 de A11y (`UI-50`) no Design System impede aprovação plena de WCAG 2.2 AA.** |

---

## 3. Status dos achados da linha de base (`UI-30` a `UI-36`)

| ID | Sev. | Descrição resumida (linha de base) | Status | Evidência na reavaliação (captura / passo / código) |
|---|---|---|---|---|
| **UI-30** | **P1** | `semPerfilConfigurado` engolia `context_too_small` sem perfil em `assistant.tasks` e piscava ao trocar de Fonte | **Resolvido** | `ConfiguradorSelecao.tsx` L303, L346, L466–540, L684 adiciona `estimativaPendente` e impede `semPerfilConfigurado` enquanto houver erro ativo ou estimativa pendente. Comprovado em [16-erro-selecao-contexto-1366.png](./capturas/onda-3-reav/16-erro-selecao-contexto-1366.png) (exibe `<BannerErroCore>` com `"Reduzir duração máxima"`) e [04-selecao-fonte-offline-1440.png](./capturas/onda-3-reav/04-selecao-fonte-offline-1440.png) (sem flash ao trocar para `offline.mp4`); coberto em `ConfiguradorSelecao.test.tsx` (`UI-30`). |
| **UI-31** | **P1** | Banner de redo vazando entre runs e `proxy.status` forçando `'ready'` com `job: 7` reutilizado | **Resolvido** | `Revisao.tsx` L338–359 restringe `jobSelecaoAtivo` a `selection-${runId}` e `jobsDoRun` (excluindo janelas canceladas); confirmado em [10-revisao-bancada-1366.png](./capturas/onda-3-reav/10-revisao-bancada-1366.png). `DetalheCandidato.tsx` L298–299, L427, L442–471 controla `filaInicioProxyRef`/`ultimaFilaStatusRef` e só transiciona para `'ready'` quando `res.state === 'ready'`; confirmado em [11-revisao-proxy-progresso-1366.png](./capturas/onda-3-reav/11-revisao-proxy-progresso-1366.png) e `DetalheCandidato.test.tsx` (`UI-31b`). |
| **UI-32** | **P1** | `<Kbd>` estático em `Alt + tecla`, `Transporte` `I`/`O` ignorando `moves.*` e `<span tabIndex={0}>` | **Resolvido** | `DetalheCandidato.tsx` L248–257, L705–712 usa `resolverTeclaExibida` + `formatarTecla` (`checksExtras.atalhosRevisao.kbdLabelsAltMode = ["Alt+I","Alt+O","Alt+A","Alt+R","Enter"]`). `Transporte compacto` (L835–847) omite `I`/`O` redundantes, eliminando divergência com `moves.*`. Wrappers `<span tabIndex={0}>` substituídos por `aria-disabled="true"` direto em `<Botao>` (`AcompanhamentoSelecao.tsx` L638–648 em [07-acompanhamento-uncertain-1366.png](./capturas/onda-3-reav/07-acompanhamento-uncertain-1366.png), `Revisao.tsx` L950–982 e `DetalheCandidato.tsx` L865–876). |
| **UI-33** | **P1** | `<Transporte>` estourado, `<Slider>` `Nota mínima` esmagado e sub-cabeçalho quebrado em `1366×768` | **Resolvido** | `DetalheCandidato.tsx` L720–722, L835 + `Midia.tsx` L108–152 (`clamp(228px,30vh,260px)` + `Transporte compacto`); `ListaCandidatos.tsx` L185–208 (`grid-cols-[minmax(0,1fr)_152px]`); `Revisao.tsx` L908–943 (`min-[1280px]:flex-nowrap`, `w-[108px]`). Comprovado em [10-revisao-bancada-1366.png](./capturas/onda-3-reav/10-revisao-bancada-1366.png), [12-revisao-eixos-bordas-aprovado-1366.png](./capturas/onda-3-reav/12-revisao-eixos-bordas-aprovado-1366.png) e [13-revisao-transformado-1440.png](./capturas/onda-3-reav/13-revisao-transformado-1440.png) (`Aprovar`/`Abrir no editor` acima da dobra em `1366×768`). |
| **UI-34** | **P2** | Tokens v1 em diálogos, 2 `bg-sinal` no filtro zerado e `<img>` quebrada no `PlayerProxy` | **Resolvido** | (a) `DialogoResolverIncerteza.tsx` L187–197 e `SeletorPerfilRedo.tsx` L244, L294 migrados para `@ds` ([08-acompanhamento-resolver-incerteza-1366.png](./capturas/onda-3-reav/08-acompanhamento-resolver-incerteza-1366.png)); (b) `ListaCandidatos.tsx` L219–221 usa `acaoSecundaria` quando `selecionadoId !== null` (`botoesPrimariosSinal = 1` em [18-vazio-revisao-filtro-zerado-1366.png](./capturas/onda-3-reav/18-vazio-revisao-filtro-zerado-1366.png)); (c) `Midia.tsx` L39–60 adiciona `onError` + `"Prévia indisponível"` (`imagensQuebradas = 0` em todos os estados, visível em `10`, `12`, `13`, `18`). |
| **UI-35** | **P2** | `#304` em `SeletorPerfilRedo`, `legacy` cru e `cancelled` com texto vermelho genérico | **Resolvido** | `#304` removido de `SeletorPerfilRedo.tsx` ([09-acompanhamento-redo-perfil-1440.png](./capturas/onda-3-reav/09-acompanhamento-redo-perfil-1440.png)); `legacy` traduzido para `"Perfil configurado"` (`AcompanhamentoSelecao.tsx` L154–164, `DetalheCandidato.tsx` L218–222, confirmado em `01` e [20-erro-revisao-proxy-offline-1366.png](./capturas/onda-3-reav/20-erro-revisao-proxy-offline-1366.png)); `cancelled` mapeado em `erros.ts` L577–579 e estilizado com `text-t3` (`AcompanhamentoSelecao.tsx` L807, confirmado em `09`). |
| **UI-36** | **P3** | `F6` em C.1 não separava Configurador (esquerda) de Acompanhamento (direita) | **Resolvido** | `Selecao.tsx` L38–51, L129–191, L489–523 registra `F6` / `Shift+F6` em 4 regiões (`Topo → Configurador → Acompanhamento → Rodapé`), validado em `Selecao.test.tsx` L879–941. *(Nota: `ui-onda3.spec.ts` L409–415 lê `closest('[data-regiao]')`, que retorna `"conteudo"` porque `<aside>` não declara `data-regiao` próprio, embora o foco entre no Configurador.)* |

---

## 4. Achados novos (`UI-50` em diante)

> Zero bloqueadores funcionais (`P0`) encontrados. Há **1 achado P1 de A11y AA (WCAG 2.4.7)** herdado das primitivas de formulário do Design System v2.

| ID | Sev. | Categoria | Tela / Arquivo | Passo para reproduzir | Captura / Evidência | Sugestão de correção |
|---|---|---|---|---|---|---|
| **UI-50** | **P1** | A11y AA | `#/projeto/:id/cortes` e `#/projeto/:id/cortes/revisao/:runId` (`design-system-v2/src/primitivas/Campos.tsx` L11–12; `Escolhas.tsx` L94) | Navegar com `Tab` até qualquer `<Select>` (`Fonte transcrita`, `Execução`, `Ordenar candidatos`, `Revisão`), `<Entrada>` (`Duração mínima`/`máxima`) ou `<Slider>` (`Nota mínima`): `caixaCampo` e `Slider.Thumb` combinam `outline-none` (`outline-style: none`) com `focus-visible:outline-2` / `has-focus-visible:outline-2` **sem** `outline-solid`. No Tailwind v4, `outline-2` define só a largura, mantendo `outline-style: none` e anulando o anel de foco (WCAG 2.4.7). | `ui-onda3-audit.json` (`focusOutlineTeste` em `i-selecao-hc`, `l-erro-selecao-contexto` e `l-vazio-revisao-filtro-zerado`: `"outline": "2px none rgb(255, 90, 31)"`) | Adicionar `focus-visible:outline-solid` em `caixaCampo` (`Campos.tsx` L12) e `has-focus-visible:outline-solid` em `Slider.Thumb` (`Escolhas.tsx` L94). |
| **UI-51** | **P2** | visual | `#/projeto/:id/cortes` (`Selecao.tsx` L436–485; `ConfiguradorSelecao.tsx` L775–1132) | Em `1366×768`, abrir C.1: os blocos `1`–`3` empurram `4. Contexto, Custo e Disparo` para o limite inferior da área rolável, cortando linhas de `<ResumoCustoPrivacidade>` ao meio (`05`), cortando `"Ver detalhe técnico"` (`16`) e mantendo o botão primário `"Selecionar Cortes"` inteiramente **abaixo da dobra** sem rolar. | [01-selecao-config-1366.png](./capturas/onda-3-reav/01-selecao-config-1366.png), [05-selecao-hc-1366.png](./capturas/onda-3-reav/05-selecao-hc-1366.png), [16-erro-selecao-contexto-1366.png](./capturas/onda-3-reav/16-erro-selecao-contexto-1366.png) | Reduzir espaçamento vertical entre os blocos `1`–`3` em `< 1440 px` ou fixar o bloco de disparo (`Selecionar Cortes` + resumo compacto) no rodapé da coluna esquerda para mantê-lo visível acima da dobra em `1366×768`. |
| **UI-52** | **P2** | texto | `#/projeto/:id/cortes` (`ConfiguradorSelecao.tsx` L542–558, L1043–1045) | Abrir `/?selection-blocked=1#/projeto/demo/cortes` (sem `?assistant-test=1`): `provider.selection_state` retorna `{ applicable: false }` e `selection.estimate` falha com `context_too_small`. O cabeçalho da seção `4` exibe **`Contexto gerenciado pelo CLI`** imediatamente acima do banner **`A Janela de contexto deste Perfil de Provedor é pequena para o tamanho de Corte escolhido.`**. O mesmo selo aparece transitoriamente ao trocar para `offline.mp4` antes da resposta de `selection.estimate`. | [16-erro-selecao-contexto-1366.png](./capturas/onda-3-reav/16-erro-selecao-contexto-1366.png), [04-selecao-fonte-offline-1440.png](./capturas/onda-3-reav/04-selecao-fonte-offline-1440.png) | Exibir `<Status tom="info">Contexto gerenciado pelo CLI</Status>` apenas quando `destino?.localidade === 'cli'` (e exibir `Janela de contexto: Bloqueada` quando `erroAtivo?.code` for `context_too_small` ou `max_cut_too_long`). |
| **UI-53** | **P2** | visual | `#/projeto/:id/cortes/revisao/:runId` (`ListaCandidatos.tsx` L219–221; `Revisao.tsx` L313–316) | Na Bancada, mover o slider `Nota mínima` para `10,0`: 1) a coluna direita continua exibindo o candidato `"A virada do jogo"` e aceitando `A`/`R` mesmo com `0 de 3 Cortes` na lista; 2) `"Limpar filtros"` via `acaoSecundaria` (`fantasma`) renderiza sem fundo `bg-elevado`, parecendo texto comum. | [18-vazio-revisao-filtro-zerado-1366.png](./capturas/onda-3-reav/18-vazio-revisao-filtro-zerado-1366.png) | Quando `candidatosFiltrados.length === 0`, exibir estado vazio/informativo no detalhe (ou bloquear `A`/`R`) e aplicar variante `secundario` (`bg-elevado`) em `"Limpar filtros"`. |
| **UI-54** | **P2** | visual | `#/projeto/:id/cortes/revisao/:runId` (`Revisao.tsx` L925–932) | No sub-cabeçalho da Bancada, o nome da Fonte usa `max-w-24` (`96 px`) fixo, truncando `Live_12_11_final.mp4` para `Live_12_11_final...` inclusive em `1440×900` onde há espaço livre, e sem separadores discretos entre título, Fonte, selo e contadores. | [10-revisao-bancada-1366.png](./capturas/onda-3-reav/10-revisao-bancada-1366.png), [13-revisao-transformado-1440.png](./capturas/onda-3-reav/13-revisao-transformado-1440.png) | Trocar `max-w-24` por `min-w-0 max-w-44 min-[1440px]:max-w-64` com `·` discretos (`text-t3`) entre metadados. |
| **UI-55** | **P2** | texto | `AcompanhamentoSelecao.tsx` L684; `Revisao.tsx` L946; `DetalheCandidato.tsx` L218–222; `design-system-v2/src/componentes/Selos.tsx` L64 | 1) Pluralização: `"1 candidatos · 1 juntados"` (`04`) e `"1 aprovados"` (`10`). 2) `DetalheCandidato` exibe o ID cru `"forte"` em `"Gerado por forte"` (`10`–`13`; idem `Perfil: forte` na `Janela 1` em `01`) e compara `=== 'legacy'` com sensibilidade a caixa. 3) `<EixosNota>` exibe peso com ponto decimal inglês (`×1.5` em `12`, `13`). | [01-selecao-config-1366.png](./capturas/onda-3-reav/01-selecao-config-1366.png), [04-selecao-fonte-offline-1440.png](./capturas/onda-3-reav/04-selecao-fonte-offline-1440.png), [10-revisao-bancada-1366.png](./capturas/onda-3-reav/10-revisao-bancada-1366.png), [12-revisao-eixos-bordas-aprovado-1366.png](./capturas/onda-3-reav/12-revisao-eixos-bordas-aprovado-1366.png) | Pluralizar contagens (`1 candidato · 1 juntado`, `1 aprovado`); resolver o `label` do perfil em `DetalheCandidato` via `provider.profiles.list` (e usar `.toLowerCase() === 'legacy'`); formatar `e.peso.toLocaleString('pt-BR')` em `Selos.tsx` L64. |
| **UI-56** | **P3** | visual / interação | `design-system-v2/src/componentes/Midia.tsx` L46; `Revisao.tsx` L905, L958, L978, L1064, L1083; `DetalheCandidato.tsx` L835–847, L872; `Selecao.tsx` L482 | 1) Em [14-revisao-hc-1366.png](./capturas/onda-3-reav/14-revisao-hc-1366.png), o quadro 9:16 do `PlayerProxy` renderiza preto puro antes do `onError` disparar e sem borda de contraste em `[data-contrast="high"]`. 2) Em [20-erro-revisao-proxy-offline-1366.png](./capturas/onda-3-reav/20-erro-revisao-proxy-offline-1366.png), `<Transporte>` permanece clicável sem preview. 3) Botões `aria-disabled="true"` em `Revisao.tsx` L958/L978 e `DetalheCandidato.tsx` L872 usam `pointer-events-auto!` sem `cursor-not-allowed hover:bg-elevado`, mantendo cursor de clique e hover ativo; e regiões de `Revisao.tsx` não têm `tabIndex={-1}` de fallback para `F6` quando não há candidato. 4) `Selecao.tsx` L482 mantém `"Ver Transcrição →"` com seta literal em vez de `<ArrowRight />` (padrão de **UI-42**). | [14-revisao-hc-1366.png](./capturas/onda-3-reav/14-revisao-hc-1366.png), [20-erro-revisao-proxy-offline-1366.png](./capturas/onda-3-reav/20-erro-revisao-proxy-offline-1366.png), [01-selecao-config-1366.png](./capturas/onda-3-reav/01-selecao-config-1366.png) | Adicionar contorno em `[data-contrast="high"]` no `PlayerProxy`, desabilitar `<Transporte>` quando `!fonteDisponivel \|\| proxyState.status !== 'ready'`, replicar `cursor-not-allowed hover:bg-elevado` de `AcompanhamentoSelecao.tsx` L644 nos botões `aria-disabled`, incluir `tabIndex={-1}` nas regiões de `F6` de `Revisao.tsx` e padronizar `Ver Transcrição` com `<ArrowRight />`. |

---

## 5. Inventário das capturas PNG (`docs/produto/front-v2/ui/capturas/onda-3-reav/`)

Total: **21 arquivos** gerados por `front-v2/e2e/ui-onda3.spec.ts` (`$env:UI_BASELINE = "1"`).

| Arquivo | Tela / Estado | Viewport / Tema | Sustenta |
|---|---|---|---|
| `01-selecao-config-1366.png` | `#/projeto/demo/cortes` (pré-preenchido `Corte direto`, `20–60 s`, `Perfil base: Principal`) | `1366×768` · padrão | Fluxo (i), UI-35, UI-51, UI-55 |
| `02-selecao-transformado-sinais-1366.png` | `Vídeo transformado` (`Espaço para comentário (30%)`), `30–90 s` (`> 60 s`), Energia + Chat | `1366×768` · padrão | Fluxo (i), UI-51 |
| `03-selecao-custo-dialog-1366.png` | `<ConfirmDialog focoInicial="cancelar">` + `<ResumoCustoPrivacidade>` antes de `selection.start` | `1366×768` · padrão | Fluxo (i) aviso de custo |
| `04-selecao-fonte-offline-1440.png` | Troca para `offline.mp4` (`Fonte offline no disco`, `Execução #3`, sem flash de `semPerfilConfigurado`) | `1440×900` · padrão | Fluxo (i), UI-30, UI-52, UI-55 |
| `05-selecao-hc-1366.png` | `#/projeto/demo/cortes` em alto contraste | `1366×768` · `[data-contrast="high"]` | Fluxo (i) WCAG AA, UI-50, UI-51 |
| `06-acompanhamento-progresso-1366.png` | Execução `#4` `Em andamento` (`Enviando ao Provedor…`, `Cancelar seleção`) | `1366×768` · padrão | Fluxo (j) progresso |
| `07-acompanhamento-uncertain-1366.png` | `?run=1&estado=parcial` (banner `Chamada paga incerta` + `Retomar` `aria-disabled` com `<Dica>`) | `1366×768` · padrão | Fluxo (j), UI-32 |
| `08-acompanhamento-resolver-incerteza-1366.png` | `<DialogoResolverIncerteza>` (`Cobrança possível` com `bg-area` e `border-linha`) | `1366×768` · padrão | Fluxo (j), UI-34a |
| `09-acompanhamento-redo-perfil-1440.png` | `<SeletorPerfilRedo>` sem `#304` + `Janela 3` `Cancelada` em `text-t3` | `1440×900` · padrão | Fluxo (j), UI-35 |
| `10-revisao-bancada-1366.png` | `#/projeto/demo/cortes/revisao/1` (sub-cabeçalho em 1 linha, `<Transporte>` + `<Slider>` limpos, placeholder `Prévia indisponível`, sem banner redo) | `1366×768` · padrão | Fluxo (k), UI-31, UI-33, UI-34c, UI-54, UI-55 |
| `11-revisao-proxy-progresso-1366.png` | Proxy 9:16 `Gerando preview 9:16` (`40%`) + `Cancelar preview` mantendo ações habilitadas | `1366×768` · padrão | Fluxo (k), UI-31b |
| `12-revisao-eixos-bordas-aprovado-1366.png` | Eixos expandidos, `±1 Frase` (`I`/`O`), `Aprovado` + `Abrir no editor` acima da dobra | `1366×768` · padrão | Fluxo (k), UI-33c, UI-55 |
| `13-revisao-transformado-1440.png` | `?cenario-transformed=1`: `Espaço para comentário (30%)` em 1º + próximo passo Transformar | `1440×900` · padrão | Fluxo (k), UI-54, UI-55 |
| `14-revisao-hc-1366.png` | `#/projeto/demo/cortes/revisao/1` em alto contraste | `1366×768` · `[data-contrast="high"]` | Fluxo (k) WCAG AA, UI-56 |
| `15-erro-selecao-local-only-1366.png` | `#/projeto/:id/cortes?estado=erro` (`local_only_violation` com CTAs de recuperação) | `1366×768` · padrão | Fluxo (l) erro C.1 |
| `16-erro-selecao-contexto-1366.png` | `/?selection-blocked=1` exibindo `<BannerErroCore>` (`context_too_small` + `Reduzir duração máxima`) | `1366×768` · padrão | Fluxo (l), UI-30, UI-51, UI-52 |
| `17-vazio-selecao-sem-fontes-1366.png` | `#/projeto/demo/cortes?estado=vazio` (`Nenhuma Fonte transcrita ainda`) | `1366×768` · padrão | Fluxo (l) vazio C.1 |
| `18-vazio-revisao-filtro-zerado-1366.png` | Filtro `Nota mínima 10,0` zerando a lista (`Limpar filtros` secundário, único `bg-sinal` em `Aprovar`) | `1366×768` · padrão | Fluxo (l), UI-34b, UI-50, UI-53 |
| `19-vazio-revisao-sem-candidatos-1366.png` | `#/projeto/demo/cortes/revisao/1?estado=vazio` (`Nenhum candidato gerado nesta execução`) | `1366×768` · padrão | Fluxo (l) vazio C.2 |
| `20-erro-revisao-proxy-offline-1366.png` | Bancada sobre `offline.mp4`: fallback acionável + `Gerado por Perfil configurado` | `1366×768` · padrão | Fluxo (l), UI-35, UI-56 |
| `21-erro-revisao-fatal-1366.png` | `#/projeto/demo/cortes/revisao/1?estado=erro` (`local_only_violation`) | `1366×768` · padrão | Fluxo (l) erro C.2 |
