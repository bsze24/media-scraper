# Meeting Prep Tool — Ongoing Considerations
**Last updated:** March 3, 2026
*A living document capturing product thinking, open questions, and decisions not yet fully resolved. Updated as the product evolves.*

---

## On What the Product Actually Is

The original framing was bullets-first: ingest transcripts, generate prep bullets, look up by fund name before a meeting. Clean and simple.

The revised framing, which emerged from actually using the output: **the cleaned transcript is the core value, not the bullets.** The manual work of parsing a podcast transcript is stripping filler, finding exact quotes, and stitching together what a fund manager actually said about a specific topic. Pre-generated bullets will never be specific enough to replace that — they're a triage layer, not a research layer.

This means:
- The transcript viewer (`/transcript/[id]`) is the primary product surface, not a detail page
- Bullets are useful for "is this episode worth going deep on?" — not for the depth itself
- Progressive disclosure (section headings → per-turn summaries → full text) is the right UX pattern
- In-transcript search is how you get to the specific quotes you need

**The bullets are still worth generating** — they drive the initial search and fund overview experience. But the product succeeds or fails based on the quality of the transcript reading experience, not the quality of the bullets.

---

## On Prompt Quality

### The calibration problem
The Rowspace angles coming out of the pipeline are directionally right but generic. "Massive document processing challenges across 4,000 employees" applies to any large fund — it doesn't name a specific wedge or entry point. This is a few-shot example problem, not a structural problem.

**Fix:** After the first batch of 5+ transcripts, write the angles manually for one episode using the full Rowspace context. Add those 2-3 examples as an `EXAMPLES:` block in the bullets prompt. The LLM will pattern-match to the quality bar those examples set. This is the most important prompt improvement in the near term.

### What makes a Tier 1 Rowspace angle
Criteria worth articulating for the few-shot examples:
- Names a specific operational pain visible in what the guest said (not inferred generically)
- Identifies a concrete entry point or pilot — not "could help with data challenges" but "the Atlas warehouse credit data across 22 offices is the wedge"
- Calibrated to fund type: CLO/endowment = greenfield (no displacement), PE/private credit = brownfield (displacement from iLevel/73 Strings/Chronograph)
- References something the guest actually said, not boilerplate about the firm

### Per-turn annotation as the feedback loop
The prompt improvement cycle over time is: review transcript output → flag turns where speaker attribution is wrong or cleaning left too much filler → identify patterns → update prompt → reprocess. The admin annotation UI (Phase 3) is what makes this systematic rather than ad hoc. Until then, the Supabase Table Editor is sufficient.

---

## On Search

### What tsvector can and can't do
`tsvector` (Postgres full-text search) handles keyword and boolean queries: "AI", "portfolio management", "AI OR CLO", "private credit AND origination". It normalizes words to roots and removes stop words. Fast, already built.

What it can't do: conceptual queries. "Frustrations about portfolio monitoring" won't find a turn where someone says "we're still doing this in Excel" — no keyword overlap. That's a semantic search problem requiring embeddings.

For Phase 1, `tsvector` covers most real in-transcript search needs. The cases where it falls short are the ones where you know what you're looking for conceptually but not lexically — these become more common as the corpus grows and the use case matures.

### The search architecture decision
Entity tag matching is the primary mechanism for cross-corpus search (fund name → all appearances). `tsvector` is the fallback for things that slipped entity extraction. When RAG is added (Phase 5), pure vector search replaces `tsvector` as the primary search mechanism — entity tags remain, vectors replace keyword fallback. Hybrid search (combining both) was considered and rejected: the complexity of merging two scoring systems isn't worth it given entity tags already handle the precision-sensitive cases (fund names, people, companies).

---

## On RAG

RAG is planned for Phase 5, not the current architecture. The key principle: **RAG earns its value at scale.** At 20 transcripts, keyword search finds most of the same things. At 200+ transcripts, conceptual cross-corpus queries become genuinely hard to answer without embeddings.

### What RAG would unlock
- Conceptual cross-corpus queries: "which fund managers have discussed frustrations with portfolio monitoring workflows?"
- Cross-temporal analysis: "how has sentiment about private credit shifted over the past two years?"
- Deep fund research: "what operational problems has Apollo mentioned across all episodes?" (deeper than one episode's bullets)

### The architecture is ready
`transcript_chunks` table with pgvector is added as a placeholder in Phase 0 (migration 002). `cleaned_transcript` is the source of truth — backfill is a read-from-column → chunk → embed → insert operation. No reingestion needed. Pure vector search (not hybrid) is the target approach.

### Chunk sizing matters differently for RAG vs. pipeline
Pipeline chunking: ~120k chars per chunk — large, to process efficiently within timeout limits. Only triggered on very long transcripts.
RAG chunking: ~500 tokens (~2k chars) per chunk — small, to ensure each chunk is semantically self-contained and embedding is precise. Applied to all transcripts.

---

## On YouTube (Deferred to Phase 1+)

The main complexity added by YouTube vs. Colossus:

1. **No human speaker labels.** The cleaning prompt has to infer speaker identity from context. Works for 2-speaker interviews; gets harder for panels.

2. **Speaker state across chunks.** For Colossus, speaker names are inline — each chunk is self-contained. For YouTube, speaker identity is established early and referenced implicitly. Multi-chunk cleaning needs a speaker context header passed into each chunk. This is a dependency chain (chunk N depends on chunk N-1's output), not stateless.

3. **Timestamps instead of section anchors.** Citation links become `source_url&t=timestamp_seconds` instead of `source_url#section_anchor`. The `GENERATE_BULLETS_PROMPT_YOUTUBE` variant handles this.

4. **Auth.** Colossus required Google OAuth via Playwright. YouTube public transcripts may not require auth (captions API), but private/unlisted content will.

None of this is blocking. Colossus is the Phase 0 and Phase 1 target.

---

## Open Questions

### 1. Annotation UI design for prompt feedback (Phase 3)
The vision is a review mode where you move through transcripts and flag: wrong speaker attribution, poor bullet quality, excessive filler, missed entity. What's the right granularity? Per-turn flags? Per-bullet flags? Both? And how does the feedback actually feed back into prompts — is this a manual review → manual prompt edit loop, or does it accumulate into something more automated over time?

The manual loop is probably right for v1. The data model (turns JSONB, per-turn annotation) should be designed to support something more automated later without requiring a schema change.

### 2. When to add few-shot examples to the bullets prompt
The answer is "after the first batch of 5+ transcripts" — but this requires discipline to actually do before declaring Phase 1 done. If it slips to Phase 4 dogfooding, the bullet quality stays mediocre for the entire early usage period. Treat it as a Phase 1 exit criterion.

### 3. Transcript viewer as a reading experience
Progressive disclosure is the right pattern. But the specific UX design is underspecified:
- Do section headings always show, or only on hover/expand?
- Does expanding a section show all turn summaries, or only the guest's?
- Does expanding a turn summary show just that turn's full text, or does the whole transcript scroll into view?
- How does in-transcript search interact with the collapse/expand state?

These are Phase 1 design decisions, not architecture decisions. But they're worth thinking through before building.

### 4. Bullets → transcript deep link specificity
Currently: bullet links to `/transcript/[id]#section-anchor`. Better would be: bullet links to `/transcript/[id]?q=search-terms` where `q` is derived from the bullet's key terms, pre-loading in-transcript search at the relevant point. This requires deriving search terms from the bullet at display time (client-side, trivial) or storing them alongside the bullet at ingest (more robust). Worth deciding in Phase 1.

### 5. `turn_summaries` prompt calibration
The per-turn summary prompt is unwritten. Key design questions:
- One sentence per turn — how to handle long turns with multiple distinct points?
- How to handle host setup/question turns — summarize or suppress?
- Should summaries be written from the speaker's POV ("Describes Apollo's origination platform") or neutral ("Apollo's origination platform described")?

---

## Decisions Made and Why

| Decision | What was decided | Why |
|----------|-----------------|-----|
| `turns` JSONB in Phase 0 schema | Add now, populate at extract step | Enables per-turn annotation and progressive disclosure UI without backfill; parsing speaker-labeled transcript into structured turns costs nothing |
| `transcript_chunks` table in Phase 0 schema | Add migration now, don't populate | Zero backfill cost when Phase 5 RAG arrives; `cleaned_transcript` is the source of truth |
| Pure vector search (not hybrid) for RAG | Vector only when RAG added | Entity tags handle proper nouns; hybrid re-ranking complexity not worth it |
| Bullets as triage layer, not primary output | Reframe in UI + plan | Pre-generated bullets are never specific enough for depth research; transcript reading experience is the actual value |
| Per-turn summaries as Phase 1 pipeline step | One LLM call at ingest | Enables collapsed/expanded viewer without query-time LLM; one call per transcript is negligible cost |
| Colossus-only chunking stateless (Phase 0) | Don't handle speaker state yet | Colossus transcripts have inline speaker labels; YouTube speaker state complexity deferred to Phase 1+ |
| YouTube scraper deferred to Phase 1+ | Phase 0: Colossus only | Avoid scope creep; manual ingest is the fallback if Colossus auth breaks |
