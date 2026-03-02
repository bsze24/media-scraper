import { createAnthropicClient } from "@lib/anthropic/client";
import { EXTRACT_ENTITIES_PROMPT } from "@lib/prompts/entities";
import type { EntitiesStepOutput } from "@lib/db/types";
import type { EntityTags } from "@/types/appearance";

const MODEL = "claude-sonnet-4-20250514";
const TIMEOUT_MS = 600_000;
const LOG_INTERVAL_MS = 5_000;

export async function extractEntities(
  cleanedTranscript: string
): Promise<EntitiesStepOutput> {
  const client = createAnthropicClient();

  console.log(
    `[entities] starting, transcript length: ${cleanedTranscript.length} chars`
  );

  const stream = client.messages.stream(
    {
      model: MODEL,
      max_tokens: 4096,
      system: EXTRACT_ENTITIES_PROMPT,
      messages: [{ role: "user", content: cleanedTranscript }],
    },
    { timeout: TIMEOUT_MS }
  );

  let outputTokens = 0;
  const logTimer = setInterval(() => {
    const tokens = stream.currentMessage?.usage.output_tokens ?? outputTokens;
    console.log(`[entities] streaming… ${tokens} output tokens so far`);
  }, LOG_INTERVAL_MS);

  stream.on("text", () => {
    outputTokens++;
  });

  try {
    const text = await stream.finalText();
    console.log(
      `[entities] complete, ${stream.currentMessage?.usage.output_tokens ?? outputTokens} output tokens`
    );

    let parsed: EntityTags;
    try {
      parsed = JSON.parse(text) as EntityTags;
    } catch (e) {
      throw new Error(
        `Failed to parse entity extraction JSON: ${e instanceof Error ? e.message : String(e)}\nRaw response: ${text.slice(0, 500)}`
      );
    }

    return { entity_tags: parsed };
  } finally {
    clearInterval(logTimer);
  }
}
