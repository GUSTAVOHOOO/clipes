# Avaliação Independente de UI — Onda 3: Seleção e Bancada de Revisão (`front-v2`)

> ⚠️ **DEGRADED: single-context (subagentes desabilitados pela regra da tarefa; avaliação conduzida em contexto único combinando inspeção visual das 21 capturas renderizadas, auditoria automatizada de DOM/WCAG e análise de código).**
>
> **Data da avaliação:** 2026-11-18  
> **Commit avaliado (`origin/master`):** `071649b` (`fix(front-v2): corrige Detalhe da Fonte, PainelMotorSinais e tokens DS (UI-23, UI-24, UI-26, UI-27a/b, UI-28) (#430)`)  
> **Escopo:** Onda 3 — Macro-etapa 2 **Cortes: Seleção e Revisão** (`#348`–`#351`, plano [07-plano-onda-3.md](../07-plano-onda-3.md), spec [C-cortes-selecao-revisao.md](../telas/C-cortes-selecao-revisao.md)): Fluxo **(i)** Configurador de Seleção (`#/projeto/:id/cortes`, coluna esquerda), Fluxo **(j)** Acompanhamento de Seleção (`#/projeto/:id/cortes`, coluna direita), Fluxo **(k)** Bancada de Revisão (`#/projeto/:id/cortes/revisao/:runId`) e Fluxo **(l)** Estados de erro e vazios dessas telas. Papel exclusivamente avaliador — nenhuma tela foi alterada neste PR.

---

## 1. Cenário fixo e reproduzível

O cenário foi executado sobre o mock TypeScript (`VITE_CORE_MOCK=1`, sem Tauri) pelo script dedicado `front-v2/e2e/ui-onda3.spec.ts` (ignorado no CI padrão quando `UI_BASELINE` não está definido).

### Pré-requisitos e comandos

```powershell
# 1. Instalar dependências
cd front-v2
bun install

# 2. Verificações padrão (typecheck, testes unitários e suíte E2E sem UI_BASELINE)
bun run typecheck
bun run test -- --maxWorkers=2
bunx playwright test

# 3. Executar o cenário completo da Onda 3 (gera as 21 PNGs e ui-onda3-audit.json)
$env:UI_BASELINE = "1"
bunx playwright test e2e/ui-onda3.spec.ts
Remove-Item Env:UI_BASELINE

# 4. Verificações estáticas e de contraste
cd ..
bunx impeccable detect --json front-v2/src
cd design-system-v2
bun scripts/contraste.ts
```

### Parâmetros do cenário

- **Viewports:** `1366×768` (notebook alvo) e `1440×900`.
- **Temas e contraste:** tema escuro padrão (`:root` / `[data-tema="escuro"]`) e modo alto contraste (`[data-contrast="high"]` via `#/config/aparencia`) aplicado nas telas principais de Seleção (`05`) e Bancada de Revisão (`14`).
- **Cobertura funcional:**
  - **(i) Configurador de Seleção:** seleção de Fonte (`Live_12_11_final.mp4` vs. `offline.mp4`), alternância por teclado (`ArrowRight`) entre `Corte direto` e `Vídeo transformado` com pesos dinâmicos da Nota, faixa de duração (`30–90 s` com aviso `> 60 s`), validação inline (`min >= max`) e `Restaurar padrão do canal`, sinais locais (`energy.start` e `chat.fetch` via `core-progress`), `<ResumoCustoPrivacidade>` e `<ConfirmDialog focoInicial="cancelar">` antes de `selection.start`.
  - **(j) Acompanhamento de Seleção:** estado em execução (`Progresso` + `Cancelar seleção` com `<ConfirmDialog>`), `?estado=parcial` com janela `uncertain` (`Retomar janelas pendentes` desabilitado com `<Dica>` sem vazar ticket + `<DialogoResolverIncerteza>`), troca de revisões (`Rev. 1` / `Rev. 2` atualizando `?rev=`) e `<SeletorPerfilRedo>`.
  - **(k) Bancada de Revisão:** `role="listbox"` (`tabIndex={0}`, `aria-activedescendant`, `↑`/`↓`), filtros por estado, Slider `Nota mínima` e ordenação (`Maior Nota` / `Ordem na Fonte`), proxy `running` (`Cancelar preview` mantendo ações habilitadas), expansão de `<EixosNota>` (`Corte direto` e `?cenario-transformed=1` com **Espaço para comentário (30%)** em 1º), `±1 Frase` (`I`/`O`), `<ChecklistGuardaCorpos>`, `A`/`R`/`Ctrl+Z`, transporte (`Espaço`/`J`/`K`/`L`/`←`/`→`), respeito a campos de texto (`Paleta` `Ctrl+K`) e modo WCAG 2.1.4 (`Exigir modificador Alt + tecla`).
  - **(l) Estados de erro e vazios:** `?estado=erro` (`local_only_violation` em C.1 e C.2), `?selection-blocked=1` (`context_too_small` sem `?assistant-test=1`), `?estado=vazio` (sem Fontes transcritas em C.1 e 0 candidatos em C.2), filtro zerado na Bancada, execução sobre Fonte offline (`offline.mp4` mostrando fallback acionável de proxy offline) e inspeção de `guardrails` com erro (coberto por código e suíte unitária `DetalheCandidato.test.tsx`).

### Saídas automatizadas observadas

- `cd front-v2 && bun install`: `152 packages installed` (exit `0`).
- `cd front-v2 && bun run typecheck`: `tsc --noEmit` limpo (exit `0`).
- `cd front-v2 && bun run test -- --maxWorkers=2`: `46 passed (46)` arquivos, `394 passed (394)` testes unitários/componentes.
- `cd front-v2 && bunx playwright test` (CI padrão, sem `UI_BASELINE`): `28 passed`, `3 skipped` (`e2e/ui-baseline.spec.ts`, `e2e/ui-onda2.spec.ts` e `e2e/ui-onda3.spec.ts`).
- `cd front-v2 && $env:UI_BASELINE = "1"; bunx playwright test e2e/ui-onda3.spec.ts`: `1 passed` (`26,4 s`), `0` `pageerror`, `0` ocorrências de overflow externo (`1366×768` e `1440×900`) e `0` overflow em tabelas internas nos 20 estados auditados.
- `bunx impeccable detect --json front-v2/src`: `[]` (exit `0`, zero achados no detector mecânico).
- `cd design-system-v2 && bun scripts/contraste.ts`: `Todos os pares passam.` (escuro, claro, escuro `[data-contrast="high"]` e claro `[data-contrast="high"]`).

### Síntese das verificações transversais (DOM + Teclado + Glossário)

| Aspecto | Resultado observado | Evidência / Observação |
|---|---|---|
| **Teclado (`Tab`, `Esc`, `F6`, `Ctrl+K`, `Ctrl+Z`, `A/R/I/O`, `Espaço/J/K/L`, setas)** | **Parcial** *(achados **UI-32**, **UI-36**)* | `↑`/`↓` na listbox (`role="listbox"`, `tabIndex={0}`, `aria-activedescendant`) e `ArrowRight` no `radiogroup` funcionam; `Ctrl+Z` desfaz aprovação e ajuste em sequência; campos de texto (`Paleta` `Ctrl+K`) bloqueiam teclas únicas; modo `Alt + tecla` bloqueia `r` simples (`statusAposRComAltMode: "false"`). Porém `<Kbd>` na Bancada não atualiza para `Alt+tecla` (**UI-32**), `<span tabIndex={0}>` envolve botões desabilitados (**UI-32**) e `F6` em C.1 cicla só as 3 regiões globais (**UI-36**). |
| **Foco visível** | **Aprovado** | Anel `2px` (`rgb(255, 90, 31)` / `rgb(144, 135, 140)`) e borda `1px` em `[data-contrast="high"]` confirmados nos 20 estados auditados. |
| **Contraste WCAG 2.2 AA** | **Aprovado** | `0` textos abaixo de `4,5:1` (`3:1` texto grande) nos 20 estados, inclusive em `[data-contrast="high"]` (`05`, `14`). `contraste.ts` aprova todos os pares de tokens. |
| **Alvos ≥ 24 px (WCAG 2.5.8)** | **Aprovado no DOM; prejuízo visual em `<Slider>`** *(achado **UI-33b**)* | `0` elementos reportados abaixo de `24 px` no DOM (`Slider` usa `Control` de `h-6`), porém o trilho do `<Slider>` `Nota mínima` fica esmagado horizontalmente (~`14–20 px`) ao lado do `<Select>` (**UI-33b**). |
| **Headings (`h1–h6`)** | **Aprovado** | `h1Count = 1` e `saltoHeading = null` em todos os 20 estados auditados (`h1 → h2 → h3` em C.1 e `h1 → h2` em C.2). |
| **Textos PT-BR e `GLOSSARY.md`** | **Aprovado** para termos proibidos; **Reprovado** em refs/textos internos *(achado **UI-35**)* | `0` violações do glossário (`clipe`, `short`, `input`, `voice-over`, `locução`, `workspace`, `preset`, `segmento`, `sentença`, `highlight`, `rodada`). Porém `<SeletorPerfilRedo>` expõe `#304` visivelmente (`09`), `Execução #1`/`Janelas`/`DetalheCandidato` exibem `legacy` e Janela cancelada exibe `"Algo deu errado nesta operação."` (**UI-35**). |
| **Regra da Luz Única** | **Parcial** *(achado **UI-34b**)* | C.1 normal (`01`) e C.2 normal (`10`, `12`, `13`, `14`) mantêm `1` botão `bg-sinal` (`Aprovar` → `Abrir no editor`). Porém quando o filtro zera a lista em C.2, `Limpar filtros` e `Aprovar` ficam ambos em `bg-sinal` (`botoesPrimariosSinal = 2`, `18-vazio-revisao-filtro-zerado-1366.png`, **UI-34b**). |
| **Estados de erro, proxy e aviso de custo** | **Reprovado em caminhos críticos** *(achados **UI-30**, **UI-31**, **UI-34a/c**)* | `<ResumoCustoPrivacidade>` e `<ConfirmDialog>` funcionam antes de `selection.start` e `selection.redo`, e Fonte offline na Bancada tem fallback acionável (`20`). Porém `context_too_small` é engolido por `semPerfilConfigurado` no modo legado (**UI-30**), banner de redo vaza entre runs e `proxy` reaproveita `job: 7` (**UI-31**), e `DialogoResolverIncerteza` renderiza bordas brancas via tokens v1 inexistentes (**UI-34a**). |

---

## 2. Tabela de pontuação por fluxo (Critique — Nielsen 0–4)

Meta do mandato: **≥ 90%** da pontuação aplicável (**`36 / 40`**), WCAG 2.2 AA e zero bloqueador funcional.  
Legenda: **H1** Visibilidade de estado · **H2** Mundo real / vocabulário · **H3** Controle e liberdade · **H4** Consistência e padrões · **H5** Prevenção de erros · **H6** Reconhecimento vs. lembrança · **H7** Flexibilidade e atalhos · **H8** Estética e minimalismo · **H9** Recuperação de erros · **H10** Ajuda e documentação.

| Fluxo / Superfície | H1 | H2 | H3 | H4 | H5 | H6 | H7 | H8 | H9 | H10 | Pontuação | % Aplicável | Meta ≥ 90% |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| **Fluxo (i) · Configurador de Seleção (`#/projeto/:id/cortes` esq.)** | 3 | 4 | 4 | 4 | 3 | 4 | 3 | 4 | 2 | 4 | **35 / 40** | **87,5%** | **Abaixo** |
| **Fluxo (j) · Acompanhamento de Seleção (`#/projeto/:id/cortes` dir.)** | 3 | 2 | 4 | 3 | 4 | 4 | 3 | 3 | 3 | 4 | **33 / 40** | **82,5%** | **Abaixo** |
| **Fluxo (k) · Bancada de Revisão (`#/projeto/:id/cortes/revisao/:runId`)** | 2 | 3 | 4 | 2 | 4 | 4 | 3 | 2 | 4 | 4 | **32 / 40** | **80,0%** | **Abaixo** |
| **Fluxo (l) · Estados de erro e vazios (C.1 e C.2)** | 4 | 4 | 4 | 3 | 3 | 4 | 4 | 4 | 2 | 4 | **36 / 40** | **90,0%** | **Atinge** |

### Justificativa por fluxo e heurística abaixo de 4

- **Fluxo (i) · Configurador de Seleção (`35/40` — 87,5%, Abaixo):**
  - **H1 (`3`):** Mostra compatibilidade de contexto, pesos da Nota e progresso de energia/chat, mas ao trocar para `offline.mp4` ocorre flash transitório de `"Configure um Perfil de Provedor para selecionar Cortes"` antes de `selection.estimate` resolver ([04-selecao-fonte-offline-1440.png](./capturas/onda-3/04-selecao-fonte-offline-1440.png), **UI-30**).
  - **H5 (`3`):** Validação inline de duração e `<ConfirmDialog>` de custo funcionam bem, mas quando `selection.estimate` falha sem perfil explícito em `assistant.tasks`, **UI-30** mascara o bloqueio `context_too_small` ([16-erro-selecao-contexto-1366.png](./capturas/onda-3/16-erro-selecao-contexto-1366.png)).
  - **H7 (`3`):** Em `1366×768`, o botão primário `Selecionar Cortes` e o `<ResumoCustoPrivacidade>` ficam abaixo da dobra da coluna esquerda ([01-selecao-config-1366.png](./capturas/onda-3/01-selecao-config-1366.png)); `F6` não separa Configurador de Acompanhamento (**UI-36**).
  - **H9 (`2`):** `semPerfilConfigurado` engole `erroEstimativa` quando `assistant.tasks` retorna `profile: null` (modo endpoint legado), ocultando o `<BannerErroCore>` de `context_too_small` e o botão de recuperação `"Reduzir duração máxima"` (**UI-30**).

- **Fluxo (j) · Acompanhamento de Seleção (`33/40` — 82,5%, Abaixo):**
  - **H1 (`3`):** Progresso por Janela e sub-estágio é claro ([06-acompanhamento-progresso-1366.png](./capturas/onda-3/06-acompanhamento-progresso-1366.png)), porém exibe identificadores crus `Perfil base: legacy` e `Perfil: legacy` (**UI-35**).
  - **H2 (`2`):** `<SeletorPerfilRedo>` exibe **`(nota #304)`** diretamente no diálogo e no `<Dica>` ([09-acompanhamento-redo-perfil-1440.png](./capturas/onda-3/09-acompanhamento-redo-perfil-1440.png)); além disso, janela cancelada após `jobs.discard` mostra `"Algo deu errado nesta operação."` por falta de mapeamento de `'cancelled'` em `TABELA_ERROS` (**UI-35**).
  - **H4 (`3`):** `DialogoResolverIncerteza` e `SeletorPerfilRedo` usam variáveis CSS inexistentes da v1 (`--borda`, `--raio-m`, `--texto-m`, `--texto-fraco`), produzindo bordas brancas cruas e cantos quadrados no alerta de cobrança ([08-acompanhamento-resolver-incerteza-1366.png](./capturas/onda-3/08-acompanhamento-resolver-incerteza-1366.png), **UI-34a**); `<span tabIndex={0}>` envolve botão desabilitado (**UI-32b**).
  - **H7 (`3`):** `tablist` de revisões e ações por Janela são acessíveis, mas `F6` não alterna diretamente para o painel de acompanhamento (**UI-36**).
  - **H8 (`3`):** A caixa com borda branca de `1 px` e o divisor branco em `DialogoResolverIncerteza` quebram a *Regra do Degrau* ([08-acompanhamento-resolver-incerteza-1366.png](./capturas/onda-3/08-acompanhamento-resolver-incerteza-1366.png), **UI-34a**).
  - **H9 (`3`):** A resolução de incerteza funciona bem (`Repetir chamada` / `Descartar chamada`), mas a janela descartada cai no texto genérico `"Algo deu errado nesta operação."` em vermelho (**UI-35**).

- **Fluxo (k) · Bancada de Revisão (`32/40` — 80,0%, Abaixo):**
  - **H1 (`2`):** Banner `"Gerando nova revisão da execução em segundo plano…"` vaza de outra execução em `useFila()` ([10-revisao-bancada-1366.png](./capturas/onda-3/10-revisao-bancada-1366.png), **UI-31a**); `proxy.status` força `'ready'` para qualquer estado não-`failed` enquanto o mock reutiliza `job: 7` (**UI-31b**); e `PlayerProxy` exibe ícone de imagem quebrada quando `mediaUrl("proxy/...")` falha (**UI-34c**).
  - **H2 (`3`):** Vocabulário do domínio e revelação progressiva de **Espaço para comentário (30%)** exemplares ([13-revisao-transformado-1440.png](./capturas/onda-3/13-revisao-transformado-1440.png)), porém exibe `Gerado por legacy` em execuções V1 (**UI-35**).
  - **H4 (`2`):** `<Kbd>` dos botões `A`/`R`/`I`/`O` não acompanha o modo WCAG 2.1.4 (`Alt + tecla`/`Desligadas`) e `Transporte` `I`/`O` ignoram `moves.*` (**UI-32**); além disso, `<Transporte>` e `<Slider>` quebram visualmente em `1366×768` e `1440×900` (**UI-33**).
  - **H7 (`3`):** Atalhos e listbox `aria-activedescendant` são sólidos, mas a quebra do sub-cabeçalho em 2 linhas empurra os botões `Aprovar`/`Rejeitar`/`Abrir no editor` para fora da dobra em `1366×768` ([10-revisao-bancada-1366.png](./capturas/onda-3/10-revisao-bancada-1366.png), [12-revisao-eixos-bordas-aprovado-1366.png](./capturas/onda-3/12-revisao-eixos-bordas-aprovado-1366.png), **UI-33c**).
  - **H8 (`2`):** No bloco `<Transporte>` (`204–250 px`), o timecode `00:00,0 / 00:50,0` quebra em 3 linhas vazando da barra de `36 px` e os botões `O` e áudio saem do fundo `bg-area`; o `<Slider>` `Nota mínima` fica reduzido a ~`14–20 px` ao lado do `<Select>` (**UI-33a/b**); e o quadro 9:16 exibe ícone de imagem quebrada (**UI-34c**).

- **Fluxo (l) · Estados de erro e vazios (`36/40` — 90,0%, Atinge):**
  - **H4 (`3`):** Quando o filtro zera a lista na Bancada, `Limpar filtros` (`bg-sinal`) coexiste com `Aprovar` (`bg-sinal`), resultando em 2 botões primários simultâneos ([18-vazio-revisao-filtro-zerado-1366.png](./capturas/onda-3/18-vazio-revisao-filtro-zerado-1366.png), **UI-34b**).
  - **H5 (`3`):** Estados vazios bloqueiam ações inválidas, mas **UI-30** impede o alerta preventivo de `context_too_small` no modo endpoint legado.
  - **H9 (`2`):** `local_only_violation` ([15-erro-selecao-local-only-1366.png](./capturas/onda-3/15-erro-selecao-local-only-1366.png)) e proxy offline ([20-erro-revisao-proxy-offline-1366.png](./capturas/onda-3/20-erro-revisao-proxy-offline-1366.png)) oferecem ótima recuperação, mas `context_too_small` desaparece sob `semPerfilConfigurado` no fluxo padrão sem `?assistant-test=1` ([16-erro-selecao-contexto-1366.png](./capturas/onda-3/16-erro-selecao-contexto-1366.png), **UI-30**).

### Auditoria Técnica (Impeccable Audit — `/20`)

| Dimensão | Pontuação | Achado principal |
|---|---|---|
| 1. Accessibility | **2 / 4** | Contraste AA/AAA (`contraste.ts` + 20 auditorias DOM), `<h1>` único sem saltos, foco visível e `role="listbox"` com `aria-activedescendant` 100% aprovados; cai por `<Kbd>` desalinhado de WCAG 2.1.4 e `<span tabIndex={0}>` sem `role`/nome acessível (**UI-32**), e `F6` em C.1 (**UI-36**). |
| 2. Performance | **4 / 4** | `<ListaVirtual>` virtualizada, `Promise.all` paralelo e atualização reativa via `useFila()` sem `setInterval`. |
| 3. Theming | **3 / 4** | `[data-contrast="high"]` sólido em C.1 e C.2 (`05`, `14`), porém `DialogoResolverIncerteza` e `SeletorPerfilRedo` usam tokens v1 inexistentes (`--borda`, `--raio-m`, `--texto-m`, `--texto-fraco`) gerando bordas brancas cruas (**UI-34a**). |
| 4. Responsive Design | **2 / 4** | `0` overflow externo e grade 1→2 colunas em C.1; cai porque `<Transporte>` estoura na largura `204–250 px` (quebrando o timecode em 3 linhas), `<Slider>` `Nota mínima` fica esmagado e o sub-cabeçalho da Bancada quebra em 2 linhas em `1366×768` e `1440×900` (**UI-33**). |
| 5. Implementation Integrity | **2 / 4** | `impeccable detect` limpo (`[]`) e glossário respeitado; cai pelos 2 bloqueadores funcionais P1 (**UI-30**, **UI-31**), quebra da *Regra da Luz Única* no filtro vazio (**UI-34b**), `<img>` quebrada no preview mock (**UI-34c**) e vazamento de `#304`/`legacy`/`cancelled` (**UI-35**). |
| **Total** | **13 / 20** | **Acceptable** *(requer correção dos 4 achados P1 **UI-30**–**UI-33** e dos achados P2 **UI-34**–**UI-35** antes da aprovação final)*. |

---

## 3. Achados da Onda 3 (`UI-30` em diante)

Categorias: **bloqueador funcional** · **A11y AA** · **visual** · **texto**.

| ID | Sev. | Categoria | Tela / Arquivo | Passo para reproduzir | Captura | Sugestão de correção |
|---|---|---|---|---|---|---|
| **UI-30** | **P1** | bloqueador funcional | `#/projeto/:id/cortes` (`front-v2/src/telas/cortes/ConfiguradorSelecao.tsx` L515–528, L672, L1057–1107) | 1) Abrir `/?selection-blocked=1#/projeto/demo/cortes` (sem `?assistant-test=1`, onde `assistant.tasks` retorna `profile: null` para endpoint legado): `selection.estimate` falha com `context_too_small`, `estimativa` permanece `null` e `semPerfilConfigurado` avalia `true`, **engolindo o `<BannerErroCore>`** e exibindo `"Configure um Perfil de Provedor para selecionar Cortes"` sem o botão `"Reduzir duração máxima"`. 2) Ao trocar para outra Fonte (`offline.mp4`), o mesmo estado pisca enquanto `selection.estimate` carrega. | [16-erro-selecao-contexto-1366.png](./capturas/onda-3/16-erro-selecao-contexto-1366.png), [04-selecao-fonte-offline-1440.png](./capturas/onda-3/04-selecao-fonte-offline-1440.png) | Excluir casos com `erroEstimativa`/`erroDisparo` de código diferente de `profile_unavailable`/`invalid_settings` (e enquanto `selection.estimate` estiver pendente) da condição `semPerfilConfigurado` na L524, permitindo que `renderBannerErro(erroAtivo)` exiba `context_too_small` com `"Reduzir duração máxima"`. |
| **UI-31** | **P1** | bloqueador funcional | `#/projeto/:id/cortes/revisao/:runId` (`front-v2/src/telas/cortes/Revisao.tsx` L338–353; `DetalheCandidato.tsx` L398–437; `front-v2/src/core/progresso.ts` L54, L86–91; `src/lib/core.ts` L2955) | 1) Iniciar uma seleção em C.1 (`Run #2`), cancelá-la e navegar para `#/projeto/demo/cortes/revisao/1` (`Run #1`): `Revisao.tsx` L343 casa qualquer job `ai:selection*` com `estado === 'rodando'` na Fila global sem filtrar por `runId`, mantendo o banner `"Gerando nova revisão da execução em segundo plano…"` preso na Execução `#1`. 2) Após concluir o 1º proxy (`jobId = 7`), navegar para o 2º candidato faz `DetalheCandidato` ler `jobProxyAtivo.estado === 'concluido'` antigo (L414) e `proxy.status` converter qualquer estado `!== 'failed'` em `'ready'` (L421), pulando o progresso. | [10-revisao-bancada-1366.png](./capturas/onda-3/10-revisao-bancada-1366.png), [11-revisao-proxy-progresso-1366.png](./capturas/onda-3/11-revisao-proxy-progresso-1366.png), [12-revisao-eixos-bordas-aprovado-1366.png](./capturas/onda-3/12-revisao-eixos-bordas-aprovado-1366.png) | Em `Revisao.tsx` L338–346, restringir `jobSelecaoAtivo` a `j.id === 'selection-' + runId` ou aos `janelas.map(w => String(w.jobId))` da execução ativa (e finalizar os jobs de janela no `selection.cancel` do mock). Em `DetalheCandidato.tsx` L421, mapear `res.state === 'ready'` explicitamente (mantendo `'queued'`/`'running'` quando não concluído) e gerar `jobId` incremental no mock de `proxy.request`. |
| **UI-32** | **P1** | A11y AA | `#/projeto/:id/cortes/revisao/:runId` e `#/projeto/:id/cortes` (`DetalheCandidato.tsx` L783–784, L806, L867, L876, L882, L900, L909, L915, L940, L949; `Revisao.tsx` L939, L962; `AcompanhamentoSelecao.tsx` L627) | 1) Em `#/config/aparencia`, selecionar `"Exigir modificador Alt + tecla"` (WCAG 2.1.4) e abrir a Bancada: o atalho `r` deixa de disparar, mas os `<Kbd>` dos botões `Aprovar`, `Rejeitar`, `I`, `O` e `<Transporte>` continuam exibindo `"A"`, `"R"`, `"I"`, `"O"`, `"Espaço"` fixos. 2) `Transporte` (`aoMarcarEntrada`/`aoMarcarSaida` na L783–784) ignora `moves.*` e liga `O` a `'end', -1` (recuar), divergindo de `MAPA_ATALHOS_OFICIAL`. 3) Wrappers `<span tabIndex={0}>` ao redor de botões desabilitados criam paradas de `Tab` em `<span>` sem `role` nem `aria-label`. | *(verificação automatizada `checksExtras.atalhosRevisao.kbdLabelsAltMode` +* [07-acompanhamento-uncertain-1366.png](./capturas/onda-3/07-acompanhamento-uncertain-1366.png), [10-revisao-bancada-1366.png](./capturas/onda-3/10-revisao-bancada-1366.png) | Resolver os `<Kbd>` de `DetalheCandidato` e `<Transporte>` com `resolverTeclaExibida(tecla, prefs.modoTeclasUnicas, true)` de `~/comandos/atalhos`; respeitar `moves.*` nos botões de `<Transporte>` (ou ocultá-los/desabilitá-los na Bancada); e substituir `<span tabIndex={0}>` por `<Botao aria-disabled="true">` (sem `disabled` nativo + `onClick` no-op) com `Dica` direto no botão acessível. |
| **UI-33** | **P1** | visual | `#/projeto/:id/cortes/revisao/:runId` (`DetalheCandidato.tsx` L660–662 + `design-system-v2/src/componentes/Midia.tsx` L99–126; `ListaCandidatos.tsx` L185–209; `Revisao.tsx` L892–993) | 1) Na coluna do player (`clamp(204px, 28vh, 250px)`), a barra `<Transporte>` é mais larga que o contêiner em `1366×768` e `1440×900`: o relógio `00:00,0 / 00:50,0` quebra em 3 linhas estourando a altura de `36 px` e os botões `O` e `Silenciar` vazam para fora da pílula `bg-area`. 2) Em `ListaCandidatos`, `"Nota mínima"` + `<Slider>` (`flex-1`) na mesma linha do `<Select min-w-[140px]>` esmagam o trilho do slider para ~`14–20 px` e quebram `"Nota mínima"` em 2 linhas. 3) O sub-cabeçalho `Revisao.tsx` L895 quebra em 2 linhas em `1366` e `1440`, empurrando `Aprovar`/`Rejeitar`/`Abrir no editor` abaixo da dobra em `1366×768`. | [10-revisao-bancada-1366.png](./capturas/onda-3/10-revisao-bancada-1366.png), [12-revisao-eixos-bordas-aprovado-1366.png](./capturas/onda-3/12-revisao-eixos-bordas-aprovado-1366.png), [13-revisao-transformado-1440.png](./capturas/onda-3/13-revisao-transformado-1440.png) | Alargar a coluna do player para `>= 280 px` (ou usar `Transporte` compacto na Bancada omitindo os botões redundantes `I`/`O` já presentes em `±1 Frase`); colocar o `<Slider>` `Nota mínima` em linha própria acima/ao lado do `<Select>` em `ListaCandidatos`; e compactar o sub-cabeçalho (`Revisao.tsx`) para caber em 1 linha em `1366×768` deixando `Aprovar`/`Abrir no editor` acima da dobra. |
| **UI-34** | **P2** | visual | `DialogoResolverIncerteza.tsx` L187–198; `SeletorPerfilRedo.tsx` L237, L283; `ListaCandidatos.tsx` L214–220; `Midia.tsx` L42 (`PlayerProxy`) | 1) `DialogoResolverIncerteza` e `SeletorPerfilRedo` aplicam variáveis CSS inexistentes da v1 (`--borda`, `--raio-m`, `--texto-m`, `--texto-p`, `--texto`, `--texto-fraco`), renderizando caixa com borda branca de `1 px` e cantos quadrados no aviso de cobrança (*Regra do Degrau*). 2) Quando o filtro zera a lista em C.2, `Limpar filtros` (`variante="primario"`) e `Aprovar` acendem 2 botões `bg-sinal` simultâneos (*Regra da Luz Única*). 3) `PlayerProxy` exibe ícone de imagem quebrada + alt `"Quadro do Corte"` quando `mediaUrl("proxy/...")` falha no mock/web. | [08-acompanhamento-resolver-incerteza-1366.png](./capturas/onda-3/08-acompanhamento-resolver-incerteza-1366.png), [18-vazio-revisao-filtro-zerado-1366.png](./capturas/onda-3/18-vazio-revisao-filtro-zerado-1366.png), [10-revisao-bancada-1366.png](./capturas/onda-3/10-revisao-bancada-1366.png) | Substituir as variáveis v1 pelos tokens do `@ds` (`bg-elevado`, `rounded-controle`, `text-pequeno`, `text-t1`, `text-t3`, `border-linha`); em `ListaCandidatos.tsx` L219 usar `acaoSecundaria` para `"Limpar filtros"` (ou rebaixar quando houver detalhe selecionado); e adicionar `onError` em `PlayerProxy` (`Midia.tsx` L42) para exibir placeholder visual limpo no quadro preto 9:16. |
| **UI-35** | **P2** | texto | `SeletorPerfilRedo.tsx` L284–289; `AcompanhamentoSelecao.tsx` L660, L758, L795; `DetalheCandidato.tsx` L799; `front-v2/src/core/erros.ts` L98–317 | 1) `<SeletorPerfilRedo>` exibe **`(nota #304)`** no texto visível e `#304` no `<Dica>`. 2) `Execução #1`, `Janelas 2–4` e `DetalheCandidato` exibem o identificador interno cru **`legacy`** (`Perfil base: legacy`, `Gerado por legacy`). 3) Após descartar/cancelar janela (`w.state === 'cancelled'`, `w.code === 'cancelled'`), `AcompanhamentoSelecao` chama `mensagemDeErro` sem chave `'cancelled'` em `TABELA_ERROS`, exibindo **`"Algo deu errado nesta operação."`** em vermelho. | [09-acompanhamento-redo-perfil-1440.png](./capturas/onda-3/09-acompanhamento-redo-perfil-1440.png), [01-selecao-config-1366.png](./capturas/onda-3/01-selecao-config-1366.png), [20-erro-revisao-proxy-offline-1366.png](./capturas/onda-3/20-erro-revisao-proxy-offline-1366.png) | Remover `#304` do texto visível e da `<Dica>` em `SeletorPerfilRedo.tsx`; mapear `profile === 'legacy'` para o rótulo amigável do perfil configurado (ex.: `"Principal"` / `"Perfil configurado"`); e adicionar `cancelled` em `TABELA_ERROS` (ou omitir erro vermelho quando `w.state === 'cancelled'` e `w.code === 'cancelled'`). |
| **UI-36** | **P3** | A11y AA | `#/projeto/:id/cortes` (`Selecao.tsx`) e `#/projeto/:id/cortes/revisao/:runId` (`Revisao.tsx` L515–569) | Em `Selecao.tsx`, `F6` cicla apenas as 3 regiões globais do Shell (`topo → conteudo → rodape`), omitindo a divisão entre Configurador (esquerda) e Acompanhamento (direita) prevista na especificação. | *(verificação automatizada `checksExtras.f6Selecao`)* | Registrar ciclo `F6`/`Shift+F6` em `Selecao.tsx` (seguindo o padrão de `Revisao.tsx` L515–569) entre `topo → Configurador → Acompanhamento → rodape`. |

---

## 4. Inventário das capturas PNG (`docs/produto/front-v2/ui/capturas/onda-3/`)

Total: **21 arquivos** gerados por `front-v2/e2e/ui-onda3.spec.ts` (`$env:UI_BASELINE = "1"`).

| Arquivo | Tela / Estado | Viewport / Tema | Sustenta |
|---|---|---|---|
| `01-selecao-config-1366.png` | `#/projeto/demo/cortes` (pré-preenchido `Corte direto`, `20–60 s`, `Completa 15 min`) | `1366×768` · padrão | Fluxo (i), UI-35 |
| `02-selecao-transformado-sinais-1366.png` | `Vídeo transformado` (`Espaço para comentário 30%`), `30–90 s` (`> 60 s`), Energia + Chat | `1366×768` · padrão | Fluxo (i) sinais e pesos |
| `03-selecao-custo-dialog-1366.png` | `<ConfirmDialog focoInicial="cancelar">` + `<ResumoCustoPrivacidade>` antes de `selection.start` | `1366×768` · padrão | Fluxo (i) aviso de custo |
| `04-selecao-fonte-offline-1440.png` | Troca para `offline.mp4` (`Fonte offline no disco`, 0 execuções, flash de `semPerfilConfigurado`) | `1440×900` · padrão | Fluxo (i), UI-30 |
| `05-selecao-hc-1366.png` | `#/projeto/demo/cortes` em alto contraste | `1366×768` · `[data-contrast="high"]` | Fluxo (i) WCAG AA |
| `06-acompanhamento-progresso-1366.png` | Execução `#2` `Em andamento` (`Enviando ao Provedor…`, `Cancelar seleção`) | `1366×768` · padrão | Fluxo (j) progresso |
| `07-acompanhamento-uncertain-1366.png` | `?run=1&estado=parcial` (banner `Chamada paga incerta` + `Retomar` bloqueado com `<Dica>`) | `1366×768` · padrão | Fluxo (j), UI-32 |
| `08-acompanhamento-resolver-incerteza-1366.png` | `<DialogoResolverIncerteza>` (`Cobrança possível` com borda branca de tokens v1) | `1366×768` · padrão | Fluxo (j), UI-34a |
| `09-acompanhamento-redo-perfil-1440.png` | `<SeletorPerfilRedo>` com `#304` visível + `Janela 3` `Cancelada` com texto de erro genérico | `1440×900` · padrão | Fluxo (j), UI-35 |
| `10-revisao-bancada-1366.png` | `#/projeto/demo/cortes/revisao/1` (`<Transporte>` quebrado, `<Slider>` esmagado, banner redo preso) | `1366×768` · padrão | Fluxo (k), UI-31, UI-33, UI-34c |
| `11-revisao-proxy-progresso-1366.png` | Proxy 9:16 `Gerando preview 9:16` (`40%`) + `Cancelar preview` mantendo ações habilitadas | `1366×768` · padrão | Fluxo (k), UI-31 |
| `12-revisao-eixos-bordas-aprovado-1366.png` | Eixos expandidos, `±1 Frase` (`I`/`O`), `Aprovado` + foco na listbox | `1366×768` · padrão | Fluxo (k), UI-33 |
| `13-revisao-transformado-1440.png` | `?cenario-transformed=1`: `Espaço para comentário (30%)` em 1º + próximo passo Transformar | `1440×900` · padrão | Fluxo (k), UI-33 |
| `14-revisao-hc-1366.png` | `#/projeto/demo/cortes/revisao/1` em alto contraste | `1366×768` · `[data-contrast="high"]` | Fluxo (k) WCAG AA |
| `15-erro-selecao-local-only-1366.png` | `#/projeto/demo/cortes?estado=erro` (`local_only_violation` com CTAs de recuperação) | `1366×768` · padrão | Fluxo (l) erro C.1 |
| `16-erro-selecao-contexto-1366.png` | `/?selection-blocked=1` engolido por `semPerfilConfigurado` no modo endpoint legado | `1366×768` · padrão | Fluxo (l), UI-30 |
| `17-vazio-selecao-sem-fontes-1366.png` | `#/projeto/demo/cortes?estado=vazio` (`Nenhuma Fonte transcrita ainda`) | `1366×768` · padrão | Fluxo (l) vazio C.1 |
| `18-vazio-revisao-filtro-zerado-1366.png` | Filtro `Nota mínima 10,0` zerando a lista (`Limpar filtros` + `Aprovar` ambos `bg-sinal`) | `1366×768` · padrão | Fluxo (l), UI-34b |
| `19-vazio-revisao-sem-candidatos-1366.png` | `#/projeto/demo/cortes/revisao/1?estado=vazio` (`Nenhum candidato gerado nesta execução`) | `1366×768` · padrão | Fluxo (l) vazio C.2 |
| `20-erro-revisao-proxy-offline-1366.png` | Bancada sobre `offline.mp4`: fallback acionável `Ir para Fontes e relocalizar` + `Gerado por legacy` | `1366×768` · padrão | Fluxo (l), UI-35 |
| `21-erro-revisao-fatal-1366.png` | `#/projeto/demo/cortes/revisao/1?estado=erro` (`local_only_violation`) | `1366×768` · padrão | Fluxo (l) erro C.2 |
