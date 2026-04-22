# Meeting Prep Tool — Technical Implementation Plan
**Last updated:** March 23, 2026
**Branch:** `main` (feature branches per PR)
**Status:** Phase 1E complete (PRs #41–54 merged). 59 appearances in prod (29 Colossus + 30 YouTube/manual). Next: save as default view, then Phase 2 (AssemblyAI diarization, bullet feedback).

---

---

## Migration History

| File | Status | Contents |
|------|--------|----------|
| `001_initial_schema.sql` | Deployed | appearances, fund_overview_cache, domain_mapping |
| `002_turns_and_summaries.sql` | Deployed | `turns` JSONB + `turn_summaries` JSONB + GIN index on turns |
| `003_tighten_anon_rls.sql` | Deployed | Row-level security tightening for anon role |
| `004_sections.sql` | Deployed | `sections` JSONB DEFAULT '[]' on appearances |
| `005_corrections.sql` | Deployed | `corrections` audit table for human edits to turns |
| `006_turns_corrected_flag.sql` | Deployed | Documents Turn.corrected boolean intent (no DDL) |
| `007_prompt_snapshot.sql` | Deployed (Phase 1B) | `prompt_context_snapshot TEXT` + `bullets_generated_at TIMESTAMPTZ` on appearances |
| `008_rename_raw_caption_data.sql` | Deployed (Phase 1D) | Renames `raw_caption_data` → `scraper_metadata` |
| `009_atomic_processing_warning.sql` | Deployed | Postgres RPC for atomic `append_processing_warning` / `remove_processing_warning` |
| `010_processing_detail.sql` | Deployed | `processing_detail TEXT` column on appearances |
| `011_corrections_extend.sql` | Deployed | ALTER corrections: turn_index nullable, field CHECK adds 'role' |
| `003_embeddings.sql` | Not created — Phase 5 | `transcript_chunks` table + pgvector extension + HNSW index |

---

## Database Schema

### appearances table
```
id (UUID PK)
source_url (TEXT UNIQUE)
transcript_source (TEXT: "colossus"/"capital_allocators"/"acquired"/"youtube_captions"/"youtube_whisper"/"manual")
source_name (TEXT)
title
appearance_date (DATE)
speakers (JSONB: [{name, role, title?, affiliation?}])  — human-validated speaker profiles. role: "host"|"guest"|"rowspace"|"customer"|"other". title/affiliation override entity_tags.key_people when set.
raw_transcript (TEXT)
scraper_metadata (JSONB)                         — general-purpose scraper output (YouTube: caption segments; Colossus: sections + episode number)
cleaned_transcript (TEXT)
turns (JSONB: [{speaker, text, turn_index}])     — parsed from speaker-labeled transcript at ingest
turn_summaries (JSONB: [{speaker, summary, turn_index}]) — LLM-generated, one per turn, under 20 words each
sections (JSONB: [{heading, anchor, turn_index?, start_time?, source?}]) — Colossus: scraped from HTML (source: "source"); YouTube: chapters (source), description (derived), or LLM (inferred)
entity_tags (JSONB)
prep_bullets (JSONB)
prompt_context_snapshot (TEXT)                    — Rowspace business context at bullet generation time
bullets_generated_at (TIMESTAMPTZ)                — when bullets were last generated
processing_status (TEXT: queued/extracting/cleaning/analyzing/complete/failed)
processing_error (TEXT)                              — can contain warnings (pipe-separated) on complete appearances, not just fatal errors
processing_detail (TEXT)                             — human-readable summary of pipeline output (e.g., "97% timestamped, 10 bullets, 87 turns")
created_at, updated_at
transcript_search_vector (tsvector GENERATED from cleaned_transcript)
```

### turns JSONB shape
```typescript
interface Turn {
  speaker: string;
  text: string;
  turn_index: number;
  section_anchor?: string;       // stamped at parse time from sections[]; undefined before first heading
  corrected?: boolean;           // true if human-verified — set by speaker rename, turn re-attribution, and text editing APIs
  timestamp_seconds?: number;    // YouTube only (Phase 1) — extracted from scraper_metadata
  attribution?: "source" | "derived" | "inferred";  // "source" = from original transcript, "derived" = mechanically extracted, "inferred" = LLM-attributed. Omitted on legacy turns (treated as "source").
}
```

### turn_summaries JSONB shape
```typescript
Array<{
  speaker: string;
  summary: string;
}>
```

### sections JSONB shape
```typescript
interface SectionHeading {
  heading: string;   // human-readable: "Apollo's DNA"
  anchor: string;    // slug: "apollos-dna"
  turn_index?: number;    // which turn starts this section
  start_time?: number;    // seconds into video (YouTube chapters)
  source?: "source" | "derived" | "inferred";  // data trust tier
}
```

**Citation link construction:**
- Colossus: `source_url + "#" + section_anchor` → browser scrolls to section
- YouTube (Phase 1): internal page navigation only — anchors are synthetic, no external URL target
- YouTube timestamps (Phase 1): `source_url + "&t=" + timestamp_seconds`

### prep_bullets JSONB shape (supporting_quotes)
```json
{
  "quote": "Exact quote",
  "speaker": "John Zito",
  "section": "Inside the $800B Gorilla",
  "section_anchor": "inside-the-800b-gorilla",
  "timestamp_seconds": null,
  "timestamp_display": null
}
```

### entity_tags JSONB shape
```typescript
{
  fund_names: Array<{
    name: string;           // canonical fund name
    aliases: string[];      // informal references found in transcript
    type: "standalone" | "subsidiary";
    parent?: string;        // flat, one-level only (current limitation — see tech debt #18a)
    relevance?: "primary" | "mentioned";  // is the interview ABOUT this fund? (optional — absent on legacy data)
  }>;
  key_people: Array<{
    name: string;
    title: string;          // extracted from transcript context, not enriched
    fund_affiliation: string;
  }>;
  sectors_themes: string[];       // free-text, no controlled vocabulary (see note below)
  portfolio_companies: string[];
}
```

**Known limitation — organization hierarchy:** The `parent` field is flat (one level). Real-world fund structures are often 4–5 entities deep with JVs, credit arms, spin-offs, and co-investment vehicles. See tech debt #18(a) for the planned rework (`mentioned_as` / `canonical_name` / `relationship` / `affiliated_entities`).

**Known limitation — `sectors_themes`:** Unstructured `string[]` by design. The LLM generates whatever themes it finds in the transcript — no controlled vocabulary, no normalization ("private credit" vs. "direct lending" may appear inconsistently across appearances). Sufficient for display and fuzzy search. If filtered views or aggregations are needed (Phase 3+), add a coarse `sector_category` enum alongside free-text themes — preserves the LLM's specificity while enabling reliable filtering.

**Known limitation — `key_people` titles:** Titles are extracted from what's said in the transcript, not enriched from external sources. "John Zito, who runs credit at Apollo" becomes `title: "runs credit"` or similar — good enough for prep context, not authoritative.

**Two-layer speaker metadata:** `speakers[]` is the human-validated layer (names, roles, titles). `entity_tags.key_people[]` is the LLM-generated draft. Enrichment precedence: `speakers[].title ?? entity_tags.key_people[].title`. Speaker edits write to `speakers[]` only — `entity_tags` is updated during renames (name propagation) but not for title/role changes.

### fund_overview_cache
`fund_name (TEXT PK), overview_text, appearance_ids (UUID[]), generated_at`

**When fund overview synthesis is built:** filter to appearances where this fund's `relevance` is `"primary"`. Passing mentions should not feed the synthesis prompt. Search already sorts primary before mentioned.

### domain_mapping
`domain (TEXT PK), fund_name, added_by, created_at`

### transcript_chunks table (Phase 5 — not yet created)
`id (UUID PK), appearance_id (UUID FK → appearances), chunk_index (INT), chunk_text (TEXT), embedding (vector(1536)), created_at`
Unique constraint on `(appearance_id, chunk_index)`.

---

## Chunking Design

### Two distinct chunking use cases — do not confuse

| Use case | File | Purpose | Chunk size | When |
|----------|------|---------|-----------|------|
| Pipeline splitting | `lib/pipeline/splitter.ts` | Stay within Anthropic API context window | ~120k chars | Only when `rawTranscript.length >= 120_000` |
| RAG chunking | `transcript_chunks` table | Precise semantic retrieval | ~2k chars (~500 tokens) | Phase 5, all transcripts |

`splitter.ts` was renamed from `chunker.ts` to disambiguate. These are unrelated features that happen to share the word "chunk."

### Pipeline splitting (splitter.ts) — Phase 0
Split preference order:
1. Section boundaries from scraped `sections[]` — cleanest, Colossus only
2. Speaker turn boundaries (double-newline blocks)
3. Hard paragraph boundary near 120k chars — last resort

Short transcripts (<120k chars) → `splitForProcessing` returns `[rawTranscript]` — callers don't branch.

Merge logic:
- `mergeCleaned`: join with `\n\n`
- `mergeEntityTags`: dedup key is `fund_names[].name` (case-insensitive); union aliases; first non-null parent/type wins
- `mergePrepBullets`: concat bullets[], dedup by `.text` exact match (known limitation — semantic dedup deferred); same for rowspace_angles

---

## Bullets Prompt Architecture

### Section injection
`lib/pipeline/bullets.ts` injects sections as a JSON lookup table:
```
## Sections Lookup Table
[{"heading": "Introduction", "anchor": "introduction"}, ...]
```

LLM returns `section` and `section_anchor` directly. Post-processing uses `sq.section_anchor ?? findSectionAnchor(sq.section, sections)` as fallback.

### Prompt variants
- `GENERATE_BULLETS_PROMPT_CURATED` — asks for section + section_anchor, no timestamps
- `GENERATE_BULLETS_PROMPT_YOUTUBE` — asks for timestamp_seconds + timestamp_display, no sections

### Known remaining gaps
- `rowspace_angles` has no `supporting_quotes` — add to schema + prompt after first batch review
- Few-shot examples not yet added — do after 3-5 transcripts processed, compare LLM output to manually written angles

---

## YouTube Pipeline (Phase 1) — Deferred Items

### Timestamps — ✅ Implemented (PR A, improved PR #27)
`turns[].timestamp_seconds` populated from caption segments via `extractTimestamps()` in `lib/pipeline/extract-timestamps.ts`. Two-pass algorithm:
- **Pass 1:** Forward-only word-overlap scan (4/6 threshold) with expected-position deviation constraint (`MAX_DEVIATION_SECONDS = 900`). Rejects false matches >15 min from expected position, preventing cascade orphaning.
- **Pass 2:** Bracketed recovery at relaxed 3/6 threshold. For each unmatched turn, finds nearest matched turns before/after as time brackets, searches only segments within that window. Safe because narrow brackets prevent false matches.
- Coverage: 49.5% (original) → 82.1% (pass 1) → 94.2% (pass 1+2) across 12 YouTube appearances. Deviation check integrated inline (not post-filter) to preserve valid nearby lower-overlap matches.
- `reprocessTimestamps()` orchestrator function + `scripts/reprocess-timestamps.ts` for reprocessing with proper warning/detail updates.
- Coverage validation warns if <80% of turns are timestamped.

### Chapters → Sections — ✅ Implemented (PR A)
YouTube chapters from yt-dlp metadata are mapped to `SectionHeading[]` with `start_time` and `source: "source"` in the scraper. Section-to-turn mapping (`mapSectionsToTurns()`) assigns `turn_index` from nearest timestamped turn. Videos without chapters get `sections: []`.

### Section Generation — ✅ Implemented (PR B1)
Three-tier cascade for YouTube sections, evaluated in order:
1. **Tier 1 (source):** yt-dlp chapters → `SectionHeading[]` in scraper (PR A)
2. **Tier 2 (derived):** `parseDescriptionSections()` in `lib/pipeline/parse-description-sections.ts` — regex parsing of description timestamps (MM:SS or H:MM:SS at line start). Requires ≥2 timestamp lines.
3. **Tier 3 (inferred):** `generateSections()` in `lib/pipeline/sections.ts` — LLM identifies 4-8 topic shifts, returns `turn_index` directly. Prompt in `lib/prompts/sections.ts`.

Cascade runs in orchestrator after timestamp extraction. `mapSectionsToTurns()` maps tiers 1-2 sections (which have `start_time`) to nearest timestamped turn. Tier 3 sections already have `turn_index` from LLM.

**Important:** YouTube section anchors are synthetic — no external URL to link to. Transcript page navigation works; citation links do not scroll an external page.

### YouTube chunking complexity (Phase 1+)
Colossus chunking is stateless — speaker names are inline. YouTube is not. Speaker identity is established early and referenced implicitly later. Chunks need a speaker context header injected:
```
Speakers identified so far:
- Speaker A: Marc Rowan (guest) — identified from intro
- Speaker B: Patrick O'Shaughnessy (host)
[chunk text follows]
```

---

## Observability Requirements (from CLAUDE.md)

All pipeline functions must have console.log bookends:
- `[step] starting, transcript length: X chars` — before the API call
- `[step] complete, X output tokens / chars` — after

Long-running steps (`clean.ts`) must also log chunk progress every 5 seconds via `setInterval` so you can confirm the connection is alive. **Never strip these logs** — they are the primary debugging signal for pipeline issues.

What the logs tell you:
- Token count climbing every 5s → healthy
- Token count frozen 30+ seconds → something is wrong
- Silence after `[clean] starting...` for >10 min → SDK timeout or rate limit

Add one-liner to Before Committing checklist: "Verify pipeline functions have console.log bookends."

---

## Streaming Architecture (clean.ts)

Three implementations were tried. Current (correct) approach:

| Attempt | Approach | Problem |
|---------|---------|---------|
| 1 | Blocking `messages.create` | Hard 10-min SDK wall clock cap — Alpha School (157k chars) exceeded it silently |
| 2 | `messages.stream` + `finalText()` | Works correctly — now the current approach for all three pipeline files |
| 3 (reverted) | `for await` async iterator | Manual accumulation loop; replaced with `finalText()` for consistency |

`max_tokens` bumped from 4096 → 8192 on `bullets.ts`. `clean.ts` uses `max_tokens: 64000`.

---

## Project Structure

```
lib/
  scrapers/
    colossus.ts                    ILTB/Colossus scraper (Playwright auth + Cheerio parsing)
    youtube.ts                     YouTube scraper (yt-dlp metadata + caption extraction)
    parse-turns.ts                 Parses SpeakerName:\ntext → Turn[], accepts attribution param
    registry.ts                    URL → scraper routing, detectTranscriptSource
    colossus.test.ts
    youtube.test.ts
    parse-turns.test.ts
    registry.test.ts
  pipeline/
    clean.ts                       LLM cleaning (streaming via finalText(), YouTube speaker attribution variant)
    entities.ts                    LLM entity extraction (manual JSON coercion, relevance tagging)
    bullets.ts                     LLM prep bullets (curated vs YouTube variants)
    splitter.ts                    Splits long transcripts for pipeline processing
    validate-speakers.ts           Post-clean speaker name validation (fuzzy match vs metadata)
    sections.ts                    LLM section generation for YouTube (tier 3) — ✅ IMPLEMENTED
    extract-timestamps.ts           Two-pass timestamp extraction + mapSectionsToTurns + stampSectionAnchors
    extract-timestamps.test.ts
    parse-description-sections.ts    Regex parsing of description timestamps (tier 2 sections)
    parse-description-sections.test.ts
    normalize-speakers.ts            Post-clean speaker name normalization (subset matching, no LLM)
    normalize-speakers.test.ts
    turn-summaries.ts                One-sentence per-turn summaries (parallel with entities)
    clean.test.ts
    entities.test.ts
    bullets.test.ts
    splitter.test.ts
    validate-speakers.test.ts
  prompts/
    clean.ts                       Two variants: CLEAN_TRANSCRIPT_PROMPT (curated) + buildYouTubeCleanPrompt (speaker attribution)
    entities.ts                    Entity extraction prompt (with relevance tagging)
    bullets.ts                     GENERATE_BULLETS_PROMPT_CURATED / _YOUTUBE + ROWSPACE_BUSINESS_CONTEXT
    turn-summaries.ts              Turn summary generation prompt
    overview.ts                    [Phase 1 stretch / Phase 2] — NOT YET BUILT
  db/
    client.ts                      Supabase client (server only)
    queries.ts                     Typed query functions: insert, update, search (relevance-sorted), fund cache
    types.ts                       DB row types (AppearanceRow, ExtractStepOutput, AppearanceListRow, etc.)
    queries.test.ts
  queue/
    orchestrator.ts                Coordinates pipeline steps per appearance (step-level + batch-level progress logging + validation guards)
    orchestrator.test.ts
  api/
    auth.ts                        Shared admin token check (checkAdminToken + unauthorizedResponse)
src/
  types/
    appearance.ts                  TranscriptSource, Speaker, Turn (with attribution), EntityTags, FundName, isYouTubeSource()
    scraper.ts                     Scraper interface, ScraperResult, SectionHeading
    bullets.ts                     PrepBulletsData, SupportingQuote
  app/
    layout.tsx                     Geist + Playfair Display + Source Sans 3 fonts
    page.tsx                       Phase 0 bulk paste UI
    globals.css
    transcript/[id]/
      page.tsx                     Server component — fetch + generateMetadata (OG tags, YouTube thumbnail)
      TranscriptViewer.tsx         Client orchestrator — keyboard, URL sync, playback (~101KB, ~60 state vars)
      SpeakerPanel.tsx             Speaker sidebar — rename, role, filter (useImperativeHandle ref)
      TurnRenderer.tsx             Single turn render — expand/collapse, editing (28 props, React.memo)
      helpers.tsx                  Shared utilities (highlightText, formatTimestamp, search)
      useAppearanceApi.ts          Data mutation hooks (rename, role, turn edit, re-attribution)
      RegenerateBulletsButton.tsx  Bullet regeneration via Server Action
      types.ts                     TranscriptViewerProps interface
    search/page.tsx                [Phase 1]
    api/
      process/
        submit/route.ts            POST — bulk URL submission
        run/route.ts               POST — trigger batch processing
        retry/[id]/route.ts        POST — retry single failed appearance
        status/route.ts            GET — processing queue status
        status/[id]/route.ts       GET — single appearance status
        bullets/route.ts           POST — single-appearance bullet regeneration
        bullets/bulk/route.ts      POST — bulk bullet regeneration
        turn-summaries/route.ts    POST — single-appearance turn summary regeneration
        turn-summaries/bulk/route.ts POST — bulk turn summary regeneration
        manual-ingest/route.ts     POST — manual transcript paste
      appearances/[id]/
        rename-speaker/route.ts    POST — cascading speaker rename across 6 data locations
        correct-turn/route.ts      POST — single-turn speaker re-attribution or text fix
        set-speaker-role/route.ts  POST — speaker role, title, affiliation updates
      feedback/route.ts            [Phase 2] — NOT YET BUILT
      notion/route.ts              [Phase 3] — NOT YET BUILT
      admin/stats/route.ts         [Phase 4] — NOT YET BUILT
supabase/
  migrations/
    001_initial_schema.sql
    002_turns_and_summaries.sql
    003_tighten_anon_rls.sql
    004_sections.sql
    005_corrections.sql            [Phase 2 prep]
    006_turns_corrected_flag.sql   [Phase 2 prep]
    007_prompt_snapshot.sql
    008_rename_raw_caption_data.sql
    009_atomic_processing_warning.sql
    010_processing_detail.sql
    011_corrections_extend.sql     ALTER corrections: turn_index nullable, field CHECK adds 'role'
    003_embeddings.sql             [Phase 5] — NOT YET CREATED
scripts/
  reprocess-timestamps.ts          Re-run timestamp extraction on all YouTube appearances
  reprocess-bullets.ts             Re-run bullet generation on all complete appearances
  reprocess-entities.ts            Re-run entity extraction on all complete appearances
  reprocess-turn-summaries.ts      Re-run turn summaries on all complete appearances
  measure-fix-impact.ts            Before/after measurement for timestamp algorithm changes
  simulate-pass2.ts                Pass 2 bracketed recovery simulation (diagnostic)
  batch-process-youtube.ts         Batch YouTube URL processing via local yt-dlp
  reprocess-speakers.ts            Re-extract speakers for YouTube appearances with generic names
  backfill-colossus-source.ts      One-time: add source: "source" to Colossus sections
  backfill-section-anchors.ts      One-time: regenerate turn_index + stamp section_anchor for orphan sections
  backfill-sections.ts             Re-scrape Colossus pages to populate sections + stamp section_anchor
```

---

## Pipeline Validation Pattern

Every LLM-dependent pipeline step has a validation guard that checks output quality without blocking the pipeline. On failure, a structured warning string is appended to `processing_error` via `appendProcessingWarning()` (pipe-separated for multiple warnings). The appearance still completes with `processing_status: "complete"`. Query `WHERE processing_error IS NOT NULL AND processing_status = 'complete'` to surface appearances needing review.

**Validations:**
1. **extract_too_short** — rawTranscript < 500 chars
2. **clean_ratio_warning** — cleaned/raw ratio outside 0.30–1.50
3. **turns_low_count** — < 5 turns from > 10k char transcript
4. **turn_summaries_incomplete** — LLM returned fewer summaries than turns (retries once, then writes partial)
5. **entities_no_funds** — 0 fund_names from > 10k char transcript
6. **bullets_low_count** — < 3 bullets from > 10k char transcript
7. **timestamp_coverage_low** — < 80% of turns timestamped (YouTube only)

---

## Build Phases

### Phase 0: Bootstrap + Pipeline ✓ COMPLETE

29 Colossus appearances scraped, cleaned, entity-tagged, and bullets generated. All in prod Supabase. Pipeline infrastructure (scraper, clean, entities, bullets, orchestrator, chunking for long transcripts) proven and stable.

**Milestone achieved:** Query Supabase for "Apollo" → rows with `raw_transcript`, `cleaned_transcript`, `turns`, `sections`, `entity_tags`, `prep_bullets` (section anchors populated) all present.

---

### Phase 1: Transcript Viewer + Lookup UI ✓ COMPLETE

**Branch:** `phase1/transcript-ui`

**Phase 1A — Transcript Viewer ✓ COMPLETE (redesigned March 23):**
- `/transcript/[id]` live on Vercel — 3-column app layout: sidebar (speakers, search, sections) | transcript body | prep panel (bullets, related)
- Header: ROWSPACE logo, source/title breadcrumb (hidden on mobile), date
- Sidebar: speaker cards with role/affiliation, transcript search (debounced 150ms), sections list with gold dots (cited) and blue dots (search hits), +/− expand/collapse all
- Transcript body: sections expand/collapse individually, guest turns fully expanded, host turns show AI summary or first sentence with `[more]`/`[less]` toggle in amber
- Timestamps: inline next to speaker names (not right-aligned), `#999` contrast, clickable to seek video
- YouTube player: 3 modes — collapsed (audio bar with play/pause, timer, progress bar), PiP (fixed bottom-right), full (sticky header). Single always-mounted container, CSS-positioned per mode. `onStateChange` syncs `isPlaying` including buffering state.
- Monologue handling: single-speaker transcripts skip section grouping, show "Monologue" header, sidebar shows "Topics" (non-interactive)
- Prep panel (right): Key Takeaways with supporting quotes (click to jump), bullet flagging with floating feedback panel
- Mobile responsive: `max-md` breakpoints switch to flex-col, natural document scroll, breadcrumb hidden, video panel hidden
- Cited turn badges: match by `section_anchor + speaker + quote text substring` (memoized via `citedTurnIndices` Set)
- Status routing: null → 404, processing → status page with refresh prompt, failed → error page with back link
- `section_anchor` stamped on Turn at parse time (parseTurns accepts sections[])

**Phase 1B — Orchestrator Improvements ✓ COMPLETE:**
- Chunk-level `Promise.all` parallelization for clean/entities/bullets steps
- `reprocessBullets()` — bullets-only reprocess mode (skips extract/clean/entities, reuses existing data)
- `POST /api/process/bullets` — single-appearance bullet regeneration
- `POST /api/process/bullets/bulk` — synchronous bulk regeneration with `p-limit(5)` concurrency cap, holds connection until complete
- `prompt_context_snapshot` column — snapshots Rowspace business context at bullet generation time
- `bullets_generated_at` column — records when bullets were last generated
- `ROWSPACE_BUSINESS_CONTEXT` extracted as separate constant for snapshotting
- "Regenerate Bullets" button on `/transcript/[id]` — calls `reprocessBullets` via Server Action, refreshes page data on completion

**Phase 1C — Search UI (BASIC — live on prod):**
- `/search` page live — server component with `SearchBar` client component, paginated list of all appearances (41 total)
- Table view: title (linked to transcript), source, date, speakers, bullet count
- Fund name search works via tsvector full-text search on `cleaned_transcript`
- **Not yet built:** `AppearanceCard` with bullet triage, `BulletItem` + `CitationTooltip`, `AgeFlag`, search-to-transcript deep linking with pre-loaded search

**Phase 1D — YouTube Pipeline ✓ COMPLETE:**
- ✓ YouTube scraper — yt-dlp for metadata + captions, speaker detection from title/description/channel, caption segments stored in `scraper_metadata`
- ✓ YouTube-specific clean prompt with speaker attribution — pass scraped speakers[] into clean step, LLM attributes dialogue turns from conversational context. Falls back to "Speaker 1/2" when metadata is absent. Re-parses turns from cleaned transcript for YouTube sources.
- ✓ Speaker attribution trust layer — `Turn.attribution: "source" | "inferred"` flag, `validateSpeakerAttribution()` catches hallucinated names via fuzzy matching, transcript viewer shows disclaimer for inferred turns
- ✓ Pipeline progress logging — step-level (`▶ Step 1/4: EXTRACT`) and batch-level (`═══ 1/5: Title ═══`) with cumulative elapsed time
- ✓ `isYouTubeSource()` shared helper in `src/types/appearance.ts` — single source of truth for YouTube detection
- ✓ Column rename: `raw_caption_data` → `scraper_metadata` (migration 008)
- ✓ Entity relevance tagging: `fund_names[].relevance: "primary" | "mentioned"` — prompt, types, search sorting
- ✓ `generateSections()` for YouTube transcripts — three-tier cascade: chapters (source), description timestamps (derived), LLM fallback (inferred). Also adds `parseDescriptionSections()` for tier 2.
- ✓ `turn-summaries` pipeline step — `generateTurnSummaries()` runs parallel with entities, `[{speaker, summary, turn_index}]` stored to `turn_summaries`. Transcript viewer shows AI summaries for collapsed host turns with fallback to first sentence.
- ✓ YouTube timestamp extraction — two-pass `extractTimestamps()` with deviation constraint + bracketed recovery (94.2% coverage). See "Timestamps" section above for details.
- ✓ YouTube chapters → sections — yt-dlp chapters mapped to `SectionHeading[]` with `start_time`, `turn_index`, and `source: "source"`
- ✓ `reprocessTimestamps()` orchestrator function — handles turns, sections, warnings, and processing_detail in one call. `scripts/reprocess-timestamps.ts` for bulk reprocessing.
- ✓ Timestamp coverage % shown first in `processing_detail` summary (e.g., "97% timestamped, 10 bullets, 87 turns, 17 entities")
- ✓ Admin table: appearance ID column (truncated, hover for full) + title links to `/transcript/[id]` for completed appearances
- ✓ Colossus section `source` field — backfilled `source: "source"` on all Colossus sections (PR #32, `scripts/backfill-colossus-source.ts`)
- ✓ Orphan inferred sections — backfilled `turn_index` and `section_anchor` for 7 YouTube appearances where `stampSectionAnchors` was missing at ingest time (PR #32, `scripts/backfill-section-anchors.ts`)
- ✓ Building Sixth Street sections — extracted 16 section headings from raw transcript (scraper had missed them due to HTML structure difference)
- ✓ Speaker name normalization verified — all 29 Colossus rows checked, no normalization needed
- ✓ Prod sync: 12 YouTube appearances copied dev → prod, section source backfilled on prod, migrations 009+010 confirmed on prod
- ✓ Stripped all `dark:` Tailwind variants from non-transcript pages (48 instances) — app is light-only
- ✓ Speakers[] backfill — after LLM cleaning, if speakers[] is empty, extract distinct speaker names from turns and populate with role: "guest" default. Ensures sidebar has data for Loom/call recordings where scraper finds no speaker metadata.
- ✓ Transcript viewer redesign (PR #36) — v0 + Claude Code. Three-column layout rebuilt.
- ✓ YouTube player modes (PR #37) — collapsed/pip/full with single always-mounted container, CSS positioning, onStateChange sync.

**Phase 1E — Transcript Viewer UX + Speaker Management ✓ COMPLETE (PRs #41–54):**

Speaker management + corrections (PR #41):
- ✓ Speaker sidebar panel — inline rename (cascading across 6 data locations), role dropdown (host/guest/rowspace/customer/other), title/affiliation editing
- ✓ API routes: rename-speaker (cascading), correct-turn (single turn), set-speaker-role
- ✓ `useAppearanceApi` hook — mutable state + API calls. enrichSpeakers() re-runs key_people lookup after updates.
- ✓ Reprocessing protection — `mergeCorrectedTurns()` preserves human-edited turns during pipeline re-runs
- ✓ Turn-level editing — re-attribution dropdown, text editing textarea. Generic speaker nudge scrolls to sidebar.
- ✓ Data quality review banner — triggered by data signals (generic speakers, inferred attribution, low timestamps). Dismissable, reactive.

Expand/collapse + URL sync (PR #42):
- ✓ Unified `expandedTurns: Set<number>` model — replaces separate host/guest logic
- ✓ Highlight mode (`?expanded=3,7,12`) vs normal mode (role-based defaults)
- ✓ `replaceState` sync — copy URL at any point for shareable highlight reel

Auto-follow playback (PR #43):
- ✓ Video `onTimeUpdate` drives `activeTurnIndex` — amber highlight, auto-scroll
- ✓ Skip-playback jumps between expanded turns only
- ✓ `autoFollowEnabled` toggle — j/k disables, `t` re-enables

Component refactor (PR #44):
- ✓ Extracted SpeakerPanel.tsx (useImperativeHandle), TurnRenderer.tsx (28 props, React.memo), helpers.tsx, useAppearanceApi.ts
- ✓ TranscriptViewer remains orchestrator at ~101KB

Keyboard shortcuts (PR #45):
- ✓ Full suite: j/k navigate, Space play/pause, m toggle, x hide, e edit, t seek, f follow, / search, ? help, n/p sections, 1-9 speaker filter, Esc priority chain, Shift+A/E speaker edit, Shift+R reset, Shift+X unhide all, </> speed

Admin polish (PR #46):
- ✓ Delete buttons, source_name column, clickable URL links

Shortcuts bar + OG metadata (PR #47):
- ✓ Context-aware sticky bottom bar with mode-sensitive shortcuts. ? help modal with 7 groups.
- ✓ `generateMetadata` — og:title, og:description (contextual quote hook or speaker list), og:image (YouTube thumbnail), og:site_name "bz-bot 🤖". Duration hardcodes 1.5x.

Speaker filter feedback (PR #48):
- ✓ Left accent border on filtered speaker's turns + scroll-to-first. Number keys 1-9. Save/restore expand state across filter round-trips.

Highlight reel duration (PR #49):
- ✓ Header: "~N min highlight · M min full call" adjusted for playback speed

Sticky video + control strip (PRs #50, #51):
- ✓ Full-mode video player stays pinned at top during scroll. Follow + mode switch controls visible.

Playback speed (PR #52):
- ✓ Default 1.5x, rates [0.75, 1, 1.25, 1.5, 2], </> shortcuts, speed badge. Dual state+ref pattern. sessionStorage persistence. Duration: 1.5x plain, other rates show "(N min at 1x)".

Hide turns (PR #53):
- ✓ `hiddenTurns: Set<number>` — view layer above expand/collapse. Placeholder bars ("3 hidden turns"), clickable to unhide. x/Shift+X shortcuts. `?hidden=` URL. Playback + j/k/n/p skip hidden. Search excludes hidden from counts.

Scroll occlusion fix (PR #54):
- ✓ `scrollIntoViewWithOffset()` replaces raw `scrollIntoView` — accounts for sticky video player

**Fund overview (Phase 1 stretch / Phase 2):**
- Write `lib/prompts/overview.ts` — synthesis prompt that receives `prep_bullets` + metadata from all matching appearances for a fund, produces a cross-appearance narrative (consistent themes, evolving views, key people)
- Wire cache-miss logic in `fund-overview/route.ts` — on search: check `fund_overview_cache` → hit: return cached → miss: gather `prep_bullets` from matched appearances, call overview prompt, write result to cache, return
- `FundOverviewCard` component — displays cached overview above individual appearance results on `/search`
- **Not blocking Phase 1 milestone.** Phase 1 search works without fund overview (individual appearances + bullets are the primary surface). Overview adds synthesis but is a separate LLM call on the query path. Build after core search is solid.

**Prompt improvements (ongoing):**
- Add `supporting_quotes` to `rowspace_angles` schema + prompt (tech debt #2)
- Add 2-3 few-shot examples to bullets prompt from real meeting prep usage (tech debt #3)

**Milestone:** Type "Apollo" → instant results. Click bullet → transcript viewer at correct section with search pre-loaded.

---

### Phase 2: Persistence + Quality

Trigger: dogfooding reveals specific quality issues or persistence needs.

**Pulled forward to Phase 1E (done):** Corrections table, inline turn editing, speaker reassignment, keyboard shortcuts, speaker management, data quality banner.

Remaining items:
- Save as default view — persist URL param snapshot (`expanded`, `hidden`, speaker filter) to a column on the appearance. Visitors with no URL params get the saved default. Explicit URL overrides saved default. Future: multiple named saved views.
- POST /api/feedback route — thumbs up / thumbs down on bullets with optional text feedback overlay. Replaces [×] flag (local state). Storage TBD (new `bullet_feedback` table or JSONB).
- Undo — revert turn to original value from corrections log; writes action: 'undone' to corrections table
- "Upgrade Transcript" flow — user-triggered re-extraction via AssemblyAI diarization API. Downloads audio via yt-dlp, sends to AssemblyAI async transcription with speaker_labels=True, replaces raw_transcript and updates transcript_source to "youtube_diarized". Re-runs full pipeline. Same deployment constraint as tech debt #20. Estimated cost: ~$0.30 per episode.
- Turn trimming (potential) — sentence-level in/out points within turns. Medium effort. Deferred — hide turns solves 80% of signal-density problem. Revisit after living with hide for a week.

---

### Phase 3: Notion Output (was Phase 2)

- `@notionhq/client`
- Fund overview + per-appearance sections + supporting quotes as Notion comments
- Citation links to section anchors (Colossus) or timestamps (YouTube)
- `POST /api/notion` route + "Generate Notion Doc" button

---

### Phase 4: Single URL + Admin (was Phase 3)

- Single URL submit with real-time ProcessingStatus (Supabase realtime) (See item 20 in Tech Debt)
- Admin dashboard: AppearanceTable, StatsOverview, FailedItemsList, DomainMappingEditor
- Bulk regenerate admin UI — trigger `POST /api/process/bullets/bulk` from admin dashboard with progress display (API endpoint already exists, needs frontend)
- Fix stuck-row retry UI — "Reset to queued" for any non-complete status
- Per-turn annotation UI for prompt feedback loop

---

### Phase 4.5: Polish + Dogfood (was Phase 4)

- Prompt iteration from real meeting usage
- Edge cases: empty arrays, null, malformed LLM responses

---

### Phase 5: RAG + Semantic Search

*Trigger: corpus at ~50-100 transcripts, conceptual queries becoming the bottleneck.*

- Create `003_embeddings.sql` — `transcript_chunks` table + pgvector extension + HNSW index
- Backfill: chunk `cleaned_transcript` → embed → insert into `transcript_chunks`
- Wire embedding generation into ingest pipeline (after clean, before entities)
- `POST /api/ask` — embed query → similarity search → Claude grounded answer
- Drop tsvector as primary search when RAG is live

**Why deferred:** At 20 transcripts, keyword + entity matching is sufficient. `transcript_chunks` table and pgvector are not created until this phase — no dead-weight extension dependencies in Phase 0.

---

## Known Technical Debt

| # | Issue | Priority | Fix |
|---|-------|----------|-----|
| 1 | ~~`Appearance` type missing `sections` field~~ | ~~P0~~ | Done — `sections` added to `Appearance` type |
| 2 | rowspace_angles restructure. Current angles are free-floating assertions with no evidence trail. Original plan was to add supporting_quotes (same as bullets), but this duplicates quotes that already exist on the bullets the angle is derived from. Better model: add based_on_bullets: number[] — indexes into the bullets array. Angle becomes a synthesis layer referencing evidence rather than restating it. UI renders with "Based on insights #1 and #4" or inlines the referenced bullets' quotes on hover. Blocked on tech debt #3 — fix angle quality (few-shot examples) first. Well-sourced mediocre angles aren't useful. | P2 | After real meeting prep usage and few-shot examples added (#3).|
| 3 | Bullets prompt needs few-shot examples for `rowspace_angles` | P1 | After using the tool for real meeting prep, take 2-3 bullets where the Rowspace angle was genuinely useful and paste them into `lib/prompts/bullets.ts` as examples. LLM pattern-matches to examples better than abstract instructions. Trigger: real usage, not staring at Supabase output. |
| 4 | ~~`turn_summaries` not populated~~ | ~~P1~~ | Done — `generateTurnSummaries()` pipeline step runs parallel with entities. Transcript viewer shows summaries for collapsed host turns. |
| 5 | Stuck-row retry UI | P2 | "Reset to queued" for any non-complete status |
| 6 | Multi-speaker scraper test coverage | P3 | Low priority — DOM selectors change anyway |
| 7 | Bullet feedback writes to local state only. Current [×] flag is negative-only. **Phase 2 plan:** Replace [×] with thumbs up / thumbs down, both with optional text feedback overlay. Wire to `POST /api/feedback` with backend storage. Accumulated positive ratings become candidates for few-shot prompt examples (Phase 4+). | P2 | Wire POST /api/feedback in Phase 2 |
| 8 | ~~Turn.corrected flag not yet populated~~ | ~~P2~~ | Done — populated by rename-speaker, correct-turn, and set-speaker-role API routes |
| 9 | ~~Speaker name drift ("Marc" vs "Marc Rowan")~~ | ~~P2~~ | Done — `normalizeSpeakerNames()` in `lib/pipeline/normalize-speakers.ts` handles variant forms at ingest via subset matching. All 29 Colossus rows verified clean. Runs for all sources. |
| 10 | Migration naming — switch to timestamp-prefixed filenames | P2 | All new migrations from Phase 2 onward |
| 11 | Responsive layout — partially done | P3 | Mobile `max-md` breakpoints implemented: flex-col stacking, video panel hidden, natural scroll, header breadcrumb hidden. TOC doesn't collapse to drawer yet — stacks above transcript. Refinement deferred. |
| 12 | Bullet tag field — add category tags to bullets prompt | P2 | After prompt quality review |
| 13 | `prompt_context_version` (INT) column — surface stale bullet indicator on AppearanceCard when prompt version changes | P2 | Phase 2/3 |
| 14 | ~~Proper job queue for bulk operations~~ | ~~P3~~ | Superseded by #20 — YouTube extraction requires local execution, which sidesteps Vercel timeout. Job queue only needed when extraction moves server-side or other users trigger batch processing via browser (Phase 4). |
| 15 | Prompt context in Notion — separate page per prompt type, fetched at ingestion, context portion snapshotted. Prompt logic stays in code. Per-type version tracking via `prompt_context_version`. "Regenerate Bullets" button should offer a prompt template picker (dropdown of available Notion prompt pages) so prompt iteration is one-click: pick template → regenerate → compare output | P2 | Phase 2/3 |
| 16 | Heavy JSONB in list projection — `LIST_COLUMNS` includes full `prep_bullets` (for bullet count) and `entity_tags` (for relevance-based search sorting). Fix: replace with Supabase RPC or computed columns for bullet count and relevance. Acceptable until ~200 rows. | P3 | When list view performance degrades |
| 17 | Hardcoded model `claude-sonnet-4-20250514` in all pipeline files | P3 | Extract to shared config constant or env var. Build admin UI only when non-developer users need to change it without deploying. |
| 18 | Entity hierarchy and affiliations — two remaining gaps in entity extraction. **(a) Hierarchy:** Current `parent` field is flat (one level). Real org structures are 4–5 levels deep with JVs, credit arms, co-investment vehicles. Add `mentioned_as` (exact transcript reference), `canonical_name` (salesperson-recognizable), `relationship` (subsidiary/credit arm/spin-off). **(b) Affiliations:** Add `affiliated_entities: [{entity, context}]` for non-hierarchical connections (co-investments, prior employers, seeders). Guard: "only extract affiliations explicitly stated or clearly implied — do not infer from general knowledge." Completeness ≪ accuracy. ~~**(c) Relevance:** `relevance: "primary" \| "mentioned"`~~ **Done** — prompt tags each fund_name, search sorts primary before mentioned, fund overview TODO added. | P2 | When corpus >50 and search misses become visible |
| 19 | ~~`vote/route.ts`~~ | ~~P3~~ | **Resolved:** Removed from project structure. Voting is not a separate feature — it's the evolution of bullet feedback (tech debt #7). Thumbs up/down replaces [×] flag in Phase 2 via `/api/feedback`. Positive feedback feeds few-shot prompt example selection in Phase 4+. |
| 20 | yt-dlp local only — YouTube extraction + batch processing runs locally via `npx tsx` scripts, can't run on Vercel serverless. Includes the job queue concern (formerly #14): web bulk endpoints have 300s timeout, but local scripts bypass this entirely. | P3 | Phase 4 — when self-serve URL submission is built or extraction moves to Docker (Railway/Fly.io/Cloud Run), add proper job queue (Inngest, BullMQ) alongside. |
| 21 | Turn attribution heuristic assumes all non-YouTube sources have speaker labels. Orchestrator stamps attribution: "source" for all curated sources without inspecting whether the raw transcript actually contains SpeakerName:\n formatting. Correct for current sources (Colossus, manual with labels) but would silently mismark turns if a future scraper produces unlabeled transcripts. Fix: inspect raw transcript for speaker label patterns before stamping, or require scrapers to declare hasSpeakerLabels: boolean on their result. Trigger: when adding a new scraper for a source without speaker-labeled transcripts. |
| 22 | Speaker extraction is hardcoded per-channel. `extractSpeakers()` relies on a `knownHosts` map and channel-specific title regex. Works for a small number of known podcast sources (Capital Allocators, AGM) but breaks on any new channel without a manual code change. Trigger to generalize: Phase 4 self-serve URL submission, or when adding a 4th-5th source becomes frequent enough that manual updates are friction. Options: LLM-based speaker extraction from description text, or a configurable speaker map in the DB/admin UI. | P3 | Phase 4 — when self-serve URL submission is built. |
| 24 | ~~**TranscriptViewer god component**~~ | ~~P1~~ | **Partially resolved (PR #44):** Extracted SpeakerPanel.tsx, TurnRenderer.tsx, helpers.tsx, useAppearanceApi.ts. TranscriptViewer still ~101KB / ~60 state vars — orchestrator role is inherently large. Remaining: extract HelpOverlay, extract shortcuts bar, consider Context provider for TurnRenderer's 28 props. Lower priority now — boundary is clean even if orchestrator is big. |
| 25 | **Speaker metadata two-layer model** — `speakers[]` is human-validated (names, roles, titles), `entity_tags.key_people[]` is LLM-generated draft. Current precedence: `speakers[].title ?? entity_tags.key_people[].title`. Consider whether entity_tags.key_people should stop overlapping with speakers[], or add explicit graduation flow. | P2 | When entity extraction prompt is updated |
| 26 | **Entity extraction prompt needs speakers[] context** — entity_tags.key_people confuses speakers with mentioned people because entity extraction runs without speaker context. Fix: pass speakers[] to entity extraction prompt. | P2 | Next pipeline improvement pass |
| 27 | **Prep bullet regeneration (guest only)** — sales calls need bullets from customer speakers only, not internal team. Add "Regenerate bullets (guest only)" button visible after roles assigned. New prompt variant filtering turns to role !== "host" && role !== "rowspace". | P1 | After speaker roles are reliably set |
| 23 | Unknown speaker names are silent. `validateSpeakerAttribution()` (`lib/pipeline/validate-speakers.ts:52`) logs a `console.warn` when the LLM uses a speaker name that doesn't fuzzy-match any name in `speakers[]`, but this warning is server-log-only — not persisted to `processing_error` and not surfaced in the admin table or transcript viewer. This matters because: (a) the LLM may have hallucinated a name, or (b) the LLM correctly identified a third speaker not in scraped metadata (e.g., a panelist introduced mid-conversation). Either way the user should know. Fix: append a `speaker_unvalidated:Name` processing warning via `appendProcessingWarning()` so it shows in admin, and add a visual indicator in the transcript viewer on turns attributed to unvalidated speakers (similar to the "inferred" attribution disclaimer). | P2 | When speaker quality becomes a visible issue in real usage. |
| 28 | **`mergeCorrectedTurns` silently corrupts corrections when turn indices shift.** (`lib/queue/orchestrator.ts:51–81`, callsites lines 309 & 748.) Overlays human corrections onto new turns by `turn_index`, but cleaning LLM nondeterminism shifts indices across runs. Two failure modes: (A) index missing in new turns — correction dropped, caught by `lost` counter but only logged to console; (B) index exists but points at different content — correction applied to wrong turn, `matched` counter increments, no warning fires. Mode B is data corruption: a verified quote gets grafted onto a different speaker moment with a `corrected: true` badge. Fix: add content-based sanity check (first-N-chars comparison) before overlay, skip mismatches, persist both "lost" and "skipped_mismatch" counts to `processing_error` via `appendProcessingWarning`. Full writeup with proposed code and acceptance criteria in `docs/tech-debt/028-merge-corrected-turns.md`. | P1 | After passages pipeline refactor lands. |
| 29 | **Merge validate-speakers and normalize-speakers.** `validateSpeakerAttribution()` and `normalizeSpeakerNames()` do overlapping work: identical speaker extraction regex, identical line-anchored replacement, similar fuzzy matching. Validate's `findClosestSpeaker` (scored name-part + prefix matching) is strictly more capable than normalize's `isSubsetOf` check. They run back-to-back in the orchestrator. Merge into one function that uses validate's scoring logic, keeps normalize's no-metadata fallback path (`buildFallbackCanonicalMap`), and handles ambiguity detection. | P3 | Next pipeline cleanup pass. |
| 30 | **Coverage gaps in passage segmentation — correction policy deferred**. `stepDetectGaps` in `lib/pipeline/post-process-passages.ts` detects segments not covered by any passage and emits per-segment warnings. But gap-covered content is still silently lost — no corrective action taken. Options considered: **(a)** extend a neighboring passage to cover small gaps (1-3 segments) bounded by same speaker; **(b)** merge small gaps at speaker boundaries into the preceding passage; **(c)** escalate large gaps (>3 segments) to a processing_error that fails the pipeline for reprocessing. Thresholds and correction behavior are TBD until we have real gap-size distribution data. Action: reprocess 10+ appearances with aggregated gap warnings, examine the distribution of gap sizes and positions, then pick a policy. PR2 should separately promote gap warnings from the `warnings` array to `processing_error` via `appendProcessingWarning` so admin UI surfaces them. | P2 | After reprocessing enough appearances to see gap distribution |

---

## Parking Lot (Speculative / Future Ideas)

These are ideas worth capturing but not worth building yet. Unlike tech debt (something built but incomplete), these are features or integrations that don't have a concrete trigger or timeline. Move to a phase when a real use case demands it.

| Idea | Why it might matter | Why not now |
|------|-------------------|-------------|
| **Title enrichment from LinkedIn / company websites** | LLM-extracted titles from transcripts are informal ("runs credit at Apollo"). Enriched titles would be more authoritative for prep materials. | Introduces API dependencies (LinkedIn hostile to scraping), data freshness issues, and entity matching problems (is this the same John Zito?). Transcript-derived titles are good enough for prep context. |
| **Calendar integration (Google Calendar API)** | Auto-push prep materials into calendar invites before meetings. The original "meeting prep in your calendar" vision. | Requires OAuth per-user, domain→fund mapping, and the core search/prep experience to be solid first. Delivery mechanism, not core value. |
| **Slack digest** | Push daily/weekly digest of newly indexed appearances relevant to upcoming meetings. | Depends on calendar integration and subscription pipeline. Two layers of dependency away. |
| **Passive source subscriptions (cron-based)** | "Watch Colossus for new ILTB episodes, auto-ingest weekly." Eliminates manual URL pasting. | Active path (paste URLs) covers everything these sources produce. Subscriptions add convenience, not coverage. Vercel cron or external scheduler needed. |
| **Controlled sector taxonomy** | Fixed enum alongside free-text `sectors_themes` for reliable filtering and aggregation ("show me all private credit appearances"). | Free-text is sufficient for display and fuzzy search at current scale. Build when filtered views or dashboards are needed (Phase 3+). |
| **Entity confidence scores** | Flag low-confidence entity extractions for human review. | Review after seeing extraction quality on 50+ real transcripts. Don't add scoring complexity before you know where extraction fails. |
| **Audio-based speaker diarization (AssemblyAI)** | Reliable speaker attribution for conference panels and call recordings where text-based attribution fails. AssemblyAI selected over pyannote/Whisper for managed API with built-in diarization. $100 free credits available. | Test script scoped as Phase 1E reach goal (standalone comparison tool, not integrated into pipeline). See Phase 2 "Upgrade Transcript" flow for integration plan. |

---

## Deployment State

**Prod URL:** `https://media-scraper-xi.vercel.app`
**Prod database:** 59 appearances (29 Colossus + 30 YouTube/manual), all `processing_status: complete`
**Last prod sync:** March 25, 2026 — PRs #41–54 deployed, data synced from dev
**Dev database:** 33 appearances

Prod sync cadence: every 3-5 PRs or at the end of a feature block, not every PR. Check for unapplied migrations and pipeline changes before syncing.

---

## Verification Checkpoints

**After Phase 0 batch:** 20 Apollo query returns populated rows with `turns`, `sections`, `entity_tags`, `prep_bullets` (section_anchor non-null). Alpha School processed successfully via chunking. `npx vitest` passes.

**After Phase 1:** "Apollo" search → instant results. Bullet click → transcript viewer at correct section with search pre-loaded. Turn summaries populated.

**After Phase 1E:** Speaker rename cascades to all 6 data locations. `?expanded=3,7,12` loads highlight reel. `?hidden=0,1` hides turns with placeholder bars. Auto-follow skips collapsed+hidden turns. Keyboard shortcuts navigate, toggle, hide, edit. Playback speed defaults to 1.5x. OG metadata shows YouTube thumbnail + quote hook in Slack preview.

**After Phase 2:** "Generate Notion Doc" → formatted page with bullet comments + anchor links.

**After Phase 5:** "Which fund managers have discussed frustrations with portfolio monitoring?" → synthesized answer with transcript citations.

**Pre-commit (every PR):** `npm run typecheck && npx vitest run && npm run build`

---

## Key Commands

```bash
npm run dev                                        # Dev server
npx vitest run                                     # Tests
npm run typecheck                                  # TypeScript check
npx tsx lib/scrapers/colossus.ts <url>             # Test scraper manually

# Reset stuck row
UPDATE appearances
SET processing_status = 'queued', processing_error = null
WHERE id = '...';

# Verify Phase 0 milestone
SELECT title, processing_status,
       entity_tags->'fund_names'->0->>'name' as primary_fund,
       jsonb_array_length(turns) as turn_count,
       jsonb_array_length(sections) as section_count
FROM appearances
WHERE entity_tags @? '$.fund_names[*].name ? (@ == "Apollo")';
```

---

## Environment Variables

```
NEXT_PUBLIC_SUPABASE_URL        Supabase project URL
NEXT_PUBLIC_SUPABASE_ANON_KEY   Supabase anonymous key
SUPABASE_SERVICE_KEY            Supabase service role key (server-side only)
ANTHROPIC_API_KEY               Claude API key
GOOGLE_AUTH_TOKEN               Colossus scraper auth cookie
ADMIN_TOKEN                     Required on all /api/process/* and /api/appearances/* routes
ASSEMBLYAI_API_KEY              AssemblyAI API key (optional — only for diarization test script)
```

**Browser setup:** Set `admin_token` cookie in dev tools (Application → Cookies → localhost) matching `ADMIN_TOKEN` value in `.env.local`. Required once per dev session.

**Note:** `ANTHROPIC_API_KEY` API balance (programmatic calls) is separate from Claude.ai Max subscription (browser/Claude Code usage). No overlap.
