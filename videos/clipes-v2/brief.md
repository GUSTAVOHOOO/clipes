# Brief

Intake respondido pelo mandato do mantenedor (dispatch do coordenador, 19/11/2026). Nada aqui ficou em "?".

| Input | Valor |
|---|---|
| Produto | Clipes v2.0.0: gerador open source de cortes de lives e vídeos (transcrição local, legenda e edição, agnóstico de provedor de IA). Interface refeita, mesmo núcleo. |
| URL | https://github.com/GUSTAVOHOOO/clipes. Não há site de produto, então a UI veio do app (`front-v2/` da master, mock) e não do `capture.mjs`. |
| Promessa | "Sua live virou Corte." |
| Público / plataforma | Criadores e canais de cortes; feed social sem som (16:9 para README/YouTube, 9:16 para Reels/Shorts/TikTok) |
| Duração | 30 s |
| Formatos | 16x9, 9x16 |
| Cores | medidas em `design-system-v2/src/tokens/tokens.css` (ver `docs/style_guide.md`); um acento: `--sinal` #ff5a1f |
| Fontes | Inter Variable (`@fontsource-variable/inter` 5.3.0, OFL-1.1), a única família do app |
| Filme de referência | nenhum; pesquisa de direção em `docs/pesquisa-direcao.md` |
| Música | `synth` (`scripts/music.py`) |
| Efeitos | earshot 0.4.1 (commit 4ac3d2ac2b151e1c23376f9ce7f3047a17050013), banco + preset `launch` |
| Locução | nenhuma |
| CTA | "Baixe grátis para Windows e Linux." + github.com/GUSTAVOHOOO/clipes · Releases |
| Mostrar | Corte pronto → Fonte → Transcrição → revisão dos Cortes → edição de legenda → exportação → chamada |
| Evitar | telas inventadas, vídeo de terceiros, slide de marketing genérico |

## Mensagens, em ordem
1. Sua live virou Corte (com legenda, pronto para postar).
2. Tudo começa na Fonte; a Transcrição é local e nada sai da máquina.
3. A IA (do provedor que você escolher) sugere; você aprova.
4. Legenda palavra por palavra, com controle real.
5. Exporte em lote. Baixe grátis para Windows e Linux.

## Origem de cada captura
Todas vêm de `scripts/capture-app.mjs`: Chromium headless (Playwright 1.65.0), `deviceScaleFactor: 2`, `reducedMotion: reduce`, contra o front-v2 da master em 8d81b19 (descende de afa8aab), servido por `cd front-v2 && bun run dev` (VITE_CORE_MOCK=1, http://127.0.0.1:1430). Tamanhos de 1440×900 e 1366×768. Os Projetos de demonstração são os do próprio mock ("Demo" e "Meu Canal de Cortes"), abertos pelo botão real "Abrir Projeto …" da tela Início.

| Arquivo (`assets/cap/<tamanho>/`) | Tela real (rota) | Interação real antes da foto |
|---|---|---|
| inicio | Início `#/inicio` | — |
| fontes | Fontes e Transcrição `#/projeto/meu-canal-de-cortes/fontes` | — |
| fonte-transcricao | Detalhe da Fonte `…/fontes/4` (Live_12_11_final.mp4) | — |
| cortes | Seleção `#/projeto/demo/cortes` | — |
| revisao | Revisão `#/projeto/demo/cortes/revisao/1` | — |
| revisao-aprovado | Revisão, idem | clique em "Aprovar" |
| corte-editar | Editar `#/projeto/demo/corte/201/editar?run=2` | — |
| corte-editar-painel | Editar, idem | clique em "Legenda" (painel real aberto) |
| corte-editar-102 | Editar (Corte direto 102) | — |
| corte-transformar | Transformar `…/corte/202/transformar?run=2` | — |
| corte-empacotar | Empacotar `…/corte/202/empacotar?run=2` | — |
| exportacao | Exportação `#/projeto/demo/exportacao` | — |
| `*.leg.png` | só a camada da legenda real (`[data-caption-line]` do renderizador `src/features/captions/render.ts`) com fundo transparente, recortada na área da Prévia | — |
| `rects.json` | retângulos medidos das áreas de Prévia (fundo #000) | — |

**O que foi "vestido" (dados de demonstração, só texto).** O mock mostra "Frase 10" no lugar das falas e "Texto narrado alinhado." na legenda. Na hora da captura, o script troca apenas esses TEXTOS no DOM já renderizado pelo app: falas fictícias de uma live de jogo, escritas para o filme (lista `FALAS` no script), e a legenda "O chat simplesmente explodiu". As pílulas "1 tarefa falhou", "Orçamento pausado" e "1 incerto" são estados de teste do mock e não aparecem num Projeto limpo, então são ocultadas. Nenhum componente foi criado, redesenhado ou movido.

**Mídia de demonstração.** O mock não reproduz vídeo (a Prévia fica preta, com "Prévia indisponível"). Onde o app mostraria o vídeo do usuário, o filme compõe quadros gerados pelo ffmpeg com o autômato celular `life` ("Jogo da Vida"), em `assets/demo/v` (9:16, 120×214) e `assets/demo/h` (16:9, 214×120), ampliados em pixel art:
`ffmpeg -f lavfi -i "life=s=120x214:mold=6:rate=15:ratio=0.12:death_color=#121317:life_color=#c9ccd3:mold_color=#262a33:seed=7" -vf trim=start=2:duration=10 …` (seed 11 e 214x120 para o 16:9). Não há vídeo de terceiros nem rosto de pessoa.

**Marca.** O app não tem arquivo de logo (o `src-tauri/icons/icon.png` é um placeholder). A marca real é o componente `Marca` de `design-system-v2/src/componentes/Tela.tsx:100-105`: ícone lucide `Scissors` (stroke 1.75, `text-sinal`) + "Clipes" em Inter 600, gap de 8 px a 16 px. No cartão final ela é reconstruída elemento a elemento, com o SVG do lucide-react 1.72.0 (`icons/scissors.mjs`).

## Notas
- Textos em PT-BR. Termos do `GLOSSARY.md`: Corte, Fonte, Transcrição, Nota, Provedor.
- Licença do repositório: Apache-2.0 (`LICENSE`).
