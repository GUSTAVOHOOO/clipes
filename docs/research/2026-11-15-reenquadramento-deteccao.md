# Reenquadramento (#60): detector de troca de cena e medições

**Status:** parcial. Decisão provisória: `scdet` do FFmpeg, sem dependência nova. RTF em CPU medido; GPU e mídia real do #28 pendentes.

## Comparação de detectores de cena (sintético)

Vídeo sintético de 24 s, proxy 480×270 a 5 fps, 5 cortes secos conhecidos (quadros 20, 40, 60, 80, 100), seis padrões `lavfi` diferentes. Nenhuma mídia real entra no repo.

| Detector | Cortes achados | Tempo (CPU, 2 threads) |
| --- | --- | --- |
| `scdet` (t=10, intervalo mínimo 2 quadros) | 20, 40, 60, 100 + 1 falso (61); perdeu o 80 | 0,15 s |
| PySceneDetect 0.6.7.1 (BSD-3, `AdaptiveDetector`) | 5 de 5 | 0,33 s |
| TransNet V2 (MIT) | não medido (exige TensorFlow, pesado e fora do orçamento de RAM do worker) | n/d |

Registro para a próxima decisão: **o PySceneDetect acertou 5/5 no sintético**. Em sintético o PySceneDetect acertou todos e o `scdet` errou um. Como o sintético é fácil, isso não decide em gameplay. A escolha provisória é `scdet`: sem dependência nova no worker e custo menor. A troca para PySceneDetect fica como mudança de uma função (`reframe.py`, lista de cortes) se a avaliação real mostrar que o `scdet` perde cortes.

## Limitações e pendências

- A avaliação com amostras reais do dataset #28 (gameplay) **não foi executada**: ela exige até 2 downloads nativos autorizados (só vídeo, ≤480p, fora do repo). Fica pendente; `benchmarks/reenquadramento/compare.py` e `measure.py` estão prontos para rodar localmente, e só números agregados devem vir para cá.
- Os testes automáticos usam detecções falsas e o worker falso; o teste com YuNet real fica como verificação manual.

## Constantes (documentadas no código)

Proxy 480 px / 5 fps; `SCENE_THRESHOLD=10`; câmera em `worker/src/clipes_worker/reframe_camera.py` (zona morta, limites de velocidade e aceleração, One Euro, histerese de 12 quadros com margem 1,25).

## RTF e RAM do YuNet em CPU (medido)

- **Máquina:** AMD Ryzen 5 5600H, 15,4 GiB de RAM, Windows 11, ONNX Runtime em CPU (`ORT_THREADS=2`, 2 threads).
- **Entrada:** foto CC0 de rosto, "Face portrait (Unsplash).jpg", Wikimedia Commons (https://commons.wikimedia.org/wiki/File:Face_portrait_(Unsplash).jpg), transformada num vídeo de 40 s, 480 px de altura, 5 fps, com leve deslocamento horizontal. Baixada fora do repo e apagada depois.
- **Modelo:** `face_detection_yunet_2023mar.onnx`, revisão e SHA-256 fixados em `core/src/components/models.rs` (conferido).
- **Método:** `benchmarks/reenquadramento/measure.py --device cpu`, que roda `analyze` inteiro (proxy FFmpeg, `scdet` e YuNet) e amostra o RSS do processo e dos filhos a cada 50 ms.
- **Resultado:** 200 quadros em 9,47 s para 40 s de vídeo: **RTF 0,24**; **pico de RAM 128 MiB** (worker + FFmpeg); carga do modelo 2,6 s; rosto detectado em 200 de 200 quadros; dispositivo efetivo `cpu`.
- **Limite:** uma única imagem estática, um rosto. Cenas com vários rostos e movimento real custam mais associação, mas o YuNet domina o custo e não depende do conteúdo.

## GPU/VRAM: pendente

A RTX 3050 existe nesta máquina, mas as bibliotecas CUDA do worker não estão instaladas e nada foi instalado no sistema. VRAM e RTF em GPU ficam pendentes; `measure.py --device cuda` mede quando o ambiente estiver pronto.
