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

- When a topic transition occurs within a single caption segment, assign that segment to both the ending and starting passages. Overlap must be exactly 1 segment at a boundary, never more. If two consecutive passages share 2 or more segments, your segment ranges are wrong — fix them so they share at most 1.

- Passages are WITHIN a single speaker's continuous speech. A passage never spans a speaker change.

- A passage should be a topic-coherent chunk — target 5-20 segments (roughly 15-45 seconds of speech). Maximum 25 segments per passage. If a speaker talks for longer than 25 segments without interruption, there are almost certainly multiple sub-topics — split at the clearest topic shift. A 2-minute monologue covering "use cases, value creation, IC memo analysis, and platform flexibility" is four passages, not one.

- Assign 1-3 topic tags per passage. If you find yourself wanting to assign 4 or more tags, that's a signal the passage covers multiple topics and should be split into separate passages instead. Tags should be specific enough to be useful for search ("data integration pain", "sourcing workflow") but not so narrow they're unique to one sentence. Use lowercase, natural phrases.

  Examples of good tag granularity:
  - "co-founder background", "career history"
  - "sourcing workflow", "outbound sourcing model"
  - "data integration challenges", "tool fragmentation"
  - "pricing discussion", "contract structure"
  - "security posture", "on-premise deployment"
  - "competitive landscape", "build vs buy"

  Do NOT use structural tags like "introduction", "closing", "wrap-up", "meeting logistics", or "next steps". Instead, describe the actual topic being discussed. For example, use "demo process" instead of "next steps", or "team coordination" instead of "closing".

- Assign a signal score to each passage:
  - "filler" — small talk, logistics, ums, transition phrases
  - "context" — provides background, setup, or narrative flow
  - "insight" — contains a concrete opinion, pain point, decision factor, or quotable moment. The kind of thing someone would clip for a highlight reel.

- For speaker attribution: use the known speakers list. Use speaker names EXACTLY as they appear in the list — do not add last names, affiliations, or annotations (e.g., if the list says "Oscar", output "Oscar", not "Oscar Loynaz" or "Oscar (TA)"). When you can't identify who's speaking, use "Unknown Speaker" rather than guessing. The ">>" marker indicates a speaker change but not which speaker.

- For a typical 30-minute call with ~500 segments, expect to produce 60-100 passages. For a 60-minute call, 100-180 passages. If your output has significantly fewer, you are likely making passages too coarse.

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
