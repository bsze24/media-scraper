import { createAnthropicClient } from "@lib/anthropic/client";
import { EXTRACT_ENTITIES_PROMPT } from "@lib/prompts/entities";
import type { EntitiesStepOutput } from "@lib/db/types";
import type { EntityTags } from "@/types/appearance";

const MODEL = "claude-sonnet-4-20250514";

export async function extractEntities(
  cleanedTranscript: string
): Promise<EntitiesStepOutput> {
  const client = createAnthropicClient();

  const response = await client.messages.create({
    model: MODEL,
    max_tokens: 4096,
    system: EXTRACT_ENTITIES_PROMPT,
    messages: [{ role: "user", content: cleanedTranscript }],
  });

  const block = response.content[0];
  if (block.type !== "text") {
    throw new Error("Unexpected response type from Claude: " + block.type);
  }

  let parsed: EntityTags;
  try {
    parsed = JSON.parse(block.text) as EntityTags;
  } catch (e) {
    throw new Error(
      `Failed to parse entity extraction JSON: ${e instanceof Error ? e.message : String(e)}\nRaw response: ${block.text.slice(0, 500)}`
    );
  }

  return { entity_tags: parsed };
}
