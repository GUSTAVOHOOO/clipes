# Reenquadramento (#60): detector de troca de cena e medições

**Status:** parcial. Decisão provisória: `scdet` do FFmpeg, sem dependência nova.

## Comparação de detectores de cena (sintético)

Vídeo sintético de 24 s, proxy 480×270 a 5 fps, 5 cortes secos conhecidos (quadros 20, 40, 60, 80, 100), seis padrões `lavfi` diferentes. Nenhuma mídia real entra no repo.

| Detector | Cortes achados | Tempo (CPU, 2 threads) |
| --- | --- | --- |
| `scdet` (t=10, intervalo mínimo 2 quadros) | 20, 40, 60, 100 + 1 falso (61); perdeu o 80 | 0,15 s |
| PySceneDetect 0.6.7.1 (BSD-3, `AdaptiveDetector`) | 5 de 5 | 0,33 s |
| TransNet V2 (MIT) | não medido (exige TensorFlow, pesado e fora do orçamento de RAM do worker) | n/d |

Em sintético o PySceneDetect acertou todos e o `scdet` errou um. Como o sintético é fácil, isso não decide em gameplay. A escolha provisória é `scdet`: sem dependência nova no worker e custo menor. A troca para PySceneDetect fica como mudança de uma função (`reframe.py`, lista de cortes) se a avaliação real mostrar que o `scdet` perde cortes.

## Limitações e pendências

- A avaliação com amostras reais do dataset #28 (gameplay) **não foi executada**: ela exige até 2 downloads nativos autorizados (só vídeo, ≤480p, fora do repo). Fica pendente; `benchmarks/reenquadramento/compare.py` e `measure.py` estão prontos para rodar localmente, e só números agregados devem vir para cá.
- RTF/RAM do YuNet em CPU e VRAM em GPU (RTX 3050) **não foram medidos** nesta entrega; `measure.py` faz a medição quando o checkpoint estiver baixado pelo fluxo de Componentes.
- Os testes automáticos usam detecções falsas e o worker falso; o teste com YuNet real fica como verificação manual.

## Constantes (documentadas no código)

Proxy 480 px / 5 fps; `SCENE_THRESHOLD=10`; câmera em `worker/src/clipes_worker/reframe_camera.py` (zona morta, limites de velocidade e aceleração, One Euro, histerese de 12 quadros com margem 1,25).
