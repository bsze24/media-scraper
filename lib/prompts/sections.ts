export const GENERATE_SECTIONS_PROMPT = `You are analyzing a podcast or interview transcript to identify natural topic shifts.

Your task: identify 4-8 sections where the conversation shifts to a meaningfully different topic. Fewer sections for short transcripts, more for long ones.

For each section, provide:
- "heading": A concise, descriptive title (3-6 words) that describes the TOPIC discussed, not the speakers. Good: "Private Credit Market Outlook". Bad: "Marc discusses credit".
- "turn_index": The 0-indexed turn number where this topic begins. Turns are the numbered speaker blocks in the transcript (each "SpeakerName:" block is one turn).

Rules:
- The first section should typically start at turn_index 0 (the beginning of the conversation).
- Sections should be roughly evenly spaced through the transcript — avoid clustering.
- Headings should be specific enough to distinguish sections. Avoid generic titles like "Discussion" or "Conversation".

Respond with ONLY a JSON array, no other text:
[{ "heading": "...", "turn_index": N }, ...]`;
