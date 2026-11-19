# Transcrição, correções, tradução e energia

## A jornada

Depois de instalar os Componentes e importar uma Fonte no Projeto (com a faixa de áudio de microfone e o idioma definidos), o usuário transforma o áudio da live ou do vídeo em texto pesquisável e cronometrado. Nesta etapa, ele estima o tempo ou o custo, dispara a Transcrição no Motor de transcrição local ou remoto, acompanha o progresso em blocos (podendo cancelar e retomar depois sem perder o que já foi feito), revisa e corrige palavras erradas com desfazer/refazer, e busca trechos em todas as Transcrições do Projeto.

Quando a Transcrição termina, o núcleo segmenta as palavras em Frases com IDs estáveis e enfileira automaticamente a análise de energia do áudio da Fonte. Esse mapa de energia (picos e trechos altos de volume) alimenta a etapa seguinte — a seleção de Cortes pelo Provedor — e a Transcrição em Frases serve de base para o editor do Corte, legendas karaokê, Roteiro e Empacotamento. Por fim, dentro de um Corte já criado e quando a Permissão da Fonte autoriza explicitamente o escopo "tradução", o usuário pode gerar e editar uma faixa de legenda traduzida entre PT-BR e EN sem alterar a Transcrição original.

### Conceitos deste domínio

- **Transcrição local vs. remota (Groq):**
  - **Local (padrão):** roda no **worker Python de ML** (`clipes_worker`, instalado em ambiente isolado via `uv`, sem usar o Python do sistema), usando `faster-whisper` (`BatchedInferencePipeline`, `beam_size=5`, `word_timestamps=True`) e VAD Silero (`threshold=0.75`, silêncio mínimo de `200 ms`, fala máxima de `30 s`). Na GPU NVIDIA compatível (CUDA), o núcleo sonda a VRAM livre e testa a cadeia `int8_float16` → `float16` → `int8` com `whisper-turbo` (`whisper-large-v3-turbo`); se não houver NVIDIA (incluindo GPUs AMD ou Intel) ou a sonda falhar/expirar, cai para CPU (`whisper-small` em `int8`, ou `whisper-turbo` em CPU se escolhido manualmente e houver ≥ 8 GiB de RAM). Antes de começar, é possível medir uma amostra de 30 s da própria Fonte para estimar a duração.
  - **Remota (Groq):** só roda por escolha explícita (`engine: "groq"`). O VAD Silero ainda roda localmente no worker para pular trechos sem fala, e o áudio dos blocos com fala é extraído em FLAC 16 kHz mono e enviado por HTTPS para `https://api.groq.com/openai/v1/audio/transcriptions` (`whisper-large-v3-turbo`). Exige consentimento prévio salvo por endpoint, chave salva no **cofre do sistema** (keyring/Credential Manager do SO, nunca gravada em JSON, SQLite ou UI) e não pode rodar quando o modo **Somente local** está ativo no Projeto.
- **Blocos, palavras, silêncios e Frases:**
  - **Blocos (`transcription_blocks`):** o núcleo fatia a Fonte em blocos de até 10 min (`600_000_000 µs`). Cada bloco concluído grava palavras, silêncios, ponto de retomada (`resume_us`) e configuração de hardware (`transcription_block_config`) em uma única transação no SQLite. Se o app fechar ou o usuário cancelar, a retomada continua do último bloco salvo.
  - **Palavras e silêncios (`transcript_words`):** cada linha é `kind: "word"` (com `position`, texto original em `text`, timestamps nativos em microssegundos normalizados em ordem monotônica e `language` detectado por trecho de VAD quando o idioma da Fonte não estiver travado, além do campo `speaker` reservado como `null` na v1) ou `kind: "silence"` (intervalo explícito sem fala retornado pelo VAD; silêncios adjacentes entre blocos são fundidos).
  - **Frases (`sentences`):** segmentação determinística a partir do texto original das palavras e das pausas: uma Frase fecha quando uma palavra termina em pontuação final (`.`, `!`, `?`, `…`, `。`, `！`, `？`) ou quando há pausa `>= 700 ms`; Frases acima de `25 s` são divididas recursivamente na maior pausa interna. Os IDs (`1, 2, 3…`) nunca mudam após correções manuais.
- **Correções e busca:** `transcription.correct` grava o novo texto em `corrected_text` (mantendo `text` intacto para preservar o desfazer e as bordas das Frases), atualiza o texto da Frase correspondente e mantém uma pilha persistida de desfazer/refazer no SQLite do Projeto (`transcript_corrections`). Gatilhos SQLite atualizam automaticamente o índice FTS5 (`sentence_search`, com remoção de acentos) usado por `transcription.search` em todas as Transcrições do Projeto.
- **Tradução (faixas):** é uma **Tarefa de IA** (`translation`) executada em **jobs** (tarefas assíncronas enfileiradas no SQLite do Projeto) por Corte, sempre entre `pt-BR` e `en`, planejada em lotes de até 100 Frases conforme a Janela de contexto do Perfil de Provedor. O texto traduzido fica em `clip_translated_sentences`, separado da Transcrição original. Cada Corte tem uma faixa ativa (`original` ou `translated`, além de `narration` em Vídeo transformado); ao renderizar ou pré-visualizar legendas na faixa `translated`, o núcleo divide cada Frase traduzida em palavras e interpola os tempos proporcionalmente ao número de caracteres dentro dos intervalos mantidos da Frase.
- **Energia do áudio (`energy`):** após a Transcrição completar, o núcleo enfileira um job local que usa o FFmpeg para decodificar a faixa de microfone em PCM 16 kHz mono, mede a loudness por blocos de `100 ms` e guarda por Frase o maior pico momentâneo (`400 ms`) em centésimos de dBFS (`sentence_energy`). Na leitura, o núcleo compara cada Frase à distribuição da própria Fonte (mediana, percentis 20/80/95) e injeta as marcas `[energia alta]` e `[energia pico]` no texto compacto enviado ao Provedor durante a seleção de Cortes (alimentando o eixo Emoção/energia). A seleção não bloqueia esperando esse job: se ainda não estiver medida, roda sem marcas e avisa no resumo.

---

## Fluxo típico

### 1. Configurar hardware local ou chave Groq (uma vez por máquina)
1. **Local:** na tela de Componentes, a UI chama `transcription.hardware.status` e `transcription.grouping` para exibir GPU/RAM detectadas, configuração ativa e agrupamento de trechos de VAD. O usuário pode disparar `transcription.hardware.probe` (emite `core-progress` com `job: "hardware-probe"`; cancelável via `components.cancel`), trocar manualmente via `transcription.hardware.choose` ou ligar/desligar agrupamento com `transcription.grouping`.
2. **Groq (opcional):** em Preferências, a UI chama `transcription.groq.key.status` e permite salvar (`transcription.groq.key.set`), testar (`transcription.groq.key.test`) ou remover (`transcription.groq.key.remove`) a chave no cofre do sistema.

### 2. Estimar e executar a Transcrição de uma Fonte
1. Ao abrir a Fonte, a UI consulta `transcription.status` (`{ source_id }`) e `transcription.hardware.status` para saber se há Transcrição pronta, parcial ou job ativo.
2. **Estimar antes de começar:**
   - Se o Motor escolhido for `local`: a UI chama `transcription.estimate` (`{ project, source_id }`), que mede 30 s da Fonte (a partir de 25% da duração) ou reutiliza a taxa salva em cache; durante a medição emite `core-progress` (`job: "transcription-estimate"`, cancelável por `components.cancel`).
   - Se o Motor escolhido for `groq`: a UI chama `transcription.groq.info` e `transcription.groq.estimate` (`{ source_id }`) para exibir endpoint, estado de consentimento/chave/Somente local e custo estimado em USD.
3. **Iniciar ou retomar:** se for a primeira vez no endpoint do Groq, a UI obtém consentimento com `transcription.groq.confirm`. Em seguida chama `transcription.start` (`{ project, source_id, engine, ... }`), que cria o registro em `transcripts` (se novo) e enfileira o job `transcription` na fila do Projeto.
4. **Acompanhar progresso:** a UI escuta eventos `core-progress` (incluindo eventual `probe` automático na 1ª execução em GPU NVIDIA, seguido de `transcribing` e `complete`/`failed`) e reconsulta `transcription.status`. Ao concluir, o núcleo segmenta as Frases e enfileira o job `energy` automaticamente.
5. **Caminhos alternativos:**
   - **Cancelar:** a UI chama `jobs.cancel` (`{ id: job_id }`). O último bloco concluído permanece salvo em `resume_us`; chamar `transcription.start` depois retoma dali.
   - **Trocar Motor ou modelo numa parcial:** `transcription.start` retorna `engine_change_confirmation` com os dados de perda em `usage`; após confirmação do usuário, a UI reenvia com `replace_confirmed: true`, apagando a parcial e recomeçando do zero.
   - **Chamada Groq incerta após queda/timeout:** o job fica em estado `uncertain`; ao tentar retomar, `transcription.start` retorna `transcription_uncertain` (se o job ainda está `uncertain` na fila — resolver via `jobs.retry`/`jobs.discard`) ou `transcription_retry_confirmation` (se a chamada anterior naquele bloco ficou pendente/incerta — reenviar com `retry_confirmed: true`).

### 3. Ler, corrigir palavras e buscar no Projeto
1. Com `transcript.state === "complete"`, a UI chama `transcription.segment` (idempotente, garante Frases geradas) e `transcription.corrections` (estado inicial de `can_undo` / `can_redo`), e pagina os itens com `transcription.timeline`.
2. Para corrigir uma palavra, chama `transcription.correct`; para desfazer/refazer, `transcription.undo` / `transcription.redo`.
3. Para buscar em todas as Transcrições do Projeto, chama `transcription.search` (`{ query }`) e usa `row` + `sentence_id` do resultado para rolar a timeline até a Frase.

### 4. Acompanhar energia e traduzir legendas de um Corte
1. **Energia:** na tela de seleção de Cortes, a UI consulta `energy.status` (`{ source_id }`) enquanto o job `energy` roda ou está na fila; caso falte medição (ex.: Transcrição antiga ou cancelada), `energy.start` pode enfileirar novamente.
2. **Tradução de legenda:** no painel de tradução do editor de um Corte:
   - A UI chama `translation.get` (`{ clip_id }`) para checar Permissão, idioma detectado, faixa ativa e traduções salvas.
   - Ao clicar em traduzir, chama `translation.estimate` (`{ clip_id, ... }`); se `paid: true`, pede confirmação de custo ao usuário.
   - Chama `translation.start` (`{ clip_id, ..., confirmed?: true }`), que cria uma execução (`translation_runs`) e enfileira um ou mais jobs `ai:translation`.
   - Quando os jobs concluem, `translation.get` devolve as Frases traduzidas; a UI pode ativar a faixa traduzida com `translation.track.set` (`{ clip_id, track: "translated" }`) e editar linhas com `translation.edit`.

---

## Comandos

### `transcription.hardware.status`
- **O que faz:** Consulta o hardware detectado (GPU NVIDIA e RAM), se o worker de ML e o CUDA estão instalados, a configuração efetiva de Transcrição local, o histórico da última sonda compatível e todas as combinações candidatas.
- **Entrada:** nenhuma (`{}`).
- **Saída:** `{ gpu: { name, driver, total_mib, free_mib } | null, ram: { total, available } | null, cuda: boolean, no_compatible_gpu: boolean, effective: { model, device, compute_type }, manual: boolean, fallback_reason: "probe_timeout" | "gpu_probe_failed" | null, probe: { chosen, verified, measured_at, attempts: [{ device, compute_type, ok }] } | null, options: [{ model, device, compute_type, enabled, reason, installed }], worker_installed: boolean }`.
- **Erros:** `settings` (falha ao ler arquivo de configurações de Componentes).
- **Eventos e jobs:** nenhum.
- **Pré-condições:** nenhuma.
- **Tela hoje:** `src/features/components/HardwareCard.tsx`, `src/features/projects/Sources.tsx`, `src/features/projects/Transcription.tsx`, `src/features/projects/EngineChoice.tsx`, `src/features/projects/LocalEstimate.tsx`.
- **Mock TS:** sim, `src/lib/core.ts` (`hardwareMockDispatch`).
- **US (#26):** US-10, US-11, US-12, US-13.
- **Código:** `core/src/components/hardware.rs:1068`

### `transcription.hardware.probe`
- **O que faz:** Executa a sonda de hardware no worker Python com o clipe embutido PT/EN, testando a cadeia `int8_float16` → `float16` → `int8` na GPU NVIDIA (ou fallback em CPU), mede o lote seguro (`1 → 2 → 4 → 8`) e salva o resultado em `transcription-hardware.json`.
- **Entrada:** nenhuma (`{}`; qualquer argumento enviado é ignorado).
- **Saída:** `{ chosen: { model, device, compute_type }, verified: boolean, measured_at: number, attempts: [{ device: string, compute_type: string, ok: boolean }] }`.
- **Erros:** `settings`, `worker_missing` (worker de ML não instalado), `model_missing` (modelo `whisper-turbo` ausente quando tenta usar GPU), `already_running` (sonda já em execução), `cancelled` (cancelada por `components.cancel`), `worker_start`, `worker_timeout`, `worker_crashed`, `worker_protocol`, `worker_internal`, `worker_error`, `hardware_store` (falha ao gravar `transcription-hardware.json`).
- **Eventos e jobs:** síncrono na chamada Tauri (bloqueia até concluir/cancelar), mas emite eventos `core-progress` com `job: "hardware-probe"`, `stage: "probe"`, `project: null`, percentuais `0..=100`. Cancelável via `components.cancel` com `{ id: "hardware-probe" }`.
- **Pré-condições:** worker Python instalado; para sonda em GPU NVIDIA com CUDA instalado, modelo `whisper-turbo` baixado.
- **Tela hoje:** `src/features/components/HardwareCard.tsx`.
- **Mock TS:** sim, `src/lib/core.ts` (`hardwareMockDispatch`).
- **US (#26):** US-10, US-11, US-13.
- **Código:** `core/src/components/hardware.rs:1069`

### `transcription.hardware.choose`
- **O que faz:** Fixa manualmente a combinação `(model, device, compute_type)` da Transcrição local ou remove a escolha manual para voltar ao modo automático.
- **Entrada:**
  - `reset: boolean` (opcional) — quando `true`, limpa a escolha manual e restaura a escolha automática da sonda/fábrica; ou, quando `reset` não é `true`:
  - `model: string` (obrigatório) — `"whisper-turbo"` ou `"whisper-small"`.
  - `device: string` (obrigatório) — `"cuda"` ou `"cpu"`.
  - `compute_type: string` (obrigatório) — `"int8_float16"`, `"float16"` ou `"int8"`.
- **Saída:** mesmo objeto completo devolvido por `transcription.hardware.status`.
- **Erros:** `settings`, `invalid_choice` (combinação fora da lista de candidatas válidas), `ram_insufficient` (escolha de `whisper-turbo` em CPU com menos de 8 GiB de RAM total), `gpu_unavailable` (escolha `cuda` sem worker CUDA instalado), `hardware_store`.
- **Eventos e jobs:** nenhum.
- **Pré-condições:** para opções `cuda`, o worker precisa ter sido instalado com suporte CUDA; para `whisper-turbo` em CPU, mínimo de 8 GiB de RAM total.
- **Tela hoje:** `src/features/components/HardwareCard.tsx`.
- **Mock TS:** sim, `src/lib/core.ts` (`hardwareMockDispatch`).
- **US (#26):** US-11.
- **Código:** `core/src/components/hardware.rs:1070`

### `transcription.grouping`
- **O que faz:** Consulta ou altera a opção global de agrupar múltiplos trechos consecutivos de fala do VAD (até `group_size` trechos do mesmo idioma) numa mesma chamada ao `faster-whisper`.
- **Entrada:**
  - `enabled: boolean` (opcional) — escolha manual, gravada em `transcription-hardware.json`.
  - `auto: true` (opcional) — volta ao automático (ligado na CPU, desligado na GPU). Não combina com `enabled`.
  - Sem argumentos, apenas consulta o estado atual.
- **Saída:** `{ enabled: boolean, mode: "auto" | "manual", size: number, measured_size: number | null }` (`enabled` é o valor efetivo; `size` é o lote efetivo: `1` se desligado, `8` em CPU ou `measured_size ?? 1` na GPU; `measured_size` é o lote seguro medido pela sonda na GPU para a precisão atual).
- **Erros:** `settings`, `invalid_grouping` (`enabled` não booleano, `auto` diferente de `true` ou os dois juntos), `hardware_store`.
- **Eventos e jobs:** nenhum.
- **Pré-condições:** nenhuma.
- **Tela hoje:** `src/features/components/HardwareCard.tsx`, `src/features/projects/EngineChoice.tsx`.
- **Mock TS:** sim, `src/lib/core.ts` (`hardwareMockDispatch`).
- **US (#26):** US-10, US-11.
- **Código:** `core/src/components/hardware.rs:1089`
- **Mudança decidida, ainda não implementada (#279):** o agrupamento passa a ter modo automático e manual. No automático, fica ligado na CPU e desligado na GPU. A tela de hardware do front v2 precisa de um aviso curto explicando o motivo: na CPU o agrupamento acelera a Transcrição em ~18%; na GPU usa ~1 GB a mais de VRAM sem ganho medido (benchmark do #162). A entrada e a saída deste comando vão mudar com o #279; confira o código antes de implementar a tela.

### `transcription.hardware.diagnostic`
- **O que faz:** Devolve o registro técnico bruto mais recente da sonda de hardware (incluindo tentativas de lote seguro `batch`, `vram_free_mib` e `ct2_version`) para fins de diagnóstico.
- **Entrada:** nenhuma (`{}`).
- **Saída:** objeto `ProbeRecord` completo (`{ key: { gpu, driver, ct2_version, model, app_version }, chosen, verified, attempts, batch, vram_free_mib, measured_at, fallback_reason? }`) ou `null` se nenhuma sonda foi gravada.
- **Erros:** `settings`.
- **Eventos e jobs:** nenhum.
- **Pré-condições:** nenhuma.
- **Tela hoje:** nenhuma (sem uso na UI).
- **Mock TS:** não.
- **US (#26):** US-113, US-117.
- **Código:** `core/src/components/hardware.rs:1090`

### `transcription.estimate`
- **O que faz:** Estima o tempo total da Transcrição local para uma Fonte, reutilizando a taxa em cache do hardware/modelo/precisão atual ou medindo em tempo real um trecho de 30 s da própria Fonte (a partir de 25% da duração, ou a Fonte inteira se menor que 60 s).
- **Entrada:**
  - `project: string` (obrigatório) — caminho da pasta `.clipes` do Projeto aberto.
  - `source_id: number` (obrigatório) — ID da Fonte.
  - `remeasure: boolean` (opcional, padrão `false`) — força nova medição mesmo se houver taxa em cache.
- **Saída:** `{ model: string, device: string, compute_type: string, load_s: number, rate: number, estimate_s: number, low_s: number, high_s: number, sample_start_us: number, sample_us: number, cached: boolean, measured_at: number, cpu: boolean, warnings: ("ram_unknown" | "low_ram")[] }`.
- **Erros:** `project_not_open`, `project_busy`, `invalid_project`, `source_missing`, `source_changed`, `preview_failed`, `project_read`, `settings`, `already_running` (medição já ativa), `model_missing`, `component_missing` (FFmpeg ausente), `transcribe_audio` (erro ao extrair trecho WAV), `cancelled`, `probe_timeout`, `worker_missing`, `worker_start`, `worker_timeout`, `worker_crashed`, `worker_protocol`, `worker_internal`, `worker_error`, `out_of_memory`, `hardware_store`.
- **Eventos e jobs:** síncrono na chamada Tauri (não entra na fila SQLite), mas quando mede sem cache emite `core-progress` com `job: "transcription-estimate"`, `stage: "estimate"`, `project: null`, percentuais `0` (extraindo trecho), `10..60` (medindo velocidade) e `100` (estimativa pronta). Cancelável via `components.cancel` (`{ id: "transcription-estimate" }`).
- **Pré-condições:** Projeto aberto; Fonte importada e disponível no disco; se não houver cache para o setup atual (ou `remeasure: true`), FFmpeg, worker de ML e modelo de transcrição instalados.
- **Tela hoje:** `src/features/projects/LocalEstimate.tsx`.
- **Mock TS:** sim, `src/lib/core.ts` (`hardwareMockDispatch`).
- **US (#26):** US-12.
- **Código:** `core/src/transcription/estimate.rs:152`

### `transcription.groq.key.status`
- **O que faz:** Informa se existe uma chave de API do Groq salva no cofre do sistema para Transcrição remota.
- **Entrada:** nenhuma (`{}`).
- **Saída:** `{ configured: boolean }`.
- **Erros:** `vault` (falha ao acessar o cofre do sistema).
- **Eventos e jobs:** nenhum.
- **Pré-condições:** nenhuma (não requer Projeto aberto).
- **Tela hoje:** `src/features/preferences/GroqSettings.tsx`.
- **Mock TS:** sim, `src/lib/core.ts`.
- **US (#26):** US-25, US-57.
- **Código:** `core/src/transcription/groq.rs:242`

### `transcription.groq.key.set`
- **O que faz:** Salva a chave da API do Groq no cofre do sistema (`io.github.gustavohooo.clipes.transcription`, conta `groq`), sem gravá-la em arquivos ou banco.
- **Entrada:**
  - `key: string` (obrigatório, não vazio após `trim`) — chave de API do Groq.
- **Saída:** `{ configured: true }`.
- **Erros:** `invalid_key` (chave ausente ou vazia), `vault` (falha ao salvar no cofre do sistema).
- **Eventos e jobs:** nenhum.
- **Pré-condições:** nenhuma.
- **Tela hoje:** `src/features/preferences/GroqSettings.tsx`.
- **Mock TS:** sim, `src/lib/core.ts`.
- **US (#26):** US-25, US-57.
- **Código:** `core/src/transcription/groq.rs:243`

### `transcription.groq.key.remove`
- **O que faz:** Remove a chave da API do Groq do cofre do sistema (idempotente se não existir).
- **Entrada:** nenhuma (`{}`).
- **Saída:** `{ configured: false }`.
- **Erros:** `vault` (falha ao remover do cofre do sistema).
- **Eventos e jobs:** nenhum.
- **Pré-condições:** nenhuma.
- **Tela hoje:** `src/features/preferences/GroqSettings.tsx`.
- **Mock TS:** sim, `src/lib/core.ts`.
- **US (#26):** US-25, US-57.
- **Código:** `core/src/transcription/groq.rs:244`

### `transcription.groq.key.test`
- **O que faz:** Testa a chave do Groq armazenada no cofre fazendo um `GET` autenticado em `https://api.groq.com/openai/v1/models`.
- **Entrada:** nenhuma (`{}`).
- **Saída:** `{ ok: true }`.
- **Erros:** `local_only_violation` (Projeto aberto com modo Somente local ativo), `project_busy`, `project_read`, `groq_key_missing` (chave não configurada), `vault`, `network` (erro ao iniciar cliente HTTP ou sem acesso à rede), `groq_key` (HTTP 401 — chave inválida), `groq_http` (outro status HTTP diferente de 2xx).
- **Eventos e jobs:** nenhum (chamada HTTP síncrona bloqueante com timeout de 15 s).
- **Pré-condições:** chave do Groq salva no cofre; se houver Projeto aberto, não estar em Somente local; acesso à internet.
- **Tela hoje:** `src/features/preferences/GroqSettings.tsx`.
- **Mock TS:** sim, `src/lib/core.ts`.
- **US (#26):** US-25, US-57.
- **Código:** `core/src/transcription/groq.rs:271`

### `transcription.groq.info`
- **O que faz:** Devolve os metadados do Motor remoto Groq: endpoint fixo, modelo usado, estado de consentimento, presença de chave no cofre, veto Somente local do Projeto e tabela de preços embutida.
- **Entrada:** nenhuma (`{}`).
- **Saída:** `{ endpoint: string, model: string, confirmed: boolean, configured: boolean, local_only: boolean, prices: { source, checked, currency, minimum_seconds, models } }`.
- **Erros:** `settings` (erro ao ler `transcription-consent.json`), `vault`, `project_busy`, `project_read`, `worker_protocol` (se JSON embutido de preços falhar).
- **Eventos e jobs:** nenhum.
- **Pré-condições:** nenhuma (se houver Projeto aberto, lê `local_only` dele; sem Projeto aberto, `local_only: false`).
- **Tela hoje:** `src/features/projects/EngineChoice.tsx`.
- **Mock TS:** sim, `src/lib/core.ts` (não retorna `model` nem `prices`).
- **US (#26):** US-27, US-57.
- **Código:** `core/src/transcription/remote.rs:149`

### `transcription.groq.confirm`
- **O que faz:** Registra o consentimento explícito do usuário para envio do áudio da faixa de microfone ao endpoint do Groq em `transcription-consent.json`.
- **Entrada:**
  - `endpoint: string` (obrigatório) — deve ser exatamente `"https://api.groq.com/openai/v1/audio/transcriptions"`.
  - `confirmed: boolean` (obrigatório) — deve ser `true`.
- **Saída:** `{ confirmed: true }`.
- **Erros:** `local_only_violation` (Projeto aberto com Somente local), `project_busy`, `project_read`, `confirmation_required` (`endpoint` divergente ou `confirmed !== true`), `settings` (erro ao ler ou gravar `transcription-consent.json`).
- **Eventos e jobs:** nenhum.
- **Pré-condições:** não haver veto Somente local no Projeto aberto.
- **Tela hoje:** `src/features/projects/EngineChoice.tsx`.
- **Mock TS:** sim, `src/lib/core.ts`.
- **US (#26):** US-27, US-57.
- **Código:** `core/src/transcription/remote.rs:148`

### `transcription.groq.estimate`
- **O que faz:** Calcula o custo estimado em USD para transcrever (ou concluir a partir de `resume_us`) a Fonte usando o modelo Groq `whisper-large-v3-turbo`, considerando a cobrança mínima de 10 s por chamada.
- **Entrada:**
  - `source_id: number` (obrigatório) — ID da Fonte.
- **Saída:** `{ kind: "usd", usd: number, minMicroUsd: number, maxMicroUsd: number, audio_us: number, hourly_usd: number, source: string, checked: string }` (ou `{ kind: "unknown" }` se o modelo não constar da tabela).
- **Erros:** `source_missing`, `project_not_open`, `project_busy`, `project_read` (também se `source_id` não existir no SQLite).
- **Eventos e jobs:** nenhum.
- **Pré-condições:** Projeto aberto; Fonte importada.
- **Tela hoje:** `src/features/projects/EngineChoice.tsx`.
- **Mock TS:** sim, `src/lib/core.ts` (formato reduzido sem `minMicroUsd`, `maxMicroUsd`, `audio_us`).
- **US (#26):** US-28, US-57.
- **Código:** `core/src/transcription/remote.rs:150`

### `transcription.start`
- **O que faz:** Inicia ou retoma a Transcrição da faixa de microfone da Fonte na fila de jobs do Projeto (idempotente se já estiver completa). Pode validar e exigir confirmações antes de trocar Motor/modelo numa parcial ou repetir chamada incerta do Groq.
- **Entrada:**
  - `project: string` (obrigatório) — caminho do Projeto aberto.
  - `source_id: number` (obrigatório) — ID da Fonte.
  - `engine: "local" | "groq"` (opcional; padrão: `"local"` se nova, ou o `engine` da Transcrição existente).
  - `language: string` (opcional) — código ISO-639-1 (ou nome inglês em `SUPPORTED_LANGUAGES`) para atualizar o idioma da Fonte antes de iniciar (apenas enquanto `resume_us == 0` e não completa).
  - `batch: string` (opcional, 1..=80 bytes) — identificador de Lote de Fontes para associar o job (ou adotar job ativo sem lote).
  - `replace_confirmed: boolean` (opcional, padrão `false`) — confirma apagar uma Transcrição parcial ao trocar de Motor ou de modelo local manual.
  - `retry_confirmed: boolean` (opcional, padrão `false`) — confirma repetir uma chamada pendente/incerta de Groq no ponto de retomada atual.
- **Saída:**
  - Se já completa: `{ transcript_id: number, state: "complete", job_id: null }`.
  - Se enfileirada/ativa: `{ transcript_id: number, state: "running" | "complete", job_id: number, warnings: ("ram_unknown" | "low_ram")[] }`.
- **Erros:**
  - Síncronos no comando: `project_not_open`, `project_busy`, `invalid_project`, `source_missing`, `source_changed`, `preview_failed`, `invalid_language`, `invalid_engine`, `invalid_batch`, `transcript_complete`, `local_only_violation`, `transcription_busy`, `transcript_partial`, `transcription_uncertain`, `engine_change_confirmation` (com `usage: { blocks, paid_audio_us, paid_usd }`), `transcription_retry_confirmation` (com `usage: { estimate }`), `confirmation_required` (Groq sem consentimento), `groq_key_missing`, `component_missing` (FFmpeg/cache), `model_missing`, `settings`, `project_read`, `project_write`, `vault`.
  - Assíncronos durante o job na fila: `interrupted`, `cancelled`, `source_changed`, `preview_failed`, `component_missing`, `transcribe_audio`, `transcript_missing`, `invalid_engine`, `model_missing`, `worker_missing`, `worker_start`, `worker_timeout`, `worker_crashed`, `worker_protocol`, `worker_internal`, `worker_error`, `out_of_memory`, `probe_timeout`, `confirmation_required`, `local_only_violation`, `groq_key_missing`, `groq_key`, `groq_http`, `audio_too_large`, `rate_limit`, `network`, `timeout_uncertain`, `budget_cost` (ou código de teto do lote), `settings`, `project_read`, `project_write`.
- **Eventos e jobs:** enfileira job `kind: "transcription"` (`safety: "local"` ou `"paid"`) na fila SQLite do Projeto. Emite `core-progress` com `job: "<job_id>"`, `project: "<queue_project_identity>"` e stages: `probe` (0..99%) / `gpu_probe_fallback` (0%, na 1ª execução local em GPU NVIDIA), `transcribing` (0..99%), `complete` (100%) ou `failed` (0%, com `error`). Cancelável por `jobs.cancel` (`{ id: job_id }`). Ao completar, segmenta Frases, remapeia overrides de legenda e enfileira `energy`.
- **Pré-condições:** Projeto aberto; Fonte importada e disponível; FFmpeg instalado; para `local`, worker Python e modelo instalados; para `groq`, não estar em Somente local, consentimento confirmado e chave salva no cofre.
- **Tela hoje:** `src/features/projects/EngineChoice.tsx`.
- **Mock TS:** sim, `src/lib/core.ts` (não devolve `warnings` nem valida troca de `language`).
- **US (#26):** US-50, US-51, US-52, US-53, US-57, US-58.
- **Código:** `core/src/transcription.rs:965`

### `transcription.status`
- **O que faz:** Consulta o idioma atual da Fonte, o progresso/estado da Transcrição (da faixa de áudio mais antiga/única registrada) e o último job `transcription` da Fonte.
- **Entrada:**
  - `source_id: number` (obrigatório) — ID da Fonte.
- **Saída:** `{ language: string | null, transcript: { id, state: "running" | "complete", resume_us, duration_us, model, engine, words } | null, job: { id, state: "queued" | "running" | "uncertain" | "completed" | "cancelled" | "failed", progress, code: string | null } | null }`.
- **Erros:** `source_missing`, `project_not_open`, `project_busy`, `project_read`.
- **Eventos e jobs:** nenhum.
- **Pré-condições:** Projeto aberto.
- **Tela hoje:** `src/features/projects/Transcription.tsx`.
- **Mock TS:** sim, `src/lib/core.ts` (omite `model` e, sob `?transcript-test`, omite `engine`).
- **US (#26):** US-51, US-52.
- **Código:** `core/src/transcription.rs:966`

### `transcription.words`
- **O que faz:** Lista palavras e silêncios (`kind = 'word' | 'silence'`) da Transcrição de uma Fonte dentro de um intervalo de tempo em microssegundos, incluindo tanto o texto efetivo (corrigido) quanto o `original_text`.
- **Entrada:**
  - `source_id: number` (obrigatório) — ID da Fonte.
  - `from_us: number` (opcional, padrão `0`) — limite inferior em µs (`end_us >= from_us`).
  - `to_us: number` (opcional, padrão `i64::MAX`) — limite superior em µs (`start_us <= to_us`).
  - `limit: number` (opcional, padrão `10000`, clampado em `1..=100000`) — máximo de itens retornados.
- **Saída:** array de `{ position: number, kind: "word" | "silence", text: string, start_us: number, end_us: number, language: string | null, speaker: string | null, original_text: string, corrected: boolean }`.
- **Erros:** `source_missing`, `transcript_missing`, `project_not_open`, `project_busy`, `project_read`.
- **Eventos e jobs:** nenhum.
- **Pré-condições:** Projeto aberto; Transcrição criada para a Fonte.
- **Tela hoje:** nenhuma (sem uso na UI).
- **Mock TS:** não.
- **US (#26):** US-53, US-55, US-56.
- **Código:** `core/src/transcription.rs:967`

### `transcription.blocks`
- **O que faz:** Lista os blocos de Transcrição já concluídos de uma Fonte com o dispositivo (`cuda`/`cpu`) e a precisão (`compute_type`) usados em cada bloco, sem texto.
- **Entrada:**
  - `source_id: number` (obrigatório) — ID da Fonte.
- **Saída:** array de `{ start_us: number, end_us: number, device: string | null, compute_type: string | null }` ordenado por `start_us`.
- **Erros:** `source_missing`, `project_not_open`, `project_busy`, `project_read`.
- **Eventos e jobs:** nenhum.
- **Pré-condições:** Projeto aberto.
- **Tela hoje:** nenhuma (sem uso na UI).
- **Mock TS:** não.
- **US (#26):** US-113, US-117.
- **Código:** `core/src/transcription.rs:968`

### `transcription.segment`
- **O que faz:** Segmenta (ou atualiza de forma idempotente) as palavras da Transcrição completa da Fonte em Frases com IDs estáveis (`1, 2, 3…`), preservando correções existentes e normalizando eventuais sobreposições de timestamps.
- **Entrada:**
  - `source_id: number` (obrigatório) — ID da Fonte.
- **Saída:** `{ transcript_id: number, sentences: number, changed: boolean }`.
- **Erros:** `source_missing`, `transcript_missing`, `transcript_incomplete` (Transcrição ainda não está `complete`), `project_not_open`, `project_busy`, `project_read`, `project_write`.
- **Eventos e jobs:** nenhum.
- **Pré-condições:** Projeto aberto; Transcrição completa (`state == "complete"`).
- **Tela hoje:** `src/features/projects/TranscriptTimeline.tsx`.
- **Mock TS:** sim, `src/lib/core.ts` (apenas quando `?source-test` e `?transcript-test` estão na URL, retornando `{}`).
- **US (#26):** US-53, US-63.
- **Código:** `core/src/sentences.rs:413`

### `transcription.sentences`
- **O que faz:** Lista paginada apenas das Frases de uma Fonte por ID crescente (cursor `after_id`), sem silêncios nem palavras detalhadas.
- **Entrada:**
  - `source_id: number` (obrigatório) — ID da Fonte.
  - `after_id: number` (opcional, padrão `0`) — retorna Frases com `id > after_id`.
  - `limit: number` (opcional, padrão `1000`, clampado em `1..=10000`) — máximo de Frases retornadas.
- **Saída:** array de `{ id: number, start_us: number, end_us: number, language: string | null, text: string, first_position: number, last_position: number }`.
- **Erros:** `source_missing`, `transcript_missing`, `project_not_open`, `project_busy`, `project_read`.
- **Eventos e jobs:** nenhum.
- **Pré-condições:** Projeto aberto; Transcrição segmentada em Frases.
- **Tela hoje:** nenhuma (sem uso na UI).
- **Mock TS:** não.
- **US (#26):** US-53, US-63.
- **Código:** `core/src/sentences.rs:414`

### `transcription.timeline`
- **O que faz:** Retorna uma página cronológica da Transcrição combinando Frases (já com suas palavras clicáveis e corrigidas) e silêncios explícitos, para renderização virtualizada.
- **Entrada:**
  - `source_id: number` (obrigatório) — ID da Fonte.
  - `offset: number` (opcional, padrão `0`, mínimo `0`) — deslocamento na lista ordenada.
  - `limit: number` (opcional, padrão `500`, clampado em `0..=2000`) — quantidade de itens por página.
- **Saída:** `{ total: number, offset: number, items: ({ type: "sentence", id, start_us, end_us, language, text, first_position, last_position, words: [{ position, text, corrected, start_us }] } | { type: "silence", start_us, end_us })[] }`.
- **Erros:** `source_missing`, `transcript_missing`, `project_not_open`, `project_busy`, `project_read`.
- **Eventos e jobs:** nenhum.
- **Pré-condições:** Projeto aberto; Transcrição segmentada em Frases (`transcription.segment`).
- **Tela hoje:** `src/features/projects/TranscriptTimeline.tsx`.
- **Mock TS:** sim, `src/lib/core.ts` (apenas com `?transcript-test`).
- **US (#26):** US-53, US-54, US-55, US-56.
- **Código:** `core/src/sentences.rs:415`

### `transcription.correct`
- **O que faz:** Corrige o texto exibido de uma palavra específica da Transcrição (normalizando em NFC, mantendo o `text` original, atualizando o texto da Frase e o índice FTS5) e empilha o passo no histórico de desfazer do Projeto; se voltar ao texto original do Motor, remove a correção.
- **Entrada:**
  - `source_id: number` (obrigatório) — ID da Fonte.
  - `position: number` (obrigatório) — posição da palavra (`kind = 'word'`) na Transcrição.
  - `text: string` (obrigatório, 1..=200 caracteres após `trim`, sem caracteres de controle) — novo texto da palavra.
- **Saída:** `{ changed: boolean, source_id: number, transcript_id: number, position: number, sentence_id: number | null, text: string, corrected: boolean, can_undo: boolean, can_redo: boolean }`.
- **Erros:** `source_missing`, `transcript_missing`, `word_missing` (`position` ausente, não numérico ou não corresponde a `kind='word'`), `invalid_correction` (`text` ausente, vazio após `trim`, > 200 caracteres ou com caractere de controle), `project_not_open`, `project_busy`, `project_read`, `project_write`.
- **Eventos e jobs:** nenhum no núcleo (a UI dispara localmente o `CustomEvent` de janela `clipes-transcript-corrected` para sincronizar timeline, busca e painel de legendas).
- **Pré-condições:** Projeto aberto; Transcrição com palavras gravadas.
- **Tela hoje:** `src/features/projects/TranscriptTimeline.tsx`, `src/features/captions/CaptionPanel.tsx`, `src/features/export/ExportButton.tsx`.
- **Mock TS:** sim, `src/lib/core.ts` (apenas com `?transcript-test`).
- **US (#26):** US-54.
- **Código:** `core/src/corrections.rs:343`

### `transcription.undo`
- **O que faz:** Desfaz a última correção de palavra ativa na pilha do Projeto (`transcript_corrections`), restaurando o texto anterior da palavra, da Frase e do índice de busca.
- **Entrada:** nenhuma (`{}`).
- **Saída:** `{ changed: true, source_id: number, transcript_id: number, position: number, sentence_id: number | null, text: string, corrected: boolean, can_undo: boolean, can_redo: boolean }`.
- **Erros:** `nothing_to_undo` (pilha de desfazer vazia), `project_not_open`, `project_busy`, `project_write`.
- **Eventos e jobs:** nenhum.
- **Pré-condições:** Projeto aberto; ao menos uma correção na pilha (`can_undo === true`).
- **Tela hoje:** `src/features/projects/TranscriptTimeline.tsx`.
- **Mock TS:** sim, `src/lib/core.ts` (apenas com `?transcript-test`).
- **US (#26):** US-54.
- **Código:** `core/src/corrections.rs:344`

### `transcription.redo`
- **O que faz:** Refaz a correção mais recentemente desfeita na pilha do Projeto (`transcript_corrections`), reaplicando o texto na palavra, na Frase e no índice de busca.
- **Entrada:** nenhuma (`{}`).
- **Saída:** `{ changed: true, source_id: number, transcript_id: number, position: number, sentence_id: number | null, text: string, corrected: boolean, can_undo: boolean, can_redo: boolean }`.
- **Erros:** `nothing_to_redo` (pilha de refazer vazia), `project_not_open`, `project_busy`, `project_write`.
- **Eventos e jobs:** nenhum.
- **Pré-condições:** Projeto aberto; ao menos uma correção desfeita (`can_redo === true`).
- **Tela hoje:** `src/features/projects/TranscriptTimeline.tsx`.
- **Mock TS:** sim, `src/lib/core.ts` (apenas com `?transcript-test`).
- **US (#26):** US-54.
- **Código:** `core/src/corrections.rs:345`

### `transcription.corrections`
- **O que faz:** Consulta se há passos disponíveis para desfazer ou refazer na pilha global de correções do Projeto.
- **Entrada:** nenhuma (`{}`).
- **Saída:** `{ can_undo: boolean, can_redo: boolean }`.
- **Erros:** `project_not_open`, `project_busy`, `project_read`.
- **Eventos e jobs:** nenhum.
- **Pré-condições:** Projeto aberto.
- **Tela hoje:** `src/features/projects/TranscriptTimeline.tsx`.
- **Mock TS:** sim, `src/lib/core.ts` (apenas com `?transcript-test`).
- **US (#26):** US-54.
- **Código:** `core/src/corrections.rs:346`

### `transcription.search`
- **O que faz:** Busca texto por palavras-chave (FTS5 sem distinção de acentos, aceitando prefixo no último termo) em todas as Frases de todas as Transcrições do Projeto aberto, devolvendo trechos destacados e a posição (`row`) na `transcription.timeline`.
- **Entrada:**
  - `query: string` (obrigatório na prática; se ausente ou sem caracteres alfanuméricos, devolve `[]`).
  - `limit: number` (opcional, padrão `50`, clampado em `1..=200`) — máximo de resultados.
- **Saída:** array de `{ transcript_id: number, source_id: number, source: string, sentence_id: number, start_us: number, end_us: number, snippet: { text: string, match: boolean }[], row: number }`.
- **Erros:** `project_not_open`, `project_busy`, `project_read`.
- **Eventos e jobs:** nenhum.
- **Pré-condições:** Projeto aberto.
- **Tela hoje:** `src/features/projects/TranscriptSearch.tsx`.
- **Mock TS:** sim, `src/lib/core.ts` (apenas com `?transcript-test`).
- **US (#26):** US-43.
- **Código:** `core/src/corrections.rs:347`

### `translation.get`
- **O que faz:** Carrega o estado completo de tradução de um Corte (materializando antes eventuais lotes concluídos na fila): permissão da Fonte, idioma detectado, faixa ativa (`original` ou `translated`), Frases originais/traduzidas e estado da última execução.
- **Entrada:**
  - `clip_id: number` (obrigatório, `> 0`) — ID do Corte em `clip_edits`.
- **Saída:** `{ schemaVersion: 1, clipId, sourceId, transcriptId, permitted: boolean, permissionError: { code, message } | null, detectedLanguage: "pt-BR" | "en" | null, languageRequired: boolean, defaultTargetLanguage: "pt-BR" | "en" | null, activeTrack: "original" | "translated", targetLanguage: "pt-BR" | "en" | null, hasTranslation: boolean, missingSentenceIds: number[], sentences: [{ id, startUs, endUs, originalText, translatedText: string | null, edited: boolean }], run: { id, state: "running" | "completed" | "partial" | "failed" | "cancelled", sourceLanguage, targetLanguage, taskVersion, promptSha256, profile, batchesTotal, batchesCompleted, batchesFailed, createdAt, jobs: [{ id, batchIndex, state, code, violations }] } | null }`.
- **Erros:** `project_not_open`, `project_busy`, `invalid_clip`, `source_missing`, `transcript_missing`, `transcript_incomplete`, `no_sentences`, `project_read`, `project_write`.
- **Eventos e jobs:** nenhum (apenas materializa no SQLite os resultados de jobs `ai:translation` já `completed` cuja execução ainda estava `running`).
- **Pré-condições:** Projeto aberto; Corte salvo em `clip_edits`; Transcrição da Fonte completa.
- **Tela hoje:** `src/features/translation/TranslationPanel.tsx`.
- **Mock TS:** sim, `src/lib/translationMock.ts`.
- **US (#26):** US-47, US-80.
- **Código:** `core/src/translation.rs:1400`

### `translation.estimate`
- **O que faz:** Planeja os lotes de Frases do Corte segundo a Janela de contexto do Perfil de Provedor roteado para a Tarefa `translation` e devolve a estimativa de tokens, lotes e custo antes de enviar texto ao Provedor.
- **Entrada:**
  - `clip_id: number` (obrigatório, `> 0`) — ID do Corte.
  - `source_language: "pt-BR" | "en"` (opcional) — idioma de origem explícito.
  - `target_language: "pt-BR" | "en"` (opcional) — idioma de destino explícito (obrigatório quando `detectedLanguage` do Corte é `null`).
- **Saída:** `{ paid: boolean, profile: string, sourceLanguage: "pt-BR" | "en", targetLanguage: "pt-BR" | "en", batches: number, sentenceCount: number, contextTokens: number, estimate: { kind, units, windows, inputTokens, minMicroUsd, maxMicroUsd } }`.
- **Erros:** `project_not_open`, `project_busy`, `invalid_clip`, `source_missing`, `transcript_missing`, `transcript_incomplete`, `no_sentences`, `translation_permission_required` (Permissão da Fonte sem `status: "granted"` ou sem escopo `"tradução"`/`"translation"`), `invalid_language` (idioma fora de `pt-BR`/`en` ou origem == destino), `language_required` (idioma não detectado e não informado), `local_only_violation`, `confirmation_required` (CLI selecionado sem consentimento), `invalid_settings` (Provedor não configurado), `context_too_small` (contexto do perfil não comporta uma Frase), `settings`, `project_read`, `project_write`.
- **Eventos e jobs:** nenhum.
- **Pré-condições:** Projeto aberto; Corte válido; Permissão da Fonte com escopo `tradução`; Provedor roteado para `translation` (ou padrão) configurado e compatível com Somente local.
- **Tela hoje:** `src/features/translation/TranslationPanel.tsx`.
- **Mock TS:** sim, `src/lib/translationMock.ts`.
- **US (#26):** US-26, US-27, US-28, US-47, US-58, US-80.
- **Código:** `core/src/translation.rs:1401`

### `translation.start`
- **O que faz:** Cria uma execução de tradução (`translation_runs`) para o Corte e enfileira os jobs `ai:translation` por lote de Frases na fila do Projeto (exigindo confirmação prévia se o Provedor for pago/remoto).
- **Entrada:**
  - `clip_id: number` (obrigatório, `> 0`) — ID do Corte.
  - `source_language: "pt-BR" | "en"` (opcional) — idioma de origem explícito.
  - `target_language: "pt-BR" | "en"` (opcional) — idioma de destino explícito.
  - `confirmed: boolean` (opcional; obrigatório `true` quando a rota do Provedor for paga/remota).
- **Saída:** `{ run: number, jobs: number[], batches: number, sourceLanguage: "pt-BR" | "en", targetLanguage: "pt-BR" | "en" }`.
- **Erros:**
  - Síncronos no comando: todos de `translation.estimate`, mais `translation_in_progress` (já existe job `queued`/`running` para o Corte) e `confirmation_required` (com `usage: { estimate }` quando `paid` e `confirmed !== true`).
  - Assíncronos nos jobs `ai:translation`: `cancelled`, `timeout_uncertain`, `budget_calls`, `budget_time`, `budget_input_tokens`, `budget_cost`, `local_only_violation`, `not_local`, `verification_failed` (verificadores: `line_count_mismatch`, `unknown_sentence_id`, `duplicate_sentence_id`, `missing_sentence_id`, `empty_translation`, `language_mismatch`, `url_not_preserved`, `invented_url`, `number_not_preserved`, `control_character`, `forbidden_character`, `translation_too_long`, `translation_too_short`), além de erros do adaptador do Provedor (`invalid_json`, `output_invalid`, `output_truncated`, `context_truncated`, `refusal`, `provider_daily_limit`, `request_too_large`, `network`, etc.).
- **Eventos e jobs:** enfileira 1 ou mais jobs `kind: "ai:translation"` (em lote `translation-<run_id>`) na fila SQLite do Projeto. Cada job emite `core-progress` com `job: "<job_id>"`, `project: "<queue_project_identity>"`, `clip_id: <clip_id>` e `stage`: `ai:translation:prepare` (0%), `ai:translation:call` (10%), `ai:translation:verify` (80%), `ai:translation:done` (100% ou 0% com `error`) ou `ai:translation:paused` (0%, pausa por orçamento). Canceláveis individualmente por `jobs.cancel` (`{ id: job_id }`).
- **Pré-condições:** mesmas de `translation.estimate`, sem outra tradução em andamento no Corte, e `confirmed: true` se Provedor pago.
- **Tela hoje:** `src/features/translation/TranslationPanel.tsx`.
- **Mock TS:** sim, `src/lib/translationMock.ts`.
- **US (#26):** US-26, US-27, US-28, US-47, US-58, US-80.
- **Código:** `core/src/translation.rs:1402`

### `translation.track.set`
- **O que faz:** Alterna a faixa de legenda ativa do Corte entre `"original"` e `"translated"` (sincronizando também a preferência de faixa do candidato em `narration_align` quando existir) e devolve o documento atualizado de tradução.
- **Entrada:**
  - `clip_id: number` (obrigatório, `> 0`) — ID do Corte.
  - `track: "original" | "translated"` (obrigatório) — faixa a ativar.
  - `target_language: "pt-BR" | "en"` (opcional) — idioma traduzido a selecionar caso haja tradução em mais de um idioma.
- **Saída:** mesmo documento completo devolvido por `translation.get`.
- **Erros:** `project_not_open`, `project_busy`, `invalid_clip`, `invalid_track`, `invalid_language`, `translation_missing` (tentou ativar `"translated"` sem nenhuma Frase traduzida para o idioma), `source_missing`, `transcript_missing`, `transcript_incomplete`, `no_sentences`, `project_read`, `project_write`.
- **Eventos e jobs:** nenhum.
- **Pré-condições:** Projeto aberto; Corte válido; para `track: "translated"`, ao menos uma Frase traduzida salva no Corte.
- **Tela hoje:** `src/features/translation/TranslationPanel.tsx`.
- **Mock TS:** sim, `src/lib/translationMock.ts`.
- **US (#26):** US-80.
- **Código:** `core/src/translation.rs:1403`

### `translation.edit`
- **O que faz:** Edita manualmente o texto traduzido de uma Frase do Corte (marcando `edited = 1`, preservando a Transcrição original e os timestamps da Frase) e devolve o documento atualizado de tradução.
- **Entrada:**
  - `clip_id: number` (obrigatório, `> 0`) — ID do Corte.
  - `sentence_id: number` (obrigatório, `> 0`) — ID da Frase do Corte.
  - `text: string` (obrigatório, `1..=2000` chars após `trim` NFC, sem caracteres de controle nem `<` ou `>`) — novo texto traduzido.
  - `language: "pt-BR" | "en"` (opcional) — idioma da tradução a editar (padrão: idioma alvo atual do Corte).
- **Saída:** mesmo documento completo devolvido por `translation.get`.
- **Erros:** `project_not_open`, `project_busy`, `invalid_clip`, `unknown_sentence_id`, `invalid_translation_edit` (`text` ausente ou contém caractere de controle/`<`/`>`), `translation_empty` (`text` vazio após `trim`), `translation_too_long` (> 2000 caracteres), `invalid_language`, `translation_missing` (sem tradução ativa ou Frase não traduzida nesse Corte/idioma), `source_missing`, `transcript_missing`, `transcript_incomplete`, `no_sentences`, `project_read`, `project_write`.
- **Eventos e jobs:** nenhum.
- **Pré-condições:** Projeto aberto; Corte válido; Frase já traduzida no idioma alvo.
- **Tela hoje:** `src/features/translation/TranslationPanel.tsx`.
- **Mock TS:** sim, `src/lib/translationMock.ts`.
- **US (#26):** US-80.
- **Código:** `core/src/translation.rs:1404`

### `energy.start`
- **O que faz:** Enfileira de forma idempotente o job local de medição de energia do áudio (`energy`) para uma Fonte com Transcrição completa (o mesmo job que também é enfileirado automaticamente ao fim da Transcrição).
- **Entrada:**
  - `source_id: number` (obrigatório) — ID da Fonte.
- **Saída:** `{ state: "measured" | "queued", job: number | null }` (`state: "measured"` e `job: null` se já medida na versão atual do método; `"queued"` com o ID do job existente ou recém-criado).
- **Erros:**
  - Síncronos: `source_missing`, `transcript_missing`, `transcript_incomplete`, `project_not_open`, `project_busy`, `project_read`, `project_write`.
  - Assíncronos durante o job `energy`: `interrupted`, `cancelled`, `transcript_missing`, `transcript_incomplete`, `source_changed`, `preview_failed`, `component_missing` (FFmpeg ausente), `energy_failed` (falha ao decodificar PCM via FFmpeg), `project_read`, `project_write`.
- **Eventos e jobs:** enfileira job `kind: "energy"`, `safety: "local"` na fila SQLite do Projeto. Emite `core-progress` com `job: "<job_id>"`, `project: "<queue_project_identity>"`, `stage: "energy"` (0..98%), `complete` (100%) ou `failed` (0% com `error`). Cancelável via `jobs.cancel` (`{ id: job_id }`).
- **Pré-condições:** Projeto aberto; Fonte importada com Transcrição `complete` na faixa de áudio atual.
- **Tela hoje:** nenhuma (sem uso na UI).
- **Mock TS:** não.
- **US (#26):** US-60, US-62, US-51.
- **Código:** `core/src/energy.rs:484`

### `energy.status`
- **O que faz:** Consulta se a energia do áudio da Fonte já foi medida, quantas Frases receberam marca `high` (`[energia alta]`) ou `peak` (`[energia pico]`), e o estado do último job `energy`.
- **Entrada:**
  - `source_id: number` (obrigatório) — ID da Fonte.
- **Saída:** `{ measured: boolean, marks: { high: number, peak: number }, job: { id: number, state: "queued" | "running" | "uncertain" | "completed" | "cancelled" | "failed", progress: number } | null }`.
- **Erros:** `source_missing`, `transcript_missing`, `project_not_open`, `project_busy`, `project_read`.
- **Eventos e jobs:** nenhum.
- **Pré-condições:** Projeto aberto; Transcrição criada para a Fonte (mesmo que ainda `running`).
- **Tela hoje:** `src/features/projects/Selection.tsx`.
- **Mock TS:** sim, `src/lib/core.ts` (`selectionMockDispatch`, apenas quando `?transcript-test` está ativo).
- **US (#26):** US-51, US-60, US-62.
- **Código:** `core/src/energy.rs:485`

---

## Estados e eventos do domínio

### Eventos `core-progress` emitidos neste domínio

| Origem | `job` no evento | `project` no evento | `stage` | Quando acontece | `percentage` | Pode trazer `error` |
| :--- | :--- | :--- | :--- | :--- | :--- | :--- |
| `transcription.hardware.probe` | `"hardware-probe"` | `null` | `"probe"` | Início (`Verificando o CTranslate2`), cada precisão/lote testado na GPU/CPU e conclusão | `0`..`100` | Não (erro sai no retorno do comando) |
| `transcription.estimate` (sem cache / `remeasure`) | `"transcription-estimate"` | `null` | `"estimate"` | Extração do trecho WAV (`0`), medição no worker (`10..60`) e conclusão (`100`) | `0`..`100` | Não (erro sai no retorno do comando) |
| Job `transcription` (1ª execução em GPU NVIDIA) | `<job_id>` | `<queue_project_identity>` | `"probe"` | Sonda automática da GPU antes do 1º bloco (`resume_us == 0`) | `0`..`99` | Não |
| Job `transcription` (fallback na sonda automática) | `<job_id>` | `<queue_project_identity>` | `"gpu_probe_fallback"` | GPU falhou ou deu timeout e o Motor caiu para CPU | `0` | Não |
| Job `transcription` | `<job_id>` | `<queue_project_identity>` | `"transcribing"` | Progresso ponderado entre os blocos de 10 min e trechos internos | `0`..`99` | Não |
| Job `transcription` | `<job_id>` | `<queue_project_identity>` | `"complete"` / `"failed"` | Fim do job de Transcrição na fila do Projeto | `100` / `0` | Sim (em `"failed"`) |
| Job `energy` | `<job_id>` | `<queue_project_identity>` | `"energy"` | Decodificação PCM pelo FFmpeg da faixa de microfone | `0`..`98` | Não |
| Job `energy` | `<job_id>` | `<queue_project_identity>` | `"complete"` / `"failed"` | Fim da medição e gravação em `sentence_energy` | `100` / `0` | Sim (em `"failed"`) |
| Job `ai:translation` (1 por lote) | `<job_id>` | `<queue_project_identity>` | `"ai:translation:prepare"` | Job iniciado, antes de chamar o Provedor | `0` | Não |
| Job `ai:translation` | `<job_id>` | `<queue_project_identity>` | `"ai:translation:call"` | Chamando o Provedor para traduzir o lote de Frases | `10` | Não |
| Job `ai:translation` | `<job_id>` | `<queue_project_identity>` | `"ai:translation:verify"` | Resposta recebida; validando IDs, idioma, números, URLs e limites | `80` | Não |
| Job `ai:translation` | `<job_id>` | `<queue_project_identity>` | `"ai:translation:paused"` | Fila pausada antes do envio por teto de orçamento | `0` | Sim (`budget_*`) |
| Job `ai:translation` | `<job_id>` | `<queue_project_identity>` | `"ai:translation:done"` | Conclusão, erro, cancelamento ou incerteza do lote | `100` (ok) / `0` (erro/cancel) | Sim (em erro/incerto) |

### Estados dos objetos do domínio

- **Transcrição (`transcripts.state`):**
  - `running`: criada ao iniciar `transcription.start`; avança `resume_us` a cada bloco concluído de até 10 min (permanece `running` se cancelada, interrompida ou falha — permitindo retomar do `resume_us`).
  - `complete`: último bloco gravado (`resume_us >= duration_us`), Frases segmentadas e `energy` enfileirado. Bloqueia troca de Motor e de idioma.
- **Chamada paga do Groq (`transcription_calls.state`):**
  - `pending` → `completed` (bloco validado e gravado), `failed` (erro antes de resposta incerta), ou `uncertain` (timeout, cancelamento em voo, resposta 2xx inválida ou reconciliação após crash). Exige `retry_confirmed: true` em `transcription.start` ou resolução na fila (`jobs.retry` / `jobs.discard`).
- **Job na fila (`jobs.state`):** `queued` → `running` → `completed` | `cancelled` | `failed` | `uncertain`. Na reconciliação após crash (`jobs::reconcile`), jobs `local` em `running` voltam para `queued`, enquanto jobs `paid` (como Groq ou `ai:translation` em Provedor pago) vão para `uncertain`.
- **Execução de tradução (`translation_runs.state`):**
  - `running`: enquanto ao menos um lote em `translation_run_jobs` estiver `queued` ou `running`.
  - `completed`: todos os lotes concluídos.
  - `partial`: parte dos lotes concluída e o restante falho/cancelado/incerto (as Frases dos lotes concluídos ficam salvas).
  - `cancelled`: todos os lotes cancelados.
  - `failed`: nenhum lote concluído e ao menos um falhou/incerto.
- **Faixa de legenda do Corte (`clip_caption_tracks.active_track`):** `"original"` (padrão) ou `"translated"` (ativável via `translation.track.set` após haver Frases traduzidas; também pode ser alternada via `captions.track.set` junto com `"auto"` e `"narration"`).
- **Medição de energia (`energy_measurements`):** ausente (`measured: false`), na fila/rodando (job `energy`), ou gravada com `method = 1` (`measured: true`). O rótulo de cada Frase (`low`, `mid`, `high`, `peak`) é calculado na leitura (exige pelo menos `MIN_LABELED_SENTENCES = 8` Frases com som acima do piso `-120 dBFS`, além de superar percentil 80 + `3 dB` acima da mediana para `high` e percentil 95 + `6 dB` acima da mediana para `peak`).

---

## Configurações deste domínio

| Preferência / Dado | Onde vive | Quem lê / grava |
| :--- | :--- | :--- |
| Configuração manual (`manual`), histórico de sondas (`probes`), taxas de estimativa por hardware (`rates`) e escolha manual do agrupamento de VAD (`group_vad_choice`, `null` = automático) | `<settings.data_dir>/transcription-hardware.json` (caminho base definido em `components.settings.set`; padrão em `AppDirs::data_dir`, ou `CLIPES_DATA_DIR` quando isolado) | Lê: `transcription.hardware.status`, `transcription.hardware.diagnostic`, `transcription.estimate`, `transcription.grouping`, `transcription.start` (job local). Grava: `transcription.hardware.probe`, `transcription.hardware.choose`, `transcription.grouping`, `transcription.estimate` (cache de taxa) e atualização automática em OOM (`record_batch_oom`) |
| Consentimento de envio de áudio para o endpoint do Groq | `<config_dir>/transcription-consent.json` (`paths::config_file`, sempre em `AppDirs::config_dir` / `CLIPES_DATA_DIR`, não movido por `settings.data_dir`) | Lê: `transcription.groq.info`, `transcription.start` (`engine: "groq"`). Grava: `transcription.groq.confirm` |
| Chave de API do Groq | **Cofre do sistema** (Keyring / Credential Manager), serviço `"io.github.gustavohooo.clipes.transcription"`, conta `"groq"` | Lê: `transcription.groq.key.status`, `transcription.groq.key.test`, `transcription.groq.info`, `transcription.start` (`engine: "groq"`). Grava/Remove: `transcription.groq.key.set`, `transcription.groq.key.remove` |
| Tabela de preços de referência do Groq | Embutida no binário (`core/src/transcription/groq-prices.json`) | Lê: `transcription.groq.info`, `transcription.groq.estimate`, `transcription.start` |
| Roteamento de Perfil de Provedor e veto `Somente local` da tarefa `translation` | `<config_dir>/assistant.json` e `<config_dir>/provider.json` (`paths::config_file`) | Lê: `translation.estimate`, `translation.start` (via `provider::routed` e `provider::effective_cached`) |
| Veto `Somente local` do Projeto (`project_privacy.local_only`) | SQLite portátil do Projeto (`<Nome>.clipes/project.sqlite`) | Lê: `transcription.groq.info`, `transcription.groq.confirm`, `transcription.groq.key.test`, `transcription.start`, `translation.estimate`, `translation.start` |
| Transcrições, blocos, palavras/silêncios, correções (undo/redo), Frases, índice FTS5, medições de energia, traduções e faixa ativa | SQLite portátil do Projeto (`<Nome>.clipes/project.sqlite`: tabelas `transcripts`, `transcription_blocks`, `transcription_block_config`, `transcription_calls`, `transcript_words`, `transcript_corrections`, `sentences`, `sentence_search`, `energy_measurements`, `sentence_energy`, `translation_runs`, `translation_run_jobs`, `clip_caption_tracks`, `clip_translated_sentences`, `jobs`) | Lê/Grava: comandos `transcription.*` de Projeto, `translation.*` e `energy.*` |
| Arquivos temporários WAV/FLAC durante extração e estimativa | `<settings.cache_dir>/transcribe/` (`job-<id>.wav`, `estimate-<pid>.wav`, `.flac` temporário) | Criados e removidos durante `transcription.estimate` e job `transcription` |
| Variáveis de ambiente apenas para testes/harness | `CLIPES_DATA_DIR`, `CLIPES_TRANSCRIBE_BLOCK_SECONDS`, `CLIPES_PROBE_TIMEOUT_SECONDS`, `CLIPES_NVIDIA_SMI`, `CLIPES_FAKE_RAM` | Lidas em `paths.rs`, `transcription.rs` e `components/hardware.rs` |

---

## Observações para o front novo

1. **Cinco comandos do núcleo não têm uso na UI atual:**
   - `transcription.blocks` (em `core/src/transcription.rs:968`): expõe por bloco qual `device` e `compute_type` processaram a Fonte (útil porque o hardware/precisão pode mudar entre blocos em retomadas ou fallback).
   - `transcription.hardware.diagnostic` (em `core/src/components/hardware.rs:1090`): devolve o `ProbeRecord` completo da última sonda (incluindo `batch`, `vram_free_mib` e `ct2_version`), enquanto a tela `HardwareCard.tsx` usa apenas `transcription.hardware.status`.
   - `transcription.sentences` (em `core/src/sentences.rs:414`) e `transcription.words` (em `core/src/transcription.rs:967`): a UI atual lê tudo via `transcription.timeline` (ou `editor.sentences` no editor).
   - `energy.start` (em `core/src/energy.rs:484`): a UI (`Selection.tsx`) só consulta `energy.status` e não oferece ação manual para enfileirar/reprocessar energia quando `measured` é `false` e não há job ativo (ex.: Transcrição de versão anterior ou job cancelado).

2. **Inconsistência de contrato entre comandos (parâmetros, paginação e casing):**
   - `transcription.start` e `transcription.estimate` exigem `project` (caminho do Projeto aberto) e falham com `invalid_project` se divergir de `projects.current`; todos os outros comandos de Projeto deste domínio (`transcription.status`, `transcription.timeline`, `transcription.correct`, `transcription.search`, `energy.*`, `translation.*`) não aceitam `project` e operam direto no Projeto aberto.
   - Os comandos `transcription.*` e `energy.*` usam **snake_case** (`source_id`, `start_us`, `sentence_id`, `can_undo`), enquanto os comandos `translation.*` aceitam **snake_case** na entrada (`clip_id`, `source_language`, `target_language`, `sentence_id`) mas devolvem **camelCase** na saída (`clipId`, `activeTrack`, `targetLanguage`, `startUs`, `originalText`, `translatedText`).
   - Há três padrões distintos de paginação na leitura da Transcrição: `transcription.timeline` usa `offset`/`limit`; `transcription.sentences` usa cursor `after_id`/`limit`; `transcription.words` usa janela de tempo `from_us`/`to_us`/`limit`.

3. **Lacunas e divergências nos Mocks TS (`VITE_CORE_MOCK=1`):**
   - Os cinco comandos sem UI (`transcription.blocks`, `transcription.hardware.diagnostic`, `transcription.sentences`, `transcription.words`, `energy.start`) não existem em `src/lib/`.
   - Vários mocks em `src/lib/core.ts` só respondem quando há parâmetros específicos na URL (`?transcript-test`, `?source-test`, `?hardware-cpu=1`) e omitem campos reais do núcleo: `transcription.groq.info` omite `model` e `prices`; `transcription.groq.estimate` omite `minMicroUsd`, `maxMicroUsd` e `audio_us`; `transcription.status` omite `model` (e `engine` no ramo `?transcript-test`); `transcription.start` ignora `warnings` e alteração de `language`.
   - Em `src/lib/translationMock.ts`, a permissão da Fonte é consultada com `permissionStateOf(1)` fixo no ID `1` (ignorando o `sourceId` real de outros Cortes), e a conclusão dos jobs de tradução é simulada decrementando `pendingPolls` a cada chamada de `translation.get`, sem emitir eventos `core-progress`.

4. **Erros tipados e recursos do núcleo ignorados ou escondidos pela UI atual:**
   - **Erros em `GroqSettings.tsx`:** qualquer erro de `transcription.groq.key.set`, `.test` ou `.remove` exibe a mesma mensagem genérica (`"Não foi possível concluir a operação."`), escondendo códigos úteis como `groq_key` (chave inválida 401), `network`, `local_only_violation` e `vault`.
   - **Erros e incerteza em `Transcription.tsx`:** a UI atual só trata especificamente `job.code === "model_missing"`; outros códigos gravados no job falho (`groq_key`, `audio_too_large`, `rate_limit`, `local_only_violation`, `source_changed`, etc.) e o estado `uncertain` não têm detalhamento próprio na tela.
   - **Parâmetros `language` e `batch` em `transcription.start`:** o núcleo permite definir/alterar `language` (enquanto `resume_us == 0`) e vincular `batch` diretamente no `transcription.start`, mas `EngineChoice.tsx` altera o idioma por comando separado (`sources.language.set`) e não passa `batch`.
   - **Cancelamento e idioma explícito em `TranslationPanel.tsx`:** o núcleo persiste traduções por `(clip_id, language, sentence_id)` e aceita `target_language` em `translation.track.set` e `language` em `translation.edit`, além de permitir cancelar jobs `ai:translation` por `jobs.cancel`; a UI atual faz polling a cada 600 ms em `translation.get` (pois `core-progress` de `ai:translation` não informa `clip_id`), não expõe botão de cancelar tradução em andamento e não passa idioma ao trocar faixa/editar.

5. **Particularidades importantes de comportamento para o front novo:**
   - **Dois mecanismos de cancelamento:** jobs que entram na fila SQLite (`transcription.start`, `energy.start`, `translation.start`) são cancelados via `jobs.cancel` (`{ id: number }`), enquanto comandos síncronos longos fora da fila (`transcription.hardware.probe` e `transcription.estimate`) usam `components.cancel` (`{ id: "hardware-probe" | "transcription-estimate" }`).
   - **Pilha global de desfazer/refazer correções:** `transcription.undo` e `transcription.redo` operam sobre uma pilha única de todo o Projeto (`transcript_corrections`), não isolada por Fonte — um `Ctrl+Z` com a Fonte B aberta pode desfazer uma correção feita anteriormente na Fonte A se ela tiver sido a última alteração do Projeto.
   - **Retomada após troca de hardware vs. modelo:** em `transcription.start`, quando já existe uma Transcrição parcial (`resume_us > 0`), o **dispositivo e a precisão** (`cuda`/`cpu`, `compute_type`) são relidos em `transcription-hardware.json` a cada novo bloco de 10 min, mas trocar o **modelo** local (`whisper-turbo` ↔ `whisper-small`) ou o **Motor** (`local` ↔ `groq`) exige `replace_confirmed: true` e apaga a Transcrição parcial do zero.
