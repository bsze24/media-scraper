import type { CaptionSegment } from "@lib/scrapers/youtube";
import type { Speaker } from "@/types/appearance";

/**
 * Format a timestamp in seconds to M:SS, MM:SS, or H:MM:SS format.
 * No leading zeros on the most-significant unit.
 */
function formatTimestamp(seconds: number): string {
  const totalSeconds = Math.floor(seconds);
  const h = Math.floor(totalSeconds / 3600);
  const m = Math.floor((totalSeconds % 3600) / 60);
  const s = totalSeconds % 60;

  const ss = s.toString().padStart(2, "0");

  if (h > 0) {
    const mm = m.toString().padStart(2, "0");
    return `${h}:${mm}:${ss}`;
  }

  return `${m}:${ss}`;
}

/**
 * Format raw caption segments for the segmentation prompt.
 * Each line: [S{index} | {timestamp}] {text}
 */
export function formatSegmentsForPrompt(segments: CaptionSegment[]): string {
  return segments
    .map((seg, i) => `[S${i} | ${formatTimestamp(seg.start)}] ${seg.text}`)
    .join("\n");
}

/**
 * Format known speakers for the segmentation prompt.
 */
export function formatSpeakersBlock(speakers: Speaker[]): string {
  if (speakers.length === 0) {
    return "Known speakers:\n(none provided)";
  }

  const lines = speakers.map((s) => {
    const parts = [s.name];
    const meta: string[] = [];
    if (s.title) meta.push(s.title);
    if (s.affiliation) meta.push(s.affiliation);
    if (meta.length > 0) parts.push(`(${meta.join(", ")})`);
    parts.push(`\u2014 role: ${s.role}`);
    return `- ${parts.join(" ")}`;
  });

  return `Known speakers:\n${lines.join("\n")}`;
}

export const SEGMENT_PASSAGES_PROMPT = `You are a transcript analyst. You will receive raw auto-generated captions from a video call, formatted as indexed segments with timestamps. Your job is to identify two types of boundaries:

1. SPEAKER BOUNDARIES — who is talking. Use ">>" markers, context clues, and the known speakers list to attribute segments to speakers.

2. TOPIC BOUNDARIES — what they're talking about. Within each speaker's continuous speech, identify where the topic shifts. A "passage" is a topically coherent chunk of speech by a single speaker.

## Rules

- Every segment must belong to exactly one passage (100% coverage). Exception: a segment at a topic boundary may belong to two adjacent passages if the transition happens mid-segment.

- When a topic transition occurs within a single segment, assign that segment to both the ending and starting passages (overlap by one segment is allowed at boundaries, nowhere else).

- Passages are WITHIN a single speaker's continuous speech. A passage never spans a speaker change.

- A passage should be a topic-coherent chunk — typically 3-15 segments (roughly 10-60 seconds). Don't split too fine (every sentence) or too coarse (an entire 3-minute monologue as one passage).

- Assign 1-3 topic tags per passage. Tags should be specific enough to be useful for search ("data integration pain", "sourcing workflow") but not so narrow they're unique to one sentence. Use lowercase, natural phrases.

  Examples of good tag granularity:
  - "co-founder background", "career history"
  - "sourcing workflow", "outbound sourcing model"
  - "data integration challenges", "tool fragmentation"
  - "pricing discussion", "contract structure"
  - "security posture", "on-premise deployment"
  - "competitive landscape", "build vs buy"

  Do NOT use tags like "introduction" or "closing" — these are structural, not topical.

- Assign a signal score to each passage:
  - "filler" — small talk, logistics, ums, transition phrases
  - "context" — provides background, setup, or narrative flow
  - "insight" — contains a concrete opinion, pain point, decision factor, or quotable moment. The kind of thing someone would clip for a highlight reel.

- For speaker attribution: use the known speakers list. When you can't identify who's speaking, use "Unknown Speaker" rather than guessing. The ">>" marker indicates a speaker change but not which speaker.

## Output format

Return ONLY a JSON array of passages, no other text. Each passage:

{
  "speaker": "Max",
  "start_segment": 0,
  "end_segment": 4,
  "topic_tags": ["sourcing model", "outbound sourcing"],
  "signal_score": "insight"
}

Passages must be ordered by start_segment. The full segment range (S0 through the last segment) must be covered — no gaps (boundary overlaps are fine).`;

/**
 * Assemble the full segmentation prompt for the Anthropic API.
 */
export function buildSegmentationPrompt(
  segments: CaptionSegment[],
  speakers: Speaker[]
): { system: string; user: string } {
  return {
    system: SEGMENT_PASSAGES_PROMPT,
    user: `${formatSpeakersBlock(speakers)}\n\n## Caption Segments\n\n${formatSegmentsForPrompt(segments)}`,
  };
}
