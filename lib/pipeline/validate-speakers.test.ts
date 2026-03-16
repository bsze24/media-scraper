import { describe, it, expect } from "vitest";
import { validateSpeakerAttribution } from "./validate-speakers";
import type { Speaker } from "@/types/appearance";

const speakers: Speaker[] = [
  { name: "Ted Seides", role: "host", affiliation: "Capital Allocators" },
  { name: "Tim Sullivan", role: "guest" },
];

describe("validateSpeakerAttribution", () => {
  it("leaves correct names unchanged", () => {
    const transcript = "Ted Seides:\nHow are you?\n\nTim Sullivan:\nGreat thanks.";
    const { corrected, replacements } = validateSpeakerAttribution(transcript, speakers);
    expect(corrected).toBe(transcript);
    expect(replacements).toHaveLength(0);
  });

  it("replaces hallucinated name with closest match", () => {
    const transcript = "Ted Seides:\nHow are you?\n\nTim Reilly:\nGreat thanks.";
    const { corrected, replacements } = validateSpeakerAttribution(transcript, speakers);
    expect(corrected).toContain("Tim Sullivan:\n");
    expect(corrected).not.toContain("Tim Reilly");
    expect(replacements).toEqual([{ from: "Tim Reilly", to: "Tim Sullivan" }]);
  });

  it("matches by last name", () => {
    const transcript = "Seides:\nQuestion here.\n\nSullivan:\nAnswer here.";
    const { corrected, replacements } = validateSpeakerAttribution(transcript, speakers);
    expect(corrected).toContain("Ted Seides:\n");
    expect(corrected).toContain("Tim Sullivan:\n");
    expect(replacements).toHaveLength(2);
  });

  it("skips generic Speaker labels", () => {
    const transcript = "Speaker 1:\nHello.\n\nSpeaker 2:\nHi.";
    const { corrected, replacements } = validateSpeakerAttribution(transcript, speakers);
    expect(corrected).toBe(transcript);
    expect(replacements).toHaveLength(0);
  });

  it("returns unchanged when no known speakers", () => {
    const transcript = "Unknown Person:\nText here.";
    const { corrected, replacements } = validateSpeakerAttribution(transcript, []);
    expect(corrected).toBe(transcript);
    expect(replacements).toHaveLength(0);
  });

  it("warns for completely unrecognizable names", () => {
    const transcript = "John Smith:\nSomething.";
    const { corrected, replacements } = validateSpeakerAttribution(transcript, speakers);
    // No match found — left unchanged
    expect(corrected).toBe(transcript);
    expect(replacements).toHaveLength(0);
  });
});
