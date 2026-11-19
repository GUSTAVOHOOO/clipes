# Style guide: Clipes v2.0.0

Mundo da marca (`design-system-v2/src/tokens/tokens.css`): "Linear/Raycast (grafite, respiro, quase sem bordas) + Teenage Engineering (grade rígida, um único laranja-sinal). Toda cor fora do sinal é cinza." O filme fala a mesma língua.

## Paleta (medida no código, tema escuro, o padrão do app)
| Token | Hex | Fonte | Uso no filme |
|---|---|---|---|
| `--chao` | #0f1012 | tokens.css:13 | fundo das janelas (o próprio app) e sombra do gancho 9:16 |
| `--area` | #141518 | tokens.css:14 | fundo do palco e do cartão final (primeiro e último quadro) |
| `--elevado` | #1a1b1f | tokens.css:15 | pílulas (v2.0.0, plataformas) |
| `--linha` | #24252a | tokens.css:17 | divisória rara, 1 px |
| `--t1` | #ececee | tokens.css:23 | tipografia principal |
| `--t2` | #a1a1a8 | tokens.css:24 | eyebrows, sublinhas |
| `--t3` | #8a8a92 | tokens.css:25 | metadados |
| `--sinal` | #ff5a1f | tokens.css:28 | **a única cor**: só nos botões primários reais do app, na luz do botão que cobre o quadro no plano 6 e no ícone da marca |
| `--sinal-texto` | #ff6a33 | tokens.css:29 | não usado (a rodada 1 mostrou que acento laranja no texto + botão laranja na UI quebra a Luz Única) |
| `--sombra-flutuante` | 0 12px 32px rgb(0 0 0/.45) | tokens.css:38 | base da sombra de contato das telas inclinadas |

**Regra da Luz Única.** Um único elemento laranja "ligado" por quadro. A UI real já tem o seu (o botão primário de cada tela), então a tipografia do filme não usa laranja: a ênfase é `--t1` (branco) sobre o resto do bloco em `--t2` (cinza). No cartão final a única luz é o ícone Scissors; a faixa de telas ao fundo fica em cinza (saturate 0). O fundo do palco é `--area` (#141518), um degrau acima do `--chao` das capturas, para a sombra de contato das janelas aparecer. A mídia de demonstração é cinza (#111215 / #1f232b / #8f949e) para não competir com o sinal.

## Tipografia
- Uma família, a da marca: **Inter Variable** (`@fontsource-variable/inter` 5.3.0, OFL-1.1, arquivos em `assets/fonts/`), `--fonte` em tokens.css:102. Display: peso 600, tracking −0.02em (o app usa −0.01em no título; ampliado, o display aperta um pouco). Eyebrow: peso 500, `--t2`.
- Tamanhos a 1080p: display 92 px (16:9) / 116 px (9:16); eyebrow 42 px / 50 px; CTA 104 px / 96 px (a linha mais legível do filme); URL 52 / 46 px; nada lido abaixo de 38 px.
- Caixa de frase, pontuação do app (ponto final nas frases, "·" como separador, "×" e "−" tipográficos).
- A legenda do Corte é a **legenda real** do renderizador do app (fonte "Clipes Noto Sans", contorno 6, capturada), não tipografia do filme.

## Ritmo
120 BPM, compasso de 2 s. Planos de 4 s → 2 s → 4 s → 4 s → 6 s → 4 s → cartão final com eventos a cada 1 s. Cortes em compasso, eventos em batida ou meia batida.

## Transições
Match cut (1→2), corte seco (2→3, 3→4), whip pan com blur (4→5, 5→6), cobertura pelo botão que cresce (6→7). Nunca crossfade.

## Câmera
Springs `heavy` na câmera; push contínuo em todo plano parado; tilt 3D de 10–14° assentando em ~2–3° (perspectiva CSS verificada com `--verify`; se falhar, skew+escala 2D); rack focus por `filter: blur()` em camadas; motion blur adaptativo de 180° no render final. Profundidade com sombra de contato funda (`--sombra-flutuante` ampliada), nunca glow.

## Textura
Nenhuma: o app é plano e limpo. Sem grão, sem vinheta, sem light leak. O vídeo de demonstração tem pixels nítidos (`image-rendering: pixelated`).

## Texto entra / sai
Entra subindo por máscara (`TYPE.rise`, `heavy`), palavra a palavra nas frases curtas. Sai levantando pela máscara antes da próxima entrar (troca sequencial). Só os eyebrows podem aparecer por fade curto.

## Som
Trilha sintetizada a 120 BPM em Ré menor, contida (bumbo, rim, hats metálicos, baixo pluck, mallet FM), sem pads nem vocais. Efeitos do banco do earshot (preset `launch`): pops redondos de registro médio, cliques curtos no quadro do aperto, plucks pentatônicos nas palavras da legenda, um reverse swell, um riser até o logo. Master a −14 LUFS, pico verdadeiro ≤ −1 dBTP.
