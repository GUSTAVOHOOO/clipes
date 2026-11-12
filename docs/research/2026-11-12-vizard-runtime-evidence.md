# Relatório de gravação de HARs: Vizard.ai (ticket #9)

Data: 12/11/2026. Conta do dev no plano **Free**, perfil `profile-vizard`, porta 9223. Estudo funcional em sala limpa: uso normal do produto e gravação do tráfego. Nada foi publicado, agendado, comprado ou conectado a redes sociais. Nenhum questionário foi respondido: um NPS ("How likely are you to recommend Vizard…") apareceu no fluxo 06 e foi fechado sem resposta.

## Resumo

- **Saldo de créditos: 40 antes e 40 depois.** Nenhum crédito foi gasto.
- **O fluxo 01 foi bloqueado antes do envio.** O vídeo autorizado (42:20) custa 42 créditos e a conta tem 40. O seletor de trecho, que limitaria o job aos 5 primeiros minutos, é recurso pago. Seguindo a orientação do coordenador (opção B), os fluxos 02 a 06 usaram o projeto que já existia na conta, "20 COISAS QUE VOCÊ PRECISA SABER ANTES DE JOGAR GTA 6" (20:49, 10 cortes já gerados). O resultado foi o mesmo sem gastar créditos.
- **O editor completo não renderiza no navegador automatizado.** O SDK de vídeo do editor (Meishe, em WASM) registra `Headless browser is not supported!` e `Failed to initialize Meishe streaming context!`, porque detecta a automação (`navigator.webdriver`). O preview e a timeline do editor ficam em branco. **Não burlei essa detecção.** Transcrição, legendas, proporção, layout, presets e salvamento funcionam por DOM e API e foram gravados. O ajuste de corte também foi feito pelo diálogo "Edit clip length" da página do projeto, que usa um `<video>` comum.
- Os HARs contêm tokens de sessão e **credenciais temporárias da AWS (STS)** devolvidas por `css-file/css-params`. Não devem ser commitados nem compartilhados publicamente.

## Tabela por fluxo

| # | Fluxo | Status | O que foi feito | O que o HAR capturou |
|---|---|---|---|---|
| 01 | `vizard-01-importar` | ⚠️ parcial (bloqueado antes do envio) | Colei o link do YouTube e cliquei em GET CLIPS. Na tela de upload, inspecionei idioma (PT detectado), toggle "Get AI clips", Model v1 (42 créditos) e v2 (premium, 53 créditos) e o seletor "Select process duration". Arrastar o fim do trecho abre o modal "Upgrade to save your credits". O botão Upload fica desabilitado: "This video needs 42 credits, which exceeds your current balance of 40". Não há campo de prompt nem de duração dos cortes nessa tela do Free. **Nada foi enviado.** | `vizard-video/download-video-info` (metadados do YouTube: formatos, duração, idioma, thumbnail, `isCached`), config, assinatura, lista de projetos. Não há job de IA nem polling, porque o job não foi criado. 6,6 MB. |
| 02 | `vizard-02-resultados` | ✅ | Abri o projeto existente. Li o tour de 4 passos. Percorri os 10 cortes (título, nota de viralidade, "Viral reason", transcrição com timestamps). Testei a ordenação (Highest score / Earliest timeline), o seletor de qualidade (720p livre; 1080p, 2K e 4K premium; toggle AI Enhance), os tooltips (Share to…, Trim/Extend, Open in editor) e reproduzi os cortes 1 e 2. | `clip-video/list-flow` (lista completa dos cortes com `clipParams`), `vizard-video/detail`, o JSON da IA em `cdn-docs…/date-data/…` (20 cortes candidatos, palavras e keywords), docs de transcrição e estilo por corte, `ai-prompt/list`, `publish/list-wait-scheduled-by-source` (só leitura). 22,8 MB. |
| 03 | `vizard-03-ajustar-corte` | ✅ | (a) No editor, aba **Transcript**: selecionei "A Rockstar promete Em seus" e apaguei (o trecho fica riscado; "R" recupera). Autosave às 13:24; persistiu após reload. (b) Na página do projeto, botão **Trim/Extend**, diálogo "Edit clip length": transcrição da fonte inteira com timestamps, waveform e campos início/fim. Estendi o fim de 18:58.69 para 19:02.00 e salvei, com Auto reframe ligado. Disparou "AI reframing" (~45 s) e depois "Saving..." (~30 s). O corte passou de 00:50 para 00:49 e agora começa em "comunicados oficiais" (18:11). | `clip-video/ai-facial` (`timeArray` com bt/et em ms) + polling `batch/ai-facial-result` (15×); `final-video/export` + polling `final-video/batch-query` (10×); ciclo de autosave `css-file/css-params` → PUT no S3 → `css-file/verify` → `upload-userjson-by-css-id` / `upload-user-style-json-by-css-id`; `get-waveform`; `update-clip-time`, `update-ratio-type`; editor (`censor-words`, `font/list`). Os erros do Meishe também ficaram registrados. 135,6 MB. |
| 04 | `vizard-04-enquadramento` | ⚠️ parcial | No corte #2, abri Ratio (9:16 / 1:1 / 4:5 / 16:9 + Apply), Layout (8 presets de divisão câmera/tela, com 1 ou 2 pessoas, + "Apply to all"), Background (cor/imagem/upload, "Apply to all") e Element ("No speaker or screen — Crop and label it yourself", "Reset to full video"). Apliquei o layout 1 (pessoa em cima, tela embaixo) e Ratio 1:1 (autosave às 13:29). **A troca de proporção não persistiu**: após reload, o corte voltou a 9:16. **O layout persistiu**: no MP4 exportado, a fonte aparece reduzida na metade inferior. O recorte manual por cena ("Crop and label it yourself") depende do canvas do Meishe e não foi possível. | `update-ratio-type`, uploads de `userStyleJson` (cena com `element.video[]`: retângulo de recorte `sx/sy/sw/sh`, posição `x/y/w/h`, `isFaceTracking`, `speakerType`), `ai-facial`. Também listei os painéis AI tools, Template e Subtitles. 49,4 MB. |
| 05 | `vizard-05-legenda` | ✅ (tradução ⏭️ paywall) | Aba **Edit subtitles** do corte #2: troquei "Bom," por "Bom!"; quebrei a linha "aqui temos" em "aqui" (01.26–01.48) e "temos" (01.48–01.76); ao quebrar, o tempo da linha é dividido entre as partes. Abri Subtitle settings (Subtitle display / Punctuation / Emoji). **Tradução PT→EN: lista com ~130 idiomas, mas o botão Translate abre "Upgrade for subtitle translation"**; nenhuma chamada de API é feita. Troquei o preset para "BOXING" (amarelo) com "Apply to all" desmarcado. **O preset re-segmentou as legendas e desfez a quebra; a linha "Bom!" sumiu.** Refiz a quebra e editei "informação" → "informação!", e as duas mudanças persistiram após reload. Aba Settings do preset: fonte (BEBAS NEUE), tamanho 18, alinhamento, B/I/U, cor e 3 cores de destaque. | Autosaves (`upload-userjson-by-css-id` e `upload-user-style-json-by-css-id`, a cada ~30 s), PUTs dos JSONs no S3, `brand-kit/subtitles/list`, `font/list`. 96,1 MB. |
| 06 | `vizard-06-exportar` | ✅ | Corte #1: Download direto, com o arquivo já renderizado (o export do fluxo 03 já existia). Corte #2: tinha o aviso "Your current video is missing your recent edits… Update changes". Cliquei em Update changes: "Saving..." por ~60 s, depois Download. Os dois arquivos foram baixados. O download abre uma aba em branco que dispara o arquivo e fecha. | `final-video/export`, polling `final-video/batch-query`, `list-flow`. O MP4 vem de `cdn-video.vizard.ai` e o próprio arquivo fica fora do HAR (o filtro do driver exclui `.mp4`). 22,8 MB. |

Arquivos baixados (em `downloads/vizard/`), ambos 720×1280, H.264 a 60 fps e AAC, com marca d'água "made with Vizard.ai":

- `O que esperar de GTA VI_ … single player(1).mp4`: 49,2 s, 11,5 MB, ~1,7 Mb/s.
- `O GTA VI físico não vem com disco_ Entenda a polêmica!(1).mp4`: 35,3 s, 5,3 MB, ~1,0 Mb/s. Inclui o preset novo (palavra de destaque em amarelo/ciano), a manchete no topo e o layout dividido.

Alterações deixadas no projeto do dev: corte #1 com início aparado (via transcrição) e fim estendido até 19:02; corte #2 com layout dividido, preset BOXING, legenda "aqui | temos" quebrada, "informação!" e a linha "Bom" removida pelo preset; ratio do #2 tentado em 1:1 sem persistir.

## Achados de produto

### Controles expostos ao usuário

- **Upload (Free):** só idioma (com detecção automática), toggle "Get AI clips", modelo (v1 "Faster, more clips" / v2 premium "AI will think longer… Fewer clips, more complete") e "Have subtitles? Upload TXT, SRT, or DOC". Seletor de trecho, prompt e duração preferida não aparecem no Free. Mesmo assim, a API tem `ai-prompt/list` e o JSON da IA traz `user_prompt` e `pref_len`, então esses parâmetros existem no backend.
- **Lista de cortes:** nota de viralidade (0–10), "Viral reason", manchete (título), transcrição com timestamps, ⭐/👎 para marcar favoritos ou ocultar, "Edited", seleção em lote (Publish/Download/Edit clips/Delete), ordenação por nota ou linha do tempo, qualidade por corte (720p/1080p/2K/4K + AI Enhance) e banner "Remove watermark and unlock 10 more clips".
- **Edit clip length (Trim/Extend):** transcrição da fonte inteira com timestamps (ex.: `18:09.5`), waveform da fonte completa, campos início/fim editáveis em `mm:ss.cc`, zoom e toggle **Auto reframe**. Estender pede novo reenquadramento por IA (`ai-facial`).
- **Editor:** abas Transcript / Edit subtitles; barra de proporção, fundo, layout e elemento; painel lateral com AI tools (Remove silence, Auto-censor, Add B-rolls, Emphasize keywords, Add emojis to subtitle), Generate, Brand kit, Template (Simple, Pop, Clean, Abstract, Tech; "Save as template"), Subtitles (Presets/Settings), Upload, Audio, B-roll, Transition e Text. Na transcrição, selecionar palavras abre a barra "Create clip 00:02 / apagar / cor de destaque / copiar / ⋯". Há "Download transcript" em `.srt` e `.txt` e "Filter highlight". O salvamento é automático a cada ~30 s ("Last saved: …"); o botão **Save** é na verdade "Save & Export" (720p livre, resto premium).
- **Edição de legenda:** uma linha por bloco com `início – fim`, emoji por linha (🎮, ⚠️, 🛒…), sublinhado colorido nas palavras-chave (3 cores), Enter quebra a linha (o tempo é dividido entre as partes) e há modo "Sentence".

### Formatos de dados interessantes

- **JSON de resultado da IA** (`cdn-docs.vizard.ai/date-data/<user>/<hash>.json`): `{ user_prompt, version: "20251024", use_spark, pref_len:[0], lang:"pt", clip_count:20, video_length_ms, clips:[…] }`. Cada corte traz `headline`, `reason`, `keywords` (5), `viral_score` (10 → 8.2), `length` (31–51 s), `start_time/end_time` (ms), `clip_segments[{start_time,end_time}]` (aceita vários segmentos), `extend`, `reClip`, `engine` (28), `driven_by: "Speech"` e `words[{text, beginTime, endTime, bt:"00:08:22,786", et, speaker:"SPEAKER_01", h}]`. **A IA gera 20 cortes e o Free mostra só 10.**
- **`clipParams`** (string JSON em `list-flow`): `{reason, start_time, end_time, keywords[], viral_tags, engine, viral_score, driven_by, dimensions, aiClipVersion}`. Cada corte também tem `score`, `ratioType` (1 = 9:16), `timeline` (ms na fonte), `clipType` e `latestFinalVideo {exportQuality, hasFreeWatermark, downloadUrl, transcript, isNodeExport}`.
- **Cache de ASR** (`<id>-cache-<hash>.json`): `{results:[[{seq, bt, et, s, speaker, words:[{bt,et,beginTime,endTime,text,speaker}]}]], version, vizardVideoId, asrProvider}`. São frases com palavras e diarização por corte.
- **Documento de transcrição/legenda (`userJson`):** `{translateInfo:{lang, translateState, dstJson}, options:{isDisplayEmoji}, userJson:[{sceneId, paragraph:[{id, text:[token]}]}], version}`. Cada token é `{id, sId, text, bt, et, type (1 = palavra, 3 = pausa "[0.1s]"), colorType (1/2/3 = cor de destaque), emojiElement:{emojiCode}, isUnSetRuleColor}`. Palavras apagadas e pausas ficam no documento, marcadas, e não são removidas.
- **Documento de estilo/cena (`userStyleJson`):** `sceneInfo {width, height, widthScale, heightScale, headline, isAddAIEmoji, isAddAIKeywords, isAiFacialVideo, isUseAiHighlight, scene:[…]}`. Cada cena tem `bt/et/cutBt/duration`, transições, `volume`, `speaker_list`, `speaker_track_list`, `element.bg` (cor/imagem), `element.video[]` com recorte da fonte (`sx, sy, sw, sh`), posição no quadro (`x, y, w, h`), `isFaceTracking`, `speakerType` e `cornerRadiusRate`, além de `subtitle.editorCaptionStyle`: `captionType` (ex.: `beastEffect`), `fontPackageName` (Tilt Warp, Bebas Neue), `fontSize`, `rows`, `color`, `highlightColor1/2/3`, `isUppercase`, `punctuation`, sombra, contorno, fundo, `x/y/w`. Há um estilo separado para a legenda traduzida (`editorDstCaptionStyle`).
- **Salvamento:** o cliente pede credenciais STS (`css-file/css-params` → `bucketName`, `objectKey`, `credentials`), faz PUT do JSON direto no S3 (`bp-vizard-docs-prod`), confirma com `css-file/verify` (devolve `cssFileId`) e associa ao corte com `upload-userjson-by-css-id` / `upload-user-style-json-by-css-id`. O servidor recebe só o ponteiro; não há diff de edição.
- **Reenquadramento:** `clip-video/ai-facial {clipId, timeArray:"[{bt,et,seq}]", aiFacialTargetType:2}`, com polling a cada ~3–4 s em `batch/ai-facial-result` (`aiFacialState`).
- **Exportação:** `final-video/export {clipId, vizardVideoId, exportRequestCssId, exportWidth:9, exportHeight:16, exportType:8, exportQuality:2, superResolution:false, finalVideoName}` (largura/altura são a proporção, não pixels), com polling a cada ~3 s em `final-video/batch-query` (`exportState`, `downloadUrl`, `transcript`).
- **Import:** `download-video-info {videoUrl, videoSource}` devolve formatos, duração, idioma, `isCached` e thumbnail antes de cobrar.

### Limites do plano gratuito observados

- 40 créditos na conta, 1 crédito = 1 minuto de vídeo de entrada, cobrado pela duração inteira (sem recorte de trecho no Free).
- Model v2, seletor de trecho, exportação acima de 720p, tradução de legendas e remoção de marca d'água são pagos.
- Só 10 dos 20 cortes gerados ficam visíveis.
- Os projetos expiram ("Expires in 3 days").
- A exportação 720p tem marca d'água e não consome créditos.

### Diferenças em relação ao Opus Clip

Comparação com o catálogo público em `docs/research/opus.md` (branch `research/opus`), porque não há relatório do Opus nesta pasta:

- O Opus Free é descrito com 60 créditos/mês, até 1080p e **sem edição**. O Vizard Free tem 40 créditos, exporta só em 720p, mas **permite editar** (transcrição, legendas, layout, presets) e exportar sem gastar créditos.
- No Vizard Free não há prompt nem duração de corte na tela de envio. O Opus expõe ClipAnything/prompt e faixa de duração. No Vizard esses parâmetros existem só na API (`user_prompt`, `pref_len`).
- O Vizard expõe a justificativa da nota ("Viral reason"), 5 keywords e manchete por corte. A nota vai de 0 a 10, com uma casa decimal.
- O Vizard grava edição e estilo como **documentos JSON inteiros no S3** com autosave por tempo. O preview depende de um SDK WASM proprietário (Meishe) que recusa navegadores automatizados.
- O Vizard aplica "AI reframing" automaticamente ao estender um corte, e aplicar um preset de legenda re-segmenta as linhas e desfaz edições manuais de quebra.

### Ideias para o Clipes

- Guardar palavras com `beginTime/endTime` em ms, `speaker` e flags de "apagado" ou "pausa" no mesmo documento, como os tokens `type` 1/3 do `userJson`, e não removê-las.
- Separar o documento de conteúdo (transcrição/legenda) do documento de estilo/cena (`element.video` com recorte da fonte e posição no quadro).
- Re-segmentar legendas por preset sem perder edições manuais (o Vizard perde).
- Exportar a transcrição em `.srt` e `.txt`.

## Endpoints de API por fluxo

Gerado por `scripts/endpoints-vizard.mjs` a partir dos HARs. Hosts `*.vizard.ai` e o bucket S3 do Vizard aparecem na tabela; estáticos e terceiros (analytics, Intercom, Sentry, GTM) entram só na contagem. IDs numéricos, UUIDs e hashes foram trocados por `:id`. Não há corpos, headers nem query strings.


### vizard-01-importar.har (145 entradas)

| Método | Host + path | Qtde | Status | Tipo |
|---|---|---|---|---|
| GET | `cdn-docs.vizard.ai/fonts/page/MazzardH-Regular.otf` | 1 | 200 | binary/octet-stream |
| GET | `cdn-docs.vizard.ai/fonts/page/MazzardH-SemiBold.otf` | 1 | 200 | binary/octet-stream |
| GET | `elb-api.vizard.ai/hvizard-server-front/api/v1/config/config-info` | 1 | 200 | application/json |
| GET | `elb-api.vizard.ai/hvizard-server-front/api/v1/subscription/get-pro-user-info` | 1 | 200 | application/json |
| GET | `elb-api.vizard.ai/hvizard-server-front/api/v1/subscription/get-subscription-info` | 1 | 200 | application/json |
| GET | `elb-api.vizard.ai/hvizard-server-front/api/v1/subscription/list` | 1 | 200 | application/json |
| POST | `elb-api.vizard.ai/hvizard-server-front/api/v1/user/login` | 1 | 200 | application/json |
| GET | `elb-api.vizard.ai/hvizard-server-front/api/v1/vizard-video/demo-detail` | 1 | 200 | application/json |
| POST | `elb-api.vizard.ai/hvizard-server-front/api/v1/vizard-video/download-video-info` | 1 | 200 | application/json |
| POST | `elb-api.vizard.ai/hvizard-server-front/api/v1/vizard-video/list` | 1 | 200 | application/json |
| GET | `elb-api.vizard.ai/hvizard-server-front/api/v1/workspace/list` | 1 | 200 | application/json |
| GET | `vizard.ai/workspace` | 1 | 200 | text/html |

Outros hosts (estáticos/terceiros, só contagem): vizard.ai (108), mcs.tobsnssdk.com (9), js.intercomcdn.com (3), api-client.sleekplan.com (3), api-iam.intercom.io (3), www.googletagmanager.com (2), lf1-cdn-tos.bytegoofy.com (1), lf3-data.volccdn.com (1), r.wdfl.co (1), widget.intercom.io (1), client.sleekplan.com (1)

### vizard-02-resultados.har (178 entradas)

| Método | Host + path | Qtde | Status | Tipo |
|---|---|---|---|---|
| GET | `cdn-docs.vizard.ai/date-data/:id/:id.json` | 22 | 200 | application/octet-stream |
| POST | `elb-api.vizard.ai/hvizard-server-front/api/v1/ai-prompt/list` | 1 | 200 | application/json |
| POST | `elb-api.vizard.ai/hvizard-server-front/api/v1/clip-video/clip-scheduled-publish-count` | 1 | 200 | application/json |
| POST | `elb-api.vizard.ai/hvizard-server-front/api/v1/clip-video/list-flow` | 2 | 200 | application/json |
| GET | `elb-api.vizard.ai/hvizard-server-front/api/v1/config/config-info` | 2 | 200 | application/json |
| GET | `elb-api.vizard.ai/hvizard-server-front/api/v1/font/list` | 1 | 200 | application/json |
| GET | `elb-api.vizard.ai/hvizard-server-front/api/v1/pop-up/list` | 3 | 200 | application/json |
| GET | `elb-api.vizard.ai/hvizard-server-front/api/v1/pop-up/project/list` | 1 | 200 | application/json |
| POST | `elb-api.vizard.ai/hvizard-server-front/api/v1/pop-up/record` | 1 | 200 | application/json |
| POST | `elb-api.vizard.ai/hvizard-server-front/api/v1/publish/list-wait-scheduled-by-source` | 1 | 200 | application/json |
| GET | `elb-api.vizard.ai/hvizard-server-front/api/v1/subscription/get-pro-user-info` | 2 | 200 | application/json |
| GET | `elb-api.vizard.ai/hvizard-server-front/api/v1/subscription/get-subscription-info` | 2 | 200 | application/json |
| GET | `elb-api.vizard.ai/hvizard-server-front/api/v1/user/ai-social/get-default-prompt` | 1 | 200 | application/json |
| POST | `elb-api.vizard.ai/hvizard-server-front/api/v1/user/login` | 2 | 200 | application/json |
| GET | `elb-api.vizard.ai/hvizard-server-front/api/v1/vizard-video/demo-detail` | 1 | 200 | application/json |
| GET | `elb-api.vizard.ai/hvizard-server-front/api/v1/vizard-video/detail/:id` | 1 | 200 | application/json |
| POST | `elb-api.vizard.ai/hvizard-server-front/api/v1/vizard-video/list` | 2 | 200 | application/json |
| GET | `elb-api.vizard.ai/hvizard-server-front/api/v1/vizard-video/recent-project/:id` | 2 | 200 | application/json |
| GET | `elb-api.vizard.ai/hvizard-server-front/api/v1/workspace/list` | 1 | 200 | application/json |
| GET | `vizard.ai/project/:id` | 1 | 200 | text/html |
| GET | `vizard.ai/workspace` | 1 | 200 | text/html |

Outros hosts (estáticos/terceiros, só contagem): vizard.ai (72), mcs.tobsnssdk.com (18), api-iam.intercom.io (7), js.intercomcdn.com (6), www.googletagmanager.com (4), o4507225680576512.ingest.us.sentry.io (4), lf1-cdn-tos.bytegoofy.com (2), lf3-data.volccdn.com (2), widget.intercom.io (2), api-client.sleekplan.com (2), challenges.cloudflare.com (2), r.wdfl.co (1)

### vizard-03-ajustar-corte.har (528 entradas)

| Método | Host + path | Qtde | Status | Tipo |
|---|---|---|---|---|
| PUT | `bp-vizard-docs-prod.s3.us-west-1.amazonaws.com/date-data/:id/:id.json` | 13 | 200 | x-unknown |
| GET | `cdn-docs.vizard.ai/date-data/:id/:id.json` | 56 | 200 | application/octet-stream |
| GET | `cdn-docs.vizard.ai/vizard/censor-words/system/default-v1.json` | 3 | 200 | application/json |
| GET | `cdn-docs.vizard.ai/vizard/waveforms/:id.json` | 1 | 200 | application/octet-stream |
| POST | `elb-api.vizard.ai/hvizard-server-front/api/v1/ai-prompt/list` | 2 | 200 | application/json |
| GET | `elb-api.vizard.ai/hvizard-server-front/api/v1/censor-words/detail` | 3 | 200 | application/json |
| POST | `elb-api.vizard.ai/hvizard-server-front/api/v1/clip-video/ai-facial` | 1 | 200 | application/json |
| POST | `elb-api.vizard.ai/hvizard-server-front/api/v1/clip-video/batch/ai-facial-result` | 15 | 200 | application/json |
| POST | `elb-api.vizard.ai/hvizard-server-front/api/v1/clip-video/clip-scheduled-publish-count` | 2 | 200 | application/json |
| GET | `elb-api.vizard.ai/hvizard-server-front/api/v1/clip-video/detail/:id` | 3 | 200 | application/json |
| POST | `elb-api.vizard.ai/hvizard-server-front/api/v1/clip-video/list-flow` | 4 | 200 | application/json |
| POST | `elb-api.vizard.ai/hvizard-server-front/api/v1/clip-video/update-clip-time` | 2 | 200 | application/json |
| POST | `elb-api.vizard.ai/hvizard-server-front/api/v1/clip-video/update-facial-operate-num` | 1 | 200 | application/json |
| POST | `elb-api.vizard.ai/hvizard-server-front/api/v1/clip-video/update-ratio-type` | 5 | 200 | application/json |
| POST | `elb-api.vizard.ai/hvizard-server-front/api/v1/clip-video/upload-user-style-json-by-css-id` | 6 | 200 | application/json |
| POST | `elb-api.vizard.ai/hvizard-server-front/api/v1/clip-video/upload-userjson-by-css-id` | 6 | 200 | application/json |
| PUT | `elb-api.vizard.ai/hvizard-server-front/api/v1/clip-video/upload-video-thumbnail` | 8 | 200 | application/json |
| GET | `elb-api.vizard.ai/hvizard-server-front/api/v1/config/config-info` | 5 | 200 | application/json |
| POST | `elb-api.vizard.ai/hvizard-server-front/api/v1/css-file/css-params` | 13 | 200 | application/json |
| POST | `elb-api.vizard.ai/hvizard-server-front/api/v1/css-file/verify` | 13 | 200 | application/json |
| POST | `elb-api.vizard.ai/hvizard-server-front/api/v1/final-video/batch-query` | 10 | 200 | application/json |
| POST | `elb-api.vizard.ai/hvizard-server-front/api/v1/final-video/export` | 1 | 200 | application/json |
| GET | `elb-api.vizard.ai/hvizard-server-front/api/v1/font/list` | 5 | 200 | application/json |
| GET | `elb-api.vizard.ai/hvizard-server-front/api/v1/pop-up/list` | 12 | 200 | application/json |
| GET | `elb-api.vizard.ai/hvizard-server-front/api/v1/pop-up/project/list` | 2 | 200 | application/json |
| POST | `elb-api.vizard.ai/hvizard-server-front/api/v1/pop-up/record` | 2 | 200 | application/json |
| POST | `elb-api.vizard.ai/hvizard-server-front/api/v1/publish/list-wait-scheduled-by-source` | 2 | 200 | application/json |
| POST | `elb-api.vizard.ai/hvizard-server-front/api/v1/screenshot/sync` | 2 | 200 | application/json |
| GET | `elb-api.vizard.ai/hvizard-server-front/api/v1/subscription/get-pro-user-info` | 5 | 200 | application/json |
| GET | `elb-api.vizard.ai/hvizard-server-front/api/v1/subscription/get-subscription-info` | 5 | 200 | application/json |
| GET | `elb-api.vizard.ai/hvizard-server-front/api/v1/subscription/list` | 3 | 200 | application/json |
| GET | `elb-api.vizard.ai/hvizard-server-front/api/v1/user/ai-social/get-default-prompt` | 2 | 200 | application/json |
| POST | `elb-api.vizard.ai/hvizard-server-front/api/v1/user/login` | 5 | 200 | application/json |
| GET | `elb-api.vizard.ai/hvizard-server-front/api/v1/vizard-video/ai-clip-result` | 3 | 200 | application/json |
| GET | `elb-api.vizard.ai/hvizard-server-front/api/v1/vizard-video/detail/:id` | 2 | 200 | application/json |
| GET | `elb-api.vizard.ai/hvizard-server-front/api/v1/vizard-video/get-waveform/:id` | 1 | 200 | application/json |
| POST | `elb-api.vizard.ai/hvizard-server-front/api/v1/vizard-video/list` | 2 | 200 | application/json |
| GET | `vizard.ai/editor` | 3 | 200 | text/html |
| GET | `vizard.ai/project/:id` | 2 | 200 | text/html |

Outros hosts (estáticos/terceiros, só contagem): vizard.ai (63), mcs.tobsnssdk.com (49), o4507225680576512.ingest.us.sentry.io (24), api-iam.intercom.io (17), js.intercomcdn.com (15), www.googletagmanager.com (14), challenges.cloudflare.com (11), cdn-docs.vizard.ai (11), lf3-data.volccdn.com (5), cdn.jsdelivr.net (5), lf1-cdn-tos.bytegoofy.com (5), accounts.google.com (5)

### vizard-04-enquadramento.har (199 entradas)

| Método | Host + path | Qtde | Status | Tipo |
|---|---|---|---|---|
| PUT | `bp-vizard-docs-prod.s3.us-west-1.amazonaws.com/date-data/:id/:id.json` | 4 | 200 | x-unknown |
| GET | `cdn-docs.vizard.ai/date-data/:id/:id.json` | 25 | 200 | application/octet-stream |
| GET | `cdn-docs.vizard.ai/vizard/censor-words/system/default-v1.json` | 1 | 200 | application/json |
| GET | `elb-api.vizard.ai/hvizard-server-front/api/v1/ai-clip-template/list-user-template` | 1 | 200 | application/json |
| POST | `elb-api.vizard.ai/hvizard-server-front/api/v1/ai-prompt/list` | 1 | 200 | application/json |
| GET | `elb-api.vizard.ai/hvizard-server-front/api/v1/background/list` | 1 | 200 | application/json |
| GET | `elb-api.vizard.ai/hvizard-server-front/api/v1/brand-kit/subtitles/list` | 1 | 200 | application/json |
| GET | `elb-api.vizard.ai/hvizard-server-front/api/v1/brand-kit/template/list` | 1 | 200 | application/json |
| GET | `elb-api.vizard.ai/hvizard-server-front/api/v1/censor-words/detail` | 1 | 200 | application/json |
| POST | `elb-api.vizard.ai/hvizard-server-front/api/v1/clip-video/clip-scheduled-publish-count` | 1 | 200 | application/json |
| GET | `elb-api.vizard.ai/hvizard-server-front/api/v1/clip-video/detail/:id` | 1 | 200 | application/json |
| POST | `elb-api.vizard.ai/hvizard-server-front/api/v1/clip-video/list-flow` | 2 | 200 | application/json |
| POST | `elb-api.vizard.ai/hvizard-server-front/api/v1/clip-video/update-clip-time` | 1 | 200 | application/json |
| POST | `elb-api.vizard.ai/hvizard-server-front/api/v1/clip-video/update-ratio-type` | 4 | 200 | application/json |
| POST | `elb-api.vizard.ai/hvizard-server-front/api/v1/clip-video/upload-user-style-json-by-css-id` | 2 | 200 | application/json |
| POST | `elb-api.vizard.ai/hvizard-server-front/api/v1/clip-video/upload-userjson-by-css-id` | 2 | 200 | application/json |
| PUT | `elb-api.vizard.ai/hvizard-server-front/api/v1/clip-video/upload-video-thumbnail` | 4 | 200 | application/json |
| GET | `elb-api.vizard.ai/hvizard-server-front/api/v1/config/config-info` | 2 | 200 | application/json |
| POST | `elb-api.vizard.ai/hvizard-server-front/api/v1/css-file/css-params` | 4 | 200 | application/json |
| POST | `elb-api.vizard.ai/hvizard-server-front/api/v1/css-file/verify` | 4 | 200 | application/json |
| GET | `elb-api.vizard.ai/hvizard-server-front/api/v1/font/list` | 2 | 200 | application/json |
| GET | `elb-api.vizard.ai/hvizard-server-front/api/v1/pop-up/list` | 5 | 200 | application/json |
| GET | `elb-api.vizard.ai/hvizard-server-front/api/v1/pop-up/project/list` | 1 | 200 | application/json |
| POST | `elb-api.vizard.ai/hvizard-server-front/api/v1/publish/list-wait-scheduled-by-source` | 1 | 200 | application/json |
| POST | `elb-api.vizard.ai/hvizard-server-front/api/v1/screenshot/sync` | 2 | 200 | application/json |
| GET | `elb-api.vizard.ai/hvizard-server-front/api/v1/subscription/get-pro-user-info` | 2 | 200 | application/json |
| GET | `elb-api.vizard.ai/hvizard-server-front/api/v1/subscription/get-subscription-info` | 2 | 200 | application/json |
| GET | `elb-api.vizard.ai/hvizard-server-front/api/v1/subscription/list` | 1 | 200 | application/json |
| GET | `elb-api.vizard.ai/hvizard-server-front/api/v1/user/ai-social/get-default-prompt` | 1 | 200 | application/json |
| POST | `elb-api.vizard.ai/hvizard-server-front/api/v1/user/login` | 2 | 200 | application/json |
| GET | `elb-api.vizard.ai/hvizard-server-front/api/v1/vizard-video/ai-clip-result` | 1 | 200 | application/json |
| GET | `elb-api.vizard.ai/hvizard-server-front/api/v1/vizard-video/detail/:id` | 1 | 200 | application/json |
| POST | `elb-api.vizard.ai/hvizard-server-front/api/v1/vizard-video/list` | 1 | 200 | application/json |
| GET | `vizard.ai/editor` | 1 | 200 | text/html |
| GET | `vizard.ai/project/:id` | 1 | 200 | text/html |

Outros hosts (estáticos/terceiros, só contagem): vizard.ai (24), mcs.tobsnssdk.com (22), o4507225680576512.ingest.us.sentry.io (9), api-iam.intercom.io (7), js.intercomcdn.com (6), cdn-docs.vizard.ai (4), www.googletagmanager.com (4), challenges.cloudflare.com (3), lf3-data.volccdn.com (2), cdn.jsdelivr.net (2), lf1-cdn-tos.bytegoofy.com (2), accounts.google.com (2)

### vizard-05-legenda.har (326 entradas)

| Método | Host + path | Qtde | Status | Tipo |
|---|---|---|---|---|
| PUT | `bp-vizard-docs-prod.s3.us-west-1.amazonaws.com/date-data/:id/:id.json` | 10 | 200,-1 | x-unknown |
| GET | `cdn-docs.vizard.ai/date-data/:id/:id.json` | 10 | 200 | application/octet-stream |
| GET | `cdn-docs.vizard.ai/fonts/page/MazzardH-Regular.otf` | 1 | 200 | binary/octet-stream |
| GET | `cdn-docs.vizard.ai/fonts/page/MazzardH-SemiBold.otf` | 1 | 200 | binary/octet-stream |
| GET | `cdn-docs.vizard.ai/vizard/censor-words/system/default-v1.json` | 3 | 200 | application/json |
| GET | `elb-api.vizard.ai/hvizard-server-front/api/v1/brand-kit/subtitles/list` | 1 | 200 | application/json |
| GET | `elb-api.vizard.ai/hvizard-server-front/api/v1/censor-words/detail` | 3 | 200 | application/json |
| GET | `elb-api.vizard.ai/hvizard-server-front/api/v1/clip-video/detail/:id` | 3 | 200 | application/json |
| POST | `elb-api.vizard.ai/hvizard-server-front/api/v1/clip-video/update-clip-time` | 2 | 200 | application/json |
| POST | `elb-api.vizard.ai/hvizard-server-front/api/v1/clip-video/update-ratio-type` | 5 | 200 | application/json |
| POST | `elb-api.vizard.ai/hvizard-server-front/api/v1/clip-video/upload-user-style-json-by-css-id` | 4 | 200 | application/json |
| POST | `elb-api.vizard.ai/hvizard-server-front/api/v1/clip-video/upload-userjson-by-css-id` | 4 | 200 | application/json |
| PUT | `elb-api.vizard.ai/hvizard-server-front/api/v1/clip-video/upload-video-thumbnail` | 8 | 200 | application/json |
| GET | `elb-api.vizard.ai/hvizard-server-front/api/v1/config/config-info` | 3 | 200 | application/json |
| POST | `elb-api.vizard.ai/hvizard-server-front/api/v1/css-file/css-params` | 10 | 200 | application/json |
| POST | `elb-api.vizard.ai/hvizard-server-front/api/v1/css-file/verify` | 8 | 200 | application/json |
| GET | `elb-api.vizard.ai/hvizard-server-front/api/v1/font/list` | 4 | 200 | application/json |
| GET | `elb-api.vizard.ai/hvizard-server-front/api/v1/pop-up/list` | 9 | 200 | application/json |
| GET | `elb-api.vizard.ai/hvizard-server-front/api/v1/subscription/get-pro-user-info` | 3 | 200 | application/json |
| GET | `elb-api.vizard.ai/hvizard-server-front/api/v1/subscription/get-subscription-info` | 3 | 200 | application/json |
| GET | `elb-api.vizard.ai/hvizard-server-front/api/v1/subscription/list` | 3 | 200 | application/json |
| POST | `elb-api.vizard.ai/hvizard-server-front/api/v1/user/login` | 3 | 200 | application/json |
| GET | `elb-api.vizard.ai/hvizard-server-front/api/v1/vizard-video/ai-clip-result` | 3 | 200 | application/json |
| GET | `vizard.ai/editor` | 3 | 200 | text/html |

Outros hosts (estáticos/terceiros, só contagem): vizard.ai (47), mcs.tobsnssdk.com (29), o4507225680576512.ingest.us.sentry.io (14), cdn.jsdelivr.net (11), cdn-docs.vizard.ai (9), js.intercomcdn.com (9), challenges.cloudflare.com (8), api-iam.intercom.io (8), www.googletagmanager.com (6), lf3-data.volccdn.com (3), lf1-cdn-tos.bytegoofy.com (3), accounts.google.com (3)

### vizard-06-exportar.har (206 entradas)

| Método | Host + path | Qtde | Status | Tipo |
|---|---|---|---|---|
| PUT | `bp-vizard-docs-prod.s3.us-west-1.amazonaws.com/date-data/:id/:id.json` | 3 | 200 | x-unknown |
| GET | `cdn-docs.vizard.ai/date-data/:id/:id.json` | 20 | 200 | application/octet-stream |
| POST | `elb-api.vizard.ai/hvizard-server-front/api/v1/ai-prompt/list` | 1 | 200 | application/json |
| POST | `elb-api.vizard.ai/hvizard-server-front/api/v1/clip-video/clip-scheduled-publish-count` | 1 | 200 | application/json |
| POST | `elb-api.vizard.ai/hvizard-server-front/api/v1/clip-video/list-flow` | 2 | 200 | application/json |
| POST | `elb-api.vizard.ai/hvizard-server-front/api/v1/clip-video/upload-user-style-json-by-css-id` | 1 | 200 | application/json |
| POST | `elb-api.vizard.ai/hvizard-server-front/api/v1/clip-video/upload-userjson-by-css-id` | 1 | 200 | application/json |
| GET | `elb-api.vizard.ai/hvizard-server-front/api/v1/config/config-info` | 2 | 200 | application/json |
| POST | `elb-api.vizard.ai/hvizard-server-front/api/v1/css-file/css-params` | 3 | 200 | application/json |
| POST | `elb-api.vizard.ai/hvizard-server-front/api/v1/css-file/verify` | 3 | 200 | application/json |
| POST | `elb-api.vizard.ai/hvizard-server-front/api/v1/final-video/batch-query` | 15 | 200 | application/json |
| POST | `elb-api.vizard.ai/hvizard-server-front/api/v1/final-video/export` | 1 | 200 | application/json |
| GET | `elb-api.vizard.ai/hvizard-server-front/api/v1/font/list` | 1 | 200 | application/json |
| GET | `elb-api.vizard.ai/hvizard-server-front/api/v1/pop-up/list` | 2 | 200 | application/json |
| GET | `elb-api.vizard.ai/hvizard-server-front/api/v1/pop-up/project/list` | 1 | 200 | application/json |
| POST | `elb-api.vizard.ai/hvizard-server-front/api/v1/publish/list-wait-scheduled-by-source` | 1 | 200 | application/json |
| GET | `elb-api.vizard.ai/hvizard-server-front/api/v1/subscription/get-pro-user-info` | 2 | 200 | application/json |
| GET | `elb-api.vizard.ai/hvizard-server-front/api/v1/subscription/get-subscription-info` | 2 | 200 | application/json |
| GET | `elb-api.vizard.ai/hvizard-server-front/api/v1/user/ai-social/get-default-prompt` | 1 | 200 | application/json |
| POST | `elb-api.vizard.ai/hvizard-server-front/api/v1/user/login` | 2 | 200 | application/json |
| GET | `elb-api.vizard.ai/hvizard-server-front/api/v1/vizard-video/demo-detail` | 1 | 200 | application/json |
| GET | `elb-api.vizard.ai/hvizard-server-front/api/v1/vizard-video/detail/:id` | 1 | 200 | application/json |
| POST | `elb-api.vizard.ai/hvizard-server-front/api/v1/vizard-video/list` | 2 | 200 | application/json |
| GET | `elb-api.vizard.ai/hvizard-server-front/api/v1/workspace/list` | 1 | 200 | application/json |
| GET | `vizard.ai/project/:id` | 1 | 200 | text/html |
| GET | `vizard.ai/workspace` | 1 | 200 | text/html |

Outros hosts (estáticos/terceiros, só contagem): vizard.ai (72), mcs.tobsnssdk.com (26), js.intercomcdn.com (6), api-iam.intercom.io (6), o4507225680576512.ingest.us.sentry.io (4), www.googletagmanager.com (4), lf3-data.volccdn.com (2), lf1-cdn-tos.bytegoofy.com (2), challenges.cloudflare.com (2), widget.intercom.io (2), api-client.sleekplan.com (2), cdn.jsdelivr.net (1)

## Arquivos

- HARs: `hars/vizard-01-importar.har` … `hars/vizard-06-exportar.har`.
- Screenshots: `shots/vizard-01*.png` … `shots/vizard-06*.png`.
- Passos Playwright: `steps/vizard/*.mjs`.
- Scripts de análise: `scripts/endpoints-vizard.mjs` (tabela de endpoints), `scripts/shapes-vizard.mjs`, `scripts/amostra-vizard.mjs` e `scripts/amostra2-vizard.mjs` (só estrutura de JSON e campos de conteúdo do vídeo).
- Downloads: `downloads/vizard/*.mp4`.
