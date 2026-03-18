import { createAnthropicClient } from "@lib/anthropic/client";
import { GENERATE_SECTIONS_PROMPT } from "@lib/prompts/sections";
import { slugify } from "@lib/scrapers/youtube";
import type { SectionHeading } from "@/types/scraper";

const MODEL = "claude-sonnet-4-20250514";
const TIMEOUT_MS = 600_000;
const LOG_INTERVAL_MS = 5_000;

export async function generateSections(
  cleanedTranscript: string,
  title: string,
  turnCount: number
): Promise<SectionHeading[]> {
  const client = createAnthropicClient();

  console.log(
    `[generateSections] starting, transcript length: ${cleanedTranscript.length} chars, ${turnCount} turns`
  );

  const stream = client.messages.stream(
    {
      model: MODEL,
      max_tokens: 2048,
      system: GENERATE_SECTIONS_PROMPT,
      messages: [
        {
          role: "user",
          content: `Title: ${title}\n\nTranscript:\n${cleanedTranscript}`,
        },
      ],
    },
    { timeout: TIMEOUT_MS }
  );

  let outputChars = 0;
  const logTimer = setInterval(() => {
    const tokens = stream.currentMessage?.usage.output_tokens;
    console.log(
      `[generateSections] streaming… ${tokens != null ? `${tokens} tokens` : `${outputChars} chars`} so far`
    );
  }, LOG_INTERVAL_MS);

  stream.on("text", (text) => {
    outputChars += text.length;
  });

  try {
    const text = await stream.finalText();
    const tokens = stream.currentMessage?.usage.output_tokens;
    console.log(
      `[generateSections] complete, ${tokens != null ? `${tokens} tokens` : `${outputChars} chars`}`
    );

    let raw: Array<{ heading: string; turn_index: number }>;
    try {
      const json = text
        .replace(/^```(?:json)?\s*\n?/, "")
        .replace(/\n?```\s*$/, "");
      raw = JSON.parse(json) as Array<{ heading: string; turn_index: number }>;
    } catch {
      console.error(
        `[generateSections] failed to parse JSON response: ${text.slice(0, 500)}`
      );
      return [];
    }

    if (!Array.isArray(raw)) {
      console.error("[generateSections] response is not an array");
      return [];
    }

    const sections: SectionHeading[] = raw
      .filter((s) => {
        if (typeof s.heading !== "string" || typeof s.turn_index !== "number") return false;
        if (s.turn_index < 0 || s.turn_index >= turnCount) {
          console.warn(
            `[generateSections] dropping section "${s.heading}" — turn_index ${s.turn_index} out of range [0, ${turnCount})`
          );
          return false;
        }
        return true;
      })
      .map((s) => ({
        heading: s.heading,
        anchor: slugify(s.heading),
        turn_index: s.turn_index,
        source: "inferred" as const,
      }));

    console.log(`[generateSections] ${sections.length} valid sections`);
    return sections;
  } finally {
    clearInterval(logTimer);
  }
}
