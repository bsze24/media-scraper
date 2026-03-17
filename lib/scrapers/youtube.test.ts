import { describe, it, expect } from "vitest";
import {
  extractVideoId,
  parseJson3Events,
  formatTimestamp,
  buildRawTranscript,
  extractSpeakers,
  slugify,
} from "./youtube";
import type { CaptionSegment } from "./youtube";

describe("extractVideoId", () => {
  it("extracts from standard youtube.com/watch URL", () => {
    expect(extractVideoId("https://www.youtube.com/watch?v=Z6i-6DXsYe4")).toBe("Z6i-6DXsYe4");
  });

  it("extracts from youtu.be short URL", () => {
    expect(extractVideoId("https://youtu.be/Z6i-6DXsYe4")).toBe("Z6i-6DXsYe4");
  });

  it("extracts from embed URL", () => {
    expect(extractVideoId("https://www.youtube.com/embed/Z6i-6DXsYe4")).toBe("Z6i-6DXsYe4");
  });

  it("extracts from URL with extra params", () => {
    expect(
      extractVideoId("https://www.youtube.com/watch?v=Z6i-6DXsYe4&t=120")
    ).toBe("Z6i-6DXsYe4");
  });

  it("extracts from m.youtube.com", () => {
    expect(
      extractVideoId("https://m.youtube.com/watch?v=Z6i-6DXsYe4")
    ).toBe("Z6i-6DXsYe4");
  });

  it("throws for non-YouTube URL", () => {
    expect(() => extractVideoId("https://example.com/video")).toThrow(
      /cannot extract youtube video id/i
    );
  });
});

describe("parseJson3Events", () => {
  it("parses events with text segments", () => {
    const events = [
      { tStartMs: 1000, dDurationMs: 2000, segs: [{ utf8: "Hello " }, { utf8: "world" }] },
      { tStartMs: 3000, dDurationMs: 1500, segs: [{ utf8: "Second line" }] },
    ];
    const segments = parseJson3Events(events);
    expect(segments).toHaveLength(2);
    expect(segments[0]).toEqual({ text: "Hello world", start: 1, duration: 2 });
    expect(segments[1]).toEqual({ text: "Second line", start: 3, duration: 1.5 });
  });

  it("skips empty segments", () => {
    const events = [
      { tStartMs: 0, dDurationMs: 1000, segs: [{ utf8: "" }] },
      { tStartMs: 1000, dDurationMs: 1000, segs: [{ utf8: "text" }] },
    ];
    expect(parseJson3Events(events)).toHaveLength(1);
  });

  it("skips music markers", () => {
    const events = [
      { tStartMs: 0, dDurationMs: 3000, segs: [{ utf8: "[Music]" }] },
      { tStartMs: 3000, dDurationMs: 1000, segs: [{ utf8: "text" }] },
    ];
    expect(parseJson3Events(events)).toHaveLength(1);
  });

  it("handles events with no segs", () => {
    const events = [{ tStartMs: 0, dDurationMs: 1000 }];
    expect(parseJson3Events(events)).toHaveLength(0);
  });
});

describe("formatTimestamp", () => {
  it("formats seconds to MM:SS", () => {
    expect(formatTimestamp(0)).toBe("0:00");
    expect(formatTimestamp(65)).toBe("1:05");
    expect(formatTimestamp(3661)).toBe("61:01");
    expect(formatTimestamp(863.5)).toBe("14:23");
  });
});

describe("buildRawTranscript", () => {
  it("groups segments into timestamped paragraphs", () => {
    const segments: CaptionSegment[] = [
      { text: "Hello there", start: 0, duration: 2 },
      { text: "how are you", start: 2, duration: 2 },
      // 3 second gap triggers new paragraph
      { text: "I'm fine", start: 7, duration: 2 },
    ];
    const transcript = buildRawTranscript(segments);
    expect(transcript).toContain("[0:00]");
    expect(transcript).toContain("[0:07]");
    expect(transcript).toContain("Hello there how are you");
    expect(transcript).toContain("I'm fine");
  });

  it("starts new paragraph on >> speaker change", () => {
    const segments: CaptionSegment[] = [
      { text: "First speaker talks", start: 0, duration: 3 },
      { text: ">> Second speaker here", start: 3, duration: 3 },
    ];
    const transcript = buildRawTranscript(segments);
    const paragraphs = transcript.split("\n\n");
    expect(paragraphs).toHaveLength(2);
  });

  it("returns empty string for no segments", () => {
    expect(buildRawTranscript([])).toBe("");
  });
});

describe("extractSpeakers", () => {
  it("extracts host from known channel name", () => {
    const speakers = extractSpeakers(
      "Tim Sullivan - Yale's Private Portfolio (EP.456)",
      "My guest is Tim Sullivan...",
      "Capital Allocators with Ted Seides"
    );
    expect(speakers).toContainEqual(
      expect.objectContaining({ name: "Ted Seides", role: "host" })
    );
  });

  it("extracts guest from title pattern 'Name - Topic'", () => {
    const speakers = extractSpeakers(
      "Tim Sullivan - Yale's Private Portfolio (EP.456)",
      "description",
      "Capital Allocators with Ted Seides"
    );
    expect(speakers).toContainEqual(
      expect.objectContaining({ name: "Tim Sullivan", role: "guest" })
    );
  });

  it("extracts guest from 'with Name' pattern", () => {
    const speakers = extractSpeakers(
      "Investing Insights with Marc Rowan",
      "description",
      "Some Channel"
    );
    expect(speakers).toContainEqual(
      expect.objectContaining({ name: "Marc Rowan", role: "guest" })
    );
  });

  it("returns empty array for unrecognizable format", () => {
    const speakers = extractSpeakers(
      "markets update",
      "no names here",
      "Unknown Channel"
    );
    expect(speakers).toEqual([]);
  });
});

describe("slugify", () => {
  it("converts headings to URL-friendly slugs", () => {
    expect(slugify("Apollo's DNA")).toBe("apollos-dna");
    expect(slugify("The Big Picture: 2024 & Beyond")).toBe("the-big-picture-2024-beyond");
    expect(slugify("  Extra   Spaces  ")).toBe("extra-spaces");
  });
});
