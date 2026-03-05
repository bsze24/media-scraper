import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@lib/anthropic/client", () => ({
  createAnthropicClient: vi.fn(),
}));

import { createAnthropicClient } from "@lib/anthropic/client";
import { extractEntities } from "./entities";

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

const VALID_ENTITIES = {
  fund_names: [
    {
      name: "Apollo Global Management",
      aliases: ["Apollo", "Marc Rowan's shop"],
      type: "primary" as const,
    },
  ],
  key_people: [
    {
      name: "Marc Rowan",
      title: "CEO",
      fund_affiliation: "Apollo Global Management",
    },
  ],
  sectors_themes: ["private credit", "insurance"],
  portfolio_companies: ["Athene"],
};

describe("extractEntities", () => {
  it("returns parsed EntityTags from Claude response", async () => {
    mockStream.mockReturnValue(
      makeMockStream(JSON.stringify(VALID_ENTITIES))
    );

    const result = await extractEntities("Some cleaned transcript...");

    expect(result.entity_tags).toEqual(VALID_ENTITIES);
    expect(result.entity_tags.fund_names).toHaveLength(1);
    expect(result.entity_tags.fund_names![0].name).toBe(
      "Apollo Global Management"
    );
    expect(result.entity_tags.key_people).toHaveLength(1);
    expect(result.entity_tags.sectors_themes).toHaveLength(2);
    expect(result.entity_tags.portfolio_companies).toHaveLength(1);
  });

  it("throws descriptive error on malformed JSON", async () => {
    mockStream.mockReturnValue(makeMockStream("not valid json {{{"));

    await expect(extractEntities("test")).rejects.toThrow(
      /Failed to parse entity extraction JSON/
    );
  });

  it("handles empty arrays in entity tags", async () => {
    const empty = {
      fund_names: [],
      key_people: [],
      sectors_themes: [],
      portfolio_companies: [],
    };
    mockStream.mockReturnValue(makeMockStream(JSON.stringify(empty)));

    const result = await extractEntities("test");
    expect(result.entity_tags.fund_names).toEqual([]);
    expect(result.entity_tags.key_people).toEqual([]);
  });
});
