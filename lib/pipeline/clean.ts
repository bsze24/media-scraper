import { createAnthropicClient } from "@lib/anthropic/client";
import { CLEAN_TRANSCRIPT_PROMPT } from "@lib/prompts/clean";
import type { CleanStepOutput } from "@lib/db/types";

const MODEL = "claude-sonnet-4-20250514";

export async function cleanTranscript(
  rawTranscript: string
): Promise<CleanStepOutput> {
  const client = createAnthropicClient();

  const response = await client.messages.create({
    model: MODEL,
    max_tokens: 16384,
    system: CLEAN_TRANSCRIPT_PROMPT,
    messages: [{ role: "user", content: rawTranscript }],
  });

  const block = response.content[0];
  if (block.type !== "text") {
    throw new Error("Unexpected response type from Claude: " + block.type);
  }

  return { cleaned_transcript: block.text };
}
