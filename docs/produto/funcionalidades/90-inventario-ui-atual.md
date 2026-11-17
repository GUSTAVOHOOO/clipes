# Inventário da UI atual (v1)

Documento de referência da Fase 1 do front v2. Mapeia a arquitetura, as 5 páginas atuais, os componentes em `src/features/**`, a cobertura completa dos **237 comandos** registrados em `core/src`, os problemas de UX verificados no código e os módulos puros reaproveitáveis.

> **Nota sobre capturas:** `node_modules` não está instalado neste worktree; conforme as restrições da tarefa, `bun install` não foi executado e não foram geradas capturas em navegador. Toda a análise abaixo é baseada na leitura direta do código-fonte em `src/`, `design-system/` e `core/src`.

---

## Como a UI está montada

### Ponto de entrada e inicialização (`src/main.tsx`)

O ponto de entrada WebView é [src/main.tsx](../../../src/main.tsx) (67 linhas):

1. Importa o CSS global [src/styles/index.css](../../../src/styles/index.css) (`main.tsx:22`).
2. Executa `iniciarTema()` de [src/lib/tema.ts](../../../src/lib/tema.ts) antes do primeiro render (`main.tsx:59`), aplicando `data-theme="dark" | "light"` no `<html>` (com suporte a `?tema=claro|escuro`).
3. Em ambiente Tauri (`isTauri()`), aguarda `initMediaTransport()` ([src/lib/media.ts](../../../src/lib/media.ts)) antes de montar o React root (`main.tsx:61-64`); no navegador (modo mock), monta imediatamente (`main.tsx:65-67`).
4. O componente raiz `<App />` ([src/main.tsx#L54-L58](../../../src/main.tsx#L54-L58)) fornece `LanguageContext` (`'pt-BR'` padrão, persistido em `localStorage['clipes.language']`) e `ComandosProvider` ([src/lib/comandos.tsx](../../../src/lib/comandos.tsx)).

### Shell, navegação e troca de páginas

* **Onde fica o shell:** Não há componente de shell em `src/features/shell/` — essa pasta contém apenas [src/features/shell/texts.ts](../../../src/features/shell/texts.ts) (4 linhas). O shell principal (`Shell`) está implementado diretamente em [src/main.tsx#L24-L53](../../../src/main.tsx#L24-L53), apoiado pelos componentes de [src/components/shell/Paleta.tsx](../../../src/components/shell/Paleta.tsx) e [src/components/shell/Gaveta.tsx](../../../src/components/shell/Gaveta.tsx).
* **Troca de páginas (sem roteador):** A navegação entre as 5 páginas usa apenas estado local `useState<Page>('home')`, onde `type Page = 'home' | 'about' | 'preferences' | 'components' | 'report'` ([src/main.tsx#L24-L26](../../../src/main.tsx#L24-L26)). Não há URL/hash routing, histórico de navegação (`back`/`forward`), nem sub-rotas para Projeto, Fonte ou Corte.
* **Barra superior e paleta:** O `<header>` (`h-(--topbar-h)` = 44 px) exibe a marca `Clipes`, 5 botões fantasma para trocar de página e `<GatilhoPaleta />` (`Ctrl+K`). `useComandos` registra na paleta os comandos das 5 páginas e das 2 gavetas laterais (`[` e `]`).
* **Gavetas laterais ociosas no shell:** [src/main.tsx#L47-L52](../../../src/main.tsx#L47-L52) monta duas instâncias de `<ZonaBorda>`, `<Puxador>` e `<GavetaBorda>` lendo contribuições via `import.meta.glob('../features/*/drawer.tsx')` em [src/lib/drawers.ts](../../../src/lib/drawers.ts). Como não existe nenhum arquivo `src/features/*/drawer.tsx` no repositório, as gavetas da tela principal sempre exibem `"Nenhuma ferramenta disponível."`.
* **Camadas globais fora do `<main>`:** O shell monta permanentemente `<Paleta />`, `<UpdateNotice />`, `<Assistant />` (que abre automaticamente na primeira execução ou via evento `clipes:assistant-open`, e pode saltar para `preferences` + `#provider-title` via `scrollIntoView`) e `<EditorHost />` (que abre o `<Editor />` em `fixed inset-0` quando recebe o evento `clipes-editor-open`).

### Chamada ao núcleo (`src/lib/core.ts`)

* **Função única de despacho:** Toda comunicação UI → núcleo passa por `coreDispatch<T>(name: string, args: object): Promise<T>` ([src/lib/core.ts#L309-L884](../../../src/lib/core.ts#L309-L884)).
* **No Tauri:** Invoca `invoke<T>('core_dispatch', { name, arguments: args })` (`src/lib/core.ts:883`).
* **Tipagem:** Genérico `<T>` declarado manualmente no ponto de chamada (ex.: `coreDispatch<Status>(...)`); não existe mapa centralizado de assinatura comando → argumentos/retorno no TypeScript, o que deixa nomes e payloads desacoplados sem checagem estática de contrato.
* **Tratamento de erro:** Não há wrapper central de erro. O núcleo (e os mocks) rejeitam com objetos `{ code?: string; message?: string; usage?: ... }` ou `Error`. Cada componente trata erros de forma independente (alguns mapeiam `code` para textos localizados; outros exibem `e.message` bruto ou uma mensagem genérica fixa).
* **Mock (`VITE_CORE_MOCK=1`):** Quando `import.meta.env.VITE_CORE_MOCK === '1' && !isTauri()`, `coreDispatch` intercepta chamadas e delega para handlers locais em [src/lib/core.ts](../../../src/lib/core.ts), [src/lib/batchMock.ts](../../../src/lib/batchMock.ts), [src/lib/captionsMock.ts](../../../src/lib/captionsMock.ts), [src/lib/editorEditsMock.ts](../../../src/lib/editorEditsMock.ts), [src/lib/packagingMock.ts](../../../src/lib/packagingMock.ts), [src/lib/scriptMock.ts](../../../src/lib/scriptMock.ts), [src/lib/thumbnailMock.ts](../../../src/lib/thumbnailMock.ts), [src/lib/translationMock.ts](../../../src/lib/translationMock.ts) e [src/features/export/mock.ts](../../../src/features/export/mock.ts). Se um comando não existir no mock, lança `new Error('Unknown core command: ' + name)`.

### Escuta de `core-progress`

Não há barramento central de eventos no front. Cada componente interessado chama `listen('core-progress', ...)` diretamente de `@tauri-apps/api/event` (16 ocorrências distintas em `src/features/**`):

* Em `components/*`: `Components.tsx`, `DenoCard.tsx`, `PocketTtsCard.tsx`, `TtsCatalogCard.tsx`, `WorkerCard.tsx`, `ModelsCard.tsx`, `HardwareCard.tsx`.
* Em `projects/*`: `Sources.tsx`, `SourceBatches.tsx`, `Transcription.tsx`, `LocalEstimate.tsx`, `Selection.tsx` (2 listeners: `energy` e `selection`), `CutPreview.tsx`, `Narration.tsx`, `Jobs.tsx`.
* Em `export/*`: `ExportButton.tsx`, `BatchExport.tsx`.
* Em `editor/*`: `Editor.tsx` (escuta `stage === 'editor_save_failed'`).

Na maioria dos fluxos assíncronos (`Jobs`, `SourceBatches`, `Transcription`, `Selection`, `CutPreview`, `Narration`, `ExportButton`, `BatchExport`), os componentes combinam `listen('core-progress', ...)` com `setInterval` (de 500 ms a 5000 ms) para refazer o fetch completo de status no núcleo.

### Reprodução de mídia (`src/lib/media.ts`)

* [src/lib/media.ts](../../../src/lib/media.ts) (25 linhas):
  * `initMediaTransport()` consulta `invoke<string | null>('media_base_url')` uma vez no startup. No Linux (WebKitGTK), o backend retorna uma URL HTTP em loopback (ex.: `http://127.0.0.1:<porta>`). No Windows e macOS retorna `null`.
  * `mediaUrl(resource)` constrói a URL para recursos opacos do núcleo (`proxy/<key>`, `thumbs/<key>`, `narration/<id>`, `narration-original/<id>`, `narration-clean/<id>`, e mídia de áudio importado):
    * Browser/mock (`!isTauri()`): `/__clipes-media__/${clean}`
    * Linux (`loopbackBaseUrl` definido): `${loopbackBaseUrl}/${clean}`
    * Windows/macOS: `convertFileSrc(clean, 'clipes-media')` (protocolo customizado `clipes-media://`).

### Estilos e design system "Foco" (`src/styles/` e `design-system/`)

* [src/styles/tokens.css](../../../src/styles/tokens.css) (217 linhas) e [src/styles/index.css](../../../src/styles/index.css) (210 linhas) implementam os tokens semânticos OKLCH do padrão **Foco** (temas `dark` padrão e `light`), fontes `Inter Variable` e `Geist Mono Variable`, Tailwind v4 (`@theme inline` com cores/raios/sombras padrão zerados) e utilitários como `foco`, `tabular`, `timecode`, `hachura` e `sem-barra`.
* A pasta `design-system/` ([design-system/DESIGN.md](../../../design-system/DESIGN.md), [design-system/PRODUCT.md](../../../design-system/PRODUCT.md)) contém um projeto Vite separado (protótipo/galeria do Foco com telas `#/fontes`, `#/cortes`, `#/corte/:id/...`, `#/legenda`, `#/exportar`, `#/config/:secao`), que **não está integrado** à UI principal em `src/`. Na UI real (`src/`), o padrão Foco chegou apenas nos tokens CSS, em `Gaveta`/`Paleta`, nos 4 botões/diálogos de `src/components/ui/` e no overlay `Editor.tsx`.

### Componentes compartilhados (`src/components/`)

A pasta `src/components/` contém apenas 6 arquivos:

| Pasta | Arquivo | Linhas | Papel |
|---|---|---:|---|
| `src/components/ui` | [Button.tsx](../../../src/components/ui/Button.tsx) | 92 | `Button` (`primario`, `secundario`, `fantasma`, `perigo`; tamanhos `sm`/`md`/`lg`; `icone`, `atalho` em `<Kbd>`, `carregando`) e `IconButton` |
| `src/components/ui` | [ConfirmDialog.tsx](../../../src/components/ui/ConfirmDialog.tsx) | 32 | Diálogo modal de confirmação sobre `@base-ui/react/alert-dialog` |
| `src/components/ui` | [Kbd.tsx](../../../src/components/ui/Kbd.tsx) | 32 | Exibição de atalhos de teclado a partir de string (`Ctrl+Z`) ou array |
| `src/components/ui` | [Spinner.tsx](../../../src/components/ui/Spinner.tsx) | 16 | Ícone `LoaderCircle` giratório para botões em carregamento |
| `src/components/shell` | [Gaveta.tsx](../../../src/components/shell/Gaveta.tsx) | 167 | Sistema de gavetas de borda (`useGaveta`, `GavetaBorda`, `ZonaBorda`, `Puxador`, `CabecalhoGaveta`) |
| `src/components/shell` | [Paleta.tsx](../../../src/components/shell/Paleta.tsx) | 149 | Paleta de comandos `Ctrl+K` sobre `cmdk` + `@base-ui/react/dialog` e `<GatilhoPaleta />` |

Não existem primitivas compartilhadas em `src/components/ui/` para `Input`, `Textarea`, `Select`, `Checkbox`, `Switch`, `Tabs`, `Status`, `Skeleton`, `Progress` ou `Toast`; cada feature escreve `<input>`, `<select>`, `<textarea>` e `<progress>` nativos diretamente com classes inline repetidas.

---

## Páginas

O app possui **5 páginas de nível superior** alternadas no `Shell` (`src/main.tsx:24,52`), além de **3 overlays globais** montados fora da área de páginas (`EditorHost`, `Assistant`, `UpdateNotice`).

### 1. Início / Projetos (`page === 'home'`)

* **Arquivos principais:** [src/features/projects/Projects.tsx](../../../src/features/projects/Projects.tsx) (51 linhas — escrito com múltiplas instruções por linha) e toda a árvore montada condicionalmente quando há um Projeto aberto (`current !== null`):
  * [ChannelProfile.tsx](../../../src/features/projects/ChannelProfile.tsx) (530)
  * [Sources.tsx](../../../src/features/projects/Sources.tsx) (62, formato compacto) → por cada Fonte: [Transcription.tsx](../../../src/features/projects/Transcription.tsx) (77) → [EngineChoice.tsx](../../../src/features/projects/EngineChoice.tsx) (119), [LocalEstimate.tsx](../../../src/features/projects/LocalEstimate.tsx) (72), [Selection.tsx](../../../src/features/projects/Selection.tsx) (266) → [CandidateReview.tsx](../../../src/features/projects/CandidateReview.tsx) (230) → ([Script.tsx](../../../src/features/projects/Script.tsx) (161), [Angles.tsx](../../../src/features/projects/Angles.tsx) (116), [Narration.tsx](../../../src/features/projects/Narration.tsx) (812), [TeleprompterRecorder.tsx](../../../src/features/projects/TeleprompterRecorder.tsx) (645), [RedoWithProfile.tsx](../../../src/features/projects/RedoWithProfile.tsx) (131), [Packaging.tsx](../../../src/features/projects/Packaging.tsx) (249), [Thumbnail.tsx](../../../src/features/projects/Thumbnail.tsx) (153), [ExportButton.tsx](../../../src/features/export/ExportButton.tsx) (243)), [BatchExport.tsx](../../../src/features/export/BatchExport.tsx) (365), [CutPreview.tsx](../../../src/features/projects/CutPreview.tsx) (683), [TranscriptTimeline.tsx](../../../src/features/projects/TranscriptTimeline.tsx) (202)
  * [SourceBatches.tsx](../../../src/features/projects/SourceBatches.tsx) (197)
  * [BatchExport.tsx](../../../src/features/export/BatchExport.tsx) (365, escopo `project`)
  * [TranscriptSearch.tsx](../../../src/features/projects/TranscriptSearch.tsx) (52)
  * [Jobs.tsx](../../../src/features/projects/Jobs.tsx) (72)
  * [ProjectPrivacy.tsx](../../../src/features/projects/ProjectPrivacy.tsx) (45)
  * [Backups.tsx](../../../src/features/projects/Backups.tsx) (27)
  * **Total da árvore (somando `src/features/projects/`, `export/` e `guardrails/` usados aqui):** ~6.400+ linhas.
* **O que mostra de cima a baixo:**
  1. Cabeçalho `Projetos` + formulário para criar Projeto (input nome + diálogo nativo de pasta) ou abrir pasta existente.
  2. Nome do Projeto aberto (`Projeto aberto: ...`).
  3. **Perfil de canal** (`ChannelProfile`): tipo de vídeo padrão, idioma, duração mín/máx, estilo de legenda padrão (preset/fonte/tamanhos/cores), Fontes permitidas, voz padrão de Narração, orientação de ritmo, status do aviso de monetização de Corte direto e botão salvar.
  4. **Fontes** (`Sources`): botão `Escolher vídeo`, aviso proativo de FFmpeg/Motor ausente, download por URL (com escolha de pasta e termos), formulário de importação após inspeção (faixa de áudio, idioma, Permissão, cópia) e lista das Fontes importadas. Dentro de **cada** item da lista de Fontes é renderizado `<Transcription>`:
     * Status/progresso ou escolha do Motor de transcrição (`EngineChoice` + `LocalEstimate`).
     * Quando transcrita: **Seleção de Cortes** (`Selection` com `VideoKindPicker`, chat da live, energia do áudio, progresso por Janela, filtro por Nota mínima) → **Revisão dos candidatos** (`CandidateReview`: lista de candidatos à esquerda e detalhe à direita com eixos da Nota, ajuste de bordas por Frase, Aprovar/Rejeitar, `ExportButton`, abrir preview e abrir editor). Quando o candidato está aprovado, aparecem abaixo no mesmo painel de detalhe: `Script` (com `Angles`), `Narration` (com `TeleprompterRecorder`), `RedoWithProfile`, `Packaging` (com `AiDisclosureNote`) e `Thumbnail`.
     * Abaixo de `CandidateReview`, na mesma Fonte: `BatchExport` (`scope="source"`), `CutPreviewPanel` (se aberto) e `TranscriptTimeline` (timeline virtualizada de Frases com edição F2).
  5. **Lote de Fontes** (`SourceBatches`): seleção de múltiplas Fontes, escolha de tipo/motor/teto de custo, criação e acompanhamento de lotes.
  6. **Export em lote** (`BatchExport`, `scope="project"`): `GuardrailsChecklist` recolhível e exportação em massa dos Cortes aprovados.
  7. **Buscar nas Transcrições** (`TranscriptSearch`): campo de busca FTS5 com resultados clicáveis que rolam até a `TranscriptTimeline`.
  8. **Tarefas** (`Jobs`): fila de jobs do Projeto (`cancel`, `retry`, `discard`).
  9. **Privacidade do Projeto** (`ProjectPrivacy`): interruptor `Somente local`.
  10. **Backups** (`Backups`): intervalo, quantidade mantida, `Criar backup agora` e lista com `Restaurar`.
  11. **Recentes** (no rodapé da página!): lista de Projetos recentes com botão `Abrir pasta` ou rótulo `Indisponível`.
* **Comandos do núcleo chamados (raiz + subárvore):** `projects.recent`, `projects.current`, `projects.create`, `projects.open`; e nos filhos: `channel_profile.*`, `tts.catalog`, `sources.*`, `components.ffmpeg.status`, `components.manifest`, `components.download`, `transcription.*`, `selection.*`, `chat.*`, `energy.status`, `angles.*`, `script.*`, `narration.*`, `packaging.*`, `thumbnail.*`, `proxy.*`, `provider.profiles.list`, `batches.*`, `jobs.*`, `backups.*`, `guardrails.*`, `export.batch.*`, `export.start`, `export.status`, `export.settings`.
* **Eventos escutados:**
  * `core-progress` em `Sources`, `Transcription`, `LocalEstimate`, `Selection`, `CutPreview`, `Narration`, `Jobs`, `SourceBatches`, `ExportButton`, `BatchExport`.
  * `window`: `clipes:channel-profile-updated`, `clipes:source-permission-updated`, `clipes:guardrails-updated`, `clipes-transcript-corrected`, `clipes-transcript-goto`, `clipes-preview-open`, `clipes-preview-seek`, `clipes-preview-time`, `focus`, `visibilitychange`.
* **Estados tratados:**
  * **Vazio:** Lista de recentes vazia (`empty`), sem Fontes (`empty`), sem lotes (`none`), sem busca/resultados (`none`), sem tarefas (`empty`), sem backups (`empty`), sem candidatos (`none` / `noneFilter`).
  * **Carregando:** `ChannelProfile` mostra texto `Carregando perfil do canal…`; `TranscriptTimeline` mostra `Carregando transcrição…`; `Selection` mostra `Calculando janelas de seleção…`; `CutPreview` mostra `Preparando o preview do Corte`.
  * **Erro:** Mensagens `role="alert"` por seção (em `Projects`, `Sources`, `ChannelProfile`, `Selection`, `CandidateReview`, `Script`, `Narration`, `Packaging`, `Thumbnail`, `Jobs`, `Backups`, `TranscriptSearch`).
  * **Job rodando:** Barras `<progress>` e botões de cancelar em `Sources`, `Transcription`, `LocalEstimate`, `Selection`, `CutPreview`, `Narration`, `Jobs`, `SourceBatches`, `ExportButton`, `BatchExport`; botões desabilitados via `busy`.
* **Estados NÃO tratados:**
  * `Projects.tsx` não tem estado de carregamento inicial (`loading`) nem opção de fechar o Projeto aberto (`projects.close` nunca é chamado).
  * `Sources`, `Jobs`, `SourceBatches`, `Backups`, `BatchExport` não distinguem carregamento inicial de lista vazia (exibem `"Nenhuma Fonte importada."` / `"Nenhuma tarefa..."` antes da resposta inicial chegar).
  * `Angles`, `Script`, `Narration`, `Packaging`, `Thumbnail` retornam `null` enquanto `doc === null`, sem skeleton nem indicador de carregamento.
  * `Transcription` não exibe spinner/carregando inicial antes de `transcription.status` responder.

### 2. Componentes (`page === 'components'`)

* **Arquivos principais:** [src/features/components/Components.tsx](../../../src/features/components/Components.tsx) (64 linhas) + 7 subcards: [DenoCard.tsx](../../../src/features/components/DenoCard.tsx) (51), [PocketTtsCard.tsx](../../../src/features/components/PocketTtsCard.tsx) (146), [CatalogCard.tsx](../../../src/features/components/CatalogCard.tsx) (128), [TtsCatalogCard.tsx](../../../src/features/components/TtsCatalogCard.tsx) (309), [WorkerCard.tsx](../../../src/features/components/WorkerCard.tsx) (67), [ModelsCard.tsx](../../../src/features/components/ModelsCard.tsx) (76), [HardwareCard.tsx](../../../src/features/components/HardwareCard.tsx) (104), mais 5 arquivos `*Texts.ts` (20 linhas ao todo). Total: ~965 linhas.
* **O que mostra de cima a baixo:**
  1. Título `Componentes`, introdução e mensagem `status` global.
  2. Cards do manifesto principal (`ffmpeg`, `yt-dlp`, `uv`) com tamanho, licença, link de código-fonte e botão Baixar / Reinstalar / Atualizar.
  3. `DenoCard` (runtime JS para yt-dlp).
  4. `PocketTtsCard` (binário Rust para Narração TTS local).
  5. `CatalogCard` (catálogo assinado de modelos e verificação manual).
  6. `TtsCatalogCard` (catálogo de modelos e vozes TTS com licença e termo de uso proibido).
  7. `WorkerCard` (Worker Python, versões de libs e handshake CUDA/CPU).
  8. `ModelsCard` (modelos Whisper e YuNet).
  9. `HardwareCard` (GPU NVIDIA, RAM, escolha manual/automática de modelo/device/compute_type, agrupamento por VAD e botão de teste de hardware).
  10. Seção `FFmpeg do sistema` (input de caminho + `Validar`).
  11. Seção `Pastas e cache` (inputs de `data_dir`, `cache_dir`, `cache_limit_bytes` em GB + `Salvar`).
* **Comandos do núcleo:** `components.manifest`, `components.ffmpeg.status`, `components.ytdlp.status`, `components.settings.get`, `components.download`, `components.cancel`, `components.ytdlp.update`, `components.settings.set`, `components.ffmpeg.system`, `components.deno.status`, `components.pocket_tts.status`, `components.catalog.status`, `components.catalog.check`, `tts.catalog`, `tts.models.download`, `tts.models.choose`, `tts.models.cancel`, `components.worker.status`, `components.worker.install`, `components.models.manifest`, `components.models.download`, `transcription.hardware.status`, `transcription.grouping`, `transcription.hardware.probe`, `transcription.hardware.choose`.
* **Eventos escutados:** `core-progress` em `Components`, `DenoCard`, `PocketTtsCard`, `TtsCatalogCard`, `WorkerCard`, `ModelsCard` e `HardwareCard`.
* **Estados tratados:** Erro em `status`/`note`/`errorMsg` (`role="status"` / `role="alert"`), progresso de download/probe (`<progress>` + `Cancelar`), avisos de worker ausente/quebrado/desatualizado e fallback de GPU.
* **Estados NÃO tratados:** Nenhum dos cards nem `Components.tsx` exibe estado de carregamento inicial (`loading`/skeleton); `TtsCatalogCard` e `settings` somem (`null`) enquanto não carregam. Não há estado vazio explícito para `items`/`models` se o manifesto falhar ou vier vazio.

### 3. Preferências (`page === 'preferences'`)

* **Arquivos principais:** [src/features/preferences/Preferences.tsx](../../../src/features/preferences/Preferences.tsx) (15 linhas), [texts.ts](../../../src/features/preferences/texts.ts) (1), [GroqSettings.tsx](../../../src/features/preferences/GroqSettings.tsx) (34), [EncoderSettings.tsx](../../../src/features/preferences/EncoderSettings.tsx) (38), [AssistantSettings.tsx](../../../src/features/assistant/AssistantSettings.tsx) (48), [TaskTable.tsx](../../../src/features/assistant/TaskTable.tsx) (116), [ProviderSettings.tsx](../../../src/features/provider/ProviderSettings.tsx) (61), [CliSettings.tsx](../../../src/features/provider/CliSettings.tsx) (46), [ProviderProfiles.tsx](../../../src/features/provider/ProviderProfiles.tsx) (185), [Costs.tsx](../../../src/features/provider/Costs.tsx) (75), [SelectionState.tsx](../../../src/features/provider/SelectionState.tsx) (57), mais arquivos `*Texts.ts` (~150 linhas). Total: ~826 linhas.
* **O que mostra de cima a baixo:**
  1. `Preferências`: seletores de `Tema` (`Escuro`/`Claro` — omite `sistema`, embora `lib/tema.ts` suporte) e `Idioma` (`Português (Brasil)`/`English`).
  2. `GroqSettings`: campo de senha para chave Groq no cofre + salvar/testar/remover.
  3. `EncoderSettings`: seletor de encoder de exportação + status + botão `Detectar de novo`.
  4. `AssistantSettings` + `TaskTable`: Provedor padrão do app, tabela das 4 Tarefas de IA (`selection`, `packaging`, `script`, `translation`) com seletor de perfil, selo de localidade, custo, checkbox `Somente local`, estado `SelectionState` da tarefa de seleção, sugestões de perfil local e botão para reabrir o Assistente inicial.
  5. `ProviderSettings` + `CliSettings`: formulário do endpoint legado (`Principal`), chave no cofre, teste de conexão e subseção de assinatura via CLI (Codex CLI, Claude Code CLI, OpenCode CLI).
  6. `ProviderProfiles`: cards detalhados de todos os Perfis de Provedor (contexto, limites, preço, consentimento, `SelectionState`, chave própria, testar, atualizar contexto, medir contexto Ollama, editar, remover) + formulário de criação/edição com 13 campos.
  7. `ProviderCosts`: estimador manual de custo por amostra de texto, tabela de preços embutida + formulário de override manual e tabela de gastos registrados.
* **Comandos do núcleo:** `transcription.groq.key.*`, `export.encoder.*`, `assistant.status`, `assistant.default.set`, `assistant.tasks`, `assistant.task.set`, `assistant.local_only.set`, `provider.status`, `provider.configure`, `provider.key.*`, `provider.confirm`, `provider.test`, `provider.cli.*`, `provider.profiles.*`, `provider.context.get`, `provider.selection_state`, `provider.prices.*`, `provider.cost.estimate`, `provider.cost.list`.
* **Eventos escutados:** Nenhum evento `core-progress`. Dispara `clipes:assistant-open` no botão de reabrir assistente.
* **Estados tratados:** Vazio em registros de custo (`noRecords`), carregando em `SelectionState` (`loading`) e botão `EncoderSettings` (`carregando`), erros via mensagem `role="status"` / `role="alert"`.
* **Estados NÃO tratados:** Sem estado de carregamento inicial nas 6 subseções (`GroqSettings`, `EncoderSettings`, `AssistantSettings`, `ProviderSettings`, `ProviderProfiles`, `ProviderCosts`); se `provider.profiles.list` estiver vazio em `ProviderProfiles`, nada explica o estado vazio além do botão `Adicionar perfil`; `ProviderCosts` silencia erro de `provider.cost.list` (`catch { setRows([]); }`).

### 4. Sobre (`page === 'about'`)

* **Arquivos principais:** [src/features/about/About.tsx](../../../src/features/about/About.tsx) (13 linhas), [texts.ts](../../../src/features/about/texts.ts) (1 linha).
* **O que mostra de cima a baixo:** Título `Sobre`, versão obtida do núcleo, texto integral de `LICENSE` (Apache-2.0) em `<pre>` e texto integral de `THIRD_PARTY_NOTICES.md` em `<pre>`.
* **Comandos do núcleo:** `app.version`.
* **Eventos escutados:** Nenhum.
* **Estados tratados:** Carregando (`Carregando versão…`) e erro (`Não foi possível carregar a versão.`).
* **Estados NÃO tratados:** Não aplicável a vazio/job.

### 5. Relatos (`page === 'report'`)

* **Arquivos principais:** [src/features/report/Report.tsx](../../../src/features/report/Report.tsx) (64 linhas), [texts.ts](../../../src/features/report/texts.ts) (4 linhas).
* **O que mostra de cima a baixo:** Título `Relatos e diagnóstico`, seletor de tipo (`Relatar problema` / `Sugerir ideia` / `Propor Provedor ou modelo`), título, relato, alerta se detectar `token`/`chave`/`key`, checkbox `Incluir diagnóstico`, botão `Revisar relato` que abre pré-visualização editável do diagnóstico e ações (`Copiar texto`, `Exportar diagnóstico`, `Abrir no GitHub`, `Voltar`).
* **Comandos do núcleo:** `diagnostic.get`, `diagnostic.export`.
* **Eventos escutados:** Nenhum.
* **Estados tratados:** Erro ao carregar diagnóstico ou ao copiar/abrir URL; validação de limite de 8.000 bytes na URL com fallback para copiar diagnóstico.
* **Estados NÃO tratados:** Não há estado de carregamento inicial do diagnóstico (o campo fica vazio até `diagnostic.get` resolver) nem indicador de `busy` durante `diagnostic.export`.

### Overlays globais (fora das 5 páginas)

* **Editor do Corte (`EditorHost` / `Editor`):** [src/features/editor/Editor.tsx](../../../src/features/editor/Editor.tsx) (775 linhas) + painéis (`CropPanel.tsx`, `AudioPanel.tsx`, `SilencesPanel.tsx`, `CaptionPanel.tsx`, `TranslationPanel.tsx`, `BorderHandles.tsx`, `NarrationTrack.tsx`, `AudioTrack.tsx`, `GuardrailsChecklist`, `CutPreview`, `ExportButton`). Abre em `fixed inset-0` sobre toda a UI via evento `clipes-editor-open`. Usa `<GavetaBorda>` esquerda (Transcrição) e direita com 6 visões comutadas (`borders`, `captions`, `silences`, `crop`, `translation`, `audio`).
* **Assistente de Provedor (`Assistant`):** [src/features/assistant/Assistant.tsx](../../../src/features/assistant/Assistant.tsx) (135 linhas). Modal disparado no primeiro uso (`needsSetup`) ou por `clipes:assistant-open`.
* **Atualizador (`UpdateNotice`):** [src/features/updates/UpdateNotice.tsx](../../../src/features/updates/UpdateNotice.tsx) (146 linhas). Verifica atualização automática no startup via `@tauri-apps/plugin-updater`, abre modal quando há versão nova e toast `role="status"` em erro.

---

## Componentes por pasta (`src/features/**`)

| Pasta / Arquivo | O que é | Onde aparece | Comandos que chama |
|---|---|---|---|
| `about/About.tsx` | Página Sobre com versão e licenças | Página `about` | `app.version` |
| `about/texts.ts` | Textos PT-BR/EN de Sobre | `About.tsx` | — |
| `assistant/Assistant.tsx` | Modal do assistente de configuração inicial de Provedor | Global (`main.tsx`) | `assistant.status`, `assistant.detect`, `assistant.complete`, `assistant.default.set`, `provider.configure`, `provider.cli.configure`, `provider.cli.confirm` |
| `assistant/AssistantSettings.tsx` | Seção de Provedor padrão nas Preferências | `Preferences.tsx` | `assistant.status`, `assistant.default.set`, `provider.cli.status`, `provider.profiles.list` |
| `assistant/TaskTable.tsx` | Tabela de Provedor, custo, localidade e "somente local" por Tarefa de IA | `AssistantSettings.tsx` | `assistant.tasks`, `assistant.task.set`, `assistant.local_only.set`, `provider.profiles.list` |
| `assistant/texts.ts` | Textos PT-BR/EN do Assistente e tabela de tarefas | `assistant/*` | — |
| `captions/CaptionOverlay.tsx` | Renderizador overlay 1080×1920 escalado no preview | `CutPreview.tsx` | — |
| `captions/CaptionPanel.tsx` | Painel de estilo, faixa e override por palavra de legenda | `Editor.tsx` (gaveta direita) | `captions.remap_status`, `captions.track.set`, `captions.style.preset`, `captions.style.set`, `captions.style.default`, `captions.override`, `transcription.correct` |
| `captions/render.ts` | Carregamento de fontes TTF e rasterização DOM estilo libass | `CaptionOverlay.tsx` | — |
| `captions/types.ts` | Tipos TS de legenda (`CaptionData`, `CaptionStyle`, etc.) | `captions/*`, `ChannelProfile`, `CutPreview` | — |
| `captions/useCaptions.ts` | Hook para buscar legendas e reagir a correções de palavras | `Editor.tsx` | `export.captions` |
| `components/CatalogCard.tsx` | Card do catálogo assinado de modelos e verificação manual | `Components.tsx` | `components.catalog.status`, `components.catalog.check` |
| `components/Components.tsx` | Página Componentes (manifesto base, FFmpeg sistema, pastas/cache) | Página `components` | `components.manifest`, `components.ffmpeg.status`, `components.ffmpeg.system`, `components.ytdlp.status`, `components.ytdlp.update`, `components.settings.get`, `components.settings.set`, `components.download`, `components.cancel` |
| `components/DenoCard.tsx` | Card do componente Deno (para yt-dlp) | `Components.tsx` | `components.deno.status`, `components.download`, `components.cancel` |
| `components/HardwareCard.tsx` | Card de detecção de GPU/CPU, escolha manual, VAD grouping e probe | `Components.tsx` | `transcription.hardware.status`, `transcription.hardware.choose`, `transcription.hardware.probe`, `transcription.grouping`, `components.cancel` |
| `components/ModelsCard.tsx` | Card de download/atualização de modelos Whisper e YuNet | `Components.tsx` | `components.models.manifest`, `components.models.download`, `components.cancel` |
| `components/PocketTtsCard.tsx` | Card do binário Pocket TTS | `Components.tsx` | `components.pocket_tts.status`, `components.download`, `components.cancel` |
| `components/TtsCatalogCard.tsx` | Card do catálogo de modelos/vozes TTS e termos de uso proibido | `Components.tsx` | `tts.catalog`, `tts.models.download`, `tts.models.choose`, `tts.models.cancel` |
| `components/WorkerCard.tsx` | Card de status/instalação do Worker Python | `Components.tsx` | `components.worker.status`, `components.worker.install`, `components.cancel` |
| `components/*Texts.ts` (5 arquivos) | Textos PT-BR/EN dos cards de Componentes (`denoTexts`, `hardwareTexts`, `modelTexts`, `texts`, `workerTexts`) | `components/*` | — |
| `editor/AudioPanel.tsx` | Painel de trilha sonora, efeitos sonoros e biblioteca de áudios | `Editor.tsx` (gaveta direita) | `audio.list`, `audio.import`, `audio.license.set`, `audio.delete` |
| `editor/AudioTrack.tsx` | Faixa visual de trilha, ducking por fala e SFX arrastáveis na timeline | `Editor.tsx` | — (callbacks `onMoveSfx` → `editor.audio.sfx.update`) |
| `editor/BorderHandles.tsx` | Alças arrastáveis e por teclado de Entrada/Saída na timeline | `Editor.tsx` | — (callbacks `adjust` → `editor.adjust`) |
| `editor/cropMath.ts` | Matemática e interpolação de crop 9:16 e layouts duplos | `Editor`, `CropPanel`, `CutPreview` | — |
| `editor/CropPanel.tsx` | Painel de enquadramento (layout, split ratio, keyframes, reframe YuNet) | `Editor.tsx` (gaveta direita) | `reframe.status`, `reframe.start`, `editor.crop.set_suggested`, `jobs.cancel` |
| `editor/duckingMath.ts` | Cálculo puro de ducking (-12 dB), fade e reprodução de trilha | `CutPreview.tsx` | — |
| `editor/Editor.tsx` | `EditorHost` e `Editor` (overlay completo com preview, timeline e gavetas) | Global (`main.tsx`) via `openEditor` | `editor.open`, `editor.sentences`, `editor.timeline`, `editor.timeline_status`, `editor.wave`, `editor.adjust`, `editor.undo`, `editor.redo`, `editor.flush`, `editor.crop.set_layout`, `editor.crop.set_edits`, `editor.silences.*`, `editor.montage.set_start`, `editor.audio.*`, `jobs.cancel` |
| `editor/NarrationTrack.tsx` | Faixa de blocos de Narração arrastáveis e cauda congelada na timeline | `Editor.tsx` | — (callbacks → `editor.montage.set_start`) |
| `editor/SilencesPanel.tsx` | Painel de detecção, reversão e reaplicação de silêncios | `Editor.tsx` (gaveta direita) | — (callbacks → `editor.silences.*`) |
| `editor/timelineMath.ts` | Conversão µs↔px, janelas visíveis, splice map, velocidades J/K/L | `Editor`, `CutPreview`, `AudioTrack`, `NarrationTrack`, `CaptionOverlay` | — |
| `export/BatchExport.tsx` | Exportação em lote (por Fonte ou Projeto) e resolução de conflitos | `Selection.tsx`, `Projects.tsx` | `export.batch.list`, `export.batch.start`, `export.batch.cancel`, `export.settings` |
| `export/ExportButton.tsx` | Botão de exportação única, progresso, fallback e correção de glifos | `CandidateReview.tsx`, `Editor.tsx` | `export.settings`, `export.start`, `export.status`, `jobs.cancel`, `transcription.correct` |
| `export/mock.ts` | Simulador mock de comandos `export.*` em browser | `src/lib/core.ts` | — |
| `guardrails/GuardrailsPanel.tsx` | Checklist pré-export, aviso único de Corte direto e nota de divulgação IA | `ExportButton`, `BatchExport`, `Editor`, `ChannelProfile`, `Packaging` | `guardrails.check`, `guardrails.ack_direct_notice` |
| `preferences/EncoderSettings.tsx` | Seletor e detector de encoder H.264 de exportação | `Preferences.tsx` | `export.encoder.status`, `export.encoder.set`, `export.encoder.detect` |
| `preferences/GroqSettings.tsx` | Gerenciamento da chave de API Groq no cofre | `Preferences.tsx` | `transcription.groq.key.status`, `transcription.groq.key.set`, `transcription.groq.key.test`, `transcription.groq.key.remove` |
| `preferences/Preferences.tsx` | Página Preferências (tema, idioma + subseções) | Página `preferences` | — |
| `preferences/texts.ts` | Textos PT-BR/EN de Preferências | `Preferences.tsx` | — |
| `projects/Angles.tsx` | Sugestão e escolha de ângulo do Vídeo transformado | `Script.tsx` | `angles.get`, `angles.estimate`, `angles.generate`, `angles.choose` |
| `projects/Backups.tsx` | Configuração, criação manual e restauração de backups do Projeto | `Projects.tsx` | `backups.list`, `backups.settings.get`, `backups.settings.set`, `backups.create`, `backups.restore` |
| `projects/CandidateReview.tsx` | Lista ordenada de candidatos, detalhes de Nota, bordas e decisões | `Selection.tsx` | `selection.review`, `selection.decide`, `selection.adjust`, `selection.undo` |
| `projects/ChannelProfile.tsx` | Editor do Perfil de canal (tipo, idioma, duração, legenda, fontes, voz) | `Projects.tsx` | `channel_profile.get`, `channel_profile.languages`, `channel_profile.set`, `tts.catalog` |
| `projects/CutPreview.tsx` | Player 9:16 com crop, legendas, ducking, trilha/SFX e `CutPreviewPanel` | `Transcription.tsx`, `Editor.tsx` | `proxy.request`, `proxy.status`, `jobs.cancel` |
| `projects/EngineChoice.tsx` | Escolha entre Motor local/Groq, idioma da Fonte e início da transcrição | `Transcription.tsx` | `components.ffmpeg.status`, `transcription.hardware.status`, `transcription.grouping`, `transcription.groq.info`, `transcription.groq.estimate`, `transcription.groq.confirm`, `transcription.start`, `sources.language.set` |
| `projects/Jobs.tsx` | Lista de jobs do Projeto com cancelar, repetir (com estimativa) e descartar | `Projects.tsx` | `jobs.list`, `jobs.cancel`, `jobs.estimate`, `jobs.retry`, `jobs.discard` |
| `projects/LocalEstimate.tsx` | Estimativa de tempo da transcrição local em amostra + avisos de RAM/CPU | `EngineChoice.tsx` | `transcription.hardware.status`, `transcription.estimate`, `components.cancel` |
| `projects/Narration.tsx` | Síntese TTS, importação, gravação, limpeza de voz e alinhamento por bloco | `CandidateReview.tsx` | `narration.get`, `narration.generate`, `narration.regenerate_block`, `narration.import`, `narration.align`, `narration.align_block`, `narration.review`, `narration.trim_block`, `narration.cleanup.prepare`, `narration.cleanup.set`, `tts.catalog`, `jobs.cancel` |
| `projects/Packaging.tsx` | Geração e edição de título, descrição, crédito, tags, hashtags e capítulos | `CandidateReview.tsx` | `packaging.get`, `packaging.estimate`, `packaging.generate`, `packaging.edit`, `packaging.refresh_chapters` |
| `projects/ProjectPrivacy.tsx` | Interruptor do veto `Somente local` do Projeto | `Projects.tsx` | `projects.local_only.get`, `projects.local_only.set` |
| `projects/Projects.tsx` | Página raiz de Projetos (criar/abrir/recentes + container de tudo do Projeto) | Página `home` | `projects.recent`, `projects.current`, `projects.create`, `projects.open` |
| `projects/RedoWithProfile.tsx` | "Refazer com outro perfil" por candidato com checagem de custo/localidade | `CandidateReview.tsx` | `provider.profiles.list`, `selection.estimate`, `selection.redo` |
| `projects/Script.tsx` | Roteiro da Narração bloco a bloco (gerar, editar, aprovar, regenerar) | `CandidateReview.tsx` | `script.get`, `script.estimate`, `script.generate`, `script.regenerate`, `script.edit`, `script.approve` |
| `projects/Selection.tsx` | Seleção de Cortes por Fonte (tipo, energia, chat, execução, janelas) | `Transcription.tsx` | `channel_profile.get`, `chat.status`, `chat.fetch`, `energy.status`, `selection.estimate`, `selection.list`, `selection.get`, `selection.start`, `selection.resume`, `selection.redo`, `selection.cancel` |
| `projects/selectionFormat.ts` | Helpers `fill`, `clock`, `message` compartilhados em projetos | `projects/*`, `editor/*` | — |
| `projects/SourceBatches.tsx` | Criação e gestão de Lotes de Fontes com teto de custo | `Projects.tsx` | `sources.list`, `channel_profile.get`, `batches.list`, `batches.create`, `batches.pause`, `batches.resume`, `batches.cancel`, `batches.item.resume`, `jobs.budget.set`, `jobs.budget.continue` |
| `projects/SourceLanguage.tsx` | Seletor de idioma da Fonte (`CODES` + `Intl.DisplayNames`) | `Sources.tsx`, `EngineChoice.tsx` | — |
| `projects/Sources.tsx` | Importação local/URL, verificação de hash, relocalização, Permissão e lista | `Projects.tsx` | `sources.list`, `sources.url.settings.get`, `sources.url.settings.set`, `sources.url.download`, `sources.url.cancel`, `sources.inspect`, `sources.import`, `sources.hash`, `sources.relocate`, `sources.cancel`, `sources.permission.set`, `channel_profile.get`, `components.ffmpeg.status`, `components.manifest`, `components.download`, `transcription.hardware.status` |
| `projects/TeleprompterRecorder.tsx` | Gravador de microfone com teleprompter, trim e rascunho sem fala | `Narration.tsx` | `narration.record_block`, `narration.discard_draft` |
| `projects/Thumbnail.tsx` | Sugestão de momento de capa, escolha pelo preview e exportação PNG | `CandidateReview.tsx` | `thumbnail.get`, `thumbnail.estimate`, `thumbnail.suggest`, `thumbnail.choose`, `thumbnail.export` |
| `projects/Transcription.tsx` | Status, progresso, controle e painel pós-transcrição por Fonte | `Sources.tsx` | `transcription.status`, `transcription.hardware.status`, `jobs.cancel` |
| `projects/TranscriptSearch.tsx` | Busca FTS5 em todas as Transcrições do Projeto | `Projects.tsx` | `transcription.search` |
| `projects/TranscriptTimeline.tsx` | Timeline virtualizada de Frases/palavras com edição inline F2 e undo/redo | `Transcription.tsx` | `transcription.segment`, `transcription.timeline`, `transcription.corrections`, `transcription.correct`, `transcription.undo`, `transcription.redo` |
| `projects/videoKind.tsx` | Picker, selo e linha de pesos para Corte direto vs Vídeo transformado | `ChannelProfile`, `Selection`, `SourceBatches`, `CandidateReview` | — |
| `provider/CliSettings.tsx` | Configuração e confirmação de CLIs (Codex, Claude Code, OpenCode) | `ProviderSettings.tsx` | `provider.cli.status`, `provider.cli.configure`, `provider.cli.confirm`, `provider.test` |
| `provider/Costs.tsx` | Estimador manual de tokens/USD, tabela de preços e histórico de gastos | `Preferences.tsx` | `provider.prices.get`, `provider.prices.set`, `provider.prices.clear`, `provider.cost.list`, `provider.cost.estimate` |
| `provider/ProviderProfiles.tsx` | CRUD de Perfis de Provedor, medição de contexto e chaves no cofre | `Preferences.tsx` | `provider.profiles.list`, `provider.profiles.remove`, `provider.configure`, `provider.key.set`, `provider.key.remove`, `provider.confirm`, `provider.test`, `provider.context.get` |
| `provider/ProviderSettings.tsx` | Configuração legada (`Principal`) de Provedor + chave + `CliSettings` | `Preferences.tsx` | `provider.status`, `provider.configure`, `provider.key.set`, `provider.key.remove`, `provider.confirm`, `provider.test` |
| `provider/SelectionState.tsx` | Estimativa informativa de compatibilidade do contexto com a seleção | `ProviderProfiles`, `TaskTable` | `provider.selection_state` |
| `provider/*Texts.ts` (4 arquivos) | Textos PT-BR/EN de provedores (`costTexts`, `profileTexts`, `selectionTexts`, `texts`) | `provider/*` | — |
| `report/Report.tsx` | Página Relatos (formulário de bug/ideia/provedor + diagnóstico) | Página `report` | `diagnostic.get`, `diagnostic.export` |
| `report/texts.ts` | Textos PT-BR/EN de Relatos | `Report.tsx` | — |
| `shell/texts.ts` | Textos PT-BR/EN do shell e paleta | `main.tsx`, `Paleta.tsx` | — |
| `translation/TranslationPanel.tsx` | Tradução de legenda por Corte, seleção de faixa e edição por Frase | `Editor.tsx` (gaveta direita) | `translation.get`, `translation.estimate`, `translation.start`, `translation.track.set`, `translation.edit` |
| `updates/texts.ts` | Textos PT-BR/EN do atualizador | `UpdateNotice.tsx` | — |
| `updates/updateError.ts` | Classificação de erros de rede vs assinatura no updater | `UpdateNotice.tsx` | — |
| `updates/UpdateNotice.tsx` | Verificação e diálogo/toast de atualização do app | Global (`main.tsx`) | — (usa `@tauri-apps/plugin-updater`) |

---

## Matriz comando × tela

Total extraído de `core/src` (`CommandRegistration`): **237 comandos únicos**.

| Comando | Arquivo(s) de tela que chama(m) | Cobertura no mock |
|---|---|---|
| `angles.choose` | `src/features/projects/Angles.tsx` | `src/lib/scriptMock.ts` |
| `angles.estimate` | `src/features/projects/Angles.tsx` | `src/lib/scriptMock.ts` |
| `angles.generate` | `src/features/projects/Angles.tsx` | `src/lib/scriptMock.ts` |
| `angles.get` | `src/features/projects/Angles.tsx` | `src/lib/scriptMock.ts` |
| `app.version` | `src/features/about/About.tsx` | `src/lib/core.ts` |
| `assistant.complete` | `src/features/assistant/Assistant.tsx` | `src/lib/core.ts` |
| `assistant.default.set` | `src/features/assistant/Assistant.tsx`, `src/features/assistant/AssistantSettings.tsx` | `src/lib/core.ts` |
| `assistant.detect` | `src/features/assistant/Assistant.tsx` | `src/lib/core.ts` |
| `assistant.local_only.set` | `src/features/assistant/TaskTable.tsx` | `src/lib/core.ts` |
| `assistant.status` | `src/features/assistant/Assistant.tsx`, `src/features/assistant/AssistantSettings.tsx` | `src/lib/core.ts` |
| `assistant.task.set` | `src/features/assistant/TaskTable.tsx` | `src/lib/core.ts` |
| `assistant.tasks` | `src/features/assistant/TaskTable.tsx` | `src/lib/core.ts` |
| `audio.delete` | `src/features/editor/AudioPanel.tsx` | `src/lib/editorEditsMock.ts` |
| `audio.import` | `src/features/editor/AudioPanel.tsx` | `src/lib/editorEditsMock.ts` |
| `audio.license.set` | `src/features/editor/AudioPanel.tsx` | `src/lib/editorEditsMock.ts` |
| `audio.list` | `src/features/editor/AudioPanel.tsx` | `src/lib/editorEditsMock.ts` |
| `backups.create` | `src/features/projects/Backups.tsx` | — |
| `backups.list` | `src/features/projects/Backups.tsx` | `src/lib/core.ts` |
| `backups.restore` | `src/features/projects/Backups.tsx` | — |
| `backups.settings.get` | `src/features/projects/Backups.tsx` | `src/lib/core.ts` |
| `backups.settings.set` | `src/features/projects/Backups.tsx` | — |
| `batches.cancel` | `src/features/projects/SourceBatches.tsx` | `src/lib/batchMock.ts` |
| `batches.create` | `src/features/projects/SourceBatches.tsx` | `src/lib/batchMock.ts` |
| `batches.get` | — | `src/lib/batchMock.ts` |
| `batches.item.resume` | `src/features/projects/SourceBatches.tsx` | `src/lib/batchMock.ts` |
| `batches.list` | `src/features/projects/SourceBatches.tsx` | `src/lib/batchMock.ts` |
| `batches.pause` | `src/features/projects/SourceBatches.tsx` | `src/lib/batchMock.ts` |
| `batches.resume` | `src/features/projects/SourceBatches.tsx` | `src/lib/batchMock.ts` |
| `captions.override` | `src/features/captions/CaptionPanel.tsx` | `src/lib/captionsMock.ts` |
| `captions.overrides` | — | `src/lib/captionsMock.ts` |
| `captions.remap_status` | `src/features/captions/CaptionPanel.tsx` | `src/lib/captionsMock.ts` |
| `captions.style.default` | `src/features/captions/CaptionPanel.tsx` | `src/lib/captionsMock.ts` |
| `captions.style.get` | — | `src/lib/captionsMock.ts` |
| `captions.style.preset` | `src/features/captions/CaptionPanel.tsx` | `src/lib/captionsMock.ts` |
| `captions.style.set` | `src/features/captions/CaptionPanel.tsx` | `src/lib/captionsMock.ts` |
| `captions.track.set` | `src/features/captions/CaptionPanel.tsx` | `src/lib/captionsMock.ts` |
| `channel_profile.get` | `src/features/projects/ChannelProfile.tsx`, `src/features/projects/Selection.tsx`, `src/features/projects/SourceBatches.tsx`, `src/features/projects/Sources.tsx` | `src/lib/core.ts` |
| `channel_profile.languages` | `src/features/projects/ChannelProfile.tsx` | `src/lib/core.ts` |
| `channel_profile.set` | `src/features/projects/ChannelProfile.tsx` | `src/lib/core.ts` |
| `chat.fetch` | `src/features/projects/Selection.tsx` | `src/lib/core.ts` |
| `chat.status` | `src/features/projects/Selection.tsx` | `src/lib/core.ts` |
| `components.cancel` | `src/features/components/Components.tsx`, `DenoCard.tsx`, `HardwareCard.tsx`, `ModelsCard.tsx`, `PocketTtsCard.tsx`, `WorkerCard.tsx`, `src/features/projects/LocalEstimate.tsx` | — |
| `components.catalog.check` | `src/features/components/CatalogCard.tsx` | `src/lib/core.ts` |
| `components.catalog.status` | `src/features/components/CatalogCard.tsx` | `src/lib/core.ts` |
| `components.deno.status` | `src/features/components/DenoCard.tsx` | `src/lib/core.ts` |
| `components.download` | `src/features/components/Components.tsx`, `DenoCard.tsx`, `PocketTtsCard.tsx`, `src/features/projects/Sources.tsx` | `src/lib/core.ts` |
| `components.ffmpeg.status` | `src/features/components/Components.tsx`, `src/features/projects/EngineChoice.tsx`, `src/features/projects/Sources.tsx` | `src/lib/core.ts` |
| `components.ffmpeg.system` | `src/features/components/Components.tsx` | — |
| `components.manifest` | `src/features/components/Components.tsx`, `src/features/projects/Sources.tsx` | `src/lib/core.ts` |
| `components.models.download` | `src/features/components/ModelsCard.tsx` | `src/lib/core.ts` |
| `components.models.manifest` | `src/features/components/ModelsCard.tsx` | `src/lib/core.ts` |
| `components.pocket_tts.status` | `src/features/components/PocketTtsCard.tsx` | `src/lib/core.ts` |
| `components.settings.get` | `src/features/components/Components.tsx` | `src/lib/core.ts` |
| `components.settings.set` | `src/features/components/Components.tsx` | — |
| `components.worker.install` | `src/features/components/WorkerCard.tsx` | `src/lib/core.ts` |
| `components.worker.status` | `src/features/components/WorkerCard.tsx` | `src/lib/core.ts` |
| `components.ytdlp.status` | `src/features/components/Components.tsx` | `src/lib/core.ts` |
| `components.ytdlp.update` | `src/features/components/Components.tsx` | `src/lib/core.ts` |
| `diagnostic.export` | `src/features/report/Report.tsx` | — |
| `diagnostic.get` | `src/features/report/Report.tsx` | `src/lib/core.ts` |
| `documents.validate` | — | — |
| `editor.adjust` | `src/features/editor/Editor.tsx` | `src/lib/editorEditsMock.ts` |
| `editor.audio.get` | `src/features/editor/Editor.tsx` | `src/lib/core.ts`, `src/lib/editorEditsMock.ts` |
| `editor.audio.sfx.add` | `src/features/editor/Editor.tsx` | `src/lib/editorEditsMock.ts` |
| `editor.audio.sfx.remove` | `src/features/editor/Editor.tsx` | `src/lib/editorEditsMock.ts` |
| `editor.audio.sfx.update` | `src/features/editor/Editor.tsx` | `src/lib/editorEditsMock.ts` |
| `editor.audio.soundtrack.clear` | `src/features/editor/Editor.tsx` | `src/lib/editorEditsMock.ts` |
| `editor.audio.soundtrack.set` | `src/features/editor/Editor.tsx` | `src/lib/editorEditsMock.ts` |
| `editor.crop.evaluate` | — | `src/lib/editorEditsMock.ts` |
| `editor.crop.example` | — | `src/lib/editorEditsMock.ts` |
| `editor.crop.get` | — | `src/lib/editorEditsMock.ts` |
| `editor.crop.set_edits` | `src/features/editor/Editor.tsx` | `src/lib/editorEditsMock.ts` |
| `editor.crop.set_layout` | `src/features/editor/Editor.tsx` | `src/lib/editorEditsMock.ts` |
| `editor.crop.set_suggested` | `src/features/editor/CropPanel.tsx` | `src/lib/editorEditsMock.ts` |
| `editor.flush` | `src/features/editor/Editor.tsx` | `src/lib/editorEditsMock.ts` |
| `editor.montage.get` | — | `src/lib/core.ts`, `src/lib/editorEditsMock.ts` |
| `editor.montage.set_start` | `src/features/editor/Editor.tsx` | `src/lib/editorEditsMock.ts` |
| `editor.open` | `src/features/editor/Editor.tsx` | `src/lib/editorEditsMock.ts` |
| `editor.range` | — | `src/lib/core.ts` |
| `editor.redo` | `src/features/editor/Editor.tsx` | `src/lib/editorEditsMock.ts` |
| `editor.sentences` | `src/features/editor/Editor.tsx` | `src/lib/core.ts` |
| `editor.silences.apply_all` | `src/features/editor/Editor.tsx` | `src/lib/editorEditsMock.ts` |
| `editor.silences.detect` | `src/features/editor/Editor.tsx` | `src/lib/editorEditsMock.ts` |
| `editor.silences.revert_all` | `src/features/editor/Editor.tsx` | `src/lib/editorEditsMock.ts` |
| `editor.silences.toggle` | `src/features/editor/Editor.tsx` | `src/lib/editorEditsMock.ts` |
| `editor.snapshots` | — | — |
| `editor.timeline` | `src/features/editor/Editor.tsx` | `src/lib/core.ts` |
| `editor.timeline_status` | `src/features/editor/Editor.tsx` | `src/lib/core.ts` |
| `editor.undo` | `src/features/editor/Editor.tsx` | `src/lib/editorEditsMock.ts` |
| `editor.wave` | `src/features/editor/Editor.tsx` | `src/lib/core.ts` |
| `energy.start` | — | — |
| `energy.status` | `src/features/projects/Selection.tsx` | `src/lib/core.ts` |
| `export.batch.cancel` | `src/features/export/BatchExport.tsx` | `src/features/export/mock.ts` |
| `export.batch.list` | `src/features/export/BatchExport.tsx` | `src/features/export/mock.ts` |
| `export.batch.start` | `src/features/export/BatchExport.tsx` | `src/features/export/mock.ts` |
| `export.batch.status` | — | `src/features/export/mock.ts` |
| `export.captions` | `src/features/captions/useCaptions.ts` | `src/lib/captionsMock.ts`, `src/lib/core.ts` |
| `export.encoder.detect` | `src/features/preferences/EncoderSettings.tsx` | `src/features/export/mock.ts` |
| `export.encoder.set` | `src/features/preferences/EncoderSettings.tsx` | `src/features/export/mock.ts` |
| `export.encoder.status` | `src/features/preferences/EncoderSettings.tsx` | `src/features/export/mock.ts` |
| `export.settings` | `src/features/export/BatchExport.tsx`, `src/features/export/ExportButton.tsx` | `src/features/export/mock.ts` |
| `export.start` | `src/features/export/ExportButton.tsx` | `src/features/export/mock.ts` |
| `export.status` | `src/features/export/ExportButton.tsx` | — |
| `guardrails.ack_direct_notice` | `src/features/guardrails/GuardrailsPanel.tsx` | `src/lib/core.ts` |
| `guardrails.check` | `src/features/guardrails/GuardrailsPanel.tsx` | `src/lib/core.ts` |
| `jobs.budget.continue` | `src/features/projects/SourceBatches.tsx` | `src/lib/batchMock.ts` |
| `jobs.budget.get` | — | — |
| `jobs.budget.set` | `src/features/projects/SourceBatches.tsx` | `src/lib/batchMock.ts` |
| `jobs.cancel` | `CropPanel.tsx`, `Editor.tsx`, `ExportButton.tsx`, `CutPreview.tsx`, `Jobs.tsx`, `Narration.tsx`, `Transcription.tsx` | `src/lib/core.ts`, `src/features/export/mock.ts` |
| `jobs.discard` | `src/features/projects/Jobs.tsx` | `src/lib/core.ts` |
| `jobs.estimate` | `src/features/projects/Jobs.tsx` | `src/lib/core.ts` |
| `jobs.list` | `src/features/projects/Jobs.tsx` | `src/lib/core.ts` |
| `jobs.preview` | — | — |
| `jobs.redo` | — | — |
| `jobs.redo.estimate` | — | — |
| `jobs.result` | — | — |
| `jobs.retry` | `src/features/projects/Jobs.tsx` | `src/lib/core.ts` |
| `narration.align` | `src/features/projects/Narration.tsx` | `src/lib/core.ts` |
| `narration.align_block` | `src/features/projects/Narration.tsx` | `src/lib/core.ts` |
| `narration.cleanup.prepare` | `src/features/projects/Narration.tsx` | `src/lib/core.ts` |
| `narration.cleanup.set` | `src/features/projects/Narration.tsx` | `src/lib/core.ts` |
| `narration.discard_draft` | `src/features/projects/TeleprompterRecorder.tsx` | `src/lib/core.ts` |
| `narration.generate` | `src/features/projects/Narration.tsx` | `src/lib/core.ts` |
| `narration.get` | `src/features/projects/Narration.tsx` | `src/lib/core.ts` |
| `narration.import` | `src/features/projects/Narration.tsx` | `src/lib/core.ts` |
| `narration.record_block` | `src/features/projects/TeleprompterRecorder.tsx` | `src/lib/core.ts` |
| `narration.regenerate_block` | `src/features/projects/Narration.tsx` | `src/lib/core.ts` |
| `narration.review` | `src/features/projects/Narration.tsx` | `src/lib/core.ts` |
| `narration.trim_block` | `src/features/projects/Narration.tsx` | `src/lib/core.ts` |
| `packaging.edit` | `src/features/projects/Packaging.tsx` | `src/lib/packagingMock.ts` |
| `packaging.estimate` | `src/features/projects/Packaging.tsx` | `src/lib/packagingMock.ts` |
| `packaging.generate` | `src/features/projects/Packaging.tsx` | `src/lib/packagingMock.ts` |
| `packaging.get` | `src/features/projects/Packaging.tsx` | `src/lib/packagingMock.ts` |
| `packaging.refresh_chapters` | `src/features/projects/Packaging.tsx` | `src/lib/packagingMock.ts` |
| `projects.close` | — | — |
| `projects.create` | `src/features/projects/Projects.tsx` | — |
| `projects.current` | `src/features/projects/Projects.tsx` | `src/lib/core.ts` |
| `projects.local_only.get` | `src/features/projects/ProjectPrivacy.tsx` | `src/lib/core.ts` |
| `projects.local_only.set` | `src/features/projects/ProjectPrivacy.tsx` | `src/lib/core.ts` |
| `projects.open` | `src/features/projects/Projects.tsx` | — |
| `projects.recent` | `src/features/projects/Projects.tsx` | `src/lib/core.ts` |
| `provider.audit.list` | — | — |
| `provider.capabilities` | — | — |
| `provider.cli.configure` | `src/features/assistant/Assistant.tsx`, `src/features/provider/CliSettings.tsx` | `src/lib/core.ts` |
| `provider.cli.confirm` | `src/features/assistant/Assistant.tsx`, `src/features/provider/CliSettings.tsx` | `src/lib/core.ts` |
| `provider.cli.status` | `src/features/assistant/AssistantSettings.tsx`, `src/features/provider/CliSettings.tsx` | `src/lib/core.ts` |
| `provider.configure` | `src/features/assistant/Assistant.tsx`, `src/features/provider/ProviderProfiles.tsx`, `src/features/provider/ProviderSettings.tsx` | `src/lib/core.ts` |
| `provider.confirm` | `src/features/provider/ProviderProfiles.tsx`, `src/features/provider/ProviderSettings.tsx` | `src/lib/core.ts` |
| `provider.context.get` | `src/features/provider/ProviderProfiles.tsx` | `src/lib/core.ts` |
| `provider.cost.estimate` | `src/features/provider/Costs.tsx` | `src/lib/core.ts` |
| `provider.cost.list` | `src/features/provider/Costs.tsx` | `src/lib/core.ts` |
| `provider.cost.run` | — | — |
| `provider.key.remove` | `src/features/provider/ProviderProfiles.tsx`, `src/features/provider/ProviderSettings.tsx` | `src/lib/core.ts` |
| `provider.key.set` | `src/features/provider/ProviderProfiles.tsx`, `src/features/provider/ProviderSettings.tsx` | `src/lib/core.ts` |
| `provider.prices.clear` | `src/features/provider/Costs.tsx` | `src/lib/core.ts` |
| `provider.prices.get` | `src/features/provider/Costs.tsx` | `src/lib/core.ts` |
| `provider.prices.set` | `src/features/provider/Costs.tsx` | `src/lib/core.ts` |
| `provider.profiles.list` | `AssistantSettings.tsx`, `TaskTable.tsx`, `RedoWithProfile.tsx`, `ProviderProfiles.tsx` | `src/lib/core.ts` |
| `provider.profiles.remove` | `src/features/provider/ProviderProfiles.tsx` | `src/lib/core.ts` |
| `provider.selection_state` | `src/features/provider/SelectionState.tsx` | `src/lib/core.ts` |
| `provider.status` | `src/features/provider/ProviderSettings.tsx` | `src/lib/core.ts` |
| `provider.structured` | — | — |
| `provider.test` | `CliSettings.tsx`, `ProviderProfiles.tsx`, `ProviderSettings.tsx` | `src/lib/core.ts` |
| `proxy.map_time` | — | — |
| `proxy.request` | `src/features/projects/CutPreview.tsx` | `src/lib/core.ts` |
| `proxy.status` | `src/features/projects/CutPreview.tsx` | `src/lib/core.ts` |
| `reframe.start` | `src/features/editor/CropPanel.tsx` | `src/lib/editorEditsMock.ts` |
| `reframe.status` | `src/features/editor/CropPanel.tsx` | `src/lib/editorEditsMock.ts` |
| `script.approve` | `src/features/projects/Script.tsx` | `src/lib/scriptMock.ts` |
| `script.edit` | `src/features/projects/Script.tsx` | `src/lib/scriptMock.ts` |
| `script.estimate` | `src/features/projects/Script.tsx` | `src/lib/scriptMock.ts` |
| `script.generate` | `src/features/projects/Script.tsx` | `src/lib/scriptMock.ts` |
| `script.get` | `src/features/projects/Script.tsx` | `src/lib/core.ts`, `src/lib/scriptMock.ts` |
| `script.narration_allowed` | — | — |
| `script.regenerate` | `src/features/projects/Script.tsx` | `src/lib/scriptMock.ts` |
| `selection.adjust` | `src/features/projects/CandidateReview.tsx` | `src/lib/core.ts` |
| `selection.cancel` | `src/features/projects/Selection.tsx` | `src/lib/core.ts` |
| `selection.decide` | `src/features/projects/CandidateReview.tsx` | `src/lib/core.ts` |
| `selection.estimate` | `src/features/projects/RedoWithProfile.tsx`, `src/features/projects/Selection.tsx` | `src/lib/core.ts` |
| `selection.get` | `src/features/projects/Selection.tsx` | `src/lib/core.ts` |
| `selection.list` | `src/features/projects/Selection.tsx` | `src/lib/core.ts` |
| `selection.redo` | `src/features/projects/RedoWithProfile.tsx`, `src/features/projects/Selection.tsx` | `src/lib/core.ts` |
| `selection.resume` | `src/features/projects/Selection.tsx` | `src/lib/core.ts` |
| `selection.review` | `src/features/projects/CandidateReview.tsx` | `src/lib/core.ts` |
| `selection.start` | `src/features/projects/Selection.tsx` | `src/lib/core.ts` |
| `selection.undo` | `src/features/projects/CandidateReview.tsx` | `src/lib/core.ts` |
| `sources.cancel` | `src/features/projects/Sources.tsx` | — |
| `sources.hash` | `src/features/projects/Sources.tsx` | `src/lib/core.ts` |
| `sources.import` | `src/features/projects/Sources.tsx` | `src/lib/core.ts` |
| `sources.inspect` | `src/features/projects/Sources.tsx` | `src/lib/core.ts` |
| `sources.language.set` | `src/features/projects/EngineChoice.tsx` | `src/lib/core.ts` |
| `sources.list` | `src/features/projects/SourceBatches.tsx`, `src/features/projects/Sources.tsx` | `src/lib/core.ts` |
| `sources.permission.set` | `src/features/projects/Sources.tsx` | `src/lib/core.ts` |
| `sources.relocate` | `src/features/projects/Sources.tsx` | `src/lib/core.ts` |
| `sources.url.cancel` | `src/features/projects/Sources.tsx` | — |
| `sources.url.download` | `src/features/projects/Sources.tsx` | `src/lib/core.ts` |
| `sources.url.settings.get` | `src/features/projects/Sources.tsx` | `src/lib/core.ts` |
| `sources.url.settings.set` | `src/features/projects/Sources.tsx` | `src/lib/core.ts` |
| `thumbnail.choose` | `src/features/projects/Thumbnail.tsx` | `src/lib/thumbnailMock.ts` |
| `thumbnail.estimate` | `src/features/projects/Thumbnail.tsx` | `src/lib/thumbnailMock.ts` |
| `thumbnail.export` | `src/features/projects/Thumbnail.tsx` | `src/lib/thumbnailMock.ts` |
| `thumbnail.get` | `src/features/projects/Thumbnail.tsx` | `src/lib/thumbnailMock.ts` |
| `thumbnail.suggest` | `src/features/projects/Thumbnail.tsx` | `src/lib/thumbnailMock.ts` |
| `transcription.blocks` | — | — |
| `transcription.correct` | `CaptionPanel.tsx`, `ExportButton.tsx`, `TranscriptTimeline.tsx` | `src/lib/core.ts` |
| `transcription.corrections` | `src/features/projects/TranscriptTimeline.tsx` | `src/lib/core.ts` |
| `transcription.estimate` | `src/features/projects/LocalEstimate.tsx` | `src/lib/core.ts` |
| `transcription.groq.confirm` | `src/features/projects/EngineChoice.tsx` | `src/lib/core.ts` |
| `transcription.groq.estimate` | `src/features/projects/EngineChoice.tsx` | `src/lib/core.ts` |
| `transcription.groq.info` | `src/features/projects/EngineChoice.tsx` | `src/lib/core.ts` |
| `transcription.groq.key.remove` | `src/features/preferences/GroqSettings.tsx` | `src/lib/core.ts` |
| `transcription.groq.key.set` | `src/features/preferences/GroqSettings.tsx` | `src/lib/core.ts` |
| `transcription.groq.key.status` | `src/features/preferences/GroqSettings.tsx` | `src/lib/core.ts` |
| `transcription.groq.key.test` | `src/features/preferences/GroqSettings.tsx` | `src/lib/core.ts` |
| `transcription.grouping` | `src/features/components/HardwareCard.tsx`, `src/features/projects/EngineChoice.tsx` | `src/lib/core.ts` |
| `transcription.hardware.choose` | `src/features/components/HardwareCard.tsx` | `src/lib/core.ts` |
| `transcription.hardware.diagnostic` | — | — |
| `transcription.hardware.probe` | `src/features/components/HardwareCard.tsx` | `src/lib/core.ts` |
| `transcription.hardware.status` | `HardwareCard.tsx`, `EngineChoice.tsx`, `LocalEstimate.tsx`, `Sources.tsx`, `Transcription.tsx` | `src/lib/core.ts` |
| `transcription.redo` | `src/features/projects/TranscriptTimeline.tsx` | `src/lib/core.ts` |
| `transcription.search` | `src/features/projects/TranscriptSearch.tsx` | `src/lib/core.ts` |
| `transcription.segment` | `src/features/projects/TranscriptTimeline.tsx` | `src/lib/core.ts` |
| `transcription.sentences` | — | — |
| `transcription.start` | `src/features/projects/EngineChoice.tsx` | `src/lib/core.ts` |
| `transcription.status` | `src/features/projects/Transcription.tsx` | `src/lib/core.ts` |
| `transcription.timeline` | `src/features/projects/TranscriptTimeline.tsx` | `src/lib/core.ts` |
| `transcription.undo` | `src/features/projects/TranscriptTimeline.tsx` | `src/lib/core.ts` |
| `transcription.words` | — | — |
| `translation.edit` | `src/features/translation/TranslationPanel.tsx` | `src/lib/translationMock.ts` |
| `translation.estimate` | `src/features/translation/TranslationPanel.tsx` | `src/lib/translationMock.ts` |
| `translation.get` | `src/features/translation/TranslationPanel.tsx` | `src/lib/translationMock.ts` |
| `translation.start` | `src/features/translation/TranslationPanel.tsx` | `src/lib/translationMock.ts` |
| `translation.track.set` | `src/features/translation/TranslationPanel.tsx` | `src/lib/translationMock.ts` |
| `tts.catalog` | `TtsCatalogCard.tsx`, `ChannelProfile.tsx`, `Narration.tsx` | `src/lib/core.ts` |
| `tts.models.cancel` | `src/features/components/TtsCatalogCard.tsx` | `src/lib/core.ts` |
| `tts.models.choose` | `src/features/components/TtsCatalogCard.tsx` | `src/lib/core.ts` |
| `tts.models.download` | `src/features/components/TtsCatalogCard.tsx` | `src/lib/core.ts` |

### Comandos sem uso direto em tela (28 no total)

1. **Sem uso na UI nem no mock (19):**
   `documents.validate`, `editor.snapshots`, `energy.start`, `jobs.budget.get`, `jobs.preview`, `jobs.redo`, `jobs.redo.estimate`, `jobs.result`, `projects.close`, `provider.audit.list`, `provider.capabilities`, `provider.cost.run`, `provider.structured`, `proxy.map_time`, `script.narration_allowed`, `transcription.blocks`, `transcription.hardware.diagnostic`, `transcription.sentences`, `transcription.words`.
2. **Cobertos apenas nos arquivos de mock, sem chamada direta nas telas (9):**
   `batches.get`, `captions.overrides`, `captions.style.get`, `editor.crop.evaluate`, `editor.crop.example`, `editor.crop.get`, `editor.montage.get`, `editor.range`, `export.batch.status`. *(Na UI atual, esses dados chegam embutidos em comandos agregadores como `editor.open`, `export.captions`, `batches.list` e `export.batch.list`.)*

### Comandos chamados pelas telas sem cobertura no mock (12)

`backups.create`, `backups.restore`, `backups.settings.set`, `components.cancel`, `components.ffmpeg.system`, `components.settings.set`, `diagnostic.export`, `export.status`, `projects.create`, `projects.open`, `sources.cancel`, `sources.url.cancel`.

*(Observação sobre `export.status`: `coreDispatch` só delega `export.*` para `exportMock` quando `name !== 'export.captions'`, porém em `src/features/export/mock.ts` — verificado via busca — não há branch para `export.status`, apenas `export.start`, `export.settings` e `export.batch.*`, de modo que `export.status` cai em erro no mock.)*

---

## Problemas de UX observados

1. **Páginas com dezenas de seções empilhadas sem fim e aninhamento extremo dentro da lista de Fontes**
   * `Projects.tsx:39-47` empilha 8 blocos pesados abaixo do formulário de criação (`ChannelProfile`, `Sources`, `SourceBatches`, `BatchExport`, `TranscriptSearch`, `Jobs`, `ProjectPrivacy`, `Backups`) e ainda coloca a lista de Projetos recentes no rodapé (`Projects.tsx:48-49`).
   * `Sources.tsx:61` monta `<Transcription />` dentro de cada `<li>` da lista de Fontes. Por sua vez, `Transcription.tsx:71-73` monta `<Selection />`, `<CutPreviewPanel />` e `<TranscriptTimeline />`; `Selection.tsx:256-259` monta `<CandidateReview />` e `<BatchExport />`; e `CandidateReview.tsx:220-225` monta `<Script />` (com `<Angles />`), `<Narration />` (com `<TeleprompterRecorder />`), `<RedoWithProfile />`, `<Packaging />` e `<Thumbnail />` dentro da coluna direita do detalhe do candidato. Se um Projeto tiver 3 Fontes transcritas, tudo fica aberto ao mesmo tempo na mesma rolagem vertical.
   * `Preferences.tsx:14` empilha 7 seções longas numa única página (`Tema/Idioma`, `GroqSettings`, `EncoderSettings`, `AssistantSettings`+`TaskTable`, `ProviderSettings`+`CliSettings`, `ProviderProfiles` com 13 campos de formulário, `ProviderCosts` com 3 blocos).
   * `Components.tsx:50-63` empilha 3 cards do manifesto + 7 subcards + FFmpeg do sistema + Pastas/cache numa única coluna.

2. **Tudo preso numa coluna centralizada estreita (`max-w-4xl`)**
   * Todas as 5 páginas usam `className="mx-auto max-w-4xl px-8 py-10"` (`Projects.tsx:33`, `Components.tsx:50`, `Preferences.tsx:14`, `About.tsx:12`, `Report.tsx:51`).
   * Isso espreme componentes naturalmente horizontais ou multi-painel — como `CandidateReview.tsx:161` (grid 2:3 que já divide a largura de uma `<li>` dentro de `max-w-4xl`), `TranscriptTimeline.tsx:197`, `TaskTable.tsx:60` e `ProviderProfiles.tsx:103` — no centro da janela, desperdiçando área útil em telas 1366–1920 px e forçando rolagem horizontal/vertical dentro de caixas estreitas.

3. **Ausência de navegação por etapas e de roteamento/URL**
   * `main.tsx:26,52` usa `useState<Page>('home')`, sem rotas, breadcrumbs nem etapas do fluxo (`Projeto → Fontes → Transcrição → Seleção/Revisão → Edição/Transformação → Empacotamento/Export`).
   * O usuário não consegue fechar o Projeto aberto na UI (`projects.close` nunca é chamado) nem alternar entre subvisões sem perder a posição do scroll.
   * O editor de Corte (`Editor.tsx:75-83,555-556`) é um overlay `fixed inset-0` disparado por `CustomEvent`, sem rota própria; enquanto `main.tsx:47-52` mantém na tela principal duas gavetas (`GavetaBorda`) permanentemente vazias (`"Nenhuma ferramenta disponível."`).

4. **Ausência de estados de carregamento, erro e vazio consistentes**
   * `Projects.tsx:25` não exibe estado de carregamento para `projects.recent` ou `projects.current`.
   * `Sources.tsx:38`, `Jobs.tsx:38`, `SourceBatches.tsx:86`, `Backups.tsx:16`, `ProviderProfiles.tsx:54` e `Components.tsx:36-39` não distinguem "ainda carregando" de "lista vazia".
   * `Angles.tsx:85-86`, `Script.tsx:102`, `Narration.tsx:508`, `Packaging.tsx:186` e `Thumbnail.tsx:116` retornam `null` durante o carregamento inicial.
   * `AudioPanel.tsx:208-210` e `ProviderCosts.tsx:27` engolem falhas de carregamento (`catch { /* ignora */ }` / `catch { setRows([]); }`) sem informar o usuário.
   * `Report.tsx:24` deixa o textarea de diagnóstico em branco enquanto `diagnostic.get` está em curso e não mostra feedback de `busy` durante `diagnostic.export`.

5. **Textos técnicos e erros crus expostos ao usuário**
   * `UpdateNotice.tsx:115,119` exibe `estado.reason` cru vindo do updater (erros de rede/JSON em inglês do Rust/HTTP).
   * `Projects.tsx:25,29,38`, `Sources.tsx:38-39,43`, `Backups.tsx:17-18,22`, `Components.tsx:20,36,45`, `DenoCard.tsx:13`, `HardwareCard.tsx:17` e `CatalogCard.tsx:50,85` expõem `error.message` bruto do núcleo quando não há mapeamento por código.
   * `SourceBatches.tsx:104` imprime código interno cru quando não mapeado (`(${t.code}: ...)`).
   * Termos internos de implementação aparecem na UI sem abstração: `compute_type` (`HardwareCard.tsx:64`: `int8_float16`), `Worker Python`/`handshake`/`protocol` (`WorkerCard.tsx:43-49`), `Task v{task}` (`Packaging.tsx:210`, `TranslationPanel.tsx:361`), `libass` (`CaptionPanel.tsx:10`), `SHA-256` (`TtsCatalogCard.tsx:90`) e `Ed25519` (`CatalogCard.tsx:28`).

6. **Ações destrutivas ou irreversíveis sem confirmação (ou com `window.confirm` nativo)**
   * Sem confirmação: `Jobs.tsx:68` executa `jobs.discard` ("Descartar") e `jobs.cancel` ("Cancelar tarefa") imediatamente; `GroqSettings.tsx:30`, `ProviderSettings.tsx:52` e `ProviderProfiles.tsx:144` removem chaves salvas do cofre (`*.key.remove`) com 1 clique; `AudioPanel.tsx:499,600` remove trilha sonora e SFX sem diálogo; `CropPanel.tsx:840,908` apaga todos os keyframes (`Limpar edições`) ou um keyframe individual sem confirmação; `Narration.tsx:548,666` sobrescreve áudios existentes ao clicar em gerar/regenerar tudo ou bloco (diferente da importação em `Narration.tsx:409-415`, que pede confirmação).
   * Uso inconsistente de `window.confirm` do navegador em vez de `<ConfirmDialog />`: `Components.tsx:45` (download de `ffmpeg`, `yt-dlp`, `uv`) e `Backups.tsx:25` (restauração de backup).

7. **Problemas de foco, teclado e acessibilidade**
   * `CandidateReview.tsx:168` define `tabIndex={-1}` em todos os botões de candidatos na `<ol>`, impedindo navegação via `Tab` pela lista; o usuário precisa focar o container pai `div[role="group"]` (`CandidateReview.tsx:144`) e usar `↑`/`↓`.
   * `Gaveta.tsx:86` implementa focus trap no `Tab`, mas a query de elementos focáveis exclui `textarea` (`'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])'`), prendendo ou pulando o foco incorretamente quando houver `<textarea>` em uma gaveta.
   * Conflito de atalhos `[` e `]`: no shell (`main.tsx:35-36`) e no `Editor.tsx:410-411` alternam as gavetas esquerda/direita; dentro de `CandidateReview.tsx:130,135-136`, `[` e `]` passam a mover a borda inicial do Corte, mudando o significado da tecla conforme o foco.
   * Controles nativos sem primitiva consistente: `Report.tsx:54-55,57` e `Selection.tsx:221,253` não usam a classe utilitária `.foco` (ficando com outline quadrado padrão no WebKitGTK), e `Preferences.tsx:14`, `ChannelProfile.tsx:351`, `Sources.tsx:27,59`, `ProviderSettings.tsx:42-46` e `ProviderProfiles.tsx:157-168` renderizam `<input>`/`<select>`/`<progress>` crus.
   * `Progress` nativo (`<progress>`) e `Alert`s misturam `role="status"` com `role="alert"` para erros em `Assistant.tsx:88,122` e `ProviderSettings.tsx:55` (erros anunciados como `status` em vez de `alert`).

8. **Duplicação de lógica entre telas**
   * `function message(error: unknown)` é copiada literalmente em 9 arquivos (`Components.tsx:20`, `CatalogCard.tsx:50`, `DenoCard.tsx:13`, `HardwareCard.tsx:17`, `ModelsCard.tsx:12`, `PocketTtsCard.tsx:56`, `TtsCatalogCard.tsx:136`, `WorkerCard.tsx:13`, `LocalEstimate.tsx:24`, `Transcription.tsx:21`, além de `selectionFormat.ts:4`).
   * `const fill = ...` é duplicado em 5 arquivos (`BatchExport.tsx:149`, `GuardrailsPanel.tsx:155`, `SourceBatches.tsx:61`, `TranslationPanel.tsx` via import, `selectionFormat.ts:2`).
   * `function clock(us)` é reimplementada em `CaptionPanel.tsx:15`, `ExportButton.tsx:28`, `CutPreview.tsx:59`, `Thumbnail.tsx:48`, `TranscriptSearch.tsx:11` (`time`), `TranscriptTimeline.tsx:24` (`time`) e `selectionFormat.ts:3`.
   * `const codeOf = ...` é repetido em `AudioPanel.tsx:159`, `TranslationPanel.tsx:177`, `Narration.tsx:299`, `Packaging.tsx:110`, `Script.tsx:49` e `TeleprompterRecorder.tsx:107`.
   * `const usd = ...` é repetido em `TranslationPanel.tsx:176`, `Costs.tsx:16`, `Packaging.tsx:109`, `RedoWithProfile.tsx:55`, `Script.tsx:48`, `Selection.tsx:68`, `SourceBatches.tsx:62` e `Thumbnail.tsx:46`.
   * `presetStyle` de legendas em `ChannelProfile.tsx:37-52` replica no front os valores de preset do núcleo/mock (`src/lib/captionsMock.ts`).

---

## O que vale reaproveitar

Módulos puros (sem JSX acoplado ao layout da v1) ou de infraestrutura que podem ser migrados diretamente para o front v2:

* [src/features/editor/cropMath.ts](../../../src/features/editor/cropMath.ts) — Cálculo puro e interpolação de crop 9:16 e layouts duplos (`gameplay_webcam`, `two_people`), espelhando `core/src/editor/crop.rs`.
* [src/features/editor/timelineMath.ts](../../../src/features/editor/timelineMath.ts) — Conversões `usToPx`/`pxToUs`, mapeamento `sourceToSplicedUs`/`splicedToSourceUs`, janela visível, busca de Frase e curva de velocidades `nextRate`.
* [src/features/editor/duckingMath.ts](../../../src/features/editor/duckingMath.ts) — Envoltória de ducking (-12 dB, ataque 40 ms, liberação 300 ms), fades e cálculo de loop de trilha sonora alinhados ao pipeline Rust.
* [src/features/captions/render.ts](../../../src/features/captions/render.ts) e [src/features/captions/types.ts](../../../src/features/captions/types.ts) — Carregamento das fontes TTF e renderização 1080×1920 calibrada para paridade com `libass`.
* [src/features/captions/useCaptions.ts](../../../src/features/captions/useCaptions.ts) — Hook puro de carga/invalidação de legendas por evento de correção.
* [src/features/projects/CutPreview.tsx](../../../src/features/projects/CutPreview.tsx) (funções puras `toProxySeconds` e `skipCutForward`) e [src/features/export/ExportButton.tsx](../../../src/features/export/ExportButton.tsx) (função pura `exportFilename` com sanitização Windows/reserved names).
* [src/features/projects/SourceLanguage.tsx](../../../src/features/projects/SourceLanguage.tsx) — Lista de códigos de idioma Whisper (`CODES`) e formatação via `Intl.DisplayNames` (`languageLabel`).
* [src/features/projects/selectionFormat.ts](../../../src/features/projects/selectionFormat.ts) e [src/features/projects/LocalEstimate.tsx](../../../src/features/projects/LocalEstimate.tsx) (`formatDuration`) — Formatações compartilhadas de relógio, interpolação e duração.
* [src/features/updates/updateError.ts](../../../src/features/updates/updateError.ts) — Classificação de falhas de rede vs assinatura/integridade no auto-updater.
* [src/lib/media.ts](../../../src/lib/media.ts), [src/lib/comandos.tsx](../../../src/lib/comandos.tsx), [src/lib/tema.ts](../../../src/lib/tema.ts), [src/lib/i18n.ts](../../../src/lib/i18n.ts) e [src/lib/cn.ts](../../../src/lib/cn.ts) — Transporte multiplataforma de mídia, registro unificado de comandos/paleta, tema OKLCH e contexto de idioma.
* [src/styles/tokens.css](../../../src/styles/tokens.css) e [src/styles/index.css](../../../src/styles/index.css) — Base visual do padrão Foco (que já espelha `design-system/`).
* **Mocks em `src/lib/*Mock.ts` e `src/features/export/mock.ts`:** Base funcional para o Playwright (`bun run test:ui`), precisando apenas cobrir os 12 comandos ainda sem handler no mock.
* **Textos revisados (`texts.ts` e dicionários inline em PT-BR/EN):** Os textos de domínio já seguem o [GLOSSARY.md](../../../GLOSSARY.md) (ex.: Corte, Fonte, Transcrição, Frase, Nota, Narração, Roteiro, Empacotamento, Permissão, Provedor, Perfil de canal) — destaque para `src/features/guardrails/GuardrailsPanel.tsx`, `src/features/provider/*Texts.ts`, `src/features/assistant/texts.ts`, `src/features/projects/videoKind.tsx`, `src/features/projects/Narration.tsx`, `src/features/projects/Packaging.tsx` e `src/features/translation/TranslationPanel.tsx`.
