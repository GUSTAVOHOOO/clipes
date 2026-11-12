# Canais dark: requisitos e riscos de uma fábrica de Cortes

Issue: [#16](https://github.com/GUSTAVOHOOO/clipes/issues/16) · Mapa: [#1](https://github.com/GUSTAVOHOOO/clipes/issues/1) · Consulta: **2026-11-12**. Políticas mudam: cada afirmação traz a URL e vale para essa data.

Convenções: **[primária]** é página oficial de política, ajuda, API ou termos. **[secundária]** é blog, imprensa ou guia de terceiros. **[inferência]** é conclusão nossa a partir das fontes, sem frase oficial que a diga. Vocabulário do [`GLOSSARY.md`](../../GLOSSARY.md): Canal dark, Fonte, VOD, Corte, Transcrição, Provedor.

## Resumo executivo

1. **Permissão não resolve monetização no YouTube.** A política de conteúdo reutilizado "não se baseia em direitos autorais, permissão ou uso justo" e vale "mesmo com permissão do criador original". Permissão evita claims e strikes; transformação real é o que mantém o YPP. A fábrica precisa das duas coisas, e são requisitos separados.
2. **Transformação é um recurso do produto.** Narração ou comentário próprio, roteiro com análise e edição com narrativa nova estão nos exemplos permitidos. Cortes colados sem narrativa, compilações de redes sociais e leitura de material alheio estão nos exemplos proibidos. A regra vale para o canal inteiro, então o risco é desmonetizar o canal todo, não um vídeo.
3. **Volume automatizado é o vetor de banimento.** A política de spam do YouTube proíbe "usar ferramentas automatizadas ou IA para produzir em grande volume conteúdo parecido com mudanças mínimas" e a manipulação técnica (acelerar áudio, filtros, crop) para escapar da detecção. A fábrica não deve ter nenhum recurso de evasão e deve limitar o ritmo de postagem e a repetição de templates por canal.
4. **Publicar por API oficial cabe na v1 só no YouTube.** O padrão atual é de 100 `videos.insert` por dia por projeto, e desde 2026-11-02 projetos não verificados já não ficam presos ao modo privado. No TikTok, cliente sem auditoria posta só em modo privado, para até 5 usuários por dia, com consentimento e escolha manual de privacidade em cada post, e app que "copia conteúdo de outras plataformas" está vetado. O Instagram exige app Meta com acesso avançado, mídia em URL pública e limite de 50 posts em 24h.
5. **Instagram e Facebook levam a permissão em conta.** Contas que repostam conteúdo alheio perdem recomendações (janela móvel de 30 dias), mas editores "com acordos de licenciamento ou permissões explícitas dos criadores" ficam isentos. Por isso o registro de permissão por Fonte é requisito da v1.

## 1. Políticas das plataformas

### 1.1 YouTube: monetização (YPP), conteúdo reutilizado e conteúdo inautêntico

Fonte principal: [Políticas de monetização de canais do YouTube](https://support.google.com/youtube/answer/1311392?hl=en) [primária].

**Conteúdo reutilizado (reused content).** Atinge canais que reaproveitam conteúdo já presente no YouTube ou em outro lugar da internet sem comentário original significativo, modificação substancial ou valor educacional ou de entretenimento.

- Escopo de canal: "Our reused content policy applies to your channel as a whole." A monetização pode sair do canal inteiro.
- Não depende de permissão: "it's not based on copyright, permission, or fair use" e "This policy applies even if you have permission from the original creator."
- Permitido (exemplos oficiais): trechos usados em crítica; cena com diálogo reescrito e voz trocada; replay esportivo com explicação lance a lance; react que comenta o original; filmagem editada com enredo e comentário acrescentados; remix de Shorts.
- Proibido (exemplos oficiais): "Clips of moments from your favorite show edited together with little or no narrative"; "Short videos you compiled from other social media websites"; "Content uploaded many times by other creators"; reações quase só não verbais, sem voz; "Content that exclusively features readings of other materials you did not originally create"; música só com tom ou velocidade alterados.

**Conteúdo genérico ou repetitivo (o antigo "repetitious", chamado "inauthentic" desde 2025-07-15).** Mesma página.

- Proibido: conteúdo que "looks like it's made with a template"; slideshows, roteiros em template ou texto rolando sem narrativa, comentário ou valor educacional; "AI-generated content made with generic or unoriginal templates"; canais cujos vídeos são "interchangeable from video to video".
- Permitido: mesma vinheta de abertura e encerramento, desde que o miolo mude; séries em que cada vídeo tem enredo ou foco próprio.
- IA: "the final product must still demonstrate your creative vision". Usar IA para editar roteiro ou gerar fundo é aceito.
- Vários canais: "you should not create new (or use existing) channels to get around these restrictions."
- A mudança de nome em julho de 2025 foi descrita pelo YouTube como ajuste menor de uma regra antiga ([Social Media Today](https://www.socialmediatoday.com/news/youtube-clarifies-monetization-update-inauthentic-repeated-content/752892/), [Search Engine Journal](https://www.searchenginejournal.com/youtube-targets-mass-produced-content-in-monetization-update/550337/) [secundárias]).

**Spam e práticas enganosas.** [Política de spam](https://support.google.com/youtube/answer/2801973?hl=en) [primária]. Ela vale também para conteúdo privado e não listado e para "coordinated networks of channels".

- Item "Automated or synthetic mass-production": "Using automated tools or AI to churn out high volumes of similar content with minimal changes." Ressalva: "posting a few variations of a video is ok". Exemplo: canais com a mesma música de fundo e imagens de IA repetitivas, "each video reading out an AI-generated script".
- Item "Detection evasion": "Technical manipulation (such as speeding up audio, heavy filters, cropping) designed to bypass abuse detection."
- Item "Scraped content": "Re-posting material from other websites or platforms, or other videos without adding anything of your own."
- Consequências: suspensão da monetização ou encerramento do canal; em alguns casos, remoção com aviso ou strike. Três strikes em 90 dias podem encerrar o canal.

**Shorts.** [Políticas de monetização do Shorts](https://support.google.com/youtube/answer/12504220?hl=en) [primária].

- Views de "Non-original Shorts" não entram na divisão de receita: trechos sem edição de filmes ou séries de terceiros, reuploads de outros criadores (do YouTube ou de fora) e "compilations with no original content added".
- "Shorts over one minute in length that contain claimed content are blocked and not eligible for monetization."
- Música de parceiros reduz a fatia do Creator Pool do Short. Nenhuma outra categoria de conteúdo de terceiros reduz.
- A página anuncia um limite de 10 milhões de views qualificadas "Starting February 1, 2027" (ler as condições na página antes de projetar receita).

**Divulgação de IA.** [Divulgar conteúdo alterado ou sintético](https://support.google.com/youtube/answer/14328491?hl=en) [primária].

- É obrigatório divulgar conteúdo realista que "Makes a real person appear to say or do something they didn't do", que altera filmagem de evento ou lugar real ou que gera cena realista que não ocorreu.
- Não é obrigatório para assistência de produção (roteiro, thumbnail, título), legendas ou "Cloning one's own voice to create voice overs or dubs".
- [Inferência] Narração TTS com voz sintética genérica não entra em nenhuma categoria obrigatória. Clonar a voz do criador da Fonte para fazê-lo "dizer" o que não disse entra.
- A API tem o campo `status.containsSyntheticMedia` em `videos.insert` ([docs](https://developers.google.com/youtube/v3/docs/videos/insert) [primária]).

### 1.2 Content ID, claims e strikes

- Content ID é para quem detém direitos exclusivos sobre "a substantial body of original material that is frequently uploaded". Num match, o dono pode bloquear o vídeo, monetizá-lo ("sometimes sharing revenue with the uploader") ou rastrear a audiência ([Como funciona o Content ID](https://support.google.com/youtube/answer/2797370?hl=en), [qualificação](https://support.google.com/youtube/answer/1311402?hl=en) [primárias]).
- O match pode ser contra "another video (or segment of a video)", ou seja, Cortes são identificáveis. Claim normalmente não afeta o canal, mas contestar sem motivo válido pode levar a pedido de remoção e strike ([Claims de direitos autorais](https://support.google.com/youtube/answer/6013276?hl=en) [primária]).
- Strikes: "Channels that get 3 copyright strikes in 90 days are subject to termination". Os canais vinculados também, e o usuário fica impedido de criar canais novos ([Strikes](https://support.google.com/youtube/answer/2814000?hl=en) [primária]).
- Uso justo: "Transformativeness is usually key". Avisos como "no infringement intended" e dar crédito não protegem. Sistemas automáticos "can't decide fair use", e um claim impede monetizar "even if you only use a few seconds" ([Uso justo](https://support.google.com/youtube/answer/9783148?hl=en) [primária]).
- Nenhuma página consultada documenta allowlist de canal no Content ID (a página `answer/6070470` retornou 404). [Inferência] Na prática, um criador que libera cortes e usa Content ID pode reivindicar o Corte e ficar com a receita. A fábrica precisa registrar isso como cenário esperado, não como falha.

### 1.3 TikTok

- **Feed Para Você.** "Content is also ineligible for the FYF if it includes unoriginal or reused material without anything new." Regra do criador: "You should only post content you created or have the right to share." O TikTok exige rótulo em conteúdo gerado por IA ou muito editado que mostre cenas ou pessoas realistas ([Integridade e autenticidade](https://www.tiktok.com/community-guidelines/en/integrity-authenticity), [Padrões do FYF](https://www.tiktok.com/community-guidelines/en/fyf-standards), vigência 2026-09-24 [primárias]).
- **Automação e várias contas.** "We strictly prohibit automation tools, scripts, or other tricks designed to bypass our systems." Várias contas são permitidas, "but not to deceive others or break the rules" (mesma página).
- **Creator Rewards.** As páginas oficiais não renderizaram na consulta. Os guias de terceiros concordam em vídeo original com mais de 1 minuto, conta pessoal e 18 anos ou mais, e excluem repost, compilação de baixo esforço e vídeo com marca d'água de outra plataforma ([Brandwatch](https://www.brandwatch.com/blog/tiktok-creator-program/), [Metricool](https://metricool.com/tiktok-creator-fund/) [secundárias]). Os limiares de seguidores e views divergem entre os guias.

### 1.4 Instagram (Reels) e Facebook

- **2024, Reels.** Quando houver dois ou mais conteúdos idênticos, o Instagram recomenda só o original e põe nas cópias um rótulo com link para o criador. Contas que repostam com frequência o que "não criaram ou aprimoraram de forma significativa" saem das recomendações. **Exceção: "editores com acordos de licenciamento ou permissões explícitas dos criadores" não são afetados.** Meme, compilação paródica, nova narração e remix de reação não contam como cópia ([Recomendações e originalidade, 2024-04-30](https://creators.instagram.com/blog/recommendations-and-originality) [primária]).
- **2026-04-30.** A regra passou a valer também para fotos e carrosséis. Borda, marca d'água, legenda ou crédito "não qualificam" como edição. A elegibilidade é recalculada continuamente sobre os últimos 30 dias ([Recompensando criadores originais](http://creators.instagram.com/blog/rewarding-original-creators-on-instagram/), [Diretrizes de conteúdo original](https://creators.instagram.com/original-content-guidelines) [primárias]).
- **Facebook, 2025-07-14.** Contas que reutilizam repetidamente conteúdo de outros "sem permissão ou alterações significativas" perdem acesso à monetização e têm a distribuição reduzida. Com aprovação do criador, valem "edições criativas, sobreposição de voz ou comentários". "Não basta apenas juntar clipes ou adicionar sua marca d'água" ([Combater conteúdo não original](https://creators.facebook.com/blog/combating-unoriginal-content) [primária]). Antes disso, em 2025-04, o Facebook já tirava monetização e alcance de contas com legendas spam e redes de repostagem ([Meta Newsroom](https://about.fb.com/news/2025/04/cracking-down-spammy-content-facebook) [primária]).

### 1.5 O que conta como transformação suficiente

[Inferência a partir das seções 1.1 a 1.4.] Nenhuma plataforma publica um limiar numérico. O que todas convergem em aceitar:

| Conta como transformação | Não conta |
|---|---|
| Narração ou comentário próprio que analisa, explica ou critica | Juntar Cortes sem narrativa |
| Roteiro com enredo novo amarrando trechos | Marca d'água, borda, legenda descritiva, crédito |
| Replay com explicação lance a lance | Mudar velocidade, tom, crop ou filtro |
| React com fala | React mudo |
| Tradução com narração e contexto próprios [inferência; nenhuma fonte trata tradução diretamente] | Ler em voz alta (inclusive por TTS) o texto de outra pessoa |

O YouTube ainda acrescenta uma dimensão de **canal**: vídeos não podem ser "interchangeable" nem parecer saídos de um template. Transformar cada Corte não basta se todos os vídeos do canal tiverem a mesma forma.

## 2. Permissão das Fontes

**O que existe.**

- **Marketplaces de "clipping".** A Whop Content Rewards é o maior. O criador ou a marca financia uma campanha com orçamento fixo e paga por 1.000 views aprovadas. Ele define regras de conteúdo (qualidade, menção, duração, proibições) e aprova cada envio ([OpusClip sobre Whop](https://www.opus.pro/blog/whop-content-rewards), [Digiday](https://digiday.com/media/wtf-is-clipping-the-low-lift-creator-strategy-grabbing-advertisers-attention/) [secundárias]). A doc oficial ([docs.whop.com](https://docs.whop.com/manage-your-business/growth-marketing/content-rewards)) exige login e não pôde ser lida. As faixas de pagamento citadas vão de US$0,20 a US$6 por mil views e divergem entre fontes.
- **Liberação informal.** Criadores dizem na descrição, num post ou num servidor que "cortes estão liberados", às vezes com regras de crédito ou divisão. [Inferência] Não achamos fonte primária que padronize isso. É o caso mais comum e o mais frágil como evidência.
- **Content ID do próprio criador.** O criador libera o corte e reivindica a receita pelo Content ID (seção 1.2). [Inferência] Quem posta tem alcance mas não recebe.

**Quanto a permissão vale em cada plataforma.**

| Plataforma | Permissão evita claim/strike? | Permissão protege monetização ou alcance? |
|---|---|---|
| YouTube | Sim, se quem libera é o dono dos direitos | **Não**: a política de reutilizado vale "mesmo com permissão" |
| Instagram | Sim | **Sim em parte**: isenção para "permissões explícitas" nas recomendações |
| Facebook | Sim | Sim em parte: o alvo é reutilizar "sem permissão ou alterações significativas" |
| TikTok | Sim | Não documentado; o FYF exige "something new" |

**O que a fábrica deve registrar por Fonte** (proposta, [inferência]):

- quem concedeu (canal, contato) e se é dono dos direitos ou só licenciado;
- escopo: plataformas, monetização permitida, tradução ou dublagem permitida, duração máxima, uso em compilação;
- obrigações: formato do crédito, link, divisão de receita, Content ID ativo ou não;
- evidência (URL da regra pública, print, contrato, ID da campanha) e data da coleta;
- validade ou revogação.

Cada Corte herda a permissão da Fonte. A exportação mostra o que falta e preenche o crédito automaticamente.

## 3. Fluxos típicos de Canais dark

[Os formatos vêm do enunciado do ticket e dos inventários de concorrentes. A avaliação de risco é inferência a partir da seção 1.]

| Fluxo | O que a fábrica precisa | Risco de política | Por quê |
|---|---|---|---|
| Cortes curtos (Shorts, Reels, TikTok) | Já coberto por Opus/Vizard: corte, legenda, reframe | **Alto** se for Corte cru | "Non-original Shorts" e "Scraped content" |
| Corte com narração própria ou TTS e roteiro | Roteiro por Corte (Provedor), TTS, mixagem com ducking da Fonte | Médio a baixo | Comentário e análise são o exemplo permitido. Ler o texto de outra pessoa não conta |
| Compilação temática | Seleção entre várias Fontes, transições, narração de ligação | **Alto** sem narrativa | "Clips ... edited together with little or no narrative" |
| Vídeo longo a partir de Cortes | Montagem com capítulos, roteiro de enredo, intro e encerramento | Médio | Proibido "interchangeable", permitido série com enredo próprio por vídeo |
| Tradução e dublagem | Legenda traduzida a partir da Transcrição, TTS no idioma de destino, sincronia labial opcional | Médio | Exige escopo de tradução na permissão. O auto-dubbing do YouTube só vale para o próprio upload e não roda em vídeo com conteúdo protegido ([Auto-dubbing](https://support.google.com/youtube/answer/15569972?hl=en) [primária]) |
| Volume alto, vários canais | Fila por canal, limites de ritmo, perfis de canal | **Alto** | "high volumes of similar content", "coordinated networks of channels", proibição de canais para contornar restrições |

Os concorrentes não cobrem isto (ver os inventários de [Opus](2026-11-12-opusclip-feature-inventory.md), [Vizard](2026-11-12-vizard-capability-inventory.md) e [vidIQ](2026-11-12-vidiq-capability-inventory.md)): permissão por Fonte, camada de narração e roteiro como parte central do pipeline, controle de repetição por canal e perfis de canal com voz, idioma e ritmo próprios.

## 4. Descoberta de Fontes

- **Padrão a herdar:** a pontuação de outliers do vidIQ, que compara cada vídeo com a média do próprio canal, com filtros por tamanho do canal e data ([inventário vidIQ, "What a clip factory should borrow"](2026-11-12-vidiq-capability-inventory.md)).
- **A diferença para o Clipes é o universo de busca.** Para um Canal dark o que importa é "quais Fontes **com permissão** têm trechos com potencial", não "o que viraliza no nicho". [Inferência] A descoberta deve começar pela lista de criadores com permissão registrada e só depois sugerir criadores novos, marcados como "sem permissão".
- **Custo de API** ([Quota](https://developers.google.com/youtube/v3/determine_quota_cost) [primária]):
  - `search.list` tem bucket próprio de 100 chamadas por dia, caro para varredura.
  - `videos.list`, `channels.list` e `playlistItems.list` custam 1 unidade cada, dentro de 10.000 por dia.
  - [Inferência] O desenho barato é: a uploads playlist de cada criador permitido via `playlistItems.list`, mais as estatísticas em lote via `videos.list` (até 50 IDs por chamada), mais a linha de base por canal calculada localmente.
  - Desde 2026-06-03 existe `videos.batchGetStats` (1 unidade, bucket próprio de 10.000 por dia) ([revision history](https://developers.google.com/youtube/v3/revision_history) [primária]).
- **Retenção de dados.** As Developer Policies dizem "Don't store user data indefinitely". Pelo resumo da ferramenta de leitura (sem citação literal verificada), dados guardados precisam ser apagados ou atualizados em 30 dias, e há restrição a criar métricas derivadas de API Data ([Developer Policies](https://developers.google.com/youtube/terms/developer-policies) [primária, verificação parcial]). Isso afeta onde e por quanto tempo o Clipes guarda estatísticas de canais de terceiros e precisa de checagem literal antes da implementação.
- **Trechos com potencial dentro da Fonte** (picos de replay e comentários com timestamp) não aparecem como dado público na API pesquisada. [Inferência] Para a v1, a escolha de trechos continua sendo da Transcrição com o Provedor.

## 5. Publicação em escala por APIs oficiais

### YouTube Data API v3

- **Cota padrão** ([Quota](https://developers.google.com/youtube/v3/determine_quota_cost) [primária]):
  - "100 `search.list` calls, 100 `videos.insert` calls, and 10,000 units per day combined for all other endpoints", com reset à meia-noite PT.
  - `thumbnails.set` e `playlistItems.insert` custam 50.
  - O histórico registra a queda de ~1.600 para ~100 unidades por upload (2025-12-04) e a passagem para buckets granulares (2026-06-01) ([revision history](https://developers.google.com/youtube/v3/revision_history) [primária]). A página de `videos.insert` diz "quota cost of 1 unit in the Video Uploads quota bucket". O texto de dezembro e o atual não batem; vale conferir no Cloud Console.
- **Modo privado:** "from unverified API projects are no longer restricted to private viewing mode" (2026-11-02, revertendo a regra de 2020-07-28).
- **Mais cota:** passa por API Compliance Audit ([auditorias](https://developers.google.com/youtube/v3/guides/quota_and_compliance_audits) [primária]).
- **Regras para quem publica pelos usuários** ([Developer Policies](https://developers.google.com/youtube/terms/developer-policies) [primária]):
  - "users must have final control over the data that will be published";
  - não alterar os valores informados pelo usuário;
  - consentimento ativo;
  - "exactly one (1) API Project" por cliente.
  - Pelo resumo não verificado, também é proibido "automate or trigger ... uploads". [Inferência] Upload agendado depois de revisão humana por vídeo é o desenho seguro.
- **Recursos do upload:** `status.publishAt` (agendamento), `status.containsSyntheticMedia`, `selfDeclaredMadeForKids`, arquivo de até 256 GB, privacidade padrão `public` ([videos.insert](https://developers.google.com/youtube/v3/docs/videos/insert) [primária]).
- **Projeto da API:** [Inferência] Num app local-first e open source, cada usuário cria o próprio projeto no Google Cloud com o próprio OAuth client. Isso dá a ele as 100 publicações por dia do projeto e evita centralizar credenciais.

### TikTok Content Posting API

- **Cliente sem auditoria:** "all content uploaded via this endpoint will be restricted to private viewing mode"; "up to 5 users to post in a 24 hour window"; as contas precisam estar privadas ([Content Sharing Guidelines](https://developers.tiktok.com/doc/content-sharing-guidelines), atualizada em 2026-08-04 [primária]).
- **Limites:**
  - "typically around 15 posts per day/ creator account", somados entre todos os apps;
  - 6 requisições por minuto por token;
  - erros `spam_risk_too_many_posts` e `reached_active_user_cap` ([Direct Post](https://developers.tiktok.com/doc/content-posting-api-reference-direct-post) [primária]).
- **UX obrigatória:**
  - mostrar o apelido do criador;
  - privacidade escolhida manualmente, "no default value";
  - interações desligadas por padrão;
  - consentimento expresso antes de enviar;
  - texto editável;
  - nenhuma marca d'água promocional.
- **Uso vetado:** "An app that copies arbitrary contents from other platforms to TikTok."
- **Fluxo Upload (rascunho):** `video.upload` manda o vídeo para a caixa de entrada do app, e o criador termina o post no TikTok. O limite é de 5 compartilhamentos pendentes em 24h ([Upload](https://developers.tiktok.com/doc/content-posting-api-reference-upload-video) [primária]).
- [Inferência] Para um app local sem auditoria, o fluxo de rascunho é o único que entrega vídeo público, e o post final fica com o humano.

### Instagram Graph API (Reels)

- **Limite** ([Content Publishing](https://developers.facebook.com/docs/instagram-platform/content-publishing/), [content_publishing_limit](https://developers.facebook.com/docs/instagram-platform/instagram-graph-api/reference/ig-user/content_publishing_limit) [primárias]):
  - `quota_total` "currently `50`" a cada 86.400 s;
  - a mesma página de publicação também cita 100. O valor real deve ser lido do endpoint.
- **Requisitos:**
  - só conta profissional;
  - permissões `instagram_content_publish` ou `instagram_business_content_publish`;
  - fluxo por container (`media_type=REELS` → `media_publish`).
- **Ponto de atrito com local-first:** a mídia "must be hosted on a publicly accessible server" (o upload resumível via `rupload.facebook.com` é a alternativa documentada).
- [Inferência] Um app Meta precisa de acesso avançado (App Review) para publicar em contas que não são dos administradores do app. Num projeto open source, cada usuário teria de registrar o próprio app.

### Fora do escopo legítimo

- automação de navegador ou APIs não oficiais para postar;
- contas em massa e redes de canais coordenadas;
- rodízio de projetos ou credenciais para somar cota;
- download de Fontes do YouTube sem autorização. Os Termos proíbem baixar ou reproduzir conteúdo "exceto se autorizado de forma expressa pelo Serviço" ou com permissão prévia por escrito, e proíbem acesso "usando qualquer meio automatizado (como robôs, botnets ou scrapers)" ([Termos do YouTube](https://www.youtube.com/t/terms), vigentes desde 2022-01-05 [primária]).

## Requisitos para a fábrica

Ordem por prioridade. **v1** = entra na seleção da v1 (#11). **depois** = vale construir, mas não bloqueia a v1. **fora** = não construir.

| # | Requisito | Marca | Por quê |
|---|---|---|---|
| R1 | **Registro de permissão por Fonte** (quem, escopo, obrigações, evidência, validade), herdado por cada Corte | **v1** | É a base legítima do Canal dark no glossário. Evita claim e strike e dá isenção no Instagram e no Facebook. Barato: é um formulário e um campo no Corte |
| R2 | **Crédito automático** na descrição e no texto do post a partir do R1 | **v1** | Obrigação comum em liberações. Sozinho não basta para originalidade, mas é condição de muitas permissões |
| R3 | **Camada de transformação**: roteiro por Corte pelo Provedor (comentário ou análise, não resumo), narração por TTS ou voz do usuário, mixagem com ducking da Fonte | **v1** | Sem ela, o produto gera exatamente os exemplos "não permitidos" do YouTube e do TikTok. É o que diferencia o Clipes do Opus e do Vizard para Canal dark |
| R4 | **Checklist de originalidade antes de exportar**: mostra o que foi acrescentado (narração, % de tempo com voz própria, gráficos) e avisa quando o Corte é cru | **v1** | Transforma a política em feedback. [Inferência] Não promete monetização, só informa |
| R5 | **Ingestão local-first**: arquivo ou VOD fornecido pelo usuário ou pelo criador | **v1** | Coerente com o glossário e sem conflito com os Termos do YouTube |
| R6 | **Perfis de canal**: nicho, idioma, voz TTS, estilo de legenda, credenciais OAuth próprias, Fontes permitidas | **v1** | Gerir vários canais é o fluxo central do Canal dark. Separar credenciais evita misturar contas |
| R7 | **Upload ao YouTube por API oficial** com revisão humana por vídeo, `publishAt`, `containsSyntheticMedia` e contador de cota | **v1** | Viável hoje: 100 uploads por dia por projeto, sem a trava de modo privado desde 2026-11-02. Cumpre "final control" do usuário |
| R8 | **Limites de ritmo por canal**: teto de posts por dia abaixo do limite das plataformas, intervalo mínimo, fila | **v1** | Mitiga "high volumes of similar content". Barato se R7 já tem fila |
| R9 | **Divulgação de IA**: marca `containsSyntheticMedia` e sugere rótulos quando houver voz clonada de pessoa real ou cena realista gerada | **v1** | Obrigatório no YouTube e no TikTok nesses casos, e não divulgar pode levar a suspensão do YPP |
| R10 | **Aviso de música e claim**: detectar música na Fonte; avisar que Short acima de 60 s com claim é bloqueado | **v1** | Regra objetiva do YouTube e barata de checar com a Transcrição (trechos sem fala) |
| R11 | **Legenda traduzida** a partir da Transcrição | **v1** | Custo baixo, reutiliza a Transcrição. Exige o escopo "tradução" no R1 |
| R12 | **Controle de repetição por canal**: compara título, thumbnail e estrutura com os últimos N vídeos e avisa quando ficar "interchangeable" | depois | Política de conteúdo genérico. Precisa de dados de uso real para calibrar |
| R13 | **Vídeos longos e compilações** a partir de Cortes, com roteiro de ligação e capítulos | depois | Fluxo valioso, mas depende de R3 maduro. Sem narrativa, é exemplo proibido |
| R14 | **Dublagem TTS** em outro idioma | depois | Depende de R3, R11 e escopo de permissão. Risco médio |
| R15 | **Descoberta de Fontes** com outliers sobre criadores permitidos (`playlistItems` e `videos.list`, linha de base local, retenção ≤ 30 dias) | depois | Útil, mas a v1 pode partir de Fontes já escolhidas. Precisa de leitura literal das Developer Policies |
| R16 | **TikTok por fluxo de rascunho** (`video.upload`) | depois | Única via pública sem auditoria. O post final fica no app do TikTok |
| R17 | **Instagram Reels por Graph API** | depois | Exige app Meta por usuário, App Review e mídia em URL pública ou upload resumível |
| R18 | **Ciclo Corte → resultado**: previsto vs. real por canal (YouTube Analytics) | depois | Bom para calibrar R3, R12 e R15 e herdado do vidIQ. Não bloqueia a v1 |
| R19 | **Registro de claims recebidos** por Corte e Fonte | depois | Mostra quais criadores reivindicam e retroalimenta o R1. Hoje seria manual |
| R20 | **Importar regras de campanhas de clipping** (Whop e similares) para o R1 | depois | Formaliza permissão paga, mas a doc oficial não foi lida |
| R21 | Pré-checagem de Content ID antes do upload | **fora** | Não há API pública para isso. O que existe é a checagem do YouTube Studio após o upload |
| R22 | Variações para escapar de detecção (acelerar, espelhar, crop, filtro, pitch) | **fora** | Proibido explicitamente ("Detection evasion"). Também fora do escopo do ticket |
| R23 | Postagem sem revisão humana, automação de navegador, APIs não oficiais | **fora** | Viola as Developer Policies, as regras de UX do TikTok e a regra de automação do TikTok |
| R24 | Download de Fontes do YouTube por scraping sem permissão | **fora** como padrão | Termos do YouTube. Ver pergunta em aberto P1 sobre import por URL |
| R25 | Criação ou gestão em massa de contas e rodízio de credenciais | **fora** | "coordinated networks of channels", proibição de canais para contornar restrições, "exactly one API Project" |

## Riscos e mitigações por design

| Risco | Gatilho | Consequência | Mitigação no produto |
|---|---|---|---|
| Desmonetização por conteúdo reutilizado | Cortes crus, compilação sem narrativa, leitura do texto de outros | YPP removido do **canal inteiro** | R3 e R4 por padrão. O modo "Corte cru" existe, mas avisa |
| Conteúdo genérico ou inautêntico | Mesmo template, mesma voz e música, vídeos intercambiáveis | YPP removido; canal visto como produção em massa | R12, variação real de roteiro por Corte, R6 com estilos distintos. Não sortear variações cosméticas |
| Spam e produção em massa | Volume alto de vídeos parecidos, redes de canais | Suspensão da monetização ou encerramento | R8 (ritmo), R25 fora, revisão humana em R7 |
| Strike de direitos autorais | Corte de Fonte sem permissão; contestar claim sem base | 3 em 90 dias encerram o canal e os canais vinculados | R1 obrigatório antes de publicar; R19; ensinar a diferença entre claim e strike |
| Claim do próprio criador | Criador libera o corte, mas usa Content ID | Receita vai para o criador; Shorts acima de 1 min bloqueados | Campo "Content ID ativo" no R1; R10 limita a duração |
| IA sem divulgação | Voz clonada de pessoa real, cena realista gerada | Rótulo forçado, suspensão do YPP | R9; não clonar voz de terceiros por padrão |
| Perda de alcance no Instagram e no Facebook | Mais da metade dos posts em 30 dias sem originalidade | Fora das recomendações por 30 dias, sem monetização no Facebook | R1 (isenção por permissão explícita), R3, R2 |
| Bloqueio de API | Estourar cota; app TikTok sem auditoria; app Meta sem review | Upload falha ou vídeo fica privado | Contador de cota (R7); R16 e R17 em modo rascunho; projeto por usuário |
| Violação dos Termos ao obter Fontes | Download automático do YouTube | Banimento da conta, risco contratual | R5 local-first; R24 fora |
| Revogação de permissão | Criador muda de ideia | Pedido de remoção, strike | Validade e revogação no R1; lista dos Cortes publicados de cada Fonte para remover rápido |

## Perguntas em aberto

1. **P1 — Import por URL.** Opus e Vizard aceitam link do YouTube. Os Termos proíbem download não autorizado. A v1 aceita URL? Opções: só arquivo local; URL só com R1 preenchido e aviso de responsabilidade; URL só para plataformas com download oficial. Decisão do produto, não da pesquisa.
2. **P2 — Quanto TTS é transformação.** Nenhuma plataforma publica um limiar. Narração TTS com comentário próprio está alinhada aos exemplos permitidos; TTS lendo texto alheio está nos proibidos. A fronteira prática só se mede com canais reais (R18).
3. **P3 — Cota real de `videos.insert`.** O changelog de 2025-12 fala em ~100 unidades; a página atual fala em 1 unidade num bucket de 100 por dia. Confirmar no Cloud Console antes de dimensionar a fila.
4. **P4 — Developer Policies, texto literal.** As regras de 30 dias de armazenamento, métricas derivadas e "must not automate ... uploads" vieram de resumo, não de citação. Ler o texto antes de implementar R7 e R15.
5. **P5 — Creator Rewards do TikTok.** As páginas oficiais não renderizaram; os critérios citados são secundários e divergem.
6. **P6 — Programas brasileiros de cortes.** Não achamos fonte primária sobre como podcasts e streamers brasileiros formalizam a liberação de cortes (regras, divisão, Content ID). Vale uma conversa com criadores ou a coleta de regras públicas para definir os campos do R1.
7. **P7 — Whop Content Rewards.** A doc oficial exige login. Falta saber se a campanha transfere direitos ou só paga por views, e se exige postagem em conta específica.
8. **P8 — Instagram e local-first.** O Graph API pede mídia em URL pública ou upload resumível. Dá para publicar direto da máquina do usuário só com o upload resumível, sem hospedagem temporária? Testar antes de prometer R17.
9. **P9 — Limite de Shorts em 2027.** A página do Shorts cita um limite de 10 milhões de views qualificadas a partir de 2027-02-01. Confirmar o que muda para canais pequenos, porque afeta a viabilidade de Canais dark só de Shorts.
