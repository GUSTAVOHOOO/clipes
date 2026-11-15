# Como contribuir com um Motor de transcrição

Um **Motor de transcrição** produz a Transcrição da Fonte no idioma falado, com timestamps por palavra. Ele pode ser local (o padrão) ou remoto via API paga escolhida pelo usuário. Consulte o [glossário](../../GLOSSARY.md).

O [ADR-0004](../adr/0004-stack-tauri-react-nucleo-rust-worker-python.md) prevê faster-whisper no worker de ML Python, sob demanda. O núcleo Rust controla a fila e se comunica com o worker por JSON lines em stdin/stdout, com versão de protocolo, progresso, cancelamento e erros tipados. O worker carrega um modelo por vez e o libera antes do próximo; não abre o banco do Projeto. O Python e componentes necessários são baixados sob demanda em ambiente isolado, sem usar o Python do sistema.

## Propor e implementar

1. Abra uma proposta pelo formulário [Propor Provedor ou modelo](https://github.com/GUSTAVOHOOO/clipes/issues/new?template=provedor-modelo.yml), identificando o Motor, seus modelos, finalidade, requisitos de hardware, documentação e se é local ou remoto.
2. Documente as licenças do código e dos pesos, inclusive permissão para uso comercial. Componentes e modelos baixados precisam atender ao [ADR-0003](../adr/0003-licenca-apache-ffmpeg-sob-demanda-e-politica-de-modelos.md); a licença e atribuições devem ser apresentadas conforme esse ADR.
3. Ao implementar, respeite a fila e o protocolo do núcleo e preserve os timestamps por palavra. Cubra resultados, progresso, cancelamento e erros pelo núcleo, sem usar credenciais ou serviços pagos reais nos testes. O worker entrega os resultados ao núcleo, que é o único escritor do banco ([ADR-0005](../adr/0005-projeto-portatil-com-sqlite.md)).
4. Descreva como testar e abra um PR seguindo [CONTRIBUTING.md](../../CONTRIBUTING.md).

## O Motor no código

- **Interface:** o trait `TranscriptionEngine` em [`core/src/transcription.rs`](../../core/src/transcription.rs) recebe um bloco de áudio (WAV 16 kHz mono) e devolve palavras (`text`, `start_us`, `end_us`, `language`), silêncios e até onde o bloco foi coberto. Um Motor novo implementa só isso; a fila, os blocos, o checkpoint e a gravação ficam no núcleo.
- **Motor local:** `LocalEngine` usa a tarefa `transcribe` do worker ([`worker/src/clipes_worker/transcribe.py`](../../worker/src/clipes_worker/transcribe.py)), com faster-whisper. GPU NVIDIA: `dropbox-dash/faster-whisper-large-v3-turbo` na revisão `0a363e9161cbc7ed1431c9597a8ceaf0c4f78fcf` (o benchmark #32 o chamava `mobiuslabsgmbh/faster-whisper-large-v3-turbo`; o Hugging Face redireciona o nome antigo), `int8_float16`, batch 1. CPU: `Systran/faster-whisper-small` na revisão `536b0662742c02347bc0e980a01041f333bce120`, INT8, batch até 8. Ambos: `BatchedInferencePipeline`, beam 5, `word_timestamps=True`, tarefa `transcribe`, VAD Silero com limiar 0,75 e silêncio mínimo de 200 ms, idioma detectado em cada trecho de VAD e timestamps de palavra nativos, sem alinhamento (#102).
- **Desvio do benchmark:** o VAD usa também `max_speech_duration_s=30`. O benchmark não tinha teto, mas o pipeline com `vad_filter=False` levanta `RuntimeError` num trecho de 30 s ou mais, e uma live longa tem trechos assim; 30 s é o teto que o próprio faster-whisper aplica ao VAD embutido do pipeline.
- **Modelos:** Componentes com revisão fixa, SHA-256 por arquivo, tamanho, consentimento, licença (MIT nos dois model cards) e `source_url` (ADR-0003, regra 2). O download só segue redirecionamentos para `huggingface.co` e seu CDN (`hf.co`).
- **Testes:** `cargo test -p clipes-core --test transcription` (worker falso, com crash e retomada) e `uv run --project worker pytest worker/tests` (modelos falsos). Nenhum teste acessa a rede.

A cadeia de precisão preferencial na GPU é `int8_float16`, `float16` e `int8`, seguida de CPU. O benchmark #32 observou menor WER e RTF agregado com `int8_float16` do que com `float16`, além de menor pico de VRAM; esses resultados são provisórios, conforme as limitações documentadas no benchmark. Na GPU o batch padrão permanece 1, pois a qualidade com lote maior entre trechos não foi medida; em CPU o teto testado é 8.

A tarefa `vad` do worker expõe as mesmas fronteiras e silêncios da transcrição local sem carregar um modelo Whisper; o Silero está incluído no pacote faster-whisper. O Motor remoto requer o Componente worker instalado.

Para validar a API durante o desenvolvimento foi feita uma chamada paga manual em
2026-11-14 com `whisper-large-v3-turbo` e 21,76 s do áudio CC0
[Richard Rogers - voice - en.ogg](https://commons.wikimedia.org/wiki/File:Richard_Rogers_-_voice_-_en.ogg),
convertido a FLAC mono 16 kHz em pasta temporária fora do repositório. Retornou 48
palavras com timestamps ordenados e dentro da duração do áudio. O teste ignorado lê
`CLIPES_GROQ_KEY_FILE` e `CLIPES_GROQ_TEST_AUDIO`, e os testes automáticos não usam rede.
A documentação oficial do Groq informa US$ 0,04/h para `whisper-large-v3-turbo`,
mínimo cobrado de 10 s por chamada e limite de upload de 25 MB:
<https://console.groq.com/docs/speech-to-text> (consultada em 2026-11-14).
A resposta do Groq será normalizada para ISO-639-1 usando a lista fixa de idiomas do tokenizer Whisper; valores desconhecidos ficam nulos.

## Sonda de hardware e estimativa de tempo (#50)

`core/src/components/hardware.rs` escolhe a configuração do Motor local (modelo, dispositivo e precisão) e a tarefa `probe` do worker ([`hardware_probe.py`](../../worker/src/clipes_worker/hardware_probe.py)) faz as medições. A escolha vale para `models::selection()`, que o Motor local usa ao iniciar.

- **Detecção.** VRAM livre, nome da GPU e driver vêm do `nvidia-smi --query-gpu` (NVML, sem dependência nova). Sem driver NVIDIA, inclusive em AMD e Intel, o CTranslate2 não usa a GPU: a escolha é CPU e a tela mostra "Sem GPU compatível, a Transcrição pode demorar.". A versão do CTranslate2 e os tipos de cálculo da GPU vêm da tarefa `probe` em modo `info`.
- **Cadeia.** Na GPU: `int8_float16`, `float16`, `int8`; se nada passar, CPU com o `small` INT8. A ordem difere da escrita no ticket (`float16` primeiro) por decisão do coordenador a partir do benchmark #32: `int8_float16` venceu em WER e RTF e usou menos VRAM. Cada tentativa transcreve o clipe PT/EN embutido (9 s em português e 9 s em inglês, domínio público e CC0, fontes em [THIRD_PARTY_NOTICES.md](../../THIRD_PARTY_NOTICES.md)) com `word_timestamps` e só passa se vier com palavras nos dois idiomas. Roda num processo de worker novo, encerrado se passar do tempo limite (`PROBE_TIMEOUT`, 300 s) ou se o usuário cancelar (`components.cancel` com id `hardware-probe`).
- **Lote.** O faster-whisper 1.2.1 cria um `audio_chunk` por chamada e o Motor local envia um trecho de VAD por chamada, então o lote efetivo da Transcrição é 1 (agrupar trechos é o ticket #162). A sonda mede o lote seguro da GPU com `clip_timestamps` e 8 cópias do clipe, em processos isolados: 1, 2, 4, 8, parando no primeiro que falhar. O resultado é uma MEDIÇÃO (origem `probe`, data, precisão) e só aparece no diagnóstico (`transcription.hardware.diagnostic` e o campo GPU/VRAM do diagnóstico); a UI não o mostra e o Motor não o usa. O padrão continua 1 na GPU e 8 em CPU, como no benchmark.
- **Cache.** `transcription-hardware.json` nos dados do app (`CLIPES_DATA_DIR`), nunca no Projeto: resultado por GPU, driver, versão do CT2, modelo e versão do app, a escolha manual e as taxas medidas. O Motor usa o resultado do mesmo hardware, driver e versão do app; outra GPU ou driver volta à configuração de fábrica até uma nova medição.
- **Escolha manual.** `transcription.hardware.choose` fixa uma opção da lista de `transcription.hardware.status`; `{reset: true}` volta ao automático. O `large-v3-turbo` existente roda em CPU com INT8 como opção só manual, sem modelo novo no catálogo; o padrão em CPU segue o `small`. A opção fica desabilitada com RAM física total abaixo de `TURBO_CPU_MIN_TOTAL_RAM` (8 GB). Ao iniciar uma Transcrição com o turbo em CPU e RAM disponível abaixo de `TURBO_CPU_MIN_AVAILABLE_RAM` (3 GB), `transcription.start` devolve `warnings: ["low_ram"]` (não bloqueia); se a sonda de RAM falhar, a opção fica habilitada e o aviso é `ram_unknown`. Não há teste de alocação.
- **Modelo fixo, precisão por bloco.** A Transcrição grava o MODELO ao começar e a retomada usa sempre esse modelo, mesmo que a escolha em uso ou uma sonda nova apontem outro (`LocalEngine::start_for`): uma Transcrição nunca mistura modelos. A precisão e o dispositivo podem mudar entre blocos (queda da cadeia, nova sonda, troca manual da precisão): cada bloco grava o seu em `transcription_block_config` (migração `0050_001_transcription_block_config`) e no checkpoint do job (`device`, `compute_type`; dado técnico, sem texto); `transcription.blocks` os devolve para o diagnóstico. Trocar o modelo manualmente com uma Transcrição PARCIAL usa o fluxo da troca de Motor do #51: `transcription.start` devolve `engine_change_confirmation` com os blocos perdidos, o `ConfirmDialog` da UI descarta a parcial e `replace_confirmed: true` recomeça do zero. Com a Transcrição COMPLETA, a troca vale só para uma retranscrição futura: `transcription.start` devolve a atual sem alterá-la.
- **Estimativa.** `transcription.estimate` mede 30 s da Fonte a partir de 25% da duração (nunca o início: lives abrem com tela de espera, que o VAD pula; Fonte com menos de 60 s é medida inteira), pelo mesmo caminho do Motor local, num worker próprio. Separa o carregamento do modelo (custo único) da taxa: estimativa = carregamento + taxa × duração, mostrada com faixa de ×0,7 a ×1,5. A taxa fica guardada por (hardware, modelo, precisão) e é reutilizada; `remeasure` mede de novo. É cancelável (`components.cancel` com id `transcription-estimate`), emite progresso e nunca grava na Transcrição. Referência medida no #48: RTF 0,386 ponta a ponta na RTX 3050 e 2,57 do `small` em CPU (uma live de 10 h levaria cerca de 25 h); quando a máquina cai em CPU, a UI oferece o Motor Groq como alternativa, sem empurrar.
- **Constantes** (nomeadas em `hardware.rs` e `transcription/estimate.rs`): `PROBE_TIMEOUT`, `MIN_CLIP_WORDS`, `BATCH_LADDER`, `GPU_PRECISIONS`, `TURBO_CPU_MIN_TOTAL_RAM`, `TURBO_CPU_MIN_AVAILABLE_RAM`, `SAMPLE_US`, `SAMPLE_START_PERCENT`, `WHOLE_BELOW_US`, `RANGE_LOW`, `RANGE_HIGH`.
- **Testes.** `cargo test -p clipes-core --test hardware_probe` (worker e `nvidia-smi` falsos, RAM simulada por `CLIPES_FAKE_RAM`; `CLIPES_NVIDIA_SMI` e `CLIPES_PROBE_TIMEOUT_SECONDS` só existem para os testes) e `uv run --project worker pytest worker/tests`. Nenhum acessa a rede.

## Motor Groq no aplicativo (#51)

O Motor local continua sendo o padrão. Na Fonte, a escolha **Groq · envia áudio**
mostra o custo estimado antes de começar. Sem chave, **Configurar chave** abre
Preferências; o item próprio do Groq no cofre não é compartilhado com Perfis de
Provedor. `transcription.groq.key.*` nunca devolve a chave. Testar a chave consulta
apenas a lista de modelos, sem enviar áudio.

`transcription.groq.confirm {endpoint, confirmed: true}` registra consentimento
por endpoint, em dados globais isolados por `CLIPES_DATA_DIR`. O diálogo Foco informa
que sai o áudio da faixa escolhida, o endereço de destino e que a chave fica no
cofre. Consentimento para Provedor de texto não autoriza envio de áudio.
O veto do Projeto é checado antes do consentimento, do cofre e da rede no início,
e novamente antes de cada chamada: `local_only_violation` não faz requisição.

`GroqEngine` implementa `TranscriptionEngine`. O núcleo extrai o mesmo WAV PCM
16 bits, mono 16 kHz, de até 600 s; a tarefa `vad` aplica as mesmas opções Silero
do Motor local e adia a fala que atravessa o fim. O áudio até `covered_us` é
convertido a **FLAC sem perda**, preservando os silêncios internos e as mesmas
costuras entre blocos. Dez minutos de PCM ocupam aproximadamente 19,2 MB; o upload
FLAC ainda é verificado contra um teto conservador de 24.000.000 bytes, abaixo
dos 25 MB oficiais para anexos, sem publicar o áudio numa URL.

Cada bloco com fala faz uma chamada de transcrição (`verbose_json`,
`timestamp_granularities[]=word`), sem tradução. Blocos só de silêncio não fazem
chamada paga. O modelo padrão é `whisper-large-v3-turbo`, recomendado pela
documentação para a relação preço/desempenho em transcrição multilíngue.
Os tempos retornados são relativos ao bloco; o mesmo `commit` do Motor local
soma o início absoluto da Fonte e grava palavras, silêncios, bloco concluído e
checkpoint numa única transação. Tempos inválidos, desordenados ou fora do bloco
não são gravados.

Antes do envio, `transcription_calls` registra o intervalo e a estimativa e o
checkpoint do job identifica a chamada. Timeout ou cancelamento durante a chamada
paga, assim como uma resposta HTTP 2xx inválida, vira `timeout_uncertain`/job
`uncertain`; nem iniciar novamente nem reabrir o
Projeto repete o envio automaticamente. **Repetir**, na fila, exige confirmação e
mostra o custo estimado, via `jobs.estimate`. `Retry-After` de 429 aceita segundos
ou data HTTP e espera com `CancelToken`; há no máximo três tentativas, só para
429. 401 é `groq_key`, 413 é `audio_too_large`; os erros têm mensagens fixas e
nunca carregam resposta, chave ou caminho da Fonte.

`transcription.start {project, source_id, engine?: "local" | "groq"}` usa o Motor
original quando `engine` é omitido. A Transcrição nunca mistura Motores.
Uma troca parcial produz `engine_change_confirmation`, com contagem dos blocos
perdidos e duração/custo do áudio Groq já enviado; só `replace_confirmed: true`
apaga a parcial e inicia do zero. A cobrança registrada é preservada mesmo ao
apagar a parcial. Parciais anteriores ao #51 sem histórico de blocos mostram
contagem indisponível, sem inventar um número. Tarefas ativas/incertas precisam ser encerradas antes da troca;
Transcrições completas recusam a troca com `transcript_complete`.

Descartar/encerrar um job incerto também não autoriza nova cobrança pelo botão
Retomar: `transcription_retry_confirmation` pede confirmação mostrando o custo da
chamada anterior; só `retry_confirmed: true` autoriza esse envio de novo.

A tabela embutida [`groq-prices.json`](../../core/src/transcription/groq-prices.json)
registra fonte e data. Na consulta oficial de **2026-11-15**:

| Modelo | US$/hora | Mínimo cobrado por chamada |
| --- | ---: | ---: |
| whisper-large-v3-turbo | 0,04 | 10 s |
| whisper-large-v3 | 0,111 | 10 s |

Fonte: [Groq Speech to Text](https://console.groq.com/docs/speech-to-text).
Um modelo sem preço na tabela resulta em `kind: unknown`, mostrado como
“desconhecido”. A estimativa anterior ao VAD usa a duração restante, inclusive
silêncios; a cobrança depende dos blocos efetivamente enviados e do mínimo por
chamada. O registro por chamada aplica esse mínimo ao intervalo enviado.

Validação automática sem Groq real:

```sh
CARGO_BUILD_JOBS=2 cargo test -p clipes-core --lib transcription::groq_tests
CARGO_BUILD_JOBS=2 cargo test -p clipes-core --test transcription --test groq_privacy
bun run test:ui
```

O servidor falso lê a requisição inteira antes de responder (inclusive no
Windows). A fixture `core/tests/fixtures/groq-words.json` foi escrita à mão no
formato documentado, sem dados reais. O harness cobre fronteiras do VAD, tempos
absolutos, checkpoint antes da rede, timeout/queda e retomada, consentimento,
veto, custos e troca de Motor. O teste real ignorado acima já foi executado uma
vez; não faz parte do CI nem deve ser usado como teste automático.
