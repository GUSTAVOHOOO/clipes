# OpusClip (opus.pro / opusclip.net) — capability & gating inventory

Research date: 2026-11-12. Snapshot of a live SaaS product; pricing/limits move fast.

Method: primary sources first (marketing site pages, help center `help.opus.pro`, public API reference, support docs), third-party only where primary sources are silent, always labelled. `[inferred]` marks anything the sources imply but do not state.

Naming caveat carried through the whole document: the pricing page calls the top self-serve-adjacent tier **Business**, while several help articles call the same tier **Enterprise**. Plan gating below follows the pricing page; where a help article uses "Enterprise", that is noted.

Gating legend: `[Free]` `[Starter+]` `[Pro+]` `[Business]` `[Trial]` `[All]`. "Sales-gated" means the capability exists but only behind `contact sales`.

---

## Feature inventory

### 1. Ingest

| # | Capability | Gating / cost | Source |
|---|---|---|---|
| 1 | Upload a local video file. Size cap is 10 GB on Free/Starter, 30 GB on Pro and above. | Free, Starter: 10 GB; Pro+: 30 GB | [pricing](https://www.opus.pro/pricing) |
| 2 | Paste a YouTube URL (including unlisted) to create a project. | `[Free]` | [pricing](https://www.opus.pro/pricing) · [sources](https://help.opus.pro/docs/article/video-sources-supported) |
| 3 | Import from Google Drive, Vimeo, Zoom, Zoom Clips, Rumble, StreamYard. | `[Starter+]` | [pricing](https://www.opus.pro/pricing) · [sources](https://help.opus.pro/docs/article/video-sources-supported) |
| 4 | Import from Twitch, Facebook, LinkedIn, X, Dropbox, Loom, Riverside, Frame.io, Kick, Apple Podcast, Medal.tv, and arbitrary public `.mp4` URLs. | `[Pro+]` | [pricing](https://www.opus.pro/pricing) · [sources](https://help.opus.pro/docs/article/video-sources-supported) |
| 5 | Links must be public or unlisted; private videos cannot be fetched. | `[All]` | [sources](https://help.opus.pro/docs/article/video-sources-supported) |
| 6 | Auto-import: connect a YouTube channel, then either email-notify on each new video or auto-create projects with saved clip settings (videos > 3 min, all public uploads or selected playlists). | `[Starter+]`; CMS/other cloud servers `[Business]` | [auto import](https://help.opus.pro/docs/article/auto-import) · [pricing](https://www.opus.pro/pricing) |
| 7 | Hard input ceiling: 10 hours duration; longer videos need a trimmed processing range. | `[All]` | [video length](https://help.opus.pro/docs/article/video-length) |
| 8 | Speech recognition in 25 languages (English + 24, 19 of them flagged beta). | `[All]` | [languages](https://help.opus.pro/docs/article/video-languages-supported) |
| 9 | Upload your own `.srt` and have it used instead of the generated transcript. | `[All]` | [own SRT](https://help.opus.pro/docs/article/upload-own-srt) |
| 10 | "Don't Clip" passthrough: submit a video and get a caption-only project with no AI cutting, capped at 15 minutes. | `[All]` (15 min cap) | [no-clip submit](https://help.opus.pro/docs/article/submit-a-video-without-clipping) |
| 11 | Live Clipping (private beta): paste a live YouTube/Twitch/Kick/TikTok link or an HLS/DASH/RTMP/RTSP/SRT address; the stream is recorded and cut into ~15 min / ~30 min / ~1 hr chunks with optional 1/2/5 min overlap. | Private beta, workspace allow-list | [live clipping](https://help.opus.pro/opus-labs/live-clipping) |
| 12 | OpusSearch: index a whole back catalogue (YouTube channels/playlists or manual uploads) so moments can be searched in natural language; desktop only. | Waitlist / sales | [OpusSearch](https://www.opus.pro/opussearch) · [docs](https://help.opus.pro/docs/article/opussearch) |
| 13 | Video dubbing submits a YouTube link, file, or Drive file for translation. | `[Pro+]` | [dubbing](https://help.opus.pro/docs/article/video-dubbing) |
| 14 | Upscale-only job for blurry source footage, max 5 minutes. | `[Pro+]`, credit-metered | [upscale](https://help.opus.pro/docs/article/upscale-a-video) |
| 15 | Multi-Angle (Labs): upload MP4/MOV/WebM up to 4 GB / 1 hr and get AI-generated extra camera angles over the same audio. | Opus Labs beta | [multi-angle](https://help.opus.pro/opus-labs/multi-angle) |

### 2. Analysis and clip selection

| # | Capability | Gating / cost | Source |
|---|---|---|---|
| 16 | ClipBasic model: transcript-only highlight detection, works on talking-head video. | `[All]` | [clipanything](https://www.opus.pro/clipanything) |
| 17 | ClipAnything model: multimodal analysis of frames (objects, colours, actions, on-screen text, sounds, sentiment) so non-talking video — sport, gameplay, music, TV — can be clipped; still labelled beta in support docs. | `[All]` on paid-capable plans; usage burns credits | [clipanything](https://www.opus.pro/clipanything) · [beta note](https://help.opus.pro/docs/article/clipanything-qa-10) |
| 18 | Natural-language prompt to clip a moment, action, character, emotion, or compilation ("find all the laughing scenes"). | `[Pro+]` (prompt-to-clip); reprompt `[Starter+]` | [pricing](https://www.opus.pro/pricing) · [prompt manual](https://help.opus.pro/docs/article/clip-anything-prompt-manual) |
| 19 | Reprompt the same project to regenerate a second batch of clips; prompt tabs stack above the originals, one prompt at a time. | `[Starter+]`, burns credits | [reprompt](https://help.opus.pro/docs/article/clipanything-qa-9) |
| 20 | Genre selection (podcast, sport, gaming, news, music, …) tunes the curation and narrative template. | `[All]` selection; genre-specific curation model `[Starter+]` | [clipanything](https://www.opus.pro/clipanything) · [pricing](https://www.opus.pro/pricing) |
| 21 | Narrative templates, written with producers, applied per genre to shape clip structure. | `[All]` [inferred from genre model] | [narratives](https://help.opus.pro/docs/article/clipanything-qa-7) |
| 22 | Virality score 0–99 per clip, from Hook / Flow / Value / Trend sub-scores, shown next to clips and used as the default sort order. | `[Starter+]`; absent on Free | [virality score](https://help.opus.pro/docs/article/virality-score) |
| 23 | Result page offers grid and list views. | `[All]` | [virality score](https://help.opus.pro/docs/article/virality-score) |
| 24 | CoPilot clip-length presets: 0–1 m, 1–3 m, 3–5 m, 5–10 m, 10–15 m; default is Auto (0–3 m). | `[All]` | [clip length](https://help.opus.pro/docs/article/select-clip-length) · [pricing](https://www.opus.pro/pricing) |
| 25 | CoPilot processing timeframe: set start/end seconds so only part of a long video is analysed (and only that part is charged). | `[All]` | [timeframe](https://help.opus.pro/docs/article/select-timeframe) · [credits](https://help.opus.pro/docs/article/how-are-credits-consumed) |
| 26 | Topics search inside the copilot. | `[Pro+]` | [pricing](https://www.opus.pro/pricing) |
| 27 | Clip volume scales with runtime, documented caps: 1–2 clips for 0–3 min up to 42–55 clips for 120 min+. | `[All]` | [how many clips](https://help.opus.pro/docs/article/how-many-clips) |
| 28 | Auto headline: one-line text overlay generated for the top 10 clips. | `[Free+]` (all tiers), on by default for manual uploads | [auto headline](https://help.opus.pro/docs/article/auto-headline) · [pricing](https://www.opus.pro/pricing) |
| 29 | Auto hook / Viral Hook: template filled with the clip's own opening words, with animated text, zoom and matching SFX on the first seconds. | Hook templates `[Trial, Pro+]`; clipping-wide hook 20 credits for up to 10 clips, editor hook 2 credits | [viral hook](https://help.opus.pro/docs/article/add-a-viral-hook) |
| 30 | Sentiment analysis (arguing, laughter, surprise, sorrow) used as a selection signal. | `[All]` via ClipAnything | [clipanything](https://www.opus.pro/clipanything) |
| 31 | Cross-scene reasoning so scenes from different parts of a video can be stitched into one themed highlight reel. | `[All]` via ClipAnything | [clipanything](https://www.opus.pro/clipanything) |
| 32 | On-device/manual feedback signal: thumbs up/down and heart per clip feed model tuning. | `[All]` | [clipanything](https://help.opus.pro/docs/article/how-to-use-clipanything) |

### 3. Editing

| # | Capability | Gating / cost | Source |
|---|---|---|---|
| 33 | Text-based editing: select words in the transcript and correct, delete captions only, or delete captions + video. | `[Starter+]` | [change captions](https://help.opus.pro/docs/article/change-captions) |
| 34 | Timeline editing with trim handles and "Add a Section" pulled from any other timestamp of the source video. | `[Starter+]` | [trim/extend](https://help.opus.pro/docs/article/trim-extend-the-video) |
| 35 | Split at playhead via `D` / `Cmd+B`; frame-step with arrows; `+`/`-` timeline zoom; Home/End. | `[Starter+]` | [shortcuts](https://help.opus.pro/docs/article/keyboard-precise-editing) |
| 36 | Snap editing (magnetic clips/overlays, toggle with `S`), on by default. | `[Starter+]` | [snap](https://help.opus.pro/docs/article/snap-editing) |
| 37 | Drag-reorder scenes within the timeline and duplicate clips. | `[Starter+]` | [reorder](https://help.opus.pro/docs/article/can-i-drag-rearrange-sections-timeline) · [duplicate](https://help.opus.pro/docs/article/duplicate-clips) |
| 38 | Split one clip into two downloadable clips. | `[Starter+]` | [split](https://help.opus.pro/docs/article/split-my-clip) |
| 39 | Transition effects: cross fade, cross zoom, zoom in, zoom out, fade in, fade out, plus auto-transition on detected jump cuts. | `[Pro+]` | [transitions](https://help.opus.pro/docs/article/add-transition-effects) · [pricing](https://www.opus.pro/pricing) |
| 40 | Speech cleanup — remove fillers (um/uh/"you know"/stutters) with a per-type checklist. | `[Starter+]` | [speech cleanup](https://help.opus.pro/docs/article/speech-cleanup) |
| 41 | Speech cleanup — remove pauses with an adjustable silence threshold (default 0.5 s). | `[Starter+]` | [speech cleanup](https://help.opus.pro/docs/article/speech-cleanup) |
| 42 | Speech cleanup — "Remove bad takes": detect retakes, restarts, self-corrections, then review inline and remove one by one or all. | `[Pro+]` | [speech cleanup](https://help.opus.pro/docs/article/speech-cleanup) · [pricing](https://www.opus.pro/pricing) |
| 43 | Speech enhancement: noise reduction, background removal, voice isolation onto a separate track, voice boost, two sliders. | `[Pro+]`, 10 uses/day | [speech enhancement](https://help.opus.pro/docs/article/speech-enhancement) |
| 44 | Eye-contact correction limited to shots where the gaze drift is fixable; segments are editable per timeline block. | `[Pro+]` | [eye contact](https://help.opus.pro/docs/article/eye-contact-correction) |
| 45 | Auto color correction (white balance, brightness, contrast) with an intensity slider. | `[Trial, Pro+]`, 1 credit | [color](https://help.opus.pro/docs/article/auto-color-correction) |
| 46 | Auto Zoom: transcript-driven punch-ins **and** pull-backs, each one an editable/deletable timeline block. | `[Pro+]` | [auto zoom](https://www.opus.pro/tools/zoom-in-effect) |
| 47 | B-roll by AI image, AI video, or stock, inserted at auto-detected spots or a chosen timestamp/sentence, with per-spot review. | AI image/stock `[Starter+]` (3/month Starter, 50/day Pro+); AI video B-roll `[Pro+]` | [b-roll](https://help.opus.pro/docs/article/ai-broll) · [pricing](https://www.opus.pro/pricing) |
| 48 | AI voice-over: type a script, pick one of 20+ stock voices, adjust tone stability and duck the original audio. | `[Starter+]`, 20/day | [voiceover](https://help.opus.pro/docs/article/ai-voiceover) · [pricing](https://www.opus.pro/pricing) |
| 49 | Upload own media assets (images/video/audio) into the project and library. | `[Pro+]` | [upload media](https://help.opus.pro/docs/article/upload-media) |
| 50 | Add licensed library music or upload own music. | `[Pro+]` | [music](https://help.opus.pro/docs/article/add-music-to-your-clips) · [pricing](https://www.opus.pro/pricing) |
| 51 | Intro and outro cards. | `[Pro+]` | [intro/outro](https://help.opus.pro/docs/article/intro-outro-cards) |
| 52 | Upload custom fonts (2 max on Pro). | `[Pro+]` | [custom fonts](https://help.opus.pro/docs/article/custom-fonts) |
| 53 | Text overlays added and positioned on canvas. | `[Starter+]` | [text overlays](https://help.opus.pro/docs/article/add-text-overlays) |
| 54 | Motion graphics: auto highlighter of names/numbers/dates in Auto Edit (6 credits per input minute) or manual data/social/promo templates (free). | `[Trial, Pro+]` | [motion graphics](https://help.opus.pro/docs/article/add-motion-graphics) |
| 55 | Auto censor of profanity across caption text and audio (beep or mute, `**` or `--` display); revert or re-censor per word. | `[Pro+]` default list; custom lists (max 5) `[Business]` | [censor](https://help.opus.pro/docs/article/how-to-censor-curse-words) |
| 56 | AI upscaling of low-quality footage. | `[Pro+]`, credits; 4K adds 11 credits / 10 s block | [upscale](https://help.opus.pro/docs/article/upscale-a-video) |
| 57 | Manual reframe: drag crop corners/edges on the canvas. | `[Starter+]` (custom reframing) | [crop ratio](https://help.opus.pro/docs/article/can-i-customize-crop-ratio) |
| 58 | Subject tracking: automatic moving-speaker tracking, plus manual tracker for any subject (product, animal, hands) on chosen scenes. | Auto `[All]`; moving-object tracking `[Pro+]` | [subject tracking](https://help.opus.pro/docs/article/subject-tracking) · [pricing](https://www.opus.pro/pricing) |
| 59 | Seven layouts: Fill, Fit, Split, Three, Four, Screenshare, Gameplay (30% speaker / 70% gameplay). | `[All]`; screenshare/gameplay explicitly checked on all tiers | [layouts](https://help.opus.pro/docs/article/layout-and-reframing) |
| 60 | Aspect ratios: 9:16 only on Free/Starter; 9:16, 1:1, 16:9 on Pro+; Brand Kit also handles 4:5. | 9:16 `[Free+]`; others `[Pro+]` | [pricing](https://www.opus.pro/pricing) · [brand kit](https://help.opus.pro/docs/article/how-to-use-brand-kit) |
| 61 | Auto Edit workflow for raw talking footage: one pass with speech cleanup, captions, B-roll and other toggles returns a finished video. | `[Trial, Pro+]` | [4.0 launch](https://www.opus.pro/blog/opusclip-4-0) |
| 62 | Recipes: save a full edit setup (feature toggles + styles + Brand Kit) and re-run it on every future video; 8 built-in recipes. | `[Pro+]` [inferred: recipe page is the submit flow] | [recipes](https://help.opus.pro/docs/article/how-to-use-recipes) |
| 63 | Brand Kit / brand template: logo, caption style, headline style, layout, intro/outro, music, with per-aspect-ratio placement. | 1 template Free & Starter, 4 templates Pro, custom Business | [brand kit](https://help.opus.pro/docs/article/how-to-use-brand-kit) · [pricing](https://www.opus.pro/pricing) |
| 64 | Brand vocabulary: add proper nouns so future transcripts spell them correctly. | `[Pro+]` | [vocabulary](https://help.opus.pro/docs/article/brand-vocabulary) |
| 65 | Rename clips and projects. | `[Pro+]` | [pricing](https://www.opus.pro/pricing) |
| 66 | Save projects permanently to 100 GB cloud storage with autosave. | `[Pro+]` (100 GB; unlimited storage only `[Business]`) | [storage](https://help.opus.pro/docs/article/cloud-storage) · [pricing](https://www.opus.pro/pricing) |
| 67 | Collections to group clips (40-char names, 200 per workspace, default "Favorites"). | `[Trial, Pro+]` | [collections](https://help.opus.pro/docs/article/collections) |
| 68 | Share a project publicly by link. | `[All]` | [share](https://help.opus.pro/docs/article/share-project) · [pricing](https://www.opus.pro/pricing) |
| 69 | Bulk download many clips at once, with per-file retry on drop. | `[Pro+]` | [bulk download](https://help.opus.pro/docs/article/bulk-download) |

### 4. Captions and styling

| # | Capability | Gating / cost | Source |
|---|---|---|---|
| 70 | Automatic word-synced captions, marketed at 97–99 % accuracy. | `[Free+]` | [home FAQ](https://www.opus.pro/) |
| 71 | Animated caption templates. | `[Free+]` (free tier burns a watermark into them) | [pricing](https://www.opus.pro/pricing) |
| 72 | AI emoji insertion and keyword highlighting, toggleable, plus manual emoji per word. | `[Free+]` | [emojis](https://help.opus.pro/docs/article/ai-emojis-keywords) |
| 73 | Caption styling: font, size, colour, stroke, shadow, case, drag-to-position. | `[All]` | [captions](https://help.opus.pro/docs/article/change-captions) |
| 74 | Per-word timestamp nudging and inserting missing words with auto-retiming. | `[All]` | [captions/emojis](https://help.opus.pro/docs/article/captions-and-emojis) |
| 75 | "Apply to all" for a corrected word, optionally adding it to brand vocabulary. | `[All]` correction; vocabulary write `[Pro+]` | [vocabulary](https://help.opus.pro/docs/article/brand-vocabulary) |
| 76 | Remove captions entirely, or generate clips with the "No Caption" preset for pre-subtitled footage. | `[All]` | [change captions](https://help.opus.pro/docs/article/change-captions) · [clipanything](https://help.opus.pro/docs/article/how-to-use-clipanything) |
| 77 | Speaker-based caption colours. | `[Business]`, marked "coming soon" | [pricing](https://www.opus.pro/pricing) |
| 78 | Subtitle translation into English before clipping. | `[All]` (English target only) | [subtitle language](https://help.opus.pro/docs/article/select-subtitle-language) |
| 79 | Video dubbing / voice clone into 25 languages, auto-cloning the speaker's voice; one speaker voice used for all speakers. | `[Pro+]`, 10 credits per minute | [dubbing](https://help.opus.pro/docs/article/video-dubbing) |
| 80 | Bulk dubbing of a multi-selected batch of clips. | `[Pro+]` | [dubbing](https://help.opus.pro/docs/article/video-dubbing) |
| 81 | Edit the translated transcript inline after dubbing (text only; audio is not re-rendered). | `[Pro+]` | [dubbing](https://help.opus.pro/docs/article/video-dubbing) |
| 82 | Download the source transcript and subtitle files. | `[All]` | [transcripts](https://help.opus.pro/docs/article/download-transcripts-subtitles) |
| 83 | Censored words render as `**` or `--` in captions and beep/mute in audio. | `[Pro+]` | [censor](https://help.opus.pro/docs/article/how-to-censor-curse-words) |

### 5. Publishing and export

| # | Capability | Gating / cost | Source |
|---|---|---|---|
| 84 | Direct post to YouTube (incl. Shorts), TikTok, Instagram. | `[Starter+]` | [pricing](https://www.opus.pro/pricing) |
| 85 | Direct post to Facebook, LinkedIn, X, Pinterest, Threads, Bluesky. | `[Pro+]` | [pricing](https://www.opus.pro/pricing) |
| 86 | Snapchat posting. | Not yet — "coming soon" icon on the pricing matrix | [pricing](https://www.opus.pro/pricing) |
| 87 | Time-based scheduling of posts. | `[Pro+]` | [schedule](https://help.opus.pro/docs/article/schedule-clips) |
| 88 | Bulk scheduler: order clips 1..n, pick first slot and a frequency, let the queue fire. | `[Pro+]` | [bulk scheduler](https://help.opus.pro/docs/article/bulk-scheduler) |
| 89 | Post the same clip to several profiles on one platform. | `[Pro+]` | [pricing](https://www.opus.pro/pricing) |
| 90 | AI generation of per-platform title, description and hashtags. | `[Starter+]` | [pricing](https://www.opus.pro/pricing) · [posts](https://help.opus.pro/docs/article/9747769-customize-my-posts) |
| 91 | Custom thumbnail per clip. | `[Pro+]` | [thumbnail](https://help.opus.pro/docs/article/set-a-custom-thumbnail) |
| 92 | MP4 export at source-appropriate resolution; free exports expire after 3 days and cap at 1080p, Starter 30 days, Pro+ no limit. | 3 days `[Free]`, 30 days `[Starter]`, unlimited `[Pro+]` | [pricing](https://www.opus.pro/pricing) |
| 93 | 4K download (only when the source is genuinely 3840×2160; not upscaling). | `[Pro+]` download; 4K **schedule/post** `[Business]` | [4K](https://help.opus.pro/docs/article/download-and-post-in-4k) · [pricing](https://www.opus.pro/pricing) |
| 94 | Cropped 9:16 output is never downscaled: 4K becomes 1215×2160, 1080p becomes 608×1080, and anything under 1080 on a side is upsampled to 1080×1920. | `[All]` | [resolution](https://help.opus.pro/docs/article/get-clips-faq-2) |
| 95 | Export an XML project to Adobe Premiere Pro or DaVinci Resolve. | `[Pro+]` | [premiere](https://help.opus.pro/docs/article/import-to-adobe-premiere) · [resolve](https://help.opus.pro/docs/article/import-to-davinci-resolve) |
| 96 | Preview playback on the results page is deliberately low-resolution; HD requires export. | `[All]` | [resolution](https://help.opus.pro/docs/article/get-clips-faq-2) |
| 97 | Watermark on output. | Present on `[Free]` and `[Trial]`, removed automatically on upgrade | [watermark](https://help.opus.pro/docs/article/watermark) |
| 98 | Platform-side posting caps enforced: X 150/day, TikTok 4/min and 15/day, Instagram 40/day, YouTube soft-capped at 15/day. | `[All]` | [rate limits](https://help.opus.pro/docs/article/posting-rate-limits) |

### 6. Collaboration, business and integration

| # | Capability | Gating / cost | Source |
|---|---|---|---|
| 99 | Team workspace with shared credits, videos and brand templates; join by invite link. | `[Pro+]`, 2 seats per pack, max 4 seats (2 packs) | [team](https://help.opus.pro/docs/article/6219255-team-management) |
| 100 | Unlimited member seats. | `[Business]` | [pricing](https://www.opus.pro/pricing) |
| 101 | Sub-teams. | `[Business]` | [pricing](https://www.opus.pro/pricing) |
| 102 | Member permissions / roles. | `[Business]`, marked "coming soon" | [pricing](https://www.opus.pro/pricing) |
| 103 | Only the owner can buy the team plan; members spend the owner's credits and lose clip access if removed. | `[Pro+]` | [team](https://help.opus.pro/docs/article/6219255-team-management) |
| 104 | Clip analytics (performance per clip). | `[Business]`; "coming soon" on Pro | [pricing](https://www.opus.pro/pricing) |
| 105 | Real-time trend analysis over the library. | `[Business]` | [pricing](https://www.opus.pro/pricing) · [OpusSearch](https://www.opus.pro/opussearch) |
| 106 | Video-editing REST API (`POST /api/clip-projects` with `videoUrl`, `curationPref`, `brandTemplateId`, `conclusionActions`). | `[Pro+]` beta, `[Business]` contract; `contact-sales` for more | [api](https://www.opus.pro/api) · [create project](https://help.opus.pro/api-reference/endpoints/create-project) |
| 107 | Scheduler API (publish now, schedule, cancel schedule, list social accounts). | `[Pro+]` | [social posting](https://help.opus.pro/api-reference/endpoints/social-posting/overview) |
| 108 | Signed webhooks: HMAC-SHA256 over `body + salt` with `X-Opus-Signature`, `X-Opus-Salt`, `X-Opus-Timestamp`. | API access required | [webhook](https://help.opus.pro/api-reference/webhook) |
| 109 | API limits: 30 req/min, 900 credits (15 h) per calendar month on Pro Beta/Max, 403 + `API_MONTHLY_CAP_REACHED` at cap, 4 concurrent projects (Business 50), 10-credit project minimum, 30-day project expiry. | `[Pro+]` / `[Business]` | [limitations](https://help.opus.pro/api-reference/limitation) |
| 110 | Official SDKs for Node, Python, Go, PHP, Ruby, Java; public OpenAPI spec and `llms.txt`. | API access required | [api](https://www.opus.pro/api) |
| 111 | MCP server with 29 `opusclip_*` tools (submit_project, list_clips, get_transcript, apply_editing_script, create_censor_job, export_clip, create_social_copy_job, schedule_publish, …), OAuth, works in Claude/Cursor/ChatGPT. | `[Pro+]` (free trial included) | [mcp](https://www.opus.pro/mcp) |
| 112 | Zapier app: create projects from a URL, fetch clips/transcripts, trigger on project completion. | `[Pro+]`, capped at 300 credits/month on Pro, unlimited Business | [zapier](https://help.opus.pro/docs/article/zapier-integration) |
| 113 | CMS integration (auto-import from CMS/cloud servers). | `[Business]` | [pricing](https://www.opus.pro/pricing) |
| 114 | Email OTP login. | `[All]` | [pricing](https://www.opus.pro/pricing) |
| 115 | SSO, software licence management, MSA, invoice/ACH billing, custom onboarding, dedicated Slack support. | `[Business]`, sales-gated | [pricing](https://www.opus.pro/pricing) |
| 116 | Industry landing pages and playbooks for agencies, advertisers, churches, e-commerce, live streaming, marketing, media & entertainment, education. | Marketing surface, no distinct feature gating | [agencies](https://www.opus.pro/business/agencies) |
| 117 | Affiliate programme. | `[All]` | [affiliate](https://www.opus.pro/affiliate) |

### 7. Platform, surfaces and adjacent products

| # | Capability | Gating / cost | Source |
|---|---|---|---|
| 118 | Web app at `clip.opus.pro` (dashboard, editor, scheduler). | `[All]` | [dashboard](https://clip.opus.pro/dashboard) |
| 119 | iOS app with a trimmed feature set; no Drive import, no auto-import, no custom clip length, no bulk export, no XML export, no cloud save, no AI enhancements/B-roll, no template editing, no bulk/time-based scheduling. | App Store, paid via Stripe or IAP | [iOS limits](https://help.opus.pro/docs/article/ios-app-feature-limitations) |
| 120 | Android app (Android 12+, US/UK/CA/AU/DE/FR/ES/BR, English only) with clipping, virality score, reframe, animated captions — but **no editor at all**, no scheduling, no templates. | Google Play billing only | [Android limits](https://help.opus.pro/docs/article/android-app-supported-unsupported-features) |
| 121 | Full editing and OpusSearch are desktop-web only; the apps point users to the browser. | `[All]` | [iOS limits](https://help.opus.pro/docs/article/ios-app-feature-limitations) · [OpusSearch docs](https://help.opus.pro/docs/article/opussearch) |
| 122 | Email notifications when a project finishes. | `[All]` configurable | [notifications](https://help.opus.pro/docs/article/email-notification-settings) |
| 123 | Agent Opus, a separate prompt-to-video product: idea or script in, generated video out, with Standard / Standard+ / Premium / Ultra quality modes, voice cloning on Standard tiers, avatars, brand brief, style and aspect-ratio controls. | Separate product, own credit balance (Max plan 1,500 credits/mo) | [Agent Opus FAQ](https://help.opus.pro/agent-opus/article/ao-faq) · [credits](https://help.opus.pro/docs/article/how-are-credits-consumed) |
| 124 | Story Mode inside Agent Opus: 100 % AI-generated footage with a locked art style and "Long Take" morph transitions. | Agent Opus | [story mode](https://help.opus.pro/agent-opus/article/ao-story-mode-faq) |
| 125 | Opus Labs catalogue of experimental tools: AI Expand (outpainting to change aspect ratio, 4–90 s), Motion Studio, Audio to Image Video, Product Ad Studio, Multi-Angle, Product Launch Video plugin, Opus Model Hub. | Early access, per-tool credit price | [labs](https://help.opus.pro/opus-labs/overview) · [AI Expand](https://help.opus.pro/opus-labs/ai-expand) |
| 126 | SOC 2 Type II report published through a Trust Center. | `[All]` | [security](https://help.opus.pro/docs/article/opusclip-data-security-standards) |
| 127 | Data used for model training for individual users; contractually excluded for enterprise. | tier-dependent | [training](https://help.opus.pro/docs/article/opusclip-data-training) |
| 128 | Discord community, Intercom live chat (Pro+), AI chat, priority Slack (Business). | tier-dependent | [pricing](https://www.opus.pro/pricing) |
| 129 | "OpusClip 4.0" release umbrella: Auto-edit, multi-format output (60–90 s highlight, 3–5 min extended cut), Recipes, Viral Hook, Motion Graphics, AI Producer plugin for ChatGPT/Claude. | mixed | [4.0 post](https://www.opus.pro/blog/opusclip-4-0) |

---

## Paid tier gating

Published matrix, captured verbatim in structure (✔ = included, — = absent). Prices are list prices; annual Pro is discounted ~50 % per the credits doc.

| | Free $0 | Starter $15/mo | Pro $29/mo | Business Custom |
|---|---|---|---|---|
| Processing speed | Regular | Faster than Free/Trial | Faster than Starter | Dedicated queue, "most powerful servers" |
| Max local upload | 10 GB | 10 GB | 30 GB | 30 GB |
| Import sources | YouTube, local | + Drive, Vimeo, Zoom, Rumble, StreamYard | + Dropbox, Twitch, Facebook, IG, TikTok, LinkedIn, X, Loom, Riverside, Frame.io, Apple Podcast, Medal.tv, public mp4 | same as Pro |
| Auto import | — | verified YouTube | verified YouTube | + CMS / cloud servers |
| AI clipping signals | spoken words only | + visual, sound, emotion, genre model | same | same |
| Virality score | — | ✔ | ✔ | ✔ |
| Prompt to clip / topics search | — / — | — / — | ✔ / ✔ | ✔ / ✔ |
| Reprompt | — | ✔ | ✔ | ✔ |
| Clip length presets | 0-1,1-3,3-5,5-10,10-15 m | same | same | same |
| Aspect ratios | 9:16 | 9:16 | 9:16, 1:1, 16:9 | 9:16, 1:1, 16:9 |
| Custom reframing / moving-object tracking | — / — | ✔ / — | ✔ / ✔ | ✔ / ✔ |
| Storage | — (3-day expiry) | — (29-day expiry) | 100 GB fixed | Custom / unlimited |
| Brand templates | 1 | 1 | 4 | Custom |
| Custom fonts | — | — | 2 | ✔ |
| Speaker-based caption colours | — | — | — | coming soon |
| Auto censor | — | — | default list | custom list (5 max) |
| Auto emoji + keyword highlight | ✔ | ✔ | ✔ | ✔ |
| Animated caption templates | ✔ (watermarked) | ✔ | ✔ | ✔ |
| Watermark-free export | — | ✔ | ✔ | ✔ |
| MP4 export window / res | 3 days, ≤1080p | 30 days, max available | unlimited | unlimited |
| Bulk export | — | — | ✔ | ✔ |
| 4K download / 4K schedule+post | — / — | — / — | ✔ / — | ✔ / ✔ |
| Premiere & Resolve XML | — | — | ✔ | ✔ |
| B-roll AI image / stock | — | 3/mo each | 50/day + unlimited stock | 50/day + unlimited |
| AI video B-roll | — | — | ✔ | ✔ |
| AI voice-over | — | 20/day | 20/day | 20/day |
| Speech enhancement | — | — | 10/day | 10/day |
| Bad-take removal | — | — | ✔ | ✔ |
| Eye-contact correction | — | — | ✔ | ✔ |
| Transitions / music / asset upload / intro-outro | — | — | ✔ | ✔ |
| Text overlay / upscale | — / — | ✔ / ✔ | ✔ / ✔ | ✔ / ✔ |
| Video dubbing | — | — | ✔ (10 cr/min) | ✔ (10 cr/min) |
| AI SFX | — | — | ✔ | ✔ |
| Post to YT/TikTok/IG | — | ✔ | ✔ | ✔ |
| Post to FB/LinkedIn/X/Pinterest/Threads/Bluesky | — | — | ✔ | ✔ |
| Scheduler / bulk scheduler / multi-profile | — / — / — | — / — / — | ✔ / ✔ / ✔ | ✔ / ✔ / ✔ |
| Shareable project links | ✔ | ✔ | ✔ | ✔ |
| Team workspace | — | — | ✔ (2/pack, max 4) | ✔ (unlimited) |
| Sub-teams / permissions | — | — | — / — | ✔ / coming soon |
| Collections | — | — | ✔ | ✔ |
| Clip analytics / trend analysis | — / — | — / — | coming soon / — | ✔ / ✔ |
| SSO / SLM / MSA / invoice+ACH / onboarding | — | — | — | ✔ |
| API / scheduler API / MCP / CMS | — | — | ✔ / ✔ / ✔ / — | ✔ / ✔ / ✔ / ✔ |
| Zapier | — | — | ✔ (300 cr/mo) | ✔ (unlimited) |
| Support | Discord + AI | Discord + AI | + Intercom | dedicated Slack, priority |

Source for the whole matrix: [opus.pro/pricing](https://www.opus.pro/pricing). Corroborating help pages for the more surprising rows: [virality score](https://help.opus.pro/docs/article/virality-score), [auto censor](https://help.opus.pro/docs/article/how-to-censor-curse-words), [bulk download](https://help.opus.pro/docs/article/bulk-download), [4K](https://help.opus.pro/docs/article/download-and-post-in-4k), [team](https://help.opus.pro/docs/article/6219255-team-management), [cloud storage](https://help.opus.pro/docs/article/cloud-storage), [dubbing](https://help.opus.pro/docs/article/video-dubbing), [auto zoom](https://www.opus.pro/tools/zoom-in-effect), [api](https://www.opus.pro/api).

### Credit model

- 1 credit = 1 minute of **source video imported**, rounded per whole minute (sub-minute rounds up), charged at submit time whether or not you use the clips. A 30-minute upload costs 30 credits. [credits](https://help.opus.pro/docs/article/how-are-credits-consumed)
- Monthly allowances: Free 60, Starter 150, Pro 300 (multi-pack allowed), Max 1,500 (Agent Opus only, spendable here), Business custom. [credits](https://help.opus.pro/docs/article/how-are-credits-consumed)
- Add-on charges: X posts 3 credits per clip per account, dubbing 10/min, Auto SFX 7/min, viral hook 20 for up to 10 clips (2 in-editor), auto color 1, motion graphics 6/min, upscale base + 11 per 10 s for 4K, thumbnail job 7, API project minimum 10. [credits](https://help.opus.pro/docs/article/how-are-credits-consumed) · [sfx](https://help.opus.pro/docs/article/auto-sfx) · [hook](https://help.opus.pro/docs/article/add-a-viral-hook) · [upscale](https://help.opus.pro/docs/article/upscale-a-video) · [thumbnail API](https://help.opus.pro/api-reference/endpoints/generative-jobs/create-thumbnail-job) · [limitations](https://help.opus.pro/api-reference/limitation)
- Credits roll over one extra month on monthly plans, 12 months on annual; they die with cancellation. [credits](https://help.opus.pro/docs/article/how-are-credits-consumed)
- Failed or deleted scheduled X posts auto-refund the frozen credits. [credits](https://help.opus.pro/docs/article/how-are-credits-consumed)

### Free tier, trial and downgrade behaviour

- Free plan: 60 credits/month, watermarked exports, 1080p ceiling, 3-day file expiry, 9:16 only, one brand template, no virality score, no editor. [pricing](https://www.opus.pro/pricing) · [plans](https://help.opus.pro/docs/article/plans-and-credits)
- New accounts get a 7-day Pro trial with 90 credits (the site also advertises "90 credits for free"); the trial is Pro-featured but excludes 18 named features including watermark removal, autosave, bulk download, censor, scheduling, teams, intro/outro, speech enhancement, analytics, transitions, music, thumbnails, 4K and credit refunds. [home FAQ](https://www.opus.pro/) · [trial exclusions](https://help.opus.pro/docs/article/features-not-included-free-trial)
- Downgrading wipes uploaded assets immediately and strips saved projects out of storage. [storage](https://help.opus.pro/docs/article/cloud-storage)

---

## Known weaknesses from reviews

Primary-source admissions first, then third-party.

1. **Clip selection misses context, punchlines and the sentence that made the segment work.** Reviewers describe using it "for ideas" while it skips the actual good part; the article also reports that low-scoring clips often outperformed the high scorers, i.e. the virality score is not predictive. [eesel review roundup](https://www.eesel.ai/blog/opusclip-reviews) · [original Reddit thread](https://www.reddit.com/r/podcasting/comments/14zzbpk/how_do_yall_feel_about_opus_clips/)
2. **Cuts land mid-sentence / mid-thought.** Third-party review: the AI "sometimes cuts off a thought mid-sentence, misses context that makes a segment meaningful, or clips a joke" before the punchline. [creatorstackclub](https://www.creatorstackclub.com/software/opus-clip) *(search-snippet level, page is client-rendered)*
3. **ClipAnything, the flagship model, is still beta.** OpusClip's own doc says the model "may not return results for videos that lack audio or have minimal visual activity, such as static scenes", and support for silent footage is only "planned". [OpusClip doc](https://help.opus.pro/docs/article/clipanything-qa-10)
4. **Caption accuracy and editability.** Captions are described as frequently wrong and painful to fix; when the source already has burned-in subtitles, OpusClip stacks its own on top instead of detecting them. [eesel](https://www.eesel.ai/blog/opusclip-reviews)
5. **AI B-roll is buggy and can insert random static images instead of usable footage.** [eesel](https://www.eesel.ai/blog/opusclip-reviews) · [trymesha](https://trymesha.com/blog/an-honest-review-of-opus-clip-ai-and-recommended-alternatives/)
6. **Scheduler reliability.** Posts that never go through, accounts silently disconnecting — many users fall back to downloading and posting by hand, which defeats the "autopilot" pitch. [eesel](https://www.eesel.ai/blog/opusclip-reviews)
7. **Credit burn is the pricing model, not a bug.** Billing is per input minute, so a failed or unusable project costs the same as a good one; a 45-minute podcast costs 45 credits before you know whether any clip is usable. [r/subscut](https://www.reddit.com/r/subscut/comments/1tqx9rd/best_opusclip_alternatives_in_2026_an_honest/) · [credits doc](https://help.opus.pro/docs/article/how-are-credits-consumed)
8. **Hidden refund mechanics.** The refund-on-delete path exists but is buried; deleting a project normally does not return credits. [ssemble review quoting Trustpilot](https://www.ssemble.com/blog/opus-clip-review-2026) · [project refund doc](https://help.opus.pro/docs/article/can-i-reprocess-a-project)
9. **Processing failures and slowness** are the top complaint cluster in 1-star Trustpilot reviews ("videos hang for hours, and often never finish"). [ssemble's Trustpilot analysis](https://www.ssemble.com/blog/opus-clip-review-2026) · [Trustpilot](https://www.trustpilot.com/review/opus.pro)
10. **Cancellation friction and billing after cancel**, reported repeatedly at 1-star level. [ssemble](https://www.ssemble.com/blog/opus-clip-review-2026) · [eesel](https://www.eesel.ai/blog/opusclip-reviews)
11. **Projects vanish on downgrade or lapse**, including work made with credits already paid for; only Pro keeps storage at all. [storage doc](https://help.opus.pro/docs/article/cloud-storage) · [plans doc](https://help.opus.pro/docs/article/plans-and-credits)
12. **Free tier is demo-grade**: watermark, 1080p, 3-day expiry, 9:16 only, no editor, no score. [pricing](https://www.opus.pro/pricing)
13. **Filler-word removal is English-only** and regressed during a model migration, by OpusClip's own admission. [OpusClip doc](https://help.opus.pro/docs/article/filler-word-recognition)
14. **Subtitle translation is one-way** — only into English — while dubbing covers 25 languages; and dubbing uses a single cloned voice for every speaker. [translate](https://help.opus.pro/docs/article/select-subtitle-language) · [dubbing](https://help.opus.pro/docs/article/video-dubbing)
15. **Editing is thin below Pro.** No timeline editor on Free, no custom fonts/transitions/music/assets/bad-take removal until Pro, no editor at all in the Android app, and bulk export is Pro-only. [pricing](https://www.opus.pro/pricing) · [Android](https://help.opus.pro/docs/article/android-app-supported-unsupported-features)
16. **Output derives from a crop.** 1080p source in 9:16 yields 608×1080, not 1080×1920, so vertical output is inherently soft unless the source is 4K. [OpusClip doc](https://help.opus.pro/docs/article/get-clips-faq-2)
17. **API is capped and gated**: 900 credits/month even on Pro, hard 403 at cap, 4 concurrent jobs, 30 req/min. [limitations](https://help.opus.pro/api-reference/limitation)
18. **Team ceiling of 4 seats** on Pro, and permissions are still "coming soon" even on Business. [team](https://help.opus.pro/docs/article/6219255-team-management) · [pricing](https://www.opus.pro/pricing)
19. **Search/analysis at library scale (OpusSearch) is still waitlist**, so the "reuse your archive" story is not generally available. [OpusSearch](https://www.opus.pro/opussearch)
20. **Third-party review credibility caveat:** most comparison reviews are written by competitors (ssemble, eesel, trymesha, riverside) and repeat each other's Trustpilot quotes; treat the star breakdown as directional, not audited. [ssemble](https://www.ssemble.com/blog/opus-clip-review-2026)

### Design surface this suggests for an open source alternative

Ordered by leverage: deterministic cut boundaries snapped to sentence/breath edges with a visible confidence; a score that is explainable and user-correctable; transcript-first caption editing with speaker diarisation by default; push-based reframe review instead of blind auto-crop; retry/refund semantics attached to the render job rather than the project; local-first storage that does not evaporate; a full editor on mobile; and per-output-minute or per-render pricing rather than per-input-minute.

---

## Open questions / not verifiable

- **Business vs Enterprise** are used interchangeably across pricing and help pages; the real boundary between the self-serve Business tier and true enterprise contracts (seat floors, API contract size, storage) is not published. `contact sales` only.
- **Business price** is never shown. The checkout links on the pricing page point at Starter and Pro only.
- **Max plan** is documented in the credits table (1,500 credits, Agent Opus only) but has no public price or feature table.
- **Clip analytics** is listed for Business and "coming soon" for Pro; no doc page describes what it actually measures or where the data comes from.
- **Sub-teams** and **member permissions** are listed but undocumented (permissions are "coming soon").
- **SSO / SLM / MSA** are matrix checkmarks with no setup docs, no IdP list, no SLA text.
- **`opusclip.net`** — a second brand domain — was not fetched; the `.pro` site appears to be canonical, and `.net` may serve an older or localised build. Worth a follow-up diff.
- **Opus Labs gating** is opaque: the docs say products appear "if available to your account" and may be limited to a beta group; no plan mapping published.
- **Agent Opus** is a separate product with separate credits; whether Max credits really cross-spend into OpusClip as the credits table implies is untested.
- **Model identity** is undisclosed. The "ClipAnything-1.0" benchmark table is self-reported, and one third-party review claims GPT-4 underneath without a citation.
- **Exact caption accuracy** is quoted as 97 % (JSON-LD FAQ), 99 % (on-page FAQ) and "97 %+" (Android doc) — no methodology.
- **Watermark**: the trials doc says trial exports are watermarked while the pricing matrix shows watermark-free on Starter; the trial-exclusion list is the more specific document, so treat "trial has no watermark removal" as current and the matrix as compressed.
- **Chrome extension**: repeatedly claimed in roundups, but no extension listing or store page was confirmed in this pass.
- **Zoom integration** appears in the source list as both "Zoom" and "Zoom Clips" but no article explains how a Zoom link is authenticated or how long a private recording survives.
- **Trustpilot / G2 / Capterra** block automated fetch (403 / Cloudflare), so their star distributions and review bodies here come from secondary citations, not the live pages.
- **Trial length conflict**: the site says 7 days, one review claims there is no trial at all; the 7-day claim is on the vendor's own page and is more likely current.
- **Free-tier "credit" vs "minute"** wording differs between the homepage FAQ (credits) and the help centre (processing minutes); same 60-unit budget either way.
