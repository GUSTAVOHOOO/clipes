# Avisos de terceiros do protótipo do editor

## HyperFrames

- Projeto: [HyperFrames](https://github.com/heygen-com/hyperframes), da HeyGen, Inc.
- Licença: Apache License 2.0 (<http://www.apache.org/licenses/LICENSE-2.0>).
- Copyright 2026 HeyGen, Inc.
- Commit de origem: `5bf361f` (clone local em `reference/hyperframes/`, fora do git).

| Arquivo do Clipes | Origem no HyperFrames | O que veio | Modificações |
|---|---|---|---|
| `ui/js/legenda.js` (`agruparPalavras`, `FIM_EXTRA`, normalização das palavras) | `registry/components/caption-pill-karaoke/caption-pill-karaoke.html` (`makeGroups`, `normalizeWords`, `GROUP_END_BUFFER`) | Regra de agrupamento de palavras em cartões de legenda (máximo de palavras, pontuação, pausa natural) e o fim visível do grupo (`min(próximo início, fim + 0,3 s)`) | Modificado pelo Clipes: sem GSAP, sem medição de largura nem limite de duas linhas, quebra obrigatória na troca de Frase, limite de palavras configurável pelo estilo, render karaokê `\kf` em CSS no lugar da troca de cor por palavra |

O formato normalizado de transcrição `{ text, start, end }` por palavra também segue o do HyperFrames. Nenhum código que dependa de GSAP foi trazido, e nenhum script do repositório deles foi executado.

## Tears of Steel

A mídia de teste não está no repositório: `npm run preparar` baixa o filme e a legenda do mirror oficial da Blender Foundation.

- "Tears of Steel" (c) Blender Foundation | <https://mango.blender.org>
- Licença: Creative Commons Attribution 3.0 (<https://creativecommons.org/licenses/by/3.0/>).
- Arquivos: `tears_of_steel_1080p.mov` e `subtitles/TOS-en.srt` de <https://download.blender.org/demo/movies/ToS/>.
- Alterações feitas localmente pelo script: corte para 16:9, reencode com GOP de 10 s, concatenação de 10 cópias e transcrição por palavra derivada da legenda oficial.
