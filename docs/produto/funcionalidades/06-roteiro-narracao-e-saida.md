# Roteiro, Narração, capa, Empacotamento e exportação

## A jornada

Esta é a reta final de produção de um **Corte** depois que o usuário já importou a **Fonte**, concluiu a **Transcrição**, selecionou e aprovou o candidato na revisão (e, opcionalmente, ajustou bordas, silêncios, legenda, reenquadramento e áudio no editor). Aqui o caminho se divide conforme o tipo de vídeo escolhido no **Perfil de canal** ([ADR-0001](../../adr/0001-dois-tipos-de-video-e-regras-de-transformacao.md)): no **Corte direto** (voltado a **Canais de cortes**), o usuário pula Roteiro e Narração e vai direto para capa, **Empacotamento** e exportação; no **Vídeo transformado** (voltado a **Canais dark**), ele precisa entregar uma **Transformação** real — comentário ou análise própria — antes de fechar o vídeo.

Por isso existem **Roteiro** e **Narração** no **Vídeo transformado**. Legenda, enquadramento, título, filtros e corte de silêncio não contam como Transformação e deixam a monetização em risco por conteúdo reutilizado. O **Roteiro** estrutura a fala em blocos (`3` a `12` blocos, após a escolha de um ângulo), que o usuário edita e aprova bloco a bloco (humano no loop, regra 5 do ADR-0001). Só quando todos os blocos estão aprovados na versão atual o núcleo libera a **Narração**, que pode vir de síntese local (**TTS** via `pocket-tts`), gravação no microfone dentro do app (com teleprompter) ou importação de áudio externo. Depois da voz, o sistema alinha as palavras com o texto, monta a faixa contínua sobre o Corte (com *ducking* na Fonte e na trilha, além de congelamento do último quadro se a fala passar do fim do Corte), sugere capa e **Empacotamento** (título, descrição com crédito da Fonte, capítulos do YouTube, tags e hashtags) e exporta tudo em MP4 `1080×1920` (ou em lote) e PNG da capa.

### Transformação, Roteiro, Narração e Montagem (como as peças se encaixam)

- **Trava no núcleo (ADR-0001 e ADR-0007):** O comando `script.narration_allowed` (e a função interna `script::narration_allowed`) bloqueia qualquer geração, gravação ou importação de Narração enquanto houver bloco pendente, sem texto ou com geração em andamento, ou se o Corte for um **Corte direto** (`script_requires_transformed`). Editar ou regenerar um bloco cria uma nova versão e volta aquele bloco para `pendente`.
- **Três caminhos de Narração (todos convergem para WAV PCM 16 bits, 24 kHz, mono em `narrations/c<candidate>/b<block>-v<version>.wav`):**
  1. **TTS local (`core/src/tts/narration.rs` + `core/src/tts/catalog.rs`):** usa o componente `pocket-tts` com vozes e modelos baixados por idioma (`pt` ou `en`). Não passa pela limpeza de voz.
  2. **Gravação no app (`core/src/narration_record.rs`):** recebe o áudio capturado no WebView em Base64 (WAV ou contêiner convertido via FFmpeg), reamostra para 24 kHz mono e usa o worker Python (`faster-whisper` + **Silero VAD**) para aparar silêncios do início e do fim e medir o piso de ruído. Se não detectar fala (`no_speech_detected`), guarda um rascunho temporário no cache até o usuário gravar de novo ou descartar (`narration.discard_draft`). Se o worker não estiver instalado, salva sem aparo (`trimmed: false`, aviso `vad_unavailable`) e permite aparar depois com `narration.trim_block`.
  3. **Importação externa (`core/src/narration_import.rs`):** aceita `.wav`, `.mp3`, `.m4a`, `.ogg` (até `200 MiB`, duração entre `0,3 s` e `10 min`, codecs `pcm_*`, `mp3`, `aac`, `alac`, `flac`, `vorbis`, `opus`), valida via `ffprobe` e transcodifica via FFmpeg para 24 kHz mono.
- **Limpeza de voz (`core/src/narration_cleanup.rs`):** aplicada de forma não destrutiva apenas a blocos `recorded` e `imported` (ligada por padrão). Roda `highpass` a `80 Hz` e redução de ruído `afftdn` (`12 dB`, piso de ruído medido nos silêncios pelo VAD ou padrão `-50 dBFS`) compensando a latência de `25 ms`, salvando o arquivo derivado `.clean.wav` ao lado do original dentro de `narrations/` para prévia Antes/Depois e uso no export.
- **Alinhamento por palavra (`core/src/narration_align.rs`):** após TTS, gravação (com worker pronto), aparo ou importação, ou sob demanda via `narration.align` / `narration.align_block`, o worker Python executa alinhamento forçado (`faster-whisper`) comparando o áudio contra o texto do Roteiro. Se houver `>= 2` inserções seguidas ou `>= 3` substituições, o bloco entra em `needs_review` para o usuário escolher (`narration.review`) entre usar o texto do `script` ou o `spoken` (falado) nas legendas da faixa `narration`.
- **Montagem (`core/src/montage.rs`):** posiciona os blocos da Narração em *voice-over* contínuo sobre o Corte já com silêncios removidos (`SpliceMap`), ancorando cada bloco na 1ª Frase mantida de `refs` (ou no início manual arrastado na timeline), garantindo intervalo mínimo de `300 ms` entre blocos sem sobreposição e estendendo o último quadro (`tpad` / `freeze_tail_us`) se a fala ultrapassar a duração do Corte (com aviso reforçado acima de `5 s`). Durante o export, a Narração entra como *sidechain* de `sidechaincompress` (~`-12 dB` de *ducking* na Fonte).
- **Capa (`core/src/thumbnail.rs`):** uma Tarefa de IA (`thumbnail`, que compartilha a rota e o veto **Somente local** de `packaging`) aponta o ID de uma Frase do Corte e uma justificativa; o núcleo converte no instante médio da Frase. O usuário pode escolher outro instante manualmente (`thumbnail.choose`) e exportar um PNG sem filtros nem cortes no tamanho nativo da Fonte (`thumbnail.export`).
- **Empacotamento (`core/src/packaging.rs` + `core/src/packaging/chapters.rs`):** uma Tarefa de IA gera título (`<= 100` chars), descrição (`<= 5000` bytes incluindo o crédito da Fonte quando há Permissão), tags (`<= 30`, total `<= 500` chars) e hashtags (`<= 15`). Em Vídeo transformado com Narração gerada/gravada/importada (sem durações estimadas) e ao menos `3` blocos com duração mínima de `10 s` cada, gera automaticamente capítulos do YouTube delimitados na descrição e atualizáveis com `packaging.refresh_chapters`.
- **Exportação, encoder e o que sai no disco (`core/src/export.rs`, `batch.rs`, `encoder.rs`, `render.rs`, `pipeline.rs`):** na primeira execução (ou em Preferências), `export.encoder.detect` testa encoders H.264 disponíveis (`h264_nvenc`, `h264_qsv`, `h264_amf`, `h264_videotoolbox`, sempre fechando com `libx264` como fallback garantido) gravando um clipe sintético de `1 s` em `1080×1920`. Se um encoder de hardware falhar no export (`export_failed`), o núcleo remove-o do cache e refaz com `libx264`. O arquivo exportado no disco (escolhido pelo usuário em `export.start` ou nomeado `<fonte>-<nn>-<tempo>.mp4` na pasta de `export.batch.start`) é um **MP4** (`1080×1920` H.264 `yuv420p` ou `nv12` no QSV, `+faststart`, metadados limpos `-map_metadata -1`, legenda ASS queimada via `libass`, áudio AAC `192 kbps` a `48 kHz` normalizado em 2 passagens `loudnorm` para `-14 LUFS`, *true peak* `-1 dBTP` e LRA `11 LU`).

---

## Fluxo típico

*Nota:* **job** aqui significa uma tarefa longa executada em segundo plano na fila persistida no SQLite do Projeto (`*.clipes`), que emite progresso pelo evento Tauri `core-progress` e pode ser cancelada sem travar a interface.

### A. Roteiro e Narração (somente Vídeo transformado)

1. *(Pré-passo em outro domínio)* O usuário escolhe ou escreve um ângulo (`angles.*`).
2. `script.estimate` → calcula se o Provedor configurado para `script` é pago e devolve a faixa estimada de custo em micro-USD (ou `zero` / `plan_quota`).
3. `script.generate` → se pago e sem `confirmed: true`, retorna erro `confirmation_required` com a estimativa; com confirmação (ou local), enfileira o job `ai:script` (esboço dos blocos).
4. A UI acompanha `core-progress` (`ai:script:*` e depois `ai:script_block:*`) e consulta `script.get` — cada chamada a `script.get` materializa o esboço concluído, dispara automaticamente os jobs `ai:script_block` de cada bloco e materializa seus textos.
5. Para cada bloco, o usuário pode editar (`script.edit`), pedir nova versão (`script.estimate { block }` + `script.regenerate`) ou aprovar (`script.approve`). Editar ou regenerar volta o bloco para `pendente`.
6. Quando todos os blocos estão aprovados (`narrationAllowed: true`), a UI abre a etapa de **Narração** (`narration.get`) e segue um dos três caminhos (que podem ser misturados por bloco):
   - **TTS local:** `narration.generate` (todos os blocos) ou `narration.regenerate_block` (um bloco) → enfileira job `narration` (`pocket-tts`) → emite `core-progress` → ao concluir, se worker + modelo Whisper estiverem instalados, enfileira automaticamente `narration_align`.
   - **Gravação no microfone:** `narration.record_block` → grava WAV 24 kHz mono, apara com Silero VAD (se worker instalado) e enfileira `narration_align`. Se não houver fala (`no_speech_detected`), o usuário grava de novo ou limpa o rascunho com `narration.discard_draft`. Se gravou sem worker e instalou depois, usa `narration.trim_block`.
   - **Importação de áudio:** `narration.import` → enfileira job `narration_import` (`ffprobe` + conversão FFmpeg) → ao concluir, enfileira `narration_align`.
7. **Limpeza de voz (gravada/importada):** já vem ligada (`enabled: true`); para ouvir Antes/Depois, a UI chama `narration.cleanup.prepare` (gera `.clean.wav`) e alterna com `narration.cleanup.set`.
8. **Alinhamento e revisão:** se não rodou automaticamente (ou para refazer), chama `narration.align` / `narration.align_block`. Blocos em `needs_review` exigem `narration.review { choice: "script" | "spoken" }` para emitir legendas.

### B. Capa, Empacotamento e Exportação (Corte direto e Vídeo transformado)

9. **Capa:** `thumbnail.estimate` → `thumbnail.suggest` (job `ai:thumbnail`, pede `confirmed: true` se pago) → `thumbnail.get` → ajuste opcional com `thumbnail.choose { instant_us }` → `thumbnail.export { output }` grava o PNG no disco.
10. **Empacotamento:** `packaging.estimate` → `packaging.generate` (job `ai:packaging`, pede `confirmed: true` se pago) → `packaging.get` → edições manuais com `packaging.edit`. Se o Roteiro/Narração mudar depois, `packaging.refresh_chapters` atualiza só o bloco de capítulos sem sobrescrever o restante da descrição.
11. **Exportação individual:** a UI lê `export.settings` para sugerir a última pasta usada e `export.captions` para prévia/validação de glifos no editor → chama `export.start` (retorna `job`, estado `queued`) → escuta `core-progress` (`stage: "export"`) e consulta `export.status`. Cancelamento usa `jobs.cancel { id }`.
12. **Exportação em lote:** a UI lê `export.settings` → chama `export.batch.start` (se houver arquivos conflitantes na pasta e sem `confirmed: true`, retorna `confirmation_required` com `usage.conflicts`) → escuta `core-progress` (`stage: "export_batch"`, `"export_batch_complete"`, `"export_batch_cancelled"`) e consulta `export.batch.list` ou `export.batch.status`. Cancelamento usa `export.batch.cancel { id }`.
13. **Preferências de encoder:** `export.encoder.status` → `export.encoder.detect` (testa hardware e grava cache) → `export.encoder.set` (escolha manual ou automático `null`).

**Caminhos alternativos:** qualquer job na fila (`ai:script`, `ai:script_block`, `ai:thumbnail`, `ai:packaging`, `narration`, `narration_import`, `narration_align`, `export`) pode ser cancelado por `jobs.cancel { id }`. Jobs de IA com resultado `uncertain` ou estourando orçamento seguem o fluxo global de `jobs.retry` / `jobs.discard` / `jobs.budget.*`.

---

## Comandos

### Roteiro (`script.*`)

### `script.estimate`
- **O que faz:** Calcula se a geração do Roteiro (ou a regeneração de um bloco) usa Provedor pago e estima o custo antes de enviar texto.
- **Entrada:** `{ candidate: number, language?: "pt-BR" | "en", block?: number, profileId?: string }` (`candidate` obrigatório; `language` obrigatório se a Transcrição não identificar PT-BR/EN; `block` opcional para estimar apenas 1 bloco; `profileId` opcional para estimar com outro Perfil de Provedor).
- **Saída:** `{ paid: boolean, profile: string, language: "pt-BR" | "en", estimate: { kind: "usd" | "zero" | "plan_quota" | "unknown", minMicroUsd: number | null, maxMicroUsd: number | null } }`.
- **Erros:** `project_not_open` (sem Projeto aberto), `candidate_not_found` (candidato ausente), `not_approved` (candidato não aprovado), `adjust_out_of_transcript`, `script_requires_transformed` (Corte direto), `angle_required` (ângulo não escolhido), `angle_invalid`, `language_required` (idioma ambíguo e não informado), `invalid_settings` (Provedor/perfil inválido ou não configurado), `local_only_violation` (perfil remoto bloqueado por **Somente local**).
- **Eventos e jobs:** nenhum (síncrono).
- **Pré-condições:** Projeto aberto, candidato aprovado de um Vídeo transformado, ângulo escolhido e Provedor configurado para a Tarefa de IA `script`.
- **Tela hoje:** [Script.tsx](../../../src/features/projects/Script.tsx)
- **Mock TS:** sim, em [scriptMock.ts](../../../src/lib/scriptMock.ts) (não usa `profileId` nem `block`).
- **US (#26):** US-87, US-88, US-89.
- **Código:** [script.rs:1493](../../../core/src/script.rs#L1493)

### `script.generate`
- **O que faz:** Enfileira a criação de um novo Roteiro em blocos para um Corte do Vídeo transformado (primeiro o esboço; os textos dos blocos são enfileirados em seguida ao consultar `script.get`).
- **Entrada:** `{ candidate: number, language?: "pt-BR" | "en", confirmed?: boolean }` (`candidate` obrigatório; `confirmed: true` obrigatório quando o Provedor é pago).
- **Saída:** `{ job: number, language: "pt-BR" | "en" }`.
- **Erros:** todos os de `script.estimate` mais `confirmation_required` (com `usage.estimate`, quando pago e sem `confirmed: true`), `generation_in_progress` (já existe geração ativa para o Corte), `unknown_task`, `project_write`.
- **Eventos e jobs:** enfileira job `ai:script` na fila persistida (`jobs`); emite `core-progress` com `stage: "ai:script:call"` (10%), `"ai:script:verify"` (80%) e `"ai:script:done"` (100% ou 0% com erro). Depois, `script.get` enfileira jobs `ai:script_block` (um por bloco). Cancelável via `jobs.cancel { id }`.
- **Pré-condições:** mesmas de `script.estimate`, sem geração em andamento para o candidato.
- **Tela hoje:** [Script.tsx](../../../src/features/projects/Script.tsx)
- **Mock TS:** sim, em [scriptMock.ts](../../../src/lib/scriptMock.ts).
- **US (#26):** US-87, US-88, US-97.
- **Código:** [script.rs:1494](../../../core/src/script.rs#L1494)

### `script.get`
- **O que faz:** Retorna o documento atual do Roteiro do Corte (blocos, versões, aprovações, trava da Narração e histórico) e avança/materializa a cadeia de geração se houver jobs concluídos.
- **Entrada:** `{ candidate: number }` (`candidate` obrigatório).
- **Saída:** `{ schemaVersion: 1, revision: number, angle: object | null, candidate: { run, startId, endId }, detectedLanguage: "pt-BR" | "en" | null, languageRequired: boolean, current: { generation, language, blocks: [...], totalChars, pending, approved, complete } | null, narrationAllowed: boolean, job: { id, state, code, violations } | null, busy: boolean, limits: { minBlocks, maxBlocks, titleChars, narrationChars, scriptChars, refs }, generations: [...] }`. Cada bloco em `current.blocks` traz `{ id, position, title, intent, refs, narration, status: "aprovado" | "pendente", stale, version, edited, job }`.
- **Erros:** `project_not_open`, `candidate_not_found`, `not_approved`, `adjust_out_of_transcript`, `script_requires_transformed`, `internal_error` (falha de lock ao avançar cadeia), `project_read`, `project_write`.
- **Eventos e jobs:** ao materializar um esboço recém-concluído, enfileira automaticamente os jobs `ai:script_block` na fila persistida (que depois emitem `core-progress` com `stage: "ai:script_block:call" | "verify" | "done"`).
- **Pré-condições:** Projeto aberto e candidato aprovado de Vídeo transformado.
- **Tela hoje:** [Script.tsx](../../../src/features/projects/Script.tsx)
- **Mock TS:** sim, em [scriptMock.ts](../../../src/lib/scriptMock.ts) (e consumido internamente pelo mock de `narration.*` em [core.ts](../../../src/lib/core.ts)).
- **US (#26):** US-88, US-89, US-90.
- **Código:** [script.rs:1495](../../../core/src/script.rs#L1495)

### `script.edit`
- **O que faz:** Grava uma edição humana de título, texto de narração ou referências de Frase em um bloco do Roteiro, criando uma nova versão e voltando o bloco para `pendente`.
- **Entrada:** `{ candidate: number, block: number, title?: string, narration?: string, refs?: number[] }` (`candidate` e `block` obrigatórios).
- **Saída:** o mesmo documento completo retornado por `script.get`.
- **Erros:** erros de `script.get` mais `block_not_found`, `generation_in_progress`, `nothing_to_edit` (bloco ainda sem texto gerado), `invalid_edit` (tipo inválido nos campos), `edit_invalid` (com `usage.violations`: `title_empty`, `title_too_long`, `narration_empty`, `narration_too_long`, `script_too_long`, `forbidden_character`, `invented_url`, `too_many_refs`, `unknown_sentence_id`).
- **Eventos e jobs:** nenhum (síncrono; apenas atualiza/materializa se necessário antes de editar).
- **Pré-condições:** Roteiro gerado com bloco contendo texto e sem job ativo no Roteiro/bloco.
- **Tela hoje:** [Script.tsx](../../../src/features/projects/Script.tsx)
- **Mock TS:** sim, em [scriptMock.ts](../../../src/lib/scriptMock.ts) (só trata `narration`, ignorando `title` e `refs`).
- **US (#26):** US-89, US-97.
- **Código:** [script.rs:1496](../../../core/src/script.rs#L1496)

### `script.approve`
- **O que faz:** Aprova a versão atual de um bloco específico do Roteiro (um bloco por chamada).
- **Entrada:** `{ candidate: number, block: number }` (`candidate` e `block` obrigatórios).
- **Saída:** o mesmo documento completo retornado por `script.get`.
- **Erros:** erros de `script.get` mais `block_not_found`, `generation_in_progress`, `nothing_to_approve` (bloco sem texto ainda).
- **Eventos e jobs:** nenhum (síncrono).
- **Pré-condições:** bloco existente com texto gerado/editado e sem job em andamento.
- **Tela hoje:** [Script.tsx](../../../src/features/projects/Script.tsx)
- **Mock TS:** sim, em [scriptMock.ts](../../../src/lib/scriptMock.ts).
- **US (#26):** US-89, US-90, US-97.
- **Código:** [script.rs:1497](../../../core/src/script.rs#L1497)

### `script.regenerate`
- **O que faz:** Pede ao Provedor para reescrever um único bloco do Roteiro levando em conta o bloco anterior e o seguinte, gerando uma versão nova em `pendente`.
- **Entrada:** `{ candidate: number, block: number, profileId?: string, confirmed?: boolean }` (`candidate` e `block` obrigatórios; `profileId` permite "refazer com o perfil X"; `confirmed: true` obrigatório se o Provedor for pago).
- **Saída:** `{ job: number, block: number }`.
- **Erros:** erros de `script.get` mais `block_not_found`, `generation_in_progress`, `angle_required`, `angle_invalid`, `invalid_settings`, `local_only_violation`, `confirmation_required` (com `usage.estimate`), `unknown_task`.
- **Eventos e jobs:** enfileira job `ai:script_block` na fila persistida (`jobs`); emite `core-progress` com `stage: "ai:script_block:call"` (10%), `"ai:script_block:verify"` (80%) e `"ai:script_block:done"` (100% ou 0% com erro). Cancelável via `jobs.cancel { id }`.
- **Pré-condições:** Roteiro com esboço/blocos existentes, ângulo válido, bloco livre de geração ativa e Provedor configurado para `script`.
- **Tela hoje:** [Script.tsx](../../../src/features/projects/Script.tsx)
- **Mock TS:** sim, em [scriptMock.ts](../../../src/lib/scriptMock.ts) (não suporta `profileId`).
- **US (#26):** US-89.
- **Código:** [script.rs:1498](../../../core/src/script.rs#L1498)

### `script.narration_allowed`
- **O que faz:** Verifica explicitamente a trava do núcleo que só libera a Narração quando todos os blocos do Roteiro estão aprovados na versão atual.
- **Entrada:** `{ candidate: number }` (`candidate` obrigatório).
- **Saída:** `{ allowed: true }`.
- **Erros:** `project_not_open`, `candidate_not_found`, `not_approved`, `adjust_out_of_transcript`, `script_requires_transformed`, `script_not_approved` (com `usage: { reason: "generating" | "no_script" | "pending_blocks", pending: number }`).
- **Eventos e jobs:** nenhum (síncrono; apenas materializa/avança o estado do Roteiro se houver jobs pendentes de materialização).
- **Pré-condições:** Projeto aberto e candidato aprovado.
- **Tela hoje:** nenhuma (sem uso na UI).
- **Mock TS:** não.
- **US (#26):** US-90.
- **Código:** [script.rs:1499](../../../core/src/script.rs#L1499)

---

### Narração (`narration.*`)

### `narration.get`
- **O que faz:** Retorna o estado completo da Narração de um Corte: se está liberada pela trava do Roteiro, voz padrão, modelo TTS ativo, pré-requisitos de alinhamento/VAD, jobs recentes (TTS, importação, alinhamento) e a lista de blocos com áudio, limpeza de voz e alinhamento.
- **Entrada:** `{ candidate: number }` (`candidate` obrigatório).
- **Saída:** `{ candidate: number, narrationAllowed: boolean, gateReason: string | null, language: "pt" | "en", defaultVoiceId: string, activeModelId: string, busy: boolean, job: object | null, importBusy: boolean, importJob: object | null, alignBusy: boolean, alignJob: object | null, alignPrerequisitesReady: boolean, vadReady: boolean, blocks: [{ blockId, position, title, versionId, narrationText, audio: { id, versionId, voiceId, modelId, engineId, relPath, durationUs, sampleRate, channels, bytes, stale, trimmed, cleanup } | null, alignment: { status, choice, activeTrack, substitutions, insertions, deletions, maxConsecutiveInsertions, errorCode, modelId, spokenText, wordCount } | null }], totalDurationUs: number }`.
- **Erros:** `project_not_open`, `candidate_not_found`, `not_approved`, `adjust_out_of_transcript`, `script_requires_transformed`, `project_read`.
- **Eventos e jobs:** nenhum (síncrono).
- **Pré-condições:** Projeto aberto e candidato aprovado de Vídeo transformado.
- **Tela hoje:** [Narration.tsx](../../../src/features/projects/Narration.tsx)
- **Mock TS:** sim, em [core.ts](../../../src/lib/core.ts).
- **US (#26):** US-90, US-91, US-92, US-94, US-95, US-130.
- **Código:** [tts/narration.rs:939](../../../core/src/tts/narration.rs#L939)

### `narration.generate`
- **O que faz:** Enfileira a síntese local por TTS (`pocket-tts`) para todos os blocos do Roteiro aprovado de um Corte.
- **Entrada:** `{ candidate: number, voiceId?: string, modelId?: string, quantize?: boolean }` (`candidate` obrigatório; `quantize` padrão `true`).
- **Saída:** `{ job: number, candidate: number, blockId: null, voiceId: string, modelId: string, quantize: boolean }`.
- **Erros:** `project_not_open`, `candidate_not_found`, `not_approved`, `adjust_out_of_transcript`, `script_requires_transformed`, `script_not_approved`, `component_missing` (`pocket-tts` ausente), `tts_voice_unknown`, `tts_voice_language_mismatch`, `tts_model_unknown`, `tts_model_language_mismatch`, `tts_model_missing`, `tts_voice_unsupported`, `generation_in_progress`, `narration_failed` (durante execução do job).
- **Eventos e jobs:** enfileira job `narration` na fila persistida (`jobs`); emite `core-progress` com `stage: "narration"` (percentual proporcional aos blocos concluídos até 99%) e no fim `stage: "complete"` (100%) ou `"failed"` (0%). Cancelável via `jobs.cancel { id }`. Ao concluir com worker e modelo Whisper instalados, enfileira automaticamente o job `narration_align`.
- **Pré-condições:** Roteiro 100% aprovado (`script::narration_allowed`), componente `pocket-tts` instalado e modelo/voz TTS do idioma do Roteiro baixados.
- **Tela hoje:** [Narration.tsx](../../../src/features/projects/Narration.tsx)
- **Mock TS:** sim, em [core.ts](../../../src/lib/core.ts).
- **US (#26):** US-90, US-91.
- **Código:** [tts/narration.rs:940](../../../core/src/tts/narration.rs#L940)

### `narration.regenerate_block`
- **O que faz:** Enfileira a síntese por TTS apenas para um bloco específico do Roteiro aprovado (útil após editar e reaprovar um bloco ou trocar a voz).
- **Entrada:** `{ candidate: number, block?: number, blockId?: number, voiceId?: string, modelId?: string, quantize?: boolean }` (`candidate` obrigatório e `block` ou `blockId` obrigatório).
- **Saída:** `{ job: number, candidate: number, blockId: number, voiceId: string, modelId: string, quantize: boolean }`.
- **Erros:** mesmos de `narration.generate` mais `block_not_found`.
- **Eventos e jobs:** mesmos de `narration.generate` (job `narration` para 1 bloco, com disparo automático de `narration_align` para aquele bloco ao concluir). Cancelável via `jobs.cancel { id }`.
- **Pré-condições:** mesmas de `narration.generate`, com `block` pertencente ao Roteiro atual.
- **Tela hoje:** [Narration.tsx](../../../src/features/projects/Narration.tsx)
- **Mock TS:** sim, em [core.ts](../../../src/lib/core.ts).
- **US (#26):** US-91.
- **Código:** [tts/narration.rs:941](../../../core/src/tts/narration.rs#L941)

### `narration.record_block`
- **O que faz:** Recebe a gravação de microfone de um bloco (em Base64), converte para WAV PCM 24 kHz mono, apara silêncios de início e fim com Silero VAD (quando o worker está instalado), mede o piso de ruído, salva na pasta `narrations/` do Projeto e dispara o alinhamento por palavra.
- **Entrada:** `{ candidate: number, block?: number, blockId?: number, audioBase64: string, mimeType?: string }` (`candidate`, `block`/`blockId` e `audioBase64` obrigatórios; máximo `64 MiB` decodificados).
- **Saída:** `{ candidate: number, blockId: number, narrationId: number, versionId: number, engineId: "recorded", voiceId: "recorded", modelId: "silero-vad" | "untrimmed", relPath: string, durationUs: number, sampleRate: 24000, channels: 1, bytes: number, trimmed: boolean, warningCode: "vad_unavailable" | null, warning: string | null }`.
- **Erros:** `project_not_open`, `candidate_not_found`, `block_not_found`, `not_approved`, `script_requires_transformed`, `script_not_approved`, `generation_in_progress` (há job de TTS, alinhamento ou importação ativo no candidato), `invalid_recording_audio`, `recording_too_large`, `component_missing` (FFmpeg ausente quando o áudio não é WAV PCM e precisa transcodificar), `narration_record_failed`, `no_speech_detected` (com `usage: { hasDraft: true, durationUs }`; salva rascunho no cache), `worker_protocol` (resposta inválida do worker VAD).
- **Eventos e jobs:** execução síncrona (não entra na fila `jobs`). Emite `core-progress` síncrono com `job: "narration_record"`, `stage: "vad"` (40%, quando o worker está pronto) e `stage: "done"` (100%), além de chamar `jobs::progress(0, "narration_record", 100, ...)`. Ao salvar, enfileira em segundo plano o job `narration_align` se worker + modelo Whisper estiverem prontos.
- **Pré-condições:** Roteiro 100% aprovado, sem outro job de Narração em curso; FFmpeg necessário se `audioBase64` não for WAV PCM (ex.: `webm`, `ogg`, `m4a`); worker Python opcional (sem ele salva sem aparo com `warningCode: "vad_unavailable"`).
- **Tela hoje:** [TeleprompterRecorder.tsx](../../../src/features/projects/TeleprompterRecorder.tsx)
- **Mock TS:** sim, em [core.ts](../../../src/lib/core.ts).
- **US (#26):** US-92, US-93.
- **Código:** [narration_record.rs:1007](../../../core/src/narration_record.rs#L1007)

### `narration.trim_block`
- **O que faz:** Aplica o aparo automático de silêncio por Silero VAD em um bloco gravado anteriormente sem aparo (quando o usuário instala o worker depois da gravação), recalcula o piso de ruído e re-enfileira o alinhamento.
- **Entrada:** `{ candidate: number, block?: number, blockId?: number }` (`candidate` e `block`/`blockId` obrigatórios).
- **Saída:** `{ candidate: number, blockId: number, narrationId: number, versionId: number, engineId: "recorded", voiceId: "recorded", modelId: "silero-vad", relPath: string, durationUs: number, sampleRate: 24000, channels: 1, bytes: number, trimmed: true }`.
- **Erros:** `project_not_open`, `candidate_not_found`, `block_not_found`, `script_not_approved`, `generation_in_progress`, `worker_missing` (worker Python não instalado), `narration_missing` (bloco sem áudio gravado), `narration_not_recorded` (bloco é TTS ou importado), `narration_record_failed`, `no_speech_detected`, `worker_protocol`.
- **Eventos e jobs:** execução síncrona (não entra na fila `jobs`); emite `core-progress` síncrono com `job: "narration_record"`, `stage: "vad"` (50%). Ao concluir, enfileira em segundo plano o job `narration_align`.
- **Pré-condições:** bloco com gravação (`engine_id = "recorded"`), Roteiro aprovado e worker Python instalado.
- **Tela hoje:** [Narration.tsx](../../../src/features/projects/Narration.tsx)
- **Mock TS:** sim, em [core.ts](../../../src/lib/core.ts).
- **US (#26):** US-93.
- **Código:** [narration_record.rs:1008](../../../core/src/narration_record.rs#L1008)

### `narration.discard_draft`
- **O que faz:** Apaga do cache temporário o arquivo de rascunho de uma gravação recusada por `no_speech_detected`.
- **Entrada:** `{ candidate: number, block?: number, blockId?: number }` (`candidate` e `block`/`blockId` obrigatórios).
- **Saída:** `{ candidate: number, blockId: number, discarded: boolean }`.
- **Erros:** `candidate_not_found`, `block_not_found`, `settings` (se o diretório de cache não puder ser resolvido).
- **Eventos e jobs:** nenhum (síncrono).
- **Pré-condições:** nenhuma além de `candidate` e `block` válidos.
- **Tela hoje:** [TeleprompterRecorder.tsx](../../../src/features/projects/TeleprompterRecorder.tsx)
- **Mock TS:** sim, em [core.ts](../../../src/lib/core.ts).
- **US (#26):** US-92, US-93.
- **Código:** [narration_record.rs:1009](../../../core/src/narration_record.rs#L1009)

### `narration.import`
- **O que faz:** Enfileira a importação de um arquivo de áudio externo (`wav`, `mp3`, `m4a` ou `ogg`) para um bloco do Roteiro, validando com `ffprobe` e convertendo para WAV PCM 24 kHz mono dentro do Projeto.
- **Entrada:** `{ candidate: number, block?: number, blockId?: number, path: string }` (todos obrigatórios).
- **Saída:** `{ job: number, candidate: number, blockId: number }`.
- **Erros:** `project_not_open`, `candidate_not_found`, `block_not_found`, `invalid_audio_path`, `not_approved`, `script_requires_transformed`, `script_not_approved`, `import_file_missing`, `import_unsupported_format`, `import_empty_file`, `import_file_too_large` (`> 200 MiB`), `component_missing` (FFmpeg ausente), `ffprobe_missing`, `import_in_progress`, `generation_in_progress`; e durante o job: `import_no_audio_stream`, `import_unsupported_codec`, `import_invalid_audio`, `import_duration_too_short` (`< 0,3 s`), `import_duration_too_long` (`> 10 min`), `import_failed`.
- **Eventos e jobs:** enfileira job `narration_import` na fila persistida (`jobs`); emite `core-progress` com `stage: "narration_import"` (10%, 35%, 85%) e no fim `"complete"` (100%) ou `"failed"` (0%). Cancelável via `jobs.cancel { id }`. Ao concluir, enfileira automaticamente `narration_align` se os pré-requisitos estiverem prontos.
- **Pré-condições:** Roteiro 100% aprovado, arquivo local válido e Componente FFmpeg (com `ffprobe`) instalado.
- **Tela hoje:** [Narration.tsx](../../../src/features/projects/Narration.tsx)
- **Mock TS:** sim, em [core.ts](../../../src/lib/core.ts).
- **US (#26):** US-94.
- **Código:** [narration_import.rs:735](../../../core/src/narration_import.rs#L735)

### `narration.align`
- **O que faz:** Enfileira o alinhamento forçado por palavra (via `faster-whisper` no worker Python) para todos os blocos com áudio atual de um Corte, gerando timestamps das legendas da Narração e detectando desvios do Roteiro.
- **Entrada:** `{ candidate: number }` (`candidate` obrigatório).
- **Saída:** `{ job: number, candidate: number, blockId: null }`.
- **Erros:** `project_not_open`, `candidate_not_found`, `not_approved`, `script_requires_transformed`, `script_not_approved`, `worker_missing`, `model_missing` (modelo Whisper local ausente), `narration_missing` (nenhum bloco tem WAV atual), `generation_in_progress` (já há alinhamento ativo), `narration_align_failed` / `worker_protocol` (durante o job).
- **Eventos e jobs:** enfileira job `narration_align` na fila persistida (`jobs`); emite `core-progress` com `stage: "aligning"` (progresso do worker e por bloco até 99%) e no fim `"complete"` (100%) ou `"failed"` (0%). Cancelável via `jobs.cancel { id }`.
- **Pré-condições:** Roteiro 100% aprovado, pelo menos um bloco com WAV no Projeto, worker Python e modelo Whisper local instalados.
- **Tela hoje:** [Narration.tsx](../../../src/features/projects/Narration.tsx)
- **Mock TS:** sim, em [core.ts](../../../src/lib/core.ts).
- **US (#26):** US-95.
- **Código:** [narration_align.rs:1757](../../../core/src/narration_align.rs#L1757)

### `narration.align_block`
- **O que faz:** Enfileira o alinhamento por palavra apenas para um bloco específico de Narração.
- **Entrada:** `{ candidate: number, block?: number, blockId?: number }` (`candidate` e `block`/`blockId` obrigatórios).
- **Saída:** `{ job: number, candidate: number, blockId: number }`.
- **Erros:** mesmos de `narration.align` mais `block_not_found`.
- **Eventos e jobs:** mesmos de `narration.align` (job `narration_align` para 1 bloco). Cancelável via `jobs.cancel { id }`.
- **Pré-condições:** mesmas de `narration.align`, com WAV existente para o bloco informado.
- **Tela hoje:** [Narration.tsx](../../../src/features/projects/Narration.tsx)
- **Mock TS:** sim, em [core.ts](../../../src/lib/core.ts).
- **US (#26):** US-95.
- **Código:** [narration_align.rs:1758](../../../core/src/narration_align.rs#L1758)

### `narration.review`
- **O que faz:** Resolve um desvio de alinhamento (`needs_review` ou já alinhado), escolhendo se a legenda do bloco usará as palavras do Roteiro (`"script"`) ou as palavras faladas detectadas (`"spoken"`), e marca o alinhamento como `approved`.
- **Entrada:** `{ candidate: number, block?: number, blockId?: number, choice: "script" | "spoken" }` (todos obrigatórios).
- **Saída:** `{ candidate: number, blockId: number, alignment: { status: "approved", choice: "script" | "spoken", activeTrack: "script" | "spoken", substitutions, insertions, deletions, maxConsecutiveInsertions, errorCode, modelId, spokenText, wordCount } }`.
- **Erros:** `project_not_open`, `candidate_not_found`, `block_not_found`, `invalid_review_choice`, `not_approved`, `script_requires_transformed`, `script_not_approved`, `narration_missing`, `alignment_missing` (bloco ainda não foi alinhado).
- **Eventos e jobs:** nenhum (síncrono).
- **Pré-condições:** bloco com áudio alinhado (`narration_aligned_words` presente para a faixa escolhida).
- **Tela hoje:** [Narration.tsx](../../../src/features/projects/Narration.tsx)
- **Mock TS:** sim, em [core.ts](../../../src/lib/core.ts).
- **US (#26):** US-95.
- **Código:** [narration_align.rs:1759](../../../core/src/narration_align.rs#L1759)

### `narration.cleanup.set`
- **O que faz:** Liga ou desliga a limpeza de voz (`highpass` + `afftdn`) de um bloco gravado ou importado (não altera o WAV original).
- **Entrada:** `{ candidate: number, block?: number, blockId?: number, enabled: boolean }` (todos obrigatórios).
- **Saída:** `{ candidate: number, blockId: number, narrationId: number, cleanup: { applicable: true, enabled: boolean, ready: boolean, noiseFloorDb: number | null, noiseFloorSource: "pending" | "vad" | "default", warningCode: string | null, warning: string | null } }`.
- **Erros:** `project_not_open`, `candidate_not_found`, `block_not_found`, `invalid_cleanup_state`, `not_approved`, `script_requires_transformed`, `script_not_approved`, `narration_missing`, `cleanup_not_applicable` (bloco gerado por TTS).
- **Eventos e jobs:** nenhum (síncrono).
- **Pré-condições:** bloco atual com áudio gravado (`recorded`) ou importado (`imported`).
- **Tela hoje:** [Narration.tsx](../../../src/features/projects/Narration.tsx)
- **Mock TS:** sim, em [core.ts](../../../src/lib/core.ts).
- **US (#26):** US-130.
- **Código:** [narration_cleanup.rs:1019](../../../core/src/narration_cleanup.rs#L1019)

### `narration.cleanup.prepare`
- **O que faz:** Gera de forma síncrona o arquivo derivado `.clean.wav` via FFmpeg para que o usuário possa ouvir a comparação "Antes" e "Depois" da limpeza de voz na interface (no export, isso também ocorre automaticamente se estiver pendente).
- **Entrada:** `{ candidate: number, block?: number, blockId?: number }` (`candidate` e `block`/`blockId` obrigatórios).
- **Saída:** `{ candidate: number, blockId: number, narrationId: number, enabled: boolean, ready: true, cleanRelPath: string, durationUs: number, noiseFloorDb: number, noiseFloorSource: "vad" | "default", warningCode: string | null, warning: string | null }`.
- **Erros:** erros de `narration.cleanup.set` (exceto `invalid_cleanup_state`) mais `ffmpeg_missing`, `narration_cleanup_failed`.
- **Eventos e jobs:** nenhum (executa síncrono sob guarda `projects::start_job()`, sem `ProgressEvent`).
- **Pré-condições:** bloco com áudio `recorded` ou `imported` e Componente FFmpeg instalado.
- **Tela hoje:** [Narration.tsx](../../../src/features/projects/Narration.tsx)
- **Mock TS:** sim, em [core.ts](../../../src/lib/core.ts).
- **US (#26):** US-130.
- **Código:** [narration_cleanup.rs:1020](../../../core/src/narration_cleanup.rs#L1020)

---

### Capa / Thumbnail (`thumbnail.*`)

### `thumbnail.estimate`
- **O que faz:** Verifica se a sugestão de momento para capa usa Provedor pago (usando a rota de `packaging`) e estima o custo antes de enviar texto da Transcrição.
- **Entrada:** `{ candidate: number }` (`candidate` obrigatório).
- **Saída:** `{ paid: boolean, profile: string, estimate: { kind: "usd" | "zero" | "plan_quota" | "unknown", minMicroUsd: number | null, maxMicroUsd: number | null } }`.
- **Erros:** `project_not_open`, `candidate_not_found`, `not_approved`, `adjust_out_of_transcript`, `source_missing`, `invalid_settings`, `local_only_violation`, `angle_invalid`.
- **Eventos e jobs:** nenhum (síncrono).
- **Pré-condições:** Projeto aberto, candidato aprovado e Provedor configurado para `packaging` (que também roteia `thumbnail`).
- **Tela hoje:** [Thumbnail.tsx](../../../src/features/projects/Thumbnail.tsx)
- **Mock TS:** sim, em [thumbnailMock.ts](../../../src/lib/thumbnailMock.ts).
- **US (#26):** US-100, US-128.
- **Código:** [thumbnail.rs:631](../../../core/src/thumbnail.rs#L631)

### `thumbnail.suggest`
- **O que faz:** Enfileira a Tarefa de IA `thumbnail` para sugerir uma Frase do Corte e justificativa como capa; quando o job conclui, `thumbnail.get` converte o ID da Frase no instante médio dela e define-o como escolha atual.
- **Entrada:** `{ candidate: number, confirmed?: boolean }` (`candidate` obrigatório; `confirmed: true` obrigatório quando pago).
- **Saída:** `{ job: number }`.
- **Erros:** mesmos de `thumbnail.estimate` mais `confirmation_required` (com `usage.estimate`), `suggestion_in_progress` (já existe sugestão rodando para o Corte), `unknown_task`, `project_write`.
- **Eventos e jobs:** enfileira job `ai:thumbnail` na fila persistida (`jobs`); emite `core-progress` com `stage: "ai:thumbnail:call"` (10%), `"ai:thumbnail:verify"` (80%) e `"ai:thumbnail:done"` (100% ou 0% com erro). Cancelável via `jobs.cancel { id }`.
- **Pré-condições:** Projeto aberto, candidato aprovado, sem sugestão em andamento e Provedor configurado para `packaging`.
- **Tela hoje:** [Thumbnail.tsx](../../../src/features/projects/Thumbnail.tsx)
- **Mock TS:** sim, em [thumbnailMock.ts](../../../src/lib/thumbnailMock.ts).
- **US (#26):** US-100, US-128.
- **Código:** [thumbnail.rs:632](../../../core/src/thumbnail.rs#L632)

### `thumbnail.get`
- **O que faz:** Materializa sugestões concluídas de capa e devolve a escolha atual, o último job, o histórico de sugestões/escolhas e os limites do Corte.
- **Entrada:** `{ candidate: number }` (`candidate` obrigatório).
- **Saída:** `{ schemaVersion: 1, candidate: { run, startId, endId }, source: number, cut: { startUs, endUs }, current: { id, instantUs, origin: "provider" | "user", suggestionId, createdAt, why } | null, job: { id, state, code, violations } | null, suggestions: [...], choices: [...], maxWhyChars: 200 }`.
- **Erros:** `project_not_open`, `candidate_not_found`, `not_approved`, `adjust_out_of_transcript`, `source_missing`, `project_read`, `project_write`.
- **Eventos e jobs:** nenhum (síncrono).
- **Pré-condições:** Projeto aberto e candidato aprovado.
- **Tela hoje:** [Thumbnail.tsx](../../../src/features/projects/Thumbnail.tsx)
- **Mock TS:** sim, em [thumbnailMock.ts](../../../src/lib/thumbnailMock.ts).
- **US (#26):** US-100.
- **Código:** [thumbnail.rs:633](../../../core/src/thumbnail.rs#L633)

### `thumbnail.choose`
- **O que faz:** Registra um instante específico da Fonte (dentro das bordas do Corte) escolhido manualmente pelo usuário como capa.
- **Entrada:** `{ candidate: number, instant_us: number }` (ambos obrigatórios; `instant_us` deve estar entre `cut.startUs` e `cut.endUs`).
- **Saída:** o mesmo documento completo de `thumbnail.get`.
- **Erros:** erros de `thumbnail.get` mais `instant_out_of_cut`.
- **Eventos e jobs:** nenhum (síncrono).
- **Pré-condições:** Projeto aberto e candidato aprovado.
- **Tela hoje:** [Thumbnail.tsx](../../../src/features/projects/Thumbnail.tsx)
- **Mock TS:** sim, em [thumbnailMock.ts](../../../src/lib/thumbnailMock.ts).
- **US (#26):** US-100.
- **Código:** [thumbnail.rs:634](../../../core/src/thumbnail.rs#L634)

### `thumbnail.export`
- **O que faz:** Extrai localmente com FFmpeg um único quadro em PNG (tamanho nativo da Fonte, sem crop, filtros nem texto) do instante escolhido (ou do `instant_us` informado) e grava no caminho escolhido pelo usuário sem sobrescrever arquivos existentes.
- **Entrada:** `{ candidate: number, output: string, instant_us?: number }` (`candidate` e `output` caminho absoluto `.png` obrigatórios).
- **Saída:** `{ output: string, instantUs: number }`.
- **Erros:** `project_not_open`, `candidate_not_found`, `not_approved`, `adjust_out_of_transcript`, `source_missing`, `thumbnail_destination` (caminho relativo, pasta inexistente ou sem extensão `.png`), `thumbnail_exists` (arquivo já existe no destino), `instant_out_of_cut`, `no_instant` (sem capa escolhida nem `instant_us`), `invalid_project`, `source_not_found`, `source_offline`, `source_changed`, `component_missing` (FFmpeg ausente), `thumbnail_failed` (timeout de 60 s ou erro do FFmpeg/PNG).
- **Eventos e jobs:** nenhum (executa síncrono sob guarda `projects::start_job()`).
- **Pré-condições:** Projeto aberto, candidato aprovado, Fonte online e inalterada, Componente FFmpeg instalado e um instante escolhido (ou passado na chamada).
- **Tela hoje:** [Thumbnail.tsx](../../../src/features/projects/Thumbnail.tsx)
- **Mock TS:** sim, em [thumbnailMock.ts](../../../src/lib/thumbnailMock.ts).
- **US (#26):** US-100, US-110.
- **Código:** [thumbnail.rs:635](../../../core/src/thumbnail.rs#L635)

---

### Empacotamento (`packaging.*`)

### `packaging.estimate`
- **O que faz:** Verifica se o Provedor da Tarefa de IA `packaging` é pago, detecta o idioma (ou valida o informado) e estima o custo para gerar título, descrição, tags e hashtags.
- **Entrada:** `{ candidate: number, language?: "pt-BR" | "en" }` (`candidate` obrigatório; `language` obrigatório quando a detecção automática não define PT-BR/EN).
- **Saída:** `{ paid: boolean, profile: string, language: "pt-BR" | "en", estimate: { kind: "usd" | "zero" | "plan_quota" | "unknown", minMicroUsd: number | null, maxMicroUsd: number | null } }`.
- **Erros:** `project_not_open`, `candidate_not_found`, `not_approved`, `adjust_out_of_transcript`, `source_missing`, `invalid_settings`, `local_only_violation`, `language_required`, `angle_invalid`.
- **Eventos e jobs:** nenhum (síncrono).
- **Pré-condições:** Projeto aberto, candidato aprovado e Provedor configurado para `packaging`.
- **Tela hoje:** [Packaging.tsx](../../../src/features/projects/Packaging.tsx)
- **Mock TS:** sim, em [packagingMock.ts](../../../src/lib/packagingMock.ts).
- **US (#26):** US-98, US-99, US-128.
- **Código:** [packaging.rs:1068](../../../core/src/packaging.rs#L1068)

### `packaging.generate`
- **O que faz:** Enfileira a geração do Empacotamento (título, descrição, tags e hashtags) pelo Provedor; quando concluído, `packaging.get` materializa os campos e anexa capítulos automaticamente se aplicáveis.
- **Entrada:** `{ candidate: number, language?: "pt-BR" | "en", confirmed?: boolean }` (`candidate` obrigatório; `confirmed: true` obrigatório se pago).
- **Saída:** `{ job: number, language: "pt-BR" | "en" }`.
- **Erros:** mesmos de `packaging.estimate` mais `confirmation_required` (com `usage.estimate`), `generation_in_progress`, `unknown_task`, `project_write`.
- **Eventos e jobs:** enfileira job `ai:packaging` na fila persistida (`jobs`); emite `core-progress` com `stage: "ai:packaging:call"` (10%), `"ai:packaging:verify"` (80%) e `"ai:packaging:done"` (100% ou 0% com erro). Cancelável via `jobs.cancel { id }`.
- **Pré-condições:** Projeto aberto, candidato aprovado, sem geração em andamento para o Corte e Provedor configurado para `packaging`.
- **Tela hoje:** [Packaging.tsx](../../../src/features/projects/Packaging.tsx)
- **Mock TS:** sim, em [packagingMock.ts](../../../src/lib/packagingMock.ts).
- **US (#26):** US-98, US-99, US-101, US-128.
- **Código:** [packaging.rs:1069](../../../core/src/packaging.rs#L1069)

### `packaging.get`
- **O que faz:** Materializa a última geração concluída e devolve o documento completo do Empacotamento (campos atuais, descrição completa com crédito não editável, status de capítulos, histórico de gerações/edições e limites).
- **Entrada:** `{ candidate: number }` (`candidate` obrigatório).
- **Saída:** `{ schemaVersion: 1, revision: number, candidate: { run, startId, endId }, detectedLanguage: "pt-BR" | "en" | null, languageRequired: boolean, current: { generation, language, edited, title, description, tags, hashtags, fullDescription } | null, credit: { text: string | null, warning: "no_permission" | null }, chapters: { applicable, canGenerate, status, hasDelimiters, delimiters: { start, end }, suggested, block, generationWarning, editWarnings }, job: { id, state, code, violations } | null, limits: { titleChars: 100, descriptionBytes: 5000, tagsChars: 500, tags: 30, tagChars: 60, hashtags: 15 }, generations: [...], source: number }`.
- **Erros:** `project_not_open`, `candidate_not_found`, `not_approved`, `adjust_out_of_transcript`, `source_missing`, `project_read`, `project_write`.
- **Eventos e jobs:** nenhum (síncrono).
- **Pré-condições:** Projeto aberto e candidato aprovado.
- **Tela hoje:** [Packaging.tsx](../../../src/features/projects/Packaging.tsx)
- **Mock TS:** sim, em [packagingMock.ts](../../../src/lib/packagingMock.ts).
- **US (#26):** US-98, US-99, US-101.
- **Código:** [packaging.rs:1070](../../../core/src/packaging.rs#L1070)

### `packaging.edit`
- **O que faz:** Salva uma edição manual nos campos de Empacotamento (sem permitir editar o crédito da Fonte, que é anexado na exibição), validando os limites do YouTube. Quando ainda não houve `packaging.generate` prévio (`current === null`), inicializa uma ficha manual vazia e persiste a edição sem exigir Provedor.
- **Entrada:** `{ candidate: number, title?: string, description?: string, tags?: string[], hashtags?: string[], language?: "pt-BR" | "en" }` (`candidate` obrigatório; demais opcionais, com `language` usado na inicialização manual caso o idioma do Corte não seja detectável).
- **Saída:** o mesmo documento completo de `packaging.get`.
- **Erros:** erros de `packaging.get` mais `invalid_edit` (tipos inválidos), `edit_invalid` (com `usage.violations`: `title_empty`, `title_too_long`, `description_too_long`, `forbidden_character`, `too_many_tags`, `invalid_tag`, `tag_too_long`, `tags_too_long`, `too_many_hashtags`, `invalid_hashtag`).
- **Eventos e jobs:** nenhum (síncrono).
- **Pré-condições:** Projeto aberto e candidato aprovado (com ou sem geração prévia de Empacotamento).
- **Tela hoje:** [Packaging.tsx](../../../src/features/projects/Packaging.tsx)
- **Mock TS:** sim, em [packagingMock.ts](../../../src/lib/packagingMock.ts).
- **US (#26):** US-98, US-99, US-101.
- **Código:** [packaging.rs:1071](../../../core/src/packaging.rs#L1071)

### `packaging.refresh_chapters`
- **O que faz:** Recalcula os capítulos do YouTube a partir do plano de montagem da Narração e substitui apenas o bloco delimitado (`--- Capítulos ---` ... `--- Fim dos capítulos ---` ou em EN) dentro da descrição atual, preservando edições do usuário.
- **Entrada:** `{ candidate: number, description?: string }` (`candidate` obrigatório; `description` opcional caso haja edição não salva no formulário).
- **Saída:** o mesmo documento completo de `packaging.get`.
- **Erros:** erros de `packaging.get` mais `nothing_to_edit`, `invalid_edit`, `chapters_require_transformed` (Corte direto), `chapter_delimiters_missing` (delimitadores removidos pelo usuário), `script_not_approved`, `narration_required`, `too_few_chapters`, `chapters_unavailable`, `edit_invalid`.
- **Eventos e jobs:** nenhum (síncrono).
- **Pré-condições:** Empacotamento já gerado, Vídeo transformado com Roteiro aprovado, Narração real em todos os blocos, ao menos 3 capítulos `>= 10 s` e delimitadores de capítulos presentes na descrição.
- **Tela hoje:** [Packaging.tsx](../../../src/features/projects/Packaging.tsx)
- **Mock TS:** sim, em [packagingMock.ts](../../../src/lib/packagingMock.ts).
- **US (#26):** US-101.
- **Código:** [packaging.rs:1072](../../../core/src/packaging.rs#L1072)

---

### Exportação (`export.*`)

### `export.captions`
- **O que faz:** Calcula e retorna a legenda final para o preview do editor e checagem pré-export: texto ASS completo, *cues* por palavra, estilo aplicado, lista de glifos ausentes na fonte, faixa ativa (`narration`, `original` ou `translated`) e faixas disponíveis.
- **Entrada:** `{ source_id: number, start_id: number, end_id: number, candidate_id?: number, clip_id?: number, track?: "narration" | "original" | "translated" }` (`source_id`, `start_id` e `end_id` obrigatórios; `track` opcional para sobrescrever a faixa na consulta).
- **Saída:** `{ ass: string, lines: [...], start_us: number, end_us: number, durationUs: number, segments: [...], cues: [...], style: object, emojiRemoved: boolean, words: [...], transcriptId: number, missingGlyphs: [...], track: "narration" | "original" | "translated", availableTracks: string[], targetLanguage: string | null, narrationSummary: object | null }`.
- **Erros:** `project_not_open`, `export_bounds` (bordas ou Transcrição completa inválidas), `export_candidate` (candidato ausente ou não aprovado), `invalid_clip`, `caption_style_not_found` / `project_read`.
- **Eventos e jobs:** nenhum (síncrono sob guarda `projects::start_job()`).
- **Pré-condições:** Projeto aberto, Fonte com Transcrição `complete` e bordas correspondentes a Frases (e candidato aprovado, se informado).
- **Tela hoje:** [useCaptions.ts](../../../src/features/captions/useCaptions.ts)
- **Mock TS:** sim, em [captionsMock.ts](../../../src/lib/captionsMock.ts) (e roteado em [core.ts](../../../src/lib/core.ts)).
- **US (#26):** US-77, US-78, US-79, US-80, US-95.
- **Código:** [export.rs:1300](../../../core/src/export.rs#L1300)

### `export.start`
- **O que faz:** Congela o estado atual do Corte (bordas, silêncios, crop, legendas, início manual da Narração, trilha sonora e SFX), valida destino e glifos, salva a última pasta usada e enfileira um job de exportação MP4 (`1080×1920`) na fila persistida.
- **Entrada:** `{ source_id: number, start_id: number, end_id: number, candidate_id?: number, clip_id?: number, output: string }` (`output` deve ser caminho absoluto `.mp4` em pasta existente; não sobrescreve arquivos existentes).
- **Saída:** `{ job: number, state: "queued" }`.
- **Erros:** `project_not_open`, `invalid_project`, `export_bounds`, `export_candidate`, `export_exists` (arquivo já existe), `export_destination` (caminho/pasta/extensão inválidos), `source_changed` (Fonte ausente ou hash divergente), `export_glyph_missing` (com `usage: { font, missing_glyphs }`), `audio_asset_missing`, `component_missing` (FFmpeg ausente); e durante a execução do job: `export_ass_missing` (FFmpeg sem `libass`), `export_font_missing`, `export_failed`, `cancelled`, `interrupted`.
- **Eventos e jobs:** enfileira job `export` na fila persistida (`jobs`); durante execução emite `core-progress` com `stage: "export"` (de 1% a 99%) e no fim `"complete"` (100%) ou `"failed"` (0%). Cancelável via `jobs.cancel { id }`.
- **Pré-condições:** Projeto aberto, Fonte online/inalterada, Transcrição completa, candidato aprovado (quando houver), sem glifos faltando na fonte da legenda e Componente FFmpeg instalado.
- **Tela hoje:** [ExportButton.tsx](../../../src/features/export/ExportButton.tsx)
- **Mock TS:** sim, em [mock.ts](../../../src/features/export/mock.ts) (roteado em [core.ts](../../../src/lib/core.ts)).
- **US (#26):** US-106, US-108, US-109.
- **Código:** [export.rs:1299](../../../core/src/export.rs#L1299)

### `export.status`
- **O que faz:** Consulta o estado atual, progresso percentual, caminho de saída e erro (se houver) de um job de exportação individual.
- **Entrada:** `{ job: number }` (`job` obrigatório).
- **Saída:** `{ job: number, state: "queued" | "running" | "completed" | "cancelled" | "failed", progress: number, output: string, error: { code: string, message: string | null, usage?: object } | null }`. *(Nota: apesar da query SQL ler `encoder`, `fallback_from` e `fallback_reason`, o JSON retornado hoje omite esses campos.)*
- **Erros:** `project_not_open`, `invalid_job` (`job` ausente/inválido), `project_read` (job inexistente em `exports`).
- **Eventos e jobs:** nenhum (síncrono).
- **Pré-condições:** Projeto aberto e ID de job de export existente.
- **Tela hoje:** [ExportButton.tsx](../../../src/features/export/ExportButton.tsx)
- **Mock TS:** parcial, em [mock.ts](../../../src/features/export/mock.ts) (não tem `if (name === 'export.status')` explícito: cai no ramo genérico de `jobs.get`, que ainda acrescenta `encoder` e `encoder_fallback`).
- **US (#26):** US-106.
- **Código:** [export.rs:1301](../../../core/src/export.rs#L1301)

### `export.settings`
- **O que faz:** Devolve a última pasta onde o usuário exportou um Corte ou lote (apenas se ainda existir no disco) para pré-preencher o diálogo de salvar.
- **Entrada:** nenhuma (`{}`).
- **Saída:** `{ last_directory: string | null }`.
- **Erros:** `failed` / `export_failed` (se `paths::config_file` falhar ao localizar o diretório de configuração do app).
- **Eventos e jobs:** nenhum (síncrono).
- **Pré-condições:** nenhuma.
- **Tela hoje:** [ExportButton.tsx](../../../src/features/export/ExportButton.tsx), [BatchExport.tsx](../../../src/features/export/BatchExport.tsx)
- **Mock TS:** sim, em [mock.ts](../../../src/features/export/mock.ts).
- **US (#26):** US-106, US-107.
- **Código:** [export.rs:1302](../../../core/src/export.rs#L1302)

### `export.batch.start`
- **O que faz:** Coleta todos os Cortes aprovados de uma Fonte ou do Projeto inteiro, gera nomes únicos `<fonte>-<nn>-<tempo>.mp4`, verifica conflitos na pasta de destino e enfileira um job `export` por Corte válido, salvando a pasta em `export-settings.json`.
- **Entrada:** `{ output_dir: string, source_id?: number, project?: string, confirmed?: boolean }` (`output_dir` pasta absoluta existente obrigatório; sem `source_id` exporta todo o Projeto; `confirmed: true` obrigatório para sobrescrever arquivos existentes em caso de conflito).
- **Saída:** `{ id: number, scope: "source" | "project", sourceId: number | null, outputDir: string, state: "running" | "completed" | "cancelled", status: "running" | "completed" | "partial" | "failed" | "cancelled", progress: number, counts: { total, queued, running, completed, failed, cancelled }, items: [{ position, sourceId, runId, candidateId, clipId, jobId, title, filename, output, durationUs, state, progress, error, encoder, encoderFallback }] }`.
- **Erros:** `project_not_open`, `invalid_project`, `source_missing`, `export_destination`, `component_missing`, `export_batch_empty` (nenhum Corte aprovado), `confirmation_required` (com `usage: { conflicts: string[] }`). Itens individuais que falham na preparação entram no lote já como `failed` sem abortar os demais.
- **Eventos e jobs:** cria N jobs `export` na fila persistida (`jobs`); emite `core-progress` de lote com `job: "export-batch-<id>"`, `stage: "export_batch"` (progresso ponderado pela duração dos Cortes) ou `"export_batch_complete"`. Cancelável via `export.batch.cancel { id }`.
- **Pré-condições:** Projeto aberto, pelo menos um Corte aprovado e Componente FFmpeg instalado.
- **Tela hoje:** [BatchExport.tsx](../../../src/features/export/BatchExport.tsx)
- **Mock TS:** sim, em [mock.ts](../../../src/features/export/mock.ts).
- **US (#26):** US-107.
- **Código:** [export/batch.rs:814](../../../core/src/export/batch.rs#L814)

### `export.batch.status`
- **O que faz:** Consulta o estado detalhado, contagens, progresso ponderado e lista de itens de um lote de exportação específico.
- **Entrada:** `{ id: number }` (`id` do lote obrigatório).
- **Saída:** o mesmo objeto de lote retornado por `export.batch.start`.
- **Erros:** `project_not_open`, `batch_not_found`, `project_read`.
- **Eventos e jobs:** nenhum (síncrono).
- **Pré-condições:** Projeto aberto e lote criado.
- **Tela hoje:** nenhuma (sem uso na UI).
- **Mock TS:** sim, em [mock.ts](../../../src/features/export/mock.ts).
- **US (#26):** US-107.
- **Código:** [export/batch.rs:815](../../../core/src/export/batch.rs#L815)

### `export.batch.list`
- **O que faz:** Lista os lotes de exportação do Projeto (mais recentes primeiro), opcionalmente filtrados por uma Fonte.
- **Entrada:** `{ source_id?: number }` (opcional).
- **Saída:** array de objetos de lote no mesmo formato de `export.batch.status`.
- **Erros:** `project_not_open`, `project_read`.
- **Eventos e jobs:** nenhum (síncrono).
- **Pré-condições:** Projeto aberto.
- **Tela hoje:** [BatchExport.tsx](../../../src/features/export/BatchExport.tsx)
- **Mock TS:** sim, em [mock.ts](../../../src/features/export/mock.ts).
- **US (#26):** US-107.
- **Código:** [export/batch.rs:816](../../../core/src/export/batch.rs#L816)

### `export.batch.cancel`
- **O que faz:** Cancela um lote de exportação e marca todos os seus jobs individuais ainda em `queued` ou `running` para cancelamento.
- **Entrada:** `{ id: number }` (`id` do lote obrigatório).
- **Saída:** o objeto de lote atualizado (com `status: "cancelled"`).
- **Erros:** `project_not_open`, `batch_not_found`, `project_write`.
- **Eventos e jobs:** síncrono na requisição; emite `core-progress` de fundo com `job: "export-batch-<id>"` e `stage: "export_batch_cancelled"`.
- **Pré-condições:** Projeto aberto e lote existente.
- **Tela hoje:** [BatchExport.tsx](../../../src/features/export/BatchExport.tsx)
- **Mock TS:** sim, em [mock.ts](../../../src/features/export/mock.ts).
- **US (#26):** US-107.
- **Código:** [export/batch.rs:817](../../../core/src/export/batch.rs#L817)

### `export.encoder.status`
- **O que faz:** Lê o cache local de encoders H.264 sem rodar nenhum teste; informa se o FFmpeg está instalado, se a detecção já ocorreu (ou ficou obsoleta após troca de FFmpeg/driver de GPU), quais encoders passaram e qual está efetivamente em uso.
- **Entrada:** nenhuma (`{}`).
- **Saída:** se FFmpeg ausente: `{ ffmpeg: false, detected: false, passed: [], effective: "libx264" }`; se FFmpeg presente: `{ ffmpeg: true, detected: boolean, stale: boolean, passed: string[], selected: string, manual: string | null, effective: string, gpu: string, detected_at: number | null }`.
- **Erros:** nenhum (erros internos na leitura do FFmpeg ou chave de hardware resultam em `ffmpeg: false` ou `stale: false`).
- **Eventos e jobs:** nenhum (síncrono).
- **Pré-condições:** nenhuma.
- **Tela hoje:** [EncoderSettings.tsx](../../../src/features/preferences/EncoderSettings.tsx)
- **Mock TS:** sim, em [mock.ts](../../../src/features/export/mock.ts).
- **US (#26):** US-15.
- **Código:** [export/encoder.rs:582](../../../core/src/export/encoder.rs#L582)

### `export.encoder.detect`
- **O que faz:** Executa a sonda real de encoders (`ffmpeg -encoders` + export curto de `1 s` em `1080×1920` validado com `ffprobe`) na ordem `h264_nvenc`, `h264_qsv`, `h264_amf`, `h264_videotoolbox` e `libx264`, e salva o cache `export-encoder.json`.
- **Entrada:** nenhuma (`{}`).
- **Saída:** o mesmo objeto completo de `export.encoder.status` (com `detected: true`, `stale: false`).
- **Erros:** `component_missing` (FFmpeg ausente), `ffprobe_missing`, `export_failed` (falha ao listar encoders, erro de I/O no cache ou timeout de `30 s` por sonda).
- **Eventos e jobs:** nenhum (síncrono; bloqueia a chamada enquanto testa os encoders presentes).
- **Pré-condições:** Componente FFmpeg (com `ffprobe`) instalado.
- **Tela hoje:** [EncoderSettings.tsx](../../../src/features/preferences/EncoderSettings.tsx)
- **Mock TS:** sim, em [mock.ts](../../../src/features/export/mock.ts).
- **US (#26):** US-15.
- **Código:** [export/encoder.rs:583](../../../core/src/export/encoder.rs#L583)

### `export.encoder.set`
- **O que faz:** Define manualmente um encoder aprovado na última detecção (ou `null` para voltar ao modo automático mais rápido) no cache `export-encoder.json`.
- **Entrada:** `{ encoder: string | null }` (`encoder` deve estar na lista `passed` do cache ou ser `null`).
- **Saída:** o mesmo objeto completo de `export.encoder.status`.
- **Erros:** `encoder_invalid` (encoder desconhecido, ausente de `passed`, ou cache ainda não detectado), `export_failed` (erro ao gravar cache).
- **Eventos e jobs:** nenhum (síncrono).
- **Pré-condições:** detecção já executada (`export-encoder.json` presente).
- **Tela hoje:** [EncoderSettings.tsx](../../../src/features/preferences/EncoderSettings.tsx)
- **Mock TS:** sim, em [mock.ts](../../../src/features/export/mock.ts).
- **US (#26):** US-15.
- **Código:** [export/encoder.rs:584](../../../core/src/export/encoder.rs#L584)

---

## Estados e eventos do domínio

### Eventos `core-progress` emitidos neste domínio

| `job` | `stage` | Quando acontece | `percentage` | Pode trazer `error`? |
|---|---|---|---|---|
| `<id numérico>` | `ai:script:call` | Chamando o Provedor para o esboço do Roteiro | `10` | Não |
| `<id numérico>` | `ai:script:verify` | Rodando verificadores determinísticos do esboço | `80` | Não |
| `<id numérico>` | `ai:script:done` | Esboço concluído ou falho/cancelado/incerto | `100` (sucesso) ou `0` (erro) | Sim (`CoreError`) |
| `<id numérico>` | `ai:script_block:call` | Chamando o Provedor para o texto de um bloco | `10` | Não |
| `<id numérico>` | `ai:script_block:verify` | Validando texto/idioma/tamanho do bloco | `80` | Não |
| `<id numérico>` | `ai:script_block:done` | Bloco concluído ou falho/cancelado/incerto | `100` (sucesso) ou `0` (erro) | Sim (`CoreError`) |
| `<id numérico>` | `ai:thumbnail:call` | Chamando o Provedor para sugerir Frase da capa | `10` | Não |
| `<id numérico>` | `ai:thumbnail:verify` | Verificando Frase dentro do Corte e justificativa | `80` | Não |
| `<id numérico>` | `ai:thumbnail:done` | Sugestão de capa concluída ou falha | `100` (sucesso) ou `0` (erro) | Sim (`CoreError`) |
| `<id numérico>` | `ai:packaging:call` | Chamando o Provedor para título/descrição/tags | `10` | Não |
| `<id numérico>` | `ai:packaging:verify` | Verificando limites do YouTube e idioma | `80` | Não |
| `<id numérico>` | `ai:packaging:done` | Empacotamento concluído ou falho | `100` (sucesso) ou `0` (erro) | Sim (`CoreError`) |
| `<id numérico>` | `narration` | A cada bloco sintetizado pelo `pocket-tts` | `1` a `99` | Não |
| `<id numérico>` | `complete` / `failed` | Fim de job `narration`, `narration_import`, `narration_align` ou `export` | `100` (`complete`) / `0` (`failed`) | Sim (quando `failed`) |
| `narration_record` | `vad` | Durante `narration.record_block` (40%) ou `narration.trim_block` (50%) ao chamar Silero VAD | `40` ou `50` | Não |
| `narration_record` | `done` | Ao salvar o WAV gravado em `narration.record_block` | `100` | Não |
| `0` | `narration_record` | Chamada extra de `jobs::progress(0, ...)` no fim de `narration.record_block` | `100` | Não |
| `<id numérico>` | `narration_import` | Validação `ffprobe` (10%), conversão FFmpeg (35%), salvamento (85%) | `10`, `35`, `85` | Não |
| `<id numérico>` | `aligning` | Progresso do worker Whisper durante `narration_align` | `0` a `99` | Não |
| `<id numérico>` | `export` | Progresso do render FFmpeg durante `export.start` / item de lote | `1` a `99` | Não |
| `export-batch-<id>` | `export_batch` | Início e avanço ponderado de lote de exportação | `0` a `100` | Não |
| `export-batch-<id>` | `export_batch_complete` | Todos os itens do lote terminaram (ou falharam na preparação) | `0` a `100` | Não |
| `export-batch-<id>` | `export_batch_cancelled` | Lote cancelado via `export.batch.cancel` | `0` a `100` | Não |

### Estados dos objetos do domínio

- **Bloco do Roteiro (`script_blocks`):** `pendente` (sem texto ou com nova versão ainda não aprovada ou após troca de ângulo -> `stale: true`) → `aprovado` (versão atual e revisão de ângulo atual registradas em `script_approvals`). Editar ou regenerar retorna o bloco para `pendente`.
- **Trava da Narração (`narrationAllowed`):** `false` (`gateReason`: `"no_script"`, `"generating"` ou `"pending_blocks"`) → `true` (todos os blocos aprovados na versão atual e nenhum job de Roteiro ativo).
- **Áudio de Narração do bloco (`narration_blocks`):** inexistente → presente (`engineId`: `"pocket-tts"`, `"recorded"` ou `"imported"`); fica `stale: true` se o Roteiro do bloco ganhar uma nova versão depois da geração/gravação/importação; em gravações, `trimmed` é `true` (`"silero-vad"`) ou `false` (`"untrimmed"`).
- **Alinhamento da Narração (`narration_alignments.status`):** `pending` (recém-sintetizado/gravado/importado ou áudio alterado) → `aligned` (sem desvios relevantes; `activeTrack: "script"`) ou `needs_review` (`>= 2` inserções seguidas ou `>= 3` substituições) ou `failed` → `approved` (usuário escolheu `choice`: `"script"` ou `"spoken"` via `narration.review`).
- **Limpeza de voz (`narration_cleanups`):** não aplicável (`null` para TTS); para `recorded`/`imported`, `enabled` (`true` por padrão, alternável via `narration.cleanup.set`), `ready` (`false` até gerar `.clean.wav` via `narration.cleanup.prepare` ou durante o export) e `noiseFloorSource` (`"pending"`, `"vad"` ou `"default"`).
- **Capa (`thumbnail`):** sem escolha → `origin: "provider"` (sugestão da IA materializada) ou `origin: "user"` (`thumbnail.choose`).
- **Capítulos do Empacotamento (`chapters.status`):** `"not_transformed"` (Corte direto) | `"script_not_approved"` | `"narration_required"` (ainda usa estimativa por caracteres) | `"too_few_chapters"` (menos de 3 blocos `>= 10 s`) | `"ready"`.
- **Job de exportação (`export.status`):** `queued` → `running` → `completed` | `cancelled` | `failed`.
- **Lote de exportação (`export.batch.*`):** `state` no banco (`running` | `completed` | `cancelled`); `status` derivado na leitura (`running` | `completed` | `partial` | `failed` | `cancelled`).

---

## Configurações deste domínio

| Configuração / Preferência | Onde vive | Quem lê / grava |
|---|---|---|
| **Última pasta de exportação** (`last_directory`) | Arquivo global `export-settings.json` em `config_dir` (`AppDirs` em [paths.rs](../../../core/src/paths.rs#L247); no Windows `%LOCALAPPDATA%\io.github.gustavohooo.clipes\`, ou `CLIPES_DATA_DIR`) | Lida por `export.settings`; gravada automaticamente por `export.start` e `export.batch.start` |
| **Cache e escolha manual de encoder** (`export-encoder.json`) | Arquivo global `export-encoder.json` em `data_dir` (`AppDirs` em [paths.rs](../../../core/src/paths.rs#L243)) | Lida por `export.encoder.status` e `export::run`; gravada por `export.encoder.detect`, `export.encoder.set` e remoção de encoder falho (`forget`) |
| **Voz padrão da Narração do canal** (`narration_voice`) | SQLite do Projeto (`*.clipes`), tabela `channel_profile` | Gravada por `channel_profile.set`; lida por `narration.get`, `narration.generate` e `narration.regenerate_block` quando `voiceId` não é passado |
| **Modelos TTS ativos por idioma** (`active_models`) e caminho do FFmpeg / `pocket-tts` | Arquivo global de configurações de Componentes (`components::load_settings`) | Gravados por `tts.models.choose` e `components.*`; lidos por `narration.get`, `narration.generate`, `narration.regenerate_block`, `narration_import`, `narration_record`, `narration_cleanup`, `thumbnail.export`, `export.*` |
| **Roteamento de Provedor por Tarefa de IA** (`script`, `packaging`) e **Somente local** | Arquivo global de Provedor (`provider.json`) + chaves no **cofre do sistema** (`keyring`, serviço `io.github.gustavohooo.clipes.provider`) + veto por Projeto no SQLite (`projects.local_only`) | Lidos por `script.estimate`/`generate`/`regenerate`, `packaging.estimate`/`generate` e `thumbnail.estimate`/`suggest` (que usa a rota de `packaging`) |
| **Faixa de legenda preferida por candidato** (`track`) | SQLite do Projeto (`*.clipes`), tabela `narration_caption_tracks` | Lida por `export.captions` e `export.start`; gravada por `captions.track.set` / tradução |
| **Variáveis de ambiente relevantes** | Ambiente do processo | `CLIPES_DATA_DIR` isola `data_dir`, `config_dir` e `cache_dir` (sem migrar dados legados); `CLIPES_FFPROBE` sobrescreve o caminho do `ffprobe` em `narration_import` |

---

## Observações para o front novo

1. **`export.status` hoje omite o fallback de encoder que a UI espera:** em [export.rs:1125-1138](../../../core/src/export.rs#L1125-L1138), o SQL seleciona `e.encoder, e.fallback_from, e.fallback_reason`, mas o `json!(...)` retornado devolve apenas `job`, `state`, `progress`, `output` e `error`. Já [ExportButton.tsx:190](../../../src/features/export/ExportButton.tsx#L190) e [mock.ts:141](../../../src/features/export/mock.ts#L141) esperam `encoder_fallback`. Nos itens de `export.batch.status`/`list`, o campo existe como `encoderFallback` (`camelCase`).
2. **Dois comandos sem uso na UI hoje:**
   - `script.narration_allowed` existe no núcleo ([script.rs:1499](../../../core/src/script.rs#L1499)), não é chamado em `src/features/**` e não existe em [scriptMock.ts](../../../src/lib/scriptMock.ts) (hoje a UI usa o campo `narrationAllowed` de `script.get` e `narration.get`).
   - `export.batch.status` existe no núcleo ([batch.rs:815](../../../core/src/export/batch.rs#L815)) e no mock ([mock.ts:98](../../../src/features/export/mock.ts#L98)), mas [BatchExport.tsx](../../../src/features/export/BatchExport.tsx) só chama `export.batch.list`.
3. **Inconsistência de nomenclatura (`snake_case` vs `camelCase`) e aliases:**
   - `thumbnail.choose` e `thumbnail.export` recebem `instant_us`, mas retornam `instantUs`.
   - `export.start`, `export.captions`, `export.batch.start`, `export.batch.list` e `export.settings` usam `snake_case` (`source_id`, `start_id`, `end_id`, `candidate_id`, `clip_id`, `output_dir`, `last_directory`), enquanto `script.*`, `narration.*`, `thumbnail.*` e `packaging.*` usam `candidate` e `camelCase` (`voiceId`, `modelId`, `audioBase64`, `mimeType`, `profileId`).
   - Os comandos `narration.*` aceitam tanto `block` quanto `blockId`; os comandos `script.*` aceitam apenas `block`.
4. **Mocks TS com lacunas ou divergências:**
   - [scriptMock.ts](../../../src/lib/scriptMock.ts) não implementa `script.narration_allowed`, ignora `profileId` e em `script.edit` só aplica `narration` (ignora `title` e `refs`).
   - [mock.ts](../../../src/features/export/mock.ts) não trata `export.status` explicitamente (cai no ramo genérico de jobs) e retorna `encoder_fallback`, que o núcleo real ainda não serializa.
   - Os arquivos de áudio em `narration.record_block` / `narration.cleanup.prepare` no modo mock não servem WAVs reais na URL de mídia, e nenhum mock simula eventos `core-progress` em tempo real (as telas atuais fazem *polling* com `setInterval` de `800 ms` ou `500 ms` como fallback).
5. **Erros não mapeados nas telas atuais e funcionalidades ocultas:**
   - `script.estimate` e `script.regenerate` aceitam `profileId` opcional no núcleo ("refazer com o perfil X"), mas [Script.tsx](../../../src/features/projects/Script.tsx) não expõe seleção de perfil por bloco. Além disso, `Script.tsx` não possui mensagens específicas para `angle_required`, `nothing_to_edit`, `nothing_to_approve` e `invalid_settings` (caem em erro genérico).
   - [EncoderSettings.tsx](../../../src/features/preferences/EncoderSettings.tsx) mostra a mesma mensagem genérica para qualquer erro de `export.encoder.detect` ou `export.encoder.set`, sem distinguir `component_missing`, `ffprobe_missing` ou `encoder_invalid`.
   - Em `narration.record_block`, o núcleo emite `core-progress` com `job: "narration_record"` via `EventSink` **e** também dispara `jobs::progress(0, "narration_record", 100, ...)` com `job: "0"` para o emissor global.
   - `export.settings` é somente leitura: não existe `export.settings.set` — a pasta só é atualizada quando `export.start` ou `export.batch.start` são aceitos.
