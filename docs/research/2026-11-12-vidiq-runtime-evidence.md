# Relatório de gravação de HARs: vidIQ (ticket #9)

Data: 12/11/2026. Conta Free do dev, perfil `profile-vidiq`, porta 9224. Estudo funcional em sala limpa: nada foi publicado, agendado, conectado (canal/redes) ou comprado.

Tema usado em todos os fluxos: react do Casimiro ao trailer e à gameplay de GTA 6 (vídeo de teste autorizado). Nenhum vídeo foi processado.

## Saldo de créditos

| Momento | Saldo | Gasto |
|---|---|---|
| Antes (início do fluxo 1) | 150 de 150 | |
| Depois do fluxo 1 (títulos PT 10 + EN 10 + "Gerar mais" 5 + "Mais como os selecionados" 5) | 120 | 30 |
| Depois dos fluxos 2 e 3 (geradores públicos bloqueados; pesquisa de palavras-chave não cobra) | 120 | 0 |
| Depois do fluxo 4 (2 mensagens no AI Coach, modo Regular, 10 cada) | 100 | 20 |
| Depois do fluxo 5 (1 miniatura gerada) | **78 de 150** | 22 |

Ciclo mensal: `resets_at` em 12/12/2026 (30 dias a partir da criação da conta).

## Resumo por fluxo

| Fluxo | Status | O que foi feito | O que o HAR capturou |
|---|---|---|---|
| `vidiq-01-titulos` | ✅ | Gerador de títulos dentro do app (`/ai/title-generator`): geração em PT, em EN, "Gerar mais" no grupo SEO, seleção de um título e "Mais como os selecionados"; abri "Ver outliers" e "Análise detalhada" (esta só pré-preenche o AI Coach, não enviei). | Requisições e respostas completas de `generate/titles/{youtube-search,outliers,custom-references}`, `youtube/video-outliers` e da persistência `pyapi/feed/craft/blueprint`. 44 MB. |
| `vidiq-02-descricao-tags` | ❌ bloqueado (anti-bot) | Não existe gerador de descrição/tags no app web sem canal conectado: `/optimize` exige canal e as rotas `/ai/*-generator` caem no AI Coach. Os geradores públicos (`vidiq.com/ai-description-generator/` e `/youtube-hashtag-generator/`) exigem um Cloudflare Turnstile ("Confirme que é humano") que falha no navegador automatizado ("We couldn't verify you're human"). Não tentei contornar o captcha. `/youtube-tag-generator/` retorna 404. | Só as páginas públicas, os controles do formulário e o desafio Turnstile (`challenges.cloudflare.com`). Nenhuma chamada de geração saiu. 205 MB (páginas de marketing). **Mitigação:** descrição, hashtags e tags foram geradas pelo AI Coach no fluxo 4. |
| `vidiq-03-ideias-score` | ✅ (limites Free) | Pesquisa (`/research/explore`): palavras-chave em alta; busca de "GTA 6" (aba relacionadas e Perguntas) e "Casimiro"; aba Vídeos (outliers) para "Casimiro". "Ideias diárias" e `/create` exigem canal conectado ou Boost. | `xwords/keyword_search`, `xwords/hottersearch`, `xwords/keyword_vph`, `xwords/keyword_trends`, `xwords/topics`, `youtube/video-outliers`, `channels/search`, `yt/channels`, com corpos. 62 MB. |
| `vidiq-04-ai-coach` | ✅ | Duas mensagens no modo Regular: (1) 5 títulos + descrição curta + 3 hashtags para um Short do tema; (2) a sugestão de acompanhamento "Quais tags devo usar para atrair o público gamer?". | `POST api/question` (SSE; o HAR do Playwright **não guarda o corpo do stream**, só os headers e o tempo de espera), a mensagem persistida completa via `ai-coach/conversations/:id/messages?working_trace=true` (com modelo, raciocínio, *tool calls* e métricas), sugestões e enriquecimento de chips via `xwords/hottersearch`. 15 MB. |
| `vidiq-05-thumbnail` | ✅ (com bug de UI) | Uma miniatura gerada por texto em `/feed?tool=thumbnails` (prompt genérico, sem pessoa real). A interface ficou presa em "Criando" por mais de 10 min, embora o backend tenha respondido em 19,6 s; ao reabrir o grupo pela lista "Recentes", o editor mostrou a imagem. Download funcionou: `downloads/vidiq/vidiq_thumbnail_1.jpg` (1376x768). | `POST thumbnail-editor/generate-unified` (requisição e resposta, com o prompt expandido), `thumbnail-editor/thumbnails/:id`, `subject-images`, `user_likeness`, polling de `quota/balance/global`. 50 MB. |

Screenshots em `shots/vidiq-*.png`. Passos Playwright em `steps/vidiq/`. Scripts de análise em `tools/har-endpoints.mjs`, `tools/har-shape.mjs`, `tools/har-sse.mjs` e `tools/har-json-keys.mjs`.

## Achados de produto

### Títulos (fluxo 1)

- **Controles:** caixa de texto "ideia de vídeo, tema ou roteiro"; formato **Formato longo / Shorts** (`videoFormat: long|short`); "Canais de referência para inspirar o estilo" (bloqueado no Free, "Desbloquear com o Boost"). Custo exibido no botão: **10 créditos**.
- **Saída:** dois grupos de **5 títulos** cada, gerados em **duas chamadas paralelas de 5 créditos**:
  - "Otimizado para SEO" → `POST /generate/titles/youtube-search`;
  - "Títulos outliers: estilo viral que se destacam" → `POST /generate/titles/outliers`.
  - Corpo: `{"videoTopic": "...", "videoFormat": "long"}`. Resposta: `{"recommendations":[{"title","score"}], "quota":{"numberOfCreditLeft","daysBeforeReset"}}`.
- **Nota por título:** sim, inteiro 0–100 (vimos 88–98), mais a contagem de caracteres calculada no cliente. Não há explicação da nota.
- **"Gerar mais" (5 créditos):** gera mais 5 no grupo e pagina ("2 / 2"), marcando os novos com "Novo".
- **Selecionar título → "Mais como os selecionados" (5 créditos):** `POST /generate/titles/custom-references` com `referenceTitles: [...]`. O painel do título selecionado oferece ainda "Crie mais com este título: Ver outliers / Miniatura / Análise detalhada / Roteiro". "Análise detalhada" abre o AI Coach com um prompt pronto (custo 10).
- **Idioma:** com entrada em EN, o grupo SEO veio **em PT** e o grupo outliers **em EN**. A requisição não envia idioma, então o servidor infere o idioma (provavelmente pela conta, pelo locale ou pela região). Com entrada em PT, os dois grupos vieram em PT.
- **De onde vêm os dados:** o grupo SEO sugere uso de busca do YouTube (nome do endpoint); o grupo outliers se apoia em vídeos outliers. O painel "Vídeos outliers" (`GET /youtube/video-outliers?title_search_query=<ideia>&video_type=long&channel_language=en`) lista vídeos reais com multiplicador ("11x"), VPH, inscritos, visualizações e idade, mais "Miniaturas semelhantes". O filtro é fixo em `channel_language=en` mesmo para tema em PT. Cada item traz `breakout_score`, `vph_all_time`, `avg_views`, `median_views`, `engagement_rate`, `video_tags`, `video_topics` etc.
- **Persistência:** cada ideia vira um "blueprint" (`POST/PATCH /pyapi/feed/craft/blueprint`, `blueprint_type: generate`, `save_only: true`). O estado completo (títulos, grupo `seo|outlier`, nota, `liked`) fica serializado como string JSON em `additional_context`. As ideias aparecem em "Recentes" e em `/generate`.

### Descrição, tags e hashtags (fluxo 2 + fluxo 4)

- No app logado sem canal **não há gerador dedicado**. A tabela de custos expõe `optimize-description-generator=1`, `mcp-generate-description=5` e `mcp-generate-tags=5`, que ficam no Optimize (exige canal), na extensão ou no MCP.
- Geradores públicos: o de descrição tem 1 campo ("Tell us about your video...") e promete descrição "scored for SEO, clarity, and engagement". O de hashtags tem "Start with: Idea | URL", "Content format: Long-form | Shorts" e textarea, e promete grupos "core, niche, specific". Ambos são protegidos por **Cloudflare Turnstile** antes de chamar o backend, por isso não houve chamada de API para capturar.
- Pelo AI Coach (fluxo 4) saiu: descrição curta com CTA e 3 hashtags (`#GTA6 #Casimiro #GTA6Gameplay`); depois uma lista de **32 tags** (459/500 caracteres, contados pela ferramenta) com tabela "Busca/mês no BR" e notas por termo, e aviso de Content ID para trailer/gameplay.

### Pesquisa de palavras-chave e ideias (fluxo 3)

- **Métricas por palavra-chave:** Pontuação geral (0–100 + rótulo Baixo/Médio/Alto), Volume de pesquisa (estimativa mensal + rótulo + tendência "Em alta/Em queda"), Concorrência (0–100 + rótulo) e Visualizações por hora.
  - "GTA 6": geral 73, volume 24.022.778 ("Muito alto, Em alta"), concorrência 67, VPH 13.949.640.
  - "Casimiro": geral 56, volume 80.264 ("Alto, Em queda"), concorrência 70, VPH 236.477.
- **Formato de dados** (`xwords/*`): por termo, `competition`, `volume` (0–100, normalizado), `overall`, `estimated_monthly_search`, `calibrated_total_searches_30d`, `monthly_volume_change`, `growth_percentage`; nas relacionadas, `related_score` e `query_shares`, mais componentes internos `wc_bonus` (contagem de palavras) e `inc_bonus`. `keyword_vph` devolve uma série diária `sumViewCount` de ~30 dias. `keyword_trends` traz `search_result_languages` e `period_percent_change`.
- **Limite Free aplicado no servidor:** a busca pede `limit=300`, mas o servidor devolve só 3 itens, com `questions_omitted: 297` ("Não perca mais 297 perguntas"; para relacionadas, "mais 346"). As linhas borradas abaixo ("Trending keyword1", "keyword2"...) são **placeholders falsos do cliente**, não dados reais escondidos. "Palavras-chave em alta" mostra 3 de N.
- **Outliers de vídeo:** filtros Joias / Visualizações / Outlier / Visualizações/hora / Inscritos / Publicado / País / Mais filtros / Classificar. O padrão de país é **US, GB, CA, AU** e `channel_language=en`, por isso a busca "Casimiro" trouxe o jogador Casemiro e não o streamer. No Free vieram 48 vídeos.
- "Ideias diárias" (`/daily-video-ideas`), Optimize e "Por onde devemos começar?" exigem **conectar canal**. `/create` oferece ideias com Boost.

### AI Coach (fluxo 4)

- **Modos:** Regular (10 créditos/mensagem), Deep thinking e MAX (upgrade). A tabela de custos tem `ai-coach-max=35` e `ai-coach-max-50=50`. Chips de atalho: Auditar meu canal, Encontrar nicho, Nova miniatura, Ideias de vídeo, Criar clipes, Tarefas programadas, Shorts com IA, Encontrar B-roll, Narração com IA, Clonar minha voz e Montar vídeo.
- **Transporte:** `POST https://api.vidiq.com/api/question?stream=true&mode=regular&stream_thoughts=true&...` responde `text/event-stream` (SSE) com cerca de 25 *feature flags* na query (`working_trace`, `enable_image_generation`, `use_memory`, `deep_thinking_gated`...). Corpo: `{text, conversation_id, active_plan_type: "free", enabled_skills: ["thumbnails","video_gen","voiceover","music_gen"]}` e, ao clicar uma sugestão, `suggestion_id`/`suggestion_set_id`. Sem WebSocket. A UI mostra "Trabalhou por 16 segundos" e o texto cresce aos poucos (streaming). No fim, a conversa é relida via `GET /ai-coach/conversations/:id/messages?working_trace=true`.
- **A mensagem persistida expõe a arquitetura**, que é o achado mais útil para o Clipes:
  - `answer_policy`: modelo **`deepseek/deepseek-v4.1-flash-1017` via OpenRouter** (providers deepseek/together/deepinfra, `max_tokens 16384`, thinking com `reasoning_effort: low`);
  - `content_blocks` dos tipos `thinking`, `tool_calls` e `text` (o raciocínio fica salvo);
  - *tool calls* do agente: `score_titles {titles[], is_short}`, `keyword_analysis {keywords[], country: "BR"}`, `related_keywords {keyword, limit, country}` e `check_upload_metadata {hashtags[] | tags[]}`. Ou seja, o LLM gera os títulos e uma ferramenta própria lhes dá nota (87, 86, 82...); volumes vêm de `keyword_analysis` por país;
  - `metrics`: `turn_ms` ~15 s, ~66k tokens de entrada na 1ª mensagem (prompt de sistema grande, com cache de 131k–280k), `estimated_cost_usd` 0,011 e 0,004 por resposta.
- Sugestões de acompanhamento: `GET /ai-coach/suggested/responses` com `model: "gemini-3.1-flash-lite"` e `prompt_version`.
- Os "chips" de palavra-chave no texto (ex.: `73 gta 6`) são preenchidos depois via `GET /xwords/hottersearch?q=...&q=...&skip_recs=t`, que extrai termos do Markdown.

### Miniatura (fluxo 5)

- Disponível no Free: **22 créditos por geração ou edição** (`thumbnail-maker-generations-v2=22`). Entradas: texto e "Anexar" (imagens); há também `subject-images` (pessoas/objetos salvos) e `user_likeness` (rosto do usuário, vazio aqui).
- `POST /thumbnail-editor/generate-unified` com `{userQuery, hasLimitedVideoContext: false, model: "gemini-3.1-flash-image", carouselIndex: 0}`. A resposta traz `url` (S3), `group_id`, `seed`, `is_image_safe`, `layers`/`layered_image_uri` e `promptIQ.prompt_data.prompt`. Esse último é o **prompt expandido** pelo vidIQ: "Create a professional YouTube thumbnail for: … STYLE REQUIREMENTS (cores vivas, rosto grande com emoção, texto de 2–5 palavras, 16:9) / COMPOSITION / TEXT OVERLAY (complementar ao título, *curiosity gap*)".
- Editor: ferramentas Trocar rosto, Texto, Imagem e Adesivo; edição por prompt nos modos **Comando / Comentar / Remover / Marcação** (22 cada); desfazer/refazer; download em JPEG gerado no cliente (data URL).
- Bug observado: a tela não sai de "Criando" mesmo com a resposta 200 em 19,6 s. Reabrir pelo histórico resolve.

### Tabela de custos (de `GET /quota/balance/global → globalQuotaFeatures`)

Trechos relevantes: `generate-title-gen=5`, `AI Coach V3 - Regular mode=10`, `thumbnail-maker-generations-v2=22`, `optimize-description-generator=1`, `mcp-generate-tags=5`, `mcp-generate-description=5`, `ai-hooks-generator=3`, `ai-video-analysis=3`, `video-package-generation=25`, **`clipping=9 por minuto`**, `shorts-generator=20/min`, `voiceover-v2=28/min`, `script-generator=1/min`. O endpoint lista mais de 100 features (inclusive o MCP `mcp-*`, Instagram/TikTok e publicação), e serve como catálogo do produto.

### Diferenças em relação ao Opus Clip

- O vidIQ é **de texto e pesquisa** sobre dados do YouTube (volume, concorrência, VPH, outliers). Nos fluxos testados não houve transcrição, segmentos, legendas nem enquadramento; o recorte de vídeo existe ("Criar clipes", `clipping=9 créditos/min`), mas não foi usado.
- A cobrança é por **créditos por ação** (5/10/22), não por minutos de vídeo processado. No Free, 150 créditos/mês dão para cerca de 15 mensagens do Coach ou 6 miniaturas.
- O núcleo de IA é um **agente com ferramentas** (LLM barato via OpenRouter + `score_titles`/`keyword_analysis`), e a nota de título vem de uma ferramenta separada, não do próprio LLM. Para o Clipes, isso confirma a separação "Provedor gera; pontuação/dados externos são opcionais e explicáveis".
- O Free trunca resultados no servidor (3 itens) e exige canal conectado para ideias e Optimize.
- Captcha (Turnstile) nas ferramentas públicas. No app logado, não houve captcha.

## Endpoints de API por fluxo

Extraídos com `node tools/har-endpoints.mjs hars/<fluxo>.har`. Só hosts `*.vidiq.com`, sem assets estáticos; IDs (UUID, hex, numéricos, tokens longos) trocados por `:id`; a coluna "Query" lista só as **chaves** dos parâmetros. Terceiros (analytics, ads) vêm resumidos por host.

### vidiq-01-titulos

| Método | Host | Path | Nº | Status | Tipo | Query (chaves) |
|---|---|---|---|---|---|---|
| GET | api.vidiq.com | `/ai-coach/conversations` | 7 | 200 | application/json | limit, sort_by, exclude_folder_memberships |
| GET | api.vidiq.com | `/ai-coach/folders` | 3 | 200 | application/json | include_conversations, limit |
| GET | api.vidiq.com | `/ai-coach/folders/items/memberships` | 3 | 200 | application/json |  |
| GET | api.vidiq.com | `/ai-coach/modes` | 3 | 200 | application/json | one_coach_mode_surface |
| GET | api.vidiq.com | `/ai-coach/skills` | 2 | 200 | application/json |  |
| GET | account.vidiq.com | `/auth/multiplatform/accounts` | 4 | 200 | application/json |  |
| GET | api.vidiq.com | `/auth/user` | 5 | 200 | application/json |  |
| GET | api.vidiq.com | `/experimentation/amplitude` | 6 | 200 | application/json | device_id, user_id, flag_keys |
| POST | api.vidiq.com | `/experimentation/batch-by-keys` | 3 | 200 | application/json |  |
| POST | api.vidiq.com | `/generate/titles/custom-references` | 1 | 200 | application/json |  |
| POST | api.vidiq.com | `/generate/titles/outliers` | 2 | 200 | application/json |  |
| POST | api.vidiq.com | `/generate/titles/youtube-search` | 3 | 200 | application/json |  |
| GET | app.vidiq.com | `/manifest.json` | 3 | 200 | application/json |  |
| GET | api.vidiq.com | `/pyapi/feed/craft/blueprint` | 6 | 200 | application/json | blueprint_type, limit |
| POST | api.vidiq.com | `/pyapi/feed/craft/blueprint` | 2 | 201 | application/json |  |
| PATCH | api.vidiq.com | `/pyapi/feed/craft/blueprint/:id` | 3 | 200 | application/json |  |
| GET | api.vidiq.com | `/pyapi/script_generator/scripts` | 3 | 200 | application/json | limit |
| GET | api.vidiq.com | `/pyapi/video_gen/projects` | 3 | 200 | application/json | limit |
| GET | api.vidiq.com | `/quota/balance/global` | 14 | 200 | application/json |  |
| GET | api.vidiq.com | `/quota/events` | 3 | 200 | application/json | client, limit |
| GET | api.vidiq.com | `/subscriptions/active` | 6 | 200 | application/json | disableExperiment |
| GET | api.vidiq.com | `/subscriptions/plans/available/authed-smart` | 6 | 200 | application/json | plan_bundle_id, disableExperiment, exp |
| GET | api.vidiq.com | `/subscriptions/stripe/next-subscription` | 3 | 200 | application/json |  |
| POST | api.vidiq.com | `/subscriptions/validate-coupon` | 3 | 200 | application/json | disableExperiment |
| GET | api.vidiq.com | `/thumbnail-editor/thumbnails` | 3 | 200 | application/json | pageSize |
| GET | api.vidiq.com | `/user/channels` | 3 | 200 | application/json |  |
| GET | api.vidiq.com | `/youtube/video-outliers` | 1 | 200 | application/json | page_size, page, video_type, title_search_query, channel_language |

Terceiros (analytics/ads, contagem): analytics.tiktok.com (45), cfriuxb2f3.execute-api.us-east-1.amazonaws.com (43), www.google.com (16), bat.bing.com (16), gw.stape.ws (13), analytics.google.com (12), gs.amplitude.com (12), api.omappapi.com (7), www.google-analytics.com (3), pixel-config.reddit.com (3), bzrcdn.openai.com (3), bzr.openai.com (3), capig.stape.st (3), www.facebook.com (3), ad.doubleclick.net (2), analytics-ipv6.tiktokw.us (2), stats.g.doubleclick.net (1)

### vidiq-02-descricao-tags

| Método | Host | Path | Nº | Status | Tipo | Query (chaves) |
|---|---|---|---|---|---|---|
| GET | vidiq.com | `/_next/data/:id/en-US/youtube-channel-description-generator.json` | 3 | 200 | application/json |  |
| HEAD | vidiq.com | `/_next/data/:id/en-US/youtube-hashtag-generator.json` | 2 | 200 | application/json |  |
| HEAD | vidiq.com | `/_next/data/:id/en-US/youtube-tag-generator.json` | 1 | 404 | x-unknown |  |
| GET | api.vidiq.com | `/ai-coach/conversations` | 11 | 200 | application/json | limit, sort_by, exclude_folder_memberships |
| GET | api.vidiq.com | `/ai-coach/folders` | 11 | 200 | application/json | include_conversations, limit |
| GET | api.vidiq.com | `/ai-coach/folders/items/memberships` | 11 | 200 | application/json |  |
| GET | api.vidiq.com | `/ai-coach/modes` | 8 | 200 | application/json | one_coach_mode_surface |
| GET | api.vidiq.com | `/ai-coach/skills` | 8 | 200 | application/json |  |
| GET | account.vidiq.com | `/auth/multiplatform/accounts` | 11 | 200 | application/json |  |
| GET | api.vidiq.com | `/auth/user` | 19 | 200 | application/json |  |
| POST | bridge.vidiq.com | `/data` | 8 | 200 | application/json | v, event |
| GET | api.vidiq.com | `/experimentation/amplitude` | 22 | 200 | application/json | device_id, user_id, flag_keys |
| POST | api.vidiq.com | `/experimentation/batch-by-keys` | 11 | 200 | application/json |  |
| GET | app.vidiq.com | `/manifest.json` | 11 | 200 | application/json |  |
| GET | vidiq.com | `/manifest.json` | 8 | 200 | application/json |  |
| GET | api.vidiq.com | `/pyapi/feed/craft/blueprint` | 14 | 200 | application/json | blueprint_type, limit, is_favorite |
| GET | api.vidiq.com | `/pyapi/onboarding/topics` | 1 | 200 | application/json | channel_id |
| GET | api.vidiq.com | `/pyapi/script_generator/scripts` | 11 | 200 | application/json | limit |
| POST | api.vidiq.com | `/pyapi/thumbnails_async` | 2 | 202 | application/json |  |
| GET | api.vidiq.com | `/pyapi/thumbnails_async/:id` | 10 | 200 | application/json |  |
| GET | api.vidiq.com | `/pyapi/video_gen/projects` | 11 | 200 | application/json | limit |
| GET | api.vidiq.com | `/quota/balance/global` | 11 | 200 | application/json |  |
| GET | api.vidiq.com | `/quota/events` | 11 | 200 | application/json | client, limit |
| GET | api.vidiq.com | `/subscriptions/active` | 22 | 200 | application/json | disableExperiment |
| GET | api.vidiq.com | `/subscriptions/plans/available/authed-smart` | 22 | 200 | application/json | plan_bundle_id, disableExperiment, exp |
| GET | api.vidiq.com | `/subscriptions/plans/available/smart` | 1 | 200 | application/json |  |
| GET | api.vidiq.com | `/subscriptions/stripe/next-subscription` | 11 | 200 | application/json |  |
| POST | api.vidiq.com | `/subscriptions/validate-coupon` | 11 | 200 | application/json | disableExperiment |
| GET | api.vidiq.com | `/thumbnail-editor/thumbnails` | 11 | 200 | application/json | pageSize |
| GET | api.vidiq.com | `/user/channels` | 11 | 200 | application/json |  |

Terceiros (analytics/ads, contagem): cfriuxb2f3.execute-api.us-east-1.amazonaws.com (173), www.google.com (108), analytics.tiktok.com (93), gw.stape.ws (64), bat.bing.com (47), gs.amplitude.com (44), analytics.google.com (41), api.omappapi.com (25), capig.stape.st (18), www.facebook.com (18), challenges.cloudflare.com (18), cdn-cookieyes.com (16), www.google-analytics.com (11), pixel-config.reddit.com (11), bzrcdn.openai.com (11), bzr.openai.com (11), log.cookieyes.com (8), directory.cookieyes.com (8), api.lab.amplitude.com (7), analytics-ipv6.tiktokw.us (4), ad.doubleclick.net (3), www.googletagmanager.com (3), vidiqpartners.go2cloud.org (2)

### vidiq-03-ideias-score

| Método | Host | Path | Nº | Status | Tipo | Query (chaves) |
|---|---|---|---|---|---|---|
| HEAD | vidiq.com | `/_next/data/:id/pt.json` | 1 | 200 | application/json |  |
| GET | vidiq.com | `/_next/data/:id/pt/:id/how-cube-chemistry-14x-ed-their-subscribers-in-12-months.json` | 1 | 200 | application/json | slug |
| GET | vidiq.com | `/_next/data/:id/pt/:id/how-noel-has-gone-from-3k-subs-to-41k-subs-with-a-vidiq-1-1-coach.json` | 1 | 200 | application/json | slug |
| GET | vidiq.com | `/_next/data/:id/pt/:id/kiwi-modulars-youtube-coaching-success.json` | 1 | 200 | application/json | slug |
| GET | vidiq.com | `/_next/data/:id/pt/:id/kryptonite-korner-youtube-coaching-success.json` | 1 | 200 | application/json | slug |
| GET | vidiq.com | `/_next/data/:id/pt/features/clipping.json` | 1 | 200 | application/json | routeSegments |
| GET | vidiq.com | `/_next/data/:id/pt/features/keyword-tools.json` | 1 | 200 | application/json | routeSegments |
| GET | vidiq.com | `/_next/data/:id/pt/features/scorecard.json` | 1 | 200 | application/json | routeSegments |
| GET | api.vidiq.com | `/ai-coach/conversations` | 8 | 200 | application/json | limit, sort_by, exclude_folder_memberships |
| GET | api.vidiq.com | `/ai-coach/folders` | 3 | 200 | application/json | include_conversations, limit |
| GET | api.vidiq.com | `/ai-coach/folders/items/memberships` | 3 | 200 | application/json |  |
| GET | api.vidiq.com | `/ai-coach/modes` | 2 | 200 | application/json | one_coach_mode_surface |
| GET | api.vidiq.com | `/ai-coach/skills` | 1 | 200 | application/json |  |
| GET | account.vidiq.com | `/auth/multiplatform/accounts` | 4 | 200 | application/json |  |
| GET | api.vidiq.com | `/auth/user` | 4 | 200 | application/json |  |
| POST | vidiq.com | `/cdn-cgi/rum` | 1 | 204 | text/plain |  |
| POST | api.vidiq.com | `/channels/search` | 4 | 200 | application/json |  |
| POST | bridge.vidiq.com | `/data` | 1 | 200 | application/json | v, event |
| GET | api.vidiq.com | `/experimentation/amplitude` | 6 | 200 | application/json | device_id, user_id, flag_keys |
| POST | api.vidiq.com | `/experimentation/batch-by-keys` | 3 | 200 | application/json |  |
| GET | app.vidiq.com | `/manifest.json` | 3 | 200 | application/json |  |
| GET | vidiq.com | `/manifest.json` | 1 | 200 | application/json |  |
| GET | api.vidiq.com | `/pyapi/feed/craft/blueprint` | 3 | 200 | application/json | blueprint_type, limit |
| GET | api.vidiq.com | `/pyapi/script_generator/scripts` | 3 | 200 | application/json | limit |
| GET | api.vidiq.com | `/pyapi/video_gen/projects` | 3 | 200 | application/json | limit |
| GET | api.vidiq.com | `/quota/balance/global` | 10 | 200 | application/json |  |
| GET | api.vidiq.com | `/quota/events` | 3 | 200 | application/json | client, limit |
| GET | api.vidiq.com | `/subscriptions/active` | 6 | 200 | application/json | disableExperiment |
| GET | api.vidiq.com | `/subscriptions/plans/available/authed-smart` | 6 | 200 | application/json | plan_bundle_id, disableExperiment, exp |
| GET | api.vidiq.com | `/subscriptions/stripe/next-subscription` | 3 | 200 | application/json |  |
| POST | api.vidiq.com | `/subscriptions/validate-coupon` | 3 | 200 | application/json | disableExperiment |
| GET | api.vidiq.com | `/thumbnail-editor/thumbnails` | 3 | 200 | application/json | pageSize |
| GET | api.vidiq.com | `/user-library/bookmarks` | 4 | 200 | application/json | bookmarkType, offset, limit |
| GET | api.vidiq.com | `/user/channels` | 3 | 200 | application/json |  |
| GET | api.vidiq.com | `/xwords/hottersearch` | 2 | 200 | application/json | q, min_related_score, group |
| GET | api.vidiq.com | `/xwords/keyword_search/` | 2 | 200 | application/json | term, part, limit, group |
| GET | api.vidiq.com | `/xwords/keyword_trends/` | 2 | 200 | application/json | period, limit, topic, language, group |
| GET | api.vidiq.com | `/xwords/keyword_vph/` | 2 | 200 | application/json | keyword |
| GET | api.vidiq.com | `/xwords/topics/` | 1 | 200 | application/json | period, limit, group |
| GET | api.vidiq.com | `/youtube/video-outliers` | 9 | 200 | application/json | channel_country, title_search_query, video_type, page, page_size, thumbnail_embedding_enabled, channel_language, video_published_at_from |
| GET | api.vidiq.com | `/yt/channels` | 1 | 200 | application/json | ids |

Terceiros (analytics/ads, contagem): www.google.com (72), cfriuxb2f3.execute-api.us-east-1.amazonaws.com (57), analytics.tiktok.com (41), gw.stape.ws (19), bat.bing.com (17), gs.amplitude.com (12), analytics.google.com (8), capig.stape.st (8), www.facebook.com (8), api.omappapi.com (7), analytics-ipv6.tiktokw.us (4), accounts.google.com (4), ad.doubleclick.net (3), www.google-analytics.com (3), bzrcdn.openai.com (3), pixel-config.reddit.com (3), bzr.openai.com (3), ogads-pa.clients6.google.com (3), play.google.com (3), csp.withgoogle.com (2), cdn-cookieyes.com (2), www.googleadservices.com (1), ep1.adtrafficquality.google (1), log.cookieyes.com (1), google.com (1), directory.cookieyes.com (1)

### vidiq-04-ai-coach

| Método | Host | Path | Nº | Status | Tipo | Query (chaves) |
|---|---|---|---|---|---|---|
| GET | api.vidiq.com | `/ai-coach/conversations` | 5 | 200 | application/json | limit, sort_by, exclude_folder_memberships |
| GET | api.vidiq.com | `/ai-coach/conversations/:id` | 1 | 404 | application/json |  |
| GET | api.vidiq.com | `/ai-coach/conversations/:id/messages` | 2 | 200 | application/json | working_trace |
| GET | api.vidiq.com | `/ai-coach/conversations/:id/video-deliveries` | 3 | 404,200 | application/json |  |
| GET | api.vidiq.com | `/ai-coach/folders` | 1 | 200 | application/json | include_conversations, limit |
| GET | api.vidiq.com | `/ai-coach/folders/items/memberships` | 1 | 200 | application/json |  |
| GET | api.vidiq.com | `/ai-coach/modes` | 1 | 200 | application/json | one_coach_mode_surface |
| GET | api.vidiq.com | `/ai-coach/skills` | 2 | 200 | application/json |  |
| GET | api.vidiq.com | `/ai-coach/suggested/responses` | 2 | 200 | application/json | conversation_id, custom_skills_enabled |
| POST | api.vidiq.com | `/api/question` | 2 | 200 | text/event-stream | stream, mode, stream_thoughts, summarize_context, drl, use_memory, enable_image_generation, use_config, enable_consent, calendar_enabled, fc, image_refinement_v2, f_id, custom_skills_enabled, supports_document_export, script_document_v2, script_draft_v1, script_refinement_v1, feature_proposals, mode_handoff_card, connector_suggestion_v1, coach_handoff_card, scheduled_jobs, working_trace, deep_thinking_gated, one_coach_mode_surface, timezone |
| GET | account.vidiq.com | `/auth/multiplatform/accounts` | 3 | 200 | application/json |  |
| GET | api.vidiq.com | `/auth/user` | 3 | 200 | application/json |  |
| GET | api.vidiq.com | `/experimentation/amplitude` | 2 | 200 | application/json | device_id, user_id, flag_keys |
| POST | api.vidiq.com | `/experimentation/batch-by-keys` | 1 | 200 | application/json |  |
| GET | app.vidiq.com | `/manifest.json` | 1 | 200 | application/json |  |
| GET | api.vidiq.com | `/pyapi/feed/craft/blueprint` | 1 | 200 | application/json | blueprint_type, limit |
| GET | api.vidiq.com | `/pyapi/script_generator/scripts` | 1 | 200 | application/json | limit |
| GET | api.vidiq.com | `/pyapi/video_gen/projects` | 1 | 200 | application/json | limit |
| GET | api.vidiq.com | `/quota/balance/global` | 5 | 200 | application/json |  |
| GET | api.vidiq.com | `/quota/events` | 1 | 200 | application/json | client, limit |
| GET | api.vidiq.com | `/subscriptions/active` | 2 | 200 | application/json | disableExperiment |
| GET | api.vidiq.com | `/subscriptions/plans/available/authed-smart` | 2 | 200 | application/json | plan_bundle_id, disableExperiment, exp |
| GET | api.vidiq.com | `/subscriptions/stripe/next-subscription` | 1 | 200 | application/json |  |
| POST | api.vidiq.com | `/subscriptions/validate-coupon` | 1 | 200 | application/json | disableExperiment |
| GET | api.vidiq.com | `/thumbnail-editor/thumbnails` | 1 | 200 | application/json | pageSize |
| GET | api.vidiq.com | `/user/channels` | 1 | 200 | application/json |  |
| GET | api.vidiq.com | `/xwords/hottersearch` | 4 | 200 | application/json | q, skip_recs |

Terceiros (analytics/ads, contagem): cfriuxb2f3.execute-api.us-east-1.amazonaws.com (32), analytics.tiktok.com (19), bat.bing.com (12), analytics.google.com (6), gw.stape.ws (6), www.google.com (5), gs.amplitude.com (4), api.omappapi.com (3), capig.stape.st (3), www.facebook.com (3), analytics-ipv6.tiktokw.us (2), www.google-analytics.com (1), pixel-config.reddit.com (1), bzrcdn.openai.com (1), bzr.openai.com (1)

Observação: o corpo do SSE de `/api/question` não fica no HAR (limitação do `recordHar` do Playwright com streams). O conteúdo final está em `/messages?working_trace=true`.

### vidiq-05-thumbnail

| Método | Host | Path | Nº | Status | Tipo | Query (chaves) |
|---|---|---|---|---|---|---|
| GET | api.vidiq.com | `/ai-coach/conversations` | 18 | 200 | application/json | limit, sort_by, exclude_folder_memberships |
| GET | api.vidiq.com | `/ai-coach/folders` | 3 | 200 | application/json | include_conversations, limit |
| GET | api.vidiq.com | `/ai-coach/folders/items/memberships` | 3 | 200 | application/json |  |
| GET | api.vidiq.com | `/ai-coach/modes` | 3 | 200 | application/json | one_coach_mode_surface |
| GET | api.vidiq.com | `/ai-coach/skills` | 1 | 200 | application/json |  |
| GET | account.vidiq.com | `/auth/multiplatform/accounts` | 3 | 200 | application/json |  |
| GET | api.vidiq.com | `/auth/user` | 4 | 200 | application/json |  |
| GET | api.vidiq.com | `/experimentation/amplitude` | 6 | 200 | application/json | device_id, user_id, flag_keys |
| POST | api.vidiq.com | `/experimentation/batch-by-keys` | 3 | 200 | application/json |  |
| GET | app.vidiq.com | `/manifest.json` | 3 | 200 | application/json |  |
| POST | account.vidiq.com | `/oauth2/token` | 1 | 200 | application/json |  |
| GET | api.vidiq.com | `/pyapi/feed/craft/blueprint` | 4 | 200 | application/json | blueprint_type, limit |
| GET | api.vidiq.com | `/pyapi/script_generator/scripts` | 6 | 200 | application/json | limit |
| GET | api.vidiq.com | `/pyapi/shorts_creation/shorts/credits` | 2 | 200 | application/json | limit |
| GET | api.vidiq.com | `/pyapi/video_gen/projects` | 4 | 200 | application/json | limit |
| GET | api.vidiq.com | `/quota/balance/global` | 25 | 200 | application/json |  |
| GET | api.vidiq.com | `/quota/events` | 3 | 200 | application/json | client, limit |
| GET | api.vidiq.com | `/subscriptions/active` | 6 | 200 | application/json | disableExperiment |
| GET | api.vidiq.com | `/subscriptions/plans/available/authed-smart` | 6 | 200 | application/json | plan_bundle_id, disableExperiment, exp |
| GET | api.vidiq.com | `/subscriptions/stripe/next-subscription` | 3 | 200 | application/json |  |
| POST | api.vidiq.com | `/subscriptions/validate-coupon` | 3 | 200 | application/json | disableExperiment |
| POST | api.vidiq.com | `/thumbnail-editor/generate-unified` | 1 | 200 | application/json |  |
| GET | api.vidiq.com | `/thumbnail-editor/thumbnails` | 6 | 200 | application/json | pageSize |
| GET | api.vidiq.com | `/thumbnail-editor/thumbnails/:id` | 1 | 200 | application/json |  |
| GET | api.vidiq.com | `/thumbnail-editor/v2/subject-images` | 2 | 200 | application/json | pageSize |
| GET | api.vidiq.com | `/user/channels` | 3 | 200 | application/json |  |

Terceiros (analytics/ads, contagem): cfriuxb2f3.execute-api.us-east-1.amazonaws.com (47), analytics.tiktok.com (20), bat.bing.com (20), www.google.com (15), gs.amplitude.com (12), api.omappapi.com (9), analytics.google.com (8), gw.stape.ws (6), bzrcdn.openai.com (5), www.google-analytics.com (3), pixel-config.reddit.com (3), bzr.openai.com (3), capig.stape.st (3), www.facebook.com (3), ad.doubleclick.net (2), analytics-ipv6.tiktokw.us (2)

Observação: `GET /pyapi/user_likeness` (204, sem corpo) não aparece na tabela porque o filtro exige corpo JSON.

## Pendências

- Fluxo 2 só pode ser feito pelo dev, à mão (resolvendo o Turnstile num navegador normal) ou com canal conectado (Optimize), o que este teste não autorizava.
- A captura do corpo SSE do AI Coach exigiria outro método (por exemplo, `page.on('response')` com leitura do stream ou CDP `Network.streamResourceContent`).
