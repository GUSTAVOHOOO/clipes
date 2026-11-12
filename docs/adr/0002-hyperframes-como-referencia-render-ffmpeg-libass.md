---
status: accepted
---

# HyperFrames como referência e fonte de código; render principal com FFmpeg + libass

O [HyperFrames](https://github.com/heygen-com/hyperframes) (HeyGen, Apache-2.0) já resolve, e valida em produção, várias peças de que o editor do Clipes precisa: legenda karaokê por palavra, recorte de uma Fonte longa por intervalo, faixas com ducking de áudio, exportação 1080×1920 e um player web com `seek` e intervalo. Decisão do dev em 12/11/2026: **usamos o HyperFrames como referência e copiamos o código que nos servir**, em vez de reinventar. O **render principal do Clipes é FFmpeg + libass**, comandado pelo núcleo, e **não** o motor do HyperFrames.

O motivo é o render deles. Ele captura frame a frame num Chrome headless (Node 22 + chrome-headless-shell + FFmpeg) e fica perto de 1× tempo real ou mais lento. Isso obrigaria a empacotar um Chromium junto com o Tauri e pesaria na máquina-alvo (RTX 3050 4 GB ou só CPU). O projeto também está em pré-1.0 (v0.9.x, com releases diárias), tem issues abertas no Windows (estimativa de disco que recusa o render, EBUSY no FFmpeg) e não faz reenquadramento por rosto.

## Como trazemos o código

- O clone fica em `reference/hyperframes/`, ignorado pelo git. A referência inicial é o commit `5bf361f` de 12/11/2026.
- Cada arquivo ou trecho copiado mantém o cabeçalho de copyright original, ganha a nota "Modificado pelo Clipes" quando alterado e recebe uma entrada em `THIRD_PARTY_NOTICES.md` com o commit de origem e a licença, conforme a Apache-2.0 (§4).
- O README e a documentação dão crédito explícito ao HyperFrames.
- **Fica fora do núcleo** o que depende do **GSAP**, que é gratuito, mas usa a "Standard 'No Charge' GSAP License". Essa licença não é OSI, não concede redistribuição explícita, proíbe "tools that allow users to build visual animations without code" que concorram com o Webflow e pode ser alterada ou encerrada pelo Webflow. Também ficam fora os blocos do catálogo que carregam assets de CDN. As animações de legenda usam CSS/WAAPI no preview e libass no render.
- **Consequência para a licença do Clipes:** ela precisa ser compatível com Apache-2.0 (MIT, Apache-2.0 ou GPLv3; GPLv2-only não serve).

## Opções consideradas

- **HyperFrames como base do editor e do render:** reaproveitaria mais coisa de uma vez, mas traria um instalador pesado, render lento na máquina-alvo e dependência de uma API pré-1.0. O próprio Studio deles se descreve como "building blocks, not a drop-in embedded editor".
- **Não usar:** jogaria fora peças já validadas e o valor de construir em cima de um projeto da comunidade open source.
- **Remotion:** licença source-available, gratuita só para pessoas físicas e empresas pequenas. Não serve para um app open source distribuído a terceiros.

## Futuro

O HyperFrames pode voltar como **plugin opcional de efeitos** (cards e animações elaboradas), baixado sob demanda depois da v1. Nesse caso, o GSAP seria baixado pelo usuário com o plugin, não redistribuído pelo Clipes, e o uso dele seria reavaliado à luz da licença vigente.
