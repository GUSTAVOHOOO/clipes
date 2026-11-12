# vidIQ — capability inventory for a clip-factory pipeline

Research date: 2026-11-12. Subject: vidIQ (vidiq.com), a YouTube channel-growth SaaS.

Scope: vidIQ is not a clipper (it added a clipping feature, but clipping is a small side module). The useful surface for us is **discovery, packaging and publishing decisions** — the parts a clip pipeline could automate. Everything below was pulled from vidIQ's own site, help center, and Chrome Web Store listing; third-party reviews appear only in the weaknesses section and are labelled.

Method notes:
- Primary sources only for feature claims. One inference is marked `[inferred]`.
- vidIQ publishes an unusually detailed help-center table of per-plan limits; where the marketing site and the help center disagree, both numbers are recorded.
- Free lead-magnet tools are listed in their own subsection so they are not confused with paid features.

---

## Feature inventory

### Discovery — keyword and search-demand research

- **Keyword Research (topic → keyword list)** — enter a topic, get related keywords with search volume, a competition score, and a derived keyword score; results can be filtered by topic, language and time frame. Free: 3 results per search. Boost/Max/Coaching: unlimited. [source](https://vidiq.com/features/keyword-tools/) · [limits](https://support.vidiq.com/en/articles/13928456-features-credits-by-plan)
- **Rising Keywords** — list of search terms with the steepest growth, with a stated "+X% vs previous period" figure and filters by topic and length. Surfaced on the public site as a lead magnet with a "show more" gate. [source](https://vidiq.com/features/keyword-tools/)
- **Public top/rising keyword board** — US top-searched terms with monthly volume and rising terms with growth percentages, refreshed daily (rising terms every six hours per the page copy). No login. [source](https://vidiq.com/features/keyword-tools/) · [rising list](https://vidiq.com/trending-keywords/)
- **Keyword Inspector (in-page overlay)** — on any YouTube search results page, injects volume, competition and related queries next to results, plus the tags competitors rank with. Free plan sees 3 results. [source](https://vidiq.com/features/keyword-tools/) · [limits](https://support.vidiq.com/en/articles/13928456-features-credits-by-plan)
- **Weight Class** — ranks a channel's own size against a keyword's competition score and colours it green/yellow/red ("above / within / below the competition") so the user picks fights they can win. This is the mechanism behind keyword "opportunity" scoring. [source](https://support.vidiq.com/en/articles/438242-the-weight-class)
- **Keyword templates / saved keyword lists** — reusable keyword groups per video series. [source](https://vidiq.com/features/keyword-tools/)
- **Niche Finder** — viability score for a niche built from search demand, competition gap, outlier videos and an estimated RPM range. Free, no signup. [source](https://vidiq.com/youtube-niche-finder/)
- **Trending-by-country board** — trending chart for 50+ countries with views-per-hour and outlier scores, updated hourly. [source](https://vidiq.com/youtube-trends/)
- **YouTube Rank Checker** — one-shot check of where a given video sits in relevance-ordered YouTube results for one keyword in one country; returns position plus up to 10 neighbouring results, inspects up to 50. Explicitly *not* a tracker: no history, no alerts. [source](https://vidiq.com/youtube-rank-checker/)

### Discovery — outlier and competitor intelligence

- **Outliers** — enter a keyword, get videos performing far above their channel's baseline, ranked by a 0–100+ Outlier Score. Tabs for Videos, Shorts, Channels, Thumbnails. Filters: outlier score, views, subscriber count, views-per-hour, video length, publish date, long-form/Shorts toggle. Free: 8 results per search (marketing FAQ says 6 — discrepancy); advanced filters are paid-only. [feature page](https://vidiq.com/features/outliers/) · [mechanics](https://support.vidiq.com/en/articles/9660010-outliers) · [free limit](https://support.vidiq.com/en/articles/13928456-features-credits-by-plan)
- **Outlier score computation, as disclosed** — "views, velocity, and performance vs. a channel's usual baseline". No formula, no baseline window, no normalisation by channel size beyond the subscriber filter. [source](https://vidiq.com/features/outliers/)
- **Outlier-by-thumbnail search** — search outliers by image as well as by phrase, to find thumbnails with similar visual elements and spot design trends. [source](https://vidiq.com/features/outliers/)
- **Competitors** — add channels by search or by channel ID, bulk-add, and compare views / subscribers / public videos / average daily views / average subscribers per day over 30 days, 60 days or 12 months. Per-competitor 7/14/28-day breakdowns. Free: 3 tracked channels; Boost 20; Max 50. [feature page](https://vidiq.com/features/competitors/) · [limits](https://support.vidiq.com/en/articles/13928456-features-credits-by-plan)
- **Competitor top-video table** — competitor videos sorted by views or views-per-hour, filterable to past 48h / week / month / all time, with the option to include or exclude the user's own channel. [source](https://support.vidiq.com/en/articles/9456917-competitors)
- **Competitor keyword export** — one-click CSV of the top keywords competitors use. [source](https://vidiq.com/features/competitors/)
- **Trend Alerts** — scheduled email digests on keywords, categories and watched competitors, with a views-per-hour threshold and cadence of daily / every 2 days / weekly / monthly. Set up from the extension's Creator Studio. [source](https://vidiq.com/features/trend-alerts/)
- **Most Viewed** — category/keyword browser for what is currently popular, with sort and filter controls; extension-only. Sorting is paid-only. [source](https://support.vidiq.com/en/articles/8619340-most-viewed)
- **Subscriber overlap** — "top channels your subscribers are subscribing to" and "top videos watched by your subscribers", so neighbouring channels can be promoted to tracked competitors in one click. Boost and above only. [source](https://support.vidiq.com/en/articles/9562745-subscribers)
- **Remix** — hover any video card on home, search, channel or watch pages and ask vidIQ to spin the idea into new concepts against the user's own topic list. Extension-only. [source](https://support.vidiq.com/en/articles/9899331-remix)

### Discovery — ideation and daily feeds

- **Daily Ideas** — 50 AI video ideas per day (1,500/month) derived from the channel's history plus similar channels, each ranked Very High / High / Medium / Low by a view-prediction model, clickable into the top-ranking videos on that topic. Free: 3 per day; paid: 50 per day. Customised ideas: 3 lifetime on free. [feature page](https://vidiq.com/features/daily-ideas/) · [limits](https://support.vidiq.com/en/articles/13928456-features-credits-by-plan)
- **Create / Topic of the Day** — dashboard with one editorially chosen daily topic plus modules of four results each, some new topics and some high-performing reference videos. Free plan gets limited modules. [source](https://support.vidiq.com/en/articles/8991775-create)
- **Blueprints** — take an idea into a prefilled title + 4 thumbnail variants + outline (duration 3–5 / 5–10 / 10+ min, plus video-type presets). Free: 3 saved blueprints, no generate-more and no Outline tab; paid: unlimited. [source](https://support.vidiq.com/en/articles/9010754-blueprints)
- **Generate ("make a video about…")** — topic in, idea list with titles, descriptions and thumbnails out. Free: 3 generations; paid: unlimited. [source](https://support.vidiq.com/en/articles/9829101-generate)
- **AI Video Ideas generator (free tool)** — niche/topic in, idea list out, with a "send to title/description/tag generator" handoff. [source](https://vidiq.com/ai-video-ideas-generator/)

### Packaging — titles

- **AI Title Generator** — topic in, titles out, each tagged with a named frame (bounded journey, transformation, insider, warning, access, payoff) and a character count; 48 worked examples across 8 niches. [source](https://vidiq.com/ai-title-generator/)
- **Title Analyzer** — paste a title, get a 0–100 score with written reasons (curiosity hook, specificity, emotional trigger, keyword placement, length) plus five real comparable videos. Free with a daily cap; 200-character input cap; guidance is 50–70 characters. [source](https://vidiq.com/youtube-title-analyzer/)
- **Title Suggestions (in YouTube Studio)** — live 1–100 score in the title box plus four scored alternatives; preferences take a description, a target keyword and an emotion from a fixed list (comparison, credibility, curiosity, desire, extreme, list, negativity, question, time). [source](https://support.vidiq.com/en/articles/10099905-title-suggestions)
- **Title & thumbnail change tracking** — Scorecard keeps a history of title and thumbnail swaps next to the engagement curve. [source](https://vidiq.com/features/scorecard/)

### Packaging — thumbnails

- **AI Thumbnail Maker** — generate from a prompt, a YouTube URL, an uploaded video (MP4/WebM/MOV ≤200 MB, analysed for high-click moments), a reference image, or a selfie with background removal and relighting; "style matching" rebuilds a reference thumbnail's layout and contrast. 1280×720 output. Free trial: three generations before an account is required; then 22 credits per generation, regeneration or edit. [source](https://vidiq.com/youtube-thumbnail-maker/) · [credit cost](https://support.vidiq.com/en/articles/13928456-features-credits-by-plan)
- **Thumbnail A/B concept** — the product claims "AI-powered templates and A/B testing", but the shipped consumer mechanism is a side-by-side **Preview** against real competitor/search results, not a statistical test; true A/B tests are listed as an Enterprise feature. [claims](https://vidiq.com/) · [preview](https://support.vidiq.com/en/articles/9829132-thumbnail-preview) · [Enterprise A/B](https://enterprise.vidiq.com/packages)
- **Thumbnail Preview** — realistic home/search placement of the candidate thumbnail and multiple title variants, with competitor choice (own, trending, keyword, by channel). Free: 3 lifetime comparisons. [source](https://support.vidiq.com/en/articles/9829132-thumbnail-preview)
- **Thumbnail Downloader** — pulls the largest thumbnail YouTube actually stores (1280×720 max, no upscaling) and lists only the sizes that exist. Free, no signup. [source](https://vidiq.com/youtube-thumbnail-downloader/)
- **Thumbnail templates, resizer, banner resizer, frame-by-frame grab** — layout presets, exact 1280×720 resize, channel-art sizes, and still extraction from a video. [source](https://vidiq.com/free-youtube-tools/)
- **Thumbnail swap detection** — the extension flags when any public video's thumbnail changes, so competitor packaging tests are visible in-feed. [source](https://vidiq.com/youtube-thumbnail-downloader/)

### Packaging — descriptions, tags, hashtags, chapters

- **AI Description Generator** — video idea in, keyword-rich description out; the surrounding guide documents what actually matters (hook inside the first 150 characters, chapters, ≤3 hashtags, link placement). [source](https://vidiq.com/ai-description-generator/)
- **Description Suggestions (in Studio)** — inline generation with preferences for subject, target keywords and emotional direction, and per-keyword score highlighting. [source](https://support.vidiq.com/en/articles/13892020-uploading-and-editing-on-youtube-with-vidiq)
- **Tag generator / Recommended Tags** — scored tag sets (0–100) sorted by relevance, overall score, volume or competition; tag templates; tag translation. Free/Pro: three fixed suggestions, no refresh. [source](https://support.vidiq.com/en/articles/10106651-recommended-tags) · [free tag tool](https://vidiq.com/video-tags-generator/)
- **Tag Extractor** — read the tags off any public video. [source](https://vidiq.com/youtube-tag-extractor/)
- **Hashtag Generator** — Long-form vs Shorts switch, grouped core/niche/specific sets, 3–5 recommended. [source](https://vidiq.com/youtube-hashtag-generator/)
- **Chapter / timestamp generator** — mark sections while the video plays; validates YouTube's three rules (00:00 first, ≥3 chapters, ≥10 s each), exports `.txt`. [source](https://vidiq.com/youtube-chapter-generator/)
- **Magic Fill** — one click populates title, description and tags from the video, all editable before publish. [source](https://support.vidiq.com/en/articles/13892020-uploading-and-editing-on-youtube-with-vidiq)

### Publishing

- **Optimize Score** — 0–100 in-Studio score with **published weights: title 48 %, thumbnail 48 %, description 2.5 %, tags 1 %, scheduled time 0.5 %**. Free: one video, unlimited regeneration; paid: unlimited videos. [weights](https://support.vidiq.com/en/articles/13892020-uploading-and-editing-on-youtube-with-vidiq) · [gating](https://vidiq.com/features/optimize/)
- **Optimize (web app)** — same scoring across the back catalogue, sorted lowest-first, plus draft upload for pre-publish scoring; thumbnail critique on emotional impact, visual harmony, contrast, text readability, uniqueness. [source](https://vidiq.com/features/optimize/)
- **Best Time to Post** — reads the channel's own subscriber activity, returns day/time windows in the user's timezone, surfaced inside the Studio Details tab and the Schedule flow. Free on every plan; needs a few days of channel data. Advice includes posting *before* the peak and avoiding the top/bottom of the hour. [feature page](https://vidiq.com/features/best-time-to-post/) · [mechanics](https://support.vidiq.com/en/articles/108673-best-time-to-post)
- **Scheduling** — vidIQ sets the schedule inside YouTube Studio rather than hosting its own queue; publish time is a scored input in Optimize. [source](https://support.vidiq.com/en/articles/13892020-uploading-and-editing-on-youtube-with-vidiq)
- **Publish/update from MCP** — the MCP server can change title, description, tags, visibility, schedule, thumbnail and reply to comments with per-action approval; it cannot upload a video. [source](https://vidiq.com/mcp/)

### Analytics

- **Scorecard** — SEO score, tags, subscriber growth, watch time, views-per-hour and cross-platform engagement (YouTube/Facebook/Reddit) on any video, plus a historical tab and a 15-point optimisation checklist and a controversial-keyword alert for demonetisation risk. [source](https://vidiq.com/features/scorecard/)
- **Shorts Scorecard** — the same for Shorts: views graph (24 h / 7 d / 28 d / all time), outlier score, VPH, engagement rate, channel panel. Data absent below ~50 views. [source](https://support.vidiq.com/en/articles/10453678-the-vidiq-shorts-scorecard)
- **Real-Time Stats bar** — live views over 60 min / 48 h / 7 d and 7-day watch time, from a hover panel while on any YouTube page. [source](https://vidiq.com/features/real-time-stats/)
- **Views Per Hour (VPH)** — the velocity metric used throughout outliers, competitor sorting and scorecards; described as a virality signal. [source](https://support.vidiq.com/en/articles/108672-what-is-vph-views-per-hour)
- **Channel Audit** — 30/60/90-day panel with period-over-period deltas on views, subscribers and minutes watched; "double down" and "needs attention" video lists by VPH, subscriber gain, watch time, retention and subscriber loss; traffic sources, top search terms, top suggested non-owned videos, endscreen/card performance, playlist performance; a checklist scoring titles (20–60 chars), descriptions (300+), tags (200+), cards, endscreens, thumbnails, playlists. Paid: up to 20 results per section. [source](https://vidiq.com/features/channel-audit/)
- **Free public channel audit** — five-signal score (upload consistency, SEO, engagement rate, views-to-subscriber ratio, posting recency) with explicit caveat that public data has no impressions, CTR, retention or traffic sources. [source](https://vidiq.com/audit/)
- **Comments replies and analysis** — AI reply drafts and comment analysis, credit-metered. [credit table](https://support.vidiq.com/en/articles/13928456-features-credits-by-plan)
- **Instagram analytics side-car** — Reel ideas, hook/retention/hashtag scoring on any public Reel, caption and hashtag generation, on the same account. [source](https://vidiq.com/instagram/)

### Coaching and audit (AI)

- **AI Coach** — channel-aware chat that diagnoses a stalled video, produces a prioritised channel audit, critiques packaging, and builds a content plan. Two depths plus a Max Mode: Fast (10 credits/message), Deep Thinking (25), Max Mode (50, Max/Coaching only). "Deep thinking" is the recommended default per the page. [source](https://vidiq.com/features/ai-youtube-coach/) · [credit costs](https://support.vidiq.com/en/articles/13928456-features-credits-by-plan)
- **Free AI Coach tier** — title creation, idea generation and script help free; personalised advice and channel audits were pushed free "for a limited time" at the time of writing. [source](https://vidiq.com/features/ai-youtube-coach/)
- **Human coaching** — dedicated 1:1 coach, recurring calls, channel audit, 3-phase growth plan, thumbnail/title/video feedback, coach reads the user's real YouTube Analytics. $319/month or $3,830/year. [source](https://vidiq.com/coaching/#pricing)
- **Feed Cards** — single-action dashboard cards (e.g. a title opportunity on one video); free plan locks new cards behind a 12-hour timer as the upsell mechanism. [source](https://support.vidiq.com/en/articles/13188399-feed-cards-breakdown)
- **Masterclasses / vidIQ Lessons** — course library; industry-professional lessons are a paid unlock. [source](https://support.vidiq.com/en/articles/13928456-features-credits-by-plan)

### Platform — extension, MCP, app, enterprise

- **Chrome extension ("vidIQ Vision for YouTube")** — overlays scores, tags, VPH, competitor data and Studio upload panels on youtube.com and YouTube Studio. 4.8 / 11.5K ratings, 4,000,000 users. [source](https://chromewebstore.google.com/detail/vidiq-vision-for-youtube/pachckjkecffpdphbpmfolblodfkgbhl)
- **MCP server (the de-facto API)** — hosted remote MCP at `mcp.vidiq.com/mcp`, OAuth sign-in, 52 tools (46 core + 6 free utility). Named tools include `keyword_research`, `outliers`, `trending_videos`, `subscriber_insights`, `video_transcript`, `generate_titles`, `generate_thumbnail`, `generate_clips`. Explicitly no YouTube API key needed, no YouTube upload, write actions gated behind user approval. Available on Free; calls draw from the same credit pool (≈5 credits for research calls, 22 for a thumbnail). [source](https://vidiq.com/mcp/) · [tool roster](https://vidiq.com/.well-known/ard.json) · [server card](https://mcp.vidiq.com/mcp/server-card)
- **MCP prompt library** — published, copy-paste prompts per job (competition, performance, keywords, trends, analytics), including "find videos that beat their channel's usual views, then explain the patterns in their titles and topics". [source](https://vidiq.com/mcp/)
- **CSV export** — extension-side export of selected analytics, keyword, tag and performance data; free capped at 10 videos. [source](https://support.vidiq.com/en/articles/13928456-features-credits-by-plan)
- **Mobile app** — same tools, phone layouts; different filter sets (e.g. competitor time ranges collapse to 48 h/7 d/30 d). [source](https://support.vidiq.com/en/articles/9456917-competitors)
- **Enterprise** — team roles/permissions, separate workspaces, multi-channel admin, pooled credits with per-user caps, video changelog, creator discovery, A/B tests, ideas score, packaging score, "revival lab", SEO/GEO intelligence, Slack integration. [source](https://enterprise.vidiq.com/packages)
- **Clipping** — upload MP4 ≤30 GB, ≤10 h, prompt-optional moment selection, clip length presets (20–45 s / 45–60 s / 60 s+ or auto), auto-captions with editable style, language selection (12 languages), 1080p vertical export. Fails on videos without speech; private videos ineligible; 3-minute minimum source. Credit-metered per input minute. [source](https://support.vidiq.com/en/articles/11519169-clipping)
- **AI Video Generator / Shorts Generator** — text prompt (scene, character, style, script, tone) to video; credit-metered, per second of output. [source](https://support.vidiq.com/en/articles/13564834-video-generator)

### Free tools used as lead magnets (not paid features)

Separate from the gated product; almost all are one-shot utilities that feed a signup.

- Title Generator, Description Generator, Tag Generator, Hashtag Generator, Chapter Generator, Thumbnail Maker (3 free generations), Thumbnail Downloader, Thumbnail Resizer, Thumbnail Preview, Title Analyzer (daily cap), Niche Finder, Rank Checker (rate-limited), Money Calculator, Engagement Rate Calculator, Watch Time Calculator, Channel Name Generator, Hook Generator, Content Generator, Podcast Name Generator, Comment Generator, Channel Audit (public-data score only), Trending by Country. [index](https://vidiq.com/free-youtube-tools/)

---

## Paid tier gating

Prices are US list, one-channel, as displayed 2026-11-12. Local pricing varies; final price at checkout.

| Plan | Monthly | Annual | AI credits/mo | Channel count |
|---|---|---|---|---|
| Free | $0 | $0 | 150 | 1 |
| Boost | $19 | $199 ($16.58/mo equivalent) | 2,000 / 2,500 / 3,000 | 1 / 2 / 3 |
| Max | $49 | $468 ($39/mo equivalent) | 6,000 / 8,000 / 10,000 | 1 / 2 / 3 |
| Coaching | — | $3,830/yr ($319/mo equivalent) | 6,000 | 1 |
| Enterprise | $99/user/mo, 5-user minimum | 15 % off annual | 10,000/user, poolable | 1 + $10/mo per extra |
| Enterprise + Strategist | $229/user/mo, 8-user minimum | 15 % off annual | 20,000/user, poolable | 1 + $10/mo per extra |

Sources: [pricing](https://vidiq.com/pricing/) · [coaching](https://vidiq.com/coaching/#pricing) · [enterprise packages](https://enterprise.vidiq.com/packages) · [credit allowances](https://support.vidiq.com/en/articles/13928456-features-credits-by-plan)

**Channel count is chosen through the credit dropdown, not a separate selector** — each credit tier maps 1:1 to a channel count. [source](https://support.vidiq.com/en/articles/2754811-how-to-change-to-a-different-plan)

Credit mechanics, i.e. the real meter:

| Action | Credits |
|---|---|
| AI Coach, fast | 10 / message |
| AI Coach, deep thinking | 25 / message |
| AI Coach, Max Mode | 50 / message |
| Thumbnail generation, regen or edit | 22 |
| Clipping | per input minute |
| Script Writer | per minute of script |
| Shorts Generator | 20 / second of output |
| MCP research call | ~5 |

[source](https://support.vidiq.com/en/articles/13928456-features-credits-by-plan)

- Credits are **per account, shared across channels and across every tool including MCP**, refresh monthly, and **do not roll over**. Add-on/top-up credits survive billing dates and are consumed only after plan credits. [source](https://support.vidiq.com/en/articles/13928456-features-credits-by-plan)
- Top-ups are Max/Coaching only, absent on Free and Boost, and absent for App Store / Play billing. [source](https://support.vidiq.com/en/articles/14979673-running-out-of-ai-credits-your-options-for-getting-more)
- Free-plan hard caps besides credits: 3 keyword results/search, 8 outlier results/search, 3 ideas/day, 3 competitors, 3 blueprints, 3-lifetime thumbnail comparisons, 3 ranked tags per video, 10-video CSV export, 3-section Channel Audit for a limited timeframe, 1 Optimize video, feed cards locked for 12 hours. [source](https://support.vidiq.com/en/articles/13928456-features-credits-by-plan)
- Boost is $199/yr versus $19×12 = $228 monthly — a **~13 % annual discount on Boost** and $468 versus $49×12 = $588 on Max (~20 %). Third-party testing reports Max as annual-only at review time. [pricing](https://vidiq.com/pricing/) · [3rd party](https://1of10.com/blog/vidiq-review/)
- Enterprise is sales-gated ("Book a Demo"); no self-serve checkout. [source](https://enterprise.vidiq.com/packages)

---

## Known weaknesses from reviews

Billing and cancellation:

- **Refunds routinely denied; charges after cancellation.** Aggregated from Trustpilot, SiteJabber and BBB filings: charges of $19–$169 months after cancellation, support citing terms instead of refunding, users resorting to chargebacks. [source](https://saasflags.com/products/vidiq/complaints)
- **Annual billing buried at checkout.** Reviewers report being charged a full year ($400+) after believing they had chosen monthly, with the annual commitment not disclosed prominently. [source](https://saasflags.com/products/vidiq/complaints)
- **Support is bot-first and slow.** Three-to-fourteen-day waits, canned FAQ links, no phone or live chat for paying subscribers. [source](https://saasflags.com/products/vidiq/complaints)
- **BBB "F" rating with unanswered complaints.** [source](https://saasflags.com/products/vidiq/complaints)

Data accuracy:

- **Keyword volume is directionally wrong and unverifiable.** Creators comparing vidIQ's search volume with Google Trends report figures that diverge wildly from any external signal; vidIQ publishes no methodology for how volume or competition is derived. [Reddit thread](https://www.reddit.com/r/PartneredYoutube/comments/1734i6c/how_good_is_vidiqs_search_volume_tool/) · [second thread](https://www.reddit.com/r/NewTubers/comments/112n3e7/accuracy_of_vidiq_keyword_research_am_i/)
- **Scores are presented as algorithm prediction but are not.** The Outlier Score and SEO/Optimize scores are composites with no disclosed formula; critics argue they measure nothing real and chase a signal YouTube does not expose. [source](https://saasflags.com/products/vidiq/complaints)
- **Thumbnail "A/B testing" is only a preview.** The marketing copy promises A/B testing; the consumer build ships side-by-side previews and no statistical test — real A/B is Enterprise-only. [claim](https://vidiq.com/) · [Enterprise](https://enterprise.vidiq.com/packages)

Generic output:

- **AI Coach is described as boilerplate.** Recurring complaints of "post consistently, use strong thumbnails"-grade advice, and of title/thumbnail feedback that ignores niche specificity. [source](https://saasflags.com/products/vidiq/complaints)
- **Daily Ideas skew safe and derivative**, and suggestions start echoing what an experienced creator already knows after roughly 50 videos. [third-party review, competitor-owned — read with care](https://1of10.com/blog/vidiq-review/)

Upsell pressure and free-tier bait:

- **Constant upgrade prompts.** Free-plan users report every screen carrying an upgrade button; the free tier exists to demonstrate what is locked. [source](https://saasflags.com/products/vidiq/complaints)
- **Paywalled basics inside free tools.** Recommended Tags returns three frozen suggestions with a purple padlock and a "Boost this video" button; the title analyzer and thumbnail maker cap free usage and then ask for an account. [source](https://support.vidiq.com/en/articles/10106651-recommended-tags)
- **Product reframing without changelog** (2024–2025 repricing/rebundling) triggered a visible cancellation wave. [source](https://saasflags.com/products/vidiq/complaints)

Extension behaviour:

- **YouTube slowdown and crashes.** Persistent 2024–2025 reports of slower page loads and conflicts with other creator tools such as TubeBuddy; disabling the extension restores performance. [source](https://saasflags.com/products/vidiq/complaints)

Structural complaints worth heeding for a browse-driven channel:

- **The product is built for search traffic.** For channels whose views come from browse and suggested feeds — which includes most clip and gaming channels — keyword scores are close to noise, and the real levers (idea selection, packaging) are vidIQ's weakest area. [third-party, competitor-owned](https://1of10.com/blog/vidiq-review/)

---

## What a clip factory should borrow

1. **Outlier detection as the discovery primitive, not keyword volume.** Score candidate source videos against each channel's own rolling baseline (not absolute views), with subscriber-count and publish-date filters. Our dark-gaming niche is browse-driven, so baseline deviation beats search volume. [pattern](https://support.vidiq.com/en/articles/9660010-outliers)
2. **Publish the score formula.** vidIQ's biggest credibility hole is undisclosed scoring; its strongest single artefact is the Optimize weight table (title 48 %, thumbnail 48 %, description 2.5 %, tags 1 %, schedule 0.5 %). Ship the weights, the baseline window and the sample size in the UI. [source](https://support.vidiq.com/en/articles/13892020-uploading-and-editing-on-youtube-with-vidiq)
3. **Score the packaging, do not just generate it.** A 0–100 title score with written reasons and five real comparable thumbnails/titles beside it is more useful than another title list, and it is fully local — no API cost per keystroke. [pattern](https://vidiq.com/youtube-title-analyzer/)
4. **Named title frames instead of free-form prompts.** vidIQ's generator tags each output as bounded journey / transformation / insider / warning / access / payoff and shows the character count. Frames are a cheap, testable constraint layer for a clip titler. [source](https://vidiq.com/ai-title-generator/)
5. **Thumbnail-as-reference-image search.** Search for outliers *by image* to find the visual grammar of a niche, then generate against those references. This is the highest-value idea in the whole product for a visual niche. [source](https://vidiq.com/features/outliers/)
6. **Clip-to-scorecard loop.** Every rendered clip should get a predicted-vs-actual panel: VPH, engagement, retention proxy, against the channel's own baseline, so the scorer is trained on our output rather than vidIQ's. [pattern](https://support.vidiq.com/en/articles/10453678-the-vidiq-shorts-scorecard)
7. **Best-time-to-publish from our own audience, in local time, with the "post before the peak" rule.** Free in vidIQ and genuinely useful; cheap to reimplement from our own analytics. [source](https://support.vidiq.com/en/articles/108673-best-time-to-post)
8. **Chapter timestamps generated from the clip's own transcript.** vidIQ validates YouTube's three rules (00:00 first, ≥3, ≥10 s) and exports `.txt` — a natural extension of the transcript we already produce. [source](https://vidiq.com/youtube-chapter-generator/)
9. **A single actionable daily queue, not a dashboard.** Feed Cards are one action per card, dismissible. For a factory this maps to "next 5 clips to package, ranked" rather than a metrics wall. Strip the 12-hour artificial lock. [pattern](https://support.vidiq.com/en/articles/13188399-feed-cards-breakdown)
10. **Hash first 150 characters, chapters, ≤3 hashtags, tag hygiene as hard validators in the description builder** — vidIQ documents these rules but leaves enforcement to the user. [source](https://vidiq.com/ai-description-generator/)
11. **Headless MCP surface.** vidIQ exposes 52 tools over MCP with per-write approval and no API key. A clip factory should expose `find_outliers`, `score_title`, `render_clip`, `publish` the same way, so agents can drive the pipeline without a UI. [source](https://vidiq.com/mcp/)
12. **Competitor watchlist with VPH thresholds and digest cadence**, at a sane free limit — vidIQ's 3-channel free cap and its "top channels your subscribers watch" seed are both good defaults, but the latter should not be a paid unlock. [source](https://support.vidiq.com/en/articles/9562745-subscribers)

---

## Open questions / not verifiable

- **Keyword volume provenance.** No public methodology. Page copy claims "billions of YouTube search queries" and daily refresh of the public board, but not whether volume is sampled, modelled, or extrapolated. [claim](https://vidiq.com/features/keyword-tools/)
- **Outlier Score formula and baseline window.** Described as views + velocity + deviation from baseline, with the range 0–100+, but no weights and no lookback period. [source](https://support.vidiq.com/en/articles/9660010-outliers)
- **Corpus size.** "135M+ channels" and "30M+ creators" appear in marketing; neither is verifiable and the first is not defined (channels indexed? tracked?). [source](https://vidiq.com/mcp/)
- **Public REST API.** None found. The MCP server is the only documented programmatic surface; the enterprise "Claude/vidIQ integration" appears to be the same MCP. Marked `[inferred]` that no separate API exists. [source](https://enterprise.vidiq.com/packages)
- **Free-plan outlier cap disagrees across sources** — 6 on the feature FAQ, 8 in the help-center table. [FAQ](https://vidiq.com/features/outliers/) · [table](https://support.vidiq.com/en/articles/13928456-features-credits-by-plan)
- **Max monthly billing.** The pricing page advertises "$49/month" but the card charges annually; third-party testing says monthly Max was unavailable. Unconfirmed whether this is regional or permanent. [source](https://1of10.com/blog/vidiq-review/)
- **"Real A/B testing" scope.** Listed under Enterprise only, with no documentation of whether it splits impressions or just versions thumbnails. [source](https://enterprise.vidiq.com/packages)
- **Clipping quality on faceless gaming footage.** Help center says clips need faces and speech and fail on music-only video; for gameplay-with-commentary channels this is unproven either way. [source](https://support.vidiq.com/en/articles/11519169-clipping)
- **Retention data depth.** Scorecard and Channel Audit expose retention percentages, but the source (public estimate vs. the user's authenticated Analytics) is not stated per metric.
- **Trustpilot, G2 and BBB were bot-blocked** during collection (403); their content reaches this document only through the saasflags aggregator's quoted excerpts, which is a second-hand layer. Direct numbers were not re-verified.
