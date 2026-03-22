/**
 * Measure the impact of timestamp extraction improvements across all
 * YouTube appearances in the database. Compares three algorithm variants:
 *   1. No fix (original — no deviation check)
 *   2. Pass 1 only (deviation constraint)
 *   3. Pass 1 + Pass 2 (deviation constraint + bracketed recovery)
 *
 * Usage: npx tsx scripts/measure-fix-impact.ts
 */

import { loadEnvConfig } from "@next/env";
loadEnvConfig(process.cwd());

import { createServerClient } from "@lib/db/client";
import { extractTimestamps } from "@lib/pipeline/extract-timestamps";
import type { Turn } from "@/types/appearance";
import type { CaptionSegment } from "@lib/scrapers/youtube";

// Mirror constants for the "no fix" baseline (original algorithm)
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

/**
 * Original algorithm — no deviation check, no pass 2.
 */
function runOriginal(turns: Turn[], segments: CaptionSegment[]): number {
  let segScanPos = 0;
  let lastTs = -1;
  let matched = 0;

  for (const turn of turns) {
    const tw = extractWords(turn.text, MATCH_WORD_COUNT);
    if (tw.length === 0) continue;

    let bestOverlap = 0;
    let bestStart = -1;
    let bestSegIdx = -1;

    for (let i = segScanPos; i < segments.length; i++) {
      const segText = segments[i].text.replace(/^>>\s*/, "");
      const sw = extractWords(segText, MATCH_WORD_COUNT);
      const ov = wordOverlap(tw, sw);
      if (ov > bestOverlap) {
        bestOverlap = ov;
        bestStart = segments[i].start;
        bestSegIdx = i;
      }
      if (ov >= MATCH_WORD_COUNT) break;
    }

    if (bestOverlap >= MATCH_THRESHOLD && bestStart > lastTs) {
      lastTs = bestStart;
      segScanPos = bestSegIdx + 1;
      matched++;
    }
  }

  return matched;
}

async function main() {
  console.log("=== TIMESTAMP FIX IMPACT MEASUREMENT ===");
  console.log(`Generated: ${new Date().toISOString()}\n`);

  const supabase = createServerClient();
  const { data: rows, error } = await supabase
    .from("appearances")
    .select("id, title, turns, scraper_metadata, transcript_source")
    .eq("processing_status", "complete")
    .like("transcript_source", "youtube%");

  if (error) throw error;
  if (!rows || rows.length === 0) {
    console.log("No YouTube appearances found.");
    return;
  }

  console.log(`Found ${rows.length} YouTube appearances\n`);

  interface RowResult {
    title: string;
    turnCount: number;
    noFix: number;
    pass1Only: number;
    pass1And2: number;
    videoDuration: number;
  }

  const results: RowResult[] = [];

  for (const row of rows) {
    const turns = (row.turns ?? []) as Turn[];
    const meta = row.scraper_metadata as Record<string, unknown> | null;
    const segments = (meta?.segments as CaptionSegment[] | undefined) ?? [];
    const videoDuration = (meta?.duration as number | undefined) ?? 0;

    if (turns.length === 0 || segments.length === 0) continue;

    // Strip existing timestamps so we measure the algorithm, not stale DB data
    const cleanTurns = turns.map((t) => {
      const { timestamp_seconds, ...rest } = t;
      return rest as Turn;
    });

    // No fix: original algorithm
    const noFix = runOriginal(cleanTurns, segments);

    // Pass 1 only: deviation check but no pass 2
    const pass1Turns = runPass1Only(cleanTurns, segments, videoDuration);
    const pass1Only = pass1Turns.filter((t) => t.timestamp_seconds != null).length;

    // Pass 1 + 2: use the real extractTimestamps with videoDuration
    const pass12Turns = extractTimestamps(cleanTurns, segments, videoDuration);
    const pass1And2 = pass12Turns.filter((t) => t.timestamp_seconds != null).length;

    results.push({
      title: (row.title ?? row.id) as string,
      turnCount: turns.length,
      noFix,
      pass1Only,
      pass1And2,
      videoDuration,
    });
  }

  // Print results table
  const hdr =
    "Title".padEnd(45) +
    "Turns".padStart(6) +
    "No fix".padStart(10) +
    "Pass 1".padStart(10) +
    "Pass 1+2".padStart(10);
  console.log(hdr);
  console.log("-".repeat(81));

  let totTurns = 0, totNoFix = 0, totP1 = 0, totP12 = 0;

  for (const r of results) {
    const nfPct = ((r.noFix / r.turnCount) * 100).toFixed(0);
    const p1Pct = ((r.pass1Only / r.turnCount) * 100).toFixed(0);
    const p12Pct = ((r.pass1And2 / r.turnCount) * 100).toFixed(0);
    const titleTrunc = r.title.length > 43 ? r.title.slice(0, 43) + "…" : r.title;

    console.log(
      titleTrunc.padEnd(45) +
      String(r.turnCount).padStart(6) +
      `${r.noFix}(${nfPct}%)`.padStart(10) +
      `${r.pass1Only}(${p1Pct}%)`.padStart(10) +
      `${r.pass1And2}(${p12Pct}%)`.padStart(10)
    );

    totTurns += r.turnCount;
    totNoFix += r.noFix;
    totP1 += r.pass1Only;
    totP12 += r.pass1And2;
  }

  console.log("-".repeat(81));
  const nfPct = totTurns > 0 ? ((totNoFix / totTurns) * 100).toFixed(1) : "0";
  const p1Pct = totTurns > 0 ? ((totP1 / totTurns) * 100).toFixed(1) : "0";
  const p12Pct = totTurns > 0 ? ((totP12 / totTurns) * 100).toFixed(1) : "0";

  console.log(
    "TOTAL".padEnd(45) +
    String(totTurns).padStart(6) +
    `${totNoFix}(${nfPct}%)`.padStart(10) +
    `${totP1}(${p1Pct}%)`.padStart(10) +
    `${totP12}(${p12Pct}%)`.padStart(10)
  );

  console.log(`\n${"=".repeat(60)}`);
  console.log("                        | No fix  | Pass 1  | Pass 1+2");
  console.log(
    `Total matched turns     | ${String(totNoFix).padStart(7)} | ${String(totP1).padStart(7)} | ${String(totP12).padStart(8)}`
  );
  console.log(
    `Overall coverage        | ${(nfPct + "%").padStart(7)} | ${(p1Pct + "%").padStart(7)} | ${(p12Pct + "%").padStart(8)}`
  );
}

// ---------------------------------------------------------------------------
// Pass 1 only (deviation check, no pass 2) — needed to isolate pass 1 numbers
// ---------------------------------------------------------------------------

const MAX_DEVIATION_SECONDS = 900;

function runPass1Only(
  turns: Turn[],
  segments: CaptionSegment[],
  videoDuration: number
): Turn[] {
  const totalTurns = turns.length;
  const hasDev = videoDuration > 0;
  let segScanPos = 0;
  let lastTs = -1;

  return turns.map((turn) => {
    const tw = extractWords(turn.text, MATCH_WORD_COUNT);
    if (tw.length === 0) return turn;

    const expectedTime = hasDev ? (turn.turn_index / totalTurns) * videoDuration : 0;

    let bestOverlap = 0;
    let bestStart = -1;
    let bestSegIdx = -1;

    for (let i = segScanPos; i < segments.length; i++) {
      const segText = segments[i].text.replace(/^>>\s*/, "");
      const sw = extractWords(segText, MATCH_WORD_COUNT);
      const ov = wordOverlap(tw, sw);

      if (ov >= MATCH_THRESHOLD && segments[i].start > lastTs) {
        const withinDev = !hasDev ||
          Math.abs(segments[i].start - expectedTime) <= MAX_DEVIATION_SECONDS;
        if (withinDev && ov > bestOverlap) {
          bestOverlap = ov;
          bestStart = segments[i].start;
          bestSegIdx = i;
        }
      }

      if (bestOverlap >= MATCH_WORD_COUNT) break;
    }

    if (bestOverlap >= MATCH_THRESHOLD && bestStart > lastTs) {
      lastTs = bestStart;
      segScanPos = bestSegIdx + 1;
      return { ...turn, timestamp_seconds: bestStart };
    }

    return turn;
  });
}

main().catch((err) => {
  console.error("Fatal error:", err);
  process.exit(1);
});
