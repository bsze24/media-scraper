import type { Speaker } from "@/types/appearance";
import type { CaptionSegment } from "@lib/scrapers/youtube";

export interface RawPassage {
  speaker: string;
  start_segment: number;
  end_segment: number;
  topic_tags: string[];
  signal_score: "filler" | "context" | "insight";
}

export interface PostProcessResult {
  passages: RawPassage[];
  warnings: string[];
}

const MAX_PASSAGE_SIZE = 25;
const MIN_SPLIT_SIZE = 5;
const SPLIT_SEARCH_RADIUS = 5;
const SIZE_ENFORCEMENT_PASSES = 2;

const STRUCTURAL_TAGS = new Set([
  "introduction",
  "introductions",
  "closing",
  "meeting logistics",
  "meeting setup",
  "meeting wrap-up",
  "meeting closure",
  "meeting agreement",
  "meeting structure",
  "meeting conclusion",
  "next steps",
  "wrap-up",
  "farewell",
  "acknowledgment",
  "confirmation",
  "understanding",
  "transition phrase",
  "conversation handoff",
  "conversation transition",
  "hesitation",
  "interruption handling",
  "interview opening",
  "interview conclusion",
  "podcast promotion",
  "legal disclaimer",
  "call setup",
  "call logistics",
  "attendance confirmation",
  "client confirmation",
  "gratitude",
  "appreciation",
  "ongoing support offer",
  "demo setup",
  "context sharing request",
  "introductions plan",
]);

// ── Step 1: Speaker name normalization ────────────────────────────────────

function normalizeSpeakerName(
  name: string,
  speakers: Speaker[]
): { normalized: string; warning?: string } {
  if (name === "Unknown Speaker") {
    return { normalized: name };
  }

  // Strip parenthetical annotations
  const stripped = name.replace(/\s*\(.*\)\s*$/, "").trim();

  // Empty after stripping — can't match anything meaningful
  if (!stripped) {
    return {
      normalized: name,
      warning: `Unknown speaker '${name}' (empty after stripping) — not in speakers list`,
    };
  }

  // Exact match (case-sensitive)
  for (const s of speakers) {
    if (s.name === stripped) return { normalized: s.name };
  }

  // Case-insensitive exact match
  const strippedLower = stripped.toLowerCase();
  for (const s of speakers) {
    if (s.name.toLowerCase() === strippedLower) return { normalized: s.name };
  }

  // Substring match: speaker name is substring of stripped, or stripped is substring of speaker name
  const substringMatches: Speaker[] = [];
  for (const s of speakers) {
    const sLower = s.name.toLowerCase();
    if (strippedLower.includes(sLower) || sLower.includes(strippedLower)) {
      substringMatches.push(s);
    }
  }

  if (substringMatches.length === 1) {
    return { normalized: substringMatches[0].name };
  }

  if (substringMatches.length > 1) {
    // Longest matching speaker name wins (most specific)
    substringMatches.sort((a, b) => b.name.length - a.name.length);
    return { normalized: substringMatches[0].name };
  }

  return {
    normalized: stripped,
    warning: `Unknown speaker '${stripped}' — not in speakers list`,
  };
}

function stepNormalizeSpeakers(
  passages: RawPassage[],
  speakers: Speaker[],
  warnings: string[]
): RawPassage[] {
  return passages.map((p, i) => {
    const { normalized, warning } = normalizeSpeakerName(p.speaker, speakers);
    if (warning) {
      warnings.push(`${warning} (passage ${i})`);
    }
    return normalized !== p.speaker ? { ...p, speaker: normalized } : p;
  });
}

// ── Step 2: Passage size enforcement ─────────────────────────────────────

/**
 * Find where to split an oversized passage. Returns the first segment
 * index of the SECOND passage (i.e., first passage ends at splitPoint - 1).
 *
 * Prefers splitting at a >> marker (speaker change) near the midpoint,
 * since >> marks the start of new speech — the >> segment belongs in
 * the second passage.
 */
function findSplitPoint(
  passage: RawPassage,
  segments: CaptionSegment[]
): number {
  const size = passage.end_segment - passage.start_segment + 1;
  const mid = passage.start_segment + Math.floor(size / 2);

  // Search for >> marker within ±SPLIT_SEARCH_RADIUS of midpoint
  const searchStart = Math.max(passage.start_segment, mid - SPLIT_SEARCH_RADIUS);
  const searchEnd = Math.min(passage.end_segment, mid + SPLIT_SEARCH_RADIUS);

  let bestIdx = -1;
  let bestDist = Infinity;

  for (let i = searchStart; i <= searchEnd; i++) {
    if (segments[i]?.text.includes(">>")) {
      const dist = Math.abs(i - mid);
      if (dist < bestDist) {
        bestDist = dist;
        bestIdx = i;
      }
    }
  }

  // >> marker found: it marks the start of new speech, so the >>
  // segment is the first segment of the second passage.
  // No >> found: split at midpoint (midpoint becomes first of second passage).
  return bestIdx >= 0 ? bestIdx : mid;
}

function stepEnforceSize(
  passages: RawPassage[],
  segments: CaptionSegment[],
  warnings: string[]
): RawPassage[] {
  let result = [...passages];

  for (let pass = 0; pass < SIZE_ENFORCEMENT_PASSES; pass++) {
    const expanded: RawPassage[] = [];

    for (const p of result) {
      const size = p.end_segment - p.start_segment + 1;

      if (size <= MAX_PASSAGE_SIZE) {
        expanded.push(p);
        continue;
      }

      // splitPoint = first segment index of the second passage
      const splitPoint = findSplitPoint(p, segments);

      // Check minimum size floor
      const firstSize = splitPoint - p.start_segment;
      const secondSize = p.end_segment - splitPoint + 1;

      if (firstSize < MIN_SPLIT_SIZE || secondSize < MIN_SPLIT_SIZE) {
        expanded.push(p);
        continue;
      }

      warnings.push(
        `Split passage at segment ${splitPoint} (${size} → ${firstSize} + ${secondSize} segments)`
      );

      expanded.push(
        {
          ...p,
          end_segment: splitPoint - 1,
          topic_tags: [...p.topic_tags],
        },
        {
          ...p,
          start_segment: splitPoint,
          topic_tags: [...p.topic_tags],
        }
      );
    }

    result = expanded;
  }

  // Warn about any remaining oversized passages
  for (const p of result) {
    const size = p.end_segment - p.start_segment + 1;
    if (size > MAX_PASSAGE_SIZE) {
      warnings.push(
        `Passage S${p.start_segment}–S${p.end_segment} still ${size} segments after ${SIZE_ENFORCEMENT_PASSES} split passes`
      );
    }
  }

  return result;
}

// ── Step 3: Overlap enforcement ──────────────────────────────────────────

function stepEnforceOverlaps(
  passages: RawPassage[],
  warnings: string[]
): RawPassage[] {
  const result = passages.map((p) => ({ ...p }));

  for (let i = 0; i < result.length - 1; i++) {
    const overlap =
      result[i].end_segment - result[i + 1].start_segment + 1;

    if (overlap > 1) {
      // Reduce to 1-segment overlap (preserve boundary intent)
      result[i].end_segment = result[i + 1].start_segment;
      warnings.push(
        `Reduced overlap between passages ${i} and ${i + 1} from ${overlap} to 1 segment`
      );
    }
  }

  return result;
}

// ── Step 4: Coverage gap detection ───────────────────────────────────────

function stepDetectGaps(
  passages: RawPassage[],
  segments: CaptionSegment[],
  warnings: string[]
): void {
  const covered = new Set<number>();
  for (const p of passages) {
    for (let i = p.start_segment; i <= p.end_segment; i++) {
      covered.add(i);
    }
  }

  for (let i = 0; i < segments.length; i++) {
    if (!covered.has(i)) {
      warnings.push(`Gap: segment ${i} not covered by any passage`);
    }
  }
}

// ── Step 5: Structural tag filtering ─────────────────────────────────────

function stepFilterStructuralTags(
  passages: RawPassage[],
  warnings: string[]
): RawPassage[] {
  return passages.map((p, i) => {
    const filtered = p.topic_tags.filter(
      (tag) => !STRUCTURAL_TAGS.has(tag.toLowerCase())
    );

    if (filtered.length === p.topic_tags.length) return p;

    if (filtered.length === 0) {
      warnings.push(
        `All tags were structural for passage ${i}, replaced with 'general discussion'`
      );
      return { ...p, topic_tags: ["general discussion"] };
    }

    return { ...p, topic_tags: filtered };
  });
}

// ── Main export ──────────────────────────────────────────────────────────

export function postProcessPassages(
  raw: RawPassage[],
  speakers: Speaker[],
  segments: CaptionSegment[]
): PostProcessResult {
  const warnings: string[] = [];

  // Step 1: Speaker name normalization
  let passages = stepNormalizeSpeakers(raw, speakers, warnings);

  // Step 2: Passage size enforcement
  passages = stepEnforceSize(passages, segments, warnings);

  // Step 3: Overlap enforcement (on post-split array)
  passages = stepEnforceOverlaps(passages, warnings);

  // Step 4: Coverage gap detection
  stepDetectGaps(passages, segments, warnings);

  // Step 5: Structural tag filtering
  passages = stepFilterStructuralTags(passages, warnings);

  // Step 6: Array order is canonical index — no extra field needed

  return { passages, warnings };
}
