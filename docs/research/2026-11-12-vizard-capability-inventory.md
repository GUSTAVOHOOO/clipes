# Vizard.ai — capability inventory and gating map

**Date:** 2026-11-12
**Subject:** Vizard.ai (Vizard, Corp.), AI clipping SaaS — long video → captioned vertical clips, in-browser editor, direct social publishing.
**Purpose:** feature-parity input for an open-source alternative. Record what exists, what it costs, and where it breaks.

**Method.** Primary sources first: vizard.ai marketing pages, `docs.vizard.ai` (public API reference), `help.vizard.ai` (Intercom help center), vizard.ai/blog product announcements, App Store / Google Play listings, mcp.agent.vizard.ai docs, terms of service. Prices are rendered client-side on vizard.ai/pricing, so the dollar values below come from third-party page reads dated Oct–Nov 2026 and are labelled as such. Third-party hands-on tests are used only for gaps and are labelled `[third-party]`.

**Legend**
- `[inferred]` — my read, not stated by Vizard.
- `[third-party]` — comes from a review/test, not Vizard.
- `[beta]` / `[sales-gated]` / `[waitlisted]` — marked on the line.

**Structural note that matters for parity:** Vizard now ships two distinct products on one account — **AI Studio** (the clipper: upload → AI clips → editor → publish) and **Vizard Agent** (brief → finished video, chat/MCP/API driven). Clipping features and Agent features are gated separately but bill to the same credit pool.

---

## Feature inventory

### Ingest

| # | What it does | Gate | Source |
|---|---|---|---|
| 1 | Accepts local uploads of video and audio files; documented types are MP4, MOV, 3GP, AVI, MP3, WAV, M4A. | All plans | [vizard.ai/tools/ai-video-editor](https://vizard.ai/tools/ai-video-editor) |
| 2 | Accepts pasted source URLs instead of files; the API enumerates 13 source types: direct file, YouTube, Google Drive, Vimeo, StreamYard, TikTok, Twitter/X, Twitch, Loom, Facebook, LinkedIn, Dropbox, Instagram. | All plans | [docs.vizard.ai/docs/basic](https://docs.vizard.ai/docs/basic) |
| 3 | Free-plan upload ceiling is 60 minutes and 1 GB per file. | Free only | [vizard.ai/pricing](https://vizard.ai/pricing) |
| 4 | Paid upload ceiling is 600 minutes (10 h) and 30 GB per file. | Creator, Business | [vizard.ai/pricing](https://vizard.ai/pricing) |
| 5 | API submissions cap at 600 minutes and 10 GB, and are limited to 4K. | Paid (API is paid-only) | [docs.vizard.ai/docs/pricing](https://docs.vizard.ai/docs/pricing) |
| 6 | Accepts upload quality up to 1080p on free; 4K on paid. | Free 1080p / paid 4K | [vizard.ai/pricing](https://vizard.ai/pricing) |
| 7 | Supports spoken-language tagging with `auto` detection or ISO 639-1 codes. | All plans | [docs.vizard.ai/docs/basic](https://docs.vizard.ai/docs/basic) |
| 8 | Transcribes 36 listed languages, including Cantonese (`yue`), Mandarin variants and Tamil. | All plans | [docs.vizard.ai/docs/supported-languages](https://docs.vizard.ai/docs/supported-languages) |
| 9 | Imports a subtitle file onto an uploaded video instead of relying on ASR. | All plans | [help: add subtitle file](https://help.vizard.ai/en/articles/13568601-how-to-add-subtitle-file-to-your-video) |
| 10 | Refuses to run AI clipping on videos shorter than 3 minutes, and warns results degrade under ~15 minutes. | All plans | [help: why can't I use AI clipping](https://help.vizard.ai/en/articles/8767578-why-can-t-i-use-ai-clipping) |
| 11 | "Edit mode" (no clip search) rejects videos of 3 minutes or longer with API code 4005. | Paid API | [docs.vizard.ai/docs/submit-a-short-video-for-editing](https://docs.vizard.ai/docs/submit-a-short-video-for-editing) |
| 12 | Dashboard offers "import from Zoom" and in-browser recording alongside link and file upload. | All plans `[third-party]` | [creatorintelhq review](https://creatorintelhq.com/reviews/vizard-ai-review/) |
| 13 | Lets an unauthenticated visitor paste a YouTube link and download a clip; account only extends retention (24 h → 3 days). | Free, no signup `[third-party]` | [creatorintelhq review](https://creatorintelhq.com/reviews/vizard-ai-review/) |
| 14 | Agent ingests briefs, scripts, articles, product pages, images, websites and files — not just footage. | Agent, paid models | [Agent launch post](https://vizard.ai/blog/the-next-shift-in-ai-is-coming-to-video) |
| 15 | Agent accepts public links anywhere; local files only via Claude Code, Codex or OpenCode. | Agent | [mcp.agent.vizard.ai/docs](https://mcp.agent.vizard.ai/docs) |

### Analysis and clip selection

| # | What it does | Gate | Source |
|---|---|---|---|
| 16 | Scans the transcript for "important moments", cuts them, and assembles clips without user selection. | All plans | [help: how does Vizard work](https://help.vizard.ai/en/articles/8768631-how-does-vizard-work) |
| 17 | Spark model analyses visuals (objects, scenes, characters), audio (speech, music, SFX) and sentiment, so dialogue-free footage can be clipped. | All plans `[beta]`, access applied for via support | [help: what is Spark 1.0](https://help.vizard.ai/en/articles/9905409-what-is-spark-1-0) |
| 18 | Free-text prompt steers selection ("Find where Sam talks about GPT-5"); if nothing matches strictly, zero clips are returned. | All plans | [docs.vizard.ai/docs/advanced](https://docs.vizard.ai/docs/advanced) |
| 19 | A project tolerates up to 10 re-prompts; re-prompting does not consume extra credits. | All plans `[beta]` | [help: what is Spark 1.0](https://help.vizard.ai/en/articles/9905409-what-is-spark-1-0) |
| 20 | Clip-length target selectable as auto, <30 s, 30–60 s, 60–90 s, or 90 s–3 min; auto cannot be combined with others. | All plans | [docs.vizard.ai/docs/basic](https://docs.vizard.ai/docs/basic) |
| 21 | `maxClipNumber` caps returns at 1–100, truncating by viral score rather than choosing differently. | Paid API | [docs.vizard.ai/docs/advanced](https://docs.vizard.ai/docs/advanced) |
| 22 | Every clip carries a 0–10 viral score and a one-sentence `viralReason`, returned sorted by score. | All plans (API field) | [docs.vizard.ai/docs/retrieve-video-clips](https://docs.vizard.ai/docs/retrieve-video-clips) |
| 23 | Score is rendered on the clip card in the product UI. | All plans `[third-party]` | [lessonbench hands-on](https://lessonbench.com/guides/vizard-vs-opus-clip-vs-submagic) |
| 24 | Free plan exposes a "minimum viral score" threshold to filter what gets auto-posted. | Free + paid | [help: auto-schedule](https://help.vizard.ai/en/articles/10848181-auto-schedule-post-ai-clips) |
| 25 | Selectable clipping model `clip_v1` (default, more clips) or `clip_v2` (fewer, more complete, 1.25× credits). | Paid API | [docs.vizard.ai/docs/advanced](https://docs.vizard.ai/docs/advanced) |
| 26 | v2 finds each clip's natural ending before considering length, stitches across filler/tangents to reach it, then length-calibrates. | All plans (v2) | [blog: cut off mid-sentence](https://vizard.ai/blog/why-clips-used-to-get-cut-off-mid-sentence-and-how-we-fixed-it) |
| 27 | v2 runs a hard completeness gate — a clip ending mid-sentence is rejected, not down-scored. | All plans (v2) | [blog: cut off mid-sentence](https://vizard.ai/blog/why-clips-used-to-get-cut-off-mid-sentence-and-how-we-fixed-it) |
| 28 | v2 scores four axes (opening hook, flow/pacing, insight freshness, spread potential) with a written reason each. | All plans (v2) | [blog: cut off mid-sentence](https://vizard.ai/blog/why-clips-used-to-get-cut-off-mid-sentence-and-how-we-fixed-it) |
| 29 | v2 ranks clips against each other inside a batch and drops near-duplicates. | All plans (v2) | [blog: cut off mid-sentence](https://vizard.ai/blog/why-clips-used-to-get-cut-off-mid-sentence-and-how-we-fixed-it) |
| 30 | A minority of standout clips get one of 20 "spread mechanism" tags; most get none. | All plans (v2) | [blog: cut off mid-sentence](https://vizard.ai/blog/why-clips-used-to-get-cut-off-mid-sentence-and-how-we-fixed-it) |
| 31 | Aspect ratio selectable per request: 9:16 (default), 1:1, 4:5, 16:9. | All plans | [docs.vizard.ai/docs/advanced](https://docs.vizard.ai/docs/advanced) |
| 32 | Auto reframe re-crops a landscape frame to the chosen ratio around the subject. | Free included | [vizard.ai/pricing](https://vizard.ai/pricing) |
| 33 | Face tracking follows a moving subject through the crop. | Paid only | [vizard.ai/pricing](https://vizard.ai/pricing) |
| 34 | Speaker diarization segments speakers and supports "speaker spotlight" multi-pane layouts. | Paid `[inferred]` (page-level, no plan note) | [vizard.ai/tools/ai-video-editor](https://vizard.ai/tools/ai-video-editor) |
| 35 | "Speaker auto-focus" keeps the detected speaker centred regardless of output ratio. | Paid `[inferred]` | [vizard.ai/tools/ai-video-editor](https://vizard.ai/tools/ai-video-editor) |
| 36 | Face detection is signalled by face size, lip/audio speech activity and distance from frame centre — documented, with known failure cases. | All plans | [help: wrong person framed](https://help.vizard.ai/en/articles/14671161-why-does-the-ai-frame-the-wrong-person-in-multi-person-videos) |
| 37 | Choosing a layout template before generation biases how the AI crops (e.g. screen-share + speaker, two-person interview). | Paid (custom templates) | [help: wrong person framed](https://help.vizard.ai/en/articles/14671161-why-does-the-ai-frame-the-wrong-person-in-multi-person-videos) |
| 38 | Auto-highlights important spoken words as styled emphasis in the subtitles. | All plans | [vizard.ai/pricing](https://vizard.ai/pricing) |
| 39 | Auto-inserts emoji into subtitles when enabled. | All plans | [vizard.ai/pricing](https://vizard.ai/pricing) |
| 40 | Auto-inserts B-roll over talking points when enabled. | All plans | [vizard.ai/pricing](https://vizard.ai/pricing) |
| 41 | Strips silent gaps and "um/uh" fillers; off by default because over-removal reads as choppy. | All plans | [docs.vizard.ai/docs/advanced](https://docs.vizard.ai/docs/advanced) |
| 42 | Detects and drops repeated bad takes, keeping the best one. | All plans | [vizard.ai/tools/ai-video-editor](https://vizard.ai/tools/ai-video-editor) |
| 43 | Auto Censorship detects profanity and mutes or beeps it, with an editable word library per project. | All plans `[inferred]` (announced feature, no plan note) | [blog: auto censorship](https://vizard.ai/blog/never-let-a-slip-ruin-your-clip-introducing-auto-censorship-on-vizard) |
| 44 | Writes a headline/hook overlay into the first 3 seconds of each clip, on by default. | All plans | [docs.vizard.ai/docs/advanced](https://docs.vizard.ai/docs/advanced) |
| 45 | Generates a per-clip title from clip content, returned in the API. | All plans | [docs.vizard.ai/docs/retrieve-video-clips](https://docs.vizard.ai/docs/retrieve-video-clips) |
| 46 | Caption translation into 100+ languages (130+ claimed on the editor page). | Paid only | [vizard.ai/pricing](https://vizard.ai/pricing) · [video-editor page](https://vizard.ai/tools/video-editor) |
| 47 | Dubbing: translates and replaces the spoken audio, claimed on the editor page. | Paid `[inferred]` | [vizard.ai/tools/ai-video-editor](https://vizard.ai/tools/ai-video-editor) |
| 48 | AI Edit re-cuts a talking head with transitions, B-roll and zooms from a chosen style; 9:16 only, 15 s–3 min, 0.5 credits/s. | Paid | [help: what is AI Edit](https://help.vizard.ai/en/articles/16658532-what-is-ai-edit) |
| 49 | AI Edit is explicitly beta with no custom styles, no bulk, no scheduling, no API. | Paid `[beta]` | [help: what is AI Edit](https://help.vizard.ai/en/articles/16658532-what-is-ai-edit) |
| 50 | AI Enhance super-resolves the export at 1080p / 2K / 4K for 1 / 1.5 / 2.5 credits per second, min 1 credit. | Paid only | [help: AI Enhance](https://help.vizard.ai/en/articles/16317508-how-to-enhance-video-quality-with-ai-enhance) |
| 51 | Agent takes a plain-language brief plus materials, makes creative decisions, asks clarifying questions and returns a finished video for review. | Agent, paid models | [Agent launch post](https://vizard.ai/blog/the-next-shift-in-ai-is-coming-to-video) |
| 52 | Agent supports revision rounds on the same project rather than restarts. | Agent | [mcp.agent.vizard.ai/docs](https://mcp.agent.vizard.ai/docs) |

### Editing

| # | What it does | Gate | Source |
|---|---|---|---|
| 53 | Deleting text in the transcript deletes the matching footage (text-based editing). | All plans | [vizard.ai home](https://vizard.ai) |
| 54 | Accepts edit instructions in natural language ("drop the second sentence") instead of timeline operations. | All plans `[inferred]` | [vizard.ai/tools/ai-video-editor](https://vizard.ai/tools/ai-video-editor) |
| 55 | Timeline editor supports frame/second-level trimming alongside the text view. | All plans | [vizard.ai home](https://vizard.ai) |
| 56 | Manual clip creation by selecting a transcript range in the source video's editor. | All plans | [help: create clips manually](https://help.vizard.ai/en/articles/8777511-how-to-create-short-clips-manually-from-long-video) |
| 57 | Extending a clip means reverting struck-through text, or re-selecting in the original editor. | All plans | [help: extend clips](https://help.vizard.ai/en/articles/8984381-how-to-extend-and-add-more-content-to-ai-generated-clips) |
| 58 | Scenes can be inserted from the timeline or transcript: intros, outros, B-roll, local files, Brand Kit assets. | All plans (Brand Kit assets need paid) | [help: add scenes](https://help.vizard.ai/en/articles/15587008-add-scenes-in-editor) |
| 59 | A split scene can carry its own crop, so framing can change mid-clip per speaker. | All plans | [help: wrong person framed](https://help.vizard.ai/en/articles/14671161-why-does-the-ai-frame-the-wrong-person-in-multi-person-videos) |
| 60 | Subtitle lines can be merged, split at a word, or added blank. | All plans | [help: subtitle lines](https://help.vizard.ai/en/articles/15587012-how-to-manage-subtitle-lines-merge-split-and-add) |
| 61 | Cover page / thumbnail composition inside the editor. | All plans | [help center editor index](https://help.vizard.ai/en/collections/8474224-editor) |
| 62 | Custom outros attachable to clips. | Paid only | [vizard.ai/pricing](https://vizard.ai/pricing) |
| 63 | Template picker applies a full styling preset; unmatched layouts fall back to a sensible default rather than failing. | Paid for custom; default style free | [help: clip preferences](https://help.vizard.ai/en/articles/9188600-what-are-clip-preferences) |
| 64 | Brand templates are reusable workspace-level presets. | Business only | [vizard.ai/pricing](https://vizard.ai/pricing) |
| 65 | Brand Kit stores logos, images, videos, audio, fonts and outros as reusable assets. | Business only | [help: manage storage](https://help.vizard.ai/en/articles/15966025-how-to-manage-storage-in-the-vizard-workspace) |
| 66 | Custom font upload. | Business only | [vizard.ai/pricing](https://vizard.ai/pricing) |
| 67 | One-click aspect-ratio change after the fact. | All plans | [vizard.ai home](https://vizard.ai) |
| 68 | Subtitles can be switched off entirely for a clean export. | All plans | [help: remove subtitles](https://help.vizard.ai/en/articles/8984398-how-to-remove-subtitles) |
| 69 | Editor project can be exported with AI Enhance applied without altering the source timeline. | Paid | [help: AI Enhance](https://help.vizard.ai/en/articles/16317508-how-to-enhance-video-quality-with-ai-enhance) |
| 70 | Template `templateId` can be passed via API to control subtitle font/size/colour, headline, logo, backgrounds and transitions. | Paid API + paid template | [docs.vizard.ai/docs/advanced](https://docs.vizard.ai/docs/advanced) |

### Captions and styling

| # | What it does | Gate | Source |
|---|---|---|---|
| 71 | Auto-generates word-timed animated subtitles by default on every project. | All plans | [vizard.ai/pricing](https://vizard.ai/pricing) |
| 72 | Subtitle appearance is driven by the selected template (font, weight, colour, position) rather than free-form controls. | All plans (default template) | [docs.vizard.ai/docs/advanced](https://docs.vizard.ai/docs/advanced) |
| 73 | Emphasis styling is auto-applied to detected keywords when highlighting is on. | All plans | [docs.vizard.ai/docs/advanced](https://docs.vizard.ai/docs/advanced) |
| 74 | Emoji can be toggled pre-upload or afterwards in subtitle settings. | All plans | [help: turn off emojis](https://help.vizard.ai/en/articles/8984380-how-to-turn-off-emojis-for-my-ai-clips) |
| 75 | Individual emoji can be swapped in the subtitle inspector. | All plans | [help: edit emojis](https://help.vizard.ai/en/articles/8984609-how-to-edit-emojis-in-the-subtitle) |
| 76 | Headline overlay timing/style is template-controlled; `headlineSwitch` is ignored if the template disables headlines. | All plans | [docs.vizard.ai/docs/submit-a-short-video-for-editing](https://docs.vizard.ai/docs/submit-a-short-video-for-editing) |
| 77 | Transcript downloads as TXT on free, TXT + SRT on paid. | TXT free / SRT paid | [vizard.ai/pricing](https://vizard.ai/pricing) |
| 78 | Subtitle translation is a separate paid entitlement, not included on free. | Paid only | [vizard.ai/pricing](https://vizard.ai/pricing) |
| 79 | Captions are burned into the rendered file rather than delivered as a sidecar by default. | All plans `[third-party]` | [creatorintelhq review](https://creatorintelhq.com/reviews/vizard-ai-review/) |

### Publishing

| # | What it does | Gate | Source |
|---|---|---|---|
| 80 | Connects TikTok, YouTube, LinkedIn, X, Instagram and Facebook Pages per workspace. | Free: TikTok only; Creator 6; Business 20 | [help: connect social accounts](https://help.vizard.ai/en/articles/10367893-how-to-connect-your-social-media-accounts) |
| 81 | Publishes a rendered clip directly to a connected account, immediately or at a timestamp. | Paid (scheduling); posting needs connected account | [docs.vizard.ai/docs/publish-clips-to-social-media](https://docs.vizard.ai/docs/publish-clips-to-social-media) |
| 82 | Auto-generates post copy and hashtags at publish time unless the user supplies text. | Paid | [docs.vizard.ai/docs/publish-clips-to-social-media](https://docs.vizard.ai/docs/publish-clips-to-social-media) |
| 83 | Generates platform-styled captions with selectable tone (neutral/interesting/catchy/serious/question) and voice (first/third person). | Paid API | [docs.vizard.ai/docs/generate-ai-social-caption](https://docs.vizard.ai/docs/generate-ai-social-caption) |
| 84 | Saves a "Default Prompt" so every future caption follows a fixed brand voice; regenerate per platform or across all. | Paid | [help: post styles](https://help.vizard.ai/en/articles/14778410-understanding-post-style-preferences-regenerations) |
| 85 | Auto-schedule from the clip-generation screen: min viral score, posts/day, day pattern, start date, time window. | All plans (needs connected account) | [help: auto-schedule](https://help.vizard.ai/en/articles/10848181-auto-schedule-post-ai-clips) |
| 86 | Auto-schedule caps at 10 clips/day and reports "no social-ready clips found" when quality is too low. | All plans | [help: auto-schedule](https://help.vizard.ai/en/articles/10848181-auto-schedule-post-ai-clips) |
| 87 | Calendar view allows dragging scheduled posts to new dates after the fact. | Paid | [help: auto-schedule](https://help.vizard.ai/en/articles/10848181-auto-schedule-post-ai-clips) |
| 88 | Per-platform hard limits are documented and surfaced to the user (TikTok 2/min; Instagram 50 Reels/24 h; Facebook 25/Page/24 h; LinkedIn 150/day; X 280 chars, 100 posts/day). | All plans | [help: posting limits](https://help.vizard.ai/en/articles/14631679-posting-limits-best-practices) |
| 89 | YouTube posts accept a 100-character title, AI-written if empty. | Paid | [docs.vizard.ai/docs/publish-clips-to-social-media](https://docs.vizard.ai/docs/publish-clips-to-social-media) |
| 90 | Custom thumbnails are supported on TikTok, Instagram, Facebook and LinkedIn, and unsupported on YouTube and X. | All plans | [help: posting limits](https://help.vizard.ai/en/articles/14631679-posting-limits-best-practices) |
| 91 | Saves exports to the user's Google Drive as MP4/TXT/SRT/MP3. | Team/Business only | [help: export to Google Drive](https://help.vizard.ai/en/articles/11547917-exported-to-google-drive-directly) |
| 92 | X posts whose text contains a URL are surcharged 10 credits, charged at publish time. | Paid | [docs.vizard.ai/docs/publish-clips-to-social-media](https://docs.vizard.ai/docs/publish-clips-to-social-media) |
| 93 | Exports MP4 at 720p on free, up to 4K on paid. | 720p free / 1080p–4K paid | [vizard.ai/pricing](https://vizard.ai/pricing) |
| 94 | Export length is capped at 10 minutes on free, unlimited on paid. | Free cap / paid unlimited | [vizard.ai/pricing](https://vizard.ai/pricing) |
| 95 | Free exports carry a burned-in Vizard watermark; paid removes it. | Watermark free / removed paid | [vizard.ai/pricing](https://vizard.ai/pricing) |
| 96 | Share links can be set to anyone-with-link or invited-people-only per video. | Link settings exposed on all; project sharing Business | [help: manage view access](https://help.vizard.ai/en/articles/9629133-how-to-manage-the-view-access-of-your-exported-videos) |
| 97 | Shares whole projects with outside viewers (clients, contractors). | Business only | [vizard.ai/pricing](https://vizard.ai/pricing) |

### Collaboration and business

| # | What it does | Gate | Source |
|---|---|---|---|
| 98 | Two workspace types: private (personal) and shared (team). | Private free/Creator; shared Business | [vizard.ai/pricing](https://vizard.ai/pricing) |
| 99 | Members are invited in bulk by comma/space-separated email, desktop browser only. | Business | [help: invite members](https://help.vizard.ai/en/articles/9655509-how-to-invite-members-to-your-workspace) |
| 100 | Seats bill on top of plan price ($5/mo on yearly, $10/mo monthly). | Business add-on | [vizard.ai/pricing](https://vizard.ai/pricing) · [crayo price read](https://crayo.ai/compare/crayo-vs-vizard) |
| 101 | Editors in Business workspaces cannot see personal "My Assets"; they work from Brand Kit and Brand Templates instead. | Business | [help: manage storage](https://help.vizard.ai/en/articles/15966025-how-to-manage-storage-in-the-vizard-workspace) |
| 102 | Storage quota: 1 GB free, 100 GB Creator, unlimited Business; temporary projects expire in 3 days (free) or 28 days (Creator over quota). | Tiered | [help: manage storage](https://help.vizard.ai/en/articles/15966025-how-to-manage-storage-in-the-vizard-workspace) |
| 103 | Projects must be explicitly "saved" to permanent storage; otherwise they expire. | All plans | [help: manage storage](https://help.vizard.ai/en/articles/15966025-how-to-manage-storage-in-the-vizard-workspace) |
| 104 | Live chat support on every plan; priority support on paid. | Live chat all / priority paid | [vizard.ai/pricing](https://vizard.ai/pricing) |
| 105 | Custom plan with dedicated account manager sold through sales. | `[sales-gated]` | [vizard.ai/pricing](https://vizard.ai/pricing) |
| 106 | API access is bundled into paid plans rather than sold separately. | Creator, Business | [docs.vizard.ai/docs/pricing](https://docs.vizard.ai/docs/pricing) |

### Platform and integrations

| # | What it does | Gate | Source |
|---|---|---|---|
| 107 | REST clipping API: `project/create`, `project/query`, `project/delete`. | Paid API key | [docs.vizard.ai/docs/quickstart](https://docs.vizard.ai/docs/quickstart) |
| 108 | API also exposes an edit mode for short videos, and a publish + caption-generation surface. | Paid API | [docs index](https://docs.vizard.ai/llms.txt) |
| 109 | Results are retrieved by polling (~30 s recommended) or by a workspace-configured webhook that POSTs clip metadata. | Paid API | [docs.vizard.ai/docs/quickstart](https://docs.vizard.ai/docs/quickstart) |
| 110 | Clip download URLs expire after 7 days; re-query to refresh. | Paid API | [docs.vizard.ai/docs/retrieve-video-clips](https://docs.vizard.ai/docs/retrieve-video-clips) |
| 111 | API rate limits scale with plan: 1/min · 10/h free; 3/min · 20/h Creator; 10/min · 60/h Business. | Tiered | [vizard.ai/pricing](https://vizard.ai/pricing) |
| 112 | Status codes include dedicated errors for clipping failure, rate limit, unsupported format, insufficient account time and failed download. | Paid API | [docs.vizard.ai/docs/retrieve-video-clips](https://docs.vizard.ai/docs/retrieve-video-clips) |
| 113 | Public MCP server exposes 7 tools (create project, status with wait, send change, upload link, list projects, list templates, account) to Claude, Codex and OpenCode. | Agent; free tier limited to Flash | [mcp.agent.vizard.ai/docs](https://mcp.agent.vizard.ai/docs) |
| 114 | MCP caps an account at 10 new projects per hour; edits to existing projects are not counted. | Agent | [mcp.agent.vizard.ai/docs](https://mcp.agent.vizard.ai/docs) |
| 115 | Downloadable n8n workflow JSON wires clipping to publishing with an API key. | Paid API | [vizard.ai/api](https://vizard.ai/api) |
| 116 | Downloadable Claude Code / Cursor "skill" zip triggers clipping and publishing from the IDE. | Paid API | [vizard.ai/api](https://vizard.ai/api) |
| 117 | Agent has its own HTTP API with project creation, SSE progress streams, steering and question-answering. | Agent | [agent.vizard.ai/api](https://agent.vizard.ai/api) |
| 118 | iOS app: clip generation, silence removal, watermark-free MP4 to camera roll, native share sheet, in-app project list. | Paid for watermark removal, per plan | [App Store listing](https://apps.apple.com/bs/app/vizard-ai-video-clip-maker/id6748490660) |
| 119 | Android app with the same clip/export/share loop and listed "coming soon" gaps (auto-edit, translation, manual editing, B-roll, bad-take removal). | Paid for watermark removal `[inferred]` | [Google Play listing](https://play.google.com/store/apps/details?id=ai.vizard.android) |
| 120 | No Zapier app and no Premiere Pro panel found; automation is n8n / MCP / API instead. | — `[inferred]` | [vizard.ai/api](https://vizard.ai/api) |
| 121 | No browser extension found in any primary surface. | — `[inferred]` | [help center index](https://help.vizard.ai/en/) |
| 122 | Mobile web supports storage management alongside iOS/Android. | All plans | [help: manage storage](https://help.vizard.ai/en/articles/15966025-how-to-manage-storage-in-the-vizard-workspace) |

---

## Paid tier gating

Prices are client-side-rendered on vizard.ai/pricing, so the numbers below come from independent page reads on 1–10 Nov 2026 and should be re-verified before any decision. Vizard was running a standing "50% OFF yearly" promotion, which is why annual is exactly half of monthly.

| | Free | Creator | Business |
|---|---|---|---|
| Monthly price | $0 | $29 | $39 |
| Annual price | — | $174/yr ($14.50/mo) | $234/yr ($19.50/mo) |
| Monthly credits | 60 | from 600, slider to 6,200 | from 600, slider to 6,200 |
| Credit unit | 1 credit = 1 minute of source video | same | same |
| Watermark | burned in | removed | removed |
| Upload length | 60 min | 600 min | 600 min |
| Upload size | 1 GB | 30 GB | 30 GB |
| Upload quality | 1080p | 4K | 4K |
| Export quality | 720p | 4K | 4K |
| Export length | 10 min | unlimited | unlimited |
| Storage | 3 days | 100 GB | unlimited |
| Social accounts | 1 (TikTok only) | 6 | 20 |
| Face tracking | no | yes | yes |
| Subtitle translation | no | yes | yes |
| Transcript format | TXT | TXT, SRT | TXT, SRT |
| Custom templates / outros | no | yes | yes |
| Brand templates / brand kit / custom fonts | no | no | yes |
| Scheduling | no | yes | yes |
| Team seats | no | no | +$5/mo yearly, $10/mo monthly |
| Shared projects to visitors | no | no | yes |
| Google Drive export | no | no | yes |
| API | 1/min · 10/h | 3/min · 20/h | 10/min · 60/h |
| Credit rollover | no | 2 months (13 on annual) | 2 months (13 on annual) |
| Support | live chat | live chat + priority | live chat + priority |

Sources: [pricing page](https://vizard.ai/pricing), [fastlane price read](https://www.usefastlane.ai/pricing/vizard), [crayo price read](https://crayo.ai/compare/crayo-vs-vizard), [help: connect accounts](https://help.vizard.ai/en/articles/10367893-how-to-connect-your-social-media-accounts).

**Credit mechanics worth copying or beating**

- 1 credit per source minute, charged at upload completion whether or not a clip is ever used. [creatorintelhq](https://creatorintelhq.com/reviews/vizard-ai-review/)
- `clip_v2` bills at 1.25× v1 for the same source. [docs](https://docs.vizard.ai/docs/advanced)
- AI Enhance adds 1 / 1.5 / 2.5 credits per second at 1080p / 2K / 4K. [help](https://help.vizard.ai/en/articles/16317508-how-to-enhance-video-quality-with-ai-enhance)
- AI Edit adds 0.5 credits per second of output. [help](https://help.vizard.ai/en/articles/16658532-what-is-ai-edit)
- X posts containing a link consume a flat 10 credits. [docs](https://docs.vizard.ai/docs/publish-clips-to-social-media)
- Credits roll over 2 months (13 on annual), but Creator credits are forfeited when upgrading to Business. [help: upgrade](https://help.vizard.ai/en/articles/10441977-how-to-upgrade-or-downgrade-your-plan)
- 15 credit tiers exist up to roughly $445/mo. [luminaclippers](https://luminaclippers.com/blog/lumina-clippers-vs-vizard-ai)

**Free-tier restrictions, consolidated:** 1 connected account (TikTok only), watermark, 720p, 10-minute export cap, 60-minute/1 GB upload cap, 3-day deletion, no translation, no SRT, no scheduling, no face tracking, no API beyond 1/min. [pricing](https://vizard.ai/pricing) · [help: connect accounts](https://help.vizard.ai/en/articles/10367893-how-to-connect-your-social-media-accounts)

---

## Known weaknesses from reviews

Ordered by how directly they map to a build decision.

**1. Clips ending mid-sentence was the single most common complaint.**
Vizard's own postmortem says so outright and explains the v1 architecture: one model juggled find-moment, pick-start, pick-end and honour-duration in a single pass, and duration won over coherence. The help center still tells users to manually extend clips and blames ChatGPT. Fix landed only in v2, July 2026. [Vizard blog](https://vizard.ai/blog/why-clips-used-to-get-cut-off-mid-sentence-and-how-we-fixed-it) · [help: extend clips](https://help.vizard.ai/en/articles/8984381-how-to-extend-and-add-more-content-to-ai-generated-clips)

**2. Wrong-person framing in multi-person video.**
Vizard documents that its face detector picks the largest/centred/most-likely-speaking face and that panels, side-by-side interviews and foreground/background setups break it, sometimes for most of a clip. Its advice is to re-record. [help: wrong person framed](https://help.vizard.ai/en/articles/14671161-why-does-the-ai-frame-the-wrong-person-in-multi-person-videos)

**3. Reframe drift even in the easy single-speaker case.**
Hands-on test: "part of my face and body drifted toward the edge of the frame", crop had to be checked before publishing. A separate comparison found the same drift. [creatorintelhq](https://creatorintelhq.com/reviews/vizard-ai-review/) · [lessonbench](https://lessonbench.com/guides/vizard-vs-opus-clip-vs-submagic)

**4. Caption accuracy errors on names and jargon.**
"Principal Plankin's platform" for the real name; "some words were wrong" and a manual proofread advised. [lessonbench](https://lessonbench.com/guides/vizard-vs-opus-clip-vs-submagic) · [creatorintelhq](https://creatorintelhq.com/reviews/vizard-ai-review/)

**5. Credits vanish before you see output.**
Balance is debited when the upload finishes, before settings are chosen, and is not returned if you stop at the settings screen. [creatorintelhq](https://creatorintelhq.com/reviews/vizard-ai-review/) · [genmedialab](https://www.genmedialab.com/reviews/vizard-ai-review)

**6. A single task can eat a month of allowance.**
"5 standalone short viral videos from a clip cost me a whole month's worth of credits" — with the reviewer naming Opus as cheaper for the same job. [Software Advice](https://www.softwareadvice.com/product/432576-Vizard/reviews/)

**7. No refund on unused credits.**
Multiple Trustpilot reviews describe credits as forfeited at cancellation, one after a failed refund request; another calls the rollover an incentive to stay subscribed. Vizard's terms limit refunds to 7 days and only if the service is "not used" — and uploading counts as use. [Trustpilot](https://www.trustpilot.com/review/vizard.ai) · [terms](https://vizard.ai/user-service.html) · [roborhythms](https://www.roborhythms.com/vizard-ai-review)

**8. Free-tier watermark is burned into frames, not overlaid.**
Confirmed frame-by-frame with ffprobe; no way to switch it off post-download. [creatorintelhq](https://creatorintelhq.com/reviews/vizard-ai-review/)

**9. Free projects self-delete in 3 days.**
An unfinished project can expire before the user returns. [vizard.ai/pricing](https://vizard.ai/pricing) · [genmedialab](https://www.genmedialab.com/reviews/vizard-ai-review)

**10. Features that read as free turn out paywalled after upload.**
Transcript export as SRT being the cited case. [fastlane](https://www.usefastlane.ai/review/vizard)

**11. Audio/music handling breaks at the outro.**
Outro appended after the clip ends leaves BGM cut dead with no fade or extension. [Trustpilot, Ritu Niyogi](https://www.trustpilot.com/review/vizard.ai)

**12. Slow processing and slow project pages.**
Rendering queue slow at peak; "project pages load very slow". [Capterra](https://www.capterra.com/p/10009818/Vizard/reviews) · [Software Advice](https://www.softwareadvice.com/product/432576-Vizard/reviews/)

**13. Scores cluster near the top and stop discriminating.**
Every visible clip scored 8.8–10.0 across two videos. Vizard's own v2 announcement concedes v1 scores all bunched at 8–9. [genmedialab](https://www.genmedialab.com/reviews/vizard-ai-review) · [Vizard blog](https://vizard.ai/blog/why-clips-used-to-get-cut-off-mid-sentence-and-how-we-fixed-it)

**14. Zoom recordings get misread as one blob.**
Screen and speaker are not separated by default; Vizard's fix is "use side-by-side mode when recording". [help: Zoom detection](https://help.vizard.ai/en/articles/8768908-vizard-cannot-detect-the-screen-and-speaker-in-my-zoom-recordings-how-can-i-get-vizard-to-identify-them-separately)

**15. No audio cleanup for noisy source.**
No built-in denoise or audio enhance. [roborhythms](https://www.roborhythms.com/vizard-ai-review)

**16. Translation coverage is overstated.**
"100+ languages" in marketing versus roughly 25 languages with usable transcription quality. [roborhythms](https://www.roborhythms.com/vizard-ai-review)

**17. Mobile app called clunky; some editing must be finished elsewhere.**
"Advanced editing options feel limited, so you still have to export the clip to another editor." [fastlane summarising G2](https://www.usefastlane.ai/review/vizard) · [G2 pros/cons](https://www.g2.com/products/vizard-corp-vizard/reviews?qs=pros-and-cons)

**18. Support reads as scripted.**
"Agents pretend to help, but repeat the same excuse like a robot" after a refund request. [Trustpilot](https://www.trustpilot.com/review/vizard.ai)

**19. Asset and storage rules changed under users.**
"My Assets" were moved to personal workspaces and disappeared from team workspaces; personal templates likewise. [help: manage storage](https://help.vizard.ai/en/articles/15966025-how-to-manage-storage-in-the-vizard-workspace)

**20. Users describe being "forced" onto a paid plan to evaluate.**
No trial; free limits hit immediately, and brand kit is Business-only. [Trustpilot](https://www.trustpilot.com/review/vizard.ai)

---

## Open questions / not verifiable

- **Exact current prices.** All figures render client-side; Vizard could be A/B-testing or running the 50%-off promo indefinitely. Re-read in a real browser before publishing comparisons.
- **Whether v1 still runs visual analysis.** Spark is described as multimodal, but the v1 postmortem describes a transcript-reading single pass. Unclear which model the default free path uses.
- **Dubbing availability.** Claimed on two marketing pages, absent from the plan comparison table and the API docs. Tier and credit cost unknown.
- **Whether virality score is exposed on free.** Confirmed in API responses and in third-party screenshots, but the plan table does not name it as a feature.
- **Webhook authentication.** Docs describe configuring a URL but do not document signing, retries or replay protection.
- **Analytics on published posts.** No post-performance dashboard found; only per-clip score/reason. Unclear if views/retention flow back.
- **Team roles.** Only "member/editor" is evidenced; no admin/viewer/approver matrix found.
- **Data residency and compliance.** Storage is stated as AWS California with AES-256 and a 2-hour signed URL; no EU region, SOC 2, GDPR DPA or sub-processor list found.
- **Model training on customer data.** Help center says models are trained on public YouTube data only and customer data is not used; the terms reserve broad machine-learning rights over usage data. These two statements sit uneasily together.
- **Legacy limits still live in help.** One article claims free = 300 upload minutes and 50 exports, Creator = 1,200 minutes — inconsistent with the pricing page's 60/600 credits. Treat help-center numbers as stale.
- **Bulk/batch clipping.** AI Edit is explicitly not bulk; no batch upload surface found. Unclear whether the API's `maxClipNumber` is the only bulk affordance.
- **Browser extension and Zapier.** Absent from all primary surfaces checked, so recorded as not-found rather than confirmed absent.
- **Whether clip boundaries in v2 are actually clean.** Vizard's own blog is the only source; no independent v2 boundary test was found beyond the 27-second single-clip test.
