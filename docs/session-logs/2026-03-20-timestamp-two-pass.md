# Session Log: Two-Pass Timestamp Extraction + Speaker Attribution Fix

**Date:** 2026-03-20 through 2026-03-22
**PRs:** #27 (timestamps), #28 (script replicas), #29 (speaker extraction)
**Duration:** ~4 hours across 2 days, 1 context compaction
**Result:** Timestamp coverage 49.5% → 94.2%, speaker attribution fixed for 5/12 appearances

---

## Part 1: Timestamp Extraction Fix

### Problem

`extractTimestamps()` in `lib/pipeline/extract-timestamps.ts` had a false-match cascade problem. The forward-only scan accepts matches with ≥4/6 word overlap, but common conversational phrases ("I think that's important", "what are some of the") would match caption segments far from the correct position, jumping `segScanPos` forward 20-50 minutes and orphaning all subsequent turns.

Diagnostic findings from prior session (scripts in `scripts/diagnose-*.ts`):
- 5/12 appearances had at least one cascade, 53+ turns orphaned
- Stop-word filtering didn't work (false matches use common conversational words)
- Gap-from-previous-match proximity didn't work (distributions overlap)
- **Expected-position deviation worked:** 93% of true matches deviate <10 min from expected position; all known false matches deviate 25+ min

### Pass 1: Expected-Position Deviation Constraint

Added `MAX_DEVIATION_SECONDS = 900` (15 minutes) and optional `videoDuration` parameter. After finding a candidate match, compute:
```
expectedTime = (turn.turn_index / turns.length) * videoDuration
deviation = abs(candidateTimestamp - expectedTime)
```
If deviation exceeds threshold, reject — critically, do NOT advance `segScanPos`, so downstream turns can still find their correct matches.

Pass 1 measurement:
```
TOTAL: 758 turns, 375(49.5%) → 622(82.1%)
Cascades: 21 → 7 (14 eliminated)
```

### Can we tighten the threshold to catch remaining 7?

Queried overlap distribution of true matches by deviation bucket:

```
Deviation Bucket   4/6    5/6    6/6    Total   % at 4/6
0-5 min               65     83    217      365     17.8%
5-10 min              45     51    132      228     19.7%
10-15 min              3      4     10       17     17.6%
```

4/6 ratio is flat (~18-20%) across all buckets. A sliding scale would kill 48 true matches to eliminate 7 cascade triggers. Bad trade.

### Pass 2: Bracketed Recovery (simulate first, then implement)

**Simulation** (`scripts/simulate-pass2.ts`): For each unmatched turn, find nearest matched turns before/after as time brackets, search only segments within that window at relaxed 3/6 threshold.

```
PASS 2 SIMULATION: 82.1% → 94.3% (+93 turns)
Pass 2 recoveries: 91 at 3/6, 2 at 4/6 (cascade victims)
```

**Implementation** matched simulation exactly — validated by running standalone simulation against production function on all 714 turns: exact match.

### Inline Deviation Check (BugBot-driven improvement)

BugBot flagged: deviation check as post-filter discards valid nearby lower-overlap matches. If a far-away segment has higher overlap (e.g., 5/6) than a valid nearby segment (e.g., 4/6), the algorithm picks the far one, fails deviation, and leaves the turn unmatched.

Confirmed 2 real cases in production (Stonepeak turn 7, Vista turn 18). Fixed by integrating deviation check into the scan loop — only consider candidates within tolerance when tracking best overlap. Coverage recovered from 710 → 714.

### Final Numbers

```
                        | No fix  | Pass 1  | Pass 1+2
Total matched turns     |     375 |     624 |      714
Overall coverage        |   49.5% |   82.3% |    94.2%
```

### BugBot Issues Addressed (PR #27, 3 rounds)

| # | Title | Severity | Fix |
|---|-------|----------|-----|
| 1 | Pass 2 recovery doesn't enforce timestamp monotonicity | Medium | Added `lastPass2Timestamp` tracker seeded from pass 1 matches |
| 2 | Pass 2 recovery test actually matches in pass 1 | Medium | Replaced natural language (5/6 overlap) with controlled words for true 3/6 |
| 3 | Pass 2 uses `turn_index` as array index unsafely | Medium | Changed bracket loops from `turn.turn_index` to `.map()` `idx` parameter |
| 4 | Measurement script inflates counts with existing timestamps | Low | Strip `timestamp_seconds` from DB turns before running algorithms |
| 5 | Simulation pass 2 missing deviation check and monotonicity | Low | Added `lastTimestamp` tracking and deviation check to `runPass2()` |
| 6 | Unused `formatTime` function is dead code | Low | Removed |
| 7 | LLM-generated sections lose turn mapping during reprocessing | High | Only strip `turn_index` from sections that have `start_time` (can be remapped) |
| 8 | Deviation check discards valid nearby lower-overlap matches | Medium | Integrated deviation check into scan loop (both passes) |
| 9 | Pass 2 best-overlap test actually exercises pass 1 | Medium | Replaced natural language with controlled words (same class as #2) |

### Recurring test bug: wrong overlap counts

BugBot caught the same bug 3 times across 3 rounds: tests using natural language where the claimed word overlap was wrong (e.g., "Markets have been volatile recently indeed" vs "Markets have indeed been quite volatile" = 5/6, not 3/6 as commented). Each time a test was "fixed" with new natural language, the replacement also had wrong overlap.

Final sweep audited all 20 turn/segment pairs. Replaced all pass-2-specific tests with controlled words (`alpha bravo charlie delta echo foxtrot` vs `alpha bravo charlie golf hotel india` = exactly 3/6) to make overlap counts verifiable by inspection.

### False alarm: 29 "mismatches" between simulation and production

First comparison showed 29 mismatches across 2 appearances. Root cause: the throwaway inline comparison script used a buggy `wordOverlap` that iterated the raw array (`for (const w of b)`) instead of a set, inflating counts on duplicate words in caption segments. No committed code was affected. After fixing to set-vs-set intersection: exact match confirmed.

---

## Part 2: Script Replica Divergence (PR #28)

BugBot flagged: `runPass1Only` and `runPass1`/`runPass2` in measurement/simulation scripts applied deviation check as post-filter (old pattern), while production applies it inline (new pattern). This caused far-away segments to shadow nearby valid matches in scripts but not production, undercounting pass 1 by 2 turns.

Fixed all 3 replica functions. Also committed 3 reusable diagnostic scripts (`diagnose-timestamps.ts`, `deviation-analysis.ts`, `diagnose-all-appearances.ts`) — these intentionally replay the original (pre-fix) algorithm for cascade diagnosis, so no fix needed.

---

## Part 3: Speaker Attribution Fix (PR #29)

### Problem

5 of 12 YouTube appearances showed "Speaker 1 / Speaker 2" — all from the "Alt Goes Mainstream (AGM)" channel. The `extractSpeakers()` function has a hardcoded `knownHosts` map that only included Capital Allocators, ILTB, and Acquired. No entry for AGM.

### Pipeline flow for speaker attribution

1. **`lib/scrapers/youtube.ts` → `extractSpeakers(title, description, channel)`** — the only place speakers are detected. `knownHosts` is a literal hardcoded `Record<string, { name, affiliation }>` in the function body.
2. **`source_name`** on the appearance row is a direct assignment from yt-dlp's `channel` field (`sourceName: metadata.channel`). No transformation.
3. **`captionData`** (becomes `scraper_metadata`) only stores `segments`, `description`, `duration` — NOT `title`, `channel`, or `chapters`. Those are used at scrape time but not persisted.
4. Scraper result → `writeExtractResult()` → `speakers` column in DB → `buildYouTubeCleanPrompt(speakers)` → LLM attribution → `validateSpeakerAttribution()` → `normalizeSpeakerNames()`.

### Fix

- Added `"Alt Goes Mainstream (AGM)"` → Michael Sidgmore to `knownHosts`
- Expanded title regex from 2 patterns to 6: possessives with/without trailing s, "Live!" prefix, title/role before name, trailing comma name, middle initials
- All 11 titles with guests extract correctly; 1 solo episode correctly returns no match
- Added tech debt #22: speaker extraction is hardcoded per-channel

### Reprocessing

Built `reprocessSpeakers()` orchestrator function — re-extracts speakers from existing DB metadata, re-cleans transcript with correct names, re-runs full downstream cascade (validate → normalize → turns → timestamps → sections → turn summaries). Does NOT re-scrape or re-run entities/bullets.

`scripts/reprocess-speakers.ts` filters to appearances with generic speaker names and re-cleans only those (5 LLM clean calls + 5 turn summary calls).

---

## Part 4: Admin & Observability Polish

- **Stale warnings:** Reprocessing timestamps didn't clear old `timestamp_coverage_low` warnings. Fixed by building proper `reprocessTimestamps()` orchestrator function that handles the full lifecycle.
- **Processing detail:** Added timestamp coverage % to `processing_detail` summary, moved to front position so it's visible before column truncation in admin table.
- **Admin table:** Re-applied lost commit (from old merged branch) — ID column + title links to `/transcript/[id]` for completed appearances.
- **Implementation plan:** Updated Phase 1D status, timestamps section, project structure (7 missing files), validation #7, tech debt #22.

---

## Files Changed

### Production code
- `lib/pipeline/extract-timestamps.ts` — Two-pass algorithm with inline deviation check
- `lib/pipeline/extract-timestamps.test.ts` — 15 new tests
- `lib/queue/orchestrator.ts` — `reprocessTimestamps()`, `reprocessSpeakers()`, timestamp coverage in detail
- `lib/scrapers/youtube.ts` — AGM knownHosts entry, expanded title regex
- `src/app/page.tsx` — Admin table ID column + title links

### Scripts
- `scripts/measure-fix-impact.ts` — Three-column measurement (inline deviation)
- `scripts/simulate-pass2.ts` — Pass 2 simulation (inline deviation + monotonicity)
- `scripts/reprocess-timestamps.ts` — Bulk timestamp reprocessing
- `scripts/reprocess-speakers.ts` — Bulk speaker re-clean
- `scripts/diagnose-timestamps.ts` — Per-appearance timestamp diagnostic
- `scripts/deviation-analysis.ts` — Expected-position deviation analysis
- `scripts/diagnose-all-appearances.ts` — Batch diagnostic across all appearances

### Docs
- `docs/implementation-plan.md` — Phase 1D updates, project structure, tech debt #22

## Key Decisions

1. **15-minute deviation threshold:** Based on diagnostic data. 93% true matches <10 min, all false >25 min. Could tighten but 4/6 true matches are flat at ~18-20% across all deviation buckets — sliding scale doesn't work.

2. **Inline deviation check vs post-filter:** Moved deviation check inside the scan loop so it filters candidates before selecting best overlap. Prevents far-away high-overlap segments from shadowing valid nearby lower-overlap ones. 2 real cases in production.

3. **Pass 2 doesn't use forward-only scan:** Each turn searches its own bracket window independently. Monotonicity enforced via `lastPass2Timestamp` tracker seeded from pass 1 matches.

4. **Speaker extraction stays hardcoded for now:** Tech debt #22. Generalizing to LLM-based or DB-configurable extraction deferred to Phase 4 (self-serve URL submission). Current approach works for known podcast sources.

5. **Controlled words in tests:** After 3 rounds of BugBot catching wrong overlap counts in natural language, switched all pass-2-specific tests to NATO alphabet words where overlap is verifiable by inspection.
