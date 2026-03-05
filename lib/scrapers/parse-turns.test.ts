import { describe, it, expect } from "vitest";
import { parseTurns } from "./parse-turns";
import type { SectionHeading } from "@/types/scraper";

describe("parseTurns", () => {
  it("returns empty array for empty input", () => {
    expect(parseTurns("")).toEqual([]);
    expect(parseTurns("   ")).toEqual([]);
  });

  it("parses a single speaker block", () => {
    const raw = "Patrick:\nHello world\nWelcome to the show";
    const turns = parseTurns(raw);
    expect(turns).toEqual([
      { speaker: "Patrick", text: "Hello world\nWelcome to the show", turn_index: 0 },
    ]);
  });

  it("parses multiple speakers", () => {
    const raw = [
      "Patrick:",
      "Hello and welcome.",
      "",
      "Marc Andreessen:",
      "Thanks for having me.",
      "Great to be here.",
      "",
      "Patrick:",
      "Let's dive in.",
    ].join("\n");

    const turns = parseTurns(raw);
    expect(turns).toHaveLength(3);
    expect(turns[0]).toEqual({
      speaker: "Patrick",
      text: "Hello and welcome.",
      turn_index: 0,
    });
    expect(turns[1]).toEqual({
      speaker: "Marc Andreessen",
      text: "Thanks for having me.\nGreat to be here.",
      turn_index: 1,
    });
    expect(turns[2]).toEqual({
      speaker: "Patrick",
      text: "Let's dive in.",
      turn_index: 2,
    });
  });

  it("appends blocks without speaker label to previous turn", () => {
    const raw = [
      "Patrick:",
      "First paragraph.",
      "",
      "This continues Patrick's turn.",
      "",
      "Guest:",
      "Hello.",
    ].join("\n");

    const turns = parseTurns(raw);
    expect(turns).toHaveLength(2);
    expect(turns[0].text).toBe(
      "First paragraph.\n\nThis continues Patrick's turn."
    );
    expect(turns[0].speaker).toBe("Patrick");
    expect(turns[1].speaker).toBe("Guest");
  });

  it("handles first block without speaker label", () => {
    const raw = [
      "Some preamble text.",
      "",
      "Patrick:",
      "Hello.",
    ].join("\n");

    const turns = parseTurns(raw);
    expect(turns).toHaveLength(2);
    expect(turns[0]).toEqual({
      speaker: "",
      text: "Some preamble text.",
      turn_index: 0,
    });
    expect(turns[1]).toEqual({
      speaker: "Patrick",
      text: "Hello.",
      turn_index: 1,
    });
  });

  it("assigns incrementing turn_index values", () => {
    const raw = [
      "A:",
      "one",
      "",
      "B:",
      "two",
      "",
      "C:",
      "three",
    ].join("\n");

    const turns = parseTurns(raw);
    expect(turns.map((t) => t.turn_index)).toEqual([0, 1, 2]);
  });

  it("handles multiple blank lines between blocks", () => {
    const raw = "Patrick:\nHello.\n\n\n\nGuest:\nHi.";
    const turns = parseTurns(raw);
    expect(turns).toHaveLength(2);
    expect(turns[0].speaker).toBe("Patrick");
    expect(turns[1].speaker).toBe("Guest");
  });

  it("stamps section_anchor on turns when sections provided", () => {
    const sections: SectionHeading[] = [
      { heading: "## Investment Philosophy", anchor: "investment-philosophy" },
      { heading: "## Portfolio Construction", anchor: "portfolio-construction" },
    ];
    const raw = [
      "Patrick:\nWelcome to the show.",
      "",
      "## Investment Philosophy",
      "",
      "Marc:\nWe focus on value.",
      "",
      "Patrick:\nInteresting.",
      "",
      "## Portfolio Construction",
      "",
      "Marc:\nWe diversify broadly.",
    ].join("\n");

    const turns = parseTurns(raw, sections);
    expect(turns).toHaveLength(4);
    // Before first heading — no anchor
    expect(turns[0].section_anchor).toBeUndefined();
    // After first heading
    expect(turns[1].section_anchor).toBe("investment-philosophy");
    expect(turns[2].section_anchor).toBe("investment-philosophy");
    // After second heading
    expect(turns[3].section_anchor).toBe("portfolio-construction");
  });

  it("does not emit heading blocks as turns", () => {
    const sections: SectionHeading[] = [
      { heading: "## Topic One", anchor: "topic-one" },
    ];
    const raw = [
      "Patrick:\nHello.",
      "",
      "## Topic One",
      "",
      "Guest:\nHi.",
    ].join("\n");

    const turns = parseTurns(raw, sections);
    expect(turns).toHaveLength(2);
    expect(turns.every((t) => t.speaker !== "")).toBe(true);
    // No turn should contain the heading text
    expect(turns.every((t) => !t.text.includes("## Topic One"))).toBe(true);
  });

  it("normalizes heading match (whitespace, case, trailing punctuation)", () => {
    const sections: SectionHeading[] = [
      { heading: "## Investment  Philosophy:", anchor: "invest-phil" },
    ];
    // Raw transcript has slightly different formatting
    const raw = [
      "Patrick:\nHello.",
      "",
      "##  Investment Philosophy",
      "",
      "Guest:\nGreat topic.",
    ].join("\n");

    const turns = parseTurns(raw, sections);
    expect(turns).toHaveLength(2);
    expect(turns[1].section_anchor).toBe("invest-phil");
  });

  it("works without sections arg (backward compatible)", () => {
    const raw = "Patrick:\nHello.\n\nGuest:\nHi.";
    const turns = parseTurns(raw);
    expect(turns).toHaveLength(2);
    expect(turns[0].section_anchor).toBeUndefined();
    expect(turns[1].section_anchor).toBeUndefined();
  });
});
