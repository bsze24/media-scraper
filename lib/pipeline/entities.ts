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

  let outputChars = 0;
  const logTimer = setInterval(() => {
    const tokens = stream.currentMessage?.usage.output_tokens;
    console.log(`[entities] streaming… ${tokens != null ? `${tokens} tokens` : `${outputChars} chars`} so far`);
  }, LOG_INTERVAL_MS);

  stream.on("text", (text) => {
    outputChars += text.length;
  });

  try {
    const text = await stream.finalText();
    const tokens = stream.currentMessage?.usage.output_tokens;
    console.log(
      `[entities] complete, ${tokens != null ? `${tokens} tokens` : `${outputChars} chars`}`
    );

    let raw: Record<string, unknown>;
    try {
      raw = JSON.parse(text) as Record<string, unknown>;
    } catch (e) {
      throw new Error(
        `Failed to parse entity extraction JSON: ${e instanceof Error ? e.message : String(e)}\nRaw response: ${text.slice(0, 500)}`
      );
    }

    // Validate and coerce to EntityTags shape — default missing fields to empty arrays
    const parsed: EntityTags = {
      fund_names: Array.isArray(raw.fund_names) ? raw.fund_names : [],
      key_people: Array.isArray(raw.key_people) ? raw.key_people : [],
      sectors_themes: Array.isArray(raw.sectors_themes) ? raw.sectors_themes : [],
      portfolio_companies: Array.isArray(raw.portfolio_companies) ? raw.portfolio_companies : [],
    };

    return { entity_tags: parsed };
  } finally {
    clearInterval(logTimer);
  }
}
