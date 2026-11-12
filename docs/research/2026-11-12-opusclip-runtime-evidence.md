# OpusClip — evidência de runtime (REA sobre HARs)

Data: 2026-11-12. Complementa `2026-11-12-opusclip-feature-inventory.md`, que é superfície pública (marketing, help center, preço). Aqui tudo vem de tráfego real do app `clip.opus.pro` capturado com Playwright, decodificado com REA 6.9.0.

## Método e limites

- Capturas originais em `C:\Users\Windows 11\clipes-hars\hars\opus-*.har` (7 fluxos, 634–1158 registros cada), feitas a partir de uma conta em trial, conteúdo em pt-BR, projeto `P3111215gFYP`.
- HAR do Playwright viola o schema em dois campos (`entry.time` e `timings.*` negativos). Cópias sanitizadas em `rea-ev\clean`. Os digests abaixo são dessas cópias; o original fica para proveniência.
- `api-surface` estoura o orçamento de projeção em HAR grande, então o mapa de endpoints rodou num subconjunto só com `*.opus.pro` e respostas JSON — sem JS, CSS, mídia (`rea-ev\focusapi`). Subconjunto não prova ausência.
- Evidência histórica: não há atribuição de runtime, versão de deploy nem autenticidade. Um campo ausente é ausência observada, não inexistência.
- Todos os registros vêm de uma conta `TRIAL`, então o que aparece habilitado é gating de trial, não de plano pago.

Evidência pai (um viewer de captura por fluxo):
`opus-01 ev_066b3a5a…`, `opus-02 ev_be7c7d88…`, `opus-03 ev_649d6fe6…`, `opus-04 ev_4e61bb8f…`, `opus-04b ev_c36d8622…`, `opus-05 ev_a2a3a09c…`, `opus-06 ev_3f12a988…`.

## 1. Payload de submissão (`POST /api/clip-projects`)

Observado nos fluxos 01 e 05 (evidência `opus-01` registro 47; `opus-05`).

```json
{
  "videoUrl": "https://www.youtube.com/watch?v=SbumHQG0eFE",
  "importPref": { "sourceLang": "pt" },
  "curationPref": {
    "model": "Auto",
    "range": { "startSec": 0, "endSec": 300 },
    "clipDurations": [[0, 180]],
    "skipSlicing": false,
    "skipCurate": false,
    "genre": "Auto",
    "customPrompt": "",
    "enableAutoHook": true
  },
  "renderPref": { "enableCaption": true, "layoutAspectRatio": "portrait" },
  "brandTemplateId": "preset-fancy-word-cut",
  "analyticsCtx": { "trigger": "normal", "entryType": "Classic", "entryPoint": "normal", "enable_upload_bg": false, "uploaded": {} }
}
```

O que isso fixa:

- A submissão carrega **preferência de curadoria e de render no mesmo POST** que cria o projeto. Não existem etapas separadas de "escolher" e "renderizar": a escolha de modelo, faixa, duração, gênero e prompt é o job.
- `range.startSec/endSec` recorta o vídeo de origem na submissão. O inventário público diz que só o trecho processado é cobrado; aqui está o campo.
- `skipCurate` é o "Don't Clip" (só legenda, sem corte) e `skipSlicing` desliga o fatiamento.
- `clipDurations` é um par `[min, max]` em segundos. O default observado é `[[0,180]]`.
- `enableAutoHook` viaja na submissão, não é pós-edição.
- `brandTemplateId` aceita um preset do catálogo (`preset-fancy-*`); template é aplicado no submit.
- `analyticsCtx.entryType: "Classic"` convive com outras entradas — a taxonomia de entrada existe no produto.

Inferência `[inferred]`: `model: "Auto"` escolhe entre os modelos do servidor; num projeto existente o campo persistido é literal (`ClipBasic`), não "Auto".

## 2. Modelo de curadoria e de score

`GET /api/clip-projects/{id}` (evidência `opus-02`, registro do clip 1) devolve, por clip:

```json
"score": 99,
"judgeResult": {
  "score": 16, "curvedScore": 99,
  "hookScore": 8,        "hookComment": "A abertura chama atenção com uma reação espontânea…",
  "coherenceScore": 8,   "coherenceComment": "A conversa mantém um fio compreensível…",
  "connectionScore": 8,  "connectionComment": "O humor e a reação autêntica entretêm…",
  "trendScore": 4,       "trendComment": "…se apoia em uma referência…",
  "sponsorshipScore": 0
}
```

- O score que o usuário vê (`score`, 0–99) é **`curvedScore`**, não `judgeResult.score` (16). A curva é o que transforma 16 em 99 — ou seja, o número exibido é uma normalização, não uma probabilidade.
- Os eixos reais são **hook, coherence, connection, trend, sponsorship** — o inventário público chamava de Hook/Flow/Value/Trend e deixava sponsorship de fora. Sponsorship existe e é 0 no caso sem patrocínio.
- Cada eixo vem com **comentário em linguagem natural**. É o mesmo eixo que alimenta a geração de título/descrição.
- `genre: "Gaming"` aparece mesmo com `genre: "Auto"` na submissão: o servidor classifica.
- `archId: "RHP"`, `model: "ClipBasic"`, `subgenre: ""`, `rawScore: 0`, `isBonusClip`, `numAiBrollSuggested`, `numAiBrollGenerated`.

O mesmo objeto traz `title`, `description`, `hashtags` já gerados, e `screenplay.chapters` com 2 capítulos.

## 3. Modelo de edição (`editingScript`)

`POST /api/engine-clips/{id}/save-and-render` envia o documento inteiro. Estrutura observada:

- `clipBody.editingScript.tracks[]`, com `trackType` em `KeyFrameTrack`, `CaptionTrack`, `EmojiTrack`, `TextOverlayTrack`.
- `KeyFrameTrack` → `segments[].content.layoutType` (`Fill` observado) + `keyFrameContents[].cropAreas` em percentual (`CPct`) + `analysisResult`.
- `analysisResult` carrega `face`, `faceV2` (com `faceness`, `activeness`, `isFake`), `peopleV2` (com `peopleness`), `fakeFace[]`, `people[]`, `activeSpeaker`, `movingSpeaker: "NotDetected"`, `trackingSubjects.status: "NotDetected"`, `panels[]` (com `category`), `docLayoutRegions[]` (com `label`).
- `propertiesMap.shotCuts` tem **`backend: "PySceneDetect"`**, `fps: 25` e `cuts[]`.
- `CaptionTrack` guarda **um elemento por palavra** com `text`, `duration` (tempo na fonte), `timeline` (tempo no corte) e `color` (índice: 0 normal, 1 destaque, 2 palavra do gancho).
- `EmojiTrack` guarda `followWordId` — o emoji é ancorado à palavra, não à posição.
- `TextOverlayTrack` guarda `textStyle` (fonte, peso, cor, raio, alinhamento) e `propertiesMap.isAutoHook`, `isHeadline`, `headlineWrapPct`, `enableUppercase`.
- `captionTrackChapters` mantém capítulos ancorados em `text-jG9Arr` com `order`.
- `autoEditResult.tools` registra o que o auto-edit aplicou: `captions: applied`, `autoHeadline: applied`.

Inferência `[inferred]`: a análise de rosto/people não é refeita no cliente; viaja junto com o corte escolhido, sugerindo que roda uma vez no pipeline de curadoria.

## 4. Preferências de render (superfície de estilo)

`renderPref` num clip existente tem 30+ campos, incluindo o enum completo de layout: `enableAutoLayout`, `enableFillLayout`, `enableFitLayout`, `enableSplitLayout`, `enableThreeLayout`, `enableFourLayout`, `enableGameLayout`, `enableScreenLayout`, mais `fitLayoutCropRatio: "4:3"`.

Detecção e enquadramento: `faceDetectFps: 15`, `sceneDetThresh: 3`, `reduceFakeFace: true`, `skipReframe`, `disableFitBackgroundBlur`.

Legenda: `enableCaption`, `enableCaptionAnimation`, `captionAnimation` (Lottie com `templateUrl`, `highlightColor`, `fonts[]`), `captionPosition: "auto"`, `enableHighlight`, `enableEmoji`, `emojiStyle.rect`, `enableUppercase`, `highlightColor.primary/secondary`, `font` (`numericalSize`, `stroke`, `shadow`, `style[]`).

Áudio e pós: `enableAutoTransition`, `selectedTransitions[]`, `enableVoiceEnhancement`, `intro`, `outro`, `speakersColor[]`.

`speakersColor` vem pré-preenchido com `SPEAKER_00…SPEAKER_04` e `UNKNOWN` — diarização existe no modelo, com cor por falante.

## 5. Catálogo de templates de legenda

`GET /api/fancy-template-presets` devolve **45 presets** com `presetId`, `name`, `lottieUrl`, `riveUrl`, `videoUrl`, e um bloco `preferences` completo por preset.

Nomes observados: Karaokê, Gameplay, Beasty, Deep Diver, Youshaei, Pod P, Mozi, Popline, Simple, Think Media, Glitch Infinite, Seamless Bounce, Baby Earthquake, Blur Switch, Highlighter Box, Focus, Blur In, With Backdrop, Soft Landing, Baby Steps, Grow, Breathe, Font Shuffle, Soft Cut, Stack Cut, Negative text, Negative keywords, Doodle, Crossline, Decode, Handwritten, Editorial, Word Cut, Marker Sweep, Soft Build, Punch, Handheld, Glide, Comic, Sticker, Retro 3D, Elastic, Bouncing dot, Chip background, Typewriter.

Assets em `public.cdn.opus.pro/clip-web/ae-template/caption_animation/lottie/presets/<nome>/template.json`; miniaturas em `.../fancy-template-thumbnails/rive/<nome>.riv`. Animações são Lottie e Rive, servidas por preset — não há geração procedural no cliente.

`preset-fancy-Gameplay` existe no catálogo e é o preset padrão de um fluxo de gameplay.

## 6. Transcrição exposta ao cliente

`GET /api/transcripts` (evidência `opus-03`) devolve 843 segmentos:

```json
{ "start": 0.031, "end": 1.679, "text": "Tem a legenda oficial em português?",
  "words": [{ "word": "Tem", "start": 0.031, "end": 0.433, "score": 0.53 }, …],
  "tokens": [null,…], "id": 0, "absStart": 0.031, "absEnd": 1.679 }
```

- Timestamp por palavra e `score` de confiança por palavra — a legenda sai daí, e a confiança por palavra fica disponível ao cliente.
- Pausas são segmentos com `text: "__silence"` (start/end próprios), não buracos no array. Isso é o que a remoção de silêncio consome.
- `start/end` relativo ao corte e `absStart/absEnd` relativo à fonte: os dois tempos coexistem.

## 7. Quotas e medidor de cobrança

`GET /api/credit-allowances` (evidência `opus-03`) expõe preço por caso de uso:

| caso de uso | medidor | créditos |
|---|---|---|
| `ai_speech_enhancement` | 30 s | 3 |
| `ai_stock_broll` | 60 s | 1 |
| `ai_sfx_auto` | 60 s | 7 |
| `ai_viral_hook` | item | 2 |

Cada um com `freeLimit`, `freeUsed`, `freeRemaining`, `resetAt: 2026-11-13T03:00:00Z` em `America/Sao_Paulo`, e `subsidyBelow` (execuções curtas isentas). `billingArm: "billed"`.

`GET /api/bad-takes/quota` devolve `{ freeRemaining: 1, freeLimit: 1, creditEligible: true }` — uma execução grátis por janela.

`POST /api/clip-projects/count` devolve `{ total, saved }`; é a prévia de quantos projetos/cortes o intervalo renderia antes de gastar.

## 8. Gating regional

`GET /api/client-access-control` não é mapa de plano: devolve geo/IP.

```json
{ "detail": { "countryCode": "BR", "isp": "…", "proxy": false, "hosting": false },
  "shouldBlock": false, "tzClass": "NEU", "decisionQuality": "DONT_CARE" }
```

Seleção de datacenter por fuso (`tzClass`) e bloqueio por IP/proxy/hosting são decididos no cliente request.

## 9. Superfície de API observada (agrupada)

Os nomes carregam a arquitetura:

- **Curadoria**: `clip-projects`, `clip-projects/count`, `curated-clips`, `curated-clips/feedback`, `cluster-jobs/{id}/progress`, `screenplays`, `transcripts`.
- **Engine/edição**: `engine-clips/{id}`, `engine-clips/{id}/save-and-render`, `editor-history-records`, `exportable-clips`, `exportable-clips/{id}/eye-contact/active`.
- **Efeitos**: `sound-effects` (retorna vazio na conta trial), `auto-sound-effect-tasks`, `voice-enhancement`, `bad-takes/quota`, `video-upscaling-tasks`, `fancy-template-presets`, `word-libraries`, `brand-kits`, `brand-templates`.
- **Publicação**: `post-tasks`, `social-accounts`, `social-accounts/health-check`, `campaigns`.
- **Ingestão**: `source-videos`, `source-media-groups`, `project-channels`, `project-playlists`, `auto-import`.
- **Negócio**: `subscriptions`, `subscription-plans`, `subscription-coupons`, `org-credits`, `credit-allowances`, `orgs/mine/storage-quota`, `login-users`, `org-members/prepare-assembled-basic-info`.
- **Telemetria**: `dog-events` (33–41 por fluxo de edição), `user-guide-use-records`, `report-feedback-popup-event`, `feedback-popup-quota`.
- **Agente**: `agent-sessions` (existe sessão de agente dentro do produto).

`word-libraries` devolve `libraryType: "CurseWords"` com 15 palavras e `isSystemDefaultLibrary` — o censo de palavrões é biblioteca versionada, não lista fixa.

`GET /api/exportable-clips/{id}/eye-contact/active` devolve `{ task: null }` quando não há correção ativa: é polling de task assíncrona, não flag booleano.

## 10. O que copiar e o que bater

Copiar (arquitetura, não código):

1. **Preferência no submit**: modelo, faixa, duração e prompt no mesmo POST — evita estado de projeto meio-configurado.
2. **Score com eixos nomeados e comentados**: hook/coherence/connection/trend/sponsorship, cada um com justificativa legível.
3. **Legenda por palavra com `color` por classe** (normal / destaque / gancho) e emoji ancorado em `followWordId`.
4. **Silêncio como segmento `__silence`**, não como lacuna — a remoção fica auditável.
5. **Dois tempos por elemento** (`duration` na fonte, `timeline` no corte) — o mesmo modelo serve preview e export.
6. **Análise de rosto/cena dormindo junto do corte** (`analysisResult`, `shotCuts`) em vez de recomputar no render.
7. **Enum de layout explícito**, incluindo `GameLayout` e `ScreenLayout`, com `fitLayoutCropRatio`.
8. **Template como dado** (Lottie/Rive por preset) — sem compilar efeito no binário.
9. **Prévia de custo antes de gastar** (`clip-projects/count`).
10. **Diarização com cor por falante** desde o modelo.

Bater:

1. **Score curvado e opaco**: `curvedScore` 99 sobre `judgeResult.score` 16, sem fórmula exposta. Um score explicável e calibrado é diferencial direto.
2. **Custo por minuto de entrada**, não por corte — `clip-projects/count` existe, mas o gasto é no submit.
3. **`sound-effects` vazio em trial**: catálogo de SFX pago.
4. **Bad take com 1 execução grátis**: é caro por desenho.
5. **Eye-contact só como polling de task** e limitado a "gaze drift corrigível".
6. **Transcrição com `score` por palavra exposto mas nenhuma UI de revisão por confiança** — a confiança existe e não é acionável.
7. **Dependência de `PySceneDetect`** para shot cuts: em gameplay com corte rápido é o elo frágil.
8. **`hosting`/`proxy` no gate**: VPN derruba acesso.

## 11. Desconhecidos

- Não há evidência do modelo por trás de `ClipBasic`/`ClipAnything`, nem prompt de sistema.
- Não se observou `ClipAnything` em execução (todos os registros são `ClipBasic`); o fluxo multimodal segue não verificado.
- O mapeamento plano→feature não está no tráfego (vem de `/api/subscription-plans`, não coletado).
- Não se observou webhook, API pública nem MCP.
- O significado exato dos índices de `color` na legenda (0/1/2) é inferido pelo contexto do gancho, não declarado.
- `sound-effects` vazio pode ser gating de plano ou catálogo vazio em pt-BR; não separado.
