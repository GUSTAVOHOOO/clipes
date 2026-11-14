# Benchmark de transcrição — RTX 3050 4 GB

O conjunto avaliado tem 30 amostras revisadas por agente, dez por Fonte: `rtZyZL3FfH4` (PT-BR), `QiwQ62ypdcI` (PT-BR) e `6LB7vibQ5q0` (EN). As demais Fontes do manifesto não foram pontuadas. Os trechos incertos foram excluídos da referência e das hipóteses por sobreposição temporal.

**Viés do gabarito:** a revisão por agente usou concordância entre Whisper large-v3 e Parakeet TDT 0.6B v3 sem escuta humana. Os resultados de Whisper e principalmente de Parakeet tendem ao otimismo; Parakeet não pode ser ranqueado justamente contra essa referência. Não foi executado como desafiante neste marco.

O limite aprovado de F1@50ms é **0,80**, provisório devido à revisão automatizada; toma como referência o resultado aproximado do CTC em inglês citado em [pesquisa anterior](2026-11-12-transcricao-profunda.md), que não é diretamente comparável ao conjunto atual. O resultado nativo abaixo desse limite exige avaliar o CTC português.

O ambiente foi Windows 11 Home Single Language 10.0.26300, AMD Ryzen 5 5600H (6 núcleos, 12 threads), 16.483.872.768 bytes de RAM, NVIDIA GeForce RTX 3050 Laptop 4 GB, driver 616.92, CUDA informado pelo driver 13.4, bibliotecas CUDA cuBLAS 12.9.1.4 e cuDNN 9.10.2.21. Python 3.11.15, faster-whisper 1.2.1, CTranslate2 4.9.0, NumPy 2.4.6, ONNX Runtime 1.32.0, AV 18.1.0; dependências completas do harness em [requirements.txt](../../benchmarks/transcricao/requirements.txt). Para CTC: PyTorch 2.8.0+cpu, torchaudio 2.8.0, Transformers 4.57.6 e WhisperX 3.7.4.

Todas as mídias tiveram SHA-256 verificado; as transcrições versionadas também conferiram após normalização de CRLF para LF. Não houve escuta humana. O processamento incluiu decodificação de trechos para mono 16 kHz, Silero (limiar 0,75, silêncio mínimo 200 ms), detecção de idioma em cada trecho de VAD, faster-whisper batched, beam 5 e timestamps por palavra. A revisão do turbo é `0a363e9161cbc7ed1431c9597a8ceaf0c4f78fcf`, e a do small é `536b0662742c02347bc0e980a01041f333bce120`.

WER normaliza caixa e pontuação e usa distância de edição; F1 alinha palavras e conta inícios e fins com desvio máximo de 50 ms, excluindo bordas marcadas incertas. A cobertura de bordas tem como denominador as bordas das palavras que permaneceram após excluir spans textuais incertos. O RTF inclui VAD, detecção de idioma e inferência, não a extração nem o carregamento inicial do modelo. O pico NVML é o total ocupado na GPU amostrado a cada 100 ms, e não uma medição exata por processo. Houve downloads e instalação de dependências durante parte da primeira rodada CUDA, que podem afetar o RTF.

Alucinação é o número de palavras da hipótese cujo ponto médio cai em região sem palavra de referência, sem VAD de fala e fora de spans incertos, por minuto dessa região. Loops são ocorrências não sobrepostas de um mesmo n-grama de três ou mais palavras repetido pelo menos três vezes, por hora de amostra. Como a transcrição é limitada às regiões de VAD, o resultado em silêncio pode ser estruturalmente zero e não mede o comportamento em áudio silencioso enviado ao decodificador.

Cada segmento VAD é passado individualmente ao `BatchedInferencePipeline` depois da detecção de idioma; por isso, `batch_size=8` no CPU é um teto e não demonstra ganho de lote entre segmentos. As diferenças entre configurações são observações de uma única execução, não estimativas com intervalo de confiança.

## Resultados

O F1 nativo permaneceu abaixo de 0,80 em todas as configurações. A cobertura de bordas após exclusão de palavras incertas foi 29,94% na Fonte `rtZyZL3FfH4`, 35,37% em `QiwQ62ypdcI`, 31,11% em `6LB7vibQ5q0` e 32,14% agregada. A fração do tempo excluída como incerta, com intervalos sobrepostos unidos, foi respectivamente 35,32%, 33,13%, 16,18% e 28,32%.

| Configuração | WER agregado | F1@50 ms | RTF | Alucinações/min sem fala | Loops/h |
|---|---:|---:|---:|---:|---:|
| turbo CUDA float16, batch 1 | 30,78% | 0,1831 | 0,223 | 0 | 1,99 |
| turbo CUDA int8_float16, batch 1 | 30,06% | 0,1830 | 0,197 | 0 | 1,99 |
| turbo CUDA int8, batch 1 | 30,06% | 0,1830 | 0,198 | 0 | 1,99 |
| small CPU int8, batch 8 | 39,21% | 0,1814 | 0,836 | 0 | 1,99 |

| Fonte | Configuração | WER | F1@50 ms | RTF | Alucinações/min | Loops/h |
|---|---|---:|---:|---:|---:|---:|
| rtZyZL3FfH4 | float16 | 23,84% | 0,2406 | 0,216 | 0 | 0 |
| rtZyZL3FfH4 | int8_float16 | 20,93% | 0,2596 | 0,209 | 0 | 0 |
| rtZyZL3FfH4 | int8 | 20,93% | 0,2596 | 0,208 | 0 | 0 |
| rtZyZL3FfH4 | small CPU | 33,58% | 0,2108 | 0,964 | 0 | 0 |
| QiwQ62ypdcI | float16 | 31,36% | 0,1560 | 0,281 | 0 | 5,92 |
| QiwQ62ypdcI | int8_float16 | 31,65% | 0,1439 | 0,228 | 0 | 5,92 |
| QiwQ62ypdcI | int8 | 31,65% | 0,1439 | 0,233 | 0 | 5,92 |
| QiwQ62ypdcI | small CPU | 47,96% | 0,1466 | 0,919 | 0 | 5,92 |
| 6LB7vibQ5q0 | float16 | 36,10% | 0,1549 | 0,171 | 0 | 0 |
| 6LB7vibQ5q0 | int8_float16 | 36,34% | 0,1508 | 0,152 | 0 | 0 |
| 6LB7vibQ5q0 | int8 | 36,34% | 0,1508 | 0,151 | 0 | 0 |
| 6LB7vibQ5q0 | small CPU | 36,34% | 0,1908 | 0,618 | 0 | 0 |

A base de silêncio avaliada foi 115,364 s, 109,536 s e 237,344 s, respectivamente, totalizando 462,244 s. Uma ocorrência de loop em `QiwQ62ypdcI` corresponde às taxas informadas. Nenhuma amostra provisória foi incluída.

## CTC em português

Como o timestamp nativo ficou abaixo de 0,80, foi aplicado WhisperX 3.7.4 em CPU, com `jonatasgrosman/wav2vec2-large-xlsr-53-portuguese` na revisão `634ac655299bcdc46c83bc01da9bab52d2987e4f`, sobre a hipótese do turbo `int8_float16`. A hipótese completa foi alinhada em janelas de até 15 s; depois foram exclídos os spans incertos da pontuação. F1@50 ms: 0,0444 em `rtZyZL3FfH4`, 0,0491 em `QiwQ62ypdcI` e 0,0469 agregado PT, com cobertura de bordas 29,94%, 35,37% e 32,70%, respectivamente; nenhuma palavra ficou sem alinhamento. Essa implementação do CTC também não atingiu 0,80 e ficou abaixo do nativo nas mesmas Fontes. O alinhador foi avaliado somente em PT; o resultado não demonstra o que ocorreria com outro método de segmentação ou gabarito humano.

## Sanidade de tempos e precisão do gabarito

As bordas de referência vêm de `Systran/faster-whisper-large-v3`, geração faster-whisper 1.2.1 com timestamps por palavra, guardadas com três casas decimais após somar o início da amostra. O motor usa `time_precision=0,02` s e arredonda tempos de palavras a 0,01 s antes dessa soma; três casas no JSON não implicam precisão de 1 ms. A revisão comparou as bordas com Parakeet e marcou como incertas as diferenças superiores a 100 ms, sem escuta humana e sem corrigir automaticamente as bordas mantidas. Logo, o F1@50 ms mede **concordância com timestamps de ASR**, não exatidão contra uma referência temporal independente.

Para palavras lexicalmente iguais após o alinhamento e com borda de referência elegível, o erro assinado é tempo da hipótese menos tempo da referência. A tabela mostra medianas e F1 agregados em diferentes tolerâncias; o CTC cobre apenas PT, e os dois primeiros resultados cobrem as três Fontes. Para comparação direta em PT, o turbo `int8_float16` teve medianas +76/+68 ms e F1 de 0,1978/0,5276/0,6941/0,7168; o small teve +64/+64 ms e 0,1772/0,4162/0,5144/0,5336.

| Sistema | Amostras | Mediana início/fim (ms) | F1 50 ms | F1 100 ms | F1 200 ms | F1 500 ms |
|---|---:|---:|---:|---:|---:|---:|
| turbo float16 | 30 | +76 / +72 | 0,1831 | 0,5169 | 0,6934 | 0,7147 |
| turbo int8_float16 | 30 | +76 / +72 | 0,1830 | 0,5261 | 0,7062 | 0,7299 |
| turbo int8 | 30 | +76 / +72 | 0,1830 | 0,5261 | 0,7062 | 0,7299 |
| small CPU int8 | 30 | +68 / +64 | 0,1814 | 0,4642 | 0,5854 | 0,6037 |
| CTC sobre turbo int8_float16 (PT) | 20 | +158 / +128 | 0,0469 | 0,1653 | 0,4811 | 0,5963 |

Os desvios positivos são reais relativamente a essa referência, mas não provam um offset do arquivo: `verify_timebase.py` comparou, em três posições de `QiwQ62ypdcI`, o áudio FFmpeg obtido por busca com a decodificação integral PyAV usada para construir a referência; a correlação encontrou diferença de aproximadamente −1 ms nas três posições, com resolução de 1 ms. Em duas posições de cada uma das três Fontes, a comparação entre busca direta e busca dois segundos antes não encontrou deslocamento na resolução de 1 ms. No harness, o deslocamento de cada VAD é contado em amostras a 16 kHz e somado ao início da amostra em segundos; no CTC, os tempos relativos são somados uma vez ao início da amostra. Essas verificações não provam precisão de borda, nem excluem viés sistemático dos modelos ou de sua segmentação. Não há correção por subtração arbitrária da mediana.

## Decisão para implementação

Para **texto**, recomenda-se provisoriamente `mobiuslabsgmbh/faster-whisper-large-v3-turbo` na revisão informada, CUDA `int8_float16`, `BatchedInferencePipeline` com batch 1, beam 5, `word_timestamps=True`, tarefa `transcribe`, Silero limiar 0,75 e silêncio mínimo 200 ms, com idioma detectado em cada trecho VAD. Entre as opções testadas, apresentou WER agregado 30,06% e RTF 0,197; a vantagem deve ser interpretada com o viés da referência e a pequena amostra. Para CPU, o caminho testado é `Systran/faster-whisper-small`, revisão informada, INT8, batch máximo 8 e os mesmos parâmetros de VAD e decodificação; a medição não prova aceleração por lote entre trechos.

Para **timestamps**, o critério de 0,80 **não foi aprovado**. Não adotar este alinhamento CTC como etapa adicional com base nesta medição: ele ficou abaixo do nativo na comparação PT com bordas de ASR. A escolha provisória do texto não aprova os timestamps. Propõe-se abrir issue de seguimento para criar um gabarito de bordas independente e confiável, por exemplo MFA ou revisão humana de uma pequena amostra, investigar os deslocamentos sistemáticos e repetir os testes com segmentação CTC validada. Até lá, nenhum dos resultados demonstra precisão real de 50 ms.

## Pico de VRAM

Uma segunda passagem, enquanto o CTC rodava em CPU, amostrou a VRAM total da GPU a cada 100 ms por amostra e reuniu o maior valor por Fonte. Os números incluem o contexto CUDA e memória mantida em cache pelo processo de Fontes anteriores; não são consumo isolado de cada Fonte. O pico agregado inclui também o carregamento do modelo. Os RTFs acima são da primeira passagem, sem essa sobreposição.

| Precisão solicitada | Precisão efetiva CTranslate2 | rtZyZL3FfH4 | QiwQ62ypdcI | 6LB7vibQ5q0 | Pico agregado |
|---|---|---:|---:|---:|---:|
| float16 | float16 | 2.573.733.888 B | 3.326.021.632 B | 3.326.021.632 B | 3.326.021.632 B |
| int8_float16 | int8_float16 | 2.252.279.808 B | 2.252.279.808 B | 2.252.279.808 B | 2.252.279.808 B |
| int8 | int8_float16 | 2.252.279.808 B | 2.252.279.808 B | 1.499.992.064 B | 2.252.279.808 B |
| small CPU int8 | int8 | — | — | — | — |

As três configurações CUDA terminaram sem OOM. A precisão solicitada `int8` foi resolvida pelo CTranslate2 para `int8_float16` nesta GPU; isso explica por que as hipóteses e as métricas de qualidade dessas duas linhas coincidiram. O pico da primeira passagem foi 2.573.733.888 B em float16, 1.499.992.064 B em int8_float16 e 1.567.100.928 B em int8; a variação entre passagens impede tratar esses valores como limites exatos de VRAM.
