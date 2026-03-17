import { describe, it, expect, vi } from "vitest";
import { normalizeSpeakerNames } from "./normalize-speakers";

describe("normalizeSpeakerNames", () => {
  it("normalizes first-name and last-name variants to canonical form", () => {
    const transcript = [
      "Marc Rowan:\nSome introduction text here.\n",
      "\nMarc:\nAnother block of text.\n",
      "\nRowan:\nYet another block.\n",
    ].join("\n");

    const result = normalizeSpeakerNames(transcript, [{ name: "Marc Rowan" }]);

    expect(result.replacements).toEqual({
      Marc: "Marc Rowan",
      Rowan: "Marc Rowan",
    });
    // Both variants replaced
    expect(result.normalizedTranscript).not.toMatch(/^Marc:\n/m);
    expect(result.normalizedTranscript).not.toMatch(/^Rowan:\n/m);
    // Original full name preserved
    expect(result.normalizedTranscript).toMatch(/^Marc Rowan:\n/m);
  });

  it("returns unchanged transcript when all names match metadata exactly", () => {
    const transcript = [
      "Patrick O'Shaughnessy:\nHello world.\n",
      "\nMarc Rowan:\nGoodbye world.\n",
    ].join("\n");

    const result = normalizeSpeakerNames(transcript, [
      { name: "Patrick O'Shaughnessy" },
      { name: "Marc Rowan" },
    ]);

    expect(result.replacements).toEqual({});
    expect(result.normalizedTranscript).toBe(transcript);
  });

  it("skips ambiguous matches when name part matches multiple speakers", () => {
    const transcript = [
      "Marc Rowan:\nText.\n",
      "\nMarc Andreessen:\nText.\n",
      "\nMarc:\nAmbiguous text.\n",
    ].join("\n");

    const consoleSpy = vi.spyOn(console, "warn").mockImplementation(() => {});

    const result = normalizeSpeakerNames(transcript, [
      { name: "Marc Rowan" },
      { name: "Marc Andreessen" },
    ]);

    // "Marc" should NOT be normalized (ambiguous)
    expect(result.replacements).toEqual({});
    expect(result.normalizedTranscript).toMatch(/^Marc:\n/m);
    expect(consoleSpy).toHaveBeenCalledWith(
      expect.stringContaining("ambiguous")
    );

    consoleSpy.mockRestore();
  });

  it("uses fallback when knownSpeakers is empty — longest form wins", () => {
    const transcript = [
      "Marc Rowan:\nText one.\n",
      "\nMarc Rowan:\nText two.\n",
      "\nMarc:\nText three.\n",
      "\nRowan:\nText four.\n",
    ].join("\n");

    const result = normalizeSpeakerNames(transcript, []);

    expect(result.replacements).toEqual({
      Marc: "Marc Rowan",
      Rowan: "Marc Rowan",
    });
  });

  it("does not corrupt existing full-name labels when normalizing short forms", () => {
    const transcript = [
      "Marc Rowan:\nFirst block.\n",
      "\nMarc:\nSecond block.\n",
      "\nMarc Rowan:\nThird block.\n",
    ].join("\n");

    const result = normalizeSpeakerNames(transcript, [{ name: "Marc Rowan" }]);

    // Count occurrences of "Marc Rowan:\n" — should be 3 (2 original + 1 normalized)
    const matches = result.normalizedTranscript.match(/^Marc Rowan:\n/gm);
    expect(matches).toHaveLength(3);
    // No bare "Marc:\n" remaining
    expect(result.normalizedTranscript).not.toMatch(/^Marc:\n/m);
  });

  it("normalizes single-name speakers to full names from metadata", () => {
    const transcript = [
      "Patrick:\nHello.\n",
      "\nJohn:\nWorld.\n",
    ].join("\n");

    const result = normalizeSpeakerNames(transcript, [
      { name: "Patrick O'Shaughnessy" },
      { name: "John Zito" },
    ]);

    expect(result.replacements).toEqual({
      Patrick: "Patrick O'Shaughnessy",
      John: "John Zito",
    });
  });

  it("preserves unknown speakers not in metadata", () => {
    const transcript = [
      "Patrick O'Shaughnessy:\nText.\n",
      "\nMystery Guest:\nText.\n",
    ].join("\n");

    const result = normalizeSpeakerNames(transcript, [
      { name: "Patrick O'Shaughnessy" },
    ]);

    // Mystery Guest has no match → preserved
    expect(result.replacements).toEqual({});
    expect(result.normalizedTranscript).toMatch(/^Mystery Guest:\n/m);
  });

  it("returns unchanged transcript when no speaker labels found", () => {
    const transcript = "Just some text with no speaker labels at all.";

    const result = normalizeSpeakerNames(transcript, [{ name: "Someone" }]);

    expect(result.replacements).toEqual({});
    expect(result.normalizedTranscript).toBe(transcript);
  });
});
