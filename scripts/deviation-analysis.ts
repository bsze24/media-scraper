/**
 * Expected-position deviation analysis: measure how far each matched turn's
 * timestamp deviates from where it should be based on transcript position.
 *
 * Usage: npx tsx scripts/deviation-analysis.ts
 */

import { loadEnvConfig } from "@next/env";
loadEnvConfig(process.cwd());

import { createServerClient } from "@lib/db/client";
import type { AppearanceRow } from "@lib/db/types";
import type { Turn } from "@/types/appearance";
import type { CaptionSegment } from "@lib/scrapers/youtube";

const MATCH_WORD_COUNT = 6;
const MATCH_THRESHOLD = 4;

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

function displayWords(text: string, count: number): string {
  return text.split(/\s+/).filter(Boolean).slice(0, count).join(" ");
}

function formatTime(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  return `${m}:${s.toString().padStart(2, "0")}`;
}

function getSegments(row: AppearanceRow): CaptionSegment[] {
  const meta = row.scraper_metadata as Record<string, unknown> | null;
  if (!meta) return [];
  return (meta.segments as CaptionSegment[] | undefined) ?? [];
}

function getVideoDuration(row: AppearanceRow): number {
  const meta = row.scraper_metadata as Record<string, unknown> | null;
  if (!meta) return 0;
  return (meta.duration as number | undefined) ?? 0;
}

// ---------------------------------------------------------------------------
// Replay matching to identify known false matches (cascade detection)
// ---------------------------------------------------------------------------

interface MatchInfo {
  turnIndex: number;
  timestamp: number;
  overlap: number;
  turnText: string;
}

function replayAndDetect(
  turns: Turn[],
  segments: CaptionSegment[]
): { matches: MatchInfo[]; falseMatchIndices: Set<number> } {
  const matches: MatchInfo[] = [];
  let segScanPos = 0;
  let lastMatchedTimestamp = -1;

  for (const turn of turns) {
    const turnWords = extractWords(turn.text, MATCH_WORD_COUNT);
    if (turnWords.length === 0) continue;

    let bestOverlap = 0;
    let bestStart = -1;
    let bestSegIdx = -1;

    for (let i = segScanPos; i < segments.length; i++) {
      const segText = segments[i].text.replace(/^>>\s*/, "");
      const segWords = extractWords(segText, MATCH_WORD_COUNT);
      const overlap = wordOverlap(turnWords, segWords);
      if (overlap > bestOverlap) {
        bestOverlap = overlap;
        bestStart = segments[i].start;
        bestSegIdx = i;
      }
      if (overlap >= MATCH_WORD_COUNT) break;
    }

    if (bestOverlap >= MATCH_THRESHOLD && bestStart > lastMatchedTimestamp) {
      lastMatchedTimestamp = bestStart;
      segScanPos = bestSegIdx + 1;
      matches.push({
        turnIndex: turn.turn_index,
        timestamp: bestStart,
        overlap: bestOverlap,
        turnText: turn.text,
      });
    }
  }

  // Detect cascades: >5min gap with ≥5 orphaned turns
  const falseMatchIndices = new Set<number>();
  for (let i = 1; i < matches.length; i++) {
    const gap = matches[i].timestamp - matches[i - 1].timestamp;
    const orphaned = matches[i].turnIndex - matches[i - 1].turnIndex - 1;
    if (gap > 300 && orphaned >= 5) {
      falseMatchIndices.add(matches[i].turnIndex);
    }
  }

  return { matches, falseMatchIndices };
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main() {
  const supabase = createServerClient();
  const { data: rows, error } = await supabase
    .from("appearances")
    .select("*")
    .in("transcript_source", ["youtube_captions", "youtube_whisper"])
    .eq("processing_status", "complete")
    .order("title");

  if (error || !rows || rows.length === 0) {
    console.error("No YouTube appearances found:", error);
    return;
  }

  const appearances = rows as AppearanceRow[];

  interface DeviationEntry {
    title: string;
    turnIndex: number;
    totalTurns: number;
    expectedTime: number;
    actualTime: number;
    deviation: number;
    overlap: number;
    turnText: string;
    isKnownFalse: boolean;
  }

  const allDeviations: DeviationEntry[] = [];
  const knownFalseDeviations: DeviationEntry[] = [];

  console.log("=== EXPECTED-POSITION DEVIATION ANALYSIS ===");
  console.log(`Generated: ${new Date().toISOString()}\n`);

  for (const row of appearances) {
    const turns = row.turns ?? [];
    const segments = getSegments(row);
    const title = row.title ?? row.id;
    const videoDuration = getVideoDuration(row);

    if (segments.length === 0 || turns.length === 0 || videoDuration === 0) {
      console.log(`Skipping "${title}" — missing segments/turns/duration`);
      continue;
    }

    const { matches, falseMatchIndices } = replayAndDetect(turns, segments);

    for (const m of matches) {
      const expectedTime = (m.turnIndex / turns.length) * videoDuration;
      const deviation = Math.abs(m.timestamp - expectedTime);
      const isKnownFalse = falseMatchIndices.has(m.turnIndex);

      const entry: DeviationEntry = {
        title,
        turnIndex: m.turnIndex,
        totalTurns: turns.length,
        expectedTime,
        actualTime: m.timestamp,
        deviation,
        overlap: m.overlap,
        turnText: m.turnText,
        isKnownFalse,
      };

      allDeviations.push(entry);
      if (isKnownFalse) knownFalseDeviations.push(entry);
    }
  }

  // -----------------------------------------------------------------------
  // Deviation distribution
  // -----------------------------------------------------------------------
  const buckets = [
    { label: "0-1 min", min: 0, max: 60 },
    { label: "1-2 min", min: 60, max: 120 },
    { label: "2-5 min", min: 120, max: 300 },
    { label: "5-10 min", min: 300, max: 600 },
    { label: "10-15 min", min: 600, max: 900 },
    { label: "15-20 min", min: 900, max: 1200 },
    { label: "20-30 min", min: 1200, max: 1800 },
    { label: "30+ min", min: 1800, max: Infinity },
  ];

  const total = allDeviations.length;
  const pct = (n: number) => ((n / total) * 100).toFixed(1);

  console.log(`\nDEVIATION DISTRIBUTION (${total} matched turns across ${appearances.length} appearances)`);
  console.log(`${"=".repeat(65)}`);

  for (const b of buckets) {
    const count = allDeviations.filter(
      (d) => d.deviation >= b.min && d.deviation < b.max
    ).length;
    const bar = "█".repeat(Math.round((count / total) * 60));
    console.log(`  ${b.label.padEnd(12)} ${String(count).padStart(4)} (${pct(count).padStart(5)}%)  ${bar}`);
  }

  // -----------------------------------------------------------------------
  // The tail — every match with deviation >10 minutes
  // -----------------------------------------------------------------------
  const tail = allDeviations
    .filter((d) => d.deviation >= 600)
    .sort((a, b) => b.deviation - a.deviation);

  console.log(`\n\nTHE TAIL — matches with deviation >10 minutes (${tail.length} total)`);
  console.log(`${"=".repeat(65)}`);

  for (const d of tail) {
    const falseTag = d.isKnownFalse ? " ⚠ KNOWN FALSE MATCH" : "";
    console.log(
      `\n  [${d.title.slice(0, 55)}]`
    );
    console.log(
      `  Turn ${d.turnIndex}/${d.totalTurns}: expected ~${formatTime(d.expectedTime)}, matched at ${formatTime(d.actualTime)}, deviation: ${formatTime(d.deviation)}${falseTag}`
    );
    console.log(`  First 10 words: "${displayWords(d.turnText, 10)}"`);
    console.log(`  Overlap: ${d.overlap}/${MATCH_WORD_COUNT}`);
  }

  // -----------------------------------------------------------------------
  // Cross-check known false matches
  // -----------------------------------------------------------------------
  console.log(`\n\nKNOWN FALSE MATCHES — deviation values`);
  console.log(`${"=".repeat(65)}`);

  if (knownFalseDeviations.length === 0) {
    console.log("  None identified.");
  } else {
    knownFalseDeviations.sort((a, b) => b.deviation - a.deviation);
    for (const d of knownFalseDeviations) {
      console.log(
        `  Turn ${d.turnIndex}/${d.totalTurns} in [${d.title.slice(0, 45)}]: deviation ${formatTime(d.deviation)} (${Math.round(d.deviation)}s) — overlap ${d.overlap}/6`
      );
    }
    const minFalseDev = Math.min(...knownFalseDeviations.map((d) => d.deviation));
    const maxFalseDev = Math.max(...knownFalseDeviations.map((d) => d.deviation));
    console.log(`\n  Range: ${formatTime(minFalseDev)} to ${formatTime(maxFalseDev)}`);
  }

  // -----------------------------------------------------------------------
  // Gap analysis — look for separation
  // -----------------------------------------------------------------------
  console.log(`\n\nGAP ANALYSIS — looking for natural separation`);
  console.log(`${"=".repeat(65)}`);

  const sorted = allDeviations.map((d) => d.deviation).sort((a, b) => a - b);

  // Find the largest gap between consecutive deviation values
  // (only look in the range where we'd expect separation: >2 min)
  let bestGapStart = 0;
  let bestGapEnd = 0;
  let bestGapSize = 0;

  for (let i = 1; i < sorted.length; i++) {
    if (sorted[i - 1] < 120) continue; // ignore tiny deviations
    const gap = sorted[i] - sorted[i - 1];
    if (gap > bestGapSize) {
      bestGapSize = gap;
      bestGapStart = sorted[i - 1];
      bestGapEnd = sorted[i];
    }
  }

  // Also compute: what % of matches are below the gap start?
  const belowGap = sorted.filter((d) => d <= bestGapStart).length;

  console.log(`  Largest gap in deviation distribution (above 2 min):`);
  console.log(`    From ${formatTime(bestGapStart)} to ${formatTime(bestGapEnd)} — gap of ${formatTime(bestGapSize)} (${Math.round(bestGapSize)}s)`);
  console.log(`    ${belowGap}/${total} matches (${pct(belowGap)}%) fall at or below ${formatTime(bestGapStart)}`);
  console.log(`    ${total - belowGap}/${total} matches (${pct(total - belowGap)}%) fall at or above ${formatTime(bestGapEnd)}`);

  // Check if known false matches are above or below the gap
  const falseAbove = knownFalseDeviations.filter(
    (d) => d.deviation >= bestGapEnd
  ).length;
  const falseBelow = knownFalseDeviations.filter(
    (d) => d.deviation <= bestGapStart
  ).length;
  console.log(`\n  Known false matches above gap: ${falseAbove}/${knownFalseDeviations.length}`);
  console.log(`  Known false matches below gap: ${falseBelow}/${knownFalseDeviations.length}`);

  if (falseAbove === knownFalseDeviations.length && belowGap / total > 0.9) {
    const threshold = Math.round(bestGapStart + bestGapSize / 2);
    console.log(`\n  ✓ CLEAN SEPARATION at ~${formatTime(threshold)}`);
    console.log(`    A deviation threshold of ${threshold}s (${formatTime(threshold)}) would:`);
    console.log(`    - Block all ${knownFalseDeviations.length} known false matches`);
    console.log(`    - Retain ${belowGap}/${total} matches (${pct(belowGap)}%)`);

    // How many non-false matches would be lost?
    const nonFalseAbove = tail.filter(
      (d) => !d.isKnownFalse && d.deviation >= threshold
    ).length;
    console.log(`    - Would also reject ${nonFalseAbove} non-false-classified matches with high deviation (review these)`);
  } else {
    console.log(`\n  ✗ No clean separation found that captures all known false matches.`);
  }
}

main().catch((err) => {
  console.error("Fatal error:", err);
  process.exit(1);
});
