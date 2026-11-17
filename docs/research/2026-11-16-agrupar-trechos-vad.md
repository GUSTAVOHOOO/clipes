# Agrupar trechos de VAD: velocidade e qualidade (#162)

Data: 2026-11-16. Máquina do dev: RTX 3050 Laptop 4 GB, driver 616.92, outros workers rodando ao mesmo tempo (os tempos absolutos são ruidosos; compare só dentro de cada tabela).

## O que foi feito

O Motor local enviava cada trecho de VAD numa chamada a `BatchedInferencePipeline.transcribe(vad_filter=False)`, e cada chamada virava um `audio_chunk` (fato do #50). Com a opção ligada, o worker agrupa até N trechos consecutivos **do mesmo idioma** numa só chamada, passando o bloco inteiro com `clip_timestamps` (segundos) e `batch_size=N`.

- `clip_timestamps` funciona com o `BatchedInferencePipeline` do faster-whisper 1.2.1: cada clipe vira um `audio_chunk` com `offset` igual ao início do clipe, e os tempos de palavra já saem absolutos no áudio passado. Nenhuma soma de offset é necessária, e os blocos e checkpoints do #48 não mudam de formato.
- O idioma continua detectado em cada trecho; só a inferência junta os trechos.
- N na GPU é o lote seguro medido pelo #50 (1 se não houve medição); em CPU é 8. Na falta de memória (`out_of_memory`) o núcleo cai N pela metade, refaz só o bloco atual e grava a nova medição (`origin: "oom"`).
- A opção é `transcription.grouping {enabled}` e fica **desligada por padrão**.

## Método

Áudio de domínio público (LibriVox, via archive.org), nunca do dataset #28; `benchmarks/transcricao/baixar_librivox.py` traz URL e SHA-256:

- PT: Dom Casmurro, cap. 5 (Machado de Assis).
- EN: The Art of War, parte 2 (Sun Tzu).

`benchmarks/transcricao/agrupar.py` roda o mesmo código do worker (VAD Silero 0,75/200 ms, teto de 30 s, beam 5, `word_timestamps`) com tamanhos de grupo diferentes, depois de um aquecimento de 20 s. GPU: `whisper-turbo` `int8_float16`, 600 s por idioma, grupos 1, 2, 4 e 8, uma execução cada. CPU: `small` INT8 (revisão fixada), lote 8, **só 120 s por idioma e uma repetição por grupo** (um benchmark maior foi encerrado pelo sistema por pouca memória; a amostra da CPU é pequena e a máquina estava carregada).

Não há texto de referência. A qualidade é medida contra a execução atual: pela desigualdade triangular, o WER de qualquer execução contra o texto verdadeiro difere do da execução atual em no máximo (edições entre as duas ÷ palavras da execução atual), e o erro de tempo de cada palavra difere em no máximo a diferença de tempo entre as duas. Critério: WER no máximo 0,5 ponto percentual pior e erro mediano de tempo por palavra no máximo 20 ms pior.

## Resultados

GPU, 600 s de áudio (`speedup` sobre o grupo 1):

| Idioma | Grupo | Tempo (s) | speedup | VRAM pico (MiB) | Δ WER (pp) | Δ tempo mediano (ms) início/fim | p95 (ms) |
| --- | ---: | ---: | ---: | ---: | ---: | --- | --- |
| PT | 1 | 188,9 | 1,00 | 2148 | n/a | n/a | n/a |
| PT | 2 | 203,7 | 0,93 | 2479 | 0,00 | 4 / 4 | 8 |
| PT | 4 | 204,4 | 0,92 | 2596 | 0,07 | 4 / 4 | 8 |
| PT | 8 | 216,2 | 0,87 | 3142 | 0,07 | 4 / 4 | 8 |
| EN | 1 | 172,5 | 1,00 | 2148 | n/a | n/a | n/a |
| EN | 2 | 164,8 | 1,05 | 2276 | 0,00 | 4 / 4 | 10 |
| EN | 4 | 159,2 | 1,08 | 2596 | 0,00 | 4 / 4 | 8 |
| EN | 8 | 157,3 | 1,10 | 3140 | 0,00 | 4 / 4 | 8 |

CPU, `small` INT8, 120 s de áudio, grupo 8 contra o atual (lote 8 em uma chamada por trecho):

| Idioma | Atual (s) | Grupo 8 (s) | speedup | Δ WER (pp) | Δ tempo mediano (ms) |
| --- | ---: | ---: | ---: | ---: | --- |
| PT | 423,2 | 359,8 | 1,18 | 0,00 | 4 / 4 |
| EN | 384,1 | 323,6 | 1,19 | 0,00 | 4 / 4 |

## Conclusão

- **Qualidade:** sem perda. A diferença de WER é no máximo 0,07 pp (um limite de 0,5) e o tempo por palavra difere 4 ms na mediana e 8 a 10 ms no p95 (limite de 20 ms na mediana). Há palavras isoladas com diferença de até 372 ms; elas não afetam a mediana.
- **Velocidade na GPU:** de 0,87× a 1,10×, dentro do ruído de uma máquina compartilhada, e o pico de VRAM sobe de 2,1 GB para 3,1 GB com grupo 8. O ganho não aparece porque o turbo já ocupa a GPU com um trecho por vez; o agrupamento só ajuda quando os trechos são curtos.
- **Velocidade em CPU:** cerca de 1,18× com a amostra reduzida de 120 s, sem repetição.
- **Recomendação:** manter **desligado por padrão**. Na GPU o ganho não passa do ruído e custa 1 GB de VRAM, numa placa de 4 GB onde o OOM é a falha real; em CPU o ganho aparece mas a medição é pequena. Reavaliar com amostras maiores, repetições e mais GPUs (a decisão de ligar é do dev).

> **Decisão de 17/11/2026 (#279):** o agrupamento fica **ligado por padrão na CPU** e **desligado por padrão na GPU**, com escolha manual (ligar, desligar) e volta ao automático. A recomendação acima de manter desligado vale agora só para a GPU.

## Limitações

Uma execução por configuração na GPU e uma amostra de 120 s na CPU, com a máquina compartilhada; só PT e EN de leitura de audiolivro (fala contínua, trechos longos de VAD); sem texto de referência, então a qualidade é um limite superior da degradação contra a execução atual, não um WER absoluto.
