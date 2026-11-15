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
paga vira `timeout_uncertain`/job `uncertain`; nem iniciar novamente nem reabrir o
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
