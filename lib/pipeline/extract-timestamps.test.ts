import { describe, it, expect } from "vitest";
import { extractTimestamps, mapSectionsToTurns } from "./extract-timestamps";
import type { Turn } from "@/types/appearance";
import type { CaptionSegment } from "@lib/scrapers/youtube";
import type { SectionHeading } from "@/types/scraper";

function makeTurn(index: number, text: string): Turn {
  return { speaker: "Speaker", text, turn_index: index };
}

function makeSeg(start: number, text: string): CaptionSegment {
  return { text, start, duration: 2 };
}

describe("extractTimestamps", () => {
  it("matches turns to caption segments by opening words", () => {
    const turns = [
      makeTurn(0, "Institutions need to be careful to think that something is a panacea"),
      makeTurn(1, "Tim thanks for doing this interview today"),
      makeTurn(2, "Hey my pleasure glad to be here"),
    ];
    const segments = [
      makeSeg(0.2, "Institutions need to be careful to think"),
      makeSeg(1.9, "that something is a panacea"),
      makeSeg(4.6, "and just because something has worked"),
      makeSeg(18.9, ">> Tim thanks for doing this"),
      makeSeg(20.2, ">> Hey my pleasure glad to"),
      makeSeg(22.1, "be here with you"),
    ];

    const result = extractTimestamps(turns, segments);
    expect(result[0].timestamp_seconds).toBe(0.2);
    expect(result[1].timestamp_seconds).toBe(18.9);
    expect(result[2].timestamp_seconds).toBe(20.2);
  });

  it("returns turns unchanged when captionSegments is null", () => {
    const turns = [makeTurn(0, "Some text here")];
    const result = extractTimestamps(turns, null);
    expect(result[0].timestamp_seconds).toBeUndefined();
  });

  it("returns turns unchanged when captionSegments is empty", () => {
    const turns = [makeTurn(0, "Some text here")];
    const result = extractTimestamps(turns, []);
    expect(result[0].timestamp_seconds).toBeUndefined();
  });

  it("handles partial matching — some turns match, some don't", () => {
    const turns = [
      makeTurn(0, "Hello world this is a test"),
      makeTurn(1, "Completely different unrelated content here today"),
      makeTurn(2, "Final words of the conversation goodbye"),
    ];
    const segments = [
      makeSeg(5.0, "Hello world this is a test"),
      makeSeg(100.0, "Final words of the conversation goodbye"),
    ];

    const result = extractTimestamps(turns, segments);
    expect(result[0].timestamp_seconds).toBe(5.0);
    expect(result[1].timestamp_seconds).toBeUndefined();
    expect(result[2].timestamp_seconds).toBe(100.0);
  });

  it("strips >> prefix from caption segments when matching", () => {
    const turns = [makeTurn(0, "Tim thanks for doing this today")];
    const segments = [makeSeg(18.9, ">> Tim thanks for doing this today")];

    const result = extractTimestamps(turns, segments);
    expect(result[0].timestamp_seconds).toBe(18.9);
  });

  it("skips matches that would violate monotonicity", () => {
    const turns = [
      makeTurn(0, "First speaker starts the conversation here"),
      makeTurn(1, "Second speaker responds to the question"),
      makeTurn(2, "First speaker starts the conversation here"), // duplicate text, earlier segment
    ];
    const segments = [
      makeSeg(10.0, "First speaker starts the conversation here"),
      makeSeg(50.0, "Second speaker responds to the question"),
    ];

    const result = extractTimestamps(turns, segments);
    expect(result[0].timestamp_seconds).toBe(10.0);
    expect(result[1].timestamp_seconds).toBe(50.0);
    // Turn 2 would match segment at 10.0 which is < 50.0 — skipped
    expect(result[2].timestamp_seconds).toBeUndefined();
  });
});

describe("mapSectionsToTurns", () => {
  it("maps sections to nearest timestamped turn", () => {
    const sections: SectionHeading[] = [
      { heading: "Introduction", anchor: "introduction", start_time: 0, source: "source" },
      { heading: "Main Topic", anchor: "main-topic", start_time: 120, source: "source" },
    ];
    const turns: Turn[] = [
      { ...makeTurn(0, "text"), timestamp_seconds: 2 },
      { ...makeTurn(1, "text"), timestamp_seconds: 60 },
      { ...makeTurn(2, "text"), timestamp_seconds: 118 },
      { ...makeTurn(3, "text"), timestamp_seconds: 180 },
    ];

    const result = mapSectionsToTurns(sections, turns);
    expect(result[0].turn_index).toBe(0); // closest to 0s is turn at 2s
    expect(result[1].turn_index).toBe(2); // closest to 120s is turn at 118s
  });

  it("leaves turn_index undefined when no turns have timestamps", () => {
    const sections: SectionHeading[] = [
      { heading: "Intro", anchor: "intro", start_time: 0, source: "source" },
    ];
    const turns = [makeTurn(0, "text"), makeTurn(1, "text")];

    const result = mapSectionsToTurns(sections, turns);
    expect(result[0].turn_index).toBeUndefined();
  });

  it("preserves existing turn_index on sections that already have one", () => {
    const sections: SectionHeading[] = [
      { heading: "Intro", anchor: "intro", start_time: 0, source: "source", turn_index: 5 },
    ];
    const turns: Turn[] = [
      { ...makeTurn(0, "text"), timestamp_seconds: 1 },
    ];

    const result = mapSectionsToTurns(sections, turns);
    expect(result[0].turn_index).toBe(5); // preserved, not overwritten
  });

  it("skips sections without start_time", () => {
    const sections: SectionHeading[] = [
      { heading: "Intro", anchor: "intro" }, // no start_time
    ];
    const turns: Turn[] = [
      { ...makeTurn(0, "text"), timestamp_seconds: 1 },
    ];

    const result = mapSectionsToTurns(sections, turns);
    expect(result[0].turn_index).toBeUndefined();
  });
});
