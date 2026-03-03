# Meeting Prep Tool — Technical Implementation Plan (v2)
**Last updated:** March 3, 2026
**Branch:** phase0/bootstrap-pipeline
**Status:** Phase 0 Day 3 complete — Inside Apollo processed end-to-end, 70/70 tests passing

---

## What Changed From v1

| Item | v1 | v2 |
|------|----|----|
| Vercel timeout | 60s Hobby | 300s Pro — streaming viable, chunking still needed for very long transcripts |
| Playwright | Not anticipated | Required for Colossus Google OAuth redirect chain |
| Chunking | Not addressed | P0 blocker for long transcripts; two distinct use cases (pipeline vs. RAG — different chunk sizes) |
| Core product surface | Bullets primary | Transcript viewer primary; bullets reframed as triage layer |
| `turns` JSONB | Not planned | Add to Phase 0 migration — enables per-turn annotation and progressive disclosure |
| `transcript_chunks` table | Not planned | Add pgvector migration as placeholder in Phase 0; populate in Phase 5 |
| Turn summaries | Not planned | Phase 1 pipeline step 4.5 — one LLM call, stored as `turn_summaries` JSONB |
| In-transcript search | Not planned | Phase 1 addition — keyword within single transcript; semantic deferred to Phase 5 |
| RAG | Not contemplated | Phase 5 — pure vector search, meaningful at 50-100+ transcript corpus |
| Rowspace angles | Initial draft | Few-shot examples needed post first batch; `supporting_quotes` missing from schema |

---

## Project Structure

```
lib/
  scrapers/
    base.ts                        Scraper interface, RateLimiter util
    colossus.ts                    ILTB/Colossus scraper (Playwright auth + Cheerio parsing)
    registry.ts                    URL → scraper routing, detectTranscriptSource
    colossus.test.ts
    registry.test.ts
  pipeline/
    clean.ts                       LLM cleaning (streaming, chunking-aware)
    entities.ts                    LLM entity extraction (Zod-validated JSON)
    bullets.ts                     LLM prep bullets (curated vs YouTube variants)
    turn-summaries.ts              [Phase 1] One-sentence per-turn summaries
    chunker.ts                     [NEW Phase 0] Splits long transcripts, merges chunk results
    clean.test.ts
    entities.test.ts
    bullets.test.ts
    turn-summaries.test.ts         [Phase 1]
    chunker.test.ts                [NEW Phase 0]
  prompts/
    cleaning.ts                    Two variants: curated (lighter) vs YouTube (heavier)
    entities.ts                    Entity extraction prompt
    bullets.ts                     GENERATE_BULLETS_PROMPT_CURATED / _YOUTUBE
    turn-summaries.ts              [Phase 1] Per-turn summary prompt
    overview.ts                    Fund overview synthesis prompt
  db/
    client.ts                      Supabase client (browser + server)
    queries.ts                     Typed query functions: insert, update, search, fund cache
    types.ts                       DB row types
    queries.test.ts
  queue/
    orchestrator.ts                Coordinates pipeline steps per appearance
    orchestrator.test.ts
src/app/
  layout.tsx
  page.tsx
  globals.css
  api/
    appearances/route.ts
    appearances/[id]/route.ts
    search/route.ts
    fund-overview/route.ts
    process/
      extract/route.ts             POST step 1: scrape
      clean/route.ts               POST step 2: LLM clean
      entities/route.ts            POST step 3: LLM entities
      bullets/route.ts             POST step 4: LLM bullets
      turn-summaries/route.ts      [Phase 1] POST step 4.5: per-turn summaries
      index-step/route.ts          POST step 5: finalize + cache invalidation
      manual-ingest/route.ts       POST manual transcript paste
    vote/route.ts
    notion/route.ts                [Phase 2]
    admin/stats/route.ts           [Phase 3]
  submit/bulk/page.tsx             Phase 0 bulk paste UI
  search/page.tsx                  Phase 1
  submit/page.tsx                  Phase 1 (single URL)
  transcript/[id]/page.tsx         Phase 1 — PRIMARY PRODUCT SURFACE
  admin/page.tsx                   Phase 3
  components/
    search/
    submit/
    transcript/                    [Phase 1] Progressive disclosure viewer
    admin/
    layout/
  types/
    appearance.ts
    search.ts
    bullets.ts
    scraper.ts
docs/
  prd.md
supabase/
  migrations/
    001_initial_schema.sql         appearances, fund_overview_cache, domain_mapping
    002_turns_and_chunks.sql       [NEW Phase 0] turns JSONB column + transcript_chunks pgvector table
```

---

## Database Schema

### appearances table
id (UUID PK), source_url (TEXT UNIQUE), transcript_source (TEXT: "colossus"/"capital_allocators"/"acquired"/"youtube_captions"/"youtube_whisper"/"manual"), source_name (TEXT), title, appearance_date (DATE), speakers (JSONB: `[{name, role, affiliation}]`), raw_transcript, raw_caption_data (JSONB), cleaned_transcript, **turns (JSONB: `[{speaker, text, turn_index}]`)** [NEW], **turn_summaries (JSONB: `[{turn_index, speaker, summary}]`)** [NEW — nullable, populated in Phase 1 pipeline], entity_tags (JSONB), prep_bullets (JSONB), processing_status (TEXT: queued/extracting/cleaning/analyzing/complete/failed), processing_error, created_at, updated_at, transcript_search_vector (tsvector GENERATED from cleaned_transcript)

### transcript_chunks table [NEW — Phase 0 migration, populated Phase 5]
id (UUID PK), appearance_id (UUID FK), chunk_index (INT), chunk_text (TEXT), embedding (vector(1536)) [pgvector], created_at

### fund_overview_cache
fund_name (TEXT PK), overview_text, appearance_ids (UUID[]), generated_at

### domain_mapping
domain (TEXT PK), fund_name, added_by, created_at

### Key indexes
GIN on transcript_search_vector, GIN on entity_tags (jsonb_path_ops), GIN on speakers, GIN on turns (jsonb_path_ops) [NEW], B-tree on appearance_date DESC and processing_status, HNSW on transcript_chunks.embedding [added Phase 5 when populated]

### Migration plan
- `001_initial_schema.sql` — existing, deployed
- `002_turns_and_chunks.sql` — [NEW, Phase 0 remaining] adds `turns` JSONB + `turn_summaries` JSONB columns to appearances; creates `transcript_chunks` table with pgvector extension; adds GIN index on turns

---

## Chunking Design

### Two distinct chunking use cases

| Use case | Purpose | Chunk size | Trigger |
|----------|---------|-----------|---------|
| Pipeline chunking | Stay within Vercel 300s per invocation | ~120k chars (~30k tokens) | Only when `rawTranscript.length >= 120_000` |
| RAG chunking (Phase 5) | Precise semantic retrieval | ~2k chars (~500 tokens) | All transcripts, uniformly |

Same `chunker.ts` utility, different size targets and trigger conditions.

### Pipeline chunking (Phase 0)

**lib/pipeline/chunker.ts:**

```typescript
// Split preference order:
// 1. Section boundaries from scraped sections[] (cleanest — Colossus only)
// 2. Speaker turn boundaries (YouTube fallback)
// 3. Hard paragraph boundary at ~120k chars (last resort)

export function splitIntoChunks(rawTranscript, sections, targetChunkChars = 120_000): string[]
export function mergeCleaned(chunks: string[]): string         // join with double newline
export function mergeEntityTags(chunks: EntityTags[]): EntityTags  // dedup by name, merge aliases
export function mergePrepBullets(chunks: PrepBullets[]): PrepBullets  // dedup by headline
```

Normal episodes (60-90 min, ~60-90k chars): single pass, no chunking.
Long episodes (Alpha School, 157k chars): ~2 chunks → ~4-5 min total, within 300s per chunk.

### YouTube chunking complexity (Phase 1+)

Colossus chunking is stateless — speaker names are inline in the transcript. YouTube is not. Speaker identity is established early and referenced implicitly later. Chunks need a speaker context header:

```
Speakers identified so far:
- Speaker A: Marc Rowan (guest) — identified from intro
- Speaker B: Patrick O'Shaughnessy (host)
Continue cleaning the following chunk with these identities...
```

The chunker extracts the speaker map from chunk 1's output before processing chunk 2. Dependency chain, not stateless. Defer this design to Phase 1 when YouTube scraper is built.

---

## Pipeline Architecture

**Vercel Pro:** 300s per invocation.

```
Browser → POST /api/process/extract        (~5-15s)  → writes raw_transcript, turns
       → POST /api/process/clean           (~2-5min) → writes cleaned_transcript
       → POST /api/process/entities        (~30s)    → writes entity_tags
       → POST /api/process/bullets         (~2min)   → writes prep_bullets
       → POST /api/process/turn-summaries  (~1-2min) → writes turn_summaries [Phase 1]
       → POST /api/process/index-step      (~1-2s)   → marks complete, invalidates fund cache
```

Each step idempotent: checks if target column populated, no-ops unless `force=true`. All routes require `X-Admin-Token` header.

**`turns` extraction:** The scraper already returns speaker-labeled transcript text. The extract step (or a post-process on the raw transcript) parses this into the structured `turns` JSONB array at ingest time — no extra LLM call needed.

---

## LLM Integration

**Client:** Anthropic SDK, `messages.stream()`, `timeout: 600_000`. Model: `claude-sonnet-4-20250514`.

**Timeout note:** 10-min SDK timeout is a local dev safety net only. Vercel Pro hard-kills at 300s. Chunking keeps all invocations under 300s.

**Prompts:**
- `cleaning.ts` — curated (lighter) + YouTube (heavier with filler removal, speaker attribution)
- `entities.ts` — fund names, aliases, parent/subsidiary, key people, sectors, portfolio companies
- `bullets.ts` — `GENERATE_BULLETS_PROMPT_CURATED` (section names) + `GENERATE_BULLETS_PROMPT_YOUTUBE` (timestamps). Rowspace ICP-conditional logic + greenfield/brownfield gate.
- `turn-summaries.ts` — [Phase 1] pass full structured transcript, return `[{turn_index, speaker, summary}]`
- `overview.ts` — cross-appearance synthesis, cached per fund

**Greenfield/brownfield gate:**
- CLO manager or endowment → GREENFIELD → no competitive displacement
- PE firm, private credit, family office with PE exposure → BROWNFIELD → iLevel/73 Strings/Chronograph angles apply
- Gate fires before ICP-specific logic

**Known prompt debt:**
1. `rowspace_angles` missing `supporting_quotes` array in Zod schema and prompt
2. Bullets prompt needs 2-3 few-shot examples — write manually after first batch of 5+ transcripts, inject as `EXAMPLES:` block

---

## Search Logic

**Cross-corpus search (Phase 1), three-tier:**
1. Entity tags JSONB `@?` jsonpath — fund names, aliases, parent/subsidiary, key people [primary]
2. `tsvector @@ plainto_tsquery` — keyword fallback for things that slipped entity extraction
3. Fuzzy / LLM-assisted (stretch) — if steps 1–2 return nothing

**In-transcript search (Phase 1):**
- Keyword: `WHERE id = $1 AND transcript_search_vector @@ plainto_tsquery($2)` — free given existing index
- Returns matching turns; client-side highlight within turn text
- URL-driven: `/transcript/abc-123?q=Athene+merger` — viewer reads `q`, pre-loads search on mount
- Semantic search (conceptual queries like "frustrations about portfolio monitoring") — deferred to Phase 5 RAG

**Bullets → transcript deep link:** Each bullet's `section_anchor` links to `/transcript/[id]#section-anchor`. Future: bullets link to `/transcript/[id]?q=search-terms` to pre-load in-transcript search at the relevant point.

**Fund overview:** Cache check → on miss, gather `prep_bullets` from matching appearances → Claude synthesis → cache. Invalidated in step 5 for all funds in new appearance's `entity_tags`.

---

## Phase 5: RAG (Future)

When corpus reaches ~50-100 transcripts, keyword + entity matching becomes insufficient for conceptual queries. RAG adds semantic search across the corpus.

**What it adds:**
- At ingest: chunk `cleaned_transcript` into ~500-token pieces, generate embeddings (OpenAI `text-embedding-3-small` — ~$0.02/million tokens, negligible cost), store in `transcript_chunks`
- At query time: embed user's query (~200-500ms), similarity search via `ORDER BY embedding <=> $1 LIMIT 20`, pass retrieved chunks to Claude for grounded answer
- New API route: `POST /api/ask`

**Why pure vector (not hybrid):** Entity tag matching already handles proper nouns and fund names. `tsvector` hybrid adds re-ranking complexity without meaningful precision gain. Drop `tsvector` as primary search mechanism when RAG is live.

**No backfill needed:** `transcript_chunks` table exists from Phase 0 migration. `cleaned_transcript` is the source — backfill script reads it, chunks, embeds, inserts. One-time operation.

**Scalability:** pgvector HNSW index handles thousands of chunks fast. HNSW index added to migration when Phase 5 populates the table.

---

## Known Technical Debt

| # | Issue | Priority | Fix |
|---|-------|----------|-----|
| 1 | Chunking not built | **P0 — blocking** | `lib/pipeline/chunker.ts` before bulk import |
| 2 | `turns` JSONB not in schema | **P0** | Add to `002_turns_and_chunks.sql` migration |
| 3 | `transcript_chunks` table not in schema | P0 | Add to `002_turns_and_chunks.sql` migration |
| 4 | `rowspace_angles` missing `supporting_quotes` | P1 | Add to Zod schema + bullets prompt before PR |
| 5 | Bullets prompt needs few-shot examples | P1 | After 5+ transcripts, write examples manually |
| 6 | Stuck row retry UI | P2 | "Reset to queued" for any non-complete status |
| 7 | `max_tokens: 4096` on bullets | P2 | Bump to 8192; watch for truncated JSON |
| 8 | Multi-speaker scraper test coverage | P3 | Low priority; DOM selectors change anyway |

---

## Build Phases

### Phase 0: Bootstrap + Pipeline ← IN PROGRESS

**Done:**
- Supabase schema (migration 001), `lib/db/`, `src/types/`, Vitest config
- Colossus scraper (Playwright auth, Cheerio, sections extraction), registry, manual ingest
- All 3 pipeline functions (clean, entities, bullets) with streaming + Zod
- All prompts with Rowspace ICP logic and greenfield/brownfield gate
- Orchestrator (idempotent, multi-fund cache invalidation)
- All 5 API routes with X-Admin-Token auth
- Bulk paste UI (`/submit/bulk`)
- 70/70 tests passing
- Inside Apollo processed end-to-end ✓

**Remaining:**
1. Write `002_turns_and_chunks.sql` migration (`turns` JSONB + `turn_summaries` JSONB on appearances; `transcript_chunks` table with pgvector)
2. Update scraper extract step to parse speaker-labeled transcript into `turns` JSONB at ingest
3. Build `lib/pipeline/chunker.ts` + `chunker.test.ts`
4. Wire chunking into `clean.ts`; add fallback to `entities.ts` / `bullets.ts`
5. Verify Alpha School processes successfully
6. Submit remaining 19 Colossus URLs via bulk UI
7. Verify: `SELECT * FROM appearances WHERE entity_tags @? '$.funds[*].name ? (@ == "Apollo")'` → populated rows
8. Open PR: `phase0/bootstrap-pipeline → main`

**Milestone:** Query Supabase for "Apollo" → rows with `raw_transcript`, `cleaned_transcript`, `turns`, `entity_tags`, `prep_bullets` (section anchors, nullable timestamps), `speakers`, `source_name` all populated.

---

### Phase 1: Transcript Viewer + Lookup UI

**Primary deliverable: `/transcript/[id]` — the core product surface.**

**Pipeline addition (step 4.5):**
- `lib/pipeline/turn-summaries.ts` — one LLM call, passes structured `turns`, returns `[{turn_index, speaker, summary}]`
- `lib/prompts/turn-summaries.ts` — prompt template
- `POST /api/process/turn-summaries` route (idempotent, X-Admin-Token)
- Wired into orchestrator between bullets (step 4) and index-step (step 5)

**Transcript viewer (`/transcript/[id]`):**
- Progressive disclosure: section headings → per-turn summaries → full speaker-labeled text
- Host turns visually de-emphasized (lower signal than guest responses)
- In-transcript keyword search: input field → `tsvector` query scoped to this appearance → highlight matching turns, scroll to first match
- URL-driven search state: `/transcript/[id]?q=Athene+merger` pre-loads search on mount
- Raw vs. cleaned transcript toggle (already in PRD)
- [Phase 3+] Per-turn annotation layer for prompt feedback workflow

**Search UI:**
- `SearchBar`, `SearchResults`, `AppearanceCard`
- `BulletItem` + `CitationTooltip` — bullets framed as **triage layer**: quick scan, each bullet links to `/transcript/[id]#section-anchor` or `/transcript/[id]?q=search-terms` for depth
- `VoteButton`, `AgeFlag`, `FundOverviewCard`
- Loading / error / empty states throughout

**Other:**
- Search matcher (three-tier: entity tags → tsvector → fuzzy)
- Search + fund overview API routes
- Fix stuck-row retry UI (P2 debt)
- Playwright E2E tests (search flow, transcript view, submit flow)

**Milestone:** Type "Apollo" → instant results. Click bullet → lands in transcript viewer at relevant section with search pre-loaded. `npm run typecheck && npx vitest && npm run build` passes.

---

### Phase 2: Notion Output

- `@notionhq/client`
- Notion doc builder: fund overview, per-appearance sections, supporting quotes as Notion comments on bullet blocks, age flags as callout blocks, citation links to section anchors
- `POST /api/notion` route
- "Generate Notion Doc" button in search UI

---

### Phase 3: Single URL + Admin

- Single URL submit page with real-time ProcessingStatus (Supabase realtime)
- Admin dashboard: AppearanceTable (sortable), StatsOverview, FailedItemsList with retry, DomainMappingEditor
- Per-turn annotation UI for prompt feedback — flag wrong speaker attribution, poor bullet quality, excessive filler. Feeds manual prompt iteration loop.

---

### Phase 4: Polish + Dogfood

- Prompt iteration from real meeting usage
- Few-shot examples in bullets prompt (if not done in Phase 1)
- `rowspace_angles` + `supporting_quotes` schema (if not done)
- YouTube scraper (may slip to Phase 5)
- Edge cases: empty arrays, null, malformed LLM responses

---

### Phase 5: RAG + Semantic Search

*Trigger: corpus at ~50-100 transcripts, conceptual queries becoming the bottleneck.*

- Enable pgvector HNSW index on `transcript_chunks.embedding`
- Backfill script: chunk all `cleaned_transcript` values → embed → insert into `transcript_chunks`
- Wire embedding generation into ingest pipeline (after `clean` step, before `entities`)
- `POST /api/ask` route — embed query → similarity search → Claude grounded answer
- In-transcript semantic search: upgrade keyword search in viewer to vector search
- Cross-corpus semantic queries: "which fund managers have discussed frustrations with portfolio monitoring workflows?"

---

## Verification Checkpoints

**After Phase 0:** Apollo query returns populated rows with `turns` populated. Alpha School no longer fails. 002 migration deployed. `npx vitest` passes.

**After Phase 1:** "Apollo" search → instant results. Bullet click → transcript viewer at correct section with search pre-loaded. Turn summaries populated. `npm run typecheck && npx vitest && npm run build` passes.

**After Phase 2:** "Generate Notion Doc" → formatted page with bullet comments + anchor links.

**After Phase 5:** "Which fund managers have expressed frustration about portfolio monitoring?" → synthesized answer with transcript citations.

**Pre-commit (every PR):** `npm run typecheck && npx vitest run && npm run build`

---

## Key Commands

```bash
npm run dev                    # Dev server
npx vitest run                 # Tests
npm run typecheck              # TypeScript check
npx tsx lib/scrapers/colossus.ts <url>   # Test scraper manually

# Reset stuck row
UPDATE appearances SET processing_status = 'queued', processing_error = null WHERE id = '...';

# Verify Phase 0 milestone
SELECT title, processing_status, entity_tags->'funds'->0->>'name' as primary_fund
FROM appearances WHERE entity_tags @? '$.funds[*].name ? (@ == "Apollo")';
```
