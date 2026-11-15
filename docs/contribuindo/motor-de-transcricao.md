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
