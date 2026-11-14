# Dataset dos benchmarks de transcrição e seleção

Este conjunto usa os cinco links do [#28](https://github.com/GUSTAVOHOOO/clipes/issues/28), mais seis Fontes adicionais indicadas pelo desenvolvedor. Os arquivos de áudio são usados apenas para medição e não são redistribuídos. O manifesto registra a origem, a data, o formato e o SHA-256 de cada arquivo; mantenha a mídia fora do Git.

Os cinco links originais são vídeos publicados, e não VODs de live segundo os metadados do YouTube. As três lives e os três vídeos extras estão identificados no manifesto. As lives têm 38 segmentos de publicações humanas localizados por áudio: 14 no Paulinho, 11 em GTA 5 e 13 em GTA 4. Os oito guias/vídeos editados têm zero, com o motivo registrado por Fonte; uma lista vazia não demonstra inexistência de Cortes. A referência de recall usa apenas itens revisados e requer atenção a cenas sobrepostas entre publicações.

## Obter e conferir os arquivos

Instale Python e yt-dlp; a coleta foi feita com yt-dlp `2026.11.04.232659`. Execute na raiz do repositório:

```sh
python benchmarks/dataset/download.py --directory benchmarks/dataset/local
# Inclui os nove áudios de publicações humanas, sem baixar de novo a cada segmento:
python benchmarks/dataset/download.py --directory benchmarks/dataset/local --include-clips
```

O diretório local é ignorado pelo Git. O script usa o formato fixado no manifesto e verifica o SHA-256; ele falha quando um arquivo existente ou baixado não corresponde ao hash. Disponibilidade, formatos e bytes no YouTube podem mudar; uma divergência exige nova coleta e atualização explícita do manifesto, sem substituir silenciosamente o conteúdo.

## Referência e revisão

### Proveniência e incerteza da etapa 1

Itens revisados por agente levam `review.by: "agent"`, método, data e
`coverage`, com percentual de palavras concordantes, número de spans incertos
e número de bordas ajustadas. O segundo motor é o NVIDIA Parakeet TDT 0.6B v3
([modelo e licença CC BY 4.0](https://huggingface.co/nvidia/parakeet-tdt-0.6b-v3));
ele foi usado apenas para conferência, sem entrar no aplicativo. O gabarito
continua sujeito a erros compartilhados pelos motores.

As amostras foram divididas em janelas de até 15 s para o Parakeet. Os tokens
foram reunidos em palavras e comparados com o Whisper, ignorando caixa e
pontuação e expandindo números; a correspondência também exigiu centros a
menos de 1,5 s. A cobertura usa as palavras do Whisper como denominador e
exclui palavras que se sobreponham a spans incertos. As bordas não confirmadas
pelos dois motores em até 100 ms foram registradas como incertas.

Em cada amostra revisada, `incertos` é uma lista de objetos com `start` e
`end` em segundos relativos à Fonte e `whisper` e `parakeet` com as hipóteses
dos dois motores; uma hipótese vazia indica ausência de palavra naquele motor.
`vad_fala_pct` é o percentual do intervalo classificado como fala pelo VAD;
é um sinal auxiliar e não resolve sozinho qual hipótese está correta.
Um benchmark deve excluir da pontuação os trechos sobrepostos a esses spans e
informar a fração excluída. O campo `bordas_incertas` identifica o índice da
palavra, a borda (`start` ou `end`) e os tempos de cada motor quando diferem em
mais de 100 ms; isso não significa que o tempo original tenha sido corrigido.
Uma revisão humana posterior pode substituir a procedência item a item.

Para cada Corte, `review.bordas` registra o tempo anterior e o atual. Uma
`borda não ajustada` foi mantida por falta de confirmação suficiente; as demais
registram a pausa VAD e o resultado da correlação de um segundo no lado do
conteúdo. A cobertura textual do Corte se refere apenas às janelas próximas às
duas bordas. `palavras_concordantes_pct` é `null` quando não há palavras do
Whisper nessas janelas para servir de denominador.

As Transcrições sem procedência de revisão permanecem **provisórias**. As amostras e seus tempos são relativos à Fonte; os critérios de escolha e as condições cobertas ficam no manifesto. Veja [REVISAO.md](REVISAO.md) para a revisão das Transcrições e conferência dos Cortes.

A busca de Cortes em 13/11/2026 usou `ytsearch30`, com jogo, criador, canais de clips e janela de datas. Os candidatos têm menos de 20 minutos e publicação posterior ao início da live; alguns foram publicados durante a transmissão, depois do trecho correspondente. `broadcast_started_utc` e `uploaded` distinguem o dia da transmissão do dia de publicação do VOD. O casamento com a Fonte exata confirma o jogo/dia; títulos isolados e compilações de outros dias não são evidência suficiente. As consultas, candidatos efetivamente processados e regra de parada ficam em `clips_search`.

## Localizar Cortes

O procedimento principal usa somente áudio, sem legendas, pyannote ou token. Instale as dependências e tenha ffmpeg no PATH:

```sh
python -m pip install numpy==2.4.4 scipy==1.17.1
python -m pip install -U --pre "yt-dlp[default]"
python -m yt_dlp -f ba --write-info-json -o "diretorio-local/%(id)s.%(ext)s" URL_DO_CLIPE
python benchmarks/dataset/audio_match.py diretorio-local/FONTE.webm diretorio-local/CLIPE.webm --cache diretorio-local/pcm --output diretorio-local/matches.json
```

O cache guarda PCM mono a 8 kHz fora do Git; apague-o se substituir a mídia original. O matcher calcula mudanças da energia logarítmica em 22 bandas, por STFT de 512 amostras com salto de 400 (50 ms). Procura janelas de seis segundos a cada três segundos na live inteira: correlação espectral ≥0,35 e margem ≥0,05 sobre o segundo pico, excluindo uma vizinhança de dois segundos. Janelas quase silenciosas não participam da disputa. Confirma o resultado pela correlação normalizada absoluta da forma de onda ≥0,65, com refinamento de ±150 ms. Pelo menos duas âncoras precisam concordar no deslocamento com tolerância de 25 ms.

Saltos de deslocamento separam segmentos de compilações. Cada segmento é verificado por janelas de um segundo a cada 250 ms (correlação ≥0,55), com margem interior de 500 ms nas bordas; só entram trechos de pelo menos dez segundos. Detecções sobrepostas com o mesmo deslocamento dentro de uma publicação são unidas. Os tempos delimitam conteúdo confirmado, podendo excluir partes da edição humana; as bordas completas exigem revisão. `score` é a menor correlação das âncoras inteiramente contidas no segmento, e não uma probabilidade; `anchor_evidence`, `anchor_count` e `coarse_score` preservam evidência. Os parâmetros também constam em `audio_matching` no manifesto.

Cada segmento de cada publicação é um Corte localizado; publicações diferentes podem conter cenas sobrepostas na Fonte. A busca para ao atingir dez por live, preservando resultados do clipe/lote já em execução; não é um censo exaustivo da web. Não dividir um trecho contínuo arbitrariamente para atingir a meta. Os três totais e os nove arquivos de origem estão em `manifest.json` e [REVISAO.md](REVISAO.md).

O script anterior por legendas continua disponível como auxiliar. Para uma Fonte e um Corte com legendas em JSON3:

```sh
python -m yt_dlp --skip-download --write-auto-subs --write-subs --sub-langs "pt.*,en.*" --sub-format json3 -o "diretorio-local/%(id)s.%(ext)s" URL
python benchmarks/dataset/match.py fonte.json3 corte.json3
```

O script normaliza palavras e procura sequências de cinco palavras únicas na Fonte; o resultado mostra deslocamentos candidatos, número de correspondências e exemplos com tempos. Legendas geradas podem conter erros, palavras repetidas e eventos com tempos pouco precisos; ausência de resultado não prova ausência de Corte. Confira começo e fim por áudio ou Transcrição antes de registrar links, intervalos e método no manifesto; a escuta humana permanece prevista na revisão. Não registre um candidato como Corte localizado sem essa conferência.

As Transcrições em `transcricoes/` foram geradas em 13/11/2026 com `faster-whisper` 1.2.1, modelo `Systran/faster-whisper-large-v3` (revisão `edaa852ec7e145841d8ffdb056a99866b5f0a478`), tarefa `transcribe`, `beam_size=5`, `word_timestamps=True` e CUDA `int8_float16`. Os tempos de cada palavra são relativos à Fonte completa; os arquivos e seus hashes constam do manifesto. Use como referência apenas amostras revisadas, informando a procedência e excluindo os spans incertos.

O método anterior dependia de poucas janelas e de legendas, algumas com HTTP 429. A coleta atual confirma segmentos pelo áudio completo e registra início/fim no clipe e na Fonte, hash e score. A revisão por agente não substitui escuta humana, identificação dos locutores ou conferência da edição completa.

## Estratificação por sinais de áudio

A análise usa quadros de um segundo em mono a 16 kHz e Silero VAD (limiar 0,75, silêncio mínimo de 200 ms). Marca-se uma **candidata a música alta** quando a amostra tem pelo menos oito segundos com RMS ≥ −25 dBFS e menos de 10% de fala segundo o VAD; um **candidato a gritos** tem pelo menos três segundos com RMS ≥ −9 dBFS e mais de 60% de fala. Esses sinais são proxies: ruídos, efeitos, música confundida com voz e fala alta podem produzir falsos positivos, e a ausência do sinal não prova ausência da condição. Os números por amostra constam em `metrics_audio` e devem ser ouvidos e corrigidos no #29; o método não distingue locutores, então várias vozes ficam para conferência humana.

Onde os limiares foram atingidos, buscou-se manter pelo menos duas amostras candidatas, com bordas em lacunas do VAD, e as demais em alvos distribuídos pela Fonte. O idioma é detectado pelo large-v3 em janelas de até 15 segundos; inglês só é sinalizado com probabilidade de pelo menos 0,8. Todas essas anotações são provisórias até a revisão.
