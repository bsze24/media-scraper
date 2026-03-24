# Session Log: 2026-03-23 — Transcript QA + Speaker Management

**Date:** March 23, 2026
**Branch:** `feat/transcript-qa-keyboard`
**PR:** #41
**Commits:** 5

---

## What shipped

### 1. Speakers backfill — `1c94e15`
**Problem:** YouTube appearances from Loom uploads had empty `speakers[]` because yt-dlp can't extract speaker names from video metadata for uploaded recordings. The sidebar was blank.

**Fix:** After the LLM cleaning step produces `turns[]` with "Speaker 1/2/3" labels, a backfill step extracts distinct speaker names from turns and populates `speakers[]` with `role: "guest"`. Filters empty strings. Only runs when `speakers[]` is empty (never overwrites scraper-provided speakers).

**Files:** `lib/queue/orchestrator.ts`, `lib/db/queries.ts` (new `writeSpeakers` helper)

### 2. API routes + reprocessing protection — `dc8989b`
Three API routes for speaker/turn corrections:

| Route | Purpose | Cascade |
|-------|---------|---------|
| `POST /api/appearances/[id]/rename-speaker` | Cascading rename across all 6 data locations | Yes — speakers, turns, turn_summaries, prep_bullets, entity_tags, cleaned_transcript |
| `POST /api/appearances/[id]/correct-turn` | Single-turn speaker re-attribution or text fix | No — single turn only |
| `POST /api/appearances/[id]/set-speaker-role` | Role, title, and affiliation updates | No — speakers[] only |

**Reprocessing protection:** `mergeCorrectedTurns()` preserves human-corrected turns (`corrected: true`) during `reprocessSpeakers` and `processAppearance` retries. Keeps corrected speaker/text but accepts new timestamps/anchors from pipeline.

**Migration:** `011_corrections_extend.sql` — ALTER `turn_index` nullable, expand field CHECK to include `'role'`. Deployed to both dev and prod.

**Type updates:** `SpeakerRole` expanded to `host | guest | rowspace | customer | other`. Speaker interface gained optional `title` field. `TranscriptViewerProps` updated to pass through `corrected` and full role type.

### 3. Speaker management UI — `1896400`
**Speaker sidebar panel:**
- Pencil icon → inline rename input (Enter/blur saves, Escape cancels)
- Role dropdown (host/guest/rowspace/customer/other)
- Clickable title/affiliation subtitle → inline edit ("Title, Affiliation" format)
- "+ Add title" link when no title exists
- Confirmation banner: "Renamed Speaker 1 → Yibo Zhang (32 turns, 0 quotes)"
- Error banner for API failures

**Turn-level re-attribution:**
- Click speaker name on turn → dropdown of all speakers
- If speakers are still generic (Speaker 1/2/3), clicking scrolls to speaker panel instead

**Turn-level text editing:**
- Pencil icon on turn hover (top-right)
- Click → textarea, auto-sized, max-height 300px
- Cmd+Enter or blur saves, Escape cancels

**State management:**
- `useAppearanceApi` hook manages mutable state (speakers, turns, turnSummaries, prepBullets, hasInferredAttribution)
- API responses replace state slices — no `router.refresh()`
- `enrichSpeakers()` re-derives title/affiliation from entity_tags after updates
- Turn role derived from `speakerRoleMap` (useMemo), not stored on turns
- `isCollapsedRole` includes both `host` and `rowspace`

### 4. Data quality review banner — `53d400e`
Amber banner at top of transcript column. Triggers on data signals:
- Any speakers with generic names (`/^Speaker \d+$/`)
- All turn attributions inferred
- Timestamp coverage below 50% (YouTube only)

Reactive — conditions recompute from mutable state. Renaming a generic speaker immediately removes that line. Dismissable via ×, reappears on reload.

### 5. BugBot fixes — `3d10df6`
7 issues fixed (6 from initial review + 1 follow-up):

| # | Severity | Issue | Fix |
|---|----------|-------|-----|
| 1 | Medium | Backfill includes empty speaker names | `.filter(Boolean)` on distinct names |
| 2 | Low | `writeSpeakers` duplicates inline logic | `reprocessSpeakers` now uses shared helper |
| 3 | High | Turn summaries shape mismatch after rename | `transformTurnSummaries()` converts array → Record |
| 4 | Medium | `updateSpeaker` drops speaker enrichment | Now calls `enrichSpeakers()` with cached entityTags |
| 5 | Low | Dead `guests`/`host` variables | Already removed in prior amend |
| 6 | Low | Enter+blur double-fire on inputs | `savingGuardRef` prevents duplicate API calls |
| 7 | Medium | `entityTags` initialized empty | Seed from initial speakers' title/affiliation |

---

## Other fixes (separate PRs)

- **PR #40** (`fix/admin-status-cache`): Admin page showed stale processing status because Next.js cached server action responses. Added `noStore()` to `getAllAppearances()` and `getQueueStatus()`.

---

## Diagnostic: Empty speakers[] on YouTube ingestion

Investigated why Loom recording had empty `speakers[]` after pipeline ingestion:

**Root cause:** YouTube scraper's `extractSpeakers()` parses speaker names from video title/description/channel. Loom uploads have filenames like `2026.01.05_vista_jennifer_lewis_pitch` — no parseable speaker metadata. The pipeline fell back to "Speaker 1/2/3" labels in the cleaned transcript (prompt already handled this via `formatSpeakersBlock`), but no step backfilled `speakers[]` from the turns.

**Finding:** `entity_tags.key_people` was confused — mixed up actual speakers with people mentioned in conversation, because entity extraction receives only cleaned transcript text, no speakers context.

---

## Prompt change verification

`formatSpeakersBlock` in `lib/prompts/clean.ts` already handles empty speakers with generic "Speaker 1/2" labeling. No code change needed — verified existing behavior.

---

## Live testing

| Test | Result |
|------|--------|
| Rename Speaker 1 → Jennifer Lewis | All 6 locations updated, persisted in DB |
| Rename Speaker 2 → Adrian Alonzo | Enrichment (CEO of PE, Vista) survived client-side |
| Edit turn text ("Well, thanks" → "Thanks") | API 200, corrected=true, attribution="source" in DB |
| Set role to rowspace | Turn collapse logic activated |
| Edit speaker title | "CTO, Ropespace" persisted on speakers[] JSONB |
| Data quality banner | Shows on transcripts with inferred attribution |
| Banner reactive dismissal | Conditions clear after rename → banner vanishes |

---

## Migration status

| Migration | Dev | Prod |
|-----------|-----|------|
| 005_corrections.sql (corrections table) | Deployed | Deployed |
| 011_corrections_extend.sql (nullable turn_index, role field) | Deployed | Deployed |
