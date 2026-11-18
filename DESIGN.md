---
name: Clipes
description: Front v2 do Clipes. Grafite, respiro e um único laranja-sinal numa UI densa de edição de Cortes.
colors:
  chao: "#0f1012"
  area: "#141518"
  elevado: "#1a1b1f"
  hover: "#202126"
  linha: "#24252a"
  linha-forte: "#6e6e76"
  t1: "#ececee"
  t2: "#a1a1a8"
  t3: "#8a8a92"
  sinal: "#ff5a1f"
  sinal-texto: "#ff6a33"
  sinal-suave: "rgb(255 90 31 / 0.14)"
  no-sinal: "#160700"
  foco: "#ff5a1f"
  erro: "#f47a7a"
  veu: "rgb(0 0 0 / 0.52)"
  chao-claro: "#f6f6f7"
  area-claro: "#ededef"
  elevado-claro: "#ffffff"
  hover-claro: "#e3e3e6"
  linha-claro: "#dcdce0"
  linha-forte-claro: "#82828a"
  t1-claro: "#17171a"
  t2-claro: "#4a4a52"
  t3-claro: "#63636b"
  sinal-claro: "#e2480e"
  sinal-texto-claro: "#b83a0b"
  sinal-suave-claro: "rgb(226 72 14 / 0.12)"
  no-sinal-claro: "#160700"
  foco-claro: "#c93f0c"
  erro-claro: "#b42323"
  veu-claro: "rgb(20 20 24 / 0.32)"
typography:
  titulo:
    fontFamily: "Inter Variable, Inter, system-ui, sans-serif"
    fontSize: "16px"
    fontWeight: 600
    lineHeight: 1.3
    letterSpacing: "-0.01em"
  campo:
    fontFamily: "Inter Variable, Inter, system-ui, sans-serif"
    fontSize: "14px"
    fontWeight: 400
    lineHeight: 1.4
  base:
    fontFamily: "Inter Variable, Inter, system-ui, sans-serif"
    fontSize: "13px"
    fontWeight: 400
    lineHeight: 1.45
    fontFeature: "'cv11', 'ss01'"
  pequeno:
    fontFamily: "Inter Variable, Inter, system-ui, sans-serif"
    fontSize: "12px"
    fontWeight: 400
    lineHeight: 1.45
  micro:
    fontFamily: "Inter Variable, Inter, system-ui, sans-serif"
    fontSize: "11px"
    fontWeight: 500
    lineHeight: 1.3
rounded:
  mini: "3px"
  controle: "4px"
  area: "6px"
  full: "999px"
spacing:
  "1": "4px"
  "1.5": "6px"
  "2": "8px"
  "2.5": "10px"
  "3": "12px"
  "4": "16px"
  "5": "20px"
  "6": "24px"
components:
  botao-primario:
    backgroundColor: "{colors.sinal}"
    textColor: "{colors.no-sinal}"
    typography: "{typography.base}"
    rounded: "{rounded.controle}"
    padding: "0 10px"
    height: "28px"
  botao-secundario:
    backgroundColor: "{colors.elevado}"
    textColor: "{colors.t1}"
    rounded: "{rounded.controle}"
    padding: "0 10px"
    height: "28px"
  botao-secundario-hover:
    backgroundColor: "{colors.hover}"
  botao-fantasma:
    backgroundColor: "transparent"
    textColor: "{colors.t2}"
    rounded: "{rounded.controle}"
    padding: "0 10px"
    height: "28px"
  botao-fantasma-hover:
    backgroundColor: "{colors.hover}"
    textColor: "{colors.t1}"
  botao-suave:
    backgroundColor: "{colors.area}"
    textColor: "{colors.t2}"
    rounded: "{rounded.controle}"
    padding: "0 8px"
    height: "24px"
  botao-perigo:
    backgroundColor: "{colors.elevado}"
    textColor: "{colors.erro}"
    rounded: "{rounded.controle}"
    padding: "0 10px"
    height: "28px"
  campo:
    backgroundColor: "{colors.elevado}"
    textColor: "{colors.t1}"
    typography: "{typography.pequeno}"
    rounded: "{rounded.controle}"
    padding: "0 10px"
    height: "28px"
  campo-hover:
    backgroundColor: "{colors.hover}"
  kbd:
    backgroundColor: "{colors.elevado}"
    textColor: "{colors.t3}"
    typography: "{typography.micro}"
    rounded: "{rounded.mini}"
    padding: "0 5px"
    height: "18px"
  aba-ativa:
    backgroundColor: "{colors.elevado}"
    textColor: "{colors.t1}"
    rounded: "{rounded.controle}"
    padding: "0 10px"
    height: "28px"
  item-lista:
    backgroundColor: "transparent"
    textColor: "{colors.t2}"
    rounded: "{rounded.controle}"
    padding: "8px 16px"
  item-lista-selecionado:
    backgroundColor: "{colors.elevado}"
    textColor: "{colors.t1}"
  camada-flutuante:
    backgroundColor: "{colors.elevado}"
    textColor: "{colors.t1}"
    rounded: "{rounded.area}"
    padding: "12px"
    width: "268px"
---

# Design System: Clipes

Derivado do que está construído em `design-system-v2/` (tokens, primitivas, componentes e as telas de prova Editor e Bancada). Quando a direção visual e o código divergem, este arquivo segue o código. Os nomes dos tokens são os papéis usados no CSS (`--chao`, `--t2`, `--sinal`) e nos utilitários do Tailwind (`bg-chao`, `text-t2`, `bg-sinal`).

## Overview

**Creative North Star: "Ilha de edição, uma luz acesa"**

O Clipes é uma ilha de edição com a luz baixa: tudo é grafite e cinza, e uma única luz laranja marca onde está o trabalho (a agulha da timeline, o item selecionado, a ação primária da tela). A UI é densa, com texto base de 13 px, controles de 28 px e uma grade de 4 px. A densidade fica legível porque a separação vem do espaço e de degraus de superfície, quase nunca de bordas ou caixas.

Minimalismo com revelação progressiva. Toda informação continua existindo, mas só o que a tarefa atual pede fica à vista; o resto fica a um clique ou uma tecla: "Ver os 5 eixos", "+3 faixas", popovers da barra de ações, painel recolhível com `Ctrl [`, Paleta com `Ctrl K`. Estado é ícone e palavra cinza, nunca selo colorido. O vídeo é o conteúdo: o quadro 9:16 é preto e a cor da legenda pertence ao vídeo, não ao app.

O tema escuro é o padrão (`:root` e `[data-tema='escuro']`); o claro (`[data-tema='claro']`) tem os mesmos papéis. O contraste dos dois é conferido por `design-system-v2/scripts/contraste.ts`: texto com pelo menos 4,5:1; sinal, foco e `linha-forte` com pelo menos 3:1.

**Key Characteristics:**
- Grafite em quatro degraus (chão, área, elevado, hover) e três cinzas de texto.
- Um único laranja-sinal, raro e com função.
- Separação por espaço e degrau; borda de 1 px só onde é inevitável.
- Sombra só em camadas flutuantes.
- Estado = ícone + palavra cinza; erro = texto vermelho discreto, sem fundo.
- Números sempre tabulares; teclado em primeiro plano (atalhos visíveis em `Kbd`).
- Movimento curto (120 a 220 ms) com saída exponencial; some com `prefers-reduced-motion`.

## Colors

Grafite neutro com um único acento laranja; toda cor fora do sinal é cinza.

| Papel | Escuro (padrão) | Claro | Uso |
|---|---|---|---|
| `chao` | `#0f1012` | `#f6f6f7` | Fundo da janela, trilho de controles segmentados |
| `area` | `#141518` | `#ededef` | Uma área de trabalho: painel da Transcrição, lista da Bancada, banners |
| `elevado` | `#1a1b1f` | `#ffffff` | Campo, botão secundário, aba ativa, linha selecionada, popover, diálogo, toast |
| `hover` | `#202126` | `#e3e3e6` | Passagem do ponteiro e item realçado em menu/Paleta |
| `linha` | `#24252a` | `#dcdce0` | Divisória rara de 1 px (sob o topo, sobre a timeline), barra de rolagem |
| `linha-forte` | `#6e6e76` | `#82828a` | Contorno de controle que precisa de 3:1 (checkbox, switch desligado) |
| `t1` | `#ececee` | `#17171a` | Texto principal, valores, item ativo |
| `t2` | `#a1a1a8` | `#4a4a52` | Texto secundário, rótulos, botão fantasma |
| `t3` | `#8a8a92` | `#63636b` | Terciário: dicas, timecodes em repouso, status, placeholder |
| `sinal` | `#ff5a1f` | `#e2480e` | Agulha, marca de seleção, único primário, ícone da marca, caret |
| `sinal-texto` | `#ff6a33` | `#b83a0b` | Sinal usado como texto: a palavra falada sob a agulha |
| `sinal-suave` | `rgb(255 90 31 / 0.14)` | `rgb(226 72 14 / 0.12)` | Seleção de texto do navegador |
| `no-sinal` | `#160700` | `#160700` | Texto sobre o sinal (rótulo do primário) |
| `foco` | `#ff5a1f` | `#c93f0c` | Anel de foco de 2 px |
| `erro` | `#f47a7a` | `#b42323` | Só texto e ícone de erro acionável |
| `veu` | `rgb(0 0 0 / 0.52)` | `rgb(20 20 24 / 0.32)` | Atrás de diálogo e Paleta |

### Primary
- **Laranja-sinal** (`sinal`): a luz acesa. Aparece na agulha da timeline, na marca de seleção de 2 px, no único botão primário da tela, no ícone de tesoura da marca, no caret e no anel de foco. No claro escurece para manter 3:1.
- **Sinal como texto** (`sinal-texto`): versão para letras, mais clara no escuro e bem mais escura no claro, para passar 4,5:1. Só a palavra falada na Frase ativa usa.

### Neutral
- **Chão, Área, Elevado, Hover**: a escada de superfícies. Cada área de trabalho sobe um degrau; o que é interativo ou selecionado sobe mais um. No claro, Elevado é branco puro.
- **Linha e Linha forte**: `linha` é a divisória rara; `linha-forte` existe só para contornos de controle que precisam de contraste 3:1.
- **Três cinzas de texto** (`t1`, `t2`, `t3`): fazem toda a hierarquia de texto.
- **Erro** (`erro`): vermelho apagado, usado como texto ou ícone e nunca como fundo.

### Named Rules
**A Regra da Luz Única.** O sinal só aparece onde está o trabalho: agulha, marca de seleção, o único primário da tela, a palavra falada, o foco, o caret e a tesoura da marca. Qualquer outro uso de laranja é um erro.

**A Regra do Estado Cinza.** Estado é ícone + palavra em `t3` (ou `t2` quando forte). O tom (`neutro`, `info`, `sucesso`, `aviso`, `perigo`, `rodando`, `pausado`, `pendente`) escolhe só o ícone, nunca a cor.

**A Regra do Erro Sem Fundo.** O vermelho `erro` aparece como texto ou ícone: mensagem do `Campo`, `BannerErroCore`, toast de erro, botão e item de menu de perigo. Nunca pinta um fundo.

**A Regra da Cor do Vídeo.** O que está dentro do quadro 9:16 (preto, legenda branca, palavra ativa amarela `#ffd23f`) é conteúdo do vídeo e fica fora da paleta do app.

## Typography

**Body Font:** Inter Variable (via `@fontsource-variable/inter`, offline no Tauri), com fallback `Inter, system-ui, sans-serif`
**Label/Mono Font:** a mesma Inter, com `font-variant-numeric: tabular-nums` (utilitário `num`); mono do sistema só no detalhe técnico recolhido do `BannerErroCore`

**Character:** Uma família só, em escala de px pensada para UI densa. Os recursos `cv11` e `ss01` ficam ligados no `body`. Hierarquia vem de tamanho, peso (400/500/600) e dos três cinzas, nunca de cor.

### Hierarchy
- **Título** (600, 16 px, 1,3, `-0.01em`): título de diálogo, de estado de tela e do Corte em revisão na Bancada.
- **Campo** (400, 14 px, 1,4): a entrada da Paleta.
- **Base** (400, 13 px, 1,45): corpo da UI, botões m/g, itens de menu, Frases da Transcrição (com 1,55 de entrelinha).
- **Pequeno** (400, 12 px, 1,45): rótulos de campo, status, dicas, campos de texto, barra de status, botões p.
- **Micro** (500, 11 px, 1,3): `Kbd`, título de grupo de menu, marcas de tempo da régua.

Pesos: `normal` 400, `medio` 500 (aba segmentada ativa, título do Corte no subtopo), `forte` 600 (primário, Nota, títulos).

### Named Rules
**A Regra do Número Tabular.** Timecode, duração, contador, custo e Nota usam `num`. Números que mudam não podem fazer a linha dançar.

**A Regra dos Três Cinzas.** Hierarquia de texto se faz com `t1`, `t2` e `t3`. Um quarto cinza ou um texto colorido para "destacar" não entra.

## Layout

Grade de 4 px (`--spacing: 4px`; `p-1` = 4 px, `p-4` = 16 px). Passos mais usados: 4, 6, 8, 10, 12, 16, 20 e 24 px. Margem lateral da moldura: 16 px.

A moldura (`Tela`) ocupa a janela inteira e não rola por fora; quem rola é cada área (`AreaRolagem`, `ListaVirtual`). Alturas fixas:

| Peça | Altura |
|---|---|
| Barra superior (`BarraSuperior`) | 40 px (`--altura-topo`) |
| Subtopo do Corte (`ContextoCorte`) | 44 px (`--altura-subtopo`) |
| Barra de status (`BarraStatus`) | 28 px (`--altura-rodape`) |
| Barra de ferramentas / cabeçalho de lista | 36 px (`--altura-barra`) |
| Controle padrão / pequeno | 28 px / 24 px |

Composição das telas de prova:
- **Editor do Corte:** painel da Transcrição à esquerda em `area`, largura `clamp(330px, 31vw, 420px)` (a partir de 1440 px, `clamp(420px, 31vw, 480px)`), recolhível com `Ctrl [`. Palco no centro com o quadro 9:16 em altura total sobre o `chao`; logo abaixo, `Transporte` e `BarraAcoes` numa linha. Timeline compacta embaixo, separada por uma linha de 1 px. Sem painel fixo à direita.
- **Bancada:** grade `minmax(320px, 37%) 1fr` com 20 px de vão e 16 px de margem. A lista fica num bloco `area` de cantos 6 px; o detalhe fica direto no chão, com prévia de `clamp(200px, 16vw, 260px)` e texto até 640 px.

Pontos de quebra observados: 1300 px (abaixo dele o nome "Clipes" some do topo quando há Projeto aberto) e 1440 px (painel do Editor mais largo).

### Named Rules
**A Regra do Degrau.** Separe áreas por espaço e por um degrau de superfície (chão → área → elevado). Borda só onde é inevitável: 1 px de `linha` sob a barra superior, sobre a timeline e sob a entrada da Paleta.

## Elevation & Depth

O sistema é plano e se aprofunda por tons. O que está em repouso não tem sombra; profundidade é a escada chão → área → elevado → hover. Só as camadas que flutuam sobre o conteúdo (Dica, Popover, Menu, Select, Diálogo, Paleta, Toast) ganham sombra, e o diálogo vem com o `veu` atrás.

### Shadow Vocabulary
- **Flutuante** (escuro: `0 12px 32px rgb(0 0 0 / 0.45), inset 0 1px 0 rgb(255 255 255 / 0.03)`; claro: `0 12px 32px rgb(20 20 30 / 0.16), 0 1px 3px rgb(20 20 30 / 0.08)`): popover, menu, dica, select, diálogo.
- **Toast** (escuro: `0 8px 24px rgb(0 0 0 / 0.45)`; claro: `0 8px 24px rgb(20 20 30 / 0.16)`): avisos no canto inferior direito.
- **Marca** (`inset 2px 0 0 var(--sinal)`): não é sombra de profundidade; é a marca de seleção de 2 px na borda esquerda.

Camadas (z-index): palco 1, popover 300, toast 400, diálogo 500, dica 600.

### Named Rules
**A Regra da Sombra Flutuante.** Só o que flutua tem sombra. Painel, lista, banner e cartão ficam planos e se distinguem pelo degrau.

## Shapes

Cantos pequenos e consistentes. `mini` (3 px) em `Kbd`, checkbox, segmento ativo e blocos da timeline; `controle` (4 px) em botão, campo, item de lista e de menu, aba; `area` (6 px) em painel, popover, diálogo e no quadro 9:16; `full` em switch, trilho do slider e barra de progresso. O anel de foco herda o canto do controle. Ícones são Lucide, de traço 1,75, em 15 px em botões e menus e 13 a 14 px em status e linhas.

## Components

Botões, campos e itens são degraus sem borda; a forma muda pela superfície e o selecionado ganha a marca de sinal.

### Buttons
- **Shape:** cantos de controle (4 px), sem borda, ícone de 15 px e vão de 6 px.
- **Tamanhos:** p 24 px (texto 12 px), m 28 px, g 36 px.
- **Primário:** fundo `sinal`, texto `no-sinal` em 600. Um por tela, e é a ação que fecha a tarefa (Exportar no Editor, Aprovar na Bancada). Hover clareia 8% (`brightness`), ativo escurece 5%.
- **Secundário:** degrau `elevado`, texto `t1`; hover sobe para `hover`.
- **Fantasma** (padrão): transparente, texto `t2`; hover e aberto (`aria-expanded`) ganham `hover` e `t1`.
- **Suave:** degrau `area`, texto `t2`, para ações repetidas em linhas (−1 Frase / +1 Frase).
- **Perigo:** texto `erro` sobre `elevado`, sem fundo vermelho.
- **Estados:** desabilitado a 40% de opacidade; `carregando` troca o ícone por um giro (parado com reduced-motion) e mantém a largura. `atalho` mostra um `Kbd` à direita, com o tom acompanhando o fundo.
- **BotaoIcone:** quadrado (24/28/36 px), sempre com `Dica` (nome + atalho) e `aria-label`.

### Chips
Não há chips nem pílulas coloridas. `Status`, `SeloTipoVideo` e `BadgeNota` são texto: ícone + palavra, ou número + palavra.

### Cards / Containers
- **Corner Style:** `area` (6 px).
- **Background:** `area` sobre o chão (lista da Bancada, `BannerErroCore`, `FaixaJob`, eixos da Nota, `ResumoCustoPrivacidade`).
- **Shadow Strategy:** nenhuma (Regra da Sombra Flutuante).
- **Border:** nenhuma.
- **Internal Padding:** 10 a 12 px na vertical por 12 a 16 px na horizontal.

### Inputs / Fields
- **Style:** degrau `elevado`, sem borda, cantos 4 px, 28 px de altura (24 px no tamanho p), texto 12 px; hover sobe para `hover`.
- **Focus:** contorno de 2 px em `foco`, colado ao campo (offset 0); o fundo volta a `elevado`.
- **Error:** contorno interno de 1 px em `erro` mais mensagem em `erro` com ícone, dizendo o problema e como resolver. O `Campo` liga rótulo, ajuda e erro por id.
- **Disabled:** 40% de opacidade.
- **Escolhas:** checkbox e switch desligados têm contorno `linha-forte`; ligados ficam cheios em `t1` com marca/polegar em `chao` (estado por forma, não só por cor). Slider: trilho de 4 px, polegar `t1` de 12 px, alvo de 24 px. `Segmentado`: trilho `chao`, segmento ativo `elevado` em 500. `GradeOpcoes`: opção escolhida com a marca de sinal.

### Navigation
- **Barra superior (40 px):** tesoura em `sinal` + "Clipes", seletor de Projeto, três `Etapas` (Fontes · Cortes · Exportação, separadas por ponto médio) em `t3`, com a atual em `t1`; à direita "Somente local", gatilho da Fila e gatilho da Paleta (`Ctrl K`) no degrau `area`.
- **Abas:** texto `t3`; a ativa sobe para `elevado` em `t1`. Sem sublinhado.
- **Paleta (`Ctrl K`):** diálogo com entrada de 14 px e itens de 36 px; o item realçado ganha `hover` e a marca de sinal.
- **Barra de status (28 px):** salvamento e job à esquerda (anunciados com `aria-live="polite"`), dicas de atalho com `Kbd` à direita, tudo em 12 px `t3`.

### Seleção (assinatura)
O item selecionado ou ativo sobe para o degrau `elevado` e ganha 2 px de `sinal` na borda esquerda (`marcado` / `shadow-marca`). Vale para `ItemCorte`, a Frase ativa (`LinhaFrase`), a opção escolhida em `GradeOpcoes`, a ação aberta na `BarraAcoes` e o item realçado da Paleta. O foco de itens colados à borda de uma lista é desenhado por dentro (`foco-interno`, offset −2 px).

### Nota
A Nota é texto: "Nota 8,4" em 600 seguida de uma linha de motivo em `t2`. Na lista da Bancada aparece só o número, em 600 e `t1`. Os cinco eixos ficam recolhidos atrás de "Ver os 5 eixos" e abrem num bloco `area` com nome, peso, valor e porquê.

### Timeline
Régua em micro `t3`, faixa de Vídeo com miniaturas a 70%, faixa de Áudio com forma de onda em `t3`, Entrada e Saída como colchetes de 2 px em `t2`, silêncios hachurados com borda tracejada. A agulha é o único traço em `sinal` (2 px), com alvo de 24 px e `role="slider"`. Frases, Narração e Trilha/SFX ficam atrás de "+3 faixas".

### Inventário

**Primitivas** (`design-system-v2/src/primitivas/`)
- `Botao`: botão com variantes primario/secundario/suave/fantasma/perigo, tamanhos p/m/g, `carregando`, `icone` e `atalho`.
- `BotaoIcone`: botão quadrado só de ícone, sempre com `Dica`.
- `Kbd`: tecla ou combinação; `tom` normal/forte/sinal conforme o fundo.
- `Campo`: rótulo, ajuda e erro ligados ao controle por id.
- `Entrada`: campo de texto de uma linha (p/m).
- `Busca`: campo com lupa, nome acessível e atalho.
- `AreaTexto`: texto de várias linhas, redimensionável na vertical.
- `Select`: escolha única em lista curta (até ~15 opções; mais que isso vai para a Paleta).
- `Checkbox`: com estado misto; contorno `linha-forte`, cheio em `t1` quando marcado.
- `Switch`: liga/desliga; estado mostrado pela posição do polegar.
- `Slider`: trilho fino com polegar claro e texto de valor para leitor de tela.
- `Segmentado`: 2 a 4 opções exclusivas curtas, radiogroup com setas.
- `GradeOpcoes`: opções grandes com ícone; a escolhida leva a marca de sinal.
- `Abas`: abas de texto; a ativa sobe um degrau.
- `Status`: ícone + palavra cinza; o tom escolhe o ícone.
- `Progresso`: barra de 2 px cinza com número tabular; indeterminado pulsa.
- `Skeleton`: contorno neutro pulsante no formato do que vai chegar.
- `Separador`: divisória de 1 px em `linha`, horizontal ou vertical.
- `AreaRolagem`: rolagem com barra fina que aparece ao passar ou rolar.
- `ProvedorToast` / `useToast`: toasts discretos no canto inferior direito, até 3, 4 s.
- `ProvedorDicas` / `Dica`: tooltip com nome da ação e atalho.
- `Popover`: camada flutuante de 268 px com título e fechar; não prende o foco.
- `Menu`, `MenuItem`, `MenuMarcavel`, `MenuSeparador`, `MenuGrupo`: menu de ações, com item de perigo em `erro`.
- `Dialogo`: janela modal a 14% do topo, 440 px por padrão, com véu.
- `ConfirmDialog`: confirmação com foco inicial em Cancelar.

**Componentes** (`design-system-v2/src/componentes/`)
- `Tela`: moldura da janela (topo, conteúdo que não rola por fora, barra de status).
- `BarraSuperior`, `SeletorProjeto`, `Etapas`, `GatilhoFila`, `GatilhoPaleta`: peças do topo de 40 px.
- `BarraStatus`, `DicaAtalho`: rodapé de 28 px com salvamento, job e atalhos.
- `ContextoCorte`: subtopo de 44 px dentro de um Corte (voltar, anterior/próximo, título, sub-abas, Exportar).
- `Paleta` + `useAtalhoPaleta`: comandos com `Ctrl K` em qualquer tela.
- `Esqueleto`: carregamento no formato da tela.
- `EstadoTela`: vazio, parcial ou sem permissão, com um único primário.
- `BannerErroCore`: erro do núcleo traduzido, com recuperação e detalhe técnico recolhido.
- `FaixaJob`: job rodando com progresso e Cancelar, sem tirar o conteúdo.
- `ResumoCustoPrivacidade`: cartão único antes de chamar um Provedor (o que roda, onde, o que sai, quanto custa).
- `ListaVirtual`: listbox virtualizada com um único tab stop.
- `TabelaGrade`: tabela com navegação por setas entre células.
- `PlayerProxy`: quadro 9:16 (ou 16:9) preto com legenda do vídeo e estado de Fonte ausente.
- `Transporte`: reproduzir, início/fim, marcar Entrada/Saída, mudo e timecode.
- `BarraAcoes` + `GrupoAjuste`: cinco ações sob o vídeo que abrem popovers ao lado do quadro (`Ctrl ]` reabre a última).
- `TimelineEditor`: timeline compacta com agulha, Entrada/Saída, silêncios e "+3 faixas".
- `InstaladorJustInTime`: baixa um componente na hora em que ele faz falta.
- `ChecklistGuardaCorpos`: avisos antes de exportar; informa e não bloqueia.
- `SeloTipoVideo`: "Corte direto" ou "Vídeo transformado" como ícone + palavra.
- `BadgeNota`: Nota como texto, com motivo no modo detalhe.
- `EixosNota`: os cinco eixos da Nota, recolhidos por padrão.
- `LinhaFrase`: Frase da Transcrição com timecode e palavra falada em sinal.
- `LinhaSilencio`: silêncio entre Frases, alternável entre manter e remover.
- `ItemCorte`: linha da Bancada com título, início, duração, Nota e ícone da decisão.
- `AjusteBorda`: Início/Fim do Corte com −1/+1 Frase e prévia da fala.

### Movimento
Durações `dur-rapida` 120 ms (cor de itens, abas), `dur-base` 150 ms (botões, campos, camadas flutuantes) e `dur-lenta` 220 ms (toast, progresso), todas com `ease-saida` (`cubic-bezier(0.16, 1, 0.3, 1)`). Camadas flutuantes entram com opacidade e escala de 0,98 (diálogo 0,985); toast sobe 8 px. Indeterminado e esqueleto pulsam (1,6 s, opacidade até 0,55). Com `prefers-reduced-motion` as durações vão a 0,01 ms e giros e pulsos param.

## Do's and Don'ts

### Do:
- **Do** usar um único botão primário (`sinal`) por tela, na ação que fecha a tarefa.
- **Do** marcar seleção com degrau `elevado` + 2 px de `sinal` à esquerda (`marcado`).
- **Do** mostrar estado como ícone + palavra em `t3`, com `Status`.
- **Do** separar áreas por espaço e degrau de superfície; usar `linha` só nas divisórias já existentes.
- **Do** usar `num` em todo timecode, duração, contador, custo e Nota.
- **Do** dar a todo `BotaoIcone` uma `Dica` com nome e atalho, e mostrar atalhos com `Kbd`.
- **Do** esconder o secundário atrás de um clique ou tecla (recolhido, popover, "+N faixas") em vez de apagá-lo.
- **Do** escrever a Nota como texto ("Nota 8,4" + motivo).
- **Do** conferir os dois temas com `bun scripts/contraste.ts` ao mexer em cor.

### Don't:
- **Don't** usar laranja fora da agulha, da marca de seleção, do primário, da palavra falada, do foco e da marca do app.
- **Don't** pintar fundo de vermelho: perigo é texto `erro` sobre `elevado`.
- **Don't** fazer selos, pílulas ou badges coloridos para estado, tipo de vídeo ou Nota.
- **Don't** pôr sombra em painel, lista ou cartão; sombra é só de camada flutuante.
- **Don't** cercar áreas com borda ou caixa quando um degrau de superfície resolve.
- **Don't** colocar um segundo primário na tela nem um painel fixo à direita no Editor.
- **Don't** trazer a cor da legenda (amarelo da palavra ativa) para a UI do app.
- **Don't** criar valores fora da escala (tamanho de texto, raio, espaço) quando um token serve.

## Uso no app

O pacote é `@clipes/design-system-v2` (Tailwind 4, React 19, Base UI). No CSS de entrada do app:

```css
@import '@clipes/design-system-v2/estilos.css';
@source '../../design-system-v2/src'; /* caminho relativo até design-system-v2/src */
```

`estilos.css` traz o Tailwind, os tokens e a base (Inter, reset, foco, seleção, barras de rolagem, utilitários `num`, `foco-interno` e `marcado`). O `@source` faz o Tailwind enxergar as classes usadas dentro dos componentes. Os componentes vêm de `design-system-v2/src/index.ts` (primitivas, componentes, `cn` e os formatos PT-BR `tc`, `tcLongo`, `duracao`, `usd`, `nota`, `tamanho`). Envolva o app em `ProvedorDicas` e `ProvedorToast`. Para o tema claro, ponha `data-tema="claro"` no `<html>`.

Galeria local: `bun run dev` em `design-system-v2/` (http://127.0.0.1:5191), com páginas de tokens, primitivas, componentes e as telas Editor e Bancada.
