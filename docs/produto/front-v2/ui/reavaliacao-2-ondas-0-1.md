# Segunda Reavaliação Independente de UI — Ondas 0 + 1 (`front-v2`)

> ⚠️ **DEGRADED: single-context (subagentes desabilitados pela regra da tarefa; avaliação conduzida em contexto único combinando inspeção visual das 21 capturas renderizadas, auditoria automatizada de DOM/WCAG, suítes E2E e análise de código).**
>
> **Data da reavaliação:** 2026-11-18  
> **Commit avaliado (`HEAD`):** `166ca3e` (`fix(front-v2): Fontes — alvo do Checkbox >= 24 px, h1 e Excluir Fonte via sources.delete (#410)`)  
> **Linha de base comparada:** `a67cc53` ([avaliacao-ondas-0-1.md](./avaliacao-ondas-0-1.md))  
> **Primeira reavaliação comparada:** `bac1165` ([reavaliacao-ondas-0-1.md](./reavaliacao-ondas-0-1.md))  
> **Entregas incorporadas desde a 1ª reavaliação:** `#406`/PR `#407` (`2688bd6` — atualização de `e2e/ui-baseline.spec.ts` para rodar inteiro até a captura 21), `#405`/PR `#408` (`361008c` — `UI-17` e `UI-12`/`UI-18a` em `<InstaladorJustInTime>` e `EntradaFonte`) e `#404`/PR `#410` (`166ca3e` — `UI-15`, `UI-16` e `UI-18b` em `Checkbox`, `Fontes` e `ListaFontes`).  
> **Escopo:** Onda 0 (Shell Global) e Onda 1 (`#/inicio`, `#/assistente`, `<InstaladorJustInTime>`, `#/config/provedores`, `#/config/custos`, `#/config/componentes`, `#/config/exportacao`, `#/config/aparencia`, `#/config/projeto`), com foco no **Fluxo (b) Assistente + Instalador just-in-time** e na integração com **`#/projeto/:id/fontes`**. Papel exclusivamente avaliador — nenhuma tela ou teste foi alterado neste PR.

---

## 1. Cenário executado e saídas automatizadas

O cenário fixo foi executado integralmente **sem desvios e sem edição de `front-v2/e2e/ui-baseline.spec.ts`**, sobre o mock TypeScript (`VITE_CORE_MOCK=1`, sem Tauri), cobrindo os viewports `1366×768` e `1440×900`, tema padrão (`escuro`), tema `claro` e `[data-contrast="high"]`.

### Comandos executados e resultados observados

- `cd front-v2; bun install`: `152 packages installed` (exit `0`).
- `cd front-v2; bun run typecheck` (`tsc --noEmit`): sem erros (exit `0`).
- `cd front-v2; bun run test` (`vitest run`): **`35 passed (35)`**, **`306 passed (306)`** testes unitários e de componentes.
- `cd front-v2; bunx playwright test` (suíte E2E padrão): **`23 passed`**, `1 skipped` (`e2e/ui-baseline.spec.ts` ignorado sem `UI_BASELINE=1`; inclui `fontes.spec.ts` com `1440×900` e `fontes-excluir.spec.ts`).
- `cd front-v2; $env:UI_BASELINE = "1"; bunx playwright test e2e/ui-baseline.spec.ts`: **`1 passed (13.0s)`** do começo ao fim, sem falhas nem timeouts, gerando todas as **21 PNGs** (`01` a `21`) e o anexo `ui-baseline-audit.json` (**25 auditorias DOM**, **`0` `pageerror`**). As PNGs geradas foram movidas para `docs/produto/front-v2/ui/capturas/ondas-0-1-reav2/` e as originais restauradas com `git checkout -- docs/produto/front-v2/ui/capturas/ondas-0-1/`.
- `bunx impeccable detect --json front-v2/src`: **`[]`** (exit `0`, zero achados no detector mecânico).
- `cd design-system-v2; bun scripts/contraste.ts`: **`Todos os pares passam.`** (tema escuro, tema claro, escuro `[data-contrast="high"]` e claro `[data-contrast="high"]`, incluindo `contorno-controle` e `contorno-campo` de `8,37:1` a `11,97:1`).

### Síntese das verificações transversais (DOM + Teclado + Glossário)

| Aspecto | Resultado observado | Evidência / Observação |
|---|---|---|
| **Teclado (`Tab`, `Esc`, `F6`, `Ctrl+J`, `Ctrl+K`, `?`, `Ctrl+,`)** | **Aprovado** | `ui-baseline.spec.ts` confirma `F6` ciclando `topo → conteudo`, `Ctrl+J` acionando toast da Fila, `Ctrl+K` abrindo Paleta com rodapé e `Esc` devolvendo foco ao gatilho; `shell.spec.ts`, `fontes.spec.ts` e `fontes-excluir.spec.ts` passam (foco inicial em `Cancelar` nos `<ConfirmDialog>`). |
| **Foco visível** | **Aprovado** | Anel `2px` `--foco` / branco em `[data-contrast="high"]` e borda interna `foco-interno` confirmados nas 25 auditorias DOM de `ui-baseline-audit.json`. |
| **Contraste WCAG 2.2 AA** | **Aprovado** | `0` textos abaixo de 4,5:1 / 3:1 nas 25 telas/estados auditados (incluindo tema `claro` e `[data-contrast="high"]`); `contraste.ts` aprova todos os pares de tokens. |
| **Alvos ≥ 24 px (WCAG 2.5.8)** | **Aprovado** | `0` alvos `< 24 px` em todas as telas de Ondas 0+1 e `#/projeto/:id/fontes` (única ressalva são os 3 links inline `Código-fonte` dentro de `<p>` em `ConfigComponentes`, cobertos pela exceção inline da WCAG 2.5.8). Checkboxes de lote em `ListaFontes` agora medem `≥ 24×24 px` (`fontes-excluir.spec.ts` L31–50). |
| **Headings (`h1–h6`)** | **Aprovado** | `<h1>` único visível confirmado em todas as telas auditadas, incluindo `<h1>Fontes e Transcrição</h1>` em `#/projeto/:id/fontes` (`shell-com-projeto`, `fontes-jit`) e `?sub=lotes` (`fontes-excluir.spec.ts` L15–27). |
| **Textos PT-BR e `GLOSSARY.md`** | **Aprovado** | `0` ocorrências de termos proibidos (`preset`, `clipe`, `short`, `input`, `voice-over`, `locução`, `workspace`) nas 25 auditorias DOM. Nenhuma referência `#\d+` em texto visível de `<InstaladorJustInTime>` ou `ListaFontes` (varredura `rg` em `front-v2/src` encontra `#\d+` apenas em comentários de código, testes e tooltips de botões desabilitados previstos em `04-plano-implementacao.md` L53). `English` permanece desabilitado com `"Em preparação"`. |
| **Overflow (`1366×768` e `1440×900`)** | **Aprovado** | `0` ocorrências de scroll horizontal ou vertical externo nas 25 auditorias DOM de `ui-baseline-audit.json` e nos fluxos `1440×900` de `fontes.spec.ts`. |
| **Estados de erro e aviso de custo** | **Aprovado** *(ressalva menor **UI-19**)* | Erros em `role="alert"` via `BannerErroCore` (`?estado=erro`, `js_runtime_missing`, `source_busy`). Consentimento explícito e aviso de custo/cota antes de ação externa em API e CLI preservados. Quando `js_runtime_missing` abre o JIT inline em `EntradaFonte`, o botão `"Instalar deno"` no `BannerErroCore` permanece redundante sem ação visível (**UI-19**). |

---

## 2. Tabela de pontuação por fluxo (Critique — Nielsen 0–4)

Meta do mandato: **≥ 90%** da pontuação aplicável (**`36 / 40`**).  
Legenda: **H1** Visibilidade de estado · **H2** Mundo real / vocabulário · **H3** Controle e liberdade · **H4** Consistência e padrões · **H5** Prevenção de erros · **H6** Reconhecimento vs. lembrança · **H7** Flexibilidade e atalhos · **H8** Estética e minimalismo · **H9** Recuperação de erros · **H10** Ajuda e documentação.

| Fluxo / Superfície | H1 | H2 | H3 | H4 | H5 | H6 | H7 | H8 | H9 | H10 | Linha de base (`a67cc53`) | 1ª Reav (`bac1165`) | Agora (`166ca3e`) | Delta vs. 1ª Reav | % Agora | Meta ≥ 90% |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| **Onda 0 · Shell Global** | 3 | 4 | 4 | 4 | 3 | 4 | 4 | 4 | 3 | 4 | 27 / 40 (67,5%) | 37 / 40 (92,5%) | **37 / 40** | **0 (0,0 p.p.)** | **92,5%** | **Atinge** |
| **Fluxo (a) · Início e Projetos (`#/inicio`)** | 4 | 4 | 4 | 4 | 4 | 4 | 4 | 4 | 3 | 3 | 36 / 40 (90,0%) | 38 / 40 (95,0%) | **38 / 40** | **0 (0,0 p.p.)** | **95,0%** | **Atinge** |
| **Fluxo (b) · Assistente (`#/assistente`) + JIT** | 3 | 4 | 4 | 4 | 4 | 4 | 3 | 4 | 3 | 3 | 28 / 40 (70,0%) | 34 / 40 (85,0%) | **36 / 40** | **+2 (+5,0 p.p.)** | **90,0%** | **Atinge** |
| **Fluxo (c) · Provedores e Custos (`#/config/provedores`, `custos`)** | 4 | 4 | 3 | 4 | 4 | 4 | 4 | 4 | 4 | 3 | 32 / 40 (80,0%) | 38 / 40 (95,0%) | **38 / 40** | **0 (0,0 p.p.)** | **95,0%** | **Atinge** |
| **Fluxo (d) · Componentes, Exportação, Aparência e Projeto** | 4 | 4 | 4 | 4 | 4 | 4 | 4 | 4 | 3 | 3 | 35 / 40 (87,5%) | 38 / 40 (95,0%) | **38 / 40** | **0 (0,0 p.p.)** | **95,0%** | **Atinge** |

### Justificativa das mudanças por heurística e fluxo

- **Onda 0 · Shell Global (`37/40 → 37/40`, delta `0`, Atinge 92,5%):**
  - Nenhuma alteração nem regressão nas telas ou comportamentos do Shell ([01-shell-inicio-1366.png](./capturas/ondas-0-1-reav2/01-shell-inicio-1366.png), [02-shell-paleta-1366.png](./capturas/ondas-0-1-reav2/02-shell-paleta-1366.png), [03-shell-projeto-aberto-1366.png](./capturas/ondas-0-1-reav2/03-shell-projeto-aberto-1366.png)). **H1** permanece em `3` enquanto a gaveta completa da Fila de Jobs aguarda a Onda 6.

- **Fluxo (a) · Início e Projetos (`38/40 → 38/40`, delta `0`, Atinge 95,0%):**
  - Todas as telas e estados (`carregando`, `vazio`, `erro`, `Novo Projeto`, abertura V1) mantêm o mesmo nível sem regressões ([04-inicio-vazio-1366.png](./capturas/ondas-0-1-reav2/04-inicio-vazio-1366.png), [05-inicio-erro-1366.png](./capturas/ondas-0-1-reav2/05-inicio-erro-1366.png), [06-inicio-novo-projeto-1366.png](./capturas/ondas-0-1-reav2/06-inicio-novo-projeto-1366.png)).

- **Fluxo (b) · Assistente (`#/assistente`) + Instalador JIT (`34/40 → 36/40`, delta `+2 / +5,0 p.p.`, Atinge 90,0%):**
  - **H2 (`3 → 4`, +1):** `#408` removeu `(#301)` e `(#307)` de todos os textos visíveis de `InstaladorJustInTime.tsx` ([21-fontes-jit-1366.png](./capturas/ondas-0-1-reav2/21-fontes-jit-1366.png)), com varredura automática `/#\d+/` garantida em `InstaladorJustInTime.test.tsx` e `fontes.spec.ts`.
  - **H8 (`3 → 4`, +1):** `#408` rebaixou `Baixar por URL` (e `Importar Fonte`) para `variante="secundario"` em `EntradaFonte.tsx` sempre que o `<InstaladorJustInTime>` inline estiver aberto (`jitInlineAberto`), restaurando a *Regra da Luz Única* com um único botão primário `bg-sinal` (`Baixar e continuar`, [21-fontes-jit-1366.png](./capturas/ondas-0-1-reav2/21-fontes-jit-1366.png)).
  - **Integração com Fontes (`#410`):** A tela `#/projeto/:id/fontes`, que hospeda o JIT de `url_import`, também fechou os bloqueios de integração **UI-15** (`Checkbox` de lote ≥ `24×24 px`), **UI-16** (`<h1>Fontes e Transcrição</h1>` em Fontes e Lotes) e **UI-18b** (`Excluir Fonte` conectado a `sources.delete` com `<ConfirmDialog>` focado em `Cancelar`).
  - **O que segura as demais heurísticas em `3`:** **H1 (`3`)** porque `yunet` (Onda 4) e `tts` (Onda 5) ainda não têm rota montada (**UI-06** Parcial) e o `BannerErroCore` de `js_runtime_missing` fica visível junto do JIT já aberto; **H7 (`3`)** por ausência de atalho dedicado de teclado para avançar/voltar entre os passos do Assistente; **H9 (`3`)** pelo CTA `"Instalar deno"` no `BannerErroCore` não focar nem fechar o alerta redundante quando o JIT inline já está montado (**UI-19**); **H10 (`3`)** com ajuda contextual adequada nos passos e `<details>` técnicos. Nota visual menor registrada em `PassoProvedor.tsx` para o botão de exibir/ocultar chave (**UI-20**).

- **Fluxo (c) · Provedores e Custos (`38/40 → 38/40`, delta `0`, Atinge 95,0%):**
  - Comportamento, contraste, consentimento CLI (`UI-02`) e auditoria/custos mantidos intactos ([09-config-provedores-1366.png](./capturas/ondas-0-1-reav2/09-config-provedores-1366.png), [10-config-provedores-modal-1366.png](./capturas/ondas-0-1-reav2/10-config-provedores-modal-1366.png), [11-config-custos-orcamentos-1366.png](./capturas/ondas-0-1-reav2/11-config-custos-orcamentos-1366.png), [12-config-custos-auditoria-1366.png](./capturas/ondas-0-1-reav2/12-config-custos-auditoria-1366.png), [13-config-custos-precos-1366.png](./capturas/ondas-0-1-reav2/13-config-custos-precos-1366.png), [20-config-provedores-hc-1440.png](./capturas/ondas-0-1-reav2/20-config-provedores-hc-1440.png)).

- **Fluxo (d) · Componentes, Exportação, Aparência e Projeto (`38/40 → 38/40`, delta `0`, Atinge 95,0%):**
  - Todas as telas, abas, alto contraste e glossário mantidos sem regressões ([14-config-componentes-hardware-1366.png](./capturas/ondas-0-1-reav2/14-config-componentes-hardware-1366.png), [15-config-componentes-modelos-1366.png](./capturas/ondas-0-1-reav2/15-config-componentes-modelos-1366.png), [16-config-exportacao-detectado-1366.png](./capturas/ondas-0-1-reav2/16-config-exportacao-detectado-1366.png), [17-config-aparencia-padrao-1366.png](./capturas/ondas-0-1-reav2/17-config-aparencia-padrao-1366.png), [18-config-aparencia-hc-1366.png](./capturas/ondas-0-1-reav2/18-config-aparencia-hc-1366.png), [19-config-projeto-1366.png](./capturas/ondas-0-1-reav2/19-config-projeto-1366.png)).

### Auditoria Técnica (Impeccable Audit — `/20`)

| Dimensão | Linha de base | 1ª Reav | Agora | Delta vs. 1ª Reav | Achado principal |
|---|---|---|---|---|---|
| 1. Accessibility | 2 / 4 | 3 / 4 | **4 / 4** | **+1** | `UI-15` (alvos ≥ 24×24 px) e `UI-16` (`<h1>` único em Fontes e Lotes) resolvidos; 0 falhas de contraste, foco ou nome acessível nas 25 telas/estados auditados (únicos alvos `< 24 px` são links inline `Código-fonte`, exceção WCAG 2.5.8). |
| 2. Performance | 4 / 4 | 4 / 4 | **4 / 4** | 0 | Carregamento paralelo sem layout thrashing e respeito a `prefers-reduced-motion`. |
| 3. Theming | 2 / 4 | 4 / 4 | **4 / 4** | 0 | Degraus de superfície e `[data-contrast="high"]` íntegros; `contraste.ts` 100% aprovado nos 4 modos. |
| 4. Responsive Design | 4 / 4 | 4 / 4 | **4 / 4** | 0 | Zero overflow externo em `1366×768` e `1440×900`, inclusive com Fontes + JIT inline aberto. |
| 5. Implementation Integrity | 3 / 4 | 3 / 4 | **3 / 4** | 0 | `impeccable detect` limpo (`[]`), `UI-12`, `UI-17` e `UI-18` resolvidos; mantém `3/4` apenas pelos dois desvios pontuais isolados (**UI-19** em `EntradaFonte` e **UI-20** em `PassoProvedor`). |
| **Total** | **15 / 20** *(Good)* | **18 / 20** *(Excellent)* | **19 / 20** *(Excellent)* | **+1** | **Todos os 5 fluxos atingem a meta ≥ 90% e todas as pendências P1 da 1ª reavaliação foram encerradas.** |

---

## 3. Status dos achados (`UI-06`, `UI-12` e `UI-15` a `UI-18`)

| ID | Descrição resumida | Status | Prova / Evidência na 2ª reavaliação |
|---|---|---|---|
| **UI-06** | `<InstaladorJustInTime>` sem ponto de entrada navegável | **Parcial** | Modo `url_import` está montado, navegável e validado de ponta a ponta em `#/projeto/:id/fontes` ([21-fontes-jit-1366.png](./capturas/ondas-0-1-reav2/21-fontes-jit-1366.png), `ui-baseline.spec.ts` L367–380 e `fontes.spec.ts` L170–214). Os modos `yunet` (Onda 4) e `tts` (Onda 5) permanecem cobertos em Vitest (`InstaladorJustInTime.test.tsx`) aguardando a entrega dessas ondas no plano (`04-plano-implementacao.md`). |
| **UI-12** | Códigos `#305`/`#307` e `"Instalado (test)"` no texto visível | **Resolvido** | Limpo em `PassoEssencial` ([07-assistente-passo1-1366.png](./capturas/ondas-0-1-reav2/07-assistente-passo1-1366.png)), `ConfigProvedores` ([09-config-provedores-1366.png](./capturas/ondas-0-1-reav2/09-config-provedores-1366.png)), `ConfigComponentes` (`Instalado (2026.11.01)`, [15-config-componentes-modelos-1366.png](./capturas/ondas-0-1-reav2/15-config-componentes-modelos-1366.png)) e agora também em `<InstaladorJustInTime>` após `#408` ([21-fontes-jit-1366.png](./capturas/ondas-0-1-reav2/21-fontes-jit-1366.png), `InstaladorJustInTime.test.tsx` L553–610 e `fontes.spec.ts` L199). |
| **UI-15** | Checkboxes de seleção em lote em `ListaFontes` com `16×24 px` | **Resolvido** | `design-system-v2/src/primitivas/Escolhas.tsx` L10–37 passou a aplicar `min-w-6 justify-center` quando não há rótulo visível (`sr-only`); validado em `fontes-excluir.spec.ts` L31–50 (`width >= 24`, `height >= 24`) e nas capturas [03-shell-projeto-aberto-1366.png](./capturas/ondas-0-1-reav2/03-shell-projeto-aberto-1366.png) e [21-fontes-jit-1366.png](./capturas/ondas-0-1-reav2/21-fontes-jit-1366.png). |
| **UI-16** | Tela `#/projeto/:id/fontes` sem `<h1>` | **Resolvido** | `front-v2/src/telas/fontes/Fontes.tsx` L209–211 renderiza `<h1>Fontes e Transcrição</h1>` tanto em `Fontes` quanto em `Lotes de Fontes`; confirmado no `ui-baseline-audit.json` (`shell-com-projeto` e `fontes-jit`), em `fontes-excluir.spec.ts` L15–27 e em [21-fontes-jit-1366.png](./capturas/ondas-0-1-reav2/21-fontes-jit-1366.png). |
| **UI-17** | Dois botões primários `bg-sinal` simultâneos com JIT inline aberto | **Resolvido** | `front-v2/src/telas/fontes/EntradaFonte.tsx` L473, L485, L606 rebaixa `Baixar por URL` (e `Importar Fonte`) para `variante="secundario"` enquanto `jitInlineAberto` é verdadeiro; confirmado visualmente em [21-fontes-jit-1366.png](./capturas/ondas-0-1-reav2/21-fontes-jit-1366.png) (`Baixar e continuar` é o único botão laranja) e em `fontes.spec.ts` L194–211 (`button.bg-sinal` count = `1`). |
| **UI-18** | `(#301)`/`(#307)` em `InstaladorJustInTime` e `Excluir Fonte` citando `#295` em `ListaFontes` | **Resolvido** | **UI-18a:** `InstaladorJustInTime.tsx` removeu as referências de ticket do texto visível (`#408`, [21-fontes-jit-1366.png](./capturas/ondas-0-1-reav2/21-fontes-jit-1366.png)). **UI-18b:** `ListaFontes.tsx` L596–604, L896–917 ligou `Excluir Fonte` a `sources.delete` com `<ConfirmDialog>` focado em `Cancelar`, tratamento de `source_busy` e remoção de `#295` (`#410`, [03-shell-projeto-aberto-1366.png](./capturas/ondas-0-1-reav2/03-shell-projeto-aberto-1366.png), [21-fontes-jit-1366.png](./capturas/ondas-0-1-reav2/21-fontes-jit-1366.png) e `fontes-excluir.spec.ts` L52–112). |

*(Nota: os demais achados da linha de base `UI-01` a `UI-05`, `UI-07` a `UI-11`, `UI-13` e `UI-14` permaneceram **Resolvido** conforme verificado pelo `ui-baseline.spec.ts` completo e pelas capturas `01` a `20`.)*

---

## 4. Achados novos (`UI-19` em diante)

| ID | Sev. | Categoria | Tela / Arquivo | Passo para reproduzir | Captura | Sugestão de correção |
|---|---|---|---|---|---|---|
| **UI-19** | **P2** | bloqueador funcional *(CTA redundante sem efeito)* | `#/projeto/:id/fontes` · `EntradaFonte` + `<InstaladorJustInTime>` (`front-v2/src/telas/fontes/EntradaFonte.tsx` L317–321, L533–535) | Em `#/projeto/:id/fontes`, alternar para `URL (VOD)`, preencher `https://youtube.com/watch/js-test`, clicar em `Baixar por URL` e aceitar os termos: o painel `<InstaladorJustInTime>` abre abaixo **junto** com o `BannerErroCore` (`"Falta o componente deno para resolver este vídeo do YouTube."`) acima. Ao clicar no botão **`Instalar deno`** dentro do banner, o handler executa apenas `setMostrarJit(true)`, que já é `true` — nada acontece (nem move o foco/scroll para o painel JIT nem fecha o alerta duplicado). | [21-fontes-jit-1366.png](./capturas/ondas-0-1-reav2/21-fontes-jit-1366.png) | Quando `mostrarJit` for aberto automaticamente em `executarDownloadUrl` (`component_missing` / `js_runtime_missing`), focar o painel `<InstaladorJustInTime>` ao acionar `Instalar deno` ou omitir o CTA duplicado/limpar o banner após a abertura inline do JIT. |
| **UI-20** | **P3** | visual | `#/assistente?passo=2` (`front-v2/src/telas/assistente/PassoProvedor.tsx` L535–542) | Abrir `#/assistente?passo=2`, selecionar `Chave de API` e inspecionar o botão só de ícone `Mostrar chave` / `Ocultar chave` à direita do campo `Chave de API`: usa `<Botao tamanho="p">` (`24 px` de altura) ao lado de `<Entrada>` (`28 px` de altura) e sem `<Dica>` (`DESIGN.md` prevê `<BotaoIcone>` com `<Dica>` para botões só de ícone), criando desnível de `4 px` e ausência de tooltip no hover/foco. | [08-assistente-passo2-api-1366.png](./capturas/ondas-0-1-reav2/08-assistente-passo2-api-1366.png) | Substituir por `<BotaoIcone rotulo={mostrarChave ? 'Ocultar chave' : 'Mostrar chave'} ...>` (`28 px` `m`, com `<Dica>`) ou alinhar com o padrão com rótulo (`Mostrar`) usado em `FormPerfilProvedor`. |

---

## 5. Inventário das capturas PNG (`docs/produto/front-v2/ui/capturas/ondas-0-1-reav2/`)

Total: **21 arquivos** gerados diretamente pela execução completa de `front-v2/e2e/ui-baseline.spec.ts` (`UI_BASELINE=1`).

| Arquivo | Tela / Estado | Viewport / Tema | Sustenta |
|---|---|---|---|
| `01-shell-inicio-1366.png` | `#/inicio` padrão | `1366×768` · padrão | Onda 0, Fluxo (a) |
| `02-shell-paleta-1366.png` | Paleta `Ctrl+K` aberta com rodapé | `1366×768` · padrão | Onda 0 (`UI-14`) |
| `03-shell-projeto-aberto-1366.png` | Menu `SeletorProjeto` aberto sobre `#/projeto/.../fontes` | `1366×768` · padrão | Onda 0 (`UI-01`), `UI-15`, `UI-16`, `UI-18b` |
| `04-inicio-vazio-1366.png` | `#/inicio?estado=vazio` | `1366×768` · padrão | Fluxo (a) estado vazio |
| `05-inicio-erro-1366.png` | `#/inicio?estado=erro` (`BannerErroCore`) | `1366×768` · padrão | Fluxo (a) erro |
| `06-inicio-novo-projeto-1366.png` | Diálogo `Novo Projeto` | `1366×768` · padrão | Fluxo (a) e contraste de campos |
| `07-assistente-passo1-1366.png` | `#/assistente?passo=1` | `1366×768` · padrão | Fluxo (b), `UI-12` |
| `08-assistente-passo2-api-1366.png` | `#/assistente?passo=2` (`Chave de API`) | `1366×768` · padrão | Fluxo (b), `UI-03`, `UI-20` |
| `09-config-provedores-1366.png` | `#/config/provedores` | `1366×768` · padrão | Fluxo (c), `UI-02`, `UI-12` |
| `10-config-provedores-modal-1366.png` | Modal `Novo Perfil de Provedor` | `1366×768` · padrão | Fluxo (c), `UI-11` |
| `11-config-custos-orcamentos-1366.png` | `/?source-test=1#/config/custos` (`Orçamentos e Gastos`) | `1366×768` · padrão | Fluxo (c) |
| `12-config-custos-auditoria-1366.png` | `/?source-test=1#/config/custos` (`Auditoria`) | `1366×768` · padrão | Fluxo (c) |
| `13-config-custos-precos-1366.png` | `/?source-test=1#/config/custos` (`Preços e Estimador`) | `1366×768` · padrão | Fluxo (c) |
| `14-config-componentes-hardware-1366.png` | `/?source-test=1#/config/componentes` (`Hardware`) | `1366×768` · padrão | Fluxo (d) |
| `15-config-componentes-modelos-1366.png` | `/?source-test=1#/config/componentes` (`Modelos`) | `1366×768` · padrão | Fluxo (d), `UI-12` |
| `16-config-exportacao-detectado-1366.png` | `/?source-test=1#/config/exportacao` (após detectar) | `1366×768` · padrão | Fluxo (d) |
| `17-config-aparencia-padrao-1366.png` | `/?source-test=1#/config/aparencia` | `1366×768` · padrão | Fluxo (d), `UI-13` |
| `18-config-aparencia-hc-1366.png` | `/?source-test=1#/config/aparencia` (`[data-contrast="high"]`) | `1366×768` · alto contraste | Fluxo (d), `UI-09` |
| `19-config-projeto-1366.png` | `/?source-test=1#/config/projeto` | `1366×768` · padrão | Fluxo (d), `UI-11` |
| `20-config-provedores-hc-1440.png` | `/?source-test=1#/config/provedores` (`[data-contrast="high"]`) | `1440×900` · alto contraste | Fluxos (c)/(d), `UI-09` |
| `21-fontes-jit-1366.png` | `#/projeto/meu-canal-de-cortes/fontes` (`URL (VOD)` + JIT aberto) | `1366×768` · padrão | Fluxo (b), `UI-06`, `UI-12`, `UI-15`–`UI-18`, `UI-19` |
