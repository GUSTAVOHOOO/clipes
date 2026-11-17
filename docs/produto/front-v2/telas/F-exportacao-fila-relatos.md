# Pacote F — Exportação, Mesa de Prontidão, Fila de Jobs, Relatos e Sobre

Especificação detalhada das telas e superfícies do **Pacote F** do front v2 do Clipes, seguindo a espinha de [01-arquitetura.md](../01-arquitetura.md), o vocabulário de [GLOSSARY.md](../../../GLOSSARY.md) e os contratos dos comandos em [01-instalacao-e-sistema.md](../funcionalidades/01-instalacao-e-sistema.md), [02-projetos-e-fontes.md](../funcionalidades/02-projetos-e-fontes.md), [03-transcricao.md](../funcionalidades/03-transcricao.md), [04-selecao-de-cortes.md](../funcionalidades/04-selecao-de-cortes.md), [06-roteiro-narracao-e-saida.md](../funcionalidades/06-roteiro-narracao-e-saida.md) e [07-provedores-jobs-e-eventos.md](../funcionalidades/07-provedores-jobs-e-eventos.md).

---

## Sumário das superfícies

1. [Macro-etapa 3: Exportação — Mesa de Prontidão, Exportação em Lote e Histórico de Lotes](#1-macro-etapa-3-exportação--mesa-de-prontidão-exportação-em-lote-e-histórico-de-lotes) (`#/projeto/:id/exportacao`)
2. [Painel Global da Fila de Jobs](#2-painel-global-da-fila-de-jobs) (Gaveta/Painel global via `Ctrl/Cmd+J`)
3. [Relatos e Diagnóstico](#3-relatos-e-diagnóstico) (`#/relatos`)
4. [Sobre e Atualizações](#4-sobre-e-atualizações) (`#/sobre`)
5. [Componentes compartilhados usados](#componentes-compartilhados-usados)
6. [Questões para a arquitetura](#questões-para-a-arquitetura)

---

## 1. Macro-etapa 3: Exportação — Mesa de Prontidão, Exportação em Lote e Histórico de Lotes

### 1.1 Objetivo e navegação (rotas)

* **Objetivo:** Permitir conferir em grade a prontidão de todos os Cortes aprovados do Projeto (título, capa, Permissão, pendências e checklist informativo de guarda-corpos), saltar rapidamente para editar qualquer Corte pendente e disparar ou acompanhar exportações em lote MP4 (1080×1920, -14 LUFS / -1 dBTP, sem marca d'água).
* **Rotas:**
  * `#/projeto/:id/exportacao` (padrão: `?sub=prontidao`, exibindo a **Mesa de prontidão** e o painel de **Exportação em lote**).
  * `#/projeto/:id/exportacao?sub=lotes` (sub-visão de **Histórico de lotes** e progresso detalhado por item; aceita também `#/projeto/:id/exportacao/lotes` como alias redirecionado para `?sub=lotes`).
* **De onde chega:**
  * Barra superior do Shell (aba da macro-etapa `3. Exportação`).
  * Da Macro-etapa 2 (`#/projeto/:id/cortes` ou `#/projeto/:id/cortes/revisao/:runId`) após aprovar Cortes.
  * Da sub-aba `Empacotar` (`#/projeto/:id/corte/:corteId/empacotar`) via ação *"Ir para Exportação"*.
  * De toast/notificação de conclusão de lote ou do Painel Global da Fila de Jobs (`"Ver na Exportação"`).
* **Para onde vai:**
  * Clicar em editar/corrigir um Corte na grade abre `#/projeto/:id/corte/:corteId/editar`, `#/projeto/:id/corte/:corteId/transformar` (apenas **Vídeo transformado**) ou `#/projeto/:id/corte/:corteId/empacotar`.
  * Link de encoder no painel de saída leva a `#/config/exportacao`.
  * Link de Fonte offline/alterada ou Permissão leva a `#/projeto/:id/fontes/:fonteId`.
  * Sem Projeto aberto: redireciona para `#/inicio`.

### 1.2 Layout por zonas

Toda a moldura externa ocupa a viewport sem scroll global; apenas o conteúdo da grade/histórico e o painel lateral de saída rolam internamente.

#### Variação 1366 px — Sub-visão `?sub=prontidao` (Mesa de prontidão + Disparo)

```text
+----------------------------------------------------------------------------------+
| [Shell: Barra Superior] Projeto | 1. Fontes | 2. Cortes | [3. Exportação] | Fila |
+----------------------------------------------------------------------------------+
| Sub-barra da etapa:                                                              |
|  [Prontidão e Lote (12 aprovados)]  [Histórico de lotes (2 ativos)]              |
|  Filtro de Fonte: [Todas as Fontes v]  Filtro: [Todos | Com pendência | Prontos] |
+---------------------------------------------+------------------------------------+
| ZONA A: Grade de Prontidão (rolagem vert.)  | ZONA B: Configuração e Disparo     |
|                                             | (rolagem vertical independente)    |
| +-------------------+ +-------------------+ | Escopo: [Todo o Projeto (12)]      |
| | [Capa / 9:16]     | | [Capa / 9:16]     | | Pasta de saída:                    |
| | Corte direto      | | Vídeo transformado| | [C:\Videos\Saida...] [Escolher...] |
| | Título do Corte   | | Título do Corte   | |                                    |
| | Fonte · 00:42     | | Fonte · 01:12     | | Encoder:                           |
| | [Permissão OK]    | | [Sem Permissão]   | | Hardware NVIDIA (NVENC)            |
| | [Capa OK][Empac.] | | [Roteiro pend.]   | | Fallback automático: x264 (CPU)    |
| | [Editar] [Empac.] | | [Transformar]     | | [Configurar encoder ->]            |
| +-------------------+ +-------------------+ |                                    |
|                                             | ---------------------------------- |
| +-------------------+ +-------------------+ | Checklist de originalidade/riscos  |
| | ...               | | ...               | | (informativo — não bloqueia)       |
| +-------------------+ +-------------------+ | • Tipo: Misto (8 diretos, 4 transf)|
|                                             | • Permissão: 10 de 12 com registro |
|                                             | • Roteiro: 3 de 4 aprovados        |
|                                             | • Áudio importado: 1 sem licença   |
|                                             | • Acima de 60 s: 2 Cortes          |
|                                             | • Divulgação de IA (expandir)      |
|                                             | ---------------------------------- |
|                                             | [ Exportar 12 aprovados em lote ]  |
+---------------------------------------------+------------------------------------+
| [Shell: Barra de Status] Salvo · Lote #4: exportando 3/12 (25%) · F6 regiões      |
+----------------------------------------------------------------------------------+
```

#### Variação 1440+ px — Sub-visão `?sub=prontidao`

* A **Zona A (Grade de Prontidão)** amplia de 2 colunas de cards (em 1366 px) para **3 ou 4 colunas fluidas** sem encolher a Zona B (painel de saída).
* Na sub-barra da etapa, a busca rápida por título de Corte e o seletor de ordenação (`Por Fonte`, `Por Nota`, `Pendências primeiro`) ficam expandidos na mesma linha.

#### Variação 1366 px e 1440+ px — Sub-visão `?sub=lotes` (Histórico de lotes)

```text
+----------------------------------------------------------------------------------+
| [Shell: Barra Superior] Projeto | 1. Fontes | 2. Cortes | [3. Exportação] | Fila |
+----------------------------------------------------------------------------------+
| Sub-barra da etapa:                                                              |
|  [Prontidão e Lote (12 aprovados)]  [Histórico de lotes (2 ativos)]              |
+---------------------------------------+------------------------------------------+
| ZONA C: Lista de Lotes (rolagem)      | ZONA D: Detalhe do Lote selecionado      |
|                                       | (rolagem independente)                   |
| > [Lote #5 · Em andamento · 45%]      | Lote #5 — Todo o Projeto (12 Cortes)     |
|   Todo o Projeto · 5/12 concluídos    | Pasta: C:\Videos\Saida [Abrir pasta]     |
|   [Cancelar lote]                     | Progresso total: [========----] 45%      |
|                                       | 5 concluídos · 1 exportando · 6 na fila  |
|   [Lote #4 · Concluído com falhas]    |                                          |
|   Live 14/11 · 7/8 exportados · 1 erro| Itens do lote:                           |
|                                       | 1. live14-01-00m42s.mp4  [Exportado]     |
|   [Lote #3 · Concluído]               |    Encoder: h264_nvenc  [Abrir]          |
|   Todo o Projeto · 10/10 exportados   | 2. live14-02-01m15s.mp4  [Exportando 62%]|
|                                       |    [======----] 62%                      |
|                                       | 3. live14-03-00m38s.mp4  [Exportado]     |
|                                       |    Fallback: x264 (NVENC falhou)         |
|                                       | 4. live14-04-00m50s.mp4  [Falhou]        |
|                                       |    Erro: Fonte alterada [Abrir Fonte]    |
+---------------------------------------+------------------------------------------+
| [Shell: Barra de Status]                                                         |
+----------------------------------------------------------------------------------+
```

* Em **1440+ px**, a Zona D exibe em tabela completa as colunas `Posição`, `Corte / Arquivo`, `Duração`, `Estado / Progresso`, `Encoder / Fallback` e `Ação` lado a lado sem truncar nomes de arquivo.

### 1.3 Conteúdo e componentes

#### Sub-barra da etapa
* **Abas da etapa (`tablist`):** `Prontidão e Lote` (`?sub=prontidao`, com contador de Cortes aprovados) e `Histórico de lotes` (`?sub=lotes`, com contador de lotes em andamento ou totais).
* **Controles de filtro (em `?sub=prontidao`):**
  * Seletor **Fonte**: *"Todas as Fontes"* ou uma Fonte específica de `sources.list` (atualiza também o escopo sugerido na Zona B para `source_id` ou Projeto inteiro).
  * Filtro de prontidão: `Todos`, `Com pendências`, `Prontos para publicar`, `Apenas Corte direto`, `Apenas Vídeo transformado`.

#### Zona A — Mesa de Prontidão (Grade de Cortes aprovados)
* **Origem dos dados:**
  1. `sources.list { project }` → Fontes (`id`, `status`, `metadata`, `permission`, `origin_url`).
  2. `selection.list { source_id }` + `selection.get { run }` + `selection.review { run }` → candidatos com `status === "approved"` (`candidate`, `startId`, `endId`, `startUs`, `endUs`, `adjusted`, `videoKind` da execução, `title` e `total` do candidato).
  3. Por Corte aprovado (somente leitura na mesa):
     * `packaging.get { candidate }` → `current.title`, `current.description`, `chapters.status`, `credit.warning`.
     * `thumbnail.get { candidate }` → `current.instantUs`, `current.origin`.
     * Quadro de capa renderizado via protocolo de mídia (`clipes-media` / loopback) a partir do proxy/thumb do Corte em `current.instantUs` (ou do meio do Corte com selo *"Sem capa escolhida"*).
     * `guardrails.check { scope: "single", source_id, candidate_id, start_id, end_id }` (ou derivado quando carregado sob demanda; ver Lacunas) → estado de Roteiro (`script.approved`, `script.pendingBlocks`), Narração (`narration.generatedBlocks`, `narration.freezeTailUs`, `narration.longFreezeTail`), áudio (`audio.unverifiedCount`), duração (`over60s`).
* **Conteúdo de cada cartão de Corte na grade (ordem de leitura):**
  1. **Miniatura 9:16** (ou proporção contida) + selo de tipo (**Corte direto** ou **Vídeo transformado**) + duração formatada (`mm:ss`, em `tabular-nums`).
  2. **Título:** `packaging.current.title`; se `packaging.current === null`, exibe `candidate.title` com etiqueta textual *"Título sugerido (sem Empacotamento)"*.
  3. **Origem e Permissão:** nome da Fonte + estado da Permissão (`Permissão registrada` com `who · where`, ou `Sem Permissão`) + selo de saúde da Fonte se `status !== "available"` (`Fonte offline` ou `Fonte alterada`).
  4. **Glifos de pendência (ícone + rótulo curto, nunca só por cor):**
     * **Capa:** `Capa escolhida` (ícone ✓) vs. `Sem capa` (ícone ⚠).
     * **Empacotamento:** `Empacotado` vs. `Sem Empacotamento`.
     * **Permissão:** `Com Permissão` vs. `Sem Permissão`.
     * **Transformação** (apenas se **Vídeo transformado**): `Roteiro aprovado` vs. `Roteiro pendente` (`pendingBlocks` blocos); `Narração pronta` vs. `Narração pendente`; se `longFreezeTail`: `Sobra final > 5 s`.
     * **Riscos:** `Áudio sem licença` (se `audio.unverifiedCount > 0`); `Acima de 60 s` (se `durationUs > 60_000_000`); `Fonte indisponível` (se `offline`/`changed`).
  5. **Barra de ações rápidas do cartão:**
     * Botão primário contextual conforme a primeira pendência (ou *"Editar"* se pronto):
       * Se Fonte `offline`/`changed` → *"Relocalizar Fonte"* (`#/projeto/:id/fontes/:fonteId`).
       * Se Vídeo transformado com Roteiro/Narração pendente → *"Transformar"* (`#/projeto/:id/corte/:corteId/transformar`).
       * Se sem Empacotamento/Capa → *"Empacotar"* (`#/projeto/:id/corte/:corteId/empacotar`).
       * Caso contrário → *"Editar Corte"* (`#/projeto/:id/corte/:corteId/editar`).
     * Ações secundárias (ícones com tooltip/menu): *"Abrir no Editor"* (`#/projeto/:id/corte/:corteId/editar`), *"Empacotar"* (`#/projeto/:id/corte/:corteId/empacotar`) e *"Exportar só este"* (`export.start` via mesmo modal pré-exportação de `guardrails.check` do `<ContextoCorte>`).

#### Zona B — Configuração e Disparo da Exportação em Lote
* **Escopo do lote:**
  * Mostra automaticamente *"Todo o Projeto (N Cortes aprovados)"* ou *"Fonte: <nome> (M Cortes aprovados)"* conforme filtro de Fonte ativo (com alternador explícito para o usuário nunca exportar 1 Corte achando que são todos, nem vice-versa).
  * Se houver Fontes `offline` ou `changed` entre os aprovados, exibe aviso explícito: *"K Cortes estão com a Fonte offline ou alterada e falharão até serem relocalizados."*
* **Pasta de saída:**
  * Campo de caminho somente leitura + botão **"Escolher pasta…"** (`open({ directory: true })`), pré-carregado com `export.settings().last_directory`.
  * Nota informativa fixa: *"Formato de saída: MP4 1080×1920 (H.264), áudio normalizado (-14 LUFS / -1 dBTP), sem marca d'água. Arquivos serão nomeados `<fonte>-<nn>-<tempo>.mp4`."*
* **Encoder e Fallback (`export.encoder.status`):**
  * Exibe status atual:
    * Se `ffmpeg === false`: alerta com CTA *"Instalar FFmpeg em Componentes"* (`#/config/componentes`).
    * Se `detected === false`: *"Encoder ainda não testado — será usado CPU (x264) ou o mais rápido após teste."* + link *"Detectar encoder"* (`#/config/exportacao`).
    * Se `detected === true`: mostra `effective` traduzido (ex.: `Hardware NVIDIA (NVENC)` / `Intel Quick Sync (QSV)` / `AMD AMF` / `VideoToolbox` / `CPU (x264)`) + estado `manual` vs `automático` + aviso se `stale === true` (*"Driver ou FFmpeg alterado — reteste recomendado"*).
    * Nota de resiliência: *"Se o encoder de hardware falhar durante o render, o Clipes refaz o item automaticamente com CPU (x264) e registra o aviso no lote."*
    * **Nota técnica / Lacuna documentada:** em exportações individuais (`export.status`), o núcleo hoje ainda não devolve `encoder_fallback` (lacuna #1 da arquitetura); nos lotes (`export.batch.status`/`list`), o campo `encoderFallback` funciona por item.
* **Checklist de guarda-corpos (`guardrails.check` no escopo `"project"` ou `"source"`):**
  * Bloco recolhível/expansível **aberto por padrão** quando há avisos relevantes (`needsDirectNotice`, `permission.missingCount > 0`, `script.unapprovedCount > 0`, `audio.unverifiedCount > 0`, `over60sCount > 0`, `narration.longFreezeTailCount > 0`):
    * Rótulo explícito: *"Checklist informativo — nenhum item bloqueia a exportação."*
    * Tipo do vídeo (`direct` / `transformed` / `mixed`) + aviso fixo *"Legenda, crop, filtros e trilha importada não contam como Transformação."*
    * Permissão das Fontes (`grantedCount` de `totalCount`, `missingCount` sem permissão).
    * Roteiro e Narração (`approvedCount` de `transformedCount`; `ttsCutCount` com TTS e lembrete de divulgação de conteúdo sintético realista; `freezeTailCount` / `longFreezeTailCount` com `maxFreezeTailUs`).
    * Música com claim e áudio importado (`unverifiedCount` sem licença; `over60sCount` acima de 60 s).
    * Se `needsDirectNotice === true`, mostra também botão/estado *"Aviso de monetização do Corte direto pendente — será exibido ao confirmar exportação"*.
* **Botão primário de disparo:**
  * **"Exportar N aprovados em lote"** (ou *"Exportar M da Fonte em lote"*). Desabilitado apenas se `N === 0` ou `!outputDir` ou `!ffmpeg`.

#### Zonas C e D — Histórico de Lotes (`?sub=lotes`)
* **Zona C (Lista de lotes, `export.batch.list`):**
  * Cartões/linhas ordenados do mais recente ao mais antigo: ID `#<id>`, timestamp, escopo (`Projeto inteiro` ou nome da Fonte), barra de progresso ponderada (`progress%`), resumo (`completed`/`total` concluídos, contagem de falhas/cancelados) e badge de status (`Em andamento`, `Concluído`, `Concluído com falhas`, `Falhou`, `Cancelado`).
* **Zona D (Detalhe do lote selecionado, `export.batch.status`):**
  * Cabeçalho com pasta de destino (`outputDir`), botão **"Abrir pasta"** (`openPath` / `openUrl`), botão **"Cancelar lote"** (`export.batch.cancel`, visível apenas quando `state === "running"`).
  * Barra de progresso geral ponderada pela duração + resumo de contagens (`queued`, `running`, `completed`, `failed`, `cancelled`).
  * Tabela/grid (`role="grid"`) de itens do lote (`items`):
    * Título do Corte + nome do arquivo gerado (`filename`).
    * Duração (`durationUs` formatado em `tabular-nums`).
    * Estado (`Na fila`, `Exportando`, `Exportado`, `Falhou`, `Cancelado`) + barra `progress%` individual quando `running`.
    * Encoder utilizado (`encoder`) + badge explícito se `encoderFallback != null`: *"Caiu para x264 (de `<from>`: `<reason>`)"*.
    * Se `state === "failed"`: mensagem humana traduzida do `error.code` + botão de recuperação (ex.: *"Relocalizar Fonte"*, *"Abrir Corte"*).
    * Se `state === "completed"`: ação **"Abrir arquivo"** / **"Mostrar na pasta"**.

### 1.4 Ações

| Ação do usuário | Comando(s) do núcleo | Pré-condições | Confirmação / Cartão de custo | O que muda na tela depois | Desfazer |
|---|---|---|---|---|---|
| Carregar Mesa de Prontidão | `sources.list`, `selection.list`, `selection.get`, `selection.review`, `packaging.get`, `thumbnail.get`, `guardrails.check`, `export.settings`, `export.encoder.status`, `export.batch.list` *(lazy-loading paginado por página/viewport + cache no Store de Projeto Ativo até existir `export.readiness`)* | Projeto aberto | Nenhuma (local, US$ 0,00) | Preenche grade de aprovados, pendências, pasta padrão e checklist | — |
| Escolher pasta de saída | Diálogo nativo de pasta (`@tauri-apps/plugin-dialog`) | Nenhuma | Nenhuma | Atualiza campo `outputDir` na Zona B (só persiste no núcleo ao iniciar export) | — |
| Abrir edição rápida do Corte | Navegação para `#/projeto/:id/corte/:corteId/(editar\|transformar\|empacotar)` | Corte aprovado | Nenhuma | Sai para a rota do Corte selecionado | Botão Voltar / histórico do navegador |
| Exportar em lote (disparo) | 1) Se `needsDirectNotice`: `guardrails.ack_direct_notice` <br> 2) `export.batch.start { output_dir, source_id?, project, confirmed? }` | `N >= 1` aprovado, `output_dir` existente, FFmpeg instalado | 1) `<ConfirmDialog>` único por canal para risco de Corte direto (se `needsDirectNotice`). <br> 2) Se retornar `confirmation_required` (`usage.conflicts`), `<ConfirmDialog>` listando arquivos que serão sobrescritos (`confirmed: true`). Custo: **US$ 0,00 (local)**. | Enfileira N jobs `export`, atualiza `export.settings.last_directory`, alterna para `?sub=lotes` (ou destaca lote ativo) e exibe barra de progresso em tempo real | Cancelar lote (`export.batch.cancel`) para itens ainda não concluídos |
| Exportar Corte individual (menu do card *"Exportar só este"*) | `guardrails.check`, `export.captions`, `export.settings` → `export.start { source_id, start_id, end_id, candidate_id, output }` | Fonte `available`, FFmpeg instalado, sem glifos faltando | Abre o mesmo modal pré-exportação de `guardrails.check` do Pacote D (com `guardrails.ack_direct_notice` se `needsDirectNotice` e destino `.mp4`). Custo: **US$ 0,00 (local)**. | Enfileira job `export`, abre progresso na Fila de Jobs e consulta `export.status` | `jobs.cancel { id }` |
| Cancelar lote em andamento | `export.batch.cancel { id }` | Lote com `state === "running"` | `<ConfirmDialog>` simples (*"Cancelar exportação do lote? Cortes já concluídos serão mantidos."*) | Marca lote como `cancelled` e cancela jobs pendentes/em andamento | Não (disparar novo lote se necessário) |
| Abrir pasta / arquivo exportado | Ação do SO (`opener` do Tauri) | Pasta/arquivo existe no disco | Nenhuma | Abre gerenciador de arquivos do SO na pasta ou reproduz MP4 | — |

### 1.5 Estados

* **Carregando (`loading`):**
  * Em `?sub=prontidao`: exibe grade de 6 cartões `<Skeleton>` (proporção miniatura + 3 linhas + 2 badges) na Zona A e `<Skeleton>` de linhas na Zona B. Nunca exibe `"Nenhum Corte aprovado"` durante carga.
  * Em `?sub=lotes`: exibe 3 linhas `<Skeleton>` na Zona C e 4 linhas na Zona D.
* **Vazio (`empty`):**
  * Sem Cortes aprovados no Projeto: título **"Nenhum Corte aprovado para exportar"**, descrição *"Aprove candidatos na etapa de Cortes para conferi-los aqui antes de renderizar em lote."* e 1 CTA primário **"Ir para Cortes"** (`#/projeto/:id/cortes`).
  * Com filtro ativo retornando 0 cards: *"Nenhum Corte aprovado corresponde aos filtros selecionados."* + botão **"Limpar filtros"**.
  * Histórico de lotes vazio (`?sub=lotes`): título **"Nenhum lote exportado ainda"** e CTA **"Voltar para Prontidão e Lote"**.
* **Erro (`error`):** container `role="alert"` usando o mapeador central (detalhes técnicos recolhidos em *"Ver detalhe técnico"*):

| `CoreError.code` | Texto humano na UI | Ação de recuperação |
|---|---|---|
| `project_not_open` | Nenhum Projeto está aberto no momento. | Botão *"Ir para Início"* (`#/inicio`). |
| `export_batch_empty` | Não há Cortes aprovados neste escopo para exportar. | Botão *"Ir para Cortes"* (`#/projeto/:id/cortes`). |
| `export_destination` | A pasta escolhida não existe ou não pode receber arquivos. | Botão *"Escolher outra pasta"*. |
| `component_missing` | Falta instalar o FFmpeg para exportar vídeos. | Botão *"Instalar em Componentes"* (`#/config/componentes`). |
| `export_ass_missing` | O FFmpeg instalado não tem suporte a legendas (libass). | Botão *"Revisar FFmpeg em Componentes"* (`#/config/componentes`). |
| `export_font_missing` | A fonte configurada para a legenda não pôde ser carregada. | Botão *"Revisar estilo no Editor"*. |
| `export_glyph_missing` | A fonte da legenda não possui alguns caracteres usados no texto (ex.: `{missing_glyphs}`). | Botão *"Editar legenda do Corte"*. |
| `source_missing` / `source_changed` | A Fonte deste Corte foi movida, apagada ou alterada no disco. | Botão *"Relocalizar ou verificar Fonte"* (`#/projeto/:id/fontes/:fonteId`). |
| `audio_asset_missing` | Uma trilha sonora ou efeito sonoro do Corte não foi encontrado no disco. | Botão *"Abrir Áudio no Editor"*. |
| `export_exists` | Já existe um arquivo com esse nome na pasta de destino. | Botão *"Escolher outro nome ou pasta"*. |
| `export_bounds` / `export_candidate` | As bordas ou a aprovação deste Corte precisam ser revalidadas. | Botão *"Abrir na revisão de Cortes"*. |
| `insufficient_space` / `output_space_insufficient` | Espaço livre insuficiente no disco de destino. | Indica pasta + link *"Armazenamento"* (`#/config/componentes`). |
| `export_failed` | Falha ao renderizar o vídeo no FFmpeg. | Botão *"Ver detalhe técnico"* + *"Enviar para Relatos"* (`#/relatos`). |
| `batch_not_found` | Este lote de exportação não foi encontrado no Projeto. | Botão *"Recarregar histórico"*. |

* **Job rodando (`job_running`):**
  * A Mesa de Prontidão **permanece interativa** (usuário pode filtrar, inspecionar cards ou abrir um Corte no Editor) enquanto um banner compacto no topo ou a sub-visão `?sub=lotes` mostra o lote ativo (`progress%`, contagem `X de Y` e botão **Cancelar lote**).
* **Parcial (`partial`):**
  * Quando `batch.status === "partial"` (ex.: 7 exportados e 1 ou mais falharam por Fonte alterada ou erro de item): faixa informativa no topo do detalhe do lote: *"Lote concluído parcialmente: {completed} de {total} Cortes exportados e {failed} com falha."* com filtro rápido *"Mostrar apenas falhas"* e ação individual de recuperação por item.
* **Sem permissão / pré-condição:**
  * Sem Permissão da Fonte: **não bloqueia** a exportação (ADR-0001 / guarda-corpos informativos), mas exibe selo persistente **"Sem Permissão"** no card e no checklist (`"K de N Cortes sem Permissão registrada — risco de claim ou strike"`).
  * FFmpeg ausente (`!encoderStatus.ffmpeg`): botão de exportar fica bloqueado com banner claro no painel direito e CTA *"Instalar FFmpeg"* (`#/config/componentes`).

### 1.6 Eventos (`core-progress`)

O store central da Fila de Jobs recebe e distribui para a tela:
* `job: "export-batch-<id>"`, `stage: "export_batch"` → atualiza barra de progresso ponderada (`percentage`) e dispara refresh leve de `export.batch.status { id }` para atualizar estados por item.
* `job: "export-batch-<id>"`, `stage: "export_batch_complete"` → atualiza lote para estado final (`completed` / `partial` / `failed`), atualiza contadores da aba e dispara toast + notificação do SO (se sem foco).
* `job: "export-batch-<id>"`, `stage: "export_batch_cancelled"` → atualiza lote para `cancelled` e limpa estado de ativo.
* `job: "<job_id>"` (numérico), `stage: "export"` (1..99) e `"complete"` (100) / `"failed"` (0) → atualiza progresso do item correspondente (`item.jobId === Number(job)`) na Zona D em tempo real, sem polling por `setInterval`.

### 1.7 Teclado e acessibilidade

* **Regiões para `F6` / `Shift+F6`:**
  1. Barra Superior do Shell (`<header>`)
  2. Sub-barra da etapa e filtros (`<nav aria-label="Visões de Exportação">`)
  3. Zona principal esquerda (Grade de Prontidão ou Lista de Lotes, `<main>`)
  4. Painel lateral direito (Configuração de Lote ou Detalhe do Lote, `<aside>`)
  5. Barra de Status (`<footer>`)
* **Padrões WAI-ARIA APG:**
  * Abas `Prontidão e Lote` / `Histórico de lotes`: `role="tablist"`, `role="tab"`, `aria-selected`, `role="tabpanel"` (setas `←`/`→` alternam abas).
  * Grade de Prontidão: `role="region"` com lista de cartões `<article>` navegável por `Tab` / `Shift+Tab` (evitar `grid` complexo quando os cartões têm múltiplos botões internos, garantindo alvos ≥ 24×24 CSS px e ordem de foco previsível: miniatura/título → ações rápidas).
  * Tabela de itens do lote (Zona D): `role="grid"` ou `<table>` semântica com `scope="col"`, timecodes e percentuais com `tabular-nums`.
  * Barras de progresso: `<progress>` ou `role="progressbar"` com `aria-valuenow`, `aria-valuemin="0"`, `aria-valuemax="100"` e `aria-label` descritivo (ex.: *"Progresso do lote #5"*).
  * Checklist expansível: `<details>`/`<summary>` ou botão com `aria-expanded` e `aria-controls`.
  * Anúncios: conclusão/erro de lote usa `role="status"` (`aria-live="polite"` com throttle) e erros críticos usam `role="alert"`.
  * Estado nunca só por cor (SC 1.4.1): todo glifo de pendência combina ícone distinto + rótulo textual visível (ou `aria-label` + texto curto).
* **Atalhos da tela:**
  * Herda todos os globais (`Ctrl/Cmd+K` Paleta, `Ctrl/Cmd+J` Fila de Jobs, `Ctrl/Cmd+,` Configurações, `F6`/`Shift+F6` regiões, `?` ajuda). Nenhum atalho de tecla única conflita com filtros de texto.

### 1.8 US do #26 atendidas

* **US-15** (encoder detectado + fallback x264), **US-47** (visibilidade de Permissão), **US-102** (aviso único de monetização de Corte direto), **US-103** (checklist de originalidade), **US-104** (aviso de música com claim), **US-105** (orientação de divulgação de IA), **US-106** (export 1080×1920), **US-107** (exportação em lote com progresso), **US-108** (-14 LUFS / -1 dBTP), **US-109** (sem marca d'água), **US-110** (visibilidade da capa escolhida).

### 1.9 Lacunas (Núcleo Rust e Mock TS)

* **Núcleo Rust:**
  1. **Bug de `export.status` sem `encoder_fallback` (`core/src/export.rs:1125-1138`):** a consulta SQL lê `e.encoder`, `e.fallback_from` e `e.fallback_reason`, mas o JSON serializado devolve apenas `job`, `state`, `progress`, `output` e `error`. Sem corrigir isso, exportações individuais (disparadas do Editor, Empacotar ou menu do cartão) não conseguem informar ao usuário que o render caiu para `libx264` em CPU. *(Nos itens de `export.batch.status`/`list`, `encoderFallback` já é retornado.)*
  2. **Falta comando agregado de prontidão do Projeto (`export.readiness` ou similar):** hoje montar a Mesa de Prontidão exige encadear `sources.list` → `selection.list` → `selection.review` → `packaging.get`, `thumbnail.get` e `guardrails.check` para cada candidato aprovado. Em Projetos com dezenas de Fontes e 50+ Cortes aprovados, isso gera centenas de dispatches iniciais.
  3. **`export.settings` é somente leitura:** não há `export.settings.set`, então escolher uma pasta na UI não a persiste se o usuário sair antes de iniciar o lote.
  4. **Falta cálculo de ETA no núcleo:** `export.batch.status` e `core-progress` enviam `percentage`, mas não `etaMs` / `startedAtMs`, exigindo estimativa no front-end.
* **Mock TS (`src/lib/core.ts`, `src/features/export/mock.ts`):**
  1. `src/features/export/mock.ts` não possui handler explícito para `export.status` (cai no ramo genérico de `jobs`) e já retorna `encoder_fallback`, divergindo do Rust atual; precisa alinhar contrato e suportar cenário simulado de fallback (`?estado=fallback`).
  2. Os mocks de `sources.list`, `selection.list`, `selection.review`, `packaging.get`, `thumbnail.get` e `guardrails.check` em `src/lib/core.ts` estão atrás de query params (`?source-test=1`, `?transcript-test=1`) e `guardrails.check` em escopo `project` usa nomes divergentes (`applicable`/`totalUnverified` em vez de `hasAudio`/`unverifiedCount` e omite `freezeTail*`). Precisam estar ativos por padrão com Projeto de demonstração completo.
  3. Simular eventos `core-progress` reais (`export`, `export_batch`, `export_batch_complete`, `export_batch_cancelled`) ao chamar `export.start`, `export.batch.start` e `export.batch.cancel` no mock.

### 1.10 Critérios de aceite (E2E / Playwright com mock)

1. Com Projeto aberto no estado padrão e `?estado=carregando`, a rota `#/projeto/demo/exportacao` exibe os `<Skeleton>` da grade e do painel de saída sem mostrar texto de lista vazia.
2. Com `?estado=vazio`, a tela exibe **"Nenhum Corte aprovado para exportar"** e o botão **"Ir para Cortes"** leva a `#/projeto/demo/cortes`.
3. No estado padrão (`ready`), a grade mostra todos os Cortes aprovados com título, selo de tipo (`Corte direto` ou `Vídeo transformado`), duração em `tabular-nums`, status de Permissão e glifos de pendência (ícone + texto).
4. Clicar em **"Empacotar"** ou **"Transformar"** em um cartão com pendência navega para a rota exata daquele Corte (`#/projeto/demo/corte/:cid/empacotar` ou `/transformar`), e o botão **"Voltar"** retorna à Mesa de Prontidão.
5. O checklist informativo de `guardrails.check` exibe os contadores reais de Permissão, Roteiro, áudio sem licença e Cortes > 60 s sem bloquear o botão **"Exportar N aprovados em lote"**.
6. Quando `needsDirectNotice === true`, clicar em **"Exportar N aprovados em lote"** abre primeiro o `<ConfirmDialog>` de aviso único de Corte direto; ao confirmar, chama `guardrails.ack_direct_notice` e em seguida `export.batch.start`.
7. Quando `export.batch.start` retorna `confirmation_required` com `usage.conflicts`, um `<ConfirmDialog>` lista os nomes dos arquivos conflitantes e só sobrescreve após confirmação (`confirmed: true`).
8. Durante `export.batch.start`, a sub-visão `?sub=lotes` (ou banner) atualiza o progresso ponderado e o progresso individual por item via eventos `core-progress` simulados, e exibe o selo de fallback x264 no item quando `encoderFallback` estiver presente.
9. Clicar em **"Cancelar lote"** e confirmar no `<ConfirmDialog>` chama `export.batch.cancel` e atualiza o status do lote para **Cancelado**.
10. Com `?estado=erro` (ex.: `component_missing`), exibe `role="alert"` com texto humano sem código cru exposto e botão **"Instalar em Componentes"** levando para `#/config/componentes`.

---

## 2. Painel Global da Fila de Jobs

### 2.1 Objetivo e navegação (rotas)

* **Objetivo:** Centralizar o acompanhamento e o controle de todas as tarefas longas do app em um único painel não bloqueante — jobs persistidos do Projeto (`jobs.*`), Lotes de Fontes (`batches.*`), Lotes de exportação (`export.batch.*`), pausas de orçamento (`jobs.budget.*`) e downloads/operações globais — destacando decisões obrigatórias para jobs `uncertain` e evitando perda de trabalho ao fechar o app.
* **Onde vive / Como abre:**
  * Superfície global montada no **Shell Global** (acessível de qualquer rota: `#/inicio`, etapas do Projeto, Editor do Corte, `#/config/*`, `#/relatos`, `#/sobre`).
  * Aberta/fechada pelo **Botão Global da Fila de Jobs** na Barra Superior, pelo resumo de job na Barra de Status, pelo atalho `Ctrl/Cmd+J` ou pela Paleta `Ctrl/Cmd+K`.
  * Não possui rota hash obrigatória (é um painel/gaveta lateral direita sobreposta/acoplada não modal ou modal não bloqueante de navegação, permitindo continuar editando outro Corte enquanto aberta; `Esc` fecha quando o foco está dentro dela).

### 2.2 Layout por zonas

#### Variação 1366 px (Gaveta lateral direita sobreposta ao conteúdo) e 1440+ px (Painel acoplável mais largo)

```text
+------------------------------------------------------------------------------+
| [Shell: Barra Superior] ... [Somente local] [Orçamento] [Fila: 2 ativos ⚠1]  |
+------------------------------------+-----------------------------------------+
| Conteúdo da rota atual             | GAVETA DA FILA DE JOBS (Ctrl+J)     [X] |
| (permanece navegável e visível     |-----------------------------------------|
|  à esquerda)                       | Projeto ativo: Canal Cortes X           |
|                                    |-----------------------------------------|
|                                    | ZONA 1: Alertas Prioritários            |
|                                    | ! 1 chamada paga com resultado incerto  |
|                                    |   [Revisar abaixo]                      |
|                                    | ! Orçamento pausou: Seleção (teto US$ 2)|
|                                    |   Gasto: US$ 2,04 / US$ 2,00            |
|                                    |   [Ajustar orçamento e continuar]       |
|                                    |-----------------------------------------|
|                                    | ZONA 2: Filtros                         |
|                                    | [Todos (8)] [Ativos (2)] [Atenção (2)]  |
|                                    |-----------------------------------------|
|                                    | ZONA 3: Lista Unificada (rolagem vert.) |
|                                    | -- Ação necessária (uncertain) -------- |
|                                    | • Seleção de Cortes (#14 · OpenAI GPT)  |
|                                    |   Estado: Resultado incerto             |
|                                    |   "Resposta demorou; não repita às cegas|
|                                    |   [Ver estimativa e repetir] [Descartar]|
|                                    |                                         |
|                                    | -- Em execução / Na fila -------------- |
|                                    | • Exportação em lote #5 (5/12 · 45%)    |
|                                    |   [======------] 45%   [Cancelar lote]  |
|                                    | • Transcrição local — Live 15/11 (64%)  |
|                                    |   [========----] 64% · ~4 min restantes |
|                                    |   [Cancelar]                            |
|                                    | • Download: Modelo Whisper Turbo (72%)  |
|                                    |   Global · [=========---] 72% [Cancelar]|
|                                    |                                         |
|                                    | -- Concluídos e falhos recentes ------- |
|                                    | • Roteiro (#12 · Claude) — Concluído    |
|                                    |   [Ver resultado] [Refazer com Perfil]  |
|                                    | • Exportação (#11) — Concluído          |
|                                    |   [Abrir pasta]                         |
+------------------------------------+-----------------------------------------+
```

* Em **1440+ px**, a gaveta pode expandir para largura mais confortável exibindo lado a lado os dados de custo da tarefa/lote e botões de ação sem quebra de linha.
* Quando **não há Projeto aberto**, a gaveta oculta as seções de Projeto (`jobs.*`, `batches.*`, `export.batch.*`), exibe aviso curto *"Nenhum Projeto aberto. Abra um Projeto para acompanhar transcrições, seleções e exportações."* e mantém visível a trilha de **Operações Globais** (downloads de Componentes, modelos, TTS, sonda de hardware).

### 2.3 Conteúdo e componentes

#### Indicador Global no Shell (gatilho fechado)
* **Barra Superior:** botão com ícone + contador de ativos + selo de prioridade se houver `uncertain > 0` (alerta visual + texto *"1 incerto"* para leitores de tela) ou `ai_pauses > 0` (*"Orçamento pausado"*).
* **Barra de Status:** resumo em texto de 1 linha do job em execução no momento (ex.: `Transcrição: 64% · ~4 min restantes` ou `Sem tarefas em execução`), clicável para abrir a gaveta.

#### Zona 1 — Alertas Prioritários (topo da gaveta)
* **Banner de jobs `uncertain` (ADR-0005 / ADR-0009):** aparece sempre que houver qualquer item em `jobs.list` com `state === "uncertain"`. Texto fixo de segurança: *"Uma ou mais chamadas pagas foram interrompidas ou expiraram. O Clipes nunca as repete automaticamente para evitar cobrança dupla."*
* **Banner de pausas de orçamento (`jobs.budget.get` + `jobs.list` `budgetPause`):** para cada entrada em `budgets` com `paused !== null`:
  * Mostra escopo (`Tarefa: <nome>` ou `Lote: <key>`), motivo traduzido (`budget_cost` → *"Teto de custo atingido"*, `budget_calls` → *"Teto de chamadas atingido"*, `budget_tokens` → *"Teto de tokens atingido"*, `time_budget_exhausted` → *"Tempo limite atingido"*, `cost_unknown` → *"Provedor sem preço conhecido — exige confirmação"*, `user` → *"Pausado manualmente"*).
  * Mostra consumo acumulado desde `since` (`usage.costLabel` ou USD, `usage.calls`, `usage.inputTokens + outputTokens`) vs. limite configurado (`maxCostMicroUsd`, `maxCalls`, `maxTokens`, `maxWallMs`).
  * Botão **"Ajustar orçamento e continuar"** → abre sub-formulário/diálogo inline para editar tetos ou marcar `resetUsage` / confirmar `cost_unknown` e chamar `jobs.budget.continue`.

#### Zona 2 — Abas/Filtros de visualização
* `Todos`, `Ativos e na fila` (`queued` + `running` + downloads globais + lotes ativos), `Atenção` (`uncertain` + `failed` + pausados), `Concluídos`.

#### Zona 3 — Lista Unificada (por tipo de trilha do Store)

1. **Jobs persistidos do Projeto (`jobs.list`):**
   * Campos exibidos:
     * **Nome humano do `kind`:** `preview` → *"Onda e miniaturas"*, `proxy` → *"Proxy de vídeo"*, `transcription` → *"Transcrição"*, `energy` → *"Energia do áudio"*, `chat` → *"Replay de chat"*, `reframe` → *"Reenquadramento 9:16"*, `narration` → *"Narração (TTS)"*, `narration_align` → *"Alinhamento da Narração"*, `narration_import` → *"Importação de Narração"*, `export` → *"Exportação de Corte"*, `ai:selection` / `ai:selection_transformed` → *"Seleção de Cortes"*, `ai:angles` → *"Sugestão de ângulos"*, `ai:script` / `ai:script_block` → *"Roteiro"*, `ai:packaging` → *"Empacotamento"*, `ai:thumbnail` → *"Ideia de capa"*, `ai:translation` → *"Tradução de legenda"*.
     * **Identificador:** `#<id>`, `profile` (quando `ai:*`), `batch` (quando pertence a um lote), `attempts` (se > 1).
     * **Estado e progresso:**
       * `queued` (sem `budgetPause`): *"Na fila"*
       * `queued` (com `budgetPause`): *"Pausado por orçamento"* ou *"Aguardando confirmação de custo"*
       * `running`: barra determinística (`progress%` em `tabular-nums`) + estágio atual de `core-progress` (ex.: `ai:<task>:prepare` *"Preparando"*, `call` *"Consultando Provedor"*, `verify` *"Verificando saída"*, `probe`, `transcribing`, `export`) + **ETA estimado** (quando disponível pela taxa de avanço no cliente; oculto ou *"Calculando…"* em etapas indeterminadas).
       * `uncertain`: destaque com explicação e botões **Tentar de novo com estimativa** + **Descartar**.
       * `completed`: *"Concluído"* + custo real (`cost` / `taskCost.costLabel` — exibe `"US$ 0,00"`, valor USD ou `"Consome a cota do plano"`).
       * `failed`: *"Falhou"* + causa traduzida do `CoreError.code` + botão de recuperação.
       * `cancelled`: *"Cancelado"*.
   * **Modais/Painéis auxiliares acionados a partir de um job:**
     * **Diálogo "Tentar de novo" (`jobs.estimate` → `jobs.retry`):** exibe `<ResumoCustoPrivacidade>` com `safety` (`local` vs `paid`) e `estimate` (`zero` / `usd` / `plan_quota` / `unknown`). Se `safety === "local"`, `jobs.retry` pode rodar sem confirmação extra; se `safety === "paid"`, exige confirmação explícita (`confirmed: true`).
     * **Diálogo "Refazer com outro Perfil" (`jobs.redo.estimate` → `jobs.redo`):** disponível para jobs `ai:*` em `completed`, `failed` ou `cancelled`. Lista os Perfis de `provider.profiles.list` (ocultando ou marcando incompatíveis se `Somente local` ativo), chama `jobs.redo.estimate { id, profileId }` ao selecionar e mostra `<ResumoCustoPrivacidade>` (`profile`, `paid`, `leavesMachine`, `estimate`) antes de confirmar `jobs.redo { id, profileId, confirmed }`.
     * **Diálogo "Resultado do job" (`jobs.result { id }`):** disponível para jobs `ai:*` com resultado salvo. Mostra `outcome`, `usage` (tokens, chamadas), `cost`, e `data` (ou `code` / `violations` em falha) formatado com opção de expandir JSON completo.

2. **Lotes de Fontes (`batches.list`):**
   * Exibe ID do lote, `status` (`running`, `paused`, `budget_paused`, `attention`, `completed`, `cancelled`), `engine` (`local` / `groq`), `videoKind`, contagens (`completed/total`, `paused`), teto de orçamento (`budget`) e barra de progresso agregada.
   * Controles do lote: **Pausar** (`batches.pause`), **Retomar** (`batches.resume`), **Cancelar** (`batches.cancel`), **Orçamento do lote** (`jobs.budget.set` / `jobs.budget.continue` com `scope: "batch"`).
   * Sublista expansível de Fontes do lote (`items`): cada item mostra `name`, `state` (`pending`, `transcribing`, `selecting`, `completed`, `paused`, `cancelled`), `progress%`, e se `state === "paused"` mostra `error` traduzido e botão **Retomar Fonte** (`batches.item.resume { id, sourceId }`). Se `batches.item.resume` retornar `uncertain_job`, direciona o foco ao job `uncertain` correspondente na fila!

3. **Lotes de Exportação (`export.batch.list`):**
   * Exibe lotes `running` ou recentes (`id`, escopo, `counts.completed/total`, `progress%`), botão **Cancelar lote** (`export.batch.cancel`) quando ativo e link **"Abrir em Exportação"** (`#/projeto/:id/exportacao?sub=lotes`).

4. **Operações Globais síncronas fora da fila SQLite (`project: null`):**
   * Alimentadas diretamente pelos eventos `core-progress` rastreados no Store:
     * **Componentes / Worker / Modelos ML** (`ffmpeg`, `yt-dlp`, `deno`, `pocket-tts`, `uv`, `worker`, `catalog`, `whisper-*`, `yunet`, `hardware-probe`, `transcription-estimate`): barra `0..100%` + botão **Cancelar** → `components.cancel { id }`.
     * **Modelos TTS** (`tts:<model_id>`): barra `0..100%` + botão **Cancelar** → `tts.models.cancel { id }` (sem o prefixo `tts:`).
     * **Download de Fonte por URL** (`sources.url.download`): barra `0..100%` + botão **Cancelar** → `sources.url.cancel { job }`.
     * **Verificação de hash / Relocalização / Cópia** (`source-hash`, `source-relocate`, `source-copy-original`, `source-copy-check`): barra `0..100%` + botão **Cancelar** → `sources.cancel { job }`.

#### Notificações e comportamento ao fechar o aplicativo
* **Notificações no app (Toast):**
  * Conclusão de `transcription`, `selection`, `export` ou `export.batch` exibe toast (`role="status"`, `aria-live="polite"`) com ação direta: *"Ir para Cortes"* / *"Abrir pasta"* / *"Ver na Fila"*.
  * Falhas ou pausas de orçamento (`ai:*:paused`) exibem alerta persistente até ação ou dispensa.
* **Notificações nativas do SO:**
  * Disparadas apenas quando a janela não está em foco (`!document.hasFocus()` / `document.hidden`) ao concluir ou pausar por erro/orçamento um job longo (`transcription`, `batches.*`, `export.batch.*`, `export`).
* **Fechamento da janela com jobs rodando:**
  * O adaptador Tauri (`src-tauri/src/main.rs`) intercepta `CloseRequested`, roda `editor.flush` sincronamente e bloqueia o fechamento se houver erro (`editor_save_failed`).
  * Quando há operação ativa no Store, a UI intercepta o pedido de fechamento com `<ConfirmDialog>` explicando claramente:
    * Se houver **download global ativo** ou **exportação em curso**: *"Uma exportação ou download está em andamento e será interrompido se você fechar agora."*
    * Se houver **chamada paga em execução (`running` e `safety === "paid"`)**: *"Há uma chamada paga ao Provedor em voo; ao reabrir o Projeto, ela ficará marcada como Resultado incerto para você decidir sem repetir às cegas."*
    * Se houver **jobs locais na fila**: *"Jobs locais na fila ficarão pausados e serão retomados automaticamente ao reabrir o Projeto."*
    * Ações: **"Continuar trabalhando"** (cancela fechamento) e **"Fechar mesmo assim"**.

### 2.4 Ações

| Ação do usuário | Comando(s) do núcleo | Pré-condições | Confirmação / Cartão de custo | O que muda na tela depois | Desfazer |
|---|---|---|---|---|---|
| Abrir / fechar Fila de Jobs | `jobs.list`, `batches.list`, `export.batch.list`, `jobs.budget.get` (se Projeto aberto) | Nenhuma | Nenhuma | Abre/fecha gaveta lateral e sincroniza estado | `Ctrl/Cmd+J` ou `Esc` |
| Cancelar job da fila | `jobs.cancel { id }` | Job `queued` ou `running` | Se `running` e `safety === "paid"`: `<ConfirmDialog>` avisando que pode virar `uncertain`. Se `queued` ou `local`: imediato. | Job passa a `cancelled` (ou `uncertain` se pago já enviado) | `jobs.redo` (se `ai:*`) |
| Repetir job `uncertain` | `jobs.estimate { id }` → `jobs.retry { id, confirmed }` | Job `state === "uncertain"` | Se `safety === "paid"`: `<ConfirmDialog>` com `<ResumoCustoPrivacidade>`. Se `local`: imediato. | Job retorna para `queued` e entra em execução | `jobs.cancel` enquanto na fila |
| Descartar job `uncertain` | `jobs.discard { id }` | Job `state === "uncertain"` | `<ConfirmDialog>` (*"Descartar chamada incerta? O job será marcado como cancelado e não será reenviado."*) | Job passa a `cancelled` e sai do banner prioritário | `jobs.redo` (se `ai:*`, gera novo job) |
| Refazer job `ai:*` com outro Perfil | `provider.profiles.list`, `jobs.redo.estimate { id, profileId }` → `jobs.redo { id, profileId, confirmed }` | Job `ai:*` em `completed`, `failed` ou `cancelled` | `<ConfirmDialog>` com `<ResumoCustoPrivacidade>` (perfil, saída da máquina, custo) se pago ou CLI não confirmado | Cria novo job `ai:<tarefa>` na fila e atualiza lista | `jobs.cancel` no novo job |
| Ver resultado do job `ai:*` | `jobs.result { id }` | Job `ai:*` existente | Nenhuma | Abre modal/painel com `outcome`, `usage`, `cost` e `data`/`violations` | Fechar diálogo |
| Ajustar orçamento e continuar | `jobs.budget.set` / `jobs.budget.continue` | Pausa em `ai_pauses` ou orçamento existente | Se `cost_unknown`: exige checkbox/confirmação explícita (`confirmed: true`) | Remove pausa em `ai_pauses` e worker retoma jobs `queued` | `jobs.budget.set` |
| Pausar / Retomar / Cancelar Lote de Fontes | `batches.pause`, `batches.resume`, `batches.cancel` | Lote existente | Em `batches.cancel`: `<ConfirmDialog>` | Atualiza estado do lote e dos itens | `batches.resume` (para pausa) |
| Retomar item pausado no Lote de Fontes | `batches.item.resume { id, sourceId, confirmed? }` | Item em `paused` e sem `uncertain` | Se `confirmation_required`: `<ConfirmDialog>` de custo | Reativa item para `transcribing`/`selecting` | — |
| Cancelar operação global | `components.cancel { id }` OU `tts.models.cancel { id }` OU `sources.url.cancel { job }` OU `sources.cancel { job }` | Operação global ativa | Nenhuma (ou `<ConfirmDialog>` para downloads grandes > 100 MB opcional) | Interrompe operação e remove da lista ativa | Reiniciar download na tela de origem |

### 2.5 Estados

* **Carregando (`loading`):** ao abrir a gaveta pela primeira vez com Projeto aberto, exibe 4 linhas `<Skeleton>` enquanto `jobs.list` / `batches.list` / `jobs.budget.get` carregam.
* **Vazio (`empty`):**
  * Sem Projeto aberto e sem operações globais: *"Nenhuma tarefa global em andamento. Abra um Projeto para acompanhar transcrições, seleções e exportações."* + CTA **"Ir para Início"** (`#/inicio`).
  * Projeto aberto sem jobs/lotes: *"Nenhuma tarefa registrada neste Projeto ainda. Importe uma Fonte ou dispare uma seleção para acompanhar aqui."*
* **Erro (`error`):** container `role="alert"` com tradutor central:

| `CoreError.code` | Texto humano na UI | Ação de recuperação |
|---|---|---|
| `local_only_violation` | Bloqueado pelo modo **Somente local**: este Perfil envia texto para fora da máquina. | Botão *"Escolher Perfil local"* (`jobs.redo`) ou *"Configurações"* (`#/config/projeto`). |
| `confirmation_required` | Esta operação paga ou de custo desconhecido aguarda sua confirmação. | Abre `<ResumoCustoPrivacidade>` para confirmar. |
| `job_uncertain` | Resolva primeiro o estado incerto deste job antes de refazê-lo. | Foca o card do job com botões *Repetir* / *Descartar*. |
| `job_not_redoable` | Aguarde o job terminar ou cancele-o antes de refazer com outro Perfil. | Botão *"Cancelar job"* ou *"Aguardar"*. |
| `task_version_changed` | A Tarefa de IA foi atualizada desde este job; dispare uma nova execução na tela de origem. | Link para a etapa correspondente (`Cortes` / `Corte`). |
| `profile_unavailable` / `invalid_profile` | O Perfil de Provedor escolhido não existe mais ou está incompleto. | Botão *"Configurar Provedores"* (`#/config/provedores`). |
| `uncertain_job` | Esta Fonte tem uma chamada paga incerta pendente na fila. | Rola/foca o job `uncertain` acima. |
| `budget_calls` / `budget_cost` / `budget_tokens` / `time_budget_exhausted` | O orçamento pausou a fila antes de ultrapassar o limite definido. | Botão *"Ajustar orçamento e continuar"*. |
| `invalid_budget` | Informe um limite numérico válido (maior ou igual a zero). | Foca campo do formulário de orçamento. |
| `project_busy` | Outra operação exclusiva está acessando o Projeto agora; tente novamente em instantes. | Botão *"Atualizar fila"*. |

* **Job rodando (`job_running`):** barra de progresso por item + atualização contínua pelo store único `core-progress` + ação **Cancelar** imediata.
* **Parcial (`partial`):** em Lotes de Fontes (`status: "attention"`) ou Lotes de exportação (`status: "partial"`), mantém a lista expansível com itens concluídos marcados e destaque nos itens `paused` / `failed` com botão individual de retomada/correção.
* **Sem permissão / pré-condição:** se um Perfil remoto for selecionado no diálogo `Refazer com outro Perfil` enquanto `Somente local` estiver ativo, exibe aviso inline explicando o veto (ADR-0010) e desabilita confirmação até escolher um Perfil `local (loopback)`.

### 2.6 Eventos (`core-progress`)

O Store único da Fila de Jobs assina `listen('core-progress', ...)` no arranque do app (1 único listener global) e reage a todas as 4 trilhas:
1. **Jobs numéricos do Projeto (`project === currentProjectId`):**
   * `waveform`, `thumbnails`, `proxy`, `export`, `timeline`, `energy`, `chat`, `narration`, `narration_align`, `narration_import`, `reframe`, `probe`, `gpu_probe_fallback`, `transcribing` → atualizam `progress` e `stage` do item em memória em tempo real.
   * `ai:<task>:prepare` (0%), `ai:<task>:call` (10%), `ai:<task>:verify` (80%) → atualizam etapa legível sem barra falsa.
   * `ai:<task>:paused` (0% + `error`) → dispara refresh de `jobs.list` + `jobs.budget.get`, exibe banner de orçamento e envia toast/notificação do SO.
   * `complete`, `failed`, `ai:<task>:done` → dispara refresh debounced de `jobs.list`, invalida cache do domínio afetado e dispara toast / notificação do SO quando aplicável.
   * *Exceção ignorada:* descarta eventos com `job === "0"` e `stage === "narration_record"` quando não houver job `0` na fila.
2. **Agregadores de Lote:**
   * `"batch-<id>"` (`batch:created`, `batch:item`, `batch:item-paused`, `batch:paused`, `batch:resumed`, `batch:cancelled`, `batch:completed`) → atualiza `batches.get` / `batches.list`.
   * `"export-batch-<id>"` (`export_batch`, `export_batch_complete`, `export_batch_cancelled`) → atualiza `export.batch.status` / `export.batch.list`.
   * `"selection-<id>"` (`selection:window`, `selection:done`) → atualiza progresso agregado da seleção e invalida `selection.list`/`get`.
3. **Operações globais (`project === null`):**
   * `download`, `update`, `install`, `probe`, `estimate`, `hash`, `vad`, `done`, `starting` → cria/atualiza entradas transitórias na seção **Operações Globais** e remove ao receber `complete`/`failed` (ou erro do comando).
4. **Integridade do Editor:**
   * `stage === "editor_saved"` / `"editor_save_failed"` → atualiza Barra de Status do shell (e emite alerta se falhar).

### 2.7 Teclado e acessibilidade

* **Região para `F6`:** quando a gaveta está aberta, integra o ciclo `F6` / `Shift+F6` como uma região dedicada (`<aside aria-label="Fila de Jobs">`).
* **Padrões WAI-ARIA APG:**
  * Se for gaveta não modal acoplada: `role="complementary"` com `aria-labelledby` e botão explícito `Fechar (Esc)`. Foco retorna ao gatilho da Barra Superior ao fechar via `Esc` ou botão `X`.
  * Lista de jobs: `role="grid"` (ou `role="treegrid"` quando lotes são expandidos) com navegação por `↑`/`↓` entre linhas e `←`/`→` para expandir/recolher itens de lote, ou lista de cartões estruturada com `<ul>`/`<li>` e `aria-label` claro por item.
  * Filtros: `role="tablist"` (`Todos`, `Ativos`, `Atenção`, `Concluídos`).
  * Diálogos (`ConfirmDialog` de Retry/Discard/Redo/Fechar app e Resultado do job): `@base-ui/react/alert-dialog` / `dialog` com armadilha de foco (`focus trap`) e retorno de foco ao botão acionador.
  * Barras de progresso: `role="progressbar"` com `aria-valuenow`, `aria-valuetext` (ex.: `"64%, aproximadamente 4 minutos restantes"`).
  * `role="status"` com `aria-live="polite"` com throttle (nunca anunciar cada porcentagem); mudanças críticas (`uncertain`, falha, pausa de orçamento) usam `role="alert"`.
* **Atalhos:** `Ctrl/Cmd+J` abre/fecha em qualquer tela; `Esc` fecha quando o foco está dentro da gaveta ou de algum diálogo dela.

### 2.8 US do #26 atendidas

* **US-28** (estimativa antes e custo real depois), **US-29** (teto de orçamento que pausa a fila), **US-30** ("consome a cota do plano" para CLI), **US-31** (refazer com outro Perfil sem fallback automático), **US-32** (erro no Lote de Fontes pausa só aquela Fonte), **US-33** (nunca repetir `uncertain` pago às cegas), **US-49** (acompanhar Lotes de Fontes), **US-51** (progresso e cancelamento de todas as etapas).

### 2.9 Lacunas (Núcleo Rust e Mock TS)

* **Núcleo Rust:**
  1. **Ausência de `etaMs` / `startedAtMs` em `jobs.list` e `ProgressEvent`:** hoje não existe timestamp de início do job na resposta de `jobs.list` (`core/src/jobs.rs:223`), impedindo cálculo preciso de ETA após recarregar ou reabrir a gaveta; o front estima apenas para jobs observados desde o início da sessão.
  2. **Comando único de eventos globais / reidratação:** operações síncronas globais (`components.download`, `sources.url.download`) existem apenas na memória do store enquanto a janela está aberta; se a WebView recarregar durante um download, não há comando `components.active_jobs` para reidratar progresso em curso.
  3. **Falta identificador de Corte/Fonte legível em `jobs.list`:** `jobs.list` retorna `kind`, `batch`, `profile`, mas não um rótulo legível do alvo (ex.: nome da Fonte ou título do Corte) para mostrar na fila sem cruzar manualmente `jobs.result` ou outras tabelas.
* **Mock TS (`src/lib/core.ts`, `src/lib/batchMock.ts`, `src/features/export/mock.ts`):**
  1. `jobs.list`, `jobs.estimate`, `jobs.retry` e `jobs.discard` em `src/lib/core.ts` dependem de `?source-test=1` e retornam vazio sem ele.
  2. `jobs.budget.get`, `jobs.redo`, `jobs.redo.estimate` e `jobs.result` **não existem no mock TS** (lançam `Unknown core command`).
  3. `jobs.budget.set` e `jobs.budget.continue` em `src/lib/batchMock.ts` só suportam `scope: "batch"` e retornam `view(batch).budget` em vez de `{ budgets: [...] }` como o Rust; precisam suportar `scope: "task"` e retornar `{ budgets: [...] }`.
  4. `components.cancel`, `sources.cancel` e `sources.url.cancel` **não existem no mock TS**.

### 2.10 Critérios de aceite (E2E / Playwright com mock)

1. Pressionar `Ctrl+J` (ou clicar no botão da Fila na Barra Superior) a partir de qualquer rota abre a gaveta da Fila de Jobs sem tirar o usuário da rota atual; pressionar `Esc` fecha e devolve o foco ao gatilho.
2. Com um job em `state === "uncertain"` e `safety === "paid"`, o banner prioritário aparece no topo da Fila com o aviso de que chamadas pagas não são repetidas às cegas.
3. Clicar em **"Tentar de novo com estimativa"** no job `uncertain` chama `jobs.estimate`, abre `<ConfirmDialog>` exibindo `<ResumoCustoPrivacidade>` (destino, perfil, faixa USD/cota/desconhecido) e só chama `jobs.retry { confirmed: true }` após confirmação.
4. Clicar em **"Descartar"** no job `uncertain` pede confirmação em `<ConfirmDialog>` e chama `jobs.discard`, removendo o job do banner prioritário.
5. Quando `jobs.budget.get` retorna uma pausa ativa (`paused: "budget_cost"`), o banner de orçamento aparece e **"Ajustar orçamento e continuar"** chama `jobs.budget.continue` removendo a pausa.
6. Em um job `ai:selection` concluído ou falho, clicar em **"Refazer com outro Perfil"** chama `jobs.redo.estimate`, exibe `<ResumoCustoPrivacidade>` e enfileira o novo job via `jobs.redo`.
7. Em um job `ai:*` concluído, clicar em **"Ver resultado"** chama `jobs.result` e exibe `outcome`, `usage` e `cost` num diálogo acessível.
8. Ao simular tentativa de fechar a janela com um job de exportação ou download global em execução, o diálogo de confirmação lista exatamente o impacto em downloads, jobs locais e chamadas pagas antes de confirmar saída.

---

## 3. Relatos e Diagnóstico

### 3.1 Objetivo e navegação (rotas)

* **Objetivo:** Permitir ao usuário relatar um bug, sugerir uma ideia ou propor um novo Provedor/modelo montando um diagnóstico local estritamente por allowlist e registro técnico de hardware — sem telemetria automática — com revisão editável obrigatória antes de copiar, exportar `.txt` ou abrir uma issue pré-preenchida no GitHub.
* **Rota:** `#/relatos` (aceita query opcional `?tipo=bug|ideia|provedor` para pré-selecionar a categoria ao vir de um erro).
* **De onde chega:**
  * Menu secundário da Barra Superior do Shell (`Relatos`).
  * Paleta de comandos `Ctrl/Cmd+K` (*"Relatar problema ou enviar ideia"*).
  * Botão *"Enviar para Relatos"* dentro do detalhe técnico recolhido de erros em qualquer tela.
* **Para onde vai:**
  * Navegação livre de volta ao Projeto aberto ou `#/inicio` pelo Shell.
  * Ação externa (navegador do SO via `openUrl`): abre `https://github.com/GUSTAVOHOOO/clipes/issues/new?...` ou `SECURITY.md` (Private vulnerability reporting).

### 3.2 Layout por zonas

A tela usa largura de leitura confortável (`≤ 68 ch` no formulário, centralizada dentro da Área de Conteúdo Principal) para evitar linhas longas cansativas, mantendo a pré-visualização e a ficha técnica de hardware organizadas em dois passos explícitos (ou lado a lado em 1440+ px durante a revisão).

#### Variação 1366 px — Passo 1 (Edição do relato)

```text
+----------------------------------------------------------------------------------+
| [Shell: Barra Superior] ...                                                      |
+----------------------------------------------------------------------------------+
| AREA PRINCIPAL (rolagem vertical interna do painel)                              |
|                                                                                  |
|   Relatos e Diagnóstico (sem telemetria)                                         |
|   Nada sai da sua máquina sem você ler e editar antes.                           |
|                                                                                  |
|   Tipo de envio (radiogroup):                                                    |
|   (*) Relatar problema   ( ) Sugerir ideia   ( ) Propor Provedor ou modelo       |
|                                                                                  |
|   Título: [________________________________________________________________]     |
|   Descrição:                                                                     |
|   +------------------------------------------------------------------------+     |
|   | O que você esperava e o que aconteceu...                               |     |
|   +------------------------------------------------------------------------+     |
|   [!] Aviso (se detectar "token"/"chave"/"key"): nunca cole chaves de API aqui.  |
|                                                                                  |
|   [x] Incluir diagnóstico técnico local (allowlist sem caminhos ou textos)       |
|   [v] Ver diagnóstico de hardware de transcrição (GPU/VRAM/lote seguro)          |
|                                                                                  |
|   [ Revisar relato antes de enviar ]                                             |
|                                                                                  |
|   Segurança: encontrou uma vulnerabilidade? Veja como reportar em privado.       |
+----------------------------------------------------------------------------------+
| [Shell: Barra de Status]                                                         |
+----------------------------------------------------------------------------------+
```

#### Variação 1366 px e 1440+ px — Passo 2 (Pré-visualização editável obrigatória — ADR-0006)

* **Em 1366 px:** coluna única legível com o texto completo editável do diagnóstico acima e os botões finais abaixo (`Copiar texto`, `Exportar diagnóstico (.txt)`, `Abrir no GitHub`, `Voltar para editar`).
* **Em 1440+ px:** a pré-visualização editável fica à esquerda (60%) e o **Resumo técnico da sonda de hardware** (`transcription.hardware.diagnostic`) + explicação da **Allowlist (o que entra e o que nunca entra)** ficam num painel auxiliar à direita (40%).

### 3.3 Conteúdo e componentes

* **Seletor de tipo (`radiogroup`):**
  * `Relatar problema` → template `bug.yml` (`includeDiagnostic = true` por padrão).
  * `Sugerir ideia` → template `ideia.yml` (`includeDiagnostic = false` por padrão).
  * `Propor Provedor ou modelo` → template `provedor-modelo.yml` (`includeDiagnostic = false` por padrão).
* **Campos do relato:**
  * `Título` (`input` texto) e `Descrição` (`textarea`).
  * **Detector local de segredos (`/token|chave|\bkey\b/i`):** se encontrar correspondência no título ou descrição, exibe alerta não bloqueante (`role="alert"`): *"Atenção: seu texto menciona 'token' ou 'chave'. Nunca cole chaves de API ou segredos no relato."*
* **Diagnóstico local por allowlist (`diagnostic.get`):**
  * Checkbox `Incluir diagnóstico técnico local`.
  * Resumo visível explicando a regra do ADR-0006: *"Entra apenas: versão, SO, GPU/encoder, Motor, Provedor, versão da Tarefa/hash do prompt, contexto efetivo e últimas ~200 linhas limpas de erro. Nunca entram: chaves, caminhos pessoais, nomes de Fontes, Transcrições ou Roteiros."*
* **Registro técnico da sonda de hardware (`transcription.hardware.diagnostic`):**
  * Cartão recolhível **"Diagnóstico da sonda de hardware (Transcrição)"** alimentado por `transcription.hardware.diagnostic`.
  * Quando não `null`, exibe de forma legível: `key.gpu`, `key.driver`, `key.ct2_version`, `key.model`, `chosen` (device/compute_type), `verified`, `batch`, `vram_free_mib`, `measured_at`, `fallback_reason` (se houver) e `attempts`. Botão **"Anexar resumo de hardware ao diagnóstico"** (adiciona bloco limpo ao texto editável do diagnóstico caso o usuário queira incluir). Se `null`, informa *"Nenhuma sonda de hardware gravada ainda."*
* **Passo obrigatório de pré-visualização editável (ADR-0006 regra 2):**
  * Os botões de saída (**Copiar texto**, **Exportar diagnóstico (.txt)** e **Abrir no GitHub**) **só existem após clicar em "Revisar relato"**.
  * Na tela de revisão:
    * Campo `<textarea>` editável com o bloco de diagnóstico (`diagnostic`), permitindo ao usuário apagar ou editar qualquer linha antes de copiar, exportar ou enviar.
    * Validação do tamanho da URL do GitHub (`8.000` bytes UTF-8): se `issueUrl(fullText)` exceder 8.000 bytes e `include` estiver ligado, o app copia automaticamente `diagnostic` para a área de transferência, preenche a URL apenas com `description` + aviso *"Diagnóstico copiado para a área de transferência — cole aqui"* e notifica o usuário. Se mesmo assim ultrapassar 8.000 bytes, orienta usar **"Copiar texto"**.
* **Nota de segurança:**
  * Link externo para `https://github.com/GUSTAVOHOOO/clipes/blob/master/SECURITY.md` (*"Reportar vulnerabilidade de segurança em privado"*).

### 3.4 Ações

| Ação do usuário | Comando(s) do núcleo | Pré-condições | Confirmação / Cartão de custo | O que muda na tela depois | Desfazer |
|---|---|---|---|---|---|
| Abrir `#/relatos` | `diagnostic.get`, `transcription.hardware.diagnostic` | Nenhuma | Nenhuma | Carrega texto sanitizado e dados da última sonda de hardware | — |
| Trocar tipo (`bug` / `ideia` / `provedor`) | Nenhum (estado local) | Nenhuma | Nenhuma | Ajusta template YAML alvo e padrão do checkbox `Incluir diagnóstico` (`true` só em `bug`) e sai da pré-visualização se aberta | Selecionar tipo anterior |
| Revisar relato | Nenhum (estado local) | Nenhuma | Nenhuma | Exibe passo 2 com `<textarea>` editável do diagnóstico e libera ações de exportação/envio | Botão *"Voltar para editar"* |
| Copiar texto | Clipboard (`@tauri-apps/plugin-clipboard-manager` / `navigator.clipboard`) | Estar na revisão | Nenhuma | Copia texto completo revisado e mostra `role="status"` *"Texto copiado."* | — |
| Exportar diagnóstico (`.txt`) | Diálogo `save` + `diagnostic.export { path, text }` (no browser: download `Blob`) | Estar na revisão e texto não vazio | Diálogo nativo de salvar arquivo | Grava arquivo `.txt` com o texto **editado pelo usuário** e mostra confirmação | — |
| Abrir issue no GitHub | `openUrl` (`@tauri-apps/plugin-opener`) + clipboard se > 8.000 B | Estar na revisão | Nenhuma | Abre `issues/new` no navegador padrão com template, título e corpo | — |

### 3.5 Estados

* **Carregando (`loading`):** `<Skeleton>` na área de diagnóstico e no cartão de sonda de hardware enquanto `diagnostic.get` e `transcription.hardware.diagnostic` respondem; campos de título/descrição já podem ser editados sem espera.
* **Vazio (`empty`):** não se aplica ao formulário principal; se `transcription.hardware.diagnostic` retornar `null`, o cartão recolhível informa *"Nenhuma sonda de hardware gravada ainda."*
* **Erro (`error`):**

| `CoreError.code` / Erro | Texto humano na UI | Ação de recuperação |
|---|---|---|
| `invalid_path` | Escolha um caminho válido terminado em `.txt` para salvar o diagnóstico. | Botão *"Escolher destino novamente"*. |
| `invalid_text` | O texto do diagnóstico não pode estar vazio ao exportar. | Botão *"Recarregar diagnóstico padrão"* (`diagnostic.get`). |
| `export_failed` | Não foi possível gravar o arquivo de diagnóstico na pasta escolhida. | Botão *"Copiar texto para área de transferência"* ou *"Tentar outra pasta"*. |
| `settings` (em `hardware.diagnostic`) | Não foi possível ler o histórico local de sonda de hardware. | Botão *"Tentar novamente"*. |
| Falha ao abrir navegador / URL > 8 KB mesmo sem diagnóstico | O texto está grande demais para abrir direto na URL do navegador. | Botão **"Copiar texto completo"** + link direto para `issues/new`. |

* **Job rodando / Parcial:** não aplicável (todos os comandos são síncronos locais).
* **Sem permissão / pré-condição:** sem pré-condições de Projeto aberto (funciona mesmo sem Projeto ou antes do Assistente).

### 3.6 Eventos (`core-progress`)

* Nenhum evento `core-progress` é emitido ou necessário nesta tela.

### 3.7 Teclado e acessibilidade

* **Regiões para `F6` / `Shift+F6`:** Barra Superior → Conteúdo Principal (`<main>`) → (em 1440+ px durante revisão: Painel auxiliar de Hardware/Allowlist `<aside>`) → Barra de Status.
* **Padrões WAI-ARIA APG:**
  * Seletor de tipo: `role="radiogroup"` com `aria-labelledby`, navegação por `←`/`→` e `Espaço`.
  * Todos os campos (`Título`, `Descrição`, `<textarea>` editável de diagnóstico) têm `<label>` explícito associado por `for`/`id`.
  * Aviso de `"token"` / `"chave"` usa `role="alert"` não intrusivo (não rouba o foco do `<textarea>` enquanto o usuário digita).
  * Cartão de sonda de hardware usa `<details>`/`<summary>` (ou botão com `aria-expanded` e `aria-controls`).
  * Confirmações de cópia/exportação usam `role="status"` (`aria-live="polite"`).
* **Atalhos:** herda globais (`Ctrl/Cmd+K`, `Ctrl/Cmd+,`, `Ctrl/Cmd+J`, `F6`, `?` apenas fora de campos de texto — dentro de `input` e `textarea` letras sem modificador são sempre texto).

### 3.8 US do #26 atendidas

* **US-111** (abrir issue pré-preenchida), **US-112** (revisão e edição obrigatória antes de enviar), **US-113** (diagnóstico estritamente por allowlist), **US-114** (copiar quando URL ultrapassar ~8 KB), **US-115** (sugerir ideia ou propor Provedor/modelo), **US-116** (aviso ao mencionar "token" ou "chave"), **US-117** (exportar diagnóstico `.txt`), **US-118** (link para reporte privado de vulnerabilidade), **US-122** (zero telemetria).

### 3.9 Lacunas (Núcleo Rust e Mock TS)

* **Núcleo Rust:**
  1. **Etapa fixa em `diagnostic.get` (`core/src/diagnostic.rs:193-199`):** preenche `"Etapa da falha: componente"` sempre que `diagnostic.log` não está vazio, mesmo quando só há `gpu_probe_fallback` ou `catalog_verification_failed`.
* **Mock TS (`src/lib/core.ts`):**
  1. `diagnostic.export` **não tem mock** em `src/lib/core.ts` (hoje `Report.tsx` usa download por `Blob` no browser sem passar por `coreDispatch`); precisa responder no mock para manter contrato único tipado.
  2. `transcription.hardware.diagnostic` **não tem mock** em `src/lib/core.ts`; precisa retornar um `ProbeRecord` de demonstração (e `null` quando `?estado=vazio`).

### 3.10 Critérios de aceite (E2E / Playwright com mock)

1. Ao abrir `#/relatos`, o tipo padrão é **"Relatar problema"**, o checkbox **"Incluir diagnóstico técnico local"** vem marcado e o diagnóstico carregado por `diagnostic.get` é exibido apenas após clicar em **"Revisar relato"**.
2. Ao alternar para **"Sugerir ideia"** ou **"Propor Provedor ou modelo"**, o checkbox **"Incluir diagnóstico técnico local"** passa automaticamente para desmarcado.
3. Antes de clicar em **"Revisar relato"**, os botões **"Copiar texto"**, **"Exportar diagnóstico (.txt)"** e **"Abrir no GitHub"** não estão presentes no DOM (ADR-0006).
4. Digitar `"minha chave da openai"` na Descrição exibe o alerta `role="alert"` sobre não colar chaves/tokens, mantendo o foco dentro do `<textarea>`.
5. Na tela de revisão, editar uma linha dentro do `<textarea>` do diagnóstico e clicar em **"Exportar diagnóstico (.txt)"** passa exatamente o texto editado (não o original bruto) para `diagnostic.export`.
6. O painel **"Diagnóstico da sonda de hardware (Transcrição)"** exibe os campos de `transcription.hardware.diagnostic` (`gpu`, `chosen`, `batch`, `vram_free_mib`) sem expor caminhos pessoais.
7. Quando o corpo completo gera URL maior que 8.000 bytes, clicar em **"Abrir no GitHub"** copia o diagnóstico para a área de transferência e avisa o usuário em `role="status"`.

---

## 4. Sobre e Atualizações

### 4.1 Objetivo e navegação (rotas)

* **Objetivo:** Exibir a versão instalada do Clipes, permitir verificar e instalar atualizações assinadas do app apenas mediante confirmação explícita do usuário, esclarecer que Componentes/`yt-dlp`/modelos atualizam separadamente e apresentar integralmente a licença Apache-2.0 e atribuições de terceiros.
* **Rota:** `#/sobre`.
* **De onde chega:**
  * Menu secundário da Barra Superior do Shell (`Sobre`).
  * Paleta de comandos `Ctrl/Cmd+K` (*"Sobre o Clipes e atualizações"*).
  * Botão *"Verificar atualizações"* no erro `newer_project` (ao tentar abrir Projeto salvo em versão mais nova do Clipes).
* **Para onde vai:**
  * Link para `#/config/componentes` (*"Atualizar FFmpeg, yt-dlp e modelos em Componentes"*).
  * Link para `#/relatos` (*"Relatar problema ou sugerir melhoria"*).
  * Navegação livre de volta ao Projeto ou `#/inicio`.

### 4.2 Layout por zonas

#### Variação 1366 px e 1440+ px

```text
+----------------------------------------------------------------------------------+
| [Shell: Barra Superior] ...                                                      |
+----------------------------------------------------------------------------------+
| AREA PRINCIPAL (rolagem vertical interna; conteúdo limitado a largura legível)   |
|                                                                                  |
|   ZONA 1: Identidade e Versão                                                    |
|   Clipes — Gerador local e open source de Cortes                                 |
|   Versão instalada: 0.1.0   · Licença: Apache-2.0                                |
|                                                                                  |
|   ZONA 2: Atualizações do aplicativo                                             |
|   +----------------------------------------------------------------------------+ |
|   | Atualizações assinadas via GitHub Releases (nunca instaladas sem confirmar)| |
|   | Estado: Você está usando a versão mais recente (0.1.0).                    | |
|   | [ Verificar atualizações ]                                                 | |
|   |                                                                            | |
|   | (Quando há atualização disponível:)                                        | |
|   | Nova versão disponível: 0.2.0                                              | |
|   | Notas da versão: ...                                                       | |
|   | [ Baixar e instalar 0.2.0 ]  [ Lembrar depois ]                            | |
|   |                                                                            | |
|   | Nota: yt-dlp, FFmpeg e modelos atualizam à parte em [Componentes ->]       | |
|   +----------------------------------------------------------------------------+ |
|                                                                                  |
|   ZONA 3: Licenças e Atribuições                                                 |
|   Abas: [ Licença do Clipes (Apache-2.0) ]  [ Atribuições de terceiros ]         |
|   Filtro nas atribuições: [ Buscar biblioteca ou componente... ]                 |
|   +----------------------------------------------------------------------------+ |
|   | Texto integral de LICENSE / THIRD_PARTY_NOTICES.md (rolagem confortável)   | |
|   +----------------------------------------------------------------------------+ |
+----------------------------------------------------------------------------------+
| [Shell: Barra de Status]                                                         |
+----------------------------------------------------------------------------------+
```

* Em **1440+ px**, a Zona 1 + Zona 2 permanecem em bloco superior confortável e a Zona 3 ganha mais altura útil para leitura de `THIRD_PARTY_NOTICES.md` sem rolagem dupla confusa.

### 4.3 Conteúdo e componentes

* **Zona 1 — Identidade e Versão:**
  * Chama `app.version {}` → `{ version: string }`.
  * Exibe versão instalada (com fonte tabular), link para o repositório público e resumo da licença Apache-2.0.
* **Zona 2 — Atualizações do aplicativo (`@tauri-apps/plugin-updater` + `@tauri-apps/plugin-process`):**
  * Controle explícito **"Verificar atualizações"** (`check()`):
    * Estado `idle` / `up_to_date`: *"Você está usando a versão mais recente (`{version}`)."*
    * Estado `checking`: indicador de progresso + *"Verificando atualizações assinadas…"*
    * Estado `available`: mostra versão atual → nova versão, data e `body` (notas da release), com botão primário **"Baixar e instalar `{version}`"** (`downloadAndInstall()` → `relaunch()`). **Nunca baixa ou instala sem clique do usuário (US-16).**
    * Estado `installing`: *"Baixando e verificando assinatura… O app será reiniciado ao concluir."* (não bloqueia o resto do shell se o usuário navegar, mas avisa antes de reiniciar).
    * Estado `installed` (em mock): *"Atualização instalada. Reinicie para aplicar."*
    * Estado `error`: diferencia erro de rede/offline (`"Sem conexão ou servidor indisponível para verificar atualizações."`) de erro de assinatura/integridade (`"A verificação de assinatura digital desta atualização falhou. Instalação bloqueada por segurança."`).
  * Nota explicativa permanente: *"FFmpeg, yt-dlp, Worker Python e modelos de transcrição/TTS são atualizados separadamente em Configurações → Componentes e Armazenamento"* (link para `#/config/componentes`, atendendo US-17).
* **Zona 3 — Licenças e Atribuições:**
  * Abas (`tablist`): **Licença do Clipes (Apache-2.0)** (`LICENSE`) e **Atribuições de terceiros** (`THIRD_PARTY_NOTICES.md`).
  * Campo de busca textual opcional na aba de atribuições para localizar rapidamente bibliotecas (ex.: FFmpeg, HyperFrames, faster-whisper).

### 4.4 Ações

| Ação do usuário | Comando(s) / API | Pré-condições | Confirmação / Cartão de custo | O que muda na tela depois | Desfazer |
|---|---|---|---|---|---|
| Abrir `#/sobre` | `app.version {}` | Nenhuma | Nenhuma | Exibe versão compilada e textos legais | — |
| Verificar atualizações | `check()` (`@tauri-apps/plugin-updater`) | Nenhuma | Nenhuma | Exibe se há nova versão disponível (com notas) ou se já está atualizado | — |
| Baixar e instalar atualização | `update.downloadAndInstall()` → `relaunch()` | Atualização disponível e válida | Clique explícito no botão *"Baixar e instalar"* (e se houver jobs rodando, aviso de fechamento/reinício!) | Baixa pacote assinado, valida assinatura e reinicia o app | Botão *"Lembrar depois"* antes de instalar |
| Abrir Componentes | Navegação para `#/config/componentes` | Nenhuma | Nenhuma | Vai para a gestão de `yt-dlp`, FFmpeg e modelos | Voltar do navegador |

### 4.5 Estados

* **Carregando (`loading`):** `<Skeleton>` de 1 linha na versão enquanto `app.version` responde (licenças já são estáticas no bundle).
* **Vazio (`empty`):** se o filtro de atribuições não encontrar correspondência: *"Nenhuma atribuição encontrada para '`{termo}`'."* + botão **"Limpar busca"**.
* **Erro (`error`):**
  * Falha ao consultar `app.version`: *"Não foi possível carregar a versão instalada."* + botão **"Tentar novamente"**.
  * Falha no updater (`network` / `release-not-found` / `invalid-signature`): container `role="alert"` com mensagem traduzida (distinguindo rede offline vs. falha de assinatura) e botão **"Tentar novamente"**.
* **Job rodando (`job_running`):** durante `checking` ou `installing` da atualização, exibe spinner + mensagem `role="status"`. Se houver jobs ativos na Fila de Jobs ao tentar reiniciar (`relaunch`), exibe diálogo avisando sobre interrupção de downloads/exportações (mesma regra de fechamento do app).
* **Sem permissão / pré-condição:** se estiver offline (`navigator.onLine === false`), informa *"Você está offline. Conecte-se à internet para verificar atualizações."* sem erro alarmante.

### 4.6 Eventos (`core-progress`)

* `app.version` emite `{ job: "app.version", project: null, stage: "complete", percentage: 100, message: "Version loaded" }`. O Store global ignora/encerra essa operação síncrona sem mantê-la na lista ativa da Fila de Jobs.

### 4.7 Teclado e acessibilidade

* **Regiões para `F6` / `Shift+F6`:** Barra Superior → Conteúdo Principal (`<main>`) → Barra de Status.
* **Padrões WAI-ARIA APG:**
  * Abas `Licença (Apache-2.0)` e `Atribuições de terceiros`: `role="tablist"`, `role="tab"`, `aria-selected`, `role="tabpanel"` (navegação por `←`/`→`).
  * Área de texto das licenças em `<pre>` ou bloco rolável com `tabIndex={0}` e `aria-label` (para permitir rolagem por teclado com `↑`/`↓`/`PageUp`/`PageDown` em conformidade com WCAG 2.1.1).
  * Estados do atualizador anunciados via `role="status"` (`aria-live="polite"`) e erros via `role="alert"`.
* **Atalhos:** herda globais (`Ctrl/Cmd+K`, `Ctrl/Cmd+J`, `Ctrl/Cmd+,`, `F6`, `?` fora da busca de atribuições).

### 4.8 US do #26 atendidas

* **US-16** (atualização assinada só com confirmação do usuário), **US-17** (esclarece atualização separada de `yt-dlp` e modelos), **US-19** (exibir versão, licenças e atribuições em "Sobre"), **US-121** (tratamento limpo offline).

### 4.9 Lacunas (Núcleo Rust e Mock TS)

* **Núcleo Rust:** nenhuma lacuna de comando para `#/sobre` (`app.version` está completo).
* **Mock TS (`src/lib/core.ts` e `UpdateNotice.tsx`):**
  1. Unificar a lógica de simulação de atualização de `UpdateNotice.tsx` (`VITE_UPDATER_MOCK` e `?updater-test=offline|invalid-signature|available`) num serviço/store compartilhado para que `#/sobre` e o toast/banner de inicialização compartilhem o mesmo estado.

### 4.10 Critérios de aceite (E2E / Playwright com mock)

1. Ao navegar para `#/sobre`, `app.version` exibe a versão atual e as abas **Licença do Clipes (Apache-2.0)** e **Atribuições de terceiros** alternam o conteúdo via clique e setas `←`/`→`.
2. Com `?estado=carregando`, a seção de versão exibe `<Skeleton>` antes de `app.version` resolver.
3. Clicar em **"Verificar atualizações"** no cenário simulado de atualização disponível exibe versão alvo, notas da versão e o botão **"Baixar e instalar"** sem iniciar o download automaticamente.
4. No cenário `?updater-test=invalid-signature`, exibe `role="alert"` informando que a verificação de assinatura falhou e bloqueia a instalação.
5. Digitar um termo inexistente no campo de busca de atribuições exibe o estado vazio com o botão **"Limpar busca"**.
6. Clicar no link **"Componentes"** na nota sobre `yt-dlp` e modelos navega para `#/config/componentes`.

---

## Componentes compartilhados usados

Interfaces mínimas propostas para unificação entre pacotes pelo coordenador (sem definição de estilo visual/cores):

```ts
/** Cartão obrigatório antes de qualquer disparo pago ou que consulta Provedor. */
export interface ResumoCustoPrivacidadeProps {
  taskLabel: string; // ex.: "Seleção de Cortes", "Refazer com outro Perfil"
  profile: { id: string; label: string; kind: 'local' | 'api' | 'cli'; model: string | null; host?: string | null };
  leavesMachine: boolean;
  estimate:
    | { kind: 'zero' }
    | { kind: 'plan_quota' }
    | { kind: 'usd'; minMicroUsd: number; maxMicroUsd: number; inputTokens?: number }
    | { kind: 'unknown' };
  budgetRemainingLabel?: string | null;
  localOnlyBlocked?: boolean;
}

/** Checklist informativo de guarda-corpos (sempre não bloqueante). */
export interface ChecklistGuardaCorposProps {
  state: GuardrailsState; // resposta de guardrails.check
  defaultOpen?: boolean;
  onNavigateCut?: (candidateId: number, tab: 'editar' | 'transformar' | 'empacotar') => void;
}

/** Diálogo de confirmação restrito a ações irreversíveis, destrutivas ou pagas. */
export interface ConfirmDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  description: string;
  children?: React.ReactNode; // ex.: <ResumoCustoPrivacidade /> ou lista de conflitos
  confirmLabel: string;
  cancelLabel?: string;
  intent?: 'default' | 'destructive';
  busy?: boolean;
  onConfirm: () => void | Promise<void>;
}

/** Indicador de estado sempre acompanhado de ícone + rótulo textual (SC 1.4.1). */
export interface SeloEstadoProps {
  tone: 'neutral' | 'info' | 'success' | 'warning' | 'danger';
  icon: string; // identificador semântico do ícone
  label: string;
  tooltip?: string;
}

/** Bloco estrutural de carregamento sem texto de lista vazia. */
export interface SkeletonProps {
  variant: 'card' | 'row' | 'line' | 'panel';
  count?: number;
}

/** Container padrão de erro traduzido pelo mapeador central CoreError.code. */
export interface ErroAcionavelProps {
  error: CoreErrorNormalized;
  recoveryAction?: { label: string; onClick: () => void };
  allowReportLink?: boolean; // atalho para #/relatos
}
```

---

## Questões para a arquitetura

1. **Divergência de rota do histórico de lotes em `01-arquitetura.md`:** a árvore de superfícies (Seção 2) cita `#/projeto/:id/exportacao` e `#/projeto/:id/exportacao/lotes`, enquanto a tabela de rotas (Seção 3) padroniza `#/projeto/:id/exportacao?sub=prontidao|lotes`. Esta spec adotou `?sub=prontidao|lotes` com redirecionamento/alias de `/exportacao/lotes` para evitar quebrar links; recomenda-se alinhar a Seção 2 da arquitetura.
2. **Desempenho N+1 ao montar a Mesa de Prontidão:** hoje não existe um comando agregado no núcleo para listar todos os Cortes aprovados com resumo de `packaging`, `thumbnail`, `script`, `narration` e `guardrails`. Enquanto esse comando não existir, o front deve buscar em paralelo apenas para os Cortes aprovados da página/visão visível (ou sob cache no Store de Projeto Ativo) — confirmar se a arquitetura aprova lazy-loading por viewport na grade ou um novo ticket de comando `export.readiness`.
3. **Exportação individual a partir da Mesa de Prontidão:** a Seção 2 da arquitetura lista `export.start` apenas em *Corte: Editar* e *Corte: Empacotar*, mas usuários na Mesa de Prontidão costumam querer exportar um único Corte corrigido sem criar um lote novo. Incluímos *"Exportar só este"* como ação secundária do cartão; confirmar se permanece ou se fica restrito à Tela do Corte.
4. **ETA na Fila de Jobs (`jobs.list` / `ProgressEvent`):** o catálogo de eventos e `jobs.list` não informam `startedAtMs` nem `etaMs`. Supomos que o Store no front calcule ETA apenas para jobs observados em execução na sessão atual (omitindo ETA quando o app foi reaberto no meio ou em etapas indeterminadas de IA `prepare → call → verify`), até que o núcleo exponha `startedAtMs`.
5. **Diálogo ao fechar a janela com jobs rodando:** o adaptador Tauri (`src-tauri/src/main.rs`) intercepta `CloseRequested` no Rust para chamar `editor.flush`. Como a verificação de downloads globais/exportação/chamadas pagas em voo fica no Store do front-end (ou no Rust), definir na implementação se o `CloseRequested` delega um evento para a UI abrir o `<ConfirmDialog>` antes de `window.destroy()` ou se o próprio Rust consulta o estado antes de fechar.
