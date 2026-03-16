import type { Turn, TurnAttribution } from "@/types/appearance";
import type { SectionHeading } from "@/types/scraper";

/**
 * Normalize a heading string for comparison: trim, lowercase, collapse
 * whitespace to single space, strip trailing punctuation.
 */
function normalizeHeading(s: string): string {
  return s
    .trim()
    .toLowerCase()
    .replace(/\s+/g, " ")
    .replace(/[.:;,!?]+$/, "");
}

/**
 * Parse a raw transcript (speaker-labeled blocks separated by double-newlines)
 * into structured Turn objects.
 *
 * Expected input format (from Colossus scraper):
 *
 *   SpeakerName:
 *   Paragraph 1
 *   Paragraph 2
 *
 *   OtherSpeaker:
 *   Paragraph 1...
 *
 * Blocks without a speaker label are appended to the previous turn.
 *
 * When `sections` is provided, heading blocks are recognized (not emitted as
 * turns) and a `section_anchor` is stamped on each subsequent turn. Turns
 * before the first heading have `section_anchor: undefined`.
 */
export function parseTurns(
  rawTranscript: string,
  sections?: SectionHeading[],
  attribution?: TurnAttribution
): Turn[] {
  if (!rawTranscript.trim()) return [];

  // Build normalized heading → anchor map for O(1) lookup
  const headingToAnchor = new Map<string, string>();
  if (sections) {
    for (const s of sections) {
      headingToAnchor.set(normalizeHeading(s.heading), s.anchor);
    }
  }

  const blocks = rawTranscript.split(/\n\n+/);
  const turns: Turn[] = [];
  let turnIndex = 0;
  let currentAnchor: string | undefined;

  for (const block of blocks) {
    const trimmed = block.trim();
    if (!trimmed) continue;

    // Check if this block is a section heading
    if (headingToAnchor.size > 0) {
      const anchor = headingToAnchor.get(normalizeHeading(trimmed));
      if (anchor) {
        currentAnchor = anchor;
        continue;
      }
    }

    // Check if this block starts with a speaker label: "SpeakerName:\n"
    const speakerMatch = trimmed.match(/^([^\n:]+):\n([\s\S]*)$/);

    if (speakerMatch) {
      const speaker = speakerMatch[1].trim();
      const text = speakerMatch[2].trim();
      const turn: Turn = {
        speaker,
        text,
        turn_index: turnIndex++,
        section_anchor: currentAnchor,
      };
      if (attribution) turn.attribution = attribution;
      turns.push(turn);
    } else if (turns.length > 0) {
      // No speaker label — append to previous turn
      turns[turns.length - 1].text += "\n\n" + trimmed;
    } else {
      // First block has no speaker — create turn with empty speaker
      const turn: Turn = {
        speaker: "",
        text: trimmed,
        turn_index: turnIndex++,
        section_anchor: currentAnchor,
      };
      if (attribution) turn.attribution = attribution;
      turns.push(turn);
    }
  }

  return turns;
}
