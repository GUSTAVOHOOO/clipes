# Editor do Corte: timeline, enquadramento, silêncios, áudio, legendas e reenquadramento

## A jornada

Depois de transcrever a Fonte e aprovar os melhores trechos na etapa de seleção, o usuário abre um Corte no editor para refiná-lo antes de exportar. É aqui que um trecho bruto vira um vídeo vertical pronto para publicar (ou a base montada de um Vídeo transformado, quando já há Roteiro e Narração). O editor trabalha sempre em cima de um proxy leve de busca rápida (±2 min ao redor do Corte), sem carregar uma live inteira de horas na WebView.

Dentro do editor, o usuário ajusta as bordas do Corte (encaixadas em Frase inteira por padrão, ou por quadro segurando `Alt`), remove pausas longas de silêncio sem cortar a fala, escolhe o layout 9:16 e corrige o enquadramento com ajuda do reenquadramento automático local, personaliza o estilo e a faixa das legendas (karaokê por palavra, original, traduzida ou da Narração), posiciona os blocos de Narração na montagem e adiciona trilha sonora e efeitos sonoros com controle de origem/licença. Ao fechar o editor ou a janela do app, todas as edições pendentes são persistidas no SQLite do Projeto, seguindo então para as etapas de Empacotamento, checklist de guarda-corpos e exportação com FFmpeg e libass.

---

## Como o editor funciona por baixo

### Sessão de edição, salvamento, desfazer/refazer e snapshots

- **Sessão em memória e SQLite (`clip_edits`):** `editor.open` valida o Corte (ou por `candidate_id`, ou por `(source_id, start_id, end_id)`), cria ou carrega o documento JSON (`schemaVersion: 2`) na tabela `clip_edits` do Projeto aberto e mantém uma cópia ativa em memória no núcleo Rust.
- **Prévias vs. confirmação (`preview`):** comandos de arrasto contínuo (`editor.adjust`, `editor.silences.detect`, `editor.crop.set_layout`, `editor.crop.set_edits`, `editor.montage.set_start`, `editor.audio.*`) aceitam `preview: true`. Nesse modo, o núcleo clona o documento em memória, devolve o estado calculado para a UI atualizar o preview em tempo real e **não** grava histórico nem altera `revision`. Só quando o usuário solta o ponteiro (`preview: false`, padrão) o núcleo empilha o estado anterior no `undo` e marca o documento como sujo (`dirty`).
- **Desfazer e refazer (`editor.undo` / `editor.redo`):** a pilha fica no próprio documento em memória/JSON (`undo` + `redo` limitados a **100** entradas combinadas). Cada passo (`EditSnapshot`) guarda bordas (`start_id`, `end_id`, `start_us`, `end_us`), `silences`, `crop_layout`, `crop_split_ratio`, `crop_edits` (incluindo painéis `gameplay_webcam` e `two_people`), `narration_starts`, `soundtrack` e `sfx`. Observação: `suggested` (sugestão automática de reenquadramento) **não** entra no snapshot de `undo`/`redo`.
- **Autosave, `editor.flush` e fechamento da janela:** ao abrir o primeiro Corte, o núcleo inicia uma thread de autosave que verifica a cada 50 ms se algum Corte sujo completou 1 segundo desde a última alteração e grava no SQLite emitindo o evento `editor_saved` (ou `editor_save_failed` em caso de falha). O comando `editor.flush` força a gravação imediata de todos os Cortes sujos — ele é chamado explicitamente ao fechar a gaveta/tela do editor, antes de fechar/trocar Projeto ou criar/restaurar backup (`project_change` em `core/src/projects.rs` e `core/src/projects/backups.rs`), e no evento `WindowEvent::CloseRequested` em `src-tauri/src/main.rs` (se o flush falhar ao fechar a janela, o fechamento é bloqueado com `api.prevent_close()` e o app emite `editor_save_failed`).
- **Snapshots persistentes (`clip_snapshots`):** cada salvamento no banco (seja pelo autosave ou por `editor.flush`) também grava uma cópia completa do documento em `clip_snapshots` e mantém apenas os **20** snapshots mais recentes por `clip_id`, consultáveis via `editor.snapshots`.

### Timeline, range e montagem

- **Range e bordas do Corte:** um Corte é definido por um intervalo contínuo na Fonte (`start_id`/`end_id` em IDs de Frase e `startUs`/`endUs` em microssegundos inteiros). Quando o Corte vem de um candidato selecionado, a faixa de duração permitida vem da execução da seleção (`min_us..=max_us` do registro em `selection_runs`); quando é aberto avulso por Frases, vale o padrão de **20 s a 180 s** (`MIN_CLIP_US = 20_000_000` a `MAX_CLIP_US = 180_000_000`). No ajuste livre (`free: true`, equivalente ao `Alt` na UI), o núcleo arredonda `time_us` para o quadro mais próximo usando o `avg_frame_rate` da Fonte e recalcula `start_id`/`end_id` pelas Frases que sobrepõem o novo intervalo.
- **Janela do proxy e assets visuais:** `editor.open` devolve a janela `windowStartUs..windowEndUs` equivalente ao Corte ±2 min (`MARGIN_US = 120_000_000`, limitada a `[0, duração]`, para Cortes de até 10 min no preview). Os comandos `editor.timeline`, `editor.timeline_status` e `editor.wave` geram e leem o sprite de miniaturas (`thumbs.jpg`, 1 quadro a cada 2 s em grade de 20 colunas × 96×54 px) e a onda de áudio (`wave.bin`, 1 byte 0–255 a cada 100 ms) **exclusivamente a partir do arquivo de proxy**, na mesma pasta do cache LRU externo ao Projeto.
- **Silêncios e `SpliceMap`:** `editor.silences.detect` identifica pausas entre palavras da Transcrição acima de `threshold_us` (entre **300 ms e 2000 ms**, padrão **600 ms**), preserva margens de fala (**120 ms** após a palavra anterior e **75 ms** antes da seguinte, garantindo **200 ms** de pausa de respiro) e refina os pontos de corte para o vale local de amplitude / cruzamento por zero dentro de **±20 ms** usando PCM 16 kHz da Fonte quando disponível. Cortes ativos formam um `SpliceMap`, que traduz tempos da Fonte para o Corte emendado (`source_to_output` / `output_to_source`) no preview, nas legendas, na montagem e no export.
- **Montagem de Vídeo transformado (`core/src/montage.rs`):** quando o candidato tem Roteiro, o núcleo calcula automaticamente o `MontagePlan` sobre o `SpliceMap`:
  1. cada bloco de Narração é ancorado na 1ª Frase de `refs` que permaneceu dentro do Corte (ou em `0` / após o bloco anterior se não houver `refs`);
  2. se o usuário arrastou um bloco (`editor.montage.set_start`), vale `manual_source_start_us` salvo em µs da Fonte (sem invalidar o Roteiro aprovado nem regerar TTS/alinhamento);
  3. colisões entre blocos empurram o bloco seguinte mantendo **300 ms** de respiro (`BLOCK_GAP_US`), gerando aviso `block_pushed`;
  4. blocos sem áudio real ainda usam estimativa de duração por caracteres (`15 chars/s`, mínimo `500 ms`);
  5. se a Narração ultrapassar o fim do Corte emendado, o excesso vira `freezeTailUs` (congelamento do último quadro `tpad` no render), emitindo `freeze_tail` (ou `long_freeze_tail` acima de **5 s**).

### Enquadramento (crop), layouts e reenquadramento automático

- **Cinco layouts da v1 (`core/src/editor/crop.rs`, espelhado em `src/features/editor/cropMath.ts` e detalhado em `docs/research/2026-11-16-layouts-reenquadramento.md`):**
  1. `fit` (Fit / centro): Fonte inteira centralizada em 1080×1920 com barras pretas, aceitando zoom/pan manuais.
  2. `face` (Rosto): Fill 9:16 seguindo o rosto com sugestão automática do YuNet e correções manuais.
  3. `gameplay_webcam` (Jogo + webcam): dois painéis empilhados em Fill — topo (webcam, padrão `splitRatio = 0.30`, ajustável em `0.20..=0.50`) e base (jogo, restante). A detecção automática tem confiança limitada (`0.15..=0.65`, ou `0.10` no fallback), mantendo o retângulo manual como caminho principal.
  4. `two_people` (Duas pessoas): duas janelas empilhadas em Fill (padrão `splitRatio = 0.50`, ajustável em `0.30..=0.70`) com rastreio independente por pessoa ou ajuste manual por painel.
  5. `fullscreen_roi` (Tela cheia com área de interesse): Fill 9:16 manual (mover e zoom, sem rastreio de rosto).
- **Separação entre sugestão e edições:** `CropTimeline` guarda `suggested` separado de `edits` (e para layouts duplos, `gameplayWebcam.top/bottom` e `twoPeople.top/bottom`). Na resolução (`resolve_panel_segments`), qualquer segmento de `suggested` que contenha pelo menos um keyframe em `edits` passa a usar exclusivamente os keyframes manuais naquele segmento; os demais preservam a sugestão automática. Dentro de um segmento, a interpolação é linear; nas trocas de segmento (`scene`, `face_switch` ou keyframe manual com `cut: true`), o corte é seco. Preview e export usam a mesma matemática.
- **Reenquadramento automático (`reframe.start` / `reframe.status`):** roda como um **job** (tarefa assíncrona executada em segundo plano na fila local do núcleo) no worker Python usando o modelo YuNet (ONNX Runtime CUDA quando disponível, ou CPU), analisando apenas o trecho do Corte em proxy a 2–5 fps.

### Legendas: estilo, presets, overrides, faixas e remapeamento

- **Paridade CSS vs. FFmpeg/libass (ADR-0002):** o núcleo calcula e prepara os blocos (`Cue`), quebras de linha, tempos em centésimos de segundo (`ASS_TICK_US = 10_000`) e o script ASS completo com tags `\kf` (karaokê por palavra) em canvas lógico `1080×1920`. O preview desenha os mesmos blocos/centésimos em CSS com as fontes embutidas `Noto Sans` (`NotoSans-Bold.ttf`) e `Noto Serif` (`NotoSerif-Bold.ttf`), removendo emojis coloridos que o libass não renderiza e sinalizando glifos ausentes.
- **Presets e estilo por Corte:** existem 3 presets (`vertical`, `cinema` com fade de 120 ms, `simple` sem destaque karaokê). Cada Corte recebe preguiçosamente uma cópia do estilo padrão do Projeto (`caption_style_default`, ou `vertical` se não houver), com controle otimista de concorrência via `revision` (`caption_style_conflict` se desatualizado). `captions.style.default` promove o estilo do Corte atual para padrão do Projeto.
- **Overrides por palavra e remapeamento:** `captions.override` grava cor, cor ativa, destaque ou ocultação para uma palavra específica (`transcript_words.position`). Se a Fonte for retranscrita (mudança de Motor/idioma), `stage_remap` salva esses overrides pendentes e `finish_remap` tenta reassociar cada palavra por texto normalizado (NFKC minúsculo) dentro de uma janela de **±300 ms** quando há correspondência única; palavras ambíguas ou perdidas são descartadas e contadas em `captions.remap_status`.
- **Faixas de legenda (`captions.track.set`):** alterna entre `auto`, `original`, `translated` (quando existe tradução) e `narration` (exclusiva de Vídeo transformado, mesclando palavras alinhadas da Narração nos blocos ativos com palavras originais da Fonte fora deles, sem sobreposição).

### Biblioteca de áudio, trilha sonora e efeitos sonoros

- **Importação e licença (`audio.*`):** como o app não embute músicas (ADR-0003), `audio.import` valida arquivos locais até **500 MiB** (WAV PCM via leitura de cabeçalho ou outros formatos via `ffprobe`), calcula SHA-256, deduplica e copia para `<projeto>/audio/<sha256>.<ext>`. Cada item registra `license_kind` (`unknown`, `youtube_audio_library`, `cc0`, `cc_by`, `purchased`, `original`) e `license_attribution` (obrigatória para `cc_by`, usada automaticamente na descrição do Empacotamento; `unknown` dispara aviso no checklist pré-export).
- **Mixagem no Corte (`editor.audio.*`):** cada Corte aceita **1 trilha sonora** (volume padrão 30%, início, fade-in/fade-out, `loop_to_fit`) e múltiplos **efeitos sonoros (SFX)** (volume padrão 80%) ancorados em um instante fixo da Fonte (`moment`) ou em uma palavra ativa da Transcrição original ou da Narração alinhada (`word`). Para não bombear com o som de jogos, a trilha sonora não usa sidechain no áudio bruto da Fonte: ela recebe automação de volume de **-12 dB** sobre `speechIntervals` (intervalos de fala das Frases e da Narração alinhada, unidos quando separados por ≤ 300 ms). No export, o áudio passa por limpeza da Narração (`highpass` + `afftdn`), `sidechaincompress` da Fonte pela Narração, automação da trilha, `amix` e `loudnorm` em duas passagens (-14 LUFS / -1 dBTP).

---

## Fluxo típico

1. **Abrir o editor:** a UI chama `editor.open` (`source_id`, `start_id`, `end_id`, `candidate_id?`) → recebe `clipId`, bordas, `silences`, `crop`, `montage`, `audioMix`, janela do proxy (`windowStartUs..windowEndUs`), `fps` e `sourceAspect`.
2. **Carregar contexto da timeline e legendas:**
   - Em paralelo, a UI pagina as Frases visíveis na janela com `editor.sentences`;
   - Solicita o proxy (`proxy.request` / `proxy.status`, de outro domínio) e, quando pronto, chama `editor.timeline` → acompanha com `editor.timeline_status` até `state: "ready"` → busca a onda com `editor.wave`;
   - Carrega os blocos preparados de legenda (`export.captions`, do domínio de exportação) e consulta `captions.remap_status` para exibir eventual aviso de estilos de palavra descartados após retranscrição.
3. **Editar bordas e silêncios:**
   - Durante o arrasto das alças, a UI chama `editor.adjust` com `preview: true`; ao soltar, confirma com `preview: false` (e busca `editor.sentences` novamente se o Corte sair da janela inicial do proxy);
   - No painel de silêncios, ajusta o limite chamando `editor.silences.detect` (`preview: true` no slide, `preview: false` ao soltar) e ativa/reverte trechos com `editor.silences.toggle`, `editor.silences.revert_all` ou `editor.silences.apply_all`.
4. **Reenquadrar em 9:16:**
   - Escolhe o layout em `editor.crop.set_layout` (`preview: true` ao arrastar o divisor `split_ratio`);
   - Para `face`, `gameplay_webcam` ou `two_people`, pode rodar o automático com `reframe.start` → faz polling em `reframe.status` até `completed` (ou cancela via `jobs.cancel`) → aplica a sugestão com `editor.crop.set_suggested`;
   - Ajusta manualmente o retângulo/zoom no quadro criando/editando keyframes com `editor.crop.set_edits`.
5. **Ajustar legendas, montagem e áudio:**
   - Altera faixa (`captions.track.set`), preset (`captions.style.preset`), estilo (`captions.style.set`), padrão do Projeto (`captions.style.default`) ou destaque por palavra (`captions.override`);
   - Em Vídeo transformado, arrasta blocos da Narração na timeline com `editor.montage.set_start`;
   - Gerencia áudios locais (`audio.list`, `audio.import`, `audio.license.set`, `audio.delete`) e configura trilha e SFX do Corte (`editor.audio.soundtrack.set`/`.clear`, `editor.audio.sfx.add`/`.update`/`.remove`, `editor.audio.get`).
6. **Desfazer, refazer e salvar:** `Ctrl+Z` / `Ctrl+Shift+Z` chamam `editor.undo` / `editor.redo`. O autosave salva em 1 s em segundo plano; ao fechar o editor (ou a janela do app), `editor.flush` garante a persistência imediata.
7. **Caminhos alternativos e falhas:**
   - Se `editor.timeline` retornar erro `proxy_not_ready`, a UI aguarda e tenta novamente após o proxy concluir;
   - Se o usuário cancelar o job de timeline ou reenquadramento via `jobs.cancel`, o estado volta a `cancelled` e pode ser reiniciado;
   - Se `captions.style.set` ou `captions.style.preset` retornar `caption_style_conflict`, a UI precisa recarregar `export.captions` ou `captions.style.get` para obter a nova `revision`;
   - Se `editor.flush` falhar ao fechar a janela, o fechamento é impedido e o evento `editor_save_failed` é emitido para o usuário tentar novamente.

---

## Comandos

### `editor.open`
- **O que faz:** Abre (ou reabre) a sessão de edição de um Corte no núcleo, criando seu registro em `clip_edits` se não existir e devolvendo todo o estado inicial e os parâmetros do proxy.
- **Entrada:**
  - `source_id: number` (obrigatório) — ID da Fonte.
  - `start_id: number` (obrigatório) — ID da Frase inicial.
  - `end_id: number` (obrigatório) — ID da Frase final.
  - `candidate_id: number | null` (opcional) — ID do candidato aprovado quando o Corte veio da seleção.
- **Saída:** `{ clipId, schemaVersion, revision, request: { source_id, candidate_id?, start_id, end_id }, startUs, endUs, undoCount, redoCount, silences: { enabled, thresholdUs, intervals, segments, removedUs, effectiveDurationUs }, crop, montage, audioMix, windowStartUs, windowEndUs, fps, sourceAspect }`.
- **Erros:** `project_not_open`, `project_busy`, `invalid_source`, `unknown_sentence_id`, `candidate_not_found`, `source_missing`, `transcript_missing`, `adjust_empty`, `adjust_too_short`, `adjust_too_long`, `source_not_found`, `invalid_range`, `clip_too_long`, `invalid_clip`, `project_read`, `project_write`.
- **Eventos e jobs:** síncrono; na primeira abertura no processo, inicia a thread interna de autosave em segundo plano (que posteriormente pode emitir `editor:<id>` / `editor_saved` ou `editor` / `editor_save_failed` em `core-progress`).
- **Pré-condições:** Projeto aberto; Fonte importada e encontrada; Transcrição segmentada em Frases; se `candidate_id` for informado, candidato válido pertencente à Fonte.
- **Tela hoje:** `src/features/editor/Editor.tsx`.
- **Mock TS:** sim, `src/lib/editorEditsMock.ts`.
- **US (#26):** US-68, US-70, US-71.
- **Código:** `core/src/editor.rs:279`

### `editor.range`
- **O que faz:** Valida um pedido de Corte (Fonte, Frases inicial/final e candidato opcional) e devolve suas bordas convertidas em microssegundos, sem abrir nem criar sessão de edição.
- **Entrada:**
  - `source_id: number` (obrigatório) — ID da Fonte.
  - `start_id: number` (obrigatório) — ID da Frase inicial.
  - `end_id: number` (obrigatório) — ID da Frase final.
  - `candidate_id: number | null` (opcional) — ID do candidato da seleção.
- **Saída:** `{ request: { source_id, start_id, end_id, candidate_id? }, startUs, endUs }`.
- **Erros:** `project_not_open`, `project_busy`, `invalid_source`, `unknown_sentence_id`, `candidate_not_found`, `source_missing`, `transcript_missing`, `adjust_empty`, `adjust_too_short`, `adjust_too_long`, `project_read`.
- **Eventos e jobs:** nenhum.
- **Pré-condições:** Projeto aberto; Transcrição da Fonte segmentada em Frases.
- **Tela hoje:** nenhuma (sem uso na UI).
- **Mock TS:** sim, `src/lib/core.ts`.
- **US (#26):** US-63, US-72.
- **Código:** `core/src/editor.rs:280`

### `editor.sentences`
- **O que faz:** Lista paginada de Frases inteiras dentro da janela de tempo do editor, já com eventuais correções manuais de palavras aplicadas.
- **Entrada:**
  - `source_id: number` (obrigatório) — ID da Fonte.
  - `start_us: number` (obrigatório) — início do intervalo em µs.
  - `end_us: number` (obrigatório) — fim do intervalo em µs (duração máxima limitada ao tamanho máximo da janela de proxy: `600 s + 2 × 120 s`).
  - `after_id: number` (opcional, padrão `0`) — cursor de paginação pelo último `id` retornado.
  - `limit: number` (opcional, padrão e máximo `200`) — limite de Frases por página (clampado em `1..=200`).
- **Saída:** Array de `{ id, startUs, endUs, text }` ordenado por `id` crescente.
- **Erros:** `invalid_range`, `source_missing`, `transcript_missing`, `project_not_open`, `project_busy`, `project_read`.
- **Eventos e jobs:** nenhum.
- **Pré-condições:** Projeto aberto; Transcrição da Fonte segmentada em Frases.
- **Tela hoje:** `src/features/editor/Editor.tsx`.
- **Mock TS:** sim, `src/lib/core.ts`.
- **US (#26):** US-71, US-72.
- **Código:** `core/src/editor.rs:281`

### `editor.timeline`
- **O que faz:** Consulta o estado das miniaturas e da forma de onda da timeline de um Corte e enfileira a geração em segundo plano caso ainda não existam ou tenham falhado/sido canceladas.
- **Entrada:**
  - `source_id: number` (obrigatório) — ID da Fonte.
  - `start_us: number` (obrigatório) — início do Corte em µs.
  - `end_us: number` (obrigatório) — fim do Corte em µs.
- **Saída:** `{ state: "ready" | "queued" | "running" | "failed" | "cancelled" | "missing", key, job: number | null, progress, error: string | null, thumbs: { id, count, intervalUs, width, height, columns } | null, windowStartUs, windowEndUs }`.
- **Erros:** `invalid_source`, `invalid_range`, `invalid_project`, `source_not_found`, `source_offline`, `source_changed`, `proxy_failed`, `clip_too_long`, `settings`, `proxy_not_ready`, `project_not_open`, `project_busy`, `project_read`, `project_write`.
- **Eventos e jobs:** enfileira o job local `timeline` na fila do Projeto (cancelável por `jobs.cancel`). O worker da fila emite eventos `core-progress` com `job: "<id>"`, `stage: "timeline"` (2% ao iniciar onda, 40% após onda) e `complete`/`failed`.
- **Pré-condições:** Projeto aberto; Fonte online e com hash íntegro; arquivo de proxy já gerado e pronto para a janela do Corte (`proxy_not_ready` se não estiver); Componente FFmpeg instalado para a execução do job.
- **Tela hoje:** `src/features/editor/Editor.tsx`.
- **Mock TS:** sim, `src/lib/core.ts`.
- **US (#26):** US-51, US-70, US-71.
- **Código:** `core/src/editor/assets.rs:191`

### `editor.timeline_status`
- **O que faz:** Consulta o progresso e o estado atual do job de geração de miniaturas e onda da timeline pela chave de cache do proxy.
- **Entrada:**
  - `key: string` (obrigatório) — hash hexadecimal de 64 caracteres retornado por `editor.timeline` ou `proxy.request`.
  - `window_us: number` (opcional, padrão `0`) — duração da janela em µs para calcular `thumbs.count` quando pronto.
- **Saída:** `{ state: "ready" | "queued" | "running" | "failed" | "cancelled" | "missing", key, job: number | null, progress, error: string | null, thumbs: { id, count, intervalUs, width, height, columns } | null }`.
- **Erros:** `invalid_key`, `settings`, `project_not_open`, `project_busy`, `project_read`.
- **Eventos e jobs:** nenhum (consulta síncrona de um job já existente).
- **Pré-condições:** Projeto aberto; chave válida gerada por `editor.timeline`.
- **Tela hoje:** `src/features/editor/Editor.tsx`.
- **Mock TS:** sim, `src/lib/core.ts`.
- **US (#26):** US-51, US-71.
- **Código:** `core/src/editor/assets.rs:192`

### `editor.wave`
- **O que faz:** Devolve a série numérica da forma de onda de áudio da timeline (1 byte de 0 a 255 por bloco de 100 ms do proxy).
- **Entrada:**
  - `key: string` (obrigatório) — chave hexadecimal de 64 caracteres do proxy/timeline.
- **Saída:** `{ blockUs: 100000, values: number[] }`.
- **Erros:** `invalid_key`, `settings`, `timeline_missing`.
- **Eventos e jobs:** nenhum.
- **Pré-condições:** Timeline do Corte já gerada (`editor.timeline` com `state: "ready"`).
- **Tela hoje:** `src/features/editor/Editor.tsx`.
- **Mock TS:** sim, `src/lib/core.ts`.
- **US (#26):** US-71.
- **Código:** `core/src/editor/assets.rs:193`

### `editor.adjust`
- **O que faz:** Move a borda inicial ou final do Corte por Frase inteira, por delta de ±1 Frase, por tempo com encaixe na borda de Frase mais próxima ou por quadro livre (`free: true`). Recorta automaticamente silêncios que saírem das novas bordas.
- **Entrada:**
  - `clip_id: number` (obrigatório) — ID do Corte aberto.
  - `edge: "start" | "end"` (obrigatório) — qual borda ajustar.
  - `sentence_delta: -1 | 1` (opcional) — desloca a borda em 1 Frase anterior ou seguinte.
  - `sentence_id: number` (opcional) — fixa a borda no início (`start`) ou fim (`end`) da Frase informada.
  - `time_us: number` (opcional, obrigatório se não houver `sentence_delta` nem `sentence_id`) — tempo alvo em µs.
  - `free: boolean` (opcional, padrão `false`) — se `true`, encaixa no quadro da Fonte mais próximo; se `false`, encaixa na borda de Frase mais próxima.
  - `preview: boolean` (opcional, padrão `false`) — se `true`, simula sem gravar `undo` nem marcar `dirty`.
- **Saída:** objeto completo de resposta do editor (mesma estrutura base de `editor.open`, sem `windowStartUs`/`windowEndUs`/`fps`/`sourceAspect`).
- **Erros:** `invalid_clip`, `unknown_sentence_id`, `source_missing`, `transcript_missing`, `source_not_found`, `invalid_range`, `adjust_empty`, `adjust_too_short`, `adjust_too_long`, `candidate_not_found`, `project_not_open`, `project_busy`, `project_read`.
- **Eventos e jobs:** nenhum (marca `dirty` para autosave posterior quando `preview: false` e há mudança).
- **Pré-condições:** Projeto aberto; Corte aberto/existente em `clip_edits`; Transcrição segmentada em Frases.
- **Tela hoje:** `src/features/editor/Editor.tsx`, `src/features/editor/BorderHandles.tsx`.
- **Mock TS:** sim, `src/lib/editorEditsMock.ts`.
- **US (#26):** US-63, US-72, US-73, US-75.
- **Código:** `core/src/editor/edits.rs:1711`

### `editor.undo`
- **O que faz:** Desfaz a última edição confirmada do Corte (bordas, silêncios, layout/edições de crop, inícios de Narração, trilha ou SFX), movendo o estado atual para a pilha `redo`.
- **Entrada:**
  - `clip_id: number` (obrigatório) — ID do Corte.
- **Saída:** objeto completo de resposta do editor com o estado restaurado e os novos `undoCount`/`redoCount`.
- **Erros:** `invalid_clip`, `invalid_range`, `adjust_empty`, `adjust_too_short`, `adjust_too_long`, `invalid_crop`, `invalid_audio_mix`, `source_not_found`, `candidate_not_found`, `project_not_open`, `project_busy`, `project_read`.
- **Eventos e jobs:** nenhum (marca `dirty` quando há item no `undo`).
- **Pré-condições:** Projeto aberto; Corte existente em `clip_edits`.
- **Tela hoje:** `src/features/editor/Editor.tsx`.
- **Mock TS:** sim, `src/lib/editorEditsMock.ts`.
- **US (#26):** US-40.
- **Código:** `core/src/editor/edits.rs:1712`

### `editor.redo`
- **O que faz:** Refaz a última edição desfeita por `editor.undo`, movendo o estado atual de volta para a pilha `undo`.
- **Entrada:**
  - `clip_id: number` (obrigatório) — ID do Corte.
- **Saída:** objeto completo de resposta do editor com o estado reaplicado e os novos `undoCount`/`redoCount`.
- **Erros:** `invalid_clip`, `invalid_range`, `adjust_empty`, `adjust_too_short`, `adjust_too_long`, `invalid_crop`, `invalid_audio_mix`, `source_not_found`, `candidate_not_found`, `project_not_open`, `project_busy`, `project_read`.
- **Eventos e jobs:** nenhum (marca `dirty` quando há item no `redo`).
- **Pré-condições:** Projeto aberto; Corte existente em `clip_edits`.
- **Tela hoje:** `src/features/editor/Editor.tsx`.
- **Mock TS:** sim, `src/lib/editorEditsMock.ts`.
- **US (#26):** US-40.
- **Código:** `core/src/editor/edits.rs:1713`

### `editor.flush`
- **O que faz:** Grava imediatamente no SQLite do Projeto todos os Cortes com edições pendentes (`dirty`) em memória e registra um snapshot para cada um deles.
- **Entrada:** nenhuma (`{}`).
- **Saída:** `null`.
- **Erros:** `invalid_clip` (lock corrompido), `project_not_open`, `project_busy`, `project_read`, `project_write` (só se houver Cortes sujos para gravar).
- **Eventos e jobs:** síncrono; para cada Corte gravado, emite `core-progress` com `job: "editor:<clip_id>"`, `stage: "editor_saved"`, `percentage: 100`. Também é disparado pelo backend Tauri ao fechar a janela (`src-tauri/src/main.rs`), emitindo `editor_save_failed` caso falhe.
- **Pré-condições:** Se houver edições sujas em memória, o Projeto precisa estar aberto e gravável.
- **Tela hoje:** `src/features/editor/Editor.tsx` (e `src-tauri/src/main.rs` no fechamento da janela).
- **Mock TS:** sim, `src/lib/editorEditsMock.ts`.
- **US (#26):** US-39.
- **Código:** `core/src/editor/edits.rs:1714`

### `editor.snapshots`
- **O que faz:** Lista os últimos até 20 snapshots persistidos no SQLite (`clip_snapshots`) para um Corte, ordenados do mais recente ao mais antigo.
- **Entrada:**
  - `clip_id: number` (obrigatório) — ID do Corte.
- **Saída:** array de objetos `Document` completos (incluindo `schemaVersion`, `revision`, `original`, `range`, `silences`, `undo`, `redo`, `crop`, `narrationStarts`, `soundtrack`, `sfx`).
- **Erros:** `invalid_clip`, `invalid_range`, `adjust_empty`, `adjust_too_short`, `adjust_too_long`, `invalid_crop`, `invalid_audio_mix`, `project_not_open`, `project_busy`, `project_read`.
- **Eventos e jobs:** nenhum.
- **Pré-condições:** Projeto aberto; Corte existente em `clip_edits`.
- **Tela hoje:** nenhuma (sem uso na UI).
- **Mock TS:** não (chamar no modo `VITE_CORE_MOCK=1` lança `Unknown core command: editor.snapshots`).
- **US (#26):** US-39.
- **Código:** `core/src/editor/edits.rs:1715`

### `editor.silences.detect`
- **O que faz:** Detecta pausas entre palavras da Transcrição dentro do Corte acima de `threshold_us`, refina os cortes para o vale local de amplitude (±20 ms) quando a Fonte e o FFmpeg estão acessíveis, e atualiza a lista de silêncios ativos.
- **Entrada:**
  - `clip_id: number` (obrigatório) — ID do Corte.
  - `threshold_us: number` (opcional, padrão anterior do Corte ou `600_000` µs) — limite mínimo de pausa em µs (`300_000..=2_000_000`).
  - `preview: boolean` (opcional, padrão `false`) — se `true`, calcula sem persistir nem empilhar no `undo`.
- **Saída:** objeto completo de resposta do editor com `silences` atualizado (`intervals`, `segments` do `SpliceMap`, `removedUs`, `effectiveDurationUs`).
- **Erros:** `invalid_clip`, `source_missing`, `transcript_missing`, `invalid_range`, `invalid_silence_threshold`, `project_not_open`, `project_busy`, `project_read`.
- **Eventos e jobs:** nenhum (executa FFmpeg de forma síncrona apenas se o PCM do Corte ainda não estiver em cache em memória; se a Fonte estiver offline ou sem FFmpeg, cai silenciosamente para os tempos nominais).
- **Pré-condições:** Projeto aberto; Corte existente; Transcrição com palavras gravadas.
- **Tela hoje:** `src/features/editor/Editor.tsx`, `src/features/editor/SilencesPanel.tsx`.
- **Mock TS:** sim, `src/lib/editorEditsMock.ts`.
- **US (#26):** US-76.
- **Código:** `core/src/editor/edits.rs:1716`

### `editor.silences.toggle`
- **O que faz:** Alterna (ou define explicitamente) o estado `active`/`reverted` de um trecho de silêncio detectado no Corte.
- **Entrada:**
  - `clip_id: number` (obrigatório) — ID do Corte.
  - `id: number` (obrigatório) — ID do intervalo de silêncio dentro de `silences.intervals`.
  - `status: "active" | "reverted"` (opcional) — força um estado específico; se omitido, inverte o estado atual.
- **Saída:** objeto completo de resposta do editor com `silences` e `montage`/`audioMix` recalculados.
- **Erros:** `invalid_clip`, `invalid_silence_interval`, `invalid_silence_status`, `project_not_open`, `project_busy`, `project_read`.
- **Eventos e jobs:** nenhum.
- **Pré-condições:** Projeto aberto; Corte com silêncios já detectados (`editor.silences.detect`).
- **Tela hoje:** `src/features/editor/Editor.tsx`, `src/features/editor/SilencesPanel.tsx`.
- **Mock TS:** sim, `src/lib/editorEditsMock.ts`.
- **US (#26):** US-76.
- **Código:** `core/src/editor/edits.rs:1717`

### `editor.silences.revert_all`
- **O que faz:** Marca todos os intervalos de silêncio detectados no Corte como `reverted` (restaurando a duração original sem remover nenhuma pausa).
- **Entrada:**
  - `clip_id: number` (obrigatório) — ID do Corte.
- **Saída:** objeto completo de resposta do editor.
- **Erros:** `invalid_clip`, `project_not_open`, `project_busy`, `project_read`.
- **Eventos e jobs:** nenhum.
- **Pré-condições:** Projeto aberto; Corte existente em `clip_edits`.
- **Tela hoje:** `src/features/editor/Editor.tsx`, `src/features/editor/SilencesPanel.tsx`.
- **Mock TS:** sim, `src/lib/editorEditsMock.ts`.
- **US (#26):** US-76.
- **Código:** `core/src/editor/edits.rs:1718`

### `editor.silences.apply_all`
- **O que faz:** Marca todos os intervalos de silêncio detectados no Corte como `active` (reaplicando todas as remoções de pausa).
- **Entrada:**
  - `clip_id: number` (obrigatório) — ID do Corte.
- **Saída:** objeto completo de resposta do editor.
- **Erros:** `invalid_clip`, `project_not_open`, `project_busy`, `project_read`.
- **Eventos e jobs:** nenhum.
- **Pré-condições:** Projeto aberto; Corte existente em `clip_edits`.
- **Tela hoje:** `src/features/editor/Editor.tsx`, `src/features/editor/SilencesPanel.tsx`.
- **Mock TS:** sim, `src/lib/editorEditsMock.ts`.
- **US (#26):** US-76.
- **Código:** `core/src/editor/edits.rs:1719`

### `editor.crop.get`
- **O que faz:** Devolve o estado atual de enquadramento do Corte, incluindo o plano resolvido dos painéis para o layout ativo.
- **Entrada:**
  - `clip_id: number` (obrigatório) — ID do Corte.
- **Saída:** `{ clipId, schemaVersion, revision, undoCount, redoCount, layout, explicitLayout, splitRatio, suggested, edits, gameplayWebcam, twoPeople, resolved, hasCrop, plan }`.
- **Erros:** `invalid_clip`, `project_not_open`, `project_busy`, `project_read`.
- **Eventos e jobs:** nenhum.
- **Pré-condições:** Projeto aberto; Corte existente em `clip_edits`.
- **Tela hoje:** nenhuma diretamente (a UI recebe `crop` no retorno de `editor.open` e nos demais comandos `editor.crop.*`).
- **Mock TS:** sim, `src/lib/editorEditsMock.ts`.
- **US (#26):** US-82, US-84, US-85.
- **Código:** `core/src/editor/edits.rs:1720`

### `editor.crop.set_layout`
- **O que faz:** Define o layout de enquadramento 9:16 do Corte e, nos layouts duplos (`gameplay_webcam` e `two_people`), a proporção da divisão vertical entre o painel superior e o inferior.
- **Entrada:**
  - `clip_id: number` (obrigatório) — ID do Corte.
  - `layout: "fit" | "face" | "gameplay_webcam" | "two_people" | "fullscreen_roi"` (obrigatório).
  - `split_ratio` ou `splitRatio: number | null` (opcional) — obrigatório omitir/nulo para layouts simples; para `gameplay_webcam` aceita `0.20..=0.50` (padrão `0.30`); para `two_people` aceita `0.30..=0.70` (padrão `0.50`).
  - `preview: boolean` (opcional, padrão `false`) — se `true`, simula sem gravar no `undo`.
- **Saída:** mesmo formato de `editor.crop.get`.
- **Erros:** `invalid_clip`, `invalid_crop`, `project_not_open`, `project_busy`, `project_read`.
- **Eventos e jobs:** nenhum.
- **Pré-condições:** Projeto aberto; Corte existente em `clip_edits`.
- **Tela hoje:** `src/features/editor/Editor.tsx`, `src/features/editor/CropPanel.tsx`.
- **Mock TS:** sim, `src/lib/editorEditsMock.ts`.
- **US (#26):** US-82, US-83.
- **Código:** `core/src/editor/edits.rs:1721`

### `editor.crop.set_suggested`
- **O que faz:** Grava uma sugestão automática de enquadramento no Corte — carregando o resultado de uma análise `reframe` concluída (`reframe_id`) ou recebendo o documento `suggested` diretamente — sem apagar os keyframes manuais em `edits`.
- **Entrada:**
  - `clip_id: number` (obrigatório) — ID do Corte.
  - `reframe_id: number` (opcional) — ID de um registro concluído em `reframe_suggestions` da mesma Fonte (preenche também `layout`, `splitRatio` e ambos os painéis em `gameplay_webcam`/`two_people`).
  - `suggested: SuggestedCrop | null` (opcional, usado quando `reframe_id` é omitido) — timeline sugerida ou `null` para limpar.
- **Saída:** mesmo formato de `editor.crop.get`.
- **Erros:** `invalid_clip`, `invalid_crop`, `project_not_open`, `project_busy`, `project_read`.
- **Eventos e jobs:** nenhum (não entra na pilha de `undo`; apenas incrementa `revision` e marca `dirty`).
- **Pré-condições:** Projeto aberto; Corte existente; se usar `reframe_id`, análise já finalizada para a mesma Fonte.
- **Tela hoje:** `src/features/editor/CropPanel.tsx`.
- **Mock TS:** sim, `src/lib/editorEditsMock.ts`.
- **US (#26):** US-81, US-83, US-85.
- **Código:** `core/src/editor/edits.rs:1722`

### `editor.crop.set_edits`
- **O que faz:** Substitui a lista de keyframes manuais (`edits`) do painel principal ou de um subpainel (`top`/`bottom`) em layouts duplos, mantendo separada a sugestão automática.
- **Entrada:**
  - `clip_id: number` (obrigatório) — ID do Corte.
  - `edits: CropKeyframe[]` (obrigatório) — keyframes ordenados por `timeUs` estritamente crescente (`{ timeUs, x, y, width, height, confidence?, cut? }` com coordenadas normalizadas em `0..=1`).
  - `panel: "primary" | "top" | "bottom"` (opcional, padrão `"primary"`) — painel alvo.
  - `layout: "gameplay_webcam" | "two_people"` (opcional) — usado com `panel: "top" | "bottom"` quando o layout duplo ainda não é o ativo no documento.
  - `preview: boolean` (opcional, padrão `false`) — se `true`, simula sem gravar no `undo`.
- **Saída:** mesmo formato de `editor.crop.get`.
- **Erros:** `invalid_clip`, `invalid_crop`, `project_not_open`, `project_busy`, `project_read`.
- **Eventos e jobs:** nenhum.
- **Pré-condições:** Projeto aberto; Corte existente; quando `panel` é `"top"` ou `"bottom"`, o layout efetivo ou informado deve ser `gameplay_webcam` ou `two_people`.
- **Tela hoje:** `src/features/editor/Editor.tsx`, `src/features/editor/CropPanel.tsx`.
- **Mock TS:** sim, `src/lib/editorEditsMock.ts`.
- **US (#26):** US-83, US-84, US-85, US-86.
- **Código:** `core/src/editor/edits.rs:1723`

### `editor.crop.evaluate`
- **O que faz:** Avalia no núcleo qual é o retângulo (ou retângulos dos dois painéis) interpolado exatamente para um instante `time_us` da Fonte.
- **Entrada:**
  - `clip_id: number` (obrigatório) — ID do Corte.
  - `time_us: number` (obrigatório) — instante na Fonte em µs.
- **Saída:** `{ clipId, timeUs, rect: CropRect | null, panels: [{ targetWidth, targetHeight, fitMode, rect }] }`.
- **Erros:** `invalid_clip`, `invalid_crop`, `project_not_open`, `project_busy`, `project_read`.
- **Eventos e jobs:** nenhum.
- **Pré-condições:** Projeto aberto; Corte existente em `clip_edits`.
- **Tela hoje:** nenhuma (sem uso na UI; a UI avalia localmente via `cropMath.ts`).
- **Mock TS:** sim, `src/lib/editorEditsMock.ts`.
- **US (#26):** US-81, US-84.
- **Código:** `core/src/editor/edits.rs:1724`

### `editor.crop.example`
- **O que faz:** Preenche `crop.suggested` do Corte com uma timeline de exemplo determinística (dois segmentos com corte seco no meio para Cortes ≥ 2 s), útil para testes sem worker Python.
- **Entrada:**
  - `clip_id: number` (obrigatório) — ID do Corte.
  - `aspect: number` (opcional, padrão `16/9`) — razão de aspecto da Fonte (`0.1..=10.0`).
- **Saída:** mesmo formato de `editor.crop.get`.
- **Erros:** `invalid_clip`, `invalid_crop`, `project_not_open`, `project_busy`, `project_read`.
- **Eventos e jobs:** nenhum (não empilha no `undo`).
- **Pré-condições:** Projeto aberto; Corte existente em `clip_edits`.
- **Tela hoje:** nenhuma (sem uso na UI).
- **Mock TS:** sim, `src/lib/editorEditsMock.ts`.
- **US (#26):** nenhuma encontrada (utilitário de teste/demonstração).
- **Código:** `core/src/editor/edits.rs:1725`

### `editor.montage.get`
- **O que faz:** Devolve o plano resolvido da montagem de blocos de Narração sobre o Corte (tempos automáticos/manuais, empurrões e congelamento final), ou `null` quando o Corte não é um Vídeo transformado com Roteiro.
- **Entrada:**
  - `clip_id: number` (obrigatório) — ID do Corte.
- **Saída:** `{ clipId, schemaVersion, revision, undoCount, redoCount, montage: MontagePlan | null }` (com `blocks`, `clipDurationUs`, `narrationEndUs`, `freezeTailUs`, `totalDurationUs`, `totalPushedUs`, `usesEstimatedDurations`, `scriptApproved`, `warnings`).
- **Erros:** `invalid_clip`, `project_not_open`, `project_busy`, `project_read`.
- **Eventos e jobs:** nenhum.
- **Pré-condições:** Projeto aberto; Corte existente em `clip_edits`.
- **Tela hoje:** nenhuma diretamente (a UI recebe `montage` via `editor.open` e demais mutações do editor).
- **Mock TS:** sim, `src/lib/editorEditsMock.ts` (chamado também pelo mock de `guardrails.check` em `src/lib/core.ts`).
- **US (#26):** US-88, US-95, US-96.
- **Código:** `core/src/editor/edits.rs:1726`

### `editor.montage.set_start`
- **O que faz:** Define ou limpa (`time_us: null`) o início manual de um bloco de Narração na timeline da montagem, impedindo sobreposição com o bloco anterior (respiro mínimo de 300 ms) e encaixando por padrão na Frase mais próxima (ou por quadro com `free: true`).
- **Entrada:**
  - `clip_id: number` (obrigatório) — ID do Corte.
  - `block_id: number` (obrigatório) — ID do bloco do Roteiro.
  - `time_us: number | null` (opcional) — início desejado em µs da Fonte; se ausente ou `null`, remove o início manual e volta ao modo automático.
  - `free: boolean` (opcional, padrão `false`) — encaixe por quadro da Fonte (`true`) ou por início de Frase dentro do Corte (`false`).
  - `preview: boolean` (opcional, padrão `false`) — se `true`, simula sem gravar no `undo`.
- **Saída:** objeto completo de resposta do editor com `montage` e `audioMix` recalculados.
- **Erros:** `invalid_clip`, `block_not_found`, `invalid_montage`, `source_not_found`, `project_not_open`, `project_busy`, `project_read`.
- **Eventos e jobs:** nenhum.
- **Pré-condições:** Projeto aberto; Corte vinculado a um candidato de Vídeo transformado com Roteiro gerado.
- **Tela hoje:** `src/features/editor/Editor.tsx`, `src/features/editor/NarrationTrack.tsx`.
- **Mock TS:** sim, `src/lib/editorEditsMock.ts`.
- **US (#26):** US-88, US-95, US-96.
- **Código:** `core/src/editor/edits.rs:1727`

### `editor.audio.get`
- **O que faz:** Devolve o estado resolvido de mixagem de trilha sonora, efeitos sonoros (SFX) e intervalos de fala (para ducking) do Corte.
- **Entrada:**
  - `clip_id: number` (obrigatório) — ID do Corte.
- **Saída:** `{ clipId, schemaVersion, revision, undoCount, redoCount, audioMix: { soundtrack, sfx, speechIntervals, totalDurationUs, unverifiedCount, warnings } | null }`.
- **Erros:** `invalid_clip`, `project_not_open`, `project_busy`, `project_read`.
- **Eventos e jobs:** nenhum.
- **Pré-condições:** Projeto aberto; Corte existente em `clip_edits`.
- **Tela hoje:** `src/features/editor/Editor.tsx`.
- **Mock TS:** sim, `src/lib/editorEditsMock.ts`.
- **US (#26):** US-104, US-129.
- **Código:** `core/src/editor/edits.rs:1728`

### `editor.audio.soundtrack.set`
- **O que faz:** Define a trilha sonora do Corte (ou atualiza seus parâmetros de início, volume, fades e loop) usando um áudio importado do tipo `music`.
- **Entrada:**
  - `clip_id: number` (obrigatório) — ID do Corte.
  - `asset_id: number | null` (opcional) — ID do asset `music`; se `null`, remove a trilha; se omitido, altera os parâmetros da trilha já associada ao Corte.
  - `start_us: number` (opcional, padrão `0` ou valor anterior) — atraso de início no vídeo final em µs (`>= 0`).
  - `volume: number` (opcional, padrão `0.30` ou valor anterior) — ganho linear (`0.0..=1.0`).
  - `fade_in_us: number` (opcional, padrão `0` ou valor anterior) — duração do fade de entrada em µs (`>= 0`).
  - `fade_out_us: number` (opcional, padrão `0` ou valor anterior) — duração do fade de saída em µs (`>= 0`).
  - `loop_to_fit: boolean` (opcional, padrão `true` ou valor anterior) — repete ou corta a música para preencher o vídeo.
  - `preview: boolean` (opcional, padrão `false`) — se `true`, simula sem gravar no `undo`.
- **Saída:** objeto completo de resposta do editor com `audioMix` atualizado.
- **Erros:** `invalid_clip`, `audio_asset_missing`, `invalid_audio_kind`, `invalid_audio_mix`, `project_not_open`, `project_busy`, `project_read`.
- **Eventos e jobs:** nenhum.
- **Pré-condições:** Projeto aberto; Corte existente; asset `music` importado e presente na pasta `audio/` do Projeto (quando `asset_id` não for `null`).
- **Tela hoje:** `src/features/editor/Editor.tsx`, `src/features/editor/AudioPanel.tsx`.
- **Mock TS:** sim, `src/lib/editorEditsMock.ts`.
- **US (#26):** US-129.
- **Código:** `core/src/editor/edits.rs:1729`

### `editor.audio.soundtrack.clear`
- **O que faz:** Remove a trilha sonora associada ao Corte.
- **Entrada:**
  - `clip_id: number` (obrigatório) — ID do Corte.
  - `preview: boolean` (opcional, padrão `false`) — se `true`, simula sem gravar no `undo`.
- **Saída:** objeto completo de resposta do editor com `audioMix.soundtrack = null`.
- **Erros:** `invalid_clip`, `project_not_open`, `project_busy`, `project_read`.
- **Eventos e jobs:** nenhum.
- **Pré-condições:** Projeto aberto; Corte existente em `clip_edits`.
- **Tela hoje:** `src/features/editor/Editor.tsx`, `src/features/editor/AudioPanel.tsx`.
- **Mock TS:** sim, `src/lib/editorEditsMock.ts`.
- **US (#26):** US-129.
- **Código:** `core/src/editor/edits.rs:1730`

### `editor.audio.sfx.add`
- **O que faz:** Adiciona um efeito sonoro (asset `sfx`) ao Corte, ancorado em um instante da Fonte ou em uma palavra ativa da Transcrição original/Narração.
- **Entrada:**
  - `clip_id: number` (obrigatório) — ID do Corte.
  - `asset_id: number` (obrigatório) — ID do asset `sfx`.
  - `anchor: object` (obrigatório) — `{ kind: "moment", source_us | sourceUs | time_us | timeUs }` ou `{ kind: "word", track?: "original" | "narration", position: number, block_id | blockId?: number, offset_us | offsetUs?: number }`.
  - `volume: number` (opcional, padrão `0.80`) — ganho (`0.0..=1.0`).
  - `fade_in_us: number` (opcional, padrão `0`) — fade de entrada em µs (`>= 0`).
  - `fade_out_us: number` (opcional, padrão `0`) — fade de saída em µs (`>= 0`).
  - `preview: boolean` (opcional, padrão `false`) — se `true`, simula sem gravar no `undo`.
- **Saída:** objeto completo de resposta do editor com o novo SFX em `audioMix.sfx`.
- **Erros:** `invalid_clip`, `audio_asset_missing`, `invalid_audio_kind`, `invalid_audio_mix`, `word_not_found`, `project_not_open`, `project_busy`, `project_read`.
- **Eventos e jobs:** nenhum.
- **Pré-condições:** Projeto aberto; Corte existente; asset `sfx` importado e presente no disco; quando ancorado em palavra, a palavra precisa estar ativa dentro do Corte (ou no alinhamento aprovado/alinhado do bloco de Narração).
- **Tela hoje:** `src/features/editor/Editor.tsx`, `src/features/editor/AudioPanel.tsx`.
- **Mock TS:** sim, `src/lib/editorEditsMock.ts`.
- **US (#26):** US-129.
- **Código:** `core/src/editor/edits.rs:1731`

### `editor.audio.sfx.update`
- **O que faz:** Atualiza a âncora (ou move na timeline por `time_us` com encaixe na palavra ativa mais próxima ou livre por quadro), o asset, o volume ou os fades de um efeito sonoro já adicionado ao Corte.
- **Entrada:**
  - `clip_id: number` (obrigatório) — ID do Corte.
  - `id: number` (obrigatório) — ID do SFX dentro de `doc.sfx`.
  - `asset_id: number` (opcional) — novo ID de asset `sfx`.
  - `anchor: object` (opcional) — nova âncora completa (`moment` ou `word`).
  - `time_us: number` (opcional, usado se `anchor` não for enviado) — move o SFX para esse instante da Fonte (encaixa na palavra ativa mais próxima quando `free: false`, ou no quadro mais próximo quando `free: true`).
  - `free: boolean` (opcional, padrão `false`).
  - `volume: number` (opcional) — novo volume (`0.0..=1.0`).
  - `fade_in_us: number` (opcional) — novo fade-in em µs.
  - `fade_out_us: number` (opcional) — novo fade-out em µs.
  - `preview: boolean` (opcional, padrão `false`).
- **Saída:** objeto completo de resposta do editor com `audioMix.sfx` atualizado.
- **Erros:** `invalid_clip`, `sfx_not_found`, `audio_asset_missing`, `invalid_audio_kind`, `invalid_audio_mix`, `word_not_found`, `source_not_found`, `project_not_open`, `project_busy`, `project_read`.
- **Eventos e jobs:** nenhum.
- **Pré-condições:** Projeto aberto; Corte existente contendo o SFX `id`.
- **Tela hoje:** `src/features/editor/Editor.tsx`, `src/features/editor/AudioPanel.tsx`, `src/features/editor/AudioTrack.tsx`.
- **Mock TS:** sim, `src/lib/editorEditsMock.ts`.
- **US (#26):** US-129.
- **Código:** `core/src/editor/edits.rs:1732`

### `editor.audio.sfx.remove`
- **O que faz:** Remove um efeito sonoro da lista de SFX do Corte.
- **Entrada:**
  - `clip_id: number` (obrigatório) — ID do Corte.
  - `id: number` (obrigatório) — ID do SFX no Corte.
  - `preview: boolean` (opcional, padrão `false`).
- **Saída:** objeto completo de resposta do editor sem o SFX removido.
- **Erros:** `invalid_clip`, `sfx_not_found`, `project_not_open`, `project_busy`, `project_read`.
- **Eventos e jobs:** nenhum.
- **Pré-condições:** Projeto aberto; Corte existente contendo o SFX `id`.
- **Tela hoje:** `src/features/editor/Editor.tsx`, `src/features/editor/AudioPanel.tsx`.
- **Mock TS:** sim, `src/lib/editorEditsMock.ts`.
- **US (#26):** US-129.
- **Código:** `core/src/editor/edits.rs:1733`

### `captions.override`
- **O que faz:** Grava ou remove (quando vazio) sobrescritas visuais individuais (cor, cor ativa, destaque karaokê, ocultação) para uma palavra específica da Transcrição.
- **Entrada:**
  - `transcript_id: number` (obrigatório, `> 0`) — ID da Transcrição.
  - `position: number` (obrigatório, `>= 0`) — posição da palavra em `transcript_words`.
  - `overrides: { color?: string, activeColor?: string, highlight?: boolean, hidden?: boolean }` (obrigatório; cores `#RRGGBB`, `{}` remove a sobrescrita).
- **Saída:** `{ position, overrides }`.
- **Erros:** `caption_style_invalid`, `word_missing`, `project_not_open`, `project_busy`, `project_write`.
- **Eventos e jobs:** nenhum.
- **Pré-condições:** Projeto aberto; Transcrição existente; palavra de tipo `'word'` naquela `position`.
- **Tela hoje:** `src/features/captions/CaptionPanel.tsx`.
- **Mock TS:** sim, `src/lib/captionsMock.ts`.
- **US (#26):** US-78, US-79.
- **Código:** `core/src/caption_style/store.rs:320`

### `captions.overrides`
- **O que faz:** Lista todas as sobrescritas visuais por palavra salvas para uma Transcrição.
- **Entrada:**
  - `transcript_id: number` (obrigatório, `> 0`) — ID da Transcrição.
- **Saída:** array de `{ position, overrides }` ordenado por `position`.
- **Erros:** `caption_style_invalid`, `project_not_open`, `project_busy`, `project_read`.
- **Eventos e jobs:** nenhum.
- **Pré-condições:** Projeto aberto.
- **Tela hoje:** nenhuma (a UI obtém as sobrescritas embutidas em `words` via `export.captions`).
- **Mock TS:** sim, `src/lib/captionsMock.ts`.
- **US (#26):** US-78.
- **Código:** `core/src/caption_style/store.rs:321`

### `captions.remap_status`
- **O que faz:** Informa quantas sobrescritas visuais de palavras foram descartadas ao tentar remapeá-las após uma nova Transcrição da mesma Fonte e faixa de áudio.
- **Entrada:**
  - `source_id: number` (obrigatório) — ID da Fonte.
- **Saída:** `{ discarded: number }`.
- **Erros:** `caption_style_invalid`, `project_not_open`, `project_busy`, `project_read`.
- **Eventos e jobs:** nenhum.
- **Pré-condições:** Projeto aberto.
- **Tela hoje:** `src/features/captions/CaptionPanel.tsx`.
- **Mock TS:** sim, `src/lib/captionsMock.ts`.
- **US (#26):** US-54, US-78.
- **Código:** `core/src/caption_style/store.rs:322`

### `captions.style.get`
- **O que faz:** Retorna o documento de estilo de legenda do Corte, criando-o preguiçosamente a partir do padrão do Projeto (`caption_style_default` ou preset `vertical`) na primeira consulta.
- **Entrada:**
  - `clip_id: number` (obrigatório, `> 0`) — ID do Corte em `clip_edits`.
- **Saída:** `{ schemaVersion: 1, revision, preset, font, fontSize, color, activeColor, dimColor, outlineColor, outline, shadow, x, y, highlight }`.
- **Erros:** `caption_style_invalid`, `project_not_open`, `project_busy`, `project_write`.
- **Eventos e jobs:** nenhum.
- **Pré-condições:** Projeto aberto; Corte criado em `clip_edits`.
- **Tela hoje:** nenhuma diretamente (a UI recebe `style` junto com `export.captions` em `useCaptions.ts`).
- **Mock TS:** sim, `src/lib/captionsMock.ts`.
- **US (#26):** US-77, US-78.
- **Código:** `core/src/caption_style/store.rs:323`

### `captions.style.set`
- **O que faz:** Atualiza o estilo de legenda de um Corte com validação de valores e trava otimista pela `revision` atual.
- **Entrada:**
  - `clip_id: number` (obrigatório, `> 0`) — ID do Corte.
  - `style: Style` (obrigatório) — `schemaVersion: 1`, `revision` igual à atual, `preset` (`"vertical" | "cinema" | "simple"`), `font` (`"Noto Sans" | "Noto Serif"`), `fontSize` (`24..=96`), cores `#RRGGBB` (`color`, `activeColor`, `dimColor`, `outlineColor`), `outline` (`0..=10`), `shadow` (`0..=10`), `x` (`80..=1000`), `y` (`192..=1600`), `highlight` (`boolean`).
- **Saída:** o novo objeto `Style` salvo com `revision` incrementada em +1.
- **Erros:** `caption_style_invalid`, `caption_style_conflict`, `project_not_open`, `project_busy`, `project_write`.
- **Eventos e jobs:** nenhum.
- **Pré-condições:** Projeto aberto; Corte existente em `clip_edits`; `style.revision` igual à salva no banco.
- **Tela hoje:** `src/features/captions/CaptionPanel.tsx`.
- **Mock TS:** sim, `src/lib/captionsMock.ts`.
- **US (#26):** US-78, US-79.
- **Código:** `core/src/caption_style/store.rs:324`

### `captions.style.preset`
- **O que faz:** Aplica um dos presets de fábrica (`vertical`, `cinema` ou `simple`) ao estilo de legenda do Corte, mantendo as sobrescritas individuais por palavra e incrementando a `revision`.
- **Entrada:**
  - `clip_id: number` (obrigatório, `> 0`) — ID do Corte.
  - `preset: "vertical" | "cinema" | "simple"` (obrigatório).
  - `revision: number` (obrigatório) — revisão atual do estilo do Corte.
- **Saída:** o novo objeto `Style` do preset com `revision` incrementada.
- **Erros:** `caption_style_invalid`, `caption_style_conflict`, `project_not_open`, `project_busy`, `project_write`.
- **Eventos e jobs:** nenhum.
- **Pré-condições:** Projeto aberto; Corte existente em `clip_edits`.
- **Tela hoje:** `src/features/captions/CaptionPanel.tsx`.
- **Mock TS:** sim, `src/lib/captionsMock.ts`.
- **US (#26):** US-78.
- **Código:** `core/src/caption_style/store.rs:325`

### `captions.style.default`
- **O que faz:** Salva o estilo de legenda atual do Corte como estilo padrão do Projeto (para novos Cortes sem estilo próprio).
- **Entrada:**
  - `clip_id: number` (obrigatório, `> 0`) — ID do Corte de origem.
- **Saída:** o objeto `Style` gravado em `caption_style_default` com `revision` própria incrementada.
- **Erros:** `caption_style_invalid`, `project_not_open`, `project_busy`, `project_write`.
- **Eventos e jobs:** nenhum.
- **Pré-condições:** Projeto aberto; Corte existente em `clip_edits`.
- **Tela hoje:** `src/features/captions/CaptionPanel.tsx`.
- **Mock TS:** sim, `src/lib/captionsMock.ts`.
- **US (#26):** US-41, US-78.
- **Código:** `core/src/caption_style/store.rs:326`

### `captions.track.set`
- **O que faz:** Seleciona qual faixa de legenda fica ativa para o Corte/candidato (`auto`, `narration`, `original` ou `translated`).
- **Entrada:**
  - `track: "auto" | "narration" | "original" | "translated"` (obrigatório).
  - `clip_id: number` (opcional, obrigatório se `track === "translated"`).
  - `candidate_id: number` (opcional; inferido de `clip_id` se omitido; obrigatório para `track === "narration"`).
- **Saída:** `{ candidateId: number | null, clipId: number | null, track }`.
- **Erros:** `invalid_track`, `translation_missing`, `script_requires_transformed`, `candidate_not_found`, `project_not_open`, `project_busy`, `project_read`, `project_write`.
- **Eventos e jobs:** nenhum.
- **Pré-condições:** Projeto aberto; para `translated`, precisa existir tradução salva para `clip_id`; para `narration`, o candidato precisa pertencer a uma execução `transformed`.
- **Tela hoje:** `src/features/captions/CaptionPanel.tsx`.
- **Mock TS:** sim, `src/lib/captionsMock.ts`.
- **US (#26):** US-77, US-80, US-95.
- **Código:** `core/src/narration_align.rs:1760`

### `reframe.start`
- **O que faz:** Enfileira (ou reutiliza/reinicia) o job local de análise automática de reenquadramento (YuNet no worker Python) para um Corte aprovado ou intervalo explicitamente solicitado.
- **Entrada:**
  - `candidate: number` (opcional) — ID de candidato aprovado (não pode ser combinado com `source`/`startUs`/`endUs`).
  - `requested: boolean` (obrigatório como `true` quando `candidate` é omitido).
  - `source: number` (obrigatório se sem `candidate`) — ID da Fonte.
  - `startUs: number` (obrigatório se sem `candidate`) — início em µs.
  - `endUs: number` (obrigatório se sem `candidate`) — fim em µs.
  - `layout: "face" | "gameplay_webcam" | "two_people"` (opcional, padrão `"face"`).
  - `splitRatio` ou `split_ratio: number | null` (opcional; para `gameplay_webcam` em `0.20..=0.50`, para `two_people` em `0.30..=0.70`).
  - `force: boolean` (opcional, padrão `false`) — força nova análise mesmo se já houver uma `completed` para o mesmo intervalo e layout.
- **Saída:** mesmo objeto de `reframe.status`.
- **Erros:** `invalid_reframe`, `reframe_not_chosen`, `reframe_not_found`, `worker_protocol`, `project_not_open`, `project_busy`, `project_read`, `project_write`. Durante a execução em background pelo worker, o job também pode registrar falha por `component_missing` (FFmpeg), `model_missing` (YuNet), `worker_missing` (worker Python), `source_changed`, `worker_protocol` ou `cancelled`.
- **Eventos e jobs:** enfileira job local `reframe` na fila do Projeto (cancelável por `jobs.cancel`). O worker emite `core-progress` com `job: "<id>"`, stages `reframe_proxy` (1%), `reframe_scenes` (20%), `reframe_faces` (25–99%) e, ao encerrar na fila, `complete` (100%) ou `failed`.
- **Pré-condições:** Projeto aberto; candidato aprovado ou `requested: true` com intervalo válido da Fonte; na execução em background, FFmpeg, worker Python e modelo YuNet instalados em Componentes e Fonte online.
- **Tela hoje:** `src/features/editor/CropPanel.tsx`.
- **Mock TS:** sim, `src/lib/editorEditsMock.ts`.
- **US (#26):** US-51, US-81, US-82, US-83, US-85, US-86.
- **Código:** `core/src/reframe.rs:303`

### `reframe.status`
- **O que faz:** Consulta o estado, o progresso e as timelines sugeridas (principal e secundária para layouts duplos) de uma análise de reenquadramento.
- **Entrada:**
  - `id: number` (obrigatório) — ID da sugestão em `reframe_suggestions`.
- **Saída:** `{ id, job, source, startUs, endUs, layout, splitRatio, timeline, secondaryTimeline, error: { code, message } | null, state: "queued" | "running" | "completed" | "failed" | "cancelled", progress }`.
- **Erros:** `invalid_reframe`, `reframe_not_found`, `worker_protocol`, `project_not_open`, `project_busy`, `project_read`.
- **Eventos e jobs:** nenhum (consulta o estado do job `reframe`; o campo `error` interno normaliza falhas do worker para `worker_protocol`, `cancelled` ou `reframe_failed`).
- **Pré-condições:** Projeto aberto; registro `id` criado por `reframe.start`.
- **Tela hoje:** `src/features/editor/CropPanel.tsx`.
- **Mock TS:** sim, `src/lib/editorEditsMock.ts`.
- **US (#26):** US-51, US-81, US-82.
- **Código:** `core/src/reframe.rs:304`

### `audio.import`
- **O que faz:** Valida um arquivo de áudio local (até 500 MiB), deduplica por SHA-256, copia para `<projeto>/audio/` e registra na biblioteca de áudio do Projeto com sua origem/licença.
- **Entrada:**
  - `path: string` (obrigatório) — caminho local do arquivo de áudio.
  - `kind: "music" | "sfx"` (obrigatório) — trilha sonora ou efeito sonoro.
  - `name: string` (opcional) — nome amigável (padrão: nome do arquivo sem extensão, máximo 120 caracteres).
  - `license_kind: "unknown" | "youtube_audio_library" | "cc0" | "cc_by" | "purchased" | "original"` (opcional, padrão `"unknown"`).
  - `license_attribution: string` (obrigatório se `license_kind === "cc_by"`, máximo 500 caracteres).
- **Saída:** `{ id, kind, name, durationUs, sampleRate, channels, bytes, sha256, licenseKind, licenseAttribution, licenseVerified, mediaId: "audio/<id>", createdAt }`.
- **Erros:** `project_not_open`, `project_busy`, `invalid_audio_kind`, `invalid_audio`, `invalid_license`, `attribution_required`, `audio_too_large`, `ffprobe_missing`, `copy_failed`, `audio_asset_missing`, `project_read`, `project_write`.
- **Eventos e jobs:** nenhum (execução síncrona; usa `ffprobe` para arquivos que não sejam WAV PCM).
- **Pré-condições:** Projeto aberto; arquivo local válido até 500 MiB com faixa de áudio; `ffprobe` disponível para formatos não WAV PCM.
- **Tela hoje:** `src/features/editor/AudioPanel.tsx`.
- **Mock TS:** sim, `src/lib/editorEditsMock.ts`.
- **US (#26):** US-104, US-129.
- **Código:** `core/src/audio.rs:1436`

### `audio.list`
- **O que faz:** Lista os arquivos de áudio (trilhas e/ou SFX) importados no Projeto aberto, do mais recente ao mais antigo.
- **Entrada:**
  - `kind: "music" | "sfx"` (opcional) — filtra por tipo quando informado.
- **Saída:** array de objetos `AudioAsset` (`{ id, kind, name, durationUs, sampleRate, channels, bytes, sha256, licenseKind, licenseAttribution, licenseVerified, mediaId, createdAt }`).
- **Erros:** `project_not_open`, `project_busy`, `invalid_audio_kind`, `project_read`.
- **Eventos e jobs:** nenhum.
- **Pré-condições:** Projeto aberto.
- **Tela hoje:** `src/features/editor/AudioPanel.tsx`.
- **Mock TS:** sim, `src/lib/editorEditsMock.ts`.
- **US (#26):** US-129.
- **Código:** `core/src/audio.rs:1437`

### `audio.license.set`
- **O que faz:** Atualiza a origem/licença e o texto de atribuição de um áudio já importado no Projeto.
- **Entrada:**
  - `id: number` (obrigatório) — ID do áudio em `audio_assets`.
  - `license_kind: "unknown" | "youtube_audio_library" | "cc0" | "cc_by" | "purchased" | "original"` (opcional, padrão `"unknown"`).
  - `license_attribution: string` (obrigatório quando `license_kind === "cc_by"`).
- **Saída:** objeto `AudioAsset` atualizado (com `licenseVerified = (licenseKind !== "unknown")`).
- **Erros:** `project_not_open`, `project_busy`, `audio_asset_missing`, `invalid_license`, `attribution_required`, `project_write`.
- **Eventos e jobs:** nenhum.
- **Pré-condições:** Projeto aberto; áudio `id` existente no Projeto.
- **Tela hoje:** `src/features/editor/AudioPanel.tsx`.
- **Mock TS:** sim, `src/lib/editorEditsMock.ts`.
- **US (#26):** US-104, US-129.
- **Código:** `core/src/audio.rs:1438`

### `audio.delete`
- **O que faz:** Remove um áudio da tabela `audio_assets` e apaga o arquivo físico em `<projeto>/audio/` se nenhum outro registro (ex.: outro `kind` com mesmo SHA-256) o referenciar.
- **Entrada:**
  - `id: number` (obrigatório) — ID do áudio.
- **Saída:** `{ deleted: true, id }`.
- **Erros:** `project_not_open`, `project_busy`, `audio_asset_missing`, `project_write`.
- **Eventos e jobs:** nenhum.
- **Pré-condições:** Projeto aberto.
- **Tela hoje:** `src/features/editor/AudioPanel.tsx`.
- **Mock TS:** sim, `src/lib/editorEditsMock.ts`.
- **US (#26):** US-129.
- **Código:** `core/src/audio.rs:1439`

---

## Estados e eventos do domínio

### Eventos `core-progress` emitidos neste domínio

| `job` | `stage` | Quando acontece | Percentual | Pode ter `error` |
| --- | --- | --- | --- | --- |
| `editor:<clip_id>` | `editor_saved` | Autosave (1 s após edição) ou `editor.flush` gravam o Corte no SQLite | `100` | Não |
| `editor` | `editor_save_failed` | Falha ao salvar no autosave ou no `editor.flush` ao fechar a janela (`src-tauri/src/main.rs`) | `0` | Sim (`CoreError`) |
| `<job_id>` (kind `timeline`) | `timeline` | Execução do job de onda e sprite de miniaturas do proxy (`editor.timeline`) | `2` (início onda), `40` (fim onda) | Não |
| `<job_id>` (kind `timeline`) | `complete` / `failed` | Finalização do job `timeline` na fila (`core/src/jobs/preview.rs`) | `100` / `0` | Sim em `failed` |
| `<job_id>` (kind `reframe`) | `reframe_proxy` | Worker Python preparando proxy de análise para o YuNet (`reframe.start`) | `1` | Não |
| `<job_id>` (kind `reframe`) | `reframe_scenes` | Worker Python detectando cortes de cena | `20` | Não |
| `<job_id>` (kind `reframe`) | `reframe_faces` | Worker Python rodando detecção de rosto/webcam nos quadros amostrados | `25`–`99` | Não |
| `<job_id>` (kind `reframe`) | `complete` / `failed` | Finalização do job `reframe` na fila (`core/src/jobs/preview.rs`) | `100` / `0` | Sim em `failed` |

### Estados dos objetos do domínio

- **Timeline do editor (`editor.timeline` / `editor.timeline_status`):** `missing` (ainda não gerada ou removida do cache LRU) → `queued` → `running` → `ready` | `failed` | `cancelled`.
- **Reenquadramento automático (`reframe.start` / `reframe.status`):** `queued` → `running` → `completed` | `failed` | `cancelled`.
- **Intervalo de silêncio (`SilenceStatus`):** `active` (removido no `SpliceMap`, encurtando o Corte) ↔ `reverted` (mantido no vídeo).
- **Modo de início de bloco na montagem (`StartMode`):** `automatic` (ancorado na 1ª Frase mantida de `refs`) ↔ `manual` (fixado em `manual_source_start_us`, podendo sofrer empurrão se o bloco anterior crescer).
- **Licença de áudio (`audio_assets`):** `licenseVerified: false` quando `license_kind = "unknown"` (gera aviso no checklist pré-export); `licenseVerified: true` para `youtube_audio_library`, `cc0`, `cc_by`, `purchased` e `original`.
- **Faixa de legenda (`captions.track.set`):** `"auto"` (prioriza `translated` se houver tradução ativa, senão `narration` em Vídeo transformado com áudio, senão `original`), `"original"`, `"translated"`, `"narration"`.

---

## Configurações deste domínio

| Preferência / Dado | Onde vive | Quem lê / grava |
| --- | --- | --- |
| Documento do Corte (`range`, `silences`, `crop`, `narration_starts`, `soundtrack`, `sfx`, pilhas `undo`/`redo`) | SQLite do Projeto (`*.clipes`), tabela `clip_edits` | `editor.open`, `editor.adjust`, `editor.undo`, `editor.redo`, `editor.flush`, `editor.silences.*`, `editor.crop.*`, `editor.montage.*`, `editor.audio.*` |
| Snapshots rotativos do Corte (últimos 20) | SQLite do Projeto (`*.clipes`), tabela `clip_snapshots` | Gravado pelo autosave / `editor.flush`; lido por `editor.snapshots` |
| Estilo de legenda do Corte (com `revision` otimista) | SQLite do Projeto (`*.clipes`), tabela `caption_styles` | `captions.style.get`, `captions.style.set`, `captions.style.preset` (e leitura em `export.captions` / `export.start`) |
| Estilo de legenda padrão do Projeto | SQLite do Projeto (`*.clipes`), tabela `caption_style_default` | `captions.style.get` (leitura inicial) e `captions.style.default` (gravação) |
| Overrides visuais por palavra da Transcrição | SQLite do Projeto (`*.clipes`), tabela `caption_word_overrides` (e `caption_remap_pending` / `caption_remap_notices` no remapeamento) | `captions.override`, `captions.overrides`, `captions.remap_status` |
| Faixa ativa de legenda (`auto` / `original` / `translated` / `narration`) | SQLite do Projeto (`*.clipes`), tabelas `clip_caption_tracks` e `narration_caption_tracks` | `captions.track.set` |
| Sugestões automáticas de reenquadramento (`reframe`) | SQLite do Projeto (`*.clipes`), tabela `reframe_suggestions` | `reframe.start`, `reframe.status`, `editor.crop.set_suggested` |
| Biblioteca de trilha sonora e SFX + licenças | SQLite do Projeto (`*.clipes`), tabela `audio_assets` + arquivos em `<projeto>/audio/` | `audio.import`, `audio.list`, `audio.license.set`, `audio.delete`, `editor.audio.*` |
| Jobs de timeline (`thumbs.jpg` e `wave.bin`) | SQLite do Projeto (`timeline_jobs`, `jobs`) + arquivos no cache global de proxies (`cache_dir/proxies/<key>/`) | `editor.timeline`, `editor.timeline_status`, `editor.wave`; leitura de `cache_dir` / `cache_limit_bytes` / `ffmpeg_path` via `settings.json` (ou `component-settings.json` quando `CLIPES_DATA_DIR` está definido, `core/src/paths.rs`) |

---

## Observações para o front novo

1. **`editor.snapshots` está incompleto e sem mock:** `editor.snapshots` existe em `core/src/editor/edits.rs:1715` e grava até 20 cópias em `clip_snapshots` a cada save, mas **não** tem uso na UI (`src/features/**`), **não** existe no mock TS (`editorEditsMock.ts` / `core.ts`, onde lança erro de comando desconhecido) e **não** há um comando `editor.snapshots.restore` no núcleo para restaurar um snapshot escolhido.
2. **Outros 5 comandos sem uso direto na UI atual:** `editor.range`, `editor.crop.evaluate`, `editor.crop.example`, `editor.montage.get` e `captions.overrides` não são chamados por nenhuma tela em `src/features/**`. A UI obtém os dados equivalentes diretamente de `editor.open` / mutações (caso de `montage`), de `export.captions` (caso de `overrides`) ou avaliando localmente em `cropMath.ts` (caso de `crop.evaluate`).
3. **Sugestão de reenquadramento fora do `undo`:** `editor.crop.set_suggested` e `editor.crop.example` alteram `crop.suggested` (e `layout`/`split_ratio` no caso de layout duplo), incrementam `revision` e marcam `dirty`, mas **não** chamam `push_history` (`EditSnapshot` não armazena `suggested`). Assim, um `Ctrl+Z` logo após aplicar uma sugestão não desfaz a sugestão aplicada.
4. **Inconsistência de nomenclatura entre comandos do mesmo domínio:**
   - `editor.open`, `editor.range` e `editor.sentences` usam `source_id`, `start_id`, `end_id`, `candidate_id` (`snake_case`); já `reframe.start` usa `source`, `startUs`, `endUs` (`camelCase`, e `source` em vez de `source_id`).
   - `reframe.start` e `editor.crop.set_layout` aceitam tanto `splitRatio` quanto `split_ratio`; `editor.audio.sfx.add` aceita `source_us`/`sourceUs`/`time_us`/`timeUs` na âncora `moment` e `block_id`/`blockId`, `offset_us`/`offsetUs` na âncora `word`.
   - `editor.crop.*` devolvem apenas o subdocumento de crop (`crop_answer`), enquanto os demais mutadores (`editor.adjust`, `editor.silences.*`, `editor.montage.set_start`, `editor.audio.*` exceto `get`) devolvem o objeto completo `answer` (com `silences`, `crop`, `montage` e `audioMix`).
5. **Divergências entre mock TS e núcleo Rust:**
   - `editorEditsMock.ts` usa valores padrão diferentes para áudio (`volume: 0.25`, `fadeInUs: 500_000`, `fadeOutUs: 800_000` na trilha e `0.85` no SFX, contra `0.30`, `0`, `0` e `0.80` no Rust), fixa `fps = 24` e Frases de `10 s`, e não implementa `editor.snapshots`.
   - `captionsMock.ts` guarda `overrides` em um único `Map` global em memória (sem separar por `transcript_id`).
6. **Erros do núcleo ignorados ou genéricos na UI atual:**
   - `Editor.tsx` não mapeia `project_not_open`, `project_busy`, `source_offline`, `source_changed`, `clip_too_long`, `invalid_audio_mix`, `invalid_audio_kind`, `audio_asset_missing` nem `sfx_not_found` (caem todos na mensagem genérica `"Não foi possível abrir o editor."`).
   - `CaptionPanel.tsx` não diferencia nenhum `code` de erro (`caption_style_conflict`, `caption_style_invalid`, `word_missing`, `invalid_track`, `translation_missing`, `script_requires_transformed`), exibindo apenas `"Não foi possível salvar a legenda. Reabra a gaveta e tente de novo."`.
   - `CropPanel.tsx` só trata `model_missing`, `component_missing` e `cancelled` para `reframe`; os demais códigos (`reframe_not_chosen`, `reframe_not_found`, `worker_missing`, `worker_protocol`, `invalid_reframe`, `invalid_crop`) caem no erro genérico.
   - `AudioPanel.tsx` não mapeia `project_not_open`, `copy_failed`, `invalid_license`, `audio_asset_missing`, `invalid_audio_kind`, `invalid_audio_mix` nem `sfx_not_found`.
