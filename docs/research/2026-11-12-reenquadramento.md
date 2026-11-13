# Reenquadramento 9:16: detecção, câmera virtual e correção

Data: 12/11/2026 · Pesquisa documental do [ticket #20](https://github.com/GUSTAVOHOOO/clipes/issues/20). Base: `origin/master`, glossário e [ADR-0002](../adr/0002-hyperframes-como-referencia-render-ffmpeg-libass.md). Nenhum modelo foi baixado ou executado. Valores de desempenho são os publicados ou hipóteses explicitamente identificadas; não medimos a RTX 3050.

## Resumo executivo

**Recomendação (inferência):** analisar apenas os Cortes selecionados, por cena, com YuNet e associação espacial, no auxiliar Python. Usar ONNX Runtime CUDA quando disponível e validado; CPU com o mesmo modelo como fallback. Escolher entre enquadramento de rosto, jogo + webcam, duas pessoas e tela inteira/área de interesse, sempre editáveis. Para dois participantes, priorizar divisão fixa ou seleção manual; não prometer identificação automática de falante na v1. O resultado é uma timeline versionada de regiões e keyframes, consumida pelo editor e pelo FFmpeg + libass.

YuNet é o candidato mais claro: o [OpenCV Zoo licencia todos os arquivos do diretório sob MIT](https://github.com/opencv/opencv_zoo/blob/main/models/face_detection_yunet/README.md), incluindo os modelos ali; não é necessário supor que a licença de um projeto cobre qualquer peso de terceiros. AutoFlip oferece bons princípios, mas é uma solução legada sem suporte desde 2023 ([Google](https://google-ai-edge.github.io/mediapipe/solutions/autoflip.html)).

**Critério de licença:** código e peso são avaliados separadamente; “não confirmada” impede distribuição até identificar o arquivo exato, termos, origem e dependências. Uso comercial e compatibilidade com Apache-2.0 são exigências do ticket, não equivalentes a disponibilidade pública. Registrar versão, hash, origem, licença e avisos por artefato, conforme [ADR-0003](../adr/0003-licenca-apache-ffmpeg-sob-demanda-e-politica-de-modelos.md).

## Tabela de detectores

N/D significa que não foi localizado benchmark primário comparável; não significa que a opção é lenta. Nenhum número a seguir mede uma RTX 3050 ou o pipeline completo. Runtime indica integração possível, não que o modelo foi validado no Clipes.

| Candidato e maturidade | Código | Pesos | Runtime | CPU / GPU: desempenho reportado |
|---|---|---|---|---|
| **YuNet**, rosto, maduro no Zoo | [MIT no diretório](https://github.com/opencv/opencv_zoo/blob/main/models/face_detection_yunet/README.md); OpenCV Apache-2.0 | MIT para os arquivos desse diretório; variante e hash a fixar | OpenCV DNN ou ONNX Runtime | OpenCV Zoo: 6,23 ms em Raspberry Pi 4 CPU, entrada 160×120; 5,62 ms CPU no Jetson Nano. Esses tempos incluem pré e pós-processamento; entrada minúscula não representa webcam distante. [Benchmark](https://github.com/opencv/opencv_zoo/blob/main/benchmark/README.md). GPU: N/D comparável para 3050. |
| **MediaPipe Face Detector / BlazeFace**, rosto, maduro para dispositivos | [MediaPipe Apache-2.0](https://github.com/google-ai-edge/mediapipe/blob/master/LICENSE) | verificar licença do arquivo específico e seu model card antes de distribuir; não inferir do SDK | MediaPipe/LiteRT CPU ou GPU conforme plataforma | CPU e 3050 N/D; autores descrevem inferência abaixo de 1 ms em GPU móvel em condições do paper, não no desktop ([paper](https://arxiv.org/abs/1907.05047), [model card](https://storage.googleapis.com/mediapipe-assets/MediaPipe%20BlazeFace%20Model%20Card%20%28Short%20Range%29.pdf)). |
| **SCRFD / RetinaFace InsightFace**, rosto, maduro em pesquisa | [InsightFace MIT](https://github.com/deepinsight/insightface) | pacotes oficiais, inclusive SCRFD: apenas pesquisa não comercial; **excluir** sem licença de pesos distinta ([model zoo](https://github.com/deepinsight/insightface/blob/master/python-package/docs/model_zoo.md)) | ONNX Runtime / PyTorch | CPU e 3050 N/D; licença bloqueia adoção mesmo que rápido. |
| **YOLOX**, pessoa, maduro | [Apache-2.0](https://github.com/Megvii-BaseDetection/YOLOX) | arquivos do [diretório YOLOX do Zoo](https://github.com/opencv/opencv_zoo/blob/main/models/object_detection_yolox/README.md) Apache-2.0; outros checkpoints exigem verificação | PyTorch, ONNX Runtime, OpenCV DNN, TensorRT | Zoo reporta 72,25 ms GPU CUDA FP16 para modelo 640×640 no Jetson Orin Nano, na configuração do benchmark; CPU e 3050 N/D ([benchmark](https://github.com/opencv/opencv_zoo/blob/main/benchmark/README.md)). |
| **NanoDet**, pessoa, maduro/edge | [Apache-2.0](https://github.com/RangiLyu/nanodet) | arquivos do [diretório NanoDet do Zoo](https://github.com/opencv/opencv_zoo/blob/main/models/object_detection_nanodet/README.md) Apache-2.0; verificar outros checkpoints | ONNX Runtime/OpenCV DNN | Zoo reporta 19,94 ms GPU CUDA FP16 para 416×416 no Jetson Orin Nano; CPU e 3050 N/D ([benchmark](https://github.com/opencv/opencv_zoo/blob/main/benchmark/README.md)). |
| **RT-DETR**, pessoa, pesquisa com implementação pública | [Apache-2.0](https://github.com/lyuwenyu/RT-DETR) | confirmar licença do checkpoint específico | Paddle/PyTorch; exportação ONNX possível | autores publicam TensorRT FP16 em T4, não 3050; CPU/3050 N/D ([tabela](https://github.com/lyuwenyu/RT-DETR)). Mais pesado para a v1 é hipótese, não medição. |
| **MediaPipe Pose**, corpo, SDK maduro | [Apache-2.0](https://github.com/google-ai-edge/mediapipe/blob/master/LICENSE) | verificar licença de cada bundle e pesos | MediaPipe/LiteRT | Zoo reporta 26,79 ms GPU CUDA FP16 para pose 256×256 no Jetson Orin Nano, além da detecção de pessoa; CPU/3050 N/D ([benchmark](https://github.com/opencv/opencv_zoo/blob/main/benchmark/README.md)). |
| **TalkNet**, falante audiovisual, referência de pesquisa | [MIT](https://github.com/TaoRuijie/TalkNet-ASD/blob/main/LICENSE.md) | checkpoint baixado externamente: licença comercial/redistribuição **não comprovada** | PyTorch | CPU e 3050 N/D; autores reportam mAP 92,3 na validação AVA, não velocidade ([repo](https://github.com/TaoRuijie/TalkNet-ASD)). |
| **Light-ASD**, falante audiovisual, pesquisa | [MIT no repo original](https://github.com/Junhua-Liao/Light-ASD); fixar commit | não confirmada | PyTorch | CPU e 3050 N/D; paper descreve modelo leve ([paper](https://arxiv.org/abs/2303.04439)). |
| **LoCoNet**, falante audiovisual, pesquisa | não confirmada para implementação escolhida | não confirmada | PyTorch em implementação de pesquisa | CPU e 3050 N/D; validar código, checkpoint e dependências antes de uso ([paper](https://arxiv.org/abs/2301.08237)). |
| **Boca + energia**, heurística experimental | implementação própria; licença do extrator de marcos escolhidos também precisa ser auditada | não se aplica à heurística; depende do modelo de marcos | CPU ou runtime do modelo de marcos | CPU e GPU N/D. Exige marcos temporais densos e energia de voz, não apenas caixas do YuNet; áudio de jogo, dublagem e silêncio com boca em movimento geram falsos positivos. |

A [Ultralytics oferece AGPL-3.0 ou licença empresarial](https://www.ultralytics.com/license): não incluir sua implementação/pesos sob AGPL como dependência padrão Apache-2.0 do projeto. Verificar os termos específicos do artefato; nomes de arquiteturas não determinam a licença de todas as implementações. Falante ativo não equivale à diarização de áudio: esta identifica mudanças de voz, mas não associa sozinha uma voz a uma face.

## Rastreamento e suavização

**Fatos:** [ByteTrack](https://github.com/FoundationVision/ByteTrack) (MIT) associa inclusive detecções de baixa confiança; o [paper](https://arxiv.org/abs/2110.06864) reporta 30 fps em V100 no benchmark MOT17 com seu pipeline, não na 3050. [SORT](https://github.com/abewley/sort) combina Kalman e associação, mas sua implementação indica GPL-3.0: não copiar para o núcleo Apache. [OC-SORT](https://github.com/noahcao/OC_SORT) é alternativa a auditar por arquivo e dependência. AutoFlip usa detecção de cena e regiões salientes para planejar câmera; sua [documentação legada](https://google-ai-edge.github.io/mediapipe/solutions/autoflip.html) declara suporte encerrado em 1º/03/2023, embora MediaPipe como projeto continue existindo.

**Proposta:** começar por associação entre amostras via IoU + distância normalizada, com identificadores efêmeros por cena e tolerância curta a perda de detecção. Em cruzamentos ou muitos rostos, comparar ByteTrack, mas não presumir que IDs resistem a cortes ou oclusões. A amostragem por si só não rastreia identidades. Predição Kalman compensa lacunas; filtro [One Euro](https://gery.casiez.net/1euro/) responde mais rapidamente a movimento deliberado enquanto amortece tremor; média móvel é simples, porém atrasa. Avaliar offline e suavizar só dentro da cena.

Câmera: manter o alvo numa zona morta central; só mover quando sai dela, limitar velocidade e aceleração, manter margem ao rosto e limitar zoom. Segurar temporariamente na perda, depois centralizar ou pedir revisão. Mudança de cena implica reset e corte seco, sem interpolar sobre ela; mudança confiável de falante pode produzir corte seco após tempo mínimo e histerese, nunca alternância por ruído. Em baixa confiança manter composição estável e assinalar revisão. Estes limiares são hipóteses de UX, a calibrar em material real.

## Layouts de live

**Fontes de produto:** [Opus Clip](https://help.opus.pro/docs/article/layout-and-reframing) descreve Fill, Fit, Split, Three, Four, Screenshare e Gameplay; permite [ajustar o crop](https://help.opus.pro/docs/article/can-i-customize-crop-ratio) e rastrear sujeito. No [runtime observado](2026-11-12-opusclip-runtime-evidence.md), há áreas de crop por keyframe e flags de layout; isso não prova o algoritmo interno. [Vizard](https://help.vizard.ai/en/articles/14671161-why-does-the-ai-frame-the-wrong-person-in-multi-person-videos) orienta corrigir cenas e layout; no [ensaio local](2026-11-12-vizard-runtime-evidence.md) havia oito presets, recorte manual por elemento e pessoa em cima/tela embaixo; o canvas não pôde ser testado e um ajuste de proporção não persistiu. São observações, não garantias dos produtos.

**Proposta para Clipes:**

1. **Jogo + webcam:** sugerir webcam no topo e jogo embaixo, cada um com região da Fonte e destino próprio; permitir escolher 30/70 ou redimensionar. Para gerar candidatos: agregar faces persistentes ao longo da cena, examinar bordas retangulares/eixos, contraste, estabilidade da região e movimento interno distinto do entorno. Procurar também nas bordas e cantos da tela. Rosto pode ser personagem do jogo ou overlay animado; bordas podem estar ausentes, arredondadas ou cobertas. Usar pontuação e confirmação visual, com desenho manual do retângulo como caminho principal quando incerto. Não duplicar webcam no jogo quando for possível recortar outra região; não prometer removê-la do fundo.
2. **Podcast com duas pessoas:** sugerir duas janelas empilhadas com alvos independentes; caso o enquadramento original caiba, oferecer Fit. Fixar um alvo ou trocar manualmente por segmento. Áudio isolado/diarização não prova qual face está falando; auto spotlight só com evidência audiovisual validada.
3. **Tela cheia sem rosto:** crop central por padrão, região de interesse manual ou Fit com fundo. Jogos e legendas de origem podem perder HUD nas laterais; preview deve mostrar o que foi excluído. Uma tela compartilhada pode exigir legibilidade maior que um crop de preenchimento.

## Custo

**Proposta, não benchmark:** construir proxy proporcional de 360–540 px de altura, preservar timestamps, detectar inicialmente a 2–5 fps por cena (120–300 inferências/minuto), associar e interpolar por tempo. Reamostrar mais perto de mudanças rápidas e em cenas curtas; webcam pequena pode exigir resolução maior ou recorte em resolução original. A análise de movimento de boca precisa taxa temporal maior que 2–5 fps e é orçamento separado.

Para tornar as estimativas auditáveis, suponha processamento serial, sem proxy pré-existente, decode/resize agregado de 1–10 s/min, 300 inferências, associação de 0,5–2 s e inicialização de 1–4 s. **Faixas de planejamento, não promessas:** CPU 5–30 s/min assumindo 8–45 ms/inferência; RTX 3050 CUDA 4–22 s/min assumindo 3–20 ms/inferência. Soma: CPU 4,9–29,5 s; GPU 3,4–22 s. São hipóteses sem medição para o hardware-alvo; quantidade de rostos, seek, proxy, disco e codecs podem ampliá-las muito. Não incluem análise de falante, transcrição, TTS ou render final. YuNet a 160×120 no benchmark do Zoo não valida inferências em resolução maior. Medir tempo frio/quente, p50/p95, VRAM e qualidade em 30/60 fps, 1080p, cenas e gameplays reais; incluir tempo de criação do proxy, decode e transferência, comparar GPU com CPU.

Na GPU de 4 GB, escalonar **transcrição faster-whisper → liberar modelo/contexto → análise visual → liberar → TTS → liberar → render**; sem paralelismo pressuposto. Isolar processos pode garantir liberação ao terminar; fila, cancelamento e retomada persistente evitam trabalho perdido. CUDA/driver, memória reservada, fragmentação e NVENC variam; se inicialização ou alocação falhar, avisar e repetir em CPU. TTS também pode consumir GPU, dependendo do motor; não se conhece sua pegada. Em máquinas sem GPU, avisar sobre lentidão e oferecer progresso.

## Saída e correção

**Proposta de contrato:** tempos em microssegundos relativos ao início do Corte, intervalos `[inicio,fim)`, mapeamento explícito para PTS da Fonte e time base original; coordenadas normalizadas na imagem após rotação/SAR, origem superior esquerda. Cada segmento tem ID, layout, confiança e elementos com retângulo de origem e destino; keyframes contêm tempo, centro `(x,y)`, escala (largura normalizada ou zoom, definida numa versão do esquema) e interpolação. Abaixo, escala é largura da região de origem dividida pela largura da imagem; a altura deriva da proporção do painel no espaço de pixels. Geometria de múltiplos painéis é independente.

```json
{"versao":1,"segmentos":[{"inicio_us":0,"fim_us":4000000,"layout":"fill","alvo":"rosto-1","origem":"automatico","confianca":0.82,"elementos":[{"destino":[0,0,1,1],"keyframes":[{"t_us":0,"x":0.45,"y":0.5,"escala":0.32,"interpolacao":"linear"},{"t_us":3000000,"x":0.52,"y":0.5,"escala":0.32,"interpolacao":"linear"}]}]}]}
```

Clampar retângulo à imagem; tratar dimensões pares/subamostragem e mudança de tamanho, SAR e rotação; usar PTS em vez de presumir FPS constante. Cena e edição manual delimitam descontinuidades; não interpolar entre segmentos. Preview e export devem avaliar a mesma função de interpolação, inclusive limites e arredondamento. Guardar sugestão automática separada dos overrides, com undo e regeneração que não apaga o trabalho do usuário.

| Render FFmpeg | Precisão e custo |
|---|---|
| `crop` com expressões `x/y` por tempo | Avaliação por quadro e interpolação linear são possíveis; tamanho de saída de crop é avaliado na configuração ou por comando, não presumir zoom contínuo via expressão de largura. Muitas expressões aninhadas tornam o filtro difícil de gerar e validar. |
| `sendcmd` + comandos de `crop` | Altera parâmetros no tempo dos quadros; atualizações esparsas produzem degraus, densas geram muitos comandos. Resolução limitada aos PTS dos quadros, testar ordem e bordas de segmento. |
| `zoompan` | Permite zoom e posição por quadro, mas tem semântica própria de duração/fps e pode duplicar quadros; validar VFR e sincronismo antes de usar. |
| Segmentar, aplicar filtro por segmento e concatenar | Cortes secos e layouts diferentes ficam claros; mais nós, inicialização e possível recodificação se exportar arquivos intermediários. Concatenar no filtergraph em uma codificação evita gerações com perda, mas exige PTS e formatos coerentes. |

FFmpeg documenta [crop, seus comandos, sendcmd, zoompan e concat](https://ffmpeg.org/ffmpeg-filters.html). Para split: `split` da Fonte, `crop` + `scale` por painel, `overlay` sobre tela 9:16, depois legendas libass; respeitar sincronismo e custos de cópias CPU/GPU. Testar quadros nas bordas, áudio, VFR, clamping e paridade com preview; não assumir que movimento em GPU acelera filtro CPU.

No editor: canvas mostra área preservada e partes cortadas; arrastar quadro e redimensionar, definir/fixar alvo por segmento, selecionar modo (seguir, fixo, central), dividir cena, alternar layouts e ajustar painel. Exibir keyframes na timeline, confiança baixa e botão restaurar sugestão; possibilitar revisão visual quadro a quadro e aplicar escolha a segmentos escolhidos. Alterar layout não deve descartar overrides sem aviso.

## Projetos de referência

| Projeto | Fatos e possível reaproveitamento |
|---|---|
| [AutoFlip](https://google-ai-edge.github.io/mediapipe/solutions/autoflip.html) | Código MediaPipe Apache-2.0; conceitos de cena, saliência e câmera. Solução legada sem suporte, não assumir manutenção dos grafos/modelos. Verificar licença de cada dependência e peso. |
| [ClipsAI](https://github.com/ClipsAI/clipsai) | Código MIT; [resize](https://www.clipsai.com/references/resize) combina PySceneDetect, rostos e diarização Pyannote e devolve segmentos. Referência para contrato de saída; fluxo de resize pede token e modelos Pyannote, que exigem auditoria de termos e dependências. Não assumir associação de fala à face confiável. |
| [OpenClipper](https://github.com/GrepCut/OpenClipper) | Núcleo MIT, desktop Tauri local e reenquadramento por cena. Referência de integração e editor; auditar arquivos, modelos e componentes incluídos separadamente antes de copiar. |
| [OpenShorts](https://github.com/RatomatoR/openshorts) | Núcleo MIT e modos de enquadramento, split e screencast; declara uso de MediaPipe e YOLOv8. Usar ideias de layouts, não incorporar inadvertidamente dependências ou pesos AGPL; classificação remota citada pelo projeto não satisfaz o padrão local-first. |
| [ByteTrack](https://github.com/FoundationVision/ByteTrack) | MIT; associação e tratamento de detecções fracas como referência, não um sistema completo de reenquadramento. |

Antes de copiar trechos, fixar commit, manter copyright/licença e acrescentar avisos, como no ADR-0002. Licença de repositório não saneia modelos, fontes ou bibliotecas externas.

## Recomendação

**Inferência:** v1 com YuNet no processo Python, ONNX Runtime CUDA como opção padrão quando a configuração Windows estiver comprovada, fallback OpenCV DNN/ONNX CPU; executar o mesmo checkpoint MIT. Se CUDA não superar CPU para o lote real, selecionar CPU automaticamente após medição. Não presumir que o pacote OpenCV comum possui CUDA. Usar amostragem e associação simples por cena, dead zone + limite de velocidade + suavização; se qualidade exigir, avaliar ByteTrack sem importar detectores não auditados.

Entregar Fill com rosto, Fit/centro, tela + webcam e split de duas pessoas, com retângulos e alvos manuais; sugestão automática de webcam como assistente de baixa confiança. Falante ativo, seguimento de corpo, detecção de HUD e layouts com três ou mais participantes ficam para depois de testes e auditoria dos pesos. A proposta não depende de falante ativo para funcionar.

**Riscos:** webcam pequena ou falsa face em jogo; corte de HUD e legendas originais; trocas erradas de identidade, jitter, oclusão e planos com vários interlocutores; limitações de precisão por proxy e VFR; custo de empacotamento CUDA Windows e mudança de drivers; divergência preview/export; datasets e pesos com termos não comerciais; memória de GPU compartilhada. Amostrar uma matriz de Fonte real com rostos variados, webcam em cantos e sem borda, gameplay, cenas rápidas e voz fora de quadro; avaliar retenção do rosto/HUD, estabilidade, correções por minuto e tempo total.

## Perguntas em aberto

- Qual versão e hash do YuNet, versão do ONNX Runtime e backend CUDA oferecer para Windows, Linux e macOS? Confirmar empacotamento, direitos e tamanho do instalador.
- Que latência e pico de VRAM medidos em RTX 3050 4 GB e CPUs-alvo incluem proxy, decode, carga, múltiplos rostos, exportação e TTS real?
- Quais métricas e limiares de confiança, zona morta, histerese e tempo de espera dão boa qualidade nas lives autorizadas do usuário?
- Como detectar webcam sem borda e diferenciar rostos do jogo, ilustrações e múltiplos overlays? Que frequência de correção manual é aceitável?
- Quais checkpoints de pessoa e falante têm licença explícita comercial e redistributível, inclusive dados e dependências? Como avaliar sobreposição de fala e áudio fora de quadro?
- Como o preview e FFmpeg se manterão idênticos com VFR, rotação, SAR, coordenadas pares, zoom e troca de layout? Qual estratégia de geração de filtros passa nos testes quadro a quadro?
