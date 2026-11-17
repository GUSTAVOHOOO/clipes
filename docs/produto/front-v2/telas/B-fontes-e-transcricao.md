# Pacote B — Fontes e Transcrição (Macro-etapa 1)

Este documento especifica em detalhe as telas e superfícies do **Pacote B** do front-end v2 do Clipes, vinculadas à [Arquitetura de Informação](../01-arquitetura.md), aos contratos de comandos em [02-projetos-e-fontes.md](../../funcionalidades/02-projetos-e-fontes.md), [03-transcricao.md](../../funcionalidades/03-transcricao.md), [01-instalacao-e-sistema.md](../../funcionalidades/01-instalacao-e-sistema.md) e [07-provedores-jobs-e-eventos.md](../../funcionalidades/07-provedores-jobs-e-eventos.md), e ao vocabulário canônico de [GLOSSARY.md](../../../../GLOSSARY.md).

---

## Escopo e fronteira com outros pacotes

* **Rotas cobertas neste pacote:**
  * `#/projeto/:id/fontes` (sub-visões `?sub=fontes` [padrão] e `?sub=lotes`, além de painel/resultado de busca global FTS5)
  * `#/projeto/:id/fontes/:fonteId` (detalhe da Fonte, escolha do Motor de transcrição, progresso por blocos, sinais de energia/chat e leitor virtualizado da Transcrição)
* **Guarda de rota:** sem Projeto aberto → redireciona para `#/inicio`. Em `#/projeto/:id/fontes/:fonteId`, se `:fonteId` não existir em `sources.list`, redireciona para `#/projeto/:id/fontes` com alerta humano (*"A Fonte selecionada não foi encontrada neste Projeto."*).
* **Tradução de faixas (`translation.*`):** conforme a Seção 2, Seção 3 e Seção 12 de [01-arquitetura.md](../01-arquitetura.md), a tradução de legendas (`translation.get`, `translation.estimate`, `translation.start`, `translation.track.set`, `translation.edit`) opera por **Corte aprovado (`clip_id`)** e pertence à sub-aba **Legendas e Tradução** de **Corte: Editar** (`#/projeto/:id/corte/:corteId/editar`, **Pacote D**). Na Macro-etapa 1, a única responsabilidade ligada à tradução é registrar e exibir claramente na **Permissão** da Fonte (`sources.import` / `sources.permission.set`) se o escopo cobre `"tradução"`, desbloqueando ou bloqueando (`translation_permission_required`) o recurso no Editor do Corte, além de garantir que a Transcrição nunca traduza o áudio original automaticamente (`US-58`).

---

## Tela 1 — Macro-etapa 1: Lista e Entrada de Fontes (`#/projeto/:id/fontes`)

### 1. Objetivo e navegação

* **Objetivo:** Permitir importar novas Fontes (arquivo local ou URL com instalação *just-in-time* de `yt-dlp`/`deno`), conferir e reparar sua integridade no disco (`available`/`offline`/`changed`), registrar idioma e Permissão, buscar trechos em todas as Transcrições do Projeto e selecionar Fontes para abrir o detalhe ou iniciar um Lote de Fontes.
* **De onde chega:**
  * De `#/inicio` logo após criar/abrir um Projeto (`projects.create` / `projects.open`).
  * Da Barra Superior do Shell (aba `1. Fontes e Transcrição`), de `#/projeto/:id/fontes/:fonteId` (voltar para lista) ou do estado vazio de `#/projeto/:id/cortes` (CTA *"Ir para Fontes e Transcrição"*).
* **Para onde vai:**
  * `#/projeto/:id/fontes/:fonteId` ao clicar/pressionar `Enter` em uma Fonte.
  * `#/projeto/:id/fontes?sub=lotes` ao alternar para a sub-visão **Lotes de Fontes** ou após criar um lote com `batches.create`.
  * `#/projeto/:id/cortes?fonte=:fonteId` pelo CTA rápido em Fontes já transcritas.
  * `#/config/componentes` ou `#/config/projeto` em recuperações específicas (ex.: instalar FFmpeg/motor, alterar pasta padrão ou revisar `Somente local`).

### 2. Layout por zonas

A tela ocupa 100% da área de conteúdo principal do Shell (`min-h-0 flex-1`, sem rolagem na janela externa; apenas as colunas internas rolam).

#### 1366 px (notebook alvo)

```text
+----------------------------------------------------------------------------------+
| SHELL: Barra Superior (Projeto | 1.Fontes [3] | 2.Cortes | 3.Export | Fila | K) |
+----------------------------------------------------------------------------------+
| SUBNAVEGAÇÃO + BUSCA GLOBAL                                                      |
| [ Fontes (3) ] [ Lotes de Fontes (1) ]   [ Buscar em todas as Transcrições... ]  |
+-----------------------------------------+----------------------------------------+
| ZONA ESQUERDA (~40%, scroll próprio)    | ZONA DIREITA (~60%, scroll próprio)    |
| ENTRADA DE FONTE                        | FONTES DO PROJETO                      |
| +-------------------------------------+ | [x] Selecionar todas  (2 selecionadas) |
| | Modo: (o) Arquivo local  ( ) URL    | | [ Processar 2 Fontes em lote ]         |
| +-------------------------------------+ | Filtro: [ Todas v ] [ Buscar nome... ] |
| | [ Escolher vídeo... ]  (ou URL +    | +--------------------------------------+ |
| |  Botão Baixar por URL + Pasta)      | | [ ] Live_12_11_final.mp4   [Pronta]  | |
| +-------------------------------------+ |     03:42:10 · PT-BR · Permissão: Sim  | |
| | PRÉ-INSPEÇÃO & CONFIGURAÇÃO         | |     Chat: 42 picos · Energia: Sim    | |
| | Arquivo: live.mkv (02:15:00 · 1080p)| |     [ Abrir ] [ Editar Permissão ]   | |
| | Faixa do microfone: [1 - Mic OBS v] | +--------------------------------------+ |
| | Idioma falado:      [Português   v] | | [!] VOD_09_11.mp4       [Offline]    | |
| | Permissão: ( ) Sem  (o) Autorizada  | |     01:50:00 · Transcrição pronta    | |
| |   Quem:  [Streamer X              ] | |     Preview/export bloqueados no disco | |
| |   Onde:  [Discord / Programa      ] | |     [ Relocalizar arquivo ] [ Abrir ]  | |
| |   Escopo:[Cortes e tradução       ] | +--------------------------------------+ |
| | [ ] Copiar vídeo para o Projeto     | | [~] Live_15_11.mp4       [Alterada]   | |
| | [ Importar Fonte ]                  | |     [ Verificar identidade ] [ Abrir ] | |
| +-------------------------------------+ +--------------------------------------+ |
+-----------------------------------------+----------------------------------------+
| SHELL: Barra de Status (Salvo | Sem jobs ativos | F6 trocar região · Ctrl+F)     |
+----------------------------------------------------------------------------------+
```

#### Variação em 1440+ px

* Proporção entre zonas passa a ~`36%` esquerda (máximo confortável `520 px` para o formulário de entrada) e ~`64%` direita para a lista de Fontes, permitindo exibir mais metadados em linha única (duração, resolução, status de preview, chat, energia e ações rápidas sem quebra de linha).
* Se o usuário disparar uma busca FTS5 (`transcription.search`), o painel de resultados abre como gaveta/sobreposição acoplada à direita (ou substitui temporariamente a lista com botão claro *"Voltar para lista de Fontes"*), exibindo resultados agrupados por Fonte com `snippet` destacado e salto direto para a Frase.

### 3. Conteúdo e componentes

* **Barra de Subnavegação e Busca Global (topo da área de conteúdo):**
  * Abas de sub-visão (`role="tablist"`): `Fontes (N)` (`?sub=fontes`) e `Lotes de Fontes (M)` (`?sub=lotes`).
  * Campo de busca global FTS5 (`transcription.search`, atalho `Ctrl/Cmd+F`): placeholder *"Buscar falas em todas as Transcrições do Projeto…"*.
* **Zona Esquerda — Painel de Entrada de Fonte:**
  * Seletor segmentado (`Segmented`): **Arquivo local** vs. **URL**.
  * **Se Modo = Arquivo local:**
    * Botão *"Escolher vídeo…"* (seletor nativo do Tauri para `mp4`, `mkv`, `mov`, `webm`, `avi`, `m4v`), que dispara `sources.inspect`.
  * **Se Modo = URL:**
    * Campo de texto *"URL do vídeo (YouTube VOD)"* + botão *"Baixar por URL"* (`sources.url.download`).
    * Linha discreta com pasta de destino (`sources.url.settings.get` → `download_dir`) e botão *"Trocar pasta"* (`sources.url.settings.set`).
    * Cartão *just-in-time* condicional de dependências:
      * Se `components.ytdlp.status` indicar `installed: false` (ou erro `component_missing`), mostra banner de instalação do `yt-dlp` com versão, tamanho em MB e licença vindos de `components.manifest` e botão *"Instalar yt-dlp"*.
      * Se `sources.url.download` falhar com `js_runtime_missing` (ou `components.deno.status` indicar `installed: false` quando o usuário acionar instalar), mostra cartão *"Instalar deno"* com versão, tamanho e licença de `components.manifest` e botão *"Instalar deno"*.
      * Durante download (`yt-dlp`, `deno` ou o próprio VOD): barra de progresso determinística (`role="progressbar"`) + percentual + botão **Cancelar** (`components.cancel` ou `sources.url.cancel`).
  * **Bloco de Pré-inspeção e Metadados (exibido após `sources.inspect` retornar):**
    * Resumo do arquivo: nome, duração formatada (`tabular-nums`), resolução e FPS dos streams de vídeo (`metadata.streams`).
    * Select **Faixa de áudio (microfone)**: lista streams com `codec_type === "audio"` (`index · tags.title || codec_name · tags.language`), essencial para lives do OBS em múltiplas faixas (`US-50`).
    * Select **Idioma falado**: alimentado por `channel_profile.get` (`language`) como padrão inicial e lista `CODES` + `Intl.DisplayNames`.
    * Bloco **Permissão** (obrigatório escolher antes de importar):
      * Radio group: `Sem permissão registrada` (`{ status: "none" }`) vs. `Tenho permissão do criador` (`{ status: "granted", who, where, scope }`).
      * Quando `granted`: campos **Quem autorizou** (`who`), **Onde foi autorizada** (`where`) e **Escopo** (`scope`, com dica *"Inclua 'tradução' se autorizada para traduzir legendas"*).
    * Checkbox **Copiar arquivo para dentro do Projeto** (visível em importação local; desmarcado por padrão para não duplicar GBs, `US-36`; oculto/desabilitado quando veio de pasta de download por URL, mantendo referência).
    * Botão primário **"Importar Fonte"** (`sources.import`).
* **Zona Direita — Lista de Fontes do Projeto (`sources.list`):**
  * **Barra de ações em lote e filtro:** checkbox *"Selecionar todas"*, contador explícito (`"N Fontes selecionadas"`), botão **"Processar N Fontes em lote"** (abre `?sub=lotes` pré-preenchido com os IDs selecionados — evita a armadilha do `Add All` oculto do HandBrake), filtro por estado (`Todas`, `Disponíveis`, `Offline / Alteradas`, `Prontas para Cortes`) e busca local por nome de arquivo.
  * **Lista (`<ListaVirtual>` quando > 30 itens, ou lista padrão acessível):** cada item mostra:
    * Checkbox de seleção para Lote.
    * Nome do arquivo (basename; caminho completo em tooltip/detalhe secundário) e badge de origem (`Local` vs. `URL`).
    * `<Status>` de integridade no disco (ícone + texto, nunca só cor):
      * `available` → **Disponível**
      * `offline` → **Offline** (subtexto: *"Arquivo não encontrado no disco. Transcrição e edição continuam acessíveis; preview e exportação bloqueados."*)
      * `changed` → **Alterada** (subtexto: *"Arquivo mudou desde a importação. Verifique a identidade antes de usar preview ou exportar."*)
    * `<Status>` da Transcrição: `Não transcrita` | `Na fila` | `Transcrevendo X%` | `Parcial (MM:SS)` | `Transcrição pronta (N palavras)`.
    * Badges discretos: **Idioma**, **Permissão** (`Autorizada` / `Sem permissão`), **Chat** (`Disponível` / `Sem chat` / `Não buscado`) e **Energia** (`Medida` / `Pendente`).
    * Ações do item:
      * Botão primário/padrão **"Abrir"** → `#/projeto/:id/fontes/:fonteId` (ou **"Ir para Cortes"** quando já transcrita).
      * Se `status === "offline"`: botão **"Relocalizar arquivo"** (`sources.relocate`).
      * Se `status === "changed"` ou `!verified`: botão **"Verificar identidade"** (`sources.hash`).
      * Botão **"Permissão"** (abre modal/popover de edição rápida `sources.permission.set`).
      * Botão **"Idioma"** (apenas enquanto Transcrição não iniciou; `sources.language.set`).
      * Nota de lacuna: ação *"Remover Fonte"* não aparece habilitada enquanto `sources.delete` não existir no núcleo (ou fica ausente com registro em Lacunas).
* **Painel/Gaveta de Resultados da Busca Global (`transcription.search`):**
  * Exibe até 200 ocorrências (`limit: 50` padrão) agrupadas ou listadas com: Nome da Fonte, timecode (`start_us`–`end_us`, `tabular-nums`) e `snippet` com `<mark>` nos tokens `match: true`.
  * Clicar/ativar um resultado navega para `#/projeto/:id/fontes/:fonteId?frase=:sentence_id&row=:row`.

### 4. Ações

| Ação do usuário | Comando(s) do núcleo | Pré-condições | Confirmação / Custo | O que muda na tela depois | Desfazer |
|---|---|---|---|---|---|
| Escolher arquivo local | `sources.inspect { path }` | FFmpeg/`ffprobe` disponível; arquivo acessível | Nenhuma (local, `US$ 0,00`) | Preenche pré-inspeção (duração, faixas de áudio, vídeo) e preseleciona idioma do `channel_profile.get` | Limpar seleção |
| Baixar por URL (1ª vez sem aceite) | `sources.url.settings.get` → `sources.url.settings.set { terms_accepted: true, download_dir }` | Projeto aberto | `<ConfirmDialog>` único: *"Os Termos do YouTube proíbem baixar conteúdo sem autorização do dono. A responsabilidade pelo download e pelo uso é sua."* | Grava `terms_accepted: true` e prossegue para download | Não (persistido; pasta pode ser alterada depois) |
| Trocar pasta de downloads por URL | `sources.url.settings.set { terms_accepted, download_dir }` | Caminho absoluto válido | Nenhuma | Atualiza caminho exibido abaixo do campo URL | Selecionar outra pasta |
| Instalar `yt-dlp` ou `deno` (*just-in-time*) | `components.manifest` → `components.download { id, confirmed: true }` | `data_dir` gravável | `<ConfirmDialog>` exibindo nome, versão, tamanho em MB, URL oficial e licença do manifesto | Barra de progresso em tempo real; ao concluir (`100%`), libera botão *"Baixar por URL"* | Cancelar durante download via `components.cancel { id }` |
| Baixar VOD por URL | `sources.url.download { project, url, job }` → `sources.inspect { path }` | `terms_accepted: true`, `yt-dlp` íntegro | Nenhuma | Exibe progresso `0..100%`; ao concluir, abre bloco de pré-inspeção com `origin_url` preenchido | Cancelar durante download via `sources.url.cancel { job }` |
| Importar Fonte | `sources.import { project, path, audio_track, language, copy, origin_url, permission }` → `sources.hash` (se `!copy`) | Projeto aberto, `audio_track` válido, `permission` preenchida | Se `copy: true`, exibe progresso da cópia e verificação | Adiciona Fonte em `sources.list`, enfileira jobs `preview` e (se URL) `chat`, limpa formulário e foca item criado | Cancelar cópia/hash via `sources.cancel { job }` *(exclusão pós-importação aguarda `sources.delete`)* |
| Verificar hash / identidade (`changed` ou `!verified`) | `sources.hash { project, id, job, confirmed? }` | Fonte existente e arquivo no disco | Se `confirmation_required` (impressão parcial mudou sem hash prévio ou divergência), `<ConfirmDialog>`: *"O arquivo no disco mudou. Confirmar que continua sendo a mesma Fonte?"* → reenvia `confirmed: true` | Atualiza `verified: true` / `status: "available"` e reabilita preview/exportação | Cancelar verificação em voo via `sources.cancel { job }` |
| Relocalizar Fonte `offline` | Seletor de arquivo → `sources.relocate { project, id, path, job, confirmed? }` | Fonte existente; candidato compatível | Se `confirmation_required` (sem hash completo prévio), `<ConfirmDialog>` explicando que tamanho/duração/amostras conferem mas hash completo não existia → `confirmed: true` | Atualiza `path` e `status: "available"`, reabilitando preview/exportação | Cancelar verificação via `sources.cancel { job }` |
| Editar Permissão | `sources.permission.set { project, id, permission }` | Projeto aberto; Fonte existente | Nenhuma | Atualiza badge da Fonte e invalida caches de `packaging.get` e `guardrails.check` | Editar novamente |
| Alterar idioma antes de transcrever | `sources.language.set { project, id, language }` | Transcrição ainda não iniciada (`resume_us === 0` e sem job ativo) | Nenhuma | Atualiza idioma exibido no card da Fonte | Selecionar idioma anterior |
| Buscar nas Transcrições | `transcription.search { query, limit: 50 }` | Projeto aberto | Nenhuma | Lista ocorrências com `snippet` destacado; clicar abre Fonte na Frase | Limpar campo de busca |
| Abrir Lote com selecionadas | Navegação para `?sub=lotes` com `sourceIds` em estado | ≥ 1 Fonte selecionada | Nenhuma (confirmação ocorre em `batches.create`) | Abre Superfície 2 pré-selecionada | Voltar à aba Fontes |

### 5. Estados

* **`loading`:** Exibe `<Skeleton>` estrutural na Zona Direita (3–5 cartões de Fonte com linhas de título, status e botões) e nos campos dependentes de `channel_profile.get` / `sources.url.settings.get`. Nunca exibe *"Nenhuma Fonte importada"* durante a carga inicial.
* **`empty`:** Quando `sources.list` retorna `[]`:
  * **Título:** `Nenhuma Fonte importada ainda`
  * **Texto:** `Importe um arquivo de vídeo do seu computador ou baixe uma live gravada (VOD) por URL para começar a transcrever.`
  * **CTA primário (recebe foco inicial quando `?estado=vazio`):** botão `Importar primeira Fonte` (move foco para o seletor de arquivo ou campo de URL na Zona Esquerda).
* **`error`:** Container `role="alert"` no topo da zona afetada usando o mapeador central `CoreError.code` (sem `error.message` cru, com botão recolhido *"Ver detalhe técnico"*):
  * `ffprobe_missing` / `component_missing` (FFmpeg) → `"O FFmpeg é necessário para inspecionar e importar vídeos."` → Botão `Ir para Componentes` (`#/config/componentes`).
  * `component_missing` (`yt-dlp`) → `"O componente yt-dlp precisa ser instalado para baixar por URL."` → Botão `Instalar yt-dlp` (inline *just-in-time*).
  * `js_runtime_missing` → `"Falta o componente deno para resolver este vídeo do YouTube."` → Botão `Instalar deno` (inline *just-in-time*).
  * `terms_required` → `"Confirme o aviso sobre os Termos do YouTube antes de baixar por URL."` → Reabre `<ConfirmDialog>` de Termos.
  * `age_restricted` → `"Este vídeo tem restrição de idade no YouTube e não pode ser baixado pelo app."` → Botão `Importar arquivo local` (muda para modo Arquivo).
  * `login_required` → `"Este vídeo exige login no YouTube. O Clipes não usa seus cookies nem sua conta."` → Botão `Importar arquivo local`.
  * `sabr_unavailable` / `download_failed` → `"Não foi possível baixar o vídeo por esta URL. Verifique o link ou atualize o yt-dlp em Componentes."` → Botões `Tentar novamente` e `Abrir Componentes`.
  * `invalid_url` → `"Cole um endereço válido começando com http:// ou https://."` → Foca campo de URL.
  * `source_unavailable` / `probe_failed` → `"Não foi possível ler este arquivo de vídeo. Verifique se ele não está corrompido ou em uso."`
  * `copy_exists` → `"Já existe um arquivo com este nome dentro da pasta do Projeto."` → Orienta desmarcar cópia ou renomear arquivo.
  * `source_mismatch` (em `sources.relocate`) → `"O arquivo escolhido não corresponde à Fonte original (tamanho, duração ou conteúdo diferentes)."` → Botão `Escolher outro arquivo`.
  * `transcription_busy` / `transcript_complete` / `transcript_partial` (em `sources.language.set`) → `"O idioma não pode ser alterado porque a Transcrição desta Fonte já começou ou foi concluída."`
  * `project_not_open` / `project_busy` → Mapeamento padrão do Shell (`Ir para Início` / `Abrir Fila de Jobs`).
* **`job_running`:** Durante `sources.url.download`, `components.download` (`yt-dlp`/`deno`), `sources.import` (`copy: true`) ou `sources.hash`/`relocate`, o restante da lista de Fontes permanece navegável e interativo; o item ou cartão em curso exibe barra de progresso determinística (`role="progressbar"`), etapa legível (`Baixando Fonte — 42%`, `Verificando integridade — 68%`) e botão **Cancelar**. Jobs em background (`preview`, `chat`) mostram badge discreto no cartão da Fonte e atualizam ao concluir.
* **`partial`:** Quando uma ou mais Fontes da lista estão `offline` ou `changed` enquanto outras estão `available`, exibe faixa de atenção no topo da lista: `"N Fonte(s) precisam de verificação ou relocalização no disco. A leitura e edição da Transcrição continuam disponíveis."` com filtro rápido *"Ver apenas com pendência"*.
* **Sem permissão / pré-condição:** Fonte com `permission.status === "none"` não bloqueia importação nem transcrição, mas exibe badge discreto `Sem permissão` e aviso explicativo no popover de Permissão (*"Sem Permissão registrada, o crédito automático na descrição fica vazio e a tradução de legendas no Editor fica bloqueada."*).

### 6. Eventos

Escutados via store único de `core-progress`:

* `job === <id_download_url>` + `stage === "download"`: atualiza barra de progresso do download da URL (`0..100%`).
* `job === "yt-dlp" | "deno"` + `stage === "download" | "complete"`: atualiza progresso do instalador *just-in-time* e libera o botão de download ao receber `"complete"`.
* `job === "source-copy-original" | "source-copy-check" | "source-hash" | "source-relocate"` + `stage === "hash"`: atualiza progresso da verificação/cópia da Fonte correspondente (`0..100%`).
* `project === currentProjectId` + `stage === "waveform" | "thumbnails" | "chat" | "complete" | "failed"`: atualiza estado dos badges `preview` e `chat` nos cartões da lista e, ao concluir job `transcription` em segundo plano, atualiza o badge da Fonte para `Transcrição pronta` (via invalidação de cache no store).

### 7. Teclado e acessibilidade

* **Regiões `F6` / `Shift+F6`:** Barra Superior → Subnavegação/Busca → Painel de Entrada de Fonte (Esquerda) → Lista de Fontes do Projeto (Direita) → Barra de Status.
* **Atalhos na tela:**
  * `Ctrl/Cmd+F`: foca o campo de busca global FTS5 (`transcription.search`).
  * `Ctrl/Cmd+K`: Paleta de comandos (registra *"Importar arquivo local"*, *"Baixar Fonte por URL"*, *"Ir para Lotes de Fontes"*, *"Buscar nas Transcrições"*).
  * `Esc`: fecha modal de Permissão/Termos/Busca retornando o foco para o botão de origem.
* **Padrões WAI-ARIA APG:**
  * Subnavegação `Fontes | Lotes de Fontes`: `role="tablist"` + `role="tab"` (`aria-selected`) + setas `←`/`→`.
  * Modo `Arquivo local | URL`: `role="radiogroup"` ou `Segmented` acessível com `aria-checked`.
  * Permissão `Sem permissão | Tenho permissão`: `<fieldset>` + `<legend>` + `role="radiogroup"`.
  * Lista de Fontes: cada card é um item estruturado em lista (`<ul>`/`<li>` ou `<ListaVirtual>` `role="listbox"` quando > 30 itens), com checkboxes rotulados (`aria-label="Selecionar Live_12_11_final.mp4 para lote"`).
  * Diálogos (`Termos do YouTube`, `Instalar componente`, `Confirmar relocalização/hash`, `Editar Permissão`): `<ConfirmDialog>` / Base UI `Dialog` prendendo foco inclusive em `<textarea>` e devolvendo foco ao gatilho ao fechar.
  * Alvos de clique ≥ 24×24 CSS px (SC 2.5.8). Status de integridade sempre com ícone + texto (SC 1.4.1). Anúncios de progresso em `role="status"` com *throttle*; erros em `role="alert"`.

### 8. US do #26 atendidas

`US-3`, `US-4`, `US-5`, `US-6`, `US-36`, `US-37`, `US-38`, `US-41`, `US-43`, `US-44`, `US-45`, `US-46`, `US-47`, `US-48`, `US-50`, `US-51`. *(Nota: `US-123` e `US-124` "só áudio primeiro" estão fora da v1 conforme `#152`).*

### 9. Lacunas

* **Núcleo Rust:**
  * Falta comando `sources.delete` para remover uma Fonte importada por engano e suas dependências no SQLite (`01-arquitetura.md` Seção 11 #4).
  * IDs fixos `"source-copy-original"` / `"source-copy-check"` impedem duas cópias simultâneas; a UI mantém o botão *"Importar Fonte"* desabilitado enquanto outra importação com cópia está em andamento.
* **Mock TS (`src/lib/core.ts`):**
  * Remover portão `?source-test=1` e `?transcript-test=1` para `sources.*`, `chat.*`, `transcription.search`.
  * Implementar `sources.cancel` e `sources.url.cancel` (ausentes hoje).
  * Corrigir `sources.import` para respeitar `audio_track`, `copy`, `language`, `origin_url` e gerar IDs incrementais em vez de fixar `id: 4`.
  * Cobrir `components.download` para `"yt-dlp"` e `"ffmpeg"` além de `"deno"`, e emitir `core-progress` simulado para download por URL, hash/relocalização e cópia.
  * Suportar `?estado=vazio|erro|carregando` na rota.

### 10. Critérios de aceite (E2E / Playwright com mock)

1. Com `?estado=vazio` em `#/projeto/demo/fontes`, a lista exibe `"Nenhuma Fonte importada ainda"` e o botão `"Importar primeira Fonte"` está visível e acionável.
2. Com `?estado=carregando`, a zona direita renderiza `<Skeleton>` estrutural e não exibe texto de lista vazia.
3. Com `?estado=erro`, exibe container `role="alert"` com mensagem humana e botão de recuperação sem expor `CoreError.code` cru na mensagem principal.
4. No modo `URL`, ao clicar `"Baixar por URL"` com `terms_accepted === false`, abre `<ConfirmDialog>` dos Termos do YouTube; ao confirmar, chama `sources.url.settings.set` (`terms_accepted: true`) e inicia `sources.url.download` exibindo barra de progresso e botão `"Cancelar download"`.
5. Quando `sources.url.download` retorna `js_runtime_missing`, a UI exibe mensagem humana e o botão inline `"Instalar deno"`, que abre `<ConfirmDialog>` com tamanho e licença do manifesto antes de chamar `components.download`.
6. Quando `sources.url.download` retorna `age_restricted`, exibe instrução clara orientando importação local e botão `"Importar arquivo local"` que alterna o modo da entrada.
7. Após `sources.inspect`, a pré-inspeção lista as faixas de áudio (`audio_track`), pré-seleciona o idioma de `channel_profile.get` e bloqueia `"Importar Fonte"` enquanto Permissão `granted` tiver campos obrigatórios vazios.
8. Uma Fonte com `status === "offline"` exibe badge `"Offline"`, aviso de preview/exportação bloqueados e botão `"Relocalizar arquivo"`, mantendo o botão `"Abrir"` ativo para leitura da Transcrição.
9. Ao selecionar 2 Fontes pelos checkboxes, o botão `"Processar 2 Fontes em lote"` fica habilitado com a contagem explícita e navega para `#/projeto/demo/fontes?sub=lotes` levando os IDs selecionados.
10. Ao pressionar `Ctrl+F` e digitar um termo, chama `transcription.search` e clicar num resultado navega para `#/projeto/demo/fontes/:fonteId?frase=...&row=...`.

---

## Tela 2 — Macro-etapa 1: Lotes de Fontes (`#/projeto/:id/fontes?sub=lotes`)

### 1. Objetivo e navegação

* **Objetivo:** Permitir criar Lotes de Fontes (1 a 500 Fontes) para executar Transcrição e Seleção de Cortes em sequência com teto de custo opcional, e acompanhar, pausar, retomar ou cancelar o lote e suas Fontes individuais.
* **De onde chega:**
  * Da sub-aba `Lotes de Fontes` no topo de `#/projeto/:id/fontes`, do botão `"Processar N Fontes em lote"` na Tela 1, ou do link de um Lote ativo na Gaveta Global da Fila de Jobs (`Ctrl/Cmd+J`).
* **Para onde vai:**
  * `#/projeto/:id/fontes/:fonteId` ao clicar em um item do lote para ver a Transcrição.
  * `#/projeto/:id/cortes?fonte=:fonteId&run=:selectionRun` quando um item já concluiu a seleção.
  * Gaveta Global da Fila de Jobs (`Ctrl/Cmd+J`) quando um item pausa por `uncertain_job`.

### 2. Layout por zonas

#### 1366 px (e 1440+ px com colunas mais folgadas)

```text
+----------------------------------------------------------------------------------+
| SHELL: Barra Superior                                                            |
+----------------------------------------------------------------------------------+
| SUBNAVEGAÇÃO                                                                     |
| [ Fontes (3) ] [ Lotes de Fontes (1) ]                                           |
+-----------------------------------------+----------------------------------------+
| ZONA ESQUERDA (~40%, scroll próprio)    | ZONA DIREITA (~60%, scroll próprio)    |
| NOVO LOTE DE FONTES                     | LOTES DO PROJETO                       |
| 1. Fontes incluídas (2 de 3)            | +------------------------------------+ |
|    [x] Live_12_11.mp4  (Não transcrita) | | Lote #4 · Em execução (1/2)        | |
|    [x] Live_15_11.mp4  (Parcial 40%)    | | Local · Corte direto · Teto $2.00  | |
|    [ ] VOD_09_11.mp4   (Offline)        | | Gasto até agora: ~US$ 0.14         | |
| 2. Motor de transcrição                 | | [ Pausar lote ] [ Cancelar lote ]  | |
|    (o) Local (US$ 0,00)  ( ) Groq       | | +----------------------------------+ | |
| 3. Seleção de Cortes                    | | | 1. Live_12_11  [Transcrevendo 62%]| |
|    Tipo: (o) Corte direto               | | | 2. Live_15_11  [Na fila]         | |
|          ( ) Vídeo transformado         | | +----------------------------------+ | |
|    Duração: [20]s até [60]s             | +------------------------------------+ |
| 4. Teto de custo opcional (USD)         | | Lote #3 · Atenção (1 pausada)      | |
|    [ 2.50 ]  (vazio = sem teto)         | | [+] Ver itens (1 concluído,        | |
| +-------------------------------------+ | |     1 pausado: limite de taxa)     | |
| | <ResumoCustoPrivacidade>            | | |   -> [ Retomar item ] [ Abrir ]   | |
| | Rota: Seleção -> OpenAI gpt-4o-mini | | +------------------------------------+ |
| | Envio: Remoto (HTTPS) · só texto    | +------------------------------------+ |
| | Custo estimado: ~US$ 0.30 – $0.55   |                                          |
| +-------------------------------------+                                          |
| [ Iniciar lote com 2 Fontes ]                                                    |
+-----------------------------------------+----------------------------------------+
| SHELL: Barra de Status                                                           |
+----------------------------------------------------------------------------------+
```

* Em **1440+ px**, o grid de itens dentro do cartão de Lote expande para exibir colunas alinhadas em `role="grid"` (posição, Fonte, etapa atual, progresso `%`, status/erro e ações).

### 3. Conteúdo e componentes

* **Zona Esquerda — Construtor de Lote (`batches.create`):**
  * **Lista de seleção de Fontes (`1..500`):** mostra todas as Fontes de `sources.list`, com checkbox, nome, duração e estado atual (Fontes `offline` mostram aviso *"Offline — não pode ser transcrita agora"* e ficam desmarcadas por padrão/desabilitadas para evitar erro imediato). Contador explícito no botão final: `"Iniciar lote com N Fontes"`.
  * **Escolha do Motor de Transcrição:** `Local (US$ 0,00)` (padrão) vs. `Groq (remoto)`. Se `projects.local_only` estiver ligado, `Groq` mostra selo `Bloqueado por Somente local`.
  * **Parâmetros de Seleção:**
    * Tipo de vídeo: `Corte direto` vs. `Vídeo transformado` (valor inicial de `channel_profile.get` → `videoKind`).
    * Faixa de duração (`minUs` / `maxUs` convertidos em segundos, com padrão de `channel_profile.get` e limites `limits.technicalMaxUs`).
  * **Teto de custo opcional (`maxCostMicroUsd`):** campo numérico em USD (conversão exata `Math.round(usd * 1_000_000)`) com explicação: *"Quando o teto for atingido, o lote pausa automaticamente antes da próxima chamada paga."*
  * **Cartão `<ResumoCustoPrivacidade>`:** exibido antes de criar quando `engine === "groq"` ou a Tarefa de Seleção for paga/remota/CLI (após retorno de `confirmation_required` com `usage`, ou pré-visualização prévia).
* **Zona Direita — Lista de Lotes do Projeto (`batches.list` / `batches.get`):**
  * Cada cartão de lote exibe:
    * Identificador `#id`, `<Status>` derivado de `batch.status`:
      * `running` → **Em execução**
      * `paused` → **Pausado pelo usuário**
      * `budget_paused` → **Pausado por orçamento** (banner prioritário com consumo vs. teto e botão *"Ajustar orçamento e continuar"* → `jobs.budget.continue`)
      * `attention` → **Requer atenção** (quando nenhum item está ativo/pendente, mas há item `paused` com erro)
      * `completed` → **Concluído**
      * `cancelled` → **Cancelado**
    * Resumo dos parâmetros congelados (`engine`, `videoKind`, faixa `minUs–maxUs`, `counts`: `total`, `completed`, `active`, `pending`, `paused`, `cancelled`), gasto acumulado do `budget.usage.costLabel` vs. `maxCostMicroUsd`.
    * Controles do lote: **Pausar lote** (`batches.pause`), **Retomar lote** (`batches.resume`), **Cancelar lote** (`batches.cancel` com `<ConfirmDialog>`).
  * **Grid de itens do lote (`role="grid"`, `items[]`):**
    * Colunas: `#` (`position`), **Fonte** (`name`), **Etapa/Estado** (`pending` Na fila | `transcribing` Transcrevendo | `selecting` Selecionando Cortes | `completed` Concluído | `paused` Pausado | `cancelled` Cancelado), **Progresso** (`progress%` + `tabular-nums`), **Ação**.
    * Se item `paused`: mostra causa traduzida de `item.error` via mapeador `CoreError.code` e botão **"Retomar item"** (`batches.item.resume`) ou, se `uncertain_job`, botão **"Resolver na Fila de Jobs"** (`Ctrl/Cmd+J`).
    * Se item `completed` com `selectionRun`: link direto **"Revisar Cortes"** (`#/projeto/:id/cortes?fonte=:sourceId&run=:selectionRun`).

### 4. Ações

| Ação do usuário | Comando(s) do núcleo | Pré-condições | Confirmação / Custo | O que muda na tela depois | Desfazer |
|---|---|---|---|---|---|
| Criar lote | `batches.create { sourceIds, engine, videoKind, minUs, maxUs, maxCostMicroUsd, confirmed? }` | 1–500 Fontes selecionadas; rota de seleção configurada e compatível com `Somente local` | Se retornar `confirmation_required` (Groq ou seleção paga), abre `<ConfirmDialog>` com `<ResumoCustoPrivacidade>` alimentado por `usage` (`selectionPaid`, `transcriptionPaid`, `audioEstimateMicroUsd`, `profile`, `maxCostMicroUsd`) e reenvia com `confirmed: true` | Novo lote aparece no topo da Zona Direita em `running` e `tick()` inicia o 1º item | Cancelar lote (`batches.cancel`) |
| Pausar lote | `batches.pause { id }` | Lote `running` | Nenhuma (termina chamada paga em voo sem cortar no meio) | Status muda para `paused`; botão vira `"Retomar lote"` | Retomar lote (`batches.resume`) |
| Retomar lote | `batches.resume { id }` | Lote `paused` por usuário | Nenhuma | Status volta para `running` e fila continua | Pausar lote (`batches.pause`) |
| Cancelar lote | `batches.cancel { id }` | Lote não cancelado nem concluído | `<ConfirmDialog>`: *"Cancelar este lote? Itens ainda não concluídos serão cancelados, mas resultados já gravados permanecem salvos."* | Marca pendentes como `cancelled` e cancela jobs abertos | Não (criar novo lote se precisar) |
| Retomar item pausado | `batches.item.resume { id, sourceId, confirmed? }` | Item `paused` e sem job `uncertain` | Se retornar `confirmation_required` ou `transcription_retry_confirmation`, exibe `<ConfirmDialog>` com `usage.estimate` e reenvia com `confirmed: true` | Item volta para fila (`transcribing` ou `selecting`) e o lote volta a avançar | Pausar lote ou cancelar job |
| Ajustar orçamento e continuar | `jobs.budget.continue { scope: "batch", key: "sources-" + id, maxCostMicroUsd?, confirmed?, resetUsage? }` | Lote em `budget_paused` | Diálogo para digitar novo teto em USD (ou remover teto) e, se pausa for `cost_unknown`, marcar ciência (`confirmed: true`) | Remove pausa em `ai_pauses` e retoma o lote automaticamente | Pausar lote |

### 5. Estados

* **`loading`:** `<Skeleton>` na lista de Fontes selecionáveis (esquerda) e 2 cartões `<Skeleton>` na lista de Lotes (direita).
* **`empty`:**
  * **Quando não há Fontes no Projeto:** *"Importe ao menos uma Fonte antes de criar um Lote de Fontes."* + CTA `Voltar para Fontes` (`#/projeto/:id/fontes`).
  * **Quando há Fontes, mas `batches.list` é `[]`:** na Zona Direita: *"Nenhum lote executado neste Projeto ainda. Selecione Fontes ao lado para processar Transcrição e Seleção em sequência."* + CTA `Focar seleção de Fontes`.
* **`error`:** Container `role="alert"` com mapeador `CoreError.code`:
  * `local_only_violation` → *"Bloqueado pelo modo Somente local: a Tarefa de seleção ou o Motor Groq envia dados para fora da máquina."* → Botões `Escolher Perfil local` (`#/config/provedores`) e `Revisar Somente local` (`#/config/projeto`).
  * `profile_unavailable` / `invalid_settings` → *"Nenhum Perfil de Provedor válido está configurado para selecionar Cortes."* → Botão `Configurar Provedores` (`#/config/provedores`).
  * `uncertain_job` (em `batches.item.resume`) → *"Esta Fonte tem uma chamada paga com resultado incerto. Resolva na Fila de Jobs antes de retomar o item."* → Botão `Abrir Fila de Jobs` (`Ctrl/Cmd+J`).
  * `invalid_batch` / `invalid_budget` → Mensagem específica sobre quantidade de Fontes (`1–500`), duração (`min < max`) ou teto inválido (`≥ 0`).
* **`job_running`:** Lote `running` mostra progresso por item e contagem `concluídos/total`; botões `Pausar lote` e `Cancelar lote` ativos. Outros lotes e abas continuam navegáveis.
* **`partial`:** Lote `attention` (alguns itens `completed`, outros `paused`) ou `budget_paused`: faixa informativa explicando quantas Fontes já concluíram e o motivo exato da pausa das restantes, com ação direta por item (`Retomar item` / `Trocar Perfil de Provedor` / `Ajustar orçamento`).
* **Sem pré-condição:** Se `sources.list` tiver apenas Fontes `offline`, o construtor de Lote desabilita o botão de criação e mostra aviso *"Relocalize uma Fonte offline para incluí-la num lote."*

### 6. Eventos

Escutados via store único de `core-progress`:

* `job === "batch-<id>"` e `stage` em `["batch:created", "batch:item", "batch:item-paused", "batch:paused", "batch:resumed", "batch:cancelled", "batch:completed"]`: solicita `batches.get { id }` (com *debounce* curto) para sincronizar `status`, `counts`, `budget` e `items[]`.
* Eventos `project === currentProjectId` dos jobs filhos (`stage: "transcribing" | "complete" | "failed"` ou `"selection:window" | "selection:done"`): atualizam em tempo real a barra de progresso do item correspondente (`item.transcriptionJob` ou `item.selectionRun`).

### 7. Teclado e acessibilidade

* **Regiões `F6` / `Shift+F6`:** Barra Superior → Subnavegação → Construtor de Lote (Esquerda) → Lista e Grid de Lotes (Direita) → Barra de Status.
* **Padrões WAI-ARIA APG:**
  * Grid de itens de cada lote: `role="grid"` com navegação por setas entre células (`row`/`gridcell`) ou controles focáveis dentro das células.
  * Checkboxes de Fontes no construtor agrupados em `<fieldset>` com `<legend>Fontes do lote</legend>`.
  * Barras de progresso por item: `role="progressbar"` com `aria-valuenow` e `aria-valuetext="Transcrevendo: 62%"`.
  * Diálogos de custo e de ajuste de orçamento usam `<ConfirmDialog>` / `role="dialog"` com foco preso.
  * Erros de item pausado usam ícone + texto (SC 1.4.1).

### 8. US do #26 atendidas

`US-28`, `US-29`, `US-31`, `US-32`, `US-33`, `US-49`, `US-51`.

### 9. Lacunas

* **Núcleo Rust:**
  * Eventos `batch:*` de `core-progress` emitem sempre `percentage: 0`, obrigando o front a reconsultar `batches.get` a cada transição de item.
  * `batches.create` não tem comando `batches.estimate` dedicado: a estimativa de confirmação chega apenas no erro `confirmation_required` (`usage`) após o usuário clicar em criar.
* **Mock TS (`src/lib/batchMock.ts`):**
  * Remover portão `?source-test=1&batch-test=1`.
  * Corrigir `jobs.budget.set` e `jobs.budget.continue` para retornar `{ budgets: [...] }` e suportar `scope: "task"` como o Rust (`01-arquitetura.md` Seção 10.5).
  * Emitir eventos `core-progress` simulados (`batch:created`, `batch:item`, `batch:completed`, etc.) ao criar/pausar/retomar lotes.

### 10. Critérios de aceite (E2E / Playwright com mock)

1. Com `?estado=vazio` em `?sub=lotes`, a Zona Direita exibe `"Nenhum lote executado neste Projeto ainda."`.
2. Ao selecionar 3 Fontes e clicar `"Iniciar lote com 3 Fontes"` com seleção paga, abre `<ConfirmDialog>` com `<ResumoCustoPrivacidade>` mostrando perfil, destino e estimativa antes de enviar `confirmed: true`.
3. Com `projects.local_only` ativo e Motor `Groq` selecionado, tentar criar lote exibe erro mapeado `local_only_violation` com botão para configurações de privacidade.
4. Ao clicar `"Pausar lote"`, o estado muda para `"Pausado pelo usuário"` e o botão alterna para `"Retomar lote"`.
5. Ao clicar `"Cancelar lote"`, exibe `<ConfirmDialog>` de confirmação antes de chamar `batches.cancel`.
6. Um item pausado por erro exibe causa legível em PT-BR e botão `"Retomar item"`; se o retorno for `uncertain_job`, exibe botão `"Resolver na Fila de Jobs"`.
7. Em lote `budget_paused`, exibe faixa com valor gasto vs. teto e botão `"Ajustar orçamento e continuar"` chamando `jobs.budget.continue`.

---

## Tela 3 — Macro-etapa 1: Detalhe da Fonte e Transcrição (`#/projeto/:id/fontes/:fonteId`)

### 1. Objetivo e navegação

* **Objetivo:** Configurar e acompanhar a Transcrição da Fonte (Motor local `US$ 0,00` vs. Groq remoto, amostra de 30 s, agrupamento VAD #279, progresso retomável por blocos de 10 min), disparar/verificar energia do áudio e chat da live, e ler/navegar/corrigir a Transcrição virtualizada com `F2`/`Enter`, `undo`/`redo` do Projeto e busca FTS5.
* **De onde chega:**
  * Ao abrir uma Fonte em `#/projeto/:id/fontes`, ao abrir um item em `#/projeto/:id/fontes?sub=lotes`, ou por resultado da busca global (`?frase=:sentenceId&row=:row`).
* **Para onde vai:**
  * `#/projeto/:id/fontes` (voltar para lista de Fontes).
  * `#/projeto/:id/cortes?fonte=:fonteId` (CTA *"Selecionar Cortes"* quando `transcript.state === "complete"`).
  * `#/config/componentes` (se faltar worker/modelo ou quiser trocar escolha manual global) ou `#/config/provedores` (chave do Groq).

### 2. Layout por zonas

#### 1366 px

```text
+----------------------------------------------------------------------------------+
| SHELL: Barra Superior (Projeto | 1.Fontes | 2.Cortes | 3.Export | Fila | Ctrl+K)  |
+----------------------------------------------------------------------------------+
| CABEÇALHO DA FONTE                                                               |
| <- Fontes | Live_12_11_final.mp4 (03:42:10 · 1080p) | [Disponível]               |
| Idioma: [Português v] | Permissão: [Autorizada - Editar] | [ Ir para Cortes -> ] |
+------------------------------------+---------------------------------------------+
| ZONA ESQUERDA (~36%, scroll próp.) | ZONA DIREITA (~64%, scroll próprio)         |
| MOTOR, PROGRESSO E SINAIS          | LEITOR DA TRANSCRIÇÃO                       |
|                                    | (ou Estado Pré-Transcrição / Em Andamento)  |
| +--------------------------------+ |                                             |
| | MOTOR DE TRANSCRIÇÃO           | | +-----------------------------------------+ |
| | (o) Local — US$ 0,00           | | | [ Desfazer (Ctrl+Z) ] [ Refazer ]       | |
| |     Placa NVIDIA (acelerada)   | | | Escopo: Projeto inteiro (tooltip)       | |
| |     [ Medir amostra 30 s ]     | | | [ Buscar nesta Fonte / Projeto (Ctrl+F)]| |
| |     ETA: ~14 min               | | +-----------------------------------------+ |
| |     Agrupamento VAD:           | | | [Player compacto 16:9 / Áudio]          | |
| |     (o) Auto (Desligado GPU)   | | | (Bloqueado se Fonte offline/alterada)   | |
| |     ( ) Manual [Lig/Desl]      | | | > 00:14:22 | [||] Vol: [===]           | |
| |     i: Na CPU acelera ~18%; na | | +-----------------------------------------+ |
| |        GPU usa ~1 GB VRAM extra| | | 00:14:20 – 00:14:28 · pt                | |
| |        sem ganho medido (#279).| | | "E aí pessoal, [hoje*] vamos testar..." | |
| | ( ) Groq remoto (~US$ 0.44)    | | |-----------------------------------------| |
| |     [ResumoCustoPrivacidade]   | | | 00:14:28 – 00:14:31 · Silêncio (2,8 s)  | |
| | [ Iniciar / Retomar Transcr. ] | | |-----------------------------------------| |
| +--------------------------------+ | | 00:14:31 – 00:14:40 · pt                | |
| | BLOCOS E PROGRESSO (10 min)    | | | "Presta atenção nessa jogada aqui..."   | |
| | Barra: [########----] 64%      | | |                                         | |
| | Bloco 15/23 · ETA ~5 min       | | |                                         | |
| | [x] 00:00–00:10 (GPU)          | | | Dica: Clique=ir ao vídeo · F2/Enter=    | |
| | [x] 00:10–00:20 (GPU) ...      | | | corrigir palavra · Setas=navegar        | |
| | [ Pausar / Cancelar ]          | | +-----------------------------------------+ |
| +--------------------------------+ |                                             |
| | SINAIS PARA SELEÇÃO DE CORTES  | |                                             |
| | Energia: [Medida: 18 picos]    | |                                             |
| | Chat:    [Disponível: 42 picos]| |                                             |
| +--------------------------------+ |                                             |
+------------------------------------+---------------------------------------------+
| SHELL: Barra de Status (Salvo | Transcrição: bloco 15/23 · GPU | F6 · Ctrl+F)     |
+----------------------------------------------------------------------------------+
```

#### Variação em 1440+ px

* Coluna esquerda fixa entre `380–440 px`, dando > `960 px` à direita para o Leitor Virtualizado da Transcrição (texto limitado a largura de leitura confortável `≤ 72 ch` dentro da área, evitando linhas excessivamente longas, com coluna de timestamps à esquerda de cada Frase).
* Quando a Transcrição ainda não foi concluída (`transcript === null` ou `resume_us < duration_us` pela primeira vez), a Zona Direita exibe um painel didático de pré-visualização/blocos em andamento em vez de uma caixa vazia.

### 3. Conteúdo e componentes

* **Cabeçalho da Fonte:**
  * Link/botão `← Voltar para Fontes` (`#/projeto/:id/fontes`).
  * Título com nome do arquivo, duração (`tabular-nums`), resolução e faixa de áudio selecionada.
  * `<Status>` de integridade (`Disponível` / `Offline` / `Alterada`) com botão contextual imediato (`Relocalizar` / `Verificar identidade`).
  * Idioma da Fonte (`sources.language.set`, habilitado apenas se `transcript === null` ou `resume_us === 0` e sem job ativo).
  * Badge editável da Permissão (`sources.permission.set`), indicando se cobre tradução.
  * CTA primário **"Selecionar Cortes →"** (`#/projeto/:id/cortes?fonte=:fonteId`), habilitado quando `transcript?.state === "complete"`.
* **Zona Esquerda — Motor, Progresso por Blocos e Sinais:**
  1. **Cartão de Escolha do Motor de Transcrição** (visível para iniciar, retomar ou reiniciar):
     * **Opção 1 — Local (`US$ 0,00`):**
       * Status do hardware (`transcription.hardware.status`) em linguagem simples: *"Placa de vídeo NVIDIA detectada — processamento acelerado"* (`cuda`) ou *"Rodando no processador (CPU)"* (`cpu`, exibindo `fallback_reason` se caiu de GPU por timeout/falha). Detalhes técnicos (`model`, `compute_type`, VRAM livre) ficam recolhidos em `<details>Detalhes técnicos</details>`, com link para `#/config/componentes`.
       * **Estimativa por amostra de 30 s (`transcription.estimate`):** botão *"Estimar tempo (amostra de 30 s)"* (ou resultado em cache `cached: true` exibindo faixa `low_s–high_s`, `estimate_s` e eventuais avisos `ram_unknown` / `low_ram`: *"Memória RAM baixa para este modelo; considere acompanhar outros apps abertos"*). Cancelável via `components.cancel { id: "transcription-estimate" }`.
       * **Agrupamento de trechos de VAD (`transcription.grouping` — #279):**
         * Seletor: `Automático (recomendado)` (`auto: true`) vs. `Manual` (`enabled: true | false`).
         * Exibe estado efetivo (`Ligado — até N trechos` / `Desligado`) e o **aviso obrigatório do #279**: *"No modo automático, o agrupamento fica ligado na CPU (acelera em ~18%) e desligado na GPU (evita gastar ~1 GB extra de VRAM sem ganho medido)."*
     * **Opção 2 — Groq remoto (explícito):**
       * Alimentado por `transcription.groq.info` e `transcription.groq.estimate { source_id }`.
       * Se `projects.local_only` estiver ativo (`local_only: true`), mostra selo de bloqueio *"Indisponível no modo Somente local"*.
       * Se disponível, exibe `<ResumoCustoPrivacidade>`: endpoint `api.groq.com`, modelo `whisper-large-v3-turbo`, aviso *"Envia apenas o áudio com fala (FLAC) para fora da máquina"*, faixa estimada `~US$ min – US$ max` (mencionando cobrança mínima de 10 s por chamada e duração restante `audio_us`), estado da chave no cofre (`configured: true/false` com atalho *"Configurar chave do Groq"* → `#/config/provedores`) e caixa de consentimento (`transcription.groq.confirm`) se `confirmed: false`.
     * **Botão principal:**
       * `Iniciar transcrição` (quando `transcript === null`)
       * `Retomar de MM:SS` (quando parcial `resume_us > 0`)
       * Se o usuário mudou o Motor (`local` ↔ `groq`) ou modelo local em uma Transcrição parcial, ao clicar dispara `transcription.start`, trata `engine_change_confirmation` exibindo `<ConfirmDialog>` com quantos blocos/áudio pago já foram salvos (`usage: { blocks, paid_audio_us, paid_usd }`) e avisando que continuar apagará o progresso parcial, reenviando com `replace_confirmed: true`.
  2. **Cartão de Progresso e Blocos de 10 min (`transcription.blocks` + `transcription.status`):**
     * Barra de progresso determinística (`role="progressbar"`): calcula % entre `resume_us / duration_us` e `job.progress`, exibe estágio legível (`Preparando GPU`, `GPU indisponível — continuando na CPU`, `Transcrevendo bloco X de Y`), bloco atual e **ETA restante** (`estimate_s * (1 - progresso)` quando disponível).
     * Lista compacta de blocos concluídos (`transcription.blocks`): cada bloco mostra intervalo `HH:MM:SS–HH:MM:SS` e selo `GPU` ou `CPU` (traduzindo `device`, com `compute_type` apenas em tooltip/detalhes técnicos), deixando explícito que blocos concluídos já estão salvos no SQLite e sobrevivem a pausa ou fechamento do app.
     * Botão **"Pausar / Cancelar mantendo blocos salvos"** (`jobs.cancel { id: job_id }`).
  3. **Cartão de Sinais para Seleção de Cortes:**
     * **Energia do áudio (`energy.status` / `energy.start`):**
       * `measured: true` → *"Medida · {marks.peak} picos e {marks.high} trechos altos"*
       * `job` em `queued`/`running` → *"Medindo energia do áudio ({progress}%)…"* + botão `Cancelar` (`jobs.cancel`).
       * `measured: false` (e `transcript.state === "complete"` sem job ativo) → *"Ainda não medida"* + botão **"Medir energia agora"** (`energy.start`).
     * **Chat da live (`chat.status` / `chat.fetch`):**
       * `state === "available"` → *"Disponível · {peaks} picos em {intervals} intervalos ({messages} mensagens)"*
       * `state === "absent"` → *"Esta live não possui replay de chat no YouTube"*
       * `job` em `queued`/`running` → *"Buscando replay de chat ({progress}%)…"* + botão `Cancelar` (`jobs.cancel`).
       * `state === "none"` e `canFetch === true` → *"Não buscado ainda"* + botão **"Buscar chat da live"** (`chat.fetch`).
       * `canFetch === false` → *"Disponível apenas para lives importadas por URL do YouTube."*
* **Zona Direita — Leitor Virtualizado da Transcrição (`transcript.state === "complete"`):**
  * **Barra de ferramentas do Leitor:**
    * Botões **Desfazer (`Ctrl/Cmd+Z`)** e **Refazer (`Ctrl/Cmd+Shift+Z`)** alimentados por `transcription.corrections` (`can_undo`, `can_redo`), com rótulo/tooltip explícito: *"Desfaz a última correção de palavra no Projeto inteiro (pode afetar outra Fonte)"*.
    * Botão/campo de busca (`Ctrl/Cmd+F`) com seletor de escopo (`Nesta Fonte` | `Todo o Projeto`) chamando `transcription.search`.
    * Contador de palavras e Frases + legenda de atalhos (`Clique = ir ao vídeo · F2 ou Enter = corrigir grafia`).
  * **Player de referência compacto (no topo da Zona Direita):**
    * Usa `<video>`/`<audio>` apontando para `mediaUrl("source/" + fonteId)` quando `source.status === "available"`.
    * Quando `source.status === "offline" | "changed"`, o player não tenta carregar mídia e exibe banner inline: *"Vídeo indisponível no disco — você ainda pode ler, buscar e corrigir toda a Transcrição. Relocalize a Fonte para reproduzir o trecho."*
    * Ao clicar em qualquer palavra (`w.start_us`), o player faz `seek` para `w.start_us / 1_000_000` (e opcionalmente inicia/mantém reprodução).
  * **Lista Virtualizada (`<ListaVirtual>` sobre `transcription.timeline`):**
    * Inicializada com `transcription.segment { source_id }` (idempotente) e paginada por demanda (`offset`, `limit: 200` ou `500`).
    * **Item tipo `sentence`:**
      * Cabeçalho: timecode `HH:MM:SS – HH:MM:SS` (`tabular-nums`) + código de idioma detectado na Frase (`language`, útil em lives bilíngues `US-53`).
      * Corpo: sequência de palavras (`words[]`). Cada palavra é um botão/span interativo (`data-word={position}`, alvo ≥ 24×24 CSS px por padding/espaçamento). Palavras com `corrected === true` exibem indicador visual **não só por cor** (sublinhado pontilhado + ícone discreto de lápis + `aria-description="Palavra corrigida"`). Palavra correspondente ao tempo atual do player recebe destaque de acompanhamento ativo.
      * Modo edição inline (`F2` ou `Enter` na palavra focada): substitui a palavra por `<input>` focado com `aria-label="Corrigir palavra"`, `Enter` confirma (`transcription.correct`), `Esc` cancela sem salvar.
    * **Item tipo `silence` (`US-56`):**
      * Faixa diferenciada visual e semanticamente (`Silêncio · 3,4 s · 00:14:28 – 00:14:31`), clicável para pular o player até aquele trecho, não editável.

### 4. Ações

| Ação do usuário | Comando(s) do núcleo | Pré-condições | Confirmação / Custo | O que muda na tela depois | Desfazer |
|---|---|---|---|---|---|
| Medir amostra de 30 s (Local) | `transcription.estimate { project, source_id, remeasure }` | Fonte `available`; FFmpeg, worker e modelo instalados | Nenhuma (`US$ 0,00`) | Mostra ETA (`low_s–high_s`) e avisos de RAM | Cancelar via `components.cancel { id: "transcription-estimate" }` |
| Alterar agrupamento VAD (#279) | `transcription.grouping { auto: true }` ou `{ enabled }` | Nenhuma (configuração global) | Nenhuma | Atualiza estado efetivo (`Automático` / `Manual`) e estimativa de comportamento | Alternar novamente |
| Confirmar envio remoto Groq | `transcription.groq.confirm { endpoint, confirmed: true }` | Projeto sem veto `Somente local` | Checkbox/diálogo explícito com `<ResumoCustoPrivacidade>` | Marca `confirmed: true` em `transcription.groq.info` | Não (pode voltar a escolher Local) |
| Iniciar / Retomar Transcrição | `transcription.start { project, source_id, engine, language?, replace_confirmed?, retry_confirmed? }` | Fonte `available`; pré-requisitos do Motor atendidos | • Se `confirmation_required` (Groq): `<ConfirmDialog>` com `<ResumoCustoPrivacidade>`<br>• Se `engine_change_confirmation`: `<ConfirmDialog>` avisando descarte dos `usage.blocks` salvos → `replace_confirmed: true`<br>• Se `transcription_retry_confirmation`: `<ConfirmDialog>` com `usage.estimate` → `retry_confirmed: true` | Enfileira job `transcription`, exibe progresso e blocos | `jobs.cancel { id: job_id }` (preserva blocos concluídos até `resume_us`) |
| Pausar / Cancelar Transcrição | `jobs.cancel { id: job_id }` | Job `queued` ou `running` | Nenhuma (blocos já salvos são preservados; se Groq pago já em voo, informa que chamada em curso pode virar `uncertain`) | Job encerra; UI mostra progresso parcial salvo e botão `"Retomar de MM:SS"` | Retomar via `transcription.start` |
| Medir energia do áudio | `energy.start { source_id }` | Transcrição `complete`; Fonte `available` | Nenhuma (local) | Enfileira job `energy` e mostra progresso `0..100%` | `jobs.cancel { id: job_id }` |
| Buscar replay de chat | `chat.fetch { source_id }` | Fonte com `origin_url`; `yt-dlp` instalado | Nenhuma (local) | Enfileira job `chat` e atualiza contadores ao concluir | `jobs.cancel { id: job_id }` |
| Clicar numa palavra | (Local no player) + `mediaUrl("source/" + fonteId)` | `source.status === "available"` | Nenhuma | Move playhead do player para `word.start_us` | Clicar em outro ponto |
| Corrigir palavra (`F2`/`Enter`) | `transcription.correct { source_id, position, text }` | Transcrição gravada | Nenhuma (reversível imediato) | Atualiza texto da palavra/Frase na página carregada (sem desmontar foco), atualiza `can_undo`/`can_redo`, invalida `export.captions` e FTS5 | `Ctrl/Cmd+Z` (`transcription.undo`) |
| Desfazer / Refazer global do Projeto | `transcription.undo {}` / `transcription.redo {}` | `can_undo` / `can_redo === true` | Nenhuma | Reverte/reaplica a última correção do Projeto; se `r.source_id === fonteId`, atualiza e foca a palavra; se for de outra Fonte, exibe toast com link *"Ir para Fonte afetada"* | O comando oposto (`redo` / `undo`) |
| Buscar no texto (`Ctrl/Cmd+F`) | `transcription.search { query, limit: 50 }` | Projeto aberto | Nenhuma | Lista Frases com `snippet`; ativar resultado rola `transcription.timeline` até `row` e foca a Frase (`sentence_id`) | Limpar busca |

### 5. Estados

* **`loading`:** `<Skeleton>` no cabeçalho da Fonte, nos cartões da Zona Esquerda (Motor + Sinais) e 6 linhas `<Skeleton>` de Frase na Zona Direita.
* **`empty`:**
  * **Antes de transcrever (`transcript === null` e sem job ativo):** Zona Direita exibe cartão orientador: *"Esta Fonte ainda não foi transcrita. Escolha o Motor ao lado (Local grátis ou Groq) e clique em Iniciar transcrição."* + CTA `Focar configuração do Motor`.
  * **Busca sem resultados:** *"Nenhum trecho encontrado para '<termo>'."* + botão `Limpar busca`.
* **`error`:** Container `role="alert"` com mapeador `CoreError.code`:
  * `worker_missing` / `model_missing` → *"Falta instalar o motor ou o modelo de transcrição local para o hardware atual."* → Botão `Abrir Componentes` (`#/config/componentes`).
  * `out_of_memory` → *"Faltou memória de vídeo/RAM durante a transcrição. Tente usar o modo CPU ou fechar outros programas."* → Botão `Ajustar hardware` (`#/config/componentes`).
  * `local_only_violation` → *"Bloqueado pelo modo Somente local: o Groq envia áudio para fora da máquina."* → Botões `Usar Motor Local` e `Revisar Somente local` (`#/config/projeto`).
  * `groq_key_missing` / `groq_key` → *"Chave da API do Groq ausente ou inválida."* → Botão `Configurar chave do Groq` (`#/config/provedores`).
  * `audio_too_large` / `rate_limit` / `network` / `groq_http` → Explicação clara (limite atingido / falha de rede / resposta do Groq) + botão `Retomar do último bloco salvo` (ou `Trocar para Local`).
  * `transcription_uncertain` / `timeout_uncertain` → *"Uma chamada paga do Groq ficou sem confirmação de resposta. Resolva na Fila de Jobs antes de continuar."* → Botão `Abrir Fila de Jobs` (`Ctrl/Cmd+J`).
  * `source_changed` / `source_offline` (ao tentar iniciar transcrição ou medir energia) → *"O arquivo da Fonte não está disponível ou mudou no disco."* → Botão `Relocalizar / Verificar Fonte`.
  * `invalid_correction` → *"Digite entre 1 e 200 caracteres válidos para corrigir a palavra."*
* **`job_running`:** Cartão de Progresso e Blocos exibe barra determinística, bloco `N/M`, ETA e botões de cancelar; o usuário continua podendo editar Permissão, navegar entre etapas do Projeto ou ler blocos anteriores caso reabra depois.
* **`partial`:** Quando `transcript.state === "running"` e não há job `queued`/`running` (transcrição pausada, cancelada ou falha após concluir alguns blocos):
  * Faixa informativa no topo da Zona Direita: `"Transcrição parcial salva até MM:SS (X de Y blocos concluídos). Você pode retomar de onde parou sem refazer o que já foi processado."` + CTA `Retomar de MM:SS`.
* **Sem permissão / pré-condição:**
  * Se `source.status !== "available"`, iniciar nova transcrição ou medir energia fica bloqueado com explicação e botão de relocalizar/verificar, **mas o Leitor da Transcrição já concluída permanece 100% utilizável e editável** (apenas o player de áudio/vídeo fica desabilitado).

### 6. Eventos

Escutados via store único de `core-progress`:

* `job === "transcription-estimate"` + `stage === "estimate"`: atualiza progresso `0..100%` da amostra de 30 s.
* `job === String(activeTranscriptionJobId)` + `project === currentProjectId`:
  * `stage === "probe"`: exibe `"Verificando placa de vídeo (0–99%)…"`.
  * `stage === "gpu_probe_fallback"`: exibe aviso persistente discreto `"A verificação da GPU falhou; continuando na CPU."` e recarrega `transcription.hardware.status`.
  * `stage === "transcribing"`: atualiza barra (`percentage`), bloco atual e reconsulta `transcription.blocks` quando cruza novo bloco.
  * `stage === "complete"`: reconsulta `transcription.status`, `transcription.blocks`, dispara `transcription.segment` + `transcription.timeline` e começa a acompanhar o job `energy` enfileirado automaticamente.
  * `stage === "failed"`: reconsulta `transcription.status` e exibe erro traduzido pelo mapeador `CoreError.code` mantendo blocos salvos visíveis.
* `job === String(activeEnergyJobId)` + `stage === "energy" | "complete" | "failed"`: atualiza cartão de Energia (`energy.status`).
* `job === String(activeChatJobId)` + `stage === "chat" | "complete" | "failed"`: atualiza cartão de Chat (`chat.status`).

### 7. Teclado e acessibilidade

* **Regiões `F6` / `Shift+F6`:** Barra Superior → Cabeçalho da Fonte → Painel Motor/Progresso/Sinais (Esquerda) → Barra/Player do Leitor → Lista Virtualizada da Transcrição (Direita) → Barra de Status.
* **Atalhos na tela (sem conflitos com o mapa de [01-arquitetura.md](../01-arquitetura.md)):**
  * `F2` ou `Enter` *(sobre palavra focada)*: abre edição inline (`transcription.correct`).
  * `Enter` *(no input inline)*: confirma correção; `Esc`: cancela e devolve foco à palavra.
  * `←` / `→` *(no leitor)*: move foco palavra a palavra (rolando página virtualizada automaticamente ao atingir as bordas visíveis); `Home` / `End`: primeira / última palavra da Frase atual.
  * `Espaço` *(quando foco está no player ou fora de campo de texto)*: reproduz/pausa o player de referência; se uma palavra estiver focada e o usuário usar botão/duplo clique ou `Ctrl/Cmd+Espaço` / clique, salta o player para aquela palavra *(mantendo `Enter` alinhado a corrigir grafia conforme Seção 8 de `01-arquitetura.md`)*.
  * `Ctrl/Cmd+Z` / `Ctrl/Cmd+Shift+Z` (ou `Ctrl+Y`) *(com foco na Transcrição)*: chama `transcription.undo` / `transcription.redo`.
  * `Ctrl/Cmd+F`: foca o campo de busca da Transcrição.
* **Padrões WAI-ARIA APG:**
  * Leitor virtualizado usa `<ListaVirtual>` (`role="listbox"` ou `role="region"` com lista paginada de Frases `role="article"` / palavras focáveis por *roving tabindex*, mantendo o nó focado estável durante correções sem re-renderizar a página inteira).
  * Cada palavra clicável garante área mínima ≥ 24×24 CSS px (`min-w-6 min-h-6 inline-flex items-center`, SC 2.5.8).
  * Palavras corrigidas e blocos de `Silêncio` usam ícone + rótulo textual/ARIA além de cor (SC 1.4.1).
  * Progresso da transcrição anuncia em `role="status"` com *throttle* (ex.: a cada 5% ou troca de bloco); falhas usam `role="alert"`.

### 8. US do #26 atendidas

`US-10`, `US-11`, `US-12`, `US-13`, `US-25`, `US-27`, `US-28`, `US-33`, `US-37`, `US-43`, `US-50`, `US-51`, `US-52`, `US-53`, `US-54`, `US-55`, `US-56`, `US-57`, `US-58`, `US-60`, `US-62`, `US-125`.

### 9. Lacunas

* **Núcleo Rust:**
  * `transcription.grouping` (#279): confirmar no código Rust a assinatura final (`auto: true`, `mode: "auto" | "manual"`, `measured_size`) marcada como pendente em `03-transcricao.md:113`.
  * `transcription.corrections` retorna apenas `{ can_undo, can_redo }`, sem metadados do próximo passo (`source_id`, `source_name`, `word`) para exibir no tooltip *antes* de apertar `Ctrl+Z`.
  * `transcription.blocks` não informa o total de blocos previsto nem o tempo por bloco para cálculo fino de ETA no servidor (a UI calcula `Math.ceil(duration_us / 600_000_000)` e estima ETA usando `transcription.estimate`).
  * `jobs.preview` ainda retorna caminhos absolutos de disco em vez de chaves opacas `clipes-media` (afeta exibição eventual de waveform/miniaturas na referência da Fonte; o player usa `mediaUrl("source/" + fonteId)`).
* **Mock TS (`src/lib/core.ts`):**
  * Remover portões `?source-test=1`, `?transcript-test=1` e `?hardware-cpu=1`.
  * Adicionar handlers ausentes: `transcription.blocks`, `transcription.sentences`, `transcription.words`, `energy.start`, `jobs.preview`.
  * Corrigir divergências no mock: `transcription.groq.info` incluir `model` e `prices`; `transcription.groq.estimate` incluir `minMicroUsd`, `maxMicroUsd`, `audio_us`; `transcription.status` incluir `model` e `engine`; `transcription.start` suportar `warnings` e alteração de `language`; `chat.status` incluir `intervals` e `messages`.
  * Emitir `core-progress` simulado para `transcription.estimate`, `transcription.start` (com estágios `probe` → `transcribing` → `complete`), `energy.start` e `chat.fetch`.

### 10. Critérios de aceite (E2E / Playwright com mock)

1. Em `#/projeto/demo/fontes/999` (`fonteId` inexistente), redireciona para `#/projeto/demo/fontes` exibindo alerta humano.
2. Com `?estado=vazio` (Fonte sem transcrição), a Zona Direita exibe `"Esta Fonte ainda não foi transcrita."` e o cartão do Motor exibe `Local — US$ 0,00` e o aviso do `#279` sobre agrupamento de VAD (`~18%` na CPU vs. `~1 GB` de VRAM na GPU).
3. Ao selecionar `Groq`, exibe `<ResumoCustoPrivacidade>` com endpoint `api.groq.com`, faixa em USD e consentimento; se `projects.local_only` estiver ligado, bloqueia disparo remoto com orientação clara.
4. Ao clicar `"Estimar tempo (amostra de 30 s)"`, emite progresso `transcription-estimate` e exibe faixa estimada `low_s–high_s` em linguagem simples sem expor `int8_float16` fora de *Detalhes técnicos*.
5. Durante job `transcription` ativo, exibe barra determinística, bloco atual (`N/M`), lista `transcription.blocks` e botão `"Pausar / Cancelar mantendo blocos salvos"` (`jobs.cancel`).
6. Ao tentar trocar de `Local` para `Groq` em uma Transcrição parcial (`resume_us > 0`), exibe `<ConfirmDialog>` com contagem de blocos que serão descartados antes de reenviar `replace_confirmed: true`.
7. Quando `transcript.state === "complete"` e `energy.status().measured === false`, o cartão de Sinais exibe o botão `"Medir energia agora"` (`energy.start`).
8. No Leitor Virtualizado, trechos `silence` aparecem explicitamente rotulados (`Silêncio · X,X s`), palavras têm alvo mínimo ≥ 24×24 px e pressionar `F2` ou `Enter` na palavra focada abre edição inline; confirmar salva via `transcription.correct` mantendo o foco na palavra.
9. Clicar em `"Desfazer"` (`Ctrl+Z`) chama `transcription.undo`; quando a correção desfeita pertencer a outra Fonte do Projeto, exibe toast explicativo com link para aquela Fonte.
10. Se a Fonte estiver `offline`, o player fica bloqueado com aviso claro, mas `transcription.timeline`, busca `Ctrl+F` e correção `F2` continuam funcionando normalmente.

---

## Componentes compartilhados usados

Interfaces mínimas propostas para unificação entre pacotes pelo coordenador (reaproveitando primitivas já presentes em `design-system/src/components/` quando existentes):

1. **`<ResumoCustoPrivacidade>`** *(obrigatório pela Seção 7 de [01-arquitetura.md](../01-arquitetura.md))*
   ```ts
   interface ResumoCustoPrivacidadeProps {
     tarefa: string; // ex.: "Transcrição Groq" | "Seleção de Cortes"
     perfilNome: string;
     modelo: string;
     destino: { tipo: 'local' | 'remoto' | 'cli'; host?: string; cli?: string };
     estimativa:
       | { kind: 'zero' }
       | { kind: 'usd'; minMicroUsd: number; maxMicroUsd: number; tokens?: number; nota?: string }
       | { kind: 'plan_quota' }
       | { kind: 'unknown' };
     orcamentoRestanteMicroUsd?: number | null;
     localOnlyAtivo?: boolean;
     consentido?: boolean;
     aoConfirmarConsentimento?: () => void;
   }
   ```
2. **`<ConfirmDialog>`** *(Base UI Dialog com focus trap incluindo `<textarea>` e retorno de foco ao gatilho)*
   ```ts
   interface ConfirmDialogProps {
     aberto: boolean;
     aoFechar: () => void;
     titulo: string;
     descricao: string | React.ReactNode; // permite embutir <ResumoCustoPrivacidade>
     rotuloConfirmar: string;
     rotuloCancelar?: string;
     variante?: 'padrao' | 'perigo';
     carregando?: boolean;
     aoConfirmar: () => void | Promise<void>;
   }
   ```
3. **`<Status>`** *(já existe em `design-system/src/components/ui/Status.tsx` — sempre ícone + rótulo textual, SC 1.4.1)*
   ```ts
   interface StatusProps {
     tom: 'neutro' | 'info' | 'sucesso' | 'aviso' | 'perigo';
     rotulo: string;
     descricao?: string;
   }
   ```
4. **`<ListaVirtual>`** *(já existe em `design-system/src/components/ui/VirtualList.tsx` — suporte a paginação por demanda e rolagem programática por `row`)*
   ```ts
   interface ListaVirtualProps<T> {
     total: number;
     alturaItem: number | ((indice: number) => number);
     carregarPagina?: (offset: number, limit: number) => Promise<void>;
     itemPorIndice: (indice: number) => T | undefined;
     renderizarItem: (item: T, indice: number) => React.ReactNode;
     rolarParaIndice?: number | null;
     ariaLabel: string;
   }
   ```
5. **`<Skeleton>`** *(novo ou derivado de `Estado.tsx` — contorno neutro para `loading`, respeitando `prefers-reduced-motion`)*
   ```ts
   interface SkeletonProps {
     variante: 'lista-fontes' | 'cartao-lote' | 'transcricao' | 'linha';
     quantidade?: number;
   }
   ```
6. **`<BannerErroCore>`** *(consumidor do mapeador central `CoreError.code` da Seção 6 de [01-arquitetura.md](../01-arquitetura.md))*
   ```ts
   interface BannerErroCoreProps {
     erro: { code: string; message: string; usage?: unknown };
     acaoRecuperacao?: { rotulo: string; aoAcionar: () => void };
     aoDispensar?: () => void;
   }
   ```
7. **`<CampoPermissao>`** *(específico de Fontes e reuso eventual em resumo no Empacotamento/Configurações)*
   ```ts
   interface CampoPermissaoProps {
     valor: { status: 'none' } | { status: 'granted'; who: string; where: string; scope: string };
     aoMudar: (proximo: CampoPermissaoProps['valor']) => void;
     somenteLeitura?: boolean;
   }
   ```
8. **`<PlayerReferenciaFonte>`** *(player leve para Fonte inteira via `mediaUrl("source/" + fonteId)`, distinto do `<PlayerProxy>` 9:16 do Editor/Revisão que usa `proxy.request` para janelas ≤ 10 min)*
   ```ts
   interface PlayerReferenciaFonteProps {
     fonteId: number;
     disponivel: boolean;
     seekUs?: number | null;
     aoMudarTempoUs?: (tempoUs: number) => void;
   }
   ```

---

## Questões para a arquitetura

1. **Parâmetro de sub-visão para Lotes (`?sub=fontes|lotes`):** A Seção 3 de [01-arquitetura.md](../01-arquitetura.md) lista `#/projeto/:id/fontes` sem especificar query param para Lotes (diferente de `#/projeto/:id/exportacao?sub=prontidao|lotes`). Supusemos `?sub=fontes|lotes` dentro de `#/projeto/:id/fontes` (padrão `fontes`) para manter histórico do navegador (`Voltar`/`Avançar`) e links diretos vindos da Fila de Jobs. Confirmar se o coordenador adota `?sub=lotes` oficialmente na tabela de rotas.
2. **Player da Fonte inteira vs. `proxy.request` no Detalhe da Fonte (`#/projeto/:id/fontes/:fonteId`):** `proxy.request` rejeita trechos > 10 min (`clip_too_long`) porque gera proxy apenas para Cortes (±2 min). Para atender `US-55` (*"clicar numa palavra e ir ao momento dela no preview"*) na Fonte inteira (lives de 4–10 h), supusemos usar `mediaUrl("source/" + fonteId)` diretamente (que já suporta HTTP `206 Range` em `core/src/media.rs`). Se o vídeo original for MKV/codec não suportado nativamente pela WebView (ex.: WebKitGTK ou WebView2 sem codec), não existe fallback de transcodificação em tempo real no núcleo. Vale registrar na arquitetura se o player da Fonte em `#/projeto/:id/fontes/:fonteId` deve usar `<video>`/`<audio>` sobre `source/<id>` com degradação graciosa se o codec não tocar na WebView.
3. **Alinhamento de `transcription.grouping` (#279) entre Macro-etapa 1 e Configurações:** `transcription.grouping` altera uma preferência **global** (`transcription-hardware.json`), não por Fonte nem por Projeto. Expusemos o controle + aviso do `#279` inline no cartão do Motor Local em `#/projeto/:id/fontes/:fonteId` conforme pedido na Seção 2 e Seção 12 de `01-arquitetura.md`, deixando claro no rótulo que a preferência vale para o app todo (sincronizada com `#/config/componentes` no Pacote A). Confirmar que essa duplicação controlada é desejada e que o contrato exato de entrada/saída (`auto: true`, `mode: "auto" | "manual"`) já estará fechado antes da Fase 5.
4. **Escopo global de `transcription.undo` / `transcription.redo` e feedback prévio:** O núcleo mantém uma única pilha de correções para o Projeto inteiro (`transcript_corrections`), mas `transcription.corrections` devolve apenas `{ can_undo, can_redo }`. Sem um campo opcional como `next_undo: { source_id, source_name, word }` no retorno de `transcription.corrections`, o tooltip de `Desfazer` só consegue avisar genericamente (*"pode afetar outra Fonte"*) e identificar a Fonte afetada apenas *depois* da execução (`r.source_id`). Recomendar ou não ticket simples de enriquecimento em `transcription.corrections`?
5. **Conflito potencial entre `Enter` na palavra (`F2`/`Enter` = corrigir) vs. `Enter` para abrir/ativar:** Na Seção 8 de `01-arquitetura.md`, `F2` ou `Enter` na palavra focada entra em edição (`transcription.correct`). Para atender `US-55` (navegar no vídeo pela palavra) sem colidir com `Enter`, supusemos **clique do mouse** (e opcionalmente `Ctrl/Cmd+Espaço` ou botão *"Ouvir aqui"*) para posicionar o player, mantendo `Enter` exclusivo para corrigir grafia. Confirmar se essa distinção atende o esperado.
