# Meeting Prep Tool — Technical Implementation Plan (v3)
**Last updated:** March 5, 2026
**Branch:** phase1/transcript-ui (Phase 0: phase0/bootstrap-pipeline)
**Status:** Phase 1B complete — orchestrator improvements (chunk parallelization, bullets-only reprocess, bulk regenerate), prompt context snapshot, search page. Phase 2 schema prep migrations created.

---

## What Changed From v2

| Item | v2 | v3 |
|------|----|----|
| `transcript_chunks` / pgvector | In Phase 0 migration | Deferred to `003_embeddings.sql` — Phase 5 only. Dead weight at 20 transcripts. |
| `sections` JSONB | Not planned — ephemeral in-memory only | Persisted to appearances table. Required for transcript page navigation and citation links. |
| `turn_summaries` type | `unknown[] | null` | `Array<{speaker: string, summary: string}> | null` — speaker-keyed, consistent with turns shape. |
| Bullets prompt | Sections list never injected into userContent | `JSON.stringify(sections)` lookup table injected; `section_anchor` added to output schema with fuzzy fallback. |
| `section_anchor` on bullets | Always null | Populated correctly — LLM matches quotes to sections lookup table, falls back to fuzzy lookup. |
| `chunker.ts` naming | Ambiguous — overlaps with RAG chunks concept | Renamed to `splitter.ts` / `splitForProcessing` to disambiguate from RAG `transcript_chunks` (Phase 5). |
| CLAUDE.md observability | Not documented | Observability section added — console.log bookends required, never stripped, chunk progress logging on long steps. |
| YouTube timestamps | Not addressed | Deferred — timestamps belong in `turns[].timestamp_seconds` populated from `raw_caption_data`; not in cleaned transcript text. |
| YouTube sections | Not addressed | Deferred — `generateSections()` pipeline step produces synthetic sections for YouTube transcripts (Phase 1). |
| Admin token | In implementation notes | Required cookie in browser (`admin_token`) matching `ADMIN_TOKEN` env var — set once per dev session. |

---

## Migration History

| File | Status | Contents |
|------|--------|----------|
| `001_initial_schema.sql` | Deployed | appearances, fund_overview_cache, domain_mapping |
| `002_turns_and_summaries.sql` | Deployed | `turns` JSONB + `turn_summaries` JSONB + GIN index on turns |
| `003_sections.sql` (was 002 in v2 plan) | Deployed | `sections` JSONB DEFAULT '[]' on appearances |
| `004_sections.sql` | Deployed | — (renumbered during session; check actual file names in repo) |
| `005_corrections.sql` | Created (Phase 1 prep) | `corrections` audit table for human edits to turns |
| `006_turns_corrected_flag.sql` | Created (Phase 1 prep) | Documents Turn.corrected boolean intent (no DDL) |
| `007_prompt_snapshot.sql` | Created (Phase 1B) | `prompt_context_snapshot TEXT` + `bullets_generated_at TIMESTAMPTZ` on appearances |
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
raw_caption_data (JSONB)                         — YouTube: contains timestamped caption segments
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
  timestamp_seconds?: number;    // YouTube only (Phase 1) — extracted from raw_caption_data
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

### fund_overview_cache
`fund_name (TEXT PK), overview_text, appearance_ids (UUID[]), generated_at`

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

### Section injection (fixed in v3)
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
Timestamps belong in `turns[].timestamp_seconds`, populated from `raw_caption_data` at ingest — not in cleaned transcript text. Schema change is a no-op (JSONB is schemaless); TypeScript type update adds `timestamp_seconds?: number` to `Turn` interface.

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
    base.ts                        Scraper interface, RateLimiter util
    colossus.ts                    ILTB/Colossus scraper (Playwright auth + Cheerio parsing)
    parse-turns.ts                 [NEW v3] Parses SpeakerName:\ntext → Turn[]
    registry.ts                    URL → scraper routing, detectTranscriptSource
    colossus.test.ts
    parse-turns.test.ts            [NEW v3]
    registry.test.ts
  pipeline/
    clean.ts                       LLM cleaning (streaming via for-await, chunking-aware)
    entities.ts                    LLM entity extraction (Zod-validated JSON)
    bullets.ts                     LLM prep bullets (curated vs YouTube variants)
    splitter.ts                    [NEW v3] Splits long transcripts for pipeline processing (renamed from chunker.ts)
    sections.ts                    [Phase 1] generateSections() for YouTube transcripts
    turn-summaries.ts              [Phase 1] One-sentence per-turn summaries
    clean.test.ts
    entities.test.ts
    bullets.test.ts
    splitter.test.ts               [NEW v3] (renamed from chunker.test.ts)
    turn-summaries.test.ts         [Phase 1]
  prompts/
    cleaning.ts                    Two variants: curated (lighter) vs YouTube (heavier)
    entities.ts                    Entity extraction prompt
    bullets.ts                     GENERATE_BULLETS_PROMPT_CURATED / _YOUTUBE
    turn-summaries.ts              [Phase 1]
    overview.ts                    Fund overview synthesis prompt
  db/
    client.ts                      Supabase client (server only — browser client removed as dead code)
    queries.ts                     Typed query functions: insert, update, search, fund cache
    types.ts                       DB row types (AppearanceRow, ExtractStepOutput, etc.)
    queries.test.ts
  queue/
    orchestrator.ts                Coordinates pipeline steps per appearance
    orchestrator.test.ts
src/app/
  layout.tsx                       Geist + Playfair Display + Source Sans 3 fonts
  page.tsx                         Phase 0 bulk paste UI
  globals.css
  transcript/[id]/
    page.tsx                       Server component — fetches appearance, routes by status
    TranscriptViewer.tsx           Client component — all interaction logic
    types.ts                       TranscriptViewerProps interface
  api/
    appearances/route.ts
    appearances/[id]/route.ts
    search/route.ts
    fund-overview/route.ts
    process/
      extract/route.ts
      clean/route.ts
      entities/route.ts
      bullets/route.ts
      turn-summaries/route.ts      [Phase 1]
      index-step/route.ts
      manual-ingest/route.ts
    vote/route.ts
    notion/route.ts                [Phase 2]
    admin/stats/route.ts           [Phase 3]
  search/page.tsx                  [Phase 1]
  submit/page.tsx                  [Phase 1]
  transcript/[id]/page.tsx         [Phase 1] — PRIMARY PRODUCT SURFACE
  admin/page.tsx                   [Phase 3]
supabase/
  migrations/
    001_initial_schema.sql
    002_turns_and_summaries.sql    turns + turn_summaries JSONB
    003_sections.sql (or 004)      sections JSONB
    005_corrections.sql            Phase 2 prep — corrections audit table
    006_turns_corrected_flag.sql   Phase 2 prep — documents Turn.corrected intent
    003_embeddings.sql             [Phase 5] transcript_chunks + pgvector
```

---

## Build Phases

### Phase 0: Bootstrap + Pipeline ← COMPLETE

**Completed:**
- `002_turns_and_summaries.sql` migration deployed — turns + turn_summaries columns
- `parseTurns()` utility — parses `SpeakerName:\ntext` format → `Turn[]`
- `lib/pipeline/splitter.ts` + tests — splitForProcessing, mergeCleaned, mergeEntityTags, mergePrepBullets
- Orchestrator wired with parseTurns at extract step + chunking branch (threshold: 120k chars)
- `sections` JSONB column added to appearances — persisted from scraper, no longer ephemeral
- `writeExtractResult` updated to persist turns + sections
- Bullets prompt fixed — sections lookup table injected into userContent, `section_anchor` added to output schema
- `max_tokens` bumped 4096 → 8192 on bullets.ts
- Apollo re-ingested and validated: sections populated (12 headings), turns populated, section_anchor non-null on all bullet quotes
- CLAUDE.md updated with observability section
- All 29 BugBot issues from PR #1 resolved across 4 fix commits
- JSON parsers strip markdown code fences (```json) from LLM responses
- All pipeline files use consistent `stream()` + `finalText()` pattern with `setInterval` progress logging
- Cache invalidation failure no longer reverts "complete" status to "failed"
- Dead code removed (`toAppearance`, `createBrowserClient`)
- 94/94 tests passing, typecheck clean, build green

**Remaining before merge:**
1. Submit remaining 19 Colossus URLs via bulk UI
2. Monitor batch — normal episodes ~6 min each; Alpha School will chunk
3. Spot-check 2-3 outputs for entity_tags and prep_bullets quality
4. Write first few-shot example for rowspace_angles after reviewing batch output
5. Open PR: `phase0/bootstrap-pipeline → main`

**Milestone:** Query Supabase for "Apollo" → rows with `raw_transcript`, `cleaned_transcript`, `turns`, `sections`, `entity_tags`, `prep_bullets` (section anchors populated) all present.

---

### Phase 1: Transcript Viewer + Lookup UI ← IN PROGRESS

**Branch:** `phase1/transcript-ui`

Transcript viewer (/transcript/[id]) — PRIMARY PRODUCT SURFACE
- Three-column layout: TOC (sticky left) | transcript body | video panel (sticky right)
- Header: title, date, source, clickable guest names (filter by speaker), host de-emphasized
- Guest metadata: name + title (if available) + affiliation displayed inline
- Key Takeaways section above transcript: bullet text + supporting quote (click to jump) + × to flag
  - Flagging collapses bullet to slim row; floating feedback panel bottom-right for optional comment
  - 8–10 bullets generated at ingestion (bullets.ts prompt updated)
- TOC: search input (debounced 150ms), + / − expand/collapse all, gold dots (cited in bullets), blue dots (search hits)
- Sections: expand/collapse individually or all; match counts on search hits
- Speaker turns: guest turns fully expanded; host turns truncated to first sentence (▼ more)
- Video panel: slim collapsed strip (▶ Watch Episode), expands to 280px with YouTube embed or placeholder
- Feedback: UI-only for now (local state); POST /api/feedback wired in Phase 2
- Status routing: null → 404, processing → status page with refresh prompt, failed → error page with back link

**Pipeline additions (Phase 1):**
- `section_anchor` stamped on Turn at parse time (parseTurns accepts sections[])
- `generateSections()` for YouTube transcripts — synthetic sections stored to `sections` column
- `turn-summaries` pipeline step (step 4.5) — `[{speaker, summary}]` stored to `turn_summaries`
- YouTube timestamp extraction — populate `turns[].timestamp_seconds` from `raw_caption_data`

**Orchestrator improvements (Phase 1B) — COMPLETE:**
- Chunk-level `Promise.all` parallelization for clean/entities/bullets steps
- `reprocessBullets()` — bullets-only reprocess mode (skips extract/clean/entities, reuses existing data)
- `POST /api/process/bullets` — single-appearance bullet regeneration
- `POST /api/process/bullets/bulk` — fire-and-forget bulk regeneration with `p-limit(2)` concurrency cap
- `prompt_context_snapshot` column — snapshots Rowspace business context at bullet generation time
- `bullets_generated_at` column — records when bullets were last generated
- `ROWSPACE_BUSINESS_CONTEXT` extracted as separate constant for snapshotting

**Search UI (Phase 1):**
- `/search` page — server component calling `searchByFundName` directly, `SearchBar` client component
- `AppearanceCard` — title, source, date, speakers, bullets list, generated-at date
- `BulletItem` + `CitationTooltip` — bullets as triage layer, each links to `/transcript/[id]#section-anchor` (future)
- `VoteButton`, `AgeFlag`, `FundOverviewCard` (future)

**Prompt improvements:**
- Add `supporting_quotes` to `rowspace_angles` schema + prompt
- Add 2-3 few-shot examples to bullets prompt from best manual Rowspace analyses

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
- POST /api/feedback route for bullet flagging (replaces local state from Phase 1)
- POST /api/corrections route for turn edits and speaker reassignment

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

- Single URL submit with real-time ProcessingStatus (Supabase realtime)
- Admin dashboard: AppearanceTable, StatsOverview, FailedItemsList, DomainMappingEditor
- Fix stuck-row retry UI — "Reset to queued" for any non-complete status
- Per-turn annotation UI for prompt feedback loop

---

### Phase 4.5: Polish + Dogfood (was Phase 4)

- Prompt iteration from real meeting usage
- YouTube scraper (may slip to Phase 5)
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
| 3 | Bullets prompt needs few-shot examples | P1 | After batch review, write 2-3 manually |
| 4 | `turn_summaries` not populated | P1 | Phase 1 pipeline step |
| 5 | Stuck-row retry UI | P2 | "Reset to queued" for any non-complete status |
| 6 | Multi-speaker scraper test coverage | P3 | Low priority — DOM selectors change anyway |
| 7 | Bullet feedback (flagging) writes to local state only | P2 | Wire POST /api/feedback in Phase 2 |
| 8 | Turn.corrected flag not yet populated | P2 | Corrections UI in Phase 2 |
| 9 | Speaker name drift ("Marc" vs "Marc Rowan") | P2 | Add speaker_aliases map per appearance at ingest |
| 10 | Migration naming — switch to timestamp-prefixed filenames | P2 | All new migrations from Phase 2 onward |
| 11 | Responsive layout — TOC collapses to drawer, video panel hides | P2 | At <1024px breakpoint |
| 12 | Bullet tag field — add category tags to bullets prompt | P2 | After prompt quality review |
| 13 | `prompt_context_version` (INT) column — surface stale bullet indicator on AppearanceCard when prompt version changes | P2 | Phase 2/3 |
| 14 | Proper job queue for bulk operations — `POST /api/process/bullets/bulk` uses fire-and-forget (promise killed on Vercel after response sends). Replace with Inngest, BullMQ, or Supabase-backed queue before production deploy | P1 | Before production deploy |
| 15 | Prompt context in Notion — separate page per prompt type, fetched at ingestion, context portion snapshotted. Prompt logic stays in code. Per-type version tracking via `prompt_context_version` | P2 | Phase 2/3 |
| 16 | `prep_bullets` JSONB fetched in lightweight list projection just for bullet count — `LIST_COLUMNS` includes full `prep_bullets` but UI only reads `prep_bullets?.bullets?.length`. Fix: drop `prep_bullets` from `LIST_COLUMNS` and either add a Supabase RPC/raw SQL returning `jsonb_array_length(prep_bullets->'bullets') as bullet_count`, use a computed column, or drop the bullet count from the list view if it's not essential. Acceptable until ~200 rows or ~20 bullets/row. | P3 | When list view performance degrades |

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
