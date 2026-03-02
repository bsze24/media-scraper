import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@lib/anthropic/client", () => ({
  createAnthropicClient: vi.fn(),
}));

import { createAnthropicClient } from "@lib/anthropic/client";
import { generatePrepBullets } from "./bullets";
import { GENERATE_BULLETS_PROMPT_CURATED } from "@lib/prompts/bullets";
import type { EntityTags } from "@/types/appearance";
import type { SectionHeading } from "@/types/scraper";

const mockStream = vi.fn();

function makeMockStream(text: string) {
  return {
    on: vi.fn().mockReturnThis(),
    finalText: vi.fn().mockResolvedValue(text),
    currentMessage: { usage: { output_tokens: 42 } },
  };
}

beforeEach(() => {
  vi.mocked(createAnthropicClient).mockReturnValue({
    messages: { stream: mockStream },
  } as unknown as ReturnType<typeof createAnthropicClient>);
  mockStream.mockReset();
});

const ENTITY_TAGS: EntityTags = {
  fund_names: [
    { name: "Apollo Global Management", aliases: ["Apollo"], type: "primary" },
  ],
  key_people: [
    { name: "Marc Rowan", title: "CEO", fund_affiliation: "Apollo" },
  ],
  sectors_themes: ["private credit"],
  portfolio_companies: ["Athene"],
};

const SECTIONS: SectionHeading[] = [
  { heading: "Introduction", anchor: "introduction" },
  { heading: "The Private Credit Opportunity", anchor: "private-credit-opportunity" },
  { heading: "Building Athene", anchor: "building-athene" },
];

const MOCK_LLM_RESPONSE = {
  bullets: [
    {
      text: "Apollo sees private credit as a multi-decade opportunity driven by bank disintermediation.",
      supporting_quotes: [
        {
          quote: "We think private credit is a generational opportunity.",
          speaker: "Marc Rowan",
          section: "The Private Credit Opportunity",
        },
        {
          quote: "Banks are pulling back from lending.",
          speaker: "Marc Rowan",
          section: "Introduction",
        },
      ],
    },
    {
      text: "Athene was built to capture the insurance-linked investment opportunity.",
      supporting_quotes: [
        {
          quote: "Insurance was the foundation.",
          speaker: "Marc Rowan",
          section: "Building Athene",
        },
      ],
    },
  ],
  rowspace_angles: [
    {
      text: "Apollo's data needs for private credit underwriting align with Rowspace's AI platform capabilities.",
    },
  ],
};

describe("generatePrepBullets", () => {
  it("returns PrepBulletsData with correct shape", async () => {
    mockStream.mockReturnValue(
      makeMockStream(JSON.stringify(MOCK_LLM_RESPONSE))
    );

    const result = await generatePrepBullets(
      "cleaned transcript...",
      ENTITY_TAGS,
      SECTIONS,
      "colossus"
    );

    expect(result.prep_bullets.bullets).toHaveLength(2);
    expect(result.prep_bullets.rowspace_angles).toHaveLength(1);
  });

  it("initializes vote and vote_note as null on bullets", async () => {
    mockStream.mockReturnValue(
      makeMockStream(JSON.stringify(MOCK_LLM_RESPONSE))
    );

    const result = await generatePrepBullets(
      "transcript",
      ENTITY_TAGS,
      SECTIONS,
      "colossus"
    );

    for (const bullet of result.prep_bullets.bullets!) {
      expect(bullet.vote).toBeNull();
      expect(bullet.vote_note).toBeNull();
    }
  });

  it("initializes vote and vote_note as null on rowspace angles", async () => {
    mockStream.mockReturnValue(
      makeMockStream(JSON.stringify(MOCK_LLM_RESPONSE))
    );

    const result = await generatePrepBullets(
      "transcript",
      ENTITY_TAGS,
      SECTIONS,
      "colossus"
    );

    for (const angle of result.prep_bullets.rowspace_angles!) {
      expect(angle.vote).toBeNull();
      expect(angle.vote_note).toBeNull();
    }
  });

  it("maps section names to section_anchor for curated sources", async () => {
    mockStream.mockReturnValue(
      makeMockStream(JSON.stringify(MOCK_LLM_RESPONSE))
    );

    const result = await generatePrepBullets(
      "transcript",
      ENTITY_TAGS,
      SECTIONS,
      "colossus"
    );

    const quotes = result.prep_bullets.bullets![0].supporting_quotes;
    expect(quotes[0].section).toBe("The Private Credit Opportunity");
    expect(quotes[0].section_anchor).toBe("private-credit-opportunity");
    expect(quotes[1].section).toBe("Introduction");
    expect(quotes[1].section_anchor).toBe("introduction");
  });

  it("sets timestamp fields to null for curated sources", async () => {
    mockStream.mockReturnValue(
      makeMockStream(JSON.stringify(MOCK_LLM_RESPONSE))
    );

    const result = await generatePrepBullets(
      "transcript",
      ENTITY_TAGS,
      SECTIONS,
      "colossus"
    );

    for (const bullet of result.prep_bullets.bullets!) {
      for (const sq of bullet.supporting_quotes) {
        expect(sq.timestamp_seconds).toBeNull();
        expect(sq.timestamp_display).toBeNull();
      }
    }
  });

  it("uses curated prompt for colossus source", async () => {
    mockStream.mockReturnValue(
      makeMockStream(JSON.stringify(MOCK_LLM_RESPONSE))
    );

    await generatePrepBullets("transcript", ENTITY_TAGS, SECTIONS, "colossus");

    expect(mockStream).toHaveBeenCalledWith(
      expect.objectContaining({
        system: GENERATE_BULLETS_PROMPT_CURATED,
      }),
      expect.anything()
    );
  });

  it("uses curated prompt for capital_allocators source", async () => {
    mockStream.mockReturnValue(
      makeMockStream(JSON.stringify(MOCK_LLM_RESPONSE))
    );

    await generatePrepBullets(
      "transcript",
      ENTITY_TAGS,
      SECTIONS,
      "capital_allocators"
    );

    expect(mockStream).toHaveBeenCalledWith(
      expect.objectContaining({
        system: GENERATE_BULLETS_PROMPT_CURATED,
      }),
      expect.anything()
    );
  });

  it("uses youtube prompt for youtube_captions source", async () => {
    const youtubeResponse = {
      bullets: [
        {
          text: "Key insight from the video.",
          supporting_quotes: [
            {
              quote: "This is what I said.",
              speaker: "Guest",
              timestamp_seconds: 120,
              timestamp_display: "2:00",
            },
          ],
        },
      ],
      rowspace_angles: [{ text: "Angle text." }],
    };

    mockStream.mockReturnValue(
      makeMockStream(JSON.stringify(youtubeResponse))
    );

    const result = await generatePrepBullets(
      "transcript",
      ENTITY_TAGS,
      [],
      "youtube_captions"
    );

    // YouTube source should have null section fields
    const sq = result.prep_bullets.bullets![0].supporting_quotes[0];
    expect(sq.section).toBeNull();
    expect(sq.section_anchor).toBeNull();
    expect(sq.timestamp_seconds).toBe(120);
    expect(sq.timestamp_display).toBe("2:00");
  });

  it("handles fuzzy section matching", async () => {
    const responseWithPartialSection = {
      bullets: [
        {
          text: "Insight about credit.",
          supporting_quotes: [
            {
              quote: "Quote about credit.",
              speaker: "Guest",
              section: "Private Credit Opportunity",
            },
          ],
        },
      ],
      rowspace_angles: [],
    };

    mockStream.mockReturnValue(
      makeMockStream(JSON.stringify(responseWithPartialSection))
    );

    const result = await generatePrepBullets(
      "transcript",
      ENTITY_TAGS,
      SECTIONS,
      "colossus"
    );

    // "Private Credit Opportunity" should fuzzy-match to "The Private Credit Opportunity"
    expect(result.prep_bullets.bullets![0].supporting_quotes[0].section_anchor).toBe(
      "private-credit-opportunity"
    );
  });

  it("throws descriptive error on malformed JSON", async () => {
    mockStream.mockReturnValue(
      makeMockStream("```json\n{invalid}\n```")
    );

    await expect(
      generatePrepBullets("transcript", ENTITY_TAGS, SECTIONS, "colossus")
    ).rejects.toThrow(/Failed to parse bullets JSON/);
  });
});
