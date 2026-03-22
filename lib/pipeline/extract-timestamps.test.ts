import { describe, it, expect } from "vitest";
import { extractTimestamps, mapSectionsToTurns, stampSectionAnchors } from "./extract-timestamps";
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

  it("rejects match that deviates too far from expected position", () => {
    // 10 turns, 6000s video. Turn 1 expected at 600s.
    // The false match is at 3500s (deviation 2900s > 900s threshold) — rejected.
    // The correct match at 580s (deviation 20s) comes first in scan order — accepted.
    // Without deviation check, both would match but the false one could cause cascades.
    const turns: Turn[] = Array.from({ length: 10 }, (_, i) =>
      makeTurn(i, `Unique text for turn number ${i} here today`)
    );
    // Override turn 1 with a common phrase that appears twice in segments
    turns[1] = makeTurn(1, "I think that is really important here");

    const segments = [
      makeSeg(50.0, "Unique text for turn number 0 here today"),
      makeSeg(580.0, "I think that is really important here"),   // correct — near expected
      makeSeg(3500.0, "I think that is really important here"),  // false — far from expected
      makeSeg(1200.0, "Unique text for turn number 2 here today"),
      makeSeg(1800.0, "Unique text for turn number 3 here today"),
    ];

    const result = extractTimestamps(turns, segments, 6000);
    expect(result[0].timestamp_seconds).toBe(50.0);
    expect(result[1].timestamp_seconds).toBe(580.0); // correct nearby match accepted
    expect(result[2].timestamp_seconds).toBe(1200.0); // subsequent turns still match
  });

  it("leaves turn unmatched when only a far-away match exists (no segScanPos advance)", () => {
    // 4 turns, 2400s video. Turn 1 expected at 600s.
    // Only match for turn 1 is at 2200s (deviation 1600s > 900s) — rejected.
    // Turn 2 expected at 1200s, segment at 1200s — should still match because segScanPos didn't jump.
    const turns = [
      makeTurn(0, "First speaker opens the conversation here"),
      makeTurn(1, "I think that is really important here"),
      makeTurn(2, "The market outlook for next year looks"),
      makeTurn(3, "Thank you very much for joining us"),
    ];
    const segments = [
      makeSeg(10.0, "First speaker opens the conversation here"),
      makeSeg(1200.0, "The market outlook for next year looks"),
      makeSeg(2200.0, "I think that is really important here"), // only match, but too far
      makeSeg(2350.0, "Thank you very much for joining us"),
    ];

    const result = extractTimestamps(turns, segments, 2400);
    expect(result[0].timestamp_seconds).toBe(10.0);
    expect(result[1].timestamp_seconds).toBeUndefined(); // rejected, too far
    expect(result[2].timestamp_seconds).toBe(1200.0); // recovered because segScanPos didn't jump
    expect(result[3].timestamp_seconds).toBe(2350.0);
  });

  it("accepts match within tolerance (10-min deviation under 15-min threshold)", () => {
    // 2 turns, 3600s video. Turn 1 expected at 1800s. Segment at 2400s (deviation 600s < 900s).
    const turns = [
      makeTurn(0, "Welcome to our discussion about investing"),
      makeTurn(1, "The portfolio allocation strategy requires careful"),
    ];
    const segments = [
      makeSeg(100.0, "Welcome to our discussion about investing"),
      makeSeg(2400.0, "The portfolio allocation strategy requires careful"),
    ];

    const result = extractTimestamps(turns, segments, 3600);
    expect(result[0].timestamp_seconds).toBe(100.0);
    expect(result[1].timestamp_seconds).toBe(2400.0); // 600s deviation, within tolerance
  });

  it("skips deviation check when videoDuration is undefined (backward compatible)", () => {
    // Without videoDuration, even far-away matches should be accepted (old behavior)
    const turns = [
      makeTurn(0, "Welcome to the show today everyone"),
      makeTurn(1, "I think that is really important here"),
    ];
    const segments = [
      makeSeg(5.0, "Welcome to the show today everyone"),
      makeSeg(3500.0, "I think that is really important here"), // very far, but no check
    ];

    const result = extractTimestamps(turns, segments); // no videoDuration
    expect(result[0].timestamp_seconds).toBe(5.0);
    expect(result[1].timestamp_seconds).toBe(3500.0); // accepted without deviation check
  });
});

describe("extractTimestamps — pass 2 bracketed recovery", () => {
  it("recovers an unmatched turn at 3/6 overlap within bracket", () => {
    // 4 turns, 2400s video. Turn 1 has only 3/6 overlap — pass 1 skips it.
    // Pass 2 finds it within the bracket [10, 1200].
    // turn 1 words: "alpha", "bravo", "charlie", "delta", "echo", "foxtrot"
    // seg words:    "alpha", "bravo", "charlie", "golf", "hotel", "india"
    // overlap: alpha, bravo, charlie = 3/6 (below pass 1 threshold of 4)
    const turns = [
      makeTurn(0, "Welcome to our show today everyone here"),
      makeTurn(1, "Alpha bravo charlie delta echo foxtrot"),
      makeTurn(2, "The infrastructure investment thesis remains strong today"),
      makeTurn(3, "Thank you very much for joining us today"),
    ];
    const segments = [
      makeSeg(10.0, "Welcome to our show today everyone here"),
      makeSeg(400.0, "Alpha bravo charlie golf hotel india"), // 3/6 overlap with turn 1
      makeSeg(1200.0, "The infrastructure investment thesis remains strong today"),
      makeSeg(2300.0, "Thank you very much for joining us today"),
    ];

    const result = extractTimestamps(turns, segments, 2400);
    expect(result[0].timestamp_seconds).toBe(10.0);    // pass 1
    expect(result[1].timestamp_seconds).toBe(400.0);    // pass 2 recovery
    expect(result[2].timestamp_seconds).toBe(1200.0);   // pass 1
    expect(result[3].timestamp_seconds).toBe(2300.0);   // pass 1
  });

  it("rejects pass 2 match that deviates too far from expected position", () => {
    // 4 turns, 2400s. Turn 1 expected at 600s.
    // Bracket from pass 1 is [10, 2300] (wide because turn 2 is unmatched too).
    // Segment at 2200s has 3/6 overlap but deviation = |2200-600| = 1600 > 900.
    // turn 1 words: {alpha, bravo, charlie, delta, echo, foxtrot}
    // seg words:    {alpha, bravo, charlie, xray, yankee, zulu} → 3/6
    const turns = [
      makeTurn(0, "Welcome to our show today everyone here"),
      makeTurn(1, "Alpha bravo charlie delta echo foxtrot"),
      makeTurn(2, "Completely unique text that matches nothing here"),
      makeTurn(3, "Thank you very much for joining us today"),
    ];
    const segments = [
      makeSeg(10.0, "Welcome to our show today everyone here"),
      makeSeg(2200.0, "Alpha bravo charlie xray yankee zulu"), // 3/6 but too far from expected
      makeSeg(2300.0, "Thank you very much for joining us today"),
    ];

    const result = extractTimestamps(turns, segments, 2400);
    expect(result[0].timestamp_seconds).toBe(10.0);
    expect(result[1].timestamp_seconds).toBeUndefined(); // deviation-rejected in pass 2
    expect(result[2].timestamp_seconds).toBeUndefined(); // no match at all
    expect(result[3].timestamp_seconds).toBe(2300.0);
  });

  it("takes the best overlap match when multiple segments pass threshold", () => {
    // 3 turns, 1800s. Turn 1 unmatched in pass 1 (max overlap 3/6 < threshold 4).
    // Two segments in bracket: 2/6 at 400s and 3/6 at 500s. Pass 2 picks 500s.
    // turn 1 words: {alpha, bravo, charlie, delta, echo, foxtrot}
    // seg 400 words: {alpha, bravo, yankee, zulu, omega, kappa} → overlap 2/6
    // seg 500 words: {alpha, bravo, charlie, xray, yankee, zulu} → overlap 3/6
    const turns = [
      makeTurn(0, "Welcome to the program today everyone here"),
      makeTurn(1, "Alpha bravo charlie delta echo foxtrot"),
      makeTurn(2, "Thank you for watching the program today"),
    ];
    const segments = [
      makeSeg(10.0, "Welcome to the program today everyone here"),
      makeSeg(400.0, "Alpha bravo yankee zulu omega kappa"),        // 2/6 with turn 1
      makeSeg(500.0, "Alpha bravo charlie xray yankee zulu"),       // 3/6 with turn 1
      makeSeg(1700.0, "Thank you for watching the program today"),
    ];

    const result = extractTimestamps(turns, segments, 1800);
    expect(result[1].timestamp_seconds).toBe(500.0); // best overlap (3/6 > 2/6)
  });

  it("handles all turns unmatched in pass 1 without crashing", () => {
    // No segments match any turn — pass 1 produces no skeleton, pass 2 has no brackets.
    const turns = [
      makeTurn(0, "Alpha bravo charlie delta echo foxtrot"),
      makeTurn(1, "Golf hotel india juliet kilo lima"),
    ];
    const segments = [
      makeSeg(10.0, "Completely unrelated content here today now"),
      makeSeg(500.0, "More unrelated content that does not match"),
    ];

    const result = extractTimestamps(turns, segments, 1000);
    expect(result[0].timestamp_seconds).toBeUndefined();
    expect(result[1].timestamp_seconds).toBeUndefined();
  });

  it("skips pass 2 when videoDuration is undefined", () => {
    // Turn 1 has only 3/6 overlap — would be recovered by pass 2 if it ran.
    // Without videoDuration, pass 2 is skipped entirely.
    // turn 1 words: {alpha, bravo, charlie, delta, echo, foxtrot}
    // seg words:    {alpha, bravo, charlie, golf, hotel, india} → 3/6
    const turns = [
      makeTurn(0, "Welcome to our show today everyone here"),
      makeTurn(1, "Alpha bravo charlie delta echo foxtrot"),
      makeTurn(2, "Thank you very much for joining us today"),
    ];
    const segments = [
      makeSeg(10.0, "Welcome to our show today everyone here"),
      makeSeg(400.0, "Alpha bravo charlie golf hotel india"), // 3/6 overlap
      makeSeg(1700.0, "Thank you very much for joining us today"),
    ];

    const result = extractTimestamps(turns, segments); // no videoDuration
    expect(result[0].timestamp_seconds).toBe(10.0);
    expect(result[1].timestamp_seconds).toBeUndefined(); // pass 2 didn't run
    expect(result[2].timestamp_seconds).toBe(1700.0);
  });

  it("enforces monotonicity across pass 2 recoveries", () => {
    // 5 turns, 3000s video. Turns 1 and 2 are unmatched in pass 1 (3/6 overlap).
    // Within their shared bracket [10, 2400], turn 1 best-matches at 300s and
    // turn 2 best-matches at 200s — but 200 < 300 violates monotonicity.
    // Pass 2 should accept turn 1 at 300s and skip turn 2.
    const turns = [
      makeTurn(0, "Welcome to the program today everyone here"),
      makeTurn(1, "Alpha bravo charlie delta echo foxtrot"),
      makeTurn(2, "Golf hotel india juliet kilo lima"),
      makeTurn(3, "The infrastructure investment thesis remains strong today"),
      makeTurn(4, "Thank you for watching the program today"),
    ];
    const segments = [
      makeSeg(10.0, "Welcome to the program today everyone here"),
      makeSeg(300.0, "Alpha bravo charlie xray yankee zulu"),  // 3/6 with turn 1
      makeSeg(200.0, "Golf hotel india mike november oscar"),  // 3/6 with turn 2, but 200 < 300
      makeSeg(2400.0, "The infrastructure investment thesis remains strong today"),
      makeSeg(2900.0, "Thank you for watching the program today"),
    ];

    const result = extractTimestamps(turns, segments, 3000);
    expect(result[0].timestamp_seconds).toBe(10.0);
    expect(result[1].timestamp_seconds).toBe(300.0);       // pass 2 recovery
    expect(result[2].timestamp_seconds).toBeUndefined();    // skipped — would violate monotonicity
    expect(result[3].timestamp_seconds).toBe(2400.0);
    expect(result[4].timestamp_seconds).toBe(2900.0);
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

describe("stampSectionAnchors", () => {
  it("stamps section_anchor on turns based on turn_index ranges", () => {
    const sections: SectionHeading[] = [
      { heading: "Intro", anchor: "intro", turn_index: 0 },
      { heading: "Main Topic", anchor: "main-topic", turn_index: 3 },
      { heading: "Closing", anchor: "closing", turn_index: 6 },
    ];
    const turns = [
      makeTurn(0, "a"), makeTurn(1, "b"), makeTurn(2, "c"),
      makeTurn(3, "d"), makeTurn(4, "e"), makeTurn(5, "f"),
      makeTurn(6, "g"), makeTurn(7, "h"),
    ];

    const result = stampSectionAnchors(turns, sections);
    expect(result[0].section_anchor).toBe("intro");
    expect(result[1].section_anchor).toBe("intro");
    expect(result[2].section_anchor).toBe("intro");
    expect(result[3].section_anchor).toBe("main-topic");
    expect(result[4].section_anchor).toBe("main-topic");
    expect(result[5].section_anchor).toBe("main-topic");
    expect(result[6].section_anchor).toBe("closing");
    expect(result[7].section_anchor).toBe("closing");
  });

  it("returns turns unchanged when sections is empty", () => {
    const turns = [makeTurn(0, "a"), makeTurn(1, "b")];
    const result = stampSectionAnchors(turns, []);
    expect(result[0].section_anchor).toBeUndefined();
    expect(result[1].section_anchor).toBeUndefined();
  });

  it("leaves turns before the first section without section_anchor", () => {
    const sections: SectionHeading[] = [
      { heading: "Topic", anchor: "topic", turn_index: 3 },
    ];
    const turns = [makeTurn(0, "a"), makeTurn(1, "b"), makeTurn(2, "c"), makeTurn(3, "d")];

    const result = stampSectionAnchors(turns, sections);
    expect(result[0].section_anchor).toBeUndefined();
    expect(result[1].section_anchor).toBeUndefined();
    expect(result[2].section_anchor).toBeUndefined();
    expect(result[3].section_anchor).toBe("topic");
  });

  it("stamps all turns when single section starts at 0", () => {
    const sections: SectionHeading[] = [
      { heading: "Everything", anchor: "everything", turn_index: 0 },
    ];
    const turns = [makeTurn(0, "a"), makeTurn(1, "b"), makeTurn(2, "c"), makeTurn(3, "d")];

    const result = stampSectionAnchors(turns, sections);
    expect(result.every((t) => t.section_anchor === "everything")).toBe(true);
  });

  it("skips sections without turn_index", () => {
    const sections: SectionHeading[] = [
      { heading: "No Index", anchor: "no-index" },
      { heading: "Has Index", anchor: "has-index", turn_index: 2 },
    ];
    const turns = [makeTurn(0, "a"), makeTurn(1, "b"), makeTurn(2, "c")];

    const result = stampSectionAnchors(turns, sections);
    expect(result[0].section_anchor).toBeUndefined();
    expect(result[1].section_anchor).toBeUndefined();
    expect(result[2].section_anchor).toBe("has-index");
  });
});
