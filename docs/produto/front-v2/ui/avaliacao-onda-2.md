# Avaliação Independente de UI — Onda 2: Fontes e Transcrição (`front-v2`)

> ⚠️ **DEGRADED: single-context (subagentes desabilitados pela regra da tarefa; avaliação conduzida em contexto único combinando inspeção visual das 23 capturas renderizadas, auditoria automatizada de DOM/WCAG e análise de código).**
>
> **Data da avaliação:** 2026-11-18  
> **Commit avaliado (`origin/master`):** `7046ad4` (`fix(front-v2): omitir CTA redundante no JIT de Fontes e usar BotaoIcone 28px em PassoProvedor (#414) (#416)`)  
> **Escopo:** Onda 2 — Macro-etapa 1 **Fontes e Transcrição** (`#342`–`#345`, plano [06-plano-onda-2.md](../06-plano-onda-2.md), spec [B-fontes-e-transcricao.md](../telas/B-fontes-e-transcricao.md)): Fluxo **(e)** Lista de Fontes (`#/projeto/:id/fontes`), Fluxo **(f)** Entrada de Fonte (local, URL/VOD e `<InstaladorJustInTime>`), Fluxo **(g)** Lotes de Fontes (`#/projeto/:id/fontes?sub=lotes`) e Fluxo **(h)** Detalhe da Fonte e Leitor de Transcrição (`#/projeto/:id/fontes/:fonteId`). Papel exclusivamente avaliador — nenhuma tela foi alterada neste PR.

---

## 1. Cenário fixo e reproduzível

O cenário foi executado sobre o mock TypeScript (`VITE_CORE_MOCK=1`, sem Tauri) pelo script dedicado `front-v2/e2e/ui-onda2.spec.ts` (ignorado no CI padrão quando `UI_BASELINE` não está definido).

### Pré-requisitos e comandos

```powershell
# 1. Instalar dependências
cd front-v2
bun install

# 2. Verificações padrão (typecheck, testes unitários e suíte E2E sem UI_BASELINE)
bun run typecheck
bun run test
bunx playwright test

# 3. Executar o cenário completo da Onda 2 (gera as 23 PNGs e ui-onda2-audit.json)
$env:UI_BASELINE = "1"
bunx playwright test e2e/ui-onda2.spec.ts
Remove-Item Env:UI_BASELINE

# 4. Verificações estáticas e de contraste
cd ..
bunx impeccable detect --json front-v2/src
cd design-system-v2
bun scripts/contraste.ts
```

### Parâmetros do cenário

- **Viewports:** `1366×768` (notebook alvo) e `1440×900`.
- **Temas e contraste:** tema escuro padrão (`:root` / `[data-tema="escuro"]`) e modo alto contraste (`[data-contrast="high"]` via `#/config/aparencia`) aplicado nas telas principais de Fontes, Lotes e Detalhe da Fonte.
- **Cobertura funcional:** estados `?estado=vazio` e `?estado=offline`, busca global FTS5 (sem resultado e com resultado), Fontes V1 `offline`/`changed` com relocalização e `confirmation_required`, `Excluir Fonte` (`ConfirmDialog`), entrada local multipista OBS + `CampoPermissao`, entrada URL com Termos do YouTube, `js_runtime_missing` + JIT inline, `age_restricted`, criação de lote Groq com `<ResumoCustoPrivacidade>`, `local_only_violation`, `budget_paused` + `timeout_uncertain`, guarda `:fonteId` inexistente (`999`), amostra de 30 s, aviso VAD `#279`, blocos de 10 min em execução e cancelamento mantendo blocos salvos, Leitor virtualizado com `Silêncio` e edição inline `F2`/`Enter`.

### Saídas automatizadas observadas

- `cd front-v2 && bun install`: `152 packages installed` (exit `0`).
- `cd front-v2 && bun run typecheck`: `tsc --noEmit` limpo (exit `0`).
- `cd front-v2 && bun run test`: `41 passed (41)` arquivos, `340 passed (340)` testes unitários/componentes.
- `cd front-v2 && bunx playwright test` (CI padrão, sem `UI_BASELINE`): `23 passed`, `2 skipped` (`e2e/ui-baseline.spec.ts` e `e2e/ui-onda2.spec.ts`).
- `cd front-v2 && $env:UI_BASELINE = "1"; bunx playwright test e2e/ui-onda2.spec.ts`: `1 passed`, `0` `pageerror`, `0` ocorrências de overflow externo (`1366×768` e `1440×900`) e `0` overflow em tabelas internas across os 25 estados auditados.
- `bunx impeccable detect --json front-v2/src`: `[]` (exit `0`, zero achados no detector mecânico).
- `cd design-system-v2 && bun scripts/contraste.ts`: `Todos os pares passam.` (escuro, claro, escuro `[data-contrast="high"]` e claro `[data-contrast="high"]`).

### Síntese das verificações transversais (DOM + Teclado + Glossário)

| Aspecto | Resultado observado | Evidência / Observação |
|---|---|---|
| **Teclado (`Tab`, `Esc`, `F6`, `Ctrl+F`, `F2`/`Enter`, setas)** | **Parcial** *(achados **UI-21**, **UI-29**)* | `F6` cicla `conteudo → rodape`; `Esc` fecha `ConfirmDialog` e `GavetaBuscaFts` devolvendo o foco; `F2`/`Enter` no Leitor edita e mantém o foco na palavra (`CorrigidaUI`). Porém fechar a busca FTS5 após `Enter` sofre corrida do debounce de `220 ms` (**UI-21**), e `←`/`→` no Leitor para na borda da janela DOM virtualizada (**UI-29**). |
| **Foco visível** | **Aprovado** | Anel `2px` (`rgb(255, 90, 31)` / `rgb(236, 236, 238)` no padrão e `rgb(255, 255, 255)` + borda `1px` em `[data-contrast="high"]`) confirmado nos 25 estados auditados. |
| **Contraste WCAG 2.2 AA** | **Aprovado** | `0` textos abaixo de `4,5:1` (`3:1` texto grande) nos 25 estados, inclusive em `[data-contrast="high"]` (`06`, `16`, `23`). `contraste.ts` aprova todos os pares de tokens. |
| **Alvos ≥ 24 px (WCAG 2.5.8)** | **Reprovado em `PainelMotorSinais`** *(achado **UI-24**)* | Palavras no Leitor medem `41,9 × 24 px` e checkboxes de lote `≥ 24×24 px`; porém em `PainelMotorSinais`, os 2 `role="radio"` (`18,8 px`) e os 2 links de configuração (`17,4 px`) ficam abaixo de `24 px` (**UI-24**). |
| **Headings (`h1–h6`)** | **Parcial** *(achado **UI-25**)* | `h1Count = 1` em todos os 25 estados auditados (`<h1>Fontes e Transcrição</h1>` e `<h1>Live_12_11_final.mp4</h1>`), mas `ListaLotes` salta de `<h1>` direto para `<h3>Lote #1</h3>` sem `<h2>` de seção (**UI-25**). |
| **Textos PT-BR e `GLOSSARY.md`** | **Aprovado** para termos proibidos; **Reprovado** em refs/textos internos *(achado **UI-28**)* | `0` ocorrências de `clipe`, `short`, `input`, `voice-over`, `locução`, `workspace`, `preset`, `segmento`, `sentença` ou `highlight`. Contudo, `<Dica>` expõe `#296`/`#302`/`#307`, o modal de lote mostra `legacy`, o toast mostra `Fonte #4`, a lista mostra `→ Ir para Cortes →` e o radio do Groq mostra `~US$ 0,00 – US$ 0,00` (**UI-28**). |
| **Regra da Luz Única** | **Parcial** *(achado **UI-26**)* | Fluxos (e), (f) e (g) mantêm 1 botão `bg-sinal` ativo por tela (exceto modo URL + `?estado=vazio`); porém `DetalheFonte` pré-transcrição exibe **2** botões `bg-sinal` ativos ao mesmo tempo (`Iniciar transcrição` + `Focar configuração do Motor`, **UI-26**). |
| **Estados de erro e aviso de custo** | **Parcial** *(achados **UI-22**, **UI-23**)* | `<ResumoCustoPrivacidade>` e `<ConfirmDialog>` funcionam antes de ação remota em `PainelMotorSinais` e `ConstrutorLote`; porém `ConstrutorLote` renderiza erros fora da área visível em `1366×768` (**UI-22**) e `retomarParcial()` em `DetalheFonte` pula os diálogos de confirmação (**UI-23**). |

---

## 2. Tabela de pontuação por fluxo (Critique — Nielsen 0–4)

Meta do mandato: **≥ 90%** da pontuação aplicável (**`36 / 40`**), WCAG 2.2 AA e zero bloqueador funcional.  
Legenda: **H1** Visibilidade de estado · **H2** Mundo real / vocabulário · **H3** Controle e liberdade · **H4** Consistência e padrões · **H5** Prevenção de erros · **H6** Reconhecimento vs. lembrança · **H7** Flexibilidade e atalhos · **H8** Estética e minimalismo · **H9** Recuperação de erros · **H10** Ajuda e documentação.

| Fluxo / Superfície | H1 | H2 | H3 | H4 | H5 | H6 | H7 | H8 | H9 | H10 | Pontuação | % Aplicável | Meta ≥ 90% |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| **Fluxo (e) · Lista de Fontes (`#/projeto/:id/fontes`)** | 4 | 3 | 2 | 3 | 4 | 4 | 4 | 3 | 4 | 4 | **35 / 40** | **87,5%** | **Abaixo** |
| **Fluxo (f) · Entrada de Fonte (`EntradaFonte` + JIT)** | 4 | 3 | 4 | 4 | 4 | 4 | 3 | 3 | 4 | 4 | **37 / 40** | **92,5%** | **Atinge** |
| **Fluxo (g) · Lotes de Fontes (`?sub=lotes`)** | 4 | 3 | 4 | 3 | 4 | 4 | 4 | 3 | 2 | 4 | **35 / 40** | **87,5%** | **Abaixo** |
| **Fluxo (h) · Detalhe da Fonte e Leitor (`/:fonteId`)** | 3 | 3 | 3 | 3 | 3 | 4 | 3 | 3 | 4 | 4 | **33 / 40** | **82,5%** | **Abaixo** |

### Justificativa por fluxo e heurística abaixo de 4

- **Fluxo (e) · Lista de Fontes (`35/40` — 87,5%, Abaixo):**
  - **H2 (`3`):** Vocabulário de domínio (`GLOSSARY.md`) íntegro, mas os cartões exibem seta duplicada `→ Ir para Cortes →` ([01-fontes-lista-1366.png](./capturas/onda-2/01-fontes-lista-1366.png), **UI-28**).
  - **H3 (`2`):** Ao submeter a busca global (`Ctrl+F` + `Enter`) e clicar em `Fechar` antes de `220 ms` (ou sem limpar o termo), a corrida do `setTimeout` de debounce reabre `GavetaBuscaFts` imediatamente (**UI-21**).
  - **H4 (`3`):** Acima de 30 itens, `ListaFontes` monta `<ListaVirtual papel="listbox">`, aninhando checkboxes e botões dentro de `role="option"` (**UI-25**).
  - **H8 (`3`):** Em `1366×768`, abrir `GavetaBuscaFts` (`380 px`) ao lado de `EntradaFonte` comprime `ListaFontes` para ~`400 px`, empilhando os filtros em 4 linhas e quebrando o `<Status>` de transcrição nos cartões ([03-fontes-fts-1366.png](./capturas/onda-2/03-fontes-fts-1366.png), **UI-27**).

- **Fluxo (f) · Entrada de Fonte (`37/40` — 92,5%, Atinge):**
  - **H2 (`3`):** Textos claros no fluxo local/URL e remoção do CTA redundante no JIT confirmada ([09-entrada-url-jit-1366.png](./capturas/onda-2/09-entrada-url-jit-1366.png)), porém a trava de cópia simultânea ainda expõe `(#307)` no tooltip `<Dica>` (**UI-28**).
  - **H7 (`3`):** Em `1366×768`, após inspecionar arquivo local e abrir `Permissão` (`granted`), os botões `Limpar seleção` e `Importar Fonte` rolam para fora da dobra na coluna esquerda ([07-entrada-local-inspecao-1366.png](./capturas/onda-2/07-entrada-local-inspecao-1366.png)).
  - **H8 (`3`):** Formulário denso na pré-inspeção em `1366×768`; se alternar para `URL (VOD)` enquanto a lista está em `?estado=vazio`, coexistem `Baixar por URL` e `Importar primeira Fonte` em `bg-sinal`.

- **Fluxo (g) · Lotes de Fontes (`35/40` — 87,5%, Abaixo):**
  - **H2 (`3`):** O `<ConfirmDialog>` de criação de lote pago exibe `Provedor: legacy` e `Custo: US$ 0,00` para Seleção quando `selectionPaid: false`, contradizendo o painel de fundo ([12-lotes-montar-custo-1366.png](./capturas/onda-2/12-lotes-montar-custo-1366.png), **UI-28**).
  - **H4 (`3`):** `ListaLotes` salta de `<h1>Fontes e Transcrição</h1>` diretamente para `<h3>Lote #1</h3>` sem `<h2>` de seção na coluna direita ([13-lotes-execucao-1366.png](./capturas/onda-2/13-lotes-execucao-1366.png), **UI-25**).
  - **H8 (`3`):** `ConstrutorLote` empilha dois `<ResumoCustoPrivacidade>` no modo `Groq` e exige rolagem interna em `1366×768` ([12-lotes-montar-custo-1366.png](./capturas/onda-2/12-lotes-montar-custo-1366.png)).
  - **H9 (`2`):** Erros como `local_only_violation` ao submeter o formulário são montados no topo da coluna esquerda, **acima da dobra rolada**, sem mover scroll nem foco — deixando o usuário sem retorno visível no ponto do clique ([14-lotes-erro-local-only-1366.png](./capturas/onda-2/14-lotes-erro-local-only-1366.png), **UI-22**).

- **Fluxo (h) · Detalhe da Fonte e Leitor (`33/40` — 82,5%, Abaixo):**
  - **H1 (`3`):** Em `?estado=vazio`, `Blocos de 10 min` continua visível exibindo `6 / 6 blocos salvos · 0%`; ao redirecionar de `fontes/999`, o toast usa ícone de sucesso (`✓`) para um alerta de Fonte não encontrada ([17-detalhe-vazio-motor-1366.png](./capturas/onda-2/17-detalhe-vazio-motor-1366.png), **UI-27**).
  - **H2 (`3`):** Tooltips de `Desfazer`/`Refazer` e `Tira de miniaturas` expõem `#302` e `#296`; o toast de undo em outra Fonte mostra `Fonte #4` em vez do nome; o radio do Groq exibe `~US$ 0,00 – US$ 0,00` para microvalores `< US$ 0,01` ([17-detalhe-vazio-motor-1366.png](./capturas/onda-2/17-detalhe-vazio-motor-1366.png), **UI-28**).
  - **H3 (`3`):** `retomarParcial()` no banner de transcrição parcial não trata diálogos de confirmação (**UI-23**), e a navegação `←`/`→` entre palavras para na borda da janela DOM virtualizada (**UI-29**).
  - **H4 (`3`):** Palavras e `Silêncio` passam `≥ 24 px`, mas os 2 `role="radio"` de Motor (`18,8 px`) e os 2 links de configuração (`17,4 px`) em `PainelMotorSinais` violam WCAG 2.5.8 (**UI-24**).
  - **H5 (`3`):** `retomarParcial()` em `DetalheFonte` dispara `transcription.start` sem interceptar `confirmation_required`/`transcription_retry_confirmation` (**UI-23**).
  - **H7 (`3`):** `Refazer` omite o badge de atalho `Ctrl+Shift+Z` e `←`/`→` não rola além dos itens montados no `<ListaVirtual>` (**UI-29**).
  - **H8 (`3`):** Estado pré-transcrição exibe **2 botões primários `bg-sinal` simultâneos** (`Iniciar transcrição` + `Focar configuração do Motor`, **UI-26**).

### Auditoria Técnica (Impeccable Audit — `/20`)

| Dimensão | Pontuação | Achado principal |
|---|---|---|
| 1. Accessibility | **2 / 4** | Contraste AA/AAA (`contraste.ts` + 25 auditorias DOM) 100% aprovado, `<h1>` único e foco visível; cai por 4 alvos `< 24 px` em `PainelMotorSinais` (**UI-24**), salto `h1 → h3` e `role="option"` com controles aninhados (**UI-25**), e `←`/`→` limitado à janela virtualizada (**UI-29**). |
| 2. Performance | **4 / 4** | `<ListaVirtual>` paginado em fatias de 200 itens, `Promise.allSettled` paralelo e zero layout thrashing. |
| 3. Theming | **4 / 4** | Tokens `@ds` respeitados integralmente; `[data-contrast="high"]` sólido em Fontes, Lotes e Detalhe (`06`, `16`, `23`). |
| 4. Responsive Design | **3 / 4** | Zero overflow externo em `1366×768` e `1440×900`, porém `GavetaBuscaFts` comprime `ListaFontes` em `1366×768` (**UI-27**) e `ConstrutorLote` oculta erro fora da dobra (**UI-22**). |
| 5. Implementation Integrity | **2 / 4** | `impeccable detect` limpo (`[]`) e glossário respeitado, porém há 3 bloqueadores funcionais P1 (**UI-21**, **UI-22**, **UI-23**), quebra da *Regra da Luz Única* (**UI-26**) e vazamento de refs/textos internos (**UI-28**). |
| **Total** | **15 / 20** | **Good** *(requer correção dos 3 bloqueadores P1, alvos `< 24 px` e achados P2 antes da aprovação final)*. |

---

## 3. Achados da Onda 2 (`UI-21` em diante)

Categorias: **bloqueador funcional** · **A11y AA** · **visual** · **texto**.

| ID | Sev. | Categoria | Tela / Arquivo | Passo para reproduzir | Captura | Sugestão de correção |
|---|---|---|---|---|---|---|
| **UI-21** | **P1** | bloqueador funcional | `#/projeto/:id/fontes` (`front-v2/src/telas/fontes/Fontes.tsx` L104–116, L179–182, L340–343) | Pressionar `Ctrl+F`, digitar `"frase 142"`, pressionar `Enter` e clicar imediatamente em `Fechar` (ou pressionar `Esc`) antes de `220 ms`: `aoSubmeterBusca` não cancela o `setTimeout` do `useEffect`, e `aoFechar` não limpa `termoBusca`, fazendo a gaveta FTS5 reabrir sozinha logo após ser fechada. | [03-fontes-fts-1366.png](./capturas/onda-2/03-fontes-fts-1366.png) | Cancelar o timer de debounce via `ref` dentro de `aoSubmeterBusca` e `aoFechar`, e limpar/sincronizar o estado da busca pendente ao fechar a gaveta. |
| **UI-22** | **P1** | bloqueador funcional | `#/projeto/:id/fontes?sub=lotes` (`front-v2/src/telas/fontes/ConstrutorLote.tsx` L370–408, L410–587) | Em `1366×768` com `Somente local` ligado, rolar a coluna `Novo Lote de Fontes` até o botão `Iniciar lote com 1 Fonte`, marcar `Groq (remoto)` e clicar em iniciar. O `<BannerErroCore>` (`local_only_violation`) aparece no topo da coluna **fora da área visível**, sem scroll automático nem foco. | [14-lotes-erro-local-only-1366.png](./capturas/onda-2/14-lotes-erro-local-only-1366.png) | Rolar e focar o `<BannerErroCore>` ao definir `erroCriar`, ou posicionar o alerta imediatamente acima do botão de envio `Iniciar lote`. |
| **UI-23** | **P1** | bloqueador funcional | `#/projeto/:id/fontes/:fonteId` (`front-v2/src/telas/fontes/DetalheFonte.tsx` L294–307, L587–598) | Em uma Transcrição parcial (`resume_us > 0`, ex.: Groq que exige retry/consentimento), clicar no botão `Retomar de MM:SS` dentro do banner `<EstadoTela tipo="parcial">` no topo do Leitor. `retomarParcial()` chama `transcription.start` sem tratar `confirmation_required`, `transcription_retry_confirmation` nem `engine_change_confirmation`, exibindo erro em `BannerErroCore` em vez do `<ConfirmDialog>`. | *(inspeção de código — fluxo parcial `DetalheFonte.tsx`)* | Reutilizar o manipulador completo de `PainelMotorSinais` para o CTA `Retomar de MM:SS` do banner parcial, preservando os `<ConfirmDialog>` de custo e troca de Motor. |
| **UI-24** | **P1** | A11y AA | `#/projeto/:id/fontes/:fonteId` (`front-v2/src/telas/fontes/PainelMotorSinais.tsx` L668–679, L747–752, L836–850, L887–889) | Auditar alvos interativos no cartão `Motor de transcrição`: os 2 `button[role="radio"]` (`Local — US$ 0,00` e `Groq remoto`) medem **`18,8 px`** de altura e os 2 links (`Configurar componentes e hardware` e `Configurar chave do Groq`) medem **`17,4 px`** de altura, abaixo do mínimo de `24 px` da WCAG 2.5.8. | [17-detalhe-vazio-motor-1366.png](./capturas/onda-2/17-detalhe-vazio-motor-1366.png), [18-detalhe-groq-custo-1366.png](./capturas/onda-2/18-detalhe-groq-custo-1366.png) | Aplicar `min-h-6` (`24 px`) nos dois `role="radio"`, nos dois `<a>` (`inline-flex min-h-6 items-center`) e no `<summary>Detalhes técnicos</summary>` (L733). |
| **UI-25** | **P2** | A11y AA | `#/projeto/:id/fontes?sub=lotes` (`ListaLotes.tsx` L411) e `#/projeto/:id/fontes` (`ListaFontes.tsx` L718–730) | 1) Na aba `Lotes de Fontes`, a coluna direita renderiza `<h3>Lote #1</h3>` diretamente sob `<h1>Fontes e Transcrição</h1>` sem `<h2>`. 2) Em `ListaFontes`, acima de 30 itens, `<ListaVirtual papel="listbox">` coloca checkboxes e botões dentro de `role="option"`. | [13-lotes-execucao-1366.png](./capturas/onda-2/13-lotes-execucao-1366.png), [15-lotes-budget-uncertain-1440.png](./capturas/onda-2/15-lotes-budget-uncertain-1440.png) | Inserir `<h2 className="sr-only">Lotes do Projeto</h2>` antes da lista em `LotesFontes`/`ListaLotes` e usar `papel="region"` (ou `<ul>`/`<li>`) em `ListaFontes` quando `> 30` itens. |
| **UI-26** | **P2** | visual | `#/projeto/:id/fontes/:fonteId` (`DetalheFonte.tsx` L558–566; `PainelMotorSinais.tsx` L910–921) | Abrir Fonte ainda não transcrita (`?estado=vazio` ou `transcript === null`): `Iniciar transcrição` (esquerda) e `Focar configuração do Motor` (direita) são renderizados simultaneamente com `bg-sinal` (`botoesPrimariosSinal = 2`), violando a *Regra da Luz Única*. | [17-detalhe-vazio-motor-1366.png](./capturas/onda-2/17-detalhe-vazio-motor-1366.png), [18-detalhe-groq-custo-1366.png](./capturas/onda-2/18-detalhe-groq-custo-1366.png) | Rebaixar `Focar configuração do Motor` em `DetalheFonte` para `variante="secundario"` (ou tornar apenas `Iniciar transcrição` primário). |
| **UI-27** | **P2** | visual | `DetalheFonte.tsx` L131; `PainelMotorSinais.tsx` L247–254, L927; `Fontes.tsx` L245–346 + `GavetaBuscaFts.tsx` L61 | 1) Redirecionamento de `fontes/999` exibe toast com ícone `✓` de sucesso (`toast.add` sem `type: 'aviso'`). 2) Em `fontes/4?estado=vazio`, o card `Blocos de 10 min` continua exibindo `6 / 6 blocos salvos`. 3) Em `1366×768`, abrir `GavetaBuscaFts` (`380 px`) esmaga `ListaFontes` para ~`400 px`, quebrando filtros e cabeçalhos de cartão. | [17-detalhe-vazio-motor-1366.png](./capturas/onda-2/17-detalhe-vazio-motor-1366.png), [03-fontes-fts-1366.png](./capturas/onda-2/03-fontes-fts-1366.png) | Usar `type: 'aviso'` no toast de Fonte não encontrada; ocultar/zerar blocos quando `transcriptStatus?.transcript === null`; e em `1366 px`, sobrepor/substituir a lista pela `GavetaBuscaFts` com botão `"Voltar para lista de Fontes"`. |
| **UI-28** | **P2** | texto | `LeitorTranscricao.tsx` L333, L600, L615; `EntradaFonte.tsx` L760; `PlayerReferenciaFonte.tsx` L176; `ConstrutorLote.tsx` L642; `ListaFontes.tsx` L531; `PainelMotorSinais.tsx` L847 | 1) `<Dica>` expõe `#302`, `#307` e `#296`. 2) Toast de undo em outra Fonte mostra `Fonte #4` em vez do nome. 3) `<ConfirmDialog>` de lote exibe `Provedor: legacy` e `US$ 0,00` conflitante. 4) Botão `ListaFontes` renderiza `→ Ir para Cortes →` (seta dupla). 5) Radio `Groq remoto` exibe `~US$ 0,00 – US$ 0,00` para valores `< US$ 0,01`. | [01-fontes-lista-1366.png](./capturas/onda-2/01-fontes-lista-1366.png), [12-lotes-montar-custo-1366.png](./capturas/onda-2/12-lotes-montar-custo-1366.png), [17-detalhe-vazio-motor-1366.png](./capturas/onda-2/17-detalhe-vazio-motor-1366.png) | Remover `#296`/`#302`/`#307` de tooltips visíveis; resolver nome da Fonte no toast e `"Perfil configurado"` no lugar de `'legacy'`; remover `"→"` redundante do texto em `ListaFontes`; e exibir `< US$ 0,01` quando `microUsd > 0 && microUsd < 10_000`. |
| **UI-29** | **P3** | A11y AA | `#/projeto/:id/fontes/:fonteId` (`front-v2/src/telas/fontes/LeitorTranscricao.tsx` L427–435, L617–625) | Pressionar `→` na última palavra visível da janela virtualizada (ou `←` na primeira) não avança para a Frase seguinte/anterior porque `moverParaPalavraPorOffset` busca apenas `button[data-word]` atualmente montados no DOM. Além disso, o botão `Refazer` omite o prop `atalho` (`Ctrl+Shift+Z`). | [20-detalhe-leitor-1366.png](./capturas/onda-2/20-detalhe-leitor-1366.png), [22-detalhe-leitor-1440.png](./capturas/onda-2/22-detalhe-leitor-1440.png) | Ao atingir a borda dos botões montados no `<ListaVirtual>`, rolar para `row ± 1` e focar a palavra adjacente após o render; adicionar `atalho={formatarTecla('Mod+Shift+Z')}` em `Refazer`. |

---

## 4. Inventário das capturas PNG (`docs/produto/front-v2/ui/capturas/onda-2/`)

Total: **23 arquivos** gerados por `front-v2/e2e/ui-onda2.spec.ts` (`$env:UI_BASELINE = "1"`).

| Arquivo | Tela / Estado | Viewport / Tema | Sustenta |
|---|---|---|---|
| `01-fontes-lista-1366.png` | `#/projeto/.../fontes` (lista com `changed`, `offline`, `mismatch`, `available`) | `1366×768` · padrão | Fluxo (e) e UI-28 |
| `02-fontes-vazio-1366.png` | `#/projeto/.../fontes?estado=vazio` | `1366×768` · padrão | Fluxo (e) estado vazio |
| `03-fontes-fts-1366.png` | Busca FTS5 `frase 142` com `<GavetaBuscaFts>` aberta | `1366×768` · padrão | Fluxo (e), UI-21, UI-27 |
| `04-fontes-excluir-dialog-1366.png` | `<ConfirmDialog>` `Excluir Fonte — offline.mp4?` | `1366×768` · padrão | Fluxo (e) foco em Cancelar |
| `05-fontes-lista-1440.png` | Lista após relocalizar V1 e selecionar 2 Fontes para lote | `1440×900` · padrão | Fluxo (e) responsivo |
| `06-fontes-lista-hc-1366.png` | `#/projeto/.../fontes` em alto contraste | `1366×768` · `[data-contrast="high"]` | Fluxo (e) WCAG AA |
| `07-entrada-local-inspecao-1366.png` | Arquivo local multipista OBS + `CampoPermissao` `granted` | `1366×768` · padrão | Fluxo (f) entrada local |
| `08-entrada-url-termos-1366.png` | Modo `URL (VOD)` + `<ConfirmDialog>` Termos do YouTube | `1366×768` · padrão | Fluxo (f) termos |
| `09-entrada-url-jit-1366.png` | Erro `js_runtime_missing` + `<InstaladorJustInTime>` inline | `1366×768` · padrão | Fluxo (f) JIT sem CTA duplicado |
| `10-entrada-url-erro-idade-1366.png` | Erro `age_restricted` com CTA `Importar arquivo local` | `1366×768` · padrão | Fluxo (f) recuperação de erro |
| `11-entrada-jit-1440.png` | `<InstaladorJustInTime>` com tamanho, licença e origem | `1440×900` · padrão | Fluxo (f) aviso antes de ação externa |
| `12-lotes-montar-custo-1366.png` | `<ConfirmDialog>` com `<ResumoCustoPrivacidade>` ao criar lote Groq | `1366×768` · padrão | Fluxo (g) e UI-28 |
| `13-lotes-execucao-1366.png` | `Lote #1` em execução com `<TabelaGrade>` | `1366×768` · padrão | Fluxo (g) e UI-25 |
| `14-lotes-erro-local-only-1366.png` | Erro `local_only_violation` fora da dobra no `ConstrutorLote` | `1366×768` · padrão | Fluxo (g) e UI-22 |
| `15-lotes-budget-uncertain-1440.png` | `Lote #2` `budget_paused` + `timeout_uncertain` | `1440×900` · padrão | Fluxo (g) e UI-25 |
| `16-lotes-hc-1440.png` | Tela Lotes de Fontes em alto contraste | `1440×900` · `[data-contrast="high"]` | Fluxo (g) WCAG AA |
| `17-detalhe-vazio-motor-1366.png` | `#/projeto/.../fontes/4?estado=vazio` (Motor Local + VAD `#279`) | `1366×768` · padrão | Fluxo (h), UI-24, UI-26, UI-27, UI-28 |
| `18-detalhe-groq-custo-1366.png` | Motor `Groq remoto` com `<ResumoCustoPrivacidade>` | `1366×768` · padrão | Fluxo (h), UI-24, UI-26 |
| `19-detalhe-blocos-progresso-1366.png` | Transcrição em andamento com blocos de 10 min e amostra 30 s | `1366×768` · padrão | Fluxo (h) blocos e cancelamento |
| `20-detalhe-leitor-1366.png` | Leitor virtualizado com palavra corrigida (`CorrigidaUI`) e `Silêncio` | `1366×768` · padrão | Fluxo (h) e UI-29 |
| `21-detalhe-erro-offline-1366.png` | `?estado=offline` (player bloqueado + Leitor editável) | `1366×768` · padrão | Fluxo (h) erro/offline |
| `22-detalhe-leitor-1440.png` | Detalhe completo da Fonte com blocos e Leitor `≤ 72 ch` | `1440×900` · padrão | Fluxo (h) e UI-29 |
| `23-detalhe-hc-1440.png` | Detalhe completo da Fonte em alto contraste | `1440×900` · `[data-contrast="high"]` | Fluxo (h) WCAG AA |
