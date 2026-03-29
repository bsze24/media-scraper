# Session Log — March 27-29, 2026 (Segmentation + Viewer Polish)

## Context
Multi-day session covering passage-level segmentation (prompt, test harness, post-processing, regression baselines) and transcript viewer keyboard polish. PRs #58, #59, #60.

---

## Segmentation Prompt — Round 1

### Built
- `lib/prompts/segmentation.ts` — system prompt, `formatSegmentsForPrompt`, `formatSpeakersForSegmentation`, `buildSegmentationPrompt`
- `scripts/test-segmentation.ts` — CLI test harness with Zod validation and analysis summary

### First run: TA Associates (895 segments)
- 46 passages in 35.3s
- Issues: 9 passages >30 segments (max 94), speaker annotations added ("Oscar Loynaz (TA)"), multi-segment overlaps, structural tags ("closing")

---

## Segmentation Prompt — Round 2

### Prompt tightening
- Max 25 segments per passage (was "typically 3-15")
- 4+ tags = signal to split
- Speaker names must match list exactly
- Overlap must be exactly 1 segment
- Banned structural tags: introduction, closing, wrap-up, meeting logistics, next steps
- Calibration anchor: ~60-100 passages for 30-min call

### Test script additions
- `--list` mode — discover YouTube appearances with segment counts
- Batch mode — multiple IDs, sequential execution
- Cross-appearance comparison table
- Fixed `transcript_source` filter: `startsWith("youtube")` not `=== "youtube"` (actual values: `youtube_captions`, `youtube_whisper`)
- Added `loadEnvConfig` from `@next/env` (all scripts use this pattern)

### TA Associates re-run
- 72 passages (up from 46) — in 60-100 target range
- Overlaps fixed to single-segment
- But: 11 passages still >25, "Oscar Loynaz (TA)" persists, structural tags remain

### Batch run (5 appearances)
| Appearance | Segs | Passages | Max Size | Coverage | Time |
|------------|------|----------|----------|----------|------|
| Stone Point | 882 | 50 | 44 | 99.4% | 42.7s |
| Rowspace TA CTO | 577 | 50 | 38 | 99.1% | 40.5s |
| Apollo Everest | 1058 | 83 | 44 | 100% | 58.2s |
| Gavin Baker | 1813 | 80 | 98 | 99.9% | 59.1s |
| WTT Private Markets | 191 | 22 | 15 | 100% | 16.9s |

**Key finding:** prompt works well on short calls (<500 segs). On longer calls, Sonnet drops the 25-segment max — likely attention issue at 50k+ char prompts.

---

## Regression Snapshot

### Built
- `scripts/regression-snapshot.ts` — snapshots all complete appearances: turns, speakers, timestamp coverage, bullets, sections, entities, summaries, segment count, cleaned transcript length

### Baselines captured
- **Dev:** 36 appearances (32 YouTube avg 88.5% TS coverage, 4 Colossus) → `regression-snapshot-2026-03-28.json`
- **Prod:** 60 appearances (30 YouTube avg 88.3% TS coverage, 30 Colossus) → `regression-snapshot-2026-03-28-prod.json`

---

## Chrome MCP Visual Baselines

Screenshots of 6 transcript viewer pages saved to `scripts/output/baseline-*.png`:
- TA Associates, Stone Point, Rowspace TA CTO, Apollo Everest, Gavin Baker, WTT Private Markets

---

## Post-Processing Module

### Built
- `lib/pipeline/post-process-passages.ts` — pure deterministic function, no API/DB calls
- `lib/pipeline/post-process-passages.test.ts` — 24 unit tests

### Processing steps
1. **Speaker name normalization** — strip parentheticals, exact → case-insensitive → substring match, longest match wins
2. **Passage size enforcement** — split >25 at midpoint or nearest `>>` marker, 5-segment floor, 2-pass max
3. **Overlap enforcement** — reduce multi-segment overlaps to max 1
4. **Coverage gap detection** — warn about uncovered segments (don't fix)
5. **Structural tag filtering** — 30+ stopwords, fallback to "general discussion"

### Design decisions
- Two-pass split (not recursive per-passage) — simpler, same result
- Longest speaker name wins on ambiguous substring (more specific)
- Split passages copy all topic_tags to both halves (known tech debt)
- `>>` marker segment placed in second passage on split (marks start of new speech)
- Pre-strip exact match on original name before stripping parentheticals (handles DB names with annotations)

---

## PR #58 — Speaker Mismatch Warning (1 BugBot round)

Extracted `detectSpeakerMismatch` from duplicated inline logic in `search/page.tsx` and `TranscriptViewer.tsx` into shared `src/app/speaker-utils.ts`.

---

## PR #60 — Transcript Viewer Polish (22 BugBot issues, 10 rounds)

### Original features
- Spatial shortcut badges (`<kbd>` elements) across speaker panel, sections, control bar
- Removed shortcuts bar — shortcuts shown inline as badges
- Video mode toggles — `v` cycles collapsed/pip/full
- Keyboard remapping — `n/p` for section nav, `?` help overlay, save/reset shortcuts
- Section toggle — collapsible sections with n/p navigation and active highlighting
- Auto-follow label clarity

### BugBot marathon — key issues fixed

**Stale closures (high):**
- `activeSpeaker` missing from keyboard handler deps
- `savedMatchesCurrent` and `saving` missing from deps
- `allAnchors` missing from deps (inlined Escape logic)
- `activeTurnSectionAnchor` missing from deps

**Speaker filter cycling (medium, 6 rounds):**
Root cause: number key handler was built incrementally to match `handleSpeakerClick`, one piece at a time. Each fix exposed the next missing piece.
- Round 1: Missing save-state before mutation
- Round 2: Save ordering wrong (saved after mutation)
- Round 3: Doesn't filter sections
- Round 4: Uses toggle not replace for expandedTurns
- Round 5: Missing scroll-to-speaker
- Round 6: Missing toggle-off behavior
- **Resolution:** Extracted `applySpeakerFilter` shared helper. Number key calls `handleSpeakerClick` which delegates select to `applySpeakerFilter`. Zero duplication.

**Other fixes:**
- `modSymbol` hydration mismatch — moved to useState + useEffect
- Speed buttons invisible on mobile — added fallback spans
- Help `?` button invisible on mobile — added fallback span
- `reelInfoBlock` always-truthy fragment — returns null when empty
- `handleClearSavedView` 1s timeout race — reset immediately, show confirmation after
- Dead `allExpanded`/`allCollapsed` variables removed
- `n/p` expand collapsed sections before navigating
- `scrollToSection` resets `lastNavWasKeyboardRef`
- "full video" → "full call" for audio-only transcripts
- Help overlay label: "Toggle speaker filter" not "Toggle expand / collapse"

### Dismissed (intentional)
- Speed wrap behavior on center button — intentional UX
- Shift+X unhide removal — covered by Shift+R reset
- Non-US keyboard Shift+number — pre-existing, separate concern

### Lesson learned
Incremental copy-paste of handler logic causes BugBot cycling. When a keyboard shortcut should behave like an existing click handler, call the handler directly or extract a shared helper up front. Don't replicate side effects one at a time.

---

## PRs merged
- **#58** — `fix/speaker-mismatch-warning` — extract detectSpeakerMismatch
- **#59** — `feat/passage-segmentation-test` — segmentation prompt, test harness, post-processing, regression snapshot
- **#60** — `feat/final-transcript-viewer-polish` — keyboard shortcuts, badges, video modes, 22 BugBot fixes

## Files added/modified
- `lib/prompts/segmentation.ts` — new
- `lib/pipeline/post-process-passages.ts` — new
- `lib/pipeline/post-process-passages.test.ts` — new
- `scripts/test-segmentation.ts` — new
- `scripts/regression-snapshot.ts` — new
- `src/app/speaker-utils.ts` — new (extracted from search + viewer)
- `src/app/transcript/[id]/TranscriptViewer.tsx` — major: applySpeakerFilter extraction, 22 bug fixes, kbd badges
- `src/app/transcript/[id]/SpeakerPanel.tsx` — kbd badges
- `src/app/transcript/[id]/TurnRenderer.tsx` — kbd badges
- `src/app/transcript/[id]/helpers.tsx` — KBD_CLASS export
- `src/app/search/page.tsx` — use shared speaker-utils
- `.gitignore` — added `scripts/output/`

## Open items for next session
- Prompt still produces oversized passages on long calls (>1000 segments) — may need input chunking or stronger model
- Split passages inherit parent's topic tags (tech debt — tags become over-broad)
- `"Oscar Loynaz (TA)"` is the canonical name in the DB speakers array — post-processing matches it exactly, so no normalization occurs. May want to clean the DB value.
- Post-processing module not wired into pipeline yet — standalone for now
- Duplicated Escape deselect logic — defer to useKeyboardShortcuts extraction
