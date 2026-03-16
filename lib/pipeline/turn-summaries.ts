import { createAnthropicClient } from "@lib/anthropic/client";
import { GENERATE_TURN_SUMMARIES_PROMPT } from "@lib/prompts/turn-summaries";
import type { Turn } from "@/types/appearance";

const MODEL = "claude-sonnet-4-20250514";
const TIMEOUT_MS = 600_000;
const LOG_INTERVAL_MS = 5_000;

export interface TurnSummary {
  speaker: string;
  summary: string;
  turn_index: number;
}

export async function generateTurnSummaries(
  turns: Turn[]
): Promise<TurnSummary[]> {
  if (turns.length === 0) return [];

  const client = createAnthropicClient();

  const input = turns.map((t) => ({
    turn_index: t.turn_index,
    speaker: t.speaker,
    text: t.text,
  }));

  console.log(`[turn-summaries] starting, ${turns.length} turns`);

  const stream = client.messages.stream(
    {
      model: MODEL,
      max_tokens: 8192,
      system: GENERATE_TURN_SUMMARIES_PROMPT,
      messages: [{ role: "user", content: JSON.stringify(input) }],
    },
    { timeout: TIMEOUT_MS }
  );

  let outputChars = 0;
  const logTimer = setInterval(() => {
    console.log(`[turn-summaries] streaming… ${outputChars} chars so far`);
  }, LOG_INTERVAL_MS);

  stream.on("text", (text) => {
    outputChars += text.length;
  });

  try {
    const text = await stream.finalText();
    console.log(`[turn-summaries] complete, ${text.length} chars`);

    let raw: Array<{ turn_index: number; speaker: string; summary: string }>;
    try {
      const json = text.replace(/^```(?:json)?\s*\n?/, "").replace(/\n?```\s*$/, "");
      raw = JSON.parse(json);
    } catch (e) {
      throw new Error(
        `Failed to parse turn summaries JSON: ${e instanceof Error ? e.message : String(e)}\nRaw response: ${text.slice(0, 500)}`
      );
    }

    if (!Array.isArray(raw)) {
      throw new Error(`Turn summaries response is not an array`);
    }

    // Validate length matches
    if (raw.length !== turns.length) {
      console.warn(
        `[turn-summaries] length mismatch: got ${raw.length} summaries for ${turns.length} turns`
      );
    }

    return raw.map((r) => ({
      speaker: r.speaker ?? "",
      summary: r.summary ?? "",
      turn_index: r.turn_index ?? 0,
    }));
  } finally {
    clearInterval(logTimer);
  }
}
