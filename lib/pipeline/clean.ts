import { createAnthropicClient } from "@lib/anthropic/client";
import { CLEAN_TRANSCRIPT_PROMPT } from "@lib/prompts/clean";
import type { CleanStepOutput } from "@lib/db/types";

const MODEL = "claude-sonnet-4-20250514";

export async function cleanTranscript(
  rawTranscript: string
): Promise<CleanStepOutput> {
  const client = createAnthropicClient();

  console.log(`[clean] starting, transcript length: ${rawTranscript.length} chars`);

  let fullText = "";

  const stream = await client.messages.stream({
    model: MODEL,
    max_tokens: 64000,
    system: CLEAN_TRANSCRIPT_PROMPT,
    messages: [{ role: "user", content: rawTranscript }],
  });

  console.log(`[clean] stream created, waiting for chunks...`);

  for await (const chunk of stream) {
    console.log(`[clean] chunk type: ${chunk.type}`);
    if (
      chunk.type === "content_block_delta" &&
      chunk.delta.type === "text_delta"
    ) {
      fullText += chunk.delta.text;
    }
  }

  console.log(`[clean] complete, cleaned length: ${fullText.length} chars`);

  return { cleaned_transcript: fullText };
}
