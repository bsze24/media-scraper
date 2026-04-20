# Tech Debt #28: `mergeCorrectedTurns` silently corrupts human corrections when turn indices shift

**Priority:** P1 — data corruption, low-to-moderate frequency
**Sequencing:** After passages pipeline refactor lands
**File:** `lib/queue/orchestrator.ts` lines 51-81
**Callsites:** `processAppearance` line 309, `reprocessSpeakers` line 748

## The bug

`mergeCorrectedTurns` overlays human corrections from `existingTurns` onto freshly-parsed `newTurns` by matching on `turn_index`. This assumes `turn_index` is stable across the cleaning LLM's runs. It is not.

Cleaning LLM nondeterminism produces different turn segmentation across runs — the same raw transcript can yield 50 turns one time and 49 or 51 the next, as the LLM chooses different boundaries for speaker changes. Every `turn_index` at or past the divergence point shifts.

Two failure modes result:

**Mode A — silent loss (partially detected).** If reprocess produces fewer turns than the original and a correction's `turn_index` no longer exists in `newTurns`, the correction is silently dropped. The `lost` counter catches this case and logs it, but only to console.

**Mode B — silent misapplication (undetected).** If reprocess produces different content at the same `turn_index`, `correctedByIndex.get(t.turn_index)` returns truthy and the overlay runs anyway. The human's correction — speaker, text, attribution — gets applied to a completely different turn of the conversation. The `matched` counter increments, `lost` does not. The log message reads "preserving N human-corrected turns" — actively misleading.

## Example

Fay corrects turn 35 to read "Marc Rowan said private credit is underpriced, not mispriced." Reprocess runs a week later. The cleaning LLM splits one of Marc's earlier long answers into two turns, shifting every subsequent index by +1. The content that was at old turn 35 is now at new turn 36. But new turn 35 exists (it holds what used to be turn 34's second half), and `correctedByIndex.get(35)` returns truthy.

Fay's correction gets applied to new turn 35 — a different speaker moment entirely. Her "underpriced not mispriced" text replaces Marc's "you have pensions, endowments, insurance companies..." content. Turn 35 is now marked `corrected: true`, appears in the viewer as Fay's confirmed edit, and sits next to a timestamp that plays audio of a completely different sentence. The original uncorrected turn where Fay actually made the correction has been rebuilt from the LLM and the correction is gone.

No warning fires. Log says "preserving 1 human-corrected turns."

## Why this matters

The product thesis is quote-accurate attribution to fund managers for professional decisions. Silent misapplication of corrections produces confidently-wrong quotes attached to real people. Corrected turns have a UI marker indicating human verification, raising user trust in the exact content most at risk of being wrong.

Current state: ~5-20 corrected turns in prod, `reprocessSpeakers` runs occasionally. Exposure is bounded today but grows with each correction and each reprocess.

## Proposed fix

Add a content-based sanity check before applying the overlay. Crude first-N-chars comparison catches the misapplication case:

```typescript
const merged = newTurns.map((t) => {
  const corrected = correctedByIndex.get(t.turn_index);
  if (corrected) {
    // Sanity check: does the new turn look like the same content?
    const oldStart = corrected.text.slice(0, 40).toLowerCase().replace(/\s+/g, ' ').trim();
    const newStart = t.text.slice(0, 40).toLowerCase().replace(/\s+/g, ' ').trim();
    if (oldStart !== newStart) {
      // Index points at different content — skip overlay, preserve new turn as-is
      skippedForMismatch++;
      return t;
    }
    matched++;
    return { ...t, speaker: corrected.speaker, text: corrected.text, attribution: corrected.attribution, corrected: true };
  }
  return t;
});
```

Also persist the outcome to `processing_error` via `appendProcessingWarning` so skipped/lost corrections are visible in the admin UI, not just console:

```
correction_merge_issues: 2 skipped_mismatch, 1 lost_index_missing
```

Known limitation: first-40-chars comparison fails if a human correction replaced the first words of a turn (rare but possible). Alternatives to consider during implementation:
- Compare from the end of the text instead of the start
- Use a longer window with fuzzy threshold (e.g., Levenshtein < 20% of length)
- Store a content hash on corrected turns at correction time and match on that

The crude version is strictly better than current behavior and worth shipping first. Tune later if false-negative rate is a problem.

## Acceptance criteria

- `mergeCorrectedTurns` does not overlay corrections onto turns whose content has diverged beyond a threshold
- Both "lost" (index not found) and "skipped_mismatch" (index found but content differs) cases reach `processing_error` via `appendProcessingWarning`
- Unit test: given `existingTurns` with a correction at index 5 whose text doesn't match `newTurns[5]`, the function skips the overlay and reports the mismatch
- Unit test: given `existingTurns` with a correction at index 5 whose text does match `newTurns[5]`, the function overlays as before
- Unit test: given `existingTurns` with a correction at an index that doesn't exist in `newTurns`, the function reports the loss

## Out of scope

- Fixing LLM nondeterminism itself
- Preventing turn boundaries from shifting across reprocesses — would require separate architectural work
- Retroactive audit of existing corrected turns — separate migration if it turns out Mode B has already fired in prod
