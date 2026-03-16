# Meeting Prep Tool — Technical Implementation Plan
**Last updated:** March 15, 2026
**Branch:** phase1/transcript-ui (Phase 0: phase0/bootstrap-pipeline)
**Status:** Phase 1D in progress — YouTube pipeline (extraction + speaker attribution) complete, trust layer (attribution flag, validation, UI disclaimer) complete. Schema cleanup (raw_caption_data → scraper_metadata) and entity relevance tagging in review.

---

---

## Migration History

| File | Status | Contents |
|------|--------|----------|
| `001_initial_schema.sql` | Deployed | appearances, fund_overview_cache, domain_mapping |
| `002_turns_and_summaries.sql` | Deployed | `turns` JSONB + `turn_summaries` JSONB + GIN index on turns |
| `003_tighten_anon_rls.sql` | Deployed | Row-level security tightening for anon role |
| `004_sections.sql` | Deployed | `sections` JSONB DEFAULT '[]' on appearances |
| `005_corrections.sql` | Created (Phase 1 prep) | `corrections` audit table for human edits to turns |
| `006_turns_corrected_flag.sql` | Created (Phase 1 prep) | Documents Turn.corrected boolean intent (no DDL) |
| `007_prompt_snapshot.sql` | Deployed (Phase 1B) | `prompt_context_snapshot TEXT` + `bullets_generated_at TIMESTAMPTZ` on appearances |
| `008_rename_raw_caption_data.sql` | Created (Phase 1D) | Renames `raw_caption_data` → `scraper_metadata` |
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
speakers (JSONB: [{name, role, affiliation}])
raw_transcript (TEXT)
scraper_metadata (JSONB)                         — general-purpose scraper output (YouTube: caption segments; Colossus: sections + episode number)
cleaned_transcript (TEXT)
turns (JSONB: [{speaker, text, turn_index}])     — parsed from speaker-labeled transcript at ingest
turn_summaries (JSONB: [{speaker, summary}])     — nullable, Phase 1 pipeline step
sections (JSONB: [{heading, anchor}])            — scraped for Colossus; synthetic for YouTube (Phase 1)
entity_tags (JSONB)
prep_bullets (JSONB)
prompt_context_snapshot (TEXT)                    — Rowspace business context at bullet generation time
bullets_generated_at (TIMESTAMPTZ)                — when bullets were last generated
processing_status (TEXT: queued/extracting/cleaning/analyzing/complete/failed)
processing_error (TEXT)
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
  corrected?: boolean;           // true if human-verified (Phase 2 corrections UI)
  timestamp_seconds?: number;    // YouTube only (Phase 1) — extracted from scraper_metadata
  attribution?: "source" | "inferred";  // "source" = from original transcript, "inferred" = LLM-attributed. Omitted on legacy turns (treated as "source").
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

### Timestamps
Timestamps belong in `turns[].timestamp_seconds`, populated from `scraper_metadata` at ingest — not in cleaned transcript text. Schema change is a no-op (JSONB is schemaless); TypeScript type update adds `timestamp_seconds?: number` to `Turn` interface.

### Synthetic sections (Task 2.5 — Phase 1)
YouTube episodes have no HTML section anchors. Add `generateSections()` pipeline step:

**File:** `lib/pipeline/sections.ts`
```typescript
export async function generateSections(
  cleanedTranscript: string
): Promise<SectionHeading[]>
```

Prompt asks LLM to identify 5-10 logical topic breaks, name them concisely (3-6 words), return `{heading, anchor}[]` where anchor is heading lowercased + hyphenated.

**Wire into orchestrator:** After clean step, if `transcript_source === "youtube_captions"` and `sections` is empty → call `generateSections(cleanedTranscript)` → write to `sections` column.

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
    sections.ts                    [Phase 1D] generateSections() for YouTube transcripts — NOT YET BUILT
    turn-summaries.ts              [Phase 1D] One-sentence per-turn summaries — NOT YET BUILT
    clean.test.ts
    entities.test.ts
    bullets.test.ts
    splitter.test.ts
    validate-speakers.test.ts
  prompts/
    clean.ts                       Two variants: CLEAN_TRANSCRIPT_PROMPT (curated) + buildYouTubeCleanPrompt (speaker attribution)
    entities.ts                    Entity extraction prompt (with relevance tagging)
    bullets.ts                     GENERATE_BULLETS_PROMPT_CURATED / _YOUTUBE + ROWSPACE_BUSINESS_CONTEXT
    turn-summaries.ts              [Phase 1D] — NOT YET BUILT
    overview.ts                    [Phase 1 stretch / Phase 2] — NOT YET BUILT
  db/
    client.ts                      Supabase client (server only)
    queries.ts                     Typed query functions: insert, update, search (relevance-sorted), fund cache
    types.ts                       DB row types (AppearanceRow, ExtractStepOutput, AppearanceListRow, etc.)
    queries.test.ts
  queue/
    orchestrator.ts                Coordinates pipeline steps per appearance (step-level + batch-level progress logging)
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
      page.tsx                     Server component — fetches appearance, routes by status
      TranscriptViewer.tsx         Client component — all interaction logic, inferred attribution disclaimer
      RegenerateBulletsButton.tsx  Client component — triggers bullet regeneration
      types.ts                     TranscriptViewerProps interface
    search/page.tsx                [Phase 1]
    api/
      appearances/route.ts         GET all appearances
      appearances/[id]/route.ts    GET single appearance
      search/route.ts              Fund name search
      process/
        submit/route.ts            POST — bulk URL submission
        run/route.ts               POST — trigger batch processing
        retry/[id]/route.ts        POST — retry single failed appearance
        status/route.ts            GET — processing queue status
        status/[id]/route.ts       GET — single appearance status
        bullets/route.ts           POST — single-appearance bullet regeneration
        bullets/bulk/route.ts      POST — bulk bullet regeneration
        manual-ingest/route.ts     POST — manual transcript paste
      feedback/route.ts            [Phase 2] — NOT YET BUILT
      corrections/route.ts         [Phase 2] — NOT YET BUILT
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
    003_embeddings.sql             [Phase 5] — NOT YET CREATED
```

---

## Build Phases

### Phase 0: Bootstrap + Pipeline ✓ COMPLETE

29 Colossus appearances scraped, cleaned, entity-tagged, and bullets generated. All in prod Supabase. Pipeline infrastructure (scraper, clean, entities, bullets, orchestrator, chunking for long transcripts) proven and stable.

**Milestone achieved:** Query Supabase for "Apollo" → rows with `raw_transcript`, `cleaned_transcript`, `turns`, `sections`, `entity_tags`, `prep_bullets` (section anchors populated) all present.

---

### Phase 1: Transcript Viewer + Lookup UI ← IN PROGRESS

**Branch:** `phase1/transcript-ui`

**Phase 1A — Transcript Viewer ✓ COMPLETE:**
- `/transcript/[id]` live on Vercel — three-column layout: TOC (sticky left) | transcript body | video panel (sticky right)
- Header: title, date, source, clickable guest names (filter by speaker), host de-emphasized
- Guest metadata: name + title (if available) + affiliation displayed inline
- Key Takeaways section above transcript: bullet text + supporting quote (click to jump) + × to flag
  - Flagging collapses bullet to slim row; floating feedback panel bottom-right for optional comment
  - 8–10 bullets generated at ingestion (bullets.ts prompt updated)
- TOC: search input (debounced 150ms), + / − expand/collapse all, gold dots (cited in bullets), blue dots (search hits)
- Sections: expand/collapse individually or all; match counts on search hits
- Speaker turns: guest turns fully expanded; host turns truncated to first sentence (▼ more)
- Video panel: slim collapsed strip (▶ Watch Episode), expands to 280px with YouTube embed or placeholder
- Feedback: UI-only for now (local state, [×] flag); replaced with thumbs up/down + POST /api/feedback in Phase 2
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

**Phase 1C — Search UI (NOT STARTED):**
- `/search` page — server component calling `searchByFundName` directly, `SearchBar` client component
- `AppearanceCard` — title, source, date, speakers, bullets list, generated-at date
- `BulletItem` + `CitationTooltip` — bullets as triage layer, each links to `/transcript/[id]#section-anchor` (future)
- `AgeFlag` (future)

**Phase 1D — YouTube Pipeline (IN PROGRESS):**
- ✓ YouTube scraper — yt-dlp for metadata + captions, speaker detection from title/description/channel, caption segments stored in `scraper_metadata`
- ✓ YouTube-specific clean prompt with speaker attribution — pass scraped speakers[] into clean step, LLM attributes dialogue turns from conversational context. Falls back to "Speaker 1/2" when metadata is absent. Re-parses turns from cleaned transcript for YouTube sources.
- ✓ Speaker attribution trust layer — `Turn.attribution: "source" | "inferred"` flag, `validateSpeakerAttribution()` catches hallucinated names via fuzzy matching, transcript viewer shows disclaimer for inferred turns
- ✓ Pipeline progress logging — step-level (`▶ Step 1/4: EXTRACT`) and batch-level (`═══ 1/5: Title ═══`) with cumulative elapsed time
- ✓ `isYouTubeSource()` shared helper in `src/types/appearance.ts` — single source of truth for YouTube detection
- ✓ Column rename: `raw_caption_data` → `scraper_metadata` (migration 008)
- ✓ Entity relevance tagging: `fund_names[].relevance: "primary" | "mentioned"` — prompt, types, search sorting
- `generateSections()` for YouTube transcripts — synthetic sections stored to `sections` column (4th LLM call for YouTube)
- `turn-summaries` pipeline step (step 4.5) — `[{speaker, summary}]` stored to `turn_summaries`
- YouTube timestamp extraction — populate `turns[].timestamp_seconds` from `scraper_metadata`

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

### Phase 2: Corrections + Keyboard Shortcuts

Trigger: corpus at ~50 transcripts, speaker attribution errors making queries unreliable.

Schema (already migrated in Phase 1 prep):
- corrections table (appearance_id, turn_index, field, old_value, new_value, action, corrected_by)
- Turn.corrected boolean flag

Transcript viewer additions:
- Inline turn editing: double-click a guest turn to enter edit mode (textarea in place, ⌘S/Enter to save, Esc to cancel)
- Speaker reassignment: click speaker label on any turn → dropdown of known speakers from this appearance + "Add speaker"; one click writes corrections table
- Undo: revert turn to original value from corrections log; writes action: 'undone' to corrections table
- POST /api/feedback route — thumbs up / thumbs down on bullets with optional text feedback overlay. Replaces [×] flag (local state) from Phase 1. Storage TBD (new `bullet_feedback` table or JSONB).
- POST /api/corrections route for turn edits and speaker reassignment
- "Upgrade Transcript" flow — user-triggered re-extraction via AssemblyAI diarization API. Downloads audio via yt-dlp, sends to AssemblyAI async transcription with speaker_labels=True, replaces raw_transcript and updates transcript_source to "youtube_diarized". Re-runs full pipeline (clean/entities/bullets). Same deployment constraint as tech debt #20. Estimated cost: ~$0.30 per episode.

Keyboard shortcuts:
- / — focus search input
- Esc — clear search / exit edit mode / dismiss floating panel
- + / − — expand / collapse all sections
- E — enter edit mode on focused turn
- ⌘S — save turn edit
- J / K — navigate between turns (vim-style)

Note: Don't make single-click on turn text trigger edit mode — too easy to misfire while reading.
Trigger: double-click, or E shortcut when turn is focused.

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
| 2 | `rowspace_angles` missing `supporting_quotes` | P1 | Add to Zod schema + bullets prompt |
| 3 | Bullets prompt needs few-shot examples for `rowspace_angles` | P1 | After using the tool for real meeting prep, take 2-3 bullets where the Rowspace angle was genuinely useful and paste them into `lib/prompts/bullets.ts` as examples. LLM pattern-matches to examples better than abstract instructions. Trigger: real usage, not staring at Supabase output. |
| 4 | `turn_summaries` not populated | P1 | Phase 1 pipeline step |
| 5 | Stuck-row retry UI | P2 | "Reset to queued" for any non-complete status |
| 6 | Multi-speaker scraper test coverage | P3 | Low priority — DOM selectors change anyway |
| 7 | Bullet feedback writes to local state only. Current [×] flag is negative-only. **Phase 2 plan:** Replace [×] with thumbs up / thumbs down, both with optional text feedback overlay. Wire to `POST /api/feedback` with backend storage. Accumulated positive ratings become candidates for few-shot prompt examples (Phase 4+). | P2 | Wire POST /api/feedback in Phase 2 |
| 8 | Turn.corrected flag not yet populated | P2 | Corrections UI in Phase 2 |
| 9 | Speaker name drift ("Marc" vs "Marc Rowan") | P2 | Add speaker_aliases map per appearance at ingest |
| 10 | Migration naming — switch to timestamp-prefixed filenames | P2 | All new migrations from Phase 2 onward |
| 11 | Responsive layout — TOC collapses to drawer, video panel hides | P2 | At <1024px breakpoint |
| 12 | Bullet tag field — add category tags to bullets prompt | P2 | After prompt quality review |
| 13 | `prompt_context_version` (INT) column — surface stale bullet indicator on AppearanceCard when prompt version changes | P2 | Phase 2/3 |
| 14 | Proper job queue for bulk operations — `POST /api/process/bullets/bulk` holds HTTP connection (maxDuration=300s). Acceptable until corpus >100 appearances or multiple users; replace with Inngest, BullMQ, or Supabase-backed queue | P3 | Before corpus >100 |
| 15 | Prompt context in Notion — separate page per prompt type, fetched at ingestion, context portion snapshotted. Prompt logic stays in code. Per-type version tracking via `prompt_context_version`. "Regenerate Bullets" button should offer a prompt template picker (dropdown of available Notion prompt pages) so prompt iteration is one-click: pick template → regenerate → compare output | P2 | Phase 2/3 |
| 16 | Heavy JSONB in list projection — `LIST_COLUMNS` includes full `prep_bullets` (for bullet count) and `entity_tags` (for relevance-based search sorting). Fix: replace with Supabase RPC or computed columns for bullet count and relevance. Acceptable until ~200 rows. | P3 | When list view performance degrades |
| 17 | Hardcoded model `claude-sonnet-4-20250514` in all pipeline files | P3 | Extract to shared config constant or env var. Build admin UI only when non-developer users need to change it without deploying. |
| 18 | Entity hierarchy and affiliations — two remaining gaps in entity extraction. **(a) Hierarchy:** Current `parent` field is flat (one level). Real org structures are 4–5 levels deep with JVs, credit arms, co-investment vehicles. Add `mentioned_as` (exact transcript reference), `canonical_name` (salesperson-recognizable), `relationship` (subsidiary/credit arm/spin-off). **(b) Affiliations:** Add `affiliated_entities: [{entity, context}]` for non-hierarchical connections (co-investments, prior employers, seeders). Guard: "only extract affiliations explicitly stated or clearly implied — do not infer from general knowledge." Completeness ≪ accuracy. ~~**(c) Relevance:** `relevance: "primary" \| "mentioned"`~~ **Done** — prompt tags each fund_name, search sorts primary before mentioned, fund overview TODO added. | P2 | When corpus >50 and search misses become visible |
| 19 | ~~`vote/route.ts`~~ | ~~P3~~ | **Resolved:** Removed from project structure. Voting is not a separate feature — it's the evolution of bullet feedback (tech debt #7). Thumbs up/down replaces [×] flag in Phase 2 via `/api/feedback`. Positive feedback feeds few-shot prompt example selection in Phase 4+. |
| 20 | yt-dlp runs locally only — YouTube extraction depends on yt-dlp binary, which can't run on Vercel serverless. Current workaround: extract locally, pipeline writes raw data to Supabase, Vercel handles clean/entities/bullets. | P2 | When Phase 4 self-serve submission is built, move extract step to Docker-based environment (Railway, Fly.io, Cloud Run) or replace with API-based extraction. |

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
| **Audio-based speaker diarization (pyannote.audio)** | Reliable speaker attribution for conference panels where text-based attribution fails. | Only relevant for YouTube/audio sources with multiple unknown speakers. Colossus transcripts already have speaker labels. Evaluate when YouTube pipeline is active. |

---

## Verification Checkpoints

**After Phase 0 batch:** 20 Apollo query returns populated rows with `turns`, `sections`, `entity_tags`, `prep_bullets` (section_anchor non-null). Alpha School processed successfully via chunking. `npx vitest` passes.

**After Phase 1:** "Apollo" search → instant results. Bullet click → transcript viewer at correct section with search pre-loaded. Turn summaries populated.

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
ADMIN_TOKEN                     Required on all /api/process/* routes
```

**Browser setup:** Set `admin_token` cookie in dev tools (Application → Cookies → localhost) matching `ADMIN_TOKEN` value in `.env.local`. Required once per dev session.

**Note:** `ANTHROPIC_API_KEY` API balance (programmatic calls) is separate from Claude.ai Max subscription (browser/Claude Code usage). No overlap.
