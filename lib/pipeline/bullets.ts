import { createAnthropicClient } from "@lib/anthropic/client";
import {
  GENERATE_BULLETS_PROMPT_CURATED,
  GENERATE_BULLETS_PROMPT_YOUTUBE,
} from "@lib/prompts/bullets";
import type { BulletsStepOutput } from "@lib/db/types";
import type { EntityTags, TranscriptSource } from "@/types/appearance";
import type { PrepBulletsData } from "@/types/bullets";
import type { SectionHeading } from "@/types/scraper";

const MODEL = "claude-sonnet-4-20250514";
const TIMEOUT_MS = 600_000;
const LOG_INTERVAL_MS = 5_000;

const CURATED_SOURCES: TranscriptSource[] = [
  "colossus",
  "capital_allocators",
  "acquired",
  "odd_lots",
];

function isCuratedSource(source: TranscriptSource): boolean {
  return CURATED_SOURCES.includes(source);
}

function findSectionAnchor(
  sectionName: string,
  sections: SectionHeading[]
): string | null {
  // Exact match first
  const exact = sections.find(
    (s) => s.heading.toLowerCase() === sectionName.toLowerCase()
  );
  if (exact) return exact.anchor;

  // Fuzzy: check if section name is contained in heading or vice versa
  const partial = sections.find((s) => {
    const h = s.heading.toLowerCase();
    const n = sectionName.toLowerCase();
    return h.includes(n) || n.includes(h);
  });
  if (partial) return partial.anchor;

  return null;
}

export async function generatePrepBullets(
  cleanedTranscript: string,
  entityTags: EntityTags,
  sections: SectionHeading[],
  transcriptSource: TranscriptSource
): Promise<BulletsStepOutput> {
  const client = createAnthropicClient();
  const curated = isCuratedSource(transcriptSource);

  const systemPrompt = curated
    ? GENERATE_BULLETS_PROMPT_CURATED
    : GENERATE_BULLETS_PROMPT_YOUTUBE;

  const userContent = curated
    ? `## Entity Tags\n${JSON.stringify(entityTags, null, 2)}\n\n## Sections Lookup Table\n${JSON.stringify(sections)}\n\n## Transcript\n${cleanedTranscript}`
    : `## Entity Tags\n${JSON.stringify(entityTags, null, 2)}\n\n## Transcript\n${cleanedTranscript}`;

  console.log(
    `[bullets] starting (${curated ? "curated" : "youtube"}), transcript length: ${cleanedTranscript.length} chars`
  );

  const stream = client.messages.stream(
    {
      model: MODEL,
      max_tokens: 8192,
      system: systemPrompt,
      messages: [{ role: "user", content: userContent }],
    },
    { timeout: TIMEOUT_MS }
  );

  let outputChars = 0;
  const logTimer = setInterval(() => {
    const tokens = stream.currentMessage?.usage.output_tokens;
    console.log(`[bullets] streaming… ${tokens != null ? `${tokens} tokens` : `${outputChars} chars`} so far`);
  }, LOG_INTERVAL_MS);

  stream.on("text", (text) => {
    outputChars += text.length;
  });

  try {
    const text = await stream.finalText();
    const tokens = stream.currentMessage?.usage.output_tokens;
    console.log(
      `[bullets] complete, ${tokens != null ? `${tokens} tokens` : `${outputChars} chars`}`
    );

    let raw: {
      bullets: Array<{
        text: string;
        supporting_quotes: Array<{
          quote: string;
          speaker?: string;
          section?: string;
          section_anchor?: string;
          timestamp_seconds?: number;
          timestamp_display?: string;
        }>;
      }>;
      rowspace_angles: Array<{ text: string }>;
    };

    try {
      const json = text.replace(/^```(?:json)?\s*\n?/, "").replace(/\n?```\s*$/, "");
      raw = JSON.parse(json);
    } catch (e) {
      throw new Error(
        `Failed to parse bullets JSON: ${e instanceof Error ? e.message : String(e)}\nRaw response: ${text.slice(0, 500)}`
      );
    }

    const prepBullets: PrepBulletsData = {
      bullets: (raw.bullets ?? []).map((b) => ({
        text: b.text,
        supporting_quotes: (b.supporting_quotes ?? []).map((sq) => {
          if (curated) {
            const anchor = sq.section_anchor
              ?? (sq.section ? findSectionAnchor(sq.section, sections) : null);
            return {
              quote: sq.quote,
              speaker: sq.speaker ?? null,
              section: sq.section ?? null,
              section_anchor: anchor,
              timestamp_seconds: null,
              timestamp_display: null,
            };
          }
          // YouTube / non-curated
          return {
            quote: sq.quote,
            speaker: sq.speaker ?? null,
            section: null,
            section_anchor: null,
            timestamp_seconds: sq.timestamp_seconds ?? null,
            timestamp_display: sq.timestamp_display ?? null,
          };
        }),
        vote: null,
        vote_note: null,
      })),
      rowspace_angles: (raw.rowspace_angles ?? []).map((a) => ({
        text: a.text,
        vote: null,
        vote_note: null,
      })),
    };

    return { prep_bullets: prepBullets };
  } finally {
    clearInterval(logTimer);
  }
}
