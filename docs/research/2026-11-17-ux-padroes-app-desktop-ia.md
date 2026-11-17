# Padrões de app desktop: navegação, fila de jobs, onboarding pesado e configuração de IA

Resumo executivo: Apps desktop líderes convergem em uma tela inicial centrada em Projetos recentes com separação clara entre identidade portátil e cache descartável, alternando entre navegação guiada por etapas no onboarding e workspace livre com paleta de comandos (`Ctrl/Cmd+K`) na produção contínua. Filas longas bem avaliadas desacoplam o progresso em painel global persistente com retomada segura por blocos e distinção explícita entre tarefa local e chamada paga incerta (`uncertain`). No onboarding de dependências pesadas (Python, `uv`, CUDA e modelos em GB), detectar GPU/VRAM antes do download e separar pesos da instalação evitam falhas silenciosas e estouros de disco. Em Provedores de IA, usuários rejeitam paywalls sobre BYOK, cobranças excedentes surpresa e opacidade de privacidade; exigir estimativa de custo prévia, teto rígido e selo visível de modo Somente local resolve as maiores dores do mercado.

---

## Ferramentas analisadas e por que

Para cobrir os padrões que o Clipes precisa fora do recorte de editores de vídeo — já estudados em [2026-11-12-opusclip-feature-inventory.md](2026-11-12-opusclip-feature-inventory.md), [2026-11-12-vizard-capability-inventory.md](2026-11-12-vizard-capability-inventory.md), [2026-11-12-vidiq-capability-inventory.md](2026-11-12-vidiq-capability-inventory.md) e consolidados em [2026-11-12-rea-vizard-vidiq.md](2026-11-12-rea-vizard-vidiq.md) — selecionamos **14 ferramentas desktop** distribuídas pelos quatro eixos temáticos, complementadas pelas normas de plataforma (**Microsoft Fluent 2**, **Apple HIG** e **GNOME HIG**) e estudos da **Nielsen Norman Group (NN/g)**.

Critério de escolha e trocas em relação à lista candidata inicial:
- Em **navegação/projetos**, mantivemos **Figma Desktop**, **Linear**, **OBS Studio** e **Audacity**; deixamos o Notion de fora porque sua arquitetura é majoritariamente colaborativa em nuvem e menos comparável a Projetos locais portáteis (`.clipes`), enquanto o Audacity adota exatamente um contêiner SQLite local portátil (`.aup3`) [9][10].
- Em **fila de jobs e trabalho longo**, mantivemos **HandBrake**, **Steam (Downloads)** e **Topaz Video AI**; preterimos aprofundamento dedicado em DaVinci Deliver e mantivemos **Adobe Media Encoder** apenas como contraponto em trade-offs/anti-padrões, pois Topaz Video AI combina fila pesada de vídeo com download de modelos locais e limites de VRAM.
- Em **instalar componentes/modelos locais**, escolhemos **LM Studio**, **ComfyUI Desktop**, **Buzz** e **Jan**; mantivemos **Ollama** e **MacWhisper** como referências comparativas (Ollama é majoritariamente CLI/daemon `127.0.0.1:11434` e MacWhisper é exclusivo macOS, ao passo que Buzz é open source multiplataforma em `faster-whisper`/`whisper.cpp`). Pinokio e Msty/Open WebUI foram preteridos por menor evidência documentada de UI desktop nativa ou sobreposição direta com ComfyUI Desktop e Jan.
- Em **configurar Provedores de IA, chaves, custo e privacidade**, analisamos **Cursor**, **Raycast AI**, **Zed**, **LM Studio** e **Jan**.

| Ferramenta | Eixo principal | Plataformas | Público | Evidência de uso (com fonte) | Modelo de preço |
|---|---|---|---|---|---|
| **Figma Desktop** | Navegação, abas, recentes e arquivo local | Desktop (Windows, macOS) + Web | Designers, PMs e devs | >13 milhões de MAU; ~90%+ do mercado de UI/UX; 95% da Fortune 500; receita FY2025 de US$ 1,056 bi [1][2][3] | Freemium (Starter gratuito; planos pagos por assento) [4] |
| **Linear** | Navegação por teclado, paleta e estados | Desktop (Windows, macOS) + Web | Times de produto e engenharia | >40.000 empresas pagantes; >US$ 100 mi ARR; *valuation* de US$ 2,5 bi [5][6] | Freemium (plano gratuito; Standard/Plus/Enterprise pagos) [7] |
| **OBS Studio** | Workspace de painéis, wizard e Perfil vs Coleção | Desktop (Windows, macOS, Linux) | Streamers e criadores de vídeo | Líder open source de gravação/stream; pico histórico de 35.043 usuários simultâneos apenas via Steam (~20,6 mil média 30d) [8] | Gratuito e open source [8] |
| **Audacity** | Projeto SQLite portátil (`.aup3`) e menus | Desktop (Windows, macOS, Linux) | Podcasters, músicos e editores | >115,5 milhões de downloads só no FossHub; ~19,1 mil estrelas no GitHub (`audacity/audacity`) [9][10] | Gratuito e open source [9] |
| **HandBrake** | Fila de conversão, pausa/retomada e ações finais | Desktop (Windows, macOS, Linux) | Editores de vídeo e arquivistas | ~25,0 mil estrelas no GitHub (`HandBrake/HandBrake`); dezenas/centenas de milhões de downloads acumulados [11][12] | Gratuito e open source [11] |
| **Steam (Downloads)** | Downloads pesados, espaço em disco e agenda | Desktop (Windows, macOS, Linux) | Jogadores de PC | Recorde histórico de 43.505.724 usuários simultâneos em 11/10/2026 (SteamDB) [13] | Cliente gratuito (loja com comissão sobre vendas) |
| **Topaz Video AI** | Fila de vídeo com IA, VRAM e falha de modelo | Desktop (Windows, macOS) | Editores e restauradores de vídeo | Referência comercial de upscaling; nota ~3,6–3,8/5 no Trustpilot e presença em G2 [14][15][16] | Assinatura (~US$ 299/ano pessoal; ~US$ 699/ano Pro) [17][18] |
| **LM Studio** | Detecção de hardware/VRAM, download e servidor local | Desktop (Windows, macOS, Linux) | Desenvolvedores e usuários de LLM local | Milhões de downloads globais entre usuários de LLMs locais [19] | Gratuito para uso pessoal e comercial interno (proprietário) [20][21] |
| **ComfyUI Desktop** | Onboarding Python/`uv`/CUDA e discos de modelos | Desktop (Windows, macOS) + Web local | Criadores de imagem/vídeo generativo | ~147,2 mil estrelas no GitHub (`Comfy-Org/ComfyUI`), um dos repos mais estrelados [22][23] | Gratuito e open source [24] |
| **Buzz** | Download de modelos Whisper e GPU/CPU local | Desktop (Windows, macOS, Linux) | Criadores, jornalistas e pesquisadores | ~22,9 mil estrelas no GitHub (`chidiwilliams/buzz`) [25] | Gratuito e open source (licença MIT) [26][27] |
| **Jan** | Offline-first, servidor loopback e chaves locais | Desktop (Windows, macOS, Linux) | Usuários focados em privacidade local | ~14 mil a 45,7 mil+ estrelas no GitHub (`janhq/jan`) [19][28][29] | Gratuito e open source (Apache 2.0) [30] |
| **Cursor** | BYOK, Privacy Mode, limites de gasto e cobrança | Desktop (Windows, macOS, Linux) | Desenvolvedores de software | >1 milhão de DAUs; >50.000 empresas; ARR >US$ 3–4 bi em 2026 [31][32][33] | Freemium (Free limitado; planos pagos de US$ 8 a US$ 200/mês + excedente) [34] |
| **Raycast AI** | BYOK, Ollama local, higiene macOS HIG | Desktop (macOS; beta Windows) + iOS | Power users e devs no macOS | Principal launcher alternativo ao Spotlight no macOS; expansão para iOS e Windows [35][36] | Freemium (launcher grátis; Pro a US$ 10/mês exigido para AI/BYOK) [37][38] |
| **Zed** | App Rust nativo, chaves no keyring e tokens/contexto | Desktop (macOS, Linux, Windows) | Desenvolvedores buscando baixa latência | ~95.000+ estrelas no GitHub (`zed-industries/zed`); centenas de milhares de usuários [39][40] | Open source (GPL/AGPL/Apache); Personal grátis com BYOK/local; Pro US$ 10/mês [41][42] |

---

## Ferramenta por ferramenta

### 1. Figma Desktop

- **Estrutura de navegação:** Baseada em navegador multi-abas no topo da janela: uma aba fixa de *File Browser* (`Recents`, `Drafts`, equipes/projetos) e abas de documento abertas lado a lado, incluindo grupos de abas e *Split Tabs* para visão paralela [43][44][45].
- **Fluxo da etapa (abrir, recentes e arquivo portátil):** Ao abrir o app, o usuário cai em `Recents` (vinculado à conta/workspace ativo) [46]. Para criar cópia portátil offline (`.fig`), acessa `File > Save local copy`; para reabrir um `.fig`, arrasta o arquivo diretamente para o *File Browser* [47][48]. O arquivo portátil não carrega histórico de versões nem comentários [47].
- **Layout:** Barra superior única fundida à barra de título do SO com abas no topo, barra de ferramentas contextual e dois painéis laterais recolhíveis (camadas/páginas à esquerda, inspetor de propriedades à direita) em torno do canvas central.
- **Trabalho longo:** Abertura e sincronização de arquivos pesados mostram barra de progresso no topo da aba/canvas sem bloquear outras abas.
- **Estados vazio/carregando/erro:** `Recents` e rascunhos vazios oferecem CTA direto de criação/importação; falhas de memória exibem banner de aviso no topo da aba.
- **Atalhos e teclado:** Segue convenções nativas de abas (`Cmd/Ctrl+W`, `Cmd/Ctrl+T`, troca numérica de abas), além de ações rápidas (`Cmd/Ctrl+/` ou `Cmd/Ctrl+P`, equivalente à paleta de comandos) e barra de menu nativa integrada [49].
- **Elogios e reclamações:** Usuários elogiam manter o trabalho separado do navegador, a barra de abas e a integração de menu nativo [49]; reclamam fortemente do consumo excessivo de RAM (7–9 GB+ com poucas abas pesadas por causa de um processo renderer por aba), descarte tardio de abas inativas (48 h) e perda do estado das abas após reinício forçado [49][50].

### 2. Linear

- **Estrutura de navegação:** Arquitetura *master-detail* em duas colunas principais: barra lateral esquerda fixa (Inbox, My Issues, Teams, Projects, Views) e lista ou quadro central que abre o detalhe do item no mesmo fluxo ou em painel lateral sem recarregar página [51][52].
- **Fluxo da etapa (navegação instantânea e comandos):** O usuário escolhe o contexto via clique na sidebar ou via paleta `Cmd/Ctrl+K` / sequências de duas teclas (`G` depois `I`, `P`, `S`) [53][54]. A criação de item (`C`) abre modal leve sobre qualquer tela sem perder o contexto da lista.
- **Layout:** Sidebar compacta de largura ajustável, cabeçalho fino com breadcrumbs e filtros em barra horizontal, e área principal densa em lista virtualizada ou board.
- **Trabalho longo:** Sincronização e ações ocorrem de forma otimista em segundo plano (dados cacheados em IndexedDB/memória local + WebSockets) [55], eliminando telas de carregamento entre rotas.
- **Estados vazio/carregando/erro:** Listas vazias (ex.: Inbox zerado ou filtro sem retorno) mostram ícone minimalista, explicação objetiva e atalho ou botão para limpar filtros/criar item [não confirmado se há CTA em todas as views; padrão descrito por usuários].
- **Atalhos e teclado:** Referência de UX *keyboard-first*: `Cmd/Ctrl+K` lista ações com o respectivo atalho ao lado para aprendizado passivo [56]; `?` abre folha pesquisável de atalhos [53]; `J`/`K` ou setas movem o foco na lista; `E` edita, `S` muda status, `Esc` volta [54].
- **Elogios e reclamações:** Usuários elogiam a resposta instantânea, a densidade limpa em tema escuro e a paleta `Cmd/Ctrl+K` [55][56][57]; criticam ações disparadas no `mousedown` (impedindo cancelar o clique arrastando o cursor para fora) [58], curva de aprendizado para usuários não técnicos e acúmulo gradual de complexidade na busca global [59][60].

### 3. OBS Studio

- **Estrutura de navegação:** Workspace livre de janela única composto por um preview central cercado por painéis acopláveis (*Docks*: Cenas, Fontes, Mixer de Áudio, Transições, Controles), com configurações globais em janela modal separada (`Settings` com abas verticais) [61][62].
- **Fluxo da etapa (wizard + separação Perfil vs. Coleção):** Na primeira execução, abre automaticamente o **Auto-Configuration Wizard** (também acessível em `Tools > Auto-Configuration Wizard`): pergunta o objetivo principal (stream vs. gravação), testa CPU/GPU (NVENC/AMF/x264) e banda, e grava as recomendações [63]. Depois, separa estritamente **Profile** (encoder, bitrate, caminhos, hardware — no menu `Profile`) de **Scene Collection** (cenas, fontes e áudio — no menu `Scene Collection`), ambos exportáveis/importáveis em JSON [62][64].
- **Layout:** Barra de menu superior clássica (`File`, `Edit`, `View`, `Docks`, `Profile`, `Scene Collection`, `Tools`, `Help`), preview no centro, docks ancorados nas bordas inferiores/laterais e barra de status no rodapé (CPU %, FPS, tempo de gravação).
- **Trabalho longo:** Gravação/transmissão exibe status contínuo na barra inferior e botão alternável (`Start/Stop Recording` + ícone de pausa).
- **Estados vazio/carregando/erro:** Lista de Fontes vazia mostra área em branco com botões `+`/`-` na base do dock; avisos de sobrecarga de encoder aparecem na barra de status inferior.
- **Atalhos e teclado:** Barra de menu nativa e hotkeys globais configuráveis em `Settings > Hotkeys` (por cena/fonte/ação), porém sem paleta de comandos unificada.
- **Elogios e reclamações:** Criadores elogiam o wizard inicial por evitar configuração manual de bitrate/encoder [63] e a flexibilidade dos docks para múltiplos monitores; novatos reclamam que a tela inicial parece um monte caótico de "caixas flutuantes", que o redimensionamento de docks trava por tamanhos mínimos e que `Lock Docks` se comporta de forma inconsistente, exigindo `Docks > Reset UI` [61][65].

### 4. Audacity

- **Estrutura de navegação:** Janela clássica de documento único/múltiplo com barra de ferramentas superior (transporte + edição), área central de trilhas empilhadas e barra de status inferior (taxa de amostragem, seleção) [66].
- **Fluxo da etapa (projeto SQLite portátil e recuperação):** Cada Projeto é salvo como um único arquivo `.aup3` (banco SQLite 3 contendo tabelas `project`, `autosave` e blocos de áudio `sampleblocks`), substituindo o antigo par `.aup` + pasta `_data` que causava perda de áudio quando o usuário movia só um dos dois [67][68][69]. Se o `.aup3` corromper por desligamento abrupto, disco cheio ou pasta sincronizada em nuvem (OneDrive/Google Drive), há utilitário separado `audacity-project-tools -recover_db` [70][71].
- **Layout:** Menu superior completo (`File`, `Edit`, `Select`, `View`, `Transport`, `Tracks`, `Generate`, `Effect`, `Analyze`, `Tools`, `Help`), barras de ferramentas modulares no topo e timeline de formas de onda ocupando ~80% da área.
- **Trabalho longo:** Efeitos e exportações abrem diálogo modal bloqueante com barra de progresso e botões `Stop`/`Cancel` [não confirmado se todas as versões recentes mantêm modal em 100% das operações; confirmado para salvamento na barra de status e recuperação sem barra de progresso em CLI] [71][72].
- **Estados vazio/carregando/erro:** Área vazia exibe apenas o fundo cinza das trilhas sem onboarding inline guiado [não confirmado para versões 4.x]; erros de banco SQLite exibem códigos técnicos crus como `sqlite3.rc 101 - sample block is missing` [73].
- **Atalhos e teclado:** Atalhos tradicionais (`Ctrl/Cmd+Z` desfazer, `Space` play/pause, `Ctrl/Cmd+S` salvar), expostos ao lado de cada item na barra de menus.
- **Elogios e reclamações:** Elogiado pela agilidade em cortes rápidos e pela evolução recente de racks de efeitos em tempo real [74]; criticado pelo tamanho inflado dos arquivos `.aup3`, risco de corrupção em pastas de nuvem e confusão entre edições destrutivas permanentes e clipes ocultos/não destrutivos [70][74].

### 5. HandBrake

- **Estrutura de navegação:** Janela principal focada em um único arquivo/lote por vez (seletor de fonte no topo → resumo/abas horizontais de configuração no meio: *Summary*, *Dimensions*, *Filters*, *Video*, *Audio*, *Subtitles*, *Chapters*) mais uma **janela separada de Fila (`Queue`)** aberta pela barra de ferramentas [75][76].
- **Fluxo da etapa (fila de conversão longa):** Usuário abre pasta ou arquivo → escolhe preset na barra lateral/dropdown → clica em `Add to Queue` (ou abre a seta do botão para `Add All` ao processar pastas) → abre a janela `Queue` para reordenar, pausar, retomar ou definir ação **When Done** (*Do Nothing*, *Shutdown*, *Sleep*, *Hibernate*, *Log Off*) [76][77][78].
- **Layout:** Toolbar superior com ações principais (`Open Source`, `Start Encode`, `Pause`, `Add to Queue`, `Queue`), corpo em abas para parâmetros da Fonte atual e rodapé com destino de saída e progresso resumido.
- **Trabalho longo:** Barra de progresso com percentual, FPS, ETA e botão `Pause` (que conclui o bloco atual com segurança antes de liberar CPU/GPU) e retomada via `Start Queue` [77][79]. Emite notificação nativa do SO ao concluir fila/encode [80]. Se fechar o app com job interrompido/pausado, marca o item na reabertura com **ícone de aviso**, exigindo reset ou retomada manual para evitar corrupção [81].
- **Estados vazio/carregando/erro:** Ao abrir sem Fonte, exibe painel lateral de escolha de arquivo/pasta (*Source Selection*); falhas de fila exigem inspeção do log da atividade.
- **Atalhos e teclado:** Barra de menus nativa no macOS/Windows/Linux com atalhos padrão de fila e início/pausa.
- **Elogios e reclamações:** Celebrado por tornar o FFmpeg acessível com presets claros e preview rápido [82]; criticado no Reddit pela "armadilha" do botão `Add to Queue` — usuários escaneiam uma pasta inteira, clicam no botão principal achando que enfileirou tudo e descobrem depois que só o primeiro vídeo foi processado por não terem aberto a seta oculta `Add All` [82].

### 6. Steam (Downloads)

- **Estrutura de navegação:** Barra de navegação superior em abas principais (*Store*, *Library*, *Community*, Perfil) com acesso à página dedicada de **Downloads** tanto pelo rodapé global persistente quanto pelo menu [83].
- **Fluxo da etapa (download pesado e espaço em disco):** Antes de baixar, verifica espaço livre e pré-aloca/reserva disco; durante o download, exibe gráfico em tempo real separando **taxa de rede (azul)** de **uso de disco/descompressão (verde)**, progresso percentual, bytes baixados vs. instalados e ETA dinâmico [83][84][85]. Usuário pode pausar, retomar (com retomada exata por faixa de bytes/manifesto), reordenar por drag-and-drop, promover item ("Download Now"), limitar banda ou agendar janela horária (ex.: 2h–6h) [83][84].
- **Layout:** Na página dedicada: cabeçalho com gráfico agregado de rede/disco + picos e controles globais de pausa/configuração; abaixo, lista vertical dividida em *Up Next* (fila ativa), *Scheduled* e *Completed*, cada linha com miniatura, progresso e botões contextuais de ação [83]. No restante do app: barra fina fixa no rodapé indicando progresso global clicável [83].
- **Trabalho longo:** Estado de downloads persiste em arquivos locais de manifesto ao fechar o app e retoma exatamente do bloco verificado [84]; permite pausar downloads automaticamente ao iniciar tarefa principal pesada [84].
- **Estados vazio/carregando/erro:** Fila vazia mostra estado limpo indicando que todos os itens estão atualizados; erros de disco cheio ou falha de gravação interrompem o job com mensagem clara antes ou durante a etapa de alocação [84].
- **Atalhos e teclado:** Foco principalmente em mouse/controle (Big Picture), com configurações globais acessíveis por menu superior.
- **Elogios e reclamações:** Amplamente elogiado pela transparência de métricas (rede vs. disco, ETA, controle granular por item e rodapé global não intrusivo) [83][85]; o principal ruído reportado no Reddit é usuários confundirem o gráfico serrilhado ("montanha-russa" causada pela descompressão local saturando o disco) com falha de internet quando a UI não explica textualmente que o gargalo atual é o SSD/HDD [85][86].

### 7. Topaz Video AI

- **Estrutura de navegação:** Workspace de editor centrado no player de preview (comparação lado a lado/split) com barra lateral direita de parâmetros/modelos de IA e gaveta/painel inferior de **fila de processamento e exportação** [87][88].
- **Fluxo da etapa:** Usuário importa vídeo → escolhe presets/modelos (upscale, interpolação, estabilização) no painel direito → se o modelo não estiver baixado, o app tenta baixar os pesos em segundo plano antes do preview/export → envia para a fila inferior.
- **Layout:** Player central ocupando a maior parte da tela, timeline fina abaixo do vídeo, inspetor de modelos à direita e fila de jobs na faixa inferior.
- **Trabalho longo:** Fila processa jobs em paralelo ou sequência com barra de progresso por item e estimativa de tempo, porém sem retomada confiável após crash.
- **Estados vazio/carregando/erro:** Estado vazio oferece área de arrastar vídeo; erros de VRAM exibem alertas abruptos ("Can't run model - lower VRAM usage") sem pré-validação antes de iniciar o render [89][90].
- **Atalhos e teclado:** Atalhos básicos de reprodução e preview; ajustes dependem fortemente do mouse.
- **Elogios e reclamações:** Elogiado pela qualidade visual dos modelos [14][15]; duramente criticado no Reddit por: (1) **loops infinitos de "Downloading Model"** ou travamentos quando offline [87][91]; (2) **crashes após horas de render** que fecham a GUI deixando o `ffmpeg` órfão rodando em segundo plano [87][92]; (3) saturação de VRAM levando a falhas tardias, forçando usuários a limitar jobs paralelos a `1` e fatiar vídeos manualmente [89][93]; e (4) mudanças abruptas de UI entre versões levando usuários a fazer downgrade [88][92].

### 8. LM Studio

- **Estrutura de navegação:** Barra lateral esquerda icônica estreita com 4–5 áreas claras: **Chat** (uso), **Discover** (catálogo/busca de modelos no Hugging Face), **My Models** (inventário local e remoção), **Developer** (servidor HTTP local `localhost:1234` + logs) e **Settings** [94][95].
- **Fluxo da etapa (hardware/VRAM + download pesado):** Ao abrir, detecta automaticamente GPU VRAM, RAM do sistema ou memória unificada Apple Silicon [94][96]. Na aba *Discover*, cada quantização GGUF exibe **selos de compatibilidade** (*Full GPU Offload Possible*, *Partial*, *Likely too large*) antes de clicar em baixar [94][97]. O gerenciador de downloads permite **pausar e retomar** arquivos de vários GB e acompanha o progresso em gaveta/barra persistente [94][98].
- **Layout:** Rail esquerdo fixo de navegação, área central adaptada à aba (lista + inspetor de quantizações no *Discover*; chat + painel direito de parâmetros de carga/GPU offload no *Chat*; console de requisições no *Developer*).
- **Trabalho longo:** Barra/gaveta dedicada de downloads com status (`downloading`, `paused`, `completed`, `failed`) e opção de carga de modelo com barra de progresso em memória/VRAM [94][98].
- **Estados vazio/carregando/erro:** Se nenhum modelo estiver carregado no *Chat*, mostra seletor proeminente no topo ("Select a model to load") e link para *Discover*; na aba *Developer*, exibe chave explícita para iniciar/parar servidor local e toggle separado para *Serve on Local Network* [95].
- **Atalhos e teclado:** Suporta atalhos para novo chat, troca rápida de modelo e acesso às configurações.
- **Elogios e reclamações:** Muito elogiado pela facilidade de descobrir, comparar quantizações com selos de VRAM e baixar modelos pesados sem tocar em CLI [94][99]; criticado no Reddit quando configurações padrão de carregamento derramam camadas para a RAM do sistema derrubando a velocidade para dígitos únicos de tokens/s sem deixar óbvio o ajuste de *GPU offload*, além de erros de runtime em AMD ROCm/Vulkan [96][100][101].

### 9. ComfyUI Desktop

- **Estrutura de navegação:** Lançador/gerenciador de instalações múltiplas na entrada que abre o **workspace de grafo nodal em tela cheia**, com barra lateral recolhível para biblioteca de nós, modelos, fila de prompts (*Queue*) e histórico de saídas [102][103].
- **Fluxo da etapa (onboarding Python/`uv`/CUDA e espaço em disco):** O instalador desktop isola ambientes Python gerenciados (com adoção crescente de `uv` para puxar wheels PyTorch/CUDA ou CPU/MPS/XPU sem depender do Python do sistema), solicita escolha de pasta de trabalho e recomenda ao menos **4,85 GB livres apenas para a base** (alertando que modelos adicionais crescem para dezenas/centenas de GB) [102][103][104]. Permite compartilhar pastas externas de modelos via `extra_model_paths.yaml` para não duplicar pesos entre instalações [104][105].
- **Layout:** Menu superior discreto, canvas nodal infinito ocupando quase 100% da janela, painel flutuante ou lateral de controle da fila (`Queue Prompt`, contador de pendentes) e console de logs recolhível.
- **Trabalho longo:** Fila sequencial persistente de execuções com destaque visual do nó ativo no grafo e barra de progresso de amostragem.
- **Estados vazio/carregando/erro:** Primeiro uso abre workflow template padrão; falta de VRAM ou conflito de dependências Python interrompe a execução destacando o nó com borda vermelha e log técnico.
- **Atalhos e teclado:** `Ctrl/Cmd+Enter` enfileira o prompt; atalhos de canvas (zoom, pan, bypass de nó).
- **Elogios e reclamações:** Elogiado por eliminar a barreira inicial de configurar Python/PyTorch manualmente e permitir separar a pasta pesada de modelos [106][107]; muito criticado no Reddit porque instalações de custom nodes quebram o ambiente Python com conflitos de versão (forçando apagar e reinstalar o app inteiro) e porque caches em `AppData`/`Documents` e modelos consomem armazenamento sem visibilidade clara [107][108][109].

### 10. Buzz (Whisper Desktop)

- **Estrutura de navegação:** Janela principal simples de lista de tarefas/transcrições (estilo fila de importação), abrindo um diálogo modal de configuração por arquivo (`New Transcription`: modelo, idioma, tarefa Transcribe/Translate) e uma janela separada de visualização/edição e exportação da Transcrição (SRT/VTT/TXT) [110][111].
- **Fluxo da etapa (modelos locais e GPU/CPU):** Usuário escolhe arquivo ou gravação ao vivo → seleciona backend (`Whisper`, `faster-whisper`, `whisper.cpp`) e tamanho do modelo (`tiny` a `large`) → na primeira vez com aquele modelo, o app baixa os pesos automaticamente para o diretório de cache do SO (`%LOCALAPPDATA%\Buzz` no Windows, `~/Library/Caches/Buzz` no macOS, `~/.cache/Buzz` no Linux) com barra de progresso [111][112]. Suporta CUDA (NVIDIA), Metal/CoreML (Apple Silicon), Vulkan (`whisper.cpp`) e variável de escape `BUZZ_FORCE_CPU` quando drivers de GPU travam [113][114].
- **Layout:** Toolbar enxuta no topo (`+` nova transcrição, gravação ao vivo, preferências), tabela central com status/duração/arquivo e janela secundária de texto sincronizado com player de áudio.
- **Trabalho longo:** Fila de arquivos com status individual (`Queued`, `In Progress`, `Completed`, `Failed`) e barra de progresso; no menu `Help > About Buzz` exibe disponibilidade de CUDA [112][113].
- **Estados vazio/carregando/erro:** Lista inicial vazia exibe instrução simples para importar arquivo; se o download do modelo travar, usuários recorrem a baixar manualmente para a pasta de cache [112][115].
- **Atalhos e teclado:** Controles básicos de arquivo e reprodução no visualizador.
- **Elogios e reclamações:** Elogiado pela privacidade 100% offline e por esconder a complexidade de Python/CLI do Whisper [116]; criticado em issues do GitHub por downloads de modelo que travam sem erro acionável, uso alto de CPU sem GPU, bugs de transcrições excluídas reaparecendo ao reiniciar e fluxo limitado para grandes lotes [114][117].

### 11. Jan

- **Estrutura de navegação:** Layout de três regiões inspirado em clientes de chat modernos: barra lateral esquerda fixa (conversas/projetos, acesso ao **Hub de Modelos**, **Servidor API Local** e **Configurações**), área central ativa e painel direito recolhível de parâmetros do modelo/hardware [118][119].
- **Fluxo da etapa (offline-first, hardware e Provedores):** Funciona 100% offline por padrão usando `llama.cpp` ou `MLX` [118][119]. No **Hub**, mostra se o modelo cabe na máquina do usuário antes de baixar do Hugging Face [120]. Nas configurações de Provedor, separa claramente motores locais (incluindo servidor loopback próprio em `http://localhost:1337`) de conectores remotos onde o usuário insere chaves de API (OpenAI, Anthropic, Groq) [118][121].
- **Layout:** Sidebar estreita com alternância de modos principais (*Thread*, *Hub*, *System Monitor*, *Settings*), chat central limpo e inspetor direito para temperatura, contexto e offload GPU/CPU.
- **Trabalho longo:** Barra de progresso para download de modelos no Hub e carregamento do modelo em memória; barra inferior com monitor de uso de RAM/VRAM.
- **Estados vazio/carregando/erro:** Empty state do chat sugere selecionar/baixar um modelo; falhas de carga em `ggml`/GPU frequentemente deixavam o usuário sem diagnóstico legível, motivando épico específico no GitHub para diagnósticos in-app [120][122].
- **Atalhos e teclado:** Paleta rápida e atalhos padrão de novo chat/envio.
- **Elogios e reclamações:** Elogiado no `r/LocalLLaMA` pela confiança do código aberto (Apache 2.0), funcionamento 100% local e indicadores de compatibilidade de hardware [30][120]; criticado por UI "áspera nas bordas", loops de carregamento, offload parcial instável e problemas de foco de janela ao abrir segunda instância [120][122].

### 12. Cursor

- **Estrutura de navegação:** Baseado no shell do VS Code: barra de atividades na extrema esquerda, explorador/barra lateral esquerda, editor central em abas, painel direito dedicado de Chat/Agente de IA e `Settings` em abas internas (`Cursor Settings > Models / Features / Billing`) [123][124].
- **Fluxo da etapa (BYOK, Privacy Mode e limites de gasto):** Em `Cursor Settings > Models`, o usuário ativa provedores e cola chaves de API próprias (OpenAI, Anthropic, Gemini, Bedrock) [123]. Em `General / Privacy`, ativa **Privacy Mode** (zero retenção nos provedores da Cursor — porém a doc avisa que **não se aplica** quando usa chave própria BYOK) [125]. Limites de gasto (*Spend Limits*) ficam no painel web (`cursor.com/dashboard > Billing`), não nativamente como orçamento pré-chamada dentro da ação no desktop [126].
- **Layout:** Split vertical clássico de IDE com barra de status inferior (erros, contexto ativo, modo do agente) e seletor de modelo embutido na caixa de prompt.
- **Trabalho longo:** Streaming de resposta inline no painel lateral com botão `Stop`, diffs aceitáveis/rejeitáveis por bloco e histórico de sessões.
- **Estados vazio/carregando/erro:** Painel de chat vazio mostra sugestões/atalhos; ao atingir cota ou erro `429`, exibe aviso inline com link para billing ou troca de modelo.
- **Atalhos e teclado:** `Cmd/Ctrl+K` (edição inline), `Cmd/Ctrl+L` / `Cmd/Ctrl+I` (chat/agente), `Cmd/Ctrl+Shift+P` (paleta de comandos).
- **Elogios e reclamações:** Elogiado pela velocidade de fluxo de código; **duramente criticado no Reddit** pelo que usuários chamam de "dark patterns" de cobrança: limites padrão de on-demand (ex.: US$ 41–50) sem bloqueio rígido em US$ 0 de fábrica, faturas surpresa de centenas de dólares e **confusão no BYOK**, onde usuários colam suas chaves mas ainda recebem cobranças on-demand por recursos internos que contornam a chave [127][128][129].

### 13. Raycast AI

- **Estrutura de navegação:** Janela flutuante global invocada por atalho de sistema (sem janela persistente obrigatória), navegação hierárquica em pilha (*push/pop* com `Esc` para voltar), barra de busca no topo e lista navegável por setas com painel de prévia/detalhe à direita; configurações em janela própria nativa macOS (`Cmd+,`) dividida em abas (*General*, *Extensions*, *AI*) [35][130][131].
- **Fluxo da etapa (BYOK, Ollama local e seleção por comando):** Em `Settings > AI > Models & Providers > Local Models`, o usuário conecta o **Ollama** local (ou host na LAN) e os modelos locais passam a aparecer agrupados junto dos modelos em nuvem no seletor padrão, sem consumir créditos Raycast [132][133]. Também permite configurar **Custom Providers** (LM Studio, proxies) com chaves armazenadas localmente na máquina [133][134]. Cada comando de IA pode fixar seu próprio modelo.
- **Layout:** Extremamente limpo e denso: campo de comando no topo, lista de itens com atalho alinhado à direita e rodapé fixo mostrando a ação primária (`↵`) e menu de ações secundárias (`Cmd+K`).
- **Trabalho longo:** Streaming rápido em janela flutuante ou janela dedicada de *AI Chat* com histórico lateral.
- **Estados vazio/carregando/erro:** Se o Ollama não estiver instalado/rodando, Raycast guia diretamente para instalação ou avisa inline na lista de modelos [132].
- **Atalhos e teclado:** Referência absoluta de navegação 100% por teclado no macOS (`Cmd+K` abre menu de ações contextuais do item focado, `Esc` volta um nível na pilha, `Cmd+,` abre Preferências) [35][135].
- **Elogios e reclamações:** Elogiado pela velocidade nativa, aderência ao Apple HIG e integração perfeita entre busca local e IA [35][136]; sofreu forte **reação negativa no Reddit** ao colocar **BYOK e modelos locais atrás da assinatura paga Raycast Pro**, percebido pela comunidade como cobrança dupla para quem já paga a própria chave ou roda hardware local [137][138].

### 14. Zed

- **Estrutura de navegação:** Editor nativo em Rust (framework GPUI) com barra de título integrada ao workspace, árvore lateral esquerda opcional, abas centrais divididas em panes e painel direito de **Agent / Assistant**, além de `Agent Settings` acessíveis por ícone ou `settings.json` [139][140].
- **Fluxo da etapa (chaves no keyring, modelos locais e contexto):** Em `Agent Settings > LLM Providers`, usuário escolhe provedores (Anthropic, OpenAI, Ollama, LM Studio) [141]. Chaves inseridas na UI são gravadas no **keychain nativo do SO** (nunca em texto puro no `settings.json`), enquanto variáveis de ambiente têm precedência explícita [141]. Para modelos locais (Ollama/LM Studio), permite configurar endpoint (`localhost:11434` / `1234/v1`) e declarar explicitamente **`max_tokens` / janela de contexto** para evitar o fallback conservador de `4096` tokens do Ollama [142][143].
- **Layout:** Minimalismo de alta performance com foco em código, painéis laterais recolhíveis e barra de status enxuta mostrando uso de tokens/contexto na thread ativa.
- **Trabalho longo:** Indicador sutil de streaming e cancelamento inline no painel do agente; indexação em segundo plano sem travar a interface.
- **Estados vazio/carregando/erro:** Sem chave configurada, guia diretamente para a tela de provedores; permite **desligar completamente toda a interface de IA** nas preferências para quem quer uso tradicional [144][145].
- **Atalhos e teclado:** Paleta `Cmd/Ctrl+Shift+P`, atalhos de painel (`Cmd/Ctrl+?` ou toggle de docks) e edição modal/VS Code configurável.
- **Elogios e reclamações:** Elogiado pela latência mínima (startup e UI nativos em Rust), tipografia limpa, armazenamento seguro no keyring e possibilidade de ocultar a IA [144][146]; criticado no Reddit por priorizar entregas rápidas de agentes de IA sobre estabilidade básica e recursos clássicos de editor (como desfazer exclusão de arquivos ou melhorias de busca) [144][147].

---

### Referência normativa de plataformas (Microsoft Fluent 2, Apple HIG, GNOME HIG e NN/g)

| Dimensão | Microsoft Fluent 2 (Windows) | Apple HIG (macOS) | GNOME HIG (Linux / Adwaita) | Síntese NN/g |
|---|---|---|---|---|
| **Barra de título e janela** | Altura padrão de **32 px** com material Mica; áreas vazias devem ser arrastáveis e controles interativos (busca/abas) excluídos da zona de drag; controles do sistema à direita [148]. | Barra de menu global persistente no topo da tela (`File`, `Edit`, `View`, `Window`, `Help`); comandos indisponíveis ficam desabilitados, nunca ocultos [149]. | **Header Bar** combina arraste/fechamento com navegação à esquerda, título/view switcher ao centro e menu à direita; evitar botões de texto puro ou destrutivos na header bar [150]. | Consistência com convenções da plataforma reduz carga cognitiva (Heurística #4) [151]. |
| **Atalhos e Preferências** | `Ctrl+,` para Configurações, `Ctrl+W` para fechar aba/view, `Alt`/`F10` foca barra de menu [152]. | `Cmd+,` obrigatório para Settings; atalhos exibidos ao lado de cada comando nos menus para aprendizado [135][153]. | `Ctrl+,` Preferências, `Ctrl+W` fechar aba, `Ctrl+Q` sair, `Ctrl+?` diálogo de atalhos, `Ctrl+Z`/`Shift+Ctrl+Z` desfazer/refazer; evitar `Alt` (acessibilidade) e `Super` (sistema) [154][155]. | Atalhos consistentes e descobíveis aceleram usuários avançados sem penalizar iniciantes [156]. |
| **Progresso e trabalho longo** | Determinado (barra %) quando duração/escopo é conhecido; indeterminado quando desconhecido; posicionar próximo ao gatilho sem bloquear a UI sem necessidade [157]. | Indicadores transitórios (somem ao concluir): barra determinada para downloads/conversões, spinner/barra indeterminada para rede [158]. | Progresso inline junto ao item ou faixa sutil sob a header bar; **incluir botões de Pausar e/ou Cancelar** em tarefas pesadas [159]. | Visibilidade do status do sistema (Heurística #1) reduz incerteza e cliques repetidos [160][161]. |
| **Estados vazios e erros** | Nunca deixar branco: ícone + explicação concisa + CTA primário + anúncio em *live region* acessível [157]. | Texto claro explicando o porquê da ausência + botão acionável direto; evitar poluir com dicas permanentes que sumirão [162]. | Padrão de *Status Page* com ícone, título, descrição curta e ação principal [não confirmado em texto direto, inferido do padrão Adwaita]. | Empty states comunicam status, ensinam o espaço e dão caminho imediato de saída; erros ficam junto ao campo com causa e correção (sem códigos crus) [163][164][165]. |
| **Ações destrutivas e desfazer** | Diálogos claros quando irreversível [padrão Windows/NN/g]. | Reservar alertas modais apenas para ações **incomuns e irreversíveis**; não interromper rotinas facilmente desfazíveis; itens destrutivos no fim do menu em vermelho após divisor [166][167]. | **Preferir Desfazer (toast transitório) a diálogo de confirmação** para não quebrar fluxo; só usar diálogo de confirmação se desfazer for impossível [168]. | Confirmar tudo gera *habituação* (clicar "Sim" sem ler); priorizar **Undo** e guardar modais para risco real [169]. |
| **Tema e densidade** | Grade base de **4 px**; variantes de densidade (ex.: compacta) e tokens semânticos que ajustam contraste em modo escuro [170][171]. | Seguir aparência do sistema (claro/escuro) com cores semânticas; evitar forçar tema isolado sem justificativa de mídia imersiva [135][172]. | Seguir `color-scheme` (`prefer-dark` / `prefer-light`) do sistema via Freedesktop/gsettings [173]. | — |

---

## Padrões recorrentes

1. **Tela inicial de Projetos recentes com detecção de disponibilidade e abertura/criação no topo:**
   Figma Desktop, Audacity, OBS (coleções/perfis) e apps de workspace colocam a lista de Projetos recentes e as ações de `Criar` / `Abrir` logo na entrada — nunca no rodapé da página. Projetos baseados em arquivo local (`.aup3` no Audacity, `.fig` no Figma) explicitam quando um arquivo sumiu ou foi movido e oferecem caminho direto de relocalização ou importação por arraste [47][48][67].
2. **Navegação híbrida — Wizard na primeira vez / fluxos lineares raros, Workspace livre + Paleta no uso diário:**
   OBS Studio (Auto-Configuration Wizard + docks livres) [61][63], ComfyUI Desktop (instalador guiado + canvas) [102] e Raycast/Linear (paleta `Ctrl/Cmd+K` sobre workspace) [56][135] convergem na recomendação da NN/g [151][174]: usar **etapas guiadas (wizard)** apenas para configuração inicial ou fluxos dependentes ocasionais, e **abas/painéis livres** para tarefas paralelas recorrentes, sempre mantendo indicador persistente de "onde estou".
3. **Fila de jobs desacoplada da tela que a disparou + indicador global persistente:**
   Steam Downloads, HandBrake, Topaz Video AI e Buzz separam a visualização de jobs ativos do formulário que criou o trabalho. O padrão vencedor (Steam e HandBrake) combina **indicador compacto global** (rodapé ou badge na barra superior com contagem/progresso) + **tela/gaveta dedicada de fila** com ações por item (pausar, retomar, cancelar, prioridade, retry) e notificação nativa do SO ao finalizar [76][77][80][83].
4. **Retomada por blocos/checkpoints e sinalização explícita de jobs interrompidos após fechar o app:**
   Steam persiste offsets de blocos verificados (`Range`) e retoma de onde parou [84]; HandBrake detecta jobs interrompidos ao fechar o app e os marca com ícone de aviso exigindo ação explícita do usuário antes de rodar de novo [81].
5. **Pré-checagem de hardware/VRAM e armazenamento antes de baixar dependências pesadas:**
   LM Studio e Jan analisam RAM/VRAM antes de o usuário clicar em baixar modelos de vários GB, exibindo selos de compatibilidade (*cabe na GPU* vs. *lento em CPU*) [94][120]; ComfyUI Desktop informa o espaço base mínimo (`4,85 GB`) e separa diretórios de código/ambiente (`uv`/venv) da pasta de modelos para permitir reinstalação sem perder GBs baixados [102][104][107]; Steam verifica e aloca espaço em disco antes de baixar [84].
6. **Chaves de IA no cofre do SO (keyring) e separação nítida entre local (loopback) e remoto:**
   Zed grava chaves exclusivamente no keychain do sistema operacional (nunca em JSON de configuração) [141]; LM Studio, Jan e Raycast separam visualmente modelos em `localhost`/`127.0.0.1` (custo zero, sem saída de rede) de conectores externos ou exposição em LAN [95][118][132][133].
7. **Segurança sem atrito excessivo — Undo antes de modal, confirmação só no irreversível ou financeiro:**
   Apple HIG [166], GNOME HIG [168] e NN/g [169] concordam: ações reversíveis usam `Ctrl/Cmd+Z` ou toast com "Desfazer"; modais de confirmação ficam restritos a perda permanente de dados ou gasto financeiro/externo irreversível.
8. **Respeito automático ao tema do sistema + atalhos padronizados por SO:**
   Apple HIG, Fluent 2 e GNOME HIG exigem herdar o tema claro/escuro do SO por padrão (com opção explícita se houver mídia imersiva), usar `Cmd` no macOS vs. `Ctrl` no Windows/Linux, `Cmd/Ctrl+,` para Preferências e `Ctrl+Z` / `Shift+Ctrl+Z` para desfazer/refazer [135][152][154][172][173].

---

## Divergências e trade-offs

| Decisão de UX | Caminho A (e quem adota) | Caminho B (e quem adota) | Trade-off real |
|---|---|---|---|
| **Projeto portátil: arquivo único vs. pasta estruturada** | **Arquivo monolítico SQLite** (Audacity `.aup3`, Figma `.fig`) [47][67] | **Pasta portátil `.clipes` com SQLite + subpastas `media/`, `backups/`** (Clipes; OBS exporta coleções separadas) [62] | Arquivo único evita perder dependências ao copiar, mas infla rapidamente e dificulta recuperar mídias se corromper (Audacity exige CLI externa) [70][71]. Pasta `.clipes` permite backups rotativos e referências externas leves sem duplicar vídeos de 20 GB, exigindo UX clara para *Fonte offline / relocalizar*. |
| **Estrutura da janela: abas vs. workspace com painéis/docks vs. wizard** | **Abas de documento** (Figma, Cursor, Zed) ou **Docks livres** (OBS) [43][61][139] | **Fluxo linear guiado / etapas** (HandBrake tabs sequenciais; wizards de instalação) [75][174] | Docks livres maximizam poder, mas intimidam iniciantes ("caixas soltas" no OBS) [61]. Wizard reduz sobrecarga inicial, mas engessa quem já tem Fontes prontas e quer pular direto para revisão/exportação. |
| **Visibilidade da fila de jobs** | **Janela/página dedicada + barra de rodapé persistente** (Steam, HandBrake) [76][83] | **Progresso apenas inline ou modal bloqueante** (Audacity efeitos, Buzz parcial) [72][111] | Modal bloqueia o app inteiro durante tarefas de minutos/horas. Progresso só inline some quando o usuário navega para outra etapa. O par **rodapé/header compacto + painel de fila** mantém contexto sem bloquear navegação. |
| **Controle de gasto em IA (BYOK)** | **Painel web em pós-pago com limite frouxo** (Cursor dashboard) [126][127] | **Sem cobrança no app / chaves diretas ou local grátis** (Zed BYOK, Jan, LM Studio) [20][118][141] | Pós-pago sem pré-aviso e sem trava rígida gera faturas inesperadas e revolta (Cursor) [127]. Mostrar faixa estimada *antes* da chamada e aplicar teto *antes* do disparo dá previsibilidade total, ao custo de mais um passo de confirmação em operações pagas. |
| **Onboarding de dependências Python/ML** | **Instalador tudo-em-um opaco com custom nodes compartilhados** (ComfyUI Desktop em fluxos com Manager) [107] | **Ambiente isolado imutável (`uv` + lockfile) + pastas de modelos separadas** (ComfyUI multi-install bem isolado; Buzz cache) [102][104][112] | Permitir extensões livres no mesmo venv quebra o app com conflitos Python [107]; ambiente travado garante estabilidade, desde que a UI traduza erros de CUDA/RAM em diagnóstico humano e permita escolher disco dos modelos antes de encher o `C:`. |
| **Barra de título e menus** | **Barra de título customizada integrada ao conteúdo** (Figma, Fluent 2, GNOME Header Bar) [43][148][150] | **Menu bar nativo clássico do SO** (OBS, Audacity, HandBrake, Apple HIG) [62][66][149] | Header bar customizada economiza altura vertical e unifica abas/breadcrumbs no Windows/Linux, mas no macOS usuários esperam a barra de menus global no topo da tela com atalhos listados [149]. |

---

## Anti-padrões

1. **Cobrança opaca, limites frouxos e "bypass" de BYOK (Cursor e Raycast AI):**
   Usuários no Reddit apontam como quebra grave de confiança: (a) limites on-demand pré-configurados altos em vez de trava padrão em US$ 0, levando a cobranças surpresa de centenas de dólares (Cursor) [127][128]; (b) cobrar assinatura apenas para liberar o uso de chaves próprias BYOK ou modelos locais (Raycast Pro) [137][138]; e (c) usar BYOK mas ainda disparar chamadas paralelas na cota paga da plataforma sem avisar qual chave está pagando o quê [129].
2. **Ações em lote com gatilho escondido e jobs órfãos/crashes sem recuperação (HandBrake, Topaz Video AI e Adobe Media Encoder):**
   No HandBrake, esconder `Add All` atrás de uma seta pequena ao lado de `Add to Queue` faz usuários processarem apenas 1 vídeo de uma pasta inteira por engano [82]. No Topaz Video AI, rodar múltiplos jobs sem pré-checar VRAM causa crash após horas deixando o `ffmpeg` órfão em segundo plano [87][89]. No Adobe Media Encoder, quedas limpam a fila da sessão sem recuperação automática e pausas longas corrompem a retomada [175][176].
3. **Downloads pesados sem visibilidade de espaço, sem retomada confiável e com erros técnicos crus (Topaz Video AI, ComfyUI Desktop, Jan e Audacity):**
   Topaz sofre com loops infinitos de "Downloading Model" e travamento offline [87][91]; ComfyUI acumula dezenas/centenas de GB em modelos e caches sem aviso prévio claro em `AppData`/`Documents` [108][109]; Jan e LM Studio despejam erros brutos de `ggml` ou derramam silenciosamente o modelo da VRAM para a RAM do sistema sem explicar por que caiu para 2 tokens/s [96][100][120][122]; Audacity expõe erros como `sqlite3.rc 101` sem caminho de recuperação na UI [73].
4. **UI de workspace caótica na primeira abertura e conflitos de atalhos:**
   OBS sem o wizard ou após desencaixar painéis apresenta dezenas de "caixas flutuantes" sem hierarquia [61], enquanto ferramentas que misturam atalhos globais com atalhos de painel sem escopo claro geram frustração e ações acidentais (como observado também no inventário v1 do Clipes com `[` e `]`) [177].

---

## Implicações para o Clipes

Cruzando esses padrões com o inventário da UI v1 ([90-inventario-ui-atual.md](../produto/funcionalidades/90-inventario-ui-atual.md)) e os 237 comandos documentados em [funcionalidades.md](../produto/funcionalidades.md), o redesenho do front v2 ganha direção clara em cada etapa da jornada:

### 1. Entrada do app, Projetos portáteis e Fontes ([02-projetos-e-fontes.md](../produto/funcionalidades/02-projetos-e-fontes.md))
- **Tela inicial de Projetos (sem scroll infinito):** Quando `projects.current` for `null` (ou ao acionar `projects.close`, hoje ausente na UI), abrir diretamente uma tela inicial dedicada ao padrão **Figma/Audacity**: ações primárias `Novo Projeto` (`projects.create`) e `Abrir pasta .clipes` (`projects.open`) no topo, seguidas pela lista de `projects.recent` com selo visual de disponibilidade (`available: true/false`) — nunca no rodapé da página como na v1 [177].
- **Projeto portátil e Fontes offline/alteradas:** Inspirado no aprendizado do `.aup3` do Audacity (mas evitando copiar mídias pesadas por padrão), exibir um selo de integridade por Fonte (`available`, `offline`, `changed`) com ação direta `Relocalizar arquivo` (`sources.relocate`) e `Verificar hash` (`sources.hash`), além de diferenciar carregamento inicial de lista vazia (corrigindo o falso "Nenhuma Fonte importada" da v1).
- **Lotes de Fontes sem armadilha do HandBrake:** Em `batches.create`, ao contrário do botão ambíguo `Add to Queue` vs. `Add All` do HandBrake, deixar explícito quantas Fontes foram selecionadas (ex.: `"Processar 12 Fontes em lote"`), com opção visível de teto de custo (`maxCostMicroUsd`) e status por item (`paused` individual sem parar as outras Fontes).

### 2. Navegação do Projeto: Etapas com progresso vs. Workspace livre ([03-transcricao.md](../produto/funcionalidades/03-transcricao.md), [04-selecao-de-cortes.md](../produto/funcionalidades/04-selecao-de-cortes.md), [05-editor.md](../produto/funcionalidades/05-editor.md), [06-roteiro-narracao-e-saida.md](../produto/funcionalidades/06-roteiro-narracao-e-saida.md))
- **Substituir a coluna estreita (`max-w-4xl`) aninhada por navegação real em largura total:** Adotar estrutura *shell* com barra lateral ou barra superior de **etapas do Projeto** (`Fontes` → `Transcrição` → `Seleção e Revisão` → `Editor do Corte` → `Transformação [se Vídeo transformado]` → `Empacotamento e Exportação`), usando roteamento por URL/hash com histórico (`Voltar`/`Avançar`) para nunca perder contexto ao abrir um Corte no editor.
- **Indicador de "em que etapa estou" não bloqueante (padrão híbrido):** Como no Clipes uma Fonte já pode estar transcrita enquanto outra ainda baixa, usar **etapas navegáveis como abas de estágio com badge de prontidão** (ex.: contagem de Fontes transcritas, Cortes pendentes/aprovados, prontos para exportar) em vez de wizard rígido que tranca passos anteriores.
- **Separação Perfil de canal vs. Provedor (padrão OBS):** Deixar claro na UI a fronteira já existente no núcleo: **Perfil de canal** (`channel_profile.*`) viaja dentro do `.clipes` (tipo `Corte direto` vs. `Vídeo transformado`, duração, legenda, voz TTS, `Permissão`), enquanto **Perfis de Provedor** ficam em configurações globais do app.
- **Revisão de Cortes (`04-selecao-de-cortes`) e Edição (`05-editor`):** Na revisão, usar *master-detail* em tela cheia (padrão Linear) com suporte real a teclado (`Tab`, `↑`/`↓`, `Space` para preview, desfazer persistido `selection.undo`), removendo `tabIndex={-1}` e eliminando o conflito de `[` e `]` entre gavetas e bordas. Na revisão de execução (`selection.get { revision }` e `jobs.redo`), expor seletor explícito de revisões para comparar rodadas de diferentes Provedores sem perder aprovações anteriores.
- **Cadeia condicional do Canal dark (`06-roteiro-narracao-e-saida`):** Para `Vídeo transformado`, exibir um *stepper* claro de 3 travas dentro do Corte aprovado (**1. Ângulo** `angles.*` → **2. Roteiro bloco a bloco** `script.*` com aprovação humana → **3. Narração / Montagem** `narration.*`), explicando por que a Narração fica bloqueada até aprovar todos os blocos (`script.narration_allowed`), algo que nenhum concorrente SaaS tem por ser exigência de **Transformação** contra desmonetização ([2026-11-12-canais-dark.md](2026-11-12-canais-dark.md)).

### 3. Onboarding de componentes, espaço em disco e hardware ([01-instalacao-e-sistema.md](../produto/funcionalidades/01-instalacao-e-sistema.md))
- **Wizard enxuto de primeiro uso + manutenção modular:** Em vez da página única empilhando 10 cards técnicos (`Components.tsx`), usar um **assistente guiado por perfil de uso** na primeira execução (estilo Auto-Config do OBS):
  1. **Essencial** (`FFmpeg` — ou detectar do sistema — + `yt-dlp`/`deno` se usar URLs);
  2. **Transcrição local** (`worker Python` via `uv` + GPU NVIDIA/CPU detectada + modelo Whisper recomendado com selo estilo LM Studio mostrando RAM/VRAM disponível vs. exigida por `whisper-turbo`/`whisper-small`);
  3. **Narração local** (opcional: só para `Vídeo transformado`, baixando `pocket-tts` e voz sob demanda).
- **Traduzir jargão e alertar espaço em disco:** Substituir rótulos crus como `int8_float16`, `worker handshake`, `Ed25519` e `SHA-256` por status legíveis (*"Aceleração GPU NVIDIA ativa — precisão rápida"*, *"Verificação de integridade automática"*), mantendo os dados técnicos recolhidos em "Detalhes avançados / Diagnóstico". Antes de mudar `data_dir`/`cache_dir` (`components.settings.set`), avisar explicitamente que arquivos já baixados não são movidos automaticamente (gap documentado em [funcionalidades.md](../produto/funcionalidades.md)) e exibir uso atual vs. teto do cache LRU (`cache_limit_bytes`).

### 4. Fila de jobs, trabalho longo e estado `uncertain` ([07-provedores-jobs-e-eventos.md](../produto/funcionalidades/07-provedores-jobs-e-eventos.md))
- **Barra de atividade global + Painel de Fila unificado:** Adotar o modelo Steam/HandBrake com um indicador persistente no rodapé/topo do shell mostrando quantos jobs estão rodando/na fila (unificando visualmente a fila SQLite do Projeto `jobs.*` e os downloads globais `components.*`/`tts.models.*`, mesmo tendo comandos de cancelamento distintos no núcleo) e abrindo um painel completo de fila.
- **Notificações do sistema + barramento único de `core-progress`:** Centralizar a assinatura de `core-progress` em um store único no front (eliminando os 16 listeners espalhados + `setInterval` da v1) e disparar notificações nativas do SO quando transcrições, seleções em lote ou exportações longas concluírem ou pausarem.
- **Tratamento prioritário para jobs `uncertain` e pausas de orçamento:** Inspirado na marca de aviso do HandBrake pós-fechamento, ao reabrir um Projeto com jobs pagos em `uncertain` (ou pausados por `ai_pauses`), destacar um banner acionável no topo levando direto à fila com duas escolhas explícitas: **Ver estimativa e tentar novamente** (`jobs.estimate` → `jobs.retry { confirmed: true }`) ou **Descartar sem reenviar** (`jobs.discard`), evitando repetição paga às cegas (diferencial do Clipes sobre Topaz/AME).

### 5. Provedores de IA, chaves, custo visível, Somente local e auditoria ([07-provedores-jobs-e-eventos.md](../produto/funcionalidades/07-provedores-jobs-e-eventos.md))
- **Assistente de Provedor + Tabela de Tarefas clara:** Na detecção automática (`assistant.detect`), apresentar cartões simples para servidores locais em loopback encontrados (Ollama, LM Studio, llama.cpp), configuração de chave de API (salva no keyring, exibindo só os 4 últimos dígitos `keyLastFour`, como no Zed) ou CLIs experimentais (`codex`, `claude`, `opencode`), sempre com a possibilidade de pular ou desativar o que não usa.
- **Selo persistente de localidade e veto `Somente local`:** Dado o peso da privacidade (Zed, Jan, Cursor), mostrar um **indicador de estado permanente** no cabeçalho do Projeto quando `Somente local` estiver ligado (`projects.local_only.get`), além da coluna na tabela de Tarefas de IA (`assistant.tasks`). Quando uma ação tentar disparar perfil remoto ou CLI sob veto (`local_only_violation`), exibir erro acionável com dois botões: *Trocar para perfil local* ou *Desativar veto nas configurações do Projeto*.
- **O que o Clipes tem e nenhuma concorrente tem — Custo prévio, orçamento travado e auditoria:** Ao contrário do pós-pago opaco do Cursor ou dos créditos fechados de OpusClip/Vizard ([2026-11-12-rea-vizard-vidiq.md](2026-11-12-rea-vizard-vidiq.md)), o Clipes já possui no núcleo estimativa calibrada (`provider.cost.estimate`, `selection.estimate`, etc.), orçamento bloqueante (`jobs.budget.get`/`set`/`continue`), histórico real (`provider.cost.list`) e trilha de auditoria sem dados sensíveis (`provider.audit.list` — hoje sem tela!). A UI v2 deve transformar isso em vantagem central:
  1. Todo botão que dispara chamada paga exibe o **custo estimado (`[min, max]` USD ou "cota do plano" / "US$ 0,00 local") e se o texto sai da máquina** antes da confirmação;
  2. Uma aba dedicada de **Custos e Auditoria** em Preferências/Projeto expõe `jobs.budget.get` (barra de consumo vs. teto), `provider.cost.list` e `provider.audit.list` (provando com hashes `promptSha256`/`inputSha256` que nenhum texto bruto ou chave vazou).

### 6. Erros, confirmações, desfazer e convenções multiplataforma ([90-inventario-ui-atual.md](../produto/funcionalidades/90-inventario-ui-atual.md))
- **Mapeamento centralizado de `CoreError`:** Criar um tradutor único no front convertendo cada `CoreError.code` (como `ffprobe_missing`, `context_too_small`, `local_only_violation`, `age_restricted`, `uncertain_job`) em mensagem humana com botão de correção direto (ex.: `Ir para Componentes`, `Trocar Perfil de Provedor`, `Importar arquivo local`), cumprindo NN/g #9.
- **Eliminar `window.confirm` e padronizar Undo vs. Confirmação:** Substituir todos os `window.confirm` por `<ConfirmDialog />` apenas quando a ação for destrutiva sem `undo` ou envolver gasto/sobrescrita real (ex.: remover chave do cofre, sobrescrever áudio da Narração, restaurar backup, disparar job pago ou `jobs.discard` em item `uncertain`). Ações reversíveis (`editor.undo`, `selection.undo`, `transcription.undo`) devem executar imediatamente com feedback de toast permitindo desfazer (GNOME/Apple HIG) e botões visíveis de `Desfazer`/`Refazer` na barra contextual.
- **Convenções Windows / macOS / Linux:** Usar `Cmd` no macOS e `Ctrl` no Windows/Linux no `<Kbd />` e nos listeners; mapear `Cmd/Ctrl+,` para Preferências e `Cmd/Ctrl+K` para a Paleta; seguir tema do sistema (`prefers-color-scheme`) como padrão com alternância manual claro/escuro nos tokens Foco; manter controles de janela nativos ou respeitar zonas arrastáveis (`32 px` Fluent / header bar) e densidade base `4 px` sem espremer timelines em coluna estreita.

---

## Fontes

Todos os links abaixo foram consultados/verificados em **2026-11-17** (incluindo documentos internos do repositório e páginas/discussões públicas obtidas via pesquisa web):

1. Figma Statistics: MAU, Revenue & Global Adoption — SQ Magazine: https://sqmagazine.co.uk/figma-statistics/ (acesso em 2026-11-17)
2. Figma FY2025 Revenue & Guidance — SQ Magazine: https://sqmagazine.co.uk/figma-vs-canva-statistics/ (acesso em 2026-11-17)
3. Figma Fortune 500 Reach — TechnologyChecker: https://technologychecker.io/technology/figma (acesso em 2026-11-17)
4. Figma Market Share & Pricing Overview — WPDean: https://wpdean.com/figma-statistics/ (acesso em 2026-11-17)
5. Linear ARR, Customers & NRR — Okara: https://okara.ai/blog/how-linear-grew (acesso em 2026-11-17)
6. Linear $2.5B Valuation — Dealroom: https://dealroom.co/news/147084-linear-doubles-valuation-to-2-5b-defying-the-saas-is-dead-narrative/ (acesso em 2026-11-17)
7. Linear Documentation & Download: https://linear.app/docs e https://linear.app/download (acesso em 2026-11-17)
8. OBS Studio Steam Concurrent Users — SteamDB / SteamCharts: https://steamdb.info/app/1905180/charts/ (acesso em 2026-11-17)
9. Audacity Downloads (115.5M+) — FossHub: https://www.fosshub.com/Audacity-changelog.html (acesso em 2026-11-17)
10. Audacity GitHub Repository (`audacity/audacity`): https://github.com/audacity/audacity (acesso em 2026-11-17)
11. HandBrake GitHub Repository (`HandBrake/HandBrake`): https://github.com/handbrake/handbrake (acesso em 2026-11-17)
12. HandBrake Official Releases (`handbrake.fr`): https://handbrake.fr/rotation.php?file=HandBrake-1.11.2-x86_64.flatpak (acesso em 2026-11-17)
13. Steam 43.5M Concurrent Users Record (Oct 2026) — Dot Esports: https://dotesports.com/general/news/steam-all-time-record-43-5-million-concurrent-users (acesso em 2026-11-17)
14. Topaz Video AI Overview — Techpresso: https://academy.techpresso.co/reviews/is-topaz-video-ai-worth-it (acesso em 2026-11-17)
15. Topaz Labs Reviews — Trustpilot: https://www.trustpilot.com/review/www.topazlabs.com (acesso em 2026-11-17)
16. Topaz Video AI — G2: https://www.g2.com/products/topaz-labs/reviews (acesso em 2026-11-17)
17. Topaz Video AI Pricing — MagicHour: https://magichour.ai/blog/topaz-video-ai-pricing (acesso em 2026-11-17)
18. Topaz Perpetual License Discontinuation — RenderAhouse: https://www.renderahouse.com/blog/topaz-ai-pricing (acesso em 2026-11-17)
19. LM Studio & Jan Market Context — PromptQuorum: https://www.promptquorum.com/power-local-llm/jan-review (acesso em 2026-11-17)
20. LM Studio Free License — The Rundown AI: https://www.therundown.ai/tools/lm-studio (acesso em 2026-11-17)
21. LM Studio Commercial Use — CheckThat.ai: https://checkthat.ai/brands/lm-studio (acesso em 2026-11-17)
22. ComfyUI GitHub Repository (`Comfy-Org/ComfyUI`): https://github.com/Comfy-Org/ComfyUI (acesso em 2026-11-17)
23. ComfyUI Popularity Discussion — Reddit: https://www.reddit.com/r/comfyui/comments/1oeawm8/comfyui_is_now_the_top_100_starred_github_repo_of/ (acesso em 2026-11-17)
24. ComfyUI Official Portal: https://www.comfy.org (acesso em 2026-11-17)
25. Buzz GitHub Repository (`chidiwilliams/buzz`): https://github.com/chidiwilliams/buzz (acesso em 2026-11-17)
26. Buzz MIT License — GitHub: https://github.com/chidiwilliams/buzz/blob/main/LICENSE (acesso em 2026-11-17)
27. Buzz Review & License — WhipScribe: https://whipscribe.com/tools/buzz (acesso em 2026-11-17)
28. Jan AI Official Docs & Repo (`jan.ai`): https://www.jan.ai/ (acesso em 2026-11-17)
29. Jan AI Open Source Listing: https://www.opensourcealternatives.to/item/jan (acesso em 2026-11-17)
30. Jan AI Apache 2.0 License — PromptQuorum: https://www.promptquorum.com/power-local-llm/jan-review (acesso em 2026-11-17)
31. Cursor DAUs & 2026 ARR — AI Business Weekly: https://aibusinessweekly.net/p/cursor-ai-statistics (acesso em 2026-11-17)
32. Cursor Enterprise Customers — Gradually.ai: https://www.gradually.ai/en/cursor-statistics/ (acesso em 2026-11-17)
33. Cursor Valuation & Acquisition — Wikipedia: https://en.wikipedia.org/wiki/Cursor_(company) (acesso em 2026-11-17)
34. Cursor Pricing Tiers — Cursor.com: https://cursor.com/docs/models-and-pricing (acesso em 2026-11-17)
35. Raycast macOS Native UI & Extensions — Medium / Raycast: https://medium.com/@andriizolkin/everyone-should-use-raycast-heres-why-7adf0fa2ce7c (acesso em 2026-11-17)
36. Raycast Cross-Platform & iOS — Apple / Raycast: https://apps.apple.com/br/app/raycast-ai-notes-and-more/id6503428327?l=en-GB&platform=vision (acesso em 2026-11-17)
37. Raycast Pro Pricing — Techpresso: https://academy.techpresso.co/reviews/is-raycast-worth-it (acesso em 2026-11-17)
38. Raycast Free & Sync Features — Raycast.com: https://www.raycast.com/pro (acesso em 2026-11-17)
39. Zed Editor GitHub Stars (`zed-industries/zed`): https://github.com/zed-industries/zed (acesso em 2026-11-17)
40. Zed Community Contributors — Zed.dev: https://zed.dev/blog/community-champions (acesso em 2026-11-17)
41. Zed Open Source Licenses & Personal Tier — PromptQuorum: https://www.promptquorum.com/power-local-llm/zed-review (acesso em 2026-11-17)
42. Zed Pro & Business Pricing — Zed.dev: https://zed.dev/pricing (acesso em 2026-11-17)
43. Guide to the Figma Desktop App (`help.figma.com`): https://help.figma.com e https://help.figma.com/hc/en-us/articles/5601429983767-Guide-to-the-Figma-desktop-app (acesso em 2026-11-17)
44. Figma Tab Groups — CreateWith: https://createwith.com/tool/figma/updates/figma-adds-tab-groups-to-desktop-app-to-reduce-designer-cognitive-load (acesso em 2026-11-17)
45. Figma Split Tabs — YouTube Demo: https://www.youtube.com/watch?v=W0ZzzmGPV-k (acesso em 2026-11-17)
46. Figma Recents File Browser: https://forum.figma.com/report-a-problem-6/in-recents-tab-i-can-see-files-from-my-other-accounts-20710 (acesso em 2026-11-17)
47. Save a Local Copy of Files (`.fig`) — Figma Help: https://help.figma.com/hc/en-us/articles/8403626871063-Save-a-local-copy-of-files (acesso em 2026-11-17)
48. Import `.fig` via Drag-and-Drop — Figma Help: https://help.figma.com/hc/en-us/articles/8403626871063-Save-a-local-copy-of-files (acesso em 2026-11-17)
49. Figma Desktop Tabs & Memory Discussions — Figma Forum: https://forum.figma.com/suggest-a-feature-11/desktop-app-make-the-built-in-tab-discarding-actually-kick-in-it-s-set-to-48h-59357 (acesso em 2026-11-17)
50. Figma High RAM Usage Discussions — Reddit: https://www.reddit.com/r/FigmaDesign/comments/1vwx4oz/memory_hungry_and_desktop_app_is_just_a_wrapper/ (acesso em 2026-11-17)
51. Linear Workspaces & Teams Documentation: https://linear.app/learn/intro-to-linear (acesso em 2026-11-17)
52. Linear Keyboard Shortcuts Reference — FastShortcuts: https://fastshortcuts.com/shortcuts/linear/ (acesso em 2026-11-17)
53. Linear Interactive Shortcuts Help (`?`) — Linear Docs: https://linear.app/changelog/2021-03-25-keyboard-shortcuts-help (acesso em 2026-11-17)
54. Linear Complete Shortcuts — Shortcuts.design: https://shortcuts.design/tools/toolspage-linear/ (acesso em 2026-11-17)
55. Why Linear Feels Fast (Local Sync Architecture) — Performance.dev: https://performance.dev/how-is-linear-so-fast-a-technical-breakdown (acesso em 2026-11-17)
56. Linear Command Menu UX — Arclet: https://arclet.io/guides/linear/use-command-menu (acesso em 2026-11-17)
57. Linear Keyboard Praise — Reddit: https://www.reddit.com/r/ProductivityApps/comments/1pwteka/looking_for_honest_experiences_about_linear_app/ (acesso em 2026-11-17)
58. Linear MouseDown Pattern Critique — Reddit `r/UXDesign`: https://www.reddit.com/r/UXDesign/comments/1vugli1/linears_simple_trick_to_make_navigation_feel/ (acesso em 2026-11-17)
59. Linear Learning Curve — Reddit: https://www.reddit.com/r/Linear/comments/1pwtda4/looking_for_honest_experiences_about_linear_app/ (acesso em 2026-11-17)
60. Linear Scaling & Bloat — Hacker News: https://news.ycombinator.com/item?id=48437609 (acesso em 2026-11-17)
61. OBS Studio Dock Layout Complaints — Reddit `r/obs`: https://www.reddit.com/r/obs/comments/vntbl8/new_to_obs_how_to_rearrange_the_screen_layout_to/ (acesso em 2026-11-17)
62. OBS Studio Scene Collections Documentation: https://obsproject.com/wiki/Scene-Collections (acesso em 2026-11-17)
63. OBS Studio Quick Start Guide (Auto-Configuration Wizard): https://obsproject.com/wiki/Quick-Start-Guide (acesso em 2026-11-17)
64. OBS Studio Profiles Documentation: https://obsproject.com/wiki/Profiles (acesso em 2026-11-17)
65. OBS Studio Dock Resizing/Locking Feedback — Reddit: https://www.reddit.com/r/obs/comments/1rwlrpq/new_update_ui_is_terrible/ (acesso em 2026-11-17)
66. Audacity Missing Audio Files / Structure: https://forum.audacityteam.org/t/aup-files-missing-audio-data/29845 (acesso em 2026-11-17)
67. Audacity `.aup3` Single-File SQLite Format: https://forum.audacityteam.org/t/lost-all-audio-in-aup-project-file/62291 (acesso em 2026-11-17)
68. SQLite Case Study on Audacity `.aup3`: https://sqlite.org/forum/info/496b68a88a88e5c0 (acesso em 2026-11-17)
69. Audacity `.aup3` Schema (`project`, `autosave`, `sampleblocks`): https://github.com/audacity/audacity-project-tools/blob/main/README.md (acesso em 2026-11-17)
70. Audacity Cloud Storage Corruption Risks — MuseHub: https://www.musehub.com/learn/recover-corrupted-audacity-project (acesso em 2026-11-17)
71. Audacity Project Recovery (`audacity-project-tools`): https://support.audacityteam.org/au3/troubleshooting/recovering-corrupted-projects (acesso em 2026-11-17)
72. Audacity Saving Progress Best Practices: https://manual.audacityteam.org/man/faq_errors_on_opening_or_recovering_an_audacity_project.html (acesso em 2026-11-17)
73. Audacity `sqlite3.rc 101` Missing Sample Block Error: https://forum.audacityteam.org/t/aup3-opens-with-no-error-but-tracks-appear-but-no-audio-is-recorded/61522 (acesso em 2026-11-17)
74. Audacity `.aup3` & Destructive/Non-Destructive UX — Reddit `r/audacity`: https://www.reddit.com/r/audacity/comments/12sg81g/for_audacityaup3_project_files_is_there_a_quick/ (acesso em 2026-11-17)
75. HandBrake Queue Documentation (`handbrake.fr`): https://handbrake.fr/docs/en/latest/advanced/queue.html (acesso em 2026-11-17)
76. HandBrake Queue Batch Workflow: https://www.youtube.com/watch?v=13UtGzdyr4I (acesso em 2026-11-17)
77. HandBrake Pause/Resume Queue Behavior — GitHub: https://github.com/HandBrake/HandBrake/issues/2647 (acesso em 2026-11-17)
78. HandBrake "When Done" Actions: https://laim.scot/blog/handbrake-discord-telegram-notifications (acesso em 2026-11-17)
79. HandBrake Pause Encode Walkthrough: https://www.youtube.com/watch?v=V3rUJlZ9GGo (acesso em 2026-11-17)
80. HandBrake Native OS Notifications: https://github.com/HandBrake/HandBrake/issues/6241 (acesso em 2026-11-17)
81. HandBrake Interrupted Queue Warning on Restart — GitHub: https://github.com/HandBrake/HandBrake/issues/5661 (acesso em 2026-11-17)
82. HandBrake "Add All" Queue UX Trap — Reddit: https://www.reddit.com/r/handbrake/comments/1pc6hay/handbrake_is_the_darling_of_my_life/ (acesso em 2026-11-17)
83. Steam Downloads Management & Scheduling — Steam Support: https://help.steampowered.com/en/faqs/view/71AB-698D-57EB-178C (acesso em 2026-11-17)
84. Steam Download Pipeline & Disk Allocation — Steam / Technical Analysis: https://www.reddit.com/r/computers/comments/1tt8i95/when_downloading_something_from_steam_the_disk/ (acesso em 2026-11-17)
85. Steam Network vs. Disk Graph — Reddit `r/Steam`: https://www.reddit.com/r/SteamDeck/comments/17t204m/why_does_my_download_graph_always_look_like_a/ (acesso em 2026-11-17)
86. Steam 100% Disk Usage Bottleneck — Reddit: https://www.reddit.com/r/steamsupport/comments/1vfw6ti/please_for_the_love_of_god_why_does_steam_take/ (acesso em 2026-11-17)
87. Topaz Video AI Crashes & Download Loops — WinXDVD / Reddit Synthesis: https://www.winxdvd.com/enhance-video/topaz-video-enhance-ai-crash-fixed.htm (acesso em 2026-11-17)
88. Topaz Video AI Layout Overhaul Backlash — Reddit `r/TopazLabs`: https://www.reddit.com/r/TopazLabs/comments/1i475xg/v%C3%ADdeo_ai_crashes_my_pc/ (acesso em 2026-11-17)
89. Topaz Video AI VRAM Errors — Reddit `r/TopazLabs`: https://www.reddit.com/r/TopazLabs/comments/r7vpwa/vram_error_i_ran_out_of_ideas_can_anyone_help/ (acesso em 2026-11-17)
90. Topaz Video AI Download Loop Reports — Reddit: https://www.reddit.com/r/TopazLabs/comments/1nj6d96/topaz_crashing_on_launch/ (acesso em 2026-11-17)
91. Topaz Video AI Offline Hangs — Reddit: https://www.reddit.com/r/TopazLabs/comments/mxbsvd/topaz_video_enhance_ai_stuck_on_loading_ai_model/ (acesso em 2026-11-17)
92. Topaz Video AI Orphaned FFmpeg & Downgrades — Reddit: https://www.reddit.com/r/TopazLabs/comments/z0hs26/still_no_way_to_restore_after_video_ai_crashes/ (acesso em 2026-11-17)
93. Topaz Video AI Parallel Queue Workarounds — Reddit: https://www.reddit.com/r/TopazLabs/comments/zfnqdp/consistently_getting_errors_in_topaz_video_ai/ (acesso em 2026-11-17)
94. LM Studio Official Documentation (`lmstudio.ai/docs`) & Overview: https://lmstudio.ai/docs e https://zenvanriel.com/ai-engineer-blog/lm-studio-for-ai-development/ (acesso em 2026-11-17)
95. LM Studio Local Server & LAN Sharing — LM Studio Docs: https://lmstudio.ai/docs/developer/core/server (acesso em 2026-11-17)
96. LM Studio Hardware Detection & VRAM Spill Complaints — Reddit: https://www.reddit.com/r/LocalLLaMA/comments/1wedimm/settings_to_avoid_vram_overload_lm_studio/ (acesso em 2026-11-17)
97. LM Studio GPU Offload Badges — YouTube: https://www.youtube.com/watch?v=396Xg5ZSL80 (acesso em 2026-11-17)
98. LM Studio Download API Statuses — LM Studio Docs: https://lmstudio.ai/docs/developer/rest/download (acesso em 2026-11-17)
99. LM Studio UI Praise vs. CLI — Reddit: https://www.reddit.com/r/LocalLLM/comments/1sd9cnt/tldr_how_do_i_get_lm_studio_to_actually_use_all/ (acesso em 2026-11-17)
100. LM Studio Default Offload Settings Complaint — Reddit: https://www.reddit.com/r/LocalLLaMA/comments/1roiu0p/terrible_speeds_with_lm_studio_is_lm_studio_bad/ (acesso em 2026-11-17)
101. LM Studio AMD ROCm/Vulkan Glitches — Reddit: https://www.reddit.com/r/LocalLLM/comments/1tl1p4u/64gb_of_vram_but_lmstudio_spilling_the_model_into/ (acesso em 2026-11-17)
102. ComfyUI Desktop Disk & Multi-Install Docs — Comfy.org: https://docs.comfy.org/installation/desktop/windows (acesso em 2026-11-17)
103. ComfyUI Desktop Python Environments & Hardware — Comfy.org: https://docs.comfy.org/installation/system_requirements (acesso em 2026-11-17)
104. ComfyUI `uv` & Backend Guides — Comfy.org: https://docs.comfy.org/installation/manual_install (acesso em 2026-11-17)
105. ComfyUI Shared Models (`extra_model_paths.yaml`) — Comfy.org: https://comfy.org/download/ (acesso em 2026-11-17)
106. ComfyUI Desktop Onboarding Praise — Reddit `r/comfyui`: https://www.reddit.com/r/comfyui/comments/1puqp2w/i_installed_the_windows_installer_and_realized_i/ (acesso em 2026-11-17)
107. ComfyUI Python Dependency Fragility — Reddit: https://www.reddit.com/r/comfyui/comments/1r12czk/is_that_only_me_or_comfy_desktop_is_extremely/ (acesso em 2026-11-17)
108. ComfyUI Storage Bloat — Reddit: https://www.reddit.com/r/comfyui/comments/1sn97ux/can_i_know_how_much_datainternet_and_disk_space/ (acesso em 2026-11-17)
109. ComfyUI AppData/Documents Cache Growth — Reddit: https://www.reddit.com/r/comfyui/comments/1rzfa97/comfyui_is_taking_up_too_much_storage_space/ (acesso em 2026-11-17)
110. Buzz vs. MacWhisper Backends — WhipScribe: https://whipscribe.com/tools/buzz (acesso em 2026-11-17)
111. Buzz Repository & Features (`chidiwilliams/buzz`): https://github.com/chidiwilliams/buzz/issues (acesso em 2026-11-17)
112. Buzz Official FAQ & Model Cache Paths: https://chidiwilliams.github.io/buzz/ e https://chidiwilliams.github.io/buzz/docs/faq (acesso em 2026-11-17)
113. Buzz CUDA, Metal & Vulkan Support — GitHub: https://github.com/chidiwilliams/buzz (acesso em 2026-11-17)
114. Buzz `BUZZ_FORCE_CPU` & GPU Issues — GitHub: https://github.com/chidiwilliams/buzz/issues/1160 (acesso em 2026-11-17)
115. Buzz Model Download Stuck Workarounds — GitHub: https://github.com/openai/whisper/discussions/2746 (acesso em 2026-11-17)
116. Buzz GitHub Discussions: https://github.com/chidiwilliams/buzz/discussions/categories/general (acesso em 2026-11-17)
117. Buzz Open-Source Releases (`github.com/chidiwilliams/buzz`): https://github.com/chidiwilliams (acesso em 2026-11-17)
118. Jan GitHub Repository (`janhq/jan`): https://github.com/janhq (acesso em 2026-11-17)
119. Jan Engines (`llama.cpp` / MLX) — Jan.ai: https://www.jan.ai/download (acesso em 2026-11-17)
120. Jan UX Praise & Rough Edges — Reddit `r/LocalLLaMA`: https://www.reddit.com/r/LocalLLaMA/comments/1dk7gye/jan_shows_which_ai_models_your_computer_can_and/ (acesso em 2026-11-17)
121. Jan Local API Server (`localhost:1337`): https://blog.openreplay.com/getting-started-jan-ai-chatgpt-alternative/ (acesso em 2026-11-17)
122. Jan Diagnostics & Window Focus Issues — GitHub: https://github.com/janhq/jan/issues (acesso em 2026-11-17)
123. Cursor API Keys (BYOK) Documentation (`cursor.com`): https://cursor.com/help/models-and-usage/api-keys (acesso em 2026-11-17)
124. Cursor Admin API Keys & Dashboard (`cursor.com`): https://cursor.com/docs/api (acesso em 2026-11-17)
125. Cursor Privacy Mode & BYOK Caveat (`cursor.com`): https://cursor.com/help/security-and-privacy/privacy (acesso em 2026-11-17)
126. Cursor Spend Limits & Usage Pools — Verdent.ai: https://www.verdent.ai/guides/cursor-usage-limits-explained (acesso em 2026-11-17)
127. Cursor Spend Limit "Dark Pattern" Complaints — Reddit: https://www.reddit.com/r/cursor/comments/1u9vwv8/beware_of_cursors_ondemand_billing_trap_my_20_pro/ (acesso em 2026-11-17)
128. Cursor Unexpected Overage Charges — Reddit: https://www.reddit.com/r/cursor/comments/1xmtqln/be_careful_with_your_billing_settings_just/ (acesso em 2026-11-17)
129. Cursor BYOK Double-Billing Confusion — Reddit: https://www.reddit.com/r/cursor/comments/1vuf95q/is_cursor_charging_ondemand_usage_even_when_using/ (acesso em 2026-11-17)
130. Raycast Extensions & Command Bar (`raycast.com`): https://www.raycast.com/ (acesso em 2026-11-17)
131. Raycast Window Management (`raycast.com`): https://www.raycast.com/core-features/window-management (acesso em 2026-11-17)
132. Raycast Local Models via Ollama (`manual.raycast.com`): https://manual.raycast.com/ai/local-models (acesso em 2026-11-17)
133. Raycast Custom Providers (`manual.raycast.com`): https://manual.raycast.com/ai/custom-providers (acesso em 2026-11-17)
134. Raycast AI Privacy & Local Key Storage (`manual.raycast.com`): https://manual.raycast.com/ai/raycast-ai-privacy-security (acesso em 2026-11-17)
135. Apple HIG — Settings, `Cmd+,` & System Preferences (`developer.apple.com`): https://developer.apple.com/design/human-interface-guidelines/settings (acesso em 2026-11-17)
136. Raycast Pro Subscription Integrations (`raycast.com`): https://www.raycast.com/blog/changing-how-raycast-ai-is-priced (acesso em 2026-11-17)
137. Raycast BYOK Paywall Backlash — Reddit `r/raycastapp`: https://www.reddit.com/r/raycastapp/comments/1wd96xl/a_proposal_for_byok_pro_and_rebuilding_community/ (acesso em 2026-11-17)
138. Raycast Interface vs. Inference Debate — Reddit: https://www.reddit.com/r/raycastapp/comments/1vrp2h3/raycast_v2_pricing_byok_and_where_were_heading/ (acesso em 2026-11-17)
139. Zed Editor Configuration (`zed.dev`): https://zed.dev/docs/ai/quick-start (acesso em 2026-11-17)
140. Zed Agent Settings (`zed.dev`): https://ollama.com e https://docs.ollama.com/integrations/zed (acesso em 2026-11-17)
141. Zed LLM Providers & OS Keychain (`zed.dev`): https://zed.dev/docs/ai/use-api-access (acesso em 2026-11-17)
142. Zed Ollama Context (`num_ctx` / `max_tokens`) (`zed.dev`): https://zed.dev/docs/ai/use-a-local-model (acesso em 2026-11-17)
143. Zed LM Studio OpenAI-Compatible Endpoint — GitHub: https://github.com/zed-industries/zed/issues/17482 (acesso em 2026-11-17)
144. Zed Performance Praise & AI Prioritization Complaints — Reddit `r/ZedEditor`: https://www.reddit.com/r/ZedEditor/comments/1tvwz0h/focusing_too_much_on_ai/ (acesso em 2026-11-17)
145. Zed Disable AI Discussion — Reddit: https://www.reddit.com/r/ZedEditor/comments/1wzg01y/my_favorite_zed_feature_turn_ai_off/ (acesso em 2026-11-17)
146. Zed Minimalist UI Praise — Reddit: https://www.reddit.com/r/ZedEditor/comments/1r8cpck/zed_uiux_clarity_issues/ (acesso em 2026-11-17)
147. Zed Missing Quality-of-Life Features — Reddit: https://www.reddit.com/r/ZedEditor/comments/1u38eu4/zed_is_good_but_its_also_dissapointing/ (acesso em 2026-11-17)
148. Microsoft Learn — App Title Bar (32 px, Mica, Draggable Regions): https://learn.microsoft.com/en-us/windows/apps/design/basics/titlebar-design (acesso em 2026-11-17)
149. Apple HIG — macOS Menus & Disabled Commands (`developer.apple.com`): https://developer.apple.com/design/human-interface-guidelines/the-menu-bar (acesso em 2026-11-17)
150. GNOME HIG — Header Bars (`developer.gnome.org`): https://developer.gnome.org/hig/patterns/containers/header-bars.html (acesso em 2026-11-17)
151. NN/g — Multi-Step Forms Consistency: https://www.nngroup.com/articles/consistency-and-standards/ (acesso em 2026-11-17)
152. Microsoft Learn — Windows Keyboard Shortcuts (`Ctrl+,`, `Ctrl+W`): https://learn.microsoft.com/en-us/windows-hardware/test/wpt/wpa-keyboard-shortcuts (acesso em 2026-11-17)
153. Apple HIG — Displaying Shortcuts in Menus (`developer.apple.com`): https://developer.apple.com/design/human-interface-guidelines/menus (acesso em 2026-11-17)
154. GNOME HIG — Standard Application Shortcuts (`developer.gnome.org`): https://developer.gnome.org/hig/reference/keyboard.html (acesso em 2026-11-17)
155. GNOME HIG — Shortcut Design Rules (`Ctrl` vs `Alt`/`Super`): https://developer.gnome.org/hig/guidelines/keyboard.html (acesso em 2026-11-17)
156. NN/g — Novices vs. Experts & Shortcuts: https://www.nngroup.com/articles/flexibility-efficiency-heuristic/ (acesso em 2026-11-17)
157. Microsoft Learn — Windows App Design (NavigationView, SelectorBar, Empty States): https://learn.microsoft.com/en-us/windows/apps/get-started/line-of-business/windows-lob-xaml-skill (acesso em 2026-11-17)
158. Apple HIG — Progress Indicators (`developer.apple.com`): https://developer.apple.com/design/human-interface-guidelines/progress-indicators (acesso em 2026-11-17)
159. GNOME HIG — Progress Bars & Pause/Cancel Controls (`developer.gnome.org`): https://developer.gnome.org/hig/patterns/feedback/progress-bars.html (acesso em 2026-11-17)
160. NN/g — Visibility of System Status (Heuristic #1): https://www.nngroup.com/articles/indicators-validations-notifications/ (acesso em 2026-11-17)
161. NN/g — Progress Indicators Wait Times: https://medium.com/design-bootcamp/error-empty-states-the-unsung-heroes-of-ux-design-dcb99d99cc2b (acesso em 2026-11-17)
162. Apple HIG — Empty States (`developer.apple.com`): https://developer.apple.com/design/human-interface-guidelines/writing (acesso em 2026-11-17)
163. NN/g — Empty States Guidelines: https://www.nngroup.com/articles/empty-state-interface-design/ (acesso em 2026-11-17)
164. NN/g — Error Message Guidelines (Heuristic #9): https://www.nngroup.com/articles/error-message-guidelines/ (acesso em 2026-11-17)
165. NN/g — Error Placement & Clarity: https://www.nngroup.com/articles/errors-forms-design-guidelines/ (acesso em 2026-11-17)
166. Apple HIG — Destructive Actions & Alerts (`developer.apple.com`): https://developer.apple.com/design/human-interface-guidelines/alerts (acesso em 2026-11-17)
167. Apple HIG — Destructive Items in Menus (`developer.apple.com`): https://developer.apple.com/design/human-interface-guidelines/context-menus (acesso em 2026-11-17)
168. GNOME HIG — Destructive Actions & Toast Undo (`developer.gnome.org`): https://developer.gnome.org/hig/patterns/feedback/dialogs.html (acesso em 2026-11-17)
169. NN/g — Confirmation Dialogs & Habituation: https://www.nngroup.com/articles/confirmation-dialog/ (acesso em 2026-11-17)
170. Fluent 2 — 4px Grid & Spacing (`microsoft.design`): https://fluent2.microsoft.design/layout (acesso em 2026-11-17)
171. Fluent 2 — Color Tokens & Dark Mode (`microsoft.design`): https://fluent2.microsoft.design/color (acesso em 2026-11-17)
172. Apple HIG — Dark Mode (`developer.apple.com`): https://developer.apple.com/design/human-interface-guidelines/dark-mode (acesso em 2026-11-17)
173. GNOME Color Scheme Preference (`prefer-dark` / `prefer-light`) — ArchWiki: https://wiki.archlinux.org/title/Dark_mode_switching (acesso em 2026-11-17)
174. NN/g — Wizards & Staged Disclosure: https://www.nngroup.com/articles/wizards/ (acesso em 2026-11-17)
175. Adobe Media Encoder — Crash Recovery Limits (`helpx.adobe.com`): https://community.adobe.com/questions-506/i-lost-all-videos-in-queue-on-adobe-media-encoder-due-to-a-power-surge-996469 (acesso em 2026-11-17)
176. Adobe Media Encoder — Pause vs Stop Pitfalls (`helpx.adobe.com`): https://community.adobe.com/questions-729/pausing-and-resuming-export-in-media-encoder-1375588 (acesso em 2026-11-17)
177. Clipes — Documentação interna de produto e inventário v1: [docs/produto/funcionalidades.md](../produto/funcionalidades.md), [docs/produto/funcionalidades/90-inventario-ui-atual.md](../produto/funcionalidades/90-inventario-ui-atual.md), [GLOSSARY.md](../../GLOSSARY.md) e [docs/research/2026-11-12-rea-vizard-vidiq.md](2026-11-12-rea-vizard-vidiq.md) (acesso em 2026-11-17).

<!-- definições dos links numerados citados no texto -->
[2]: https://sqmagazine.co.uk/figma-vs-canva-statistics/
[6]: https://dealroom.co/news/147084-linear-doubles-valuation-to-2-5b-defying-the-saas-is-dead-narrative/
[10]: https://github.com/audacity/audacity
[12]: https://handbrake.fr/rotation.php?file=HandBrake-1.11.2-x86_64.flatpak
[15]: https://www.trustpilot.com/review/www.topazlabs.com
[18]: https://www.renderahouse.com/blog/topaz-ai-pricing
[21]: https://checkthat.ai/brands/lm-studio
[23]: https://www.reddit.com/r/comfyui/comments/1oeawm8/comfyui_is_now_the_top_100_starred_github_repo_of/
[27]: https://whipscribe.com/tools/buzz
[28]: https://www.jan.ai/
[32]: https://www.gradually.ai/en/cursor-statistics/
[36]: https://apps.apple.com/br/app/raycast-ai-notes-and-more/id6503428327?l=en-GB&platform=vision
[38]: https://www.raycast.com/pro
[40]: https://zed.dev/blog/community-champions
[42]: https://zed.dev/pricing
[44]: https://createwith.com/tool/figma/updates/figma-adds-tab-groups-to-desktop-app-to-reduce-designer-cognitive-load
[48]: https://help.figma.com/hc/en-us/articles/8403626871063-Save-a-local-copy-of-files
[50]: https://www.reddit.com/r/FigmaDesign/comments/1vwx4oz/memory_hungry_and_desktop_app_is_just_a_wrapper/
[52]: https://fastshortcuts.com/shortcuts/linear/
[54]: https://shortcuts.design/tools/toolspage-linear/
[56]: https://arclet.io/guides/linear/use-command-menu
[60]: https://news.ycombinator.com/item?id=48437609
[61]: https://www.reddit.com/r/obs/comments/vntbl8/new_to_obs_how_to_rearrange_the_screen_layout_to/
[62]: https://obsproject.com/wiki/Scene-Collections
[63]: https://obsproject.com/wiki/Quick-Start-Guide
[64]: https://obsproject.com/wiki/Profiles
[65]: https://www.reddit.com/r/obs/comments/1rwlrpq/new_update_ui_is_terrible/
[66]: https://forum.audacityteam.org/t/aup-files-missing-audio-data/29845
[67]: https://forum.audacityteam.org/t/lost-all-audio-in-aup-project-file/62291
[68]: https://sqlite.org/forum/info/496b68a88a88e5c0
[71]: https://support.audacityteam.org/au3/troubleshooting/recovering-corrupted-projects
[72]: https://manual.audacityteam.org/man/faq_errors_on_opening_or_recovering_an_audacity_project.html
[74]: https://www.reddit.com/r/audacity/comments/12sg81g/for_audacityaup3_project_files_is_there_a_quick/
[76]: https://www.youtube.com/watch?v=13UtGzdyr4I
[77]: https://github.com/HandBrake/HandBrake/issues/2647
[79]: https://www.youtube.com/watch?v=V3rUJlZ9GGo
[83]: https://help.steampowered.com/en/faqs/view/71AB-698D-57EB-178C
[84]: https://www.reddit.com/r/computers/comments/1tt8i95/when_downloading_something_from_steam_the_disk/
[85]: https://www.reddit.com/r/SteamDeck/comments/17t204m/why_does_my_download_graph_always_look_like_a/
[86]: https://www.reddit.com/r/steamsupport/comments/1vfw6ti/please_for_the_love_of_god_why_does_steam_take/
[88]: https://www.reddit.com/r/TopazLabs/comments/1i475xg/v%C3%ADdeo_ai_crashes_my_pc/
[89]: https://www.reddit.com/r/TopazLabs/comments/r7vpwa/vram_error_i_ran_out_of_ideas_can_anyone_help/
[90]: https://www.reddit.com/r/TopazLabs/comments/1nj6d96/topaz_crashing_on_launch/
[91]: https://www.reddit.com/r/TopazLabs/comments/mxbsvd/topaz_video_enhance_ai_stuck_on_loading_ai_model/
[92]: https://www.reddit.com/r/TopazLabs/comments/z0hs26/still_no_way_to_restore_after_video_ai_crashes/
[93]: https://www.reddit.com/r/TopazLabs/comments/zfnqdp/consistently_getting_errors_in_topaz_video_ai/
[95]: https://lmstudio.ai/docs/developer/core/server
[96]: https://www.reddit.com/r/LocalLLaMA/comments/1wedimm/settings_to_avoid_vram_overload_lm_studio/
[97]: https://www.youtube.com/watch?v=396Xg5ZSL80
[98]: https://lmstudio.ai/docs/developer/rest/download
[99]: https://www.reddit.com/r/LocalLLM/comments/1sd9cnt/tldr_how_do_i_get_lm_studio_to_actually_use_all/
[100]: https://www.reddit.com/r/LocalLLaMA/comments/1roiu0p/terrible_speeds_with_lm_studio_is_lm_studio_bad/
[103]: https://docs.comfy.org/installation/system_requirements
[104]: https://docs.comfy.org/installation/manual_install
[105]: https://comfy.org/download/
[107]: https://www.reddit.com/r/comfyui/comments/1r12czk/is_that_only_me_or_comfy_desktop_is_extremely/
[108]: https://www.reddit.com/r/comfyui/comments/1sn97ux/can_i_know_how_much_datainternet_and_disk_space/
[109]: https://www.reddit.com/r/comfyui/comments/1rzfa97/comfyui_is_taking_up_too_much_storage_space/
[111]: https://github.com/chidiwilliams/buzz/issues
[112]: https://chidiwilliams.github.io/buzz/
[113]: https://github.com/chidiwilliams/buzz
[114]: https://github.com/chidiwilliams/buzz/issues/1160
[115]: https://github.com/openai/whisper/discussions/2746
[117]: https://github.com/chidiwilliams
[118]: https://github.com/janhq
[119]: https://www.jan.ai/download
[120]: https://www.reddit.com/r/LocalLLaMA/comments/1dk7gye/jan_shows_which_ai_models_your_computer_can_and/
[121]: https://blog.openreplay.com/getting-started-jan-ai-chatgpt-alternative/
[122]: https://github.com/janhq/jan/issues
[124]: https://cursor.com/docs/api
[127]: https://www.reddit.com/r/cursor/comments/1u9vwv8/beware_of_cursors_ondemand_billing_trap_my_20_pro/
[128]: https://www.reddit.com/r/cursor/comments/1xmtqln/be_careful_with_your_billing_settings_just/
[130]: https://www.raycast.com/
[133]: https://manual.raycast.com/ai/custom-providers
[134]: https://manual.raycast.com/ai/raycast-ai-privacy-security
[135]: https://developer.apple.com/design/human-interface-guidelines/settings
[136]: https://www.raycast.com/blog/changing-how-raycast-ai-is-priced
[138]: https://www.reddit.com/r/raycastapp/comments/1vrp2h3/raycast_v2_pricing_byok_and_where_were_heading/
[140]: https://ollama.com
[143]: https://github.com/zed-industries/zed/issues/17482
[145]: https://www.reddit.com/r/ZedEditor/comments/1wzg01y/my_favorite_zed_feature_turn_ai_off/
[146]: https://www.reddit.com/r/ZedEditor/comments/1r8cpck/zed_uiux_clarity_issues/
[147]: https://www.reddit.com/r/ZedEditor/comments/1u38eu4/zed_is_good_but_its_also_dissapointing/
[148]: https://learn.microsoft.com/en-us/windows/apps/design/basics/titlebar-design
[152]: https://learn.microsoft.com/en-us/windows-hardware/test/wpt/wpa-keyboard-shortcuts
[153]: https://developer.apple.com/design/human-interface-guidelines/menus
[155]: https://developer.gnome.org/hig/guidelines/keyboard.html
[161]: https://medium.com/design-bootcamp/error-empty-states-the-unsung-heroes-of-ux-design-dcb99d99cc2b
[164]: https://www.nngroup.com/articles/error-message-guidelines/
[167]: https://developer.apple.com/design/human-interface-guidelines/context-menus
[171]: https://fluent2.microsoft.design/color
[172]: https://developer.apple.com/design/human-interface-guidelines/dark-mode
[174]: https://www.nngroup.com/articles/wizards/
[176]: https://community.adobe.com/questions-729/pausing-and-resuming-export-in-media-encoder-1375588
[1]: https://sqmagazine.co.uk/figma-statistics/
[3]: https://technologychecker.io/technology/figma
[4]: https://wpdean.com/figma-statistics/
[5]: https://okara.ai/blog/how-linear-grew
[7]: https://linear.app/docs
[8]: https://steamdb.info/app/1905180/charts/
[9]: https://www.fosshub.com/Audacity-changelog.html
[11]: https://github.com/handbrake/handbrake
[13]: https://dotesports.com/general/news/steam-all-time-record-43-5-million-concurrent-users
[14]: https://academy.techpresso.co/reviews/is-topaz-video-ai-worth-it
[16]: https://www.g2.com/products/topaz-labs/reviews
[17]: https://magichour.ai/blog/topaz-video-ai-pricing
[19]: https://www.promptquorum.com/power-local-llm/jan-review
[20]: https://www.therundown.ai/tools/lm-studio
[22]: https://github.com/Comfy-Org/ComfyUI
[24]: https://www.comfy.org
[25]: https://github.com/chidiwilliams/buzz
[26]: https://github.com/chidiwilliams/buzz/blob/main/LICENSE
[29]: https://www.opensourcealternatives.to/item/jan
[30]: https://www.promptquorum.com/power-local-llm/jan-review
[31]: https://aibusinessweekly.net/p/cursor-ai-statistics
[33]: https://en.wikipedia.org/wiki/Cursor_(company
[34]: https://cursor.com/docs/models-and-pricing
[35]: https://medium.com/@andriizolkin/everyone-should-use-raycast-heres-why-7adf0fa2ce7c
[37]: https://academy.techpresso.co/reviews/is-raycast-worth-it
[39]: https://github.com/zed-industries/zed
[41]: https://www.promptquorum.com/power-local-llm/zed-review
[43]: https://help.figma.com
[45]: https://www.youtube.com/watch?v=W0ZzzmGPV-k
[46]: https://forum.figma.com/report-a-problem-6/in-recents-tab-i-can-see-files-from-my-other-accounts-20710
[47]: https://help.figma.com/hc/en-us/articles/8403626871063-Save-a-local-copy-of-files
[49]: https://forum.figma.com/suggest-a-feature-11/desktop-app-make-the-built-in-tab-discarding-actually-kick-in-it-s-set-to-48h-59357
[51]: https://linear.app/learn/intro-to-linear
[53]: https://linear.app/changelog/2021-03-25-keyboard-shortcuts-help
[55]: https://performance.dev/how-is-linear-so-fast-a-technical-breakdown
[57]: https://www.reddit.com/r/ProductivityApps/comments/1pwteka/looking_for_honest_experiences_about_linear_app/
[58]: https://www.reddit.com/r/UXDesign/comments/1vugli1/linears_simple_trick_to_make_navigation_feel/
[59]: https://www.reddit.com/r/Linear/comments/1pwtda4/looking_for_honest_experiences_about_linear_app/
[69]: https://github.com/audacity/audacity-project-tools/blob/main/README.md
[70]: https://www.musehub.com/learn/recover-corrupted-audacity-project
[73]: https://forum.audacityteam.org/t/aup3-opens-with-no-error-but-tracks-appear-but-no-audio-is-recorded/61522
[75]: https://handbrake.fr/docs/en/latest/advanced/queue.html
[78]: https://laim.scot/blog/handbrake-discord-telegram-notifications
[80]: https://github.com/HandBrake/HandBrake/issues/6241
[81]: https://github.com/HandBrake/HandBrake/issues/5661
[82]: https://www.reddit.com/r/handbrake/comments/1pc6hay/handbrake_is_the_darling_of_my_life/
[87]: https://www.winxdvd.com/enhance-video/topaz-video-enhance-ai-crash-fixed.htm
[94]: https://lmstudio.ai/docs
[101]: https://www.reddit.com/r/LocalLLM/comments/1tl1p4u/64gb_of_vram_but_lmstudio_spilling_the_model_into/
[102]: https://docs.comfy.org/installation/desktop/windows
[106]: https://www.reddit.com/r/comfyui/comments/1puqp2w/i_installed_the_windows_installer_and_realized_i/
[110]: https://whipscribe.com/tools/buzz
[116]: https://github.com/chidiwilliams/buzz/discussions/categories/general
[123]: https://cursor.com/help/models-and-usage/api-keys
[125]: https://cursor.com/help/security-and-privacy/privacy
[126]: https://www.verdent.ai/guides/cursor-usage-limits-explained
[129]: https://www.reddit.com/r/cursor/comments/1vuf95q/is_cursor_charging_ondemand_usage_even_when_using/
[131]: https://www.raycast.com/core-features/window-management
[132]: https://manual.raycast.com/ai/local-models
[137]: https://www.reddit.com/r/raycastapp/comments/1wd96xl/a_proposal_for_byok_pro_and_rebuilding_community/
[139]: https://zed.dev/docs/ai/quick-start
[141]: https://zed.dev/docs/ai/use-api-access
[142]: https://zed.dev/docs/ai/use-a-local-model
[144]: https://www.reddit.com/r/ZedEditor/comments/1tvwz0h/focusing_too_much_on_ai/
[149]: https://developer.apple.com/design/human-interface-guidelines/the-menu-bar
[150]: https://developer.gnome.org/hig/patterns/containers/header-bars.html
[151]: https://www.nngroup.com/articles/consistency-and-standards/
[154]: https://developer.gnome.org/hig/reference/keyboard.html
[156]: https://www.nngroup.com/articles/flexibility-efficiency-heuristic/
[157]: https://learn.microsoft.com/en-us/windows/apps/get-started/line-of-business/windows-lob-xaml-skill
[158]: https://developer.apple.com/design/human-interface-guidelines/progress-indicators
[159]: https://developer.gnome.org/hig/patterns/feedback/progress-bars.html
[160]: https://www.nngroup.com/articles/indicators-validations-notifications/
[162]: https://developer.apple.com/design/human-interface-guidelines/writing
[163]: https://www.nngroup.com/articles/empty-state-interface-design/
[165]: https://www.nngroup.com/articles/errors-forms-design-guidelines/
[166]: https://developer.apple.com/design/human-interface-guidelines/alerts
[168]: https://developer.gnome.org/hig/patterns/feedback/dialogs.html
[169]: https://www.nngroup.com/articles/confirmation-dialog/
[170]: https://fluent2.microsoft.design/layout
[173]: https://wiki.archlinux.org/title/Dark_mode_switching
[175]: https://community.adobe.com/questions-506/i-lost-all-videos-in-queue-on-adobe-media-encoder-due-to-a-power-surge-996469
