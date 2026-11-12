# Transcrição local e aceleração por hardware

Consulta: **12 de novembro de 2026**. Preços em dólares americanos; recursos e preços podem mudar.

## Resumo executivo

- Recomendo **faster-whisper/CTranslate2 com Whisper large-v3-turbo multilíngue** como Motor local inicial para PT-BR e EN, com CUDA/FP16 na NVIDIA compatível e timestamps por palavra.
- Na falta de CUDA, entregar **whisper.cpp** com Vulkan quando validado, Metal no macOS e CPU como fallback universal; avaliar OpenVINO em Intel. Em CPU, começar com `small` multilíngue quantizado e avisar que pode demorar.
- A seleção é uma hipótese de produto, não um ranking universal: testar hardware real, memória livre, qualidade e limites de palavras antes de promovê-la a padrão.
- Oferecer `large-v3` para qualidade, `distil-large-v3` apenas para inglês, e WhisperX como alinhamento/diarização opcionais; Parakeet v3 é candidato forte a avaliação posterior.
- Medir um trecho representativo da própria Fonte para estimar o tempo restante; permitir escolher modelo, backend e Motor remoto explicitamente.
- APIs pagas são opcionais, enviam áudio para terceiros e têm custo variável; preservar timestamps e obter escolha explícita do usuário antes do envio.

## Escopo e critérios

A Fonte é um arquivo ou VOD já encerrado; a Transcrição precisa de texto e início/fim por palavra para escolher Cortes e gerar suas legendas. O Motor de transcrição é independente do Provedor de LLM. WER = (substituições + inserções + deleções) / palavras de referência; menor é melhor, mas depende de conjunto, normalização, sotaques, ruído e segmentação. As medições abaixo não provam qualidade em lives de PT-BR. Não executar tradução para inglês ao transcrever português. O Whisper trata transcrição e tradução como tarefas distintas. [Paper Whisper](https://cdn.openai.com/papers/whisper.pdf)

## Modelos e runtimes

| Opção | Evidência e decisão | Palavras e falantes |
|---|---|---|
| Whisper large-v3 | Multilíngue; opção de qualidade quando houver recursos. Arquivo GGML FP16 2,9 GiB; não equivale ao pico de memória. [Modelos whisper.cpp](https://github.com/ggml-org/whisper.cpp/blob/master/models/README.md) | faster-whisper expõe `word_timestamps`; diarização exige etapa separada. [faster-whisper](https://github.com/SYSTRAN/faster-whisper) |
| large-v3-turbo | Multilíngue; escolha inicial pelo equilíbrio. Arquivo GGML 1,5 GiB, Q5 547 MiB; o consumo em execução é maior. Turbo é otimizado para Transcrição, não para tradução. [Modelos](https://github.com/ggml-org/whisper.cpp/blob/master/models/README.md), [model card](https://huggingface.co/openai/whisper-large-v3-turbo) | faster-whisper fornece palavras; verificar precisão em fronteiras de fala, música e VOD longo. [faster-whisper](https://github.com/SYSTRAN/faster-whisper) |
| distil-large-v3 | **Somente inglês**; não selecionar para PT-BR. O autor relata >5x no Mac M1 e diferença de até 0,8 ponto de WER em áudio longo em sua avaliação; não extrapolar para Windows ou português. [Model card](https://huggingface.co/distil-whisper/distil-large-v3) | Usar timestamps do runtime; diarização separada. |
| faster-whisper / CTranslate2 | Runtime de Whisper, não modelo. Suporta CPU, CUDA, quantização e batching; oferece VAD e timestamps por palavra. [Projeto e benchmark](https://github.com/SYSTRAN/faster-whisper) | Palavras nativas aproximadas; diarização externa. |
| whisper.cpp | Runtime C/C++ com quantização e backends compiláveis; opção portátil para Vulkan, Metal e CPU. A implementação marca timestamps por token/DTW como experimentais: validar agrupamento em palavras e precisão antes de cumprir o contrato da Transcrição. [Código](https://github.com/ggml-org/whisper.cpp/blob/master/src/whisper.cpp), [backends](https://github.com/ggml-org/whisper.cpp/blob/master/ggml/CMakeLists.txt) | Modelos `tdrz` marcam turnos, mas não confundir com diarização geral ou identificação de pessoas; o modelo listado é `small.en-tdrz`. [Modelos](https://github.com/ggml-org/whisper.cpp/blob/master/models/README.md) |
| WhisperX | Pipeline sobre faster-whisper com VAD, alinhamento forçado por idioma e diarização opcional via pyannote. PT exige conferir o modelo de alinhamento e sua licença. É processamento extra, não garantia de qualidade. [WhisperX](https://github.com/m-bain/whisperX) | Números e símbolos fora do vocabulário podem ficar sem tempo; sobreposição e diarização são imperfeitas; modelo de diarização indicado exige aceitar termos e token Hugging Face. [WhisperX](https://github.com/m-bain/whisperX) |
| NVIDIA Parakeet TDT 0.6B v3 | Multilíngue, PT e EN, licença CC-BY-4.0; produz timestamps por palavra e merece benchmark local. A NVIDIA alerta que seu treino em português usa variante europeia. [Model card](https://huggingface.co/nvidia/parakeet-tdt-0.6b-v3) | Timestamps do modelo; diarização é etapa separada. Validar segmentação de VOD e instalação. |
| NVIDIA Canary 1B v2 | Multilíngue e tradução; processamento longo com janelas. A NVIDIA informa WER médio 8,40% em FLEURS de 25 idiomas e 7,15% no benchmark inglês; não é WER PT-BR isolado. [Model card](https://huggingface.co/nvidia/canary-1b-v2) | Não confirmei contrato de timestamps por palavra e diarização para esse checkpoint: não selecioná-lo como padrão sem alinhador validado. |
| TheWhisper | Candidato adicional, avaliação publicada pelo próprio autor. Não há evidência suficiente aqui sobre empacotamento, licença, timestamps e operação multiplataforma para recomendá-lo. [Benchmark](https://github.com/TheStageAI/TheWhisper/blob/main/benchmark/README.md) | Não confirmado. |

### Qualidade e benchmarks públicos

O benchmark do autor de TheWhisper, que também compara concorrentes, calcula média de WER sobre FLEURS, MLS e Common Voice 23: turbo PT **5,97%** e EN **4,80%**; Parakeet v3 PT **5,41%** e EN **4,85%**; Canary v2 PT **6,23%** e EN **4,70%**. São números de um fornecedor interessado, não resultados independentes nem garantia de PT-BR. [Tabela e metodologia](https://github.com/TheStageAI/TheWhisper/blob/main/benchmark/README.md)

A NVIDIA mede Parakeet v3 em PT: **4,76% FLEURS**, **7,50% MLS**, **3,96% CoVoST**; EN **4,85% FLEURS** e **6,80% CoVoST**, sem pontuação e capitalização. A NVIDIA ressalta a diferença entre PT europeu no treino e PT-BR em benchmarks; não misturar esses números com outra normalização. [Model card](https://huggingface.co/nvidia/parakeet-tdt-0.6b-v3)

A SYSTRAN testou 13 minutos com large-v2, beam 5 e RTX 3070 Ti 8 GB/CUDA 12.4: faster-whisper FP16 **63 s / 4.525 MB**, INT8 **59 s / 2.926 MB**; batch 8 INT8 **16 s / 4.500 MB**; whisper.cpp FP16 **65 s / 4.127 MB**. Em i7-12700K, 8 threads e small: faster-whisper INT8 **102 s / 1.477 MB**, batch 8 **51 s / 3.608 MB**; whisper.cpp FP32 **125 s / 1.049 MB**, OpenVINO **105 s / 1.642 MB**. Esses valores são dessa configuração, não estimativas de turbo, todo CPU ou toda GPU. [Benchmark SYSTRAN](https://github.com/SYSTRAN/faster-whisper)

## Aceleração e distribuição

- **NVIDIA Windows/Linux:** começar com faster-whisper CUDA, FP16 ou INT8 conforme disponibilidade; batching aumenta throughput mas também VRAM. TensorRT/TensorRT RTX é uma otimização sobre a pilha NVIDIA, não alternativa independente a hardware NVIDIA. A NVIDIA publicou turbo a 58,5x tempo real e comparação 3,8x em suas condições; verificar metodologia e custo de compilação antes de extrapolar para o app. [SYSTRAN](https://github.com/SYSTRAN/faster-whisper), [NVIDIA](https://developer.nvidia.com/blog/build-local-ai-apps-with-c-and-nvidia-tensorrt-rtx-samples)
- **AMD:** experimentar whisper.cpp Vulkan no Windows/Linux; ROCm/HIP no CTranslate2 é outra possibilidade, mas Windows requer build e dependências específicos e tem limitações. Não presumir que qualquer placa AMD ou driver funcione. [CTranslate2 hardware](https://opennmt.net/CTranslate2/hardware_support.html), [build ROCm Windows](https://opennmt.net/CTranslate2/building_rocm_windows.html)
- **Intel:** experimentar whisper.cpp OpenVINO no encoder e Vulkan; medir contra CPU, pois não há vencedor universal. O benchmark CPU acima favorece OpenVINO nessa configuração. [whisper.cpp](https://github.com/ggml-org/whisper.cpp), [SYSTRAN](https://github.com/SYSTRAN/faster-whisper)
- **Apple Silicon:** whisper.cpp Metal; CPU como fallback. CTranslate2 também documenta MPS experimental, com seleção explícita e limitações; benchmark próprio antes de adotá-lo. [whisper.cpp](https://github.com/ggml-org/whisper.cpp), [CTranslate2](https://opennmt.net/CTranslate2/hardware_support.html)
- **DirectML:** requer pipeline ONNX compatível, não é um backend direto de faster-whisper ou whisper.cpp. A Microsoft o mantém como legado e direciona recursos novos ao Windows ML; seus EPs requerem modelo, operador, dispositivo e driver compatíveis. Avaliar como caminho adicional, sem prometer que acelera todo modelo. [DirectML](https://learn.microsoft.com/en-us/windows/ai/directml/dml-get-started), [Windows ML](https://learn.microsoft.com/windows/ai/new-windows-ml/supported-execution-providers)
- **CPU:** faster-whisper INT8 ou whisper.cpp quantizado; manter build compatível com arquitetura do usuário. CTranslate2 documenta x86-64 SSE 4.1 mínimo e ARM64, com seleção de instruções; não assumir suporte para máquinas fora dessa matriz. [Hardware CTranslate2](https://opennmt.net/CTranslate2/hardware_support.html)

Distribuir binários e pesos adequados a cada plataforma, verificar licenças e integridade, permitir download e uso posterior offline. CUDA/cuDNN, builds HIP e drivers têm compatibilidades próprias; testar instalação limpa, inclusive offline. [Instalação CTranslate2](https://opennmt.net/CTranslate2/installation.html)

## Detecção e escolha: hardware → modelo recomendado

**Proposta de política, não requisitos medidos**: limites abaixo são pontos de partida conservadores para testes; VRAM nominal não garante memória livre, e consumo muda com precisão, batch, alinhamento e runtime.

| Hardware e orçamento disponível | Primeira tentativa | Fallback |
|---|---|---|
| NVIDIA CUDA, ≥6 GiB livres | turbo FP16, batch pequeno; testar large-v3 como qualidade | turbo INT8, batch 1; depois CPU |
| NVIDIA CUDA, 3–6 GiB livres | turbo INT8, batch 1 | `small` INT8; CPU |
| NVIDIA com menos de 3 GiB livres | `small` INT8 após teste de alocação | CPU INT8 |
| AMD/Intel com Vulkan funcional | whisper.cpp turbo Q5 se couber com margem | `small` quantizado, depois CPU; Intel: comparar OpenVINO |
| Apple Silicon | whisper.cpp Metal turbo Q5 se couber na memória unificada | `small` quantizado; CPU |
| CPU somente, RAM disponível suficiente | faster-whisper `small` multilíngue INT8 | whisper.cpp `base`/`tiny` multilíngue; usuário pode escolher modelo maior mais lento |
| Memória insuficiente até para o menor modelo | Não iniciar às cegas; apresentar erro com necessidade medida e escolha | liberar memória, outra máquina ou API escolhida |

1. No Windows, enumerar adaptadores DXGI, identificação e memória dedicada/compartilhada; usar `IDXGIAdapter3::QueryVideoMemoryInfo` para orçamento e uso atuais por segmento, sem somar indiscriminadamente memória compartilhada como VRAM dedicada. Adaptadores de software devem ser identificados; notebooks podem ter múltiplas GPUs. [DXGI](https://learn.microsoft.com/en-us/windows/desktop/direct3ddxgi/d3d10-graphics-programming-guide-dxgi), [orçamento](https://learn.microsoft.com/en-us/windows/win32/api/dxgi1_4/nf-dxgi1_4-idxgiadapter3-queryvideomemoryinfo)
2. Consultar RAM física disponível via API do sistema e capacidade de disco; no Linux/macOS usar APIs nativas equivalentes e distinguir memória unificada. Inventário é indício: verificar runtime, versão de driver, dispositivo e tipos de cálculo de fato disponíveis. CTranslate2 expõe `get_supported_compute_types`; HIP também usa `device="cuda"`, portanto o nome não identifica o fabricante. [CTranslate2](https://opennmt.net/CTranslate2/hardware_support.html), [verificação HIP](https://opennmt.net/CTranslate2/building_rocm_windows.html)
3. Para Vulkan enumerar dispositivos através do runtime compilado; para Windows ML ONNX enumerar `GetEpDevices` e selecionar EP efetivamente instalado. Testar inicialização e inferência curta com o modelo/backend exato: lista de dispositivos não prova suporte a todas as operações. [Windows ML](https://learn.microsoft.com/en-us/windows/ai/new-windows-ml/select-execution-providers)
4. Reservar folga, testar batch 1, reduzir batch/precisão/modelo em caso de falta de memória e tentar próximo backend. Isolar falha de driver/processo e informar claramente a troca; nunca trocar para API paga automaticamente. Registrar versão, configuração e motivo do fallback sem enviar áudio ou dados de hardware sem consentimento. Essas regras são proposta de implementação.
5. Estimar após aquecimento processando trecho representativo: `tempo restante ≈ segundos restantes da Fonte × (tempo de processamento / segundos de áudio medidos)`, incluindo preparação/alinhamento quando possível. Mostrar intervalo inicialmente incerto e atualizar com média móvel; não prometer prazo baseado apenas no modelo de CPU. Exemplo hipotético: 60 s de amostra em 120 s implica cerca de 2 h para 1 h restante. Silêncio, densidade de fala, temperatura e outros programas mudam a taxa. Aviso: “Sem GPU compatível, a Transcrição pode demorar; estimativa será atualizada durante o processamento.”

## APIs pagas como alternativa

Preços públicos de tabela, por hora de áudio convertido quando apropriado; mínimos, impostos, canais, cotas e add-ons podem alterar o total. Qualidade não é comparável sem mesmo corpus/normalização; não inferir que uma API vence as demais.

| Motor remoto | Preço base | Palavras, qualidade e limites |
|---|---|---|
| OpenAI `gpt-transcribe` | US$ 0,0045/min = **US$ 0,27/h** | Modelo atual para Transcrição; não confirmei suporte a timestamps por palavra nele. `whisper-1` oferece granularidade de palavra, mas está anunciado para encerramento em 26/02/2027; não depender dele como integração duradoura. `gpt-4o-transcribe-diarize` não aceita granularidade de palavra. [Preço](https://developers.openai.com/api/docs/pricing), [API](https://developers.openai.com/api/reference/resources/audio/subresources/transcriptions/methods/create) |
| Groq Whisper large-v3 / turbo | **US$ 0,111/h / US$ 0,04/h** | Multilíngue; `verbose_json` com `timestamp_granularities` palavra. Autor informa WER agregado 10,3% / 12%, sem prova de qualidade específica de PT-BR; turbo não traduz. Mínimo faturado 10 s, limite de arquivo depende do plano; tratar divisões e sobreposições. [Docs e preço](https://console.groq.com/docs/speech-to-text) |
| Deepgram Nova-3 pré-gravado | **US$ 0,258/h** monolíngue; **US$ 0,312/h** multilíngue | Resposta contém palavras e tempos; diarização é recurso adicional e disponibilidade varia por modelo/idioma. Validar PT-BR, EN e preço da diarização pré-gravada na contratação. [Preço](https://deepgram.com/pricing), [API](https://developers.deepgram.com/reference/speech-to-text/listen-pre-recorded) |
| AssemblyAI Universal-2 / Universal-3.5 Pro pré-gravado | **US$ 0,15/h / US$ 0,21/h**; diarização + **US$ 0,02/h** | Timestamps por palavra incluídos; verificar disponibilidade de PT-BR no modelo exato. Canais múltiplos são faturados separadamente. [Preço e recursos](https://www.assemblyai.com/pricing/) |

Para arquivos longos, preservar offsets absolutos, unir palavras duplicadas em sobreposições e tratar respostas parciais; nunca deixar lacunas de timestamps silenciosamente. Exibir custo estimado, limites, política de dados e confirmação de envio antes de cada uso remoto. Isso é desenho proposto, não característica automaticamente fornecida por cada API.

## Plano de validação antes de fechar a escolha

1. Montar corpus autorizado com VODs PT-BR e EN, sotaques, jargão, música, silêncio, sobreposição e falas mistas; particionar por Fonte para evitar vazamento. Fazer referência humana com tempos por palavra e falantes.
2. Comparar large-v3, turbo, small, distil inglês, Parakeet e APIs com mesmos trechos, normalização e configurações explicitadas. Medir WER por idioma, taxa de palavras sem tempo, erro de início/fim, omissões, alucinações em silêncio, diarização, tempo total, pico de RAM/VRAM e custo por hora. Medir qualidade de Cortes e legendas em revisão humana.
3. Executar matriz limpa em NVIDIA/AMD/Intel Windows, CPU fraca e forte, Linux e macOS; anotar hardware, drivers, versões, precisão, batch, resolução de falhas e distribuição. Escolher limites de memória com base em picos observados, não nos tamanhos de arquivo.

## Perguntas em aberto

- Qual é o WER, erro temporal por palavra e taxa de alucinação em VODs reais PT-BR/EN do Clipes, especialmente nomes próprios e troca de idioma?
- Qual backend Vulkan/OpenVINO/ROCm apresenta melhor velocidade e estabilidade em cada GPU Windows suportada, inclusive integrada e VRAM compartilhada? Não há base para declarar um vencedor universal.
- O alinhamento por palavra de whisper.cpp, incluindo tokens sem tempo, satisfaz o contrato de Transcrição em PT-BR e EN sem etapa adicional? Qual modelo e licença de alinhamento PT do WhisperX serão empacotados?
- Quanto custam RAM, VRAM, tamanho de download e tempo de instalação do turbo e alinhador em cada configuração efetivamente distribuída? Os limites da tabela são hipóteses.
- Quais modelos OpenAI atuais fornecem tempos por palavra documentados e suportados após a retirada de `whisper-1`? Confirmar também suporte de idiomas, diarização e políticas de retenção de cada API no momento da integração.
- Quais builds, licenças, redistribuição de bibliotecas e pesos, compatibilidade offline e Windows ARM64 serão aceitos para a v1? Parakeet e Canary podem superar o padrão no corpus do produto?
