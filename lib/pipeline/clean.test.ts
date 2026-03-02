import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@lib/anthropic/client", () => ({
  createAnthropicClient: vi.fn(),
}));

import { createAnthropicClient } from "@lib/anthropic/client";
import { cleanTranscript } from "./clean";

const mockCreate = vi.fn();

beforeEach(() => {
  vi.mocked(createAnthropicClient).mockReturnValue({
    messages: { create: mockCreate },
  } as unknown as ReturnType<typeof createAnthropicClient>);
  mockCreate.mockReset();
});

describe("cleanTranscript", () => {
  it("returns cleaned_transcript from Claude response", async () => {
    const cleaned = "Patrick:\nThis is a cleaned transcript.";
    mockCreate.mockResolvedValue({
      content: [{ type: "text", text: cleaned }],
    });

    const result = await cleanTranscript("Patrick:\nUm, this is a, you know, raw transcript.");

    expect(result).toEqual({ cleaned_transcript: cleaned });
    expect(mockCreate).toHaveBeenCalledOnce();
    expect(mockCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        model: "claude-sonnet-4-20250514",
        messages: [{ role: "user", content: "Patrick:\nUm, this is a, you know, raw transcript." }],
      })
    );
  });

  it("throws on unexpected response type", async () => {
    mockCreate.mockResolvedValue({
      content: [{ type: "tool_use", id: "x", name: "y", input: {} }],
    });

    await expect(cleanTranscript("test")).rejects.toThrow(
      "Unexpected response type"
    );
  });
});
