import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@lib/anthropic/client", () => ({
  createAnthropicClient: vi.fn(),
}));

import { createAnthropicClient } from "@lib/anthropic/client";
import { cleanTranscript } from "./clean";

const mockStream = vi.fn();

function makeMockMessageStream(text: string) {
  return {
    on: vi.fn(),
    finalText: vi.fn().mockResolvedValue(text),
  };
}

beforeEach(() => {
  vi.mocked(createAnthropicClient).mockReturnValue({
    messages: { stream: mockStream },
  } as unknown as ReturnType<typeof createAnthropicClient>);
  mockStream.mockReset();
});

describe("cleanTranscript", () => {
  it("returns cleaned_transcript from Claude response", async () => {
    const cleaned = "Patrick:\nThis is a cleaned transcript.";
    mockStream.mockReturnValue(makeMockMessageStream(cleaned));

    const result = await cleanTranscript(
      "Patrick:\nUm, this is a, you know, raw transcript."
    );

    expect(result).toEqual({ cleaned_transcript: cleaned });
    expect(mockStream).toHaveBeenCalledOnce();
    expect(mockStream).toHaveBeenCalledWith(
      expect.objectContaining({
        model: "claude-sonnet-4-20250514",
        messages: [
          {
            role: "user",
            content: "Patrick:\nUm, this is a, you know, raw transcript.",
          },
        ],
      }),
      { timeout: 600_000 }
    );
  });

  it("returns text from finalText() helper", async () => {
    mockStream.mockReturnValue(makeMockMessageStream("Hello world"));

    const result = await cleanTranscript("test");
    expect(result).toEqual({ cleaned_transcript: "Hello world" });
  });
});
