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

  console.log(`[clean] starting, transcript length: ${rawTranscript.length} chars`);

  const stream = client.messages.stream(
    {
      model: MODEL,
      max_tokens: 64000,
      system: CLEAN_TRANSCRIPT_PROMPT,
      messages: [{ role: "user", content: rawTranscript }],
    },
    { timeout: TIMEOUT_MS }
  );

  let outputChars = 0;
  const logTimer = setInterval(() => {
    console.log(`[clean] streaming… ${outputChars} chars so far`);
  }, LOG_INTERVAL_MS);

  stream.on("text", (text) => {
    outputChars += text.length;
  });

  try {
    const fullText = await stream.finalText();
    console.log(`[clean] complete, cleaned length: ${fullText.length} chars`);
    return { cleaned_transcript: fullText };
  } finally {
    clearInterval(logTimer);
  }
}
