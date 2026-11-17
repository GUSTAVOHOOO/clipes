# Acessibilidade e linguagem visual de ferramentas de criação: pesquisa de UX para o front v2

**Resumo executivo:** Editores e ferramentas de criação de alta adoção convergem no tema escuro em tons de grafite (evitando `#000000` para reduzir halação), no palco de vídeo como centro imutável e na separação entre navegação por teclado de painéis (`F6`/`Tab`), controle de transporte (`J`/`K`/`L`, `Space`) e textos/índices estruturados (como o *Timeline Index* do Final Cut Pro ou o roteiro do Descript) que permitem operação por leitor de tela. Em contrapartida, a maioria dos editores tradicionais falha em WCAG 2.2 por manter texto pequeno sem escala independente, contrastes lavados ou atalhos de tecla única sem opção de desligar/remapear (SC 2.1.4). Para o Clipes, a pesquisa valida quase toda a base visual e técnica do padrão **Foco** (`design-system/` e `src/styles/` — tokens OKLCH, grafite quente, âmbar restrito a foco/playhead/seleção, Base UI, `contraste.ts`, `ListaVirtual`), mas aponta mudanças obrigatórias antes da v2: mecanismo para desligar/remapear atalhos de letra única, alternativa textual estruturada à timeline para leitores de tela, modo de alto contraste opcional, prevenção de colisão entre gavetas flutuantes e foco (SC 2.4.11) e eliminação de jargão técnico nos textos voltados a iniciantes.

---

## Ferramentas analisadas e por que

A seleção combina editores de vídeo profissionais e populares (desktop e web), um editor guiado por Transcrição, o principal gerador automático de Cortes do mercado e uma ferramenta de criação baseada em canvas com suporte avançado de acessibilidade. Todas têm adoção massiva documentada por fontes públicas.

| Ferramenta | Plataforma | Público | Evidência de uso (com fonte) | Modelo de preço |
|---|---|---|---|---|
| **CapCut (Desktop / Web)** | Desktop (Win/macOS), Web, Mobile | Criadores de vídeo curto, iniciantes e editores sociais | **>323 milhões** de usuários ativos mensais (MAU) e **>1 bilhão** de downloads acumulados entre plataformas [1][2] | Freemium: plano gratuito (exportação sem marca d'água se sem recursos Pro); **CapCut Pro** (~US$ 19,99/mês) [3][4] |
| **Adobe Premiere Pro** | Desktop (Win/macOS) | Editores profissionais, agências, criadores e empresas | Estimado em **~30 milhões** de usuários; ~47% da base corporativa em empresas >10 mil funcionários [5][6] | Assinatura Creative Cloud: app avulso (~US$ 23,99/mês individual; US$ 37,99+/mês equipes) ou pacote All Apps [5][7] |
| **Figma** | Desktop (Electron Win/macOS), Web | Designers, PMs, devs (2/3 dos MAUs são não-designers) | **>13 milhões** de MAUs e **~690 mil** clientes pagos em 31/03/2026 (prospecto S-1 / relatórios corporativos); 95% da Fortune 500 [8] | Freemium por assento: Starter gratuito; Professional (US$ 16/mês anual por Full seat), Organization (US$ 55/mês), Enterprise (US$ 90/mês) [9] |
| **Opus Clip** | Web (`clip.opus.pro`), Mobile (iOS/Android limitado) | Criadores de Cortes e podcasts reutilizando vídeos longos | **>10 milhões** de usuários registrados e centenas de milhões de Cortes gerados [10][11] *(ver inventário em `2026-11-12-opusclip-feature-inventory.md`)* | Freemium por créditos (1 crédito = 1 min de Fonte): Free (60 cr, marca d'água), Starter (US$ 15/mês, 150 cr), Pro (US$ 29/mês, 300 cr), Business [12][13] |
| **Descript** | Desktop (Electron Win/macOS), Web | Podcasters, criadores, marketing e equipes de vídeo falado | **>6 milhões** de criadores e equipes (incluindo Apple, Spotify, NYT, HubSpot) [14][15] | Freemium por horas de mídia + créditos de IA: Free (60 min/mês, 720p com marca), Hobbyist (US$ 16/mês anual), Creator (US$ 24/mês), Business (US$ 50/mês) [16] |
| **DaVinci Resolve** | Desktop (Win/macOS/Linux), iPadOS | Editores, coloristas, pós-produção de áudio e YouTubers | **>5,4 milhões** de usuários acumulados (Blackmagic Design) [17][18] | Gratuito completo (até 4K 60 fps, sem marca d'água); **Studio** licença perpétua de **US$ 295** [18][19] |
| **Final Cut Pro** | Desktop (macOS), iPadOS | Editores solo, YouTubers e produtoras no ecossistema Apple | Marco público de **>2 milhões** de usuários pagos no FCP X e participação consolidada entre NLEs em macOS [20][21] | Compra única perpétua de **US$ 299,99** (Mac App Store) ou via assinatura Apple Creator Studio [21][22] |

### Normas, guias de plataforma e design systems consultados

Além dos produtos acima, a análise usa as normas e sistemas públicos que regem apps desktop modernos e editores criativos:

| Referência | Escopo na pesquisa | Fonte |
|---|---|---|
| **WCAG 2.2 (W3C)** | Critérios normativos aplicáveis a app desktop em WebView (contraste, foco, tamanho de alvo, atalhos de tecla única, movimento reduzido, legendas e mensagens de status) | [23][24] |
| **WAI-ARIA APG** | Padrões de teclado e semântica para `slider`, `grid`, `treegrid`, `listbox`, `tabs`, `toolbar` e `dialog` | [25] |
| **Adobe Spectrum** | Sistema de design de ferramentas criativas (Premiere Pro): paletas perceptuais no escuro (Leonardo), elevação sem perda de contraste e tema *Darkest* | [26][27] |
| **Microsoft Fluent 2** | Arquitetura de tokens semânticos (*alias tokens*), adaptação de saturação/luminância no modo escuro e cores de estado acessíveis no Windows | [28][29] |
| **Apple HIG** | Modo escuro nativo, redução de transparência, aumento de contraste e comportamento esperado de apps desktop no macOS | [30][31] |
| **GNOME HIG** | Preferência de estilo escuro (*dark style preference*), navegação integral por teclado e nomes acessíveis para leitores de tela no Linux (WebKitGTK) | [32][33] |
| **NN/g (Nielsen Norman Group)** | Evidências sobre polaridade negativa (modo escuro), halação/astigmatismo e interfaces densas para usuários avançados | [34] |
| **Base UI (`@base-ui/react`) / shadcn** | Base técnica de primitivas acessíveis sem estilo acoplado adotada pelo Clipes em `design-system/` | [35] |

---

## Ferramenta por ferramenta

### 1. DaVinci Resolve (Blackmagic Design)

* **Estrutura de navegação:** Organizada por **"Páginas"** fixas numa barra inferior horizontal (atalhos `Shift+2` a `Shift+8`): *Media* (ingestão), *Cut* (corte rápido/social), *Edit* (timeline multipista), *Fusion* (VFX em nós), *Color* (gradação), *Fairlight* (áudio DAW) e *Deliver* (exportação) [18][36][37]. A troca de página muda todo o conjunto de painéis sem abrir novas janelas.
* **Fluxo da etapa de edição e revisão:** Na página *Cut* ou *Edit*, o usuário importa mídias no *Media Pool*, carrega no *Source Viewer*, define Entrada/Saída (`I`/`O`), insere na timeline (`F9`/`F10`), refina cortes com *Blade* (`B`) ou apara bordas e vai à página *Deliver* (`Shift+8`) para configurar formato, clicar em *Add to Render Queue* e depois em *Render All* [36][37].
* **Layout:** Cinza grafite muito escuro em toda a interface, divisores finos de 1 px e alta densidade de controles. Na página *Edit*: *Media Pool/Effects* à esquerda, *Source* e *Timeline Viewer* lado a lado no topo central, *Inspector* à direita e *Timeline* multipista ocupando toda a largura inferior. Na *Cut*: exibe uma *Source Tape* + timeline dupla (visão global acima, detalhe abaixo).
* **Trabalho longo (progresso, fila, notificação):** Na página *Deliver*, a *Render Queue* fica no canto superior direito mostrando lista de jobs enfileirados, barra de progresso por item, taxa de quadros de renderização, tempo decorrido e tempo restante [37].
* **Estados vazio / carregando / erro:** Na *Deliver*, quando não há jobs na *Render Queue*, o painel permanece vazio e a área da barra de progresso fica oculta até o usuário clicar em *Add to Render Queue* [37]. Erros de renderização ou mídia offline aparecem com destaque em vermelho (*Media Offline* sobre o quadro no viewer).
* **Atalhos, teclado e acessibilidade:** Possui *Keyboard Customization* completo (`Option+Cmd+K` / `Alt+Ctrl+K`) com mapa visual do teclado, busca de comandos, presets de outros editores (Premiere, FCP, Avid) e perfis salvos — porém os atalhos são dependentes da página ativa e ações da *Deliver* têm menos atalhos padrão mapeados [36][37]. Não oferece suporte consistente a leitores de tela (NVDA/VoiceOver) nem modo de alto contraste na UI [38][39].
* **O que usuários elogiam e reclamam:** Elogiam o nível profissional gratuito sem marca d'água, a separação clara por páginas e a integração com hardware dedicado (*Speed Editor*) [18]. Reclamam fortemente em `r/davinciresolve` e `r/Blind` da **incompatibilidade com leitores de tela**, do **contraste baixo da UI escura**, de ícones e textos minúsculos na barra de páginas e da falta de escalonamento acessível [38][39][40].

### 2. Adobe Premiere Pro

* **Estrutura de navegação:** Baseada em **Workspaces** comutáveis no topo ou menu *Window* (*Assembly*, *Editing*, *Color*, *Effects*, *Audio*, *Captions & Graphics*), onde painéis acopláveis (*dockable*) podem ser reorganizados, maximizados (`` ` `` / til) ou flutuantes [41].
* **Fluxo da etapa de edição e acessibilidade:** O usuário organiza mídias no *Project Panel*, pré-visualiza no *Source Monitor* (`I`/`O`), monta no *Timeline* e acompanha no *Program Monitor*; para legendas/Transcrição, usa o painel *Text* (transcrição automática, edição de texto e conversão em legendas) [41]. A navegação por teclado alterna foco entre painéis (`Shift+1..9` ou atalhos de foco de painel) para evitar cliques repetitivos [42].
* **Layout:** Modernizado sobre o design system **Adobe Spectrum**, com separação em camadas (*Base*, *Layer 1*, *Layer 2*) e destaque para o *Program Monitor* [26][43]. Os botões de ação primária usam azul Spectrum apenas nos pontos de confirmação (ex.: botão de exportação), mantendo o restante em neutros frios.
* **Trabalho longo:** O painel **Progress** (e *Progress Dashboard*) centraliza tarefas em segundo plano — geração de proxies, transcrição *speech-to-text*, conformação de áudio e renderização — com barras de progresso e cancelamento sem travar a timeline [44].
* **Estados vazio / carregando / erro:** Painéis sem sequência aberta exibem área escura neutra com aviso simples (ex.: *No Sequence* no *Program Monitor*); erros críticos de mídia e GPU abrem alertas modais ou badges de *Events* no rodapé.
* **Atalhos, teclado e acessibilidade:** Referência de mercado em **J / K / L** (rebobinar / pausar / avançar em velocidades múltiplas) e mapeamento completo em `Edit > Keyboard Shortcuts` com teclado visual e busca [42]. Na aparência (`Preferences > Appearance`), o Premiere Pro com Spectrum introduziu três temas (**Darkest**, **Dark**, **Light**) e um **interruptor específico de acessibilidade/contraste** para alternar entre UI ultra-escura (foco em cor) e UI de maior contraste para legibilidade [43][45]. Ainda assim, a documentação oficial reconhece suporte limitado a leitores de tela em áreas gráficas complexas [46].
* **O que usuários elogiam e reclamam:** Elogiam o poder dos atalhos de transporte (`J`/`K`/`L`), a flexibilidade dos painéis e a transcrição integrada. Reclamam no Reddit e fóruns Adobe que o tema Spectrum deixou botões (como *Quick Export*) com **contraste "lavado"** parecendo desabilitados, que textos de interface pequenos (ex.: corpo 8) causam fadiga visual e astigmatismo e que faltam leitores de tela plenos para timeline e escopos [47][48][49].

### 3. Apple Final Cut Pro

* **Estrutura de navegação:** Janela única integrada no macOS com alternância por seletores de barra superior: *Browser* (bibliotecas e eventos à esquerda), *Viewer* (player central), *Inspector* (propriedades à direita) e *Timeline* (abaixo), além do **Timeline Index** recolhível à esquerda da timeline [50][51].
* **Fluxo da etapa de edição e acessibilidade:** O usuário seleciona trechos no *Browser* (`I`/`O`), anexa à história principal na **Magnetic Timeline** (`E` para *append*, `W` para *insert*, `Q` para *connect*), ajusta cortes e abre o **Timeline Index** para localizar clipes, marcadores, papéis de áudio (*Roles*) ou legendas por busca textual [50][51]. Para narração direta, usa a janela *Record Voiceover* (`Option+Shift+A`) com contagem regressiva e seleção de entrada [52].
* **Layout:** Segue a **Apple HIG** para apps Pro: fundo grafite neutro muito escuro sem distrações cromáticas, tipografia SF Pro com números tabulares em timecodes e grande proporção de área dedicada ao *Viewer* e à *Magnetic Timeline* [30][50].
* **Trabalho longo:** A janela **Background Tasks** (`Cmd+9`) mostra um indicador circular discreto na barra superior (que preenche conforme o percentual) e, ao abrir, lista renderização, transcodificação, análise e compartilhamento em paralelo com botões individuais de pausa/cancelamento [53].
* **Estados vazio / carregando / erro:** Biblioteca sem eventos ou timeline sem clipe exibe instruções concisas centralizadas; tarefas falhas aparecem com ícone de alerta vermelho na *Background Tasks*.
* **Atalhos, teclado e acessibilidade:** Possui o **Command Editor** (`Option+Cmd+K`), um mapa gráfico interativo com busca, códigos de cor por categoria de comando e suporte a múltiplos conjuntos salvos [54][55]. O diferencial mais importante de acessibilidade é a integração profunda com o **VoiceOver** do macOS (`Cmd+F5`) combinada ao **Timeline Index**: como o *Timeline Index* lista todos os clipes, marcadores e papéis em formato tabular/textual navegável por teclado, usuários cegos ou com baixa visão conseguem auditar e saltar para qualquer ponto da edição sem depender da manipulação espacial da timeline [51][56].
* **O que usuários elogiam e reclamam:** Elogiam a velocidade no Apple Silicon, a produtividade do *Command Editor* e a agilidade da *Magnetic Timeline* para criadores solo [20]. Reclamam da ausência de colaboração multiusuário nativa robusta e de pequenas inconsistências de atalhos entre apps da própria Apple (Final Cut, Motion, Pixelmator) [57][58].

### 4. CapCut (Desktop)

* **Estrutura de navegação:** Tela inicial (*Home*) com projetos recentes, modelos e botão destacado `+ Create project`; ao abrir um projeto, entra na janela única do editor dividida em quatro quadrantes fixos [4][59].
* **Fluxo da etapa de edição:** Importa mídia no painel superior esquerdo (*Media*), arrasta para a timeline inferior, aplica corte (`Ctrl+B`/`Cmd+B`), navega quadro a quadro (`←`/`→`), ajusta propriedades no *Inspector* superior direito (vídeo, áudio, velocidade, legendas) e clica em *Export* no canto superior direito [59][60].
* **Layout:** Fundo cinza-chumbo escuro com acento ciano/turquesa nos controles ativos e botões de exportação; top-left para abas verticais de biblioteca (*Media*, *Audio*, *Text*, *Stickers*, *Effects*, *Transitions*, *Captions*), top-center para o *Player* com seletor de proporção (16:9 / 9:16), top-right para o *Inspector* e metade inferior inteira para a timeline multipista [4][59].
* **Trabalho longo:** Exportação abre diálogo modal com barra de progresso percentual, tamanho estimado e prévia do quadro; efeitos de IA pesados exibem barras locais e avisos amarelos na timeline quando segmentos ainda não foram pré-renderizados [61].
* **Estados vazio / carregando / erro:** Tela inicial amigável para iniciantes com área de soltar arquivos clara; porém, durante a edição, trechos não cacheados exibem avisos como *"This part is not rendered and may lag during preview"* [61].
* **Atalhos, teclado e acessibilidade:** Traz atalhos comuns (`Space`, `Ctrl/Cmd+B`, `←`/`→`), mas com **customização limitada** e sem painel simultâneo de consulta de atalhos enquanto edita [60][62]. Um problema crítico de acessibilidade relatado por usuários é a **ausência de escala independente de texto da UI**: em monitores 4K, a interface fica minúscula e só aumenta forçando a escala global do sistema operacional [63].
* **O que usuários elogiam e reclamam:** Elogiam a curva de aprendizado imediata para iniciantes e legendas automáticas rápidas [4]. Reclamam da rigidez dos painéis (não desacopláveis), do texto pequeno sem zoom de UI, de engasgos de preview sem cache e da migração crescente de recursos básicos para trás do paywall *CapCut Pro* [61][63][64].

### 5. Descript

* **Estrutura de navegação:** Workspace de projetos na entrada e tela de edição em torno da **Composição**: barra lateral esquerda estreita para cenas/arquivos/elementos, painel central de **Transcrição/Roteiro** (como um editor de texto), palco/canvas de vídeo à direita e timeline expandida opcional na base (`Ctrl+Alt+T` / `Ctrl+Option+T`) [65][66].
* **Fluxo da etapa de edição:** O usuário solta o vídeo, aguarda a Transcrição automática, lê e edita diretamente o texto (apagar uma palavra ou parágrafo corta o vídeo; corrigir ortografia muda só a legenda), aplica remoção de silêncios/vícios de fala em lote, abre a timeline inferior apenas para ajustes finos e exporta [16][67].
* **Layout:** Diferente dos NLEs tradicionais, historicamente usou tema claro ou escuro mais limpo estilo produtividade/documento, destacando o **texto falado** ao lado do canvas de vídeo, com inspeção de propriedades na barra lateral direita e timeline recolhível por padrão para reduzir a carga visual de iniciantes [66][67].
* **Trabalho longo:** Barras de progresso inline para transcrição, sincronização na nuvem, tarefas de IA (*Underlord*) e renderização de exportação [16].
* **Estados vazio / carregando / erro:** Estados vazios muito bem resolvidos para iniciantes, com ações diretas (*"Drop files here to transcribe"*, *"Record"*, *"Write"*) reduzindo a paralisia da tela em branco [16].
* **Atalhos, teclado e acessibilidade:** Lista de atalhos acessível por `Ctrl+/` (Windows) ou `Option+/` (Mac) [65]. Como o foco pode estar no **editor de texto** (onde letras digitam texto) ou na **timeline/canvas**, o Descript separa modos (`Ctrl+E` *Write mode*, `Alt+C` *Correct text mode*) e usa teclas seguradas + clique (`Z` capitalizar, `X` pontuação, `C` corrigir) ou ferramentas de tecla única (`A`, `R`, `B`, `S`) **apenas quando a caixa de texto não está ativa**, além de `Shift+J/K/L` para velocidade [66][68]. Apesar do paradigma textual ajudar muito na revisão rápida, usuários com leitor de tela ainda enfrentam barreiras na manipulação do canvas visual e da timeline em app Electron [não confirmado em docs oficiais; inferido a partir da arquitetura Electron/canvas].
* **O que usuários elogiam e reclamam:** Elogiam o ganho brutal de velocidade na edição baseada em Transcrição e a limpeza de áudio/pausas [69]. Reclamam no Reddit (`r/podcasting`) e G2 de **mudanças frequentes e abruptas de layout/nomes de ferramentas** entre atualizações (quebrando memória muscular), lentidão em vídeos longos e padrões de IA que sobrescrevem ajustes manuais [70][71].

### 6. Opus Clip

* *(Complementa os inventários de produto e runtime já existentes em `docs/research/2026-11-12-opusclip-feature-inventory.md`, `2026-11-12-opusclip-runtime-evidence.md` e `2026-11-12-rea-vizard-vidiq.md`.)*
* **Estrutura de navegação:** Fluxo linear em 3 momentos no navegador (`clip.opus.pro`): (1) **Dashboard / Submissão** (colar URL ou subir arquivo + configurar duração/prompt/Brand Kit), (2) **Resultados do Projeto** (lista ou grade de Cortes ordenados por *Virality Score* com explicação resumida), (3) **Editor do Corte** dedicado para ajuste de texto, layout e timeline [12][13]. Nos apps móveis (iOS/Android), o editor é ausente ou capado, redirecionando o usuário ao desktop web [13].
* **Fluxo da etapa de edição:** Na lista de resultados, o usuário assiste à prévia em baixa resolução, confere o score, entra no editor de um Corte, corrige palavras ou apaga trechos na Transcrição, alterna layouts (Fill/Fit/Split/Gameplay), ajusta bordas na timeline e exporta ou agenda [13][72].
* **Layout:** Tema escuro padrão de SaaS de vídeo, com cards de Corte na página de resultados (preview 9:16 + score + transcrição lateral) e, no editor, painel esquerdo de Transcrição/ferramentas, player 9:16 central e timeline inferior [12][72].
* **Trabalho longo:** Processamento assíncrono em fila na nuvem com estimativa/barra de progresso no dashboard e **notificação por e-mail** quando o projeto termina (configurável) [13].
* **Estados vazio / carregando / erro:** Projetos gratuitos expiram em 3 dias; durante falhas de exportação em lote, oferece retentativa por arquivo; erros de fila em horários de pico são queixa recorrente [13][73].
* **Atalhos, teclado e acessibilidade:** Oferece o conjunto *Keyboard Precise Editing* (`D` / `Cmd+B` para dividir, `←`/`→` por quadro, `Backspace` para apagar, `S` para *snap*, `+`/`-` para zoom na timeline) [74]. Não documenta suporte a leitor de tela, modo de alto contraste nem remapeamento de atalhos.
* **O que usuários elogiam e reclamam:** Elogiam a triagem rápida com nota e o fluxo simples de "link → Cortes prontos" [12]. Reclamam no Trustpilot e Reddit de **atalhos limitados e edição manual travada** frente a NLEs desktop, cobrança de créditos por minuto inteiro no envio (mesmo se descartar os Cortes) e filas/erros de renderização em 1080p/4K [12][73].

### 7. Figma

* **Estrutura de navegação:** Navegador de arquivos (*File Browser*) em grade/lista -> Editor com barra superior de ferramentas, painel esquerdo (*Layers / Assets / Pages*), **Canvas infinito** central, painel direito de propriedades (*Design / Prototype*) e menu rápido **Actions** (`Cmd+K` / `Ctrl+K`) [75].
* **Fluxo relevante (navegação acessível em app gráfico complexo):** Para operar sem mouse, o usuário usa `F6` (Mac) ou `Ctrl+F6` (Windows) para saltar entre regiões macro da UI (menu principal, barra superior, painel esquerdo, canvas, inspetor direito), `Tab` para controles internos, `Enter` / `Shift+Enter` para entrar/sair de camadas aninhadas e `Cmd/Ctrl+K` para acionar qualquer comando pelo nome [75].
* **Layout:** Tema escuro em grafite neutro (ou claro), baixíssimo ruído decorativo, divisórias finas de 1 px e destaque cromático restrito à seleção e ao modo ativo, deixando o conteúdo do canvas como protagonista.
* **Trabalho longo:** Indicadores discretos de sincronização/salvamento na barra superior e notificações *toast* no rodapé central para exportações ou operações em lote.
* **Estados vazio / carregando / erro:** Esqueletos de carregamento no navegador de arquivos, avisos claros quando fontes locais faltam e estados vazios instrutivos nas abas de componentes/protótipo.
* **Atalhos, teclado e acessibilidade:** Referência de acessibilidade para apps Web/Electron gráficos:
  1. Modal dedicada de **Accessibility settings** acessível via `F6`/`Ctrl+F6` -> *Preferences* -> *Accessibility settings* [75].
  2. **Enhanced contrast for the Figma UI** (funciona tanto no tema claro quanto no escuro) [75][76].
  3. **Opção para ignorar atalhos próprios do Figma em campos de texto** e simplificar navegação por foco no menu de ações (`Cmd+K`) [75].
  4. **Modo de leitor de tela (VoiceOver, NVDA, JAWS)** em protótipos e árvore de acessibilidade traduzida do canvas para semântica HTML acessível via botão *Skip to content* [77].
* **O que usuários elogiam e reclamam:** Elogiam o `Cmd+K`, a consistência visual do modo escuro, o foco claro por `F6` e o contraste aprimorado [75][76]. Reclamam quando plugins ou arquivos muito densos reduzem a legibilidade ou quando elementos exclusivamente visuais no canvas não recebem anotações de leitura sem esforço manual [78].

---

### Normas, guias de plataforma e design systems de referência

#### O que a WCAG 2.2 exige de um app desktop em WebView (como o Clipes no Tauri)

Embora o Clipes seja um app desktop empacotado com Tauri, a interface roda dentro de uma WebView (WebView2 no Windows, WKWebView no macOS, WebKitGTK no Linux) e precisa seguir a **WCAG 2.2 (níveis A e AA)** [23]:

| Critério WCAG 2.2 | Nível | Exigência concreta | Impacto direto em editor de mídia / WebView |
|---|---|---|---|
| **1.4.1 Use of Color** | A | Cor não pode ser o único meio visual de transmitir informação, ação ou estado | Estados de Corte (`aprovado`/`rejeitado`/`ajustado`), job rodando, erro e palavra de baixa confiança precisam de ícone, texto ou padrão (ex.: hachura) |
| **1.4.3 Contrast (Minimum)** | AA | Texto normal ≥ **4,5:1**; texto grande (≥18 pt ou ≥14 pt bold) ≥ **3:1** | Vale inclusive para texto terciário (`fg-3`), timestamps e texto sobre faixas da timeline |
| **1.4.11 Non-text Contrast** | AA | Bordas de controles, ícones informativos e componentes gráficos (alças, playhead, waveform, foco) ≥ **3:1** contra o fundo adjacente | Em UI escura, contornos de checkbox, botões secundários, alças da timeline e foco não podem sumir no grafite |
| **2.1.1 Keyboard** | A | Toda funcionalidade operável via teclado sem exigir tempo específico por tecla | Timeline (alças Entrada/Saída, playhead), recorte 9:16, seleção em lote e menus precisam de interação integral por teclado |
| **2.1.4 Character Key Shortcuts** | A | Se um atalho usa **apenas** letra, número ou pontuação (sem `Ctrl`/`Alt`/`Meta`), deve poder ser: (1) **desligado**, (2) **remapeado** com modificador, ou (3) **ativo apenas quando o componente tem foco** [24] | Atalhos globais de letra única (`C`, `T`, `L`, `F`, `A`, `X`, `S`, `J`, `K`, `1..4`, `[`, `]`) disparam comandos acidentais para usuários de ditado por voz ou controle motor se não forem desligáveis/remapeáveis |
| **2.3.3 Animation from Interactions** | AAA *(boa prática AA)* | Animações disparadas por interação devem poder ser desativadas (respeito a `prefers-reduced-motion`) | Gavetas deslizantes, transições de abas e pulsações de skeleton devem virar fade curto ou troca instantânea |
| **2.4.7 Focus Visible** | AA | Qualquer controle operável por teclado tem indicador de foco visível | O WebKitGTK (Linux) desenha outline quadrado feio ou suprime em certos controles; anel consistente via `:focus-visible` é obrigatório |
| **2.4.11 Focus Not Obscured (Minimum)** | AA | *(Novo na 2.2)* Ao receber foco por teclado, o item não pode ficar **totalmente** encoberto por barras fixas, gavetas flutuantes ou toasts [23] | Gavetas flutuantes (`GavetaBorda`) ou barras fixas nunca podem cobrir um botão focado atrás delas |
| **2.4.13 Focus Appearance** | AAA *(referência)* | Espessura ≥ 2 CSS px e contraste ≥ 3:1 entre estado focado e não focado [23] | O anel âmbar de 2–3 px com offset contrasta bem no grafite, mas precisa de verificação no tema claro |
| **2.5.8 Target Size (Minimum)** | AA | *(Novo na 2.2)* Alvos de ponteiro devem ter pelo menos **24 × 24 CSS px** (ou espaçamento equivalente) [23] | Alças da timeline, botões de apagar keyframe, palavras clicáveis na Transcrição e ícones compactos precisam atingir ≥ 24 px |
| **4.1.2 Name, Role, Value** | A | Todo controle customizado expõe papel, rótulo acessível e estado atualizado para leitores de tela | Alças/playhead (`role="slider"` com `aria-valuetext`), switches, tabs e botões de ícone só com símbolo |
| **4.1.3 Status Messages** | AA | Mensagens de status (progresso de job, exportação concluída, erro de validação) anunciadas sem roubar foco (`role="status"` / `aria-live="polite"`, e `role="alert"` só para erro urgente) | Nunca usar `role="alert"` para progresso normal, nem `role="status"` silencioso para falha crítica |
| **1.2.1–1.2.5 Media** | A/AA | Transcrição/legendas para áudio e vídeo | O Clipes já gera Transcrição e legenda — ela também serve como apoio cognitivo e auditivo para o próprio operador |

#### Padrões WAI-ARIA APG essenciais para editores de mídia [25]

1. **`slider`**: Aplicável às alças de Entrada/Saída, ao playhead da timeline e ao centro de recorte 9:16. Exige `tabindex="0"`, `aria-valuemin`, `aria-valuemax`, `aria-valuenow` e **`aria-valuetext` legível** (ex.: `"00:14.200 da Fonte"` em vez de microssegundos brutos). Teclado padrão APG: `←`/`↓` diminui passo fino, `→`/`↑` aumenta passo fino, **`PageUp`/`PageDown` faz passo grande** (ex.: 1 Frase ou 5 s), `Home`/`End` vai aos extremos.
2. **`toolbar`**: Barra de transporte/ferramentas (Play/Pause, +1/-1 Frase, Zoom, Remover silêncios). Ocupa **apenas uma parada de `Tab`** no fluxo da página; internamente usa *roving tabindex* com `←`/`→`.
3. **`tabs` (`tablist`, `tab`, `tabpanel`)**: Abas das ferramentas do Corte (Transcrição, Legenda, Enquadrar, Áudio) e seções de Configurações. Setas alternam entre abas; `Home`/`End` vão à primeira/última; `Tab` entra direto no conteúdo do `tabpanel`.
4. **`listbox`**: Listas selecionáveis longas (Cortes, perfis, presets de legenda). Uma parada de `Tab`, `↑`/`↓`/`Home`/`End` movem a opção ativa (via `aria-activedescendant` em listas virtualizadas como `ListaVirtual`), `Space` marca seleção múltipla quando aplicável.
5. **`grid` / `treegrid`**: Tabelas interativas com múltiplas colunas clicáveis por linha — caso típico da **fila de jobs (`Jobs`)**, **Lotes de Fontes** (Fonte pai expandível -> etapas filhas em `treegrid`), **tabela de Tarefas de IA** (Provedor / Custo / Somente local) e lista de Cortes quando houver ações em colunas. Permite navegação 2D (`↑`/`↓`/`←`/`→`) sem poluir a ordem de `Tab` com dezenas de botões por linha.
6. **`dialog` / `alertdialog`**: Modais de confirmação destrutiva (excluir áudio, restaurar backup, cancelar lote pago) e paleta de comandos (`Ctrl+K`). Exigem *focus trap* completo (incluindo `<textarea>`), `Escape` para fechar, fundo `inert` e retorno garantido do foco ao gatilho original.

#### Linguagem visual nos guias e design systems (Spectrum, Fluent 2, Apple HIG, GNOME HIG)

* **Tema escuro não é `#000000`:** Tanto a pesquisa da **NN/g** [34] quanto o **Adobe Spectrum** [26][27] e o **Apple HIG** [30] recomendam fundos em cinza grafite escuro (evitando preto puro para não gerar **halação** — efeito de brilho/borramento em texto branco que prejudica pessoas com astigmatismo) e texto em branco suavizado (off-white) que ainda atinge ≥ 4,5:1.
* **Elevação por degrau de luminância + borda de 1 px:** No modo claro a sombra define camadas; no modo escuro, **Adobe Spectrum** usa camadas progressivamente mais claras do fundo para a frente (*Base → Layer 1 → Layer 2*) combinadas a **bordas sutis de 1 px** e sombras 3× mais opacas apenas em popovers/diálogos [26][43].
* **Cor como estado, nunca decoração:** **Fluent 2** e **Spectrum** reservam cores semânticas (vermelho erro, âmbar atenção, verde sucesso, azul info) exclusivamente para estados e feedback, ajustando saturação e luminância no escuro para evitar vibração cromática e garantir contraste em badges e textos [26][28].
* **Respeito ao sistema operacional:** **GNOME HIG** trata o escuro como preferência de sistema (*dark style preference*) e **Apple HIG** desaconselha forçar aparência ignorando o SO [30][33]; porém, editores de vídeo oferecem preferência própria com padrão escuro + opção clara/sistema e modo de alto contraste (como Premiere *Darkest/Dark/Light* + contraste acessível e Figma *Enhanced Contrast*) [43][75].

---

## Padrões recorrentes

1. **Tema escuro em grafite neutro com o vídeo como única fonte de cor saturada:** DaVinci Resolve, Premiere Pro, Final Cut Pro, CapCut e Opus Clip usam superfícies grafite/chumbo de baixo croma para que o olho avalie corretamente o vídeo e a legenda, mantendo apenas um acento contido para seleção, playhead e foco (validado por Adobe Spectrum e NN/g) [26][34][43].
2. **Hierarquia espacial de "palco central + timeline embaixo + ferramentas nas bordas":** Cinco dos seis editores analisados ancoram o player no centro/topo e a timeline na base com largura total; o Descript inverte a ênfase colocando a Transcrição no centro e recolhendo a timeline por padrão (`Ctrl+Alt+T`) para iniciantes, mas preserva o mesmo eixo player + texto + timeline [59][66].
3. **Transporte universal `Space` e `J`/`K`/`L` + navegação por quadro (`←`/`→`):** Todo NLE profissional (Premiere, Final Cut, DaVinci) usa `J`/`K`/`L` para velocidade/direção e setas para microajuste, e até editores web/simplificados (Descript, Opus Clip, CapCut) preservam `Space` e setas para quadro [42][50][60][66][74].
4. **Paleta de comandos (`Ctrl/Cmd+K`) e mapa pesquisável de atalhos:** Figma (`Cmd+K`), Final Cut (`Option+Cmd+K`), Premiere (`Edit > Keyboard Shortcuts`), DaVinci (`Alt+Ctrl+K`) e Descript (`Ctrl+/`) oferecem busca instantânea de ações e consulta/edição de teclas sem obrigar o usuário a memorizar menus profundos [36][42][54][65][75].
5. **Trabalho longo em fila não bloqueante com estado por item:** Final Cut (*Background Tasks*), Premiere (*Progress Panel*) e DaVinci (*Render Queue*) exibem fila persistente com progresso percentual, tempo restante/etapa e cancelamento individual sem travar o restante do app [37][44][53].
6. **Alternativa textual sincronizada para acessibilidade e velocidade:** O *Timeline Index* do Final Cut Pro (listagem pesquisável de clipes/marcadores compatível com VoiceOver) e o editor de texto do Descript provam que representar áudio/vídeo como lista estruturada de texto torna a navegação acessível a leitores de tela e muito mais rápida no teclado [51][67].

---

## Divergências e trade-offs

| Eixo de decisão | Caminho A (NLEs clássicos: Premiere, DaVinci) | Caminho B (Simplificado / Texto-primeiro: CapCut, Opus Clip, Descript) | Trade-off |
|---|---|---|---|
| **Densidade e painéis** | Todos os painéis visíveis e acopláveis em grid configurável; alta densidade de controles e ícones pequenos | Layout fixo simplificado (CapCut/Opus) ou timeline ocultável atrás do texto (Descript) | Painéis fixos sempre abertos reduzem o espaço do vídeo em telas 1366×768; painéis acopláveis livres geram confusão em iniciantes e risco de layout quebrado; esconder ferramentas secundárias exige descoberta clara por atalho/borda |
| **Atalhos de tecla única** | Teclas únicas globais (`B`, `V`, `C`, `J`, `K`, `L`) ativas no workspace inteiro | Descript isola modos (*Write* vs *Timeline*) e Figma permite **ignorar atalhos em campos** + navegador por zonas `F6` | Tecla única acelera especialistas em 2–3×, mas **viola WCAG 2.2 SC 2.1.4** se não puder ser desligada/remapeada e colide com edição de Transcrição/Roteiro |
| **Temas e contraste** | Premiere oferece *Darkest / Dark / Light* + toggle de contraste; DaVinci impõe escuro rígido | Figma oferece *Light / Dark* + **Enhanced contrast**; CapCut e Opus travam num único tema escuro | Um único tema escuro com cinzas muito próximos favorece coloristas em sala escura, mas exclui pessoas com baixa visão ou astigmatismo em ambientes claros [34][47] |
| **Acessibilidade da timeline** | Canvas/timeline puramente visual sem ponte para leitor de tela (Premiere limitado, DaVinci ausente) | Final Cut combina timeline visual + **Timeline Index** textual navegável por VoiceOver; Figma traduz protótipos para árvore semântica | Construir acessibilidade direto numa `<canvas>`/SVG denso falha em leitores de tela; espelhar em estrutura textual (Frases/Cortes/Marcadores) resolve o uso real [51][75] |

---

## Anti-padrões

1. **Contraste "lavado" e botões indistinguíveis de desabilitados no modo escuro:** Usuários do Premiere Pro após a adoção do tema Spectrum reclamam que controles escuros sobre fundo escuro quase não se distinguem de botões desabilitados, forçando busca visual constante e cansaço ocular [47][48]; o mesmo problema gera críticas de baixa visibilidade no DaVinci Resolve [38].
2. **Texto minúsculo sem escala independente da interface:** Tanto no CapCut Desktop (em monitores 4K) quanto no Premiere Pro e DaVinci Resolve, fontes pequenas de UI sem ajuste independente obrigam o usuário a alterar a escala inteira do sistema operacional ou aproximar o rosto da tela, agravando lesões por esforço repetitivo [39][49][63].
3. **Atalhos de tecla única irreversíveis ou que mudam de significado conforme o foco oculto:** Sem isolamento de modo ou opção de desligar/remapear (WCAG 2.1.4), usuários de ditado ou edição de texto disparam cortes e deleções sem querer [24]; e quando a mesma tecla (`[`/`]` ou `A`/`S`) faz coisas diferentes dentro e fora de um painel sem feedback claro, quebra a confiança do usuário (como ocorre na própria v1 do Clipes entre gaveta e `CandidateReview`, relatado em `90-inventario-ui-atual.md`) [79].
4. **Invisibilidade para leitores de tela e ausência de ordem de foco por região:** Interfaces de mídia sem atalho de salto entre regiões (`F6` do Figma), sem `aria-valuetext` legível nos controles de tempo e sem alternativa textual à timeline bloqueiam totalmente usuários cegos ou de baixa visão (crítica recorrente ao DaVinci Resolve no `r/Blind`) [38][75].
5. **Reorganização abrupta de UI e perda de controles entre atualizações:** Usuários do Descript no `r/podcasting` criticam mudanças constantes de posição e nome de painéis, mostrando que ferramentas de produção em volume dependem de **estabilidade espacial e previsibilidade de atalhos** [70].
6. **Erros mudos, progresso sem contexto e jargão técnico na frente do usuário:** Barras sem percentual/etapa, estados de carregando indistinguíveis de vazio e mensagens técnicas cruas deixam o usuário sem saber se o app travou ou o que fazer (problema direto da v1 do Clipes com `compute_type`, `SHA-256`, `Worker Python` e `catch {}` silencioso em `90-inventario-ui-atual.md`) [79].

---

## Implicações para o Clipes

### A. O que a pesquisa justifica reaproveitar do design system "Foco" (`design-system/` e `src/styles/`)

A auditoria direta de `design-system/` e `src/styles/` mostra que o padrão **Foco** já incorporou grande parte das melhores práticas encontradas no mercado e nas normas:

1. **Tokens OKLCH grafite quente + restrição do âmbar (`src/styles/tokens.css`, `design-system/DESIGN.md`):** Fundo `--canvas: oklch(0.155 0.004 70)` (grafite, nunca `#000000`), degraus limpos (`--canvas` → `--surface` → `--field` → `--hover` → `--selected`), divisórias de 1 px (`--line`) e âmbar restrito a playhead, seleção e foco (`--accent`, `--playhead`, `--focus-ring`). Isso previne halação (NN/g) [34], mantém o vídeo como âncora visual e segue a arquitetura de camadas do Spectrum e Fluent 2 [26][28]. **Reaproveitar integralmente.**
2. **Suporte completo aos temas Escuro, Claro e Sistema (`src/lib/tema.ts`, `tokens.css`, `Aparencia.tsx`):** Atende simultaneamente editores noturnos (escuro padrão), pessoas com astigmatismo em ambiente iluminado (claro) e preferência do SO (`Apple HIG`/`GNOME HIG`) [30][33][34]. **Reaproveitar e expor na UI principal** (a v1 omitia a opção `sistema` em `Preferences.tsx`).
3. **Verificação automatizada de contraste (`design-system/scripts/contraste.ts`) e de teclado (`design-system/scripts/teclado.ts`):** Checar via script todos os pares texto/fundo (≥ 4,5:1) e gráfico/fundo (≥ 3:1) nos dois temas é superior ao processo manual da maioria dos produtos. **Reaproveitar no CI do front v2.**
4. **Primitivas sobre Base UI + `<Status>` semântico (`design-system/src/components/ui/Status.tsx`):** O componente `Status` combina sempre texto + ícone + cor + `tabular-nums`, cumprindo WCAG 1.4.1 (*Use of Color*). **Reaproveitar todas as primitivas de `design-system/src/components/ui/`.**
5. **Tipografia funcional (`Inter Variable` com `cv11`/`ss01` + `Geist Mono` em `.timecode`):** Base em `13 px` (`--text-sm`), `tabular-nums` em timecodes/custos, e limite de `68ch` em prosa garantem legibilidade densa sem cair no erro do texto tamanho 8 do Premiere/CapCut [49][63]. **Reaproveitar.**
6. **Paleta `Ctrl+K` unificada com `useComandos` (`design-system/src/lib/comandos.tsx`, `Paleta.tsx`) e `<ListaVirtual>` (`VirtualList.tsx`):** Garante que o atalho exibido em `<Kbd>` nunca diverge do código e implementa `listbox` com `aria-activedescendant` e `aria-posinset`/`aria-setsize`. **Reaproveitar a base e estender.**
7. **`Timeline.tsx` e `Preview.tsx` do Foco (`design-system/src/components/editor/`):** As alças de Entrada/Saída e o playhead já usam `role="slider"` com `aria-valuetext` em timecode (`"00:14.200 da Fonte"`), alvo de largura `w-6` (24 px, WCAG 2.5.8), hachura nos silêncios (não depende só de cor) e controle de `QuadroFonte` também por teclado (`←`/`→`, `Shift` passo maior). **Reaproveitar e complementar.**
8. **`prefers-reduced-motion` global (`tokens.css` e `index.css`):** Reduz durações e remove deslocamento de gavetas mantendo apenas fade de 80 ms. **Reaproveitar.**

### B. O que precisa mudar no "Foco" antes de construir o front v2

1. **Conformidade com WCAG 2.2 SC 2.1.4 (Atalhos de tecla única):** O `comandos.tsx` do `design-system/` registra atalhos de letra única globais (`C`, `T`, `L`, `F`, `A`, `X`, `S`, `J`, `K`, `I`, `V`, `1..4`, `[`, `]`). Isso **viola o critério 2.1.4 (Nível A)** se não houver mecanismo para desligá-los ou remapeá-los [24]. **Mudança necessária:** adicionar em Configurações (`Aparência e Teclado`) um interruptor **"Desativar atalhos de uma tecla"** (ou exigir modificador como `Alt+...`) e permitir **remapear atalhos** (como no *Command Editor* do Final Cut / Figma), persistindo em JSON global de preferências.
2. **Conflito de gavetas flutuantes com foco e leitura (WCAG 2.4.11 + `Gaveta.tsx`):**
   * Na v1 (`src/components/shell/Gaveta.tsx`), o focus trap excluía `<textarea>` (`90-inventario-ui-atual.md`); no `design-system/`, a gaveta usa `inert={!g.aberta}` (ótimo!), mas abre por *hover* (`ZonaBorda` de 16 px). Para usuários de ampliação de tela ou navegação por mouse próximo à borda, abrir gaveta acidentalmente cobre controles do palco/cortes (**risco de WCAG 2.4.11 Focus Not Obscured**). **Mudança necessária:** oferecer opção para abrir gavetas **apenas por clique/tecla** (desativando *hover* em `ZonaBorda`), garantir `scrollIntoView` com margem segura se uma gaveta estiver fixa, e usar um **atalho de região (`F6`)** para pular entre barra superior, palco, gavetas e timeline sem precisar abrir a paleta.
3. **Alternativa textual acessível para a timeline e lista de Frases/Keyframes (estilo *Timeline Index*):** Embora `Timeline.tsx` tenha `role="slider"` nas alças e playhead, faltam: (a) suporte a `PageUp`/`PageDown` (passo de 5 s ou 5 Frases) conforme WAI-ARIA APG `slider`, (b) associação explícita de `aria-live="polite"` para anunciar a Frase/tempo atual durante navegação por teclado, e (c) uma aba/visão estruturada de **Índice do Corte** (ou integração direta na gaveta Transcrição) onde usuário de leitor de tela navegue por Frases, silêncios e keyframes em lista semântica (`listbox` ou `treegrid`) sem depender de arraste visual — exatamente como o *Timeline Index* no Final Cut Pro [51].
4. **Modo de Alto Contraste opcional + escala de texto da interface:** Seguir o exemplo do Figma (*Enhanced contrast*) [75] e Premiere Pro (toggle de contraste) [43]: criar um modificador `[data-contrast="high"]` em `tokens.css` que eleve `--line`, `--line-strong`, `--fg-3` (de 4,5:1 para ≥ 7:1) e reduza opacidade de transparências, além de um seletor simples de **tamanho da fonte da UI** (`Padrão 13 px` / `Maior 15 px`, resolvendo a dor nº 1 de CapCut/Premiere em telas de alta DPI) [49][63].
5. **Padrão `grid`/`treegrid` e `toolbar` onde hoje há listas planas ou botões soltos:**
   * Na barra de transporte do `Editor.tsx` (`+1/-1`, `Play/Pause`, `-1/+1`), envolver em `role="toolbar"` com *roving tabindex* para não criar 6 paradas de `Tab` entre o preview e a timeline.
   * Na fila de Fontes (`Fontes.tsx`), tabela de Tarefas de IA (`TaskTable.tsx`) e fila de Jobs (`07-provedores-jobs-e-eventos.md`), usar `grid` ou `treegrid` para navegar linhas e ações secundárias (cancelar, repetir, descartar) com setas.
6. **Correção de anúncios `role="alert"` vs `role="status"` e estados obrigatórios:** Padronizar que falhas acionáveis usem `role="alert"` (com botão de ação e explicação humana, nunca `CoreError` cru), e progresso/conclusão de job use `role="status"` / `aria-live="polite"` com controle de *throttle* para não inundar o leitor de tela a cada 400 ms.
7. **Ajuste de contrato de foco no WebKitGTK (Linux):** Verificar que todos os `<input type="radio">`, `<checkbox>`, links e `<button>` nativos fora de `ui/` usem `.foco` (anel com `box-shadow` arredondado em vez de `outline` quadrado quebrado no WebKitGTK) e respeitem o mínimo de **24 × 24 px** (WCAG 2.5.8), especialmente nos botões de palavra da `FerrTranscricao` (`min-h-6` atualmente tem 24 px de altura, mas palavras curtas como `"a"`, `"o"` podem ter < 24 px de largura — garantir `min-w-6` ou padding suficiente / espaçamento entre palavras).

### C. Implicações por etapa da jornada do Clipes (ligadas a `docs/produto/funcionalidades/`)

* **1. Instalação e Sistema (`01-instalacao-e-sistema.md`):** Diferente dos SaaS fechados, o usuário do Clipes precisa baixar FFmpeg, yt-dlp, Deno, Worker Python, modelos Whisper/YuNet e vozes TTS. **Implicação:** traduzir termos internos (`compute_type: int8_float16`, `Worker Python`, `SHA-256`, `Ed25519`, `handshake`) para **textos para iniciantes** (ex.: *"Motor local de transcrição (acelerado por placa NVIDIA)"* com detalhes técnicos recolhidos em `<details>`), com estados de carregamento/erro/vazio explícitos e confirmação acessível (`ConfirmDialog`, nunca `window.confirm`).
* **2. Projetos, Fontes e Lotes (`02-projetos-e-fontes.md`):** A página inicial da v1 (`Projects.tsx` com 6.400 linhas) misturava tudo. **Implicação:** adotar a separação por etapas do Foco (`Tela.tsx`: `Fontes → Cortes → Exportar`), mover seleção/troca/fechamento de Projeto (`projects.close`) para o menu de topo, usar `EstadoLista` para distinguir carregamento inicial de lista vazia, e aplicar `treegrid` para acompanhar **Lote de Fontes** (`batches.*`) com pausa individual por Fonte sem perder o foco do usuário.
* **3. Transcrição e Busca (`03-transcricao.md`):** O Clipes tem **Transcrição local completa da Fonte** com confiança por palavra, pausas explícitas e correção não destrutiva com `undo`/`redo`. **Implicação:** tornar a Transcrição navegável por teclado (`F2` na palavra para corrigir, `↑`/`↓` por Frase), destacar palavras de baixa confiança com **sublinhado pontilhado + ícone/dica** (nunca só cor — WCAG 1.4.1), e oferecer escolha entre Motor local e Groq com estimativa clara de tempo/custo antes de rodar.
* **4. Seleção de Cortes e Perfis (`04-selecao-de-cortes.md`):** Diferente do Vizard/Opus, o Clipes tem **Nota de 5 eixos explicável**, **Provedor agnóstico** (CLI/API/local), **Somente local** e **custo/orçamento visível**. **Implicação:** na lista de Cortes (`Cortes.tsx`), exibir Nota e justificativa sob demanda (`I` ou disclosure `<details>`), usar `Status` com texto+ícone para `pending`/`approved`/`rejected`/`adjusted`, separar a configuração de Provedores em `Configurações` com tabela `grid` para Tarefas de IA (exibindo selo de localidade `Local` / `CLI` / `Nuvem` e bloqueio de `Somente local` em texto + ícone de cadeado).
* **5. Editor do Corte (`05-editor.md`):** Manter o princípio **"só preview e timeline na frente"** do Foco, evitando o colapso da v1 (`max-w-4xl` apertando tudo junto) e resolvendo o conflito de `[` e `]` entre troca de Corte e ajuste de bordas. Toda manipulação espacial (alças Entrada/Saída, centro do recorte 9:16, keyframes) precisa de paridade total via teclado (`role="slider"` + lista textual no painel/gaveta) e visualização clara da exceção `Alt` (ajuste fino por quadro fora do encaixe em Frase).
* **6. Roteiro, Narração, Empacotamento e Saída (`06-roteiro-narracao-e-saida.md`):** O Clipes possui cadeia exclusiva para **Canal dark** (`Ângulo → Roteiro → Narração TTS ou gravação com teleprompter → Alinhamento na timeline → Empacotamento → Guardrails`). **Implicação:** isso exige uma aba/sub-rota dedicada (`#/corte/:id/transformar` e `/empacotar`, já esboçada no `design-system/`) com leitura limpa de até `68ch` para o Roteiro, teleprompter com opção de **movimento reduzido / rolagem por passo manual** (`prefers-reduced-motion`), indicador de estado `gravando` com ícone + rótulo + contador `tabular-nums` (nunca só bolinha vermelha — WCAG 1.4.1), e checklist de `guardrails.check` antes da exportação sem bloquear o fluxo.
* **7. Provedores, Fila de Jobs e Orçamento (`07-provedores-jobs-e-eventos.md`):** O Clipes expõe **fila persistida no SQLite**, jobs `uncertain` após queda/fechamento, e **teto de orçamento**. **Implicação:** criar um indicador persistente de fila na barra superior (inspirado na *Background Tasks* do Final Cut Pro [53]) que abra a lista completa de jobs sem sair da tela atual; destacar jobs `uncertain` ou pausados por teto de custo com status `atencao` (ícone + texto explicando exatamente quanto já foi gasto e o que falta decidir: retomar, refazer com outro perfil via `jobs.redo` ou descartar).

### D. O que o Clipes tem e os concorrentes não têm (impacto na UI)

| Diferencial do Clipes | Como os concorrentes lidam | Como muda a UI do Clipes v2 |
|---|---|---|
| **Transcrição local** (Whisper/worker Python + escolha de hardware) | Tudo na nuvem (Opus, Vizard, Descript) | Exige status claro de hardware/progresso local, estimativa de tempo em `LocalEstimate` e explicação simples de "processado no seu PC" sem jargão de `compute_type` |
| **Provedor agnóstico** (CLI, chave de API, modelo local + veto *Somente local*) | Modelo único proprietário escondido | Exige roteamento claro por Tarefa de IA, badge textual de privacidade (`Somente local` ativo/inativo) e estados de erro compreensíveis por tipo de Provedor |
| **Custo e orçamento visível** antes de rodar (`estimate`, `budget`, `audit`) | Créditos opacos por minuto cobrados no envio | Estimativa de custo USD pré-voo antes de disparar lote/seleção e pausa transparente ao atingir o teto, com confirmação explícita |
| **Narração e Roteiro para Vídeo transformado** (com revisão humana e guardrails) | Focam em Corte direto ou TTS genérico sem cadeia de transformação | Fluxo progressivo claro (Ângulo → Roteiro → Narração → Montagem) separado da tela de edição rápida de Corte direto, evitando sobrecarga visual para quem faz apenas Cortes diretos |

### E. Checklist de acessibilidade para o front v2

* **Teclado e Navegação:**
  * [ ] Toda ação (timeline, alças, crop, listas, diálogos, gavetas) operável 100% sem mouse (WCAG 2.1.1).
  * [ ] Atalho de salto entre regiões da tela (`F6` / `Shift+F6`: barra superior → palco/conteúdo → gaveta/painel → timeline) além da paleta `Ctrl+K`.
  * [ ] Atalhos de tecla única (`C`, `T`, `L`, `F`, `A`, `X`, `S`, `J`, `K`, `1..4`, `[`, `]`) nunca disparam dentro de campos de texto (`emCampo`), têm opção global para **desligar ou exigir modificador** e podem ser **remapeados** nas configurações (WCAG 2.1.4).
  * [ ] Zero conflito de atalho entre escopos ativos simultaneamente (resolver colisão de `[`/`]` entre shell e revisão).
  * [ ] Barras de ferramentas usam `role="toolbar"` com *roving tabindex*; abas usam `role="tablist"` (`@base-ui/react/tabs`); filas/tabelas complexas usam `grid`/`treegrid`; modais usam `dialog`/`alertdialog` com `inert` no fundo e foco restaurado ao fechar.
* **Foco e Alvos:**
  * [ ] Anel `:focus-visible` (`.foco`) aplicado a **100%** dos controles interativos, testado no WebKitGTK (Linux), WebView2 (Windows) e WKWebView (macOS) (WCAG 2.4.7).
  * [ ] Nenhum elemento focado fica totalmente oculto por barra fixa, gaveta flutuante ou toast (WCAG 2.4.11); gavetas possuem opção de desativar abertura por hover.
  * [ ] Todo alvo interativo (incluindo botões de palavra na Transcrição, ícones de ação e alças da timeline) tem no mínimo **24 × 24 CSS px** ou espaçamento equivalente (WCAG 2.5.8).
* **Leitor de Tela e Mídia:**
  * [ ] Alças da timeline, playhead e recorte 9:16 implementam `role="slider"` com `aria-valuemin/max/now`, **`aria-valuetext` em timecode/percentual legível** e suporte a `PageUp`/`PageDown` (APG).
  * [ ] Existe visão/índice textual de Frases, silêncios e keyframes navegável por teclado e leitor de tela como alternativa à manipulação visual da timeline.
  * [ ] Mensagens de progresso/conclusão usam `role="status"` (`aria-live="polite"` com *throttle*); erros críticos acionáveis usam `role="alert"` (WCAG 4.1.3).
  * [ ] Ícones decorativos têm `aria-hidden="true"`; botões só-ícone têm `aria-label` claro e sem códigos internos (WCAG 4.1.2).
* **Contraste, Cor, Tipografia e Movimento:**
  * [ ] Pares texto/fundo ≥ **4,5:1** e controles/gráficos/foco ≥ **3:1** nos temas Escuro, Claro e modo **Alto Contraste** opcional (WCAG 1.4.3 / 1.4.11), verificados por `scripts/contraste.ts` no CI.
  * [ ] Nenhum estado (`gravando`, `erro`, `job rodando`, `aprovado`, `baixa confiança`, `silêncio`) depende só de cor (WCAG 1.4.1).
  * [ ] Controle de **escala de texto da interface** (ex.: 100% / 115%) funcionando sem quebrar layout em `1366 × 768`.
  * [ ] `prefers-reduced-motion: reduce` desativa transições espaciais, pulsações contínuas e rolagem automática do teleprompter (WCAG 2.3.3).
* **Linguagem para Iniciantes:**
  * [ ] Nenhum erro técnico cru do Rust/HTTP ou jargão interno (`compute_type`, `libass`, `SHA-256`, `Worker Python`, `Task vN`) exposto diretamente no fluxo principal; termos canônicos seguem o `GLOSSARY.md`.

---

## Fontes

1. Expanded Ramblings — *CapCut Statistics and Facts (MAUs and Downloads)*: https://expandedramblings.com/capcut-statistics/ *(acesso em 2026-11-17)* `[verificado via pesquisa web]`
2. Wikipedia — *CapCut*: https://en.wikipedia.org/wiki/CapCut *(acesso em 2026-11-17)* `[verificado via pesquisa web]`
3. CapCut — *Official Site & Plans*: https://www.capcut.com/ *(acesso em 2026-11-17)*
4. CapCut — *Desktop Video Editor Overview & Features*: https://www.capcut.com/tools/desktop-video-editor *(acesso em 2026-11-17)* `[via busca web em capcut.com]`
5. SendShort — *Adobe Premiere Pro Statistics (Users & Market)*: https://sendshort.ai/statistics/premiere-pro/ *(acesso em 2026-11-17)* `[verificado via pesquisa web]`
6. Quantumrun — *Premiere Pro User Demographics & Adoption*: https://www.quantumrun.com/ *(acesso em 2026-11-17)* `[via busca web]`
7. Adobe Creative Cloud — *Plans and Pricing*: https://www.adobe.com/creativecloud/plans.html *(acesso em 2026-11-17)*
8. SQ Magazine — *Figma Statistics (MAUs, Paid Customers, Enterprise Adoption from S-1/Reports)*: https://sqmagazine.co.uk/figma-statistics/ *(acesso em 2026-11-17)* `[verificado via pesquisa web]`
9. Figma — *Pricing Plans*: https://www.figma.com/pricing/ *(acesso em 2026-11-17)*
10. Sacra — *OpusClip Revenue, Users & Growth*: https://sacra.com/c/opusclip/ *(acesso em 2026-11-17)* `[verificado via pesquisa web]`
11. Startup Founder Stories — *Opus Clip Growth & User Milestones*: https://startupfounderstories.com/ *(acesso em 2026-11-17)* `[via busca web]`
12. Opus Clip — *Home & Product Overview*: https://www.opus.pro/ *(acesso em 2026-11-17)*
13. Opus Clip — *Pricing & Capability Inventory* (e pesquisa interna do repo `docs/research/2026-11-12-opusclip-feature-inventory.md`): https://www.opus.pro/pricing *(acesso em 2026-11-17)*
14. Descript — *About / Platform Overview (6M+ Creators & Teams)*: https://www.descript.com/ *(acesso em 2026-11-17)*
15. Descript — *Customer & Enterprise Usage*: https://www.descript.com/enterprise *(acesso em 2026-11-17)*
16. Castmagic / Descript Pricing Breakdown — *Descript Plans, Media Hours & AI Credits*: https://www.descript.com/pricing *(acesso em 2026-11-17)*
17. SendShort — *DaVinci Resolve Statistics (5.4M+ Users)*: https://sendshort.ai/statistics/davinci-resolve/ *(acesso em 2026-11-17)* `[verificado via pesquisa web]`
18. Blackmagic Design — *DaVinci Resolve Product Page & Studio ($295)*: https://www.blackmagicdesign.com/products/davinciresolve *(acesso em 2026-11-17)*
19. Wikipedia — *DaVinci Resolve (Pages & Editions)*: https://en.wikipedia.org/wiki/DaVinci_Resolve *(acesso em 2026-11-17)*
20. 9to5Mac — *Final Cut Pro X User Milestone (2M+)*: https://9to5mac.com/ *(acesso em 2026-11-17)* `[via busca web]`
21. Apple — *Final Cut Pro (Mac App Store / Product & $299.99 Pricing)*: https://www.apple.com/final-cut-pro/ *(acesso em 2026-11-17)*
22. Apple Support / Newsroom — *Apple Creator Studio Bundle*: https://www.apple.com/ *(acesso em 2026-11-17)* `[via busca web]`
23. W3C — *Web Content Accessibility Guidelines (WCAG) 2.2*: https://www.w3.org/TR/WCAG22/ *(acesso em 2026-11-17)*
24. W3C — *Understanding Success Criterion 2.1.4: Character Key Shortcuts*: https://www.w3.org/WAI/WCAG22/Understanding/character-key-shortcuts.html *(acesso em 2026-11-17)*
25. W3C — *WAI-ARIA Authoring Practices Guide (APG) Patterns*: https://www.w3.org/WAI/ARIA/apg/patterns/ *(acesso em 2026-11-17)*
26. Adobe Spectrum — *Color, Dark Theme & Leonardo Contrast System*: https://spectrum.adobe.com/page/color/ *(acesso em 2026-11-17)*
27. Adobe Design / Spectrum — *Dark Theme Shadows, Elevation & Perceptual Contrast*: https://adobe.design/ *(acesso em 2026-11-17)*
28. Microsoft Fluent 2 — *Color, Dark Mode & Semantic Alias Tokens*: https://fluent2.microsoft.design/color *(acesso em 2026-11-17)*
29. Microsoft Fluent 2 — *Typography & Accessibility Foundations*: https://fluent2.microsoft.design/typography *(acesso em 2026-11-17)*
30. Apple Human Interface Guidelines — *Dark Mode*: https://developer.apple.com/design/human-interface-guidelines/dark-mode *(acesso em 2026-11-17)*
31. Apple Human Interface Guidelines — *Accessibility*: https://developer.apple.com/design/human-interface-guidelines/accessibility *(acesso em 2026-11-17)*
32. GNOME Human Interface Guidelines — *Keyboard Interaction & Accessibility*: https://developer.gnome.org/hig/guidelines/accessibility.html *(acesso em 2026-11-17)*
33. GNOME Human Interface Guidelines — *Color & Dark Style Preference*: https://developer.gnome.org/hig/ *(acesso em 2026-11-17)*
34. Nielsen Norman Group (NN/g) — *Dark Mode vs. Light Mode: Which Is Better?*: https://www.nngroup.com/articles/dark-mode/ *(acesso em 2026-11-17)*
35. Base UI — *Accessible Unstyled React Components*: https://base-ui.com/ *(acesso em 2026-11-17)*
36. Blackmagic Design — *DaVinci Resolve Reference Manual (Keyboard Customization & Pages)*: https://www.blackmagicdesign.com/support/family/davinci-resolve-and-fusion *(acesso em 2026-11-17)*
37. Blackmagic Design Forum & Manual — *Deliver Page Render Queue & Shortcut Limitations*: https://forum.blackmagicdesign.com/ *(acesso em 2026-11-17)* `[via busca web]`
38. Reddit (`r/Blind`, `r/davinciresolve`) — *Screen Reader Incompatibility & Section 508 / UI Contrast Complaints in DaVinci Resolve*: https://www.reddit.com/r/davinciresolve/ *(acesso em 2026-11-17)* `[via busca web]`
39. Blackmagic Design Forum — *UI Scaling, Tiny Text & Accessibility Requests*: https://forum.blackmagicdesign.com/ *(acesso em 2026-11-17)* `[via busca web]`
40. Reddit (`r/blackmagicdesign`) — *Feature Bloat vs. Core UI/Accessibility Upgrades*: https://www.reddit.com/r/blackmagicdesign/ *(acesso em 2026-11-17)* `[via busca web]`
41. Adobe Help Center — *Panels in Premiere Pro*: https://helpx.adobe.com/premiere-pro/using/panels.html *(acesso em 2026-11-17)*
42. Adobe Help Center — *Premiere Pro Default Keyboard Shortcuts*: https://helpx.adobe.com/premiere-pro/using/default-keyboard-shortcuts.html *(acesso em 2026-11-17)*
43. Adobe Help Center — *Set Appearance Preferences (Darkest / Dark / Light & Accessibility Contrast)*: https://helpx.adobe.com/premiere-pro/using/appearance.html *(acesso em 2026-11-17)*
44. Adobe Help Center — *Progress Panel & Background Tasks in Premiere Pro*: https://helpx.adobe.com/premiere-pro/using/panels.html *(acesso em 2026-11-17)* `[via busca web em adobe.com]`
45. Adobe Blog / Help — *Spectrum UI Modernization in Premiere Pro*: https://helpx.adobe.com/premiere-pro/using/appearance.html *(acesso em 2026-11-17)*
46. Adobe Help Center — *Accessibility Overview in Premiere Pro*: https://helpx.adobe.com/premiere-pro/using/accessibility-overview.html *(acesso em 2026-11-17)*
47. Reddit (`r/premiere`) — *Spectrum UI Contrast & "Washed Out" Buttons Feedback*: https://www.reddit.com/r/premiere/ *(acesso em 2026-11-17)* `[via busca web]`
48. Adobe Community Forums — *Premiere Pro Dark Mode Contrast & Legibility Feedback*: https://community.adobe.com/ *(acesso em 2026-11-17)* `[via busca web]`
49. Reddit (`r/premiere`) — *Low-Vision, Small UI Fonts & RSI Ergonomic Complaints*: https://www.reddit.com/r/premiere/ *(acesso em 2026-11-17)* `[via busca web]`
50. Apple Support — *Intro to the Magnetic Timeline in Final Cut Pro for Mac*: https://support.apple.com/guide/final-cut-pro/intro-to-the-magnetic-timeline-verbbcb34bfc/mac *(acesso em 2026-11-17)*
51. Apple Support — *Timeline Index & Accessible List Navigation in Final Cut Pro*: https://support.apple.com/guide/final-cut-pro *(acesso em 2026-11-17)*
52. Apple Support — *Record Voiceovers in Final Cut Pro for Mac*: https://support.apple.com/guide/final-cut-pro/record-voiceovers-ver3cbf9ba5f/mac *(acesso em 2026-11-17)*
53. Apple Support — *View Background Tasks in Final Cut Pro for Mac*: https://support.apple.com/guide/final-cut-pro/view-background-tasks-verbc3b70744/mac *(acesso em 2026-11-17)*
54. Apple Support — *Intro to the Command Editor in Final Cut Pro for Mac*: https://support.apple.com/guide/final-cut-pro/intro-to-the-command-editor-vercd2244f77/mac *(acesso em 2026-11-17)*
55. Apple Support — *Modify Keyboard Shortcuts in Final Cut Pro for Mac*: https://support.apple.com/guide/final-cut-pro/modify-keyboard-shortcuts-verccdb4e48b/mac *(acesso em 2026-11-17)*
56. Apple Support — *VoiceOver User Guide for Mac*: https://support.apple.com/guide/voiceover *(acesso em 2026-11-17)*
57. Medium — *Final Cut Pro Magnetic Timeline & Multi-User Collaboration Trade-offs*: https://medium.com/ *(acesso em 2026-11-17)* `[via busca web]`
58. Reddit (`r/finalcutpro`) — *Shortcut Inconsistencies Across Apple Pro Apps*: https://www.reddit.com/r/finalcutpro/ *(acesso em 2026-11-17)* `[via busca web]`
59. AI Chat Daily / CapCut Guides — *CapCut Desktop Three-Panel Architecture*: https://www.capcut.com/ *(acesso em 2026-11-17)* `[via busca web]`
60. CapCut Help — *Desktop Video Editing & Keyboard Shortcuts (`Ctrl/Cmd+B`, `Space`, `←`/`→`)*: https://www.capcut.com/ *(acesso em 2026-11-17)*
61. Reddit (`r/CapCut`) — *Preview Lag & "This part is not rendered" Warnings*: https://www.reddit.com/r/CapCut/ *(acesso em 2026-11-17)* `[via busca web]`
62. Reddit (`r/CapCut`) — *Keyboard Shortcut Customization & Reference Overlay Complaints*: https://www.reddit.com/r/CapCut/ *(acesso em 2026-11-17)* `[via busca web]`
63. Reddit (`r/CapCut`) — *4K Monitor UI Text Scaling Accessibility Complaints*: https://www.reddit.com/r/CapCut/ *(acesso em 2026-11-17)* `[via busca web]`
64. Reddit (`r/CapCut`) & G2 — *CapCut Pro Paywall & Free Feature Removals*: https://www.g2.com/products/capcut/reviews *(acesso em 2026-11-17)* `[via busca web]`
65. Descript Help Center — *Keyboard Shortcuts (`Option+/` / `Ctrl+/`) & Navigation*: https://help.descript.com/hc/en-us/articles/10255582172173-Keyboard-shortcuts *(acesso em 2026-11-17)*
66. Descript Help Center — *Expanded Timeline & Mode Shortcuts (`Ctrl+Alt+T`, `Ctrl+E`, `Alt+C`)*: https://help.descript.com/ *(acesso em 2026-11-17)*
67. Valmera / Descript Reviews — *Transcript-First Editing Workflow*: https://www.descript.com/ *(acesso em 2026-11-17)* `[via busca web]`
68. Reddit (`r/Descript`) — *Requests for Expanded DAW-Style Waveform Shortcuts*: https://www.reddit.com/ *(acesso em 2026-11-17)* `[via busca web]`
69. G2 — *Descript Reviews (Text-Based Editing & AI Cleanup Praise)*: https://www.g2.com/products/descript/reviews *(acesso em 2026-11-17)* `[via busca web]`
70. Reddit (`r/podcasting`) — *Descript UI Fatigue, Frequent Layout Shifts & Performance Lag*: https://www.reddit.com/r/podcasting/ *(acesso em 2026-11-17)* `[via busca web]`
71. Canny / Descript Feedback — *Forced AI Defaults & Customization Friction*: https://feedback.descript.com/ *(acesso em 2026-11-17)* `[via busca web]`
72. Opus Clip Help Center — *Virality Score & Results View*: https://help.opus.pro/docs/article/virality-score *(acesso em 2026-11-17)*
73. Trustpilot / Ssemble — *Opus Clip User Reviews (Manual Editor Friction, Credits & Queue Issues)*: https://www.trustpilot.com/review/opus.pro *(acesso em 2026-11-17)* `[via busca web]`
74. Opus Clip Help Center — *Keyboard Precise Editing*: https://help.opus.pro/docs/article/keyboard-precise-editing *(acesso em 2026-11-17)*
75. Figma Help Center — *Accessibility at Figma (`F6`, Enhanced Contrast, Actions Menu, Ignore Shortcuts in Text Fields)*: https://help.figma.com/hc/en-us/articles/35063862380311-Accessibility-at-Figma *(acesso em 2026-11-17)*
76. UX Design Collective — *Figma Dark Mode & Enhanced Contrast Mode Analysis*: https://uxdesign.cc/ *(acesso em 2026-11-17)* `[via busca web]`
77. Figma Help Center — *Accessible Prototypes & Screen Readers (VoiceOver, NVDA, JAWS)*: https://help.figma.com/ *(acesso em 2026-11-17)*
78. Lokalise / Figr — *Figma Accessibility Plugin Adoption & Enterprise Compliance*: https://www.figma.com/community *(acesso em 2026-11-17)* `[via busca web]`
79. Documentação interna do Clipes — *Funcionalidades, Inventário da UI atual e Design System Foco*: `docs/produto/funcionalidades.md`, `docs/produto/funcionalidades/90-inventario-ui-atual.md`, `design-system/DESIGN.md`, `design-system/PRODUCT.md`, `src/styles/tokens.css` *(leitura local em 2026-11-17)*.

<!-- definições dos links numerados citados no texto -->
[2]: https://en.wikipedia.org/wiki/CapCut
[4]: https://www.capcut.com/tools/desktop-video-editor
[6]: https://www.quantumrun.com/
[7]: https://www.adobe.com/creativecloud/plans.html
[11]: https://startupfounderstories.com/
[13]: https://www.opus.pro/pricing
[15]: https://www.descript.com/enterprise
[18]: https://www.blackmagicdesign.com/products/davinciresolve
[19]: https://en.wikipedia.org/wiki/DaVinci_Resolve
[21]: https://www.apple.com/final-cut-pro/
[22]: https://www.apple.com/
[24]: https://www.w3.org/WAI/WCAG22/Understanding/character-key-shortcuts.html
[27]: https://adobe.design/
[28]: https://fluent2.microsoft.design/color
[29]: https://fluent2.microsoft.design/typography
[31]: https://developer.apple.com/design/human-interface-guidelines/accessibility
[33]: https://developer.gnome.org/hig/
[34]: https://www.nngroup.com/articles/dark-mode/
[36]: https://www.blackmagicdesign.com/support/family/davinci-resolve-and-fusion
[37]: https://forum.blackmagicdesign.com/
[39]: https://forum.blackmagicdesign.com/
[42]: https://helpx.adobe.com/premiere-pro/using/default-keyboard-shortcuts.html
[43]: https://helpx.adobe.com/premiere-pro/using/appearance.html
[44]: https://helpx.adobe.com/premiere-pro/using/panels.html
[45]: https://helpx.adobe.com/premiere-pro/using/appearance.html
[47]: https://www.reddit.com/r/premiere/
[48]: https://community.adobe.com/
[49]: https://www.reddit.com/r/premiere/
[50]: https://support.apple.com/guide/final-cut-pro/intro-to-the-magnetic-timeline-verbbcb34bfc/mac
[51]: https://support.apple.com/guide/final-cut-pro
[55]: https://support.apple.com/guide/final-cut-pro/modify-keyboard-shortcuts-verccdb4e48b/mac
[56]: https://support.apple.com/guide/voiceover
[58]: https://www.reddit.com/r/finalcutpro/
[59]: https://www.capcut.com/
[60]: https://www.capcut.com/
[62]: https://www.reddit.com/r/CapCut/
[63]: https://www.reddit.com/r/CapCut/
[65]: https://help.descript.com/hc/en-us/articles/10255582172173-Keyboard-shortcuts
[66]: https://help.descript.com/
[67]: https://www.descript.com/
[68]: https://www.reddit.com/
[71]: https://feedback.descript.com/
[72]: https://help.opus.pro/docs/article/virality-score
[73]: https://www.trustpilot.com/review/opus.pro
[75]: https://help.figma.com/hc/en-us/articles/35063862380311-Accessibility-at-Figma
[76]: https://uxdesign.cc/
[1]: https://expandedramblings.com/capcut-statistics/
[3]: https://www.capcut.com/
[5]: https://sendshort.ai/statistics/premiere-pro/
[8]: https://sqmagazine.co.uk/figma-statistics/
[9]: https://www.figma.com/pricing/
[10]: https://sacra.com/c/opusclip/
[12]: https://www.opus.pro/
[14]: https://www.descript.com/
[16]: https://www.descript.com/pricing
[17]: https://sendshort.ai/statistics/davinci-resolve/
[20]: https://9to5mac.com/
[23]: https://www.w3.org/TR/WCAG22/
[25]: https://www.w3.org/WAI/ARIA/apg/patterns/
[26]: https://spectrum.adobe.com/page/color/
[30]: https://developer.apple.com/design/human-interface-guidelines/dark-mode
[32]: https://developer.gnome.org/hig/guidelines/accessibility.html
[35]: https://base-ui.com/
[38]: https://www.reddit.com/r/davinciresolve/
[40]: https://www.reddit.com/r/blackmagicdesign/
[41]: https://helpx.adobe.com/premiere-pro/using/panels.html
[46]: https://helpx.adobe.com/premiere-pro/using/accessibility-overview.html
[52]: https://support.apple.com/guide/final-cut-pro/record-voiceovers-ver3cbf9ba5f/mac
[53]: https://support.apple.com/guide/final-cut-pro/view-background-tasks-verbc3b70744/mac
[54]: https://support.apple.com/guide/final-cut-pro/intro-to-the-command-editor-vercd2244f77/mac
[57]: https://medium.com/
[61]: https://www.reddit.com/r/CapCut/
[64]: https://www.g2.com/products/capcut/reviews
[69]: https://www.g2.com/products/descript/reviews
[70]: https://www.reddit.com/r/podcasting/
[74]: https://help.opus.pro/docs/article/keyboard-precise-editing
[77]: https://help.figma.com/
[78]: https://www.figma.com/community
