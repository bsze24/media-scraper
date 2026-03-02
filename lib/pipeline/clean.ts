import { createAnthropicClient } from "@lib/anthropic/client";
import { CLEAN_TRANSCRIPT_PROMPT } from "@lib/prompts/clean";
import type { CleanStepOutput } from "@lib/db/types";

const MODEL = "claude-sonnet-4-20250514";

export async function cleanTranscript(
  rawTranscript: string
): Promise<CleanStepOutput> {
  const client = createAnthropicClient();

  console.log(`[clean] starting, transcript length: ${rawTranscript.length} chars`);

  const response = await client.messages.create({
    model: MODEL,
    max_tokens: 64000,
    system: CLEAN_TRANSCRIPT_PROMPT,
    messages: [{ role: "user", content: rawTranscript }],
  },{timeout: 600000,
  });

  const block = response.content[0];
  if (block.type !== "text") {
    throw new Error("Unexpected response type from Claude: " + block.type);
  }

  console.log(`[clean] complete, cleaned length: ${block.text.length} chars`);

  return { cleaned_transcript: block.text };
}
