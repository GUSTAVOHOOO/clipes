# Vizard e vidIQ: evidência de runtime (REA sobre HARs) e consolidação com o Opus Clip

Data: 2026-11-12. Ticket #10. Complementa `2026-11-12-opusclip-runtime-evidence.md` (modelo de formato) e os relatórios de captura `2026-11-12-vizard-runtime-evidence.md` e `2026-11-12-vidiq-runtime-evidence.md`. Tudo aqui vem do tráfego real gravado nos HARs, decodificado com REA 6.9.0 e lido com scripts Node em sala limpa.

## Resumo executivo

- **Vizard gera 20 candidatos e o Free mostra os 10 de maior `viral_score`.** O plano corta a lista, não muda a seleção. A nota vai de 0 a 10 com uma casa, vem comprimida (8,2–10) e não tem eixos: só `reason` em texto e 5 `keywords`.
- **vidIQ: a nota "geral" de palavra-chave é uma fórmula linear exata**, `overall = 0,6·volume + 0,4·(100 − concorrência)`, que bateu em 37 de 37 registros. A nota de título (88–98) não tem explicação.
- **O documento de edição do Vizard separa conteúdo e cena.** `userJson` guarda tokens de palavra, e apagar uma palavra só troca `type` 1→3 e guarda `oldType`. `userStyleJson` guarda o recorte da Fonte (`sx,sy,sw,sh`) e a posição no quadro (`x,y,w,h`), normalizados. O cliente grava os dois documentos inteiros no S3 a cada 30–60 s, sem diff.
- **O reenquadramento do Vizard faz uma detecção por cena** (caixas de falante e de rosto no início de cada cena), não rastreamento por frame. Leva cerca de 50 s por Corte.
- **O AI Coach do vidIQ é um LLM barato com ferramentas determinísticas.** Usa `deepseek-v4.1-flash` via OpenRouter, com raciocínio `low`, e chama `score_titles`, `keyword_analysis`, `related_keywords` e `check_upload_metadata`. O custo real é de US$ 0,004–0,011 por resposta, cobrado como 10 créditos.
- **Medidores de cobrança.** Opus e Vizard cobram por minuto de Fonte (no Vizard, 1 crédito = 1 min, e o Free cobra a Fonte inteira). O vidIQ cobra por ação (152 features `SingleUse` ou `TimeBased`), e a via MCP é mais barata que o app (título: 1 contra 5).
- **Para o Clipes:** preferências no submit, nota com eixos nomeados e fórmula exposta, documento local não destrutivo em dois arquivos, Provedor que gera mais ferramentas locais que pontuam, e estimativa de custo do Provedor antes de cada lote.

## Método e limites

- Capturas originais em `C:\Users\Windows 11\clipes-hars\hars\vizard-0*.har` (6 fluxos, 145–528 registros) e `vidiq-0*.har` (5 fluxos, 507–5352 registros). Contas Free. Nenhum crédito do Vizard foi gasto. No vidIQ foram gastos 72 de 150 créditos.
- **REA 6.9.0 exige Node `^22.23.4 || ^24.22.1 || >=26.12.1`.** A máquina tem Node 26.7.0, e o erro exato foi `REA requires Node.js 22.x (>=22.23.4), 24.x (>=24.22.1), 26.12.1+; this process runs Node.js 26.7.0`. Usei um Node 24.22.3 portátil fora do repo. Sem a versão explícita, `npx rea-agents` resolveu um 6.7.0 em cache.
- HAR do Playwright: mesma correção do estudo do Opus (`entry.time` e `timings.*` negativos), com cópias em `rea-ev\clean`. Para análise, gerei subconjuntos em `rea-ev\focus` só com hosts do produto (`*.vizard.ai` e o bucket S3 de documentos; `*.vidiq.com`) e respostas JSON, SSE ou documento, sem estáticos. Headers de autenticação, cookies, credenciais STS, e-mails e parâmetros assinados foram redigidos antes de passar pelo REA.
- `inspect-web-network-capture` (com `--detail summary --evidence_output`) e depois `inspect-analysis-view` com a visão `api-surface` (`limit 200`, `include_query_parameter_names`). Os subconjuntos têm 9–307 registros, e o REA cobriu 100% de cada um (`exhausted: true`).
- O REA não agrupa documentos com nome por hash (`date-data/{numeric}/<hash>.json`): cada documento vira um grupo. A contagem por tipo de documento abaixo é minha, feita pelas chaves de topo.
- Evidência histórica: sem atribuição de runtime nem autenticidade de deploy. Campo ausente é ausência observada, não inexistência. Corpos de PUT para o S3 não ficam no HAR, mas o mesmo objeto é relido via CDN logo depois e foi lido dali. O corpo do SSE do AI Coach também não fica no HAR; a mensagem persistida foi lida em `/messages?working_trace=true`.

Evidência pai (captura REA por fluxo, digest truncado):
`vizard-01 ev_b4566bba…`, `vizard-02 ev_22face3c…`, `vizard-03 ev_3bea226f…`, `vizard-04 ev_c9465938…`, `vizard-05 ev_63daeeb6…`, `vizard-06 ev_9c7b12ab…`;
`vidiq-01 ev_911d5de6…`, `vidiq-02 ev_80831310…`, `vidiq-03 ev_1d8318fd…`, `vidiq-04 ev_96420c0b…`, `vidiq-05 ev_f9367f7d…`.

---

# Parte A: Vizard

## A1. Submissão e criação de job

O job não chegou a ser criado: o fluxo 01 parou antes do envio, por falta de créditos. O que existe é a pré-checagem e o rastro do job de um projeto já processado.

**Pré-checagem** (`POST vizard-video/download-video-info`, evidência `vizard-01`):

```json
REQ  { "videoUrl": "https://www.youtube.com/watch?v=:id", "videoSource": 3 }
RESP { "language": "pt", "duration": 2540, "isCached": 1, "isCacheInfo": 1,
       "videoWidth": 1920, "videoHeight": 1080,
       "formats": [{ "ext": "mp4", "width": 256, "height": 144 }, …, { "width": 1920, "height": 1080 }],
       "subtitles": null, "thumbnailUrl": "…", "videoName": "…" }
```

- O idioma e a duração saem **antes** de cobrar. A UI calcula o custo como `ceil(duration/60)` créditos: 2540 s viram 42 créditos.
- `isCached: 1` indica cache de download por vídeo do YouTube no servidor.

**O que o job fixa:** o JSON de resultado da IA (`clipJsonRemotePath`, evidência `vizard-02`) guarda os parâmetros com que o job rodou:

```json
{ "user_prompt": "", "version": "20251024", "use_spark": false, "platform": 1,
  "uc": 6.0232, "p": 1, "pref_len": [0], "video_length_ms": 1249233,
  "lang": "pt", "clip_count": 20, "timestamp": "2026-11-11 21:35:50" }
```

- Prompt (`user_prompt`), duração preferida (`pref_len`, `[0]` = automática), idioma e versão do pipeline (`version`, uma data) viajam juntos e ficam congelados no resultado. Os mesmos parâmetros que o Opus põe no POST de submissão aparecem aqui no artefato de saída.
- `use_spark` parece ser o "Model v2" (premium) `[inferred]`.
- `vizard-video/detail` expõe uma **máquina de estados por etapa**: `videoState`, `convertState`, `asrState`, `asrJsonState`, `langDetectState`, `recoState`, `clipState`, `projectState` e `aiFacialState`, com valores 10/20 (ou 1/2) para "em curso" e "pronto". Também traz `aiClipParamUrl`, um documento separado com os parâmetros do job, que o cliente não buscou.
- `ai-prompt/list` devolve `aiPromptList: []` e `user/ai-social/get-default-prompt` devolve `defaultPrompt: null`. O backend tem prompts salvos por usuário, mas o Free não os expõe.

## A2. Seleção e nota

Cada um dos 20 candidatos no JSON da IA:

```json
{ "headline": "…?", "reason": "Aborda um ponto crucial para os fãs: …",
  "keywords": ["…", "…", "…", "…", "…"], "viral_score": 10, "length": 43,
  "start_time": 502786, "end_time": 546362,
  "clip_segments": [{ "start_time": "502786", "end_time": "546362" }],
  "extend": false, "reClip": false, "engine": 28, "driven_by": "Speech",
  "b-rolls": [], "content": "", "clipIds": [{ "clipId": ":id", "ratioType": 1 }],
  "words": [ … ] }
```

- **20 contra 10:** os 10 exibidos (`clip-video/list-flow`, `pageSize: -1`) são exatamente os 10 primeiros por `viral_score` (10, 10, 10, 9,8, 9,5, 9,5, 9,4, 9,3, 9,2, 9,2). Os 10 ocultos vão de 9,1 a 8,2. O plano trunca a lista ordenada, e o pipeline é o mesmo.
- **Nota comprimida:** os 20 ficam entre 8,2 e 10, com uma casa decimal e três empatados em 10. Não há eixos nem nota bruta. A justificativa é **um** texto (`reason`) mais 5 `keywords`. O Opus, em comparação, guarda 5 eixos com comentário e uma nota curvada.
- **Sem deduplicação:** dois candidatos tratam do mesmo assunto em trechos vizinhos ("versão física sem disco", em 349 s e em 327 s). Um aparece entre os 10; o outro ficou no 11º lugar.
- `clip_segments[]` aceita **vários segmentos por Corte** (montagem não contígua). Aqui todos tinham um só.
- `driven_by: "Speech"` indica que a seleção é guiada pela fala. `engine: 28` é a versão do motor.
- `clipParams` (string JSON em `list-flow`) repete `reason`, `keywords`, `viral_score`, `start_time`/`end_time`, `engine` e `driven_by`, e acrescenta `viral_tags`, `dimensions` (vazios) e `aiClipVersion`. Os campos `dimensions` e `viral_tags` existem e estão vazios: há espaço reservado para eixos que não são preenchidos `[inferred]`.
- Por Corte, a lista ainda traz `score` (= `viral_score`), `ratioType` (1 = 9:16; o mapa `ratio` conta Cortes por proporção 0–4), `timeline` (início na Fonte, em ms), `clipType`, `isLiked`, `isCollected` e `latestFinalVideo`.

## A3. Modelo de edição: dois documentos

O Vizard guarda a edição como **dois documentos JSON por Corte**, versionados por objeto no S3 e associados ao Corte por ponteiro.

### `userJson`: conteúdo (Transcrição editável e legenda)

```json
{ "translateInfo": { "lang": "", "translateState": "noTranslate", "dstJson": [] },
  "options": { "isDisplayEmoji": true, "isUpdate": false },
  "userJson": [{ "sceneId": "…", "paragraph": [{ "id": "…", "text": [ token, … ] }] }],
  "version": 2 }
```

Token: `{ id, sId, text, displayText, bt, et, type, oldType, colorType, emojiElement:{elementType, emojiCode}, isUnSetRuleColor, isAmplify }`.

| `type` | Significado observado | Exemplo |
|---|---|---|
| 1 | palavra | `"Rockstar "` com `bt/et` em ms na Fonte |
| 3 | trecho excluído do render: pausa original (`oldType: 8`, `displayText: " [0.1s] "`) **ou palavra apagada pelo usuário (`oldType: 1`)** | apagar "A Rockstar promete Em seus" transformou 5 tokens 1 → 3 com `oldType: 1` |
| 6 | marcador de fronteira de cena, com duração zero (`bt == et`) | 11 marcadores para 11 cenas, inseridos na primeira edição |

- **Edição não destrutiva:** apagar não remove o token; troca o `type` e guarda o original em `oldType`. Recuperar ("R" na UI) é desfazer essa troca.
- `colorType` 1/2/3 aponta para `highlightColor1/2/3` do estilo. Num Corte de 156 tokens, 57 palavras estavam destacadas. `isUnSetRuleColor: true` marca o destaque vindo da IA, e não de uma regra do usuário `[inferred]`.
- O emoji é **ancorado à palavra** (`emojiElement.emojiCode` em hexadecimal Unicode, ex.: `1F3AE`). O JSON da IA já traz o emoji por palavra (`words[].emoji`), além de `h: 1` (destaque) e `upper: 1` (caixa alta).
- `sId` agrupa tokens numa linha de legenda. Quebrar uma linha na UI divide o grupo e reparte o tempo (relatório de captura, fluxo 05). Aplicar um preset re-segmenta os `sId` e desfaz quebras manuais. Esse é o defeito que o relatório de captura descreveu.
- `translateInfo.dstJson` reserva a legenda traduzida dentro do mesmo documento, e o estilo dela é separado (`editorDstCaptionStyle`).

### `userStyleJson`: cena, enquadramento e estilo

```json
{ "sceneInfo": { "width": 1092, "height": 852, "widthScale": 9, "heightScale": 16,
    "headline": [{ "element": [{ "duration": 3000, "editorHeadlineStyle": { "fontPackageName": "The Bold Font", … },
                                 "editorHeadlineInfo": { "x": 0.125, "y": 0.13, "w": 0.75, "headlineText": "…" } }] }],
    "isAddAIEmoji": true, "isAddAIKeywords": true, "isAiFacialVideo": false, "isUseAiHighlight": false,
    "subtitleShow": { "src": true, "dst": false }, "markTextArray": [], "videos": [],
    "scene": [ cena, … ] },
  "version": 2 }
```

Cada cena: `bt/et`, `cutBt` (início na Fonte), `duration`, `info.type` (6 observado), `template.id`, `volume`, `beginTransition`/`endTransition`, `fadeInDuration`/`fadeOutDuration`, `speaker_list`, `speaker_track_list`, `hiddenSpeakerList`, `element.bg` (`backgroundType` 3 = cor, ou imagem), `element.logo[]`, `element.video[]` e `subtitle.editorCaptionStyle`.

`element.video[]` é o modelo de enquadramento, **todo normalizado de 0 a 1**:

| campo | papel | default (Fit) | depois de AI reframe + layout |
|---|---|---|---|
| `sx, sy, sw, sh` | retângulo de recorte **na Fonte** | `0, 0, 0,997, 0,989` | `0,55, 0,161, 0,225, 0,356` (o falante) |
| `x, y, w, h` | posição/tamanho **no quadro de saída** (`x,y` = centro) | `0,5, 0,843, 1, 0,314` (faixa no meio, fundo preto) | `0,5, 0,75, 1, 0,5` (metade inferior) |
| `type`, `shapesType` | tipo do elemento e forma | `2`, `6` | `6` = preencher por deslocamento (`x = −1,08, w = 3,16`) |
| `speakerType` | papel no layout (0 tela/fonte, 1 falante) | `0` | `1` |
| `isFaceTracking`, `cornerRadiusRate`, `cls`, `model`, `template.*` | rastreio, cantos, classe e geometria do template | `false`, `0`, `0`, `1` | |

- O default do Corte é **Fit**: a Fonte 16:9 inteira numa faixa central sobre fundo preto, sem rastreio.
- O layout dividido é **mais de um `element.video` por cena**, cada um com o próprio recorte da Fonte e a própria posição no quadro. Não existe layout como enum: o layout é a lista de retângulos.

### `ai-facial`: reenquadramento

`POST clip-video/ai-facial` com `{ clipId, timeArray: "[{bt,et,seq}]", aiFacialTargetType: 2 }`, seguido de polling a cada ~3–4 s em `batch/ai-facial-result` (`aiFacialState` 1 → 2). Levou **~49 s** para um Corte de ~50 s. O resultado (`aiFacialJsonUrl`) é:

```json
{ "facialVersion": 1, "aiFacialTargetType": 2, "status": 1,
  "result": [{ "id": "1", "scene_list": [
    { "begin_time": 1119450, "img_id": 22389, "speaker_type": [1],
      "speaker_list": [[0.55, 0.1611, 0.775, 0.5167]], "face_list": [[0.6344, 0.2611, 0.6906, 0.3944]], "screen_list": [] },
    { "begin_time": 1121850, "speaker_list": [], "face_list": [], … }, … ] }] }
```

- É **uma amostra por cena** (`begin_time` + `img_id`, que parece ser o número do frame a ~20 fps), com caixas `[x1, y1, x2, y2]` normalizadas de **falante** (busto) e de **rosto**, mais `screen_list` para tela. Cenas sem pessoa ficam com listas vazias, e o cliente as preenche por deslocamento (`type: 6`).
- O cliente converte a caixa do falante em `sx/sy/sw/sh`. Ex.: `speaker_list [0.55,0.161,0.775,0.517]` vira `sx 0.55, sy 0.161, sw 0.225, sh 0.356`, o mesmo retângulo.
- Uma cena com três pessoas devolve três caixas: a escolha de quem enquadrar é do cliente ou do template `[inferred]`.
- `update-facial-operate-num {operateNum: 1000000}` registra o uso. O projeto carrega `operateNum: 500000`, que parece um contador de cota de reframe `[inferred]`.

### Persistência e render

- **Ciclo de salvamento:** `css-file/css-params {fileBusinessType: 8, ext: "json"}` devolve bucket, `objectKey` e credenciais STS temporárias. O cliente faz `PUT` do JSON no S3, chama `css-file/verify` (que devolve `cssFileId` e o tamanho) e depois `upload-userjson-by-css-id` / `upload-user-style-json-by-css-id {clipId, …CssId}`. O servidor só recebe o ponteiro. Cada salvamento cria um objeto novo, de modo que o histórico fica implícito nos objetos.
- O autosave dispara a cada **30–120 s** (intervalos medidos: 117, 65, 61, 60, 4 s no fluxo 03; 30, 90, 32 s no fluxo 05).
- **A proporção é gravada pelo cliente a cada abertura do editor:** `update-ratio-type {ratioType}` sai em toda carga. No fluxo 04 foi enviado `ratioType: 2` (1:1), e no fluxo 05 a abertura do editor reenviou `ratioType: 1`. Isso explica a proporção "não persistida" do relatório de captura: o último a escrever ganha, e quem escreve é o cliente `[inferred]`.
- `update-clip-time {clipTime: 0}` sai junto e não carrega o novo início/fim. O Trim/Extend fica nos documentos e no `timeArray` do `ai-facial` `[inferred]`.
- **Export:** `final-video/export {exportRequestCssId, exportWidth: 9, exportHeight: 16, exportType: 8, exportQuality: 2, superResolution: false, finalVideoName}` (largura/altura = proporção), com polling a cada ~3 s em `final-video/batch-query` (`exportState` 12 → 20). Levou **~34 s** para ~49 s de Corte. O render consome um documento de pedido (`exportRequestCssId`), uma cópia congelada do estado `[inferred]`.
- `screenshot/sync` (multipart `videoId`, `screenshotTime`) gera a miniatura de um instante no servidor, e `upload-video-thumbnail` envia a capa.

## A4. Transcrição exposta ao cliente

**Cache de ASR** (`captionSrcJsonRemotePath`, `<user>-cache-<hash>.json`, 396 KB):

```json
{ "version": 3, "asrProvider": 1, "vizardVideoId": ":id",
  "results": [ [ { "seq": 1, "bt": "00:00:00,000", "et": "00:00:04,280", "s": "os gift cards …", "speaker": "SPEAKER_01",
                   "words": [{ "text": "os", "beginTime": 0, "endTime": 80, "bt": "00:00:00,000", "et": "00:00:00,080", "speaker": "SPEAKER_01" }, …] } ] ] }
```

- `results` tem **20 listas, uma por candidato**, e não uma Transcrição da Fonte inteira: 274 frases e 3115 palavras no total. O cliente recebe a Transcrição já recortada por Corte. A Transcrição completa da Fonte só aparece no diálogo Trim/Extend.
- Por palavra: `text`, `beginTime`/`endTime` (ms), os mesmos tempos em SRT (`bt/et`) e `speaker` (`SPEAKER_00`/`SPEAKER_01`). Há diarização.
- **Sem confiança por palavra** (o Opus expõe `score`). **Sem pausa no ASR:** nenhum intervalo maior que 300 ms entre palavras dentro das frases. A pausa só aparece no `userJson` como token `type: 3` / `oldType: 8` (`[0.1s]`).
- `asrProvider: 1` indica que o Motor de transcrição é configurável no servidor. O valor não revela o fornecedor.
- **Waveform:** `vizard/waveforms/<id>.json` é um array de 399.770 amplitudes normalizadas (0,1–1) para 1249 s, ou seja, **320 amostras/s** da Fonte inteira, pré-computadas no servidor.
- Censura: `censor-words/system/default-v1.json` traz 41 palavras (`{id, word, canEdit}`), com override por usuário via `censor-words/detail` (`source: "system"`, `canEdit: false` no Free).

## A5. Superfície de estilo

- **Presets de legenda não vêm da API.** `brand-kit/subtitles/list` (do usuário) veio vazio e `font/list` (fontes do usuário) também, então os presets ("BOXING" e os demais) estão embutidos no bundle do cliente. O que viaja é o estilo resolvido em `editorCaptionStyle`: `captionType` (ex.: `beastEffect`), `fontPackageName` (Tilt Warp, Bebas Neue, The Bold Font, Inter Bold), `fontId`, `fontSize`, `rows`, `color`, `highlightColor1/2/3`, `activeColors[]`, `isUppercase`, `punctuation`, `isOpenStroke`, `isOpenShadow` (`shadowBlurRadius`, `textShadowWidth`), `isOpenBackground` (`backgroundColor`, `backgroundMode`, `backgroundRadius`), `lineSpacing`, `textAlign` e caixa `x, y, w`.
- **Manchete** (`headline`) é um elemento próprio, com estilo e caixa, durante os primeiros 3000 ms.
- **Templates de layout** (`ai-clip-template/list-user-template`): 15 entradas, cada uma com `templateJsonUrl`, `width:height`, `elementConfig` e prévia. 9:16: Modern, Bouncy, Mr. Beast, Business, Blur, Fit video, Tech. 1:1: Simple, Pop, Clean, Abstract, Tech. 16:9: Highlight, Mr. Beast, Clean.
- `background/list` e `brand-kit/template/list` vieram vazios no Free.

## A6. Quotas e medidor de cobrança

- `subscription/get-pro-user-info` mede **segundos de Fonte**: `totalDuration: 3600`, `usedDuration: 1200`, `leftDuration: 2400` (os 40 "créditos" da UI = 40 min).
- Privilégios do plano em um só objeto: `maxVideoDuration 3600`, `videoMaxLength 1 GB`, `exportMaxDuration 600`, `exportQuality 1080` (a UI limita a 720p), `removeWatermark 0`, `subtitleTranslation 0`, `enableDownloadCaption 0`, `brandKit 0`, `webhook 0`, `socialSchedulePost 0`, **`openApi 1`**, `rpm 1`, `rph 10`. A API pública está habilitada até no Free, com limite de 1 requisição/min e 10/h.
- `aiClipCnt`, `exportCnt` e `aiSocialCnt` valem `-1` (ilimitado). O limite real é a duração.
- `subscription/list`: planos por **minutos/mês** ("creator 800min", "creator 1200min", "team 6000min") convivem com planos por assento ("Business seat"). A cobrança migrou ou está migrando de minutos para assentos `[inferred]`.
- O projeto expira (`expiredTime`; "Expires in 3 days") e `config-info.storageLimitExceededProjectExpiredDays: 28`.
- O export 720p com marca d'água não consome duração.

## A7. Agente e LLM

- Não houve agente nem chat. A geração de texto (`headline`, `reason`, `keywords` e emojis por palavra) sai do mesmo job da seleção e chega pronta no JSON da IA.
- O backend tem `user/ai-social/get-default-prompt` (legenda de post para redes) e `ai-prompt/list`, ambos vazios na conta.
- Não há evidência do modelo usado.

## A8. Superfície de API (REA `api-surface`, agrupada)

Base `elb-api.vizard.ai/hvizard-server-front/api/v1/`. 75 grupos no fluxo mais rico (`vizard-03`), todos 200.

- **Ingestão e projeto:** `vizard-video/download-video-info`, `vizard-video/list`, `vizard-video/detail/:id`, `vizard-video/recent-project/:id`, `vizard-video/demo-detail`, `vizard-video/ai-clip-result`, `vizard-video/get-waveform/:id`, `workspace/list`.
- **Seleção:** `clip-video/list-flow`, `clip-video/detail/:id`, `ai-prompt/list`.
- **Edição:** `clip-video/update-clip-time`, `clip-video/update-ratio-type`, `clip-video/upload-userjson-by-css-id`, `clip-video/upload-user-style-json-by-css-id`, `clip-video/upload-video-thumbnail` (PUT), `screenshot/sync`.
- **Armazenamento de documentos:** `css-file/css-params`, `css-file/verify`, `PUT bp-vizard-docs-prod.s3.us-west-1.amazonaws.com/date-data/…`, `GET cdn-docs.vizard.ai/date-data/…` (resultado da IA, cache de ASR, `userJson`, `userStyleJson` e resultado de reframe).
- **Reenquadramento:** `clip-video/ai-facial`, `clip-video/batch/ai-facial-result`, `clip-video/update-facial-operate-num`.
- **Render:** `final-video/export`, `final-video/batch-query`.
- **Estilo:** `font/list`, `brand-kit/subtitles/list`, `brand-kit/template/list`, `ai-clip-template/list-user-template`, `background/list`, `censor-words/detail`, `cdn-docs…/censor-words/system/default-v1.json`.
- **Publicação:** `publish/list-wait-scheduled-by-source`, `clip-video/clip-scheduled-publish-count`, `user/ai-social/get-default-prompt`.
- **Negócio:** `subscription/get-pro-user-info`, `subscription/get-subscription-info`, `subscription/list`, `config/config-info`, `user/login` (chamado a cada carga de página).
- **Engajamento:** `pop-up/list`, `pop-up/project/list`, `pop-up/record`.

Fora do produto: o editor usa um SDK de vídeo em WASM (Meishe), que recusa navegador automatizado. Dois PUTs no S3 do fluxo 05 terminaram com status `-1` (abortados), e o autosave seguinte cobriu o estado.

## A9. O que copiar e o que superar

Copiar (arquitetura, não código):

1. **Conteúdo e cena em documentos separados** (`userJson` × `userStyleJson`): a legenda muda sem mexer no enquadramento, e vice-versa.
2. **Edição não destrutiva por troca de tipo** (`type` 1 → 3 com `oldType`): apagar e recuperar são a mesma operação.
3. **Enquadramento como lista de retângulos** (recorte na Fonte + posição no quadro, normalizados): layout dividido, PiP e tela + falante saem do mesmo modelo, sem enum.
4. **Detecção por cena com caixas de falante e de rosto** em vez de rastreio por frame: barato e suficiente para Fonte com câmera fixa.
5. **Parâmetros do job congelados no resultado** (`user_prompt`, `pref_len`, `version`, `lang`): reprodutibilidade.
6. **Gerar N e ordenar por nota**, com o corte da lista feito depois (o pipeline não muda por plano).
7. **Waveform pré-computada** a 320 amostras/s para o editor de corte.
8. **Pré-checagem antes de gastar** (`download-video-info` com duração, idioma e formatos).
9. **Máquina de estados explícita por etapa** do pipeline (ASR, detecção de idioma, seleção, reframe, export).

Superar:

1. **Nota sem eixos**, comprimida em 8,2–10 e com empates no topo: não ajuda a decidir entre 20 candidatos.
2. **Candidatos duplicados** (mesmo assunto, trechos vizinhos) sem deduplicação.
3. **Transcrição sem confiança por palavra** e sem pausas no ASR; a pausa só aparece no documento de edição.
4. **Salvar o documento inteiro a cada 30–120 s**, sem diff e sem histórico navegável. O último a escrever ganha, e a proporção se perde.
5. **Preset que re-segmenta e desfaz edição manual.**
6. **Cobrança pela Fonte inteira no Free**, sem recorte de trecho.
7. **Editor dependente de SDK WASM proprietário**, que não roda em ambiente automatizado (ruim para produção em lote).
8. **Transcrição recortada por Corte no cliente:** não dá para buscar ou escolher fora dos candidatos sem abrir o Trim/Extend.

## A10. Desconhecidos

- Não se observou o POST que cria o job (fluxo 01 bloqueado). O conteúdo de `aiClipParamUrl` não foi buscado pelo cliente.
- O modelo e o prompt da seleção e da nota não aparecem no tráfego. Não se sabe o que significam `uc: 6.0232` e `p: 1`.
- O Motor de transcrição (`asrProvider: 1`) não foi identificado.
- A lista de presets de legenda está no bundle JS, que não foi lido (sala limpa).
- Não se observou a API pública (`openApi: 1`) nem webhook.

---

# Parte B: vidIQ

## B1. Submissão e criação de job

Não há job de vídeo nos fluxos gravados (o recorte existe, `clipping`, mas não foi usado). As "submissões" são chamadas síncronas de geração.

**Títulos** (`vidiq-01`): duas chamadas paralelas por geração.

```json
POST /generate/titles/youtube-search   (grupo "SEO")
POST /generate/titles/outliers         (grupo "outliers")
REQ  { "videoTopic": "<ideia em texto livre>", "videoFormat": "long" }
RESP { "recommendations": [{ "title": "…", "score": 94 }, … ×5], "quota": { "numberOfCreditLeft": 145, "daysBeforeReset": 30 } }

POST /generate/titles/custom-references
REQ  { "videoTopic": "…", "videoFormat": "long", "referenceTitles": ["<título escolhido>"] }
```

- A entrada tem só tema, formato e (opcionalmente) títulos de referência. **Não vai idioma**: o servidor decide. Com tema em inglês, o grupo SEO veio em português e o grupo outliers em inglês.
- Latência de 1,7–2,9 s. O grupo outliers é ~1 s mais lento, coerente com busca de vídeos de referência antes de gerar `[inferred]`.
- **Persistência como pacote:** cada ideia vira um `blueprint` (`POST /pyapi/feed/craft/blueprint`, depois `PATCH`). O modelo do blueprint é um **pacote de vídeo**: `topic`, `title`, `titles[]`, `selected_title`, `thumbnails[]`, `selected_thumbnail_id`, `description`, `tags_with_scores`, `target_keywords`, `scored_target_keywords`, `summary`, `outline`, `reference_video`, `format` e `additional_context` (os 20 títulos com `group: seo|outlier`, `score` e `liked`). `save_only: true` e `generation_mode: "regular"`.

**Miniatura** (`vidiq-05`):

```json
POST /thumbnail-editor/generate-unified
REQ  { "userQuery": "<descrição>", "hasLimitedVideoContext": false, "model": "gemini-3.1-flash-image", "carouselIndex": 0 }
RESP { "id": ":id", "url": "…", "model": "gemini-3.1-flash-image", "group_id": ":id", "seed": 11486,
       "is_image_safe": true, "layers": [{ "name": "background", "type": "imageLayer", "bounds": { "width": 1280, "height": 720 } }],
       "layered_image_uri": "…", "promptIQ": { "prompt_data": { "prompt": "<prompt expandido>" } } }
```

- Levou 19,6 s. O **prompt expandido** volta ao cliente: um template fixo com blocos STYLE REQUIREMENTS, COMPOSITION (um herói grande, espaço para texto), TEXT OVERLAY (2–5 palavras, complementar ao título, *curiosity gap*, não usar a instrução do usuário como texto), FACES (preservar a identidade de pessoa fornecida; não inventar rosto se houver um) e CRITICAL ("designed thumbnail, not a raw photo").
- A saída já vem **em camadas** (`layers`, `layered_image_uri`) para o editor (trocar rosto, texto, adesivo).
- **Achado novo (fluxo 02):** abrir um blueprint disparou duas gerações em segundo plano por outro pipeline: `POST /pyapi/thumbnails_async` com `{generate_prompt: true, query, prompt, minimum_fontsize: 80, source: "generate", image_generator: "flux", mode: "ig_inpaint", dynamic_template: false, faceswap: false}`, resposta `202 {task_id}` e polling a cada ~2 s (`status: "inprogress"`). O relatório de captura não registrou esse caminho. Existem pelo menos dois geradores de imagem (Gemini no editor; Flux com inpainting de template no fluxo assíncrono).

## B2. Modelo de nota

**Título:** inteiro de 0 a 100, sem eixos nem justificativa. No gerador do app, os 20 títulos ficaram entre 88 e 98. Pelo AI Coach (`score_titles`, com `is_short: true`), títulos parecidos receberam 82–87. São escalas e contextos diferentes, e o cliente não vê como a nota é calculada.

**Palavra-chave** (`xwords/*`, `vidiq-03`):

```json
{ "keyword": "gta 6", "volume": 100, "competition": 67, "overall": 73.2,
  "estimated_monthly_search": 24022778, "calibrated_total_searches_30d": 13661771,
  "monthly_volume_change": 75.84, "growth_percentage": 75.84, "ts": "…" }
```

- **`overall = 0,6 · volume + 0,4 · (100 − competition)`** confere em **37 de 37** registros (erro máximo 0,00) em todos os endpoints `xwords`. Exemplos: "gta 6", 0,6·100 + 0,4·33 = 73,2; "gta 6 news", 0,6·85,72 + 0,4·42 = 68,23. A nota "geral" que o usuário vê é uma combinação linear e explicável. `volume` e `competition` já vêm normalizados de 0 a 100.
- O volume tem duas estimativas: `estimated_monthly_search` (modelo) e `calibrated_total_searches_30d` (calibrada). `growth_percentage` = `monthly_volume_change`.
- Relacionadas (`hottersearch`) somam `related_score`, `query_shares` (fatia da busca original), `wc_bonus` (contagem de palavras) e `inc_bonus`, mais `search_stats` da SERP (visualizações, likes e comentários min/máx/média, `videos_found: 50`, `seven_days_count`, idade dos vídeos).
- `keyword_vph` traz uma série diária de 28 dias (`sumViewCount`). `keyword_trends` traz `search_result_languages` (distribuição de idioma dos resultados) e `period_percent_change`.
- **Outlier de vídeo** (`youtube/video-outliers`): `breakout_score` (= `breakout_avg_score` = `breakout_median_score` nos exemplos), `vph`, `vph_latest`, `vph_all_time`, `engagement_rate`, `avg_views`, `median_views`, `score` (outra nota, ~1,3), `trend_categories` (ex.: `how_to`) e `has_ai_label`. O filtro default é `channel_country=US,GB,CA,AU` e `channel_language=en`, mesmo para tema em português.
- **Regra no dado:** o raciocínio salvo do agente cita `do_not_recommend` (termo com volume 0) devolvido por `keyword_analysis`. A ferramenta marca termos proibidos e o LLM obedece.
- O truncamento do Free acontece no servidor: `limit=300` devolve 3 itens com `questions_omitted: 297`.

## B3. Modelo de edição e documento

- Não há documento de vídeo nos fluxos. O documento editável é o **blueprint** (pacote de título, miniatura, descrição, tags e roteiro), em B1.
- A miniatura é um documento em camadas (`layers[]` com `name`, `uri`, `bounds`, `rotate`, `type`, `index`). As edições por prompt (Comando / Comentar / Remover / Marcação) custam 22 créditos cada.

## B4. Transcrição exposta ao cliente

- Nenhuma Transcrição apareceu no tráfego dos fluxos testados.
- A tabela de custos tem `mcp-video-transcripts-v2` (1 crédito): Transcrição de vídeo do YouTube via MCP. A skill `clipping` está `false` no Free (`ai-coach/skills`).

## B5. Superfície de estilo

- Miniatura: 1280×720, estilo fixado pelo template do prompt expandido; `minimum_fontsize: 80` no pipeline Flux. Não há catálogo de fontes nem presets expostos.
- Títulos têm dois "estilos" de grupo (`seo` e `outlier`), mais o estilo por referência (`custom-references`).

## B6. Quotas e medidor de cobrança

`GET /quota/balance/global` (consultado 65 vezes nos 5 fluxos):

```json
{ "remainingQuota": { "credits": 78, "resets_at": "2026-12-12T…", "period_start": "2026-11-12T…", "type": "limited" },
  "originalQuota": { "credits": 150, "type": "LimitedQuota" },
  "openCreditWallets": [], "creditNotifications": [], "sharedCreditPool": null,
  "globalQuotaFeatures": [{ "id": 90, "name": "ai-video-analysis", "creditCost": { "cost": 3, "unit": { "@type": "SingleUse" } } }, … ×152] }
```

- **Dois tipos de medidor:** `SingleUse` (por ação) e `TimeBased` com `timeUnit: MINUTES` (por minuto). Por minuto: `clipping` 9, `shorts-generator` 20, `voiceover` 14, `voiceover-v2` 28, `script-generator` 1. Por ação: `generate-title-gen` 5, `AI Coach V3 - Regular mode` 10, `ai-coach-max` 35, `ai-coach-max-50` 50, `ai-coach-v2.1` 25, `thumbnail-maker-generations-v2` 22, `video-package-generation` 25, `Generate Canvas Deep` 49, `ai-hooks-generator` 3, `ai-video-analysis` 3, `optimize-description-generator` 1.
- **115 das 152 features são `mcp-*`**, e várias são mais baratas que o equivalente no app: `mcp-title-generator` 1 (app: 5), `mcp-score-title-v2` 1, `mcp-score-thumbnail-v2` 1, `mcp-generate-description` 5, `mcp-generate-tags` 5, `mcp-video-clipping-submit` 9/min, `mcp-video-clipping-poll` 0.
- **Margem observável:** uma mensagem do Coach custa 10 créditos e o custo reportado pelo provedor foi de US$ 0,011 e US$ 0,004.
- `openCreditWallets` e `sharedCreditPool` indicam carteiras avulsas e créditos de equipe `[inferred]`. `/quota/events` veio vazio.

## B7. Agente / LLM (AI Coach)

**Transporte:** `POST /api/question?stream=true&mode=regular&stream_thoughts=true&working_trace=true&…` (26 flags de recurso na query), respondido como `text/event-stream`. O corpo é `{text, conversation_id, active_plan_type: "free", enabled_skills: ["thumbnails","video_gen","voiceover","music_gen"]}`, e ao clicar numa sugestão vão também `suggestion_id` e `suggestion_set_id`. O primeiro byte chegou em 2,3–2,9 s.

**Mensagem persistida** (`GET /ai-coach/conversations/:id/messages?working_trace=true`):

```json
{ "role": "assistant", "mode": "regular",
  "answer_policy": { "model": "deepseek/deepseek-v4.1-flash-1017", "max_tokens": 16384, "api_provider": null,
    "openrouter": { "only": ["deepseek","together","deepinfra"], "allow_fallbacks": true, "require_parameters": true },
    "thinking": { "type": "enabled", "reasoning_effort": "low", "budget_tokens": 0 }, "version": 1 },
  "content_blocks": [ {"type":"thinking"}, {"type":"tool_calls"}, {"type":"thinking"}, {"type":"tool_calls"}, {"type":"thinking"}, {"type":"text","kind":"final"} ],
  "tool_calls": [{ "name": "score_titles", "input": { "titles": […], "is_short": true },
                   "status": "success", "category": "video", "display_message": "Title scores ready", "query": […] }, …],
  "metrics": { "turn_ms": 15090, "work_ms": 10070, "input_tokens": 66319, "output_tokens": 1743, "reasoning_tokens": 945,
               "cache_read_input_tokens": 131712, "tool_calls": 3, "tool_loops": 3, "discarded_llm_attempts": 0,
               "estimated_cost_usd": 0.011389, "cost_source": "provider_reported", "model_code": "d17", "routed_model_code": "d17" } }
```

- **Ferramentas observadas:** `score_titles {titles[], is_short}`, `keyword_analysis {keywords[], country: "BR"}`, `related_keywords {keyword, limit: 25, country}` e `check_upload_metadata {hashtags[] | tags[]}`. A última valida o limite de 500 caracteres das tags: o agente chamou duas vezes, ajustando a lista entre as chamadas.
- **O raciocínio segue regras de processo:** "This is a title suggestion request → must score titles with score_titles"; "must call check_upload_metadata before showing the final tag list". O prompt de sistema obriga a passar por ferramenta antes de responder (por isso ~66k tokens de entrada na 1ª mensagem).
- O cliente guarda só as **entradas** das ferramentas. As saídas não são persistidas para o cliente; só o texto final, que as cita (notas 87/87/86/82…, volumes por país).
- Segunda mensagem: 10,5k tokens de entrada, 280k lidos de cache, US$ 0,0039. O cache de prompt reduziu o custo da 2ª resposta em ~3×.
- **Sugestões de acompanhamento** vêm de outro modelo: `GET /ai-coach/suggested/responses` → `{responses[3], model: "gemini-3.1-flash-lite", prompt_version: "2026-10-28-v1", suggestion_set_id}`.
- Modos (`/ai-coach/modes`): `regular` (`3.0-regular-v1`), `deep_thinking`, `max`. Skills (`/ai-coach/skills`): `clipping: false`, `thumbnails`, `video_gen`, `voiceover` e `music_gen` ligados.
- Os "chips" de palavra-chave no texto final são preenchidos depois com `xwords/hottersearch?q=…&skip_recs=t`.

## B8. Superfície de API (REA `api-surface`, agrupada)

Hosts `api.vidiq.com`, `account.vidiq.com`, `app.vidiq.com`, `bridge.vidiq.com` e `vidiq.com`. De 27 a 42 grupos por fluxo.

- **Geração:** `generate/titles/{youtube-search,outliers,custom-references}`, `thumbnail-editor/generate-unified`, `pyapi/thumbnails_async` (+ `/:id`), `pyapi/script_generator/scripts`, `pyapi/video_gen/projects`, `pyapi/shorts_creation/shorts/credits`.
- **Pacote e biblioteca:** `pyapi/feed/craft/blueprint` (GET, POST, `PATCH /:id`), `user-library/bookmarks`, `thumbnail-editor/thumbnails` (+ `/:id`), `thumbnail-editor/v2/subject-images`, `pyapi/user_likeness` (204).
- **Pesquisa:** `xwords/{keyword_search,hottersearch,keyword_vph,keyword_trends,topics}`, `youtube/video-outliers`, `channels/search`, `yt/channels`, `pyapi/onboarding/topics`.
- **Agente:** `api/question` (SSE), `ai-coach/conversations` (+ `/:id`, `/:id/messages`, `/:id/video-deliveries`), `ai-coach/folders` (+ `items/memberships`), `ai-coach/modes`, `ai-coach/skills`, `ai-coach/suggested/responses`.
- **Negócio:** `quota/balance/global`, `quota/events`, `subscriptions/{active, plans/available/authed-smart, plans/available/smart, stripe/next-subscription, validate-coupon}`, `user/channels`, `auth/user`, `auth/multiplatform/accounts`, `oauth2/token`.
- **Experimentos e telemetria:** `experimentation/amplitude`, `experimentation/batch-by-keys`, `bridge.vidiq.com/data`, `cdn-cgi/rum`, mais 15–25 hosts de analytics e ads por fluxo.

`ai-coach/conversations/:id` deu 404 antes da primeira mensagem (conversa criada sob demanda), e `video-deliveries` deu 404 e depois 200.

## B9. O que copiar e o que superar

Copiar:

1. **LLM gera, ferramenta pontua:** a nota de título e os dados de busca vêm de ferramenta determinística, e o LLM só redige.
2. **Nota composta por fórmula linear simples** (0,6/0,4) sobre componentes normalizados: explicável, reproduzível e ajustável.
3. **`working_trace` por resposta** (raciocínio, chamadas de ferramenta, tokens, cache, custo em US$, modelo roteado): auditoria e controle de custo.
4. **Regras de processo no prompt** ("pontue antes de recomendar", "valide antes de mostrar") e **marcas no dado** (`do_not_recommend`).
5. **Validador de metadados de publicação** (limite de caracteres de tags, hashtags) como ferramenta.
6. **Pacote de vídeo como documento** (blueprint: título escolhido, alternativas com nota, miniatura, descrição, tags, palavras-alvo).
7. **Prompt expandido devolvido ao cliente** e miniatura em camadas, editável.
8. **Tabela de custos como dado** (`creditCost` com `SingleUse`/`TimeBased`), servindo também de catálogo de recursos.
9. **Modelo barato separado para sugestões** (`flash-lite`) e cache de prompt longo.

Superar:

1. **Nota de título opaca** e inflada (88–98 no app); outra escala no agente (82–87).
2. **Idioma inferido pelo servidor** e filtro de outliers fixo em inglês e EUA/Reino Unido/Canadá/Austrália. Para Canais dark em português, isso erra o público.
3. **Saída das ferramentas não persistida** para o usuário: dá para ver que a nota foi pedida, mas não o que voltou.
4. **Markup** de ~10–25× sobre o custo do LLM, num medidor de crédito por ação.
5. **Truncamento do Free no servidor** (3 de 300) e captcha (Turnstile) nas ferramentas públicas.
6. **Geração de miniatura disparada em segundo plano** ao abrir um item (fluxo 02), sem pedido explícito.

## B10. Desconhecidos

- O conteúdo do stream SSE (eventos intermediários) não ficou no HAR.
- O algoritmo de `score_titles` e a origem do `volume` normalizado não aparecem.
- Não se sabe se as duas gerações `thumbnails_async` do fluxo 02 foram cobradas (o saldo não mudou entre os fluxos 1 e 3, então provavelmente não).
- `breakout_score` e o `score` de outlier não foram decompostos (os exemplos não fecham com visualizações/mediana simples).
- Recorte de vídeo (`clipping`), geração de descrição e tags dedicadas e a API MCP não foram exercitados.

---

# Parte C: Consolidação Opus × Vizard × vidIQ

Lente: o Clipes é uma **fábrica local-first de Cortes e vídeos para Canais dark**. Produz em lote a partir de Fontes com permissão, empacota cada Corte para publicação e deixa o usuário escolher o Motor de transcrição e o Provedor (assinatura via CLI, chave de API ou modelo local).

### Submissão / criação de job

| | Como faz |
|---|---|
| Opus | Um POST com curadoria e render juntos: `range`, `clipDurations`, `model`, `genre`, `customPrompt`, `enableAutoHook`, `brandTemplateId`, `layoutAspectRatio`. |
| Vizard | Pré-checagem (`download-video-info`). O job congela `user_prompt`, `pref_len`, `lang`, `version` e `clip_count` no resultado. Máquina de estados por etapa. |
| vidIQ | Chamadas síncronas curtas (`videoTopic`, `videoFormat`). Estado salvo como blueprint. |
| **Clipes** | **Receita de lote**: um arquivo declarativo com Fontes, faixa, duração-alvo, quantidade de candidatos, prompt, Provedor, Motor de transcrição, preset de legenda e enquadramento. Congelada no resultado junto com a versão do pipeline, para o mesmo lote poder ser refeito. Pré-checagem local (duração, idioma, faixas de áudio) e **estimativa de custo do Provedor** antes de rodar. Estados por etapa persistidos, com retomada após falha. |

### Seleção e nota

| | Como faz |
|---|---|
| Opus | 5 eixos com comentário (hook, coherence, connection, trend, sponsorship). Exibe `curvedScore` (99) sobre o bruto (16). |
| Vizard | `viral_score` de 0 a 10, uma casa, comprimido (8,2–10), mais `reason` e 5 `keywords`. Gera 20 e mostra os 10 melhores. Sem deduplicação. |
| vidIQ | Título 0–100 opaco. Palavra-chave = 0,6·volume + 0,4·(100 − concorrência), explicável. |
| **Clipes** | **Eixos nomeados com nota bruta e justificativa** dados pelo Provedor (gancho, completude, clareza sem contexto, emoção/humor, aderência ao nicho), **combinados por pesos visíveis e editáveis** (como o vidIQ), sem curva escondida. Gerar N candidatos, **deduplicar por sobreposição de tempo e de assunto**, ordenar e deixar o usuário decidir quantos renderizar. Guardar a nota por eixo para calibrar com o desempenho real depois. |

### Transcrição

| | Como faz |
|---|---|
| Opus | Segmentos com palavras, `score` de confiança por palavra, pausa como segmento `__silence`, tempo relativo e absoluto. |
| Vizard | Palavras com ms e falante, recortadas por candidato. Sem confiança e sem pausa no ASR; pausa só no documento de edição. |
| vidIQ | Não exposta (há `mcp-video-transcripts`). |
| **Clipes** | **Uma Transcrição da Fonte inteira**, local por padrão: palavra, início/fim em ms, falante, confiança e pausas explícitas como itens. Os Cortes referenciam trechos dela. A confiança vira UI (sublinhar palavras de baixa confiança para revisão rápida). Exportar SRT/VTT/TXT. |

### Documento de edição

| | Como faz |
|---|---|
| Opus | `editingScript` com tracks (KeyFrame, Caption, Emoji, TextOverlay). Legenda por palavra com `color`. Análise de rosto/cena dentro do documento. |
| Vizard | Dois documentos (`userJson` conteúdo, `userStyleJson` cena). Apagar = `type` 1→3 com `oldType`. Documento inteiro no S3 a cada 30–120 s, e o último a escrever ganha. |
| vidIQ | Blueprint (pacote) e miniatura em camadas. |
| **Clipes** | **Dois arquivos JSON locais por Corte** (conteúdo e cena), com **edição não destrutiva** (marcar, nunca apagar) e **histórico por operação** (log de edições), em vez de sobrescrever o documento inteiro. Um terceiro documento por Corte, o **pacote** (título escolhido + alternativas com nota, descrição, tags, miniatura). Formato aberto e versionado, para lote e script poderem gerar e alterar documentos sem UI. |

### Legenda

| | Como faz |
|---|---|
| Opus | 45 presets como dado (Lottie/Rive por preset). Cor por classe de palavra. Emoji ancorado na palavra. |
| Vizard | Presets no bundle. Estilo resolvido no documento (fonte, 3 cores de destaque, contorno, sombra, fundo, caixa x/y/w). Aplicar preset re-segmenta e perde edição. |
| vidIQ | (não se aplica) |
| **Clipes** | **Preset como arquivo de dados** (estilo + regras de quebra), separado da **segmentação manual**, que é preservada quando o preset muda. Destaque por classe (palavra-chave, gancho, número), emoji ancorado na palavra e posição em coordenadas normalizadas. Presets compartilháveis entre Canais. |

### Enquadramento

| | Como faz |
|---|---|
| Opus | Enum de layouts (Fill, Fit, Split, Three, Four, Game, Screen) mais `analysisResult` com rosto/pessoa/falante ativo e `PySceneDetect`. |
| Vizard | Lista de retângulos (recorte na Fonte + posição no quadro). Reframe com uma detecção por cena (caixas de falante e rosto), ~50 s no servidor. |
| vidIQ | (não se aplica) |
| **Clipes** | **Modelo do Vizard (lista de retângulos normalizados)**, com os **layouts do Opus como presets** que geram essa lista. Detecção local por cena (corte de cena + rosto/pessoa a cada mudança), com **suavização entre cenas** e rastreio opcional quando a câmera se move. Gameplay e tela + webcam como presets de primeira classe, porque são comuns em VOD de live. |

### Cobrança e quotas

| | Como faz |
|---|---|
| Opus | Por minuto de Fonte, mais casos de uso com `freeLimit`/`resetAt`. Prévia `clip-projects/count`. |
| Vizard | Segundos de Fonte (1 crédito = 1 min). Free cobra a Fonte inteira. Privilégios num objeto (`openApi`, `rpm`, `rph`). |
| vidIQ | 152 features `SingleUse`/`TimeBased`. MCP mais barato. Margem de ~10–25× sobre o LLM. |
| **Clipes** | Sem crédito próprio: o custo é do **Provedor e do Motor escolhidos pelo usuário**. Mostrar **estimativa antes do lote** (tokens × preço do Provedor, minutos de Transcrição remota) e **custo real depois**, por Corte e por lote, como o `metrics.estimated_cost_usd` do vidIQ. Local (Transcrição e modelo local) custa zero, e isso deve aparecer na tela. Limites de taxa por Provedor configuráveis. |

### Agente / LLM

| | Como faz |
|---|---|
| Opus | Modelo de curadoria no servidor (`ClipBasic`). Existe `agent-sessions`, mas não foi observado. |
| Vizard | Texto gerado dentro do job (manchete, razão, keywords, emoji). Sem agente. |
| vidIQ | Agente com LLM barato (DeepSeek via OpenRouter, raciocínio low) e ferramentas determinísticas. Regras de processo no prompt. `working_trace` com custo. Modelo separado para sugestões. |
| **Clipes** | **Provedor plugável** (CLI, API ou local) que **só gera e justifica**. **Ferramentas locais determinísticas** fazem o resto: medir duração e pausas, checar limites de título e tags, deduplicar, aplicar a fórmula de nota e validar o pacote. Guardar um **trace por chamada** (prompt, versão do prompt, modelo, ferramentas chamadas com entradas **e saídas**, tokens, custo, tempo). Prompts versionados como arquivo. Como o Provedor é do usuário, não há margem a esconder. |

## Arquivos de trabalho (fora do repo)

`C:\Users\Windows 11\clipes-hars\rea-ev\`: `clean\` (HARs com schema corrigido), `focus\` (subconjuntos redigidos), `out\` (Evidence do REA, `*.summary.json`, `*.api-surface.json`), `scripts\` (sanitização e leitura). `C:\Users\Windows 11\clipes-hars\node24\` tem o Node 24.22.3 portátil usado para o REA 6.9.0. Nada disso é versionado: os HARs originais contêm tokens de sessão e credenciais temporárias.
