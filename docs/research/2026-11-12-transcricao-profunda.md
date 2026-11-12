# Transcrição local: velocidade, detecção de hardware e melhor modelo

Data: 2026-11-12. Quatro pesquisadores Haiku fizeram a pesquisa, um por ângulo: velocidade, detecção, modelos e mundo real. Um modelo maior fez a síntese final. Cada afirmação traz a sua fonte. Quando algo é inferência ou tem confiança baixa, o texto diz isso.

Ticket: "Transcrição local: velocidade máxima, detecção de hardware e melhor modelo".

## Resumo executivo

- **Motor da v1:** fica o faster-whisper (CTranslate2) com Whisper large-v3-turbo. É o caminho mais maduro e tem licença MIT. Faz timestamp por palavra com `word_timestamps=True` ([faster-whisper](https://github.com/SYSTRAN/faster-whisper)).
- **Regra de VRAM:** a proposta atual usa "FP16 só com 6 GB ou mais". Ela parece conservadora demais. O turbo usou cerca de 2,5 GB em FP16 num teste comunitário ([HF #3](https://huggingface.co/deepdml/faster-whisper-large-v3-turbo-ct2/discussions/3)) e 2,0 a 2,7 GB numa medição de fornecedor ([Runpod](https://www.runpod.io/articles/guides/best-gpu-for-whisper)). Na RTX 3050 4 GB, o FP16 deve ser o primeiro teste. O INT8 serve para economizar VRAM. No único teste público, INT8 e FP16 levaram o mesmo tempo.
- **Velocidade:** os maiores ganhos com custo baixo vêm de três coisas. Usar o turbo em vez do large-v3 (cerca de 2,7x). Usar o VAD. Usar o `BatchedInferencePipeline` (cerca de 3,7x, mas com uns 1,5 GB a mais de VRAM). TensorRT, insanely-fast-whisper e speculative decoding ficam para depois da v1.
- **Detecção:** a VRAM vem do DXGI no Windows, nunca do WMI. Nas NVIDIA, o NVML complementa. Depois vem a sonda do CTranslate2. Por fim, um **teste curto de inferência real** com fallback em cadeia e cache por (GPU, driver, versão). O usuário sempre pode trocar a escolha.
- **Timestamp por palavra:** é o maior risco técnico. No inglês, o método nativo por atenção cruzada teve F1@50ms de 41,2. O alinhamento forçado CTC teve 79,9 ([arXiv 2509.09987](https://arxiv.org/html/2509.09987v1)). Vale avaliar um alinhamento CTC em PT como segunda etapa.
- **Mundo real:** usar VAD sempre. Não passar o áudio pelo Demucs antes do ASR, porque isso piora o Whisper ([Jam-ALT](https://arxiv.org/html/2408.06370v1)). Detectar o idioma por segmento de VAD, não por janela de 30 s. Processar vídeos longos em blocos com checkpoint.
- **Divergência aberta:** o pesquisador de modelos prefere o Parakeet TDT 0.6B v3. Ele tem timestamp por palavra nativo e é muito rápido em CPU. Os outros mantêm o faster-whisper. A síntese mantém o turbo na v1 e põe o Parakeet como primeiro candidato do benchmark interno, sobretudo para CPU. O Parakeet não tem caminho confirmado no CTranslate2, foi treinado em PT europeu e a licença tem conflito entre fontes.
- **Lacuna:** não existe número público de RTF, VRAM ou qualidade em RTX 3050 4 GB, nem em VODs de jogos PT/EN. A decisão final depende de um benchmark local.

## 1. Melhor modelo para PT-BR e EN

Avisos de leitura:

- Os WER de PT vêm de fontes diferentes. Os cards oficiais usam FLEURS, greedy e sem LM. O agregador Handy usa Q8_0 e é fonte secundária. Por isso não dá para comparar os números diretamente.
- O WER de EN é a média do Open ASR Leaderboard publicada em cada card. A tabela ao vivo do leaderboard não carregou, então o ranking geral não foi confirmado ([leaderboard](https://huggingface.co/spaces/hf-audio/open_asr_leaderboard)).
- O RTFx de cada card usa um hardware diferente e muitas vezes não declarado.

| Modelo | WER PT | WER EN (média Open ASR) | Timestamp por palavra | VRAM | Velocidade | Licença | Runtimes |
|---|---|---|---|---|---|---|---|
| **Whisper large-v3-turbo** (809M) | 4,17% FLEURS, Q8_0, agregador ([Handy](https://models.handy.computer/languages/pt)); não há valor no card | 7,83 ([card](https://huggingface.co/openai/whisper-large-v3-turbo)) | Sim, por atenção cruzada + DTW ([faster-whisper](https://github.com/SYSTRAN/faster-whisper)); precisão questionável (seção 4) | FP16 2,0 a 2,7 GB, INT8 1,1 a 1,8 GB ([Runpod](https://www.runpod.io/articles/guides/best-gpu-for-whisper)); CT2 FP16 2537 MB, INT8 1545 MB ([HF #3](https://huggingface.co/deepdml/faster-whisper-large-v3-turbo-ct2/discussions/3)); o README da OpenAI diz cerca de 6 GB, mas é a implementação PyTorch ([openai/whisper](https://github.com/openai/whisper)) | RTFx 200,19 ([card](https://huggingface.co/openai/whisper-large-v3-turbo)); 3,1x em GPU e 1,4x em CPU no agregador ([Handy](https://models.handy.computer/languages/pt)) | MIT | faster-whisper (CT2), whisper.cpp, Transformers |
| Whisper large-v3 (1550M) | 3,88% Q8_0, agregador ([Handy](https://models.handy.computer/languages/pt)) | não consta nos achados | Sim (igual ao turbo) | FP16 3,3 a 4,4 GB de pico, INT8 1,7 a 2,5 GB ([Runpod](https://www.runpod.io/articles/guides/best-gpu-for-whisper)); CT2 FP16 4521 MB ([HF #3](https://huggingface.co/deepdml/faster-whisper-large-v3-turbo-ct2/discussions/3)) | 52,0 s contra 19,2 s do turbo no mesmo teste ([HF #3](https://huggingface.co/deepdml/faster-whisper-large-v3-turbo-ct2/discussions/3)) | MIT | iguais ao turbo |
| Whisper small (244M) | 7,3 FLEURS, paper de 2022 ([arXiv 2212.04356](https://arxiv.org/html/2212.04356v1)) | não consta nos achados | Sim | cerca de 2 GB em PyTorch ([openai/whisper](https://github.com/openai/whisper)) | CPU INT8 batch 8: 51 s para 13 min de áudio, cerca de 15x tempo real, num i7-12700K ([faster-whisper](https://github.com/SYSTRAN/faster-whisper)) | MIT | iguais ao turbo |
| **Parakeet TDT 0.6B v3** | 4,76% FLEURS, 7,50% MLS ([card](https://huggingface.co/nvidia/parakeet-tdt-0.6b-v3)); treinado em PT europeu | 6,34 ([card](https://huggingface.co/nvidia/parakeet-tdt-0.6b-v3)) | Sim, nativo (palavra, segmento e caractere) | não publicada; o card pede pelo menos 2 GB de RAM para carregar | RTFx 3.332,74 ([card](https://huggingface.co/nvidia/parakeet-tdt-0.6b-v3)); 13,7x em CPU no agregador ([Handy](https://models.handy.computer/languages/pt)) | CC-BY-4.0 no card do HF; há conflito com a licença NVIDIA ([build.nvidia.com](https://build.nvidia.com/nvidia/parakeet-tdt-0_6b/modelcard)) | NeMo; ONNX/sherpa-onnx só por blog, sem confirmação; **não há caminho CT2 confirmado** |
| Canary 1B v2 (cerca de 978M) | 4,50% Q8_0, agregador ([Handy](https://models.handy.computer/languages/pt)); o card não separa PT | 7,15 ([card](https://huggingface.co/nvidia/canary-1b-v2)) | Sim, mas exige o NeMo main até a 2.5 | não publicada | RTFx 749; 14,1x em GPU e 8,3x em CPU no agregador | CC-BY-4.0 | NeMo |
| Qwen3-ASR-1.7B + ForcedAligner | 4,37% Q8_0, agregador; o card mostra só a média de 12 idiomas (4,90) ([card](https://huggingface.co/Qwen/Qwen3-ASR-1.7B)) | não confirmado (5,40 vem de um blog, confiança baixa) ([Pinggy](https://pinggy.io/blog/best_open_source_self_hosted_speech_to_text_models/)) | Só com o aligner 0.6B, até 5 min de fala | cerca de 4 GB só de pesos BF16 (inferência) | 4,1x em GPU e 2,5x em CPU no agregador | Apache 2.0 | Transformers, vLLM |
| Voxtral Mini 4B Realtime 2602 | 5,03% a 480 ms ([card](https://huggingface.co/mistralai/Voxtral-Mini-4B-Realtime-2602)) | não consta | não mencionado | 16 GB ou mais, segundo o card | não consta | Apache 2.0 | vLLM, Transformers 5.2+ |
| Granite Speech 4.1 2B | 9,80% (nar: 5,57%), agregador | 5,33 ([card](https://huggingface.co/ibm-granite/granite-speech-4.1-2b)) | Não, só na variante plus | não consta | RTFx 231,29 | Apache 2.0 | Transformers, vLLM, llama.cpp |
| Cohere Transcribe 03-2026 | 5,18% Q8_0, agregador | 5,42 ([card](https://huggingface.co/CohereLabs/cohere-transcribe-03-2026)) | Não | não consta | RTFx 524,88 | Apache 2.0 com gate | Transformers 5.4+, vLLM, transcribe.cpp |
| Distil-large-v3 / Kyutai STT 2.6B | só EN | short-form 9,7 / 6,4 ([distil](https://huggingface.co/distil-whisper/distil-large-v3), [kyutai](https://huggingface.co/kyutai/stt-2.6b-en)) | Distil: só segmento. Kyutai: por offset | não consta | Kyutai RTFx 88,37 | MIT / CC-BY 4.0 | descartados para PT |
| Meta Omnilingual ASR | publica CER, não WER; PT não confirmado | não consta | não citado | CTC 300M cerca de 2 GiB, 1B cerca de 3 GiB ([repo](https://github.com/facebookresearch/omnilingual-asr)) | não consta | Apache 2.0 | próprio |

Conclusão da seção:

- **Whisper large-v3-turbo via faster-whisper** é o padrão da v1. Tem runtime maduro em CT2, licença MIT, cabe em 4 GB e tem PT na mesma faixa dos concorrentes.
- **Parakeet TDT 0.6B v3** é o desafiante principal. Tem timestamp nativo e é uma ordem de grandeza mais rápido em CPU no agregador: 6 h de áudio levariam cerca de 26 min, contra cerca de 4,3 h com o turbo. A conta é inferência a partir de [Handy](https://models.handy.computer/languages/pt), num Ryzen 4750U. Faltam três confirmações: o runtime fora do NeMo, a qualidade em PT-BR e a licença.
- Para a v1 ficam descartados: Voxtral (16 GB ou mais), Qwen3-ASR (pesos de cerca de 4 GB mais um aligner limitado a 5 min), Granite e Cohere (sem timestamp por palavra), Distil e Kyutai (só EN).
- **Nenhuma fonte mede a troca PT/EN no mesmo áudio nem áudio de jogo** ([card do turbo](https://huggingface.co/openai/whisper-large-v3-turbo)). Isso precisa do benchmark interno.

## 2. Como rodar mais rápido

Os números da tabela do README do faster-whisper são de 13 min de áudio, beam 5, numa RTX 3070 Ti 8 GB ([faster-whisper](https://github.com/SYSTRAN/faster-whisper)). Dois pesquisadores identificaram o modelo como large-v2. O pesquisador de detecção não conseguiu confirmar qual modelo é cada linha.

As técnicas estão ordenadas de maior ganho com menor custo até menor ganho com maior custo.

| # | Técnica | Ganho medido | Custo / risco | Decisão v1 |
|---|---|---|---|---|
| 1 | **Turbo em vez de large-v3** | 52,0 s → 19,2 s (cerca de 2,7x), VRAM 4521 → 2537 MB ([HF #3](https://huggingface.co/deepdml/faster-whisper-large-v3-turbo-ct2/discussions/3)) | O decoder cai de 32 para 4 camadas e há uma pequena perda de qualidade ([card](https://huggingface.co/openai/whisper-large-v3-turbo)) | Sim |
| 2 | **faster-whisper em vez de openai/whisper** | large-v2: 2m23s → 1m03s (cerca de 2,3x) ([README](https://github.com/SYSTRAN/faster-whisper)); turbo: 39 s → 19,2 s (cerca de 2x) ([HF #3](https://huggingface.co/deepdml/faster-whisper-large-v3-turbo-ct2/discussions/3)) | Exige cuBLAS 12 e cuDNN 9 no Windows | Sim |
| 3 | **VAD Silero** (corta silêncio e música) | Não há número de ganho total. A 1.1.0 deixou o VAD cerca de 3x mais rápido em CPU ([releases](https://github.com/SYSTRAN/faster-whisper/releases)) | Por padrão só remove silêncio maior que 2 s ([vad.py](https://github.com/SYSTRAN/faster-whisper/blob/master/faster_whisper/vad.py)) | Sim, sempre ligado |
| 4 | **BatchedInferencePipeline** | FP16: 1m03s → 17s (cerca de 3,7x). INT8: 59s → 16s ([README](https://github.com/SYSTRAN/faster-whisper)) | +1565 MB (FP16 4525 → 6090) e +1574 MB (INT8 2926 → 4500). Força `condition_on_previous_text=False` ([transcribe.py](https://github.com/SYSTRAN/faster-whisper/blob/master/faster_whisper/transcribe.py)). Há relatos antigos de falas perdidas com batch ([PR #856](https://github.com/SYSTRAN/faster-whisper/pull/856)), sem estado atual confirmado | Sim, com batch descoberto pela sonda (seção 3) |
| 5 | **INT8 em CPU** | small: fp32 2m37s → int8 1m42s (cerca de 1,5x). Com batch 8, 51 s (cerca de 3x sobre fp32) ([README](https://github.com/SYSTRAN/faster-whisper)) | O batch sobe a RAM de 1477 para 3608 MB | Sim, no caminho CPU |
| 6 | **INT8 em GPU** | Tempo praticamente igual: turbo 19,2 s em FP16 contra 19,6 s em INT8. Economia de VRAM: 2537 → 1545 MB ([HF #3](https://huggingface.co/deepdml/faster-whisper-large-v3-turbo-ct2/discussions/3)) | `int8_float16` aparece nos exemplos, mas ninguém mediu ([README](https://github.com/SYSTRAN/faster-whisper)). Exige CC 7.0 ou mais; `int8_bfloat16` exige CC 8.0 ou mais. A RTX 3050 tem CC 8.6 ([CT2 quantization](https://opennmt.net/CTranslate2/quantization.html)) | Usar para caber na VRAM, não para ganhar velocidade |
| 7 | **whisper.cpp + flash attention** | Encoder do turbo: −40% num V100 com CUDA (128,39 → 76,46) e −15% num M2 Ultra com Metal (201,52 → 170,22). Unidade não declarada; benchmark espelhado e não oficial ([bench](https://huggingface.co/spaces/Xenobd/whisper.cpp/blob/main/scripts/bench-all-gg.txt)) | Não há benchmark de Vulkan em NVIDIA nem de RTX 3050 ([guia Vulkan](https://github.com/DomoticX/whisper.cpp-windows-vulkan)) | Plano B e caminho não-NVIDIA (v1.x) |
| 8 | **Quantização q5_0/q8_0 (whisper.cpp)** | Decoder cerca de 15 a 20% mais rápido (1,42 → 1,17); o encoder quase não muda ([bench](https://huggingface.co/spaces/Xenobd/whisper.cpp/blob/main/scripts/bench-all-gg.txt)) | Efeito na qualidade em PT não foi medido | Junto com o item 7 |
| 9 | **Trocar de modelo em CPU (Parakeet v3)** | 13,7x contra 1,4x do turbo em CPU, agregador ([Handy](https://models.handy.computer/languages/pt)) | Runtime fora do NeMo não confirmado | Benchmark interno |
| 10 | Speculative decoding | EN 2,2x, NL 1,9x, +8% de VRAM, com large-v2 ([HF blog](https://huggingface.co/blog/whisper-speculative-decoding)); 2,0x no paper ([arXiv 2311.00430](https://arxiv.org/pdf/2311.00430)) | Só em Transformers. No turbo (4 camadas de decoder), o ganho deve ser menor (inferência) | Adiar |
| 11 | insanely-fast-whisper | 150 min em cerca de 1m38s contra 9m23s do faster-whisper, numa **A100 80 GB** ([repo](https://github.com/Vaibhavs10/insanely-fast-whisper)) | torch + flash-attn, erro conhecido no Windows, datacenter | Adiar |
| 12 | TensorRT / TensorRT-LLM | 6 a 7x sobre o Whisper da OpenAI, mais 18% com o executor C++. Número de **fornecedor**, confiança baixa ([Baseten](https://www.baseten.co/blog/the-fastest-most-accurate-and-cost-efficient-whisper-transcription/)) | Engine compilado por arquitetura de GPU | Adiar |
| 13 | ONNX Runtime + DirectML | 8 a 12x tempo real em AMD, auto-relatado, confiança baixa ([repo](https://github.com/ChharithOeun/whisper-amd-windows)) | Sem teste controlado | Experimento para AMD/Intel |
| 14 | OpenVINO | +159% de throughput e −85% de TTFT com large-v3 num Xeon ([Lenovo](https://lenovopress.lenovo.com/lp2448.pdf)) | Não há dado do turbo nem de CPU de notebook | Experimento para Intel |

Pontos sem dado:

- O **custo do word timestamps** não foi medido por nenhuma fonte. Existe uma estimativa de 10 a 15% sem origem ([nota](https://huggingface.co/nyralabs/faster_CrisperWhisper)). É requisito do projeto, então entra no benchmark.
- Os RTF de GPUs de consumo publicados pela GigaGPU se contradizem. Para a RTX 4060 aparecem RTF 0,18 numa página e cerca de 46x em outra. A confiança é baixa e a página deu 403 ([GigaGPU](https://gigagpu.com/whisper-large-v3-rtf-by-gpu/)).
- O decoding também afeta a qualidade. Num benchmark de serving, o faster-whisper com beam 5 teve WER de 3 a 5%, e o Transformers em greedy teve 1,44% ([Substack](https://dyl5051.substack.com/p/choosing-a-whisper-serving-framework)). Beam size e decoding entram na matriz de testes. Não há números de velocidade por beam nos achados.

## 3. Detecção de hardware e escolha automática

### O que medir

| Dado | Por quê | Como medir no Windows |
|---|---|---|
| Adaptadores, vendor e VRAM dedicada | Escolher a dGPU em notebook híbrido | DXGI `DXGI_ADAPTER_DESC1`: `VendorId`, `DeviceId`, `DedicatedVideoMemory`, `AdapterLuid` ([MS Learn](https://learn.microsoft.com/en-us/windows/win32/api/dxgi/ns-dxgi-dxgi_adapter_desc1)) |
| VRAM livre / budget | A decisão usa a VRAM livre, não a total | `IDXGIAdapter3::QueryVideoMemoryInfo`, que funciona em qualquer fabricante ([MS Learn](https://learn.microsoft.com/en-us/windows/win32/api/dxgi1_4/nf-dxgi1_4-idxgiadapter3-queryvideomemoryinfo)); em NVIDIA, a memória do NVML traz used, free, reserved e total ([nvitop](https://nvitop.readthedocs.io/en/stable/api/libnvml.html)) |
| **Não usar** | `Win32_VideoController.AdapterRAM` é uint32 e trunca acima de 4 GB ([MS Learn](https://learn.microsoft.com/en-us/windows/win32/cimwin32prov/win32-videocontroller)) | — |
| Compute capability | `int8_float16` exige CC 7.0 ou mais; bf16 exige CC 8.0 ou mais ([CT2](https://opennmt.net/CTranslate2/quantization.html)) | `device_compute_capability` no cuda-python ([docs](https://nvidia.github.io/cuda-python/cuda-bindings/latest/module/nvml.html)); a exposição no pyNVML não foi confirmada |
| Driver | Chave de cache; erros de DLL | NVML / nvidia-smi `--query-gpu` ([NVIDIA](https://docs.nvidia.com/deploy/nvidia-smi/index.html)); `driver_version` está marcado como deprecated |
| Tipos suportados pelo backend | Verdade do runtime | `ctranslate2.get_cuda_device_count()` e `get_supported_compute_types("cuda")` ([CT2](https://opennmt.net/CTranslate2/python/ctranslate2.get_supported_compute_types.html)) |
| CPU (núcleos, RAM, AVX2/AVX512) | Caminho CPU e threads | psutil ([repo](https://github.com/giampaolo/psutil)); py-cpuinfo, mas a presença das flags avx no Windows não foi confirmada ([repo](https://github.com/workhorsy/py-cpuinfo)); sysinfo em Rust ([docs.rs](https://docs.rs/sysinfo/latest/sysinfo/)) |

Observações:

- A resolução de `device="auto"` e `compute_type="default"` no CTranslate2 **não está documentada** ([CT2 Whisper](https://opennmt.net/CTranslate2/python/ctranslate2.models.Whisper.html)). O faster-whisper só repassa esses valores ([transcribe.py](https://raw.githubusercontent.com/SYSTRAN/faster-whisper/master/faster_whisper/transcribe.py)). O app deve escolher esses valores explicitamente, não depender do "auto".
- Há relato de que `get_cuda_device_count` ignora `CUDA_VISIBLE_DEVICES` na versão 4.2.1. Falta confirmar ([CT2](https://opennmt.net/CTranslate2/python/ctranslate2.get_cuda_device_count.html)).

### Como apps reais fazem

| App | Detecção | Escolha de modelo |
|---|---|---|
| Ollama | Usa a VRAM reportada pelas bibliotecas de GPU e tamanhos aproximados quando não há esse dado. Tem fallback para CPU. Seleção por `CUDA_VISIBLE_DEVICES` e `GGML_VK_VISIBLE_DEVICES`, com UUID recomendado. Exige CC 5.0 ou mais e driver 550 ou mais ([docs](https://docs.ollama.com/gpu)) | o usuário escolhe |
| Purfview (whisper-standalone-win) | Escolhe a GPU automaticamente quando detecta CUDA ([repo](https://github.com/Purfview/whisper-standalone-win)) | o usuário escolhe |
| Buzz | Faster Whisper em NVIDIA com **6 GB ou mais**; whisper.cpp nos outros casos ([FAQ](https://chidiwilliams.github.io/buzz/docs/faq)) | manual |
| Jan | Detecta hardware e backend, com opção manual. Em caso de OOM sugere modelo menor ou menos offload ([docs](https://docs.jan.ai/desktop/troubleshooting)). A regra de 6 GB que aparece em snippets **não foi confirmada** | sugestão |
| LM Studio | Parcial. Limita o offload à VRAM dedicada (só CUDA); modos automáticos estão "planejados" ([blog](https://lmstudio.ai/blog/lmstudio-v0.3.14)) | manual |
| Subtitle Edit, Handy, Vibe, whisper.cpp | Não documentam seleção automática ([Handy](https://github.com/cjpais/Handy), [whisper.cpp](https://github.com/ggml-org/whisper.cpp)) | manual |
| Windows ML | Detecta o hardware, baixa EPs (NvTensorRtRtx para RTX 30xx ou mais nova, AMDGPU, OpenVINO, QNN, VitisAI) e faz fallback para GPU ou CPU. Exige Windows 11 24H2 para EPs específicos ([overview](https://learn.microsoft.com/en-us/windows/ai/new-windows-ml/overview), [EPs](https://learn.microsoft.com/en-us/windows/ai/new-windows-ml/supported-execution-providers)). O cache compilado é invalidado quando muda o EP, o driver, o hardware ou o modelo ([compilação](https://learn.microsoft.com/en-us/windows/ai/new-windows-ml/model-compilation)) | — |

A regra "6 GB para faster-whisper" da proposta atual coincide com a política do Buzz. Não encontramos medição por trás dela.

Nenhum app pesquisado faz escolha de modelo totalmente automática com confiança documentada. Por isso o Clipes deve **sugerir** a escolha e permitir que o usuário a troque.

### Algoritmo recomendado

1. **Inventário leve no processo Tauri (Rust), sem carregar ML.**
   - Enumerar adaptadores via DXGI e registrar vendor, `DedicatedVideoMemory`, `AdapterLuid` e budget via `QueryVideoMemoryInfo`.
   - Ler CPU, RAM e núcleos com sysinfo.
   - Em notebook híbrido, escolher a dGPU com mais VRAM dedicada.
   - O comportamento do Optimus com DXGI não foi pesquisado (pergunta em aberto).
2. **Detalhe NVIDIA.** Pelo NVML, ler a VRAM livre, o driver e o UUID. Ler a compute capability pela API do driver CUDA.
3. **Fixar o dispositivo antes de iniciar o sidecar.** Usar `CUDA_VISIBLE_DEVICES=<UUID>`, seguindo o padrão do Ollama ([docs](https://docs.ollama.com/gpu)). O sidecar é declarado em `bundle.externalBin` com o sufixo do target triple ([Tauri](https://tauri.app/develop/sidecar/)).
4. **Sonda do runtime no sidecar.** Chamar `get_cuda_device_count()` e `get_supported_compute_types("cuda")`.
   - Se a contagem for zero ou o carregamento falhar com `cublas64_12.dll` ou `cudnn_ops64_9.dll` ([issue #1276](https://github.com/SYSTRAN/faster-whisper/issues/1276)), marcar CUDA como indisponível e mostrar o motivo.
5. **Montar a lista de candidatos pela faixa de VRAM livre** (tabela da seção 5). Em NVIDIA com CC 7.0 ou mais, a ordem é: `cuda/float16` → `cuda/int8_float16` → `cuda/int8` → `cpu/int8`, seguindo o pesquisador de detecção.
6. **Teste curto de inferência real** para cada candidato, parando no primeiro que passar.
   - Usar um clipe embutido de poucos segundos, com fala PT e EN, e `word_timestamps=True`.
   - Medir o tempo (RTF), o pico de VRAM via NVML e se a saída tem texto e palavras com tempo.
   - Se der OOM, erro de DLL ou saída vazia, ir para o próximo candidato.
7. **Descobrir o batch seguro.** Com o candidato aprovado, testar `batch_size` 1, 2, 4 e 8 até o pico de VRAM chegar perto do budget. A margem de segurança ainda não tem número público e precisa ser definida no benchmark local.
8. **Cache do resultado.** A chave é (GPU, driver, versão do CTranslate2, modelo, versão do app). O cache é invalidado quando qualquer item muda, como no Windows ML.
9. **Mostrar e permitir override.** A tela mostra "Motor, modelo, backend, precisão e batch escolhidos" e permite troca manual.
10. **Guarda em runtime.** Se houver OOM durante um job longo, reduzir o batch ou descer um nível na cadeia e retomar do último bloco com checkpoint (seção 4).

Também é preciso empacotar as DLLs de CUDA e cuDNN ou ter um instalador guiado. O pacote do Purfview é a referência citada pelo README ([faster-whisper](https://github.com/SYSTRAN/faster-whisper)).

## 4. Problemas do mundo real (streams e VODs de jogos)

| Problema | Evidência | Mitigação |
|---|---|---|
| **Alucinação em música e silêncio** | Defaults do `transcribe()`: `vad_filter=False`, `condition_on_previous_text=True`, `no_speech_threshold=0.6`, `compression_ratio_threshold=2.4` ([transcribe.py](https://github.com/SYSTRAN/faster-whisper/blob/master/faster_whisper/transcribe.py)). Há relatos de o turbo parar após cerca de 10 s de silêncio. O `hallucination_silence_threshold` ajudou um usuário e não ajudou outro (2 a 8) ([discussão #2363](https://github.com/openai/whisper/discussions/2363)) | VAD sempre ligado. `hallucination_silence_threshold` é uma hipótese a validar e só funciona com `word_timestamps=True` |
| **Loops de repetição em long-form** | O paper só usa o contexto anterior com temperatura abaixo de 0,5. O fallback sobe a temperatura em passos de 0,2 até 1,0. Erros de timestamp se propagam entre janelas ([arXiv 2212.04356](https://arxiv.org/html/2212.04356v1)) | Testar `condition_on_previous_text=False`, que o batched já força, e manter o fallback padrão |
| **v3/turbo alucina mais que v2?** | Evidência anedótica. A Deepgram fala em cerca de 4x, sem metodologia verificável. Confiança baixa ([discussão #1762](https://github.com/openai/whisper/discussions/1762)) | Medir no benchmark interno |
| **Demucs antes do ASR** | Piora o Whisper. WER v3 vai de 35,5 para 48,0 e o v2 de 37,8 para 44,5 ([Jam-ALT](https://arxiv.org/html/2408.06370v1)). Usado só para **definir segmentos** (RMS-VAD), o WER long-form cai de 23,02 para 20,35 e o proxy de alucinação de 1,31 para 0,35. Isso só foi testado com large-v2 e tem custo alto ([arXiv 2506.15514](https://arxiv.org/html/2506.15514v1)) | Não usar o Demucs por padrão. Se usar, só para segmentação, depois de medir o custo na RTX 3050. Não há benchmark em 4 GB; o único dado é de fornecedor, cerca de 12x em RTX 3080, não verificado ([stemsplit](https://stemsplit.io/blog/demucs-local-setup-guide)) |
| **Troca PT/EN** | O `detect_language_multi_segment` reavalia o idioma a cada cerca de 30 s e erra dentro da janela, como o próprio PR documenta ([PR #856](https://github.com/SYSTRAN/faster-whisper/pull/856)). Há relatos de tradução indevida para EN, confiança baixa ([HF #71](https://huggingface.co/openai/whisper-large-v3/discussions/71)) | Detectar o idioma por segmento de VAD e fixar o idioma em cada segmento. Alternativa a validar (inferência): transcrever nos dois idiomas e escolher pela log-prob média. Testar `multilingual=True` |
| **Precisão do timestamp por palavra** | F1@50ms no TIMIT: método nativo (wordpieces) 41,2, WhisperX CTC 79,9, MFA 91,0. Testado em inglês com Whisper medium ([arXiv 2509.09987](https://arxiv.org/html/2509.09987v1)). O faster-whisper usa a mesma família de método (atenção cruzada + DTW); que o resultado vale para ele é inferência. Os timestamps do CT2 podem diferir dos do Transformers ([CrisperWhisper](https://huggingface.co/nyralabs/faster_CrisperWhisper)) | Avaliar o alinhamento forçado CTC como segunda etapa. Em PT, o WhisperX usa `jonatasgrosman/wav2vec2-large-xlsr-53-portuguese`, porque o padrão só cobre en, fr, de, es e it ([alignment.py](https://github.com/m-bain/whisperX/blob/main/whisperx/alignment.py)). Isso traz PyTorch ao sidecar, um custo de empacotamento (inferência). Validar com F1@50ms numa amostra rotulada |
| **Vídeos de 1 a 6 h** | OOM com VAD em áudio de cerca de 4 h, corrigido pelo PR #1198 em dez/2024 ([issue #1193](https://github.com/SYSTRAN/faster-whisper/issues/1193)). Um relato de perda de trechos em 11 h foi resolvido com blocos de 20 min ([discussão #2363](https://github.com/openai/whisper/discussions/2363)) | Blocos por cortes de VAD (ou cerca de 20 min), checkpoint por bloco, retomada pelo índice e liberação de cache entre blocos. É um desenho inferido, não um padrão verificado |
| **whisper.cpp + VAD com intro musical** | Os timestamps de token vão para 0 ms em vez de cerca de 6980 ms. A issue foi fechada como not planned ([issue #3754](https://github.com/ggml-org/whisper.cpp/issues/3754)). O mapeamento #3910 entrou na 1.9.2 | Validar antes de depender dos timestamps de token no plano B |
| **Áudio multitrack** | O OBS grava até 6 faixas (MKV, modo Advanced) ([OBS](https://obsproject.com/kb/advanced-recording-guide-and-multi-track-audio)) | Se existir uma faixa de microfone, transcrever só ela e usar a faixa do jogo para detectar música e efeitos (inferência, a testar) |

**Benchmark interno obrigatório:** 3 a 5 VODs de jogos com música, efeitos, silêncio longo e troca PT/EN dentro de uma mesma janela de 30 s, rotulados à mão. As métricas são WER, taxa de alucinação, F1@50ms do timestamp, RTF e pico de VRAM. FLEURS pt_br e MLS servem de controle.

## 5. Recomendação revisada por faixa de hardware

A "VRAM" desta tabela é a **VRAM livre medida**, não a total. Todos os valores de batch e precisão são pontos de partida para a sonda da seção 3.

| Faixa | Motor | Modelo | Backend | Configuração inicial | Fallback |
|---|---|---|---|---|---|
| NVIDIA, 8 GB ou mais, CC 7.0 ou mais | faster-whisper | large-v3-turbo | CUDA | `float16`, batched, batch 8 como teto da sonda (large-v2 com batch 8 FP16 mediu 6090 MB; o turbo deve gastar menos, por inferência) | `int8_float16` → batch menor → CPU |
| NVIDIA, 6 a 8 GB | faster-whisper | large-v3-turbo | CUDA | `float16`, batch 4 a 8 pela sonda | `int8_float16` → `int8` → CPU |
| **NVIDIA RTX 3050 Laptop 4 GB** (referência) | faster-whisper | large-v3-turbo | CUDA | **testar primeiro `float16`** com batch 1 (cerca de 2,0 a 2,7 GB em [Runpod](https://www.runpod.io/articles/guides/best-gpu-for-whisper) e [HF #3](https://huggingface.co/deepdml/faster-whisper-large-v3-turbo-ct2/discussions/3)); depois subir o batch (2, 4) só se couber no budget | `int8_float16` (CC 8.6 suporta) → `int8` (cerca de 1,1 a 1,8 GB) → CPU small INT8 |
| NVIDIA, menos de 3 GB livres ou CC abaixo de 7.0 | faster-whisper | large-v3-turbo | CUDA | `int8` (sem CC 7.0 cai para `int8_float32` ([CT2](https://opennmt.net/CTranslate2/quantization.html))), batch 1 | small INT8 em GPU → CPU |
| AMD / Intel no Windows | v1: faster-whisper CPU; v1.x: whisper.cpp | v1: small; v1.x: turbo (q5_0/q8_0) | v1: CPU; v1.x: Vulkan | ver a linha "só CPU" | DirectML / OpenVINO como experimento ([AMD](https://github.com/ChharithOeun/whisper-amd-windows), [Lenovo](https://lenovopress.lenovo.com/lp2448.pdf)) |
| macOS (Apple Silicon) | whisper.cpp (depois da v1) | large-v3-turbo | Metal + flash attention (−15% no encoder num M2 Ultra) | — | CPU |
| Só CPU | faster-whisper | small | CPU | `int8`, batched com batch 8 (cerca de 15x tempo real num i7-12700K desktop; 6 h levariam uns 24 min por inferência, mais em notebook) | small `int8` sem batch (menos RAM: 1477 MB contra 3608 MB). **Candidato a medir:** Parakeet v3 em ONNX int8 (13,7x em CPU no agregador) |

**O que muda em relação à proposta atual:**

1. **Fim do corte "FP16 só com 6 GB ou mais".** Com o turbo no CTranslate2, o FP16 parece caber em 4 GB. A sonda decide.
   - Divergência: o pesquisador de detecção manteve a RTX 3050 na faixa INT8 da proposta, por cautela com a VRAM livre.
   - Síntese: testar o FP16 primeiro e cair para INT8 pela sonda. As duas posições acabam no mesmo lugar quando a VRAM livre for baixa.
2. **O INT8 em GPU passa a ser recurso de memória, não de velocidade.** O ganho de tempo medido foi praticamente zero ([HF #3](https://huggingface.co/deepdml/faster-whisper-large-v3-turbo-ct2/discussions/3)). `int8_float16` vira o degrau intermediário.
3. **O batched pipeline entra na v1**, com batch descoberto pela sonda e não fixo.
4. **A escolha passa a ser por VRAM livre medida** (DXGI/NVML) mais um teste curto de inferência, com cache e override manual. Antes era uma faixa estática de VRAM total.
5. **O timestamp por palavra ganha uma etapa de validação.** O alinhamento CTC em PT é candidato a segunda etapa. O nativo do faster-whisper não é assumido como suficiente.
6. **O pipeline ganha regras de mundo real:** VAD sempre, sem Demucs na entrada, idioma por segmento de VAD e blocos com checkpoint.
7. **O caminho CPU ganha um desafiante (Parakeet v3)** no benchmark interno.

**O que se mantém:**

- faster-whisper + large-v3-turbo como motor e modelo principais.
- Silero VAD.
- CUDA + CPU na v1.
- small INT8 em CPU como padrão.
- whisper.cpp (Vulkan/Metal) depois da v1, agora também como plano B em NVIDIA.

## Perguntas em aberto

1. Qual é o RTF real e o pico de VRAM do turbo na RTX 3050 4 GB em `float16`, `int8_float16`, `int8_bfloat16` e `int8`, com batch de 1 a 8? Não há fonte independente.
2. Qual é o overhead de `word_timestamps=True` no faster-whisper e no whisper.cpp? Nenhuma medição pública.
3. Qual é a precisão do timestamp por palavra (F1@50ms) em PT-BR com música de fundo, no método nativo e no CTC (wav2vec2 PT)?
4. Qual é a qualidade de INT8 e `int8_float16` contra FP16 em PT-BR e EN com áudio de jogo? As fontes são todas em inglês, LibriSpeech.
5. O Parakeet TDT 0.6B v3 tem runtime viável fora do NeMo (ONNX/sherpa-onnx) com timestamp por palavra? Qual é a licença definitiva (CC-BY-4.0 ou licença NVIDIA)? O treino em PT europeu prejudica o PT-BR?
6. Como `multilingual=True` e a detecção por segmento de VAD lidam com troca PT/EN dentro de 30 s?
7. Qual é a taxa de alucinação do turbo em VODs PT/EN de jogos? O batching ainda perde falas em 2026?
8. Como o CTranslate2 resolve `device="auto"` e `compute_type="default"`, e o que acontece sem GPU?
9. Como o DXGI e o CUDA enxergam a dGPU em notebook Optimus, e como forçar a dGPU?
10. O pyNVML/nvidia-ml-py atual expõe a compute capability, ou é preciso usar a API do driver CUDA?
11. O py-cpuinfo ou o sysinfo detectam AVX2, AVX512 e AVX-VNNI no Windows?
12. O whisper.cpp com CUDA ou Vulkan é competitivo com o faster-whisper na mesma GPU NVIDIA?
13. O htdemucs cabe em 4 GB para áudio de várias horas, e a que custo de tempo?
14. Qual é a tabela atual do Open ASR Leaderboard? Qual é o WER oficial (não agregador) do turbo em FLEURS pt_br?
15. Qual é a margem de segurança de VRAM para o budget na sonda de batch? Nenhuma fonte traz esse número.

## Fontes

- https://github.com/SYSTRAN/faster-whisper
- https://github.com/SYSTRAN/faster-whisper/releases
- https://github.com/SYSTRAN/faster-whisper/blob/master/faster_whisper/transcribe.py
- https://raw.githubusercontent.com/SYSTRAN/faster-whisper/master/faster_whisper/transcribe.py
- https://github.com/SYSTRAN/faster-whisper/blob/master/faster_whisper/vad.py
- https://github.com/SYSTRAN/faster-whisper/pull/856
- https://github.com/SYSTRAN/faster-whisper/issues/1193
- https://github.com/SYSTRAN/faster-whisper/issues/1276
- https://opennmt.net/CTranslate2/quantization.html
- https://opennmt.net/CTranslate2/python/ctranslate2.get_supported_compute_types.html
- https://opennmt.net/CTranslate2/python/ctranslate2.get_cuda_device_count.html
- https://opennmt.net/CTranslate2/python/ctranslate2.models.Whisper.html
- https://huggingface.co/openai/whisper-large-v3-turbo
- https://huggingface.co/openai/whisper-large-v3/discussions/71
- https://huggingface.co/deepdml/faster-whisper-large-v3-turbo-ct2/discussions/3
- https://github.com/openai/whisper
- https://github.com/openai/whisper/discussions/2363
- https://github.com/openai/whisper/discussions/1762
- https://arxiv.org/html/2212.04356v1
- https://www.runpod.io/articles/guides/best-gpu-for-whisper
- https://github.com/ggml-org/whisper.cpp
- https://github.com/ggml-org/whisper.cpp/issues/3754
- https://huggingface.co/spaces/Xenobd/whisper.cpp/blob/main/scripts/bench-all-gg.txt
- https://github.com/DomoticX/whisper.cpp-windows-vulkan
- https://github.com/Vaibhavs10/insanely-fast-whisper
- https://huggingface.co/blog/whisper-speculative-decoding
- https://arxiv.org/pdf/2311.00430
- https://gigagpu.com/whisper-large-v3-rtf-by-gpu/
- https://www.baseten.co/blog/the-fastest-most-accurate-and-cost-efficient-whisper-transcription/
- https://github.com/ChharithOeun/whisper-amd-windows
- https://lenovopress.lenovo.com/lp2448.pdf
- https://huggingface.co/nyralabs/faster_CrisperWhisper
- https://dyl5051.substack.com/p/choosing-a-whisper-serving-framework
- https://nvidia.github.io/cuda-python/cuda-bindings/latest/module/nvml.html
- https://docs.nvidia.com/deploy/nvidia-smi/index.html
- https://nvitop.readthedocs.io/en/stable/api/libnvml.html
- https://learn.microsoft.com/en-us/windows/win32/api/dxgi/ns-dxgi-dxgi_adapter_desc1
- https://learn.microsoft.com/en-us/windows/win32/api/dxgi1_4/nf-dxgi1_4-idxgiadapter3-queryvideomemoryinfo
- https://learn.microsoft.com/en-us/windows/win32/cimwin32prov/win32-videocontroller
- https://docs.ollama.com/gpu
- https://docs.jan.ai/desktop/troubleshooting
- https://www.jan.ai/changelog/2026-06-01-jan-v0.8.2
- https://lmstudio.ai/blog/lmstudio-v0.3.14
- https://github.com/Purfview/whisper-standalone-win
- https://chidiwilliams.github.io/buzz/docs/faq
- https://github.com/cjpais/Handy
- https://github.com/ggml-org/llama.cpp
- https://learn.microsoft.com/en-us/windows/ai/new-windows-ml/overview
- https://learn.microsoft.com/en-us/windows/ai/new-windows-ml/supported-execution-providers
- https://learn.microsoft.com/en-us/windows/ai/new-windows-ml/model-compilation
- https://learn.microsoft.com/windows/ai/npu-devices
- https://github.com/giampaolo/psutil
- https://github.com/workhorsy/py-cpuinfo
- https://docs.rs/sysinfo/latest/sysinfo/
- https://tauri.app/develop/sidecar/
- https://huggingface.co/nvidia/parakeet-tdt-0.6b-v3
- https://huggingface.co/nvidia/parakeet-tdt-0.6b-v2
- https://build.nvidia.com/nvidia/parakeet-tdt-0_6b/modelcard
- https://huggingface.co/nvidia/canary-1b-v2
- https://models.handy.computer/languages/pt
- https://huggingface.co/distil-whisper/distil-large-v3
- https://huggingface.co/mistralai/Voxtral-Mini-4B-Realtime-2602
- https://huggingface.co/Qwen/Qwen3-ASR-1.7B
- https://pinggy.io/blog/best_open_source_self_hosted_speech_to_text_models/
- https://huggingface.co/ibm-granite/granite-speech-4.1-2b
- https://huggingface.co/CohereLabs/cohere-transcribe-03-2026
- https://huggingface.co/kyutai/stt-2.6b-en
- https://github.com/facebookresearch/omnilingual-asr
- https://huggingface.co/spaces/hf-audio/open_asr_leaderboard
- https://arxiv.org/html/2408.06370v1
- https://arxiv.org/html/2506.15514v1
- https://arxiv.org/html/2509.09987v1
- https://github.com/m-bain/whisperX
- https://github.com/m-bain/whisperX/blob/main/whisperx/alignment.py
- https://stemsplit.io/blog/demucs-local-setup-guide
- https://obsproject.com/kb/advanced-recording-guide-and-multi-track-audio
- https://pypi.org/project/silero-vad/
