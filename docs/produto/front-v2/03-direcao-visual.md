# Front v2 · Direção visual (fase 4)

Decisões do dev em 17/11/2026, tomadas sobre protótipos navegáveis (`wireframes/prototipo/`, servidos com `bun docs/produto/front-v2/wireframes/servir.ts`).

## Como chegamos aqui

1. Pesquisa de referências: [2026-11-17-referencias-visuais-front-v2.md](../../research/2026-11-17-referencias-visuais-front-v2.md) e o painel `wireframes/referencias/` (imagens não versionadas).
2. Rodada 1: quatro direções visuais em imagens geradas (`wireframes/direcoes/`): Sinal de Estúdio, Quadro de Partidas, Estúdio de Podcast e o padrão de editor. O dev recusou as quatro: "muito explosivo, muita informação, bagunçado". Também achou estranho usar canais (Flow, Podpah) como referência; a referência certa são apps.
3. Rodada 2: protótipos HTML (não imagens) no visual minimalista, com 3 organizações de cada tela.

## Princípios

- **Minimalismo com revelação progressiva.** Toda a informação continua existindo, mas só o que a tarefa atual precisa fica visível; o resto fica a um clique ou tecla (painéis recolhidos, popovers, "Ver os 5 eixos", "+3 faixas").
- **Referências:** Linear e Raycast (grafite, respiro, quase sem bordas, cor só no essencial, paleta `Ctrl+K`) e Teenage Engineering (grade rígida, poucos elementos, um laranja pontual).
- **Uma cor só.** Tudo é grafite e três cinzas de texto; o laranja-sinal aparece apenas no playhead, na marca de seleção e no único botão primário da tela. Estado se mostra com ícone e palavra cinza, nunca com selo colorido. A cor da legenda (amarelo da palavra ativa) é conteúdo do vídeo, não do app.
- **Separação por espaço, não por caixas.** Um degrau de superfície por área; bordas só quando inevitável; sem sombras, exceto em popovers.

## Base visual atual (protótipo)

Em `wireframes/prototipo/proto.css`. Esses valores são o ponto de partida dos tokens do design system:

| Papel | Valor |
|---|---|
| Fundo da janela | `#0f1012` |
| Área de trabalho | `#141518` |
| Elevado (popover, seleção, campo) | `#1a1b1f` |
| Texto 1 / 2 / 3 | `#ececee` / `#a1a1a8` / `#85858d` (todos ≥ 4,5:1) |
| Sinal (única cor) | `#ff5a1f`, texto sobre ele `#160700` |
| Tipografia | Inter 400/500/600, 13 px base, algarismos tabulares em timecodes |
| Raio | 6 px áreas, 4 px controles |
| Ícones | Lucide, traço 1,75 |

## Organização escolhida

- **Editor do Corte:** fala do Corte à esquerda (recolhível `Ctrl+[`), palco 9:16 no centro e, embaixo do vídeo, uma barra de 5 ações (Enquadrar, Legenda, Silêncios, Áudio, Histórico) que abrem popovers flutuantes. Não há painel fixo à direita (o antigo Inspetor). Timeline compacta: Vídeo e Áudio visíveis, "+3 faixas" para Frases, Narração e Trilha/SFX. Protótipo: `prototipo/editor.html?variant=D`.
- **Bancada de revisão:** lista e detalhe. Lista enxuta (título, início, Nota, ícone de aprovado ou rejeitado); detalhe com prévia, Nota e uma linha de motivo, "Ver os 5 eixos" recolhido, −1/+1 Frase e Aprovar/Rejeitar/Abrir no editor. Protótipo: `prototipo/revisao.html?variant=A`.

## Próximos passos

1. Design system com a skill Impeccable: tokens a partir da base acima e os componentes do catálogo de [02-consolidacao.md](./02-consolidacao.md), numa galeria local.
2. Rodada de telas em alta fidelidade com o design system, para todas as telas dos wireframes, aplicando o mesmo princípio de revelação progressiva.
3. Com as telas aprovadas, começa a implementação (fase 5, issue #288).
