import type { Turn } from "@/types/appearance";
import type { SectionHeading } from "@/types/scraper";
import type { CaptionSegment } from "@lib/scrapers/youtube";

/** Number of words to extract from turn/segment text for matching */
const MATCH_WORD_COUNT = 6;

/** Minimum word overlap required to consider a match */
const MATCH_THRESHOLD = 4;

/**
 * Normalize text for matching: lowercase, strip punctuation, split into words.
 */
function extractWords(text: string, count: number): string[] {
  return text
    .toLowerCase()
    .replace(/[^\w\s]/g, "")
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, count);
}

/**
 * Count the number of common words between two word arrays (set intersection).
 */
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
 * Stamp timestamp_seconds on turns by matching their opening words against
 * caption segment text. Uses sequential forward scanning to maintain
 * chronological order.
 *
 * Pure function — no DB calls, no side effects.
 */
export function extractTimestamps(
  turns: Turn[],
  captionSegments: CaptionSegment[] | null
): Turn[] {
  if (!captionSegments || captionSegments.length === 0) {
    return turns;
  }

  let segScanPos = 0;
  let lastMatchedTimestamp = -1;

  return turns.map((turn) => {
    const turnWords = extractWords(turn.text, MATCH_WORD_COUNT);
    if (turnWords.length === 0) return turn;

    let bestOverlap = 0;
    let bestStart = -1;
    let bestSegIdx = -1;

    for (let i = segScanPos; i < captionSegments.length; i++) {
      // Strip leading >> (YouTube speaker-change marker)
      const segText = captionSegments[i].text.replace(/^>>\s*/, "");
      const segWords = extractWords(segText, MATCH_WORD_COUNT);
      const overlap = wordOverlap(turnWords, segWords);

      if (overlap > bestOverlap) {
        bestOverlap = overlap;
        bestStart = captionSegments[i].start;
        bestSegIdx = i;
      }

      // Perfect match — stop scanning
      if (overlap >= MATCH_WORD_COUNT) break;
    }

    if (bestOverlap >= MATCH_THRESHOLD && bestStart > lastMatchedTimestamp) {
      lastMatchedTimestamp = bestStart;
      segScanPos = bestSegIdx + 1;
      return { ...turn, timestamp_seconds: bestStart };
    }

    // Monotonicity violation or no match — leave undefined
    return turn;
  });
}

/**
 * Map sections to their nearest turn by matching start_time to
 * timestamp_seconds. Only maps sections that have start_time but no
 * turn_index, and only uses turns that have timestamp_seconds.
 */
export function mapSectionsToTurns(
  sections: SectionHeading[],
  turns: Turn[]
): SectionHeading[] {
  const timestampedTurns = turns.filter(
    (t) => t.timestamp_seconds != null
  );

  if (timestampedTurns.length === 0) return sections;

  return sections.map((section) => {
    if (section.turn_index != null || section.start_time == null) {
      return section;
    }

    let closest = timestampedTurns[0];
    let closestDiff = Math.abs(closest.timestamp_seconds! - section.start_time!);

    for (let i = 1; i < timestampedTurns.length; i++) {
      const diff = Math.abs(timestampedTurns[i].timestamp_seconds! - section.start_time!);
      if (diff < closestDiff) {
        closest = timestampedTurns[i];
        closestDiff = diff;
      }
    }

    return { ...section, turn_index: closest.turn_index };
  });
}

/**
 * Stamp section_anchor on turns based on section turn_index ranges.
 * Each turn gets the anchor of the section whose turn_index is the
 * highest value <= the turn's turn_index. Turns before the first
 * section get no section_anchor.
 */
export function stampSectionAnchors(
  turns: Turn[],
  sections: SectionHeading[]
): Turn[] {
  if (sections.length === 0) return turns;

  // Sort sections by turn_index ascending
  const sorted = sections
    .filter((s) => s.turn_index != null)
    .sort((a, b) => a.turn_index! - b.turn_index!);

  if (sorted.length === 0) return turns;

  return turns.map((turn) => {
    let anchor: string | undefined;
    for (const section of sorted) {
      if (section.turn_index! <= turn.turn_index) {
        anchor = section.anchor;
      } else {
        break;
      }
    }
    return anchor ? { ...turn, section_anchor: anchor } : turn;
  });
}
