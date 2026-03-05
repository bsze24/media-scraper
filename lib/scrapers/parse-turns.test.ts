import { describe, it, expect } from "vitest";
import { parseTurns } from "./parse-turns";

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
});
