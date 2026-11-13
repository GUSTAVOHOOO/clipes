# Design

Direção escolhida pelo dev: **Estúdio** (editor profissional com trilho de Cortes, preview e timeline, tema escuro neutro), mais minimalista, com **paleta Ctrl+K e atalhos visíveis**. As variantes A a H do protótipo exploram essa direção; este arquivo guarda o que é comum a elas.

## Visual Theme

Escuro por padrão. Superfícies em degraus de luminância de um neutro levemente tingido (croma 0,004 a 0,012 em OKLCH). Sem gradientes decorativos, sem vidro, sem sombras pesadas: a separação vem de 1 px de linha e de um degrau de luminância. O vídeo é a única coisa colorida da tela.

## Color

Estratégia **Restrained**: neutros tingidos e **um** acento, abaixo de 10% da superfície, usado só para playhead, seleção atual e foco.

| Token | Papel |
|---|---|
| `--bg` | palco do preview, o mais fundo |
| `--s1` | painéis e barras |
| `--s2` | hover, campos |
| `--s3` | controle ativo, trilhos |
| `--ln` / `--ln2` | linhas de 1 px, fraca e forte |
| `--tx` / `--tx2` / `--tx3` | texto principal, secundário, terciário (todos ≥ 4,5:1 sobre `--s1`) |
| `--acc` / `--acc-bg` / `--acc-tx` | acento, fundo do acento a 14%, texto sobre acento |

O botão primário é o texto principal invertido (claro sobre escuro), não o acento: o acento fica para o estado.

## Typography

Inter Variable para a UI, Geist Mono para timecodes e teclas (`font-variant-numeric: tabular-nums`). Escala fixa em px, razão ~1,15: 11 · 12 · 13 (base) · 15 · 18 · 22. Pesos 400 e 500; 600 só no título da tela. Sem caixa-alta espaçada como rótulo de seção.

## Components

- **Kbd:** 18 px de altura, Geist Mono 10,5 px, borda `--ln2`, fundo `--s2`.
- **Paleta Ctrl+K (cmdk):** 600 px, grupos por contexto, cada item com a tecla à direita; subpáginas (Ir para o Corte…).
- **Botões:** 28 a 32 px; primário invertido, secundário com borda, fantasma.
- **Timeline:** régua em tempo da Fonte, miniaturas, onda, Frases; fora do Corte fica apagado; alças claras; playhead no acento; silêncios hachurados.
- **Legenda karaokê:** desenhada sobre o preview no estilo do preset; a palavra ativa leva a cor de destaque do preset.

## Layout

App desktop sem scroll de página no editor. Painéis com 1 px de divisória. Funciona de 1280×800 a 1920×1080. Bottom-center livre (barra do protótipo).

## Motion

150 a 220 ms, `cubic-bezier(0.22, 1, 0.36, 1)` (ease-out-quart). Motion só para estado: gaveta que entra, seleção que muda, aviso que aparece. Com `prefers-reduced-motion: reduce`, transições viram troca instantânea ou fade curto.
