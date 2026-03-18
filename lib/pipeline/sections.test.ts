import { describe, it, expect, vi, beforeEach } from "vitest";

const mockStream = {
  on: vi.fn(),
  finalText: vi.fn(),
  currentMessage: { usage: { output_tokens: 10 } },
};

const mockClient = {
  messages: {
    stream: vi.fn(() => mockStream),
  },
};

vi.mock("@lib/anthropic/client", () => ({
  createAnthropicClient: () => mockClient,
}));

import { generateSections } from "./sections";

beforeEach(() => {
  vi.clearAllMocks();
  mockStream.on.mockReturnValue(undefined);
});

describe("generateSections", () => {
  it("parses valid JSON response into sections with source:'inferred'", async () => {
    mockStream.finalText.mockResolvedValue(
      JSON.stringify([
        { heading: "Introduction and Background", turn_index: 0 },
        { heading: "Private Credit Markets", turn_index: 12 },
        { heading: "Portfolio Construction", turn_index: 28 },
        { heading: "Future Outlook", turn_index: 40 },
      ])
    );

    const sections = await generateSections("transcript", "Test Episode", 50);
    expect(sections).toHaveLength(4);
    expect(sections[0]).toMatchObject({
      heading: "Introduction and Background",
      anchor: "introduction-and-background",
      turn_index: 0,
      source: "inferred",
    });
    // No start_time on LLM sections
    expect(sections[0].start_time).toBeUndefined();
  });

  it("drops sections with out-of-range turn_index", async () => {
    mockStream.finalText.mockResolvedValue(
      JSON.stringify([
        { heading: "Valid", turn_index: 5 },
        { heading: "Too High", turn_index: 999 },
        { heading: "Negative", turn_index: -1 },
      ])
    );

    const sections = await generateSections("transcript", "Test", 50);
    expect(sections).toHaveLength(1);
    expect(sections[0].heading).toBe("Valid");
  });

  it("returns [] on invalid JSON without throwing", async () => {
    mockStream.finalText.mockResolvedValue("not valid json at all");

    const sections = await generateSections("transcript", "Test", 50);
    expect(sections).toEqual([]);
  });

  it("returns [] for empty array response", async () => {
    mockStream.finalText.mockResolvedValue("[]");

    const sections = await generateSections("transcript", "Test", 50);
    expect(sections).toEqual([]);
  });
});
