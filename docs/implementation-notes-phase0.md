# Implementation Notes for Claude Code — Phase 0

These notes synthesize feedback from three independent reviews of the technical implementation plan against the PRD (docs/prd.md). They are additive to the plan, not a replacement. The plan is approved with these modifications.

---

## PHASE 0 CHANGES (implement these)

### 1. Admin token on all pipeline routes

Every `/api/process/*` route must check for an `X-Admin-Token` header matching a secret stored in `ADMIN_TOKEN` env var. This prevents the deployed Vercel URL from being an open LLM proxy. Five lines at the top of each route handler — reject 401 if missing or wrong. Add `ADMIN_TOKEN` to `.env.local` and Vercel env vars alongside the other secrets.

### 2. Timestamps are nullable — citations use section anchors for curated sources

Colossus transcripts do NOT have timestamps. They DO have section headings with anchor IDs in the HTML (e.g., `<a name="reimagining-school-from-first-principles" id="reimagining-school-from-first-principles">`).

Schema impact on `prep_bullets` JSONB structure:
```json
{
  "quote": "We're not trying to generate the highest return...",
  "timestamp_seconds": null,
  "timestamp_display": null,
  "section": "Reimagining School From First Principles",
  "section_anchor": "reimagining-school-from-first-principles",
  "speaker": "Joe"
}
```

- `timestamp_seconds` and `timestamp_display` are nullable.
- `section` (human-readable heading) and `section_anchor` (the HTML anchor ID) are added.
- Citation link for curated sources: `source_url + "#" + section_anchor` — browser scrolls directly to section.
- Citation link for YouTube (future): `source_url + "&t=" + timestamp_seconds`.
- UI renders whichever fields are present. Section reference for curated, timestamp for YouTube.

The Colossus scraper must extract section headings and their anchor IDs from the HTML alongside the transcript text.

The bullet generation prompt for curated sources should ask for the section name where the quote appears, NOT a timestamp. The pipeline then looks up the corresponding anchor ID from the scraped section data.

Never ask the LLM to generate timestamps. Timestamps must be derived from stored time-aligned data (YouTube captions) or omitted entirely (curated sources).

### 3. Manual transcript paste fallback

Build a simple API route (`/api/process/manual-ingest`) that accepts:
- Raw transcript text (pasted)
- Metadata: title, appearance_date, source_name, speakers, source_url

This route inserts a row into `appearances` with `transcript_source: "manual"` and `processing_status: "queued"`, then the normal pipeline steps (clean → entities → bullets) can be triggered on it.

Purpose: if Colossus auth becomes a multi-day fight, the rest of the pipeline (cleaning, entity extraction, bullet generation, search) can still be validated using manually pasted transcripts. Does not need a UI — callable via curl or a minimal admin form is fine.

### 4. Idempotent pipeline steps

Each pipeline step should check whether its target columns are already populated before running. If `cleaned_transcript` is already set when step 2 is called, either no-op or require a `force=true` parameter to rerun. This prevents double-processing during bulk imports and enables clean "retry from failed step" behavior.

### 5. Multi-fund cache invalidation in step 5

When step 5 (index-step) runs, one appearance may mention multiple funds in its `entity_tags` (e.g., Apollo, Blackstone, and KKR). The step must iterate through ALL fund names in the extracted entities and invalidate the `fund_overview_cache` row for each one, not just a single fund.

### 6. Remove YouTube scraper from Phase 0

The Phase 0 milestone is 20 Colossus URLs. YouTube scraper is not needed. Remove it from the Day 2 plan entirely. Reclaim that time for Colossus scraper recon and pipeline end-to-end testing. YouTube scraper moves to Phase 1 or later.

### 7. PRD filename correction

The PRD is at `docs/prd.md`, not `docs/prd-meeting-prep-v3.md`. Update any references.

---

## NOT PHASE 0 — but capture in code comments or backlog

These are valid concerns that don't need to be solved for 20 transcripts but should be noted so they aren't forgotten.

### Pipeline versioning / provenance

When iterating prompts at scale (500+ transcripts), you'll want to know which prompt version produced which bullets. Fields like `clean_prompt_version`, `bullets_prompt_version`, `processed_at` per step. Not needed now — at 20 transcripts you can reprocess everything when a prompt changes. Add when reprocessing cost becomes non-trivial.

### Search false positive corroboration

ChatGPT suggested requiring corroborating evidence for weak entity matches (e.g., person name only). Premature — run 20 transcripts first, look at actual entity_tags output, and tighten search logic based on what you see. The PRD already calls out manual review of the first 50 transcripts as the mitigation.

### Background job queue for pipeline

If a user closes the browser tab during bulk import, client-side orchestration stops. For Phase 0 this is irrelevant (you're the only user, you won't close the tab). For v2, consider Inngest, Upstash QStash, or similar for background execution that survives tab closure.

### Entity confidence scores

ChatGPT suggested adding confidence scores to entity extraction. Skip for now. Review after seeing extraction quality on real transcripts.

---

## REVIEWER DISAGREEMENTS — unresolved, for BZ to decide later

### Timestamp approach

- **ChatGPT** said: timestamps must be derived from stored time-aligned segments, never LLM-generated. If no segments available, show "no timestamp."
- **Gemini** said: tell the LLM to preserve segment timestamps during cleaning.
- **Resolution applied above**: neither — for curated sources, we use section anchors instead of timestamps entirely. LLM is never asked for timestamps. For future YouTube sources, timestamps will be derived from caption segments. This is stricter than both suggestions.

### Colossus scraper fallback strategy

- **ChatGPT** said: build a manual transcript paste fallback (adopted above).
- **Gemini** said: consider Bright Data / Browserless headless browser services if you hit bot protection.
- **Both are valid at different failure modes.** Manual paste = auth is broken, you work around it. Headless browser service = auth works but cheerio can't parse the page. Try cheerio first during recon. If it works, great. If the page requires JS rendering, consider Playwright before paying for a service. Manual paste is the insurance policy regardless.

### How much schema structure to enforce on entity_tags

- **ChatGPT** said: enforce canonical + aliases + confidence in Zod schema now.
- **Claude Code's plan** already says: validate all LLM JSON via Zod schemas.
- **Practical answer**: the Zod schema should match the entity extraction prompt's output structure (which already asks for formal names, aliases, parent/subsidiary). Don't add fields the prompt doesn't produce. Let the Zod schema evolve as you tune the prompt.
