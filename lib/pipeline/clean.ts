import { createAnthropicClient } from "@lib/anthropic/client";
import { CLEAN_TRANSCRIPT_PROMPT } from "@lib/prompts/clean";
import type { CleanStepOutput } from "@lib/db/types";

const MODEL = "claude-sonnet-4-20250514";
const TIMEOUT_MS = 600_000;
const LOG_INTERVAL_MS = 5_000;

export async function cleanTranscript(
  rawTranscript: string
): Promise<CleanStepOutput> {
  const client = createAnthropicClient();

  console.log(
    `[clean] starting, transcript length: ${rawTranscript.length} chars`
  );

  const stream = client.messages.stream(
    {
      model: MODEL,
      max_tokens: 16384,
      system: CLEAN_TRANSCRIPT_PROMPT,
      messages: [{ role: "user", content: rawTranscript }],
    },
    { timeout: TIMEOUT_MS }
  );

  let outputTokens = 0;
  const logTimer = setInterval(() => {
    const tokens = stream.currentMessage?.usage.output_tokens ?? outputTokens;
    console.log(`[clean] streaming… ${tokens} output tokens so far`);
  }, LOG_INTERVAL_MS);

  stream.on("text", () => {
    outputTokens++;
  });

  try {
    const text = await stream.finalText();
    console.log(
      `[clean] complete, ${stream.currentMessage?.usage.output_tokens ?? outputTokens} output tokens, cleaned length: ${text.length} chars`
    );
    return { cleaned_transcript: text };
  } finally {
    clearInterval(logTimer);
  }
}
