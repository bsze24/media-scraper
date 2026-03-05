import { describe, it, expect } from "vitest";
import { getScraperForUrl, detectTranscriptSource } from "./registry";

describe("getScraperForUrl", () => {
  it("returns a scraper for Colossus URLs", () => {
    const scraper = getScraperForUrl(
      "https://www.colossus.com/episode/some-episode/"
    );
    expect(scraper).toBeDefined();
    expect(scraper.canHandle("https://www.colossus.com/episode/x/")).toBe(true);
  });

  it("throws for unknown URLs", () => {
    expect(() => getScraperForUrl("https://example.com/page")).toThrow(
      /no scraper available/i
    );
  });
});

describe("detectTranscriptSource", () => {
  it("returns colossus for colossus.com URLs", () => {
    expect(
      detectTranscriptSource("https://www.colossus.com/episode/foo/")
    ).toBe("colossus");
    expect(
      detectTranscriptSource("https://colossus.com/episode/foo/")
    ).toBe("colossus");
  });

  it("throws for unknown hosts", () => {
    expect(() => detectTranscriptSource("https://youtube.com/watch?v=x")).toThrow(
      /unknown transcript source/i
    );
  });

  it("throws for invalid URLs", () => {
    expect(() => detectTranscriptSource("not-a-url")).toThrow(/invalid url/i);
  });
});
