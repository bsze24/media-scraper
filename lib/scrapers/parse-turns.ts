import type { Turn } from "@/types/appearance";

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
 */
export function parseTurns(rawTranscript: string): Turn[] {
  if (!rawTranscript.trim()) return [];

  const blocks = rawTranscript.split(/\n\n+/);
  const turns: Turn[] = [];
  let turnIndex = 0;

  for (const block of blocks) {
    const trimmed = block.trim();
    if (!trimmed) continue;

    // Check if this block starts with a speaker label: "SpeakerName:\n"
    const speakerMatch = trimmed.match(/^([^\n:]+):\n([\s\S]*)$/);

    if (speakerMatch) {
      const speaker = speakerMatch[1].trim();
      const text = speakerMatch[2].trim();
      turns.push({ speaker, text, turn_index: turnIndex++ });
    } else if (turns.length > 0) {
      // No speaker label — append to previous turn
      turns[turns.length - 1].text += "\n\n" + trimmed;
    } else {
      // First block has no speaker — create turn with empty speaker
      turns.push({ speaker: "", text: trimmed, turn_index: turnIndex++ });
    }
  }

  return turns;
}
