# Pacote D — Corte: Editar (`<ContextoCorte>` e `#/projeto/:id/corte/:corteId/editar`)

Especificação detalhada da Fase 3 do front v2 para o pacote **D. Corte: Editar**, herdando o shell global, o modelo de 6 estados de tela, o mapeador central de `CoreError.code`, o `<ResumoCustoPrivacidade>`, o store único de `core-progress` e o mapa de atalhos de [01-arquitetura.md](../01-arquitetura.md).

---

## Escopo e fronteiras com outros pacotes

* **De onde vem:** da bancada de revisão em `#/projeto/:id/cortes/revisao/:runId` (Pacote C) ou da mesa de prontidão em `#/projeto/:id/exportacao` (Pacote F).
* **O que cobre:**
  1. **Superfície 1 — Cabeçalho `<ContextoCorte>` e Exportação Individual:** barra de contexto do Corte presente nas sub-rotas `#/projeto/:id/corte/:corteId/*` (navegação entre Cortes aprovados, tipo do Corte e ação discreta de conversão, sub-abas do Corte e diálogo/acompanhamento de exportação individual via `Ctrl/Cmd+E`).
  2. **Tela 2 — Sub-aba `Editar` (`#/projeto/:id/corte/:corteId/editar`):** bancada com 4 zonas acopladas (Transcrição + Índice do Corte à esquerda, Palco 9:16 com legendas ao vivo ao centro, Inspetor em 5 abas à direita e Timeline do proxy na base), mais o ciclo de vida completo da sessão de edição.
* **Fronteiras:**
  * Sub-abas `Transformar` e `Empacotar` pertencem ao **Pacote E** (aqui apenas suas entradas no `<ContextoCorte>` e a guarda que oculta `Transformar` em **Corte direto**).
  * Exportação em lote (`export.batch.*`) e Gaveta Global da Fila de Jobs pertencem ao **Pacote F** (aqui apenas a exportação individual `export.start` / `export.status` e a leitura do store global de fila).
  * Importação, hash e relocalização de Fontes pertencem ao **Pacote B** (aqui o editor aciona relocalização apenas como recuperação quando a Fonte está `offline`/`changed`).
* **Lógica pura reaproveitável da v1 (sem acoplamento de layout):**
  * [cropMath.ts](../../../../src/features/editor/cropMath.ts) — resolução e interpolação de crop 9:16 e layouts duplos (`gameplay_webcam`, `two_people`), espelhando `core/src/editor/crop.rs`.
  * [timelineMath.ts](../../../../src/features/editor/timelineMath.ts) — conversões `usToPx`/`pxToUs`, `sourceToSplicedUs`/`splicedToSourceUs`, janela visível, busca de Frase e curva `nextRate` (`J`/`K`/`L`).
  * [duckingMath.ts](../../../../src/features/editor/duckingMath.ts) — cálculo de ducking (`-12 dB`, ataque `40 ms`, liberação `300 ms`), fades e loop de trilha sonora na prévia.
  * [render.ts](../../../../src/features/captions/render.ts) e [types.ts](../../../../src/features/captions/types.ts) — carregamento das fontes `Noto Sans` / `Noto Serif` e rasterização CSS no canvas lógico `1080×1920` com paridade `libass`.

---

## Ciclo de vida transversal da sessão de edição

Antes das duas superfícies, esta seção fixa o contrato obrigatório de sessão para `Editar` (e transições iniciadas por `<ContextoCorte>`):

1. **Abertura (`editor.open`):**
   * Ao montar `#/projeto/:id/corte/:corteId/editar`, a UI chama `editor.open` (`source_id`, `start_id`, `end_id`, `candidate_id?`) e, em seguida/paralelo, carrega `editor.sentences`, `export.captions`, `audio.list`, `translation.get`, `captions.remap_status` e `proxy.request` (seguido de `editor.timeline` → `editor.timeline_status` → `editor.wave` assim que o proxy estiver `ready`).
   * **Modo somente-leitura por Fonte `offline` / `changed` (ADR-0005):** se a Fonte estiver `offline` ou `changed`, a tela **abre normalmente** para leitura da Transcrição, inspeção do Índice do Corte, silêncios e ajustes de bordas por Frase (sem PCM), exibindo banner persistente de relocalização (`sources.relocate` / `sources.hash`) e bloqueando o player de vídeo, geração de proxy/timeline, YuNet e exportação.
2. **Prévias contínuas vs. confirmação (`preview`):**
   * Durante arrastos de mouse/toque ou deslizamento de controles contínuos (`editor.adjust`, `editor.silences.detect`, `editor.crop.set_layout` ao variar `splitRatio`, `editor.crop.set_edits`, `editor.montage.set_start`, `editor.audio.soundtrack.set`, `editor.audio.sfx.update`), a UI envia `preview: true` (o núcleo calcula o estado sem empilhar `undo` nem marcar `dirty`).
   * Ao soltar o ponteiro (ou após confirmação por teclado), envia `preview: false` para gravar o passo na pilha `undo` e marcar o Corte como `dirty`.
3. **Autosave (`1 s`) e `editor.flush`:**
   * O núcleo verifica em background (a cada `50 ms`) se algum Corte `dirty` completou `1 s` sem novas edições e grava no SQLite (`clip_edits` + até 20 cópias em `clip_snapshots`), emitindo `core-progress` com `job: "editor:<clip_id>"` e `stage: "editor_saved"` (ou `job: "editor"`, `stage: "editor_save_failed"`).
   * A Barra de Status do Shell exibe sempre o estado real: `Salvo` | `Alterações pendentes…` | `Salvando…` | `Falha ao salvar (tentar novamente)`.
   * **`Ctrl/Cmd+S`** chama `editor.flush` imediatamente.
4. **Saída da rota e fechamento da janela (tratamento de falha do `editor.flush`):**
   * Antes de desmontar `Editar` (trocar para `Anterior`/`Próximo aprovado`, ir para `Transformar`/`Empacotar`, voltar para `Cortes`/`Exportação` ou trocar/fechar Projeto via `projects.close`), a UI executa `await dispatchCore('editor.flush', {})`.
   * **Se `editor.flush` falhar na navegação SPA:** a navegação é **cancelada** e um `<ConfirmDialog>` (`role="alertdialog"`) mantém o usuário no editor com a explicação traduzida do `CoreError` (`project_write`, `insufficient_space`, `project_busy`), oferecendo três ações explícitas:
     1. **"Tentar salvar novamente"** *(primário — rechama `editor.flush` e, se passar, conclui a navegação pendente)*;
     2. **"Continuar editando"** *(fecha o diálogo e devolve o foco ao editor)*;
     3. **"Sair descartando alterações não salvas"** *(ação secundária de perigo, com aviso explícito de perda do último rascunho não gravado, para nunca prender o usuário em loop caso o disco esteja bloqueado)*.
   * **Se `editor.flush` falhar ao fechar a janela do SO (`WindowEvent::CloseRequested`):** `src-tauri/src/main.rs` bloqueia o fechamento (`api.prevent_close()`) e emite `editor_save_failed`, abrindo o mesmo diálogo acionável na tela.
5. **Desfazer e refazer por Corte vs. ações fora da pilha:**
   * **`editor.undo` / `editor.redo` (`Ctrl/Cmd+Z` / `Ctrl/Cmd+Shift+Z`):** atuam na pilha do **Corte atual** (máximo de `100` entradas combinadas em `clip_edits`): bordas, silêncios, layout/`splitRatio`/keyframes manuais de crop, inícios manuais de Narração, trilha sonora e SFX.
   * **Separação da pilha da Transcrição:** quando o foco está dentro da edição/leitura da Transcrição (`transcription.correct`), `Ctrl/Cmd+Z` / `Ctrl/Cmd+Shift+Z` acionam `transcription.undo` / `transcription.redo` (pilha global do Projeto). O tooltip e a Barra de Status explicitam o escopo ativo (`Desfazer edição do Corte` vs. `Desfazer correção da Transcrição`).
   * **Ações que NÃO entram no `undo` do Corte e como sinalizá-las:**
     * `editor.crop.set_suggested` (aplicar sugestão automática do YuNet) e `editor.crop.example`: substituem `crop.suggested` (e `layout`/`splitRatio` em layouts duplos) sem entrar em `EditSnapshot` e **sem apagar `crop.edits`**. **Sinalização obrigatória:** aviso inline antes de aplicar (*"Substitui apenas a sugestão automática; suas correções manuais serão mantidas. Esta ação não entra no Desfazer."*) e toast `role="status"` ao concluir (*"Sugestão automática aplicada (não entra no Desfazer)."*).
     * Mutações de legenda e tradução (`captions.style.*`, `captions.override`, `captions.track.set`, `translation.*`): gravam imediatamente em tabelas próprias fora de `clip_edits`. **Sinalização obrigatória:** nota discreta no rodapé da aba `Legendas e Tradução` (*"Estilo, destaques e tradução são salvos automaticamente e não usam o Desfazer da timeline"*) + botão direto **"Reverter para preset"** / **"Limpar destaque"**.

---

## Superfície 1 — Cabeçalho `<ContextoCorte>` e Diálogo de Exportação Individual

### 1. Objetivo e navegação

Situar o usuário dentro de um Corte aprovado, permitindo navegar entre os Cortes aprovados sem voltar à lista, alternar entre as sub-abas do Corte, converter um **Corte direto** em **Vídeo transformado** e disparar/acompanhar a exportação MP4 individual.

* **De onde chega:** ao abrir qualquer Corte aprovado em `#/projeto/:id/cortes/revisao/:runId` ou `#/projeto/:id/exportacao`.
* **Rotas que o exibem:** `#/projeto/:id/corte/:corteId/editar`, `#/projeto/:id/corte/:corteId/transformar`, `#/projeto/:id/corte/:corteId/empacotar`.
* **Para onde vai:**
  * `< Anterior` / `Próximo aprovado >`: mesmo sufixo de sub-aba no Corte vizinho (se mudar para um **Corte direto** estando em `Transformar`, cai na guarda de rota e redireciona para `Editar`).
  * Sub-abas: `Editar` | `Transformar` *(apenas se `videoKind === 'transformed'`)* | `Empacotar`.
  * Voltar para `2. Cortes` ou `3. Exportação` via barra superior do Shell (com `editor.flush` se estiver em `Editar`).

### 2. Layout por zonas

**1366 px** *(notebook alvo — linha única compacta abaixo ou integrada ao segundo nível da barra superior, sem quebra de linha)*:

```text
+---------------------------------------------------------------------------------------------------+
| [<- Cortes]  Corte 2/8: "Como o streamer reagiu..."  [Corte direto v]  (Converter p/ transformado)|
|              [< Anterior] [Proximo >]   |  (Editar)  [Empacotar]  |   [Exportar Corte (Ctrl+E)]   |
+---------------------------------------------------------------------------------------------------+
```
*(Em 1366 px, se o título for longo, ele trunca com reticências mantendo sempre visíveis: posição `2/8`, setas `< Anterior` / `Próximo >`, selo do tipo + ação discreta, sub-abas e botão `Exportar Corte`.)*

**1440+ px** *(linha única folgada)*:

```text
+-------------------------------------------------------------------------------------------------------------+
| [<- Cortes] | < Anterior | Corte 2/8: "Como o streamer..." | Proximo > | [Video transformado] | [Editar][Transformar][Empacotar] | [Exportar Corte] |
+-------------------------------------------------------------------------------------------------------------+
```

**Diálogo de Exportação Individual** *(aberto sobre a tela via botão `Exportar Corte` ou `Ctrl/Cmd+E`)*:

```text
+-----------------------------------------------------------------------+
| Exportar Corte em MP4 (1080x1920)                                 [X] |
+-----------------------------------------------------------------------+
| Conferencia pre-exportacao (guardrails.check)                         |
|  [OK] Permissao registrada ("Criador X - YouTube")                    |
|  [!]  Aviso de Corte direto: monetizacao pode ser recusada [Entendi]  |
|  [!]  1 trilha sonora com licenca "Desconhecida"                      |
|  [OK] Legenda sem glifos ausentes                                     |
+-----------------------------------------------------------------------+
| Pasta e nome do arquivo (export.settings):                            |
|  [ C:\Users\...\Videos\Clipes\corte-02-reacao.mp4     ] [Escolher...] |
+-----------------------------------------------------------------------+
|                                       [Cancelar]  [Iniciar exportacao]|
+-----------------------------------------------------------------------+
```

### 3. Conteúdo e componentes

* **Trilha de contexto:** botão discreto `Voltar para Cortes` (`#/projeto/:id/cortes`), título curto derivado da 1ª Frase do Corte (ou título de Empacotamento se já existir), contador `tabular-nums` (`i / N` dos Cortes aprovados).
* **Navegação entre aprovados:** botões `< Anterior` e `Próximo aprovado >` (desabilitados nos extremos ou com tooltip indicando o título do vizinho).
* **Tipo do Corte e ação discreta de conversão:**
  * `<Status>` com rótulo canônico **Corte direto** ou **Vídeo transformado**.
  * Quando **Corte direto**: botão discreto de link/fantasma *"Converter em Vídeo transformado"* (com tooltip explicando que habilita a sub-aba `Transformar`: Ângulo, Roteiro e Narração; **hoje bloqueado/desabilitado por lacuna do núcleo** — ver Seção 9).
* **Sub-abas do Corte (`nav` semântica com `aria-current="page"`):**
  * `Editar` (`#/projeto/:id/corte/:corteId/editar`)
  * `Transformar` (`#/projeto/:id/corte/:corteId/transformar`) — **omitida** quando `videoKind === 'direct'`.
  * `Empacotar` (`#/projeto/:id/corte/:corteId/empacotar`)
* **Gatilho e Diálogo de Exportação Individual:**
  * Botão primário compacto `Exportar Corte` (`Ctrl/Cmd+E`).
  * Ao abrir: chama `editor.flush` (se estiver em `Editar` e `dirty`), `guardrails.check { scope: "single", source_id, candidate_id, clip_id, start_id, end_id }`, `export.captions` (lê `missingGlyphs` e `emojiRemoved`), e `export.settings` (`last_directory`).
  * Checklist informativo (não bloqueante, exceto glifos faltando ou erro de destino/arquivo existente): exibe status de Permissão, aviso único de **Corte direto** (`needsDirectNotice` com botão *"Entendi o risco"* → `guardrails.ack_direct_notice`), risco de licença `unknown` no áudio (`audio.unverifiedCount`), duração > 60 s (`over60s`), `narration.longFreezeTail`, e lista de `missingGlyphs` (se houver, exibe link *"Corrigir palavras na Transcrição"* para resolver antes de exportar).
  * Campo editável de caminho destino (pré-preenchido com `last_directory` + nome sanitizado via `exportFilename`) + botão nativo `Escolher arquivo` (`@tauri-apps/plugin-dialog` `save`; editável diretamente no navegador/mock para testes E2E).
  * Quando há exportação em andamento para este Corte: barra de progresso inline no diálogo/cabeçalho (`1%–99%`) com `Cancelar` (`jobs.cancel { id: job }`); ao concluir, link `Abrir arquivo` / `Abrir pasta` e banner se houve fallback de encoder para CPU.

### 4. Ações

| Ação | Comando(s) do núcleo | Pré-condições | Confirmação / Custo | O que muda na tela | Desfazer |
|---|---|---|---|---|---|
| Ir para Corte anterior / próximo | `editor.flush` *(se em `Editar`)* + navegação de rota | Haver outro Corte aprovado | Se `editor.flush` falhar, `<ConfirmDialog>` bloqueante | Troca `:corteId` mantendo a sub-aba (ou cai para `Editar` se `direct` em `Transformar`) | Não |
| Trocar sub-aba (`Editar`/`Transformar`/`Empacotar`) | `editor.flush` *(ao sair de `Editar`)* | Para `Transformar`, `videoKind === 'transformed'` | Se `editor.flush` falhar, `<ConfirmDialog>` bloqueante | Navega para a sub-aba alvo | Não |
| Converter Corte direto em Vídeo transformado | *(Lacuna: comando inexistente — ver Seção 9)* | `videoKind === 'direct'` | `<ConfirmDialog>` explicando que habilitará Ângulo, Roteiro e Narração | Exibiria sub-aba `Transformar` e atualizaria o `<Status>` | Não |
| Abrir diálogo de exportação individual (`Ctrl/Cmd+E`) | `editor.flush` *(se sujo)*, `guardrails.check`, `export.captions`, `export.settings` | Projeto aberto; Fonte online | Nenhuma (gratuito/local) | Abre modal pré-exportação com checklist e destino sugerido | Não |
| Confirmar ciência de risco do Corte direto | `guardrails.ack_direct_notice` | `needsDirectNotice === true` | Clique explícito no aviso do checklist | Marca `directMonetizationAck: true` no Perfil de canal e recolhe o aviso | Não |
| Iniciar exportação individual | `export.start` | Fonte online/íntegra; sem `missingGlyphs`; caminho `.mp4` inédito; FFmpeg instalado | Diálogo pré-exportação (se `export_exists`, pede outro nome) | Fecha ou alterna modal para progresso `queued`/`running`; adiciona job à Fila Global | Cancelar via `jobs.cancel` |
| Consultar resultado / cancelar exportação | `export.status`, `jobs.cancel` | `job` criado por `export.start` | Nenhuma | Atualiza barra de progresso; ao concluir mostra caminho salvo (e aviso se caiu para CPU) | Não |

### 5. Estados

* **`loading`:** enquanto `guardrails.check` / `export.captions` / `export.settings` carregam no diálogo, exibe `<Esqueleto variante="linhas" />` no corpo do modal (botão `Iniciar exportação` desabilitado até carregar). No `<ContextoCorte>`, enquanto a lista de aprovados resolve, mostra esqueleto discreto no lugar do título e contador.
* **`empty`:** se o Corte foi removido ou não está aprovado na execução, a guarda de rota redireciona para `#/projeto/:id/cortes` com toast explicativo (`"Este Corte não está disponível para edição."`).
* **`error` (mapeamento `CoreError.code` → PT-BR):**
  * `source_offline` / `source_changed`: *"O arquivo da Fonte foi movido ou alterado. Relocalize a Fonte antes de exportar."* → botão **"Relocalizar Fonte"** (`sources.relocate`).
  * `export_exists`: *"Já existe um arquivo com esse nome na pasta escolhida."* → foca o campo de nome para alterar sem perder o estado.
  * `export_destination`: *"Escolha uma pasta existente e um nome terminado em `.mp4`."* → foca campo de destino.
  * `export_glyph_missing`: *"A fonte da legenda não possui alguns caracteres usados no texto (`<lista>`)."* → botão **"Editar texto na Transcrição"**.
  * `component_missing`: *"O FFmpeg precisa estar instalado para exportar vídeos."* → botão **"Instalar FFmpeg"** (`components.download` / `#/config/componentes`).
  * `export_ass_missing` / `export_font_missing` / `export_failed`: *"Não foi possível renderizar o vídeo com as legendas atuais."* → botão **"Ver detalhe técnico"** / **"Abrir Relatos"**.
  * `audio_asset_missing`: *"Uma trilha sonora ou efeito sonoro deste Corte não foi encontrado na pasta do Projeto."* → botão **"Abrir aba Áudio e SFX"**.
  * `export_bounds` / `export_candidate`: *"As bordas ou a aprovação deste Corte mudaram."* → botão **"Voltar para Cortes"**.
* **`job_running`:** durante `export.start` (`queued`/`running`), exibe progresso `tabular-nums` (`1%–99%`), botão **"Cancelar exportação"** (`jobs.cancel`) e permite fechar o modal mantendo o job ativo na Fila Global do Shell.
* **`partial` / aviso pós-render:** se houver queda do encoder de hardware para CPU (`encoder_fallback`), exibe `<Status tom="aviso">` *"A exportação usou a CPU porque o encoder de placa de vídeo falhou."* *(depende de fix do núcleo — Seção 9)*.

### 6. Eventos (`core-progress`)

* Escuta via Store Global de Fila:
  * `stage === "export"` (`1%–99%`) para o `job` do Corte atual → atualiza barra do diálogo e chip de status.
  * `stage === "complete"` (`100%`) / `stage === "failed"` (`0%`) → chama `export.status { job }`, exibe toast não-bloqueante *"Corte exportado com sucesso"* com ação *"Abrir pasta"* (ou alerta com `CoreError` traduzido).

### 7. Teclado e acessibilidade

* **Região `F6`:** `<ContextoCorte>` integra a região de cabeçalho/sub-navegação da janela (logo após a Barra Superior).
* **Sub-abas:** `<nav aria-label="Etapas do Corte">` com links reais `#/projeto/:id/corte/:corteId/...` e `aria-current="page"` na sub-aba ativa.
* **Atalhos:** `Ctrl/Cmd+E` abre o diálogo de exportação individual (registrado via `useComandos` e visível na Paleta `Ctrl/Cmd+K`). **Não** usa `[`/`]` para anterior/próximo (reservados na arquitetura para `Ctrl+[` e `Ctrl+]` dos painéis).
* **Alvos e foco:** botões `< Anterior`, `Próximo >` e sub-abas têm altura/largura mínima `≥ 24×24 px` e classe `.foco`; modal de exportação usa `@base-ui/react/dialog` com *focus trap* e retorno do foco ao botão `Exportar Corte` ao fechar.

### 8. US do #26 atendidas

* **US-87** (tipo Vídeo transformado sempre visível), **US-102** (aviso único de monetização do Corte direto), **US-103** (checklist de originalidade antes de exportar), **US-104** (aviso de música sem licença verificada), **US-105** (orientação de divulgação de IA), **US-106** (exportação individual `1080×1920`), **US-108** (normalização `-14 LUFS`), **US-109** (exportação limpa sem marca d'água).

### 9. Lacunas

* **Núcleo Rust:**
  1. **Conversão individual `Corte direto → Vídeo transformado`** (`01-arquitetura.md` Seção 11, item 2): `videoKind` está preso em `selection_runs`; falta comando (ex.: `selection.candidate.set_kind`) para converter um Corte individual sem refazer a seleção inteira. Enquanto não existir, o botão *"Converter em Vídeo transformado"* fica desabilitado com explicação breve.
  2. **`export.status` sem `encoder_fallback`** (`01-arquitetura.md` Seção 11, item 1 / `core/src/export.rs:1125-1138`): o SQL lê `encoder`, `fallback_from` e `fallback_reason`, mas o JSON não serializa `encoder_fallback`, impedindo o aviso real na exportação individual.
* **Mock TS (`src/lib/core.ts` / `src/features/export/mock.ts`):**
  1. Implementar ramo explícito para `export.status` no mock de exportação (com suporte opcional a `?estado=fallback` para testar o aviso de CPU).
  2. Emitir eventos `core-progress` (`export` → `complete`/`failed`) no mock ao chamar `export.start`.

### 10. Critérios de aceite (E2E / Playwright com mock)

1. Em `#/projeto/:id/corte/:corteId/editar` para um **Corte direto**, a sub-aba `Transformar` não aparece no `<ContextoCorte>` e o selo exibe `"Corte direto"`.
2. Para um **Vídeo transformado**, as três sub-abas `Editar`, `Transformar` e `Empacotar` aparecem, com `aria-current="page"` na sub-aba ativa.
3. Clicar em `Próximo aprovado >` quando há alterações não salvas dispara `editor.flush` antes de trocar o `:corteId` na URL.
4. Pressionar `Ctrl/Cmd+E` abre o diálogo de exportação individual com o checklist de `guardrails.check` carregado e o campo de caminho pré-preenchido por `export.settings`.
5. Quando `needsDirectNotice === true`, clicar em `"Entendi o risco"` chama `guardrails.ack_direct_notice` e atualiza o item do checklist sem fechar o diálogo.
6. Quando `export.captions` retorna `missingGlyphs` não vazio, o botão `"Iniciar exportação"` informa os caracteres ausentes e oferece acesso à correção antes de enfileirar.
7. Confirmar exportação válida chama `export.start`, exibe barra de progresso via `core-progress` (`stage: "export"`) e botão `"Cancelar exportação"` (`jobs.cancel`), encerrando com status de conclusão.

---

## Tela 2 — Sub-aba `Editar` (`#/projeto/:id/corte/:corteId/editar`)

### 1. Objetivo e navegação

Refinar um Corte aprovado em quatro zonas sincronizadas — ajustando bordas por Frase ou quadro, revisando silêncios com preservação de respiro, configurando enquadramento 9:16 (manual ou com YuNet *just-in-time*), estilizando/traduzindo legendas e mixando Narração, trilha sonora e SFX — com salvamento contínuo e desfazer por Corte.

* **De onde chega:** de `#/projeto/:id/cortes/revisao/:runId` (`Enter` ou *"Editar Corte"*), do `<ContextoCorte>` de outro Corte, de `Transformar` / `Empacotar`, ou da Mesa de Prontidão (`#/projeto/:id/exportacao`).
* **Guarda de entrada:** sem Projeto aberto → `#/inicio`; Corte ausente ou não aprovado → `#/projeto/:id/cortes`; Fonte `offline`/`changed` → abre em modo somente-leitura de texto/bordas com banner de relocalização.
* **Para onde vai:** `Transformar` *(se Vídeo transformado)*, `Empacotar`, outro Corte via `<ContextoCorte>`, ou retorno a `Cortes` / `Exportação` (sempre executando `editor.flush` antes de desmontar).

### 2. Layout por zonas

**1366 px *(notebook alvo — regra obrigatória: UM painel lateral acoplado por vez)*:**

Abrir o painel esquerdo (`Ctrl/Cmd+[`) recolhe automaticamente o painel direito (`Ctrl/Cmd+]`) e vice-versa, preservando o Palco 9:16 sempre visível e nunca coberto por *hover*. Abaixo um exemplo com o Inspetor aberto (ou com a Transcrição aberta quando alternado):

```text
+---------------------------------------------------------------------------------------------------+
| Shell: Barra Superior + <ContextoCorte>                                                           |
+------+---------------------------------------------------------+----------------------------------+
| [>]  | Palco (9:16 | Fonte 16:9)     [Transcrição] [Inspetor*] | Inspetor:                        |
| Tran |                                                         | [Enquadr.][Legendas][Silencios]  |
| scri |              +-----------------------+                  | [Audio/SFX][Historico]           |
| ção  |              |                       |                  | -------------------------------- |
|      |              |     Preview 9:16      |                  | Conteudo da aba selecionada      |
| recol|              |   + legenda ao vivo   |                  | (rolagem interna exclusiva       |
| hida |              |                       |                  |  desta coluna)                   |
|      |              +-----------------------+                  |                                  |
| (Ctr |                                                         |                                  |
| l+[) | [|<] [J] [Play/Pause] [L] [>|] 00:14.2/00:42.5 [I] [O]  |                                  |
+------+---------------------------------------------------------+----------------------------------+
| Timeline do proxy (+-2 min):                                                                      |
| [-1F][+1F] Entrada | Duracao efetiva: 00:38.4 (-4.1s silencios) | [-1F][+1F] Saida | Zoom [-][+]  |
| Mini-mapa: [===========|####Corte####|==========================]  (janela +-2 min)               |
| Regua:     00:00       00:10       00:20       00:30       00:40                                  |
| Video:     [t0][t1][t2][In||===miniaturas do proxy===||Out][t8][t9]                               |
| Audio:     ~~~|||||~~~[///silencio///]||||||~~~~[///silencio///]~~~                               |
| Frases:    [Frase 12        ][Frase 13             ][Frase 14     ]   Keyframes: <>   <>          |
| Narracao*: [Bloco 1: Intro   ]  [Bloco 2 (empurrado +0.3s)  ] [Cauda congelada]                   |
| Audio/SFX: [===Trilha (ducking -12 dB sob fala)===]  (*) SFX 1   (*) SFX 2                        |
+---------------------------------------------------------------------------------------------------+
| Shell: Barra de Status (Salvo | Desfazer Corte: 3 | F6 trocar regiao | Ctrl+[ / Ctrl+] paineis)   |
+---------------------------------------------------------------------------------------------------+
```
*(\* Faixa `Narração` na Timeline é exibida apenas em **Vídeo transformado** com montagem existente).*

**1440+ px *(ambos os painéis acoplados abertos simultaneamente, cada um colapsável por clique ou `Ctrl/Cmd+[` e `Ctrl/Cmd+]`)***:

```text
+-------------------------------------------------------------------------------------------------------------+
| Shell: Barra Superior + <ContextoCorte>                                                                     |
+------------------------------+------------------------------------------+-----------------------------------+
| Painel Esquerdo (acoplado)   | Palco Central                            | Painel Direito: Inspetor (5 abas) |
| [Transcricao | Indice Corte] |  [Previa 9:16 | Fonte 16:9]              | [Enquadr.][Legendas][Silencios]   |
| [Buscar no Corte... Ctrl+F]  |       +------------------------+         | [Audio/SFX][Historico]            |
|                              |       |   Preview 9:16         |         | --------------------------------- |
| Frase 12 (fora - atenuada)   |       |   + legenda ao vivo    |         | Controles da aba ativa            |
| Frase 13 [ativo]             |       |                        |         | (rolagem interna)                 |
|  palavra1 [~pausa 0.8s~] ... |       +------------------------+         |                                   |
|  (F2/Enter corrige grafia)   | [|<][J][Play][L][>|] 00:14.2 [I] [O]     |                                   |
+------------------------------+------------------------------------------+-----------------------------------+
| Timeline do proxy em largura total (Mini-mapa + Regua + Video + Onda/Silencios + Frases + Narracao + SFX)  |
+-------------------------------------------------------------------------------------------------------------+
| Shell: Barra de Status                                                                                      |
+-------------------------------------------------------------------------------------------------------------+
```

* **O que rola e o que fica fixo:** a moldura externa do app nunca rola (`100vw × 100vh`); apenas o corpo da coluna `Transcrição / Índice do Corte` (virtualizado), o corpo da aba ativa do `Inspetor` e o viewport horizontal da `Timeline` quando com zoom rolam internamente.

### 3. Conteúdo e componentes por zona

#### Zona 1 — Painel Esquerdo: Transcrição do Corte e Índice do Corte
* **Seletor segmentado no topo:** `Transcrição` | `Índice do Corte`.
* **Visão `Transcrição`** (alimentada por `editor.sentences`, `export.captions.words`, `editor.silences`, `editor.open`):
  * Filtro/busca local (`Ctrl/Cmd+F`) destacando ocorrências nas Frases da janela ±2 min do Corte.
  * Exibe Frases dentro do Corte em destaque normal e Frases vizinhas (antes de `start_id` e depois de `end_id`, dentro da janela do proxy) atenuadas para facilitar estender o Corte sem sair da tela.
  * Palavra tocada pelo playhead recebe marcador visual + de leitor de tela; clicar numa palavra posiciona a agulha (`seek`).
  * `F2` ou `Enter` na palavra focada abre edição inline (`transcription.correct`): salva texto normalizado sem mexer em timestamps nem bordas, atualiza Frase, FTS5 e `export.captions`.
  * Trechos de silêncio detectado entre palavras aparecem inline com **texto/símbolo tachado + padrão hachurado + duração** (ex.: `[pausa 0,9 s removida]`), com botão rápido de restaurar/remover (`editor.silences.toggle`).
  * Palavras com baixa confiança (quando fornecido nos dados da palavra) exibem sublinhado pontilhado + ícone discreto (nunca só cor).
  * Ações contextuais na palavra selecionada (botão de menu da palavra ou menu de contexto): *"Definir Entrada aqui"* (`editor.adjust`), *"Definir Saída aqui"* (`editor.adjust`), *"Personalizar estilo da palavra"* (abre `Legendas` focado em `captions.override`), *"Ancorar SFX nesta palavra"* (`editor.audio.sfx.add`).
* **Visão `Índice do Corte`** (equivalente textual completo da Timeline para teclado/leitor de tela):
  * Filtros rápidos: `Tudo`, `Frases`, `Silêncios`, `Enquadramento`, `Narração`, `Áudio e SFX`.
  * Lista virtualizada semântica (`<ListaVirtual>`) onde cada linha mostra tipo (ícone + rótulo), timecode `tabular-nums`, descrição e ações por teclado: saltar agulha para o item, alternar silêncio, editar/excluir keyframe de crop, mover/resetar início manual de bloco de Narração (`±1 Frase` ou tempo) e reancorar/remover SFX.

#### Zona 2 — Centro: Palco 9:16, Modo Fonte 16:9 e Barra de Transporte
* **Alternador de visualização:** `Prévia 9:16` (saída vertical) vs. `Enquadrar na Fonte 16:9` (quadro original com retângulo(s) de crop manipulável(is) por ponteiro e teclado).
* **Renderização de vídeo e crop (`cropMath.ts`):**
  * Reproduz `mediaUrl("proxy/" + key)` sincronizado ao `SpliceMap` (`timelineMath.ts`, pulando automaticamente silêncios `active`).
  * Suporta os 5 layouts (`fit`, `face`, `gameplay_webcam`, `two_people`, `fullscreen_roi`); em layouts duplos (`gameplay_webcam` / `two_people`), empilha os dois painéis com altura exata proporcional a `splitRatio` e permite selecionar e arrastar cada retângulo na visão `Fonte 16:9`.
* **Camada de legendas ao vivo (`render.ts`):**
  * Desenha no canvas `1080×1920` escalado os mesmos `cues`, linhas, fontes (`Noto Sans` / `Noto Serif`), karaokê `\kf`, fade `cinema` (`120 ms`) e `overrides` de palavra vindos de `export.captions`.
* **Feedback de borda ao vivo durante arrasto:**
  * Enquanto o usuário arrasta a alça `Entrada` ou `Saída` na timeline, o palco exibe o quadro exato da borda (`preview: true`) com badge `tabular-nums`: timecode na Fonte + selo `Encaixe em Frase` ou `Livre por quadro (Alt)`.
* **Mixagem de áudio ao vivo (`duckingMath.ts`):**
  * Combina áudio do proxy (pulando silêncios ativos, com ducking `-12 dB` quando há Narração ativa), blocos da Narração (`narration/<audioId>`), trilha sonora (fade-in/out + loop + ducking `-12 dB` em `speechIntervals`) e SFX nos respectivos instantes.
* **Barra de Transporte (`role="toolbar"` com *roving tabindex*):**
  * `Voltar 1 quadro (←)`, `Rebobinar (J)`, `Reproduzir / Pausar (Espaço / K)`, `Avançar (L)`, `Avançar 1 quadro (→)`, timecode atual / duração efetiva (`tabular-nums`), botões `Definir Entrada (I)` e `Definir Saída (O)` (com suporte a `Alt+I` / `Alt+O` livre por quadro), botão `Mudo / Volume prévia`, e botões explícitos `Painel Transcrição (Ctrl+[)` / `Painel Inspetor (Ctrl+])`.

#### Zona 3 — Painel Direito: Inspetor em 5 Abas (`@base-ui/react/tabs`)
1. **Aba `Enquadramento`:**
   * Grade de 5 layouts: `Rosto (9:16)`, `Fit / Centro`, `Jogo + Webcam`, `Duas pessoas`, `Tela cheia (ROI)`.
   * Para `gameplay_webcam` (`0.20..=0.50`, padrão `0.30`) e `two_people` (`0.30..=0.70`, padrão `0.50`): slider `Proporção vertical` (`editor.crop.set_layout` com `preview: true/false`), seletor de painel (`Topo` / `Base`) e orientação explícita de que em `gameplay_webcam` o retângulo manual da webcam é o caminho principal.
   * **Reenquadramento automático (YuNet):** disponível para `face`, `gameplay_webcam`, `two_people`.
     * Se `worker` ou modelo `yunet` faltar (detectado via `components.worker.status` e `components.models.manifest` ao abrir a aba ou ao tentar iniciar): embute `<InstaladorJustInTime recurso="yunet" />` exibindo tamanho, licença e botão para instalar via `components.worker.install` e `components.models.download { id: "yunet", confirmed: true }` com progresso e `Cancelar` (`components.cancel`).
     * Botão **"Analisar enquadramento automático"** (`reframe.start`) → acompanha `core-progress` (`reframe_proxy`, `reframe_scenes`, `reframe_faces`) + `reframe.status` + `Cancelar` (`jobs.cancel`).
     * Quando pronto: mostra confiança da análise (em `gameplay_webcam`, nota se confiança `0.10–0.65`) e botão **"Aplicar sugestão automática"** (`editor.crop.set_suggested { reframe_id }`), com **sinalização explícita de que não entra no Desfazer** e mantém os keyframes manuais em `edits`.
   * **Keyframes manuais (`edits`):** lista de keyframes do painel ativo (`timeUs`, coordenadas `x/y/w/h` editáveis por teclado com `NumberScrub`/inputs numéricos, toggle `Corte seco (cut)` para evitar câmera deslizando entre planos), botões `Adicionar/Atualizar na agulha`, `Remover keyframe` e botão perigoso **"Limpar todas as edições manuais"** (`<ConfirmDialog>` obrigatório).
2. **Aba `Legendas e Tradução`:**
   * **Aviso de remapeamento (`captions.remap_status`):** se `discarded > 0`, faixa não-bloqueante `<Status tom="aviso">` informando quantos destaques por palavra foram descartados após retranscrição.
   * **Faixa de legenda (`captions.track.set`):** seletor `Automático`, `Original`, `Traduzida` (requer tradução salva) e `Narração` (visível só em Vídeo transformado).
   * **Presets (`captions.style.preset`):** 3 botões (`Vertical`, `Cinema`, `Simples`), com nota *"Trocar preset preserva seus destaques por palavra"*.
   * **Personalização (`captions.style.set` com trava `revision`):** Fonte (`Noto Sans`, `Noto Serif`), Tamanho (`24..=96`), Cor, Cor ativa, Cor já falada, Contorno (`0..=10` + cor), Sombra (`0..=10`), Posição `X` (`80..=1000`) e `Y` (`192..=1600`), Karaokê (`highlight`), botão **"Usar como padrão do Projeto"** (`captions.style.default`). Em `caption_style_conflict`, faixa com botão **"Recarregar estilo"**.
   * **Aviso de glifos / emojis (`export.captions`):** alerta discreto se `emojiRemoved === true` e lista acionável se `missingGlyphs.length > 0`.
   * **Destaque da palavra selecionada (`captions.override`):** cor, cor ativa, destaque ligado/desligado, ocultar na legenda (`hidden`) e *"Limpar destaque"*.
   * **Sub-seção `Tradução (PT-BR ↔ EN)` (`translation.*`):**
     * Se `!permitted` (sem Permissão ou sem escopo `tradução`): `<Status tom="aviso">` com explicação de `permissionError` e link para revisar a Permissão da Fonte (`#/projeto/:id/fontes/:fonteId`).
     * Se `permitted`: seletor de idioma (quando `languageRequired`), botão **"Calcular tradução"** (`translation.estimate`) → exibe `<ResumoCustoPrivacidade>` + botão **"Traduzir Corte"** (`translation.start { confirmed: true }`), progresso por lotes, estado `partial` e lista editável por Frase (`translation.edit`) mantendo timestamps originais.
   * **Rodapé informativo:** *"Estilo, destaques e tradução são salvos automaticamente fora do Desfazer da timeline."*
3. **Aba `Silêncios`:**
   * Explicação clara de respiro: *"Preserva 120 ms após a fala anterior e 75 ms antes da próxima (mínimo 200 ms)."*
   * Slider `Duração mínima da pausa` (`300 ms` a `2000 ms`, padrão `600 ms`) chamando `editor.silences.detect` (`preview: true` no arrasto, `preview: false` ao soltar).
   * Resumo `tabular-nums`: `Duração original` → `Duração efetiva` (`effectiveDurationUs`), `Removido` (`removedUs`) e contagem `ativas / total`.
   * Ações em lote: **"Aplicar todos"** (`editor.silences.apply_all`) e **"Reverter todos"** (`editor.silences.revert_all`).
   * **Cartões de revisão de silêncio (*Review cards*):** cada pausa detectada mostra `#N`, intervalo, duração, trecho de contexto (`"…palavraA [pausa] palavraB…"`), botão **"Ouvir em contexto"** (posiciona `1,5 s` antes e toca no palco) e toggle **"Remover pausa" / "Manter pausa"** (`editor.silences.toggle`).
4. **Aba `Áudio e SFX`:**
   * **Trilha sonora do Corte (até 1):** seletor da biblioteca ou botão rápido de importação; controles de `Início (s)`, `Volume` (`0–100%`, padrão `30%`), `Fade-in` e `Fade-out`, checkbox `Repetir para cobrir o Corte` (`loopToFit`), selo da licença (`licenseVerified` ou aviso `Licença não informada`), nota *"Abaixa automaticamente -12 dB sob a fala"* e botão **"Remover trilha"** (`editor.audio.soundtrack.clear`, reversível via `editor.undo`).
   * **Efeitos sonoros (SFX):** botão **"Adicionar SFX na agulha"** (`moment`) ou **"Ancorar na palavra selecionada"** (`word`); lista dos SFX no Corte com badge `Fora do Corte` se `outsideClip === true`, `Volume` (padrão `80%`), fades, botão *"Mover para a agulha"* (`editor.audio.sfx.update`) e *"Remover"* (`editor.audio.sfx.remove`, reversível via `editor.undo`).
   * **Biblioteca de áudio do Projeto (`audio.list`):** filtro `Músicas` | `SFX`; botão **"Importar áudio (até 500 MiB)"** abrindo formulário (`Escolher arquivo`, `Tipo: Música / SFX`, `Nome`, `Origem/Licença` obrigatória/visível — `youtube_audio_library`, `cc0`, `cc_by`, `purchased`, `original`, `unknown` — e campo obrigatório `Atribuição` quando `cc_by`); edição de licença inline (`audio.license.set`) e botão **"Excluir da biblioteca"** (`audio.delete`, protegido por `<ConfirmDialog>`).
5. **Aba `Histórico e Snapshots`:**
   * Botões **Desfazer** (`Ctrl/Cmd+Z`, mostra `undoCount`) e **Refazer** (`Ctrl/Cmd+Shift+Z`, mostra `redoCount`) com tooltip explícito do escopo (`Corte atual`), mais botão **"Salvar agora"** (`editor.flush`, `Ctrl/Cmd+S`).
   * Bloco informativo **"Fora do Desfazer do Corte"**: explica YuNet (`set_suggested`), legendas/tradução e correções da Transcrição (que pertencem à pilha do Projeto).
   * **Snapshots persistentes (`editor.snapshots`):** lista até `20` versões salvas (`revision`, bordas, contagem de silêncios, layout) em **modo somente leitura** com aviso *"Histórico informativo de salvamentos (restauração direta será adicionada em atualização futura)"*.

#### Zona 4 — Base: Timeline do Proxy (`±2 min`)
* **Cabeçalho da Timeline:** controles de borda `Entrada (-1 Frase / +1 Frase)` e `Saída (-1 Frase / +1 Frase)` (`editor.adjust`), duração efetiva `tabular-nums`, indicador de `Encaixe em Frase` vs. `Livre por quadro (Alt)` e controles de Zoom (`-`, `+`, `Ajustar ao Corte`).
* **Mini-mapa (*Dual Timeline*):** barra superior mostrando toda a janela do proxy (`windowStartUs..windowEndUs`), intervalo do Corte e janela de zoom visível; clicar/arrastar reposiciona o scroll horizontal.
* **Régua e Playhead (`role="slider"`):** marcações adaptativas de tempo + cursor âmbar arrastável e navegável por teclado.
* **Trilhas sincronizadas (renderizadas apenas na janela visível via `timelineMath.ts`):**
  1. **Vídeo:** miniaturas do proxy (`editor.timeline` / `thumbs.jpg`, `1` quadro a cada `2 s`, `96×54 px` em grade `20` colunas) + **Alças Entrada (`I`) e Saída (`O`)** (`role="slider"`, alvo `≥ 24 px`).
  2. **Áudio e Silêncios:** onda `editor.wave` (`wave.bin`, `1 byte / 100 ms`) com silêncios `active` exibidos em **hachura + borda + rótulo** (WCAG 1.4.1).
  3. **Frases e Keyframes:** blocos de `editor.sentences` + marcadores de keyframes manuais (`crop.edits`, com ícone distinto quando `cut: true`).
  4. **Narração (`NarrationTrack`, visível se `videoKind === 'transformed'` e `montage !== null`):** blocos arrastáveis (`editor.montage.set_start` com `preview: true/false` e `Alt` livre por quadro), ação de voltar ao automático (`time_us: null`), badge de empurrão (`block_pushed`, respiro `300 ms`) e bloco final **`Cauda congelada`** (`freezeTailUs`, com `<Status tom="aviso">` se `> 5 s` / `long_freeze_tail`).
  5. **Trilha & SFX (`AudioTrack`):** faixa da trilha sonora mostrando curva do envelope de ducking `-12 dB` sobre `speechIntervals` + fades, e pinos arrastáveis de SFX (`editor.audio.sfx.update`, encaixe na palavra ativa mais próxima ou livre por quadro com `Alt`).

### 4. Ações

| Ação | Comando(s) do núcleo | Pré-condições | Confirmação / Custo | O que muda na tela | Desfazer |
|---|---|---|---|---|---|
| Abrir editor | `editor.open`, `editor.sentences`, `export.captions`, `audio.list`, `translation.get`, `captions.remap_status`, `proxy.request` | Projeto aberto; Corte válido | Nenhuma | Carrega as 4 zonas e inicia geração de proxy/timeline se necessário | — |
| Gerar assets da timeline | `editor.timeline`, `editor.timeline_status`, `editor.wave` | Proxy `ready`; FFmpeg instalado | Nenhuma (local) | Exibe miniaturas `thumbs.jpg` e onda `wave.bin` | Cancelar via `jobs.cancel` |
| Ajustar bordas (alça, `±1 Frase`, `I`/`O`, `Alt`) | `editor.adjust` (`preview: true` no arrasto, `false` ao soltar; recarrega `editor.sentences` se sair da janela) | Duração dentro de `minUs..=maxUs` | Nenhuma | Atualiza bordas, silêncios recortados, legendas (`export.captions`) e montagem | Sim (`editor.undo`) |
| Corrigir palavra na Transcrição (`F2`/`Enter`) | `transcription.correct` | Palavra `kind='word'` válida (`1..200` chars) | Nenhuma | Atualiza texto da palavra, Frase, FTS5 e recarrega `export.captions` | Sim (pilha do Projeto: `transcription.undo`) |
| Detectar / alternar silêncios | `editor.silences.detect` (`preview: true/false`), `.toggle`, `.apply_all`, `.revert_all` | Transcrição com palavras | Nenhuma | Atualiza `SpliceMap`, duração efetiva, hachura na onda e tachado na Transcrição | Sim (`editor.undo`) |
| Mudar layout / `splitRatio` de crop | `editor.crop.set_layout` (`preview: true/false`) | Corte aberto | Nenhuma | Atualiza canvas 9:16 e painéis duplos no palco | Sim (`editor.undo`) |
| Instalar YuNet *just-in-time* | `components.worker.status`/`.install`, `components.models.manifest`/`.download { id: "yunet", confirmed: true }` | Worker + YuNet escolhidos no card | Confirmação explícita (`confirmed: true`) mostrando tamanho e licença | Instala worker/modelo YuNet com progresso e libera `reframe.start` | Cancelar via `components.cancel` |
| Analisar e aplicar YuNet | `reframe.start`, `reframe.status` → `editor.crop.set_suggested` | Worker + YuNet instalados; Fonte online; layout `face`/`gameplay_webcam`/`two_people` | Aviso inline de que **não entra no Desfazer** e preserva `edits` | Preenche `crop.suggested` e atualiza preview 9:16 | **Não** (sinalizado via aviso/toast) |
| Editar/limpar keyframes manuais de crop | `editor.crop.set_edits` (`preview: true/false`) | Corte aberto; `panel` compatível com layout | `<ConfirmDialog>` apenas para **"Limpar todas as edições manuais"** | Atualiza keyframes no painel/timeline e interpolação no palco | Sim (`editor.undo`) |
| Alterar faixa, preset ou estilo de legenda | `captions.track.set`, `captions.style.preset`, `captions.style.set`, `captions.style.default` | Para `translated`, haver tradução; para `narration`, Vídeo transformado; `revision` atual | Nenhuma (alerta se `caption_style_conflict`) | Atualiza legendas ao vivo no palco; `default` salva padrão do Projeto | **Não** (salvo direto; botão de preset reverte) |
| Destacar / ocultar palavra na legenda | `captions.override` | Palavra válida na Transcrição | Nenhuma | Atualiza palavra no palco e indicador na Transcrição | **Não** (botão *"Limpar destaque"*) |
| Traduzir legendas do Corte | `translation.estimate` → `translation.start { confirmed: true }`, `translation.edit`, `translation.track.set` | Permissão com escopo `tradução`; Provedor compatível com `Somente local` | `<ResumoCustoPrivacidade>` antes de enfileirar | Executa lotes `ai:translation`, habilita faixa `Traduzida` e edição por Frase | **Não** (edição manual sobrescreve Frase) |
| Mover bloco de Narração na timeline | `editor.montage.set_start` (`preview: true/false`, `time_us: null` para automático) | Vídeo transformado com Roteiro | Nenhuma | Recalcula `MontagePlan`, avisos `block_pushed` e `freezeTailUs` | Sim (`editor.undo`) |
| Gerenciar biblioteca de áudio | `audio.import`, `audio.license.set`, `audio.delete` | Arquivo local ≤ 500 MiB; `attribution` se `cc_by` | `<ConfirmDialog>` ao excluir da biblioteca (`audio.delete`) | Atualiza lista na aba `Áudio e SFX` e checklist de licenças | Não |
| Definir/ajustar trilha sonora e SFX | `editor.audio.soundtrack.set`/`.clear`, `editor.audio.sfx.add`/`.update`/`.remove` | Asset do `kind` compatível presente no Projeto | Nenhuma (reversível imediato via `Ctrl/Cmd+Z`) | Atualiza `AudioTrack`, curva de ducking `-12 dB` e prévia sonora | Sim (`editor.undo`) |
| Desfazer / Refazer / Salvar | `editor.undo`, `editor.redo`, `editor.flush` | Pilha não vazia (`undo`/`redo`) | Se `editor.flush` falhar ao sair, `<ConfirmDialog>` de bloqueio | Restaura snapshot do Corte ou persiste no SQLite (`editor_saved`) | Recíproco (`undo` ↔ `redo`) |

### 5. Estados

* **`loading`:** enquanto `editor.open` responde, cada uma das 4 zonas exibe `<Esqueleto>` estrutural (linhas de Frases à esquerda, retângulo 9:16 ao centro, abas/campos à direita e trilhas na base). Enquanto `proxy.request` / `editor.timeline` geram em segundo plano, Transcrição e Inspetor já ficam **interativos** enquanto o Palco e a Timeline mostram progresso determinístico (`1%–99%`) com botão **Cancelar**.
* **`empty`:**
  * Aba `Silêncios` sem pausas acima do limite: *"Nenhuma pausa acima de X ms encontrada. Reduza o limite mínimo para detectar pausas menores."*
  * Aba `Áudio e SFX` sem áudios importados: *"Nenhuma música ou efeito sonoro no Projeto ainda."* + CTA **"Importar áudio local"**.
  * Aba `Histórico` sem edições desfeitas/salvas: *"Nenhuma edição alterada nesta sessão ainda."*
  * Aba `Enquadramento` no layout `fit`: *"O vídeo inteiro já cabe no quadro 9:16 com barras laterais/superiores. Use o zoom ou escolha outro layout para preencher a tela."*
* **`error` (mapeamento `CoreError.code` → mensagem humana + ação):**
  * `source_offline` / `source_changed`: modo somente-leitura com banner `role="alert"`: *"O arquivo original da Fonte foi movido ou alterado. Você ainda pode ler a Transcrição e ajustar textos, mas a prévia de vídeo está bloqueada."* → botão **"Relocalizar Fonte"** (`sources.relocate`).
  * `adjust_empty` / `adjust_too_short` / `adjust_too_long` / `invalid_range` / `clip_too_long`: *"As bordas precisam respeitar a duração mínima e máxima permitida para este Corte."* → mantém última borda válida e anuncia no `role="alert"` discreto.
  * `proxy_not_ready` / `proxy_failed`: *"Não foi possível preparar a prévia rápida deste trecho."* → botão **"Tentar gerar prévia novamente"** (`proxy.request`).
  * `caption_style_conflict`: *"O estilo desta legenda foi atualizado em outra ação. Recarregue antes de salvar."* → botão **"Recarregar estilo"** (`export.captions`).
  * `translation_permission_required`: *"A Permissão desta Fonte não autoriza tradução. Registre o escopo de tradução na Fonte para liberar este recurso."* → link para `#/projeto/:id/fontes/:fonteId`.
  * `local_only_violation`: *"Tradução bloqueada pelo modo Somente local porque o Provedor configurado envia texto para fora da máquina."* → botão **"Escolher Perfil local"** (`#/config/provedores`).
  * `context_too_small` / `invalid_settings` / `profile_unavailable`: *"O Perfil de Provedor da tarefa Tradução não está configurado ou tem janela pequena demais."* → link **"Configurar Tarefa Tradução"** (`#/config/provedores`).
  * `attribution_required`: *"Informe o texto de atribuição exigido pela licença CC-BY."* → foca o campo `Atribuição`.
  * `audio_too_large` / `invalid_audio` / `ffprobe_missing`: *"O áudio excede 500 MiB, está corrompido ou falta o FFmpeg/ffprobe."* → link para `#/config/componentes` quando `ffprobe_missing`.
  * `worker_missing` / `model_missing` / `component_missing`: *"Falta instalar o componente ou modelo necessário para esta ação."* → abre `<InstaladorJustInTime>` inline.
  * `project_write` / `insufficient_space` (inclusive em `editor_save_failed`): *"Não foi possível gravar as edições no disco. Verifique o espaço disponível."* → botão **"Tentar salvar agora"** (`editor.flush`) e link `#/config/componentes`.
  * `nothing_to_undo` / `nothing_to_redo`: botão correspondente desabilitado preventivamente; se ocorrer, anúncio discreto *"Nada para desfazer/refazer"*.
* **`job_running`:**
  * Proxy (`proxy`), Timeline (`timeline`), YuNet (`reframe`), Tradução (`ai:translation`) ou Download *just-in-time* (`yunet`/`worker`): cada sub-região exibe barra determinística (`%` + estágio humano, ex.: *"Analisando rostos (48%)"*, *"Traduzindo lote 1 de 2…"*) e botão **Cancelar**, **sem bloquear** a edição nas demais zonas.
* **`partial`:**
  * Tradução `run.state === "partial"`: faixa `<Status tom="aviso">` *"Tradução parcial: X de Y lotes concluídos. Você pode editar o que já foi traduzido ou refazer os lotes pendentes."* + listagem dos lotes com erro e ação de retomar/refazer.
  * Fonte `offline`/`changed` em somente-leitura: faixa explicando o que continua editável (texto, bordas por Frase) e o que exige relocalização (prévia, YuNet, exportação).

### 6. Eventos (`core-progress`)

| `job` | `stage` | O que atualiza na tela |
|---|---|---|
| `editor:<clip_id>` | `editor_saved` (`100%`) | Atualiza Barra de Status para `Salvo` e recarrega lista de snapshots se a aba `Histórico` estiver aberta. |
| `editor` | `editor_save_failed` (`0%`) | Dispara alerta acionável (`role="alert"`) na Barra de Status e bloqueia eventual saída da rota com diálogo de recuperação. |
| `<job_id>` | `proxy`, `complete`, `failed` | Atualiza progresso no Palco; em `complete`, carrega `<video>` em `mediaUrl("proxy/" + key)` e dispara `editor.timeline`. |
| `<job_id>` | `timeline` (`2%`, `40%`), `complete`, `failed` | Atualiza progresso da Timeline; em `complete`, chama `editor.timeline_status` e `editor.wave` para desenhar miniaturas e onda. |
| `<job_id>` | `reframe_proxy`, `reframe_scenes`, `reframe_faces`, `complete`, `failed` | Atualiza barra da aba `Enquadramento`; em `complete`, chama `reframe.status` e habilita **"Aplicar sugestão automática"**. |
| `<job_id>` | `ai:translation:prepare/call/verify/done/paused` | Atualiza progresso da sub-seção `Tradução`; em `done`/`paused`, chama `translation.get` e atualiza `export.captions` se a faixa `Traduzida` estiver ativa. |
| `"worker"` / `"yunet"` | `download`, `complete`, `failed` | Atualiza `<InstaladorJustInTime recurso="yunet" />`; em `complete`, libera imediatamente `reframe.start`. |

### 7. Teclado e acessibilidade

* **Regiões para `F6` / `Shift+F6`:**
  1. Barra Superior + `<ContextoCorte>` (`<header>`/`<nav>`)
  2. Painel Esquerdo: Transcrição / Índice do Corte (`<aside aria-label="Transcrição e Índice do Corte">`) *(pulado quando recolhido)*
  3. Palco 9:16 e Transporte (`<main aria-label="Palco de prévia">`)
  4. Painel Direito: Inspetor (`<aside aria-label="Inspetor do Corte">`) *(pulado quando recolhido)*
  5. Timeline do Proxy (`<section aria-label="Timeline do Corte">`)
  6. Barra de Status (`<footer>`)
* **Atalhos específicos da tela (sem conflitos, respeitando interruptor WCAG 2.1.4 e desativados em campos de texto):**
  * `Ctrl/Cmd+[` / `Ctrl/Cmd+]`: recolher/expandir Painel Esquerdo / Painel Direito (em 1366 px, abrir um recolhe o outro).
  * `Espaço` (fora de botões) e `J` / `K` / `L`: transporte (Reproduzir/Pausar, Rebobinar `1×/2×/4×`, Pausar, Avançar `1×/2×/4×`).
  * `←` / `→`: `1` quadro no Palco (ou `Shift+←/→` = `1 s`); na Transcrição, navega entre palavras.
  * `I` / `O` (`Alt+I` / `Alt+O`): move borda Entrada / Saída para a agulha (`Alt` = livre por quadro, `free: true`).
  * `←` / `→` em alça de borda focada: ajusta `1` Frase (`Alt+←/→` = `1` quadro; `PageUp`/`PageDown` = `5` Frases; `Home`/`End` = extremos da janela).
  * `+` (`=`) / `-`: zoom na Timeline centrado na agulha.
  * `F2` ou `Enter` na palavra focada da Transcrição: editar grafia (`transcription.correct`, `Esc` cancela).
  * `Ctrl/Cmd+F`: focar busca local na Transcrição/Índice do Corte.
  * `Ctrl/Cmd+Z` / `Ctrl/Cmd+Shift+Z`: `editor.undo` / `editor.redo` (ou `transcription.undo`/`redo` quando o foco está na Transcrição — escopo anunciado no tooltip e Barra de Status).
  * `Ctrl/Cmd+S`: `editor.flush`.
  * `Ctrl/Cmd+E`: diálogo de exportação individual.
* **Padrões WAI-ARIA APG e WCAG 2.2 AA:**
  * Barra de transporte: `role="toolbar"` com *roving tabindex* (`←`/`→`).
  * Alças Entrada/Saída, Playhead e sliders de silêncio/volume/splitRatio: `role="slider"` com `aria-valuemin`, `aria-valuemax`, `aria-valuenow` e `aria-valuetext` legível (ex.: `"Entrada em 00:14.200 da Fonte"`).
  * Abas do Inspetor: `role="tablist"` / `role="tab"` / `role="tabpanel"` via `@base-ui/react/tabs`.
  * Alternância `Transcrição | Índice do Corte` e `Prévia 9:16 | Fonte 16:9`: botões com `aria-pressed` (ou `radiogroup`).
  * Lista de Frases/Índice do Corte: `<ListaVirtual>` (`role="listbox"` com `aria-activedescendant` e `aria-posinset`/`aria-setsize`).
  * Alternativa textual completa (`Índice do Corte`): garante que reordenação/ajuste de silêncios, keyframes, Narração e SFX sejam operáveis 100% sem ponteiro.
  * Alvos `≥ 24×24 CSS px` (SC 2.5.8), incluindo palavras curtas clicáveis (`min-w-6 min-h-6` ou área clicável equivalente), alças e marcadores de keyframes.
  * Anúncios `role="status"` (`aria-live="polite"`) com *throttle* para autosave/playhead em navegação por teclado e `role="alert"` apenas para falhas acionáveis (`editor_save_failed`, conflitos, erros).

### 8. US do #26 atendidas

* **US-39** (autosave e snapshots), **US-40** (desfazer/refazer por Corte com arrastos agrupados), **US-41** (promover estilo a padrão do Projeto), **US-47** (respeitar escopo `tradução` da Permissão), **US-51** (progresso e cancelamento de proxy/timeline/reframe/tradução), **US-54** (corrigir palavra com `F2` sem quebrar tempos), **US-55** (clicar na palavra vai ao momento), **US-63 / US-72 / US-73 / US-75** (bordas em Frase, `Alt` por quadro, `±1 Frase` e quadro exato da borda ao arrastar), **US-68 / US-70 / US-71** (editor focado em 4 zonas com proxy rápido, onda e miniaturas), **US-76** (silêncios reversíveis com limite ajustável e respiro), **US-77 / US-78 / US-79 / US-80** (legendas karaokê, presets sem perder overrides, paridade preview/export, tradução PT-BR ↔ EN), **US-81 / US-82 / US-83 / US-84 / US-85 / US-86** (YuNet, 5 layouts, webcam manual, keyframes separados da sugestão e corte seco), **US-88 / US-95 / US-96** (montagem da Narração, empurrões e ducking), **US-104 / US-129** (trilha sonora, SFX ancorado, ducking automático e registro de licença).

### 9. Lacunas

* **Núcleo Rust:**
  1. **`editor.snapshots.restore` inexistente** (`01-arquitetura.md` Seção 11, item 3 / `05-editor.md`): `editor.snapshots` retorna até 20 snapshots, mas não há comando para restaurar um snapshot escolhido. A aba `Histórico e Snapshots` exibe a lista como somente leitura até existir o ticket.
  2. **Eventos `ai:translation:*` sem `clip_id`** (`01-arquitetura.md` Seção 11, item 7): eventos trazem apenas `<job_id>`; o store do front precisa mapear `job_id` retornado por `translation.start` para o `:corteId` aberto.
  3. **Sinalização de mudança de Corte direto para Vídeo transformado** (já citada na Superfície 1).
* **Mock TS (`src/lib/editorEditsMock.ts`, `src/lib/captionsMock.ts`, `src/lib/core.ts`):**
  1. Implementar `editor.snapshots` no `editorEditsMock.ts` (hoje lança `Unknown core command`).
  2. Alinhar defaults do `editorEditsMock.ts` aos valores do Rust (`soundtrack.volume = 0.30`, `fadeInUs = 0`, `fadeOutUs = 0`, `sfx.volume = 0.80`, `fps` e durações realistas).
  3. Isolar `captionsMock.ts` por `transcript_id` em vez de usar um único `Map` global em memória.
  4. Remover exigência de query params ocultos (`?source-test=1`, `?transcript-test=1`) para `proxy.*` e `transcription.correct` funcionarem no mock padrão, mantendo apenas `?estado=vazio|erro|carregando|offline` para testes.
  5. Emitir eventos `core-progress` simulados no mock para `proxy.request`, `editor.timeline`, `reframe.start`, `translation.start`, `components.models.download` e `editor_saved`/`editor_save_failed` (via query param de teste).

### 10. Critérios de aceite (E2E / Playwright com mock)

1. Em viewport `1366×768`, abrir `#/projeto/:id/corte/:corteId/editar` mostra no máximo **um** painel lateral por vez; acionar `Ctrl+]` abre o Inspetor e recolhe automaticamente a Transcrição sem cobrir o Palco 9:16.
2. Em viewport `1440×900`, Transcrição (esquerda), Palco 9:16 (centro) e Inspetor (direita) permanecem abertos simultaneamente com a Timeline na base.
3. Arrastar a alça `Entrada` envia `editor.adjust` com `preview: true` durante o movimento (exibindo o quadro exato da borda no palco) e `preview: false` ao soltar, incrementando `undoCount`; segurar `Alt` exibe o selo `"Livre por quadro (Alt)"`.
4. Pressionar `Ctrl+Z` após ajustar uma borda ou silêncio chama `editor.undo` e restaura o estado anterior; clicar em *"Aplicar sugestão automática"* após `reframe.start` exibe aviso explícito de que a ação **não entra no Desfazer** e preserva keyframes em `crop.edits`.
5. Na aba `Transcrição`, focar uma palavra e pressionar `F2` abre edição inline que chama `transcription.correct` e atualiza a legenda renderizada no palco sem alterar as bordas do Corte.
6. Na aba `Silêncios`, mover o slider de limite atualiza a prévia e alternar um cartão individual chama `editor.silences.toggle`, exibindo o trecho tachado + hachurado na Transcrição e na Timeline.
7. Na aba `Enquadramento`, quando `yunet` não está instalado, o card `<InstaladorJustInTime recurso="yunet" />` aparece inline com tamanho, licença e botão de download antes de liberar `reframe.start`; em `"Limpar todas as edições manuais"`, exige confirmação no `<ConfirmDialog>`.
8. Na aba `Legendas e Tradução`, trocar de preset chama `captions.style.preset` mantendo overrides de palavra; com `?estado=erro` ou conflito de `revision`, exibe mensagem humana com botão `"Recarregar estilo"`.
9. Na aba `Áudio e SFX`, tentar importar música `cc_by` sem preencher `Atribuição` bloqueia envio com foco no campo obrigatório e mensagem clara; adicionar trilha atualiza a curva de ducking `-12 dB` na `AudioTrack`.
10. Ao sair da rota `Editar` quando `editor.flush` retorna erro simulado (`?estado=erro-flush`), a navegação é interrompida e o `<ConfirmDialog>` exibe *"Tentar salvar novamente"*, *"Continuar editando"* e *"Sair descartando alterações não salvas"*.
11. Com Fonte em estado `offline` (`?estado=offline`), o editor abre em modo somente-leitura com Transcrição e Índice do Corte navegáveis, banner `"Relocalizar Fonte"` visível e prévia de vídeo/exportação bloqueadas.
12. `F6` cicla o foco entre Barra Superior/`<ContextoCorte>`, Painel Esquerdo (se aberto), Palco, Inspetor (se aberto), Timeline e Barra de Status, e o `Índice do Corte` permite acionar um silêncio e um keyframe usando apenas teclado.

---

## Componentes compartilhados usados

Interfaces mínimas propostas para unificação entre os Pacotes A–F pelo coordenador (alinhadas ao design system Foco e aos Pacotes A e B):

1. **`<ContextoCorte>`** *(específico do contexto de Corte, usado pelos Pacotes D e E dentro do slot `meio` de `<Tela>`)*
   ```ts
   interface ContextoCorteProps {
     projetoId: string;
     corteAtual: {
       corteId: number;
       titulo: string;
       indice: number;
       totalAprovados: number;
       videoKind: 'direct' | 'transformed';
       anteriorId?: number | null;
       proximoId?: number | null;
     };
     subAbaAtiva: 'editar' | 'transformar' | 'empacotar';
     aoAntesDeNavegar?: () => Promise<boolean>; // ex.: dispara editor.flush em Editar
     aoAbrirExportacao: () => void;
   }
   ```
2. **`<PlayerProxy>`** *(compartilhado entre Pacote C `Revisão`, Pacote D `Editar` e Pacote E `Empacotar`)*
   ```ts
   interface PlayerProxyProps {
     sourceId: number;
     startUs: number;
     endUs: number;
     proxyKey?: string | null;
     fonteDisponivel: boolean;
     modoVisualizacao?: 'preview_9_16' | 'fonte_16_9';
     crop?: ClipCrop;
     panelAtivo?: 'primary' | 'top' | 'bottom';
     captions?: CaptionData | null;
     silences?: SilencesState;
     montage?: MontageState | null;
     audioMix?: AudioMixState | null;
     tempoAtualUs: number;
     reproduzindo: boolean;
     taxaReproducao?: number;
     aoMudarTempoUs: (us: number) => void;
     aoMudarReproduzindo: (tocando: boolean) => void;
     aoEditarCrop?: (edits: CropKeyframe[], preview: boolean) => void;
     overlayBorda?: { lado: 'start' | 'end'; timeUs: number; livrePorQuadro: boolean } | null;
   }
   ```
3. **`<TimelineEditor>`** *(ou composto por `<MiniMapaProxy>`, `<FaixaVideo>`, `<FaixaOndaSilencios>`, `<NarrationTrack>`, `<AudioTrack>`)*
   ```ts
   interface TimelineEditorProps {
     windowStartUs: number;
     windowEndUs: number;
     startUs: number;
     endUs: number;
     tempoAtualUs: number;
     timelineState: 'missing' | 'queued' | 'running' | 'ready' | 'failed' | 'cancelled';
     thumbs?: { id: string; count: number; intervalUs: number; width: number; height: number; columns: number } | null;
     waveValues?: number[];
     sentences: TimelineSentence[];
     silences: SilencesState;
     keyframes: CropKeyframe[];
     montage?: MontageState | null; // apenas Vídeo transformado
     audioMix?: AudioMixState | null;
     zoom: number;
     aoAjustarBorda: (edge: 'start' | 'end', args: { timeUs?: number; sentenceDelta?: -1 | 1; free?: boolean; preview: boolean }) => void;
     aoMoverAgulha: (us: number) => void;
     aoMoverNarracao?: (blockId: number, timeUs: number | null, free: boolean, preview: boolean) => void;
     aoMoverSfx?: (sfxId: number, timeUs: number, free: boolean, preview: boolean) => void;
   }
   ```
4. **`<ConfirmDialog>`**, **`<ResumoCustoPrivacidade>`**, **`<InstaladorJustInTime>`**, **`<EstadoTela>`**, **`<Esqueleto>`**, **`<Status>`**, **`<ListaVirtual>`**, **`<BannerErroCore>`**, **`<Toaster>`** *(mesmas interfaces definidas nos Pacotes A e B, reutilizadas aqui em falhas de `editor.flush`, limpeza total de keyframes, exclusão de áudio, tradução `translation.*`, instalação de `yunet`, remapeamento e estados de carregamento/vazio/erro)*.

---

## Questões para a arquitetura

1. **Lista de navegação `Anterior / Próximo aprovado` no `<ContextoCorte>`:** quando o usuário entra em `#/projeto/:id/corte/:corteId/editar` vindo da Revisão de Cortes (`runId` específico) vs. vindo da Mesa de Prontidão (todos os aprovados do Projeto), a lista de `i / N` deve considerar todos os Cortes aprovados do Projeto ou apenas os da execução atual? Sugerimos preservar a fila da execução quando `?run=:runId` estiver presente e usar todos os aprovados do Projeto caso contrário.
2. **Ação de escape quando `editor.flush` falha repetidamente ao sair de `Editar`:** a Seção 3 de [01-arquitetura.md](../01-arquitetura.md) determina bloquear a saída com diálogo se `editor.flush` falhar. Para evitar que um usuário fique preso indefinidamente na rota se o disco estiver cheio/somente-leitura, incluímos a opção secundária de perigo *"Sair descartando alterações não salvas"* após falha no diálogo — confirmar se essa válvula de escape é aceita pela arquitetura (mantendo o bloqueio rígido no fechamento da janela pelo Rust ou oferecendo o mesmo descarte consciente).
3. **Atalho de teclado opcional para `< Anterior` / `Próximo aprovado >`:** removemos `[` e `]` do `<ContextoCorte>` para respeitar o mapa sem conflitos da Seção 8 de [01-arquitetura.md](../01-arquitetura.md) (`Ctrl+[` / `Ctrl+]` para painéis e `I` / `O` para bordas). Caso a arquitetura queira um atalho dedicado além dos botões e da Paleta `Ctrl/Cmd+K`, sugerimos `Alt+PageUp` / `Alt+PageDown` (hoje livres).
4. **Sinalização de `editor.audio.soundtrack.clear` / `editor.audio.sfx.remove` vs. confirmação:** seguindo a recomendação da pesquisa de UX (`ux-editores-de-video-desktop.md`), mantivemos remoção de trilha/SFX imediata com `editor.undo` (`Ctrl/Cmd+Z`) + toast `"Desfazer"`, reservando `<ConfirmDialog>` apenas para `"Limpar todas as edições manuais"` de crop e `"Excluir áudio da biblioteca"` (`audio.delete`). Confirmar se o coordenador concorda com essa fronteira.
5. **Contagem de palavras/overrides em `translation.edit` vs. `captions.track.set`:** quando o usuário está na faixa `Traduzida` e edita uma Frase com `translation.edit`, `export.captions` precisa ser recarregado para atualizar os `cues` e `missingGlyphs` do palco. Incluímos essa invalidação automática no fluxo do store do Editor (Seção 10 de `01-arquitetura.md`).
