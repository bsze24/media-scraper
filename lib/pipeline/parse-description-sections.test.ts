import { describe, it, expect } from "vitest";
import { parseDescriptionSections } from "./parse-description-sections";

describe("parseDescriptionSections", () => {
  it("parses standard MM:SS format", () => {
    const desc = "0:00 Introduction\n14:23 Topic One\n32:15 Topic Two";
    const sections = parseDescriptionSections(desc);
    expect(sections).toHaveLength(3);
    expect(sections[0]).toMatchObject({
      heading: "Introduction",
      start_time: 0,
      source: "derived",
    });
    expect(sections[1]).toMatchObject({
      heading: "Topic One",
      start_time: 863,
      source: "derived",
    });
    expect(sections[2]).toMatchObject({
      heading: "Topic Two",
      start_time: 1935,
      source: "derived",
    });
    // No turn_index set
    expect(sections[0].turn_index).toBeUndefined();
  });

  it("parses H:MM:SS format", () => {
    const desc = "0:00 Intro\n1:14:23 Deep Dive";
    const sections = parseDescriptionSections(desc);
    expect(sections).toHaveLength(2);
    expect(sections[1]).toMatchObject({
      heading: "Deep Dive",
      start_time: 4463,
    });
  });

  it("handles mixed separators — dash and parenthesized", () => {
    const desc = "14:23 - Topic One\n(32:15) Topic Two";
    const sections = parseDescriptionSections(desc);
    expect(sections).toHaveLength(2);
    expect(sections[0].heading).toBe("Topic One");
    expect(sections[1].heading).toBe("Topic Two");
  });

  it("returns [] for single timestamp (below minimum threshold)", () => {
    const desc = "14:23 Only One Topic";
    expect(parseDescriptionSections(desc)).toEqual([]);
  });

  it("returns [] for no timestamps", () => {
    const desc = "This is a plain text description with no timestamps at all.";
    expect(parseDescriptionSections(desc)).toEqual([]);
  });

  it("returns [] for null/undefined input", () => {
    expect(parseDescriptionSections(null)).toEqual([]);
    expect(parseDescriptionSections(undefined)).toEqual([]);
  });

  it("ignores timestamps mid-sentence", () => {
    const desc =
      "Check out the moment at 14:23 when he explains\n0:00 Start\n5:30 End";
    const sections = parseDescriptionSections(desc);
    expect(sections).toHaveLength(2);
    expect(sections[0].heading).toBe("Start");
    expect(sections[1].heading).toBe("End");
  });

  it("returns sections sorted by start_time ascending", () => {
    const desc = "32:15 Later Topic\n0:00 First Topic\n14:23 Middle Topic";
    const sections = parseDescriptionSections(desc);
    expect(sections.map((s) => s.start_time)).toEqual([0, 863, 1935]);
  });

  it("generates anchor slugs from headings", () => {
    const desc = "0:00 Apollo's DNA\n14:23 Private Credit Overview";
    const sections = parseDescriptionSections(desc);
    expect(sections[0].anchor).toBe("apollos-dna");
    expect(sections[1].anchor).toBe("private-credit-overview");
  });
});
