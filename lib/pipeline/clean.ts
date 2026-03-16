import { createAnthropicClient } from "@lib/anthropic/client";
import {
  CLEAN_TRANSCRIPT_PROMPT,
  buildYouTubeCleanPrompt,
  formatSpeakersBlock,
} from "@lib/prompts/clean";
import type { CleanStepOutput } from "@lib/db/types";
import { isYouTubeSource } from "@/types/appearance";
import type { Speaker, TranscriptSource } from "@/types/appearance";

const MODEL = "claude-sonnet-4-20250514";
const TIMEOUT_MS = 600_000;
const LOG_INTERVAL_MS = 5_000;

function selectPrompt(
  transcriptSource?: TranscriptSource,
  speakers?: Speaker[]
): string {
  if (transcriptSource && isYouTubeSource(transcriptSource)) {
    const speakersBlock = formatSpeakersBlock(speakers ?? []);
    return buildYouTubeCleanPrompt(speakersBlock);
  }
  return CLEAN_TRANSCRIPT_PROMPT;
}

export async function cleanTranscript(
  rawTranscript: string,
  options?: {
    transcriptSource?: TranscriptSource;
    speakers?: Speaker[];
  }
): Promise<CleanStepOutput> {
  const client = createAnthropicClient();
  const systemPrompt = selectPrompt(
    options?.transcriptSource,
    options?.speakers
  );
  const isYouTube = options?.transcriptSource && isYouTubeSource(options.transcriptSource);

  console.log(
    `[clean] starting (${isYouTube ? "youtube" : "curated"}), transcript length: ${rawTranscript.length} chars`
  );

  const stream = client.messages.stream(
    {
      model: MODEL,
      max_tokens: 64000,
      system: systemPrompt,
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
