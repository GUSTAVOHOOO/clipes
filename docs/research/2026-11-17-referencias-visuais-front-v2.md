# Referências visuais para o design system do front v2 do Clipes

## Resumo executivo

Esta pesquisa reúne 24 referências visuais divididas em três eixos para orientar a escolha estética do front v2 do Clipes: (1) o repertório cultural que quem produz Cortes e Canais dark reconhece todo dia, (2) o padrão de qualidade (*craft*) de aplicativos desktop de trabalho densos e rápidos no teclado, e (3) os concorrentes diretos de cortes automatizados, mapeados como contraexemplo. O usuário-alvo trabalha horas por dia em notebooks Windows (1366 a 1920 px), muitas vezes à noite, e precisa de uma bancada onde vídeo, timeline e Transcrição ocupem o centro sem fadiga visual nem ruído decorativo. O ponto comum dos concorrentes SaaS — gradientes roxo/rosa/laranja, selos de "AI magic" e pontuação opaca — deve ser evitado para que o Clipes transmita precisão de ferramenta local e transparência de custo. Ao mesmo tempo, o repertório de transmissão ao vivo (OBS, Twitch, CazéTV), suítes profissionais (DaVinci Resolve, Final Cut, Ableton, Blender) e instrumentos táteis (Teenage Engineering) oferece vocabulário real sem fantasia. Também comparamos 5 famílias tipográficas livres (SIL OFL) com suporte completo a PT-BR e algarismos tabulares (`tnum`), além de 4 estratégias de cor e o equilíbrio entre tema escuro e claro. Ao final, apresentamos 7 mundos visuais candidatos, ordenados do mais ao menos promissor, para decisão do desenvolvedor e do coordenador.

---

## Grupo 1 · O mundo cultural do público (8 referências)

O que o editor de **Canal de cortes** e de **Canal dark** vê diariamente antes e depois de abrir o Clipes: streams, placares, feeds verticais e estúdios de podcast.

### 1. Twitch (Modo Teatro, Diretório e Badges Ao Vivo)
- **Link oficial:** <https://www.twitch.tv/>
- **Por que importa:** É a origem direta de grande parte das lives (VODs) que alimentam Canais de cortes no Brasil; quem opera Cortes reconhece de imediato a leitura de estado ao vivo, barra lateral compacta e densidade de chat/vídeo.
- **O que levar:** Separação clara entre o palco do vídeo (preto profundo no modo teatro) e a coluna lateral estreita com listas densas de canais e contadores numéricos legíveis; selos pequenos e secos de estado (`AO VIVO` em vermelho sólido sem gradiente) e atalhos rápidos ao redor do player.
- **O que evitar:** O roxo saturado da marca espalhado por botões e banners promocionais — em uso prolongado de edição, o roxo compete com a cor da pele no vídeo e aproxima o visual dos concorrentes SaaS.

### 2. YouTube / YouTube Creators & Studio
- **Link oficial:** <https://www.youtube.com/creators/> (hub oficial de criadores; painel de trabalho em <https://studio.youtube.com/>)
- **Por que importa:** É o destino final de publicação e o painel onde criadores acompanham retenção, direitos autorais e publicação em lote.
- **O que levar:** Escala tipográfica direta para métricas de revisão (duração, status de processamento, alertas objetivos com ícone), cartões de trabalho com divisórias limpas de 1 px e contraste bem calibrado tanto no tema claro quanto no grafite escuro (`#0F0F0F` / `#212121`).
- **O que evitar:** Excesso de espaço em branco de página de marketing ou cartões grandes de "dicas" que desperdiçam altura útil numa tela de 1366×768.

### 3. Kick (Streaming de Alto Contraste)
- **Link oficial:** <https://kick.com/> (central oficial: <https://help.kick.com/en/>)
- **Por que importa:** Ganhou forte adoção entre streamers brasileiros e editores de cortes de IRL/gaming; consolidou na cabeça desse público um visual escuro seco com sinalização ácida.
- **O que levar:** Estética enxuta de baixa ornamentação (cantos pouco arredondados, linhas secas, fundo escuro quase neutro) e sinalização instantânea de atividade/status sem depender de gradientes.
- **O que evitar:** Verde neon (`#53FC18`) como cor dominante de interface — funciona para logotipo e badge de stream ao vivo, mas causa fadiga ocular severa (*halation*) se aplicado em seleções grandes ou bordas contínuas à noite.

### 4. CazéTV & Grafismo Esportivo ao Vivo (Placar e Lower Thirds)
- **Link oficial:** <https://www.youtube.com/@CazeTV> (e referência técnica de grafismo broadcast: <https://www.vizrt.com/>)
- **Por que importa:** A CazéTV popularizou no Brasil o encontro entre transmissão esportiva de TV e linguagem de live/YouTube, com placares condensados (*scorebugs*), câmeras de reação empilhadas e tarjas legíveis em fração de segundo.
- **O que levar:** Disciplina informacional de placar: números tabulares ultra-legíveis, agrupamento em faixas horizontais compactas (barra de contexto do Corte, status de job na fila), rótulos curtos e caixas opacas de alto contraste sobre vídeo.
- **O que evitar:** Tipografia display muito condensada ou inclinada na UI de trabalho (funciona em placar e thumbnail, mas cansa na leitura de Transcrição e formulários de Empacotamento).

### 5. YouTube Shorts & Cultura de Legenda Karaokê (9:16)
- **Link oficial:** <https://www.youtube.com/creators/create/shorts/>
- **Por que importa:** Define a gramática visual do produto entregue pelo Clipes: quadro vertical 9:16, zonas seguras para não colidir com botões da plataforma e legenda palavra por palavra.
- **O que levar:** Tratamento do quadro 9:16 como "palco sagrado" com moldura neutra ao redor (mostrando claramente zonas de corte e áreas seguras), e destaque cirúrgico na palavra ativa durante a revisão da Transcrição.
- **O que evitar:** Trazer a estética berrante da legenda (amarelo neon com contorno grosso de 6 px) para os botões, abas e painéis do aplicativo; a legenda pertence ao conteúdo do vídeo, não ao chassi do editor.

### 6. Cortes de Podcast Brasileiros (Flow Podcast & Podpah)
- **Link oficial:** <https://www.youtube.com/@FlowPodcast> (e <https://www.youtube.com/@Podpah>)
- **Por que importa:** São o arquétipo do fluxo "live longa de 3 horas -> dezenas de Cortes diretos" no Brasil, com enquadramento multicâmera, cortes de bancada e identidade de estúdio noturno.
- **O que levar:** Clima de estúdio escuro iluminado com foco no assunto (fundo contido que faz o rosto no vídeo saltar), identificação clara de falantes na Transcrição e leitura imediata de "momento quente" sem precisar de jargão técnico.
- **O que evitar:** Estética de thumbnail sensacionalista (fontes gigantes com sombra pesada, setas vermelhas, saturação estourada) dentro dos painéis do app.

### 7. Identidade Visual de Canais Dark (ex.: Kurzgesagt)
- **Link oficial:** <https://www.youtube.com/@kurzgesagt> (estúdio oficial: <https://kurzgesagt.org/>)
- **Por que importa:** Representa o polo oposto ao Corte direto: Vídeo transformado com Roteiro, Narração, ritmo visual forte e identidade própria sem rosto em tela.
- **O que levar:** Clareza na organização em etapas e blocos (Roteiro -> Ângulos -> Narração), uso de blocos cromáticos planos e legíveis para distinguir tipos de camada/faixa sem poluição de texturas.
- **O que evitar:** Paleta saturada ou ilustrativa demais no chassi do editor — canais dark têm paletas muito próprias (roxo espacial, ciano, amarelo), e a UI do Clipes precisa continuar neutra para acomodar qualquer estilo de canal.

### 8. Overlays de Stream & Lower Thirds (Overlays.uno / Broadcast)
- **Link oficial:** <https://overlays.uno/library>
- **Por que importa:** Mostra como informações dinâmicas (placar, nome do convidado, meta, alerta) convivem com vídeo em movimento usando barras compactas e micro-animações secas.
- **O que levar:** Sintaxe de *lower third* para avisos não-intrusivos (*toasts*), barra de progresso da fila de jobs e seletores de Layout (16:9 -> 9:16, tela dividida, webcam + jogo) representados com ícones geométricos simples.
- **O que evitar:** Efeitos de vidro fosco pesados (*glassmorphism*) e brilhos neon sobre a interface inteira — em WebView de notebook sem GPU dedicada, transparências e *blur* custam FPS na reprodução do preview.

---

## Grupo 2 · Craft de app desktop de trabalho (10 referências)

Aplicativos densos que servem como barra de qualidade de engenharia visual para uma ferramenta de uso diário em 1366–1920 px.

### 1. Linear
- **Link oficial:** <https://linear.app/>
- **Densidade e hierarquia:** Alta densidade sem sensação de aperto; separa blocos por degraus mínimos de luminância (ex.: `#08090A` -> `#0F1011` -> `#141516`) e bordas de 1 px semitransparentes em vez de sombras pesadas.
- **Painéis / timeline:** Lista mestra e inspetor lateral direito com alinhamento rígido em grade de 4 px e estados de hover instantâneos.
- **Tema claro / escuro:** Escuro-primeiro calibrado em LCH (sem preto `#000` chapado), com tema claro limpo equivalente.
- **Tipografia:** Inter com peso intermediário e tracking negativo controlado em títulos, além de atalhos de teclado sempre visíveis em `<kbd>`.
- **Detalhe-assinatura:** Paleta de comandos `Ctrl/Cmd+K` rápida e precisa, com foco e seleção conduzidos por um único acento cirúrgico.
- **O que evitar:** Indiferenciação excessiva entre áreas interativas quando tudo fica cinza quase igual — em um editor de vídeo, botões de transporte e alças da timeline precisam de contraste e alvo claros (≥ 24 px).

### 2. Raycast
- **Link oficial:** <https://www.raycast.com/press>
- **Densidade e hierarquia:** Lista densa de ações onde cada linha mostra ícone, título, contexto secundário e atalho à direita com zero texto supérfluo.
- **Painéis / timeline:** Estrutura modular de lista + painel de detalhe/preview lado a lado, ideal para a bancada de revisão de Cortes do Clipes.
- **Tema claro / escuro:** Escuro profundo com micro-contraste nítido entre o item selecionado e a lista.
- **Tipografia:** Sans-serif neutra combinada com rótulos monoespaçados compactos para teclas de atalho (`Ctrl+K`, `J/K/L`).
- **Detalhe-assinatura:** Barra inferior fixa de ações contextuais exibindo o atalho primário (`Enter`) e o menu de ações (`Cmd/Ctrl+K`) — ensina o teclado passivamente.
- **O que evitar:** Depender de *backdrop blur* pesado sobre o desktop/vídeo, que degrada desempenho em notebooks Windows modestos.

### 3. Figma
- **Link oficial:** <https://www.figma.com/design/>
- **Densidade e hierarquia:** O canvas do trabalho ocupa ~75–80% da área útil; painéis laterais estreitos (~240–280 px) abrigam controles numéricos compactos.
- **Painéis / timeline:** Inspetor lateral direito organizado por seções curtas (Posição, Corte, Estilo) sem cartões aninhados nem scroll infinito de configurações.
- **Tema claro / escuro:** Ambos completos; cinza neutro médio ao redor do canvas para não enviesar percepção de cor.
- **Tipografia:** Rótulos curtos de 11–12 px alinhados com campos numéricos em `tabular-nums` para edição rápida de coordenadas de *crop* e tempo.
- **Detalhe-assinatura:** Ferramentas contextuais que aparecem junto ao objeto selecionado e barra de ferramentas enxuta ancorada, mantendo o centro livre.
- **O que evitar:** Ícones minúsculos sem rótulo para ações pouco frequentes — o Clipes precisa manter o caminho principal compreensível sem exigir memória de editor veterano.

### 4. Ableton Live (12 / 13)
- **Link oficial:** <https://www.ableton.com/en/live/>
- **Densidade e hierarquia:** Zero ornamentação decorativa; tudo na tela existe para manipular tempo, faixas e parâmetros em tempo real.
- **Painéis / timeline:** Linha do tempo horizontal com cores funcionais por faixa, marcadores nítidos e zoom contínuo; divisão clara entre lista de faixas e visor inferior de detalhes.
- **Tema claro / escuro:** Temas de estúdio claro (cinza claro fosco) e escuro (grafite médio), pensados para sessões de muitas horas sem reflexo nem ofuscamento.
- **Tipografia:** Sans-serif geométrica compacta com números uniformes em réguas, dB e compassos.
- **Detalhe-assinatura:** Botões e indicadores planos com borda nítida de 1 px e contraste imediato de estado ligado/desligado (âmbar/laranja sobre cinza) sem sombras nem gradientes.
- **O que evitar:** Densidade extrema sem respiro entre controles — o Live pressupõe usuário especialista e quase não dá explicação em tela.

### 5. Blender 4
- **Link oficial:** <https://docs.blender.org/manual/en/latest/interface/window_system/introduction.html>
- **Densidade e hierarquia:** Espaço de trabalho por abas/etapas no topo (`Layout`, `Modeling`, etc.), barra de status enxuta no rodapé com dicas de mouse/teclado e painéis modulares.
- **Painéis / timeline:** Timeline no rodapé com playhead azul/laranja de leitura instantânea, keyframes visíveis e barra de propriedades lateral compacta.
- **Tema claro / escuro:** Cinza médio-escuro neutro (`#282828` / `#303030`) com divisões limpas e código cromático discreto por tipo de propriedade.
- **Tipografia:** Inter (adotada oficialmente no Blender 4) em escala compacta, legível em 1366 px.
- **Detalhe-assinatura:** Barra de status inferior que muda dinamicamente mostrando exatamente o que cada botão/atalho faz no contexto atual (ex.: no Clipes, mostrar `Alt: ajustar por quadro` na timeline).
- **O que evitar:** Excesso de ícones monocromáticos verticais difíceis de distinguir numa coluna estreita e janelas divididas arbitrariamente pelo usuário.

### 6. DaVinci Resolve
- **Link oficial:** <https://www.blackmagicdesign.com/products/davinciresolve>
- **Densidade e hierarquia:** Navegação macro em etapas fixas (Cut, Edit, Color, Deliver) que reduz o ruído mostrando só as ferramentas da etapa atual — exatamente alinhado às 3 macro-etapas do Clipes.
- **Painéis / timeline:** Viewer central dominante, timeline na metade inferior com playhead vermelho preciso e trilhas de vídeo (azul) e áudio (verde) com formas de onda claras.
- **Tema claro / escuro:** Cinza neutro escuro calibrado (~18% de luminância perceptiva) para que os olhos não se adaptem a uma cor dominante e julguem errado o vídeo.
- **Tipografia:** UI espartana em cinza claro sobre grafite médio, timecode grande e tabular logo abaixo do viewer.
- **Detalhe-assinatura:** Alças de corte e indicadores de *trim* com código visual direto e cabeçalho de player com timecode de entrada, duração e saída lado a lado.
- **O que evitar:** A rigidez de escala em telas pequenas (1366×768) onde painéis fixos do Resolve ficam apertados e fontes caem abaixo do legível.

### 7. Final Cut Pro
- **Link oficial:** <https://www.apple.com/final-cut-pro/>
- **Densidade e hierarquia:** Janela única com proporção equilibrada entre biblioteca/navegador à esquerda, player ao centro/direita, inspetor retrátil e timeline embaixo.
- **Painéis / timeline:** Timeline magnética onde áudio conectado (diálogo em azul-petróleo, música em verde) e marcadores ficam visualmente ligados ao clipe principal, com *skimmer* e playhead amarelo finíssimo.
- **Tema claro / escuro:** Escuro ardósia profundo com superfícies discretas que nunca brigam com as miniaturas coloridas na timeline.
- **Tipografia:** Tipografia de sistema em escala precisa para rótulos curtos e timecodes no centro acima da timeline.
- **Detalhe-assinatura:** Playhead fino amarelo de alta precisão que atravessa todas as faixas sem cobrir a forma de onda nem o texto abaixo dele.
- **O que evitar:** Esconder ações importantes atrás de atalhos ou menus de contexto sem indicação visual no Windows.

### 8. OBS Studio 30+
- **Link oficial:** <https://obsproject.com/>
- **Densidade e hierarquia:** O próprio usuário do Clipes já usa OBS para gravar ou fazer live; a barra de status no rodapé (`00:00:00`, CPU, FPS) e os botões de ação direta à direita são imediatamente familiares.
- **Painéis / timeline:** Painéis encaixáveis (*docks*) com cabeçalhos curtos e área de preview central dominante sobre fundo escuro.
- **Tema claro / escuro:** Tema padrão moderno (*Yami*) em grafite médio-escuro com azul/cinza contido de seleção.
- **Tipografia:** Sem serifa nativa direta, números tabulares nos medidores de áudio (`-60` a `0 dB`) e cronômetro de gravação.
- **Detalhe-assinatura:** Clareza absoluta de estado em repouso vs. em execução (botões claros no painel de controle + relógio tabular e indicador de carga na barra inferior).
- **O que evitar:** Aparência datada de widget genérico de desktop (caixas muito quadradas com contraste irregular entre cabeçalhos e controles).

### 9. Teenage Engineering (Field / EP-133 / Design de Produto)
- **Link oficial:** <https://teenage.engineering/>
- **Densidade e hierarquia:** Estética de "instrumento de bancada": grades explícitas, alinhamento matemático, zero decoração gratuita e cada controle com função tátil óbvia.
- **Painéis / timeline:** Divisões ortogonais nítidas entre áreas de entrada, leitura e ajuste; medidores e grades visuais secas em vez de curvas suaves de SaaS.
- **Tema claro / escuro:** Funciona brilhantemente nos dois extremos: alumínio/off-white técnico de dia e preto fosco anodizado à noite.
- **Tipografia:** Sans-serif funcional em caixa mista ou rótulos técnicos curtos combinados com fonte monoespaçada para códigos, tempos e parâmetros.
- **Detalhe-assinatura:** Uso cirúrgico de um único laranja-sinalização de hardware em controles críticos (playhead, gravação de Narração, ponto de corte ativo) sobre um oceano de cinzas puros.
- **O que evitar:** Radicalismo minimalista que remove rótulos em nome do visual — no Clipes, todo comando principal precisa ser autoexplicativo em PT-BR.

### 10. Things 3 (Cultured Code)
- **Link oficial:** <https://culturedcode.com/things/>
- **Densidade e hierarquia:** Referência de ouro em **tema claro** para produtividade: respiro generoso, agrupamento claro sem caixas aninhadas e foco absoluto na lista ativa.
- **Painéis / timeline:** Barra lateral discreta com ícones semânticos limpos e área principal que funciona como uma folha de trabalho organizada.
- **Tema claro / escuro:** Tema claro impecável (branco quente + cinza gelo suave na lateral) sem parecer ofuscante, além de modo escuro bem calibrado.
- **Tipografia:** Hierarquia tipográfica suave por peso e contraste de cinza (`fg`, `fg-2`, `fg-3`), sem precisar de caixas com borda em volta de cada item.
- **Detalhe-assinatura:** Abertura em linha de um item selecionado que ganha elevação sutil apenas enquanto é editado — ótimo padrão para revisão e edição rápida de título/descrição na lista de Cortes.
- **O que evitar:** Espaçamento excessivo de lista pessoal quando trazido para uma bancada de vídeo em 1366×768, onde precisamos enxergar vários Cortes, eixos de Nota e timeline ao mesmo tempo.

---

## Grupo 3 · Concorrentes diretos (6 referências — contraexemplo visual)

### 1. Opus Clip
- **Link oficial:** <https://www.opus.pro/>
- **Por que importa:** Líder de mercado no posicionamento de "1 clique -> 10 cortes virais"; é exatamente o visual ao qual o Clipes é comparado quando alguém procura alternativa local/open source.
- **O que levar:** Clareza na apresentação de grade comparando Fonte 16:9 no topo com os Cortes 9:16 gerados e badge numérico de Nota direto na miniatura.
- **O que evitar:** O rótulo opaco `SCORE 99` sem explicação, estética de funil web preto-brilhante com pílulas translúcidas e o ar de máquina automática que esconde custos e escolhas.

### 2. Vizard
- **Link oficial:** <https://vizard.ai/>
- **Por que importa:** Concorrente direto focado em podcasts e cortes com editor web integrado.
- **O que levar:** Transição direta entre lista de cortes sugeridos e edição de legenda/layout 9:16 no mesmo fluxo.
- **O que evitar:** Hero e interface com gradiente roxo-para-pêssego saturado, promessa de *"with AI magic"* e ícones de estrelinha/brilho (*sparkles*) em ações comuns.

### 3. Klap
- **Link oficial:** <https://klap.app/>
- **Por que importa:** Popular entre criadores de Shorts/Reels/TikTok por automatizar *reframe* e legendas dinâmicas.
- **O que levar:** Pré-visualização nítida do resultado 9:16 com indicação clara do enquadramento (ex.: tela dividida vs. rosto centralizado).
- **O que evitar:** Visual genérico de landing SaaS com selos coloridos de redes sociais flutuando e linguagem visual infantilizada de "colar link e esperar mágica".

### 4. Submagic
- **Link oficial:** <https://www.submagic.co/>
- **Por que importa:** Referência forte em estilização de legenda karaokê e B-roll para vídeos curtos.
- **O que levar:** Seletor visual de estilos de legenda fácil de entender sem expor parâmetros de `.ass` logo na primeira camada.
- **O que evitar:** Laranja brilhante com varinha mágica de estrela, botões com *glow* colorido e excesso de micro-selos (`AI Edit`, `Magic Clips`) competindo por atenção.

### 5. Captions (Mirage)
- **Link oficial:** <https://captions.ai/>
- **Por que importa:** Posiciona-se com estética mais "editorial/limpa" que os concorrentes roxos, tentando parecer estúdio moderno.
- **O que levar:** Tipografia mais cuidada na área de trabalho e cartões de estilo de vídeo limpos com preview real.
- **O que evitar:** Gradientes pastel atmosféricos no fundo da área de trabalho e caixa de prompt única tentando esconder o controle editorial por trás de um chat genérico.

### 6. Eklipse.gg
- **Link oficial:** <https://eklipse.gg/>
- **Por que importa:** Focado especificamente em streamers de Twitch, YouTube e Kick — o mesmo público de lives do Clipes.
- **O que levar:** Reconhecimento direto das plataformas de origem (Twitch / YouTube / Kick) e fluxo pensado para VODs de muitas horas (5h+).
- **O que evitar:** Gradiente laranja-para-roxo gamer/SaaS, estética de *loot box* / "epic clip in 60 seconds" e poluição visual de marketing dentro do workspace.

### Padrão comum dos concorrentes a evitar
Todos os 6 concorrentes compartilham uma fórmula visual de **SaaS de "AI magic"** que o Clipes deve rejeitar explicitamente:
1. **Paleta de gradiente roxo/violeta/laranja-neon** e *glows* em botões primários.
2. **Iconografia de varinha mágica, estrelas/sparkles e "AI" como substantivo** em rótulos e abas (`Magic Clips`, `AI Edit`, `AI magic`).
3. **Pontuação opaca** (ex.: `99` em gradiente verde/roxo) sem decomposição em eixos explicáveis nem justificativa na Transcrição.
4. **Cromo de aplicativo web/funil** (cards grandes arredondados, muito espaço vazio, menus rasos) em vez de **bancada desktop de produção** densa, neutra, controlável pelo teclado e honesta sobre custo e execução local.

---

## Tipografia (UI + algarismos tabulares em PT-BR, licença livre)

Todas as opções abaixo usam licença **SIL Open Font License (OFL 1.1)**, suportam acentuação completa do português (`á, à, â, ã, é, ê, í, ó, ô, õ, ú, ç`) e oferecem algarismos tabulares (`font-variant-numeric: tabular-nums` / recurso OpenType `tnum`) para evitar que timecodes (`00:12:48.14`) e contagens de custo/tokens "pulem" horizontalmente durante a reprodução.

| Opção | Papel | Fonte oficial | Pontos fortes para o Clipes | Atenção |
|---|---|---|---|---|
| **1. Inter + JetBrains Mono** | UI + Timecode/Kbd | [rsms.me/inter](https://rsms.me/inter/) · [jetbrains.com/lp/mono](https://www.jetbrains.com/lp/mono/) | Altura-x alta, legível em 12–13 px numa tela 1366×768; JetBrains Mono distingue `0/O`, `1/l/I` perfeitamente em timecodes e caminhos de arquivo. | Inter já é o padrão quase universal de apps dev (Linear, Blender 4); precisa de identidade nos tokens de cor e borda para não parecer genérica. |
| **2. Geist + Geist Mono** | UI + Timecode/Kbd | [vercel.com/font](https://vercel.com/font) | Desenho suíço seco, super alinhado à estética técnica/hardware; ótimo rendimento em pesos 400/500 e `tnum` nativo. | Personalidade mais "fria/engenharia"; funciona melhor em temas de alto craft minimalista. |
| **3. IBM Plex Sans + IBM Plex Mono** | UI + Timecode/Kbd | [fonts.google.com/specimen/IBM+Plex+Sans](https://fonts.google.com/specimen/IBM+Plex+Sans) | Equilíbrio raro entre precisão técnica ("máquina") e calor humano nos traços; excelente legibilidade na leitura longa da Transcrição e Roteiro em PT-BR. | Ligeiramente mais larga que a Inter; exige cuidado para caber rótulos +30% (futura tradução EN) em painéis de 260 px. |
| **4. Onest + JetBrains Mono** | UI + Timecode/Kbd | [fonts.google.com/specimen/Onest](https://fonts.google.com/specimen/Onest) | Híbrida geométrica-humanista pensada para leitura em tela e UI; trata cedilhas e acentos com cuidado notável e inclui `tnum`. | Menos conhecida em ferramentas de edição; tem tom mais amigável e menos "instrumento de estúdio". |
| **5. Plus Jakarta Sans + Geist Mono** | UI + Timecode/Kbd | [fonts.google.com/specimen/Plus+Jakarta+Sans](https://fonts.google.com/specimen/Plus+Jakarta+Sans) | Geométrica com aberturas amplas e personalidade criativa moderna (bom contraste entre títulos de etapa e texto corrido); `tnum` presente desde a v2.600. | Em tamanhos muito pequenos (11–12 px) é menos compacta que Inter ou IBM Plex; melhor se reservada a telas menos densas ou com escala base ≥ 13 px. |
| **6. Instrument Sans + IBM Plex Mono** | UI + Timecode/Kbd | [fonts.google.com/specimen/Instrument+Sans](https://fonts.google.com/specimen/Instrument+Sans) | Proporções ligeiramente condensadas que ajudam muito em barras superiores, tabelas de lotes e inspetor em 1366 px, com acentos PT-BR e `tnum`. | Menos pesos intermediários que a família Inter/IBM Plex. |

---

## Estratégias de cor para apps com vídeo em primeiro plano

Quando o usuário avalia cor de pele, enquadramento e contraste de legenda o dia inteiro, a interface ao redor do player não pode "tingir" a percepção visual nem competir com o vídeo:

1. **Cinza neutro calibrado + 1 acento cirúrgico (padrão DaVinci Resolve / Linear):**
   Superfícies puramente acromáticas (ou com saturação ≤ 0.01 em OKLCH) separadas por degraus de luminância de 3–5% e divisórias de 1 px. Um único acento (ex.: âmbar, ciano frio ou branco invertido) aparece apenas no playhead, no foco de teclado e na palavra/Corte selecionado.
2. **Grafite de bancada + código cromático funcional por faixa (padrão Final Cut Pro / Blender / Ableton):**
   O chassi permanece neutro, mas faixas e marcadores na timeline usam matizes contidos e padronizados (ex.: vídeo em azul-ardósia, diálogo/Transcrição em ciano-petróleo, Narração em verde-musgo ou âmbar) para identificação periférica rápida sem abrir texto.
3. **Instrumento tátil de alto contraste (padrão Teenage Engineering):**
   Base fosca muito limpa (preto-carvão ou cinza-alumínio claro) com bordas secas de 1 px e um único sinalizador de hardware (vermelho-laranja internacional de "REC / NO AR") para gravação, playhead e ação crítica. Zero gradientes, zero sombra difusa.
4. **Dual-theme estrutural (Escuro noturno "Cabine" + Claro diurno "Papel técnico"):**
   Mesmos tokens semânticos invertidos de forma calibrada (nunca branco puro `#FFFFFF` no tema claro, nem preto puro `#000000` no escuro) para alternar conforme a iluminação do quarto/escritório.

### Tema escuro vs. tema claro para quem trabalha à noite (notebook 1366–1920 px)
- **Tema escuro (padrão recomendado para a noite):**
  - *Prós:* Reduz drasticamente o ofuscamento da tela em ambiente com pouca luz; faz o vídeo (principalmente o quadro 9:16 com tarjas laterais no palco) saltar sem borda branca estourando a pupila; alinha-se ao hábito de quem já passa horas no OBS, Twitch e DaVinci.
  - *Contras:* Texto claro fino sobre preto puro (`#000000`) sofre *halation* (borrão luminoso em telas LCD/IPS baratas de notebook); painéis sem contraste suficiente de borda somem em notebooks com brilho baixo ou ângulo ruim. **Solução:** fundo de cabine entre `#101114` e `#181A1E` (nunca `#000`), texto principal em off-white (`~#ECEEF2`), e degrau claro entre canvas e painel.
- **Tema claro (alternativa necessária para dia / leitura longa):**
  - *Prós:* Superior para leitura prolongada de Transcrição, revisão de Roteiro e conferência de Empacotamento sob luz natural ou escritório iluminado; reduz cansaço de astigmatismo durante escrita.
  - *Contras:* À noite, uma janela de editor toda branca ofusca e faz o vídeo parecer mais escuro do que realmente é (o olho fecha a pupila por causa do fundo claro). **Solução:** oferecer alternância rápida (e atalho na paleta `Ctrl+K`), mantendo o tema claro em cinza-papel suave (`#F3F4F6` / `#E9ECEF`) com o **palco imediato atrás do vídeo** sempre em tarja escura neutra (*letterbox*).

---

## Matéria-prima para direções: 7 mundos visuais candidatos

Ordenados do **mais promissor** ao **menos promissor** para o front v2 do Clipes (sem escolha fechada; decisão final do dev e do coordenador).

### 1. Cabine de Transmissão (OBS + CazéTV / Placar ao Vivo)
Vem da sala de controle de live e dos grafismos esportivos/broadcast que o público de Cortes vê todo dia no OBS e nas transmissões ao vivo.
Fundo grafite neutro (`#121417` escuro / `#F2F4F7` claro), painéis por linha de 1 px, voz tipográfica seca com `Inter` + `JetBrains Mono` em timecodes tipo placar e um único acento vermelho-coral "No Ar" / ciano só em playhead, gravação e foco.
Risco: se badges e bordas de placar ficarem pesados ou numerosos demais, a tela ganha tensão de telejornal e cansa na revisão calma de texto.

### 2. Estúdio Calibrado (DaVinci Resolve + Linear)
Vem da união entre suítes profissionais de cor/edição de cinema e a precisão modular de aplicativos desktop de produtividade como Linear e Raycast.
Fundo cinza neutro calibrado sem viés quente nem frio (`#141416` escuro / `#F5F5F7` claro), elevação silenciosa por degraus de 3–4% de luminância, tipografia `Geist` ou `Inter` em escala apertada e assinatura de playhead fino + paleta `Ctrl+K` central.
Risco: parecer estéril ou "frio demais", repetindo a neutralidade do antigo "Foco" sem criar conexão cultural com quem vem do universo de lives e canais.

### 3. Instrumento de Bancada (Teenage Engineering + Ableton Live)
Vem da estética de hardware de áudio/vídeo e DAWs de estúdio: controles táteis, grades ortogonais claras e função evidente ao primeiro olhar.
Fundo preto-fosco ou alumínio claro (`#111213` / `#ECECEE`), divisões retangulares com cantos curtos (`3–4 px`), tipografia técnica (`IBM Plex Sans` + `IBM Plex Mono`) e laranja-sinalização cirúrgico só em alças ativas, playhead e botão de gravar Narração.
Risco: soar excessivamente técnico/audiófilo para editores iniciantes que querem apenas cortar uma live ou gerar legendas sem sentir que operam um sintetizador.

### 4. Mesa de Roteiro e Estúdio de Podcast (Flow/Podpah + Things 3 + Descript)
Vem da bancada do editor de podcast e de canais narrados, onde a fala transcrita e o Roteiro comandam a edição tanto quanto a linha do tempo.
Fundo carvão-estúdio levemente acolchoado (`#151413` escuro / `#F7F6F3` papel quente claro), tipografia humanista de alta legibilidade (`Onest` ou `IBM Plex Sans`), assinatura de marca-texto sutil na Frase/palavra ativa sincronizada ao vídeo e foco âmbar-tungstênio.
Risco: em telas de 1366×768, dar protagonismo excessivo ao bloco de texto pode encolher o palco 9:16 e a timeline multi-faixa na hora do ajuste fino.

### 5. Modo Teatro Noturno (Twitch Stream Manager + Raycast)
Vem do ambiente que streamers e editores de Corte deixam aberto madrugada adentro: player escuro dominante com colunas laterais compactas e comandos rápidos.
Fundo carvão profundo (`#0E0F12`), palco de vídeo sem bordas competidoras, listas densas com miniaturas 9:16 nítidas, `Inter` + `JetBrains Mono` com pílulas de tecla `<kbd>` sempre visíveis e acento índigo-frio bem contido apenas na seleção e foco.
Risco: qualquer deslize de saturação no índigo/violeta aproxima perigosamente o Clipes da estética roxa genérica dos concorrentes SaaS de "AI clips".

### 6. Sala de Montagem Cromática (Canais Dark — Kurzgesagt + Blender 4)
Vem da organização visual limpa de estúdios de animação/canais dark combinada à modularidade por áreas de trabalho do Blender 4.
Fundo ardósia escuro (`#181A1F`), barras e faixas da timeline com código cromático plano e contido por função (Vídeo, Fala, Narração, Legenda), tipografia geométrica firme (`Plus Jakarta Sans`) e barras secas de pontuação nos 5 eixos da Nota.
Risco: múltiplos matizes na timeline e nos cards de Nota criam ruído visual quando colocados ao lado de thumbnails e vídeos já muito coloridos.

### 7. Arena Alto Contraste (Kick + Overlays Gamers Contidos)
Vem do ecossistema de streams competitivas e pacotes de overlay de reação rápida: contraste máximo, geometria dura e leitura instantânea de estado.
Fundo quase preto (`#0B0D0E`), linhas nítidas de alta definição, cantos quase retos (`2–3 px`), `Instrument Sans` + `JetBrains Mono` ultra-compactos e acento verde-ácido ou ciano-elétrico restrito a contorno de foco e playhead.
Risco: alto risco de fadiga ocular (*halation*) em sessões noturnas longas em notebooks IPS e estética muito nichada em gaming, afastando Canais dark e outros nichos de conteúdo.

---

## Fontes consultadas

- Twitch: <https://www.twitch.tv/>
- YouTube Creators: <https://www.youtube.com/creators/>
- YouTube Shorts (Creators): <https://www.youtube.com/creators/create/shorts/>
- Kick: <https://kick.com/> · Central de Ajuda Kick: <https://help.kick.com/en/>
- CazéTV: <https://www.youtube.com/@CazeTV>
- Vizrt (Broadcast Graphics): <https://www.vizrt.com/>
- Flow Podcast: <https://www.youtube.com/@FlowPodcast> · Podpah: <https://www.youtube.com/@Podpah>
- Kurzgesagt: <https://www.youtube.com/@kurzgesagt> · <https://kurzgesagt.org/>
- Overlays.uno: <https://overlays.uno/library>
- Linear: <https://linear.app/>
- Raycast Press & Media Kit: <https://www.raycast.com/press>
- Figma Design: <https://www.figma.com/design/>
- Ableton Live: <https://www.ableton.com/en/live/>
- Blender Manual (Interface): <https://docs.blender.org/manual/en/latest/interface/window_system/introduction.html>
- DaVinci Resolve: <https://www.blackmagicdesign.com/products/davinciresolve>
- Final Cut Pro: <https://www.apple.com/final-cut-pro/>
- OBS Studio: <https://obsproject.com/>
- Teenage Engineering: <https://teenage.engineering/>
- Things 3 (Cultured Code): <https://culturedcode.com/things/>
- Descript (mencionado como referência complementar de edição por texto): <https://www.descript.com/>
- Opus Clip: <https://www.opus.pro/>
- Vizard: <https://vizard.ai/>
- Klap: <https://klap.app/>
- Submagic: <https://www.submagic.co/>
- Captions: <https://captions.ai/>
- Eklipse.gg: <https://eklipse.gg/>
- Fontes tipográficas (SIL OFL): Inter (<https://rsms.me/inter/>), Geist (<https://vercel.com/font>), JetBrains Mono (<https://www.jetbrains.com/lp/mono/>), IBM Plex Sans (<https://fonts.google.com/specimen/IBM+Plex+Sans>), Onest (<https://fonts.google.com/specimen/Onest>), Plus Jakarta Sans (<https://fonts.google.com/specimen/Plus+Jakarta+Sans>), Instrument Sans (<https://fonts.google.com/specimen/Instrument+Sans>).
