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

export interface TurnSummariesResult {
  summaries: TurnSummary[];
  warning?: string;
}

function parseSummariesResponse(text: string): TurnSummary[] {
  const json = text.replace(/^```(?:json)?\s*\n?/, "").replace(/\n?```\s*$/, "");
  const raw = JSON.parse(json);

  if (!Array.isArray(raw)) {
    throw new Error("Turn summaries response is not an array");
  }

  return raw.map((r: { turn_index?: number; speaker?: string; summary?: string }) => ({
    speaker: r.speaker ?? "",
    summary: r.summary ?? "",
    turn_index: r.turn_index ?? 0,
  }));
}

function findMissingTurns(
  turns: Turn[],
  summaries: TurnSummary[]
): { turn_index: number; speaker: string; textPreview: string }[] {
  const returnedIndexes = new Set(summaries.map((s) => s.turn_index));
  return turns
    .filter((t) => !returnedIndexes.has(t.turn_index))
    .map((t) => ({
      turn_index: t.turn_index,
      speaker: t.speaker,
      textPreview: t.text.slice(0, 50),
    }));
}

function logMismatch(
  attempt: number,
  expected: number,
  received: number,
  missing: { turn_index: number; speaker: string; textPreview: string }[]
): void {
  console.warn(
    `[turn-summaries] attempt ${attempt} mismatch: expected ${expected}, got ${received}, missing ${missing.length} turns:`
  );
  for (const m of missing) {
    console.warn(
      `  turn_index=${m.turn_index} speaker="${m.speaker}" text="${m.textPreview}…"`
    );
  }
}

async function callLLM(
  turns: Turn[]
): Promise<TurnSummary[]> {
  const client = createAnthropicClient();

  const input = turns.map((t) => ({
    turn_index: t.turn_index,
    speaker: t.speaker,
    text: t.text,
  }));

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
    console.log(`[turn-summaries] LLM response: ${text.length} chars`);
    return parseSummariesResponse(text);
  } finally {
    clearInterval(logTimer);
  }
}

export async function generateTurnSummaries(
  turns: Turn[]
): Promise<TurnSummariesResult> {
  if (turns.length === 0) return { summaries: [] };

  console.log(`[turn-summaries] starting, ${turns.length} turns`);

  // Attempt 1
  let summaries = await callLLM(turns);
  let missing = findMissingTurns(turns, summaries);

  if (missing.length > 0) {
    logMismatch(1, turns.length, summaries.length, missing);

    // Retry once
    console.log(`[turn-summaries] retrying…`);
    summaries = await callLLM(turns);
    missing = findMissingTurns(turns, summaries);

    if (missing.length > 0) {
      logMismatch(2, turns.length, summaries.length, missing);

      const missingIndexes = missing.map((m) => m.turn_index);
      const warning = `turn_summaries_incomplete: expected ${turns.length}, got ${summaries.length}, missing turn_indexes: [${missingIndexes.join(", ")}]`;
      console.warn(`[turn-summaries] proceeding with partial results: ${warning}`);

      return { summaries, warning };
    }
  }

  console.log(`[turn-summaries] complete, ${summaries.length} summaries`);
  return { summaries };
}
