/**
 * Simulate: Pass 2 bracketed timestamp recovery.
 *
 * After pass 1 (extractTimestamps with deviation constraint), some turns
 * remain unmatched. Pass 2 uses high-confidence matches from pass 1 as
 * brackets to define narrow time windows, then searches within those
 * windows at a relaxed 3/6 threshold.
 *
 * Usage: npx tsx scripts/simulate-pass2.ts
 */

import { loadEnvConfig } from "@next/env";
loadEnvConfig(process.cwd());

import { createServerClient } from "@lib/db/client";
import type { Turn } from "@/types/appearance";
import type { CaptionSegment } from "@lib/scrapers/youtube";

// Mirror constants from extract-timestamps.ts
const MATCH_WORD_COUNT = 6;
const MATCH_THRESHOLD = 4;
const MAX_DEVIATION_SECONDS = 900;
const PASS2_THRESHOLD = 3;

// ---------------------------------------------------------------------------
// Matching helpers (identical to extract-timestamps.ts)
// ---------------------------------------------------------------------------

function extractWords(text: string, count: number): string[] {
  return text
    .toLowerCase()
    .replace(/[^\w\s]/g, "")
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, count);
}

function wordOverlap(a: string[], b: string[]): number {
  const setA = new Set(a);
  const setB = new Set(b);
  let count = 0;
  for (const w of setA) {
    if (setB.has(w)) count++;
  }
  return count;
}

function fmt(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  return `${m}:${s.toString().padStart(2, "0")}`;
}

// ---------------------------------------------------------------------------
// Pass 1: replica of extractTimestamps() with deviation constraint
// ---------------------------------------------------------------------------

interface Pass1Result {
  turnIndex: number;
  matched: boolean;
  timestamp: number; // -1 if unmatched
}

function runPass1(
  turns: Turn[],
  segments: CaptionSegment[],
  videoDuration: number
): Pass1Result[] {
  const totalTurns = turns.length;
  const hasDev = videoDuration > 0;
  let segScanPos = 0;
  let lastTs = -1;
  const results: Pass1Result[] = [];

  for (const turn of turns) {
    const tw = extractWords(turn.text, MATCH_WORD_COUNT);
    if (tw.length === 0) {
      results.push({ turnIndex: turn.turn_index, matched: false, timestamp: -1 });
      continue;
    }

    let bestOverlap = 0;
    let bestStart = -1;
    let bestSegIdx = -1;

    for (let i = segScanPos; i < segments.length; i++) {
      const segText = segments[i].text.replace(/^>>\s*/, "");
      const segWords = extractWords(segText, MATCH_WORD_COUNT);
      const ov = wordOverlap(tw, segWords);

      if (ov > bestOverlap) {
        bestOverlap = ov;
        bestStart = segments[i].start;
        bestSegIdx = i;
      }
      if (ov >= MATCH_WORD_COUNT) break;
    }

    if (bestOverlap >= MATCH_THRESHOLD && bestStart > lastTs) {
      if (hasDev) {
        const expectedTime = (turn.turn_index / totalTurns) * videoDuration;
        const deviation = Math.abs(bestStart - expectedTime);
        if (deviation > MAX_DEVIATION_SECONDS) {
          results.push({ turnIndex: turn.turn_index, matched: false, timestamp: -1 });
          continue;
        }
      }
      lastTs = bestStart;
      segScanPos = bestSegIdx + 1;
      results.push({ turnIndex: turn.turn_index, matched: true, timestamp: bestStart });
    } else {
      results.push({ turnIndex: turn.turn_index, matched: false, timestamp: -1 });
    }
  }

  return results;
}

// ---------------------------------------------------------------------------
// Pass 2: bracketed recovery
// ---------------------------------------------------------------------------

interface Pass2Match {
  turnIndex: number;
  bracketStart: number;
  bracketEnd: number;
  matchedAt: number;
  overlap: number;
}

function runPass2(
  turns: Turn[],
  segments: CaptionSegment[],
  pass1: Pass1Result[],
  videoDuration: number
): Pass2Match[] {
  const recoveries: Pass2Match[] = [];
  const totalTurns = turns.length;
  let lastTimestamp = -1;

  for (let i = 0; i < pass1.length; i++) {
    if (pass1[i].matched) {
      lastTimestamp = pass1[i].timestamp;
      continue;
    }

    const turn = turns[i];
    const tw = extractWords(turn.text, MATCH_WORD_COUNT);
    if (tw.length === 0) continue;

    // Find bracket_start: nearest matched turn BEFORE
    let bracketStart = 0;
    for (let j = i - 1; j >= 0; j--) {
      if (pass1[j].matched) {
        bracketStart = pass1[j].timestamp;
        break;
      }
    }

    // Find bracket_end: nearest matched turn AFTER
    let bracketEnd = videoDuration;
    for (let j = i + 1; j < pass1.length; j++) {
      if (pass1[j].matched) {
        bracketEnd = pass1[j].timestamp;
        break;
      }
    }

    // Search ALL segments within the bracket window (not forward-only)
    let bestOverlap = 0;
    let bestStart = -1;

    for (const seg of segments) {
      if (seg.start < bracketStart || seg.start > bracketEnd) continue;

      const segText = seg.text.replace(/^>>\s*/, "");
      const segWords = extractWords(segText, MATCH_WORD_COUNT);
      const ov = wordOverlap(tw, segWords);

      if (ov > bestOverlap) {
        bestOverlap = ov;
        bestStart = seg.start;
      }
    }

    if (bestOverlap >= PASS2_THRESHOLD && bestStart >= 0 && bestStart > lastTimestamp) {
      // Deviation check — match production behavior
      const expectedTime = (turn.turn_index / totalTurns) * videoDuration;
      const deviation = Math.abs(bestStart - expectedTime);
      if (deviation > MAX_DEVIATION_SECONDS) continue;

      lastTimestamp = bestStart;
      recoveries.push({
        turnIndex: turn.turn_index,
        bracketStart,
        bracketEnd,
        matchedAt: bestStart,
        overlap: bestOverlap,
      });
    }
  }

  return recoveries;
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main() {
  const sb = createServerClient();
  const { data: rows, error } = await sb
    .from("appearances")
    .select("id, title, turns, scraper_metadata")
    .eq("processing_status", "complete")
    .like("transcript_source", "youtube%");

  if (error) throw error;
  if (!rows || rows.length === 0) {
    console.log("No YouTube appearances found.");
    return;
  }

  let grandPass1 = 0;
  let grandPass2 = 0;
  let grandTotal = 0;
  const overlapDist: Record<number, number> = { 3: 0, 4: 0, 5: 0, 6: 0 };

  for (const row of rows) {
    const turns = (row.turns ?? []) as Turn[];
    const meta = row.scraper_metadata as Record<string, unknown> | null;
    const segments = (meta?.segments as CaptionSegment[] | undefined) ?? [];
    const videoDuration = (meta?.duration as number | undefined) ?? 0;

    if (turns.length === 0 || segments.length === 0) continue;

    const pass1 = runPass1(turns, segments, videoDuration);
    const pass1Matched = pass1.filter((r) => r.matched).length;

    const pass2 = runPass2(turns, segments, pass1, videoDuration);

    const combined = pass1Matched + pass2.length;
    const pass1Pct = ((pass1Matched / turns.length) * 100).toFixed(0);
    const combinedPct = ((combined / turns.length) * 100).toFixed(0);

    grandPass1 += pass1Matched;
    grandPass2 += pass2.length;
    grandTotal += turns.length;

    for (const r of pass2) {
      const key = Math.min(r.overlap, 6);
      overlapDist[key] = (overlapDist[key] ?? 0) + 1;
    }

    // Per-appearance report
    const titleShort =
      row.title && (row.title as string).length > 65
        ? (row.title as string).slice(0, 65) + "…"
        : (row.title as string);

    console.log(`\n${titleShort}`);
    console.log(`  Pass 1: ${pass1Matched}/${turns.length} turns (${pass1Pct}%)`);
    console.log(`  Pass 2 recovered: +${pass2.length} turns`);
    console.log(`  Combined: ${combined}/${turns.length} turns (${combinedPct}%)`);

    if (pass2.length > 0) {
      // Bracket stats
      const windows = pass2.map((r) => r.bracketEnd - r.bracketStart);
      const avg = windows.reduce((a, b) => a + b, 0) / windows.length;
      const min = Math.min(...windows);
      const max = Math.max(...windows);

      console.log(`\n  Bracket stats:`);
      console.log(`    Avg bracket window: ${Math.round(avg)}s (${fmt(avg)})`);
      console.log(`    Narrowest bracket: ${Math.round(min)}s (${fmt(min)})`);
      console.log(`    Widest bracket: ${Math.round(max)}s (${fmt(max)})`);

      const showCount = Math.min(5, pass2.length);
      console.log(`\n  Pass 2 match details (first ${showCount}):`);
      for (let k = 0; k < showCount; k++) {
        const r = pass2[k];
        const cascadeNote = r.overlap >= MATCH_THRESHOLD
          ? " (cascade victim — would have matched in pass 1)"
          : "";
        console.log(
          `    Turn ${r.turnIndex}: bracket [${fmt(r.bracketStart)} - ${fmt(r.bracketEnd)}], matched at ${fmt(r.matchedAt)}, overlap ${r.overlap}/${MATCH_WORD_COUNT}${cascadeNote}`
        );
      }
      if (pass2.length > showCount) {
        console.log(`    ... and ${pass2.length - showCount} more`);
      }
    }
  }

  // Summary
  const grandCombined = grandPass1 + grandPass2;
  const pass1Pct = grandTotal > 0 ? ((grandPass1 / grandTotal) * 100).toFixed(1) : "0.0";
  const combinedPct = grandTotal > 0 ? ((grandCombined / grandTotal) * 100).toFixed(1) : "0.0";

  console.log(`\n${"=".repeat(60)}`);
  console.log("PASS 2 SIMULATION RESULTS");
  console.log("=".repeat(60));
  console.log(
    "                        | Pass 1  | + Pass 2 | Combined"
  );
  console.log(
    `Total matched turns     | ${String(grandPass1).padStart(7)} | ${("+" + grandPass2).padStart(8)} | ${String(grandCombined).padStart(8)}`
  );
  console.log(
    `Overall coverage        | ${(pass1Pct + "%").padStart(7)} |          | ${(combinedPct + "%").padStart(8)}`
  );

  console.log(`\nPass 2 recoveries by overlap:`);
  for (const ov of [3, 4, 5, 6]) {
    const count = overlapDist[ov] ?? 0;
    const label =
      ov === 3
        ? "(only recoverable with relaxed threshold)"
        : ov === 4
          ? "(cascade victims — would have matched in pass 1 without upstream false match)"
          : "";
    console.log(`  ${ov}/${MATCH_WORD_COUNT}: ${count} turns ${label}`);
  }
}

main().catch((err) => {
  console.error("Fatal error:", err);
  process.exit(1);
});
