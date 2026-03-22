/**
 * Diagnostic script: analyze timestamp extraction coverage and identify
 * why turns are failing to match caption segments.
 *
 * Usage: npx tsx scripts/diagnose-timestamps.ts
 */

import { loadEnvConfig } from "@next/env";
loadEnvConfig(process.cwd());

import { createServerClient } from "@lib/db/client";
import type { AppearanceRow } from "@lib/db/types";
import type { Turn } from "@/types/appearance";
import type { SectionHeading } from "@/types/scraper";
import type { CaptionSegment } from "@lib/scrapers/youtube";

// Mirror the actual algorithm constants from extract-timestamps.ts
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

/** First N words for human-readable display */
function displayWords(text: string, count: number): string {
  return text
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, count)
    .join(" ");
}

function formatTime(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  return `${m}:${s.toString().padStart(2, "0")}`;
}

// ---------------------------------------------------------------------------
// Fetching
// ---------------------------------------------------------------------------

async function fetchAppearance(
  titleSearch: string
): Promise<AppearanceRow | null> {
  const supabase = createServerClient();
  const { data, error } = await supabase
    .from("appearances")
    .select("*")
    .ilike("title", `%${titleSearch}%`)
    .eq("processing_status", "complete")
    .limit(1)
    .single();

  if (error) {
    if (error.code === "PGRST116") return null;
    throw error;
  }
  return data as AppearanceRow;
}

// ---------------------------------------------------------------------------
// Analysis helpers
// ---------------------------------------------------------------------------

function getSegments(row: AppearanceRow): CaptionSegment[] {
  const meta = row.scraper_metadata as Record<string, unknown> | null;
  if (!meta) return [];
  const segs = meta.segments as CaptionSegment[] | undefined;
  return segs ?? [];
}

function checkSegmentsSorted(segments: CaptionSegment[]): boolean {
  for (let i = 1; i < segments.length; i++) {
    if (segments[i].start < segments[i - 1].start) return false;
  }
  return true;
}

interface MatchResult {
  turnIndex: number;
  matched: boolean;
  overlap: number;
  segIndex: number;
  segTimestamp: number;
}

/**
 * Re-run the matching algorithm and record per-turn results, including
 * overlap scores, to detect false-match cascades.
 */
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
      results.push({
        turnIndex: turn.turn_index,
        matched: true,
        overlap: bestOverlap,
        segIndex: bestSegIdx,
        segTimestamp: bestStart,
      });
    } else {
      results.push({
        turnIndex: turn.turn_index,
        matched: false,
        overlap: bestOverlap,
        segIndex: bestSegIdx,
        segTimestamp: bestStart,
      });
    }
  }

  return results;
}

// ---------------------------------------------------------------------------
// Report sections
// ---------------------------------------------------------------------------

function printStats(
  label: string,
  row: AppearanceRow,
  turns: Turn[],
  segments: CaptionSegment[]
) {
  const sorted = checkSegmentsSorted(segments);
  const matched = turns.filter((t) => t.timestamp_seconds != null).length;
  const pct = turns.length > 0 ? ((matched / turns.length) * 100).toFixed(1) : "0";
  const lastSeg = segments.length > 0 ? segments[segments.length - 1] : null;
  const videoDuration = lastSeg ? lastSeg.start + lastSeg.duration : 0;

  // Check if speakers are resolved
  const speakers = (row.speakers ?? []).map((s) =>
    typeof s === "string" ? s : (s as { name: string }).name
  );
  const unresolvedSpeakers = speakers.filter((s) =>
    /^SPEAKER\s*\d+$/i.test(s)
  );

  console.log(`\n${"=".repeat(70)}`);
  console.log(`APPEARANCE: ${label}`);
  console.log(`ID: ${row.id}`);
  console.log(`Title: ${row.title}`);
  console.log(`${"=".repeat(70)}`);
  console.log(`\n--- Stats ---`);
  console.log(`  Total turns:          ${turns.length}`);
  console.log(`  Total segments:       ${segments.length}`);
  console.log(`  Segments sorted:      ${sorted ? "YES" : "NO — segments are NOT chronologically sorted!"}`);
  console.log(`  Video duration:       ${formatTime(videoDuration)} (${Math.round(videoDuration)}s)`);
  if (segments.length > 0) {
    const firstSeg = segments[0];
    console.log(`  Segment range:        ${formatTime(firstSeg.start)} → ${formatTime(lastSeg!.start)}`);
  }
  console.log(`  Timestamp coverage:   ${matched}/${turns.length} turns (${pct}%)`);
  console.log(
    `  Speakers:             ${speakers.join(", ")}${unresolvedSpeakers.length > 0 ? " ⚠ UNRESOLVED" : ""}`
  );
}

function printSectionAnalysis(sections: SectionHeading[]) {
  console.log(`\n--- Question 1: Section → turn_index mapping ---`);
  if (sections.length === 0) {
    console.log("  No sections found on this appearance.");
    return;
  }

  let withTurnIndex = 0;
  let withoutTurnIndex = 0;

  for (const s of sections) {
    const ti = s.turn_index != null ? String(s.turn_index) : "NULL";
    const st = s.start_time != null ? `${formatTime(s.start_time)} (${s.start_time}s)` : "NULL";
    const src = s.source ?? "unknown";
    const tag = s.turn_index != null ? "✓" : "✗";
    console.log(`  ${tag} [${src}] "${s.heading}"  turn_index: ${ti}  start_time: ${st}`);

    if (s.turn_index != null) withTurnIndex++;
    else withoutTurnIndex++;
  }

  console.log(
    `\n  Summary: ${withTurnIndex}/${sections.length} sections have turn_index, ${withoutTurnIndex} missing`
  );
}

function printUnmatchedAnalysis(
  turns: Turn[],
  segments: CaptionSegment[],
  matchResults: MatchResult[]
) {
  console.log(`\n--- Question 2: Why are timestamps missing on unmatched turns? ---`);

  const unmatched = turns.filter((t) => t.timestamp_seconds == null);
  if (unmatched.length === 0) {
    console.log("  All turns have timestamps — nothing to diagnose.");
    return;
  }

  // Pick 5 spread across the transcript
  const indices = [0.2, 0.4, 0.6, 0.8, 0.95].map((pct) =>
    Math.min(Math.floor(pct * unmatched.length), unmatched.length - 1)
  );
  // Deduplicate
  const uniqueIndices = [...new Set(indices)];
  const samples = uniqueIndices.map((i) => unmatched[i]);

  for (const turn of samples) {
    const turnWords = extractWords(turn.text, MATCH_WORD_COUNT);
    const display = displayWords(turn.text, 12);

    console.log(`\n  Turn ${turn.turn_index} (speaker: ${turn.speaker}):`);
    console.log(`    Display (12 words): "${display}"`);
    console.log(`    Algorithm words (${MATCH_WORD_COUNT}): [${turnWords.map((w) => `"${w}"`).join(", ")}]`);

    // Find nearest matched turns before and after
    let prevTs: number | null = null;
    let nextTs: number | null = null;
    for (let i = turn.turn_index - 1; i >= 0; i--) {
      const t = turns[i];
      if (t.timestamp_seconds != null) {
        prevTs = t.timestamp_seconds;
        console.log(`    Nearest matched before: turn ${t.turn_index} (ts: ${formatTime(prevTs)})`);
        break;
      }
    }
    for (let i = turn.turn_index + 1; i < turns.length; i++) {
      const t = turns[i];
      if (t.timestamp_seconds != null) {
        nextTs = t.timestamp_seconds;
        console.log(`    Nearest matched after:  turn ${t.turn_index} (ts: ${formatTime(nextTs)})`);
        break;
      }
    }

    if (prevTs == null && nextTs == null) {
      console.log(`    ⚠ No matched turns nearby — cannot identify candidate segments`);
      continue;
    }

    const rangeStart = prevTs ?? 0;
    const rangeEnd = nextTs ?? (segments.length > 0 ? segments[segments.length - 1].start + 10 : 0);

    const candidateSegs = segments.filter(
      (s) => s.start >= rangeStart && s.start <= rangeEnd
    );

    console.log(`    Candidate segments in range [${formatTime(rangeStart)} → ${formatTime(rangeEnd)}] (${candidateSegs.length} segments):`);

    const topCandidates = candidateSegs
      .map((seg) => {
        const segText = seg.text.replace(/^>>\s*/, "");
        const segWords = extractWords(segText, MATCH_WORD_COUNT);
        const overlap = wordOverlap(turnWords, segWords);
        return { seg, segWords, overlap };
      })
      .sort((a, b) => b.overlap - a.overlap)
      .slice(0, 5);

    for (const c of topCandidates) {
      const segDisplay = displayWords(c.seg.text, 15);
      const flag =
        c.overlap >= MATCH_THRESHOLD
          ? "← SHOULD HAVE MATCHED"
          : c.overlap >= MATCH_THRESHOLD - 1
            ? "← NEAR MISS"
            : "";
      console.log(
        `      [${formatTime(c.seg.start)}] "${segDisplay}"  overlap: ${c.overlap}/${MATCH_WORD_COUNT} ${flag}`
      );
    }

    // Check what the algorithm actually saw — was segScanPos past these candidates?
    const matchResult = matchResults[turn.turn_index];
    if (matchResult && !matchResult.matched) {
      console.log(`    Algorithm best overlap for this turn: ${matchResult.overlap}/${MATCH_WORD_COUNT} (at seg ${matchResult.segIndex}, ts: ${matchResult.segTimestamp >= 0 ? formatTime(matchResult.segTimestamp) : "N/A"})`);
      if (matchResult.overlap >= MATCH_THRESHOLD && matchResult.segTimestamp >= 0) {
        console.log(`    ⚠ Had sufficient overlap but FAILED monotonicity check (best seg ts ${formatTime(matchResult.segTimestamp)} <= last matched ts)`);
      }
    }
  }
}

function printFalseMatchCascades(
  turns: Turn[],
  matchResults: MatchResult[],
  segments: CaptionSegment[]
) {
  console.log(`\n--- False-Match Cascade Detection ---`);

  let found = false;
  for (let i = 0; i < matchResults.length; i++) {
    const r = matchResults[i];
    if (!r.matched) continue;
    if (r.overlap > MATCH_THRESHOLD) continue; // only flag threshold-level matches

    // Count consecutive unmatched turns after this match
    let unmatchedRun = 0;
    for (let j = i + 1; j < matchResults.length; j++) {
      if (!matchResults[j].matched) unmatchedRun++;
      else break;
    }

    if (unmatchedRun >= 3) {
      found = true;
      const turn = turns[i];
      const turnDisplay = displayWords(turn.text, 12);
      const seg = segments[r.segIndex];
      const segDisplay = seg ? displayWords(seg.text, 15) : "N/A";

      console.log(`\n  ⚠ SUSPECT FALSE MATCH at turn ${r.turnIndex}:`);
      console.log(`    Turn words (12): "${turnDisplay}"`);
      console.log(`    Matched seg [${formatTime(r.segTimestamp)}]: "${segDisplay}"`);
      console.log(`    Overlap: ${r.overlap}/${MATCH_WORD_COUNT} (at threshold — possibly coincidental common words)`);
      console.log(`    Followed by ${unmatchedRun} consecutive unmatched turns`);
      console.log(`    segScanPos jumped to segment ${r.segIndex + 1} — all subsequent turns scan from here`);
    }
  }

  if (!found) {
    console.log("  No false-match cascade patterns detected.");
  }
}

function printControlGroup(
  turns: Turn[],
  segments: CaptionSegment[],
  matchResults: MatchResult[]
) {
  console.log(`\n--- Question 3: Control group — successful matches ---`);

  const matched = matchResults.filter((r) => r.matched);
  if (matched.length === 0) {
    console.log("  No matched turns to show.");
    return;
  }

  // Pick 3 spread across matched turns
  const indices = [0, Math.floor(matched.length / 2), matched.length - 1];
  const unique = [...new Set(indices)];
  const samples = unique.map((i) => matched[i]);

  for (const r of samples) {
    const turn = turns[r.turnIndex];
    const turnDisplay = displayWords(turn.text, 12);
    const turnWords = extractWords(turn.text, MATCH_WORD_COUNT);
    const seg = segments[r.segIndex];
    const segDisplay = seg ? displayWords(seg.text, 15) : "N/A";

    console.log(`\n  Turn ${r.turnIndex} (speaker: ${turn.speaker}):`);
    console.log(`    Turn words (12): "${turnDisplay}"`);
    console.log(`    Algorithm words: [${turnWords.map((w) => `"${w}"`).join(", ")}]`);
    console.log(`    Matched seg [${formatTime(r.segTimestamp)}]: "${segDisplay}"`);
    console.log(`    Overlap: ${r.overlap}/${MATCH_WORD_COUNT}`);
  }
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main() {
  console.log("=== TIMESTAMP DIAGNOSTIC REPORT ===");
  console.log(`Generated: ${new Date().toISOString()}`);

  const searches = [
    { label: "Stonepeak", query: "Stonepeak" },
    { label: "Capital Group / Gitlin", query: "Gitlin" },
  ];

  const appearances: { label: string; row: AppearanceRow }[] = [];

  for (const { label, query } of searches) {
    const row = await fetchAppearance(query);
    if (!row) {
      console.log(`\n⚠ Could not find appearance matching "${query}" — skipping`);
      continue;
    }
    appearances.push({ label, row });
  }

  if (appearances.length === 0) {
    console.log("\nNo appearances found. Check Supabase credentials and data.");
    return;
  }

  for (const { label, row } of appearances) {
    const turns = row.turns ?? [];
    const segments = getSegments(row);
    const sections = row.sections ?? [];

    printStats(label, row, turns, segments);
    printSectionAnalysis(sections);

    if (segments.length === 0) {
      console.log(`\n  ⚠ No caption segments in scraper_metadata — cannot analyze matching`);
      continue;
    }

    const matchResults = replayMatching(turns, segments);
    printUnmatchedAnalysis(turns, segments, matchResults);
    printFalseMatchCascades(turns, matchResults, segments);

    // Control group only for the better-performing appearance (Capital Group)
    if (label.includes("Capital Group") || label.includes("Gitlin")) {
      printControlGroup(turns, segments, matchResults);
    }
  }

  console.log(`\n${"=".repeat(70)}`);
  console.log("END OF REPORT");
}

main().catch((err) => {
  console.error("Fatal error:", err);
  process.exit(1);
});
