# Meeting Prep Tool — v4 PRD

## One-liner

A living repository of indexed long-form content (podcasts, conference panels, fireside chats, interviews) where sales teams look up a fund name and get instant AI-generated meeting prep — key talking points with sourced quotes, investment thesis, and navigable transcripts with timestamps.

## Why this exists

Before every meeting, someone would ideally listen to the fund's appearances on podcasts (Invest Like the Best, Capital Allocators, etc.) or speaker events (Goldman Sachs Talks, Milken panels, etc.). They would then synthesize this to understand how we can best pitch Rowspace. Of course, nobody has time to do that for every meeting. The result: our pitch is generic, and potential deal opportunities become "sounds interesting, check back in later because we're too busy to scope out how this is relevant for us."

This tool replaces an hour of manual searching and listening with a searchable knowledge base where you type "Apollo" and get back every relevant appearance with AI-generated prep bullets — instantly. Walk into every meeting sounding like you've been paying attention.

### What this surfaces that a 5-minute Google + ChatGPT pass doesn't

Google tells you "Bridgewater is a macro fund." This tool tells you that Bridgewater's head of client solutions told Patrick O'Shaughnessy at minute 34:23 that they're frustrated with how managers pitch them generic "we have alpha" stories — they want to hear specific sourcing edge. That's the insight that changes how you walk into the room. The delta is depth, specificity, and direct quotes from long-form conversations where fund principals spoke candidly.

## Strategic context

v1 is an internal Rowspace tool. v2 extends to Assembled. v3 is a PLG sales tool. Architecture decisions in v1 should make v2/v3 possible without a rewrite.

---

## Core Concept: The Transcript Repository

The product is a living repository of indexed long-form content. The unit of content is **"a transcript where someone from Fund X spoke at length about their views"** — regardless of whether it's a podcast episode, a conference panel, a fireside chat, or a YouTube interview.

Two ingestion paths feed the same repository:

### Path 1: Active (Submit URLs)

User pastes a URL (or many URLs). System pulls the transcript, processes it through the full pipeline, and indexes it — including pre-generated prep bullets. Content is ready for instant lookup once processing completes.

This is the primary ingestion path for v1. Two transcript sources:

**Curated podcast sites (primary).** ILTB (Colossus), Capital Allocators, Acquired, and Odd Lots all publish human-edited transcripts behind free or low-cost auth. These are dramatically better than auto-captions — proper punctuation, speaker labels, no filler artifacts. The system authenticates and scrapes transcripts from these sites. Speaker attribution is already done for you.

**YouTube (fallback).** Conference panels, fireside chats, one-off interviews, and any source without published transcripts. YouTube recently disabled auto-captions on some channels (including ILTB), so this path may require downloading audio + running through AssemblyAI/Whisper for sources without captions. For v1, YouTube is the fallback for content not covered by curated sources.

**Bulk import** is the v0 bootstrap mechanism. Paste 50 Colossus URLs → system scrapes and processes them all → repository is seeded with high-quality, fully analyzed content.

### Path 2: Passive (Subscribe to Sources)

"Watch this source. When new content drops, pull the transcript and index it." Configured once per source, runs on a schedule.

Best for curated sources with predictable structures and high-quality human-edited transcripts:

| Source | Why it's worth subscribing | Transcript quality |
|--------|---------------------------|-------------------|
| Invest Like the Best (Colossus) | Top-tier fund managers, detailed conversations | Human-edited, excellent |
| Capital Allocators | Allocator-focused, directly relevant | Human-edited, good |
| Acquired | Deep dives on major firms/deals | Human-edited, excellent |
| Odd Lots (Bloomberg) | Macro/markets perspectives | Varies |

Passive subscriptions are a v1 stretch goal / early v2 feature. The active path handles everything these sources produce — just paste the URLs. Subscriptions add convenience (no manual checking for new content), not coverage.

### Processing Pipeline (Both Paths)

**Key architectural decision: all LLM processing happens at ingestion time, not at query time.** Lookup is pure database retrieval — instant, deterministic, no waiting for Claude. This is critical for a sales tool: meeting-day usage must feel immediate and reliable.

```
Raw URL (YouTube, podcast site, etc.)
        │
        ▼
Step 1: Transcript extraction
  → Curated sites (primary): scrape human-edited transcript (already has speaker labels, punctuation)
  → YouTube: auto-captions via Data API (with timestamps), or audio download + AssemblyAI/Whisper if captions unavailable
  → Store RAW transcript (never deleted, source of truth)
        │
        ▼
Step 2: Transcript cleaning (LLM)
  → For curated transcripts: lighter pass — add [MM:SS] timestamps, standardize formatting, verify speaker labels
  → For YouTube captions: heavier pass — remove verbal fillers, clean false starts, group into paragraphs, attempt speaker attribution from context
  → Both: preserve original meaning — readability pass, not rewrite
  → Store CLEANED transcript alongside raw (both kept)
        │
        ▼
Step 3: Entity extraction (LLM)
  → Fund names (including aliases: "Marc Rowan's shop" → Apollo)
  → Parent/subsidiary relationships (Redding Ridge → Apollo)
  → Key people (name, title, fund affiliation)
  → Sectors, themes, portfolio companies mentioned
  → Return as structured JSON
        │
        ▼
Step 4: Prep bullet generation (LLM) ← PRE-GENERATED
  → 3-5 prep bullets per appearance
  → Each bullet includes 1-3 supporting quotes with timestamps
  → Stored in database, ready for instant retrieval
        │
        ▼
Step 5: Index in repository
  → Full-text search (Postgres tsvector) on cleaned transcript
  → Entity tags as searchable JSONB
  → Pre-generated bullets stored as JSONB
  → Source metadata (URL, date, title, source name, speakers)
  → appearance_date as proper DATE field (for sorting, filtering, recency)
```

The entity extraction step is where the LLM earns its keep. Simple full-text search for "Apollo" misses "Rowan's firm" and "Redding Ridge." LLM-assisted tagging during indexing catches these.

**What's pre-generated vs. on-demand:**

| Content | When generated | Why |
|---------|---------------|-----|
| Cleaned transcript | Ingestion | One-time cost, always ready |
| Entity tags | Ingestion | Must exist for matching to work |
| Per-appearance prep bullets + quotes | Ingestion | Instant lookup, no waiting |
| Fund overview (cross-appearance synthesis) | On-demand, then cached | Depends on which appearances match the query; cache invalidated when new appearances for that fund are added |

Fund overview is the one piece generated on-demand because it synthesizes across a dynamic set of matching appearances. Once generated for a fund, it's cached and only regenerated when new content for that fund is ingested.

---

## Data Model

### Appearances Table

| Field | Type | Notes |
|-------|------|-------|
| id | UUID | Primary key |
| source_url | TEXT | YouTube URL or podcast site URL. Kept for reprocessing (e.g., future speaker diarization) |
| transcript_source | TEXT | Which scraper pulled this: "colossus", "capital_allocators", "acquired", "youtube_captions", "youtube_whisper" (future). System field — determines cleaning pass intensity. |
| source_name | TEXT | Human-readable source: "Invest Like the Best", "Capital Allocators", "Goldman Sachs Talks", "Milken Institute Panel", etc. Free text — displayed in UI. |
| title | TEXT | Appearance title |
| appearance_date | DATE | Proper date field — used for sorting, filtering, recency weighting, age flags |
| speakers | JSONB | Array of speakers with roles: `[{"name": "Marc Rowan", "role": "guest", "affiliation": "Apollo"}, {"name": "Patrick O'Shaughnessy", "role": "host"}]`. Roles: "host", "guest", "panelist", "moderator", "interviewer". |
| raw_transcript | TEXT | Unmodified transcript as extracted. Never overwritten. Source of truth. |
| raw_caption_data | JSONB | YouTube caption segments with timestamps (preserved for reprocessing) |
| cleaned_transcript | TEXT | LLM-cleaned version with [MM:SS] timestamps and speaker attribution |
| entity_tags | JSONB | Fund names, aliases, parent relationships, people, sectors |
| prep_bullets | JSONB | Pre-generated bullets with supporting quotes and timestamps (see structure below) |
| processing_status | TEXT | "queued", "extracting", "cleaning", "analyzing", "complete", "failed" |
| processing_error | TEXT | Error message if failed |
| created_at | TIMESTAMP | |
| updated_at | TIMESTAMP | |

### Fund Overview Cache Table

| Field | Type | Notes |
|-------|------|-------|
| fund_name | TEXT | Primary key (normalized fund name) |
| overview_text | TEXT | LLM-generated fund overview |
| appearance_ids | UUID[] | Which appearances contributed to this overview |
| generated_at | TIMESTAMP | Cache timestamp |

Invalidated when a new appearance is ingested that matches this fund.

### Domain Mapping Table (for future calendar integration)

| Field | Type | Notes |
|-------|------|-------|
| domain | TEXT | Primary key (e.g., "apollo.com") |
| fund_name | TEXT | Mapped fund name |
| added_by | TEXT | Who added this mapping |
| created_at | TIMESTAMP | |

### Prep Bullets Structure (JSONB)

```json
{
  "bullets": [
    {
      "text": "Apollo evaluates deals on complexity premium — they seek situations others find too messy",
      "supporting_quotes": [
        {
          "quote": "We're not trying to generate the highest return. We're trying to find the things that are so complex that other people don't want to deal with them.",
          "timestamp_seconds": 863,
          "timestamp_display": "14:23"
        },
        {
          "quote": "The best deals we've done in the last five years were ones where three other firms passed because the structure was too ugly.",
          "timestamp_seconds": 1847,
          "timestamp_display": "30:47"
        }
      ],
      "vote": null,
      "vote_note": null
    }
  ],
  "rowspace_angles": [
    {
      "text": "Apollo's frustration with generic manager pitches is an opening — lead with specific sourcing edge and how Rowspace surfaces differentiated deal flow",
      "vote": null,
      "vote_note": null
    }
  ]
}
```

**`vote` / `vote_note` fields:** Users can thumbs up/down individual bullets and Rowspace angles. `vote` is `"up"`, `"down"`, or `null`. `vote_note` is an optional one-line reason ("out of context", "too generic", "wrong speaker"). After 50-100 ratings, pull all thumbs-down items to identify prompt weaknesses and tune accordingly.

**`rowspace_angles`:** LLM-generated suggestions connecting transcript insights to Rowspace's value proposition. Bridges the gap between "knowing about the fund" and "knowing how to pitch them." See prep bullet prompt template for details.

---

## v1 Scope

### Interface 1: Manual Lookup (Primary)

A simple web page. Type a fund name → get results instantly (all content is pre-generated).

**Input:** Text field. "Apollo", "Sequoia", "Bridgewater", etc.

**Matching logic:**
1. Search entity tags (catches aliases, parent/subsidiary, key people)
2. Full-text search on cleaned transcripts (catches direct mentions)
3. LLM-assisted fuzzy match as tiebreaker ("did the user mean X?") — only if steps 1-2 return nothing

**Results are sorted by recency** (newest appearances first). Appearances older than 3 years get a subtle age flag: "⚠️ 2019 — thesis may have evolved."

**Output:**

```
Apollo Global Management
Fund Overview: Apollo is a $600B+ alternative asset manager
increasingly focused on retirement services via Athene. Led by
Marc Rowan. Known for complexity-premium investing — seeks
situations others avoid. Recent focus on GP stakes and
secondaries infrastructure.

━━━━━━━━━━━━━━━━━━━━━━━

3 appearances found

─────────────────────────
Invest Like the Best — "Marc Rowan on Apollo's Evolution"
March 2024 · Patrick O'Shaughnessy (host), Marc Rowan (guest)
🔗 Source link

Key Takeaways:                                          👍 👎
• Apollo is shifting toward retirement services as primary growth
  engine — Athene now drives more capital than traditional PE ¹
• Rowan emphasized they evaluate deals on "complexity premium"
  not just returns — look for situations others find too messy ¹²
• Expressed frustration with managers who pitch generic "we have
  alpha" — wants to hear specific sourcing edge ¹

Rowspace Angles:                                         👍 👎
• Their frustration with generic pitches is an opening — lead
  with how Rowspace surfaces differentiated, hard-to-find deal flow

[Generate Notion Doc] [View Cleaned Transcript] [View Raw Transcript]
─────────────────────────
⚠️ Appearance from 2020 — thesis may have evolved
Goldman Sachs Talks — Apollo Panel at Investor Day
November 2020 · 🔗 Source link
...
```

**Citation tooltips (web UI):** Superscript markers on bullets. Hover → tooltip shows supporting quote + clickable `[▶ 14:23]` timestamp link (opens source at that moment). Clean surface, evidence on demand.

**"Generate Notion Doc" button:** One click → formatted Notion doc with bullets in body text, supporting quotes as Notion comments with source timestamp URLs.

**"View Cleaned Transcript":** Timestamped, paragraph-broken, speaker-attributed version. Click any `[MM:SS]` → opens source at that moment.

**"View Raw Transcript":** Unmodified original. Available for verification if the cleaned version seems off.

### Citation Pattern: Bullets → Quotes → Timestamps

Each prep bullet synthesizes an insight — potentially drawing from multiple parts of the transcript. Supporting quotes link back to specific moments:

**Web UI:** Bullets display with small citation markers (superscript ¹²). Hover a marker → tooltip shows the direct quote + clickable `[▶ 14:23]` source timestamp link. The surface is clean (bullets only); evidence is one hover away.

**Notion doc:** Same bullets as body text. Supporting quotes with source timestamp URLs live in Notion comments attached to each bullet. Skimming = bullets only. Verifying = open comment thread.

**Cleaned transcript timestamps:** Independently of the bullets, the cleaned transcript preserves timestamps at each topical paragraph break. During the cleaning step, the LLM groups caption segments into topical paragraphs and assigns each the start timestamp of its first segment. These render as clickable margin timestamps in both the web UI and the Notion doc.

### Interface 2: URL Submission

**Single URL:** Paste a URL (YouTube video, podcast site page, etc.) → system queues it for processing → status updates in real-time → content appears in repository once complete.

**Bulk import:** Paste or upload a list of URLs (one per line, or CSV). System queues them all. Progress indicator: "Processing 47/50 — 3 failed (retry available)." This is how you bootstrap the repository on day one.

**Processing visibility:** Each URL shows its pipeline status: queued → extracting transcript → cleaning → extracting entities → generating bullets → complete. If a step fails, the error is visible and the item is retryable.

### Interface 3: Notion Output

One-click generation from the lookup results. Structure:

```
Meeting Prep: Apollo Global Management
Generated: March 1, 2026

━━━━━━━━━━━━━━━━━━━━━━━

Fund Overview:
Apollo is a $600B+ alternative asset manager increasingly focused
on retirement services via Athene. Led by Marc Rowan. Known for
complexity-premium investing — seeks situations others avoid.

━━━━━━━━━━━━━━━━━━━━━━━

Appearance 1: "Marc Rowan on Apollo's Evolution"
Source: Invest Like the Best · March 2024
Link: [Source URL]

Key Takeaways:
• Apollo evaluates deals on complexity premium — they seek
  situations others find too messy ¹²
  [Notion comment ¹: "We're not trying to generate the highest
   return..." ▶ 14:23 → [source URL with timestamp]]
  [Notion comment ²: "The best deals we've done in the last
   five years..." ▶ 30:47 → [source URL with timestamp]]
• [Bullet 2 with supporting quote comments...]
• [Bullet 3...]

Full Transcript (cleaned, with timestamps):
[14:23] We started thinking about this differently around 2018...
[14:58] The traditional model assumes you're competing on returns...
[15:34] But what we found is that complexity itself is a moat...

━━━━━━━━━━━━━━━━━━━━━━━

⚠️ Appearance from 2020 — thesis may have evolved

Appearance 2: Apollo Panel at Investor Day
Source: Goldman Sachs Talks · November 2020
Link: [Source URL]
...
```

Supporting quotes live as Notion comments — the doc body stays clean and scannable. Quick prep = read bullets. Going deeper = open comments for evidence + click through to source timestamps.

The Fund Overview at the top synthesizes across ALL matching appearances. Recency-weighted: the LLM is instructed to prioritize recent appearances and note when older appearances may reflect outdated views.

**If no matching appearances found:** Still creates a doc, but says "No public appearances found for [Fund Name]. Consider manual research." Absence of data is visible, not silent.

### Interface 4: Admin / Status

- View all indexed content (sortable by date, source, fund, status)
- Processing queue with real-time status
- Failed items with error messages and retry button
- Domain → fund mapping table (editable, for future calendar integration)
- Basic stats: total transcripts, unique funds covered, processing success rate

---

## LLM Prompt Templates

v1 is hardcoded for Rowspace's sales context. Stored in a config/database field (not in application code) so it's easy to swap for v2.

### Transcript Cleaning

```
Clean this transcript for readability.

Rules:
- Remove verbal fillers (um, uh, you know, like, sort of, I mean)
- Clean false starts and repeated phrases
- Group caption segments into topical paragraphs
- Begin each paragraph with the timestamp [MM:SS] of its first
  caption segment
- Where speakers are identifiable from context (host vs guest,
  moderator vs panelist, interviewer vs subject, names used,
  role references), add speaker labels
  (e.g., "Patrick:" / "Marc Rowan:" / "Moderator:")
- Do NOT rewrite, summarize, or alter meaning
- This is a readability and formatting pass only

Preserve ALL substantive content. When in doubt, keep it.
```

### Entity Extraction

```
Given this transcript, extract the following as structured JSON:

1. fund_names: All investment fund names mentioned
   - Include formal names AND informal references
     ("Marc Rowan's shop" → "Apollo Global Management")
   - Include aliases and abbreviations
2. parent_subsidiary: Relationships between entities
   (e.g., {"parent": "Apollo Global Management",
    "subsidiary": "Redding Ridge Asset Management"})
3. key_people: Array of {name, title, fund_affiliation}
4. sectors_themes: Investment sectors and themes discussed
5. portfolio_companies: Specific companies or deals referenced

Be thorough. Informal references matter — a salesperson needs
to find this transcript when searching for any related entity.
```

### Prep Bullet Generation

```
You are preparing a sales team for a meeting with an investment
fund. Below is a transcript from a public appearance (podcast,
conference panel, fireside chat, or interview) where someone from
or related to this fund spoke in depth.

Generate 3-5 bullets most useful for a sales conversation:

1. Investment thesis — what they look for, how they evaluate
   opportunities, what excites them right now
2. Pain points — frustrations with current tools, processes,
   or managers. Things they wish were better.
3. Sector/theme focus — specific areas of interest, emerging
   themes they're tracking
4. Relationship hooks — personal interests, communication style,
   things that would make the conversation feel less cold
5. Portfolio/deal references — companies or deals they mentioned
   that could be relevant as social proof or competitive context

Format: concise bullets, each 1-2 sentences. Lead with the most
actionable insight. Skip generic observations.

For each bullet, include 1-3 direct supporting quotes from the
transcript with their approximate timestamps. The bullet should
synthesize the insight; the quotes are the evidence.

Then generate 1-2 "Rowspace Angles" — specific ways Rowspace
could be relevant to this fund based on what was discussed.
Connect transcript insights to Rowspace's value proposition.
These should be actionable pitch hooks, not generic suggestions.

Context on Rowspace: [Rowspace description injected here]

Return as structured JSON:
{
  "bullets": [
    {
      "text": "...",
      "supporting_quotes": [
        {"quote": "...", "timestamp_seconds": N, "timestamp_display": "MM:SS"}
      ]
    }
  ],
  "rowspace_angles": [
    {
      "text": "..."
    }
  ]
}
```

### Fund Overview (on-demand, cached)

```
Given these transcript excerpts about [fund_name] from [N]
appearances spanning [date range]:

Generate a 3-5 sentence overview of this fund's investment
approach, current focus areas, and any consistent themes.

Weight recent appearances more heavily. If older appearances
(3+ years) contradict recent ones, note that the fund's
approach appears to have evolved.

Write for a salesperson who needs to sound informed in 30 seconds.
```

**v2/v3 head-nod:** Templates stored in database. Rowspace's version is the default. In v2, teams edit via UI. In v3, template library.

---

## Transcript Handling: Raw vs. Cleaned

Both versions are always stored. They serve different purposes:

| Version | What it is | When to use |
|---------|-----------|-------------|
| Raw transcript | Exactly as extracted from YouTube/source. Unmodified. | Source of truth. Verification. Reprocessing (e.g., re-running with improved prompts or adding speaker diarization later). |
| Cleaned transcript | LLM-processed: fillers removed, paragraphs added, timestamps assigned, speaker attribution attempted. | Primary reading surface. What users see by default. Navigable with clickable timestamps. |

**Speaker attribution in v1:** The LLM attempts to identify speakers from context (names mentioned, host/guest dynamics, role references). This is best-effort text inference, not audio analysis — a categorically weaker approach than true speaker diarization. Expect reliable results for two-person interviews with clear host/guest dynamics (host regularly names the guest, guest gives long substantive answers). Expect degraded results for panels and flowing conversations where multiple speakers contribute similar-length points without being named. Wrong attribution is less damaging than it sounds — the quote is still useful even if labeled "Speaker" instead of "Marc Rowan" — but set user expectations accordingly. Audio-based diarization in v2 replaces this entirely.

**Speaker diarization (future):** Proper diarization requires audio analysis, not text processing. Can be added later by reprocessing existing content: download audio from stored source_url (yt-dlp) → run through diarization service (pyannote, AssemblyAI) → map speaker labels back to transcript timestamps. Source URLs are stored as first-class fields specifically to enable this reprocessing without re-ingesting.

---

## Recency Handling

Investment theses shift. A fund's 2019 appearance may describe a strategy they've since abandoned. The system handles this at multiple levels:

**Data layer:** `appearance_date` is a proper DATE field. All queries sort by recency (newest first) by default.

**UI layer:** Appearances older than 3 years display a subtle age flag: "⚠️ 2020 — thesis may have evolved." Configurable threshold.

**Fund overview prompt:** The LLM is instructed to weight recent appearances more heavily and explicitly note when older appearances contradict newer ones ("Apollo's approach appears to have shifted from X in 2019 to Y in 2024").

**Future consideration:** Could add separate "Current Focus" vs. "Historical Themes" sections in the fund overview. Not needed for v1 with a small corpus, but valuable as the repository grows and spans 5+ years of content per fund.

---

## Domain → Fund Mapping

For the eventual calendar integration, the system needs to map email domains to funds.

**v1 approach:** Manual lookup table in Supabase, editable via admin page. Sufficient for Rowspace's active prospect list.

**Beyond v1:** LLM-assisted resolution. Given a domain like "reddinridge.com", ask the LLM: "What investment fund is associated with this domain? Include parent company relationships." LLMs are strong at this — it's world knowledge recall. Could also layer in Clearbit or similar enrichment APIs.

**Not blocking for v1.** The primary interface is manual fund name lookup. Domain mapping only matters when the calendar trigger is added.

---

## Technical Stack

| Component | Technology | Notes |
|-----------|-----------|-------|
| Web app | Next.js | Consistent with learning path |
| Database | Supabase (Postgres) | Full-text search via tsvector, JSONB for entities/bullets |
| YouTube transcripts | YouTube Data API | Auto-captions extraction with timestamps |
| Podcast transcripts | Site-specific scrapers (later) | One per curated source, passive subscriptions |
| LLM | Claude API | Entity extraction, prep bullets, transcript cleaning, fund overview |
| Output | Notion API | One-click doc generation with comments |
| Deployment | Vercel | Cron jobs for passive subscriptions (later) |
| Push (later) | Slack API | Calendar-triggered digest |
| Calendar (later) | Google Calendar API | OAuth per-user |

**Infrastructure cost estimate:** < $50/month. Primary variable cost is Claude API for transcript processing. At ingestion, each transcript runs through 3 LLM calls (cleaning, entity extraction, bullet generation) — estimated ~$0.20-0.50 per transcript. 130 transcripts to bootstrap = ~$25-65 one-time. Ongoing: ~$5-15/month for new content. Supabase and Vercel on free tiers.

---

## Build Sequence

### Phase 0: Bootstrap + Pipeline (~3-4 days)
- Supabase schema (appearances table with all fields, fund overview cache, domain mapping)
- Bulk URL submission UI (textarea, paste URLs, submit)
- Colossus scraper (authenticated, rate-limited ~1-2 sec between requests) for ILTB transcripts
- YouTube Data API integration as fallback (for sources without published transcripts)
- **Speaker attribution smoke test:** Before bulk processing, run 3-5 transcripts through the cleaning prompt — compare curated source (speaker labels already present) vs YouTube caption (LLM must infer). Validate that the pipeline handles both gracefully.
- Claude API integration for all three processing steps:
  - Transcript cleaning (lighter for curated sources, heavier for YouTube captions)
  - Entity extraction (funds, people, aliases, parent relationships)
  - Prep bullet generation (with supporting quotes, timestamps, and Rowspace angles)
- Store raw transcript, cleaned transcript, entity tags, and pre-generated bullets
- Queue processing with status tracking and progress visibility
- **Milestone:** Paste 20 ILTB Colossus URLs → all transcripts scraped, cleaned, entity-tagged, and bullets pre-generated. Can query database for "Apollo" and get instant results.

### Phase 1: Lookup UI (~3-4 days)
- Search page: text input → instant results (pure retrieval, no LLM calls)
- Matching logic: entity tags first, full-text search second
- Fund overview generation (on-demand for first query, then cached)
- Results display: fund overview + per-appearance cards with pre-generated bullets + Rowspace angles
- Thumbs up/down on individual bullets and Rowspace angles (with optional note)
- Citation tooltips (hover → supporting quote + source timestamp link)
- Cleaned transcript expandable view with clickable timestamps
- Raw transcript view (toggle)
- Recency sorting + age flags on old appearances
- **Milestone:** Type "Apollo" → instant results with bullets, quotes, timestamps, Rowspace angles, fund overview. Can rate individual bullets.

### Phase 2: Notion Output (~1-2 days)
- Notion API integration
- "Generate Notion Doc" button on results page
- Structured doc: fund overview + per-appearance bullets + Notion comments for quotes
- Cleaned transcript with timestamps in sub-pages or expandable sections
- Recency flags on old appearances
- **Milestone:** One click → formatted Notion doc with bullet comments linking to source timestamps

### Phase 3: Single URL + Admin (~1-2 days)
- Single URL paste interface (for one-offs)
- Admin/status view: all indexed content, queue, failures, retry
- Basic stats (total transcripts, unique funds, success rate)
- **Milestone:** Anyone on the team can contribute content; processing is visible and manageable

### Phase 4: Polish + Dogfood (~2-3 days)
- Edge case handling (no matches, processing failures, empty captions)
- Prompt iteration based on real usage (are bullets actually useful?)
- Error notifications
- Use for real Rowspace meetings, gather feedback
- **Milestone:** Used successfully for 5+ real meetings, prompts iterated at least twice

### Phase 5: Passive Subscriptions (stretch / early v2) (~2-3 days)
- Scraper for Invest Like the Best (Colossus website — human-edited transcripts)
- Scraper for 1-2 additional curated sources
- Vercel cron job to check for new content daily/weekly
- Auto-ingestion through full pipeline
- **Milestone:** New ILTB appearances appear in repository automatically

### Phase 6: Calendar Integration (v1.5 / v2) (~3-4 days)
- Google Calendar OAuth
- Calendar scanner (parse external attendees, extract domains)
- Domain → fund lookup table + admin UI
- Wire to existing lookup (content already pre-generated, just match and deliver)
- Slack DM digest
- Vercel cron for scheduled scans
- **Milestone:** Monday morning Slack DM with prep links for the week's meetings

**Total v1 (Phases 0-4): ~2-2.5 weeks**
**With Phase 5: ~3 weeks**
**With Phase 6: ~3.5-4 weeks**

---

## Bootstrap Strategy

Day one: paste bulk URLs from curated sources to seed the repository.

**Starting corpus suggestion:**
- Invest Like the Best (Colossus): last 50 appearances (human-edited transcripts, free Google auth)
- Capital Allocators: last 30 appearances (published transcripts)
- Acquired: last 20 appearances (published transcripts)
- Odd Lots: last 20 appearances (published transcripts)
- Goldman Sachs Talks / Milken / major conference panels: 10-20 relevant YouTube videos (auto-captions or audio transcription as fallback)

That's ~120-140 transcripts covering probably 80+ unique funds. The curated sources provide dramatically better input quality than YouTube auto-captions — proper speaker labels, punctuation, and edited for readability. Enough to make the lookup tool immediately useful for Rowspace.

As the team uses the tool, they'll naturally add more content via single URL submission ("I found this great panel with our prospect"). The repository grows organically.

---

## Key Risks

### Content & Quality

**YouTube auto-caption quality (fallback path only).** With curated sources (Colossus, Capital Allocators, Acquired, Odd Lots) as the primary ingestion path, YouTube captions are only needed for conference panels and one-off videos without published transcripts. Some channels have recently disabled auto-captions entirely. For YouTube content without captions, the fallback is audio download + AssemblyAI/Whisper. See "On the Horizon" for details.

**Transcript cleaning may introduce distortion.** Removing fillers and cleaning false starts could subtly alter meaning. Mitigation: keep raw transcript always accessible. Cleaning prompt emphasizes "readability pass, not rewrite" and "when in doubt, keep it." For curated sources with human-edited transcripts, the cleaning step is much lighter (formatting + timestamps only). Speaker attribution from text is best-effort for YouTube content; curated sources already have speaker labels.

**Prompt quality.** Prep bullets are only as good as the prompt. If they're generic, the tool is useless. Mitigation: BZ is both builder and user — tight feedback loop. Iterate on prompts with real transcripts and real meetings. Pre-generation means you can re-run prompts on existing content when you improve them.

### Entity Matching

**Entity extraction drift.** LLM-based alias resolution and parent/subsidiary mapping will work ~80% of the time and fail silently ~20%. False positives (wrong fund matched to an appearance) are worse than false negatives (missed a relevant mention). Mitigation for v1: manually review entity tags for the first 50 transcripts, tune the extraction prompt. Accept some noise. The admin UI lets you spot and fix bad tags. Formal confidence scores and audit logs are v2.

**Fund name matching is fuzzy.** "Bridgewater Associates" might appear as "Bridgewater," "Ray Dalio's fund," or just "Ray Dalio." Mitigation: entity extraction prompt explicitly asks for informal references and aliases. Match on fund names AND key people.

### Technical

**YouTube Data API quotas.** Default quota is 10,000 units/day. Each caption request costs ~200 units. That's ~50 transcripts/day — plenty for bulk import and ongoing ingestion. Shouldn't be a bottleneck.

**Transcript length vs. context window.** Long appearances (2+ hours) produce transcripts of 15-20K words. Claude handles this comfortably for single operations (cleaning, bullet generation). Entity extraction on very long transcripts could miss cross-section themes if chunked. Mitigation for v1: send full transcripts (within Claude's context window). Only build chunking logic if you actually hit the limit. Most podcast appearances are 60-90 minutes and well within bounds. See "On the Horizon" for chunking strategy when this becomes relevant.

**Processing latency at ingestion.** Each transcript runs through 3 LLM calls. At ~30-60 seconds per call, that's 2-3 minutes per transcript. For bulk import of 130 transcripts, that's ~4-6 hours of processing. Mitigation: queue-based processing with clear progress indicators. Processing happens in background; user can use the tool for already-completed content while the rest processes.

---

## What's Deliberately Out of Scope (v1)

- Calendar integration (Phase 6, v1.5/v2)
- Slack push notifications (comes with calendar)
- Passive source subscriptions (Phase 5, stretch goal)
- Editable prompt templates UI (hardcoded for Rowspace)
- Multi-team support
- LLM-assisted domain → fund resolution (manual table)
- Speaker diarization from audio (LLM text-based attribution only — see "On the Horizon")
- Higher-accuracy transcription via AssemblyAI/Whisper (YouTube auto-captions + LLM cleaning for v1 — see "On the Horizon")
- Audio transcription for non-YouTube sources without published transcripts
- Confidence scores on entity extraction
- Audit logs for entity changes
- Billing
- Content sources beyond YouTube + curated podcast sites

---

## v2/v3 Roadmap (Not Building Now)

### v2: Assembled Pilot + Calendar
- Calendar integration with Slack push
- LLM-assisted domain → fund resolution
- Editable prompt templates via UI
- Add/remove subscription sources via UI
- Multi-user auth (team members connect own calendars)
- Audio upload + transcription (Whisper) for content not on YouTube
- Speaker diarization via audio processing — see "On the Horizon" for approach
- Transcript accuracy upgrade (AssemblyAI/Whisper) — see "On the Horizon" for approach
- Confidence indicators on entity extraction
- Entity override UI + audit log

### v3: PLG Sales Tool
- Self-serve onboarding
- Template library (sales to funds, VC meeting prep, consulting, recruiting)
- Broader content indexing (earnings calls, SEC filings, blog posts, tweets)
- Configurable output destinations (Google Docs, Confluence, email)
- Billing (usage-based or per-seat)
- Auto-enrichment for domain → company mapping
- Shared transcript repository across customers (anonymized)
- "Current Focus" vs "Historical Themes" sections in fund overview
- Transcript chunking for cross-appearance synthesis at scale — see "On the Horizon"

---

## On the Horizon (Known Upgrade Paths)

These aren't v2/v3 features — they're known quality and scale improvements that become relevant as the repository grows. The v1 architecture supports all of them without a rewrite.

### Transcript accuracy upgrade (YouTube path only)

Only relevant for YouTube/conference content — curated sources already provide human-edited transcripts. v1 uses YouTube auto-captions (roughly 85-90% accurate for clear English podcast audio) cleaned by LLM, when captions are available. Some channels have recently disabled auto-captions entirely. The upgrade path: download audio from the stored source URL (yt-dlp) → run through AssemblyAI or Whisper (~95-98% accuracy for clean audio, ~$0.15-0.37/hour). This is a pipeline swap, not a rearchitecture — source URLs are stored as first-class fields, raw transcripts are preserved, and reprocessing just re-runs the pipeline on better input. Trigger: when YouTube content without auto-captions becomes a meaningful share of the repository, or when caption quality visibly degrades bullet quality.

### Speaker diarization from audio

Only relevant for YouTube/conference content — curated sources (Colossus, Capital Allocators, Acquired, Odd Lots) already have human-edited speaker labels. v1 uses LLM text-based speaker attribution for YouTube content (best-effort, reliable for two-person interviews, degrades for panels). The upgrade: download audio → run through a diarization service (AssemblyAI, pyannote) that identifies speakers from voice signatures (~90%+ accuracy for 2-speaker podcasts, ~85% for panels). Map speaker labels back to transcript timestamps. Stored source URLs make this a queue job, not a migration. Trigger: when YouTube-sourced content is a significant share of the repository and speaker attribution errors are frequent enough to erode trust.

### Transcript chunking

Two related problems that emerge at scale:

**Long individual transcripts.** Appearances over 2 hours produce 15-20K+ word transcripts. v1 sends full transcripts to Claude, which handles this comfortably for most appearances. If transcripts exceed context window limits, the chunking strategy is: split by topical segments (using timestamps), process each chunk for entity extraction and bullet generation independently, then merge results. Risk: cross-chunk themes may be missed. Mitigation: overlap chunks by 2-3 paragraphs to preserve context at boundaries.

**Cross-appearance synthesis at scale.** The fund overview synthesizes across all matching appearances. When a fund has 3-5 appearances, this is straightforward. At 15-20+ appearances, the combined bullet/metadata payload may get large. Strategy: feed the fund overview prompt the pre-generated bullets and metadata (not full transcripts) for each appearance, which is much more compact. If even that exceeds limits, use a map-reduce approach: summarize in batches of 5-7 appearances, then synthesize the batch summaries. Trigger: when any single fund has 15+ appearances in the repository.

Both chunking strategies are implementation details that don't change the data model or user experience — they're pipeline optimizations triggered by scale.

---

## Success Criteria

**v1 is successful if:**
1. Repository seeded with 100+ transcripts covering Rowspace's top 30 prospect funds
2. BZ uses manual lookup for real meeting prep for 2+ consecutive weeks
3. Prep docs surface at least one insight per meeting BZ wouldn't have known otherwise
4. Lookup is instant (< 1 second for pre-generated content, < 15 seconds for fund overview on first query)
5. Total build time from start to working lookup tool (Phases 0-1) is ≤ 2 weeks
6. At least one other Rowspace team member submits a URL to the repository unprompted

---

## Parking Lot (Open Questions)

### Must answer before building
1. ~~**Spot-check transcript availability.**~~ ✓ ANSWERED: ILTB (Colossus), Capital Allocators, Acquired, and Odd Lots all publish human-edited transcripts. Colossus requires free Google auth. YouTube auto-captions recently disabled on some channels (including ILTB). Curated sources are the primary ingestion path; YouTube is fallback.
2. ~~**Share 2-3 examples of manual prep that worked.**~~ DEFERRED to Phase 0 — first 20 processed transcripts serve as the tuning round. BZ will know instantly whether bullets are useful.
3. **How many active prospect funds does Rowspace track?** ~1,000. 130 seed transcripts covers ~13% — good starting point, not comprehensive. Single-URL submission (Phase 3) lets team fill gaps as meetings come up.

### Should answer during Phase 0-1
4. **Recency threshold.** 3 years as the "⚠️ thesis may have evolved" cutoff — is that right? Or should it be 2 years? 5 years?
5. **YouTube auto-caption language handling.** Some conference panels may have non-English segments or heavy accents that degrade caption quality. How to handle?
6. **Processing failure policy.** When a transcript fails at the entity extraction step, should it still be searchable via full-text? (Probably yes — partial processing is better than nothing.)

### Can answer during dogfooding (Phase 4)
7. **Are 3-5 bullets the right number?** Might some appearances warrant more? Should the prompt be adaptive based on transcript length?
8. **Is the fund overview synthesis useful at the current prompt quality?** Or does it smooth over the specific insights that matter?
9. **How often do users actually click through to source timestamps?** If rarely, the citation complexity may not be worth maintaining.
10. **Are Rowspace angles useful or generic?** Does the LLM produce actionable pitch hooks, or does it default to vague suggestions? Thumbs up/down data will reveal this.

### Future architecture questions
11. **When to add speaker diarization?** After how many users complain about speaker attribution? After Assembled pilot?
12. **Reprocessing strategy.** When you improve a prompt, do you reprocess all existing transcripts? Only recent ones? This has cost implications at scale.
13. **Should the repository be shared across customers in v3?** A fund's appearance is the same content regardless of who's looking it up. Shared indexing saves cost; per-customer indexing preserves privacy of what funds each team is researching.
