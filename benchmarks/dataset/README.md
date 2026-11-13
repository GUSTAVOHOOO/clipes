# Dataset dos benchmarks de transcrição e seleção

Este conjunto usa os cinco links do [#28](https://github.com/GUSTAVOHOOO/clipes/issues/28), mais quatro Fontes adicionais indicadas pelo desenvolvedor. Os arquivos de áudio são usados apenas para medição e não são redistribuídos. O manifesto registra a origem, a data, o formato e o SHA-256 de cada arquivo; mantenha a mídia fora do Git.

Os cinco links originais são vídeos publicados, e não VODs de live segundo os metadados do YouTube. A live adicional e os três vídeos extras estão identificados no manifesto. A ausência ou insuficiência de Cortes humanos localizados está registrada por Fonte: uma lista vazia não demonstra que não existam Cortes, apenas que nenhum foi confirmado. Não se deve usar essas Fontes como referência de recall até existirem Cortes localizados e revisados.

## Obter e conferir os arquivos

Instale Python e yt-dlp; a coleta foi feita com yt-dlp `2026.11.04.232659`. Execute na raiz do repositório:

```sh
python benchmarks/dataset/download.py --directory benchmarks/dataset/local
```

O diretório local é ignorado pelo Git. O script usa o formato fixado no manifesto e verifica o SHA-256; ele falha quando um arquivo existente ou baixado não corresponde ao hash. Disponibilidade, formatos e bytes no YouTube podem mudar; uma divergência exige nova coleta e atualização explícita do manifesto, sem substituir silenciosamente o conteúdo.

## Referência e revisão

As Transcrições de referência são **provisórias até a revisão** humana prevista no [#29](https://github.com/GUSTAVOHOOO/clipes/issues/29). As amostras e seus tempos são relativos à Fonte; os critérios de escolha e as condições cobertas ficam no manifesto. Veja [REVISAO.md](REVISAO.md) para a revisão das Transcrições e conferência dos Cortes.

A busca de Cortes em 13/11/2026 usou títulos, nomes dos canais e consultas por clips dos criadores, incluindo as Fontes adicionais. Não retornou correspondências que pudessem ser localizadas e verificadas na Fonte; as listas de Cortes estão vazias por falta de confirmação. Isso limita o benchmark de seleção e não estabelece que tais Cortes não existam.

## Localizar Cortes

Para uma Fonte e um Corte com legendas disponíveis em JSON3, baixe as legendas para fora do repositório usando yt-dlp e execute:

```sh
python -m yt_dlp --skip-download --write-auto-subs --write-subs --sub-langs "pt.*,en.*" --sub-format json3 -o "diretorio-local/%(id)s.%(ext)s" URL
python benchmarks/dataset/match.py fonte.json3 corte.json3
```

O script normaliza palavras e procura sequências de cinco palavras únicas na Fonte; o resultado mostra deslocamentos candidatos, número de correspondências e exemplos com tempos. Legendas geradas podem conter erros, palavras repetidas e eventos com tempos pouco precisos; ausência de resultado não prova ausência de Corte. Ouça e confira começo e fim na Fonte e no Corte antes de registrar links, intervalos e método no manifesto. Não registre um candidato como Corte localizado sem essa conferência.

As Transcrições em `transcricoes/` foram geradas em 13/11/2026 com `faster-whisper` 1.2.1, modelo `Systran/faster-whisper-large-v3` (revisão `edaa852ec7e145841d8ffdb056a99866b5f0a478`), tarefa `transcribe`, `beam_size=5`, `word_timestamps=True` e CUDA `int8_float16`. Os tempos de cada palavra são relativos à Fonte completa; os arquivos e seus hashes constam do manifesto. O texto e os tempos exigem revisão humana antes de servirem como verdade de referência.

Nas três Fontes adicionais, a busca também incluiu consultas por canais de Cortes dos criadores. Comparações de áudio encontraram trechos isolados em compilações, mas não estabeleceram os limites de Cortes completos; downloads de algumas legendas também retornaram HTTP 429. Por isso essas correspondências parciais não entram como Cortes confirmados. As condições de áudio ainda não avaliadas e a cobertura estratificada permanecem pendentes de escuta e revisão.
