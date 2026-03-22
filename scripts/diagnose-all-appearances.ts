/**
 * All-appearances timestamp diagnostic: stop word analysis, false-match
 * cascade detection, and content-word overlap distribution.
 *
 * Usage: npx tsx scripts/diagnose-all-appearances.ts
 */

import { loadEnvConfig } from "@next/env";
loadEnvConfig(process.cwd());

import { writeFileSync } from "fs";
import { join } from "path";
import { createServerClient } from "@lib/db/client";
import type { AppearanceRow } from "@lib/db/types";
import type { Turn } from "@/types/appearance";
import type { CaptionSegment } from "@lib/scrapers/youtube";

// Mirror extract-timestamps.ts exactly
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

// ---------------------------------------------------------------------------
// Matching replay (same as extract-timestamps.ts, but records per-turn data)
// ---------------------------------------------------------------------------

interface MatchResult {
  turnIndex: number;
  matched: boolean;
  overlap: number;
  segIndex: number;
  segTimestamp: number;
  turnWords: string[];
  segWords: string[];
  matchedWords: string[];
}

function replayMatching(
  turns: Turn[],
  segments: CaptionSegment[]
): MatchResult[] {
  const results: MatchResult[] = [];
  let segScanPos = 0;
  let lastMatchedTimestamp = -1;

  for (const turn of turns) {
    const turnWords = extractWords(turn.text, MATCH_WORD_COUNT);
    if (turnWords.length === 0) {
      results.push({
        turnIndex: turn.turn_index,
        matched: false,
        overlap: 0,
        segIndex: -1,
        segTimestamp: -1,
        turnWords: [],
        segWords: [],
        matchedWords: [],
      });
      continue;
    }

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

      const segText = segments[bestSegIdx].text.replace(/^>>\s*/, "");
      const segWords = extractWords(segText, MATCH_WORD_COUNT);
      const turnSet = new Set(turnWords);
      const segSet = new Set(segWords);
      const matchedWords = [...turnSet].filter((w) => segSet.has(w));

      results.push({
        turnIndex: turn.turn_index,
        matched: true,
        overlap: bestOverlap,
        segIndex: bestSegIdx,
        segTimestamp: bestStart,
        turnWords,
        segWords,
        matchedWords,
      });
    } else {
      results.push({
        turnIndex: turn.turn_index,
        matched: false,
        overlap: bestOverlap,
        segIndex: bestSegIdx,
        segTimestamp: bestStart,
        turnWords,
        segWords: [],
        matchedWords: [],
      });
    }
  }

  return results;
}

// ---------------------------------------------------------------------------
// Jump / cascade detection
// ---------------------------------------------------------------------------

interface Jump {
  fromTurnIndex: number;
  toTurnIndex: number;
  fromTimestamp: number;
  toTimestamp: number;
  timeGapSeconds: number;
  orphanedTurns: number;
  // Details about the match that caused the jump (the "to" turn)
  toTurnWords: string[];
  toMatchedWords: string[];
  toOverlap: number;
  toTurnDisplay: string;
}

function detectJumps(
  matchResults: MatchResult[],
  turns: Turn[]
): Jump[] {
  const matched = matchResults.filter((r) => r.matched);
  const jumps: Jump[] = [];

  for (let i = 1; i < matched.length; i++) {
    const prev = matched[i - 1];
    const curr = matched[i];
    const timeGap = curr.segTimestamp - prev.segTimestamp;
    const orphaned = curr.turnIndex - prev.turnIndex - 1;

    if (timeGap > 300 && orphaned >= 5) {
      const turn = turns[curr.turnIndex];
      jumps.push({
        fromTurnIndex: prev.turnIndex,
        toTurnIndex: curr.turnIndex,
        fromTimestamp: prev.segTimestamp,
        toTimestamp: curr.segTimestamp,
        timeGapSeconds: timeGap,
        orphanedTurns: orphaned,
        toTurnWords: curr.turnWords,
        toMatchedWords: curr.matchedWords,
        toOverlap: curr.overlap,
        toTurnDisplay: turn ? displayWords(turn.text, 10) : "",
      });
    }
  }

  return jumps;
}

// ---------------------------------------------------------------------------
// Stop word generation
// ---------------------------------------------------------------------------

interface StopWordEntry {
  word: string;
  percentage: number;
  segmentCount: number;
}

function generateStopWords(
  allSegments: CaptionSegment[],
  threshold: number
): StopWordEntry[] {
  const totalSegments = allSegments.length;
  const wordSegCounts = new Map<string, number>();

  for (const seg of allSegments) {
    const segText = seg.text.replace(/^>>\s*/, "");
    const words = extractWords(segText, 100); // all words
    const unique = new Set(words);
    for (const w of unique) {
      wordSegCounts.set(w, (wordSegCounts.get(w) ?? 0) + 1);
    }
  }

  const entries: StopWordEntry[] = [];
  for (const [word, count] of wordSegCounts) {
    const pct = (count / totalSegments) * 100;
    if (pct > threshold) {
      entries.push({ word, percentage: pct, segmentCount: count });
    }
  }

  entries.sort((a, b) => b.percentage - a.percentage);
  return entries;
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main() {
  const supabase = createServerClient();

  // Fetch all YouTube appearances
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
  console.log("=== ALL-APPEARANCES TIMESTAMP DIAGNOSTIC ===");
  console.log(`Generated: ${new Date().toISOString()}`);
  console.log(`YouTube appearances found: ${appearances.length}`);

  // -----------------------------------------------------------------------
  // PASS 0: Generate stop word lists at 5% and 10% thresholds
  // -----------------------------------------------------------------------
  const allSegments: CaptionSegment[] = [];
  for (const row of appearances) {
    allSegments.push(...getSegments(row));
  }

  console.log(`\n${"=".repeat(70)}`);
  console.log("CORPUS-DERIVED STOP WORD LIST");
  console.log(`${"=".repeat(70)}`);
  console.log(`Generated from ${allSegments.length} total segments across ${appearances.length} appearances\n`);

  const stopWords5 = generateStopWords(allSegments, 5);
  const stopWords10 = generateStopWords(allSegments, 10);
  const stopWordSet5 = new Set(stopWords5.map((e) => e.word));
  const stopWordSet10 = new Set(stopWords10.map((e) => e.word));

  console.log(`--- Threshold: >5% of segments (${stopWords5.length} words) ---`);
  console.log(`${"Word".padEnd(16)} | % of segments`);
  console.log(`${"".padEnd(16, "-")}|${"".padEnd(15, "-")}`);
  for (const entry of stopWords5.slice(0, 30)) {
    console.log(`${entry.word.padEnd(16)} | ${entry.percentage.toFixed(1)}%`);
  }
  if (stopWords5.length > 30) {
    console.log(`  ... and ${stopWords5.length - 30} more`);
  }

  // Words just below 5% threshold
  const belowThreshold = generateStopWordsBelow(allSegments, 5, 3);
  if (belowThreshold.length > 0) {
    console.log(`\nWords just BELOW 5% threshold:`);
    for (const entry of belowThreshold) {
      console.log(`${entry.word.padEnd(16)} | ${entry.percentage.toFixed(1)}%`);
    }
  }

  console.log(`\n--- Threshold: >10% of segments (${stopWords10.length} words) ---`);
  console.log(`Difference: ${stopWords5.length - stopWords10.length} words in the 5-10% boundary zone`);
  if (stopWords5.length > 0 && stopWords10.length > 0) {
    const ratio = ((stopWords5.length - stopWords10.length) / stopWords5.length * 100).toFixed(0);
    console.log(`Boundary zone is ${ratio}% of the 5% list — ${Number(ratio) > 40 ? "threshold matters A LOT" : Number(ratio) > 20 ? "threshold matters moderately" : "threshold is stable"}`);
  }

  // Save full list to file
  const stopWordsOutput = {
    generatedAt: new Date().toISOString(),
    totalSegments: allSegments.length,
    totalAppearances: appearances.length,
    threshold5pct: stopWords5.map((e) => ({ word: e.word, pct: Number(e.percentage.toFixed(2)) })),
    threshold10pct: stopWords10.map((e) => ({ word: e.word, pct: Number(e.percentage.toFixed(2)) })),
  };
  const outPath = join(process.cwd(), "scripts", "output", "stop-words.json");
  writeFileSync(outPath, JSON.stringify(stopWordsOutput, null, 2));
  console.log(`\nFull stop word lists saved to: ${outPath}`);

  // -----------------------------------------------------------------------
  // PASS 1: Per-appearance analysis
  // -----------------------------------------------------------------------

  // Accumulators for summary
  const allMatchResults: MatchResult[] = [];
  const allJumps: { title: string; jumps: Jump[]; orphanedTotal: number }[] = [];
  const noCascadeAppearances: { title: string; coverage: number }[] = [];
  // Track which match results are timeline-consistent (not part of a jump)
  const falseMatchTurnKeys = new Set<string>(); // "title|turnIndex"

  for (const row of appearances) {
    const turns = row.turns ?? [];
    const segments = getSegments(row);
    const title = row.title ?? row.id;

    const matched = turns.filter((t) => t.timestamp_seconds != null).length;
    const coverage = turns.length > 0 ? (matched / turns.length) * 100 : 0;
    const lastSeg = segments.length > 0 ? segments[segments.length - 1] : null;
    const videoDuration = lastSeg ? lastSeg.start + lastSeg.duration : 0;

    const speakers = (row.speakers ?? []).map((s) =>
      typeof s === "string" ? s : (s as { name: string }).name
    );
    const unresolved = speakers.some((s) => /^SPEAKER\s*\d+$/i.test(s));

    if (segments.length === 0) {
      console.log(`\n${"=".repeat(70)}`);
      console.log(`${title}`);
      console.log(`  ⚠ No caption segments — skipping`);
      continue;
    }

    const matchResults = replayMatching(turns, segments);
    allMatchResults.push(...matchResults);

    const jumps = detectJumps(matchResults, turns);

    // Mark false matches (the "to" turn of each jump)
    for (const j of jumps) {
      falseMatchTurnKeys.add(`${title}|${j.toTurnIndex}`);
    }

    if (jumps.length === 0) {
      // Abbreviated output for clean appearances
      noCascadeAppearances.push({ title, coverage });
      console.log(`\n${"=".repeat(70)}`);
      console.log(`${title}`);
      console.log(`  ${matched}/${turns.length} turns (${coverage.toFixed(1)}%) | ${formatTime(videoDuration)} | segments: ${segments.length} | speakers: ${speakers.join(", ")}${unresolved ? " ⚠ UNRESOLVED" : ""} | NO CASCADES`);
      continue;
    }

    // Detailed output for appearances with cascades
    const orphanedTotal = jumps.reduce((sum, j) => sum + j.orphanedTurns, 0);
    allJumps.push({ title, jumps, orphanedTotal });

    console.log(`\n${"=".repeat(70)}`);
    console.log(`${title}`);
    console.log(`${"=".repeat(70)}`);
    console.log(`  Turns: ${turns.length} | Segments: ${segments.length} | Duration: ${formatTime(videoDuration)}`);
    console.log(`  Coverage: ${matched}/${turns.length} (${coverage.toFixed(1)}%)`);
    console.log(`  Speakers: ${speakers.join(", ")}${unresolved ? " ⚠ UNRESOLVED" : ""}`);
    console.log(`\n  False-match cascades: ${jumps.length}`);

    for (const j of jumps) {
      const stopCount5 = j.toMatchedWords.filter((w) => stopWordSet5.has(w)).length;
      const contentWords5 = j.toMatchedWords.filter((w) => !stopWordSet5.has(w));
      const allStop = stopCount5 === j.toMatchedWords.length;

      console.log(`\n    ⚠ Jump: turn ${j.fromTurnIndex} (${formatTime(j.fromTimestamp)}) → turn ${j.toTurnIndex} (${formatTime(j.toTimestamp)})`);
      console.log(`      Time gap: ${formatTime(j.timeGapSeconds)} | Orphaned turns: ${j.orphanedTurns}`);
      console.log(`      Turn ${j.toTurnIndex}: "${j.toTurnDisplay}"`);
      console.log(`      Overlap: ${j.toOverlap}/${MATCH_WORD_COUNT} on [${j.toMatchedWords.map((w) => `"${w}"`).join(", ")}]`);
      console.log(`      Stop words (5%): ${stopCount5}/${j.toMatchedWords.length}${allStop ? " ← ALL STOP WORDS (confirmed false match)" : ""}`);
      if (contentWords5.length > 0) {
        console.log(`      Content words: [${contentWords5.map((w) => `"${w}"`).join(", ")}]`);
      }
    }
  }

  // -----------------------------------------------------------------------
  // Overlap distribution
  // -----------------------------------------------------------------------
  console.log(`\n${"=".repeat(70)}`);
  console.log("OVERLAP DISTRIBUTION (all appearances combined)");
  console.log(`${"=".repeat(70)}`);

  const matchedResults = allMatchResults.filter((r) => r.matched);
  const overlapDist: Record<number, number> = { 4: 0, 5: 0, 6: 0 };
  const contentOverlapDist5: Record<string, number> = { "0": 0, "1": 0, "2": 0, "3+": 0 };
  const contentOverlapDist10: Record<string, number> = { "0": 0, "1": 0, "2": 0, "3+": 0 };
  const zeroContentMatches5: { title: string; turnIndex: number; matchedWords: string[] }[] = [];

  for (const r of matchedResults) {
    overlapDist[r.overlap] = (overlapDist[r.overlap] ?? 0) + 1;

    const contentWords5 = r.matchedWords.filter((w) => !stopWordSet5.has(w));
    const cw5 = contentWords5.length;
    if (cw5 === 0) contentOverlapDist5["0"]++;
    else if (cw5 === 1) contentOverlapDist5["1"]++;
    else if (cw5 === 2) contentOverlapDist5["2"]++;
    else contentOverlapDist5["3+"]++;

    if (cw5 === 0) {
      // Find which appearance this belongs to
      const app = appearances.find((a) => {
        const turns = a.turns ?? [];
        return turns[r.turnIndex]?.text !== undefined;
      });
      zeroContentMatches5.push({
        title: app?.title ?? "unknown",
        turnIndex: r.turnIndex,
        matchedWords: r.matchedWords,
      });
    }

    const contentWords10 = r.matchedWords.filter((w) => !stopWordSet10.has(w));
    const cw10 = contentWords10.length;
    if (cw10 === 0) contentOverlapDist10["0"]++;
    else if (cw10 === 1) contentOverlapDist10["1"]++;
    else if (cw10 === 2) contentOverlapDist10["2"]++;
    else contentOverlapDist10["3+"]++;
  }

  const total = matchedResults.length;
  const pct = (n: number) => total > 0 ? `${((n / total) * 100).toFixed(1)}%` : "0%";

  console.log(`\nTotal matched turns: ${total}`);
  console.log(`\n  Raw overlap:`);
  console.log(`    6/6: ${overlapDist[6] ?? 0} (${pct(overlapDist[6] ?? 0)})  |  5/6: ${overlapDist[5] ?? 0} (${pct(overlapDist[5] ?? 0)})  |  4/6: ${overlapDist[4] ?? 0} (${pct(overlapDist[4] ?? 0)})`);

  console.log(`\n  Content-word overlap (5% stop word threshold):`);
  console.log(`    3+: ${contentOverlapDist5["3+"]} (${pct(contentOverlapDist5["3+"])})  |  2: ${contentOverlapDist5["2"]} (${pct(contentOverlapDist5["2"])})  |  1: ${contentOverlapDist5["1"]} (${pct(contentOverlapDist5["1"])})  |  0: ${contentOverlapDist5["0"]} (${pct(contentOverlapDist5["0"])}) ← LIKELY FALSE`);

  console.log(`\n  Content-word overlap (10% stop word threshold):`);
  console.log(`    3+: ${contentOverlapDist10["3+"]} (${pct(contentOverlapDist10["3+"])})  |  2: ${contentOverlapDist10["2"]} (${pct(contentOverlapDist10["2"])})  |  1: ${contentOverlapDist10["1"]} (${pct(contentOverlapDist10["1"])})  |  0: ${contentOverlapDist10["0"]} (${pct(contentOverlapDist10["0"])}) ← LIKELY FALSE`);

  // List zero-content matches
  if (zeroContentMatches5.length > 0) {
    console.log(`\n  Matches with 0 content words (5% threshold):`);
    for (const m of zeroContentMatches5) {
      console.log(`    - ${m.title} turn ${m.turnIndex}: matched on [${m.matchedWords.join(", ")}] — 0 content words`);
    }
  }

  // -----------------------------------------------------------------------
  // Retention analysis (using timeline-consistent matches as ground truth)
  // -----------------------------------------------------------------------
  console.log(`\n${"=".repeat(70)}`);
  console.log("RETENTION ANALYSIS");
  console.log(`${"=".repeat(70)}`);
  console.log(`Ground truth: matches NOT involved in a timeline jump (>5min, 5+ orphans)\n`);

  // We need per-appearance match results to properly key false matches
  // Rebuild with title context
  const trueMatches: MatchResult[] = [];
  const falseMatches: MatchResult[] = [];

  for (const row of appearances) {
    const turns = row.turns ?? [];
    const segments = getSegments(row);
    const title = row.title ?? row.id;
    if (segments.length === 0) continue;

    const matchResults = replayMatching(turns, segments);
    const jumps = detectJumps(matchResults, turns);
    const jumpTurnIndices = new Set(jumps.map((j) => j.toTurnIndex));

    for (const r of matchResults) {
      if (!r.matched) continue;
      if (jumpTurnIndices.has(r.turnIndex)) {
        falseMatches.push(r);
      } else {
        trueMatches.push(r);
      }
    }
  }

  console.log(`  True matches (timeline-consistent): ${trueMatches.length}`);
  console.log(`  False matches (jump-causing): ${falseMatches.length}`);

  // For each threshold, how many true matches would survive?
  for (const [label, stopSet] of [
    ["5% stop words", stopWordSet5],
    ["10% stop words", stopWordSet10],
  ] as const) {
    console.log(`\n  --- Using ${label} ---`);
    for (const minContent of [1, 2, 3]) {
      const survivingTrue = trueMatches.filter((r) => {
        const cw = r.matchedWords.filter((w) => !stopSet.has(w)).length;
        return cw >= minContent;
      }).length;
      const survivingFalse = falseMatches.filter((r) => {
        const cw = r.matchedWords.filter((w) => !stopSet.has(w)).length;
        return cw >= minContent;
      }).length;
      const retainPct = trueMatches.length > 0
        ? ((survivingTrue / trueMatches.length) * 100).toFixed(1)
        : "0";
      console.log(
        `  Content-word overlap ≥${minContent}: retains ${survivingTrue}/${trueMatches.length} true matches (${retainPct}%) | blocks ${falseMatches.length - survivingFalse}/${falseMatches.length} false matches`
      );
    }
  }

  // -----------------------------------------------------------------------
  // Summary
  // -----------------------------------------------------------------------
  console.log(`\n${"=".repeat(70)}`);
  console.log("SUMMARY ACROSS ALL APPEARANCES");
  console.log(`${"=".repeat(70)}`);

  const totalTurns = appearances.reduce((s, a) => s + (a.turns?.length ?? 0), 0);
  const totalMatched = appearances.reduce(
    (s, a) => s + (a.turns ?? []).filter((t) => t.timestamp_seconds != null).length,
    0
  );

  console.log(`Total appearances: ${appearances.length}`);
  console.log(`Overall coverage: ${totalMatched}/${totalTurns} turns (${((totalMatched / totalTurns) * 100).toFixed(1)}%)`);
  console.log(`Stop words generated: ${stopWords5.length} words (>5%), ${stopWords10.length} words (>10%)`);

  console.log(`\nFalse-match cascades detected: ${allJumps.length} appearances`);
  for (const { title, jumps, orphanedTotal } of allJumps) {
    console.log(`  - ${title}: ${jumps.length} jump(s), ${orphanedTotal} orphaned turns`);
  }

  console.log(`\nAppearances with NO cascade: ${noCascadeAppearances.length}`);
  for (const { title, coverage } of noCascadeAppearances) {
    console.log(`  - ${title}: ${coverage.toFixed(1)}%`);
  }
}

// Helper: words just below a threshold (within 2%)
function generateStopWordsBelow(
  allSegments: CaptionSegment[],
  threshold: number,
  belowMargin: number
): StopWordEntry[] {
  const totalSegments = allSegments.length;
  const wordSegCounts = new Map<string, number>();

  for (const seg of allSegments) {
    const segText = seg.text.replace(/^>>\s*/, "");
    const words = extractWords(segText, 100);
    const unique = new Set(words);
    for (const w of unique) {
      wordSegCounts.set(w, (wordSegCounts.get(w) ?? 0) + 1);
    }
  }

  const entries: StopWordEntry[] = [];
  for (const [word, count] of wordSegCounts) {
    const pct = (count / totalSegments) * 100;
    if (pct <= threshold && pct > threshold - belowMargin) {
      entries.push({ word, percentage: pct, segmentCount: count });
    }
  }

  entries.sort((a, b) => b.percentage - a.percentage);
  return entries.slice(0, 10);
}

main().catch((err) => {
  console.error("Fatal error:", err);
  process.exit(1);
});
