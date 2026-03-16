export const GENERATE_TURN_SUMMARIES_PROMPT = `You are a transcript summarizer. For each turn in the transcript below, write a concise summary (under 20 words) capturing what the speaker is saying in that turn.

You will receive a JSON array of turns, each with turn_index, speaker, and text.

Return a JSON array with one entry per turn, in the same order:

[
  { "turn_index": 0, "speaker": "SpeakerName", "summary": "What they said in under 20 words" },
  { "turn_index": 1, "speaker": "SpeakerName", "summary": "..." }
]

Rules:
- One summary per turn, matching the input turn_index exactly
- Summaries should capture the substance, not just echo the first sentence
- Keep each summary under 20 words
- Use third person ("Discusses...", "Explains...", "Asks about...")
- Do NOT skip any turns — output array length must match input array length

Return only valid JSON, no markdown fences, no preamble.`;
