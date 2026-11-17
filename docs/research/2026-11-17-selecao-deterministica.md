# Pré-seleção e seleção determinística de Cortes por sinais (#283)

Pesquisa da issue [#283](https://github.com/GUSTAVOHOOO/clipes/issues/283). Data: 2026-11-17. Documento apenas de pesquisa e desenho experimental: nenhum código de produto foi alterado.

> **Privacidade e escopo:** este relatório usa exclusivamente termos de domínio do [GLOSSARY.md](../../GLOSSARY.md), dados públicos de literatura/produtos e **agregados estatísticos** das medições já existentes no projeto (`#57`, `#127` e cópia somente leitura de `bench.clipes`, sem trechos de Transcrição, nomes de criadores, títulos ou IDs de vídeo do dataset #28).
>
> **Regra de licenças ([ADR-0003](../adr/0003-licenca-apache-ffmpeg-sob-demanda-e-politica-de-modelos.md)):** o Clipes é Apache-2.0. Nenhuma biblioteca copyleft (GPL/AGPL) entra linkada no núcleo Rust ou no worker Python; o FFmpeg continua executável separado sob demanda, e modelos/pesos novos precisam permitir uso comercial.

---

## 1. Resumo e Recomendação

Os experimentos anteriores do projeto mostraram que mandar a live inteira em Janelas de seleção sequenciais para um Provedor é caro, lento e tem teto baixo na v1: no [#57](2026-11-17-benchmark-selecao.md), `qwen/qwen3.8-27b` atingiu `0,0%` de recall e o Groq gratuito esgotou `200 mil TPD` em 6 de 112 janelas; no [#127](2026-11-17-experimento-roteamento.md), o modelo local `Bonsai-8B-Q1_0` falhou em `88,4%` das janelas (`2,6%` de recall) e o melhor Provedor medido (`codex:gpt-6.1-sol`) acertou **`20,6%`** dos Cortes humanos (`7/34`, `[10,3%, 36,8%]`; `24,1%` por cenas únicas).

A pergunta do #283 é se sinais baratos e determinísticos — já calculados ou fáceis de calcular localmente — conseguem (a) gerar Cortes direto **sem IA** e/ou (b) funcionar como **pré-filtro** para a IA analisar só o que compensa.

### Recomendação para os dois modos

1. **Modo A — Seleção por sinais (sem IA):** **viável para `Corte direto` de reação/clímax, usando 100% dados locais e zero custo de Provedor**, desde que não dependa só de um sinal isolado. O ponto de partida deve combinar:
   - **Sinais de áudio já existentes + derivados baratos:** pico de loudness em `energy.rs` + **salto brusco** ($\Delta$ dB entre Frases vizinhas) + **explosão após pausa** (silêncio $\ge 2\text{–}3\text{ s}$ seguido de pico) + **ritmo de fala** (palavras/s das Frases já gravadas) + **pitch/F0** em Rust (`pitch-detection`, MIT/Apache-2.0) para separar grito/voz excitada de som constante do jogo.
   - **Sinais de texto sem LLM (custo ~0):** palavras-gatilho PT/EN, risada transcrita, pontuação (`?`/`!`) e fronteira de assunto (**TextTiling** lexical sobre `sentences`) para estender o Corte do clímax até o início/fim natural de Frases (`20–180 s`).
   - **Sinais externos quando existirem:** replay do **chat** (`chat.rs` recalibrado + aceleração + penalidade de spam/sub-train) e **`heatmap` ("Mais repetidos") do YouTube** via `yt-dlp`.
   - **Limite honesto:** funciona para clímax e humor reativo; não substitui a IA para Cortes calmos de opinião/argumento nem avalia `Espaço para comentário` em `Vídeo transformado`. Na UI, deve aparecer com Nota explicável por sinais ("Seleção por sinais — sem IA").
2. **Modo B — Pré-filtro para IA (Seleção guiada):** **recomendado como caminho principal de economia**, mas com duas descobertas importantes sobre os dados reais do `bench.clipes` (`25,82 h`):
   - **Expandir toda marca atual não economiza:** numa simulação agregada sobre `bench.clipes`, expandir cada Frase `high`+`peak`+`chat` em janelas de `[-30 s, +60 s]` cobre **`89,4%`** dos caracteres da live (economia quase nula). Mesmo usando só `peak` + `chat`, a cobertura ainda é de **`58,1%`**.
   - **Rankear janelas focadas Top-K economiza ~65%–75%:** ranquear blocos por pontuação composta e enviar à IA apenas os **Top-12 a Top-15 momentos por hora** (janelas focadas de `90–150 s`, ou filtrar as Top-25%–35% Janelas do planejador) reduz tokens e tempo ativo em **`65%–75%`** (uma live de `11 h` que hoje estoura `200 mil TPD` no Groq passaria a caber no tier gratuito; e um Provedor forte como `gpt-6.1-sol` cairia de `78,2 s/h` e `$0,060/h` para ~`20–27 s/h` e ~`$0,015–$0,021/h`).
   - **Condição de entrada (gate do experimento):** só ligar o pré-filtro por padrão após medir no harness do #57 se o `recall@30%` de tokens preserva pelo menos `85%–90%` dos Cortes já encontrados pelo `gpt-6.1-sol` e supera ou iguala os `20,6%` atuais no pipeline ponta a ponta.

---

## 2. Estado da Arte: Literatura, Repositórios Abertos e Produtos

### 2.1 Literatura acadêmica

| Trabalho | Sinais usados | Achados principais e métricas | Relação com o Clipes |
|---|---|---|---|
| **Fu et al. (EMNLP 2017)** — [*Video Highlight Prediction Using Audience Chat Reactions*](https://arxiv.org/abs/1707.08559) | Chat da Twitch (volume, gírias/emotes em inglês e chinês com CNN-RNN em nível de caractere) + quadros de vídeo | Mostra que o chat funciona como *crowdsourcing* implícito de highlights em *eSports* (LoL), mas o texto é ruidoso e depende de emotes locais e alinhamento temporal. | Confirma por que `chat.rs` precisa contar pessoas distintas + reações/emotes sem depender de vocabulário formal, e por que chat sozinho tem muito falso positivo. |
| **Ringer & Nicolaou (FDG 2018)** — [*Deep Unsupervised Multi-View Detection of Video Game Stream Highlights*](https://arxiv.org/abs/1807.09715) | Múltiplas visões: áudio/fala do streamer + expressões faciais na webcam + vídeo do jogo | Modela highlights como **detecção de novidade/anomalia** não supervisionada: momentos de corte combinam ruptura simultânea em áudio, expressão facial e jogo sem precisar de rótulos específicos por jogo. | Justifica normalizar cada sinal contra a **linha de base da própria Fonte** (mediana/quantis) e combinar modalidades diferentes (áudio + chat + texto). |
| **Zhao et al. (2022)** — [*AntPivot: Livestream Highlight Detection via Hierarchical Attention Mechanism*](https://arxiv.org/abs/2206.04888) | Texto/áudio/visão em lives longas com mudanças bruscas de assunto (`AntHighlight`) | Formula detecção de highlights em lives longas como problema de **fronteiras temporais** sob muito conteúdo irrelevante, avaliado com `AP@tIoU` e *Boundary F1*. | Reforça que achar o **pico** é metade do problema; a outra metade é achar o **início e fim coerentes** (fronteiras de Frase e mudança de assunto). |
| **Hearst (1997)** — [*TextTiling: Segmenting Text into Multi-paragraph Subtopic Passages*](https://aclanthology.org/J97-1003/) | Coesão lexical entre blocos adjacentes de texto (TF/similaridade de cosseno sem LLM) | Segmenta discurso longo em blocos temáticos identificando vales de similaridade lexical entre janelas vizinhas. | Técnica clássica, determinística e barata para achar onde uma história começa e termina em Frases, sem gastar tokens de IA. |

**Consenso da literatura sobre atraso do chat e fusão multimodal:**
- Entre o momento da fala/jogada e a explosão no chat existe um **atraso de reação** (latência do stream + tempo cognitivo + digitação), tipicamente citado entre **2 s e 10+ s** na literatura e em ferramentas de VOD. No Clipes, a calibração do `#57` confirmou isso de forma drástica: com `atraso = 0 s`, os picos de chat acertaram apenas **`4,2%`** dos Cortes humanos (`1/24`), saltando para **`33,3%`** em `10 s` e **`37,5%`** em `20–30 s`.
- Modelos unimodais (só chat ou só vídeo) sofrem com ruído extremo (raids, sorteios, música alta ou ação repetitiva sem graça). A literatura converge para **fusão multimodal** e priorização de **recall** na primeira etapa (perder um clipe bom é pior que propor um trecho mediano para revisão).

### 2.2 Repositórios abertos

| Repositório | Licença | Como detecta highlights | Compatibilidade (ADR-0003) e lições |
|---|---|---|---|
| [`utkualsir/sharkyclips`](https://github.com/utkualsir/sharkyclips) | **MIT** | Pipeline local que combina picos de áudio/reação, replay de chat e análise de HUD de jogos + Whisper. | Licença compatível. Mostra que rodar 100% local é viável combinando áudio + chat + transcrição, embora heurísticas de HUD dependam de jogo específico. |
| [`DennisPing/Twitch-Autoclip`](https://github.com/DennisPing/Twitch-Autoclip) | **MIT** | Extrai replay de chat da Twitch e usa frequência de mensagens + emotes + classificador de texto para localizar momentos de hype. | Licença compatível. Confirma valor de frequência + densidade de emotes como sinal barato. |
| [`xurei/twitch-highlights-logger`](https://github.com/xurei/twitch-highlights-logger) | **GPL-3.0** | Janelas deslizantes sobre log de chat da Twitch com limiares e filtros de termos. | **Incompatível com cópia para o núcleo** (GPL-3.0). Apenas referência conceitual. |
| [`lay295/TwitchDownloader`](https://github.com/lay295/TwitchDownloader) | **MIT** | Ferramenta C# para baixar VODs, Clips e chat da Twitch (com suporte a emotes BTTV/FFZ/7TV). | Licença compatível como referência de formato de replay da Twitch (o Clipes já usa `yt-dlp` para chat do YouTube). |
| `porplax/auto-highlighter` | Python CLI | Usa FFmpeg para detectar picos de volume/grito e fatiar clipes automaticamente. | Exemplo simples de "só volume"; sofre com falsos positivos em música e som constante de jogo. |

### 2.3 Produtos comerciais

| Produto | Sinais documentados | O que já sabemos no repo / fontes |
|---|---|---|
| **Opus Clip** | Transcrição/LLM + `PySceneDetect` (`shotCuts`) + detecção de rosto e *active speaker* | Evidência de runtime no [#10 / OpusClip](2026-11-12-opusclip-runtime-evidence.md): usa `PySceneDetect` a 25 fps, pontua em 5 eixos (`hook`, `coherence`, `connection`, `trend`, `sponsorship`) e aplica curva no score (`curvedScore`). |
| **Vizard** | Visual (cenas/objetos/rostos) + áudio (fala, música, SFX) + sentimento na transcrição | Inventário no [#10 / Vizard](2026-11-12-vizard-capability-inventory.md): o modelo *Spark* funde áudio, cena e transcrição, separando documento de texto do documento de cena. |
| **Eklipse.gg** | HUD/kill feed de jogos + picos de áudio (gritos/risadas) + velocidade e emotes do chat | [Documentação pública da Eklipse](https://eklipse.gg): em lives *Just Chatting* (sem HUD de jogo), depende principalmente de áudio + chat. |
| **Powder.gg / Athenascope** | Visão computacional sobre HUD de jogos + áudio + transcrição | O encerramento do Athenascope e a migração de mercado mostram que detectores amarrados a HUD de jogos específicos quebram a cada atualização e não generalizam para conversas/podcasts. |
| **Sizzle.gg / Nexus Clips** | Áudio (risada, grito, comando de voz *"clip that"*), atividade de chat e eventos de jogo | Reforça o valor de detectar risada/grito além de volume bruto, além de comandos falados pelo próprio criador (ex.: *"clipa isso"*). |
| **Medal.tv / StreamLadder** | Medal: *ring-buffer* local acionado por hotkey/evento; StreamLadder: editor 9:16 + importação de Twitch Clips | Mostra que criadores também confiam em **sinais de espectadores já existentes** (Twitch Clips) ou marcações manuais durante a live. |
| **Twitch Clips / YouTube Heatmap** | Sinais nativos da plataforma: `vod_offset` + `view_count` em [Get Clips](https://dev.twitch.tv/docs/api/reference#get-clips), `position_seconds` em [Stream Markers](https://dev.twitch.tv/docs/api/reference#get-stream-markers) e gráfico *Most Replayed* do YouTube | Evidência direta de onde o público real clicou, pausou ou repetiu sem custo de inferência local. |

---

## 3. O que o Clipes Já Calcula Hoje e O que Falta

### 3.1 Inventário atual no núcleo (`core/src/`)

| Componente atual | Arquivo | Como funciona hoje | O que falta / limitações medidas |
|---|---|---|---|
| **Energia do áudio (#54)** | [`core/src/energy.rs`](../../core/src/energy.rs) | FFmpeg decodifica a faixa de microfone (`16 kHz mono s16le` via `pipe:1`). Calcula RMS em blocos de `100 ms` e guarda por Frase o **maior momentâneo** (`400 ms`) em centésimos de dBFS (`sentence_energy`). Rotula na leitura contra a distribuição da própria Fonte: `High` (> P80 e $\ge$ mediana + 3 dB) e `Peak` (> P95 e $\ge$ mediana + 6 dB). | 1) Mede **nível**, não **contraste local** (um jogo com música/tiroteio alto por 10 min gera dezenas de `High` seguidos); 2) Não distingue **grito/risada** de explosão do jogo ou música; 3) Ignora **silêncio seguido de explosão**; 4) Não gera candidatos sozinho — apenas anota `[energia alta]`/`[energia pico]` no texto para a IA. |
| **Chat da live (#151)** | [`core/src/chat.rs`](../../core/src/chat.rs) | `yt-dlp --write-subs --sub-langs live_chat`, agrega em buckets de `10 s` contando **pessoas distintas** (descarta `!comandos` e spam repetido em `60 s`, guarda `paid`, `laugh`, `surprise`, `clip`). Marca picos ($\ge 2,0\times$ mediana móvel de `10 min` e $\ge 4$ pessoas) deslocados `10 s` para trás. | 1) No `#57`, **`98,98%` dos picos brutos (`775/783`) caem fora de Cortes humanos** (raids, sorteios, trens de subs); 2) O campo `paid` (Super Chats) já é gravado, mas **não é usado** nem para pontuar nem para filtrar falsos positivos; 3) Falta **aceleração** ($\Delta$ entre buckets), **repetição coletiva** entre autores distintos e vocabulário PT-BR mais amplo (`clip` só disparou **2** e **3** vezes em 86 mil mensagens); 4) Só cobre replays do YouTube hoje. |
| **Frases e palavras (#49)** | [`core/src/sentences.rs`](../../core/src/sentences.rs) | Segmenta palavras por pontuação do Whisper ou pausa $\ge 700\text{ ms}$ (teto `25 s`), gravando `start_us`, `end_us`, `language` e texto. | Já temos timestamps de cada palavra e lacunas entre Frases, mas **nada disso gera sinal de seleção**: nem ritmo de fala (palavras/s), nem pausas longas antes de explosão, nem palavras-gatilho, nem perguntas (`?`), nem fronteiras lexicais (TextTiling). |
| **Planejador e ajuste (#144, #53)** | [`core/src/selection_windows.rs`](../../core/src/selection_windows.rs), [`core/src/selection/cut.rs`](../../core/src/selection/cut.rs) | Fatia a Fonte inteira em Janelas de até `15 min` com `3 min` de sobreposição. Ajusta bordas por Frase inteira (`MIN_CUT_US = 20 s`, `PREFERRED_MAX_US = 60 s`, `MAX_CUT_US = 180 s`) e une duplicatas ($\ge 50\%$ de interseção). | O planejador não aceita **subconjuntos selecionados de regiões/janelas** (pré-filtro), e o ajustador `cut::fit` estende só pela duração mínima (`MIN_CUT_US = 20 s`) sem buscar pontuação/pausa/coesão nas bordas. |
| **Importação por URL** | [`core/src/url_import.rs`](../../core/src/url_import.rs) | `probe_args` já executa `yt-dlp --skip-download --print "%(id)s|%(age_limit)s|%(availability)s|%(live_status)s|%(duration)s"`. | Não extrai `%(heatmap)j` nem capítulos (`%(chapters)j`), mesmo já pagando o custo de processo/rede do `yt-dlp` na importação. |

### 3.2 Medições agregadas sobre `bench.clipes` (cópia somente leitura, `25,82 h`)

Para fundamentar os sinais candidatos sem especulação, medimos apenas estatísticas agregadas nas 3 Fontes já preparadas em `bench.clipes` (`22.349` Frases; zero texto ou IDs lidos para o relatório):

| Métrica agregada | Fonte 1 (`3,64 h`, sem chat) | Fonte 2 (`11,17 h`, com chat) | Fonte 3 (`11,01 h`, com chat) | Observação |
|---|---|---|---|---|
| Mediana / P80 / P95 de loudness (`dBFS`) | `-20,61` / `-15,67` / `-10,12` | `-18,52` / `-11,57` / `-9,73` | `-18,56` / `-15,76` / `-12,73` | Baselines variam `~4 dB` no P80 entre criadores: normalização relativa por Fonte é obrigatória. |
| Frases `high` / `peak` (`energy.rs`) | `672` / `211` | `1.366` / `457` | `1.193` / `417` | `high` + `peak` soma `20%` de todas as Frases da live. |
| Saltos bruscos ($\Delta \ge +6\text{ dB}$ / $\ge +9\text{ dB}$ vs Frase anterior) | `679` / `369` | `889` / `472` | `755` / `370` | Subidas de $\ge 9\text{ dB}$ dão ~`34–101` eventos/h (muito mais seletivo que `high`). |
| Explosão após silêncio $\ge 3\text{ s}$ (lacuna + `high`/`peak`) | `51` (`14/h`) | `594` (`53/h`) | `349` (`32/h`) | Sinal já derivável de `sentences` + `sentence_energy` com custo zero. |
| Ritmo de fala (`mediana` / `P90` em palavras/s, Frases $\ge 2$ pal.) | `3,82` / `5,83` pal/s | `3,83` / `5,77` pal/s | `3,91` / `5,98` pal/s | Surpreendentemente estável entre PT e EN (~`3,85` med, `~5,85` P90). |
| Chat: mensagens / `paid` / `laugh` / `surprise` / `clip` | — | `53.287` / `42` / `1.357` / `577` / `2` | `33.004` / `23` / `1.544` / `516` / `3` | `clip` atual quase nunca dispara (`2` e `3` em 86 mil msgs); `laugh` é o sinal semântico dominante no chat. |

---

## 4. Tabela de Sinais Candidatos (Custo × Biblioteca × Licença × Evidência)

Legenda de custo estimado para uma live de `1 h` em CPU comum (Ryzen 5 / 4 threads), considerando que transcrição (`faster-whisper`), `energy` e `chat` já rodam no pipeline atual:
- **Zero (derivado):** `< 50 ms/h`, consulta SQL/memória sobre dados já gravados.
- **Baixo:** `< 5 s/h` CPU, sem novo modelo pesado.
- **Médio:** `5–30 s/h` CPU (ou chamada de rede leve via `yt-dlp`).
- **Alto:** `> 30 s/h` CPU ou decodificação de vídeo/modelo neural pesado.

### 4.1 Sinais de Áudio

| Sinal | Custo de cálculo | Onde roda e biblioteca | Licença (ADR-0003) | Evidência e valor prático |
|---|---|---|---|---|
| **1. Loudness momentâneo relativo (`High`/`Peak`)** | **Já existe** (~15–35 s/h via FFmpeg no job `energy`) | Núcleo Rust (`core/src/energy.rs`) + FFmpeg CLI sob demanda | Apache-2.0 (núcleo); FFmpeg externo sob demanda | **Já medido.** Bom para gritos/reações, mas `High` (20%) é largo demais sozinho e sofre com música/tiroteio alto contínuo. |
| **2. Mudança brusca de loudness ($\Delta$ dB local)** | **Zero (derivado)** (`< 10 ms/h` sobre `sentence_energy` ou blocos de 100 ms) | Núcleo Rust puro (sem nova dependência) | Apache-2.0 | **Alta prioridade.** Separa o instante exato de um susto/grito/reação súbita de um trecho ruidoso contínuo; reduz falsos positivos de som de jogo constante. |
| **3. Silêncio seguido de explosão** | **Zero (derivado)** (`< 10 ms/h` combinando lacunas de `sentences` + `sentence_energy`) | Núcleo Rust puro (ou `silencedetect` do FFmpeg) | Apache-2.0 | **Alta prioridade.** Pausa de `>= 2–3 s` (tensão/leitura/espera) seguida de salto de energia é padrão clássico de *jump scare*, *clutch* e *punchline*. |
| **4. Ritmo de fala (palavras/s relativo)** | **Zero (derivado)** (`< 10 ms/h` sobre `sentences` + `transcript_words`) | Núcleo Rust puro (sem nova dependência) | Apache-2.0 | **Média-alta.** Aceleração súbita da fala (`> P90` ~5,8 pal/s) capta empolgação, discussão rápida e *rant* mesmo sem grito em dBFS. |
| **5. Tom / Pitch ($F_0$) e variância vocal** | **Baixo** (~1–3 s/h CPU em PCM 16 kHz já decodificado) | Núcleo Rust: crate [`pitch-detection`](https://crates.io/crates/pitch-detection) (McLeod Pitch Method) ou YIN puro; **nunca `aubio` (GPL-3.0)** | **MIT OR Apache-2.0** (`pitch-detection`) | **Média-alta (literatura + acústica).** Grito/risada humana eleva $F_0$ e variância tonal; explosão de jogo/música grave não. Resolve o maior falso positivo de `energy.rs`. |
| **6. Detector dedicado de risada** | **Médio** (~10–25 s/h CPU via ONNX Runtime já no worker) | Worker Python (`onnxruntime` já presente): [`omine-me/LaughterSegmentation`](https://github.com/omine-me/LaughterSegmentation) ou [`zencastr/laughter-detection`](https://huggingface.co/zencastr/laughter-detection) (ONNX) | **MIT** | **Alta (produto + benchmark).** Humor nem sempre é grito; risada contagiante do criador ou grupo é um dos sinais mais fortes de `Corte direto` em lives. |
| **7. Eventos sonoros gerais (aplauso, grito, música, SFX)** | **Médio** (~10–30 s/h CPU via ONNX Runtime) | Worker Python: [`k2-fsa/sherpa-onnx`](https://github.com/k2-fsa/sherpa-onnx) (modelos CED) ou [`YAMNet` ONNX](https://github.com/tensorflow/models/tree/master/research/audioset/yamnet) | **Apache-2.0** (sherpa-onnx / CED / YAMNet) | **Média.** Útil sobretudo como **filtro de música** (penalizar intros/intervalos musicais sem fala) e para identificar aplauso/grito não verbal. |
| **8. Classificação Música vs Fala** | **Baixo-Médio** (ou **Zero** se derivado da proporção de VAD Silero vs loudness) | Núcleo Rust (loudness alto + 0 palavras Whisper = som não verbal) ou [`inaSpeechSegmenter`](https://github.com/ina-foss/inaSpeechSegmenter) | **MIT** (`inaSpeechSegmenter`) / Apache-2.0 (heurística VAD+loudness) | **Média (como filtro negativo).** Evita que música de fundo em intervalos vire `Peak` falso. A versão heurística (`loudness alto` sem palavras transcritas) custa zero. |
| **9. Sobreposição de vozes / múltiplos falantes** | **Alto** (diarização completa > 30–60 s/h CPU) ou **Baixo** (turnos curtos rápidos nas Frases) | Evitar `pyannote/speaker-diarization-3.1` (MIT, mas **gated no HF**, exige login/token — contra fluxo sem gate do ADR-0004); alternativa sem gate: `sherpa-onnx` ou heurística de turnos curtos | **Apache-2.0** (`sherpa-onnx`) | **Baixa-média para v1.** Útil em podcasts com debate acalorado, mas caro em CPU para lives solo; versão leve (rajada de Frases curtas) sai de graça. |

### 4.2 Sinais de Chat

| Sinal | Custo de cálculo | Onde roda e biblioteca | Licença (ADR-0003) | Evidência e valor prático |
|---|---|---|---|---|
| **10. Taxa de pessoas distintas (`chat.rs`)** | **Já existe** (rede yt-dlp + `< 1 s/h` agregação) | Núcleo Rust (`core/src/chat.rs`) + yt-dlp | Apache-2.0 | **Já medido (#57).** Recall `33,3%` padrão (`58,3%` com `1,75× / 20 min / 12 p / 30 s`), mas **`96,4%–98,98%` de ruído** isolado. |
| **11. Aceleração do chat ($\Delta$ pessoas / $\Delta t$)** | **Zero (derivado)** (`< 5 ms/h` sobre `chat_series`) | Núcleo Rust puro (`chat.rs`) | Apache-2.0 | **Média-alta.** Distingue explosão súbita (momento clipável) de platôs longos (conversa sobre assunto polêmico ou raid que dura 3 min). |
| **12. Emotes e palavras de reação expandidas** | **Zero** (em memória durante agregação em `chat.rs`) | Núcleo Rust puro (`chat::reactions`) | Apache-2.0 | **Alta.** `clip` atual só busca `"clipa"`, `"clip it"`, `"clip that"` (5 ocorrências em 86 mil msgs). Expandir para `clipe`, `clipou`, `pog`, `poggers`, `omegalul`, `icant`, `f`, `gg`, `cap`, `mds`, `krl`, `tankei`, `💀`, `😭` (guardando só contadores, sem texto) aumenta cobertura sem custo. |
| **13. Repetição coletiva entre autores distintos** | **Zero** (em memória durante `Aggregator`) | Núcleo Rust puro (`chat.rs`) | Apache-2.0 | **Alta (literatura).** Quando 10+ pessoas diferentes mandam o mesmo emote/palavra (`F`, `OMEGALUL`, `RIGGED`, `SALVA`) em `10–20 s`, o ruído de conversa normal desaparece. Diferente de spam individual (já filtrado por `REPEAT_WINDOW_US`). |
| **14. Novos inscritos / Super Chats (`paid`)** | **Já gravado** em `chat_series.paid` | Núcleo Rust puro (`chat.rs`) | Apache-2.0 | **Sinal negativo / desambiguador!** O `#57` mostrou que trens de subs/doações são causa central do ruído de `98,98%`. Se um pico de chat coincide com salto de `paid` e **sem** pico de áudio/fala excitada, deve ser **penalizado**. |

### 4.3 Sinais de Plataforma

| Sinal | Custo de cálculo | Onde roda e biblioteca | Licença (ADR-0003) | Evidência e valor prático |
|---|---|---|---|---|
| **15. Mapa "Mais repetidos" do YouTube (`heatmap`)** | **Baixíssimo** (~0 CPU; só pedir `%(heatmap)j` no `yt-dlp` já chamado na importação) | Núcleo Rust (`url_import.rs`) + `yt-dlp` sob demanda | Unlicense (`yt-dlp`) | **Muito alta quando disponível.** Dá ~100 segmentos normalizados `[0..1]` da retenção real do público ([yt-dlp PR #7100](https://github.com/yt-dlp/yt-dlp/pull/7100)). **Lacuna:** ausente em arquivos locais, lives recém-encerradas ou vídeos com poucas visualizações. |
| **16. Clips da Twitch criados por espectadores** | **Baixo** (1 chamada REST paginada) | Exige `Client-ID` + OAuth na [Twitch Helix `Get Clips`](https://dev.twitch.tv/docs/api/reference#get-clips) (`vod_offset`, `duration`, `view_count`) | API proprietária (termos Twitch) | **Alta em VOD Twitch**, mas **bloqueada por arquitetura na v1**: sem servidor central do Clipes, exigiria credencial/login Twitch do usuário (atrito e risco de chave embutida). Fica como integração opcional futura. |
| **17. Marcadores do streamer (Twitch)** | **Baixo** | [Twitch Helix `Get Stream Markers`](https://dev.twitch.tv/docs/api/reference#get-stream-markers) (`position_seconds`) | API proprietária | **Alta precisão, baixa cobertura:** exige token OAuth com escopo `user:read:broadcast` do dono do canal. Só serve para `Canal de cortes` oficial com parceria do streamer. |

### 4.4 Sinais de Transcrição (texto já disponível localmente)

| Sinal | Custo de cálculo | Onde roda e biblioteca | Licença (ADR-0003) | Evidência e valor prático |
|---|---|---|---|---|
| **18. Palavras-gatilho e interjeições PT/EN** | **Zero** (`< 20 ms/h` sobre `sentences`) | Núcleo Rust puro (lista curada + regex/Aho-Corasick simples) | Apache-2.0 | **Média.** Termos meta (`clipa`, `corta isso`, `não acredito`, `olha isso`, `história real`) e interjeições/palavrões têm bom valor de reforço, mas variam por nicho. |
| **19. Risada transcrita / marcações do Whisper** | **Zero** (`< 5 ms/h` sobre `sentences`) | Núcleo Rust puro | Apache-2.0 | **Baixa-média.** O Whisper às vezes emite `haha`, `kkk`, `[risos]`, `(laughter)`, mas falha com frequência quando o criador ri enquanto fala (por isso o sinal acústico #6 é superior). |
| **20. Perguntas e densidade de pontuação (`?`, `!`)** | **Zero** (`< 5 ms/h` sobre `sentences`) | Núcleo Rust puro | Apache-2.0 | **Média-alta para ganchos e bordas.** Uma Frase terminada em `?` seguida de resposta contínua de `20–50 s` marca **início de gancho** e ajuda no eixo `hook` e em `Espaço para comentário` (para `Vídeo transformado`). |
| **21. Mudança de assunto (fronteira semântica)** | **Baixo** (`~50 ms/h` em Rust com TextTiling + [`rust-stemmers`](https://crates.io/crates/rust-stemmers)) ou **Médio** (`5–15 s/h` via `fastembed` / `multilingual-e5-small` ONNX) | Núcleo Rust (`rust-stemmers` para TextTiling) ou Worker Python (`multilingual-e5-small`) | **MIT OR BSD-3-Clause** (`rust-stemmers`); **Apache-2.0** (`multilingual-e5-small` / `fastembed`) | **Alta para qualidade das bordas.** Não acha clímax sozinho, mas encontra os **vales de assunto** antes e depois de um pico para fechar o Corte sem cortar uma explicação ao meio (`selfContained` + `closing`). |

### 4.5 Sinais de Vídeo (só se barato)

| Sinal | Custo de cálculo | Onde roda e biblioteca | Licença (ADR-0003) | Evidência e valor prático |
|---|---|---|---|---|
| **22. Corte de cena (`scdet`)** | **Médio-Alto em lives de 11 h** (proxy `480p 5 fps` + `scdet`; no `#60`, `0,15 s` para `24 s` de vídeo = ~22 s/h, fora o tempo de gerar proxy) | FFmpeg CLI (`scdet`, já usado no `#60` em `worker/src/clipes_worker/reframe.py`) | FFmpeg externo sob demanda | **Contexto-dependente.** Em *gameplay* gera excesso de cortes de cena; em podcasts multicâmera ou reações, reforça fronteira de assunto. Só vale reaproveitar se o proxy já existir. |
| **23. Movimento / mudança na webcam** | **Alto** (exige decodificar vídeo + crop/diferença de quadros ou YuNet) | Worker Python (`opencv-python-headless` já instalado) | **Apache-2.0 / MIT** (OpenCV / YuNet) | **Inviável na v1 para seleção de lives longas:** decodificar 11 h de vídeo 1080p antes da seleção custa mais tempo que áudio + transcrição inteiros e compete com VRAM/CPU. Só faz sentido *depois* da seleção, no reenquadramento (`#60`). |

---

## 5. Como Combinar os Sinais e Montar Cortes de 20–180 s Alinhados a Frases

### 5.1 Normalização por criador e por Fonte

Um erro clássico é fixar limiares globais (`> -10 dBFS` ou `> 20 msgs/min`). Criadores com microfone comprimido ou chat pequeno nunca disparam; criadores com música alta disparam o tempo inteiro. A normalização deve seguir dois níveis:

1. **Na própria Fonte (sempre disponível):** usar estatística robusta à cauda (**mediana + MAD**, *Median Absolute Deviation*) ou **quantis relativos** em vez de média/desvio padrão:
   $$z_{\text{robusto}}(x) = \frac{x - \text{mediana}(X)}{\max(1{,}4826 \cdot \text{MAD}(X),\; \epsilon)}$$
   Para séries lentas com deriva ao longo de 11 h (ex.: chat crescendo ao longo da live, ou música mudando de jogo), usar **mediana móvel centrada de 15–20 min** (como `chat.rs`, estendida para energia e ritmo de fala).
2. **Por `Perfil de canal` (opcional futuro):** quando o usuário tiver múltiplas Fontes no mesmo Perfil, guardar médias históricas de `WPS` e `MAD` ajuda apenas a detectar anomalias extremas em Fontes muito curtas (`< 10 min`).

### 5.2 Grade temporal unificada e atraso do chat

Como áudio (`100 ms`), chat (`10 s`), `heatmap` (variável, tipicamente ~1% da duração — em 10 h cada barra tem `~360 s`, granularidade grossa!) e `Frases` (`1–25 s`) têm escalas diferentes:

1. **Deslocar chat para trás:** aplicar `REACTION_DELAY_US` (testar `15 s` e `20 s` ao lado dos `10 s` atuais, conforme sensibilidade do `#57`) antes de projetar os picos sobre a linha do tempo.
2. **Projetar tudo por Frase $i$** (ou janelas deslizantes de `5 s` alinhadas a Frases) para manter a garantia do `#57` (**0% de bordas no meio de Frase**):
   - $S_{\text{áudio}}(i)$: máximo normalizado entre pico de loudness (`energy.rs`), salto $\Delta$ dB vs $[i-3, i-1]$, explosão após pausa $\ge 2\text{ s}$, pitch $F_0$ e probabilidade de risada.
   - $S_{\text{chat}}(i)$: razão de pessoas distintas $\times$ bônus de aceleração e reação coletiva, **zerado ou reduzido em 70%** quando `paid` sobe sem subida correspondente de $S_{\text{áudio}}$ ou $S_{\text{fala}}$.
   - $S_{\text{texto}}(i)$: ritmo de fala ($\Delta\text{WPS}$), pontuação (`?`/`!`), palavras-gatilho.
   - $S_{\text{plat}}(i)$: `heatmap` do YouTube (só útil para desempate/ranqueamento em lives longas, porque cada ponto do YouTube tem dezenas a centenas de segundos!).

### 5.3 Pontuação ponderada e renormalização automática

Nem toda Fonte tem chat (arquivos locais, lives sem replay) ou `heatmap`. Os pesos nunca devem punir a ausência de um canal — a soma dos pesos **ativos** deve sempre renormalizar para `1,0`:

$$\text{Score}(i) = \frac{\sum_{m \in \text{ativos}} w_m \cdot \tilde{s}_m(i)}{\sum_{m \in \text{ativos}} w_m} - P_{\text{ruído}}(i)$$

Proposta inicial de pesos para o experimento (a calibrar no `#57`):
- **Sem chat / sem heatmap (local):** Áudio (`0,65`: loudness + salto $\Delta$ + pós-silêncio + pitch/risada) + Transcrição (`0,35`: ritmo de fala + gatilhos + `?`/`!`).
- **Com chat (live):** Áudio (`0,45`) + Chat (`0,35`, com filtro anti-sub-train) + Transcrição (`0,20`).
- **Com `heatmap` adicional:** reescalar para incluir `0,15` de `heatmap` como reforço macro.
- **Penalidade $P_{\text{ruído}}(i)$:** reduzir pontuação em trechos com música contínua sem fala (loudness alto + 0 palavras Whisper) ou picos isolados de `paid`/boas-vindas.

### 5.4 Do pico ao Corte de 20–180 s alinhado a Frases

Um pico marca o **clímax** (segundo 0 do grito/risada), **não** o começo do Corte. Se começarmos no pico, o Corte perde o contexto e o eixo `selfContained` cai para zero.

Algoritmo determinístico proposto em 4 passos (puro em Rust, usando apenas `sentences` + sinais):
1. **Seleção de âncoras (NMS temporal):** ordenar pontos/Frases por `Score` decrescente e aplicar supressão não-máxima (distância mínima de `45 s` entre âncoras) para não propor 5 candidatos no mesmo momento.
2. **Expansão assimétrica para janela-alvo (`20–60 s`, máx. `180 s`):** a partir da Frase-âncora $i^*$:
   - **Recuar o início** `15 s` a `35 s` (buscando o gancho) até encontrar uma **fronteira natural**: uma pausa entre Frases $\ge 700\text{ ms}$ (ideal $\ge 1{,}2\text{ s}$), uma pergunta (`?`) que iniciou a fala, ou um vale de similaridade lexical (**TextTiling**) dentro de `[start_anchor - 45s, start_anchor - 10s]`.
   - **Avançar o fim** `8 s` a `25 s` após o clímax até uma pausa natural ou fechamento pontuado (`.`, `!`, `?`), respeitando `MIN_CUT_US` e `MAX_CUT_US`.
3. **Ajuste garantido por `cut::fit`:** passar o par `(start_idx, end_idx)` pelo `cut::fit` já existente (`core/src/selection/cut.rs`), garantindo `0%` de bordas no meio de Frase e aderência estrita a `[min_us, max_us]`.
4. **Deduplicação:** aplicar `cut::merge_duplicates` (sobreposição $\ge 50\%$ do menor).

---

## 6. Dois Modos de Produto e Estimativa de Economia

| Aspecto | Modo A — Sem IA (100% determinístico) | Modo B — Pré-filtro para IA |
|---|---|---|
| **Público-alvo** | Usuários sem `Perfil de Provedor`, com cota esgotada, ou em `Somente local` sem GPU para LLM grande. | Usuários com Provedor (API paga, assinatura CLI ou modelo local capaz) que querem economizar cota, dinheiro e tempo em lives de 2–12 h. |
| **Tipo de vídeo** | Apenas **`Corte direto`** (reações, humor, sustos, clímax). Bloqueado ou com aviso forte para `Vídeo transformado`. | **`Corte direto`** e **`Vídeo transformado`** (a IA ainda avalia contexto, gancho e `Espaço para comentário` dentro dos trechos pré-filtrados). |
| **Saída e UX** | Candidatos com `Nota` calculada pelos sinais (mapeada para `energy`, `hook`, `closing`), badges de evidência (`[energia pico]`, `[chat 3,1×]`, `[risada]`), sem justificativa inventada. Rótulo claro: *"Gerado por sinais locais (sem IA)"*. | Envia só as **Top-K regiões** (ou Top-P% das Janelas) para o mesmo pipeline `selection` + `prompt.md` + verificadores + `cut::fit`. |
| **Custo de Provedor** | **$0,00** e **0 tokens**. | Redução de **~65% a 75%** nos tokens de entrada e tempo de chamada (detalhamento abaixo). |

### Estimativa quantitativa de economia no Modo B (Pré-filtro)

Tomando como base os dados medidos no `#57` (`sample_plan.json` pós-`#272`: **122 janelas** cobrindo `25,82 h` com sobreposição de `3 min`) e no `#127` (`codex:gpt-6.1-sol` e `openai/gpt-oss-120b`):

- **Por que expandir toda marca não funciona (simulação no `bench.clipes`):**
  - Se o pré-filtro simplesmente mantiver toda Frase `high` + `peak` + `chat` com margem `[-30 s, +60 s]`, o resultado cobre **`89,4%`** dos caracteres da live (apenas `10,6%` de economia).
  - Mesmo restringindo a `peak` + `chat` (`[-30 s, +60 s]`), ainda sobra **`58,1%`** dos caracteres (`33,5%` na Fonte 1, `73,5%` na Fonte 2, `54,8%` na Fonte 3).
- **Com orçamento Top-K (ex.: Top-12 janelas focadas de `90 s` por hora = `18 min/h` = `30%` da duração da live, já com contexto):**
  - **Tokens de entrada:** caem em **~70%–76%** (porque eliminamos também os `~20%–25%` de duplicação da sobreposição de `3 min` entre Janelas de `15 min`).
  - **Tempo ativo de Provedor:** para `codex:gpt-6.1-sol` (`78,2 s/h` na live inteira), cairia para **~`19–24 s/h`** (~`3,5–4,5 min` numa live de 11 h, contra `~14 min` hoje).
  - **Custo API equivalente (sem overhead CLI):** `gpt-6.1-sol` cairia de `$0,060/h` para **~`$0,015–$0,018/h`**; `gpt-oss-120b` no Groq cairia de `$0,00445/h` para **~`$0,0011–$0,0014/h`** — e os **~180–200 mil tokens de entrada** de uma live de 11 h passariam a consumir **~45–55 mil tokens**, cabendo inteiros dentro do teto diário gratuito de `200 mil TPD` do Groq!
  - **Risco explícito:** o recall final do Modo B fica limitado pelo teto `recall@K` do pré-filtro. Cortes baseados apenas em argumento calmo (sem áudio, chat, ritmo de fala ou gatilho lexical) serão filtrados antes da IA vê-los.

---

## 7. Desenho do Experimento no Harness do #57 (Pronto para Virar Ticket)

O projeto já possui o conjunto anotado (`38` Cortes humanos / `33` cenas únicas em `3` lives totalizando `25,82 h`), a base preparada em `C:\Users\Windows 11\clipes-bench\bench.clipes` (com `sentences`, `sentence_energy` e `chat_series` gravados) e as métricas puras em [`core/src/selection/benchmark.rs`](../../core/src/selection/benchmark.rs).

### 7.1 Observação obrigatória sobre o gabarito (`MIN_CUT_US = 20 s`)

> **Fato do gabarito (#57):** **`15 / 38` (`39,5%`)** dos Cortes humanos têm duração **inferior a `20 s`** (`2/14` na Fonte A, `5/11` na Fonte B com mediana `24,2 s`, `8/13` na Fonte C com mediana `16,5 s`, mínimo `10,9 s`).
>
> Como `cut::fit` impõe `MIN_CUT_US = 20 s`, todo candidato válido de `20–60 s` que acerte um desses 15 momentos é penalizado em `IoU` (ex.: um candidato de `30 s` cobrindo perfeitamente um Corte humano de `12 s` tem `IoU = 0,40`, abaixo de `0,50`, embora `min_overlap = 1,00`).
>
> **Regra do experimento:** todas as tabelas devem reportar **duas configurações de corte** lado a lado (`min_us = 20 s` padrão do produto e `min_us = 10 s` de sensibilidade) e manter as mesmas 4 métricas do `#57` com **IC Wilson 95%**: `recall_min50` (principal), `recall_gt_cov_50`, `recall_iou >= 0,30`, `recall_iou >= 0,50` e `recall_scenes_min50` (`33` cenas), além de **precisão / taxa de ruído** e **`recall@K`** (para `K ∈ {5, 10, 15, 20}` candidatos/h no Modo A e orçamentos de `15%, 25%, 35%, 50%` dos tokens no Modo B).

### 7.2 Braços e ablações (executáveis offline em minutos, zero custo de API)

Adicionar um subcomando determinístico ao runner do `#57` (ex.: `selection_benchmark deterministic-eval`, lendo apenas a cópia do `bench.clipes` + timestamps do gabarito em memória e salvando somente agregados):

1. **Baseline de referência (já medido no `#127` / `#57`):**
   - `codex:gpt-6.1-sol` (amostra `seed = 57`, `34` Cortes): **`20,6%`** `recall_min50` (`24,1%` cenas, `78,2 s/h`).
   - `openai/gpt-oss-120b` (Groq): **`14,7%`** `recall_min50` (`17,2%` cenas).
   - `Bonsai-8B-Q1_0` (112 janelas): **`2,6%`** `recall_min50` (`133,6–170,1 s/h`).
2. **Ablações individuais (Modo A — geração direta de Cortes `20–180 s` alinhados a Frases):**
   - **A1 (Só energia atual):** âncoras em `Peak` e `High+Peak` (`energy.rs`), expandidas simetricamente vs assimetricamente (`[-25 s, +15 s]`) + `cut::fit`.
   - **A2 (Áudio enriquecido):** `Peak` + salto brusco ($\Delta \ge 6\text{ dB}$) + explosão pós-silêncio ($\ge 2\text{ s}$) + ritmo de fala ($\Delta\text{WPS}$); testar também impacto marginal de `pitch-detection` (F0) e detector de risada ONNX (`zencastr` / `LaughterSegmentation`) sobre o áudio local.
   - **A3 (Só chat):** `chat.rs` atual (`2,0× / 10 s`) vs configuração equilibrada do `#57` (`1,75× / 20 min / 12 p / 20–30 s`) + aceleração + penalidade de `paid` (só nas 2 Fontes com chat, `24` Cortes).
   - **A4 (Só texto determinístico):** palavras-gatilho PT/EN + pontuação (`?`/`!`) + TextTiling lexical (`rust-stemmers`) para achar fronteiras.
   - **A5 (`heatmap` YouTube):** testar extração via `yt-dlp --skip-download --print "%(heatmap)j"` para os VODs aplicáveis; medir em quantas das 3 Fontes o `heatmap` existe e qual `recall@K` atinge isolado e combinado.
3. **Combinação ponderada (Modo A):**
   - **C1 (Universal sem plataformas):** A2 (áudio enriquecido) + A4 (texto determinístico), aplicável a qualquer arquivo local.
   - **C2 (Live completa):** C1 + A3 (chat com filtro anti-sub-train) + A5 (`heatmap` quando existir), com renormalização automática de pesos.
   - Comparar `recall@10/h` e `recall@15/h` de **C1** e **C2** diretamente contra os **`20,6%`** do `codex:gpt-6.1-sol`.
4. **Simulação offline do Modo B (Pré-filtro para IA):**
   - Para orçamentos de **`15%`, `25%`, `35%` e `50%` da duração/tokens** da live:
     1) Medir o **`recall@orçamento` do pré-filtro** (quantos dos `38` Cortes humanos caem dentro das janelas mantidas);
     2) Reproduzir offline sobre as **saídas já gravadas do `codex:gpt-6.1-sol` (24 janelas) e `gpt-oss-120b`**: quantos dos `7` Cortes acertados pelo Codex sobrevivem quando só as janelas/regiões aprovadas pelo pré-filtro são mantidas, e qual a **economia real de tokens e tempo (`s/h`)**.
     3) Só se um orçamento $\le 35\%$ retiver $\ge 85\%$ do gabarito (ou $\ge 6/7$ dos acertos do Codex), rodar **1 passada de confirmação** com `gpt-6.1-sol` ou `gpt-oss-120b` sobre as regiões pré-filtradas focadas (`90–150 s`) para testar se focar a janela melhora também a precisão da IA.

### 7.3 Critérios objetivos de decisão (prontos para ticket)

- **Para lançar o Modo A (Sem IA):** adotar na v1 para `Corte direto` se **C1/C2 em `recall@15/h` atingir $\ge 20\%$** (empatando com o Codex sem gastar nada, com `0%` de bordas no meio de Frase) ou se ficar claramente superior ao modelo local pequeno (`2,6%` do `Bonsai-8B`), deixando explícito na UI que é seleção por sinais sem IA.
- **Para lançar o Modo B (Pré-filtro para IA):** só ativar por padrão se o pré-filtro em **`<= 35%` dos tokens** tiver **recall de cobertura $\ge 80\%$** sobre os 38 Cortes humanos (ou $\ge 85\%$ de retenção dos acertos do Codex), garantindo economia de `>= 65%` em tokens sem perda relevante de qualidade. Caso o recall de cobertura caia abaixo de `70%` em `<= 35%` dos tokens, manter o pré-filtro apenas como **opção "Modo econômico"** na UI (explicitando o trade-off).
- **Para recalibrar `chat.rs` / `energy.rs`:** registrar novas constantes só após validar em **$\ge 6$ Fontes anotadas** (mantendo a cautela já definida no `#57` contra *overfitting* em `n = 2–3` lives).

---

## 8. Referências

- **Repositório Clipes:**
  - [GLOSSARY.md](../../GLOSSARY.md)
  - [ADR-0003: Apache-2.0, FFmpeg sob demanda e política de modelos](../adr/0003-licenca-apache-ffmpeg-sob-demanda-e-politica-de-modelos.md)
  - [ADR-0004: Stack Tauri 2 + React, núcleo Rust e worker Python](../adr/0004-stack-tauri-react-nucleo-rust-worker-python.md)
  - [ADR-0006: Relato de problemas sem telemetria](../adr/0006-relato-de-problemas-sem-telemetria.md)
  - [ADR-0008: Contrato de saída estruturada agnóstico de Provedor](../adr/0008-contrato-de-saida-estruturada-agnostico-de-provedor.md)
  - [ADR-0010: Perfis múltiplos de Provedor e "Somente local"](../adr/0010-perfis-multiplos-de-provedor-tarefa-para-perfil-e-somente-local.md)
  - [Benchmark de seleção (#57)](2026-11-17-benchmark-selecao.md)
  - [Experimento de roteamento (#127)](2026-11-17-experimento-roteamento.md)
  - [Lives longas e janela de contexto (#115)](2026-11-14-lives-longas-contexto.md)
  - [Reenquadramento (#60): detector de cena](2026-11-15-reenquadramento-deteccao.md)
  - [OpusClip — evidência de runtime (#10)](2026-11-12-opusclip-runtime-evidence.md)
  - [Vizard — inventário de capacidades (#10)](2026-11-12-vizard-capability-inventory.md)
  - Implementação atual: [`core/src/energy.rs`](../../core/src/energy.rs), [`core/src/chat.rs`](../../core/src/chat.rs), [`core/src/sentences.rs`](../../core/src/sentences.rs), [`core/src/selection.rs`](../../core/src/selection.rs), [`core/src/selection/cut.rs`](../../core/src/selection/cut.rs), [`core/src/selection/benchmark.rs`](../../core/src/selection/benchmark.rs), [`core/src/selection_windows.rs`](../../core/src/selection_windows.rs), [`core/src/url_import.rs`](../../core/src/url_import.rs).
- **Literatura acadêmica:**
  - Fu, C.-Y., Lee, J., Bansal, M., & Berg, A. C. (2017). *Video Highlight Prediction Using Audience Chat Reactions*. EMNLP 2017. <https://arxiv.org/abs/1707.08559>
  - Ringer, C., & Nicolaou, M. A. (2018). *Deep Unsupervised Multi-View Detection of Video Game Stream Highlights*. FDG 2018. <https://arxiv.org/abs/1807.09715>
  - Zhao, Y. et al. (2022). *AntPivot: Livestream Highlight Detection via Hierarchical Attention Mechanism*. <https://arxiv.org/abs/2206.04888>
  - Hearst, M. A. (1997). *TextTiling: Segmenting Text into Multi-paragraph Subtopic Passages*. Computational Linguistics 23(1). <https://aclanthology.org/J97-1003/>
- **Ferramentas, bibliotecas, modelos e APIs externas:**
  - `yt-dlp` heatmap ("Most Replayed"): <https://github.com/yt-dlp/yt-dlp/pull/7100> e <https://github.com/yt-dlp/yt-dlp>
  - Twitch Helix API — Get Clips (`vod_offset`, `view_count`) e Get Stream Markers (`position_seconds`): <https://dev.twitch.tv/docs/api/reference#get-clips> e <https://dev.twitch.tv/docs/api/reference#get-stream-markers>
  - FFmpeg Filters (`ebur128`, `astats`, `silencedetect`, `scdet`): <https://ffmpeg.org/ffmpeg-filters.html>
  - Crates Rust: [`pitch-detection`](https://crates.io/crates/pitch-detection) (MIT/Apache-2.0), [`ebur128`](https://crates.io/crates/ebur128) (MIT), [`rustfft`](https://crates.io/crates/rustfft) (MIT/Apache-2.0), [`rust-stemmers`](https://crates.io/crates/rust-stemmers) (MIT/BSD-3-Clause)
  - Modelos / toolkits Python/ONNX: [`omine-me/LaughterSegmentation`](https://github.com/omine-me/LaughterSegmentation) (MIT), [`zencastr/laughter-detection`](https://huggingface.co/zencastr/laughter-detection) (MIT), [`k2-fsa/sherpa-onnx`](https://github.com/k2-fsa/sherpa-onnx) (Apache-2.0), [YAMNet](https://github.com/tensorflow/models/tree/master/research/audioset/yamnet) (Apache-2.0), [`ina-foss/inaSpeechSegmenter`](https://github.com/ina-foss/inaSpeechSegmenter) (MIT), [`qdrant/fastembed`](https://github.com/qdrant/fastembed) (Apache-2.0)
  - Projetos abertos e produtos citados: [`utkualsir/sharkyclips`](https://github.com/utkualsir/sharkyclips) (MIT), [`DennisPing/Twitch-Autoclip`](https://github.com/DennisPing/Twitch-Autoclip) (MIT), [`lay295/TwitchDownloader`](https://github.com/lay295/TwitchDownloader) (MIT), [`xurei/twitch-highlights-logger`](https://github.com/xurei/twitch-highlights-logger) (GPL-3.0), [Eklipse](https://eklipse.gg), [Sizzle.gg](https://sizzle.gg), [Nexus Clips](https://nexusclips.com)
